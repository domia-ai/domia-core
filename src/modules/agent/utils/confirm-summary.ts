import { SKILL_TOOL_NAME_SEPARATOR } from "@/db"

const humanize = (raw: string): string =>
	raw
		.replace(/[_-]+/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.trim()
		.toLowerCase()

const CONFIRM_SUMMARY_MAX_ARGS = 4

export const summarizeConfirmAction = (
	toolName: string,
	args: Record<string, unknown>,
): string => {
	const sep = toolName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const bare =
		sep > 0 ? toolName.slice(sep + SKILL_TOOL_NAME_SEPARATOR.length) : toolName
	const action = humanize(bare)
	const details = Object.entries(args)
		.filter(
			([, v]) =>
				v !== null &&
				v !== undefined &&
				(typeof v !== "string" || v.trim().length > 0),
		)
		.slice(0, CONFIRM_SUMMARY_MAX_ARGS)
		.map(([k, v]) => `${humanize(k)} ${String(v)}`)
	const suffix = details.length ? ` (${details.join(", ")})` : ""
	return `You want me to ${action}${suffix}.`
}
