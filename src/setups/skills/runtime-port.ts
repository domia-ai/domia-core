import {
	DEFAULT_AUDIO_PLAYBACK_VOLUME,
	PROACTIVE_IMPORTANCE_ENUM,
	PROACTIVE_SCHEDULE_STATUS_ENUM,
	PROACTIVE_TARGET_KIND_ENUM,
	PROACTIVE_TEMPLATE_KEY_ENUM,
	PROACTIVE_VERB_ENUM,
	VOLUME_PERCENT_SCALE,
	type SelectProactiveScheduleType,
} from "@/db"
import {
	externalMediaKey,
	getExternalMediaControls,
} from "@/modules/audio-playback"
import { clampVolumePercent, setPlaybackVolume } from "@/modules/config"
import {
	type DomiaType,
	getDomia,
	getSatellitesForDomia,
	safeOwnDomia,
} from "@/modules/core"
import {
	getPresence,
	getSatelliteControl,
	originCapabilitiesOf,
	type SatelliteTimerEventType,
} from "@/modules/core-bus"
import { expireFactsMatching, upsertFacts } from "@/modules/memory"
import {
	cancelScheduleItem,
	createScheduleItem,
	listScheduleItems,
	onScheduleDelivered,
	wakeScheduleAt,
} from "@/modules/proactivity"
import { markReflectionCaptured } from "@/modules/reflection"
import { getRecentTurns } from "@/modules/session-manager"
import {
	setSkillRuntimePort,
	type OriginCapabilitiesType,
	type SkillRuntimeAnnounceTargetType,
	type SkillRuntimePortType,
	type SkillRuntimeTimerKindType,
	type SkillRuntimeTimerType,
} from "@/modules/skill-engine"
import { skillEngineLogger } from "@/utils"

import { normalizeRuntimeCapabilities } from "../environment"

const TEMPLATE_BY_KIND: Record<SkillRuntimeTimerKindType, string> = {
	timer: PROACTIVE_TEMPLATE_KEY_ENUM.TIMER_FINISHED,
	reminder: PROACTIVE_TEMPLATE_KEY_ENUM.REMINDER_DUE,
	alarm: PROACTIVE_TEMPLATE_KEY_ENUM.ALARM_RING,
}

const KIND_BY_TEMPLATE = new Map<string, SkillRuntimeTimerKindType>(
	(Object.keys(TEMPLATE_BY_KIND) as SkillRuntimeTimerKindType[]).map((kind) => [
		TEMPLATE_BY_KIND[kind],
		kind,
	]),
)

const ACTIVE_STATUSES = [
	PROACTIVE_SCHEDULE_STATUS_ENUM.PENDING,
	PROACTIVE_SCHEDULE_STATUS_ENUM.LEASED,
]

const domiaKeys = new Map<string, string>()

const domiaOf = async (domiaId: string): Promise<DomiaType | null> => {
	const known = domiaKeys.get(domiaId)
	if (known) return safeOwnDomia(known, "skill runtime port")
	const fresh = await getDomia(domiaId, false).catch((err: unknown) => {
		skillEngineLogger.warn("skill runtime port could not resolve identity", {
			domiaId,
			err,
		})
		return null
	})
	if (!fresh) return null
	domiaKeys.set(domiaId, fresh.domiaKey)
	return safeOwnDomia(fresh.domiaKey, "skill runtime port")
}

const domiaKeyOf = (domiaId: string): string | null =>
	domiaKeys.get(domiaId) ?? null

const originCapabilities = (
	domia: DomiaType,
	satelliteId: string | undefined,
	source: string,
): OriginCapabilitiesType =>
	originCapabilitiesOf(
		domia.domiaKey,
		satelliteId,
		source,
		normalizeRuntimeCapabilities(domia.runtimeCapabilities ?? {}).playback,
	)

const announceTargetFor = (
	domiaKey: string,
	origin: OriginCapabilitiesType,
): SkillRuntimeAnnounceTargetType => {
	if (origin.satelliteId && (origin.canAnnounce || origin.timerNative))
		return { kind: "satellite", satelliteId: origin.satelliteId }
	const connected = (getPresence(domiaKey)?.satellites ?? []).filter(
		(s) => s.connected && s.capabilities.canAnnounce,
	)
	if (connected.length > 0) {
		const best = [...connected].sort(
			(a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0),
		)[0]
		return { kind: "satellite", satelliteId: best.satelliteId }
	}
	if (origin.localPlayback) return { kind: "local" }
	return { kind: "none" }
}

const announceTarget = (
	domiaId: string,
	origin: OriginCapabilitiesType,
): SkillRuntimeAnnounceTargetType => {
	const domiaKey = domiaKeyOf(domiaId)
	if (!domiaKey)
		return origin.localPlayback ? { kind: "local" } : { kind: "none" }
	return announceTargetFor(domiaKey, origin)
}

const kindOf = (
	row: SelectProactiveScheduleType,
): SkillRuntimeTimerKindType | null =>
	row.templateKey ? (KIND_BY_TEMPLATE.get(row.templateKey) ?? null) : null

