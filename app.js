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

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let myLibrary = [];
let tempSelectedBook = null;

let currentLibraryTab = 'reading';
let currentMainTab = 'library';
let viewMode = localStorage.getItem('viewMode') || 'list';

let searchDebounce = null;
let libraryFilterDebounce = null;
let recFilterDebounce = null;

let rendition = null;
let currentBookInstance = null;
let currentReaderBookId = null;
let readerTheme = localStorage.getItem('readerTheme') || 'light';
let readerFontSize = parseInt(localStorage.getItem('readerFontSize') || '100', 10);
let readingTimer = null;
let readingStartTime = 0;
let currentSessionSeconds = 0;
let lastSelectedText = '';

let recObserver = null;
let currentRecCategory = null;
let currentRecQueries = [];
let currentRecQueryIndex = 0;
let recStartIndex = 0;
let shownRecTitles = new Set();
let isFetchingRecs = false;
let recExhausted = false;

const curatedCategories = {
  "Фентезі": [
    "українське фентезі",
    "епічне фентезі",
    "магія та пригоди",
    "fantasy ukrainian translation",
    "young adult fantasy"
  ],
  "Детектив": [
    "детектив роман",
    "сучасний детектив",
    "психологічний детектив",
    "mystery novel ukrainian",
    "crime detective fiction"
  ],
  "Трилер": [
    "психологічний трилер",
    "напружений трилер",
    "mystery thriller",
    "dark thriller book",
    "crime thriller novel"
  ],
  "Романтика": [
    "романтика роман",
    "сучасна любовна проза",
    "romance novel",
    "young adult romance",
    "romantic fantasy"
  ],
  "Саморозвиток": [
    "self improvement book",
    "психологія саморозвиток",
    "звички мотивація книга",
    "productivity mindset book",
    "особистісний розвиток"
  ],
  "Фантастика": [
    "наукова фантастика",
    "science fiction novel",
    "dystopian fiction",
    "space opera book",
    "кіберпанк роман"
  ],
  "Академія магії": [
    "magic academy novel",
    "wizard academy fantasy",
    "mage academy book",
    "school of magic fantasy",
    "academy of magic novel",
    "magical academy romance",
    "dark magic academy",
    "fantasy academy students",
    "spellcaster academy",
    "magic school adventure"
  ]
};

const dom = {
  body: document.body,
  authScreen: document.getElementById('authScreen'),
  appScreen: document.getElementById('appScreen'),
  authError: document.getElementById('authError'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  loginBtn: document.getElementById('loginBtn'),
  signupBtn: document.getElementById('signupBtn'),
  googleBtn: document.getElementById('googleBtn'),

  userEmailDisplay: document.getElementById('userEmailDisplay'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  searchFab: document.getElementById('searchFab'),
  mainBottomNav: document.getElementById('mainBottomNav'),
  backdrop: document.getElementById('backdrop'),
  toast: document.getElementById('toast'),

  librarySections: document.getElementById('librarySections'),
  myBooksContainer: document.getElementById('myBooksContainer'),
  libraryFilterInput: document.getElementById('libraryFilterInput'),
  libraryTabs: Array.from(document.querySelectorAll('.library-tab')),
  viewList: document.getElementById('view_list'),
  viewGrid: document.getElementById('view_grid'),
  navItems: Array.from(document.querySelectorAll('.nav-item')),

  recommendationsScreen: document.getElementById('recommendationsScreen'),
  recommendationsList: document.getElementById('recommendationsList'),
  recLoadingState: document.getElementById('recLoadingState'),
  recScrollTarget: document.getElementById('recScrollTarget'),
  recTabs: Array.from(document.querySelectorAll('.rec-tab')),
  recFilterInput: document.getElementById('recFilterInput'),

  settingsSheet: document.getElementById('settingsSheet'),
  statBooks: document.getElementById('statBooks'),
  statPages: document.getElementById('statPages'),
  toggleThemeBtn: document.getElementById('toggleThemeBtn'),
  exportLibraryBtn: document.getElementById('exportLibraryBtn'),
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  logoutBtn: document.getElementById('logoutBtn'),

  searchSheet: document.getElementById('searchSheet'),
  searchInput: document.getElementById('searchInput'),
  searchItems: document.getElementById('searchItems'),
  manualAddBtn: document.getElementById('manualAddBtn'),

  detailsSheet: document.getElementById('detailsSheet'),
  detailsContent: document.getElementById('detailsContent'),
  editContent: document.getElementById('editContent'),
  statusButtons: document.getElementById('statusButtons'),
  editTitle: document.getElementById('editTitle'),
  editAuthor: document.getElementById('editAuthor'),
  editPages: document.getElementById('editPages'),
  editImage: document.getElementById('editImage'),
  editTags: document.getElementById('editTags'),
  editGoal: document.getElementById('editGoal'),
  saveBookEditsBtn: document.getElementById('saveBookEditsBtn'),
  cancelBookEditsBtn: document.getElementById('cancelBookEditsBtn'),
  statusAddButtons: Array.from(document.querySelectorAll('.status-add-btn')),

  readerOverlay: document.getElementById('readerOverlay'),
  readerTitle: document.getElementById('readerTitle'),
  readerTimer: document.getElementById('readerTimer'),
  readerProgress: document.getElementById('readerProgress'),
  readerSettingsBtn: document.getElementById('readerSettingsBtn'),
  readerSettingsMenu: document.getElementById('readerSettingsMenu'),
  readerPrevBtn: document.getElementById('readerPrevBtn'),
  readerNextBtn: document.getElementById('readerNextBtn'),
  closeReaderBtn: document.getElementById('closeReaderBtn'),
  fontMinusBtn: document.getElementById('fontMinusBtn'),
  fontPlusBtn: document.getElementById('fontPlusBtn'),
  readerThemeBtns: Array.from(document.querySelectorAll('.reader-theme-btn')),
  viewer: document.getElementById('viewer'),

  quotePanel: document.getElementById('quotePanel'),
  quoteText: document.getElementById('quoteText'),
  saveQuoteBtn: document.getElementById('saveQuoteBtn'),
  useSelectionBtn: document.getElementById('useSelectionBtn'),
  closeQuotePanelBtn: document.getElementById('closeQuotePanelBtn')
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  applySavedTheme();
  bindUI();
  initBottomSheets();
  initRecObserver();
  registerServiceWorker();
  auth.onAuthStateChanged(handleAuthStateChanged);
}

function bindUI() {
  dom.loginBtn.addEventListener('click', () => handleAuth('login', dom.loginBtn));
  dom.signupBtn.addEventListener('click', () => handleAuth('signup', dom.signupBtn));
  dom.googleBtn.addEventListener('click', () => signInWithGoogle(dom.googleBtn));

  dom.openSettingsBtn.addEventListener('click', () => {
    calculateStats();
    openSheet('settingsSheet');
  });

  dom.searchFab.addEventListener('click', () => openSheet('searchSheet'));
  dom.backdrop.addEventListener('click', closeAllSheets);

  dom.libraryTabs.forEach(btn => {
    btn.addEventListener('click', () => setLibraryTab(btn.dataset.tab));
  });

  dom.navItems.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.mainTab));
  });

  dom.viewList.addEventListener('click', () => setViewMode('list'));
  dom.viewGrid.addEventListener('click', () => setViewMode('grid'));

  dom.libraryFilterInput.addEventListener('input', () => {
    clearTimeout(libraryFilterDebounce);
    libraryFilterDebounce = setTimeout(render, 120);
  });

  dom.recFilterInput.addEventListener('input', () => {
    clearTimeout(recFilterDebounce);
    recFilterDebounce = setTimeout(filterRenderedRecommendations, 120);
  });

  dom.toggleThemeBtn.addEventListener('click', toggleAppTheme);
  dom.exportLibraryBtn.addEventListener('click', exportLibrary);
  dom.clearCacheBtn.addEventListener('click', clearAppCache);
  dom.logoutBtn.addEventListener('click', logout);

  dom.searchInput.addEventListener('input', handleSearchInput);
  dom.manualAddBtn.addEventListener('click', openManualForm);

  dom.saveBookEditsBtn.addEventListener('click', saveBookEdits);
  dom.cancelBookEditsBtn.addEventListener('click', () => toggleEditMode(false));
  dom.statusAddButtons.forEach(btn => {
    btn.addEventListener('click', () => addBookWithStatus(btn.dataset.status));
  });

  dom.readerSettingsBtn.addEventListener('click', toggleReaderSettings);
  dom.closeReaderBtn.addEventListener('click', closeReader);
  dom.readerPrevBtn.addEventListener('click', () => rendition?.prev());
  dom.readerNextBtn.addEventListener('click', () => rendition?.next());
  dom.fontMinusBtn.addEventListener('click', () => changeFontSize(-10));
  dom.fontPlusBtn.addEventListener('click', () => changeFontSize(10));
  dom.readerThemeBtns.forEach(btn => {
    btn.addEventListener('click', () => changeReaderTheme(btn.dataset.theme));
  });

  dom.viewer.addEventListener('click', () => dom.readerSettingsMenu.classList.add('hidden'));
  dom.saveQuoteBtn.addEventListener('click', saveQuote);
  dom.useSelectionBtn.addEventListener('click', useSelectedText);
  dom.closeQuotePanelBtn.addEventListener('click', () => dom.quotePanel.classList.add('hidden'));

  dom.recTabs.forEach(btn => {
    btn.addEventListener('click', () => loadRealRecommendations(btn.dataset.rec));
  });

  window.addEventListener('beforeunload', stopTimer);
}

