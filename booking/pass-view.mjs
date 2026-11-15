import {bookingCompanyOptions,normalizeBookingCompany} from './company-options.mjs?v=31';
import {canonicalTelephone} from './customer-teams.mjs?v=26';

const escapeFallback=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list=value=>Array.isArray(value)?value:[];
const first=(row,...keys)=>{for(const key of keys)if(row?.[key]!==undefined&&row[key]!==null)return row[key];return undefined;};
const text=value=>String(value??'').trim();
const integer=value=>value!==''&&value!==null&&value!==undefined&&Number.isInteger(Number(value))?Number(value):null;
const passIdOf=row=>text(first(row,'lessonPassId','lesson_pass_id'));
const reservationIdOf=row=>text(first(row,'id','schedule_id','scheduleId'));
const cancelled=row=>['cancelled','canceled'].includes(row?.status);
const dateFormatter=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric'});
const dateLabel=value=>value&&Number.isFinite(Date.parse(value))?dateFormatter.format(new Date(value)):'—';
const newDraft=()=>({id:null,customerName:'',learnerName:'',phone:'',company:'',sport:'스키',totalSessions:'',lessonRatio:'',participants:[],fixedInstructorId:'',notes:''});
const count=value=>{const result=integer(value);return result!==null&&result>=0?result:null;};

/** A linked reservation consumes one session; date edits and duplicates do not. */
export function selectPassBalances(context={}){
  const linked=new Map();
  const statuses=new Map(list(context.passStatuses).map(row=>[text(first(row,'passId','pass_id')),row]));
  const cancelledIds=new Set([...list(context.reservations),...list(context.schedules)].filter(cancelled).map(reservationIdOf).filter(Boolean));
  // Explicit checkout proofs only. A past end time or a reservation status is not proof.
  const checkoutIds=new Set(list(context.checkouts).filter(row=>row&&(!row.kind||row.kind==='checkOut')).map(row=>text(first(row,'scheduleId','schedule_id'))).filter(Boolean));
  list(context.reservations).forEach((reservation,index)=>{
    if(cancelled(reservation)||cancelledIds.has(reservationIdOf(reservation)))return;
    const passId=passIdOf(reservation);if(!passId)return;
    const ids=linked.get(passId)||new Set();
    ids.add(reservationIdOf(reservation)||`missing-id-${index}`);
    linked.set(passId,ids);
  });
  return list(context.lessonPasses).map(pass=>{
    const id=text(pass.id),statusRow=statuses.get(id),statusTotal=count(statusRow?.total),statusScheduled=count(statusRow?.scheduled),statusCompleted=count(statusRow?.completed);
    const completionVerified=statusTotal!==null&&statusScheduled!==null&&statusCompleted!==null&&statusCompleted<=statusScheduled;
    const total=completionVerified?statusTotal:integer(first(pass,'total_sessions','totalSessions'));
    const ids=linked.get(id)||new Set(),scheduled=completionVerified?statusScheduled:ids.size;
    const completed=completionVerified?statusCompleted:[...ids].filter(scheduleId=>checkoutIds.has(scheduleId)).length;
    const available=total===null?null:Math.max(0,total-scheduled);
    const pending=Math.max(0,scheduled-completed),remaining=total===null?null:Math.max(0,total-completed);
    const fixedInstructorId=text(first(pass,'fixed_instructor_user_id','fixedInstructorId'))||null;
    const person=list(context.roster).find(row=>row.user_id===fixedInstructorId);
    return {...pass,pass,id,total,scheduled,available,totalSessions:total,scheduledSessions:scheduled,availableSessions:available,
      completed,pending,remaining,unbooked:available,completedSessions:completed,pendingSessions:pending,remainingSessions:remaining,completionVerified,
      customerName:text(first(pass,'customer_name','customerName')),learnerName:text(first(pass,'learner_name','learnerName')),
      phone:text(pass.phone),company:text(pass.company),sport:text(pass.sport),fixedInstructorId,
      instructorName:fixedInstructorId?(person?.display_name||'담당 계정 확인 필요'):'강사 미정',
      status:pass.status||'active',overbooked:total!==null&&scheduled>total};
  });
}

