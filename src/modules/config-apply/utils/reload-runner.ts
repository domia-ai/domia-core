import type {
	ReloadRunInputType,
	ReloadRunResultType,
	ReloadRunnerDepsType,
	ReloadRunnerType,
} from "../types"

const messageOf = (err: unknown): string =>
	err instanceof Error ? err.message : String(err)

export const createReloadRunner = (
	deps: ReloadRunnerDepsType,
): ReloadRunnerType => {
	const { state, hostedIds, resolveLatest, quiesce, runExclusive, gateReload } =
		deps

	const run = async (
		input: ReloadRunInputType,
	): Promise<ReloadRunResultType> => {
		const {
			subsystem,
			scope,
			reloader,
			domia,
			domiaKey,
			desiredRevision,
			drainMs,
		} = input
		state.markDesired(domiaKey, subsystem, desiredRevision)
		const mutexKey =
			scope === "global" ? `sub:${subsystem}` : `sub:${subsystem}:${domiaKey}`
		return runExclusive(mutexKey, async () => {
			const drainedIds = scope === "global" ? await hostedIds() : [domia.id]
			const releaseGate = gateReload(drainedIds)
			try {
				await quiesce(drainedIds, drainMs)
				const latest = (await resolveLatest(domiaKey)) ?? domia
				if (latest.configRevision !== desiredRevision)
					return {
						drainedIds,
						outcome: {
							subsystem,
							status: "skipped" as const,
							desiredRevision,
							runningRevision: state.runningRevision(domiaKey, subsystem),
						},
					}
				try {
					await reloader.reload(latest, domiaKey)
					state.markRunning(domiaKey, subsystem, latest.configRevision)
					return {
						drainedIds,
						outcome: {
							subsystem,
							status: "reloaded" as const,
							desiredRevision,
							runningRevision: latest.configRevision,
						},
					}
				} catch (err) {
					const error = messageOf(err)
					state.markFailed(domiaKey, subsystem, desiredRevision, error)
					return {
						drainedIds,
						outcome: {
							subsystem,
							status: "failed" as const,
							desiredRevision,
							runningRevision: state.runningRevision(domiaKey, subsystem),
							error,
						},
					}
				}
			} finally {
				releaseGate()
			}
		})
	}

	return { run }
}
