import type { WakeVerifierEnumType } from "@/db"
import { performance } from "perf_hooks"

import {
	DEFAULT_PCM_SAMPLE_RATE,
	DEFAULT_GTCRN_MODEL_PATH,
	DEFAULT_ECHO_RESIDUAL_MIN_RATIO,
	DEFAULT_ECHO_RESIDUAL_WINDOW_MS,
	DEFAULT_ECHO_RESIDUAL_MAX_DELAY_MS,
	DEFAULT_ECHO_RESIDUAL_MIN_RMS,
	DEFAULT_ECHO_RESIDUAL_MIN_FRAMES,
	DEFAULT_ECHO_REFERENCE_SECONDS,
	DEFAULT_STOP_WORD_MAX_WORDS,
	DEFAULT_STOP_WORD_MAX_EXTRA_WORDS,
	DEFAULT_WAKE_VERIFIER_WINDOW_MS,
	DEFAULT_WAKE_VERIFIER_MIN_RMS,
	DEFAULT_WAKE_VERIFIER_MIN_SPEECH_MS,
	DEFAULT_WAKE_VERIFIER_MIN_SCORE,
	DEFAULT_WAKE_VERIFIER_MAX_MS,
	DEFAULT_WAKE_WORD,
	WAKE_VERIFIER_ENUM,
	SPEECH_ENHANCER_ENGINE_ENUM,
} from "@/db/constants"
import {
	abortActiveCapture,
	clearCaptureAbort,
	consumeCaptureAbort,
	registerCaptureStop,
	createEchoGate,
	notePlaybackReference,
	matchStopPhrase,
	normalizeStopText,
	type EchoGateConfigType,
} from "@/modules/audio-capture"
import {
	verifyWake,
	wakeVerifierRegistry,
	isConcurrentWakeVerifier,
	matchWakePhrase,
	type WakeVerifierConfigType,
} from "@/modules/wake-verifier"
import { createCaptureEnhancer, gtcrnEngine } from "@/modules/speech-enhancer"
import {
	ensureAec,
	releaseAec,
	getAecStatus,
	setAecTooling,
	parseBackend,
	parseModuleIndex,
	staleEchoCancelModules,
	type AecConfigType,
	type PactlResultType,
} from "@/modules/aec"
import { languageSetsFor } from "@/utils/language-catalogs"
import { pcm16Rms } from "@/utils/pcm"

import { makeChecker, fabricateSegmentPcm } from "./lib"

const RATE = DEFAULT_PCM_SAMPLE_RATE
const msBytes = (ms: number): number => Math.round((RATE * ms) / 1000) * 2

const scaled = (pcm: Buffer, gain: number): Buffer => {
	const out = Buffer.alloc(pcm.length)
	for (let i = 0; i < pcm.length; i += 2)
		out.writeInt16LE(
			Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * gain))),
			i,
		)
	return out
}

const mixed = (a: Buffer, b: Buffer): Buffer => {
	const len = Math.min(a.length, b.length)
	const out = Buffer.alloc(len)
	for (let i = 0; i < len; i += 2)
		out.writeInt16LE(
			Math.max(-32768, Math.min(32767, a.readInt16LE(i) + b.readInt16LE(i))),
			i,
		)
	return out
}

let seed = 12345
const nextRandom = (): number => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff
	return seed / 0x7fffffff
}

const whiteNoise = (ms: number, peak: number): Buffer => {
	const out = Buffer.alloc(msBytes(ms))
	for (let i = 0; i < out.length; i += 2)
		out.writeInt16LE(Math.round((nextRandom() * 2 - 1) * peak), i)
	return out
}

const chirp = (ms: number, peak: number): Buffer => {
	const samples = Math.round((RATE * ms) / 1000)
	const out = Buffer.alloc(samples * 2)
	for (let i = 0; i < samples; i++) {
		const t = i / RATE
		out.writeInt16LE(
			Math.round(peak * Math.sin(2 * Math.PI * (300 + 600 * t) * t)),
			i * 2,
		)
	}
	return out
}