function configuration(ui={}){
  const current=ui.passes||{};
  return {query:'',sport:'all',issuing:false,draft:null,error:'',...current};
}
const options=(values,selected,escape)=>values.map(([value,label])=>`<option value="${escape(value)}" ${String(value)===String(selected)?'selected':''}>${escape(label)}</option>`).join('');

function renderIssue(settings,context,escape,preview){
  if(!settings.issuing)return '';
  const draft={...newDraft(),...(settings.draft||{})};
  const people=list(context.roster).filter(person=>person.role==='instructor'&&person.active);
  const companies=bookingCompanyOptions([...list(context.reservations).map(row=>text(row.company||row.raw?.E)),...list(context.lessonPasses).map(row=>text(row.company)),draft.company]);
  return `<div class="lp-overlay" data-pass-backdrop><aside class="lp-drawer" role="dialog" aria-modal="true" aria-labelledby="lesson-pass-issue-title"><header><div><span class="lp-eyebrow">LESSON PASS${preview?' · 체험':''}</span><h2 id="lesson-pass-issue-title">수강권 발급</h2><p>날짜와 시간을 정하지 않고 먼저 등록합니다.</p></div><button type="button" class="icon-btn" data-pass-close aria-label="수강권 발급 닫기">×</button></header><form class="lp-issue-form" novalidate><div class="lp-drawer-body"><div class="lp-form-error" role="alert" ${settings.error?'':'hidden'}>${escape(settings.error)}</div><div class="lp-form-grid"><label class="field"><span class="field-label">고객명 · 입금자 <b>*</b></span><input name="customerName" value="${escape(draft.customerName)}" required maxlength="120" autocomplete="off"></label><label class="field"><span class="field-label">강습생 이름·구분 <b>*</b></span><input name="learnerName" value="${escape(draft.learnerName)}" required maxlength="120" autocomplete="off"></label><label class="field"><span class="field-label">연락처</span><input name="phone" type="tel" value="${escape(draft.phone)}" maxlength="30" autocomplete="off"></label><label class="field"><span class="field-label">강습센터 <b>*</b></span><select name="company" required>${options([['','센터를 선택해 주세요'],...companies.map(company=>[company,company])],normalizeBookingCompany(draft.company),escape)}</select></label><label class="field"><span class="field-label">종목 <b>*</b></span><select name="sport">${options([['','종목을 선택해 주세요'],['스키','스키'],['보드','보드']],draft.sport,escape)}</select></label><label class="field"><span class="field-label">수강권 비율 <small>강사:수강생</small></span><input name="lessonRatio" value="${escape(draft.lessonRatio||'')}" maxlength="5" placeholder="예: 1:1, 1:2" autocomplete="off"></label></div>${Array.isArray(draft.participants)&&draft.participants.length?`<div class="lp-participants"><span class="field-label">참가자 ${draft.participants.length}명 <small>예약 등록창의 개인 명부 선택이 그대로 담깁니다</small></span><div class="bk-team-chips">${draft.participants.map(person=>`<span class="bk-person-chip">${person.type==='minor'?`미성년${Number.isInteger(person.age)?` ${person.age}세`:''}`:'성인'}</span>`).join('')}</div></div>`:''}${draft.paymentReviewId?`<p class="lp-count-note" data-pass-payment-summary>검토한 입금 <strong>${escape(Number(draft.paymentAllocationAmount).toLocaleString('ko-KR'))}원</strong>을 이 수강권에 연결합니다. 날짜·시간은 나중에 신청하며, 총 횟수는 상담 원문과 대조해 입력하세요.</p>`:''}<label class="field"><span class="field-label">총 강습 횟수 <b>*</b></span><span class="lp-number-input"><input name="totalSessions" type="number" min="1" max="100" step="1" value="${escape(draft.totalSessions)}" required><span>회</span></span></label><label class="field"><span class="field-label">담당 강사</span><select name="fixedInstructorId">${options([['','강사 미정'],...people.map(person=>[person.user_id,person.display_name])],draft.fixedInstructorId,escape)}</select><span class="field-help">강사 미정으로 발급할 수 있습니다. 첫 강습의 담당이 정해지면 이후 회차에도 같은 강사를 유지합니다.</span></label><label class="field"><span class="field-label">메모</span><textarea name="notes" maxlength="2000" rows="4" placeholder="상담 내용이나 요청사항을 남겨 주세요.">${escape(draft.notes)}</textarea></label><p class="lp-count-note">예약 1건을 연결하면 1회가 일정 등록됩니다. 강습시간과 별도로 셉니다.</p></div><footer><span>${preview?'체험 수강권 · 서버에 저장되지 않습니다.':'확인 후 수강권을 등록합니다.'}</span><div><button type="button" class="btn secondary" data-pass-close>닫기</button><button type="submit" class="btn primary">수강권 발급</button></div></footer></form></aside></div>`;
}

