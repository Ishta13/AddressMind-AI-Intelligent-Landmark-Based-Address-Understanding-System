let statusChart = null;
let confidenceChart = null;

async function loadOpsData() {
    const response = await fetch('/api/ops-summary');
    const data = await response.json();
    if (!response.ok) return;

    const metrics = data.metrics;
    const jobs = data.jobs || [];
    const logs = data.recent_prediction_logs || [];

    document.getElementById('totalJobs').innerText = metrics.total_jobs;
    document.getElementById('successRate').innerText = `${metrics.delivery_success_rate}%`;
    document.getElementById('avgConfidence').innerText = `${metrics.avg_confidence}%`;
    document.getElementById('failedDeliveries').innerText = metrics.failed_deliveries;
    document.getElementById('highRiskJobs').innerText = metrics.high_risk_jobs;

    const predAccuracy = 100 - metrics.prediction_failure_rate;
    document.getElementById('predictionAccuracy').innerText = `${predAccuracy.toFixed(1)}%`;

    updateStatusChart(metrics.status_counts);
    updateConfidenceChart(jobs);
    updateLogs(logs);
    updateJobsList(jobs);
}

function updateStatusChart(statusCounts) {
    const ctx = document.getElementById('statusChart').getContext('2d');
    const labels = Object.keys(statusCounts);
    const data = Object.values(statusCounts);

    if (statusChart) {
        statusChart.data.labels = labels;
        statusChart.data.datasets[0].data = data;
        statusChart.update();
    } else {
        statusChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#2563eb', '#16a34a', '#f97316', '#dc2626', '#8b5cf6', '#06b6d4'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }
}

function updateConfidenceChart(jobs) {
    const confidences = jobs.map(j => j.confidence);
    const ranges = {
        'Very High (80-100)': confidences.filter(c => c >= 80).length,
        'High (60-79)': confidences.filter(c => c >= 60 && c < 80).length,
        'Medium (40-59)': confidences.filter(c => c >= 40 && c < 60).length,
        'Low (<40)': confidences.filter(c => c < 40).length
    };

    const ctx = document.getElementById('confidenceChart').getContext('2d');
    if (confidenceChart) {
        confidenceChart.data.datasets[0].data = Object.values(ranges);
        confidenceChart.update();
    } else {
        confidenceChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(ranges),
                datasets: [{
                    label: 'Jobs by Confidence',
                    data: Object.values(ranges),
                    backgroundColor: '#2563eb'
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }
}

function updateLogs(logs) {
    const container = document.getElementById('logsContainer');
    if (logs.length === 0) {
        container.innerHTML = '<p class="muted">No prediction logs yet.</p>';
        return;
    }

    let html = '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
    html += '<tr style="border-bottom:1px solid #ddd; background:#f8fbff;"><th style="padding:8px; text-align:left;">Time</th><th>Address (truncated)</th><th>Landmark</th><th>Confidence</th><th>Status</th></tr>';

    logs.forEach(log => {
        const addr = (log.address || '').substring(0, 30) + '...';
        const landmark = (log.landmark || 'N/A').substring(0, 25) + '...';
        const status = log.matched ? '<span style="color:green;">✓ Matched</span>' : '<span style="color:red;">✗ No Match</span>';
        html += `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px;">${log.timestamp.substring(11, 19)}</td>
            <td>${addr}</td>
            <td>${landmark}</td>
            <td>${log.confidence}%</td>
            <td>${status}</td>
        </tr>`;
    });

    html += '</table>';
    container.innerHTML = html;
}

function updateJobsList(jobs) {
    const container = document.getElementById('jobsContainer');
    if (jobs.length === 0) {
        container.innerHTML = '<p class="muted">No jobs yet.</p>';
        return;
    }

    let html = '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
    html += '<tr style="border-bottom:1px solid #ddd; background:#f8fbff;"><th style="padding:8px; text-align:left;">Job ID</th><th>Customer</th><th>Status</th><th>Confidence</th><th>Risk</th><th>Metro</th></tr>';

    jobs.slice(0, 30).forEach(job => {
        const statusColor = {
            delivered: 'green',
            in_transit: 'blue',
            assigned: 'orange',
            arrived: 'purple',
            issue: 'red',
            created: 'gray'
        }[job.status] || 'gray';

        html += `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px; font-weight:600;">${job.job_id}</td>
            <td>${(job.customer_name || 'N/A').substring(0, 15)}</td>
            <td><span style="color:${statusColor}; font-weight:600;">${job.status}</span></td>
            <td>${job.confidence}%</td>
            <td>${job.delivery_risk}</td>
            <td>${(job.nearest_metro || 'N/A').substring(0, 20)}</td>
        </tr>`;
    });

    html += '</table>';
    container.innerHTML = html;
}

loadOpsData();
setInterval(loadOpsData, 5000);
