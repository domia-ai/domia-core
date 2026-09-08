import { spawnSync } from "node:child_process"

import { devCliLogger } from "@/utils"

const run = (cmd: string, args: string[]): number =>
	spawnSync(cmd, args, { stdio: "inherit" }).status ?? 1

export const setupModelsCommand = (name: string): void => {
	devCliLogger.info(`📥 downloading model set "${name}"`)
	process.exit(run("bash", ["scripts/download-models.sh", name]))
}

export const doctorCommand = (): void => {
	const binaries = run("make", ["doctor"])
	const services = run("make", ["services"])
	process.exit(binaries === 0 && services === 0 ? 0 : 1)
}
