export const REFLECTION_TIMEOUT_MS = 15_000
export const REFLECTION_IDLE_POLL_MS = 250
// hub must stay idle this long before reflection may take the LLM (conversation pause)
export const REFLECTION_IDLE_GRACE_MS = 15_000
// must exceed conversational turn cadence, or every mid-conversation fact capture starves (observed live on the VPE session 2026-07-22)
export const REFLECTION_MAX_IDLE_WAIT_MS = 180_000
export const REFLECTION_SLOT_TIMEOUT_MS = 30_000
export const REFLECTION_YIELD_MAX_ATTEMPTS = 3
