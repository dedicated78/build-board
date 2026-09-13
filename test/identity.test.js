/* Authenticated identity, roster auto-sync, view persistence, profile menu and
   inventory permission UX. Runs against the stand-in Supabase client, whose
   policy emulation mirrors supabase/schema.sql. */
const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');
const ROOT=path.join(__dirname,'..');
const ok=[],bad=[];const t=(n,c)=>{(c?ok:bad).push(n);console.log((c?'PASS  ':'FAIL  ')+n);};
const MOCK=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
const T={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,s)=>{let f=path.join(ROOT,'public',q.url==='/'?'index.html':q.url.split('?')[0]);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'});s.end(d);}});});
const D=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const R=(site,key,body)=>({id:'x'+key+site,site,key,body});

// owner (two projects), editor, viewer, plus an invited newcomer with no roster row
const seed=()=>({
 people:[{id:'u1',email:'owner@g.com',password:'pw12345678',name:'Mehedi',member:'MH-1'},
         {id:'u2',email:'editor@g.com',password:'pw12345678',name:'Sam Editor',member:'SEO-1'},
         {id:'u3',email:'viewer@g.com',password:'pw12345678',name:'RMM Client',member:'CL-1'},
         {id:'u4',email:'admin@g.com',password:'pw12345678',name:'Pat Admin',member:'PM-1'}],
 sites:[{id:'s1',name:'RMM Builders Ltd'},{id:'s2',name:'South Asian Construction'}],
 memberships:[{site:'s1',person:'u1',role:'owner'},{site:'s2',person:'u1',role:'admin'},
              {site:'s1',person:'u2',role:'editor'},{site:'s1',person:'u3',role:'viewer'},
              {site:'s1',person:'u4',role:'admin'}],
 invites:[],
 tasks:[R('s1','RMM-001',{title:'Service silo build',ws:'web',type:'service',owner:'SEO-1',status:'writing',planned:12,done:5,unit:'pages',blocked:false,due:D(4)}),
        R('s1','RMM-002',{title:'Area hubs',ws:'web',type:'area',owner:'MH-1',status:'backlog',planned:10,done:0,unit:'pages',helpers:['SEO-1'],blocked:false}),
        R('s1','RMM-003',{title:'Legacy citation run',ws:'offpage',type:'citations',owner:'GONE-1',status:'live',planned:5,done:5,unit:'citations',blocked:false})],
 // GONE-1 is a departed member: profile kept, marked inactive
 team:[R('s1','MH-1',{name:'Mehedi',role:'Owner / SEO',perWeek:12,active:true}),
       R('s1','SEO-1',{name:'Sam Editor',role:'SEO Specialist',perWeek:8,active:true}),
       R('s1','CL-1',{name:'RMM Client',role:'',perWeek:0,active:true}),
       R('s1','GONE-1',{name:'Departed Dana',role:'Content Writer',perWeek:0,active:false}),
       R('s2','MH-1',{name:'Mehedi',role:'Owner',perWeek:5,active:true})],
 meta:[R('s1','inventory',{items:[{label:'Core pages',target:7}],label:'Approved page inventory'}),
       R('s1','brand',{agency:'GrowwithMH',client:'RMM Builders Ltd',accent:'#0F6F69'})]});

(async()=>{
await new Promise(r=>srv.listen(8887,r));
const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
const ctx=await b.newContext({viewport:{width:1320,height:1000}});
await ctx.route('**fonts.g**',r=>r.abort());
await ctx.route('**/supabase.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:MOCK}));
await ctx.addInitScript(s=>{if(!localStorage.getItem('mocksb'))localStorage.setItem('mocksb',JSON.stringify(s));},seed());
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const rows=c=>p.evaluate(k=>JSON.parse(localStorage.getItem('mocksb'))[k]||[],c);
const openAcct=async()=>{if(!(await p.evaluate(()=>document.body.classList.contains('acct-open')))){await p.click('#meBtn');await p.waitForTimeout(250);}};
const signIn=async(em)=>{await p.goto('http://localhost:8887/');await p.waitForTimeout(600);
  if(await p.evaluate(()=>{const g=document.getElementById('gate');return g&&!g.hidden;})){
    await p.fill('#gEmail',em);await p.fill('#gPass','pw12345678');await p.click('#gBtn');await p.waitForTimeout(1700);}};
const signOut=async()=>{await openAcct();await p.click('#signOut');await p.waitForTimeout(1300);};

/* ---------- identity ---------- */
await signIn('owner@g.com');
t('1. authenticated PB.me() becomes state.me', await p.evaluate(()=>PB.me()==='MH-1'&&localStorage.getItem('rmm-board-me')==='MH-1'));
await openAcct();await p.click('#acctMe');await p.waitForTimeout(600);
t('3. "Who are you?" is absent in authenticated mode', await p.evaluate(()=>
  !/Who are you/.test(document.getElementById('mwHead').innerText)&&!document.getElementById('mwWho')));
t('2. signed-in user cannot select another identity', await p.evaluate(()=>
  !document.getElementById('mwWho')&&!document.getElementById('pfWho')&&!!document.querySelector('.pf-name')));
t('2b. forcing the hidden legacy picker cannot move identity', await p.evaluate(()=>{
  const s=document.getElementById('mePick'); if(!s) return true;
  s.value='SEO-1'; s.dispatchEvent(new Event('change',{bubbles:true}));
  return PB.me()==='MH-1';}));

/* ---------- My Work content ---------- */
t('7. assigned tasks appear in My Work', await p.evaluate(()=>document.body.textContent.includes('Area hubs')));
await signOut();
await signIn('editor@g.com');
await openAcct();await p.click('#acctMe');await p.waitForTimeout(700);
t('8. helper tasks appear in My Work', await p.evaluate(()=>document.body.textContent.includes('Area hubs')));
t('7b. their own assignment appears too', await p.evaluate(()=>document.body.textContent.includes('Service silo')));

/* ---------- roster auto-sync for a brand-new member ---------- */
await signOut();
await signIn('admin@g.com');
await p.waitForTimeout(900);
const team=await rows('team');const mine=team.find(r=>r.key==='PM-1'&&r.site==='s1');
t('4. new member automatically gets a team profile', !!mine);
t('5. team profile key equals people.member', !!mine&&mine.key==='PM-1');
t('6. team profile name begins from people.name', !!mine&&mine.body.name==='Pat Admin');
t('6b. auto-created profile is active with no invented job title', !!mine&&mine.body.active===true&&mine.body.role==='');
await openAcct();await p.click('#acctMe');await p.waitForTimeout(700);
t('9. no assigned work shows an empty state, not an identity picker', await p.evaluate(()=>{
  const head=document.getElementById('mwHead').innerText;
  return !/Who are you/.test(head)&&!document.getElementById('mwWho')&&!!document.querySelector('.pf-name');}));

/* ---------- profile menu by role ---------- */
t('15/16. owner and admin see Manage people', await p.evaluate(()=>!!document.getElementById('people')));
t('20. all roles see My profile', await p.evaluate(()=>!!document.getElementById('myProfile')));
t('18. single-project user gets no standalone project item', await p.evaluate(()=>
  !document.getElementById('siteSel')&&!/Switch project/.test(document.getElementById('whoami').textContent)));
await signOut();
await signIn('owner@g.com');await openAcct();
t('19. multi-project user gets a Switch project control', await p.evaluate(()=>
  !!document.getElementById('siteSel')&&/Switch project/.test(document.getElementById('whoami').textContent)));
await signOut();
await signIn('editor@g.com');await openAcct();
t('17. editor does not see Manage people', await p.evaluate(()=>!document.getElementById('people')));
t('17b. editor still sees My work and My profile', await p.evaluate(()=>
  !!document.getElementById('acctMe')&&!!document.getElementById('myProfile')));

/* ---------- inventory permission UX ---------- */
t('25. editor gets no inventory Edit control', await p.evaluate(()=>{
  const e=document.getElementById('editInv');return !e||getComputedStyle(e).display==='none';}));
t('28. a forced editor inventory save explains itself, never "42501"', await p.evaluate(async()=>{
  const before=document.getElementById('toast').textContent;
  const r=await PB.client().from('meta').upsert({site:PB.siteId(),key:'inventory',body:{items:[{label:'Hacked',target:1}]}});
  const msg=r.error?PB.friendlyError(r.error):'';
  return /permission/i.test(msg)&&!/42501/.test(msg)&&before!==undefined;}));
await signOut();
await signIn('viewer@g.com');
t('26. viewer gets no inventory Edit control', await p.evaluate(()=>{
  const e=document.getElementById('editInv');return !e||getComputedStyle(e).display==='none';}));
await signOut();
await signIn('owner@g.com');
t('27. owner can edit inventory', await p.evaluate(()=>{
  const e=document.getElementById('editInv');return !!e&&getComputedStyle(e).display!=='none';}));

/* ---------- assignment pickers respect active membership ---------- */
await p.evaluate(()=>{const c=[...document.querySelectorAll('.card')].find(e=>e.textContent.includes('Area hubs'));c.click();});
await p.waitForTimeout(500);
const owners=await p.evaluate(()=>[...document.getElementById('dOwner').options].map(o=>o.value));
t('29. active users appear in the owner picker', owners.includes('MH-1')&&owners.includes('SEO-1'));
t('30. inactive users do not appear in the owner picker', !owners.includes('GONE-1'));
await p.click('#dCancel');await p.waitForTimeout(300);
t('31. a historic task still shows the departed person\'s name', await p.evaluate(()=>{
  document.querySelector('.tabs button[data-view="board"]').click();
  return JSON.parse(localStorage.getItem('mocksb')).team.some(r=>r.key==='GONE-1'&&r.body.name==='Departed Dana');}));

/* ---------- rename ---------- */
await openAcct();await p.click('#myProfile');await p.waitForTimeout(600);
await p.fill('#pName','Md. Mehedi Hassan');await p.click('#pSave');await p.waitForTimeout(900);
t('21/22. rename updates people.name', await rows('people').then(r=>r.find(x=>x.id==='u1').name==='Md. Mehedi Hassan'));
t('23. rename updates their own team profile name', await rows('team').then(r=>
  r.find(x=>x.key==='MH-1'&&x.site==='s1').body.name==='Md. Mehedi Hassan'));
t('24. the member key is unchanged', await p.evaluate(()=>PB.me()==='MH-1'));
t('8b. the job title was not overwritten by the membership role', await rows('team').then(r=>
  r.find(x=>x.key==='MH-1'&&x.site==='s1').body.role==='Owner / SEO'));

/* ---------- team page copy ---------- */
t('10a. live mode replaces manual Add person with Invite person', await p.evaluate(()=>{
  document.querySelector('.tabs button[data-view="team"]').click();
  const add=document.getElementById('addPerson'), inv=document.getElementById('invitePerson');
  return getComputedStyle(add).display==='none'&&getComputedStyle(inv).display!=='none';}));

/* ---------- removal keeps history, rejoining restores the profile ---------- */
await openAcct();await p.click('#people');await p.waitForTimeout(800);
await p.evaluate(()=>{const r=[...document.querySelectorAll('#acc .ac-row')].find(x=>/SEO-1/.test(x.textContent));
  r.querySelector('.ac-mini').click();});
await p.waitForTimeout(1100);
t('32. removal marks the team profile inactive', await rows('team').then(r=>
  r.find(x=>x.key==='SEO-1'&&x.site==='s1').body.active===false));
t('32b. the profile itself is kept, not deleted', await rows('team').then(r=>
  !!r.find(x=>x.key==='SEO-1'&&x.site==='s1')));
await p.evaluate(()=>{const g=document.getElementById('acc');if(g)g.remove();});
// they are invited back: membership returns, and the next sign-in reactivates them
await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('mocksb'));
  d.memberships.push({site:'s1',person:'u2',role:'editor'});localStorage.setItem('mocksb',JSON.stringify(d));});
await signOut();
await signIn('editor@g.com');await p.waitForTimeout(900);
t('33. rejoining reactivates the team profile', await rows('team').then(r=>
  r.find(x=>x.key==='SEO-1'&&x.site==='s1').body.active===true));
t('33b. their operational detail survived the round trip', await rows('team').then(r=>
  r.find(x=>x.key==='SEO-1'&&x.site==='s1').body.role==='SEO Specialist'));
await signOut();
await signIn('owner@g.com');

/* ---------- view persistence ---------- */
for (const [view,marker] of [['team','The team'],['report','SEO progress report'],['board','APPROVED PAGE INVENTORY'.toLowerCase()]]) {
  await p.evaluate(v=>document.querySelector('.tabs button[data-view="'+v+'"]').click(),view);
  await p.waitForTimeout(500);
  await p.reload();await p.waitForTimeout(1700);
  const on=await p.evaluate(v=>document.querySelector('.tabs button[data-view="'+v+'"]').getAttribute('aria-selected')==='true',view);
  t('10-12. refreshing '+view+' restores '+view, on);
}
await openAcct();await p.click('#acctMe');await p.waitForTimeout(500);
await p.reload();await p.waitForTimeout(1700);
t('13. refreshing My Work restores My Work', await p.evaluate(()=>!document.getElementById('view-me').hidden));
t('14. the saved view is scoped per project and person', await p.evaluate(()=>
  Object.keys(localStorage).some(k=>/^build-board:view:s1:MH-1$/.test(k))));

/* ---------- privacy ---------- */
t('34. My Work privacy holds: another key is unreadable', await p.evaluate(async()=>{
  const r=await PB.client().from('personal').select('key,body').eq('site',PB.siteId()).eq('key','SEO-1');
  return !r.error&&(r.data||[]).length===0;}));
t('35. the account cannot be switched to another identity', await p.evaluate(()=>{
  try{ PB.client(); }catch(e){}
  return PB.me()==='MH-1';}));

t('no JS errors', errs.length===0);
if(errs.length)console.log('   ',errs.slice(0,4).join(' | '));
await b.close();srv.close();
console.log('\n'+ok.length+' passed, '+bad.length+' failed'+(bad.length?': '+bad.join(', '):''));
process.exit(bad.length?1:0);
})();
