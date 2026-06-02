CREATE TABLE `audio_playback_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'SOX' NOT NULL,
	`volume` integer DEFAULT 100 NOT NULL,
	`streaming_enabled` integer DEFAULT true NOT NULL,
	`output_device` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `capability_delegation` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`capability` text NOT NULL,
	`delegate_to_domia_id` text,
	`delegate_to_domia_key` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delegate_to_domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `character_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`personality` text DEFAULT 'NEUTRAL' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`profession` text DEFAULT 'HOST' NOT NULL,
	`communication_style` text DEFAULT 'FRIENDLY' NOT NULL,
	`perceived_age` text DEFAULT 'ADULT' NOT NULL,
	`cultural_background` text,
	`languages_spoken` text,
	`knowledge_depth` text DEFAULT 'INTERMEDIATE' NOT NULL,
	`interests` text,
	`hobbies` text,
	`skills` text,
	`relationship_type` text DEFAULT 'COMPANION' NOT NULL,
	`role_mode` text DEFAULT 'PASSIVE' NOT NULL,
	`prompt_overrides` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `domia` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domia_key` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`session_id_timeout_ms` integer DEFAULT 300000 NOT NULL,
	`memory_window_turns` integer DEFAULT 8 NOT NULL,
	`memory_max_age_ms` integer DEFAULT 1800000 NOT NULL,
	`max_concurrent_voice_replies` integer DEFAULT 2 NOT NULL,
	`max_queued_voice_replies` integer DEFAULT 4 NOT NULL,
	`voice_queue_timeout_ms` integer DEFAULT 15000 NOT NULL,
	`own_config_ttl_ms` integer DEFAULT 30000 NOT NULL,
	`local_ip` text,
	`grpc_port` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domia_domia_key_unique` ON `domia` (`domia_key`);--> statement-breakpoint
