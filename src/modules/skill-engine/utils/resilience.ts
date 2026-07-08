import type { SkillCallStatusType } from "../types"

const TRANSIENT: ReadonlySet<SkillCallStatusType> = new Set(["timeout"])

export const isTransientStatus = (status: SkillCallStatusType): boolean =>
	TRANSIENT.has(status)

type BreakerStateType = { failures: number; openUntil: number }

const breakers = new Map<string, BreakerStateType>()

export const breakerOpen = (slug: string, threshold: number): boolean => {
	if (threshold <= 0) return false
	const b = breakers.get(slug)
	return b ? Date.now() < b.openUntil : false
}

export const recordBreakerResult = (
	slug: string,
	ok: boolean,
	threshold: number,
	cooldownMs: number,
): void => {
	if (threshold <= 0) return
	const b = breakers.get(slug) ?? { failures: 0, openUntil: 0 }
	if (ok) {
		b.failures = 0
		b.openUntil = 0
	} else {
		b.failures += 1
		if (b.failures >= threshold) b.openUntil = Date.now() + cooldownMs
	}
	breakers.set(slug, b)
}

export const backoffDelay = (attempt: number, backoffMs: number): number =>
	backoffMs * 2 ** (attempt - 1)

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (ms <= 0 || signal?.aborted) return resolve()
		const t = setTimeout(resolve, ms)
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t)
				resolve()
			},
			{ once: true },
		)
	})