const remainingOf = (dueAt: string): number =>
	Math.max(0, Math.round((Date.parse(dueAt) - Date.now()) / 1000))

const toTimer = (
	row: SelectProactiveScheduleType,
	kind: SkillRuntimeTimerKindType,
): SkillRuntimeTimerType => ({
	id: row.id,
	kind,
	label: row.templateParams?.label ?? row.name,
	text: row.text,
	dueAt: row.dueAt,
	remainingSeconds: remainingOf(row.dueAt),
	totalSeconds: Number(
		row.templateParams?.totalSeconds ?? remainingOf(row.dueAt),
	),
	targetKind: row.targetKind,
	targetSatelliteId: row.targetSatelliteId,
})

const visibleFrom = (
	row: SelectProactiveScheduleType,
	origin: OriginCapabilitiesType,
): boolean =>
	origin.satelliteId
		? row.targetSatelliteId === origin.satelliteId ||
			row.targetKind !== PROACTIVE_TARGET_KIND_ENUM.SATELLITE
		: true

const activeTimers = (
	domia: DomiaType,
	origin: OriginCapabilitiesType,
	kind: SkillRuntimeTimerKindType,
): SkillRuntimeTimerType[] =>
	listScheduleItems(domia.id, ACTIVE_STATUSES)
		.filter((row) => kindOf(row) === kind && visibleFrom(row, origin))
		.map((row) => toTimer(row, kind))
		.sort((a, b) => a.dueAt.localeCompare(b.dueAt))

const mirrorTimerEvent = (
	domiaKey: string,
	satelliteId: string | null,
	event: SatelliteTimerEventType,
): void => {
	if (!satelliteId) return
	const control = getSatelliteControl(domiaKey, satelliteId)
	if (!control?.sendTimerEvent) return
	try {
		control.sendTimerEvent(event)
	} catch (err) {
		skillEngineLogger.warn("satellite timer mirror failed", {
			domiaKey,
			satelliteId,
			eventType: event.eventType,
			err,
		})
	}
}

const timerEvent = (
	timer: SkillRuntimeTimerType,
	eventType: SatelliteTimerEventType["eventType"],
	totalSeconds: number,
): SatelliteTimerEventType => ({
	eventType,
	timerId: timer.id,
	name: timer.label,
	totalSeconds,
	secondsLeft: eventType === "finished" ? 0 : remainingOf(timer.dueAt),
	isActive: eventType === "started",
})

const satelliteNameOf = async (
	domia: DomiaType,
	satelliteId: string,
): Promise<string | null> => {
	const rows = await getSatellitesForDomia(domia.id).catch((err: unknown) => {
		skillEngineLogger.warn("satellite name lookup failed", {
			domiaId: domia.id,
			satelliteId,
			err,
		})
		return []
	})
	return rows.find((s) => s.satelliteId === satelliteId)?.name ?? null
}

const currentVolume = (
	domia: DomiaType,
	origin: OriginCapabilitiesType,
): number | null => {
	if (!origin.satelliteId)
		return origin.localPlayback
			? (domia.audioPlaybackConfig?.volume ?? DEFAULT_AUDIO_PLAYBACK_VOLUME)
			: null
	const media = getExternalMediaControls(
		externalMediaKey(domia.domiaKey, origin.satelliteId),
	)
	const fromMedia = media?.getVolume() ?? null
	if (fromMedia !== null) return fromMedia
	const satellite = getPresence(domia.domiaKey)?.satellites.find(
		(s) => s.satelliteId === origin.satelliteId,
	)
	return satellite?.volume == null
		? null
		: clampVolumePercent(satellite.volume * VOLUME_PERCENT_SCALE)
}

const applyVolume = async (
	domia: DomiaType,
	origin: OriginCapabilitiesType,
	level: number,
): Promise<number | null> => {
	const target = clampVolumePercent(level)
	if (!origin.satelliteId)
		return origin.localPlayback ? setPlaybackVolume(domia, target) : null
	const media = getExternalMediaControls(
		externalMediaKey(domia.domiaKey, origin.satelliteId),
	)
	if (media) {
		await media.setVolume(target)
		return target
	}
	const control = getSatelliteControl(domia.domiaKey, origin.satelliteId)
	if (!control?.setVolume) return null
	control.setVolume(target / VOLUME_PERCENT_SCALE)
	return target
}