/** Reuse the issuance drawer inside payment review without changing routes. */
export function renderPaymentPassIssue({state={},ui={},escapeHTML=escapeFallback}={}){
  const settings=configuration(ui);
  if(!settings.issuing||!(settings.draft?.paymentReviewId||settings.draft?.bookingIssue))return '';
  return `<section class="pass-page lp-payment-pass">${renderIssue(settings,state,escapeHTML,false)}</section>`;
}

export function renderPasses({state={},ui={},escapeHTML=escapeFallback,icon=()=>'',now=new Date()}={}){
  const settings=configuration(ui),escape=escapeHTML,preview=ui.booking?.demo!==false;
  const all=selectPassBalances(state),query=text(settings.query).normalize('NFKC').toLowerCase();
  const rows=all.filter(pass=>(settings.sport==='all'||pass.sport===settings.sport)&&(!query||`${pass.customerName} ${pass.learnerName} ${pass.phone} ${pass.company} ${pass.notes||''}`.normalize('NFKC').toLowerCase().includes(query)));
  const purchased=rows.reduce((sum,pass)=>sum+(pass.total||0),0),completed=rows.reduce((sum,pass)=>sum+pass.completed,0),pending=rows.reduce((sum,pass)=>sum+pass.pending,0),available=rows.reduce((sum,pass)=>sum+(pass.available||0),0);
  const unverified=!preview&&rows.some(pass=>!pass.completionVerified);
  const stats=[['총 발급 횟수',purchased,`조회된 수강권 ${rows.length}개 / 전체 ${all.length}개`, ''],['강습완료',completed,unverified?'완료 집계 확인 필요':'종료 인증이 확인된 강습', 'completed'],['예약·진행중',pending,'일정 등록 후 완료 확인 전', 'pending'],['미예약 잔여',available,'아직 날짜·시간을 정하지 않은 횟수', 'available']];
  const rowHTML=pass=>`<tr data-pass-row="${escape(pass.id)}"><th scope="row"><strong>${escape(pass.learnerName||'강습생 확인 필요')}</strong><span>${escape(pass.customerName||'고객 확인 필요')}</span>${pass.phone?`<small>${escape(pass.phone)}</small>`:''}</th><td data-pass-company>${escape(normalizeBookingCompany(pass.company)||'센터 미등록')}</td><td><span class="lp-sport ${pass.sport==='보드'?'board':''}">${escape(pass.sport||'종목 확인')}</span></td><td data-pass-total>${pass.total===null?'—':`${pass.total}회`}</td><td data-pass-completed class="lp-completed">${pass.completed}회${!preview&&!pass.completionVerified?'<small class="lp-count-unverified">집계 확인 필요</small>':''}</td><td data-pass-pending data-pass-scheduled="${pass.scheduled}">${pass.pending}회<small>일정 등록 ${pass.scheduled}회 중</small></td><td data-pass-available class="lp-available ${pass.available===0?'used':''}">${pass.available===null?'—':`${pass.available}회`}${pass.scheduled===0?'<small>전체 날짜 미정</small>':''}${pass.overbooked?'<small class="lp-overbooked">연결 내역 확인 필요</small>':''}</td><td><strong>${escape(pass.instructorName)}</strong><small>${pass.fixedInstructorId?'전 회차 동일 강사':'첫 강습 배정 시 담당 확정'}</small></td><td class="lp-note-cell"><span>${escape(dateLabel(pass.created_at||pass.createdAt))}</span>${pass.notes?`<small>${escape(pass.notes)}</small>`:''}</td><td class="lp-actions-cell"><div class="lp-pass-actions"><button type="button" class="btn secondary small" data-pass-schedule="${escape(pass.id)}" ${!pass.id||pass.available===null||pass.available<1||pass.status!=='active'?'disabled':''}>일정 등록 →</button><button type="button" class="btn ghost small lp-customer-link" data-pass-customer-link="${escape(pass.id)}" aria-label="${escape(pass.customerName)} · ${escape(pass.learnerName||'기본팀')} 고객용 상태 링크" ${pass.id?'':'disabled'}>고객용 상태 링크</button></div></td></tr>`;
  return `<section class="pass-page" aria-label="수강권 관리"><div class="lp-heading"><div><span class="lp-eyebrow">LESSON PASSES</span><h1>수강권</h1><p>날짜 미정 수강권부터 강습 완료까지, 횟수와 고객용 상태 링크를 관리하세요.</p></div><button type="button" class="btn primary" data-pass-new>${icon('plus')}수강권 발급</button></div><div class="lp-mode-note"><span class="lp-mode ${preview?'preview':'operational'}">${preview?'체험 수강권':'운영 수강권'}</span><span>${preview?'가상 데이터로 발급과 일정 연결을 체험합니다.':'발급한 수강권과 연결된 예약의 진행 상태를 확인합니다.'}</span></div><div class="lp-summary">${stats.map(([label,value,note,style])=>`<article class="${style}"><span>${label}</span><strong>${value}<small>회</small></strong><p>${note}</p></article>`).join('')}</div><section class="panel lp-filter-panel"><form class="lp-filter-form"><label><span>고객·강습생 검색</span><input name="query" type="search" value="${escape(settings.query)}" placeholder="고객명 · 강습생 · 연락처"></label><label><span>종목</span><select name="sport">${options([['all','전체 종목'],['스키','스키'],['보드','보드']],settings.sport,escape)}</select></label><button type="submit" class="btn secondary">조회</button><button type="button" class="btn ghost" data-pass-reset>초기화</button></form></section><p class="lp-action-status" data-pass-action-status role="status" aria-live="polite" hidden></p><section class="panel lp-table-panel"><div class="lp-table-heading"><div><h2>발급 수강권 <span>${rows.length}개</span></h2><p>총 횟수 = 강습완료 + 예약·진행중 + 미예약 잔여입니다. 고객용 링크에서도 같은 상태를 확인합니다.</p></div></div><div class="lp-table-scroll" tabindex="0" role="region" aria-label="수강권별 완료·예약·미예약 횟수 및 고객용 상태 링크"><table class="lp-table"><caption class="lp-sr-only">수강권 총 횟수, 강습완료, 예약·진행중과 미예약 잔여</caption><thead><tr><th scope="col">고객 · 강습생</th><th scope="col">강습센터</th><th scope="col">종목</th><th scope="col">총 횟수</th><th scope="col">강습완료</th><th scope="col">예약·진행중</th><th scope="col">미예약 잔여</th><th scope="col">담당 강사</th><th scope="col">발급일 · 메모</th><th scope="col">예약 · 고객 안내</th></tr></thead><tbody>${rows.map(rowHTML).join('')||`<tr><td colspan="10" class="lp-empty"><strong>${all.length?'조회 조건에 맞는 수강권이 없습니다.':'아직 발급한 수강권이 없습니다.'}</strong><p>${all.length?'고객명이나 종목을 바꾸어 조회해 주세요.':'날짜와 시간 없이 먼저 발급할 수 있습니다. 횟수는 자유 입력입니다.'}</p>${all.length?'':'<button type="button" class="btn secondary" data-pass-new>첫 수강권 발급</button>'}</td></tr>`}</tbody></table></div></section><p class="lp-footer-note">강습완료는 종료 인증이 확인된 횟수입니다. 확인 전 일정은 예약·진행중에 포함됩니다. 미예약 잔여는 아직 예약에 연결하지 않은 횟수입니다. 일정 등록 횟수는 강습 완료 횟수를 뜻하지 않습니다.</p>${renderIssue(settings,state,escape,preview)}</section>`;
}