const gateConfig: EchoGateConfigType = {
	echoResidualGateEnabled: true,
	echoResidualMinRatio: DEFAULT_ECHO_RESIDUAL_MIN_RATIO,
	echoResidualWindowMs: DEFAULT_ECHO_RESIDUAL_WINDOW_MS,
	echoResidualMaxDelayMs: DEFAULT_ECHO_RESIDUAL_MAX_DELAY_MS,
	echoResidualMinRms: DEFAULT_ECHO_RESIDUAL_MIN_RMS,
	echoResidualMinFrames: DEFAULT_ECHO_RESIDUAL_MIN_FRAMES,
}

const feedGate = (
	key: string,
	mic: Buffer,
): { accepted: boolean; residuals: number[]; lags: number[] } => {
	const gate = createEchoGate(key, gateConfig)
	const frame = msBytes(gateConfig.echoResidualWindowMs)
	const residuals: number[] = []
	const lags: number[] = []
	let accepted = false
	for (let off = 0; off + frame <= mic.length; off += frame) {
		const v = gate.observe(mic.subarray(off, off + frame))
		if (v.residual !== null) residuals.push(Number(v.residual.toFixed(3)))
		if (v.lagMs !== null) lags.push(v.lagMs)
		if (v.accept) accepted = true
	}
	return { accepted, residuals, lags }
}

const residualGateChecks = (c: ReturnType<typeof makeChecker>): void => {
	console.log("\nresidual-ratio echo gate")
	const reference = fabricateSegmentPcm("speech", 2500)
	const echoDelayMs = 400
	const echoStart = reference.length - msBytes(echoDelayMs) - msBytes(600)
	const echoEnd = reference.length - msBytes(echoDelayMs)
	const echo = scaled(reference.subarray(echoStart, echoEnd), 0.35)

	notePlaybackReference(
		"gate:echo",
		reference,
		RATE,
		1,
		DEFAULT_ECHO_REFERENCE_SECONDS,
	)
	const selfEcho = feedGate("gate:echo", mixed(echo, whiteNoise(600, 300)))
	c.check(
		"self-echo (delayed, attenuated playback) is rejected",
		!selfEcho.accepted,
		`residuals=${selfEcho.residuals.join(",")}`,
	)
	c.check(
		"self-echo residual stays under the ratio threshold",
		selfEcho.residuals.length > 0 &&
			selfEcho.residuals.every((r) => r < gateConfig.echoResidualMinRatio),
		`residuals=${selfEcho.residuals.join(",")}`,
	)
	const lagReference = mixed(chirp(2500, 400), whiteNoise(2500, 200))
	const lagEcho = scaled(lagReference.subarray(echoStart, echoEnd), 0.35)
	notePlaybackReference(
		"gate:lag",
		lagReference,
		RATE,
		1,
		DEFAULT_ECHO_REFERENCE_SECONDS,
	)
	const lagProbe = feedGate("gate:lag", mixed(lagEcho, whiteNoise(600, 300)))
	console.log(
		`  ↳ advisory: echo lag estimate on synthetic audio lags=${lagProbe.lags.join(",") || "none"} expected≈${echoDelayMs} (accuracy needs a real-mic session)`,
	)

	notePlaybackReference(
		"gate:live",
		reference,
		RATE,
		1,
		DEFAULT_ECHO_REFERENCE_SECONDS,
	)
	const live = feedGate("gate:live", mixed(echo, chirp(600, 9000)))
	c.check(
		"live speech over playback is accepted",
		live.accepted,
		`residuals=${live.residuals.join(",")}`,
	)

	notePlaybackReference(
		"gate:silence",
		reference,
		RATE,
		1,
		DEFAULT_ECHO_REFERENCE_SECONDS,
	)
	const quiet = feedGate("gate:silence", fabricateSegmentPcm("silence", 600))
	c.check(
		"silence never triggers (below min RMS)",
		!quiet.accepted && quiet.residuals.length === 0,
	)

	const noRef = feedGate("gate:none", fabricateSegmentPcm("speech", 600))
	c.check(
		"no playback reference → fail-open (speech accepted)",
		noRef.accepted && noRef.residuals.length === 0,
	)

	const short = createEchoGate("gate:frames", gateConfig)
	notePlaybackReference(
		"gate:frames",
		reference,
		RATE,
		1,
		DEFAULT_ECHO_REFERENCE_SECONDS,
	)
	const one = short.observe(chirp(gateConfig.echoResidualWindowMs, 9000))
	c.check(
		"a single live frame does not yet accept (min consecutive frames)",
		!one.accept && one.frames === 1,
		`frames=${one.frames}`,
	)
	const heavy = fabricateSegmentPcm("speech", 100)
	notePlaybackReference(
		"gate:cost",
		fabricateSegmentPcm("speech", 3000),
		RATE,
		1,
		DEFAULT_ECHO_REFERENCE_SECONDS,
	)
	const costGate = createEchoGate("gate:cost", gateConfig)
	const t0 = performance.now()
	for (let i = 0; i < 20; i++) costGate.observe(heavy)
	const perFrameMs = (performance.now() - t0) / 20
	c.check(
		"gate cost per 100ms frame is small on this box",
		perFrameMs < 50,
		`perFrameMs=${perFrameMs.toFixed(2)} (dev Mac; RPi ≈ 10-20x slower)`,
	)
	console.log(`  gate cost: ${perFrameMs.toFixed(2)}ms per 100ms frame`)
}

