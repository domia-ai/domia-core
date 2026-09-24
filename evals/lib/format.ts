import { writeFileSync } from "node:fs"

import { format, resolveConfig } from "prettier"

export const writeFormattedJson = async (
	file: string,
	value: unknown,
): Promise<void> => {
	const config = (await resolveConfig(file)) ?? {}
	const text = await format(JSON.stringify(value, null, "\t"), {
		...config,
		filepath: file,
	})
	writeFileSync(file, text)
}
