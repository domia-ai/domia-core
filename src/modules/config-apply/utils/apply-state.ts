import { now } from "@/utils"

import type {
	ApplyStateType,
	ConfigApplyStateType,
	ReloadSubsystemType,
	SubsystemRevisionStateType,
} from "../types"

type EntryType = SubsystemRevisionStateType & { domiaKey: string }

const entryKey = (domiaKey: string, subsystem: ReloadSubsystemType): string =>
	`${domiaKey}:${subsystem}`

export const createApplyState = (): ApplyStateType => {
	const entries = new Map<string, EntryType>()

	const entryFor = (
		domiaKey: string,
		subsystem: ReloadSubsystemType,
	): EntryType => {
		const key = entryKey(domiaKey, subsystem)
		const existing = entries.get(key)
		if (existing) return existing
		const created: EntryType = {
			domiaKey,
			subsystem,
			desiredRevision: 0,
			runningRevision: 0,
			inSync: true,
			lastError: null,
			lastErrorAt: null,
		}
		entries.set(key, created)
		return created
	}

	const sync = (entry: EntryType): void => {
		entry.inSync = entry.runningRevision >= entry.desiredRevision
	}

	const listFor = (domiaKey: string): EntryType[] =>
		[...entries.values()].filter((e) => e.domiaKey === domiaKey)

	return {
		markDesired: (domiaKey, subsystem, revision) => {
			const entry = entryFor(domiaKey, subsystem)
			entry.desiredRevision = Math.max(entry.desiredRevision, revision)
			sync(entry)
		},
		markRunning: (domiaKey, subsystem, revision) => {
			const entry = entryFor(domiaKey, subsystem)
			entry.runningRevision = revision
			entry.desiredRevision = Math.max(entry.desiredRevision, revision)
			entry.lastError = null
			entry.lastErrorAt = null
			sync(entry)
		},
		markFailed: (domiaKey, subsystem, revision, error) => {
			const entry = entryFor(domiaKey, subsystem)
			entry.desiredRevision = Math.max(entry.desiredRevision, revision)
			entry.lastError = error
			entry.lastErrorAt = now()
			sync(entry)
		},
		markReverted: (domiaKey, subsystem, revision) => {
			const entry = entryFor(domiaKey, subsystem)
			entry.runningRevision = revision
			entry.desiredRevision = revision
			sync(entry)
		},
		runningRevision: (domiaKey, subsystem) =>
			entryFor(domiaKey, subsystem).runningRevision,
		pending: (domiaKey) =>
			listFor(domiaKey)
				.filter((e) => !e.inSync)
				.map((e) => e.subsystem),
		snapshot: (domiaKey): ConfigApplyStateType => {
			const list = listFor(domiaKey)
			return {
				domiaKey,
				inSync: list.every((e) => e.inSync),
				pending: list.filter((e) => !e.inSync).map((e) => e.subsystem),
				subsystems: list.map((e) => ({
					subsystem: e.subsystem,
					desiredRevision: e.desiredRevision,
					runningRevision: e.runningRevision,
					inSync: e.inSync,
					lastError: e.lastError,
					lastErrorAt: e.lastErrorAt,
				})),
			}
		},
	}
}
