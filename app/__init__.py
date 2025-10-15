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

# Configure Flask app
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', '82a393ed5a3dbe58b0e03785215cfcb757f7d393ecde90d4ef25d6b46b28d819')
app.config['DATABASE_URL'] = os.getenv('DATABASE_URL', 'postgresql://gpra:^66*B^mzg6Y6e#@localhost:5432/gpra_dev')

# Flask-AppBuilder Authentication Configuration
app.config['AUTH_TYPE'] = 1  # 1 = Database authentication (email/password + OAuth)
app.config['AUTH_ROLE_ADMIN'] = 'Admin'
app.config['AUTH_ROLE_PUBLIC'] = 'Public'

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
app.config['OAUTH_PROVIDERS'] = [
    {
        'name': 'google',
        'icon': 'fa-google',
        'token_key': 'access_token',
        'remote_app': {
            'client_id': os.getenv('GOOGLE_CLIENT_ID'),
            'client_secret': os.getenv('GOOGLE_CLIENT_SECRET'),
            'api_base_url': 'https://www.googleapis.com/oauth2/v2/',
            'client_kwargs': {
                'scope': 'email profile'
            },
            'access_token_url': 'https://accounts.google.com/o/oauth2/token',
            'authorize_url': 'https://accounts.google.com/o/oauth2/auth',
            'redirect_uri': 'http://localhost:5000/oauth-authorized/google'
        }
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