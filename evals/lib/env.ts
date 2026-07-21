import { z } from "zod"

const envSchema = z.object({
	EVAL_URL: z.string().default("http://localhost:3100"),
	EVAL_DB: z.string().default("data/db/a.db"),
	EVAL_DOMIA_KEY: z.string().default("DOMIA_A"),
	EVAL_CASE_FILTER: z.string().optional(),
	EVAL_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
	EVAL_SUITES: z.string().optional(),
	EVAL_LIVE: z.string().optional(),
	E2E_SAT: z.string().optional(),
	E2E_AUTH: z.string().optional(),
	E2E_ONLY: z.string().optional(),
	E2E_B_URL: z.string().optional(),
	E2E_B_DB: z.string().optional(),
	LABEL: z.string().optional(),
	BENCH_RUNS: z.coerce.number().int().min(1).default(1),
	BENCH_TTFA_P95_MAX: z.coerce.number().optional(),
	BENCH_TOTAL_P95_MAX: z.coerce.number().optional(),
	DOMIA_MESH_SECRET: z.string().min(8),
})

export const env = envSchema.parse(process.env)
