import { type DomiaType, getDomiaByDomiaKey } from "@/modules/core"
import { reportReflectionToTarget } from "@/modules/grpc-client"
import { resolveDomiaStreamingCapabilities } from "@/modules/capability-resolver"
import { runLLMJson } from "@/modules/llm-engine"
import {
	personaContextFromDomia,
	type PersonaContextType,
} from "@/modules/prompt-context-builder"
import {
	getRecentTrajectory,
	applyMoodDelta,
	buildMoodContextLines,
	emotionAppraisalInstructionLines,
	parseEmotionFromObject,
	userEmotionInstructionLines,
	parseUserEmotionFromObject,
	type EmotionAppraisalType,
	type EmotionTrajectoryEntryType,
	type UserEmotionType,
} from "@/modules/emotion-engine"
import { updateInteraction } from "@/modules/session-manager"
import {
	buildFactExtractionLines,
	parseFacts,
	upsertFacts,
	type RawFactType,
} from "@/modules/memory"
import {
	reflectionLogger,
	createAsyncSemaphore,
	isSemaphoreBusyError,
	sleep,
	withTimeout,
} from "@/utils"
import { activeVoiceReplies } from "@/modules/voice-admission"
import {
	DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	DEFAULT_REFLECTION_YIELD_TO_VOICE,
} from "@/db"
import {
	REFLECTION_TIMEOUT_MS,
	REFLECTION_IDLE_POLL_MS,
	REFLECTION_MAX_IDLE_WAIT_MS,
	REFLECTION_SLOT_TIMEOUT_MS,
	REFLECTION_YIELD_MAX_ATTEMPTS,
} from "../constants"
import type {
	ReflectionFlagsType,
	ReflectionResultType,
	ReflectionGateSettingsType,
} from "../types"

const buildReflectionPrompt = (
	persona: PersonaContextType,
	userText: string,
	replyText: string,
	trajectory: EmotionTrajectoryEntryType[],
	flags: ReflectionFlagsType,
): string => {
	const name = persona.characterProfile?.name ?? "Domia"
	const lines: string[] = []
	if (flags.emotion) lines.push(...buildMoodContextLines(persona, trajectory))
	lines.push(
		`The person said: "${userText}"`,
		`${name} replied: "${replyText}"`,
		"",
	)

	const keys = [
		flags.emotion && `"emotion"`,
		flags.emotion && `"userEmotion"`,
		flags.facts && `"facts"`,
	]
		.filter(Boolean)
		.join(", ")
	lines.push(`Respond with ONLY a JSON object with ${keys}.`)
	if (flags.emotion) {
		lines.push(...emotionAppraisalInstructionLines())
		lines.push(...userEmotionInstructionLines())
	}
	if (flags.facts) lines.push(...buildFactExtractionLines())
	return lines.join("\n")
}

const SIG_WORD = /[a-z]{4,}/g
const FIRST_PERSON = /\b(i|i'm|i am|i've|i have|my|mine)\b/i
const QUESTION_START =
	/^(what|why|how|when|where|who|which|whose|do|does|did|can|could|would|will|shall|should|is|are|am|was|were|may|might|have|has)\b/i

const isPureQuestion = (text: string): boolean => {
	const t = text.trim()
	const interrogative = t.endsWith("?") || QUESTION_START.test(t)
	return interrogative && !FIRST_PERSON.test(t)
}

const filterReflectionFacts = (
	facts: RawFactType[],
	userText: string,
	replyText: string,
	persona: PersonaContextType,
): RawFactType[] => {
	if (isPureQuestion(userText)) return []
	const user = userText.toLowerCase()
	const reply = replyText.toLowerCase()
	const personaName = (persona.characterProfile?.name ?? "domia").toLowerCase()
	return facts.filter((fact) => {
		const subject = fact.subject.toLowerCase()
		if (
			subject.includes(personaName) ||
			subject.includes("domia") ||
			subject.includes("assistant") ||
			subject === "you"
		) {
			return false
		}
		const words = fact.value.toLowerCase().match(SIG_WORD) ?? []
		if (words.length > 0) {
			const fromReply = words.some((w) => reply.includes(w))
			const fromUser = words.some((w) => user.includes(w))
			if (fromReply && !fromUser) return false
		}
		return true
	})
}

const reflectionSemaphore = createAsyncSemaphore(
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
)

