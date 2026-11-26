// ===== READING HISTORY AND REMINDERS =====
const monthFormatter=new Intl.DateTimeFormat('uk-UA',{month:'long',timeZone:'UTC'});
let calendarMonth;
let pendingImport;
let readingHistories=new Map();
let readingWorks=[];
let repeatedReadingRecords=[];

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
    return readingWorks.flatMap(book=>[
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
    if(libraryToolsView.mode==='recommendation-settings'){
        document.getElementById('libraryToolsTitle').textContent='Мої жанри';
        return true;
    }
    if(libraryToolsView.mode==='duplicates'){
        document.getElementById('libraryToolsTitle').textContent='Повторні записи';
        previewDuplicateBooks();
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

// Match by identifiers or by title and author, including separate editions of a work.
function groupBookRecords(records){
    const groups=[];
    for(const record of records){
        const matching=groups.filter(group=>libraryMatch(record,group));
        if(!matching.length){groups.push([record]);continue;}
        matching[0].push(record);
        for(const other of matching.slice(1)){
            matching[0].push(...other);
            groups.splice(groups.indexOf(other),1);
        }
    }
    return groups;
}

function readingStartsByCompletion(books){
    const completed=new Map();
    for(const book of books){
        const entries=[{started:book.dateStarted,finished:book.dateFinished},...rereads(book)];
        for(const entry of entries){
            const finished=dateValue(entry.finished);
            if(!finished)continue;
            const started=dateValue(entry.started);
            if(!completed.has(finished))completed.set(finished,new Set());
            if(started&&started<=finished)completed.get(finished).add(started);
        }
    }
    return [...completed].sort(([a],[b])=>a.localeCompare(b));
}

function combinedReadingHistory(books){
    const sessions=readingStartsByCompletion(books).flatMap(([finished,dates])=>{
        const starts=[...dates].sort();
        return (starts.length?starts:[null]).map(started=>({started,finished}));
    });
    const first=sessions.shift();
    return {
        dateStarted:first?first.started:books.map(book=>dateValue(book.dateStarted)).find(Boolean)||null,
        dateFinished:first?.finished||null,
        rereads:sessions
    };
}

function combinedBookData(primary,others){
    const books=[primary,...others];
    const merged={...primary,...combinedReadingHistory(books)};
    for(const field of ['image','description','googleId','source','genre','publishedDate','author','rating','pagesTotal','rereadReminderMonth']){
        if(!merged[field]){
            const value=others.find(book=>book[field])?.[field];
            if(value!==undefined)merged[field]=value;
        }
    }
    for(const field of ['tags','shelves','shelfIds','identifiers']){
        const values=[...new Set(books.flatMap(book=>labelNames(book[field])))];
        if(values.length)merged[field]=values;
    }
    const notes=[...new Set(books.map(book=>book.review).filter(note=>typeof note==='string'&&note.trim()))];
    const noteBoundary='\n\n';
    const distinctNotes=notes.filter(note=>!notes.some(other=>other!==note&&
        (noteBoundary+other+noteBoundary).includes(noteBoundary+note+noteBoundary)));
    if(distinctNotes.length)merged.review=distinctNotes.join(noteBoundary);
    const quotes=books.flatMap(book=>Array.isArray(book.highlights)?book.highlights:[]);
    if(quotes.length)merged.highlights=quotes.filter((quote,index)=>quotes.findIndex(other=>dataEquals(quote,other))===index);
    if(books.some(book=>book.favorite===true))merged.favorite=true;
    if(books.some(book=>book.timeSpent))merged.timeSpent=Math.max(...books.map(book=>Number(book.timeSpent)||0));
    const active=books.find(book=>book.activeReread);
    if(active){
        merged.activeReread=active.activeReread;
        merged.rereadProgress=Object.assign({},...books.slice().reverse().map(book=>book.rereadProgress));
        merged.status='reading';
    }else if(books.some(isCompleted))merged.status='finished';
    else if(books.some(book=>book.status==='reading'))merged.status='reading';
    if(!localEpubIds.has(primary.id)&&!primary.lastCfi&&books.some(book=>book.pagesRead)){
        merged.pagesRead=Math.max(...books.map(book=>Number(book.pagesRead)||0));
    }
    return merged;
}

function createImportPlan(records,user){
    const rows=[];
    const parent=db.collection('users').doc(user.uid).collection('books');
    const archiveIds=new Set(records.filter(raw=>raw&&typeof raw.title==='string'&&raw.title.trim()).map(raw=>raw.id));
    const candidates=[],archives=[];
    let skipped=0,combined=0;
    for(const raw of records){
        const data=sanitizeImportedBook(raw);
        if(!data){skipped++;continue;}
        const id=typeof raw.id==='string'&&/^[\w-]{1,200}$/.test(raw.id)&&!/^__.*__$/.test(raw.id)?raw.id:undefined;
        if(id&&isBookTrashed(data)&&archiveIds.has(raw.mergedInto)){
            archives.push({...data,id,mergedInto:raw.mergedInto});
        }else candidates.push({...data,...(id?{id}:{})});
    }
    const existingRecords=allBookRecords.filter(book=>!isBookTrashed(book)||!book.mergedInto);
    const importedIds=new Map();
    for(const group of groupBookRecords(candidates)){
        combined+=group.length-1;
        const [first,...others]=group.slice().sort((a,b)=>Number(isBookTrashed(a))-Number(isBookTrashed(b)));
        const {id,...data}=others.length?combinedBookData(first,others):first;
        const existing=group.map(book=>libraryMatch(book,existingRecords)).filter(Boolean)
            .sort((a,b)=>Number(isBookTrashed(a))-Number(isBookTrashed(b)))[0];
        const ref=parent.doc(existing?.id||id);
        for(const item of group){if(item.id)importedIds.set(item.id,ref.id);}
        if(!existing){rows.push({data,ref});continue;}
        let groups=importGroups;
        const history=combinedReadingHistory([existing,...group]);
        const hasNewDates=completionDates(history).some(date=>!completionDates(existing).includes(date))||
            (others.length>0&&completionDates(history).length>completionDates(existing).length);
        if(hasNewDates){
            Object.assign(data,history);
            if(history.dateFinished&&existing.status==='planned')data.status='finished';
            groups=[{id:'history',label:'Усі дати читання',fields:['dateStarted','dateFinished','rereads','status'],combine:true},
                ...groups.filter(group=>group.id!=='dates'&&group.id!=='rereads')];
        }
        if(others.length){
            const merged=combinedBookData(existing,group);
            for(const key of ['review','highlights']){
                if(Object.hasOwn(merged,key))data[key]=merged[key];
            }
        }
        const conflicts=groups.flatMap(group=>{
            const changes=Object.fromEntries(group.fields.filter(key=>Object.hasOwn(data,key)&&!dataEquals(existing[key],data[key]))
                .map(key=>[key,data[key]]));
            if(!Object.keys(changes).length)return [];
            const before=Object.fromEntries(group.fields.map(key=>[key,existing[key]??null]));
            const after={...before,...changes};
            if(group.id==='dates'&&after.dateStarted&&after.dateFinished&&after.dateStarted>after.dateFinished)return [];
            return [{...group,before,after,changes}];
        });
        rows.push({existing,data,conflicts,ref});
    }
    const addedArchives=new Set();
    for(const {id,mergedInto,...data} of archives){
        if(allBookRecords.some(book=>book.id===id)||addedArchives.has(id))continue;
        const parentId=importedIds.get(mergedInto);
        if(!parentId){skipped++;continue;}
        addedArchives.add(id);
        rows.push({data:{...data,mergedInto:parentId},ref:parent.doc(id),archive:true});
    }
    return {user,rows,skipped,combined,finished:new Set(),result:{added:0,updated:0,changed:0}};
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
    if(group==='history'){
        return [importSummary('dates',data),...rereads(data).map(entry=>[formatReadingDate(entry.started),formatReadingDate(entry.finished)].filter(Boolean).join(' — '))].join(' · ');
    }
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
    const {rows,skipped,combined}=pendingImport;
    const existing=rows.filter(row=>row.existing);
    const newBooks=rows.filter(row=>!row.existing&&!row.archive);
    const newArchives=rows.filter(row=>row.archive).length;
    const conflictCount=existing.filter(row=>row.conflicts.length).length;
    const holder=document.getElementById('libraryToolsContent');
    holder.innerHTML=`<form class="import-plan" data-form="import-plan">
        <div class="import-summary"><span>Нові книги <strong>${newBooks.length}</strong></span>
            <span>У бібліотеці або кошику <strong>${existing.length}</strong></span>
            ${newArchives?`<span>Записи для кошика <strong>${newArchives}</strong></span>`:''}
            ${combined?`<span>Об’єднані повтори <strong>${combined}</strong></span>`:''}
            ${skipped?`<span>Пропущені записи <strong>${skipped}</strong></span>`:''}</div>
        ${newBooks.length?`<details><summary>Нові книги</summary><ul>${newBooks.map(row=>
            `<li>${escapeHtml(row.data.title)}${row.data.author?' · '+escapeHtml(row.data.author):''}</li>`).join('')}</ul></details>`:''}
        ${existing.length?`<details ${conflictCount?'open':''}><summary>Збіги з бібліотекою</summary>${rows.map((row,index)=>
            row.existing?`<fieldset><legend>${escapeHtml(row.existing.title)}</legend>
                ${row.existing.title!==row.data.title?`<p class="text-muted">У файлі: ${escapeHtml(row.data.title)}</p>`:''}
                ${row.conflicts.length?row.conflicts.map(group=>
                `<label>${group.label}<select name="conflict-${index}-${group.id}">
                    <option value="keep">Залишити — ${escapeHtml(importSummary(group.id,group.before))}</option>
                    <option value="file" ${group.combine?'selected':''}>${group.combine?'Доповнити історію':'З файлу'} — ${escapeHtml(importSummary(group.id,group.after))}</option>
                </select></label><details class="import-values"><summary>Порівняти: ${group.label.toLowerCase()}</summary>
                    <div><strong>У бібліотеці</strong><p>${escapeHtml(importConflictContent(group.id,group.before))}</p></div>
                    <div><strong>${group.combine?'Після об’єднання':'З файлу'}</strong><p>${escapeHtml(importConflictContent(group.id,group.after))}</p></div>
                </details>`).join(''):'<p class="text-muted">Запис уже є.</p>'}</fieldset>`:'').join('')}</details>`:''}
        <p class="text-muted" role="status"></p>
        <button type="submit" class="primary-button" ${!newBooks.length&&!newArchives&&!conflictCount?'disabled':''}>Імпортувати</button>
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
                        if(snapshot.exists||(!row.archive&&libraryMatch(row.data,allBookRecords.filter(book=>!book.mergedInto)))){changed++;return;}
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

// Reading history joins dated sessions for display without changing any source record.
function groupReadingRecords(books){
    const byKey=new Map();
    const groups=new Set();
    for(const book of books){
        const keys=['record:'+book.id,...bookIsbns(book).map(isbn=>'isbn:'+isbn)];
        if(book.mergedInto)keys.push('record:'+book.mergedInto);
        if(book.googleId)keys.push('catalog:'+book.googleId);
        const work=bookWorkKey(book);
        if(work)keys.push('work:'+work);
        const matches=[...new Set(keys.map(key=>byKey.get(key)).filter(Boolean))];
        const group=matches.shift()||{books:[],keys:new Set()};
        group.books.push(book);
        for(const match of matches){
            group.books.push(...match.books);
            for(const key of match.keys){group.keys.add(key);byKey.set(key,group);}
            groups.delete(match);
        }
        for(const key of keys){group.keys.add(key);byKey.set(key,group);}
        groups.add(group);
    }
    return [...groups].map(group=>group.books);
}

function readingHistoryForDisplay(books){
    const sessions=readingStartsByCompletion(books).map(([finished,dates])=>{
        const starts=[...dates].sort();
        return {started:starts[0]||null,startedDates:starts,finished};
    });
    const first=sessions.shift();
    const otherStarts=[...new Set(books.filter(book=>!dateValue(book.dateFinished))
        .map(book=>dateValue(book.dateStarted)).filter(Boolean))].sort();
    const dateStarted=first?first.started:otherStarts.shift()||null;
    const includedStarts=new Set([...(first?.startedDates||[]),...sessions.flatMap(entry=>entry.startedDates)]);
    return {
        dateStarted,dateFinished:first?.finished||null,startedDates:first?.startedDates||[],
        rereads:sessions,otherStarts:otherStarts.filter(date=>!includedStarts.has(date)),
        recordCount:books.length
    };
}

function indexReadingHistories(books){
    readingHistories=new Map();
    const groups=groupReadingRecords(books);
    repeatedReadingRecords=groups.filter(group=>group.length>1);
    readingWorks=groups.map(group=>{
        const history={...readingHistoryForDisplay(group),records:group};
        for(const book of group)readingHistories.set(book.id,history);
        const representative=group.find(isCompleted)||group[0];
        return {...representative,...history};
    });
}

function readingHistoryForCard(book){
    return readingHistories.get(book.id)||book;
}

function readingDatesForCard(book){
    return completionDates(readingHistoryForCard(book));
}

function finishedReadingCards(books,year=''){
    const groups=new Map();
    for(const book of books){
        const history=readingHistoryForCard(book);
        if(!groups.has(history))groups.set(history,[]);
        groups.get(history).push(book);
    }
    return [...groups].flatMap(([history,records])=>{
        const dates=completionDates(history).filter(date=>!year||date.startsWith(year));
        if(!dates.length)return year?[]:[{book:records[0],date:''}];
        if((history.recordCount||1)<=1)return [{book:records[0],date:dates.at(-1)}];

        // Prefer the record whose own completion matches the card before falling back to a saved reread.
        const primaryByDate=new Map(records.filter(book=>dateValue(book.dateFinished)).map(book=>[book.dateFinished,book]));
        const reserved=new Set(primaryByDate.values());
        return dates.map(date=>{
            const book=primaryByDate.get(date)||records.find(record=>!reserved.has(record)&&completionDates(record).includes(date))||
                records.find(record=>completionDates(record).includes(date))||records[0];
            reserved.add(book);
            return {book,date,sessionLabel:date===history.dateFinished?'Перше читання':'Перечитування'};
        });
    });
}

function previewDuplicateBooks(){
    const groups=repeatedReadingRecords;
    document.getElementById('libraryToolsContent').innerHTML=groups.length?
        `<div class="import-plan duplicate-plan">
            <p class="text-muted">Картка кожного запису показує всі дати читання цієї книжки. Нотатки й цитати зберігаються у відповідних записах.</p>
            ${groups.map(([primary,...others])=>{
                const history=readingHistoryForCard(primary);
                return `<details><summary>${escapeHtml(primary.title)} · ${others.length+1} записи</summary>
                    <p>${escapeHtml(importSummary('history',history))}</p>
                    <div class="tool-list">${[primary,...others].map(book=>actionButton('calendar-book',
                        escapeHtml(book.title)+' · '+escapeHtml(firstReadingDates(book)),'',book.id)).join('')}</div>
                </details>`;
            }).join('')}
        </div>`:'<p class="text-muted">У бібліотеці немає записів зі збігом за ідентифікаторами або за назвою й автором.</p>';
}

// ===== PERSONAL RECOMMENDATIONS =====
const recommendationGenres={
    'Роментезі':{id:'romantasy',subject:'Romance fantasy',uk:['романтичне фентезі','Четверте крило','Двір шипів і троянд','Жорстокий принц'],ru:['романтическое фэнтези','Четвертое крыло','Двор шипов и роз']},
    'Попаданці':{id:'portal'},
    'Фентезі':{id:'fantasy',subject:'Fantasy',uk:['фентезі пригоди','Гобіт'],ru:['фэнтези приключения','Ведьмак']},
    'Романтика':{id:'romance',subject:'Romance',uk:['любовний роман','Гіпотеза кохання'],ru:['любовный роман','Гипотеза любви']},
    'Детектив':{id:'detective',subject:'Mystery and detective fiction',uk:['детектив роман','Убивство у Східному експресі'],ru:['детектив роман','Убийство в Восточном экспрессе']},
    'Трилер':{id:'thriller',subject:'Thrillers',uk:['психологічний трилер','Мовчазна пацієнтка'],ru:['психологический триллер','Безмолвный пациент']},
    'Академія магії':{id:'magic',subject:'Schools of magic',uk:['академія магії фентезі','Смертельна освіта'],ru:['магическая академия','Смертельное образование']},
    'Саморозвиток':{id:'self',subject:'Self-help',uk:['саморозвиток','Атомні звички'],ru:['саморазвитие','Атомные привычки']},
    'Фантастика':{id:'scifi',subject:'Science fiction',uk:['наукова фантастика','Марсіянин'],ru:['научная фантастика','Марсианин']}
};
// Local editions with the premise verified against publisher or catalog descriptions.
const portalFantasyPicks={
    uk:[
        {title:'Чужоземка',author:'Діана Ґеблдон',isbn:'9786175484845',pagesTotal:736,source:'BookChef',
            image:'https://bookchef.ua/storage/products/5578/photo/main.jpg',
            description:'Колишня військова медсестра Клер проходить крізь коло каменів і опиняється у Шотландії XVIII століття.'},
        {title:'Що знає вітер',author:'Емі Гармон',isbn:'9789669822369',pagesTotal:448,source:'Vivat',
            image:'https://vivat.com.ua/storage/1.d/import/media/6/2a2974bf4b0deef063e9084bf6fd34c6.jpg',
            description:'На ірландському озері Енн Ґаллагер переноситься з 2001 року в 1921-й, де зустрічає свого дідуся дитиною.'},
        {title:'Десять тисяч дверей Дженьєрі',author:'Алікс І. Герроу',isbn:'9786171702431',pagesTotal:416,source:'Vivat',
            image:'https://vivat.com.ua/storage/1.d/files/4/7/477e1672_fab8b7228f784f2128c95958033f091f.jpg',
            description:'Дженьєрі знаходить двері до інших світів і дізнається, як ці переходи пов’язані з історією її родини.'},
        {title:'Кораліна',author:'Ніл Ґейман',isbn:'9789669484352',pagesTotal:190,source:'КМ-Букс',
            image:'https://laboratory.ua/files/products/1566.330x300.jpg.webp',
            description:'Кораліна відчиняє потаємні двері та потрапляє в моторошну копію власного дому.'},
        {title:'Аліса в Задзеркальній країні',author:'Льюїс Керрол',googleId:'HSRtEAAAQBAJ',pagesTotal:138,source:'Google Books',
            description:'Аліса проходить крізь дзеркало й опиняється у світі, де її мандрівка перетворюється на шахову партію.'}
    ],
    ru:[
        {title:'Улыбнись мне, Артур Эдинброг',author:'Антонина Крейн',isbn:'9785045332965',googleId:'8ZsxEQAAQBAJ',pagesTotal:353,source:'Google Books',
            description:'Искусствоведка Виолетта переносится в мир Гало и становится фамильяром студента-колдуна.'},
        {title:'Попаданка за пять монет',author:'Лидия Миленина',isbn:'9785045059794',googleId:'n58xEQAAQBAJ',pagesTotal:426,source:'Google Books',
            description:'Студентка Аня участвует в эксперименте профессора и оказывается в мире, которому грозит гибель.'},
        {title:'Рубиновая книга',author:'Керстин Гир',isbn:'9785457536128',googleId:'fkSrAgAAQBAJ',pagesTotal:304,source:'Google Books',
            description:'Шестнадцатилетняя Гвендолин обнаруживает, что может перемещаться в прошлое, и узнаёт о тайном обществе путешественников во времени.'},
        {title:'Чужестранка. Книга 1. Восхождение к любви',author:'Диана Гэблдон',isbn:'9785042779121',googleId:'wl0UEAAAQBAJ',pagesTotal:575,source:'Google Books',
            description:'Медсестра Клэр переносится из XX века в Шотландию XVIII столетия и оказывается среди враждующих кланов.'}
    ]
};
const portalFantasySearches={
    uk:['героїня потрапляє в інший світ фентезі','дівчина прокинулася в іншому світі роман','героїня переноситься в минуле роман'],
    ru:['героиня попадает в другой мир фэнтези','девушка очнулась в другом мире роман','героиня переносится в прошлое роман']
};
const portalSynopsisRules={
    uk:{
        heroine:/(?:^|[^\p{L}])(?:героїня|дівчина|дівчинка|студентка|жінка|вона|яка|котра)(?!\p{L})/iu,
        transfer:/потрап(?:ляє|ила|ить)|опин(?:яється|илася|илась)|перен(?:оситься|еслася|еслась|осить|есло)|прокинулася|отямилася|відкинуло|проходить|пройшла/iu,
        feminine:/потрапила|опинила|перенесла|прокинулася|отямилася|пройшла/iu,
        destination:/(?:в|у|до)\s+(?:(?:інш\p{L}*|паралельн\p{L}*|чуж\p{L}*|магічн\p{L}*|фантастичн\p{L}*)\s+світ\p{L}*|минул\p{L}*|майбутн\p{L}*|інш\p{L}*\s+(?:епох\p{L}*|тіл\p{L}*))/iu
    },
    ru:{
        heroine:/(?:^|[^\p{L}])(?:героиня|девушка|девочка|студентка|женщина|она|которая)(?!\p{L})/iu,
        transfer:/попад(?:ает|ёт)|попала|оказывается|оказалась|перен(?:осится|еслась|осит|есло)|очнулась|проснулась|проходит|прошла/iu,
        feminine:/попала|оказалась|перенеслась|очнулась|проснулась|прошла/iu,
        destination:/(?:в|во)\s+(?:(?:друг\p{L}*|параллельн\p{L}*|чуж\p{L}*|магическ\p{L}*|фантастическ\p{L}*)\s+мир\p{L}*|прошл\p{L}*|будущ\p{L}*|друг\p{L}*\s+(?:эпох\p{L}*|тел\p{L}*))/iu
    }
};

function matchesPortalSynopsis(description,language){
    const rules=portalSynopsisRules[language];
    if(!rules)return false;
    return normalizeReadingSearch(description).split(/[.!?;…]+|,\s+(?:який|котрий|который)\s+/u).some(sentence=>{
        const movement=rules.transfer.exec(sentence);
        if(!movement)return false;
        const before=sentence.slice(Math.max(0,movement.index-80),movement.index);
        const after=sentence.slice(movement.index+movement[0].length,movement.index+movement[0].length+65);
        return rules.destination.test(after)&&(rules.heroine.test(before)||rules.feminine.test(movement[0]));
    });
}

const recommendationLanguageCodes={uk:'ukr',ru:'rus'};
const recommendationLanguageLabels={uk:'Українська',ru:'Російська'};
let recommendationFeed;
let dismissedRecommendations=new Set();
let localRecommendationDismissals=new Set();
let recommendationPreferences={language:'',genres:Object.keys(recommendationGenres)};
let recommendationPreferenceOverride;
let recommendationPager;
const recommendationIcons={auto:"✦",romantasy:"♡",portal:"↪",fantasy:"⚔",romance:"♥",detective:"⌕",thriller:"◈",magic:"☾",self:"↗",scifi:"✧"};

function recommendationKey(title,author){
    return JSON.stringify([normalizeReadingSearch(title),normalizeReadingSearch(author)]);
}

function cleanRecommendationPreferences(raw){
    const selected=Array.isArray(raw?.genres)?raw.genres:[];
    const genres=Object.keys(recommendationGenres).filter(genre=>selected.includes(genre));
    return {language:Object.hasOwn(recommendationLanguageCodes,raw?.language)?raw.language:'',
        genres:genres.length?genres:Object.keys(recommendationGenres)};
}

function resetReadingTools(){
    calendarMonth=null;
    pendingImport=null;
    readingHistories=new Map();
    readingWorks=[];
    repeatedReadingRecords=[];
    recommendationFeed?.controller.abort();
    recommendationFeed=null;
    recommendationPager?.disconnect();
    let cached,legacyPreferences;
    try{
        if(currentUser){
            cached=JSON.parse(localStorage.getItem('recommendationState_'+currentUser.uid));
            legacyPreferences=JSON.parse(localStorage.getItem('recommendations_'+currentUser.uid));
        }
    }catch{}
    recommendationPreferenceOverride=cached?.override?cleanRecommendationPreferences(cached.preferences):null;
    recommendationPreferences=cleanRecommendationPreferences(cached?.preferences||legacyPreferences);
    localRecommendationDismissals=new Set(labelNames(cached?.dismissed));
    dismissedRecommendations=new Set(localRecommendationDismissals);
    document.getElementById('recommendationsList').replaceChildren();
    document.getElementById('recommendationMore').replaceChildren();
    renderRecommendationControls();
}

function renderRecommendationControls(category='auto'){
    document.getElementById('recommendationLanguage').value=recommendationPreferences.language;
    const tabs=document.getElementById('recTabs');
    const buttons=[['auto','Для вас'],...recommendationPreferences.genres.map(genre=>[genre,genre])];
    const key=JSON.stringify(buttons);
    if(tabs.dataset.key!==key){
        const scrollLeft=tabs.scrollLeft;
        tabs.dataset.key=key;
        tabs.replaceChildren(...buttons.map(([value,label])=>{
            const id=value==='auto'?'auto':recommendationGenres[value].id;
            const button=document.createElement('button');
            button.type='button';
            button.id='rec_'+id;
            button.dataset.genre=value;
            button.className='pill';
            const icon=document.createElement('span');
            icon.setAttribute('aria-hidden','true');
            icon.textContent=recommendationIcons[id];
            button.append(icon,document.createTextNode(label));
            button.addEventListener('click',()=>loadRealRecommendations(value));
            return button;
        }));
        tabs.scrollLeft=scrollLeft;
    }
    document.getElementById('portalGenreSummary').hidden=category!=='Попаданці';
    for(const button of tabs.children){
        const active=button.dataset.genre===category;
        button.classList.toggle('active',active);
        button.classList.toggle('inactive',!active);
        button.setAttribute('aria-pressed',String(active));
    }
}

function renderRecommendationSettings(){
    document.getElementById('libraryToolsContent').innerHTML=`<form class="recommendation-settings" data-form="recommendation-settings">
        <p class="text-muted">Виберіть жанри для стрічки «Для вас» і вкладок у порадах.</p>
        <div>${Object.keys(recommendationGenres).map(genre=>
            `<label><input type="checkbox" name="genre" value="${genre}" ${recommendationPreferences.genres.includes(genre)?'checked':''}>
                <span aria-hidden="true">${recommendationIcons[recommendationGenres[genre].id]}</span> ${genre}</label>`).join('')}</div>
        <p class="text-muted" role="status"></p><button type="submit" class="primary-button">Зберегти жанри</button>
    </form>`;
}

function setRecommendationPreferences(preferences){
    recommendationPreferences=cleanRecommendationPreferences(preferences);
    const category=recommendationFeed?.category||'auto';
    if(currentTab==='discover')loadRealRecommendations(category);
    else renderRecommendationControls(category);
}

function storeRecommendationState(user){
    try{
        localStorage.setItem('recommendationState_'+user.uid,JSON.stringify({
            preferences:recommendationPreferences,override:Boolean(recommendationPreferenceOverride),
            dismissed:[...localRecommendationDismissals]
        }));
        return true;
    }catch{return false;}
}

async function syncRecommendationState(user,fields,savedLocally){
    try{
        await db.collection('users').doc(user.uid).set(fields,{merge:true});
        return true;
    }catch(error){
        if(!savedLocally&&currentUser===user)showWriteError(error);
        return false;
    }
}

function persistRecommendationPreferences(preferences){
    const user=currentUser;
    const override=cleanRecommendationPreferences(preferences);
    recommendationPreferenceOverride=override;
    setRecommendationPreferences(override);
    if(!user)return;
    const savedLocally=storeRecommendationState(user);
    return syncRecommendationState(user,{recommendationPreferences:override},savedLocally).then(saved=>{
        if(saved&&currentUser===user&&recommendationPreferenceOverride===override){
            recommendationPreferenceOverride=null;
            storeRecommendationState(user);
        }
    });
}

function saveRecommendationGenres(form){
    const genres=new FormData(form).getAll('genre');
    if(!genres.length){form.querySelector('[role=status]').textContent='Оберіть хоча б один жанр.';return;}
    persistRecommendationPreferences({...recommendationPreferences,genres});
    closeLibraryTools();
}

function applyRecommendationPreferences(profile,snapshot){
    const cloudDismissals=labelNames(profile.dismissedRecommendations);
    dismissedRecommendations=new Set([...localRecommendationDismissals,...cloudDismissals]);
    document.querySelectorAll('.recommendation-card').forEach(card=>{
        if(dismissedRecommendations.has(card.dataset.recommendation))card.remove();
    });
    if(profile.recommendationPreferences){
        const cloud=cleanRecommendationPreferences(profile.recommendationPreferences);
        if(recommendationPreferenceOverride&&dataEquals(recommendationPreferenceOverride,cloud)&&
            !snapshot?.metadata?.hasPendingWrites&&!snapshot?.metadata?.fromCache){
            recommendationPreferenceOverride=null;
        }
        if(!recommendationPreferenceOverride)setRecommendationPreferences(cloud);
    }
    if(currentUser)storeRecommendationState(currentUser);
}

function changeRecommendationLanguage(){
    persistRecommendationPreferences({...recommendationPreferences,language:document.getElementById('recommendationLanguage').value});
}

function recommendationQueries(category,language){
    const genres=category==='auto'?recommendationPreferences.genres:[category];
    const languages=language?[language]:Object.keys(recommendationLanguageCodes);
    const perGenre=genres.map((name,genreIndex)=>{
        const genre=recommendationGenres[name];
        const codes=genreIndex%2?languages.slice().reverse():languages;
        if(genre.id==='portal'){
            return [...codes.map(language=>({source:'portal-picks',language})),
                ...portalFantasySearches.uk.flatMap((_,index)=>codes.map(language=>({
                    source:'google',language,query:portalFantasySearches[language][index],portal:true
                })))];
        }
        const terms=codes.map(code=>{
            const [keyword,...titles]=genre[code];
            const searches=[{query:keyword,subject:genre.subject},...titles.map(title=>({query:title,title}))];
            return searches;
        });
        const queries=[];
        const maxTerms=Math.max(...terms.map(searches=>searches.length));
        for(let index=0;index<maxTerms;index++){
            codes.forEach((language,codeIndex)=>{
                const search=terms[codeIndex][index];
                if(!search)return;
                const google={source:'google',language,query:search.query,title:search.title};
                const open={source:'openlibrary',language,title:search.title,
                    query:search.title?'title:"'+search.title+'"':'subject:"'+search.subject+'"'};
                queries.push(...(genreIndex%3===2?[open,google]:[google,open]));
            });
        }
        return queries;
    });
    const maxQueries=Math.max(...perGenre.map(queries=>queries.length));
    return Array.from({length:maxQueries},(_,index)=>perGenre.map(queries=>queries[index]).filter(Boolean)).flat();
}

function loadRealRecommendations(category='auto'){
    if(category!=='auto'&&!recommendationPreferences.genres.includes(category))category='auto';
    const {language,genres}=recommendationPreferences;
    const key=JSON.stringify([category,language,category==='auto'?genres:[]]);
    renderRecommendationControls(category);
    if(recommendationFeed?.key===key)return;
    recommendationFeed?.controller.abort();
    recommendationFeed={
        key,category,language,queries:recommendationQueries(category,language),queryIndex:0,
        failedQueries:[],emptyBatches:0,seen:new Set(),controller:new AbortController(),loading:false
    };
    document.getElementById('recommendationsList').replaceChildren();
    return fetchMoreRecommendations();
}

function recommendationTitleIsBook(title){
    return !/^(Мир фантастики|Навигатор игрового мира)(?:[\s№]|$)/iu.test(title);
}

async function queryRecommendationCatalog({source,language,query,title,portal,page=1},signal){
    if(source==='portal-picks'){
        const books=portalFantasyPicks[language].map(({isbn,...book})=>({
            ...book,language,genre:'Попаданці',identifiers:isbn?[isbn]:[],
            image:book.image||`https://books.google.com/books/content?id=${book.googleId}&printsec=frontcover&img=1&zoom=1`
        }));
        return {books,hasMore:false};
    }
    const matchTitle=value=>!title||bookIdentity(value).includes(bookIdentity(title));
    if(source==='google'){
        const params=new URLSearchParams({key:googleBooksKey,q:query,printType:'books',langRestrict:language,maxResults:'24',startIndex:String((page-1)*24)});
        const response=await catalogResponse(`https://www.googleapis.com/books/v1/volumes?${params}`,signal);
        const items=Array.isArray(response.items)?response.items:[];
        const books=items.flatMap(({id,volumeInfo:data})=>{
            if(!data?.title||data.language!==language||!data.authors?.length||!matchTitle(data.title)||
                (data.pageCount>0&&data.pageCount<48)||data.printType==='MAGAZINE'||!recommendationTitleIsBook(data.title))return [];
            const description=(data.description||'').replace(/<[^>]*>/g,' ');
            if(portal&&(!matchesPortalSynopsis(description,language)||
                /^(Foreign Language Study|Literary Criticism|Education)(?:\s|\/|$)/i.test(data.categories?.[0]||'')))return [];
            return [{
                language,googleId:id||'',title:data.title,author:data.authors[0],pagesTotal:data.pageCount||300,
                image:(data.imageLinks?.thumbnail||data.imageLinks?.smallThumbnail||'').replace(/^http:\/\//i,'https://'),
                description,genre:portal?'Попаданці':data.categories?.[0]||'',
                publishedDate:data.publishedDate||'',identifiers:(data.industryIdentifiers||[]).map(entry=>entry.identifier).filter(Boolean),
                source:'Google Books'
            }];
        });
        return {books,hasMore:!title&&items.length===24&&response.totalItems>page*24};
    }

    const code=recommendationLanguageCodes[language];
    const params=new URLSearchParams({q:query+' language:'+code,lang:language,limit:'16',page:String(page),
        fields:'author_name,first_publish_year,number_of_pages_median,editions,editions.key,editions.title,editions.language,editions.cover_i,editions.isbn'});
    const response=await catalogResponse(`https://openlibrary.org/search.json?${params}`,signal);
    const docs=Array.isArray(response.docs)?response.docs:[];
    const books=docs.flatMap(work=>{
        const edition=work.editions?.docs?.find(book=>book.language?.includes(code)&&book.key&&book.title&&matchTitle(book.title)&&recommendationTitleIsBook(book.title));
        if(!edition)return [];
        return [{
            language,googleId:'openlibrary_'+edition.key.split('/').pop(),title:edition.title,author:work.author_name?.[0]||'Невідомий',
            pagesTotal:work.number_of_pages_median||300,description:'',genre:'',
            image:edition.cover_i?`https://covers.openlibrary.org/b/id/${edition.cover_i}-M.jpg?default=false`:'',
            identifiers:labelNames(edition.isbn),publishedDate:String(work.first_publish_year||''),source:'Open Library'
        }];
    });
    return {books,hasMore:!title&&docs.length===16&&response.numFound>page*16};
}

