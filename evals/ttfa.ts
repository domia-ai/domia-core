import {
	connectWyomingSatellite,
	createWyomingTransport,
} from "@/modules/satellite-protocols/wyoming"
import {
	DEFAULT_SENTENCE_TUNING,
	splitSentences,
	cutFirstUnit,
	getSatelliteSinkFor,
} from "@/modules/core-bus/utils"
import type { SentenceFlushTuningType } from "@/modules/core-bus/types/sentence-buffer"
import {
	cachedTtsPcmChunks,
	cacheablePhrasesFor,
	isPhraseCacheable,
	phraseCacheKey,
	phraseCacheStats,
	quantizeTtsVoice,
	resetPhraseCache,
	type TtsEngineAdapterType,
} from "@/modules/tts-engine"
import { registerHostedIdentity } from "@/modules/core"
import {
	DEFAULT_TTS_PHRASE_CACHE_MAX_CHARS,
	DEFAULT_TTS_PHRASE_CACHE_VOICE_STEP,
	TTS_ENGINE_ENUM,
} from "@/db"
import { SUPPORTED_LANGUAGES } from "@/utils"
import { getDomia } from "@/test-utils"

import { makeChecker, sleep, createFakeWyomingSatellite, env } from "./lib"
import type { FakeWyomingEventType } from "./types"

const checker = makeChecker()

registerHostedIdentity(env.EVAL_DOMIA_KEY)

const tokenize = (text: string): string[] => text.match(/\s*\S+/g) ?? []

const tuningWith = (
	overrides: Partial<SentenceFlushTuningType>,
): SentenceFlushTuningType => ({
	...DEFAULT_SENTENCE_TUNING,
	firstFlushMaxMs: 0,
	...overrides,
})

const splitWithTokens = async (
	text: string,
	tuning: SentenceFlushTuningType,
): Promise<{ units: string[]; firstUnitAfterTokens: number }> => {
	let consumed = 0
	const tokens = (async function* (): AsyncIterable<string> {
		for (const token of tokenize(text)) {
			consumed++
			yield await Promise.resolve(token)
		}
	})()
	const units: string[] = []
	let firstUnitAfterTokens = 0
	for await (const unit of splitSentences(tokens, tuning)) {
		if (units.length === 0) firstUnitAfterTokens = consumed
		units.push(unit)
	}
	return { units, firstUnitAfterTokens }
}

