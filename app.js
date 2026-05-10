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

// Управління книгами
function deleteBookFromDetails(id) { 
    if(confirm("Видалити цю книгу назавжди?")) { 
        db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete(); 
        closeAllSheets(); 
    } 
}

function setRating(id, rating) { 
    updateBookInFirestore(id, { rating: rating }); 
    setTimeout(() => { 
        showBookDetails(myLibrary.find(b => b.id === id)); 
    }, 100); 
}

function changeStatusFromDetails(id, newStatus) {
    const updates = { status: newStatus }; 
    const book = myLibrary.find(b => b.id === id); 
    if (newStatus === 'finished') { 
        updates.pagesRead = book.pagesTotal; 
        updates.dateFinished = book.dateFinished || new Date().toISOString().slice(0, 10); 
    } else if (newStatus === 'reading') { 
        updates.dateStarted = book.dateStarted || new Date().toISOString().slice(0, 10); 
    }
    updateBookInFirestore(id, updates); 
    closeAllSheets(); 
    setLibraryTab(newStatus); 
}

function toggleEditMode(isEditing) { 
    if(isEditing) { 
        document.getElementById('detailsContent').classList.add('hidden'); 
        document.getElementById('editContent').classList.remove('hidden'); 
    } else { 
        document.getElementById('detailsContent').classList.remove('hidden'); 
        document.getElementById('editContent').classList.add('hidden'); 
    } 
}

function saveBookEdits() {
    const updates = { 
        title: document.getElementById('editTitle').value.trim() || 'Без назви', 
        author: document.getElementById('editAuthor').value.trim() || 'Невідомий', 
        pagesTotal: parseInt(document.getElementById('editPages').value) || 300, 
        image: document.getElementById('editImage').value.trim() 
    }; 
    
    if(tempSelectedBook === 'manual') { 
        tempSelectedBook = { ...updates, description: 'Додано вручну.' }; 
        toggleEditMode(false); 
        showBookDetails(tempSelectedBook, true); 
    } else { 
        updateBookInFirestore(tempSelectedBook.id, updates); 
        showBookDetails({ ...tempSelectedBook, ...updates }); 
    } 
}

function saveReview(id) { 
    updateBookInFirestore(id, { review: document.getElementById(`reviewText_${id}`).value }); 
}

async function addBookWithStatus(status) {
    if (!currentUser) return; 
    
    if(tempSelectedBook === 'manual') saveBookEdits(); 
    
    let newBookData = { 
        ...tempSelectedBook, 
        status: status, 
        pagesRead: status === 'finished' ? tempSelectedBook.pagesTotal : 0, 
        dateAdded: Date.now(), 
        rating: 0, 
        review: '', 
        epubUrl: null, 
        timeSpent: 0, 
        lastFileName: null, 
        dateStarted: status === 'reading' ? new Date().toISOString().slice(0, 10) : null, 
        dateFinished: status === 'finished' ? new Date().toISOString().slice(0, 10) : null 
    }; 
    
    await db.collection('users').doc(currentUser.uid).collection('books').add(newBookData); 
    tempSelectedBook = null; 
    closeAllSheets();
}

function changeStatus(id, newStatus, event) {
    event.stopPropagation(); 
    const updates = { status: newStatus }; 
    const book = myLibrary.find(b => b.id === id); 
    
    if (newStatus === 'reading' && !book.dateStarted) {
        updates.dateStarted = new Date().toISOString().slice(0, 10);
    }
    if (newStatus === 'finished') { 
        updates.pagesRead = book.pagesTotal; 
        updates.dateFinished = new Date().toISOString().slice(0, 10); 
    }
    
    updateBookInFirestore(id, updates); 
    setLibraryTab(newStatus); 
}

function saveManualDate(id, field, dateEl) { 
    updateBookInFirestore(id, { [field]: dateEl.value }); 
    const book = myLibrary.find(b => b.id === id); 
    if (book) book[field] = dateEl.value; 
    if(navigator.vibrate) navigator.vibrate(50); 
}

