// === БАЗОВІ НАЛАШТУВАННЯ ТА FIREBASE ===
const PLACEHOLDER_IMG = 'https://via.placeholder.com/128x192/f1f5f9/94a3b8?text=No+Cover';
const firebaseConfig = { apiKey: "AIzaSyAXgYW2_9ofKCvLoQFT6oMz0bCvbvldPGg", authDomain: "chitayko-pwa.firebaseapp.com", projectId: "chitayko-pwa", storageBucket: "chitayko-pwa.firebasestorage.app", messagingSenderId: "278531514478", appId: "1:278531514478:web:731dad47437f6aae2b067f", measurementId: "G-1JN4FBQ13K" };
firebase.initializeApp(firebaseConfig); 
const auth = firebase.auth(); 
const db = firebase.firestore();

// === ГЛОБАЛЬНІ ЗМІННІ ===
let currentUser = null;
let userProfile = { readingGoal: 0 };
let myLibrary = []; 
let tempSelectedBook = null; 
let timeoutId = null;
let currentLibraryTab = 'reading'; 
let viewMode = localStorage.getItem('viewMode') || 'list'; 
let activeTagFilter = null; // Для кастомних полиць
let rendition = null, currentReaderBookId = null, currentBookInstance = null;
let readerTheme = localStorage.getItem('readerTheme') || 'light';
let readerFontSize = parseInt(localStorage.getItem('readerFontSize')) || 100;
let readingTimer = null, readingStartTime = 0, currentSessionSeconds = 0;

// Змінні рекомендацій
let recStartIndex = 0, currentRecQueries = [], currentRecQueryIndex = 0;
let isFetchingRecs = false, currentRecCategory = null, shownRecTitles = new Set();

