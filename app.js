const PLACEHOLDER_IMG='icon-192.png';
const firebaseConfig={apiKey:"AIzaSyAXgYW2_9ofKCvLoQFT6oMz0bCvbvldPGg",authDomain:"chitayko-pwa.firebaseapp.com",projectId:"chitayko-pwa",storageBucket:"chitayko-pwa.firebasestorage.app",messagingSenderId:"278531514478",appId:"1:278531514478:web:731dad47437f6aae2b067f",measurementId:"G-1JN4FBQ13K"};
firebase.initializeApp(firebaseConfig);
const auth=firebase.auth(),db=firebase.firestore();
db.enablePersistence({synchronizeTabs:true}).catch(e=>console.log(e.code));

let currentUser=null,myLibrary=[],tempSelectedBook=null,timeoutId=null;
let currentLibraryTab='reading',viewMode=localStorage.getItem('viewMode')||'list';
let rendition=null,currentReaderBookId=null,currentBookInstance=null;
let readerOpening=false,readerProgressTimer,flushReaderProgress;
let readerTheme=localStorage.getItem('readerTheme')||'light',readerFontSize=parseInt(localStorage.getItem('readerFontSize'))||100;
let readingTimer=null,readingStartTime=0,currentSessionSeconds=0;
let recStartIndex=0,currentRecQueries=[],currentRecQueryIndex=0,isFetchingRecs=false,currentRecCategory=null;
let shownRecTitles=new Set(),libraryFilterQuery='',readerDepsLoaded=false;
let currentTab='library';
let finishedFilters={year:'',rating:'',reread:false};
let localEpubIds=new Set();
let unsubscribeLibrary;
let chartReady;

function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function todayDate(){
    const now=new Date();
    return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}
function dateValue(value){
    return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))?value:'';
}
function formatReadingDate(value){
    const date=dateValue(value);
    return date?new Intl.DateTimeFormat('uk-UA',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(date)):'';
}
function rereads(book){
    return Array.isArray(book.rereads)?book.rereads.filter(entry=>entry&&dateValue(entry.finished)): [];
}
function completionDates(book){
    return [dateValue(book.dateFinished),...rereads(book).map(entry=>entry.finished)].filter(Boolean);
}
function isCompleted(book){
    return book.status==='finished'||Boolean(book.activeReread)||rereads(book).length>0;
}
function currentPages(book){
    return Number(book.activeReread?book.rereadProgress?.[book.activeReread.id]?.pagesRead:book.pagesRead)||0;
}
function progressPercent(book){
    return Math.min(100,Math.max(0,Math.round(currentPages(book)/(book.pagesTotal||300)*100)));
}
function libraryBook(id){
    return myLibrary.find(book=>book.id===id);
}
function showLibraryBook(id){
    showBookDetails(libraryBook(id));
}
function bookCover(value){
    try{
        const url=new URL(value);
        if(url.protocol==='https:'||url.protocol==='http:')return escapeHtml(url.href);
    }catch{}
    return PLACEHOLDER_IMG;
}
function libraryMatch(candidate,books=myLibrary){
    const exact=books.find(book=>book.id===candidate.id||(book.googleId&&book.googleId===candidate.googleId));
    if(exact)return exact;
    const isbn=(Array.isArray(candidate.identifiers)?candidate.identifiers:[]).map(canonicalIsbn).filter(Boolean);
    const normalized=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('uk').replace(/[^\p{L}\p{N}]/gu,'');
    return books.find(book=>{
        const own=(Array.isArray(book.identifiers)?book.identifiers:[]).map(canonicalIsbn).filter(Boolean);
        if(own.length&&isbn.length)return own.some(value=>isbn.includes(value));
        return normalized(book.title)===normalized(candidate.title)&&normalized(book.author)&&normalized(book.author)===normalized(candidate.author);
    });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded',()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
    document.querySelectorAll('.bottom-sheet').forEach(enableSheetDrag);
    enableDetailsSwipe(document.getElementById('detailsSheet'));
    enableTabSwipe(document.getElementById('appScreen'));
    enableBookLongPress(document.getElementById('myBooksContainer'));
    enableLibraryToolsControls();
    enableBackdropDismiss();
    const viewport=window.visualViewport;
    let viewportFrame;
    function scheduleViewportUpdate(){
        cancelAnimationFrame(viewportFrame);
        viewportFrame=requestAnimationFrame(updateKeyboardLayout);
    }
    viewport?.addEventListener('resize',scheduleViewportUpdate);
    viewport?.addEventListener('scroll',scheduleViewportUpdate);
    window.addEventListener('resize',scheduleViewportUpdate);
    window.addEventListener('pageshow',scheduleViewportUpdate);
    scheduleViewportUpdate();
    document.addEventListener('focusin',scheduleViewportUpdate);
    document.addEventListener('focusout',scheduleViewportUpdate);
    document.addEventListener('keydown',event=>{
        if(event.key!=='Escape'||event.defaultPrevented)return;
        if(scannerSession&&!scannerSession.cancelled){closeScanner();return;}
        if(document.activeElement===searchInput||document.activeElement===clearSearchButton){
            event.preventDefault();
            if(searchInput.value)clearBookSearch();
            else searchInput.blur();
            return;
        }
        if(document.body.classList.contains('modal-open'))dismissCurrentSheet();
    });
    const target=document.getElementById('recScrollTarget');
    if(target&&'IntersectionObserver' in window){
        const observer=new IntersectionObserver(entries=>{
            if(entries[0].isIntersecting&&currentTab==='discover'&&!isFetchingRecs&&currentRecQueries.length)fetchMoreRecommendations();
        },{rootMargin:'300px'});
        observer.observe(target);
    }
});

function updateKeyboardLayout(){
    const viewport=window.visualViewport;
    const layoutHeight=document.documentElement.clientHeight;
    const focused=document.activeElement;
    const textField=focused?.matches('textarea, input:is([type=search],[type=text],[type=email],[type=password],[type=url],[type=number]), [contenteditable=true]');
    const keyboardWasOpen=document.body.classList.contains('keyboard-open');
    const unzoomed=viewport&&Math.abs(viewport.scale-1)<.03&&viewport.height>0;
    const keyboard=Boolean(unzoomed&&(textField||keyboardWasOpen)&&layoutHeight-viewport.height>115);
    document.body.classList.toggle('keyboard-open',keyboard);
    const style=document.documentElement.style;
    const bottomGap=unzoomed?Math.max(0,layoutHeight-viewport.height-viewport.offsetTop):0;
    if(unzoomed){
        style.setProperty('--visible-viewport-height',viewport.height+'px');
        style.setProperty('--viewport-bottom-gap',bottomGap+'px');
    }else{
        style.removeProperty('--visible-viewport-height');
        style.removeProperty('--viewport-bottom-gap');
    }
    if(keyboard){
        style.setProperty('--keyboard-inset',bottomGap+'px');
        style.setProperty('--sheet-height',viewport.height+'px');
    }else{
        style.removeProperty('--keyboard-inset');
        style.removeProperty('--sheet-height');
        updateStandaloneBottomInset(layoutHeight);
    }
}

function updateStandaloneBottomInset(layoutHeight){
    if(navigator.standalone!==true||!navigator.userAgent.includes('iPhone')||innerWidth>=layoutHeight){
        document.body.classList.remove('standalone-bottom-clipped');
        return;
    }
    // Older Home Screen installs can report the top inset inside a shortened viewport.
    const safeTop=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top'))||0;
    const missingHeight=screen.height-layoutHeight;
    const clipped=safeTop>=44&&Math.abs(missingHeight-safeTop)<=8;
    document.body.classList.toggle('standalone-bottom-clipped',clipped);
}

function enableBackdropDismiss(){
    const backdrop=document.querySelector('.backdrop');
    let tap;
    backdrop.addEventListener('pointerdown',event=>{
        if(!event.isPrimary||event.button!==0)return;
        tap={id:event.pointerId,x:event.clientX,y:event.clientY};
        backdrop.setPointerCapture(event.pointerId);
        if(document.activeElement===searchInput)event.preventDefault();
    });
    backdrop.addEventListener('pointerup',event=>{
        if(tap?.id!==event.pointerId)return;
        const distance=Math.hypot(event.clientX-tap.x,event.clientY-tap.y);
        tap=null;
        if(distance>12||document.elementFromPoint(event.clientX,event.clientY)!==backdrop)return;
        if(document.activeElement===searchInput){
            searchInput.blur();
            return;
        }
        if(document.body.classList.contains('keyboard-open'))return;
        dismissCurrentSheet();
    });
    backdrop.addEventListener('lostpointercapture',()=>{tap=null;});
}

const sheetDismissDistance=80;

function resetSheetDrag(sheet){
    sheet.classList.remove('sheet-dragging');
    sheet.style.removeProperty('transform');
}

function enableSheetDrag(sheet){
    const handle=sheet.querySelector('.drag-handle');
    let pointer,start,offset;
    handle.addEventListener('pointerdown',event=>{
        if(!event.isPrimary||event.button!==0||!sheet.classList.contains('open'))return;
        pointer=event.pointerId;
        start=event.clientY;
        offset=0;
        handle.setPointerCapture(pointer);
        sheet.classList.add('sheet-dragging');
    });
    handle.addEventListener('pointermove',event=>{
        if(event.pointerId!==pointer)return;
        offset=Math.max(0,event.clientY-start);
        sheet.style.transform=`translateY(${offset}px)`;
    });
    function end(event){
        if(event.pointerId!==pointer)return;
        pointer=null;
        resetSheetDrag(sheet);
        if(event.type==='pointerup'&&offset>=sheetDismissDistance&&sheet.classList.contains('open'))dismissCurrentSheet();
    }
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,end);
}

