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

document.addEventListener('DOMContentLoaded',()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(e=>console.log(e));
    document.querySelectorAll('.bottom-sheet').forEach(sheet=>{
        let startY=0,currentY=0,isDragging=false;
        sheet.addEventListener('touchstart',e=>{const sc=sheet.querySelector('.overflow-y-auto');if(!sc||sc.scrollTop<=0||e.target.closest('.drag-handle')){startY=e.touches[0].clientY;isDragging=true;sheet.style.transition='none';}},{passive:true});
        sheet.addEventListener('touchmove',e=>{if(!isDragging)return;currentY=e.touches[0].clientY;const d=currentY-startY;if(d>0)sheet.style.transform=`translateY(${d}px)`;},{passive:true});
        sheet.addEventListener('touchend',()=>{if(!isDragging)return;isDragging=false;sheet.style.transition='transform 0.35s cubic-bezier(0.32,0.72,0,1)';if(currentY-startY>100){if(sheet.id==='detailsSheet')closeDetailsSheet();else closeAllSheets();}sheet.style.transform='';});
    });
    const ro=new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&!document.getElementById('recommendationsScreen').classList.contains('hidden')&&!isFetchingRecs&&currentRecQueries.length>0)fetchMoreRecommendations();},{rootMargin:'300px'});
    const st=document.getElementById('recScrollTarget');if(st)ro.observe(st);
});

if(localStorage.getItem('appTheme')==='dark')document.body.classList.add('dark');
function toggleAppTheme(){document.body.classList.toggle('dark');localStorage.setItem('appTheme',document.body.classList.contains('dark')?'dark':'light');}
function setViewMode(m){viewMode=m;localStorage.setItem('viewMode',m);updateViewButtons();render();}
function updateViewButtons(){const a='px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-900 bg-white shadow-sm transition-all',i='px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-all';document.getElementById('view_list').className=viewMode==='list'?a:i;document.getElementById('view_grid').className=viewMode==='grid'?a:i;}

function saveGoal(v){const g=parseInt(v)||12;if(currentUser)db.collection('users').doc(currentUser.uid).set({readingGoal:g},{merge:true});localStorage.setItem('readingGoal',g);updateGoalWidget();}
function updateGoalWidget(){const g=parseInt(localStorage.getItem('readingGoal'))||12,y=new Date().getFullYear(),f=myLibrary.filter(b=>{if(b.status!=='finished')return false;try{return b.dateFinished&&b.dateFinished.startsWith(String(y));}catch(e){return false;}}).length,p=Math.min(100,Math.round((f/g)*100));document.getElementById('goalYear').innerText=y;document.getElementById('goalProgress').innerText=`${f}/${g}`;document.getElementById('goalBar').style.width=p+'%';document.getElementById('goalInput').value=g;document.getElementById('goalWidget').classList.remove('hidden');}

async function updateStreakWidget(){
    if(!currentUser)return;const days=[],today=new Date();
    for(let i=13;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);days.push(d.toISOString().slice(0,10));}
    let rd=new Set();
    try{const snap=await db.collection('users').doc(currentUser.uid).collection('readingDays').where(firebase.firestore.FieldPath.documentId(),'>=',days[0]).where(firebase.firestore.FieldPath.documentId(),'<=',days[days.length-1]).get();snap.forEach(doc=>rd.add(doc.id));}catch(e){}
    let streak=0;const ts=today.toISOString().slice(0,10);let cd=new Date(today);
    if(!rd.has(ts))cd.setDate(cd.getDate()-1);
    while(true){const ds=cd.toISOString().slice(0,10);if(rd.has(ds)){streak++;cd.setDate(cd.getDate()-1);}else break;}
    document.getElementById('streakCount').innerText=`${streak} ${streak===1?'день':streak<5?'дні':'днів'}`;
    document.getElementById('streakDots').innerHTML=days.map(d=>`<div class="streak-dot ${rd.has(d)?'active':'inactive'} ${d===ts?'ring-2 ring-indigo-300':''}" title="${d}"></div>`).join('');
    document.getElementById('streakWidget').classList.remove('hidden');
}
async function markReadingDay(){if(!currentUser)return;const t=new Date().toISOString().slice(0,10);try{await db.collection('users').doc(currentUser.uid).collection('readingDays').doc(t).set({minutes:Math.round(currentSessionSeconds/60),timestamp:Date.now()},{merge:true});}catch(e){}}

async function calculateStats(){
    await loadChartJS();const fin=myLibrary.filter(b=>b.status==='finished'),tp=fin.reduce((s,b)=>s+(parseInt(b.pagesTotal)||0),0),tt=myLibrary.reduce((s,b)=>s+(b.timeSpent||0),0);
    document.getElementById('statBooks').innerText=fin.length;document.getElementById('statPages').innerText=tp.toLocaleString();document.getElementById('statTime').innerText=formatTime(tt);
    const ctx=document.getElementById('statsChart');if(!ctx)return;
    const months={};fin.forEach(b=>{if(b.dateFinished&&typeof b.dateFinished==='string'&&b.dateFinished.length>=7){const m=b.dateFinished.substring(0,7);months[m]=(months[m]||0)+1;}});
    const labels=Object.keys(months).sort(),data=labels.map(l=>months[l]);
    if(window.myChart)window.myChart.destroy();
    window.myChart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{label:'Книг',data,backgroundColor:'#4f46e5',borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}}}});
}

