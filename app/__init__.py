from flask import Flask
import logging
from logging.handlers import RotatingFileHandler
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__,
           static_folder='static',  # Look directly in static directory
           static_url_path='/static')    # URL prefix for static files

# Configure Flask to work behind reverse proxy (nginx)
# This is needed for OAuth redirect URIs to use HTTPS in production
flask_env = os.getenv('FLASK_ENV')
IS_PRODUCTION = flask_env == 'production'
print(f"DEBUG: FLASK_ENV = '{flask_env}', IS_PRODUCTION = {IS_PRODUCTION}")
app.logger.info(f"Environment: FLASK_ENV = '{flask_env}', IS_PRODUCTION = {IS_PRODUCTION}")
if IS_PRODUCTION:
    from werkzeug.middleware.proxy_fix import ProxyFix
    # Trust X-Forwarded-* headers from nginx
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
    app.config['PREFERRED_URL_SCHEME'] = 'https'

# Configure Flask app
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', '***REMOVED***')
app.config['DATABASE_URL'] = os.getenv('DATABASE_URL', 'postgresql://gpra:***REMOVED***@localhost:5432/gpra_dev')

# Password Reset Configuration
app.config['PASSWORD_RESET_TOKEN_EXPIRY'] = int(os.getenv('PASSWORD_RESET_TOKEN_EXPIRY', '3600'))

# Mailgun Email Service Configuration
app.config['MAILGUN_API_KEY'] = os.getenv('MAILGUN_API_KEY')
app.config['MAILGUN_DOMAIN'] = os.getenv('MAILGUN_DOMAIN')
app.config['MAILGUN_API_URL'] = os.getenv('MAILGUN_API_URL', 'https://api.mailgun.net/v3')
app.config['MAILGUN_FROM_EMAIL'] = os.getenv('MAILGUN_FROM_EMAIL')
app.config['MAILGUN_FROM_NAME'] = os.getenv('MAILGUN_FROM_NAME', 'Guitar Practice Routine App')

# NOTE: SERVER_NAME breaks app - don't set it!
# OAuth redirect_uri issue needs different solution

# Flask-Session Configuration (for multi-worker CSRF support)
# CRITICAL: Must be configured BEFORE WTForms CSRF so CSRF tokens use Redis sessions
from flask_session import Session
import redis
import json
from flask_babel import LazyString

# Custom serializer for Flask-Session that handles LazyString from Flask-AppBuilder
# This inherits from Flask-Session's base Serializer class to match the expected interface
import msgspec