const runFragmentSplitterChecks = async (): Promise<void> => {
	console.log("\nfirst-fragment splitter (sentenceFirstFragmentMaxWords)")
	const off = tuningWith({ firstFragmentMaxWords: 0 })
	const on = tuningWith({ firstFragmentMaxWords: 8 })

	const en = "Sure, I can help you with that. Let me check the kitchen."
	const enOff = await splitWithTokens(en, off)
	const enOn = await splitWithTokens(en, on)
	checker.check(
		"EN off: first unit unchanged (baseline rules)",
		enOff.units[0] === "Sure," && enOff.firstUnitAfterTokens === 5,
		`units=${JSON.stringify(enOff.units)} after=${enOff.firstUnitAfterTokens}`,
	)
	checker.check(
		"EN on: first fragment cut at the comma as soon as it is seen",
		enOn.units[0] === "Sure," && enOn.firstUnitAfterTokens === 2,
		`units=${JSON.stringify(enOn.units)} after=${enOn.firstUnitAfterTokens}`,
	)
	checker.check(
		"EN on: remaining sentence intact, no double punctuation",
		enOn.units[1] === "I can help you with that." &&
			enOn.units[2] === "Let me check the kitchen.",
		JSON.stringify(enOn.units),
	)
	checker.check(
		"EN on: full text reassembles losslessly",
		enOn.units.join(" ") === en,
		enOn.units.join(" "),
	)

	const dash = "Well—I think the office lights are still on."
	const dashOn = await splitWithTokens(dash, on)
	checker.check(
		"EN on: attached em-dash cuts before the dash and drops it",
		dashOn.units[0] === "Well" && dashOn.units[1].startsWith("I think"),
		JSON.stringify(dashOn.units),
	)
	const spacedDash = "Okay - the bedroom light is off now."
	const spacedOn = await splitWithTokens(spacedDash, on)
	checker.check(
		"EN on: spaced hyphen is a clause boundary, hyphen dropped",
		spacedOn.units[0] === "Okay" && spacedOn.units[1].startsWith("the bedroom"),
		JSON.stringify(spacedOn.units),
	)

	const number = "It costs 1,000 dollars, which is a lot."
	const numberOn = await splitWithTokens(number, on)
	checker.check(
		"EN on: comma inside a number never cuts (no mid-word cuts)",
		numberOn.units[0] === "It costs 1,000 dollars,",
		JSON.stringify(numberOn.units),
	)

	const compound = "The well-known singer, Adele, is touring."
	const compoundOn = await splitWithTokens(compound, on)
	checker.check(
		"EN on: hyphenated compound word is not a boundary",
		compoundOn.units[0] === "The well-known singer,",
		JSON.stringify(compoundOn.units),
	)

	const long =
		"one two three four five six seven eight nine, and then the rest of it."
	const longOn = await splitWithTokens(
		long,
		tuningWith({ firstFragmentMaxWords: 8, firstUnitMaxWords: 20 }),
	)
	const longOff = await splitWithTokens(
		long,
		tuningWith({ firstFragmentMaxWords: 0, firstUnitMaxWords: 20 }),
	)
	checker.check(
		"EN on: a clause longer than the cap falls back to the existing rules",
		longOn.units[0] === longOff.units[0],
		`on=${longOn.units[0]} off=${longOff.units[0]}`,
	)

	const wordCap = await splitWithTokens(
		"I really think that this one is fine, honestly.",
		tuningWith({ firstFragmentMaxWords: 12, firstUnitMaxWords: 5 }),
	)
	checker.check(
		"sentenceFirstUnitMaxWords still bounds the first unit when no boundary shows up first",
		wordCap.units[0] === "I really think that this",
		JSON.stringify(wordCap.units),
	)

	const hard = await splitWithTokens("Okay. Sure, thing is fine.", on)
	checker.check(
		"hard terminator keeps precedence over the fragment cut",
		hard.units[0] === "Okay.",
		JSON.stringify(hard.units),
	)

	const es = "Claro, la luz de la cocina está encendida. ¿Algo más?"
	const esOn = await splitWithTokens(es, on)
	checker.check(
		"ES on: first fragment at the comma",
		esOn.units[0] === "Claro," && esOn.firstUnitAfterTokens === 2,
		`units=${JSON.stringify(esOn.units)} after=${esOn.firstUnitAfterTokens}`,
	)
	const esDash = "Sí — ya está apagada."
	const esDashOn = await splitWithTokens(esDash, on)
	checker.check(
		"ES on: spaced em-dash cut keeps the accented word intact",
		esDashOn.units[0] === "Sí" && esDashOn.units[1] === "ya está apagada.",
		JSON.stringify(esDashOn.units),
	)
	const esNoBoundary = "La luz del salón sigue encendida todavía."
	const esPlain = await splitWithTokens(esNoBoundary, on)
	checker.check(
		"ES on: no boundary → first unit identical to the off behaviour",
		esPlain.units[0] === (await splitWithTokens(esNoBoundary, off)).units[0],
		JSON.stringify(esPlain.units),
	)

	const specCut = cutFirstUnit("Sure, I can do that for", on)
	checker.check(
		"cutFirstUnit (speculative TTS first unit) honours the fragment knob",
		specCut?.sentence === "Sure," && specCut.remaining === "I can do that for",
		JSON.stringify(specCut),
	)
	const specOff = cutFirstUnit("Sure, I", off)
	checker.check(
		"cutFirstUnit with the knob off leaves a short clause alone",
		specOff === null,
		JSON.stringify(specOff),
	)
	for (const unit of [
		...enOn.units,
		...dashOn.units,
		...esOn.units,
		...esDashOn.units,
	]) {
		checker.check(
			`unit "${unit}" ends without a dangling dash or doubled punctuation`,
			!/[—–-]$/.test(unit) && !/[,;:.!?]{2}$/.test(unit),
		)
	}
}

