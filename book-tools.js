let allBookRecords=[];
let trashedBooks=[];
let shelfNames=[];
let shelfCatalog={};
let deviceShelfCatalog={},deviceShelfMembership={};
let shelvesById=new Map();
let libraryShelfOptions=[],libraryTagOptions=[];
let unsubscribeOrganization;
let organizationFilters={shelf:'',tag:'',favorite:false};
let libraryToolsView;
let lastTrash;
let undoTimeout;

function isBookTrashed(book){
    return typeof book.deletedAt==='number'&&book.deletedAt>0;
}

function replaceBookRecords(books){
    allBookRecords=books;
    myLibrary=books.filter(book=>!isBookTrashed(book));
    indexReadingHistories(myLibrary);
    refreshOpenReadingTimeline();
    trashedBooks=books.filter(isBookTrashed).sort((a,b)=>b.deletedAt-a.deletedAt);
    refreshShelfOptions();
    libraryTagOptions=uniqueLabels(myLibrary.flatMap(book=>labelNames(book.tags)));
    document.getElementById('trashCount').textContent=trashedBooks.length?`(${trashedBooks.length})`:'';
    refreshLibraryTools();
}

function resetBookTools(){
    unsubscribeOrganization?.();
    unsubscribeOrganization=null;
    allBookRecords=[];
    trashedBooks=[];
    shelfNames=[];
    shelfCatalog={};
    deviceShelfCatalog={};
    deviceShelfMembership={};
    try{
        if(currentUser){
            const saved=JSON.parse(localStorage.getItem('libraryShelves_'+currentUser.uid));
            deviceShelfCatalog=saved?.catalog||{};
            deviceShelfMembership=saved?.membership||{};
        }
    }catch{}
    shelvesById=new Map();
    libraryShelfOptions=[];
    libraryTagOptions=[];
    organizationFilters={shelf:'',tag:'',favorite:false};
    if(document.getElementById('libraryToolsSheet').classList.contains('open'))closeAllSheets();
    libraryToolsView=null;
    hideTrashUndo();
    document.getElementById('libraryFavorites').checked=false;
    document.getElementById('trashCount').textContent='';
}

function labelNames(value){
    return Array.isArray(value)?value.filter(name=>typeof name==='string'&&name.trim()):[];
}
function labelKey(name){
    return name.normalize('NFKC').trim().toLocaleLowerCase('uk');
}
function uniqueLabels(names){
    const labels=new Map();
    for(const name of names){
        const key=labelKey(name);
        if(!labels.has(key))labels.set(key,name);
    }
    return [...labels.values()].sort((a,b)=>a.localeCompare(b,'uk'));
}
// Legacy memberships keep their original label while the profile controls the displayed name.
function legacyShelfId(name){
    return 'legacy:'+encodeURIComponent(labelKey(name));
}

function shelfOptions(names,catalog){
    const entries=new Map(uniqueLabels([...names,...allBookRecords.flatMap(book=>labelNames(book.shelves))])
        .map(name=>[legacyShelfId(name),{id:legacyShelfId(name),name}]));
    for(const [id,entry] of Object.entries(catalog)){
        if(entry?.deleted===true)entries.delete(id);
        else if(typeof entry?.name==='string'&&entry.name.trim())entries.set(id,{id,name:entry.name});
    }
    return [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name,'uk'));
}

function refreshShelfOptions(){
    libraryShelfOptions=shelfOptions(shelfNames,{...shelfCatalog,...deviceShelfCatalog});
    shelvesById=new Map(libraryShelfOptions.map(shelf=>[shelf.id,shelf]));
}

function bookShelfIds(book){
    const ids=new Set([...labelNames(book.shelfIds),...labelNames(book.shelves).map(legacyShelfId)]);
    for(const [id,added] of Object.entries(deviceShelfMembership[book.id]||{})){
        if(added)ids.add(id);
        else ids.delete(id);
    }
    return ids;
}

function saveDeviceShelves(user){
    try{
        localStorage.setItem('libraryShelves_'+user.uid,JSON.stringify({catalog:deviceShelfCatalog,membership:deviceShelfMembership}));
        return true;
    }catch{return false;}
}

function refreshShelfViews(){
    refreshShelfOptions();
    refreshLibraryTools();
    render();
}

function activeBookShelfNames(book){
    return uniqueLabels([...bookShelfIds(book)].flatMap(id=>{
        const shelf=shelvesById.get(id);
        return shelf?[shelf.name]:[];
    }));
}

