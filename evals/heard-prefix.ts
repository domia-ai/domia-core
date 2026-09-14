import {
	createPlaybackLedger,
	heardPrefixOfAnchors,
	heardTextFromUniformRate,
	lastLoudSampleOffset,
	truncateAtWordBoundary,
} from "@/modules/core-bus/utils"
import type {
	LedgerAnchorType,
	StreamingSinkFormatType,
} from "@/modules/core-bus"

import { makeChecker } from "./lib"

const checker = makeChecker()

const FORMAT: StreamingSinkFormatType = { sampleRate: 24000, channels: 1 }
const BYTES_PER_MS = (FORMAT.sampleRate * FORMAT.channels * 2) / 1000

const msToBytes = (ms: number): number => Math.round(ms * BYTES_PER_MS)

const tone = (ms: number, amplitude: number): Buffer => {
	const samples = Math.round((ms * FORMAT.sampleRate) / 1000)
	const buf = Buffer.alloc(samples * 2)
	for (let i = 0; i < samples; i++)
		buf.writeInt16LE(Math.round(Math.sin(i / 8) * amplitude * 32767), i * 2)
	return buf
}

const anchor = (
	text: string,
	startMs: number,
	endMs: number,
	speechEndMs = endMs,
): LedgerAnchorType => ({
	text,
	startByte: msToBytes(startMs),
	endByte: msToBytes(endMs),
	speechEndByte: msToBytes(speechEndMs),
})

const runWordBoundaryChecks = (): void => {
	console.log("\ntruncate-to-heard — word boundary snapping")
	const text = "turn on the kitchen light"
	checker.check(
		"nothing heard yields nothing",
		truncateAtWordBoundary(text, 0) === "",
	)
	checker.check(
		"past the end yields the whole sentence",
		truncateAtWordBoundary(text, text.length + 10) === text,
	)
	checker.check(
		"a cut exactly at a word end keeps that word",
		truncateAtWordBoundary(text, 7) === "turn on",
		`got="${truncateAtWordBoundary(text, 7)}"`,
	)
	checker.check(
		"a cut inside a word drops that word",
		truncateAtWordBoundary(text, 15) === "turn on the",
		`got="${truncateAtWordBoundary(text, 15)}"`,
	)
	checker.check(
		"a cut inside the first word yields nothing",
		truncateAtWordBoundary(text, 2) === "",
		`got="${truncateAtWordBoundary(text, 2)}"`,
	)
	checker.check(
		"uniform-rate truncation snaps the same way",
		heardTextFromUniformRate(text, 500, 1000) === "turn on the",
		`got="${heardTextFromUniformRate(text, 500, 1000)}"`,
	)
	checker.check(
		"an abort after the audio ended reports the whole reply",
		heardTextFromUniformRate(text, 1200, 1000) === text,
	)
}

const runAnchorChecks = (): void => {
	console.log("\ntruncate-to-heard — sentence timing")
	const anchors = [
		anchor("Turning on the kitchen light.", 0, 1000),
		anchor("The bedroom lamp is already on.", 1000, 2400),
		anchor("Anything else?", 2400, 3000),
	]
	checker.check(
		"an abort before any audio reports nothing",
		heardPrefixOfAnchors(anchors, 0, FORMAT) === "",
	)
	checker.check(
		"an abort at a sentence boundary reports whole sentences",
		heardPrefixOfAnchors(anchors, 1000, FORMAT) ===
			"Turning on the kitchen light.",
		`got="${heardPrefixOfAnchors(anchors, 1000, FORMAT)}"`,
	)
	const mid = heardPrefixOfAnchors(anchors, 1700, FORMAT)
	checker.check(
		"an abort mid-sentence keeps the finished sentence plus a word prefix",
		mid.startsWith("Turning on the kitchen light. The bedroom") &&
			!mid.includes("already"),
		`got="${mid}"`,
	)
	checker.check(
		"the word prefix never ends mid-word",
		mid.split(" ").every((word) => anchors.some((a) => a.text.includes(word))),
		`got="${mid}"`,
	)
	checker.check(
		"an abort past the last sentence reports everything",
		heardPrefixOfAnchors(anchors, 4000, FORMAT) ===
			anchors.map((a) => a.text).join(" "),
	)
}

