# AddressMind AI

AddressMind AI is a role-based last-mile delivery assistant that turns messy landmark-style addresses into actionable delivery jobs with live customer-agent tracking.

## What’s New

- Login landing page with role selection (Customer / Delivery Agent)
- Customer dashboard to submit address, create a delivery job, and track agent live
- Delivery agent dashboard to receive jobs, share current location, and follow route path
- Multilingual relation extraction support (English + Hinglish style terms)
- Explainable prediction output: landmark matches, relation, confidence, risk, guidance
- Map-assisted correction (customer can drag destination marker and update destination)
- Feedback loop (`Prediction Correct` / `Prediction Incorrect`)
- Offline-lite PWA support (service worker + manifest)

## Tech Stack

- Backend: Flask (Python)
- Data Processing: Pandas + fuzzy matching logic
- Frontend: HTML, CSS, JavaScript
- Maps: Leaflet + OpenStreetMap tiles
- Route Visualization: OSRM public routing API (fallback to direct polyline)

## Project Structure

```text
addressmind-ai/
├── app.py
├── landmarks.csv
├── requirements.txt
├── README.md
├── templates/
│   ├── index.html
│   ├── customer.html
│   └── agent.html
└── static/
    ├── style.css
    ├── script.js
    ├── customer.js
    ├── agent.js
    ├── manifest.json
    └── sw.js
```

## Quick Start (Windows PowerShell)

```powershell
cd C:\Users\Ishta\addressmind-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open: `http://127.0.0.1:5000`

## Demo Flow (Two Tabs)

1. Open `http://127.0.0.1:5000` in **Tab 1** and continue as **Customer**.
2. Open `http://127.0.0.1:5000` in **Tab 2** and continue as **Delivery Agent**.
3. Customer creates a job from natural-language address.
4. Agent loads jobs, assigns a job, starts live location, and updates status.
5. Customer refreshes tracking to see live agent movement and route.

## Demo Inputs

1. `House behind Ganesh Temple, near Old Bus Stand`
2. `Ghar mandir ke peeche, metro ke samne`
3. `Beside Apollo Pharmacy near Government School`

## API Overview

- `POST /predict` - Analyze raw address and return landmark intelligence
- `POST /api/jobs` - Create delivery job from customer input
- `GET /api/jobs` - List jobs
- `GET /api/jobs/<job_id>` - Track a specific job
- `POST /api/jobs/<job_id>/assign` - Assign job to agent
- `POST /api/jobs/<job_id>/agent-location` - Update agent location
- `POST /api/jobs/<job_id>/status` - Update status (`in_transit`, `arrived`, `delivered`)
- `POST /api/jobs/<job_id>/destination-correction` - Correct destination via map drag
- `POST /api/jobs/<job_id>/customer-location` - Attach/update customer location
- `POST /api/jobs/<job_id>/feedback` - Submit prediction feedback
- `GET /api/metrics` - Aggregated hackathon demo metrics

## Hackathon Pitch Snapshot

“AddressMind AI helps delivery teams decode real-world landmark addresses in local language style, assign jobs instantly, and track delivery progress in real time with confidence-aware fallback decisions ."
