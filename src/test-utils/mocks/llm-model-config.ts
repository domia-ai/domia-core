import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
	DEFAULT_LLM_MODEL_NAME,
	DEFAULT_LLM_MODEL_NUM_PREDICT,
	DEFAULT_LLM_MODEL_TEMPERATURE,
	DEFAULT_LLM_CONCURRENCY,
	LLM_ENGINE_ENUM,
} from "@/db/constants"
import { type SelectLlmModelConfigType } from "@/db"

export const baseLlmModelConfig = (
	domiaId?: string,
): SelectLlmModelConfigType => {
	return {
		id: generateUuid(),
		name: faker.word.words(2),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		engine: LLM_ENGINE_ENUM.OLLAMA,
		reflectionModelName: null,
		modelName: DEFAULT_LLM_MODEL_NAME,
		temperature: DEFAULT_LLM_MODEL_TEMPERATURE,
		contextWindow: DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
		numPredict: DEFAULT_LLM_MODEL_NUM_PREDICT,
		llmConcurrency: DEFAULT_LLM_CONCURRENCY,
		useCompactPrompt: false,
		agentPromptMode: "compact",
		skillsRouting: "intent-gate",
		intentModelName: null,
		toolModelName: null,
		agentMaxSteps: 5,
		createdAt: now(),
		updatedAt: now(),
	}
}
