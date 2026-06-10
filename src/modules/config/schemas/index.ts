import { z } from "zod"
import { createUpdateSchema, createInsertSchema } from "drizzle-zod"
import {
	domia,
	characterProfile,
	emotionState,
	moduleSettings,
	runtimeCapabilities,
	sttConfig,
	ttsConfig,
	llmModelConfig,
	wakeWordConfig,
	audioPlaybackConfig,
	mqttConfig,
	mcpServerConfig,
	capabilityDelegation,
} from "@/db"

export const CONFIG_BUNDLE_VERSION = 1

const META = {
	id: true,
	domiaId: true,
	createdAt: true,
	updatedAt: true,
} as const

const META_ACTIVE = { ...META, isActive: true } as const

export const configBundleSchema = z
	.object({
		version: z.number().int().positive().optional(),
		domia: createUpdateSchema(domia)
			.omit({
				id: true,
				domiaKey: true,
				createdAt: true,
				updatedAt: true,
				localIp: true,
				grpcPort: true,
				isActive: true,
			})
			.strict()
			.nullish(),
		character: createUpdateSchema(characterProfile)
			.omit(META_ACTIVE)
			.strict()
			.nullish(),
		emotion: createUpdateSchema(emotionState).omit(META).strict().nullish(),
		modules: createUpdateSchema(moduleSettings)
			.omit(META_ACTIVE)
			.strict()
			.nullish(),
		capabilities: createUpdateSchema(runtimeCapabilities)
			.omit(META)
			.strict()
			.nullish(),
		stt: createUpdateSchema(sttConfig).omit(META_ACTIVE).strict().nullish(),
		tts: createUpdateSchema(ttsConfig).omit(META_ACTIVE).strict().nullish(),
		llm: createUpdateSchema(llmModelConfig)
			.omit(META_ACTIVE)
			.strict()
			.nullish(),
		wakeWord: createUpdateSchema(wakeWordConfig)
			.omit(META_ACTIVE)
			.strict()
			.nullish(),
		playback: createUpdateSchema(audioPlaybackConfig)
			.omit(META_ACTIVE)
			.strict()
			.nullish(),
		mqttLocal: createUpdateSchema(mqttConfig)
			.omit({ ...META_ACTIVE, type: true })
			.strict()
			.nullish(),
		mqttRemote: createUpdateSchema(mqttConfig)
			.omit({ ...META_ACTIVE, type: true })
			.strict()
			.nullish(),
		mcpServers: z
			.array(createInsertSchema(mcpServerConfig).omit(META_ACTIVE).strict())
			.nullish(),
		delegations: z
			.array(
				createInsertSchema(capabilityDelegation).omit(META_ACTIVE).strict(),
			)
			.nullish(),
	})
	.strict()