function consumeScroll(scrollers,distance){
    for(const scroller of scrollers){
        if(distance===0)break;
        const limit=scroller.scrollHeight-scroller.clientHeight;
        const previous=Math.max(0,Math.min(limit,scroller.scrollTop));
        const next=Math.max(0,Math.min(limit,previous-distance));
        scroller.scrollTop=next;
        distance-=previous-next;
    }
    return distance;
}

function enableDetailsSwipe(sheet){
    let gesture;
    function finish(event){
        if(!gesture)return;
        const {claimed,offset,scrolled,velocity,lastAt}=gesture;
        gesture=null;
        if(!claimed)return;
        resetSheetDrag(sheet);
        if(event.type!=='touchend')return;
        if(event.cancelable)event.preventDefault();
        const flickFromScroll=scrolled&&offset>=24&&velocity>=.65&&event.timeStamp-lastAt<90;
        if((offset>=sheetDismissDistance||flickFromScroll)&&sheet.classList.contains('open'))dismissCurrentSheet();
    }

    sheet.addEventListener('touchstart',event=>{
        if(gesture)finish(event);
        if(!sheet.classList.contains('open')||event.touches.length!==1)return;
        const target=event.target;
        if(target.closest('.drag-handle, button, a, input, select, textarea, summary, [contenteditable]'))return;
        if(document.body.classList.contains('keyboard-open')||window.getSelection()?.isCollapsed===false)return;
        const scrollers=[];
        for(let element=target;element&&element!==sheet;element=element.parentElement){
            if(element.matches('.sheet-scroll, .desc-scroll, .overflow-y-auto')&&element.scrollHeight>element.clientHeight){
                scrollers.push(element);
            }
        }
        const touch=event.touches[0];
        gesture={x:touch.clientX,y:touch.clientY,lastY:touch.clientY,lastAt:event.timeStamp,
            scrollers,claimed:false,offset:0,scrolled:false,velocity:0};
    },{passive:true});

    sheet.addEventListener('touchmove',event=>{
        if(!gesture)return;
        if(event.touches.length!==1||!event.cancelable||!sheet.classList.contains('open')){
            finish(event);
            return;
        }
        const touch=event.touches[0];
        if(!gesture.claimed){
            const x=touch.clientX-gesture.x;
            const y=touch.clientY-gesture.y;
            if(Math.max(Math.abs(x),Math.abs(y))<5)return;
            if(y<=Math.abs(x)){gesture=null;return;}
            gesture.claimed=true;
        }
        event.preventDefault();

        let distance=touch.clientY-gesture.lastY;
        gesture.velocity=distance/Math.max(16,event.timeStamp-gesture.lastAt);
        gesture.lastY=touch.clientY;
        gesture.lastAt=event.timeStamp;
        const previousOffset=gesture.offset;
        if(distance<0&&gesture.offset>0){
            const returnDistance=Math.min(-distance,gesture.offset);
            gesture.offset-=returnDistance;
            distance+=returnDistance;
        }
        const remaining=consumeScroll(gesture.scrollers,distance);
        if(distance>remaining)gesture.scrolled=true;
        gesture.offset+=Math.max(0,remaining);
        if(gesture.offset!==previousOffset){
            sheet.classList.add('sheet-dragging');
            sheet.style.transform=`translateY(${gesture.offset}px)`;
        }
    },{passive:false});

    sheet.addEventListener('touchend',finish,{passive:false});
    sheet.addEventListener('touchcancel',finish);
}

// ===== THEME =====
function applyAppTheme(dark){
    document.body.classList.toggle('dark',dark);
    const windowColor=getComputedStyle(document.body).getPropertyValue('--paper').trim();
    document.documentElement.style.setProperty('--window-color',windowColor);
    document.querySelector('meta[name="theme-color"]').content=windowColor;
}
applyAppTheme(localStorage.getItem('appTheme')==='dark');

function toggleAppTheme(){
    const dark=!document.body.classList.contains('dark');
    applyAppTheme(dark);
    localStorage.setItem('appTheme',dark?'dark':'light');
}

// ===== TABS =====
const primaryTabs={library:'tabLibrary',discover:'tabDiscover',profile:'tabProfile'};
const primaryTabOrder=Object.keys(primaryTabs);

function switchTab(tab,direction=0){
    if(currentTab===tab)return;
    document.getElementById(primaryTabs[currentTab]).classList.remove('active');
    currentTab=tab;

    const panel=document.getElementById(primaryTabs[tab]);
    panel.style.setProperty('--tab-enter-x',(direction*12)+'px');
    panel.classList.add('active');
    document.getElementById('appScreen').scrollTop=0;
    window.scrollTo(0,0);
    const nav=document.getElementById('mainBottomNav');
    nav.dataset.selectedTab=tab;
    const selectedIndex=primaryTabOrder.indexOf(tab);
    nav.querySelectorAll('.nav-tab').forEach((button,index)=>{
        const selected=index===selectedIndex;
        button.classList.toggle('active',selected);
        if(selected)button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
    });
    if(tab==='profile'){calculateStats();updateStreakWidget();updateGoalWidget();}
    if(tab==='discover'&&!currentRecCategory)loadRealRecommendations('auto','rec_auto');
}

function enableTabSwipe(screen){
    let gesture;
    const excluded='input, textarea, select, [contenteditable], #libraryTabs, #recTabs, canvas, .book-reorder-handle';
    screen.addEventListener('touchstart',event=>{
        gesture=null;
        if(event.touches.length!==1||document.body.classList.contains('modal-open'))return;
        if(event.target.closest(excluded)||window.getSelection()?.isCollapsed===false)return;
        const touch=event.touches[0];
        if(touch.clientX<24||touch.clientX>innerWidth-24)return;
        gesture={x:touch.clientX,y:touch.clientY,tab:currentTab,target:event.target,offset:0,claimed:false};
    },{passive:true});

    screen.addEventListener('touchmove',event=>{
        if(!gesture)return;
        if(event.touches.length!==1||!event.cancelable||currentTab!==gesture.tab||document.body.classList.contains('modal-open')||
            gesture.target.closest('.sortable-chosen, .sortable-drag')){
            gesture=null;
            return;
        }
        const touch=event.touches[0];
        const x=touch.clientX-gesture.x;
        const y=touch.clientY-gesture.y;
        if(!gesture.claimed){
            if(Math.max(Math.abs(x),Math.abs(y))<10)return;
            if(Math.abs(x)<Math.abs(y)*1.3){gesture=null;return;}
            gesture.claimed=true;
        }
        event.preventDefault();
        gesture.offset=x;
    },{passive:false});

    screen.addEventListener('touchend',event=>{
        const swipe=gesture;
        gesture=null;
        if(!swipe?.claimed||currentTab!==swipe.tab)return;
        if(event.cancelable)event.preventDefault();
        if(Math.abs(swipe.offset)<64)return;
        const direction=swipe.offset<0?1:-1;
        const next=primaryTabOrder[primaryTabOrder.indexOf(swipe.tab)+direction];
        if(next)switchTab(next,direction);
    },{passive:false});
    screen.addEventListener('touchcancel',()=>{gesture=null;});
}

// ===== VIEW =====
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let libraryTransition;
function animateLibraryChange(){
    if(reducedMotion.matches)return;
    const books=document.getElementById('myBooksContainer');
    libraryTransition?.cancel();
    libraryTransition=books.animate?.(
        [{opacity:.84,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],
        {duration:200,easing:'cubic-bezier(.2,.75,.25,1)'}
    );
}

function setViewMode(mode){
    if(viewMode===mode)return;
    viewMode=mode;
    localStorage.setItem('viewMode',mode);
    updateViewButtons();
    render();
    animateLibraryChange();
}
function updateViewButtons(){
    for(const mode of ['list','grid'])document.getElementById('view_'+mode).setAttribute('aria-pressed',String(viewMode===mode));
}

// ===== GOAL =====
function saveGoal(v){const g=parseInt(v)||12;if(currentUser)db.collection('users').doc(currentUser.uid).set({readingGoal:g},{merge:true});localStorage.setItem('readingGoal',g);updateGoalWidget();}
function updateGoalWidget(){
    const g=parseInt(localStorage.getItem('readingGoal'))||12,y=new Date().getFullYear();
    const f=myLibrary.filter(book=>completionDates(book).some(date=>date.startsWith(String(y)))).length;
    const p=Math.min(100,Math.round((f/g)*100));
    document.getElementById('goalYear').innerText=y;
    document.getElementById('goalProgress').innerText=`${f}/${g}`;
    document.getElementById('goalBar').style.width=p+'%';
    document.getElementById('goalInput').value=g;
}

// ===== STREAK =====
async function updateStreakWidget(){
    if(!currentUser)return;const days=[],today=new Date();
    for(let i=13;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);days.push(d.toISOString().slice(0,10));}
    let rd=new Set();
    try{const snap=await db.collection('users').doc(currentUser.uid).collection('readingDays').where(firebase.firestore.FieldPath.documentId(),'>=',days[0]).where(firebase.firestore.FieldPath.documentId(),'<=',days[days.length-1]).get();snap.forEach(doc=>rd.add(doc.id));}catch(e){}
    let streak=0;const ts=today.toISOString().slice(0,10);let cd=new Date(today);
    if(!rd.has(ts))cd.setDate(cd.getDate()-1);
    while(true){const ds=cd.toISOString().slice(0,10);if(rd.has(ds)){streak++;cd.setDate(cd.getDate()-1);}else break;}
    document.getElementById('streakCount').innerText=`${streak} ${streak===1?'день':streak<5?'дні':'днів'}`;
    document.getElementById('streakDots').innerHTML=days.map(d=>`<div class="streak-cell ${rd.has(d)?'active':'inactive'} ${d===ts?'ring-2 ring-primary-300 ring-offset-1':''}" title="${d}"></div>`).join('');
}
async function markReadingDay(){if(!currentUser)return;const t=new Date().toISOString().slice(0,10);try{await db.collection('users').doc(currentUser.uid).collection('readingDays').doc(t).set({minutes:Math.round(currentSessionSeconds/60),timestamp:Date.now()},{merge:true});}catch(e){}}

