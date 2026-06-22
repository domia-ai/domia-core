import { type SelectSatelliteConfigType } from "@/db"
import { baseSatelliteConfig } from "../mocks"

export const getSatelliteConfig = (
	overrides: Partial<SelectSatelliteConfigType> = {},
): SelectSatelliteConfigType => {
	return {
		...baseSatelliteConfig(overrides?.domiaId),
		...overrides,
	}
}
