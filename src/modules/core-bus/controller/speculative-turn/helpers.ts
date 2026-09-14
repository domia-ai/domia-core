import { domiaBusLogger } from "@/utils"
import { type SpeculativeCaptureResultType } from "@/modules/audio-capture"
import type { SttStreamSessionType } from "@/modules/stt-engine"
import { ttsAdapterToPcmChunks, ttsPoolBusy } from "@/modules/tts-engine"
import {
	sentenceTuningFromDomia,
	cutFirstUnit,
	isSpeakable,
	normalizeWords,
} from "../../utils"
import type { CoreBusContextType, SpeculationType } from "../../types"

export const resolveEndpointDecisionAt = (
	capture: SpeculativeCaptureResultType,
): number | undefined => {
	const explicit = capture.endpointDecisionAt?.()
	if (explicit != null) return explicit
	const speechEnd = capture.speechEndAt()
	const observed = capture.endpointObservedMs()
	return speechEnd != null && observed != null
		? speechEnd + observed
		: undefined
}

export const collectPcm = async (
	ctx: CoreBusContextType,
	text: string,
): Promise<Buffer | null> => {
	const tts = ctx.features.tts
	if (!tts) return null
	const parts: Buffer[] = []
	for await (const chunk of ttsAdapterToPcmChunks(
		ctx.domia,
		tts.adapter,
		text,
	)) {
		parts.push(chunk)
	}
	return parts.length > 0 ? Buffer.concat(parts) : null
}

export const wireFirstUnitDivert = (
	ctx: CoreBusContextType,
	me: SpeculationType,
	interactionId: string,
): void => {
	const { domia } = ctx
	const out = me.outQueue
	if (!out) return
	const tuning = sentenceTuningFromDomia(domia)
	void (async () => {
		let buffer = ""
		let flushed = false
		try {
			for await (const token of me.queue.iter()) {
				if (out.isClosed()) {
					me.cancelled = true
					break
				}
				if (flushed) {
					out.push(token)
					continue
				}
				buffer += token
				const cut = cutFirstUnit(buffer, tuning)
				if (!cut) continue
				flushed = true
				const eligible =
					!me.cancelled &&
					!me.handedOff &&
					isSpeakable(cut.sentence) &&
					!ttsPoolBusy()
				if (eligible) {
					me.firstUnitText = cut.sentence
					me.firstUnitPcm = collectPcm(ctx, cut.sentence).catch(
						(err: unknown) => {
							domiaBusLogger.warn("spec-TTS first unit failed (best-effort)", {
								err,
								generation: me.generation,
							})
							return null
						},
					)
					domiaBusLogger.info(
						`🔮 spec-TTS priming first unit g${me.generation}: "${cut.sentence.slice(0, 40)}"`,
						{ domiaId: domia.id, interactionId },
					)
					if (cut.remaining) out.push(cut.remaining)
				} else {
					out.push(buffer)
				}
				buffer = ""
			}
			if (!flushed && buffer) out.push(buffer)
		} finally {
			out.close()
		}
	})()
}

export const isCancelled = (speculation: SpeculationType): boolean =>
	speculation.cancelled

export const transcriptsCompatible = (
	speculative: string,
	final: string,
): boolean => normalizeWords(speculative) === normalizeWords(final)

export const openSttSession = (
	ctx: CoreBusContextType,
): SttStreamSessionType | null => {
	const { domia, features } = ctx
	const create = features.stt?.adapter.createSession
	if (!create) return null
	try {
		const session = create(domia)
		domiaBusLogger.info(`🔮 incremental STT session open`, {
			domiaId: domia.id,
		})
		return session
	} catch (err) {
		domiaBusLogger.warn(
			`🔮 incremental STT unavailable — snapshot decode fallback`,
			{ domiaId: domia.id, err },
		)
		return null
	}
}