// === БЛОК ОФЛАЙН ПАМ'ЯТІ (IndexedDB) БЕЗПЕЧНИЙ ===
const idb = {
    db: null,
    async init() {
        if (this.db) return;
        if (!window.indexedDB) { console.warn("IndexedDB не підтримується."); return; }
        return new Promise((resolve) => {
            try {
                const req = indexedDB.open('ChitaykoDB', 1);
                req.onupgradeneeded = e => e.target.result.createObjectStore('epubs');
                req.onsuccess = e => { this.db = e.target.result; resolve(); };
                req.onerror = e => { console.error("Помилка IndexedDB", e); resolve(); };
            } catch (e) { resolve(); }
        });
    },
    async save(id, file) {
        await this.init();
        if (!this.db) return;
        return new Promise((resolve) => {
            const tx = this.db.transaction('epubs', 'readwrite');
            tx.objectStore('epubs').put(file, id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    },
    async get(id) {
        await this.init();
        if (!this.db) return null;
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('epubs', 'readonly');
                const req = tx.objectStore('epubs').get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
};

// === ІНІЦІАЛІЗАЦІЯ UI ===
document.addEventListener('DOMContentLoaded', () => {
    // Свайп для закриття вікон
    document.querySelectorAll('.bottom-sheet').forEach(sheet => {
        let startY = 0, currentY = 0, isDragging = false;
        sheet.addEventListener('touchstart', e => { 
            const scrollable = sheet.querySelector('.overflow-y-auto');
            if (!scrollable || scrollable.scrollTop <= 0 || e.target.closest('.drag-handle')) {
                startY = e.touches[0].clientY; isDragging = true; sheet.style.transition = 'none'; 
            }
        }, {passive: true});
        sheet.addEventListener('touchmove', e => { 
            if (!isDragging) return; currentY = e.touches[0].clientY; const deltaY = currentY - startY; 
            if (deltaY > 0) sheet.style.transform = `translateY(${deltaY}px)`; 
        }, {passive: true});
        sheet.addEventListener('touchend', e => {
            if (!isDragging) return; isDragging = false; sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
            if (currentY - startY > 100) { if (sheet.id === 'detailsSheet') closeDetailsSheet(); else closeAllSheets(); }
            sheet.style.transform = ''; 
        });
    });

    if(localStorage.getItem('appTheme') === 'dark') document.body.classList.add('dark');
});

// === АВТОРИЗАЦІЯ ТА ПРОФІЛЬ ===
auth.onAuthStateChanged(user => {
    const authScrn = document.getElementById('authScreen'); const appScrn = document.getElementById('appScreen');
    if (user) {
        currentUser = user; authScrn.classList.add('hidden'); authScrn.classList.remove('flex'); appScrn.classList.remove('hidden');
        document.getElementById('searchFab').classList.remove('hidden'); document.getElementById('mainBottomNav').classList.remove('hidden');
        document.getElementById('userEmailDisplay').innerText = user.email || user.phoneNumber || "Користувач"; 
        updateViewButtons(); 
        loadUserProfile();
        loadLibrary(); 
    } else {
        currentUser = null; myLibrary = []; authScrn.classList.remove('hidden'); authScrn.classList.add('flex'); appScrn.classList.add('hidden');
        document.getElementById('searchFab').classList.add('hidden'); document.getElementById('mainBottomNav').classList.add('hidden');
    }
});

function showErrorMsg(msg) { const errBox = document.getElementById('authError'); errBox.innerText = msg; errBox.classList.remove('hidden'); setTimeout(() => errBox.classList.add('hidden'), 6000); }
async function handleAuth(type, btn) {
    const originalText = btn.innerText; btn.innerText = "Зачекайте...";
    const email = document.getElementById('authEmail').value, password = document.getElementById('authPassword').value;
    if (email.length < 5 || password.length < 6) { btn.innerText = originalText; return showErrorMsg("Введіть Email та пароль (мін. 6 символів)"); }
    try { if (type === 'login') await auth.signInWithEmailAndPassword(email, password); else await auth.createUserWithEmailAndPassword(email, password); } 
    catch (error) { showErrorMsg("Помилка: " + error.message); } finally { btn.innerText = originalText; }
}

async function signInWithGoogle(btn) { 
    const originalHtml = btn.innerHTML; btn.innerText = "З'єднання з Google..."; const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); } catch (error) { if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') { btn.innerText = "Перенаправлення..."; await auth.signInWithRedirect(provider); } else { showErrorMsg("Помилка: " + error.message); btn.innerHTML = originalHtml; } }
}

function logout() { auth.signOut(); closeAllSheets(); }

async function loadUserProfile() {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists) userProfile = { readingGoal: 0, ...doc.data() };
    updateChallengeWidget();
}

function loadLibrary() { 
    db.collection('users').doc(currentUser.uid).collection('books').orderBy('dateAdded', 'desc').onSnapshot(snap => { 
        myLibrary = []; 
        snap.forEach(doc => myLibrary.push({ id: doc.id, ...doc.data() })); 
        updateChallengeWidget();
        render(); 
    }); 
}

async function updateBookInFirestore(id, updates) { if (currentUser) await db.collection('users').doc(currentUser.uid).collection('books').doc(id).update(updates); }
async function updateUserProfile(updates) { if (currentUser) { await db.collection('users').doc(currentUser.uid).set(updates, {merge: true}); userProfile = {...userProfile, ...updates}; updateChallengeWidget(); } }

// === UI КЕРУВАННЯ ===
function openSheet(id) { document.body.classList.add('modal-open'); document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open')); document.getElementById(id).classList.add('open'); document.querySelector('.backdrop').classList.remove('hidden'); }
function closeAllSheets() { document.body.classList.remove('modal-open'); document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open')); document.querySelector('.backdrop').classList.add('hidden'); toggleEditMode(false); }
function closeDetailsSheet() { if(!document.getElementById('statusButtons').classList.contains('hidden')) openSheet('searchSheet'); else closeAllSheets(); }
function toggleAppTheme() { document.body.classList.toggle('dark'); localStorage.setItem('appTheme', document.body.classList.contains('dark') ? 'dark' : 'light'); }
function setViewMode(mode) { viewMode = mode; localStorage.setItem('viewMode', mode); updateViewButtons(); render(); }
function updateViewButtons() {
    const actCls = 'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-900 bg-white shadow-sm transition-all';
    const inactCls = 'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-all';
    document.getElementById('view_list').className = viewMode === 'list' ? actCls : inactCls; document.getElementById('view_grid').className = viewMode === 'grid' ? actCls : inactCls;
}

// === ГЕЙМІФІКАЦІЯ (CHALLENGE) ===
function setReadingGoal() {
    const current = userProfile.readingGoal || 0;
    const goal = prompt("Скільки книг ви хочете прочитати цього року?", current);
    if(goal !== null && !isNaN(goal)) {
        updateUserProfile({ readingGoal: parseInt(goal) });
    }
}

function updateChallengeWidget() {
    const widget = document.getElementById('readingChallengeWidget');
    if(!userProfile.readingGoal || userProfile.readingGoal <= 0) { widget.classList.add('hidden'); return; }
    
    widget.classList.remove('hidden');
    const currentYear = new Date().getFullYear().toString();
    document.getElementById('challengeYear').innerText = currentYear;
    
    const finishedThisYear = myLibrary.filter(b => b.status === 'finished' && b.dateFinished && b.dateFinished.startsWith(currentYear)).length;
    const goal = userProfile.readingGoal;
    
    document.getElementById('challengeText').innerText = `${finishedThisYear} / ${goal} книг`;
    let percent = Math.min(100, Math.round((finishedThisYear / goal) * 100));
    document.getElementById('challengeProgress').style.width = `${percent}%`;
}

// === ТЕГИ ТА ПОЛИЦІ ===
function toggleTag(bookId, tag) {
    const book = myLibrary.find(b => b.id === bookId);
    let tags = book.tags || [];
    if(tags.includes(tag)) tags = tags.filter(t => t !== tag);
    else tags.push(tag);
    updateBookInFirestore(bookId, { tags: tags });
    showBookDetails({...book, tags: tags}); // Оновлюємо UI
}

function promptAddTag(bookId) {
    const tag = prompt("Введіть назву полиці/тегу (напр. 'Улюблене', 'Для відпустки'):");
    if(tag && tag.trim()) toggleTag(bookId, tag.trim());
}

function renderTagsFilter() {
    const container = document.getElementById('tagFiltersContainer');
    const list = document.getElementById('tagFiltersList');
    let allTags = new Set();
    myLibrary.forEach(b => { if(b.tags) b.tags.forEach(t => allTags.add(t)); });
    
    if(allTags.size === 0) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    
    let html = `<button onclick="activeTagFilter=null; render();" class="px-3 py-1 rounded-full text-[10px] font-bold transition-all ${!activeTagFilter ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}">Всі</button>`;
    
    Array.from(allTags).forEach(tag => {
        const isActive = activeTagFilter === tag;
        html += `<button onclick="activeTagFilter='${tag}'; render();" class="px-3 py-1 rounded-full text-[10px] font-bold transition-all ${isActive ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}">${tag}</button>`;
    });
    list.innerHTML = html;
}

// === ШЕРИНГ КНИГИ (CANVAS) ===
async function shareBookToSocial(bookId) {
    const book = myLibrary.find(b => b.id === bookId);
    if (!navigator.canShare || !window.HTMLCanvasElement) {
        alert("Ваш пристрій не підтримує генерацію картинок для шерингу."); return;
    }
    
    const btn = document.getElementById(`shareBtn_${bookId}`);
    const origText = btn.innerHTML;
    btn.innerHTML = "⏳ Генеруємо...";
    
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1080; canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        
        // Фон
        const grad = ctx.createLinearGradient(0, 0, 0, 1920);
        grad.addColorStop(0, '#4f46e5'); grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 1080, 1920);
        
        // Декор
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.arc(100, 200, 300, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(900, 1600, 400, 0, Math.PI*2); ctx.fill();

        // Текст "Я читаю"
        ctx.fillStyle = '#cbd5e1'; ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(book.status === 'finished' ? 'Я прочитав(ла):' : 'Зараз читаю:', 540, 300);
        
        // Назва та автор
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 80px sans-serif';
        const titleText = book.title.length > 35 ? book.title.substring(0, 35) + '...' : book.title;
        ctx.fillText(titleText, 540, 420);
        
        ctx.fillStyle = '#818cf8'; ctx.font = '50px sans-serif';
        ctx.fillText(book.author || 'Невідомий автор', 540, 500);

        // Обкладинка (Малюємо прямокутник-заглушку, якщо CORS блокує картинку)
        ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30;
        ctx.fillRect(290, 600, 500, 750);
        ctx.shadowBlur = 0; // reset
        
        try {
            // Спроба завантажити картинку
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = book.image;
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
            ctx.drawImage(img, 290, 600, 500, 750);
        } catch(e) {
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 40px sans-serif';
            ctx.fillText('ЧитайКо', 540, 1000);
        }

        // Оцінка
        if (book.rating > 0) {
            ctx.fillStyle = '#fbbf24'; ctx.font = '80px sans-serif';
            ctx.fillText('★'.repeat(book.rating), 540, 1500);
        }
        
        // Лого додатку
        ctx.fillStyle = '#cbd5e1'; ctx.font = 'bold 40px sans-serif';
        ctx.fillText('📚 Збережено в "ЧитайКо"', 540, 1800);

        canvas.toBlob(async (blob) => {
            const file = new File([blob], 'book_share.png', {type: 'image/png'});
            if(navigator.canShare({files: [file]})) {
                await navigator.share({ files: [file], title: book.title });
            } else { alert("Браузер не дозволяє поширити картинку безпосередньо."); }
            btn.innerHTML = origText;
        });
    } catch(e) {
        console.error(e);
        alert("Не вдалося згенерувати картинку.");
        btn.innerHTML = origText;
    }
}

// === УНІВЕРСАЛЬНА КАРТКА КНИГИ ===
async function showBookDetails(bookData, isNewFromSearch = false) {
    if (!bookData || !bookData.title) return;

    const libBook = myLibrary.find(b => (b.googleId && b.googleId === bookData.googleId) || b.id === bookData.id) || bookData;
    tempSelectedBook = isNewFromSearch ? bookData : null;
    toggleEditMode(false);

    const safeAuthor = (libBook.author || 'Невідомий').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeTitle = libBook.title || 'Без назви';
    const safePages = libBook.pagesTotal || 300;
    const safeDesc = libBook.description || 'Анотація відсутня.';

    // Чи є файл в кеші?
    let isSavedOffline = false;
    if (!isNewFromSearch && libBook.id) { isSavedOffline = !!(await idb.get(libBook.id)); }

    let html = `
        <div class="flex justify-between items-start mb-4 fade-in mt-1">
            <div class="flex gap-5 w-full">
                <img src="${libBook.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-28 h-40 object-cover rounded-xl shadow-md border border-slate-100 flex-shrink-0">
                <div class="flex flex-col justify-center min-w-0 flex-1">
                    <h3 class="text-xl font-bold text-slate-900 leading-tight mb-2 break-words">${safeTitle}</h3>
                    <button onclick="window.searchAuthorBooks('${safeAuthor}')" class="text-left w-fit px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold mb-3 active:scale-95 transition-all truncate shadow-sm">👤 ${safeAuthor}</button>
                    <span class="px-2.5 py-1 w-fit rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 mb-3">📄 ${safePages} стор.</span>
                    ${!isNewFromSearch ? `
                        <select onchange="changeStatusFromDetails('${libBook.id}', this.value)" class="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none cursor-pointer mb-2">
                            <option value="planned" ${libBook.status === 'planned' ? 'selected' : ''}>⏳ В планах</option>
                            <option value="reading" ${libBook.status === 'reading' ? 'selected' : ''}>📖 Читаю зараз</option>
                            <option value="finished" ${libBook.status === 'finished' ? 'selected' : ''}>✅ Прочитано</option>
                        </select>
                        <button id="shareBtn_${libBook.id}" onclick="shareBookToSocial('${libBook.id}')" class="w-full py-2 bg-gradient-to-r from-pink-500 to-orange-400 text-white rounded-lg text-[10px] font-bold active:scale-95 transition-transform flex items-center justify-center gap-1 shadow-sm">📸 Поділитися (Story)</button>
                    ` : ''}
                </div>
            </div>
        </div>`;

    // ТЕГИ (ПОЛИЦІ)
    if (!isNewFromSearch) {
        const tags = libBook.tags || [];
        html += `<div class="mb-5 fade-in">
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-[10px] font-black uppercase text-slate-400">Полиці:</span>
                ${tags.map(t => `<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold flex items-center gap-1">${t} <span onclick="toggleTag('${libBook.id}', '${t}')" class="text-red-400 cursor-pointer p-0.5 ml-1">✕</span></span>`).join('')}
                <button onclick="promptAddTag('${libBook.id}')" class="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-md text-[10px] font-bold">➕ Додати</button>
            </div>
        </div>`;
    }

    // ПАНЕЛЬ ЧИТАННЯ ФАЙЛУ
    if (!isNewFromSearch) {
        html += `<div class="mb-5 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 fade-in shadow-sm">
                    <h4 class="text-[10px] font-black uppercase text-indigo-500 mb-3 tracking-wider text-center">Файл книги</h4>`;
        
        if (isSavedOffline) {
            html += `<button onclick="openOfflineReader('${libBook.id}')" class="w-full py-3 mb-2 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 active:scale-95 transition-transform flex items-center justify-center gap-2">📱 Читати (Збережено офлайн)</button>
                     <div class="relative w-full"><input type="file" id="epubFile_${libBook.id}_det" accept=".epub" class="hidden" onchange="handleFileSelect(event, '${libBook.id}')"><button onclick="document.getElementById('epubFile_${libBook.id}_det').click();" class="w-full py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold active:scale-95 transition-transform">Оновити файл</button></div>`;
        } else {
            html += `<div class="relative w-full mb-2"><input type="file" id="epubFile_${libBook.id}_det" accept=".epub" class="hidden" onchange="handleFileSelect(event, '${libBook.id}')"><button onclick="document.getElementById('epubFile_${libBook.id}_det').click();" class="w-full py-3 bg-slate-800 text-white rounded-xl text-sm font-bold shadow-md active:scale-95 transition-transform flex items-center justify-center gap-2">📥 Завантажити EPUB</button></div>`;
            if (libBook.epubUrl) html += `<button onclick="openReaderFromUrl('${libBook.id}', '${libBook.epubUrl}', event)" class="w-full mb-2 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 active:scale-95 transition-transform flex items-center justify-center gap-2">☁️ Відкрити онлайн</button>`;
            html += `<button onclick="promptForEpubUrl('${libBook.id}', event)" class="w-full py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold active:scale-95 transition-transform">🔗 Читати за URL</button>`;
        }
        html += `</div>`;
    }

    // ДАТИ, ОЦІНКА, НОТАТКИ
    if (!isNewFromSearch) {
        html += `<div class="mb-6 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm fade-in">
            <h4 class="text-[9px] font-black uppercase text-indigo-500 tracking-wider mb-3 flex items-center gap-1">🗓 Дати читання</h4>
            <div class="space-y-2">
                <div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                    <span class="text-xs font-bold text-slate-600">Початок:</span>
                    <input type="date" value="${libBook.dateStarted || ''}" onchange="saveManualDate('${libBook.id}', 'dateStarted', this)" class="date-input">
                </div>
                <div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                    <span class="text-xs font-bold text-slate-600">Кінець:</span>
                    <input type="date" value="${libBook.dateFinished || ''}" onchange="saveManualDate('${libBook.id}', 'dateFinished', this)" class="date-input">
                </div>
            </div>
        </div>`;

        let starsHtml = ''; const currentRating = libBook.rating || 0;
        for(let i=1; i<=5; i++) starsHtml += `<span onclick="setRating('${libBook.id}', ${i})" class="text-4xl cursor-pointer ${currentRating >= i ? 'text-slate-400' : 'text-slate-200'} active:scale-90 transition-transform">★</span>`;
        html += `<div class="mb-6 text-center fade-in bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div class="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-wider">Моя оцінка</div>
            <div class="flex justify-center gap-3">${starsHtml}</div>
        </div>
        
        <div class="mb-6 bg-slate-50 p-5 rounded-3xl border border-slate-100 fade-in shadow-sm">
            <h4 class="text-[10px] font-black uppercase text-slate-500 mb-3 flex justify-between items-center tracking-wider">Нотатки та Цитати <button onclick="saveReview('${libBook.id}')" class="text-indigo-600 bg-indigo-100 px-4 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-transform shadow-sm">Зберегти</button></h4>
            <textarea id="reviewText_${libBook.id}" class="w-full bg-transparent text-sm text-slate-700 outline-none resize-none min-h-[120px]" placeholder="Напишіть свої враження тут... Або виділяйте текст в читалці, щоб зберегти цитати!">${libBook.review || ''}</textarea>
        </div>`;
    }
    
    html += `<div class="desc-scroll fade-in"><h4 class="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-wider">Анотація</h4><p class="text-sm text-slate-700 leading-relaxed text-justify">${safeDesc}</p></div>`;
    
    if (!isNewFromSearch) html += `<div class="mt-8 mb-2 flex justify-center fade-in"><button onclick="deleteBookFromDetails('${libBook.id}')" class="flex items-center gap-2 px-6 py-3 text-red-500 bg-red-50 hover:bg-red-100 rounded-xl font-bold text-sm active:scale-95 transition-all shadow-sm">🗑️ Видалити книгу</button></div>`;

    document.getElementById('detailsContent').innerHTML = html;
    if (isNewFromSearch) document.getElementById('statusButtons').classList.remove('hidden'); else document.getElementById('statusButtons').classList.add('hidden');
    openSheet('detailsSheet');
}

// === ЧИТАЛКА (EPUB.JS) ТА ЦИТАТИ ===
async function handleFileSelect(event, bookId) {
    const file = event.target.files[0]; if (!file) return; 
    if (!file.name.toLowerCase().endsWith('.epub')) { alert("Потрібен формат .epub"); event.target.value = ''; return; }
    
    const bookData = myLibrary.find(b => b.id === bookId);
    if (bookData.lastFileName && bookData.lastFileName !== file.name) { 
        if (!confirm(`⚠️ Це інший файл! Прогрес зіб'ється. Продовжити?`)) { event.target.value = ''; return; } 
    }
    updateBookInFirestore(bookId, { lastFileName: file.name });
    
    await idb.save(bookId, file); // Зберігаємо офлайн
    alert("Книгу збережено на пристрій! Тепер вона доступна офлайн.");
    
    startReaderUI(bookData); 
    const reader = new FileReader(); 
    reader.onload = function(e) { loadEpubData(e.target.result, bookData); }; 
    reader.readAsArrayBuffer(file); event.target.value = ''; showBookDetails(bookData);
}

async function openOfflineReader(bookId) {
    const bookData = myLibrary.find(b => b.id === bookId);
    const file = await idb.get(bookId);
    if (!file) { alert("Файл не знайдено на пристрої. Завантажте його знову."); return; }
    startReaderUI(bookData);
    const reader = new FileReader();
    reader.onload = function(e) { loadEpubData(e.target.result, bookData); };
    reader.readAsArrayBuffer(file);
}

function promptForEpubUrl(bookId, event) { if(event) event.stopPropagation(); const url = prompt("Пряме веб-посилання на .epub:"); if(url) updateBookInFirestore(bookId, { epubUrl: url }); }
function openReaderFromUrl(bookId, url, event) { if(event) event.stopPropagation(); const bookData = myLibrary.find(b => b.id === bookId); startReaderUI(bookData); loadEpubData('https://corsproxy.io/?' + encodeURIComponent(url), bookData); }
function startReaderUI(bookData) { currentReaderBookId = bookData.id; document.getElementById('readerOverlay').style.display = 'flex'; document.getElementById('readerTitle').innerText = bookData.title; document.getElementById('readerProgress').innerText = "Завантаження..."; document.getElementById('librarySections').classList.add('hidden'); startTimer(); }

function loadEpubData(source, bookData) {
    document.getElementById('viewer').innerHTML = ''; 
    try {
        currentBookInstance = ePub(source); 
        rendition = currentBookInstance.renderTo("viewer", { width: "100%", height: "100%", spread: "none", manager: "continuous", flow: "paginated" });
        rendition.themes.register("light", { "body": { "background": "#f8fafc", "color": "#0f172a" }}); 
        rendition.themes.register("sepia", { "body": { "background": "#f4ecd8", "color": "#5b4636" }}); 
        rendition.themes.register("dark", { "body": { "background": "#0f172a", "color": "#cbd5e1" }});
        applyReaderSettings();
        
        const safeCfi = (bookData.lastCfi && typeof bookData.lastCfi === 'string' && bookData.lastCfi.startsWith('epubcfi')) ? bookData.lastCfi : undefined;
        rendition.display(safeCfi).catch(() => rendition.display());
        
        currentBookInstance.ready.then(() => currentBookInstance.locations.generate(1600)).then(() => { const loc = rendition.currentLocation(); if(loc && loc.start) document.getElementById('readerProgress').innerText = Math.round(loc.start.percentage * 100) + "%"; else document.getElementById('readerProgress').innerText = "Відкрито"; }).catch(err => console.log(err));
        
        rendition.on("relocated", (location) => {
            if (location && location.start) {
                let percent = 0; if (location.start.percentage) percent = Math.round(location.start.percentage * 100); document.getElementById('readerProgress').innerText = percent > 0 ? percent + "%" : "Рахуємо...";
                if (percent > 0) db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ lastCfi: location.start.cfi, pagesRead: Math.round((percent / 100) * (bookData.pagesTotal || 300)) }); else db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ lastCfi: location.start.cfi });
            }
        });

        // ІНТЕГРАЦІЯ ЗБЕРЕЖЕННЯ ЦИТАТ
        rendition.on("selected", function(cfiRange, contents) {
            currentBookInstance.getRange(cfiRange).then(function(range) {
                const text = range.toString().trim();
                if(text && confirm("Зберегти виділений текст як цитату?\n\n" + text.substring(0, 50) + "...")) {
                    const book = myLibrary.find(b => b.id === currentReaderBookId);
                    const currentReview = book.review || '';
                    const newReview = currentReview + (currentReview ? '\n\n' : '') + `📌 Цитата:\n"${text}"`;
                    updateBookInFirestore(currentReaderBookId, { review: newReview });
                    rendition.annotations.add("highlight", cfiRange, {}, (e) => {});
                    contents.window.getSelection().removeAllRanges();
                    alert("Цитату збережено в нотатки книги!");
                }
            });
        });

    } catch (err) { console.error(err); document.getElementById('readerProgress').innerText = "Помилка"; stopTimer(); }
}

