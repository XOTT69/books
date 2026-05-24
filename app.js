const PLACEHOLDER_IMG='https://via.placeholder.com/128x192/f1f5f9/94a3b8?text=No+Cover';
const firebaseConfig={apiKey:"AIzaSyAXgYW2_9ofKCvLoQFT6oMz0bCvbvldPGg",authDomain:"chitayko-pwa.firebaseapp.com",projectId:"chitayko-pwa",storageBucket:"chitayko-pwa.firebasestorage.app",messagingSenderId:"278531514478",appId:"1:278531514478:web:731dad47437f6aae2b067f",measurementId:"G-1JN4FBQ13K"};
firebase.initializeApp(firebaseConfig);
const auth=firebase.auth(),db=firebase.firestore();
db.enablePersistence({synchronizeTabs:true}).catch(e=>console.log(e.code));

let currentUser=null,myLibrary=[],tempSelectedBook=null,timeoutId=null;
let currentLibraryTab='reading',viewMode=localStorage.getItem('viewMode')||'list';
let rendition=null,currentReaderBookId=null,currentBookInstance=null;
let readerTheme=localStorage.getItem('readerTheme')||'light',readerFontSize=parseInt(localStorage.getItem('readerFontSize'))||100;
let readingTimer=null,readingStartTime=0,currentSessionSeconds=0;
let recStartIndex=0,currentRecQueries=[],currentRecQueryIndex=0,isFetchingRecs=false,currentRecCategory=null;
let shownRecTitles=new Set(),libraryFilterQuery='',readerDepsLoaded=false,html5QrCode;
let currentTab='library';

function showToast(msg,duration=2500){const t=document.getElementById('toast');t.innerText=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),duration);}

let ptrStartY=0,ptrActive=false;
document.addEventListener('touchstart',e=>{if(window.scrollY===0&&!document.body.classList.contains('modal-open')){ptrStartY=e.touches[0].clientY;ptrActive=true;}},{passive:true});
document.addEventListener('touchmove',e=>{if(!ptrActive)return;const dy=e.touches[0].clientY-ptrStartY;if(dy>80)document.getElementById('ptrIndicator').classList.add('visible');},{passive:true});
document.addEventListener('touchend',()=>{if(!ptrActive)return;ptrActive=false;const ind=document.getElementById('ptrIndicator');if(ind.classList.contains('visible')){ind.classList.remove('visible');if(currentTab==='discover'){currentRecCategory=null;loadRealRecommendations('auto','rec_auto');showToast('🔄 Оновлено');}else if(currentTab==='library'){render();showToast('🔄 Оновлено');}else if(currentTab==='profile'){calculateStats();updateStreakWidget();updateGoalWidget();showToast('🔄 Оновлено');}}});

function checkWelcome(){if(!localStorage.getItem('welcomed')&&myLibrary.length===0)document.getElementById('welcomeScreen').classList.remove('hidden');else document.getElementById('welcomeScreen').classList.add('hidden');}
function dismissWelcome(){localStorage.setItem('welcomed','1');document.getElementById('welcomeScreen').classList.add('hidden');}
function showCelebration(){const el=document.getElementById('celebration');el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),1500);if(navigator.vibrate)navigator.vibrate([100,50,100,50,200]);}

document.addEventListener('DOMContentLoaded',()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(e=>console.log(e));
    document.querySelectorAll('.bottom-sheet').forEach(sheet=>{
        let startY=0,currentY=0,isDragging=false;
        sheet.addEventListener('touchstart',e=>{const sc=sheet.querySelector('.overflow-y-auto');if(!sc||sc.scrollTop<=0||e.target.closest('.drag-handle')){startY=e.touches[0].clientY;isDragging=true;sheet.style.transition='none';}},{passive:true});
        sheet.addEventListener('touchmove',e=>{if(!isDragging)return;currentY=e.touches[0].clientY;const d=currentY-startY;if(d>0)sheet.style.transform=`translateY(${d}px)`;},{passive:true});
        sheet.addEventListener('touchend',()=>{if(!isDragging)return;isDragging=false;sheet.style.transition='transform .35s cubic-bezier(.32,.72,0,1)';if(currentY-startY>100){if(sheet.id==='detailsSheet')closeDetailsSheet();else closeAllSheets();}sheet.style.transform='';});
    });
    const ro=new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&currentTab==='discover'&&!isFetchingRecs&&currentRecQueries.length>0)fetchMoreRecommendations();},{rootMargin:'300px'});
    const st=document.getElementById('recScrollTarget');if(st)ro.observe(st);
});

if(localStorage.getItem('appTheme')==='dark')document.body.classList.add('dark');
function toggleAppTheme(){document.body.classList.toggle('dark');localStorage.setItem('appTheme',document.body.classList.contains('dark')?'dark':'light');showToast(document.body.classList.contains('dark')?'🌙 Темна тема':'☀️ Світла тема');}

function switchTab(tab){
    currentTab=tab;document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(b=>{b.classList.remove('active');b.classList.add('opacity-50');});
    const tabs={library:'tabLibrary',discover:'tabDiscover',profile:'tabProfile'};
    const el=document.getElementById(tabs[tab]);el.classList.add('active');el.classList.remove('fade-in');void el.offsetWidth;el.classList.add('fade-in');
    const btns=document.querySelectorAll('.nav-tab');const idx={library:0,discover:1,profile:2}[tab];
    btns[idx].classList.add('active');btns[idx].classList.remove('opacity-50');
    if(tab==='profile'){calculateStats();updateStreakWidget();updateGoalWidget();}
    if(tab==='discover'&&!currentRecCategory)loadRealRecommendations('auto','rec_auto');
    window.scrollTo({top:0,behavior:'smooth'});
}

function setViewMode(m){viewMode=m;localStorage.setItem('viewMode',m);updateViewButtons();render();}
function updateViewButtons(){const a='px-2.5 py-1 rounded-md text-[10px] font-bold uppercase bg-white shadow-sm text-slate-800',i='px-2.5 py-1 rounded-md text-[10px] font-bold uppercase text-slate-400';document.getElementById('view_list').className=viewMode==='list'?a:i;document.getElementById('view_grid').className=viewMode==='grid'?a:i;}