const stopWordChecks = (c: ReturnType<typeof makeChecker>): void => {
	console.log("\nstop-word catalog + matcher")
	const maxWords = DEFAULT_STOP_WORD_MAX_WORDS
	const maxExtra = DEFAULT_STOP_WORD_MAX_EXTRA_WORDS
	const en = languageSetsFor("en").interruptPhrases
	const es = languageSetsFor("es").interruptPhrases
	c.check("EN catalog ships interrupt phrases", en.includes("stop"))
	c.check(
		"ES catalog ships interrupt phrases and inherits EN",
		es.includes("cállate") && es.includes("para") && es.includes("stop"),
	)
	const hits: [string, string, string][] = [
		["stop", "en", "stop"],
		["Domia, stop!", "en", "stop"],
		["stop please", "en", "stop"],
		["never mind", "en", "never mind"],
		["okay cancel", "en", "cancel"],
		["cállate", "es", "callate"],
		["callate ya", "es", "callate"],
		["para ya", "es", "para ya"],
		["ya basta domia", "es", "ya basta"],
		["silencio", "es", "silencio"],
		["stop", "es", "stop"],
		["@stop_talking", "en", "stop talking"],
	]
	for (const [text, lang, expected] of hits)
		c.check(
			`matches "${text}" (${lang})`,
			matchStopPhrase(text, lang, maxWords, maxExtra) === expected,
			`got=${matchStopPhrase(text, lang, maxWords, maxExtra)}`,
		)
	const misses: [string, string][] = [
		["stop the timer", "en"],
		["stop the music in the kitchen", "en"],
		["what time is it", "en"],
		["para la luz de la cocina", "es"],
		["enciende la luz", "es"],
		["ya", "es"],
		["", "en"],
	]
	for (const [text, lang] of misses)
		c.check(
			`ignores "${text || "<empty>"}" (${lang})`,
			matchStopPhrase(text, lang, maxWords, maxExtra) === null,
			`got=${matchStopPhrase(text, lang, maxWords, maxExtra)}`,
		)
	c.check(
		"unknown language falls back to EN",
		matchStopPhrase("stop", "xx-unknown", maxWords, maxExtra) === "stop",
	)
	c.check(
		"normalization strips accents, case, punctuation and labels",
		normalizeStopText("¡CÁLLATE!") === "callate" &&
			normalizeStopText("@stop_it") === "stop it",
	)
}

