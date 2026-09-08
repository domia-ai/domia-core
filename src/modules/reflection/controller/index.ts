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
	applyUserEmotionInfluence,
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
	isEphemeralFact,
	isExplicitMemoryCommand,
	getActiveFactRefs,
	type RawFactType,
} from "@/modules/memory"
import { reflectionLogger, parseLlmJson, sleep, withTimeout } from "@/utils"
import { activeVoiceReplies } from "@/modules/voice-admission"
import {
	DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	DEFAULT_REFLECTION_YIELD_TO_VOICE,
	DEFAULT_REFLECTION_TIMEOUT_MS,
	DEFAULT_REFLECTION_IDLE_POLL_MS,
	DEFAULT_REFLECTION_IDLE_GRACE_MS,
	DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS,
	DEFAULT_REFLECTION_SLOT_TIMEOUT_MS,
	DEFAULT_REFLECTION_YIELD_MAX_ATTEMPTS,
} from "@/db"
import { createReflectionGate } from "../utils"
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
	explicitMemory: boolean,
	knownFacts: { subject: string; relation: string; value: string }[] = [],
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
	if (flags.facts && explicitMemory) {
		lines.push(
			`This exchange contains an EXPLICIT memory command from the person (remember/forget). The fact they asked to remember — or the "op":"delete" retraction they asked to forget — MUST appear in "facts", built strictly from THEIR words in THIS exchange. Do not return [] and do not substitute other known facts for it.`,
		)
		if (knownFacts.length)
			lines.push(
				`Currently stored facts about the person:\n${knownFacts.map((f) => `- ${JSON.stringify(f)}`).join("\n")}`,
				`If they asked to FORGET something ("forget my name", "olvida donde vivo"), find the stored fact(s) it refers to above and emit each as {"subject","relation","value","op":"delete"} copying subject, relation and value EXACTLY as stored. Never emit these stored facts as new additions.`,
			)
	}
	return lines.join("\n")
}

const FIRST_PERSON = /\b(i|i'm|i am|i've|i have|my|mine)\b/i
const QUESTION_START =
	/^(what|why|how|when|where|who|which|whose|do|does|did|can|could|would|will|shall|should|is|are|am|was|were|may|might|have|has)\b/i

const isPureQuestion = (text: string): boolean => {
	const t = text.trim()
	const interrogative = t.endsWith("?") || QUESTION_START.test(t)
	return interrogative && !FIRST_PERSON.test(t)
}

const foldText = (s: string): string =>
	s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")

const valueTokens = (s: string): string[] =>
	foldText(s)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 2)

const tokenOverlap = (a: string[], b: string[]): boolean =>
	a.some((w) =>
		b.some((u) =>
			w.length >= 3 && u.length >= 3
				? w.startsWith(u) || u.startsWith(w)
				: w === u,
		),
	)

const filterReflectionFacts = (
	facts: RawFactType[],
	userText: string,
	persona: PersonaContextType,
): RawFactType[] => {
	if (isPureQuestion(userText)) return []
	const user = foldText(userText)
	const userWords = valueTokens(userText)
	const personaName = (persona.characterProfile?.name ?? "domia").toLowerCase()
	const kept = facts.filter((fact) => {
		if (isEphemeralFact(fact.relation, fact.value)) return false
		const subject = fact.subject.toLowerCase()
		if (
			subject.includes(personaName) ||
			subject.includes("domia") ||
			subject.includes("assistant") ||
			subject === "you"
		) {
			return false
		}
		if (fact.op === "delete") return true
		const words = valueTokens(fact.value)
		if (words.length === 0) return false
		return words.some((w) => user.includes(w))
	})
	const deleteGrounded = (fact: RawFactType): boolean =>
		tokenOverlap(valueTokens(`${fact.relation} ${fact.value}`), userWords)
	const deletes = kept.filter((f) => f.op === "delete")
	const grounded = deletes.filter(deleteGrounded)
	if (grounded.length === deletes.length) return kept
	if (grounded.length === 0 && deletes.length > 0)
		reflectionLogger.warn("ungrounded deletes dropped (over-deletion guard)", {
			dropped: deletes.map((f) => `${f.relation} ${f.value}`),
		})
	return kept.filter((f) => f.op !== "delete" || deleteGrounded(f))
}