function saveGoal(v){const g=parseInt(v)||12;if(currentUser)db.collection('users').doc(currentUser.uid).set({readingGoal:g},{merge:true});localStorage.setItem('readingGoal',g);updateGoalWidget();showToast('🎯 Ціль збережено');}
function updateGoalWidget(){const g=parseInt(localStorage.getItem('readingGoal'))||12,y=new Date().getFullYear();const f=myLibrary.filter(b=>{if(b.status!=='finished')return false;try{return b.dateFinished&&b.dateFinished.startsWith(String(y));}catch(e){return false;}}).length;const p=Math.min(100,Math.round((f/g)*100));document.getElementById('goalYear').innerText=y;document.getElementById('goalProgress').innerText=`${f}/${g}`;document.getElementById('goalBar').style.width=p+'%';document.getElementById('goalInput').value=g;}

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

function renderQuickResume(){const qr=document.getElementById('quickResume');const lastRead=myLibrary.filter(b=>b.status==='reading'&&b.lastCfi).sort((a,b)=>(b.timeSpent||0)-(a.timeSpent||0))[0];if(!lastRead){qr.classList.add('hidden');return;}const pct=Math.round((lastRead.pagesRead/lastRead.pagesTotal)*100)||0;qr.classList.remove('hidden');qr.innerHTML=`<div class="card-elevated p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform" onclick="readSavedEpub('${lastRead.id}')"><img src="${lastRead.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-10 h-14 rounded-lg object-cover shadow-sm"><div class="flex-1 min-w-0"><p class="text-[10px] font-bold text-primary-600 uppercase">▶ Продовжити</p><p class="font-bold text-sm truncate">${lastRead.title}</p><div class="flex items-center gap-2 mt-1"><div class="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden"><div class="bg-primary-500 h-full rounded-full" style="width:${pct}%"></div></div><span class="text-[10px] font-bold text-muted">${pct}%</span></div></div></div>`;}

async function calculateStats(){await loadChartJS();const fin=myLibrary.filter(b=>b.status==='finished');const tp=fin.reduce((s,b)=>s+(parseInt(b.pagesTotal)||0),0);const tt=myLibrary.reduce((s,b)=>s+(b.timeSpent||0),0);document.getElementById('statBooks').innerText=fin.length;document.getElementById('statPages').innerText=tp>999?(tp/1000).toFixed(1)+'k':tp;document.getElementById('statTime').innerText=Math.round(tt/3600);const ctx=document.getElementById('statsChart');if(!ctx)return;const months={};fin.forEach(b=>{if(b.dateFinished&&typeof b.dateFinished==='string'&&b.dateFinished.length>=7){const m=b.dateFinished.substring(0,7);months[m]=(months[m]||0)+1;}});const labels=Object.keys(months).sort().slice(-8);const data=labels.map(l=>months[l]);if(window.myChart)window.myChart.destroy();window.myChart=new Chart(ctx,{type:'bar',data:{labels:labels.map(l=>l.slice(5)),datasets:[{data,backgroundColor:'#6366f1',borderRadius:8,barThickness:20}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1},grid:{color:'rgba(0,0,0,.04)'}},x:{grid:{display:false}}}}});}

function exportLibrary(){if(myLibrary.length===0)return showToast('📭 Порожньо');const d="data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(myLibrary,null,2));const a=document.createElement('a');a.href=d;a.download=`chitayko_${new Date().toISOString().slice(0,10)}.json`;a.click();showToast('📥 Експортовано!');}
function importLibrary(){const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const t=await f.text(),books=JSON.parse(t);if(!Array.isArray(books))throw new Error('Bad');if(!confirm(`Імпортувати ${books.length} книг?`))return;const ex=new Set(myLibrary.map(b=>(b.title||'').toLowerCase().trim()));let imp=0;const batch=db.batch();books.forEach(book=>{const ti=(book.title||'').toLowerCase().trim();if(ex.has(ti))return;const ref=db.collection('users').doc(currentUser.uid).collection('books').doc();const c={...book};delete c.id;if(!c.dateAdded)c.dateAdded=Date.now();batch.set(ref,c);imp++;});await batch.commit();showToast(`✅ ${imp} книг!`);}catch(err){showToast('❌ '+err.message);}};inp.click();}
function clearAppCache(){if('caches' in window)caches.keys().then(n=>{for(let x of n)caches.delete(x);});if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(r=>{for(let x of r)x.unregister();});showToast('🔄 Очищено!');setTimeout(()=>window.location.reload(true),800);}

auth.onAuthStateChanged(async user=>{const as=document.getElementById('authScreen'),ap=document.getElementById('appScreen');if(user){currentUser=user;as.classList.add('hidden');as.classList.remove('flex');ap.classList.remove('hidden');document.getElementById('mainBottomNav').classList.remove('hidden');document.getElementById('profileName').innerText=user.displayName||user.email?.split('@')[0]||'Читач';document.getElementById('profileEmail').innerText=user.email||'';updateViewButtons();         // Реєструємо/оновлюємо юзера для адмінки
        db.collection('users').doc(user.uid).set({
            email: user.email || '',
            displayName: user.displayName || '',
            lastLogin: Date.now()
        }, {merge: true});
try{const ud=await db.collection('users').doc(user.uid).get();if(ud.exists&&ud.data().readingGoal)localStorage.setItem('readingGoal',ud.data().readingGoal);}catch(e){}loadLibrary();}else{currentUser=null;myLibrary=[];as.classList.remove('hidden');as.classList.add('flex');ap.classList.add('hidden');document.getElementById('mainBottomNav').classList.add('hidden');}});
function showErrorMsg(m){const e=document.getElementById('authError');e.innerText=m;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),6000);}
async function handleAuth(type,btn){const ot=btn.innerText;btn.innerText="...";const em=document.getElementById('authEmail').value,pw=document.getElementById('authPassword').value;if(em.length<5||pw.length<6){btn.innerText=ot;return showErrorMsg("Email + пароль (6+)");}try{if(type==='login')await auth.signInWithEmailAndPassword(em,pw);else await auth.createUserWithEmailAndPassword(em,pw);}catch(er){showErrorMsg(er.message);}finally{btn.innerText=ot;}}
async function signInWithGoogle(btn){
    var oh=btn.innerHTML;btn.innerText="...";
    var p=new firebase.auth.GoogleAuthProvider();
    try{
        await auth.signInWithPopup(p);
    }catch(er){
        if(er.code==='auth/popup-blocked'||er.code==='auth/popup-closed-by-user'||er.code==='auth/cancelled-popup-request'){
            // Fallback на redirect
            await auth.signInWithRedirect(p);
        }else{
            showErrorMsg(er.message);
            btn.innerHTML=oh;
        }
    }
}