function exportBookRecord(book){
    if(!book.shelves&&!book.shelfIds&&!deviceShelfMembership[book.id])return book;
    const copy={...book};
    delete copy.shelfIds;
    copy.shelves=activeBookShelfNames(book);
    return copy;
}

function loadLibraryOrganization(user){
    unsubscribeOrganization=db.collection('users').doc(user.uid).onSnapshot(snapshot=>{
        if(currentUser!==user)return;
        const profile=snapshot.data()||{};
        applyRecommendationPreferences(profile,snapshot);
        if(profile.readingGoal){
            localStorage.setItem('readingGoal',profile.readingGoal);
            updateGoalWidget();
        }
        const shelves=labelNames(profile.shelfNames);
        const catalog=profile.shelfCatalog||{};
        if(JSON.stringify(shelfNames)===JSON.stringify(shelves)&&JSON.stringify(shelfCatalog)===JSON.stringify(catalog))return;
        shelfNames=shelves;
        shelfCatalog=catalog;
        refreshShelfOptions();
        refreshLibraryTools();
        render();
    },console.warn);
}

function updateOrganizationFilters(){
    const options={
        shelf:libraryShelfOptions,
        tag:libraryTagOptions.map(name=>({id:labelKey(name),name}))
    };
    for(const [field,id,all] of [['shelf','libraryShelf','Усі полиці'],['tag','libraryTag','Усі теги']]){
        const select=document.getElementById(id);
        const labels=options[field];
        if(organizationFilters[field]&&!labels.some(label=>label.id===organizationFilters[field])){
            organizationFilters[field]='';
        }
        const markup=`<option value="">${all}</option>`+labels.map(label=>
            `<option value="${escapeHtml(label.id)}">${escapeHtml(label.name)}</option>`).join('');
        if(select.innerHTML!==markup)select.innerHTML=markup;
        select.value=organizationFilters[field];
    }
}
function setOrganizationFilters(){
    organizationFilters={
        shelf:document.getElementById('libraryShelf').value,
        tag:document.getElementById('libraryTag').value,
        favorite:document.getElementById('libraryFavorites').checked
    };
    render();
    animateLibraryChange();
}
function hasOrganizationFilters(){
    return Boolean(organizationFilters.shelf||organizationFilters.tag||organizationFilters.favorite);
}
function matchesOrganizationFilters(book){
    return (!organizationFilters.favorite||book.favorite===true)&&
        (!organizationFilters.shelf||bookShelfIds(book).has(organizationFilters.shelf))&&
        (!organizationFilters.tag||labelNames(book.tags).some(name=>labelKey(name)===organizationFilters.tag));
}
function canReorderBooks(){
    return currentLibraryTab!=='finished'&&!libraryFilterQuery&&!hasOrganizationFilters();
}

