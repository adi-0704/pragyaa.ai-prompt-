/* ═══════════════════════════════════════════════
   Pragyaa.AI — App Logic (Client-Side Excel Processing)
   Uses SheetJS (xlsx) for browser-based Excel parsing
   ═══════════════════════════════════════════════ */

// Load SheetJS from CDN
const script = document.createElement('script');
script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
document.head.appendChild(script);

// ─── State ────────────────────────────────────
let state = {
  file: null,
  audioFile: null,
  rawData: null,
  analysis: null,
  deltas: null,
  optimizedPrompt: '',
  history: [],
  engineMode: 'gemini',
};

// ─── DOM References ───────────────────────────
const $ = id => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const fileInfo = $('fileInfo');
const fileName = $('fileName');
const removeFile = $('removeFile');
const analyzeBtn = $('analyzeBtn');
const resultsSection = $('resultsSection');
const promptSection = $('promptSection');
const testSection = $('testSection');
const historySection = $('historySection');
const loadingOverlay = $('loadingOverlay');
const toast = $('toast');
const engineModeSelect = $('engineMode');

// Audio References
const audioDropzone = $('audioDropzone');
const audioInput = $('audioInput');
const audioFileInfo = $('audioFileInfo');
const audioFileName = $('audioFileName');
const runTestBtn = $('runTestBtn');
const testResults = $('testResults');
const testTranscript = $('testTranscript');
const testAudit = $('testAudit');

// ─── Event Listeners ──────────────────────────
engineModeSelect.addEventListener('change', (e) => {
  state.engineMode = e.target.value;
  if (state.engineMode === 'vertex') {
    showToast('🚀 Backend Engine selected (Cloud ID not required)');
  }
});

// ─── Upload Handlers ──────────────────────────
// Fix: Use a single robust click handler for the dropzone
dropzone.onclick = (e) => {
  console.log('Dropzone clicked');
  fileInput.click();
};

fileInput.onchange = (e) => {
  console.log('File input changed');
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
};

dropzone.ondragover = (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
};

dropzone.ondragleave = () => {
  dropzone.classList.remove('drag-over');
};

dropzone.ondrop = (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
};

function handleFile(file) {
  if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
    showToast('❌ Please upload an Excel file (.xlsx)');
    return;
  }
  state.file = file;
  fileName.textContent = file.name;
  fileInfo.style.display = 'flex';
  analyzeBtn.disabled = false;
  showToast('📊 File ready for analysis');
  console.log('File handled:', file.name);
}

removeFile.onclick = (e) => {
  e.stopPropagation();
  state.file = null;
  fileInput.value = '';
  fileInfo.style.display = 'none';
  analyzeBtn.disabled = true;
};

// ─── Audio Upload Handlers ────────────────────
audioDropzone.onclick = () => audioInput.click();
audioInput.onchange = e => { if (e.target.files[0]) handleAudioFile(e.target.files[0]); };
audioDropzone.ondragover = e => { e.preventDefault(); audioDropzone.classList.add('drag-over'); };
audioDropzone.ondragleave = () => audioDropzone.classList.remove('drag-over');
audioDropzone.ondrop = e => {
  e.preventDefault();
  audioDropzone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleAudioFile(e.dataTransfer.files[0]);
};

function handleAudioFile(file) {
  state.audioFile = file;
  audioFileName.textContent = file.name;
  audioFileInfo.style.display = 'flex';
  runTestBtn.disabled = false;
  showToast('🎵 Audio file ready for test');
}

// ─── Analysis Pipeline ────────────────────────
analyzeBtn.onclick = async () => {
  if (!state.file) return;
  showLoading('Processing...');
  
  try {
    if (state.engineMode === 'vertex') {
      updateLoader('Calling Backend API (Vertex AI)...');
      await runBackendAnalysis();
    } else {
      updateLoader('Analyzing locally...');
      await runLocalAnalysis();
    }
  } catch (err) {
    hideLoading();
    showToast('❌ Error: ' + err.message);
    console.error(err);
  }
};

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse JSON:', text.substring(0, 500));
    throw new Error(`Invalid JSON response: ${text.substring(0, 100)}...`);
  }
}

