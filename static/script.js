let map = L.map('map').setView([12.9716, 77.5946], 13);
let marker = null;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

async function analyzeAddress() {
    const address = document.getElementById('addressInput').value;

    if (!address.trim()) {
        alert('Please enter an address');
        return;
    }

    const response = await fetch('/predict', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address: address })
    });

    const data = await response.json();

    if (!data.matched) {
        alert(data.message || 'No match found');
        return;
    }

    document.getElementById('result').classList.remove('hidden');
    document.getElementById('landmark').innerText = data.detected_landmark;
    document.getElementById('matchedLandmarks').innerText = (data.matched_landmarks || []).join(', ');
    document.getElementById('relation').innerText = data.relation;
    document.getElementById('category').innerText = data.category;
    document.getElementById('confidence').innerText = data.confidence;
    document.getElementById('clarity').innerText = data.clarity_score;
    document.getElementById('clarityLabel').innerText = data.clarity_label;
    document.getElementById('difficultyTag').innerText = data.difficulty_tag;
    document.getElementById('deliverySuggestion').innerText = data.delivery_suggestion;
    document.getElementById('instruction').innerText = data.instruction;

    map.setView([data.latitude, data.longitude], 15);

    if (marker) {
        map.removeLayer(marker);
    }

    marker = L.marker([data.latitude, data.longitude])
        .addTo(map)
        .bindPopup(`<b>${data.detected_landmark}</b><br>${data.instruction}`)
        .openPopup();
}
