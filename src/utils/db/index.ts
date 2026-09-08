import crypto from "crypto"

export const generateUuid = () => crypto.randomUUID()

export const now = () => new Date().toISOString()
