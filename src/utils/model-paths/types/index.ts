export const QUANTIZATION_VALUES = ["int8", "fp32"] as const

export type QuantizationType = (typeof QUANTIZATION_VALUES)[number]

export type FindOnnxOptionsType = {
	dir: string
	prefix: string
	quantization?: QuantizationType
}