const verifierChecks = async (
	c: ReturnType<typeof makeChecker>,
): Promise<void> => {
	console.log("\nwake-word verifier slot")
	const config: WakeVerifierConfigType = {
		wakeWord: DEFAULT_WAKE_WORD,
		wakeVerifier: WAKE_VERIFIER_ENUM.ENERGY,
		wakeVerifierWindowMs: DEFAULT_WAKE_VERIFIER_WINDOW_MS,
		wakeVerifierMinRms: DEFAULT_WAKE_VERIFIER_MIN_RMS,
		wakeVerifierMinSpeechMs: DEFAULT_WAKE_VERIFIER_MIN_SPEECH_MS,
		wakeVerifierMinScore: DEFAULT_WAKE_VERIFIER_MIN_SCORE,
		wakeVerifierMaxMs: DEFAULT_WAKE_VERIFIER_MAX_MS,
	}
	c.check(
		"registry exposes NONE, ENERGY and STT",
		Object.keys(wakeVerifierRegistry).sort().join(",") === "ENERGY,NONE,STT",
	)
	const silence = fabricateSegmentPcm("silence", 1500)
	const word = Buffer.concat([
		fabricateSegmentPcm("silence", 800),
		fabricateSegmentPcm("speech", 500),
		fabricateSegmentPcm("silence", 200),
	])
	const none = await verifyWake(
		{ pcm: silence, sampleRate: RATE },
		{ ...config, wakeVerifier: WAKE_VERIFIER_ENUM.NONE },
	)
	c.check("NONE verifier accepts everything", none.accepted && none.score === 1)
	const rejected = await verifyWake({ pcm: silence, sampleRate: RATE }, config)
	c.check(
		"ENERGY rejects a silent window",
		!rejected.accepted && rejected.score === 0,
		rejected.detail,
	)
	const accepted = await verifyWake({ pcm: word, sampleRate: RATE }, config)
	c.check(
		"ENERGY accepts a word-shaped window",
		accepted.accepted && accepted.score === 1,
		accepted.detail,
	)
	const steady = await verifyWake(
		{
			pcm: fabricateSegmentPcm("speech", 1500),
			sampleRate: RATE,
		},
		config,
	)
	c.check(
		"ENERGY scores steady noise below a word",
		steady.score < accepted.score,
		`steady=${steady.score} word=${accepted.score}`,
	)
	const unknown = await verifyWake(
		{ pcm: silence, sampleRate: RATE },
		{ ...config, wakeVerifier: "BOGUS" as WakeVerifierEnumType },
	)
	c.check("unknown verifier id fails open", unknown.accepted)
}

const WAKE_POSITIVES = [
	"computer",
	"hey computer",
	"ok computer please",
	"computadora",
	"compute her",
	"comp uter",
	"COMPUTER.",
	"la computadora",
]

const WAKE_NEGATIVES = [
	"commuter",
	"compete",
	"comprar",
	"the train to work",
	"com",
	"",
	"   ",
]

