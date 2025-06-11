import { startCapture } from "@/modules/audio-capture"
import { DOMIA_EVENT_BUS_ENUM, publishToDomiaBus } from "@/buses"
import { type DomiaType } from "@/modules/core"

export const setupOwnDomia = async (domia: DomiaType) => {
	const domiaId = domia?.id

	await startCapture(domia, {
		onWake: () =>
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED),
		onRecordingEnd: (filePath) =>
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
				filePath,
			}),
		onError: (error) =>
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, { error }),
	})
}
