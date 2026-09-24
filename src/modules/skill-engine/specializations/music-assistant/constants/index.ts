import type {
	ArgNormalizeMapType,
	FastPathBlockType,
	ToolHintOverrideType,
} from "@/db"
import type { LanguageCatalogExtensionType } from "@/utils"

import { loadFastPathPack } from "../../../utils/descriptor-data"
import enPack from "../descriptors/en.json"
import esPack from "../descriptors/es.json"

export const MA_SPECIALIZATION_KIND = "music-assistant"

export const MA_TOOL_PLAY_MEDIA = "playback_play_media"
export const MA_TOOL_ACTIVE_QUEUE = "queue_get_active_queue"
export const MA_TOOL_PAUSE = "playback_pause"
export const MA_TOOL_RESUME = "playback_resume"
export const MA_TOOL_NEXT = "playback_next_track"
export const MA_TOOL_PREVIOUS = "playback_previous_track"
export const MA_TOOL_VOLUME_SET = "volume_volume_set"
export const MA_TOOL_VOLUME_UP = "volume_volume_up"
export const MA_TOOL_VOLUME_DOWN = "volume_volume_down"
export const MA_TOOL_VOLUME_MUTE = "volume_volume_mute"
export const MA_TOOL_LIST_PLAYERS = "players_list_players"
export const MA_TOOL_SEARCH_ARTISTS = "library_search_artists"
export const MA_TOOL_SEARCH_ALBUMS = "library_search_albums"
export const MA_TOOL_SEARCH_TRACKS = "library_search_tracks"

export const MA_TOOL_MUSIC_PLAY = "music_play"
export const MA_TOOL_NOW_PLAYING = "music_now_playing"

export const MA_VIRTUAL_TOOLS = [MA_TOOL_MUSIC_PLAY, MA_TOOL_NOW_PLAYING]

export const MA_VOLUME_TOOLS = [
	MA_TOOL_VOLUME_SET,
	MA_TOOL_VOLUME_UP,
	MA_TOOL_VOLUME_DOWN,
	MA_TOOL_VOLUME_MUTE,
]

export const MA_DEFAULT_TOOL_WHITELIST = [
	MA_TOOL_PAUSE,
	MA_TOOL_RESUME,
	MA_TOOL_NEXT,
	MA_TOOL_PREVIOUS,
	MA_TOOL_VOLUME_SET,
	MA_TOOL_VOLUME_UP,
	MA_TOOL_VOLUME_DOWN,
	MA_TOOL_VOLUME_MUTE,
]

export const MA_SEARCH_TOOLS = [
	MA_TOOL_SEARCH_ARTISTS,
	MA_TOOL_SEARCH_ALBUMS,
	MA_TOOL_SEARCH_TRACKS,
]

export const MA_READ_TOOLS = [MA_TOOL_LIST_PLAYERS, ...MA_SEARCH_TOOLS]

export const MA_ARG_PLAYER = "player"
export const MA_ARG_PLAYER_ID = "player_id"
export const MA_ARG_QUEUE_ID = "queue_id"
export const MA_ARG_QUERY = "query"
export const MA_ARG_LEVEL = "level"
export const MA_ARG_MUTED = "muted"
export const MA_ARG_URI = "uri"
export const MA_ARG_RADIO = "radio"
export const MA_ARG_LIMIT = "limit"
export const MA_ARG_INCLUDE_ITEMS = "include_items"

export const MA_TEXT_ARGS = [MA_ARG_QUERY, MA_ARG_PLAYER]

export const MA_QUEUE_ARG_TOOLS = [
	MA_TOOL_PLAY_MEDIA,
	MA_TOOL_PAUSE,
	MA_TOOL_RESUME,
	MA_TOOL_NEXT,
	MA_TOOL_PREVIOUS,
]

export const MA_SLOT_PLAYER = "player"
export const MA_SLOT_PLAYER_QUEUE = "playerQueue"
export const MA_SLOT_LEVEL = "level"

export const DEFAULT_MA_ROSTER_TTL_MS = 60_000
export const DEFAULT_MA_SEARCH_LIMIT = 5
export const DEFAULT_MA_VOLUME_STEP_PERCENT = 10
export const MA_PLAY_TIMEOUT_MS = 12_000
export const MA_NAME_MATCH_MIN = 0.55
export const MA_FULL_COVERAGE_SCORE = 0.8
export const MA_VOLUME_MIN = 0
export const MA_VOLUME_MAX = 100
export const MA_NOW_PLAYING_QUEUE_ITEMS = 3

export const MA_PLACEHOLDER_RE = /^(\[\]|\{\}|null|none|n\/a|undefined)$/i
export const MA_PLAYER_NAME_MAX_WORDS = 6
export const MA_PLAYER_NAME_REJECT_RE = /[[\]{}()<>:;|·\n]/

const READ_HINTS: ToolHintOverrideType = {
	readOnlyHint: true,
	openWorldHint: false,
}

const WRITE_HINTS: ToolHintOverrideType = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
}

