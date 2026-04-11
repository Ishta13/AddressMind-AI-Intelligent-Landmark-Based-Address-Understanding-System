let map = L.map('map').setView([12.9716, 77.5946], 12);
let destinationMarker = null;
let customerMarker = null;
let agentMarker = null;
let routeLine = null;
let currentJobId = null;
let customerLocation = null;

const statusText = document.getElementById('jobStatus');
const customerLocationText = document.getElementById('customerLocationText');
const jobIdText = document.getElementById('jobIdText');
const feedbackStatusText = document.getElementById('feedbackStatus');
const feedbackCorrectBtn = document.getElementById('feedbackCorrect');
const feedbackWrongBtn = document.getElementById('feedbackWrong');
const etaValueText = document.getElementById('etaValue');

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function getNameFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get('name') || localStorage.getItem('addressmind_user_name') || 'Customer';
}

document.getElementById('customerName').value = getNameFromQuery();

function setFeedbackStatus(message, isError = false) {
    feedbackStatusText.innerText = message;
    feedbackStatusText.classList.remove('success-text', 'error-text');
    feedbackStatusText.classList.add(isError ? 'error-text' : 'success-text');
}

function formatDuration(seconds) {
    const mins = Math.max(1, Math.round(seconds / 60));
    if (mins < 60) {
        return `${mins} min`;
    }
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hours} hr ${rem} min` : `${hours} hr`;
}

function formatArrivalFromDuration(seconds) {
    const arrivalDate = new Date(Date.now() + seconds * 1000);
    return arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDistance(meters) {
    if (!meters && meters !== 0) {
        return null;
    }
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function setMetrics(job) {
    document.getElementById('confidenceValue').innerText = `${job.confidence}%`;
    document.getElementById('riskValue').innerText = job.delivery_risk;
    document.getElementById('clarityValue').innerText = job.clarity_label;
}

function setResult(job) {
    document.getElementById('result').classList.remove('hidden');
    document.getElementById('landmark').innerText = job.destination.landmark;
    document.getElementById('nearestMetro').innerText = job.destination.nearest_metro || 'Not available';
    document.getElementById('areaHint').innerText = job.destination.area_hint || 'Not available';
    document.getElementById('matchedLandmarks').innerText = (job.matched_landmarks || []).join(', ');
    document.getElementById('relation').innerText = job.relation;
    document.getElementById('jobStatus').innerText = job.status;
    document.getElementById('deliverySuggestion').innerText = job.delivery_suggestion;
    document.getElementById('instruction').innerText = job.instruction;

    if (job.route_eta_seconds) {
        const etaText = `${formatDuration(job.route_eta_seconds)} (arrives around ${formatArrivalFromDuration(job.route_eta_seconds)})`;
        etaValueText.innerText = etaText;
    } else {
        etaValueText.innerText = 'ETA unavailable (waiting for live agent route)';
    }

    setMetrics(job);
}

function updateMarkers(job) {
    const destination = [job.destination.latitude, job.destination.longitude];
    map.setView(destination, 14);

    if (!destinationMarker) {
        destinationMarker = L.marker(destination, { draggable: true }).addTo(map);
        destinationMarker.on('dragend', async (event) => {
            if (!currentJobId) {
                return;
            }
            const latlng = event.target.getLatLng();
            await fetch(`/api/jobs/${currentJobId}/destination-correction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude: latlng.lat, longitude: latlng.lng })
            });
        });
    } else {
        destinationMarker.setLatLng(destination);
    }

    destinationMarker.bindPopup(`<b>Destination:</b> ${job.destination.landmark}`).openPopup();

    if (job.customer_location) {
        const c = [job.customer_location.latitude, job.customer_location.longitude];
        if (!customerMarker) {
            customerMarker = L.marker(c).addTo(map).bindPopup('Customer');
        } else {
            customerMarker.setLatLng(c);
        }
    }

    if (job.agent_location) {
        const a = [job.agent_location.latitude, job.agent_location.longitude];
        if (!agentMarker) {
            agentMarker = L.marker(a).addTo(map).bindPopup('Delivery Agent');
        } else {
            agentMarker.setLatLng(a);
        }
        drawRoute(a, destination);
    }
}