const runSilenceTrimChecks = (): void => {
	console.log("\ntruncate-to-heard — trailing silence is not counted as speech")
	const padded = [anchor("Turning on the kitchen light.", 0, 1200, 1000)]
	const naive = [anchor("Turning on the kitchen light.", 0, 1200, 1200)]
	checker.check(
		"an abort inside the trailing silence reports the whole sentence",
		heardPrefixOfAnchors(padded, 1050, FORMAT) ===
			"Turning on the kitchen light.",
		`got="${heardPrefixOfAnchors(padded, 1050, FORMAT)}"`,
	)
	checker.check(
		"without the trim the same abort under-reports",
		heardPrefixOfAnchors(naive, 1050, FORMAT) !==
			"Turning on the kitchen light.",
		`got="${heardPrefixOfAnchors(naive, 1050, FORMAT)}"`,
	)
	checker.check(
		"the trim stretches the prefix mid-sentence too",
		heardPrefixOfAnchors(padded, 800, FORMAT).length >
			heardPrefixOfAnchors(naive, 800, FORMAT).length,
		`trimmed="${heardPrefixOfAnchors(padded, 800, FORMAT)}" naive="${heardPrefixOfAnchors(naive, 800, FORMAT)}"`,
	)
}

const runLoudOffsetChecks = (): void => {
	console.log("\ntruncate-to-heard — speech end detection")
	const speech = tone(100, 0.4)
	const silence = Buffer.alloc(msToBytes(100))
	checker.check(
		"a loud chunk ends at its last sample",
		lastLoudSampleOffset(speech, 0.01) === speech.length,
		`got=${lastLoudSampleOffset(speech, 0.01)}`,
	)
	checker.check(
		"a silent chunk reports no speech",
		lastLoudSampleOffset(silence, 0.01) === 0,
	)
	const tail = Buffer.concat([speech, silence])
	const offset = lastLoudSampleOffset(tail, 0.01)
	checker.check(
		"a padded chunk ends where the speech ends",
		offset > speech.length * 0.9 && offset <= speech.length + 4,
		`got=${offset} speechBytes=${speech.length}`,
	)
	checker.check(
		"a raised threshold ignores quiet speech",
		lastLoudSampleOffset(tone(100, 0.005), 0.05) === 0,
	)
}

const runLedgerChecks = async (): Promise<void> => {
	console.log("\ntruncate-to-heard — ledger anchors")
	const speak = async function* (
		speechMs: number,
		silenceMs: number,
	): AsyncIterable<Buffer> {
		yield await Promise.resolve(tone(speechMs, 0.4))
		if (silenceMs > 0) yield Buffer.alloc(msToBytes(silenceMs))
	}
	const ledger = createPlaybackLedger(FORMAT, {
		wordLevelHeard: true,
		silenceTrim: true,
		silenceRms: 0.01,
	})
	for await (const chunk of ledger.wrapSentence(
		"Turning on the kitchen light.",
		speak(1000, 200),
	))
		void chunk
	for await (const chunk of ledger.wrapSentence(
		"Anything else?",
		speak(400, 100),
	))
		void chunk
	const anchors = ledger.anchors()
	checker.check("two sentences are anchored", anchors.length === 2)
	checker.check(
		"the first anchor stops at the speech, not the padding",
		anchors[0].speechEndByte < anchors[0].endByte &&
			anchors[0].speechEndByte > msToBytes(950),
		JSON.stringify(anchors[0]),
	)
	checker.check(
		"the second anchor starts where the first ended",
		anchors[1].startByte === anchors[0].endByte,
	)
	ledger.markFirstChunk()
	checker.check(
		"an abort in the first pad reports the first sentence whole",
		ledger.heardTextAt(1100, "estimated") === "Turning on the kitchen light.",
		`got="${ledger.heardTextAt(1100, "estimated")}"`,
	)
	checker.check(
		"sentence fidelity never reports a partial sentence",
		ledger.heardTextAt(1500, "sentence") === "Turning on the kitchen light.",
		`got="${ledger.heardTextAt(1500, "sentence")}"`,
	)
	checker.check(
		"no fidelity reports nothing",
		ledger.heardTextAt(1500, "none") === "",
	)

	const untrimmed = createPlaybackLedger(FORMAT, {
		wordLevelHeard: true,
		silenceTrim: false,
		silenceRms: 0.01,
	})
	for await (const chunk of untrimmed.wrapSentence(
		"Turning on the kitchen light.",
		speak(1000, 200),
	))
		void chunk
	checker.check(
		"with the trim off the anchor keeps the padding",
		untrimmed.anchors()[0].speechEndByte === untrimmed.anchors()[0].endByte,
	)
	checker.check(
		"and the same abort under-reports",
		untrimmed.heardTextAt(1100, "estimated") !==
			"Turning on the kitchen light.",
		`got="${untrimmed.heardTextAt(1100, "estimated")}"`,
	)
}

const main = async (): Promise<void> => {
	runWordBoundaryChecks()
	runAnchorChecks()
	runSilenceTrimChecks()
	runLoudOffsetChecks()
	await runLedgerChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} heard-prefix checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
