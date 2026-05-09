"""
/api/vertex — Proxy to internal Vertex AI API
Vercel auto-maps this file to POST /api/vertex
"""
from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

VERTEX_GENERATE_URL   = "https://voicelensG1.pragyaa.ai/vertex/generate"
VERTEX_TRANSCRIPT_URL = "https://voicelensG1.pragyaa.ai/vertex/transcribe"

@app.after_request
def cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    return response

@app.route('/', methods=['OPTIONS'])
@app.route('/api/vertex', methods=['OPTIONS'])
def options():
    return jsonify({}), 200

@app.route('/', methods=['POST'])
@app.route('/api/vertex', methods=['POST'])
def vertex_proxy():
    try:
        data = request.get_json(force=True)
        url  = VERTEX_TRANSCRIPT_URL if 'audio' in data else VERTEX_GENERATE_URL
        resp = requests.post(url, json=data, timeout=55)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500