function renderBookLabels(book){
    const shelves=activeBookShelfNames(book);
    const tags=uniqueLabels(labelNames(book.tags));
    if(book.favorite!==true&&!shelves.length&&!tags.length)return '';
    return `<div class="book-labels">
        ${book.favorite===true?'<span class="book-label favorite-label">♥ Обране</span>':''}
        ${shelves.map(name=>`<span class="book-label">${escapeHtml(name)}</span>`).join('')}
        ${tags.map(name=>`<span class="book-label">#${escapeHtml(name)}</span>`).join('')}
    </div>`;
}

function enableBookLongPress(container){
    let hold;
    let openedButton;
    let suppressUntil=0;

    function cancelHold(){
        if(hold)clearTimeout(hold.timer);
        hold=null;
    }
    container.addEventListener('pointerdown',event=>{
        cancelHold();
        if(!event.isPrimary||event.button!==0||event.pointerType==='mouse')return;
        const button=event.target.closest('.book-card-main');
        const card=button?.closest('[data-id]');
        if(!card)return;
        const timer=setTimeout(()=>{
            if(!card.isConnected||document.body.classList.contains('modal-open'))return;
            openedButton=button;
            suppressUntil=performance.now()+650;
            cancelHold();
            openBookActions(card.dataset.id);
        },450);
        hold={id:event.pointerId,x:event.clientX,y:event.clientY,timer};
    },{passive:true});
    container.addEventListener('pointermove',event=>{
        if(hold?.id===event.pointerId&&Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>9)cancelHold();
    },{passive:true});
    for(const type of ['pointerup','pointercancel','pointerleave'])container.addEventListener(type,cancelHold,{passive:true});
    container.addEventListener('contextmenu',event=>{
        const button=event.target.closest('.book-card-main');
        if(!button)return;
        event.preventDefault();
        if(event.pointerType==='mouse'||(!event.pointerType&&matchMedia('(hover:hover)').matches)){
            cancelHold();
            openBookActions(button.closest('[data-id]').dataset.id);
        }
    });
    container.addEventListener('click',event=>{
        const button=event.target.closest('.book-card-main, .book-actions-trigger');
        if(!button)return;
        if(button===openedButton&&performance.now()<=suppressUntil){
            event.preventDefault();
            openedButton=null;
            return;
        }
        const {id,finished}=button.closest('[data-id]').dataset;
        if(button.matches('.book-actions-trigger'))openBookActions(id);
        else showLibraryBook(id,finished);
    });
}

const bookStatusLabels={reading:'Читаю',planned:'Заплановано',finished:'Прочитано'};

function openLibraryTools(mode,id,returnToSearch=false){
    const holder=document.getElementById('libraryToolsContent');
    libraryToolsView={mode,id,returnToSearch};
    if(mode==='organize'){
        holder.innerHTML=`
            <section class="tool-section">
                <h3>Полиці</h3>
                <div id="bookShelfOptions" class="tool-shelves"></div>
                ${shelfForm('Створити й додати')}
            </section>
            <section class="tool-section">
                <h3>Теги</h3>
                <div id="bookTagItems" class="book-labels"></div>
                <form class="tool-form" data-form="tag">
                    <input name="label" class="search-box" aria-label="Новий тег" placeholder="Новий тег" maxlength="32" required>
                    <button type="submit" class="secondary-button">Додати тег</button>
                </form>
            </section>`;
    }else if(mode==='recommendation-settings'){
        renderRecommendationSettings();
    }else if(mode==='shelves'){
        holder.innerHTML=`<div id="libraryShelfItems" class="tool-list"></div>${shelfForm('Створити полицю')}`;
    }else if(mode==='rename-shelf'||mode==='delete-shelf'){
        const shelf=shelvesById.get(id);
        if(!shelf){openLibraryShelves();return;}
        const operation=mode==='rename-shelf'
            ?shelfForm('Зберегти','rename-shelf',shelf.name)
            :`<p class="text-muted">Видалити полицю «${escapeHtml(shelf.name)}»? Усі книги з неї залишаться в бібліотеці з датами й нотатками.</p>
                <form class="tool-form" data-form="delete-shelf"><button type="submit" class="secondary-button tool-danger">Видалити полицю</button></form>`;
        holder.innerHTML=operation+
            '<button type="button" class="secondary-button shelf-cancel" data-action="cancel-shelf">До моїх полиць</button>';
    }
    holder.parentElement.scrollTop=0;
    refreshLibraryTools();
    openSheet('libraryToolsSheet');
}
function openBookActions(id){
    if(libraryBook(id))openLibraryTools('actions',id);
}
function openLibraryShelves(){
    openLibraryTools('shelves');
}
function openLibraryTrash(){
    openLibraryTools('trash',undefined,document.getElementById('searchSheet').classList.contains('open'));
}
function closeLibraryTools(){
    const back=libraryToolsView?.returnToSearch;
    libraryToolsView=null;
    if(back)openSheet('searchSheet');
    else closeAllSheets();
}

function shelfForm(button,mode='shelf',name=''){
    return `<form class="tool-form" data-form="${mode}">
        <input name="label" class="search-box" aria-label="Назва полиці" placeholder="Назва полиці" value="${escapeHtml(name)}" maxlength="40" required>
        <button type="submit" class="secondary-button">${button}</button>
    </form>`;
}
function actionButton(action,label,classes='',value=''){
    return `<button type="button" class="tool-action ${classes}" data-action="${action}" data-value="${escapeHtml(value)}">${label}</button>`;
}
function refreshLibraryTools(){
    if(!libraryToolsView||refreshReadingTools())return;
    const {mode,id}=libraryToolsView;
    const bookMode=mode==='actions'||mode==='organize';
    const book=bookMode?libraryBook(id):null;
    if(bookMode&&!book){
        if(document.getElementById('libraryToolsSheet').classList.contains('open'))closeLibraryTools();
        return;
    }
    const title=document.getElementById('libraryToolsTitle');
    const holder=document.getElementById('libraryToolsContent');
    title.textContent={
        actions:book?.title,organize:'Полиці й теги',shelves:'Мої полиці',trash:'Кошик',
        'rename-shelf':'Перейменувати полицю','delete-shelf':'Видалити полицю'
    }[mode];
    if(mode==='rename-shelf'||mode==='delete-shelf'){
        if(!shelvesById.has(id))openLibraryShelves();
        return;
    }
    if(mode==='actions'){
        const active=document.activeElement?.dataset.action;
        const statuses=Object.entries(bookStatusLabels).filter(([status])=>status!==book.status&&
            (!book.activeReread||status==='finished'));
        holder.innerHTML=`<div class="tool-list">
            ${actionButton('favorite',book.favorite===true?'Прибрати з обраного':'Додати в обране')}
            ${actionButton('organize','Полиці й теги')}
            <div class="tool-status">
                <p class="text-muted">Змінити статус</p>
                ${statuses.map(([status,label])=>actionButton('status',
                    status==='reading'&&isCompleted(book)?'Почати перечитування':
                    status==='finished'&&book.activeReread?'Завершити перечитування':label,'',status)).join('')}
            </div>
            ${actionButton('trash','До кошика','tool-danger')}
        </div>`;
        if(active)holder.querySelector(`[data-action="${active}"]`)?.focus({preventScroll:true});
    }else if(mode==='organize'){
        const selected=bookShelfIds(book);
        const shelves=libraryShelfOptions;
        document.getElementById('bookShelfOptions').innerHTML=shelves.length?shelves.map(shelf=>
            `<label><input type="checkbox" data-shelf="${escapeHtml(shelf.id)}" ${selected.has(shelf.id)?'checked':''}> ${escapeHtml(shelf.name)}</label>`).join(''):
            '<p class="text-muted">Поки немає полиць.</p>';
        document.getElementById('bookTagItems').innerHTML=uniqueLabels(labelNames(book.tags)).map(name=>
            `<button type="button" class="book-label tag-remove" data-action="remove-tag" data-value="${escapeHtml(name)}" aria-label="Прибрати тег ${escapeHtml(name)}">#${escapeHtml(name)} <span aria-hidden="true">×</span></button>`).join('');
    }else if(mode==='shelves'){
        const shelves=libraryShelfOptions;
        const counts=new Map();
        for(const book of myLibrary){
            for(const key of bookShelfIds(book))counts.set(key,(counts.get(key)||0)+1);
        }
        document.getElementById('libraryShelfItems').innerHTML=shelves.length?shelves.map(name=>
            renderShelfRow(name,counts.get(name.id)||0)).join(''):
            '<p class="text-muted">Поки немає полиць.</p>';
    }else{
        holder.innerHTML=trashedBooks.length?`<ul class="tool-list">${trashedBooks.map(record=>
            `<li class="trash-row"><span><strong>${escapeHtml(record.title)}</strong><span class="text-muted">${escapeHtml(record.author||'')}</span>${record.mergedInto?'<small class="text-muted">Дублікат після об’єднання</small>':''}</span>
                <button type="button" class="secondary-button" data-action="restore" data-value="${escapeHtml(record.id)}"
                    aria-label="Відновити: ${escapeHtml(record.title)}">Відновити</button></li>`).join('')}</ul>`:
            '<p class="text-muted">Кошик порожній.</p>';
    }
}