const port: SkillRuntimePortType = {
	domiaOf,
	originCapabilities,
	announceTarget,
	timers: {
		start: async ({
			domia,
			origin,
			seconds,
			label,
			kind,
			text,
			dueAt,
			repeatDailyAt,
			templateParams,
		}) => {
			const destination = announceTargetFor(domia.domiaKey, origin)
			const dueAtMs = dueAt ? Date.parse(dueAt) : Date.now() + seconds * 1000
			const row = createScheduleItem(domia.id, {
				name: label,
				text: null,
				templateKey: TEMPLATE_BY_KIND[kind],
				templateParams: {
					...(templateParams ?? {}),
					label,
					text: text ?? label,
					totalSeconds: String(Math.round((dueAtMs - Date.now()) / 1000)),
				},
				verb: PROACTIVE_VERB_ENUM.ANNOUNCE,
				importance: PROACTIVE_IMPORTANCE_ENUM.CRITICAL,
				targetKind:
					destination.kind === "satellite"
						? PROACTIVE_TARGET_KIND_ENUM.SATELLITE
						: destination.kind === "local"
							? PROACTIVE_TARGET_KIND_ENUM.LOCAL
							: PROACTIVE_TARGET_KIND_ENUM.AUTO,
				targetSatelliteId:
					destination.kind === "satellite" ? destination.satelliteId : null,
				dueAt: new Date(dueAtMs).toISOString(),
				personId: null,
				actionTool: null,
				actionArgs: null,
				repeatEveryMs: null,
				repeatDailyAt: repeatDailyAt ?? null,
			})
			wakeScheduleAt(domia.domiaKey, dueAtMs)
			const timer = toTimer(row, kind)
			if (kind === "timer" && origin.timerNative)
				mirrorTimerEvent(
					domia.domiaKey,
					origin.satelliteId,
					timerEvent(timer, "started", seconds),
				)
			return {
				timer,
				destination,
				destinationName:
					destination.kind === "satellite"
						? await satelliteNameOf(domia, destination.satelliteId)
						: null,
			}
		},
		cancel: (domia, origin, kind) => {
			const cancelled: SkillRuntimeTimerType[] = []
			for (const timer of activeTimers(domia, origin, kind)) {
				const row = cancelScheduleItem(domia.id, timer.id)
				if (!row) continue
				cancelled.push(timer)
				if (kind === "timer" && origin.timerNative)
					mirrorTimerEvent(
						domia.domiaKey,
						origin.satelliteId,
						timerEvent(timer, "cancelled", timer.remainingSeconds),
					)
			}
			return Promise.resolve(cancelled)
		},
		list: (domia, origin, kind) =>
			Promise.resolve(activeTimers(domia, origin, kind)),
		remaining: (timer) => remainingOf(timer.dueAt),
	},
	schedule: {
		create: ({
			domia,
			origin,
			name,
			text,
			templateKey,
			templateParams,
			dueAt,
			importance,
			repeatDailyAt,
		}) => {
			const destination = announceTargetFor(domia.domiaKey, origin)
			const row = createScheduleItem(domia.id, {
				name,
				text,
				templateKey,
				templateParams,
				verb: PROACTIVE_VERB_ENUM.ANNOUNCE,
				importance,
				targetKind:
					destination.kind === "satellite"
						? PROACTIVE_TARGET_KIND_ENUM.SATELLITE
						: PROACTIVE_TARGET_KIND_ENUM.AUTO,
				targetSatelliteId:
					destination.kind === "satellite" ? destination.satelliteId : null,
				dueAt,
				personId: null,
				actionTool: null,
				actionArgs: null,
				repeatEveryMs: null,
				repeatDailyAt: repeatDailyAt ?? null,
			})
			wakeScheduleAt(domia.domiaKey, Date.parse(dueAt))
			return Promise.resolve(row)
		},
		cancel: (domia, id) => Promise.resolve(cancelScheduleItem(domia.id, id)),
		list: (domia) =>
			Promise.resolve(listScheduleItems(domia.id, ACTIVE_STATUSES)),
		wakeAt: (domia, atMs) => wakeScheduleAt(domia.domiaKey, atMs),
	},
	lastReply: async (domia, excludeInteractionId) => {
		const turns = await getRecentTurns(domia, excludeInteractionId ?? undefined)
		const last = turns.at(-1)
		return last?.domiaText ?? null
	},
	volume: {
		get: (domia, origin) => Promise.resolve(currentVolume(domia, origin)),
		set: (domia, origin, level) => applyVolume(domia, origin, level),
	},
	facts: {
		upsert: async (
			domia,
			{ subject, relation, value, evidenceInteractionId },
		) => {
			const result = await upsertFacts(
				domia,
				[{ subject, relation, value }],
				evidenceInteractionId ?? undefined,
			)
			return {
				written: result.stored + result.corroborated > 0,
				reason: result.rejected[0] ?? null,
			}
		},
		expire: (domia, what) => expireFactsMatching(domia, what),
	},
	memory: {
		markReflectionCaptured,
	},
}

let installed = false

export const installSkillRuntimePort = (domia: DomiaType): void => {
	domiaKeys.set(domia.id, domia.domiaKey)
	if (installed) return
	installed = true
	setSkillRuntimePort(port)
	onScheduleDelivered(({ domia, item, satelliteId }) => {
		const kind = kindOf(item)
		if (kind !== "timer") return
		mirrorTimerEvent(
			domia.domiaKey,
			satelliteId ?? item.targetSatelliteId,
			timerEvent(toTimer(item, kind), "finished", 0),
		)
	})
}
