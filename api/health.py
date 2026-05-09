"""
/api/health — Health check endpoint
Vercel auto-maps this file to GET /api/health
"""
from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'version': '1.0.9'})