function draftFromForm(form,previous={}){
  const values=new FormData(form);
  const linkage=Object.fromEntries(['paymentReviewId','paymentReviewVersion','paymentAllocationAmount','paymentDepositId','paymentCommitRequestId','customerId','teamId'].filter(key=>previous[key]!==undefined).map(key=>[key,previous[key]]));
  return {...linkage,id:previous?.id||null,customerName:text(values.get('customerName')),learnerName:text(values.get('learnerName')),phone:text(values.get('phone')),company:text(previous.company)&&normalizeBookingCompany(previous.company)===text(values.get('company'))?previous.company:text(values.get('company')),sport:text(values.get('sport')),totalSessions:values.get('totalSessions')===''?'':Number(values.get('totalSessions')),lessonRatio:text(values.get('lessonRatio')),participants:Array.isArray(previous.participants)?previous.participants:[],fixedInstructorId:text(values.get('fixedInstructorId')),notes:text(values.get('notes'))};
}
function validateDraft(draft){
  if(!draft.customerName)return '고객명을 입력해 주세요.';
  if(!draft.learnerName)return '강습생 이름·구분을 입력해 주세요.';
  if(draft.customerName.length>120||draft.learnerName.length>120)return '고객과 강습생 정보는 120자 이내로 입력해 주세요.';
  if(!draft.company||draft.company.length>120||/[\u0000-\u001f\u007f]/u.test(draft.company))return '강습센터를 선택해 주세요.';
  if(!['스키','보드'].includes(draft.sport))return '강습 종목을 선택해 주세요.';
  if(!Number.isInteger(draft.totalSessions)||draft.totalSessions<1||draft.totalSessions>100)return '총 강습 횟수를 1회부터 100회 사이의 정수로 입력해 주세요.';
  if(draft.lessonRatio&&!/^[0-9]{1,2}:[0-9]{1,2}$/.test(draft.lessonRatio))return '수강권 비율은 1:1, 1:2 형식으로 입력하거나 비워 주세요.';
  if(draft.phone.length>30||draft.notes.length>2000)return '연락처와 메모 길이를 확인해 주세요.';
  if(draft.phone&&!canonicalTelephone(draft.phone))return '전화번호 형식을 확인해 주세요. 예: 010-1234-5678';
  return '';
}

