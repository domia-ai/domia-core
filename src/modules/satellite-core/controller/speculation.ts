import { RESPONSE_TYPE_ENUM } from "@/db"
import { admitVoiceReply } from "@/modules/voice-admission"
import { isSemaphoreBusyError, onceFn, satelliteGatewayLogger } from "@/utils"
import {
	createVadWindow,
	observeIntraTurnPause,
	type SpeculativeCaptureHooksType,
} from "@/modules/audio-capture"
import { runSpeculativeTurn } from "@/modules/core-bus/controller/speculative-turn"
import {
	resolveCoreBusFeatures,
	skillsMayIntercept,
} from "@/modules/core-bus/utils"
import { normalizeRuntimeCapabilities } from "@/setups/environment"
import type { SttStreamSessionType } from "@/modules/stt-engine"

import type {
	SatelliteSpeculationArgsType,
	SatelliteSpeculationType,
} from "../types"

const wrapSession = (session: SttStreamSessionType): SttStreamSessionType => ({
	pushChunk: (pcm) => session.pushChunk(pcm),
	partial: () => session.partial(),
	// no pads into the shared decoder — partial() is the snapshot, so resume needs no reset
	flushPartial: () => Promise.resolve(session.partial()),
	finish: () => session.finish(),
	reset: () => undefined,
	abort: () => session.abort(),
})

export const startSatelliteSpeculation = async (
	args: SatelliteSpeculationArgsType,
): Promise<SatelliteSpeculationType | null> => {
	const { identity, interactionId } = args
	const config = identity.wakeWordConfig
	if (!config?.satelliteSpeculationEnabled) return null
	if (config.speculativeSilenceMs <= 0) return null
	if (skillsMayIntercept(identity) && config.speculateWithSkills !== true)
		return null
	if (!args.sttSession()) return null
	const features = resolveCoreBusFeatures(
		identity,
		normalizeRuntimeCapabilities(identity.runtimeCapabilities ?? {}),
	)
	if (features.canRunLlm ? !features.canStreamLlm : false) return null
	if (!features.canRunTts) return null
	const admitted = await admitVoiceReply(identity).catch((err: unknown) => {
		if (isSemaphoreBusyError(err)) return null
		throw err
	})
	if (!admitted) return null
	const release = onceFn(admitted)

	const fastVad = createVadWindow(config, {
		minSilenceS: config.speculativeSilenceMs / 1000,
	})
	fastVad.feed(args.bufferedPcm())
	let hooks: SpeculativeCaptureHooksType | null = null
	let speculated = false
	let speculatedAt = 0
	let speechEndAtVal: number | null = null
	let settleFinal!: {
		resolve: (pcm: Buffer) => void
		reject: (err: Error) => void
	}
	const finalPcmPromise = new Promise<Buffer>((resolve, reject) => {
		settleFinal = { resolve, reject }
	})
	finalPcmPromise.catch(() => undefined)
	let settleFile!: {
		resolve: (p: string) => void
		reject: (err: Error) => void
	}
	const filePathPromise = new Promise<string>((resolve, reject) => {
		settleFile = { resolve, reject }
	})
	filePathPromise.catch(() => undefined)

	const done = runSpeculativeTurn(
		{ domia: identity, features },
		{
			interactionId,
			release,
			existingSttSession: () => {
				const session = args.sttSession()
				return session ? wrapSession(session) : null
			},
			publish: { responseType: RESPONSE_TYPE_ENUM.VOICE, liveVoice: false },
			captureFactory: (h) => {
				hooks = h
				return {
					debounceMs: args.vadDebounceMs,
					endpointObservedMs: () => null,
					finalPcmPromise,
					filePathPromise,
					speechEndAt: () => speechEndAtVal,
					stop: () => undefined,
				}
			},
		},
	)
	satelliteGatewayLogger.info("🔮 satellite speculation armed", {
		domiaKey: identity.domiaKey,
		interactionId,
	})

	return {
		interactionId,
		feed: (pcm, cumulativePcm) => {
			fastVad.feed(pcm)
			if (!hooks) return
			if (speculated && fastVad.speechActive()) {
				speculated = false
				observeIntraTurnPause(
					identity.id,
					Date.now() - speculatedAt + config.speculativeSilenceMs,
					config,
				)
				hooks.onResume(cumulativePcm())
			} else if (
				!speculated &&
				fastVad.everDetected() &&
				!fastVad.speechActive()
			) {
				speculated = true
				speculatedAt = Date.now()
				hooks.onSpeculate(cumulativePcm())
			}
		},
		handoff: ({ pcm, speechEndAt, filePathPromise: archived }) => {
			speechEndAtVal = speechEndAt ?? null
			archived.then(settleFile.resolve, settleFile.reject)
			settleFinal.resolve(pcm)
		},
		abort: (reason) => {
			settleFinal.reject(new Error(`satellite speculation aborted: ${reason}`))
			settleFile.reject(new Error(`satellite speculation aborted: ${reason}`))
		},
		release,
		done,
	}
}