const gateSettings = (domia: DomiaType): ReflectionGateSettingsType => ({
	onlyWhenIdle:
		domia?.moduleSettings?.reflectionOnlyWhenIdle ??
		DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	concurrency:
		domia?.moduleSettings?.reflectionConcurrency ??
		DEFAULT_REFLECTION_CONCURRENCY,
	queueMaxDepth:
		domia?.moduleSettings?.reflectionQueueMaxDepth ??
		DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	yieldToVoice:
		domia?.moduleSettings?.reflectionYieldToVoice ??
		DEFAULT_REFLECTION_YIELD_TO_VOICE,
})

const waitForIdle = async (onlyWhenIdle: boolean): Promise<boolean> => {
	if (!onlyWhenIdle) return true
	if (activeVoiceReplies() > 0) {
		reflectionLogger.info(
			"⏳ reflection yielding LLM to live rooms — waiting for hub idle",
			{ activeVoiceReplies: activeVoiceReplies() },
		)
	}
	const deadline = Date.now() + REFLECTION_MAX_IDLE_WAIT_MS
	while (activeVoiceReplies() > 0) {
		if (Date.now() >= deadline) return false
		await sleep(REFLECTION_IDLE_POLL_MS)
	}
	return true
}

const runGated = async <T>(
	settings: ReflectionGateSettingsType,
	fn: () => Promise<T>,
	skipValue: T,
): Promise<T> => {
	reflectionSemaphore.setLimit(settings.concurrency)
	reflectionSemaphore.setMaxWaiters(settings.queueMaxDepth)
	let release!: () => void
	try {
		release = await reflectionSemaphore.acquire({
			timeoutMs: REFLECTION_SLOT_TIMEOUT_MS,
		})
	} catch (err) {
		if (isSemaphoreBusyError(err)) {
			reflectionLogger.info("reflection gate full — skipping (best-effort)")
			return skipValue
		}
		throw err
	}
	try {
		const idle = await waitForIdle(settings.onlyWhenIdle)
		if (!idle) {
			reflectionLogger.info(
				"reflection deferred while hub busy — skipping (best-effort)",
			)
			return skipValue
		}
		return await fn()
	} finally {
		release()
	}
}

export const runReflection = async (
	responder: DomiaType,
	persona: PersonaContextType,
	userText: string,
	replyText: string,
	trajectory: EmotionTrajectoryEntryType[],
	flags: ReflectionFlagsType,
): Promise<ReflectionResultType> => {
	if (!userText?.trim() || !replyText?.trim())
		return { emotion: null, userEmotion: null, facts: [] }

	const key = responder?.id ?? ""
	const reflectionModel = responder?.llmModelConfig?.reflectionModelName?.trim()
	const reflector =
		reflectionModel && responder?.llmModelConfig
			? {
					...responder,
					llmModelConfig: {
						...responder.llmModelConfig,
						modelName: reflectionModel,
					},
				}
			: responder
	try {
		const empty: ReflectionResultType = {
			emotion: null,
			userEmotion: null,
			facts: [],
		}
		const settings = gateSettings(responder)
		const prompt = buildReflectionPrompt(
			persona,
			userText,
			replyText,
			trajectory,
			flags,
		)
		for (let attempt = 1; attempt <= REFLECTION_YIELD_MAX_ATTEMPTS; attempt++) {
			let yielded = false
			const result = await runGated(
				settings,
				async () => {
					const deadline = Date.now() + REFLECTION_TIMEOUT_MS
					const shouldAbort = (): boolean => {
						if (Date.now() > deadline) return true
						if (!settings.yieldToVoice) return false
						const busy = activeVoiceReplies() > 0
						if (busy) yielded = true
						return busy
					}
					const raw = await withTimeout(
						runLLMJson(reflector, prompt, shouldAbort),
						REFLECTION_TIMEOUT_MS,
						"reflection",
					)
					if (yielded) return empty
					const match = raw.match(/\{[\s\S]*\}/)
					const obj = match
						? (JSON.parse(match[0]) as Record<string, unknown>)
						: {}
					const emotion: EmotionAppraisalType | null = flags.emotion
						? parseEmotionFromObject(obj.emotion)
						: null
					const userEmotion: UserEmotionType | null = flags.emotion
						? parseUserEmotionFromObject(obj.userEmotion)
						: null
					const facts: RawFactType[] = flags.facts
						? filterReflectionFacts(
								parseFacts(obj.facts),
								userText,
								replyText,
								persona,
							)
						: []
					return { emotion, userEmotion, facts }
				},
				empty,
			)
			if (!yielded) return result
			reflectionLogger.info(
				`⏳ reflection yielded LLM to live voice — requeued (${attempt}/${REFLECTION_YIELD_MAX_ATTEMPTS})`,
				{ responderId: key },
			)
			await sleep(REFLECTION_IDLE_POLL_MS * 4)
		}
		reflectionLogger.warn(
			"reflection skipped after repeated yields to live voice (best-effort)",
			{ responderId: key },
		)
		return empty
	} catch (err) {
		reflectionLogger.warn("Reflection failed (skipping)", {
			responderId: responder?.id,
			err,
		})
		return { emotion: null, userEmotion: null, facts: [] }
	}
}

