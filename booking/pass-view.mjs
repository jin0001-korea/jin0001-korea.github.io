import {bookingCompanyOptions,normalizeBookingCompany} from './company-options.mjs?v=31';
import {canonicalTelephone} from './customer-teams.mjs?v=27';

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
const newDraft=()=>({id:null,customerName:'',learnerName:'',phone:'',company:'',sport:'스키',totalSessions:'',lessonMinutes:'',studentCount:'',lessonRatio:'',participants:[],fixedInstructorId:'',notes:''});
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
      // 디렉터리 연결 수강권은 최신 고객·팀 이름을 표시·검색에 쓴다(발급 스냅샷은 폴백, 2026-11-20).
      customerName:(()=>{const linkedCustomer=list(context.customers).find(row=>row?.id===(pass.customer_id??pass.customerId));return text(linkedCustomer?.name)||text(first(pass,'customer_name','customerName'));})(),
      learnerName:(()=>{const linkedTeam=list(context.customerTeams).find(row=>row?.id===(pass.customer_team_id??pass.customerTeamId));const teamName=linkedTeam?text(linkedTeam.name):'';return teamName||text(first(pass,'learner_name','learnerName'));})(),
      phone:text(pass.phone),company:text(pass.company),sport:text(pass.sport),fixedInstructorId,
      lessonMinutes:integer(first(pass,'lesson_minutes','lessonMinutes')),updatedAt:text(first(pass,'updated_at','updatedAt')),
      instructorName:fixedInstructorId?(person?.display_name||'담당 계정 확인 필요'):'강사 미정',
      status:pass.status||'active',overbooked:total!==null&&scheduled>total};
  });
}

function configuration(ui={}){
  const current=ui.passes||{};
  return {query:'',sport:'all',issuing:false,draft:null,error:'',deleteRequest:null,editRequest:null,bulkSelected:[],bulkNotice:'',...current};
}
// 발급 취소(삭제) 확인 상태. 서버가 연결 기록을 재검증하므로 여기 요약은 안내용이다.
export function passDeletionPayload(pass){
  return {id:text(pass?.id),expectedUpdatedAt:text(first(pass||{},'updated_at','updatedAt')),requestId:globalThis.crypto.randomUUID(),reason:''};
}
export function passDeletionBlockers(pass,context={}){
  const id=text(pass?.id);if(!id)return [];
  const linked=[...list(context.reservations),...list(context.schedules)].filter(row=>passIdOf(row)===id);
  const active=new Map(linked.filter(row=>!cancelled(row)).map(row=>[reservationIdOf(row)||Math.random(),row])).size;
  const removed=new Map(linked.filter(row=>cancelled(row)).map(row=>[reservationIdOf(row)||Math.random(),row])).size;
  const blockers=[];
  if(active+removed>0)blockers.push(`연결된 예약 ${active+removed}건${removed?` (삭제된 예약 ${removed}건 포함)`:''} — 예약이 수강권 사용 기록을 보존해 삭제할 수 없습니다.`);
  return blockers;
}
function renderDeleteConfirm(settings,context,escape){
  const request=settings.deleteRequest;if(!request)return '';
  const pass=selectPassBalances(context).find(row=>row.id===request.id);
  if(!pass)return '';
  const blockers=passDeletionBlockers(pass,context);
  return `<div class="lp-delete-layer" data-pass-delete-backdrop><section class="lp-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="lp-delete-title"><h3 id="lp-delete-title">이 수강권을 삭제할까요?</h3><dl><div><dt>고객 · 강습생</dt><dd data-pass-delete-customer>${escape(pass.customerName||'고객 확인')} · ${escape(pass.learnerName||'강습생 확인')}</dd></div><div><dt>종목 · 총 횟수</dt><dd>${escape(pass.sport||'종목')} · ${pass.total===null?'—':`${pass.total}회`}</dd></div><div><dt>발급일</dt><dd>${escape(dateLabel(pass.created_at||pass.createdAt))}</dd></div></dl>${blockers.length?`<p class="lp-delete-blocked" role="alert">${blockers.map(escape).join('<br>')}</p>`:'<p class="lp-delete-note">예약·입금 배분·고객 일정 신청이 연결되지 않은 수강권만 삭제됩니다. 삭제하면 되돌릴 수 없습니다.</p>'}<label class="field"><span class="field-label">삭제 사유 <small>선택 · 기록용</small></span><textarea data-pass-delete-reason maxlength="1000" rows="2" placeholder="예: 잘못 발급">${escape(request.reason||'')}</textarea></label><p class="lp-form-error" data-pass-delete-error role="alert" ${request.error?'':'hidden'}>${escape(request.error||'')}</p><footer><button type="button" class="btn secondary" data-pass-delete-cancel>수강권 유지</button><button type="button" class="btn primary lp-danger" data-pass-delete-confirm ${blockers.length?'disabled':''}>이 수강권 삭제</button></footer></section></div>`;
}
const options=(values,selected,escape)=>values.map(([value,label])=>`<option value="${escape(value)}" ${String(value)===String(selected)?'selected':''}>${escape(label)}</option>`).join('');