function loadLibrary(){localforage.getItem('library_cache_'+currentUser.uid).then(c=>{if(c&&myLibrary.length===0){myLibrary=c;render();updateGoalWidget();renderQuickResume();checkWelcome();}});db.collection('users').doc(currentUser.uid).collection('books').orderBy('dateAdded','desc').onSnapshot(snap=>{myLibrary=snap.docs.map(d=>({id:d.id,...d.data()}));localforage.setItem('library_cache_'+currentUser.uid,myLibrary);render();updateGoalWidget();renderQuickResume();checkWelcome();});}
async function updateBookInFirestore(id,u){if(currentUser)await db.collection('users').doc(currentUser.uid).collection('books').doc(id).update(u);}
function filterLibrary(q){libraryFilterQuery=q.toLowerCase().trim();render();}

function openSheet(id){document.body.classList.add('modal-open');document.querySelectorAll('.bottom-sheet').forEach(s=>s.classList.remove('open'));document.getElementById(id).classList.add('open');document.querySelector('.backdrop').classList.remove('hidden');}
function closeAllSheets(){document.body.classList.remove('modal-open');document.querySelectorAll('.bottom-sheet').forEach(s=>s.classList.remove('open'));document.querySelector('.backdrop').classList.add('hidden');toggleEditMode(false);}
function closeDetailsSheet(){if(!document.getElementById('statusButtons').classList.contains('hidden'))openSheet('searchSheet');else closeAllSheets();}

async function openScanner(){await loadScannerLib();document.getElementById('scannerSheet').classList.remove('hidden');html5QrCode=new Html5Qrcode("reader");html5QrCode.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:150},aspectRatio:1.0},(t)=>{if(navigator.vibrate)navigator.vibrate(100);closeScanner();const si=document.getElementById('searchInput');si.value=t;si.dispatchEvent(new Event('input'));},()=>{}).catch(er=>{showToast("❌ Камера: "+er);closeScanner();});}
function closeScanner(){if(html5QrCode){html5QrCode.stop().then(()=>{html5QrCode.clear();html5QrCode=null;}).catch(e=>console.log(e));}document.getElementById('scannerSheet').classList.add('hidden');}

const searchInput=document.getElementById('searchInput'),searchItems=document.getElementById('searchItems');
function isEnglishTitle(t){if(!t)return true;const l=t.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);if(!l)return false;const e=t.match(/[a-zA-Z]/g);return(e&&e.length>(l.length*0.4));}
function isCyrillic(s){return/[а-яА-ЯіІїЇєЄґҐ]/.test(s);}
function renderSkeleton(){return'<div class="space-y-3 px-1">'+'<div class="flex gap-3 items-center p-2"><div class="skeleton w-11 h-[60px] rounded-lg"></div><div class="flex-1 space-y-2"><div class="skeleton h-4 w-3/4 rounded"></div><div class="skeleton h-3 w-1/2 rounded"></div></div></div>'.repeat(5)+'</div>';}

searchInput.addEventListener('input',e=>{
    clearTimeout(timeoutId);const query=e.target.value.trim();
    if(query.length<2){searchItems.innerHTML='';return;}
    searchItems.innerHTML=renderSkeleton();
    timeoutId=setTimeout(async()=>{
        try{
            let allItems=[];const isAuth=query.startsWith('author:"')&&query.endsWith('"');const raw=isAuth?query.slice(8,-1):query;const sq=encodeURIComponent(raw);const sqq=encodeURIComponent('"'+raw+'"');let pr=[];const isIsbn=/^[0-9-]{10,17}$/.test(raw);
            if(isIsbn){const ci=raw.replace(/[^0-9]/g,'');pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${ci}&key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME`).catch(()=>({ok:false})));pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=${ci}&key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME`).catch(()=>({ok:false})));pr.push(fetch(`https://itunes.apple.com/search?term=${ci}&entity=ebook&country=ua&limit=5`).catch(()=>({ok:false})));}
            else if(isAuth){pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=inauthor:"${sq}"&printType=books&maxResults=40`).catch(()=>({ok:false})));pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${sqq}&printType=books&maxResults=40`).catch(()=>({ok:false})));pr.push(fetch(`https://itunes.apple.com/search?term=${sq}&entity=ebook&attribute=authorTerm&country=ua&limit=30`).catch(()=>({ok:false})));}
            else{pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=intitle:${sqq}&printType=books&maxResults=20`).catch(()=>({ok:false})));pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${sq}&printType=books&maxResults=20`).catch(()=>({ok:false})));pr.push(fetch(`https://itunes.apple.com/search?term=${sq}&entity=ebook&country=ua&limit=25`).catch(()=>({ok:false})));}
            const res=await Promise.all(pr);
            for(let i=0;i<res.length-1;i++){if(res[i]&&res[i].ok){const d=await res[i].json();if(d.items)allItems.push(...d.items);}}
            const ar=res[res.length-1];if(ar&&ar.ok){const da=await ar.json();if(da.results)da.results.forEach(bk=>{allItems.push({id:'apple_'+bk.trackId,volumeInfo:{title:bk.trackName,authors:[bk.artistName||'Невідомий'],pageCount:300,description:bk.description?bk.description.replace(/(<([^>]+)>)/gi,""):'',publishedDate:bk.releaseDate?bk.releaseDate.substring(0,4):'',imageLinks:{thumbnail:bk.artworkUrl100?bk.artworkUrl100.replace('100x100bb','400x400bb'):null},categories:bk.genres||[]}});});}
            if(allItems.length===0)return searchItems.innerHTML='<div class="p-8 text-muted text-sm text-center">🔍 Не знайдено</div>';
            const ui=[];const sk=new Set();allItems.forEach(it=>{const b=it.volumeInfo;if(!b||!b.title)return;const k=(b.title.toLowerCase()+(b.authors?b.authors[0].toLowerCase():'')).replace(/[^a-zа-я0-9ієї]/gi,'');if(!sk.has(k)){sk.add(k);ui.push(it);}});
            const bc=['Science','Technology','Computers','Medical','Law','Business & Economics','Mathematics','Education','Study Aids','Religion'];
            let fi=ui.filter(it=>{const b=it.volumeInfo;if(!b||!b.title)return false;if(isAuth)return(b.authors||[]).join(' ').toLowerCase().includes(raw.toLowerCase());const ex=b.title.toLowerCase().includes(raw.toLowerCase());if(!isIsbn&&!ex&&b.categories&&b.categories.some(c=>bc.includes(c)))return false;return true;});
            if(isAuth)fi.sort((a,b)=>(a.volumeInfo.publishedDate||'9999').localeCompare(b.volumeInfo.publishedDate||'9999'));
            else fi.sort((a,b)=>{const tA=(a.volumeInfo.title||'').toLowerCase(),tB=(b.volumeInfo.title||'').toLowerCase(),ql=raw.toLowerCase();if(tA===ql&&tB!==ql)return-1;if(tA!==ql&&tB===ql)return 1;if(tA.startsWith(ql)&&!tB.startsWith(ql))return-1;return 0;});
            fi=fi.slice(0,30);if(fi.length===0)return searchItems.innerHTML='<div class="p-8 text-muted text-sm text-center">Не знайдено</div>';
            searchItems.innerHTML='';
            fi.forEach(it=>{const b=it.volumeInfo,div=document.createElement('div');const si=(b.imageLinks?.thumbnail||PLACEHOLDER_IMG).replace(/^http:\/\//i,'https://');const bk={googleId:it.id||Math.random().toString(),title:b.title||'Без назви',author:b.authors?b.authors[0]:'Невідомий',pagesTotal:b.pageCount||300,image:si,description:b.description||'',genre:(b.categories&&b.categories[0])||'',publishedDate:b.publishedDate||''};div.className="p-3 hover:bg-slate-50 rounded-2xl cursor-pointer flex items-center gap-3 active:scale-[0.98] transition-transform fade-in";div.innerHTML=`<img loading="lazy" src="${bk.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-11 h-[60px] object-cover rounded-lg shadow-sm"><div class="flex-1 min-w-0"><div class="font-bold text-sm truncate">${bk.title}</div><div class="text-xs text-muted truncate">${bk.author}</div></div>`;div.onclick=()=>showBookDetails(bk,true);searchItems.appendChild(div);});
        }catch(e){searchItems.innerHTML='<div class="p-8 text-red-500 text-sm text-center">Помилка з\'єднання</div>';}
    },600);
});