function makeRecommendationCard(book,key){
    const card=document.createElement('article');
    card.className='card recommendation-card fade-in';
    card.dataset.recommendation=key;
    card.dataset.language=book.language;
    card.classList.toggle('recommendation-no-cover',!book.image);
    const open=document.createElement('button');
    open.type='button';
    open.className='recommendation-open';
    open.setAttribute('aria-label','Відкрити: '+book.title);
    open.innerHTML=`<img loading="lazy" decoding="async" src="${bookCover(book.image)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
        <span class="min-w-0"><strong class="block">${escapeHtml(book.title)}</strong>
            <span class="text-muted block text-xs">${escapeHtml(book.author)} · ${recommendationLanguageLabels[book.language]}</span>
            <span class="text-muted line-clamp-2 text-xs">${escapeHtml(book.description)}</span></span>`;
    open.querySelector('img').addEventListener('error',()=>card.classList.add('recommendation-no-cover'),{once:true});
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

function dismissRecommendation(key,card){
    const user=currentUser;
    if(!user||dismissedRecommendations.has(key))return;
    dismissedRecommendations.add(key);
    localRecommendationDismissals.add(key);
    const next=card.nextElementSibling?.querySelector('button')||card.previousElementSibling?.querySelector('button');
    const restoreFocus=card.contains(document.activeElement);
    card.remove();
    if(restoreFocus)next?.focus({preventScroll:true});
    const savedLocally=storeRecommendationState(user);
    if(document.getElementById('recommendationsList').childElementCount<4)fetchMoreRecommendations();
    return syncRecommendationState(user,{dismissedRecommendations:firebase.firestore.FieldValue.arrayUnion(key)},savedLocally);
}

function enableRecommendationPaging(){
    if(!('IntersectionObserver' in window))return;
    recommendationPager=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)&&currentTab==='discover'){
            fetchMoreRecommendations();
        }
    },{rootMargin:'320px 0px'});
}

