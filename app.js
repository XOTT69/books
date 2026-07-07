// ===== CONSTANTS =====
const PLACEHOLDER_IMG = 'https://via.placeholder.com/128x192/f1f5f9/94a3b8?text=No+Cover';
const firebaseConfig = {
    apiKey: "AIzaSyAXgYW2_9ofKCvLoQFT6oMz0bCvbvldPGg",
    authDomain: "chitayko-pwa.firebaseapp.com",
    projectId: "chitayko-pwa",
    storageBucket: "chitayko-pwa.firebasestorage.app",
    messagingSenderId: "278531514478",
    appId: "1:278531514478:web:731dad47437f6aae2b067f",
    measurementId: "G-1JN4FBQ13K"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(), db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.log('Persistence:', e.code));

// ===== STATE =====
let currentUser = null, myLibrary = [], tempSelectedBook = null, timeoutId = null;
let currentLibraryTab = 'reading', viewMode = localStorage.getItem('viewMode') || 'list';
let rendition = null, currentReaderBookId = null, currentBookInstance = null;
let readerTheme = localStorage.getItem('readerTheme') || 'light';
let readerFontSize = parseInt(localStorage.getItem('readerFontSize')) || 100;
let readerMargin = localStorage.getItem('readerMargin') || 'normal';
let readingTimer = null, readingStartTime = 0, currentSessionSeconds = 0;
let recStartIndex = 0, currentRecQueries = [], currentRecQueryIndex = 0;
let isFetchingRecs = false, currentRecCategory = null;
let shownRecTitles = new Set(), libraryFilterQuery = '', readerDepsLoaded = false;
let html5QrCode = null, currentTab = 'library';

// ===== TOAST =====
function showToast(msg, duration = 2500) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW:', e));
    }

    // Bottom sheet drag-to-close
    document.querySelectorAll('.bottom-sheet').forEach(sheet => {
        let startY = 0, currentY = 0, isDragging = false;
        sheet.addEventListener('touchstart', e => {
            const sc = sheet.querySelector('.overflow-y-auto');
            if (!sc || sc.scrollTop <= 0 || e.target.closest('.drag-handle')) {
                startY = e.touches[0].clientY;
                isDragging = true;
                sheet.style.transition = 'none';
            }
        }, { passive: true });
        sheet.addEventListener('touchmove', e => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const d = currentY - startY;
            if (d > 0) sheet.style.transform = `translateY(${d}px)`;
        }, { passive: true });
        sheet.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            sheet.style.transition = 'transform .35s cubic-bezier(.32,.72,0,1)';
            if (currentY - startY > 100) {
                if (sheet.id === 'detailsSheet') closeDetailsSheet();
                else closeAllSheets();
            }
            sheet.style.transform = '';
        });
    });

    // Infinite scroll for recommendations
    const ro = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && currentTab === 'discover' && !isFetchingRecs && currentRecQueries.length > 0) {
            fetchMoreRecommendations();
        }
    }, { rootMargin: '300px' });
    const st = document.getElementById('recScrollTarget');
    if (st) ro.observe(st);

    // Offline/Online detection
    window.addEventListener('online', () => {
        document.getElementById('offlineBanner')?.classList.remove('show');
    });
    window.addEventListener('offline', () => {
        document.getElementById('offlineBanner')?.classList.add('show');
    });

    // Library search
    const libSearch = document.getElementById('librarySearchInput');
    if (libSearch) {
        libSearch.addEventListener('input', e => onLibrarySearch(e.target.value));
    }

    // Theme init
    if (localStorage.getItem('appTheme') === 'dark') {
        document.body.classList.add('dark');
        const tl = document.getElementById('themeLabel');
        if (tl) tl.textContent = 'Темна';
    }

    updateViewButtons();
    updateGoalWidget();
});

// ===== THEME =====
function toggleAppTheme() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('appTheme', isDark ? 'dark' : 'light');
    const tl = document.getElementById('themeLabel');
    if (tl) tl.textContent = isDark ? 'Темна' : 'Світла';
}

// ===== TABS =====
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(b => { b.classList.remove('active'); b.classList.add('opacity-50'); });

    const tabMap = { library: 'tabLibrary', discover: 'tabDiscover', highlights: 'tabHighlights', profile: 'tabProfile' };
    const el = document.getElementById(tabMap[tab]);
    if (!el) return;
    el.classList.add('active');
    el.classList.remove('fade-up');
    void el.offsetWidth;
    el.classList.add('fade-up');

    const btns = document.querySelectorAll('.nav-tab');
    const idx = { library: 0, discover: 1, highlights: 2, profile: 3 }[tab];
    if (btns[idx]) { btns[idx].classList.add('active'); btns[idx].classList.remove('opacity-50'); }

    if (tab === 'profile') { calculateStats(); updateStreakWidget(); updateGoalWidget(); }
    if (tab === 'discover' && !currentRecCategory) loadRealRecommendations('auto', 'rec_auto');
    if (tab === 'highlights') renderHighlights();
    if (tab === 'library') {
        const sub = document.getElementById('libSubtitle');
        if (sub) sub.textContent = `${myLibrary.length} книг у бібліотеці`;
    }
}

// ===== VIEW =====
function setViewMode(m) { viewMode = m; localStorage.setItem('viewMode', m); updateViewButtons(); render(); }
function updateViewButtons() {
    const listBtn = document.getElementById('view_list');
    const gridBtn = document.getElementById('view_grid');
    if (!listBtn || !gridBtn) return;
    if (viewMode === 'list') {
        listBtn.classList.add('active'); gridBtn.classList.remove('active');
    } else {
        gridBtn.classList.add('active'); listBtn.classList.remove('active');
    }
}

// ===== WELCOME =====
function dismissWelcome() {
    localStorage.setItem('welcomeSeen', '1');
    const ws = document.getElementById('welcomeScreen');
    if (ws) ws.classList.add('hidden');
}

// ===== GOAL =====
function saveGoal(v) {
    const g = parseInt(v) || 12;
    if (currentUser) db.collection('users').doc(currentUser.uid).set({ readingGoal: g }, { merge: true });
    localStorage.setItem('readingGoal', g);
    updateGoalWidget();
}
function updateGoalWidget() {
    const g = parseInt(localStorage.getItem('readingGoal')) || 12;
    const y = new Date().getFullYear();
    const f = myLibrary.filter(b => {
        if (b.status !== 'finished') return false;
        try { return b.dateFinished && b.dateFinished.startsWith(String(y)); } catch (e) { return false; }
    }).length;
    const p = Math.min(100, Math.round((f / g) * 100));
    const goalYear = document.getElementById('goalYear');
    const goalProgress = document.getElementById('goalProgress');
    const goalBar = document.getElementById('goalBar');
    const goalInput = document.getElementById('goalInput');
    const goalEmoji = document.getElementById('goalEmoji');
    if (goalYear) goalYear.textContent = y;
    if (goalProgress) goalProgress.textContent = `${f}/${g}`;
    if (goalBar) goalBar.style.width = p + '%';
    if (goalInput) goalInput.value = g;
    if (goalEmoji) goalEmoji.textContent = p >= 100 ? '🏆' : p >= 50 ? '🔥' : '📖';
}

// ===== STREAK =====
async function updateStreakWidget() {
    if (!currentUser) return;
    const days = [], today = new Date();
    for (let i = 20; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
    let rd = new Set();
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('readingDays')
            .where(firebase.firestore.FieldPath.documentId(), '>=', days[0])
            .where(firebase.firestore.FieldPath.documentId(), '<=', days[days.length - 1]).get();
        snap.forEach(doc => rd.add(doc.id));
    } catch (e) { }
    let streak = 0;
    const ts = today.toISOString().slice(0, 10);
    let cd = new Date(today);
    if (!rd.has(ts)) cd.setDate(cd.getDate() - 1);
    while (true) { const ds = cd.toISOString().slice(0, 10); if (rd.has(ds)) { streak++; cd.setDate(cd.getDate() - 1); } else break; }
    const streakCount = document.getElementById('streakCount');
    const streakDots = document.getElementById('streakDots');
    if (streakCount) streakCount.textContent = `${streak} ${streak === 1 ? 'день' : streak < 5 ? 'дні' : 'днів'}`;
    if (streakDots) streakDots.innerHTML = days.map(d => `<div class="streak-dot ${rd.has(d) ? 'active' : 'inactive'} ${d === ts ? 'ring-2 ring-primary-300 ring-offset-1' : ''}" title="${d}"></div>`).join('');
}
async function markReadingDay() {
    if (!currentUser) return;
    const t = new Date().toISOString().slice(0, 10);
    try { await db.collection('users').doc(currentUser.uid).collection('readingDays').doc(t).set({ minutes: Math.round(currentSessionSeconds / 60), timestamp: Date.now() }, { merge: true }); } catch (e) { }
}

// ===== CELEBRATION =====
function showCelebration() {
    const el = document.getElementById('celebration');
    if (!el) return;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 1500);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