// Читалка EPUB
function startTimer() { 
    readingStartTime = Date.now(); 
    currentSessionSeconds = 0; 
    document.getElementById('readerTimer').innerText = "00:00"; 
    readingTimer = setInterval(() => { 
        currentSessionSeconds = Math.floor((Date.now() - readingStartTime) / 1000); 
        const m = String(Math.floor(currentSessionSeconds / 60)).padStart(2, '0'); 
        const s = String(currentSessionSeconds % 60).padStart(2, '0'); 
        const h = Math.floor(currentSessionSeconds / 3600); 
        document.getElementById('readerTimer').innerText = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`; 
    }, 1000); 
}

function stopTimer() { 
    if (readingTimer && currentReaderBookId) { 
        clearInterval(readingTimer); 
        readingTimer = null; 
        const book = myLibrary.find(b => b.id === currentReaderBookId); 
        if (book && currentSessionSeconds > 5) { 
            const totalTime = (book.timeSpent || 0) + currentSessionSeconds; 
            db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ timeSpent: totalTime }); 
        } 
    } 
}

window.addEventListener('beforeunload', stopTimer);

function toggleReaderSettings() { 
    document.getElementById('readerSettingsMenu').classList.toggle('hidden'); 
}

function applyReaderSettings() { 
    if(!rendition) return; 
    rendition.themes.fontSize(readerFontSize + "%"); 
    rendition.themes.select(readerTheme); 
}

function changeFontSize(delta) { 
    readerFontSize = Math.max(50, Math.min(200, readerFontSize + delta)); 
    localStorage.setItem('readerFontSize', readerFontSize); 
    applyReaderSettings(); 
}

function changeReaderTheme(theme) { 
    readerTheme = theme; 
    localStorage.setItem('readerTheme', theme); 
    applyReaderSettings(); 
}

function initSwipeGestures() { 
    const viewerEl = document.getElementById('viewer'); 
    if(!window.mc) { 
        window.mc = new Hammer(viewerEl); 
        window.mc.get('swipe').set({ direction: Hammer.DIRECTION_HORIZONTAL }); 
        window.mc.on("swipeleft", () => { if (rendition) rendition.next(); }); 
        window.mc.on("swiperight", () => { if (rendition) rendition.prev(); }); 
    } 
}

function handleFileSelect(event, bookId) {
    const file = event.target.files[0]; 
    if (!file) return; 
    if (!file.name.toLowerCase().endsWith('.epub')) { 
        alert("Будь ласка, виберіть файл у форматі .epub"); 
        event.target.value = ''; 
        return; 
    }
    
    const bookData = myLibrary.find(b => b.id === bookId);
    if (bookData.lastFileName && bookData.lastFileName !== file.name) { 
        const isSure = confirm(`⚠️ Увага!\nМинулого разу ви читали: "${bookData.lastFileName}"\nЗараз обрали: "${file.name}"\nЯкщо це інша книга, прогрес зіб'ється. Ви впевнені?`); 
        if (!isSure) { 
            event.target.value = ''; 
            return; 
        } 
    }
    
    if (bookData.lastFileName !== file.name) {
        updateBookInFirestore(bookId, { lastFileName: file.name });
    }
    
    startReaderUI(bookData); 
    const reader = new FileReader(); 
    reader.onload = function(e) { 
        loadEpubData(e.target.result, bookData); 
    }; 
    reader.onerror = function() { 
        alert("Помилка."); 
        closeReader(); 
    }; 
    reader.readAsArrayBuffer(file); 
    event.target.value = ''; 
}

async function handleFileSelectAndSave(event, bookId) {
    const file = event.target.files[0]; 
    if (!file) return; 
    if (!file.name.toLowerCase().endsWith('.epub')) { 
        alert("Будь ласка, виберіть файл .epub"); 
        event.target.value = ''; 
        return; 
    }

    const bookData = myLibrary.find(b => b.id === bookId);
    if (bookData && bookData.lastFileName && bookData.lastFileName !== file.name) { 
        const isSure = confirm(`⚠️ Увага!\nМинулого разу ви читали: "${bookData.lastFileName}"\nЗараз обрали: "${file.name}"\nЯкщо це інша книга, прогрес зіб'ється. Ви впевнені?`); 
        if (!isSure) { 
            event.target.value = ''; 
            return; 
        } 
    }
    
    if (bookData && bookData.lastFileName !== file.name) {
        updateBookInFirestore(bookId, { lastFileName: file.name });
    }

    const reader = new FileReader(); 
    document.getElementById('readerProgress').innerText = "Збереження...";
    startReaderUI(bookData); 

    reader.onload = async function(e) { 
        const arrayBuffer = e.target.result;
        try {
            if (window.localforage) {
                await localforage.setItem(`epub_${bookId}`, arrayBuffer);
            }
        } catch(err) { 
            console.error("Error saving offline:", err); 
        }

        document.getElementById('readerProgress').innerText = "Завантаження...";
        loadEpubData(arrayBuffer, bookData); 
        closeAllSheets();
    }; 
    reader.onerror = function() { 
        alert("Помилка читання файлу."); 
        closeReader(); 
    }; 
    reader.readAsArrayBuffer(file); 
    event.target.value = ''; 
}

async function readSavedEpub(bookId) {
    if (!window.localforage) { 
        alert("Офлайн сховище не підтримується."); 
        return; 
    }
    
    const bookData = myLibrary.find(b => b.id === bookId);
    if (!bookData) return;

    startReaderUI(bookData);
    document.getElementById('readerProgress').innerText = "Завантаження з пам'яті...";

    try {
        const arrayBuffer = await localforage.getItem(`epub_${bookId}`);
        if (!arrayBuffer) {
            closeReader();
            alert("Книгу не знайдено на пристрої! Завантажте новий файл .epub.");
            return;
        }
        loadEpubData(arrayBuffer, bookData);
        closeAllSheets();
    } catch(e) {
        closeReader();
        alert("Помилка завантаження збереженого файлу.");
    }
}

function promptForEpubUrl(bookId, event) { 
    event.stopPropagation(); 
    const url = prompt("Пряме веб-посилання на файл .epub:"); 
    if(url) updateBookInFirestore(bookId, { epubUrl: url }); 
}

function openReaderFromUrl(bookId, url, event) { 
    event.stopPropagation(); 
    const bookData = myLibrary.find(b => b.id === bookId); 
    startReaderUI(bookData); 
    loadEpubData('https://corsproxy.io/?' + encodeURIComponent(url), bookData); 
}

function startReaderUI(bookData) { 
    currentReaderBookId = bookData.id; 
    document.getElementById('readerOverlay').style.display = 'flex'; 
    document.getElementById('readerTitle').innerText = bookData.title; 
    document.getElementById('readerProgress').innerText = "Завантаження..."; 
    document.getElementById('librarySections').classList.add('hidden'); 
    startTimer(); 
    initSwipeGestures(); 
}

function loadEpubData(source, bookData) {
    document.getElementById('viewer').innerHTML = ''; 
    try {
        currentBookInstance = ePub(source); 
        rendition = currentBookInstance.renderTo("viewer", { 
            width: "100%", 
            height: "100%", 
            spread: "none", 
            manager: "continuous", 
            flow: "paginated" 
        });
        
        // Реєстрація тем
        rendition.themes.register("light", { 
            "body": { "background": "#f8fafc", "color": "#0f172a" }
        }); 
        rendition.themes.register("sepia", { 
            "body": { "background": "#f4ecd8", "color": "#5b4636" }
        }); 
        rendition.themes.register("dark", { 
            "body": { "background": "#0f172a", "color": "#cbd5e1" }
        });
        
        applyReaderSettings();

        // Обробка прогресу читання
        rendition.on("relocated", function(location) {
            if (location && location.start && location.start.cfi) {
                bookData.lastCfi = location.start.cfi;
                if (window.syncProgressTimeout) clearTimeout(window.syncProgressTimeout);
                window.syncProgressTimeout = setTimeout(() => {
                    updateBookInFirestore(bookData.id, { lastCfi: location.start.cfi });
                }, 5000);
            }
        });

        // Обробка цитат та виділень
        rendition.on("selected", function(cfiRange, contents) {
            rendition.annotations.highlight(cfiRange, {}, (e) => {});
            currentBookInstance.getRange(cfiRange).then(function(range) {
                if (range) {
                    const text = range.toString();
                    const reviewEl = document.getElementById(`reviewText_${bookData.id}`);
                    if(reviewEl) {
                        reviewEl.value += `\n\n> "${text}"\n`;
                        saveReview(bookData.id);
                        if(navigator.vibrate) navigator.vibrate([50, 50, 50]);
                    }
                }
            });
            contents.window.getSelection().removeAllRanges();
        });

        const safeCfi = (bookData.lastCfi && typeof bookData.lastCfi === 'string' && bookData.lastCfi.startsWith('epubcfi')) ? bookData.lastCfi : undefined;
        rendition.display(safeCfi).catch(() => rendition.display());
        
        currentBookInstance.ready.then(() => currentBookInstance.locations.generate(1600)).then(() => { 
            const loc = rendition.currentLocation(); 
            if(loc && loc.start) {
                document.getElementById('readerProgress').innerText = Math.round(loc.start.percentage * 100) + "%"; 
            } else {
                document.getElementById('readerProgress').innerText = "Відкрито"; 
            }
        }).catch(err => console.log(err));
        
        rendition.on("relocated", (location) => {
            if (location && location.start) {
                let percent = 0; 
                if (location.start.percentage) percent = Math.round(location.start.percentage * 100); 
                document.getElementById('readerProgress').innerText = percent > 0 ? percent + "%" : "Рахуємо...";
                
                if (percent > 0) {
                    db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ 
                        lastCfi: location.start.cfi, 
                        pagesRead: Math.round((percent / 100) * (bookData.pagesTotal || 300)) 
                    }); 
                } else {
                    db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({ 
                        lastCfi: location.start.cfi 
                    }); 
                }
            }
        });
    } catch (err) { 
        console.error(err); 
        document.getElementById('readerProgress').innerText = "Помилка"; 
        stopTimer(); 
    }
}

