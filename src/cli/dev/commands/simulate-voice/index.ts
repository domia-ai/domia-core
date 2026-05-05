import fs from "fs"
import path from "path"

import {
	publishToDomiaBus,
	subscribeToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
} from "@/buses"
import { setupCoreBus, normalizeRuntimeCapabilities } from "@/setups"
import { initialize } from "@/modules/config-engine"
import { formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"
import type {
	SttDonePayloadType,
	LlmDonePayloadType,
	InteractionFailedPayloadType,
} from "@/modules/core-bus"

const DEFAULT_TIMEOUT_MS = 60_000

export const simulateVoiceCommand = async (filePath: string) => {
	const audioPath = path.resolve(filePath)

	if (!fs.existsSync(audioPath)) {
		devCliLogger.error("❌ Audio file not found:", audioPath)
		process.exit(1)
	}

	const domia = await initialize()
	if (!domia?.runtimeCapabilities) {
		devCliLogger.error(
			"❌ Could not load DOMIA from DB (run dev:smart once to seed)",
		)
		process.exit(1)
	}
	const domiaId = domia.id
	const runtimeCapabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities,
	)

	setupCoreBus({ domia, runtimeCapabilities, mqttClient: null })

	const t0 = Date.now()
	const stages: Record<string, number> = {}

	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.STT_DONE,
		(payload: SttDonePayloadType) => {
			stages.sttDone = Date.now() - t0
			devCliLogger.info(
				`📝 STT_DONE @ ${formatDuration(stages.sttDone)} — "${payload.transcript}"`,
			)
		},
	)

	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.LLM_DONE,
		(payload: LlmDonePayloadType) => {
			stages.llmDone = Date.now() - t0
			const preview =
				payload.reply.length > 80
					? payload.reply.slice(0, 80) + "..."
					: payload.reply
			devCliLogger.info(
				`🧠 LLM_DONE @ ${formatDuration(stages.llmDone)} — "${preview}"`,
			)
		},
	)

	devCliLogger.info(`🎙️ Simulating wake → AUDIO_READY with ${audioPath}`)

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`simulate-voice timeout after ${DEFAULT_TIMEOUT_MS}ms`))
		}, DEFAULT_TIMEOUT_MS)

		subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, () => {
			stages.ttsDone = Date.now() - t0
			devCliLogger.info(`🗣️ TTS_DONE @ ${formatDuration(stages.ttsDone)}`)
			clearTimeout(timeout)
			resolve()
		})

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
			(payload: InteractionFailedPayloadType) => {
				clearTimeout(timeout)
				reject(
					new Error(
						`Interaction failed at ${payload.step ?? "unknown"}: ${payload.error}`,
					),
				)
			},
		)

		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath: audioPath,
		})
	})

	const wallEnd = Date.now() - t0

	devCliLogger.info("=== STAGE BREAKDOWN ===")
	devCliLogger.info(`  STT:   ${formatDuration(stages.sttDone)}`)
	devCliLogger.info(
		`  LLM:   ${formatDuration((stages.llmDone ?? 0) - (stages.sttDone ?? 0))}`,
	)
	devCliLogger.info(
		`  TTS:   ${formatDuration((stages.ttsDone ?? 0) - (stages.llmDone ?? 0))}`,
	)
	devCliLogger.info(
		`  TOTAL pipeline (excl playback): ${formatDuration(stages.ttsDone)}`,
	)
	devCliLogger.info(
		`  WALL clock (incl playback start): ${formatDuration(wallEnd)}`,
	)
}
