import type { SatelliteSessionDepsType, SatelliteSessionType } from "../types"
import { createSatelliteSessionState } from "./state"
import { createAcousticControls } from "./acoustic"
import { createSatelliteSinks } from "./sinks"
import { createUtteranceRunner } from "./utterance"
import { createSatelliteHandlers } from "./handlers"

export const createSatelliteSession = (
	deps: SatelliteSessionDepsType,
): SatelliteSessionType => {
	const state = createSatelliteSessionState(deps)
	const acoustic = createAcousticControls(state, deps)
	const sinks = createSatelliteSinks(state, deps, acoustic)
	const utterance = createUtteranceRunner(state, deps, acoustic, sinks)
	return createSatelliteHandlers(state, deps, acoustic, sinks, utterance)
}