CREATE TABLE `emotion_event` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`cause` text NOT NULL,
	`delta` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `emotion_state` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`joy` real DEFAULT 0 NOT NULL,
	`sadness` real DEFAULT 0 NOT NULL,
	`anger` real DEFAULT 0 NOT NULL,
	`fear` real DEFAULT 0 NOT NULL,
	`trust` real DEFAULT 0 NOT NULL,
	`disgust` real DEFAULT 0 NOT NULL,
	`anticipation` real DEFAULT 0 NOT NULL,
	`surprise` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emotion_state_domia_id_unique` ON `emotion_state` (`domia_id`);--> statement-breakpoint
CREATE TABLE `interaction_session_trace` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`session_id_timeout_ms` integer DEFAULT 300000 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interaction_trace` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`interaction_session_trace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`input_type` text DEFAULT 'VOICE' NOT NULL,
	`response_type` text DEFAULT 'voice' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`input_raw` text,
	`input_audio_path` text,
	`wakeword_used` text DEFAULT 'alexa' NOT NULL,
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
	`user_emotion_snapshot` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interaction_session_trace_id`) REFERENCES `interaction_session_trace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `llm_model_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'OLLAMA' NOT NULL,
	`model_name` text DEFAULT 'llama3.1:8b' NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`context_window` integer DEFAULT 4096 NOT NULL,
	`num_predict` integer DEFAULT 80 NOT NULL,
	`llm_concurrency` integer DEFAULT 2 NOT NULL,
	`use_compact_prompt` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcp_server_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`timeout_ms` integer DEFAULT 2000 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_fact` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`subject` text NOT NULL,
	`relation` text NOT NULL,
	`value` text NOT NULL,
	`confidence` real DEFAULT 0.7 NOT NULL,
	`source_interaction_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_fact_domia_id_subject_relation_unique` ON `memory_fact` (`domia_id`,`subject`,`relation`);--> statement-breakpoint
CREATE TABLE `module_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`emotion_engine` integer NOT NULL,
	`emotion_capture` integer DEFAULT true NOT NULL,
	`memory_engine` integer NOT NULL,
	`fact_capture` integer DEFAULT true NOT NULL,
	`fact_recall` integer DEFAULT true NOT NULL,
	`reflection_only_when_idle` integer DEFAULT true NOT NULL,
	`reflection_concurrency` integer DEFAULT 1 NOT NULL,
	`reflection_queue_max_depth` integer DEFAULT 4 NOT NULL,
	`collective_mind` integer NOT NULL,
	`remote_access_engine` integer NOT NULL,
	`narrative_engine` integer NOT NULL,
	`identity_engine` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mqtt_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`domia_id` text NOT NULL,
	`type` text DEFAULT 'LOCAL' NOT NULL,
	`host` text NOT NULL,
	`username` text,
	`password` text,
	`qos` integer DEFAULT 1 NOT NULL,
	`topic_root` text NOT NULL,
	`protocol` text DEFAULT 'mqtt' NOT NULL,
	`port` integer DEFAULT 1883 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runtime_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`domia_id` text NOT NULL,
	`wakeword` integer DEFAULT false NOT NULL,
	`record` integer DEFAULT false NOT NULL,
	`stt` integer DEFAULT false NOT NULL,
	`intent_detection` integer DEFAULT false NOT NULL,
	`intent_execution` integer DEFAULT false NOT NULL,
	`prompt_generation` integer DEFAULT false NOT NULL,
	`llm` integer DEFAULT false NOT NULL,
	`tts` integer DEFAULT false NOT NULL,
	`playback` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_capabilities_domia_id_unique` ON `runtime_capabilities` (`domia_id`);--> statement-breakpoint
CREATE TABLE `stt_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'ZIPFORMER' NOT NULL,
	`model_name` text DEFAULT 'streaming-zipformer-en' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`model_path` text DEFAULT 'data/models/streaming-zipformer-en' NOT NULL,
	`quantization` text DEFAULT 'int8' NOT NULL,
	`silence_threshold` real,
	`buffer_size` integer,
	`timeout_ms` integer DEFAULT 5000 NOT NULL,
	`enable_endpoint` integer DEFAULT true NOT NULL,
	`rule1_min_trailing_silence` real DEFAULT 1.2 NOT NULL,
	`rule2_min_trailing_silence` real DEFAULT 0.6 NOT NULL,
	`rule3_min_utterance_length` real DEFAULT 12 NOT NULL,
	`stt_num_threads` integer DEFAULT 2 NOT NULL,
	`stt_provider` text DEFAULT 'cpu' NOT NULL,
	`stt_decode_padding_ms` integer DEFAULT 600 NOT NULL,
	`stt_pool_warm_workers` integer DEFAULT 1 NOT NULL,
	`stt_pool_max_workers` integer DEFAULT 0 NOT NULL,
	`stt_pool_auto_scale_enabled` integer DEFAULT true NOT NULL,
	`stt_pool_idle_timeout_ms` integer DEFAULT 60000 NOT NULL,
	`stt_pool_queue_max_depth` integer DEFAULT 8 NOT NULL,
	`stt_pool_queue_timeout_ms` integer DEFAULT 15000 NOT NULL,
	`stt_worker_recycle_after_jobs` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tts_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'KOKORO' NOT NULL,
	`voice_name` text DEFAULT 'af_heart' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`model_path` text DEFAULT 'data/models/kokoro-en-v0_19' NOT NULL,
	`quantization` text,
	`pitch` real DEFAULT 1 NOT NULL,
	`speed` real DEFAULT 1 NOT NULL,
	`silence_scale` real DEFAULT 0.2 NOT NULL,
	`num_threads` integer DEFAULT 2 NOT NULL,
	`provider` text DEFAULT 'cpu' NOT NULL,
	`max_num_sentences` integer DEFAULT 1 NOT NULL,
	`streaming_enabled` integer DEFAULT false NOT NULL,
	`tts_pool_warm_workers` integer DEFAULT 1 NOT NULL,
	`tts_pool_max_workers` integer DEFAULT 0 NOT NULL,
	`tts_pool_auto_scale_enabled` integer DEFAULT true NOT NULL,
	`tts_pool_idle_timeout_ms` integer DEFAULT 60000 NOT NULL,
	`tts_pool_queue_max_depth` integer DEFAULT 8 NOT NULL,
	`tts_pool_queue_timeout_ms` integer DEFAULT 15000 NOT NULL,
	`tts_worker_recycle_after_jobs` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `wake_word_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`domia_id` text NOT NULL,
	`engine` text DEFAULT 'KWS' NOT NULL,
	`wake_word` text DEFAULT 'alexa' NOT NULL,
	`sensitivity` real DEFAULT 0.5 NOT NULL,
	`threshold` real DEFAULT 0.5 NOT NULL,
	`cooldown` real DEFAULT 2 NOT NULL,
	`framework` text DEFAULT 'onnx' NOT NULL,
	`model` text DEFAULT 'kws-zipformer-gigaspeech' NOT NULL,
	`custom_model_path` text DEFAULT 'data/models/kws-zipformer-gigaspeech-3.3M-2024-01-01' NOT NULL,
	`quantization` text DEFAULT 'int8' NOT NULL,
	`vad_engine` text DEFAULT 'SILERO' NOT NULL,
	`vad_model_path` text DEFAULT 'data/models/silero_vad.onnx' NOT NULL,
	`device` integer DEFAULT 0 NOT NULL,
	`sample_rate` integer DEFAULT 16000 NOT NULL,
	`bits_per_sample` integer DEFAULT 16 NOT NULL,
	`channels` integer DEFAULT 1 NOT NULL,
	`max_recording_ms` integer DEFAULT 15000 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`domia_id`) REFERENCES `domia`(`id`) ON UPDATE no action ON DELETE no action
);
