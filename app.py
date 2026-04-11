from flask import Flask, jsonify, render_template, request
import pandas as pd
import re
from difflib import SequenceMatcher, get_close_matches
from datetime import datetime
from uuid import uuid4

app = Flask(__name__)

landmarks_df = pd.read_csv("landmarks.csv")

RELATION_SYNONYMS = {
    "near": ["near", "pass", "nazdeek", "nazdik", "ke paas"],
    "behind": ["behind", "peeche", "piche", "ke peeche"],
    "opposite": ["opposite", "samne", "saamne", "in front of", "ke samne", "ke saamne"],
    "next to": ["next to", "beside", "baju", "bajuwala", "adjacent"],
}

DEFAULT_RELATION = "near"
DELIVERY_JOBS = {}
PREDICTION_LOGS = []
MAX_PREDICTION_LOGS = 400


def get_eta_seconds_sync(lat1, lng1, lat2, lng2):
    """Get real ETA from OSRM routing API."""
    try:
        import requests
        url = f"https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}"
        resp = requests.get(url, timeout=5)
        data = resp.json()
        if data.get('routes'):
            return int(data['routes'][0].get('duration', 0))
    except:
        pass
    return 0


def format_duration(seconds):
    """Format seconds to human readable."""
    if seconds < 60:
        return f"{seconds}s"
    m = seconds // 60
    s = seconds % 60
    if m < 60:
        return f"{m}m {s}s"
    h = m // 60
    m = m % 60
    return f"{h}h {m}m"


def log_prediction(address, matched, landmark, confidence):
    """Log prediction for ops dashboard."""
    entry = {
        "timestamp": now_iso(),
        "address": address,
        "matched": matched,
        "landmark": landmark,
        "confidence": confidence
    }
    PREDICTION_LOGS.append(entry)
    if len(PREDICTION_LOGS) > MAX_PREDICTION_LOGS:
        PREDICTION_LOGS.pop(0)


def preprocess_text(text):
    text = text.lower().strip()
    text = re.sub(r"[^a-zA-Z0-9\s]", "", text)
    return text


def extract_relation(text):
    clean_text = preprocess_text(text)
    for canonical, terms in RELATION_SYNONYMS.items():
        for term in terms:
            if term in clean_text:
                return canonical
    return DEFAULT_RELATION


def find_landmark_candidates(address):
    address_clean = preprocess_text(address)
    landmark_names = landmarks_df["name"].tolist()
    landmark_names_clean = [preprocess_text(name) for name in landmark_names]

    exact_matches = []
    for original_name, clean_name in zip(landmark_names, landmark_names_clean):
        if clean_name and clean_name in address_clean:
            exact_matches.append(original_name)

    if exact_matches:
        return exact_matches

    possible = get_close_matches(address_clean, landmark_names_clean, n=3, cutoff=0.3)
    if not possible:
        tokens = address_clean.split()
        joined_candidates = []
        for token in tokens:
            joined_candidates.extend(get_close_matches(token, landmark_names_clean, n=2, cutoff=0.75))
        possible = list(dict.fromkeys(joined_candidates))

    resolved = []
    for item in possible:
        row = landmarks_df[landmarks_df["name"].apply(preprocess_text) == item]
        if not row.empty:
            resolved.append(row.iloc[0]["name"])

    return list(dict.fromkeys(resolved))


def find_best_landmark(address):
    candidates = find_landmark_candidates(address)
    if not candidates:
        return None

    address_clean = preprocess_text(address)

    def score(candidate_name):
        return SequenceMatcher(None, address_clean, preprocess_text(candidate_name)).ratio()

    best_name = sorted(candidates, key=score, reverse=True)[0]
    row = landmarks_df[landmarks_df["name"] == best_name].iloc[0]

    return {
        "primary": {
            "landmark": row["name"],
            "latitude": float(row["latitude"]),
            "longitude": float(row["longitude"]),
            "category": row["category"],
            "nearest_metro": row.get("nearest_metro", "Not available"),
            "area_hint": row.get("area_hint", "Not available"),
        },
        "all_matches": candidates,
    }


