import { createEsphomeRunController } from "../src/modules/satellite-protocols/esphome/controller/run-controller"
import { sleep } from "./lib"
import type { EsphomeSentEventType } from "./types"

const EV = {
	runStart: 1,
	runEnd: 2,
	sttVadEnd: 3,
	error: 4,
	sttStart: 5,
	intentStart: 6,
	intentEnd: 7,
	ttsStart: 8,
	ttsEnd: 9,
	sttEnd: 10,
}

const harness = (
	hooks: { onCancelled?: () => void; externalMedia?: boolean } = {},
) => {
	const sent: EsphomeSentEventType[] = []
	const announces: string[] = []
	let stops = 0
	let closed = 0
	let cancelled = 0
	let ended = 0
	let externalMedia = hooks.externalMedia ?? false
	const rc = createEsphomeRunController({
		satelliteId: "test-sat",
		sendEvent: (type, data) => sent.push({ type, data }),
		respondToRequest: () => undefined,
		sendAnnounce: (url) => announces.push(url),
		stopMedia: () => {
			stops++
			return true
		},
		externalMediaPlaying: () => externalMedia,
		events: EV,
		budgets: {
			listeningMaxMs: 80,
			followUpNoSpeechMs: 60,
			drainMarginMs: 20,
			followUpRequestMaxMs: 60,
			processingMaxMs: 500,
		},
		onRunAccepted: () => undefined,
		onRunCancelled: () => {
			cancelled++
			hooks.onCancelled?.()
		},
		onRunClosed: () => {
			closed++
		},
		onPlaybackStart: () => undefined,
		onPlaybackEnd: () => {
			ended++
		},
	})
	return {
		rc,
		sent,
		announces,
		stops: () => stops,
		closed: () => closed,
		cancelled: () => cancelled,
		ended: () => ended,
		setExternalMedia: (playing: boolean) => {
			externalMedia = playing
		},
	}
}

const checks: [string, boolean][] = []
const expect = (name: string, ok: boolean) => checks.push([name, ok])

