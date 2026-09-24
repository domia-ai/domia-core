import { randomUUID } from "node:crypto"

import type { SelectSkillProviderType, SkillToolType } from "@/db"

import type { HaMcpPropertyType, HaMcpToolSpecType } from "../types"

const STRING: HaMcpPropertyType = { type: "string" }
const NUMBER: HaMcpPropertyType = { type: "number" }
const STRINGS: HaMcpPropertyType = { type: "array", items: { type: "string" } }

const TARGET: Record<string, HaMcpPropertyType> = {
	name: STRING,
	area: STRING,
	floor: STRING,
}

const TARGET_WITH_DOMAIN: Record<string, HaMcpPropertyType> = {
	...TARGET,
	domain: STRINGS,
	device_class: STRINGS,
}

export const HA_MCP_TOOLS: HaMcpToolSpecType[] = [
	{
		rawName: "GetLiveContext",
		domain: "homeassistant",
		description:
			"Provides real-time information about the CURRENT state, value, or mode of devices, sensors, entities, or areas.",
		properties: {},
	},
	{
		rawName: "GetDateTime",
		domain: "llm",
		description: "Returns the current date and time in the user's timezone.",
		properties: {},
	},
	{
		rawName: "HassTurnOn",
		domain: "intent",
		description:
			"Turns on/opens/presses a device or entity. Use for requests like 'turn on', 'activate', 'enable'.",
		properties: TARGET_WITH_DOMAIN,
	},
	{
		rawName: "HassTurnOff",
		domain: "intent",
		description:
			"Turns off/closes a device or entity. Use for requests like 'turn off', 'deactivate', 'disable'.",
		properties: TARGET_WITH_DOMAIN,
	},
	{
		rawName: "HassSetPosition",
		domain: "intent",
		description: "Sets the position of a device or entity, such as a cover.",
		properties: { ...TARGET_WITH_DOMAIN, position: NUMBER },
	},
	{
		rawName: "HassStopMoving",
		domain: "intent",
		description: "Stops a moving device or entity, such as a cover or valve.",
		properties: TARGET_WITH_DOMAIN,
	},
	{
		rawName: "HassCancelAllTimers",
		domain: "intent",
		description: "Cancels all timers, optionally in an area.",
		properties: { area: STRING },
	},
	{
		rawName: "HassLightSet",
		domain: "light",
		description: "Sets the brightness percentage or color of a light",
		properties: {
			domain: STRINGS,
			...TARGET,
			brightness: NUMBER,
			color: STRING,
			temperature: NUMBER,
		},
	},
	{
		rawName: "HassClimateSetTemperature",
		domain: "climate",
		description: "Sets the target temperature of a climate device.",
		properties: { ...TARGET, temperature: NUMBER },
	},
	{
		rawName: "HassClimateGetTemperature",
		domain: "climate",
		description: "Gets the current temperature of a climate device or area.",
		properties: TARGET,
	},
	{
		rawName: "HassClimateSetFanMode",
		domain: "climate",
		description: "Sets the fan mode of a climate device.",
		properties: { ...TARGET, fan_mode: STRING },
	},
	{
		rawName: "HassFanSetSpeed",
		domain: "fan",
		description: "Sets the speed percentage of a fan.",
		properties: { ...TARGET, percentage: NUMBER },
	},
	{
		rawName: "HassHumidifierSetpoint",
		domain: "humidifier",
		description: "Sets the target humidity of a humidifier.",
		properties: { ...TARGET, humidity: NUMBER },
	},
	{
		rawName: "HassHumidifierMode",
		domain: "humidifier",
		description: "Sets the mode of a humidifier.",
		properties: { ...TARGET, mode: STRING },
	},
	{
		rawName: "HassVacuumStart",
		domain: "vacuum",
		description: "Starts a vacuum cleaner.",
		properties: TARGET,
	},
	{
		rawName: "HassVacuumReturnToBase",
		domain: "vacuum",
		description: "Returns a vacuum cleaner to its base.",
		properties: { name: STRING, area: STRING },
	},
	{
		rawName: "HassVacuumCleanArea",
		domain: "vacuum",
		description: "Makes a vacuum cleaner clean a specific area.",
		properties: { name: STRING, area: STRING },
	},
	{
		rawName: "HassLawnMowerStartMowing",
		domain: "lawn_mower",
		description: "Starts mowing with a lawn mower.",
		properties: { name: STRING },
	},
	{
		rawName: "HassLawnMowerDock",
		domain: "lawn_mower",
		description: "Docks a lawn mower.",
		properties: { name: STRING },
	},
	{
		rawName: "HassListAddItem",
		domain: "todo",
		description: "Adds an item to a to-do list.",
		properties: { item: STRING, name: STRING },
	},
	{
		rawName: "HassListCompleteItem",
		domain: "todo",
		description: "Marks an item on a to-do list as completed.",
		properties: { item: STRING, name: STRING },
	},
	{
		rawName: "HassListRemoveItem",
		domain: "todo",
		description: "Removes an item from a to-do list.",
		properties: { item: STRING, name: STRING },
	},
]

const HA_PROVIDER_NAME = "home-assistant"

export const haToolsCacheOf = (tools: HaMcpToolSpecType[]): SkillToolType[] =>
	tools.map((t) => ({
		provider: HA_PROVIDER_NAME,
		rawName: t.rawName,
		namespacedName: `${HA_PROVIDER_NAME}__${t.rawName}`,
		inputSchema: { type: "object", properties: t.properties },
	}))

export const haProviderRow = (
	url: string,
	domiaId: string,
	tools: HaMcpToolSpecType[],
): SelectSkillProviderType => ({
	id: randomUUID(),
	name: HA_PROVIDER_NAME,
	isActive: true,
	domiaId,
	protocol: "mcp",
	type: "http",
	url,
	description: null,
	config: null,
	descriptor: { version: 1, kind: HA_PROVIDER_NAME },
	serverDescriptor: null,
	serverDescriptorHash: null,
	auth: null,
	toolsCache: haToolsCacheOf(tools),
	toolWhitelist: null,
	lastSyncAt: null,
	maxResultChars: 4000,
	timeout: 3000,
	toolsRefreshMs: 300_000,
	priority: 0,
	trustTier: "trusted",
	createdAt: "",
	updatedAt: "",
})