window.searchAuthorBooks=function(a){closeAllSheets();setTimeout(()=>{const i=document.getElementById('searchInput');i.value=`author:"${a}"`;openSheet('searchSheet');i.dispatchEvent(new Event('input'));},350);}
function openManualForm(){tempSelectedBook='manual';toggleEditMode(true);document.getElementById('editTitle').value='';document.getElementById('editAuthor').value='';document.getElementById('editPages').value='';document.getElementById('editImage').value='';document.getElementById('statusButtons').classList.remove('hidden');openSheet('detailsSheet');}
// ===== DETAILS =====
function showBookDetails(bookData,isNew=false){
    if(!bookData||!bookData.title)return;
    const lb=myLibrary.find(b=>(b.googleId&&b.googleId===bookData.googleId)||b.id===bookData.id)||bookData;
    tempSelectedBook=isNew?bookData:null;toggleEditMode(false);
    const sa=(lb.author||'Невідомий').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    let h=`<div class="flex gap-4 mb-5 fade-in"><img loading="lazy" src="${lb.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-24 h-36 object-cover rounded-2xl shadow-lg flex-shrink-0"><div class="flex flex-col justify-center min-w-0 flex-1"><h3 class="text-lg font-bold leading-tight mb-1.5">${lb.title||'Без назви'}</h3><button onclick="window.searchAuthorBooks('${sa}')" class="text-left w-fit px-2 py-0.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-semibold mb-2 active:scale-95">👤 ${sa}</button><span class="text-xs text-muted">📄 ${lb.pagesTotal||300} стор.</span>${!isNew?`<select onchange="changeStatusFromDetails('${lb.id}',this.value)" class="mt-2 bg-slate-50 border border-slate-200 text-xs rounded-lg p-1.5 outline-none cursor-pointer"><option value="planned" ${lb.status==='planned'?'selected':''}>⏳ В планах</option><option value="reading" ${lb.status==='reading'?'selected':''}>📖 Читаю</option><option value="finished" ${lb.status==='finished'?'selected':''}>✅ Прочитано</option></select>`:''}</div></div>`;
    if(!isNew){
        if(lb.status==='reading')h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-muted mb-2">📊 Прогрес: <span id="sliderVal">${lb.pagesRead||0}</span> / ${lb.pagesTotal||300}</p><input type="range" min="0" max="${lb.pagesTotal||300}" value="${lb.pagesRead||0}" class="progress-slider" oninput="document.getElementById('sliderVal').innerText=this.value" onchange="updateProgress('${lb.id}',this.value)"></div>`;
        h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-muted mb-2">📖 Читалка</p><div class="flex gap-2"><button onclick="readSavedEpub('${lb.id}')" class="flex-1 py-2.5 bg-primary-600 text-white rounded-xl font-bold text-xs active:scale-95 shadow-md shadow-primary-200">▶ Читати</button><div class="relative flex-1"><input type="file" id="epubFileModal_${lb.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${lb.id}')"><button onclick="document.getElementById('epubFileModal_${lb.id}').click()" class="w-full py-2.5 bg-slate-100 rounded-xl font-bold text-xs active:scale-95">📥 .epub</button></div></div></div>`;
        h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-muted mb-2">🗓 Дати</p><div class="space-y-2"><div class="flex justify-between items-center"><span class="text-xs">Початок</span><input type="date" value="${lb.dateStarted||''}" onchange="saveManualDate('${lb.id}','dateStarted',this)" class="date-input text-xs"></div><div class="flex justify-between items-center"><span class="text-xs">Кінець</span><input type="date" value="${lb.dateFinished||''}" onchange="saveManualDate('${lb.id}','dateFinished',this)" class="date-input text-xs"></div></div></div>`;
        const hl=lb.highlights||[];if(hl.length>0)h+=`<div class="mb-5 p-4 card-elevated"><p class="text-[10px] font-bold uppercase text-amber-600 mb-2">✍️ Виділення (${hl.length})</p><div class="space-y-1.5 max-h-32 overflow-y-auto">${hl.map((x,i)=>`<div class="text-xs bg-amber-50 p-2.5 rounded-lg italic relative border border-amber-100">"${x.text.substring(0,150)}"<button onclick="deleteHighlight('${lb.id}',${i})" class="absolute top-1 right-1.5 text-red-400 text-[10px]">✕</button></div>`).join('')}</div></div>`;
        let stars='';const cr=lb.rating||0;for(let i=1;i<=5;i++)stars+=`<span onclick="setRating('${lb.id}',${i})" class="text-3xl cursor-pointer ${cr>=i?'text-amber-400':'text-slate-200'} active:scale-90 transition-transform">★</span>`;
        h+=`<div class="mb-5 text-center card-elevated p-4"><p class="text-[10px] font-bold uppercase text-muted mb-2">Оцінка</p><div class="flex justify-center gap-2">${stars}</div></div>`;
        h+=`<div class="mb-5 p-4 card-elevated"><div class="flex justify-between items-center mb-2"><p class="text-[10px] font-bold uppercase text-muted">Нотатки</p><button onclick="saveReview('${lb.id}')" class="text-primary-600 bg-primary-50 px-3 py-1 rounded-lg text-[10px] font-bold active:scale-95">💾</button></div><textarea id="reviewText_${lb.id}" class="w-full bg-transparent text-sm outline-none resize-none min-h-[60px]" placeholder="Враження...">${lb.review||''}</textarea></div>`;
    }
    h+=`<div class="desc-scroll mb-4"><p class="text-[10px] font-bold uppercase text-muted mb-1">Анотація</p><p class="text-sm text-muted leading-relaxed">${lb.description||'Немає.'}</p></div>`;
    if(!isNew)h+=`<button onclick="deleteBookFromDetails('${lb.id}')" class="w-full py-3 text-red-500 bg-red-50 rounded-xl font-bold text-sm active:scale-95 mb-4">🗑️ Видалити</button>`;
    document.getElementById('detailsContent').innerHTML=h;
    if(isNew)document.getElementById('statusButtons').classList.remove('hidden');else document.getElementById('statusButtons').classList.add('hidden');
    openSheet('detailsSheet');
}

function updateProgress(id,val){updateBookInFirestore(id,{pagesRead:parseInt(val)});const b=myLibrary.find(x=>x.id===id);if(b)b.pagesRead=parseInt(val);}
function deleteHighlight(id,i){const b=myLibrary.find(x=>x.id===id);if(!b||!b.highlights)return;b.highlights.splice(i,1);updateBookInFirestore(id,{highlights:b.highlights});showBookDetails(b);showToast('✍️ Видалено');}
function deleteBookFromDetails(id){if(confirm("Видалити цю книгу?")){db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete();closeAllSheets();showToast('🗑️ Видалено');}}
function setRating(id,r){updateBookInFirestore(id,{rating:r});setTimeout(()=>showBookDetails(myLibrary.find(b=>b.id===id)),100);}
function changeStatusFromDetails(id,ns){const u={status:ns};const b=myLibrary.find(x=>x.id===id);if(ns==='finished'){u.pagesRead=b.pagesTotal;u.dateFinished=b.dateFinished||new Date().toISOString().slice(0,10);showCelebration();}else if(ns==='reading'){u.dateStarted=b.dateStarted||new Date().toISOString().slice(0,10);}updateBookInFirestore(id,u);closeAllSheets();setLibraryTab(ns);}
function toggleEditMode(v){if(v){document.getElementById('detailsContent').classList.add('hidden');document.getElementById('editContent').classList.remove('hidden');}else{document.getElementById('detailsContent').classList.remove('hidden');document.getElementById('editContent').classList.add('hidden');}}
function saveBookEdits(){const u={title:document.getElementById('editTitle').value.trim()||'Без назви',author:document.getElementById('editAuthor').value.trim()||'Невідомий',pagesTotal:parseInt(document.getElementById('editPages').value)||300,image:document.getElementById('editImage').value.trim()};if(tempSelectedBook==='manual'){tempSelectedBook={...u,description:'Вручну.'};toggleEditMode(false);showBookDetails(tempSelectedBook,true);}else{updateBookInFirestore(tempSelectedBook.id,u);showBookDetails({...tempSelectedBook,...u});}}
function saveReview(id){updateBookInFirestore(id,{review:document.getElementById(`reviewText_${id}`).value});showToast('💾 Збережено');}
async function addBookWithStatus(s){if(!currentUser)return;if(tempSelectedBook==='manual')saveBookEdits();let nd={...tempSelectedBook,status:s,pagesRead:s==='finished'?tempSelectedBook.pagesTotal:0,dateAdded:Date.now(),rating:0,review:'',highlights:[],timeSpent:0,lastFileName:null,dateStarted:s==='reading'?new Date().toISOString().slice(0,10):null,dateFinished:s==='finished'?new Date().toISOString().slice(0,10):null,sortOrder:0};await db.collection('users').doc(currentUser.uid).collection('books').add(nd);tempSelectedBook=null;closeAllSheets();if(s==='finished')showCelebration();showToast('📚 Додано!');}
function changeStatus(id,ns,ev){ev.stopPropagation();const u={status:ns};const b=myLibrary.find(x=>x.id===id);if(ns==='reading'&&!b.dateStarted)u.dateStarted=new Date().toISOString().slice(0,10);if(ns==='finished'){u.pagesRead=b.pagesTotal;u.dateFinished=new Date().toISOString().slice(0,10);showCelebration();}updateBookInFirestore(id,u);setLibraryTab(ns);showToast(ns==='finished'?'🎉 Вітаємо!':'📖 Статус змінено');}
function saveManualDate(id,f,el){updateBookInFirestore(id,{[f]:el.value});const b=myLibrary.find(x=>x.id===id);if(b)b[f]=el.value;}

// ===== SWIPE DELETE =====
function initSwipeDelete(el,bookId){
    let startX=0,dx=0,swiping=false;
    el.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;dx=0;swiping=true;},{passive:true});
    el.addEventListener('touchmove',e=>{if(!swiping)return;dx=startX-e.touches[0].clientX;if(dx>20){el.style.transform=`translateX(${-Math.min(dx,80)}px)`;el.classList.add('swiping');}else{el.style.transform='';el.classList.remove('swiping');}},{passive:true});
    el.addEventListener('touchend',()=>{swiping=false;if(dx>70){if(confirm('Видалити цю книгу?')){db.collection('users').doc(currentUser.uid).collection('books').doc(bookId).delete();showToast('🗑️ Видалено');}else{el.style.transition='transform .3s';el.style.transform='';el.classList.remove('swiping');setTimeout(()=>el.style.transition='',300);}}else{el.style.transition='transform .3s';el.style.transform='';el.classList.remove('swiping');setTimeout(()=>el.style.transition='',300);}});
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
function handleFileSelectAndSave(ev,bookId){const file=ev.target.files[0];if(!file)return;if(!file.name.toLowerCase().endsWith('.epub')){showToast("❌ Тільки .epub");ev.target.value='';return;}const bd=myLibrary.find(b=>b.id===bookId);if(bd&&bd.lastFileName&&bd.lastFileName!==file.name&&!confirm('Інший файл. Продовжити?')){ev.target.value='';return;}if(bd&&bd.lastFileName!==file.name)updateBookInFirestore(bookId,{lastFileName:file.name});const r=new FileReader();r.onload=async function(e){const ab=e.target.result;try{await localforage.setItem(`epub_${bookId}`,ab);}catch(er){}await openEpubReader(bookId,ab);closeAllSheets();};r.readAsArrayBuffer(file);ev.target.value='';}
async function readSavedEpub(bookId){try{const ab=await localforage.getItem(`epub_${bookId}`);if(!ab){showToast("📥 Спочатку завантажте .epub");return;}await openEpubReader(bookId,ab);closeAllSheets();}catch(e){showToast("❌ Помилка");}}
function readSavedEpubFromCard(id,ev){ev.stopPropagation();readSavedEpub(id);}
async function openEpubReader(bookId,source){
    if(!readerDepsLoaded){await loadReaderDeps();readerDepsLoaded=true;}
    const bd=myLibrary.find(b=>b.id===bookId);if(!bd)return;
    currentReaderBookId=bookId;document.getElementById('readerOverlay').style.display='flex';document.getElementById('readerTitle').innerText=bd.title;document.getElementById('readerProgress').innerText="...";startTimer();document.getElementById('viewer').innerHTML='';
    try{
        currentBookInstance=ePub(source);rendition=currentBookInstance.renderTo("viewer",{width:"100%",height:"100%",spread:"none",manager:"continuous",flow:"paginated"});
        rendition.themes.register("light",{"body":{"background":"#fafafa","color":"#18181b"}});rendition.themes.register("sepia",{"body":{"background":"#f4ecd8","color":"#5b4636"}});rendition.themes.register("dark",{"body":{"background":"#09090b","color":"#d4d4d8"}});applyReaderSettings();
        rendition.on("selected",function(cfi,contents){rendition.annotations.highlight(cfi);currentBookInstance.getRange(cfi).then(function(range){if(!range)return;const text=range.toString().trim();if(text.length<3)return;const bk=myLibrary.find(b=>b.id===currentReaderBookId);if(bk){const hl=bk.highlights||[];hl.push({text,cfi,date:Date.now()});bk.highlights=hl;updateBookInFirestore(currentReaderBookId,{highlights:hl});}if(navigator.vibrate)navigator.vibrate([50,50,50]);showToast('✍️ Виділено');});contents.window.getSelection().removeAllRanges();});
        rendition.on("relocated",loc=>{if(!loc||!loc.start)return;const p=Math.round((loc.start.percentage||0)*100);document.getElementById('readerProgress').innerText=p>0?p+"%":"...";clearTimeout(window.syncProgressTimeout);window.syncProgressTimeout=setTimeout(()=>{const u={lastCfi:loc.start.cfi};if(p>0)u.pagesRead=Math.round((p/100)*(bd.pagesTotal||300));updateBookInFirestore(currentReaderBookId,u);},3000);});
        const safeCfi=(bd.lastCfi&&typeof bd.lastCfi==='string'&&bd.lastCfi.startsWith('epubcfi'))?bd.lastCfi:undefined;
        await rendition.display(safeCfi).catch(()=>rendition.display());
        currentBookInstance.ready.then(()=>currentBookInstance.locations.generate(1600)).then(()=>{const l=rendition.currentLocation();if(l&&l.start)document.getElementById('readerProgress').innerText=Math.round(l.start.percentage*100)+"%";}).catch(()=>{});
        initSwipeGestures();
    }catch(er){console.error(er);document.getElementById('readerProgress').innerText="Помилка";stopTimer();}
}
function closeReader(){stopTimer();document.getElementById('readerOverlay').style.display='none';document.getElementById('readerSettingsMenu').classList.add('hidden');if(currentBookInstance){currentBookInstance.destroy();currentBookInstance=null;rendition=null;}document.getElementById('viewer').innerHTML='';currentReaderBookId=null;updateStreakWidget();renderQuickResume();}

