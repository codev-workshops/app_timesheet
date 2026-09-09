// Preloaded via `node -r ./src/tracing.js` so instrumentation patches
// `http` and `express` before the application requires them.
//
// Auto-instrumentation covers HTTP server/client and Express middleware/route
// spans. `sqlite3` and `pdfkit` are NOT auto-instrumented; manual spans for
// database queries and PDF generation are out of scope here.
const { NodeSDK, resources, tracing } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

// OTLPTraceExporter reads OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
// itself and falls back to http://localhost:4318/v1/traces.
// Set OTEL_TRACES_EXPORTER=console to print spans to stdout (local debugging).
const traceExporter = process.env.OTEL_TRACES_EXPORTER === 'console'
  ? new tracing.ConsoleSpanExporter()
  : new OTLPTraceExporter();

const sdk = new NodeSDK({
  resource: resources.resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'timesheet-backend'
  }),
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});

module.exports = sdk;