const fakeAdapter = (calls: string[]): TtsEngineAdapterType => ({
	id: TTS_ENGINE_ENUM.KOKORO,
	capabilities: {
		streaming: true,
		sampleRate: 24000,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en"],
	},
	run: () => Promise.reject(new Error("run() unused in this eval")),
	runStream: async function* (_domia, text) {
		calls.push(text)
		await sleep(5)
		yield Buffer.alloc(1000, 1)
		yield Buffer.alloc(1000, 2)
	},
})

const drain = async (audio: AsyncIterable<Buffer>): Promise<number> => {
	let bytes = 0
	for await (const chunk of audio) bytes += chunk.length
	return bytes
}

const runPhraseCacheChecks = async (): Promise<void> => {
	console.log("\nphrase cache (keying, coverage, caps)")
	for (const language of SUPPORTED_LANGUAGES) {
		const phrases = cacheablePhrasesFor(language)
		const tooLong = phrases.filter(
			(p) => p.length > DEFAULT_TTS_PHRASE_CACHE_MAX_CHARS,
		)
		checker.check(
			`${language}: every fixed catalog phrase fits the default cache limit (${phrases.length} phrases)`,
			phrases.length > 0 && tooLong.length === 0,
			`tooLong=${JSON.stringify(tooLong)}`,
		)
		checker.check(
			`${language}: templated phrases are excluded from warm-up`,
			phrases.every((p) => !/[{}]/.test(p)),
		)
	}

	const cacheTts = {
		phraseCacheEnabled: true,
		phraseCacheEntries: 2,
		phraseCacheMaxChars: 40,
		phraseCacheMaxBytes: 100_000,
		speed: 1,
		pitch: 1,
		silenceScale: 0.2,
	}
	const domia = getDomia({
		moduleSettingsOverrides: { emotionEngine: false },
		ttsConfigOverrides: cacheTts,
	})
	const esDomia = getDomia({
		moduleSettingsOverrides: { emotionEngine: false },
		ttsConfigOverrides: { ...cacheTts, language: "es" },
	})
	const calls: string[] = []
	const adapter = fakeAdapter(calls)
	resetPhraseCache()

	const q = quantizeTtsVoice(
		{
			voiceName: "af_heart",
			speed: 1.012,
			pitch: 0.987,
			silenceScale: 0.213,
		},
		DEFAULT_TTS_PHRASE_CACHE_VOICE_STEP,
	)
	checker.check(
		"voice quantization snaps mood drift to the cache grid",
		q.speed === 1 && q.pitch === 1 && q.silenceScale === 0.2,
		JSON.stringify(q),
	)
	const base = { voiceName: "af_heart", speed: 1, pitch: 1, silenceScale: 0.2 }
	const kBase = phraseCacheKey(domia, adapter, "Done.", base)
	checker.check(
		"key changes with voice name",
		kBase !==
			phraseCacheKey(domia, adapter, "Done.", {
				...base,
				voiceName: "am_adam",
			}),
	)
	checker.check(
		"key changes with speed",
		kBase !== phraseCacheKey(domia, adapter, "Done.", { ...base, speed: 1.1 }),
	)
	checker.check(
		"key changes with language",
		kBase !== phraseCacheKey(esDomia, adapter, "Done.", base),
	)
	checker.check(
		"key changes with engine",
		kBase !==
			phraseCacheKey(
				domia,
				{ ...adapter, id: TTS_ENGINE_ENUM.POCKET },
				"Done.",
				base,
			),
	)
	checker.check(
		"key is case-sensitive on text",
		kBase !== phraseCacheKey(domia, adapter, "done.", base),
	)
	checker.check(
		"cacheable = enabled and within max chars",
		isPhraseCacheable(domia.ttsConfig, "Done.") &&
			!isPhraseCacheable(domia.ttsConfig, "x".repeat(41)),
	)

	await drain(cachedTtsPcmChunks(domia, adapter, "Done."))
	await drain(cachedTtsPcmChunks(domia, adapter, "Done."))
	checker.check(
		"second request for the same phrase is a cache hit (one synthesis)",
		calls.length === 1 && phraseCacheStats().hits === 1,
		`calls=${calls.length} stats=${JSON.stringify(phraseCacheStats())}`,
	)
	await drain(
		cachedTtsPcmChunks(domia, adapter, "Done.", {
			voice: { ...base, speed: 1.02 },
		}),
	)
	checker.check(
		"mood-drifted voice within the grid still hits",
		calls.length === 1,
		`calls=${calls.length}`,
	)
	await drain(
		cachedTtsPcmChunks(domia, adapter, "Done.", {
			voice: { ...base, speed: 1.1 },
		}),
	)
	checker.check(
		"a different quantized voice synthesizes again",
		calls.length === 2,
		`calls=${calls.length}`,
	)
	await drain(cachedTtsPcmChunks(domia, adapter, "Got it."))
	checker.check(
		"entries cap evicts the oldest phrase",
		phraseCacheStats().entries === 2,
		JSON.stringify(phraseCacheStats()),
	)
	const [a, b] = await Promise.all([
		drain(cachedTtsPcmChunks(domia, adapter, "On it.")),
		drain(cachedTtsPcmChunks(domia, adapter, "On it.")),
	])
	checker.check(
		"concurrent requests dedupe to one synthesis and both get full audio",
		a === 2000 &&
			b === 2000 &&
			calls.filter((c) => c === "On it.").length === 1,
		`a=${a} b=${b} calls=${JSON.stringify(calls)}`,
	)
	const long = "This reply is longer than the configured max chars."
	await drain(cachedTtsPcmChunks(domia, adapter, long))
	await drain(cachedTtsPcmChunks(domia, adapter, long))
	checker.check(
		"over-limit text bypasses the cache",
		calls.filter((c) => c === long).length === 2,
	)

	resetPhraseCache()
	const tiny = getDomia({
		moduleSettingsOverrides: { emotionEngine: false },
		ttsConfigOverrides: {
			phraseCacheEnabled: true,
			phraseCacheEntries: 32,
			phraseCacheMaxChars: 40,
			phraseCacheMaxBytes: 2500,
		},
	})
	const tinyCalls: string[] = []
	const tinyAdapter = fakeAdapter(tinyCalls)
	await drain(cachedTtsPcmChunks(tiny, tinyAdapter, "Done."))
	await drain(cachedTtsPcmChunks(tiny, tinyAdapter, "Got it."))
	checker.check(
		"bytes cap evicts until the cache fits",
		phraseCacheStats().entries === 1 && phraseCacheStats().bytes === 2000,
		JSON.stringify(phraseCacheStats()),
	)
	resetPhraseCache()
}