def generate_confidence(address, landmark_found):
    address_words = set(preprocess_text(address).split())
    landmark_words = set(preprocess_text(landmark_found).split())
    common = len(address_words.intersection(landmark_words))
    score = min(95, max(55, common * 25 + 50))
    return score


def generate_instruction(landmark, relation, confidence):
    base = (
        f"Likely destination is {relation} {landmark}. "
        f"Delivery agent should navigate to {landmark} first and then follow local landmark cues."
    )
    if confidence < 60:
        return base + " Confidence is low; call customer for confirmation before final drop."
    return base


def clarity_label(confidence):
    if confidence >= 80:
        return "High clarity"
    if confidence >= 60:
        return "Medium clarity"
    return "Low clarity"


def difficulty_tag(confidence):
    if confidence < 60:
        return "Ambiguous"
    return "Urban"


def delivery_risk(confidence):
    if confidence >= 80:
        return "Easy"
    if confidence >= 60:
        return "Medium"
    return "Hard"


def now_iso():
    return datetime.utcnow().isoformat() + "Z"


def get_job_or_404(job_id):
    job = DELIVERY_JOBS.get(job_id)
    if not job:
        return None, (jsonify({"error": "Job not found"}), 404)
    return job, None


def append_prediction_log(address, matched, confidence=0, detected_landmark=None, reason=None):
    entry = {
        "at": now_iso(),
        "address": address,
        "matched": bool(matched),
        "confidence": confidence,
        "detected_landmark": detected_landmark,
        "reason": reason,
    }
    PREDICTION_LOGS.append(entry)
    if len(PREDICTION_LOGS) > MAX_PREDICTION_LOGS:
        del PREDICTION_LOGS[0 : len(PREDICTION_LOGS) - MAX_PREDICTION_LOGS]


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/customer")
def customer_page():
    return render_template("customer.html")


@app.route("/agent")
def agent_page():
    return render_template("agent.html")


@app.route("/ops")
def ops_page():
    return render_template("ops.html")


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(silent=True) or {}
    address = data.get("address", "")

    if not address.strip():
        return jsonify({"error": "Address is required"}), 400

    relation = extract_relation(address)
    result = find_best_landmark(address)

    if not result:
        append_prediction_log(address=address, matched=False, confidence=20, reason="No reliable landmark match")
        return jsonify(
            {
                "matched": False,
                "message": "No reliable landmark match found.",
                "confidence": 20,
                "clarity_label": "Low clarity",
                "difficulty_tag": "Ambiguous",
            }
        )

    primary = result["primary"]
    confidence = generate_confidence(address, primary["landmark"])
    instruction = generate_instruction(primary["landmark"], relation, confidence)
    append_prediction_log(
        address=address,
        matched=True,
        confidence=confidence,
        detected_landmark=primary["landmark"],
    )

    return jsonify(
        {
            "matched": True,
            "input_address": address,
            "detected_landmark": primary["landmark"],
            "matched_landmarks": result["all_matches"],
            "relation": relation,
            "latitude": primary["latitude"],
            "longitude": primary["longitude"],
            "category": primary["category"],
            "nearest_metro": primary.get("nearest_metro", "Not available"),
            "area_hint": primary.get("area_hint", "Not available"),
            "confidence": confidence,
            "instruction": instruction,
            "delivery_suggestion": "Call customer" if confidence < 60 else "Proceed to landmark",
            "clarity_score": 100 - confidence + 20 if confidence < 80 else 25,
            "clarity_label": clarity_label(confidence),
            "difficulty_tag": difficulty_tag(confidence),
            "delivery_risk": delivery_risk(confidence),
        }
    )


