import type {
	Waveform,
	OfflineRecognizerConfig,
	OfflineRecognizerInstance,
	OnlineRecognizerConfig,
	OnlineRecognizerInstance,
	OfflineTtsConfig,
	OfflineTtsInstance,
	KeywordSpotterConfig,
	KeywordSpotterInstance,
	VadConfig,
	VadInstance,
	RuntimeAddon,
} from "./types"

let loaded: RuntimeAddon | null = null
// lazy: sherpa-onnx-node costs ~15MB RSS at import — caps-off nodes never pay it
const runtimeAddon = (): RuntimeAddon =>
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- sync lazy load; await import would force the whole factory async
	(loaded ??= require("sherpa-onnx-node") as RuntimeAddon)

export const createOfflineRecognizer = (
	config: OfflineRecognizerConfig,
): OfflineRecognizerInstance =>
	new (runtimeAddon().OfflineRecognizer)(config) as OfflineRecognizerInstance

export const createOnlineRecognizer = (
	config: OnlineRecognizerConfig,
): OnlineRecognizerInstance =>
	new (runtimeAddon().OnlineRecognizer)(config) as OnlineRecognizerInstance

export const createOfflineTts = (
	config: OfflineTtsConfig,
): OfflineTtsInstance =>
	new (runtimeAddon().OfflineTts)(config) as OfflineTtsInstance

export const createKeywordSpotter = (
	config: KeywordSpotterConfig,
): KeywordSpotterInstance =>
	new (runtimeAddon().KeywordSpotter)(config) as KeywordSpotterInstance

export const createVad = (
	config: VadConfig,
	bufferSizeInSeconds = 30,
): VadInstance =>
	new (runtimeAddon().Vad)(config, bufferSizeInSeconds) as VadInstance

export const readWave = (filePath: string): Waveform =>
	runtimeAddon().readWave(filePath)

export const writeWave = (filePath: string, wave: Waveform): void =>
	runtimeAddon().writeWave(filePath, wave)
