const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');
const ROOT=path.join(__dirname,'..');
const ok=[],bad=[];const t=(n,c)=>{(c?ok:bad).push(n);console.log((c?'PASS  ':'FAIL  ')+n);};
const MOCK=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');const T={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,s)=>{let f=path.join(ROOT,'public',q.url==='/'?'index.html':q.url.split('?')[0]);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'});s.end(d);}});});
const D=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const R=(site,key,body)=>({id:'x'+key+site,site,key,body});
const seed={
 people:[{id:'u1',email:'mehedi@growwithmh.com',password:'pw12345678',name:'Mehedi',member:'MH-1'},
         {id:'u2',email:'sam@growwithmh.com',password:'pw12345678',name:'SEO Worker 1',member:'SEO-1'},
         {id:'u3',email:'client@rmm.co.uk',password:'pw12345678',name:'RMM Client',member:'CL-1'}],
 sites:[{id:'s1',name:'RMM Builders Ltd'}],
 memberships:[{site:'s1',person:'u1',role:'owner'},{site:'s1',person:'u2',role:'editor'},{site:'s1',person:'u3',role:'viewer'}],
 invites:[],
 tasks:[R('s1','RMM-001',{title:'Service silo build',ws:'web',type:'service',owner:'SEO-1',status:'writing',planned:12,done:5,unit:'pages',blocked:false,due:D(4)})],
 team:[R('s1','MH-1',{name:'Mehedi',role:'Owner',perWeek:10}),R('s1','SEO-1',{name:'SEO Worker 1',role:'SEO',perWeek:5})],
 meta:[R('s1','brand',{agency:'GrowwithMH',client:'RMM Builders Ltd',accent:'#12615E'})]};
(async()=>{
await new Promise(r=>srv.listen(8894,r));
const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
const ctx=await b.newContext({viewport:{width:1320,height:1050}});
await ctx.route('**fonts.g**',r=>r.abort());
await ctx.route('**/supabase.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:MOCK}));
await ctx.addInitScript(s=>{if(!localStorage.getItem('mocksb'))localStorage.setItem('mocksb',JSON.stringify(s));},seed);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const rows=c=>p.evaluate(k=>JSON.parse(localStorage.getItem('mocksb'))[k]||[],c);
const signIn=async(em)=>{await p.goto('http://localhost:8894/');await p.waitForTimeout(700);
  const need=await p.evaluate(()=>{const g=document.getElementById('gate');return g&&!g.hidden;});
  if(need){await p.fill('#gEmail',em);await p.fill('#gPass','pw12345678');await p.click('#gBtn');await p.waitForTimeout(1600);} };

// ---------- owner ----------
await signIn('mehedi@growwithmh.com');
t('owner sees their role in the corner', await p.evaluate(()=>document.querySelector('#whoami .role').textContent==='owner'));
t('owner gets the People button', await p.evaluate(()=>!!document.getElementById('people')));
await p.click('#people');await p.waitForTimeout(700);
t('access panel lists everyone on the project', await p.evaluate(()=>document.querySelectorAll('#acc .ac-row .ac-nm').length>=3));
t('owner may grant every role', await p.evaluate(()=>document.querySelector('#acc .ac-row select').options.length===4));

// invite an editor
await p.fill('#acEmail','new@growwithmh.com');await p.fill('#acName','New Hire');await p.fill('#acMember','SEO-2');
await p.selectOption('#acRole','editor');
await p.click('#acc .ac-go');await p.waitForTimeout(800);
const inv=await rows('invites');
t('invitation created with the chosen role', inv.length===1&&inv[0].role==='editor'&&inv[0].member==='SEO-2');
t('an invite link is shown to copy', await p.evaluate(()=>{const c=document.querySelector('#acc .ac-made code');return !!c&&c.textContent.includes('#invite=');}));

// change someone's role
await p.evaluate(()=>{const rows=[...document.querySelectorAll('#acc .ac-row')];
  const r=rows.find(x=>x.textContent.includes('SEO-1'));const s=r.querySelector('select');s.value='admin';
  s.dispatchEvent(new Event('change',{bubbles:true}));});
await p.waitForTimeout(800);
t('owner can promote an editor to admin', await rows('memberships').then(m=>m.find(x=>x.person==='u2').role==='admin'));
await p.evaluate(()=>{const rows=[...document.querySelectorAll('#acc .ac-row')];
  const r=rows.find(x=>x.textContent.includes('SEO-1'));const s=r.querySelector('select');s.value='editor';
  s.dispatchEvent(new Event('change',{bubbles:true}));});
await p.waitForTimeout(700);

// ---------- the invited person accepts ----------
const token=(await rows('invites'))[0].token;
await p.evaluate(()=>{localStorage.removeItem('mocksb-session');});
await p.goto('http://localhost:8894/#invite='+token);await p.waitForTimeout(900);
t('pasting an invite link into an open tab reacts', await p.evaluate(()=>!!document.getElementById('suForm')));
t('an invite link opens the create-account form', await p.evaluate(()=>!!document.getElementById('suForm')));
await p.fill('#suEmail','wrong@example.com');await p.fill('#suPass','pw12345678');await p.click('#suBtn');await p.waitForTimeout(800);
t('the wrong email is refused', await p.evaluate(()=>document.getElementById('suErr').classList.contains('on')));
await p.fill('#suEmail','new@growwithmh.com');await p.click('#suBtn');await p.waitForTimeout(1800);
t('the right email creates the account and lands on the board', await p.evaluate(()=>{
  const g=document.getElementById('gate');return (!g||g.hidden)&&document.querySelectorAll('.card').length===1;}));
t('they arrive with the invited role and key', await p.evaluate(()=>
  localStorage.getItem('rmm-board-me')==='SEO-2'&&document.querySelector('#whoami .role').textContent==='editor'));
t('the invitation is spent', await rows('invites').then(i=>!!i[0].accepted));
t('an editor gets no People button', await p.evaluate(()=>!document.getElementById('people')));

// ---------- viewer ----------
await p.evaluate(()=>{localStorage.removeItem('mocksb-session');});
await signIn('client@rmm.co.uk');
t('viewer can read the board', await p.evaluate(()=>document.querySelectorAll('.card').length===1));
t('viewer is not offered New task', await p.evaluate(()=>{const b=document.getElementById('addBtn');
  return !b||getComputedStyle(b).display==='none';}));
t('viewer is not offered the add-task tile', await p.evaluate(()=>{const b=document.querySelector('[data-add="1"]');
  return !b||getComputedStyle(b).display==='none';}));
t('viewer cannot write a task even so', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').update({body:{title:'hacked'}}).eq('site',PB.siteId()).eq('key','RMM-001').select();
  return !r.error && (!r.data||r.data.length===0);}));
t('the task is untouched', await rows('tasks').then(x=>x[0].body.title==='Service silo build'));
t('viewer can still mark notifications read', await p.evaluate(async()=>{
  const r=await PB.client().from('meta').upsert({site:PB.siteId(),key:'reads',body:{'CL-1':{x:1}}}).select();
  return !r.error;}));
t('no JS errors', errs.length===0);
if(errs.length)console.log('   ',errs.slice(0,5).join(' | '));
await b.close();srv.close();
console.log('\n'+ok.length+' passed, '+bad.length+' failed'+(bad.length?': '+bad.join(', '):''));
})();
