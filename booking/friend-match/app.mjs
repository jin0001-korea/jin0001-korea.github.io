import project from '../config.mjs';

const view=document.getElementById('view'), notice=document.getElementById('notice');
const $=selector=>view.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const levels={first:'첫 스키',stop:'A자 멈추기',turn:'S자 턴 가능',onefoot:'한 발 들기 가능',parallel:'11자 주행 가능'};
const genders={female:'여성',male:'남성',unspecified:'응답하지 않음'};
const goals={first:'스키에 익숙해지기',stop:'안전하게 멈추기',turn:'S자 턴 연결하기',parallel:'11자 주행 배우기',confidence:'자신감 키우기',together:'친구와 함께 연습하기'};
const fixedTimes=['09:00','11:00','14:00','16:00','19:00','20:00','21:00','22:00'];
const periods={'weekday-day':'평일 주간','weekday-night':'평일 야간','weekend-day':'주말 주간','weekend-night':'주말 야간'};
const price='73,000원';
const asYear=()=>Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Seoul'}).format(Date.now()));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
const ageOf=year=>asYear()-year+1;
const band=exp=>exp===0?'입문':exp<=8?'초급':'중급';
const entryURL=new URL('functions/v1/slope-friend-match',project.url+'/');
const privacyURL='https://www.risenski.com/?mode=privacy';
const policyURL='https://www.risenski.com/price';
const brandBook='https://www.risenski.com/book';
const cta=(act,title,style='secondary')=>`<button type="button" class="${style}" data-act="${act}">${title}</button>`;
const entries=(map,chosen)=>Object.entries(map).map(([key,title])=>`<option value="${escape(key)}"${key===chosen?' selected':''}>${escape(title)}</option>`).join('');
const yearInput=(name,value,required)=>`<input name="${name}" type="number" inputmode="numeric" min="${asYear()-120}" max="${asYear()}" step="1" ${required?'required':''} value="${escape(value)}" placeholder="예: ${asYear()-9}">`;
const times=selected=>(cfg.times?.length?cfg.times:fixedTimes).filter(t=>fixedTimes.includes(t)).map(t=>`<option${t===selected?' selected':''}>${t}</option>`).join('');
const prettySlot=slot=>{
  if(!slot)return '';
  const [date,time]=String(slot).split('T'), d=new Date(date+'T12:00:00+09:00');
  if(!Number.isFinite(+d))return '';
  return new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'short',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(d)+' '+(time||'').slice(0,5);
};
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const groupFromHash=()=>{const id=new URLSearchParams(location.hash.slice(1)).get('group');return id&&uuidPattern.test(id)?id:null;};
const parentOrigin=(()=>{try{const u=new URL(document.referrer);return ['https://www.risenski.com','https://risenski.com','https://risenski.imweb.me'].includes(u.origin)?u.origin:null;}catch{return null;}})();
const oneToOne=`<a class="secondary message-link" href="${brandBook}" target="_blank" rel="noopener noreferrer">1대1 강습 알아보기</a>`;
let cfg={enabled:false}, configError=false, session=null, verifyState=null, turnstileWidget=null, turnstileLoad=null;
let active='board', profile=null, slots=[],pending=null,selectedGroup=null,cards=[],criteria={},candidates=[],inProgress=false;
let actionId=null, lastActionSignature=null, pageCounter=0, navVersion=0;
function post(message){if(parentOrigin&&parent!==window)parent.postMessage(message,parentOrigin);}
function say(text=''){notice.textContent=text;notice.hidden=!text;}
function render(page,tab,html){
  if(turnstileWidget!==null){window.turnstile?.remove(turnstileWidget);turnstileWidget=null;}
  active=page;view.dataset.page=page;view.innerHTML=html;
  document.querySelectorAll('[data-page]').forEach(e=>{
    if(e.tagName!=='BUTTON')return;
    if(e.dataset.page===tab)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');
  });
  const heading=$('h1,h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  window.scrollTo(0,0);if(pageCounter++)post({type:'risen-match:focus'});
}
async function api(action,body={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),22000);
  let response,data;
  try{
    response=await fetch(entryURL,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json',apikey:project.publishableKey},
      body:JSON.stringify({action,...body,...(session?{session}:{})}),signal:controller.signal});
    data=await response.json();
  }catch{throw Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');}
  finally{clearTimeout(timer);}
  if(!response.ok||data?.error){
    const code=String(data?.code||data?.error?.code||data?.error||'');
    const messages={invalid_session:'휴대폰 인증 시간이 지났어요. 내 신청에서 다시 인증해 주세요.',
      guardian:'법정대리인 확인이 필요해요. 라이즌에 문의한 뒤 같은 보호자 번호로 진행해 주세요.',
      full:'다른 친구가 먼저 참여했어요. 모집 목록에서 다른 일정을 골라 주세요.',
      mismatch:'함께 수업할 수 있는 경험과 일정인지 다시 확인해 주세요.'};
    if(response.status===401||code==='invalid_session')session=null;
    const serverMessage=typeof data?.message==='string'?data.message:typeof data?.error==='string'?data.error:'';
    const serverText=/[가-힣]/.test(serverMessage)?serverMessage:'';
    throw Error(messages[code]||serverText||(response.status===429?'요청이 많아요. 잠시 후 다시 시도해 주세요.':'요청을 처리하지 못했어요. 입력 조건과 진행 상태를 확인해 주세요.'));
  }
  return data;
}
async function run(task){
  if(inProgress)return;
  inProgress=true;say();view.setAttribute('aria-busy','true');
  try{await task();}catch(e){say(e.message||'다시 시도해 주세요.');}
  finally{inProgress=false;view.removeAttribute('aria-busy');}
}
function status(g){
  const state=g.desk?.state||g.deskState;
  return ({awaiting_payment:'결제 대기',partially_paid:'상대 결제 대기',paid:'모두 결제 완료 · 스쿨 확인 대기',booked:'예약 접수 완료',refund_review:'환불 확인 중',cancelled:'매칭 종료'})[state]
    ||({recruiting:'친구 모집 중',review:'참여 의사 확인',payment:'각자 결제 중',cancelled:'매칭 종료',booked:'예약 접수 완료'})[g.phase]||'신청 현황';
}
function groupCard(g,action){
  return `<article class="card"><div class="cardtop"><span class="label">${escape(status(g))}</span><span class="count-label">${escape(g.count)}/2명</span></div>
    <h3>${escape(g.birthYear)}년생 · ${escape(band(g.experience))} ${escape(g.experience)}회</h3><p class="meta">${escape(levels[g.level])}</p>
    <p class="slots-line">${(g.slots||[]).map(prettySlot).map(escape).join(' · ')}</p>
    <div class="foot"><span class="price-note">2시간 · 1인 ${price}</span>
    <button type="button" class="secondary" data-act="${action}" data-id="${escape(g.id)}">${action==='detail'?'진행 상황 보기':action==='join'?'이 모임에 참여하기':'내 조건으로 확인'}</button></div></article>`;
}
function searchBox(){
  return `<details class="search-box"${Object.keys(criteria).length?' open':''}><summary>모집 카드 조건 검색</summary><form id="search"><div class="grid">
    <label>내 강습 경험 (회)<input name="experience" type="number" min="0" max="500" step="1" inputmode="numeric" placeholder="전체" value="${escape(criteria.experience)}"></label>
    <label>찾을 친구 출생연도${yearInput('birth_year',criteria.birth_year)}</label>
    <label>찾을 스키 동작<select name="level"><option value="">전체</option>${entries(levels,criteria.level)}</select></label>
    <label>요일·시간대<select name="period"><option value="">전체</option>${entries(periods,criteria.period)}</select></label>
    <label>가능한 날짜<input name="date" type="date" min="${today()}" value="${escape(criteria.date)}"></label>
    <label>시작 시간<select name="time"><option value="">전체</option>${times(criteria.time)}</select></label></div>
    <p class="hint">주말은 토·일요일이에요. 야간 강습은 오후 7시부터 시작해요.</p>
    <div class="actions"><button class="primary" type="submit">카드 검색</button>${cta('clear','초기화','minor')}</div></form></details>`;
}
function fitsSearchSlot(slot,{date,time,period}){
  const [day,start]=slot.split('T');
  if((date&&day!==date)||(time&&start!==time))return false;
  if(!period)return true;
  const weekday=new Date(day+'T00:00:00Z').getUTCDay();
  return period===(weekday===0||weekday===6?'weekend':'weekday')+'-'+(start>='19:00'?'night':'day');
}
async function board(){
  const version=++navVersion;
  const disabled=configError?'모집 현황을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.':'현재 온라인 매칭 접수를 준비하고 있습니다.';
  let loadError=false;
  if(cfg.enabled){try{
    cards=(await api('list',{filters:criteria})).groups||[];
    if(criteria.date||criteria.time||criteria.period){
      cards=cards.map(g=>({...g,slots:g.slots.filter(s=>fitsSearchSlot(s,criteria))})).filter(g=>g.slots.length);
    }
  }catch{loadError=true;cards=[];}}
  else cards=[];
  if(version!==navVersion)return;
  render('board','board',`<header class="hero"><div class="hero-copy"><p class="brand">라이즌스키스쿨</p><h1>둘이 배우는<br>스키 친구</h1>
    <p>경험과 일정이 맞는 친구와 곤지암에서 함께 타요.</p></div><div class="hero-photo"><img src="./risen-match.webp" alt="" width="600" height="800"></div></header>
    <div class="panel heading"><div class="spread"><div><h2>내 조건으로 매칭</h2><p class="hint">스키 2시간 · 강습생 둘 · 1인 ${price}</p></div>
    ${cfg.enabled?cta('start','친구 찾아보기','primary'):''}</div></div>
    ${cfg.enabled?`<h2 class="section-title">모집 중인 모임</h2>${searchBox()}<div id="results" aria-live="polite">
    ${loadError?'<p class="note">모집 목록을 불러오지 못했어요. 다시 검색해 주세요.</p>':cards.map(g=>groupCard(g,'card')).join('')||'<p class="note">이 조건의 모집이 아직 없어요. 다른 조건을 검색하거나 새 카드를 열어 보세요.</p>'}</div>`:
    `<div class="panel"><p>${disabled}</p><div class="actions">${cta('reload','다시 확인')}<a class="message-link secondary" href="${brandBook}" target="_blank" rel="noopener noreferrer">기존 강습 예약</a></div></div>`}`);
  const form=$('#search');if(form)form.onsubmit=e=>{e.preventDefault();run(async()=>{
    criteria=Object.fromEntries([...new FormData(form)].filter(([,v])=>v!==''));
    for(const k of ['experience','birth_year'])if(k in criteria)criteria[k]=Number(criteria[k]);
    await board();$('#results')?.scrollIntoView({block:'nearest'});
  });};
}

