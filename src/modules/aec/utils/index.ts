import { runProcess } from "@/utils"

import { PACTL_BIN, PACTL_TIMEOUT_MS, ECHO_CANCEL_MODULE } from "../constants"
import type { AecBackendType, AecConfigType, PactlRunnerType } from "../types"

export const runPactl: PactlRunnerType = async (args) => {
	const result = await runProcess(PACTL_BIN, args, {
		timeoutMs: PACTL_TIMEOUT_MS,
		captureStderr: true,
	})
	return { ok: result.ok, stdout: result.stdout, stderr: result.stderr }
}

export const parseBackend = (serverInfo: string): AecBackendType | null => {
	const line = serverInfo
		.split("\n")
		.find((l) => l.toLowerCase().startsWith("server name"))
	if (!line) return null
	const name = line.toLowerCase()
	if (name.includes("pipewire")) return "PIPEWIRE"
	if (name.includes("pulseaudio")) return "PULSEAUDIO"
	return null
}

export const parseModuleIndex = (stdout: string): number | null => {
	const match = /(\d+)\s*$/.exec(stdout.trim())
	return match ? Number(match[1]) : null
}

export const staleEchoCancelModules = (
	moduleList: string,
	sourceName: string,
): number[] =>
	moduleList
		.split("\n")
		.map((line) => line.split(/\s+/))
		.filter(
			(cols) =>
				cols[1] === ECHO_CANCEL_MODULE &&
				cols.slice(2).join(" ").includes(`source_name=${sourceName}`),
		)
		.map((cols) => Number(cols[0]))
		.filter((n) => Number.isFinite(n))

export const aecSignature = (config: AecConfigType): string =>
	[
		config.aecBackend,
		config.aecMethod,
		config.aecSourceMaster ?? "",
		config.aecSinkMaster ?? "",
		config.aecSourceName,
		config.aecSinkName,
		config.aecSetDefaultDevices ? "defaults" : "",
	].join("|")

export const echoCancelModuleArgs = (
	config: AecConfigType,
	description: string,
): string[] => {
	const args = [
		`aec_method=${config.aecMethod}`,
		`source_name=${config.aecSourceName}`,
		`sink_name=${config.aecSinkName}`,
		"use_master_format=1",
		`source_properties=device.description="${description}"`,
		`sink_properties=device.description="${description}"`,
	]
	if (config.aecSourceMaster)
		args.push(`source_master=${config.aecSourceMaster}`)
	if (config.aecSinkMaster) args.push(`sink_master=${config.aecSinkMaster}`)
	return args
}
