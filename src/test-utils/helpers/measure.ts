export const measure = async <T>(
	fn: () => Promise<T>,
	cb?: (duration: number) => void,
): Promise<T> => {
	const start = performance.now()
	const result = await fn()
	const end = performance.now()
	const duration = end - start
	cb?.(duration)
	return result
}