function closeReader() { 
    stopTimer(); 
    document.getElementById('readerOverlay').style.display = 'none'; 
    document.getElementById('readerSettingsMenu').classList.add('hidden'); 
    if(currentBookInstance) { 
        currentBookInstance.destroy(); 
        currentBookInstance = null; 
        rendition = null; 
    } 
    document.getElementById('viewer').innerHTML = ''; 
    document.getElementById('librarySections').classList.remove('hidden'); 
}

function deleteBook(id, event) { 
    event.stopPropagation(); 
    if(confirm("Видалити книгу?")) {
        db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete(); 
    }
}

function formatTime(secs) { 
    if (!secs) return "0 хв"; 
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60); 
    return h > 0 ? `${h} год ${m} хв` : `${m} хв`; 
}

// Відображення бібліотеки
function setLibraryTab(tab) { 
    currentLibraryTab = tab; 
    document.querySelectorAll('#libraryTabs button').forEach(btn => { 
        btn.className = 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all duration-200 bg-slate-200 text-slate-600 dark-inactive-tab active:scale-95'; 
    }); 
    document.getElementById('tab_' + tab).className = 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all duration-200 bg-indigo-600 text-white shadow-md active:scale-95'; 
    render(); 
}

function renderBookCard(book) {
    const percent = Math.round((book.pagesRead / book.pagesTotal) * 100) || 0;
    const isFinished = book.status === 'finished'; 
    const isPlanned = book.status === 'planned'; 
    const isReading = book.status === 'reading';

    if (viewMode === 'grid') {
        return `<div data-id="${book.id}" onclick="showBookDetails(${JSON.stringify(book).replace(/"/g, '&quot;')})" class="flex flex-col items-center cursor-pointer fade-in active:scale-[0.98] transition-transform ${isFinished ? 'opacity-80' : ''}">
            <div class="relative w-full aspect-[2/3]">
                <img src="${book.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-full h-full rounded-xl shadow-md object-cover border border-slate-200">
                ${isFinished && book.rating ? `<div class="absolute -bottom-2 -right-2 bg-white text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm border border-slate-100">★${book.rating}</div>` : ''}
            </div>
            <h3 class="font-bold text-slate-900 text-[11px] leading-tight mt-2 w-full text-center truncate px-1">${book.title}</h3>
        </div>`;
    }

    return `
    <div data-id="${book.id}" onclick="showBookDetails(${JSON.stringify(book).replace(/"/g, '&quot;')})" class="bg-white p-4 rounded-[1.25rem] shadow-sm flex gap-4 items-start cursor-pointer border border-slate-100 fade-in active:scale-[0.98] transition-transform ${isFinished ? 'opacity-80' : ''}">
        <img src="${book.image || PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-16 h-24 rounded-xl shadow-sm object-cover flex-shrink-0 border border-slate-100">
        <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <h3 class="font-bold text-slate-900 text-[15px] leading-snug truncate">${book.title}</h3>
                    <p class="text-[13px] text-slate-500 mt-0.5 truncate">${book.author}</p>
                </div>
                <button onclick="deleteBook('${book.id}', event)" class="text-slate-300 hover:text-red-500 flex-shrink-0 transition-colors p-1">✕</button>
            </div>
            ${isPlanned ? `
                <button onclick="changeStatus('${book.id}', 'reading', event)" class="w-full mt-4 py-2 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg active:scale-95 transition-transform">🚀 Почати читати</button>
            ` : `
                <div class="mt-3 mb-1.5 flex items-center gap-2">
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
                        <div class="progress-bar bg-indigo-600 h-full rounded-full" style="width: ${percent}%"></div>
                    </div>
                    ${isReading ? `
                        <button onclick="changeStatus('${book.id}', 'finished', event)" class="shrink-0 bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded text-[10px] font-bold active:scale-95 transition-transform" title="Завершити">✅ Завершити</button>
                    ` : ''}
                </div>
                <div class="flex items-center justify-between text-[11px] font-bold mt-1 mb-2">
                    <span class="text-slate-400 uppercase tracking-wider">⏱️ ${formatTime(book.timeSpent)}</span>
                    <span class="text-indigo-600">${percent}%</span>
                </div>
                <div class="space-y-1.5 border-t border-slate-50 pt-2.5 text-[10px] text-slate-500">
                    ${book.dateStarted ? `
                        <div class="flex items-center justify-between">
                            <span>Почато:</span>
                            <input type="date" value="${book.dateStarted}" class="date-input" onchange="saveManualDate('${book.id}', 'dateStarted', this)" onclick="event.stopPropagation()">
                        </div>
                    ` : ''}
                    ${book.dateFinished ? `
                        <div class="flex items-center justify-between">
                            <span>Закінчено:</span>
                            <input type="date" value="${book.dateFinished}" class="date-input" onchange="saveManualDate('${book.id}', 'dateFinished', this)" onclick="event.stopPropagation()">
                        </div>
                    ` : ''}
                </div>
                <div class="mt-3 flex flex-col gap-1.5 border-t border-slate-50 pt-3">
                    ${book.epubUrl ? `
                        <button onclick="openReaderFromUrl('${book.id}', '${book.epubUrl}', event)" class="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold active:scale-95 transition-transform shadow-sm">☁️ Читати онлайн</button>
                        <button onclick="promptForEpubUrl('${book.id}', event)" class="w-full text-[10px] text-slate-400">Змінити посилання</button>
                    ` : `
                        <button onclick="promptForEpubUrl('${book.id}', event)" class="w-full py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold active:scale-95 transition-transform">🔗 Додати URL (.epub)</button>
                    `}
                    <div class="relative w-full">
                        <input type="file" id="epubFile_${book.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event, '${book.id}')">
                        <button onclick="event.stopPropagation(); document.getElementById('epubFile_${book.id}').click();" class="w-full py-2 bg-slate-800 text-white rounded-lg text-xs font-bold active:scale-95 transition-transform shadow-sm">📁 Файл з пристрою</button>
                    </div>
                </div>
            `}
        </div>
    </div>`;
}

