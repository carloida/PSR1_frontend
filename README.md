# PSR1 Frontend

Frontend UI for the PSR1 semiconductor equipment FDC prototype.

This interface is intentionally separate from the main `carloida/PSR1` backend repository. It presents PSR1 as a real-time PM1 sensor anomaly detection and explanation console:

- load PM1 CSV/XLSX data or draft a future database source profile;
- run the backend pipeline sequence from the UI;
- inspect 5-minute step-aware anomaly windows;
- review SPC/statistical pseudo-label evidence;
- compare clean ML anomaly model outputs;
- browse generated plots and output files;
- use a deterministic-first inference agent that can optionally call OpenAI from a server-side API route for concise synthesis.

Important framing: PSR1 is not yet a confirmed fault-code classifier because true fault labels are missing. The current prototype is best described as a real-time sensor anomaly detection and explanation system for engineering review.

## Local Development

```bash
npm install
npm run dev
```

The frontend defaults to:

```text
http://127.0.0.1:5175
```

By default it calls the local companion API at:

```text
http://127.0.0.1:8002
```

Set `VITE_API_BASE_URL` if the backend is running somewhere else.

On Windows, `Start-PSR1-Frontend.ps1` starts the frontend server on port `5175` and opens the browser. A Desktop shortcut can point to this script so the UI can be opened without starting Codex.

## Inference Agent Secrets

Never put API keys in `src/` or any browser-visible code. For local work, put secrets in ignored env files such as:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-terra
OPENAI_MAX_OUTPUT_TOKENS=420
OPENAI_REASONING_EFFORT=low
```

For Vercel, add the same names in Project Settings -> Environment Variables. The frontend sends a compact case file to `/api/agent`; the serverless route reads `OPENAI_API_KEY` from the server environment and calls OpenAI only after the deterministic troubleshooting answer is already generated.

## Build

```bash
npm run build
```

## Backend Context

The backend logic lives in:

```text
https://github.com/carloida/PSR1
```

The updated project flow includes SPC pseudo-labeling, clean feature engineering, leakage-safe ML anomaly modeling, real-time sensor-window prediction, deterministic anomaly explanations, and an optional economical AI synthesis layer.
