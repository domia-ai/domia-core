import { aecLogger, domiaError, AEC_ERRORS } from "@/utils"
import { AEC_DEVICE_DESCRIPTION, ECHO_CANCEL_MODULE } from "../constants"
import {
	aecSignature,
	echoCancelModuleArgs,
	parseBackend,
	parseModuleIndex,
	runPactl,
	staleEchoCancelModules,
} from "../utils"
import type {
	AecBackendType,
	AecConfigType,
	AecLoadedModuleType,
	AecStatusType,
	AecToolingType,
} from "../types"

const holders = new Set<string>()
let loaded: AecLoadedModuleType | null = null
let lastFailure: string | null = null
let unavailableReason: string | null = null
let unavailableLogged = false
let tooling: AecToolingType = { platform: process.platform, runPactl }

export const setAecTooling = (override: Partial<AecToolingType>): void => {
	tooling = { ...tooling, ...override }
	unavailableLogged = false
	unavailableReason = null
}

export const getAecStatus = (): AecStatusType => ({
	state: loaded
		? "active"
		: lastFailure
			? "failed"
			: unavailableReason && holders.size > 0
				? "unavailable"
				: "off",
	backend: loaded?.backend ?? null,
	moduleIndex: loaded?.moduleIndex ?? null,
	sourceName: loaded?.sourceName ?? null,
	sinkName: loaded?.sinkName ?? null,
	holders: [...holders],
	detail: lastFailure ?? unavailableReason,
})

const detectBackend = async (
	config: AecConfigType,
): Promise<AecBackendType | null> => {
	if (tooling.platform !== "linux") {
		unavailableReason = `AEC needs PipeWire or PulseAudio on Linux (platform=${tooling.platform})`
		return null
	}
	const info = await tooling.runPactl(["info"])
	if (!info.ok) {
		unavailableReason = `pactl unavailable (${info.stderr || "not found"})`
		return null
	}
	const detected = parseBackend(info.stdout)
	if (config.aecBackend !== "AUTO") {
		if (detected && detected !== config.aecBackend)
			aecLogger.warn(
				"🔧 configured AEC backend differs from the detected server",
				{
					configured: config.aecBackend,
					detected,
				},
			)
		return config.aecBackend
	}
	if (!detected)
		unavailableReason =
			"pactl answered but the sound server is neither PipeWire nor PulseAudio"
	return detected
}

const pactlOrThrow = async (args: string[]): Promise<string> => {
	const result = await tooling.runPactl(args)
	if (!result.ok)
		throw domiaError(AEC_ERRORS.PACTL_FAILED, {
			logger: aecLogger,
			meta: { args, stderr: result.stderr },
		})
	return result.stdout
}

const currentDefault = async (
	kind: "source" | "sink",
): Promise<string | null> => {
	const result = await tooling.runPactl([`get-default-${kind}`])
	return result.ok && result.stdout ? result.stdout : null
}

const unloadStale = async (sourceName: string): Promise<void> => {
	const list = await tooling.runPactl(["list", "short", "modules"])
	if (!list.ok) return
	for (const index of staleEchoCancelModules(list.stdout, sourceName)) {
		aecLogger.warn("🔧 unloading stale echo-cancel module", { index })
		await tooling.runPactl(["unload-module", String(index)])
	}
}