async function drawRoute(fromLatLng, toLatLng) {
    if (routeLine) {
        map.removeLayer(routeLine);
    }

    try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLatLng[1]},${fromLatLng[0]};${toLatLng[1]},${toLatLng[0]}?overview=full&geometries=geojson`;
        const res = await fetch(osrmUrl);
        const data = await res.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coords = data.routes[0].geometry.coordinates.map((item) => [item[1], item[0]]);
            routeLine = L.polyline(coords, { color: '#ef4444', weight: 4 }).addTo(map);
            map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });

            if (route.duration) {
                const etaText = `${formatDuration(route.duration)} (arrives around ${formatArrivalFromDuration(route.duration)})`;
                const distanceText = formatDistance(route.distance);
                etaValueText.innerText = distanceText ? `${etaText}, ${distanceText}` : etaText;
            }
            return;
        }
    } catch (error) {
    }

    etaValueText.innerText = 'ETA unavailable (route API temporarily unavailable)';
    routeLine = L.polyline([fromLatLng, toLatLng], { color: '#ef4444', weight: 4, dashArray: '8 8' }).addTo(map);
}

async function createJob() {
    const address = document.getElementById('addressInput').value.trim();
    const customerName = document.getElementById('customerName').value.trim() || 'Customer';

    if (!address) {
        alert('Please enter address details first.');
        return;
    }

    const payload = { address, customer_name: customerName };
    if (customerLocation) {
        payload.customer_lat = customerLocation.latitude;
        payload.customer_lng = customerLocation.longitude;
    }

    const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || 'Unable to create delivery job.');
        return;
    }

    currentJobId = data.job_id;
    jobIdText.innerText = `Job created: ${currentJobId}`;
    setResult(data);
    updateMarkers(data);
    feedbackCorrectBtn.disabled = false;
    feedbackWrongBtn.disabled = false;
    setFeedbackStatus('Job created. You can now submit prediction feedback.');
}

async function refreshTracking() {
    if (!currentJobId) {
        alert('Create a job first.');
        return;
    }

    const response = await fetch(`/api/jobs/${currentJobId}`);
    const job = await response.json();
    if (!response.ok) {
        alert(job.error || 'Unable to fetch tracking status.');
        return;
    }

    setResult(job);
    updateMarkers(job);
}

async function attachCurrentLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported in this browser.');
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        customerLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
        };

        customerLocationText.innerText = `Customer location attached: ${customerLocation.latitude.toFixed(5)}, ${customerLocation.longitude.toFixed(5)}`;

        if (customerMarker) {
            customerMarker.setLatLng([customerLocation.latitude, customerLocation.longitude]);
        } else {
            customerMarker = L.marker([customerLocation.latitude, customerLocation.longitude]).addTo(map).bindPopup('Customer');
        }

        map.setView([customerLocation.latitude, customerLocation.longitude], 14);

        if (currentJobId) {
            await fetch(`/api/jobs/${currentJobId}/customer-location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(customerLocation)
            });
        }
    }, () => {
        alert('Could not detect your location. Please allow location access.');
    });
}

function enableVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Voice recognition is not supported in this browser.');
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const addressInput = document.getElementById('addressInput');
        addressInput.value = addressInput.value ? `${addressInput.value}, ${transcript}` : transcript;
    };

    recognition.start();
}

async function sendFeedback(isCorrect) {
    if (!currentJobId) {
        setFeedbackStatus('Create a job first, then submit feedback.', true);
        return;
    }

    const response = await fetch(`/api/jobs/${currentJobId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_correct: isCorrect, note: isCorrect ? 'Customer validated result' : 'Customer marked mismatch' })
    });

    const data = await response.json();
    if (!response.ok) {
        setFeedbackStatus(data.error || 'Could not save feedback. Try again.', true);
        return;
    }

    const totalFeedback = (data.job && data.job.feedback ? data.job.feedback.length : 0);
    const choice = isCorrect ? 'correct' : 'incorrect';
    setFeedbackStatus(`Feedback submitted: marked ${choice}. Total feedback records: ${totalFeedback}.`);
}

document.getElementById('analyzeBtn').addEventListener('click', createJob);
document.getElementById('geoBtn').addEventListener('click', attachCurrentLocation);
document.getElementById('voiceBtn').addEventListener('click', enableVoiceInput);
document.getElementById('refreshTrackBtn').addEventListener('click', refreshTracking);
feedbackCorrectBtn.addEventListener('click', () => sendFeedback(true));
feedbackWrongBtn.addEventListener('click', () => sendFeedback(false));

setInterval(() => {
    if (currentJobId) {
        refreshTracking();
    }
}, 7000);
