// TelemetryPort: one JSON line per span on the console, which Workers observability collects.
// Attribute names follow the OpenTelemetry GenAI conventions (status: Development, so they are pinned in
// seed/standards/standards.json and changed in this file only).
export const OTEL_GENAI_PIN = 'gen_ai semconv v1.42.0 (Development)';
export const consoleTelemetry = {
  span(name, attributes) { console.log(JSON.stringify({ span: name, ...attributes, 'otel.semconv': OTEL_GENAI_PIN })); },
};
export const nullTelemetry = { span() {} };
