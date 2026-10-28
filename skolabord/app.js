/* ===== Stilling: settu OAuth Client ID úr Google Cloud hér (tegund: Web application) ===== */
const GOOGLE_CLIENT_ID = "";
/* ======================================================================================== */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const DAYS=["mánudagur","þriðjudagur","miðvikudagur","fimmtudagur","föstudagur","laugardagur","sunnudagur"];
const DSH=["Mán","Þri","Mið","Fim","Fös","Lau","Sun"];
const D2=["Má","Þr","Mi","Fi","Fö","La","Su"];
const MON=["janúar","febrúar","mars","apríl","maí","júní","júlí","ágúst","september","október","nóvember","desember"];
const cap=s=>s.replace(/^./,c=>c.toUpperCase());

/* ---------- stundaskrá bekkjarins (sú sama fyrir alla) ---------- */
const CLASS_RAW=[
 [["09:35","10:15","Íslenska"],["10:15","10:35","Útivist"],["10:35","11:35","Sprettur"],["11:40","12:40","Sprettur"],["12:40","13:10","Matur"],["13:20","14:00","Íþróttir"],["14:15","14:55","Boltaíþróttir"]],
 [["08:30","09:30","Sprettur"],["09:35","10:15","Stærðfræði"],["10:15","10:35","Útivist"],["10:35","11:35","Danska"],["11:40","12:40","Enska"],["12:40","13:10","Matur"],["13:10","13:50","Umsjón"]],
 [["08:30","09:30","Stærðfræði"],["09:35","10:15","Sprettur"],["10:15","10:35","Útivist"],["10:35","11:35","Enska"],["11:40","12:40","Íslenska"],["12:40","13:10","Matur"],["13:10","13:50","Smiðja 1, Sund"],["13:50","14:30","Smiðja 1, Sund"]],
 [["08:30","09:30","Sprettur"],["09:35","10:15","Íþróttir"],["10:15","10:35","Útivist"],["10:35","11:35","Íslenska"],["11:40","12:40","Stærðfræði"],["12:40","13:10","Matur"],["13:10","14:10","Sprettur"]],
 [["08:30","09:30","Íslenska"],["09:35","10:15","Enska"],["10:15","10:35","Útivist"],["10:35","11:35","Danska"],["11:40","12:40","Stærðfræði"],["12:40","13:10","Matur"]]
];
function tm(t){const m=/^(\d{1,2})[:.](\d{2})$/.exec(String(t||"").trim());if(!m)return null;return +m[1]*60+ +m[2]}
function hm(m){return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")}
const W=CLASS_RAW.map(d=>d.map(([s,e,n])=>({s:tm(s),e:tm(e),n})));

const isBrk=n=>/^(útivist|matur|frímín|frímó|hádeg|nesti|hlé)/i.test(String(n).trim());
const PAL=["#3461E8","#5B7FF0","#2747B8","#8AA3F4","#6E8DFF","#4C6BE0","#7F9CF2","#1F44C8"];
function colorFor(n){if(!n)return "var(--hatch)";if(/íþrótt|sund|bolt|leikfimi/i.test(n))return "#EC7A48";let h=0;for(const c of String(n).toLowerCase())h=(h*31+c.charCodeAt(0))>>>0;return PAL[h%PAL.length]}

/* ---------- geymsla (bara í þessum vafra) ---------- */
let canStore=true;
const KEYS=["profile","google","hw","lastSync","onboarded","skin"];
const store={
  get(k,d){try{const v=localStorage.getItem("sbw-"+k);return v==null?d:JSON.parse(v)}catch(e){canStore=false;return d}},
  set(k,v){try{localStorage.setItem("sbw-"+k,JSON.stringify(v))}catch(e){canStore=false}},
  clear(){try{KEYS.forEach(k=>localStorage.removeItem("sbw-"+k))}catch(e){}}
};
const S={
  profile:store.get("profile",null),
  google:store.get("google",null),
  hw:store.get("hw",[])||[],
  lastSync:store.get("lastSync",null),
  onboarded:store.get("onboarded",false),
  skin:store.get("skin","light"),
  sel:null
};
if(!Array.isArray(S.hw))S.hw=[];
const save=k=>store.set(k,S[k]);
function applySkin(){document.documentElement.setAttribute("data-skin",S.skin==="dark"?"dark":"light");$("skinLight").setAttribute("aria-pressed",S.skin!=="dark");$("skinDark").setAttribute("aria-pressed",S.skin==="dark")}
const ready=()=>!!S.profile;
const GOOGLE_ON=!!GOOGLE_CLIENT_ID;
const userEmail=()=>(S.google&&S.google.email)||(S.profile&&S.profile.email)||"";
const crLink=()=>"https://classroom.google.com/a/not-turned-in/all"+(userEmail()?"?authuser="+encodeURIComponent(userEmail()):"");

/* ---------- tími í Reykjavík ---------- */
function now(){
  const p={};new Intl.DateTimeFormat("en-GB",{timeZone:"Atlantic/Reykjavik",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"})
    .formatToParts(new Date()).forEach(x=>p[x.type]=x.value);
  return {dow:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(p.weekday),min:+p.hour*60+ +p.minute,y:+p.year,mo:+p.month,d:+p.day,ymd:`${p.year}-${p.month}-${p.day}`};
}
function ymdOf(date){const p={};new Intl.DateTimeFormat("en-GB",{timeZone:"Atlantic/Reykjavik",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).forEach(x=>p[x.type]=x.value);return `${p.year}-${p.month}-${p.day}`}
function addDays(ymd,n){const d=new Date(ymd+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function isoWeek(y,m,d){const t=new Date(Date.UTC(y,m-1,d));const n=(t.getUTCDay()+6)%7;t.setUTCDate(t.getUTCDate()-n+3);const f=new Date(Date.UTC(t.getUTCFullYear(),0,4));return 1+Math.round(((t-f)/864e5-3+((f.getUTCDay()+6)%7))/7)}
function dueText(due,N){
  if(!due)return "Engin dagsetning";
  if(due<N.ymd)return "Seint";
  if(due===N.ymd)return "Í dag";
  if(due===addDays(N.ymd,1))return "Á morgun";
  const[y,m,d]=due.split("-").map(Number);const dw=(new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7;
  return `${DSH[dw]} ${d}. ${MON[m-1].slice(0,3)}`;
}
function whenText(iso){
  if(!iso)return "aldrei";
  const d=new Date(iso),N=now(),y=ymdOf(d);
  const t=new Intl.DateTimeFormat("en-GB",{timeZone:"Atlantic/Reykjavik",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(d);
  if(y===N.ymd)return "í dag kl. "+t;
  if(y===addDays(N.ymd,-1))return "í gær kl. "+t;
  const[,m,dd]=y.split("-").map(Number);return `${dd}. ${MON[m-1]} kl. ${t}`;
}

let toastT;function toast(t){const el=$("toast");el.textContent=t;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,2600)}
const uid=()=>"h"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

/* ================= Google innskráning + Classroom ================= */
const SC_COURSES="https://www.googleapis.com/auth/classroom.courses.readonly";
const SC_WORK="https://www.googleapis.com/auth/classroom.coursework.me.readonly";
const SCOPES=["openid","email","profile",SC_COURSES,SC_WORK].join(" ");
let token=null,tokenExp=0,tokenClient=null,pending=null;
const gisReady=()=>!!(window.google&&google.accounts&&google.accounts.oauth2);
function waitGis(ms){return new Promise(res=>{const t0=Date.now();(function poll(){if(gisReady())return res(true);if(Date.now()-t0>ms)return res(false);setTimeout(poll,150)})()})}
function initClient(){
  if(tokenClient||!gisReady()||!GOOGLE_CLIENT_ID)return;
  tokenClient=google.accounts.oauth2.initTokenClient({
    client_id:GOOGLE_CLIENT_ID,scope:SCOPES,
    callback:r=>{const p=pending;pending=null;if(!p)return;
      if(r.error)return p.rej({code:r.error});
      if(!google.accounts.oauth2.hasGrantedAllScopes(r,SC_COURSES,SC_WORK))return p.rej({code:"scopes"});
      token=r.access_token;tokenExp=Date.now()+(+r.expires_in||3600)*1000;p.res(token)},
    error_callback:e=>{const p=pending;pending=null;if(p)p.rej({code:(e&&e.type)||"popup_failed_to_open"})}
  });
}
async function getToken(){
  if(token&&Date.now()<tokenExp-60000)return token;
  if(!GOOGLE_CLIENT_ID)throw{code:"no_client"};
  if(!gisReady()&&!(await waitGis(4000)))throw{code:"no_gis"};
  initClient();
  return new Promise((res,rej)=>{
    pending={res,rej};
    const opts={prompt:S.google?"":"consent"};
    if(S.google&&S.google.email)opts.login_hint=S.google.email;
    tokenClient.requestAccessToken(opts);
  });
}
function gErr(e){
  const c=e&&e.code;
  if(c==="no_client")return "Google-innskráning er ekki komin í gang á þessari síðu enn. Þú getur haldið áfram án Google.";
  if(c==="no_gis")return "Náði ekki að hlaða innskráningu frá Google. Athugaðu nettenginguna og reyndu aftur.";
  if(c==="popup_closed")return "Innskráningarglugginn lokaðist áður en þú kláraðir. Reyndu aftur.";
  if(c==="popup_failed_to_open")return "Vafrinn lokaði á innskráningargluggann. Leyfðu sprettiglugga fyrir þessa síðu og reyndu aftur.";
  if(c==="access_denied")return "Aðgangur var ekki leyfður. Ef þú sást „Aðgangur lokaður“ frá Google þarf skólinn að samþykkja appið fyrst.";
  if(c==="scopes")return "Hakaðu við bæði leyfin fyrir Classroom (námskeið og verkefni) og reyndu aftur.";
  if(c==="http_401"){token=null;return "Innskráningin rann út. Reyndu aftur."}
  if(c==="http_403")return "Google leyfði ekki lestur á Classroom. Skólinn gæti þurft að samþykkja appið, eða Classroom API er ekki virkt.";
  return "Náði ekki sambandi við Classroom. Reyndu aftur eftir smá stund.";
}
async function gfetch(url){
  const r=await fetch(url,{headers:{Authorization:"Bearer "+token}});
  if(!r.ok)throw{code:"http_"+r.status};
  return r.json();
}
async function listAll(path,key,params){
  let out=[],pageToken="";
  do{
    const u=new URL("https://classroom.googleapis.com/v1/"+path);
    Object.entries(params||{}).forEach(([k,v])=>(Array.isArray(v)?v:[v]).forEach(x=>u.searchParams.append(k,x)));
    if(pageToken)u.searchParams.set("pageToken",pageToken);
    const d=await gfetch(u.toString());
    out=out.concat(d[key]||[]);pageToken=d.nextPageToken||"";
  }while(pageToken&&out.length<2000);
  return out;
}
function dueOf(w){
  if(!w.dueDate||!w.dueDate.year)return "";
  const t=w.dueTime||{};
  return ymdOf(new Date(Date.UTC(w.dueDate.year,w.dueDate.month-1,w.dueDate.day,t.hours||23,t.minutes||59)));
}
async function syncClassroom(){
  await getToken();
  const ui=await gfetch("https://openidconnect.googleapis.com/v1/userinfo").catch(()=>null);
  if(ui&&ui.email){S.google={email:ui.email,name:ui.given_name||ui.name||""};save("google");
    if(!S.profile){S.profile={name:S.google.name||ui.email.split("@")[0],email:ui.email};save("profile")}}
  const courses=await listAll("courses","courses",{studentId:"me",courseStates:"ACTIVE",pageSize:100});
  const N=now(),oldest=addDays(N.ymd,-60),items=[];
  await Promise.all(courses.map(async c=>{
    const [works,subs]=await Promise.all([
      listAll(`courses/${c.id}/courseWork`,"courseWork",{pageSize:100}),
      listAll(`courses/${c.id}/courseWork/-/studentSubmissions`,"studentSubmissions",{userId:"me",states:["NEW","CREATED","RECLAIMED_BY_STUDENT"],pageSize:100})
    ]);
    const byId=new Map(works.map(w=>[w.id,w]));
    subs.forEach(s=>{
      const w=byId.get(s.courseWorkId);if(!w)return;
      const due=dueOf(w);
      const created=w.creationTime?ymdOf(new Date(w.creationTime)):"";
      if(due?due<oldest:(created&&created<oldest))return;
      items.push({id:`gc-${c.id}-${w.id}`,title:(w.title||"Verkefni").slice(0,160),subj:(c.name||"").slice(0,60),due,link:w.alternateLink||"",src:"classroom"});
    });
  }));
  const doneIds=new Set(S.hw.filter(h=>h.src==="classroom"&&h.done).map(h=>h.id));
  const prev=new Map(S.hw.filter(h=>h.src==="classroom").map(h=>[h.id,h]));
  S.hw=S.hw.filter(h=>h.src!=="classroom").concat(items.map(i=>Object.assign(i,{done:doneIds.has(i.id),created:(prev.get(i.id)||{}).created||Date.now()})));
  S.lastSync=new Date().toISOString();
  save("hw");save("lastSync");
  return {courses:courses.length,items:items.length,due7:items.filter(i=>i.due&&i.due<=addDays(N.ymd,7)).length};
}
let syncing=false;
async function runSync(onStatus){
  if(syncing)return null;syncing=true;
  try{const r=await syncClassroom();toast(`Heimavinna uppfærð · ${r.items} verkefni`);return r}
  catch(e){onStatus&&onStatus(gErr(e));return null}
  finally{syncing=false;renderRoute()}
}
function disconnect(){
  try{if(token&&gisReady())google.accounts.oauth2.revoke(token,()=>{})}catch(e){}
  token=null;tokenExp=0;S.google=null;S.lastSync=null;S.hw=S.hw.filter(h=>h.src!=="classroom");
  save("google");save("lastSync");save("hw");toast("Google aftengt");renderRoute();
}

/* ================= borðið ================= */
function findNext(N){
  for(let off=0;off<8;off++){
    const dw=(N.dow+off)%7;if(dw>4)continue;
    const it=W[dw].find(x=>!isBrk(x.n)&&(off>0||x.s>N.min));
    if(it)return{it,off,dw};
  }
  return null;
}
function setMeter(i,p){$("m"+i+"fill").style.width=p+"%";$("m"+i+"knob").style.left=`clamp(4px,${p}%,calc(100% - 4px))`}
const openHw=()=>S.hw.filter(h=>!h.done).sort((a,b)=>((a.due||"9")<(b.due||"9")?-1:(a.due||"9")>(b.due||"9")?1:0)||((a.created||0)-(b.created||0)));
const forSubj=n=>S.hw.filter(h=>!h.done&&h.subj&&(h.subj.toLowerCase()===n.toLowerCase()||h.subj.toLowerCase().includes(n.toLowerCase()))).length;

function renderBanner(){
  const N=now(),b=$("syncBanner");
  const stale=S.google&&(!S.lastSync||ymdOf(new Date(S.lastSync))!==N.ymd);
  b.hidden=!stale||route==="stillingar";
  if(stale)$("syncBannerText").textContent=`Heimavinnan var síðast sótt ${whenText(S.lastSync)}. Sæktu nýjustu verkefnin úr Classroom.`;
}

function renderToday(){
  const N=now(),today=N.dow<=4?N.dow:null;
  if(S.sel===null)S.sel=today!=null?today:0;
  const day=W[S.sel],isToday=S.sel===today;
  $("eyebrow").textContent=`${cap(DAYS[N.dow])} ${N.d}. ${MON[N.mo-1]} · Vika ${isoWeek(N.y,N.mo,N.d)} · uppfært ${hm(N.min)}`;
  const g=N.min<300?"Góða nótt":N.min<720?"Góðan daginn":N.min<1080?"Góðan dag":"Gott kvöld";
  $("greet").textContent=today==null?`Það er helgi, ${S.profile.name}!`:`${g}, ${S.profile.name}`;

  const tdy=today!=null?W[today]:[],cls=tdy.filter(x=>!isBrk(x.n));
  const start=tdy.length?tdy[0].s:0,end=tdy.length?tdy[tdy.length-1].e:0;
  const pct=today==null?100:Math.max(0,Math.min(100,Math.round((N.min-start)/(end-start)*100)));
  setMeter(1,pct);$("m1big").textContent=pct+"%";
  $("m1a").textContent=cls.filter(x=>x.e>N.min).length;
  $("m1b").textContent=tdy.length?hm(end):"—";
  const doneN=S.hw.filter(h=>h.done).length;
  $("m2big").textContent=`${doneN}/${S.hw.length}`;
  setMeter(2,S.hw.length?Math.round(doneN/S.hw.length*100):0);
  $("m2a").textContent=S.hw.filter(h=>!h.done&&h.due===N.ymd).length;
  $("m2b").textContent=S.hw.filter(h=>!h.done&&h.due&&h.due<N.ymd).length;

  const nx=findNext(N);
  $("days").innerHTML=DSH.slice(0,5).map((d,i)=>`<button class="pill" type="button" aria-pressed="${i===S.sel}" data-day="${i}">${d}${i===today?" <small>í dag</small>":""}</button>`).join("")+
    (nx?`<button class="btn orange cta" type="button" id="cta">Næst: ${esc(nx.it.n)} · <span class="num" style="font-weight:300">${hm(nx.it.s)}</span></button>`:"");

  $("dayTitle").textContent=cap(DAYS[S.sel]);
  $("dayTag").textContent=`${hm(day[0].s)}–${hm(day[day.length-1].e)}`;
  drawDial(day,isToday?N.min:null);
  const dc=day.filter(x=>!isBrk(x.n)),brk=day.filter(x=>isBrk(x.n));
  $("dayCount").textContent=dc.length;
  $("daySummary").textContent=`tímar á ${DAYS[S.sel]} · frá ${hm(day[0].s)} til ${hm(day[day.length-1].e)} · ${brk.reduce((a,x)=>a+x.e-x.s,0)} mín. í hléum`;
  const ref=isToday?N.min:(today!=null&&S.sel<today?9999:-1);
  $("tDone").textContent=dc.filter(x=>x.e<=ref).length;
  $("tNow").textContent=dc.filter(x=>x.s<=ref&&ref<x.e).length;
  $("tLeft").textContent=dc.filter(x=>x.s>ref).length;
  $("tBreak").textContent=brk.length;

  const cur=today!=null?tdy.find(x=>x.s<=N.min&&N.min<x.e):null;
  $("liveTag").textContent=hm(N.min);
  $("nowSubj").textContent=cur?cur.n:(today==null?"Frí":"Ekkert í gangi");
  $("nowTime").textContent=cur?`${hm(cur.s)}–${hm(cur.e)}`:"—";
  $("nowRing").className="ring"+(cur?"":" idle");
  if(nx){
    const lbl=nx.off===0?"":(nx.off===1?"Á morgun · ":DSH[nx.dw]+" · ");
    $("nextSubj").textContent=nx.it.n;$("nextTime").textContent=`${lbl}${hm(nx.it.s)}–${hm(nx.it.e)}`;
    const dueFor=forSubj(nx.it.n);
    const extra=dueFor?`<br><span style="color:var(--orange);font-size:13px">${dueFor} verkefni í þessu fagi</span>`:"";
    if(nx.off===0){$("cdNum").textContent=nx.it.s-N.min;$("cdText").innerHTML=`mínútur í ${esc(nx.it.n)}`+extra}
    else{$("cdNum").textContent=hm(nx.it.s);
      $("cdText").innerHTML=esc(today!=null&&N.min>=end?"Skóladagurinn er búinn. Vel gert!":(today==null?"Næsti tími er á mánudaginn":`Næsti tími er á ${DAYS[nx.dw]}`))+extra}
  }

  const op=openHw().slice(0,5);
  $("soon").innerHTML=op.length?op.map(h=>{const c=h.due&&h.due<N.ymd?"late":(h.due===N.ymd?"today":"");
    return `<div class="it"><i style="background:${colorFor(h.subj)}"></i><b>${esc(h.title)}</b><span class="due ${c}">${esc(dueText(h.due,N))}</span></div>`}).join("")
    :`<div class="ov-empty">${S.google?"Engin heimavinna eftir. Vel gert!":'Engin heimavinna enn. <a href="#heimavinna">Bæta við verkefni</a>'}</div>`;

  $("listTitle").textContent=`Dagskrá · ${DSH[S.sel]}`;
  const nextToday=isToday?day.find(x=>!isBrk(x.n)&&x.s>N.min):null;
  $("rows").innerHTML=day.map(x=>{
    let st="later",cl="";
    if(ref>=x.e){st="done";cl="done"}else if(ref>=x.s){st="now";cl="now"}else if(x===nextToday)st="next";
    const b=isBrk(x.n),due=b?0:forSubj(x.n);
    return `<div class="r ${cl} ${b?"brk":""}"><span class="t">${hm(x.s)}–${hm(x.e)}</span><span class="n">${esc(x.n)}${due?`<small>${due} verkefni</small>`:""}</span>${b&&st!=="now"?"<span></span>":`<span class="st ${st}">${{now:"Núna",next:"Næst",done:"Búið",later:"Seinna"}[st]}</span>`}</div>`;
  }).join("");
}

function drawDial(day,nowMin){
  const cx=150,cy=150,r=112,minS=day[0].s,maxE=day[day.length-1].e;
  const S0=Math.min(480,Math.floor(minS/60)*60),SPAN=Math.max(420,Math.ceil((maxE-S0)/60)*60);
  const ang=m=>((m-S0)/SPAN)*Math.PI*2-Math.PI/2;
  const pt=(m,rr)=>[cx+rr*Math.cos(ang(m)),cy+rr*Math.sin(ang(m))];
  const arc=(a,b,rr)=>{const[x1,y1]=pt(a,rr),[x2,y2]=pt(b,rr);return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 ${b-a>SPAN/2?1:0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`};
  let s=`<defs><pattern id="hp" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--card)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" stroke-width="1.6"/></pattern></defs>`;
  s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--chip)" stroke-width="40"/>`;
  day.forEach(x=>{
    const b=isBrk(x.n),past=nowMin!=null&&nowMin>=x.e,live=nowMin!=null&&nowMin>=x.s&&nowMin<x.e;
    s+=`<path d="${arc(x.s+1,x.e-1,r)}" fill="none" stroke="${b?"url(#hp)":(live?"var(--orange)":colorFor(x.n))}" stroke-width="${live?46:38}" opacity="${past&&!b?.35:1}"><title>${esc(hm(x.s)+"–"+hm(x.e)+" "+x.n)}</title></path>`;
  });
  for(let h=S0/60;h<(S0+SPAN)/60;h++){const[x,y]=pt(h*60,r+30);s+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="10" font-family="Azeret Mono,monospace" fill="var(--muted)" text-anchor="middle" dominant-baseline="middle">${h}</text>`}
  const needle=(m,len,w,col)=>{const[x,y]=pt(m,len);return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="1.2"/><line x1="${(cx+(x-cx)*.86).toFixed(1)}" y1="${(cy+(y-cy)*.86).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`};
  s+=needle(minS,146,6,"var(--ink)")+needle(maxE,146,6,"var(--ink)");
  if(nowMin!=null&&nowMin>=S0&&nowMin<=S0+SPAN)s+=needle(nowMin,150,7,"var(--orange)");
  s+=`<circle cx="${cx}" cy="${cy}" r="4" fill="var(--ink)"/>`;
  $("dial").innerHTML=s;
  const acc=day.map(x=>`${isBrk(x.n)?"var(--blue-soft)":colorFor(x.n)} ${((x.s-S0)/SPAN*360).toFixed(0)}deg ${((x.e-S0)/SPAN*360).toFixed(0)}deg`);
  $("blob").style.background=`conic-gradient(var(--blue-soft) 0deg,${acc.join(",")},var(--blue-soft) ${((maxE-S0)/SPAN*360).toFixed(0)}deg 360deg)`;
  const dn=$("dialNum"),dl=$("dialLbl");
  if(nowMin==null){dn.textContent=hm(minS);dl.textContent="byrjar"}
  else if(nowMin>maxE){dn.textContent=hm(maxE);dl.textContent="búið"}
  else{dn.textContent=hm(nowMin);dl.textContent="núna"}
}

function renderHw(){
  const N=now(),open=openHw();
  $("ovTotal").textContent=open.length;
  const nxt=open.find(h=>h.due)||open[0];
  $("ovNextT").textContent=nxt?nxt.title:"—";
  $("ovNextS").textContent=nxt?[nxt.subj,dueText(nxt.due,N)].filter(Boolean).join(" · "):"";
  const per={};open.forEach(h=>{const k=h.subj||"Annað";per[k]=(per[k]||0)+1});
  $("ovSubj").innerHTML=Object.entries(per).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<span><i style="background:${colorFor(k==="Annað"?"":k)}"></i>${esc(k)} <b class="num">${n}</b></span>`).join("");

  const counts={};open.forEach(h=>{if(h.due)counts[h.due]=(counts[h.due]||0)+1});
  const lateN=open.filter(h=>h.due&&h.due<N.ymd).length;
  let maxC=1;for(let i=0;i<14;i++)maxC=Math.max(maxC,(counts[addDays(N.ymd,i)]||0)+(i===0?lateN:0));
  let s="";
  for(let i=0;i<14;i++){
    const ymd=addDays(N.ymd,i),c=(counts[ymd]||0)+(i===0?lateN:0),dw=(N.dow+i)%7,[,m,d]=ymd.split("-").map(Number);
    s+=`<div class="sd ${c?"has":""} ${i<=1&&c?"hot":""} ${dw>4?"wknd":""} ${i===0?"today":""}" title="${esc(dueText(ymd,N))}"><span class="num">${c||""}</span><div class="col" style="height:${c?Math.max(14,c/maxC*64):6}px"></div><b>${D2[dw]}</b><span>${d}.${m}</span></div>`;
  }
  $("strip").innerHTML=s;

  const wk=addDays(N.ymd,7),tmr=addDays(N.ymd,1);
  const lanes=[{k:"late",l:"Seint",f:h=>h.due&&h.due<N.ymd},{k:"today",l:"Í dag",f:h=>h.due===N.ymd},{k:"tm",l:"Á morgun",f:h=>h.due===tmr},{k:"week",l:"Næstu 7 dagar",f:h=>h.due&&h.due>tmr&&h.due<=wk},{k:"later",l:"Seinna",f:h=>!h.due||h.due>wk}];
  const box=$("lanes");
  if(!open.length){box.style.display="block";box.innerHTML=`<div class="ov-empty">${S.google?"Þú átt enga heimavinnu eftir í Classroom.":"Engin heimavinna enn. Skrifaðu inn fyrsta verkefnið hér fyrir neðan."}</div>`}
  else{box.style.display="";box.innerHTML=lanes.map(ln=>{const items=open.filter(ln.f);
    return `<div class="lane${items.length&&ln.k==="late"?" late":""}"><header><span>${ln.l}</span><span class="num">${items.length}</span></header>${items.length?items.map(h=>`<div class="task"><input type="checkbox" id="o-${esc(h.id)}" data-id="${esc(h.id)}" aria-label="Klárað: ${esc(h.title)}"><label for="o-${esc(h.id)}">${esc(h.title)}<small><i style="background:${colorFor(h.subj)}"></i>${esc(h.subj||"Annað")}${ln.k==="week"||ln.k==="later"||ln.k==="late"?" · "+esc(dueText(h.due,N)):""}</small></label>${h.src==="classroom"?(h.link&&/^https:\/\/classroom\.google\.com\//.test(h.link)?`<a class="open" href="${esc(h.link)}" target="_blank" rel="noopener" aria-label="Opna ${esc(h.title)} í Classroom">Opna ↗</a>`:"<span></span>"):`<button class="x" type="button" data-del="${esc(h.id)}" aria-label="Eyða ${esc(h.title)}">×</button>`}</div>`).join(""):`<div class="none">Ekkert hér</div>`}</div>`}).join("")}

  // Classroom kort
  const cr=S.hw.filter(h=>h.src==="classroom");
  if(S.google){
    $("crTag").textContent="Tengt";
    $("crBody").innerHTML=`<p class="muted" style="margin:0">Tengt sem <b style="color:var(--ink)">${esc(S.google.email)}</b>. Síðast sótt ${esc(whenText(S.lastSync))}.</p>
      <div class="sync-stats"><div><span>Úr Classroom</span><b class="num">${cr.length}</b></div><div><span>Eftir að skila</span><b class="num">${cr.filter(h=>!h.done).length}</b></div><div><span>Næstu 7 daga</span><b class="num">${cr.filter(h=>!h.done&&h.due&&h.due<=wk).length}</b></div></div>
      <div class="row-btns"><button class="btn blue" type="button" id="crSync">Uppfæra úr Classroom</button><a class="btn ghost" href="${esc(crLink())}" target="_blank" rel="noopener">Opna Classroom ↗</a></div>
      <div id="crOut" aria-live="polite"></div>`;
  }else if(GOOGLE_ON){
    $("crTag").textContent="Ekki tengt";
    $("crBody").innerHTML=`<p class="muted" style="margin:0">Skráðu þig inn með Google-aðganginum þínum í skólanum og verkefnin sem þú átt eftir að skila koma sjálfkrafa inn.</p>
      <div class="row-btns"><button class="gbtn" type="button" id="crSync">${$("gLogin").innerHTML}</button><a class="btn ghost" href="${esc(crLink())}" target="_blank" rel="noopener">Opna Classroom ↗</a></div><div id="crOut" aria-live="polite"></div>`;
  }else{
    $("crTag").textContent=userEmail()||"Classroom";
    $("crBody").innerHTML=`<p class="muted" style="margin:0">Opnaðu verkefnalistann þinn í Classroom og skrifaðu verkefnin inn hér, svo þau raðist eftir skiladegi. Classroom opnast á netfanginu sem þú skráðir þig inn með.</p>
      <div class="row-btns"><a class="btn blue" href="${esc(crLink())}" target="_blank" rel="noopener">Opna verkefnin mín í Classroom ↗</a></div>`;
  }
  const cs=$("crSync");
  if(cs)cs.onclick=async()=>{const out=$("crOut");cs.disabled=true;out.innerHTML=`<div class="thinking">Sæki verkefnin úr Classroom…</div>`;
    await runSync(m=>{const o=$("crOut");if(o)o.innerHTML=`<div class="notice bad"><p>${esc(m)}</p></div>`})};

  const sel=$("hwSubj"),keep=sel.value;
  const names=[...new Set(W.flat().map(x=>x.n).filter(n=>!isBrk(n)))];
  sel.innerHTML=names.map(n=>`<option>${esc(n)}</option>`).join("")+`<option value="">Annað</option>`;
  if(keep&&names.includes(keep))sel.value=keep;
  if(!$("hwDue").value)$("hwDue").value=addDays(N.ymd,1);
}

function renderWeek(){
  const N=now(),today=N.dow<=4?N.dow:null;
  const tot={};W.flat().forEach(x=>{if(!isBrk(x.n))tot[x.n]=(tot[x.n]||0)+x.e-x.s});
  const ent=Object.entries(tot).sort((a,b)=>b[1]-a[1]);
  const top=ent.slice(0,4),rest=ent.slice(4).reduce((a,x)=>a+x[1],0);
  const list=top.map(([k,v])=>({k,v}));if(rest)list.push({k:"_o",v:rest});
  const max=Math.max(1,...list.map(x=>x.v)),totMin=ent.reduce((a,x)=>a+x[1],0);
  $("weekHours").textContent=(totMin/60).toFixed(1).replace(".",",");
  $("weekSub").textContent=`klst. af kennslu · ${ent.length} fög`;
  const cur=today!=null?W[today].find(x=>x.s<=N.min&&N.min<x.e&&!isBrk(x.n)):null;
  const nx=findNext(N),curK=cur?cur.n:(nx&&nx.off===0?nx.it.n:null),inTop=top.some(([k])=>k===curK);
  $("bars").style.gridTemplateColumns=`repeat(${list.length},1fr)`;
  $("bars").innerHTML=list.map(b=>{const hot=b.k===curK||(b.k==="_o"&&curK&&!inTop);const l=b.k==="_o"?"Annað":b.k;
    return `<div class="b ${hot?"hot":""}"><span class="num">${(b.v/60).toFixed(1).replace(".",",")}</span><div class="col" style="height:${Math.max(8,b.v/max*110)}px"></div><label title="${esc(l)}">${esc(l)}</label></div>`}).join("");
  const all=W.flat(),t0=Math.floor(Math.min(...all.map(x=>x.s))/60)*60,t1=Math.ceil(Math.max(...all.map(x=>x.e))/60)*60,PX=1.15,H=(t1-t0)*PX;
  let h=`<div></div>`+DSH.slice(0,5).map((d,i)=>`<div class="dh ${i===today?"today":""}">${d}${i===today?" · í dag":""}</div>`).join("");
  h+=`<div class="hours" style="height:${H}px">`;for(let m=t0;m<=t1;m+=60)h+=`<span style="top:${(m-t0)*PX}px">${hm(m)}</span>`;h+=`</div>`;
  W.forEach((d,i)=>{
    h+=`<div class="col" style="height:${H}px">`;
    d.forEach(x=>{const b=isBrk(x.n),live=i===today&&N.min>=x.s&&N.min<x.e;
      h+=`<div class="blk ${b?"brk":""} ${live?"live":""}" style="top:${(x.s-t0)*PX}px;height:${Math.max(16,(x.e-x.s)*PX-2)}px;${b?"":"background:"+colorFor(x.n)}" title="${esc(hm(x.s)+"–"+hm(x.e)+" "+x.n)}"><b>${esc(x.n)}</b>${(x.e-x.s)>=35?`<small>${hm(x.s)}–${hm(x.e)}</small>`:""}</div>`});
    if(i===today&&N.min>=t0&&N.min<=t1)h+=`<div class="nowline" style="top:${(N.min-t0)*PX}px"></div>`;
    h+=`</div>`;
  });
  $("tt").innerHTML=h;
}

function renderSettings(){
  if(document.activeElement!==$("sName"))$("sName").value=S.profile.name||"";
  if(document.activeElement!==$("sEmail"))$("sEmail").value=S.profile.email||"";
  if(!S.google&&!GOOGLE_ON){
    $("gInfo").innerHTML=`<div class="kv"><span>Opnast á</span><b style="overflow-wrap:anywhere">${esc(userEmail()||"—")}</b></div><p class="muted" style="margin:8px 0 0">Borðið opnar Classroom á netfanginu þínu. Heimavinnuna skrifar þú inn undir Heimavinna.</p>`;
    $("gBtns").innerHTML=`<a class="btn ghost" href="${esc(crLink())}" target="_blank" rel="noopener">Opna Classroom ↗</a>`;
  }else if(S.google){
    $("gInfo").innerHTML=`<div class="kv"><span>Aðgangur</span><b style="overflow-wrap:anywhere">${esc(S.google.email)}</b></div><div class="kv"><span>Síðast sótt</span><b>${esc(whenText(S.lastSync))}</b></div>`;
    $("gBtns").innerHTML=`<button class="btn blue" type="button" id="setSync">Uppfæra úr Classroom</button><button class="btn ghost" type="button" id="setDisc">Aftengja Google</button>`;
    $("setSync").onclick=()=>{$("setSync").disabled=true;runSync(m=>toast(m))};
    $("setDisc").onclick=()=>{
      $("gBtns").innerHTML=`<div class="notice bad" style="width:100%"><p>Aftengja Google? Verkefnin úr Classroom hverfa af borðinu. Þú getur líka tekið leyfið til baka á myaccount.google.com/permissions.</p><div class="row-btns"><button class="btn orange" type="button" id="discYes">Já, aftengja</button><button class="btn ghost" type="button" id="discNo">Hætta við</button></div></div>`;
      $("discYes").onclick=disconnect;$("discNo").onclick=renderSettings;
    };
  }else{
    $("gInfo").innerHTML=`<p class="muted" style="margin:0">Ekki tengt. Tengdu Google til að fá heimavinnuna þína beint úr Classroom.</p>`;
    $("gBtns").innerHTML=`<button class="gbtn" type="button" id="setSync">${$("gLogin").innerHTML}</button>`;
    $("setSync").onclick=()=>runSync(m=>toast(m));
  }
  const n=W.flat().filter(x=>!isBrk(x.n)).length;
  $("schedInfo").innerHTML=`<div class="kv"><span>Stundaskrá</span><b>Stundaskrá bekkjarins</b></div><div class="kv"><span>Tímar á viku</span><b class="num" style="font-weight:400">${n}</b></div><p class="muted" style="margin:8px 0 0">Allir í bekknum eru með sömu stundaskrá, svo það þarf ekki að setja hana inn.</p>`;
  $("storeNote").textContent=canStore?"Allt er vistað í þessum vafra. Ekkert er sent á netþjón.":"Þessi vafri leyfir ekki vistun, svo gögnin hverfa þegar þú lokar síðunni.";
}

/* ---------- innskráning ---------- */
function renderOnb(){
  const step=S.profile?2:1;
  $("onb1").hidden=step!==1;$("onb2").hidden=step!==2;
  [1,2].forEach(i=>{const li=$("st"+i);li.classList.toggle("done",i<step);if(i===step)li.setAttribute("aria-current","step");else li.removeAttribute("aria-current")});
}
$("gLogin").onclick=async()=>{
  const out=$("loginOut");$("gLogin").disabled=true;out.innerHTML=`<div class="thinking">Bíð eftir innskráningu hjá Google…</div>`;
  try{
    await getToken();
    S.onboarding=true;
    $("onb1").hidden=true;$("onb2").hidden=false;$("st1").classList.add("done");$("st1").removeAttribute("aria-current");$("st2").setAttribute("aria-current","step");
    $("onb2Out").innerHTML=`<div class="thinking">Les námskeiðin þín og verkefnin úr Classroom…</div>`;
    try{
      const r=await syncClassroom();
      $("onb2Title").textContent=`Velkomin/n, ${S.profile.name}!`;
      $("onb2Out").innerHTML=`<div class="sync-stats"><div><span>Námskeið</span><b class="num">${r.courses}</b></div><div><span>Verkefni eftir</span><b class="num">${r.items}</b></div><div><span>Næstu 7 daga</span><b class="num">${r.due7}</b></div></div>`;
    }catch(e){
      if(!S.profile&&S.google){S.profile={name:S.google.name||"þú"};save("profile")}
      if(!S.profile){S.profile={name:"þú"};save("profile")}
      $("onb2Title").textContent="Næstum komið";
      $("onb2Out").innerHTML=`<div class="notice bad"><p>${esc(gErr(e))}</p><p>Þú getur opnað borðið og reynt aftur undir Heimavinna.</p></div>`;
    }
  }catch(e){
    out.innerHTML=`<div class="notice bad" role="alert"><p>${esc(gErr(e))}</p></div>`;
  }finally{$("gLogin").disabled=false}
};
$("profForm").addEventListener("submit",e=>{
  e.preventDefault();const name=$("pName").value.trim(),email=$("pEmail").value.trim().toLowerCase();if(!name||!email)return;
  S.profile={name,email};save("profile");S.onboarded=true;save("onboarded");location.hash="#idag";
});
$("onbDone").onclick=()=>{S.onboarded=true;S.onboarding=false;save("onboarded");location.hash="#idag";renderRoute()};

/* ---------- leið ---------- */
const APP=["idag","heimavinna","vikan","stillingar"];
let route="";
function resolve(){
  let h=location.hash.replace(/^#/,"");
  if(h==="hvernig"||h==="personuvernd")return "forsida";
  if(!h)h=ready()&&S.onboarded?"idag":"forsida";
  if(APP.includes(h)&&!ready())h="byrja";
  if(h==="byrja"&&ready()&&!S.onboarding)h="idag";
  if(!APP.includes(h)&&h!=="byrja")h="forsida";
  return h;
}
function renderRoute(){
  const r=resolve(),changed=r!==route;route=r;
  $("view-forsida").hidden=r!=="forsida";$("view-byrja").hidden=r!=="byrja";$("view-app").hidden=!APP.includes(r);
  document.querySelectorAll("[data-start]").forEach(a=>{a.href=ready()?"#idag":"#byrja";if(a.classList.contains("sm"))a.textContent=ready()?"Opna borðið":"Skrá inn"});
  if(r==="byrja"&&changed&&!S.onboarding)renderOnb();
  if(APP.includes(r)){
    if(!S.onboarded){S.onboarded=true;save("onboarded")}
    APP.forEach(v=>$("sub-"+v).hidden=v!==r);
    document.querySelectorAll("[data-tab]").forEach(a=>{if(a.dataset.tab===r)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
    $("clock").textContent=hm(now().min);
    $("avatar").textContent=(S.profile.name||"?").trim().charAt(0).toUpperCase()||"?";
    renderBanner();
    ({idag:renderToday,heimavinna:renderHw,vikan:renderWeek,stillingar:renderSettings})[r]();
  }
  if(changed){try{window.scrollTo(0,0)}catch(e){}}
  const raw=location.hash.replace(/^#/,"");
  if(raw!==r&&raw!=="hvernig"&&raw!=="personuvernd"){try{history.replaceState(null,"","#"+r)}catch(e){}}
}

/* ---------- atburðir ---------- */
window.addEventListener("hashchange",()=>{
  const h=location.hash.replace(/^#/,"");
  if(h==="hvernig"||h==="personuvernd"){if(route!=="forsida")renderRoute();const el=$(h);if(el)el.scrollIntoView({behavior:"smooth",block:"start"});return}
  renderRoute();
});
$("days").addEventListener("click",e=>{
  const b=e.target.closest("[data-day]");if(b){S.sel=+b.dataset.day;renderToday();return}
  if(e.target.closest("#cta"))$("card-next").scrollIntoView({behavior:"smooth",block:"center"});
});
$("syncBannerBtn").onclick=()=>{$("syncBannerBtn").disabled=true;runSync(m=>toast(m)).finally(()=>{$("syncBannerBtn").disabled=false})};
$("lanes").addEventListener("change",e=>{const id=e.target.dataset&&e.target.dataset.id;if(!id)return;const h=S.hw.find(x=>x.id===id);if(h){h.done=e.target.checked;save("hw");if(h.done)toast(h.src==="classroom"?"Merkt klárað hér. Mundu að skila í Classroom!":"Vel gert!");renderRoute()}});
$("lanes").addEventListener("click",e=>{const b=e.target.closest("[data-del]");if(b){S.hw=S.hw.filter(x=>x.id!==b.dataset.del);save("hw");renderHw()}});
$("addForm").addEventListener("submit",e=>{
  e.preventDefault();const t=$("hwTitle").value.trim();if(!t)return;
  S.hw.push({id:uid(),title:t,subj:$("hwSubj").value,due:$("hwDue").value||"",done:false,created:Date.now(),src:"hand"});
  save("hw");$("hwTitle").value="";toast("Verkefni bætt við");renderHw();
});
$("setProf").addEventListener("submit",e=>{e.preventDefault();const name=$("sName").value.trim(),email=$("sEmail").value.trim().toLowerCase();if(!name||!email)return;S.profile={name,email};save("profile");toast("Vistað");renderRoute()});
$("skinLight").onclick=()=>{S.skin="light";save("skin");applySkin()};
$("skinDark").onclick=()=>{S.skin="dark";save("skin");applySkin()};
function resetIdle(){$("resetBox").innerHTML=`<button class="btn ghost" type="button" id="resetBtn">Eyða öllu og skrá út</button>`;$("resetBtn").onclick=resetAsk}
function resetAsk(){
  $("resetBox").innerHTML=`<div class="notice bad" style="width:100%"><p>Ertu viss? Þetta eyðir nafninu þínu, Google-tengingunni og allri heimavinnu úr þessum vafra.</p><div class="row-btns"><button class="btn orange" type="button" id="resetYes">Já, eyða öllu</button><button class="btn ghost" type="button" id="resetNo">Hætta við</button></div></div>`;
  $("resetYes").onclick=()=>{try{if(token&&gisReady())google.accounts.oauth2.revoke(token,()=>{})}catch(e){}
    token=null;store.clear();S.profile=null;S.google=null;S.hw=[];S.lastSync=null;S.onboarded=false;S.onboarding=false;S.skin="light";S.sel=null;applySkin();resetIdle();
    $("pName").value="";$("pEmail").value="";$("loginOut").innerHTML="";location.hash="#forsida";renderRoute()};
  $("resetNo").onclick=resetIdle;
}
$("resetBtn").onclick=resetAsk;

/* ---------- ræsing ---------- */
if(!GOOGLE_ON)document.querySelectorAll("[data-google]").forEach(el=>el.hidden=true);
applySkin();renderRoute();
setInterval(()=>{if(["idag","heimavinna","vikan"].includes(route)&&!syncing)renderRoute()},30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&APP.includes(route))renderRoute()});
})();
