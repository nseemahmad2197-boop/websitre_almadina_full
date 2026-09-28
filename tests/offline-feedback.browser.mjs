import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:[new URL('./followups.fixture.tsx',import.meta.url).pathname],bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const css=(await readFile(new URL('../app/globals.css',import.meta.url),'utf8')).replace('@import "tailwindcss";','');
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/fixture.js'?'application/javascript':req.url==='/fixture.css'?'text/css':'text/html');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:req.url==='/fixture.css'?css:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.ALMADINA_BROWSER_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let item={id:'ticket-a',orderId:'parcel-1',creatorId:'owner',creatorName:'تاجر تجريبي',title:'متابعة التجربة',description:'متابعة موعد الوصول',type:'delivery-delay',status:'open',response:'',createdAt:'2026-09-27T12:00:00Z',updatedAt:'2026-09-27T12:00:00Z',attachments:[]};
let mode='success',calls=0,release;
await page.route('**/api/almadina/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/status')){
  calls++;const body=route.request().postDataJSON();
  if(mode==='hold')await new Promise(r=>release=r);
  if(mode==='server')return route.fulfill({status:503,json:{error:'الخادم غير متاح مؤقتًا'}});
  if(mode==='forbidden')return route.fulfill({status:403,json:{error:'ليس لديك صلاحية'}});
  if(mode==='malformed')return route.fulfill({status:200,json:{followup:{id:item.id}}});
  if(mode==='lost')return route.abort('failed');
  item={...item,...body};return route.fulfill({json:{followup:item}});
 }
 if(path.endsWith('/comments'))return route.fulfill({json:{comments:[],nextCursor:null}});
 if(path.endsWith('/ticket-a'))return route.fulfill({json:{followup:item}});
 return route.fulfill({json:{followups:[item],nextCursor:null}});
});
try {
 await mkdir('verification/offline-feedback',{recursive:true});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('#courier').click();await page.locator('.followup-row').click();
 const form=page.locator('.followup-response-form'),input=form.getByLabel('الرد على صاحب المتابعة'),send=form.getByRole('button',{name:'حفظ الرد والحالة',exact:true});
 await input.fill('سوف نقوم في متابعة الطرد');
 mode='hold';await send.click();await form.getByRole('button',{name:'جارٍ حفظ الرد والحالة…'}).waitFor();
 assert.equal(await input.isDisabled(),true);assert.equal(calls,1);
 await page.screenshot({path:'verification/offline-feedback/sending.png'});
 release();await form.getByText('تم حفظ الرد والحالة بنجاح.',{exact:true}).waitFor();assert.equal(calls,1);
 await form.screenshot({path:'verification/offline-feedback/saved.png'});
 console.log('PASS courier pending and confirmed success');
 for(const failure of ['server','forbidden','malformed','lost']) {
  mode=failure;await input.fill('نص محفوظ '+failure);await send.click();await form.locator('[role="alert"]').waitFor();
  assert.equal(await input.inputValue(),'نص محفوظ '+failure);assert.equal(await form.locator('.followup-save-success').count(),0);
 }
 console.log('PASS server, permission, malformed receipt and dropped response preserve text without false success');
 const before=calls;await context.setOffline(true);await form.getByText('لا يوجد اتصال بالإنترنت',{exact:true}).waitFor();
 assert.equal(await send.isDisabled(),true);assert.equal(await input.inputValue(),'نص محفوظ lost');
 await page.screenshot({path:'verification/offline-feedback/offline-light.png'});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await form.screenshot({path:'verification/offline-feedback/offline-dark.png'});
 await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);await send.waitFor();assert.equal(calls,before);
 mode='success';await send.click();await form.locator('.followup-save-success').waitFor();
 console.log('PASS live offline/online, draft retention and manual-only retry');
 await page.getByRole('button',{name:'إغلاق',exact:true}).click();await page.locator('#admin').click();await page.locator('.followup-row').click();
 await input.fill('رد المسؤول');await send.click();await form.locator('.followup-save-success').waitFor();
 await page.setViewportSize({width:1280,height:900});await context.setOffline(true);await form.getByText('لا يوجد اتصال بالإنترنت',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'verification/offline-feedback/admin-desktop.png'});
 assert.deepEqual(errors,[]);console.log('PASS admin feedback and responsive offline layout');
} finally {await browser.close();await new Promise(r=>server.close(r))}