const fakeConn = (): {
	events: FakeWyomingEventType[]
	write: (
		type: string,
		data?: Record<string, unknown>,
		payload?: Buffer,
	) => void
} => {
	const events: FakeWyomingEventType[] = []
	return {
		events,
		write: (type, data, payload) =>
			events.push({
				type,
				data: data ?? {},
				payload: payload ?? null,
				at: Date.now(),
			}),
	}
}

const runWyomingTransportChecks = async (): Promise<void> => {
	console.log("\nwyoming transport (streaming vs buffered delivery)")
	const streaming = fakeConn()
	const t = createWyomingTransport({
		conn: streaming,
		streamingTts: true,
		close: () => undefined,
		warn: () => undefined,
	})
	t.beginAudio({ sampleRate: 24000, channels: 1 }, "i1")
	const c1 = Buffer.alloc(3200, 7)
	const c2 = Buffer.alloc(1600, 9)
	await t.writeAudio(c1)
	checker.check(
		"streaming: first chunk forwarded before the next one exists",
		streaming.events.map((e) => e.type).join(",") === "audio-start,audio-chunk",
		streaming.events.map((e) => e.type).join(","),
	)
	await t.writeAudio(c2)
	await t.writeAudio(Buffer.alloc(0))
	t.endAudio()
	const types = streaming.events.map((e) => e.type)
	checker.check(
		"streaming: audio-start → chunk×2 → audio-stop, empty chunks skipped",
		types.join(",") === "audio-start,audio-chunk,audio-chunk,audio-stop",
		types.join(","),
	)
	checker.check(
		"streaming: chunk payloads and format travel intact",
		streaming.events[1].payload?.equals(c1) === true &&
			streaming.events[2].payload?.equals(c2) === true &&
			streaming.events[1].data.rate === 24000 &&
			streaming.events[1].data.width === 2 &&
			streaming.events[1].data.channels === 1,
		JSON.stringify(streaming.events[1].data),
	)

	const buffered = fakeConn()
	const b = createWyomingTransport({
		conn: buffered,
		streamingTts: false,
		close: () => undefined,
		warn: () => undefined,
	})
	b.beginAudio({ sampleRate: 22050, channels: 1 })
	await b.writeAudio(c1)
	await b.writeAudio(c2)
	checker.check(
		"buffered: nothing leaves before endAudio",
		buffered.events.length === 0,
		String(buffered.events.length),
	)
	b.endAudio()
	checker.check(
		"buffered: one burst start → chunks → stop in order",
		buffered.events.map((e) => e.type).join(",") ===
			"audio-start,audio-chunk,audio-chunk,audio-stop" &&
			buffered.events[0].data.rate === 22050,
		buffered.events.map((e) => e.type).join(","),
	)
	b.beginAudio({ sampleRate: 22050, channels: 1 })
	b.endAudio()
	checker.check(
		"buffered: a turn without audio still closes the start/stop frame",
		buffered.events
			.slice(4)
			.map((e) => e.type)
			.join(",") === "audio-start,audio-stop",
	)
}