function exportLibrary(){if(myLibrary.length===0)return alert('Порожньо!');const d="data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(myLibrary,null,2));const a=document.createElement('a');a.href=d;a.download=`chitayko_${new Date().toISOString().slice(0,10)}.json`;a.click();}
function importLibrary(){const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const t=await f.text(),books=JSON.parse(t);if(!Array.isArray(books))throw new Error('Bad');if(!confirm(`Імпортувати ${books.length} книг?`))return;const ex=new Set(myLibrary.map(b=>(b.title||'').toLowerCase().trim()));let imp=0;const batch=db.batch();books.forEach(book=>{const ti=(book.title||'').toLowerCase().trim();if(ex.has(ti))return;const ref=db.collection('users').doc(currentUser.uid).collection('books').doc();const c={...book};delete c.id;if(!c.dateAdded)c.dateAdded=Date.now();batch.set(ref,c);imp++;});await batch.commit();alert(`✅ ${imp} книг!`);}catch(err){alert('Помилка: '+err.message);}};inp.click();}
function clearAppCache(){if('caches' in window)caches.keys().then(n=>{for(let x of n)caches.delete(x);});if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(r=>{for(let x of r)x.unregister();});alert('Очищено!');setTimeout(()=>window.location.reload(true),500);}

auth.onAuthStateChanged(async user=>{
    const as=document.getElementById('authScreen'),ap=document.getElementById('appScreen');
    if(user){currentUser=user;as.classList.add('hidden');as.classList.remove('flex');ap.classList.remove('hidden');document.getElementById('searchFab').classList.remove('hidden');document.getElementById('mainBottomNav').classList.remove('hidden');document.getElementById('userEmailDisplay').innerText=user.email||user.displayName||"User";updateViewButtons();try{const ud=await db.collection('users').doc(user.uid).get();if(ud.exists&&ud.data().readingGoal)localStorage.setItem('readingGoal',ud.data().readingGoal);}catch(e){}loadLibrary();}
    else{currentUser=null;myLibrary=[];as.classList.remove('hidden');as.classList.add('flex');ap.classList.add('hidden');document.getElementById('searchFab').classList.add('hidden');document.getElementById('mainBottomNav').classList.add('hidden');}
});
function showErrorMsg(m){const e=document.getElementById('authError');e.innerText=m;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),6000);}
async function handleAuth(type,btn){const ot=btn.innerText;btn.innerText="...";const em=document.getElementById('authEmail').value,pw=document.getElementById('authPassword').value;if(em.length<5||pw.length<6){btn.innerText=ot;return showErrorMsg("Email+пароль(6+)");}try{if(type==='login')await auth.signInWithEmailAndPassword(em,pw);else await auth.createUserWithEmailAndPassword(em,pw);}catch(er){showErrorMsg(er.message);}finally{btn.innerText=ot;}}
async function signInWithGoogle(btn){const oh=btn.innerHTML;btn.innerText="...";const p=new firebase.auth.GoogleAuthProvider();try{await auth.signInWithPopup(p);}catch(er){if(er.code==='auth/popup-blocked')await auth.signInWithRedirect(p);else{showErrorMsg(er.message);btn.innerHTML=oh;}}}
function logout(){auth.signOut();closeAllSheets();}

function loadLibrary(){
    localforage.getItem('library_cache_'+currentUser.uid).then(c=>{if(c&&myLibrary.length===0){myLibrary=c;render();updateGoalWidget();updateStreakWidget();}});
    db.collection('users').doc(currentUser.uid).collection('books').orderBy('dateAdded','desc').onSnapshot(snap=>{myLibrary=snap.docs.map(d=>({id:d.id,...d.data()}));localforage.setItem('library_cache_'+currentUser.uid,myLibrary);render();updateGoalWidget();updateStreakWidget();});
}
async function updateBookInFirestore(id,u){if(currentUser)await db.collection('users').doc(currentUser.uid).collection('books').doc(id).update(u);}
function filterLibrary(q){libraryFilterQuery=q.toLowerCase().trim();render();}
function openSheet(id){document.body.classList.add('modal-open');document.querySelectorAll('.bottom-sheet').forEach(s=>s.classList.remove('open'));document.getElementById(id).classList.add('open');document.querySelector('.backdrop').classList.remove('hidden');}
function closeAllSheets(){document.body.classList.remove('modal-open');document.querySelectorAll('.bottom-sheet').forEach(s=>s.classList.remove('open'));document.querySelector('.backdrop').classList.add('hidden');toggleEditMode(false);}
function closeDetailsSheet(){if(!document.getElementById('statusButtons').classList.contains('hidden'))openSheet('searchSheet');else closeAllSheets();}

async function openScanner(){await loadScannerLib();document.getElementById('scannerSheet').classList.remove('hidden');html5QrCode=new Html5Qrcode("reader");html5QrCode.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:150},aspectRatio:1.0},(t)=>{if(navigator.vibrate)navigator.vibrate(100);closeScanner();const si=document.getElementById('searchInput');si.value=t;si.dispatchEvent(new Event('input'));},()=>{}).catch(er=>{alert("Камера: "+er);closeScanner();});}
function closeScanner(){if(html5QrCode){html5QrCode.stop().then(()=>{html5QrCode.clear();html5QrCode=null;}).catch(e=>console.log(e));}document.getElementById('scannerSheet').classList.add('hidden');}

const searchInput=document.getElementById('searchInput'),searchItems=document.getElementById('searchItems');
function isEnglishTitle(t){if(!t)return true;const l=t.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);if(!l)return false;const e=t.match(/[a-zA-Z]/g);return(e&&e.length>(l.length*0.4));}
function isCyrillic(s){return/[а-яА-ЯіІїЇєЄґҐ]/.test(s);}

