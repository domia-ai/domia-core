import type { FastPathBlockType } from "@/db"
import type { LanguageCatalogExtensionType } from "@/utils"

import { loadFastPathPack } from "../../../utils/descriptor-data"
import enPack from "../descriptors/en.json"
import esPack from "../descriptors/es.json"

export const HA_SPECIALIZATION_KIND = "home-assistant"

export const HA_DATA_PLANE_ENUM = {
	WS: "ws",
	POLL: "poll",
} as const
export const HA_DATA_PLANE_ENUM_VALUES = [
	HA_DATA_PLANE_ENUM.WS,
	HA_DATA_PLANE_ENUM.POLL,
] as const
export const DEFAULT_HA_DATA_PLANE = HA_DATA_PLANE_ENUM.POLL
export const DEFAULT_HA_WS_PATH = "/api/websocket"
export const DEFAULT_HA_WS_HANDSHAKE_TIMEOUT_MS = 10_000
export const DEFAULT_HA_WS_AUTH_TIMEOUT_MS = 10_000
export const DEFAULT_HA_WS_COMMAND_TIMEOUT_MS = 10_000
export const DEFAULT_HA_WS_HEARTBEAT_INTERVAL_MS = 30_000
export const DEFAULT_HA_WS_HEARTBEAT_TIMEOUT_MS = 10_000
export const DEFAULT_HA_WS_RECONNECT_MS = 1_000
export const DEFAULT_HA_WS_RECONNECT_MAX_MS = 60_000
export const DEFAULT_HA_WS_RECONNECT_JITTER = 0.3
export const DEFAULT_HA_WS_MAX_ENTITIES = 5_000

export const HA_CONTEXT_TTL_MS = 5 * 60 * 1000
export const HA_CONTEXT_TOOL = "GetLiveContext"
export const HA_NAME_MATCH_MIN = 0.5
export const HA_FULL_COVERAGE_SCORE = 0.75

export const HA_CORE_RE =
	/turn.?on|turn.?off|light.?set|set.?temp|climate|cover|hass(turnon|turnoff|lightset)/i
export const HA_PLACEHOLDER_RE = /^(\[\]|\{\}|null|none|n\/a|undefined)$/i
export const HA_FAST_PATH_EXCLUDED_DOMAINS = new Set([
	"lock",
	"alarm_control_panel",
	"siren",
])

export const HA_BUILTIN_SHADOWED_TOOLS = new Set([
	"GetDateTime",
	"HassCancelAllTimers",
	"HassBroadcast",
])

export const HA_SENSITIVE_TOOL_RE =
	/lock|unlock|cover|garage|alarm|siren|broadcast/i
export const HA_SENSITIVE_DOMAIN_RE = /^(lock|alarm_control_panel|cover|siren)$/
export const HA_READ_TOOL_RE =
	/getlivecontext|getstate|get_state|getdatetime|get_date_time|gettime|query|status/i

export const HA_EXPLICIT_TARGET_ARGS = ["name", "area", "floor", "device_class"]
export const HA_ARG_DOMAIN = "domain"

export const HA_ALIASES: Record<string, string[]> = {
	brighter: ["brightness", "light", "bright"],
	dimmer: ["dim", "light", "brightness"],
	dim: ["light", "brightness"],
	lights: ["light"],
	lamp: ["light"],
	warmer: ["temperature", "warm", "heat", "climate"],
	cooler: ["temperature", "cool", "climate"],
	colder: ["temperature", "cold", "climate"],
	degrees: ["temperature", "climate"],
	thermostat: ["temperature", "climate"],
	ac: ["climate", "temperature", "cool"],
	heating: ["climate", "temperature", "heat"],
	blinds: ["cover"],
	curtains: ["cover"],
	shades: ["cover"],
	shutters: ["cover"],
}