function initBottomSheets() {
  document.querySelectorAll('.bottom-sheet').forEach(sheet => {
    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    sheet.addEventListener('touchstart', (e) => {
      const scrollable = sheet.querySelector('.overflow-y-auto');
      const startedOnHandle = !!e.target.closest('.drag-handle');
      if (!startedOnHandle) return;
      if (scrollable && scrollable.scrollTop > 0) return;

      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      sheet.style.transition = 'none';
    }, { passive: true });

    sheet.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const deltaY = Math.max(0, currentY - startY);
      sheet.style.transform = `translateY(${deltaY}px)`;
    }, { passive: true });

    sheet.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
      const delta = currentY - startY;
      sheet.style.transform = '';

      if (delta > 110) {
        if (sheet.id === 'detailsSheet') closeDetailsSheet();
        else closeAllSheets();
      }
    }, { passive: true });
  });
}

function initRecObserver() {
  if (!dom.recScrollTarget) return;

  recObserver = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    if (currentMainTab !== 'recommendations') return;
    if (isFetchingRecs || recExhausted || currentRecQueries.length === 0) return;
    fetchMoreRecommendations(false);
  }, { rootMargin: '500px' });

  recObserver.observe(dom.recScrollTarget);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

function applySavedTheme() {
  if (localStorage.getItem('appTheme') === 'dark') {
    dom.body.classList.add('dark');
  }
}

function toggleAppTheme() {
  dom.body.classList.toggle('dark');
  localStorage.setItem('appTheme', dom.body.classList.contains('dark') ? 'dark' : 'light');
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  clearTimeout(dom.toast._timer);
  dom.toast._timer = setTimeout(() => dom.toast.classList.add('hidden'), 2600);
}

function openSheet(id) {
  dom.body.classList.add('modal-open');
  document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
  document.getElementById(id)?.classList.add('open');
  dom.backdrop.classList.remove('hidden');

  if (id === 'searchSheet') {
    setTimeout(() => {
      dom.searchInput.focus();
      dom.searchInput.setSelectionRange(dom.searchInput.value.length, dom.searchInput.value.length);
    }, 200);
  }
}

function closeAllSheets() {
  dom.body.classList.remove('modal-open');
  document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
  dom.backdrop.classList.add('hidden');
  toggleEditMode(false);
}

function closeDetailsSheet() {
  if (!dom.statusButtons.classList.contains('hidden')) openSheet('searchSheet');
  else closeAllSheets();
}

function showErrorMsg(msg) {
  dom.authError.textContent = msg;
  dom.authError.classList.remove('hidden');
  clearTimeout(dom.authError._timer);
  dom.authError._timer = setTimeout(() => dom.authError.classList.add('hidden'), 6000);
}

async function handleAuth(type, btn) {
  const originalText = btn.textContent;
  btn.textContent = '...';

  const email = dom.authEmail.value.trim();
  const password = dom.authPassword.value.trim();

  if (email.length < 5 || password.length < 6) {
    btn.textContent = originalText;
    return showErrorMsg('Email має бути валідним, а пароль — мінімум 6 символів.');
  }

  try {
    if (type === 'login') {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch (error) {
    showErrorMsg(error.message);
  } finally {
    btn.textContent = originalText;
  }
}

async function signInWithGoogle(btn) {
  const originalHtml = btn.innerHTML;
  btn.textContent = 'Google...';
  const provider = new firebase.auth.GoogleAuthProvider();

  try {
    await auth.signInWithPopup(provider);
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
      await auth.signInWithRedirect(provider);
    } else {
      showErrorMsg(error.message);
    }
  } finally {
    btn.innerHTML = originalHtml;
  }
}

function handleAuthStateChanged(user) {
  if (user) {
    currentUser = user;
    dom.authScreen.classList.add('hidden');
    dom.appScreen.classList.remove('hidden');
    dom.searchFab.classList.remove('hidden');
    dom.mainBottomNav.classList.remove('hidden');
    dom.userEmailDisplay.textContent = user.email || user.phoneNumber || '';
    updateViewButtons();
    loadLibrary();
  } else {
    currentUser = null;
    myLibrary = [];
    dom.authScreen.classList.remove('hidden');
    dom.appScreen.classList.add('hidden');
    dom.searchFab.classList.add('hidden');
    dom.mainBottomNav.classList.add('hidden');
  }
}

function logout() {
  auth.signOut();
  closeAllSheets();
}

function booksRef() {
  return db.collection('users').doc(currentUser.uid).collection('books');
}

function normalizeBook(raw = {}) {
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === 'string'
      ? raw.tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];

  const pagesTotal = Math.max(0, parseInt(raw.pagesTotal || 0, 10) || 0);
  const pagesRead = Math.max(0, parseInt(raw.pagesRead || 0, 10) || 0);

  return {
    id: raw.id || '',
    googleId: raw.googleId || '',
    title: String(raw.title || '').trim(),
    author: String(raw.author || '').trim(),
    pagesTotal,
    pagesRead: Math.min(pagesRead, pagesTotal || pagesRead),
    image: raw.image || PLACEHOLDER_IMG,
    description: String(raw.description || 'Опис відсутній.').trim(),
    genre: String(raw.genre || '').trim(),
    tags,
    rating: parseInt(raw.rating || 0, 10) || 0,
    review: String(raw.review || ''),
    status: raw.status || 'planned',
    epubUrl: raw.epubUrl || '',
    timeSpent: parseInt(raw.timeSpent || 0, 10) || 0,
    lastFileName: raw.lastFileName || '',
    lastCfi: raw.lastCfi || '',
    dateAdded: raw.dateAdded || Date.now(),
    dateStarted: raw.dateStarted || '',
    dateFinished: raw.dateFinished || '',
    publishedDate: raw.publishedDate || '',
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    goalPages: parseInt(raw.goalPages || 0, 10) || 0
  };
}

function loadLibrary() {
  booksRef().orderBy('dateAdded', 'desc').onSnapshot((snap) => {
    myLibrary = [];
    snap.forEach((doc) => {
      myLibrary.push(normalizeBook({ id: doc.id, ...doc.data() }));
    });
    calculateStats();
    render();
  });
}

async function updateBookInFirestore(id, updates) {
  if (!currentUser || !id) return;
  await booksRef().doc(id).update(updates);
}

function calculateStats() {
  const finished = myLibrary.filter(b => b.status === 'finished');
  const totalPages = finished.reduce((sum, b) => sum + (parseInt(b.pagesTotal || 0, 10) || 0), 0);
  dom.statBooks.textContent = finished.length;
  dom.statPages.textContent = totalPages;
}

function exportLibrary() {
  if (!myLibrary.length) {
    return showToast('Бібліотека порожня');
  }
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(myLibrary, null, 2));
  const a = document.createElement('a');
  a.setAttribute('href', dataStr);
  a.setAttribute('download', 'chitayko-backup.json');
  a.click();
}