// ===== CELEBRATION =====
function showCelebration(){
    const el=document.getElementById('celebration');
    el.classList.remove('hidden');
    setTimeout(()=>el.classList.add('hidden'),1200);
    if(navigator.vibrate)navigator.vibrate([100,50,100,50,200]);
}

// ===== QUICK RESUME =====
async function refreshLocalEpubs(){
    const user=currentUser;
    try{
        const keys=await localforage.keys();
        if(user!==currentUser)return;
        localEpubIds=new Set(keys.filter(key=>key.startsWith('epub_')).map(key=>key.slice(5)));
        renderQuickResume();
        render();
    }catch(error){console.warn(error);}
}
function renderQuickResume(){
    const qr=document.getElementById('quickResume');
    const book=myLibrary.filter(book=>book.status==='reading'&&localEpubIds.has(book.id))
        .sort((a,b)=>(b.lastOpenedAt||0)-(a.lastOpenedAt||0)||(b.timeSpent||0)-(a.timeSpent||0))[0];
    qr.classList.toggle('hidden',!book);
    if(!book)return;
    qr.innerHTML=`<div class="resume-card">
        <img src="${bookCover(book.image)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
        <div class="min-w-0"><h2 class="truncate">${escapeHtml(book.title)}</h2>
        <p>Сторінка ${currentPages(book)} з ${Number(book.pagesTotal)||300}</p></div>
        <button class="primary-button" onclick="readSavedEpub('${escapeHtml(book.id)}')">Продовжити</button>
    </div>`;
}

// ===== STATS =====
async function calculateStats(){
    const year=String(new Date().getFullYear());
    const fin=myLibrary.filter(isCompleted);
    const thisYear=fin.filter(book=>completionDates(book).some(date=>date.startsWith(year)));
    document.getElementById('yearStatsTitle').textContent=`Підсумки ${year} року`;
    document.getElementById('yearUniqueBooks').textContent=thisYear.length;
    document.getElementById('yearRereads').textContent=thisYear.reduce((sum,book)=>sum+rereads(book).filter(entry=>entry.finished.startsWith(year)).length,0);
    const tp=fin.reduce((s,b)=>s+(parseInt(b.pagesTotal)||0),0);
    const tt=myLibrary.reduce((s,b)=>s+(b.timeSpent||0),0);
    document.getElementById('statBooks').innerText=fin.length;
    document.getElementById('statPages').innerText=tp>999?(tp/1000).toFixed(1)+'k':tp;
    document.getElementById('statTime').innerText=Math.round(tt/3600);
    try{await (chartReady??=loadChartJS());}catch{chartReady=null;return;}
    if(currentTab!=='profile')return;
    const ctx=document.getElementById('statsChart');if(!ctx)return;
    const months={};fin.forEach(b=>{if(b.dateFinished&&typeof b.dateFinished==='string'&&b.dateFinished.length>=7){const m=b.dateFinished.substring(0,7);months[m]=(months[m]||0)+1;}});
    const labels=Object.keys(months).sort().slice(-8);const data=labels.map(l=>months[l]);
    if(window.myChart)window.myChart.destroy();
    window.myChart=new Chart(ctx,{type:'bar',data:{labels:labels.map(l=>l.slice(5)),datasets:[{data,backgroundColor:'#416357',borderRadius:8,barThickness:20}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1},grid:{color:'rgba(0,0,0,.04)'}},x:{grid:{display:false}}}}});
}

// ===== EXPORT/IMPORT =====
function exportLibrary(){if(!allBookRecords.length)return alert('Порожньо!');const d="data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(allBookRecords,null,2));const a=document.createElement('a');a.href=d;a.download=`chitayko_${new Date().toISOString().slice(0,10)}.json`;a.click();}
function importLibrary(){const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const t=await f.text(),books=JSON.parse(t);if(!Array.isArray(books))throw new Error('Bad');if(!confirm(`Імпортувати ${books.length} книг?`))return;const ex=new Set(allBookRecords.map(b=>(b.title||'').toLowerCase().trim()));let imp=0;const batch=db.batch();books.forEach(book=>{const ti=(book.title||'').toLowerCase().trim();if(ex.has(ti))return;const ref=db.collection('users').doc(currentUser.uid).collection('books').doc();const c={...book};delete c.id;if(!c.dateAdded)c.dateAdded=Date.now();batch.set(ref,c);imp++;});await batch.commit();alert(`✅ ${imp} книг!`);}catch(err){alert('Помилка: '+err.message);}};inp.click();}
async function clearAppCache(){
    try{
        if('serviceWorker' in navigator){
            const scope=new URL('./',location.href).href;
            const registrations=await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.filter(registration=>registration.scope===scope).map(registration=>registration.unregister()));
        }
        if('caches' in window){
            const names=await caches.keys();
            await Promise.all(names.filter(name=>name.startsWith('chitayko-')).map(name=>caches.delete(name)));
        }
        location.reload();
    }catch(error){console.warn(error);alert('Не вдалося оновити кеш.');}
}

// ===== AUTH =====
auth.onAuthStateChanged(user=>{
    const as=document.getElementById('authScreen'),ap=document.getElementById('appScreen');
    unsubscribeLibrary?.();
    unsubscribeLibrary=null;
    currentUser=user;
    document.body.classList.toggle('app-open',Boolean(user));
    resetBookTools();
    myLibrary=[];
    localEpubIds=new Set();
    if(user){
        as.classList.add('hidden');as.classList.remove('flex');ap.classList.remove('hidden');
        document.getElementById('mainBottomNav').classList.remove('hidden');
        document.getElementById('profileName').innerText=user.displayName||user.email?.split('@')[0]||'Читач';
        document.getElementById('profileEmail').innerText=user.email||'';
        updateViewButtons();
        loadLibrary();
        loadLibraryOrganization(user);
    }else{as.classList.remove('hidden');as.classList.add('flex');ap.classList.add('hidden');document.getElementById('mainBottomNav').classList.add('hidden');}
});
function showErrorMsg(m){const e=document.getElementById('authError');e.innerText=m;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),6000);}
async function handleAuth(type,btn){const ot=btn.innerText;btn.innerText="...";const em=document.getElementById('authEmail').value,pw=document.getElementById('authPassword').value;if(em.length<5||pw.length<6){btn.innerText=ot;return showErrorMsg("Email + пароль (6+)");}try{if(type==='login')await auth.signInWithEmailAndPassword(em,pw);else await auth.createUserWithEmailAndPassword(em,pw);}catch(er){showErrorMsg(er.message);}finally{btn.innerText=ot;}}
async function signInWithGoogle(btn){const oh=btn.innerHTML;btn.innerText="...";const p=new firebase.auth.GoogleAuthProvider();try{await auth.signInWithPopup(p);}catch(er){if(er.code==='auth/popup-blocked')await auth.signInWithRedirect(p);else{showErrorMsg(er.message);btn.innerHTML=oh;}}}
function logout(){auth.signOut();closeAllSheets();}

// ===== LIBRARY =====
function loadLibrary(){
    const user=currentUser;
    const key='library_cache_'+user.uid;
    let receivedSnapshot=false;
    refreshLocalEpubs();
    localforage.getItem(key).then(cached=>{
        if(currentUser!==user||receivedSnapshot||!cached||myLibrary.length)return;
        replaceBookRecords(cached);
        render();
        updateGoalWidget();
        renderQuickResume();
    }).catch(console.warn);
    unsubscribeLibrary=db.collection('users').doc(user.uid).collection('books').orderBy('dateAdded','desc').onSnapshot(snapshot=>{
        if(currentUser!==user||(!snapshot.docs.length&&snapshot.metadata?.fromCache))return;
        receivedSnapshot=true;
        replaceBookRecords(snapshot.docs.map(doc=>({...doc.data(),id:doc.id})));
        localforage.setItem(key,allBookRecords).catch(console.warn);
        render();
        updateGoalWidget();
        renderQuickResume();
        if(currentTab==='profile')calculateStats();
    });
}
async function updateBookInFirestore(id,u){if(currentUser)await db.collection('users').doc(currentUser.uid).collection('books').doc(id).update(u);}
let filterFrame;
function filterLibrary(query){
    const normalized=query.toLowerCase().trim();
    if(libraryFilterQuery===normalized)return;
    libraryFilterQuery=normalized;
    cancelAnimationFrame(filterFrame);
    filterFrame=requestAnimationFrame(render);
}

// ===== SHEETS =====
let sheetTrigger,detailsOpenedFromSearch=false;

function openSheet(id){
    const sheet=document.getElementById(id);
    const current=document.querySelector('.bottom-sheet.open');
    if(current===sheet)return;
    if(id==='detailsSheet')detailsOpenedFromSearch=current?.id==='searchSheet';
    const focus=document.activeElement;
    if(!current)sheetTrigger=focus?.matches('button,a')?focus:null;
    if(current?.contains(focus)||focus?.matches('input,textarea'))focus.blur();
    if(current)hideSheet(current);
    document.body.classList.add('modal-open');
    document.getElementById('appScreen').inert=true;
    document.getElementById('mainBottomNav').inert=true;
    sheet.inert=false;
    sheet.classList.add('open');
    updateKeyboardLayout();
    sheet.querySelector('[aria-label^="Закрити"]')?.focus({preventScroll:true});
}

function hideSheet(sheet){
    resetSheetDrag(sheet);
    sheet.classList.remove('open');
    sheet.inert=true;
}

