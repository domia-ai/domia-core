import type {
	BuiltinAvailabilityContextType,
	BuiltinToolContextType,
	OriginCapabilitiesType,
	SkillRuntimeTimerKindType,
	SkillRuntimeTimerStartInputType,
	SkillRuntimeTimerStartResultType,
	SkillRuntimeTimerType,
} from "../../../../types"
import { durationLabel, phrase } from "../../packs"

export const announceTargetExists = (
	origin: OriginCapabilitiesType,
	ctx: BuiltinAvailabilityContextType,
): boolean => ctx.runtime.announceTarget(ctx.domiaId, origin).kind !== "none"

export const startTimer = (
	ctx: BuiltinToolContextType,
	kind: SkillRuntimeTimerKindType,
	input: Omit<SkillRuntimeTimerStartInputType, "domia" | "origin" | "kind">,
): Promise<SkillRuntimeTimerStartResultType> =>
	ctx.runtime.timers.start({
		domia: ctx.domia,
		origin: ctx.origin,
		kind,
		...input,
	})

export const listTimers = (
	ctx: BuiltinToolContextType,
	kind: SkillRuntimeTimerKindType,
): Promise<SkillRuntimeTimerType[]> =>
	ctx.runtime.timers.list(ctx.domia, ctx.origin, kind)

export const cancelTimers = (
	ctx: BuiltinToolContextType,
	kind: SkillRuntimeTimerKindType,
): Promise<SkillRuntimeTimerType[]> =>
	ctx.runtime.timers.cancel(ctx.domia, ctx.origin, kind)

export const remainingLabel = (
	ctx: BuiltinToolContextType,
	timer: SkillRuntimeTimerType,
): string => durationLabel(ctx.runtime.timers.remaining(timer), ctx.sets)

export const destinationDiffers = (
	origin: OriginCapabilitiesType,
	result: SkillRuntimeTimerStartResultType,
): boolean =>
	result.destination.kind === "satellite"
		? result.destination.satelliteId !== origin.satelliteId
		: result.destination.kind === "local" && !origin.localPlayback

export const destinationName = (
	ctx: BuiltinToolContextType,
	result: SkillRuntimeTimerStartResultType,
): string =>
	result.destinationName ??
	(result.destination.kind === "satellite"
		? result.destination.satelliteId
		: phrase(ctx.sets, "localDeviceName"))