function render() {
    const reading = myLibrary.filter(b => b.status === 'reading'); 
    const planned = myLibrary.filter(b => b.status === 'planned'); 
    const finished = myLibrary.filter(b => b.status === 'finished');
    
    document.getElementById('tab_reading').innerText = `Читаю зараз (${reading.length})`; 
    document.getElementById('tab_planned').innerText = `Хочу прочитати (${planned.length})`; 
    document.getElementById('tab_finished').innerText = `Прочитано (${finished.length})`;
    
    const container = document.getElementById('myBooksContainer');
    
    if ((currentLibraryTab === 'reading' && reading.length === 0) || 
        (currentLibraryTab === 'planned' && planned.length === 0) || 
        (currentLibraryTab === 'finished' && finished.length === 0)) { 
        container.innerHTML = `
            <div class="mt-10 text-center px-6">
                <span class="text-4xl block mb-4">📚</span>
                <h3 class="text-xl font-bold text-slate-900 mb-2">Тут поки порожньо</h3>
                <p class="text-slate-500 text-sm">Додайте сюди книги!</p>
            </div>
        `; 
        return; 
    }
    
    container.classList.remove('fade-in'); 
    void container.offsetWidth; 
    container.classList.add('fade-in');
    
    const wrapperClass = viewMode === 'grid' ? 'grid grid-cols-3 gap-4 sortable-list' : 'space-y-3 sortable-list';
    
    if (currentLibraryTab === 'reading') { 
        container.innerHTML = `<div class="${wrapperClass}">${reading.map(renderBookCard).join('')}</div>`; 
    } else if (currentLibraryTab === 'planned') { 
        container.innerHTML = `<div class="${wrapperClass}">${planned.map(renderBookCard).join('')}</div>`; 
    } else if (currentLibraryTab === 'finished') {
        finished.sort((a, b) => { 
            const dateA = a.dateFinished || '1970-01-01'; 
            const dateB = b.dateFinished || '1970-01-01'; 
            return dateB.localeCompare(dateA); 
        });
        
        const grouped = {}; 
        finished.forEach(b => { 
            let year = 'Без дати'; 
            try { 
                if (b.dateFinished && typeof b.dateFinished === 'string') {
                    year = b.dateFinished.substring(0, 4); 
                } else if (b.dateFinished && typeof b.dateFinished === 'number') {
                    year = new Date(b.dateFinished).getFullYear().toString(); 
                } else if (b.dateAdded) {
                    year = new Date(b.dateAdded).getFullYear().toString(); 
                } 
            } catch(e) {} 
            if(!grouped[year]) grouped[year] = []; 
            grouped[year].push(b); 
        });
        
        let html = ''; 
        Object.keys(grouped).sort((a, b) => { 
            if (a === 'Без дати') return 1; 
            if (b === 'Без дати') return -1; 
            return b - a; 
        }).forEach(year => { 
            html += `
                <h2 class="font-black text-slate-300 text-lg mt-6 mb-3 tracking-widest">${year}</h2>
                <div class="${wrapperClass}">${grouped[year].map(renderBookCard).join('')}</div>
            `; 
        });
        
        container.innerHTML = html;
    }

    if (viewMode === 'grid') {
        document.querySelectorAll('.sortable-list').forEach(list => {
            new Sortable(list, { 
                delay: 300, 
                delayOnTouchOnly: true, 
                animation: 150, 
                ghostClass: 'sortable-ghost' 
            });
        });
    }
}

