export type WavStreamWriterType = {
	filePath: string
	write: (chunk: Buffer) => void
	finalize: () => Promise<string>
	abort: () => Promise<void>
}
