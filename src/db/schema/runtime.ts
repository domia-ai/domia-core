import {
	sqliteTable,
	text,
	real,
	integer,
	unique,
	index,
} from "drizzle-orm/sqlite-core"
import {
	ANNOUNCEMENT_DELIVERY_ENUM,
	ANNOUNCEMENT_DELIVERY_ENUM_VALUES,
	ANNOUNCEMENT_KIND_ENUM,
	ANNOUNCEMENT_KIND_ENUM_VALUES,
	AUDIO_PLAYBACK_ENGINE_ENUM,
	AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	DEFAULT_ACK_SOUND_ENABLED,
	DEFAULT_ACK_SOUND_PATH,
	DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED,
	DEFAULT_AUDIO_PLAYBACK_VOLUME,
	DEFAULT_DESIRED_WAKE_WORDS,
	DEFAULT_DONE_SOUND_ENABLED,
	DEFAULT_DONE_SOUND_PATH,
	DEFAULT_ENDPOINT_SOUND_ENABLED,
	DEFAULT_ENDPOINT_SOUND_PATH,
	DEFAULT_ERROR_SOUND_ENABLED,
	DEFAULT_ERROR_SOUND_PATH,
	DEFAULT_FEEDBACK_SOUNDS_ENABLED,
	DEFAULT_HEARD_SILENCE_RMS,
	DEFAULT_HEARD_SILENCE_TRIM_ENABLED,
	DEFAULT_MQTT_HOST,
	DEFAULT_MQTT_PASSWORD,
	DEFAULT_MQTT_PORT,
	DEFAULT_MQTT_QOS,
	DEFAULT_MQTT_TOPIC_ROOT,
	DEFAULT_MQTT_USERNAME,
	DEFAULT_PLAYBACK_PAUSE_ENABLED,
	DEFAULT_PLAYBACK_TRUNCATION_REPLAY_ENABLED,
	DEFAULT_PLAYBACK_TRUNCATION_REPLAY_THRESHOLD_MS,
	DEFAULT_PLAYBACK_WATCHDOG_GRACE_MS,
	DEFAULT_PROACTIVE_IMPORTANCE,
	DEFAULT_PROACTIVE_TARGET_KIND,
	DEFAULT_PROACTIVE_VERB,
	DEFAULT_SATELLITE_ACTIVE,
	DEFAULT_SATELLITE_CAPTURE_HEAD_TRIM_MS,
	DEFAULT_SATELLITE_DESIRED_NUMBERS,
	DEFAULT_SATELLITE_FOLLOW_UP,
	DEFAULT_SATELLITE_FOLLOW_UP_NO_SPEECH_MS,
	DEFAULT_SATELLITE_FOLLOW_UP_REQUEST_MAX_MS,
	DEFAULT_SATELLITE_PLAYBACK_DRAIN_MARGIN_MS,
	DEFAULT_SATELLITE_PORT,
	DEFAULT_SATELLITE_PROTOCOL,
	DEFAULT_SATELLITE_RUN_LISTENING_MAX_MS,
	DEFAULT_SATELLITE_WYOMING_STREAMING_TTS,
	DEFAULT_THINKING_SOUND_ENABLED,
	DEFAULT_THINKING_SOUND_PATH,
	DEFAULT_WORD_LEVEL_HEARD_ENABLED,
	MQTT_PROTOCOL_ENUM,
	MQTT_PROTOCOL_ENUM_VALUES,
	MQTT_TYPE_ENUM,
	MQTT_TYPE_ENUM_VALUES,
	PROACTIVE_IMPORTANCE_ENUM_VALUES,
	PROACTIVE_SCHEDULE_STATUS_ENUM,
	PROACTIVE_SCHEDULE_STATUS_ENUM_VALUES,
	PROACTIVE_TARGET_KIND_ENUM_VALUES,
	PROACTIVE_VERB_ENUM_VALUES,
	SATELLITE_PROTOCOL_ENUM_VALUES,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"
import { domia } from "./identity"

export const audioPlaybackConfig = sqliteTable("audio_playback_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(AUDIO_PLAYBACK_ENGINE_ENUM.SOX),
	volume: integer("volume").notNull().default(DEFAULT_AUDIO_PLAYBACK_VOLUME),
	streamingEnabled: integer("streaming_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED),
	pauseEnabled: integer("pause_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_PLAYBACK_PAUSE_ENABLED),
	wordLevelHeardEnabled: integer("word_level_heard_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_WORD_LEVEL_HEARD_ENABLED),
	heardSilenceTrimEnabled: integer("heard_silence_trim_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_HEARD_SILENCE_TRIM_ENABLED),
	heardSilenceRms: real("heard_silence_rms")
		.notNull()
		.default(DEFAULT_HEARD_SILENCE_RMS),
	watchdogGraceMs: integer("watchdog_grace_ms")
		.notNull()
		.default(DEFAULT_PLAYBACK_WATCHDOG_GRACE_MS),
	truncationReplayEnabled: integer("truncation_replay_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_PLAYBACK_TRUNCATION_REPLAY_ENABLED),
	truncationReplayThresholdMs: integer("truncation_replay_threshold_ms")
		.notNull()
		.default(DEFAULT_PLAYBACK_TRUNCATION_REPLAY_THRESHOLD_MS),
	outputDevice: text("output_device"),
	feedbackSoundsEnabled: integer("feedback_sounds_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_FEEDBACK_SOUNDS_ENABLED),
	ackSoundEnabled: integer("ack_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ACK_SOUND_ENABLED),
	errorSoundEnabled: integer("error_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ERROR_SOUND_ENABLED),
	doneSoundEnabled: integer("done_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_DONE_SOUND_ENABLED),
	thinkingSoundEnabled: integer("thinking_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_THINKING_SOUND_ENABLED),
	endpointSoundEnabled: integer("endpoint_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ENDPOINT_SOUND_ENABLED),
	ackSoundPath: text("ack_sound_path")
		.notNull()
		.default(DEFAULT_ACK_SOUND_PATH),
	errorSoundPath: text("error_sound_path")
		.notNull()
		.default(DEFAULT_ERROR_SOUND_PATH),
	doneSoundPath: text("done_sound_path")
		.notNull()
		.default(DEFAULT_DONE_SOUND_PATH),
	thinkingSoundPath: text("thinking_sound_path")
		.notNull()
		.default(DEFAULT_THINKING_SOUND_PATH),
	endpointSoundPath: text("endpoint_sound_path")
		.notNull()
		.default(DEFAULT_ENDPOINT_SOUND_PATH),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const mqttConfig = sqliteTable("mqtt_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	type: text("type", { enum: MQTT_TYPE_ENUM_VALUES })
		.notNull()
		.default(MQTT_TYPE_ENUM.LOCAL),
	host: text("host").notNull().default(DEFAULT_MQTT_HOST),
	username: text("username").default(DEFAULT_MQTT_USERNAME),
	password: text("password").default(DEFAULT_MQTT_PASSWORD),
	qos: integer("qos").notNull().default(DEFAULT_MQTT_QOS),
	topicRoot: text("topic_root").notNull().default(DEFAULT_MQTT_TOPIC_ROOT),
	protocol: text("protocol", {
		enum: MQTT_PROTOCOL_ENUM_VALUES,
	})
		.notNull()
		.default(MQTT_PROTOCOL_ENUM.MQTT),
	port: integer("port").notNull().default(DEFAULT_MQTT_PORT),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const announcement = sqliteTable(
	"announcement",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		broadcastId: text("broadcast_id").notNull(),
		text: text("text").notNull().default(""),
		kind: text("kind", { enum: ANNOUNCEMENT_KIND_ENUM_VALUES })
			.notNull()
			.default(ANNOUNCEMENT_KIND_ENUM.TEXT),
		delivery: text("delivery", { enum: ANNOUNCEMENT_DELIVERY_ENUM_VALUES })
			.notNull()
			.default(ANNOUNCEMENT_DELIVERY_ENUM.DOMIA_VOICE),
		target: text("target"),
		audioPath: text("audio_path"),
		personId: text("person_id"),
		delivered: integer("delivered", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_announcement_domia_updated").on(t.domiaId, t.updatedAt)],
)

export const proactiveSchedule = sqliteTable(
	"proactive_schedule",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		personId: text("person_id"),
		name: text("name").notNull(),
		text: text("text"),
		templateKey: text("template_key"),
		templateParams: text("template_params", { mode: "json" }).$type<Record<
			string,
			string
		> | null>(),
		verb: text("verb", { enum: PROACTIVE_VERB_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_PROACTIVE_VERB),
		importance: text("importance", { enum: PROACTIVE_IMPORTANCE_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_PROACTIVE_IMPORTANCE),
		targetKind: text("target_kind", { enum: PROACTIVE_TARGET_KIND_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_PROACTIVE_TARGET_KIND),
		targetSatelliteId: text("target_satellite_id"),
		actionTool: text("action_tool"),
		actionArgs: text("action_args", { mode: "json" }).$type<Record<
			string,
			unknown
		> | null>(),
		dueAt: text("due_at").notNull(),
		repeatEveryMs: integer("repeat_every_ms"),
		repeatDailyAt: text("repeat_daily_at"),
		status: text("status", { enum: PROACTIVE_SCHEDULE_STATUS_ENUM_VALUES })
			.notNull()
			.default(PROACTIVE_SCHEDULE_STATUS_ENUM.PENDING),
		leaseUntil: text("lease_until"),
		leaseOwner: text("lease_owner"),
		attempts: integer("attempts").notNull().default(0),
		firedCount: integer("fired_count").notNull().default(0),
		lastFiredAt: text("last_fired_at"),
		lastError: text("last_error"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		index("idx_proactive_schedule_domia_status_due").on(
			t.domiaId,
			t.status,
			t.dueAt,
		),
	],
)

export const satelliteConfig = sqliteTable(
	"satellite_config",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		satelliteId: text("satellite_id").notNull(),
		name: text("name"),
		host: text("host").notNull(),
		port: integer("port").notNull().default(DEFAULT_SATELLITE_PORT),
		encryptionKey: text("encryption_key"),
		protocol: text("protocol", { enum: SATELLITE_PROTOCOL_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_SATELLITE_PROTOCOL),
		desiredWakeWords: text("desired_wake_words", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(DEFAULT_DESIRED_WAKE_WORDS),
		desiredNumbers: text("desired_numbers", { mode: "json" })
			.$type<Record<string, number>>()
			.notNull()
			.default(DEFAULT_SATELLITE_DESIRED_NUMBERS),
		followUpEnabled: integer("follow_up_enabled", { mode: "boolean" })
			.notNull()
			.default(DEFAULT_SATELLITE_FOLLOW_UP),
		followUpNoSpeechMs: integer("follow_up_no_speech_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_FOLLOW_UP_NO_SPEECH_MS),
		playbackDrainMarginMs: integer("playback_drain_margin_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_PLAYBACK_DRAIN_MARGIN_MS),
		runListeningMaxMs: integer("run_listening_max_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_RUN_LISTENING_MAX_MS),
		followUpRequestMaxMs: integer("follow_up_request_max_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_FOLLOW_UP_REQUEST_MAX_MS),
		captureHeadTrimMs: integer("capture_head_trim_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_CAPTURE_HEAD_TRIM_MS),
		desiredVolume: real("desired_volume"),
		livekitApiKey: text("livekit_api_key"),
		livekitApiSecret: text("livekit_api_secret"),
		livekitRoom: text("livekit_room"),
		isActive: integer("is_active", { mode: "boolean" })
			.notNull()
			.default(DEFAULT_SATELLITE_ACTIVE),
		wyomingStreamingTts: integer("wyoming_streaming_tts", { mode: "boolean" })
			.notNull()
			.default(DEFAULT_SATELLITE_WYOMING_STREAMING_TTS),
		mediaPlayerName: text("media_player_name"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [unique().on(t.domiaId, t.satelliteId)],
)