// Перемикання вкладок
function switchTab(tab) {
    document.getElementById('appScreen').classList.remove('hidden'); 
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    
    if (tab === 'library') { 
        navItems[0].classList.add('active'); 
        const lib = document.getElementById('librarySections'); 
        lib.classList.remove('hidden', 'fade-in'); 
        void lib.offsetWidth; 
        lib.classList.add('fade-in'); 
        document.getElementById('recommendationsScreen').classList.add('hidden'); 
    } else if (tab === 'recommendations') { 
        navItems[1].classList.add('active'); 
        const rec = document.getElementById('recommendationsScreen'); 
        rec.classList.remove('hidden', 'fade-in'); 
        void rec.offsetWidth; 
        rec.classList.add('fade-in'); 
        document.getElementById('librarySections').classList.add('hidden'); 
        if(!currentRecCategory) loadRealRecommendations('auto', 'rec_auto'); 
    }
}

// Статистика
function calculateStats() {
    const finished = myLibrary.filter(b => b.status === 'finished');
    const totalPages = finished.reduce((sum, b) => sum + (parseInt(b.pagesTotal) || 0), 0);
    
    document.getElementById('statBooks').innerText = finished.length; 
    document.getElementById('statPages').innerText = totalPages;

    const ctx = document.getElementById('statsChart');
    if(!ctx) return;
    
    const months = {};
    finished.forEach(b => {
        if(b.dateFinished) {
            const m = (typeof b.dateFinished === 'string' && b.dateFinished.length >= 7) ? b.dateFinished.substring(0, 7) : 'Без дати';
            if(m !== 'Без дати') months[m] = (months[m] || 0) + 1;
        }
    });
    
    const labels = Object.keys(months).sort();
    const data = labels.map(l => months[l]);

    if(window.myChart) window.myChart.destroy();
    
    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'Прочитано книг', 
                data: data, 
                backgroundColor: '#4f46e5', 
                borderRadius: 4 
            }] 
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, 
            scales: { 
                y: { beginAtZero: true, ticks: { stepSize: 1 } } 
            } 
        }
    });
}

