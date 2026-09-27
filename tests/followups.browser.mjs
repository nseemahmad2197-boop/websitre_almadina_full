// Real React/CSS and Chromium media execution with a local simulated transport.
// Server authorization, persisted SQL and idempotency are tested separately.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:[new URL('./followups.fixture.tsx',import.meta.url).pathname],bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const css=(await readFile(new URL('../app/globals.css',import.meta.url),'utf8')).replace('@import "tailwindcss";','');
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','application/javascript');res.end(bundle.outputFiles[0].text)}else if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css)}else {res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],executablePath:process.env.ALMADINA_BROWSER_EXECUTABLE || undefined});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
let rows=[],calls=[],drop=true,throttle=true,incomplete=true,uploads=new Map(),bodies=[],editBodies=[],commentBodies=[],comments=[],commentDrop=true,editConflict=false,editDrop=true,edits=new Map(),older=false;
const expose=(item,account)=>({...item,canEdit:account===item.creatorId&&item.status!=='resolved'});
await page.route('**/api/almadina/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/almadina/',''),body=req.postDataJSON(),account=req.headers()['x-almadina-account'];calls.push({path,account});
 const ok=data=>route.fulfill({status:200,json:data});
 if(account==='other')return ok({followups:[],nextCursor:null});
 if(path==='followups/uploads'){const id=body.requestId;uploads.set(id,{id,name:body.name,mimeType:body.mimeType,size:body.size,chunkCount:body.chunkCount,parts:[]});return ok({uploadId:id,chunkSize:262144})}
 if(path.includes('/chunks')){uploads.get(path.split('/')[2]).parts[body.index]=body.dataBase64;return ok({ok:true})}
 if(path.startsWith('followups/attachments/')){const file=uploads.get(path.split('/')[2]),index=Number(url.searchParams.get('chunk'));return ok({attachment:file,index,chunkCount:file.chunkCount,dataBase64:file.parts[index]})}
 if(path.endsWith('/comments')){
  if(req.method()==='GET')return ok({comments:older&&!url.searchParams.has('cursor')?comments.slice(-1):older?comments.slice(0,-1):comments,nextCursor:older&&!url.searchParams.has('cursor')?'older':null});
  commentBodies.push(body);let comment=comments.find(x=>x.requestId===body.requestId);
  if(!comment){comment={...body,id:'comment-'+(comments.length+1),followupId:rows[0].id,authorId:account,authorName:'تاجر تجريبي',authorRole:'merchant',createdAt:'2026-09-27T13:30:00Z',attachments:body.attachmentIds.map(id=>uploads.get(id))};comments.push(comment)}
  if(commentDrop){commentDrop=false;return route.abort('failed')}return ok({comment});
 }
 if(path.endsWith('/edit')){
  editBodies.push(body);if(editConflict)return route.fulfill({status:409,json:{error:'تم تحديث المتابعة'}});
  let item=edits.get(body.requestId);
  if(!item){rows[0]={...rows[0],...body,updatedAt:'2026-09-27T13:00:00Z',attachments:body.attachmentIds.map(id=>uploads.get(id))};item=rows[0];edits.set(body.requestId,item)}
  if(editDrop){editDrop=false;return route.abort('failed')}return ok({followup:expose(item,account)});
 }
 if(path.endsWith('/status')){rows[0]={...rows[0],...body};return ok({followup:expose(rows[0],account)})}
 if(path==='followups'&&req.method()==='POST'){
  bodies.push(body);let item=rows.find(x=>x.requestId===body.requestId);
  if(!item){item={...body,id:'ticket-'+(rows.length+1),ticketNumber:'TK-94012',trackingNumber:'ALX-TEST-001',creatorId:'owner',creatorName:'تاجر تجريبي',status:'open',response:'',createdAt:'2026-09-27T12:00:00Z',updatedAt:'2026-09-27T12:00:00Z',attachments:body.attachmentIds.map(id=>uploads.get(id))};rows.push(item)}
  if(drop){drop=false;return route.abort('failed')}if(throttle){throttle=false;return route.fulfill({status:429,json:{error:'انتظر قليلًا وأعد المحاولة.'}})}if(incomplete){incomplete=false;return ok({followup:{...expose(item,account),requestedPrice:undefined}})}return ok({followup:expose(item,account)});
 }
 if(path.startsWith('followups/')&&req.method()==='GET')return ok({followup:expose(rows.find(item=>item.id===path.split('/')[1]),account)});
 return ok({followups:rows.map(item=>expose(item,account)),nextCursor:null});
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
const setImage=label=>page.getByLabel(label,{exact:true}).setInputFiles({name:'parcel.png',mimeType:'image/png',buffer:png});
async function noOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}
try{
 await mkdir('verification/reference-followups',{recursive:true});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'إنشاء متابعة',exact:true}).click();
 assert.equal(await page.getByLabel('عنوان المتابعة',{exact:true}).inputValue(),'متابعة طرد ALX-TEST-001');
 assert.equal(await page.getByLabel('رقم الطرد',{exact:true}).getAttribute('readonly'),'');
 assert.equal(await page.getByLabel('نوع المتابعة',{exact:true}).locator('option').count(),8);
 await page.getByLabel('نوع المتابعة',{exact:true}).selectOption('address-change');
 await page.getByLabel('عنوان المستلم المطلوب',{exact:true}).fill('رام الله، شارع الإرسال');
 await page.getByLabel('نوع المتابعة',{exact:true}).selectOption('damaged');
 assert.equal(await page.getByLabel('عنوان المستلم المطلوب',{exact:true}).count(),0);
 await page.getByLabel('الوصف',{exact:true}).fill('يرجى مراجعة طلب تعديل السعر.');
 await page.getByRole('button',{name:'تأكيد',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'أرفق صورة'}).waitFor();assert.equal(bodies.length,0);
 await page.getByRole('button',{name:'بدء التسجيل',exact:true}).click();
 await page.getByRole('button',{name:'إيقاف التسجيل',exact:true}).waitFor();await page.waitForTimeout(650);
 await page.getByRole('button',{name:'إيقاف التسجيل',exact:true}).click();
 await page.getByRole('button',{name:/إزالة تسجيل-/}).waitFor();
 assert.equal(await page.locator('.followup-draft-file audio').count(),1);
 await page.getByRole('button',{name:/إزالة تسجيل-/}).click();
 await page.getByLabel('نوع المتابعة',{exact:true}).selectOption('price-change');
 await page.getByLabel('السعر المطلوب',{exact:true}).fill('١٢٠٫٥٠');
 await setImage('اختيار صور من المعرض');
 await page.getByRole('img',{name:'معاينة parcel.png',exact:true}).waitFor();
 for(const [w,h] of [[320,568],[390,844],[800,600],[1100,720],[390,390]]){
  await page.setViewportSize({width:w,height:h});const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.width<=w&&bounds.height<=h&&bounds.x>=0,JSON.stringify(bounds));
  await page.getByRole('button',{name:'تأكيد',exact:true}).scrollIntoViewIfNeeded();const button=await page.getByRole('button',{name:'تأكيد',exact:true}).boundingBox();assert.ok(button.y>=0&&button.y+button.height<=h+1,'Submit reachable '+w+'x'+h);await noOverflow();
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('dialog').evaluate(el=>el.scrollTop=0);
 await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-create-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-create-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'تأكيد',exact:true}).click();
 await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).waitFor();assert.equal(await page.getByLabel('عنوان المتابعة',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).click();await page.getByRole('alert').filter({hasText:'انتظر قليلًا'}).waitFor();
 assert.equal(await page.getByLabel('عنوان المتابعة',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'لم يصل تأكيد الحفظ كاملًا'}).waitFor();assert.equal(await page.getByLabel('عنوان المتابعة',{exact:true}).isDisabled(),true);await page.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).click();
 await page.getByRole('dialog',{name:'تم إنشاء المتابعة بنجاح'}).waitFor();
 assert.equal(rows.length,1);assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[1],bodies[2]);assert.deepEqual(bodies[2],bodies[3]);assert.equal(bodies[0].detailsVersion,1);assert.equal(bodies[0].requestedPrice,'120.5');assert.equal('requestedAddress' in bodies[0],false);
 await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-success-mobile.png',fullPage:true});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-success-dark-mobile.png',fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.theme);await page.setViewportSize({width:1280,height:1000});await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-success-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'عرض المتابعة',exact:true}).click();await page.getByRole('dialog',{name:'تفاصيل المتابعة'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'حفظ الرد والحالة'}).count(),0);await page.getByRole('button',{name:'تعديل المتابعة',exact:true}).waitFor();
 await page.getByRole('button',{name:/parcel.png.*ميغابايت/}).click();await page.getByRole('link',{name:'تنزيل المرفق'}).waitFor();
 assert.deepEqual(Buffer.from(uploads.values().next().value.parts[0],'base64'),png);await page.getByRole('button',{name:'إغلاق المعاينة'}).click();
 await page.getByRole('dialog').evaluate(el=>el.scrollTop=0);await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-details-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-details-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'تعديل المتابعة',exact:true}).click();const edit=page.getByRole('dialog',{name:'تعديل المتابعة',exact:true});
 assert.equal(await edit.getByLabel('نوع المتابعة',{exact:true}).isDisabled(),true);assert.equal(await edit.getByLabel('السعر المطلوب',{exact:true}).inputValue(),'120.5');
 await edit.getByLabel('السعر المطلوب',{exact:true}).fill('145');await edit.getByRole('button',{name:'إزالة parcel.png',exact:true}).click();
 await edit.getByRole('button',{name:'تعديل المتابعة',exact:true}).click();await edit.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).waitFor();
 assert.equal(await edit.getByLabel('السعر المطلوب',{exact:true}).isDisabled(),true);await edit.getByRole('button',{name:'إعادة محاولة التأكيد',exact:true}).click();
 await edit.waitFor({state:'detached'});assert.deepEqual(editBodies[0],editBodies[1]);assert.equal(rows[0].requestedPrice,'145');assert.equal(rows[0].attachments.length,0);
 editConflict=true;await page.getByRole('button',{name:'تعديل المتابعة',exact:true}).click();await edit.getByLabel('الوصف',{exact:true}).fill('تعديل قديم');await edit.getByRole('button',{name:'تعديل المتابعة',exact:true}).click();
 await edit.getByRole('alert').filter({hasText:'أغلق نموذج التعديل'}).waitFor();assert.equal(await edit.getByRole('button',{name:'تعديل المتابعة',exact:true}).isDisabled(),true);await edit.getByRole('button',{name:'إغلاق',exact:true}).click();editConflict=false;
 await page.getByRole('button',{name:'تحديث المتابعة',exact:true}).click();
 await page.getByLabel('رسالتك',{exact:true}).fill('يرجى تأكيد استلام طلب السعر الجديد.');await page.getByRole('button',{name:'إضافة صور أو صوت أو فيديو'}).click();await setImage('الرسالة: اختيار صور من المعرض');
 await page.getByRole('button',{name:'إرسال الرسالة',exact:true}).click();await page.getByRole('button',{name:'إعادة تأكيد الرسالة',exact:true}).waitFor();assert.equal(await page.getByLabel('رسالتك',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'إعادة تأكيد الرسالة',exact:true}).click();await page.locator('.followup-comment').waitFor();assert.equal(comments.length,1);assert.deepEqual(commentBodies[0],commentBodies[1]);assert.equal(await page.locator('.followup-comment').count(),1);
 await page.locator('.followup-comment').getByRole('button',{name:/parcel.png/}).click();await page.getByRole('link',{name:'تنزيل المرفق'}).waitFor();
 comments.unshift({id:'comment-old',followupId:rows[0].id,authorId:'admin',authorName:'فريق الدعم',authorRole:'admin',text:'وصل طلبك وسنراجعه.',createdAt:'2026-09-27T12:30:00Z',attachments:[]});older=true;
 await page.getByRole('button',{name:'تحديث المحادثة',exact:true}).click();await page.getByRole('button',{name:'عرض الرسائل الأقدم',exact:true}).click();await page.getByText('وصل طلبك وسنراجعه.',{exact:true}).waitFor();
 assert.match(await page.locator('.followup-comment').first().innerText(),/وصل طلبك/);assert.equal(await page.locator('.followup-comment').count(),2);
 await page.setViewportSize({width:390,height:844});await page.locator('.followup-conversation').scrollIntoViewIfNeeded();await noOverflow();await page.screenshot({animations:'disabled',path:'verification/reference-followups/web-conversation-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'إغلاق',exact:true}).click();await page.locator('#admin').click();await page.locator('.followup-row').click();
 assert.equal(await page.getByRole('button',{name:'تعديل المتابعة',exact:true}).count(),0);
 await page.getByLabel('حالة المتابعة',{exact:true}).selectOption('in_progress');await page.getByLabel('الرد على صاحب المتابعة').fill('جارٍ التواصل مع المندوب.');await page.getByRole('button',{name:'حفظ الرد والحالة'}).click();
 await page.getByText('رد فريق المتابعة',{exact:true}).waitFor();assert.equal(rows[0].status,'in_progress');
 await page.getByRole('button',{name:'تحديث المحادثة',exact:true}).click();assert.equal(await page.getByText('رد فريق المتابعة',{exact:true}).count(),1);
 await page.getByRole('button',{name:'إغلاق',exact:true}).click();await page.locator('#inbox').click();await page.locator('.followup-row').waitFor();await page.locator('.followup-row').click();
 await page.evaluate(()=>document.querySelector('#other').click());await page.getByText('لا توجد متابعات حتى الآن.').waitFor();assert.equal(await page.locator('.followup-comment').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
 await page.locator('#owner').click();await page.locator('#parcel').click();await page.getByRole('button',{name:'إنشاء متابعة',exact:true}).click();await page.getByLabel('نوع المتابعة',{exact:true}).selectOption('address-change');await page.getByLabel('الوصف',{exact:true}).fill('يرجى مراجعة العنوان الجديد.');await page.getByLabel('عنوان المستلم المطلوب',{exact:true}).fill('  رام الله، شارع الإرسال  ');await page.getByRole('button',{name:'تأكيد',exact:true}).click();await page.getByRole('dialog',{name:'تم إنشاء المتابعة بنجاح'}).waitFor();assert.equal(bodies.at(-1).requestedAddress,'رام الله، شارع الإرسال');assert.equal('requestedPrice' in bodies.at(-1),false);await page.getByRole('button',{name:'عرض المتابعات',exact:true}).click();await page.getByRole('heading',{name:'طلبات المتابعة',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.followup-row').count(),2);
 assert.ok(calls.every(c=>['owner','admin','other'].includes(c.account)));assert.deepEqual(errors,[]);
 console.log('PASS: real Chromium + simulated transport: StrictMode, RTL five viewports/keyboard height, default title/read-only parcel, conditional fields/Arabic price/evidence, synthetic microphone/draft previews/private downloads, immutable create/edit/comment retries, success dialog, rich details, creator guard/conflict/removal, older conversation paging, staff response, account isolation.');
}catch(error){console.error('UI errors:',errors);console.error((await page.locator('body').innerText()).slice(0,7000));await page.screenshot({animations:'disabled',path:process.env.ALMADINA_BROWSER_FAILURE_SCREENSHOT || '/tmp/almadina-followups-browser-failure.png'});throw error;}finally{await browser.close();await new Promise(r=>server.close(r))}
