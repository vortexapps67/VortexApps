/* ==========================================================================
   VORTEXAPPS — CORE LOGIC ENGINE
   Firebase sync, dynamic rendering, admin panel
   ========================================================================== */

// --- DEFAULT DATA ---
const DEFAULT_STATE = {
    downloads: "152+",
    announcement: "",
    maintenanceMode: false,
    maintenanceReason: "VortexApps is currently undergoing scheduled updates.",
    projects: [
        {
            id: "beatwave",
            name: "BeatWave",
            desc: "A premium open-source music player built for zero-ad, high-fidelity audio streaming with personalized playback.",
            type: "Mobile & Web App",
            tech: "React, Tailwind, Node",
            link: "https://beatwave.oneapp.dev",
            status: "online",
            logo: "assets/beatwave_logo.png"
        },
        {
            id: "wavemirror",
            name: "WaveMirror",
            desc: "A fast search aggregator with instant results, movie reviews, and metadata visualization.",
            type: "Web App",
            tech: "HTML, CSS, JavaScript",
            link: "https://wavemirrors.netlify.app",
            status: "online",
            logo: "assets/wavemirror.png"
        },
        {
            id: "onyx",
            name: "Onyx Chat",
            desc: "A low-latency, secure real-time messaging app with clean UI and modern websocket infrastructure.",
            type: "Web App",
            tech: "WebSockets, React, SQL",
            link: "https://onyxchat.netlify.app",
            status: "online",
            logo: "assets/onyxchatlogoforapp.jpeg"
        }
    ],
    team: [
        {
            id: "tm_aarav",
            name: "Aarav Sharma",
            role: "Co-Founder, UI/UX Designer",
            insta: "aarav_sharma_sui",
            portfolio: "aaravsharma.netlify.app"
        },
        {
            id: "tm_akshansh",
            name: "Akshansh Sinha",
            role: "Co-Founder, Full-Stack Engineer",
            insta: "akshansh_6969",
            portfolio: "akshanshsinha.vercel.app"
        }
    ]
};let VORTEX_STATE = {};
let firebaseConfig = null;
let adminPasswordHash = "006657998771eb1ef75d0a26f8824af99da8bf4f7261d3a4d896708286a618eb"; // fallback
let db = null;

// Helper to compute SHA-256
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);                    
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Load secrets from local .env or fallback config
async function loadSecrets() {
    try {
        const response = await fetch('/.env');
        if (!response.ok) throw new Error();
        const text = await response.text();
        const env = {};
        text.split('\n').forEach(line => {
            const parts = line.trim().split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                env[key] = value;
            }
        });

        if (env.FIREBASE_API_KEY) {
            firebaseConfig = {
                apiKey: env.FIREBASE_API_KEY,
                authDomain: env.FIREBASE_AUTH_DOMAIN,
                databaseURL: env.FIREBASE_DATABASE_URL,
                projectId: env.FIREBASE_PROJECT_ID,
                storageBucket: env.FIREBASE_STORAGE_BUCKET,
                messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
                appId: env.FIREBASE_APP_ID,
                measurementId: env.FIREBASE_MEASUREMENT_ID
            };
        }
        if (env.ADMIN_PASSWORD_HASH) {
            adminPasswordHash = env.ADMIN_PASSWORD_HASH;
        }
        console.log("Loaded secrets from .env");
    } catch (e) {
        // Fallback to window config
        const systemConfig = window.VORTEXAPPS_CONFIG || {};
        firebaseConfig = systemConfig.firebaseConfig || null;
        adminPasswordHash = systemConfig.adminPasswordHash || "006657998771eb1ef75d0a26f8824af99da8bf4f7261d3a4d896708286a618eb";
        console.log("Loaded configuration from config.js / fallback");
    }
}

// --- STATE PERSISTENCE ---
function loadGlobalState() {
    const saved = localStorage.getItem('vortex_state');
    if (saved) {
        try {
            VORTEX_STATE = JSON.parse(saved);
            if (!VORTEX_STATE.projects) VORTEX_STATE.projects = DEFAULT_STATE.projects;
            if (!VORTEX_STATE.team) VORTEX_STATE.team = DEFAULT_STATE.team;
            if (!VORTEX_STATE.downloads) VORTEX_STATE.downloads = DEFAULT_STATE.downloads;
            if (VORTEX_STATE.announcement === undefined) VORTEX_STATE.announcement = DEFAULT_STATE.announcement;
            if (VORTEX_STATE.maintenanceMode === undefined) VORTEX_STATE.maintenanceMode = DEFAULT_STATE.maintenanceMode;
            if (VORTEX_STATE.maintenanceReason === undefined) VORTEX_STATE.maintenanceReason = DEFAULT_STATE.maintenanceReason;
        } catch (e) {
            VORTEX_STATE = JSON.parse(JSON.stringify(DEFAULT_STATE));
        }
    } else {
        VORTEX_STATE = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
}

function saveGlobalState() {
    localStorage.setItem('vortex_state', JSON.stringify(VORTEX_STATE));
}

// --- FIREBASE INIT ---
async function initFirebase() {
    await loadSecrets();

    if (typeof firebase !== 'undefined' && firebaseConfig) {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            db = firebase.database();

            if (firebase.auth) {
                try {
                    await firebase.auth().signInAnonymously();
                    logToDashboard("Firebase: connected and authenticated.");
                    updateSyncIndicator(true);
                } catch (err) {
                    logToDashboard("Firebase auth warning: " + err.message);
                    updateSyncIndicator(false);
                }
            } else {
                updateSyncIndicator(true);
            }
        } catch (e) {
            console.error("Firebase init failed:", e);
            updateSyncIndicator(false);
        }
    } else {
        updateSyncIndicator(false);
    }
}

