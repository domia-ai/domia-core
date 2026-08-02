const PEER_SPEECH_TTL_MS = 12_000
const PEER_SPEECH_TAIL_MS = 600

const speakingPeers = new Map<string, number>()
let lastStopAt = 0

const peerKey = (nodeId: string, domiaKey: string): string =>
	`${nodeId}\u0000${domiaKey}`

const prune = (): void => {
	const now = Date.now()
	for (const [nodeId, startedAt] of speakingPeers) {
		if (now - startedAt > PEER_SPEECH_TTL_MS) speakingPeers.delete(nodeId)
	}
}

export const setPeerSpeaking = (
	nodeId: string,
	domiaKey: string,
	speaking: boolean,
): void => {
	const key = peerKey(nodeId, domiaKey)
	if (speaking) {
		speakingPeers.set(key, Date.now())
		return
	}
	if (speakingPeers.delete(key)) lastStopAt = Date.now()
}

export const clearPeerSpeech = (nodeId: string): void => {
	const prefix = `${nodeId}\u0000`
	for (const key of speakingPeers.keys())
		if (key.startsWith(prefix)) speakingPeers.delete(key)
}

export const isAnyPeerSpeaking = (): boolean => {
	prune()
	if (speakingPeers.size > 0) return true
	return Date.now() - lastStopAt < PEER_SPEECH_TAIL_MS
}