// ===== QUICK RESUME =====
function renderQuickResume() {
    const qr = document.getElementById('quickResume');
    if (!qr) return;
    const lastRead = myLibrary.filter(b => b.status === 'reading' && b.lastCfi).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (!lastRead) { qr.classList.add('hidden'); return; }
    const pct = Math.round((lastRead.pagesRead / (lastRead.pagesTotal || 300)) * 100) || 0;
    qr.classList.remove('hidden');
    qr.innerHTML = `<div class="resume-card p-4 flex items-center gap-3" onclick="readSavedEpub('${lastRead.id}')">
        <img src="${lastRead.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-10 h-14 rounded-xl object-cover" style="box-shadow:0 3px 10px rgba(0,0,0,.1);flex-shrink:0">
        <div class="flex-1 min-w-0">
            <p class="micro text-primary-600 mb-0.5">Продовжити</p>
            <p class="font-bold text-[15px] line-clamp-1">${escapeHtml(lastRead.title)}</p>
            <div class="flex items-center gap-2 mt-1.5">
                <div class="flex-1 progress-track h-1.5"><div class="progress-fill h-full" style="width:${pct}%"></div></div>
                <span class="micro text-primary-600">${pct}%</span>
            </div>
        </div>
        <div class="w-10 h-10 rounded-full text-white flex items-center justify-center text-lg shrink-0" style="background:linear-gradient(135deg,#6366f1,#4f46e5);box-shadow:0 4px 12px rgba(99,102,241,.35)">▶</div>
    </div>`;
}

// ===== HTML ESCAPE (безпечне виведення) =====
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== STATS =====
async function calculateStats() {
    await loadChartJS();
    const fin = myLibrary.filter(b => b.status === 'finished');
    const tp = fin.reduce((s, b) => s + (parseInt(b.pagesTotal) || 0), 0);
    const tt = myLibrary.reduce((s, b) => s + (b.timeSpent || 0), 0);
    const statBooks = document.getElementById('statBooks');
    const statPages = document.getElementById('statPages');
    const statTime = document.getElementById('statTime');
    if (statBooks) statBooks.textContent = fin.length;
    if (statPages) statPages.textContent = tp > 999 ? (tp / 1000).toFixed(1) + 'k' : tp;
    if (statTime) statTime.textContent = Math.round(tt / 3600) + 'г';

    const ctx = document.getElementById('statsChart');
    if (!ctx) return;
    const months = {};
    fin.forEach(b => {
        if (b.dateFinished && typeof b.dateFinished === 'string' && b.dateFinished.length >= 7) {
            const m = b.dateFinished.substring(0, 7);
            months[m] = (months[m] || 0) + 1;
        }
    });
    const labels = Object.keys(months).sort().slice(-8);
    const data = labels.map(l => months[l]);
    if (window.myChart) window.myChart.destroy();
    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels.map(l => l.slice(5)), datasets: [{ data, backgroundColor: '#6366f1', borderRadius: 8, barThickness: 20 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.04)' } }, x: { grid: { display: false } } } }
    });

    // Avg per month label
    const avg = document.getElementById('avgPerMonth');
    if (avg && labels.length > 0) {
        const total = data.reduce((s, v) => s + v, 0);
        avg.textContent = `~${(total / labels.length).toFixed(1)} на міс.`;
    }

    // Achievements
    renderAchievements(fin.length, tt);
}

// ===== ACHIEVEMENTS =====
const ACHIEVEMENTS = [
    { id: 'first', icon: '📖', label: 'Перша книга', check: (n) => n >= 1 },
    { id: 'five', icon: '🌟', label: '5 книг', check: (n) => n >= 5 },
    { id: 'ten', icon: '🔥', label: '10 книг', check: (n) => n >= 10 },
    { id: 'twenty', icon: '💎', label: '25 книг', check: (n) => n >= 25 },
    { id: 'fifty', icon: '🏆', label: '50 книг', check: (n) => n >= 50 },
    { id: 'hundred', icon: '👑', label: '100 книг', check: (n) => n >= 100 },
    { id: 'hour', icon: '⏰', label: '10 годин', check: (n, t) => t >= 36000 },
    { id: 'day', icon: '📅', label: '24 години', check: (n, t) => t >= 86400 },
];
function renderAchievements(booksCount, totalSeconds) {
    const list = document.getElementById('achievementsList');
    if (!list) return;
    const unlocked = ACHIEVEMENTS.filter(a => a.check(booksCount, totalSeconds)).length;
    const prog = document.getElementById('achievementProgress');
    if (prog) prog.textContent = `${unlocked}/${ACHIEVEMENTS.length}`;
    list.innerHTML = ACHIEVEMENTS.map(a => {
        const ok = a.check(booksCount, totalSeconds);
        return `<div class="achievement-card ${ok ? '' : 'locked'}" title="${a.label}">
            <div class="text-2xl">${a.icon}</div>
            <div class="text-[9px] font-bold mt-1 text-muted leading-tight">${a.label}</div>
        </div>`;
    }).join('');
}

// ===== HIGHLIGHTS =====
function renderHighlights() {
    const list = document.getElementById('highlightsList');
    const noHL = document.getElementById('noHighlights');
    const countEl = document.getElementById('highlightCount');
    if (!list) return;
    const all = [];
    myLibrary.forEach(b => { (b.highlights || []).forEach(h => all.push({ ...h, bookTitle: b.title, bookId: b.id })); });
    all.sort((a, b) => (b.date || 0) - (a.date || 0));
    if (countEl) countEl.textContent = all.length;
    if (all.length === 0) {
        list.innerHTML = '';
        if (noHL) noHL.classList.remove('hidden');
        return;
    }
    if (noHL) noHL.classList.add('hidden');
    list.innerHTML = all.map((h, i) => `
        <div class="highlight-card">
            <p class="text-sm italic leading-relaxed mb-2">"${escapeHtml(h.text)}"</p>
            <div class="flex justify-between items-center">
                <span class="text-[10px] font-bold text-amber-700">${escapeHtml(h.bookTitle)}</span>
                <span class="text-[10px] text-muted">${h.date ? new Date(h.date).toLocaleDateString('uk') : ''}</span>
            </div>
        </div>`).join('');
}

// ===== NOTIFICATIONS =====
function showNotificationSettings() {
    if (!('Notification' in window)) { showToast('Сповіщення не підтримуються'); return; }
    if (Notification.permission === 'granted') {
        showToast('🔔 Сповіщення вже дозволені');
    } else if (Notification.permission === 'denied') {
        showToast('❌ Сповіщення заблоковані в налаштуваннях браузера');
    } else {
        Notification.requestPermission().then(p => {
            showToast(p === 'granted' ? '✅ Сповіщення увімкнено!' : 'Сповіщення не дозволені');
            const nl = document.getElementById('notifLabel');
            if (nl) nl.textContent = p === 'granted' ? 'Увімкнено' : 'Вимкнено';
        });
    }
}

