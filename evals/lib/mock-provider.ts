import { randomUUID } from "crypto"

import { execWrite, queryAll } from "./db"
import { env } from "./env"
import { postModules, sleep } from "./http"
import { startMockHa, startPlainMcp } from "./mock-ha"
import { startMockMusic } from "./mock-music"
import {
	MOCK_HA_PROVIDER_ID,
	MOCK_MUSIC_PROVIDER_ID,
	MOCK_PLAIN_PROVIDER_ID,
	MOCK_SATELLITE_ID,
	deleteMockProviders,
	waitForMockSync,
} from "./requirements"
import type { MockProvidersControlType } from "../types"

const MUSIC_WHITELIST = [
	"playback_pause",
	"playback_resume",
	"playback_next_track",
	"playback_previous_track",
	"volume_volume_set",
	"volume_volume_up",
	"volume_volume_down",
	"volume_volume_mute",
]

const MUSIC_PLAYER_NAME = "Voice PE 1"

const reloadSkills = async (): Promise<void> => {
	await postModules({ skillsEngine: false })
	await sleep(500)
	await postModules({ skillsEngine: true })
}

const reactivate = (ids: readonly string[]): void => {
	for (const id of ids)
		execWrite("UPDATE skill_provider SET is_active = 1 WHERE id = ?", [id])
}

const armSelfHeal = (realProviderIds: readonly string[]): (() => void) => {
	let armed = true
	const heal = (): void => {
		if (!armed) return
		armed = false
		console.warn(
			"♻️ mock provider run ended early — restoring the real skill_provider rows",
		)
		deleteMockProviders()
		reactivate(realProviderIds)
	}
	const onSignal = (): void => {
		heal()
		process.exit(130)
	}
	process.on("exit", heal)
	process.on("SIGINT", onSignal)
	process.on("SIGTERM", onSignal)
	return () => {
		armed = false
		process.off("exit", heal)
		process.off("SIGINT", onSignal)
		process.off("SIGTERM", onSignal)
	}
}

const insertEvalSatellite = (): void => {
	execWrite(
		`INSERT OR REPLACE INTO satellite_config
		 (id, domia_id, satellite_id, name, host, media_player_name)
		 VALUES (?, (SELECT id FROM domia WHERE domia_key = ?), ?, 'Eval satellite', '127.0.0.1', ?)`,
		[randomUUID(), env.EVAL_DOMIA_KEY, MOCK_SATELLITE_ID, MUSIC_PLAYER_NAME],
	)
}

export const setupMockProviders = async (
	options: { ha?: boolean; music?: boolean; plain?: boolean } = {},
): Promise<MockProvidersControlType> => {
	const domainPrefixed = env.EVAL_MOCK_DOMAIN_PREFIXED === "1"
	if (options.ha && domainPrefixed)
		console.log("🧪 mock HA advertising domain-prefixed tool names")
	const ha = options.ha ? await startMockHa(0, { domainPrefixed }) : null
	const music = options.music ? await startMockMusic() : null
	const plain = options.plain ? await startPlainMcp() : null
	const realProviders = queryAll<{ id: string }>(
		"SELECT id FROM skill_provider WHERE is_active = 1 AND id NOT LIKE 'eval-%' AND domia_id = (SELECT id FROM domia WHERE domia_key = ?)",
		[env.EVAL_DOMIA_KEY],
	)
	const disarmSelfHeal = armSelfHeal(realProviders.map((p) => p.id))
	for (const p of realProviders)
		execWrite("UPDATE skill_provider SET is_active = 0 WHERE id = ?", [p.id])
	if (ha)
		execWrite(
			`INSERT OR REPLACE INTO skill_provider
			 (id, name, is_active, domia_id, protocol, type, url, descriptor, priority)
			 VALUES (?, 'home-assistant', 1,
			   (SELECT id FROM domia WHERE domia_key = ?), 'mcp', 'http', ?,
			   '{"version": 1, "kind": "home-assistant"}', 0)`,
			[MOCK_HA_PROVIDER_ID, env.EVAL_DOMIA_KEY, ha.url],
		)
	if (music) {
		execWrite(
			`INSERT OR REPLACE INTO skill_provider
			 (id, name, is_active, domia_id, protocol, type, url, descriptor, tool_whitelist, trust_tier, priority)
			 VALUES (?, 'music', 1,
			   (SELECT id FROM domia WHERE domia_key = ?), 'mcp', 'http', ?,
			   '{"version":1,"kind":"music-assistant"}', ?, 'untrusted', 1)`,
			[
				MOCK_MUSIC_PROVIDER_ID,
				env.EVAL_DOMIA_KEY,
				music.url,
				JSON.stringify(MUSIC_WHITELIST),
			],
		)
		insertEvalSatellite()
	}
	if (plain)
		execWrite(
			`INSERT OR REPLACE INTO skill_provider
			 (id, name, is_active, domia_id, protocol, type, url, descriptor, priority, trust_tier)
			 VALUES (?, 'notes', 1,
			   (SELECT id FROM domia WHERE domia_key = ?), 'mcp', 'http', ?,
			   '{"version": 1, "execution": {"toolHints": {"NotePublish": {"destructiveHint": false}}}}', 1, 'standard')`,
			[MOCK_PLAIN_PROVIDER_ID, env.EVAL_DOMIA_KEY, plain.url],
		)
	const syncAll = async (): Promise<void> => {
		if (ha && !(await waitForMockSync(MOCK_HA_PROVIDER_ID, "HassTurnOn")))
			console.warn("⚠️ mock-ha provider did not sync tools in time")
		if (
			music &&
			!(await waitForMockSync(MOCK_MUSIC_PROVIDER_ID, "playback_pause"))
		)
			console.warn("⚠️ mock-music provider did not sync tools in time")
	}
	await reloadSkills()
	await syncAll()
	return {
		teardown: async () => {
			disarmSelfHeal()
			deleteMockProviders()
			reactivate(realProviders.map((p) => p.id))
			await reloadSkills()
			await ha?.close()
			await music?.close()
			await plain?.close()
		},
		ha: ha
			? {
					setBehavior: ha.setBehavior,
					resync: async () => {
						await reloadSkills()
						await waitForMockSync(MOCK_HA_PROVIDER_ID, "HassTurnOn")
					},
				}
			: null,
		music: music
			? {
					setBehavior: music.setBehavior,
					reset: music.reset,
					state: music.state,
				}
			: null,
	}
}
