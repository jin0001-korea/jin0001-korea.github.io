import {renderBookingPaymentIntake} from './booking-view.mjs?v=75';
import {hydratePaymentIntake,syncPaymentIntake,paymentIntakeTeams,paymentIntakeTotals,updatePaymentIntakeSession,switchPaymentIntakeTeam} from './payment-intake-state.mjs?v=7';

const list=value=>Array.isArray(value)?value:[];
const applied=draft=>draft.paymentComparison?.appliedProposal||{};
const money=value=>Number.isSafeInteger(value)?`${value.toLocaleString('ko-KR')}원`:'미확인';
const integer=value=>/^\d+$/.test(String(value??'').trim())&&Number.isSafeInteger(Number(value))?Number(value):null;
export const sessionReviewFields=['date','startTime','lessonMinutes','breakMinutes','lessonFee','rentalFee','allocatedAmount','rentalPaymentStatus','rentalHours','rentalCustomAmount','patchEnabled','patchFee','patchPaymentStatus','sessionNotes'];

export function preparePaymentIntake(edit,registrationFields){
  if(!edit.draft.paymentComparison?.appliedProposal?.intakeVersion){
    edit.draft.paymentComparison??={version:1,status:'unmatched',candidates:[]};
    edit.draft.paymentComparison.appliedProposal??={};
    edit.draft.paymentComparison.appliedProposal.registrationFields={...registrationFields};
    edit.draft=hydratePaymentIntake(edit.draft);
  }else edit.draft=syncPaymentIntake(edit.draft);
  return edit.draft;
}
export function paymentManualDraft(draft,session=null){
  const a=applied(draft),r={...(a.registrationFields||{}),...(session||{})},d={...draft,...(session||{})};
  return {...r,paymentRequestCorrection:session?session.paymentRequestCorrection??undefined:r.paymentRequestCorrection,bookingType:a.bookingType,scheduleStatus:a.scheduleStatus,raw:{H:d.customerName,L:r.teamPhoneMode==='separate'?r.teamPhone||'':d.phone,E:d.company,Q:'계좌이체',I:d.teamName,D:d.sport,M:d.studentCount??'',K:r.relationship||'',J:r.lessonCount||'',O:r.ability||'',G:d.notes||'',A:d.date||'',B:d.startTime||'',T:d.lessonFee??'',Y:d.allocatedAmount??'',U:r.patchFee??'',R:r.patchPaymentStatus||'',P:r.sessionNotes||''},customerContactPhone:d.phone,customerId:d.customerId,customerTeamId:d.teamId,participants:list(a.participants),lessonMinutes:d.lessonMinutes,breakMinutes:d.breakMinutes,rentalAmount:d.rentalFee,rentalCustomAmount:typeof r.rentalCustomAmount==='boolean'?r.rentalCustomAmount:r.rentalPaymentStatus!=='free'&&Number.isSafeInteger(d.rentalFee),paymentReviewId:'review',paymentNeedsBreakConfirmation:d.lessonMinutes===240&&d.breakMinutes===null};
}

function calendarMarkup(u,draft,escape){
  if(!u.intakeCalendarOpen)return '';
  const current=String(u.intakeCalendarMonth||draft.date||new Date().toISOString().slice(0,10)).slice(0,7),[year,month]=current.split('-').map(Number);
  const first=new Date(Date.UTC(year,month-1,1)),start=new Date(first);start.setUTCDate(1-first.getUTCDay());
  const selected=list(u.intakeCalendarDates),days=Array.from({length:42},(_,index)=>{const day=new Date(start);day.setUTCDate(start.getUTCDate()+index);const date=day.toISOString().slice(0,10);return `<button type="button" data-pr-intake-date="${date}" aria-pressed="${selected.includes(date)}" class="${date.startsWith(current)?'':'is-other-month'} ${selected.includes(date)?'is-selected':''}">${day.getUTCDate()}</button>`;}).join('');
  return `<section class="pr-intake-calendar" aria-label="여러 강습일 선택"><div class="pr-intake-calendar-heading"><button type="button" class="btn ghost small" data-pr-calendar-month="-1" aria-label="이전 달">‹</button><strong>${escape(current)}</strong><button type="button" class="btn ghost small" data-pr-calendar-month="1" aria-label="다음 달">›</button></div><div class="pr-intake-calendar-grid">${['일','월','화','수','목','금','토'].map(day=>`<span>${day}</span>`).join('')}${days}</div><div class="pr-intake-card-actions"><button type="button" class="btn primary small" data-pr-add-dates ${selected.length?'':'disabled'}>선택한 ${selected.length}일 추가</button><button type="button" class="btn ghost small" data-pr-calendar-close>닫기</button></div><p class="bk-field-note">날짜순으로 추가합니다. 첫 회차의 시간·요금은 가져오고 입금 배분액은 0원으로 시작합니다.</p></section>`;
}

