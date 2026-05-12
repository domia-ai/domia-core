// @ts-expect-error vendor package ships no types
import * as runtime from "sherpa-onnx-node"

import type {
	Waveform,
	OfflineRecognizerConfig,
	OfflineRecognizerInstance,
	OfflineTtsConfig,
	OfflineTtsInstance,
	KeywordSpotterConfig,
	KeywordSpotterInstance,
	VadConfig,
	VadInstance,
	RuntimeAddon,
} from "./types"

export * from "./types"

const runtimeAddon = runtime as unknown as RuntimeAddon

export const createOfflineRecognizer = (
	config: OfflineRecognizerConfig,
): OfflineRecognizerInstance =>
	new runtimeAddon.OfflineRecognizer(config) as OfflineRecognizerInstance

export const createOfflineTts = (
	config: OfflineTtsConfig,
): OfflineTtsInstance =>
	new runtimeAddon.OfflineTts(config) as OfflineTtsInstance

export const createKeywordSpotter = (
	config: KeywordSpotterConfig,
): KeywordSpotterInstance =>
	new runtimeAddon.KeywordSpotter(config) as KeywordSpotterInstance

export const createVad = (
	config: VadConfig,
	bufferSizeInSeconds = 30,
): VadInstance =>
	new runtimeAddon.Vad(config, bufferSizeInSeconds) as VadInstance

export const readWave = (filePath: string): Waveform =>
	runtimeAddon.readWave(filePath)

export const writeWave = (filePath: string, wave: Waveform): void =>
	runtimeAddon.writeWave(filePath, wave)