function closeAllSheets(){
    detailsOpenedFromSearch=false;
    libraryToolsView=null;
    cancelBookSearch();
    const sheet=document.querySelector('.bottom-sheet.open');
    if(sheet){
        if(sheet.contains(document.activeElement))document.activeElement.blur();
        hideSheet(sheet);
    }
    document.body.classList.remove('modal-open');
    document.getElementById('appScreen').inert=false;
    document.getElementById('mainBottomNav').inert=false;
    updateKeyboardLayout();
    if(sheetTrigger?.isConnected)sheetTrigger.focus({preventScroll:true});
    sheetTrigger=null;
}
function closeDetailsSheet(){
    if(detailsOpenedFromSearch)openSheet('searchSheet');
    else closeAllSheets();
}

function dismissCurrentSheet(){
    if(document.getElementById('detailsSheet').classList.contains('open'))closeDetailsSheet();
    else if(document.getElementById('libraryToolsSheet').classList.contains('open'))closeLibraryTools();
    else closeAllSheets();
}

// ===== SCANNER =====
let scannerSession;
function openScanner(){
    if(scannerSession)return;
    const sheet=document.getElementById('scannerSheet');
    const drawer=document.getElementById('searchSheet');
    document.activeElement?.blur();
    drawer.inert=true;
    sheet.classList.remove('hidden');
    const session={cancelled:false,scanner:null,started:false};
    scannerSession=session;
    session.ready=(async()=>{
        try{
            await loadScannerLib();
            if(session.cancelled)return;
            const scanner=new Html5Qrcode('reader');
            session.scanner=scanner;
            await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:140},aspectRatio:1},text=>{
                if(session.cancelled)return;
                closeScanner();
                searchInput.value=text;
                searchInput.dispatchEvent(new Event('input'));
            },()=>{});
            session.started=true;
        }catch(error){
            if(!session.cancelled){
                console.warn(error);
                closeScanner();
                alert('Не вдалося відкрити камеру. Перевірте дозвіл або введіть ISBN вручну.');
            }
        }
    })();
}
function closeScanner(){
    const session=scannerSession;
    if(!session||session.cancelled)return;
    session.cancelled=true;
    document.getElementById('scannerSheet').classList.add('hidden');
    const drawer=document.getElementById('searchSheet');
    if(drawer.classList.contains('open'))drawer.inert=false;
    session.ready.finally(async()=>{
        try{
            if(session.started)await session.scanner.stop();
            session.scanner?.clear();
        }catch(error){console.warn(error);}
        finally{scannerSession=null;}
    });
}

// ===== SEARCH =====
const searchInput=document.getElementById('searchInput'),searchItems=document.getElementById('searchItems');
const searchResults=document.getElementById('searchResults');
const clearSearchButton=document.getElementById('clearBookSearch');
function isEnglishTitle(t){if(!t)return true;const l=t.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);if(!l)return false;const e=t.match(/[a-zA-Z]/g);return(e&&e.length>(l.length*0.4));}
function isCyrillic(s){return/[а-яА-ЯіІїЇєЄґҐ]/.test(s);}

const googleBooksKey='AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME';
let searchController;

function canonicalIsbn(value){
    const isbn=String(value||'').replace(/[\s-]/g,'').toUpperCase();
    if(/^\d{13}$/.test(isbn))return isbn;
    if(!/^\d{9}[\dX]$/.test(isbn))return '';
    const prefix='978'+isbn.slice(0,9);
    const sum=Array.from(prefix,(digit,index)=>Number(digit)*(index%2?3:1)).reduce((a,b)=>a+b,0);
    return prefix+(10-sum%10)%10;
}

async function catalogResponse(url,signal){
    if(signal.aborted)throw new DOMException('Search cancelled','AbortError');
    const controller=new AbortController();
    const abort=()=>controller.abort();
    signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,4500);
    try{
        const response=await fetch(url,{signal:controller.signal});
        if(!response.ok)throw new Error(`Catalog HTTP ${response.status}`);
        return await response.json();
    }finally{
        clearTimeout(timeout);
        signal.removeEventListener('abort',abort);
    }
}

async function searchCatalogs(query,signal,onResults){
    const authorQuery=query.match(/^author:"(.+)"$/i);
    const term=authorQuery?authorQuery[1]:query;
    const isbn=authorQuery?'':canonicalIsbn(term);
    const googleQuery=isbn?`isbn:${isbn}`:authorQuery?`inauthor:"${term}"`:`intitle:"${term}"`;
    const googleFallback=isbn|| (authorQuery?`"${term}"`:term);
    const google=async q=>{
        const params=new URLSearchParams({q,key:googleBooksKey,printType:'books',maxResults:authorQuery?'40':'20'});
        const data=await catalogResponse(`https://www.googleapis.com/books/v1/volumes?${params}`,signal);
        return (data.items||[]).filter(item=>item.volumeInfo?.title).map(({id,volumeInfo:b})=>({
            googleId:id,title:b.title,author:b.authors?.[0]||'Невідомий',authors:b.authors||[],
            pagesTotal:b.pageCount||300,image:b.imageLinks?.thumbnail||'',description:(b.description||'').replace(/<[^>]*>/g,''),
            genre:b.categories?.[0]||'',publishedDate:b.publishedDate||'',
            identifiers:(b.industryIdentifiers||[]).map(value=>value.identifier),source:'Google Books'
        }));
    };
    const apple=async()=>{
        const params=new URLSearchParams({term:isbn||term,entity:'ebook',country:'ua',limit:isbn?'5':'25'});
        if(authorQuery)params.set('attribute','authorTerm');
        const data=await catalogResponse(`https://itunes.apple.com/search?${params}`,signal);
        return (data.results||[]).filter(book=>book.trackName).map(book=>({
            googleId:`apple_${book.trackId}`,title:book.trackName,author:book.artistName||'Невідомий',
            pagesTotal:300,image:(book.artworkUrl100||'').replace('100x100bb','400x400bb'),
            description:(book.description||'').replace(/<[^>]*>/g,''),genre:book.genres?.[0]||'',
            publishedDate:(book.releaseDate||'').slice(0,4),source:'Apple Books'
        }));
    };
    const openLibrary=async()=>{
        const params=new URLSearchParams({
            lang:'uk',limit:'15',fields:isbn
                ?'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,isbn'
                :'key,title,author_name,first_publish_year,cover_i,number_of_pages_median'
        });
        if(isbn)params.set('q',`isbn:${isbn}`);
        else if(authorQuery)params.set('author',term);
        else params.set('q',term);
        const data=await catalogResponse(`https://openlibrary.org/search.json?${params}`,signal);
        return (data.docs||[]).filter(book=>book.key&&book.title).map(book=>({
            googleId:`openlibrary_${book.key.split('/').pop()}`,title:book.title,author:book.author_name?.[0]||'Невідомий',
            authors:book.author_name||[],pagesTotal:book.number_of_pages_median||300,
            image:book.cover_i?`https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg?default=false`:'',
            description:'',genre:'',publishedDate:String(book.first_publish_year||''),
            identifiers:isbn&&(book.isbn||[]).some(value=>canonicalIsbn(value)===isbn)?[isbn]:[],source:'Open Library'
        }));
    };

    const normalize=value=>value.normalize('NFKC').toLocaleLowerCase('uk').trim();
    const needle=normalize(term);
    const resultKey=book=>normalize(book.title).replace(/[^\p{L}\p{N}]/gu,'')+'|'+normalize(book.author).replace(/[^\p{L}\p{N}]/gu,'');
    const rank=book=>{
        if(isbn)return (book.identifiers||[]).some(value=>canonicalIsbn(value)===isbn)?0:1;
        const title=normalize(book.title);
        return title===needle?0:title.startsWith(needle)?1:title.includes(needle)?2:3;
    };
    const byCatalog=[];
    function collect(){
        const seen=new Set();
        return byCatalog.flat().filter(book=>{
            if(authorQuery&&!(book.authors?.length?book.authors:[book.author]).some(author=>normalize(author).includes(needle)))return false;
            const key=resultKey(book);
            if(seen.has(key))return false;
            seen.add(key);
            return true;
        }).sort((a,b)=>authorQuery?(a.publishedDate||'9999').localeCompare(b.publishedDate||'9999'):rank(a)-rank(b)).slice(0,30);
    }
    const requests=[google(googleQuery),google(googleFallback),apple(),openLibrary()];
    const sources=await Promise.allSettled(requests.map(async (request,index)=>{
        byCatalog[index]=await request;
        if(!signal.aborted&&onResults){
            const books=collect();
            if(books.length)onResults(books);
        }
    }));
    return {books:collect(),failed:sources.every(source=>source.status==='rejected')};
}

function renderSearchResults(books,failed){
    if(!books.length){
        searchItems.textContent=failed?'Каталоги тимчасово недоступні. Спробуйте ще раз.':'Книг не знайдено.';
        return;
    }
    if(!searchItems.children.length)searchItems.textContent='';
    const previous=new Map(Array.from(searchItems.children,element=>[element.dataset.book,element]));
    const results=[];
    for(const {authors,...book} of books){
        const key=book.googleId||book.title+'|'+book.author;
        const saved=previous.get(key);
        if(saved){results.push(saved);continue;}
        const existing=libraryMatch(book);
        const trashed=libraryMatch(book,trashedBooks);
        const result=document.createElement('button');
        result.type='button';
        result.dataset.book=key;
        result.className='search-result';
        result.innerHTML=`<img loading="lazy" decoding="async" src="${bookCover(book.image)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
            <span class="min-w-0"><strong class="block truncate">${escapeHtml(book.title)}</strong>
            <span class="block truncate text-muted">${escapeHtml(book.author)}</span>
            <small class="text-muted">${book.source}</small></span>
            ${existing?'<span class="in-library">У бібліотеці</span>':trashed?'<span class="in-library">У кошику</span>':''}`;
        result.onclick=()=>{
            const match=libraryMatch(book);
            if(!match&&libraryMatch(book,trashedBooks)){openLibraryTrash();return;}
            showBookDetails(match||book,!match);
        };
        results.push(result);
    }
    const wanted=new Set(results);
    for(const child of previous.values())if(!wanted.has(child))child.remove();
    results.forEach((child,index)=>{
        if(searchItems.children[index]!==child)searchItems.insertBefore(child,searchItems.children[index]||null);
    });
}