// ===== EXPORT/IMPORT =====
function exportLibrary() {
    if (myLibrary.length === 0) { showToast('Бібліотека порожня!'); return; }
    const d = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(myLibrary, null, 2));
    const a = document.createElement('a');
    a.href = d;
    a.download = `chitayko_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('📥 Експортовано!');
}
function importLibrary() {
    if (!currentUser) { showToast('Потрібна авторизація'); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
            const t = await f.text(), books = JSON.parse(t);
            if (!Array.isArray(books)) throw new Error('Невірний формат');
            if (!confirm(`Імпортувати ${books.length} книг?`)) return;
            const ex = new Set(myLibrary.map(b => (b.title || '').toLowerCase().trim()));
            let imp = 0;
            const batch = db.batch();
            books.forEach(book => {
                const ti = (book.title || '').toLowerCase().trim();
                if (ex.has(ti)) return;
                const ref = db.collection('users').doc(currentUser.uid).collection('books').doc();
                const c = { ...book };
                delete c.id;
                if (!c.dateAdded) c.dateAdded = Date.now();
                batch.set(ref, c);
                imp++;
            });
            await batch.commit();
            showToast(`✅ Імпортовано ${imp} книг!`);
        } catch (err) { showToast('Помилка: ' + err.message); }
    };
    inp.click();
}
function clearAppCache() {
    if ('caches' in window) caches.keys().then(n => { for (let x of n) caches.delete(x); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(r => { for (let x of r) x.unregister(); });
    showToast('🔄 Кеш очищено!');
    setTimeout(() => window.location.reload(true), 800);
}

// ===== AUTH =====
auth.onAuthStateChanged(async user => {
    const as = document.getElementById('authScreen'), ap = document.getElementById('appScreen');
    if (user) {
        currentUser = user;
        as.classList.add('hidden'); as.classList.remove('flex');
        ap.classList.remove('hidden');
        document.getElementById('mainBottomNav')?.classList.remove('hidden');
        const pn = document.getElementById('profileName');
        const pe = document.getElementById('profileEmail');
        const pj = document.getElementById('profileJoined');
        if (pn) pn.textContent = user.displayName || user.email?.split('@')[0] || 'Читач';
        if (pe) pe.textContent = user.email || '';
        if (pj && user.metadata?.creationTime) pj.textContent = 'З ' + new Date(user.metadata.creationTime).toLocaleDateString('uk');
        updateViewButtons();
        const tl = document.getElementById('themeLabel');
        if (tl) tl.textContent = document.body.classList.contains('dark') ? 'Темна' : 'Світла';
        try {
            const ud = await db.collection('users').doc(user.uid).get();
            if (ud.exists && ud.data().readingGoal) localStorage.setItem('readingGoal', ud.data().readingGoal);
        } catch (e) { }
        // Welcome screen for new users
        if (!localStorage.getItem('welcomeSeen')) {
            const ws = document.getElementById('welcomeScreen');
            if (ws) ws.classList.remove('hidden');
        }
        loadLibrary();
    } else {
        currentUser = null; myLibrary = [];
        as.classList.remove('hidden'); as.classList.add('flex');
        ap.classList.add('hidden');
        document.getElementById('mainBottomNav')?.classList.add('hidden');
    }
});

function showErrorMsg(m) {
    const e = document.getElementById('authError');
    if (!e) return;
    e.textContent = m;
    e.classList.remove('hidden');
    setTimeout(() => e.classList.add('hidden'), 6000);
}
async function handleAuth(type, btn) {
    const ot = btn.textContent; btn.textContent = "...";
    const em = document.getElementById('authEmail').value.trim();
    const pw = document.getElementById('authPassword').value;
    if (em.length < 5 || pw.length < 6) { btn.textContent = ot; return showErrorMsg("Email + пароль (мін. 6 символів)"); }
    try {
        if (type === 'login') await auth.signInWithEmailAndPassword(em, pw);
        else await auth.createUserWithEmailAndPassword(em, pw);
    } catch (er) { showErrorMsg(er.message); } finally { btn.textContent = ot; }
}
async function signInWithGoogle(btn) {
    const oh = btn.innerHTML; btn.textContent = "...";
    const p = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(p); } catch (er) {
        if (er.code === 'auth/popup-blocked') await auth.signInWithRedirect(p);
        else { showErrorMsg(er.message); btn.innerHTML = oh; }
    }
}
function logout() { auth.signOut(); closeAllSheets(); }

// ===== LIBRARY =====
function loadLibrary() {
    localforage.getItem('library_cache_' + currentUser.uid).then(c => {
        if (c && myLibrary.length === 0) { myLibrary = c; render(); updateGoalWidget(); renderQuickResume(); updateLibSubtitle(); }
    });
    db.collection('users').doc(currentUser.uid).collection('books').orderBy('dateAdded', 'desc').onSnapshot(snap => {
        myLibrary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        localforage.setItem('library_cache_' + currentUser.uid, myLibrary);
        render(); updateGoalWidget(); renderQuickResume(); updateLibSubtitle();
        if (currentTab === 'highlights') renderHighlights();
    });
}
function updateLibSubtitle() {
    const sub = document.getElementById('libSubtitle');
    if (sub) sub.textContent = `${myLibrary.length} книг у бібліотеці`;
}
async function updateBookInFirestore(id, u) {
    if (currentUser) await db.collection('users').doc(currentUser.uid).collection('books').doc(id).update({ ...u, updatedAt: Date.now() });
}
function onLibrarySearch(q) { libraryFilterQuery = q.toLowerCase().trim(); render(); }

// ===== SHEETS =====
function openSheet(id) {
    document.body.classList.add('modal-open');
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.remove('hidden'); // CSS handles visibility via body.modal-open
}
function closeAllSheets() {
    document.body.classList.remove('modal-open');
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.remove('hidden'); // CSS handles visibility via body.modal-open
    toggleEditMode(false);
}
function closeDetailsSheet() {
    const sb = document.getElementById('statusButtons');
    if (sb && !sb.classList.contains('hidden')) openSheet('searchSheet');
    else closeAllSheets();
}

// ===== SCANNER =====
async function openScanner() {
    await loadScannerLib();
    document.getElementById('scannerSheet').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 },
        (t) => {
            if (navigator.vibrate) navigator.vibrate(100);
            closeScanner();
            const si = document.getElementById('searchInput');
            si.value = t;
            si.dispatchEvent(new Event('input'));
        },
        () => { }
    ).catch(er => { showToast("Камера: " + er); closeScanner(); });
}
function closeScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => { html5QrCode.clear(); html5QrCode = null; }).catch(e => console.log(e));
    }
    document.getElementById('scannerSheet').classList.add('hidden');
}

// ===== SEARCH =====
const searchInputEl = document.getElementById('searchInput');
const searchItemsEl = document.getElementById('searchItems');

function isEnglishTitle(t) {
    if (!t) return true;
    const l = t.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);
    if (!l) return false;
    const e = t.match(/[a-zA-Z]/g);
    return (e && e.length > (l.length * 0.4));
}
function isCyrillic(s) { return /[а-яА-ЯіІїЇєЄґҐ]/.test(s); }

if (searchInputEl) {
    searchInputEl.addEventListener('input', e => {
        clearTimeout(timeoutId);
        const query = e.target.value.trim();
        if (query.length < 2) { searchItemsEl.innerHTML = ''; return; }
        searchItemsEl.innerHTML = '<div class="p-8 text-muted text-sm text-center animate-pulse">Шукаю...</div>';
        timeoutId = setTimeout(async () => {
            try {
                let allItems = [];
                const isAuth = query.startsWith('author:"') && query.endsWith('"');
                const raw = isAuth ? query.slice(8, -1) : query;
                const sq = encodeURIComponent(raw);
                const sqq = encodeURIComponent('"' + raw + '"');
                let pr = [];
                const isIsbn = /^[0-9-]{10,17}$/.test(raw);
                const GKEY = 'AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME';
                if (isIsbn) {
                    const ci = raw.replace(/[^0-9]/g, '');
                    pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${ci}&key=${GKEY}`).catch(() => ({ ok: false })));
                    pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=${ci}&key=${GKEY}`).catch(() => ({ ok: false })));
                    pr.push(fetch(`https://itunes.apple.com/search?term=${ci}&entity=ebook&country=ua&limit=5`).catch(() => ({ ok: false })));
                } else if (isAuth) {
                    pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=${GKEY}&q=inauthor:${sqq}&printType=books&maxResults=40`).catch(() => ({ ok: false })));
                    pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=${GKEY}&q=${sqq}&printType=books&maxResults=40`).catch(() => ({ ok: false })));
                    pr.push(fetch(`https://itunes.apple.com/search?term=${sq}&entity=ebook&attribute=authorTerm&country=ua&limit=30`).catch(() => ({ ok: false })));
                } else {
                    pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=${GKEY}&q=intitle:${sqq}&printType=books&maxResults=20`).catch(() => ({ ok: false })));
                    pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=${GKEY}&q=${sq}&printType=books&maxResults=20`).catch(() => ({ ok: false })));
                    pr.push(fetch(`https://itunes.apple.com/search?term=${sq}&entity=ebook&country=ua&limit=25`).catch(() => ({ ok: false })));
                }
                const res = await Promise.all(pr);
                for (let i = 0; i < res.length - 1; i++) {
                    if (res[i] && res[i].ok) { const d = await res[i].json(); if (d.items) allItems.push(...d.items); }
                }
                const ar = res[res.length - 1];
                if (ar && ar.ok) {
                    const da = await ar.json();
                    if (da.results) da.results.forEach(bk => {
                        allItems.push({ id: 'apple_' + bk.trackId, volumeInfo: { title: bk.trackName, authors: [bk.artistName || 'Невідомий'], pageCount: 300, description: bk.description ? bk.description.replace(/(<([^>]+)>)/gi, '') : '', publishedDate: bk.releaseDate ? bk.releaseDate.substring(0, 4) : '', imageLinks: { thumbnail: bk.artworkUrl100 ? bk.artworkUrl100.replace('100x100bb', '400x400bb') : null }, categories: bk.genres || [] } });
                    });
                }
                if (allItems.length === 0) return searchItemsEl.innerHTML = '<div class="p-8 text-muted text-sm text-center">Не знайдено 😔</div>';
                const ui = []; const sk = new Set();
                allItems.forEach(it => {
                    const b = it.volumeInfo;
                    if (!b || !b.title) return;
                    const k = (b.title.toLowerCase() + (b.authors ? b.authors[0].toLowerCase() : '')).replace(/[^a-zа-я0-9ієї]/gi, '');
                    if (!sk.has(k)) { sk.add(k); ui.push(it); }
                });
                const bc = ['Science', 'Technology', 'Computers', 'Medical', 'Law', 'Business & Economics', 'Mathematics', 'Education', 'Study Aids', 'Religion'];
                let fi = ui.filter(it => {
                    const b = it.volumeInfo;
                    if (!b || !b.title) return false;
                    if (isAuth) return (b.authors || []).join(' ').toLowerCase().includes(raw.toLowerCase());
                    const ex = b.title.toLowerCase().includes(raw.toLowerCase());
                    if (!isIsbn && !ex && b.categories && b.categories.some(c => bc.includes(c))) return false;
                    return true;
                });
                if (isAuth) fi.sort((a, b) => (a.volumeInfo.publishedDate || '9999').localeCompare(b.volumeInfo.publishedDate || '9999'));
                else fi.sort((a, b) => {
                    const tA = (a.volumeInfo.title || '').toLowerCase(), tB = (b.volumeInfo.title || '').toLowerCase(), ql = raw.toLowerCase();
                    if (tA === ql && tB !== ql) return -1;
                    if (tA !== ql && tB === ql) return 1;
                    if (tA.startsWith(ql) && !tB.startsWith(ql)) return -1;
                    if (!tA.startsWith(ql) && tB.startsWith(ql)) return 1;
                    return 0;
                });
                fi = fi.slice(0, 30);
                if (fi.length === 0) return searchItemsEl.innerHTML = '<div class="p-8 text-muted text-sm text-center">Не знайдено 😔</div>';
                searchItemsEl.innerHTML = '';
                fi.forEach(it => {
                    const b = it.volumeInfo;
                    const div = document.createElement('div');
                    const si = (b.imageLinks?.thumbnail || PLACEHOLDER_IMG).replace(/^http:\/\//i, 'https://');
                    const bk = {
                        googleId: it.id || Math.random().toString(),
                        title: b.title || 'Без назви',
                        author: b.authors ? b.authors[0] : 'Невідомий',
                        pagesTotal: b.pageCount || 300,
                        image: si,
                        description: b.description || '',
                        genre: (b.categories && b.categories[0]) || '',
                        publishedDate: b.publishedDate || ''
                    };
                    div.className = "p-3 hover:bg-slate-50 rounded-2xl cursor-pointer flex items-center gap-3 active:scale-[0.98] transition-transform fade-in";
                    div.innerHTML = `<img loading="lazy" src="${escapeHtml(bk.image)}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-11 h-[60px] object-cover rounded-lg shadow-sm">
                        <div class="flex-1 min-w-0"><div class="font-bold text-sm truncate">${escapeHtml(bk.title)}</div><div class="text-xs text-muted truncate">${escapeHtml(bk.author)}</div></div>`;
                    div.onclick = () => showBookDetails(bk, true);
                    searchItemsEl.appendChild(div);
                });
            } catch (e) { searchItemsEl.innerHTML = '<div class="p-8 text-red-500 text-sm text-center">Помилка пошуку 😔</div>'; }
        }, 600);
    });
}

