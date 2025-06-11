import { DomiaType } from "@/modules/core"
import { type InsertCharacterProfileType, type DBClientOrTxType } from "@/db"

import dbAdapter from "../db-adapter"
import { createProfileSegment } from "../utils"
import { PROFILE_SEGMENTS } from "../constants"

export const updateCharacterProfileByDomiaId = (
	domiaId: string,
	data: InsertCharacterProfileType,
	client?: DBClientOrTxType,
) => dbAdapter.updateCharacterProfileByDomiaId(domiaId, data, client)

export const getCharacterContext = (domia: DomiaType): string => {
	const profile = domia?.characterProfile

	if (!profile) {
		return "DOMIA has no defined character profile."
	}

	const {
		personality,
		communicationStyle,
		profession,
		perceivedAge,
		culturalBackground,
		relationshipType,
		roleMode,
	} = profile

	const segments = [
		createProfileSegment(personality, PROFILE_SEGMENTS.PERSONALITY),
		createProfileSegment(communicationStyle, PROFILE_SEGMENTS.COMMUNICATION),
		createProfileSegment(profession, PROFILE_SEGMENTS.PROFESSION),
		createProfileSegment(perceivedAge, PROFILE_SEGMENTS.AGE),
		createProfileSegment(relationshipType, PROFILE_SEGMENTS.RELATIONSHIP),
		createProfileSegment(culturalBackground, PROFILE_SEGMENTS.BACKGROUND),
		createProfileSegment(roleMode, PROFILE_SEGMENTS.ROLE),
	]

	const activeSegments = segments
		.filter((segment) => segment.condition)
		.map((segment) => segment.text)

	if (activeSegments.length === 0) {
		return "DOMIA has no defined characteristics."
	}

	return `DOMIA ${activeSegments.join(", ")}.`
}
