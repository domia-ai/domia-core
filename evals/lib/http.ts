import { env } from "./env"

export const meshHeaders = (): Record<string, string> => {
	if (!env.DOMIA_MESH_SECRET)
		throw new Error(
			"DOMIA_MESH_SECRET is required for calls against a live node — set it in the environment",
		)
	return { authorization: `Bearer ${env.DOMIA_MESH_SECRET}` }
}

export const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms))

export const waitForHealth = async (timeoutMs = 15000): Promise<boolean> => {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${env.EVAL_URL}/health`)
			if (res.ok) return true
		} catch {
			/* not up yet */
		}
		await sleep(500)
	}
	return false
}

export const postJson = async <T>(path: string, body: unknown): Promise<T> => {
	const res = await fetch(`${env.EVAL_URL}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: JSON.stringify(body),
	})
	return res.json() as Promise<T>
}

export const postChat = async (
	text: string,
	opts: { satelliteId?: string } = {},
): Promise<{ interactionId: string; reply: string }> => {
	const res = await fetch(`${env.EVAL_URL}/chat`, {
		method: "POST",
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: JSON.stringify({
			domiaKey: env.EVAL_DOMIA_KEY,
			text,
			...(opts.satelliteId ? { satelliteId: opts.satelliteId } : {}),
		}),
	})
	if (!res.ok) throw new Error(`/chat ${res.status}: ${await res.text()}`)
	return (await res.json()) as { interactionId: string; reply: string }
}

export const postChatAsync = (
	text: string,
): { done: Promise<{ interactionId: string; reply: string } | null> } => {
	const done = postChat(text).catch(() => null)
	return { done }
}

export const postConfig = async (bundle: unknown): Promise<void> => {
	const res = await fetch(
		`${env.EVAL_URL}/config?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify(bundle),
		},
	)
	if (!res.ok) throw new Error(`/config ${res.status}: ${await res.text()}`)
	await postConfigRefresh()
}

export const postConfigRefresh = async (): Promise<void> => {
	await fetch(`${env.EVAL_URL}/config/refresh`, {
		method: "POST",
		headers: meshHeaders(),
	}).catch(() => undefined)
}

export const resetConversation = async (): Promise<void> => {
	await fetch(
		`${env.EVAL_URL}/admin/reset-conversation?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{ method: "POST", headers: meshHeaders() },
	).catch(() => undefined)
}

export const postModules = (modules: Record<string, unknown>): Promise<void> =>
	postConfig({ modules })

export const getConfig = async (): Promise<Record<string, unknown>> => {
	const res = await fetch(
		`${env.EVAL_URL}/config?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{ headers: meshHeaders() },
	)
	if (!res.ok) throw new Error(`GET /config ${res.status}`)
	const body = (await res.json()) as {
		config?: Record<string, unknown>
	} & Record<string, unknown>
	return body.config ?? body
}

export const getConfigModules = async (): Promise<Record<string, unknown>> => {
	const config = await getConfig()
	const modules = config.modules as Record<string, unknown> | undefined
	if (!modules) throw new Error("GET /config returned no modules section")
	return modules
}
