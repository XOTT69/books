// ЧитайКо PWA - Основний JavaScript файл
// Версія 2.0 - Оптимізована та покращена

// Глобальні змінні
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

// Ініціалізація Firebase (перевіряємо чи не ініціалізовано)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// Стан застосунку
let currentUser = null;
let myLibrary = [];
let tempSelectedBook = null;
let timeoutId = null;
let currentLibraryTab = 'reading';
let viewMode = localStorage.getItem('viewMode') || 'list';
let rendition = null;
let currentReaderBookId = null;
let currentBookInstance = null;
let readerTheme = localStorage.getItem('readerTheme') || 'light';
let readerFontSize = parseInt(localStorage.getItem('readerFontSize')) || 100;
let readingTimer = null;
let readingStartTime = 0;
let currentSessionSeconds = 0;

// Змінні для рекомендацій
let recStartIndex = 0;
let currentRecQueries = [];
let currentRecQueryIndex = 0;
let isFetchingRecs = false;
let currentRecCategory = null;
let shownRecTitles = new Set();

// Performance optimization - Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Performance optimization - Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Ініціалізація застосунку
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    // Реєстрація Service Worker
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker зареєстровано:', registration);
        } catch (err) {
            console.log('Помилка реєстрації Service Worker:', err);
        }
    }

    // Ініціалізація жестів для bottom sheets
    initializeBottomSheets();
    
    // Ініціалізація спостерігача для рекомендацій
    initializeRecommendationsObserver();
    
    // Завантаження теми
    loadTheme();
    
    // Ініціалізація пошуку
    initializeSearch();
    
    // Моніторинг автентифікації
    auth.onAuthStateChanged(handleAuthStateChange);
}

function loadTheme() {
    if (localStorage.getItem('appTheme') === 'dark') {
        document.body.classList.add('dark');
    }
}

function initializeBottomSheets() {
    document.querySelectorAll('.bottom-sheet').forEach(sheet => {
        let startY = 0, currentY = 0, isDragging = false;
        
        sheet.addEventListener('touchstart', e => { 
            const scrollable = sheet.querySelector('.overflow-y-auto');
            if (!scrollable || scrollable.scrollTop <= 0 || e.target.closest('.drag-handle')) {
                startY = e.touches[0].clientY; 
                isDragging = true; 
                sheet.style.transition = 'none'; 
            }
        }, {passive: true});
        
        sheet.addEventListener('touchmove', throttle(e => { 
            if (!isDragging) return; 
            currentY = e.touches[0].clientY; 
            const deltaY = currentY - startY; 
            if (deltaY > 0) sheet.style.transform = `translateY(${deltaY}px)`; 
        }, 16), {passive: true});
        
        sheet.addEventListener('touchend', e => {
            if (!isDragging) return; 
            isDragging = false; 
            sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
            if (currentY - startY > 100) { 
                if (sheet.id === 'detailsSheet') closeDetailsSheet(); 
                else closeAllSheets(); 
            }
            sheet.style.transform = ''; 
        });
    });
}

function initializeRecommendationsObserver() {
    const recObserver = new IntersectionObserver((entries) => {
        if(entries[0].isIntersecting && !document.getElementById('recommendationsScreen').classList.contains('hidden')) {
            if (!isFetchingRecs && currentRecQueries.length > 0) {
                fetchMoreRecommendations();
            }
        }
    }, { rootMargin: '300px' });
    
    const scrollTarget = document.getElementById('recScrollTarget');
    if(scrollTarget) recObserver.observe(scrollTarget);
}

function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleSearch, 300));
    }
}

