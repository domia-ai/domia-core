import { type DomiaType } from "@/modules/core"
import { type CapabilityEnumType } from "@/db"
import dbAdapter from "../db-adapter"

export const resolveCapabilityDelegation = async (
	domia: DomiaType,
	capability: CapabilityEnumType,
) => {
	const explicitDelegations = domia?.capabilityDelegations
		?.filter(
			(delegation) =>
				delegation?.capability === capability && delegation?.isActive,
		)
		?.sort((a, b) => {
			const pa = a?.priority ?? Infinity
			const pb = b?.priority ?? Infinity
			return pa - pb
		})

	if (explicitDelegations?.length) {
		const winner = explicitDelegations?.[0]

		if (winner) {
			return {
				delegateToDomiaKey: winner.delegateToDomiaKey,
				delegateToDomiaId: winner.delegateToDomiaId,
			}
		}
	}

	const candidates =
		await dbAdapter.findAvailableDomiasForCapability(capability)

	const winner = candidates?.find(
		(candidate) =>
			candidate?.domiaId !== domia?.id && candidate?.domia?.isActive,
	)?.domia

	return winner
		? {
				delegateToDomiaKey: winner.domiaKey,
				delegateToDomiaId: winner.id,
			}
		: null
}