export function bindPasses(root,{state={},ui={},onChange,onCreate,onSchedule,onCustomerLink}={}){
  const view=root.querySelector('.pass-page');if(!view)return;
  const form=view.querySelector('.lp-issue-form');let linking=false;
  const busy=()=>linking||!!form?.dataset.saving;
  const lockButtons=()=>{const saved=[...new Set([...view.querySelectorAll('button'),...(form?[...form.querySelectorAll('button')]:[])])].map(button=>({button,disabled:button.disabled}));saved.forEach(({button})=>button.disabled=true);return ()=>saved.forEach(({button,disabled})=>button.disabled=disabled);};
  const linkStatus=(message,error=false)=>{const box=view.querySelector('[data-pass-action-status]');if(box&&view.isConnected!==false){box.textContent=message;box.hidden=!message;box.classList?.toggle('error',error);}};
  const update=changes=>{ui.passes={...configuration(ui),...changes};onChange?.(ui.passes);};
  view.querySelectorAll('[data-pass-new]').forEach(button=>button.onclick=()=>{if(!busy()&&!button.disabled)update({issuing:true,draft:newDraft(),error:''});});
  view.querySelector('[data-pass-reset]')?.addEventListener('click',()=>update({query:'',sport:'all'}));
  view.querySelector('.lp-filter-form')?.addEventListener('submit',event=>{event.preventDefault();const values=new FormData(event.currentTarget);update({query:text(values.get('query')),sport:text(values.get('sport'))||'all'});});
  view.querySelectorAll('[data-pass-schedule]').forEach(button=>button.onclick=()=>{if(!busy()&&!button.disabled)onSchedule?.(button.dataset.passSchedule);});
  view.querySelectorAll('[data-pass-customer-link]').forEach(button=>button.onclick=async()=>{
    if(busy()||button.disabled)return;
    if(typeof onCustomerLink!=='function'){linkStatus('고객용 상태 링크 연결을 확인해 주세요.',true);return;}
    linking=true;const restore=lockButtons();button.setAttribute?.('aria-busy','true');linkStatus('고객용 상태 링크를 준비하고 있습니다.');
    try{await onCustomerLink(button.dataset.passCustomerLink);linkStatus('');}
    catch(issue){linkStatus(issue?.message||'고객용 상태 링크를 준비하지 못했습니다. 다시 시도해 주세요.',true);}
    finally{linking=false;button.removeAttribute?.('aria-busy');restore();}
  });
  const close=()=>{
    if(busy())return;
    if(form){
      const draft=draftFromForm(form,configuration(ui).draft),empty=newDraft();
      ui.passes={...configuration(ui),draft};
      const edited=Object.keys(empty).some(key=>key!=='id'&&String(draft[key]??'')!==String(empty[key]??''));
      if(edited&&globalThis.confirm?.('작성 중인 수강권 정보가 있습니다. 저장하지 않고 닫을까요?')!==true)return;
    }
    update({issuing:false,draft:null,error:''});
  };
  view.querySelectorAll('[data-pass-close]').forEach(button=>button.onclick=close);
  view.querySelector('[data-pass-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget)close();});
  if(!form)return;
  const remember=()=>{ui.passes={...configuration(ui),draft:draftFromForm(form,configuration(ui).draft)};};
  const synchronizePresets=()=>{};
  for(const type of ['input','change'])form.addEventListener(type,()=>{remember();synchronizePresets();});

  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy())return;
    const draft=draftFromForm(form,configuration(ui).draft),error=validateDraft(draft),box=form.querySelector('.lp-form-error');remember();
    if(error){box.textContent=error;box.hidden=false;box.scrollIntoView({block:'nearest'});return;}
    if(typeof onCreate!=='function'){box.textContent='수강권 발급 연결을 확인해 주세요.';box.hidden=false;return;}
    // Preserve the identity across an uncertain network response or a retry.
    draft.id ||= crypto.randomUUID();ui.passes={...configuration(ui),draft};
    form.dataset.saving='1';box.hidden=true;
    const restoreButtons=lockButtons(),controls=[...form.querySelectorAll('input,select,textarea')];controls.forEach(control=>control.disabled=true);
    try{await onCreate({...draft,fixedInstructorId:draft.fixedInstructorId||null});update({issuing:false,draft:null,error:''});}
    catch(issue){if(form.isConnected){box.textContent=issue?.message||'수강권을 발급하지 못했습니다. 다시 시도해 주세요.';box.hidden=false;box.scrollIntoView({block:'nearest'});}}
    finally{delete form.dataset.saving;restoreButtons();controls.forEach(control=>control.disabled=false);}
  });
  view.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const drawer=view.querySelector('.lp-drawer'),controls=[...drawer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(control=>control.getClientRects().length);
    const firstControl=controls[0],lastControl=controls.at(-1);
    if(event.shiftKey&&document.activeElement===firstControl){event.preventDefault();lastControl?.focus();}
    else if(!event.shiftKey&&document.activeElement===lastControl){event.preventDefault();firstControl?.focus();}
  });
  if(!view.contains(document.activeElement))form.elements.customerName.focus({preventScroll:true});
}