window.searchAuthorBooks = function (a) {
    closeAllSheets();
    setTimeout(() => {
        const i = document.getElementById('searchInput');
        i.value = `author:"${a}"`;
        openSheet('searchSheet');
        i.dispatchEvent(new Event('input'));
    }, 350);
};

function openManualForm() {
    tempSelectedBook = 'manual';
    toggleEditMode(true);
    document.getElementById('editTitle').value = '';
    document.getElementById('editAuthor').value = '';
    document.getElementById('editPages').value = '';
    document.getElementById('editImage').value = '';
    const ed = document.getElementById('editDescription');
    if (ed) ed.value = '';
    document.getElementById('statusButtons').classList.remove('hidden');
    openSheet('detailsSheet');
}

// ===== DETAILS =====
function showBookDetails(bookData, isNew = false) {
    if (!bookData || !bookData.title) return;
    const lb = myLibrary.find(b => (b.googleId && b.googleId === bookData.googleId) || b.id === bookData.id) || bookData;
    tempSelectedBook = isNew ? bookData : null;
    toggleEditMode(false);
    const sa = escapeHtml(lb.author || 'Невідомий');
    const saRaw = (lb.author || 'Невідомий').replace(/'/g, "\\'");
    const pct = Math.round(((lb.pagesRead || 0) / (lb.pagesTotal || 300)) * 100) || 0;
    let h = `<div class="flex gap-4 mb-5 fade-in">
        <img loading="lazy" src="${escapeHtml(lb.image || PLACEHOLDER_IMG)}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-24 h-36 object-cover rounded-2xl shadow-lg flex-shrink-0">
        <div class="flex flex-col justify-center min-w-0 flex-1">
            <h3 class="text-lg font-bold leading-tight mb-1.5">${escapeHtml(lb.title || 'Без назви')}</h3>
            <button onclick="window.searchAuthorBooks('${saRaw}')" class="text-left w-fit px-2 py-0.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-semibold mb-2 active:scale-95">👤 ${sa}</button>
            <span class="text-xs text-muted">📄 ${lb.pagesTotal || 300} стор.</span>
            ${!isNew ? `<select onchange="changeStatusFromDetails('${lb.id}',this.value)" class="mt-2 bg-slate-50 border border-slate-200 text-xs rounded-lg p-1.5 outline-none cursor-pointer">
                <option value="planned" ${lb.status === 'planned' ? 'selected' : ''}>⏳ В планах</option>
                <option value="reading" ${lb.status === 'reading' ? 'selected' : ''}>📖 Читаю</option>
                <option value="finished" ${lb.status === 'finished' ? 'selected' : ''}>✅ Прочитано</option>
            </select>` : ''}
        </div>
    </div>`;
    if (!isNew) {
        if (lb.status === 'reading') {
            h += `<div class="mb-5 p-4 card-elevated">
                <p class="text-[10px] font-bold uppercase text-muted mb-2">📊 Прогрес: <span id="sliderVal">${lb.pagesRead || 0}</span> / ${lb.pagesTotal || 300} стор.</p>
                <input type="range" min="0" max="${lb.pagesTotal || 300}" value="${lb.pagesRead || 0}" class="progress-slider" oninput="document.getElementById('sliderVal').textContent=this.value" onchange="updateProgress('${lb.id}',this.value,${lb.pagesTotal || 300})">
            </div>`;
        }
        h += `<div class="mb-5 p-4 card-elevated">
            <p class="text-[10px] font-bold uppercase text-muted mb-2">📖 Читалка ePub</p>
            <div class="flex gap-2">
                <button onclick="readSavedEpub('${lb.id}')" class="flex-1 py-2.5 bg-primary-600 text-white rounded-xl font-bold text-xs active:scale-95 shadow-md shadow-primary-200">▶ Читати</button>
                <div class="relative flex-1">
                    <input type="file" id="epubFileModal_${lb.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${lb.id}')">
                    <button onclick="document.getElementById('epubFileModal_${lb.id}').click()" class="w-full py-2.5 bg-slate-100 rounded-xl font-bold text-xs active:scale-95">📥 .epub файл</button>
                </div>
            </div>
        </div>`;
        h += `<div class="mb-5 p-4 card-elevated">
            <p class="text-[10px] font-bold uppercase text-muted mb-2">🗓 Дати читання</p>
            <div class="space-y-2">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-medium">Початок</span>
                    <input type="date" value="${lb.dateStarted || ''}" onchange="saveManualDate('${lb.id}','dateStarted',this)" class="date-input text-xs">
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-xs font-medium">Кінець</span>
                    <input type="date" value="${lb.dateFinished || ''}" onchange="saveManualDate('${lb.id}','dateFinished',this)" class="date-input text-xs">
                </div>
            </div>
        </div>`;
        const hl = lb.highlights || [];
        if (hl.length > 0) {
            h += `<div class="mb-5 p-4 card-elevated">
                <p class="text-[10px] font-bold uppercase text-amber-600 mb-2">✍️ Виділення (${hl.length})</p>
                <div class="space-y-1.5 max-h-32 overflow-y-auto">
                    ${hl.map((x, i) => `<div class="text-xs bg-amber-50 p-2.5 rounded-lg italic relative border border-amber-100">"${escapeHtml(x.text.substring(0, 150))}"<button onclick="deleteHighlight('${lb.id}',${i})" class="absolute top-1 right-1.5 text-red-400 text-[10px]">✕</button></div>`).join('')}
                </div>
            </div>`;
        }
        let stars = ''; const cr = lb.rating || 0;
        for (let i = 1; i <= 5; i++) stars += `<span onclick="setRating('${lb.id}',${i})" class="text-3xl cursor-pointer ${cr >= i ? 'text-amber-400' : 'text-slate-200'} active:scale-90 transition-transform">★</span>`;
        h += `<div class="mb-5 text-center card-elevated p-4"><p class="text-[10px] font-bold uppercase text-muted mb-2">Оцінка</p><div class="flex justify-center gap-2">${stars}</div></div>`;
        h += `<div class="mb-5 p-4 card-elevated">
            <div class="flex justify-between items-center mb-2">
                <p class="text-[10px] font-bold uppercase text-muted">Нотатки</p>
                <button onclick="saveReview('${lb.id}')" class="text-primary-600 bg-primary-50 px-3 py-1 rounded-lg text-[10px] font-bold active:scale-95">💾 Зберегти</button>
            </div>
            <textarea id="reviewText_${lb.id}" class="w-full bg-transparent text-sm outline-none resize-none min-h-[60px]" placeholder="Враження від книги...">${escapeHtml(lb.review || '')}</textarea>
        </div>`;
        h += `<button onclick="toggleEditMode(true)" class="w-full py-3 text-primary-600 bg-primary-50 rounded-xl font-bold text-sm active:scale-95 mb-3">✏️ Редагувати інфо</button>`;
    }
    h += `<div class="desc-scroll mb-4"><p class="text-[10px] font-bold uppercase text-muted mb-1">Анотація</p><p class="text-sm text-muted leading-relaxed">${escapeHtml(lb.description || 'Немає.')}</p></div>`;
    if (!isNew) h += `<button onclick="deleteBookFromDetails('${lb.id}')" class="w-full py-3 text-red-500 bg-red-50 rounded-xl font-bold text-sm active:scale-95 mb-4">🗑️ Видалити книгу</button>`;
    const detailsContent = document.getElementById('detailsContent');
    if (detailsContent) detailsContent.innerHTML = h;
    const statusButtons = document.getElementById('statusButtons');
    if (statusButtons) { if (isNew) statusButtons.classList.remove('hidden'); else statusButtons.classList.add('hidden'); }
    // Pre-fill edit form with existing data for edit mode
    document.getElementById('editTitle').value = lb.title || '';
    document.getElementById('editAuthor').value = lb.author || '';
    document.getElementById('editPages').value = lb.pagesTotal || 300;
    document.getElementById('editImage').value = lb.image || '';
    const ed = document.getElementById('editDescription');
    if (ed) ed.value = lb.description || '';
    if (!isNew) tempSelectedBook = lb;
    openSheet('detailsSheet');
}

function updateProgress(id, val, total) {
    const pagesRead = parseInt(val);
    updateBookInFirestore(id, { pagesRead });
    const book = myLibrary.find(b => b.id === id);
    if (book) book.pagesRead = pagesRead;
}

function deleteHighlight(id, i) {
    const b = myLibrary.find(x => x.id === id);
    if (!b || !b.highlights) return;
    b.highlights.splice(i, 1);
    updateBookInFirestore(id, { highlights: b.highlights });
    showBookDetails(b);
}
function deleteBookFromDetails(id) {
    if (confirm("Видалити книгу?")) {
        db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete();
        closeAllSheets();
        showToast('🗑️ Книгу видалено');
    }
}
function setRating(id, r) {
    updateBookInFirestore(id, { rating: r });
    showToast('★'.repeat(r) + ' Оцінку збережено');
    setTimeout(() => showBookDetails(myLibrary.find(b => b.id === id)), 100);
}
function changeStatusFromDetails(id, ns) {
    const u = { status: ns }; const b = myLibrary.find(x => x.id === id);
    if (!b) return;
    if (ns === 'finished') { u.pagesRead = b.pagesTotal; u.dateFinished = b.dateFinished || new Date().toISOString().slice(0, 10); showCelebration(); }
    else if (ns === 'reading') { u.dateStarted = b.dateStarted || new Date().toISOString().slice(0, 10); }
    updateBookInFirestore(id, u);
    closeAllSheets();
    setLibraryTab(ns);
}
function toggleEditMode(v) {
    const detailsContent = document.getElementById('detailsContent');
    const editContent = document.getElementById('editContent');
    if (v) { detailsContent?.classList.add('hidden'); editContent?.classList.remove('hidden'); }
    else { detailsContent?.classList.remove('hidden'); editContent?.classList.add('hidden'); }
}
function saveBookEdits() {
    const u = {
        title: document.getElementById('editTitle').value.trim() || 'Без назви',
        author: document.getElementById('editAuthor').value.trim() || 'Невідомий',
        pagesTotal: parseInt(document.getElementById('editPages').value) || 300,
        image: document.getElementById('editImage').value.trim(),
        description: document.getElementById('editDescription')?.value.trim() || ''
    };
    if (tempSelectedBook === 'manual') {
        tempSelectedBook = { ...u };
        toggleEditMode(false);
        showBookDetails(tempSelectedBook, true);
    } else {
        updateBookInFirestore(tempSelectedBook.id, u);
        showToast('✅ Збережено');
        showBookDetails({ ...tempSelectedBook, ...u });
    }
}
function saveReview(id) {
    const val = document.getElementById(`reviewText_${id}`)?.value || '';
    updateBookInFirestore(id, { review: val });
    showToast('💾 Нотатку збережено');
    if (navigator.vibrate) navigator.vibrate(50);
}
async function addBookWithStatus(s) {
    if (!currentUser) return;
    if (tempSelectedBook === 'manual') saveBookEdits();
    if (!tempSelectedBook || tempSelectedBook === 'manual') { showToast('Помилка: книга не вибрана'); return; }
    const nd = {
        ...tempSelectedBook,
        status: s,
        pagesRead: s === 'finished' ? (tempSelectedBook.pagesTotal || 300) : 0,
        dateAdded: Date.now(),
        updatedAt: Date.now(),
        rating: 0, review: '', highlights: [], timeSpent: 0,
        lastFileName: null,
        dateStarted: s === 'reading' ? new Date().toISOString().slice(0, 10) : null,
        dateFinished: s === 'finished' ? new Date().toISOString().slice(0, 10) : null,
        sortOrder: 0
    };
    delete nd.id;
    await db.collection('users').doc(currentUser.uid).collection('books').add(nd);
    tempSelectedBook = null;
    closeAllSheets();
    if (s === 'finished') showCelebration();
    showToast('✅ Книгу додано!');
    setLibraryTab(s);
}
function changeStatus(id, ns, ev) {
    ev.stopPropagation();
    const u = { status: ns }; const b = myLibrary.find(x => x.id === id);
    if (!b) return;
    if (ns === 'reading' && !b.dateStarted) u.dateStarted = new Date().toISOString().slice(0, 10);
    if (ns === 'finished') { u.pagesRead = b.pagesTotal; u.dateFinished = new Date().toISOString().slice(0, 10); showCelebration(); }
    updateBookInFirestore(id, u);
    setLibraryTab(ns);
}
function saveManualDate(id, f, el) {
    updateBookInFirestore(id, { [f]: el.value });
    const b = myLibrary.find(x => x.id === id);
    if (b) b[f] = el.value;
}

// ===== READER =====
function startTimer() {
    readingStartTime = Date.now();
    currentSessionSeconds = 0;
    const rt = document.getElementById('readerTimer');
    if (rt) rt.textContent = "00:00";
    readingTimer = setInterval(() => {
        currentSessionSeconds = Math.floor((Date.now() - readingStartTime) / 1000);
        const m = String(Math.floor(currentSessionSeconds / 60)).padStart(2, '0');
        const s = String(currentSessionSeconds % 60).padStart(2, '0');
        const h = Math.floor(currentSessionSeconds / 3600);
        if (rt) rt.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
    }, 1000);
}
function stopTimer() {
    if (readingTimer && currentReaderBookId) {
        clearInterval(readingTimer);
        readingTimer = null;
        const b = myLibrary.find(x => x.id === currentReaderBookId);
        if (b && currentSessionSeconds > 5) {
            const t = (b.timeSpent || 0) + currentSessionSeconds;
            db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ timeSpent: t, updatedAt: Date.now() });
            if (currentSessionSeconds >= 300) markReadingDay();
        }
    }
}
window.addEventListener('beforeunload', stopTimer);
window.addEventListener('visibilitychange', () => { if (document.hidden && rendition) stopTimer(); });

