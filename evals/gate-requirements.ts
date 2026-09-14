import { gateRequirements, REQUIREMENT_REASON } from "./lib/requirements"
import { makeChecker } from "./lib/assert"
import { env } from "./lib/env"
import type { EvalRequirementType } from "./types"

const ALL = Object.keys(REQUIREMENT_REASON) as EvalRequirementType[]

const main = (): void => {
	const checker = makeChecker()
	console.log("\n== requirement gating ==")

	const none = new Set<EvalRequirementType>()
	const all = new Set<EvalRequirementType>(ALL)

	checker.check(
		"a suite with no requirements is never gated",
		gateRequirements(undefined, none).length === 0,
	)
	checker.check(
		"an empty requires list is never gated",
		gateRequirements([], none).length === 0,
	)
	checker.check(
		"every requirement met means no gate",
		gateRequirements(ALL, all).length === 0,
	)

	const gated = gateRequirements(["skills", "ha"], new Set(["skills"]))
	checker.check(
		"only the unmet requirement is reported",
		gated.length === 1 && gated[0].requirement === "ha",
		gated.map((g) => g.requirement).join(","),
	)
	checker.check(
		"the gate carries a reason",
		gated[0]?.reason === REQUIREMENT_REASON.ha,
		gated[0]?.reason,
	)
	checker.check(
		"the ha gate names the killed-mock-run cause",
		/mock/i.test(gated[0]?.reason ?? ""),
		gated[0]?.reason,
	)

	for (const requirement of ALL) {
		const [entry] = gateRequirements([requirement], none)
		checker.check(
			`${requirement} gate carries a non-empty recovery command`,
			entry.recovery.trim().length > 0,
		)
		checker.check(
			`${requirement} gate carries a non-empty reason`,
			entry.reason.trim().length > 0,
		)
	}

	const ha = gateRequirements(["ha"], none)[0]
	checker.check(
		"the ha recovery reactivates the real provider rows",
		ha.recovery.includes("UPDATE skill_provider SET is_active = 1"),
		ha.recovery,
	)
	checker.check(
		"the ha recovery clears the eval mock rows",
		ha.recovery.includes("DELETE FROM skill_provider WHERE id LIKE 'eval-%'"),
		ha.recovery,
	)
	const skillsOff = ha.recovery.indexOf('"skillsEngine":false')
	const skillsOn = ha.recovery.indexOf('"skillsEngine":true')
	checker.check(
		"the ha recovery reloads skills by toggling skillsEngine off then on",
		skillsOff >= 0 && skillsOn > skillsOff,
		ha.recovery,
	)
	checker.check(
		"the ha recovery does not rely on /config/refresh to reload providers",
		!ha.recovery.includes("/config/refresh"),
		ha.recovery,
	)
	checker.check(
		"the ha recovery only reactivates the eval identity's providers",
		ha.recovery.includes(`domia_key = '${env.EVAL_DOMIA_KEY}'`),
		ha.recovery,
	)

	const total = checker.passCount() + checker.failCount()
	console.log(
		`\n${checker.passCount()}/${total} gate-requirements checks passed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

main()