// Обробка зміни стану автентифікації
function handleAuthStateChange(user) {
    const authScreen = document.getElementById('authScreen');
    const appScreen = document.getElementById('appScreen');
    
    if (user) {
        currentUser = user;
        authScreen.classList.add('hidden');
        authScreen.classList.remove('flex');
        appScreen.classList.remove('hidden');
        document.getElementById('searchFab').classList.remove('hidden');
        document.getElementById('mainBottomNav').classList.remove('hidden');
        document.getElementById('userEmailDisplay').innerText = user.email || user.phoneNumber || "Користувач";
        updateViewButtons();
        loadLibrary();
    } else {
        currentUser = null;
        myLibrary = [];
        authScreen.classList.remove('hidden');
        authScreen.classList.add('flex');
        appScreen.classList.add('hidden');
        document.getElementById('searchFab').classList.add('hidden');
        document.getElementById('mainBottomNav').classList.add('hidden');
    }
}

// Функції автентифікації
function showErrorMsg(msg) {
    const errBox = document.getElementById('authError');
    errBox.innerText = msg;
    errBox.classList.remove('hidden');
    setTimeout(() => errBox.classList.add('hidden'), 6000);
}

async function handleAuth(type, btn) {
    const originalText = btn.innerText;
    btn.innerText = "Зачекайте...";
    btn.disabled = true;
    
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    
    if (email.length < 5 || password.length < 6) {
        btn.innerText = originalText;
        btn.disabled = false;
        return showErrorMsg("Введіть Email та пароль (мін. 6 символів)");
    }
    
    try {
        if (type === 'login') {
            await auth.signInWithEmailAndPassword(email, password);
        } else {
            await auth.createUserWithEmailAndPassword(email, password);
        }
    } catch (error) {
        showErrorMsg("Помилка: " + error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function signInWithGoogle(btn) { 
    const originalHtml = btn.innerHTML;
    btn.innerHTML = "З'єднання з Google...";
    btn.disabled = true;
    
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
    } catch (error) {
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
            btn.innerHTML = "Перенаправлення...";
            await auth.signInWithRedirect(provider);
        } else {
            showErrorMsg("Помилка: " + error.message);
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

function logout() { 
    auth.signOut(); 
    closeAllSheets(); 
}

// Бібліотека
function loadLibrary() { 
    db.collection('users').doc(currentUser.uid).collection('books').orderBy('dateAdded', 'desc').onSnapshot(snap => { 
        myLibrary = []; 
        snap.forEach(doc => myLibrary.push({ id: doc.id, ...doc.data() })); 
        render(); 
    }); 
}

async function updateBookInFirestore(id, updates) { 
    if (currentUser) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('books').doc(id).update(updates);
        } catch (error) {
            console.error('Error updating book:', error);
        }
    }
}

// UI функції
function openSheet(id) { 
    document.body.classList.add('modal-open'); 
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open')); 
    document.getElementById(id).classList.add('open'); 
    document.querySelector('.backdrop').classList.remove('hidden'); 
}

function closeAllSheets() { 
    document.body.classList.remove('modal-open'); 
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open')); 
    document.querySelector('.backdrop').classList.add('hidden'); 
    toggleEditMode(false); 
}

function closeDetailsSheet() { 
    if(!document.getElementById('statusButtons').classList.contains('hidden')) {
        openSheet('searchSheet'); 
    } else {
        closeAllSheets(); 
    }
}

// Тема
function toggleAppTheme() { 
    document.body.classList.toggle('dark'); 
    localStorage.setItem('appTheme', document.body.classList.contains('dark') ? 'dark' : 'light'); 
}

function setViewMode(mode) { 
    viewMode = mode; 
    localStorage.setItem('viewMode', mode); 
    updateViewButtons(); 
    render(); 
}

function updateViewButtons() {
    const actCls = 'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-900 bg-white shadow-sm transition-all';
    const inactCls = 'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-all';
    document.getElementById('view_list').className = viewMode === 'list' ? actCls : inactCls; 
    document.getElementById('view_grid').className = viewMode === 'grid' ? actCls : inactCls;
}

// Сканер штрих-кодів
let html5QrCode;

function openScanner() {
    document.getElementById('scannerSheet').classList.remove('hidden');
    
    // Ініціалізація сканера
    html5QrCode = new Html5Qrcode("reader");
    const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 150 }, 
        aspectRatio: 1.0 
    };

    html5QrCode.start(
        { facingMode: "environment" }, 
        config, 
        (decodedText) => {
            if(navigator.vibrate) navigator.vibrate(100);
            closeScanner();
            
            // Переходимо до пошуку
            const searchInput = document.getElementById('searchInput');
            searchInput.value = decodedText;
            searchInput.dispatchEvent(new Event('input'));
            
            searchItems.innerHTML = `<div class="p-8 text-slate-400 text-sm text-center animate-pulse">Знайдено штрих-код: ${decodedText}<br>Шукаю книгу...</div>`;
        }, 
        (errorMessage) => {
            // Ігноруємо помилки парсингу (відбуваються кожен кадр)
        }
    ).catch((err) => {
        alert("Помилка доступу до камери: " + err);
        closeScanner();
    });
}