async function clearAppCache() {
  if ('caches' in window) {
    const names = await caches.keys();
    for (const name of names) await caches.delete(name);
  }

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) await reg.unregister();
  }

  showToast('Кеш очищено, перезавантажуємо...');
  setTimeout(() => window.location.reload(true), 600);
}

function setLibraryTab(tab) {
  currentLibraryTab = tab;
  dom.libraryTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  render();
}

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('viewMode', mode);
  updateViewButtons();
  render();
}

function updateViewButtons() {
  dom.viewList.classList.toggle('active', viewMode === 'list');
  dom.viewGrid.classList.toggle('active', viewMode === 'grid');
}

function switchTab(tab) {
  currentMainTab = tab;
  dom.navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.mainTab === tab));

  if (tab === 'library') {
    dom.librarySections.classList.remove('hidden');
    dom.recommendationsScreen.classList.add('hidden');
  } else {
    dom.librarySections.classList.add('hidden');
    dom.recommendationsScreen.classList.remove('hidden');
    if (!currentRecCategory) loadRealRecommendations('auto');
  }
}

function getFilteredLibraryBooks() {
  const q = dom.libraryFilterInput.value.trim().toLowerCase();

  let books = myLibrary.filter(b => b.status === currentLibraryTab);

  if (!q) return books;

  return books.filter(book => {
    const hay = [
      book.title,
      book.author,
      book.genre,
      ...(book.tags || []),
      book.description
    ].join(' ').toLowerCase();

    return hay.includes(q);
  });
}