searchInput.addEventListener('input',e=>{
    clearTimeout(timeoutId);const query=e.target.value.trim();
    if(query.length<2){searchItems.innerHTML='';return;}
    searchItems.innerHTML='<div class="p-8 text-slate-400 text-sm text-center animate-pulse">Шукаю...</div>';
    timeoutId=setTimeout(async()=>{
        try{
            let allItems=[];const isAuth=query.startsWith('author:"')&&query.endsWith('"');const raw=isAuth?query.slice(8,-1):query;const sq=encodeURIComponent(raw);const sqq=encodeURIComponent('"'+raw+'"');let pr=[];const isIsbn=/^[0-9-]{10,17}$/.test(raw);
            if(isIsbn){const ci=raw.replace(/[^0-9]/g,'');pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${ci}&key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME`).catch(()=>({ok:false})));pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?q=${ci}&key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME`).catch(()=>({ok:false})));pr.push(fetch(`https://itunes.apple.com/search?term=${ci}&entity=ebook&country=ua&limit=5`).catch(()=>({ok:false})));}
            else if(isAuth){pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=inauthor:"${sq}"&printType=books&maxResults=40`).catch(()=>({ok:false})));pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${sqq}&printType=books&maxResults=40`).catch(()=>({ok:false})));pr.push(fetch(`https://itunes.apple.com/search?term=${sq}&entity=ebook&attribute=authorTerm&country=ua&limit=30`).catch(()=>({ok:false})));}
            else{pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=intitle:${sqq}&printType=books&maxResults=20`).catch(()=>({ok:false})));pr.push(fetch(`https://www.googleapis.com/books/v1/volumes?key=AIzaSyDkpAZ7A8sYoVmd9hzl0OI5K8eli8blsME&q=${sq}&printType=books&maxResults=20`).catch(()=>({ok:false})));pr.push(fetch(`https://itunes.apple.com/search?term=${sq}&entity=ebook&country=ua&limit=25`).catch(()=>({ok:false})));}
            const res=await Promise.all(pr);
            for(let i=0;i<res.length-1;i++){if(res[i]&&res[i].ok){const d=await res[i].json();if(d.items)allItems.push(...d.items);}}
            const ar=res[res.length-1];if(ar&&ar.ok){const da=await ar.json();if(da.results)da.results.forEach(bk=>{allItems.push({id:'apple_'+bk.trackId,volumeInfo:{title:bk.trackName,authors:[bk.artistName||'Невідомий'],pageCount:300,description:bk.description?bk.description.replace(/(<([^>]+)>)/gi,""):'Apple Books.',publishedDate:bk.releaseDate?bk.releaseDate.substring(0,4):'',imageLinks:{thumbnail:bk.artworkUrl100?bk.artworkUrl100.replace('100x100bb','400x400bb'):null},categories:bk.genres||[]}});});}
            if(allItems.length===0)return searchItems.innerHTML='<div class="p-8 text-slate-400 text-sm text-center">Не знайдено</div>';
            const ui=[];const sk=new Set();allItems.forEach(it=>{const b=it.volumeInfo;if(!b||!b.title)return;const k=(b.title.toLowerCase()+(b.authors?b.authors[0].toLowerCase():'')).replace(/[^a-zа-я0-9ієї]/gi,'');if(!sk.has(k)){sk.add(k);ui.push(it);}});
            const bc=['Science','Technology','Computers','Medical','Law','Business & Economics','Mathematics','Education','Study Aids','Religion'];
            let fi=ui.filter(it=>{const b=it.volumeInfo;if(!b||!b.title)return false;if(isAuth)return(b.authors||[]).join(' ').toLowerCase().includes(raw.toLowerCase());const ex=b.title.toLowerCase().includes(raw.toLowerCase());if(!isIsbn&&!ex&&b.categories&&b.categories.some(c=>bc.includes(c)))return false;return true;});
            if(isAuth)fi.sort((a,b)=>(a.volumeInfo.publishedDate||'9999').localeCompare(b.volumeInfo.publishedDate||'9999'));
            else fi.sort((a,b)=>{const tA=(a.volumeInfo.title||'').toLowerCase(),tB=(b.volumeInfo.title||'').toLowerCase(),ql=raw.toLowerCase();if(tA===ql&&tB!==ql)return-1;if(tA!==ql&&tB===ql)return 1;if(tA.startsWith(ql)&&!tB.startsWith(ql))return-1;if(!tA.startsWith(ql)&&tB.startsWith(ql))return 1;return 0;});
            fi=fi.slice(0,30);if(fi.length===0)return searchItems.innerHTML='<div class="p-8 text-slate-400 text-sm text-center">Не знайдено</div>';
            searchItems.innerHTML='';
            fi.forEach(it=>{const b=it.volumeInfo,div=document.createElement('div');const si=(b.imageLinks?.thumbnail||PLACEHOLDER_IMG).replace(/^http:\/\//i,'https://');const bk={googleId:it.id||Math.random().toString(),title:b.title||'Без назви',author:b.authors?b.authors[0]:'Невідомий',pagesTotal:b.pageCount||300,image:si,description:b.description||'',genre:(b.categories&&b.categories[0])||'',publishedDate:b.publishedDate||''};div.className="p-3 mx-2 my-1 hover:bg-slate-100 rounded-2xl cursor-pointer flex items-center gap-4 active:bg-slate-200 fade-in relative";const yh=(isAuth&&bk.publishedDate)?`<div class="absolute top-2 right-3 text-[10px] font-bold text-indigo-400 bg-indigo-50 px-1.5 py-0.5 rounded">${bk.publishedDate.substring(0,4)}</div>`:'';div.innerHTML=`<img loading="lazy" src="${bk.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-12 h-16 object-cover rounded-lg shadow-sm"><div class="flex-1 min-w-0 pr-6"><div class="font-bold text-slate-900 truncate">${bk.title}</div><div class="text-xs text-slate-500 mt-0.5 truncate">${bk.author}</div></div>${yh}`;div.onclick=()=>showBookDetails(bk,true);searchItems.appendChild(div);});
        }catch(e){searchItems.innerHTML='<div class="p-8 text-red-500 text-sm text-center">Помилка</div>';}
    },600);
});