function toggleReaderSettings() { document.getElementById('readerSettingsMenu')?.classList.toggle('hidden'); }
function applyReaderSettings() {
    if (!rendition) return;
    rendition.themes.fontSize(readerFontSize + "%");
    rendition.themes.select(readerTheme);
    const fl = document.getElementById('fontSizeLabel');
    if (fl) fl.textContent = readerFontSize + '%';
    // Margin
    const marginMap = { compact: '2%', normal: '5%', wide: '12%' };
    const mg = marginMap[readerMargin] || '5%';
    rendition.themes.override('padding-left', mg);
    rendition.themes.override('padding-right', mg);
}
function changeFontSize(d) {
    readerFontSize = Math.max(50, Math.min(200, readerFontSize + d));
    localStorage.setItem('readerFontSize', readerFontSize);
    applyReaderSettings();
}
function changeReaderTheme(t) {
    readerTheme = t; localStorage.setItem('readerTheme', t); applyReaderSettings();
}
function changeReaderMargin(m) {
    readerMargin = m; localStorage.setItem('readerMargin', m); applyReaderSettings();
}
function initSwipeGestures() {
    if (!window.Hammer) return;
    const v = document.getElementById('viewer');
    if (!window.mc) {
        window.mc = new Hammer(v);
        window.mc.get('swipe').set({ direction: Hammer.DIRECTION_HORIZONTAL });
        window.mc.on("swipeleft", () => { if (rendition) rendition.next(); });
        window.mc.on("swiperight", () => { if (rendition) rendition.prev(); });
    }
}

function handleFileSelectAndSave(ev, bookId) {
    const file = ev.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.epub')) { showToast('Потрібен .epub файл!'); ev.target.value = ''; return; }
    const bd = myLibrary.find(b => b.id === bookId);
    if (bd && bd.lastFileName && bd.lastFileName !== file.name && !confirm('Інший файл. Замінити?')) { ev.target.value = ''; return; }
    if (bd && bd.lastFileName !== file.name) updateBookInFirestore(bookId, { lastFileName: file.name });
    const r = new FileReader();
    r.onload = async function (e) {
        const ab = e.target.result;
        try { await localforage.setItem(`epub_${bookId}`, ab); showToast('📚 Файл збережено!'); } catch (er) { showToast('Помилка збереження файлу'); }
        await openEpubReader(bookId, ab);
        closeAllSheets();
    };
    r.readAsArrayBuffer(file);
    ev.target.value = '';
}
async function readSavedEpub(bookId) {
    try {
        const ab = await localforage.getItem(`epub_${bookId}`);
        if (!ab) { showToast('📥 Спочатку завантажте .epub файл'); return; }
        await openEpubReader(bookId, ab);
        closeAllSheets();
    } catch (e) { showToast('Помилка відкриття файлу'); }
}
function readSavedEpubFromCard(id, ev) { ev.stopPropagation(); readSavedEpub(id); }

