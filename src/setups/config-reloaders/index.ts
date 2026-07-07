import { registerReloader, registerBusyCheck } from "@/modules/config-apply"
import { reloadSttPool, sttPoolBusy } from "@/modules/stt-engine"
import { reloadTtsPool, ttsPoolBusy } from "@/modules/tts-engine"
import { safeOwnDomia } from "@/modules/core"
import { hasActivePlayback } from "@/modules/audio-playback"
import { reloadMqtt } from "../mqtt"
import { reloadVoiceListener } from "../voice-listener"
import { reloadSkills } from "../skills"
import { reloadSatelliteClientsForDomia } from "../satellite-clients"
import {
	bootHostedIdentity,
	teardownHostedIdentity,
} from "../hosted-identities"

export const setupConfigReloaders = (): void => {
	registerReloader("stt-pool", {
		scope: "global",
		reload: async () => {
			await reloadSttPool()
		},
	})
	registerReloader("tts-pool", {
		scope: "global",
		reload: async () => {
			await reloadTtsPool()
		},
	})
	registerReloader("mqtt", {
		scope: "global",
		reload: async () => {
			const principal = await safeOwnDomia(
				undefined,
				"config-reloader principal",
			)
			if (principal) await reloadMqtt(principal)
		},
	})
	registerReloader("voice-listener", {
		scope: "per-identity",
		reload: async (domia) => {
			await reloadVoiceListener(domia)
		},
	})
	registerReloader("skills", {
		scope: "per-identity",
		reload: async (domia) => {
			await reloadSkills(domia)
		},
	})
	registerReloader("satellites", {
		scope: "per-identity",
		reload: async (domia) => {
			await reloadSatelliteClientsForDomia(domia)
		},
	})
	registerReloader("identity", {
		scope: "per-identity",
		reload: async (domia, domiaKey) => {
			if (domia.isHosted) await bootHostedIdentity(domiaKey)
			else await teardownHostedIdentity(domiaKey)
		},
	})
	registerBusyCheck(() => sttPoolBusy())
	registerBusyCheck(() => ttsPoolBusy())
	registerBusyCheck((domiaId) => hasActivePlayback(domiaId))
}