export const MA_TOOL_HINTS: Record<string, ToolHintOverrideType> = {
	...Object.fromEntries(MA_READ_TOOLS.map((tool) => [tool, READ_HINTS])),
	[MA_TOOL_NOW_PLAYING]: READ_HINTS,
	...Object.fromEntries(
		MA_DEFAULT_TOOL_WHITELIST.map((tool) => [tool, WRITE_HINTS]),
	),
	[MA_TOOL_PLAY_MEDIA]: WRITE_HINTS,
	[MA_TOOL_MUSIC_PLAY]: { ...WRITE_HINTS, timeoutMs: MA_PLAY_TIMEOUT_MS },
}

export const MA_PARAM_ALLOW: Record<string, string[]> = {
	[MA_TOOL_PAUSE]: [],
	[MA_TOOL_RESUME]: [],
	[MA_TOOL_NEXT]: [],
	[MA_TOOL_PREVIOUS]: [],
	[MA_TOOL_VOLUME_UP]: [],
	[MA_TOOL_VOLUME_DOWN]: [],
	[MA_TOOL_VOLUME_SET]: [MA_ARG_LEVEL],
	[MA_TOOL_VOLUME_MUTE]: [MA_ARG_MUTED],
}

export const MA_ARG_NORMALIZE: ArgNormalizeMapType = {
	[MA_TOOL_VOLUME_SET]: { [MA_ARG_LEVEL]: ["stripUnits", "integer"] },
	[MA_TOOL_MUSIC_PLAY]: { [MA_ARG_QUERY]: ["trim", "collapseSpaces"] },
}

export const MA_ALIASES: Record<string, string[]> = {
	music: ["play", "song", "track", "album", "artist"],
	song: ["music", "track", "play"],
	track: ["song", "music"],
	album: ["music", "play"],
	artist: ["music", "play", "band"],
	band: ["artist", "music"],
	playlist: ["music", "play"],
	speaker: ["player", "music"],
	speakers: ["player", "music"],
	volume: ["louder", "quieter", "mute"],
	louder: ["volume"],
	quieter: ["volume"],
	skip: ["next", "song"],
	unmute: ["mute", "volume"],
	radio: ["music", "play"],
}

export const MA_KEYWORDS: Record<string, string[]> = {
	en: [
		"music",
		"song",
		"track",
		"album",
		"artist",
		"playlist",
		"volume",
		"speaker",
		"now playing",
		"play some",
		"skip the song",
		"turn the music",
	],
	es: [
		"música",
		"canción",
		"disco",
		"volumen",
		"bocina",
		"altavoz",
		"suena",
		"pon música",
		"sube el volumen",
	],
}

export const MA_ACTION_VERBS: Record<string, Record<string, string>> = {
	en: {
		[MA_TOOL_MUSIC_PLAY]: "play music on",
		[MA_TOOL_NOW_PLAYING]: "check what is playing on",
		[MA_TOOL_PAUSE]: "pause the music on",
		[MA_TOOL_RESUME]: "resume the music on",
		[MA_TOOL_NEXT]: "skip the song on",
		[MA_TOOL_PREVIOUS]: "go back a song on",
		[MA_TOOL_VOLUME_SET]: "set the volume of",
		[MA_TOOL_VOLUME_UP]: "turn up",
		[MA_TOOL_VOLUME_DOWN]: "turn down",
		[MA_TOOL_VOLUME_MUTE]: "mute",
	},
	es: {
		[MA_TOOL_MUSIC_PLAY]: "poner música en",
		[MA_TOOL_NOW_PLAYING]: "ver qué suena en",
		[MA_TOOL_PAUSE]: "pausar la música en",
		[MA_TOOL_RESUME]: "reanudar la música en",
		[MA_TOOL_NEXT]: "saltar la canción en",
		[MA_TOOL_PREVIOUS]: "volver una canción en",
		[MA_TOOL_VOLUME_SET]: "ajustar el volumen de",
		[MA_TOOL_VOLUME_UP]: "subir el volumen de",
		[MA_TOOL_VOLUME_DOWN]: "bajar el volumen de",
		[MA_TOOL_VOLUME_MUTE]: "silenciar",
	},
}

export const MA_CATALOG_EXTENSIONS: Record<
	string,
	LanguageCatalogExtensionType