window.searchAuthorBooks=function(a){closeAllSheets();setTimeout(()=>{const i=document.getElementById('searchInput');i.value=`author:"${a}"`;openSheet('searchSheet');i.dispatchEvent(new Event('input'));},350);}
function openManualForm(){tempSelectedBook='manual';toggleEditMode(true);document.getElementById('editTitle').value='';document.getElementById('editAuthor').value='';document.getElementById('editPages').value='';document.getElementById('editImage').value='';document.getElementById('statusButtons').classList.remove('hidden');openSheet('detailsSheet');}

function showBookDetails(bookData,isNew=false){
    if(!bookData||!bookData.title)return;
    const lb=myLibrary.find(b=>(b.googleId&&b.googleId===bookData.googleId)||b.id===bookData.id)||bookData;
    tempSelectedBook=isNew?bookData:null;toggleEditMode(false);
    const sa=(lb.author||'Невідомий').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    let h=`<div class="flex gap-5 w-full mb-4 fade-in mt-1"><img loading="lazy" src="${lb.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-28 h-40 object-cover rounded-xl shadow-md border border-slate-100 flex-shrink-0"><div class="flex flex-col justify-center min-w-0 flex-1"><h3 class="text-xl font-bold text-slate-900 leading-tight mb-2 break-words">${lb.title||'Без назви'}</h3><button onclick="window.searchAuthorBooks('${sa}')" class="text-left w-fit px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold mb-3 active:scale-95">👤 ${sa}</button><span class="px-2.5 py-1 w-fit rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 mb-3">📄 ${lb.pagesTotal||300} стор.</span>${!isNew?`<select onchange="changeStatusFromDetails('${lb.id}',this.value)" class="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 outline-none cursor-pointer"><option value="planned" ${lb.status==='planned'?'selected':''}>⏳ В планах</option><option value="reading" ${lb.status==='reading'?'selected':''}>📖 Читаю</option><option value="finished" ${lb.status==='finished'?'selected':''}>✅ Прочитано</option></select>`:''}</div></div>`;
    if(!isNew){
        h+=`<div class="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl shadow-sm fade-in"><h4 class="text-[9px] font-black uppercase text-indigo-500 tracking-wider mb-3">📖 Читалка</h4><div class="space-y-2"><button onclick="readSavedEpub('${lb.id}')" class="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md active:scale-95">📱 Читати</button><div class="relative w-full"><input type="file" id="epubFileModal_${lb.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${lb.id}')"><button onclick="document.getElementById('epubFileModal_${lb.id}').click()" class="w-full py-3 bg-white text-indigo-700 border border-indigo-200 rounded-xl font-bold text-sm active:scale-95">📥 Завантажити .epub</button></div></div></div>`;
        h+=`<div class="mb-6 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm fade-in"><h4 class="text-[9px] font-black uppercase text-indigo-500 tracking-wider mb-3">🗓 Дати</h4><div class="space-y-2"><div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl"><span class="text-xs font-bold">Початок:</span><input type="date" value="${lb.dateStarted||''}" onchange="saveManualDate('${lb.id}','dateStarted',this)" class="date-input"></div><div class="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl"><span class="text-xs font-bold">Кінець:</span><input type="date" value="${lb.dateFinished||''}" onchange="saveManualDate('${lb.id}','dateFinished',this)" class="date-input"></div></div></div>`;
        const hl=lb.highlights||[];
        if(hl.length>0)h+=`<div class="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl shadow-sm fade-in"><h4 class="text-[9px] font-black uppercase text-amber-600 tracking-wider mb-3">✍️ Виділення (${hl.length})</h4><div class="space-y-2 max-h-40 overflow-y-auto">${hl.map((x,i)=>`<div class="text-xs text-slate-700 bg-white p-3 rounded-lg border border-amber-100 italic relative">"${x.text.substring(0,200)}"<button onclick="deleteHighlight('${lb.id}',${i})" class="absolute top-1 right-2 text-red-400 text-[10px]">✕</button></div>`).join('')}</div></div>`;
        let stars='';const cr=lb.rating||0;for(let i=1;i<=5;i++)stars+=`<span onclick="setRating('${lb.id}',${i})" class="text-4xl cursor-pointer ${cr>=i?'text-amber-400':'text-slate-200'} active:scale-90 transition-transform">★</span>`;
        h+=`<div class="mb-6 text-center fade-in bg-white border border-slate-100 rounded-2xl p-4 shadow-sm"><div class="text-[9px] font-black text-slate-400 uppercase mb-2">Оцінка</div><div class="flex justify-center gap-3">${stars}</div></div>`;
        h+=`<div class="mb-6 bg-slate-50 p-5 rounded-3xl border border-slate-100 fade-in shadow-sm"><h4 class="text-[10px] font-black uppercase text-slate-500 mb-3 flex justify-between">Нотатки <button onclick="saveReview('${lb.id}')" class="text-indigo-600 bg-indigo-100 px-4 py-2 rounded-xl text-[10px] font-bold active:scale-95">Зберегти</button></h4><textarea id="reviewText_${lb.id}" class="w-full bg-transparent text-sm outline-none resize-none min-h-[80px]" placeholder="Враження...">${lb.review||''}</textarea></div>`;
    }
    h+=`<div class="desc-scroll fade-in"><h4 class="text-[10px] font-black uppercase text-slate-400 mb-2">Анотація</h4><p class="text-sm text-slate-700 leading-relaxed">${lb.description||'Немає.'}</p></div>`;
    if(!isNew)h+=`<div class="mt-8 mb-2 flex justify-center fade-in"><button onclick="deleteBookFromDetails('${lb.id}')" class="px-6 py-3 text-red-500 bg-red-50 rounded-xl font-bold text-sm active:scale-95">🗑️ Видалити</button></div>`;
    document.getElementById('detailsContent').innerHTML=h;
    if(isNew)document.getElementById('statusButtons').classList.remove('hidden');else document.getElementById('statusButtons').classList.add('hidden');
    openSheet('detailsSheet');
}