const runWyomingWireChecks = async (): Promise<void> => {
	console.log("\nwyoming wire (fake satellite over TCP through satellite-core)")
	const fake = await createFakeWyomingSatellite()
	const satelliteId = "eval-wyoming-wire"
	const handle = connectWyomingSatellite(
		`127.0.0.1:${fake.port}`,
		getDomia({}),
		env.EVAL_DOMIA_KEY,
		satelliteId,
		{ streamingTts: true },
	)
	const ready = await fake.waitFor("run-satellite")
	checker.check("orchestrator connects out and starts the satellite run", ready)
	let sink = getSatelliteSinkFor(env.EVAL_DOMIA_KEY, satelliteId)
	for (let i = 0; i < 50 && !sink; i++) {
		await sleep(20)
		sink = getSatelliteSinkFor(env.EVAL_DOMIA_KEY, satelliteId)
	}
	checker.check("satellite sink registered for the identity", sink !== null)
	if (sink) {
		await sink.begin?.({ sampleRate: 24000, channels: 1 })
		const c1 = Buffer.alloc(4800, 3)
		await sink.write(c1)
		const firstArrived = await fake.waitFor("audio-chunk", 1)
		checker.check(
			"first PCM chunk reaches the satellite before the second is written",
			firstArrived &&
				fake.eventsOf("audio-chunk")[0]?.payload?.equals(c1) === true,
		)
		const c2 = Buffer.alloc(2400, 4)
		await sink.write(c2)
		await sink.end?.()
		const stopped = await fake.waitFor("audio-stop")
		const seq = fake.events
			.map((e) => e.type)
			.filter((t) => t.startsWith("audio-"))
			.join(",")
		checker.check(
			"framed sequence audio-start → chunk → chunk → audio-stop",
			stopped && seq === "audio-start,audio-chunk,audio-chunk,audio-stop",
			seq,
		)
		checker.check(
			"chunk framing carries payload_length-exact bytes",
			fake.eventsOf("audio-chunk")[1]?.payload?.equals(c2) === true,
		)
		fake.send("played", {})
		fake.send("ping", { text: "x" })
		const ponged = await fake.waitFor("pong")
		checker.check(
			"played + ping are accepted without disturbing the link",
			ponged,
		)
	}
	handle.close()
	fake.close()
	await sleep(20)
}

const main = async (): Promise<void> => {
	await runFragmentSplitterChecks()
	await runPhraseCacheChecks()
	await runWyomingTransportChecks()
	await runWyomingWireChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} ttfa checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