let isLocalDb = false;

// --- REAL-TIME SYNC INIT ---
async function initializeRealtimeSync() {
    loadGlobalState();

    // 1. Check if local repository DB API is available
    try {
        const response = await fetch('/api/state');
        if (response.ok) {
            const data = await response.json();
            VORTEX_STATE = data;
            isLocalDb = true;
            saveGlobalState();
            renderAllUI();
            logToDashboard("Local repository DB detected (db.json).");
            const statusEl = document.getElementById('db-status-text');
            if (statusEl) statusEl.textContent = "Local repository DB active";
        }
    } catch (e) {
        // Local DB API server not running
    }

    // 2. Connect Firebase for multi-device real-time sync
    if (db) {
        const statusEl = document.getElementById('db-status-text');
        if (statusEl) {
            statusEl.textContent = isLocalDb 
                ? "Hybrid sync active (Local DB + Firebase)" 
                : "Firebase connected";
        }
        updateSyncIndicator(true);

        // Seed if empty, using VORTEX_STATE loaded from local DB or cache
        db.ref('vortex_state').once('value')
            .then(snapshot => {
                if (!snapshot.val()) {
                    db.ref('vortex_state').set(VORTEX_STATE)
                        .then(() => logToDashboard("Seeded Firebase with current state."))
                        .catch(err => logToDashboard("Firebase seed failed: " + err.message));
                }
            });

        // Real-time listener: syncs all devices in real-time
        db.ref('vortex_state').on('value', async (snapshot) => {
            const val = snapshot.val();
            if (val) {
                // Check if anything actually changed to prevent redundant writes
                const changed = JSON.stringify(VORTEX_STATE) !== JSON.stringify(val);
                VORTEX_STATE = val;
                saveGlobalState();
                renderAllUI();
                logToDashboard("Synced from Firebase.");

                // If running local server, sync real-time Firebase changes to db.json
                if (isLocalDb && changed) {
                    try {
                        await fetch('/api/state', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(VORTEX_STATE)
                        });
                        logToDashboard("Saved Firebase updates to local db.json.");
                    } catch (err) {
                        console.error("Local db.json sync error:", err);
                    }
                }
            }
        });
    } else {
        renderAllUI();
        logToDashboard(isLocalDb ? "Running in local repository mode." : "Running in offline simulation mode.");
    }
}

async function syncStateToDatabase() {
    saveGlobalState();

    // 1. Sync to Firebase (this propagates real-time updates to all connected devices)
    if (db) {
        db.ref('vortex_state').set(VORTEX_STATE)
            .then(() => logToDashboard("Pushed changes to Firebase."))
            .catch(err => logToDashboard("Firebase write failed: " + err.message));
    } else {
        logToDashboard("Firebase offline. Saved to local storage.");
    }

    // 2. If running local server, also save to local repository db.json
    if (isLocalDb) {
        try {
            const response = await fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(VORTEX_STATE)
            });
            if (response.ok) {
                logToDashboard("Saved changes to local db.json & pushed to GitHub.");
            }
        } catch (e) {
            logToDashboard("Local DB sync failed: " + e.message);
        }
    }

    renderAllUI();
}

// --- RENDER ALL UI ---
function renderAllUI() {
    renderDownloads();
    renderAnnouncement();
    renderMaintenanceMode();
    renderProjects();
    renderTeam();
    renderAdminForms();
    renderAdminOverviewStats();
}

function renderDownloads() {
    const els = document.querySelectorAll('#downloads-counter, #ov-downloads');
    els.forEach(el => { if (el) el.textContent = VORTEX_STATE.downloads; });
}

function renderAnnouncement() {
    const bar = document.getElementById('announcement-bar');
    const text = document.getElementById('announcement-text');

    if (!bar) return;

    if (VORTEX_STATE.announcement && VORTEX_STATE.announcement.trim()) {
        bar.style.display = 'block';
        if (text) text.textContent = VORTEX_STATE.announcement;
    } else {
        bar.style.display = 'none';
    }
}