function closeReader() { stopTimer(); document.getElementById('readerOverlay').style.display = 'none'; document.getElementById('readerSettingsMenu').classList.add('hidden'); if(currentBookInstance) { currentBookInstance.destroy(); currentBookInstance = null; rendition = null; } document.getElementById('viewer').innerHTML = ''; document.getElementById('librarySections').classList.remove('hidden'); }
function toggleReaderSettings() { document.getElementById('readerSettingsMenu').classList.toggle('hidden'); }
function applyReaderSettings() { if(!rendition) return; rendition.themes.fontSize(readerFontSize + "%"); rendition.themes.select(readerTheme); }
function changeFontSize(delta) { readerFontSize = Math.max(50, Math.min(200, readerFontSize + delta)); localStorage.setItem('readerFontSize', readerFontSize); applyReaderSettings(); }
function changeReaderTheme(theme) { readerTheme = theme; localStorage.setItem('readerTheme', theme); applyReaderSettings(); }
function startTimer() { readingStartTime = Date.now(); currentSessionSeconds = 0; readingTimer = setInterval(() => { currentSessionSeconds = Math.floor((Date.now() - readingStartTime) / 1000); const m = String(Math.floor(currentSessionSeconds / 60)).padStart(2, '0'), s = String(currentSessionSeconds % 60).padStart(2, '0'), h = Math.floor(currentSessionSeconds / 3600); document.getElementById('readerTimer').innerText = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`; }, 1000); }
function stopTimer() { if (readingTimer && currentReaderBookId) { clearInterval(readingTimer); readingTimer = null; const book = myLibrary.find(b => b.id === currentReaderBookId); if (book && currentSessionSeconds > 5) { const totalTime = (book.timeSpent || 0) + currentSessionSeconds; db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ timeSpent: totalTime }); } } }

// === ІНШІ СТАНДАРТНІ ФУНКЦІЇ (без змін, просто згруповані) ===
function deleteBookFromDetails(id) { if(confirm("Видалити цю книгу назавжди?")) { db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete(); closeAllSheets(); } }
function setRating(id, rating) { updateBookInFirestore(id, { rating: rating }); setTimeout(() => { showBookDetails(myLibrary.find(b => b.id === id)); }, 100); }
function changeStatusFromDetails(id, newStatus) { const updates = { status: newStatus }; const book = myLibrary.find(b => b.id === id); if (newStatus === 'finished') { updates.pagesRead = book.pagesTotal; updates.dateFinished = book.dateFinished || new Date().toISOString().slice(0, 10); } else if (newStatus === 'reading') { updates.dateStarted = book.dateStarted || new Date().toISOString().slice(0, 10); } updateBookInFirestore(id, updates); closeAllSheets(); setLibraryTab(newStatus); }
function toggleEditMode(isEditing) { if(isEditing) { document.getElementById('detailsContent').classList.add('hidden'); document.getElementById('editContent').classList.remove('hidden'); } else { document.getElementById('detailsContent').classList.remove('hidden'); document.getElementById('editContent').classList.add('hidden'); } }
function saveBookEdits() { const updates = { title: document.getElementById('editTitle').value.trim() || 'Без назви', author: document.getElementById('editAuthor').value.trim() || 'Невідомий', pagesTotal: parseInt(document.getElementById('editPages').value) || 300, image: document.getElementById('editImage').value.trim() }; if(tempSelectedBook === 'manual') { tempSelectedBook = { ...updates, description: 'Додано вручну.' }; } else { updateBookInFirestore(tempSelectedBook.id, updates); showBookDetails({ ...tempSelectedBook, ...updates }); } }
function saveReview(id) { updateBookInFirestore(id, { review: document.getElementById(`reviewText_${id}`).value }); }
async function addBookWithStatus(status) { if (!currentUser) return; if(tempSelectedBook === 'manual') saveBookEdits(); let newBookData = { ...tempSelectedBook, status: status, pagesRead: status === 'finished' ? tempSelectedBook.pagesTotal : 0, dateAdded: Date.now(), rating: 0, review: '', epubUrl: null, timeSpent: 0, lastFileName: null, tags: [], dateStarted: status === 'reading' ? new Date().toISOString().slice(0, 10) : null, dateFinished: status === 'finished' ? new Date().toISOString().slice(0, 10) : null }; await db.collection('users').doc(currentUser.uid).collection('books').add(newBookData); tempSelectedBook = null; closeAllSheets(); }
function saveManualDate(id, field, dateEl) { updateBookInFirestore(id, { [field]: dateEl.value }); const book = myLibrary.find(b => b.id === id); if (book) book[field] = dateEl.value; render(); }
function deleteBook(id, event) { event.stopPropagation(); if(confirm("Видалити книгу?")) db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete(); }
function formatTime(secs) { if (!secs) return "0 хв"; const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60); return h > 0 ? `${h} год ${m} хв` : `${m} хв`; }
function calculateStats() { const finished = myLibrary.filter(b => b.status === 'finished'); const totalPages = finished.reduce((sum, b) => sum + (parseInt(b.pagesTotal) || 0), 0); document.getElementById('statBooks').innerText = finished.length; document.getElementById('statPages').innerText = totalPages; }

function setLibraryTab(tab) { 
    currentLibraryTab = tab; 
    document.querySelectorAll('#libraryTabs button').forEach(btn => { btn.className = 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all duration-200 bg-slate-200 text-slate-600 dark-inactive-tab active:scale-95'; }); 
    document.getElementById('tab_' + tab).className = 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all duration-200 bg-indigo-600 text-white shadow-md active:scale-95'; 
    render(); 
}

function renderBookCard(book) {
    const percent = Math.round((book.pagesRead / book.pagesTotal) * 100) || 0;
    const isFinished = book.status === 'finished';

    if (viewMode === 'grid') {
        return `<div data-id="${book.id}" onclick="showBookDetails(${JSON.stringify(book).replace(/"/g, '&quot;')})" class="flex flex-col items-center cursor-pointer fade-in active:scale-[0.98] transition-transform ${isFinished ? 'opacity-80' : ''}"><div class="relative w-full aspect-[2/3]"><img src="${book.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-full h-full rounded-xl shadow-md object-cover border border-slate-200">${isFinished && book.rating ? `<div class="absolute -bottom-2 -right-2 bg-white text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm border border-slate-100">★${book.rating}</div>` : ''}</div><h3 class="font-bold text-slate-900 text-[11px] leading-tight mt-2 w-full text-center truncate px-1">${book.title}</h3></div>`;
    }

    return `
    <div data-id="${book.id}" onclick="showBookDetails(${JSON.stringify(book).replace(/"/g, '&quot;')})" class="bg-white p-4 rounded-[1.25rem] shadow-sm flex gap-4 items-start cursor-pointer border border-slate-100 fade-in active:scale-[0.98] transition-transform ${isFinished ? 'opacity-80' : ''}">
        <img src="${book.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-16 h-24 rounded-xl shadow-sm object-cover flex-shrink-0 border border-slate-100">
        <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start gap-2"><div class="min-w-0"><h3 class="font-bold text-slate-900 text-[15px] leading-snug truncate">${book.title}</h3><p class="text-[13px] text-slate-500 mt-0.5 truncate">${book.author}</p></div><button onclick="deleteBook('${book.id}', event)" class="text-slate-300 hover:text-red-500 flex-shrink-0 transition-colors p-1">✕</button></div>
            <div class="mt-3 mb-1.5 flex items-center gap-2"><div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200"><div class="progress-bar bg-indigo-600 h-full rounded-full" style="width: ${percent}%"></div></div></div>
            <div class="flex items-center justify-between text-[11px] font-bold mt-1 mb-2"><span class="text-slate-400 uppercase tracking-wider">⏱️ ${formatTime(book.timeSpent)}</span><span class="text-indigo-600">${percent}%</span></div>
            ${book.tags && book.tags.length > 0 ? `<div class="flex gap-1 overflow-x-auto scrollbar-hide mb-2">${book.tags.map(t => `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-bold whitespace-nowrap">${t}</span>`).join('')}</div>` : ''}
        </div>
    </div>`;
}

