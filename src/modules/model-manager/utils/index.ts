import { isAbsolute, relative, resolve } from "path"

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])
const WINDOWS_DRIVE = /^[A-Za-z]:/
const ALLOWED_ARCHIVE_ENTRY_TYPES = new Set(["-", "d"])
const ARCHIVE_LINK_MARKER = /\s(?:->|link to)\s/
const ARCHIVE_SUFFIX = /\.(tar\.(?:gz|bz2|xz|zst|lz4)|tgz|tbz2?|txz|tzst|tar)$/i

const hostMatches = (host: string, allowed: string): boolean => {
	const a = allowed.trim().toLowerCase()
	return a.length > 0 && (host === a || host.endsWith(`.${a}`))
}

export const isAllowedInstallUrl = (
	url: string,
	allowedHosts: readonly string[],
): boolean => {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return false
	}
	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false
	const host = parsed.hostname.toLowerCase()
	return allowedHosts.some((allowed) => hostMatches(host, allowed))
}

export const findUnsafeArchiveEntry = (
	entries: readonly string[],
): string | null => {
	for (const raw of entries) {
		const entry = raw.trim()
		if (entry.length === 0) continue
		if (entry.startsWith("/") || entry.startsWith("\\")) return entry
		if (WINDOWS_DRIVE.test(entry)) return entry
		if (entry.split(/[\\/]/).includes("..")) return entry
	}
	return null
}

export const findUnsafeArchiveEntryType = (
	lines: readonly string[],
): string | null => {
	for (const raw of lines) {
		const line = raw.trim()
		if (line.length === 0) continue
		if (!ALLOWED_ARCHIVE_ENTRY_TYPES.has(line.slice(0, 1))) return line
		if (ARCHIVE_LINK_MARKER.test(line)) return line
	}
	return null
}

export const parseArchiveListing = (listing: string): string[] =>
	listing
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)

export const resolveModelTargetPath = (
	modelsDir: string,
	target: string,
	subdir?: string,
): string | null => {
	const base = resolve(modelsDir)
	const resolved = resolve(base, subdir ?? ".", target)
	const rel = relative(base, resolved)
	if (rel.length === 0 || isAbsolute(rel)) return null
	if (rel.split(/[\\/]/).includes("..")) return null
	if (subdir !== undefined && relative(base, resolve(base, subdir)) !== subdir)
		return null
	return resolved
}

export const archiveSuffix = (url: string): string => {
	try {
		const match = ARCHIVE_SUFFIX.exec(new URL(url).pathname)
		return match ? `.${match[1]}` : ".tar"
	} catch {
		return ".tar"
	}
}