function start(group=null){
  profile={birth_year:'',level:'',experience:'',slots:[],name:'',gender:'',goal:''};
  slots=group?[...group.slots]:[];
  selectedGroup=group?.id||null;pending=null;actionId=null;lastActionSignature=null;
  searchProfile();
}
function drawSlots(){
  $('#picked').innerHTML=slots.length?slots.map((s,i)=>`<button class="slot" type="button" data-act="remove" data-i="${i}" aria-label="${escape(prettySlot(s))} 삭제">${escape(prettySlot(s))} ×</button>`).join(''):'<span class="hint">날짜와 시작 시간을 골라 추가하세요.</span>';
}
function searchProfile(){
  const [date,time]=(slots[0]||'T').split('T');
  render('profile','board',`${cta('board','‹ 모집 카드로','back')}<h2>어떤 친구와 배울까요?</h2><p class="hint">연락처 없이 가능한 모임부터 찾아보세요.</p>
    <form id="profile" class="panel heading"><div class="grid"><label>강습생 출생연도${yearInput('birth_year',profile.birth_year,true)}</label>
    <label>강습 경험 (회)<input type="number" name="experience" inputmode="numeric" min="0" max="500" step="1" placeholder="첫 강습은 0" required value="${escape(profile.experience)}"></label></div>
    <p class="hint" id="age-note" aria-live="polite"></p><p class="hint" id="exp-note" aria-live="polite"></p>
    <label class="control">현재 가능한 동작<select name="level" required><option value="">선택해 주세요</option>${entries(levels,profile.level)}</select></label>
    <fieldset class="section-title"><legend>가능한 날짜와 시작 시간</legend><p class="hint">함께 탈 수 있는 일정을 최대 12개까지 추가하세요. 모두 한국시간입니다.</p>
    <div class="slot-add"><label class="control">날짜<input type="date" name="date" min="${today()}" value="${escape(date)}"></label>
    <label class="control">시작 시간<select name="time">${times(time)}</select></label>${cta('add','일정 추가')}</div>
    <div class="slots" id="picked"></div></fieldset><div class="actions"><button class="primary" type="submit">맞는 친구 보기</button></div></form>
    <div id="one-on-one" class="panel" hidden><h3>6살 미만은 1대1로 함께해요</h3><p>올해 한국나이 6살부터 2대1 스키강습에 참여할 수 있어요.</p>${oneToOne}</div>`);
  const form=$('#profile'), f=form.elements;
  drawSlots();
  function explain(){
    const year=Number(f.birth_year.value),known=f.birth_year.value.length===4&&year>=asYear()-120&&year<=asYear();
    const under=known&&ageOf(year)<6;
    $('#age-note').textContent=known?`올해 한국나이 ${ageOf(year)}살 · 2대1은 6살부터 신청할 수 있어요.`:'출생연도로 올해 한국나이를 확인해요.';
    $('#one-on-one').hidden=!under;
    form.querySelector('[type=submit]').disabled=under;
    const n=Number(f.experience.value);
    $('#exp-note').textContent='입문 0회 · 초급 1~8회 · 중급 9회 이상.'+(f.experience.value===''?'':n===0?' 첫 강습생은 0~2회 친구와 함께할 수 있어요.':n<=2?' 1~8회 친구 또는 첫 강습 친구와 함께할 수 있어요.':n<=8?' 1~8회 경험자와 함께할 수 있어요.':' 9회 이상 경험자와 함께할 수 있어요.');
  }
  f.birth_year.oninput=explain;f.experience.oninput=explain;explain();
  form.onsubmit=e=>{e.preventDefault();run(async()=>{
    if(!slots.length)throw Error('가능한 날짜와 시간을 한 개 이상 추가해 주세요.');
    profile={...profile,birth_year:Number(f.birth_year.value),experience:Number(f.experience.value),level:f.level.value,slots:[...slots]};
    if(ageOf(profile.birth_year)<6)throw Error('6살 미만은 1대1 강습을 이용해 주세요.');
    await alternatives();
  });};
}
async function alternatives(){
  candidates=(await api('list',{filters:{experience:profile.experience,slots:[...slots]}})).groups||[];
  if(selectedGroup)candidates.sort((a,b)=>Number(b.id===selectedGroup)-Number(a.id===selectedGroup));
  render('candidates','board',`${cta('edit','‹ 내 조건 수정','back')}<h2>${candidates.length?'함께할 수 있는 친구 '+candidates.length+'명':'함께할 친구를 모집해 보세요'}</h2>
    <p class="hint">${candidates.length?'강습 경험 범위가 맞고 날짜와 시작 시간이 겹치는 모임이에요. 출생연도와 가능한 동작을 직접 비교해 보세요.':'이 경험과 일정에 맞는 모집이 아직 없어요.'}</p>
    ${candidates.map(g=>groupCard({...g,slots:g.slots.filter(s=>slots.includes(s))},'join')).join('')}
    <div class="panel heading"><h3>내 일정으로 새 카드 열기</h3><p class="hint">친구 한 명이 참여하면 모집을 마감합니다.</p><div class="actions">${cta('create','내 모임 열기',candidates.length?'secondary':'primary')}</div></div>`);
}
function validateConfig(){if(!cfg.enabled)throw Error('현재 신규 매칭 접수는 준비 중입니다.');}
function openEnroll(mode,id){
  validateConfig();
  pending={mode,id}; actionId=null;lastActionSignature=null;
  if(session)enroll();else auth('enroll');
}
function resetProof(){
  if(verifyState){verifyState.challengeId=null;verifyState.phone=null;}
  const otp=$('#otp-block');if(otp)otp.hidden=true;
}
function getPhone(form){
  const value=form.elements.phone.value.replace(/[\s-]/g,'');
  if(!/^010\d{8}$/.test(value))throw Error('알림톡을 받을 휴대폰 번호 11자리를 확인해 주세요.');
  return value;
}
function loadChallenge(){
  if(typeof window.turnstile?.render==='function')return Promise.resolve();
  if(!turnstileLoad)turnstileLoad=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;
    script.onload=resolve;script.onerror=()=>{turnstileLoad=null;script.remove();reject(Error('보안 확인을 불러오지 못했어요. 다시 시도해 주세요.'));};
    document.head.appendChild(script);
  });
  return turnstileLoad;
}
function auth(next){
  validateConfig();verifyState={next,token:null,challengeId:null,phone:null};
  render('auth',next==='enroll'?'board':'mine',`${cta('board','‹ 친구 찾기','back')}<h2>휴대폰으로 본인 확인</h2>
    <p class="hint">매칭·진행 안내를 받을 번호를 입력해 주세요. 어린 강습생은 보호자 번호를 사용하세요.</p>
    <form id="auth" class="panel heading"><label class="control">휴대폰 번호<input type="tel" name="phone" inputmode="tel" autocomplete="tel-national" placeholder="010-1234-5678" required></label>
    <label class="check"><input type="checkbox" required name="privacy"><span>[필수] 휴대폰 번호를 본인 인증과 신청 조회에 이용하는 데 동의합니다.</span></label>
    <details><summary>인증과 정보 이용 안내</summary><p>라이즌은 본인 확인 및 매칭 안내에 휴대폰 번호를 사용합니다. 거절할 경우 카드 등록·참여와 개인 신청 조회가 제한됩니다. 만료된 모집 자료는 보유 기준에 따라 정리하며 예약·결제 기록은 별도 보관됩니다. <a href="${privacyURL}" target="_blank" rel="noopener noreferrer">개인정보처리방침</a></p></details>
    <div id="challenge-widget" class="challenge"></div><div class="actions"><button type="button" class="secondary" data-act="otp" disabled>알림톡 인증번호 받기</button></div>
    <fieldset id="otp-block" hidden><legend>알림톡 인증번호</legend><input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6자리">
    <div class="actions"><button type="submit" class="primary">인증하고 계속하기</button></div></fieldset></form>`);
  const thisState=verifyState, form=$('#auth');
  form.elements.phone.oninput=resetProof;
  if(!cfg.siteKey){say('본인 확인 준비 중입니다. 잠시 후 다시 이용해 주세요.');return;}
  loadChallenge().then(()=>{
    if(active!=='auth'||verifyState!==thisState)return;
    const receive=token=>{
      if(verifyState!==thisState||active!=='auth')return;
      thisState.token=token;
      form.querySelector('[data-act=otp]').disabled=!token;
    };
    turnstileWidget=window.turnstile.render($('#challenge-widget'),{sitekey:cfg.siteKey,action:'friend_otp',size:'flexible',
      callback:receive,'expired-callback':()=>receive(null),'error-callback':()=>receive(null)});
  }).catch(e=>{if(active==='auth'&&verifyState===thisState)say(e.message);});
  form.onsubmit=e=>{e.preventDefault();run(async()=>{
    const phone=getPhone(form),code=form.elements.code.value.trim();
    if(!form.elements.privacy.checked||!verifyState.challengeId||phone!==verifyState.phone||!/^\d{6}$/.test(code))throw Error('입력한 번호로 받은 6자리 인증번호를 확인해 주세요.');
    const result=await api('verify',{challengeId:verifyState.challengeId,phone,code});
    if(!result.session)throw Error('인증 결과를 확인하지 못했어요. 다시 인증해 주세요.');
    session=result.session;verifyState=null;form.reset();
    if(next==='enroll')enroll();else if(next==='detail'&&selectedGroup)await detail(selectedGroup);else await mine();
  });};
}
async function requestCode(){
  const form=$('#auth'),phone=getPhone(form);
  if(!form.elements.privacy.checked)throw Error('먼저 필수 인증 정보 이용에 동의해 주세요.');
  if(!verifyState.token)throw Error('보안 확인을 마친 뒤 인증번호를 요청해 주세요.');
  const token=verifyState.token;verifyState.token=null;
  try {
    const result=await api('otp',{phone,turnstile:token,privacy:true});
    if(!result.challengeId)throw Error('인증번호 요청이 접수되지 않았습니다.');
    verifyState.phone=phone;verifyState.challengeId=result.challengeId;
    $('#otp-block').hidden=false;form.elements.code.value='';form.elements.code.focus();say('입력한 번호의 카카오 알림톡을 확인해 주세요.');
  } finally { if(turnstileWidget!==null)window.turnstile.reset(turnstileWidget); }
}

