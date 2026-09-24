# Skill descriptors

A **skill descriptor** is the JSON document that tells Domia how to route, fast-path and finalize the tools of one skill provider. Every `skill_provider` row carries one (`descriptor` column, edited from the console), and since chapter K4 an MCP server can ship its own copy as a resource so that a third-party server works well out of the box without anybody editing Domia's config.

Three layers are merged for each provider, per field, at resolve time:

| Layer    | Source                                                                                                                                                            | Who owns it    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| defaults | `descriptorDefaults(tools, language, provider)` of the code specialization selected by `descriptor.kind` (Home Assistant, Music Assistant, the built-in provider) | Domia          |
| server   | the `domia://descriptor` MCP resource, cached in `skill_provider.server_descriptor`                                                                               | the MCP server |
| DB       | `skill_provider.descriptor`, edited from the console or the config bundle                                                                                         | the user       |

The full JSON schema is published by the running node at `GET /skills/descriptor-schema` (`z.toJSONSchema` of the strict zod schema in `src/modules/skill-engine/schemas`), together with the list of fields a server may set, the fields that are stripped from server copies, the ingest limits and the resource URI.

## The MCP resource

An MCP server advertises the descriptor as a static resource with the fixed URI `domia://descriptor` (`SKILL_DESCRIPTOR_RESOURCE_URI`). Domia never fetches a URL for it: after `connect`, if the server's capabilities include `resources`, the already-open MCP client lists resources, finds that URI and reads it. The first `text` content is parsed as JSON and ingested.

- The read happens once per connection and again every time the tool list is actually refreshed (TTL expiry, forced refresh, `tools/list_changed`). `resources/updated` subscriptions are not used yet.
- A read failure, a corrupt document, an oversize document or a document that violates a limit is logged as a warning and **ignored**: the connection stays up and the previously cached copy (if any) keeps being used.
- A server that stops exposing the resource clears the cached copy on the next read.
- Each accepted copy is hashed (`hashCanonical`) and stored as `server_descriptor_hash`. The hash is part of the descriptor cache key and of the fast-path index hash, so a changed descriptor rolls both caches without a restart. `last_sync_at` and `updated_at` are bumped as well.
- Both MCP adapters (`mcp-v2` Streamable HTTP / stdio and the legacy `mcp-v1-sse`) implement the read.

Publishing the resource with the TypeScript SDK:

```ts
server.registerResource(
	"domia-descriptor",
	"domia://descriptor",
	{ title: "Domia skill descriptor", mimeType: "application/json" },
	async (uri) => ({
		contents: [
			{
				uri: uri.href,
				mimeType: "application/json",
				text: JSON.stringify(descriptor),
			},
		],
	}),
)
```

## What a server may set

A server copy is limited to routing, templates and texts. On ingest Domia keeps:

- `description` (sanitised, at most 500 characters)
- `routing.aliases`, `routing.exampleUtterances`, `routing.keywords`
- `execution.finalize` (texts sanitised, at most 200 characters each, only renderable placeholders) and `execution.genericWords`
- `fastPath.intents[]` with `tool`, `templates`, `slots`, `requiredKeywords`, `argDefaults`, `priority`, plus `fastPath.expansionRules`
- `i18n.<lang>` blocks with the same fields

and **strips**, silently, everything that decides policy or selects code:

- `kind` (a specialization is chosen by the DB row, never by the server)
- `execution.coreTools`, `execution.toolPolicy`, `execution.toolHints`, `execution.paramAllow`, `execution.argNormalize`, `execution.resilience`
- `fastPath.intents[].allowBlockedTokens` (root and per locale)
- `execution.hiddenTools` (which tools the LLM may see is a policy lever)

A document that contains stripped fields is still accepted (the schema is the same strict schema the DB uses); the fields are simply removed from the cached copy. The limits below reject the whole document instead:

| Limit                          | Value                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| document size                  | 64 KB                                                                |
| templates, root + all locales  | 200                                                                  |
| template length                | 200 characters                                                       |
| expansion rules per block      | 50                                                                   |
| expansion rule nesting         | depth 4, no recursion                                                |
| values per `enum` / `map` slot | 50                                                                   |
| `context` slots                | not allowed (the server has no specialization to provide the values) |

Finalize texts (`ack`, `error`, `done`) and `description` go through the injection guard (`sanitizeUntrustedText`): control characters are removed, newlines collapsed, the text capped, and a text that matches an instruction-injection pattern ("ignore all previous instructions", role tags, …) drops the whole finalize rule. A finalize text may only use placeholders `renderFinalizeText` can fill: `{speakable}`, `{name}`, or the name of an argument of that tool (checked against the cached tool schema when it is known); a rule with any other `{placeholder}` or a stray brace is dropped.

