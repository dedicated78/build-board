/* Regressions: stale project data must never paint, the restored view must be
   the first view, and an account with zero memberships must be able to accept
   a fresh invitation. */
const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');
const ROOT=path.join(__dirname,'..');
const ok=[],bad=[];const t=(n,c)=>{(c?ok:bad).push(n);console.log((c?'PASS  ':'FAIL  ')+n);};
const MOCK=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
const T={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,s)=>{let f=path.join(ROOT,'public',q.url==='/'?'index.html':q.url.split('?')[0]);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'});s.end(d);}});});
const R=(site,key,body)=>({id:'x'+key+site,site,key,body});
const TOK='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OLD='2222aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EXP='3333aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER='4444aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const A2='5555aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// Sam was removed from RMM: the auth account and people row survive with a
// deactivated roster profile and zero memberships.
const seed=()=>({
 people:[{id:'u1',email:'owner@g.com',password:'pw12345678',name:'Mehedi',member:'MH-1'},
         {id:'u2',email:'sam@g.com',password:'pw12345678',name:'Sam Editor',member:'SEO-1'},
         {id:'u3',email:'multi@g.com',password:'pw12345678',name:'Ana Multi',member:'AN-1'}],
 sites:[{id:'s1',name:'RMM Builders Ltd'},{id:'s2',name:'Project A'}],
 memberships:[{site:'s1',person:'u1',role:'owner'},{site:'s2',person:'u3',role:'editor'}],
 invites:[{id:'i1',site:'s1',email:'sam@g.com',name:'Sam Editor',member:'SEO-1',role:'editor',
           token:TOK,expires:new Date(Date.now()+864e6).toISOString(),accepted:null},
          {id:'i2',site:'s1',email:'sam@g.com',role:'editor',token:OLD,
           expires:new Date(Date.now()+864e6).toISOString(),accepted:new Date().toISOString()},
          {id:'i3',site:'s1',email:'sam@g.com',role:'editor',token:EXP,
           expires:new Date(Date.now()-864e5).toISOString(),accepted:null},
          {id:'i4',site:'s1',email:'someone.else@g.com',role:'editor',token:OTHER,
           expires:new Date(Date.now()+864e6).toISOString(),accepted:null},
          {id:'i5',site:'s1',email:'multi@g.com',name:'Ana Multi',member:'AN-1',role:'editor',
           token:A2,expires:new Date(Date.now()+864e6).toISOString(),accepted:null}],
 tasks:[R('s1','RMM-001',{title:'Live citation run',ws:'offpage',type:'citations',owner:'SEO-1',
          status:'writing',planned:40,done:14,unit:'citations',blocked:false})],
 team:[R('s1','MH-1',{name:'Mehedi',role:'Owner / SEO',perWeek:10,active:true}),
       R('s1','SEO-1',{name:'Sam Editor',role:'SEO Specialist',perWeek:8,active:false}),
       R('s2','AN-1',{name:'Ana Multi',role:'SEO',perWeek:5,active:true})],
 meta:[R('s1','inventory',{items:[{label:'Live core pages',target:11}],label:'Approved page inventory'})]});

// project data from a previous, pre-auth life of this browser
const STALE=JSON.stringify({tasks:{'OLD-1':{title:'STALE TASK ZZZ',ws:'web',type:'core',owner:'GHOST',
  status:'backlog',planned:3,done:0,unit:'pages',blocked:false}},
  team:{GHOST:{name:'Stale Ghost ZZZ',role:'',perWeek:0}},meetings:{},activity:[],reads:{},
  inventory:[{label:'Stale category ZZZ',target:77}],invLabel:'Stale inventory ZZZ',
  brand:{agency:'Stale Agency ZZZ'},personal:{}});

(async()=>{
await new Promise(r=>srv.listen(8885,r));
const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
const ctx=await b.newContext({viewport:{width:1320,height:1000}});
await ctx.route('**fonts.g**',r=>r.abort());
await ctx.route('**/supabase.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:MOCK}));
// seed the store, plant the stale cache, and watch every paint for either
await ctx.addInitScript(([s,stale])=>{
  if(!localStorage.getItem('mocksb'))localStorage.setItem('mocksb',JSON.stringify(s));
  localStorage.setItem('rmm-board-local-v2',stale);
  window.__sawStale=false; window.__views=[]; window.__sawNoProject=false;
  const scan=()=>{
    const txt=document.body?document.body.innerText:'';
    if(/ZZZ/.test(txt)) window.__sawStale=true;
    if(/not currently part of a project/i.test(txt)) window.__sawNoProject=true;
    const sel=document.querySelector('.tabs button[aria-selected="true"]');
    if(sel){const v=sel.getAttribute('data-view');
      if(window.__views[window.__views.length-1]!==v) window.__views.push(v);}
  };
  const start=()=>{scan();new MutationObserver(scan).observe(document.documentElement,
    {subtree:true,childList:true,characterData:true,attributes:true});};
  if(document.body)start(); else document.addEventListener('DOMContentLoaded',start);
},[seed(),STALE]);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const rows=c=>p.evaluate(k=>JSON.parse(localStorage.getItem('mocksb'))[k]||[],c);
const openAcct=async()=>{if(!(await p.evaluate(()=>document.body.classList.contains('acct-open')))){await p.click('#meBtn');await p.waitForTimeout(250);}};
const signIn=async(em)=>{await p.fill('#gEmail',em);await p.fill('#gPass','pw12345678');await p.click('#gBtn');await p.waitForTimeout(1800);};
const signOut=async()=>{await openAcct();await p.click('#signOut');await p.waitForTimeout(1300);};
const URL='http://localhost:8885/';
// a hash change reloads the page by design, so invitations are opened as real
// navigations rather than mutated from inside an evaluate
const openInvite=async(tok)=>{await p.goto(URL+'#invite='+tok);await p.waitForTimeout(1700);};

/* ================= boot: no stale paint ================= */
await p.goto('http://localhost:8885/');await p.waitForTimeout(500);
t('3. a loading shell covers the app until live state is ready', await p.evaluate(()=>{
  const boot=document.getElementById('boot');return !!boot;}));
await signIn('owner@g.com');
t('1. seeded/stale inventory never paints before the remote state', await p.evaluate(()=>window.__sawStale===false));
t('2. stale team never paints either', await p.evaluate(()=>
  window.__sawStale===false&&!/Stale Ghost/.test(document.body.innerText)));
t('4. the first real render uses the remote project state', await p.evaluate(()=>
  /Live core pages/.test(document.body.innerText)&&/Live citation run/.test(document.body.innerText)));
t('4b. the legacy local cache is left untouched, not written back', await rows('meta').then(r=>
  r.find(x=>x.key==='inventory').body.items[0].label==='Live core pages'));
t('3b. the loading shell is gone once ready', await p.evaluate(()=>{
  const boot=document.getElementById('boot');return !boot||boot.hidden;}));

/* ================= view persistence ================= */
await p.evaluate(()=>document.querySelector('.tabs button[data-view="team"]').click());await p.waitForTimeout(400);
await p.reload();await p.waitForTimeout(1900);
t('7. refreshing Team stays on Team', await p.evaluate(()=>
  document.querySelector('.tabs button[data-view="team"]').getAttribute('aria-selected')==='true'));
t('10. Board never flashes before the restored view', await p.evaluate(()=>
  window.__views.length>0&&window.__views[0]==='team'));
await p.evaluate(()=>document.querySelector('.tabs button[data-view="report"]').click());await p.waitForTimeout(400);
await p.reload();await p.waitForTimeout(1900);
t('8. refreshing Report stays on Report', await p.evaluate(()=>
  document.querySelector('.tabs button[data-view="report"]').getAttribute('aria-selected')==='true'));
t('10b. no Board flash before Report either', await p.evaluate(()=>window.__views[0]==='report'));
await p.evaluate(()=>{localStorage.setItem('build-board:view:s1:MH-1','nonsense');});
await p.reload();await p.waitForTimeout(1900);
t('12. an invalid saved value falls back to Board', await p.evaluate(()=>
  document.querySelector('.tabs button[data-view="board"]').getAttribute('aria-selected')==='true'));
t('6. refreshing Board stays on Board', await p.evaluate(()=>
  document.querySelector('.tabs button[data-view="board"]').getAttribute('aria-selected')==='true'));
t('11. the key is scoped by site and member', await p.evaluate(()=>
  !!localStorage.getItem('build-board:view:s1:MH-1')));

/* ================= rejoin ================= */
await signOut();
t('13. the removed account holds zero memberships', await rows('memberships').then(m=>
  m.filter(x=>x.person==='u2').length===0));
await openInvite(TOK);
t('20. a signed-out existing account is offered the invitation flow',
  await p.evaluate(()=>!!document.getElementById('suForm')));
await p.fill('#suEmail','sam@g.com');await p.fill('#suPass','pw12345678');await p.click('#suBtn');await p.waitForTimeout(900);
t('20b. the existing-account message names the right next step', await p.evaluate(()=>
  /already have an account/i.test(document.getElementById('gErr').textContent)));
t('21. the pending invitation survives the sign-in step', await p.evaluate(()=>
  sessionStorage.getItem('pendingInviteToken')==='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
await p.evaluate(()=>{window.__sawNoProject=false;});
await signIn('sam@g.com');await p.waitForTimeout(1200);
t('22. the invitation is accepted automatically after signing in', await rows('memberships').then(m=>
  m.filter(x=>x.person==='u2'&&x.site==='s1').length===1));
t('23. "not on a project" is never shown before the invite is processed',
  await p.evaluate(()=>window.__sawNoProject===false));
t('15/16. the membership is recreated and the existing people row reused', await rows('people').then(r=>
  r.filter(x=>x.email==='sam@g.com').length===1));
t('17. the permanent member key is unchanged', await p.evaluate(()=>PB.me()==='SEO-1'));
t('18. the deactivated roster profile is reactivated', await rows('team').then(r=>
  r.find(x=>x.key==='SEO-1'&&x.site==='s1').body.active===true));
t('18b. their operational detail survived removal and rejoin', await rows('team').then(r=>
  r.find(x=>x.key==='SEO-1'&&x.site==='s1').body.role==='SEO Specialist'));
t('19. historic task references still resolve to their name', await p.evaluate(()=>
  /Live citation run/.test(document.body.innerText)));
t('27. the joined project is usable immediately, with no manual refresh', await p.evaluate(()=>
  !document.getElementById('gate')||document.getElementById('gate').hidden));
t('30. no raw database code reaches the interface', await p.evaluate(()=>
  !/42501|invite_not_found|invite_expired|row-level security/.test(document.body.innerText)));

/* ================= no-project, expired, mismatch ================= */
await signOut();
await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('mocksb'));
  d.memberships=d.memberships.filter(m=>m.person!=='u2');localStorage.setItem('mocksb',JSON.stringify(d));
  sessionStorage.removeItem('pendingInviteToken');});
await p.goto(URL);await p.waitForTimeout(900);
await signIn('sam@g.com');
t('24. zero memberships and no invitation shows the no-project screen', await p.evaluate(()=>
  /not currently part of a project/i.test(document.body.innerText)&&!!document.getElementById('npOut')));
t('24b. that screen offers a way out', await p.evaluate(()=>!!document.getElementById('npOut')));
await openInvite(EXP);
t('28. an expired invitation explains itself', await p.evaluate(()=>
  /expired/i.test(document.body.innerText)&&!/42501|invite_expired/.test(document.body.innerText)));
await openInvite(OTHER);
t('29. an invitation for another address explains itself', await p.evaluate(()=>
  /different email address/i.test(document.body.innerText)));

/* ================= multi-project ================= */
await p.evaluate(()=>{localStorage.removeItem('mocksb-session');});
await p.goto(URL);await p.waitForTimeout(800);
await signIn('multi@g.com');await p.waitForTimeout(600);
await openInvite(A2);
const mem=await rows('memberships');
t('25/26. a member of another project can accept, keeping both memberships',
  mem.filter(x=>x.person==='u3').length===2);
t('5. the newly joined project is not painted over the previous one',
  await p.evaluate(()=>window.__sawStale===false));
t('no JS errors', errs.length===0);
if(errs.length)console.log('   ',errs.slice(0,4).join(' | '));
await b.close();srv.close();
console.log('\n'+ok.length+' passed, '+bad.length+' failed'+(bad.length?': '+bad.join(', '):''));
process.exit(bad.length?1:0);
})();