const scopedForms=new WeakMap();
/** A team-local form facade; unprefixed fallbacks may only read shared controls. */
export function scopedPaymentIntakeForm(form,card){
  if(!form||!card)return form;
  const cached=scopedForms.get(card);if(cached?.sourceForm===form)return cached;
  const prefix=card.dataset.prIntakePrefix||'',owner=node=>node?.closest?.('[data-pr-intake-team-id]');
  const members=value=>value?.tagName?[value]:Array.from(value||[]);
  const namedItem=name=>{
    const local=form.elements.namedItem(prefix+name);
    if(local&&members(local).every(node=>owner(node)===card))return local;
    const shared=form.elements.namedItem(name);
    return shared&&members(shared).every(node=>!owner(node))?shared:null;
  };
  const scoped={sourceForm:form,card,dataset:card.dataset,
    get elements(){const elements=this.querySelectorAll('input[name],select[name],textarea[name],button[name]');Object.defineProperty(elements,'namedItem',{value:namedItem});return elements;},
    querySelectorAll(selector){return Array.from(form.querySelectorAll(selector)).filter(node=>!owner(node)||owner(node)===card);},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  };
  scopedForms.set(card,scoped);return scoped;
}

function intakeTotalsMarkup(totals){return `<span>전체 ${totals.teamCount}팀 · ${totals.sessionCount}회차</span><span>요청금액 ${(totals.unknownRequestedAmounts??totals.unknownFees)?'일부 미확인':money(totals.requestedAmount)}</span><strong>이번 반영 입금액 ${money(totals.allocatedAmount)}</strong><span>미배분 잔액 ${money(totals.remainingAmount)}</span>`;}
export function syncPaymentIntakeTotals(root,edit){const target=root.querySelector?.('.pr-intake-totals');if(target)target.innerHTML=intakeTotalsMarkup(paymentIntakeTotals(edit.draft,edit.remainingAmount??edit.amount));}

