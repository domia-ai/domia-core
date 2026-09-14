import { registerReloader, registerBusyCheck } from "@/modules/config-apply"
import { reloadSttPool, sttPoolBusy } from "@/modules/stt-engine"
import { reloadTtsPool, ttsPoolBusy } from "@/modules/tts-engine"
import { clearLlmClientCache, probeLlmEngine } from "@/modules/llm-engine"
import { warmupAfterTtsReload } from "@/modules/warmup"
import { resetIntentCache } from "@/modules/intent-router"
import { safeOwnDomia } from "@/modules/core"
import { hasActivePlayback } from "@/modules/audio-playback"
import { reloadMqtt } from "../mqtt"
import { reloadVoiceListener } from "../voice-listener"
import { reloadSkills } from "../skills"
import { reloadSatelliteClientsForDomia } from "../satellite-clients"
import { reloadProactivity } from "../proactivity"
import { reloadVoiceFeel } from "../voice-feel"
import {
	bootHostedIdentity,
	teardownHostedIdentity,
} from "../hosted-identities"

export const setupConfigReloaders = (): void => {
	registerReloader("stt-pool", {
		scope: "global",
		reload: async (domia) => {
			await reloadSttPool(domia)
		},
	})
	registerReloader("tts-pool", {
		scope: "global",
		reload: async (domia) => {
			await reloadTtsPool(domia)
			warmupAfterTtsReload(domia)
		},
	})
	registerReloader("llm", {
		scope: "global",
		reload: async (domia) => {
			await probeLlmEngine(domia)
			clearLlmClientCache()
			resetIntentCache()
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
	registerReloader("proactivity", {
		scope: "per-identity",
		reload: (domia) => {
			reloadProactivity(domia)
			return Promise.resolve()
		},
	})
	registerReloader("voice-feel", {
		scope: "per-identity",
		reload: (domia) => {
			reloadVoiceFeel(domia)
			return Promise.resolve()
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