function consent(key,text,body,required=true){
  return `<label class="check"><input type="checkbox" name="${key}" ${required?'required':''}><span>[${required?'필수':'선택'}] ${text}</span></label>
    ${body?`<details><summary>자세히 보기</summary><p>${body}</p></details>`:''}`;
}
function enroll(){
  const creating=pending.mode==='create';
  const guardian=ageOf(profile.birth_year)<=15;
  render('enroll','board',`${cta('candidates','‹ 모집 카드로','back')}<h2>${creating?'내 모집 카드 열기':'이 모임에 참여하기'}</h2>
    <p class="hint">${escape(profile.birth_year)}년생 · 강습 ${profile.experience}회 · ${slots.length}개 가능 일정</p>
    <form id="enroll" class="panel heading"><label class="control">강습생 이름<input name="name" type="text" maxlength="40" autocomplete="off" required></label>
    <div class="grid"><label>강습생 성별<select name="gender" required><option value="">선택해 주세요</option>${entries(genders,profile.gender)}</select></label>
    <label>강습 목표<select name="goal" required><option value="">선택해 주세요</option>${entries(goals,profile.goal)}</select></label></div>
    <p class="hint">친구에게 알려 주고 싶은 목표를 골라 주세요. 목표는 첫 개인 매칭 알림에만 포함합니다.</p>
    <fieldset class="consents"><legend>신청 전 확인</legend>
    ${consent('service','매칭 이용 안내를 확인하고 참여를 신청합니다.','상대와 따로 정한 약속이나 사적 금전 거래는 당사자끼리 협의해 주세요. 라이즌이 제공하는 매칭·예약·결제·강습의 문의와 분쟁은 스쿨이 접수합니다. 두 사람이 같은 일정에 동의하면 각자 결제 안내를 받습니다.')}
    ${consent('privacy','매칭 신청에 필요한 개인정보 수집·이용에 동의합니다.',`라이즌은 신청자 연락, 안전한 팀 구성과 신청 관리를 위해 강습생 이름·출생연도·성별 응답·동작·강습 경험·목표·희망 일정·인증된 연락처와 동의 기록을 이용합니다. 미성사 모집 카드는 14일 후 만료되며 예약·결제 기록은 별도 보관합니다. 거절하면 카드 개설·참여가 어렵습니다. <a href="${privacyURL}" target="_blank" rel="noopener noreferrer">개인정보처리방침</a>`)}
    ${consent('sharing','모집 조건 공개와 매칭 상대에게 강습 정보 제공에 동의합니다.','모집 카드에는 출생연도·스키 동작·강습 경험·희망 일정만 공개합니다. 참여가 성립하면 매칭된 상대 한 명 또는 그 보호자가 팀 구성과 일정 확정을 위해 강습생 식별 정보·출생연도·성별 응답·동작·경험·강습 목표와 함께 가능한 일정을 안내받습니다. 상대에게 연락처나 현금영수증 번호는 제공하지 않습니다. 상대가 받은 메시지는 해당 일정 확인 목적으로만 이용해야 하며, 공유를 거절하면 신청할 수 없습니다.')}
    ${guardian?consent('guardian','법정대리인으로서 자녀의 정보 이용·제공에 동의합니다.','출생연도만으로 만 14세 여부가 불확실한 경우도 보호자 확인을 요청합니다. 라이즌 담당자가 확인한 보호자 휴대폰 번호로 진행해 주세요.'):''}
    ${consent('marketing','카카오로 라이즌 강습·이벤트 광고성 정보 받기','라이즌이 인증된 휴대폰 번호로 시즌 혜택과 할인 소식을 안내합니다. 거절해도 매칭을 이용할 수 있습니다. 수신 동의는 라이즌 고객센터를 통해 철회할 수 있습니다.',false)}</fieldset>
    <div class="actions"><button class="primary" type="submit">${creating?'모집 카드 만들기':'참여 신청하기'}</button></div></form>`);
  const form=$('#enroll');
  form.onsubmit=e=>{e.preventDefault();run(async()=>{
    const f=form.elements,consents={service:f.service.checked,privacy:f.privacy.checked,sharing:f.sharing.checked,
      guardian:f.guardian?.checked??false,marketing:f.marketing.checked};
    const data={...profile,name:f.name.value.trim(),gender:f.gender.value,goal:f.goal.value};
    if(!data.name)throw Error('강습생 이름을 입력해 주세요.');
    const signature=JSON.stringify([pending,consents,data]);
    if(signature!==lastActionSignature||!actionId){lastActionSignature=signature;actionId=crypto.randomUUID();}
    const result=await api(creating?'create':'join',{request_id:actionId,profile:data,consents,...(creating?{allow_duplicate:candidates.length>0}:{groupId:pending.id})});
    lastActionSignature=null;actionId=null;profile=null;pending=null;
    const id=result.group?.id;
    if(!id){await mine();return;}
    await detail(id,result);
    say(creating?'모집 카드가 등록되었습니다. 친구 한 명이 참여하면 안내를 받습니다.':'참여 신청이 접수됐어요. 두 분에게 전달되는 개인 알림을 확인해 주세요.');
  });};
}
function participant(person,title){
  if(!person)return '';
  return `<div class="person"><h3>${title} · ${escape(person.alias)}</h3><p class="meta">${escape(person.birthYear)}년생 · ${escape(genders[person.gender])} · ${escape(levels[person.level])} · 강습 ${escape(person.experience)}회</p></div>`;
}
function terms(){
  return `<details><summary>강습 준비 및 취소·환불 안내</summary><p>강습 1시간 전 안내받은 제휴 렌탈샵에 도착해 주세요. 제4주차장 셔틀 픽업을 이용하면 2시간 전까지 준비해 주세요.</p>
    <p>취소 시점·사유에 따른 환불 조건과 적용 예외를 결제 전 확인해 주세요. <a href="${policyURL}" target="_blank" rel="noopener noreferrer">라이즌 요금 및 환불 기준</a> · <a href="https://www.risenski.com/prepare" target="_blank" rel="noopener noreferrer">준비사항</a></p></details>`;
}
function payConsent(){
  return '<p class="consent">상대도 함께 배울 의사를 밝혔습니다. 두 분이 같은 시간에 최종 동의하면 스쿨이 일정을 준비하고 결제 안내를 보냅니다. 결제가 늦어지거나 취소하면 상대의 강습 일정에도 영향을 줍니다. 실제로 함께할 수 있을 때 동의해 주세요.</p>';
}
function checkoutAllowed(url){
  try{const u=new URL(url);return u.origin==='https://pay.toss.im'&&u.pathname==='/payfront/auth'&&Boolean(u.searchParams.get('payToken'))&&!u.username&&!u.password;}catch{return false;}
}
async function mine(){
  if(!cfg.enabled){await board();return;}
  if(!session){auth('mine');return;}
  const result=await api('mine');
  cards=result.groups||[];
  render('mine','mine',`<h2>내 신청</h2><p class="hint">인증한 번호로 모집하거나 참여한 강습입니다.</p>
    ${cards.map(g=>groupCard(g,'detail')).join('')||'<p class="panel">아직 신청한 모임이 없어요.</p>'}<div class="actions">${cta('board','친구 찾기')}${cta('logout','인증 종료','minor')}</div>`);
}
async function detail(id,given=null){
  if(!uuidPattern.test(id))throw Error('매칭 주소를 확인해 주세요.');
  selectedGroup=id;
  if(!session){auth('detail');return;}
  const v=given||await api('detail',{groupId:id}),group=v.group;
  if(!group)throw Error('이 번호로 볼 수 있는 신청인지 확인해 주세요.');
  // Keep private identifiers out of outbound URLs and browser storage. The hash survives Toss redirects.
  history.replaceState(null,'','#group='+encodeURIComponent(id));
  const role=v.role, peer=role==='host'?'guest':'host';
  const p=v.phase,desk=v.desk||{},paid=desk.paid||{},confirmations=v.confirmations||{};
  const done=['booked','paid','refund_review','cancelled'].includes(desk.state);
  let content=`${cta('mine','‹ 내 신청','back')}<h2>${escape(status(v))}</h2><div class="panel heading"><div class="spread"><h3>라이즌 2대1 스키강습</h3><span class="money">1인 ${price}</span></div>
    <p class="hint">강습생 2명 · 강사 1명 · 2시간${v.selectedSlot?' · '+escape(prettySlot(v.selectedSlot)):''}</p>${terms()}</div>`;
  if(p==='recruiting')content+=`<div class="panel"><h3>친구 한 명을 기다리고 있어요</h3>${participant(v.me,'내 프로필')}<p>${group.slots.map(prettySlot).map(escape).join(' · ')}</p></div>`;
  else if(v.other)content+=`<div class="panel">${participant(v.other,'매칭된 친구')}${participant(v.me,'나')}</div>`;
  if(p==='review'){
    content+=`<div class="panel"><h3>함께할 일정을 확인해 주세요</h3><p class="hint">나 ${confirmations[role]?'동의':'대기'} · 친구 ${confirmations[peer]?'동의':'대기'}</p>`;
    if(!confirmations[role]){
      const slot=v.selectedSlot?`<p class="note">친구가 선택한 일정 · ${escape(prettySlot(v.selectedSlot))}</p>`:`<label class="control">겹치는 일정<select name="slot" required>${(v.commonSlots||[]).map(s=>`<option value="${escape(s)}">${escape(prettySlot(s))}</option>`).join('')}</select></label>`;
      content+=`<form id="agree">${slot}${payConsent()}<label class="check"><input type="checkbox" required><span>상대 정보와 일정을 확인했고 함께 진행하겠습니다.</span></label><div class="actions"><button type="submit" class="primary">이 일정으로 진행 확정</button>${cta('decline','함께하지 않기','minor')}</div></form>`;
    }else content+='<p>같은 일정에 대한 상대의 최종 동의를 기다리고 있어요.</p>';
    content+='</div>';
  }
  if(p==='payment'||desk.state){
    content+=`<div class="panel"><h3>${escape(status(v))}</h3><p>나 ${paid[role]?'결제 완료':'결제 대기'} · 친구 ${paid[peer]?'결제 완료':'결제 대기'}</p>`;
    if(p==='payment'&&!done&&!paid[role])content+=`<form id="checkout"><label class="check"><input type="checkbox" name="receipt"><span>현금영수증 요청 (선택)</span></label>
      <label id="cash" hidden class="control">현금영수증 요청 휴대폰 번호<input name="cashPhone" inputmode="tel" type="tel" autocomplete="off" placeholder="010-1234-5678" disabled></label>
      <label class="check"><input type="checkbox" name="terms" required><span>선택한 일정·금액과 취소·환불 안내를 확인했어요.</span></label>
      <div class="actions"><button type="submit" class="primary">토스페이로 ${price} 결제</button></div></form>`;
    if(desk.state==='paid')content+='<p>두 분 모두 결제를 마쳤어요. 라이즌 담당자가 내용을 확인하면 예약으로 접수됩니다.</p>';
    if(desk.state==='booked')content+='<p>스쿨에서 결제를 확인하고 예약을 접수했습니다.</p>';
    content+='</div>';
  }
  if(p==='recruiting')content+=`<details><summary>모집 취소</summary>${cta('decline','이 모집 취소하기','danger')}</details>`;
  content+=`<div class="actions">${cta('refresh','진행 상태 새로고침')}${cta('logout','인증 종료','minor')}</div>`;
  render('detail','mine',content);
  const agree=$('#agree');
  if(agree)agree.onsubmit=e=>{e.preventDefault();run(async()=>{
    const slot=v.selectedSlot||agree.elements.slot?.value;if(!slot)throw Error('함께 가능한 일정을 골라 주세요.');
    await api('confirm',{groupId:id,slot});await detail(id);
  });};
  const pay=$('#checkout');
  if(pay){
    pay.elements.receipt.onchange=()=>{
      const yes=pay.elements.receipt.checked;$('#cash').hidden=!yes;pay.elements.cashPhone.disabled=!yes;pay.elements.cashPhone.required=yes;if(!yes)pay.elements.cashPhone.value='';
    };
    pay.onsubmit=e=>{e.preventDefault();run(async()=>{
      const phone=pay.elements.cashPhone.value.replace(/[\s-]/g,'');
      if(pay.elements.receipt.checked&&!/^010\d{8}$/.test(phone))throw Error('현금영수증 요청 번호를 확인해 주세요.');
      const result=await api('checkout',{groupId:id,...(pay.elements.receipt.checked?{cashReceiptPhone:phone}:{})});
      if(!checkoutAllowed(result.payUrl))throw Error('검증된 토스페이 결제 링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      pay.elements.cashPhone.value='';
      // Cross-origin iframes may block script-driven top navigation. A real user click can leave the frame.
      const link=document.createElement('a');link.className='primary message-link';link.href=result.payUrl;link.target='_top';link.rel='noreferrer';link.textContent=`토스페이 결제창 열기 · ${price}`;
      pay.replaceChildren(link);link.focus();say('토스페이 결제창에서 최종 금액과 결제수단을 확인해 주세요.');
    });};
  }
}
async function refreshConfig(){
  configError=false;try{cfg=await api('config');}catch{cfg={enabled:false};configError=true;}
  if(cfg.enabled&&groupFromHash()){selectedGroup=groupFromHash();await detail(selectedGroup);}else await board();
}
async function navigate(tab){
  // Explicit navigation always leaves the previous personal deep link.
  ++navVersion;history.replaceState(null,'',location.pathname+location.search);
  say();pending=null;profile=null;verifyState=null;actionId=null;lastActionSignature=null;selectedGroup=null;
  if(tab==='mine')await mine();else await board();
}
document.querySelector('.tabs').addEventListener('click',e=>{
  const tab=e.target.closest('button[data-page]');if(tab)run(()=>navigate(tab.dataset.page));
});
view.addEventListener('click',e=>{
  const node=e.target.closest('button[data-act]');if(!node)return;e.preventDefault();
  const act=node.dataset.act;
  run(async()=>{
    if(act==='board'||act==='mine')return navigate(act);
    if(act==='reload')return refreshConfig();
    if(act==='clear'){criteria={};return board();}
    if(act==='start')return start();
    if(act==='card')return start(cards.find(g=>g.id===node.dataset.id));
    if(act==='edit')return searchProfile();
    if(act==='add'){
      const f=$('#profile').elements,slot=f.date.value+'T'+f.time.value;
      if(!f.date.value||Date.parse(slot+':00+09:00')<=Date.now())throw Error('앞으로 가능한 날짜와 시간을 선택해 주세요.');
      if(slots.includes(slot))throw Error('이미 선택한 일정입니다.');
      if(slots.length>=12)throw Error('일정은 최대 12개를 선택할 수 있어요.');
      slots.push(slot);slots.sort();return drawSlots();
    }
    if(act==='remove'){slots.splice(Number(node.dataset.i),1);return drawSlots();}
    if(act==='join'||act==='create')return openEnroll(act,node.dataset.id);
    if(act==='candidates')return alternatives();
    if(act==='otp')return requestCode();
    if(act==='detail')return detail(node.dataset.id);
    if(act==='refresh')return detail(selectedGroup);
    if(act==='decline'){
      if(!window.confirm('이 모임의 진행을 취소하시겠어요?'))return;
      await api('decline',{groupId:selectedGroup});return detail(selectedGroup);
    }
    if(act==='logout'){session=null;verifyState=null;profile=null;slots=[];pending=null;await navigate('board');say('이 기기의 매칭 인증을 종료했어요.');}
  });
});
window.addEventListener('pageshow',e=>{if(e.persisted&&selectedGroup&&active==='detail')run(()=>detail(selectedGroup));});
window.addEventListener('hashchange',()=>{const id=groupFromHash();if(id&&cfg.enabled)run(()=>detail(id));});
if(parentOrigin&&parent!==window){
  let last=0;new ResizeObserver(()=>{const height=Math.ceil(document.querySelector('main').getBoundingClientRect().height);if(height!==last){last=height;post({type:'risen-match:size',height});}}).observe(document.querySelector('main'));
}
run(refreshConfig);

