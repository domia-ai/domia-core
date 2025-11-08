# mqtt-config-manager

This module manages the MQTT connection configurations for the DOMIA system.

## 🎯 Purpose

To retrieve, validate, and prepare the active MQTT configuration for each DOMIA instance. It ensures that each DOMIA knows _how_ to connect to local or remote brokers and how to namespace its MQTT topics safely.

## ✅ Responsibilities

- Retrieve the active MQTT config for a given DOMIA ID and type (`LOCAL` or `REMOTE`)
- Validate that the broker configuration is complete and correct (broker URL, topicRoot, credentials)
- Provide helpers to build topic roots and final topics
- Initialize and return a ready-to-use `mqtt` client with the correct settings
- Serve as a single source of truth for MQTT transport details within DOMIA

## 🚫 What it doesn't do

- Does not publish or subscribe directly to topics (that’s handled by `setupLocalMqtt` or `setupRemoteMqtt`)
- Does not manage runtime messaging logic (that’s handled by the `DomiaBus` and event handlers)
- Does not store or persist MQTT messages (that’s handled by the broker itself)

## 🛠 Expected Methods

```ts
getActiveMqttConfig(domiaId: string, type: "LOCAL" | "REMOTE"): Promise<MqttConfig>
validateMqttConfig(config: MqttConfig): boolean
buildTopic(topicRoot: string, subpath: string): string
setupMqttClient(config: MqttConfig): MqttClient
```
