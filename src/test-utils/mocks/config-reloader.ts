import type { StubReloaderOptionsType, StubReloaderType } from "../types"

export const createStubReloader = (
	options: StubReloaderOptionsType = {},
): StubReloaderType => {
	const { scope = "global", failTimes = 0, message = "reload failed" } = options
	let calls = 0
	let failures = 0
	return {
		scope,
		reload: (): Promise<void> => {
			calls += 1
			if (calls <= failTimes) {
				failures += 1
				return Promise.reject(new Error(message))
			}
			return Promise.resolve()
		},
		calls: () => calls,
		failures: () => failures,
	}
}

export const createFailingOnceReloader = (
	options: Omit<StubReloaderOptionsType, "failTimes"> = {},
): StubReloaderType => createStubReloader({ ...options, failTimes: 1 })
