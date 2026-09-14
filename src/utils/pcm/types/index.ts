export type PcmFormatType = {
	sampleRate: number
	channels: number
}

export type AudioEncodingType = "wav" | "flac"

export type AudioDeliveryFormatType = PcmFormatType & {
	encoding: AudioEncodingType
}

export type Pcm16ConverterType = {
	push: (chunk: Buffer) => Buffer
	flush: () => Buffer
}