async function openEpubReader(bookId, source) {
    if (!readerDepsLoaded) { await loadReaderDeps(); readerDepsLoaded = true; }
    const bd = myLibrary.find(b => b.id === bookId);
    if (!bd) return;
    currentReaderBookId = bookId;
    const ro = document.getElementById('readerOverlay');
    if (ro) ro.style.display = 'flex';
    const rtitle = document.getElementById('readerTitle');
    const rprog = document.getElementById('readerProgress');
    if (rtitle) rtitle.textContent = bd.title;
    if (rprog) rprog.textContent = "...";
    startTimer();
    const viewer = document.getElementById('viewer');
    if (viewer) viewer.innerHTML = '';
    try {
        currentBookInstance = ePub(source);
        rendition = currentBookInstance.renderTo("viewer", { width: "100%", height: "100%", spread: "none", manager: "continuous", flow: "paginated" });
        rendition.themes.register("light", { "body": { "background": "#fafafa", "color": "#18181b", "font-family": "-apple-system, sans-serif", "line-height": "1.7" } });
        rendition.themes.register("sepia", { "body": { "background": "#f4ecd8", "color": "#5b4636", "font-family": "-apple-system, sans-serif", "line-height": "1.7" } });
        rendition.themes.register("dark", { "body": { "background": "#09090b", "color": "#d4d4d8", "font-family": "-apple-system, sans-serif", "line-height": "1.7" } });
        applyReaderSettings();
        rendition.on("selected", function (cfi, contents) {
            rendition.annotations.highlight(cfi);
            currentBookInstance.getRange(cfi).then(function (range) {
                if (!range) return;
                const text = range.toString().trim();
                if (text.length < 3) return;
                const bk = myLibrary.find(b => b.id === currentReaderBookId);
                if (bk) {
                    const hl = bk.highlights || [];
                    hl.push({ text, cfi, date: Date.now() });
                    bk.highlights = hl;
                    updateBookInFirestore(currentReaderBookId, { highlights: hl });
                    showToast('✍️ Виділення збережено');
                }
                if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            });
            contents.window.getSelection().removeAllRanges();
        });
        rendition.on("relocated", loc => {
            if (!loc || !loc.start) return;
            const p = Math.round((loc.start.percentage || 0) * 100);
            if (rprog) rprog.textContent = p > 0 ? p + "%" : "...";
            clearTimeout(window.syncProgressTimeout);
            window.syncProgressTimeout = setTimeout(() => {
                const u = { lastCfi: loc.start.cfi, updatedAt: Date.now() };
                if (p > 0) u.pagesRead = Math.round((p / 100) * (bd.pagesTotal || 300));
                updateBookInFirestore(currentReaderBookId, u);
            }, 3000);
        });
        const safeCfi = (bd.lastCfi && typeof bd.lastCfi === 'string' && bd.lastCfi.startsWith('epubcfi')) ? bd.lastCfi : undefined;
        await rendition.display(safeCfi).catch(() => rendition.display());
        currentBookInstance.ready.then(() => currentBookInstance.locations.generate(1600)).then(() => {
            const l = rendition.currentLocation();
            if (l && l.start) { if (rprog) rprog.textContent = Math.round(l.start.percentage * 100) + "%"; }
        }).catch(() => { });
        initSwipeGestures();
    } catch (er) {
        console.error(er);
        if (rprog) rprog.textContent = "Помилка";
        showToast('Помилка відкриття книги');
        stopTimer();
    }
}
function closeReader() {
    stopTimer();
    const ro = document.getElementById('readerOverlay');
    if (ro) ro.style.display = 'none';
    document.getElementById('readerSettingsMenu')?.classList.add('hidden');
    if (currentBookInstance) { currentBookInstance.destroy(); currentBookInstance = null; rendition = null; }
    const viewer = document.getElementById('viewer');
    if (viewer) viewer.innerHTML = '';
    currentReaderBookId = null;
    updateStreakWidget();
}