function renderProjects() {
    const grid = document.getElementById('dynamic-projects-grid');
    if (!grid) return;

    grid.innerHTML = '';
    VORTEX_STATE.projects.forEach(proj => {
        const isOnline = proj.status === 'online';
        const logoHTML = proj.logo && proj.logo.trim()
            ? `<img src="${proj.logo}" alt="${proj.name}" class="project-logo">`
            : `<div class="project-logo-placeholder"><i data-lucide="box"></i></div>`;

        grid.innerHTML += `
            <a class="project-card" href="${proj.link}" target="_blank" rel="noopener">
                <div class="project-card-header">
                    ${logoHTML}
                    <div class="project-card-meta">
                        <div class="project-card-name">${proj.name}</div>
                        <div class="project-card-type">${proj.type || 'App'}</div>
                    </div>
                    <div class="project-status ${isOnline ? 'online' : ''}">
                        <span class="status-dot"></span>
                        ${isOnline ? 'Live' : 'Down'}
                    </div>
                </div>
                <div class="project-card-desc">${proj.desc}</div>
                <div class="project-card-footer">
                    <span class="project-tech">${proj.tech || ''}</span>
                    <div class="project-link-arrow">
                        <i data-lucide="arrow-up-right" style="width:12px;height:12px;"></i>
                    </div>
                </div>
            </a>
        `;
    });

    refreshIcons();
}


function renderTeam() {
    const grid = document.getElementById('dynamic-team-grid');
    if (!grid) return;

    grid.innerHTML = '';
    VORTEX_STATE.team.forEach(member => {
        const initial = member.name ? member.name.charAt(0).toUpperCase() : '?';
        const instaLink = member.insta
            ? `<a href="https://instagram.com/${member.insta.replace('@','')}" target="_blank" rel="noopener" class="team-link">Instagram</a>`
            : '';
        const portLink = member.portfolio
            ? `<a href="https://${member.portfolio}" target="_blank" rel="noopener" class="team-link">Portfolio</a>`
            : '';

        grid.innerHTML += `
            <div class="team-card">
                <div class="team-avatar">${initial}</div>
                <div class="team-info">
                    <div class="team-name">${member.name}</div>
                    <div class="team-role">${member.role}</div>
                    <div class="team-links">${instaLink}${portLink}</div>
                </div>
            </div>
        `;
    });
}

// --- ADMIN PANEL RENDER ---
function renderAdminForms() {
    const dlInput = document.getElementById('admin-downloads');
    if (dlInput) dlInput.value = VORTEX_STATE.downloads;

    const annInput = document.getElementById('admin-announcement');
    if (annInput) annInput.value = VORTEX_STATE.announcement;

    const mtToggle = document.getElementById('admin-maintenance-toggle');
    if (mtToggle) mtToggle.checked = VORTEX_STATE.maintenanceMode || false;

    const mtReason = document.getElementById('admin-maintenance-reason');
    if (mtReason) mtReason.value = VORTEX_STATE.maintenanceReason || '';

    renderAdminProjectsEditor();
    renderAdminTeamList();
}

function renderAdminOverviewStats() {
    // Support both old and new element IDs
    const dlEls = ['ov-downloads', 'admin-downloads-display'];
    dlEls.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = VORTEX_STATE.downloads; });

    const pCount = VORTEX_STATE.projects ? VORTEX_STATE.projects.length : 0;
    const projEls = ['ov-projects', 'admin-projects-count'];
    projEls.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = pCount; });

    const tCount = VORTEX_STATE.team ? VORTEX_STATE.team.length : 0;
    const teamEls = ['ov-team', 'admin-team-count'];
    teamEls.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = tCount; });
}

function renderAdminProjectsEditor() {
    const grid = document.getElementById('admin-projects-editor-grid');
    if (!grid) return;

    grid.innerHTML = '';
    (VORTEX_STATE.projects || []).forEach((proj, i) => {
        const isOnline = proj.status === 'online';

        grid.innerHTML += `
            <div class="admin-project-item" style="--i:${i};">
                <div class="admin-project-item-info">
                    <div class="admin-project-item-name">${proj.name}</div>
                    <div class="admin-project-item-meta">${proj.type || ''} ${proj.tech ? '· ' + proj.tech : ''}</div>
                </div>
                <div class="admin-project-fields">
                    <div class="admin-input-group" style="margin-bottom:0;">
                        <label class="admin-input-label">Name</label>
                        <input type="text" class="admin-input" id="db-proj-name-${proj.id}" value="${proj.name || ''}">
                    </div>
                    <div class="admin-input-group" style="margin-bottom:0;">
                        <label class="admin-input-label">URL</label>
                        <input type="text" class="admin-input" id="db-proj-link-${proj.id}" value="${proj.link || ''}">
                    </div>
                </div>
                <div class="admin-project-actions">
                    <div class="admin-toggle" style="margin-bottom:0;">
                        <input type="checkbox" id="db-proj-status-${proj.id}" ${isOnline ? 'checked' : ''}
                            title="Mark as online">
                        <label for="db-proj-status-${proj.id}" class="admin-toggle-label">Live</label>
                    </div>
                    <button onclick="updateIndividualProject('${proj.id}')" class="btn btn-secondary btn-sm">Save</button>
                    <button onclick="removeProject('${proj.id}')" class="btn btn-danger btn-sm">Remove</button>
                </div>
            </div>
        `;
    });

    if (!VORTEX_STATE.projects || VORTEX_STATE.projects.length === 0) {
        grid.innerHTML = `<div class="admin-empty">No projects yet — add one above.</div>`;
    }

    refreshIcons();
}



