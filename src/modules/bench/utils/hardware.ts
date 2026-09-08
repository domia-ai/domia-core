import os from "os"
import { existsSync, readFileSync } from "fs"
import { HARDWARE_CLASS_ENUM } from "@/db/constants"
import type { HardwareClassType } from "@/db/json-types"
import type { HardwareInfoType } from "../types"

const DEVICE_TREE_MODEL_PATH = "/proc/device-tree/model"
const TEGRA_RELEASE_PATH = "/etc/nv_tegra_release"

const readDeviceModel = (): string => {
	try {
		return readFileSync(DEVICE_TREE_MODEL_PATH, "utf8")
			.replace(/\0/g, "")
			.trim()
	} catch {
		return ""
	}
}

export const classifyHardware = (
	platform: string,
	arch: string,
	deviceModel: string,
	tegraRelease: boolean,
): HardwareClassType => {
	if (platform === "darwin" && arch === "arm64")
		return HARDWARE_CLASS_ENUM.APPLE_SILICON
	if (platform !== "linux") return HARDWARE_CLASS_ENUM.DESKTOP
	if (/raspberry pi/i.test(deviceModel)) return HARDWARE_CLASS_ENUM.PI
	if (tegraRelease || /nvidia|jetson/i.test(deviceModel))
		return HARDWARE_CLASS_ENUM.NVIDIA_JETSON
	if (arch === "arm64" || arch === "arm") return HARDWARE_CLASS_ENUM.SBC
	return HARDWARE_CLASS_ENUM.DESKTOP
}

export const detectHardware = (): HardwareInfoType => {
	const platform = os.platform()
	const arch = os.arch()
	const cpu = os.cpus()[0]?.model ?? ""
	const deviceModel = platform === "linux" ? readDeviceModel() : ""
	const tegraRelease = platform === "linux" && existsSync(TEGRA_RELEASE_PATH)
	return {
		hardwareClass: classifyHardware(platform, arch, deviceModel, tegraRelease),
		hardwareLabel: deviceModel || cpu || `${platform}-${arch}`,
		platform: `${platform}-${arch}`,
		cpu,
		cores: os.cpus().length,
		totalMemGb: Math.round(os.totalmem() / 1e9),
	}
}