// Експорт та кеш
function exportLibrary() {
    if (myLibrary.length === 0) return alert('Бібліотека порожня!');
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(myLibrary, null, 2));
    const dlAnchorElem = document.createElement('a'); 
    dlAnchorElem.setAttribute("href", dataStr); 
    dlAnchorElem.setAttribute("download", "chitayko_backup.json"); 
    dlAnchorElem.click();
}

function clearAppCache() {
    if ('caches' in window) {
        caches.keys().then(names => { 
            for (let name of names) caches.delete(name); 
        });
    }
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => { 
            for (let reg of regs) reg.unregister(); 
        });
    }
    
    alert('Кеш очищено! Застосунок буде перезавантажено.'); 
    setTimeout(() => { 
        window.location.reload(true); 
    }, 500);
}

// Рекомендації
const curatedCategories = {
    'Академія магії': ['"академия магии" фэнтези', '"магическая академия"', 'ромфант академия', 'академия волшебства', 'студентка академии магии', '"академия" фэнтези'],
    'Фентезі': ['"фентезі" бестселер', '"фэнтези" бестселлер', 'эпическое фэнтези', 'попаданцы фэнтези', 'Джон Толкин', 'Джордж Мартин', 'Анджей Сапковский', 'Терри Пратчетт', 'Робин Хобб', 'Брэндон Сандерсон', 'Роберт Джордан', 'Ник Перумов', 'Алексей Пехов', 'Макс Фрай', 'боевое фэнтези', 'героическое фэнтези'],
    'Детектив': ['"детектив" бестселер', '"детектив" бестселлер', 'Агата Кристи', 'Артур Конан Дойл', 'Ю Несбё', 'Жан-Кристоф Гранже', 'Стиг Ларссон', 'Джеймс Чейз', 'Борис Акунин', 'Татьяна Устинова', 'Рекс Стаут', 'психологический детектив', 'триллер детектив'],
    'Трилер': ['"трилер" бестселер', '"триллер" бестселлер', 'Стивен Кинг', 'Джиллиан Флинн', 'Томас Харрис', 'Дэн Браун', 'Джон Маррс', 'Франк Тилье', 'психологический триллер', 'мистический триллер'],
    'Романтика': ['"любовний роман" бестселер', '"любовный роман" бестселлер', 'Николас Спаркс', 'Джоджо Мойес', 'Колин Гувер', 'Джейн Остин', 'Эмили Бронте', 'Сара Джио', 'Эмма Скотт', 'современный любовный роман', 'исторический любовный роман'],
    'Саморозвиток': ['"саморозвиток" бестселер', '"саморазвитие" бестселлер', 'Роберт Кийосаки', 'Марк Мэнсон', 'Джо Диспенза', 'Джеймс Клир', 'Стивен Кови', 'Брайан Трейси', 'психология успеха', 'мотивация', 'личная эффективность'],
    'Фантастика': ['"наукова фантастика" бестселер', '"научная фантастика" бестселлер', 'Фрэнк Герберт Дюна', 'Айзек Азимов', 'Рэй Брэдбери', 'Джордж Оруэлл', 'Энди Вейер', 'Артур Кларк', 'Роберт Хайнлайн', 'Дэн Симмонс', 'Братья Стругацкие', 'Сергей Лукьяненко', 'космическая фантастика', 'киберпанк', 'постапокалипсис']
};