function render() {
    renderTagsFilter();
    
    // Фільтруємо за табами І за активним тегом
    let filteredLibrary = myLibrary;
    if (activeTagFilter) {
        filteredLibrary = myLibrary.filter(b => b.tags && b.tags.includes(activeTagFilter));
    }
    
    const reading = filteredLibrary.filter(b => b.status === 'reading'); 
    const planned = filteredLibrary.filter(b => b.status === 'planned'); 
    const finished = filteredLibrary.filter(b => b.status === 'finished');
    
    // Лічильники табів оновлюються на основі загальної бібліотеки (без фільтра тегів)
    document.getElementById('tab_reading').innerText = `Читаю зараз (${myLibrary.filter(b => b.status === 'reading').length})`; 
    document.getElementById('tab_planned').innerText = `В планах (${myLibrary.filter(b => b.status === 'planned').length})`; 
    document.getElementById('tab_finished').innerText = `Прочитано (${myLibrary.filter(b => b.status === 'finished').length})`;
    
    const container = document.getElementById('myBooksContainer');
    
    if ((currentLibraryTab === 'reading' && reading.length === 0) || (currentLibraryTab === 'planned' && planned.length === 0) || (currentLibraryTab === 'finished' && finished.length === 0)) { container.innerHTML = `<div class="mt-10 text-center px-6"><span class="text-4xl block mb-4">📚</span><h3 class="text-xl font-bold text-slate-900 mb-2">Тут поки порожньо</h3><p class="text-slate-500 text-sm">Додайте сюди книги!</p></div>`; return; }
    
    container.classList.remove('fade-in'); void container.offsetWidth; container.classList.add('fade-in');
    const wrapperClass = viewMode === 'grid' ? 'grid grid-cols-3 gap-4 sortable-list' : 'space-y-3 sortable-list';
    
    if (currentLibraryTab === 'reading') { container.innerHTML = `<div class="${wrapperClass}">${reading.map(renderBookCard).join('')}</div>`; }
    else if (currentLibraryTab === 'planned') { container.innerHTML = `<div class="${wrapperClass}">${planned.map(renderBookCard).join('')}</div>`; }
    else if (currentLibraryTab === 'finished') {
        finished.sort((a, b) => { const dateA = a.dateFinished || '1970-01-01'; const dateB = b.dateFinished || '1970-01-01'; return dateB.localeCompare(dateA); });
        const grouped = {}; finished.forEach(b => { let year = 'Без дати'; try { if (b.dateFinished) year = b.dateFinished.substring(0, 4); } catch(e) {} if(!grouped[year]) grouped[year] = []; grouped[year].push(b); });
        let html = ''; Object.keys(grouped).sort((a, b) => { if (a === 'Без дати') return 1; if (b === 'Без дати') return -1; return b - a; }).forEach(year => { html += `<h2 class="font-black text-slate-300 text-lg mt-6 mb-3 tracking-widest">${year}</h2><div class="${wrapperClass}">${grouped[year].map(renderBookCard).join('')}</div>`; });
        container.innerHTML = html;
    }

    if (viewMode === 'grid') { document.querySelectorAll('.sortable-list').forEach(list => { new Sortable(list, { delay: 300, delayOnTouchOnly: true, animation: 150, ghostClass: 'sortable-ghost' }); }); }
}

function switchTab(tab) {
    document.getElementById('appScreen').classList.remove('hidden'); document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    if (tab === 'library') { navItems[0].classList.add('active'); const lib = document.getElementById('librarySections'); lib.classList.remove('hidden', 'fade-in'); void lib.offsetWidth; lib.classList.add('fade-in'); document.getElementById('recommendationsScreen').classList.add('hidden'); document.getElementById('readingChallengeWidget').classList.remove('hidden'); } 
    else if (tab === 'recommendations') { navItems[1].classList.add('active'); const rec = document.getElementById('recommendationsScreen'); rec.classList.remove('hidden', 'fade-in'); void rec.offsetWidth; rec.classList.add('fade-in'); document.getElementById('librarySections').classList.add('hidden'); document.getElementById('readingChallengeWidget').classList.add('hidden'); if(!currentRecCategory) loadRealRecommendations('auto', 'rec_auto'); }
}
