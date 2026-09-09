const API_BASE = 'http://localhost:5000/api';

const token = localStorage.getItem('token');
const userRole = localStorage.getItem('role');
const userName = localStorage.getItem('userName');

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('show');
}

function updateDate() {
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
}

async function loadFacultyDashboard() {
    // Populate stored user details
    if (userName) {
        document.getElementById('facultyName').textContent = userName;
        document.getElementById('welcomeGreeting').textContent = `Welcome back, ${userName}!`;
        const initials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById('profileInitials').textContent = initials;
    }

    // Only attempt live API call if an authenticated token is present
    if (token && token !== 'dev-preview-token') {
        try {
            const res = await fetch(`${API_BASE}/faculty/dashboard`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.status === 401 || res.status === 403) {
                localStorage.clear();
                window.location.href = 'index.html';
                return;
            }

            const data = await res.json();

            // 1. Metric Cards
            document.getElementById('totalTestsCount').textContent = data.stats.totalTests || 0;
            document.getElementById('totalStudentsCount').textContent = data.stats.totalStudents || 0;
            document.getElementById('activeTestsCount').textContent = data.stats.activeTests || 0;
            document.getElementById('avgPerformanceScore').textContent = `${data.stats.avgPerformance || 0}%`;

            // 2. Upcoming Tests
            renderUpcomingTests(data.upcomingTests || []);

            // 3. Results Table
            renderResultsTable(data.recentResults || []);

            // 4. Dynamic Chart
            renderChartBars(data.recentResults || []);

        } catch (err) {
            console.warn('Backend currently unreachable. Displaying fallback mockup data.', err);
        }
    }
}

function renderUpcomingTests(tests) {
    const container = document.getElementById('upcomingTestsContainer');
    if (!container) return;

    if (tests.length === 0) {
        container.innerHTML = '<div class="py-4 text-center text-muted small">No scheduled tests yet.</div>';
        return;
    }

    const now = new Date();
    container.innerHTML = tests.map(test => {
        const start = new Date(test.start_date);
        const end = new Date(test.end_date);
        const isActive = start <= now && end >= now;

        return `
            <div class="test-item">
                <div class="test-info">
                    <strong>${test.title}</strong>
                    <span>Duration: ${test.duration_mins || 30} mins</span>
                </div>
                <div class="test-date">
                    <strong>${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</strong>
                    <span>${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <span class="status ${isActive ? 'active-status' : 'scheduled-status'}">
                    ${isActive ? 'Active' : 'Scheduled'}
                </span>
            </div>
        `;
    }).join('');
}

function renderResultsTable(results) {
    const tbody = document.getElementById('resultsTableBody');
    if (!tbody) return;

    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No submissions recorded yet.</td></tr>';
        return;
    }

    tbody.innerHTML = results.map(row => `
        <tr>
            <td><strong>${row.title}</strong></td>
            <td>${row.total_marks}</td>
            <td>${row.avg_score} (${row.avg_pct}%)</td>
            <td>${row.highest_score} (${row.highest_pct}%)</td>
            <td>${row.attempts}</td>
            <td>
                <button class="view-btn" onclick="alert('Viewing detailed results for: ${row.title}')">
                    <i class="bi bi-eye"></i> Details
                </button>
            </td>
        </tr>
    `).join('');
}

function renderChartBars(results) {
    const container = document.getElementById('dynamicChartBars');
    if (!container) return;

    if (results.length === 0) return;

    container.innerHTML = results.slice(0, 5).map(item => `
        <div class="bar-wrapper">
            <div class="chart-bar-fill" style="height: ${Math.max(item.avg_pct, 10)}%;"></div>
            <span class="bar-label" title="${item.title}">${item.title}</span>
        </div>
    `).join('');
}

// Modal Form: Create Test
document.getElementById('createTestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('testTitleInput').value;
    const duration_mins = parseInt(document.getElementById('testDurationInput').value, 10);
    const start_date = document.getElementById('testStartInput').value;
    const end_date = document.getElementById('testEndInput').value;

    try {
        const res = await fetch(`${API_BASE}/tests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ title, duration_mins, start_date, end_date })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        bootstrap.Modal.getInstance(document.getElementById('createTestModal')).hide();
        document.getElementById('createTestForm').reset();
        loadFacultyDashboard();
    } catch (err) {
        alert(err.message);
    }
});

// Logout handler
document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = 'index.html';
});

document.addEventListener('DOMContentLoaded', () => {
    updateDate();
    loadFacultyDashboard();
});