const PII_PATTERNS: { re: RegExp; kind: string }[] = [
	{ re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, kind: "email" },
	{ re: /\b(?:\+?\d[\d ().-]{7,}\d)\b/, kind: "phone" },
	{ re: /\b(?:\d[ -]?){13,16}\b/, kind: "card-number" },
	{ re: /\b\d{3}-\d{2}-\d{4}\b/, kind: "ssn" },
	{
		re: /\b(?:sk|pk|api[_-]?key|token|bearer)[-_ ]?[A-Za-z0-9]{16,}\b/i,
		kind: "credential",
	},
]

const isLocalHost = (raw: string): boolean => {
	const host = raw.replace(/^\[|\]$/g, "")
	return (
		host === "localhost" ||
		host === "::1" ||
		host.endsWith(".local") ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^169\.254\./.test(host) ||
		/^fe80:/i.test(host) ||
		/^f[cd][0-9a-f]{2}:/i.test(host)
	)
}

export const isExternalUrl = (url: string): boolean => {
	try {
		const host = new URL(url).hostname
		return !isLocalHost(host)
	} catch {
		return false
	}
}

export const scanPiiEgress = (value: unknown): string[] => {
	const found = new Set<string>()
	const walk = (v: unknown): void => {
		if (typeof v === "string") {
			for (const { re, kind } of PII_PATTERNS) {
				if (re.test(v)) found.add(kind)
			}
		} else if (Array.isArray(v)) {
			v.forEach(walk)
		} else if (v && typeof v === "object") {
			Object.values(v).forEach(walk)
		}
	}
	walk(value)
	return [...found]
}
