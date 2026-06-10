export type BootStatusType = {
	missingBinaries: string[]
	voice: "ok" | "disabled-missing" | "off"
	voiceMissing: string[]
}