function deleteHighlight(id,i){const b=myLibrary.find(x=>x.id===id);if(!b||!b.highlights)return;b.highlights.splice(i,1);updateBookInFirestore(id,{highlights:b.highlights});showBookDetails(b);}
function deleteBookFromDetails(id){if(confirm("Видалити?")){db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete();closeAllSheets();}}
function setRating(id,r){updateBookInFirestore(id,{rating:r});setTimeout(()=>showBookDetails(myLibrary.find(b=>b.id===id)),100);}
function changeStatusFromDetails(id,ns){const u={status:ns};const b=myLibrary.find(x=>x.id===id);if(ns==='finished'){u.pagesRead=b.pagesTotal;u.dateFinished=b.dateFinished||new Date().toISOString().slice(0,10);}else if(ns==='reading'){u.dateStarted=b.dateStarted||new Date().toISOString().slice(0,10);}updateBookInFirestore(id,u);closeAllSheets();setLibraryTab(ns);}
function toggleEditMode(v){if(v){document.getElementById('detailsContent').classList.add('hidden');document.getElementById('editContent').classList.remove('hidden');}else{document.getElementById('detailsContent').classList.remove('hidden');document.getElementById('editContent').classList.add('hidden');}}
function saveBookEdits(){const u={title:document.getElementById('editTitle').value.trim()||'Без назви',author:document.getElementById('editAuthor').value.trim()||'Невідомий',pagesTotal:parseInt(document.getElementById('editPages').value)||300,image:document.getElementById('editImage').value.trim()};if(tempSelectedBook==='manual'){tempSelectedBook={...u,description:'Вручну.'};toggleEditMode(false);showBookDetails(tempSelectedBook,true);}else{updateBookInFirestore(tempSelectedBook.id,u);showBookDetails({...tempSelectedBook,...u});}}
function saveReview(id){updateBookInFirestore(id,{review:document.getElementById(`reviewText_${id}`).value});if(navigator.vibrate)navigator.vibrate(50);}
async function addBookWithStatus(s){if(!currentUser)return;if(tempSelectedBook==='manual')saveBookEdits();let nd={...tempSelectedBook,status:s,pagesRead:s==='finished'?tempSelectedBook.pagesTotal:0,dateAdded:Date.now(),rating:0,review:'',highlights:[],timeSpent:0,lastFileName:null,dateStarted:s==='reading'?new Date().toISOString().slice(0,10):null,dateFinished:s==='finished'?new Date().toISOString().slice(0,10):null,sortOrder:0};await db.collection('users').doc(currentUser.uid).collection('books').add(nd);tempSelectedBook=null;closeAllSheets();}
function changeStatus(id,ns,ev){ev.stopPropagation();const u={status:ns};const b=myLibrary.find(x=>x.id===id);if(ns==='reading'&&!b.dateStarted)u.dateStarted=new Date().toISOString().slice(0,10);if(ns==='finished'){u.pagesRead=b.pagesTotal;u.dateFinished=new Date().toISOString().slice(0,10);}updateBookInFirestore(id,u);setLibraryTab(ns);}
function saveManualDate(id,f,el){updateBookInFirestore(id,{[f]:el.value});const b=myLibrary.find(x=>x.id===id);if(b)b[f]=el.value;if(navigator.vibrate)navigator.vibrate(50);}

function startTimer(){readingStartTime=Date.now();currentSessionSeconds=0;document.getElementById('readerTimer').innerText="00:00";readingTimer=setInterval(()=>{currentSessionSeconds=Math.floor((Date.now()-readingStartTime)/1000);const m=String(Math.floor(currentSessionSeconds/60)).padStart(2,'0'),s=String(currentSessionSeconds%60).padStart(2,'0'),h=Math.floor(currentSessionSeconds/3600);document.getElementById('readerTimer').innerText=h>0?`${h}:${m}:${s}`:`${m}:${s}`;},1000);}
function stopTimer(){if(readingTimer&&currentReaderBookId){clearInterval(readingTimer);readingTimer=null;const b=myLibrary.find(x=>x.id===currentReaderBookId);if(b&&currentSessionSeconds>5){const t=(b.timeSpent||0)+currentSessionSeconds;db.collection('users').doc(currentUser.uid).collection('books').doc(currentReaderBookId).update({timeSpent:t});if(currentSessionSeconds>=300)markReadingDay();}}}
window.addEventListener('beforeunload',stopTimer);
function toggleReaderSettings(){document.getElementById('readerSettingsMenu').classList.toggle('hidden');}
function applyReaderSettings(){if(!rendition)return;rendition.themes.fontSize(readerFontSize+"%");rendition.themes.select(readerTheme);}
function changeFontSize(d){readerFontSize=Math.max(50,Math.min(200,readerFontSize+d));localStorage.setItem('readerFontSize',readerFontSize);applyReaderSettings();}
function changeReaderTheme(t){readerTheme=t;localStorage.setItem('readerTheme',t);applyReaderSettings();}
function initSwipeGestures(){if(!window.Hammer)return;const v=document.getElementById('viewer');if(!window.mc){window.mc=new Hammer(v);window.mc.get('swipe').set({direction:Hammer.DIRECTION_HORIZONTAL});window.mc.on("swipeleft",()=>{if(rendition)rendition.next();});window.mc.on("swiperight",()=>{if(rendition)rendition.prev();});}}