def convert_lazy_strings(obj):
    """Recursively convert LazyString objects to str for serialization."""
    if isinstance(obj, LazyString):
        return str(obj)
    elif isinstance(obj, dict):
        return {k: convert_lazy_strings(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return type(obj)(convert_lazy_strings(item) for item in obj)
    return obj

class LazyStringSafeSerializer:
    """
    Custom Flask-Session serializer that converts LazyString objects before encoding.

    Matches the interface expected by Flask-Session's ServerSideSessionInterface.
    """
    def __init__(self, app, format='json'):
        """Initialize serializer with app and format (matching MsgSpecSerializer interface)."""
        self.app = app
        if format == 'json':
            self.encoder = msgspec.json.Encoder()
            self.decoder = msgspec.json.Decoder()
        elif format == 'msgpack':
            self.encoder = msgspec.msgpack.Encoder()
            self.decoder = msgspec.msgpack.Decoder()
        else:
            raise ValueError(f"Unsupported serialization format: {format}")

    def encode(self, session):
        """Serialize session data, converting LazyString objects first."""
        try:
            # Convert LazyString objects to str before encoding
            safe_data = convert_lazy_strings(dict(session))
            return self.encoder.encode(safe_data)
        except Exception as e:
            self.app.logger.error(f"Failed to serialize session data: {e}")
            raise

    def decode(self, serialized_data):
        """Deserialize session data from bytes."""
        try:
            return self.decoder.decode(serialized_data)
        except Exception as e:
            self.app.logger.error(f"Failed to deserialize session data: {e}")
            raise

# Use Redis sessions everywhere (dev + production) for reliable OAuth state persistence
# Filesystem sessions have timing issues where state isn't flushed before OAuth redirect
app.config['SESSION_TYPE'] = 'redis'
app.config['SESSION_KEY_PREFIX'] = 'gpra:'
app.config['SESSION_REDIS'] = redis.from_url(
    os.getenv('REDIS_URL', 'redis://localhost:6379/0')
)
app.logger.info("Using Redis sessions (fixes OAuth CSRF timing issues)")

app.config['SESSION_PERMANENT'] = True  # Persist sessions across browser restarts
app.config['SESSION_USE_SIGNER'] = True

# Monkey-patch Flask-Session to use our custom serializer
# Strategy: Wrap the original __init__ and replace serializer immediately after creation
from flask_session.base import ServerSideSessionInterface

_original_session_init = ServerSideSessionInterface.__init__

def _patched_session_init(self, *args, **kwargs):
    """Call original init, then replace the serializer with our LazyString-safe version."""
    # Call the original __init__ to set up everything properly
    _original_session_init(self, *args, **kwargs)

    # Now replace the serializer with our custom one
    # Preserve the serialization format that was configured
    serialization_format = kwargs.get('serialization_format', 'msgpack')
    self.serializer = LazyStringSafeSerializer(app=self.app, format=serialization_format)

ServerSideSessionInterface.__init__ = _patched_session_init

# Initialize Flask-Session FIRST (before CSRF config)
Session(app)

# Session Cookie Configuration
# Set SECURE to False for local development (HTTP), True for production (HTTPS)
app.config['SESSION_COOKIE_SECURE'] = IS_PRODUCTION  # Require HTTPS in production
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevent JavaScript access to cookies
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = 86400  # 24 hours

# Multi-domain support: Set SESSION_COOKIE_DOMAIN based on request domain
# This allows cookies to work across subdomains within the same TLD family
# e.g., guitarpracticeroutine.com and www.guitarpracticeroutine.com share cookies
from flask import request

@app.before_request
def set_session_cookie_domain():
    """
    Dynamically set session cookie domain based on incoming request.

    Maps domains to their parent for subdomain sharing:
    - guitarpracticeroutine.com, www.guitarpracticeroutine.com → .guitarpracticeroutine.com
    - guitarpracticeroutine.net, www.guitarpracticeroutine.net → .guitarpracticeroutine.net
    - gpra.app, www.gpra.app → .gpra.app
    - localhost, 127.0.0.1 → None (same-origin only)

    Note: Different TLDs (e.g., .com vs .net) cannot share cookies due to browser security.
    Users will see consent banner once per TLD family (max 5 times).
    """
    host = request.host.split(':')[0]  # Remove port if present

    # Production domains - set cookie domain to parent TLD
    if 'guitarpracticeroutine.com' in host:
        app.config['SESSION_COOKIE_DOMAIN'] = '.guitarpracticeroutine.com'
    elif 'guitarpracticeroutine.net' in host:
        app.config['SESSION_COOKIE_DOMAIN'] = '.guitarpracticeroutine.net'
    elif 'guitarpracticeroutineapp.com' in host:
        app.config['SESSION_COOKIE_DOMAIN'] = '.guitarpracticeroutineapp.com'
    elif 'gpra.app' in host:
        app.config['SESSION_COOKIE_DOMAIN'] = '.gpra.app'
    elif 'gpra.click' in host:
        app.config['SESSION_COOKIE_DOMAIN'] = '.gpra.click'
    else:
        # localhost, 127.0.0.1, or unknown domain - use default (same-origin)
        app.config['SESSION_COOKIE_DOMAIN'] = None

# CSRF Configuration (uses Redis sessions configured above)
app.config['WTF_CSRF_ENABLED'] = True
app.config['WTF_CSRF_TIME_LIMIT'] = None  # No time limit on CSRF tokens
app.config['WTF_CSRF_SSL_STRICT'] = False  # Allow CSRF on non-HTTPS (for dev)

# Initialize CSRF Protection
from flask_wtf.csrf import CSRFProtect
csrf = CSRFProtect(app)

# Initialize Rate Limiting (DoS prevention)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app=app,
    key_func=get_remote_address,  # Rate limit by IP address
    storage_uri=os.getenv('REDIS_URL', 'redis://localhost:6379/0'),  # Use Redis for distributed rate limiting
    default_limits=["1000 per hour", "100 per minute"]  # Global fallback limits
)

# Flask-AppBuilder Authentication Configuration
app.config['AUTH_TYPE'] = 1  # 1 = Database authentication (email/password + OAuth)
app.config['AUTH_ROLE_ADMIN'] = 'Admin'
app.config['AUTH_ROLE_PUBLIC'] = 'Public'

# Logout redirect URL (custom setting for our logout override)
app.config['LOGOUT_REDIRECT_URL'] = '/login'

# Flask-AppBuilder UI Theme
app.config['APP_THEME'] = 'slate.css'  # Dark theme (other options: 'superhero.css', 'darkly.css', 'cyborg.css')

# Enable user self-registration
app.config['AUTH_USER_REGISTRATION'] = True
app.config['AUTH_USER_REGISTRATION_ROLE'] = 'Public'  # Default role for new users

# ReCAPTCHA configuration for development
# Using Google's test keys which always pass validation (for testing only!)
# See: https://developers.google.com/recaptcha/docs/faq#id-like-to-run-automated-tests-with-recaptcha.-what-should-i-do
app.config['RECAPTCHA_USE_SSL'] = False
app.config['RECAPTCHA_PUBLIC_KEY'] = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'  # Google test key
app.config['RECAPTCHA_PRIVATE_KEY'] = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe'  # Google test key

# OAuth configuration from environment variables
# Flask-AppBuilder automatically generates redirect URIs as: /oauth-authorized/<provider_name>
# In production: Let authlib auto-generate redirect_uri from request domain (works with all domains)
# In development: Use hardcoded localhost redirect_uri for consistency
oauth_remote_app = {
    'client_id': os.getenv('GOOGLE_CLIENT_ID'),
    'client_secret': os.getenv('GOOGLE_CLIENT_SECRET'),
    'api_base_url': 'https://www.googleapis.com/oauth2/v2/',
    'client_kwargs': {
        'scope': 'email profile',
        'prompt': 'select_account'  # Force account selection dialog
    },
    'access_token_url': 'https://accounts.google.com/o/oauth2/token',
    'authorize_url': 'https://accounts.google.com/o/oauth2/auth'
}

# OAuth redirect_uri is dynamically generated in security.py using url_for()
# This ensures the redirect matches the incoming domain (prevents session loss)
app.logger.info("OAuth: redirect_uri will be dynamically generated to match incoming request domain")

# Build Tidal OAuth config
tidal_remote_app = {
    'client_id': os.getenv('TIDAL_CLIENT_ID'),
    'client_secret': os.getenv('TIDAL_CLIENT_SECRET'),
    'api_base_url': 'https://openapi.tidal.com/',
    'client_kwargs': {
        'scope': 'user.read',
        'code_challenge_method': 'S256'  # PKCE required for OAuth 2.1
    },
    'access_token_url': 'https://auth.tidal.com/v1/oauth2/token',
    'authorize_url': 'https://login.tidal.com/authorize'
}

# Tidal doesn't allow localhost redirect URIs - production only
if IS_PRODUCTION:
    app.logger.info("Tidal OAuth production mode: authlib will auto-generate redirect_uri")
else:
    app.logger.info("Tidal OAuth: Skipping in development (no localhost support)")

app.config['OAUTH_PROVIDERS'] = [
    {
        'name': 'google',
        'icon': 'fa-google',
        'token_key': 'access_token',
        'remote_app': oauth_remote_app
    },
    {
        'name': 'tidal',
        'icon': 'fa-music',
        'token_key': 'access_token',
        'remote_app': tidal_remote_app
    }
]

# Configure log rotation
# Always log since this is a personal app running in dev environment
# Create logs directory if it doesn't exist
if not os.path.exists('logs'):
    os.mkdir('logs')

# Set up rotating file handler
file_handler = RotatingFileHandler('logs/gpr.log', maxBytes=50*1024*1024, backupCount=2)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
file_handler.setLevel(logging.DEBUG)
app.logger.addHandler(file_handler)

app.logger.setLevel(logging.DEBUG)
app.logger.info('Guitar Practice Routine App startup')

# Also enable Flask-AppBuilder debug logging
logging.getLogger('flask_appbuilder').setLevel(logging.DEBUG)

# Monkey-patch Flask's flash function to handle LazyString serialization
# This prevents Redis session serialization errors from Flask-AppBuilder's lazy_gettext messages
from flask import flash as _original_flash
import flask

def _safe_flash(message, category='message'):
    """Wrap flash messages in str() to prevent LazyString serialization issues."""
    return _original_flash(str(message), category)

# Replace Flask's flash function globally
flask.flash = _safe_flash

# Initialize Flask-AppBuilder admin interface
from app.database import SessionLocal

# Initialize admin within app context
with app.app_context():
    try:
        from app.admin import init_admin
        appbuilder = init_admin(app, SessionLocal)
        app.logger.info('Flask-AppBuilder admin interface initialized')
    except Exception as e:
        app.logger.error(f'Failed to initialize admin interface: {e}')
        import traceback
        app.logger.error(traceback.format_exc())
        # Don't fail the whole app if admin fails
        appbuilder = None

# Initialize Row-Level Security middleware
with app.app_context():
    try:
        from app.middleware.rls import init_rls_middleware
        from app.database import engine
        init_rls_middleware(app, engine)
        app.logger.info('Row-Level Security middleware initialized')
    except Exception as e:
        app.logger.error(f'Failed to initialize RLS middleware: {e}')
        import traceback
        app.logger.error(traceback.format_exc())
        # Don't fail the whole app if RLS initialization fails
        # (This allows gradual rollout during development)

from app import routes_v2 as routes