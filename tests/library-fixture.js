const fixtures=[
    {id:'legacy',title:'Кобзар',author:'Тарас Шевченко',dateAdded:1,status:'finished',dateStarted:'2023-02-02',
     dateFinished:'2023-02-04',pagesTotal:160,pagesRead:160,rating:5,review:'Перша нотатка',highlights:[{text:'Збережена цитата'}],lastCfi:'epubcfi(original)',shelves:['Нічне читання','Літні книги'],shelfIds:['known-modern']},
    {id:'reading',title:'Місто',author:'Валер’ян Підмогильний',dateAdded:2,status:'reading',dateStarted:'2026-02-02',
     pagesTotal:240,pagesRead:70,lastFileName:'book.epub',shelves:['Нічне читання']},
    {id:'undated',title:'Давній запис',author:'Автор',dateAdded:3,status:'finished',pagesTotal:99}
];
const mockSaved=JSON.parse(localStorage.getItem('fixtureDatabase')||'null');
const store=new Map(mockSaved?.books||fixtures.map(({id,...book})=>[id,book]));
const profile=mockSaved?.profile||{readingGoal:12,sentinel:'unchanged',shelfNames:['Нічне читання','Літні книги'],shelfCatalog:{'known-modern':{name:'Сучасна'}}};
const writes=[];
let onLibrary,onProfile,onLibraryError;
function persist(){
    localStorage.setItem('fixtureDatabase',JSON.stringify({books:[...store],profile}));
}
const snapshot=()=>({docs:[...store].map(([id,book])=>({id,data:()=>structuredClone(book)}))});
const profileSnapshot=()=>({exists:true,data:()=>structuredClone(profile)});
const fieldValue={
    increment:value=>({__op:'increment',value}),
    arrayUnion:(...values)=>({__op:'union',values}),
    arrayRemove:(...values)=>({__op:'remove',values})
};
function applyFields(record,fields){
    for(const [field,value] of Object.entries(fields)){
        const path=field.split('.');
        const target=path.slice(0,-1).reduce((obj,key)=>obj[key]||=( {} ),record);
        const key=path.at(-1);
        if(value?.__op==='increment')target[key]=(target[key]||0)+value.value;
        else if(value?.__op==='union')target[key]=[...new Set([...(target[key]||[]),...value.values])];
        else if(value?.__op==='remove')target[key]=(target[key]||[]).filter(item=>!value.values.includes(item));
        else if(value&&typeof value==='object'&&!Array.isArray(value)&&field==='shelfCatalog'){
            target[key]||={};
            for(const [id,entry] of Object.entries(value))target[key][id]={...target[key][id],...structuredClone(entry)};
        }
        else target[key]=structuredClone(value);
    }
}
const ref=id=>({id,collection:()=>collection,
    onSnapshot(callback){onProfile=callback;callback(profileSnapshot());return ()=>{onProfile=null;};},
    get:async()=>id==='fixture'?profileSnapshot():({exists:store.has(id),data:()=>structuredClone(store.get(id))}),
    async set(fields,options){
        if(id!=='fixture'){
            if(store.has(id))throw new Error('Unexpected overwrite');
            store.set(id,structuredClone(fields));writes.push({id,fields});
            persist();onLibrary?.(snapshot());return;
        }
        if(!options?.merge)throw new Error('Profile write must be merged');
        applyFields(profile,fields);
        writes.push({id,fields});
        persist();onProfile?.(profileSnapshot());
    },
    async update(changes){
        const book=store.get(id);
        if(!book)throw new Error('Unexpected new record');
        applyFields(book,changes);
        writes.push({id,fields:changes});
        persist();onLibrary?.(snapshot());
    },
    async delete(){throw new Error('Hard book deletion was attempted');}
});
const collection={doc:ref,orderBy:()=>collection,onSnapshot(options,callback,error){onLibrary=callback;onLibraryError=error;callback(snapshot());return ()=>{onLibrary=null;};}};
const firestore={enablePersistence:async()=>{},collection:()=>collection,
    batch(){
        const queued=[];
        return {set:(ref,...args)=>queued.push(()=>ref.set(...args)),update:(ref,...args)=>queued.push(()=>ref.update(...args)),
            async commit(){for(const action of queued)await action();}};
    },
    async runTransaction(fn){
        const queued=[];
        const result=await fn({get:doc=>doc.get(),update:(doc,changes)=>queued.push(()=>doc.update(changes)),
            set:(doc,data,options)=>queued.push(()=>doc.set(data,options))});
        for(const action of queued)await action();
        return result;
    }};
window.firebase={initializeApp(){},auth:()=>({onAuthStateChanged:callback=>window.loginFixture=callback}),firestore:()=>firestore};
window.firebase.firestore.FieldValue=fieldValue;
window.localforage={keys:async()=>['epub_reading','epub_legacy'],getItem:async()=>null,setItem:async()=>{}};
window.alert=message=>{throw new Error(message);};
window.Chart=function(){this.destroy=()=>{};};
Object.assign(window,{store,profile,snapshot,profileSnapshot,writes,
    failLibrary:()=>onLibraryError(Error('Offline test')),publishLibrary:()=>onLibrary(snapshot()),publishProfile:()=>onProfile(profileSnapshot())});