const gate = createReflectionGate({
	activeVoiceReplies,
	sleep,
	now: Date.now,
	logger: reflectionLogger,
})

const gateSettings = (domia: DomiaType): ReflectionGateSettingsType => ({
	onlyWhenIdle:
		domia.moduleSettings?.reflectionOnlyWhenIdle ??
		DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	concurrency:
		domia.moduleSettings?.reflectionConcurrency ??
		DEFAULT_REFLECTION_CONCURRENCY,
	queueMaxDepth:
		domia.moduleSettings?.reflectionQueueMaxDepth ??
		DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	yieldToVoice:
		domia.moduleSettings?.reflectionYieldToVoice ??
		DEFAULT_REFLECTION_YIELD_TO_VOICE,
	timeoutMs:
		domia.moduleSettings?.reflectionTimeoutMs ?? DEFAULT_REFLECTION_TIMEOUT_MS,
	idlePollMs:
		domia.moduleSettings?.reflectionIdlePollMs ??
		DEFAULT_REFLECTION_IDLE_POLL_MS,
	idleGraceMs:
		domia.moduleSettings?.reflectionIdleGraceMs ??
		DEFAULT_REFLECTION_IDLE_GRACE_MS,
	maxIdleWaitMs:
		domia.moduleSettings?.reflectionMaxIdleWaitMs ??
		DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS,
	slotTimeoutMs:
		domia.moduleSettings?.reflectionSlotTimeoutMs ??
		DEFAULT_REFLECTION_SLOT_TIMEOUT_MS,
	yieldMaxAttempts:
		domia.moduleSettings?.reflectionYieldMaxAttempts ??
		DEFAULT_REFLECTION_YIELD_MAX_ATTEMPTS,
})

