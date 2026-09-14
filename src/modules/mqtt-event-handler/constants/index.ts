import { MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"
import type { MeshIdentityFieldType } from "@/utils"

export const MESH_IDENTITY_FIELD_BY_EVENT: Record<
	MQTT_EVENT_ENUM,
	MeshIdentityFieldType
> = {
	[MQTT_EVENT_ENUM.HEARTBEAT]: "domiaKey",
	[MQTT_EVENT_ENUM.CONFIG_CHANGED]: "domiaKey",
	[MQTT_EVENT_ENUM.OFFLINE]: "nodeId",
	[MQTT_EVENT_ENUM.SPEAKING]: "nodeId",
}

export const MESH_CONTROL_ENVELOPE_FIELDS = new Set([
	"issuedAt",
	"bootId",
	"sequence",
	"signature",
])

export const SIGNATURE_POLICY_REJECT_REASONS = new Set([
	"unsigned",
	"bad-signature",
])
