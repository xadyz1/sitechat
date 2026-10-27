const API_BASE = window.location.origin + '/api';

let sites = [];
let currentSiteId = null;
let currentUser = null;
let currentAnalyticsSite = '';
let sessionId = 'session-' + Math.random().toString(36).substring(2, 15);

// File upload state
let selectedFiles = [];
let selectedFilesBoth = [];
let selectedFilesExisting = [];
let currentSourceType = null;

const elements = {
    sitesGrid: document.getElementById('sites-grid'),
    sitesList: document.getElementById('sites-list'),
    emptyState: document.getElementById('empty-state'),
    detailContent: document.getElementById('detail-content'),
    detailEmptyState: document.getElementById('detail-empty-state'),
    detailTabContent: document.getElementById('detail-tab-content'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),
    chatSiteSelect: document.getElementById('chat-site-select'),
    newChatBtn: document.getElementById('new-chat-btn'),
    addSiteBtn: document.getElementById('add-site-btn'),
    emptyAddBtn: document.getElementById('empty-add-btn'),
    addSiteModal: document.getElementById('add-site-modal'),
    closeModal: document.getElementById('close-modal'),
    siteDetailsPanel: document.getElementById('site-details-panel'),
    sidePanelOverlay: document.getElementById('side-panel-overlay'),
    closeDetailsPanel: document.getElementById('close-details-panel'),
    statMsgsToday: document.getElementById('stat-msgs-today'),
    statAvgMsgs: document.getElementById('stat-avg-msgs'),
    statSatisfaction: document.getElementById('stat-satisfaction'),
    healthMongodb: document.getElementById('health-mongodb'),
    healthVector: document.getElementById('health-vector'),
    healthOllama: document.getElementById('health-ollama'),
    refreshHealth: document.getElementById('refresh-health'),
    userAvatar: document.getElementById('user-avatar'),
    userName: document.getElementById('user-name'),
    userRole: document.getElementById('user-role'),
    logoutBtn: document.getElementById('logout-btn'),
    uploadModal: document.getElementById('upload-modal'),
    documentsList: document.getElementById('documents-list')
};

function scheduleInitializeApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
    } else {
        queueMicrotask(() => initializeApp());
    }
}
scheduleInitializeApp();

function formatApiErrorDetail(data) {
    if (!data || data.detail == null) return 'Request failed.';
    const d = data.detail;
    if (typeof d === 'string') return d;
    if (d.message) return d.message;
    if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
    return 'Request failed.';
}

function syncBodyRoleClasses() {
    document.body.classList.remove('is-admin', 'is-user', 'is-agent', 'is-master');
    if (!currentUser?.role) return;
    const r = String(currentUser.role).toLowerCase();
    if (r === 'admin') document.body.classList.add('is-admin');
    else if (r === 'user') document.body.classList.add('is-user');
    else if (r === 'agent') document.body.classList.add('is-agent');
    if (currentUser.is_master) document.body.classList.add('is-master');
}

/** Prefer getAttribute — dataset.view can be unreliable for data-view in some browsers. */
function navDataView(el) {
    if (!el || !el.getAttribute) return '';
    return String(el.getAttribute('data-view') || '').trim();
}

function isDashboardAgent() {
    return String(currentUser?.role || '').toLowerCase() === 'agent';
}

function syncSidebarActiveNav(viewId) {
    document.querySelectorAll('.menu-item').forEach((i) => {
        i.classList.toggle('active', navDataView(i) === viewId);
    });
    document.querySelectorAll('.sidebar-util-link').forEach((l) => {
        l.classList.toggle('active', navDataView(l) === viewId);
    });
}

async function refreshCurrentUserFromServer() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
        if (res.status === 401) {
            logout();
            return false;
        }
        if (!res.ok) return true;
        const data = await res.json();
        currentUser = {
            ...currentUser,
            id: data.id,
            email: data.email,
            name: data.name,
            role: data.role,
            created_at: data.created_at,
            assigned_site_ids: data.assigned_site_ids || [],
            must_change_password: !!data.must_change_password,
            avatar_url: data.avatar_url || null,
        };
        localStorage.setItem('user', JSON.stringify(currentUser));
        syncBodyRoleClasses();
        return true;
    } catch {
        return true;
    }
}

function runAdminPasswordGate() {
    return new Promise((resolve) => {
        document.body.classList.add('admin-password-gate-active');
        const appRoot = document.querySelector('.app');
        if (appRoot) appRoot.setAttribute('inert', '');

        const el = document.createElement('div');
        el.id = 'admin-password-gate';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'admin-password-gate-title');
        el.innerHTML = `
          <div class="admin-password-gate-card">
            <h1 id="admin-password-gate-title">Set your password</h1>
            <p class="admin-password-gate-hint">For security, choose a new password before using the dashboard.</p>
            <form id="admin-password-gate-form">
              <label class="admin-password-gate-label" for="admin-gate-pw">New password</label>
              <input type="password" id="admin-gate-pw" class="admin-password-gate-input" autocomplete="new-password" required minlength="8" />
              <label class="admin-password-gate-label" for="admin-gate-pw2">Confirm password</label>
              <input type="password" id="admin-gate-pw2" class="admin-password-gate-input" autocomplete="new-password" required minlength="8" />
              <p class="admin-password-gate-error" id="admin-gate-error" role="alert" hidden></p>
              <button type="submit" class="admin-password-gate-submit" id="admin-gate-submit">Save and continue</button>
            </form>
          </div>
        `;
        document.body.appendChild(el);

        const form = el.querySelector('#admin-password-gate-form');
        const errEl = el.querySelector('#admin-gate-error');
        const pw1 = el.querySelector('#admin-gate-pw');
        const pw2 = el.querySelector('#admin-gate-pw2');
        pw1.focus();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errEl.hidden = true;
            const p1 = pw1.value;
            const p2 = pw2.value;
            if (p1 !== p2) {
                errEl.textContent = 'Passwords do not match.';
                errEl.hidden = false;
                return;
            }
            const btn = el.querySelector('#admin-gate-submit');
            btn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/auth/me`, {
                    method: 'PATCH',
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_password: p1 }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    errEl.textContent = formatApiErrorDetail(data);
                    errEl.hidden = false;
                    btn.disabled = false;
                    return;
                }
                currentUser = {
                    ...currentUser,
                    ...data,
                    assigned_site_ids: data.assigned_site_ids || [],
                    must_change_password: !!data.must_change_password,
                };
                localStorage.setItem('user', JSON.stringify(currentUser));
                el.remove();
                document.body.classList.remove('admin-password-gate-active');
                if (appRoot) appRoot.removeAttribute('inert');
                updateUserUI();
                resolve();
            } catch {
                errEl.textContent = 'Network error. Try again.';
                errEl.hidden = false;
                btn.disabled = false;
            }
        });
    });
}

async function initializeApp() {
    if (!checkAuth()) return;
    const sessionOk = await refreshCurrentUserFromServer();
    if (!sessionOk) return;
    if (currentUser.role === 'admin' && currentUser.must_change_password) {
        await runAdminPasswordGate();
    }

    initSidebarCollapse();
    initMobileSidebar();
    initSiteDetailHashRouting();
    setupNavigation();
    setupEventListeners();
    setupAnalyticsPeriodButtons();
    setupCustomizeTabs();
    updateUserUI();
    if (!isDashboardAgent()) {
        loadWhiteLabelConfig();
    }
    await loadSites();
    if (isDashboardAgent()) {
        switchView('handoffs');
    }
}

function checkAuth() {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    if (!token || !userStr) {
        window.location.href = '/login';
        return false;
    }
    
    try {
        currentUser = JSON.parse(userStr);
        if (!currentUser.assigned_site_ids) {
            currentUser.assigned_site_ids = [];
        }
        
        syncBodyRoleClasses();
        
        return true;
    } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return false;
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

function setUserAvatarEl(el) {
    if (!el) return;
    const initial = currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U';
    el.textContent = initial;
    if (currentUser.avatar_url) {
        const img = document.createElement('img');
        img.src = currentUser.avatar_url;
        img.alt = '';
        img.onload = () => { el.style.color = 'transparent'; };
        img.onerror = () => { img.remove(); el.style.color = ''; };
        el.appendChild(img);
    } else {
        el.style.color = '';
    }
}

function updateUserUI() {
    if (!currentUser) return;

    setUserAvatarEl(elements.userAvatar);
    elements.userName.textContent = currentUser.name || currentUser.email;
    const roleLabels = { admin: 'Admin', agent: 'Support agent', user: 'User' };
    elements.userRole.textContent = roleLabels[currentUser.role] || currentUser.role;

    setUserAvatarEl(document.getElementById('mobile-user-avatar'));
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

function setupNavigation() {
    const sidebar = document.getElementById('dashboard-sidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            const link = e.target.closest('.menu-item[data-view], .sidebar-util-link[data-view]');
            if (!link || !sidebar.contains(link)) return;
            e.preventDefault();
            switchView(navDataView(link));
        });
    }

    // Keyboard shortcuts (g+s, g+c, g+h, comma)
    let gPressed = false;
    let gTimer = null;
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        if (e.key === ',' && !e.metaKey && !e.ctrlKey) {
            switchView('settings');
            return;
        }
        if (e.key === 'g') {
            gPressed = true;
            clearTimeout(gTimer);
            gTimer = setTimeout(() => { gPressed = false; }, 1000);
            return;
        }
        if (gPressed) {
            gPressed = false;
            clearTimeout(gTimer);
            const map = { s: 'sites', c: 'conversations', h: 'handoffs' };
            const view = map[e.key];
            if (view) {
                switchView(view);
            }
        }
    });
}

function switchView(viewId) {
    const id = typeof viewId === 'string' ? viewId.trim() : String(viewId || '').trim();
    viewId = id;
    if (!viewId) {
        return;
    }

    if (isDashboardAgent() && !['handoffs', 'conversations', 'sites', 'settings', 'help'].includes(viewId)) {
        viewId = 'handoffs';
    }
    if (viewId === 'team' && isDashboardAgent()) {
        viewId = 'handoffs';
    }

    const viewEl = document.getElementById(`${viewId}-view`);
    if (!viewEl) {
        console.warn('Unknown view:', viewId);
        return;
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    viewEl.classList.add('active');

    // Mobile: clear back-nav state when switching top-level views
    mobileNav.pop();
    const sitesLayout = document.querySelector('#sites-view .master-detail-layout');
    if (sitesLayout) sitesLayout.classList.remove('mobile-detail-open');
    const convLayout = document.querySelector('.conversations-layout');
    if (convLayout) convLayout.classList.remove('detail-open');
    const handoffLayout = document.querySelector('.handoffs-layout');
    if (handoffLayout) handoffLayout.classList.remove('detail-open');

    syncSidebarActiveNav(viewId);

    // Close handoff SSE streams when navigating away
    if (viewId !== 'handoffs') {
        stopHandoffQueueStream();
        stopHandoffQueuePoll();
        stopMessageStream();
    }
    
    if (viewId === 'sites') {
        loadSites();
    } else if (viewId === 'chat') {
        updateSiteSelector();
    } else if (viewId === 'admin') {
        loadStats();
        loadAnalytics();
    } else if (viewId === 'conversations') {
        initConversationsView();
    } else if (viewId === 'settings') {
        initSettingsPanels();
        initProfileSettings();
        if (!isDashboardAgent()) {
            initWhiteLabelSettings();
            checkHealth();
        }
    } else if (viewId === 'handoffs') {
        populateHandoffSiteFilter();
        initHandoffsView();
    } else if (viewId === 'team') {
        initTeamView();
    } else if (viewId === 'platform') {
        initPlatformView();
    }
}

function setupEventListeners() {
    elements.addSiteBtn?.addEventListener('click', openAddSiteModal);
    elements.emptyAddBtn?.addEventListener('click', openAddSiteModal);
    elements.closeModal?.addEventListener('click', closeAddSiteModal);
    elements.closeDetailsPanel?.addEventListener('click', closeSidePanel);
    elements.sidePanelOverlay?.addEventListener('click', closeSidePanel);
    elements.chatForm?.addEventListener('submit', handleChatSubmit);
    elements.chatInput?.addEventListener('input', updateSendButton);
    elements.chatSiteSelect?.addEventListener('change', handleSiteSelect);
    elements.newChatBtn?.addEventListener('click', startNewChat);
    elements.refreshHealth?.addEventListener('click', checkHealth);
    elements.logoutBtn?.addEventListener('click', logout);
    
    document.getElementById('copy-detail-embed')?.addEventListener('click', copyDetailEmbed);
    document.getElementById('detail-get-embed-btn')?.addEventListener('click', () => switchToDetailTab('embed'));
    document.getElementById('detail-breadcrumb-sites')?.addEventListener('click', navigateDetailBreadcrumbSites);
    document.getElementById('recrawl-site')?.addEventListener('click', recrawlSite);
    document.getElementById('delete-site')?.addEventListener('click', deleteSite);
    
    // Source type selection
    document.querySelectorAll('.source-type-card').forEach(card => {
        card.addEventListener('click', () => handleSourceTypeSelect(card.dataset.type));
    });
    
    // Back buttons
    document.getElementById('back-to-source')?.addEventListener('click', showSourceTypeStep);
    document.getElementById('back-to-source-docs')?.addEventListener('click', showSourceTypeStep);
    document.getElementById('back-to-source-both')?.addEventListener('click', showSourceTypeStep);
    
    // Form submissions
    document.getElementById('website-form')?.addEventListener('submit', handleWebsiteSubmit);
    document.getElementById('documents-form')?.addEventListener('submit', handleDocumentsSubmit);
    document.getElementById('both-form')?.addEventListener('submit', handleBothSubmit);
    // member-form submit is wired in initTeamView
    
    // Brand detection buttons
    document.querySelectorAll('.fetch-brand-btn').forEach(btn =>
        btn.addEventListener('click', () => fetchBrandInfo(btn)));
    document.getElementById('fetch-brand-site')?.addEventListener('click', fetchSiteBrand);

    // File upload zones
    setupUploadZone('upload-zone', 'file-input', 'file-list', 'selectedFiles');
    setupUploadZone('upload-zone-both', 'file-input-both', 'file-list-both', 'selectedFilesBoth');
    setupUploadZone('upload-zone-existing', 'file-input-existing', 'file-list-existing', 'selectedFilesExisting');
    
    // Form tabs for "Both" option
    document.querySelectorAll('.form-tab').forEach(tab => {
        tab.addEventListener('click', () => switchFormTab(tab.dataset.tab));
    });
    
    // Upload modal for existing sites
    document.getElementById('add-documents-btn')?.addEventListener('click', openUploadModal);
    document.getElementById('close-upload-modal')?.addEventListener('click', closeUploadModal);
    document.getElementById('cancel-upload-modal')?.addEventListener('click', closeUploadModal);
    document.getElementById('add-video-btn')?.addEventListener('click', addVideoToSite);
    document.getElementById('upload-form')?.addEventListener('submit', handleExistingUpload);
    
    // Modal backdrop clicks
    elements.addSiteModal?.addEventListener('click', (e) => {
        if (e.target === elements.addSiteModal) closeAddSiteModal();
    });
    elements.uploadModal?.addEventListener('click', (e) => {
        if (e.target === elements.uploadModal) closeUploadModal();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (elements.siteDetailsPanel?.classList.contains('active')) {
                closeSidePanel();
            } else if (elements.addSiteModal?.classList.contains('active')) {
                closeAddSiteModal();
            } else if (elements.uploadModal?.classList.contains('active')) {
                closeUploadModal();
            }
        }
        const tag = e.target && e.target.tagName;
        const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
        if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey && !inField) {
            const toggle = document.getElementById('sidebar-toggle');
            if (toggle && window.matchMedia('(min-width: 769px)').matches) {
                e.preventDefault();
                toggle.click();
            }
        }
    });
}

async function loadSites() {
    try {
        const response = await fetch(`${API_BASE}/sites`, {
            headers: getAuthHeaders()
        });
        
        if (response.status === 401) {
            logout();
            return;
        }
        
        sites = await response.json();
        renderSites();
    } catch (error) {
        console.error('Failed to load sites:', error);
    }
}

function renderSites() {
    const sitesList = elements.sitesList || document.getElementById('sites-list');
    if (!sitesList) return;
    
    const existingItems = sitesList.querySelectorAll('.site-list-item');
    existingItems.forEach(item => item.remove());
    
    if (sites.length === 0) {
        currentDetailSite = null;
        if (elements.emptyState) elements.emptyState.style.display = 'flex';
        showDetailEmptyState();
        clearSiteDetailHash();
    } else {
        if (elements.emptyState) elements.emptyState.style.display = 'none';
        sites.forEach(site => {
            const item = createSiteListItem(site);
            sitesList.appendChild(item);
        });
        
        if (!currentDetailSite && sites.length > 0) {
            selectSite(sites[0]);
        }
    }
}

function createSiteListItem(site) {
    const item = document.createElement('div');
    item.className = 'site-list-item';
    item.dataset.siteId = site.site_id;
    
    if (currentDetailSite && currentDetailSite.site_id === site.site_id) {
        item.classList.add('active');
    }
    
    item.onclick = () => selectSite(site);
    
    const domain = site.url.replace(/https?:\/\//, '').replace(/\/$/, '');
    const initial = domain.charAt(0).toUpperCase();
    const statusClass = site.status === 'completed' ? 'completed' : site.status;
    const statusText = site.status === 'completed' ? 'Ready' : site.status.charAt(0).toUpperCase() + site.status.slice(1);
    
    item.innerHTML = `
        <div class="site-list-icon">${initial}${site.favicon_url ? `<img class="site-icon-img" src="${escapeHtml(site.favicon_url)}" alt="" onerror="this.remove()">` : ''}</div>
        <div class="site-list-info">
            <div class="site-list-name">${site.name || domain}</div>
            <div class="site-list-url">${domain}</div>
        </div>
        <span class="site-list-status ${statusClass}" ${site.status === 'failed' && site.error ? `title="${escapeHtml(site.error)}"` : ''}>${statusText}</span>
    `;
    if (site.status === 'failed' && site.error) {
        const err = document.createElement('div');
        err.className = 'site-list-error';
        err.textContent = site.error;
        item.appendChild(err);
    }
    
    return item;
}

function selectSite(site) {
    document.querySelectorAll('.site-list-item').forEach(item => item.classList.remove('active'));
    const siteItem = document.querySelector(`.site-list-item[data-site-id="${site.site_id}"]`);
    if (siteItem) siteItem.classList.add('active');
    
    openSiteDetails(site);
}

function showDetailEmptyState() {
    const detailContent = elements.detailContent || document.getElementById('detail-content');
    const detailEmpty = elements.detailEmptyState || document.getElementById('detail-empty-state');
    
    if (detailContent) detailContent.style.display = 'none';
    if (detailEmpty) detailEmpty.style.display = 'flex';
}

function showDetailContent() {
    const detailContent = elements.detailContent || document.getElementById('detail-content');
    const detailEmpty = elements.detailEmptyState || document.getElementById('detail-empty-state');
    
    if (detailContent) detailContent.style.display = 'flex';
    if (detailEmpty) detailEmpty.style.display = 'none';
}

function createSiteCard(site) {
    const card = document.createElement('div');
    card.className = 'site-card';
    card.dataset.siteId = site.site_id;
    card.onclick = () => {
        // Remove active class from all cards
        document.querySelectorAll('.site-card').forEach(c => c.classList.remove('active'));
        // Add active class to clicked card
        card.classList.add('active');
        openSiteDetails(site);
    };
    
    const domain = site.url.replace(/https?:\/\//, '').replace(/\/$/, '');
    const initial = domain.charAt(0).toUpperCase();
    const statusClass = site.status === 'completed' ? 'ready' : site.status;
    const statusText = site.status === 'completed' ? 'Ready' : site.status.charAt(0).toUpperCase() + site.status.slice(1);
    
    card.innerHTML = `
        <div class="site-card-header">
            <div class="site-info">
                <div class="site-favicon">${initial}${site.favicon_url ? `<img class="site-icon-img" src="${escapeHtml(site.favicon_url)}" alt="" onerror="this.remove()">` : ''}</div>
                <div>
                    <div class="site-name">${site.name || domain}</div>
                    <div class="site-url">${domain}</div>
                </div>
            </div>
            <span class="status-badge ${statusClass}">
                <span class="dot"></span>
                ${statusText}
            </span>
        </div>
        ${site.status === 'failed' && site.error ? `
            <div class="site-card-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>${site.error}</span>
            </div>
        ` : `
            <div class="site-card-stats">
                <div class="site-stat">
                    <span class="site-stat-value">${site.pages_crawled || 0}</span>
                    <span class="site-stat-label">Pages</span>
                </div>
                <div class="site-stat">
                    <span class="site-stat-value">${site.pages_indexed || 0}</span>
                    <span class="site-stat-label">Indexed</span>
                </div>
            </div>
        `}
    `;
    
    return card;
}

function openAddSiteModal() {
    resetBrandState();
    elements.addSiteModal.classList.add('active');
    showSourceTypeStep();
}

function closeAddSiteModal() {
    elements.addSiteModal.classList.remove('active');
    resetModalState();
}

function resetModalState() {
    currentSourceType = null;
    selectedFiles = [];
    selectedFilesBoth = [];
    
    // Reset forms
    document.getElementById('website-form')?.reset();
    document.getElementById('documents-form')?.reset();
    document.getElementById('both-form')?.reset();
    
    // Clear file lists
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('file-list-both').innerHTML = '';
    
    // Reset submit buttons
    document.getElementById('submit-documents').disabled = true;
    
    // Reset source type selection
    document.querySelectorAll('.source-type-card').forEach(c => c.classList.remove('selected'));
    
    // Show first step
    showSourceTypeStep();
}

function showSourceTypeStep() {
    document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
    document.getElementById('step-source-type').classList.add('active');
    document.getElementById('modal-title').textContent = 'Add Knowledge Source';
}

function handleSourceTypeSelect(type) {
    currentSourceType = type;
    
    // Update visual selection
    document.querySelectorAll('.source-type-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`[data-type="${type}"]`).classList.add('selected');
    
    // Show appropriate step
    document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
    
    if (type === 'website') {
        document.getElementById('step-website').classList.add('active');
        document.getElementById('modal-title').textContent = 'Crawl Website';
        document.getElementById('site-url').focus();
    } else if (type === 'documents') {
        document.getElementById('step-documents').classList.add('active');
        document.getElementById('modal-title').textContent = 'Upload Documents';
        document.getElementById('doc-site-name').focus();
    } else if (type === 'both') {
        document.getElementById('step-both').classList.add('active');
        document.getElementById('modal-title').textContent = 'Website + Documents';
        document.getElementById('both-site-url').focus();
    }
}

function switchFormTab(tabId) {
    document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    
    document.querySelectorAll('.form-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
}

// File upload zone setup
function setupUploadZone(zoneId, inputId, listId, filesVar) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    
    if (!zone || !input) return;
    
    // Click to open file picker
    zone.addEventListener('click', () => input.click());
    
    // Drag and drop events
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });
    
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files, filesVar, listId);
    });
    
    // File input change
    input.addEventListener('change', () => {
        handleFiles(input.files, filesVar, listId);
        input.value = '';
    });
}

function handleFiles(fileList, filesVar, listId) {
    const files = Array.from(fileList);
    const validExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.pptx', '.xlsx', '.html', '.htm'];
    
    files.forEach(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!validExtensions.includes(ext)) {
            alert(`${file.name} is not a supported file type.`);
            return;
        }
        
        if (file.size > 50 * 1024 * 1024) {
            alert(`${file.name} is too large (max 50MB).`);
            return;
        }
        
        // Add to appropriate array
        if (filesVar === 'selectedFiles') {
            selectedFiles.push(file);
        } else if (filesVar === 'selectedFilesBoth') {
            selectedFilesBoth.push(file);
        } else if (filesVar === 'selectedFilesExisting') {
            selectedFilesExisting.push(file);
        }
    });
    
    // Update file list display
    renderFileList(filesVar, listId);
    
    // Update submit button state
    updateDocumentSubmitButton();
}

function renderFileList(filesVar, listId) {
    const list = document.getElementById(listId);
    let files;
    
    if (filesVar === 'selectedFiles') files = selectedFiles;
    else if (filesVar === 'selectedFilesBoth') files = selectedFilesBoth;
    else if (filesVar === 'selectedFilesExisting') files = selectedFilesExisting;
    
    list.innerHTML = files.map((file, idx) => {
        const ext = file.name.split('.').pop().toLowerCase();
        const iconClass = getFileIconClass(ext);
        const size = formatFileSize(file.size);
        
        return `
            <div class="file-item" data-index="${idx}">
                <div class="file-icon ${iconClass}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                </div>
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${size}</div>
                </div>
                <button type="button" class="file-remove" onclick="removeFile('${filesVar}', ${idx}, '${listId}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `;
    }).join('');
}

function removeFile(filesVar, index, listId) {
    if (filesVar === 'selectedFiles') {
        selectedFiles.splice(index, 1);
    } else if (filesVar === 'selectedFilesBoth') {
        selectedFilesBoth.splice(index, 1);
    } else if (filesVar === 'selectedFilesExisting') {
        selectedFilesExisting.splice(index, 1);
    }
    renderFileList(filesVar, listId);
    updateDocumentSubmitButton();
}

window.removeFile = removeFile;

function getFileIconClass(ext) {
    const iconMap = {
        'pdf': 'pdf',
        'docx': 'doc', 'doc': 'doc',
        'txt': 'txt', 'md': 'txt',
        'csv': 'csv',
        'pptx': 'ppt', 'ppt': 'ppt',
        'xlsx': 'xls', 'xls': 'xls',
        'html': 'txt', 'htm': 'txt'
    };
    return iconMap[ext] || 'default';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function updateDocumentSubmitButton() {
    const submitDocs = document.getElementById('submit-documents');
    const submitUpload = document.getElementById('submit-upload');
    
    if (submitDocs) {
        submitDocs.disabled = selectedFiles.length === 0;
    }
    if (submitUpload) {
        submitUpload.disabled = selectedFilesExisting.length === 0;
    }
}

// Form submission handlers
async function handleWebsiteSubmit(e) {
    e.preventDefault();
    
    const url = document.getElementById('site-url').value;
    const name = document.getElementById('site-name').value;
    const maxPages = parseInt(document.getElementById('max-pages').value) || 50;
    
    const submitBtn = document.getElementById('submit-website');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        const setupResponse = await fetch(`${API_BASE}/embed/setup`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ url, name, max_pages: maxPages })
        });
        
        if (setupResponse.status === 401) {
            logout();
            return;
        }
        
        if (!setupResponse.ok) {
            const err = await setupResponse.json();
            throw new Error(err.detail || 'Failed to setup site');
        }
        
        const setupData = await setupResponse.json();
        
        closeAddSiteModal();
        await loadSites();
        pollSiteStatus(setupData.site_id);
        const websiteBrand = detectedBrands['site-url'] || await fetchBrandInfoQuiet(url);
        if (websiteBrand) applyBrandToSite(setupData.site_id, websiteBrand);
        
    } catch (error) {
        console.error('Failed to add site:', error);
        alert(error.message || 'Failed to add site. Please try again.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

async function handleDocumentsSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('doc-site-name').value;
    
    if (selectedFiles.length === 0) {
        alert('Please select at least one file to upload.');
        return;
    }
    
    const submitBtn = document.getElementById('submit-documents');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        // First create the site
        const siteId = generateSiteId(name);
        const token = localStorage.getItem('token');
        
        // Create site entry
        const setupResponse = await fetch(`${API_BASE}/embed/setup`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ 
                url: `docs://${siteId}`,
                name: name 
            })
        });
        
        if (!setupResponse.ok) {
            throw new Error('Failed to create knowledge base');
        }
        
        const setupData = await setupResponse.json();
        
        // Upload documents
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append('files', file));
        
        const uploadResponse = await fetch(`${API_BASE}/documents/upload/${setupData.site_id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!uploadResponse.ok) {
            throw new Error('Failed to upload documents');
        }
        
        const uploadResult = await uploadResponse.json();
        
        closeAddSiteModal();
        await loadSites();
        alert(`Successfully uploaded ${uploadResult.total_uploaded} documents!`);
        
    } catch (error) {
        console.error('Failed to upload documents:', error);
        alert(error.message || 'Failed to upload documents. Please try again.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

async function handleBothSubmit(e) {
    e.preventDefault();
    
    const url = document.getElementById('both-site-url').value;
    const name = document.getElementById('both-site-name').value;
    const maxPages = parseInt(document.getElementById('both-max-pages').value) || 50;
    
    const submitBtn = document.getElementById('submit-both');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        // Setup site and crawl with max_pages
        const setupResponse = await fetch(`${API_BASE}/embed/setup`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ url, name, max_pages: maxPages })
        });
        
        if (!setupResponse.ok) {
            throw new Error('Failed to setup site');
        }
        
        const setupData = await setupResponse.json();
        
        // Upload documents if any
        if (selectedFilesBoth.length > 0) {
            const token = localStorage.getItem('token');
            const formData = new FormData();
            selectedFilesBoth.forEach(file => formData.append('files', file));
            
            await fetch(`${API_BASE}/documents/upload/${setupData.site_id}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
        }
        
        closeAddSiteModal();
        await loadSites();
        pollSiteStatus(setupData.site_id);
        const bothBrand = detectedBrands['both-site-url'] || await fetchBrandInfoQuiet(url);
        if (bothBrand) applyBrandToSite(setupData.site_id, bothBrand);
        
    } catch (error) {
        console.error('Failed to create chatbot:', error);
        alert(error.message || 'Failed to create chatbot. Please try again.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// ── Brand detection (add-site modal) ──────────────────────────────
const detectedBrands = {}; // keyed by url-input id

async function fetchBrandInfo(btn) {
    const urlInput = document.getElementById(btn.dataset.urlInput);
    const preview = document.getElementById(btn.dataset.preview);
    const url = (urlInput?.value || '').trim();
    if (!/^https?:\/\//.test(url)) {
        alert('Enter a valid website URL first (https://…)');
        urlInput?.focus();
        return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Detecting…';
    try {
        const res = await fetch(`${API_BASE}/brand-info`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not detect brand info');
        detectedBrands[btn.dataset.urlInput] = data;
        renderBrandPreview(preview, data);
        const nameInput = document.getElementById(btn.dataset.nameInput);
        if (nameInput && !nameInput.value.trim() && data.name) nameInput.value = data.name;
    } catch (e) {
        detectedBrands[btn.dataset.urlInput] = null;
        if (preview) { preview.hidden = false; preview.innerHTML = `<p class="bp-error">${escapeHtml(e.message)}</p>`; }
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

function renderBrandPreview(preview, data) {
    if (!preview) return;
    const swatches = (data.colors?.palette || [])
        .map(c => `<span class="bp-swatch" style="background:${escapeHtml(c)}" title="${escapeHtml(c)}"></span>`).join('');
    const questions = (data.suggested_questions || [])
        .map(q => `<li>${escapeHtml(q.icon || '')} ${escapeHtml(q.text)}</li>`).join('');
    preview.hidden = false;
    preview.innerHTML = `
        <div class="bp-head">
            ${data.favicon ? `<img class="bp-icon" src="${escapeHtml(data.favicon)}" alt="" onerror="this.style.display='none'">` : ''}
            <strong>${escapeHtml(data.name || '')}</strong>
            <span class="bp-lang">${escapeHtml(data.language || 'en')}</span>
        </div>
        ${swatches ? `<div class="bp-colors">${swatches}</div>` : ''}
        ${questions ? `<ul class="bp-questions">${questions}</ul>` : ''}
        <p class="bp-note">These will be applied to the widget when the chatbot is created.</p>`;
}

async function fetchBrandInfoQuiet(url) {
    try {
        const res = await fetch(`${API_BASE}/brand-info`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

async function applyBrandToSite(siteId, brand) {
    const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
    const put = (path, payload) => fetch(`${API_BASE}${path}`, {
        method: 'PUT', headers, body: JSON.stringify(payload)
    }).catch(e => console.warn('brand apply failed:', path, e));
    try {
        await put(`/sites/${siteId}/meta`, { favicon_url: brand.favicon || null });
        await put(`/sites/${siteId}/config`, {
            appearance: {
                ...(brand.colors?.primary ? { primary_color: brand.colors.primary } : {}),
                ...(brand.favicon ? { bot_avatar_url: brand.favicon } : {})
            },
            help_center: {
                default_locale: brand.language || 'en',
                locales: [brand.language || 'en']
            }
        });
        if (brand.suggested_questions?.length) {
            await put(`/sites/${siteId}/quick-prompts`, {
                enabled: true,
                prompts: brand.suggested_questions.map(q => ({ text: q.text, icon: q.icon, type: 'suggestion', enabled: true })),
                max_display: 4
            });
        }
        await loadSites();
    } catch (e) {
        console.warn('Auto brand apply failed:', e);
    }
}

async function fetchSiteBrand() {
    if (!currentDetailSite?.url) return;
    const preview = document.getElementById('brand-preview-detail');
    const btn = document.getElementById('fetch-brand-site');
    btn.disabled = true;
    if (preview) { preview.hidden = false; preview.innerHTML = '<p class="bp-note">Detecting brand…</p>'; }
    try {
        const data = await fetchBrandInfoQuiet(currentDetailSite.url);
        if (!data) throw new Error('Could not detect brand info for this site');
        renderBrandPreview(preview, data);
        preview.insertAdjacentHTML('beforeend',
            '<div class="bp-actions"><button type="button" class="btn btn-primary btn-sm" id="bp-apply">Apply to this site</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="bp-dismiss">Dismiss</button></div>');
        preview.querySelector('#bp-apply').addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = 'Applying…';
            await applyBrandToSite(currentDetailSite.site_id, data);
            preview.hidden = true;
            openSiteDetails(currentDetailSite);
        });
        preview.querySelector('#bp-dismiss').addEventListener('click', () => { preview.hidden = true; });
    } catch (e) {
        preview.innerHTML = `<p class="bp-error">${escapeHtml(e.message)}</p>`;
    } finally {
        btn.disabled = false;
    }
}

function resetBrandState() {
    Object.keys(detectedBrands).forEach(k => delete detectedBrands[k]);
    document.querySelectorAll('.brand-preview').forEach(p => { p.hidden = true; p.innerHTML = ''; });
}

function generateSiteId(name) {
    const hash = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `${hash.substring(0, 6)}${random}`;
}

// Upload modal for existing sites
function openUploadModal() {
    selectedFilesExisting = [];
    document.getElementById('file-list-existing').innerHTML = '';
    document.getElementById('submit-upload').disabled = true;
    const videoRow = document.getElementById('video-add-row');
    const plan = String(currentUser?.plan || 'trial').toLowerCase();
    const canVideo = currentUser?.is_master || ['admin', 'master'].includes(String(currentUser?.role || '').toLowerCase())
        || ['advanced', 'enterprise'].includes(plan);
    if (videoRow) {
        videoRow.hidden = !canVideo;
        const inp = document.getElementById('video-url-input');
        const st = document.getElementById('video-add-status');
        if (inp) inp.value = '';
        if (st) { st.textContent = ''; st.className = 'video-add-status'; }
    }
    elements.uploadModal.classList.add('active');
}

async function addVideoToSite() {
    if (!currentDetailSite) return;
    const inp = document.getElementById('video-url-input');
    const st = document.getElementById('video-add-status');
    const btn = document.getElementById('add-video-btn');
    const url = (inp?.value || '').trim();
    if (!url.startsWith('http')) {
        if (st) { st.textContent = 'Paste a valid video URL first.'; st.className = 'video-add-status error'; }
        return;
    }
    btn.disabled = true;
    if (st) { st.textContent = 'Fetching video transcript…'; st.className = 'video-add-status'; }
    try {
        const res = await fetch(`${API_BASE}/documents/video/${currentDetailSite.site_id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to fetch video');
        if (st) { st.textContent = `Added "${data.title}" (${data.words} words) — indexing…`; st.className = 'video-add-status ok'; }
        inp.value = '';
    } catch (err) {
        if (st) { st.textContent = err.message; st.className = 'video-add-status error'; }
    } finally {
        btn.disabled = false;
    }
}

function closeUploadModal() {
    elements.uploadModal.classList.remove('active');
    selectedFilesExisting = [];
}

async function handleExistingUpload(e) {
    e.preventDefault();
    
    if (!currentDetailSite || selectedFilesExisting.length === 0) return;
    
    const submitBtn = document.getElementById('submit-upload');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        const token = localStorage.getItem('token');
        const formData = new FormData();
        selectedFilesExisting.forEach(file => formData.append('files', file));
        
        const response = await fetch(`${API_BASE}/documents/upload/${currentDetailSite.site_id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Failed to upload documents');
        }
        
        const result = await response.json();
        
        closeUploadModal();
        await loadSiteDocuments(currentDetailSite.site_id);
        alert(`Successfully uploaded ${result.total_uploaded} documents!`);
        
    } catch (error) {
        console.error('Failed to upload:', error);
        alert(error.message || 'Failed to upload documents.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

function pollSiteStatus(siteId) {
    const interval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/embed/status/${siteId}`);
            const data = await response.json();
            
            if (data.status === 'completed' || data.status === 'failed') {
                clearInterval(interval);
            }
            
            await loadSites();
        } catch (error) {
            console.error('Failed to poll status:', error);
        }
    }, 3000);
}

let currentDetailSite = null;

const VALID_DETAIL_TABS = [
    'appearance', 'embed', 'visibility', 'behavior', 'quick-prompts', 'triggers', 'training',
    'help-center', 'handoff', 'leads', 'notifications', 'security', 'crawling'
];

const DETAIL_TAB_LABELS = {
    appearance: 'Appearance',
    embed: 'Embed',
    visibility: 'Visibility',
    behavior: 'Behavior',
    'quick-prompts': 'Quick Prompts',
    triggers: 'Triggers',
    training: 'Training',
    'help-center': 'Help Center',
    handoff: 'Handoff',
    leads: 'Leads',
    notifications: 'Notifications',
    security: 'Security',
    crawling: 'Crawling'
};

const SIDEBAR_COLLAPSED_KEY = 'sitechat-sidebar-collapsed';

function getDetailTabFromHash() {
    const raw = (window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (!raw) return 'appearance';
    const tab = raw.split(/[?&]/)[0];
    return VALID_DETAIL_TABS.includes(tab) ? tab : 'appearance';
}

function clearSiteDetailHash() {
    const base = window.location.pathname + window.location.search;
    if (window.location.hash) {
        history.replaceState(null, '', base);
    }
}

function setSiteDetailHash(tabId) {
    if (!currentDetailSite) return;
    const base = window.location.pathname + window.location.search;
    history.replaceState(null, '', `${base}#${tabId}`);
}

function updateDetailBreadcrumbSection(tabId) {
    const sectionEl = document.getElementById('detail-breadcrumb-section');
    if (!sectionEl) return;
    const label = DETAIL_TAB_LABELS[tabId] || tabId;
    sectionEl.textContent = label;
}

function navigateDetailBreadcrumbSites() {
    currentDetailSite = null;
    document.querySelectorAll('.site-card, .site-list-item').forEach(c => c.classList.remove('active'));
    showDetailEmptyState();
    clearSiteDetailHash();
    // Mobile: exit full-screen detail mode
    const sitesLayout = document.querySelector('#sites-view .master-detail-layout');
    if (sitesLayout) sitesLayout.classList.remove('mobile-detail-open');
    mobileNav.pop();
}

/** @param {{ skipHash?: boolean }} [opts] */
function activateDetailTab(tabId, opts = {}) {
    const tabs = document.querySelectorAll('#detail-settings-nav .detail-tab');
    const panel = document.getElementById('detail-tab-content');
    if (!tabs.length) return;

    const valid = VALID_DETAIL_TABS.includes(tabId) ? tabId : 'appearance';

    tabs.forEach(t => {
        const on = t.dataset.tab === valid;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && panel && t.id) {
            panel.setAttribute('aria-labelledby', t.id);
        }
    });

    loadDetailTabContent(valid);
    if (!opts.skipHash) {
        setSiteDetailHash(valid);
    }
    updateDetailBreadcrumbSection(valid);
}

function initSiteDetailHashRouting() {
    window.addEventListener('hashchange', () => {
        if (!currentDetailSite) return;
        const sitesView = document.getElementById('sites-view');
        if (!sitesView?.classList.contains('active')) return;
        activateDetailTab(getDetailTabFromHash(), { skipHash: true });
        updateAppearanceEmbedCode();
        updateWidgetPreview();
    });
}

/** Mobile back-navigation stack */
const mobileNav = {
    _action: null,

    push(action, title) {
        this._action = action;
        document.body.classList.add('mobile-has-back');
        const titleEl = document.getElementById('mobile-topbar-title');
        if (titleEl) titleEl.textContent = title || '';
    },

    pop() {
        this._action = null;
        document.body.classList.remove('mobile-has-back');
        const titleEl = document.getElementById('mobile-topbar-title');
        if (titleEl) titleEl.textContent = '';
    },

    trigger() {
        if (typeof this._action === 'function') {
            this._action();
        }
        this.pop();
    }
};

function initMobileSidebar() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const backBtn = document.getElementById('mobile-back-btn');
    const overlay = document.getElementById('mobile-sidebar-overlay');
    const sidebar = document.getElementById('dashboard-sidebar');

    function openSidebar() {
        document.body.classList.add('sidebar-mobile-open');
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    }

    function closeSidebar() {
        document.body.classList.remove('sidebar-mobile-open');
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    }

    menuBtn?.addEventListener('click', () => {
        if (document.body.classList.contains('sidebar-mobile-open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    backBtn?.addEventListener('click', () => mobileNav.trigger());

    overlay?.addEventListener('click', closeSidebar);

    // Close on nav item click on mobile
    sidebar?.addEventListener('click', (e) => {
        if (window.matchMedia('(max-width: 768px)').matches) {
            if (e.target.closest('.menu-item, .sidebar-util-link')) {
                closeSidebar();
            }
        }
    });

    // Close on resize back to desktop
    window.matchMedia('(max-width: 768px)').addEventListener('change', (e) => {
        if (!e.matches) {
            closeSidebar();
            mobileNav.pop();
        }
    });
}

function initSidebarCollapse() {
    const btn = document.getElementById('sidebar-toggle');
    const mq = window.matchMedia('(min-width: 769px)');

    function applyCollapsed(collapsed) {
        if (!mq.matches) {
            document.body.classList.remove('sidebar-collapsed');
            if (btn) {
                btn.setAttribute('aria-expanded', 'true');
                btn.title = 'Collapse sidebar';
                btn.setAttribute('aria-label', 'Collapse sidebar');
            }
            return;
        }
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        if (btn) {
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
            btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        }
    }

    applyCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

    mq.addEventListener('change', () => {
        applyCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    });

    btn?.addEventListener('click', () => {
        if (!mq.matches) return;
        const next = !document.body.classList.contains('sidebar-collapsed');
        applyCollapsed(next);
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
    });
}

async function openSiteDetails(site) {
    destroyLivePreviewWidget();
    currentDetailSite = site;

    // Mobile: switch to full-screen detail mode
    const sitesLayout = document.querySelector('#sites-view .master-detail-layout');
    if (sitesLayout) sitesLayout.classList.add('mobile-detail-open');
    const siteName = site.name || site.url;
    mobileNav.push(() => {
        if (sitesLayout) sitesLayout.classList.remove('mobile-detail-open');
    }, siteName.replace(/https?:\/\//, '').replace(/\/$/, ''));

    showDetailContent();

    const iconLetter = siteName.replace(/https?:\/\//, '').charAt(0).toUpperCase();
    const detailIcon = document.getElementById('detail-icon');
    if (detailIcon) {
        detailIcon.innerHTML = iconLetter + (site.favicon_url ? `<img class="site-icon-img" src="${escapeHtml(site.favicon_url)}" alt="" onerror="this.remove()">` : '');
    }
    
    const nameEl = document.getElementById('detail-site-name');
    if (nameEl) nameEl.textContent = siteName;
    
    const urlEl = document.getElementById('detail-url-small');
    if (urlEl) {
        urlEl.textContent = site.url.replace(/https?:\/\//, '');
        urlEl.href = site.url;
    }
    
    const statusEl = document.getElementById('detail-status');
    if (statusEl) {
        const statusClass = site.status === 'completed' ? 'ready' : site.status;
        const statusText = site.status === 'completed' ? 'Ready' : site.status.charAt(0).toUpperCase() + site.status.slice(1);
        statusEl.innerHTML = `<span class="status-badge ${statusClass}"><span class="dot"></span>${statusText}</span>`;
    }
    
    const pagesEl = document.getElementById('detail-pages');
    if (pagesEl) pagesEl.textContent = site.pages_crawled || 0;
    
    const indexedEl = document.getElementById('detail-indexed');
    if (indexedEl) indexedEl.textContent = site.pages_indexed || 0;
    
    const docs = await loadSiteDocuments(site.site_id);
    const docsCountEl = document.getElementById('detail-docs-count');
    if (docsCountEl) docsCountEl.textContent = docs?.length || 0;
    
    await loadSiteConfig(site.site_id);

    const breadcrumbSite = document.getElementById('detail-breadcrumb-site-name');
    if (breadcrumbSite) breadcrumbSite.textContent = siteName;

    activateDetailTab(getDetailTabFromHash());

    updateAppearanceEmbedCode();
    updateWidgetPreview();

    setupDetailTabs();
    setupQuickActions();
}

function setupQuickActions() {
    const recrawlBtn = document.getElementById('recrawl-site');
    if (recrawlBtn) {
        recrawlBtn.onclick = recrawlSite;
    }
    
    const addDocsBtn = document.getElementById('add-documents-btn');
    if (addDocsBtn) {
        addDocsBtn.onclick = openUploadModal;
    }
    
    const deleteBtn = document.getElementById('delete-site');
    if (deleteBtn) {
        deleteBtn.onclick = deleteSite;
    }
}

function closeSidePanel() {
    if (elements.siteDetailsPanel) {
        elements.siteDetailsPanel.classList.remove('active');
    }
    if (elements.sidePanelOverlay) {
        elements.sidePanelOverlay.classList.remove('active');
    }
    document.body.style.overflow = '';
    document.querySelectorAll('.site-card, .site-list-item').forEach(c => c.classList.remove('active'));
}

function setupDetailTabs() {
    const tabs = document.querySelectorAll('#detail-settings-nav .detail-tab');

    tabs.forEach(tab => {
        tab.onclick = () => activateDetailTab(tab.dataset.tab);
    });
}

/** Jump to a site-detail tab (e.g. from header "Get code" → Embed). */
function switchToDetailTab(tabId) {
    activateDetailTab(tabId);
}

function loadDetailTabContent(tabId) {
    const tabContentContainer = document.getElementById('detail-tab-content');
    if (!tabContentContainer) return;
    if (tabId !== 'appearance') destroyLivePreviewWidget();
    
    let content = '';
    
    switch(tabId) {
        case 'appearance':
            content = getAppearanceTabContent();
            break;
        case 'behavior':
            content = getBehaviorTabContent();
            break;
        case 'quick-prompts':
            content = getQuickPromptsTabContent();
            break;
        case 'triggers':
            content = getTriggersTabContent();
            break;
        case 'training':
            renderTrainingTab();
            return;
        case 'help-center':
            content = getHelpCenterTabContent();
            break;
        case 'handoff':
            content = getHandoffTabContent();
            break;
        case 'security':
            content = getSecurityTabContent();
            break;
        case 'crawling':
            content = getCrawlingTabContent();
            break;
        case 'embed':
            content = getEmbedTabContent();
            break;
        case 'visibility':
            content = getVisibilityTabContent();
            break;
        case 'leads':
            content = getLeadsTabContent();
            break;
        case 'notifications':
            content = getNotificationsTabContent();
            break;
        default:
            content = '<p>Tab content not available</p>';
    }
    
    tabContentContainer.innerHTML = content;
    
    initTabHandlers(tabId);
}

function initTabHandlers(tabId) {
    switch(tabId) {
        case 'appearance':
            initAppearanceHandlers();
            loadSecureEmbedCode();
            break;
        case 'behavior':
            initBehaviorHandlers();
            break;
        case 'quick-prompts':
            initQuickPromptsHandlers();
            loadQuickPrompts();
            break;
        case 'triggers':
            loadTriggers();
            break;
        case 'help-center':
            initHelpCenterHandlers();
            loadHelpCenterStatus();
            loadHelpCenterContent();
            loadHcDomainStatus();
            break;
        case 'handoff':
            loadHandoffConfig();
            break;
        case 'security':
            loadSecurityConfig();
            break;
        case 'crawling':
            if (currentDetailSite) loadCrawlSchedule(currentDetailSite.site_id);
            break;
        case 'embed':
            loadSecureEmbedCode();
            break;
        case 'visibility':
            initVisibilityHandlers();
            break;
        case 'leads':
            initLeadsHandlers();
            loadLeads();
            break;
        case 'notifications':
            initNotificationsHandlers();
            loadNotificationsConfig();
            break;
    }
}

const LAUNCHER_ICONS = {
    chat_bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    chat_bubble_dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><circle cx="8.5" cy="11.5" r="1" fill="currentColor"/><circle cx="12" cy="11.5" r="1" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1" fill="currentColor"/></svg>',
    headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
    question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    lightning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    envelope: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>',
    smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    gem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 18 3 22 9 12 22 2 9"/><path d="M2 9h20M9 3l3 6 3-6M12 9l0 13"/></svg>'
};
const DEFAULT_LAUNCHER_SVG = LAUNCHER_ICONS.chat_bubble;

const SOUND_OPTIONS = [
    'none', 'bell', 'bell2', 'bright', 'bright2', 'bubble', 'bubble2', 'click', 'click2',
    'digital', 'fantasy', 'glass', 'liquid', 'notes', 'plucky', 'soft', 'soft2'
];
const SOUND_LABELS = {
    none: 'None', bell: 'Bell', bell2: 'Bell 2', bright: 'Bright', bright2: 'Bright 2',
    bubble: 'Bubble', bubble2: 'Bubble 2', click: 'Click', click2: 'Click 2',
    digital: 'Digital', fantasy: 'Fantasy', glass: 'Glass', liquid: 'Liquid',
    notes: 'Notes', plucky: 'Plucky', soft: 'Soft', soft2: 'Soft 2'
};
const SOUND_PRESETS_DASH = {
    bell:    [{ f: 880, t: 0, d: 0.35, w: 'sine' }, { f: 660, t: 0.12, d: 0.4, w: 'sine' }],
    bell2:   [{ f: 1046, t: 0, d: 0.3, w: 'sine' }, { f: 784, t: 0.15, d: 0.35, w: 'sine' }],
    bright:  [{ f: 523, t: 0, d: 0.15, w: 'triangle' }, { f: 659, t: 0.08, d: 0.15, w: 'triangle' }, { f: 784, t: 0.16, d: 0.3, w: 'triangle' }],
    bright2: [{ f: 659, t: 0, d: 0.12, w: 'triangle' }, { f: 880, t: 0.07, d: 0.12, w: 'triangle' }, { f: 1174, t: 0.14, d: 0.28, w: 'triangle' }],
    bubble:  [{ f: 600, t: 0, d: 0.08, w: 'sine', sweep: 900 }, { f: 900, t: 0.09, d: 0.12, w: 'sine', sweep: 500 }],
    bubble2: [{ f: 500, t: 0, d: 0.07, w: 'sine', sweep: 800 }, { f: 700, t: 0.08, d: 0.07, w: 'sine', sweep: 1000 }, { f: 900, t: 0.16, d: 0.1, w: 'sine', sweep: 600 }],
    click:   [{ f: 1200, t: 0, d: 0.05, w: 'square', vol: 0.12 }],
    click2:  [{ f: 1000, t: 0, d: 0.04, w: 'square', vol: 0.12 }, { f: 1400, t: 0.07, d: 0.05, w: 'square', vol: 0.12 }],
    digital: [{ f: 440, t: 0, d: 0.07, w: 'square', vol: 0.1 }, { f: 554, t: 0.08, d: 0.07, w: 'square', vol: 0.1 }, { f: 659, t: 0.16, d: 0.1, w: 'square', vol: 0.1 }],
    fantasy: [{ f: 523, t: 0, d: 0.4, w: 'sine' }, { f: 659, t: 0.05, d: 0.4, w: 'sine' }, { f: 784, t: 0.1, d: 0.4, w: 'sine' }, { f: 1046, t: 0.15, d: 0.45, w: 'sine' }],
    glass:   [{ f: 1568, t: 0, d: 0.5, w: 'sine', vol: 0.15 }, { f: 2093, t: 0.02, d: 0.4, w: 'sine', vol: 0.08 }],
    liquid:  [{ f: 300, t: 0, d: 0.15, w: 'sine', sweep: 220 }, { f: 400, t: 0.1, d: 0.2, w: 'sine', sweep: 320 }],
    notes:   [{ f: 587, t: 0, d: 0.25, w: 'sine' }, { f: 880, t: 0.15, d: 0.3, w: 'sine' }],
    plucky:  [{ f: 660, t: 0, d: 0.09, w: 'triangle', vol: 0.3 }, { f: 990, t: 0.06, d: 0.1, w: 'triangle', vol: 0.2 }],
    soft:    [{ f: 440, t: 0, d: 0.35, w: 'sine', vol: 0.12, attack: 0.08 }],
    soft2:   [{ f: 392, t: 0, d: 0.3, w: 'sine', vol: 0.1, attack: 0.08 }, { f: 523, t: 0.12, d: 0.35, w: 'sine', vol: 0.1, attack: 0.08 }]
};
let previewAudioCtx = null;
function previewSound(name) {
    const notes = SOUND_PRESETS_DASH[name];
    if (!notes) return;
    try {
        if (!previewAudioCtx) previewAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (previewAudioCtx.state === 'suspended') previewAudioCtx.resume();
        const t0 = previewAudioCtx.currentTime;
        notes.forEach(n => {
            const osc = previewAudioCtx.createOscillator();
            const gain = previewAudioCtx.createGain();
            osc.type = n.w || 'sine';
            osc.frequency.setValueAtTime(n.f, t0 + n.t);
            if (n.sweep) osc.frequency.exponentialRampToValueAtTime(n.sweep, t0 + n.t + n.d);
            const vol = n.vol != null ? n.vol : 0.2;
            const attack = n.attack || 0.01;
            gain.gain.setValueAtTime(0, t0 + n.t);
            gain.gain.linearRampToValueAtTime(vol, t0 + n.t + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
            osc.connect(gain);
            gain.connect(previewAudioCtx.destination);
            osc.start(t0 + n.t);
            osc.stop(t0 + n.t + n.d + 0.05);
        });
    } catch (e) {}
}

function launcherIconPreview(icon) {
    if (!icon) return DEFAULT_LAUNCHER_SVG;
    if (LAUNCHER_ICONS[icon]) return LAUNCHER_ICONS[icon];
    if (icon.startsWith('data:') || icon.startsWith('http')) return `<img src="${escapeHtml(icon)}" alt="">`;
    return DEFAULT_LAUNCHER_SVG;
}

const WIDGET_THEMES = [
    { value: 'light', label: 'Light' },
    { value: 'light_accent', label: 'Light Accent' },
    { value: 'light_soft', label: 'Light Soft' },
    { value: 'pattern_light', label: 'Pattern Light' },
    { value: 'pattern_accent', label: 'Pattern Accent' },
    { value: 'dark', label: 'Dark' }
];

function themePaletteDash(primary, theme) {
    const light = {
        headerBg: '#FFFFFF', headerText: '#1E293B', chatBg: '#F1F5F9',
        botBg: '#FFFFFF', botColor: '#1E293B', userColor: '#FFFFFF',
        inputBg: '#FFFFFF', inputText: '#374151', muted: '#64748B', pattern: false
    };
    const palettes = {
        light: light,
        light_accent: Object.assign({}, light, { headerBg: primary, headerText: '#FFFFFF' }),
        light_soft: Object.assign({}, light, { chatBg: '#FFFFFF', botBg: '#F1F5F9' }),
        pattern_light: Object.assign({}, light, { pattern: true }),
        pattern_accent: Object.assign({}, light, { headerBg: primary, headerText: '#FFFFFF', pattern: true }),
        dark: {
            headerBg: '#111827', headerText: '#F9FAFB', chatBg: '#0B1220',
            botBg: '#1F2937', botColor: '#E5E7EB', userColor: '#FFFFFF',
            inputBg: '#1F2937', inputText: '#E5E7EB', muted: '#9CA3AF', pattern: false
        }
    };
    return palettes[theme] || light;
}

function themeCardPreview(theme, primary, selected) {
    const p = themePaletteDash(primary, theme);
    return `<div class="theme-card-preview" style="background:${p.chatBg}${p.pattern ? `;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Cg fill='none' stroke='%2394a3b8' stroke-opacity='0.25' stroke-width='1'%3E%3Cpath d='M8 8h10v7H8z'/%3E%3Cpath d='M26 24h10v7H26z'/%3E%3C/g%3E%3C/svg%3E&quot;)` : ''}">
        <div class="theme-card-header" style="background:${p.headerBg}"></div>
        <div class="theme-card-bubbles">
            <span class="theme-card-bubble" style="background:${p.botBg}"></span>
            <span class="theme-card-bubble user" style="background:${primary}"></span>
        </div>
    </div>`;
}

function getAppearanceTabContent() {
    const config = currentSiteConfig || {};
    const a = config.appearance || {};
    const primaryColor = a.primary_color || '#7B3DFB';
    const chatTitle = a.chat_title || 'Chat with us';
    const welcomeMsg = a.welcome_message || 'Hi! How can I help you today?';

    const colorField = (id, label, value, auto) => {
        const effective = value || auto || primaryColor;
        return `
            <div class="form-group">
                <label for="${id}">${label}</label>
                <div class="color-input-wrapper">
                    <input type="color" id="${id}" value="${effective}" class="color-input" data-auto-value="${auto || ''}">
                    <input type="text" id="${id}-text" value="${value || ''}" placeholder="${auto ? 'Auto (' + auto + ')' : '#RRGGBB'}" class="color-text-input">
                    ${auto ? `<button type="button" class="color-reset-btn" data-target="${id}" title="Reset to auto">↺</button>` : ''}
                </div>
            </div>`;
    };

    const launcherStyles = [
        { value: 'button', label: 'Button', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 10.5h7v5h-4l-3 3v-8z"/></svg>' },
        { value: 'text_button', label: 'Text Button', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="20" height="8" rx="4"/><path d="M6 12h6"/></svg>' },
        { value: 'agent_profile', label: 'Agent Profile', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>' },
        { value: 'quick_input', label: 'Quick Input', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="20" height="8" rx="4"/><path d="M18 9.5l-3 3M18 12.5h-4"/></svg>' },
    ];
    const launcherStyle = a.launcher_style || 'button';
    const fonts = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'System'];
    const pal = themePaletteDash(primaryColor, a.theme || 'light_accent');

    return `
        <div class="appearance-layout">
            <div class="tab-form" id="appearance-form">
                <details class="config-section" open>
                    <summary class="config-section-title">AI Agent Profile</summary>
                    <div class="config-section-body">
                        <div class="form-group">
                            <label for="config-title">Display Name</label>
                            <input type="text" id="config-title" placeholder="Chat with us" value="${escapeHtml(a.chat_title || '')}" class="form-input">
                        </div>
                        <div class="form-group">
                            <label for="config-agent-caption">Caption</label>
                            <input type="text" id="config-agent-caption" placeholder="Powered by AI" value="${escapeHtml(a.agent_caption || '')}" class="form-input">
                            <small class="form-help">Status line under the name, e.g. "Online" or "Disponível"</small>
                        </div>
                        <div class="form-group">
                            <label for="config-avatar-url">Profile Picture URL</label>
                            <div class="avatar-input-row">
                                <input type="url" id="config-avatar-url" placeholder="https://example.com/avatar.png" value="${escapeHtml(a.bot_avatar_url || '')}" class="form-input">
                                <div class="avatar-preview" id="avatar-preview">${a.bot_avatar_url ? `<img src="${escapeHtml(a.bot_avatar_url)}" alt="">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>'}</div>
                            </div>
                        </div>
                        <div class="form-group form-checkbox">
                            <input type="checkbox" id="config-show-online" ${a.show_online_indicator !== false ? 'checked' : ''}>
                            <label for="config-show-online">Show Online Indicator</label>
                        </div>
                        <div class="form-group">
                            <label for="config-welcome">Welcome Message</label>
                            <textarea id="config-welcome" placeholder="Hi! How can I help you today?" class="form-textarea" rows="2">${escapeHtml(a.welcome_message || '')}</textarea>
                        </div>
                        <div class="form-group form-checkbox">
                            <input type="checkbox" id="config-welcome-enabled" ${a.welcome_enabled !== false ? 'checked' : ''}>
                            <label for="config-welcome-enabled">Show Welcome Screen</label>
                        </div>
                        <div class="form-group">
                            <label for="config-welcome-title">Welcome Title</label>
                            <input type="text" id="config-welcome-title" placeholder="Hi there! 👋" value="${escapeHtml(a.welcome_title || '')}" class="form-input">
                        </div>
                        <div class="form-group">
                            <label for="config-welcome-icon">Welcome Icon</label>
                            <select id="config-welcome-icon" class="form-input">
                                <option value="default" ${(a.welcome_icon || 'default') === 'default' ? 'selected' : ''}>Default icon</option>
                                <option value="avatar" ${a.welcome_icon === 'avatar' ? 'selected' : ''}>Agent profile picture</option>
                                <option value="none" ${a.welcome_icon === 'none' ? 'selected' : ''}>Hidden</option>
                            </select>
                        </div>
                    </div>
                </details>

                <details class="config-section" open>
                    <summary class="config-section-title">Theme</summary>
                    <div class="config-section-body">
                        <div class="theme-grid">
                            ${WIDGET_THEMES.map(t => `
                                <label class="theme-card ${(a.theme || 'light_accent') === t.value ? 'selected' : ''}">
                                    <input type="radio" name="widget-theme" value="${t.value}" ${(a.theme || 'light_accent') === t.value ? 'checked' : ''} hidden>
                                    ${themeCardPreview(t.value, primaryColor)}
                                    <span class="theme-card-name">${t.label}</span>
                                </label>`).join('')}
                        </div>
                        <div class="form-group">
                            <label for="config-border-radius">Border Radius <span class="range-value" id="border-radius-val">${a.border_radius ?? 16}px</span></label>
                            <input type="range" id="config-border-radius" min="0" max="28" value="${a.border_radius ?? 16}" class="form-range">
                            <small class="form-help">Applies to the window, message bubbles and input field</small>
                        </div>
                        <small class="form-help">Theme sets defaults for header, chat background, messages, input and footer. Customize individual colors below — empty fields use the theme value.</small>
                    </div>
                </details>

                <details class="config-section" open>
                    <summary class="config-section-title">Placement &amp; Layout</summary>
                    <div class="config-section-body">
                        <div class="form-group">
                            <label>Launcher Button</label>
                            <div class="launcher-style-grid">
                                ${launcherStyles.map(s => `
                                    <label class="launcher-style-option ${launcherStyle === s.value ? 'selected' : ''}">
                                        <input type="radio" name="launcher-style" value="${s.value}" ${launcherStyle === s.value ? 'checked' : ''} hidden>
                                        <span class="launcher-style-icon">${s.icon}</span>
                                        <span class="launcher-style-name">${s.label}</span>
                                    </label>`).join('')}
                            </div>
                        </div>
                        <div class="form-group" id="launcher-text-group" style="${['text_button', 'quick_input'].includes(launcherStyle) ? '' : 'display:none'}">
                            <label for="config-launcher-text">Launcher Text</label>
                            <input type="text" id="config-launcher-text" placeholder="Ask us anything" value="${escapeHtml(a.launcher_text || '')}" class="form-input">
                        </div>
                        <div class="form-group">
                            <label>Launcher Icon</label>
                            <div class="launcher-icon-row">
                                <div class="launcher-icon-preview" id="launcher-icon-preview">${launcherIconPreview(a.launcher_icon)}</div>
                                <div class="launcher-icon-actions">
                                    <button type="button" class="btn btn-secondary btn-sm" id="launcher-icon-library-btn">Choose from Library</button>
                                    <button type="button" class="btn btn-secondary btn-sm" id="launcher-icon-upload-btn">Upload</button>
                                    <button type="button" class="btn btn-secondary btn-sm" id="launcher-icon-remove-btn" ${a.launcher_icon ? '' : 'disabled'}>Remove</button>
                                </div>
                                <input type="file" id="launcher-icon-file" accept="image/*" hidden>
                                <input type="hidden" id="config-launcher-icon" value="${escapeHtml(a.launcher_icon || '')}">
                            </div>
                            <div class="launcher-icon-library" id="launcher-icon-library" style="display:none"></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="config-position">Position</label>
                                <select id="config-position" class="form-select">
                                    <option value="bottom-right" ${(a.position || 'bottom-right') === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                                    <option value="bottom-center" ${a.position === 'bottom-center' ? 'selected' : ''}>Bottom Center</option>
                                    <option value="bottom-left" ${a.position === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="config-offset-y">Vertical Offset <span class="range-value" id="offset-y-val">${a.offset_y ?? 24}px</span></label>
                                <input type="range" id="config-offset-y" min="0" max="200" value="${a.offset_y ?? 24}" class="form-range">
                            </div>
                            <div class="form-group">
                                <label for="config-offset-x">Horizontal Offset <span class="range-value" id="offset-x-val">${a.offset_x ?? 24}px</span></label>
                                <input type="range" id="config-offset-x" min="0" max="200" value="${a.offset_x ?? 24}" class="form-range">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="config-window-width">Window Width (px)</label>
                                <input type="number" id="config-window-width" min="280" max="640" value="${a.window_width || 400}" class="form-input">
                            </div>
                            <div class="form-group">
                                <label for="config-window-height">Window Height (px)</label>
                                <input type="number" id="config-window-height" min="320" max="860" value="${a.window_height || 560}" class="form-input">
                            </div>
                        </div>
                        <div class="form-group form-checkbox">
                            <input type="checkbox" id="config-movable-window" ${a.movable_window ? 'checked' : ''}>
                            <label for="config-movable-window">Move &amp; resize window — visitors can drag and resize the chat window (desktop)</label>
                        </div>
                    </div>
                </details>

                <details class="config-section">
                    <summary class="config-section-title">Start Mode</summary>
                    <div class="config-section-body">
                        <div class="start-mode-options">
                            <label class="start-mode-option ${(a.start_mode || 'button_only') === 'button_only' ? 'selected' : ''}">
                                <input type="radio" name="start-mode" value="button_only" ${(a.start_mode || 'button_only') === 'button_only' ? 'checked' : ''}>
                                <span class="start-mode-name">Button Only</span>
                                <span class="start-mode-desc">Visitors open the chat manually.</span>
                            </label>
                            <label class="start-mode-option ${a.start_mode === 'greeting' ? 'selected' : ''}">
                                <input type="radio" name="start-mode" value="greeting" ${a.start_mode === 'greeting' ? 'checked' : ''}>
                                <span class="start-mode-name">Greeting &amp; Suggested Questions</span>
                                <span class="start-mode-desc">Shows a greeting and suggested questions above the launcher button.</span>
                            </label>
                            <label class="start-mode-option ${a.start_mode === 'auto_open' ? 'selected' : ''}">
                                <input type="radio" name="start-mode" value="auto_open" ${a.start_mode === 'auto_open' ? 'checked' : ''}>
                                <span class="start-mode-name">Open Chat Automatically</span>
                                <span class="start-mode-desc">The chat opens automatically for visitors on desktop devices only.</span>
                            </label>
                        </div>
                        <div class="form-group" id="greeting-message-group" style="${a.start_mode === 'greeting' ? '' : 'display:none'}">
                            <label for="config-greeting-message">Greeting Message</label>
                            <input type="text" id="config-greeting-message" placeholder="👋 Hi there! How can we help?" value="${escapeHtml(a.greeting_message || '')}" class="form-input">
                            <small class="form-help">Suggested questions come from your Quick Prompts</small>
                        </div>
                        <div class="form-group">
                            <label>Display Timing</label>
                            <div class="form-radio-group">
                                <label class="form-radio">
                                    <input type="radio" name="start-timing" value="0" ${(a.start_delay_seconds || 0) === 0 ? 'checked' : ''}>
                                    <span>On page load</span>
                                </label>
                                <label class="form-radio">
                                    <input type="radio" name="start-timing" value="delay" ${(a.start_delay_seconds || 0) > 0 ? 'checked' : ''}>
                                    <span>After delay</span>
                                </label>
                            </div>
                        </div>
                        <div class="form-group" id="start-delay-group" style="${(a.start_delay_seconds || 0) > 0 ? '' : 'display:none'}">
                            <label for="config-start-delay">Delay (seconds)</label>
                            <input type="number" id="config-start-delay" min="1" max="60" value="${a.start_delay_seconds || 5}" class="form-input" style="max-width:120px">
                        </div>
                    </div>
                </details>

                <details class="config-section">
                    <summary class="config-section-title">Sounds</summary>
                    <div class="config-section-body">
                        <div class="form-group">
                            <label for="config-sound-agent">Agent Message</label>
                            <div class="sound-select-row">
                                <select id="config-sound-agent" class="form-select">
                                    ${SOUND_OPTIONS.map(s => `<option value="${s}" ${(a.sound_agent_message || 'none') === s ? 'selected' : ''}>${SOUND_LABELS[s] || s}</option>`).join('')}
                                </select>
                                <button type="button" class="btn btn-secondary btn-sm sound-preview-btn" data-sound-select="config-sound-agent" title="Preview">▶</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="config-sound-visitor">Visitor Message</label>
                            <div class="sound-select-row">
                                <select id="config-sound-visitor" class="form-select">
                                    ${SOUND_OPTIONS.map(s => `<option value="${s}" ${(a.sound_visitor_message || 'none') === s ? 'selected' : ''}>${SOUND_LABELS[s] || s}</option>`).join('')}
                                </select>
                                <button type="button" class="btn btn-secondary btn-sm sound-preview-btn" data-sound-select="config-sound-visitor" title="Preview">▶</button>
                            </div>
                        </div>
                        <small class="form-help">Sounds play inside the visitor's browser when messages are sent or received.</small>
                    </div>
                </details>

                <details class="config-section">
                    <summary class="config-section-title">Customize Theme</summary>
                    <div class="config-section-body">
                        ${colorField('config-color', 'Accent Color', primaryColor)}
                        <h5 class="config-subsection-title">Launcher Button</h5>
                        ${colorField('config-launcher-bg', 'Button Background', a.launcher_background, primaryColor)}
                        ${colorField('config-launcher-icon-color', 'Icon Color', a.launcher_icon_color || '#FFFFFF')}
                        <h5 class="config-subsection-title">Header</h5>
                        ${colorField('config-header-bg', 'Header Background', a.header_background, pal.headerBg)}
                        ${colorField('config-header-text-color', 'Header Text Color', a.header_text_color, pal.headerText)}
                        ${colorField('config-online-color', 'Online Indicator Color', a.online_indicator_color || '#22C55E')}
                        <h5 class="config-subsection-title">Chat</h5>
                        ${colorField('config-chat-bg', 'Chat Background', a.chat_background, pal.chatBg)}
                        ${colorField('config-bot-bg', 'Bot Bubble Background', a.bot_message_background, pal.botBg)}
                        ${colorField('config-bot-color', 'Bot Message Color', a.bot_message_color, pal.botColor)}
                        ${colorField('config-user-bg', 'User Bubble Background', a.user_message_background, primaryColor)}
                        ${colorField('config-user-color', 'User Message Color', a.user_message_color, pal.userColor)}
                        <h5 class="config-subsection-title">Message Field</h5>
                        ${colorField('config-input-bg', 'Field Background', a.input_background, pal.inputBg)}
                        ${colorField('config-input-color', 'Field Text Color', a.input_text_color, pal.inputText)}
                        ${colorField('config-send-color', 'Send Button Color', a.send_button_color, primaryColor)}
                        <div class="form-group">
                            <label for="config-placeholder">Input Placeholder</label>
                            <input type="text" id="config-placeholder" placeholder="Type your message..." value="${escapeHtml(a.input_placeholder || '')}" class="form-input">
                        </div>
                        <h5 class="config-subsection-title">Font</h5>
                        <div class="form-group">
                            <select id="config-font" class="form-select">
                                ${fonts.map(f => `<option value="${f}" ${(a.font_family || 'Inter') === f ? 'selected' : ''}>${f}</option>`).join('')}
                            </select>
                        </div>
                        <h5 class="config-subsection-title">Footer</h5>
                        ${colorField('config-footer-color', 'Text Color', a.footer_text_color, pal.muted)}
                        <div class="form-group form-checkbox">
                            <input type="checkbox" id="config-footer-enabled" ${a.footer_enabled !== false ? 'checked' : ''}>
                            <label for="config-footer-enabled">Show disclaimer footer</label>
                        </div>
                        <div class="form-group" id="footer-text-group" style="${a.footer_enabled !== false ? '' : 'display:none'}">
                            <label for="config-footer-text">Disclaimer Text</label>
                            <textarea id="config-footer-text" placeholder="This is an AI agent. Answers may not always be accurate." class="form-textarea" rows="2">${escapeHtml(a.footer_text || '')}</textarea>
                            <small class="form-help">Shown above the branding link; leave empty to hide</small>
                        </div>
                    </div>
                </details>

                <details class="config-section">
                    <summary class="config-section-title">Branding</summary>
                    <div class="config-section-body">
                        <div class="form-group form-checkbox">
                            <input type="checkbox" id="config-hide-branding" ${a.hide_branding ? 'checked' : ''}>
                            <label for="config-hide-branding">Customize widget branding</label>
                        </div>
                        <div class="form-group" id="custom-branding-group" style="${a.hide_branding ? '' : 'display:none'}">
                            <label for="config-custom-branding">Your Branding Text</label>
                            <input type="text" id="config-custom-branding" placeholder="Powered by Your Company" value="${escapeHtml(a.custom_branding_text || '')}" class="form-input">
                            <small class="form-help">Leave empty to hide branding completely</small>
                        </div>
                        <div class="form-group" id="custom-branding-url-group" style="${a.hide_branding ? '' : 'display:none'}">
                            <label for="config-custom-branding-url">Branding Link URL (optional)</label>
                            <input type="url" id="config-custom-branding-url" placeholder="https://yourcompany.com" value="${escapeHtml(a.custom_branding_url || '')}" class="form-input">
                        </div>
                    </div>
                </details>

                <details class="config-section">
                    <summary class="config-section-title">Custom Code</summary>
                    <div class="config-section-body">
                        <div class="form-group">
                            <label for="config-custom-css">Custom CSS</label>
                            <textarea id="config-custom-css" class="form-textarea code-textarea" rows="4"
                                placeholder=".sitechat-window { border: 2px solid #000; }&#10;.sitechat-toggle { transform: scale(1.1); }">${escapeHtml(a.custom_css || '')}</textarea>
                            <small class="form-help">Injected into the page when the widget loads. Widget classes are prefixed <code>sitechat-</code>.</small>
                        </div>
                        <div class="form-group">
                            <label for="config-custom-js">Custom JavaScript</label>
                            <textarea id="config-custom-js" class="form-textarea code-textarea" rows="4"
                                placeholder="sitechat.open(); // opens the widget&#10;console.log(config.siteId);">${escapeHtml(a.custom_js || '')}</textarea>
                            <small class="form-help">Runs once when the widget finishes loading. Available: <code>sitechat.open()</code>, <code>sitechat.close()</code>, <code>sitechat.siteId</code>, <code>sitechat.apiUrl</code>, <code>config</code>. Only add code you trust — it executes on every page where the widget is embedded.</small>
                        </div>
                    </div>
                </details>

                <div class="form-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="reset-config">Reset to Default</button>
                    <button type="button" class="btn btn-primary btn-sm" id="save-config">Save Changes</button>
                </div>
            </div>

            <div class="widget-preview-container">
                <div class="preview-header-row">
                    <h4 class="preview-title">Live Preview</h4>
                </div>
                <div class="live-preview-card">
                    <p class="form-help">The real chat widget renders on this page — every change applies instantly: position, offsets, launcher, theme, greeting, radius and custom CSS.</p>
                    <div class="preview-actions">
                        <button type="button" class="btn btn-secondary btn-sm" id="preview-open-chat">Open chat</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="preview-close-chat">Close</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="preview-reload-widget">Reload</button>
                    </div>
                    <label class="toggle-label preview-enable-row">
                        <input type="checkbox" id="preview-enabled" checked>
                        <span class="toggle-switch"></span>
                        <span class="toggle-text">Show preview on page</span>
                    </label>
                </div>
            </div>

            <div class="embed-section appearance-embed-section">
                <h4>Embed Code</h4>
                <p>Copy this code and paste it into your website's HTML, just before the closing &lt;/body&gt; tag.</p>
                <div class="embed-code-container">
                    <pre id="appearance-embed-code" class="embed-code-preview">Loading...</pre>
                    <button type="button" class="btn btn-secondary btn-sm copy-embed-btn" id="copy-appearance-embed">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                        </svg>
                        Copy
                    </button>
                </div>
            </div>
        </div>
    `;
}

function getBehaviorTabContent() {
    const config = currentSiteConfig || {};
    const behavior = config.behavior || {};
    
    return `
        <div class="tab-form">
            <div class="form-group">
                <label for="config-prompt">System Prompt</label>
                <textarea id="config-prompt" placeholder="You are a helpful assistant..." class="form-textarea" rows="4">${behavior.system_prompt || ''}</textarea>
            </div>
            
            <div class="form-group">
                <label for="config-temperature">Temperature: <span id="temp-value">${behavior.temperature || 0.7}</span></label>
                <input type="range" id="config-temperature" min="0" max="2" step="0.1" value="${behavior.temperature || 0.7}" class="form-range">
                <div class="range-labels">
                    <span>Precise</span>
                    <span>Creative</span>
                </div>
            </div>
            
            <div class="form-group">
                <label for="config-max-tokens">Max Response Length</label>
                <input type="number" id="config-max-tokens" value="${behavior.max_tokens || 500}" min="50" max="4000" class="form-input">
            </div>
            
            <div class="form-group form-checkbox">
                <input type="checkbox" id="config-show-sources" ${behavior.show_sources !== false ? 'checked' : ''}>
                <label for="config-show-sources">Show source citations</label>
            </div>
            <div class="form-group form-checkbox">
                <input type="checkbox" id="config-product-cards" ${behavior.product_cards !== false ? 'checked' : ''}>
                <label for="config-product-cards">Show product cards for shop items mentioned in replies</label>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn btn-primary btn-sm" id="save-config">Save Changes</button>
            </div>
        </div>
    `;
}

function getQuickPromptsTabContent() {
    const config = currentSiteConfig || {};
    const quickPrompts = config.quick_prompts || {};
    const enabled = quickPrompts.enabled !== false;
    const showAfterResponse = quickPrompts.show_after_response === true;
    const maxDisplay = quickPrompts.max_display || 4;
    
    return `
        <div class="tab-form">
            <div class="quick-prompts-header">
                <div>
                    <h4>Quick Prompts / FAQ Starters</h4>
                    <p class="quick-prompts-description">Pre-configured conversation starters shown in the chat widget</p>
                </div>
                <label class="toggle-switch-label">
                    <input type="checkbox" id="quick-prompts-enabled" ${enabled ? 'checked' : ''}>
                    <span class="toggle-switch"></span>
                    <span>Enable Quick Prompts</span>
                </label>
            </div>
            
            <div class="quick-prompts-content" id="quick-prompts-content" style="${enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                <div class="quick-prompts-list-header">
                    <span>Prompts &amp; Cards</span>
                    <div class="quick-prompts-add-buttons">
                        <button type="button" class="btn btn-sm btn-primary" id="add-quick-prompt-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"/>
                                <line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                            Add Prompt
                        </button>
                        <button type="button" class="btn btn-sm btn-secondary" id="add-quick-card-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="5" width="18" height="14" rx="2"/>
                                <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            Add Card
                        </button>
                    </div>
                </div>
                
                <div class="quick-prompts-list" id="quick-prompts-list">
                    <div class="quick-prompts-loading">
                        <div class="spinner-sm"></div>
                        <span>Loading prompts...</span>
                    </div>
                </div>
                
                <div class="quick-prompts-empty hidden" id="quick-prompts-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="8" y1="10" x2="16" y2="10"/>
                    </svg>
                    <p>No quick prompts yet</p>
                    <button type="button" class="btn btn-sm btn-primary" id="add-quick-prompt-empty-btn">Add Your First Prompt</button>
                </div>
                
                <div class="form-divider"></div>
                
                <div class="quick-prompts-settings">
                    <div class="form-group">
                        <label for="quick-prompts-max-display">Maximum prompts to display</label>
                        <select id="quick-prompts-max-display" class="form-select">
                            <option value="2" ${maxDisplay === 2 ? 'selected' : ''}>2 prompts</option>
                            <option value="3" ${maxDisplay === 3 ? 'selected' : ''}>3 prompts</option>
                            <option value="4" ${maxDisplay === 4 ? 'selected' : ''}>4 prompts</option>
                            <option value="5" ${maxDisplay === 5 ? 'selected' : ''}>5 prompts</option>
                            <option value="6" ${maxDisplay === 6 ? 'selected' : ''}>6 prompts</option>
                        </select>
                    </div>
                    
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="quick-prompts-show-after-response" ${showAfterResponse ? 'checked' : ''}>
                        <label for="quick-prompts-show-after-response">Show quick prompts after bot responses</label>
                    </div>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn btn-primary btn-sm" id="save-quick-prompts">Save Changes</button>
            </div>
        </div>
    `;
}

function getTriggersTabContent() {
    return `
        <div class="tab-form">
            <div class="triggers-header">
                <p class="triggers-description">Automatically engage visitors based on their behavior</p>
                <button type="button" class="btn btn-sm btn-primary" id="add-trigger-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add Trigger
                </button>
            </div>
            
            <div class="triggers-list" id="triggers-list">
                <div class="triggers-loading">
                    <div class="spinner-sm"></div>
                    <span>Loading triggers...</span>
                </div>
            </div>
            
            <div class="triggers-settings" style="margin-top: 20px;">
                <div class="form-group">
                    <label for="global-cooldown">Cooldown between triggers</label>
                    <select id="global-cooldown" class="form-select">
                        <option value="10000">10 seconds</option>
                        <option value="30000" selected>30 seconds</option>
                        <option value="60000">1 minute</option>
                        <option value="300000">5 minutes</option>
                    </select>
                </div>
            </div>
        </div>
    `;
}

function getHandoffTabContent() {
    return `
        <div class="tab-form">
            <div class="handoff-settings-header">
                <h4>Human Handoff Settings</h4>
                <p>Configure when and how visitors can connect with human agents</p>
            </div>
            
            <div class="form-group">
                <label class="toggle-label">
                    <input type="checkbox" id="handoff-enabled" checked>
                    <span class="toggle-switch"></span>
                    Enable Human Agents
                </label>
                <span class="form-hint">Allow visitors to request a human agent</span>
                <span class="form-hint" id="handoff-agent-status" style="display:block;margin-top:6px;"></span>
            </div>
            
            <div class="form-group">
                <label for="confidence-threshold">AI Confidence Threshold</label>
                <div class="range-wrapper">
                    <input type="range" id="confidence-threshold" min="0" max="100" value="30" class="range-input">
                    <span class="range-value" id="confidence-threshold-value">30%</span>
                </div>
                <span class="form-hint">Suggest handoff when AI confidence is below this level</span>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn btn-primary" id="save-handoff-config">Save Handoff Settings</button>
            </div>
        </div>
    `;
}

function getSecurityTabContent() {
    return `
        <div class="tab-form">
            <div class="security-settings-header">
                <h4>Widget Security Settings</h4>
                <p>Configure domain restrictions and security options for your widget</p>
            </div>
            
            <div class="form-group">
                <label class="toggle-label">
                    <input type="checkbox" id="security-enforce-domain">
                    <span class="toggle-switch"></span>
                    Enforce Domain Validation
                </label>
                <span class="form-hint">Only allow widget to load on whitelisted domains</span>
            </div>
            
            <div class="form-group">
                <label for="security-allowed-domains">Allowed Domains</label>
                <div class="domain-list-container">
                    <div class="domain-input-wrapper">
                        <input type="text" id="security-new-domain" placeholder="example.com or *.example.com" class="form-input">
                        <button type="button" class="btn btn-secondary btn-sm" id="security-add-domain">Add</button>
                    </div>
                    <div class="domain-list" id="security-domain-list"></div>
                </div>
                <span class="form-hint">Use * as wildcard (e.g., *.example.com). Leave empty to allow all domains.</span>
            </div>
            
            <div class="form-divider"></div>
            
            <div class="form-group">
                <label class="toggle-label">
                    <input type="checkbox" id="security-require-referrer">
                    <span class="toggle-switch"></span>
                    Require Referrer Header
                </label>
                <span class="form-hint">Reject API requests without a valid Referer header</span>
            </div>
            
            <div class="form-group">
                <label for="security-rate-limit">Rate Limit (requests/minute)</label>
                <div class="range-wrapper">
                    <input type="range" id="security-rate-limit" min="10" max="200" value="60" class="range-input">
                    <span class="range-value" id="security-rate-limit-value">60</span>
                </div>
                <span class="form-hint">Maximum API requests per session per minute</span>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn btn-primary" id="save-security-config">Save Security Settings</button>
            </div>
        </div>
    `;
}

function getCrawlingTabContent() {
    return `
        <div class="tab-form">
            <div class="crawling-settings-header">
                <h4>Scheduled Re-crawling</h4>
                <p>Configure automatic re-crawling to keep your knowledge base up-to-date</p>
            </div>
            
            <div class="crawl-status-banner" id="crawl-status-banner" style="display: none;">
                <div class="crawl-status-icon">
                    <svg class="spinner" width="20" height="20" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
                        <path d="M12 2a10 10 0 0110 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="crawl-status-text">
                    <span class="crawl-status-title">Crawling in progress...</span>
                    <span class="crawl-status-detail" id="crawl-status-pages">0 pages crawled</span>
                </div>
            </div>
            
            <div class="crawl-quick-actions">
                <button type="button" class="btn btn-secondary" id="crawl-now-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                    </svg>
                    Crawl Now
                </button>
                <div class="crawl-info">
                    <span class="crawl-info-label">Last Crawl:</span>
                    <span class="crawl-info-value" id="last-crawl-time">Never</span>
                </div>
                <div class="crawl-info">
                    <span class="crawl-info-label">Next Scheduled:</span>
                    <span class="crawl-info-value" id="next-crawl-time">Not scheduled</span>
                </div>
            </div>
            
            <div class="form-section">
                <h5>Schedule Configuration</h5>
                
                <label class="toggle-row">
                    <input type="checkbox" id="crawl-schedule-enabled">
                    <span class="toggle-switch"></span>
                    Enable Scheduled Crawling
                </label>
                <span class="form-hint">Automatically re-crawl your website on a schedule</span>
                
                <div class="crawl-schedule-options" id="crawl-schedule-options">
                    <div class="form-group">
                        <label for="crawl-frequency">Frequency</label>
                        <select id="crawl-frequency" class="form-select">
                            <option value="daily">Daily (at 2:00 AM UTC)</option>
                            <option value="weekly" selected>Weekly (Sundays at 2:00 AM UTC)</option>
                            <option value="monthly">Monthly (1st day at 2:00 AM UTC)</option>
                            <option value="custom">Custom (Cron Expression)</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="custom-cron-group" style="display: none;">
                        <label for="crawl-custom-cron">Cron Expression</label>
                        <input type="text" id="crawl-custom-cron" placeholder="0 2 * * 0" class="form-input">
                        <span class="form-hint">Standard cron format: minute hour day month weekday</span>
                    </div>
                    
                    <div class="form-group">
                        <label for="crawl-max-pages">Max Pages</label>
                        <input type="number" id="crawl-max-pages" value="50" min="1" max="1000" class="form-input">
                        <span class="form-hint">Maximum pages to crawl (1-1000)</span>
                    </div>
                    
                    <div class="form-group">
                        <label for="crawl-include-patterns">Include URL Patterns</label>
                        <textarea id="crawl-include-patterns" class="form-textarea" rows="2" placeholder="/blog/*&#10;/docs/*"></textarea>
                        <span class="form-hint">One pattern per line. Leave empty to include all.</span>
                    </div>
                    
                    <div class="form-group">
                        <label for="crawl-exclude-patterns">Exclude URL Patterns</label>
                        <textarea id="crawl-exclude-patterns" class="form-textarea" rows="2" placeholder="/admin/*&#10;/private/*"></textarea>
                        <span class="form-hint">One pattern per line. URLs matching these will be skipped.</span>
                    </div>
                    
                    <label class="toggle-row">
                        <input type="checkbox" id="crawl-notify" checked>
                        <span class="toggle-switch"></span>
                        Notify on completion
                    </label>
                </div>
            </div>
            
            <div class="form-section">
                <h5>Crawl History</h5>
                <div class="crawl-history-table" id="crawl-history-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Trigger</th>
                                <th>Pages</th>
                                <th>Status</th>
                                <th>Duration</th>
                            </tr>
                        </thead>
                        <tbody id="crawl-history-tbody">
                            <tr class="empty-row"><td colspan="5">No crawl history available</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn btn-primary" id="save-crawl-schedule">Save Crawl Settings</button>
            </div>
        </div>
    `;
}

function getEmbedTabContent() {
    if (!currentDetailSite) return '<p>No site selected</p>';
    
    const baseUrl = window.location.origin;
    const embedCode = `<script>
(function() {
  var s = document.createElement('script');
  s.src = '${baseUrl}/widget/chatbot.js';
  s.async = true;
  s.dataset.siteId = '${currentDetailSite.site_id}';
  s.dataset.apiUrl = '${baseUrl}';
  document.head.appendChild(s);
})();
<\/script>`;
    
    return `
        <div class="tab-form">
            <div class="embed-section-header">
                <h4>Embed Code</h4>
                <p>Add this code to your website before the closing &lt;/body&gt; tag</p>
            </div>
            
            <div class="code-block">
                <pre><code id="detail-embed-code">${escapeHtml(embedCode)}</code></pre>
                <button type="button" class="code-copy" id="copy-detail-embed">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                    Copy
                </button>
            </div>
            
            <div class="security-sri-info" style="margin-top: 16px;">
                <span class="sri-label">SRI Hash:</span>
                <code id="security-sri-hash">Loading...</code>
            </div>
        </div>
    `;
}

// ==================== Visibility & Session Tab ====================

function getVisibilityTabContent() {
    if (!currentDetailSite) return '<p>No site selected</p>';
    const v = (currentSiteConfig && currentSiteConfig.visibility) || {};
    const s = (currentSiteConfig && currentSiteConfig.session) || {};
    const sched = v.schedule || {};
    const displayPages = v.display_pages || 'all';
    const devices = v.devices || 'all';
    const pageUrls = (v.page_urls || []).join('\n');
    const days = sched.days || [1, 2, 3, 4, 5];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const timezones = [
        '', 'UTC', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Paris',
        'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver',
        'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata',
        'Asia/Tokyo', 'Australia/Sydney'
    ];

    return `
        <div class="tab-form visibility-tab">
            <details class="config-section" open>
                <summary class="config-section-title">Display on pages</summary>
                <div class="config-section-body">
                    <div class="form-group form-radio-group">
                        <label class="form-radio">
                            <input type="radio" name="vis-pages" value="all" ${displayPages === 'all' ? 'checked' : ''}>
                            <span>Every page</span>
                        </label>
                        <label class="form-radio">
                            <input type="radio" name="vis-pages" value="include" ${displayPages === 'include' ? 'checked' : ''}>
                            <span>Only these pages</span>
                        </label>
                        <label class="form-radio">
                            <input type="radio" name="vis-pages" value="exclude" ${displayPages === 'exclude' ? 'checked' : ''}>
                            <span>Every page except</span>
                        </label>
                    </div>
                    <div class="form-group" id="vis-page-urls-group" style="${displayPages === 'all' ? 'display:none' : ''}">
                        <label for="vis-page-urls">Page URL patterns</label>
                        <textarea id="vis-page-urls" class="form-textarea code-textarea" rows="4"
                            placeholder="/pricing*&#10;https://example.com/checkout*&#10;/docs/*">${escapeHtml(pageUrls)}</textarea>
                        <small class="form-help">One pattern per line. <code>*</code> matches any characters. Patterns can be paths (<code>/blog/*</code>) or full URLs.</small>
                    </div>
                </div>
            </details>

            <details class="config-section" open>
                <summary class="config-section-title">Display on devices</summary>
                <div class="config-section-body">
                    <div class="form-group form-radio-group">
                        <label class="form-radio">
                            <input type="radio" name="vis-devices" value="all" ${devices === 'all' ? 'checked' : ''}>
                            <span>All devices</span>
                        </label>
                        <label class="form-radio">
                            <input type="radio" name="vis-devices" value="desktop" ${devices === 'desktop' ? 'checked' : ''}>
                            <span>Desktop only</span>
                        </label>
                        <label class="form-radio">
                            <input type="radio" name="vis-devices" value="mobile" ${devices === 'mobile' ? 'checked' : ''}>
                            <span>Mobile only</span>
                        </label>
                    </div>
                </div>
            </details>

            <details class="config-section" open>
                <summary class="config-section-title">Schedule</summary>
                <div class="config-section-body">
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="vis-schedule-enabled" ${sched.enabled ? 'checked' : ''}>
                        <label for="vis-schedule-enabled">Only show the widget on a schedule</label>
                    </div>
                    <div id="vis-schedule-fields" style="${sched.enabled ? '' : 'display:none'}">
                        <div class="form-group">
                            <label>Active days</label>
                            <div class="day-picker">
                                ${dayNames.map((name, i) => `
                                    <label class="day-chip ${days.includes(i) ? 'selected' : ''}">
                                        <input type="checkbox" class="vis-day" value="${i}" ${days.includes(i) ? 'checked' : ''}>
                                        <span>${name}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="vis-schedule-start">Start time</label>
                                <input type="time" id="vis-schedule-start" class="form-input" value="${escapeHtml(sched.start_time || '09:00')}">
                            </div>
                            <div class="form-group">
                                <label for="vis-schedule-end">End time</label>
                                <input type="time" id="vis-schedule-end" class="form-input" value="${escapeHtml(sched.end_time || '18:00')}">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="vis-schedule-tz">Timezone</label>
                            <select id="vis-schedule-tz" class="form-select">
                                ${timezones.map(tz => `<option value="${tz}" ${(sched.timezone || '') === tz ? 'selected' : ''}>${tz || "Visitor's local time"}</option>`).join('')}
                            </select>
                            <small class="form-help">End time may cross midnight (e.g. 18:00 – 02:00).</small>
                        </div>
                    </div>
                </div>
            </details>

            <details class="config-section" open>
                <summary class="config-section-title">Chat session</summary>
                <div class="config-section-body">
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="sess-persist" ${s.persist_session !== false ? 'checked' : ''}>
                        <label for="sess-persist">Keep the conversation across page loads</label>
                    </div>
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="sess-persist-visitor" ${s.persist_visitor !== false ? 'checked' : ''}>
                        <label for="sess-persist-visitor">Remember the visitor between visits (page views, triggers)</label>
                    </div>
                    <div class="form-group">
                        <label for="sess-timeout">Start a new conversation after inactivity</label>
                        <div class="input-suffix-group">
                            <input type="number" id="sess-timeout" class="form-input" min="0" max="10080" value="${s.session_timeout_minutes || 0}">
                            <span class="input-suffix">minutes</span>
                        </div>
                        <small class="form-help">0 = the session never expires</small>
                    </div>
                </div>
            </details>

            <div class="form-actions">
                <span class="visibility-status" id="visibility-status"></span>
                <button type="button" class="btn btn-primary btn-sm" id="save-visibility">Save Changes</button>
            </div>
        </div>
    `;
}

function initVisibilityHandlers() {
    const pageRadios = document.querySelectorAll('input[name="vis-pages"]');
    pageRadios.forEach(r => r.addEventListener('change', () => {
        const mode = document.querySelector('input[name="vis-pages"]:checked')?.value || 'all';
        const group = document.getElementById('vis-page-urls-group');
        if (group) group.style.display = mode === 'all' ? 'none' : '';
    }));

    const schedToggle = document.getElementById('vis-schedule-enabled');
    schedToggle?.addEventListener('change', () => {
        const fields = document.getElementById('vis-schedule-fields');
        if (fields) fields.style.display = schedToggle.checked ? '' : 'none';
    });

    document.querySelectorAll('.day-chip input').forEach(cb => {
        cb.addEventListener('change', () => cb.closest('.day-chip').classList.toggle('selected', cb.checked));
    });

    document.getElementById('save-visibility')?.addEventListener('click', saveVisibilityConfig);
}

async function saveVisibilityConfig() {
    if (!currentDetailSite) return;
    const btn = document.getElementById('save-visibility');
    const status = document.getElementById('visibility-status');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const days = [...document.querySelectorAll('.vis-day:checked')].map(cb => parseInt(cb.value, 10));
    const body = {
        visibility: {
            display_pages: document.querySelector('input[name="vis-pages"]:checked')?.value || 'all',
            page_urls: (document.getElementById('vis-page-urls')?.value || '')
                .split('\n').map(l => l.trim()).filter(Boolean),
            devices: document.querySelector('input[name="vis-devices"]:checked')?.value || 'all',
            schedule: {
                enabled: document.getElementById('vis-schedule-enabled')?.checked || false,
                days: days.length ? days : [1, 2, 3, 4, 5],
                start_time: document.getElementById('vis-schedule-start')?.value || '09:00',
                end_time: document.getElementById('vis-schedule-end')?.value || '18:00',
                timezone: document.getElementById('vis-schedule-tz')?.value || null,
            }
        },
        session: {
            persist_session: document.getElementById('sess-persist')?.checked !== false,
            persist_visitor: document.getElementById('sess-persist-visitor')?.checked !== false,
            session_timeout_minutes: parseInt(document.getElementById('sess-timeout')?.value, 10) || 0,
        }
    };

    try {
        const res = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('Save failed');
        currentSiteConfig = await res.json();
        btn.textContent = 'Saved!';
        if (status) status.textContent = '';
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
    } catch (e) {
        console.error('Failed to save visibility config:', e);
        if (status) status.textContent = 'Failed to save';
        btn.textContent = original;
        btn.disabled = false;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function initAppearanceHandlers() {
    const form = document.getElementById('appearance-form');
    if (!form) return;

    // Delegated: any input/change inside the form refreshes the preview
    form.addEventListener('input', (e) => {
        const el = e.target;
        // Sync color picker <-> hex text input pairs
        if (el.classList.contains('color-input')) {
            const textInput = document.getElementById(el.id + '-text');
            if (textInput) textInput.value = el.value;
        } else if (el.classList.contains('color-text-input')) {
            const picker = document.getElementById(el.id.replace(/-text$/, ''));
            if (picker && /^#[0-9A-Fa-f]{6}$/.test(el.value)) picker.value = el.value;
        }
        updateWidgetPreview();
    });
    form.addEventListener('change', updateWidgetPreview);

    // Auto-color reset buttons (↺) — empty value = inherit primary
    form.addEventListener('click', (e) => {
        const resetBtn = e.target.closest('.color-reset-btn');
        if (resetBtn) {
            const picker = document.getElementById(resetBtn.dataset.target);
            const textInput = document.getElementById(resetBtn.dataset.target + '-text');
            if (picker && picker.dataset.autoValue) picker.value = picker.dataset.autoValue;
            if (textInput) textInput.value = '';
            updateWidgetPreview();
        }
    });

    // Launcher style radio cards
    form.querySelectorAll('input[name="launcher-style"]').forEach(radio => {
        radio.addEventListener('change', () => {
            form.querySelectorAll('.launcher-style-option').forEach(o => o.classList.remove('selected'));
            radio.closest('.launcher-style-option').classList.add('selected');
            const textGroup = document.getElementById('launcher-text-group');
            if (textGroup) {
                textGroup.style.display = ['text_button', 'quick_input'].includes(radio.value) ? '' : 'none';
            }
            updateWidgetPreview();
        });
    });

    // Theme preset cards — refresh palette fallbacks on change
    const THEME_FIELD_MAP = {
        'config-header-bg': 'headerBg', 'config-header-text-color': 'headerText',
        'config-chat-bg': 'chatBg', 'config-bot-bg': 'botBg', 'config-bot-color': 'botColor',
        'config-user-color': 'userColor', 'config-input-bg': 'inputBg', 'config-input-color': 'inputText',
        'config-footer-color': 'muted'
    };
    const refreshThemeAutos = () => {
        const theme = document.querySelector('input[name="widget-theme"]:checked')?.value || 'light_accent';
        const newPal = themePaletteDash(document.getElementById('config-color')?.value || '#7B3DFB', theme);
        Object.entries(THEME_FIELD_MAP).forEach(([id, key]) => {
            const picker = document.getElementById(id);
            const text = document.getElementById(id + '-text');
            const autoVal = newPal[key];
            if (!autoVal) return;
            if (picker) {
                picker.dataset.autoValue = autoVal;
                if (!text || !text.value.trim()) picker.value = autoVal;
            }
            if (text) text.placeholder = 'Auto (' + autoVal + ')';
        });
    };
    form.querySelectorAll('input[name="widget-theme"]').forEach(radio => {
        radio.addEventListener('change', () => {
            form.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
            radio.closest('.theme-card').classList.add('selected');
            refreshThemeAutos();
            updateWidgetPreview();
        });
    });
    // Accent color also feeds accent-theme card previews
    document.getElementById('config-color')?.addEventListener('input', (e) => {
        const p = e.target.value;
        document.querySelectorAll('.theme-card-bubble.user').forEach(b => b.style.background = p);
        document.querySelectorAll('input[name="widget-theme"][value="light_accent"], input[name="widget-theme"][value="pattern_accent"]')
            .forEach(r => {
                const header = r.closest('.theme-card')?.querySelector('.theme-card-header');
                if (header) header.style.background = p;
            });
        refreshThemeAutos();
    });

    // Border radius slider label
    const brSlider = document.getElementById('config-border-radius');
    const brLabel = document.getElementById('border-radius-val');
    if (brSlider && brLabel) {
        brSlider.addEventListener('input', () => brLabel.textContent = brSlider.value + 'px');
    }

    // Offset sliders — update px labels live
    ['x', 'y'].forEach(axis => {
        const slider = document.getElementById(`config-offset-${axis}`);
        const label = document.getElementById(`offset-${axis}-val`);
        if (slider && label) {
            slider.addEventListener('input', () => label.textContent = slider.value + 'px');
        }
    });

    // Start mode radio cards
    form.querySelectorAll('input[name="start-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            form.querySelectorAll('.start-mode-option').forEach(o => o.classList.remove('selected'));
            radio.closest('.start-mode-option').classList.add('selected');
            const greetGroup = document.getElementById('greeting-message-group');
            if (greetGroup) greetGroup.style.display = radio.value === 'greeting' ? '' : 'none';
            updateWidgetPreview();
            window.sitechat?.previewStartMode?.();
        });
    });

    // Start timing radios — show delay input only for "after delay"
    form.querySelectorAll('input[name="start-timing"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const delayGroup = document.getElementById('start-delay-group');
            if (delayGroup) delayGroup.style.display = radio.value === 'delay' && radio.checked ? '' : 'none';
            updateWidgetPreview();
            window.sitechat?.previewStartMode?.();
        });
    });

    // Launcher icon: library picker + upload + remove
    const iconHidden = document.getElementById('config-launcher-icon');
    const iconPreviewEl = document.getElementById('launcher-icon-preview');
    const iconRemoveBtn = document.getElementById('launcher-icon-remove-btn');
    const setLauncherIcon = (value) => {
        if (iconHidden) iconHidden.value = value || '';
        if (iconPreviewEl) iconPreviewEl.innerHTML = launcherIconPreview(value);
        if (iconRemoveBtn) iconRemoveBtn.disabled = !value;
        updateWidgetPreview();
    };
    const iconLibrary = document.getElementById('launcher-icon-library');
    if (iconLibrary && !iconLibrary.dataset.built) {
        iconLibrary.dataset.built = '1';
        iconLibrary.innerHTML = Object.keys(LAUNCHER_ICONS).map(name =>
            `<button type="button" class="launcher-icon-choice" data-icon="${name}" title="${name.replace(/_/g, ' ')}">${LAUNCHER_ICONS[name]}</button>`
        ).join('');
        iconLibrary.addEventListener('click', (e) => {
            const btn = e.target.closest('.launcher-icon-choice');
            if (!btn) return;
            setLauncherIcon(btn.dataset.icon);
            iconLibrary.style.display = 'none';
        });
    }
    document.getElementById('launcher-icon-library-btn')?.addEventListener('click', () => {
        if (iconLibrary) iconLibrary.style.display = iconLibrary.style.display === 'none' ? 'grid' : 'none';
    });
    const iconFile = document.getElementById('launcher-icon-file');
    document.getElementById('launcher-icon-upload-btn')?.addEventListener('click', () => iconFile?.click());
    iconFile?.addEventListener('change', () => {
        const file = iconFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setLauncherIcon(reader.result);
        reader.readAsDataURL(file);
        iconFile.value = '';
    });
    iconRemoveBtn?.addEventListener('click', () => setLauncherIcon(''));

    // Sound preview buttons
    form.querySelectorAll('.sound-preview-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sel = document.getElementById(btn.dataset.soundSelect);
            if (sel) previewSound(sel.value);
        });
    });

    // Avatar URL live thumbnail
    const avatarInput = document.getElementById('config-avatar-url');
    if (avatarInput) {
        avatarInput.addEventListener('input', () => {
            const thumb = document.getElementById('avatar-preview');
            const url = avatarInput.value.trim();
            if (thumb) {
                thumb.innerHTML = url
                    ? `<img src="${escapeHtml(url)}" alt="" onerror="this.remove()">`
                    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
            }
        });
    }

    // White-label branding toggle
    const hideBranding = document.getElementById('config-hide-branding');
    if (hideBranding) {
        hideBranding.addEventListener('change', () => {
            const g1 = document.getElementById('custom-branding-group');
            const g2 = document.getElementById('custom-branding-url-group');
            if (g1) g1.style.display = hideBranding.checked ? '' : 'none';
            if (g2) g2.style.display = hideBranding.checked ? '' : 'none';
            updateWidgetPreview();
        });
    }

    // Behavior tab: temperature slider label
    const tempSlider = document.getElementById('config-temperature');
    const tempValue = document.getElementById('temp-value');
    if (tempSlider && tempValue) {
        tempSlider.addEventListener('input', () => tempValue.textContent = tempSlider.value);
    }

    document.getElementById('save-config')?.addEventListener('click', saveConfig);
    document.getElementById('reset-config')?.addEventListener('click', resetConfig);

    updateAppearanceEmbedCode();
    document.getElementById('copy-appearance-embed')?.addEventListener('click', copyAppearanceEmbed);

    // Live preview: mount the real widget on the page + control buttons
    ensureLivePreviewWidget();
    document.getElementById('preview-enabled')?.addEventListener('change', ensureLivePreviewWidget);
    document.getElementById('preview-open-chat')?.addEventListener('click', () => window.sitechat?.open?.());
    document.getElementById('preview-close-chat')?.addEventListener('click', () => window.sitechat?.close?.());
    document.getElementById('preview-reload-widget')?.addEventListener('click', () => {
        destroyLivePreviewWidget();
        ensureLivePreviewWidget();
    });

    updateWidgetPreview();
    initInteractivePreview();
}

function initBehaviorHandlers() {
    document.getElementById('save-config')?.addEventListener('click', saveConfig);
    const tempSlider = document.getElementById('config-temperature');
    const tempValue = document.getElementById('temp-value');
    if (tempSlider && tempValue) {
        tempSlider.addEventListener('input', () => tempValue.textContent = tempSlider.value);
    }
}

function initInteractivePreview() {
    const toggle = document.getElementById('preview-interactive-toggle');
    const input = document.getElementById('preview-input');
    const sendBtn = document.getElementById('preview-send-btn');
    const widget = document.getElementById('widget-preview');
    
    if (!toggle || !input || !sendBtn) return;
    
    toggle.addEventListener('change', () => {
        const isInteractive = toggle.checked;
        input.disabled = !isInteractive;
        sendBtn.disabled = !isInteractive;
        widget?.classList.toggle('interactive', isInteractive);
        
        if (isInteractive) {
            input.placeholder = 'Ask a question...';
            input.focus();
        } else {
            input.placeholder = 'Type a message...';
            resetPreviewMessages();
        }
    });
    
    sendBtn.addEventListener('click', sendPreviewMessage);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !input.disabled) {
            sendPreviewMessage();
        }
    });
}

function resetPreviewMessages() {
    const messagesContainer = document.getElementById('preview-messages');
    const welcomeMsg = document.getElementById('config-welcome')?.value || 'Hi! How can I help you today?';
    const color = document.getElementById('config-color')?.value || '#7B3DFB';
    
    if (messagesContainer) {
        messagesContainer.innerHTML = `
            <div class="widget-preview-message bot">
                <div class="preview-avatar" id="preview-avatar" style="background: ${color}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="preview-bubble" id="preview-welcome">${welcomeMsg}</div>
            </div>
        `;
    }
}

async function sendPreviewMessage() {
    const input = document.getElementById('preview-input');
    const messagesContainer = document.getElementById('preview-messages');
    const sendBtn = document.getElementById('preview-send-btn');
    
    if (!input || !messagesContainer || !input.value.trim()) return;
    
    const message = input.value.trim();
    const color = document.getElementById('config-color')?.value || '#7B3DFB';
    input.value = '';
    sendBtn.disabled = true;
    
    messagesContainer.innerHTML += `
        <div class="widget-preview-message user">
            <div class="preview-avatar" style="background: #6b7280">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>
            <div class="preview-bubble" style="background: ${color}">${escapeHtml(message)}</div>
        </div>
    `;
    
    messagesContainer.innerHTML += `
        <div class="widget-preview-message bot" id="typing-message">
            <div class="preview-avatar" style="background: ${color}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </div>
            <div class="preview-bubble">
                <div class="typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>
    `;
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    try {
        if (!currentDetailSite) throw new Error('No site selected');
        
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({
                site_id: currentDetailSite.site_id,
                message: message,
                session_id: `preview-${Date.now()}`
            })
        });
        
        if (!response.ok) throw new Error('Chat request failed');
        
        const data = await response.json();
        const typingMsg = document.getElementById('typing-message');
        
        if (typingMsg) {
            typingMsg.innerHTML = `
                <div class="preview-avatar" style="background: ${color}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="preview-bubble">${escapeHtml(data.answer || 'No response')}</div>
            `;
            typingMsg.removeAttribute('id');
        }
        
    } catch (error) {
        console.error('Preview chat error:', error);
        const typingMsg = document.getElementById('typing-message');
        if (typingMsg) {
            typingMsg.innerHTML = `
                <div class="preview-avatar" style="background: ${color}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="preview-bubble" style="color: #ef4444;">Error: ${error.message || 'Failed to get response'}</div>
            `;
            typingMsg.removeAttribute('id');
        }
    }
    
    sendBtn.disabled = false;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function loadSiteDocuments(siteId) {
    try {
        const response = await fetch(`${API_BASE}/documents/${siteId}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) return [];
        
        const data = await response.json();
        renderSiteDocuments(data.documents);
        return data.documents || [];
    } catch (error) {
        console.error('Failed to load documents:', error);
        return [];
    }
}

function renderSiteDocuments(documents) {
    const list = elements.documentsList;
    if (!list) return;
    
    if (!documents || documents.length === 0) {
        list.innerHTML = `
            <div class="empty-docs">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                <p>No documents yet</p>
                <span>Upload PDFs, docs, and more</span>
            </div>
        `;
        return;
    }
    
    list.innerHTML = documents.map(doc => {
        const ext = doc.file_type.replace('.', '');
        const iconClass = getFileIconClass(ext);
        const statusIcon = doc.status === 'indexed' 
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
            : (doc.status === 'error' 
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="3"><circle cx="12" cy="12" r="1"/></svg>');
        
        return `
            <div class="doc-item">
                <div class="file-icon ${iconClass}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                </div>
                <div class="file-info">
                    <div class="file-name">${doc.filename}</div>
                    <div class="file-meta">${doc.word_count?.toLocaleString() || 0} words · ${doc.chunks || 0} chunks</div>
                </div>
                <span class="doc-status">${statusIcon}</span>
                <button type="button" class="doc-delete" onclick="deleteDocument('${doc.id}')" title="Delete document">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
            </div>
        `;
    }).join('');
}

async function deleteDocument(docId) {
    if (!currentDetailSite) return;
    
    if (!confirm('Are you sure you want to delete this document?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/documents/${currentDetailSite.site_id}/${docId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            await loadSiteDocuments(currentDetailSite.site_id);
        } else {
            alert('Failed to delete document');
        }
    } catch (error) {
        console.error('Failed to delete document:', error);
    }
}

window.deleteDocument = deleteDocument;

function closeDetailsModal() {
    closeSidePanel();
}

async function copyDetailEmbed() {
    const code = document.getElementById('detail-embed-code').textContent;
    try {
        await navigator.clipboard.writeText(code);
        const btn = document.getElementById('copy-detail-embed');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Copied!';
        setTimeout(() => btn.innerHTML = originalHTML, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
    }
}

async function recrawlSite() {
    if (!currentDetailSite) return;
    
    const btn = document.getElementById('recrawl-site');
    btn.disabled = true;
    btn.textContent = 'Crawling...';
    
    try {
        await fetch(`${API_BASE}/crawl`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ url: currentDetailSite.url, max_pages: 150 })
        });
        
        closeDetailsModal();
        await loadSites();
        pollSiteStatus(currentDetailSite.site_id);
    } catch (error) {
        console.error('Failed to recrawl:', error);
        alert('Failed to start crawl. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>Re-crawl';
    }
}

async function deleteSite() {
    if (!currentDetailSite) return;
    
    if (!confirm(`Are you sure you want to delete "${currentDetailSite.name || currentDetailSite.url}"?`)) {
        return;
    }
    
    try {
        await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        closeDetailsModal();
        await loadSites();
    } catch (error) {
        console.error('Failed to delete:', error);
        alert('Failed to delete site. Please try again.');
    }
}

function updateSiteSelector() {
    if (!elements.chatSiteSelect) return;
    
    elements.chatSiteSelect.innerHTML = '<option value="">Choose a site to test...</option>';
    
    sites.forEach(site => {
        const option = document.createElement('option');
        option.value = site.site_id;
        option.textContent = site.name || site.url;
        elements.chatSiteSelect.appendChild(option);
    });
}

function handleSiteSelect() {
    currentSiteId = elements.chatSiteSelect.value;
    elements.chatInput.disabled = !currentSiteId;
    updateSendButton();
    
    if (currentSiteId) {
        startNewChat();
    }
}

async function handleChatSubmit(e) {
    e.preventDefault();
    
    const query = elements.chatInput.value.trim();
    if (!query || !currentSiteId) return;
    
    elements.chatInput.value = '';
    updateSendButton();
    
    clearWelcomeMessage();
    addMessage(query, 'user');
    
    const typingEl = showTyping();
    
    try {
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                message: query,
                session_id: sessionId,
                site_id: currentSiteId
            })
        });
        
        if (!response.ok) throw new Error('Chat failed');
        
        const data = await response.json();
        typingEl.remove();
        addMessage(data.answer, 'assistant', data.sources);
        
    } catch (error) {
        console.error('Chat error:', error);
        typingEl.remove();
        addMessage('Sorry, something went wrong. Please try again.', 'assistant');
    }
}

function clearWelcomeMessage() {
    const welcome = elements.chatMessages.querySelector('.welcome-message');
    if (welcome) welcome.remove();
}

function addMessage(content, type, sources = []) {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    
    let html = content;
    
    if (sources && sources.length > 0) {
        html += `
            <div class="message-sources">
                <div class="message-sources-title">Sources</div>
                ${sources.map(s => `<a href="${s.url}" target="_blank" class="source-link">${s.title || s.url}</a>`).join('')}
            </div>
        `;
    }
    
    msg.innerHTML = html;
    elements.chatMessages.appendChild(msg);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    elements.chatMessages.appendChild(typing);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    return typing;
}

function startNewChat() {
    sessionId = 'session-' + Math.random().toString(36).substring(2, 15);
    elements.chatMessages.innerHTML = '';
    
    if (currentSiteId) {
        const site = sites.find(s => s.site_id === currentSiteId);
        elements.chatMessages.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                    </svg>
                </div>
                <h3>Chat with ${site?.name || 'this site'}</h3>
                <p>Ask any question about the website content</p>
            </div>
        `;
    }
}

function updateSendButton() {
    const hasText = elements.chatInput.value.trim().length > 0;
    const hasSite = !!currentSiteId;
    elements.sendBtn.disabled = !hasText || !hasSite;
}

async function loadStats() {
    // System stats no longer displayed in the analytics stat row;
    // engagement metrics are loaded via loadAnalyticsOverview() instead.
}

async function checkHealth() {
    const checks = [
        { id: 'health-mongodb', name: 'mongodb' },
        { id: 'health-vector', name: 'vector_store' },
        { id: 'health-ollama', name: 'ollama' }
    ];
    
    checks.forEach(check => {
        const el = document.getElementById(check.id);
        el.className = 'health-badge loading';
        el.textContent = 'Checking';
    });
    
    try {
        const response = await fetch(`${API_BASE}/admin/health`);
        const health = await response.json();
        
        checks.forEach(check => {
            const el = document.getElementById(check.id);
            const status = health[check.name];
            if (status && (status === 'healthy' || status === true || status.toString().startsWith('healthy'))) {
                el.className = 'health-badge healthy';
                el.textContent = 'Healthy';
            } else {
                el.className = 'health-badge unhealthy';
                el.textContent = 'Unhealthy';
            }
        });
    } catch (error) {
        checks.forEach(check => {
            const el = document.getElementById(check.id);
            el.className = 'health-badge unhealthy';
            el.textContent = 'Error';
        });
    }
}

// ==================== Analytics ====================

let conversationsChart = null;
let currentPeriod = '7d';

function populateAnalyticsSiteFilter() {
    const select = document.getElementById('analytics-site-filter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">All Sites</option>';
    sites.forEach(site => {
        const opt = document.createElement('option');
        opt.value = site.id;
        opt.textContent = site.name || site.url;
        select.appendChild(opt);
    });
    select.value = current;
    select.onchange = () => {
        currentAnalyticsSite = select.value;
        loadAllAnalytics();
    };
}

async function loadAnalytics() {
    populateAnalyticsSiteFilter();
    const viewAllBtn = document.getElementById('go-to-conversations');
    if (viewAllBtn) {
        viewAllBtn.onclick = () => switchView('conversations');
        viewAllBtn.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') switchView('conversations'); };
    }
    await loadAllAnalytics();
}

async function loadAllAnalytics() {
    await Promise.all([
        loadAnalyticsOverview(),
        loadConversationTrend(),
        loadPopularQuestions(),
        loadSourcesUsed(),
        loadConversationsBySite(),
        loadRecentConversations()
    ]);
}

async function loadAnalyticsOverview() {
    try {
        const params = currentAnalyticsSite ? `?site_id=${encodeURIComponent(currentAnalyticsSite)}` : '';
        const response = await fetch(`${API_BASE}/analytics/overview${params}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) return;

        const data = await response.json();

        document.getElementById('stat-chats').textContent = data.total_conversations || 0;
        if (elements.statMsgsToday) elements.statMsgsToday.textContent = data.messages_today || 0;
        if (elements.statAvgMsgs) elements.statAvgMsgs.textContent = data.avg_messages_per_conversation || 0;
        if (elements.statSatisfaction) {
            elements.statSatisfaction.textContent = data.total_feedback > 0
                ? `${data.satisfaction_rate}%`
                : '—';
        }
        const activeSitesEl = document.getElementById('stat-active-sites');
        if (activeSitesEl) activeSitesEl.textContent = data.active_sites || 0;
        const handoffsEl = document.getElementById('stat-handoffs');
        if (handoffsEl) handoffsEl.textContent = data.total_handoffs || 0;
        const handoffRateEl = document.getElementById('stat-handoff-rate');
        if (handoffRateEl) handoffRateEl.textContent = `${data.handoff_rate || 0}%`;
    } catch (error) {
        console.error('Failed to load analytics overview:', error);
    }
}

async function loadConversationTrend() {
    try {
        const siteParam = currentAnalyticsSite ? `&site_id=${encodeURIComponent(currentAnalyticsSite)}` : '';
        const response = await fetch(`${API_BASE}/analytics/conversations?period=${currentPeriod}${siteParam}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        
        // Update summary
        document.getElementById('trend-total').textContent = data.total_conversations || 0;
        const trendMsgs = document.getElementById('trend-messages');
        if (trendMsgs) trendMsgs.textContent = data.total_messages || 0;
        const changeEl = document.getElementById('trend-change');
        const change = data.change_percentage || 0;
        if (change >= 0) {
            changeEl.className = 'summary-item trend-up';
            changeEl.textContent = `+${change}% from last period`;
        } else {
            changeEl.className = 'summary-item trend-down';
            changeEl.textContent = `${change}% from last period`;
        }
        
        // Render chart
        renderConversationsChart(data.data);
    } catch (error) {
        console.error('Failed to load conversation trend:', error);
    }
}

function renderConversationsChart(data) {
    const ctx = document.getElementById('conversationsChart');
    if (!ctx) return;
    
    const labels = data.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const conversations = data.map(d => d.conversations);
    const messages = data.map(d => d.messages);
    
    if (conversationsChart) {
        conversationsChart.destroy();
    }
    
    conversationsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Conversations',
                    data: conversations,
                    borderColor: '#7B3DFB',
                    backgroundColor: 'rgba(13, 148, 136, 0.08)',
                    borderWidth: 2,
                    pointRadius: currentPeriod === '7d' ? 4 : 2,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#7B3DFB',
                    tension: 0.35,
                    fill: true
                },
                {
                    label: 'Messages',
                    data: messages,
                    borderColor: '#14b8a6',
                    backgroundColor: 'rgba(20, 184, 166, 0.04)',
                    borderWidth: 2,
                    borderDash: [4, 4],
                    pointRadius: currentPeriod === '7d' ? 4 : 2,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#14b8a6',
                    tension: 0.35,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 2,
                        padding: 16,
                        font: { size: 12 },
                        usePointStyle: true,
                        pointStyle: 'line'
                    }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    padding: 10,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { font: { size: 11 }, color: '#94a3b8' }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 11 },
                        color: '#94a3b8',
                        stepSize: 1,
                        padding: 8
                    }
                }
            }
        }
    });
}

async function loadPopularQuestions() {
    try {
        const siteParam = currentAnalyticsSite ? `&site_id=${encodeURIComponent(currentAnalyticsSite)}` : '';
        const response = await fetch(`${API_BASE}/analytics/popular-questions?limit=5${siteParam}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        
        const container = document.getElementById('popular-questions');
        if (!container) return;
        
        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-analytics">No questions yet</div>';
            return;
        }
        
        const maxCount = data[0]?.count || 1;
        container.innerHTML = data.map((q, idx) => `
            <div class="question-item">
                <span class="question-rank">${idx + 1}</span>
                <div class="question-content">
                    <div class="question-text">${escapeHtml(q.question)}</div>
                    <div class="question-bar-wrap">
                        <div class="question-bar-fill" style="width:${Math.round((q.count / maxCount) * 100)}%"></div>
                    </div>
                    <div class="question-count">${q.count} times &middot; ${q.percentage}%</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load popular questions:', error);
    }
}

async function loadSourcesUsed() {
    try {
        const siteParam = currentAnalyticsSite ? `&site_id=${encodeURIComponent(currentAnalyticsSite)}` : '';
        const response = await fetch(`${API_BASE}/analytics/sources-used?limit=6${siteParam}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) return;

        const data = await response.json();

        renderSourcesList(data);
    } catch (error) {
        console.error('Failed to load sources used:', error);
    }
}

function renderSourcesList(data) {
    const container = document.getElementById('sources-list');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-analytics">No source data yet</div>';
        return;
    }

    const maxCount = data[0]?.citation_count || 1;
    container.innerHTML = data.map(d => {
        const title = d.title || d.url;
        const label = title.length > 45 ? title.substring(0, 45) + '…' : title;
        const pct = Math.round((d.citation_count / maxCount) * 100);
        return `
            <div class="source-item">
                <div class="source-item-header">
                    <span class="source-title" title="${escapeHtml(title)}">${escapeHtml(label)}</span>
                    <span class="source-count">${d.citation_count}</span>
                </div>
                <div class="source-bar-wrap">
                    <div class="source-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadRecentConversations() {
    try {
        const siteParam = currentAnalyticsSite ? `&site_id=${encodeURIComponent(currentAnalyticsSite)}` : '';
        const response = await fetch(`${API_BASE}/analytics/recent-conversations?limit=5${siteParam}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) return;

        const data = await response.json();

        const container = document.getElementById('recent-conversations');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-analytics">No conversations yet</div>';
            return;
        }

        container.innerHTML = data.map(conv => {
            const time = formatTimeAgo(new Date(conv.last_activity));
            return `
                <div class="conversation-item" data-session-id="${escapeHtml(conv.session_id)}" role="button" tabindex="0" title="Open conversation">
                    <div class="conversation-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                        </svg>
                    </div>
                    <div class="conversation-content">
                        <div class="conversation-preview">${escapeHtml(conv.first_message || 'No message')}</div>
                        <div class="conversation-meta">
                            <span>${conv.message_count} msgs</span>
                            <span>·</span>
                            <span>${time}</span>
                            ${conv.has_feedback ? '<span>· <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px;color:var(--success)"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/></svg></span>' : ''}
                        </div>
                    </div>
                    <svg class="conv-item-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.conversation-item[data-session-id]').forEach(item => {
            const open = async () => {
                const sid = item.dataset.sessionId;
                switchView('conversations');
                // Wait for conversations list to load, then select
                await new Promise(r => setTimeout(r, 50));
                selectConversation(sid);
            };
            item.addEventListener('click', open);
            item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
        });
    } catch (error) {
        console.error('Failed to load recent conversations:', error);
    }
}

async function loadConversationsBySite() {
    try {
        const response = await fetch(`${API_BASE}/analytics/conversations-by-site`, {
            headers: getAuthHeaders()
        });

        const container = document.getElementById('conversations-by-site');
        if (!container) return;

        if (!response.ok) {
            container.innerHTML = '<div class="empty-analytics">Unable to load data</div>';
            return;
        }

        const data = await response.json();

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-analytics">No data yet</div>';
            return;
        }

        const maxCount = data[0].conversation_count || 1;
        container.innerHTML = data.map(row => {
            const pct = Math.round((row.conversation_count / maxCount) * 100);
            return `
                <div class="site-stat-row">
                    <div class="site-stat-name" title="${escapeHtml(row.site_name)}">${escapeHtml(row.site_name)}</div>
                    <div class="site-stat-bar-wrap">
                        <div class="site-stat-bar" style="width:${pct}%"></div>
                    </div>
                    <div class="site-stat-count">${row.conversation_count} <span class="site-stat-msgs">${row.message_count} msgs</span></div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load conversations by site:', error);
    }
}

function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupAnalyticsPeriodButtons() {
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;
            loadConversationTrend();
        });
    });
}

// ==================== Customization Panel ====================

let currentSiteConfig = null;

function setupCustomizeTabs() {
    const tabsContainer = document.querySelector('.customize-tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            const tab = e.target.closest('.customize-tab');
            if (!tab) return;
            
            document.querySelectorAll('.customize-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.customize-content').forEach(c => c.classList.add('hidden'));
            const contentEl = document.getElementById(`customize-${tabId}`);
            if (contentEl) {
                contentEl.classList.remove('hidden');
            }
        });
    }
    
    // Color input sync with live preview
    const colorInput = document.getElementById('config-color');
    const colorTextInput = document.getElementById('config-color-text');
    
    if (colorInput && colorTextInput) {
        colorInput.addEventListener('input', () => {
            colorTextInput.value = colorInput.value.toUpperCase();
            updateWidgetPreview();
        });
        
        colorTextInput.addEventListener('input', () => {
            const value = colorTextInput.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
                colorInput.value = value;
                updateWidgetPreview();
            }
        });
    }
    
    // Title input with live preview
    const titleInput = document.getElementById('config-title');
    if (titleInput) {
        titleInput.addEventListener('input', updateWidgetPreview);
    }
    
    // Welcome message with live preview
    const welcomeInput = document.getElementById('config-welcome');
    if (welcomeInput) {
        welcomeInput.addEventListener('input', updateWidgetPreview);
    }
    
    // White-label fields with live preview
    const hideBrandingCheckbox = document.getElementById('config-hide-branding');
    if (hideBrandingCheckbox) {
        hideBrandingCheckbox.addEventListener('change', updateWidgetPreview);
    }
    
    const customBrandingInput = document.getElementById('config-custom-branding');
    if (customBrandingInput) {
        customBrandingInput.addEventListener('input', updateWidgetPreview);
    }
    
    const customBrandingUrlInput = document.getElementById('config-custom-branding-url');
    if (customBrandingUrlInput) {
        customBrandingUrlInput.addEventListener('input', updateWidgetPreview);
    }
    
    // Temperature slider
    const tempSlider = document.getElementById('config-temperature');
    const tempValue = document.getElementById('temp-value');
    
    if (tempSlider && tempValue) {
        tempSlider.addEventListener('input', () => {
            tempValue.textContent = tempSlider.value;
        });
    }
    
    // Footer enabled toggle
    const footerEnabledCb = document.getElementById('config-footer-enabled');
    footerEnabledCb?.addEventListener('change', () => {
        const group = document.getElementById('footer-text-group');
        if (group) group.style.display = footerEnabledCb.checked ? '' : 'none';
        updateWidgetPreview();
    });

    // Save and Reset buttons
    document.getElementById('save-config')?.addEventListener('click', saveConfig);
    document.getElementById('reset-config')?.addEventListener('click', resetConfig);
    
    // Appearance embed copy button
    document.getElementById('copy-appearance-embed')?.addEventListener('click', copyAppearanceEmbed);
}

function updateWidgetPreview() {
    // Push live form values into the real on-page widget preview
    const color = document.getElementById('config-color')?.value || '#7B3DFB';
    const title = document.getElementById('config-title')?.value || 'Chat with us';
    const welcome = document.getElementById('config-welcome')?.value || 'Hi! How can I help you today?';
    updateAppearancePreview(color, adjustHexDash(color, -20), title, welcome);
    pushLiveAppearance();
}

function adjustHexDash(hex, amount) {
    const c = (hex || '#7B3DFB').replace('#', '');
    const num = parseInt(c, 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Push the appearance form's current (unsaved) values into the on-page widget.
function pushLiveAppearance() {
    if (!window.sitechat?.applyAppearance) return;
    try {
        const cfg = getConfigFromForm();
        if (cfg?.appearance) window.sitechat.applyAppearance(cfg.appearance);
    } catch (e) { /* form may not be fully rendered yet */ }
}

// Inject the real widget script on the dashboard page for live preview.
// The widget only runs on the dashboard in preview mode (data-preview="1"),
// so window.sitechat here can only ever belong to the preview.
function ensureLivePreviewWidget() {
    if (!currentDetailSite) return;
    const enabled = document.getElementById('preview-enabled')?.checked !== false;
    if (!enabled) { destroyLivePreviewWidget(); return; }
    if (window.__sitechatPreviewActive && window.sitechat?.siteId === currentDetailSite.site_id) {
        pushLiveAppearance();
        return;
    }
    destroyLivePreviewWidget();
    window.__sitechatPreview = true;
    window.__sitechatPreviewActive = true;
    const s = document.createElement('script');
    s.id = 'sitechat-preview-script';
    s.src = '/widget/chatbot.min.js?v=' + Date.now();
    s.dataset.siteId = currentDetailSite.site_id;
    s.dataset.apiUrl = window.location.origin;
    s.dataset.preview = '1';
    s.addEventListener('error', showPreviewLoadError);
    document.body.appendChild(s);
    hidePreviewLoadError();
    // Push form config once the widget API is ready
    const iv = setInterval(() => {
        if (window.sitechat?.applyAppearance) {
            clearInterval(iv);
            hidePreviewLoadError();
            pushLiveAppearance();
        }
    }, 120);
    setTimeout(() => {
        clearInterval(iv);
        if (!window.sitechat?.applyAppearance) showPreviewLoadError();
    }, 8000);
}

function showPreviewLoadError() {
    const card = document.querySelector('.live-preview-card');
    if (!card) return;
    let hint = document.getElementById('preview-load-error');
    if (!hint) {
        hint = document.createElement('p');
        hint.id = 'preview-load-error';
        hint.className = 'form-help';
        hint.style.color = 'var(--danger, #dc2626)';
        card.appendChild(hint);
    }
    hint.textContent = 'Preview failed to load — hard-refresh (Cmd+Shift+R) or check the console for errors.';
    hint.style.display = '';
}

function hidePreviewLoadError() {
    const hint = document.getElementById('preview-load-error');
    if (hint) hint.style.display = 'none';
}

function destroyLivePreviewWidget() {
    if (!window.__sitechatPreviewActive) return;
    try { window.sitechat?.destroy?.(); } catch (e) {}
    document.getElementById('sitechat-preview-script')?.remove();
    delete window.__sitechatPreview;
    delete window.__sitechatPreviewActive;
}

// Legacy mock-DOM preview updater (unused — replaced by the real on-page widget).
function updateWidgetPreviewMock() {
    const val = (id) => document.getElementById(id)?.value;
    const checked = (id) => document.getElementById(id)?.checked;
    // Auto-capable color fields have a paired "-text" input: empty text = inherit fallback
    const colorVal = (id, fallback) => {
        const text = val(id + '-text');
        if (text !== undefined) return text.trim() || fallback;
        return val(id) || fallback;
    };

    const color = val('config-color') || '#7B3DFB';
    const theme = document.querySelector('input[name="widget-theme"]:checked')?.value || 'light_accent';
    const pal = themePaletteDash(color, theme);
    const borderRadius = parseInt(val('config-border-radius')) || 0;
    const title = val('config-title') || 'Chat with us';
    const caption = val('config-agent-caption') || 'Powered by AI';
    const welcome = val('config-welcome') || 'Hi! How can I help you today?';
    const avatarUrl = val('config-avatar-url')?.trim();
    const showOnline = checked('config-show-online') !== false;
    const onlineColor = colorVal('config-online-color', '#22C55E');
    const headerBg = colorVal('config-header-bg', pal.headerBg);
    const headerText = colorVal('config-header-text-color', pal.headerText);
    const chatBg = colorVal('config-chat-bg', pal.chatBg);
    const botBg = colorVal('config-bot-bg', pal.botBg);
    const botColor = colorVal('config-bot-color', pal.botColor);
    const userBg = colorVal('config-user-bg', color);
    const userColor = colorVal('config-user-color', pal.userColor);
    const inputBg = colorVal('config-input-bg', pal.inputBg);
    const inputColor = colorVal('config-input-color', pal.inputText);
    const footerColor = colorVal('config-footer-color', pal.muted);
    const sendColor = colorVal('config-send-color', color);
    const launcherBg = colorVal('config-launcher-bg', color);
    const launcherIconColor = colorVal('config-launcher-icon-color', '#FFFFFF');
    const fontFamily = val('config-font') || 'Inter';
    const placeholder = val('config-placeholder') || 'Type your message...';
    const footerText = val('config-footer-text')?.trim();
    const launcherStyle = document.querySelector('input[name="launcher-style"]:checked')?.value || 'button';
    const launcherText = val('config-launcher-text') || 'Ask us anything';
    const position = val('config-position') || 'bottom-right';

    function adjustColor(hex, amount) {
        let c = hex.replace('#', '');
        let num = parseInt(c, 16);
        let r = Math.min(255, Math.max(0, (num >> 16) + amount));
        let g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
        let b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
        return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    }

    const preview = document.getElementById('widget-preview');
    if (!preview) return;

    preview.style.fontFamily = fontFamily === 'System'
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        : `'${fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

    // Header
    const previewHeader = document.getElementById('preview-header');
    if (previewHeader) {
        previewHeader.style.background = `linear-gradient(135deg, ${headerBg}, ${adjustColor(headerBg, -20)})`;
        previewHeader.style.color = headerText;
    }
    const previewTitle = document.getElementById('preview-title');
    if (previewTitle) previewTitle.textContent = title;
    const previewCaption = document.getElementById('preview-caption');
    if (previewCaption) {
        previewCaption.textContent = caption;
        previewCaption.style.color = headerText;
        previewCaption.style.opacity = '0.85';
    }

    // Header avatar + online dot
    const headerAvatar = document.getElementById('preview-header-avatar');
    if (headerAvatar) {
        if (avatarUrl) {
            headerAvatar.style.backgroundImage = `url("${avatarUrl}")`;
            headerAvatar.classList.add('has-img');
        } else {
            headerAvatar.style.backgroundImage = '';
            headerAvatar.classList.remove('has-img');
        }
    }
    const onlineDot = document.getElementById('preview-online-dot');
    if (onlineDot) {
        onlineDot.style.display = showOnline ? '' : 'none';
        onlineDot.style.background = onlineColor;
    }

    // Messages area + bubbles
    const previewBody = document.getElementById('preview-messages');
    if (previewBody) {
        previewBody.style.background = chatBg;
        if (pal.pattern) {
            previewBody.style.backgroundImage = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'120\' viewBox=\'0 0 120 120\'%3E%3Cg fill=\'none\' stroke=\'%2394a3b8\' stroke-opacity=\'0.14\' stroke-width=\'1.5\'%3E%3Cpath d=\'M20 25a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8l-6 5v-5h-2a4 4 0 0 1-4-4z\'/%3E%3Cpath d=\'M80 60a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8l-6 5v-5h-2a4 4 0 0 1-4-4z\'/%3E%3Ccircle cx=\'30\' cy=\'85\' r=\'6\'/%3E%3Cpath d=\'M27 85h6M30 82v6\'/%3E%3Cpath d=\'M70 20l3 6 6 3-6 3-3 6-3-6-6-3 6-3z\'/%3E%3Cpath d=\'M15 60h8M19 56v8\'/%3E%3Ccircle cx=\'95\' cy=\'100\' r=\'5\'/%3E%3Cpath d=\'M50 95q5-8 10 0t10 0\'/%3E%3C/g%3E%3C/svg%3E")';
        } else {
            previewBody.style.backgroundImage = '';
        }
    }
    const previewWelcome = document.getElementById('preview-welcome');
    if (previewWelcome) {
        previewWelcome.textContent = welcome;
        previewWelcome.style.background = botBg;
        previewWelcome.style.color = botColor;
        previewWelcome.style.borderRadius = `${Math.max(4, borderRadius - 2)}px ${Math.max(4, borderRadius - 2)}px ${Math.max(4, borderRadius - 2)}px 4px`;
    }
    const userBubble = document.getElementById('preview-user-bubble');
    if (userBubble) {
        userBubble.style.background = `linear-gradient(135deg, ${userBg}, ${adjustColor(userBg, -20)})`;
        userBubble.style.color = userColor;
        userBubble.style.borderRadius = `${Math.max(4, borderRadius - 2)}px ${Math.max(4, borderRadius - 2)}px 4px ${Math.max(4, borderRadius - 2)}px`;
    }
    // Window + input border radius
    const previewWindow = document.getElementById('widget-preview');
    if (previewWindow) previewWindow.style.borderRadius = borderRadius + 'px';
    const previewInputForm = document.querySelector('#widget-preview .widget-preview-input');
    if (previewInputForm) {
        previewInputForm.style.borderRadius = Math.max(6, borderRadius - 4) + 'px';
        previewInputForm.style.background = inputBg;
    }

    // Bot avatar in messages
    const previewAvatar = document.getElementById('preview-avatar');
    if (previewAvatar) {
        previewAvatar.style.background = `linear-gradient(135deg, ${color}, ${adjustColor(color, -20)})`;
        if (avatarUrl) {
            previewAvatar.style.backgroundImage = `url("${avatarUrl}")`;
            previewAvatar.classList.add('has-img');
        } else {
            previewAvatar.style.backgroundImage = '';
            previewAvatar.classList.remove('has-img');
        }
    }

    // Input area
    const previewInput = document.getElementById('preview-input');
    if (previewInput) {
        previewInput.style.background = inputBg;
        previewInput.style.color = inputColor;
        previewInput.placeholder = placeholder;
    }
    const previewSend = document.getElementById('preview-send-btn');
    if (previewSend) {
        previewSend.style.background = `linear-gradient(135deg, ${sendColor}, ${adjustColor(sendColor, -20)})`;
    }

    // Footer disclaimer
    const previewFooter = document.getElementById('preview-footer-text');
    if (previewFooter) {
        const footerOn = checked('config-footer-enabled') !== false;
        previewFooter.textContent = footerText || '';
        previewFooter.style.color = footerColor;
        previewFooter.style.display = footerOn && footerText ? '' : 'none';
    }

    // Custom CSS live preview (unscoped — user rules target widget classes)
    const customCss = val('config-custom-css') || '';
    let previewCssEl = document.getElementById('preview-custom-css');
    if (customCss.trim()) {
        if (!previewCssEl) {
            previewCssEl = document.createElement('style');
            previewCssEl.id = 'preview-custom-css';
            document.head.appendChild(previewCssEl);
        }
        previewCssEl.textContent = customCss;
    } else if (previewCssEl) {
        previewCssEl.remove();
    }

    // Branding
    const previewBranding = document.getElementById('preview-branding');
    if (previewBranding) {
        const whiteLabelEnabled = checked('config-hide-branding');
        const customBrandingText = val('config-custom-branding')?.trim();
        const brandingText = document.getElementById('preview-branding-text');
        if (whiteLabelEnabled && !customBrandingText) {
            previewBranding.style.display = 'none';
        } else {
            previewBranding.style.display = '';
            if (brandingText) {
                brandingText.textContent = whiteLabelEnabled ? customBrandingText : 'Powered by SwiftChat';
            }
        }
    }

    // Launcher (FAB) variant
    const fab = document.getElementById('preview-fab');
    if (fab) {
        fab.className = 'widget-preview-fab';
        fab.classList.add(position === 'bottom-left' ? 'left' : position === 'bottom-center' ? 'center' : 'right');
        fab.style.background = `linear-gradient(135deg, ${launcherBg}, ${adjustColor(launcherBg, -20)})`;
        fab.style.color = launcherIconColor;
        const iconChoice = val('config-launcher-icon') || '';
        const iconIsImg = iconChoice && !LAUNCHER_ICONS[iconChoice];
        const chatIcon = iconIsImg
            ? `<img src="${escapeHtml(iconChoice)}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover">`
            : (LAUNCHER_ICONS[iconChoice] || DEFAULT_LAUNCHER_SVG).replace('<svg', '<svg width="24" height="24"');
        if (launcherStyle === 'text_button') {
            fab.classList.add('fab-text');
            fab.innerHTML = chatIcon.replace('width="24" height="24"', 'width="16" height="16"') + `<span>${escapeHtml(launcherText)}</span>`;
        } else if (launcherStyle === 'agent_profile') {
            fab.classList.add('fab-agent');
            fab.innerHTML = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="" class="fab-avatar-img">`
                : chatIcon;
        } else if (launcherStyle === 'quick_input') {
            fab.classList.add('fab-quick');
            fab.innerHTML = `<span class="fab-quick-text">${escapeHtml(launcherText)}</span><span class="fab-quick-btn">${chatIcon.replace('width="24" height="24"', 'width="14" height="14"')}</span>`;
        } else {
            fab.innerHTML = chatIcon;
        }
    }

    // Update appearance preview (mini preview in side panel)
    updateAppearancePreview(color, adjustColor(color, -20), title, welcome);
}

function updateAppearancePreview(color, darkColor, title, welcome) {
    // Update appearance preview header
    const appearancePreviewHeader = document.getElementById('appearance-preview-header');
    if (appearancePreviewHeader) {
        appearancePreviewHeader.style.background = `linear-gradient(135deg, ${color}, ${darkColor})`;
    }
    
    // Update appearance preview title
    const appearancePreviewTitle = document.getElementById('appearance-preview-title');
    if (appearancePreviewTitle) {
        appearancePreviewTitle.textContent = title;
    }
    
    // Update appearance preview welcome message
    const appearancePreviewWelcome = document.getElementById('appearance-preview-welcome');
    if (appearancePreviewWelcome) {
        appearancePreviewWelcome.textContent = welcome;
    }
    
    // Update appearance preview avatar
    const appearancePreviewAvatar = document.getElementById('appearance-preview-avatar');
    if (appearancePreviewAvatar) {
        appearancePreviewAvatar.style.background = `linear-gradient(135deg, ${color}, ${darkColor})`;
    }
    
    // Update appearance preview send button
    const appearancePreviewSend = document.getElementById('appearance-preview-send');
    if (appearancePreviewSend) {
        appearancePreviewSend.style.background = `linear-gradient(135deg, ${color}, ${darkColor})`;
    }
    
    // Update appearance preview branding
    const appearancePreviewBranding = document.getElementById('appearance-preview-branding');
    if (appearancePreviewBranding) {
        const whiteLabelEnabled = document.getElementById('config-hide-branding')?.checked;
        const customBrandingText = document.getElementById('config-custom-branding')?.value?.trim();
        const customBrandingUrl = document.getElementById('config-custom-branding-url')?.value;
        const link = appearancePreviewBranding.querySelector('a');
        
        if (whiteLabelEnabled) {
            if (customBrandingText) {
                appearancePreviewBranding.classList.remove('hidden');
                if (link) {
                    link.innerHTML = customBrandingText;
                    link.href = customBrandingUrl || '#';
                }
            } else {
                appearancePreviewBranding.classList.add('hidden');
            }
        } else {
            appearancePreviewBranding.classList.remove('hidden');
            if (link) {
                link.innerHTML = 'Powered by <strong>SwiftChat</strong>';
                link.href = window.location.origin;
            }
        }
    }
}

function updateAppearanceEmbedCode() {
    if (!currentDetailSite) return;
    
    const embedCodeEl = document.getElementById('appearance-embed-code');
    if (!embedCodeEl) return;
    
    const baseUrl = window.location.origin;
    const embedCode = `<script>
(function() {
  var s = document.createElement('script');
  s.src = '${baseUrl}/widget/chatbot.js';
  s.async = true;
  s.dataset.siteId = '${currentDetailSite.site_id}';
  s.dataset.apiUrl = '${baseUrl}';
  document.head.appendChild(s);
})();
<\/script>`;
    
    embedCodeEl.textContent = embedCode;
}

async function copyAppearanceEmbed() {
    const embedCodeEl = document.getElementById('appearance-embed-code');
    const copyBtn = document.getElementById('copy-appearance-embed');
    
    if (!embedCodeEl) return;
    
    try {
        await navigator.clipboard.writeText(embedCodeEl.textContent);
        
        const originalHTML = copyBtn.innerHTML;
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Copied!</span>
        `;
        
        setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = originalHTML;
        }, 2000);
    } catch (error) {
        console.error('Failed to copy embed code:', error);
    }
}

async function loadSiteConfig(siteId) {
    try {
        const response = await fetch(`${API_BASE}/sites/${siteId}/config`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) {
            currentSiteConfig = getDefaultConfig();
        } else {
            currentSiteConfig = await response.json();
        }
        
        populateConfigForm(currentSiteConfig);
        updateWidgetPreview();
    } catch (error) {
        console.error('Failed to load site config:', error);
        currentSiteConfig = getDefaultConfig();
        populateConfigForm(currentSiteConfig);
        updateWidgetPreview();
    }
}

function getDefaultConfig() {
    return {
        appearance: {
            primary_color: '#7B3DFB',
            chat_title: 'Chat with us',
            welcome_message: 'Hi! How can I help you today?',
            welcome_title: 'Hi there! 👋',
            welcome_icon: 'default',
            welcome_enabled: true,
            bot_avatar_url: null,
            position: 'bottom-right',
            agent_caption: 'Powered by AI',
            show_online_indicator: true,
            online_indicator_color: '#22C55E',
            theme: 'light_accent',
            border_radius: 16,
            header_background: null,
            header_text_color: null,
            chat_background: null,
            bot_message_background: null,
            bot_message_color: null,
            user_message_background: null,
            user_message_color: null,
            input_background: null,
            input_text_color: null,
            input_placeholder: 'Type your message...',
            send_button_color: null,
            launcher_background: null,
            launcher_icon_color: '#FFFFFF',
            footer_enabled: true,
            footer_text: null,
            footer_text_color: null,
            custom_css: null,
            custom_js: null,
            font_family: null,
            window_width: 400,
            window_height: 560,
            launcher_style: 'button',
            launcher_text: null,
            launcher_icon: null,
            offset_x: 24,
            offset_y: 24,
            movable_window: false,
            start_mode: 'button_only',
            start_delay_seconds: 0,
            greeting_message: null,
            sound_agent_message: 'none',
            sound_visitor_message: 'none'
        },
        visibility: {
            display_pages: 'all',
            page_urls: [],
            devices: 'all',
            schedule: { enabled: false, days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '18:00', timezone: null }
        },
        session: {
            persist_session: true,
            persist_visitor: true,
            session_timeout_minutes: 0
        },
        behavior: {
            system_prompt: 'You are a helpful assistant. Answer questions based on the provided context.',
            temperature: 0.7,
            max_tokens: 500,
            show_sources: true
        },
        lead_capture: {
            collect_email: false,
            email_required: false,
            email_prompt: 'Enter your email to continue'
        }
    };
}

function populateConfigForm(config) {
    const appearance = config.appearance || {};
    const behavior = config.behavior || {};
    const primary = appearance.primary_color || '#7B3DFB';

    const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    const setColor = (id, value, auto) => {
        setVal(id, value || auto || primary);
        setVal(id + '-text', value || '');
    };

    // Appearance
    setColor('config-color', primary);
    setVal('config-color-text', primary.toUpperCase());
    setVal('config-title', appearance.chat_title || 'Chat with us');
    setVal('config-agent-caption', appearance.agent_caption || 'Powered by AI');
    setVal('config-avatar-url', appearance.bot_avatar_url || '');
    setVal('config-welcome', appearance.welcome_message || 'Hi! How can I help you today?');
    setVal('config-welcome-title', appearance.welcome_title || 'Hi there! 👋');
    setVal('config-welcome-icon', appearance.welcome_icon || 'default');
    const welcomeCb = document.getElementById('config-welcome-enabled');
    if (welcomeCb) welcomeCb.checked = appearance.welcome_enabled !== false;
    setVal('config-position', appearance.position || 'bottom-right');
    setVal('config-offset-x', appearance.offset_x ?? 24);
    setVal('config-offset-y', appearance.offset_y ?? 24);
    const offsetXVal = document.getElementById('offset-x-val');
    if (offsetXVal) offsetXVal.textContent = (appearance.offset_x ?? 24) + 'px';
    const offsetYVal = document.getElementById('offset-y-val');
    if (offsetYVal) offsetYVal.textContent = (appearance.offset_y ?? 24) + 'px';
    const movableCb = document.getElementById('config-movable-window');
    if (movableCb) movableCb.checked = appearance.movable_window === true;
    setVal('config-window-width', appearance.window_width || 400);
    setVal('config-window-height', appearance.window_height || 560);

    // Theme preset + border radius
    const theme = appearance.theme || 'light_accent';
    const pal = themePaletteDash(primary, theme);
    document.querySelectorAll('input[name="widget-theme"]').forEach(r => {
        r.checked = r.value === theme;
        r.closest('.theme-card')?.classList.toggle('selected', r.checked);
    });
    setVal('config-border-radius', appearance.border_radius ?? 16);
    const brVal = document.getElementById('border-radius-val');
    if (brVal) brVal.textContent = (appearance.border_radius ?? 16) + 'px';

    // Start mode
    const startMode = appearance.start_mode || 'button_only';
    document.querySelectorAll('input[name="start-mode"]').forEach(r => {
        r.checked = r.value === startMode;
        r.closest('.start-mode-option')?.classList.toggle('selected', r.checked);
    });
    const greetGroup = document.getElementById('greeting-message-group');
    if (greetGroup) greetGroup.style.display = startMode === 'greeting' ? '' : 'none';
    setVal('config-greeting-message', appearance.greeting_message || '');
    const delay = appearance.start_delay_seconds || 0;
    document.querySelectorAll('input[name="start-timing"]').forEach(r => {
        r.checked = delay > 0 ? r.value === 'delay' : r.value === '0';
    });
    const delayGroup = document.getElementById('start-delay-group');
    if (delayGroup) delayGroup.style.display = delay > 0 ? '' : 'none';
    setVal('config-start-delay', delay || 5);

    // Launcher icon
    setVal('config-launcher-icon', appearance.launcher_icon || '');
    const iconPreview = document.getElementById('launcher-icon-preview');
    if (iconPreview) iconPreview.innerHTML = launcherIconPreview(appearance.launcher_icon);
    const iconRemove = document.getElementById('launcher-icon-remove-btn');
    if (iconRemove) iconRemove.disabled = !appearance.launcher_icon;

    // Sounds
    setVal('config-sound-agent', appearance.sound_agent_message || 'none');
    setVal('config-sound-visitor', appearance.sound_visitor_message || 'none');
    setVal('config-launcher-text', appearance.launcher_text || '');
    setVal('config-placeholder', appearance.input_placeholder || '');
    setVal('config-footer-text', appearance.footer_text || '');
    setVal('config-custom-css', appearance.custom_css || '');
    setVal('config-custom-js', appearance.custom_js || '');
    setVal('config-font', appearance.font_family || 'Inter');

    const footerEnabled = document.getElementById('config-footer-enabled');
    if (footerEnabled) footerEnabled.checked = appearance.footer_enabled !== false;
    const footerTextGroup = document.getElementById('footer-text-group');
    if (footerTextGroup) footerTextGroup.style.display = appearance.footer_enabled !== false ? '' : 'none';

    const showOnline = document.getElementById('config-show-online');
    if (showOnline) showOnline.checked = appearance.show_online_indicator !== false;

    // Colors — empty text input = auto (theme palette)
    setColor('config-launcher-bg', appearance.launcher_background, primary);
    setColor('config-launcher-icon-color', appearance.launcher_icon_color || '#FFFFFF');
    setColor('config-header-bg', appearance.header_background, pal.headerBg);
    setColor('config-header-text-color', appearance.header_text_color, pal.headerText);
    setColor('config-online-color', appearance.online_indicator_color || '#22C55E');
    setColor('config-chat-bg', appearance.chat_background, pal.chatBg);
    setColor('config-bot-bg', appearance.bot_message_background, pal.botBg);
    setColor('config-bot-color', appearance.bot_message_color, pal.botColor);
    setColor('config-user-bg', appearance.user_message_background, primary);
    setColor('config-user-color', appearance.user_message_color, pal.userColor);
    setColor('config-input-bg', appearance.input_background, pal.inputBg);
    setColor('config-input-color', appearance.input_text_color, pal.inputText);
    setColor('config-send-color', appearance.send_button_color, primary);
    setColor('config-footer-color', appearance.footer_text_color, pal.muted);

    // Launcher style
    const launcherStyle = appearance.launcher_style || 'button';
    document.querySelectorAll('input[name="launcher-style"]').forEach(r => {
        r.checked = r.value === launcherStyle;
        r.closest('.launcher-style-option')?.classList.toggle('selected', r.checked);
    });
    const textGroup = document.getElementById('launcher-text-group');
    if (textGroup) {
        textGroup.style.display = ['text_button', 'quick_input'].includes(launcherStyle) ? '' : 'none';
    }

    // Avatar thumbnail
    const avatarThumb = document.getElementById('avatar-preview');
    if (avatarThumb) {
        avatarThumb.innerHTML = appearance.bot_avatar_url
            ? `<img src="${escapeHtml(appearance.bot_avatar_url)}" alt="">`
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
    }

    // White-label options
    const hideBrandingCheckbox = document.getElementById('config-hide-branding');
    const whiteLabelEnabled = appearance.hide_branding === true;
    if (hideBrandingCheckbox) hideBrandingCheckbox.checked = whiteLabelEnabled;
    setVal('config-custom-branding', appearance.custom_branding_text || '');
    setVal('config-custom-branding-url', appearance.custom_branding_url || '');
    const g1 = document.getElementById('custom-branding-group');
    const g2 = document.getElementById('custom-branding-url-group');
    if (g1) g1.style.display = whiteLabelEnabled ? '' : 'none';
    if (g2) g2.style.display = whiteLabelEnabled ? '' : 'none';
    document.querySelectorAll('.whitelabel-fields').forEach(el => {
        el.style.display = whiteLabelEnabled ? 'block' : 'none';
    });

    // Behavior
    const promptInput = document.getElementById('config-prompt');
    if (promptInput) promptInput.value = behavior.system_prompt || '';
    const tempSlider = document.getElementById('config-temperature');
    const tempValue = document.getElementById('temp-value');
    if (tempSlider) tempSlider.value = behavior.temperature || 0.7;
    if (tempValue) tempValue.textContent = behavior.temperature || 0.7;
    const maxTokensInput = document.getElementById('config-max-tokens');
    if (maxTokensInput) maxTokensInput.value = behavior.max_tokens || 500;
    const showSourcesCheckbox = document.getElementById('config-show-sources');
    if (showSourcesCheckbox) showSourcesCheckbox.checked = behavior.show_sources !== false;
    const productCardsCheckbox = document.getElementById('config-product-cards');
    if (productCardsCheckbox) productCardsCheckbox.checked = behavior.product_cards !== false;
}

function getConfigFromForm() {
    const val = (id) => document.getElementById(id)?.value;
    const checked = (id) => document.getElementById(id)?.checked;
    // Auto-capable colors: paired "-text" input empty => null (inherit)
    const autoColor = (id) => {
        const text = val(id + '-text');
        return text && text.trim() ? text.trim() : null;
    };
    const launcherStyle = document.querySelector('input[name="launcher-style"]:checked')?.value || 'button';

    return {
        appearance: {
            primary_color: val('config-color') || '#7B3DFB',
            chat_title: val('config-title') || 'Chat with us',
            welcome_message: val('config-welcome') || 'Hi! How can I help you today?',
            welcome_title: val('config-welcome-title') || 'Hi there! 👋',
            welcome_icon: val('config-welcome-icon') || 'default',
            welcome_enabled: checked('config-welcome-enabled') !== false,
            bot_avatar_url: val('config-avatar-url')?.trim() || null,
            position: val('config-position') || 'bottom-right',
            hide_branding: checked('config-hide-branding') || false,
            custom_branding_text: val('config-custom-branding') || null,
            custom_branding_url: val('config-custom-branding-url') || null,
            agent_caption: val('config-agent-caption') || 'Powered by AI',
            show_online_indicator: checked('config-show-online') !== false,
            online_indicator_color: val('config-online-color') || '#22C55E',
            theme: document.querySelector('input[name="widget-theme"]:checked')?.value || 'light_accent',
            border_radius: Math.min(28, Math.max(0, parseInt(val('config-border-radius')) || 0)),
            header_background: autoColor('config-header-bg'),
            header_text_color: autoColor('config-header-text-color'),
            chat_background: autoColor('config-chat-bg'),
            bot_message_background: autoColor('config-bot-bg'),
            bot_message_color: autoColor('config-bot-color'),
            user_message_background: autoColor('config-user-bg'),
            user_message_color: autoColor('config-user-color'),
            input_background: autoColor('config-input-bg'),
            input_text_color: autoColor('config-input-color'),
            input_placeholder: val('config-placeholder') || 'Type your message...',
            send_button_color: autoColor('config-send-color'),
            launcher_background: autoColor('config-launcher-bg'),
            launcher_icon_color: val('config-launcher-icon-color') || '#FFFFFF',
            footer_enabled: checked('config-footer-enabled') !== false,
            footer_text: val('config-footer-text')?.trim() || null,
            footer_text_color: autoColor('config-footer-color'),
            custom_css: val('config-custom-css')?.trim() || null,
            custom_js: val('config-custom-js')?.trim() || null,
            font_family: val('config-font') === 'Inter' ? null : val('config-font'),
            window_width: parseInt(val('config-window-width')) || 400,
            window_height: parseInt(val('config-window-height')) || 560,
            launcher_style: launcherStyle,
            launcher_text: val('config-launcher-text')?.trim() || null,
            launcher_icon: val('config-launcher-icon')?.trim() || null,
            offset_x: Math.min(200, Math.max(0, parseInt(val('config-offset-x')) || 0)),
            offset_y: Math.min(200, Math.max(0, parseInt(val('config-offset-y')) || 0)),
            movable_window: checked('config-movable-window') || false,
            start_mode: document.querySelector('input[name="start-mode"]:checked')?.value || 'button_only',
            start_delay_seconds: document.querySelector('input[name="start-timing"]:checked')?.value === 'delay'
                ? Math.min(60, Math.max(1, parseInt(val('config-start-delay')) || 5)) : 0,
            greeting_message: val('config-greeting-message')?.trim() || null,
            sound_agent_message: val('config-sound-agent') || 'none',
            sound_visitor_message: val('config-sound-visitor') || 'none'
        },
        behavior: {
            system_prompt: val('config-prompt') || '',
            temperature: parseFloat(val('config-temperature')) || 0.7,
            max_tokens: parseInt(val('config-max-tokens')) || 500,
            show_sources: checked('config-show-sources') ?? true,
            product_cards: checked('config-product-cards') ?? true
        }
    };
}

async function saveConfig() {
    if (!currentDetailSite) return;
    
    const saveBtn = document.getElementById('save-config');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    
    try {
        const config = getConfigFromForm();
        // Only send sections whose form is on screen — the PUT replaces each
        // section wholesale, so absent fields would reset saved values.
        if (!document.getElementById('appearance-form')) delete config.appearance;
        if (!document.getElementById('config-prompt')) delete config.behavior;
        
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(config)
        });
        
        if (response.ok) {
            currentSiteConfig = await response.json();
            saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.disabled = false;
            }, 1500);
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Failed to save config:', error);
        alert('Failed to save configuration. Please try again.');
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

async function resetConfig() {
    if (!currentDetailSite) return;
    
    if (!confirm('Are you sure you want to reset the configuration to defaults?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config/reset`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            currentSiteConfig = await response.json();
            populateConfigForm(currentSiteConfig);
        } else {
            throw new Error('Failed to reset');
        }
    } catch (error) {
        console.error('Failed to reset config:', error);
        alert('Failed to reset configuration. Please try again.');
    }
}

// ==================== Conversation Management ====================

let conversationsState = {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    siteFilter: '',
    sortBy: 'updated_at',
    sortOrder: 'desc',
    searchQuery: '',
    dateFrom: '',
    dateTo: '',
    statusFilter: '',
    priorityFilter: '',
    tagFilter: '',
    selectedIds: new Set(),
    currentConversation: null
};

let searchDebounceTimer = null;

function initConversationsView() {
    setupConversationEventListeners();
    populateConvSiteFilter();
    loadConversations();
}

function setupConversationEventListeners() {
    const searchInput = document.getElementById('conv-search-input');
    if (searchInput && !searchInput._convListenerSet) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                conversationsState.searchQuery = e.target.value;
                conversationsState.page = 1;
                loadConversations();
            }, 300);
        });
        searchInput._convListenerSet = true;
    }
    
    const siteFilter = document.getElementById('conv-site-filter');
    if (siteFilter && !siteFilter._convListenerSet) {
        siteFilter.addEventListener('change', (e) => {
            conversationsState.siteFilter = e.target.value;
            conversationsState.page = 1;
            loadConversations();
        });
        siteFilter._convListenerSet = true;
    }
    
    const sortSelect = document.getElementById('conv-sort-select');
    if (sortSelect && !sortSelect._convListenerSet) {
        sortSelect.addEventListener('change', (e) => {
            const [sortBy, order] = e.target.value.split('-');
            conversationsState.sortBy = sortBy;
            conversationsState.sortOrder = order;
            conversationsState.page = 1;
            loadConversations();
        });
        sortSelect._convListenerSet = true;
    }

    const dateFrom = document.getElementById('conv-date-from');
    if (dateFrom && !dateFrom._convListenerSet) {
        dateFrom.addEventListener('change', (e) => {
            conversationsState.dateFrom = e.target.value;
            conversationsState.page = 1;
            loadConversations();
        });
        dateFrom._convListenerSet = true;
    }

    const dateTo = document.getElementById('conv-date-to');
    if (dateTo && !dateTo._convListenerSet) {
        dateTo.addEventListener('change', (e) => {
            conversationsState.dateTo = e.target.value;
            conversationsState.page = 1;
            loadConversations();
        });
        dateTo._convListenerSet = true;
    }

    const prevBtn = document.getElementById('prev-page');
    if (prevBtn && !prevBtn._convListenerSet) {
        prevBtn.addEventListener('click', () => {
            if (conversationsState.page > 1) {
                conversationsState.page--;
                loadConversations();
            }
        });
        prevBtn._convListenerSet = true;
    }
    
    const nextBtn = document.getElementById('next-page');
    if (nextBtn && !nextBtn._convListenerSet) {
        nextBtn.addEventListener('click', () => {
            if (conversationsState.page < conversationsState.totalPages) {
                conversationsState.page++;
                loadConversations();
            }
        });
        nextBtn._convListenerSet = true;
    }
    
    const statusFilter = document.getElementById('conv-status-filter');
    if (statusFilter && !statusFilter._convListenerSet) {
        statusFilter.addEventListener('change', (e) => {
            conversationsState.statusFilter = e.target.value;
            conversationsState.page = 1;
            loadConversations();
        });
        statusFilter._convListenerSet = true;
    }

    const priorityFilter = document.getElementById('conv-priority-filter');
    if (priorityFilter && !priorityFilter._convListenerSet) {
        priorityFilter.addEventListener('change', (e) => {
            conversationsState.priorityFilter = e.target.value;
            conversationsState.page = 1;
            loadConversations();
        });
        priorityFilter._convListenerSet = true;
    }

    const bulkStatusSelect = document.getElementById('bulk-status-select');
    if (bulkStatusSelect && !bulkStatusSelect._convListenerSet) {
        bulkStatusSelect.addEventListener('change', async (e) => {
            const status = e.target.value;
            if (!status) return;
            await bulkUpdateStatus(status);
            e.target.value = '';
        });
        bulkStatusSelect._convListenerSet = true;
    }

    const selectAllCheckbox = document.getElementById('select-all-convs');
    if (selectAllCheckbox && !selectAllCheckbox._convListenerSet) {
        selectAllCheckbox.addEventListener('change', (e) => {
            toggleSelectAll(e.target.checked);
        });
        selectAllCheckbox._convListenerSet = true;
    }
    
    const exportSelectedBtn = document.getElementById('export-selected');
    if (exportSelectedBtn && !exportSelectedBtn._convListenerSet) {
        exportSelectedBtn.addEventListener('click', () => openExportModal('bulk'));
        exportSelectedBtn._convListenerSet = true;
    }
    
    const deleteSelectedBtn = document.getElementById('delete-selected');
    if (deleteSelectedBtn && !deleteSelectedBtn._convListenerSet) {
        deleteSelectedBtn.addEventListener('click', () => openDeleteModal('bulk'));
        deleteSelectedBtn._convListenerSet = true;
    }
    
    const exportConvBtn = document.getElementById('export-conv');
    if (exportConvBtn && !exportConvBtn._convListenerSet) {
        exportConvBtn.addEventListener('click', () => openExportModal('single'));
        exportConvBtn._convListenerSet = true;
    }
    
    const deleteConvBtn = document.getElementById('delete-conv');
    if (deleteConvBtn && !deleteConvBtn._convListenerSet) {
        deleteConvBtn.addEventListener('click', () => openDeleteModal('single'));
        deleteConvBtn._convListenerSet = true;
    }
    
    // Export modal
    const closeExportModal = document.getElementById('close-export-modal');
    if (closeExportModal && !closeExportModal._convListenerSet) {
        closeExportModal.addEventListener('click', () => {
            document.getElementById('export-modal').classList.remove('active');
        });
        closeExportModal._convListenerSet = true;
    }
    
    document.querySelectorAll('.export-option').forEach(btn => {
        if (!btn._convListenerSet) {
            btn.addEventListener('click', () => handleExport(btn.dataset.format));
            btn._convListenerSet = true;
        }
    });
    
    // Delete modal
    const closeDeleteModal = document.getElementById('close-delete-modal');
    if (closeDeleteModal && !closeDeleteModal._convListenerSet) {
        closeDeleteModal.addEventListener('click', () => {
            document.getElementById('delete-confirm-modal').classList.remove('active');
        });
        closeDeleteModal._convListenerSet = true;
    }
    
    const cancelDelete = document.getElementById('cancel-delete');
    if (cancelDelete && !cancelDelete._convListenerSet) {
        cancelDelete.addEventListener('click', () => {
            document.getElementById('delete-confirm-modal').classList.remove('active');
        });
        cancelDelete._convListenerSet = true;
    }
    
    const confirmDelete = document.getElementById('confirm-delete');
    if (confirmDelete && !confirmDelete._convListenerSet) {
        confirmDelete.addEventListener('click', handleDelete);
        confirmDelete._convListenerSet = true;
    }
}

async function populateConvSiteFilter() {
    const select = document.getElementById('conv-site-filter');
    if (!select) return;
    
    select.innerHTML = '<option value="">All Sites</option>';
    
    if (sites.length === 0) {
        await loadSites();
    }
    
    sites.forEach(site => {
        const option = document.createElement('option');
        option.value = site.site_id;
        option.textContent = site.name || site.url;
        select.appendChild(option);
    });
}

async function loadConversations() {
    const listContainer = document.getElementById('conversations-list');
    listContainer.innerHTML = `
        <div class="conversations-loading">
            <div class="spinner"></div>
            <span>Loading conversations...</span>
        </div>
    `;
    
    try {
        let url;
        const params = new URLSearchParams();
        params.append('page', conversationsState.page);
        params.append('limit', conversationsState.limit);
        
        if (conversationsState.searchQuery) {
            url = `${API_BASE}/conversations/search`;
            params.append('q', conversationsState.searchQuery);
            if (conversationsState.siteFilter) {
                params.append('site_id', conversationsState.siteFilter);
            }
        } else {
            url = `${API_BASE}/conversations`;
            params.append('sort_by', conversationsState.sortBy);
            params.append('order', conversationsState.sortOrder);
            if (conversationsState.siteFilter) {
                params.append('site_id', conversationsState.siteFilter);
            }
            if (conversationsState.dateFrom) {
                params.append('date_from', new Date(conversationsState.dateFrom).toISOString());
            }
            if (conversationsState.dateTo) {
                const toDate = new Date(conversationsState.dateTo);
                toDate.setHours(23, 59, 59, 999);
                params.append('date_to', toDate.toISOString());
            }
            if (conversationsState.statusFilter) {
                params.append('status', conversationsState.statusFilter);
            }
            if (conversationsState.priorityFilter) {
                params.append('priority', conversationsState.priorityFilter);
            }
            if (conversationsState.tagFilter) {
                params.append('tag', conversationsState.tagFilter);
            }
        }
        
        const response = await fetch(`${url}?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load conversations');
        
        const data = await response.json();
        conversationsState.total = data.total;
        conversationsState.totalPages = data.total_pages;
        
        renderConversationsList(data.conversations);
        updatePagination();
        updateConvCount();
        
    } catch (error) {
        console.error('Failed to load conversations:', error);
        listContainer.innerHTML = `
            <div class="conv-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h4>Error loading conversations</h4>
                <p>Please try again later</p>
            </div>
        `;
    }
}

function renderConversationsList(conversations) {
    const listContainer = document.getElementById('conversations-list');
    
    if (!conversations || conversations.length === 0) {
        listContainer.innerHTML = `
            <div class="conv-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                </svg>
                <h4>No conversations found</h4>
                <p>${conversationsState.searchQuery ? 'Try a different search term' : 'Conversations will appear here'}</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = '';
    
    conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conv-list-item';
        if (conversationsState.selectedIds.has(conv.session_id)) {
            item.classList.add('selected');
        }
        
        const timeAgo = formatTimeAgo(new Date(conv.updated_at));
        const preview = conv.matching_snippet || conv.first_message || 'No message preview';
        const siteName = sites.find(s => s.site_id === conv.site_id)?.name || conv.site_id || 'Unknown';

        const status = conv.status || 'open';
        const priority = conv.priority || 'medium';
        const unreadDot = conv.unread ? '<span class="conv-unread-dot"></span>' : '';
        const statusBadge = `<span class="conv-status-badge status-${status}">${status}</span>`;
        const priorityBadge = priority !== 'medium' ? `<span class="conv-priority-badge priority-${priority}">${priority}</span>` : '';
        const visitorLabel = conv.visitor_name ? `<span class="conv-visitor-name">${escapeHtml(conv.visitor_name)}</span>` : '';

        item.innerHTML = `
            <input type="checkbox" class="conv-checkbox" data-session-id="${conv.session_id}"
                   ${conversationsState.selectedIds.has(conv.session_id) ? 'checked' : ''}>
            ${unreadDot}
            <div class="conv-list-content">
                <div class="conv-list-header">
                    <span class="conv-list-title">${escapeHtml(siteName)}</span>
                    <span class="conv-list-time">${timeAgo}</span>
                </div>
                <div class="conv-list-badges">
                    ${statusBadge}${priorityBadge}${visitorLabel}
                </div>
                <div class="conv-list-preview">${escapeHtml(preview)}</div>
                <div class="conv-list-meta">
                    <span class="conv-meta-tag">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                        </svg>
                        ${conv.message_count} messages
                    </span>
                </div>
            </div>
        `;
        
        const checkbox = item.querySelector('.conv-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleConversationSelection(conv.session_id, e.target.checked);
        });
        
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                selectConversation(conv.session_id);
            }
        });
        
        listContainer.appendChild(item);
    });
}

function toggleConversationSelection(sessionId, isSelected) {
    if (isSelected) {
        conversationsState.selectedIds.add(sessionId);
    } else {
        conversationsState.selectedIds.delete(sessionId);
    }
    
    updateBulkActionsBar();
    
    const item = document.querySelector(`.conv-checkbox[data-session-id="${sessionId}"]`)?.closest('.conv-list-item');
    if (item) {
        item.classList.toggle('selected', isSelected);
    }
}

function toggleSelectAll(isSelected) {
    const checkboxes = document.querySelectorAll('.conv-checkbox');
    checkboxes.forEach(cb => {
        const sessionId = cb.dataset.sessionId;
        cb.checked = isSelected;
        if (isSelected) {
            conversationsState.selectedIds.add(sessionId);
        } else {
            conversationsState.selectedIds.delete(sessionId);
        }
        cb.closest('.conv-list-item')?.classList.toggle('selected', isSelected);
    });
    
    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bulkBar = document.getElementById('bulk-actions-bar');
    const selectedCount = document.getElementById('selected-count');
    
    if (conversationsState.selectedIds.size > 0) {
        bulkBar.style.display = 'flex';
        selectedCount.textContent = `${conversationsState.selectedIds.size} selected`;
    } else {
        bulkBar.style.display = 'none';
    }
}

function updatePagination() {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    const info = document.getElementById('pagination-info');
    
    prevBtn.disabled = conversationsState.page <= 1;
    nextBtn.disabled = conversationsState.page >= conversationsState.totalPages;
    info.textContent = `Page ${conversationsState.page} of ${conversationsState.totalPages || 1}`;
}

function updateConvCount() {
    const countEl = document.getElementById('conversations-count');
    if (countEl) {
        countEl.textContent = `${conversationsState.total} total`;
    }
}

async function selectConversation(sessionId) {
    conversationsState.currentConversation = sessionId;

    document.querySelectorAll('.conv-list-item').forEach(item => {
        const checkbox = item.querySelector('.conv-checkbox');
        if (checkbox && checkbox.dataset.sessionId === sessionId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    await loadConversationDetail(sessionId);

    // Mark as read
    try {
        await fetch(`${API_BASE}/conversations/${sessionId}/read`, {
            method: 'PATCH',
            headers: getAuthHeaders()
        });
        // Remove unread dot in list
        const item = document.querySelector(`.conv-checkbox[data-session-id="${sessionId}"]`)?.closest('.conv-list-item');
        if (item) item.querySelector('.conv-unread-dot')?.remove();
    } catch(e) { /* silent */ }
}

async function loadConversationDetail(sessionId) {
    const emptyState = document.querySelector('.conversation-detail-empty');
    const contentState = document.getElementById('conversation-detail-content');

    emptyState.style.display = 'none';
    contentState.style.display = 'flex';

    // Mobile: full-screen detail
    const layout = document.querySelector('.conversations-layout');
    if (layout && !layout.classList.contains('detail-open')) {
        layout.classList.add('detail-open');
        mobileNav.push(() => {
            if (layout) layout.classList.remove('detail-open');
            if (emptyState) emptyState.style.display = 'flex';
            if (contentState) contentState.style.display = 'none';
        }, 'Conversation');
    }
    
    const transcript = document.getElementById('conversation-transcript');
    transcript.innerHTML = `
        <div class="conversations-loading">
            <div class="spinner"></div>
            <span>Loading conversation...</span>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_BASE}/conversations/${sessionId}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load conversation');
        
        const conv = await response.json();
        
        // Update header
        const siteName = sites.find(s => s.site_id === conv.site_id)?.name || conv.site_id || 'Unknown Site';
        document.getElementById('detail-conv-title').textContent = siteName;
        document.getElementById('detail-conv-meta').textContent = 
            `Started ${formatTimeAgo(new Date(conv.created_at))} • Session: ${conv.session_id.substring(0, 12)}...`;
        
        // Store current conv data for visitor modal pre-fill
        window._currentConvData = conv;

        // Update stats
        document.getElementById('stat-messages').textContent = conv.stats.message_count;
        document.getElementById('stat-response-time').textContent =
            conv.stats.avg_response_time_ms > 0 ? `${Math.round(conv.stats.avg_response_time_ms)}ms` : '-';
        document.getElementById('stat-positive').textContent = conv.stats.positive_feedback;
        document.getElementById('stat-negative').textContent = conv.stats.negative_feedback;
        document.getElementById('stat-first-response').textContent =
            conv.stats.first_response_time_ms ? formatDuration(conv.stats.first_response_time_ms) : '-';
        document.getElementById('stat-resolution').textContent =
            conv.stats.resolution_time_ms ? formatDuration(conv.stats.resolution_time_ms) : '-';

        // Status / priority selects
        const statusSelect = document.getElementById('detail-status-select');
        const prioritySelect = document.getElementById('detail-priority-select');
        if (statusSelect) {
            statusSelect.value = conv.status || 'open';
            // Replace element to clear old listeners
            const newStatus = statusSelect.cloneNode(true);
            statusSelect.parentNode.replaceChild(newStatus, statusSelect);
            newStatus.value = conv.status || 'open';
            newStatus.addEventListener('change', async (e) => {
                await updateConvStatus(conv.session_id, e.target.value);
            });
        }
        if (prioritySelect) {
            prioritySelect.value = conv.priority || 'medium';
            const newPriority = prioritySelect.cloneNode(true);
            prioritySelect.parentNode.replaceChild(newPriority, prioritySelect);
            newPriority.value = conv.priority || 'medium';
            newPriority.addEventListener('change', async (e) => {
                await updateConvPriority(conv.session_id, e.target.value);
            });
        }

        // Visitor info
        renderVisitorInfo(conv);

        // Tags
        window._currentTags = conv.tags || [];
        renderConvTags(window._currentTags);

        // Notes
        renderConvNotes(conv.notes || []);

        // Star rating
        renderStarRating(conv.satisfaction_rating);

        // Sentiment
        if (conv.sentiment !== null && conv.sentiment !== undefined) {
            document.getElementById('conv-sentiment-row').style.display = 'flex';
            const label = conv.sentiment > 0.3 ? '\u{1F60A} Positive' : conv.sentiment < -0.3 ? '\u{1F61E} Negative' : '\u{1F610} Neutral';
            document.getElementById('conv-sentiment-label').textContent = label;
        } else {
            document.getElementById('conv-sentiment-row').style.display = 'none';
        }

        // Page URL context
        if (conv.page_url) {
            document.getElementById('conv-context-row').style.display = 'flex';
            const urlEl = document.getElementById('conv-page-url');
            urlEl.href = conv.page_url;
            urlEl.textContent = conv.page_url;
        } else {
            document.getElementById('conv-context-row').style.display = 'none';
        }

        // Render transcript with Q&A support
        renderTranscript(conv.messages, conv.session_id, conv.site_id);
        
    } catch (error) {
        console.error('Failed to load conversation detail:', error);
        transcript.innerHTML = `
            <div class="conv-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h4>Error loading conversation</h4>
                <p>Please try again</p>
            </div>
        `;
    }
}

function renderTranscript(messages, sessionId = null, siteId = null) {
    const transcript = document.getElementById('conversation-transcript');
    
    if (!messages || messages.length === 0) {
        transcript.innerHTML = '<p style="text-align: center; color: var(--gray-400);">No messages in this conversation</p>';
        return;
    }
    
    transcript.innerHTML = '';
    
    messages.forEach((msg, index) => {
        const msgEl = document.createElement('div');
        msgEl.className = `transcript-message ${msg.role}`;
        
        const avatar = msg.role === 'assistant' ? 'AI' : 'U';
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let feedbackHtml = '';
        if (msg.feedback) {
            const feedbackClass = msg.feedback === 'positive' ? 'positive' : 'negative';
            const feedbackIcon = msg.feedback === 'positive' 
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>';
            feedbackHtml = `<span class="transcript-feedback ${feedbackClass}">${feedbackIcon}</span>`;
        }
        
        let sourcesHtml = '';
        if (msg.sources && msg.sources.length > 0 && msg.role === 'assistant') {
            const sourcesItems = msg.sources.slice(0, 3).map(s => 
                `<a href="${escapeHtml(s.url || '#')}" target="_blank" class="transcript-source-item">${escapeHtml(s.title || s.url || 'Source')}</a>`
            ).join('');
            sourcesHtml = `
                <div class="transcript-sources">
                    <div class="transcript-sources-label">Sources</div>
                    ${sourcesItems}
                </div>
            `;
        }
        
        // Q&A actions for assistant messages
        let qaActionsHtml = '';
        if (msg.role === 'assistant' && sessionId && siteId && index > 0) {
            const prevMsg = messages[index - 1];
            const question = prevMsg && prevMsg.role === 'user' ? prevMsg.content : '';
            const answer = msg.content;
            
            if (msg.qa_pair_id) {
                qaActionsHtml = `
                    <div class="transcript-bubble-actions">
                        <span class="qa-badge">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Q&A Created
                        </span>
                    </div>
                `;
            } else {
                const escapedQuestion = escapeHtml(question).replace(/'/g, "\\'").replace(/\n/g, "\\n");
                const escapedAnswer = escapeHtml(answer).replace(/'/g, "\\'").replace(/\n/g, "\\n");
                qaActionsHtml = `
                    <div class="transcript-bubble-actions">
                        <button class="create-qa-btn" onclick="openQAFromConversationModal('${sessionId}', ${index}, '${escapedQuestion}', '${escapedAnswer}', '${siteId}')" title="Create Q&A pair from this response">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2v20M2 12h20"/>
                            </svg>
                            Create Q&A
                        </button>
                    </div>
                `;
            }
        }
        
        msgEl.innerHTML = `
            <div class="transcript-avatar">${avatar}</div>
            <div class="transcript-bubble">
                <div class="transcript-bubble-content">${escapeHtml(msg.content)}</div>
                <div class="transcript-bubble-meta">
                    <span>${time}</span>
                    ${msg.response_time_ms ? `<span>${msg.response_time_ms}ms</span>` : ''}
                    ${feedbackHtml}
                </div>
                ${sourcesHtml}
                ${qaActionsHtml}
            </div>
        `;
        
        transcript.appendChild(msgEl);
    });
    
    transcript.scrollTop = transcript.scrollHeight;
}

// ===== Conversation Feature Functions =====

function formatDuration(ms) {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
}

async function updateConvStatus(sessionId, status) {
    try {
        const res = await fetch(`${API_BASE}/conversations/${sessionId}/status`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error();
        loadConversations();
    } catch(e) {
        alert('Failed to update status');
    }
}

async function updateConvPriority(sessionId, priority) {
    try {
        const res = await fetch(`${API_BASE}/conversations/${sessionId}/priority`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ priority })
        });
        if (!res.ok) throw new Error();
        loadConversations();
    } catch(e) {
        alert('Failed to update priority');
    }
}

async function bulkUpdateStatus(status) {
    const sessionIds = Array.from(conversationsState.selectedIds);
    if (!sessionIds.length) return;
    try {
        await Promise.all(sessionIds.map(id =>
            fetch(`${API_BASE}/conversations/${id}/status`, {
                method: 'PATCH',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            })
        ));
        conversationsState.selectedIds.clear();
        updateBulkActionsBar();
        loadConversations();
    } catch(e) {
        alert('Failed to update status for some conversations');
    }
}

function renderVisitorInfo(conv) {
    const el = document.getElementById('conv-visitor-info');
    if (!el) return;
    if (conv.visitor_name || conv.visitor_email) {
        el.innerHTML = `
            ${conv.visitor_name ? `<div class="visitor-field"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> ${escapeHtml(conv.visitor_name)}</div>` : ''}
            ${conv.visitor_email ? `<div class="visitor-field"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg> <a href="mailto:${escapeHtml(conv.visitor_email)}">${escapeHtml(conv.visitor_email)}</a></div>` : ''}
        `;
    } else {
        el.innerHTML = '<span class="visitor-empty">No visitor info</span>';
    }
}

function renderConvTags(tags) {
    const list = document.getElementById('conv-tags-list');
    if (!list) return;
    list.innerHTML = tags.map((tag, idx) => `
        <span class="conv-tag-pill">
            ${escapeHtml(tag)}
            <button onclick="removeConvTagByIndex(${idx})" class="tag-remove">&times;</button>
        </span>
    `).join('');
}

window._currentTags = [];

async function addConvTag() {
    const input = document.getElementById('conv-tag-input');
    if (!input) return;
    const tag = input.value.trim();
    if (!tag || window._currentTags.includes(tag)) return;
    window._currentTags = [...window._currentTags, tag];
    input.value = '';
    await saveConvTags();
    renderConvTags(window._currentTags);
}

async function removeConvTagByIndex(idx) {
    window._currentTags = window._currentTags.filter((_, i) => i !== idx);
    await saveConvTags();
    renderConvTags(window._currentTags);
}

async function saveConvTags() {
    const sessionId = conversationsState.currentConversation;
    if (!sessionId) return;
    try {
        await fetch(`${API_BASE}/conversations/${sessionId}/tags`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: window._currentTags })
        });
    } catch(e) { /* silent */ }
}

window._notesStore = {};

function renderConvNotes(notes) {
    const list = document.getElementById('conv-notes-list');
    if (!list) return;
    if (!notes.length) {
        list.innerHTML = '<span class="visitor-empty">No notes yet</span>';
        window._notesStore = {};
        return;
    }
    window._notesStore = {};
    notes.forEach(note => { window._notesStore[note.note_id] = note.content; });
    list.innerHTML = notes.map(note => `
        <div class="conv-note-item" data-note-id="${note.note_id}">
            <div class="conv-note-content">${escapeHtml(note.content)}</div>
            <div class="conv-note-meta">
                <span>${formatTimeAgo(new Date(note.created_at))}</span>
                <div class="conv-note-actions">
                    <button onclick="openEditNoteModal('${note.note_id}')" class="btn-link">Edit</button>
                    <button onclick="deleteNote('${note.note_id}')" class="btn-link danger">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
}

let _editingNoteId = null;

function openAddNoteModal() {
    _editingNoteId = null;
    const titleEl = document.getElementById('note-modal-title');
    const inputEl = document.getElementById('note-content-input');
    if (titleEl) titleEl.textContent = 'Add Note';
    if (inputEl) inputEl.value = '';
    document.getElementById('note-modal')?.classList.add('active');
}

function openEditNoteModal(noteId) {
    _editingNoteId = noteId;
    const titleEl = document.getElementById('note-modal-title');
    const inputEl = document.getElementById('note-content-input');
    if (titleEl) titleEl.textContent = 'Edit Note';
    if (inputEl) inputEl.value = window._notesStore[noteId] || '';
    document.getElementById('note-modal')?.classList.add('active');
}

async function saveNote() {
    const contentEl = document.getElementById('note-content-input');
    const content = contentEl ? contentEl.value.trim() : '';
    if (!content) return;
    const sessionId = conversationsState.currentConversation;
    document.getElementById('note-modal')?.classList.remove('active');
    try {
        if (_editingNoteId) {
            await fetch(`${API_BASE}/conversations/${sessionId}/notes/${_editingNoteId}`, {
                method: 'PUT',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
        } else {
            await fetch(`${API_BASE}/conversations/${sessionId}/notes`, {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
        }
        loadConversationDetail(sessionId);
    } catch(e) {
        alert('Failed to save note');
    }
}

async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    const sessionId = conversationsState.currentConversation;
    try {
        await fetch(`${API_BASE}/conversations/${sessionId}/notes/${noteId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        loadConversationDetail(sessionId);
    } catch(e) {
        alert('Failed to delete note');
    }
}

function openEditVisitorModal() {
    const conv = window._currentConvData;
    const nameEl = document.getElementById('visitor-name-input');
    const emailEl = document.getElementById('visitor-email-input');
    if (nameEl) nameEl.value = conv ? (conv.visitor_name || '') : '';
    if (emailEl) emailEl.value = conv ? (conv.visitor_email || '') : '';
    document.getElementById('edit-visitor-modal')?.classList.add('active');
}

async function saveVisitorInfo() {
    const nameEl = document.getElementById('visitor-name-input');
    const emailEl = document.getElementById('visitor-email-input');
    const name = nameEl ? nameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    const sessionId = conversationsState.currentConversation;
    document.getElementById('edit-visitor-modal')?.classList.remove('active');
    try {
        await fetch(`${API_BASE}/conversations/${sessionId}/visitor`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitor_name: name || null, visitor_email: email || null })
        });
        loadConversationDetail(sessionId);
    } catch(e) {
        alert('Failed to save visitor info');
    }
}

function renderStarRating(currentRating) {
    const stars = document.querySelectorAll('#conv-star-rating .star');
    stars.forEach(star => {
        const val = parseInt(star.dataset.value);
        star.classList.toggle('active', !!(currentRating && val <= currentRating));
        star.onclick = () => setConvRating(val);
    });
}

async function setConvRating(rating) {
    const sessionId = conversationsState.currentConversation;
    try {
        await fetch(`${API_BASE}/conversations/${sessionId}/rating`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating })
        });
        renderStarRating(rating);
    } catch(e) {
        alert('Failed to set rating');
    }
}

// Export functionality
let exportMode = 'single';

function openExportModal(mode) {
    exportMode = mode;
    document.getElementById('export-modal').classList.add('active');
}

async function handleExport(format) {
    document.getElementById('export-modal').classList.remove('active');
    
    const sessionIds = exportMode === 'bulk' 
        ? Array.from(conversationsState.selectedIds)
        : [conversationsState.currentConversation];
    
    if (sessionIds.length === 0 || (sessionIds.length === 1 && !sessionIds[0])) {
        alert('No conversations selected for export');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/conversations/export`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                session_ids: sessionIds,
                format: format
            })
        });
        
        if (!response.ok) throw new Error('Export failed');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversations_export.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Export failed:', error);
        alert('Failed to export conversations. Please try again.');
    }
}

// Delete functionality
let deleteMode = 'single';

function openDeleteModal(mode) {
    deleteMode = mode;
    const messageEl = document.getElementById('delete-confirm-message');
    
    if (mode === 'bulk') {
        const count = conversationsState.selectedIds.size;
        messageEl.textContent = `Are you sure you want to delete ${count} conversation${count > 1 ? 's' : ''}? This action cannot be undone.`;
    } else {
        messageEl.textContent = 'Are you sure you want to delete this conversation? This action cannot be undone.';
    }
    
    document.getElementById('delete-confirm-modal').classList.add('active');
}

async function handleDelete() {
    document.getElementById('delete-confirm-modal').classList.remove('active');
    
    const sessionIds = deleteMode === 'bulk'
        ? Array.from(conversationsState.selectedIds)
        : [conversationsState.currentConversation];
    
    if (sessionIds.length === 0 || (sessionIds.length === 1 && !sessionIds[0])) {
        return;
    }
    
    try {
        if (sessionIds.length === 1) {
            await fetch(`${API_BASE}/conversations/${sessionIds[0]}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
        } else {
            await fetch(`${API_BASE}/conversations/bulk-delete`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ session_ids: sessionIds })
            });
        }
        
        conversationsState.selectedIds.clear();
        conversationsState.currentConversation = null;
        updateBulkActionsBar();
        
        // Hide detail panel
        document.querySelector('.conversation-detail-empty').style.display = 'flex';
        document.getElementById('conversation-detail-content').style.display = 'none';
        
        // Reload list
        await loadConversations();
        
    } catch (error) {
        console.error('Delete failed:', error);
        alert('Failed to delete conversation(s). Please try again.');
    }
}

// ==================== Quick Prompts Management ====================

let quickPromptsState = {
    prompts: [],
    enabled: true,
    showAfterResponse: false,
    maxDisplay: 4
};

function initQuickPromptsHandlers() {
    document.getElementById('add-quick-prompt-btn')?.addEventListener('click', () => addQuickPromptRow());
    document.getElementById('add-quick-card-btn')?.addEventListener('click', () => addQuickPromptRow('card'));
    document.getElementById('add-quick-prompt-empty-btn')?.addEventListener('click', () => addQuickPromptRow());
    
    document.getElementById('quick-prompts-enabled')?.addEventListener('change', (e) => {
        const content = document.getElementById('quick-prompts-content');
        if (content) {
            content.style.opacity = e.target.checked ? '1' : '0.5';
            content.style.pointerEvents = e.target.checked ? 'auto' : 'none';
        }
        quickPromptsState.enabled = e.target.checked;
    });
    
    document.getElementById('quick-prompts-max-display')?.addEventListener('change', (e) => {
        quickPromptsState.maxDisplay = parseInt(e.target.value);
    });
    
    document.getElementById('quick-prompts-show-after-response')?.addEventListener('change', (e) => {
        quickPromptsState.showAfterResponse = e.target.checked;
    });
    
    document.getElementById('save-quick-prompts')?.addEventListener('click', saveQuickPrompts);
}

async function loadQuickPrompts() {
    if (!currentDetailSite) return;
    
    const listEl = document.getElementById('quick-prompts-list');
    const emptyEl = document.getElementById('quick-prompts-empty');
    
    listEl.innerHTML = `
        <div class="quick-prompts-loading">
            <div class="spinner-sm"></div>
            <span>Loading prompts...</span>
        </div>
    `;
    emptyEl.classList.add('hidden');
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/quick-prompts`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load quick prompts');
        
        const data = await response.json();
        quickPromptsState.prompts = data.prompts || [];
        quickPromptsState.enabled = data.enabled !== false;
        quickPromptsState.showAfterResponse = data.show_after_response === true;
        quickPromptsState.maxDisplay = data.max_display || 4;
        
        renderQuickPromptsList();
        
        // Update toggles
        const enabledToggle = document.getElementById('quick-prompts-enabled');
        if (enabledToggle) enabledToggle.checked = quickPromptsState.enabled;
        
        const showAfterToggle = document.getElementById('quick-prompts-show-after-response');
        if (showAfterToggle) showAfterToggle.checked = quickPromptsState.showAfterResponse;
        
        const maxDisplaySelect = document.getElementById('quick-prompts-max-display');
        if (maxDisplaySelect) maxDisplaySelect.value = quickPromptsState.maxDisplay;
        
        const content = document.getElementById('quick-prompts-content');
        if (content) {
            content.style.opacity = quickPromptsState.enabled ? '1' : '0.5';
            content.style.pointerEvents = quickPromptsState.enabled ? 'auto' : 'none';
        }
        
    } catch (error) {
        console.error('Failed to load quick prompts:', error);
        listEl.innerHTML = '<div class="quick-prompts-loading">Error loading prompts</div>';
    }
}

function renderQuickPromptsList() {
    const listEl = document.getElementById('quick-prompts-list');
    const emptyEl = document.getElementById('quick-prompts-empty');
    
    if (quickPromptsState.prompts.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    
    emptyEl.classList.add('hidden');
    listEl.innerHTML = '';
    
    quickPromptsState.prompts.forEach((prompt, index) => {
        const isCard = (prompt.type || 'suggestion') === 'card';
        const buttons = Array.isArray(prompt.buttons) ? prompt.buttons : [];
        const item = document.createElement('div');
        item.className = 'quick-prompt-item' + (isCard ? ' quick-prompt-card-item' : '');
        item.dataset.id = prompt.id;
        item.innerHTML = `
            <div class="quick-prompt-drag-handle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" y1="6" x2="16" y2="6"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                    <line x1="8" y1="18" x2="16" y2="18"/>
                </svg>
            </div>
            <div class="quick-prompt-icon-wrapper">
                <input type="text" class="quick-prompt-icon-input" value="${escapeHtml(prompt.icon || '')}" placeholder="💬" maxlength="4" title="Emoji icon">
            </div>
            <div class="quick-prompt-text-wrapper">
                <input type="text" class="quick-prompt-text-input" value="${escapeHtml(prompt.text)}" placeholder="${isCard ? 'Card title...' : 'Enter prompt text...'}" maxlength="100">
            </div>
            <div class="quick-prompt-type-wrapper">
                <select class="quick-prompt-type-select" title="Prompt type">
                    <option value="suggestion" ${!isCard ? 'selected' : ''}>Chip</option>
                    <option value="card" ${isCard ? 'selected' : ''}>Card</option>
                </select>
            </div>
            <div class="quick-prompt-actions">
                <label class="quick-prompt-toggle" title="Enable/Disable">
                    <input type="checkbox" class="quick-prompt-enabled" ${prompt.enabled !== false ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
                <button type="button" class="quick-prompt-move-up" title="Move up" ${index === 0 ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button type="button" class="quick-prompt-move-down" title="Move down" ${index === quickPromptsState.prompts.length - 1 ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button type="button" class="quick-prompt-delete" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
            </div>
            ${isCard ? `
            <div class="quick-card-fields">
                <input type="text" class="form-input quick-card-desc" value="${escapeHtml(prompt.description || '')}" placeholder="Card description (optional)" maxlength="300">
                <input type="url" class="form-input quick-card-image" value="${escapeHtml(prompt.image_url || '')}" placeholder="Image/icon URL (optional)">
                <div class="quick-card-buttons-label">Buttons</div>
                <div class="quick-card-buttons" data-index="${index}">
                    ${buttons.map((b, bi) => `
                        <div class="quick-card-button-row" data-btn-index="${bi}">
                            <input type="text" class="form-input quick-card-btn-label" value="${escapeHtml(b.label || '')}" placeholder="Button label" maxlength="60">
                            <select class="form-select quick-card-btn-action">
                                <option value="send_message" ${b.action === 'send_message' || !b.action ? 'selected' : ''}>Ask AI</option>
                                <option value="open_url" ${b.action === 'open_url' ? 'selected' : ''}>Open URL</option>
                                <option value="talk_to_agent" ${b.action === 'talk_to_agent' ? 'selected' : ''}>Live agent</option>
                            </select>
                            <input type="text" class="form-input quick-card-btn-value" value="${escapeHtml(b.value || '')}" placeholder="Message or URL">
                            <button type="button" class="quick-card-btn-remove" title="Remove button">×</button>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-sm btn-secondary quick-card-add-btn">+ Add button</button>
            </div>
            ` : ''}
        `;

        // Event listeners
        item.querySelector('.quick-prompt-icon-input').addEventListener('change', (e) => {
            quickPromptsState.prompts[index].icon = e.target.value;
        });

        item.querySelector('.quick-prompt-text-input').addEventListener('change', (e) => {
            quickPromptsState.prompts[index].text = e.target.value;
        });

        item.querySelector('.quick-prompt-type-select').addEventListener('change', (e) => {
            quickPromptsState.prompts[index].type = e.target.value;
            if (e.target.value === 'card' && !Array.isArray(quickPromptsState.prompts[index].buttons)) {
                quickPromptsState.prompts[index].buttons = [];
            }
            renderQuickPromptsList();
        });

        item.querySelector('.quick-prompt-enabled').addEventListener('change', (e) => {
            quickPromptsState.prompts[index].enabled = e.target.checked;
        });

        item.querySelector('.quick-prompt-move-up').addEventListener('click', () => {
            moveQuickPrompt(index, -1);
        });

        item.querySelector('.quick-prompt-move-down').addEventListener('click', () => {
            moveQuickPrompt(index, 1);
        });

        item.querySelector('.quick-prompt-delete').addEventListener('click', () => {
            deleteQuickPrompt(index);
        });

        if (isCard) {
            item.querySelector('.quick-card-desc')?.addEventListener('change', (e) => {
                quickPromptsState.prompts[index].description = e.target.value;
            });
            item.querySelector('.quick-card-image')?.addEventListener('change', (e) => {
                quickPromptsState.prompts[index].image_url = e.target.value;
            });
            item.querySelector('.quick-card-add-btn')?.addEventListener('click', () => {
                if (!Array.isArray(quickPromptsState.prompts[index].buttons)) {
                    quickPromptsState.prompts[index].buttons = [];
                }
                quickPromptsState.prompts[index].buttons.push({ label: '', action: 'send_message', value: '' });
                renderQuickPromptsList();
            });
            item.querySelectorAll('.quick-card-button-row').forEach(row => {
                const bi = parseInt(row.dataset.btnIndex);
                row.querySelector('.quick-card-btn-label')?.addEventListener('change', (e) => {
                    quickPromptsState.prompts[index].buttons[bi].label = e.target.value;
                });
                row.querySelector('.quick-card-btn-action')?.addEventListener('change', (e) => {
                    quickPromptsState.prompts[index].buttons[bi].action = e.target.value;
                });
                row.querySelector('.quick-card-btn-value')?.addEventListener('change', (e) => {
                    quickPromptsState.prompts[index].buttons[bi].value = e.target.value;
                });
                row.querySelector('.quick-card-btn-remove')?.addEventListener('click', () => {
                    quickPromptsState.prompts[index].buttons.splice(bi, 1);
                    renderQuickPromptsList();
                });
            });
        }

        listEl.appendChild(item);
    });
}

function addQuickPromptRow(type = 'suggestion') {
    const newPrompt = {
        id: Math.random().toString(36).substring(2, 10),
        type,
        text: '',
        icon: '',
        enabled: true,
        ...(type === 'card' ? { description: '', image_url: '', buttons: [{ label: '', action: 'send_message', value: '' }] } : {})
    };
    
    quickPromptsState.prompts.push(newPrompt);
    renderQuickPromptsList();
    
    // Focus the new prompt's text input
    const items = document.querySelectorAll('.quick-prompt-item');
    const lastItem = items[items.length - 1];
    if (lastItem) {
        lastItem.querySelector('.quick-prompt-text-input').focus();
    }
}

function moveQuickPrompt(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= quickPromptsState.prompts.length) return;
    
    const temp = quickPromptsState.prompts[index];
    quickPromptsState.prompts[index] = quickPromptsState.prompts[newIndex];
    quickPromptsState.prompts[newIndex] = temp;
    
    renderQuickPromptsList();
}

function deleteQuickPrompt(index) {
    quickPromptsState.prompts.splice(index, 1);
    renderQuickPromptsList();
}

async function saveQuickPrompts() {
    if (!currentDetailSite) return;
    
    // Validate prompts - remove empty ones and empty card buttons
    const validPrompts = quickPromptsState.prompts
        .filter(p => p.text && p.text.trim())
        .map(p => {
            if ((p.type || 'suggestion') === 'card') {
                return {
                    ...p,
                    type: 'card',
                    buttons: (Array.isArray(p.buttons) ? p.buttons : []).filter(b => b.label && b.label.trim())
                };
            }
            const { description, image_url, buttons, ...rest } = p;
            return { ...rest, type: 'suggestion' };
        });
    
    const btn = document.getElementById('save-quick-prompts');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/quick-prompts`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                enabled: quickPromptsState.enabled,
                prompts: validPrompts,
                show_after_response: quickPromptsState.showAfterResponse,
                max_display: quickPromptsState.maxDisplay
            })
        });
        
        if (!response.ok) throw new Error('Failed to save quick prompts');
        
        // Update local state with validated prompts
        quickPromptsState.prompts = validPrompts;
        
        // Also update the site config cache
        if (currentSiteConfig) {
            currentSiteConfig.quick_prompts = {
                enabled: quickPromptsState.enabled,
                prompts: validPrompts,
                show_after_response: quickPromptsState.showAfterResponse,
                max_display: quickPromptsState.maxDisplay
            };
        }
        
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Saved!';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
        
        renderQuickPromptsList();
        
    } catch (error) {
        console.error('Failed to save quick prompts:', error);
        btn.innerHTML = 'Error - Try Again';
        btn.disabled = false;
        setTimeout(() => {
            btn.innerHTML = originalText;
        }, 2000);
    }
}

// ==================== Help Center ====================

let helpCenterStatus = null;

function getHelpCenterTabContent() {
    const config = currentSiteConfig || {};
    const hc = config.help_center || {};
    const enabled = hc.enabled === true;
    const portalUrl = hc.portal_url || '';
    const tabLabel = hc.tab_label || 'Help';
    const siteId = currentDetailSite ? currentDetailSite.site_id : '';
    const siteName = currentDetailSite ? (currentDetailSite.name || '') : '';
    const portalName = hc.portal_name || siteName;
    const headerText = hc.header_text || 'Support Portal';
    const portalTitle = hc.portal_title || (siteName ? `${siteName} | Help Center` : 'Help Center');
    const homePageLink = hc.home_page_link || '';
    const slug = hc.slug || '';
    const brandColor = hc.brand_color || '#7B3DFB';
    const logoUrl = hc.logo_url || '';
    const layout = hc.layout || 'documentation';
    const socialLinks = Array.isArray(hc.social_links) ? hc.social_links : [];
    const embedWidget = hc.embed_widget !== false;

    const socialNetworks = ['linkedin', 'twitter', 'facebook', 'github', 'youtube', 'website'];
    const socialRows = socialLinks.map((l, i) => helpCenterSocialRowHtml(l, i, socialNetworks)).join('');
    const locales = Array.isArray(hc.locales) && hc.locales.length ? hc.locales : [hc.default_locale || 'en'];
    const localeRows = locales.map((l, i) => helpCenterLocaleRowHtml(l, i === 0)).join('');

    return `
        <div class="settings-section">
            <div class="quick-prompts-header">
                <div>
                    <h3>Help Center</h3>
                    <p class="quick-prompts-description">A public knowledge-base portal hosted by SwiftChat — also browsable inside the chat widget's Help tab.</p>
                </div>
                <label class="toggle-label">
                    <input type="checkbox" id="help-center-enabled" ${enabled ? 'checked' : ''}>
                    <span class="toggle-switch"></span>
                </label>
            </div>
            <div id="help-center-content" style="${enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">

                <div class="appearance-subsection">
                    <div class="appearance-subsection-title">General</div>
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="hc-logo-url">Logo</label>
                            <div class="avatar-input-row">
                                <input type="url" id="hc-logo-url" class="form-input" value="${escapeHtml(logoUrl)}" placeholder="https://…/logo.png">
                                <span class="avatar-preview" id="hc-logo-preview">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : ''}</span>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="hc-portal-name">Name</label>
                            <input type="text" id="hc-portal-name" class="form-input" value="${escapeHtml(portalName)}" placeholder="Concha AI">
                        </div>
                        <div class="form-group">
                            <label for="hc-header-text">Header text</label>
                            <input type="text" id="hc-header-text" class="form-input" value="${escapeHtml(headerText)}" placeholder="Support Portal">
                            <small class="form-help">Heading shown at the top of the portal home page.</small>
                        </div>
                        <div class="form-group">
                            <label for="hc-portal-title">Page title</label>
                            <input type="text" id="hc-portal-title" class="form-input" value="${escapeHtml(portalTitle)}" placeholder="Concha AI | Help Center">
                            <small class="form-help">Shown in the browser tab.</small>
                        </div>
                        <div class="form-group">
                            <label for="hc-home-page-link">Home page link</label>
                            <input type="url" id="hc-home-page-link" class="form-input" value="${escapeHtml(homePageLink)}" placeholder="https://yourwebsite.com">
                            <small class="form-help">Adds a "Website" link to the portal header.</small>
                        </div>
                        <div class="form-group">
                            <label for="hc-slug">Slug</label>
                            <input type="text" id="hc-slug" class="form-input" value="${escapeHtml(slug)}" placeholder="${escapeHtml(siteId)}" pattern="[a-z0-9-]*">
                            <small class="form-help">Custom public path — <code>${window.location.origin}/hc/<strong id="hc-slug-preview">${escapeHtml(slug || siteId)}</strong></code>. Leave empty to use the site ID.</small>
                        </div>
                        <div class="form-group">
                            <label>Languages</label>
                            <div id="hc-locales">${localeRows}</div>
                            <button type="button" class="btn btn-secondary btn-sm" id="hc-add-locale">+ Add language</button>
                            <small class="form-help">The first language is the portal default. Sync each language's portal URL (e.g. <code>…/en</code>) separately — visitors can switch with the language dropdown in the portal header.</small>
                        </div>
                        <div class="form-group">
                            <label for="hc-brand-color">Brand color</label>
                            <div class="color-input-wrapper">
                                <input type="color" class="color-input" id="hc-brand-color-picker" value="${escapeHtml(brandColor)}">
                                <input type="text" class="form-input color-text-input" id="hc-brand-color" value="${escapeHtml(brandColor)}" placeholder="#7B3DFB" maxlength="7">
                            </div>
                            <small class="form-help">Used for links, buttons and highlights across the portal.</small>
                        </div>
                    </div>
                </div>

                <div class="appearance-subsection">
                    <div class="appearance-subsection-title">Appearance</div>
                    <div class="form-group">
                        <label>Layout</label>
                        <div class="launcher-style-grid hc-layout-grid" id="hc-layout-options">
                            <label class="launcher-style-option ${layout === 'classic' ? 'selected' : ''}">
                                <input type="radio" name="hc-layout" value="classic" ${layout === 'classic' ? 'checked' : ''} hidden>
                                <span class="launcher-style-icon">
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="6" rx="1.5"/><rect x="3" y="12" width="8" height="9" rx="1.5"/><rect x="13" y="12" width="8" height="9" rx="1.5"/></svg>
                                </span>
                                <span class="launcher-style-name">Classic</span>
                            </label>
                            <label class="launcher-style-option ${layout !== 'classic' ? 'selected' : ''}">
                                <input type="radio" name="hc-layout" value="documentation" ${layout !== 'classic' ? 'checked' : ''} hidden>
                                <span class="launcher-style-icon">
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="6" height="18" rx="1.5"/><rect x="12" y="3" width="9" height="6" rx="1.5"/><rect x="12" y="12" width="9" height="9" rx="1.5"/></svg>
                                </span>
                                <span class="launcher-style-name">Documentation <em>(Beta)</em></span>
                            </label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Social links</label>
                        <div id="hc-social-links">${socialRows}</div>
                        <button type="button" class="btn btn-secondary btn-sm" id="hc-add-social">+ Add social link</button>
                        <small class="form-help">Shown in the portal footer.</small>
                    </div>
                </div>

                <div class="appearance-subsection">
                    <div class="appearance-subsection-title">Content</div>
                    <div class="hc-content-toolbar">
                        <button type="button" class="btn btn-secondary btn-sm" id="hc-new-category">+ New category</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="hc-new-article">+ New article</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="hc-refresh-content" title="Reload">↻</button>
                    </div>
                    <div id="hc-content-list" class="hc-content-list">
                        <div class="quick-prompts-loading"><div class="spinner-sm"></div><span>Loading content…</span></div>
                    </div>
                </div>

                <div class="appearance-subsection">
                    <div class="appearance-subsection-title">Custom domain</div>
                    <div class="form-group">
                        <label for="hc-custom-domain">Domain</label>
                        <div class="portal-url-row">
                            <input type="text" id="hc-custom-domain" class="form-input" value="${escapeHtml(hc.custom_domain || '')}" placeholder="help.example.com">
                            <button type="button" class="btn btn-secondary btn-sm" id="hc-verify-domain">Verify</button>
                            <span id="hc-domain-status" class="hc-domain-status"></span>
                        </div>
                        <small class="form-help">
                            Create a <strong>CNAME</strong> record pointing <code id="hc-domain-cname-hint">help.example.com</code> to <code>${escapeHtml(window.location.hostname)}</code>, then click Verify.
                            The help center will be served at the domain root. Save changes before verifying.
                        </small>
                    </div>
                </div>

                <div class="appearance-subsection">
                    <div class="appearance-subsection-title">Integrations</div>
                    <div class="hc-integration-row">
                        <div>
                            <div class="hc-integration-name">Live chat with SwiftChat</div>
                            <div class="hc-integration-desc">Show a live chat widget on your help center.</div>
                        </div>
                        <label class="toggle-label">
                            <input type="checkbox" id="hc-embed-widget" ${embedWidget ? 'checked' : ''}>
                            <span class="toggle-switch"></span>
                        </label>
                    </div>
                </div>

                <div class="appearance-subsection">
                    <div class="appearance-subsection-title">Content &amp; Widget</div>
                    <div class="form-group">
                        <label>Public portal</label>
                        <div class="portal-url-row">
                            <input type="text" class="form-input" id="help-center-public-url" readonly
                                value="${window.location.origin}/hc/${escapeHtml(slug || siteId)}">
                            <button type="button" class="btn btn-secondary btn-sm" id="copy-portal-url">Copy</button>
                            <a class="btn btn-secondary btn-sm" id="open-portal-url" target="_blank" rel="noopener noreferrer">Open</a>
                        </div>
                        <small class="form-help">Your SwiftChat-hosted help portal — share this link or let visitors open it from the widget's Help tab.</small>
                    </div>
                    <div class="form-group">
                        <label for="help-center-portal-url">Source portal URL</label>
                        <input type="url" id="help-center-portal-url" class="form-input" value="${escapeHtml(portalUrl)}"
                            placeholder="https://chat.swiftapps.cloud/hc/concha-ai/en">
                        <small class="form-help">The external Chatwoot-style portal to sync categories and articles from.</small>
                    </div>
                    <div class="form-group">
                        <label for="help-center-tab-label">Widget tab label</label>
                        <input type="text" id="help-center-tab-label" class="form-input" value="${escapeHtml(tabLabel)}" maxlength="20" placeholder="Help">
                    </div>
                    <div class="help-center-status" id="help-center-status">
                        <div class="quick-prompts-loading"><div class="spinner-sm"></div><span>Checking sync status...</span></div>
                    </div>
                </div>

                <div class="help-center-actions">
                    <button type="button" class="btn btn-primary btn-sm" id="save-help-center">Save Changes</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="sync-help-center">Sync Now</button>
                </div>
            </div>
        </div>
    `;
}

const HC_LOCALES = {
    en: 'English', pt: 'Português', 'pt-br': 'Português (Brasil)', es: 'Español',
    fr: 'Français', de: 'Deutsch', it: 'Italiano', nl: 'Nederlands', pl: 'Polski',
    tr: 'Türkçe', ar: 'العربية', ja: '日本語', zh: '中文', 'zh-cn': '中文 (简体)',
    hi: 'हिन्दी', ru: 'Русский', ko: '한국어', sv: 'Svenska', da: 'Dansk'
};

function helpCenterLocaleRowHtml(code, isDefault) {
    const opts = Object.entries(HC_LOCALES).map(([c, name]) =>
        `<option value="${c}" ${code === c ? 'selected' : ''}>${name}</option>`
    ).join('');
    return `
        <div class="hc-social-row hc-locale-row">
            <select class="form-input hc-locale-select">${opts}</select>
            ${isDefault
                ? '<span class="hc-locale-default">Default</span>'
                : '<button type="button" class="btn-icon hc-locale-remove" title="Remove">×</button>'}
        </div>
    `;
}

function helpCenterSocialRowHtml(link, i, networks) {
    const opts = networks.map(n =>
        `<option value="${n}" ${link.network === n ? 'selected' : ''}>${n === 'twitter' ? 'X / Twitter' : n.charAt(0).toUpperCase() + n.slice(1)}</option>`
    ).join('');
    return `
        <div class="hc-social-row" data-index="${i}">
            <select class="form-input hc-social-network">${opts}</select>
            <input type="text" class="form-input hc-social-handle" value="${escapeHtml(link.handle || '')}" placeholder="handle or URL">
            <button type="button" class="btn-icon hc-social-remove" title="Remove">×</button>
        </div>
    `;
}

function initHelpCenterHandlers() {
    document.getElementById('help-center-enabled')?.addEventListener('change', (e) => {
        const content = document.getElementById('help-center-content');
        if (content) {
            content.style.opacity = e.target.checked ? '1' : '0.5';
            content.style.pointerEvents = e.target.checked ? 'auto' : 'none';
        }
    });
    document.getElementById('save-help-center')?.addEventListener('click', saveHelpCenterConfig);
    document.getElementById('sync-help-center')?.addEventListener('click', syncHelpCenter);

    const fallbackSlug = currentDetailSite ? currentDetailSite.site_id : '';
    const publicUrlEl = document.getElementById('help-center-public-url');
    const openBtn = document.getElementById('open-portal-url');
    const slugInput = document.getElementById('hc-slug');
    const slugPreview = document.getElementById('hc-slug-preview');
    const refreshPortalUrl = () => {
        const slug = (slugInput?.value.trim() || fallbackSlug);
        if (publicUrlEl) publicUrlEl.value = `${window.location.origin}/hc/${slug}`;
        if (openBtn) openBtn.href = `${window.location.origin}/hc/${slug}`;
        if (slugPreview) slugPreview.textContent = slug;
    };
    slugInput?.addEventListener('input', refreshPortalUrl);
    refreshPortalUrl();

    const logoInput = document.getElementById('hc-logo-url');
    const logoPreview = document.getElementById('hc-logo-preview');
    logoInput?.addEventListener('input', () => {
        const url = logoInput.value.trim();
        if (logoPreview) logoPreview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : '';
    });

    const colorPicker = document.getElementById('hc-brand-color-picker');
    const colorText = document.getElementById('hc-brand-color');
    colorPicker?.addEventListener('input', () => { if (colorText) colorText.value = colorPicker.value; });
    colorText?.addEventListener('input', () => {
        if (colorPicker && /^#[0-9a-fA-F]{6}$/.test(colorText.value)) colorPicker.value = colorText.value;
    });

    document.getElementById('hc-layout-options')?.addEventListener('change', (e) => {
        if (e.target.name !== 'hc-layout') return;
        document.querySelectorAll('#hc-layout-options .launcher-style-option').forEach(o => o.classList.remove('selected'));
        e.target.closest('.launcher-style-option')?.classList.add('selected');
    });

    const networks = ['linkedin', 'twitter', 'facebook', 'github', 'youtube', 'website'];
    const socialWrap = document.getElementById('hc-social-links');
    document.getElementById('hc-add-social')?.addEventListener('click', () => {
        if (!socialWrap) return;
        const div = document.createElement('div');
        div.innerHTML = helpCenterSocialRowHtml({ network: 'linkedin', handle: '' }, socialWrap.children.length, networks).trim();
        socialWrap.appendChild(div.firstChild);
    });
    socialWrap?.addEventListener('click', (e) => {
        const btn = e.target.closest('.hc-social-remove');
        if (btn) btn.closest('.hc-social-row')?.remove();
    });

    const localeWrap = document.getElementById('hc-locales');
    document.getElementById('hc-add-locale')?.addEventListener('click', () => {
        if (!localeWrap) return;
        const div = document.createElement('div');
        div.innerHTML = helpCenterLocaleRowHtml('pt', false).trim();
        localeWrap.appendChild(div.firstChild);
    });
    localeWrap?.addEventListener('click', (e) => {
        const btn = e.target.closest('.hc-locale-remove');
        if (btn) btn.closest('.hc-locale-row')?.remove();
    });

    document.getElementById('hc-new-category')?.addEventListener('click', () => hcOpenCategoryModal());
    document.getElementById('hc-new-article')?.addEventListener('click', () => hcOpenArticleModal());
    document.getElementById('hc-refresh-content')?.addEventListener('click', loadHelpCenterContent);
    document.getElementById('hc-verify-domain')?.addEventListener('click', hcVerifyDomain);
    document.getElementById('hc-custom-domain')?.addEventListener('input', e => {
        const hint = document.getElementById('hc-domain-cname-hint');
        if (hint) hint.textContent = e.target.value.trim() || 'help.example.com';
    });

    document.getElementById('hc-content-list')?.addEventListener('click', e => {
        const row = e.target.closest('.hc-manage-row');
        if (!row) return;
        const catSlug = row.dataset.catSlug, catLocale = row.dataset.catLocale;
        const artSlug = row.dataset.artSlug, artLocale = row.dataset.artLocale;
        if (e.target.closest('.hc-edit-cat')) {
            const cat = (hcContent.categories || []).find(c => c.slug === catSlug && (c.locale || 'en') === catLocale);
            if (cat) hcOpenCategoryModal(cat);
        } else if (e.target.closest('.hc-del-cat')) {
            const cat = (hcContent.categories || []).find(c => c.slug === catSlug && (c.locale || 'en') === catLocale);
            if (cat && confirm(`Delete category "${cat.name}"? Its articles become uncategorised.`)) {
                fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/categories/${encodeURIComponent(catSlug)}?locale=${encodeURIComponent(catLocale)}`, {
                    method: 'DELETE', headers: getAuthHeaders()
                }).then(() => { loadHelpCenterContent(); loadHelpCenterStatus(); });
            }
        } else if (e.target.closest('.hc-edit-art')) {
            const art = (hcContent.articles || []).find(a => a.slug === artSlug && (a.locale || 'en') === artLocale);
            if (art) hcOpenArticleModal(art);
        } else if (e.target.closest('.hc-del-art')) {
            const art = (hcContent.articles || []).find(a => a.slug === artSlug && (a.locale || 'en') === artLocale);
            if (art && confirm(`Delete article "${art.title}"?`)) {
                fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/articles/${encodeURIComponent(artSlug)}?locale=${encodeURIComponent(artLocale)}`, {
                    method: 'DELETE', headers: getAuthHeaders()
                }).then(() => { loadHelpCenterContent(); loadHelpCenterStatus(); });
            }
        }
    });

    document.getElementById('copy-portal-url')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(publicUrlEl.value);
            const btn = document.getElementById('copy-portal-url');
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        } catch (e) {
            publicUrlEl.select();
            document.execCommand('copy');
        }
    });
}

async function loadHelpCenterStatus() {
    const statusEl = document.getElementById('help-center-status');
    if (!statusEl || !currentDetailSite) return;
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/status`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('status fetch failed');
        helpCenterStatus = await response.json();
        const s = helpCenterStatus.last_sync_stats;
        statusEl.innerHTML = `
            <div class="help-center-stats">
                <span><strong>${helpCenterStatus.categories}</strong> categories</span>
                <span><strong>${helpCenterStatus.articles}</strong> articles</span>
                ${helpCenterStatus.last_synced_at ? `<span>Last synced: ${new Date(helpCenterStatus.last_synced_at).toLocaleString()}</span>` : '<span>Never synced</span>'}
                ${s && s.errors ? `<span class="help-center-errors">${s.errors} errors</span>` : ''}
            </div>
        `;
    } catch (e) {
        statusEl.innerHTML = '<div class="help-center-stats"><span>Status unavailable</span></div>';
    }
}

async function saveHelpCenterConfig() {
    if (!currentDetailSite) return;
    const btn = document.getElementById('save-help-center');
    const original = btn.innerHTML;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    const helpCenter = {
        enabled: document.getElementById('help-center-enabled')?.checked === true,
        portal_url: document.getElementById('help-center-portal-url')?.value.trim() || null,
        tab_label: document.getElementById('help-center-tab-label')?.value.trim() || 'Help',
        portal_name: document.getElementById('hc-portal-name')?.value.trim() || null,
        header_text: document.getElementById('hc-header-text')?.value.trim() || null,
        portal_title: document.getElementById('hc-portal-title')?.value.trim() || null,
        home_page_link: document.getElementById('hc-home-page-link')?.value.trim() || null,
        slug: document.getElementById('hc-slug')?.value.trim().toLowerCase() || null,
        brand_color: document.getElementById('hc-brand-color')?.value.trim() || null,
        logo_url: document.getElementById('hc-logo-url')?.value.trim() || null,
        layout: document.querySelector('input[name="hc-layout"]:checked')?.value || 'documentation',
        social_links: [...document.querySelectorAll('#hc-social-links .hc-social-row')].map(row => ({
            network: row.querySelector('.hc-social-network')?.value || 'website',
            handle: row.querySelector('.hc-social-handle')?.value.trim() || ''
        })).filter(l => l.handle),
        embed_widget: document.getElementById('hc-embed-widget')?.checked !== false,
        custom_domain: document.getElementById('hc-custom-domain')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null
    };
    const locales = [...document.querySelectorAll('#hc-locales .hc-locale-select')]
        .map(s => s.value).filter((v, i, arr) => arr.indexOf(v) === i);
    helpCenter.locales = locales.length ? locales : ['en'];
    helpCenter.default_locale = helpCenter.locales[0];
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ help_center: helpCenter })
        });
        if (!response.ok) throw new Error('Failed to save');
        currentSiteConfig = await response.json();
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1500);
    } catch (e) {
        console.error('Failed to save help center config:', e);
        btn.textContent = 'Error - Try Again';
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = original; }, 2000);
    }
}

async function syncHelpCenter() {
    if (!currentDetailSite) return;
    // Save config first so the sync uses the latest portal URL
    await saveHelpCenterConfig();
    const btn = document.getElementById('sync-help-center');
    const original = btn.innerHTML;
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/sync`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Sync failed');
        }
        btn.textContent = 'Sync started';
        // Poll status until counts change or timeout
        const start = Date.now();
        const poll = setInterval(async () => {
            await loadHelpCenterStatus();
            if (Date.now() - start > 120000) {
                clearInterval(poll);
                btn.innerHTML = original;
                btn.disabled = false;
            }
        }, 4000);
        setTimeout(() => { clearInterval(poll); btn.innerHTML = original; btn.disabled = false; }, 120000);
    } catch (e) {
        console.error('Help center sync failed:', e);
        btn.textContent = 'Sync failed';
        setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 3000);
    }
}

// ==================== Help Center content management ====================

let hcContent = { categories: [], articles: [] };

function hcLocalesList() {
    const sel = [...document.querySelectorAll('#hc-locales .hc-locale-select')].map(s => s.value);
    if (sel.length) return sel;
    return (currentSiteConfig?.help_center?.locales) || ['en'];
}

async function loadHelpCenterContent() {
    const listEl = document.getElementById('hc-content-list');
    if (!listEl || !currentDetailSite) return;
    try {
        const res = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/manage`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('load failed');
        hcContent = await res.json();
    } catch (e) {
        hcContent = { categories: [], articles: [] };
    }
    renderHcContentList();
}

function hcIconHtml(cat, size = 18) {
    if (cat.icon_url) return `<img src="${escapeHtml(cat.icon_url)}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:4px">`;
    if (cat.icon) return `<span style="font-size:${size - 2}px;line-height:1">${escapeHtml(cat.icon)}</span>`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`;
}

function renderHcContentList() {
    const listEl = document.getElementById('hc-content-list');
    if (!listEl) return;
    const cats = hcContent.categories || [];
    const arts = hcContent.articles || [];
    const catName = (slug, locale) => (cats.find(c => c.slug === slug && (!locale || c.locale === locale)) || cats.find(c => c.slug === slug) || {}).name || slug || '—';

    listEl.innerHTML = `
        <div class="hc-manage-group">
            <div class="hc-manage-head">Categories <span class="hc-manage-count">${cats.length}</span></div>
            ${cats.length ? cats.map(c => `
                <div class="hc-manage-row" data-cat-slug="${escapeHtml(c.slug)}" data-cat-locale="${escapeHtml(c.locale || 'en')}">
                    <span class="hc-manage-icon">${hcIconHtml(c)}</span>
                    <span class="hc-manage-title">${escapeHtml(c.name)} <em class="hc-manage-meta">${escapeHtml(c.locale || 'en')} · ${c.article_count || 0} articles</em></span>
                    <button type="button" class="btn-icon hc-edit-cat" title="Edit category">✎</button>
                    <button type="button" class="btn-icon hc-del-cat" title="Delete category">×</button>
                </div>`).join('') : '<div class="hc-manage-empty">No categories yet — sync a portal or create one.</div>'}
        </div>
        <div class="hc-manage-group">
            <div class="hc-manage-head">Articles <span class="hc-manage-count">${arts.length}</span></div>
            ${arts.length ? arts.map(a => `
                <div class="hc-manage-row" data-art-slug="${escapeHtml(a.slug)}" data-art-locale="${escapeHtml(a.locale || 'en')}">
                    <span class="hc-manage-title">${escapeHtml(a.title)} <em class="hc-manage-meta">${escapeHtml(a.locale || 'en')} · ${escapeHtml(catName(a.category_slug, a.locale))}</em></span>
                    <button type="button" class="btn-icon hc-edit-art" title="Edit article">✎</button>
                    <button type="button" class="btn-icon hc-del-art" title="Delete article">×</button>
                </div>`).join('') : '<div class="hc-manage-empty">No articles yet — sync a portal or create one.</div>'}
        </div>
    `;
}

function hcShowModal(title, bodyHtml) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop active';
    wrap.innerHTML = `
        <div class="modal modal-lg">
            <div class="modal-header">
                <h2>${escapeHtml(title)}</h2>
                <button class="modal-close" type="button" aria-label="Close">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="qa-modal-content">${bodyHtml}</div>
        </div>`;
    const close = () => wrap.remove();
    wrap.querySelector('.modal-close').addEventListener('click', close);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    return { el: wrap, close };
}

function hcLocaleOptions(selected) {
    return hcLocalesList().map(l =>
        `<option value="${escapeHtml(l)}" ${l === selected ? 'selected' : ''}>${escapeHtml(HC_LOCALES[l] || l)}</option>`
    ).join('');
}

function hcOpenCategoryModal(cat = null) {
    const editing = !!cat;
    const { el, close } = hcShowModal(editing ? 'Edit Category' : 'New Category', `
        <form id="hc-cat-form">
            <div class="qa-form-group">
                <label>Name</label>
                <input type="text" id="hc-cat-name" class="form-input" required maxlength="120" value="${escapeHtml(cat?.name || '')}" placeholder="Getting started">
            </div>
            <div class="qa-form-group">
                <label>Language</label>
                <select id="hc-cat-locale" class="form-input" ${editing ? 'disabled' : ''}>${hcLocaleOptions(cat?.locale || hcLocalesList()[0])}</select>
            </div>
            <div class="qa-form-group">
                <label>Icon</label>
                <div class="avatar-input-row">
                    <input type="text" id="hc-cat-icon" class="form-input" maxlength="8" value="${escapeHtml(cat?.icon || '')}" placeholder="Emoji e.g. 🚀 — or upload an image" style="max-width:200px">
                    <label class="btn btn-secondary btn-sm" style="cursor:pointer">Upload<input type="file" id="hc-cat-icon-file" accept="image/*" hidden></label>
                    <span class="avatar-preview" id="hc-cat-icon-preview">${cat?.icon_url ? `<img src="${escapeHtml(cat.icon_url)}" alt="">` : (cat?.icon ? `<span style="font-size:18px">${escapeHtml(cat.icon)}</span>` : '')}</span>
                    <input type="hidden" id="hc-cat-icon-url" value="${escapeHtml(cat?.icon_url || '')}">
                </div>
            </div>
            <div class="qa-form-group">
                <label>Description</label>
                <textarea id="hc-cat-desc" class="form-input" rows="2" maxlength="300" placeholder="Optional short description">${escapeHtml(cat?.description || '')}</textarea>
            </div>
            ${editing ? `<div class="qa-form-group"><small class="form-help">Slug: <code>${escapeHtml(cat.slug)}</code></small></div>` : ''}
            <div class="qa-modal-actions">
                <button type="button" class="btn btn-secondary" id="hc-cat-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">${editing ? 'Save Category' : 'Create Category'}</button>
            </div>
        </form>`);

    el.querySelector('#hc-cat-cancel').addEventListener('click', close);
    const iconInput = el.querySelector('#hc-cat-icon');
    const preview = el.querySelector('#hc-cat-icon-preview');
    const urlInput = el.querySelector('#hc-cat-icon-url');
    iconInput.addEventListener('input', () => {
        preview.innerHTML = iconInput.value.trim() ? `<span style="font-size:18px">${escapeHtml(iconInput.value.trim())}</span>` : '';
    });
    el.querySelector('#hc-cat-icon-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            urlInput.value = reader.result;
            iconInput.value = '';
            preview.innerHTML = `<img src="${reader.result}" alt="">`;
        };
        reader.readAsDataURL(file);
    });
    el.querySelector('#hc-cat-form').addEventListener('submit', async e => {
        e.preventDefault();
        const body = {
            name: el.querySelector('#hc-cat-name').value.trim(),
            locale: el.querySelector('#hc-cat-locale').value,
            icon: iconInput.value.trim(),
            icon_url: urlInput.value || null,
            description: el.querySelector('#hc-cat-desc').value.trim() || null,
        };
        if (!body.name) return;
        const base = `${API_BASE}/sites/${currentDetailSite.site_id}/help/categories`;
        const url = editing ? `${base}/${encodeURIComponent(cat.slug)}?locale=${encodeURIComponent(cat.locale || 'en')}` : base;
        const res = await fetch(url, {
            method: editing ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) { alert('Failed to save category'); return; }
        close();
        loadHelpCenterContent();
        loadHelpCenterStatus();
    });
}

function hcOpenArticleModal(art = null) {
    const editing = !!art;
    const cats = hcContent.categories || [];
    const artLocale = art?.locale || hcLocalesList()[0];
    const catOptions = locale =>
        '<option value="">— No category —</option>' +
        cats.filter(c => !c.locale || c.locale === locale).map(c =>
            `<option value="${escapeHtml(c.slug)}" ${c.slug === art?.category_slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
        ).join('');

    const { el, close } = hcShowModal(editing ? 'Edit Article' : 'New Article', `
        <form id="hc-art-form">
            <div class="qa-form-group">
                <label>Title</label>
                <input type="text" id="hc-art-title" class="form-input" required maxlength="200" value="${escapeHtml(art?.title || '')}" placeholder="How to reset your password">
            </div>
            <div class="hc-art-row">
                <div class="qa-form-group">
                    <label>Category</label>
                    <select id="hc-art-category" class="form-input">${catOptions(artLocale)}</select>
                </div>
                <div class="qa-form-group">
                    <label>Language</label>
                    <select id="hc-art-locale" class="form-input" ${editing ? 'disabled' : ''}>${hcLocaleOptions(artLocale)}</select>
                </div>
            </div>
            <div class="qa-form-group">
                <label>Content <span style="font-weight:400;color:var(--text-muted)">(HTML allowed)</span></label>
                <textarea id="hc-art-body" class="form-input" rows="12" style="font-family:ui-monospace,monospace;font-size:13px" placeholder="<h2>Overview</h2><p>Write your article here…</p>">${escapeHtml(art?.content_html || '')}</textarea>
            </div>
            ${editing ? `<div class="qa-form-group"><small class="form-help">Slug: <code>${escapeHtml(art.slug)}</code></small></div>` : ''}
            <div class="qa-modal-actions">
                <button type="button" class="btn btn-secondary" id="hc-art-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">${editing ? 'Save Article' : 'Create Article'}</button>
            </div>
        </form>`);

    el.querySelector('#hc-art-cancel').addEventListener('click', close);
    el.querySelector('#hc-art-locale').addEventListener('change', e => {
        el.querySelector('#hc-art-category').innerHTML = catOptions(e.target.value);
    });
    el.querySelector('#hc-art-form').addEventListener('submit', async e => {
        e.preventDefault();
        const body = {
            title: el.querySelector('#hc-art-title').value.trim(),
            category_slug: el.querySelector('#hc-art-category').value || '',
            locale: el.querySelector('#hc-art-locale').value,
            content_html: el.querySelector('#hc-art-body').value,
        };
        if (!body.title) return;
        const base = `${API_BASE}/sites/${currentDetailSite.site_id}/help/articles`;
        const url = editing ? `${base}/${encodeURIComponent(art.slug)}?locale=${encodeURIComponent(art.locale || 'en')}` : base;
        const res = await fetch(url, {
            method: editing ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) { alert('Failed to save article'); return; }
        close();
        loadHelpCenterContent();
        loadHelpCenterStatus();
    });
}

async function loadHcDomainStatus() {
    const statusEl = document.getElementById('hc-domain-status');
    if (!statusEl || !currentDetailSite) return;
    try {
        const res = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/domain/status`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) return;
        const d = await res.json();
        renderHcDomainStatus(d);
    } catch (e) { /* optional */ }
}

function renderHcDomainStatus(d) {
    const statusEl = document.getElementById('hc-domain-status');
    if (!statusEl) return;
    if (!d.custom_domain) {
        statusEl.textContent = '';
        return;
    }
    statusEl.textContent = d.verified ? '✓ Verified' : 'DNS not verified';
    statusEl.className = 'hc-domain-status ' + (d.verified ? 'verified' : 'unverified');
}

async function hcVerifyDomain() {
    const btn = document.getElementById('hc-verify-domain');
    const statusEl = document.getElementById('hc-domain-status');
    if (!btn || !currentDetailSite) return;
    btn.textContent = 'Checking…';
    btn.disabled = true;
    try {
        // Save first so the domain being verified is the stored one
        await saveHelpCenterConfig();
        const res = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/help/domain/verify`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail || 'Verify failed');
        renderHcDomainStatus({ custom_domain: d.domain, verified: d.verified });
        if (!d.verified && statusEl) {
            const cn = (d.records?.cname || []).join(', ') || 'none';
            const a = (d.records?.a || []).join(', ') || 'none';
            statusEl.textContent = `DNS not verified — CNAME: ${cn}, A: ${a} (expected ${d.expected || 'this server'})`;
        }
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = `Verify failed: ${e.message}`;
            statusEl.className = 'hc-domain-status unverified';
        }
    }
    btn.textContent = 'Verify';
    btn.disabled = false;
}

// ==================== Push Notifications (OneSignal) ====================

let notificationsConfig = null;
let oneSignalReady = null;

function getNotificationsTabContent() {
    return `
        <div class="settings-section">
            <div class="quick-prompts-header">
                <div>
                    <h3>Push Notifications</h3>
                    <p class="quick-prompts-description">Get notified via OneSignal when visitors message you, request a live agent, or leave their details. Account-level keys fall back to server env vars.</p>
                </div>
                <label class="toggle-label">
                    <input type="checkbox" id="notifications-enabled">
                    <span class="toggle-switch"></span>
                </label>
            </div>
            <div id="notifications-content">
                <div class="form-group">
                    <label for="notifications-app-id">OneSignal App ID</label>
                    <input type="text" id="notifications-app-id" class="form-input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off">
                </div>
                <div class="form-group">
                    <label for="notifications-rest-key">OneSignal REST API Key <span class="form-help-inline">(stored server-side, never shown)</span></label>
                    <input type="password" id="notifications-rest-key" class="form-input" placeholder="Leave blank to keep existing key" autocomplete="new-password">
                </div>
                <div class="form-group form-checkbox">
                    <input type="checkbox" id="notifications-new-message" checked>
                    <label for="notifications-new-message">New visitor message</label>
                </div>
                <div class="form-group form-checkbox">
                    <input type="checkbox" id="notifications-new-lead" checked>
                    <label for="notifications-new-lead">New lead captured</label>
                </div>
                <div class="form-group form-checkbox">
                    <input type="checkbox" id="notifications-handoff" checked>
                    <label for="notifications-handoff">Live agent requested</label>
                </div>
                <div class="help-center-actions">
                    <button type="button" class="btn btn-primary btn-sm" id="save-notifications">Save Changes</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="subscribe-notifications">Subscribe this browser</button>
                </div>
                <div class="help-center-stats" id="notifications-status" style="margin-top:12px;">
                    <span>Checking OneSignal subscription…</span>
                </div>
            </div>
        </div>
    `;
}

function initNotificationsHandlers() {
    document.getElementById('save-notifications')?.addEventListener('click', saveNotificationsConfig);
    document.getElementById('subscribe-notifications')?.addEventListener('click', subscribeBrowserPush);
}

async function loadNotificationsConfig() {
    if (!currentDetailSite) return;
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/notifications`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to load');
        notificationsConfig = await response.json();
        document.getElementById('notifications-enabled').checked = notificationsConfig.enabled === true;
        document.getElementById('notifications-app-id').value = notificationsConfig.onesignal_app_id || '';
        document.getElementById('notifications-rest-key').value = '';
        document.getElementById('notifications-rest-key').placeholder =
            notificationsConfig.has_api_key ? 'Key saved (•••• shown)' : 'No key saved — uses env default';
        document.getElementById('notifications-new-message').checked = notificationsConfig.notify_new_message !== false;
        document.getElementById('notifications-new-lead').checked = notificationsConfig.notify_new_lead !== false;
        document.getElementById('notifications-handoff').checked = notificationsConfig.notify_handoff !== false;
    } catch (e) {
        console.error('Failed to load notification config:', e);
    }
    updateNotificationStatus();
}

function updateNotificationStatus() {
    const el = document.getElementById('notifications-status');
    if (!el) return;
    const hasAppId = notificationsConfig?.onesignal_app_id;
    el.innerHTML = `<span>${hasAppId
        ? 'App ID configured — click "Subscribe this browser" to receive pushes here.'
        : 'No App ID configured — set one above or via ONESIGNAL_APP_ID env var.'}</span>`;
}

async function saveNotificationsConfig() {
    if (!currentDetailSite) return;
    const btn = document.getElementById('save-notifications');
    const original = btn.innerHTML;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    const body = {
        enabled: document.getElementById('notifications-enabled')?.checked === true,
        onesignal_app_id: document.getElementById('notifications-app-id')?.value.trim() || null,
        onesignal_rest_api_key: document.getElementById('notifications-rest-key')?.value.trim() || null,
        notify_new_message: document.getElementById('notifications-new-message')?.checked !== false,
        notify_new_lead: document.getElementById('notifications-new-lead')?.checked !== false,
        notify_handoff: document.getElementById('notifications-handoff')?.checked !== false
    };
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/notifications`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('Failed to save');
        notificationsConfig = await response.json();
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1500);
    } catch (e) {
        console.error('Failed to save notifications config:', e);
        btn.textContent = 'Error - Try Again';
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = original; }, 2000);
    }
    updateNotificationStatus();
}

function loadOneSignalSDK() {
    if (oneSignalReady) return oneSignalReady;
    oneSignalReady = new Promise((resolve, reject) => {
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        window.OneSignalDeferred.push((OneSignal) => resolve(OneSignal));
        const script = document.createElement('script');
        script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
        script.defer = true;
        script.onerror = () => reject(new Error('OneSignal SDK failed to load'));
        document.head.appendChild(script);
    });
    return oneSignalReady;
}

async function subscribeBrowserPush() {
    const appId = document.getElementById('notifications-app-id')?.value.trim()
        || notificationsConfig?.onesignal_app_id;
    const statusEl = document.getElementById('notifications-status');
    if (!appId) {
        statusEl.innerHTML = '<span>Enter a OneSignal App ID first.</span>';
        return;
    }
    statusEl.innerHTML = '<span>Loading OneSignal SDK…</span>';
    try {
        const OneSignal = await loadOneSignalSDK();
        await OneSignal.init({ appId });
        // Tag this subscription with the site id so pushes can be scoped per channel
        try { await OneSignal.User.addTag('site_id', currentDetailSite.site_id); } catch (_) {}
        await OneSignal.Slidedown.promptPush();
        statusEl.innerHTML = '<span>Browser subscribed to push notifications.</span>';
    } catch (e) {
        console.error('OneSignal subscribe failed:', e);
        statusEl.innerHTML = '<span>Subscription failed — check the App ID and that this site is served over HTTPS.</span>';
    }
}

// ==================== Proactive Chat Triggers ====================

let triggersState = {
    triggers: [],
    globalCooldownMs: 30000,
    editingTriggerId: null,
    conditionIndex: 0
};

function setupTriggersEventListeners() {
    // Add trigger buttons
    document.getElementById('add-trigger-btn')?.addEventListener('click', () => openTriggerModal());
    document.getElementById('add-trigger-empty-btn')?.addEventListener('click', () => openTriggerModal());
    
    // Create default triggers
    document.getElementById('create-default-triggers')?.addEventListener('click', createDefaultTriggers);
    
    // Trigger modal
    document.getElementById('close-trigger-modal')?.addEventListener('click', closeTriggerModal);
    document.getElementById('cancel-trigger')?.addEventListener('click', closeTriggerModal);
    document.getElementById('trigger-form')?.addEventListener('submit', saveTrigger);
    
    // Add condition
    document.getElementById('add-condition-btn')?.addEventListener('click', addConditionRow);
    
    // Global cooldown
    document.getElementById('global-cooldown')?.addEventListener('change', async (e) => {
        if (!currentDetailSite) return;
        try {
            await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers/cooldown?cooldown_ms=${e.target.value}`, {
                method: 'PUT',
                headers: getAuthHeaders()
            });
        } catch (error) {
            console.error('Failed to update cooldown:', error);
        }
    });
}

async function loadTriggers() {
    if (!currentDetailSite) return;
    
    const listEl = document.getElementById('triggers-list');
    const emptyEl = document.getElementById('triggers-empty');
    
    listEl.innerHTML = `
        <div class="triggers-loading">
            <div class="spinner-sm"></div>
            <span>Loading triggers...</span>
        </div>
    `;
    emptyEl.classList.add('hidden');
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load triggers');
        
        const data = await response.json();
        triggersState.triggers = data.triggers || [];
        triggersState.globalCooldownMs = data.global_cooldown_ms || 30000;
        
        renderTriggersList();
        
        // Set cooldown select
        const cooldownSelect = document.getElementById('global-cooldown');
        if (cooldownSelect) {
            cooldownSelect.value = triggersState.globalCooldownMs;
        }
        
    } catch (error) {
        console.error('Failed to load triggers:', error);
        listEl.innerHTML = '<div class="triggers-loading">Error loading triggers</div>';
    }
}

function renderTriggersList() {
    const listEl = document.getElementById('triggers-list');
    const emptyEl = document.getElementById('triggers-empty');
    
    if (triggersState.triggers.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    
    emptyEl.classList.add('hidden');
    listEl.innerHTML = '';
    
    triggersState.triggers.forEach(trigger => {
        const summary = summarizeTriggerConditions(trigger.conditions);
        
        const item = document.createElement('div');
        item.className = `trigger-item ${trigger.enabled ? '' : 'disabled'}`;
        item.dataset.triggerId = trigger.id;
        
        item.innerHTML = `
            <div class="trigger-toggle ${trigger.enabled ? 'active' : ''}" data-trigger-id="${trigger.id}"></div>
            <div class="trigger-info">
                <div class="trigger-name">${escapeHtml(trigger.name)}</div>
                <div class="trigger-summary">${escapeHtml(summary)}</div>
            </div>
            <div class="trigger-actions">
                <button class="trigger-action-btn edit" data-trigger-id="${trigger.id}" title="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="trigger-action-btn delete" data-trigger-id="${trigger.id}" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
            </div>
        `;
        
        // Toggle click
        item.querySelector('.trigger-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTriggerEnabled(trigger.id, !trigger.enabled);
        });
        
        // Edit click
        item.querySelector('.edit').addEventListener('click', (e) => {
            e.stopPropagation();
            openTriggerModal(trigger);
        });
        
        // Delete click
        item.querySelector('.delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTrigger(trigger.id);
        });
        
        listEl.appendChild(item);
    });
}

function summarizeTriggerConditions(conditions) {
    if (!conditions || conditions.length === 0) return 'No conditions';
    
    const summaries = conditions.map(c => {
        switch (c.type) {
            case 'time': return `${c.value}s on page`;
            case 'scroll': return `${c.value}% scroll`;
            case 'exit_intent': return 'Exit intent';
            case 'url': return `URL: ${c.value}`;
            case 'visit_count': return `${c.value} visits`;
            default: return c.type;
        }
    });
    
    return summaries.join(' + ');
}

function openTriggerModal(trigger = null) {
    triggersState.editingTriggerId = trigger?.id || null;
    triggersState.conditionIndex = 0;
    
    const modal = document.getElementById('trigger-editor-modal');
    const title = document.getElementById('trigger-modal-title');
    const form = document.getElementById('trigger-form');
    
    title.textContent = trigger ? 'Edit Trigger' : 'Create Trigger';
    form.reset();
    
    // Clear conditions
    document.getElementById('conditions-list').innerHTML = '';
    
    if (trigger) {
        document.getElementById('trigger-id').value = trigger.id;
        document.getElementById('trigger-name').value = trigger.name || '';
        document.getElementById('trigger-message').value = trigger.message || '';
        document.getElementById('trigger-delay').value = trigger.delay_after_trigger_ms || 0;
        document.getElementById('trigger-priority').value = trigger.priority || 0;
        document.getElementById('trigger-once-session').checked = trigger.show_once_per_session !== false;
        document.getElementById('trigger-once-visitor').checked = trigger.show_once_per_visitor === true;
        document.getElementById('trigger-enabled').checked = trigger.enabled !== false;
        
        // Add condition rows
        if (trigger.conditions) {
            trigger.conditions.forEach(c => addConditionRow(c));
        }
    } else {
        document.getElementById('trigger-enabled').checked = true;
        document.getElementById('trigger-once-session').checked = true;
        addConditionRow();
    }
    
    modal.classList.add('active');
}

function closeTriggerModal() {
    document.getElementById('trigger-editor-modal').classList.remove('active');
    triggersState.editingTriggerId = null;
}

function addConditionRow(existingCondition = null) {
    const template = document.getElementById('condition-template');
    const list = document.getElementById('conditions-list');
    
    const clone = template.content.cloneNode(true);
    const row = clone.querySelector('.condition-row');
    row.dataset.index = triggersState.conditionIndex++;
    
    if (existingCondition) {
        row.querySelector('.condition-type').value = existingCondition.type || 'time';
        row.querySelector('.condition-operator').value = existingCondition.operator || 'gte';
        row.querySelector('.condition-value').value = existingCondition.value || '';
    }
    
    // Update unit label based on type
    const typeSelect = row.querySelector('.condition-type');
    const unitLabel = row.querySelector('.condition-unit');
    const operatorSelect = row.querySelector('.condition-operator');
    
    updateConditionUI(typeSelect.value, unitLabel, operatorSelect);
    
    typeSelect.addEventListener('change', () => {
        updateConditionUI(typeSelect.value, unitLabel, operatorSelect);
    });
    
    // Remove button
    row.querySelector('.remove-condition').addEventListener('click', () => {
        row.remove();
    });
    
    list.appendChild(row);
}

function updateConditionUI(type, unitLabel, operatorSelect) {
    const numericOperators = ['gte', 'lte', 'eq', 'gt', 'lt'];
    const stringOperators = ['contains', 'matches', 'eq'];
    
    switch (type) {
        case 'time':
            unitLabel.textContent = 'seconds';
            setOperatorOptions(operatorSelect, numericOperators);
            break;
        case 'scroll':
            unitLabel.textContent = '%';
            setOperatorOptions(operatorSelect, numericOperators);
            break;
        case 'exit_intent':
            unitLabel.textContent = '';
            operatorSelect.style.display = 'none';
            break;
        case 'url':
            unitLabel.textContent = '';
            operatorSelect.style.display = 'block';
            setOperatorOptions(operatorSelect, stringOperators);
            break;
        case 'visit_count':
            unitLabel.textContent = 'visits';
            setOperatorOptions(operatorSelect, numericOperators);
            break;
        default:
            unitLabel.textContent = '';
            operatorSelect.style.display = 'block';
    }
}

function setOperatorOptions(select, operators) {
    const allOptions = {
        'gte': '≥ (greater or equal)',
        'lte': '≤ (less or equal)',
        'eq': '= (equals)',
        'gt': '> (greater)',
        'lt': '< (less)',
        'contains': 'contains',
        'matches': 'matches pattern'
    };
    
    const currentValue = select.value;
    select.innerHTML = '';
    
    operators.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        option.textContent = allOptions[op];
        select.appendChild(option);
    });
    
    if (operators.includes(currentValue)) {
        select.value = currentValue;
    }
}

function getConditionsFromForm() {
    const conditions = [];
    const rows = document.querySelectorAll('#conditions-list .condition-row');
    
    rows.forEach(row => {
        const type = row.querySelector('.condition-type').value;
        const operator = row.querySelector('.condition-operator').value;
        let value = row.querySelector('.condition-value').value;
        
        if (type === 'exit_intent') {
            value = true;
        } else if (['time', 'scroll', 'visit_count'].includes(type)) {
            value = parseInt(value) || 0;
        }
        
        conditions.push({ type, operator, value });
    });
    
    return conditions;
}

async function saveTrigger(e) {
    e.preventDefault();
    
    if (!currentDetailSite) return;
    
    const saveBtn = document.getElementById('save-trigger');
    const btnLabel = saveBtn.querySelector('.btn-label');
    const btnSpinner = saveBtn.querySelector('.btn-spinner');
    
    btnLabel.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    saveBtn.disabled = true;
    
    const conditions = getConditionsFromForm();
    
    if (conditions.length === 0) {
        alert('Please add at least one condition');
        btnLabel.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
        saveBtn.disabled = false;
        return;
    }
    
    const triggerData = {
        name: document.getElementById('trigger-name').value,
        enabled: document.getElementById('trigger-enabled').checked,
        priority: parseInt(document.getElementById('trigger-priority').value) || 0,
        conditions: conditions,
        message: document.getElementById('trigger-message').value,
        delay_after_trigger_ms: parseInt(document.getElementById('trigger-delay').value) || 0,
        show_once_per_session: document.getElementById('trigger-once-session').checked,
        show_once_per_visitor: document.getElementById('trigger-once-visitor').checked
    };
    
    try {
        let response;
        
        if (triggersState.editingTriggerId) {
            response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers/${triggersState.editingTriggerId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(triggerData)
            });
        } else {
            response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(triggerData)
            });
        }
        
        if (!response.ok) throw new Error('Failed to save trigger');
        
        closeTriggerModal();
        await loadTriggers();
        
    } catch (error) {
        console.error('Failed to save trigger:', error);
        alert('Failed to save trigger. Please try again.');
    } finally {
        btnLabel.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
        saveBtn.disabled = false;
    }
}

async function toggleTriggerEnabled(triggerId, enabled) {
    if (!currentDetailSite) return;
    
    try {
        await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers/${triggerId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ enabled })
        });
        
        // Update local state
        const trigger = triggersState.triggers.find(t => t.id === triggerId);
        if (trigger) {
            trigger.enabled = enabled;
        }
        
        renderTriggersList();
        
    } catch (error) {
        console.error('Failed to toggle trigger:', error);
    }
}

async function deleteTrigger(triggerId) {
    if (!currentDetailSite) return;
    
    if (!confirm('Are you sure you want to delete this trigger?')) return;
    
    try {
        await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers/${triggerId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        await loadTriggers();
        
    } catch (error) {
        console.error('Failed to delete trigger:', error);
        alert('Failed to delete trigger. Please try again.');
    }
}

async function createDefaultTriggers() {
    if (!currentDetailSite) return;
    
    const btn = document.getElementById('create-default-triggers');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Creating...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/triggers/defaults`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to create default triggers');
        
        await loadTriggers();
        
    } catch (error) {
        console.error('Failed to create default triggers:', error);
        alert('Failed to create default triggers. Please try again.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function loadTriggerAnalytics() {
    if (!currentDetailSite) return;
    
    try {
        const response = await fetch(`${API_BASE}/analytics/triggers/${currentDetailSite.site_id}?period_days=7`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        renderTriggerAnalytics(data);
        
    } catch (error) {
        console.error('Failed to load trigger analytics:', error);
    }
}

function renderTriggerAnalytics(data) {
    const container = document.getElementById('customize-triggers');
    if (!container) return;
    
    let analyticsCard = container.querySelector('.trigger-analytics-card');
    
    if (data.triggers.length === 0) {
        if (analyticsCard) analyticsCard.remove();
        return;
    }
    
    if (!analyticsCard) {
        analyticsCard = document.createElement('div');
        analyticsCard.className = 'trigger-analytics-card';
        container.appendChild(analyticsCard);
    }
    
    const totalClickRate = data.total_shown > 0 
        ? Math.round((data.total_clicked / data.total_shown) * 100) 
        : 0;
    
    analyticsCard.innerHTML = `
        <div class="trigger-analytics-header">
            <h5>Trigger Performance (Last 7 days)</h5>
        </div>
        <div class="trigger-stats-grid">
            <div class="trigger-stat">
                <span class="trigger-stat-value">${data.total_shown}</span>
                <span class="trigger-stat-label">Shown</span>
            </div>
            <div class="trigger-stat success">
                <span class="trigger-stat-value">${data.total_clicked}</span>
                <span class="trigger-stat-label">Clicked</span>
            </div>
            <div class="trigger-stat">
                <span class="trigger-stat-value">${data.total_converted}</span>
                <span class="trigger-stat-label">Converted</span>
            </div>
            <div class="trigger-stat warning">
                <span class="trigger-stat-value">${totalClickRate}%</span>
                <span class="trigger-stat-label">Click Rate</span>
            </div>
        </div>
        ${data.triggers.length > 0 ? `
            <div style="margin-top: 16px;">
                ${data.triggers.map(t => `
                    <div class="trigger-perf-row">
                        <span class="trigger-perf-name">${escapeHtml(t.trigger_name)}</span>
                        <div class="trigger-perf-bar">
                            <div class="trigger-perf-fill" style="width: ${t.click_rate}%"></div>
                        </div>
                        <span class="trigger-perf-value">${t.click_rate}%</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
}

// Initialize triggers when triggers tab is clicked
document.addEventListener('DOMContentLoaded', () => {
    setupTriggersEventListeners();
    
    document.querySelectorAll('.customize-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'triggers' && currentDetailSite) {
                loadTriggers();
                loadTriggerAnalytics();
            }
        });
    });
});


// ==================== Human Handoffs ====================

let handoffsState = {
    handoffs: [],
    currentHandoff: null,
    siteFilter: '',
    statusFilter: '',
    queueES: null,
    messageES: null,
    /** Periodic REST refresh while Handoffs is open (backup if SSE is blocked or flaky). */
    queuePollTimer: null,
    lastRenderedMessagesSig: '',
    /** First queue snapshot after opening Handoffs seeds baseline (no flash for items already in view). */
    queueBaselineInitialized: false,
    /** Previous render's handoff_id set — detects re-entries (e.g. visitor cancelled then re-requested). */
    previousQueueSnapshotIds: null,
    /** handoff_id -> last seen updated_at key — detects visitor re-post on same pending row. */
    lastHandoffUpdatedAt: new Map(),
    /** handoff_id -> last visitor_queue_signals from API (int) — reliable reconnect highlight. */
    lastHandoffVisitorSignal: new Map(),
    /** handoff_id -> epoch ms when highlight ends (survives SSE re-renders). */
    handoffHighlightExpiry: new Map(),
    /** Cached GET /api/auth/agents (admin). */
    agentCatalog: null,
};

const HANDOFF_HIGHLIGHT_MS = 3 * 60 * 1000; // 3 minutes — enough to notice and accept

function initHandoffsView() {
    const siteFilterEl = document.getElementById('handoff-site-filter');
    const statusFilterEl = document.getElementById('handoff-status-filter');
    if (siteFilterEl) handoffsState.siteFilter = siteFilterEl.value;
    if (statusFilterEl) handoffsState.statusFilter = statusFilterEl.value;

    handoffsState.queueBaselineInitialized = false;
    handoffsState.previousQueueSnapshotIds = null;
    handoffsState.lastHandoffUpdatedAt = new Map();
    handoffsState.lastHandoffVisitorSignal = new Map();
    handoffsState.handoffHighlightExpiry.clear();
    handoffsState.agentCatalog = null;
    setupHandoffsEventListeners();
    const agentQueueHint = document.getElementById('handoffs-agent-queue-hint');
    if (agentQueueHint) {
        agentQueueHint.classList.toggle('hidden', currentUser?.role !== 'agent');
    }
    startHandoffQueueStream();
    // REST snapshot so the queue shows even if SSE fails (401/CORS/adblock/reconnect issues).
    loadHandoffQueue();
    startHandoffQueuePoll();
}

function stopHandoffQueuePoll() {
    if (handoffsState.queuePollTimer != null) {
        clearInterval(handoffsState.queuePollTimer);
        handoffsState.queuePollTimer = null;
    }
}

function startHandoffQueuePoll() {
    stopHandoffQueuePoll();
    handoffsState.queuePollTimer = setInterval(() => {
        const view = document.getElementById('handoffs-view');
        if (view?.classList.contains('active')) loadHandoffQueue();
    }, 12000);
}

function handoffShouldHighlight(handoffId) {
    const exp = handoffsState.handoffHighlightExpiry.get(handoffId);
    return Boolean(exp && exp > Date.now());
}

function setHandoffPanelSessionActive(active) {
    const panel = document.getElementById('handoff-detail-panel');
    const layout = document.querySelector('#handoffs-view .handoffs-layout');
    if (panel) panel.classList.toggle('handoff-session-active', active);
    if (layout) layout.classList.toggle('handoff-session-active', active);
}

async function ensureHandoffAgentCatalog() {
    if (handoffsState.agentCatalog != null) return handoffsState.agentCatalog;
    if (typeof currentUser === 'undefined' || currentUser?.role !== 'admin') return [];
    try {
        const r = await fetch(`${API_BASE}/auth/agents`, { headers: getAuthHeaders() });
        if (!r.ok) return [];
        handoffsState.agentCatalog = await r.json();
        return handoffsState.agentCatalog;
    } catch (e) {
        console.error('Failed to load agents:', e);
        return [];
    }
}

async function populateHandoffAssignSelect(handoff) {
    const row = document.getElementById('handoff-assign-row');
    const sel = document.getElementById('handoff-assign-select');
    if (!row || !sel) return;
    if (typeof currentUser === 'undefined' || currentUser?.role !== 'admin') {
        row.classList.add('hidden');
        return;
    }
    if (handoff.status === 'resolved') {
        row.classList.add('hidden');
        return;
    }
    row.classList.remove('hidden');
    const agents = await ensureHandoffAgentCatalog();
    const siteId = handoff.site_id;
    const eligible = agents.filter(a => (a.assigned_site_ids || []).includes(siteId));
    const currentId = handoff.assigned_agent_id || '';
    const opts = [
        '<option value="">— Select agent —</option>',
        ...eligible.map(a => {
            const id = a.id;
            const selected = String(id) === String(currentId) ? ' selected' : '';
            return `<option value="${escapeHtml(String(id))}"${selected}>${escapeHtml(a.name || a.email)}</option>`;
        })
    ];
    if (eligible.length === 0) {
        opts.push('<option value="" disabled>No agents configured for this site</option>');
    }
    sel.innerHTML = opts.join('');
}

async function assignHandoffToAgent(agentId) {
    const hid = handoffsState.currentHandoff?.handoff_id;
    if (!hid || !agentId) return;
    try {
        const r = await fetch(`${API_BASE}/handoff/${hid}/assign`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ agent_id: agentId })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            if (r.status === 403) {
                alert('Only admins can assign agents.');
                return;
            }
            const d = data.detail;
            const msg = Array.isArray(d) ? d.map(x => x.msg || x).join(', ') : (d || 'Could not assign agent');
            alert(msg);
            return;
        }
        handoffsState.currentHandoff = data.handoff;
        renderHandoffDetail(data.handoff);
        loadHandoffQueue();
    } catch (e) {
        console.error('assignHandoffToAgent:', e);
        alert('Could not assign agent.');
    }
}

let handoffsListenersInitialized = false;

function setupHandoffsEventListeners() {
    if (handoffsListenersInitialized) return;
    handoffsListenersInitialized = true;

    const siteFilter = document.getElementById('handoff-site-filter');
    const statusFilter = document.getElementById('handoff-status-filter');
    const inputForm = document.getElementById('handoff-input-form');
    const claimBtn = document.getElementById('claim-handoff-btn');
    const resolveBtn = document.getElementById('resolve-handoff-btn');
    
    if (siteFilter) {
        siteFilter.addEventListener('change', () => {
            handoffsState.siteFilter = siteFilter.value;
            startHandoffQueueStream();
            loadHandoffQueue();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            handoffsState.statusFilter = statusFilter.value;
            startHandoffQueueStream();
            loadHandoffQueue();
        });
    }
    
    if (inputForm) {
        inputForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await sendAgentMessage();
        });
    }

    // Textarea: Enter = send, Shift+Enter = newline, auto-resize
    const textarea = document.getElementById('handoff-input');
    if (textarea) {
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAgentMessage();
            }
        });
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
        });
    }

    // AI summary toggle
    const summaryToggle = document.getElementById('hd-summary-toggle');
    if (summaryToggle) {
        summaryToggle.addEventListener('click', () => {
            const body = document.querySelector('.hd-summary-body');
            const chevron = summaryToggle.querySelector('.hd-chevron');
            if (body) body.classList.toggle('hidden');
            if (chevron) chevron.classList.toggle('open');
        });
    }

    if (claimBtn) {
        claimBtn.addEventListener('click', () => claimHandoff());
    }

    if (resolveBtn) {
        resolveBtn.addEventListener('click', () => resolveHandoff());
    }

    const assignSel = document.getElementById('handoff-assign-select');
    if (assignSel) {
        assignSel.addEventListener('change', async () => {
            const v = assignSel.value;
            if (!v || !handoffsState.currentHandoff) return;
            await assignHandoffToAgent(v);
        });
    }
}

async function loadHandoffQueue() {
    try {
        let url = `${API_BASE}/sites/${handoffsState.siteFilter || 'all'}/handoff/queue?`;
        if (handoffsState.siteFilter) {
            url = `${API_BASE}/sites/${handoffsState.siteFilter}/handoff/queue?`;
        } else {
            url = `${API_BASE}/sites/all/handoff/queue?`;
        }
        
        if (handoffsState.statusFilter) {
            url += `status=${handoffsState.statusFilter}&`;
        }
        url += 'limit=50';

        const response = await fetch(url, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                handoffsState.handoffs = [];
                renderHandoffQueue();
                return;
            }
            throw new Error('Failed to load handoffs');
        }
        
        const data = await response.json();
        handoffsState.handoffs = data.handoffs || [];
        
        document.getElementById('pending-count').textContent = data.pending_count || 0;
        document.getElementById('active-count').textContent = data.active_count || 0;
        
        const badge = document.getElementById('handoff-badge');
        if (badge) {
            const pendingCount = data.pending_count || 0;
            badge.textContent = pendingCount;
            badge.style.display = pendingCount > 0 ? '' : 'none';
        }
        
        renderHandoffQueue();
        
    } catch (error) {
        console.error('Failed to load handoff queue:', error);
    }
}

/** Queue order from the API; open conversation pinned to top for scanning. */
function handoffsDisplayOrder(handoffs) {
    const openId = handoffsState.currentHandoff?.handoff_id;
    if (!openId || !Array.isArray(handoffs) || handoffs.length < 2) {
        return handoffs;
    }
    const idx = handoffs.findIndex(h => h.handoff_id === openId);
    if (idx <= 0) return handoffs;
    const copy = [...handoffs];
    const [open] = copy.splice(idx, 1);
    return [open, ...copy];
}

function renderHandoffQueue() {
    const container = document.getElementById('handoffs-list');
    if (!container) return;
    
    if (handoffsState.handoffs.length === 0) {
        // Queue went empty: clear snapshots so the same handoff id is treated as a re-entry next time.
        handoffsState.previousQueueSnapshotIds = new Set();
        handoffsState.lastHandoffUpdatedAt = new Map();
        handoffsState.lastHandoffVisitorSignal = new Map();

        const agentNoSites =
            typeof currentUser !== 'undefined' &&
            currentUser?.role === 'agent' &&
            (!Array.isArray(sites) || sites.length === 0);
        const agentHint = agentNoSites
            ? `<span class="handoffs-empty-hint">You are not assigned to any sites yet. An admin must assign sites under <strong>Team</strong> before visitor handoffs can appear here.</span>`
            : '';
        container.innerHTML = `
            <div class="handoffs-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>No handoff requests</p>
                <span>Handoff requests from visitors will appear here</span>
                ${agentHint}
            </div>
        `;
        return;
    }

    const ids = handoffsState.handoffs.map(h => h.handoff_id);
    const now = Date.now();
    for (const [hid, exp] of handoffsState.handoffHighlightExpiry) {
        if (exp <= now) handoffsState.handoffHighlightExpiry.delete(hid);
    }

    const updatedAtKey = (h) => {
        const u = h.updated_at;
        if (u == null) return '';
        if (typeof u === 'string') return u;
        if (typeof u === 'number' && Number.isFinite(u)) return String(u);
        const s = String(u);
        const parsed = Date.parse(s);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString() : s;
    };

    const visitorSignal = (h) => {
        const n = Number(h.visitor_queue_signals);
        return Number.isFinite(n) ? n : 0;
    };

    const bumpHighlight = (handoffId) => {
        handoffsState.handoffHighlightExpiry.set(handoffId, now + HANDOFF_HIGHLIGHT_MS);
    };

    if (!handoffsState.queueBaselineInitialized) {
        handoffsState.previousQueueSnapshotIds = new Set(ids);
        handoffsState.queueBaselineInitialized = true;
        handoffsState.handoffs.forEach((h) => {
            const id = h.handoff_id;
            handoffsState.lastHandoffUpdatedAt.set(id, updatedAtKey(h));
            handoffsState.lastHandoffVisitorSignal.set(id, visitorSignal(h));
        });
    } else {
        const prevSnap = handoffsState.previousQueueSnapshotIds || new Set();
        handoffsState.handoffs.forEach((h) => {
            const id = h.handoff_id;
            const sig = visitorSignal(h);
            if (!prevSnap.has(id)) {
                bumpHighlight(id);
            } else if (h.status === 'pending') {
                const prevSig = handoffsState.lastHandoffVisitorSignal.get(id);
                if (prevSig !== undefined && sig > prevSig) {
                    bumpHighlight(id);
                } else {
                    const prevU = handoffsState.lastHandoffUpdatedAt.get(id);
                    const u = updatedAtKey(h);
                    const prevMs = prevU ? Date.parse(prevU) : NaN;
                    const uMs = u ? Date.parse(u) : NaN;
                    if (
                        prevU != null && prevU !== '' && u !== '' &&
                        Number.isFinite(prevMs) && Number.isFinite(uMs) && uMs > prevMs
                    ) {
                        bumpHighlight(id);
                    }
                }
            }
            handoffsState.lastHandoffUpdatedAt.set(id, updatedAtKey(h));
            handoffsState.lastHandoffVisitorSignal.set(id, sig);
        });
        for (const k of handoffsState.lastHandoffUpdatedAt.keys()) {
            if (!ids.includes(k)) handoffsState.lastHandoffUpdatedAt.delete(k);
        }
        for (const k of handoffsState.lastHandoffVisitorSignal.keys()) {
            if (!ids.includes(k)) handoffsState.lastHandoffVisitorSignal.delete(k);
        }
        handoffsState.previousQueueSnapshotIds = new Set(ids);
    }

    const displayHandoffs = handoffsDisplayOrder(handoffsState.handoffs);

    container.innerHTML = displayHandoffs.map(h => {
        const isOpen = handoffsState.currentHandoff?.handoff_id === h.handoff_id;
        const highlight = handoffShouldHighlight(h.handoff_id) && !isOpen;
        const showAcceptHint = highlight && h.status === 'pending';
        const acceptIcon = `<svg class="handoff-item-accept-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
        const metaRow = h.status === 'pending'
            ? `<div class="handoff-item-meta handoff-item-meta--pending">
                <div class="handoff-item-meta-main">
                    <span class="handoff-item-time">${formatWaitTime(h.wait_time_seconds)}</span>
                    ${h.assigned_agent_name ? `<span class="handoff-item-agent">${escapeHtml(h.assigned_agent_name)}</span>` : ''}
                </div>
                <button type="button" class="handoff-item-accept-btn" data-handoff-id="${h.handoff_id}">
                    ${acceptIcon}
                    <span class="handoff-item-accept-label">Accept</span>
                </button>
            </div>`
            : `<div class="handoff-item-meta">
                <span class="handoff-item-time">${formatWaitTime(h.wait_time_seconds)}</span>
                ${h.assigned_agent_name ? `<span class="handoff-item-agent">${escapeHtml(h.assigned_agent_name)}</span>` : ''}
            </div>`;
        return `
        <div class="handoff-item ${h.status} ${isOpen ? 'selected' : ''} ${highlight ? 'handoff-item-new' : ''}"
             data-handoff-id="${h.handoff_id}"
             ${isOpen ? 'aria-current="true"' : ''}>
            <div class="handoff-item-header">
                <span class="handoff-item-visitor">${escapeHtml(h.visitor_name || h.visitor_email || 'Visitor')}</span>
                <div class="handoff-item-header-end">
                    ${isOpen ? '<span class="handoff-item-open-pill">Open</span>' : ''}
                    <span class="handoff-item-status ${h.status}">${h.status}</span>
                </div>
            </div>
            ${showAcceptHint ? `<div class="handoff-item-accept-hint" role="status">New request — waiting in queue.</div>` : ''}
            <div class="handoff-item-preview">${escapeHtml(h.last_message_preview || 'No messages yet')}</div>
            ${metaRow}
        </div>`;
    }).join('');
    
    container.querySelectorAll('.handoff-item').forEach(item => {
        item.addEventListener('click', () => {
            const handoffId = item.dataset.handoffId;
            selectHandoff(handoffId);
        });
    });

    container.querySelectorAll('.handoff-item-accept-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.handoffId;
            if (id) claimHandoffById(id, btn);
        });
    });
}

function formatWaitTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

async function selectHandoff(handoffId) {
    try {
        const response = await fetch(`${API_BASE}/handoff/${handoffId}/full`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load handoff');
        
        const handoff = await response.json();
        handoffsState.currentHandoff = handoff;
        handoffsState.lastRenderedMessagesSig = '';
        handoffsState.handoffHighlightExpiry.delete(handoffId);

        document.querySelectorAll('.handoff-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.handoffId === handoffId);
        });
        renderHandoffQueue();

        renderHandoffDetail(handoff);
        startMessageStream();
        
    } catch (error) {
        console.error('Failed to select handoff:', error);
    }
}

function renderHandoffDetail(handoff) {
    const emptyEl = document.querySelector('.handoff-detail-empty');
    const contentEl = document.getElementById('handoff-detail-content');

    if (emptyEl) emptyEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    setHandoffPanelSessionActive(true);

    // Mobile: full-screen detail
    const layout = document.querySelector('.handoffs-layout');
    if (layout && !layout.classList.contains('detail-open')) {
        layout.classList.add('detail-open');
        mobileNav.push(() => {
            layout.classList.remove('detail-open');
        }, handoff.visitor_name || 'Handoff');
    }

    // Visitor name + avatar initials
    const name = handoff.visitor_name || 'Visitor';
    document.getElementById('handoff-visitor-name').textContent = name;
    document.getElementById('handoff-visitor-email').textContent = handoff.visitor_email || '';
    const avatarEl = document.getElementById('hd-avatar');
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();

    document.getElementById('handoff-wait-time').textContent =
        formatWaitTime(handoff.wait_time_seconds || 0);

    const siteNameEl = document.getElementById('handoff-site-name');
    if (siteNameEl) {
        const matchedSite = (typeof sites !== 'undefined' ? sites : []).find(s => s.site_id === handoff.site_id);
        siteNameEl.textContent = matchedSite ? (matchedSite.name || matchedSite.url) : (handoff.site_id || 'Site');
    }

    const statusBadge = document.getElementById('handoff-status-badge');
    statusBadge.textContent = handoff.status;
    statusBadge.className = `hd-badge ${handoff.status}`;

    const claimBtn = document.getElementById('claim-handoff-btn');
    const resolveBtn = document.getElementById('resolve-handoff-btn');
    const inputWrapper = document.getElementById('handoff-input-wrapper');

    if (handoff.status === 'pending') {
        claimBtn.classList.remove('hidden');
        resolveBtn.classList.add('hidden');
        inputWrapper.classList.add('hidden');
    } else if (handoff.status === 'active') {
        claimBtn.classList.add('hidden');
        resolveBtn.classList.remove('hidden');
        inputWrapper.classList.remove('hidden');
    } else {
        claimBtn.classList.add('hidden');
        resolveBtn.classList.add('hidden');
        inputWrapper.classList.add('hidden');
    }

    const summaryEl = document.getElementById('handoff-ai-summary');
    if (handoff.ai_summary) {
        summaryEl.classList.remove('hidden');
        const bodyEl = summaryEl.querySelector('.ai-summary-content');
        bodyEl.innerHTML = `<pre>${escapeHtml(handoff.ai_summary)}</pre>`;
    } else {
        summaryEl.classList.add('hidden');
    }

    renderHandoffMessages(handoff.messages || []);
    void populateHandoffAssignSelect(handoff);
}

function renderHandoffMessages(messages) {
    const container = document.getElementById('handoff-messages');
    if (!container) return;

    const currentHandoffId = handoffsState.currentHandoff?.handoff_id || '';
    const normalizedMessages = Array.isArray(messages) ? messages : [];
    const messageSig = `${currentHandoffId}:${normalizedMessages.length}:${normalizedMessages.map(m =>
        `${m.id || ''}:${m.timestamp || ''}:${m.role || ''}:${m.sender_name || ''}:${m.content || ''}`
    ).join('|')}`;
    if (handoffsState.lastRenderedMessagesSig === messageSig) return;
    handoffsState.lastRenderedMessagesSig = messageSig;

    if (normalizedMessages.length === 0) {
        container.innerHTML = `
            <div class="hd-messages-empty">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                </svg>
                No messages yet
            </div>`;
        return;
    }

    let lastDate = null;
    const items = normalizedMessages.map(msg => {
        const ts = new Date(msg.timestamp);
        const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isAgent = msg.role === 'agent';
        const sender = escapeHtml(msg.sender_name || (isAgent ? 'Agent' : 'Visitor'));

        let separator = '';
        if (dateStr !== lastDate) {
            lastDate = dateStr;
            separator = `<div class="hd-date-separator">${dateStr}</div>`;
        }

        return `${separator}
        <div class="hd-msg ${isAgent ? 'agent' : 'visitor'}">
            <div class="hd-msg-meta">
                <span class="hd-msg-sender">${sender}</span>
                <span class="hd-msg-time">${timeStr}</span>
            </div>
            <div class="hd-msg-bubble">${escapeHtml(msg.content)}</div>
        </div>`;
    }).join('');

    container.innerHTML = items;
    container.scrollTop = container.scrollHeight;
}

async function claimHandoffById(handoffId, sourceBtn = null) {
    const labelEl = sourceBtn?.querySelector('.handoff-item-accept-label, .hd-btn-accept-label');
    const iconEl = sourceBtn?.querySelector('.handoff-item-accept-icon, .hd-btn-accept-icon');
    const prevLabel = labelEl ? labelEl.textContent : null;

    const setClaimBusy = (busy) => {
        document.querySelectorAll('.handoff-item-accept-btn').forEach(b => {
            b.disabled = busy;
            b.setAttribute('aria-busy', busy ? 'true' : 'false');
        });
        const detailBtn = document.getElementById('claim-handoff-btn');
        if (detailBtn) {
            detailBtn.disabled = busy;
            detailBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
    };

    setClaimBusy(true);
    if (labelEl) labelEl.textContent = '…';
    if (iconEl) iconEl.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/handoff/${handoffId}/status`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: 'active' })
        });

        if (!response.ok) throw new Error('Failed to claim handoff');

        const data = await response.json();
        handoffsState.lastRenderedMessagesSig = '';
        handoffsState.currentHandoff = data.handoff;
        handoffsState.handoffHighlightExpiry.delete(handoffId);

        document.querySelectorAll('.handoff-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.handoffId === handoffId);
        });

        renderHandoffDetail(data.handoff);
        loadHandoffQueue();
        startMessageStream();
    } catch (error) {
        console.error('Failed to claim handoff:', error);
        alert('Failed to claim handoff. Please try again.');
    } finally {
        setClaimBusy(false);
        if (labelEl && prevLabel !== null && document.contains(labelEl)) {
            labelEl.textContent = prevLabel;
        }
        if (iconEl && document.contains(iconEl)) {
            iconEl.classList.remove('hidden');
        }
    }
}

async function claimHandoff() {
    if (!handoffsState.currentHandoff) return;
    await claimHandoffById(handoffsState.currentHandoff.handoff_id, document.getElementById('claim-handoff-btn'));
}

async function resolveHandoff() {
    if (!handoffsState.currentHandoff) return;
    
    if (!confirm('Are you sure you want to resolve this conversation?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/handoff/${handoffsState.currentHandoff.handoff_id}/status`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: 'resolved' })
        });
        
        if (!response.ok) throw new Error('Failed to resolve handoff');
        
        stopMessageStream();
        handoffsState.currentHandoff = null;
        
        const emptyEl = document.querySelector('.handoff-detail-empty');
        const contentEl = document.getElementById('handoff-detail-content');
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (contentEl) contentEl.classList.add('hidden');
        setHandoffPanelSessionActive(false);
        
        loadHandoffQueue();
        
    } catch (error) {
        console.error('Failed to resolve handoff:', error);
        alert('Failed to resolve handoff. Please try again.');
    }
}

async function sendAgentMessage() {
    if (!handoffsState.currentHandoff) return;
    
    const input = document.getElementById('handoff-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';
    input.style.height = 'auto';
    
    try {
        const response = await fetch(`${API_BASE}/handoff/${handoffsState.currentHandoff.handoff_id}/agent-message`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ content })
        });
        
        if (!response.ok) throw new Error('Failed to send message');
        
        const data = await response.json();
        
        if (!handoffsState.currentHandoff.messages) {
            handoffsState.currentHandoff.messages = [];
        }
        handoffsState.currentHandoff.messages.push(data.message);
        renderHandoffMessages(handoffsState.currentHandoff.messages);

        if (data.handoff_status && data.handoff_status !== handoffsState.currentHandoff.status) {
            handoffsState.currentHandoff.status = data.handoff_status;
            handoffsState.currentHandoff.assigned_agent_name = data.assigned_agent_name || handoffsState.currentHandoff.assigned_agent_name;
            renderHandoffDetail(handoffsState.currentHandoff);
        }

    } catch (error) {
        console.error('Failed to send message:', error);
        alert('Failed to send message. Please try again.');
    }
}

function startHandoffQueueStream() {
    stopHandoffQueueStream();
    const token = localStorage.getItem('token');
    if (!token) return;

    let url = `${API_BASE}/handoff/queue/stream?token=${encodeURIComponent(token)}`;
    if (handoffsState.siteFilter) url += `&site_id=${encodeURIComponent(handoffsState.siteFilter)}`;
    if (handoffsState.statusFilter) url += `&status=${encodeURIComponent(handoffsState.statusFilter)}`;

    const es = new EventSource(url);
    handoffsState.queueES = es;

    es.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            handoffsState.handoffs = data.handoffs || [];

            const pendingEl = document.getElementById('pending-count');
            const activeEl = document.getElementById('active-count');
            if (pendingEl) pendingEl.textContent = data.pending_count || 0;
            if (activeEl) activeEl.textContent = data.active_count || 0;

            const badge = document.getElementById('handoff-badge');
            if (badge) {
                const count = data.pending_count || 0;
                badge.textContent = count;
                badge.style.display = count > 0 ? 'flex' : 'none';
            }

            renderHandoffQueue();
        } catch (err) {
            console.error('Queue SSE parse error:', err);
        }
    };

    es.addEventListener('error', (e) => {
        if (e.data) {
            try {
                const err = JSON.parse(e.data);
                console.error('Queue SSE error event:', err.error);
            } catch (_) {}
        }
        // Browser auto-reconnects on connection drops; nothing to do here.
    });
}

function stopHandoffQueueStream() {
    if (handoffsState.queueES) {
        handoffsState.queueES.close();
        handoffsState.queueES = null;
    }
}

function startMessageStream() {
    stopMessageStream();
    if (!handoffsState.currentHandoff) return;

    const url = `${API_BASE}/handoff/${handoffsState.currentHandoff.handoff_id}/stream`;
    const es = new EventSource(url);
    handoffsState.messageES = es;

    es.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            const incomingMessages = Array.isArray(data.messages) ? data.messages : [];
            const existingMessages = handoffsState.currentHandoff?.messages || [];
            const hasExisting = Array.isArray(existingMessages) && existingMessages.length > 0;
            const shouldSkipTransientEmpty = incomingMessages.length === 0 && hasExisting;

            // Ignore brief empty snapshots from SSE polling to avoid message flicker/reset.
            if (!shouldSkipTransientEmpty) {
                if (handoffsState.currentHandoff) {
                    handoffsState.currentHandoff.messages = incomingMessages;
                }
                renderHandoffMessages(incomingMessages);
            }

            if (data.status && data.status !== handoffsState.currentHandoff.status) {
                handoffsState.currentHandoff.status = data.status;
                handoffsState.currentHandoff.assigned_agent_name = data.agent_name || handoffsState.currentHandoff.assigned_agent_name;
                renderHandoffDetail(handoffsState.currentHandoff);
            }

            if (data.status === 'resolved') {
                stopMessageStream();
                renderHandoffDetail(handoffsState.currentHandoff);
            }
        } catch (err) {
            console.error('Message SSE parse error:', err);
        }
    };

    es.addEventListener('error', (e) => {
        if (e.data) {
            try {
                const err = JSON.parse(e.data);
                if (err.error === 'Handoff not found') stopMessageStream();
            } catch (_) {}
        }
    });
}

function stopMessageStream() {
    if (handoffsState.messageES) {
        handoffsState.messageES.close();
        handoffsState.messageES = null;
    }
}

async function populateHandoffSiteFilter() {
    const select = document.getElementById('handoff-site-filter');
    if (!select) return;
    
    select.innerHTML = '<option value="">All Sites</option>';
    
    sites.forEach(site => {
        const option = document.createElement('option');
        option.value = site.site_id;
        option.textContent = site.name || site.url;
        select.appendChild(option);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupHandoffSettingsListeners();
});

// ==================== Handoff Settings Panel ====================

function setupHandoffSettingsListeners() {
    const confidenceSlider = document.getElementById('confidence-threshold');
    const confidenceValue = document.getElementById('confidence-threshold-value');
    
    if (confidenceSlider && confidenceValue) {
        confidenceSlider.addEventListener('input', () => {
            confidenceValue.textContent = `${confidenceSlider.value}%`;
        });
    }
    
    const businessHoursToggle = document.getElementById('business-hours-enabled');
    const businessHoursConfig = document.getElementById('business-hours-config');
    
    if (businessHoursToggle && businessHoursConfig) {
        businessHoursToggle.addEventListener('change', () => {
            businessHoursConfig.classList.toggle('hidden', !businessHoursToggle.checked);
        });
    }
    
    const scheduleRows = document.querySelectorAll('#business-hours-schedule .schedule-row');
    scheduleRows.forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const startInput = row.querySelector('.schedule-start');
        const endInput = row.querySelector('.schedule-end');
        
        if (checkbox && startInput && endInput) {
            checkbox.addEventListener('change', () => {
                startInput.disabled = !checkbox.checked;
                endInput.disabled = !checkbox.checked;
            });
        }
    });
    
    const saveBtn = document.getElementById('save-handoff-config');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveHandoffConfig);
    }
    
    document.querySelectorAll('.customize-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'handoff' && currentDetailSite) {
                loadHandoffConfig();
            }
        });
    });
}

async function loadHandoffConfig() {
    if (!currentDetailSite) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/handoff/config`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) return;
        
        const config = await response.json();
        
        const enabledEl = document.getElementById('handoff-enabled');
        const agentStatusEl = document.getElementById('handoff-agent-status');
        const updateAgentStatus = async () => {
            if (!agentStatusEl) return;
            try {
                const cfgRes = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config`);
                if (!cfgRes.ok) return;
                const cfgData = await cfgRes.json();
                const h = cfgData.handoff || {};
                const enabled = enabledEl ? enabledEl.checked : h.enabled !== false;
                if (!h.has_agents) {
                    agentStatusEl.textContent = 'No human agents are assigned to this site — the Live Agent button is hidden on the widget. Assign agents under Team.';
                    agentStatusEl.style.color = 'var(--warning, #d97706)';
                } else if (enabled) {
                    agentStatusEl.textContent = 'Human agents are assigned — visitors can request a Live Agent.';
                    agentStatusEl.style.color = 'var(--text-muted, #64748b)';
                } else {
                    agentStatusEl.textContent = 'Human agents are disabled — the Live Agent button is hidden on the widget.';
                    agentStatusEl.style.color = 'var(--text-muted, #64748b)';
                }
            } catch (e) { /* status hint is best-effort */ }
        };
        const thresholdEl = document.getElementById('confidence-threshold');
        const thresholdValue = document.getElementById('confidence-threshold-value');
        const businessHoursEnabled = document.getElementById('business-hours-enabled');
        const businessHoursConfig = document.getElementById('business-hours-config');
        const timezoneEl = document.getElementById('business-timezone');
        const offlineMessageEl = document.getElementById('offline-message');
        
        if (enabledEl) {
            enabledEl.checked = config.enabled !== false;
            if (!enabledEl.dataset.statusBound) {
                enabledEl.dataset.statusBound = '1';
                enabledEl.addEventListener('change', updateAgentStatus);
            }
        }
        await updateAgentStatus();

        if (thresholdEl && thresholdValue) {
            const threshold = Math.round((config.confidence_threshold || 0.3) * 100);
            thresholdEl.value = threshold;
            thresholdValue.textContent = `${threshold}%`;
        }
        
        const bh = config.business_hours || {};
        if (businessHoursEnabled) {
            businessHoursEnabled.checked = bh.enabled === true;
            businessHoursConfig.classList.toggle('hidden', !bh.enabled);
        }
        
        if (timezoneEl && bh.timezone) {
            timezoneEl.value = bh.timezone;
        }
        
        if (offlineMessageEl && bh.offline_message) {
            offlineMessageEl.value = bh.offline_message;
        }
        
        const schedule = bh.schedule || {};
        Object.keys(schedule).forEach(day => {
            const dayData = schedule[day];
            const checkbox = document.querySelector(`#business-hours-schedule input[data-day="${day}"]`);
            const startInput = document.querySelector(`#business-hours-schedule .schedule-start[data-day="${day}"]`);
            const endInput = document.querySelector(`#business-hours-schedule .schedule-end[data-day="${day}"]`);
            
            if (checkbox) {
                checkbox.checked = dayData.enabled !== false;
            }
            if (startInput) {
                startInput.value = dayData.start || '09:00';
                startInput.disabled = !checkbox?.checked;
            }
            if (endInput) {
                endInput.value = dayData.end || '17:00';
                endInput.disabled = !checkbox?.checked;
            }
        });
        
    } catch (error) {
        console.error('Failed to load handoff config:', error);
    }
}

async function saveHandoffConfig() {
    if (!currentDetailSite) return;
    
    const btn = document.getElementById('save-handoff-config');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    
    try {
        const enabled = document.getElementById('handoff-enabled')?.checked !== false;
        const threshold = (document.getElementById('confidence-threshold')?.value || 30) / 100;
        const businessHoursEnabled = document.getElementById('business-hours-enabled')?.checked || false;
        const timezone = document.getElementById('business-timezone')?.value || 'UTC';
        const offlineMessage = document.getElementById('offline-message')?.value || '';
        
        const schedule = {};
        const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        days.forEach(day => {
            const checkbox = document.querySelector(`#business-hours-schedule input[data-day="${day}"]`);
            const startInput = document.querySelector(`#business-hours-schedule .schedule-start[data-day="${day}"]`);
            const endInput = document.querySelector(`#business-hours-schedule .schedule-end[data-day="${day}"]`);
            
            schedule[day] = {
                enabled: checkbox?.checked || false,
                start: startInput?.value || '09:00',
                end: endInput?.value || '17:00'
            };
        });
        
        const config = {
            enabled,
            confidence_threshold: threshold,
            business_hours: {
                enabled: businessHoursEnabled,
                timezone,
                schedule,
                offline_message: offlineMessage
            }
        };
        
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/handoff/config`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(config)
        });
        
        if (!response.ok) throw new Error('Failed to save config');
        
        btn.textContent = 'Saved!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
        
    } catch (error) {
        console.error('Failed to save handoff config:', error);
        alert('Failed to save settings. Please try again.');
        btn.textContent = originalText;
    } finally {
        btn.disabled = false;
    }
}

// ==================== Security Settings ====================

let securityAllowedDomains = [];

function initSecuritySettings() {
    const addDomainBtn = document.getElementById('security-add-domain');
    const domainInput = document.getElementById('security-new-domain');
    const saveBtn = document.getElementById('save-security-config');
    const copyBtn = document.getElementById('copy-secure-embed');
    const rateLimitSlider = document.getElementById('security-rate-limit');
    const rateLimitValue = document.getElementById('security-rate-limit-value');
    
    if (addDomainBtn && domainInput) {
        addDomainBtn.addEventListener('click', () => addDomain());
        domainInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
            }
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSecurityConfig);
    }
    
    if (copyBtn) {
        copyBtn.addEventListener('click', copySecureEmbedCode);
    }
    
    if (rateLimitSlider && rateLimitValue) {
        rateLimitSlider.addEventListener('input', () => {
            rateLimitValue.textContent = rateLimitSlider.value;
        });
    }
    
    document.querySelectorAll('.customize-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'security' && currentDetailSite) {
                loadSecurityConfig();
            }
        });
    });
}

function addDomain() {
    const input = document.getElementById('security-new-domain');
    const domain = input.value.trim().toLowerCase();
    
    if (!domain) return;
    
    const domainPattern = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    const localhostPattern = /^localhost(:\d+)?$/;
    const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;
    
    if (!domainPattern.test(domain) && !localhostPattern.test(domain) && !ipPattern.test(domain)) {
        alert('Please enter a valid domain (e.g., example.com or *.example.com)');
        return;
    }
    
    if (securityAllowedDomains.includes(domain)) {
        alert('Domain already added');
        return;
    }
    
    securityAllowedDomains.push(domain);
    input.value = '';
    renderDomainList();
}

function removeDomain(domain) {
    securityAllowedDomains = securityAllowedDomains.filter(d => d !== domain);
    renderDomainList();
}

function renderDomainList() {
    const container = document.getElementById('security-domain-list');
    if (!container) return;
    
    container.innerHTML = securityAllowedDomains.map(domain => `
        <span class="domain-tag">
            ${escapeHtml(domain)}
            <button type="button" class="remove-domain" onclick="removeDomain('${domain}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </span>
    `).join('');
}

async function loadSecurityConfig() {
    if (!currentDetailSite) return;
    
    // Initialize handlers for dynamically generated content
    initSecurityTabHandlers();
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) return;
        
        const site = await response.json();
        const security = site.config?.security || {};
        
        const enforceEl = document.getElementById('security-enforce-domain');
        const referrerEl = document.getElementById('security-require-referrer');
        const rateLimitEl = document.getElementById('security-rate-limit');
        const rateLimitValue = document.getElementById('security-rate-limit-value');
        
        if (enforceEl) enforceEl.checked = security.enforce_domain_validation === true;
        if (referrerEl) referrerEl.checked = security.require_referrer === true;
        if (rateLimitEl) {
            rateLimitEl.value = security.rate_limit_per_session || 60;
            if (rateLimitValue) rateLimitValue.textContent = rateLimitEl.value;
        }
        
        securityAllowedDomains = security.allowed_domains || [];
        renderDomainList();
        
    } catch (error) {
        console.error('Failed to load security config:', error);
    }
    
    // Always load embed code (doesn't require auth)
    loadSecureEmbedCode();
}

function initSecurityTabHandlers() {
    const addDomainBtn = document.getElementById('security-add-domain');
    const domainInput = document.getElementById('security-new-domain');
    const saveBtn = document.getElementById('save-security-config');
    const copyBtn = document.getElementById('copy-secure-embed');
    const rateLimitSlider = document.getElementById('security-rate-limit');
    const rateLimitValue = document.getElementById('security-rate-limit-value');
    
    if (addDomainBtn && domainInput) {
        addDomainBtn.onclick = () => addDomain();
        domainInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
            }
        };
    }
    
    if (saveBtn) {
        saveBtn.onclick = saveSecurityConfig;
    }
    
    if (copyBtn) {
        copyBtn.onclick = copySecureEmbedCode;
    }
    
    if (rateLimitSlider && rateLimitValue) {
        rateLimitSlider.oninput = () => {
            rateLimitValue.textContent = rateLimitSlider.value;
        };
    }
}

async function loadSecureEmbedCode() {
    if (!currentDetailSite) return;
    
    const embedCodeEl = document.getElementById('security-embed-code');
    const sriHashEl = document.getElementById('security-sri-hash');
    
    // Attach copy button handler for embed tab
    const copyBtn = document.getElementById('copy-detail-embed');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyDetailEmbed);
    }
    
    try {
        const response = await fetch(`${API_BASE}/embed/security/${currentDetailSite.site_id}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load security info');
        
        const info = await response.json();
        
        if (sriHashEl) {
            sriHashEl.textContent = info.sri_hash || 'Not available';
        }
        
        if (embedCodeEl) {
            const embedCode = `<script>
(function() {
    var s = document.createElement('script');
    s.src = '${info.widget_url || `${API_BASE.replace('/api', '')}/widget/chatbot.js`}';
    s.async = true;${info.sri_hash ? `
    s.integrity = '${info.sri_hash}';
    s.crossOrigin = 'anonymous';` : ''}
    s.dataset.siteId = '${currentDetailSite.site_id}';
    s.dataset.apiUrl = '${API_BASE.replace('/api', '')}';
    document.head.appendChild(s);
})();
<\/script>`;
            embedCodeEl.textContent = embedCode;
        }
        
    } catch (error) {
        console.error('Failed to load secure embed code:', error);
        if (embedCodeEl) embedCodeEl.textContent = 'Failed to load embed code';
        if (sriHashEl) sriHashEl.textContent = 'Not available';
    }
}

async function copySecureEmbedCode() {
    const embedCodeEl = document.getElementById('security-embed-code');
    const copyBtn = document.getElementById('copy-secure-embed');
    
    if (!embedCodeEl) return;
    
    try {
        await navigator.clipboard.writeText(embedCodeEl.textContent);
        
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Copied!
        `;
        
        setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
        }, 2000);
        
    } catch (error) {
        console.error('Failed to copy:', error);
    }
}

async function saveSecurityConfig() {
    if (!currentDetailSite) return;
    
    const btn = document.getElementById('save-security-config');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    
    try {
        const securityConfig = {
            enforce_domain_validation: document.getElementById('security-enforce-domain')?.checked || false,
            allowed_domains: securityAllowedDomains,
            require_referrer: document.getElementById('security-require-referrer')?.checked || false,
            rate_limit_per_session: parseInt(document.getElementById('security-rate-limit')?.value || 60)
        };
        
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ security: securityConfig })
        });
        
        if (!response.ok) throw new Error('Failed to save config');
        
        btn.textContent = 'Saved!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
        
    } catch (error) {
        console.error('Failed to save security config:', error);
        alert('Failed to save settings. Please try again.');
        btn.textContent = originalText;
    } finally {
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initSecuritySettings();
});

// ==================== White-label Settings ====================

let whiteLabelConfig = null;

async function loadWhiteLabelConfig() {
    try {
        const response = await fetch(`${API_BASE}/platform/whitelabel`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load white-label config');
        
        whiteLabelConfig = await response.json();
        populateWhiteLabelForm(whiteLabelConfig);
        applyWhiteLabelBranding(whiteLabelConfig);
        
    } catch (error) {
        console.error('Failed to load white-label config:', error);
    }
}

function populateWhiteLabelForm(config) {
    const fields = {
        'wl-app-name': config.app_name || 'SwiftChat',
        'wl-primary-color': config.primary_color || '#7B3DFB',
        'wl-primary-color-text': config.primary_color || '#7B3DFB',
        'wl-logo-url': config.logo_url || '',
    };

    Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
}

function applyWhiteLabelBranding(config) {
    if (!config) return;
    
    if (config.app_name && config.app_name !== 'SwiftChat') {
        document.title = config.app_name;
        const brandName = document.querySelector('.brand-name');
        if (brandName) brandName.textContent = config.app_name;
    }
    
    if (config.primary_color) {
        document.documentElement.style.setProperty('--primary', config.primary_color);
    }
    
    if (config.logo_url) {
        const brandIcon = document.querySelector('.brand-icon');
        if (brandIcon) {
            brandIcon.innerHTML = `<img src="${config.logo_url}" alt="Logo">`;
        }
        const mobileBrandIcon = document.querySelector('.mobile-brand-icon');
        if (mobileBrandIcon) {
            mobileBrandIcon.innerHTML = `<img src="${config.logo_url}" alt="Logo">`;
        }
    }
    
    if (config.favicon_url) {
        let favicon = document.querySelector('link[rel="icon"]');
        if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }
        favicon.href = config.favicon_url;
    }
}

async function saveWhiteLabelConfig() {
    const btn = document.getElementById('wl-save-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    
    try {
        const config = {
            app_name: document.getElementById('wl-app-name')?.value || 'SwiftChat',
            primary_color: document.getElementById('wl-primary-color')?.value || '#7B3DFB',
            logo_url: document.getElementById('wl-logo-url')?.value || null,
        };
        
        const response = await fetch(`${API_BASE}/platform/whitelabel`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(config)
        });
        
        if (!response.ok) throw new Error('Failed to save config');
        
        whiteLabelConfig = await response.json();
        applyWhiteLabelBranding(whiteLabelConfig);
        
        btn.textContent = 'Saved!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
        
    } catch (error) {
        console.error('Failed to save white-label config:', error);
        alert('Failed to save settings. Please try again.');
        btn.textContent = originalText;
    } finally {
        btn.disabled = false;
    }
}

async function resetWhiteLabelConfig() {
    if (!confirm('Reset all white-label settings to defaults?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/platform/whitelabel/reset`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to reset config');
        
        whiteLabelConfig = await response.json();
        populateWhiteLabelForm(whiteLabelConfig);
        applyWhiteLabelBranding(whiteLabelConfig);
        
        alert('Settings reset to defaults.');
        
    } catch (error) {
        console.error('Failed to reset white-label config:', error);
        alert('Failed to reset settings. Please try again.');
    }
}

function setupWhiteLabelListeners() {
    const form = document.getElementById('whitelabel-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveWhiteLabelConfig();
        });
    }
    
    const resetBtn = document.getElementById('wl-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetWhiteLabelConfig);
    }
    
    const colorInput = document.getElementById('wl-primary-color');
    const colorText = document.getElementById('wl-primary-color-text');
    
    if (colorInput && colorText) {
        colorInput.addEventListener('input', () => {
            colorText.value = colorInput.value;
        });
        
        colorText.addEventListener('input', () => {
            if (/^#[0-9A-Fa-f]{6}$/.test(colorText.value)) {
                colorInput.value = colorText.value;
            }
        });
    }
}

function initWhiteLabelSettings() {
    setupWhiteLabelListeners();
    loadWhiteLabelConfig();
}

// ==================== Settings Panels ====================

let settingsPanelsInit = false;
function initSettingsPanels() {
    if (settingsPanelsInit) return;
    settingsPanelsInit = true;
    document.querySelectorAll('.settings-nav-item[data-panel]').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(`settings-panel-${item.dataset.panel}`);
            if (panel) panel.classList.add('active');
        });
    });
}

// ==================== Profile Settings ====================

let profileListenerBound = false;
function initProfileSettings() {
    const form = document.getElementById('profile-form');
    if (!form || profileListenerBound) {
        // Still re-fill current values in case user data changed
        const nameEl = document.getElementById('profile-name');
        const emailEl = document.getElementById('profile-email');
        if (nameEl && currentUser?.name) nameEl.value = currentUser.name;
        if (emailEl && currentUser?.email) emailEl.value = currentUser.email;
        return;
    }
    profileListenerBound = true;

    // Pre-fill name and email from currentUser
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    if (nameEl && currentUser?.name) nameEl.value = currentUser.name;
    if (emailEl && currentUser?.email) emailEl.value = currentUser.email;

    const avatarEl = document.getElementById('profile-avatar-url');
    const avatarPreview = document.getElementById('profile-avatar-preview');
    const renderAvatarPreview = () => {
        const url = avatarEl?.value.trim();
        if (avatarPreview) avatarPreview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : '';
    };
    if (avatarEl && currentUser?.avatar_url) avatarEl.value = currentUser.avatar_url;
    renderAvatarPreview();
    avatarEl?.addEventListener('input', renderAvatarPreview);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('profile-error');
        const okEl = document.getElementById('profile-success');
        const saveBtn = document.getElementById('profile-save-btn');
        errEl.style.display = 'none';
        okEl.style.display = 'none';

        const name = nameEl?.value?.trim();
        const currentPw = document.getElementById('profile-current-password')?.value;
        const newPw = document.getElementById('profile-new-password')?.value;

        const body = {};
        if (name && name !== currentUser?.name) body.name = name;
        const avatarUrl = avatarEl?.value?.trim() || '';
        if (avatarUrl !== (currentUser?.avatar_url || '')) body.avatar_url = avatarUrl;
        if (newPw) {
            if (!currentUser?.must_change_password) {
                body.current_password = currentPw;
            }
            body.new_password = newPw;
        }

        if (!Object.keys(body).length) {
            errEl.textContent = 'No changes to save.';
            errEl.style.display = '';
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
            const res = await fetch(`${API_BASE}/auth/me`, {
                method: 'PATCH',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.detail || 'Failed to save changes.';
                errEl.style.display = '';
                return;
            }
            // Update currentUser in memory and sidebar display
            currentUser = { ...currentUser, ...data };
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateUserUI();
            // Clear password fields
            document.getElementById('profile-current-password').value = '';
            document.getElementById('profile-new-password').value = '';
            okEl.style.display = '';
            setTimeout(() => { okEl.style.display = 'none'; }, 3000);
        } catch {
            errEl.textContent = 'Network error. Please try again.';
            errEl.style.display = '';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save changes';
        }
    });
}

// ==================== Team Management ====================

let teamListenersBound = false;
let activeTeamTab = 'agents'; // default; admins start on 'owners'

function initTeamView() {
    if (currentUser?.role === 'agent') return;

    // Decide default tab
    if (!teamListenersBound) {
        activeTeamTab = currentUser?.role === 'admin' ? 'owners' : 'agents';
    }

    if (!teamListenersBound) {
        teamListenersBound = true;

        // Tab switching
        document.querySelectorAll('.team-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                activeTeamTab = tab.dataset.teamTab;
                document.querySelectorAll('.team-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.team-panel').forEach(p => p.classList.add('hidden'));
                document.getElementById(`team-panel-${activeTeamTab}`)?.classList.remove('hidden');
                updateTeamHeader();
                loadActiveTab();
            });
        });

        // Modal controls
        document.getElementById('member-modal-close')?.addEventListener('click', closeMemberModal);
        document.getElementById('member-modal-cancel')?.addEventListener('click', closeMemberModal);
        document.getElementById('member-modal-save')?.addEventListener('click', submitMemberForm);
        document.getElementById('member-modal')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) closeMemberModal();
        });

        // Select-all toggle for site checkboxes
        document.getElementById('sites-select-all-btn')?.addEventListener('click', () => {
            const boxes = document.querySelectorAll('#member-sites-checkboxes input[name="member-site"]');
            const allChecked = Array.from(boxes).every(b => b.checked);
            boxes.forEach(b => { b.checked = !allChecked; });
            updateSelectAllLabel();
        });
    }

    // Activate correct tab
    document.querySelectorAll('.team-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.team-panel').forEach(p => p.classList.add('hidden'));
    const activeTabEl = document.getElementById(`team-tab-${activeTeamTab}`);
    if (activeTabEl) activeTabEl.classList.add('active');
    document.getElementById(`team-panel-${activeTeamTab}`)?.classList.remove('hidden');

    updateTeamHeader();
    loadActiveTab();
}

function updateTeamHeader() {
    const actions = document.getElementById('team-header-actions');
    const subtitle = document.getElementById('team-subtitle');
    if (!actions) return;
    if (activeTeamTab === 'owners') {
        subtitle.textContent = 'Site owners can create and manage their own sites and support agents.';
        actions.innerHTML = `<button type="button" class="btn btn-primary" id="team-add-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add site owner
        </button>`;
    } else {
        subtitle.textContent = 'Support agents handle live chat handoffs. Each agent only sees the sites you assign.';
        actions.innerHTML = `<button type="button" class="btn btn-primary" id="team-add-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add agent
        </button>`;
    }
    document.getElementById('team-add-btn')?.addEventListener('click', () => openMemberModal(activeTeamTab, null));
}

function loadActiveTab() {
    if (activeTeamTab === 'owners') loadTeamOwners();
    else loadTeamAgents();
}

// ----- Avatar helpers -----
const AVATAR_COLORS = ['#7B3DFB','#3b82f6','#8b5cf6','#f97316','#10b981','#f59e0b','#ef4444','#06b6d4'];
function avatarColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function avatarInitials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
}

// ----- Site Owners (admin only) -----
async function loadTeamOwners() {
    const list = document.getElementById('owners-list');
    const countEl = document.getElementById('owners-count');
    if (!list) return;
    list.innerHTML = `<div class="members-loading"><svg class="spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.2"/><path d="M12 2a10 10 0 0110 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg> Loading…</div>`;
    try {
        const res = await fetch(`${API_BASE}/auth/users`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const all = await res.json();
        const owners = all.filter(u => u.role !== 'agent');
        if (countEl) countEl.textContent = owners.length;

        // Stats bar
        const statsEl = document.getElementById('owners-stats');
        if (statsEl && owners.length) {
            const adminCount = owners.filter(u => u.role === 'admin').length;
            const userCount = owners.filter(u => u.role === 'user').length;
            statsEl.style.display = '';
            statsEl.innerHTML = `
                <span class="team-panel-stat"><span class="team-panel-stat-num">${owners.length}</span> total</span>
                <span class="team-panel-stat-sep"></span>
                <span class="team-panel-stat"><span class="team-panel-stat-num">${adminCount}</span> admin${adminCount !== 1 ? 's' : ''}</span>
                <span class="team-panel-stat-sep"></span>
                <span class="team-panel-stat"><span class="team-panel-stat-num">${userCount}</span> site owner${userCount !== 1 ? 's' : ''}</span>`;
        } else if (statsEl) {
            statsEl.style.display = 'none';
        }

        if (!owners.length) {
            list.innerHTML = `<div class="members-empty">
                <div class="members-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                <p>No site owners yet.</p>
                <button type="button" class="btn btn-primary btn-sm" onclick="openMemberModal('owners',null)">Add first site owner</button>
            </div>`;
            return;
        }
        const roleLabels = { admin: 'Admin', user: 'Site Owner' };
        const rolePillClass = { admin: 'role-admin', user: 'role-user' };
        list.innerHTML = owners.map(u => {
            const initials = avatarInitials(u.name);
            const color = avatarColor(u.email);
            const joined = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const canDelete = u.id !== currentUser.id && u.role !== 'admin';
            const canEditOwner = u.role === 'user';
            return `<div class="member-row" data-member-id="${escapeHtml(u.id)}" data-member-type="owner">
                <div class="member-identity">
                    <div class="member-avatar" style="background:${color}">${escapeHtml(initials)}</div>
                    <div class="member-details">
                        <span class="member-name">${escapeHtml(u.name)}</span>
                        <span class="member-email">${escapeHtml(u.email)}</span>
                    </div>
                </div>
                <div><span class="role-badge ${rolePillClass[u.role] || ''}">${escapeHtml(roleLabels[u.role] || u.role)}</span></div>
                <div class="member-date">${joined}</div>
                <div class="member-actions">
                    ${canEditOwner ? `<button type="button" class="btn btn-ghost btn-sm edit-owner-btn" title="Edit site owner">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>` : ''}
                    ${canDelete ? `<button class="btn btn-ghost btn-sm delete-member-btn" title="Delete user">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>` : ''}
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.edit-owner-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('[data-member-id]');
                const id = row?.dataset.memberId;
                const owner = owners.find(o => o.id === id);
                if (owner) openMemberModal('owners', owner);
            });
        });
        list.querySelectorAll('.delete-member-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('[data-member-id]');
                const id = row?.dataset.memberId;
                if (!id || !confirm('Delete this user? Their sites and agents will be transferred to you.')) return;
                btn.disabled = true;
                const del = await fetch(`${API_BASE}/auth/users/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
                if (!del.ok) { alert('Could not delete user'); btn.disabled = false; return; }
                loadTeamOwners();
            });
        });
    } catch {
        list.innerHTML = `<div class="members-empty"><p>Could not load users.</p></div>`;
    }
}

// ----- Support Agents -----
async function loadTeamAgents() {
    const list = document.getElementById('agents-list');
    const countEl = document.getElementById('agents-count');
    if (!list) return;
    list.innerHTML = `<div class="members-loading"><svg class="spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.2"/><path d="M12 2a10 10 0 0110 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg> Loading…</div>`;
    try {
        const res = await fetch(`${API_BASE}/auth/agents`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const agents = await res.json();
        if (countEl) countEl.textContent = agents.length;

        // Stats bar
        const statsEl = document.getElementById('agents-stats');
        if (statsEl && agents.length) {
            const allSiteIds = new Set(agents.flatMap(a => a.assigned_site_ids || []));
            statsEl.style.display = '';
            statsEl.innerHTML = `
                <span class="team-panel-stat"><span class="team-panel-stat-num">${agents.length}</span> agent${agents.length !== 1 ? 's' : ''}</span>
                <span class="team-panel-stat-sep"></span>
                <span class="team-panel-stat"><span class="team-panel-stat-num">${allSiteIds.size}</span> site${allSiteIds.size !== 1 ? 's' : ''} covered</span>`;
        } else if (statsEl) {
            statsEl.style.display = 'none';
        }

        if (!agents.length) {
            list.innerHTML = `<div class="members-empty">
                <div class="members-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></div>
                <p>No support agents yet.</p>
                <button type="button" class="btn btn-primary btn-sm" onclick="openMemberModal('agents',null)">Add first agent</button>
            </div>`;
            return;
        }
        // Build site name lookup
        const siteMap = Object.fromEntries((sites || []).map(s => [s.site_id, s.name || s.url || s.site_id]));
        list.innerHTML = agents.map(a => {
            const initials = avatarInitials(a.name);
            const color = avatarColor(a.email);
            const joined = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const siteIds = a.assigned_site_ids || [];
            const siteBadges = siteIds.length
                ? siteIds.map(id => `<span class="member-site-badge" title="${escapeHtml(siteMap[id] || id)}">${escapeHtml(siteMap[id] || id)}</span>`).join('')
                : '<span class="member-no-sites">No sites assigned</span>';
            return `<div class="member-row member-row--agents" data-member-id="${escapeHtml(a.id)}" data-member-type="agent">
                <div class="member-identity">
                    <div class="member-avatar" style="background:${color}">${escapeHtml(initials)}</div>
                    <div class="member-details">
                        <span class="member-name">${escapeHtml(a.name)}</span>
                        <span class="member-email">${escapeHtml(a.email)}</span>
                    </div>
                </div>
                <div class="member-sites-badges">${siteBadges}</div>
                <div class="member-date">${joined}</div>
                <div class="member-actions">
                    <button class="btn btn-ghost btn-sm edit-member-btn" title="Edit agent">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm delete-member-btn" title="Remove agent">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.edit-member-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('[data-member-id]');
                const id = row?.dataset.memberId;
                const agent = agents.find(a => a.id === id);
                if (agent) openMemberModal('agents', agent);
            });
        });
        list.querySelectorAll('.delete-member-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('[data-member-id]');
                const id = row?.dataset.memberId;
                if (!id || !confirm('Remove this agent? They will no longer be able to log in.')) return;
                btn.disabled = true;
                const del = await fetch(`${API_BASE}/auth/agents/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
                if (!del.ok) { alert('Could not remove agent'); btn.disabled = false; return; }
                loadTeamAgents();
            });
        });
    } catch {
        list.innerHTML = `<div class="members-empty"><p>Could not load agents.</p></div>`;
    }
}

// ----- Add / Edit Modal -----
function openMemberModal(type, member) {
    const modal = document.getElementById('member-modal');
    const badge = document.getElementById('member-modal-badge');
    const title = document.getElementById('member-modal-title');
    const sitesGroup = document.getElementById('member-sites-group');
    const emailEl = document.getElementById('member-email');
    const pwd = document.getElementById('member-password');
    const pwdHint = document.getElementById('member-password-hint');

    document.getElementById('member-edit-id').value = member?.id || '';
    document.getElementById('member-type').value = type;
    document.getElementById('member-name').value = member?.name || '';

    if (type === 'owners') {
        badge.textContent = 'Site Owner';
        badge.style.color = 'var(--blue)';
        title.textContent = member ? 'Edit site owner' : 'Add site owner';
        sitesGroup.style.display = 'none';
    } else {
        badge.textContent = 'Support Agent';
        badge.style.color = 'var(--primary)';
        title.textContent = member ? 'Edit support agent' : 'Add support agent';
        sitesGroup.style.display = '';
        renderMemberSiteCheckboxes(member?.assigned_site_ids || []);
    }

    if (member) {
        emailEl.value = member.email || '';
        emailEl.disabled = true;
        pwd.required = false;
        pwd.value = '';
        pwdHint.textContent = 'Leave blank to keep the current password.';
    } else {
        emailEl.value = '';
        emailEl.disabled = false;
        pwd.required = true;
        pwd.value = '';
        pwdHint.textContent = 'Min. 8 characters.';
    }

    const errEl = document.getElementById('member-modal-error');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    modal?.classList.add('active');
    document.getElementById('member-name').focus();
}

function closeMemberModal() {
    document.getElementById('member-modal')?.classList.remove('active');
}

function updateSelectAllLabel() {
    const btn = document.getElementById('sites-select-all-btn');
    if (!btn) return;
    const boxes = document.querySelectorAll('#member-sites-checkboxes input[name="member-site"]');
    if (!boxes.length) return;
    const allChecked = Array.from(boxes).every(b => b.checked);
    btn.textContent = allChecked ? 'Deselect all' : 'Select all';
}

function renderMemberSiteCheckboxes(selectedIds) {
    const wrap = document.getElementById('member-sites-checkboxes');
    if (!wrap) return;
    const selected = new Set(selectedIds || []);
    if (!sites.length) {
        wrap.innerHTML = '<p class="form-hint">Add at least one site first.</p>';
        document.getElementById('sites-select-all-btn')?.style && (document.getElementById('sites-select-all-btn').style.display = 'none');
        return;
    }
    const selectAllBtn = document.getElementById('sites-select-all-btn');
    if (selectAllBtn) selectAllBtn.style.display = '';
    wrap.innerHTML = sites.map(s => {
        const checked = selected.has(s.site_id) ? 'checked' : '';
        return `<label class="agent-site-row">
            <input type="checkbox" name="member-site" value="${escapeHtml(s.site_id)}" ${checked}>
            <span>${escapeHtml(s.name || s.url || s.site_id)}</span>
        </label>`;
    }).join('');
    wrap.querySelectorAll('input[name="member-site"]').forEach(cb => {
        cb.addEventListener('change', updateSelectAllLabel);
    });
    updateSelectAllLabel();
}

function formatMemberApiError(data) {
    if (!data) return 'Save failed. Please try again.';
    const d = data.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
        return d.map(i => {
            if (typeof i === 'object') return i.msg?.replace(/^Value error, /i, '') || '';
            return String(i);
        }).filter(Boolean).join(' ');
    }
    return data.message || 'Save failed. Please try again.';
}

async function submitMemberForm() {
    const editId = document.getElementById('member-edit-id').value;
    const type = document.getElementById('member-type').value;
    const name = document.getElementById('member-name').value.trim();
    const email = document.getElementById('member-email').value.trim();
    const password = document.getElementById('member-password').value;

    const showModalErr = (msg) => {
        const el = document.getElementById('member-modal-error');
        if (el) { el.textContent = msg; el.style.display = ''; }
    };

    if (!name || (!editId && !email)) { showModalErr('Please fill in all required fields.'); return; }
    if (!editId && !password) { showModalErr('Password is required.'); return; }

    const saveBtn = document.getElementById('member-modal-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
        if (type === 'owners') {
            if (editId) {
                const body = { name };
                if (password) body.password = password;
                const res = await fetch(`${API_BASE}/auth/users/${editId}`, {
                    method: 'PATCH',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error(formatMemberApiError(await res.json().catch(() => ({}))));
            } else {
                const res = await fetch(`${API_BASE}/auth/users`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ name, email, password })
                });
                if (!res.ok) throw new Error(formatMemberApiError(await res.json().catch(() => ({}))));
            }
        } else {
            const boxes = document.querySelectorAll('#member-sites-checkboxes input[name="member-site"]:checked');
            const assigned_site_ids = Array.from(boxes).map(b => b.value);
            if (editId) {
                const body = { name, assigned_site_ids };
                if (password) body.password = password;
                const res = await fetch(`${API_BASE}/auth/agents/${editId}`, {
                    method: 'PATCH',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error(formatMemberApiError(await res.json().catch(() => ({}))));
            } else {
                const res = await fetch(`${API_BASE}/auth/agents`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ name, email, password, assigned_site_ids })
                });
                if (!res.ok) throw new Error(formatMemberApiError(await res.json().catch(() => ({}))));
            }
        }
        closeMemberModal();
        loadActiveTab();
    } catch (err) {
        const msg = err.message || 'Save failed. Please try again.';
        const errEl = document.getElementById('member-modal-error');
        if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
        else alert(msg);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
}

// ==================== Scheduled Crawling ====================

let crawlScheduleConfig = null;
let crawlStatusPollInterval = null;

async function loadCrawlSchedule(siteId) {
    if (!siteId) return;
    
    // Initialize handlers for dynamically generated content
    initCrawlingTabHandlers();
    
    try {
        const response = await fetch(`${API_BASE}/sites/${siteId}/crawl-schedule`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load crawl schedule');
        
        const data = await response.json();
        crawlScheduleConfig = data;
        
        populateCrawlScheduleForm(data);
        updateCrawlStatusBanner(data.is_crawling);
        
        if (data.is_crawling) {
            startCrawlStatusPolling(siteId);
        }
        
        await loadCrawlHistory(siteId);
        
    } catch (error) {
        console.error('Failed to load crawl schedule:', error);
    }
}

function initCrawlingTabHandlers() {
    const enabledToggle = document.getElementById('crawl-schedule-enabled');
    if (enabledToggle) {
        enabledToggle.onchange = () => {
            toggleCrawlScheduleOptions(enabledToggle.checked);
        };
    }
    
    const frequencySelect = document.getElementById('crawl-frequency');
    if (frequencySelect) {
        frequencySelect.onchange = () => {
            toggleCustomCronField(frequencySelect.value === 'custom');
        };
    }
    
    const saveBtn = document.getElementById('save-crawl-schedule');
    if (saveBtn) {
        saveBtn.onclick = saveCrawlSchedule;
    }
    
    const crawlNowBtn = document.getElementById('crawl-now-btn');
    if (crawlNowBtn) {
        crawlNowBtn.onclick = triggerCrawlNow;
    }
}

function populateCrawlScheduleForm(data) {
    const schedule = data.schedule || {};
    
    const enabledEl = document.getElementById('crawl-schedule-enabled');
    if (enabledEl) {
        enabledEl.checked = schedule.enabled || false;
        toggleCrawlScheduleOptions(schedule.enabled);
    }
    
    const frequencyEl = document.getElementById('crawl-frequency');
    if (frequencyEl) {
        frequencyEl.value = schedule.frequency || 'weekly';
        toggleCustomCronField(schedule.frequency === 'custom');
    }
    
    const customCronEl = document.getElementById('crawl-custom-cron');
    if (customCronEl) {
        customCronEl.value = schedule.custom_cron || '';
    }
    
    const maxPagesEl = document.getElementById('crawl-max-pages');
    if (maxPagesEl) {
        maxPagesEl.value = schedule.max_pages || 50;
    }
    
    const includeEl = document.getElementById('crawl-include-patterns');
    if (includeEl) {
        includeEl.value = (schedule.include_patterns || []).join('\n');
    }
    
    const excludeEl = document.getElementById('crawl-exclude-patterns');
    if (excludeEl) {
        excludeEl.value = (schedule.exclude_patterns || []).join('\n');
    }
    
    const notifyEl = document.getElementById('crawl-notify');
    if (notifyEl) {
        notifyEl.checked = schedule.notify_on_completion !== false;
    }
    
    const lastCrawlEl = document.getElementById('last-crawl-time');
    if (lastCrawlEl) {
        if (schedule.last_crawl_at) {
            lastCrawlEl.textContent = formatRelativeTime(new Date(schedule.last_crawl_at));
        } else {
            lastCrawlEl.textContent = 'Never';
        }
    }
    
    const nextCrawlEl = document.getElementById('next-crawl-time');
    if (nextCrawlEl) {
        if (schedule.enabled && schedule.next_crawl_at) {
            nextCrawlEl.textContent = formatDateTime(new Date(schedule.next_crawl_at));
        } else {
            nextCrawlEl.textContent = 'Not scheduled';
        }
    }
}

function toggleCrawlScheduleOptions(enabled) {
    const optionsEl = document.getElementById('crawl-schedule-options');
    if (optionsEl) {
        if (enabled) {
            optionsEl.classList.remove('disabled');
        } else {
            optionsEl.classList.add('disabled');
        }
    }
}

function toggleCustomCronField(show) {
    const customGroup = document.getElementById('custom-cron-group');
    if (customGroup) {
        customGroup.style.display = show ? 'block' : 'none';
    }
}

async function saveCrawlSchedule() {
    if (!currentDetailSite) return;
    
    const siteId = currentDetailSite.site_id;
    
    const btn = document.getElementById('save-crawl-schedule');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    
    try {
        const includePatterns = document.getElementById('crawl-include-patterns')?.value
            .split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0) || [];
        
        const excludePatterns = document.getElementById('crawl-exclude-patterns')?.value
            .split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0) || [];
        
        const scheduleConfig = {
            enabled: document.getElementById('crawl-schedule-enabled')?.checked || false,
            frequency: document.getElementById('crawl-frequency')?.value || 'weekly',
            custom_cron: document.getElementById('crawl-custom-cron')?.value || null,
            max_pages: parseInt(document.getElementById('crawl-max-pages')?.value) || 50,
            include_patterns: includePatterns,
            exclude_patterns: excludePatterns,
            notify_on_completion: document.getElementById('crawl-notify')?.checked !== false
        };
        
        const response = await fetch(`${API_BASE}/sites/${siteId}/crawl-schedule`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(scheduleConfig)
        });
        
        if (!response.ok) throw new Error('Failed to save crawl schedule');
        
        const data = await response.json();
        crawlScheduleConfig = data;
        populateCrawlScheduleForm(data);
        
        btn.textContent = 'Saved!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
        
    } catch (error) {
        console.error('Failed to save crawl schedule:', error);
        alert('Failed to save settings. Please try again.');
        btn.textContent = originalText;
    } finally {
        btn.disabled = false;
    }
}

async function triggerCrawlNow() {
    if (!currentDetailSite) return;
    
    const siteId = currentDetailSite.site_id;
    const btn = document.getElementById('crawl-now-btn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<svg class="spinner" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/><path d="M12 2a10 10 0 0110 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg> Starting...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${siteId}/crawl-now`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to start crawl');
        }
        
        const data = await response.json();
        
        updateCrawlStatusBanner(true);
        startCrawlStatusPolling(siteId);
        
        btn.innerHTML = originalHtml;
        
    } catch (error) {
        console.error('Failed to trigger crawl:', error);
        alert(error.message || 'Failed to start crawl. Please try again.');
        btn.innerHTML = originalHtml;
    } finally {
        btn.disabled = false;
    }
}

function updateCrawlStatusBanner(isCrawling, pagesCount = 0) {
    const banner = document.getElementById('crawl-status-banner');
    const pagesEl = document.getElementById('crawl-status-pages');
    const crawlBtn = document.getElementById('crawl-now-btn');
    
    if (banner) {
        banner.style.display = isCrawling ? 'flex' : 'none';
    }
    
    if (pagesEl) {
        pagesEl.textContent = `${pagesCount} pages crawled`;
    }
    
    if (crawlBtn) {
        crawlBtn.disabled = isCrawling;
    }
}

function startCrawlStatusPolling(siteId) {
    if (crawlStatusPollInterval) {
        clearInterval(crawlStatusPollInterval);
    }
    
    crawlStatusPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/sites/${siteId}/crawl-status`, {
                headers: getAuthHeaders()
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            
            if (data.is_crawling) {
                updateCrawlStatusBanner(true, data.pages_crawled || 0);
            } else {
                updateCrawlStatusBanner(false);
                clearInterval(crawlStatusPollInterval);
                crawlStatusPollInterval = null;
                
                await loadCrawlSchedule(siteId);
            }
            
        } catch (error) {
            console.error('Failed to poll crawl status:', error);
        }
    }, 3000);
}

async function loadCrawlHistory(siteId) {
    if (!siteId) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${siteId}/crawl-history?limit=10`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load crawl history');
        
        const data = await response.json();
        renderCrawlHistory(data.history || []);
        
    } catch (error) {
        console.error('Failed to load crawl history:', error);
    }
}

function renderCrawlHistory(history) {
    const tbody = document.getElementById('crawl-history-tbody');
    if (!tbody) return;
    
    if (!history || history.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No crawl history available</td></tr>';
        return;
    }
    
    tbody.innerHTML = history.map(item => {
        const date = item.started_at ? formatDateTime(new Date(item.started_at)) : 'N/A';
        const trigger = item.trigger || 'manual';
        const pages = `${item.pages_crawled || 0} / ${item.pages_indexed || 0}`;
        const status = item.status || 'unknown';
        const duration = item.duration_seconds !== null ? formatDuration(item.duration_seconds) : '-';
        
        return `
            <tr>
                <td>${date}</td>
                <td><span class="crawl-trigger-badge ${trigger}">${trigger}</span></td>
                <td>${pages}</td>
                <td><span class="crawl-status-badge ${status}">${status}</span></td>
                <td>${duration}</td>
            </tr>
        `;
    }).join('');
}

function formatDateTime(date) {
    if (!date || isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(date) {
    if (!date || isNaN(date.getTime())) return 'Never';
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return formatDateTime(date);
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '-';
    
    if (seconds < 60) return `${seconds}s`;
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    if (mins < 60) return `${mins}m ${secs}s`;
    
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
}

function setupCrawlScheduleListeners() {
    const enabledToggle = document.getElementById('crawl-schedule-enabled');
    if (enabledToggle) {
        enabledToggle.addEventListener('change', () => {
            toggleCrawlScheduleOptions(enabledToggle.checked);
        });
    }
    
    const frequencySelect = document.getElementById('crawl-frequency');
    if (frequencySelect) {
        frequencySelect.addEventListener('change', () => {
            toggleCustomCronField(frequencySelect.value === 'custom');
        });
    }
    
    const saveBtn = document.getElementById('save-crawl-schedule');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveCrawlSchedule);
    }
    
    const crawlNowBtn = document.getElementById('crawl-now-btn');
    if (crawlNowBtn) {
        crawlNowBtn.addEventListener('click', triggerCrawlNow);
    }
    
    document.querySelectorAll('.customize-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'crawling' && currentDetailSite) {
                loadCrawlSchedule(currentDetailSite.site_id);
            }
        });
    });
}

function initCrawlScheduleSettings() {
    setupCrawlScheduleListeners();
}

window.loadCrawlSchedule = loadCrawlSchedule;
window.saveCrawlSchedule = saveCrawlSchedule;
window.triggerCrawlNow = triggerCrawlNow;

document.addEventListener('DOMContentLoaded', () => {
    initCrawlScheduleSettings();
});

// ==================== Lead Management ====================

let leadsState = {
    leads: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    search: ''
};

function getLeadsTabContent() {
    const config = currentSiteConfig || {};
    const leadCapture = config.lead_capture || {};
    
    return `
        <div class="leads-tab-content">
            <div class="leads-config-section">
                <h4>Lead Capture Settings</h4>
                <div class="lead-settings-grid">
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="lead-collect-email" ${leadCapture.collect_email ? 'checked' : ''}>
                        <label for="lead-collect-email">Collect Email</label>
                    </div>
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="lead-email-required" ${leadCapture.email_required ? 'checked' : ''}>
                        <label for="lead-email-required">Email Required</label>
                    </div>
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="lead-collect-name" ${leadCapture.collect_name ? 'checked' : ''}>
                        <label for="lead-collect-name">Collect Name</label>
                    </div>
                    <div class="form-group form-checkbox">
                        <input type="checkbox" id="lead-name-required" ${leadCapture.name_required ? 'checked' : ''}>
                        <label for="lead-name-required">Name Required</label>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="lead-prompt">Lead Capture Prompt</label>
                    <input type="text" id="lead-prompt" class="form-input" 
                           value="${leadCapture.email_prompt || 'Enter your email to continue'}" 
                           placeholder="Enter your email to continue">
                </div>
                
                <div class="form-group">
                    <label for="lead-timing">Capture Timing</label>
                    <select id="lead-timing" class="form-select">
                        <option value="before_chat" ${leadCapture.capture_timing === 'before_chat' ? 'selected' : ''}>Before Chat Starts</option>
                        <option value="after_messages" ${leadCapture.capture_timing === 'after_messages' ? 'selected' : ''}>After N Messages</option>
                        <option value="on_handoff" ${leadCapture.capture_timing === 'on_handoff' ? 'selected' : ''}>On Handoff Request</option>
                    </select>
                </div>
                
                <div class="form-group" id="messages-before-capture-group" style="${leadCapture.capture_timing === 'after_messages' ? '' : 'display:none'}">
                    <label for="lead-messages-before">Messages Before Capture</label>
                    <input type="number" id="lead-messages-before" class="form-input" 
                           value="${leadCapture.messages_before_capture || 3}" min="1" max="20">
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-primary btn-sm" id="save-lead-config">Save Settings</button>
                </div>
            </div>
            
            <div class="leads-list-section">
                <div class="leads-header">
                    <h4>Captured Leads</h4>
                    <div class="leads-actions">
                        <div class="search-box search-box-sm">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                            <input type="text" id="leads-search" placeholder="Search leads...">
                        </div>
                        <button class="btn btn-secondary btn-sm" id="export-leads">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Export CSV
                        </button>
                    </div>
                </div>
                
                <div class="leads-table-container">
                    <table class="leads-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Name</th>
                                <th>Captured</th>
                                <th>Source</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="leads-tbody">
                            <tr class="leads-loading">
                                <td colspan="5">
                                    <div class="spinner-sm"></div>
                                    <span>Loading leads...</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div class="leads-pagination" id="leads-pagination">
                    <button class="pagination-btn" id="leads-prev-page" disabled>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"/>
                        </svg>
                    </button>
                    <span class="pagination-info" id="leads-pagination-info">Page 1 of 1</span>
                    <button class="pagination-btn" id="leads-next-page" disabled>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function initLeadsHandlers() {
    const timingSelect = document.getElementById('lead-timing');
    if (timingSelect) {
        timingSelect.addEventListener('change', () => {
            const messagesGroup = document.getElementById('messages-before-capture-group');
            if (messagesGroup) {
                messagesGroup.style.display = timingSelect.value === 'after_messages' ? '' : 'none';
            }
        });
    }
    
    const saveBtn = document.getElementById('save-lead-config');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveLeadConfig);
    }
    
    const searchInput = document.getElementById('leads-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                leadsState.search = searchInput.value;
                leadsState.page = 1;
                loadLeads();
            }, 300);
        });
    }
    
    const exportBtn = document.getElementById('export-leads');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportLeads);
    }
    
    const prevBtn = document.getElementById('leads-prev-page');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (leadsState.page > 1) {
                leadsState.page--;
                loadLeads();
            }
        });
    }
    
    const nextBtn = document.getElementById('leads-next-page');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (leadsState.page < leadsState.totalPages) {
                leadsState.page++;
                loadLeads();
            }
        });
    }
}

async function loadLeads() {
    if (!currentDetailSite) return;
    
    const tbody = document.getElementById('leads-tbody');
    if (tbody) {
        tbody.innerHTML = `
            <tr class="leads-loading">
                <td colspan="5">
                    <div class="spinner-sm"></div>
                    <span>Loading leads...</span>
                </td>
            </tr>
        `;
    }
    
    try {
        const params = new URLSearchParams({
            page: leadsState.page,
            limit: leadsState.limit
        });
        
        if (leadsState.search) {
            params.append('search', leadsState.search);
        }
        
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/leads?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load leads');
        
        const data = await response.json();
        leadsState.leads = data.leads || [];
        leadsState.total = data.total || 0;
        leadsState.totalPages = data.total_pages || 0;
        
        renderLeadsTable();
        updateLeadsPagination();
        
    } catch (error) {
        console.error('Failed to load leads:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr class="leads-empty">
                    <td colspan="5">Failed to load leads</td>
                </tr>
            `;
        }
    }
}

function renderLeadsTable() {
    const tbody = document.getElementById('leads-tbody');
    if (!tbody) return;
    
    if (!leadsState.leads || leadsState.leads.length === 0) {
        tbody.innerHTML = `
            <tr class="leads-empty">
                <td colspan="5">No leads captured yet</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = leadsState.leads.map(lead => {
        const capturedAt = lead.captured_at ? formatRelativeTime(new Date(lead.captured_at)) : 'Unknown';
        const source = lead.source || 'chat';
        
        return `
            <tr data-lead-id="${lead.id}">
                <td>${lead.email || '<span class="text-muted">—</span>'}</td>
                <td>${lead.name || '<span class="text-muted">—</span>'}</td>
                <td>${capturedAt}</td>
                <td><span class="lead-source-badge ${source}">${source}</span></td>
                <td>
                    <button class="btn btn-icon btn-danger-ghost" onclick="deleteLead('${lead.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateLeadsPagination() {
    const prevBtn = document.getElementById('leads-prev-page');
    const nextBtn = document.getElementById('leads-next-page');
    const info = document.getElementById('leads-pagination-info');
    
    if (prevBtn) prevBtn.disabled = leadsState.page <= 1;
    if (nextBtn) nextBtn.disabled = leadsState.page >= leadsState.totalPages;
    if (info) info.textContent = `Page ${leadsState.page} of ${leadsState.totalPages || 1}`;
}

async function saveLeadConfig() {
    if (!currentDetailSite) return;
    
    const btn = document.getElementById('save-lead-config');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    
    try {
        const config = {
            lead_capture: {
                collect_email: document.getElementById('lead-collect-email')?.checked || false,
                email_required: document.getElementById('lead-email-required')?.checked || false,
                email_prompt: document.getElementById('lead-prompt')?.value || 'Enter your email to continue',
                collect_name: document.getElementById('lead-collect-name')?.checked || false,
                name_required: document.getElementById('lead-name-required')?.checked || false,
                capture_timing: document.getElementById('lead-timing')?.value || 'before_chat',
                messages_before_capture: parseInt(document.getElementById('lead-messages-before')?.value) || 3
            }
        };
        
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/config`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(config)
        });
        
        if (!response.ok) throw new Error('Failed to save lead config');
        
        currentSiteConfig = { ...currentSiteConfig, ...config };
        
        btn.textContent = 'Saved!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
        
    } catch (error) {
        console.error('Failed to save lead config:', error);
        alert('Failed to save settings. Please try again.');
        btn.textContent = originalText;
    } finally {
        btn.disabled = false;
    }
}

async function exportLeads() {
    if (!currentDetailSite) return;
    
    const btn = document.getElementById('export-leads');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner-sm"></div> Exporting...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/leads/export`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to export leads');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leads_${currentDetailSite.site_id}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        
    } catch (error) {
        console.error('Failed to export leads:', error);
        alert('Failed to export leads. Please try again.');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

async function deleteLead(leadId) {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/leads/${leadId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to delete lead');
        
        loadLeads();
        
    } catch (error) {
        console.error('Failed to delete lead:', error);
        alert('Failed to delete lead. Please try again.');
    }
}

window.deleteLead = deleteLead;

// ==================== Q&A Training Functions ====================

let qaState = {
    qaPairs: [],
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    search: '',
    editingId: null
};

function setupQAEventListeners() {
    // Q&A Modal
    document.getElementById('close-qa-modal')?.addEventListener('click', closeQAModal);
    document.getElementById('cancel-qa')?.addEventListener('click', closeQAModal);
    document.getElementById('qa-form')?.addEventListener('submit', handleSaveQA);
    
    // Character count for Q&A
    document.getElementById('qa-question')?.addEventListener('input', (e) => {
        document.getElementById('qa-question-count').textContent = e.target.value.length;
    });
    document.getElementById('qa-answer')?.addEventListener('input', (e) => {
        document.getElementById('qa-answer-count').textContent = e.target.value.length;
    });
    
    // Q&A from conversation modal
    document.getElementById('close-qa-conv-modal')?.addEventListener('click', closeQAConvModal);
    document.getElementById('cancel-qa-conv')?.addEventListener('click', closeQAConvModal);
    document.getElementById('qa-conv-form')?.addEventListener('submit', handleSaveQAFromConversation);
    document.getElementById('qa-conv-edited-answer')?.addEventListener('input', (e) => {
        document.getElementById('qa-conv-answer-count').textContent = e.target.value.length;
    });
    
    // Modal backdrop clicks
    document.getElementById('qa-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'qa-modal') closeQAModal();
    });
    document.getElementById('qa-from-conv-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'qa-from-conv-modal') closeQAConvModal();
    });
}

function renderTrainingTab() {
    const container = document.getElementById('detail-tab-content');
    if (!container || !currentDetailSite) return;
    
    container.innerHTML = `
        <div class="tab-form training-tab">
            <!-- Knowledge sources -->
            <div class="config-section knowledge-sources" id="knowledge-sources">
                <div class="config-section-body">
                    <h4 class="knowledge-title">Knowledge Sources</h4>
                    <p class="knowledge-sub">Content the AI uses to answer — webpages, files, text blocks and business info are all indexed for retrieval.</p>

                    <div class="knowledge-block">
                        <div class="knowledge-block-head">
                            <div class="knowledge-block-label">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
                                Webpages
                            </div>
                            <button type="button" class="btn btn-secondary btn-sm" id="knowledge-add-url-btn">+ Add URL</button>
                        </div>
                        <div class="knowledge-add-url-form" id="knowledge-add-url-form" style="display:none">
                            <input type="text" id="knowledge-new-url" class="form-input" placeholder="https://example.com/docs">
                            <input type="number" id="knowledge-new-url-pages" class="form-input" min="1" max="100" value="10" title="Max pages" style="width:80px">
                            <button type="button" class="btn btn-primary btn-sm" id="knowledge-crawl-url-btn">Crawl</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="knowledge-cancel-url-btn">Cancel</button>
                        </div>
                        <div class="knowledge-list" id="knowledge-url-list"><div class="knowledge-empty">Loading…</div></div>
                    </div>

                    <div class="knowledge-block">
                        <div class="knowledge-block-head">
                            <div class="knowledge-block-label">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                Text blocks
                            </div>
                            <button type="button" class="btn btn-secondary btn-sm" id="knowledge-add-text-btn">+ Add text block</button>
                        </div>
                        <div class="knowledge-add-text-form" id="knowledge-add-text-form" style="display:none">
                            <input type="text" id="knowledge-text-title" class="form-input" placeholder="Title (e.g. Return policy)">
                            <textarea id="knowledge-text-content" class="form-textarea" rows="4" placeholder="Paste the text the AI should know…"></textarea>
                            <div class="knowledge-form-actions">
                                <button type="button" class="btn btn-primary btn-sm" id="knowledge-save-text-btn">Save & index</button>
                                <button type="button" class="btn btn-secondary btn-sm" id="knowledge-cancel-text-btn">Cancel</button>
                            </div>
                            <input type="hidden" id="knowledge-text-doc-id" value="">
                        </div>
                        <div class="knowledge-list" id="knowledge-text-list"><div class="knowledge-empty">Loading…</div></div>
                    </div>

                    <div class="knowledge-block">
                        <div class="knowledge-block-head">
                            <div class="knowledge-block-label">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
                                Business information
                            </div>
                            <button type="button" class="btn btn-secondary btn-sm" id="knowledge-save-biz-btn">Save</button>
                        </div>
                        <textarea id="knowledge-biz-content" class="form-textarea" rows="4" placeholder="Company name, contact info, opening hours, policies, pricing — anything the AI should always know about your business."></textarea>
                        <small class="form-help" id="knowledge-biz-status"></small>
                    </div>

                    <div class="knowledge-block">
                        <div class="knowledge-block-head">
                            <div class="knowledge-block-label">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                Files
                            </div>
                            <button type="button" class="btn btn-secondary btn-sm" id="knowledge-add-docs-btn">+ Upload docs</button>
                        </div>
                        <div class="knowledge-list" id="knowledge-files-list"><div class="knowledge-empty">Loading…</div></div>
                    </div>
                </div>
            </div>

            <!-- Q&A Stats -->
            <div class="qa-stats-row" id="qa-stats-row">
                <div class="qa-stat-card primary">
                    <div class="qa-stat-value" id="qa-stat-total">0</div>
                    <div class="qa-stat-label">Total Q&A Pairs</div>
                </div>
                <div class="qa-stat-card">
                    <div class="qa-stat-value" id="qa-stat-enabled">0</div>
                    <div class="qa-stat-label">Active</div>
                </div>
                <div class="qa-stat-card">
                    <div class="qa-stat-value" id="qa-stat-uses">0</div>
                    <div class="qa-stat-label">Total Uses</div>
                </div>
            </div>
            
            <!-- Most Used Q&A -->
            <div class="qa-most-used" id="qa-most-used" style="display: none;">
                <div class="qa-most-used-title">Most Used Q&A Pairs</div>
                <div id="qa-most-used-list"></div>
            </div>
            
            <!-- Q&A Header -->
            <div class="qa-header">
                <h4>Q&A Training Pairs</h4>
                <div class="qa-actions">
                    <button class="btn btn-primary btn-sm" id="add-qa-btn" onclick="openQAModal()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add Q&A
                    </button>
                </div>
            </div>
            
            <!-- Search -->
            <div class="qa-search-wrapper">
                <input type="text" class="qa-search-input" id="qa-search" placeholder="Search Q&A pairs..." oninput="handleQASearch(this.value)">
            </div>
            
            <!-- Q&A List -->
            <div class="qa-list" id="qa-list">
                <div class="qa-list-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <h4>No Q&A pairs yet</h4>
                    <p>Add Q&A pairs to train your chatbot with approved responses</p>
                    <button class="btn btn-primary" onclick="openQAModal()">Create First Q&A</button>
                </div>
            </div>
            
            <!-- Pagination -->
            <div class="qa-pagination" id="qa-pagination" style="display: none;">
                <button class="qa-pagination-btn" id="qa-prev-page" onclick="changeQAPage(-1)" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"/>
                    </svg>
                </button>
                <span class="qa-pagination-info" id="qa-pagination-info">Page 1 of 1</span>
                <button class="qa-pagination-btn" id="qa-next-page" onclick="changeQAPage(1)" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
    
    initKnowledgeHandlers();
    loadKnowledgeSources();
    loadQAStats();
    loadQAPairs();
}

// ==================== Knowledge Sources ====================

let knowledgeDocs = [];

function initKnowledgeHandlers() {
    document.getElementById('knowledge-add-url-btn')?.addEventListener('click', () => {
        document.getElementById('knowledge-add-url-form').style.display = 'flex';
        document.getElementById('knowledge-new-url')?.focus();
    });
    document.getElementById('knowledge-cancel-url-btn')?.addEventListener('click', () => {
        document.getElementById('knowledge-add-url-form').style.display = 'none';
    });
    document.getElementById('knowledge-crawl-url-btn')?.addEventListener('click', addKnowledgeUrl);

    document.getElementById('knowledge-add-text-btn')?.addEventListener('click', () => {
        openTextBlockForm();
    });
    document.getElementById('knowledge-cancel-text-btn')?.addEventListener('click', () => {
        document.getElementById('knowledge-add-text-form').style.display = 'none';
    });
    document.getElementById('knowledge-save-text-btn')?.addEventListener('click', saveTextBlock);

    document.getElementById('knowledge-save-biz-btn')?.addEventListener('click', saveBusinessInfo);
    document.getElementById('knowledge-add-docs-btn')?.addEventListener('click', () => {
        document.getElementById('upload-modal')?.classList.add('active');
    });
}

async function loadKnowledgeSources() {
    if (!currentDetailSite) return;
    loadKnowledgeUrls();
    loadBusinessInfo();
    try {
        const res = await fetch(`${API_BASE}/documents/${currentDetailSite.site_id}`, {
            headers: getAuthHeaders()
        });
        const data = res.ok ? await res.json() : { documents: [] };
        knowledgeDocs = data.documents || [];
        renderKnowledgeLists();
    } catch (e) {
        console.error('Failed to load documents:', e);
        knowledgeDocs = [];
        renderKnowledgeLists();
    }
}

async function loadKnowledgeUrls() {
    const list = document.getElementById('knowledge-url-list');
    if (!list || !currentDetailSite) return;
    try {
        const res = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/knowledge/urls`, {
            headers: getAuthHeaders()
        });
        const data = res.ok ? await res.json() : { urls: [] };
        const urls = [{ url: currentDetailSite.url, primary: true }, ...(data.urls || [])];
        list.innerHTML = urls.map(u => `
            <div class="knowledge-item">
                <div class="knowledge-item-info">
                    <span class="knowledge-item-name">${escapeHtml(u.url)}</span>
                    <span class="knowledge-item-meta">${u.primary ? 'Primary site' : (u.status === 'running' ? 'Crawling…' : `${u.pages_indexed || 0} pages indexed`)}</span>
                </div>
                ${u.primary
                    ? '<span class="knowledge-badge">Site URL</span>'
                    : `<button type="button" class="doc-delete" title="Remove" onclick="deleteKnowledgeUrl('${encodeURIComponent(u.url)}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                       </button>`}
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="knowledge-empty">Could not load URLs</div>';
    }
}

async function addKnowledgeUrl() {
    const input = document.getElementById('knowledge-new-url');
    const pagesInput = document.getElementById('knowledge-new-url-pages');
    const btn = document.getElementById('knowledge-crawl-url-btn');
    const url = (input?.value || '').trim();
    if (!url) { input?.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Crawling…';
    try {
        const res = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/knowledge/urls`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ url, max_pages: parseInt(pagesInput?.value, 10) || 10 })
        });
        if (!res.ok) throw new Error('Failed');
        input.value = '';
        document.getElementById('knowledge-add-url-form').style.display = 'none';
        await loadKnowledgeUrls();
        // Poll once after a delay to refresh status/pages_indexed
        setTimeout(loadKnowledgeUrls, 8000);
    } catch (e) {
        alert('Failed to start crawl for that URL');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Crawl';
    }
}

async function deleteKnowledgeUrl(encodedUrl) {
    if (!currentDetailSite) return;
    const url = decodeURIComponent(encodedUrl);
    if (!confirm(`Remove ${url} and its indexed pages?`)) return;
    try {
        await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/knowledge/urls?url=${encodeURIComponent(url)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        await loadKnowledgeUrls();
    } catch (e) {
        alert('Failed to remove URL');
    }
}
window.deleteKnowledgeUrl = deleteKnowledgeUrl;

function renderKnowledgeLists() {
    const textList = document.getElementById('knowledge-text-list');
    const filesList = document.getElementById('knowledge-files-list');
    const textBlocks = knowledgeDocs.filter(d => d.file_type === 'text_block');
    const files = knowledgeDocs.filter(d => d.file_type !== 'text_block' && d.file_type !== 'business_info');

    if (textList) {
        textList.innerHTML = textBlocks.length ? textBlocks.map(d => `
            <div class="knowledge-item">
                <div class="knowledge-item-info">
                    <span class="knowledge-item-name">${escapeHtml(d.filename)}</span>
                    <span class="knowledge-item-meta">${(d.word_count || 0).toLocaleString()} words · ${d.status === 'indexed' ? 'indexed' : d.status}</span>
                </div>
                <button type="button" class="doc-delete knowledge-edit" title="Edit" onclick="editTextBlock('${d.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button type="button" class="doc-delete" title="Delete" onclick="deleteKnowledgeDoc('${d.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
        `).join('') : '<div class="knowledge-empty">No text blocks yet — add snippets of text the AI should know.</div>';
    }

    if (filesList) {
        filesList.innerHTML = files.length ? files.map(d => `
            <div class="knowledge-item">
                <div class="knowledge-item-info">
                    <span class="knowledge-item-name">${escapeHtml(d.filename)}</span>
                    <span class="knowledge-item-meta">${(d.word_count || 0).toLocaleString()} words · ${d.chunks || 0} chunks · ${d.status}</span>
                </div>
                <button type="button" class="doc-delete" title="Delete" onclick="deleteKnowledgeDoc('${d.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
        `).join('') : '<div class="knowledge-empty">No files uploaded — PDF, DOCX, TXT, MD, CSV supported.</div>';
    }
}

function openTextBlockForm(doc = null) {
    const form = document.getElementById('knowledge-add-text-form');
    form.style.display = 'block';
    document.getElementById('knowledge-text-title').value = doc?.filename || '';
    document.getElementById('knowledge-text-content').value = doc?.content || '';
    document.getElementById('knowledge-text-doc-id').value = doc?.id || '';
    document.getElementById('knowledge-save-text-btn').textContent = doc ? 'Update & re-index' : 'Save & index';
    document.getElementById('knowledge-text-title').focus();
}

function editTextBlock(docId) {
    const doc = knowledgeDocs.find(d => d.id === docId);
    if (doc) openTextBlockForm(doc);
}
window.editTextBlock = editTextBlock;

async function saveTextBlock() {
    const title = document.getElementById('knowledge-text-title').value.trim();
    const content = document.getElementById('knowledge-text-content').value;
    const docId = document.getElementById('knowledge-text-doc-id').value;
    const btn = document.getElementById('knowledge-save-text-btn');
    if (!content.trim()) { alert('Content is required'); return; }
    btn.disabled = true;
    try {
        const res = await fetch(
            docId
                ? `${API_BASE}/documents/text/${currentDetailSite.site_id}/${docId}`
                : `${API_BASE}/documents/text/${currentDetailSite.site_id}`,
            {
                method: docId ? 'PUT' : 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ title, content })
            }
        );
        if (!res.ok) throw new Error('Failed');
        document.getElementById('knowledge-add-text-form').style.display = 'none';
        await loadKnowledgeSources();
    } catch (e) {
        alert('Failed to save text block');
    } finally {
        btn.disabled = false;
    }
}

async function deleteKnowledgeDoc(docId) {
    if (!currentDetailSite || !confirm('Delete this item and remove it from the index?')) return;
    try {
        await fetch(`${API_BASE}/documents/${currentDetailSite.site_id}/${docId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        await loadKnowledgeSources();
    } catch (e) {
        alert('Failed to delete');
    }
}
window.deleteKnowledgeDoc = deleteKnowledgeDoc;

async function loadBusinessInfo() {
    const area = document.getElementById('knowledge-biz-content');
    if (!area || !currentDetailSite) return;
    try {
        const res = await fetch(`${API_BASE}/documents/business-info/${currentDetailSite.site_id}`, {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            area.value = data.content || '';
        }
    } catch (e) { /* ignore */ }
}

async function saveBusinessInfo() {
    const area = document.getElementById('knowledge-biz-content');
    const btn = document.getElementById('knowledge-save-biz-btn');
    const status = document.getElementById('knowledge-biz-status');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        const res = await fetch(`${API_BASE}/documents/business-info/${currentDetailSite.site_id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ content: area.value })
        });
        if (!res.ok) throw new Error('Failed');
        btn.textContent = 'Saved!';
        if (status) status.textContent = 'Indexed for retrieval';
        setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
    } catch (e) {
        if (status) status.textContent = 'Failed to save';
        btn.textContent = 'Save';
        btn.disabled = false;
    }
}

async function loadQAStats() {
    if (!currentDetailSite) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa/stats`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load Q&A stats');
        
        const stats = await response.json();
        
        document.getElementById('qa-stat-total').textContent = stats.total_pairs || 0;
        document.getElementById('qa-stat-enabled').textContent = stats.enabled_pairs || 0;
        document.getElementById('qa-stat-uses').textContent = stats.total_uses || 0;
        
        // Render most used
        if (stats.most_used && stats.most_used.length > 0) {
            const mostUsedContainer = document.getElementById('qa-most-used');
            const mostUsedList = document.getElementById('qa-most-used-list');
            
            mostUsedContainer.style.display = 'block';
            mostUsedList.innerHTML = stats.most_used.map((qa, index) => `
                <div class="qa-most-used-item">
                    <span class="qa-most-used-rank">${index + 1}</span>
                    <span class="qa-most-used-text">${escapeHtml(qa.question)}</span>
                    <span class="qa-most-used-count">${qa.use_count} uses</span>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Failed to load Q&A stats:', error);
    }
}

async function loadQAPairs() {
    if (!currentDetailSite) return;
    
    const listContainer = document.getElementById('qa-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--gray-500);">
            <div class="spinner"></div>
            <span>Loading Q&A pairs...</span>
        </div>
    `;
    
    try {
        const params = new URLSearchParams({
            page: qaState.page,
            limit: qaState.limit
        });
        
        if (qaState.search) {
            params.append('search', qaState.search);
        }
        
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load Q&A pairs');
        
        const data = await response.json();
        qaState.qaPairs = data.qa_pairs || [];
        qaState.total = data.total || 0;
        qaState.totalPages = data.total_pages || 0;
        
        renderQAPairs();
        updateQAPagination();
        
    } catch (error) {
        console.error('Failed to load Q&A pairs:', error);
        listContainer.innerHTML = `
            <div class="qa-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h4>Error loading Q&A pairs</h4>
                <p>Please try again later</p>
            </div>
        `;
    }
}

function renderQAPairs() {
    const listContainer = document.getElementById('qa-list');
    if (!listContainer) return;
    
    if (!qaState.qaPairs || qaState.qaPairs.length === 0) {
        listContainer.innerHTML = `
            <div class="qa-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <h4>No Q&A pairs ${qaState.search ? 'found' : 'yet'}</h4>
                <p>${qaState.search ? 'Try a different search term' : 'Add Q&A pairs to train your chatbot with approved responses'}</p>
                ${!qaState.search ? '<button class="btn btn-primary" onclick="openQAModal()">Create First Q&A</button>' : ''}
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = qaState.qaPairs.map(qa => {
        const timeAgo = formatTimeAgo(new Date(qa.updated_at));
        return `
            <div class="qa-item ${qa.enabled ? '' : 'disabled'}" data-qa-id="${qa.id}">
                <div class="qa-item-header">
                    <div class="qa-question">${escapeHtml(qa.question)}</div>
                    <div class="qa-item-actions">
                        <button class="qa-item-btn edit" onclick="editQAPair('${qa.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="qa-item-btn" onclick="toggleQAPair('${qa.id}')" title="${qa.enabled ? 'Disable' : 'Enable'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${qa.enabled ? 
                                    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' :
                                    '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
                                }
                            </svg>
                        </button>
                        <button class="qa-item-btn delete" onclick="deleteQAPair('${qa.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="qa-answer">${escapeHtml(qa.answer)}</div>
                <div class="qa-item-meta">
                    <span class="qa-meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        ${timeAgo}
                    </span>
                    <span class="qa-meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
                        </svg>
                        ${qa.use_count || 0} uses
                    </span>
                    <span class="qa-status-badge ${qa.enabled ? 'enabled' : 'disabled'}">
                        ${qa.enabled ? 'Active' : 'Disabled'}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

function updateQAPagination() {
    const paginationEl = document.getElementById('qa-pagination');
    const prevBtn = document.getElementById('qa-prev-page');
    const nextBtn = document.getElementById('qa-next-page');
    const infoEl = document.getElementById('qa-pagination-info');
    
    if (qaState.totalPages > 1) {
        paginationEl.style.display = 'flex';
        prevBtn.disabled = qaState.page <= 1;
        nextBtn.disabled = qaState.page >= qaState.totalPages;
        infoEl.textContent = `Page ${qaState.page} of ${qaState.totalPages}`;
    } else {
        paginationEl.style.display = 'none';
    }
}

function changeQAPage(delta) {
    qaState.page += delta;
    loadQAPairs();
}

let qaSearchTimeout = null;
function handleQASearch(value) {
    clearTimeout(qaSearchTimeout);
    qaSearchTimeout = setTimeout(() => {
        qaState.search = value;
        qaState.page = 1;
        loadQAPairs();
    }, 300);
}

function openQAModal(qa = null) {
    const modal = document.getElementById('qa-modal');
    const title = document.getElementById('qa-modal-title');
    const questionInput = document.getElementById('qa-question');
    const answerInput = document.getElementById('qa-answer');
    const idInput = document.getElementById('qa-id');
    
    if (qa) {
        title.textContent = 'Edit Q&A Pair';
        questionInput.value = qa.question || '';
        answerInput.value = qa.answer || '';
        idInput.value = qa.id;
        qaState.editingId = qa.id;
    } else {
        title.textContent = 'Create Q&A Pair';
        questionInput.value = '';
        answerInput.value = '';
        idInput.value = '';
        qaState.editingId = null;
    }
    
    document.getElementById('qa-question-count').textContent = questionInput.value.length;
    document.getElementById('qa-answer-count').textContent = answerInput.value.length;
    
    modal.classList.add('active');
    questionInput.focus();
}

function closeQAModal() {
    document.getElementById('qa-modal').classList.remove('active');
    qaState.editingId = null;
}

async function handleSaveQA(e) {
    e.preventDefault();
    
    if (!currentDetailSite) return;
    
    const question = document.getElementById('qa-question').value.trim();
    const answer = document.getElementById('qa-answer').value.trim();
    const qaId = document.getElementById('qa-id').value;
    
    if (!question || !answer) {
        alert('Please enter both question and answer');
        return;
    }
    
    const saveBtn = document.getElementById('save-qa');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    
    try {
        let response;
        
        if (qaId) {
            // Update existing
            response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa/${qaId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ question, answer })
            });
        } else {
            // Create new
            response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ question, answer })
            });
        }
        
        if (!response.ok) throw new Error('Failed to save Q&A pair');
        
        closeQAModal();
        loadQAStats();
        loadQAPairs();
        
    } catch (error) {
        console.error('Failed to save Q&A pair:', error);
        alert('Failed to save Q&A pair. Please try again.');
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

async function editQAPair(qaId) {
    if (!currentDetailSite) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa/${qaId}`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to fetch Q&A pair');
        
        const qa = await response.json();
        openQAModal(qa);
        
    } catch (error) {
        console.error('Failed to load Q&A pair:', error);
        alert('Failed to load Q&A pair. Please try again.');
    }
}

async function toggleQAPair(qaId) {
    if (!currentDetailSite) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa/${qaId}/toggle`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to toggle Q&A pair');
        
        loadQAStats();
        loadQAPairs();
        
    } catch (error) {
        console.error('Failed to toggle Q&A pair:', error);
        alert('Failed to toggle Q&A pair. Please try again.');
    }
}

async function deleteQAPair(qaId) {
    if (!confirm('Are you sure you want to delete this Q&A pair?')) return;
    
    if (!currentDetailSite) return;
    
    try {
        const response = await fetch(`${API_BASE}/sites/${currentDetailSite.site_id}/qa/${qaId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to delete Q&A pair');
        
        loadQAStats();
        loadQAPairs();
        
    } catch (error) {
        console.error('Failed to delete Q&A pair:', error);
        alert('Failed to delete Q&A pair. Please try again.');
    }
}

// Q&A from Conversation functions
function openQAFromConversationModal(sessionId, messageIndex, question, answer, siteId) {
    const modal = document.getElementById('qa-from-conv-modal');
    
    document.getElementById('qa-conv-question').textContent = question;
    document.getElementById('qa-conv-original-answer').textContent = answer;
    document.getElementById('qa-conv-edited-answer').value = '';
    document.getElementById('qa-conv-session-id').value = sessionId;
    document.getElementById('qa-conv-message-index').value = messageIndex;
    document.getElementById('qa-conv-site-id').value = siteId;
    document.getElementById('qa-conv-answer-count').textContent = '0';
    
    modal.classList.add('active');
}

function closeQAConvModal() {
    document.getElementById('qa-from-conv-modal').classList.remove('active');
}

async function handleSaveQAFromConversation(e) {
    e.preventDefault();
    
    const sessionId = document.getElementById('qa-conv-session-id').value;
    const messageIndex = parseInt(document.getElementById('qa-conv-message-index').value);
    const siteId = document.getElementById('qa-conv-site-id').value;
    const editedAnswer = document.getElementById('qa-conv-edited-answer').value.trim();
    
    if (!sessionId || isNaN(messageIndex) || !siteId) {
        alert('Invalid conversation data');
        return;
    }
    
    const saveBtn = document.getElementById('save-qa-conv');
    const originalHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = '<div class="spinner-sm"></div> Creating...';
    saveBtn.disabled = true;
    
    try {
        const body = {
            session_id: sessionId,
            message_index: messageIndex
        };
        
        if (editedAnswer) {
            body.edited_answer = editedAnswer;
        }
        
        const response = await fetch(`${API_BASE}/sites/${siteId}/qa/from-conversation`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create Q&A pair');
        }
        
        closeQAConvModal();
        alert('Q&A pair created successfully!');
        
        // Refresh conversation view if we're still looking at it
        if (conversationsState.currentConversation === sessionId) {
            loadConversationDetail(sessionId);
        }
        
    } catch (error) {
        console.error('Failed to create Q&A from conversation:', error);
        alert(error.message || 'Failed to create Q&A pair. Please try again.');
    } finally {
        saveBtn.innerHTML = originalHtml;
        saveBtn.disabled = false;
    }
}

// Expose Q&A functions globally
window.openQAModal = openQAModal;
window.editQAPair = editQAPair;
window.toggleQAPair = toggleQAPair;
window.deleteQAPair = deleteQAPair;
window.changeQAPage = changeQAPage;
window.handleQASearch = handleQASearch;
window.openQAFromConversationModal = openQAFromConversationModal;

// Initialize Q&A event listeners
document.addEventListener('DOMContentLoaded', () => {
    setupQAEventListeners();
});


// ==================== PLATFORM (master admin) ====================
let platformPlans = [];

async function initPlatformView() {
    if (!currentUser?.is_master) {
        switchView('sites');
        return;
    }
    bindPlatformUserForm();
    bindPlatformDeletePanel();
    await Promise.all([loadPlatformStats(), loadPlatformUsers(), loadPlatformPlans(), loadLandingConfig()]);
}

async function loadPlatformStats() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    try {
        const [ov, fin] = await Promise.all([
            fetch(`${API_BASE}/platform/overview`, { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : null),
            fetch(`${API_BASE}/platform/finance`, { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : null)
        ]);
        if (ov) {
            set('platform-total-users', ov.total_users ?? 0);
            set('platform-total-sites', ov.total_sites ?? 0);
            set('platform-stripe', ov.stripe_configured ? 'Connected' : 'Not configured');
        }
        if (fin) {
            const mrr = fin.stripe?.configured && fin.stripe?.mrr != null ? fin.stripe.mrr : (fin.estimated_mrr || 0);
            set('platform-mrr', `€${Number(mrr).toFixed(2)}`);
        }
    } catch (e) { /* non-fatal */ }
}

async function loadPlatformUsers() {
    const tbody = document.getElementById('platform-users-body');
    if (!tbody) return;
    try {
        const res = await fetch(`${API_BASE}/platform/users`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        const users = data.users || [];
        platformUsers = users;
        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No users yet.</td></tr>';
            return;
        }
        const planOpts = (sel) => platformPlans
            .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${p.name}</option>`).join('');
        tbody.innerHTML = users.map(u => `
            <tr>
                <td><strong>${escapeHtml(u.name || u.email || '')}</strong><br><small class="muted">${escapeHtml(u.email || '')}</small>
                    ${u.is_active === false ? '<span class="badge badge-off">suspended</span>' : ''}</td>
                <td>${escapeHtml(u.role || '')}${u.is_master ? ' · <em>master</em>' : ''}</td>
                <td><select class="plan-select" data-user="${u.id}" ${u.is_master ? 'disabled' : ''}>${planOpts(u.plan || 'trial')}</select></td>
                <td>${u.site_count ?? 0}</td>
                <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                <td class="platform-user-actions">
                    ${u.is_master ? '' : `<button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">Edit</button>
                    <button class="btn btn-ghost btn-sm" data-del-user="${u.id}">Delete</button>`}
                </td>
            </tr>`).join('');

        tbody.querySelectorAll('.plan-select').forEach(sel => {
            sel.addEventListener('change', () => updateUserPlan(sel.dataset.user, sel.value));
        });
        tbody.querySelectorAll('[data-edit-user]').forEach(b =>
            b.addEventListener('click', () => openUserForm(b.dataset.editUser)));
        tbody.querySelectorAll('[data-del-user]').forEach(b =>
            b.addEventListener('click', () => deletePlatformUser(b.dataset.delUser)));
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Failed to load users.</td></tr>';
    }
}

async function updateUserPlan(userId, plan) {
    try {
        const res = await fetch(`${API_BASE}/platform/users/${userId}/plan`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan })
        });
        if (!res.ok) throw new Error();
        await loadPlatformStats();
    } catch (e) {
        alert('Failed to update plan.');
        loadPlatformUsers();
    }
}

async function loadPlatformPlans() {
    const list = document.getElementById('platform-plans-list');
    if (!list) return;
    try {
        const res = await fetch(`${API_BASE}/platform/plans`, { headers: getAuthHeaders() });
        const data = res.ok ? await res.json() : {};
        platformPlans = data.plans || [];
        list.innerHTML = platformPlans.length ? platformPlans.map(p => `
            <div class="platform-plan-row">
                <div>
                    <strong>${escapeHtml(p.name)}</strong>
                    <span class="muted"> €${p.monthly_eur}/mo${p.yearly_eur ? ` · €${p.yearly_eur}/yr` : ''}</span>
                </div>
                <div class="platform-plan-meta">
                    ${p.stripe_price_monthly ? '<span class="badge badge-ok">stripe linked</span>' : '<span class="badge badge-off">no stripe price</span>'}
                </div>
            </div>
            <p class="settings-card-hint platform-plan-hl">${escapeHtml(p.highlights || '')}</p>`).join('')
            : '<p class="settings-card-hint">No plans defined.</p>';
    } catch (e) {
        platformPlans = [];
        list.innerHTML = '<p class="settings-card-hint">Failed to load plans.</p>';
    }
}

// ---- Platform: landing page config (ads + booking embed) ----
let landingConfigBound = false;
let landingSites = [];

async function loadLandingConfig() {
    try {
        const res = await fetch(`${API_BASE}/platform/landing-config`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const cfg = await res.json();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('landing-ad-1', cfg.ad_slot_1);
        set('landing-ad-2', cfg.ad_slot_2);
        set('landing-booking-embed', cfg.demo_booking_embed);
        await populateLandingSiteSelect(cfg.demo_site_id);
        if (!landingConfigBound) {
            landingConfigBound = true;
            document.getElementById('landing-config-save')?.addEventListener('click', saveLandingConfig);
            document.getElementById('backup-export-btn')?.addEventListener('click', exportBackup);
            document.getElementById('backup-import-btn')?.addEventListener('click', importBackup);
        }
    } catch (e) { /* non-fatal */ }
}

async function populateLandingSiteSelect(selected) {
    const sel = document.getElementById('landing-demo-site');
    if (!sel) return;
    try {
        const res = await fetch(`${API_BASE}/sites`, { headers: getAuthHeaders() });
        const sites = res.ok ? await res.json() : [];
        landingSites = Array.isArray(sites) ? sites : (sites.sites || []);
        sel.innerHTML = '<option value="">Default (SwiftChat demo)</option>' +
            landingSites.map(s => `<option value="${s.site_id}" ${s.site_id === selected ? 'selected' : ''}>${escapeHtml(s.name || s.url || s.site_id)}</option>`).join('');
    } catch (e) {
        sel.innerHTML = '<option value="">Default (SwiftChat demo)</option>';
    }
    const customBtn = document.getElementById('landing-demo-customize');
    if (customBtn && !customBtn.dataset.bound) {
        customBtn.dataset.bound = '1';
        sel.addEventListener('change', () => { customBtn.disabled = !sel.value; });
        customBtn.addEventListener('click', async () => {
            const site = landingSites.find(s => s.site_id === sel.value);
            if (!site) return;
            switchView('sites');
            await openSiteDetails(site);
            activateDetailTab('appearance');
        });
        customBtn.disabled = !sel.value;
    }
}

async function saveLandingConfig() {
    const btn = document.getElementById('landing-config-save');
    const status = document.getElementById('landing-config-status');
    const payload = {
        ad_slot_1: document.getElementById('landing-ad-1')?.value ?? '',
        ad_slot_2: document.getElementById('landing-ad-2')?.value ?? '',
        demo_booking_embed: document.getElementById('landing-booking-embed')?.value ?? '',
        demo_site_id: document.getElementById('landing-demo-site')?.value ?? ''
    };
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        const res = await fetch(`${API_BASE}/platform/landing-config`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error();
        if (status) status.textContent = 'Saved — live on the landing page now.';
    } catch (e) {
        if (status) status.textContent = 'Failed to save landing config.';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save landing config'; }
    }
}

// ---- Platform: user management (add / edit / delete) ----
let platformUsers = [];
let platformUserFormBound = false;

function openUserForm(userId) {
    const form = document.getElementById('platform-user-form');
    if (!form) return;
    const saveBtn = document.getElementById('pu-save');
    const pwHint = document.getElementById('pu-pw-hint');
    const pwInput = document.getElementById('pu-password');
    const planSel = document.getElementById('pu-plan');
    if (planSel && !planSel.options.length) {
        planSel.innerHTML = platformPlans.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
    const u = userId ? platformUsers.find(x => x.id === userId) : null;
    document.getElementById('pu-id').value = u?.id || '';
    document.getElementById('pu-name').value = u?.name || '';
    document.getElementById('pu-email').value = u?.email || '';
    document.getElementById('pu-role').value = u?.role || 'user';
    if (planSel) planSel.value = u?.plan || 'trial';
    pwInput.value = '';
    pwInput.required = !u;
    if (pwHint) pwHint.textContent = u ? '(leave blank to keep)' : '(min 8 chars)';
    const activeGroup = document.getElementById('pu-active-group');
    if (activeGroup) activeGroup.hidden = !u;
    document.getElementById('pu-active').checked = u ? u.is_active !== false : true;
    if (saveBtn) saveBtn.textContent = u ? 'Save changes' : 'Create user';
    form.hidden = false;
    document.getElementById('pu-name')?.focus();
}

function closeUserForm() {
    const form = document.getElementById('platform-user-form');
    if (form) { form.hidden = true; form.reset(); }
    document.getElementById('pu-id').value = '';
}

function bindPlatformUserForm() {
    if (platformUserFormBound) return;
    platformUserFormBound = true;
    document.getElementById('platform-user-add')?.addEventListener('click', () => openUserForm(null));
    document.getElementById('pu-cancel')?.addEventListener('click', closeUserForm);
    document.getElementById('platform-user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('pu-id').value;
        const password = document.getElementById('pu-password').value;
        const payload = {
            name: document.getElementById('pu-name').value.trim(),
            email: document.getElementById('pu-email').value.trim(),
            role: document.getElementById('pu-role').value,
            plan: document.getElementById('pu-plan').value
        };
        if (password) payload.password = password;
        if (id) payload.is_active = document.getElementById('pu-active').checked;
        const saveBtn = document.getElementById('pu-save');
        saveBtn.disabled = true;
        try {
            const res = await fetch(id ? `${API_BASE}/platform/users/${id}` : `${API_BASE}/platform/users`, {
                method: id ? 'PUT' : 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Failed to save user');
            closeUserForm();
            await loadPlatformUsers();
        } catch (err) {
            alert(err.message || 'Failed to save user.');
        } finally {
            saveBtn.disabled = false;
        }
    });
}

function deletePlatformUser(userId) {
    const u = platformUsers.find(x => x.id === userId);
    const panel = document.getElementById('platform-user-delete');
    if (!panel) return;
    document.getElementById('pu-del-text').innerHTML =
        `Delete <strong>${escapeHtml(u?.email || 'this user')}</strong> (${u?.site_count ?? 0} site(s))?` +
        ' Choose whether to keep their sites and agents by moving them to your account, or remove everything:';
    panel.dataset.userId = userId;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let platformDeletePanelBound = false;
function bindPlatformDeletePanel() {
    const panel = document.getElementById('platform-user-delete');
    if (!panel || platformDeletePanelBound) return;
    platformDeletePanelBound = true;
    const hide = () => { panel.hidden = true; delete panel.dataset.userId; };
    document.getElementById('pu-del-cancel')?.addEventListener('click', hide);
    document.getElementById('pu-del-transfer')?.addEventListener('click', () => confirmDeleteUser('transfer'));
    document.getElementById('pu-del-all')?.addEventListener('click', () => {
        if (confirm('Permanently delete this user AND all their sites, agents and data? This cannot be undone.')) {
            confirmDeleteUser('delete');
        }
    });

    async function confirmDeleteUser(mode) {
        const id = panel.dataset.userId;
        if (!id) return;
        try {
            const res = await fetch(`${API_BASE}/platform/users/${id}?mode=${mode}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Delete failed');
            hide();
            await Promise.all([loadPlatformUsers(), loadPlatformStats()]);
        } catch (e) {
            alert(e.message || 'Failed to delete user.');
        }
    }
}


// ---- Backup & Restore (master) ----
async function exportBackup() {
    const st = document.getElementById('backup-status');
    const inc = document.getElementById('backup-include-users')?.checked !== false;
    st.textContent = 'Preparing backup…';
    try {
        const res = await fetch(`${API_BASE}/platform/backup?include_users=${inc}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error((await res.json()).detail || 'Export failed');
        const blob = await res.blob();
        const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'swiftchat-backup.json';
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
        document.body.appendChild(a); a.click(); a.remove();
        st.textContent = `Downloaded ${name}`;
    } catch (e) { st.textContent = e.message; }
}

async function importBackup() {
    const st = document.getElementById('backup-status');
    const file = document.getElementById('backup-file')?.files?.[0];
    if (!file) { st.textContent = 'Choose a backup JSON file first.'; return; }
    let bundle;
    try { bundle = JSON.parse(await file.text()); } catch { st.textContent = 'That file is not valid JSON.'; return; }
    const n = (bundle.sites || []).length;
    if (!confirm(`Import ${n} site(s)? Existing sites with the same ID will be overwritten.`)) return;
    st.textContent = 'Importing…';
    try {
        const res = await fetch(`${API_BASE}/platform/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ bundle, recrawl: document.getElementById('backup-recrawl')?.checked !== false })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Import failed');
        st.textContent = `Imported ${data.sites} site(s), ${data.related} related records, ${data.users_created} new user(s); ${data.recrawl_queued} re-crawl(s) queued.`;
        if (typeof loadSites === 'function') loadSites();
    } catch (e) { st.textContent = e.message; }
}
