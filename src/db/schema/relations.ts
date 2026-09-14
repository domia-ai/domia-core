import { relations } from "drizzle-orm"
import {
	domia,
	runtimeCapabilities,
	moduleSettings,
	characterProfile,
} from "./identity"
import { emotionState } from "./memory"
import { wakeWordConfig } from "./capture"
import { sttConfig, llmModelConfig, ttsConfig } from "./pipeline"
import { skillProvider, capabilityDelegation } from "./skills"
import { audioPlaybackConfig, mqttConfig, satelliteConfig } from "./runtime"

export const domiaRelations = relations(domia, ({ one, many }) => ({
	runtimeCapabilities: one(runtimeCapabilities, {
		fields: [domia.id],
		references: [runtimeCapabilities.domiaId],
	}),
	emotionState: one(emotionState, {
		fields: [domia.id],
		references: [emotionState.domiaId],
	}),
	moduleSettings: many(moduleSettings),
	characterProfiles: many(characterProfile),
	wakeWordConfigs: many(wakeWordConfig),
	sttConfigs: many(sttConfig),
	llmModelConfigs: many(llmModelConfig),
	ttsConfigs: many(ttsConfig),
	skillProviders: many(skillProvider),
	audioPlaybackConfigs: many(audioPlaybackConfig),
	mqttConfigs: many(mqttConfig),
	capabilityDelegations: many(capabilityDelegation),
}))

export const runtimeCapabilitiesRelations = relations(
	runtimeCapabilities,
	({ one }) => ({
		domia: one(domia, {
			fields: [runtimeCapabilities.domiaId],
			references: [domia.id],
		}),
	}),
)

export const satelliteConfigRelations = relations(
	satelliteConfig,
	({ one }) => ({
		domia: one(domia, {
			fields: [satelliteConfig.domiaId],
			references: [domia.id],
		}),
	}),
)

export const moduleSettingsRelations = relations(moduleSettings, ({ one }) => ({
	domia: one(domia, {
		fields: [moduleSettings.domiaId],
		references: [domia.id],
	}),
}))

export const characterProfileRelations = relations(
	characterProfile,
	({ one }) => ({
		domia: one(domia, {
			fields: [characterProfile.domiaId],
			references: [domia.id],
		}),
	}),
)

export const wakeWordConfigRelations = relations(wakeWordConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [wakeWordConfig.domiaId],
		references: [domia.id],
	}),
}))

export const sttConfigRelations = relations(sttConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [sttConfig.domiaId],
		references: [domia.id],
	}),
}))

export const llmModelConfigRelations = relations(llmModelConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [llmModelConfig.domiaId],
		references: [domia.id],
	}),
}))

export const ttsConfigRelations = relations(ttsConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [ttsConfig.domiaId],
		references: [domia.id],
	}),
}))

export const skillProviderRelations = relations(skillProvider, ({ one }) => ({
	domia: one(domia, {
		fields: [skillProvider.domiaId],
		references: [domia.id],
	}),
}))

export const audioPlaybackConfigRelations = relations(
	audioPlaybackConfig,
	({ one }) => ({
		domia: one(domia, {
			fields: [audioPlaybackConfig.domiaId],
			references: [domia.id],
		}),
	}),
)

export const mqttConfigRelations = relations(mqttConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [mqttConfig.domiaId],
		references: [domia.id],
	}),
}))

export const capabilityDelegationRelations = relations(
	capabilityDelegation,
	({ one }) => ({
		domia: one(domia, {
			fields: [capabilityDelegation.domiaId],
			references: [domia.id],
		}),
	}),
)
