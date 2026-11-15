const escapeFallback = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const koreaDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const koreaClock = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const statusLabels = {pending:'검토 대기',approved:'승인',rejected:'반려',cancelled:'취소'};
const asDay = value => value && Number.isFinite(new Date(value).getTime()) ? koreaDay.format(new Date(value)) : '';
const asClock = value => value && Number.isFinite(new Date(value).getTime()) ? koreaClock.format(new Date(value)) : '';
const parseDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && asDay(`${value}T00:00:00+09:00`)===value ? new Date(`${value}T00:00:00+09:00`) : null;
const firstValue = (...values) => values.find(value=>value!==undefined&&value!==null);
const memberId = row => row?.instructor_user_id || row?.instructorUserId;
const requestDay = row => row?.date || row?.requested_date || '';

/** Local seasonal guard; holiday eligibility always comes from the server calendar. */
export function isTimeOffDateAllowed(date, now = new Date()) {
  const value=parseDay(date),today=parseDay(asDay(now));
  if(!value||!today)return false;
  const gap=Math.round((value-today)/86400000);
  const weekday=new Date(`${date}T12:00:00+09:00`).getUTCDay();
  const month=Number(date.slice(5,7));
  return gap>=8&&(month===1?[1,2,3,4,5].includes(weekday):[12,2].includes(month)&&[2,3,4].includes(weekday));
}

function calendarAvailable(calendar) {
  return !!calendar&&!!parseDay(calendar.fromDate)&&!!parseDay(calendar.throughDate)
    &&calendar.fromDate<=calendar.throughDate&&Array.isArray(calendar.allowedDates)
    &&calendar.allowedDates.every(date=>!!parseDay(date)&&date>=calendar.fromDate&&date<=calendar.throughDate);
}

/** No local holiday guesses or fallback dates are permitted. */
export function isTimeOffDateRequestable(date, calendar, now = new Date()) {
  return calendarAvailable(calendar)&&date>=calendar.fromDate&&date<=calendar.throughDate
    &&calendar.allowedDates.includes(date)&&isTimeOffDateAllowed(date,now);
}

function canRequestDate(state,date,now) {
  return !state.timeOffCalendarError&&isTimeOffDateRequestable(date,state.timeOffCalendar,now)
    &&!(state.timeOffRequests||[]).some(row=>memberId(row)===state.profile?.user_id&&requestDay(row)===date&&['pending','approved'].includes(row.status));
}

const instructorIds = lesson => [...new Set([lesson.instructorUserId,lesson.instructor_user_id,...(lesson.instructorUserIds||[]),...(lesson.instructor_user_ids||[])].filter(Boolean))];

/** Only schedule fields already authorized by the API are consumed here. */
export function getTimeOffConflicts(state = {}, date, instructorId) {
  const dayStart=parseDay(date);
  if(!dayStart||!instructorId)return [];
  const dayEnd=new Date(dayStart.getTime()+86400000);
  const allFlags=Array.isArray(state.reservationFlags)?state.reservationFlags:[];
  const rawReservations=state.profile?.role==='admin'&&Array.isArray(state.reservations)?state.reservations:[];
  const flags=new Map([...rawReservations,...allFlags].map(row=>[row.schedule_id||row.scheduleId||row.id,row]));
  const matches=new Map();
  for(const lesson of state.schedules||[]) {
    if(!instructorIds(lesson).includes(instructorId))continue;
    const start=lesson.start||lesson.start_at,end=lesson.end||lesson.end_at;
    if(!(new Date(start)<dayEnd&&new Date(end)>dayStart))continue;
    const flag=flags.get(lesson.id)||{};
    if(flag.status==='cancelled'||flag.status==='canceled')continue;
    matches.set(lesson.id,{...flag,id:lesson.id,start,end,customer:lesson.customer||lesson.customer_name||'강습',assigned:true});
  }
  for(const flag of [...rawReservations,...allFlags]) {
    const preferred=flag.preferred_instructor_user_id||flag.preferredInstructorId;
    if(preferred!==instructorId&&memberId(flag)!==instructorId)continue;
    const id=flag.schedule_id||flag.scheduleId||flag.id;
    if(!id||matches.has(id)||flag.status==='cancelled'||flag.status==='canceled')continue;
    const lesson=(state.schedules||[]).find(row=>row.id===id);
    const start=flag.start_at||flag.start||lesson?.start,end=flag.end_at||flag.end||lesson?.end;
    if(!(new Date(start)<dayEnd&&new Date(end)>dayStart))continue;
    matches.set(id,{...flag,id,start,end,customer:flag.customer_name||flag.customer||lesson?.customer||'지정 강습',assigned:instructorIds(lesson||{}).includes(instructorId)});
  }
  return [...matches.values()].sort((a,b)=>new Date(a.start)-new Date(b.start)||String(a.id).localeCompare(String(b.id)));
}

