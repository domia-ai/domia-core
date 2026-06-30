const hosted = new Set<string>()

export const registerHostedIdentity = (domiaKey: string): void => {
	hosted.add(domiaKey)
}

export const unregisterHostedIdentity = (domiaKey: string): void => {
	hosted.delete(domiaKey)
}

export const isHostedIdentity = (domiaKey: string): boolean =>
	hosted.has(domiaKey)

export const getHostedIdentities = (): string[] => [...hosted]
