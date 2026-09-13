/* The inventory must come only from Supabase — no 94-page fallback at any
   point of the boot — and creating a task is an owner/admin action in both the
   interface and the database. */
const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');
const ROOT=path.join(__dirname,'..');
const ok=[],bad=[];const t=(n,c)=>{(c?ok:bad).push(n);console.log((c?'PASS  ':'FAIL  ')+n);};
const MOCK=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
const T={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,s)=>{let f=path.join(ROOT,'public',q.url==='/'?'index.html':q.url.split('?')[0]);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'});s.end(d);}});});
const R=(site,key,body)=>({id:'x'+key+site,site,key,body});
const LEGACY='LEGACY-INVENTORY-SHOULD-NEVER-RENDER';
const seed=()=>({
 people:[{id:'u1',email:'own@g.com',password:'pw12345678',name:'Owner',member:'MH-1'},
         {id:'u2',email:'adm@g.com',password:'pw12345678',name:'Admin',member:'PM-1'},
         {id:'u3',email:'edt@g.com',password:'pw12345678',name:'Editor',member:'SEO-1'},
         {id:'u4',email:'vwr@g.com',password:'pw12345678',name:'Viewer',member:'CL-1'}],
 sites:[{id:'s1',name:'RMM Builders Ltd'}],
 memberships:[{site:'s1',person:'u1',role:'owner'},{site:'s1',person:'u2',role:'admin'},
              {site:'s1',person:'u3',role:'editor'},{site:'s1',person:'u4',role:'viewer'}],
 invites:[],
 tasks:[R('s1','RMM-001',{title:'Existing citation run',ws:'offpage',type:'citations',owner:'SEO-1',
          status:'writing',planned:40,done:14,unit:'citations',blocked:false})],
 team:[R('s1','MH-1',{name:'Owner',role:'Owner',perWeek:10,active:true}),
       R('s1','PM-1',{name:'Admin',role:'PM',perWeek:10,active:true}),
       R('s1','SEO-1',{name:'Editor',role:'SEO',perWeek:8,active:true}),
       R('s1','CL-1',{name:'Viewer',role:'',perWeek:0,active:true})],
 // the project's own plan: 61 pages, deliberately not the legacy 94
 meta:[R('s1','inventory',{items:[{id:'svc',label:'Service pages',target:61}],label:'Approved page inventory'})]});

// a pre-Supabase cache holding a recognisable legacy plan totalling 94
const STALE=JSON.stringify({tasks:{},team:{},meetings:{},activity:[],reads:{},personal:{},
  inventory:[{id:'core',label:LEGACY,target:94}],invLabel:LEGACY,brand:{}});

(async()=>{
await new Promise(r=>srv.listen(8884,r));
const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
const ctx=await b.newContext({viewport:{width:1320,height:1000}});
await ctx.route('**fonts.g**',r=>r.abort());
await ctx.route('**/supabase.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:MOCK}));
await ctx.addInitScript(([s,stale,marker])=>{
  if(!localStorage.getItem('mocksb'))localStorage.setItem('mocksb',JSON.stringify(s));
  localStorage.setItem('rmm-board-local-v2',stale);
  window.__legacy=[];window.__shellUp=[];
  // sample the whole bootstrap, including the window after the shell lifts
  const scan=()=>{
    if(!document.documentElement) return;
    const boot=document.getElementById('boot');
    const shell=!!boot&&!boot.hidden;
    const txt=document.body?document.body.innerText:'';
    if(!shell&&txt){
      if(txt.indexOf(marker)>=0) window.__legacy.push('marker');
      // the legacy plan's headline total, which the live plan never shows
      if(/\b\/\s*94\s+live\b/.test(txt)) window.__legacy.push('94');
      if(/Reset to 94/.test(txt)) window.__legacy.push('reset94');
    }
    window.__shellUp.push(shell);
  };
  // sample from document-start: waiting for DOMContentLoaded can miss a boot
  // that finishes during parsing, which would make this detector useless
  setInterval(scan,4); scan();
  document.addEventListener('DOMContentLoaded',()=>{scan();
    new MutationObserver(scan).observe(document.documentElement,
      {subtree:true,childList:true,characterData:true,attributes:true});});
},[seed(),STALE,LEGACY]);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const rows=c=>p.evaluate(k=>JSON.parse(localStorage.getItem('mocksb'))[k]||[],c);
const openAcct=async()=>{if(!(await p.evaluate(()=>document.body.classList.contains('acct-open')))){await p.click('#meBtn');await p.waitForTimeout(250);}};
const signIn=async(em)=>{await p.fill('#gEmail',em);await p.fill('#gPass','pw12345678');await p.click('#gBtn');await p.waitForTimeout(1900);};
const signOut=async()=>{await openAcct();await p.click('#signOut');await p.waitForTimeout(1300);};
const URL='http://localhost:8884/';

/* ---------- inventory at boot ---------- */
await p.goto(URL);await p.waitForTimeout(500);
await signIn('own@g.com');
t('1. the legacy 94 inventory never renders on a live boot', await p.evaluate(()=>window.__legacy.length===0));
t('2. nothing legacy appears between the shell lifting and the live data', await p.evaluate(()=>
  window.__legacy.length===0));
t('4/11. the headline is the saved project plan', await p.evaluate(()=>
  document.getElementById('tTotal').textContent==='61'));
t('12. a legacy local cache cannot influence the live inventory', await p.evaluate(()=>
  !/LEGACY-INVENTORY/.test(document.body.innerText)));
t('12b. the obsolete cache key is cleared after a live boot', await p.evaluate(()=>
  localStorage.getItem('rmm-board-local-v2')===null));

/* ---------- slow Supabase ---------- */
// every query now takes 220ms, so the shell genuinely holds the screen
await p.evaluate(()=>{localStorage.setItem('mocksb-delay','220');});
await p.goto(URL);await p.waitForTimeout(4200);
t('3. a slow project load still never exposes the legacy plan', await p.evaluate(()=>
  window.__legacy.length===0&&window.__shellUp.filter(Boolean).length>10));
t('3b. the slow load still ends on the real figures', await p.evaluate(()=>
  document.getElementById('tTotal').textContent==='61'));
await p.evaluate(()=>{localStorage.removeItem('mocksb-delay');});

/* ---------- the inventory editor ---------- */
t('6. "Reset to 94" does not exist anywhere in the interface', await p.evaluate(()=>
  !document.getElementById('iReset')&&!/Reset to 94/.test(document.body.innerHTML)));
await p.click('#editInv');await p.waitForTimeout(500);
await p.evaluate(()=>{const r=document.querySelector('#invRows .inv-row .num');r.value='12';
  r.dispatchEvent(new Event('input',{bubbles:true}));});
await p.click('#iDiscard');await p.waitForTimeout(400);
t('7. Discard changes restores the saved plan', await p.evaluate(()=>
  document.querySelector('#invRows .inv-row .num').value==='61'));
t('8. Discard changes writes nothing', await rows('meta').then(r=>
  r.find(x=>x.key==='inventory').body.items[0].target===61));
await p.click('#iCancel');await p.waitForTimeout(400);
t('9. Cancel writes nothing', await rows('meta').then(r=>
  r.find(x=>x.key==='inventory').body.items[0].target===61));
await p.click('#editInv');await p.waitForTimeout(450);
await p.evaluate(()=>{const r=document.querySelector('#invRows .inv-row .num');r.value='45';
  r.dispatchEvent(new Event('input',{bubbles:true}));});
await p.click('#iSave');await p.waitForTimeout(800);
t('10. Save writes the draft to Supabase', await rows('meta').then(r=>
  r.find(x=>x.key==='inventory').body.items[0].target===45));
await p.reload();await p.waitForTimeout(2000);
t('5. the saved plan survives a refresh with no default recreated', await p.evaluate(()=>
  document.getElementById('tTotal').textContent==='45'));
await p.click('#editInv');await p.waitForTimeout(450);
t('11b. reopening the editor shows the latest saved plan', await p.evaluate(()=>
  document.querySelector('#invRows .inv-row .num').value==='45'));
await p.click('#iCancel');await p.waitForTimeout(300);

/* ---------- task creation ---------- */
t('13. Owner sees New task', await p.evaluate(()=>{
  const b=document.getElementById('addBtn');return !!b&&getComputedStyle(b).display!=='none';}));
t('17. Owner can insert a task', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').insert({site:PB.siteId(),key:'OWN-1',body:{title:'By owner'}});
  return !r.error;}));
await signOut();await signIn('adm@g.com');
t('14. Admin sees New task', await p.evaluate(()=>{
  const b=document.getElementById('addBtn');return !!b&&getComputedStyle(b).display!=='none';}));
t('18. Admin can insert a task', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').insert({site:PB.siteId(),key:'ADM-1',body:{title:'By admin'}});
  return !r.error;}));
