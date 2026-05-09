import requests
import json
import os

VERTEX_GENERATE_URL = "https://voicelensG1.pragyaa.ai/vertex/generate"

with open(r"c:\Users\aditya tyagi\OneDrive\Desktop\antigravity\pragyaa.ai\refined_audit_prompt_v2.txt", "r") as f:
    current_prompt = f.read()

with open(r"c:\Users\aditya tyagi\OneDrive\Desktop\antigravity\pragyaa.ai\refined_audit_prompt_v3_dc.txt", "r") as f:
    updated_prompt = f.read()

with open(r"c:\Users\aditya tyagi\OneDrive\Desktop\antigravity\pragyaa.ai\pragyaa-fresh\test_transcript.txt", "r") as f:
    transcript = f.read()

def run_audit(prompt, transcript_text):
    full_prompt = f"{prompt}\n\n[TRANSCRIPT TO AUDIT]:\n{transcript_text}"
    try:
        resp = requests.post(VERTEX_GENERATE_URL, json={"prompt": full_prompt, "model": "gemini-2.5-flash-lite"}, timeout=55)
        data = resp.json()
        return data.get("text") or data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text") or str(data)
    except Exception as e:
        return f"Error: {e}"

print("Running Current Prompt...")
res_current = run_audit(current_prompt, transcript)
print("\n--- CURRENT PROMPT RESULT ---")
print(res_current)

print("\nRunning Updated Prompt...")
res_updated = run_audit(updated_prompt, transcript)
print("\n--- UPDATED PROMPT RESULT ---")
print(res_updated)
