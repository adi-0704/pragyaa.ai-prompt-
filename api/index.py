"""
Pragyaa.AI — Prompt Evolution Engine Backend
Version: 1.0.9
Vercel Serverless Function (Python)
"""

from flask import Flask, request, jsonify
import pandas as pd
import io
import base64
import json
import requests

app = Flask(__name__)

VERTEX_GENERATE_URL = "https://voicelensG1.pragyaa.ai/vertex/generate"
VERTEX_TRANSCRIPT_URL = "https://voicelensG1.pragyaa.ai/vertex/transcribe"
DEFAULT_MODEL = "gemini-2.5-flash-lite"

# ─── CORS ─────────────────────────────────────────────────────────────────────
@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

@app.route('/api/analyze', methods=['OPTIONS'])
@app.route('/api/vertex', methods=['OPTIONS'])
@app.route('/api/health', methods=['OPTIONS'])
def options_handler():
    return jsonify({}), 200

# ─── Helpers ──────────────────────────────────────────────────────────────────
def preprocess_df(df):
    ai_col  = next((c for c in df.columns if 'Call Status AI' in str(c)), None)
    ver_col = next((c for c in df.columns if 'Call Status Verifier' in str(c)), None)
    if not ai_col or not ver_col:
        raise ValueError(f"Missing status columns. Found: {list(df.columns)[:10]}")
    df['ai_norm']  = df[ai_col].astype(str).str.strip().str.lower()
    df['ver_norm'] = df[ver_col].astype(str).str.strip().str.lower()
    return df, ai_col, ver_col

def analyze_root_causes(df, ai_col, ver_col):
    total = len(df)
    agree = int((df['ai_norm'] == df['ver_norm']).sum())
    fr = df[(df['ai_norm'] == 'rework')   & (df['ver_norm'] == 'approved')]
    fa = df[(df['ai_norm'] == 'approved') & (df['ver_norm'] == 'rework')]
    fr_len = max(len(fr), 1)

    params = ['Greeting Met','Benefits Explained Met','Charges Explained Met',
              'Pitch Modulation','Pitch Pace','Tone Appropriate Met',
              'Consent Taken Met','Card Variant Met']
    param_failures = {}
    for p in params:
        col = next((c for c in df.columns if p in str(c)), None)
        if not col: continue
        fails = int((fr[col].astype(str).str.strip().str.lower() == 'no').sum())
        param_failures[p] = {'count': fails, 'pct': round(fails / fr_len * 100, 1)}

    # Consent patterns
    c_met = next((c for c in df.columns if 'Consent Taken Met' in str(c)), None)
    c_rsn = next((c for c in df.columns if 'Consent Taken Reasons' in str(c)), None)
    c_fails = fr[fr[c_met].astype(str).str.strip().str.lower() == 'no'] if c_met else pd.DataFrame()
    cp = {'Passive Okay/Haan': 0, 'No Explicit Ask': 0, 'Ji/Hmm Backchannel': 0, 'Premature/Rushed': 0}
    if c_rsn and not c_fails.empty:
        for _, row in c_fails.iterrows():
            r = str(row.get(c_rsn, '')).strip().lower()
            if any(k in r for k in ['passive','okay','haan','acknowledgm']): cp['Passive Okay/Haan'] += 1
            if any(k in r for k in ['not explicitly','did not','without']):   cp['No Explicit Ask'] += 1
            if any(k in r for k in ['ji','hmm','backchannel']):               cp['Ji/Hmm Backchannel'] += 1
            if any(k in r for k in ['rushed','before']):                      cp['Premature/Rushed'] += 1

    # Charges patterns
    ch_met = next((c for c in df.columns if 'Charges Explained Met' in str(c)), None)
    ch_rsn = next((c for c in df.columns if 'Charges Explained Reasons' in str(c)), None)
    ch_fails = fr[fr[ch_met].astype(str).str.strip().str.lower() == 'no'] if ch_met else pd.DataFrame()
    chp = {'Rushed Delivery': 0, 'Confusing/Unclear': 0, 'Missing GST': 0, 'Wrong Amounts': 0}
    if ch_rsn and not ch_fails.empty:
        for _, row in ch_fails.iterrows():
            r = str(row.get(ch_rsn, '')).strip().lower()
            if any(k in r for k in ['rushed','fast','quickly']): chp['Rushed Delivery'] += 1
            if any(k in r for k in ['confus','unclear']):        chp['Confusing/Unclear'] += 1
            if 'gst' in r:                                       chp['Missing GST'] += 1
            if any(k in r for k in ['incorrect','wrong']):       chp['Wrong Amounts'] += 1

    rw_col = next((c for c in df.columns if 'Reason for Rework' in str(c)), None)
    fa_reasons = list(fa[rw_col].dropna().astype(str).values) if rw_col else []

    ai_app  = int((df['ai_norm']  == 'approved').sum())
    ver_app = int((df['ver_norm'] == 'approved').sum())
    return {
        'summary': {
            'total_cases': total,
            'agreement_rate': round(agree / total * 100, 1),
            'ai_approval_rate': round(ai_app / total * 100, 1),
            'verifier_approval_rate': round(ver_app / total * 100, 1),
            'false_rework_count': len(fr),
            'false_approve_count': len(fa),
            'gap': round((ver_app - ai_app) / total * 100, 1)
        },
        'false_rework': {
            'param_failures': param_failures,
            'patterns': {'consent': cp, 'charges': chp}
        },
        'false_approve': {'reasons': fa_reasons}
    }

