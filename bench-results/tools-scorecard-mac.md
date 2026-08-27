# Tools scorecard (Mac) — model × decision mode × tools/home-mock/fast suites

Run: 2026-08-18T01:42:49.849905+00:00

| model          | mode       | gates | cases | failures                                                                                                                                                                    |
| -------------- | ---------- | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| llama3.2:3b    | native     | 21/21 | 29/30 | [tools] tools baseline: read-only context call reports ok (known routing gap) (0/2)                                                                                         |
| llama3.2:3b    | structured | 21/21 | 29/30 | [tools] tools baseline: read-only context call reports ok (known routing gap) (0/2)                                                                                         |
| granite4:micro | native     | 21/21 | 29/30 | [tools] tools baseline: read-only context call reports ok (known routing gap) (0/2)                                                                                         |
| granite4:micro | structured | 21/21 | 28/30 | [tools] contracts: hung tool surfaces timeout status instead of hanging the turn (0/1); [tools] tools baseline: read-only context call reports ok (known routing gap) (0/2) |
