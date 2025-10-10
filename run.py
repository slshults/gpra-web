from dotenv import load_dotenv
import os
from app import app
import secrets

load_dotenv()

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  

app.secret_key = secrets.token_hex(16)
app.config['OAUTH2_REDIRECT_URI'] = 'http://localhost:5000/oauth2callback'

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