// ===== RENDER =====
function deleteBook(id,ev){ev.stopPropagation();if(confirm("Видалити цю книгу?")){db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete();showToast('🗑️ Видалено');}}
function formatTime(s){if(!s)return"0хв";const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}г ${m}хв`:`${m}хв`;}
function setLibraryTab(t){currentLibraryTab=t;document.querySelectorAll('#libraryTabs .pill').forEach(b=>{b.className='pill inactive';});document.getElementById('tab_'+t).className='pill active';render();}

function renderBookCard(book){
    const pct=Math.round((book.pagesRead/book.pagesTotal)*100)||0,isFin=book.status==='finished',isPlan=book.status==='planned',isRead=book.status==='reading';
    const bj=JSON.stringify(book).replace(/"/g,'&quot;');
    if(viewMode==='grid')return`<div data-id="${book.id}" onclick="showBookDetails(${bj})" class="flex flex-col items-center cursor-pointer active:scale-[0.97] transition-transform"><div class="relative w-full aspect-[2/3]"><img loading="lazy" src="${book.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-full h-full rounded-2xl shadow-md object-cover">${isFin&&book.rating?`<div class="absolute -bottom-1.5 -right-1.5 bg-white text-amber-400 text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-sm">★${book.rating}</div>`:''}${isRead&&pct>0?`<div class="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20 rounded-b-2xl overflow-hidden"><div class="h-full bg-primary-400 rounded-b-2xl" style="width:${pct}%"></div></div>`:''}</div><h3 class="font-semibold text-[11px] mt-2 w-full text-center truncate px-1">${book.title}</h3><p class="text-[9px] text-muted truncate w-full text-center">${book.author}</p></div>`;
    return`<div data-id="${book.id}" onclick="showBookDetails(${bj})" class="card p-3.5 flex gap-3 items-start cursor-pointer swipe-card"><div class="swipe-bg">🗑️</div><img loading="lazy" src="${book.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-14 h-20 rounded-xl shadow-sm object-cover flex-shrink-0"><div class="flex-1 min-w-0"><div class="flex justify-between items-start"><div class="min-w-0 flex-1"><h3 class="font-bold text-sm leading-snug truncate">${book.title}</h3><p class="text-xs text-muted mt-0.5 truncate">${book.author}</p></div></div>${isPlan?`<button onclick="changeStatus('${book.id}','reading',event)" class="w-full mt-3 py-2 bg-primary-50 text-primary-700 font-bold text-xs rounded-lg active:scale-95 transition-transform">🚀 Почати читати</button>`:`<div class="mt-2.5 flex items-center gap-2"><div class="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden"><div class="progress-bar bg-primary-500 h-full rounded-full" style="width:${pct}%"></div></div><span class="text-[10px] font-bold text-primary-600 min-w-[30px] text-right">${pct}%</span></div>${isRead?`<div class="flex gap-1.5 mt-2.5"><button onclick="readSavedEpubFromCard('${book.id}',event)" class="flex-1 py-2 bg-primary-600 text-white rounded-lg text-[11px] font-bold active:scale-95 shadow-sm">▶ Читати</button><button onclick="changeStatus('${book.id}','finished',event)" class="py-2 px-3 bg-emerald-50 text-emerald-600 rounded-lg text-[11px] font-bold active:scale-95">✅</button></div><div class="text-[10px] text-muted mt-1">⏱ ${formatTime(book.timeSpent)}</div>`:''}`}${isFin&&book.rating?`<div class="mt-2 text-amber-400 text-xs">${'★'.repeat(book.rating)}${'☆'.repeat(5-book.rating)}</div>`:''}</div></div>`;
}

function render(){
    const q=libraryFilterQuery;
    let reading=myLibrary.filter(b=>b.status==='reading'),planned=myLibrary.filter(b=>b.status==='planned'),finished=myLibrary.filter(b=>b.status==='finished');
    if(q){const fn=b=>b.title?.toLowerCase().includes(q)||b.author?.toLowerCase().includes(q);reading=reading.filter(fn);planned=planned.filter(fn);finished=finished.filter(fn);}
    document.getElementById('tab_reading').innerHTML=`📖 Читаю <span class="ml-1 text-[10px] opacity-60">${reading.length}</span>`;
    document.getElementById('tab_planned').innerHTML=`🕒 В планах <span class="ml-1 text-[10px] opacity-60">${planned.length}</span>`;
    document.getElementById('tab_finished').innerHTML=`✅ Прочитано <span class="ml-1 text-[10px] opacity-60">${finished.length}</span>`;
    const c=document.getElementById('myBooksContainer');let list=[];
    if(currentLibraryTab==='reading')list=reading;else if(currentLibraryTab==='planned')list=planned;else list=finished;
    if(list.length===0){const tips={reading:'Натисніть <b>+</b> щоб знайти книгу',planned:'Зберігайте книги на потім',finished:'Завершені книги з\'являться тут'};c.innerHTML=`<div class="mt-12 text-center px-8"><span class="text-5xl block mb-3">📚</span><p class="font-bold text-base mb-1">${q?'Не знайдено':'Поки порожньо'}</p><p class="text-muted text-sm">${q?'Спробуйте інший запит':tips[currentLibraryTab]}</p></div>`;return;}
    const wc=viewMode==='grid'?'grid grid-cols-3 gap-3 sortable-list':'space-y-2.5 sortable-list';
    if(currentLibraryTab==='finished'){
                finished.sort((a,b)=>(b.dateFinished||'1970').localeCompare(a.dateFinished||'1970'));
        const gr={};finished.forEach(b=>{let y='—';try{if(b.dateFinished&&typeof b.dateFinished==='string')y=b.dateFinished.substring(0,4);}catch(e){}if(!gr[y])gr[y]=[];gr[y].push(b);});
        let html='';Object.keys(gr).sort((a,b)=>{if(a==='—')return 1;if(b==='—')return-1;return b-a;}).forEach(y=>{html+=`<p class="font-black text-slate-300 text-sm mt-5 mb-2 tracking-widest">${y}</p><div class="${wc}">${gr[y].map(renderBookCard).join('')}</div>`;});c.innerHTML=html;
    }else{list.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));c.innerHTML=`<div class="${wc}">${list.map(renderBookCard).join('')}</div>`;}
    document.querySelectorAll('.sortable-list').forEach(l=>{new Sortable(l,{delay:300,delayOnTouchOnly:true,animation:150,ghostClass:'sortable-ghost',onEnd:ev=>{[...ev.from.children].forEach((el,i)=>{const id=el.dataset.id;if(id)updateBookInFirestore(id,{sortOrder:i});});}});});
    if(viewMode==='list'){document.querySelectorAll('.swipe-card').forEach(el=>{const id=el.dataset.id;if(id)initSwipeDelete(el,id);});}
}

// ===== RECOMMENDATIONS =====
const curatedCategories={
    'Академія магії':['"академия магии" фэнтези','"магическая академия"','ромфант академия','академия волшебства'],
    'Фентезі':['"фэнтези" бестселлер','эпическое фэнтези','Джон Толкин','Джордж Мартин','Брэндон Сандерсон','Робин Хобб','Ник Перумов','боевое фэнтези'],
    'Детектив':['"детектив" бестселлер','Агата Кристі','Ю Несбё','Стиг Ларссон','Борис Акунин','психологический детектив'],
    'Трилер':['"триллер" бестселлер','Стивен Кинг','Джиллиан Флинн','Дэн Браун','Франк Тилье','психологический триллер'],
    'Романтика':['"любовный роман" бестселлер','Николас Спаркс','Джоджо Мойес','Колин Гувер','современный любовный роман'],
    'Саморозвиток':['"саморазвитие" бестселлер','Роберт Кийосаки','Марк Мэнсон','Джо Диспенза','Джеймс Клир','психология успеха'],
    'Фантастика':['"научная фантастика" бестселлер','Айзек Азимов','Рэй Брэдбери','Энди Вейер','Сергей Лукьяненко','космическая фантастика']
};

async function loadRealRecommendations(cat='auto',btnId='rec_auto'){
    if(currentRecCategory===cat)return;currentRecCategory=cat;recStartIndex=0;currentRecQueryIndex=0;currentRecQueries=[];shownRecTitles.clear();
    const list=document.getElementById('recommendationsList');
    list.innerHTML=renderSkeleton();
    document.querySelectorAll('#recTabs .pill').forEach(b=>{b.className='pill inactive';});
    if(document.getElementById(btnId))document.getElementById(btnId).className='pill active';
    let pool=[];
    if(cat==='auto'){
        let authors=myLibrary.map(b=>b.author).filter(a=>a&&a.length>2&&!a.toLowerCase().includes('невідомий')&&!a.toLowerCase().includes('автор'));
        let authorQueries=[];
        if(authors.length>0){
            let counts={};authors.forEach(a=>counts[a]=(counts[a]||0)+1);
            authorQueries=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,5).map(a=>`inauthor:"${a}"`);
        }
        let gen=Object.values(curatedCategories).flat();
        gen.sort(()=>0.5-Math.random());
        pool=[];
        let ai=0,gi=0;
        while(ai<authorQueries.length||gi<gen.length){
            if(ai<authorQueries.length){pool.push(authorQueries[ai]);ai++;}
            for(let k=0;k<3&&gi<gen.length;k++){pool.push(gen[gi]);gi++;}
        }
    }else{pool=[...curatedCategories[cat]];pool.sort(()=>0.5-Math.random());}
    currentRecQueries=pool;await fetchMoreRecommendations(true);
}

async function fetchMoreRecommendations(isFirst=false){
    if(isFetchingRecs||currentRecQueryIndex>=currentRecQueries.length)return;isFetchingRecs=true;
    const lst=document.getElementById('recommendationsList');
    if(!isFirst&&!document.getElementById('recLoadingMore')){const d=document.createElement('div');d.id='recLoadingMore';d.className='py-6 text-center text-muted animate-pulse text-sm';d.innerHTML='Завантажуємо...';lst.appendChild(d);}
    let finalBooks=[],empty=0;
    while(finalBooks.length<5&&currentRecQueryIndex<currentRecQueries.length&&empty<5){
        const q=currentRecQueries[currentRecQueryIndex];
        const url=`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${encodeURIComponent(q)}&maxResults=40&startIndex=${recStartIndex}`;
        try{
            const res=await fetch(url).then(r=>r.ok?r.json():{items:[]}).catch(()=>({items:[]}));
            let items=res.items||[];
            if(items.length<30){currentRecQueryIndex++;recStartIndex=0;}else{recStartIndex+=40;}
            const badWords=['учебник','словарь','журнал','комикс','манга','підручник','словник','вісник','сборник','збірник','посібник','пособие','том ','випуск','выпуск','зошит','тетрадь','хрестоматия','дневник'];
            const existingTitles=new Set(myLibrary.map(b=>(b.title||'').trim().toLowerCase()));
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
            const u=new Map();valid.forEach(i=>{const b=i.volumeInfo;const key=b.title.toLowerCase()+(b.authors?b.authors[0]:'');u.set(key,i);});
            let ub=Array.from(u.values());
            ub.forEach(i=>{const b=i.volumeInfo;shownRecTitles.add(b.title.toLowerCase()+(b.authors?b.authors[0]:''));finalBooks.push(i);});
            if(ub.length===0)empty++;else empty=0;
        }catch(e){empty++;currentRecQueryIndex++;recStartIndex=0;}
    }
    if(isFirst)lst.innerHTML='';
    if(document.getElementById('recLoadingMore'))document.getElementById('recLoadingMore').remove();
    if(finalBooks.length===0&&isFirst){lst.innerHTML='<div class="p-10 text-center"><span class="text-4xl block mb-2">😔</span><p class="text-muted text-sm">Не знайшли нових книг</p><p class="text-muted text-xs mt-1">Потягніть вниз або оберіть іншу категорію</p></div>';}
    else if(finalBooks.length>0){
        finalBooks.sort(()=>0.5-Math.random());
        let h='';
        finalBooks.forEach(i=>{
            const b=i.volumeInfo;
            const img=(b.imageLinks?.thumbnail||PLACEHOLDER_IMG).replace(/^http:\/\//i,'https://');
            const bk={googleId:i.id||Math.random().toString(),title:b.title,author:b.authors?b.authors[0]:'Невідомий',pagesTotal:b.pageCount||300,image:img,description:b.description||'',genre:(b.categories&&b.categories[0])||''};
            h+=`<div onclick="showBookDetails(${JSON.stringify(bk).replace(/"/g,'&quot;')},true)" class="card p-3.5 flex gap-3 items-start cursor-pointer active:scale-[0.98] transition-transform fade-in">
                <img loading="lazy" src="${bk.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-14 h-20 rounded-xl shadow-sm object-cover flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm leading-tight truncate">${bk.title}</div>
                    <div class="text-xs text-muted mt-0.5">${bk.author}</div>
                    <div class="text-[11px] text-muted mt-1.5 line-clamp-2 leading-snug">${bk.description}</div>
                </div>
            </div>`;
        });
        const tmp=document.createElement('div');tmp.innerHTML=h;while(tmp.firstChild)lst.appendChild(tmp.firstChild);
    }
    isFetchingRecs=false;
}
