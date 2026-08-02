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
import {
	reflectionLogger,
	createAsyncSemaphore,
	isSemaphoreBusyError,
	parseLlmJson,
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
	REFLECTION_IDLE_GRACE_MS,
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

const reflectionSemaphores = new Map<
	string,
	ReturnType<typeof createAsyncSemaphore>
>()
const pendingByIdentity = new Map<string, number>()

const semaphoreFor = (
	identityId: string,
): ReturnType<typeof createAsyncSemaphore> => {
	const existing = reflectionSemaphores.get(identityId)
	if (existing) return existing
	const fresh = createAsyncSemaphore(
		DEFAULT_REFLECTION_CONCURRENCY,
		DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	)
	reflectionSemaphores.set(identityId, fresh)
	return fresh
}

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
	for (;;) {
		while (activeVoiceReplies() > 0) {
			if (Date.now() >= deadline) return false
			await sleep(REFLECTION_IDLE_POLL_MS)
		}
		// mid-conversation the next turn lands seconds after a reply — only reflect after a real pause
		const graceEnd = Date.now() + REFLECTION_IDLE_GRACE_MS
		let interrupted = false
		while (Date.now() < graceEnd) {
			if (activeVoiceReplies() > 0) {
				interrupted = true
				break
			}
			if (Date.now() >= deadline) return false
			await sleep(REFLECTION_IDLE_POLL_MS)
		}
		if (!interrupted) return true
	}
}

const IDLE_REVALIDATE_MAX_ATTEMPTS = 3

const runGated = async <T>(
	identityId: string,
	settings: ReflectionGateSettingsType,
	fn: () => Promise<T>,
	skipValue: T,
): Promise<T> => {
	const semaphore = semaphoreFor(identityId)
	semaphore.setLimit(settings.concurrency)
	semaphore.setMaxWaiters(settings.queueMaxDepth)
	const pending = pendingByIdentity.get(identityId) ?? 0
	if (pending >= settings.concurrency + settings.queueMaxDepth) {
		reflectionLogger.info("reflection backlog full — skipping (best-effort)", {
			identityId,
			pending,
		})
		return skipValue
	}
	pendingByIdentity.set(identityId, pending + 1)
	try {
		return await runGatedInner(semaphore, settings, fn, skipValue)
	} finally {
		const now = pendingByIdentity.get(identityId) ?? 1
		if (now <= 1) pendingByIdentity.delete(identityId)
		else pendingByIdentity.set(identityId, now - 1)
	}
}

const runGatedInner = async <T>(
	semaphore: ReturnType<typeof createAsyncSemaphore>,
	settings: ReflectionGateSettingsType,
	fn: () => Promise<T>,
	skipValue: T,
): Promise<T> => {
	for (let attempt = 1; attempt <= IDLE_REVALIDATE_MAX_ATTEMPTS; attempt++) {
		const idle = await waitForIdle(settings.onlyWhenIdle)
		if (!idle) {
			reflectionLogger.info(
				"reflection deferred while hub busy — skipping (best-effort)",
			)
			return skipValue
		}
		let release!: () => void
		try {
			release = await semaphore.acquire({
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
			if (settings.onlyWhenIdle && activeVoiceReplies() > 0) continue
			return await fn()
		} finally {
			release()
		}
	}
	reflectionLogger.info(
		"reflection deferred after repeated busy revalidations — skipping (best-effort)",
	)
	return skipValue
}

export const runReflection = async (
	responder: DomiaType,
	persona: PersonaContextType,
	userText: string,
	replyText: string,
	trajectory: EmotionTrajectoryEntryType[],
	flags: ReflectionFlagsType,
	knownFacts: { subject: string; relation: string; value: string }[] = [],
): Promise<ReflectionResultType> => {
	if (!userText?.trim() || !replyText?.trim())
		return { emotion: null, userEmotion: null, facts: [] }

	const key = responder?.id ?? ""
	const explicitMemory =
		flags.facts &&
		isExplicitMemoryCommand(userText, responder?.characterProfile?.language)
	const reflectionModel = responder?.llmModelConfig?.reflectionModelName?.trim()
	if (explicitMemory && reflectionModel)
		reflectionLogger.info(
			"🧠 explicit memory command — reflecting with main model",
			{ responderId: key },
		)
	const reflector =
		reflectionModel && responder?.llmModelConfig && !explicitMemory
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
		for (let attempt = 1; attempt <= REFLECTION_YIELD_MAX_ATTEMPTS; attempt++) {
			let yielded = false
			const result = await runGated(
				key,
				settings,
				async () => {
					if (settings.onlyWhenIdle && activeVoiceReplies() > 0)
						reflectionLogger.warn(
							"⚠️ reflectionOnlyWhenIdle invariant breach — voice active at reflection start",
							{ responderId: responder.id },
						)
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
					const parsed = parseLlmJson(raw)
					const obj = parsed.value ?? {}
					if (parsed.state === "repaired") {
						const factsTruncated =
							raw.includes('"facts"') &&
							(!Array.isArray(obj.facts) || obj.facts.length === 0)
						reflectionLogger.warn("llm-json repaired", {
							site: "reflection",
							model: reflector?.llmModelConfig?.modelName,
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
							rawFacts: JSON.stringify(obj.facts)?.slice(0, 400),
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
							REFLECTION_TIMEOUT_MS,
							"reflection-retry",
						)
						if (!yielded) {
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
			err: err instanceof Error ? `${err.message}` : String(err),
			stack:
				err instanceof Error ? err.stack?.split("\n")[1]?.trim() : undefined,
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
