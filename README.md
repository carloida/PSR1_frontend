# PSR1 Frontend

Frontend UI for the PSR1 semiconductor equipment FDC prototype.

This interface is intentionally separate from the main `carloida/PSR1` backend repository. It presents PSR1 as a real-time PM1 sensor anomaly detection and explanation console:

- load PM1 CSV/XLSX data or draft a future database source profile;
- run the backend pipeline sequence from the UI;
- inspect 5-minute step-aware anomaly windows;
- review SPC/statistical pseudo-label evidence;
- compare clean ML anomaly model outputs;
- browse generated plots and output files;
- use a token-free deterministic inference-agent placeholder for engineering review.

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

## Build

```bash
npm run build
```

## Backend Context

The backend logic lives in:

```text
https://github.com/carloida/PSR1
```

The updated project flow includes SPC pseudo-labeling, clean feature engineering, leakage-safe ML anomaly modeling, real-time sensor-window prediction, and deterministic anomaly explanations that can later be extended with an explicit LLM layer.
