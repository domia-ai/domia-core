import { dbClient } from "@/db"
import { env } from "@/config"
import { type DomiaType, invalidateOwnDomia } from "@/modules/core"
import {
	EMOTION_PRESETS,
	getEmotionVectorFromEmotionState,
} from "@/modules/emotion-engine"
import { mindLogger } from "@/utils"
import dbAdapter from "../db-adapter"
import { mindSnapshotSchema } from "../schemas"
import { MIND_TEMPLATES } from "../constants"
import type { MindSnapshotType, TemplateSummaryType } from "../types"

const characterFromDomia = (domia: DomiaType) => {
	const c = domia.characterProfile
	if (!c) throw new Error(`domia ${domia.id} has no active character profile`)
	return {
		name: c.name,
		personality: c.personality,
		language: c.language,
		profession: c.profession,
		communicationStyle: c.communicationStyle,
		perceivedAge: c.perceivedAge,
		culturalBackground: c.culturalBackground,
		languagesSpoken: c.languagesSpoken,
		knowledgeDepth: c.knowledgeDepth,
		interests: c.interests,
		hobbies: c.hobbies,
		skills: c.skills,
		relationshipType: c.relationshipType,
		roleMode: c.roleMode,
		promptOverrides:
			c.promptOverrides && typeof c.promptOverrides === "object"
				? (c.promptOverrides as MindSnapshotType["character"]["promptOverrides"])
				: null,
	}
}

const modulesFromDomia = (domia: DomiaType) => {
	const m = domia.moduleSettings
	return {
		emotionEngine: m?.emotionEngine ?? true,
		memoryEngine: m?.memoryEngine ?? false,
		collectiveMind: m?.collectiveMind ?? false,
		remoteAccessEngine: m?.remoteAccessEngine ?? false,
		narrativeEngine: m?.narrativeEngine ?? false,
		identityEngine: m?.identityEngine ?? false,
	}
}

export const serializeMind = (domia: DomiaType): MindSnapshotType => {
	const character = characterFromDomia(domia)
	const emotionBaseline = domia.emotionState
		? getEmotionVectorFromEmotionState(domia.emotionState)
		: EMOTION_PRESETS[character.personality]
	return mindSnapshotSchema.parse({
		character,
		emotionBaseline,
		modules: modulesFromDomia(domia),
	})
}

export const listTemplates = (): TemplateSummaryType[] =>
	MIND_TEMPLATES.map((t) => ({
		id: t.id,
		name: t.name,
		description: t.description,
	}))

const applyMindToLiveDomia = (
	domia: DomiaType,
	mind: MindSnapshotType,
): void => {
	if (domia.characterProfile) {
		Object.assign(domia.characterProfile, mind.character)
	}
	if (domia.moduleSettings) {
		Object.assign(domia.moduleSettings, mind.modules)
	}
	if (domia.emotionState) {
		Object.assign(domia.emotionState, mind.emotionBaseline)
	}
	if (domia?.domiaKey === env.DOMIA_KEY) invalidateOwnDomia()
}

const materializeMind = (domia: DomiaType, mind: MindSnapshotType): void => {
	dbClient.transaction((tx) => {
		dbAdapter.materializeCharacter(domia.id, mind.character, tx).run()
		dbAdapter.materializeModules(domia.id, mind.modules, tx).run()
		dbAdapter.materializeEmotion(domia.id, mind.emotionBaseline, tx).run()
	})
	applyMindToLiveDomia(domia, mind)
}

export const importMind = (
	domia: DomiaType,
	mindInput: unknown,
): MindSnapshotType => {
	const mind = mindSnapshotSchema.parse(mindInput)
	materializeMind(domia, mind)
	mindLogger.info("📥 mind imported", { domiaId: domia.id })
	return mind
}

export const activateTemplate = (
	domia: DomiaType,
	templateId: string,
): MindSnapshotType => {
	const template = MIND_TEMPLATES.find((t) => t.id === templateId)
	if (!template) throw new Error(`template ${templateId} not found`)
	const mind = mindSnapshotSchema.parse(template.mind)
	materializeMind(domia, mind)
	mindLogger.info("🎭 template activated", {
		domiaId: domia.id,
		templateId,
	})
	return mind
}