const sttVerifierChecks = async (
	c: ReturnType<typeof makeChecker>,
): Promise<void> => {
	console.log("\nwake-word STT verifier (stage 2)")
	const config: WakeVerifierConfigType = {
		wakeWord: DEFAULT_WAKE_WORD,
		wakeVerifier: WAKE_VERIFIER_ENUM.STT,
		wakeVerifierWindowMs: DEFAULT_WAKE_VERIFIER_WINDOW_MS,
		wakeVerifierMinRms: DEFAULT_WAKE_VERIFIER_MIN_RMS,
		wakeVerifierMinSpeechMs: DEFAULT_WAKE_VERIFIER_MIN_SPEECH_MS,
		wakeVerifierMinScore: DEFAULT_WAKE_VERIFIER_MIN_SCORE,
		wakeVerifierMaxMs: DEFAULT_WAKE_VERIFIER_MAX_MS,
	}
	const window = fabricateSegmentPcm("speech", 500)
	const withTranscript = (text: string, delayMs = 0) =>
		verifyWake(
			{
				pcm: window,
				sampleRate: RATE,
				transcribe: () =>
					new Promise<string>((resolve) => {
						setTimeout(() => resolve(text), delayMs)
					}),
			},
			config,
		)

	c.check(
		"STT verifier runs concurrently with the wake",
		isConcurrentWakeVerifier(WAKE_VERIFIER_ENUM.STT),
	)
	c.check(
		"ENERGY and NONE gate the wake instead",
		!isConcurrentWakeVerifier(WAKE_VERIFIER_ENUM.ENERGY) &&
			!isConcurrentWakeVerifier(WAKE_VERIFIER_ENUM.NONE),
	)

	for (const text of WAKE_POSITIVES) {
		const match = matchWakePhrase(text, DEFAULT_WAKE_WORD)
		const verdict = await withTranscript(text)
		c.check(
			`accepts "${text}"`,
			verdict.accepted && match.score >= DEFAULT_WAKE_VERIFIER_MIN_SCORE,
			`score=${match.score.toFixed(3)}`,
		)
	}

	for (const text of WAKE_NEGATIVES) {
		const match = matchWakePhrase(text, DEFAULT_WAKE_WORD)
		const verdict = await withTranscript(text)
		c.check(
			`rejects "${text}"`,
			!verdict.accepted && match.score < DEFAULT_WAKE_VERIFIER_MIN_SCORE,
			`score=${match.score.toFixed(3)}`,
		)
	}

	const multiWord = matchWakePhrase("hey domia", "hey domia")
	c.check("multi-word wake phrase matches exactly", multiWord.score === 1)
	const mangledMultiWord = matchWakePhrase("hey dominia", "hey domia")
	c.check(
		"multi-word wake phrase survives a mangled tail",
		mangledMultiWord.score >= DEFAULT_WAKE_VERIFIER_MIN_SCORE,
		`score=${mangledMultiWord.score.toFixed(3)}`,
	)
	c.check(
		"empty wake phrase scores zero",
		matchWakePhrase("computer", "").score === 0,
	)

	const slowConfig = { ...config, wakeVerifierMaxMs: 60 }
	const startedAt = performance.now()
	const timedOut = await verifyWake(
		{
			pcm: window,
			sampleRate: RATE,
			transcribe: () =>
				new Promise<string>((resolve) => {
					setTimeout(() => resolve("commuter"), 5000).unref()
				}),
		},
		slowConfig,
	)
	const elapsed = performance.now() - startedAt
	c.check(
		"slow transcriber fails open inside the budget",
		timedOut.accepted && timedOut.failedOpen === true && elapsed < 500,
		`elapsed=${Math.round(elapsed)}ms detail=${timedOut.detail}`,
	)

	const throwing = await verifyWake(
		{
			pcm: window,
			sampleRate: RATE,
			transcribe: () => Promise.reject(new Error("stt down")),
		},
		config,
	)
	c.check(
		"transcriber failure fails open",
		throwing.accepted && throwing.failedOpen === true,
	)

	const noTranscriber = await verifyWake(
		{ pcm: window, sampleRate: RATE },
		config,
	)
	c.check(
		"no in-process STT fails open (dump-archetype nodes)",
		noTranscriber.accepted && noTranscriber.failedOpen === true,
		noTranscriber.detail,
	)

	const emptyWindow = await verifyWake(
		{
			pcm: Buffer.alloc(0),
			sampleRate: RATE,
			transcribe: () => Promise.resolve("commuter"),
		},
		config,
	)
	c.check(
		"empty window fails open",
		emptyWindow.accepted && emptyWindow.failedOpen === true,
	)
}

const snrDb = (clean: Float32Array, test: Float32Array): number => {
	let sig = 0
	let err = 0
	for (let i = 0; i < clean.length; i++) {
		sig += clean[i] * clean[i]
		const d = clean[i] - test[i]
		err += d * d
	}
	return 10 * Math.log10(sig / Math.max(err, 1e-12))
}

const toFloat = (pcm: Buffer): Float32Array => {
	const out = new Float32Array(pcm.length >> 1)
	for (let i = 0; i < out.length; i++) out[i] = pcm.readInt16LE(i * 2) / 32768
	return out
}