function renderAdminTeamList() {
    const list = document.getElementById('admin-team-list');
    if (!list) return;

    list.innerHTML = '';
    if (!VORTEX_STATE.team || VORTEX_STATE.team.length === 0) {
        list.innerHTML = `<div class="admin-empty">No team members yet — add one above.</div>`;
        return;
    }

    VORTEX_STATE.team.forEach((member, i) => {
        const initial = member.name ? member.name.charAt(0).toUpperCase() : '?';
        list.innerHTML += `
            <div class="admin-member-card" style="--i:${i};">
                <div class="admin-member-avatar">${initial}</div>
                <div class="admin-member-fields">
                    <div class="admin-input-group" style="margin-bottom:0;">
                        <label class="admin-input-label">Name</label>
                        <input type="text" class="admin-input" id="db-team-name-${member.id}" value="${member.name}">
                    </div>
                    <div class="admin-input-group" style="margin-bottom:0;">
                        <label class="admin-input-label">Role</label>
                        <input type="text" class="admin-input" id="db-team-role-${member.id}" value="${member.role}">
                    </div>
                    <div class="admin-input-group" style="margin-bottom:0;">
                        <label class="admin-input-label">Instagram</label>
                        <input type="text" class="admin-input" id="db-team-insta-${member.id}" value="${member.insta || ''}">
                    </div>
                    <div class="admin-input-group" style="margin-bottom:0;">
                        <label class="admin-input-label">Portfolio</label>
                        <input type="text" class="admin-input" id="db-team-port-${member.id}" value="${member.portfolio || ''}">
                    </div>
                </div>
                <div class="admin-member-actions">
                    <button onclick="updateTeamMemberInline('${member.id}')" class="btn btn-secondary btn-sm">Save</button>
                    <button onclick="removeTeamMember('${member.id}')" class="btn btn-sm" style="border:1px solid rgba(239,68,68,0.3);color:var(--red);background:transparent;">Remove</button>
                </div>
            </div>
        `;
    });
}

// --- ADMIN WRITE FUNCTIONS ---
function updateFirebaseStats() {
    const input = document.getElementById('admin-downloads');
    if (!input) return;
    VORTEX_STATE.downloads = input.value.trim();
    syncStateToDatabase();
    showToast("Install count updated.");
}
window.updateFirebaseStats = updateFirebaseStats;

function updateFirebaseAnnouncement() {
    const input = document.getElementById('admin-announcement');
    if (!input) return;
    VORTEX_STATE.announcement = input.value.trim();
    syncStateToDatabase();
    showToast(VORTEX_STATE.announcement ? "Announcement set." : "Announcement cleared.");
}
window.updateFirebaseAnnouncement = updateFirebaseAnnouncement;

// Friendly aliases used in admin.html
function saveAnnouncement() { updateFirebaseAnnouncement(); }
window.saveAnnouncement = saveAnnouncement;

function saveDownloads() { updateFirebaseStats(); }
window.saveDownloads = saveDownloads;

function updateIndividualProject(projectId) {
    const name = document.getElementById(`db-proj-name-${projectId}`)?.value.trim();
    const link = document.getElementById(`db-proj-link-${projectId}`)?.value.trim();
    const status = document.getElementById(`db-proj-status-${projectId}`)?.checked ? 'online' : 'maintenance';

    if (!name) { showToast("Project name is required."); return; }

    const idx = VORTEX_STATE.projects.findIndex(p => p.id === projectId);
    if (idx !== -1) {
        VORTEX_STATE.projects[idx].name = name;
        VORTEX_STATE.projects[idx].link = link;
        VORTEX_STATE.projects[idx].status = status;
        syncStateToDatabase();
        showToast(`"${name}" saved.`);
    }
}
window.updateIndividualProject = updateIndividualProject;

function removeProject(projectId) {
    const proj = VORTEX_STATE.projects.find(p => p.id === projectId);
    VORTEX_STATE.projects = VORTEX_STATE.projects.filter(p => p.id !== projectId);
    syncStateToDatabase();
    showToast(proj ? `"${proj.name}" removed.` : 'Project removed.');
}
window.removeProject = removeProject;


function updateTeamMemberInline(memberId) {
    const name = document.getElementById(`db-team-name-${memberId}`)?.value.trim();
    const role = document.getElementById(`db-team-role-${memberId}`)?.value.trim();
    const insta = document.getElementById(`db-team-insta-${memberId}`)?.value.trim();
    const portfolio = document.getElementById(`db-team-port-${memberId}`)?.value.trim();

    if (!name || !role) { showToast("Name and role are required."); return; }

    const idx = VORTEX_STATE.team.findIndex(t => t.id === memberId);
    if (idx !== -1) {
        VORTEX_STATE.team[idx] = { ...VORTEX_STATE.team[idx], name, role, insta, portfolio };
        syncStateToDatabase();
        showToast(`${name} updated.`);
    }
}
window.updateTeamMemberInline = updateTeamMemberInline;

