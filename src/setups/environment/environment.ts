import { execSync } from "child_process"
import { mkdirSync } from "fs"
import { join } from "path"
import { appLogger } from "@/utils"
import type { CapabilityKeyType, PartialRuntimeCapabilitiesType } from "./types"
import { RUNTIME_CAPABILITIES, CAPABILITY_RESOURCES } from "./contants"

export const setupEnvironment = (
	runtimeCapabilities: PartialRuntimeCapabilitiesType = RUNTIME_CAPABILITIES,
): { ok: boolean; missingBinaries: string[] } => {
	appLogger.info("🌱 Setting up environment...")
	const binariesToCheck: { name: string; command: string }[] = []
	const tempDirsToEnsure = new Set<string>()

	for (const capability of Object.keys(
		runtimeCapabilities,
	) as CapabilityKeyType[]) {
		if (!runtimeCapabilities?.[capability]) continue

		const resources = CAPABILITY_RESOURCES?.[capability]
		if (!resources) continue

		resources?.binaries?.forEach((bin) => binariesToCheck.push(bin))
		resources?.tempDirs?.forEach((dir) => tempDirsToEnsure.add(dir))
	}

	const missingBinaries: string[] = []

	for (const bin of binariesToCheck) {
		try {
			execSync(bin.command, { stdio: "ignore" })
			appLogger.info(`✅ Binary found: ${bin.name}`)
		} catch {
			missingBinaries.push(bin.name)
			appLogger.warn(
				`⚠️ Missing binary: ${bin.name} — that capability degrades`,
			)
		}
	}

	for (const dir of tempDirsToEnsure) {
		const absPath = join(process.cwd(), dir)
		mkdirSync(absPath, { recursive: true })
		appLogger.info(`📁 Ensured folder: ${dir}`)
	}

	if (missingBinaries.length === 0) appLogger.info("✅ Environment ready")
	return { ok: missingBinaries.length === 0, missingBinaries }
}
