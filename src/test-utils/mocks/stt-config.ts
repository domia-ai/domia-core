import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	STT_ENGINE_ENUM,
	DEFAULT_STT_MODEL_NAME,
	DEFAULT_STT_MODEL_PATH,
	DEFAULT_LANGUAGE,
	DEFAULT_STT_ENABLE_ENDPOINT,
	DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH,
	DEFAULT_STT_NUM_THREADS,
	DEFAULT_STT_PROVIDER,
	DEFAULT_STT_DECODE_PADDING_MS,
	DEFAULT_STT_POOL_WARM_WORKERS,
	DEFAULT_STT_POOL_MAX_WORKERS,
	DEFAULT_STT_POOL_AUTO_SCALE_ENABLED,
	DEFAULT_STT_POOL_IDLE_TIMEOUT_MS,
	DEFAULT_STT_POOL_QUEUE_MAX_DEPTH,
	DEFAULT_STT_POOL_QUEUE_TIMEOUT_MS,
	DEFAULT_STT_MAX_CONCURRENT_STREAMING_SESSIONS,
	DEFAULT_STT_SESSION_IDLE_TIMEOUT_MS,
	DEFAULT_STT_WORKER_RECYCLE_AFTER_JOBS,
} from "@/db/constants"
import { type SelectSttConfigType } from "@/db"

export const baseSttConfig = (domiaId?: string): SelectSttConfigType => {
	return {
		id: generateUuid(),
		name: faker.word.words(2),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		engine: STT_ENGINE_ENUM.ZIPFORMER,
		modelName: DEFAULT_STT_MODEL_NAME,
		language: DEFAULT_LANGUAGE,
		modelPath: DEFAULT_STT_MODEL_PATH,
		quantization: "int8",
		silenceThreshold: faker.number.float({ min: 0.01, max: 0.2 }),
		bufferSize: faker.number.int({ min: 1024, max: 8192 }),
		timeoutMs: faker.number.int({ min: 3000, max: 10000 }),
		enableEndpoint: DEFAULT_STT_ENABLE_ENDPOINT,
		rule1MinTrailingSilence: DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE,
		rule2MinTrailingSilence: DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE,
		rule3MinUtteranceLength: DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH,
		numThreads: DEFAULT_STT_NUM_THREADS,
		provider: DEFAULT_STT_PROVIDER,
		decodePaddingMs: DEFAULT_STT_DECODE_PADDING_MS,
		poolWarmWorkers: DEFAULT_STT_POOL_WARM_WORKERS,
		poolMaxWorkers: DEFAULT_STT_POOL_MAX_WORKERS,
		poolAutoScaleEnabled: DEFAULT_STT_POOL_AUTO_SCALE_ENABLED,
		poolIdleTimeoutMs: DEFAULT_STT_POOL_IDLE_TIMEOUT_MS,
		poolQueueMaxDepth: DEFAULT_STT_POOL_QUEUE_MAX_DEPTH,
		poolQueueTimeoutMs: DEFAULT_STT_POOL_QUEUE_TIMEOUT_MS,
		poolExecutionTimeoutMs: 30_000,
		maxConcurrentStreamingSessions:
			DEFAULT_STT_MAX_CONCURRENT_STREAMING_SESSIONS,
		sessionIdleTimeoutMs: DEFAULT_STT_SESSION_IDLE_TIMEOUT_MS,
		workerRecycleAfterJobs: DEFAULT_STT_WORKER_RECYCLE_AFTER_JOBS,
		createdAt: now(),
		updatedAt: now(),
	}
}