## Precedence per field

| Field                                                                                                                      | Merge                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routing.aliases`, `routing.exampleUtterances`, `routing.keywords`, `execution.genericWords`                               | union of defaults ∪ server ∪ DB ∪ locale (DB entries come after server entries)                                                                              |
| `execution.finalize`                                                                                                       | defaults → server → DB → locale, per tool key, later wins                                                                                                    |
| `description`                                                                                                              | DB ?? server ?? defaults                                                                                                                                     |
| `fastPath` block                                                                                                           | first defined of: DB locale, DB root, server locale, server root, defaults locale, defaults root — a block replaces the whole block, blocks are never merged |
| `kind`, `execution.coreTools`, `toolPolicy`, `toolHints`, `paramAllow`, `argNormalize`, `resilience`, `allowBlockedTokens` | defaults → DB only; the server layer is ignored                                                                                                              |

The locale block (`i18n.<lang>`) is picked with the same precedence: the DB locale if present, else the server locale, else the defaults locale.

The consequence for a server author: ship templates and phrasings, and let the installation decide what needs confirmation. A tool the server would like to auto-allow still follows Domia's risk defaults (annotations → risk class → policy) unless the user allows it in the console.

## Example: a weather MCP server

Tool `get_forecast { city: string }`, English and Spanish fast-path templates, an English finalize text.

```json
{
	"version": 1,
	"description": "Weather forecasts by city.",
	"routing": {
		"keywords": ["forecast", "weather", "temperature", "rain"],
		"aliases": { "get_forecast": ["weather", "forecast"] },
		"exampleUtterances": ["forecast for madrid", "weather in london tomorrow"]
	},
	"execution": {
		"finalize": {
			"get_forecast": {
				"mode": "template",
				"done": "Forecast for {city}: {speakable}"
			}
		}
	},
	"fastPath": {
		"expansionRules": { "ask": "(what is|tell me|give me)" },
		"intents": [
			{
				"tool": "get_forecast",
				"templates": [
					"(forecast|weather) (for|in) {city}",
					"<ask> the (forecast|weather) (for|in) {city}"
				],
				"slots": {
					"city": {
						"source": {
							"kind": "enum",
							"values": ["madrid", "paris", "london"]
						}
					}
				},
				"priority": 1
			}
		]
	},
	"i18n": {
		"es": {
			"keywords": ["pronóstico", "tiempo", "clima"],
			"finalize": {
				"get_forecast": {
					"mode": "template",
					"done": "Pronóstico para {city}: {speakable}"
				}
			},
			"fastPath": {
				"intents": [
					{
						"tool": "get_forecast",
						"templates": ["(pronóstico|tiempo|clima) (para|en|de) {city}"],
						"slots": {
							"city": {
								"source": {
									"kind": "enum",
									"values": ["madrid", "paris", "londres"]
								}
							}
						}
					}
				]
			}
		}
	}
}
```

Notes on the grammar: templates are a hassil subset — `{slot}`, `[optional]`, `(a|b)`, `<rule>`; no wildcards, no `;` permutations, no slots inside optionals, and every template needs at least one literal word. Matching folds case and accents, requires full consumption of the utterance, and rejects utterances with a blocked token (English `what`, `how`, `can`, `could`, …; Spanish `puedes`, `podrías`, `si`) unless the DB descriptor sets `allowBlockedTokens` for that intent. A `schemaEnum` slot takes its values from the tool's `inputSchema` enum, so a server that declares `city` as an enum does not need to repeat the list.

## How DB edits override

Everything the server ships can be overridden from the console without touching the server:

- adding `routing.keywords` in the DB descriptor adds to the union; the server keywords stay
- a DB `execution.finalize.get_forecast` replaces the server text for that tool
- a DB `description` replaces the server description
- a DB `fastPath` block (root or `i18n.<lang>`) replaces the server block entirely — copy the server templates you want to keep
- `execution.toolPolicy.get_forecast: "confirm"` in the DB is the only way to change policy; the server cannot loosen it

`GET /config` includes `serverDescriptor` and `serverDescriptorHash` read-only. `POST /config` ignores both keys if a client sends them back; the server copy is refreshed from the MCP server, never from a config bundle. `POST /config` still replaces the provider list, so a reload reconnects the provider and re-reads the resource.

The pure eval `npm run evals -- descriptor-resource` exercises all of the above against a mock MCP server (`evals/lib/mock-descriptor-mcp.ts`).