function addTeamMember() {
    const name = document.getElementById('nm-name')?.value.trim();
    const role = document.getElementById('nm-role')?.value.trim();
    const insta = document.getElementById('nm-instagram')?.value.trim();
    const portfolio = document.getElementById('nm-portfolio')?.value.trim();

    if (!name || !role) { showToast("Name and role are required."); return; }

    if (!Array.isArray(VORTEX_STATE.team)) VORTEX_STATE.team = [];

    VORTEX_STATE.team.push({ id: 'tm_' + Date.now(), name, role, insta, portfolio });
    syncStateToDatabase();

    ['nm-name','nm-role','nm-instagram','nm-portfolio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    showToast(`${name} added.`);
}
window.addTeamMember = addTeamMember;

function removeTeamMember(memberId) {
    const member = VORTEX_STATE.team.find(m => m.id === memberId);
    VORTEX_STATE.team = VORTEX_STATE.team.filter(m => m.id !== memberId);
    syncStateToDatabase();
    showToast(member ? `${member.name} removed.` : "Member removed.");
}
window.removeTeamMember = removeTeamMember;

// --- ADMIN AUTH ---
async function verifyAdmin() {
    const passInput = document.getElementById('admin-password');
    if (!passInput) return;

    const hash = await sha256(passInput.value);
    if (hash === adminPasswordHash) {
        sessionStorage.setItem('admin_authorized', 'true');

        const authPanel = document.getElementById('admin-auth-panel');
        if (authPanel) authPanel.style.display = 'none';

        const dashboard = document.getElementById('admin-dashboard-panel');
        if (dashboard) dashboard.classList.add('active');

        passInput.value = '';
        logToDashboard("Signed in successfully.");
        showToast("Welcome back.");

        // Let the dashboard paint, then run the counters
        requestAnimationFrame(() => animateStatNumbers());

        const geminiKey = document.getElementById('admin-gemini-key');
        if (geminiKey) {
            const systemConfig = window.VORTEXAPPS_CONFIG || {};
            geminiKey.value = localStorage.getItem('gemini_api_key') || systemConfig.geminiApiKey || '';
        }
    } else {
        showToast("Incorrect password.");

        const card = document.querySelector('.admin-auth-card');
        if (card) {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
        }
        passInput.value = '';
        passInput.focus();
    }
}
window.verifyAdmin = verifyAdmin;

function lockAdminPanel() {
    sessionStorage.removeItem('admin_authorized');
    const dashboard = document.getElementById('admin-dashboard-panel');
    if (dashboard) dashboard.classList.remove('active');
    const authPanel = document.getElementById('admin-auth-panel');
    if (authPanel) authPanel.style.display = 'flex';
    showToast("Signed out.");
}
window.lockAdminPanel = lockAdminPanel;

function checkAdminAuthSession() {
    if (sessionStorage.getItem('admin_authorized') === 'true') {
        const authPanel = document.getElementById('admin-auth-panel');
        if (authPanel) authPanel.style.display = 'none';
        const dashboard = document.getElementById('admin-dashboard-panel');
        if (dashboard) dashboard.classList.add('active');
        logToDashboard("Session restored.");

        // Counters need the stats rendered first, so wait a beat
        setTimeout(() => animateStatNumbers(), 180);
    }
}

// --- ADMIN TAB SWITCHING ---
function switchAdminTab(tabId) {
    document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));

    const tab = document.getElementById('admin-tab-' + tabId);
    if (tab) {
        tab.classList.add('active');
        replayEntrance(tab);
    }

    const btn = document.getElementById('tab-btn-' + tabId);
    if (btn) btn.classList.add('active');

    if (tabId === 'overview') animateStatNumbers();
}

/*  Restart the CSS entrance animations on a freshly shown tab. Toggling the
    class alone won't replay them — the animation has already run once — so we
    drop the animation, force a reflow, then hand it back. */
function replayEntrance(tab) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const targets = tab.querySelectorAll('.admin-tab-content > *, .admin-topbar > div');
    targets.forEach(el => { el.style.animation = 'none'; });
    void tab.offsetWidth;
    targets.forEach(el => { el.style.animation = ''; });
}

/*  Count a stat up to its final value. Stats are plain text nodes written by
    renderAdminOverviewStats(), so we read the number back out and re-render it. */
function animateStatNumbers() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('.admin-stat-num').forEach(el => {
        const target = parseInt(String(el.textContent).replace(/[^0-9]/g, ''), 10);
        if (!Number.isFinite(target)) return;
        if (reduce || target === 0) { el.textContent = String(target); return; }

        const duration = 900;
        const start = performance.now();

        const step = now => {
            const p = Math.min((now - start) / duration, 1);
            // easeOutExpo — fast start, long settle
            const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
            el.textContent = String(Math.round(target * eased));
            if (p < 1) requestAnimationFrame(step);
        };

        el.textContent = '0';
        requestAnimationFrame(step);
    });
}
window.animateStatNumbers = animateStatNumbers;
window.switchAdminTab = switchAdminTab;

