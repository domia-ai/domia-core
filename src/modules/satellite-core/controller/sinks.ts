import { readFile } from "fs/promises"

import {
	setPresenceStatus,
	openAudioStream,
	writeAudioStream,
	closeAudioStream,
	type StreamingSinkType,
} from "@/modules/core-bus"
import { notePlaybackReference } from "@/modules/audio-capture"
import { wavFileToPcmChunks } from "@/utils"

import type {
	SatelliteSessionDepsType,
	SatelliteSessionStateType,
} from "../types"
import type { createAcousticControls } from "./acoustic"

export const sendViaSink = async (
	sink: StreamingSinkType,
	filePath: string,
): Promise<void> => {
	const header = await readFile(filePath)
	if (header.length < 44 || header.toString("ascii", 0, 4) !== "RIFF") return
	const rawChannels = header.readUInt16LE(22)
	const sampleRate = header.readUInt32LE(24)
	const channels = rawChannels === 2 ? 2 : 1
	await sink.begin?.({ sampleRate, channels })
	try {
		for await (const chunk of wavFileToPcmChunks(filePath)) {
			await sink.write(chunk)
		}
	} finally {
		await sink.end?.()
	}
}

export const createSatelliteSinks = (
	state: SatelliteSessionStateType,
	deps: SatelliteSessionDepsType,
	acoustic: ReturnType<typeof createAcousticControls>,
) => {
	const { transport } = deps
	const { referenceKey } = acoustic

	const acquireOutput = (): Promise<() => void> => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const prev = state.outputTail
		state.outputTail = state.outputTail.then(() => gate)
		return prev.then(() => release)
	}

	const makeSink = (onWrite?: () => void): StreamingSinkType => {
		let release: (() => void) | null = null
		let sinkRate = 24000
		let sinkChannels = 1
		return {
			capabilities: transport.outputCapabilities,
			pause: transport.pauseAudio,
			resume: transport.resumeAudio,
			begin: async (format) => {
				sinkRate = format.sampleRate
				sinkChannels = format.channels
				release = await acquireOutput()
				try {
					setPresenceStatus(state.identity.domiaKey, "speaking")
					transport.beginAudio(format, state.activeInteractionId ?? undefined)
				} catch (err) {
					release()
					release = null
					throw err
				}
			},
			write: (chunk) => {
				onWrite?.()
				if (state.ttsFirstSentAt === 0) state.ttsFirstSentAt = Date.now()
				state.ttsBytesSent += chunk.length
				if (state.identity.wakeWordConfig?.echoResidualGateEnabled)
					notePlaybackReference(
						referenceKey(),
						chunk,
						sinkRate,
						sinkChannels,
						state.identity.wakeWordConfig.echoReferenceSeconds,
					)
				state.echoWindowUntil =
					state.ttsFirstSentAt +
					state.ttsBytesSent / ((sinkRate * sinkChannels * 2) / 1000) +
					(state.identity.wakeWordConfig?.echoSuppressMarginMs ?? 500)
				return transport.writeAudio(chunk)
			},
			end: () => {
				try {
					transport.endAudio()
				} finally {
					release?.()
					release = null
				}
			},
		}
	}

	const makeCaptureSink = (
		interactionId: string,
		onFirstChunk: () => void,
	): StreamingSinkType => {
		let release: (() => void) | null = null
		let announced = false
		return {
			capabilities: transport.outputCapabilities,
			pause: transport.pauseAudio,
			resume: transport.resumeAudio,
			begin: async (format) => {
				release = await acquireOutput()
				setPresenceStatus(state.identity.domiaKey, "speaking")
				openAudioStream(interactionId, format.sampleRate, format.channels)
			},
			write: async (chunk) => {
				await writeAudioStream(interactionId, chunk)
				if (!announced) {
					announced = true
					onFirstChunk()
				}
			},
			end: () => {
				closeAudioStream(interactionId)
				release?.()
				release = null
			},
		}
	}

	const connectionSink = makeSink()
	const announceFn = transport.announce
		? (url: string) => transport.announce?.(url)
		: null

	return {
		acquireOutput,
		makeSink,
		makeCaptureSink,
		connectionSink,
		announceFn,
	}
}