function closeScanner() {
    if(html5QrCode) { 
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(err => console.log("Error stopping scanner", err));
    }
    document.getElementById('scannerSheet').classList.add('hidden');
}

// Пошук книг
async function handleSearch(e) {
    clearTimeout(timeoutId); 
    const query = e.target.value.trim();
    
    if (query.length < 2) { 
        searchItems.innerHTML = ''; 
        return; 
    }
    
    searchItems.innerHTML = '<div class="p-8 text-slate-400 text-sm text-center animate-pulse">Шукаю у всіх базах (Google + Apple)...</div>';

    timeoutId = setTimeout(async () => {
        try {
            await performSearch(query);
        } catch (e) { 
            console.error('Search error:', e);
            searchItems.innerHTML = `<div class="p-8 text-red-500 text-sm text-center">Перевірте підключення</div>`; 
        }
    }, 600);
}

async function performSearch(query) {
    let allItems = [];
    const isAuthorSearch = query.startsWith('author:"') && query.endsWith('"');
    const rawQuery = isAuthorSearch ? query.slice(8, -1) : query;
    const safeQuery = encodeURIComponent(rawQuery);
    const safeQueryQuote = encodeURIComponent('"' + rawQuery + '"');
    
    let promises = [];
    const isIsbnSearch = /^[0-9-]{10,17}$/.test(rawQuery);

    if (isIsbnSearch) {
        const cleanIsbn = rawQuery.replace(/[^0-9]/g, '');
        promises.push(
            fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}&key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME`).catch(()=>({ok:false}))
        );
        promises.push(
            fetch(`https://www.googleapis.com/books/v1/volumes?q=${cleanIsbn}&key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME`).catch(()=>({ok:false}))
        );
        promises.push(
            fetch(`https://itunes.apple.com/search?term=${cleanIsbn}&entity=ebook&country=ua&limit=5`).catch(()=>({ok:false}))
        );
    } else if (isAuthorSearch) {
        promises.push(
            fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=inauthor:"${safeQuery}"&printType=books&maxResults=40`).catch(()=>({ok:false}))
        );
        promises.push(
            fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${safeQueryQuote}&printType=books&maxResults=40`).catch(()=>({ok:false}))
        );
        promises.push(
            fetch(`https://itunes.apple.com/search?term=${safeQuery}&entity=ebook&attribute=authorTerm&country=ua&limit=30`).catch(()=>({ok:false}))
        );
    } else {
        promises.push(
            fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=intitle:${safeQueryQuote}&printType=books&maxResults=20`).catch(()=>({ok:false}))
        );
        promises.push(
            fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${safeQuery}&printType=books&maxResults=20`).catch(()=>({ok:false}))
        );
        promises.push(
            fetch(`https://itunes.apple.com/search?term=${safeQuery}&entity=ebook&country=ua&limit=25`).catch(()=>({ok:false}))
        );
    }

    const responses = await Promise.all(promises);

    // Обробка результатів Google Books
    for (let i = 0; i < responses.length - 1; i++) {
        if (responses[i] && responses[i].ok) {
            const d = await responses[i].json();
            if (d.items) allItems.push(...d.items);
        }
    }
    
    // Обробка результатів Apple Books
    const appleRes = responses[responses.length - 1];
    if (appleRes && appleRes.ok) {
        const dApple = await appleRes.json();
        if (dApple.results) {
            dApple.results.forEach(book => {
                allItems.push({
                    id: 'apple_' + book.trackId,
                    volumeInfo: {
                        title: book.trackName,
                        authors: [book.artistName || 'Автор невідомий'],
                        pageCount: 300,
                        description: book.description ? book.description.replace(/(<([^>]+)>)/gi, "") : 'Знайдено в Apple Books.',
                        publishedDate: book.releaseDate ? book.releaseDate.substring(0, 4) : '',
                        imageLinks: { 
                            thumbnail: book.artworkUrl100 ? book.artworkUrl100.replace('100x100bb', '400x400bb') : null 
                        },
                        categories: book.genres || []
                    }
                });
            });
        }
    }

    if (allItems.length === 0) {
        searchItems.innerHTML = '<div class="p-8 text-slate-400 text-sm text-center">Нічого не знайдено</div>';
        return;
    }

    // Видалення дублікатів
    const uniqueItems = [];
    const seenKeys = new Set();
    
    allItems.forEach(item => {
        const b = item.volumeInfo;
        if (!b || !b.title) return;
        
        const key = (b.title.toLowerCase() + (b.authors ? b.authors[0].toLowerCase() : '')).replace(/[^a-zа-я0-9ієї]/gi, '');
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueItems.push(item);
        }
    });

    // Фільтрація
    const filteredItems = filterSearchResults(uniqueItems, rawQuery, isAuthorSearch, isIsbnSearch);
    
    if (filteredItems.length === 0) {
        searchItems.innerHTML = '<div class="p-8 text-slate-400 text-sm text-center">Не знайдено художніх книг за цим запитом.</div>';
        return;
    }

    // Сортування та відображення
    displaySearchResults(sortSearchResults(filteredItems, rawQuery, isAuthorSearch));
}