const main = async () => {
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onRequest(true)
		const errs = h.sent.filter((s) => s.type === EV.error)
		expect("duplicate start rejected with error", errs.length === 1)
		h.rc.onRequest(true)
		expect(
			"post-duplicate both sides resynced (new run opens)",
			h.sent.filter((s) => s.type === EV.runStart).length === 2,
		)
		expect(
			"duplicate start closed with runEnd",
			h.sent.some((s) => s.type === EV.runEnd),
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("hello there")
		h.rc.enqueuePlayback(
			"http://x/reply.wav",
			"reply",
			false,
			100,
			h.rc.currentGeneration(),
		)
		const order = h.sent.map((s) => s.type)
		expect(
			"ladder order sttEnd before intentStart",
			order.indexOf(EV.sttEnd) < order.indexOf(EV.intentStart),
		)
		expect(
			"reply uses native ladder (intentEnd+ttsEnd+runEnd)",
			h.sent.some((s) => s.type === EV.intentEnd) &&
				h.sent.some((s) => s.type === EV.ttsEnd) &&
				h.announces.length === 0,
		)
		h.rc.onMediaState(2)
		h.rc.onMediaState(1)
		await sleep(200)
		h.rc.enqueuePlayback("http://x/a1.wav", "announce", false, 50)
		expect("announce path still announces", h.announces.length === 1)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.enqueuePlayback(
			"http://x/r.wav",
			"reply",
			true,
			40,
			h.rc.currentGeneration(),
		)
		h.rc.onMediaState(2)
		h.rc.onMediaState(1)
		await sleep(60)
		h.rc.onRequest(true)
		expect("follow-up run recognized", h.rc.isFollowUpRun())
		await sleep(120)
		const errPayload = h.sent
			.filter((s) => s.type === EV.error)
			.map((s) => s.data?.[0]?.value)
		expect(
			"empty follow-up closes silently with stt-no-text-recognized",
			errPayload.includes("stt-no-text-recognized"),
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.enqueuePlayback(
			"http://x/r.wav",
			"reply",
			true,
			30,
			h.rc.currentGeneration(),
		)
		h.rc.onMediaState(2)
		h.rc.onMediaState(1)
		await sleep(70)
		h.rc.onRequest(true)
		await sleep(150)
		const closedEmpty = h.sent
			.filter((s) => s.type === EV.error)
			.some((s) => s.data?.[0]?.value === "stt-no-text-recognized")
		expect("empty window closed", closedEmpty)
		const sttEndsBefore = h.sent.filter((s) => s.type === EV.sttEnd).length
		h.rc.onTranscript("too late")
		expect(
			"late transcript with text recovers the turn (stability mode)",
			h.sent.filter((s) => s.type === EV.sttEnd).length === sttEndsBefore + 1,
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("hi")
		h.rc.enqueuePlayback(
			"http://x/r1.wav",
			"reply",
			false,
			60,
			h.rc.currentGeneration(),
		)
		const before = h.sent.length
		h.rc.dispose()
		h.rc.onMediaState(1)
		h.rc.onAnnounceFinished()
		h.rc.onRequest(true)
		expect("post-dispose events are no-ops", h.sent.length === before)
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("hi")
		h.rc.enqueuePlayback(
			"http://x/r1.wav",
			"reply",
			false,
			40,
			h.rc.currentGeneration(),
		)
		h.rc.onRequest(false)
		expect("device stop stops media + clears queue", h.stops() >= 1)
		h.rc.enqueuePlayback("http://x/a2.wav", "announce", false, 40)
		expect(
			"queue dispatches after cancel (single active playback invariant)",
			h.announces.includes("http://x/a2.wav"),
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("first question")
		h.rc.enqueuePlayback(
			"http://x/r.wav",
			"reply",
			true,
			300,
			h.rc.currentGeneration(),
		)
		h.rc.onMediaState(2)
		h.rc.onRequest(true)
		expect("early follow-up opens while playing", h.rc.isFollowUpRun())
		h.rc.onMediaState(1)
		await sleep(330)
		const emptyCloses = h.sent
			.filter((s) => s.type === EV.error)
			.filter((s) => s.data?.[0]?.value === "stt-no-text-recognized").length
		expect("no empty-close before transcript", emptyCloses === 0)
		const runEndsBefore = h.sent.filter((s) => s.type === EV.runEnd).length
		h.rc.onTranscript("follow up speech")
		expect(
			"early-followup run survives prior playback end (sttEnd emitted)",
			h.sent.filter((s) => s.type === EV.sttEnd).length === 2 &&
				h.sent.filter((s) => s.type === EV.runEnd).length === runEndsBefore,
		)
		h.rc.enqueuePlayback(
			"http://x/r2.wav",
			"reply",
			false,
			40,
			h.rc.currentGeneration(),
		)
		expect(
			"follow-up reply dispatches via ladder",
			h.sent.filter((s) => s.type === EV.ttsEnd).length === 2,
		)
		h.rc.dispose()
	}
	{
		const h = harness({
			onCancelled: () => h.rc.finishTurn(),
		})
		h.rc.onRequest(true)
		h.rc.onTranscript("hello")
		await sleep(600)
		expect(
			"reentry: watchdog cancel yields exactly one close + one cancel",
			h.closed() === 1 && h.cancelled() === 1,
		)
		expect(
			"reentry: exactly one RUN_END",
			h.sent.filter((s) => s.type === EV.runEnd).length === 1,
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("question")
		const staleToken = h.rc.currentGeneration()
		h.rc.onRequest(false)
		h.rc.onRequest(true)
		const gen = h.rc.enqueuePlayback(
			"http://x/late.wav",
			"reply",
			false,
			40,
			staleToken,
		)
		expect("stale-token reply rejected (enforcement)", gen === null)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.notifySpeechEnd()
		await sleep(600)
		expect(
			"stuck STT: processing watchdog cancels exactly once",
			h.cancelled() === 1 && h.closed() === 1,
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("run A question")
		h.rc.onRequest(false)
		h.rc.onRequest(true)
		const vadEndsBefore = h.sent.filter((s) => s.type === EV.sttVadEnd).length
		h.rc.notifySpeechEnd()
		expect(
			"speechEnd accepted only while listening",
			h.sent.filter((s) => s.type === EV.sttVadEnd).length ===
				vadEndsBefore + 1,
		)
		h.rc.onRequest(false)
		h.rc.notifySpeechEnd()
		expect(
			"late speechEnd after close is a no-op",
			h.sent.filter((s) => s.type === EV.sttVadEnd).length ===
				vadEndsBefore + 1,
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		h.rc.onTranscript("q")
		const stale = h.rc.currentGeneration()
		h.rc.onRequest(false)
		h.rc.onRequest(true)
		h.rc.onTranscript("q2")
		const observed = h.rc.enqueuePlayback(
			"http://x/old.wav",
			"reply",
			false,
			40,
			stale,
		)
		expect("stale reply enqueue rejected (enforcement)", observed === null)
		const good = h.rc.enqueuePlayback(
			"http://x/new.wav",
			"reply",
			false,
			500,
			h.rc.currentGeneration(),
		)
		expect(
			"valid reply keeps its own duration untouched by stale updates",
			good !== null,
		)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.onRequest(true)
		const noToken = h.rc.enqueuePlayback(
			"http://x/unmapped.wav",
			"reply",
			false,
			40,
		)
		expect("reply without run token rejected (fail-closed)", noToken === null)
		const announce = h.rc.enqueuePlayback(
			"http://x/oob.wav",
			"announce",
			false,
			40,
		)
		expect("announcement without token still allowed", announce !== null)
		h.rc.dispose()
	}
	{
		const h = harness()
		const playing = h.rc.onMediaState(2)
		expect(
			"state 2 before dispatch marks external playing, not ours",
			playing.external === "playing" && playing.ours === null,
		)
		const idle = h.rc.onMediaState(1)
		expect(
			"idle state with nothing in flight marks external idle",
			idle.external === "idle" && idle.ours === null,
		)
		const announcing = h.rc.onMediaState(4)
		expect(
			"announcing with nothing in flight is ignored",
			announcing.external === null && announcing.ours === null,
		)
		h.rc.dispose()
	}
	{
		const h = harness({ externalMedia: true })
		h.rc.onRequest(true)
		h.rc.onTranscript("what is playing")
		h.rc.enqueuePlayback(
			"http://x/over.wav",
			"reply",
			false,
			null,
			h.rc.currentGeneration(),
		)
		const started = h.rc.onMediaState(4)
		expect(
			"announce over external media reads as ours",
			started.ours === "started" && started.external === null,
		)
		const back = h.rc.onMediaState(2)
		expect(
			"2 → 4 → 2 over media retires the item on media-state, not the fallback",
			back.ours === "ended" && back.external === "playing",
		)
		await sleep(80)
		expect("item over media retired on media-state", h.ended() === 1)
		h.rc.dispose()
	}
	{
		const h = harness()
		h.rc.enqueuePlayback("http://x/lone.wav", "announce", false, null)
		const started = h.rc.onMediaState(2)
		expect(
			"lone announce still accepts 2 as ours",
			started.ours === "started" && started.external === null,
		)
		const done = h.rc.onMediaState(1)
		expect("lone announce retires when media goes idle", done.ours === "ended")
		await sleep(80)
		expect("lone announce playback ended", h.ended() === 1)
		h.rc.dispose()
	}
	{
		const overMedia = harness({ externalMedia: true })
		overMedia.rc.enqueuePlayback("http://x/dur.wav", "announce", false, 40)
		const lone = harness()
		lone.rc.enqueuePlayback("http://x/dur.wav", "announce", false, 40)
		await sleep(140)
		expect(
			"item over media without ANNOUNCING finishes on duration+drainMargin",
			overMedia.ended() === 1,
		)
		expect(
			"item without external media keeps the +5s anomaly bound",
			lone.ended() === 0,
		)
		overMedia.rc.dispose()
		lone.rc.dispose()
	}
	{
		const h = harness({ externalMedia: true })
		h.rc.onRequest(true)
		h.rc.onTranscript("hey")
		h.rc.enqueuePlayback(
			"http://x/r.wav",
			"reply",
			false,
			400,
			h.rc.currentGeneration(),
		)
		h.rc.onMediaState(4)
		h.rc.onRequest(true)
		expect(
			"wake during a reply stops playback via stopMedia (announcement flag asserted in esphome-adapter)",
			h.stops() === 1,
		)
		h.rc.dispose()
	}
	let failed = 0
	for (const [name, ok] of checks) {
		console.log(`${ok ? "✅" : "❌"} ${name}`)
		if (!ok) failed++
	}
	console.log(
		`${checks.length - failed}/${checks.length} esphome-controller checks passed`,
	)
	if (failed) process.exit(1)
}

void main()