function cancelBookSearch(){
    clearTimeout(timeoutId);
    searchController?.abort();
    searchController=null;
    searchItems.removeAttribute('aria-busy');
}

function resetBookSearch(){
    cancelBookSearch();
    searchInput.value='';
    clearSearchButton.hidden=true;
    searchItems.replaceChildren();
    searchResults.scrollTop=0;
}

function clearBookSearch(){
    searchInput.focus({preventScroll:true});
    resetBookSearch();
}

function openBookSearch(author=''){
    resetBookSearch();
    openSheet('searchSheet');
    if(author){
        searchInput.value=`author:"${author}"`;
        runBookSearch();
    }
}

function runBookSearch(){
    cancelBookSearch();
    const query=searchInput.value.trim();
    clearSearchButton.hidden=!searchInput.value;
    searchResults.scrollTop=0;
    if(query.length<2){searchItems.replaceChildren();return;}
    searchItems.setAttribute('aria-busy','true');
    searchItems.textContent='Шукаємо книги…';
    const controller=new AbortController();
    searchController=controller;
    timeoutId=setTimeout(async()=>{
        try{
            const {books,failed}=await searchCatalogs(query,controller.signal,results=>renderSearchResults(results,false));
            if(!controller.signal.aborted)renderSearchResults(books,failed);
        }catch(error){
            if(!controller.signal.aborted){
                console.warn(error);
                renderSearchResults([],true);
            }
        }finally{
            if(searchController===controller){
                searchController=null;
                searchItems.removeAttribute('aria-busy');
            }
        }
    },450);
}

searchInput.addEventListener('input',runBookSearch);
searchInput.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing)return;
    event.preventDefault();
    searchInput.blur();
});
clearSearchButton.addEventListener('pointerdown',event=>{
    if(document.activeElement===searchInput)event.preventDefault();
});
clearSearchButton.addEventListener('click',clearBookSearch);