const bestAlignedSnr = (
	clean: Buffer,
	test: Buffer,
	maxShift: number,
): number => {
	const a = toFloat(clean)
	const b = toFloat(test)
	let best = -Infinity
	for (let shift = 0; shift <= maxShift; shift += 16) {
		const len = Math.min(a.length, b.length - shift)
		if (len <= 0) break
		best = Math.max(
			best,
			snrDb(a.subarray(0, len), b.subarray(shift, shift + len)),
		)
	}
	return best
}

const denoiserChecks = (c: ReturnType<typeof makeChecker>): void => {
	console.log("\nspeech enhancement (GTCRN)")
	const baseConfig = {
		denoiseEnabled: true,
		denoiseEngine: SPEECH_ENHANCER_ENGINE_ENUM.GTCRN,
		denoiseModelPath: DEFAULT_GTCRN_MODEL_PATH,
		denoiseNumThreads: 1,
		denoiseProvider: "cpu",
		sampleRate: RATE,
		channels: 1,
	}
	const off = createCaptureEnhancer(
		{ ...baseConfig, denoiseEnabled: false },
		"eval",
	)
	const probe = fabricateSegmentPcm("speech", 100)
	c.check(
		"disabled knob → passthrough stage",
		!off.active && off.process(probe).equals(probe),
	)
	const wrongRate = createCaptureEnhancer(
		{ ...baseConfig, sampleRate: 48000 },
		"eval",
	)
	c.check("non-16k capture → passthrough (documented)", !wrongRate.active)
	if (!gtcrnEngine.available(DEFAULT_GTCRN_MODEL_PATH)) {
		const missing = createCaptureEnhancer(baseConfig, "eval")
		c.check("missing model → passthrough with a warning", !missing.active)
		console.log(
			`  ⏭️ denoiser round trip SKIPPED — model missing at ${DEFAULT_GTCRN_MODEL_PATH} (run: npm run setup:models:gtcrn)`,
		)
		return
	}
	const clean = fabricateSegmentPcm("speech", 3000)
	const noise = whiteNoise(3000, 0)
	const cleanRms = pcm16Rms(clean)
	const noisy = mixed(clean, scaled(whiteNoise(3000, 32767), cleanRms))
	void noise
	const stage = createCaptureEnhancer(baseConfig, "eval")
	c.check("model present → active stage", stage.active)
	const chunk = msBytes(100)
	const parts: Buffer[] = []
	const t0 = performance.now()
	for (let off = 0; off < noisy.length; off += chunk)
		parts.push(
			stage.process(noisy.subarray(off, Math.min(noisy.length, off + chunk))),
		)
	parts.push(stage.flush())
	const elapsedMs = performance.now() - t0
	stage.close()
	const denoised = Buffer.concat(parts)
	const before = bestAlignedSnr(clean, noisy, 0)
	const after = bestAlignedSnr(clean, denoised, 1024)
	const rtf = elapsedMs / 3000
	console.log(
		`  SNR before=${before.toFixed(1)}dB after=${after.toFixed(1)}dB rtf=${rtf.toFixed(3)} (dev Mac)`,
	)
	c.check(
		"denoised output length matches input (±1 frame)",
		Math.abs(denoised.length - noisy.length) <= 1024,
		`in=${noisy.length} out=${denoised.length}`,
	)
	c.check(
		"SNR improves by ≥ 3 dB on synthetic white noise",
		after - before >= 3,
	)
	c.check("real-time factor well under 1 on this box", rtf < 0.5, `rtf=${rtf}`)
}

const fakePactl =
	(
		log: string[][],
		answers: Partial<Record<string, PactlResultType>>,
	): ((args: string[]) => Promise<PactlResultType>) =>
	(args) => {
		log.push(args)
		const key = args.slice(0, 2).join(" ")
		const answer =
			answers[key] ??
			answers[args[0]] ??
			({ ok: true, stdout: "", stderr: "" } satisfies PactlResultType)
		return Promise.resolve(answer)
	}

