import { existsSync, readdirSync } from "fs"
import { resolve } from "path"
import {
	startCapture,
	abortActiveCapture,
	clearCaptureAbort,
	liveSpeechSeenRecently,
	matchStopPhrase,
	type CaptureHandleType,
} from "@/modules/audio-capture"
import { ensureAec, releaseAec } from "@/modules/aec"
import { hasActivePlayback, stopActivePlayback } from "@/modules/audio-playback"
import { abortActiveTurn, isAnyPeerSpeaking } from "@/modules/core-bus"
import { DOMIA_EVENT_BUS_ENUM, publishToDomiaBus } from "@/buses"
import { type DomiaType } from "@/modules/core"
import { setBootStatus } from "@/modules/runtime-control"
import {
	appLogger,
	domiaError,
	isDomiaError,
	AUDIO_ERRORS,
	toError,
} from "@/utils"

const voiceHandles = new Map<
	string,
	{ handle: CaptureHandleType; domia: DomiaType }
>()

const dirInstalled = (path: string | null | undefined): boolean => {
	if (!path) return false
	try {
		const r = resolve(path)
		return existsSync(r) && readdirSync(r).length > 0
	} catch {
		return false
	}
}

const fileInstalled = (path: string | null | undefined): boolean => {
	if (!path) return false
	try {
		return existsSync(resolve(path))
	} catch {
		return false
	}
}

const missingVoiceResources = (domia: DomiaType): string[] => {
	const ww = domia.wakeWordConfig
	if (!ww) return ["wake-word config"]
	const missing: string[] = []
	if (!dirInstalled(ww.customModelPath))
		missing.push(`wake-word model (${ww.customModelPath})`)
	if (!fileInstalled(ww.vadModelPath))
		missing.push(`VAD model (${ww.vadModelPath})`)
	return missing
}

const publishedWakes = new Set<string>()

const startVoiceListener = async (
	domia: DomiaType,
): Promise<CaptureHandleType> =>
	startCapture(domia, {
		onWake: (keyword) => {
			publishedWakes.delete(domia.id)
			clearCaptureAbort(domia.id)
			const ww = domia.wakeWordConfig
			if (
				ww?.stopWordAbortEnabled &&
				matchStopPhrase(
					keyword,
					domia.characterProfile?.language,
					ww.stopWordMaxWords,
					ww.stopWordMaxExtraWords,
				) !== null
			) {
				const aborted = abortActiveTurn(domia.id, "stop-word")
				const stopped = stopActivePlayback(domia.id)
				appLogger.info(
					aborted || stopped
						? "🛑 stop word — playback aborted"
						: "🛑 stop word heard while idle — ignored",
					{ keyword },
				)
				return
			}
			if (ww?.suppressWakeWhilePeerSpeaks !== false && isAnyPeerSpeaking()) {
				appLogger.info("🙉 wake suppressed — a mesh peer is speaking")
				return
			}
			if (
				ww?.echoResidualGateEnabled &&
				hasActivePlayback(domia.id) &&
				!liveSpeechSeenRecently(domia.id, ww.echoLiveSpeechTtlMs)
			) {
				appLogger.info(
					"🔇 wake rejected — captured energy is explained by our own playback (residual gate)",
					{ keyword },
				)
				return
			}
			publishedWakes.add(domia.id)
			publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED)
		},
		onWakeRejected: (keyword) => {
			if (!publishedWakes.delete(domia.id)) {
				appLogger.info(
					"🛑 wake rejected by verifier — nothing had been started",
					{ keyword },
				)
				return
			}
			const aborted = abortActiveTurn(domia.id, "wake-verifier")
			const stopped = abortActiveCapture(domia.id, "wake-verifier")
			appLogger.info(
				aborted || stopped
					? "🛑 false wake rolled back — capture and turn cancelled"
					: "🛑 false wake rejected — its pending capture will be discarded",
				{ keyword },
			)
		},
		onRecordingEnd: (filePath) =>
			publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
				filePath,
				originDomiaKey: domia.domiaKey,
			}),
		onError: (error) =>
			publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, { error }),
	})

export const setupVoiceListener = async (
	domia: DomiaType,
	missingBinaries: string[] = [],
): Promise<void> => {
	const caps = domia.runtimeCapabilities
	if (!caps?.wakeword || !caps.record) {
		setBootStatus({ missingBinaries, voice: "off", voiceMissing: [] })
		return
	}

	const missing = [...missingBinaries, ...missingVoiceResources(domia)]
	if (missing.length > 0) {
		appLogger.warn(
			`⚠️ Voice disabled — missing: ${missing.join(", ")}. Install + restart to enable.`,
		)
		setBootStatus({
			missingBinaries,
			voice: "disabled-missing",
			voiceMissing: missing,
		})
		return
	}

	if (domia.wakeWordConfig)
		await ensureAec(domia.domiaKey, domia.wakeWordConfig)
	const handle = await startVoiceListener(domia)
	voiceHandles.set(domia.domiaKey, { handle, domia })
	appLogger.info(`🤖 Running voice listener: ${domia.name}`)
	setBootStatus({ missingBinaries, voice: "ok", voiceMissing: [] })
}

export const stopVoiceListener = (domiaKey: string): void => {
	voiceHandles.get(domiaKey)?.handle.stop()
	voiceHandles.delete(domiaKey)
	void releaseAec(domiaKey).catch((err: unknown) =>
		appLogger.warn("AEC release failed", { domiaKey, err }),
	)
}

const restoreVoiceListener = async (previous: DomiaType): Promise<void> => {
	await setupVoiceListener(previous).catch((err: unknown) =>
		appLogger.warn(
			"voice listener could not be restored after a failed reload",
			{
				domiaKey: previous.domiaKey,
				err,
			},
		),
	)
}

export const reloadVoiceListener = async (domia: DomiaType): Promise<void> => {
	const caps = domia.runtimeCapabilities
	const running = voiceHandles.get(domia.domiaKey)
	if (caps?.wakeword && caps.record) {
		const missing = missingVoiceResources(domia)
		if (missing.length > 0)
			throw domiaError(AUDIO_ERRORS.WAKE_WORD_MODEL_FILES_MISSING, {
				logger: appLogger,
				meta: { domiaKey: domia.domiaKey, missing },
			})
	}
	running?.handle.stop()
	voiceHandles.delete(domia.domiaKey)
	try {
		await setupVoiceListener(domia)
	} catch (err) {
		if (running) await restoreVoiceListener(running.domia)
		if (isDomiaError(err)) throw err
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_ENGINE_NOT_FOUND, {
			logger: appLogger,
			meta: { domiaKey: domia.domiaKey, message: toError(err).message },
		})
	}
}