const load = async (
	config: AecConfigType,
	backend: AecBackendType,
): Promise<AecLoadedModuleType> => {
	await unloadStale(config.aecSourceName)
	const previousDefaultSource = config.aecSetDefaultDevices
		? await currentDefault("source")
		: null
	const previousDefaultSink = config.aecSetDefaultDevices
		? await currentDefault("sink")
		: null
	const stdout = await pactlOrThrow([
		"load-module",
		ECHO_CANCEL_MODULE,
		...echoCancelModuleArgs(config, AEC_DEVICE_DESCRIPTION),
	])
	const moduleIndex = parseModuleIndex(stdout)
	if (moduleIndex === null)
		throw domiaError(AEC_ERRORS.MODULE_INDEX_UNPARSEABLE, {
			logger: aecLogger,
			meta: { stdout },
		})
	if (config.aecSetDefaultDevices) {
		try {
			await pactlOrThrow(["set-default-source", config.aecSourceName])
			await pactlOrThrow(["set-default-sink", config.aecSinkName])
		} catch (err) {
			await tooling.runPactl(["unload-module", String(moduleIndex)])
			if (previousDefaultSource)
				await tooling.runPactl(["set-default-source", previousDefaultSource])
			if (previousDefaultSink)
				await tooling.runPactl(["set-default-sink", previousDefaultSink])
			throw err
		}
	}
	return {
		signature: aecSignature(config),
		backend,
		moduleIndex,
		sourceName: config.aecSourceName,
		sinkName: config.aecSinkName,
		previousDefaultSource,
		previousDefaultSink,
	}
}

const unload = async (): Promise<void> => {
	if (!loaded) return
	const current = loaded
	loaded = null
	const unloaded = await tooling.runPactl([
		"unload-module",
		String(current.moduleIndex),
	])
	if (!unloaded.ok)
		aecLogger.warn("🔧 echo-cancel unload failed", {
			moduleIndex: current.moduleIndex,
			stderr: unloaded.stderr,
		})
	if (current.previousDefaultSource)
		await tooling.runPactl([
			"set-default-source",
			current.previousDefaultSource,
		])
	if (current.previousDefaultSink)
		await tooling.runPactl(["set-default-sink", current.previousDefaultSink])
	aecLogger.info("🔧 echo-cancel module unloaded", {
		backend: current.backend,
		moduleIndex: current.moduleIndex,
	})
}

const ensureAecImpl = async (
	domiaKey: string,
	config: AecConfigType,
): Promise<AecStatusType> => {
	if (!config.aecEnabled) {
		await releaseAecImpl(domiaKey)
		return getAecStatus()
	}
	holders.add(domiaKey)
	if (loaded?.signature === aecSignature(config)) return getAecStatus()
	const backend = await detectBackend(config)
	if (!backend) {
		if (!unavailableLogged) {
			unavailableLogged = true
			aecLogger.info(
				`🔧 AEC requested but unavailable — ${unavailableReason}; capture runs without echo cancellation`,
				{
					domiaKey,
				},
			)
		}
		return getAecStatus()
	}
	try {
		if (loaded) {
			aecLogger.info("🔧 AEC config changed — rebinding echo-cancel module", {
				domiaKey,
			})
			await unload()
		}
		loaded = await load(config, backend)
		lastFailure = null
		unavailableReason = null
		aecLogger.info("🔧 echo-cancel module loaded", {
			backend,
			moduleIndex: loaded.moduleIndex,
			source: loaded.sourceName,
			sink: loaded.sinkName,
			method: config.aecMethod,
			defaultsSet: config.aecSetDefaultDevices,
		})
	} catch (err) {
		lastFailure = err instanceof Error ? err.message : String(err)
		aecLogger.warn(
			"🔧 AEC load failed — capture runs without echo cancellation",
			{
				domiaKey,
				err,
			},
		)
	}
	return getAecStatus()
}

const releaseAecImpl = async (domiaKey: string): Promise<void> => {
	holders.delete(domiaKey)
	if (holders.size === 0) {
		lastFailure = null
		await unload()
	}
}

const shutdownAecImpl = async (): Promise<void> => {
	holders.clear()
	lastFailure = null
	await unload()
}

let queue: Promise<unknown> = Promise.resolve()

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task, task)
	queue = run.then(
		() => undefined,
		() => undefined,
	)
	return run
}

export const ensureAec = (
	domiaKey: string,
	config: AecConfigType,
): Promise<AecStatusType> => serialize(() => ensureAecImpl(domiaKey, config))

export const releaseAec = (domiaKey: string): Promise<void> =>
	serialize(() => releaseAecImpl(domiaKey))

export const shutdownAec = (): Promise<void> => serialize(shutdownAecImpl)