function filterSearchResults(items, rawQuery, isAuthorSearch, isIsbnSearch) {
    const badCategories = ['Science', 'Technology', 'Computers', 'Medical', 'Law', 'Business & Economics', 'Mathematics', 'Education', 'Study Aids', 'Religion'];

    return items.filter(item => {
        const b = item.volumeInfo;
        if (!b || !b.title) return false;
        
        if (isAuthorSearch) {
            const authorStr = (b.authors || []).join(' ').toLowerCase();
            return authorStr.includes(rawQuery.toLowerCase());
        }

        const isExactTitle = b.title.toLowerCase().includes(rawQuery.toLowerCase());
        
        if (!isIsbnSearch && !isExactTitle && b.categories && b.categories.some(c => badCategories.includes(c))) {
            return false;
        }
        
        return true;
    });
}

function sortSearchResults(items, rawQuery, isAuthorSearch) {
    if (isAuthorSearch) {
        return items.sort((a, b) => {
            const dateA = a.volumeInfo.publishedDate || '9999';
            const dateB = b.volumeInfo.publishedDate || '9999';
            return dateA.localeCompare(dateB);
        });
    }

    return items.sort((a, b) => {
        const tA = (a.volumeInfo.title || '').toLowerCase();
        const tB = (b.volumeInfo.title || '').toLowerCase();
        const qLower = rawQuery.toLowerCase();
        
        const exactA = tA === qLower;
        const exactB = tB === qLower;
        if (exactA && !exactB) return -1;
        if (!exactA && exactB) return 1;

        const startsA = tA.startsWith(qLower + ' ') || tA.startsWith(qLower + ':');
        const startsB = tB.startsWith(qLower + ' ') || tB.startsWith(qLower + ':');
        if (startsA && !startsB) return -1;
        if (!startsA && startsB) return 1;

        const inclA = tA.includes(qLower);
        const inclB = tB.includes(qLower);
        if (inclA && !inclB) return -1;
        if (!inclA && inclB) return 1;
        
        return 0;
    });
}