async function runBackendAnalysis() {
  const reader = new FileReader();
  const fileBase64 = await new Promise((resolve) => {
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(state.file);
  });

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_content: fileBase64,
      current_prompt: $('currentPrompt').value,
      generate_prompt: true
    })
  });

  const result = await safeJson(response);
  if (!response.ok) {
    throw new Error(result.error || `Backend error (${response.status})`);
  }

  state.analysis = result.analysis;
  state.deltas = result.deltas;
  
  if (result.optimized_prompt) {
    state.optimizedPrompt = result.optimized_prompt;
    state.promptSource = 'ai';
  } else {
    throw new Error('AI FAILED: ' + (result.vertex_status || 'Empty response'));
  }

  finalizeAnalysis();
}

async function runLocalAnalysis() {
    const data = await readExcel(state.file);
    state.rawData = data;
    updateLoader('Analyzing discrepancies...');
    
    state.analysis = analyzeRootCauses(data);
    updateLoader('Generating prompt deltas...');
    state.deltas = generateDeltas(state.analysis);
    
    const currentPrompt = $('currentPrompt').value;
    
    try {
      updateLoader('🤖 Calling Vertex AI...');
      state.optimizedPrompt = await generatePromptWithVertex(state.analysis, state.deltas, currentPrompt, 2);
      state.promptSource = 'ai';
    } catch (apiError) {
      console.error('Frontend Vertex AI failed, trying backend fallback...', apiError);
      showToast('⚠️ Direct AI call failed, trying backend...');
      try {
        updateLoader('🤖 Trying Backend Vertex AI...');
        state.optimizedPrompt = await generatePromptViaBackend(state.analysis, state.deltas, currentPrompt);
        state.promptSource = 'ai';
      } catch (backendError) {
        console.error('Backend fallback failed:', backendError);
        throw new Error('AI FAILED: ' + backendError.message);
      }
    }
    
    finalizeAnalysis();
}

async function generatePromptViaBackend(analysis, deltas, currentPrompt) {
  if (!state.file) throw new Error('No file available for backend fallback');
  
  const reader = new FileReader();
  const fileBase64 = await new Promise((resolve) => {
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(state.file);
  });

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_content: fileBase64,
      current_prompt: currentPrompt,
      generate_prompt: true
    })
  });

  const result = await safeJson(response);
  if (!response.ok) throw new Error(result.error || `Backend error (${response.status})`);
  if (!result.optimized_prompt) throw new Error(result.vertex_status || 'Empty response');
  
  return result.optimized_prompt;
}

function finalizeAnalysis() {
    state.history.push({
      timestamp: new Date().toISOString(),
      file: state.file.name,
      cases: state.analysis.summary.total,
      agreement: state.analysis.summary.agreementRate,
      falseReworks: state.analysis.summary.falseReworkCount,
      source: state.promptSource,
    });

    renderResults();
    renderPrompt();
    renderHistory();
    hideLoading();
    
    showToast(`✅ Analysis complete — 🤖 AI prompt ready`);
    
    resultsSection.style.display = 'block';
    promptSection.style.display = 'block';
    testSection.style.display = 'block';
    historySection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Live Test Pipeline ───────────────────────
runTestBtn.onclick = async () => {
  if (!state.audioFile || !state.optimizedPrompt) return;
  showLoading('Running Live Test...');
  
  try {
    updateLoader('🎙️ Transcribing audio...');
    const reader = new FileReader();
    const audioBase64 = await new Promise(r => {
      reader.onload = () => r(reader.result.split(',')[1]);
      reader.readAsDataURL(state.audioFile);
    });
    
    const transResponse = await fetch('/api/vertex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: "Transcribe this ICICI Bank sales call precisely. Include agent and customer labels.",
        audio: audioBase64,
        mime: 'audio/mpeg'
      })
    });
    
    if (!transResponse.ok) throw new Error('Transcription failed');
    const transResult = await transResponse.json();
    const transcript = transResult.text || transResult.response || "No transcript generated";
    testTranscript.textContent = transcript;
    
    updateLoader('⚖️ Auditing transcript...');
    const evalResponse = await fetch('/api/vertex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${state.optimizedPrompt}\n\n[TRANSCRIPT TO AUDIT]:\n${transcript}`,
        model: "gemini-2.5-flash-lite"
      })
    });
    
    if (!evalResponse.ok) throw new Error('Audit failed');
    const evalResult = await evalResponse.json();
    const auditText = evalResult.text || evalResult.response || "No audit result";
    testAudit.textContent = auditText;
    
    testResults.style.display = 'grid';
    testResults.scrollIntoView({ behavior: 'smooth' });
    hideLoading();
    showToast('✅ Live Test Complete');
    
  } catch (err) {
    hideLoading();
    showToast('❌ Test Error: ' + err.message);
    console.error(err);
  }
};

