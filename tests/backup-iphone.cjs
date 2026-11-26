const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {webkit,devices}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    const file=path.resolve(root,name);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png'})[path.extname(file)]||'text/plain');
    fs.createReadStream(file).pipe(res);
});
async function verify(browser,device,url){
    const context=await browser.newContext({...devices[device],serviceWorkers:'block',reducedMotion:'reduce'});
    try{
        await context.addInitScript({path:path.join(__dirname,'library-fixture.js')});
        await context.route(u=>u.hostname!=='127.0.0.1',route=>route.fulfill({body:'',contentType:'application/javascript'}));
        const page=await context.newPage();
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(url);
        const source=await page.evaluate(()=>{
            store.clear();
            for(const date of ['2018-09-25','2024-08-18','2026-11-10']){
                store.set(date,{title:'Тестова книга',author:'Автор',status:'finished',dateFinished:date,
                    review:'Нотатка '+date,highlights:[{text:'Цитата '+date}],shelfIds:['known-modern']});
            }
            store.set('bin',{title:'Збережений кошик',deletedAt:123,status:'planned',review:'У кошику'});
            loginFixture({uid:'fixture'});
            return [...store];
        });
        const download=page.waitForEvent('download');
        await page.evaluate(()=>exportLibrary());
        const file=await download;
        const payload=fs.readFileSync(await file.path());
        assert.equal(JSON.parse(payload).records.length,4);
        await page.evaluate(()=>{
            store.clear();profile.shelfCatalog={};profile.shelfNames=[];publishProfile();publishLibrary();
        });
        async function restore(data){
            const chooser=page.waitForEvent('filechooser');
            await page.evaluate(()=>importLibrary(true));
            await (await chooser).setFiles({name:'backup.json',mimeType:'application/json',buffer:data});
            const form=page.locator('[data-form=import-plan]');
            await form.waitFor();
            if(await form.locator('[type=submit]').isEnabled()){
                await form.locator('[type=submit]').tap();
                await page.waitForFunction(()=>document.querySelector('[data-form=import-plan] [role=status]')?.textContent.includes('Додано'));
            }
            await page.evaluate(()=>closeLibraryTools());
        }
        await restore(payload);
        assert.deepEqual(await page.evaluate(()=>[...store]),source);
        assert.equal(await page.evaluate(()=>profile.shelfCatalog['known-modern'].name),'Сучасна');
        await page.locator('#tab_finished').tap();
        for(const [date,book] of source.slice(0,3)){
            await page.locator('article[data-finished="'+date+'"] .book-card-main').tap();
            assert.equal(await page.locator('#detailsContent textarea').inputValue(),book.review);
            assert.ok((await page.locator('#detailsContent').innerText()).includes(book.highlights[0].text));
            await page.getByRole('button',{name:'Закрити картку'}).tap();
        }
        await page.evaluate(()=>{
            store.get('2018-09-25').review='Новіша нотатка';
            store.set('extra',{title:'Інша книга',status:'planned'});
            store.delete('2024-08-18');
            publishLibrary();
        });
        await restore(Buffer.from(JSON.stringify(JSON.parse(payload).records)));
        const expected=await page.evaluate(()=>[...store]);
        assert.equal(expected.length,5);
        assert.deepEqual(expected.find(([id])=>id==='2024-08-18')[1],source[1][1]);
        assert.equal(expected.find(([id])=>id==='2018-09-25')[1].review,'Новіша нотатка');
        const n=await page.evaluate(()=>writes.length);
        await restore(payload);
        assert.deepEqual(await page.evaluate(()=>[...store]),expected);
        assert.equal(await page.evaluate(()=>writes.length),n);
        await page.locator('article[data-finished="2024-08-18"] .book-card-main').tap();
        await page.getByRole('button',{name:'Редагувати книгу'}).tap();
        await page.locator('#editTitle').fill('Уточнена назва');
        await page.evaluate(()=>{
            window.originalWrite=updateBookInFirestore;
            window.alert=message=>window.lastAlert=message;
            updateBookInFirestore=async()=>{throw Error('Test write failure');};
        });
        await page.locator('#editContent button').first().tap();
        assert.ok(await page.locator('#editContent').isVisible());
        assert.equal(await page.locator('#editTitle').inputValue(),'Уточнена назва');
        assert.equal(await page.evaluate(()=>store.get('2024-08-18').title),'Тестова книга');
        assert.match(await page.evaluate(()=>lastAlert),/не збережено/);
        await page.evaluate(()=>{updateBookInFirestore=originalWrite;});
        await page.locator('#editContent button').first().tap();
        assert.equal(await page.evaluate(()=>store.get('2024-08-18').title),'Уточнена назва');
        assert.equal(await page.evaluate(()=>store.get('2024-08-18').review),'Нотатка 2024-08-18');
        await page.getByRole('button',{name:'Закрити картку'}).tap();
        await page.evaluate(()=>{failLibrary();});
        assert.match(await page.locator('#librarySync').innerText(),/Помилка синхронізації/);
        await page.evaluate(()=>document.querySelector('#librarySync button').click());
        assert.match(await page.locator('#librarySync').innerText(),/Синхронізовано/);
        const tracked=await page.evaluate(()=>{
            currentReaderBookId='2024-08-18';
            startTimer();
            readingStartTime=Date.now()-31000;
            tickReaderTimer();
            readingStartTime=Date.now()-4000;
            pauseReaderTimer();
            tickReaderTimer();
            stopTimer();
            currentReaderBookId=null;
            return store.get('2024-08-18').timeSpent;
        });
        assert.equal(tracked,35);
        const perf=await page.evaluate(()=>{
            const stats=[];
            for(const count of [100,500,1000]){
                const data=Array.from({length:count},(_,i)=>({id:'perf'+i,title:'Книга '+i,author:'Автор',status:'finished',dateFinished:'2020-01-01'}));
                const start=performance.now();replaceBookRecords(data);render();
                const mounted=performance.now();
                const cards=document.querySelectorAll('#myBooksContainer article');
                const sample=cards[Math.floor(count/2)];
                sample.scrollIntoView();const top=sample.getBoundingClientRect().top;
                data[0].rating=3;replaceBookRecords(data);render();
                if(cards.length!==count||!sample.isConnected||Math.abs(sample.getBoundingClientRect().top-top)>1)throw Error('Library scroll position changed');
                stats.push({count,mountMs:Math.round(mounted-start),updateMs:Math.round(performance.now()-mounted)});
            }
            return stats;
        });
        assert.deepEqual(errors,[]);
        console.log(device,'passed',JSON.stringify(perf));
    }finally{await context.close();}
}
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
        const browser=await webkit.launch();
        try{for(const name of ['iPhone 17','iPhone 17 Pro'])await verify(browser,name,'http://127.0.0.1:'+server.address().port+'/');}
        finally{await browser.close();}
    }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
