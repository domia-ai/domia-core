import { readdirSync, readFileSync, statSync } from "fs"
import { join, relative } from "path"

type GateRuleType = { label: string; re: RegExp }

type GateViolationType = {
	file: string
	line: number
	label: string
	text: string
}

const GATED_DIRS = [
	"src/modules/core-bus",
	"src/modules/fast-path",
	"src/modules/agent",
	"src/modules/intent-router",
	"src/utils/language-catalogs",
]

const RULES: GateRuleType[] = [
	{ label: "hass", re: /(^|[^a-z])hass(?![a-z])/i },
	{ label: "home-assistant", re: /home[-_ ]?assistant/i },
	{ label: "HaEntity", re: /HaEntity/ },
	{ label: "entity_id", re: /\bentity_id\b/ },
	{ label: "lutron", re: /lutron/i },
	{ label: "area literal", re: /(["'`]area["'`]|\.area\b|\barea:)/ },
	{ label: "domain literal", re: /(["'`]domain["'`]|\.domain\b|\bdomain:)/ },
]

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) return walk(full)
		return full.endsWith(".ts") ? [full] : []
	})

const scan = (root: string): GateViolationType[] => {
	const out: GateViolationType[] = []
	for (const dir of GATED_DIRS) {
		for (const file of walk(join(root, dir))) {
			const lines = readFileSync(file, "utf-8").split("\n")
			lines.forEach((text, i) => {
				for (const rule of RULES)
					if (rule.re.test(text))
						out.push({
							file: relative(root, file),
							line: i + 1,
							label: rule.label,
							text: text.trim(),
						})
			})
		}
	}
	return out
}

const main = (): void => {
	const violations = scan(process.cwd())
	for (const v of violations)
		console.log(`  ❌ ${v.file}:${v.line} [${v.label}] ${v.text}`)
	const scanned = GATED_DIRS.length
	console.log(
		`\nagnostic gate: ${scanned} dirs scanned, ${violations.length} violation(s)`,
	)
	if (violations.length > 0) process.exit(1)
	console.log("  ✅ core stays provider-agnostic")
}

main()
