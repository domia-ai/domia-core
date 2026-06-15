const recordingInProgress = new Set<string>()

export const tryBeginRecording = (domiaId: string): boolean => {
	if (recordingInProgress.has(domiaId)) return false
	recordingInProgress.add(domiaId)
	return true
}

export const endRecording = (domiaId: string): void => {
	recordingInProgress.delete(domiaId)
}
