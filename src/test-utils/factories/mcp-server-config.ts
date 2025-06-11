import { type SelectMcpServerConfigType } from "@/db"
import { baseMcpServerConfig } from "../mocks"

export const getMcpServerConfig = (
	overrides: Partial<SelectMcpServerConfigType> = {},
): SelectMcpServerConfigType => {
	return {
		...baseMcpServerConfig(overrides?.domiaId),
		...overrides,
	}
}
