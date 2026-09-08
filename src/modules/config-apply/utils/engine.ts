import type { DomiaType } from "@/modules/core"
import { appLogger } from "@/utils"

import { RELOAD_SCOPE } from "../constants"
import type {
	ConfigApplyEngineDepsType,
	ConfigApplyEngineType,
	ConfigApplyOutcomeType,
	ConfigApplyResultType,
	ConfigChangeType,
	ConfigRevertOutcomeType,
	ReloadSubsystemType,
	SubsystemOutcomeType,
} from "../types"

import { LLM_DRAIN, classify } from "./classify"
import { diffConfig } from "./diff"
import { buildRevertBundle } from "./revert"

const resultOf = (
	outcomes: SubsystemOutcomeType[],
	restartFallback: boolean,
): ConfigApplyResultType["result"] => {
	if (restartFallback) return "restart"
	if (outcomes.some((o) => o.status === "failed" || o.status === "skipped"))
		return "partial"
	if (outcomes.some((o) => o.status === "reverted")) return "reverted"
	if (outcomes.some((o) => o.status === "reloaded")) return "reloaded"
	return "live"
}

export const createConfigApplyEngine = (
	deps: ConfigApplyEngineDepsType,
): ConfigApplyEngineType => {
	const {
		state,
		runner,
		reloaderFor,
		persist,
		resolve,
		quiesce,
		runExclusive,
		onLlmClientStale,
		requestRestart,
		defaultDrainMs,
	} = deps

	const runReloader = async (
		subsystem: ReloadSubsystemType,
		domia: DomiaType,
		domiaKey: string,
		desiredRevision: number,
		drainMs: number,
		drained: Set<string>,
		outcomes: SubsystemOutcomeType[],
	): Promise<void> => {
		const reloader = reloaderFor(subsystem)
		if (!reloader) {
			outcomes.push({ subsystem, status: "skipped", desiredRevision })
			return
		}
		const { outcome, drainedIds } = await runner.run({
			subsystem,
			scope: RELOAD_SCOPE[subsystem],
			reloader,
			domia,
			domiaKey,
			desiredRevision,
			drainMs,
		})
		drainedIds.forEach((id) => drained.add(id))
		outcomes.push(outcome)
	}

	const revertFailedSubsystems = async (
		oldDomia: DomiaType,
		newDomia: DomiaType,
		domiaKey: string,
		changes: ConfigChangeType[],
		outcomes: SubsystemOutcomeType[],
	): Promise<ConfigRevertOutcomeType> => {
		const failed = outcomes
			.filter((o) => o.status === "failed")
			.map((o) => o.subsystem as ReloadSubsystemType)
		if (failed.length === 0) return { outcomes, sections: [] }
		const plan = buildRevertBundle(oldDomia, changes, failed)
		if (plan.unrevertable.length > 0)
			appLogger.warn("⚙️ config revert not possible for some subsystems", {
				domiaKey,
				subsystems: plan.unrevertable,
			})
		if (plan.subsystems.length === 0) return { outcomes, sections: [] }
		try {
			const restoredConfig = await persist(newDomia, plan.bundle)
			const restored = (await resolve(domiaKey)) ?? newDomia
			for (const subsystem of plan.subsystems)
				state.markReverted(domiaKey, subsystem, restored.configRevision)
			appLogger.warn("⚙️ config section reverted after failed reload", {
				domiaKey,
				sections: plan.sections,
				subsystems: plan.subsystems,
				revision: restored.configRevision,
			})
			const reverted = new Set<string>(plan.subsystems)
			return {
				sections: plan.sections,
				config: restoredConfig.config,
				outcomes: outcomes.map((o) =>
					reverted.has(o.subsystem) && o.status === "failed"
						? {
								...o,
								status: "reverted",
								desiredRevision: restored.configRevision,
								runningRevision: restored.configRevision,
							}
						: o,
				),
			}
		} catch (err) {
			appLogger.error("⚙️ config revert failed — subsystem stays pending", {
				domiaKey,
				sections: plan.sections,
				err,
			})
			return { outcomes, sections: [] }
		}
	}

	const reloadSubsystem = async (
		subsystem: ReloadSubsystemType,
		domiaKey: string,
	): Promise<ConfigApplyResultType> =>
		runExclusive(`apply:${domiaKey}`, async () => {
			const domia = await resolve(domiaKey)
			const drainMs = domia?.configReloadDrainMs ?? defaultDrainMs
			const outcomes: SubsystemOutcomeType[] = []
			const drained = new Set<string>()
			if (!reloaderFor(subsystem) || !domia) {
				appLogger.warn("⚙️ subsystem reload needs restart (unregistered)", {
					subsystem,
					domiaKey,
				})
				requestRestart()
				return {
					result: "restart",
					desiredRevision: domia?.configRevision ?? 0,
					subsystems: [{ subsystem, status: "skipped" }],
					drained: [],
					revertedSections: [],
					reconciled: [],
				}
			}
			await runReloader(
				subsystem,
				domia,
				domiaKey,
				domia.configRevision,
				drainMs,
				drained,
				outcomes,
			)
			return {
				result: resultOf(outcomes, false),
				desiredRevision: domia.configRevision,
				subsystems: outcomes,
				drained: [...drained],
				revertedSections: [],
				reconciled: [],
			}
		})

	const applyConfig = async (
		oldDomia: DomiaType,
		input: unknown,
	): Promise<ConfigApplyOutcomeType> => {
		const domiaKey = oldDomia.domiaKey
		return runExclusive(`apply:${domiaKey}`, async () => {
			const { config } = await persist(oldDomia, input)
			const newDomia = (await resolve(domiaKey)) ?? oldDomia
			const desiredRevision = newDomia.configRevision
			const drainMs = newDomia.configReloadDrainMs
			const changes = diffConfig(oldDomia, newDomia)
			const plan = classify(changes)
			const llmClientStale = changes.some(
				(c) => c.section === "llm" && LLM_DRAIN.has(c.field),
			)
			const outcomes: SubsystemOutcomeType[] = []
			const drained = new Set<string>()
			let restartFallback = plan.restart

			const reconciled = state
				.pending(domiaKey)
				.filter(
					(subsystem) =>
						!plan.reloads.has(subsystem) &&
						!(subsystem === "identity" && plan.identity),
				)
			for (const subsystem of reconciled)
				plan.reloads.set(subsystem, RELOAD_SCOPE[subsystem])
			if (reconciled.length > 0)
				appLogger.info(
					"⚙️ reconciling subsystems behind the desired revision",
					{
						domiaKey,
						subsystems: reconciled,
					},
				)

			if (plan.live)
				outcomes.push({
					subsystem: "config",
					status: "live",
					desiredRevision,
					runningRevision: desiredRevision,
				})

			if (plan.liveDrain) {
				await quiesce([newDomia.id], drainMs)
				if (llmClientStale) onLlmClientStale()
				drained.add(newDomia.id)
				outcomes.push({
					subsystem: "live-drain",
					status: "live",
					desiredRevision,
					runningRevision: desiredRevision,
				})
			}

			for (const subsystem of plan.reloads.keys()) {
				if (!reloaderFor(subsystem)) restartFallback = true
				await runReloader(
					subsystem,
					newDomia,
					domiaKey,
					desiredRevision,
					drainMs,
					drained,
					outcomes,
				)
			}

			if (plan.identity && !plan.reloads.has("identity")) {
				if (!reloaderFor("identity")) restartFallback = true
				await runReloader(
					"identity",
					newDomia,
					domiaKey,
					desiredRevision,
					drainMs,
					drained,
					outcomes,
				)
			}

			const reverted = await revertFailedSubsystems(
				oldDomia,
				newDomia,
				domiaKey,
				changes,
				outcomes,
			)

			if (restartFallback) {
				appLogger.warn(
					"⚙️ config apply needs restart (unregistered/structural change)",
					{ domiaKey },
				)
				requestRestart()
			}

			const result = resultOf(reverted.outcomes, restartFallback)
			const finalRevision = ((await resolve(domiaKey)) ?? newDomia)
				.configRevision

			appLogger.info(`⚙️ config applied → ${result}`, {
				domiaKey,
				desiredRevision: finalRevision,
				subsystems: reverted.outcomes.map((o) => `${o.subsystem}:${o.status}`),
			})

			return {
				config: reverted.config ?? config,
				apply: {
					result,
					desiredRevision: finalRevision,
					subsystems: reverted.outcomes,
					drained: [...drained],
					revertedSections: reverted.sections,
					reconciled,
				},
			}
		})
	}

	return { applyConfig, reloadSubsystem }
}