// ===== RENDER =====
function deleteBook(id, ev) {
    ev.stopPropagation();
    if (confirm("Видалити книгу?")) {
        db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete();
        showToast('🗑️ Видалено');
    }
}
function formatTime(s) {
    if (!s) return "0хв";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}г ${m}хв` : `${m}хв`;
}
function setLibraryTab(t) {
    currentLibraryTab = t;
    document.querySelectorAll('#libraryTabs button').forEach(b => { b.className = 'pill-inactive'; });
    const tab = document.getElementById('tab_' + t);
    if (tab) tab.className = 'pill-active';
    render();
}

function renderBookCard(book) {
    const pct = Math.round(((book.pagesRead || 0) / (book.pagesTotal || 300)) * 100) || 0;
    const isFin = book.status === 'finished', isPlan = book.status === 'planned', isRead = book.status === 'reading';
    const title = escapeHtml(book.title);
    const author = escapeHtml(book.author);
    const img = escapeHtml(book.image || PLACEHOLDER_IMG);

    if (viewMode === 'grid') {
        return `<div data-id="${book.id}" onclick="showBookDetailsById('${book.id}')" class="book-grid-item flex flex-col">
            <div class="relative w-full aspect-[2/3]">
                <img loading="lazy" src="${img}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-full h-full rounded-2xl object-cover" style="box-shadow:0 4px 16px rgba(0,0,0,.12)">
                ${isFin && book.rating ? `<div class="absolute bottom-1.5 right-1.5 bg-white/90 text-amber-500 text-[9px] font-black px-1.5 py-0.5 rounded-lg" style="backdrop-filter:blur(8px)">★${book.rating}</div>` : ''}
                ${isRead && pct > 0 ? `<div class="absolute bottom-0 left-0 right-0 h-1 bg-black/15 rounded-b-2xl overflow-hidden"><div class="h-full" style="width:${pct}%;background:linear-gradient(90deg,#6366f1,#818cf8)"></div></div>` : ''}
            </div>
            <p class="text-[11px] font-semibold mt-2 text-center line-clamp-1 px-0.5">${title}</p>
        </div>`;
    }

    return `<div data-id="${book.id}" onclick="showBookDetailsById('${book.id}')" class="book-card p-3.5 flex gap-3 items-start">
        <div class="relative flex-shrink-0">
            <img loading="lazy" src="${img}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-14 h-[76px] rounded-xl object-cover" style="box-shadow:0 3px 10px rgba(0,0,0,.1)">
            ${isRead ? `<div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-primary-500 border-2 border-white flex items-center justify-center" style="font-size:8px">📖</div>` : ''}
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start gap-1">
                <div class="min-w-0 flex-1">
                    <h3 class="font-bold text-[15px] leading-snug line-clamp-1">${title}</h3>
                    <p class="caption text-secondary mt-0.5 line-clamp-1">${author}</p>
                </div>
                <button onclick="deleteBook('${book.id}',event)" class="w-7 h-7 flex items-center justify-center rounded-full text-secondary hover:text-red-500 shrink-0 text-sm transition-colors" style="margin-right:-4px">✕</button>
            </div>
            ${isPlan ? `<button onclick="changeStatus('${book.id}','reading',event)" class="w-full mt-2.5 py-2 btn-tonal text-center text-xs">🚀 Почати читати</button>` : `
            <div class="mt-2.5">
                <div class="flex items-center gap-2 mb-1">
                    <div class="flex-1 progress-track h-1.5"><div class="progress-fill h-full" style="width:${pct}%"></div></div>
                    <span class="micro text-primary-600">${pct}%</span>
                    ${isRead ? `<button onclick="changeStatus('${book.id}','finished',event)" class="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-lg font-bold active:scale-95">✅</button>` : ''}
                </div>
                ${isRead ? `<div class="flex gap-1.5 mt-2">
                    <button onclick="readSavedEpubFromCard('${book.id}',event)" class="flex-1 py-1.5 text-white rounded-xl text-[11px] font-bold active:scale-95" style="background:linear-gradient(135deg,#6366f1,#4f46e5)">📱 Читати</button>
                    <div class="relative flex-shrink-0">
                        <input type="file" id="epubFile_${book.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${book.id}')">
                        <button onclick="event.stopPropagation();document.getElementById('epubFile_${book.id}').click();" class="py-1.5 px-3 bg-[rgba(118,118,128,.1)] rounded-xl text-[11px] font-bold active:scale-95">📥</button>
                    </div>
                </div>
                <p class="micro text-secondary mt-1.5">⏱ ${formatTime(book.timeSpent)}</p>` : ''}
                ${isFin && book.rating ? `<div class="mt-1.5 text-amber-400 text-xs">${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}</div>` : ''}
            </div>`}
        </div>
    </div>`;
}

// Безпечне відкриття деталей за id (без JSON в onclick)
function showBookDetailsById(id) {
    const book = myLibrary.find(b => b.id === id);
    if (book) showBookDetails(book, false);
}

function render() {
    const q = libraryFilterQuery;
    let reading = myLibrary.filter(b => b.status === 'reading');
    let planned = myLibrary.filter(b => b.status === 'planned');
    let finished = myLibrary.filter(b => b.status === 'finished');
    if (q) {
        const fn = b => b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q);
        reading = reading.filter(fn); planned = planned.filter(fn); finished = finished.filter(fn);
    }
    const tabReading = document.getElementById('tab_reading');
    const tabPlanned = document.getElementById('tab_planned');
    const tabFinished = document.getElementById('tab_finished');
    if (tabReading) tabReading.innerHTML = `📖 Читаю <span class="ml-1 opacity-60" style="font-size:11px">${reading.length}</span>`;
    if (tabPlanned) tabPlanned.innerHTML = `🕒 В планах <span class="ml-1 opacity-60" style="font-size:11px">${planned.length}</span>`;
    if (tabFinished) tabFinished.innerHTML = `✅ Прочитано <span class="ml-1 opacity-60" style="font-size:11px">${finished.length}</span>`;

    const c = document.getElementById('myBooksContainer');
    if (!c) return;
    let list = [];
    if (currentLibraryTab === 'reading') list = reading;
    else if (currentLibraryTab === 'planned') list = planned;
    else list = finished;

    const listCount = document.getElementById('listCount');
    if (listCount) listCount.textContent = list.length > 0 ? `${list.length} книг` : '';

    if (list.length === 0) {
        const tips = { reading: 'Натисніть + щоб знайти книгу і почати читати', planned: 'Додайте книги які хочете прочитати пізніше', finished: 'Завершені книги з\'являться тут' };
        c.innerHTML = `<div class="mt-12 text-center px-8"><span class="text-5xl block mb-3">📚</span><p class="font-bold text-lg mb-1">${q ? 'Не знайдено' : 'Поки порожньо'}</p><p class="text-muted text-sm">${q ? 'Спробуйте інший запит' : tips[currentLibraryTab]}</p></div>`;
        return;
    }
    const wc = viewMode === 'grid' ? 'book-grid sortable-list' : 'space-y-2.5 sortable-list';
    if (currentLibraryTab === 'finished') {
        finished.sort((a, b) => (b.dateFinished || '1970').localeCompare(a.dateFinished || '1970'));
        const gr = {};
        finished.forEach(b => {
            let y = '—';
            try { if (b.dateFinished && typeof b.dateFinished === 'string') y = b.dateFinished.substring(0, 4); } catch (e) { }
            if (!gr[y]) gr[y] = [];
            gr[y].push(b);
        });
        let html = '';
        Object.keys(gr).sort((a, b) => { if (a === '—') return 1; if (b === '—') return -1; return b - a; }).forEach(y => {
            html += `<p class="micro text-tertiary mt-5 mb-2">${y}</p><div class="${wc}">${gr[y].map(renderBookCard).join('')}</div>`;
        });
        c.innerHTML = html;
    } else {
        list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        c.innerHTML = `<div class="${wc}">${list.map(renderBookCard).join('')}</div>`;
    }
    document.querySelectorAll('.sortable-list').forEach(l => {
        new Sortable(l, {
            delay: 300, delayOnTouchOnly: true, animation: 150, ghostClass: 'sortable-ghost',
            onEnd: ev => { [...ev.from.children].forEach((el, i) => { const id = el.dataset.id; if (id) updateBookInFirestore(id, { sortOrder: i }); }); }
        });
    });
}

// ===== RECOMMENDATIONS =====
const curatedCategories = {
    'Академія магії': [
        '"академия магии" фэнтези', '"магическая академия"',
        'ромфант академия', 'академия волшебства',
        '"магічна академія" фентезі', '"академія магії" фентезі',
        'магічна школа фентезі', 'учениця відьми фентезі'
    ],
    'Фентезі': [
        '"фэнтези" бестселлер', 'эпическое фэнтези',
        'Джон Толкин', 'Джордж Мартин', 'Брэндон Сандерсон',
        'Робин Хобб', 'Ник Перумов', 'боевое фэнтези',
        '"фентезі" бестселер', 'українське фентезі'
    ],
    'Детектив': [
        '"детектив" бестселлер', 'Агата Кристи',
        'Ю Несбё', 'Стиг Ларссон', 'Борис Акунин',
        'психологический детектив', 'детектив украина',
        'кримінальний роман'
    ],
    'Трилер': [
        '"триллер" бестселлер', 'Стивен Кинг',
        'Джиллиан Флинн', 'Дэн Браун', 'Франк Тилье',
        'психологический триллер', 'психологічний трилер'
    ],
    'Романтика': [
        '"любовный роман" бестселлер', 'Николас Спаркс',
        'Джоджо Мойес', 'Колин Гувер', 'современный любовный роман',
        'романтика украина', 'сучасна романтика'
    ],
    'Саморозвиток': [
        '"саморазвитие" бестселлер', 'Роберт Кийосаки',
        'Марк Мэнсон', 'Джо Диспенза', 'Джеймс Клир',
        'психология успеха', 'саморозвиток мотивація',
        'психологія успіху'
    ],
    'Фантастика': [
        '"научная фантастика" бестселлер', 'Айзек Азимов',
        'Рэй Брэдбери', 'Энди Вейер', 'Сергей Лукьяненко',
        'космическая фантастика', 'наукова фантастика'
    ],
    'Класика': [
        '"классика литературы"', 'Федор Достоевский',
        'Лев Толстой', 'Михаил Булгаков', 'Антон Чехов',
        'мировая классика', 'класика літератури',
        'Іван Франко', 'Леся Українка', 'Тарас Шевченко'
    ],
    'Українська': [
        'українська проза', 'сучасна українська literatura',
        'Сергій Жадан', 'Оксана Забужко', 'Андрій Курков',
        'Марина Гримич', 'Люко Дашвар',
        'Ірен Роздобудько', 'Василь Шкляр',
        'українські автори роман', 'видання Folio Харків',
        'Артем Чапай', 'Тамара Горіха Зерня'
    ]
};

async function loadRealRecommendations(cat = 'auto', btnId = 'rec_auto') {
    if (currentRecCategory === cat) return;
    currentRecCategory = cat; recStartIndex = 0; currentRecQueryIndex = 0; currentRecQueries = []; shownRecTitles.clear();
    const list = document.getElementById('recommendationsList');
    if (!list) return;
    list.innerHTML = '<div class="p-10 text-secondary text-sm text-center" style="animation:pulse 1.5s infinite">🔍 Шукаємо для вас...</div>';
    document.querySelectorAll('#recTabs button').forEach(b => { b.className = 'pill-inactive'; });
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) activeBtn.className = 'pill-active';
    let pool = [];
    if (cat === 'auto') {
        let authors = myLibrary.map(b => b.author).filter(a => a && a.length > 2 && !a.toLowerCase().includes('невідомий') && !a.toLowerCase().includes('unknown'));
        if (authors.length > 0) {
            let counts = {}; authors.forEach(a => counts[a] = (counts[a] || 0) + 1);
            pool.push(...Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 10).map(a => `inauthor:"${a}"`));
        }
        let gen = Object.values(curatedCategories).flat(); gen.sort(() => 0.5 - Math.random()); pool.push(...gen);
    } else {
        pool = [...(curatedCategories[cat] || [])]; pool.sort(() => 0.5 - Math.random());
    }
    currentRecQueries = pool;
    await fetchMoreRecommendations(true);
}

async function fetchMoreRecommendations(isFirst = false) {
    if (isFetchingRecs || currentRecQueryIndex >= currentRecQueries.length) return;
    isFetchingRecs = true;
    const lst = document.getElementById('recommendationsList');
    if (!lst) { isFetchingRecs = false; return; }
    if (!isFirst && !document.getElementById('recLoadingMore')) {
        const d = document.createElement('div');
        d.id = 'recLoadingMore'; d.className = 'py-6 text-center text-muted animate-pulse text-sm'; d.textContent = 'Завантаження...';
        lst.appendChild(d);
    }
    let finalBooks = [], empty = 0;
    while (finalBooks.length < 6 && currentRecQueryIndex < currentRecQueries.length && empty < 3) {
        const q = currentRecQueries[currentRecQueryIndex];
        const GKEY = 'AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME';
        const url = `https://www.googleapis.com/books/v1/volumes?key=${GKEY}&q=${encodeURIComponent(q)}&maxResults=40&startIndex=${recStartIndex}`;
        try {
            const res = await fetch(url).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }));
            let items = res.items || [];
            if (items.length < 30) { currentRecQueryIndex++; recStartIndex = 0; } else { recStartIndex += 40; }
            const badWords = ['учебник', 'словарь', 'журнал', 'комикс', 'манга', 'підручник', 'словник', 'вісник', 'сборник', 'збірник', 'посібник', 'пособие', 'том ', 'випуск', 'выпуск', 'зошит', 'тетрадь', 'хрестоматия', 'дневник'];
            const existingTitles = new Set(myLibrary.map(b => (b.title || '').trim().toLowerCase()));
            // Для категорії "Українська" не фільтруємо по кирилиці (можуть бути англомовні описи)
            const skipCyrillicFilter = cat === 'Українська';
            let valid = items.filter(item => {
                const b = item.volumeInfo;
                if (!b.title || !b.description || b.description.length < 20) return false;
                if (b.pageCount !== undefined && b.pageCount > 0 && b.pageCount < 40) return false;
                if (!skipCyrillicFilter && (!isCyrillic(b.title) || isEnglishTitle(b.title))) return false;
                const tL = b.title.toLowerCase();
                if (badWords.some(w => tL.includes(w))) return false;
                if (existingTitles.has(tL)) return false;
                const key = tL + (b.authors ? b.authors[0] : '');
                if (shownRecTitles.has(key)) return false;
                return true;
            });
            const u = new Map();
            valid.forEach(i => { const b = i.volumeInfo; const key = b.title.toLowerCase() + (b.authors ? b.authors[0] : ''); u.set(key, i); });
            let ub = Array.from(u.values());
            ub.forEach(i => { const b = i.volumeInfo; shownRecTitles.add(b.title.toLowerCase() + (b.authors ? b.authors[0] : '')); finalBooks.push(i); });
            if (ub.length === 0) empty++; else empty = 0;
        } catch (e) { empty++; currentRecQueryIndex++; recStartIndex = 0; }
    }
    if (isFirst) lst.innerHTML = '';
    const loadingMore = document.getElementById('recLoadingMore');
    if (loadingMore) loadingMore.remove();
    if (finalBooks.length === 0 && isFirst) {
        lst.innerHTML = '<div class="p-10 text-center text-muted text-sm">Не знайшли нових книг 😔<br><span class="text-xs">Спробуйте іншу категорію</span></div>';
    } else if (finalBooks.length > 0) {
        finalBooks.sort(() => 0.5 - Math.random());
        finalBooks.forEach(i => {
            const b = i.volumeInfo;
            const img = (b.imageLinks?.thumbnail || PLACEHOLDER_IMG).replace(/^http:\/\//i, 'https://');
            const bk = {
                googleId: i.id || Math.random().toString(),
                title: b.title,
                author: b.authors ? b.authors[0] : 'Невідомий',
                pagesTotal: b.pageCount || 300,
                image: img,
                description: b.description || '',
                genre: (b.categories && b.categories[0]) || ''
            };
            const div = document.createElement('div');
            div.className = "book-card p-3.5 flex gap-3 items-start";
            div.innerHTML = `
                <img loading="lazy" src="${escapeHtml(bk.image)}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-13 h-[72px] rounded-xl shadow-sm object-cover flex-shrink-0" style="width:52px;height:72px">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm leading-tight truncate">${escapeHtml(bk.title)}</div>
                    <div class="text-xs text-muted mt-0.5">${escapeHtml(bk.author)}</div>
                    <div class="text-[11px] text-muted mt-1 line-clamp-2 leading-snug opacity-70">${escapeHtml(bk.description.substring(0, 120))}</div>
                </div>`;
            div.onclick = () => showBookDetails(bk, true);
            lst.appendChild(div);
        });
    }
    isFetchingRecs = false;
}