// 수강권 변경 창(2026-11-20/21 사용자 지시): 시간권·종목과 금액(메모 표준 줄)을 바꾼다.
// 고객·횟수·고정 강사는 서버 트리거가 불변 보장 — 잘못 발급이면 삭제 후 재발급.
const noteAmount=(notes,prefix)=>{const line=String(notes||'').split('\n').map(row=>row.trim()).find(row=>row.startsWith(prefix));const match=line&&/([0-9][0-9,]*)\s*원/.exec(line);return match?Number(match[1].replace(/,/g,'')):null;};
// 금액 표준 줄 재계산: 회당 강습료·받은 금액을 받아 받아야 할(=(강습료+장비결제완료)×총횟수)·미수금을 다시 쓴다.
export function rebuildPassMoneyNotes(pass,fee,received){
  const lines=String(pass?.notes||'').split('\n');
  const isMoney=row=>{const t=row.trim();return t.startsWith('회당 강습료:')||t.startsWith('받아야 할 금액:')||t.startsWith('받은 금액')||t.startsWith('미수금');};
  const kept=lines.filter(row=>!isMoney(row));
  const trimmed=kept.map(row=>row.trim());
  const rentalLine=trimmed.find(row=>row.startsWith('장비:'))||'';
  const rentalMatch=/([0-9][0-9,]*)\s*원/.exec(rentalLine);
  const rentalPer=rentalLine.includes('결제완료')&&rentalMatch?Number(rentalMatch[1].replace(/,/g,'')):0;
  const total=Number.isInteger(pass?.total)?pass.total:Number.isInteger(pass?.total_sessions)?pass.total_sessions:null;
  const won=value=>Number(value).toLocaleString('ko-KR');
  const expected=fee!==null&&Number.isInteger(total)?(fee+rentalPer)*total:null;
  const feeLine=fee!==null?`회당 강습료: ${won(fee)}원`:null;
  const afterLines=[
    expected!==null?`받아야 할 금액: ${won(expected)}원 (총액)`:null,
    received!==null?`받은 금액: ${won(received)}원`:null,
    expected!==null&&received!==null&&expected-received>0?`미수금: ${won(expected-received)}원`:null,
  ].filter(Boolean);
  const feeAt=(()=>{const i=trimmed.findIndex(row=>row.startsWith('회당 강습시간:'));if(i>=0)return i+1;const j=trimmed.findIndex(row=>row.startsWith('총 횟수:'));return j>=0?j+1:0;})();
  let next=feeLine?[...kept.slice(0,feeAt),feeLine,...kept.slice(feeAt)]:[...kept];
  const rentalAt=next.findIndex(row=>row.trim().startsWith('장비:'));
  const insertAt=rentalAt>=0?rentalAt+1:(feeLine?feeAt+1:feeAt);
  next=[...next.slice(0,insertAt),...afterLines,...next.slice(insertAt)];
  return next.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+|\n+$/g,'').slice(0,2000);
}
// 메모에서 금액 표준 줄을 뺀 나머지(변경 창 메모 편집용 — 금액 줄은 입력칸에서 재계산).
export function passMoneyFreeNotes(notes){
  return String(notes||'').split('\n').filter(row=>{const t=row.trim();return !(t.startsWith('회당 강습료:')||t.startsWith('받아야 할 금액:')||t.startsWith('받은 금액')||t.startsWith('미수금'));}).join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+|\n+$/g,'');
}
function renderEditConfirm(settings,context,escape){
  const request=settings.editRequest;if(!request)return '';
  const pass=selectPassBalances(context).find(row=>row.id===request.id);
  if(!pass)return '';
  const fee=request.fee??noteAmount(pass.notes,'회당 강습료:');
  const received=request.received??noteAmount(pass.notes,'받은 금액');
  const memo=request.memo??passMoneyFreeNotes(pass.notes);
  const ratioMatch=/^1:(\d{1,2})$/.exec(String(pass.lessonRatio??pass.lesson_ratio??'').trim());
  const studentCount=request.studentCount??(ratioMatch?Number(ratioMatch[1]):'');
  // 입력 보존(2026-11-22): 백그라운드 동기화 재렌더가 입력 중인 금액·인원을 메모의 원래 값으로 되돌리던 문제 —
  // bindPasses 의 input 리스너가 editRequest 에 담아 두는 원문(…Text)을 우선 사용한다.
  const feeValue=request.feeText!==undefined?request.feeText:(fee??'');
  const receivedValue=request.receivedText!==undefined?request.receivedText:(received??'');
  const countValue=request.studentCountText!==undefined?request.studentCountText:(studentCount??'');
  const companies=bookingCompanyOptions([...list(context.lessonPasses).map(row=>text(row.company)),...list(context.reservations).map(row=>text(row.company||row.raw?.E)),pass.company]);
  const instructors=list(context.roster).filter(person=>person.role==='instructor'&&person.active);
  const instructorLocked=!!pass.fixedInstructorId;
  return `<div class="lp-delete-layer" data-pass-edit-backdrop><section class="lp-delete-confirm lp-edit-wide" role="dialog" aria-modal="true" aria-labelledby="lp-edit-title"><h3 id="lp-edit-title">수강권 변경</h3><dl><div><dt>고객 · 강습생</dt><dd>${escape(pass.customerName||'고객 확인')} · ${escape(pass.learnerName||'강습생 확인')}</dd></div><div><dt>총 횟수 · 발급일</dt><dd>${pass.total===null?'—':`${pass.total}회`} · ${escape(dateLabel(pass.created_at||pass.createdAt))}</dd></div></dl><div class="lp-edit-grid"><label class="field"><span class="field-label">시간권</span><select data-pass-edit-minutes ${request.saving?'disabled':''}>${options([['120','2시간권'],['240','4시간권']],String(request.lessonMinutes||pass.lessonMinutes||120),escape)}</select></label><label class="field"><span class="field-label">종목</span><select data-pass-edit-sport ${request.saving?'disabled':''}>${options([['스키','스키'],['보드','보드']],String(request.sport||pass.sport||'스키'),escape)}</select></label><label class="field"><span class="field-label">강습센터</span><select data-pass-edit-company ${request.saving?'disabled':''}>${options(companies.map(company=>[company,company]),normalizeBookingCompany(request.company??pass.company)||'',escape)}</select></label><label class="field"><span class="field-label">강습 인원 <small>비율 1:N 자동</small></span><span class="lp-number-input"><input data-pass-edit-count type="number" min="1" max="20" step="1" inputmode="numeric" value="${escape(countValue)}" placeholder="명" ${request.saving?'disabled':''}><span>명</span></span></label><label class="field"><span class="field-label">담당 강사${instructorLocked?' <small>지정 후 변경 불가</small>':' <small>미정 → 지정만 가능</small>'}</span><select data-pass-edit-instructor ${request.saving||instructorLocked?'disabled':''}>${options([['','강사 미정'],...instructors.map(person=>[person.user_id,person.display_name])],String(request.fixedInstructorId??pass.fixedInstructorId??''),escape)}</select></label><label class="field"><span class="field-label">회당 강습료 <small>받아야 할 금액 자동 재계산</small></span><span class="lp-number-input"><input data-pass-edit-fee type="number" min="0" step="1" inputmode="numeric" value="${escape(feeValue)}" placeholder="메모에 기록" ${request.saving?'disabled':''}><span>원</span></span></label><label class="field"><span class="field-label">받은 금액</span><span class="lp-number-input"><input data-pass-edit-received type="number" min="0" step="1" inputmode="numeric" value="${escape(receivedValue)}" placeholder="메모에 기록" ${request.saving?'disabled':''}><span>원</span></span></label></div><label class="field"><span class="field-label">메모 <small>경험·수준·장비·요청사항 — 금액 줄은 위 입력으로 자동 관리</small></span><textarea data-pass-edit-memo rows="5" maxlength="1800" ${request.saving?'disabled':''}>${escape(memo)}</textarea></label><p class="lp-delete-note">고객명·강습생(팀)명·총 횟수는 변경할 수 없습니다(잘못 발급이면 삭제 후 재발급). 장비 금액은 메모의 '장비:' 줄을 고치면 받아야 할 금액에 자동 반영됩니다. 연락처는 고객·팀 탭에서 수정하세요.</p><p class="lp-form-error" data-pass-edit-error role="alert" ${request.error?'':'hidden'}>${escape(request.error||'')}</p><footer><button type="button" class="btn ghost lp-danger" data-pass-edit-delete ${request.saving?'disabled':''}>이 수강권 삭제</button><button type="button" class="btn secondary" data-pass-edit-cancel ${request.saving?'disabled':''}>닫기</button><button type="button" class="btn primary" data-pass-edit-confirm ${request.saving?'disabled':''}>${request.saving?'저장 중…':'변경 저장'}</button></footer></section></div>`;
}