function updateLocalGeminiKey() {
    const input = document.getElementById('admin-gemini-key');
    if (!input) return;
    const key = input.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        showToast("API key saved.");
    } else {
        localStorage.removeItem('gemini_api_key');
        showToast("API key cleared.");
    }
}
window.updateLocalGeminiKey = updateLocalGeminiKey;

// --- SYNC INDICATOR ---
function updateSyncIndicator(isConnected) {
    const dots = document.querySelectorAll('.admin-sync-dot, #settings-sync-dot');
    const label = document.getElementById('admin-sync-label');
    const statusText = document.getElementById('db-status-text');

    dots.forEach(dot => {
        if (dot) {
            dot.classList.toggle('synced', isConnected);
        }
    });

    if (label) label.textContent = isConnected ? 'Firebase synced' : 'Local mode';
    if (statusText) statusText.textContent = isConnected ? 'Firebase connected' : 'Not connected — local db active';
}

// --- ADMIN LOG ---
function logToDashboard(msg) {
    const log = document.getElementById('admin-log');
    if (!log) return;
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const entry = document.createElement('div');
    entry.className = 'admin-log-entry';
    entry.innerHTML = `<span class="ts">[${ts}]</span> <span class="msg">${msg}</span>`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// --- TOAST ---
let toastTimer = null;
function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// Keep legacy name for compatibility
function triggerSystemPing(msg) { showToast(msg); }
window.triggerSystemPing = triggerSystemPing;

// --- CONTACT FORM ---
function submitContactForm(e) {
    e.preventDefault();
    showToast("Message sent! We'll respond within 24 hours.");
    e.target.reset();
}
window.submitContactForm = submitContactForm;

// --- MOBILE NAV ---
function toggleNav() {
    const links = document.getElementById('nav-links');
    if (links) links.classList.toggle('open');
}
window.toggleNav = toggleNav;

// --- UTILITY ---
function refreshIcons() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- COOKIE CONSENT ---
function initCookieConsent() {
    if (window.location.pathname.includes('admin')) return;
    if (localStorage.getItem('cookie_consent')) return;

    const banner = document.createElement('div');
    banner.id = 'cookie-consent';
    banner.innerHTML = `
        <div class="cookie-text">
            <h4>We use cookies</h4>
            <p>We use essential cookies to keep the site running. See our <a href="privacy.html">Privacy Policy</a>.</p>
        </div>
        <div class="cookie-actions">
            <button class="btn btn-ghost btn-sm" onclick="declineCookies()">Decline</button>
            <button class="btn btn-primary btn-sm" onclick="acceptCookies()">Accept</button>
        </div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.classList.add('show'), 700);
}

function acceptCookies() {
    localStorage.setItem('cookie_consent', 'accepted');
    dismissCookieBanner();
}
window.acceptCookies = acceptCookies;

function declineCookies() {
    localStorage.setItem('cookie_consent', 'declined');
    dismissCookieBanner();
}
window.declineCookies = declineCookies;

function dismissCookieBanner() {
    const banner = document.getElementById('cookie-consent');
    if (!banner) return;
    banner.classList.remove('show');
    setTimeout(() => banner.remove(), 350);
}

// --- NAV SCROLL EFFECT ---
function initNavScroll() {
    // Floating pill nav — no scroll class needed; always styled
}

// --- LOADING SCREEN ---
function initLoadingScreen() {
    const saved = localStorage.getItem('vortex_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);

    // Loader removed for instant load — no preloader flash
    return;
}

function dismissLoadingScreen() {
    // Kick off the hero wordmark rise as the loader fades
    document.querySelectorAll('.hero h1.wm-ready').forEach(h => h.classList.add('wm-run'));
    const loader = document.getElementById('loading-screen');
    if (!loader) return;
    loader.remove();
}

// --- DARK / LIGHT THEME ---
function initThemeToggle() {
    // Toggle button is embedded in HTML. Just sync icon state on load.
    updateThemeIcon();
}

function updateThemeIcon() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function toggleTheme(event) {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';

    // Where the circular reveal originates — click point, else the toggle button
    const btn = document.getElementById('theme-btn');
    let x, y;
    if (event && typeof event.clientX === 'number' && (event.clientX || event.clientY)) {
        x = event.clientX;
        y = event.clientY;
    } else if (btn) {
        const r = btn.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
    } else {
        x = window.innerWidth - 40;
        y = 36;
    }

    const apply = () => {
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('vortex_theme', next);
        updateThemeIcon();
    };

    // Spin the toggle icon
    if (btn) {
        btn.classList.remove('spinning');
        void btn.offsetWidth; // restart animation
        btn.classList.add('spinning');
        setTimeout(() => btn.classList.remove('spinning'), 650);
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reduceMotion && typeof document.startViewTransition === 'function') {
        const radius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );
        try {
            const transition = document.startViewTransition(apply);
            transition.ready.then(() => {
                document.documentElement.animate(
                    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
                    {
                        duration: 600,
                        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                        pseudoElement: '::view-transition-new(root)'
                    }
                );
            }).catch(() => {});
        } catch (e) {
            apply();
        }
    } else {
        // Fallback — quick crossfade pulse
        apply();
        document.documentElement.classList.remove('theme-fade');
        void document.documentElement.offsetWidth;
        document.documentElement.classList.add('theme-fade');
        setTimeout(() => document.documentElement.classList.remove('theme-fade'), 450);
    }
}
window.toggleTheme = toggleTheme;

// --- HERO WORDMARK — split headline into characters for the rise animation ---
// If the page loads/animates while the window is hidden, the timeline freezes
// and letters can be left stranded at mixed heights. Settle them once visible.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    setTimeout(() => {
        document.getAnimations().forEach(a => {
            if (a.animationName === 'wm-rise' && a.playState === 'running') {
                try { a.finish(); } catch (e) {}
            }
        });
    }, 5000);
});

function initHeroWordmark() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.hero:not(.page-hero) h1').forEach(h1 => {
        if (h1.dataset.wmSplit) return;
        h1.dataset.wmSplit = '1';

        let i = 0;
        const splitNode = (node) => {
            [...node.childNodes].forEach(child => {
                if (child.nodeType === Node.TEXT_NODE) {
                    const frag = document.createDocumentFragment();
                    // Split into words so wrapping still happens between words only
                    child.textContent.split(/(\s+)/).forEach(part => {
                        if (!part) return;
                        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
                        const word = document.createElement('span');
                        word.className = 'wm-word';
                        [...part].forEach(ch => {
                            const s = document.createElement('span');
                            s.className = 'wm-char';
                            s.style.setProperty('--i', reduceMotion ? 0 : i++);
                            s.textContent = ch;
                            word.appendChild(s);
                        });
                        frag.appendChild(word);
                    });
                    node.replaceChild(frag, child);
                } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
                    splitNode(child);
                }
            });
        };
        splitNode(h1);
        h1.classList.add('wm-ready');

        if (reduceMotion) { h1.classList.add('wm-run'); return; }
        // Safety net — run even if the loader never dismisses
        setTimeout(() => h1.classList.add('wm-run'), 2600);
    });
}

// --- ADD NEW PROJECT ---
function addProject() {
    const name      = document.getElementById('np-name')?.value.trim();
    const desc      = document.getElementById('np-desc')?.value.trim();
    const type      = document.getElementById('np-type')?.value.trim();
    const tech      = document.getElementById('np-tech')?.value.trim();
    const link      = document.getElementById('np-link')?.value.trim();
    const logo      = document.getElementById('np-logo')?.value.trim();

    if (!name || !link) { showToast("Project name and link are required."); return; }

    const newProj = {
        id: 'proj_' + Date.now(),
        name,
        desc: desc || '',
        type: type || 'Web App',
        tech: tech || '',
        link,
        status: 'online',
        logo: logo || ''
    };

    if (!VORTEX_STATE.projects) VORTEX_STATE.projects = [];
    VORTEX_STATE.projects.push(newProj);
    syncStateToDatabase();

    // Clear form
    ['np-name','np-desc','np-type','np-tech','np-link','np-logo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    showToast(`"${name}" added.`);
}
window.addProject = addProject;

// --- MAINTENANCE MODE ---
function renderMaintenanceMode() {
    const isMaintenance = VORTEX_STATE.maintenanceMode || false;
    const isAdminPage = window.location.pathname.includes('admin');

    if (isAdminPage) {
        const toggle = document.getElementById('admin-maintenance-toggle');
        if (toggle) toggle.checked = isMaintenance;
        return; // Do not apply overlay to admin dashboard
    }

    let overlay = document.getElementById('maintenance-overlay');

    if (isMaintenance) {
        const reason = VORTEX_STATE.maintenanceReason || "VortexApps is currently undergoing scheduled updates.";
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'maintenance-overlay';
            overlay.innerHTML = `
                <div class="maintenance-card">
                    <span class="maintenance-icon">🛠️</span>
                    <h1 class="maintenance-title">Under Maintenance</h1>
                    <p class="maintenance-desc">${reason}</p>
                    <div style="margin-top: 24px; margin-bottom: 24px;">
                        <a href="admin.html" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="settings" style="width:14px;height:14px;"></i>
                            Admin Console
                        </a>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-dim);font-family:var(--mono);">
                        VortexApps Systems &middot; Patna, IN
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            refreshIcons();
        } else {
            const desc = overlay.querySelector('.maintenance-desc');
            if (desc) desc.textContent = reason;
        }
    } else {
        if (overlay) overlay.remove();
    }
}

