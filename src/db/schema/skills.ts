import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type {
	SkillAuthType,
	SkillToolType,
	SkillProviderConfigType,
	DomiaSkillDescriptorType,
} from "../json-types"
import {
	CAPABILITY_ENUM_VALUES,
	SKILL_PROTOCOL_ENUM_VALUES,
	MCP_TRANSPORT_ENUM_VALUES,
	SKILL_TRUST_TIER_ENUM_VALUES,
	DEFAULT_SKILL_TRUST_TIER,
	DEFAULT_SKILL_REFRESH_MS,
	TOOL_RUN_STATUS_ENUM,
	TOOL_RUN_STATUS_ENUM_VALUES,
	CONFIRMATION_STATUS_ENUM,
	CONFIRMATION_STATUS_ENUM_VALUES,
	DEFAULT_SKILL_PROTOCOL,
	DEFAULT_MCP_TRANSPORT_TYPE,
	DEFAULT_SKILL_MAX_RESULT_CHARS,
	DEFAULT_SKILL_TIMEOUT_MS,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"
import { domia } from "./identity"

export const skillProvider = sqliteTable("skill_provider", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	protocol: text("protocol", { enum: SKILL_PROTOCOL_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_SKILL_PROTOCOL),
	type: text("type", { enum: MCP_TRANSPORT_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_MCP_TRANSPORT_TYPE),
	url: text("url").notNull(),
	description: text("description"),
	config: text("config", { mode: "json" }).$type<SkillProviderConfigType>(),
	descriptor: text("descriptor", {
		mode: "json",
	}).$type<DomiaSkillDescriptorType>(),
	auth: text("auth", { mode: "json" }).$type<SkillAuthType>(),
	toolsCache: text("tools_cache", { mode: "json" }).$type<SkillToolType[]>(),
	toolWhitelist: text("tool_whitelist", { mode: "json" }).$type<string[]>(),
	lastSyncAt: text("last_sync_at"),
	maxResultChars: integer("max_result_chars")
		.notNull()
		.default(DEFAULT_SKILL_MAX_RESULT_CHARS),
	timeout: integer("timeout_ms").notNull().default(DEFAULT_SKILL_TIMEOUT_MS),
	toolsRefreshMs: integer("tools_refresh_ms")
		.notNull()
		.default(DEFAULT_SKILL_REFRESH_MS),
	priority: integer("priority").notNull().default(0),
	trustTier: text("trust_tier", { enum: SKILL_TRUST_TIER_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_SKILL_TRUST_TIER),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const toolRun = sqliteTable(
	"tool_run",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		interactionId: text("interaction_id").notNull(),
		tool: text("tool").notNull(),
		providerSlug: text("provider_slug"),
		argsHash: text("args_hash").notNull(),
		riskClass: text("risk_class"),
		policyDecision: text("policy_decision"),
		policySource: text("policy_source"),
		confirmationId: text("confirmation_id"),
		status: text("status", { enum: TOOL_RUN_STATUS_ENUM_VALUES })
			.notNull()
			.default(TOOL_RUN_STATUS_ENUM.DISPATCHED),
		durationMs: integer("duration_ms"),
		spokenAt: text("spoken_at"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		settledAt: text("settled_at"),
	},
	(t) => [index("tool_run_interaction_idx").on(t.interactionId, t.status)],
)

export const pendingConfirmationRow = sqliteTable("pending_confirmation", {
	scope: text("scope").primaryKey(),
	domiaKey: text("domia_key").notNull(),
	tool: text("tool").notNull(),
	args: text("args", { mode: "json" })
		.$type<Record<string, unknown>>()
		.notNull(),
	resolvedArgs: text("resolved_args", { mode: "json" }).$type<Record<
		string,
		unknown
	> | null>(),
	summary: text("summary"),
	language: text("language"),
	reasked: integer("reasked", { mode: "boolean" }).notNull().default(false),
	expiresAt: integer("expires_at").notNull(),
	status: text("status", { enum: CONFIRMATION_STATUS_ENUM_VALUES })
		.notNull()
		.default(CONFIRMATION_STATUS_ENUM.PENDING),
	settledAt: text("settled_at"),
	settledBy: text("settled_by"),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const capabilityDelegation = sqliteTable("capability_delegation", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	capability: text("capability", {
		enum: CAPABILITY_ENUM_VALUES,
	}).notNull(),
	delegateToDomiaId: text("delegate_to_domia_id").references(() => domia.id),
	delegateToDomiaKey: text("delegate_to_domia_key").notNull(),
	priority: integer("priority").notNull().default(0),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})