function renderIssue(settings,context,escape,preview){
  if(!settings.issuing)return '';
  const draft={...newDraft(),...(settings.draft||{})};
  // 인원 기본값: 명시값 → 기존 비율(1:N)의 N → 참가자 수. 비율은 인원으로 자동 산정된다(⑥).
  const ratioMatch=/^1:(\d{1,2})$/.exec(text(draft.lessonRatio||''));
  const studentCountDefault=Number.isInteger(draft.studentCount)&&draft.studentCount>=1&&draft.studentCount<=20?draft.studentCount:ratioMatch&&Number(ratioMatch[1])>=1&&Number(ratioMatch[1])<=20?Number(ratioMatch[1]):(Array.isArray(draft.participants)&&draft.participants.length?Math.min(draft.participants.length,20):'');
  const people=list(context.roster).filter(person=>person.role==='instructor'&&person.active);
  const companies=bookingCompanyOptions([...list(context.reservations).map(row=>text(row.company||row.raw?.E)),...list(context.lessonPasses).map(row=>text(row.company)),draft.company]);
  return `<div class="lp-overlay" data-pass-backdrop><aside class="lp-drawer" role="dialog" aria-modal="true" aria-labelledby="lesson-pass-issue-title"><header><div><span class="lp-eyebrow">LESSON PASS${preview?' · 체험':''}</span><h2 id="lesson-pass-issue-title">수강권 발급</h2><p>날짜와 시간을 정하지 않고 먼저 등록합니다.</p></div><button type="button" class="icon-btn" data-pass-close aria-label="수강권 발급 닫기">×</button></header><form class="lp-issue-form" novalidate><div class="lp-drawer-body"><div class="lp-form-error" role="alert" ${settings.error?'':'hidden'}>${escape(settings.error)}</div><div class="lp-form-grid"><label class="field"><span class="field-label">고객명 · 입금자 <b>*</b></span><input name="customerName" value="${escape(draft.customerName)}" required maxlength="120" autocomplete="off"></label><label class="field"><span class="field-label">강습생 이름·구분 <b>*</b></span><input name="learnerName" value="${escape(draft.learnerName)}" required maxlength="120" autocomplete="off"></label><label class="field"><span class="field-label">연락처</span><input name="phone" type="tel" value="${escape(draft.phone)}" maxlength="30" autocomplete="off"></label><label class="field"><span class="field-label">강습센터 <b>*</b></span><select name="company" required>${options([['','센터를 선택해 주세요'],...companies.map(company=>[company,company])],normalizeBookingCompany(draft.company),escape)}</select></label><label class="field"><span class="field-label">종목 <b>*</b></span><select name="sport">${options([['','종목을 선택해 주세요'],['스키','스키'],['보드','보드']],draft.sport,escape)}</select></label><label class="field"><span class="field-label">강습 인원 <b>*</b> <small>비율 자동 산정 · 1명=1:1, 2명=1:2</small></span><span class="lp-number-input"><input name="studentCount" type="number" min="1" max="20" step="1" value="${escape(studentCountDefault)}" required><span>명</span></span></label></div>${Array.isArray(draft.participants)&&draft.participants.length?`<div class="lp-participants"><span class="field-label">참가자 ${draft.participants.length}명 <small>예약 등록창의 개인 명부 선택이 그대로 담깁니다</small></span><div class="bk-team-chips">${draft.participants.map(person=>`<span class="bk-person-chip">${person.type==='minor'?`미성년${Number.isInteger(person.age)?` ${person.age}세`:''}`:'성인'}</span>`).join('')}</div></div>`:''}${draft.paymentReviewId?`<p class="lp-count-note" data-pass-payment-summary>검토한 입금 <strong>${escape(Number(draft.paymentAllocationAmount).toLocaleString('ko-KR'))}원</strong>을 이 수강권에 연결합니다. 날짜·시간은 나중에 신청하며, 총 횟수는 상담 원문과 대조해 입력하세요.</p>`:''}<label class="field"><span class="field-label">몇 시간권 <b>*</b></span><select name="lessonMinutes" required>${options([['','2시간·4시간 선택'],['120','2시간권'],['240','4시간권']],String(draft.lessonMinutes||''),escape)}</select><span class="field-help">고객 일정 신청 화면에서 이 시간으로 고정됩니다.</span></label><label class="field"><span class="field-label">총 강습 횟수 <b>*</b></span><span class="lp-number-input"><input name="totalSessions" type="number" min="1" max="100" step="1" value="${escape(draft.totalSessions)}" required><span>회</span></span></label><label class="field"><span class="field-label">담당 강사</span><select name="fixedInstructorId">${options([['','강사 미정'],...people.map(person=>[person.user_id,person.display_name])],draft.fixedInstructorId,escape)}</select><span class="field-help">강사 미정으로 발급할 수 있습니다. 첫 강습의 담당이 정해지면 이후 회차에도 같은 강사를 유지합니다.</span></label><label class="field"><span class="field-label">메모</span><textarea name="notes" maxlength="2000" rows="4" placeholder="상담 내용이나 요청사항을 남겨 주세요.">${escape(draft.notes)}</textarea></label><p class="lp-count-note">예약 1건을 연결하면 1회가 일정 등록됩니다. 강습시간과 별도로 셉니다.</p></div><footer><span>${preview?'체험 수강권 · 서버에 저장되지 않습니다.':'확인 후 수강권을 등록합니다.'}</span><div><button type="button" class="btn secondary" data-pass-close>닫기</button><button type="submit" class="btn primary">수강권 발급</button></div></footer></form></aside></div>`;
}