function toggleMaintenanceMode(isEnabled) {
    VORTEX_STATE.maintenanceMode = isEnabled;
    syncStateToDatabase();
    showToast(isEnabled ? "Maintenance Mode enabled." : "Maintenance Mode disabled.");
}
window.toggleMaintenanceMode = toggleMaintenanceMode;

function updateMaintenanceReason(reason) {
    VORTEX_STATE.maintenanceReason = reason.trim();
    syncStateToDatabase();
    showToast("Maintenance message updated.");
}
window.updateMaintenanceReason = updateMaintenanceReason;

// --- BOOT ---
// Apply theme before DOM paint to avoid flash
(function() {
    const saved = localStorage.getItem('vortex_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
})();

document.addEventListener('DOMContentLoaded', async () => {
    initLoadingScreen();
    initThemeToggle();
    initNavScroll();
    initHeroWordmark();
    refreshIcons();
    // Reveal animations — set up IMMEDIATELY so content is visible
    // without waiting for Firebase (which can take 1-3s on mobile).
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const countUpStat = (el) => {
        if (reduceMotion) return;
        if (el.id === 'downloads-counter') return; // real value arrives via Firebase
        const target = el.textContent.trim();
        const match = target.match(/^(\d[\d,]*)(.*)$/);
        if (!match) return;
        const end = parseInt(match[1].replace(/,/g, ''), 10);
        const suffix = match[2];
        const dur = 1400;
        const t0 = performance.now();
        const frame = (now) => {
            const p = Math.min((now - t0) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = String(Math.round(end * eased)) + suffix;
            if (p < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    };

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                if (entry.target.classList.contains('stats-row')) {
                    entry.target.querySelectorAll('.stat-num').forEach(countUpStat);
                }
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // Safety net: ensure reveals fire even if IntersectionObserver is delayed
    // (e.g. the page loaded in a hidden/background tab)
    setTimeout(() => {
        document.querySelectorAll('.reveal:not(.visible)').forEach(el => el.classList.add('visible'));
    }, 300);

    // Scroll progress + back-to-top (independent of Firebase)
    (function() {
        const bar = document.getElementById('scroll-progress');
        const btn = document.getElementById('back-to-top');
        if (!bar && !btn) return;
        let ticking = false;
        const update = () => {
            ticking = false;
            const h = document.documentElement;
            const max = h.scrollHeight - h.clientHeight;
            const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
            if (bar) bar.style.width = pct + '%';
            if (btn) btn.classList.toggle('show', h.scrollTop > 600);
        };
        window.addEventListener('scroll', () => {
            if (!ticking) { ticking = true; requestAnimationFrame(update); }
        }, { passive: true });
        update();
        if (btn) btn.addEventListener('click', () => {
            if (lenis) lenis.scrollTo(0, { duration: 1.25 });
            else window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    })();

    // Dismiss loading screen instantly (no loader element now)
    dismissLoadingScreen();

    // Firebase + realtime sync (background — content already visible)
    await initFirebase();
    initLenis();
    initializeRealtimeSync();
    checkAdminAuthSession();
    initCookieConsent();
});

// --- LENIS SMOOTH SCROLL ---
let lenis = null;
function initLenis() {
    try {
        if (typeof Lenis === 'undefined') return;
        lenis = new Lenis({
            duration: 1.25,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            smoothWheel: true,
            touchMultiplier: 1.4,
        });
        window.lenis = lenis; // exposed for debugging / third-party integration
        // Hybrid loop: rAF for 60fps smoothness when visible, setTimeout
        // keeps Lenis alive even in hidden/background tabs (rAF is paused
        // there, which previously made smooth scroll appear "removed").
        let lastTime = performance.now();
        const tick = (time) => {
            if (lenis) lenis.raf(time);
            lastTime = time;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const fallback = () => {
            if (lenis) {
                const now = performance.now();
                if (now - lastTime > 100) {
                    lenis.raf(now);
                    lastTime = now;
                }
            }
            setTimeout(fallback, 250);
        };
        setTimeout(fallback, 250);
    } catch (e) {
        lenis = null;
    }
}

// --- SCROLL PROGRESS + BACK TO TOP ---
(function() {
    const bar = document.getElementById('scroll-progress');
    const btn = document.getElementById('back-to-top');
    if (!bar && !btn) return;
    let ticking = false;
    const update = () => {
        ticking = false;
        const h = document.documentElement;
        const max = h.scrollHeight - h.clientHeight;
        const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
        if (bar) bar.style.width = pct + '%';
        if (btn) btn.classList.toggle('show', h.scrollTop > 600);
    };
    window.addEventListener('scroll', () => {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
    if (btn) btn.addEventListener('click', () => {
        if (lenis) lenis.scrollTo(0, { duration: 1.25 });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
})();

// --- HERO EYE GAZE — the pupil follows the cursor ---
(function() {
    const eye = document.querySelector('.hero-eye');
    const pupil = eye && eye.querySelector('.hero-eye-pupil');
    if (!eye || !pupil) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let ticking = false;
    window.addEventListener('mousemove', (e) => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            const r = eye.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2);
            const dy = e.clientY - (r.top + r.height / 2);
            const angle = Math.atan2(dy, dx);
            const travel = 11; // max pupil travel, px
            pupil.style.transform = 'translate(' + (Math.cos(angle) * travel) + 'px, ' + (Math.sin(angle) * travel) + 'px)';
        });
    }, { passive: true });
})();