@app.route("/api/jobs", methods=["POST"])
def create_job():
    data = request.get_json(silent=True) or {}
    address = data.get("address", "").strip()
    customer_name = data.get("customer_name", "Customer").strip() or "Customer"
    customer_lat = data.get("customer_lat")
    customer_lng = data.get("customer_lng")

    if not address:
        return jsonify({"error": "Address is required"}), 400

    relation = extract_relation(address)
    result = find_best_landmark(address)

    if not result:
        return jsonify({"error": "No reliable landmark match found for this address."}), 400

    primary = result["primary"]
    confidence = generate_confidence(address, primary["landmark"])

    job_id = uuid4().hex[:8].upper()
    job = {
        "job_id": job_id,
        "customer_name": customer_name,
        "address": address,
        "relation": relation,
        "destination": {
            "landmark": primary["landmark"],
            "latitude": primary["latitude"],
            "longitude": primary["longitude"],
            "category": primary["category"],
            "nearest_metro": primary.get("nearest_metro", "Not available"),
            "area_hint": primary.get("area_hint", "Not available"),
        },
        "matched_landmarks": result["all_matches"],
        "confidence": confidence,
        "clarity_label": clarity_label(confidence),
        "difficulty_tag": difficulty_tag(confidence),
        "delivery_risk": delivery_risk(confidence),
        "instruction": generate_instruction(primary["landmark"], relation, confidence),
        "delivery_suggestion": "Call customer" if confidence < 60 else "Proceed to landmark",
        "status": "created",
        "agent_name": None,
        "agent_location": None,
        "customer_location": {
            "latitude": float(customer_lat),
            "longitude": float(customer_lng),
        }
        if customer_lat is not None and customer_lng is not None
        else None,
        "feedback": [],
        "route_eta_seconds": None,
        "route_distance_m": None,
        "eta_updated_at": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }

    DELIVERY_JOBS[job_id] = job
    return jsonify(job), 201


@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    status = request.args.get("status", "").strip().lower()
    jobs = list(DELIVERY_JOBS.values())
    if status:
        jobs = [job for job in jobs if job.get("status", "").lower() == status]
    jobs = sorted(jobs, key=lambda item: item["created_at"], reverse=True)
    return jsonify({"count": len(jobs), "jobs": jobs})