/** 고객·팀 탭 등 수강권 목록이 없는 뷰에서 변경·삭제 창만 띄운다(2026-11-20). ui.passes 상태 공유. */
export function renderPassDialogs({state={},ui={},escapeHTML=escapeFallback}={}){
  const settings=configuration(ui);
  if(settings.issuing||(!settings.editRequest&&!settings.deleteRequest))return '';
  return `<section class="pass-page lp-pass-dialogs">${renderEditConfirm(settings,state,escapeHTML)}${renderDeleteConfirm(settings,state,escapeHTML)}</section>`;
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
  // 시간권(2시간/4시간) 열(2026-11-20 사용자 지시) — 수정은 행의 [변경] 버튼 → 변경 창에서.
  const minutesCell=pass=>`<td data-pass-minutes>${pass.lessonMinutes===240?'4시간':pass.lessonMinutes===120?'2시간':'—'}</td>`;
  // 그룹 수정(2026-11-20 사용자 지시): 예약표처럼 행 맨 왼쪽 체크 → 묶어서 시간권 변경·삭제.
  const bulkSelected=list(settings.bulkSelected).filter(id=>rows.some(row=>row.id===id));
  const bulkCell=pass=>`<td class="lp-bulk-cell"><input type="checkbox" data-pass-bulk="${escape(pass.id)}" ${bulkSelected.includes(pass.id)?'checked':''} aria-label="${escape(pass.customerName||'고객')} · ${escape(pass.learnerName||'기본팀')} 선택"></td>`;
  const rowHTML=pass=>`<tr data-pass-row="${escape(pass.id)}">${bulkCell(pass)}<th scope="row"><strong>${escape(pass.customerName||'고객 확인 필요')}</strong><span>${escape(pass.learnerName||'강습생 확인 필요')}</span>${pass.phone?`<small>${escape(pass.phone)}</small>`:''}</th><td data-pass-company>${escape(normalizeBookingCompany(pass.company)||'센터 미등록')}</td><td><span class="lp-sport ${pass.sport==='보드'?'board':''}">${escape(pass.sport||'종목 확인')}</span></td>${minutesCell(pass)}<td data-pass-total>${pass.total===null?'—':`${pass.total}회`}</td><td data-pass-completed class="lp-completed">${pass.completed}회${!preview&&!pass.completionVerified?'<small class="lp-count-unverified">집계 확인 필요</small>':''}</td><td data-pass-pending data-pass-scheduled="${pass.scheduled}">${pass.pending}회<small>일정 등록 ${pass.scheduled}회 중</small></td><td data-pass-available class="lp-available ${pass.available===0?'used':''}">${pass.available===null?'—':`${pass.available}회`}${pass.scheduled===0?'<small>전체 날짜 미정</small>':''}${pass.overbooked?'<small class="lp-overbooked">연결 내역 확인 필요</small>':''}</td><td><strong>${escape(pass.instructorName)}</strong><small>${pass.fixedInstructorId?'전 회차 동일 강사':'첫 강습 배정 시 담당 확정'}</small></td><td class="lp-note-cell"><span>${escape(dateLabel(pass.created_at||pass.createdAt))}</span>${pass.notes?`<small>${escape(pass.notes)}</small>`:''}</td><td class="lp-actions-cell"><div class="lp-pass-actions"><button type="button" class="btn secondary small" data-pass-schedule="${escape(pass.id)}" ${!pass.id||pass.available===null||pass.available<1||pass.status!=='active'?'disabled':''}>일정 등록 →</button><button type="button" class="btn ghost small" data-pass-edit="${escape(pass.id)}" aria-label="${escape(pass.customerName)} · ${escape(pass.learnerName||'기본팀')} 수강권 변경" ${pass.id?'':'disabled'}>변경</button><button type="button" class="btn ghost small lp-customer-link" data-pass-customer-link="${escape(pass.id)}" aria-label="${escape(pass.customerName)} · ${escape(pass.learnerName||'기본팀')} 고객용 상태 링크" ${pass.id?'':'disabled'}>고객용 상태 링크</button></div></td></tr>`;
  return `<section class="pass-page" aria-label="수강권 관리"><div class="lp-heading"><div><span class="lp-eyebrow">LESSON PASSES</span><h1>수강권</h1><p>날짜 미정 수강권부터 강습 완료까지, 횟수와 고객용 상태 링크를 관리하세요.</p></div><button type="button" class="btn primary" data-pass-new>${icon('plus')}수강권 발급</button></div><div class="lp-mode-note"><span class="lp-mode ${preview?'preview':'operational'}">${preview?'체험 수강권':'운영 수강권'}</span><span>${preview?'가상 데이터로 발급과 일정 연결을 체험합니다.':'발급한 수강권과 연결된 예약의 진행 상태를 확인합니다.'}</span></div><div class="lp-summary">${stats.map(([label,value,note,style])=>`<article class="${style}"><span>${label}</span><strong>${value}<small>회</small></strong><p>${note}</p></article>`).join('')}</div><section class="panel lp-filter-panel"><form class="lp-filter-form"><label><span>고객·강습생 검색</span><input name="query" type="search" value="${escape(settings.query)}" placeholder="고객명 · 강습생 · 연락처"></label><label><span>종목</span><select name="sport">${options([['all','전체 종목'],['스키','스키'],['보드','보드']],settings.sport,escape)}</select></label><button type="submit" class="btn secondary">조회</button><button type="button" class="btn ghost" data-pass-reset>초기화</button></form></section><p class="lp-action-status" data-pass-action-status role="status" aria-live="polite" ${settings.bulkNotice?'':'hidden'}>${escape(settings.bulkNotice||'')}</p>${bulkSelected.length?`<section class="panel lp-bulk-bar" data-pass-bulk-bar><strong>선택 ${bulkSelected.length}개</strong><label class="lp-bulk-field">시간권 <select data-pass-bulk-minutes>${options([['','유지'],['120','2시간'],['240','4시간']],'',escape)}</select></label><label class="lp-bulk-field">종목 <select data-pass-bulk-sport>${options([['','유지'],['스키','스키'],['보드','보드']],'',escape)}</select></label><button type="button" class="btn secondary small" data-pass-bulk-apply>선택 변경</button><button type="button" class="btn ghost small lp-danger" data-pass-bulk-delete>선택 삭제</button><button type="button" class="btn ghost small" data-pass-bulk-clear>선택 해제</button><span class="lp-bulk-help">예약·입금이 연결된 수강권은 삭제되지 않습니다.</span></section>`:''}<section class="panel lp-table-panel"><div class="lp-table-heading"><div><h2>발급 수강권 <span>${rows.length}개</span></h2><p>총 횟수 = 강습완료 + 예약·진행중 + 미예약 잔여입니다. 고객용 링크에서도 같은 상태를 확인합니다.</p></div></div><div class="lp-table-scroll" tabindex="0" role="region" aria-label="수강권별 완료·예약·미예약 횟수 및 고객용 상태 링크"><table class="lp-table"><caption class="lp-sr-only">수강권 총 횟수, 강습완료, 예약·진행중과 미예약 잔여</caption><thead><tr><th scope="col" class="lp-bulk-cell" title="그룹 변경·삭제 선택"><input type="checkbox" data-pass-bulk-all aria-label="표시된 수강권 전체 선택" ${rows.length&&rows.every(row=>bulkSelected.includes(row.id))?'checked':''}></th><th scope="col">고객 · 강습생</th><th scope="col">강습센터</th><th scope="col">종목</th><th scope="col">시간권</th><th scope="col">총 횟수</th><th scope="col">강습완료</th><th scope="col">예약·진행중</th><th scope="col">미예약 잔여</th><th scope="col">담당 강사</th><th scope="col">발급일 · 메모</th><th scope="col">예약 · 고객 안내</th></tr></thead><tbody>${rows.map(rowHTML).join('')||`<tr><td colspan="12" class="lp-empty"><strong>${all.length?'조회 조건에 맞는 수강권이 없습니다.':'아직 발급한 수강권이 없습니다.'}</strong><p>${all.length?'고객명이나 종목을 바꾸어 조회해 주세요.':'날짜와 시간 없이 먼저 발급할 수 있습니다. 횟수는 자유 입력입니다.'}</p>${all.length?'':'<button type="button" class="btn secondary" data-pass-new>첫 수강권 발급</button>'}</td></tr>`}</tbody></table></div></section><p class="lp-footer-note">강습완료는 종료 인증이 확인된 횟수입니다. 확인 전 일정은 예약·진행중에 포함됩니다. 미예약 잔여는 아직 예약에 연결하지 않은 횟수입니다. 일정 등록 횟수는 강습 완료 횟수를 뜻하지 않습니다.</p>${renderIssue(settings,state,escape,preview)}${renderDeleteConfirm(settings,state,escape)}${renderEditConfirm(settings,state,escape)}</section>`;
}

