import {
	getTableColumns,
	getTableName,
	type Column,
	type Table,
} from "drizzle-orm"

import {
	domia,
	characterProfile,
	moduleSettings,
	runtimeCapabilities,
	sttConfig,
	ttsConfig,
	llmModelConfig,
	wakeWordConfig,
	audioPlaybackConfig,
	mqttConfig,
} from "@/db"

import {
	CONFIG_SCHEMA_HIDDEN_COLUMNS,
	CONFIG_SCHEMA_SECRET_FIELDS,
} from "../constants"
import type {
	ConfigSchemaFieldKindType,
	ConfigSchemaFieldType,
	ConfigSchemaSectionType,
	ConfigSchemaType,
} from "../types"

const SECTION_TABLES: { id: string; table: Table }[] = [
	{ id: "domia", table: domia },
	{ id: "character", table: characterProfile },
	{ id: "modules", table: moduleSettings },
	{ id: "capabilities", table: runtimeCapabilities },
	{ id: "stt", table: sttConfig },
	{ id: "tts", table: ttsConfig },
	{ id: "llm", table: llmModelConfig },
	{ id: "wakeWord", table: wakeWordConfig },
	{ id: "playback", table: audioPlaybackConfig },
	{ id: "mqttLocal", table: mqttConfig },
]

const kindOf = (column: Column): ConfigSchemaFieldKindType => {
	if (column.columnType === "SQLiteBoolean") return "boolean"
	if (column.columnType === "SQLiteTextJson") return "json"
	if (column.dataType === "number") return "number"
	if (column.enumValues && column.enumValues.length > 0) return "enum"
	return "string"
}

const defaultOf = (column: Column): unknown =>
	column.hasDefault && typeof column.default !== "function"
		? column.default
		: null

const fieldOf = (
	sectionId: string,
	key: string,
	column: Column,
): ConfigSchemaFieldType => {
	const kind = kindOf(column)
	const secret = CONFIG_SCHEMA_SECRET_FIELDS.has(`${sectionId}.${key}`)
	return {
		key,
		column: column.name,
		type: kind,
		default: secret ? null : defaultOf(column),
		...(kind === "enum" && column.enumValues
			? { enumValues: [...column.enumValues] }
			: {}),
		nullable: !column.notNull,
		secret,
	}
}

const sectionOf = (id: string, table: Table): ConfigSchemaSectionType => {
	const columns = getTableColumns(table) as Record<string, Column>
	return {
		id,
		table: getTableName(table),
		fields: Object.entries(columns)
			.filter(([key]) => !CONFIG_SCHEMA_HIDDEN_COLUMNS.has(key))
			.map(([key, column]) => fieldOf(id, key, column)),
	}
}

let cached: ConfigSchemaType | null = null

export const configSchema = (): ConfigSchemaType => {
	cached ??= {
		scalarSectionsOnly: true,
		sections: SECTION_TABLES.map(({ id, table }) => sectionOf(id, table)),
	}
	return cached
}

export const handleGetConfigSchema = (): ConfigSchemaType => configSchema()
