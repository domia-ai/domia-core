CREATE TABLE `audio_playback_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'SOX' NOT NULL,
	`volume` integer DEFAULT 100,
	`output_device` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `character_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`personality` text DEFAULT 'NEUTRAL',
	`language` text DEFAULT 'en',
	`profession` text DEFAULT 'HOST',
	`communication_style` text DEFAULT 'FRIENDLY',
	`perceived_age` text DEFAULT 'ADULT',
	`cultural_background` text,
	`languages_spoken` text,
	`knowledge_depth` text DEFAULT 'INTERMEDIATE',
	`interests` text,
	`hobbies` text,
	`skills` text,
	`relationship_type` text DEFAULT 'COMPANION',
	`role_mode` text DEFAULT 'PASSIVE',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `domia` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domia_key` text NOT NULL,
	`is_active` integer DEFAULT true,
	`session_id_timeout_ms` integer DEFAULT 300000,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domia_domia_key_unique` ON `domia` (`domia_key`);--> statement-breakpoint
CREATE TABLE `emotion_event` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`cause` text NOT NULL,
	`delta` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `emotion_state` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`joy` real DEFAULT 0,
	`sadness` real DEFAULT 0,
	`anger` real DEFAULT 0,
	`fear` real DEFAULT 0,
	`trust` real DEFAULT 0,
	`disgust` real DEFAULT 0,
	`anticipation` real DEFAULT 0,
	`surprise` real DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emotion_state_domia_id_unique` ON `emotion_state` (`domia_id`);--> statement-breakpoint
CREATE TABLE `interaction_session_trace` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP,
	`last_used_at` text DEFAULT CURRENT_TIMESTAMP,
	`session_id_timeout_ms` integer DEFAULT 300000,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interaction_trace` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`interaction_session_trace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`input_type` text DEFAULT 'VOICE' NOT NULL,
	`is_active` integer DEFAULT true,
	`input_raw` text,
	`input_audio_path` text,
	`wakeword_used` text DEFAULT 'domia',
	`stt_result` text,
	`mcp_server_used` text,
	`mcp_prompt` text,
	`mcp_response` text,
	`llm_prompt` text,
	`llm_response` text,
	`tts_engine_used` text,
	`tts_audio_path` text,
	`final_output` text,
	`emotion_snapshot` text,
	`character_snapshot` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interaction_session_trace_id`) REFERENCES `interaction_session_trace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `llm_model_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'OLLAMA' NOT NULL,
	`model_name` text DEFAULT 'tinyllama' NOT NULL,
	`temperature` real DEFAULT 0.7,
	`context_window` integer DEFAULT 2048,
	`use_compact_prompt` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcp_server_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`timeout_ms` integer DEFAULT 2000,
	`priority` integer DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `module_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`emotion_engine` integer NOT NULL,
	`memory_engine` integer NOT NULL,
	`collective_mind` integer NOT NULL,
	`remote_access_engine` integer NOT NULL,
	`narrative_engine` integer NOT NULL,
	`identity_engine` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stt_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'VOSK' NOT NULL,
	`model_name` text DEFAULT 'vosk-model-small-en-us-0.15' NOT NULL,
	`language` text DEFAULT 'en',
	`model_path` text,
	`silence_threshold` real,
	`buffer_size` integer,
	`timeout_ms` integer DEFAULT 5000,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tts_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'PIPER' NOT NULL,
	`voice_name` text DEFAULT 'en_US-libritts_r-medium' NOT NULL,
	`language` text DEFAULT 'en',
	`pitch` real DEFAULT 1,
	`speed` real DEFAULT 1,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `wake_word_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'OPEN_WAKE_WORD' NOT NULL,
	`wake_word` text DEFAULT 'domia' NOT NULL,
	`sensitivity` real DEFAULT 0.5,
	`threshold` real DEFAULT 0.5,
	`cooldown` real DEFAULT 2,
	`framework` text DEFAULT 'onnx',
	`model` text DEFAULT 'domia' NOT NULL,
	`custom_model_path` text,
	`device` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
