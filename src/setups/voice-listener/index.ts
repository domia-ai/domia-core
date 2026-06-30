import { existsSync, readdirSync } from "fs"
import { resolve } from "path"
import { startCapture, type CaptureHandleType } from "@/modules/audio-capture"
import { DOMIA_EVENT_BUS_ENUM, publishToDomiaBus } from "@/buses"
import { type DomiaType } from "@/modules/core"
import { setBootStatus } from "@/modules/runtime-control"
import { appLogger } from "@/utils"

const voiceHandles = new Map<string, CaptureHandleType>()

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

const startVoiceListener = async (
	domia: DomiaType,
): Promise<CaptureHandleType> =>
	startCapture(domia, {
		onWake: () =>
			publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED),
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
	if (!caps?.wakeword || !caps?.record) {
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

	const handle = await startVoiceListener(domia)
	voiceHandles.set(domia.domiaKey, handle)
	appLogger.info(`🤖 Running voice listener: ${domia.name}`)
	setBootStatus({ missingBinaries, voice: "ok", voiceMissing: [] })
}

export const stopVoiceListener = (domiaKey: string): void => {
	voiceHandles.get(domiaKey)?.stop()
	voiceHandles.delete(domiaKey)
}

export const reloadVoiceListener = async (domia: DomiaType): Promise<void> => {
	stopVoiceListener(domia.domiaKey)
	await setupVoiceListener(domia)
}