function openManualForm(){tempSelectedBook='manual';toggleEditMode(true);document.getElementById('editTitle').value='';document.getElementById('editAuthor').value='';document.getElementById('editPages').value='';document.getElementById('editImage').value='';document.getElementById('statusButtons').classList.remove('hidden');openSheet('detailsSheet');}
// ===== DETAILS =====
function showBookDetails(bookData,isNew=false){
    if(!bookData||!bookData.title)return;
    const existing=isNew?libraryMatch(bookData):null;
    const lb=existing||bookData;
    isNew=isNew&&!existing;
    tempSelectedBook=isNew?bookData:null;toggleEditMode(false);
    const sa=escapeHtml(lb.author||'Невідомий');
    let h=`<div class="detail-cover flex gap-4 mb-5 fade-in"><img loading="lazy" decoding="async" src="${bookCover(lb.image)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="" class="w-24 h-36 object-cover rounded-2xl shadow-lg flex-shrink-0"><div class="flex flex-col justify-center min-w-0 flex-1"><h3 class="text-lg font-bold leading-tight mb-1.5">${escapeHtml(lb.title||'Без назви')}</h3><button onclick="openBookSearch(this.textContent.trim())" class="text-left w-fit px-2 py-0.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-semibold mb-2 active:scale-95">${sa}</button><span class="text-xs text-muted">📄 ${lb.pagesTotal||300} стор.</span>${!isNew&&!lb.activeReread?`<select aria-label="Статус книги" onchange="changeStatusFromDetails('${lb.id}',this.value)" class="mt-2 bg-slate-50 border border-slate-200 text-xs rounded-lg p-1.5 outline-none cursor-pointer"><option value="planned" ${lb.status==='planned'?'selected':''}>⏳ В планах</option><option value="reading" ${lb.status==='reading'?'selected':''}>📖 Читаю</option><option value="finished" ${lb.status==='finished'?'selected':''}>✅ Прочитано</option></select>`:''}</div></div>`;
    if(!isNew){
        h+=renderBookLabels(lb);
        h+=renderReadingHistory(lb);
        // Progress slider
        if(lb.status==='reading'){
            h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-muted mb-2">📊 Прогрес: <span id="sliderVal">${currentPages(lb)}</span> / ${lb.pagesTotal||300} стор.</p><input type="range" min="0" max="${lb.pagesTotal||300}" value="${currentPages(lb)}" class="progress-slider" oninput="document.getElementById('sliderVal').innerText=this.value" onchange="updateProgress('${lb.id}',this.value)"></div>`;
        }
        h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-muted mb-2">📖 Читалка</p><div class="flex gap-2"><button onclick="readSavedEpub('${lb.id}')" class="flex-1 py-2.5 bg-primary-600 text-white rounded-xl font-bold text-xs active:scale-95 shadow-md shadow-primary-200">Читати</button><div class="relative flex-1"><input type="file" id="epubFileModal_${lb.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${lb.id}')"><button onclick="document.getElementById('epubFileModal_${lb.id}').click()" class="w-full py-2.5 bg-slate-100 rounded-xl font-bold text-xs active:scale-95">📥 .epub</button></div></div></div>`;
        const hl=lb.highlights||[];
        if(hl.length>0)h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-amber-600 mb-2">✍️ Виділення (${hl.length})</p><div class="space-y-1.5 max-h-32 overflow-y-auto">${hl.map((x,i)=>`<div class="text-xs bg-amber-50 p-2.5 rounded-lg italic relative border border-amber-100">"${escapeHtml(x.text.substring(0,150))}"<button onclick="deleteHighlight('${lb.id}',${i})" class="absolute top-1 right-1.5 text-red-400 text-[10px]">✕</button></div>`).join('')}</div></div>`;
        let stars='';const cr=lb.rating||0;for(let i=1;i<=5;i++)stars+=`<button type="button" data-rating="${i}" aria-label="Оцінка ${i} з 5" aria-pressed="${cr===i}" onclick="setRating('${lb.id}',${i})" class="text-3xl cursor-pointer ${cr>=i?'text-amber-400':'text-slate-200'} active:scale-90 transition-transform">★</button>`;
        h+=`<div class="mb-5 text-center card-elevated p-4"><p class="text-[10px] font-bold uppercase text-muted mb-2">Оцінка</p><div class="flex justify-center gap-2">${stars}</div></div>`;
        h+=`<div class="mb-5 p-4 card-elevated"><div class="flex justify-between items-center mb-2"><p class="text-[10px] font-bold uppercase text-muted">Нотатки</p><button onclick="saveReview('${lb.id}',this)" class="text-primary-600 bg-primary-50 px-3 py-1 rounded-lg text-[10px] font-bold active:scale-95">Зберегти</button></div><textarea id="reviewText_${lb.id}" class="w-full bg-transparent text-sm outline-none resize-none min-h-[60px]" placeholder="Враження...">${escapeHtml(lb.review||'')}</textarea></div>`;
    }
    h+=`<div class="desc-scroll mb-4"><p class="text-[10px] font-bold uppercase text-muted mb-1">Анотація</p><p class="text-sm text-muted leading-relaxed">${escapeHtml(lb.description||'Немає.')}</p></div>`;
    if(!isNew)h+=`<button onclick="moveBookToTrash(document.getElementById('detailsContent').dataset.book)" class="w-full py-3 text-red-500 bg-red-50 rounded-xl font-bold text-sm active:scale-95 mb-4">До кошика</button>`;
    const details=document.getElementById('detailsContent');
    const updateOpenCard=document.getElementById('detailsSheet').classList.contains('open');
    details.dataset.book=lb.id||'';
    details.innerHTML=h;
    if(!updateOpenCard)details.scrollTop=0;
    document.getElementById('statusButtons').classList.toggle('hidden',!isNew);
    openSheet('detailsSheet');
}

function firstReadingDates(book){
    const started=formatReadingDate(book.dateStarted);
    const finished=formatReadingDate(book.dateFinished);
    if(!started&&!finished)return 'Дати не вказано';
    if(!started)return `Завершено ${finished}`;
    if(!finished)return `Почато ${started}`;
    return started===finished?started:`${started} — ${finished}`;
}

function renderReadingHistory(book){
    const id=escapeHtml(book.id);
    const completed=isCompleted(book)||Boolean(book.dateFinished);
    const entries=rereads(book).slice().sort((a,b)=>b.finished.localeCompare(a.finished));
    const dateInput=(label,field)=>`<label class="history-date">${label}<input type="date" value="${dateValue(book[field])}"
        onchange="saveManualDate('${id}','${field}',this)"></label>`;
    const actions=book.activeReread
        ?`<button class="primary-button" onclick="changeStatusFromDetails('${id}','finished')">Завершити перечитування</button>`
        :`<button class="primary-button" onclick="changeStatusFromDetails('${id}','reading')">Почати перечитування</button>`;
    return `<section class="reading-history card-elevated">
        <h4>Історія читання</h4>
        ${book.activeReread?`<div class="history-entry"><strong>Перечитування триває</strong><span>${formatReadingDate(book.activeReread.started)}</span></div>`:''}
        ${entries.map(entry=>`<div class="history-entry"><strong>Перечитування</strong><span>${entry.started?formatReadingDate(entry.started)+' — ':''}${formatReadingDate(entry.finished)}</span></div>`).join('')}
        <div class="history-entry"><strong>Перше читання</strong><span>${firstReadingDates(book)}</span>
            <details class="history-edit"><summary>Редагувати дати</summary><div class="history-dates">
                ${dateInput('Початок','dateStarted')}${dateInput('Завершення','dateFinished')}
            </div></details>
        </div>
        ${completed?`<div class="history-actions">${actions}<details><summary>Додати минуле перечитування</summary>
            <form class="history-dates" onsubmit="savePastReread(event,'${id}')">
                <label class="history-date">Початок<input name="started" type="date" max="${todayDate()}"></label>
                <label class="history-date">Завершення<input name="finished" type="date" max="${todayDate()}" required></label>
                <button type="submit" class="secondary-button">Зберегти</button>
            </form></details></div>`:''}
    </section>`;
}

async function updateProgress(id,val){
    const book=libraryBook(id);
    const pagesRead=Number(val);
    if(!book||!Number.isFinite(pagesRead))return;
    try{
        if(book.activeReread){
            await saveRereadProgress(id,book.activeReread.id,{pagesRead});
        }else{
            await updateBookInFirestore(id,{pagesRead});
        }
    }catch(error){showWriteError(error);}
}

function showWriteError(error){
    console.warn(error);
    alert('Зміни не збережено. Перевірте з’єднання та спробуйте ще раз.');
}

function changeBook(id,update){
    const ref=db.collection('users').doc(currentUser.uid).collection('books').doc(id);
    return db.runTransaction(async transaction=>{
        const snapshot=await transaction.get(ref);
        if(!snapshot.exists)throw new Error('Book not found');
        const changes=isBookTrashed(snapshot.data())?undefined:update(snapshot.data());
        if(changes)transaction.update(ref,changes);
        return changes;
    });
}

function saveRereadProgress(id,sessionId,progress){
    const fields=Object.fromEntries(Object.entries(progress).map(([key,value])=>[`rereadProgress.${sessionId}.${key}`,value]));
    return updateBookInFirestore(id,fields);
}

function statusChanges(book,status,date,sessionId){
    if(status==='reading'&&!book.activeReread&&(isCompleted(book)||book.dateFinished)){
        return {status,activeReread:{id:sessionId,started:date}};
    }
    if(book.status===status)return;
    if(status==='finished'&&book.activeReread){
        const started=dateValue(book.activeReread.started);
        const entry={started:started||null,finished:started>date?started:date};
        return {status,rereads:[...rereads(book),entry],activeReread:null};
    }
    if(book.activeReread)return;
    if(status==='finished')return {status,pagesRead:book.pagesTotal||300,dateFinished:book.dateFinished||date};
    if(status==='reading')return {status,dateStarted:book.dateStarted||date};
    return {status};
}

async function savePastReread(event,id){
    event.preventDefault();
    const form=event.currentTarget;
    const started=dateValue(form.elements.started.value);
    const finished=dateValue(form.elements.finished.value);
    if(!finished||finished>todayDate()||(started&&started>finished)){
        alert('Перевірте дати перечитування.');
        return;
    }
    const button=form.querySelector('button');
    button.disabled=true;
    try{
        const changes=await changeBook(id,book=>{
            const entries=rereads(book);
            if(entries.some(entry=>entry.finished===finished&&(entry.started||'')===started))return;
            return {rereads:[...entries,{started:started||null,finished}]};
        });
        const book=libraryBook(id);
        if(book&&form.isConnected)showBookDetails({...book,...changes});
    }catch(error){showWriteError(error);}
    finally{button.disabled=false;}
}

async function deleteHighlight(id,index){
    const book=libraryBook(id);
    const highlight=book?.highlights?.[index];
    if(!highlight)return;
    try{
        await updateBookInFirestore(id,{highlights:firebase.firestore.FieldValue.arrayRemove(highlight)});
        if(document.getElementById('detailsContent').dataset.book===id&&document.getElementById('detailsSheet').classList.contains('open')){
            showBookDetails({...book,highlights:book.highlights.filter((_,position)=>position!==index)});
        }
    }catch(error){showWriteError(error);}
}
function setRating(id,rating){
    const book=libraryBook(id);
    if(!book)return;
    updateBookInFirestore(id,{rating}).catch(showWriteError);
    for(const star of document.querySelectorAll('#detailsContent [data-rating]')){
        const value=Number(star.dataset.rating);
        star.setAttribute('aria-pressed',String(value===rating));
        star.classList.toggle('text-amber-400',value<=rating);
        star.classList.toggle('text-slate-200',value>rating);
    }
}
async function changeStatusFromDetails(id,status){
    if(!currentUser)return;
    const date=todayDate();
    const sessionId=crypto.randomUUID();
    try{
        const book=libraryBook(id);
        if(!book)return;
        let changes;
        if(navigator.onLine===false&&book&&!isCompleted(book)&&!book.dateFinished){
            changes=statusChanges(book,status,date,sessionId);
            if(changes)updateBookInFirestore(id,changes).catch(showWriteError);
        }else{
            changes=await changeBook(id,latest=>statusChanges(latest,status,date,sessionId));
        }
        if(changes&&status==='finished')showCelebration();
        closeAllSheets();
        setLibraryTab(status);
    }catch(error){
        showWriteError(error);
        if(document.getElementById('detailsSheet').classList.contains('open'))showLibraryBook(id);
    }
}
function toggleEditMode(v){if(v){document.getElementById('detailsContent').classList.add('hidden');document.getElementById('editContent').classList.remove('hidden');}else{document.getElementById('detailsContent').classList.remove('hidden');document.getElementById('editContent').classList.add('hidden');}}
function saveBookEdits(){const u={title:document.getElementById('editTitle').value.trim()||'Без назви',author:document.getElementById('editAuthor').value.trim()||'Невідомий',pagesTotal:parseInt(document.getElementById('editPages').value)||300,image:document.getElementById('editImage').value.trim()};if(tempSelectedBook==='manual'){tempSelectedBook={...u,description:'Вручну.'};toggleEditMode(false);showBookDetails(tempSelectedBook,true);}else{updateBookInFirestore(tempSelectedBook.id,u);showBookDetails({...tempSelectedBook,...u});}}
function cancelBookEdit(){
    if(tempSelectedBook==='manual')closeDetailsSheet();
    else toggleEditMode(false);
}

async function saveReview(id,button){
    const notes=document.getElementById(`reviewText_${id}`);
    const value=notes.value;
    button.disabled=true;
    try{
        await updateBookInFirestore(id,{review:value});
        if(button.isConnected&&notes.value===value){
            button.textContent='Збережено';
            setTimeout(()=>{button.textContent='Зберегти';},1200);
        }
    }catch(error){showWriteError(error);}
    finally{button.disabled=false;}
}

let addingBook=false;
async function addBookWithStatus(status){
    if(!currentUser||!tempSelectedBook||addingBook)return;
    if(tempSelectedBook==='manual')saveBookEdits();
    else{
        const existing=libraryMatch(tempSelectedBook);
        if(existing){showBookDetails(existing);return;}
        if(libraryMatch(tempSelectedBook,trashedBooks)){openLibraryTrash();return;}
    }

    const selected=tempSelectedBook;
    const date=todayDate();
    const user=currentUser;
    const buttons=document.querySelectorAll('#statusButtons button');
    addingBook=true;
    buttons.forEach(button=>button.disabled=true);
    try{
        await db.collection('users').doc(user.uid).collection('books').add({
            ...selected,status,pagesRead:status==='finished'?selected.pagesTotal:0,dateAdded:Date.now(),
            rating:0,review:'',highlights:[],timeSpent:0,lastFileName:null,sortOrder:0,
            dateStarted:status==='reading'?date:null,dateFinished:status==='finished'?date:null
        });
        if(currentUser!==user||tempSelectedBook!==selected)return;
        tempSelectedBook=null;
        if(document.getElementById('detailsSheet').classList.contains('open'))closeAllSheets();
        if(status==='finished')showCelebration();
    }catch(error){showWriteError(error);}
    finally{
        addingBook=false;
        buttons.forEach(button=>button.disabled=false);
    }
}

function changeStatus(id,status,event){
    event.stopPropagation();
    changeStatusFromDetails(id,status);
}
async function saveManualDate(id,field,input){
    const book=libraryBook(id);
    if(!book)return;
    try{
        if(input.value&&((field==='dateStarted'&&book.dateFinished&&input.value>book.dateFinished)||(field==='dateFinished'&&book.dateStarted&&input.value<book.dateStarted))){
            alert('Початок читання має бути раніше завершення.');
            input.value=dateValue(book[field]);
            return;
        }
        const value=input.value||null;
        await updateBookInFirestore(id,{[field]:value});
        if(input.isConnected){
            const updated={...book,...libraryBook(id),[field]:value};
            input.closest('.history-entry').querySelector(':scope > span').textContent=firstReadingDates(updated);
        }
    }catch(error){
        input.value=dateValue(book[field]);
        showWriteError(error);
    }
}

// ===== READER =====
function startTimer(){readingStartTime=Date.now();currentSessionSeconds=0;document.getElementById('readerTimer').innerText="00:00";readingTimer=setInterval(()=>{currentSessionSeconds=Math.floor((Date.now()-readingStartTime)/1000);const m=String(Math.floor(currentSessionSeconds/60)).padStart(2,'0'),s=String(currentSessionSeconds%60).padStart(2,'0'),h=Math.floor(currentSessionSeconds/3600);document.getElementById('readerTimer').innerText=h>0?`${h}:${m}:${s}`:`${m}:${s}`;},1000);}
function stopTimer(){if(readingTimer&&currentReaderBookId){clearInterval(readingTimer);readingTimer=null;const b=myLibrary.find(x=>x.id===currentReaderBookId);if(b&&currentSessionSeconds>5){const t=(b.timeSpent||0)+currentSessionSeconds;db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({timeSpent:t});if(currentSessionSeconds>=300)markReadingDay();}}}
window.addEventListener('beforeunload',stopTimer);
function toggleReaderSettings(){document.getElementById('readerSettingsMenu').classList.toggle('hidden');}
function applyReaderSettings(){if(!rendition)return;rendition.themes.fontSize(readerFontSize+"%");rendition.themes.select(readerTheme);}
function changeFontSize(d){readerFontSize=Math.max(50,Math.min(200,readerFontSize+d));localStorage.setItem('readerFontSize',readerFontSize);applyReaderSettings();}
function changeReaderTheme(t){readerTheme=t;localStorage.setItem('readerTheme',t);applyReaderSettings();}
function initSwipeGestures(){if(!window.Hammer)return;const v=document.getElementById('viewer');if(!window.mc){window.mc=new Hammer(v);window.mc.get('swipe').set({direction:Hammer.DIRECTION_HORIZONTAL});window.mc.on("swipeleft",()=>{if(rendition)rendition.next();});window.mc.on("swiperight",()=>{if(rendition)rendition.prev();});}}

async function handleFileSelectAndSave(event,bookId){
    const input=event.target;
    const file=input.files[0];
    input.value='';
    if(!file||readerOpening||currentBookInstance)return;
    if(!file.name.toLowerCase().endsWith('.epub')){alert('Оберіть файл EPUB.');return;}
    const book=libraryBook(bookId);
    if(!book)return;
    if(book.lastFileName&&book.lastFileName!==file.name&&!confirm('Замінити локальний файл EPUB?'))return;
    readerOpening=true;
    try{
        const data=await file.arrayBuffer();
        try{
            await localforage.setItem(`epub_${bookId}`,data);
            localEpubIds.add(bookId);
            if(book.lastFileName!==file.name)updateBookInFirestore(bookId,{lastFileName:file.name}).catch(console.warn);
            renderQuickResume();
            render();
        }catch(error){console.warn(error);}
        await openEpubReader(bookId,data);
    }catch(error){console.warn(error);alert('Не вдалося відкрити EPUB.');}
    finally{readerOpening=false;}
}

async function readSavedEpub(bookId){
    if(readerOpening||currentBookInstance)return;
    readerOpening=true;
    try{
        const data=await localforage.getItem(`epub_${bookId}`);
        if(!data){alert('Файл не знайдено. Завантажте EPUB.');return;}
        await openEpubReader(bookId,data);
    }catch(error){console.warn(error);alert('Не вдалося відкрити EPUB.');}
    finally{readerOpening=false;}
}
function readSavedEpubFromCard(id,ev){ev.stopPropagation();readSavedEpub(id);}

async function openEpubReader(bookId,source){
    if(!readerDepsLoaded){await loadReaderDeps();readerDepsLoaded=true;}
    const bd=myLibrary.find(b=>b.id===bookId);if(!bd)return;
    const readerUser=currentUser;
    updateBookInFirestore(bookId,{lastOpenedAt:Date.now()}).catch(console.warn);
    currentReaderBookId=bookId;document.getElementById('readerOverlay').style.display='flex';document.getElementById('readerTitle').innerText=bd.title;document.getElementById('readerProgress').innerText="...";startTimer();document.getElementById('viewer').innerHTML='';
    try{
        const instance=ePub(source);
        currentBookInstance=instance;
        const reader=instance.renderTo('viewer',{width:'100%',height:'100%',spread:'none',manager:'continuous',flow:'paginated'});
        rendition=reader;
        reader.themes.register('light',{body:{background:'#fafafa',color:'#18181b'}});
        reader.themes.register('sepia',{body:{background:'#f4ecd8',color:'#5b4636'}});
        reader.themes.register('dark',{body:{background:'#09090b',color:'#d4d4d8'}});
        applyReaderSettings();
        reader.on('selected',async(cfi,contents)=>{
            reader.annotations.highlight(cfi);
            contents.window.getSelection()?.removeAllRanges();
            try{
                const range=await instance.getRange(cfi);
                const text=range?.toString().trim();
                if(!text||text.length<3||currentUser!==readerUser)return;
                const ref=db.collection('users').doc(readerUser.uid).collection('books').doc(bookId);
                await ref.update({highlights:firebase.firestore.FieldValue.arrayUnion({text,cfi,date:Date.now()})});
            }catch(error){showWriteError(error);}
        });
        let ready=false;
        function rememberLocation(location,save){
            const start=location?.start;
            if(!start||rendition!==reader)return;
            const percentage=Math.round((start.percentage||0)*100);
            document.getElementById('readerProgress').innerText=percentage>0?percentage+'%':'…';
            if(!save||!start.cfi)return;
            clearTimeout(readerProgressTimer);
            flushReaderProgress=()=>{
                flushReaderProgress=null;
                if(currentUser!==readerUser)return;
                const progress={lastCfi:start.cfi};
                if(percentage>0)progress.pagesRead=Math.round(percentage/100*(bd.pagesTotal||300));
                const write=bd.activeReread
                    ?saveRereadProgress(bookId,bd.activeReread.id,progress)
                    :updateBookInFirestore(bookId,progress);
                write.catch(console.warn);
            };
            readerProgressTimer=setTimeout(()=>flushReaderProgress?.(),1500);
        }
        reader.on('relocated',location=>rememberLocation(location,ready));
        const cfi=bd.activeReread?bd.rereadProgress?.[bd.activeReread.id]?.lastCfi:bd.lastCfi;
        const safeCfi=typeof cfi==='string'&&cfi.startsWith('epubcfi')?cfi:undefined;
        try{await reader.display(safeCfi);}catch(error){
            if(rendition!==reader)return;
            if(!safeCfi)throw error;
            await reader.display();
        }
        if(rendition!==reader)return;
        ready=true;
        closeAllSheets();
        initSwipeGestures();
        instance.ready.then(()=>{
            if(rendition===reader)return instance.locations.generate(1600);
        }).then(()=>{
            if(rendition===reader)rememberLocation(reader.currentLocation(),false);
        }).catch(()=>{});
    }catch(error){
        if(currentReaderBookId!==bookId)return;
        closeReader();
        throw error;
    }
}

function closeReader(){
    clearTimeout(readerProgressTimer);
    flushReaderProgress?.();
    stopTimer();
    document.getElementById('readerOverlay').style.display='none';
    document.getElementById('readerSettingsMenu').classList.add('hidden');
    const instance=currentBookInstance;
    currentBookInstance=null;
    rendition=null;
    currentReaderBookId=null;
    instance?.destroy();
    document.getElementById('viewer').replaceChildren();
    updateStreakWidget();
}

// ===== RENDER =====
function setLibraryTab(tab){
    const changed=currentLibraryTab!==tab;
    currentLibraryTab=tab;
    for(const button of document.querySelectorAll('#libraryTabs .pill')){
        const selected=button.id==='tab_'+tab;
        button.className=selected?'pill active':'pill inactive';
        button.setAttribute('aria-pressed',String(selected));
    }
    render();
    if(changed)animateLibraryChange();
}

function renderBookCard(book){
    const id=escapeHtml(book.id);
    const title=escapeHtml(book.title);
    const author=escapeHtml(book.author);
    const reading=currentLibraryTab==='reading';
    const planned=currentLibraryTab==='planned';
    const pages=Number(book.pagesTotal)||300;
    const completedDate=completionDates(book).sort().at(-1);
    const count=rereads(book).length;
    const progress=reading?`<div class="book-progress">
        <progress max="100" value="${progressPercent(book)}" aria-label="Прогрес читання"></progress>
        <span>Сторінка ${currentPages(book)} з ${pages}</span>
    </div>`:'';
    const completion=currentLibraryTab==='finished'?`<div class="book-meta">
        ${completedDate?`<span>${formatReadingDate(completedDate)}</span>`:''}
        ${count?`<span>Перечитувань: ${count}</span>`:''}
        ${book.rating?`<span class="book-rating">★ ${Number(book.rating)||0}</span>`:''}
    </div>`:'';
    const actions=planned?`<button class="secondary-button" onclick="changeStatus('${id}','reading',event)">Почати читати</button>`
        :reading?`<div class="book-actions">
            ${localEpubIds.has(book.id)?`<button class="primary-button" onclick="readSavedEpubFromCard('${id}',event)">Продовжити</button>`:''}
            <input type="file" id="epubFile_${id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${id}')">
            <button class="secondary-button" onclick="document.getElementById('epubFile_${id}').click()">EPUB</button>
            <button class="secondary-button" onclick="changeStatus('${id}','finished',event)">Завершити</button>
        </div>`:'';
    return `<article data-id="${id}" class="book-card card ${viewMode==='grid'?'book-card-grid':''}">
        <div class="book-card-tools">${canReorderBooks()?'<span class="book-reorder-handle" title="Перетягнути, щоб змінити порядок" aria-hidden="true">⠿</span>':''}<button type="button" class="book-actions-trigger" aria-label="Дії: ${title}" aria-haspopup="dialog">⋯</button></div>
        <button type="button" class="book-card-main" aria-label="Відкрити: ${title}">
            <img loading="lazy" decoding="async" src="${bookCover(book.image)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
            <span class="book-card-info"><strong>${title}</strong><span class="text-muted">${author}</span></span>
        </button>
        ${renderBookLabels(book)}${progress}${completion}${actions}
    </article>`;
}

function setFinishedFilters(){
    finishedFilters={
        year:document.getElementById('finishedYear').value,
        rating:document.getElementById('finishedRating').value,
        reread:document.getElementById('finishedReread').checked
    };
    render();
}

function render(){
    const q=libraryFilterQuery;
    updateOrganizationFilters();
    const matching=myLibrary.filter(book=>matchesOrganizationFilters(book)&&
        (!q||book.title?.toLowerCase().includes(q)||book.author?.toLowerCase().includes(q)));
    const reading=matching.filter(book=>book.status==='reading');
    const planned=matching.filter(book=>book.status==='planned');
    const finished=matching.filter(isCompleted);
    for(const [tab,label,books] of [['reading','Читаю',reading],['planned','Заплановано',planned],['finished','Прочитано',finished]]){
        document.getElementById('tab_'+tab).innerHTML=`${label} <span>${books.length}</span>`;
    }
    const container=document.getElementById('myBooksContainer');
    container.querySelectorAll('.sortable-list').forEach(list=>window.Sortable?.get(list)?.destroy());
    const filters=document.getElementById('finishedFilters');
    filters.hidden=currentLibraryTab!=='finished';
    const yearSelect=document.getElementById('finishedYear');
    const years=[...new Set(myLibrary.filter(isCompleted).flatMap(completionDates).map(date=>date.slice(0,4)))].sort().reverse();
    if(!years.includes(finishedFilters.year))finishedFilters.year='';
    yearSelect.innerHTML='<option value="">Усі роки</option>'+years.map(year=>`<option>${year}</option>`).join('');
    yearSelect.value=finishedFilters.year;
    const filtered=hasOrganizationFilters()||(!filters.hidden&&(finishedFilters.year||finishedFilters.rating||finishedFilters.reread));
    const list=currentLibraryTab==='reading'?reading:currentLibraryTab==='planned'?planned:finished.filter(book=>
        (!finishedFilters.year||completionDates(book).some(date=>date.startsWith(finishedFilters.year)))&&
        (!finishedFilters.rating||Number(book.rating)===Number(finishedFilters.rating))&&
        (!finishedFilters.reread||rereads(book).length>0));
    if(!list.length){
        const tips={reading:'Додайте книгу, щоб почати читати.',planned:'Тут будуть книги, які ви хочете прочитати.',finished:'Тут будуть завершені книги.'};
        container.innerHTML=`<div class="library-empty"><h2>${q||filtered?'Книг не знайдено':'Поки порожньо'}</h2>
            <p>${q||filtered?'Спробуйте інший запит або змініть фільтри.':tips[currentLibraryTab]}</p></div>`;
        return;
    }
    const classes=`book-collection ${viewMode==='grid'?'book-grid':''}`;
    if(currentLibraryTab==='finished'){
        const date=book=>completionDates(book).filter(value=>!finishedFilters.year||value.startsWith(finishedFilters.year)).sort().at(-1)||'';
        list.sort((a,b)=>date(b).localeCompare(date(a)));
        const groups=new Map();
        for(const book of list){
            const year=date(book).slice(0,4)||'Без дати';
            if(!groups.has(year))groups.set(year,[]);
            groups.get(year).push(book);
        }
        container.innerHTML=[...groups].map(([year,books])=>`<h2 class="library-year">${year}</h2><div class="${classes}">${books.map(renderBookCard).join('')}</div>`).join('');
        return;
    }
    list.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    container.innerHTML=`<div class="${classes} ${canReorderBooks()?'sortable-list':''}">${list.map(renderBookCard).join('')}</div>`;
    const sortable=container.querySelector('.sortable-list');
    if(sortable&&window.Sortable)new Sortable(sortable,{
        delay:300,delayOnTouchOnly:true,animation:reducedMotion.matches?0:150,ghostClass:'sortable-ghost',
        handle:'.book-reorder-handle',
        onEnd:event=>{[...event.from.children].forEach((element,index)=>{
            if(element.dataset.id)updateBookInFirestore(element.dataset.id,{sortOrder:index});
        });}
    });
}

// ===== RECOMMENDATIONS =====
const curatedCategories={
    'Академія магії':['"академия магии" фэнтези','"магическая академия"','ромфант академия','академия волшебства'],
    'Фентезі':['"фэнтези" бестселлер','эпическое фэнтези','Джон Толкин','Джордж Мартин','Брэндон Сандерсон','Робин Хобб','Ник Перумов','боевое фэнтези'],
    'Детектив':['"детектив" бестселлер','Агата Кристи','Ю Несбё','Стиг Ларссон','Борис Акунин','психологический детектив'],
    'Трилер':['"триллер" бестселлер','Стивен Кинг','Джиллиан Флинн','Дэн Браун','Франк Тилье','психологический триллер'],
    'Романтика':['"любовный роман" бестселлер','Николас Спаркс','Джоджо Мойес','Колин Гувер','современный любовный роман'],
    'Саморозвиток':['"саморазвитие" бестселлер','Роберт Кийосаки','Марк Мэнсон','Джо Диспенза','Джеймс Клир','психология успеха'],
    'Фантастика':['"научная фантастика" бестселлер','Айзек Азимов','Рэй Брэдбери','Энди Вейер','Сергей Лукьяненко','космическая фантастика']
};

async function loadRealRecommendations(cat='auto',btnId='rec_auto'){
    if(currentRecCategory===cat)return;currentRecCategory=cat;recStartIndex=0;currentRecQueryIndex=0;currentRecQueries=[];shownRecTitles.clear();
    const list=document.getElementById('recommendationsList');list.innerHTML='<div class="p-10 text-muted text-sm text-center animate-pulse">🔍 Шукаємо...</div>';
    document.querySelectorAll('#recTabs .pill').forEach(b=>{b.className='pill inactive';});
    if(document.getElementById(btnId))document.getElementById(btnId).className='pill active';
    let pool=[];
    if(cat==='auto'){
        let authors=myLibrary.map(b=>b.author).filter(a=>a&&a.length>2&&!a.toLowerCase().includes('невідомий'));
        if(authors.length>0){let counts={};authors.forEach(a=>counts[a]=(counts[a]||0)+1);pool.push(...Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,10).map(a=>`inauthor:"${a}"`));}
        let gen=Object.values(curatedCategories).flat();gen.sort(()=>0.5-Math.random());pool.push(...gen);
    }else{pool=[...curatedCategories[cat]];pool.sort(()=>0.5-Math.random());}
    currentRecQueries=pool;await fetchMoreRecommendations(true);
}