function handleFileSelectAndSave(ev,bookId){const file=ev.target.files[0];if(!file)return;if(!file.name.toLowerCase().endsWith('.epub')){alert(".epub!");ev.target.value='';return;}const bd=myLibrary.find(b=>b.id===bookId);if(bd&&bd.lastFileName&&bd.lastFileName!==file.name&&!confirm(`Інший файл?`)){ev.target.value='';return;}if(bd&&bd.lastFileName!==file.name)updateBookInFirestore(bookId,{lastFileName:file.name});const r=new FileReader();r.onload=async function(e){const ab=e.target.result;try{await localforage.setItem(`epub_${bookId}`,ab);}catch(er){}await openEpubReader(bookId,ab);closeAllSheets();};r.readAsArrayBuffer(file);ev.target.value='';}
async function readSavedEpub(bookId){try{const ab=await localforage.getItem(`epub_${bookId}`);if(!ab){alert("Файл не знайдено!");return;}await openEpubReader(bookId,ab);closeAllSheets();}catch(e){alert("Помилка");}}
function readSavedEpubFromCard(id,ev){ev.stopPropagation();readSavedEpub(id);}

async function openEpubReader(bookId,source){
    if(!readerDepsLoaded){await loadReaderDeps();readerDepsLoaded=true;}
    const bd=myLibrary.find(b=>b.id===bookId);if(!bd)return;
    currentReaderBookId=bookId;document.getElementById('readerOverlay').style.display='flex';document.getElementById('readerTitle').innerText=bd.title;document.getElementById('readerProgress').innerText="...";document.getElementById('librarySections').classList.add('hidden');startTimer();document.getElementById('viewer').innerHTML='';
    try{
        currentBookInstance=ePub(source);rendition=currentBookInstance.renderTo("viewer",{width:"100%",height:"100%",spread:"none",manager:"continuous",flow:"paginated"});
        rendition.themes.register("light",{"body":{"background":"#f8fafc","color":"#0f172a"}});rendition.themes.register("sepia",{"body":{"background":"#f4ecd8","color":"#5b4636"}});rendition.themes.register("dark",{"body":{"background":"#0f172a","color":"#cbd5e1"}});applyReaderSettings();
        rendition.on("selected",function(cfi,contents){rendition.annotations.highlight(cfi);currentBookInstance.getRange(cfi).then(function(range){if(!range)return;const text=range.toString().trim();if(text.length<3)return;const bk=myLibrary.find(b=>b.id===currentReaderBookId);if(bk){const hl=bk.highlights||[];hl.push({text,cfi,date:Date.now()});bk.highlights=hl;updateBookInFirestore(currentReaderBookId,{highlights:hl});}if(navigator.vibrate)navigator.vibrate([50,50,50]);});contents.window.getSelection().removeAllRanges();});
        rendition.on("relocated",loc=>{if(!loc||!loc.start)return;const p=Math.round((loc.start.percentage||0)*100);document.getElementById('readerProgress').innerText=p>0?p+"%":"...";clearTimeout(window.syncProgressTimeout);window.syncProgressTimeout=setTimeout(()=>{const u={lastCfi:loc.start.cfi};if(p>0)u.pagesRead=Math.round((p/100)*(bd.pagesTotal||300));updateBookInFirestore(currentReaderBookId,u);},3000);});
        const safeCfi=(bd.lastCfi&&typeof bd.lastCfi==='string'&&bd.lastCfi.startsWith('epubcfi'))?bd.lastCfi:undefined;
        await rendition.display(safeCfi).catch(()=>rendition.display());
        currentBookInstance.ready.then(()=>currentBookInstance.locations.generate(1600)).then(()=>{const l=rendition.currentLocation();if(l&&l.start)document.getElementById('readerProgress').innerText=Math.round(l.start.percentage*100)+"%";}).catch(()=>{});
        initSwipeGestures();
    }catch(er){console.error(er);document.getElementById('readerProgress').innerText="Помилка";stopTimer();}
}
function closeReader(){stopTimer();document.getElementById('readerOverlay').style.display='none';document.getElementById('readerSettingsMenu').classList.add('hidden');if(currentBookInstance){currentBookInstance.destroy();currentBookInstance=null;rendition=null;}document.getElementById('viewer').innerHTML='';document.getElementById('librarySections').classList.remove('hidden');currentReaderBookId=null;}

