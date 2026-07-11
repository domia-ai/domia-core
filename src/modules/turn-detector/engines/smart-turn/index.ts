import path from "path"
import fs from "fs"

import type * as OrtModuleType from "onnxruntime-node"

import { TURN_DETECTOR_ENGINE_ENUM } from "@/db"
import { audioCaptureLogger } from "@/utils"
import { computeWhisperLogMel, TURN_DETECTOR_MELS } from "../../utils/features"
import type { TurnDetectorEngineAdapterType } from "../../types"

let ortPromise: Promise<typeof OrtModuleType> | null = null
// lazy: onnxruntime-node costs ~16MB RSS at import — only pay when the engine runs
const loadOrt = (): Promise<typeof OrtModuleType> =>
	(ortPromise ??= import("onnxruntime-node"))

const sessions = new Map<string, Promise<OrtModuleType.InferenceSession>>()

const resolveModelPath = (modelPath: string): string => path.resolve(modelPath)

const getSession = (
	modelPath: string,
): Promise<OrtModuleType.InferenceSession> => {
	const resolved = resolveModelPath(modelPath)
	let session = sessions.get(resolved)
	if (!session) {
		session = loadOrt().then((ort) =>
			ort.InferenceSession.create(resolved, {
				interOpNumThreads: 1,
				intraOpNumThreads: 1,
			}),
		)
		sessions.set(resolved, session)
	}
	return session
}

const available = (modelPath: string): boolean =>
	fs.existsSync(resolveModelPath(modelPath))

export const smartTurnDetector: TurnDetectorEngineAdapterType = {
	id: TURN_DETECTOR_ENGINE_ENUM.SMART_TURN,
	capabilities: { sampleRate: 16000, mels: TURN_DETECTOR_MELS },
	available,
	warm: (modelPath) => {
		if (available(modelPath)) void getSession(modelPath).catch(() => undefined)
	},
	predict: async (audio16k, modelPath, threshold = 0.5) => {
		if (!available(modelPath)) return null
		try {
			const ort = await loadOrt()
			const session = await getSession(modelPath)
			const { data, frames } = computeWhisperLogMel(audio16k)
			const tensor = new ort.Tensor("float32", data, [
				1,
				TURN_DETECTOR_MELS,
				frames,
			])
			const res = await session.run({ input_features: tensor })
			const probability = (res.logits.data as Float32Array)[0]
			return { probability, complete: probability >= threshold }
		} catch (err) {
			audioCaptureLogger.warn("turn-detector inference failed", { err })
			return null
		}
	},
}