async function fetchMoreRecommendations(isFirst=false){
    if(isFetchingRecs||currentRecQueryIndex>=currentRecQueries.length)return;isFetchingRecs=true;
    const lst=document.getElementById('recommendationsList');
    if(!isFirst&&!document.getElementById('recLoadingMore')){const d=document.createElement('div');d.id='recLoadingMore';d.className='py-6 text-center text-muted animate-pulse text-sm';d.innerHTML='Ще...';lst.appendChild(d);}
    let finalBooks=[],empty=0;
    while(finalBooks.length<5&&currentRecQueryIndex<currentRecQueries.length&&empty<3){
        const q=currentRecQueries[currentRecQueryIndex];
        const url=`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${encodeURIComponent(q)}&maxResults=40&startIndex=${recStartIndex}`;
        try{
            const res=await fetch(url).then(r=>r.ok?r.json():{items:[]}).catch(()=>({items:[]}));
            let items=res.items||[];
            if(items.length<30){currentRecQueryIndex++;recStartIndex=0;}else{recStartIndex+=40;}
            const badWords=['учебник','словарь','журнал','комикс','манга','підручник','словник','вісник','сборник','збірник','посібник','пособие','том ','випуск','выпуск','зошит','тетрадь','хрестоматия','дневник'];
            const existingTitles=new Set(allBookRecords.map(b=>(b.title||'').trim().toLowerCase()));
            let valid=items.filter(item=>{
                const b=item.volumeInfo;
                if(!b.title||!b.description||b.description.length<20)return false;
                if(b.pageCount!==undefined&&b.pageCount>0&&b.pageCount<40)return false;
                if(!isCyrillic(b.title)||isEnglishTitle(b.title))return false;
                const tL=b.title.toLowerCase();
                if(badWords.some(w=>tL.includes(w)))return false;
                if(existingTitles.has(tL))return false;
                const key=tL+(b.authors?b.authors[0]:'');
                if(shownRecTitles.has(key))return false;
                return true;
            });
            const u=new Map();
            valid.forEach(i=>{const b=i.volumeInfo;const key=b.title.toLowerCase()+(b.authors?b.authors[0]:'');u.set(key,i);});
            let ub=Array.from(u.values());
            ub.forEach(i=>{const b=i.volumeInfo;shownRecTitles.add(b.title.toLowerCase()+(b.authors?b.authors[0]:''));finalBooks.push(i);});
            if(ub.length===0)empty++;else empty=0;
        }catch(e){empty++;currentRecQueryIndex++;recStartIndex=0;}
    }
    if(isFirst)lst.innerHTML='';
    if(document.getElementById('recLoadingMore'))document.getElementById('recLoadingMore').remove();
    if(finalBooks.length===0&&isFirst){lst.innerHTML='<div class="p-10 text-center text-muted text-sm">Не знайшли нових книг 😔<br><span class="text-xs">Спробуйте іншу категорію</span></div>';}
    else if(finalBooks.length>0){
        finalBooks.sort(()=>0.5-Math.random());
        let h='';
        finalBooks.forEach(i=>{
            const b=i.volumeInfo;
            const img=(b.imageLinks?.thumbnail||PLACEHOLDER_IMG).replace(/^http:\/\//i,'https://');
            const bk={googleId:i.id||Math.random().toString(),title:b.title,author:b.authors?b.authors[0]:'Невідомий',pagesTotal:b.pageCount||300,image:img,description:b.description||'',genre:(b.categories&&b.categories[0])||''};
            h+=`<div onclick="showBookDetails(${JSON.stringify(bk).replace(/"/g,'&quot;')},true)" class="card p-3.5 flex gap-3 items-start cursor-pointer active:scale-[0.98] transition-transform fade-in">
                <img loading="lazy" decoding="async" src="${bk.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-13 h-[72px] rounded-xl shadow-sm object-cover flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm leading-tight truncate">${bk.title}</div>
                    <div class="text-xs text-muted mt-0.5">${bk.author}</div>
                    <div class="text-[11px] text-muted mt-1 line-clamp-2 leading-snug opacity-70">${bk.description}</div>
                </div>
            </div>`;
        });
        const tmp=document.createElement('div');tmp.innerHTML=h;while(tmp.firstChild)lst.appendChild(tmp.firstChild);
    }
    isFetchingRecs=false;
}
