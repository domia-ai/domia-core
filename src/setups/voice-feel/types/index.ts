export type VoiceFeelHandleType = {
	domiaKey: string
	timer: ReturnType<typeof setInterval>
	inFlight: boolean
}