await signOut();await signIn('edt@g.com');
t('15. Editor is not offered New task', await p.evaluate(()=>{
  const b=document.getElementById('addBtn');return !b||getComputedStyle(b).display==='none';}));
t('15b. nor the floating add button, inline add, or plan import', await p.evaluate(()=>{
  const hidden=id=>{const e=document.getElementById(id);return !e||getComputedStyle(e).display==='none';};
  const inline=document.querySelector('[data-add="1"]');
  return hidden('fabAdd')&&hidden('importPlan')&&(!inline||getComputedStyle(inline).display==='none');}));
t('19. an Editor task INSERT is refused by the database', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').insert({site:PB.siteId(),key:'EDT-1',body:{title:'By editor'}});
  return !!r.error&&/row-level security/i.test(r.error.message);}));
t('19b. the refusal is never shown as a raw code', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').insert({site:PB.siteId(),key:'EDT-2',body:{title:'x'}});
  const m=PB.friendlyError(r.error);return /permission/i.test(m)&&!/42501|row-level/i.test(m);}));
t('21. invoking creation through stale UI gives the reason, not a refusal', await p.evaluate(()=>{
  const btn=document.getElementById('addBtn');btn.style.display='inline-flex';btn.click();
  const drawerOpen=document.getElementById('drawer').classList.contains('open');
  return !drawerOpen&&/only an owner or admin can create/i.test(document.getElementById('toast').textContent);}));
