import { type DomiaType } from "@/modules/core"
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
} from "@/db"
import {
	REFLECTION_TIMEOUT_MS,
	REFLECTION_IDLE_POLL_MS,
	REFLECTION_MAX_IDLE_WAIT_MS,
	REFLECTION_SLOT_TIMEOUT_MS,
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

const inFlight = new Set<string>()

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
	if (inFlight.has(key)) {
		reflectionLogger.info("Reflection already running for domia — skipping", {
			responderId: key,
		})
		return { emotion: null, userEmotion: null, facts: [] }
	}
	inFlight.add(key)
	try {
		const empty: ReflectionResultType = {
			emotion: null,
			userEmotion: null,
			facts: [],
		}
		return await runGated(
			gateSettings(responder),
			async () => {
				const raw = await withTimeout(
					runLLMJson(
						responder,
						buildReflectionPrompt(
							persona,
							userText,
							replyText,
							trajectory,
							flags,
						),
					),
					REFLECTION_TIMEOUT_MS,
					"reflection",
				)
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
	} catch (err) {
		reflectionLogger.warn("Reflection failed (skipping)", {
			responderId: responder?.id,
			err,
		})
		return { emotion: null, userEmotion: null, facts: [] }
	} finally {
		inFlight.delete(key)
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

export const reflectOnInteraction = async (
	domia: DomiaType,
	userText: string,
	replyText: string,
	interactionId?: string,
): Promise<void> => {
	const flags = flagsForDomia(domia)
	if (!flags.emotion && !flags.facts) return
	const trajectory = flags.emotion ? await getRecentTrajectory(domia.id) : []
	const { emotion, userEmotion, facts } = await runReflection(
		domia,
		personaContextFromDomia(domia),
		userText,
		replyText,
		trajectory,
		flags,
	)
	if (flags.emotion && emotion)
		applyMoodDelta(domia, emotion.delta, emotion.cause)
	if (flags.emotion && userEmotion && interactionId)
		void updateInteraction({
			id: interactionId,
			userEmotionSnapshot: userEmotion,
		})
	if (flags.facts && facts.length)
		await upsertFacts(domia, facts, interactionId)
}