const aecChecks = async (c: ReturnType<typeof makeChecker>): Promise<void> => {
	console.log("\nAEC lifecycle (module-echo-cancel)")
	const config: AecConfigType = {
		aecEnabled: true,
		aecBackend: "AUTO",
		aecMethod: "webrtc",
		aecSourceMaster: null,
		aecSinkMaster: null,
		aecSourceName: "domia_aec_source",
		aecSinkName: "domia_aec_sink",
		aecSetDefaultDevices: true,
	}
	c.check(
		"parseBackend detects PipeWire behind pipewire-pulse",
		parseBackend(
			"Server String: /run/user/1000/pulse/native\nServer Name: PulseAudio (on PipeWire 1.2.7)",
		) === "PIPEWIRE",
	)
	c.check(
		"parseBackend detects plain PulseAudio",
		parseBackend("Server Name: pulseaudio\nServer Version: 16.1") ===
			"PULSEAUDIO",
	)
	c.check(
		"parseModuleIndex reads the loaded index",
		parseModuleIndex("536870913\n") === 536870913,
	)
	c.check(
		"stale module scan keys on our source_name only",
		staleEchoCancelModules(
			"12\tmodule-echo-cancel\tsource_name=other aec_method=webrtc\n13\tmodule-echo-cancel\taec_method=webrtc source_name=domia_aec_source\n14\tmodule-null-sink\t",
			"domia_aec_source",
		).join(",") === "13",
	)

	const darwinLog: string[][] = []
	setAecTooling({ platform: "darwin", runPactl: fakePactl(darwinLog, {}) })
	const onMac = await ensureAec("DOMIA_EVAL", config)
	c.check(
		"macOS: AEC requested → unavailable, no pactl calls, no throw",
		onMac.state === "unavailable" &&
			darwinLog.length === 0 &&
			(onMac.detail ?? "").includes("Linux"),
		`state=${onMac.state} detail=${onMac.detail}`,
	)
	await releaseAec("DOMIA_EVAL")

	const noPactlLog: string[][] = []
	setAecTooling({
		platform: "linux",
		runPactl: fakePactl(noPactlLog, {
			info: { ok: false, stdout: "", stderr: "spawn pactl ENOENT" },
		}),
	})
	const noPactl = await ensureAec("DOMIA_EVAL", config)
	c.check(
		"linux without pactl → unavailable with the reason",
		noPactl.state === "unavailable" && (noPactl.detail ?? "").includes("pactl"),
		`state=${noPactl.state} detail=${noPactl.detail}`,
	)
	await releaseAec("DOMIA_EVAL")

	const log: string[][] = []
	setAecTooling({
		platform: "linux",
		runPactl: fakePactl(log, {
			info: {
				ok: true,
				stdout: "Server Name: PulseAudio (on PipeWire 1.2.7)",
				stderr: "",
			},
			"load-module module-echo-cancel": { ok: true, stdout: "23", stderr: "" },
			"list short": {
				ok: true,
				stdout: "7\tmodule-echo-cancel\tsource_name=domia_aec_source",
				stderr: "",
			},
			"get-default-source": {
				ok: true,
				stdout: "alsa_input.usb-mic",
				stderr: "",
			},
			"get-default-sink": { ok: true, stdout: "alsa_output.hdmi", stderr: "" },
		}),
	})
	const active = await ensureAec("DOMIA_EVAL", config)
	const joined = log.map((a) => a.join(" "))
	c.check(
		"linux+PipeWire: module loads and status is active",
		active.state === "active" &&
			active.backend === "PIPEWIRE" &&
			active.moduleIndex === 23,
		JSON.stringify(active),
	)
	c.check(
		"stale module with our source_name is unloaded first",
		joined.includes("unload-module 7"),
		joined.join(" | "),
	)
	c.check(
		"load-module carries aec_method, names and use_master_format",
		joined.some((l) =>
			l.startsWith(
				"load-module module-echo-cancel aec_method=webrtc source_name=domia_aec_source sink_name=domia_aec_sink use_master_format=1",
			),
		),
		joined.join(" | "),
	)
	c.check(
		"default source/sink switched to the AEC devices",
		joined.includes("set-default-source domia_aec_source") &&
			joined.includes("set-default-sink domia_aec_sink"),
	)
	const before = log.length
	await ensureAec("DOMIA_EVAL", config)
	c.check(
		"same config again is idempotent (no pactl calls)",
		log.length === before,
	)
	await ensureAec("DOMIA_EVAL_2", {
		...config,
		aecSinkMaster: "alsa_output.usb",
	})
	const rebound = log.slice(before).map((a) => a.join(" "))
	c.check(
		"changed masters rebind: unload old, load new with sink_master",
		rebound.includes("unload-module 23") &&
			rebound.some((l) => l.includes("sink_master=alsa_output.usb")),
		rebound.join(" | "),
	)
	c.check(
		"two identities hold one node-wide module",
		getAecStatus().holders.length === 2,
	)
	await releaseAec("DOMIA_EVAL")
	c.check(
		"releasing one holder keeps the module",
		getAecStatus().state === "active",
	)
	const beforeRelease = log.length
	await releaseAec("DOMIA_EVAL_2")
	const released = log.slice(beforeRelease).map((a) => a.join(" "))
	c.check(
		"last holder release unloads and restores the previous defaults",
		getAecStatus().state === "off" &&
			released.includes("unload-module 23") &&
			released.includes("set-default-source alsa_input.usb-mic") &&
			released.includes("set-default-sink alsa_output.hdmi"),
		released.join(" | "),
	)
	const disabledLog: string[][] = []
	setAecTooling({ platform: "linux", runPactl: fakePactl(disabledLog, {}) })
	const off = await ensureAec("DOMIA_EVAL", { ...config, aecEnabled: false })
	c.check(
		"aecEnabled=false → off and no pactl calls",
		off.state === "off" && disabledLog.length === 0,
	)
	const failLog: string[][] = []
	setAecTooling({
		platform: "linux",
		runPactl: fakePactl(failLog, {
			info: { ok: true, stdout: "Server Name: pulseaudio", stderr: "" },
			"load-module module-echo-cancel": {
				ok: false,
				stdout: "",
				stderr: "Failure: Module initialization failed",
			},
		}),
	})
	const failed = await ensureAec("DOMIA_EVAL", config)
	c.check(
		"load failure → failed status with detail, no throw",
		failed.state === "failed" && (failed.detail ?? "").length > 0,
		`state=${failed.state} detail=${failed.detail}`,
	)
	await releaseAec("DOMIA_EVAL")
}