@app.route("/api/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error
    return jsonify(job)


@app.route("/api/jobs/<job_id>/assign", methods=["POST"])
def assign_job(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    agent_name = data.get("agent_name", "Agent").strip() or "Agent"

    job["agent_name"] = agent_name
    if job["status"] == "created":
        job["status"] = "assigned"
    job["updated_at"] = now_iso()

    return jsonify(job)


@app.route("/api/jobs/<job_id>/agent-location", methods=["POST"])
def update_agent_location(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    lat = data.get("latitude")
    lng = data.get("longitude")
    route_eta_seconds = data.get("route_eta_seconds")
    route_distance_m = data.get("route_distance_m")
    if lat is None or lng is None:
        return jsonify({"error": "latitude and longitude are required"}), 400

    job["agent_location"] = {"latitude": float(lat), "longitude": float(lng)}
    if job["status"] in ["created", "assigned"]:
        job["status"] = "in_transit"

    if route_eta_seconds is not None:
        job["route_eta_seconds"] = float(route_eta_seconds)
        job["eta_updated_at"] = now_iso()
    if route_distance_m is not None:
        job["route_distance_m"] = float(route_distance_m)

    job["updated_at"] = now_iso()

    return jsonify(job)


@app.route("/api/jobs/<job_id>/status", methods=["POST"])
def update_job_status(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    status = data.get("status", "").strip().lower()
    allowed = {"created", "assigned", "in_transit", "arrived", "delivered", "issue"}
    if status not in allowed:
        return jsonify({"error": "Invalid status"}), 400

    job["status"] = status
    job["updated_at"] = now_iso()
    if status == "delivered":
        job["live_tracking_active"] = False
    return jsonify(job)


@app.route("/api/jobs/<job_id>/feedback", methods=["POST"])
def add_feedback(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    is_correct = bool(data.get("is_correct", False))
    note = data.get("note", "").strip()

    entry = {
        "is_correct": is_correct,
        "note": note,
        "at": now_iso(),
    }
    job["feedback"].append(entry)
    job["updated_at"] = now_iso()

    return jsonify({"message": "Feedback saved", "feedback": entry, "job": job})


@app.route("/api/jobs/<job_id>/destination-correction", methods=["POST"])
def destination_correction(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    lat = data.get("latitude")
    lng = data.get("longitude")
    if lat is None or lng is None:
        return jsonify({"error": "latitude and longitude are required"}), 400

    job["destination"]["latitude"] = float(lat)
    job["destination"]["longitude"] = float(lng)
    job["updated_at"] = now_iso()
    return jsonify({"message": "Destination updated", "job": job})


@app.route("/api/jobs/<job_id>/customer-location", methods=["POST"])
def customer_location(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    lat = data.get("latitude")
    lng = data.get("longitude")
    if lat is None or lng is None:
        return jsonify({"error": "latitude and longitude are required"}), 400

    job["customer_location"] = {"latitude": float(lat), "longitude": float(lng)}
    job["updated_at"] = now_iso()
    return jsonify({"message": "Customer location updated", "job": job})


@app.route("/api/jobs/<job_id>/route-stats", methods=["POST"])
def save_route_stats(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    eta_seconds = data.get("route_eta_seconds")
    distance_m = data.get("route_distance_m")

    if eta_seconds is not None:
        job["route_eta_seconds"] = int(eta_seconds)
    if distance_m is not None:
        job["route_distance_m"] = int(distance_m)

    job["updated_at"] = now_iso()
    return jsonify({"message": "Route stats saved", "job": job})


@app.route("/api/jobs/<job_id>/route-stats", methods=["POST"])
def update_route_stats(job_id):
    job, error = get_job_or_404(job_id)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    route_eta_seconds = data.get("route_eta_seconds")
    route_distance_m = data.get("route_distance_m")

    if route_eta_seconds is None and route_distance_m is None:
        return jsonify({"error": "At least one of route_eta_seconds or route_distance_m is required"}), 400

    if route_eta_seconds is not None:
        job["route_eta_seconds"] = float(route_eta_seconds)
        job["eta_updated_at"] = now_iso()
    if route_distance_m is not None:
        job["route_distance_m"] = float(route_distance_m)

    job["updated_at"] = now_iso()
    return jsonify(job)


@app.route("/api/metrics", methods=["GET"])
def metrics():
    jobs = list(DELIVERY_JOBS.values())
    total = len(jobs)
    prediction_total = len(PREDICTION_LOGS)
    prediction_failed = len([log for log in PREDICTION_LOGS if not log["matched"]])

    if total == 0:
        return jsonify(
            {
                "total_jobs": 0,
                "avg_confidence": 0,
                "delivery_success_rate": 0,
                "high_risk_jobs": 0,
                "failed_deliveries": 0,
                "prediction_total": prediction_total,
                "prediction_failure_rate": round((prediction_failed / prediction_total) * 100, 2)
                if prediction_total
                else 0,
                "status_counts": {},
            }
        )

    delivered = len([job for job in jobs if job["status"] == "delivered"])
    failed_deliveries = len([job for job in jobs if job["status"] == "issue"])
    avg_confidence = round(sum(job["confidence"] for job in jobs) / total, 2)
    high_risk = len([job for job in jobs if job["delivery_risk"] == "Hard"])
    status_counts = {}
    for job in jobs:
        key = job["status"]
        status_counts[key] = status_counts.get(key, 0) + 1

    return jsonify(
        {
            "total_jobs": total,
            "avg_confidence": avg_confidence,
            "delivery_success_rate": round((delivered / total) * 100, 2),
            "high_risk_jobs": high_risk,
            "failed_deliveries": failed_deliveries,
            "prediction_total": prediction_total,
            "prediction_failure_rate": round((prediction_failed / prediction_total) * 100, 2)
            if prediction_total
            else 0,
            "status_counts": status_counts,
        }
    )


@app.route("/api/ops-summary", methods=["GET"])
def ops_summary():
    jobs = sorted(list(DELIVERY_JOBS.values()), key=lambda item: item["updated_at"], reverse=True)
    metrics_data = metrics().get_json()
    recent_predictions = list(reversed(PREDICTION_LOGS[-40:]))
    return jsonify(
        {
            "metrics": metrics_data,
            "jobs": jobs[:80],
            "recent_prediction_logs": recent_predictions,
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
