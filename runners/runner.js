/* runners/runner.js — Capacitor BackgroundRunner, label com.pmk.schedule.check
   Работает при закрытом приложении: раз в ~15 мин опрашивает API, шлёт «Расписание изменилось»
   / «Опубликовано расписание» и ставит напоминания на новые дни. */
const fnv=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h};
const PATS=[(a,d)=>`${a}?date=${d}`,(a,d)=>`${a}/${d}`,(a,d)=>`${a}?day=${d}`,(a,d)=>`${a}?d=${d}`];
const p2=n=>String(n).padStart(2,'0'),fmtT=m=>p2(Math.floor(m/60))+':'+p2(m%60);
const mins=t=>{const m=/(\d+):(\d+)/.exec(t||'');return m?+m[1]*60+ +m[2]:9999};
const rng=t=>{const m=/(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)/.exec(t||'');return m?[+m[1]*60+ +m[2],+m[3]*60+ +m[4]]:null};
const pl=(n,a,b,c)=>{const m=n%100,k=n%10;return m>10&&m<20?c:k===1?a:k>1&&k<5?b:c};
const ymd=d=>d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const add=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return ymd(d)};
const at=(s,m)=>{const d=parse(s);d.setMinutes(m);return d};
const hm=v=>{const [h,m]=v.split(':').map(Number);return h*60+m};
const label=s=>{try{return parse(s).toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}catch(e){return s}};
const chgId=(d,s)=>2000000+fnv('chg|'+d+'|'+s)%90000;   // тот же id, что в приложении → дубликатов нет
function norm(j,main){
const g=(j.schedule||{})[main],l=[];
if(g){const push=(p,k)=>l.push({k:k?1:0,n:k?'':p.number,d:p.discipline,a:p.auditory_name||p.auditory||'',t:p.teacher||'',s:p.start||'',st:p.status,m:p.message||'',p:p.progress||''});
(g.pair||[]).forEach(p=>push(p,0));(g.klchas||[]).forEach(p=>push(p,1))}
l.sort((a,b)=>mins(a.s)-mins(b.s));
return {date:j.date,l,gm:(g&&g.message)||''};
}
const sig=d=>JSON.stringify([d.l.map(x=>[x.s,x.d,x.a,x.t,x.st,x.m,x.p]),d.gm||'']);
function summary(S,when,l){
const pr=l.filter(x=>!x.k);if(!pr.length)return [when+' занятий нет',S.mainName||''];
const f=rng(pr[0].s),e=rng(pr[pr.length-1].s),p=pr[0];
return [`${when} пары начинаются в ${fmtT(f[0])}`,[S.mainName,`${pr.length} ${pl(pr.length,'пара','пары','пар')} до ${fmtT(e[1])}`,[p.d,p.a].filter(Boolean).join(', ')].filter(Boolean).join(' · ')];
}
function reminders(S,date,l){
const out=[],now=Date.now(),cn={},m=S.lead,mw=pl(m,'минуту','минуты','минут'),pr=l.filter(x=>!x.k);
for(const x of l){
const r=rng(x.s);if(!r)continue;const when=at(date,r[0]-m);if(+when<=now)continue;
const kk='pre|'+date+'|'+(x.k?'k':x.n),c=cn[kk]=(cn[kk]||0)+1;
out.push({id:1000000+fnv(kk+'|'+c)%900000,scheduleAt:when,
title:x.k?`Классный час начнётся через ${m} ${mw}`:`Пара «${x.d}» начнётся через ${m} ${mw}`,
body:[x.k?'':`${x.n} пара`,`${fmtT(r[0])}–${fmtT(r[1])}`,x.a,x.t].filter(Boolean).join(' · ')});
}
if(pr.length){
const f=rng(pr[0].s);
if(S.morn){const when=at(date,hm(S.mornT));if(+when>now&&f&&f[0]>hm(S.mornT)){const [a,b]=summary(S,'Сегодня',l);out.push({id:1000000+fnv('morn|'+date)%900000,scheduleAt:when,title:a,body:b})}}
if(S.eve){const when=at(add(date,-1),hm(S.eveT));if(+when>now){const [a,b]=summary(S,'Завтра',l);out.push({id:1000000+fnv('eve|'+date)%900000,scheduleAt:when,title:a,body:b})}}
}
return out;
}
addEventListener('saveState',(resolve,reject,args)=>{
try{CapacitorKV.set('state',JSON.stringify(args||{}));resolve()}catch(e){reject(e)}
});
addEventListener('checkSchedule',async(resolve,reject)=>{
try{
const raw=await CapacitorKV.get('state'),st=raw&&raw.value?JSON.parse(raw.value):null;
if(!st||!st.set||!st.set.on||!st.set.main||!st.api){resolve();return}
const S=st.set,today=ymd(new Date());st.days=st.days||{};
const found=[],base=norm(await (await fetch(st.api,{cache:'no-cache'})).json(),S.main);
if(base.date)found.push(base);
if(base.date&&st.dp>=0&&PATS[st.dp])for(let i=1;i<=2;i++){
const d=add(base.date,i);
try{const j=await (await fetch(PATS[st.dp](st.api,d),{cache:'no-cache'})).json();if(j&&j.schedule&&j.date===d)found.push(norm(j,S.main))}catch(e){}
}
const out=[];
for(const nd of found){
if(nd.date<today)continue;
const old=st.days[nd.date];
if(old&&sig(old)===sig(nd))continue;
if(S.chg){
if(old)out.push({id:chgId(nd.date,sig(nd)),title:'Расписание изменилось',body:`${S.mainName} · ${label(nd.date)}`,scheduleAt:new Date(Date.now()+1500)});
else if(nd.date>today&&nd.l.length){const [a,b]=summary(S,'x',nd.l);out.push({id:chgId(nd.date,'new'),title:`Опубликовано расписание на ${label(nd.date)}`,body:a.replace(/^\S+ /,'')+(b?' · '+b:''),scheduleAt:new Date(Date.now()+1500)})}
}
st.days[nd.date]={l:nd.l,gm:nd.gm};
out.push(...reminders(S,nd.date,nd.l));
}
Object.keys(st.days).forEach(k=>{if(k<today)delete st.days[k]});
if(out.length)CapacitorNotifications.schedule(out);
CapacitorKV.set('state',JSON.stringify(st));
resolve();
}catch(e){reject(e)}
});