function draftFromForm(form,previous={}){
  const values=new FormData(form);
  const linkage=Object.fromEntries(['paymentReviewId','paymentReviewVersion','paymentAllocationAmount','paymentDepositId','paymentCommitRequestId','customerId','teamId','customerDraft','teamDraft'].filter(key=>previous[key]!==undefined).map(key=>[key,previous[key]]));
  // 아직 저장 전인 새 고객·팀 draft 는 폼에서 고친 이름·연락처를 따라간다(2026-11-20) —
  // 서버의 '선택한 고객과 수강권 고객명이 다릅니다' 불일치 차단을 막는다.
  const formCustomerName=text(values.get('customerName')),formLearnerName=text(values.get('learnerName')),formPhone=text(values.get('phone'));
  if(linkage.customerDraft)linkage.customerDraft={...linkage.customerDraft,name:formCustomerName,contacts:formPhone?[{label:'고객 연락처',phone:formPhone}]:(linkage.customerDraft.contacts||[])};
  if(linkage.teamDraft)linkage.teamDraft={...linkage.teamDraft,name:formLearnerName};
  return {...linkage,id:previous?.id||null,customerName:text(values.get('customerName')),learnerName:text(values.get('learnerName')),phone:text(values.get('phone')),company:text(previous.company)&&normalizeBookingCompany(previous.company)===text(values.get('company'))?previous.company:text(values.get('company')),sport:text(values.get('sport')),totalSessions:values.get('totalSessions')===''?'':Number(values.get('totalSessions')),lessonMinutes:values.get('lessonMinutes')?Number(values.get('lessonMinutes')):'',studentCount:values.get('studentCount')===''||values.get('studentCount')===null?'':Number(values.get('studentCount')),lessonRatio:(()=>{const n=Number(values.get('studentCount'));return Number.isInteger(n)&&n>=1&&n<=20?`1:${n}`:'';})(),participants:Array.isArray(previous.participants)?previous.participants:[],fixedInstructorId:text(values.get('fixedInstructorId')),notes:text(values.get('notes'))};
}
function validateDraft(draft){
  if(!draft.customerName)return '고객명을 입력해 주세요.';
  if(!draft.learnerName)return '강습생 이름·구분을 입력해 주세요.';
  if(draft.customerName.length>120||draft.learnerName.length>120)return '고객과 강습생 정보는 120자 이내로 입력해 주세요.';
  if(!draft.company||draft.company.length>120||/[\u0000-\u001f\u007f]/u.test(draft.company))return '강습센터를 선택해 주세요.';
  if(!['스키','보드'].includes(draft.sport))return '강습 종목을 선택해 주세요.';
  if(![120,240].includes(draft.lessonMinutes))return '몇 시간권인지(2시간·4시간) 선택해 주세요.';
  if(!Number.isInteger(draft.studentCount)||draft.studentCount<1||draft.studentCount>20)return '강습 인원을 1명부터 20명까지 입력해 주세요. 비율(1:N)은 자동 산정됩니다.';
  if(!Number.isInteger(draft.totalSessions)||draft.totalSessions<1||draft.totalSessions>100)return '총 강습 횟수를 1회부터 100회 사이의 정수로 입력해 주세요.';
  if(draft.phone.length>30||draft.notes.length>2000)return '연락처와 메모 길이를 확인해 주세요.';
  if(draft.phone&&!canonicalTelephone(draft.phone))return '전화번호 형식을 확인해 주세요. 예: 010-1234-5678';
  return '';
}

