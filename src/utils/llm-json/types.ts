export type FixJsonStateType =
	| "ROOT"
	| "FINISH"
	| "INSIDE_STRING"
	| "INSIDE_STRING_ESCAPE"
	| "INSIDE_STRING_UNICODE_ESCAPE"
	| "INSIDE_LITERAL"
	| "INSIDE_NUMBER"
	| "INSIDE_OBJECT_START"
	| "INSIDE_OBJECT_KEY"
	| "INSIDE_OBJECT_AFTER_KEY"
	| "INSIDE_OBJECT_BEFORE_VALUE"
	| "INSIDE_OBJECT_AFTER_VALUE"
	| "INSIDE_OBJECT_AFTER_COMMA"
	| "INSIDE_ARRAY_START"
	| "INSIDE_ARRAY_AFTER_VALUE"
	| "INSIDE_ARRAY_AFTER_COMMA"

export type ParseLlmJsonStateType = "parsed" | "repaired" | "failed"

export type ParseLlmJsonResultType<T> = {
	value: T | null
	state: ParseLlmJsonStateType
}