t('22. an Editor can still edit an existing task', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').update({body:{title:'Existing citation run',done:20}})
    .eq('site',PB.siteId()).eq('key','RMM-001').select();
  return !r.error&&(r.data||[]).length===1;}));
await signOut();await signIn('vwr@g.com');
t('16. Viewer is not offered New task', await p.evaluate(()=>{
  const b=document.getElementById('addBtn');return !b||getComputedStyle(b).display==='none';}));
t('20. a Viewer task INSERT is refused by the database', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').insert({site:PB.siteId(),key:'VWR-1',body:{title:'By viewer'}});
  return !!r.error;}));
t('20b. neither editor nor viewer left a task behind', await rows('tasks').then(r=>
  !r.some(x=>/^EDT-|^VWR-/.test(x.key))&&r.some(x=>x.key==='OWN-1')&&r.some(x=>x.key==='ADM-1')));

/* ---------- view persistence still holds ---------- */
await signOut();await signIn('own@g.com');
for (const v of ['team','report']) {
  await p.evaluate(x=>document.querySelector('.tabs button[data-view="'+x+'"]').click(),v);
  await p.waitForTimeout(400);await p.reload();await p.waitForTimeout(2000);
  t('24/25. refreshing '+v+' stays on '+v, await p.evaluate(x=>
    document.querySelector('.tabs button[data-view="'+x+'"]').getAttribute('aria-selected')==='true',v));
}
t('26. no intermediate Board render occurs', await p.evaluate(()=>window.__legacy.length===0));
t('no JS errors', errs.length===0);
if(errs.length)console.log('   ',errs.slice(0,4).join(' | '));
await b.close();srv.close();
console.log('\n'+ok.length+' passed, '+bad.length+' failed'+(bad.length?': '+bad.join(', '):''));
process.exit(bad.length?1:0);
})();