function renderRecommendationPager(feed,added){
    const footer=document.getElementById('recommendationMore');
    const hasCards=document.getElementById('recommendationsList').childElementCount>0;
    const hasMore=feed.queryIndex<feed.queries.length;
    footer.replaceChildren();
    if(hasMore||feed.failedQueries.length){
        const next=document.createElement('button');
        next.type='button';
        next.className='secondary-button';
        next.textContent=hasMore?'Шукати ще':'Повторити пошук';
        next.addEventListener('click',()=>{
            if(!hasMore)feed.queries.push(...feed.failedQueries.splice(0));
            fetchMoreRecommendations();
        });
        footer.append(next);
    }
    if(!hasCards){
        footer.prepend(feed.failedQueries.length?'Деякі каталоги не відповіли.':'За цими фільтрами книги поки не знайдено.');
    }
    feed.emptyBatches=added?0:feed.emptyBatches+1;
    if(hasMore&&feed.emptyBatches<2&&(added||!feed.failedQueries.length))recommendationPager?.observe(footer);
}

async function fetchMoreRecommendations(){
    const feed=recommendationFeed;
    if(!feed||feed.loading||feed.queryIndex>=feed.queries.length)return;
    feed.loading=true;
    const list=document.getElementById('recommendationsList');
    const status=document.getElementById('recommendationMore');
    recommendationPager?.unobserve(status);
    status.textContent='Шукаємо книги…';
    const candidates=new Map();
    const existingTitles=new Set(myLibrary.map(book=>bookIdentity(book.title)));
    const languages=feed.language?[feed.language]:Object.keys(recommendationLanguageCodes);
    try{
        for(let attempt=0;attempt<3&&feed.queryIndex<feed.queries.length;attempt++){
            const batch=feed.queries.slice(feed.queryIndex,feed.queryIndex+4);
            feed.queryIndex+=batch.length;
            const results=await Promise.allSettled(batch.map(query=>queryRecommendationCatalog(query,feed.controller.signal)));
            if(feed!==recommendationFeed)return;
            results.forEach((result,index)=>{
                const query=batch[index];
                if(result.status==='rejected'){feed.failedQueries.push(query);return;}
                if(result.value.hasMore&&(query.page||1)<4)feed.queries.push({...query,page:(query.page||1)+1});
                for(const book of result.value.books){
                    const key=recommendationKey(book.title,book.author);
                    if(existingTitles.has(bookIdentity(book.title))||feed.seen.has(key)||dismissedRecommendations.has(key))continue;
                    const previous=candidates.get(key);
                    if(!previous||!previous.image&&book.image)candidates.set(key,book);
                }
            });
            const available=[...candidates.values()];
            if(languages.every(language=>available.filter(book=>book.language===language).length>=4))break;
        }
        const sorted=[...candidates].filter(([key])=>!dismissedRecommendations.has(key))
            .sort(([,a],[,b])=>Number(Boolean(b.image))-Number(Boolean(a.image)));
        const cards=sorted.map(([key,book])=>{
            feed.seen.add(key);
            return makeRecommendationCard(book,key);
        });
        list.append(...cards);
        renderRecommendationPager(feed,cards.length);
    }finally{
        feed.loading=false;
    }
}