export function bindPasses(root,{state={},ui={},onChange,onCreate,onIssueInline,onSchedule,onCustomerLink,onDelete,onUpdate,onEdit}={}){
  const view=root.querySelector('.pass-page');if(!view)return;
  const form=view.querySelector('.lp-issue-form');let linking=false;let deleting=false;
  const busy=()=>linking||deleting||!!form?.dataset.saving;
  const lockButtons=()=>{const saved=[...new Set([...view.querySelectorAll('button'),...(form?[...form.querySelectorAll('button')]:[])])].map(button=>({button,disabled:button.disabled}));saved.forEach(({button})=>button.disabled=true);return ()=>saved.forEach(({button,disabled})=>button.disabled=disabled);};
  const linkStatus=(message,error=false)=>{const box=view.querySelector('[data-pass-action-status]');if(box&&view.isConnected!==false){box.textContent=message;box.hidden=!message;box.classList?.toggle('error',error);}};
  const update=changes=>{ui.passes={...configuration(ui),...changes};onChange?.(ui.passes);};
  view.querySelectorAll('[data-pass-new]').forEach(button=>button.onclick=()=>{
  if(busy()||button.disabled)return;
  // 2026-11-17(사용자 확정): 수강권 신규 발급은 별도 발급 모달 대신 예약접수의
  // [날짜 미정 · 수강권으로 발급] 양식을 바로 연다. 입금검토의 수강권 작성 드로어는 그대로.
  if(onIssueInline)return onIssueInline();
  update({issuing:true,draft:newDraft(),error:''});
});
  view.querySelector('[data-pass-reset]')?.addEventListener('click',()=>update({query:'',sport:'all'}));
  view.querySelector('.lp-filter-form')?.addEventListener('submit',event=>{event.preventDefault();const values=new FormData(event.currentTarget);update({query:text(values.get('query')),sport:text(values.get('sport'))||'all'});});
  view.querySelectorAll('[data-pass-schedule]').forEach(button=>button.onclick=()=>{if(!busy()&&!button.disabled)onSchedule?.(button.dataset.passSchedule);});
  // 그룹 선택(2026-11-20 사용자 지시): 행 체크 → 묶어서 시간권 변경·삭제. 결과는 bulkNotice 로 남는다.
  view.querySelectorAll('[data-pass-bulk]').forEach(box=>box.addEventListener('change',()=>{
    const current=new Set(list(configuration(ui).bulkSelected));
    if(box.checked)current.add(box.dataset.passBulk);else current.delete(box.dataset.passBulk);
    update({bulkSelected:[...current],bulkNotice:''});
  }));
  view.querySelector('[data-pass-bulk-all]')?.addEventListener('change',event=>{
    const ids=[...view.querySelectorAll('[data-pass-bulk]')].map(box=>box.dataset.passBulk);
    update({bulkSelected:event.currentTarget.checked?ids:[],bulkNotice:''});
  });
  view.querySelector('[data-pass-bulk-clear]')?.addEventListener('click',()=>{if(!busy())update({bulkSelected:[],bulkNotice:''});});
  view.querySelector('[data-pass-bulk-apply]')?.addEventListener('click',async()=>{
    if(busy())return;
    const selected=list(configuration(ui).bulkSelected);
    const minutesRaw=String(view.querySelector('[data-pass-bulk-minutes]')?.value||'');
    const sportRaw=String(view.querySelector('[data-pass-bulk-sport]')?.value||'');
    const minutes=minutesRaw?Number(minutesRaw):null;
    const sport=['스키','보드'].includes(sportRaw)?sportRaw:null;
    if(!selected.length)return;
    if(minutes===null&&sport===null){linkStatus('변경할 항목(시간권 또는 종목)을 먼저 선택해 주세요.',true);return;}
    if(minutes!==null&&![120,240].includes(minutes))return;
    if(typeof onUpdate!=='function'){linkStatus('수강권 변경 연결을 확인해 주세요.',true);return;}
    const label=[minutes!==null?(minutes===240?'4시간':'2시간'):null,sport].filter(Boolean).join(' · ');
    if(globalThis.confirm?.(`선택한 수강권 ${selected.length}개를 ${label}(으)로 변경할까요?`)!==true)return;
    deleting=true;const restore=lockButtons();
    let ok=0,skipped=0;const failures=[];
    try{
      for(const id of selected){
        const pass=selectPassBalances(state).find(row=>row.id===id);
        if(!pass){failures.push({id,message:'수강권을 찾지 못했습니다. 목록을 새로고침해 주세요.'});continue;}
        const patch={...(minutes!==null&&minutes!==pass.lessonMinutes?{lessonMinutes:minutes}:{}),...(sport!==null&&sport!==pass.sport?{sport}:{})};
        if(!Object.keys(patch).length){skipped++;continue;}
        try{await onUpdate({id,expectedUpdatedAt:pass.updatedAt,...patch});ok++;}
        catch(issue){failures.push({id,message:issue?.message||'변경하지 못했습니다.'});}
      }
    }finally{deleting=false;restore();}
    update({bulkSelected:failures.map(row=>row.id),bulkNotice:`그룹 변경(${label}): 성공 ${ok}개${skipped?` · 이미 동일 ${skipped}개`:''}${failures.length?` · 실패 ${failures.length}개 — ${failures[0].message}`:''}`});
  });
  view.querySelector('[data-pass-bulk-delete]')?.addEventListener('click',async()=>{
    if(busy())return;
    const selected=list(configuration(ui).bulkSelected);
    if(!selected.length)return;
    if(typeof onDelete!=='function'){linkStatus('수강권 삭제 연결을 확인해 주세요.',true);return;}
    if(globalThis.confirm?.(`선택한 수강권 ${selected.length}개를 삭제할까요?\n예약·입금 배분·일정 신청이 연결된 수강권은 서버가 삭제를 거부합니다. 삭제는 되돌릴 수 없습니다.`)!==true)return;
    deleting=true;const restore=lockButtons();
    let ok=0;const failures=[];
    try{
      for(const id of selected){
        const pass=selectPassBalances(state).find(row=>row.id===id);
        if(!pass){ok++;continue;}
        try{await onDelete(passDeletionPayload(pass));ok++;}
        catch(issue){failures.push({id,message:issue?.message||'삭제하지 못했습니다.'});}
      }
    }finally{deleting=false;restore();}
    update({bulkSelected:failures.map(row=>row.id),bulkNotice:`그룹 삭제: 성공 ${ok}개${failures.length?` · 실패 ${failures.length}개 — ${failures[0].message}`:''}`});
  });
  // 수강권 변경(2026-11-20): 행의 [변경] 버튼 → 변경 창에서 시간권(2시간/4시간)만 고친다.
  view.querySelectorAll('[data-pass-edit]').forEach(button=>button.onclick=()=>{
    if(busy()||button.disabled)return;
    const pass=selectPassBalances(state).find(row=>row.id===button.dataset.passEdit);
    if(!pass)return;
    // 2026-11-24: [변경]은 예약접수 폼(날짜 제외)을 그대로 열어 전 항목을 수정한다(onEdit).
    // onEdit 미연결 환경(데모 등)은 기존 축소형 모달로 폴백.
    if(typeof onEdit==='function'){onEdit(pass.id);return;}
    update({editRequest:{id:pass.id,lessonMinutes:pass.lessonMinutes||120,error:'',saving:false}});
  });
  view.querySelector('[data-pass-edit-cancel]')?.addEventListener('click',()=>{if(!busy()&&!configuration(ui).editRequest?.saving)update({editRequest:null});});
  // 삭제는 변경 창 안에서 진입한다(2026-11-20 사용자 지시: 행 버튼에서 제거).
  view.querySelector('[data-pass-edit-delete]')?.addEventListener('click',()=>{
    const request=configuration(ui).editRequest;
    if(busy()||!request||request.saving)return;
    const pass=selectPassBalances(state).find(row=>row.id===request.id);
    if(!pass){update({editRequest:null});return;}
    update({editRequest:null,deleteRequest:passDeletionPayload(pass)});
  });
  view.querySelector('[data-pass-edit-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget&&!busy()&&!configuration(ui).editRequest?.saving)update({editRequest:null});});
  // 입력 보존(2026-11-22): 재렌더 없이 editRequest 에 제자리 기록 — 백그라운드 동기화가 입력을 덮지 않게.
  const persistEdit=(selector,apply)=>view.querySelector(selector)?.addEventListener('input',event=>{const req=configuration(ui).editRequest;if(req&&!req.saving)apply(req,event.target.value);});
  persistEdit('[data-pass-edit-minutes]',(req,value)=>{req.lessonMinutes=Number(value);});
  persistEdit('[data-pass-edit-sport]',(req,value)=>{req.sport=value;});
  persistEdit('[data-pass-edit-company]',(req,value)=>{req.company=value;});
  persistEdit('[data-pass-edit-count]',(req,value)=>{req.studentCountText=value;});
  persistEdit('[data-pass-edit-instructor]',(req,value)=>{req.fixedInstructorId=value;});
  persistEdit('[data-pass-edit-fee]',(req,value)=>{req.feeText=value;});
  persistEdit('[data-pass-edit-received]',(req,value)=>{req.receivedText=value;});
  persistEdit('[data-pass-edit-memo]',(req,value)=>{req.memo=value;});
  view.querySelector('[data-pass-edit-confirm]')?.addEventListener('click',async()=>{
    const request=configuration(ui).editRequest;
    if(busy()||!request||request.saving)return;
    const pass=selectPassBalances(state).find(row=>row.id===request.id);
    if(!pass){update({editRequest:null});return;}
    if(typeof onUpdate!=='function'){update({editRequest:{...request,error:'수강권 변경 연결을 확인해 주세요.'}});return;}
    const minutes=Number(view.querySelector('[data-pass-edit-minutes]')?.value);
    const sport=String(view.querySelector('[data-pass-edit-sport]')?.value||pass.sport||'');
    const company=String(view.querySelector('[data-pass-edit-company]')?.value||'').trim();
    const countText=String(view.querySelector('[data-pass-edit-count]')?.value??'').trim();
    const studentCount=countText===''?null:Number(countText);
    const instructorField=view.querySelector('[data-pass-edit-instructor]');
    const instructor=instructorField&&!instructorField.disabled?String(instructorField.value||'').trim():'';
    const feeText=String(view.querySelector('[data-pass-edit-fee]')?.value??'').trim();
    const receivedText=String(view.querySelector('[data-pass-edit-received]')?.value??'').trim();
    const memoField=view.querySelector('[data-pass-edit-memo]');
    const memo=memoField?String(memoField.value??''):null;
    const fee=feeText===''?null:Number(feeText);
    const received=receivedText===''?null:Number(receivedText);
    if(![120,240].includes(minutes)){update({editRequest:{...request,error:'2시간 또는 4시간을 선택해 주세요.'}});return;}
    if(!['스키','보드'].includes(sport)){update({editRequest:{...request,error:'종목(스키·보드)을 선택해 주세요.'}});return;}
    if(studentCount!==null&&(!Number.isInteger(studentCount)||studentCount<1||studentCount>20)){update({editRequest:{...request,error:'강습 인원은 1명부터 20명까지입니다.'}});return;}
    if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0)){update({editRequest:{...request,error:'회당 강습료를 확인해 주세요. 무료면 0.'}});return;}
    if(received!==null&&(!Number.isSafeInteger(received)||received<0)){update({editRequest:{...request,error:'받은 금액을 확인해 주세요.'}});return;}
    // 메모·금액: 금액 줄 제외 메모(textarea) 위에 입력 금액으로 표준 줄을 재구성한다.
    const currentFee=noteAmount(pass.notes,'회당 강습료:');
    const currentReceived=noteAmount(pass.notes,'받은 금액');
    const currentMemo=passMoneyFreeNotes(pass.notes);
    const notesChanged=fee!==currentFee||received!==currentReceived||(memo!==null&&memo.trim()!==currentMemo.trim());
    const nextNotes=notesChanged?rebuildPassMoneyNotes({...pass,notes:memo??currentMemo},fee,received):null;
    const ratioMatch=/^1:(\d{1,2})$/.exec(String(pass.lessonRatio??pass.lesson_ratio??'').trim());
    const currentCount=ratioMatch?Number(ratioMatch[1]):null;
    const changes={
      ...(minutes!==pass.lessonMinutes?{lessonMinutes:minutes}:{}),
      ...(sport!==pass.sport?{sport}:{}),
      ...(company&&normalizeBookingCompany(company)!==normalizeBookingCompany(pass.company)?{company}:{}),
      ...(studentCount!==null&&studentCount!==currentCount?{studentCount}:{}),
      ...(instructor&&instructor!==String(pass.fixedInstructorId||'')?{fixedInstructorId:instructor}:{}),
      ...(nextNotes!==null?{notes:nextNotes}:{}),
    };
    if(!Object.keys(changes).length){update({editRequest:null});return;}
    ui.passes={...configuration(ui),editRequest:{...request,lessonMinutes:minutes,sport,company,studentCount,fee,received,memo,saving:true,error:''}};onChange?.(ui.passes);
    try{await onUpdate({id:pass.id,expectedUpdatedAt:pass.updatedAt,...changes});update({editRequest:null});}
    catch(issue){update({editRequest:{...request,lessonMinutes:minutes,sport,company,studentCount,fee,received,memo,saving:false,error:issue?.message||'수강권을 변경하지 못했습니다. 다시 시도해 주세요.'}});}
  });
  view.querySelectorAll('[data-pass-customer-link]').forEach(button=>button.onclick=async()=>{
    if(busy()||button.disabled)return;
    if(typeof onCustomerLink!=='function'){linkStatus('고객용 상태 링크 연결을 확인해 주세요.',true);return;}
    linking=true;const restore=lockButtons();button.setAttribute?.('aria-busy','true');linkStatus('고객용 상태 링크를 준비하고 있습니다.');
    try{await onCustomerLink(button.dataset.passCustomerLink);linkStatus('');}
    catch(issue){linkStatus(issue?.message||'고객용 상태 링크를 준비하지 못했습니다. 다시 시도해 주세요.',true);}
    finally{linking=false;button.removeAttribute?.('aria-busy');restore();}
  });
  // 발급 취소(삭제): 인라인 확인 → onDelete → 서버 응답으로만 완료 처리.
  view.querySelectorAll('[data-pass-delete]').forEach(button=>button.onclick=()=>{
    if(busy()||button.disabled)return;
    const pass=selectPassBalances(state).find(row=>row.id===button.dataset.passDelete);
    if(pass)update({deleteRequest:passDeletionPayload(pass)});
  });
  view.querySelector('[data-pass-delete-cancel]')?.addEventListener('click',()=>{if(!busy())update({deleteRequest:null});});
  view.querySelector('[data-pass-delete-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget&&!busy())update({deleteRequest:null});});
  view.querySelector('[data-pass-delete-confirm]')?.addEventListener('click',async()=>{
    if(busy())return;
    const request=configuration(ui).deleteRequest;if(!request?.id)return;
    if(typeof onDelete!=='function'){linkStatus('수강권 삭제 연결을 확인해 주세요.',true);return;}
    const payload={...request,reason:text(view.querySelector('[data-pass-delete-reason]')?.value??request.reason??'')};
    ui.passes={...configuration(ui),deleteRequest:payload};
    deleting=true;const restore=lockButtons();linkStatus('수강권을 삭제하고 있습니다.');
    try{await onDelete(payload);linkStatus('');update({deleteRequest:null});}
    catch(issue){linkStatus('');update({deleteRequest:{...payload,error:issue?.message||'수강권을 삭제하지 못했습니다. 다시 시도해 주세요.'}});}
    finally{deleting=false;restore();}
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
    // 같은 전화번호(없으면 같은 고객명)의 미사용 수강권이 있으면 중복 발급인지 확인한다(2026-11-20).
    const phoneKey=canonicalTelephone(draft.phone);
    const existing=selectPassBalances(state).filter(pass=>pass.id!==draft.id&&(pass.available===null||pass.available>0)&&(phoneKey?canonicalTelephone(pass.phone)===phoneKey:String(pass.customerName||'').trim()===draft.customerName));
    if(existing.length&&globalThis.confirm?.(`같은 ${phoneKey?'전화번호':'고객명'}의 미사용 수강권이 이미 ${existing.length}장 있습니다.\n${existing.slice(0,3).map(pass=>`· ${pass.customerName||'고객'} · ${pass.learnerName||'기본 팀'} · ${pass.total===null?'횟수 미정':`${pass.total}회`}`).join('\n')}\n잘못 발급된 수강권은 수강권 목록에서 삭제할 수 있습니다.\n그래도 새로 발급할까요?`)!==true)return;
    // 같은 전화번호 고객 재사용(2026-11-20 사용자 지시): 번호가 같은 고객이 있으면 새로 만들지 않는다.
    if(!draft.customerId&&phoneKey){
      const samePhone=list(state.customers).filter(row=>row&&!row.deleted_at&&Array.isArray(row.contacts)&&row.contacts.some(contact=>canonicalTelephone(contact?.phone)===phoneKey));
      if(samePhone.length>1){box.textContent='같은 전화번호의 고객이 여러 명 등록돼 있습니다. 고객·팀 탭에서 확인 후 발급해 주세요.';box.hidden=false;return;}
      if(samePhone.length===1){
        const found=samePhone[0];
        if(String(found.name||'').trim()!==draft.customerName){box.textContent=`같은 전화번호로 이미 등록된 고객 이름과 다릅니다: 입력 '${draft.customerName}' ↔ 등록 '${String(found.name||'').trim()}'.`;box.hidden=false;return;}
        draft.customerId=found.id;
        const foundTeam=list(state.customerTeams).find(team=>(team.customer_id??team.customerId)===found.id&&String(team.name||'').trim()===draft.learnerName);
        if(foundTeam)draft.teamId=foundTeam.id;
      }
    }
    // 고객 디렉터리 연결(2026-11-20): 미연결 발급은 고객·팀 탭에서 보이지 않는다 —
    // 연결 없는 draft 는 새 id+draft 를 동봉해 서버가 고객·팀을 생성·연결한다(예약접수·입금검토와 패리티).
    if(!draft.customerId){draft.customerId=crypto.randomUUID();draft.customerDraft={id:draft.customerId,name:draft.customerName,contacts:phoneKey?[{label:'고객 연락처',phone:phoneKey}]:[],notes:''};}
    if(!draft.teamId){draft.teamId=crypto.randomUUID();draft.teamDraft={id:draft.teamId,customerId:draft.customerId,name:draft.learnerName,phone:'',defaults:{}};}
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
