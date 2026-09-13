const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');
const ROOT=path.join(__dirname,'..');
const ok=[],bad=[];const t=(n,c)=>{(c?ok:bad).push(n);console.log((c?'PASS  ':'FAIL  ')+n);};
const MOCK=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');const T={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,s)=>{let f=path.join(ROOT,'public',q.url==='/'?'index.html':q.url.split('?')[0]);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'});s.end(d);}});});
const D=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const R=(site,key,body)=>({id:'x'+key+site,site,key,body});
const seed={
 people:[{id:'u1',email:'sam@growwithmh.com',password:'pw12345678',name:'SEO Worker 1',member:'SEO-1'},
         {id:'u2',email:'dev@growwithmh.com',password:'pw12345678',name:'Developer 2',member:'DEV-2'}],
 sites:[{id:'s1',name:'RMM Builders Ltd'},{id:'s2',name:'South Asian Construction'}],
 memberships:[{site:'s1',person:'u1',role:'owner'},{site:'s2',person:'u1',role:'admin'},{site:'s1',person:'u2',role:'editor'}],
 invites:[],
 tasks:[R('s1','RMM-001',{title:'Service silo build',ws:'web',type:'service',owner:'DEV-2',status:'writing',planned:12,done:5,unit:'pages',blocked:false,due:D(4)}),
        R('s1','RMM-004',{title:'Citation build — UK directories',ws:'offpage',type:'citations',owner:'SEO-1',status:'writing',planned:40,done:14,unit:'citations',blocked:false,due:D(1)}),
        R('s1','RMM-006',{title:'Confirm approved Kitchen list',ws:'admin',type:'planning',owner:'SEO-1',status:'backlog',planned:0,done:0,unit:'items',blocked:true,due:D(-6)}),
        R('s2','SAC-001',{title:'GBP rebuild',ws:'gbp',type:'posts',owner:'SEO-1',status:'backlog',planned:8,done:0,unit:'posts',blocked:false})],
 team:[R('s1','SEO-1',{name:'SEO Worker 1',role:'SEO',perWeek:5}),R('s1','DEV-2',{name:'Developer 2',role:'Developer',perWeek:25}),
       R('s2','SEO-1',{name:'SEO Worker 1',role:'SEO',perWeek:5})],
 meta:[R('s1','brand',{agency:'GrowwithMH',client:'RMM Builders Ltd',period:'September 2026',accent:'#12615E'})],
 personal:[R('s1','SEO-1',{notes:{'RMM-004':'mine only'},checklists:{},bases:{},log:[]}),
           R('s1','DEV-2',{notes:{'RMM-001':'developer private note'},checklists:{},bases:{},log:[]})]};
(async()=>{
await new Promise(r=>srv.listen(8896,r));
const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
const ctx=await b.newContext({viewport:{width:1320,height:1050}});
await ctx.route('**fonts.g**',r=>r.abort());
await ctx.route('**/supabase.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:MOCK}));
await ctx.addInitScript(s=>{if(!localStorage.getItem('mocksb'))localStorage.setItem('mocksb',JSON.stringify(s));},seed);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const rows=c=>p.evaluate(k=>JSON.parse(localStorage.getItem('mocksb'))[k],c);

await p.goto('http://localhost:8896/');await p.waitForTimeout(900);
t('sign-in gate blocks the board', await p.evaluate(()=>{const g=document.getElementById('gate');return g&&!g.hidden;}));
await p.fill('#gEmail','sam@growwithmh.com');await p.fill('#gPass','nope');await p.click('#gBtn');await p.waitForTimeout(600);
t('wrong password is rejected', await p.evaluate(()=>document.getElementById('gErr').classList.contains('on')));
await p.fill('#gPass','pw12345678');await p.click('#gBtn');await p.waitForTimeout(1600);
t('signed in, gate gone', await p.evaluate(()=>{const g=document.getElementById('gate');return !g||g.hidden;}));
t('board shows this tenant only (3 cards)', await p.evaluate(()=>document.querySelectorAll('.card').length===3));
t('identity comes from the account', await p.evaluate(()=>localStorage.getItem('rmm-board-me')==='SEO-1'));
t('live connection reported', await p.evaluate(()=>document.getElementById('connText').textContent.indexOf('Saving live')===0));
t('site switcher lists both projects', await p.evaluate(()=>{const s=document.getElementById('siteSel');return s&&s.options.length===2;}));
t('another member\'s private notes never arrive', !(await p.evaluate(()=>JSON.stringify(window.__probe||'')+document.body.textContent).then(x=>x.includes('developer private note'))));

await p.evaluate(()=>{const c=[...document.querySelectorAll('.card')].find(e=>e.textContent.includes('Citation build'));c.click();});
await p.waitForTimeout(450);
await p.click('#dStatus button[data-s="review"]');await p.click('#dSave');await p.waitForTimeout(800);
t('an edit reaches the database', await rows('tasks').then(r=>r.find(x=>x.key==='RMM-004').body.status==='review'));
t('no duplicate row created', await rows('tasks').then(r=>r.filter(x=>x.key==='RMM-004'&&x.site==='s1').length===1));

await p.click('#bell');await p.waitForTimeout(400);
const unread=await p.evaluate(()=>document.querySelectorAll('.nt.unread').length);
await p.click('#markAll');await p.waitForTimeout(800);
t('mark all read persists ('+unread+' unread)', await rows('meta').then(r=>{const x=r.find(y=>y.key==='reads'&&y.site==='s1');return !!x&&Object.keys(x.body['SEO-1']||{}).length>0;}));
await p.keyboard.press('Escape');

await p.reload();await p.waitForTimeout(1600);
t('reload keeps the session', await p.evaluate(()=>{const g=document.getElementById('gate');return (!g||g.hidden)&&document.querySelectorAll('.card').length===3;}));
t('the edit survived the reload', await rows('tasks').then(r=>r.find(x=>x.key==='RMM-004').body.status==='review'));

await p.selectOption('#siteSel','s2');await p.waitForTimeout(1800);
t('switching project loads only that tenant', await p.evaluate(()=>document.querySelectorAll('.card').length===1&&document.body.textContent.includes('GBP rebuild')));
await p.selectOption('#siteSel','s1');await p.waitForTimeout(1800);
t('switching back restores the first project', await p.evaluate(()=>document.querySelectorAll('.card').length===3));

// second account: privacy the other way round
await p.click('#signOut');await p.waitForTimeout(1400);
await p.fill('#gEmail','dev@growwithmh.com');await p.fill('#gPass','pw12345678');await p.click('#gBtn');await p.waitForTimeout(1800);
t('a second member signs in as themselves', await p.evaluate(()=>localStorage.getItem('rmm-board-me')==='DEV-2'));
t('they cannot see the other member\'s private notes', !(await p.evaluate(()=>document.body.textContent.includes('mine only'))));
t('but they see the shared board', await p.evaluate(()=>document.querySelectorAll('.card').length===3));
t('no JS errors', errs.length===0);
if(errs.length)console.log('   ',errs.slice(0,4).join(' | '));
await b.close();srv.close();
console.log('\n'+ok.length+' passed, '+bad.length+' failed'+(bad.length?': '+bad.join(', '):''));
})();
