import { createServer, type Socket } from "net"

import { createWyomingConnection } from "@/modules/satellite-protocols/wyoming"

import type { FakeWyomingEventType, FakeWyomingSatelliteType } from "../types"

export const createFakeWyomingSatellite =
	(): Promise<FakeWyomingSatelliteType> =>
		new Promise((resolve) => {
			const events: FakeWyomingEventType[] = []
			const waiters: { type: string; count: number; resolve: () => void }[] = []
			let socket: Socket | null = null
			let conn: ReturnType<typeof createWyomingConnection> | null = null
			const notify = (): void => {
				for (const waiter of [...waiters]) {
					if (
						events.filter((e) => e.type === waiter.type).length >= waiter.count
					) {
						waiters.splice(waiters.indexOf(waiter), 1)
						waiter.resolve()
					}
				}
			}
			const server = createServer((sock) => {
				socket = sock
				conn = createWyomingConnection(sock, (type, data, payload) => {
					events.push({ type, data, payload, at: Date.now() })
					notify()
				})
			})
			server.listen(0, "127.0.0.1", () => {
				const address = server.address()
				const port = typeof address === "object" && address ? address.port : 0
				resolve({
					port,
					events,
					eventsOf: (type) => events.filter((e) => e.type === type),
					waitFor: (type, count = 1, timeoutMs = 3000) =>
						new Promise<boolean>((done) => {
							if (events.filter((e) => e.type === type).length >= count) {
								done(true)
								return
							}
							const timer = setTimeout(() => {
								waiters.splice(
									waiters.findIndex((w) => w.resolve === settle),
									1,
								)
								done(false)
							}, timeoutMs)
							const settle = (): void => {
								clearTimeout(timer)
								done(true)
							}
							waiters.push({ type, count, resolve: settle })
						}),
					send: (type, data, payload) => conn?.write(type, data, payload),
					close: () => {
						socket?.destroy()
						server.close()
					},
				})
			})
		})
