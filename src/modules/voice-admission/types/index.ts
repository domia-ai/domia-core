import type { createAsyncSemaphore } from "@/utils"

export type SemaphoreType = ReturnType<typeof createAsyncSemaphore>