function renderShelfRow(shelf,count){
    const name=escapeHtml(shelf.name);
    const id=escapeHtml(shelf.id);
    return `<div class="shelf-row">
        ${actionButton('filter-shelf',`<span>${name}</span><span class="text-muted">${count}</span>`,'',shelf.id)}
        <div class="shelf-row-actions">
            <button type="button" class="secondary-button" data-action="rename-shelf" data-value="${id}" aria-label="Перейменувати полицю ${name}" title="Перейменувати">✎</button>
            <button type="button" class="secondary-button tool-danger" data-action="delete-shelf" data-value="${id}" aria-label="Видалити полицю ${name}" title="Видалити">×</button>
        </div>
    </div>`;
}

function updateBookLabel(id,field,name,add){
    const book=libraryBook(id);
    if(!book)return;
    const variants=labelNames(book[field]).filter(value=>labelKey(value)===labelKey(name));
    const fieldValue=firebase.firestore.FieldValue;
    if(add&&!variants.length)updateBookInFirestore(id,{[field]:fieldValue.arrayUnion(name)}).catch(showWriteError);
    if(!add&&variants.length)updateBookInFirestore(id,{[field]:fieldValue.arrayRemove(...variants)}).catch(showWriteError);
}

async function updateBookShelf(bookId,shelfId,add){
    const user=currentUser;
    const book=libraryBook(bookId);
    if(!user||!book||!shelvesById.has(shelfId)||bookShelfIds(book).has(shelfId)===add)return;
    const memberships=deviceShelfMembership[bookId]||={};
    memberships[shelfId]=add;
    const savedLocally=saveDeviceShelves(user);
    refreshShelfViews();

    const fieldValue=firebase.firestore.FieldValue;
    const legacyNames=labelNames(book.shelves).filter(name=>legacyShelfId(name)===shelfId);
    const updates={shelfIds:add?fieldValue.arrayUnion(shelfId):fieldValue.arrayRemove(shelfId)};
    if(!add&&legacyNames.length)updates.shelves=fieldValue.arrayRemove(...legacyNames);
    const onlyOnDevice=Object.hasOwn(deviceShelfCatalog,shelfId)&&!Object.hasOwn(shelfCatalog,shelfId);
    if(onlyOnDevice&&savedLocally)return;
    try{
        await updateBookInFirestore(bookId,updates);
        if(currentUser===user&&memberships[shelfId]===add){
            delete memberships[shelfId];
            if(!Object.keys(memberships).length)delete deviceShelfMembership[bookId];
            saveDeviceShelves(user);
        }
    }catch(error){
        if(currentUser===user&&!savedLocally)showWriteError(error);
    }
}

