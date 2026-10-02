import { pipelineElapsed } from "@/modules/session-manager"
import {
	wrapPcmToWav,
	writeWavToTemp,
	domiaError,
	TTS_ERRORS,
	domiaBusLogger,
} from "@/utils"

import { ladderCols } from "./stage-ladder"
import { pushInteractionFirstAudio } from "./interaction-runtime"
import type {
	FirstAudioColsType,
	FirstAudioMarkType,
	ReplyAudioFileType,
	StreamAudioFormatType,
} from "../types"

const MAX_TRACKED = 256

const firstAudioByInteraction = new Map<string, FirstAudioColsType>()

const entryFor = (interactionId: string): FirstAudioColsType => {
	const existing = firstAudioByInteraction.get(interactionId)
	if (existing) return existing
	if (firstAudioByInteraction.size >= MAX_TRACKED) {
		const oldest = firstAudioByInteraction.keys().next().value
		if (oldest) firstAudioByInteraction.delete(oldest)
	}
	const fresh: FirstAudioColsType = {}
	firstAudioByInteraction.set(interactionId, fresh)
	return fresh
}

export const markFirstAudio = (
	interactionId: string | undefined,
	mark: FirstAudioMarkType = {},
): void => {
	if (!interactionId) return
	const entry = entryFor(interactionId)
	const now = Date.now()
	entry.ttfaMs ??=
		pipelineElapsed(interactionId) ??
		(mark.since !== undefined ? now - mark.since : undefined)
	pushInteractionFirstAudio(interactionId, mark.played === true)
	if (!mark.played) return
	const speechEndAt = ladderCols(interactionId).speechEndAt
	if (speechEndAt !== undefined) entry.perceivedTtfaMs ??= now - speechEndAt
}

export const firstAudioCols = (interactionId: string): FirstAudioColsType => ({
	...firstAudioByInteraction.get(interactionId),
})

export const collectReplyAudio = async (
	interactionId: string,
	audio: AsyncIterable<Buffer>,
	format: StreamAudioFormatType,
): Promise<ReplyAudioFileType> => {
	const chunks: Buffer[] = []
	for await (const chunk of audio) {
		if (chunk.length === 0) continue
		if (chunks.length === 0) markFirstAudio(interactionId)
		chunks.push(chunk)
	}
	if (chunks.length === 0)
		throw domiaError(TTS_ERRORS.EMPTY_AUDIO, {
			logger: domiaBusLogger,
			meta: { interactionId, site: "collectReplyAudio" },
		})
	const wav = wrapPcmToWav(
		Buffer.concat(chunks),
		format.sampleRate,
		format.channels,
		16,
	)
	const filePath = await writeWavToTemp(wav, interactionId, "tts")
	return { filePath, chunkCount: chunks.length }
}