// ─── Excel Reader ─────────────────────────────
async function readExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheetName = wb.SheetNames.includes('Raw Data') ? 'Raw Data' : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        resolve(json);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Root Cause Analyzer ──────────────────────
function analyzeRootCauses(data) {
  const norm = v => String(v || '').trim().toLowerCase();
  const total = data.length;
  
  const aiCol = Object.keys(data[0]).find(k => k.includes('Call Status AI')) || 'Call Status AI';
  const verCol = Object.keys(data[0]).find(k => k.includes('Call Status Verifier')) || 'Call Status Verifier';
  
  let agree = 0, falseRework = [], falseApprove = [];
  data.forEach(row => {
    const ai = norm(row[aiCol]);
    const ver = norm(row[verCol]);
    if (ai === ver) agree++;
    else if (ai === 'rework' && ver === 'approved') falseRework.push(row);
    else if (ai === 'approved' && (ver === 'rework')) falseApprove.push(row);
  });
  
  const params = [
    'Greeting Met', 'Benefits Explained Met', 'Charges Explained Met',
    'Pitch Modulation', 'Pitch Pace', 'Tone Appropriate Met',
    'Consent Taken Met', 'Card Variant Met'
  ];
  
  const paramFailures = {};
  params.forEach(p => {
    const col = Object.keys(data[0]).find(k => k.includes(p));
    if (!col) return;
    const fails = falseRework.filter(r => norm(r[col]) === 'no').length;
    paramFailures[p] = { count: fails, pct: Math.round(fails / (falseRework.length || 1) * 1000) / 10 };
  });
  
  const consentReasonCol = Object.keys(data[0]).find(k => k.includes('Consent Taken Reasons')) || '';
  const consentFails = falseRework.filter(r => norm(r['Consent Taken Met']) === 'no');
  const consentPatterns = {
    'Passive Okay/Haan': 0, 'No Explicit Ask': 0,
    'Ji/Hmm Backchannel': 0, 'Premature/Rushed': 0
  };
  consentFails.forEach(r => {
    const reason = norm(r[consentReasonCol] || '');
    if (['passive', 'okay', "'ok'", 'haan', 'acknowledgm'].some(k => reason.includes(k))) consentPatterns['Passive Okay/Haan']++;
    if (['not explicitly', 'did not', 'without'].some(k => reason.includes(k))) consentPatterns['No Explicit Ask']++;
    if (["'ji'", 'hmm', 'backchannel'].some(k => reason.includes(k))) consentPatterns['Ji/Hmm Backchannel']++;
    if (['rushed', 'before'].some(k => reason.includes(k))) consentPatterns['Premature/Rushed']++;
  });
  
  const chargesReasonCol = Object.keys(data[0]).find(k => k.includes('Charges Explained Reasons')) || '';
  const chargesFails = falseRework.filter(r => norm(r['Charges Explained Met']) === 'no');
  const chargesPatterns = {
    'Rushed Delivery': 0, 'Confusing/Unclear': 0,
    'Missing GST': 0, 'Wrong Amounts': 0
  };
  chargesFails.forEach(r => {
    const reason = norm(r[chargesReasonCol] || '');
    if (['rushed', 'fast', 'quickly'].some(k => reason.includes(k))) chargesPatterns['Rushed Delivery']++;
    if (['confus', 'unclear', 'not clear'].some(k => reason.includes(k))) chargesPatterns['Confusing/Unclear']++;
    if (reason.includes('gst')) chargesPatterns['Missing GST']++;
    if (['incorrect', 'wrong'].some(k => reason.includes(k))) chargesPatterns['Wrong Amounts']++;
  });
  
  const reworkReasonCol = Object.keys(data[0]).find(k => k.includes('Reason for Rework'));
  const faReasons = falseApprove.map(r => r[reworkReasonCol]).filter(Boolean);
  
  return {
    summary: {
      total, agree, agreementRate: Math.round(agree / total * 1000) / 10,
      aiApprovalRate: Math.round(data.filter(r => norm(r[aiCol]) === 'approved').length / total * 1000) / 10,
      verApprovalRate: Math.round(data.filter(r => norm(r[verCol]) === 'approved').length / total * 1000) / 10,
      falseReworkCount: falseRework.length,
      falseApproveCount: falseApprove.length,
    },
    paramFailures, consentPatterns, chargesPatterns, faReasons,
  };
}