async function createShelf(name,bookId){
    const user=currentUser;
    if(!user||(bookId&&!libraryBook(bookId)))return;
    const existing=libraryShelfOptions.find(shelf=>labelKey(shelf.name)===labelKey(name));
    if(existing){
        if(bookId)await updateBookShelf(bookId,existing.id,true);
        return;
    }
    const ref=db.collection('users').doc(user.uid);
    const id=crypto.randomUUID();
    const entry={name};
    const metadata={shelfCatalog:{[id]:entry}};
    deviceShelfCatalog[id]=entry;
    if(bookId)(deviceShelfMembership[bookId]||={})[id]=true;
    const savedLocally=saveDeviceShelves(user);
    refreshShelfViews();
    try{
        if(bookId){
            const batch=db.batch();
            batch.set(ref,metadata,{merge:true});
            batch.update(ref.collection('books').doc(bookId),{shelfIds:firebase.firestore.FieldValue.arrayUnion(id)});
            await batch.commit();
        }else await ref.set(metadata,{merge:true});
        if(currentUser!==user)return;
        if(deviceShelfCatalog[id]===entry){
            shelfCatalog={...shelfCatalog,[id]:entry};
            delete deviceShelfCatalog[id];
        }
        const memberships=deviceShelfMembership[bookId];
        if(memberships?.[id]===true){
            delete memberships[id];
            if(!Object.keys(memberships).length)delete deviceShelfMembership[bookId];
        }
        saveDeviceShelves(user);
        refreshShelfViews();
    }catch(error){
        if(currentUser===user&&!savedLocally)showWriteError(error);
    }
}

async function saveShelfChange(form,name){
    const view=libraryToolsView;
    const user=currentUser;
    const removing=view.mode==='delete-shelf';
    const ref=db.collection('users').doc(user.uid);
    const button=form.querySelector('[type=submit]');
    button.disabled=true;
    const shelf=shelvesById.get(view.id);
    if(!shelf){openLibraryShelves();return;}
    if(!removing&&libraryShelfOptions.some(entry=>entry.id!==shelf.id&&labelKey(entry.name)===labelKey(name))){
        form.elements.label.setCustomValidity('Полиця з такою назвою вже є.');
        form.elements.label.reportValidity();
        button.disabled=false;
        return;
    }
    const change=removing?{name:shelf.name,deleted:true}:{name};
    const onlyOnDevice=Object.hasOwn(deviceShelfCatalog,shelf.id)&&!Object.hasOwn(shelfCatalog,shelf.id);
    const saveOnDevice=()=>{
        deviceShelfCatalog[shelf.id]=change;
        return saveDeviceShelves(user);
    };
    try{
        if(onlyOnDevice){
            if(!saveOnDevice())throw new Error('Device shelf storage unavailable');
        }else{
            const result=await db.runTransaction(async transaction=>{
                const profile=(await transaction.get(ref)).data()||{};
                const options=shelfOptions(labelNames(profile.shelfNames),{...(profile.shelfCatalog||{}),...deviceShelfCatalog});
                if(!options.some(entry=>entry.id===shelf.id))return 'missing';
                if(!removing&&options.some(entry=>entry.id!==shelf.id&&labelKey(entry.name)===labelKey(name)))return 'duplicate';
                transaction.set(ref,{shelfCatalog:{[shelf.id]:change}},{merge:true});
            });
            if(currentUser!==user)return;
            if(result==='duplicate'&&libraryToolsView===view){
                form.elements.label.setCustomValidity('Полиця з такою назвою вже є.');
                form.elements.label.reportValidity();
                return;
            }
            if(result==='missing')saveOnDevice();
            else if(!result){
                shelfCatalog={...shelfCatalog,[shelf.id]:change};
                delete deviceShelfCatalog[shelf.id];
                saveDeviceShelves(user);
            }
        }
    }catch(error){
        if(currentUser!==user)return;
        if(!saveOnDevice()){showWriteError(error);return;}
    }finally{button.disabled=false;}
    if(currentUser!==user)return;
    refreshShelfViews();
    if(libraryToolsView===view)openLibraryShelves();
}

