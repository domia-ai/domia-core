import { otelLogger, domiaError, CORE_ERRORS } from "@/utils"
import { registerShutdownTask } from "@/setups/shutdown"
import type { OtelHandleType, SetupOtelArgsType } from "./types"

export const setupOtel = async ({
	exporterUrl,
	serviceName,
	principalDomiaKey,
}: SetupOtelArgsType): Promise<OtelHandleType | null> => {
	if (!exporterUrl) return null
	try {
		const [
			{ BasicTracerProvider, BatchSpanProcessor },
			{ OTLPTraceExporter },
			{ resourceFromAttributes },
			telemetry,
		] = await Promise.all([
			import("@opentelemetry/sdk-trace-base"),
			import("@opentelemetry/exporter-trace-otlp-http"),
			import("@opentelemetry/resources"),
			import("@/modules/telemetry"),
		])
		const idGenerator = telemetry.createDomiaIdGenerator()
		const provider = new BasicTracerProvider({
			idGenerator,
			resource: resourceFromAttributes({
				"service.name": serviceName,
				"domia.principal_domia_key": principalDomiaKey,
			}),
			spanProcessors: [
				new BatchSpanProcessor(new OTLPTraceExporter({ url: exporterUrl })),
			],
		})
		const bridge = telemetry.createTurnSpanBridge({
			tracer: provider.getTracer(telemetry.OTEL_TRACER_NAME),
			idGenerator,
		})
		const shutdown = async (): Promise<void> => {
			bridge.stop()
			await provider.shutdown()
		}
		registerShutdownTask("otel", shutdown)
		otelLogger.info(`🔭 OpenTelemetry traces → ${exporterUrl}`)
		return { shutdown, openTurns: bridge.openTurns }
	} catch (err) {
		throw domiaError(CORE_ERRORS.OTEL_INIT_FAILED, {
			logger: otelLogger,
			meta: {
				exporterUrl,
				err: err instanceof Error ? err.message : String(err),
			},
		})
	}
}