function generateDeltas(analysis) {
  const deltas = [];
  const pf = analysis.paramFailures;
  const sorted = Object.entries(pf).sort((a, b) => b[1].pct - a[1].pct);
  sorted.forEach(([param, info]) => {
    if (info.pct < 5) return;
    const severity = info.pct > 50 ? 'CRITICAL' : info.pct > 20 ? 'HIGH' : 'MEDIUM';
    let rootCause = '', fix = '';
    if (param === 'Consent Taken Met') {
      rootCause = 'AI rejects passive Hindi consent ("Okay", "Haan ji", "Theek hai")';
      fix = 'Implement 3-Tier consent: Tier 1 (explicit), Tier 2 (contextual — valid after full pitch), Tier 3 (refusal only)';
    } else if (param === 'Charges Explained Met') {
      rootCause = 'AI penalizes delivery speed instead of factual accuracy';
      fix = 'Switch to content-based evaluation — pass if ₹699+GST stated correctly regardless of pace';
    } else if (param === 'Pitch Pace') {
      rootCause = 'AI pace threshold stricter than human verifier tolerance';
      fix = 'Only fail if customer explicitly asks to repeat or slow down';
    } else if (param === 'Benefits Explained Met') {
      rootCause = 'AI requires too many benefits to be mentioned';
      fix = 'Pass if agent mentions ≥2 core benefits accurately';
    } else if (param === 'Card Variant Met') {
      rootCause = 'AI fails on informal card name variations';
      fix = 'Add fuzzy mapping: "Coral card"/"Updated Coral"/"Coral Visa" → Coral Debit Card';
    } else {
      rootCause = `AI too strict on ${param}`;
      fix = `Align ${param} threshold with human verifier standards`;
    }
    deltas.push({ param, ...info, severity, rootCause, fix });
  });
  return deltas;
}

