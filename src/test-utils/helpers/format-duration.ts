export const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${ms.toFixed(0)}ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
	const minutes = Math.floor(ms / 60000)
	const seconds = ((ms % 60000) / 1000).toFixed(0)
	return `${minutes}m ${seconds}s`
}