function render() {
  const reading = myLibrary.filter(b => b.status === 'reading');
  const planned = myLibrary.filter(b => b.status === 'planned');
  const finished = myLibrary.filter(b => b.status === 'finished');

  const readingBtn = document.getElementById('tab_reading');
  const plannedBtn = document.getElementById('tab_planned');
  const finishedBtn = document.getElementById('tab_finished');

  readingBtn.textContent = `Читаю зараз (${reading.length})`;
  plannedBtn.textContent = `Хочу прочитати (${planned.length})`;
  finishedBtn.textContent = `Прочитано (${finished.length})`;

  const books = getFilteredLibraryBooks();
  const container = dom.myBooksContainer;

  if (!books.length) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <span class="empty-state-icon">${currentLibraryTab === 'reading' ? '📖' : currentLibraryTab === 'planned' ? '🕒' : '✅'}</span>
        <h3 class="text-xl font-bold text-slate-900 mb-2">
          ${currentLibraryTab === 'reading' ? 'Тут поки тихо' : currentLibraryTab === 'planned' ? 'Список ще порожній' : 'Ще немає завершених книг'}
        </h3>
        <p class="text-slate-500 text-sm">
          ${currentLibraryTab === 'reading' ? 'Додай книгу і почни читати.' : currentLibraryTab === 'planned' ? 'Додай книги, які хочеш прочитати.' : 'Коли завершиш книгу, вона з’явиться тут.'}
        </p>
      </div>
    `;
    return;
  }

  container.classList.remove('fade-in');
  void container.offsetWidth;
  container.classList.add('fade-in');

  if (currentLibraryTab === 'finished') {
    const grouped = {};
    books
      .slice()
      .sort((a, b) => String(b.dateFinished || '1970-01-01').localeCompare(String(a.dateFinished || '1970-01-01')))
      .forEach(book => {
        let year = 'Без дати';
        if (book.dateFinished) year = String(book.dateFinished).slice(0, 4);
        if (!grouped[year]) grouped[year] = [];
        grouped[year].push(book);
      });

    let html = '';
    Object.keys(grouped).sort((a, b) => {
      if (a === 'Без дати') return 1;
      if (b === 'Без дати') return -1;
      return parseInt(b, 10) - parseInt(a, 10);
    }).forEach(year => {
      html += `<h2 class="font-black text-slate-300 text-lg mt-6 mb-3 tracking-widest">${escapeHtml(year)}</h2>`;
      html += renderBooksWrapper(grouped[year]);
    });

    container.innerHTML = html;
  } else {
    container.innerHTML = renderBooksWrapper(books);
  }

  if (viewMode === 'grid') initSortable();
  bindRenderedBookCards();
}

function renderBooksWrapper(books) {
  if (viewMode === 'grid') {
    return `<div class="grid grid-cols-3 gap-4 sortable-list">${books.map(renderBookCard).join('')}</div>`;
  }
  return `<div class="space-y-3 sortable-list">${books.map(renderBookCard).join('')}</div>`;
}

function renderBookCard(book) {
  const percent = getBookPercent(book);
  const safeTitle = escapeHtml(book.title || 'Без назви');
  const safeAuthor = escapeHtml(book.author || 'Невідомий автор');
  const safeImage = escapeAttr(getImage(book.image));
  const ratingBadge = book.rating ? `<div class="book-rating-badge">★ ${book.rating}</div>` : '';
  const tagsHtml = (book.tags || []).slice(0, 3).map(tag => `<span class="book-tag">${escapeHtml(tag)}</span>`).join('');
  const goalHtml = book.goalPages > 0
    ? `<span class="goal-pill">🎯 ${Math.min(book.pagesRead || 0, book.goalPages)}/${book.goalPages} ст.</span>`
    : '';

  if (viewMode === 'grid') {
    return `
      <div class="book-card-grid fade-in ${book.status === 'finished' ? 'opacity-80' : ''}" data-book-id="${book.id}">
        <div class="book-cover-grid">
          <img src="${safeImage}" alt="${safeTitle}" onerror="this.src='${PLACEHOLDER_IMG}'">
          ${ratingBadge}
        </div>
        <div class="book-title-grid line-clamp-2">${safeTitle}</div>
        <div class="book-author-grid truncate">${safeAuthor}</div>
        ${book.status !== 'planned' ? `
          <div class="mt-2 px-1">
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
              <div class="progress-bar bg-indigo-600 h-full rounded-full" style="width:${percent}%"></div>
            </div>
          </div>` : ''
        }
      </div>
    `;
  }

  return `
    <div class="book-card-list fade-in ${book.status === 'finished' ? 'opacity-80' : ''}" data-book-id="${book.id}">
      <div class="book-cover-list">
        <img src="${safeImage}" alt="${safeTitle}" onerror="this.src='${PLACEHOLDER_IMG}'">
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-start gap-2">
          <div class="min-w-0">
            <h3 class="font-bold text-slate-900 text-[15px] leading-snug truncate">${safeTitle}</h3>
            <p class="text-[13px] text-slate-500 mt-0.5 truncate">${safeAuthor}</p>
          </div>
          ${book.rating ? `<div class="text-[11px] font-black text-amber-500 bg-amber-50 px-2 py-1 rounded-lg shrink-0">★ ${book.rating}</div>` : ''}
        </div>

        <div class="flex items-center justify-between text-[11px] font-bold mt-3 mb-2 gap-2 flex-wrap">
          <span class="text-slate-400 uppercase tracking-wider">${formatTime(book.timeSpent)}</span>
          ${goalHtml}
          <span class="text-indigo-600">${percent}%</span>
        </div>

        ${book.status !== 'planned' ? `
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
            <div class="progress-bar bg-indigo-600 h-full rounded-full" style="width:${percent}%"></div>
          </div>` : ''
        }

        ${tagsHtml ? `<div class="book-tags">${tagsHtml}</div>` : ''}
      </div>
    </div>
  `;
}

function bindRenderedBookCards() {
  document.querySelectorAll('[data-book-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.bookId;
      const book = myLibrary.find(b => b.id === id);
      if (book) showBookDetails(book, false);
    });
  });
}

function initSortable() {
  document.querySelectorAll('.sortable-list').forEach(list => {
    if (list._sortable) return;
    list._sortable = new Sortable(list, {
      delay: 250,
      delayOnTouchOnly: true,
      animation: 150,
      ghostClass: 'sortable-ghost'
    });
  });
}

function getBookPercent(book) {
  const total = parseInt(book.pagesTotal || 0, 10) || 0;
  const read = parseInt(book.pagesRead || 0, 10) || 0;
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((read / total) * 100)));
}

function toggleEditMode(isEditing) {
  if (isEditing) {
    dom.detailsContent.classList.add('hidden');
    dom.editContent.classList.remove('hidden');
  } else {
    dom.detailsContent.classList.remove('hidden');
    dom.editContent.classList.add('hidden');
  }
}

function openManualForm() {
  tempSelectedBook = {
    title: '',
    author: '',
    pagesTotal: 300,
    image: '',
    description: '',
    genre: '',
    tags: [],
    goalPages: 0
  };

  dom.editTitle.value = '';
  dom.editAuthor.value = '';
  dom.editPages.value = '';
  dom.editImage.value = '';
  dom.editTags.value = '';
  dom.editGoal.value = '';
  dom.statusButtons.classList.remove('hidden');
  toggleEditMode(true);
  openSheet('detailsSheet');
}

function prepareBookForEdit(book) {
  dom.editTitle.value = book.title || '';
  dom.editAuthor.value = book.author || '';
  dom.editPages.value = book.pagesTotal || '';
  dom.editImage.value = book.image && book.image !== PLACEHOLDER_IMG ? book.image : '';
  dom.editTags.value = (book.tags || []).join(', ');
  dom.editGoal.value = book.goalPages || '';
}

function showBookDetails(bookData, isNewFromSearch = false) {
  if (!bookData || !bookData.title) return;

  const libBook = isNewFromSearch
    ? normalizeBook(bookData)
    : (myLibrary.find(b => (b.googleId && b.googleId === bookData.googleId) || b.id === bookData.id) || normalizeBook(bookData));

  tempSelectedBook = isNewFromSearch ? libBook : null;
  toggleEditMode(false);
  prepareBookForEdit(libBook);

  const tags = (libBook.tags || []).length
    ? `<div class="book-tags mt-3">${libBook.tags.map(t => `<span class="book-tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const quoteCount = Array.isArray(libBook.notes) ? libBook.notes.length : 0;
  const percent = getBookPercent(libBook);
  const safeImage = escapeAttr(getImage(libBook.image));

  let html = `
    <div class="flex justify-between items-start mb-4 fade-in mt-1">
      <div class="flex gap-5 w-full">
        <img src="${safeImage}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-28 h-40 object-cover rounded-xl shadow-md border border-slate-100 flex-shrink-0">
        <div class="flex flex-col justify-center min-w-0 flex-1">
          <h3 class="text-xl font-bold text-slate-900 leading-tight mb-2 break-words">${escapeHtml(libBook.title)}</h3>

          <button id="detailsAuthorSearchBtn" class="text-left w-fit px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold mb-3 active:scale-95 transition-all truncate shadow-sm">
            ${escapeHtml(libBook.author || 'Невідомий автор')}
          </button>

          <span class="px-2.5 py-1 w-fit rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 mb-3">
            ${libBook.pagesTotal || 0} стор.
          </span>

          ${!isNewFromSearch ? `
            <select id="detailsStatusSelect" class="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none cursor-pointer">
              <option value="planned" ${libBook.status === 'planned' ? 'selected' : ''}>В планах</option>
              <option value="reading" ${libBook.status === 'reading' ? 'selected' : ''}>Читаю</option>
              <option value="finished" ${libBook.status === 'finished' ? 'selected' : ''}>Прочитано</option>
            </select>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  if (!isNewFromSearch) {
    html += `
      <div class="mb-5 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm fade-in">
        <div class="flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
          <span>Прогрес</span>
          <span class="text-indigo-600">${percent}%</span>
        </div>
        <div class="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
          <div class="progress-bar bg-indigo-600 h-full rounded-full" style="width:${percent}%"></div>
        </div>

        <div class="grid grid-cols-2 gap-2 mt-4 text-xs font-semibold">
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">Прочитано: ${libBook.pagesRead || 0}/${libBook.pagesTotal || 0}</div>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">Час: ${formatTime(libBook.timeSpent)}</div>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">Цитат: ${quoteCount}</div>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">Ціль: ${libBook.goalPages || 0} стор.</div>
        </div>

        <div class="space-y-2 mt-4">
          <div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
            <span class="text-xs font-bold text-slate-600">Дата початку</span>
            <input type="date" id="detailsDateStarted" value="${escapeAttr(libBook.dateStarted || '')}" class="date-input">
          </div>
          <div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
            <span class="text-xs font-bold text-slate-600">Дата завершення</span>
            <input type="date" id="detailsDateFinished" value="${escapeAttr(libBook.dateFinished || '')}" class="date-input">
          </div>
          <div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
            <span class="text-xs font-bold text-slate-600">Прочитано сторінок</span>
            <input type="number" id="detailsPagesRead" min="0" max="${libBook.pagesTotal || 9999}" value="${libBook.pagesRead || 0}" class="date-input">
          </div>
          <div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
            <span class="text-xs font-bold text-slate-600">Ціль сторінок</span>
            <input type="number" id="detailsGoalPages" min="0" value="${libBook.goalPages || 0}" class="date-input">
          </div>
        </div>
      </div>

      <div class="mb-5 bg-slate-50 p-5 rounded-3xl border border-slate-100 fade-in shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-[10px] font-black uppercase text-slate-500 tracking-wider">Дії з книгою</h4>
          <button id="editBookBtn" class="text-indigo-600 bg-indigo-100 px-4 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-transform shadow-sm">Редагувати</button>
        </div>

        <div class="detail-action-grid">
          <button id="readLocalEpubBtn" class="detail-action-btn dark">📕 EPUB з файлу</button>
          <button id="setEpubUrlBtn" class="detail-action-btn soft">🔗 URL EPUB</button>
          <button id="openUrlReaderBtn" class="detail-action-btn primary" ${libBook.epubUrl ? '' : 'disabled'}>📖 Читати по URL</button>
          <button id="clearEpubUrlBtn" class="detail-action-btn warn" ${libBook.epubUrl ? '' : 'disabled'}>🧹 Очистити URL</button>
        </div>

        <input type="file" id="detailsEpubInput" accept=".epub" class="hidden">
        ${libBook.epubUrl ? `<div class="mt-3 text-[11px] text-slate-400 break-all">URL: ${escapeHtml(libBook.epubUrl)}</div>` : ''}
        ${libBook.lastFileName ? `<div class="mt-1 text-[11px] text-slate-400">Останній файл: ${escapeHtml(libBook.lastFileName)}</div>` : ''}
      </div>

      <div class="mb-6 text-center fade-in bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
        <div class="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-wider">Оцінка</div>
        <div class="flex justify-center gap-3" id="ratingWrap">
          ${[1,2,3,4,5].map(i => `
            <span data-rating="${i}" class="text-4xl cursor-pointer ${libBook.rating >= i ? 'text-amber-400' : 'text-slate-200'} active:scale-90 transition-transform">★</span>
          `).join('')}
        </div>
      </div>

      <div class="mb-6 bg-slate-50 p-5 rounded-3xl border border-slate-100 fade-in shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <h4 class="text-[10px] font-black uppercase text-slate-500 tracking-wider">Нотатка</h4>
          <button id="saveReviewBtn" class="text-indigo-600 bg-indigo-100 px-4 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-transform shadow-sm">Зберегти</button>
        </div>
        <textarea id="reviewTextArea" class="w-full bg-transparent text-sm text-slate-700 outline-none resize-none min-h-[80px]" placeholder="Що думаєш про цю книгу?">${escapeHtml(libBook.review || '')}</textarea>
      </div>

      <div class="mb-6 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm fade-in">
        <div class="flex justify-between items-center mb-3">
          <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Цитати</h4>
          <span class="text-[10px] font-bold text-indigo-500">${quoteCount}</span>
        </div>
        ${
          quoteCount
            ? `<div class="space-y-2">${libBook.notes.slice().reverse().slice(0, 5).map((note, idx) => `
                <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm text-slate-700 leading-relaxed">
                  <div>${escapeHtml(note.text || '')}</div>
                  <div class="mt-2 text-[10px] text-slate-400">${escapeHtml(formatDateTime(note.createdAt))}</div>
                  <button class="mt-2 text-[10px] font-bold text-red-500" data-note-remove="${idx}">Видалити</button>
                </div>
              `).join('')}</div>`
            : `<p class="text-sm text-slate-400">Поки що немає збережених цитат.</p>`
        }
      </div>
    `;
  }

  html += `
    <div class="desc-scroll fade-in">
      <h4 class="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-wider">Опис</h4>
      <p class="text-sm text-slate-700 leading-relaxed text-justify">${escapeHtml(libBook.description || 'Опис відсутній.')}</p>
      ${tags}
    </div>
  `;

  if (!isNewFromSearch) {
    html += `
      <div class="mt-8 mb-2 flex justify-center fade-in">
        <button id="deleteBookBtn" class="flex items-center gap-2 px-6 py-3 text-red-500 bg-red-50 hover:bg-red-100 rounded-xl font-bold text-sm active:scale-95 transition-all shadow-sm">
          🗑 Видалити книгу
        </button>
      </div>
    `;
  }

  dom.detailsContent.innerHTML = html;
  dom.statusButtons.classList.toggle('hidden', !isNewFromSearch);
  openSheet('detailsSheet');

  bindDetailsEvents(libBook, isNewFromSearch);
}

function bindDetailsEvents(book, isNewFromSearch) {
  const authorBtn = document.getElementById('detailsAuthorSearchBtn');
  if (authorBtn) authorBtn.addEventListener('click', () => searchAuthorBooks(book.author));

  if (isNewFromSearch) return;

  const statusSelect = document.getElementById('detailsStatusSelect');
  const dateStarted = document.getElementById('detailsDateStarted');
  const dateFinished = document.getElementById('detailsDateFinished');
  const pagesRead = document.getElementById('detailsPagesRead');
  const goalPages = document.getElementById('detailsGoalPages');
  const editBtn = document.getElementById('editBookBtn');
  const reviewBtn = document.getElementById('saveReviewBtn');
  const reviewTextArea = document.getElementById('reviewTextArea');
  const deleteBtn = document.getElementById('deleteBookBtn');
  const readLocalBtn = document.getElementById('readLocalEpubBtn');
  const setEpubUrlBtn = document.getElementById('setEpubUrlBtn');
  const openUrlReaderBtn = document.getElementById('openUrlReaderBtn');
  const clearEpubUrlBtn = document.getElementById('clearEpubUrlBtn');
  const detailsEpubInput = document.getElementById('detailsEpubInput');

  statusSelect?.addEventListener('change', () => changeStatusFromDetails(book.id, statusSelect.value));
  dateStarted?.addEventListener('change', () => saveManualField(book.id, 'dateStarted', dateStarted.value));
  dateFinished?.addEventListener('change', () => saveManualField(book.id, 'dateFinished', dateFinished.value));
  pagesRead?.addEventListener('change', () => saveManualField(book.id, 'pagesRead', clampNumber(pagesRead.value, 0, book.pagesTotal || 999999)));
  goalPages?.addEventListener('change', () => saveManualField(book.id, 'goalPages', Math.max(0, parseInt(goalPages.value || 0, 10) || 0)));

  editBtn?.addEventListener('click', () => {
    tempSelectedBook = book;
    prepareBookForEdit(book);
    toggleEditMode(true);
  });

  reviewBtn?.addEventListener('click', () => saveReview(book.id, reviewTextArea.value));
  deleteBtn?.addEventListener('click', () => deleteBookFromDetails(book.id));

  readLocalBtn?.addEventListener('click', () => detailsEpubInput.click());
  detailsEpubInput?.addEventListener('change', (e) => handleFileSelect(e, book.id));

  setEpubUrlBtn?.addEventListener('click', () => promptForEpubUrl(book.id));
  openUrlReaderBtn?.addEventListener('click', () => openReaderFromUrl(book.id, book.epubUrl));
  clearEpubUrlBtn?.addEventListener('click', async () => {
    await updateBookInFirestore(book.id, { epubUrl: '' });
    showToast('URL EPUB очищено');
  });

  document.querySelectorAll('[data-rating]').forEach(star => {
    star.addEventListener('click', () => setRating(book.id, parseInt(star.dataset.rating, 10)));
  });

  document.querySelectorAll('[data-note-remove]').forEach((btn, idx) => {
    btn.addEventListener('click', () => removeQuote(book.id, idx));
  });
}

async function saveManualField(id, field, value) {
  const updates = { [field]: value };
  await updateBookInFirestore(id, updates);
}

async function changeStatusFromDetails(id, newStatus) {
  const book = myLibrary.find(b => b.id === id);
  if (!book) return;

  const updates = { status: newStatus };

  if (newStatus === 'reading' && !book.dateStarted) {
    updates.dateStarted = todayISO();
  }

  if (newStatus === 'finished') {
    updates.pagesRead = book.pagesTotal || book.pagesRead || 0;
    updates.dateFinished = book.dateFinished || todayISO();
  }

  await updateBookInFirestore(id, updates);
  closeAllSheets();
  setLibraryTab(newStatus);
}

async function setRating(id, rating) {
  await updateBookInFirestore(id, { rating });
  setTimeout(() => {
    const book = myLibrary.find(b => b.id === id);
    if (book) showBookDetails(book, false);
  }, 120);
}

async function saveReview(id, review) {
  await updateBookInFirestore(id, { review });
  showToast('Нотатку збережено');
}

async function deleteBookFromDetails(id) {
  if (!confirm('Видалити цю книгу?')) return;
  await booksRef().doc(id).delete();
  closeAllSheets();
}

async function removeQuote(bookId, reverseIdx) {
  const book = myLibrary.find(b => b.id === bookId);
  if (!book) return;
  const notes = Array.isArray(book.notes) ? [...book.notes] : [];
  const actualIndex = notes.length - 1 - reverseIdx;
  if (actualIndex < 0) return;
  notes.splice(actualIndex, 1);
  await updateBookInFirestore(bookId, { notes });
  showToast('Цитату видалено');
}

function saveBookEdits() {
  const updates = {
    title: dom.editTitle.value.trim(),
    author: dom.editAuthor.value.trim(),
    pagesTotal: parseInt(dom.editPages.value || '300', 10) || 300,
    image: dom.editImage.value.trim() || PLACEHOLDER_IMG,
    tags: dom.editTags.value.split(',').map(t => t.trim()).filter(Boolean),
    goalPages: parseInt(dom.editGoal.value || '0', 10) || 0
  };

  if (!updates.title) return showToast('Вкажи назву книги');

  if (tempSelectedBook && !tempSelectedBook.id) {
    tempSelectedBook = {
      ...tempSelectedBook,
      ...updates,
      description: tempSelectedBook.description || '',
      genre: tempSelectedBook.genre || ''
    };
    showToast('Дані підготовлено');
    toggleEditMode(false);
  } else if (tempSelectedBook?.id) {
    updateBookInFirestore(tempSelectedBook.id, updates).then(() => {
      toggleEditMode(false);
      showToast('Книгу оновлено');
    });
  }
}

async function addBookWithStatus(status) {
  if (!currentUser || !tempSelectedBook) return;

  const manualLike = !tempSelectedBook.title || dom.editTitle.value.trim();
  if (manualLike) saveBookEdits();

  const src = tempSelectedBook;

  const newBookData = normalizeBook({
    ...src,
    title: src.title || dom.editTitle.value.trim(),
    author: src.author || dom.editAuthor.value.trim(),
    pagesTotal: src.pagesTotal || parseInt(dom.editPages.value || '300', 10) || 300,
    image: src.image || dom.editImage.value.trim() || PLACEHOLDER_IMG,
    tags: src.tags || dom.editTags.value.split(',').map(t => t.trim()).filter(Boolean),
    goalPages: src.goalPages || parseInt(dom.editGoal.value || '0', 10) || 0,
    status,
    pagesRead: status === 'finished' ? (src.pagesTotal || 0) : 0,
    dateAdded: Date.now(),
    rating: 0,
    review: '',
    epubUrl: '',
    timeSpent: 0,
    lastFileName: '',
    lastCfi: '',
    notes: [],
    dateStarted: status === 'reading' ? todayISO() : '',
    dateFinished: status === 'finished' ? todayISO() : ''
  });

  await booksRef().add(newBookData);
  tempSelectedBook = null;
  closeAllSheets();
  showToast('Книгу додано');
}

function handleSearchInput(e) {
  clearTimeout(searchDebounce);
  const query = e.target.value.trim();

  if (query.length < 2) {
    dom.searchItems.innerHTML = '';
    return;
  }

  dom.searchItems.innerHTML = `<div class="p-8 text-slate-400 text-sm text-center animate-pulse">Шукаємо в Google Books і Apple Books...</div>`;
  searchDebounce = setTimeout(() => searchBooks(query), 550);
}

async function searchBooks(query) {
  try {
    let allItems = [];
    const isAuthorSearch = query.startsWith('author:') && query.endsWith('"');
    const rawQuery = isAuthorSearch ? query.slice(8, -1).trim() : query.trim();
    const safeQuery = encodeURIComponent(rawQuery);
    const safeQueryQuote = encodeURIComponent(`"${rawQuery}"`);

    const promises = [];

    if (isAuthorSearch) {
      promises.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=inauthor:${safeQuery}&printType=books&maxResults=40`).catch(() => null));
      promises.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=${safeQueryQuote}&printType=books&maxResults=40`).catch(() => null));
      promises.push(fetch(`https://itunes.apple.com/search?term=${safeQuery}&entity=ebook&attribute=authorTerm&country=ua&limit=30`).catch(() => null));
    } else {
      promises.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=intitle:${safeQueryQuote}&printType=books&maxResults=20`).catch(() => null));
      promises.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=${safeQuery}&printType=books&maxResults=20`).catch(() => null));
      promises.push(fetch(`https://itunes.apple.com/search?term=${safeQuery}&entity=ebook&country=ua&limit=25`).catch(() => null));
    }

    const responses = await Promise.all(promises);

    for (let i = 0; i < responses.length - 1; i++) {
      if (responses[i]?.ok) {
        const data = await responses[i].json();
        if (Array.isArray(data.items)) allItems.push(...data.items);
      }
    }

    const appleRes = responses[responses.length - 1];
    if (appleRes?.ok) {
      const appleData = await appleRes.json();
      if (Array.isArray(appleData.results)) {
        appleData.results.forEach(book => {
          allItems.push({
            id: `apple-${book.trackId}`,
            volumeInfo: {
              title: book.trackName,
              authors: [book.artistName],
              pageCount: 300,
              description: book.description ? String(book.description).replace(/<[^>]*>/g, '') : 'Apple Books.',
              publishedDate: book.releaseDate ? String(book.releaseDate).substring(0, 4) : '',
              imageLinks: {
                thumbnail: book.artworkUrl100 ? book.artworkUrl100.replace('100x100bb', '400x400bb') : null
              },
              categories: book.genres || []
            }
          });
        });
      }
    }

    if (!allItems.length) {
      dom.searchItems.innerHTML = `<div class="p-8 text-slate-400 text-sm text-center">Нічого не знайдено.</div>`;
      return;
    }

    const unique = [];
    const seen = new Set();

    allItems.forEach(item => {
      const b = item.volumeInfo || {};
      if (!b.title) return;
      const key = `${String(b.title).toLowerCase()}|${b.authors?.[0]?.toLowerCase() || ''}`.replace(/[^a-zа-яіїєґ0-9|]+/gi, '');
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });

    const badCategories = ['Science', 'Technology', 'Computers', 'Medical', 'Law', 'Business & Economics', 'Mathematics', 'Education', 'Study Aids', 'Religion'];

    let filtered = unique.filter(item => {
      const b = item.volumeInfo || {};
      if (!b.title) return false;

      if (isAuthorSearch) {
        const authorStr = (b.authors || []).join(' ').toLowerCase();
        return authorStr.includes(rawQuery.toLowerCase());
      }

      const title = String(b.title).toLowerCase();
      const exactTitle = title.includes(rawQuery.toLowerCase());
      if (!exactTitle && Array.isArray(b.categories) && b.categories.some(c => badCategories.includes(c))) return false;
      return true;
    });

    if (isAuthorSearch) {
      filtered.sort((a, b) => String(a.volumeInfo?.publishedDate || '9999').localeCompare(String(b.volumeInfo?.publishedDate || '9999')));
    } else {
      const qLower = rawQuery.toLowerCase();
      filtered.sort((a, b) => {
        const tA = String(a.volumeInfo?.title || '').toLowerCase();
        const tB = String(b.volumeInfo?.title || '').toLowerCase();

        const exactA = tA === qLower;
        const exactB = tB === qLower;
        if (exactA && !exactB) return -1;
        if (!exactA && exactB) return 1;

        const startsA = tA.startsWith(qLower);
        const startsB = tB.startsWith(qLower);
        if (startsA && !startsB) return -1;
        if (!startsA && startsB) return 1;

        const inclA = tA.includes(qLower);
        const inclB = tB.includes(qLower);
        if (inclA && !inclB) return -1;
        if (!inclA && inclB) return 1;

        return 0;
      });
    }

    filtered = filtered.slice(0, 30);

    if (!filtered.length) {
      dom.searchItems.innerHTML = `<div class="p-8 text-slate-400 text-sm text-center">Нічого релевантного не знайдено.</div>`;
      return;
    }

    dom.searchItems.innerHTML = '';
    filtered.forEach(item => {
      const b = item.volumeInfo || {};
      const book = normalizeBook({
        googleId: item.id || Math.random().toString(36).slice(2),
        title: b.title || '',
        author: b.authors ? b.authors[0] : '',
        pagesTotal: b.pageCount || 300,
        image: b.imageLinks?.thumbnail ? String(b.imageLinks.thumbnail).replace(/^http:/i, 'https:') : PLACEHOLDER_IMG,
        description: b.description || 'Опис відсутній.',
        genre: Array.isArray(b.categories) && b.categories.length ? b.categories[0] : '',
        publishedDate: b.publishedDate || ''
      });

      const div = document.createElement('div');
      div.className = 'p-3 mx-2 my-1 hover:bg-slate-100 rounded-2xl cursor-pointer flex items-center gap-4 active:bg-slate-200 fade-in relative';
      div.innerHTML = `
        ${isAuthorSearch && book.publishedDate ? `<div class="absolute top-2 right-3 text-[10px] font-bold text-indigo-400 bg-indigo-50 px-1.5 py-0.5 rounded">${escapeHtml(String(book.publishedDate).substring(0, 4))}</div>` : ''}
        <img src="${escapeAttr(getImage(book.image))}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-12 h-16 object-cover rounded-lg shadow-sm">
        <div class="flex-1 min-w-0 pr-6">
          <div class="font-bold text-slate-900 truncate">${escapeHtml(book.title)}</div>
          <div class="text-xs text-slate-500 mt-0.5 truncate">${escapeHtml(book.author)}</div>
        </div>
      `;
      div.addEventListener('click', () => showBookDetails(book, true));
      dom.searchItems.appendChild(div);
    });
  } catch (e) {
    dom.searchItems.innerHTML = `<div class="p-8 text-red-500 text-sm text-center">Помилка пошуку.</div>`;
  }
}