export const runReflection = async (
	responder: DomiaType,
	persona: PersonaContextType,
	userText: string,
	replyText: string,
	trajectory: EmotionTrajectoryEntryType[],
	flags: ReflectionFlagsType,
	knownFacts: { subject: string; relation: string; value: string }[] = [],
): Promise<ReflectionResultType> => {
	if (!userText.trim() || !replyText.trim())
		return { emotion: null, userEmotion: null, facts: [] }

	const key = responder.id
	const explicitMemory =
		flags.facts &&
		isExplicitMemoryCommand(userText, responder.characterProfile?.language)
	const reflectionModel = responder.llmModelConfig?.reflectionModelName?.trim()
	if (explicitMemory && reflectionModel)
		reflectionLogger.info(
			"🧠 explicit memory command — reflecting with main model",
			{ responderId: key },
		)
	const reflector =
		reflectionModel && responder.llmModelConfig && !explicitMemory
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
			explicitMemory ? [] : trajectory,
			flags,
			explicitMemory,
			knownFacts,
		)
		for (let attempt = 1; attempt <= settings.yieldMaxAttempts; attempt++) {
			let yielded = false
			const wasYielded = (): boolean => yielded
			const result = await gate.runGated(
				key,
				settings,
				async () => {
					if (settings.onlyWhenIdle && activeVoiceReplies() > 0)
						reflectionLogger.warn(
							"⚠️ reflectionOnlyWhenIdle invariant breach — voice active at reflection start",
							{ responderId: responder.id },
						)
					const deadline = Date.now() + settings.timeoutMs
					const shouldAbort = (): boolean => {
						if (Date.now() > deadline) return true
						if (!settings.yieldToVoice) return false
						const busy = activeVoiceReplies() > 0
						if (busy) yielded = true
						return busy
					}
					const raw = await withTimeout(
						runLLMJson(reflector, prompt, shouldAbort),
						settings.timeoutMs,
						"reflection",
					)
					if (wasYielded()) return empty
					const parsed = parseLlmJson(raw)
					const obj = parsed.value ?? {}
					if (parsed.state === "repaired") {
						const factsTruncated =
							raw.includes('"facts"') &&
							(!Array.isArray(obj.facts) || obj.facts.length === 0)
						reflectionLogger.warn("llm-json repaired", {
							site: "reflection",
							model: reflector.llmModelConfig?.modelName,
							rawLength: raw.length,
							factsTruncated,
							salvaged: {
								emotion: obj.emotion != null,
								userEmotion: obj.userEmotion != null,
								facts: Array.isArray(obj.facts) ? obj.facts.length : 0,
							},
						})
					}
					const emotion: EmotionAppraisalType | null = flags.emotion
						? parseEmotionFromObject(obj.emotion)
						: null
					const userEmotion: UserEmotionType | null = flags.emotion
						? parseUserEmotionFromObject(obj.userEmotion)
						: null
					let facts: RawFactType[] = flags.facts
						? filterReflectionFacts(parseFacts(obj.facts), userText, persona)
						: []
					if (explicitMemory && facts.length === 0)
						reflectionLogger.warn("explicit memory command yielded no facts", {
							parsed: parseFacts(obj.facts).length,
							rawFacts: JSON.stringify(obj.facts ?? null).slice(0, 400),
						})
					const declarationMissed =
						flags.facts &&
						!explicitMemory &&
						!!reflectionModel &&
						facts.length === 0 &&
						FIRST_PERSON.test(userText) &&
						!isPureQuestion(userText)
					if (explicitMemory)
						facts = facts.map((f) => ({ ...f, explicit: true }))
					if (declarationMissed) {
						reflectionLogger.info(
							"🧠 first-person declaration missed by reflector — retrying with main model",
							{ responderId: key },
						)
						const retryPrompt = buildReflectionPrompt(
							persona,
							userText,
							replyText,
							[],
							{ ...flags, emotion: false },
							false,
						)
						const retryRaw = await withTimeout(
							runLLMJson(responder, retryPrompt, shouldAbort),
							settings.timeoutMs,
							"reflection-retry",
						)
						if (!wasYielded()) {
							const retryObj = parseLlmJson(retryRaw).value ?? {}
							facts = filterReflectionFacts(
								parseFacts(retryObj.facts),
								userText,
								persona,
							)
						}
					}
					return { emotion, userEmotion, facts }
				},
				empty,
			)
			if (!wasYielded()) return result
			reflectionLogger.info(
				`⏳ reflection yielded LLM to live voice — requeued (${attempt}/${settings.yieldMaxAttempts})`,
				{ responderId: key },
			)
			await sleep(settings.idlePollMs * 4)
		}
		reflectionLogger.warn(
			"reflection skipped after repeated yields to live voice (best-effort)",
			{ responderId: key },
		)
		return empty
	} catch (err) {
		reflectionLogger.warn("Reflection failed (skipping)", {
			responderId: responder.id,
			err: err instanceof Error ? err.message : String(err),
			stack:
				err instanceof Error ? err.stack?.split("\n")[1]?.trim() : undefined,
		})
		return { emotion: null, userEmotion: null, facts: [] }
	}
}

export const flagsForDomia = (domia: DomiaType): ReflectionFlagsType => ({
	emotion: domia.moduleSettings?.emotionCapture !== false,
	facts: domia.moduleSettings?.factCapture !== false,
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
		if (hasUserEmotion) applyUserEmotionInfluence(executor, userEmotion)
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
			grpcTls: origin.grpcTls,
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
	const knownFacts =
		flags.facts &&
		!isRemote &&
		isExplicitMemoryCommand(userText, domia.characterProfile?.language)
			? await getActiveFactRefs(domia)
			: []
	const result = await runReflection(
		domia,
		personaContextFromDomia(domia),
		userText,
		replyText,
		trajectory,
		flags,
		knownFacts,
	)
	await routeReflectionResult(domia, originDomiaKey, result, interactionId)
}