function enableLibraryToolsControls(){
    const holder=document.getElementById('libraryToolsContent');
    holder.addEventListener('click',event=>{
        const button=event.target.closest('[data-action]');
        if(!button||!libraryToolsView||!currentUser)return;
        const {id}=libraryToolsView;
        const {action,value}=button.dataset;
        if(handleReadingToolAction(action,value))return;
        if(action==='favorite'){
            const book=libraryBook(id);
            if(book)updateBookInFirestore(id,{favorite:book.favorite!==true}).catch(showWriteError);
        }else if(action==='organize')openLibraryTools('organize',id);
        else if(action==='status')changeStatusFromDetails(id,value);
        else if(action==='trash')moveBookToTrash(id);
        else if(action==='restore')restoreBook(value);
        else if(action==='remove-tag')updateBookLabel(id,'tags',value,false);
        else if(action==='rename-shelf'||action==='delete-shelf')openLibraryTools(action,value);
        else if(action==='cancel-shelf')openLibraryShelves();
        else if(action==='filter-shelf'){
            closeLibraryTools();
            organizationFilters.shelf=value;
            document.querySelector('.library-organization').open=true;
            render();
        }
    });
    holder.addEventListener('change',event=>{
        if(handleReadingToolChange(event.target))return;
        if(event.target.matches('[data-shelf]')&&libraryToolsView?.id){
            updateBookShelf(libraryToolsView.id,event.target.dataset.shelf,event.target.checked);
        }
    });
    holder.addEventListener('input',event=>{
        if(event.target.matches('[name=label]'))event.target.setCustomValidity('');
    });
    holder.addEventListener('submit',event=>{
        event.preventDefault();
        const form=event.target;
        if(!libraryToolsView||!currentUser||!form.dataset.form)return;
        if(form.dataset.form==='import-plan'){commitLibraryImport(form);return;}
        if(form.dataset.form==='recommendation-settings'){saveRecommendationGenres(form);return;}
        if(form.dataset.form==='delete-shelf'){saveShelfChange(form);return;}
        const name=form.elements.label.value.normalize('NFKC').trim().replace(/\s+/g,' ');
        if(!name)return;
        if(form.dataset.form==='rename-shelf'){saveShelfChange(form,name);return;}
        form.reset();
        const {id}=libraryToolsView;
        if(form.dataset.form==='tag')updateBookLabel(id,'tags',name,true);
        else createShelf(name,id);
    });
}

function hideTrashUndo(){
    clearTimeout(undoTimeout);
    lastTrash=null;
    document.getElementById('trashUndo').hidden=true;
}
function moveBookToTrash(id){
    if(!currentUser||!libraryBook(id))return;
    const entry={id,user:currentUser};
    lastTrash=entry;
    clearTimeout(undoTimeout);
    const write=updateBookInFirestore(id,{deletedAt:Date.now()});
    closeAllSheets();
    document.getElementById('trashUndo').hidden=false;
    undoTimeout=setTimeout(hideTrashUndo,12000);
    write.catch(error=>{
        if(lastTrash===entry)hideTrashUndo();
        if(currentUser===entry.user)showWriteError(error);
    });
}
function undoTrash(){
    if(lastTrash)restoreBook(lastTrash.id);
}
function restoreBook(id){
    if(!currentUser||!(lastTrash?.id===id||trashedBooks.some(book=>book.id===id)))return;
    const user=currentUser;
    if(lastTrash?.id===id)hideTrashUndo();
    updateBookInFirestore(id,{deletedAt:null}).catch(error=>{
        if(currentUser===user)showWriteError(error);
    });
}
