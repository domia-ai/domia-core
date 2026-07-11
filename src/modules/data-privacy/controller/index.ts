import { unlink } from "fs/promises"

import { appLogger } from "@/utils"
import { forgetServedAudio } from "@/modules/core-bus"
import dbAdapter from "../db-adapter"
import type { IdentityDataDeletionType } from "../types"

const collectAudioArtifacts = (
	domiaId: string,
): { paths: string[]; interactionIds: string[] } => {
	const traces = dbAdapter.getTraceAudioPaths(domiaId)
	const announcements = dbAdapter.getAnnouncementAudioPaths(domiaId)
	const paths = [
		...traces.flatMap((t) => [t.inputAudioPath, t.ttsAudioPath]),
		...announcements.map((a) => a.audioPath),
	].filter((p): p is string => !!p)
	return { paths, interactionIds: traces.map((t) => t.id) }
}

export const deleteIdentityData = async (
	domiaId: string,
): Promise<IdentityDataDeletionType> => {
	const { paths, interactionIds } = collectAudioArtifacts(domiaId)
	forgetServedAudio(interactionIds)
	const uniquePaths = [...new Set(paths)]
	const filesDeleted = (
		await Promise.all(
			uniquePaths.map((p) =>
				unlink(p).then(
					() => true,
					() => false,
				),
			),
		)
	).filter(Boolean).length

	const deleted = dbAdapter.deleteUserDataForDomia(domiaId)
	const total = Object.values(deleted).reduce((sum, n) => sum + n, 0)
	appLogger.info("🗑️ identity data erased (GDPR)", {
		domiaId,
		total,
		deleted,
		filesDeleted,
	})
	return { domiaId, deleted, total, filesDeleted }
}
