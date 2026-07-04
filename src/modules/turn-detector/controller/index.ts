import path from "path"
import fs from "fs"

import * as ort from "onnxruntime-node"

import { audioCaptureLogger } from "@/utils"
import { computeWhisperLogMel, TURN_DETECTOR_MELS } from "../utils/features"
import type { TurnDetectorResultType } from "../types"

const sessions = new Map<string, Promise<ort.InferenceSession>>()

const resolveModelPath = (modelPath: string): string => path.resolve(modelPath)

const getSession = (modelPath: string): Promise<ort.InferenceSession> => {
	const resolved = resolveModelPath(modelPath)
	let session = sessions.get(resolved)
	if (!session) {
		session = ort.InferenceSession.create(resolved, {
			interOpNumThreads: 1,
			intraOpNumThreads: 1,
		})
		sessions.set(resolved, session)
	}
	return session
}

export const turnDetectorAvailable = (modelPath: string): boolean =>
	fs.existsSync(resolveModelPath(modelPath))

export const predictTurnComplete = async (
	audio16k: Float32Array,
	modelPath: string,
	threshold = 0.5,
): Promise<TurnDetectorResultType | null> => {
	if (!turnDetectorAvailable(modelPath)) return null
	try {
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
}

export const warmTurnDetector = (modelPath: string): void => {
	if (turnDetectorAvailable(modelPath))
		void getSession(modelPath).catch(() => undefined)
}
