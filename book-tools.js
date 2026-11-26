let allBookRecords=[];
let trashedBooks=[];
let shelfNames=[];
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
function refreshShelfOptions(){
    libraryShelfOptions=uniqueLabels([...shelfNames,...allBookRecords.flatMap(book=>labelNames(book.shelves))]);
}
function loadLibraryOrganization(user){
    unsubscribeOrganization=db.collection('users').doc(user.uid).onSnapshot(snapshot=>{
        if(currentUser!==user)return;
        const profile=snapshot.data()||{};
        if(profile.readingGoal){
            localStorage.setItem('readingGoal',profile.readingGoal);
            updateGoalWidget();
        }
        const shelves=labelNames(profile.shelfNames);
        if(JSON.stringify(shelfNames)===JSON.stringify(shelves))return;
        shelfNames=shelves;
        refreshShelfOptions();
        updateOrganizationFilters();
        refreshLibraryTools();
        if(organizationFilters.shelf)render();
    },console.warn);
}

function updateOrganizationFilters(){
    const options={shelf:libraryShelfOptions,tag:libraryTagOptions};
    for(const [field,id,all] of [['shelf','libraryShelf','Усі полиці'],['tag','libraryTag','Усі теги']]){
        const select=document.getElementById(id);
        const labels=options[field];
        if(organizationFilters[field]&&!labels.some(name=>labelKey(name)===organizationFilters[field])){
            organizationFilters[field]='';
        }
        const markup=`<option value="">${all}</option>`+labels.map(name=>
            `<option value="${escapeHtml(labelKey(name))}">${escapeHtml(name)}</option>`).join('');
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
        (!organizationFilters.shelf||labelNames(book.shelves).some(name=>labelKey(name)===organizationFilters.shelf))&&
        (!organizationFilters.tag||labelNames(book.tags).some(name=>labelKey(name)===organizationFilters.tag));
}
function canReorderBooks(){
    return currentLibraryTab!=='finished'&&!libraryFilterQuery&&!hasOrganizationFilters();
}

function renderBookLabels(book){
    const shelves=uniqueLabels(labelNames(book.shelves));
    const tags=uniqueLabels(labelNames(book.tags));
    if(!book.favorite&&!shelves.length&&!tags.length)return '';
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
        const id=button.closest('[data-id]').dataset.id;
        if(button.matches('.book-actions-trigger'))openBookActions(id);
        else showLibraryBook(id);
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
    }else if(mode==='shelves'){
        holder.innerHTML=`<div id="libraryShelfItems" class="tool-list"></div>${shelfForm('Створити полицю')}`;
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

function shelfForm(button){
    return `<form class="tool-form" data-form="shelf">
        <input name="label" class="search-box" aria-label="Назва полиці" placeholder="Назва полиці" maxlength="40" required>
        <button type="submit" class="secondary-button">${button}</button>
    </form>`;
}
function actionButton(action,label,classes='',value=''){
    return `<button type="button" class="tool-action ${classes}" data-action="${action}" data-value="${escapeHtml(value)}">${label}</button>`;
}
function refreshLibraryTools(){
    if(!libraryToolsView)return;
    const {mode,id}=libraryToolsView;
    const book=id?libraryBook(id):null;
    if(id&&!book){
        if(document.getElementById('libraryToolsSheet').classList.contains('open'))closeLibraryTools();
        return;
    }
    const title=document.getElementById('libraryToolsTitle');
    const holder=document.getElementById('libraryToolsContent');
    title.textContent={actions:book?.title,organize:'Полиці й теги',shelves:'Мої полиці',trash:'Кошик'}[mode];
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
        const selected=new Set(labelNames(book.shelves).map(labelKey));
        const shelves=libraryShelfOptions;
        document.getElementById('bookShelfOptions').innerHTML=shelves.length?shelves.map(name=>
            `<label><input type="checkbox" data-shelf="${escapeHtml(name)}" ${selected.has(labelKey(name))?'checked':''}> ${escapeHtml(name)}</label>`).join(''):
            '<p class="text-muted">Поки немає полиць.</p>';
        document.getElementById('bookTagItems').innerHTML=uniqueLabels(labelNames(book.tags)).map(name=>
            `<button type="button" class="book-label tag-remove" data-action="remove-tag" data-value="${escapeHtml(name)}" aria-label="Прибрати тег ${escapeHtml(name)}">#${escapeHtml(name)} <span aria-hidden="true">×</span></button>`).join('');
    }else if(mode==='shelves'){
        const shelves=libraryShelfOptions;
        const counts=new Map();
        for(const book of myLibrary){
            for(const key of new Set(labelNames(book.shelves).map(labelKey)))counts.set(key,(counts.get(key)||0)+1);
        }
        document.getElementById('libraryShelfItems').innerHTML=shelves.length?shelves.map(name=>
            actionButton('filter-shelf',`<span>${escapeHtml(name)}</span><span class="text-muted">${counts.get(labelKey(name))||0}</span>`,'',name)).join(''):
            '<p class="text-muted">Поки немає полиць.</p>';
    }else{
        holder.innerHTML=trashedBooks.length?`<ul class="tool-list">${trashedBooks.map(record=>
            `<li class="trash-row"><span><strong>${escapeHtml(record.title)}</strong><span class="text-muted">${escapeHtml(record.author||'')}</span></span>
                <button type="button" class="secondary-button" data-action="restore" data-value="${escapeHtml(record.id)}"
                    aria-label="Відновити: ${escapeHtml(record.title)}">Відновити</button></li>`).join('')}</ul>`:
            '<p class="text-muted">Кошик порожній.</p>';
    }
}

function updateBookLabel(id,field,name,add){
    const book=libraryBook(id);
    if(!book)return;
    const variants=labelNames(book[field]).filter(value=>labelKey(value)===labelKey(name));
    const fieldValue=firebase.firestore.FieldValue;
    if(add&&!variants.length)updateBookInFirestore(id,{[field]:fieldValue.arrayUnion(name)}).catch(showWriteError);
    if(!add&&variants.length)updateBookInFirestore(id,{[field]:fieldValue.arrayRemove(...variants)}).catch(showWriteError);
}

function createShelf(name,id){
    const storedName=libraryShelfOptions.find(shelf=>labelKey(shelf)===labelKey(name));
    if(storedName){
        if(id)updateBookLabel(id,'shelves',storedName,true);
        return;
    }
    const user=db.collection('users').doc(currentUser.uid);
    const fieldValue=firebase.firestore.FieldValue;
    if(!id){
        user.set({shelfNames:fieldValue.arrayUnion(name)},{merge:true}).catch(showWriteError);
        return;
    }
    if(!libraryBook(id))return;
    const batch=db.batch();
    batch.set(user,{shelfNames:fieldValue.arrayUnion(name)},{merge:true});
    batch.update(user.collection('books').doc(id),{shelves:fieldValue.arrayUnion(name)});
    batch.commit().catch(showWriteError);
}

function enableLibraryToolsControls(){
    const holder=document.getElementById('libraryToolsContent');
    holder.addEventListener('click',event=>{
        const button=event.target.closest('[data-action]');
        if(!button||!libraryToolsView||!currentUser)return;
        const {id}=libraryToolsView;
        const {action,value}=button.dataset;
        if(action==='favorite'){
            const book=libraryBook(id);
            if(book)updateBookInFirestore(id,{favorite:book.favorite!==true}).catch(showWriteError);
        }else if(action==='organize')openLibraryTools('organize',id);
        else if(action==='status')changeStatusFromDetails(id,value);
        else if(action==='trash')moveBookToTrash(id);
        else if(action==='restore')restoreBook(value);
        else if(action==='remove-tag')updateBookLabel(id,'tags',value,false);
        else if(action==='filter-shelf'){
            closeLibraryTools();
            organizationFilters.shelf=labelKey(value);
            document.querySelector('.library-organization').open=true;
            render();
        }
    });
    holder.addEventListener('change',event=>{
        if(event.target.matches('[data-shelf]')&&libraryToolsView?.id){
            updateBookLabel(libraryToolsView.id,'shelves',event.target.dataset.shelf,event.target.checked);
        }
    });
    holder.addEventListener('submit',event=>{
        event.preventDefault();
        const form=event.target;
        if(!libraryToolsView||!currentUser||!form.dataset.form)return;
        const name=form.elements.label.value.normalize('NFKC').trim().replace(/\s+/g,' ');
        if(!name)return;
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
