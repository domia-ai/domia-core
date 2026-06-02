import os from "os"

const AUTO_MAX_WORKERS_FLOOR = 2
const AUTO_MAX_WORKERS_CEILING = 4
const AUTO_CORE_DIVISOR = 3
const AUTO_GB_PER_WORKER = 1.5

export const resolveMaxWorkers = (configured: number): number => {
	if (configured > 0) return configured
	const cores = os.cpus().length || AUTO_MAX_WORKERS_FLOOR
	const coresBased = Math.floor(cores / AUTO_CORE_DIVISOR)
	const totalGb = os.totalmem() / 1024 ** 3
	const ramBased = Math.floor(totalGb / AUTO_GB_PER_WORKER)
	const derived = Math.min(coresBased, ramBased)
	return Math.max(1, Math.min(AUTO_MAX_WORKERS_CEILING, derived))
}

export const poolBusyError = (message: string): Error => {
	const err = new Error(message) as Error & { code?: string }
	err.code = "INFERENCE_POOL_BUSY"
	return err
}