export const flagsForDomia = (domia: DomiaType): ReflectionFlagsType => ({
	emotion: domia?.moduleSettings?.emotionCapture !== false,
	facts: domia?.moduleSettings?.factCapture !== false,
})

export const flagsForPersona = (
	persona: PersonaContextType,
): ReflectionFlagsType => ({
	emotion: persona?.moduleSettings?.emotionCapture !== false,
	facts: persona?.moduleSettings?.factCapture !== false,
})

export const routeReflectionResult = async (
	executor: DomiaType,
	originDomiaKey: string | undefined,
	result: ReflectionResultType,
	interactionId?: string,
): Promise<void> => {
	const { emotion, userEmotion, facts } = result
	const hasEmotion = !!emotion && Object.keys(emotion.delta).length > 0
	const hasFacts = facts.length > 0
	const hasUserEmotion = !!userEmotion
	if (!hasEmotion && !hasFacts && !hasUserEmotion) return

	const isRemote = !!originDomiaKey && originDomiaKey !== executor.domiaKey

	if (!isRemote) {
		if (hasEmotion) applyMoodDelta(executor, emotion.delta, emotion.cause)
		if (hasUserEmotion && interactionId)
			void updateInteraction({
				id: interactionId,
				userEmotionSnapshot: userEmotion,
			})
		if (hasFacts) await upsertFacts(executor, facts, interactionId)
		return
	}

	const origin = await getDomiaByDomiaKey(originDomiaKey)
	if (!origin) {
		reflectionLogger.warn(
			"reflection result dropped — origin domia unknown locally",
			{ originDomiaKey, interactionId },
		)
		return
	}
	const accepted = await reportReflectionToTarget(
		executor.domiaKey,
		{
			domiaKey: origin.domiaKey,
			domiaId: origin.id,
			localIp: origin.localIp,
			grpcPort: origin.grpcPort,
			source: "explicit",
			streamingCapabilities: resolveDomiaStreamingCapabilities(origin),
		},
		{
			originDomiaKey,
			interactionId,
			emotionDeltaJson: hasEmotion ? JSON.stringify(emotion.delta) : undefined,
			cause: hasEmotion ? emotion.cause : undefined,
			factsJson: hasFacts ? JSON.stringify(facts) : undefined,
			userEmotionJson: hasUserEmotion ? JSON.stringify(userEmotion) : undefined,
		},
	)
	if (!accepted) {
		reflectionLogger.warn("reflection report not accepted by origin", {
			originDomiaKey,
			interactionId,
		})
	}
}

const reflectedInteractions = new Map<string, number>()
const REFLECTION_DEDUP_TTL_MS = 5 * 60 * 1000

const claimReflection = (interactionId: string): boolean => {
	const now = Date.now()
	for (const [id, ts] of reflectedInteractions)
		if (now - ts > REFLECTION_DEDUP_TTL_MS) reflectedInteractions.delete(id)
	if (reflectedInteractions.has(interactionId)) return false
	reflectedInteractions.set(interactionId, now)
	return true
}

export const reflectOnInteraction = async (
	domia: DomiaType,
	userText: string,
	replyText: string,
	interactionId?: string,
	originDomiaKey?: string,
): Promise<void> => {
	const flags = flagsForDomia(domia)
	if (!flags.emotion && !flags.facts) return
	if (interactionId && !claimReflection(interactionId)) {
		reflectionLogger.info("🪞 reflection skipped — already captured", {
			interactionId,
		})
		return
	}
	const isRemote = !!originDomiaKey && originDomiaKey !== domia.domiaKey
	const trajectory =
		flags.emotion && !isRemote ? await getRecentTrajectory(domia.id) : []
	const result = await runReflection(
		domia,
		personaContextFromDomia(domia),
		userText,
		replyText,
		trajectory,
		flags,
	)
	await routeReflectionResult(domia, originDomiaKey, result, interactionId)
}
