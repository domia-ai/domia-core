export type CaptureCallbacksType = {
	onWake?: () => void | Promise<void>
	onRecordingStart?: () => void | Promise<void>
	onRecordingEnd?: (filePath: string) => void | Promise<void>
	onError?: (error: Error) => void | Promise<void>
}

export type StartAudioStreamResultType = {
	chunks: AsyncIterable<Buffer>
	filePathPromise: Promise<string>
	stop: () => void
}

export type KwsPathsType = {
	dir: string
	encoder: string
	decoder: string
	joiner: string
	tokens: string
	keywords: string
}
