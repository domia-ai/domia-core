import path from "path"

import { connectEsphomeSatellite } from "@/modules/satellite-protocols/esphome"
import {
	getSatelliteControl,
	getPresence,
	registerAudioForServing,
} from "@/modules/core-bus"
import { getWavDurationMs } from "@/utils"
import { registerHostedIdentity } from "@/modules/core"
import { getDomia } from "@/test-utils"

import { makeChecker, sleep, createFakeEsphomeDevice, env } from "./lib"

const checker = makeChecker()

registerHostedIdentity(env.EVAL_DOMIA_KEY)

const presenceOf = (domiaKey: string, satelliteId: string) =>
	getPresence(domiaKey)?.satellites.find((s) => s.satelliteId === satelliteId)

const identityStatus = (domiaKey: string) => getPresence(domiaKey)?.status

const connectDevice = (
	satelliteId: string,
	overrides?: Record<string, unknown>,
) => {
	const device = createFakeEsphomeDevice()
	const domia = getDomia({})
	const domiaKey = env.EVAL_DOMIA_KEY
	const handle = connectEsphomeSatellite(
		{
			satelliteId,
			name: "eval fake",
			host: "127.0.0.1",
			port: 6053,
			encryptionKey: null,
			playbackDrainMarginMs: 100,
			...overrides,
		},
		domia,
		domiaKey,
		device.module,
	)
	return { device, domia, handle, domiaKey }
}

const runWiringChecks = async (): Promise<void> => {
	const { device, handle, domiaKey } = connectDevice("eval-esp-wiring")
	await sleep(30)
	checker.check(
		"connect subscribes voice assistant with API_AUDIO",
		device.callsOf("subscribeVoiceAssistant")[0]?.args[0] === 1,
	)
	checker.check(
		"connect requests VA configuration (ownership probe)",
		device.callsOf("requestVoiceAssistantConfiguration").length === 1,
	)
	const control = getSatelliteControl(domiaKey, "eval-esp-wiring")
	checker.check(
		"satellite control registered with full surface",
		!!control?.setVolume &&
			!!control?.announce &&
			!!control?.setWakeWords &&
			!!control?.setFollowUp,
	)

	control?.setWakeWords?.(["computer"])
	device.emit("voiceAssistantConfiguration", {
		availableWakeWords: [
			{ id: "computer", wakeWord: "computer" },
			{ id: "okay_nabu", wakeWord: "okay nabu" },
		],
		activeWakeWords: ["okay_nabu"],
	})
	await sleep(10)
	const applied = device.callsOf("setVoiceAssistantConfiguration")
	checker.check(
		"desired wake words re-applied when device set differs",
		JSON.stringify(applied[applied.length - 1]?.args[0]) ===
			JSON.stringify(["computer"]),
	)

	handle.close()
	await sleep(10)
	checker.check(
		"close unregisters satellite control",
		getSatelliteControl(domiaKey, "eval-esp-wiring") === null,
	)
}

const runConfigVerifyChecks = async (): Promise<void> => {
	const good = connectDevice("eval-esp-verify-good")
	const bad = connectDevice("eval-esp-verify-bad")
	await sleep(30)
	good.device.emit("voiceAssistantConfiguration", {
		availableWakeWords: [{ id: "computer", wakeWord: "computer" }],
		activeWakeWords: ["computer"],
	})
	await sleep(5300)
	checker.check(
		"verified connection never bounces",
		good.device.callsOf("disconnect").length === 0,
	)
	checker.check(
		"unverified connection bounces within the verify window",
		bad.device.callsOf("disconnect").length >= 1,
	)
	good.handle.close()
	bad.handle.close()
	await sleep(20)
}

const runMediaVolumeChecks = async (): Promise<void> => {
	const { device, handle, domiaKey } = connectDevice("eval-esp-volume")
	await sleep(30)
	const control = getSatelliteControl(domiaKey, "eval-esp-volume")

	control?.setVolume?.(0.4)
	checker.check(
		"volume before media player discovery sends no device command",
		device.callsOf("sendMediaPlayerCommand").length === 0,
	)
	checker.check(
		"desired volume persisted in presence meta while unapplied",
		presenceOf(domiaKey, "eval-esp-volume")?.volume === 0.4,
	)

	device.setEntities([
		{ type: "media_player", id: "media_player_1", key: 7, name: "Speaker" },
	])
	device.emit("entities")
	await sleep(10)
	const volumeCalls = device.callsOf("sendMediaPlayerCommand")
	const appliedVolume = volumeCalls[volumeCalls.length - 1]
	checker.check(
		"desired volume applied once the media player appears",
		(appliedVolume?.args[1] as { volume?: number })?.volume === 0.4,
	)
	handle.close()
	await sleep(10)
}

const runRequestChecks = async (): Promise<void> => {
	const { device, handle } = connectDevice("eval-esp-request")
	await sleep(30)
	device.emit("voiceAssistantRequest", { start: false })
	await sleep(10)
	checker.check(
		"stop request never gets a response (no stop-storm)",
		device.callsOf("sendVoiceAssistantResponse").length === 0,
	)
	device.emit("voiceAssistantRequest", { start: true })
	await sleep(10)
	checker.check(
		"start request opens a run (RUN_START emitted)",
		device.sentEventTypes().includes(1),
	)
	handle.close()
	await sleep(10)
}

const runAnnounceDurationChecks = async (): Promise<void> => {
	const { device, handle, domiaKey } = connectDevice("eval-esp-announce")
	await sleep(30)
	const wavPath = path.resolve("evals/fixtures/g03.wav")
	const wavMs = (await getWavDurationMs(wavPath)) ?? 0
	checker.check("fixture wav has a readable duration", wavMs > 200)
	registerAudioForServing("eval-esp-announce-audio", wavPath)

	const control = getSatelliteControl(domiaKey, "eval-esp-announce")
	control?.announce?.("http://127.0.0.1:3100/audio/eval-esp-announce-audio")
	await sleep(30)
	checker.check(
		"announce dispatched to the device",
		device.callsOf("sendVoiceAssistantAnnounce").length === 1,
	)
	device.emit("telemetry", { type: "media_player", state: 2 })
	await sleep(20)
	checker.check(
		"media playing marks presence speaking",
		identityStatus(domiaKey) === "speaking",
	)

	const startedAt = Date.now()
	const deadline = startedAt + 12_000
	while (identityStatus(domiaKey) === "speaking" && Date.now() < deadline) {
		await sleep(100)
	}
	const clearedAfterMs = Date.now() - startedAt
	checker.check(
		"speaking clears from real duration, not the 15s fallback",
		clearedAfterMs < 10_000 && clearedAfterMs >= Math.min(wavMs, 500),
		`cleared after ${clearedAfterMs}ms (wav ${Math.round(wavMs)}ms)`,
	)
	handle.close()
	await sleep(10)
}

const main = async (): Promise<void> => {
	await runWiringChecks()
	await runMediaVolumeChecks()
	await runRequestChecks()
	await runAnnounceDurationChecks()
	await runConfigVerifyChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} esphome-adapter checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
