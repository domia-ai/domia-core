export type FlacStreamFormatType = {
	sampleRate: number
	channels: number
	blockSize: number
}

export type FlacEncoderType = {
	header: (totalSamples?: number) => Buffer
	push: (pcm16: Buffer) => Buffer
	flush: () => Buffer
}
