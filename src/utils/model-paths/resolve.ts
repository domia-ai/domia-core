import fs from "fs"
import path from "path"

import {
	type QuantizationType,
	type FindOnnxOptionsType,
	QUANTIZATION_VALUES,
} from "./types"

export const isQuantization = (value: unknown): value is QuantizationType =>
	typeof value === "string" &&
	(QUANTIZATION_VALUES as readonly string[]).includes(value)

export const resolveQuantization = (
	value: string | null | undefined,
	fallback: QuantizationType = "int8",
): QuantizationType => (isQuantization(value) ? value : fallback)

export const findOnnxFile = (options: FindOnnxOptionsType): string | null => {
	const { dir, prefix, quantization = "int8" } = options
	if (!fs.existsSync(dir)) return null

	const candidates = fs.readdirSync(dir).filter((f) => {
		if (!f.endsWith(".onnx")) return false
		if (!f.startsWith(prefix)) return false
		const rest = f.slice(prefix.length, f.length - ".onnx".length)
		return rest === "" || rest === ".int8" || rest.startsWith("-")
	})

	if (candidates.length === 0) return null

	const int8 = candidates.filter((f) => f.includes(".int8."))
	const nonInt8 = candidates.filter((f) => !f.includes(".int8."))

	const ordered =
		quantization === "int8" ? [...int8, ...nonInt8] : [...nonInt8, ...int8]
	return ordered[0] ? path.join(dir, ordered[0]) : null
}