def generate_prompt_deltas(analysis):
    pf = analysis['false_rework']['param_failures']
    deltas = []
    for param, info in sorted(pf.items(), key=lambda x: x[1]['pct'], reverse=True):
        if info['pct'] < 5: continue
        severity = 'CRITICAL' if info['pct'] > 50 else ('HIGH' if info['pct'] > 20 else 'MEDIUM')
        fixes = {
            'Consent Taken Met':     ('AI rejects passive Hindi consent (Okay/Haan ji/Theek hai)',
                                      '3-Tier consent: Tier1 explicit, Tier2 contextual after full pitch, Tier3 refusal only'),
            'Charges Explained Met': ('AI penalizes delivery speed not factual accuracy',
                                      'Content-based eval — pass if ₹699+GST stated correctly regardless of pace'),
            'Pitch Pace':            ('AI pace threshold stricter than human tolerance',
                                      'Only fail if customer explicitly asks to repeat/slow down'),
            'Benefits Explained Met':('AI requires too many benefits mentioned',
                                      'Pass if agent mentions ≥2 core benefits accurately'),
            'Card Variant Met':      ('AI fails on informal card name variants',
                                      'Fuzzy match: "Coral card"/"Updated Coral" → Coral Debit Card'),
        }
        rc, fix = fixes.get(param, (f'AI too strict on {param}', f'Align {param} with human verifier standards'))
        deltas.append({'param': param, **info, 'severity': severity, 'rootCause': rc, 'fix': fix})
    return deltas

def compare_prompt_with_data(current_prompt, deltas):
    pl = current_prompt.lower()
    covered = [d['param'] for d in deltas if any(k in pl for k in d['param'].lower().split())]
    gaps    = [d['param'] for d in deltas if d['param'] not in covered]
    return {'covered': covered, 'gaps': gaps,
            'coverage_pct': round(len(covered) / max(len(deltas), 1) * 100, 1)}

