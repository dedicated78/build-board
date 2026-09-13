/* Category cards are filters, unassigned work can be claimed in one tap by anyone
   allowed to edit, and the importer offers — never imposes — an inventory update. */
const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');
const ROOT=path.join(__dirname,'..');
const ok=[],bad=[];const t=(n,c)=>{(c?ok:bad).push(n);console.log((c?'PASS  ':'FAIL  ')+n);};
const MOCK=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
const T={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,s)=>{let f=path.join(ROOT,'public',q.url==='/'?'index.html':q.url.split('?')[0]);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'});s.end(d);}});});
const R=(site,key,body)=>({id:'x'+key+site,site,key,body});
const seed=()=>({
 people:[{id:'u1',email:'own@g.com',password:'pw12345678',name:'Owner',member:'MH-1'},
         {id:'u3',email:'edt@g.com',password:'pw12345678',name:'Editor',member:'SEO-1'},
         {id:'u4',email:'vwr@g.com',password:'pw12345678',name:'Viewer',member:'CL-1'}],
 sites:[{id:'s1',name:'RMM Builders Ltd'}],
 memberships:[{site:'s1',person:'u1',role:'owner'},{site:'s1',person:'u3',role:'editor'},
              {site:'s1',person:'u4',role:'viewer'}],
 invites:[],
 tasks:[
  R('s1','RMM-001',{title:'Extensions — service pages',ws:'web',type:'svc',owner:'',status:'backlog',planned:1,done:0,unit:'pages',url:'/services/extensions/',blocked:false}),
  R('s1','RMM-002',{title:'Single storey',ws:'web',type:'child',owner:'',status:'backlog',planned:1,done:0,unit:'pages',url:'/services/extensions/single-storey/',blocked:false}),
  R('s1','RMM-003',{title:'Citation run',ws:'offpage',type:'citations',owner:'SEO-1',status:'writing',planned:40,done:14,unit:'citations',blocked:false}),
  R('s1','RMM-004',{title:'GBP posts',ws:'gbp',type:'posts',owner:'',status:'backlog',planned:4,done:0,unit:'posts',blocked:false}),
  R('s1','RMM-005',{title:'Aston',ws:'web',type:'area',owner:'',status:'live',planned:1,done:1,unit:'pages',url:'/areas/aston/',blocked:false})],
 team:[R('s1','MH-1',{name:'Owner',role:'Owner',perWeek:10,active:true}),
       R('s1','SEO-1',{name:'Editor',role:'SEO',perWeek:8,active:true}),
       R('s1','CL-1',{name:'Viewer',role:'',perWeek:0,active:true})],
 meta:[R('s1','inventory',{items:[{id:'core',label:'Core pages',target:2},{id:'svc',label:'Service pages',target:3},
        {id:'child',label:'Child services',target:0},{id:'area',label:'Area pages',target:1},
        {id:'guide',label:'Guides',target:0}],label:'Approved page inventory'})]});

const PLAN=['# Wave 1','- Homepage — /','- About — /about/','## Services',
 '- Extensions — /services/extensions/','- Kitchen Renovation — /services/kitchen-renovation/',
 '- Single storey — /services/extensions/single-storey/','- Rear and side — /services/extensions/rear-side/',
 '## Areas','- Perry Barr — /areas/perry-barr/','## Guides',
 '- Extension cost — /guides/house-extension-cost-birmingham/',
 '## Off-page','- Build 40 UK business citations'].join('\n');

const signIn=async(p,email)=>{
  await p.goto('http://localhost:8886/');
  await p.waitForSelector('input[type=email]',{timeout:15000});
  await (await p.$('input[type=email]')).fill(email);
  await (await p.$('input[type=password]')).fill('pw12345678');
  await p.keyboard.press('Enter');
  await p.waitForFunction(()=>document.body.classList.contains('auth-live')&&!document.body.classList.contains('booting'),{timeout:20000});
};
const titles=p=>p.evaluate(()=>[...document.querySelectorAll('#board .card h3')].map(h=>h.innerText));

(async()=>{
await new Promise(r=>srv.listen(8886,r));
const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
const errs=[];
const fresh=async()=>{
  const ctx=await b.newContext({viewport:{width:1320,height:1000}});
  await ctx.route('**fonts.g**',r=>r.abort());
  await ctx.route('**/supabase.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:MOCK}));
  await ctx.addInitScript(s=>{localStorage.setItem('mocksb',JSON.stringify(s));},seed());
  const p=await ctx.newPage();
  p.on('pageerror',e=>errs.push(e.message));
  return {ctx,p};
};

/* ---------- 1. category cards filter the board ---------- */
let {ctx,p}=await fresh();
await signIn(p,'own@g.com');
const all=await titles(p);
t('1. every task is on the board to begin with',all.length===5);

await p.click('[data-ws="gbp"]');
let vis=await titles(p);
t('2. clicking a workstream tile shows only that workstream',vis.length===1&&vis[0]==='GBP posts');
t('2b. the tile reads as pressed',await p.$eval('[data-ws="gbp"]',e=>e.getAttribute('aria-pressed'))==='true');
t('2c. the work dropdown follows the card',await p.$eval('#wsFilter',e=>e.value)==='gbp');

await p.click('[data-ws="gbp"]');
t('3. clicking the same tile again clears the filter',(await titles(p)).length===5);

await p.click('[data-bucket="svc"]');
vis=await titles(p);
t('4. an inventory bucket filters to that page type',vis.length===1&&vis[0]==='Extensions — service pages');
await p.click('[data-bucket="child"]');
vis=await titles(p);
t('5. child services are their own bucket',vis.length===1&&vis[0]==='Single storey');

await p.click('[data-ws="web"]');
t('6. picking a workstream clears the page-type filter',
  await p.$eval('[data-bucket="child"]',e=>e.getAttribute('aria-pressed'))==='false'&&(await titles(p)).length===3);
await p.click('[data-ws="web"]');

/* ---------- 2. unclaimed ---------- */
const chip=await p.$('.chip[data-f="unassigned"]');
t('7. an Unclaimed chip exists',!!chip);
t('8. it counts only open, owner-less work',
  (await p.$eval('.chip[data-f="unassigned"] .n',e=>e.innerText))==='3');
await p.click('.chip[data-f="unassigned"]');
vis=await titles(p);
t('9. the chip filters to unclaimed work only',vis.length===3&&vis.indexOf('Citation run')<0&&vis.indexOf('Aston')<0);
await p.click('.chip[data-f="all"]');

/* ---------- 3. claiming ---------- */
t('10. unassigned cards offer a Claim action',
  (await p.$$('[data-claim]')).length===3);
t('11. an owned task offers none',
  await p.evaluate(()=>{const c=[...document.querySelectorAll('#board .card')].find(x=>x.getAttribute('data-id')==='RMM-003');return !c.querySelector('[data-claim]');}));

await p.click('[data-claim="RMM-004"]');
await p.waitForTimeout(400);
t('12. claiming assigns the task to me',
  await p.evaluate(()=>{const c=[...document.querySelectorAll('#board .card')].find(x=>x.getAttribute('data-id')==='RMM-004');
    return !c.querySelector('[data-claim]')&&c.querySelector('.ava')&&!c.querySelector('.ava.none');}));
t('13. the drawer did not open over it',await p.$eval('#drawer',e=>e.getAttribute('aria-hidden'))!=='false');
t('14. the Unclaimed count drops',(await p.$eval('.chip[data-f="unassigned"] .n',e=>e.innerText))==='2');
const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('mocksb')).tasks.find(x=>x.key==='RMM-004').body.owner);
t('15. the claim is written to the database',stored==='MH-1');
if(!(await p.evaluate(()=>document.body.classList.contains('acct-open')))){await p.click('#meBtn');await p.waitForTimeout(250);}
await p.click('#acctMe');
await p.waitForTimeout(300);
t('16. the claimed task shows up in My work',(await p.evaluate(()=>document.body.innerText)).indexOf('GBP posts')>=0);
await ctx.close();

/* ---------- 4. a viewer cannot claim ---------- */
({ctx,p}=await fresh());
await signIn(p,'vwr@g.com');
t('17. a viewer sees no Claim action',(await p.$$('[data-claim]')).length===0);
t('18. a viewer can still filter by category',
  await p.evaluate(async()=>{document.querySelector('[data-ws="gbp"]').click();
    return document.querySelectorAll('#board .card').length===1;}));
t('19. the database refuses a viewer claim', await p.evaluate(async()=>{
  const r=await PB.client().from('tasks').update({body:{title:'GBP posts',owner:'CL-1'}})
    .eq('site',PB.siteId()).eq('key','RMM-004').select();
  return !!r.error||!(r.data||[]).length;}));
t('19b. and the task is still unclaimed', await p.evaluate(()=>
  JSON.parse(localStorage.getItem('mocksb')).tasks.find(x=>x.key==='RMM-004').body.owner===''));
await ctx.close();

/* ---------- 5. the import inventory offer ---------- */
({ctx,p}=await fresh());
await signIn(p,'own@g.com');
await p.click('#importPlan');
await p.fill('#xPaste',PLAN);
await p.click('#xScan');
await p.waitForSelector('#xRows .x-row');
t('20. the offer appears with the detected pages',await p.$eval('#xInvWrap',e=>!e.hidden));
const offer=await p.$eval('#xInvText',e=>e.innerText);
// the two pages already on the board are flagged as duplicates, so they are not offered again
t('21. it names the split, child services included, duplicates excluded',
  /6 pages/.test(offer)&&/Core pages \+2/.test(offer)&&/Service pages \+1/.test(offer)&&
  /Child services \+1/.test(offer)&&/Area pages \+1/.test(offer)&&/Guides \+1/.test(offer));
t('22. it is unticked by default',await p.$eval('#xInv',e=>!e.checked));
const before=await p.$$eval('#buckets .cnt',n=>n.map(x=>x.innerText));
await p.click('#xAdd');
await p.waitForTimeout(500);
const after=await p.$$eval('#buckets .cnt',n=>n.map(x=>x.innerText));
t('23. importing without ticking leaves the approved plan alone',before.join()===after.join());
t('23b. the tasks were still created',await p.evaluate(()=>document.querySelectorAll('#board .card').length)>5);

await p.click('#importPlan');
await p.fill('#xPaste',PLAN.replace(/perry-barr/,'handsworth').replace(/kitchen-renovation/,'loft-conversions')
  .replace(/house-extension-cost-birmingham/,'loft-cost').replace(/rear-side/,'wraparound')
  .replace(/single-storey/,'double-storey').replace(/\/about\//,'/contact/').replace('— /\n','— /terms/\n'));
await p.click('#xScan');
await p.waitForSelector('#xRows .x-row');
await p.check('#xInv');
await p.click('#xAdd');
await p.waitForTimeout(600);
const counts=await p.evaluate(()=>{const o={};document.querySelectorAll('#buckets .bkt').forEach(b=>{
  o[b.querySelector('.bkt-name span').innerText]=b.querySelector('.cnt').innerText;});return o;});
t('24. ticking raises the approved targets',counts['Service pages']==='0/4'&&counts['Child services']==='0/2'&&
  counts['Area pages']==='1/2'&&counts['Guides']==='0/1'&&counts['Core pages']==='0/4');
const inv=await p.evaluate(()=>JSON.parse(localStorage.getItem('mocksb')).meta.find(m=>m.key==='inventory').body.items);
t('25. the new plan is persisted, not just drawn',
  inv.filter(i=>i.id==='svc')[0].target===4&&inv.filter(i=>i.id==='child')[0].target===2);
await ctx.close();

t('no JS errors',errs.length===0||console.log(errs));
console.log('\n'+ok.length+' passed, '+bad.length+' failed');
await b.close();srv.close();process.exit(bad.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
