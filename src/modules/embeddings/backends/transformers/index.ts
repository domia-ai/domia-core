import path from "path"

import {
	pipeline,
	env,
	type FeatureExtractionPipeline,
} from "@huggingface/transformers"

import { DEFAULT_EMBED_MODEL_PATH, EMBED_BACKEND_ENUM } from "@/db"
import { embeddingsLogger } from "@/utils"

import type { EmbedBackendType } from "../../types"

let pipePromise: Promise<FeatureExtractionPipeline> | null = null
let loadedModelDir: string | null = null

const getPipe = (modelDir: string): Promise<FeatureExtractionPipeline> => {
	if (pipePromise && loadedModelDir === modelDir) return pipePromise
	env.allowRemoteModels = false
	env.allowLocalModels = true
	env.localModelPath = path.resolve(path.dirname(modelDir))
	loadedModelDir = modelDir
	pipePromise = pipeline("feature-extraction", path.basename(modelDir), {
		dtype: "q8",
	})
	return pipePromise
}

export const transformersEmbedBackend: EmbedBackendType = {
	id: EMBED_BACKEND_ENUM.TRANSFORMERS,
	capabilities: { local: true, normalized: true },
	embed: async (domia, texts) => {
		if (!texts.length) return []
		try {
			const modelDir =
				domia.llmModelConfig?.embedModelPath?.trim() || DEFAULT_EMBED_MODEL_PATH
			const pipe = await getPipe(modelDir)
			const out = await pipe(texts, { pooling: "mean", normalize: true })
			return out.tolist() as number[][]
		} catch (err) {
			embeddingsLogger.warn("transformers embed failed", {
				err,
				domiaId: domia.id,
			})
			return null
		}
	},
}
