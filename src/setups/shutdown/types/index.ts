export type ShutdownTaskType = { name: string; run: () => Promise<void> | void }