export function renderPaymentIntake(edit,u,escape,{context={},locked=false}={}){
  const d=edit.draft,a=applied(d),teams=paymentIntakeTeams(d),active=teams.find(team=>team.id===a.activeTeamId)||teams[0],totals=paymentIntakeTotals(d,edit.remainingAmount??edit.amount),manual=paymentManualDraft(d),pass=a.bookingType==='pass'&&a.scheduleStatus==='undated';
  const common=renderBookingPaymentIntake(manual,escape,{section:'common',context}).replace('name="paymentSource"','name="paymentSource" disabled');
  return `<fieldset class="pr-intake-controls" ${locked?'disabled':''}>${common}<section class="bk-team-branches"><div class="bk-section-label"><span>02</span><h3>팀 정보·강습생</h3><small>고객 ${escape(d.customerName||edit.payerName||'미확인')} · ${teams.length}팀</small><button type="button" class="btn secondary small" data-pr-add-team ${pass||teams.length>=6?'disabled':''}>같은 고객 다른 팀 추가 →</button></div><div class="pr-intake-team-board is-expanded ${teams.length===1?'is-single-team':'is-multiple-teams'}">${teams.map((team,index)=>{
    const selected=team.id===active.id,prefix=selected?'':`team_${team.id}_`,teamDraft=switchPaymentIntakeTeam(d,team.id),registration=applied(teamDraft),teamManual=paymentManualDraft(teamDraft),teamPass=registration.bookingType==='pass'&&registration.scheduleStatus==='undated';
    const calendar=u.intakeCalendarOpen&&(u.intakeCalendarTeamId?u.intakeCalendarTeamId===team.id:selected)?calendarMarkup(u,teamDraft,escape):'';
    return `<article class="pr-intake-team-card ${selected?'is-active':''}" data-pr-intake-team-id="${escape(team.id)}" data-pr-intake-prefix="${escape(prefix)}"><header class="pr-intake-card-heading"><button type="button" class="btn ${selected?'primary':'secondary'} small" data-pr-select-team="${escape(team.id)}" aria-pressed="${selected}">${index+1}팀 · ${escape(team.draft.teamName||d.customerName||'기본팀')}</button>${teams.length>1?`<button type="button" class="btn ghost small" data-pr-remove-team="${escape(team.id)}" aria-label="${escape(team.draft.teamName||`${index+1}팀`)} 카드 삭제">×</button>`:''}</header>
      <div class="pr-intake-registration-type"><label class="field"><span class="field-label">등록 유형</span><select name="${escape(prefix)}reservationKind" data-pr-intake-field="reservationKind"><option value="" ${!registration.bookingType?'selected':''}>일정 확인 중</option><option value="lesson" ${registration.bookingType==='lesson'?'selected':''}>날짜가 정해진 예약</option><option value="pass" ${registration.bookingType==='pass'?'selected':''}>날짜 미정 수강권</option></select></label>${teamPass?`<label class="field"><span class="field-label">수강권 총 횟수</span><input name="${escape(prefix)}passTotalSessions" data-pr-intake-field="passTotalSessions" type="number" min="1" max="100" value="${escape((selected?edit.passCountInput:undefined)??registration.totalSessions??'')}" placeholder="미확인"></label>`:''}</div>
      ${renderBookingPaymentIntake(teamManual,escape,{section:'team',context,prefix})}
      <section class="pr-intake-sessions"><div class="bk-section-label"><span>03</span><h3>${teamPass?'수강권 금액':'강습 일정·금액'}</h3><small>${teamPass?'일정은 고객 신청 후 배정':`${team.sessions.length}회차 · 날짜순`}</small></div>
      ${teamPass?'<p class="bk-field-note">강습일이 미정인 수강권입니다. 입금일로 강습 날짜를 채우지 않습니다.</p>':`<div class="pr-intake-card-actions"><button type="button" class="btn secondary small" data-pr-calendar-toggle>달력에서 여러 날짜 선택</button><button type="button" class="btn secondary small" data-pr-copy-sessions="schedule" ${team.sessions.length<2?'disabled':''}>첫 회차 시간·휴식 같게 적용</button><button type="button" class="btn secondary small" data-pr-copy-sessions="financial" ${team.sessions.length<2?'disabled':''}>첫 회차 강습료·장비요금 같게 적용</button></div>${calendar}`}
      <div class="pr-intake-session-board ${team.sessions.length>1?'has-multiple-sessions':''}">${team.sessions.map((session,i)=>`<article class="pr-intake-session-card" data-pr-intake-session-id="${escape(session.id)}"><header class="pr-intake-card-heading"><strong>${teamPass?'수강권':`${i+1}회차`} · ${escape(session.date||'날짜 미정')} ${escape(session.startTime||'')}</strong>${team.sessions.length>1?`<button type="button" class="btn ghost small" data-pr-remove-session="${escape(session.id)}" aria-label="${i+1}회차 삭제">×</button>`:''}</header>${renderBookingPaymentIntake(paymentManualDraft(teamDraft,session),escape,{section:'session',context,prefix:prefix+(i?`session_${session.id}_`:'')})}</article>`).join('')}</div></section>
    </article>`;
  }).join('')}</div></section><div class="pr-intake-totals" aria-live="polite">${intakeTotalsMarkup(totals)}</div></fieldset>`;
}

/** Capture every displayed session before sorting/replacing cards. The first card uses legacy names. */
export function capturePaymentIntakeSessions(form,edit){
  const a=applied(edit.draft);if(a.intakeVersion!==1)return;
  const team=list(a.reviewedTeams).find(row=>row.id===a.activeTeamId);if(!team)return;
  const patches=team.sessions.map((row,index)=>{const prefix=index?`session_${row.id}_`:'',patch={};
    for(const key of sessionReviewFields){const name=key==='rentalFee'?'rentalAmount':key,input=form.elements.namedItem(prefix+name);if(!input)continue;
      patch[key]=['rentalCustomAmount','patchEnabled'].includes(key)?input.checked===true:['date','startTime','rentalPaymentStatus','patchPaymentStatus','sessionNotes'].includes(key)?String(input.value||''):integer(input.value);
    }
    const control=form.elements.namedItem(prefix+'paymentCorrectionEnabled');
    if(control){
      const old=row.paymentRequestCorrection;
      patch.paymentRequestCorrection=control.checked?{requestId:old?.requestId||crypto.randomUUID(),expectedVersion:old?.expectedVersion??0,correctedRequestedAmount:integer(form.elements.namedItem(prefix+'paymentCorrectionAmount')?.value),reason:String(form.elements.namedItem(prefix+'paymentCorrectionReason')?.value||'')}:null;
    }
    return {id:row.id,patch};
  });
  edit.draft=syncPaymentIntake(edit.draft);
  for(const {id,patch} of patches)if(Object.keys(patch).length)edit.draft=updatePaymentIntakeSession(edit.draft,id,patch);
}
