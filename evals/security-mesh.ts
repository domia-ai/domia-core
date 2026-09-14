import { execFileSync } from "child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { env } from "@/config"
import { MQTT_TYPE_ENUM } from "@/db"
import {
	DEFAULT_KNOWLEDGE_MAX_CHARS,
	DEFAULT_MODEL_INSTALL_ALLOWED_HOSTS,
	DEFAULT_MESH_CONTROL_TOLERANCE_MS,
	DEFAULT_MESH_DROP_WARN_WINDOW_MS,
} from "@/db/constants"
import { MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"
import { MESH_IDENTITY_FIELD_BY_EVENT } from "@/modules/mqtt-event-handler/constants"
import {
	archiveSuffix,
	findUnsafeArchiveEntry,
	findUnsafeArchiveEntryType,
	isAllowedInstallUrl,
	parseArchiveListing,
} from "@/modules/model-manager/utils"
import { postKnowledgeBodySchema } from "@/modules/http-api/schemas"
import {
	createMeshDropWarnThrottle,
	createMeshReplayGuard,
	createMeshSecretRing,
	meshBootId,
	signMeshControlPayload,
	signMeshPayload,
	verifyMeshControlEnvelope,
	verifyMeshSignature,
} from "@/utils/mesh-auth"
import type {
	MeshControlRejectReasonType,
	MeshIdentityFieldType,
} from "@/utils/mesh-auth"

import { makeChecker } from "./lib"

const checker = makeChecker()
const SECRET_A = "mesh-secret-alpha-0123456789"
const SECRET_B = "mesh-secret-bravo-0123456789"

const allowlistChecks = (): void => {
	console.log("\n== S1a model install host allowlist ==")
	const hosts = DEFAULT_MODEL_INSTALL_ALLOWED_HOSTS
	checker.check(
		"allow: huggingface.co resolve URL",
		isAllowedInstallUrl(
			"https://huggingface.co/csukuangfj/x/resolve/main/model.tar.bz2",
			hosts,
		),
	)
	checker.check(
		"allow: github release asset",
		isAllowedInstallUrl(
			"https://github.com/k2-fsa/sherpa-onnx/releases/download/v1/x.tar.bz2",
			hosts,
		),
	)
	checker.check(
		"allow: subdomain of allowed host",
		isAllowedInstallUrl("https://cdn-lfs.hf.co/repos/abc", hosts),
	)
	checker.check(
		"reject: unknown host",
		!isAllowedInstallUrl("https://evil.example.com/model.tar.bz2", hosts),
	)
	checker.check(
		"reject: lookalike suffix host",
		!isAllowedInstallUrl("https://github.com.evil.example/x.tar", hosts),
	)
	checker.check(
		"reject: userinfo trick",
		!isAllowedInstallUrl("https://github.com@evil.example/x.tar", hosts),
	)
	checker.check(
		"reject: file scheme",
		!isAllowedInstallUrl("file:///etc/passwd", hosts),
	)
	checker.check(
		"reject: ftp scheme on allowed host",
		!isAllowedInstallUrl("ftp://github.com/x.tar", hosts),
	)
	checker.check(
		"reject: malformed url",
		!isAllowedInstallUrl("not a url", hosts),
	)
	checker.check(
		"reject: empty allowlist",
		!isAllowedInstallUrl("https://github.com/x.tar", []),
	)
	checker.check(
		"allow: custom host from config",
		isAllowedInstallUrl("http://models.lan:8080/x.tar", ["models.lan"]),
	)
}

const buildFixtureTar = (dir: string, entries: string[]): string => {
	const inner = join(dir, "inner")
	mkdirSync(inner, { recursive: true })
	writeFileSync(join(inner, "ok.txt"), "ok")
	writeFileSync(join(dir, "escape.txt"), "escape")
	const archive = join(dir, "fixture.tar")
	execFileSync("tar", ["-cPf", archive, ...entries], { cwd: inner })
	return archive
}

const listTar = (archive: string): string[] =>
	parseArchiveListing(execFileSync("tar", ["-tf", archive]).toString())

const tarGuardChecks = (): void => {
	console.log("\n== S1b tar listing guard ==")
	const dir = mkdtempSync(join(tmpdir(), "domia-security-mesh-"))
	try {
		const safe = buildFixtureTar(join(dir, "safe"), ["ok.txt"])
		const traversal = buildFixtureTar(join(dir, "traversal"), [
			"ok.txt",
			"../escape.txt",
		])
		const safeEntries = listTar(safe)
		const traversalEntries = listTar(traversal)
		checker.check(
			"fixture: safe tar lists ok.txt",
			safeEntries.includes("ok.txt"),
			safeEntries.join(","),
		)
		checker.check(
			"fixture: traversal tar keeps ../ entry",
			traversalEntries.some((e) => e.includes("..")),
			traversalEntries.join(","),
		)
		checker.check(
			"guard: safe tar passes",
			findUnsafeArchiveEntry(safeEntries) === null,
		)
		checker.check(
			"guard: ../ entry rejected",
			findUnsafeArchiveEntry(traversalEntries) === "../escape.txt",
			String(findUnsafeArchiveEntry(traversalEntries)),
		)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
	checker.check(
		"guard: absolute path rejected",
		findUnsafeArchiveEntry(["model/a.onnx", "/etc/passwd"]) === "/etc/passwd",
	)
	checker.check(
		"guard: nested ../ rejected",
		findUnsafeArchiveEntry(["model/../../x"]) === "model/../../x",
	)
	checker.check(
		"guard: windows drive rejected",
		findUnsafeArchiveEntry(["C:\\Windows\\x"]) === "C:\\Windows\\x",
	)
	checker.check(
		"guard: dotted names allowed",
		findUnsafeArchiveEntry(["model/..hidden", "model/a..b/c", "./x"]) === null,
	)
	checker.check(
		"guard: blank listing lines ignored",
		findUnsafeArchiveEntry(parseArchiveListing("a/b\n\n  \nc\n")) === null,
	)
}

const hmacChecks = (): void => {
	console.log("\n== S2 heartbeat HMAC ==")
	const payload: Record<string, unknown> = {
		domiaKey: "DOMIA_X",
		id: "id-1",
		localIp: "192.168.1.10",
		grpcPort: 5052,
		runtimeCapabilities: { stt: true, llm: false },
		nested: { z: 1, a: [1, { b: 2 }] },
	}
	const signature = signMeshPayload(payload, SECRET_A)
	checker.check(
		"sign: hex sha256 digest",
		/^[0-9a-f]{64}$/.test(signature),
		signature,
	)
	checker.check(
		"verify: round trip",
		verifyMeshSignature(payload, signature, SECRET_A),
	)
	const wire = JSON.parse(JSON.stringify({ ...payload, signature })) as Record<
		string,
		unknown
	>
	const { signature: wireSig, ...unsigned } = wire
	checker.check(
		"verify: survives JSON wire round trip",
		verifyMeshSignature(unsigned, wireSig, SECRET_A),
	)
	const reordered: Record<string, unknown> = {
		nested: { a: [1, { b: 2 }], z: 1 },
		runtimeCapabilities: { llm: false, stt: true },
		grpcPort: 5052,
		localIp: "192.168.1.10",
		id: "id-1",
		domiaKey: "DOMIA_X",
	}
	checker.check(
		"verify: key order independent",
		verifyMeshSignature(reordered, signature, SECRET_A),
	)
	checker.check(
		"reject: tampered localIp",
		!verifyMeshSignature(
			{ ...payload, localIp: "10.0.0.66" },
			signature,
			SECRET_A,
		),
	)
	checker.check(
		"reject: tampered grpcPort",
		!verifyMeshSignature({ ...payload, grpcPort: 1 }, signature, SECRET_A),
	)
	checker.check(
		"reject: wrong secret",
		!verifyMeshSignature(payload, signature, SECRET_B),
	)
	checker.check(
		"reject: missing signature",
		!verifyMeshSignature(payload, undefined, SECRET_A),
	)
	checker.check(
		"reject: non-string signature",
		!verifyMeshSignature(payload, 12345, SECRET_A),
	)
	checker.check(
		"reject: truncated signature",
		!verifyMeshSignature(payload, signature.slice(0, 40), SECRET_A),
	)
}

const knowledgeChecks = (): void => {
	console.log("\n== S7 knowledge body guard ==")
	const schema = postKnowledgeBodySchema(DEFAULT_KNOWLEDGE_MAX_CHARS)
	const ok = schema.safeParse({
		title: "House rules",
		content: "x".repeat(DEFAULT_KNOWLEDGE_MAX_CHARS),
		keywords: ["rules"],
		priority: 1,
	})
	checker.check("accept: content at limit", ok.success)
	checker.check(
		"reject: content over limit",
		!schema.safeParse({
			title: "t",
			content: "x".repeat(DEFAULT_KNOWLEDGE_MAX_CHARS + 1),
		}).success,
	)
	checker.check(
		"reject: missing title",
		!schema.safeParse({ content: "body" }).success,
	)
	checker.check(
		"reject: whitespace-only content",
		!schema.safeParse({ title: "t", content: "   " }).success,
	)
	checker.check(
		"reject: non-string keywords",
		!schema.safeParse({ title: "t", content: "c", keywords: [1] }).success,
	)
	checker.check("reject: non-object body", !schema.safeParse("hello").success)
	checker.check(
		"knob: smaller limit enforced",
		!postKnowledgeBodySchema(5).safeParse({ title: "t", content: "123456" })
			.success &&
			postKnowledgeBodySchema(5).safeParse({ title: "t", content: "12345" })
				.success,
	)
}

const rotationChecks = (): void => {
	console.log("\n== H3 mesh secret rotation ==")
	let clock = 1_000_000
	const now = (): number => clock
	const graceMs = 60_000
	const payload: Record<string, unknown> = { domiaKey: "DOMIA_R", grpcPort: 1 }

	const steady = createMeshSecretRing({ current: SECRET_A, graceMs, now })
	checker.check(
		"steady: signs with current",
		steady.signingSecret() === SECRET_A,
	)
	checker.check("steady: accepts current", steady.accepts(SECRET_A))
	checker.check("steady: rejects other", !steady.accepts(SECRET_B))
	checker.check(
		"steady: posture not rotating",
		!steady.posture().rotating &&
			steady.posture().accepted.join(",") === "current" &&
			steady.posture().fingerprints.next === null,
	)

	const ring = createMeshSecretRing({
		current: SECRET_A,
		next: SECRET_B,
		graceMs,
		now,
	})
	checker.check("rotating: signs with next", ring.signingSecret() === SECRET_B)
	checker.check(
		"rotating: posture reports both accepted in window",
		ring.posture().rotating &&
			ring.posture().signingWith === "next" &&
			ring.posture().accepted.join(",") === "next,current" &&
			ring.posture().graceEndsAt !== null,
	)
	checker.check("window: old secret accepted", ring.accepts(SECRET_A))
	checker.check("window: new secret accepted", ring.accepts(SECRET_B))
	checker.check("window: unrelated rejected", !ring.accepts("nope-nope-nope"))
	checker.check(
		"grace mutation: retiring secret cannot restart the grace",
		!ring.isSigningSecret(SECRET_A),
	)
	checker.check(
		"grace mutation: only the signing secret can restart the grace",
		ring.isSigningSecret(SECRET_B),
	)
	checker.check(
		"grace mutation: unrelated secret cannot restart the grace",
		!ring.isSigningSecret("nope-nope-nope") && !ring.isSigningSecret(undefined),
	)
	const oldSig = signMeshPayload(payload, SECRET_A)
	const newSig = signMeshPayload(payload, SECRET_B)
	checker.check(
		"window: heartbeat signed with old secret verifies against ring",
		ring.acceptedSecrets().some((s) => verifyMeshSignature(payload, oldSig, s)),
	)
	clock += graceMs - 1
	checker.check(
		"window edge: old still accepted at t+grace-1",
		ring.accepts(SECRET_A),
	)
	clock += 1
	checker.check("after window: old secret rejected", !ring.accepts(SECRET_A))
	checker.check("after window: new secret accepted", ring.accepts(SECRET_B))
	checker.check(
		"after window: posture accepts next only",
		ring.posture().accepted.join(",") === "next" &&
			ring.posture().graceEndsAt === null,
	)
	checker.check(
		"after window: old-signed heartbeat rejected",
		!ring
			.acceptedSecrets()
			.some((s) => verifyMeshSignature(payload, oldSig, s)),
	)
	checker.check(
		"after window: new-signed heartbeat verifies",
		ring.acceptedSecrets().some((s) => verifyMeshSignature(payload, newSig, s)),
	)
	ring.restartGrace()
	checker.check("restart-grace: old accepted again", ring.accepts(SECRET_A))
	ring.endGrace()
	checker.check("end-grace: old rejected immediately", !ring.accepts(SECRET_A))
	ring.restartGrace()
	ring.setGraceMs(10)
	clock += 11
	checker.check("setGraceMs: shorter window honoured", !ring.accepts(SECRET_A))
	checker.check(
		"fingerprints: 12 hex chars, never the secret",
		/^[0-9a-f]{12}$/.test(ring.posture().fingerprints.current ?? "") &&
			!JSON.stringify(ring.posture()).includes(SECRET_A) &&
			!JSON.stringify(ring.posture()).includes(SECRET_B),
	)
	const same = createMeshSecretRing({
		current: SECRET_A,
		next: SECRET_A,
		graceMs,
		now,
	})
	checker.check("next equal to current: not rotating", !same.posture().rotating)
}

const NOW = 1_700_000_000_000
const TOLERANCE_MS = 90_000
const NODE_A = "node-aaaa-1111"
const BOOT_1 = "boot-1111"
const BOOT_2 = "boot-2222"

const envelope = (
	body: Record<string, unknown>,
	bootId: string,
	sequence: number,
	issuedAt: number = NOW,
	secret: string = SECRET_A,
): Record<string, unknown> => {
	const unsigned = { ...body, issuedAt, bootId, sequence }
	return { ...unsigned, signature: signMeshPayload(unsigned, secret) }
}

const controlEnvelopeChecks = (): void => {
	console.log("\n== F3/F4 signed mesh control envelope ==")
	const guard = createMeshReplayGuard()
	const verify = (
		payload: Record<string, unknown> | null,
		topicIdentity: string,
		identityField: MeshIdentityFieldType,
		options: { isLastWill?: boolean; now?: number } = {},
	): MeshControlRejectReasonType | null =>
		verifyMeshControlEnvelope({
			payload,
			topicIdentity,
			identityField,
			toleranceMs: TOLERANCE_MS,
			guard,
			secret: SECRET_A,
			now: options.now ?? NOW,
			isLastWill: options.isLastWill,
		}).reason

	const heartbeat = (sequence: number, bootId = BOOT_1, issuedAt = NOW) =>
		envelope(
			{ domiaKey: "DOMIA_X", nodeId: NODE_A, localIp: "192.168.1.10" },
			bootId,
			sequence,
			issuedAt,
		)

	checker.check(
		"accept: signed heartbeat, topic matches payload",
		verify(heartbeat(1), "DOMIA_X", "domiaKey") === null,
	)
	checker.check(
		"reject: replayed heartbeat (same sequence)",
		verify(heartbeat(1), "DOMIA_X", "domiaKey") === "replayed",
	)
	checker.check(
		"reject: heartbeat with lower sequence",
		verify(heartbeat(0), "DOMIA_X", "domiaKey") === "replayed",
	)
	checker.check(
		"accept: heartbeat with higher sequence",
		verify(heartbeat(2), "DOMIA_X", "domiaKey") === null,
	)
	checker.check(
		"reject: stale issuedAt beyond tolerance",
		verify(
			heartbeat(3, BOOT_1, NOW - TOLERANCE_MS - 1),
			"DOMIA_X",
			"domiaKey",
		) === "stale",
	)
	checker.check(
		"reject: issuedAt too far in the future",
		verify(
			heartbeat(4, BOOT_1, NOW + TOLERANCE_MS + 1),
			"DOMIA_X",
			"domiaKey",
		) === "stale",
	)
	checker.check(
		"accept: issuedAt at the tolerance edge",
		verify(heartbeat(5, BOOT_1, NOW - TOLERANCE_MS), "DOMIA_X", "domiaKey") ===
			null,
	)
	checker.check(
		"reject: tampered signed heartbeat",
		verify({ ...heartbeat(6), localIp: "10.0.0.66" }, "DOMIA_X", "domiaKey") ===
			"bad-signature",
	)
	checker.check(
		"reject: topic/payload domiaKey mismatch",
		verify(heartbeat(7), "DOMIA_EVIL", "domiaKey") === "identity-mismatch",
	)
	checker.check(
		"reject: legacy unsigned heartbeat without envelope",
		verify({ domiaKey: "DOMIA_X", nodeId: NODE_A }, "DOMIA_X", "domiaKey") ===
			"malformed",
	)
	checker.check(
		"reject: non-object payload",
		verify(null, "DOMIA_X", "domiaKey") === "malformed",
	)

	checker.check(
		"accept: new bootId resets the sequence",
		guard.lastSeen(NODE_A)?.sequence === 5 &&
			verify(heartbeat(1, BOOT_2), "DOMIA_X", "domiaKey") === null,
		String(guard.lastSeen(NODE_A)?.sequence),
	)
	checker.check(
		"reject: replay within the new boot",
		verify(heartbeat(1, BOOT_2), "DOMIA_X", "domiaKey") === "replayed",
	)

	const configChanged = (sequence: number, bootId = BOOT_2) =>
		envelope({ domiaKey: "DOMIA_X" }, bootId, sequence)
	checker.check(
		"reject: unsigned config_changed",
		verify({ domiaKey: "DOMIA_X" }, "DOMIA_X", "domiaKey") === "malformed",
	)
	checker.check(
		"reject: enveloped config_changed without signature",
		verify(
			{ domiaKey: "DOMIA_X", issuedAt: NOW, bootId: BOOT_2, sequence: 40 },
			"DOMIA_X",
			"domiaKey",
		) === "unsigned",
	)
	checker.check(
		"accept: signed config_changed",
		verify(configChanged(41), "DOMIA_X", "domiaKey") === null,
	)
	checker.check(
		"reject: replayed config_changed",
		verify(configChanged(41), "DOMIA_X", "domiaKey") === "replayed",
	)
	checker.check(
		"reject: config_changed signed with the wrong secret",
		verifyMeshControlEnvelope({
			payload: envelope({ domiaKey: "DOMIA_X" }, BOOT_2, 42, NOW, SECRET_B),
			topicIdentity: "DOMIA_X",
			identityField: "domiaKey",
			toleranceMs: TOLERANCE_MS,
			guard,
			secret: SECRET_A,
			now: NOW,
		}).reason === "bad-signature",
	)

	const speaking = (sequence: number, bootId = BOOT_2) =>
		envelope(
			{ nodeId: NODE_A, domiaKey: "DOMIA_X", speaking: true },
			bootId,
			sequence,
		)
	checker.check(
		"reject: unsigned speaking",
		verify(
			{ nodeId: NODE_A, domiaKey: "DOMIA_X", speaking: true },
			NODE_A,
			"nodeId",
		) === "malformed",
	)
	checker.check(
		"accept: signed speaking",
		verify(speaking(50), NODE_A, "nodeId") === null,
	)
	checker.check(
		"reject: replayed speaking",
		verify(speaking(50), NODE_A, "nodeId") === "replayed",
	)
	checker.check(
		"reject: speaking on a foreign nodeId topic",
		verify(speaking(51), "node-other", "nodeId") === "identity-mismatch",
	)

	const offline = (sequence: number, bootId: string) =>
		envelope({ nodeId: NODE_A }, bootId, sequence)
	checker.check(
		"reject: unsigned offline",
		verify({ nodeId: NODE_A }, NODE_A, "nodeId", { isLastWill: true }) ===
			"malformed",
	)
	checker.check(
		"accept: LWT offline when bootId matches the last seen boot",
		verify(offline(1, BOOT_2), NODE_A, "nodeId", { isLastWill: true }) === null,
	)
	checker.check(
		"accept: LWT offline delivered long after it was prepared",
		verify(offline(1, BOOT_2), NODE_A, "nodeId", {
			isLastWill: true,
			now: NOW + 86_400_000,
		}) === null,
	)
	checker.check(
		"reject: LWT offline with an unknown bootId",
		verify(offline(1, "boot-forged"), NODE_A, "nodeId", {
			isLastWill: true,
		}) === "unknown-boot",
	)
	checker.check(
		"LWT does not advance the replay guard",
		guard.lastSeen(NODE_A)?.sequence === 50,
		String(guard.lastSeen(NODE_A)?.sequence),
	)
	const freshGuard = createMeshReplayGuard()
	checker.check(
		"reject: LWT offline for a node never heard from",
		verifyMeshControlEnvelope({
			payload: offline(1, BOOT_2),
			topicIdentity: NODE_A,
			identityField: "nodeId",
			toleranceMs: TOLERANCE_MS,
			guard: freshGuard,
			secret: SECRET_A,
			now: NOW,
			isLastWill: true,
		}).reason === "unknown-boot",
	)
	guard.forget(NODE_A)
	checker.check(
		"reject: LWT offline replayed after the node was marked offline",
		verify(offline(1, BOOT_2), NODE_A, "nodeId", { isLastWill: true }) ===
			"unknown-boot",
	)

	const first = signMeshControlPayload({ domiaKey: "DOMIA_X" })
	const second = signMeshControlPayload({ domiaKey: "DOMIA_X" })
	checker.check(
		"publisher: envelope carries issuedAt, bootId, sequence, signature",
		typeof first.issuedAt === "number" &&
			first.bootId === meshBootId() &&
			typeof first.sequence === "number" &&
			/^[0-9a-f]{64}$/.test(first.signature),
	)
	checker.check(
		"publisher: sequence is strictly increasing per process",
		second.sequence === first.sequence + 1,
	)
	checker.check(
		"publisher: signature covers the envelope fields",
		verifyMeshSignature(
			{
				domiaKey: "DOMIA_X",
				issuedAt: first.issuedAt,
				bootId: first.bootId,
				sequence: first.sequence,
			},
			first.signature,
		) &&
			!verifyMeshSignature(
				{
					domiaKey: "DOMIA_X",
					issuedAt: first.issuedAt,
					bootId: first.bootId,
					sequence: first.sequence + 1,
				},
				first.signature,
			),
	)
}

const topicWiringChecks = (): void => {
	console.log("\n== F3 topic ↔ payload wiring ==")
	const guard = createMeshReplayGuard()
	const root = env.MQTT_TOPIC_ROOT
	const domiaKey = "DOMIA_WIRE"
	const nodeId = "node-wire-9999"
	const topicFor = (event: MQTT_EVENT_ENUM, identity: string): string =>
		`${root}/${identity}/${MQTT_TYPE_ENUM.LOCAL}/${event}`

	const verifyTopic = (
		topic: string,
		payload: Record<string, unknown>,
	): MeshControlRejectReasonType | null => {
		const [, topicIdentity, , eventName] = topic.split("/")
		const event = eventName as MQTT_EVENT_ENUM
		return verifyMeshControlEnvelope({
			payload,
			topicIdentity,
			identityField: MESH_IDENTITY_FIELD_BY_EVENT[event],
			toleranceMs: DEFAULT_MESH_CONTROL_TOLERANCE_MS,
			guard,
			isLastWill: event === MQTT_EVENT_ENUM.OFFLINE,
		}).reason
	}

	const heartbeatTopic = topicFor(MQTT_EVENT_ENUM.HEARTBEAT, domiaKey)
	const willTopic = topicFor(MQTT_EVENT_ENUM.OFFLINE, nodeId)
	checker.check(
		"wiring: heartbeat topic carries the domiaKey segment",
		verifyTopic(
			heartbeatTopic,
			signMeshControlPayload({ domiaKey, nodeId, localIp: "192.168.1.11" }),
		) === null,
		heartbeatTopic,
	)
	checker.check(
		"wiring: config_changed topic carries the domiaKey segment",
		verifyTopic(
			topicFor(MQTT_EVENT_ENUM.CONFIG_CHANGED, domiaKey),
			signMeshControlPayload({ domiaKey }),
		) === null,
	)
	checker.check(
		"wiring: speaking topic carries the nodeId segment",
		verifyTopic(
			topicFor(MQTT_EVENT_ENUM.SPEAKING, nodeId),
			signMeshControlPayload({ nodeId, domiaKey, speaking: true }),
		) === null,
	)
	checker.check(
		"wiring: LWT prepared at connect verifies on the offline topic",
		verifyTopic(willTopic, signMeshControlPayload({ nodeId })) === null,
		willTopic,
	)
	checker.check(
		"wiring: heartbeat replayed on a foreign topic is dropped",
		verifyTopic(
			topicFor(MQTT_EVENT_ENUM.HEARTBEAT, "DOMIA_EVIL"),
			signMeshControlPayload({ domiaKey, nodeId }),
		) === "identity-mismatch",
	)
	checker.check(
		"wiring: unsigned publish on every mesh topic is dropped",
		[
			[heartbeatTopic, { domiaKey, nodeId }],
			[topicFor(MQTT_EVENT_ENUM.CONFIG_CHANGED, domiaKey), { domiaKey }],
			[
				topicFor(MQTT_EVENT_ENUM.SPEAKING, nodeId),
				{ nodeId, domiaKey, speaking: true },
			],
			[willTopic, { nodeId }],
		].every(
			([topic, body]) =>
				verifyTopic(topic as string, body as Record<string, unknown>) !== null,
		),
	)
}

const dropWarnThrottleChecks = (): void => {
	console.log("\n== F4 drop-warn flood suppression ==")
	const windowMs = DEFAULT_MESH_DROP_WARN_WINDOW_MS
	const throttle = createMeshDropWarnThrottle({ windowMs })
	const burst = 31_043
	const label = "heartbeat from DOMIA_A"

	let emitted = 0
	let inlineSummaries = 0
	for (let i = 0; i < burst; i += 1) {
		const decision = throttle.record({
			identity: NODE_A,
			reason: "replayed",
			label,
			now: NOW,
		})
		if (decision.emit) emitted += 1
		if (decision.summary) inlineSummaries += 1
	}
	checker.check(
		"burst: only the first drop warns immediately",
		emitted === 1 && inlineSummaries === 0,
		`emitted=${emitted}`,
	)
	checker.check(
		"burst: nothing is due before the window closes",
		throttle.sweep(NOW + windowMs - 1).length === 0,
	)
	const due = throttle.sweep(NOW + windowMs)
	checker.check(
		"burst: one summary carries the suppressed count",
		due.length === 1 &&
			due[0].suppressed === burst - 1 &&
			due[0].reason === "replayed" &&
			due[0].identity === NODE_A &&
			due[0].label === label &&
			due[0].windowMs === windowMs,
		`summaries=${due.length} suppressed=${due[0]?.suppressed}`,
	)
	checker.check(
		"burst: the flushed slot is evicted",
		throttle.size() === 0,
		String(throttle.size()),
	)
	checker.check(
		"after the window: a new burst warns again",
		throttle.record({
			identity: NODE_A,
			reason: "replayed",
			label,
			now: NOW + windowMs,
		}).emit,
	)

	const separate = createMeshDropWarnThrottle({ windowMs })
	const feed = (
		identity: string,
		reason: MeshControlRejectReasonType,
	): void => {
		for (let i = 0; i < 5; i += 1)
			separate.record({ identity, reason, label, now: NOW })
	}
	feed(NODE_A, "replayed")
	feed(NODE_A, "bad-signature")
	feed("node-bbbb-2222", "replayed")
	checker.check(
		"separate slots per (identity, reason)",
		separate.size() === 3,
		String(separate.size()),
	)
	const mixed = separate.sweep(NOW + windowMs)
	checker.check(
		"each (identity, reason) gets its own summary",
		mixed.length === 3 && mixed.every((s) => s.suppressed === 4),
		mixed.map((s) => `${s.identity}/${s.reason}=${s.suppressed}`).join(" "),
	)

	const lonely = createMeshDropWarnThrottle({ windowMs })
	lonely.record({ identity: NODE_A, reason: "stale", label, now: NOW })
	checker.check(
		"single drop leaves no summary but is still evicted",
		lonely.sweep(NOW + windowMs).length === 0 && lonely.size() === 0,
	)

	const rolling = createMeshDropWarnThrottle({ windowMs })
	rolling.record({ identity: NODE_A, reason: "replayed", label, now: NOW })
	rolling.record({ identity: NODE_A, reason: "replayed", label, now: NOW })
	const late = rolling.record({
		identity: NODE_A,
		reason: "replayed",
		label,
		now: NOW + windowMs,
	})
	checker.check(
		"a drop after the window flushes the pending summary inline",
		late.emit && late.summary?.suppressed === 1,
		String(late.summary?.suppressed),
	)
}

const listTarVerbose = (archive: string): string[] =>
	parseArchiveListing(execFileSync("tar", ["-tvf", archive]).toString())

const archiveEntryTypeChecks = (): void => {
	console.log("\n== S1c tar entry-type guard ==")
	const dir = mkdtempSync(join(tmpdir(), "domia-archive-types-"))
	try {
		const inner = join(dir, "inner")
		mkdirSync(join(inner, "model"), { recursive: true })
		writeFileSync(join(inner, "model", "weights.onnx"), "weights")
		const plain = join(dir, "plain.tar")
		execFileSync("tar", ["-cf", plain, "model"], { cwd: inner })
		checker.check(
			"entry-type guard: plain file + dir archive passes",
			findUnsafeArchiveEntryType(listTarVerbose(plain)) === null,
			listTarVerbose(plain).join(" | "),
		)

		symlinkSync("/etc/passwd", join(inner, "model", "leak"))
		const symlinked = join(dir, "symlink.tar")
		execFileSync("tar", ["-cf", symlinked, "model"], { cwd: inner })
		checker.check(
			"entry-type guard: symlink entry rejected",
			findUnsafeArchiveEntryType(listTarVerbose(symlinked)) !== null,
			listTarVerbose(symlinked).join(" | "),
		)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
	checker.check(
		"entry-type guard: device entry rejected",
		findUnsafeArchiveEntryType([
			"crw-rw-rw- 0 root wheel 1,3 Jan 1 00:00 dev/null",
		]) !== null,
	)
	checker.check(
		"entry-type guard: hardlink entry rejected",
		findUnsafeArchiveEntryType([
			"hrw-r--r-- root/root 0 2020-01-01 00:00 model/b link to model/a",
		]) !== null,
	)
	checker.check(
		"archive suffix: compression extension preserved for staging",
		archiveSuffix("https://host/x/sherpa-onnx-whisper-tiny.en.tar.bz2") ===
			".tar.bz2" && archiveSuffix("https://host/x/model.bin") === ".tar",
	)
}

const main = (): void => {
	console.log("=== security-mesh (chapter 0 §3.9 smalls + H3 rotation) ===")
	allowlistChecks()
	tarGuardChecks()
	archiveEntryTypeChecks()
	hmacChecks()
	knowledgeChecks()
	rotationChecks()
	controlEnvelopeChecks()
	topicWiringChecks()
	dropWarnThrottleChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

main()
