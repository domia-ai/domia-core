import { DomiaType } from "@/modules/core"

export const runWhisper = async (domia: DomiaType, filePath: string) => {
	return `[Pending] Transcription of file ${filePath} for domia ${domia?.name} using Whisper`
}