function configuration(ui = {}, now = new Date()) {
  const value=ui.timeOff||{};
  return {month:/^\d{4}-\d{2}$/.test(value.month||'')?value.month:asDay(now).slice(0,7),date:value.date||'',note:value.note||'',filter:value.filter||'pending',error:value.error||''};
}
function shiftedMonth(month, delta) {
  const [year,number]=month.split('-').map(Number);
  const value=new Date(Date.UTC(year,number-1+delta,1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,'0')}`;
}
function tagsFor(flag,escape) {
  const tags=[];
  if(flag.kind==='reorder'||flag.booking_kind==='reorder'||flag.is_reorder===true||flag.isReorder===true)tags.push('<span class="to-badge reorder">리오더</span>');
  if(flag.kind==='season'||flag.booking_kind==='season'||flag.season_id||flag.seasonId)tags.push('<span class="to-badge season">시즌 강습</span>');
  if(flag.designated||flag.is_designated)tags.push('<span class="to-badge designated">지정 강습</span>');
  if(!tags.length)tags.push('<span class="to-badge">일반 강습</span>');
  const sequence=firstValue(flag.session_number,flag.sessionNumber);
  if(sequence)tags.push(`<span class="to-sequence">${escape(sequence)}회차</span>`);
  return tags.join('');
}
function conflictRows(conflicts,escape,allowOpen=true) {
  if(!conflicts.length)return '<div class="to-clear"><span class="to-clear-dot"></span>해당 날짜에 연결된 강습이 없습니다.</div>';
  return `<ul class="to-lessons">${conflicts.map(lesson=>`<li><div class="to-lesson-time">${escape(asClock(lesson.start))}<small>— ${escape(asClock(lesson.end))}</small></div><div class="to-lesson-copy"><strong>${escape(lesson.customer)}</strong><div class="to-lesson-tags">${tagsFor(lesson,escape)}${lesson.assigned===false?'<span class="to-sequence">담당 지정 · 미배정</span>':''}</div></div>${allowOpen&&lesson.assigned!==false?`<button type="button" class="btn ghost small" data-timeoff-lesson="${escape(lesson.id)}">상세</button>`:''}</li>`).join('')}</ul>`;
}
function calendar(state,selected,now,escape) {
  const [year,month]=selected.month.split('-').map(Number);
  const first=new Date(Date.UTC(year,month-1,1));
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  const offset=(first.getUTCDay()+6)%7;
  const ownRequests=(state.timeOffRequests||[]).filter(row=>memberId(row)===state.profile?.user_id&&['pending','approved'].includes(row.status));
  const days=[];
  for(let index=0;index<offset;index++)days.push('<span class="to-calendar-empty" aria-hidden="true"></span>');
  for(let number=1;number<=last;number++) {
    const date=`${selected.month}-${String(number).padStart(2,'0')}`;
    const existing=ownRequests.find(row=>requestDay(row)===date);
    const allowed=!state.timeOffCalendarError&&isTimeOffDateRequestable(date,state.timeOffCalendar,now)&&!existing;
    const today=date===asDay(now);
    days.push(`<button type="button" class="to-calendar-day ${date===selected.date?'selected':''} ${today?'today':''} ${existing?'requested':''}" data-timeoff-date="${date}" aria-label="${year}년 ${month}월 ${number}일${existing?' · '+statusLabels[existing.status]:''}" aria-pressed="${date===selected.date}" ${allowed?'':'disabled'}><span>${number}</span>${existing?'<i aria-hidden="true"></i>':''}</button>`);
  }
  return `<div class="to-calendar"><div class="to-calendar-head"><button type="button" class="to-month-button" data-timeoff-month="${escape(shiftedMonth(selected.month,-1))}" aria-label="이전 달">‹</button><h3>${year}년 ${month}월</h3><button type="button" class="to-month-button" data-timeoff-month="${escape(shiftedMonth(selected.month,1))}" aria-label="다음 달">›</button></div><div class="to-calendar-week" aria-hidden="true">${['월','화','수','목','금','토','일'].map(day=>`<span>${day}</span>`).join('')}</div><div class="to-calendar-grid">${days.join('')}</div></div>`;
}
function requestHistory(rows,state,escape,admin) {
  if(!rows.length)return '<div class="to-empty">등록된 휴무 신청이 없습니다.</div>';
  return `<div class="to-request-list">${rows.map(row=>{
    const person=(state.roster||[]).find(member=>member.user_id===memberId(row));
    const conflicts=getTimeOffConflicts(state,requestDay(row),memberId(row));
    return `<article class="to-request"><div class="to-request-top"><div><strong>${escape(requestDay(row))}</strong>${admin?`<span class="to-request-name">${escape(person?.display_name||row.instructor_name||'강사')}</span>`:''}<small>신청 ${escape(asDay(row.created_at))}</small></div><span class="to-badge ${escape(row.status)}">${escape(statusLabels[row.status]||row.status)}</span></div>${row.note?`<p class="to-note">${escape(row.note)}</p>`:''}${row.review_note?`<div class="to-review-note"><strong>관리자 확인</strong><p>${escape(row.review_note)}</p></div>`:''}${admin?`<div class="to-request-conflicts"><span class="to-caption">연결된 강습 ${conflicts.length}건</span>${conflictRows(conflicts,escape)}</div>`:''}${row.status==='pending'?admin?`<form class="to-review-form" data-timeoff-review="${escape(row.id)}"><label class="field"><span class="field-label">검토 메모</span><input name="note" maxlength="1000" placeholder="강사에게 전달할 내용을 입력하세요" aria-label="${escape(requestDay(row))} 휴무 검토 메모"></label>${conflicts.length?'<p class="to-review-warning">연결된 강습을 먼저 조정한 뒤 승인할 수 있습니다.</p>':''}<div class="to-request-actions"><button class="btn secondary small" type="submit" name="decision" value="rejected">반려</button><button class="btn primary small" type="submit" name="decision" value="approved" ${conflicts.length?'disabled':''}>승인</button></div><p class="to-form-error" role="alert" hidden></p></form>`:`<div class="to-request-actions"><button type="button" class="btn ghost small" data-timeoff-cancel="${escape(row.id)}">신청 취소</button><span class="to-form-error" role="alert" hidden></span></div>`:''}</article>`;
  }).join('')}</div>`;
}

export function renderTimeOff({state = {},ui = {},escapeHTML = escapeFallback,icon = ()=>'',now = new Date()} = {}) {
  const escape=escapeHTML,selected=configuration(ui,now),admin=state.profile?.role==='admin';
  const calendarReady=!state.timeOffCalendarError&&calendarAvailable(state.timeOffCalendar);
  if(selected.date&&!canRequestDate(state,selected.date,now))selected.date='';
  const ownId=state.profile?.user_id;
  const requests=(state.timeOffRequests||[]).filter(row=>admin||memberId(row)===ownId).slice().sort((a,b)=>String(b.created_at||requestDay(b)).localeCompare(String(a.created_at||requestDay(a))));
  const shown=admin?requests.filter(row=>selected.filter==='all'||row.status===selected.filter):requests;
  const pending=requests.filter(row=>row.status==='pending').length;
  const conflicts=getTimeOffConflicts(state,selected.date,ownId);
  return `<section class="timeoff-page" data-timeoff-role="${admin?'admin':'instructor'}"><div class="page-head"><div><div class="eyebrow">${admin?'INSTRUCTOR OPERATIONS':'MY LESSON WORKSPACE'}</div><h1>${admin?'휴무 신청 관리':'휴무 신청'}</h1><p class="subtitle">${admin?'강습 배정 현황과 함께 신청 내용을 확인하세요.':'희망 날짜를 선택하고 연결된 강습을 확인해 주세요.'}</p></div>${admin?`<span class="to-pending-count">검토 대기 <strong>${pending}</strong></span>`:''}</div>${calendarReady?'':'<div class="warning-box" role="status"><span>휴무 신청 달력을 불러오지 못했습니다. 다시 불러와 주세요.</span><button type="button" class="btn secondary small" data-action="refresh">다시 불러오기</button></div>'}${admin?`<section class="panel to-admin-panel"><div class="to-filter-row">${[['pending','검토 대기'],['approved','승인'],['rejected','반려'],['all','전체']].map(([key,label])=>`<button type="button" class="${selected.filter===key?'active':''}" data-timeoff-filter="${key}">${label}</button>`).join('')}<span>${shown.length}건</span></div>${requestHistory(shown,state,escape,true)}</section>`:`<div class="to-layout"><section class="panel to-intake"><div class="panel-head"><h2 class="panel-title">희망 날짜 선택</h2>${icon('calendar')}</div>${calendar(state,selected,now,escape)}<form class="to-request-form"><input name="date" type="hidden" value="${escape(selected.date)}"><div class="to-selection"><div class="to-selection-heading"><span>${selected.date?escape(selected.date):'날짜를 선택해 주세요'}</span>${selected.date?`<small>연결된 강습 ${conflicts.length}건</small>`:''}</div>${selected.date?conflictRows(conflicts,escape):'<p class="to-selection-placeholder">달력에서 날짜를 선택하면 강습 일정을 확인할 수 있습니다.</p>'}${selected.date&&conflicts.length?'<p class="to-conflict-help">강습 일정이 함께 전달되며 관리자가 조정 여부를 확인합니다.</p>':''}</div><label class="field"><span class="field-label">신청 메모 <span class="muted">선택</span></span><textarea name="note" rows="3" maxlength="1000" placeholder="필요한 내용을 남겨 주세요.">${escape(selected.note)}</textarea></label><p class="to-form-error" role="alert" ${selected.error?'':'hidden'}>${escape(selected.error)}</p><button class="btn primary to-submit" type="submit" ${selected.date&&canRequestDate(state,selected.date,now)?'':'disabled'}>${icon('check')}휴무 신청하기</button></form></section><section class="panel to-history"><div class="panel-head"><div><h2 class="panel-title">나의 신청 내역 <span class="count-sub">${requests.length}</span></h2><p class="muted">신청 상태와 관리자 확인 내용을 볼 수 있습니다.</p></div></div>${requestHistory(requests,state,escape,false)}</section></div>`}</section>`;
}

export function bindTimeOff(root,{state = {},ui = {},onBeforeChange,onChange,onRequest,onReview,onCancel,onOpenLesson,now:currentTime=()=>new Date()} = {}) {
  const view=root.querySelector('.timeoff-page');
  if(!view)return;
  const now=()=>typeof currentTime==='function'?currentTime():currentTime;
  const update=changes=>{if(onBeforeChange?.(changes)===false)return;ui.timeOff={...configuration(ui,now()),...changes};if(onChange)onChange(ui.timeOff);};
  view.querySelectorAll('[data-timeoff-month]').forEach(button=>button.addEventListener('click',()=>update({month:button.dataset.timeoffMonth})));
  view.querySelectorAll('[data-timeoff-date]:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{
    const date=button.dataset.timeoffDate;
    update(canRequestDate(state,date,now())?{date,error:''}:{date:'',error:'선택한 날짜를 다시 확인해 주세요.'});
  }));
  view.querySelectorAll('[data-timeoff-filter]').forEach(button=>button.addEventListener('click',()=>update({filter:button.dataset.timeoffFilter})));
  view.querySelectorAll('[data-timeoff-lesson]').forEach(button=>button.addEventListener('click',()=>onOpenLesson?.(button.dataset.timeoffLesson)));
  const request=view.querySelector('.to-request-form');
  request?.elements.namedItem('note')?.addEventListener('input',event=>{ui.timeOff={...configuration(ui),note:event.target.value};});
  const perform=async(container,callback)=>{
    if(container.dataset.timeoffSaving)return;
    container.dataset.timeoffSaving='1';
    const buttons=[...container.querySelectorAll('button')];
    const originallyDisabled=buttons.map(button=>button.disabled);buttons.forEach(button=>button.disabled=true);
    const error=container.querySelector('.to-form-error');if(error){error.hidden=true;error.textContent='';}
    try{await callback();}catch(issue){if(error){error.textContent=issue.message||'처리하지 못했습니다. 다시 시도해 주세요.';error.hidden=false;}}
    finally{delete container.dataset.timeoffSaving;buttons.forEach((button,index)=>button.disabled=originallyDisabled[index]);}
  };
  request?.addEventListener('submit',event=>{
    event.preventDefault();
    const values=new FormData(request),date=String(values.get('date')||'');
    if(!canRequestDate(state,date,now())){const error=request.querySelector('.to-form-error');error.textContent=calendarAvailable(state.timeOffCalendar)&&!state.timeOffCalendarError?'선택한 날짜를 다시 확인해 주세요.':'휴무 신청 달력을 다시 불러와 주세요.';error.hidden=false;return;}
    perform(request,async()=>{await onRequest?.({date,note:String(values.get('note')||'').trim()});ui.timeOff={...configuration(ui),date:'',note:'',error:''};onChange?.(ui.timeOff);});
  });
  view.querySelectorAll('[data-timeoff-review]').forEach(form=>form.addEventListener('submit',event=>{
    event.preventDefault();const values=new FormData(form);const status=event.submitter?.value;
    if(!['approved','rejected'].includes(status))return;
    perform(form,()=>onReview?.({id:form.dataset.timeoffReview,status,note:String(values.get('note')||'').trim()}));
  }));
  view.querySelectorAll('[data-timeoff-cancel]').forEach(button=>button.addEventListener('click',()=>perform(button.parentElement,()=>onCancel?.(button.dataset.timeoffCancel))));
}