function searchAuthorBooks(authorName) {
  closeAllSheets();
  setTimeout(() => {
    openSheet('searchSheet');
    dom.searchInput.value = `author:${authorName}"`;
    dom.searchInput.dispatchEvent(new Event('input'));
  }, 250);
}

function handleFileSelect(event, bookId) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.epub')) {
    showToast('Потрібен файл .epub');
    event.target.value = '';
    return;
  }

  const bookData = myLibrary.find(b => b.id === bookId);
  if (!bookData) return;

  if (bookData.lastFileName && bookData.lastFileName !== file.name) {
    const isSure = confirm(`Раніше був файл "${bookData.lastFileName}". Замінити на "${file.name}"?`);
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
  reader.onload = function (e) {
    loadEpubData(e.target.result, bookData);
  };
  reader.onerror = function () {
    showToast('Помилка читання файлу');
    closeReader();
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

function promptForEpubUrl(bookId) {
  const url = prompt('Встав URL до .epub файлу');
  if (!url) return;
  updateBookInFirestore(bookId, { epubUrl: url.trim() }).then(() => showToast('URL EPUB збережено'));
}

function openReaderFromUrl(bookId, url) {
  if (!url) return showToast('Спочатку додай URL EPUB');
  const bookData = myLibrary.find(b => b.id === bookId);
  if (!bookData) return;

  startReaderUI(bookData);
  loadEpubData(`https://corsproxy.io/?${encodeURIComponent(url)}`, bookData);
}

function startReaderUI(bookData) {
  currentReaderBookId = bookData.id;
  dom.readerOverlay.style.display = 'flex';
  dom.readerTitle.textContent = bookData.title;
  dom.readerProgress.textContent = 'Відкриваємо...';
  dom.librarySections.classList.add('hidden');
  dom.readerSettingsMenu.classList.add('hidden');
  dom.quotePanel.classList.add('hidden');
  startTimer();
  initSwipeGestures();
}

function closeReader() {
  stopTimer();
  dom.readerOverlay.style.display = 'none';
  dom.readerSettingsMenu.classList.add('hidden');
  dom.quotePanel.classList.add('hidden');
  dom.viewer.innerHTML = '';
  dom.librarySections.classList.remove('hidden');

  try {
    currentBookInstance?.destroy();
  } catch (_) {}

  currentBookInstance = null;
  rendition = null;
  currentReaderBookId = null;
}

function startTimer() {
  readingStartTime = Date.now();
  currentSessionSeconds = 0;
  dom.readerTimer.textContent = '00:00';

  clearInterval(readingTimer);
  readingTimer = setInterval(() => {
    currentSessionSeconds = Math.floor((Date.now() - readingStartTime) / 1000);
    const h = Math.floor(currentSessionSeconds / 3600);
    const m = String(Math.floor((currentSessionSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(currentSessionSeconds % 60).padStart(2, '0');
    dom.readerTimer.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (!readingTimer || !currentReaderBookId) return;

  clearInterval(readingTimer);
  readingTimer = null;

  const book = myLibrary.find(b => b.id === currentReaderBookId);
  if (book && currentSessionSeconds >= 5) {
    const totalTime = (book.timeSpent || 0) + currentSessionSeconds;
    booksRef().doc(currentReaderBookId).update({ timeSpent: totalTime }).catch(() => {});
  }
}

function toggleReaderSettings() {
  dom.readerSettingsMenu.classList.toggle('hidden');
}

function changeFontSize(delta) {
  readerFontSize = Math.max(50, Math.min(200, readerFontSize + delta));
  localStorage.setItem('readerFontSize', String(readerFontSize));
  applyReaderSettings();
}

function changeReaderTheme(theme) {
  readerTheme = theme;
  localStorage.setItem('readerTheme', theme);
  applyReaderSettings();
}

function applyReaderSettings() {
  if (!rendition) return;
  rendition.themes.fontSize(`${readerFontSize}%`);
  rendition.themes.select(readerTheme);
}

function initSwipeGestures() {
  if (dom.viewer._hammerReady) return;
  const mc = new Hammer(dom.viewer);
  mc.get('swipe').set({ direction: Hammer.DIRECTION_HORIZONTAL });
  mc.on('swipeleft', () => rendition?.next());
  mc.on('swiperight', () => rendition?.prev());
  dom.viewer._hammerReady = true;
}

function loadEpubData(source, bookData) {
  dom.viewer.innerHTML = '';

  try {
    currentBookInstance = ePub(source);
    rendition = currentBookInstance.renderTo('viewer', {
      width: '100%',
      height: '100%',
      spread: 'none',
      manager: 'continuous',
      flow: 'paginated'
    });

    rendition.themes.register('light', {
      body: { background: '#f8fafc', color: '#0f172a' }
    });
    rendition.themes.register('sepia', {
      body: { background: '#f4ecd8', color: '#5b4636' }
    });
    rendition.themes.register('dark', {
      body: { background: '#0f172a', color: '#cbd5e1' }
    });

    applyReaderSettings();

    const safeCfi = bookData.lastCfi && String(bookData.lastCfi).startsWith('epubcfi') ? bookData.lastCfi : undefined;
    rendition.display(safeCfi).catch(() => rendition.display());

    currentBookInstance.ready.then(() => {
      currentBookInstance.locations.generate(1600).then(() => {
        const loc = rendition.currentLocation();
        if (loc?.start) {
          dom.readerProgress.textContent = `${Math.round((loc.start.percentage || 0) * 100)}%`;
        } else {
          dom.readerProgress.textContent = '0%';
        }
      }).catch(() => {});
    }).catch(() => {});

    rendition.on('relocated', async (location) => {
      try {
        if (!location?.start) return;

        let percent = 0;
        if (typeof location.start.percentage === 'number') {
          percent = Math.round(location.start.percentage * 100);
        }

        dom.readerProgress.textContent = `${percent}%`;

        const updates = {
          lastCfi: location.start.cfi
        };

        if (percent > 0) {
          updates.pagesRead = Math.min(
            bookData.pagesTotal || 300,
            Math.round((percent / 100) * (bookData.pagesTotal || 300))
          );
        }

        await booksRef().doc(currentReaderBookId).update(updates);
      } catch (_) {}
    });

    rendition.on('selected', (cfiRange, contents) => {
      contents.window.getSelection();
      try {
        const selection = contents.window.getSelection();
        const text = selection ? String(selection).trim() : '';
        if (text) {
          lastSelectedText = text;
          dom.quoteText.value = text;
          dom.quotePanel.classList.remove('hidden');
        }
      } catch (_) {}
      rendition.annotations.remove(cfiRange, 'highlight');
      rendition.annotations.add('highlight', cfiRange, {}, null, 'hl', {
        fill: 'yellow',
        'fill-opacity': '0.35'
      });
    });
  } catch (err) {
    console.error(err);
    showToast('Не вдалося відкрити EPUB');
    closeReader();
  }
}

function useSelectedText() {
  if (!lastSelectedText) return showToast('Немає виділеного тексту');
  dom.quoteText.value = lastSelectedText;
}

async function saveQuote() {
  const text = dom.quoteText.value.trim();
  if (!text) return showToast('Цитата порожня');
  if (!currentReaderBookId) return;

  const book = myLibrary.find(b => b.id === currentReaderBookId);
  if (!book) return;

  const notes = Array.isArray(book.notes) ? [...book.notes] : [];
  notes.push({
    text,
    createdAt: Date.now()
  });

  await booksRef().doc(currentReaderBookId).update({ notes });
  dom.quoteText.value = '';
  dom.quotePanel.classList.add('hidden');
  showToast('Цитату збережено');
}

function loadRealRecommendations(category = 'auto') {
  currentRecCategory = category;
  currentRecQueryIndex = 0;
  recStartIndex = 0;
  currentRecQueries = [];
  shownRecTitles.clear();
  recExhausted = false;

  dom.recommendationsList.innerHTML = `
    <div class="p-8 flex flex-col items-center justify-center text-slate-400 text-sm fade-in animate-pulse w-full">
      <span class="text-3xl mb-3">✨</span>
      Підбираємо книги...
    </div>
  `;

  dom.recTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.rec === category));

  let pool = [];

  if (category === 'auto') {
    const authors = myLibrary
      .map(b => b.author)
      .filter(a => a && a.length > 2 && !a.toLowerCase().includes('невідом') && !a.toLowerCase().includes('author'));

    if (authors.length) {
      const counts = {};
      authors.forEach(a => counts[a] = (counts[a] || 0) + 1);
      const topAuthors = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 10);
      pool.push(...topAuthors.map(a => `inauthor:${a}`));
    }

    const generic = Object.values(curatedCategories).flat();
    generic.sort(() => 0.5 - Math.random());
    pool.push(...generic);
  } else {
    pool = [...(curatedCategories[category] || [])];
    pool.sort(() => 0.5 - Math.random());
  }

  currentRecQueries = pool;
  fetchMoreRecommendations(true);
}

async function fetchMoreRecommendations(isFirstLoad = false) {
  if (isFetchingRecs || currentRecQueryIndex >= currentRecQueries.length) {
    if (currentRecQueryIndex >= currentRecQueries.length) recExhausted = true;
    return;
  }

  isFetchingRecs = true;
  dom.recLoadingState.classList.remove('hidden');

  const finalBooks = [];
  let consecutiveEmptyFetches = 0;

  while (finalBooks.length < 8 && currentRecQueryIndex < currentRecQueries.length && consecutiveEmptyFetches < 5) {
    const q = currentRecQueries[currentRecQueryIndex];
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=40&startIndex=${recStartIndex}`;

    try {
      const res = await fetch(url).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }));
      const items = Array.isArray(res.items) ? res.items : [];

      if (items.length < 30) {
        currentRecQueryIndex++;
        recStartIndex = 0;
      } else {
        recStartIndex += 40;
      }

      const existingTitles = new Set(myLibrary.map(b => String(b.title).trim().toLowerCase()));
      const valid = items.filter(item => isValidRecommendation(item, currentRecCategory, existingTitles));

      const uniqueMap = new Map();
      valid.forEach(item => {
        const b = item.volumeInfo || {};
        const key = `${String(b.title || '').toLowerCase()}|${String(b.authors?.[0] || '').toLowerCase()}`;
        if (!uniqueMap.has(key)) uniqueMap.set(key, item);
      });

      const uniqueBatch = Array.from(uniqueMap.values());

      if (!uniqueBatch.length) {
        consecutiveEmptyFetches++;
      } else {
        consecutiveEmptyFetches = 0;
        uniqueBatch.forEach(item => {
          const b = item.volumeInfo || {};
          const key = `${String(b.title || '').toLowerCase()}|${String(b.authors?.[0] || '').toLowerCase()}`;
          shownRecTitles.add(key);
          finalBooks.push(item);
        });
      }
    } catch (_) {
      consecutiveEmptyFetches++;
      currentRecQueryIndex++;
      recStartIndex = 0;
    }
  }

  if (!finalBooks.length && isFirstLoad) {
    dom.recommendationsList.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm w-full">Наразі не вдалося підібрати рекомендації.</div>`;
    dom.recLoadingState.classList.add('hidden');
    isFetchingRecs = false;
    return;
  }

  if (!finalBooks.length) {
    dom.recLoadingState.classList.add('hidden');
    isFetchingRecs = false;
    if (currentRecQueryIndex >= currentRecQueries.length) recExhausted = true;
    return;
  }

  if (isFirstLoad) dom.recommendationsList.innerHTML = '';

  finalBooks.sort(() => 0.5 - Math.random());

  finalBooks.forEach(item => {
    const b = item.volumeInfo || {};
    const bookObj = normalizeBook({
      googleId: item.id || Math.random().toString(36).slice(2),
      title: b.title,
      author: b.authors ? b.authors[0] : '',
      pagesTotal: b.pageCount || 300,
      image: b.imageLinks?.thumbnail ? String(b.imageLinks.thumbnail).replace(/^http:/i, 'https:') : PLACEHOLDER_IMG,
      description: b.description || 'Опис відсутній.',
      genre: b.categories?.[0] || '',
      tags: deriveTagsFromBookInfo(b, currentRecCategory)
    });

    const div = document.createElement('div');
    div.className = 'rec-card fade-in';
    div.dataset.title = `${bookObj.title} ${bookObj.author} ${bookObj.genre} ${bookObj.description} ${(bookObj.tags || []).join(' ')}`.toLowerCase();
    div.innerHTML = `
      <img src="${escapeAttr(getImage(bookObj.image))}" onerror="this.src='${PLACEHOLDER_IMG}'">
      <div class="flex-1 min-w-0">
        <div class="font-bold text-sm text-slate-900 leading-tight">${escapeHtml(bookObj.title)}</div>
        <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(bookObj.author)}</div>
        <div class="rec-desc">${escapeHtml(trimText(bookObj.description, 160))}</div>
        <div class="rec-badge">${escapeHtml(bookObj.genre || currentRecCategory || 'Рекомендація')}</div>
      </div>
      <button class="text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg text-xs font-bold shrink-0 mt-2 pointer-events-none">Деталі</button>
    `;
    div.addEventListener('click', () => showBookDetails(bookObj, true));
    dom.recommendationsList.appendChild(div);
  });

  filterRenderedRecommendations();

  dom.recLoadingState.classList.add('hidden');
  isFetchingRecs = false;

  if (currentRecQueryIndex >= currentRecQueries.length) {
    recExhausted = false;
    currentRecQueryIndex = 0;
    recStartIndex = 0;
    currentRecQueries.sort(() => 0.5 - Math.random());
  }
}

function filterRenderedRecommendations() {
  const q = dom.recFilterInput.value.trim().toLowerCase();
  dom.recommendationsList.querySelectorAll('.rec-card').forEach(card => {
    const visible = !q || card.dataset.title.includes(q);
    card.classList.toggle('hidden', !visible);
  });
}

function isValidRecommendation(item, category, existingTitles) {
  const b = item.volumeInfo || {};
  if (!b.title) return false;

  const title = String(b.title || '').trim();
  const desc = String(b.description || '').trim();
  const author = String(b.authors?.[0] || '').trim();
  const categories = Array.isArray(b.categories) ? b.categories.join(' ') : '';
  const titleLower = title.toLowerCase();
  const descLower = desc.toLowerCase();
  const allText = `${title} ${author} ${categories} ${desc}`.toLowerCase();

  if (!desc || desc.length < 40) return false;
  if (b.pageCount !== undefined && b.pageCount > 0 && b.pageCount < 40) return false;

  if (existingTitles.has(titleLower)) return false;

  const key = `${titleLower}|${author.toLowerCase()}`;
  if (shownRecTitles.has(key)) return false;

  const hardBadWords = [
    'history', 'biography', 'memoir', 'cookbook', 'medical', 'law', 'economics',
    'математика', 'право', 'історія', 'біографія', 'кулінарія', 'підручник',
    'study guide', 'analysis', 'criticism', 'religion', 'тіло в бібліотеці'
  ];

  if (hardBadWords.some(w => allText.includes(w))) return false;

  if (category === 'Академія магії') {
    const positive = [
      'academy', 'magic school', 'school of magic', 'wizard school', 'wizard academy',
      'mage academy', 'magic academy', 'magical academy', 'spellcaster academy',
      'академ', 'магічн', 'школа магії', 'школа чарів', 'академія магії'
    ];

    const magic = [
      'magic', 'wizard', 'mage', 'sorcer', 'spell', 'witch', 'fantasy',
      'магі', 'чакл', 'відьм', 'чар', 'фентезі'
    ];

    const academyHit = positive.some(w => allText.includes(w));
    const magicHit = magic.some(w => allText.includes(w));

    if (!(academyHit && magicHit)) return false;

    const strictBad = [
      'history', 'historical', 'classic', 'analysis', 'foreign literature',
      'зарубіжна література', 'історич', 'детектив', 'agatha christie'
    ];
    if (strictBad.some(w => allText.includes(w))) return false;
  }

  if (category && category !== 'auto' && category !== 'Академія магії') {
    const categoryTokens = category.toLowerCase().split(/\s+/);
    const looseMatch = categoryTokens.some(t => allText.includes(t)) || allText.includes(translateCategory(category));
    if (!looseMatch) return false;
  }

  if (!isCyrillic(title) && isEnglishTitle(title)) {
    const allowEnglishForMagic = category === 'Академія магії';
    if (!allowEnglishForMagic) return false;
  }

  return true;
}

function deriveTagsFromBookInfo(b, category) {
  const text = `${b.title || ''} ${b.description || ''} ${(b.categories || []).join(' ')}`.toLowerCase();
  const tags = new Set();

  if (text.includes('magic') || text.includes('магі')) tags.add('магія');
  if (text.includes('academy') || text.includes('академ')) tags.add('академія');
  if (text.includes('romance') || text.includes('роман')) tags.add('романтика');
  if (text.includes('dragon') || text.includes('дракон')) tags.add('дракони');
  if (text.includes('dark')) tags.add('dark');
  if (category === 'Академія магії') {
    tags.add('магічна академія');
    tags.add('фентезі');
  }

  return Array.from(tags);
}

function isEnglishTitle(title) {
  if (!title) return true;
  const letters = title.match(/[a-zA-Zа-яА-ЯіїєґІЇЄҐ]/g);
  if (!letters) return false;
  const engLetters = title.match(/[a-zA-Z]/g);
  return engLetters && engLetters.length / letters.length > 0.4;
}

function isCyrillic(str) {
  return /[а-яіїєґ]/i.test(str || '');
}

function translateCategory(category) {
  const map = {
    'Фентезі': 'fantasy',
    'Детектив': 'detective',
    'Трилер': 'thriller',
    'Романтика': 'romance',
    'Саморозвиток': 'self',
    'Фантастика': 'science fiction'
  };
  return map[category] || '';
}

function formatTime(secs) {
  if (!secs) return '0 хв';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('uk-UA');
}

function clampNumber(value, min, max) {
  let n = parseInt(value || 0, 10) || 0;
  n = Math.max(min, n);
  n = Math.min(max, n);
  return n;
}

function trimText(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function getImage(url) {
  if (!url) return PLACEHOLDER_IMG;
  return String(url).replace(/^http:/i, 'https:');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#096;');
}
