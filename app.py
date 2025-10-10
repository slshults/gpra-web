from flask import Flask, render_template
from flask_cors import CORS

app = Flask(__name__, static_url_path='/static')
CORS(app) 