async function loadRealRecommendations(category = 'auto', btnId = 'rec_auto') {
    if (currentRecCategory === category) return;
    
    currentRecCategory = category;
    recStartIndex = 0;
    currentRecQueryIndex = 0;
    currentRecQueries = [];
    shownRecTitles.clear();

    const list = document.getElementById('recommendationsList');
    list.innerHTML = `
        <div class="p-8 flex flex-col items-center justify-center text-slate-400 text-sm fade-in animate-pulse w-full">
            <span class="text-3xl mb-3">🔍</span>
            Шукаємо круті книги...
        </div>
    `;

    document.querySelectorAll('#recTabs button').forEach(btn => { 
        btn.className = 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap bg-slate-200 text-slate-600 dark-inactive-tab transition-all active:scale-95'; 
    });
    
    if (document.getElementById(btnId)) {
        document.getElementById(btnId).className = 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap bg-indigo-600 text-white shadow-md transition-all active:scale-95';
    }

    let pool = [];
    if (category === 'auto') {
        let authors = myLibrary.map(b => b.author).filter(a => a && a.length > 2 && !a.toLowerCase().includes('невідомий') && !a.toLowerCase().includes('автор'));
        if (authors.length > 0) {
            let counts = {}; 
            authors.forEach(a => counts[a] = (counts[a] || 0) + 1);
            let topAuthors = Object.keys(counts).sort((a,b) => counts[b] - counts[a]).slice(0, 10);
            pool.push(...topAuthors.map(a => `inauthor:"${a}"`));
        }
        let generic = Object.values(curatedCategories).flat();
        generic.sort(() => 0.5 - Math.random());
        pool.push(...generic);
    } else {
        pool = [...curatedCategories[category]];
        pool.sort(() => 0.5 - Math.random());
    }
    
    currentRecQueries = pool;
    await fetchMoreRecommendations(true);
}

