import { execSync } from "child_process"
import { readFileSync } from "fs"
import os from "os"
import path from "path"
import { env } from "./env"
import type { RuntimeSnapshotType } from "../types"

const safeExec = (cmd: string): string => {
	try {
		return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim()
	} catch {
		return ""
	}
}

const packageVersion = (name: string): string => {
	try {
		const pkg = JSON.parse(
			readFileSync(path.resolve("node_modules", name, "package.json"), "utf8"),
		) as { version?: string }
		return pkg.version ?? ""
	} catch {
		return ""
	}
}

export const runtimeSnapshot = (): RuntimeSnapshotType => ({
	node: process.version,
	platform: `${os.platform()}-${os.arch()}`,
	cpu: os.cpus()[0]?.model ?? "",
	cores: os.cpus().length,
	totalMemGb: Math.round(os.totalmem() / 1e9),
	hostname: os.hostname(),
	hardwareLabel: process.env.BENCH_HW ?? os.hostname(),
	gitCommit: safeExec("git rev-parse --short HEAD"),
	gitDirty: safeExec("git status --porcelain").length > 0,
	sherpaOnnxNode: packageVersion("sherpa-onnx-node"),
	evalUrl: env.EVAL_URL,
	evalDb: env.EVAL_DB,
	evalDomiaKey: env.EVAL_DOMIA_KEY,
	capturedAt: new Date().toISOString(),
})