function deleteBook(id,ev){ev.stopPropagation();if(confirm("Видалити?"))db.collection('users').doc(currentUser.uid).collection('books').doc(id).delete();}
function formatTime(s){if(!s)return"0 хв";const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h} год ${m} хв`:`${m} хв`;}
function setLibraryTab(t){currentLibraryTab=t;document.querySelectorAll('#libraryTabs button').forEach(b=>{b.className='px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all duration-200 bg-slate-200 text-slate-600 dark-inactive-tab active:scale-95';});document.getElementById('tab_'+t).className='px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all duration-200 bg-indigo-600 text-white shadow-md active:scale-95';render();}

function renderBookCard(book){
    const pct=Math.round((book.pagesRead/book.pagesTotal)*100)||0,isFin=book.status==='finished',isPlan=book.status==='planned',isRead=book.status==='reading';
    const bj=JSON.stringify(book).replace(/"/g,'&quot;');
    if(viewMode==='grid')return`<div data-id="${book.id}" onclick="showBookDetails(${bj})" class="flex flex-col items-center cursor-pointer fade-in active:scale-[0.98] transition-transform ${isFin?'opacity-80':''}"><div class="relative w-full aspect-[2/3]"><img loading="lazy" src="${book.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-full h-full rounded-xl shadow-md object-cover border border-slate-200">${isFin&&book.rating?`<div class="absolute -bottom-2 -right-2 bg-white text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm">★${book.rating}</div>`:''}${isRead&&pct>0?`<div class="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20 rounded-b-xl overflow-hidden"><div class="h-full bg-indigo-500 rounded-b-xl" style="width:${pct}%"></div></div>`:''}</div><h3 class="font-bold text-[11px] mt-2 w-full text-center truncate px-1">${book.title}</h3></div>`;
    return`<div data-id="${book.id}" onclick="showBookDetails(${bj})" class="bg-white p-4 rounded-[1.25rem] shadow-sm flex gap-4 items-start cursor-pointer border border-slate-100 fade-in active:scale-[0.98] transition-transform ${isFin?'opacity-80':''}"><img loading="lazy" src="${book.image||PLACEHOLDER_IMG}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-16 h-24 rounded-xl shadow-sm object-cover flex-shrink-0 border border-slate-100"><div class="flex-1 min-w-0"><div class="flex justify-between items-start gap-2"><div class="min-w-0"><h3 class="font-bold text-[15px] leading-snug truncate">${book.title}</h3><p class="text-[13px] text-slate-500 mt-0.5 truncate">${book.author}</p></div><button onclick="deleteBook('${book.id}',event)" class="text-slate-300 hover:text-red-500 p-1">✕</button></div>${isPlan?`<button onclick="changeStatus('${book.id}','reading',event)" class="w-full mt-4 py-2 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg active:scale-95">🚀 Читати</button>`:`<div class="mt-3 mb-1.5 flex items-center gap-2"><div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div class="progress-bar bg-indigo-600 h-full rounded-full" style="width:${pct}%"></div></div>${isRead?`<button onclick="changeStatus('${book.id}','finished',event)" class="shrink-0 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded text-[10px] font-bold active:scale-95">✅</button>`:''}</div><div class="flex justify-between text-[11px] font-bold mt-1"><span class="text-slate-400">⏱️ ${formatTime(book.timeSpent)}</span><span class="text-indigo-600">${pct}%</span></div>${isRead?`<div class="mt-3 flex gap-1.5 border-t border-slate-50 pt-3"><button onclick="readSavedEpubFromCard('${book.id}',event)" class="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold active:scale-95 shadow-sm">📱 Читати</button><div class="relative flex-1"><input type="file" id="epubFile_${book.id}" accept=".epub" class="hidden" onchange="handleFileSelectAndSave(event,'${book.id}')"><button onclick="event.stopPropagation();document.getElementById('epubFile_${book.id}').click();" class="w-full py-2 bg-slate-100 rounded-lg text-xs font-bold active:scale-95">📥</button></div></div>`:''}`}${isFin&&book.rating?`<div class="mt-2 text-amber-400 text-sm">${'★'.repeat(book.rating)}${'☆'.repeat(5-book.rating)}</div>`:''}</div></div>`;
}

function render(){
    const q=libraryFilterQuery;
    let reading=myLibrary.filter(b=>b.status==='reading'),planned=myLibrary.filter(b=>b.status==='planned'),finished=myLibrary.filter(b=>b.status==='finished');
    if(q){const fn=b=>b.title?.toLowerCase().includes(q)||b.author?.toLowerCase().includes(q);reading=reading.filter(fn);planned=planned.filter(fn);finished=finished.filter(fn);}
    document.getElementById('tab_reading').innerText=`Читаю (${reading.length})`;document.getElementById('tab_planned').innerText=`В планах (${planned.length})`;document.getElementById('tab_finished').innerText=`Прочитано (${finished.length})`;
    const c=document.getElementById('myBooksContainer');let list=[];
    if(currentLibraryTab==='reading')list=reading;else if(currentLibraryTab==='planned')list=planned;else list=finished;
    if(list.length===0){c.innerHTML=`<div class="mt-10 text-center"><span class="text-4xl block mb-4">📚</span><h3 class="text-xl font-bold mb-2">${q?'Не знайдено':'Порожньо'}</h3></div>`;return;}
    c.classList.remove('fade-in');void c.offsetWidth;c.classList.add('fade-in');
    const wc=viewMode==='grid'?'grid grid-cols-3 gap-4 sortable-list':'space-y-3 sortable-list';
    if(currentLibraryTab==='finished'){
        finished.sort((a,b)=>(b.dateFinished||'1970').localeCompare(a.dateFinished||'1970'));
        const gr={};finished.forEach(b=>{let y='Без дати';try{if(b.dateFinished&&typeof b.dateFinished==='string')y=b.dateFinished.substring(0,4);}catch(e){}if(!gr[y])gr[y]=[];gr[y].push(b);});
        let html='';Object.keys(gr).sort((a,b)=>{if(a==='Без дати')return 1;if(b==='Без дати')return-1;return b-a;}).forEach(y=>{html+=`<h2 class="font-black text-slate-300 text-lg mt-6 mb-3">${y}</h2><div class="${wc}">${gr[y].map(renderBookCard).join('')}</div>`;});c.innerHTML=html;
    }else{list.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));c.innerHTML=`<div class="${wc}">${list.map(renderBookCard).join('')}</div>`;}
    document.querySelectorAll('.sortable-list').forEach(l=>{new Sortable(l,{delay:300,delayOnTouchOnly:true,animation:150,ghostClass:'sortable-ghost',onEnd:ev=>{[...ev.from.children].forEach((el,i)=>{const id=el.dataset.id;if(id)updateBookInFirestore(id,{sortOrder:i});});}});});
}

function switchTab(tab){
    document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));const ni=document.querySelectorAll('.nav-item');
    if(tab==='library'){ni[0].classList.add('active');const l=document.getElementById('librarySections');l.classList.remove('hidden','fade-in');void l.offsetWidth;l.classList.add('fade-in');document.getElementById('recommendationsScreen').classList.add('hidden');}
    else{ni[1].classList.add('active');const r=document.getElementById('recommendationsScreen');r.classList.remove('hidden','fade-in');void r.offsetWidth;r.classList.add('fade-in');document.getElementById('librarySections').classList.add('hidden');if(!currentRecCategory)loadRealRecommendations('auto','rec_auto');}
}

const curatedCategories={'Академія магії':['"академия магии" фэнтези','"магическая академия"','ромфант академия','академия волшебства'],'Фентезі':['"фэнтези" бестселлер','эпическое фэнтези','попаданцы фэнтези','Джон Толкин','Джордж Мартин','Анджей Сапковский','Брэндон Сандерсон','Робин Хобб','Ник Перумов','Алексей Пехов','боевое фэнтези'],'Детектив':['"детектив" бестселлер','Агата Кристи','Ю Несбё','Стиг Ларссон','Борис Акунин','психологический детектив'],'Трилер':['"триллер" бестселлер','Стивен Кинг','Джиллиан Флинн','Дэн Браун','Франк Тилье','психологический триллер'],'Романтика':['"любовный роман" бестселлер','Николас Спаркс','Джоджо Мойес','Колин Гувер','Джейн Остин','современный любовный роман'],'Саморозвиток':['"саморазвитие" бестселлер','Роберт Кийосаки','Марк Мэнсон','Джо Диспенза','Джеймс Клир','психология успеха'],'Фантастика':['"научная фантастика" бестселлер','Фрэнк Герберт Дюна','Айзек Азимов','Рэй Брэдбери','Энди Вейер','Сергей Лукьяненко','космическая фантастика']};

async function loadRealRecommendations(cat='auto',btnId='rec_auto'){
    if(currentRecCategory===cat)return;currentRecCategory=cat;recStartIndex=0;currentRecQueryIndex=0;currentRecQueries=[];shownRecTitles.clear();
    const list=document.getElementById('recommendationsList');list.innerHTML='<div class="p-8 text-slate-400 text-sm text-center animate-pulse">🔍 Шукаємо...</div>';
    document.querySelectorAll('#recTabs button').forEach(b=>{b.className='px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap bg-slate-200 text-slate-600 dark-inactive-tab transition-all active:scale-95';});
    if(document.getElementById(btnId))document.getElementById(btnId).className='px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap bg-indigo-600 text-white shadow-md transition-all active:scale-95';
    let pool=[];
    if(cat==='auto'){let authors=myLibrary.map(b=>b.author).filter(a=>a&&a.length>2&&!a.toLowerCase().includes('невідомий'));if(authors.length>0){let counts={};authors.forEach(a=>counts[a]=(counts[a]||0)+1);pool.push(...Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,10).map(a=>`inauthor:"${a}"`));}let gen=Object.values(curatedCategories).flat();gen.sort(()=>0.5-Math.random());pool.push(...gen);}
    else{pool=[...curatedCategories[cat]];pool.sort(()=>0.5-Math.random());}
    currentRecQueries=pool;await fetchMoreRecommendations(true);
}

async function fetchMoreRecommendations(isFirst=false){
    if(isFetchingRecs||currentRecQueryIndex>=currentRecQueries.length)return;isFetchingRecs=true;
    const lst=document.getElementById('recommendationsList');
    if(!isFirst&&!document.getElementById('recLoadingMore')){const d=document.createElement('div');d.id='recLoadingMore';d.className='py-6 text-center text-slate-400 animate-pulse text-sm';d.innerHTML='Ще...';lst.appendChild(d);}
    let finalBooks=[],empty=0;
      while(finalBooks.length<5&&currentRecQueryIndex<currentRecQueries.length&&empty<3){
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
                const tLower=b.title.toLowerCase();
                if(badWords.some(bw=>tLower.includes(bw)))return false;
                if(existingTitles.has(tLower))return false;
                const key=tLower+(b.authors?b.authors[0]:'');
                if(shownRecTitles.has(key))return false;
                return true;
            });
            const u=new Map();
            valid.forEach(i=>{const b=i.volumeInfo;const key=b.title.toLowerCase()+(b.authors?b.authors[0]:'');u.set(key,i);});
            let uniqueBatch=Array.from(u.values());
            uniqueBatch.forEach(i=>{const b=i.volumeInfo;const key=b.title.toLowerCase()+(b.authors?b.authors[0]:'');shownRecTitles.add(key);finalBooks.push(i);});
            if(uniqueBatch.length===0)empty++;else empty=0;
        }catch(e){empty++;currentRecQueryIndex++;recStartIndex=0;}
    }
    if(isFirst)lst.innerHTML='';
    if(document.getElementById('recLoadingMore'))document.getElementById('recLoadingMore').remove();
    if(finalBooks.length===0&&isFirst){lst.innerHTML='<div class="p-8 text-center text-slate-400 text-sm">Не знайшли 😔</div>';}
    else if(finalBooks.length>0){
        finalBooks.sort(()=>0.5-Math.random());
        let h='';
        finalBooks.forEach(i=>{
            const b=i.volumeInfo;
            const img=(b.imageLinks?.thumbnail||PLACEHOLDER_IMG).replace(/^http:\/\//i,'https://');
            const bk={googleId:i.id||Math.random().toString(),title:b.title,author:b.authors?b.authors[0]:'Невідомий',pagesTotal:b.pageCount||300,image:img,description:b.description||'',genre:(b.categories&&b.categories[0])||''};
            h+=`<div onclick="showBookDetails(${JSON.stringify(bk).replace(/"/g,'&quot;')},true)" class="bg-white p-4 rounded-xl flex gap-3 items-start border border-slate-100 cursor-pointer shadow-sm mb-3 fade-in active:scale-[0.98] transition-transform"><img loading="lazy" src="${bk.image}" onerror="this.src='${PLACEHOLDER_IMG}'" class="w-16 h-24 rounded shadow-sm object-cover flex-shrink-0"><div class="flex-1 min-w-0"><div class="font-bold text-sm leading-tight">${bk.title}</div><div class="text-xs text-slate-500 mt-0.5">${bk.author}</div><div class="text-[10px] text-slate-400 mt-1.5 line-clamp-2">${bk.description}</div></div><button class="text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg text-xs font-bold shrink-0 mt-2 pointer-events-none">➕</button></div>`;
        });
        const tmp=document.createElement('div');tmp.innerHTML=h;while(tmp.firstChild)lst.appendChild(tmp.firstChild);
    }
    isFetchingRecs=false;
}
