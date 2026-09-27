// Local component integration with simulated transport; real SQL/API tested in followups.test.mjs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:[new URL('./followups.fixture.tsx',import.meta.url).pathname],bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','application/javascript');res.end(bundle.outputFiles[0].text)}else if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css)}else {res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],executablePath:process.env.ALMADINA_BROWSER_EXECUTABLE || undefined});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.setDefaultTimeout(10000);
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
let rows=[],calls=[],drop=true,throttle=true,uploads=new Map(),bodies=[];
await page.route('**/api/almadina/**',async route=>{
 const req=route.request(),path=new URL(req.url()).pathname.replace('/api/almadina/',''),body=req.postDataJSON(),account=req.headers()['x-almadina-account'];
 calls.push({path,account});
 const ok=data=>route.fulfill({status:200,json:data});
 if(account==='other')return ok({followups:[],nextCursor:null});
 if(path==='followups/uploads'){const id=body.requestId;uploads.set(id,{id,name:body.name,mimeType:body.mimeType,size:body.size,chunkCount:body.chunkCount,parts:[]});return ok({uploadId:id,chunkSize:262144})}
 if(path.includes('/chunks')){uploads.get(path.split('/')[2]).parts[body.index]=body.dataBase64;return ok({ok:true})}
 if(path.startsWith('followups/attachments/')){const file=uploads.get(path.split('/')[2]),index=Number(new URL(req.url()).searchParams.get('chunk'));return ok({attachment:file,index,chunkCount:file.chunkCount,dataBase64:file.parts[index]})}
 if(path.endsWith('/status')){rows[0]={...rows[0],...body};return ok({followup:rows[0]})}
 if(path==='followups'&&req.method()==='POST'){
 bodies.push(body);let item=rows.find(x=>x.requestId===body.requestId);
 if(!item){item={...body,id:'ticket-1',creatorId:'owner',creatorName:'تاجر تجريبي',status:'open',response:'',createdAt:'2026-09-27T12:00:00Z',updatedAt:'2026-09-27T12:00:00Z',attachments:body.attachmentIds.map(id=>uploads.get(id))};rows.push(item)}
 if(drop){drop=false;return route.abort('failed')}if(throttle){throttle=false;return route.fulfill({status:429,json:{error:'انتظر قليلًا وأعد المحاولة.'}})}return ok({followup:item});
 }
 return ok({followups:rows,nextCursor:null});
});
try{
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'إنشاء متابعة',exact:true}).click();
 await page.getByRole('button',{name:'بدء التسجيل',exact:true}).click();
 await page.getByRole('button',{name:'إيقاف التسجيل',exact:true}).waitFor();
 await page.waitForTimeout(650);
 await page.getByRole('button',{name:'إيقاف التسجيل',exact:true}).click();
 await page.getByRole('button',{name:/إزالة تسجيل-/}).waitFor();
 await page.getByRole('button',{name:/إزالة تسجيل-/}).click();
 await page.getByLabel('نوع المتابعة',{exact:true}).selectOption('delivery-delay');
 assert.equal(await page.getByLabel('نوع المتابعة',{exact:true}).locator('option').count(),8);
 await page.getByLabel('عنوان المتابعة',{exact:true}).fill('تأخر توصيل الطرد');
 await page.getByLabel('الوصف',{exact:true}).fill('يرجى متابعة موعد التوصيل مع المندوب.');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
 await page.getByLabel('اختيار صور من المعرض').setInputFiles({name:'parcel.png',mimeType:'image/png',buffer:png});
 assert.equal(await page.getByRole('button',{name:'إزالة parcel.png',exact:true}).count(),1);
 for(const [w,h] of [[320,568],[390,844],[800,600],[1100,720],[390,390]]){
  await page.setViewportSize({width:w,height:h});
  const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.width<=w&&bounds.height<=h&&bounds.x>=0,JSON.stringify(bounds));
  await page.getByRole('button',{name:'تأكيد',exact:true}).scrollIntoViewIfNeeded();
  const button=await page.getByRole('button',{name:'تأكيد',exact:true}).boundingBox();assert.ok(button.y>=0&&button.y+button.height<=h+1,'Submit reachable '+w+'x'+h);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('dialog').evaluate(el=>el.scrollTop=0);
 await mkdir('verification/followups',{recursive:true});
 await page.screenshot({path:'verification/followups/web-form-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'تأكيد',exact:true}).click();
 await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).waitFor();
 assert.equal(await page.getByLabel('عنوان المتابعة',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'انتظر قليلًا'}).waitFor();
 assert.equal(await page.getByLabel('عنوان المتابعة',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).click();
 await page.getByRole('dialog',{name:'تفاصيل المتابعة'}).waitFor();
 assert.equal(rows.length,1);assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[1],bodies[2]);
 assert.equal(await page.getByRole('button',{name:'حفظ الرد والحالة'}).count(),0);
 await page.getByRole('button',{name:/parcel.png.*ميغابايت/}).click();
 await page.getByRole('link',{name:'تنزيل المرفق'}).waitFor();
 assert.deepEqual(Buffer.from(uploads.values().next().value.parts[0],'base64'),png);
 await page.getByRole('button',{name:'إغلاق',exact:true}).click();
 await page.locator('#admin').click();await page.locator('.followup-row').click();
 await page.getByLabel('حالة المتابعة',{exact:true}).selectOption('in_progress');
 await page.getByLabel('الرد على صاحب المتابعة').fill('جارٍ التواصل مع المندوب.');
 await page.getByRole('button',{name:'حفظ الرد والحالة'}).click();
 await page.getByText('رد فريق المتابعة',{exact:true}).waitFor();assert.equal(rows[0].status,'in_progress');
 await page.getByRole('button',{name:'إغلاق',exact:true}).click();
 await page.locator('#inbox').click();await page.locator('.followup-row').waitFor();
 await page.locator('#other').click();await page.getByText('لا توجد متابعات حتى الآن.').waitFor();
 assert.ok(calls.every(c=>['owner','admin','other'].includes(c.account)));
 assert.deepEqual(errors,[]);
 console.log('PASS: StrictMode, RTL 5 viewport sizes, keyboard-height layout, 7 types, browser recording with synthetic microphone, image upload/private preview, lost-response idempotent retry, staff response, global inbox, account isolation.');
}catch(error){console.error('UI errors:',errors);console.error((await page.locator('body').innerText()).slice(0,5000));await page.screenshot({path:process.env.ALMADINA_BROWSER_FAILURE_SCREENSHOT || '/tmp/almadina-followups-browser-failure.png'});throw error;}finally{await browser.close();await new Promise(r=>server.close(r))}
