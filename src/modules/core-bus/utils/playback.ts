import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { playAudioStream, runSox } from "@/modules/audio-playback"
import { notePlaybackStarted } from "@/modules/audio-capture"
import { DEFAULT_PLAYBACK_TRUNCATION_REPLAY_ENABLED } from "@/db"
import { createWavStreamWriter, domiaBusLogger } from "@/utils"
import { registerAudioForServing } from "./audio"
import { getStreamingSink } from "./streaming-sink"
import type {
	CoreBusContextType,
	PlaybackOutcomeType,
	SinkPositionFidelityType,
	StreamingSinkType,
	StreamMetaType,
	StreamAudioFormatType,
} from "../types"

export const DEFAULT_SAMPLE_RATE = 24000
export const DEFAULT_CHANNELS = 1
const TRUNCATION_REPLAY_OVERLAP_MS = 250

const finalizeArchive = async (
	writer: ReturnType<typeof createWavStreamWriter>,
	interactionId: string,
): Promise<string | undefined> => {
	try {
		const filePath = await writer.finalize()
		registerAudioForServing(interactionId, filePath)
		return filePath
	} catch (err) {
		domiaBusLogger.warn("archival finalize failed (best-effort)", { err })
		return undefined
	}
}

const outcomePosition = (
	meta: StreamMetaType,
	fidelity: SinkPositionFidelityType,
	interrupted: boolean,
	enginePlayedMs?: number,
): Pick<
	PlaybackOutcomeType,
	"positionMs" | "positionFidelity" | "heardText"
> => {
	const ledger = meta.ledger
	if (!ledger) return {}
	const positionMs = enginePlayedMs ?? ledger.positionMs()
	if (positionMs === undefined) return {}
	return {
		positionMs: Math.round(positionMs),
		positionFidelity: fidelity,
		heardText:
			interrupted && ledger.wordLevelHeard
				? ledger.heardTextAt(positionMs, fidelity)
				: undefined,
	}
}

const streamToSink = async (
	ctx: CoreBusContextType,
	audio: AsyncIterable<Buffer>,
	meta: StreamMetaType,
	format: StreamAudioFormatType,
	sink: StreamingSinkType,
): Promise<PlaybackOutcomeType> => {
	let firstChunkEmitted = false
	let interrupted = false
	const writer = createWavStreamWriter(
		meta.interactionId,
		format.sampleRate,
		format.channels,
		16,
		"tts",
	)
	let wroteAny = false
	try {
		await sink.begin?.(format)
		try {
			for await (const chunk of audio) {
				if (meta.ledger?.isPaused()) {
					await meta.ledger.waitResume()
				}
				if (meta.aborted?.()) {
					interrupted = true
					break
				}
				writer.write(chunk)
				wroteAny = true
				if (!firstChunkEmitted) {
					firstChunkEmitted = true
					meta.ledger?.markFirstChunk()
					notePlaybackStarted(ctx.domia.id)
					meta.onFirstChunk?.()
					publishToDomiaBus(
						ctx.domia.id,
						DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED,
						{
							interactionId: meta.interactionId,
							originDomiaKey: meta.originDomiaKey,
						},
					)
				}
				await sink.write(chunk)
			}
		} finally {
			await sink.end?.()
		}
		if (!wroteAny)
			return { filePath: undefined, interrupted, audioStarted: false }
		const filePath = await finalizeArchive(writer, meta.interactionId)
		return {
			filePath,
			interrupted,
			audioStarted: firstChunkEmitted,
			...outcomePosition(
				meta,
				sink.capabilities?.position ?? "none",
				interrupted,
			),
		}
	} finally {
		await writer.abort()
	}
}

export const playStreamedAudio = async (
	ctx: CoreBusContextType,
	audio: AsyncIterable<Buffer>,
	meta: StreamMetaType,
	format: StreamAudioFormatType,
): Promise<PlaybackOutcomeType> => {
	const sink = getStreamingSink(meta.interactionId)
	if (sink) return streamToSink(ctx, audio, meta, format, sink)
	let firstChunkEmitted = false
	let aborted = false
	const writer = createWavStreamWriter(
		meta.interactionId,
		format.sampleRate,
		format.channels,
		16,
		"tts",
	)
	let wroteAny = false
	try {
		const captured = (async function* (): AsyncIterable<Buffer> {
			for await (const chunk of audio) {
				if (meta.aborted?.()) {
					aborted = true
					break
				}
				writer.write(chunk)
				wroteAny = true
				yield chunk
			}
		})()

		const result = await playAudioStream(ctx.domia, captured, {
			sampleRate: format.sampleRate,
			channels: format.channels,
			bitsPerSample: 16,
			onFirstChunkWritten: () => {
				if (firstChunkEmitted) return
				firstChunkEmitted = true
				meta.ledger?.markFirstChunk()
				notePlaybackStarted(ctx.domia.id)
				meta.onFirstChunk?.()
				publishToDomiaBus(ctx.domia.id, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
					interactionId: meta.interactionId,
					originDomiaKey: meta.originDomiaKey,
					playedLocally: true,
				})
			},
		})
		if (result && result.success === false) {
			throw new Error(`audio playback failed (engine ${result.engine})`)
		}
		let interrupted = result?.interrupted === true || aborted
		const audioStarted = firstChunkEmitted

		if (!wroteAny) return { filePath: undefined, interrupted, audioStarted }
		const filePath = await finalizeArchive(writer, meta.interactionId)

		let playedMs = result?.playedMs ?? undefined
		const replayEnabled =
			ctx.domia.audioPlaybackConfig?.truncationReplayEnabled ??
			DEFAULT_PLAYBACK_TRUNCATION_REPLAY_ENABLED
		if (
			result?.truncated === true &&
			!interrupted &&
			replayEnabled &&
			filePath &&
			!meta.aborted?.()
		) {
			const trimStartMs = Math.max(
				0,
				(result.playedMs ?? 0) - TRUNCATION_REPLAY_OVERLAP_MS,
			)
			domiaBusLogger.warn("✂️ replaying truncated tail from archive", {
				interactionId: meta.interactionId,
				playedMs: result.playedMs,
				expectedMs: result.expectedMs,
				trimStartMs,
			})
			const replay = await runSox(ctx.domia, filePath, trimStartMs).catch(
				(err) => {
					domiaBusLogger.warn("truncation replay failed (best-effort)", {
						err,
						interactionId: meta.interactionId,
					})
					return undefined
				},
			)
			if (replay?.interrupted) interrupted = true
			else if (replay?.success) playedMs = result.expectedMs
		}
		return {
			filePath,
			interrupted,
			audioStarted,
			...outcomePosition(meta, "estimated", interrupted, playedMs),
		}
	} finally {
		await writer.abort()
	}
}
