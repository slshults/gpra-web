"""
Ships GPRA's distributed traces to PostHog Tracing via OpenTelemetry (OTLP/HTTP).

Mirrors otel_logs.py: auto-instruments Flask (one span per request), SQLAlchemy
(child spans per query, covers both the app engine and Flask-AppBuilder's), and
outbound HTTP via requests (Stripe, Mailgun, reCAPTCHA) and httpx (Anthropic),
so autocreate and billing latency show up as spans under the request trace.

When both this and OTLP logging are enabled, log records automatically carry
trace_id/span_id, so PostHog can link logs to the trace they happened in.

Gated on POSTHOG_TRACES_ENABLED so local dev stays quiet by default — set it to
true only where you want traces shipped (production). Reuses POSTHOG_API_KEY
(the phc_ project token) for auth.

Env vars:
- POSTHOG_TRACES_ENABLED        '1'/'true'/'yes' to enable (default: off)
- POSTHOG_API_KEY               project token, reused from the existing SDK setup
- POSTHOG_OTLP_TRACES_ENDPOINT  override the ingest URL (default: PostHog US Cloud)
"""

import atexit
import os

DEFAULT_ENDPOINT = 'https://us.i.posthog.com/i/v1/traces'

# Skip spans for asset/crawler noise; only real application routes get traced.
EXCLUDED_URLS = '/static/,/robots.txt,/sitemap.xml,/favicon'


def setup_otel_tracing(app):
    """Set up OTLP trace export + auto-instrumentation for the Flask app.

    No-op when POSTHOG_TRACES_ENABLED is unset/false. Returns the TracerProvider
    when wired up (mainly so callers/tests can flush it), else None.

    Must run BEFORE Flask-AppBuilder's init_admin so the patched create_engine
    also catches FAB's internal engine.
    """
    if os.getenv('POSTHOG_TRACES_ENABLED', '').strip().lower() not in ('1', 'true', 'yes'):
        return None

    token = os.getenv('POSTHOG_API_KEY')
    if not token:
        app.logger.warning('POSTHOG_TRACES_ENABLED is set but POSTHOG_API_KEY is missing; skipping OTLP trace export')
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.flask import FlaskInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.instrumentation.requests import RequestsInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    except ImportError:
        app.logger.warning('OpenTelemetry tracing packages not installed; skipping OTLP trace export')
        return None

    endpoint = os.getenv('POSTHOG_OTLP_TRACES_ENDPOINT', DEFAULT_ENDPOINT)
    environment = os.getenv('FLASK_ENV', 'production')

    resource = Resource.create({
        'service.name': 'gpra-web',
        'deployment.environment': environment,
    })
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=endpoint,
        headers={'Authorization': f'Bearer {token}'},
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    FlaskInstrumentor().instrument_app(app, excluded_urls=EXCLUDED_URLS)

    # Instrument the already-created app engine directly, and patch
    # create_engine so engines created later (Flask-AppBuilder's) are covered.
    from app.database import engine
    SQLAlchemyInstrumentor().instrument(engine=engine)

    # Exclude PostHog's own ingest host so the analytics SDK's batch sends
    # don't generate orphan client spans.
    RequestsInstrumentor().instrument(excluded_urls='us.i.posthog.com')
    HTTPXClientInstrumentor().instrument()

    # Flush any buffered spans on shutdown.
    atexit.register(provider.shutdown)

    app.logger.info('PostHog OTLP trace export enabled', extra={'deployment_environment': environment})
    return provider
