"""
Ships GPRA's application logs to PostHog Logs via OpenTelemetry (OTLP/HTTP).

This is purely additive: it attaches an OTLP log handler alongside the existing
RotatingFileHandler, so logs/gpr.log keeps its full DEBUG stream while PostHog
receives INFO and above.

Gated on POSTHOG_LOGS_ENABLED so local dev stays quiet by default — set it to
true only where you want logs shipped (production). Reuses POSTHOG_API_KEY (the
phc_ project token) for auth.

Env vars:
- POSTHOG_LOGS_ENABLED        '1'/'true'/'yes' to enable (default: off)
- POSTHOG_API_KEY             project token, reused from the existing SDK setup
- POSTHOG_OTLP_LOGS_ENDPOINT  override the ingest URL (default: PostHog US Cloud)
"""

import atexit
import logging
import os

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = 'https://us.i.posthog.com/i/v1/logs'


def setup_otel_logging(app):
    """Attach an OTLP log handler to app.logger so INFO+ logs flow to PostHog.

    No-op when POSTHOG_LOGS_ENABLED is unset/false. Returns the LoggerProvider
    when wired up (mainly so callers/tests can flush it), else None.
    """
    if os.getenv('POSTHOG_LOGS_ENABLED', '').strip().lower() not in ('1', 'true', 'yes'):
        return None

    token = os.getenv('POSTHOG_API_KEY')
    if not token:
        app.logger.warning('POSTHOG_LOGS_ENABLED is set but POSTHOG_API_KEY is missing; skipping OTLP log export')
        return None

    try:
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    except ImportError:
        app.logger.warning('OpenTelemetry logging packages not installed; skipping OTLP log export')
        return None

    endpoint = os.getenv('POSTHOG_OTLP_LOGS_ENDPOINT', DEFAULT_ENDPOINT)
    environment = os.getenv('FLASK_ENV', 'production')

    resource = Resource.create({
        'service.name': 'gpra-web',
        'deployment.environment': environment,
    })
    provider = LoggerProvider(resource=resource)
    set_logger_provider(provider)

    exporter = OTLPLogExporter(
        endpoint=endpoint,
        headers={'Authorization': f'Bearer {token}'},
    )
    provider.add_log_record_processor(BatchLogRecordProcessor(exporter))

    # INFO+ to PostHog; the file handler keeps the full DEBUG stream untouched.
    otlp_handler = LoggingHandler(level=logging.INFO, logger_provider=provider)
    app.logger.addHandler(otlp_handler)

    # Flush any buffered records on shutdown.
    atexit.register(provider.shutdown)

    app.logger.info('PostHog OTLP log export enabled', extra={'deployment_environment': environment})
    return provider
