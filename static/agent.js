let map = L.map('map').setView([12.9716, 77.5946], 12);
let selectedJob = null;
let agentMarker = null;
let destinationMarker = null;
let routeLine = null;
let watchId = null;

const agentStatusText = document.getElementById('agentStatusText');

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
        return '-';
    }
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function getAgentName() {
    const params = new URLSearchParams(window.location.search);
    return params.get('name') || localStorage.getItem('addressmind_user_name') || 'Agent';
}

document.getElementById('agentName').value = getAgentName();

function fillJobInfo(job) {
    document.getElementById('jobId').innerText = job.job_id;
    document.getElementById('customerName').innerText = job.customer_name;
    document.getElementById('jobAddress').innerText = job.address;
    document.getElementById('jobLandmark').innerText = job.destination.landmark;
    document.getElementById('jobNearestMetro').innerText = job.destination.nearest_metro || 'Not available';
    document.getElementById('jobAreaHint').innerText = job.destination.area_hint || 'Not available';
    document.getElementById('jobConfidence').innerText = `${job.confidence}% (${job.delivery_risk})`;
    document.getElementById('jobStatus').innerText = job.status;
    document.getElementById('jobRouteDistance').innerText = formatDistance(job.route_distance_m);

    if (job.route_eta_seconds) {
        document.getElementById('jobEta').innerText = `${formatDuration(job.route_eta_seconds)} (arrives around ${formatArrivalFromDuration(job.route_eta_seconds)})`;
    } else {
        document.getElementById('jobEta').innerText = 'ETA unavailable';
    }

    document.getElementById('jobSuggestion').innerText = job.delivery_suggestion;

    if (job.status === 'delivered') {
        stopLiveLocation('Delivery completed. Live location stopped automatically.');
    }
}

function updateMap(job) {
    const destination = [job.destination.latitude, job.destination.longitude];

    if (!destinationMarker) {
        destinationMarker = L.marker(destination).addTo(map).bindPopup(`Destination: ${job.destination.landmark}`);
    } else {
        destinationMarker.setLatLng(destination);
        destinationMarker.bindPopup(`Destination: ${job.destination.landmark}`);
    }

    if (job.agent_location) {
        const agentPos = [job.agent_location.latitude, job.agent_location.longitude];
        if (!agentMarker) {
            agentMarker = L.marker(agentPos).addTo(map).bindPopup('Agent');
        } else {
            agentMarker.setLatLng(agentPos);
        }
        drawRoute(agentPos, destination);
    }

    map.setView(destination, 14);
}

async function drawRoute(fromLatLng, toLatLng) {
    if (routeLine) {
        map.removeLayer(routeLine);
    }

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${fromLatLng[1]},${fromLatLng[0]};${toLatLng[1]},${toLatLng[0]}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coords = route.geometry.coordinates.map((item) => [item[1], item[0]]);
            routeLine = L.polyline(coords, { color: '#2563eb', weight: 4 }).addTo(map);
            map.fitBounds(routeLine.getBounds(), { padding: [22, 22] });

            if (route.duration) {
                document.getElementById('jobEta').innerText = `${formatDuration(route.duration)} (arrives around ${formatArrivalFromDuration(route.duration)})`;
            }
            if (route.distance || route.distance === 0) {
                document.getElementById('jobRouteDistance').innerText = formatDistance(route.distance);
            }

            if (selectedJob && selectedJob.job_id) {
                saveRouteStats(selectedJob.job_id, route.duration, route.distance);
            }
            return;
        }
    } catch (error) {
    }

    routeLine = L.polyline([fromLatLng, toLatLng], { color: '#2563eb', weight: 4, dashArray: '8 8' }).addTo(map);
}

async function saveRouteStats(jobId, etaSeconds, distanceMeters) {
    if (!jobId) {
        return;
    }

    try {
        await fetch(`/api/jobs/${jobId}/route-stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                route_eta_seconds: etaSeconds,
                route_distance_m: distanceMeters
            })
        });
    } catch (error) {
    }
}

async function loadJobs() {
    const response = await fetch('/api/jobs');
    const data = await response.json();
    const select = document.getElementById('jobSelect');
    select.innerHTML = '';

    if (!data.jobs || data.jobs.length === 0) {
        select.innerHTML = '<option value="">No jobs available</option>';
        return;
    }

    data.jobs.forEach((job) => {
        const option = document.createElement('option');
        option.value = job.job_id;
        option.textContent = `${job.job_id} | ${job.customer_name} | ${job.status}`;
        select.appendChild(option);
    });

    await chooseJob(select.value);
}

async function chooseJob(jobId) {
    if (!jobId) {
        return;
    }

    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();
    if (!response.ok) {
        return;
    }

    selectedJob = job;
    fillJobInfo(job);
    updateMap(job);
}

async function assignToMe() {
    if (!selectedJob) {
        alert('Select a job first.');
        return;
    }

    const agentName = document.getElementById('agentName').value.trim() || 'Agent';
    const response = await fetch(`/api/jobs/${selectedJob.job_id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agentName })
    });

    const job = await response.json();
    if (!response.ok) {
        alert(job.error || 'Could not assign job.');
        return;
    }

    selectedJob = job;
    fillJobInfo(job);
    updateMap(job);
}

async function updateStatus(status) {
    if (!selectedJob) {
        alert('Select a job first.');
        return;
    }

    const response = await fetch(`/api/jobs/${selectedJob.job_id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
    const job = await response.json();

    if (!response.ok) {
        alert(job.error || 'Could not update status.');
        return;
    }

    selectedJob = job;
    fillJobInfo(job);

    if (status === 'delivered') {
        stopLiveLocation('Delivery completed. Live location stopped automatically.');
    }
}

async function pushAgentLocation(lat, lng) {
    if (!selectedJob) {
        return;
    }

    const response = await fetch(`/api/jobs/${selectedJob.job_id}/agent-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng })
    });

    const job = await response.json();
    if (!response.ok) {
        return;
    }

    selectedJob = job;
    fillJobInfo(job);
    updateMap(job);
}

function startLiveLocation() {
    if (!selectedJob) {
        alert('Select a job first, then start live location.');
        return;
    }

    if (!navigator.geolocation) {
        alert('Geolocation is not supported in this browser.');
        return;
    }

    if (selectedJob.status === 'delivered') {
        alert('This job is already delivered. Select another active job.');
        return;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        agentStatusText.innerText = `Live location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        pushAgentLocation(lat, lng);
    }, () => {
        agentStatusText.innerText = 'Unable to read location. Enable location permission.';
    }, {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000
    });
}

function stopLiveLocation(message = 'Live location stopped.') {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    agentStatusText.innerText = message;
}

document.getElementById('loadJobsBtn').addEventListener('click', loadJobs);
document.getElementById('jobSelect').addEventListener('change', (event) => chooseJob(event.target.value));
document.getElementById('assignBtn').addEventListener('click', assignToMe);
document.getElementById('inTransitBtn').addEventListener('click', () => updateStatus('in_transit'));
document.getElementById('arrivedBtn').addEventListener('click', () => updateStatus('arrived'));
document.getElementById('deliveredBtn').addEventListener('click', () => updateStatus('delivered'));
document.getElementById('startLiveBtn').addEventListener('click', startLiveLocation);
document.getElementById('stopLiveBtn').addEventListener('click', stopLiveLocation);

loadJobs();
setInterval(loadJobs, 10000);
