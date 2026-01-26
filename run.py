from dotenv import load_dotenv
import os
from app import app
import secrets

load_dotenv()

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# Use SECRET_KEY from .env for consistent token generation/validation
# Only fall back to random key if .env doesn't have one
if not os.getenv('SECRET_KEY'):
    app.secret_key = secrets.token_hex(16)
# Note: SECRET_KEY from .env is already loaded in app/__init__.py

app.config['OAUTH2_REDIRECT_URI'] = 'http://localhost:5000/oauth2callback'

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
