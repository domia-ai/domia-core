export const createProfileSegment = (
	value: string | null | undefined,
	text: string,
) => ({
	condition: !!value,
	text: value ? text.replace("{value}", value.toLowerCase()) : "",
})