export const HA_ACTION_VERBS: Record<string, Record<string, string>> = {
	en: {
		HassTurnOn: "turn on",
		HassTurnOff: "turn off",
		HassLightSet: "adjust",
		HassSetPosition: "set the position of",
		HassClimateSetTemperature: "set the temperature of",
		HassLockDoor: "lock",
		HassUnlockDoor: "unlock",
	},
	es: {
		HassTurnOn: "encender",
		HassTurnOff: "apagar",
		HassLightSet: "ajustar",
		HassSetPosition: "ajustar la posición de",
		HassClimateSetTemperature: "ajustar la temperatura de",
		HassLockDoor: "cerrar con llave",
		HassUnlockDoor: "abrir",
	},
}

export const HA_CATALOG_EXTENSIONS: Record<
	string,
	LanguageCatalogExtensionType
> = {
	en: {
		genericWords: [
			"light",
			"lights",
			"lamp",
			"lamps",
			"switch",
			"sensor",
			"cover",
			"the",
			"in",
			"on",
			"of",
		],
		anaphoraRewrites: [
			{
				pattern: "^(?:please )?(?:turn|switch) it (on|off)$",
				template: "turn {entity} $1",
			},
			{
				pattern: "^(?:please )?(?:turn|switch) it back (on|off)$",
				template: "turn {entity} $1",
			},
		],
		phrases: {
			turnedOn: "Done, I turned on {name}.",
			turnedOff: "Done, I turned off {name}.",
			adjusted: "Got it, I adjusted {name}.",
		},
	},
	es: {
		genericWords: [
			"luz",
			"luces",
			"lampara",
			"lamparas",
			"interruptor",
			"foco",
			"focos",
		],
		anaphoraRewrites: [
			{
				pattern: "^(?:apágala|apágalo|apagala|apagalo)$",
				template: "apaga {entity}",
			},
			{
				pattern:
					"^(?:enciéndela|enciéndelo|enciendela|enciendelo|préndela|préndelo|prendela|prendelo)$",
				template: "enciende {entity}",
			},
		],
		phrases: {
			turnedOn: "Listo, encendí {name}.",
			turnedOff: "Listo, apagué {name}.",
			adjusted: "Hecho, ajusté {name}.",
		},
	},
}

export const HA_FAST_PATH_PACKS: Record<string, FastPathBlockType> = {
	en: loadFastPathPack(enPack),
	es: loadFastPathPack(esPack),
}

export const HA_FAST_PATH_ENTITY_KEY = "entity"
export const HA_FAST_PATH_AREA_KEY = "area"
export const HA_FAST_PATH_FLOOR_KEY = "floor"
export const HA_FAST_PATH_SLOT_KEYS = [
	HA_FAST_PATH_ENTITY_KEY,
	HA_FAST_PATH_AREA_KEY,
	HA_FAST_PATH_FLOOR_KEY,
]
export const HA_FAST_PATH_ENTITY_KEY_PREFIX = `${HA_FAST_PATH_ENTITY_KEY}:`
export const HA_FAST_PATH_ENTITY_DOMAIN_SEPARATOR = ","
export const HA_FAST_PATH_NAME_GROUPS: Record<string, string[]> = {
	default: ["light", "switch", "fan", "input_boolean", "climate"],
}

export const HA_EXAMPLE_UTTERANCES: Record<string, string[]> = {
	en: [
		"turn on the kitchen light",
		"turn off the bedroom light",
		"switch on the living room lamp",
		"set the light to fifty percent",
		"dim the living room light",
		"brighten the kitchen",
		"turn everything off",
		"is the kitchen light on?",
		"which lights are on right now?",
		"I need the light on",
		"make the room brighter",
		"switch off the hallway light",
	],
	es: [
		"enciende la luz de la cocina",
		"apaga la luz del dormitorio",
		"prende la lámpara de la sala",
		"pon la luz al cincuenta por ciento",
		"baja el brillo de la sala",
		"sube el brillo de la cocina",
		"desconecta la luz del pasillo",
		"apaga todas las luces",
		"¿está encendida la luz de la cocina?",
		"¿cuáles luces están encendidas?",
		"necesito la luz encendida",
		"pon más brillante la habitación",
	],
}

export const HA_MDNS_SERVICE_TYPE = "home-assistant"
export const HA_MCP_PATH = "/api/mcp"