async function generatePromptWithVertex(analysis, deltas, currentPrompt, maxRetries = 1) {
  const s = analysis.summary;
  const metaPrompt = `You are an expert prompt engineer specializing in compliance audit automation.
I have analyzed ${s.total} audits. AI Approval: ${s.aiApprovalRate}% | Verifier Approval: ${s.verApprovalRate}%
Agreement: ${s.agreementRate}%. TOP FAILURES:
${deltas.map(d => `- ${d.param}: ${d.pct}% failure rate | Fix: ${d.fix}`).join('\n')}

TASK: Write a compliance audit prompt that matches human judgment. Use 3-tier consent and content-based charges (₹699+GST).
Output ONLY the audit prompt content.`;

  const VERTEX_GENERATE_URL = '/api/vertex';
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(VERTEX_GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: metaPrompt, model: "gemini-2.5-flash-lite" })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Vertex AI error (${response.status}): ${errText.substring(0, 100)}`);
      }
      const result = await response.json();
      let text = result.text || result.response || result.content || result.generated_text || result.result || result.data ||
                 result.candidates?.[0]?.content?.parts?.[0]?.text || 
                 (typeof result === 'string' ? result : null);
      if (typeof text === 'object' && text !== null) text = JSON.stringify(text);
      if (!text && result.candidates?.[0]?.output) text = result.candidates[0].output;
      if (!text) throw new Error('Vertex AI returned empty response');
      return `# AI-GENERATED PROMPT — Vertex AI\n# Generated: ${new Date().toLocaleString()}\n\n${text}`;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) await sleep(1500);
    }
  }
  throw lastError;
}

function buildTemplatePrompt(analysis, deltas, currentPrompt) {
  return "/* RECOVERY TEMPLATE */";
}

function renderResults() {
  const s = state.analysis.summary;
  const gap = Math.round((s.verApprovalRate - s.aiApprovalRate) * 10) / 10;
  $('statsGrid').innerHTML = [
    { value: s.total, label: 'Total Cases', cls: '' },
    { value: s.agreementRate + '%', label: 'Agreement', cls: s.agreementRate > 70 ? 'success' : 'danger' },
    { value: s.aiApprovalRate + '%', label: 'AI Approval', cls: '' },
    { value: s.verApprovalRate + '%', label: 'Verifier Approval', cls: 'success' },
    { value: s.falseReworkCount, label: 'False Reworks', cls: 'danger' },
    { value: gap + '%', label: 'Approval Gap', cls: 'danger' },
  ].map(s => `<div class="stat-card"><div class="stat-value ${s.cls}">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');
  const sorted = Object.entries(state.analysis.paramFailures).sort((a, b) => b[1].pct - a[1].pct);
  $('failureBars').innerHTML = sorted.map(([param, info]) => {
    const cls = info.pct > 50 ? 'critical' : info.pct > 20 ? 'high' : 'medium';
    return `<div class="failure-row"><div class="failure-label">${param.replace(' Met', '')}</div><div class="failure-bar-bg"><div class="failure-bar ${cls}" style="width: ${info.pct}%"></div></div><div class="failure-pct">${info.pct}%</div></div>`;
  }).join('');
  $('patternsGrid').innerHTML = `<div class="pattern-box"><h4>🔒 Consent Patterns</h4>${Object.entries(state.analysis.consentPatterns).map(([k, v]) => `<div class="pattern-item"><span>${k}</span><span>${v}</span></div>`).join('')}</div><div class="pattern-box"><h4>💰 Charges Patterns</h4>${Object.entries(state.analysis.chargesPatterns).map(([k, v]) => `<div class="pattern-item"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
}

function renderPrompt() {
  const badge = '<span class="ai-badge">🤖 Vertex AI</span>';
  $('promptSection').querySelector('h2').innerHTML = 'Optimized Prompt ' + badge;
  $('optimizedPrompt').textContent = state.optimizedPrompt;
}

function renderHistory() {
  $('timeline').innerHTML = state.history.map((h, i) => `<div class="timeline-item"><div class="timeline-date">${new Date(h.timestamp).toLocaleString()}</div><div class="timeline-content"><strong>Run #${i + 1}:</strong> ${h.file}</div></div>`).join('');
}

function showLoading(text) { loadingOverlay.style.display = 'flex'; $('loaderSub').textContent = text; }
function updateLoader(text) { $('loaderSub').textContent = text; }
function hideLoading() { loadingOverlay.style.display = 'none'; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
