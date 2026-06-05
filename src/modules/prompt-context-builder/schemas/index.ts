import { z } from "zod"

const personaCharacterSchema = z.object({
	name: z.string().nullish(),
	personality: z.string().nullish(),
	communicationStyle: z.string().nullish(),
	profession: z.string().nullish(),
	relationshipType: z.string().nullish(),
	knowledgeDepth: z.string().nullish(),
	language: z.string().nullish(),
	interests: z.array(z.string()).nullish(),
})

const personaEmotionSchema = z.object({
	joy: z.number(),
	sadness: z.number(),
	anger: z.number(),
	fear: z.number(),
	trust: z.number(),
	disgust: z.number(),
	anticipation: z.number(),
	surprise: z.number(),
})

const personaModulesSchema = z
	.object({
		identityEngine: z.boolean(),
		emotionEngine: z.boolean(),
		emotionCapture: z.boolean(),
		memoryEngine: z.boolean(),
		factCapture: z.boolean(),
		factRecall: z.boolean(),
	})
	.partial()

export const recentTurnSchema = z.object({
	userText: z.string().nullish(),
	domiaText: z.string().nullish(),
	createdAt: z.string().nullish(),
})

export const promptOverridesSchema = z.object({
	identity: z.string().nullish(),
	traits: z.array(z.string()).nullish(),
	styleNotes: z.string().nullish(),
	environmentContext: z.string().nullish(),
})

export const ttsVoiceSchema = z.object({
	voiceName: z.string().nullish(),
	speed: z.number().nullish(),
	silenceScale: z.number().nullish(),
	pitch: z.number().nullish(),
})

export const personaContextSchema = z.object({
	characterProfile: personaCharacterSchema.nullable(),
	emotionState: personaEmotionSchema.nullable(),
	moduleSettings: personaModulesSchema.nullable(),
	useCompactPrompt: z.boolean(),
	recentTurns: z.array(recentTurnSchema).nullish(),
	knownFacts: z.array(z.string()).nullish(),
	userMoodTrend: z.array(z.string()).nullish(),
	promptOverrides: promptOverridesSchema.nullish(),
	ttsVoice: ttsVoiceSchema.nullish(),
})