> = {
	en: {
		genericWords: [
			"music",
			"song",
			"songs",
			"track",
			"playback",
			"speaker",
			"speakers",
			"player",
			"volume",
		],
		anaphoraRewrites: [
			{
				pattern: "^(?:please )?(?:turn|switch) it off$",
				template: "pause the music on {entity}",
			},
			{
				pattern: "^(?:please )?(?:stop|pause) it$",
				template: "pause the music on {entity}",
			},
			{
				pattern: "^(?:please )?turn it (?:up|louder)$",
				template: "turn the volume up on {entity}",
			},
			{
				pattern: "^(?:please )?turn it (?:down|quieter|lower)$",
				template: "turn the volume down on {entity}",
			},
			{
				pattern: "^(?:please )?(?:skip it|next)$",
				template: "next song on {entity}",
			},
		],
		phrases: {
			musicPlaying: "Playing {what} on {player}.",
			musicNowPlaying: "{what} is playing on {player}.",
			musicNothingPlaying: "Nothing is playing right now.",
			musicNotFound: "I couldn't find {query} in your music.",
			musicWhichSpeaker: "Which speaker should I play that on?",
			musicWhichMusic: "What would you like me to play?",
			musicPlayerUnavailable: "{player} is not available right now.",
			musicPaused: "Music paused.",
			musicResumed: "Music is back on.",
			musicSkipped: "Skipped to the next song.",
			musicPrevious: "Going back a song.",
			musicVolumeSet: "Volume set to {level}.",
			musicVolumeChanged: "Volume on {player} is now {level}.",
			musicVolumeFailed: "Could not change the volume on {player}.",
			musicVolumeUp: "Turning it up.",
			musicVolumeDown: "Turning it down.",
			musicMuted: "Muted.",
			musicUnmuted: "Unmuted.",
		},
	},
	es: {
		genericWords: [
			"musica",
			"cancion",
			"canciones",
			"tema",
			"reproduccion",
			"bocina",
			"bocinas",
			"altavoz",
			"altavoces",
			"volumen",
		],
		anaphoraRewrites: [
			{
				pattern:
					"^(?:apágalo|apágala|apagalo|apagala|páralo|párala|paralo|parala|pausalo|pausala|pausálo|pausála)$",
				template: "pausa la música en {entity}",
			},
			{
				pattern: "^(?:súbele|subele)$",
				template: "sube el volumen en {entity}",
			},
			{
				pattern: "^(?:bájale|bajale)$",
				template: "baja el volumen en {entity}",
			},
			{
				pattern: "^(?:sáltala|sáltalo|saltala|saltalo|siguiente)$",
				template: "siguiente canción en {entity}",
			},
		],
		phrases: {
			musicPlaying: "Reproduciendo {what} en {player}.",
			musicNowPlaying: "{what} está sonando en {player}.",
			musicNothingPlaying: "Ahora mismo no suena nada.",
			musicNotFound: "No encontré {query} en tu música.",
			musicWhichSpeaker: "¿En qué bocina lo pongo?",
			musicWhichMusic: "¿Qué te gustaría escuchar?",
			musicPlayerUnavailable: "{player} no está disponible ahora.",
			musicPaused: "Música en pausa.",
			musicResumed: "Sigue la música.",
			musicSkipped: "Pasé a la siguiente canción.",
			musicPrevious: "Vuelvo una canción.",
			musicVolumeSet: "Volumen en {level}.",
			musicVolumeChanged: "El volumen de {player} está en {level}.",
			musicVolumeFailed: "No pude cambiar el volumen de {player}.",
			musicVolumeUp: "Subiendo el volumen.",
			musicVolumeDown: "Bajando el volumen.",
			musicMuted: "Silenciado.",
			musicUnmuted: "Sonido restaurado.",
		},
	},
}

export const MA_FAST_PATH_PACKS: Record<string, FastPathBlockType> = {
	en: loadFastPathPack(enPack),
	es: loadFastPathPack(esPack),
}

export const MA_FAST_PATH_SAMPLES: Record<string, string[]> = {
	en: [
		"pause the music",
		"stop the song",
		"turn off the music",
		"pause the music in the kitchen",
		"resume the music",
		"keep playing the music",
		"next song",
		"skip the song",
		"next song on the kitchen speaker",
		"previous song",
		"set the volume to 40 percent",
		"turn up the volume",
		"turn the volume up on the kitchen speaker",
		"turn the music down",
		"mute the speakers",
		"unmute the music",
		"which song is this",
		"current song",
	],
	es: [
		"pausa la música",
		"para la canción",
		"apaga la música",
		"pausa la música en la cocina",
		"reanuda la música",
		"vuelve a poner la música",
		"siguiente canción",
		"salta la canción",
		"siguiente canción en la cocina",
		"canción anterior",
		"pon el volumen al 40 por ciento",
		"sube el volumen",
		"sube el volumen en la cocina",
		"baja la música",
		"silencia las bocinas",
		"quita el silencio",
		"canción actual",
		"dime la canción",
	],
}

export const MA_EXAMPLE_UTTERANCES: Record<string, string[]> = {
	en: [
		"play Radiohead",
		"play some jazz in the kitchen",
		"put on OK Computer",
		"play Karma Police on the living room speaker",
		"pause the music",
		"resume the music",
		"skip this song",
		"go back a song",
		"turn the music up",
		"set the volume to thirty percent",
		"mute the speakers",
		"which song is this?",
	],
	es: [
		"pon Radiohead",
		"pon algo de jazz en la cocina",
		"pon el disco OK Computer",
		"pon Karma Police en la bocina de la sala",
		"pausa la música",
		"reanuda la música",
		"salta esta canción",
		"vuelve una canción",
		"sube el volumen de la música",
		"pon el volumen al treinta por ciento",
		"silencia las bocinas",
		"¿qué canción es esta?",
	],
}
