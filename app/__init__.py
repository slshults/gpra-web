from flask import Flask
import logging
from logging.handlers import RotatingFileHandler
import os

app = Flask(__name__, 
           static_folder='static',  # Look directly in static directory
           static_url_path='/static')    # URL prefix for static files

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
file_handler.setLevel(logging.INFO)
app.logger.addHandler(file_handler)

app.logger.setLevel(logging.INFO)
app.logger.info('Guitar Practice Routine App startup')

from app import routes_v2 as routes