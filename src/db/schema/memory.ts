import {
	sqliteTable,
	text,
	real,
	integer,
	unique,
	index,
} from "drizzle-orm/sqlite-core"
import {
	FACT_KIND_ENUM_VALUES,
	DEFAULT_FACT_KIND,
	FACT_SOURCE_KIND_ENUM_VALUES,
	DEFAULT_FACT_SOURCE_KIND,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"
import { domia } from "./identity"

export const emotionState = sqliteTable("emotion_state", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.unique()
		.references(() => domia.id),
	joy: real("joy").notNull().default(0),
	sadness: real("sadness").notNull().default(0),
	anger: real("anger").notNull().default(0),
	fear: real("fear").notNull().default(0),
	trust: real("trust").notNull().default(0),
	disgust: real("disgust").notNull().default(0),
	anticipation: real("anticipation").notNull().default(0),
	surprise: real("surprise").notNull().default(0),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const emotionEvent = sqliteTable(
	"emotion_event",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		cause: text("cause").notNull(),
		delta: text("delta", { mode: "json" }).notNull(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_emotion_event_domia_created").on(t.domiaId, t.createdAt)],
)

export const memoryFact = sqliteTable(
	"memory_fact",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		subject: text("subject").notNull(),
		relation: text("relation").notNull(),
		value: text("value").notNull(),
		valueKey: text("value_key").notNull().default(""),
		confidence: real("confidence").notNull().default(0.7),
		kind: text("kind", { enum: FACT_KIND_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_FACT_KIND),
		sourceKind: text("source_kind", { enum: FACT_SOURCE_KIND_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_FACT_SOURCE_KIND),
		personId: text("person_id"),
		sourceInteractionId: text("source_interaction_id"),
		validFrom: text("valid_from").notNull().default(DEFAULT_TIMESTAMP),
		validUntil: text("valid_until"),
		supersededAt: text("superseded_at"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		unique().on(t.domiaId, t.subject, t.relation, t.valueKey),
		index("idx_memory_fact_domia_updated").on(t.domiaId, t.updatedAt),
		index("idx_memory_fact_domia_created").on(t.domiaId, t.createdAt),
		index("idx_memory_fact_domia_valid").on(t.domiaId, t.validUntil),
	],
)

export const factEvidence = sqliteTable(
	"fact_evidence",
	{
		id: text("id").primaryKey(),
		factId: text("fact_id")
			.notNull()
			.references(() => memoryFact.id, { onDelete: "cascade" }),
		sourceInteractionId: text("source_interaction_id").notNull(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [unique().on(t.factId, t.sourceInteractionId)],
)

export const knowledgeEntry = sqliteTable(
	"knowledge_entry",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		title: text("title").notNull(),
		content: text("content").notNull(),
		keywords: text("keywords", { mode: "json" }).$type<string[]>(),
		priority: integer("priority").notNull().default(0),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_knowledge_domia_active").on(t.domiaId, t.isActive)],
)

export const memoryEpisode = sqliteTable(
	"memory_episode",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		sessionId: text("session_id").notNull(),
		summary: text("summary").notNull(),
		moodArc: text("mood_arc"),
		topics: text("topics", { mode: "json" }).$type<string[]>(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_episode_domia_created").on(t.domiaId, t.createdAt)],
)

export const userModel = sqliteTable("user_model", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.unique()
		.references(() => domia.id),
	summary: text("summary"),
	moodTendencies: text("mood_tendencies"),
	interests: text("interests", { mode: "json" }).$type<string[]>(),
	prefs: text("prefs", { mode: "json" }).$type<string[]>(),
	familiarity: real("familiarity").notNull().default(0),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})
