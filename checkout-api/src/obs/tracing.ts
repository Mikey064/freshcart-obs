import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
    serviceName: 'checkout-api',
    traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_TRACES_URL ?? 'http://jaeger:4318/v1/traces'
    }),
    instrumentations: [
        getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
});
sdk.start();