export type CaptureCallbacksType = {
	onWake?: () => void | Promise<void>
	onRecordingStart?: () => void | Promise<void>
	onRecordingEnd?: (filePath: string) => void | Promise<void>
	onError?: (error: Error) => void | Promise<void>
}
