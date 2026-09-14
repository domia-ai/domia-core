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
	SpeechDenoiserConfig,
	OnlineSpeechDenoiserInstance,
	LinearResamplerInstance,
	RuntimeAddon,
	RuntimeVersionsType,
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

export const createOnlineSpeechDenoiser = (
	config: SpeechDenoiserConfig,
): OnlineSpeechDenoiserInstance =>
	new (runtimeAddon().OnlineSpeechDenoiser)(
		config,
	) as OnlineSpeechDenoiserInstance

export const createLinearResampler = (
	inputSampleRate: number,
	outputSampleRate: number,
): LinearResamplerInstance =>
	new (runtimeAddon().LinearResampler)(
		inputSampleRate,
		outputSampleRate,
	) as LinearResamplerInstance

export const runtimeVersions = (): RuntimeVersionsType => ({
	sherpa: runtimeAddon().version,
	onnxruntime: runtimeAddon().onnxruntimeVersion,
})

export const readWave = (filePath: string): Waveform =>
	runtimeAddon().readWave(filePath)

export const writeWave = (filePath: string, wave: Waveform): void =>
	runtimeAddon().writeWave(filePath, wave)