const captureAbortChecks = (c: ReturnType<typeof makeChecker>): void => {
	console.log("\nwake-verifier capture rollback")
	const id = "eval-capture-abort"
	const stops: string[] = []
	const unregisterOld = registerCaptureStop(id, (reason) =>
		stops.push(`old:${reason}`),
	)
	c.check(
		"abort stops the registered capture",
		abortActiveCapture(id, "wake-verifier") &&
			stops.join(",") === "old:wake-verifier",
	)
	c.check(
		"aborted capture is distinguishable from end of speech",
		consumeCaptureAbort(id),
	)
	c.check("abort marker is consumed exactly once", !consumeCaptureAbort(id))
	const unregisterNew = registerCaptureStop(id, (reason) =>
		stops.push(`new:${reason}`),
	)
	unregisterOld()
	c.check(
		"late unregister of an aborted capture keeps the newer capture stoppable",
		abortActiveCapture(id, "second") && stops.includes("new:second"),
	)
	unregisterNew()
	clearCaptureAbort(id)
	c.check(
		"rejection before capture starts still marks the wake for rollback",
		!abortActiveCapture(id, "early") && consumeCaptureAbort(id),
	)
	abortActiveCapture(id, "stale")
	clearCaptureAbort(id)
	c.check("a new wake clears a stale rollback marker", !consumeCaptureAbort(id))
}

const main = async (): Promise<void> => {
	const c = makeChecker()
	residualGateChecks(c)
	stopWordChecks(c)
	captureAbortChecks(c)
	await verifierChecks(c)
	await sttVerifierChecks(c)
	denoiserChecks(c)
	await aecChecks(c)
	console.log(`\nears: ${c.passCount()} passed, ${c.failCount()} failed`)
	if (c.failCount() > 0) process.exit(1)
}

void main()