def call_vertex_api(prompt_text):
    resp = requests.post(VERTEX_GENERATE_URL,
                         json={'prompt': prompt_text, 'model': DEFAULT_MODEL},
                         timeout=55)
    resp.raise_for_status()
    data = resp.json()
    text = (data.get('text') or data.get('response') or data.get('content') or
            data.get('generated_text') or data.get('result') or data.get('output') or
            (data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text')) or
            (data.get('candidates', [{}])[0].get('output')) or
            (data.get('candidates', [{}])[0].get('text')))
    if isinstance(text, dict): text = json.dumps(text)
    return text

def evolve_prompt_vertex(analysis, deltas, current_prompt):
    s = analysis['summary']
    meta = f"""You are an expert prompt engineer for ICICI Bank Debit Card upgrade call compliance auditing.

ANALYSIS ({s['total_cases']} audits):
- AI Approval: {s['ai_approval_rate']}% | Human Verifier Approval: {s['verifier_approval_rate']}%
- Agreement Rate: {s['agreement_rate']}% | False Reworks: {s['false_rework_count']}

TOP FAILURE CAUSES:
{chr(10).join(f"  [{d['severity']}] {d['param']}: {d['pct']}% | {d['rootCause']} → FIX: {d['fix']}" for d in deltas)}

CONSENT PATTERNS (where AI fails): {json.dumps(analysis['false_rework']['patterns']['consent'])}
CHARGES PATTERNS (where AI fails): {json.dumps(analysis['false_rework']['patterns']['charges'])}

CURRENT PROMPT TO IMPROVE:
{current_prompt[:2000] or '(none provided)'}

TASK: Write a production-ready compliance audit prompt that:
1. Implements 3-Tier Hindi consent (Tier1 explicit, Tier2 contextual after full pitch, Tier3 refusal only)
2. Uses content-based charge validation (pass if ₹699+GST stated — pace irrelevant)
3. Fuzzy card variant matching for Coral Debit Card variants
4. Only fails Pitch Pace if customer explicitly requests clarification
5. Aligns ALL thresholds with the human verifier data above

Output ONLY the final audit prompt. No preamble, no explanations."""
    return call_vertex_api(meta)

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'version': '1.0.9'})

@app.route('/api/analyze', methods=['POST'])
@app.route('/analyze', methods=['POST'])
def analyze():
    try:
        data = request.get_json(force=True)
        b64  = data.get('file_content')
        if not b64:
            return jsonify({'error': 'No file content provided'}), 400

        df = pd.read_excel(io.BytesIO(base64.b64decode(b64)), sheet_name=0)
        df, ai_col, ver_col = preprocess_df(df)

        analysis  = analyze_root_causes(df, ai_col, ver_col)
        deltas    = generate_prompt_deltas(analysis)
        coverage  = compare_prompt_with_data(data.get('current_prompt', ''), deltas)

        optimized_prompt = None
        vertex_status    = 'Not requested'
        if data.get('generate_prompt'):
            try:
                optimized_prompt = evolve_prompt_vertex(analysis, deltas, data.get('current_prompt', ''))
                vertex_status = 'success' if optimized_prompt else 'Empty response'
            except Exception as e:
                vertex_status = f'API Error: {e}'

        return jsonify({
            'status': 'success',
            'analysis': {
                'summary': {
                    'total':            analysis['summary']['total_cases'],
                    'agreementRate':    analysis['summary']['agreement_rate'],
                    'aiApprovalRate':   analysis['summary']['ai_approval_rate'],
                    'verApprovalRate':  analysis['summary']['verifier_approval_rate'],
                    'falseReworkCount': analysis['summary']['false_rework_count'],
                    'falseApproveCount':analysis['summary']['false_approve_count'],
                    'gap':              analysis['summary']['gap'],
                },
                'paramFailures':    analysis['false_rework']['param_failures'],
                'consentPatterns':  analysis['false_rework']['patterns']['consent'],
                'chargesPatterns':  analysis['false_rework']['patterns']['charges'],
                'faReasons':        analysis['false_approve']['reasons'],
            },
            'deltas':           deltas,
            'coverage':         coverage,
            'vertex_status':    vertex_status,
            'optimized_prompt': optimized_prompt,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/vertex', methods=['POST'])
@app.route('/vertex', methods=['POST'])
def vertex_proxy():
    try:
        data = request.get_json(force=True)
        url  = VERTEX_TRANSCRIPT_URL if 'audio' in data else VERTEX_GENERATE_URL
        resp = requests.post(url, json=data, timeout=55)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