function displaySearchResults(items) {
    const limitedItems = items.slice(0, 30);
    searchItems.innerHTML = ''; 
    
    limitedItems.forEach(item => {
        const b = item.volumeInfo;
        const div = document.createElement('div');
        const genre = b.categories && b.categories.length > 0 ? b.categories[0] : '';
        const safeImage = (b.imageLinks?.thumbnail || PLACEHOLDER_IMG).replace(/^http:\/\//i, 'https://');
        
        const book = { 
            googleId: item.id || Math.random().toString(), 
            title: b.title || 'Без назви', 
            author: b.authors ? b.authors[0] : 'Автор невідомий', 
            pagesTotal: b.pageCount || 300, 
            image: safeImage, 
            description: b.description || 'Анотація відсутня.', 
            genre: genre,
            publishedDate: b.publishedDate || ''
        };
        
        div.className = "p-3 mx-2 my-1 hover:bg-slate-100 rounded-2xl cursor-pointer flex items-center gap-4 active:bg-slate-200 fade-in relative";
        div.innerHTML = `
            <img src="${book.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-12 h-16 object-cover rounded-lg shadow-sm">
            <div class="flex-1 min-w-0 pr-6">
                <div class="font-bold text-slate-900 truncate">${book.title}</div>
                <div class="text-xs text-slate-500 mt-0.5 truncate">${book.author}</div>
            </div>
        `;
        div.onclick = () => showBookDetails(book, true); 
        searchItems.appendChild(div);
    });
}

// Допоміжні функції
function isEnglishTitle(title) {
    if (!title) return true;
    const letters = title.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);
    if (!letters) return false;
    const engLetters = title.match(/[a-zA-Z]/g);
    return (engLetters && engLetters.length > (letters.length * 0.4));
}

function isCyrillic(str) { 
    return /[а-яА-ЯіІїЇєЄґҐ]/.test(str); 
}

window.searchAuthorBooks = function(authorName) {
    closeAllSheets(); 
    setTimeout(() => {
        const input = document.getElementById('searchInput');
        input.value = `author:"${authorName}"`; 
        openSheet('searchSheet');
        input.dispatchEvent(new Event('input'));
    }, 350); 
}

// Ручне додавання книги
function openManualForm() { 
    tempSelectedBook = 'manual'; 
    toggleEditMode(true); 
    document.getElementById('editTitle').value = ''; 
    document.getElementById('editAuthor').value = ''; 
    document.getElementById('editPages').value = ''; 
    document.getElementById('editImage').value = ''; 
    document.getElementById('statusButtons').classList.remove('hidden'); 
    openSheet('detailsSheet'); 
}

