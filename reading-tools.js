// ===== READING HISTORY AND REMINDERS =====
const monthFormatter=new Intl.DateTimeFormat('uk-UA',{month:'long',timeZone:'UTC'});
let calendarMonth;
let pendingImport;

function normalizeReadingSearch(value){
    return typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase('uk').replace(/['’ʼ]/g,'’').replace(/\s+/g,' ').trim():'';
}

function findReadingSearchMatch(book,query){
    if(!query)return;
    if(normalizeReadingSearch(book.review).includes(query))return {label:'Нотатка',text:book.review};
    const quote=(Array.isArray(book.highlights)?book.highlights:[]).find(entry=>normalizeReadingSearch(entry?.text).includes(query));
    if(quote)return {label:'Цитата',text:quote.text};
}

function matchesReadingSearch(book,query){
    return !query||normalizeReadingSearch(book.title).includes(query)||normalizeReadingSearch(book.author).includes(query)||
        Boolean(findReadingSearchMatch(book,query));
}

function renderReadingSearchMatch(book,query){
    const match=findReadingSearchMatch(book,query);
    if(!match)return '';
    const text=match.text.trim().replace(/\s+/g,' ');
    const position=normalizeReadingSearch(text).indexOf(query);
    const start=Math.max(0,position-30);
    const end=Math.min(text.length,start+115);
    return `<p class="reading-search-match"><strong>${match.label}</strong>
        ${start?'…':''}${escapeHtml(text.slice(start,end))}${end<text.length?'…':''}</p>`;
}

function validMonth(value){
    return typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&value.slice(0,4)!=='0000'?value:'';
}

function calendarEvents(){
    return myLibrary.flatMap(book=>[
        {book,date:dateValue(book.dateFinished),label:'Перше читання'},
        ...rereads(book).map(entry=>({book,date:entry.finished,label:'Перечитування'}))
    ]).filter(entry=>entry.date).sort((a,b)=>b.date.localeCompare(a.date));
}

function openReadingCalendar(reset=true){
    if(reset||!calendarMonth)calendarMonth=todayDate().slice(0,7);
    openLibraryTools('calendar');
}

function monthName(month){
    return monthFormatter.format(new Date('2024-'+month+'-01T00:00:00Z'));
}

function renderReadingCalendar(){
    const holder=document.getElementById('libraryToolsContent');
    const events=calendarEvents();
    const year=calendarMonth.slice(0,4);
    const selected=calendarMonth.slice(5);
    const years=[...new Set([todayDate().slice(0,4),year,...events.map(entry=>entry.date.slice(0,4))])].sort().reverse();
    const matches=events.filter(entry=>entry.date.startsWith(calendarMonth));
    const counts=events.filter(entry=>entry.date.startsWith(year)).reduce((result,entry)=>{
        const month=entry.date.slice(5,7);
        result[month]=(result[month]||0)+1;
        return result;
    },{});
    holder.innerHTML=`<label class="calendar-year">Рік
        <select data-calendar-year aria-label="Рік календаря">${years.map(value=>`<option ${value===year?'selected':''}>${value}</option>`).join('')}</select>
    </label>
    <div class="calendar-months">${Array.from({length:12},(_,index)=>{
        const month=String(index+1).padStart(2,'0');
        return `<button type="button" data-action="calendar-month" data-value="${month}" aria-pressed="${month===selected}">
            <span>${monthName(month)}</span>${counts[month]?`<small>${counts[month]}</small>`:''}</button>`;
    }).join('')}</div>
    <h3 class="calendar-month-heading">${monthName(selected)} ${year}</h3>
    ${matches.length?`<div class="tool-list">${matches.map(entry=>
        `<button type="button" class="tool-action calendar-book" data-action="calendar-book" data-value="${escapeHtml(entry.book.id)}">
            <span><strong>${escapeHtml(entry.book.title)}</strong><small>${entry.label}</small></span>
            <time datetime="${entry.date}">${formatReadingDate(entry.date)}</time>
        </button>`).join('')}</div>`:'<p class="text-muted">За цей місяць завершень у бібліотеці немає.</p>'}`;
}

function refreshReadingTools(){
    if(libraryToolsView.mode==='calendar'){
        document.getElementById('libraryToolsTitle').textContent='Календар читання';
        renderReadingCalendar();
        return true;
    }
    if(libraryToolsView.mode==='import'){
        document.getElementById('libraryToolsTitle').textContent='Перегляд імпорту';
        return true;
    }
    return false;
}

function handleReadingToolAction(action,value){
    if(action==='calendar-month'){
        calendarMonth=calendarMonth.slice(0,4)+'-'+value;
        renderReadingCalendar();
        document.querySelector('[data-action=calendar-month][aria-pressed=true]')?.focus({preventScroll:true});
        return true;
    }
    if(action==='calendar-book'){
        showLibraryBook(value);
        return true;
    }
    return false;
}

function handleReadingToolChange(target){
    if(!target.matches('[data-calendar-year]'))return false;
    calendarMonth=target.value+calendarMonth.slice(4);
    renderReadingCalendar();
    document.querySelector('[data-calendar-year]')?.focus({preventScroll:true});
    return true;
}

function renderReminderEditor(book){
    const month=validMonth(book.rereadReminderMonth);
    const current=todayDate().slice(0,7);
    return `<div class="reminder-editor">
        <label for="rereadReminderMonth">Перечитати пізніше</label>
        <div>
            <input id="rereadReminderMonth" class="search-box" type="month" value="${month}"
                min="${month&&month<current?month:current}"
                onchange="saveRereadReminder(this)">
            <button type="button" class="secondary-button" onclick="clearRereadReminder(this)" aria-label="Прибрати нагадування про перечитування" ${month?'':'disabled'}>Прибрати</button>
        </div>
    </div>`;
}

function clearRereadReminder(button){
    const input=button.parentElement.querySelector('input');
    input.value='';
    saveRereadReminder(input);
}

async function saveRereadReminder(input){
    const book=libraryBook(document.getElementById('detailsContent').dataset.book);
    if(!book)return;
    const month=validMonth(input.value);
    if(input.value&&!month){
        input.value=validMonth(book.rereadReminderMonth);
        return;
    }
    const clearButton=input.parentElement.querySelector('button');
    clearButton.disabled=!month;
    try{await updateBookInFirestore(book.id,{rereadReminderMonth:month||null});}
    catch(error){
        if(input.isConnected){
            input.value=validMonth(libraryBook(book.id)?.rereadReminderMonth);
            clearButton.disabled=!input.value;
        }
        showWriteError(error);
    }
}

function renderRereadReminders(){
    const section=document.getElementById('rereadReminders');
    const month=todayDate().slice(0,7);
    const due=myLibrary.filter(book=>!book.activeReread&&validMonth(book.rereadReminderMonth)&&book.rereadReminderMonth<=month)
        .sort((a,b)=>a.rereadReminderMonth.localeCompare(b.rereadReminderMonth));
    section.hidden=!due.length;
    if(!due.length){section.replaceChildren();return;}
    const markup=`<h2>Час перечитати</h2><div class="tool-list">${due.map(book=>
        `<button type="button" class="tool-action reminder-book" data-book="${escapeHtml(book.id)}"
            onclick="showLibraryBook(this.dataset.book)"><span>${escapeHtml(book.title)}</span>
            <small>${monthName(book.rereadReminderMonth.slice(5))} ${book.rereadReminderMonth.slice(0,4)}</small></button>`).join('')}</div>`;
    if(section.innerHTML!==markup)section.innerHTML=markup;
}

// ===== IMPORT PREVIEW =====
const importGroups=[
    {id:'dates',label:'Дати читання',fields:['dateStarted','dateFinished']},
    {id:'notes',label:'Нотатка',fields:['review']},
    {id:'rereads',label:'Перечитування',fields:['rereads']},
    {id:'quotes',label:'Цитати',fields:['highlights']}
];

function dataEquals(a,b){
    const sorted=(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
        ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value;
    return JSON.stringify(a??null,sorted)===JSON.stringify(b??null,sorted);
}

function sanitizeImportedBook(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.title!=='string'||!raw.title.trim())return;
    const book={title:raw.title.trim(),status:raw.status||'planned',dateAdded:Date.now()};
    if(!['reading','planned','finished'].includes(book.status))book.status='planned';
    for(const field of ['googleId','author','image','description','genre','publishedDate','source','review','lastFileName','lastCfi']){
        if(typeof raw[field]==='string')book[field]=raw[field];
    }
    for(const field of ['pagesTotal','pagesRead','rating','timeSpent','dateAdded','lastOpenedAt','sortOrder','deletedAt']){
        if(typeof raw[field]==='number'&&Number.isFinite(raw[field])&&raw[field]>=0)book[field]=raw[field];
    }
    for(const field of ['dateStarted','dateFinished']){
        if(Object.hasOwn(raw,field)&&(!raw[field]||dateValue(raw[field])))book[field]=raw[field]||null;
    }
    for(const field of ['tags','shelves','identifiers']){
        if(Array.isArray(raw[field]))book[field]=labelNames(raw[field]);
    }
    if(typeof raw.favorite==='boolean')book.favorite=raw.favorite;
    if(validMonth(raw.rereadReminderMonth))book.rereadReminderMonth=raw.rereadReminderMonth;
    if(Array.isArray(raw.rereads))book.rereads=rereads(raw).map(entry=>({started:dateValue(entry.started)||null,finished:entry.finished}));
    if(Array.isArray(raw.highlights))book.highlights=raw.highlights.filter(entry=>typeof entry?.text==='string').map(entry=>({
        text:entry.text,...(typeof entry.cfi==='string'?{cfi:entry.cfi}:{}),
        ...(typeof entry.date==='number'&&Number.isFinite(entry.date)?{date:entry.date}:{})
    }));
    if(raw.activeReread&&typeof raw.activeReread.id==='string'&&/^[\w-]+$/.test(raw.activeReread.id)&&dateValue(raw.activeReread.started)){
        book.activeReread={id:raw.activeReread.id,started:raw.activeReread.started};
    }
    if(raw.rereadProgress&&typeof raw.rereadProgress==='object'){
        book.rereadProgress=Object.fromEntries(Object.entries(raw.rereadProgress).filter(([id,entry])=>/^[\w-]+$/.test(id)&&!id.startsWith('__')&&entry&&typeof entry==='object')
            .map(([id,entry])=>[id,{
                ...(typeof entry.pagesRead==='number'&&Number.isFinite(entry.pagesRead)?{pagesRead:entry.pagesRead}:{}),
                ...(typeof entry.lastCfi==='string'?{lastCfi:entry.lastCfi}:{})
            }]));
    }
    return book;
}

function createImportPlan(records,user){
    const rows=[];
    const seenCandidates=[];
    const parent=db.collection('users').doc(user.uid).collection('books');
    let skipped=0;
    for(const raw of records){
        const data=sanitizeImportedBook(raw);
        if(!data){skipped++;continue;}
        const candidate={...data,...(typeof raw.id==='string'&&raw.id?{id:raw.id}:{})};
        const existing=libraryMatch(candidate,allBookRecords);
        if(libraryMatch(candidate,seenCandidates)||(existing&&rows.some(row=>row.existing?.id===existing.id))){
            skipped++;
            continue;
        }
        seenCandidates.push(candidate);
        if(!existing){rows.push({data,ref:parent.doc()});continue;}
        const conflicts=importGroups.flatMap(group=>{
            const changes=Object.fromEntries(group.fields.filter(key=>Object.hasOwn(data,key)&&!dataEquals(existing[key],data[key]))
                .map(key=>[key,data[key]]));
            if(!Object.keys(changes).length)return [];
            const before=Object.fromEntries(group.fields.map(key=>[key,existing[key]??null]));
            const after={...before,...changes};
            if(group.id==='dates'&&after.dateStarted&&after.dateFinished&&after.dateStarted>after.dateFinished)return [];
            return [{...group,before,after,changes}];
        });
        rows.push({existing,data,conflicts,ref:parent.doc(existing.id)});
    }
    return {user,rows,skipped,finished:new Set(),result:{added:0,updated:0,changed:0}};
}

function importLibrary(){
    if(!currentUser)return;
    const user=currentUser;
    const input=document.createElement('input');
    input.type='file';
    input.accept='.json,application/json';
    input.onchange=async()=>{
        const file=input.files[0];
        if(!file)return;
        try{
            const records=JSON.parse(await file.text());
            if(!Array.isArray(records))throw new Error('Invalid backup');
            if(currentUser!==user)return;
            pendingImport=createImportPlan(records,user);
            renderImportPlan();
            openLibraryTools('import');
        }catch(error){
            console.warn(error);
            alert('Не вдалося прочитати файл бібліотеки. Оберіть JSON-експорт «ЧитайКо».');
        }
    };
    input.click();
}

function importSummary(group,data){
    if(group==='dates')return [formatReadingDate(data.dateStarted),formatReadingDate(data.dateFinished)].filter(Boolean).join(' — ')||'Без дат';
    if(group==='notes'){
        const review=typeof data.review==='string'?data.review:'';
        return review?review.slice(0,100)+(review.length>100?'…':''):'Порожня нотатка';
    }
    if(group==='rereads'){
        const entries=Array.isArray(data.rereads)?data.rereads:[];
        return entries.length?entries.map(entry=>formatReadingDate(entry?.finished)).filter(Boolean).join(', '):'Немає';
    }
    return Array.isArray(data.highlights)&&data.highlights.length?data.highlights.length+' записів':'Немає';
}

function importConflictContent(group,data){
    if(group==='notes')return typeof data.review==='string'&&data.review.trim()?data.review:'Порожня нотатка';
    if(group==='quotes'){
        const entries=Array.isArray(data.highlights)?data.highlights:[];
        return entries.map(entry=>entry?.text).filter(text=>typeof text==='string').join('\n\n')||'Немає цитат';
    }
    return importSummary(group,data);
}

function renderImportPlan(){
    const {rows,skipped}=pendingImport;
    const existing=rows.filter(row=>row.existing);
    const newBooks=rows.filter(row=>!row.existing);
    const conflictCount=existing.filter(row=>row.conflicts.length).length;
    const holder=document.getElementById('libraryToolsContent');
    holder.innerHTML=`<form class="import-plan" data-form="import-plan">
        <div class="import-summary"><span>Нові книги <strong>${newBooks.length}</strong></span>
            <span>У бібліотеці або кошику <strong>${existing.length}</strong></span>
            ${skipped?`<span>Повтори або пошкоджені записи <strong>${skipped}</strong></span>`:''}</div>
        ${newBooks.length?`<details><summary>Нові книги</summary><ul>${newBooks.map(row=>
            `<li>${escapeHtml(row.data.title)}${row.data.author?' · '+escapeHtml(row.data.author):''}</li>`).join('')}</ul></details>`:''}
        ${existing.length?`<details ${conflictCount?'open':''}><summary>Збіги з бібліотекою</summary>${rows.map((row,index)=>
            row.existing?`<fieldset><legend>${escapeHtml(row.existing.title)}</legend>
                ${row.existing.title!==row.data.title?`<p class="text-muted">У файлі: ${escapeHtml(row.data.title)}</p>`:''}
                ${row.conflicts.length?row.conflicts.map(group=>
                `<label>${group.label}<select name="conflict-${index}-${group.id}">
                    <option value="keep">Залишити — ${escapeHtml(importSummary(group.id,group.before))}</option>
                    <option value="file">З файлу — ${escapeHtml(importSummary(group.id,group.after))}</option>
                </select></label><details class="import-values"><summary>Порівняти: ${group.label.toLowerCase()}</summary>
                    <div><strong>У бібліотеці</strong><p>${escapeHtml(importConflictContent(group.id,group.before))}</p></div>
                    <div><strong>З файлу</strong><p>${escapeHtml(importConflictContent(group.id,group.after))}</p></div>
                </details>`).join(''):'<p class="text-muted">Запис уже є.</p>'}</fieldset>`:'').join('')}</details>`:''}
        <p class="text-muted" role="status"></p>
        <button type="submit" class="primary-button" ${!newBooks.length&&!conflictCount?'disabled':''}>Імпортувати</button>
    </form>`;
}

function cancelLibraryImport(){
    if(pendingImport?.running)return;
    pendingImport=null;
}

function splitImportWrites(selected){
    const encoder=new TextEncoder();
    const chunks=[];
    let chunk=[],size=0;
    for(const entry of selected){
        const payload=entry.row.existing?entry.groups.map(group=>group.changes):entry.row.data;
        const bytes=encoder.encode(JSON.stringify(payload)).length;
        if(chunk.length&&(chunk.length>=150||size+bytes>4000000)){
            chunks.push(chunk);
            chunk=[];
            size=0;
        }
        chunk.push(entry);
        size+=bytes;
    }
    if(chunk.length)chunks.push(chunk);
    return chunks;
}

async function commitLibraryImport(form){
    const plan=pendingImport;
    if(!plan||plan.running||plan.user!==currentUser)return;
    const choices=new FormData(form);
    const selected=plan.rows.flatMap((row,index)=>{
        if(plan.finished.has(row))return [];
        const groups=(row.conflicts||[]).filter(group=>choices.get(`conflict-${index}-${group.id}`)==='file');
        return row.existing&&!groups.length?[]:[{row,groups}];
    });
    if(!selected.length){form.querySelector('[role=status]').textContent='Обрані дані вже є в бібліотеці.';return;}
    const status=form.querySelector('[role=status]');
    const button=form.querySelector('[type=submit]');
    plan.running=true;
    button.disabled=true;
    try{
        let processed=0;
        for(const chunk of splitImportWrites(selected)){
            if(plan.user!==currentUser)break;
            const summary=await db.runTransaction(async transaction=>{
                const snapshots=await Promise.all(chunk.map(({row})=>transaction.get(row.ref)));
                let added=0,updated=0,changed=0;
                chunk.forEach(({row,groups},index)=>{
                    const snapshot=snapshots[index];
                    if(!row.existing){
                        if(snapshot.exists||libraryMatch(row.data,allBookRecords)){changed++;return;}
                        transaction.set(row.ref,row.data);
                        added++;
                        return;
                    }
                    const latest=snapshot.data();
                    if(!latest){changed++;return;}
                    const changes={};
                    for(const group of groups){
                        if(group.fields.some(key=>!dataEquals(latest[key],group.before[key]))){changed++;continue;}
                        Object.assign(changes,group.changes);
                    }
                    if(Object.keys(changes).length){
                        transaction.update(row.ref,changes);
                        updated++;
                    }
                });
                return {added,updated,changed};
            });
            chunk.forEach(({row})=>plan.finished.add(row));
            for(const key of Object.keys(summary))plan.result[key]+=summary[key];
            processed+=chunk.length;
            status.textContent=`Опрацьовано ${processed} з ${selected.length}.`;
        }
        const {added,updated,changed}=plan.result;
        status.textContent=`Додано ${added}, оновлено ${updated}.${changed?` Пропущено змінені після перегляду записи або поля: ${changed}.`:''}`;
        plan.done=true;
    }catch(error){
        console.warn(error);
        status.textContent='Імпорт перервався. Можна повторити, щоб продовжити з решти записів.';
    }finally{
        plan.running=false;
        button.disabled=Boolean(plan.done);
        if(!form.isConnected||libraryToolsView?.mode!=='import'){
            if(pendingImport===plan)pendingImport=null;
        }
    }
}

// ===== PERSONAL RECOMMENDATIONS =====
const recommendationGenres={
    'Академія магії':{subject:'Fantasy',query:'"magic academy"'},
    'Фентезі':{subject:'Fantasy',query:'fantasy fiction'},
    'Детектив':{subject:'Mystery & Detective',query:'mystery detective novel'},
    'Трилер':{subject:'Thrillers',query:'psychological thriller'},
    'Романтика':{subject:'Romance',query:'romance novel'},
    'Саморозвиток':{subject:'Self-Help',query:'personal growth'},
    'Фантастика':{subject:'Science Fiction',query:'science fiction'}
};
const recommendationLanguageCodes=['uk','en','pl','ru'];
let recommendationFeed;
let dismissedRecommendations=new Set();
let pendingRecommendationDismissals=new Set();

function recommendationKey(title,author){
    return JSON.stringify([normalizeReadingSearch(title),normalizeReadingSearch(author)]);
}

function resetReadingTools(){
    calendarMonth=null;
    pendingImport=null;
    recommendationFeed?.controller.abort();
    recommendationFeed=null;
    dismissedRecommendations=new Set();
    pendingRecommendationDismissals=new Set();
    document.getElementById('recommendationLanguage').value='';
    document.getElementById('recommendationsList').replaceChildren();
}

function applyRecommendationPreferences(profile){
    dismissedRecommendations=new Set(labelNames(profile.dismissedRecommendations));
    for(const name of dismissedRecommendations)pendingRecommendationDismissals.delete(name);
    document.querySelectorAll('.recommendation-card').forEach(card=>{
        if(dismissedRecommendations.has(card.dataset.recommendation))card.remove();
    });
}

function recommendationQueries(category){
    const genres=category==='auto'?Object.values(recommendationGenres):[recommendationGenres[category]];
    const authors=category==='auto'?[...new Set(myLibrary.map(book=>book.author)
        .filter(author=>typeof author==='string'&&author.length>2&&author!=='Невідомий'))]
        .slice(0,4).map(author=>`inauthor:"${author.replace(/"/g,'')}"`):[];
    if(category==='Академія магії')return [genres[0].query+' subject:"Fantasy"'];
    return [...authors,...genres.flatMap(genre=>[`subject:"${genre.subject}"`,`${genre.query} subject:"${genre.subject}"`])];
}

function changeRecommendationLanguage(){
    loadRealRecommendations(recommendationFeed?.category||'auto',recommendationFeed?.button||'rec_auto');
}

function loadRealRecommendations(category='auto',button='rec_auto'){
    if(category!=='auto'&&!Object.hasOwn(recommendationGenres,category))return;
    const selected=document.getElementById('recommendationLanguage').value;
    const language=recommendationLanguageCodes.includes(selected)?selected:'';
    if(recommendationFeed?.category===category&&recommendationFeed.language===language)return;
    recommendationFeed?.controller.abort();
    recommendationFeed={
        category,button,language,queries:recommendationQueries(category),queryIndex:0,startIndex:0,
        seen:new Set(),controller:new AbortController(),loading:false
    };
    document.querySelectorAll('#recTabs .pill').forEach(pill=>{
        const active=pill.id===button;
        pill.className=active?'pill active':'pill inactive';
        pill.setAttribute('aria-pressed',String(active));
    });
    document.getElementById('recommendationsList').replaceChildren();
    return fetchMoreRecommendations();
}

function makeRecommendationCard(item,key){
    const data=item.volumeInfo;
    const book={
        googleId:item.id||'',title:data.title,author:data.authors?.[0]||'Невідомий',
        pagesTotal:data.pageCount||300,image:(data.imageLinks?.thumbnail||'').replace(/^http:\/\//i,'https://'),
        description:data.description.replace(/<[^>]*>/g,''),genre:data.categories?.[0]||'',
        publishedDate:data.publishedDate||'',identifiers:(data.industryIdentifiers||[]).map(entry=>entry.identifier).filter(Boolean)
    };
    const card=document.createElement('article');
    card.className='card recommendation-card fade-in';
    card.dataset.recommendation=key;
    const open=document.createElement('button');
    open.type='button';
    open.className='recommendation-open';
    open.setAttribute('aria-label','Відкрити: '+book.title);
    open.innerHTML=`<img loading="lazy" decoding="async" src="${bookCover(book.image)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
        <span class="min-w-0"><strong class="block">${escapeHtml(book.title)}</strong>
            <span class="text-muted block text-xs">${escapeHtml(book.author)}</span>
            <span class="text-muted line-clamp-2 text-xs">${escapeHtml(book.description)}</span></span>`;
    open.addEventListener('click',()=>showBookDetails(book,true));
    const dismiss=document.createElement('button');
    dismiss.type='button';
    dismiss.className='recommendation-dismiss';
    dismiss.textContent='Не цікавить';
    dismiss.setAttribute('aria-label','Не цікавить: '+book.title);
    dismiss.addEventListener('click',()=>dismissRecommendation(key,card));
    card.append(open,dismiss);
    return card;
}

async function dismissRecommendation(key,card){
    if(!currentUser||pendingRecommendationDismissals.has(key))return;
    const user=currentUser;
    const feed=recommendationFeed;
    const container=card.parentElement;
    const next=card.nextSibling;
    pendingRecommendationDismissals.add(key);
    card.remove();
    if(container.querySelectorAll('.recommendation-card').length<4)fetchMoreRecommendations();
    try{
        await db.collection('users').doc(user.uid).set({
            dismissedRecommendations:firebase.firestore.FieldValue.arrayUnion(key)
        },{merge:true});
        if(currentUser===user){
            pendingRecommendationDismissals.delete(key);
            dismissedRecommendations.add(key);
        }
    }catch(error){
        if(currentUser===user){
            pendingRecommendationDismissals.delete(key);
            if(recommendationFeed===feed){
                document.getElementById('recommendationEmpty')?.remove();
                container.insertBefore(card,next?.parentElement===container?next:null);
            }
            showWriteError(error);
        }
    }
}

async function fetchMoreRecommendations(){
    const feed=recommendationFeed;
    if(!feed||feed.loading||feed.queryIndex>=feed.queries.length)return;
    feed.loading=true;
    const list=document.getElementById('recommendationsList');
    document.getElementById('recommendationEmpty')?.remove();
    const status=document.createElement('p');
    status.className='recommendation-status text-muted';
    status.textContent='Шукаємо книги…';
    list.append(status);
    const newCards=[];
    let attempts=0;
    let failed=false;
    const existingTitles=new Set(allBookRecords.map(book=>normalizeReadingSearch(book.title)));
    try{
        while(newCards.length<5&&feed.queryIndex<feed.queries.length&&attempts<4){
            const params=new URLSearchParams({key:googleBooksKey,q:feed.queries[feed.queryIndex],printType:'books',
                maxResults:'40',startIndex:String(feed.startIndex)});
            if(feed.language)params.set('langRestrict',feed.language);
            attempts++;
            let items;
            try{
                const response=await catalogResponse(`https://www.googleapis.com/books/v1/volumes?${params}`,feed.controller.signal);
                items=Array.isArray(response.items)?response.items:[];
            }catch{
                if(feed!==recommendationFeed)return;
                failed=true;
                feed.queryIndex++;
                feed.startIndex=0;
                continue;
            }
            if(feed!==recommendationFeed)return;
            if(items.length===40)feed.startIndex+=40;
            else{feed.queryIndex++;feed.startIndex=0;}
            for(const item of items){
                const book=item?.volumeInfo;
                if(typeof book?.title!=='string'||typeof book.description!=='string'||book.description.length<20||
                    (book.pageCount>0&&book.pageCount<40)||existingTitles.has(normalizeReadingSearch(book.title)))continue;
                if(feed.language&&book.language&&book.language!==feed.language)continue;
                const key=recommendationKey(book.title,book.authors?.[0]||'Невідомий');
                if(feed.seen.has(key)||dismissedRecommendations.has(key)||pendingRecommendationDismissals.has(key))continue;
                feed.seen.add(key);
                newCards.push(makeRecommendationCard(item,key));
            }
        }
        if(feed!==recommendationFeed)return;
        list.append(...newCards.filter(card=>!dismissedRecommendations.has(card.dataset.recommendation)&&
            !pendingRecommendationDismissals.has(card.dataset.recommendation)));
        if(!list.querySelector('.recommendation-card')){
            const empty=document.createElement('div');
            empty.id='recommendationEmpty';
            empty.className='recommendation-status text-muted';
            empty.textContent=failed?'Деякі запити до каталогу не відповіли.':'За цими фільтрами книги поки не знайдено.';
            if(feed.queryIndex<feed.queries.length){
                const next=document.createElement('button');
                next.type='button';
                next.className='secondary-button';
                next.textContent='Шукати ще';
                next.addEventListener('click',fetchMoreRecommendations);
                empty.append(next);
            }
            list.append(empty);
        }
    }finally{
        status.remove();
        feed.loading=false;
    }
}
