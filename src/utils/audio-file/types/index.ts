export type WavPcmType = {
	sampleRate: number
	channels: number
	bitsPerSample: number
	pcm: Buffer
}

export type WavStreamWriterType = {
	filePath: string
	write: (chunk: Buffer) => void
	finalize: () => Promise<string>
	abort: () => Promise<void>
}