// Деталі книги
function showBookDetails(bookData, isNewFromSearch = false) {
    if (!bookData || !bookData.title) return;

    const libBook = myLibrary.find(b => (b.googleId && b.googleId === bookData.googleId) || b.id === bookData.id) || bookData;
    tempSelectedBook = isNewFromSearch ? bookData : null;
    toggleEditMode(false);

    const safeAuthor = (libBook.author || 'Невідомий').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeTitle = libBook.title || 'Без назви';
    const safePages = libBook.pagesTotal || 300;
    const safeDesc = libBook.description || 'Анотація відсутня.';

    let html = `
        <div class="flex justify-between items-start mb-4 fade-in mt-1">
            <div class="flex gap-5 w-full">
                <img src="${libBook.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-28 h-40 object-cover rounded-xl shadow-md border border-slate-100 flex-shrink-0">
                <div class="flex flex-col justify-center min-w-0 flex-1">
                    <h3 class="text-xl font-bold text-slate-900 leading-tight mb-2 break-words">${safeTitle}</h3>
                    <button onclick="window.searchAuthorBooks('${safeAuthor}')" class="text-left w-fit px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold mb-3 active:scale-95 transition-all truncate shadow-sm">👤 ${safeAuthor}</button>
                    <span class="px-2.5 py-1 w-fit rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 mb-3">📄 ${safePages} стор.</span>
                    ${!isNewFromSearch ? `
                        <select onchange="changeStatusFromDetails('${libBook.id}', this.value)" class="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none cursor-pointer">
                            <option value="planned" ${libBook.status === 'planned' ? 'selected' : ''}>⏳ В планах</option>
                            <option value="reading" ${libBook.status === 'reading' ? 'selected' : ''}>📖 Читаю зараз</option>
                            <option value="finished" ${libBook.status === 'finished' ? 'selected' : ''}>✅ Прочитано</option>
                        </select>
                    ` : ''}
                </div>
            </div>
        </div>`;
    
    if (!isNewFromSearch) {
        html += generateBookDetailsHTML(libBook);
    }
    
    html += `<div class="desc-scroll fade-in"><h4 class="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-wider">Анотація</h4><p class="text-sm text-slate-700 leading-relaxed text-justify">${safeDesc}</p></div>`;
    
    if (!isNewFromSearch) {
        html += `<div class="mt-8 mb-2 flex justify-center fade-in"><button onclick="deleteBookFromDetails('${libBook.id}')" class="flex items-center gap-2 px-6 py-3 text-red-500 bg-red-50 hover:bg-red-100 rounded-xl font-bold text-sm active:scale-95 transition-all shadow-sm">🗑️ Видалити книгу з бібліотеки</button></div>`;
    }

    document.getElementById('detailsContent').innerHTML = html;
    if (isNewFromSearch) {
        document.getElementById('statusButtons').classList.remove('hidden'); 
    } else {
        document.getElementById('statusButtons').classList.add('hidden');
    }
    openSheet('detailsSheet');
}

function generateBookDetailsHTML(libBook) {
    let html = `
        <div class="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl shadow-sm fade-in">
            <h4 class="text-[9px] font-black uppercase text-indigo-500 tracking-wider mb-3 flex items-center gap-1">📖 Читалка (Офлайн)</h4>
            <div class="space-y-2">
                <button onclick="readSavedEpub('${libBook.id}')" class="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md active:scale-95 transition-transform flex items-center justify-center gap-2">📱 Читати збережений файл</button>
                <div class="relative w-full">
                    <input type="file" id="epubFileModal_${libBook.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event, '${libBook.id}')">
                    <button onclick="document.getElementById('epubFileModal_${libBook.id}').click()" class="w-full py-3 bg-white text-indigo-700 border border-indigo-200 rounded-xl font-bold text-sm active:scale-95 transition-transform shadow-sm flex items-center justify-center gap-2">📥 Завантажити новий .epub</button>
                </div>
            </div>
        </div>

        <div class="mb-6 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm fade-in">
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

    let starsHtml = ''; 
    const currentRating = libBook.rating || 0;
    for(let i=1; i<=5; i++) {
        starsHtml += `<span onclick="setRating('${libBook.id}', ${i})" class="text-4xl cursor-pointer ${currentRating >= i ? 'text-slate-400' : 'text-slate-200'} active:scale-90 transition-transform">★</span>`;
    }
    
    html += `
        <div class="mb-6 text-center fade-in bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div class="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-wider">Моя оцінка</div>
            <div class="flex justify-center gap-3">${starsHtml}</div>
        </div>
        
        <div class="mb-6 bg-slate-50 p-5 rounded-3xl border border-slate-100 fade-in shadow-sm">
            <h4 class="text-[10px] font-black uppercase text-slate-500 mb-3 flex justify-between items-center tracking-wider">
                Нотатки 
                <button onclick="saveReview('${libBook.id}')" class="text-indigo-600 bg-indigo-100 px-4 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-transform shadow-sm">Зберегти</button>
            </h4>
            <textarea id="reviewText_${libBook.id}" class="w-full bg-transparent text-sm text-slate-700 outline-none resize-none min-h-[80px]" placeholder="Напишіть свої враження тут...">${libBook.review || ''}</textarea>
        </div>`;

    return html;
}

// Продовження у наступному файлі...
