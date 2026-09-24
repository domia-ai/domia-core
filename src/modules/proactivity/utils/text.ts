import { capitalizeFirst } from "@/utils/text-tokens"
import { languageSetsFor } from "@/utils"
import type { ScheduleItemType } from "../types"

const renderPlaceholders = (
	template: string,
	params: Record<string, string>,
): string =>
	template.replace(/\{(\w+)\}/g, (whole, key: string) => params[key] ?? whole)

export const renderScheduleText = (
	item: Pick<
		ScheduleItemType,
		"name" | "text" | "templateKey" | "templateParams"
	>,
	language: string | null | undefined,
): string => {
	const phrases = languageSetsFor(language).phrases
	const params: Record<string, string> = {
		name: item.name,
		text: item.text ?? item.name,
		...(item.templateParams ?? {}),
	}
	const inline = item.text?.trim()
	if (inline) return renderPlaceholders(inline, params)
	const key = item.templateKey?.trim()
	const catalog = key ? phrases[key] : undefined
	return capitalizeFirst(
		renderPlaceholders(catalog ?? phrases.proactiveReminder, params),
	)
}

export const idleNudgeText = (language: string | null | undefined): string =>
	languageSetsFor(language).phrases.proactiveIdleNudge
