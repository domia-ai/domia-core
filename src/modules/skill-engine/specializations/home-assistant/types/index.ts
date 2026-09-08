import type { SkillConnHandleType } from "../../../types"

export type HaEntityType = {
	names: string[]
	domain: string
	area: string | null
	entityId?: string
	state?: string | null
	lastChanged?: string | null
}

export type HaContextSourceType = "ws" | "poll"

export type HaContextCacheType = {
	entities: HaEntityType[]
	areas: Set<string>
	fetchedAt: number
	handle: SkillConnHandleType
	source?: HaContextSourceType
	foldedByName?: Map<string, HaEntityType>
}

export type HaWsStateType =
	| "idle"
	| "connecting"
	| "authenticating"
	| "syncing"
	| "live"
	| "backoff"
	| "closed"

export type HaLiveEntityType = {
	entityId: string
	state: string | null
	friendlyName: string | null
	names: string[]
	domain: string
	area: string | null
	lastChanged: string | null
}

export type HaRegistryEntityType = {
	entityId: string
	name: string | null
	originalName: string | null
	aliases: string[]
	areaId: string | null
	deviceId: string | null
	disabled: boolean
	hidden: boolean
}

export type HaRegistryAreaType = {
	areaId: string
	name: string
}

export type HaRegistryDeviceType = {
	deviceId: string
	areaId: string | null
}

export type HaStateObjectType = {
	entity_id: string
	state?: string | null
	attributes?: Record<string, unknown>
	last_changed?: string | null
}

export type HaWsMessageType = {
	id?: number
	type?: string
	success?: boolean
	result?: unknown
	error?: unknown
	message?: string
	event?: {
		event_type?: string
		data?: {
			entity_id?: string
			new_state?: HaStateObjectType | null
		}
	}
}

export type HaWsSnapshotType = {
	states: HaStateObjectType[]
	entityRegistry: HaRegistryEntityType[]
	areaRegistry: HaRegistryAreaType[]
	deviceRegistry: HaRegistryDeviceType[]
	exposedEntityIds: Set<string> | null
}

export type HaWsClientOptionsType = {
	wsUrl: string
	token: string
	onSync: (snapshot: HaWsSnapshotType) => void
	onEvent: (entityId: string, newState: HaStateObjectType | null) => void
	onStatus: (state: HaWsStateType, reason?: string) => void
}

export type HaWsClientType = {
	connect: () => void
	close: () => void
	state: () => HaWsStateType
}

export type HaDestinationType = {
	key: string
	wsUrl: string
	client: HaWsClientType
	attachedProviderIds: Set<string>
	entities: Map<string, HaLiveEntityType>
	areasById: Map<string, string>
	devicesById: Map<string, string | null>
	registryByEntityId: Map<string, HaRegistryEntityType>
	exposedEntityIds: Set<string> | null
	live: boolean
	dirty: boolean
	snapshot: HaContextCacheType | null
	overflowWarned: boolean
}

export type HaDataPlaneType = "ws" | "poll"

export type HaDataPlaneConfigType = {
	dataPlane: HaDataPlaneType
	wsUrl: string | null
}

export type HaFastPathLanguagePackType = {
	turnOnTemplates: string[]
	turnOnAreaTemplates: string[]
	turnOnKeywords: string[][]
	turnOffTemplates: string[]
	turnOffAreaTemplates: string[]
	turnOffKeywords: string[][]
	lightSetTemplates: string[]
	expansionRules: Record<string, string>
}

export type PendingCommandType = {
	resolve: (result: unknown) => void
	reject: (err: Error) => void
	timer: ReturnType<typeof setTimeout>
}