// ===== AI CHAT =====
let aiChatHistory = [];
let aiTyping = false;

function openAiChat() {
    openSheet('aiSheet');
    const input = document.getElementById('aiInput');
    if (input) setTimeout(() => input.focus(), 400);
    if (aiChatHistory.length === 0) renderAiMessages();
}

function renderAiMessages() {
    const container = document.getElementById('aiMessages');
    if (!container) return;
    if (aiChatHistory.length === 0) {
        const finCount = myLibrary.filter(b => b.status === 'finished').length;
        const readingNow = myLibrary.filter(b => b.status === 'reading').map(b => b.title).join(', ') || 'нічого';
        container.innerHTML = `
            <div class="flex gap-3 mb-4">
                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-sm shrink-0">🤖</div>
                <div class="bg-primary-50 rounded-2xl rounded-tl-sm p-3 max-w-[80%]">
                    <p class="text-sm">Привіт! Я ваш читацький помічник 📚</p>
                    <p class="text-sm mt-1">У вашій бібліотеці <b>${myLibrary.length}</b> книг, прочитано <b>${finCount}</b>. Зараз читаєте: <b>${readingNow}</b>.</p>
                    <p class="text-sm mt-1">Чим можу допомогти?</p>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 mb-4">
                ${[
                    '📖 Що почитати далі?',
                    '✍️ Коротко про мою бібліотеку',
                    '🎯 Чи виконаю ціль?',
                    '💡 Порекомендуй схожу книгу'
                ].map(q => `<button onclick="sendAiQuick('${q}')" class="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-full font-medium active:scale-95 transition-transform">${q}</button>`).join('')}
            </div>`;
        return;
    }
    container.innerHTML = aiChatHistory.map(msg => {
        const isUser = msg.role === 'user';
        return `<div class="flex gap-3 mb-4 ${isUser ? 'flex-row-reverse' : ''}">
            <div class="w-8 h-8 rounded-full ${isUser ? 'bg-primary-600' : 'bg-gradient-to-br from-primary-400 to-primary-700'} flex items-center justify-center text-sm shrink-0">
                ${isUser ? '👤' : '🤖'}
            </div>
            <div class="${isUser ? 'bg-primary-600 text-white rounded-2xl rounded-tr-sm' : 'bg-slate-100 rounded-2xl rounded-tl-sm'} p-3 max-w-[80%]">
                <p class="text-sm whitespace-pre-wrap leading-relaxed">${escapeHtml(msg.content)}</p>
            </div>
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function sendAiQuick(text) {
    const input = document.getElementById('aiInput');
    if (input) { input.value = text; sendAiMessage(); }
}

async function sendAiMessage() {
    if (aiTyping) return;
    const input = document.getElementById('aiInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    // Будуємо контекст бібліотеки
    const fin = myLibrary.filter(b => b.status === 'finished');
    const reading = myLibrary.filter(b => b.status === 'reading');
    const planned = myLibrary.filter(b => b.status === 'planned');
    const goal = parseInt(localStorage.getItem('readingGoal')) || 12;
    const year = new Date().getFullYear();
    const finThisYear = fin.filter(b => b.dateFinished && b.dateFinished.startsWith(String(year))).length;
    const avgRating = fin.filter(b => b.rating > 0).length > 0
        ? (fin.filter(b => b.rating > 0).reduce((s, b) => s + b.rating, 0) / fin.filter(b => b.rating > 0).length).toFixed(1)
        : 'немає оцінок';

    const libraryContext = `Бібліотека користувача:
- Всього книг: ${myLibrary.length}
- Читаю зараз (${reading.length}): ${reading.map(b => `"${b.title}" (${Math.round((b.pagesRead || 0) / (b.pagesTotal || 300) * 100)}%)`).join(', ') || 'нічого'}
- В планах (${planned.length}): ${planned.slice(0, 5).map(b => `"${b.title}"`).join(', ') || 'нічого'}
- Прочитано всього: ${fin.length} книг, цього року: ${finThisYear}/${goal}
- Середня оцінка: ${avgRating}
- Останні прочитані: ${fin.slice(0, 5).map(b => `"${b.title}" ${b.author ? `(${b.author})` : ''} ${b.rating ? `★${b.rating}` : ''}`).join(', ') || 'немає'}`;

    const systemMsg = {
        role: 'system',
        content: `Ти дружній читацький помічник для PWA-додатку "ЧитайКо". Відповідай українською мовою, коротко та по суті (2-4 речення). Не використовуй markdown форматування з зірочками чи хешами — тільки звичайний текст. Якщо рекомендуєш книги — назви конкретні. ${libraryContext}`
    };

    aiChatHistory.push({ role: 'user', content: text });
    renderAiMessages();
    aiTyping = true;

    // Показуємо індикатор typing
    const container = document.getElementById('aiMessages');
    const typingEl = document.createElement('div');
    typingEl.id = 'aiTyping';
    typingEl.className = 'flex gap-3 mb-4';
    typingEl.innerHTML = `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-sm shrink-0">🤖</div>
        <div class="bg-slate-100 rounded-2xl rounded-tl-sm p-3"><div class="flex gap-1 items-center h-5"><span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style="animation-delay:0s"></span><span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style="animation-delay:.15s"></span><span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style="animation-delay:.3s"></span></div></div>`;
    if (container) { container.appendChild(typingEl); container.scrollTop = container.scrollHeight; }

    try {
        const messages = [systemMsg, ...aiChatHistory.slice(-8)];
        const res = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages })
        });
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content || data.error || 'Помилка відповіді';
        aiChatHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
        aiChatHistory.push({ role: 'assistant', content: 'Помилка з\'єднання з ШІ 😔' });
    } finally {
        aiTyping = false;
        document.getElementById('aiTyping')?.remove();
        renderAiMessages();
    }
}

function clearAiChat() {
    aiChatHistory = [];
    renderAiMessages();
}

// ===== LAZY LOAD =====
function loadScript(src) {
    return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
    });
}
async function loadReaderDeps() {
    await Promise.all([
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js'),
        loadScript('https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js')
    ]);
}
async function loadChartJS() { await loadScript('https://cdn.jsdelivr.net/npm/chart.js'); }
async function loadScannerLib() { await loadScript('https://unpkg.com/html5-qrcode'); }
