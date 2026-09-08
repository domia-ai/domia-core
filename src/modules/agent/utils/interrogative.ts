const stripLead = (text: string): string =>
	text
		.trim()
		.toLowerCase()
		.replace(/^[¿¡"'(\s]+/, "")

const firstWordOf = (text: string): string =>
	stripLead(text).split(/[\s,.;:!?]+/)[0] ?? ""

const startsWithRequestModal = (
	text: string,
	requestModals: Set<string>,
): boolean => {
	const lead = stripLead(text)
	for (const modal of requestModals) {
		if (lead === modal) return true
		if (lead.startsWith(`${modal} `)) return true
	}
	return false
}

export const isInterrogative = (
	text: string,
	questionStarters: Set<string>,
	requestModals: Set<string>,
): boolean => {
	const trimmed = text.trim()
	if (trimmed.length === 0) return false
	if (startsWithRequestModal(trimmed, requestModals)) return false
	if (trimmed.endsWith("?")) return true
	return questionStarters.has(firstWordOf(trimmed))
}
