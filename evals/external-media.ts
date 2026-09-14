import {
	externalMediaKey,
	noteExternalMedia,
	clearExternalMedia,
	isExternalMediaPlaying,
	registerExternalMediaControls,
	unregisterExternalMediaControls,
	getExternalMediaControls,
} from "@/modules/audio-playback"

import { makeChecker } from "./lib"

const checker = makeChecker()

const main = async (): Promise<void> => {
	checker.check(
		"key includes the satellite id",
		externalMediaKey("DOMIA_A", "kitchen-pe") === "DOMIA_A:kitchen-pe",
	)
	checker.check(
		"key falls back to local for the node itself",
		externalMediaKey("DOMIA_A", null) === "DOMIA_A:local",
	)

	const key = externalMediaKey("DOMIA_A", "eval-sat")
	const other = externalMediaKey("DOMIA_A", "eval-other")
	clearExternalMedia(key)
	clearExternalMedia(other)

	checker.check("unknown key is not playing", !isExternalMediaPlaying(key))

	noteExternalMedia(key, true)
	checker.check(
		"event-driven playing note has no expiry",
		isExternalMediaPlaying(key),
	)
	checker.check("notes are per key", !isExternalMediaPlaying(other))

	noteExternalMedia(key, false)
	checker.check("idle note clears playing", !isExternalMediaPlaying(key))

	noteExternalMedia(key, true)
	clearExternalMedia(key)
	checker.check("clear drops the note", !isExternalMediaPlaying(key))

	const controlKey = externalMediaKey("DOMIA_A", "eval-controls")
	checker.check(
		"a key with no transport has no controls",
		getExternalMediaControls(controlKey) === null,
	)
	let lastLevel = -1
	let reported = 35
	registerExternalMediaControls(controlKey, {
		origin: "transport",
		setVolume: (level) => {
			lastLevel = level
			reported = level
			return Promise.resolve(true)
		},
		getVolume: () => reported,
	})
	const controls = getExternalMediaControls(controlKey)
	checker.check(
		"registered controls come back tagged as the transport",
		controls?.origin === "transport",
	)
	checker.check(
		"getVolume reads the transport level as a percentage",
		controls?.getVolume() === 35,
	)
	checker.check(
		"setVolume reaches the transport",
		(await controls?.setVolume(60)) === true && lastLevel === 60,
	)
	checker.check(
		"controls are per key",
		getExternalMediaControls(
			externalMediaKey("DOMIA_A", "eval-no-controls"),
		) === null,
	)
	noteExternalMedia(controlKey, true)
	clearExternalMedia(controlKey)
	checker.check(
		"clearing the playing note leaves the controls registered",
		getExternalMediaControls(controlKey)?.getVolume() === 60,
	)
	unregisterExternalMediaControls(controlKey)
	checker.check(
		"unregister drops the controls",
		getExternalMediaControls(controlKey) === null,
	)

	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} external-media checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