async function fetchMoreRecommendations(isFirstLoad = false) {
    if (isFetchingRecs || currentRecQueryIndex >= currentRecQueries.length) return;
    isFetchingRecs = true;

    const lst = document.getElementById('recommendationsList');
    if (!isFirstLoad && !document.getElementById('recLoadingMore')) {
        const d = document.createElement('div');
        d.id = 'recLoadingMore';
        d.className = 'py-6 text-center text-slate-400 animate-pulse text-sm w-full block';
        d.innerHTML = 'Завантажуємо ще...';
        lst.appendChild(d);
    }

    let finalBooks = [];
    let consecutiveEmptyFetches = 0;

    while (finalBooks.length < 5 && currentRecQueryIndex < currentRecQueries.length && consecutiveEmptyFetches < 3) {
        const q = currentRecQueries[currentRecQueryIndex];
        const url = `https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${encodeURIComponent(q)}&maxResults=40&startIndex=${recStartIndex}`;
        
        try {
            const res = await fetch(url).then(r => r.ok ? r.json() : {items:[]}).catch(()=>({items:[]}));
            let items = res.items || [];
            
            if (items.length < 30) {
                currentRecQueryIndex++;
                recStartIndex = 0;
            } else {
                recStartIndex += 40;
            }

            const badWords = ['учебник','словарь','журнал','комикс','манга','підручник','словник','вісник','сборник','збірник','посібник','пособие','том ','випуск','выпуск','зошит','тетрадь','хрестоматия','дневник'];
            const existingTitles = new Set(myLibrary.map(b => (b.title||'').trim().toLowerCase()));

            let valid = items.filter(item => {
                const b = item.volumeInfo;
                if (!b.title || !b.description || b.description.length < 20) return false;
                if (b.pageCount !== undefined && b.pageCount > 0 && b.pageCount < 40) return false;
                if (!isCyrillic(b.title) || isEnglishTitle(b.title)) return false;

                const tLower = b.title.toLowerCase();
                if (badWords.some(bw => tLower.includes(bw))) return false;
                if (existingTitles.has(tLower)) return false;
                
                const key = tLower + (b.authors ? b.authors[0] : '');
                if (shownRecTitles.has(key)) return false;
                
                return true;
            });

            const u = new Map(); 
            valid.forEach(i => {
                const b = i.volumeInfo;
                const key = b.title.toLowerCase() + (b.authors ? b.authors[0] : '');
                u.set(key, i);
            });
            
            let uniqueBatch = Array.from(u.values());
            uniqueBatch.forEach(i => {
                const b = i.volumeInfo;
                const key = b.title.toLowerCase() + (b.authors ? b.authors[0] : '');
                shownRecTitles.add(key);
                finalBooks.push(i);
            });

            if (uniqueBatch.length === 0) consecutiveEmptyFetches++;
            else consecutiveEmptyFetches = 0;

        } catch (e) {
            consecutiveEmptyFetches++;
            currentRecQueryIndex++; 
            recStartIndex = 0;
        }
    }

    if (isFirstLoad) lst.innerHTML = '';
    if (document.getElementById('recLoadingMore')) document.getElementById('recLoadingMore').remove();

    if (finalBooks.length === 0 && isFirstLoad) {
        lst.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm w-full">Не знайшли нових книг 😔 Спробуйте іншу категорію.</div>`;
    } else if (finalBooks.length > 0) {
        finalBooks.sort(() => 0.5 - Math.random());
        let h = '';
        finalBooks.forEach(i => {
            const b = i.volumeInfo; 
            const safeImg = (b.imageLinks?.thumbnail || PLACEHOLDER_IMG).replace(/^http:\/\//i, 'https://');
            const bookObj = { 
                googleId: i.id || Math.random().toString(), 
                title: b.title, 
                author: b.authors ? b.authors[0] : 'Невідомий', 
                pagesTotal: b.pageCount || 300, 
                image: safeImg, 
                description: b.description || 'Опис відсутній.', 
                genre: b.categories ? b.categories[0] : '' 
            };
            h += `
            <div onclick="showBookDetails(${JSON.stringify(bookObj).replace(/"/g, '&quot;')}, true)" class="bg-white p-4 rounded-xl flex gap-3 items-start border border-slate-100 cursor-pointer shadow-sm mb-3 fade-in active:scale-[0.98] transition-transform">
                <img src="${bookObj.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-16 h-24 rounded shadow-sm object-cover flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm text-slate-900 leading-tight">${bookObj.title}</div>
                    <div class="text-xs text-slate-500 mt-0.5">${bookObj.author}</div>
                    <div class="text-[10px] text-slate-400 mt-1.5 line-clamp-2 leading-snug">${bookObj.description}</div>
                </div>
                <button class="text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg text-xs font-bold shrink-0 mt-2 pointer-events-none">➕</button>
            </div>`;
        });
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = h;
        while(tempDiv.firstChild) lst.appendChild(tempDiv.firstChild);
    }

    isFetchingRecs = false;
}

// Ініціалізація Service Worker
if ('serviceWorker' in navigator) { 
    window.addEventListener('load', () => { 
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW Помилка:', err)); 
    }); 
}

console.log('📚 ЧитайКо PWA завантажено успішно!');
