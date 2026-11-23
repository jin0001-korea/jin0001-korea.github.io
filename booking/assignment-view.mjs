import { ASSIGNMENT_REASON_LABELS } from './booking-rules.mjs?v=35';

const escapeFallback=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const rows=value=>Array.isArray(value)?value:[];
const strings=value=>rows(value).map(item=>typeof item==='string'?item:item?.label||'').filter(Boolean);
const unique=value=>[...new Set(value.filter(Boolean))];
const number=value=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):0;
const labels={
  ...ASSIGNMENT_REASON_LABELS,
  PAST_LESSON:'이미 종료된 강습입니다. 예약 내용을 확인해 주세요.',
  NO_INSTRUCTORS:'활성 강사 계정을 먼저 등록해 주세요.',
  MISSING_ID:'예약 정보를 다시 불러와 주세요.',
  DUPLICATE_RESERVATION:'같은 예약이 중복되어 있습니다. 예약 정보를 확인해 주세요.',
  REQUIRED_INSTRUCTOR_UNAVAILABLE:'지정된 강사를 배정할 수 없습니다. 담당 강사의 일정과 휴무를 확인해 주세요.',
};
const dateLabel=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',weekday:'short'});
const clockLabel=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const dayLabel=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const instant=value=>value&&Number.isFinite(Date.parse(value))?new Date(value):null;

function planRows(plan={}){
  const all=rows(plan.items).length?rows(plan.items):[...rows(plan.assignable),...rows(plan.blocked)];
  const seen=new Set();
  return all.filter(item=>{
    // Keep rows with missing IDs visible so their validation issue is reviewable.
    if(!item?.id)return true;
    if(seen.has(item.id))return false;
    seen.add(item.id);return true;
  });
}
function assignableRows(plan={},all=planRows(plan)){
  const source=Array.isArray(plan.assignable)?plan.assignable:all.filter(item=>item.eligible===true||item.recommended===true);
  return source.filter(item=>item?.id&&item.instructorId&&(item.eligible!==false&&item.recommended!==false));
}
/** The server includes every unassigned date in a selected season package. */
export function assignmentPlanImpact(plan={}){
  const selected=assignableRows(plan),ids=new Set(selected.map(item=>item.id)),selectedCount=ids.size;
  let hasSeason=false;
  for(const item of selected)if(item.seasonId){hasSeason=true;for(const id of rows(item.seasonReservationIds))if(typeof id==='string'&&id)ids.add(id);}
  return {count:ids.size,additional:ids.size-selectedCount,hasSeason,exceedsLimit:ids.size>100};
}
/** A successful RPC receipt, rather than the selected count, confirms saves. */
export function assignmentSaveMessage(result,requested=[]){
  const updated=rows(result?.updated),ids=new Set(updated.map(item=>item?.id));
  if(!Number.isInteger(result?.count)||result.count<1||result.count>100||updated.length!==result.count||ids.size!==result.count
    ||updated.some(item=>typeof item?.id!=='string'||!item.id||typeof item.updatedAt!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(item.updatedAt)||!Number.isFinite(Date.parse(item.updatedAt)))
    ||!requested.length||requested.some(item=>!ids.has(item?.id)))throw new Error('서버의 배정 저장 결과를 확인하지 못했습니다. 최신 목록을 다시 불러와 주세요.');
  return `${result.count>requested.length?'시즌강습의 다른 회차를 포함해 ':''}${result.count}건의 자동배정을 저장했습니다.`;
}
function reasonsFor(item){
  const given=strings(item.reasons);
  if(given.length)return unique(given);
  const reasons=strings(item.reasonCodes).map(code=>labels[code]||'예약 조건을 확인해 주세요.');
  return unique(reasons.length?reasons:['조건에 맞는 강사를 찾지 못했습니다.']);
}
function when(item,escape){
  const start=instant(item.start),end=instant(item.end);
  if(!start)return '<span class="ap-time-missing">날짜·시간 확인 필요</span>';
  const ending=end?(dayLabel.format(start)===dayLabel.format(end)?clockLabel.format(end):`${dateLabel.format(end)} ${clockLabel.format(end)}`):'종료 미확인';
  const plan=item.lessonMinutes?`<span>${item.lessonMinutes/60}시간 강습 · ${item.breakMinutes?`중간 ${item.breakMinutes/60}시간 휴식`:'연속'}</span>`:'';
  const segments=item.breakMinutes===120?(item.busySegments||[]).map(segment=>`${clockLabel.format(new Date(segment.start))}–${clockLabel.format(new Date(segment.end))}`).join(' / '):'';
  return `<strong>${escape(dateLabel.format(start))}</strong><span>${escape(clockLabel.format(start))} — ${escape(ending)}</span>${plan}${segments?`<span>${escape(segments)}</span>`:''}`;
}
function conditionTags(item,escape){
  const values=unique(strings(item.conditionLabels));
  if(item.requiresExperienced&&!values.some(value=>value.includes('경력')))values.push('경력강사 필요');
  if(!values.length)return '<span class="ap-condition-muted">예약 조건 기준</span>';
  return values.map(value=>`<span class="ap-condition">${escape(value)}</span>`).join('');
}

// 자동배정안 목록을 사용자가 날짜순(강습일·시간) 또는 제안 강사순으로 정렬. 미배정(제안강사 없음)·날짜미정은 뒤로 보낸다.
function sortPlanRows(rows,sort={}){
  if(!sort||!['date','instructor'].includes(sort.key)||!['asc','desc'].includes(sort.dir))return rows;
  const dir=sort.dir==='desc'?-1:1;
  const value=item=>sort.key==='date'?(instant(item.start)?.getTime()??Number.MAX_SAFE_INTEGER):(item.instructorName||'￿');
  return rows.map((row,index)=>({row,index})).sort((a,b)=>{
    const av=value(a.row),bv=value(b.row);
    const cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ko-KR',{numeric:true});
    return cmp*dir||a.index-b.index;
  }).map(item=>item.row);
}

/** Render a proposed allocation only. The parent owns authentication and writes. */
export function renderAssignmentPlan({plan={},escapeHTML=escapeFallback,icon=()=>'',busy=false,mode='preview',error='',sort={}}={}){
  const escape=escapeHTML,all=planRows(plan),assignable=assignableRows(plan,all),ids=new Set(assignable.map(item=>item.id));
  const sortedAll=sortPlanRows(all,sort),sortMark=key=>sort.key===key&&['asc','desc'].includes(sort.dir)?(sort.dir==='desc'?' ▼':' ▲'):'',apAria=key=>sort.key===key&&['asc','desc'].includes(sort.dir)?(sort.dir==='desc'?'descending':'ascending'):'none';
  const impact=assignmentPlanImpact(plan);
  const blocked=all.filter(item=>!ids.has(item.id)),preview=['preview','demo','sample'].includes(mode);
  const total=number(plan.unassignedTotal??plan.total??all.length),skipped=number(plan.skippedAssigned),remaining=number(plan.remaining);
  const limited=!!plan.limited||remaining>0;
  return `<section class="assignment-plan" aria-labelledby="assignment-plan-title" data-assignment-plan data-busy="${busy?'true':'false'}"><header class="ap-header"><div><span class="ap-eyebrow">AUTOMATIC ASSIGNMENT</span><div class="ap-heading-line"><h2 id="assignment-plan-title">자동배정안</h2><span class="ap-mode ${preview?'preview':'operational'}">${preview?'체험 배정':'운영 배정'}</span></div><p>현재 조회 조건의 미배정 예약을 확인했습니다. 배정안을 확인한 뒤 확정하세요.</p></div><button type="button" class="ap-close" data-assignment-close data-plan-close aria-label="자동배정안 닫기" ${busy?'disabled':''}>${icon('close')||'×'}</button></header><div class="ap-body"><div class="ap-summary" aria-label="자동배정 결과"><div><span>검토한 미배정 예약</span><strong>${all.length}<small>건</small></strong></div><div class="ready"><span>배정 가능</span><strong>${impact.count}<small>건</small></strong></div><div class="review"><span>확인 필요</span><strong>${blocked.length}<small>건</small></strong></div></div>${limited?`<div class="ap-limit-note">한 번에 ${number(plan.limit)||100}건까지 확인합니다.${remaining?` 남은 ${remaining}건은 이번 배정안을 적용한 뒤 다시 확인해 주세요.`:` 조회 조건을 나누어 나머지 예약을 확인해 주세요.`}</div>`:''}${impact.hasSeason?`<p class="ap-scope-note" data-assignment-season-scope>시즌강습은 같은 팀의 다른 날짜까지 같은 강사로 함께 배정합니다.${impact.additional?` 현재 목록 밖 ${impact.additional}회차를 포함해 총 ${impact.count}건입니다.`:''}</p>`:''}${impact.exceedsLimit?'<div class="ap-error" role="alert">시즌 회차를 포함해 100건을 넘습니다. 조회 범위를 줄여 다시 확인해 주세요.</div>':''}${skipped?`<p class="ap-scope-note">이미 담당 강사가 있는 ${skipped}건은 기존 배정을 유지합니다.</p>`:''}<div class="ap-error" role="alert" data-assignment-error ${error?'':'hidden'}>${escape(error)}</div>${all.length?`<div class="ap-table-scroll" tabindex="0" role="region" aria-label="예약별 자동배정안"><table class="ap-table"><caption class="ap-sr-only">미배정 예약 ${all.length}건의 제안 강사와 확인할 조건</caption><thead><tr><th scope="col" class="ap-sortable${sort.key==='date'?' ap-sorted':''}" data-ap-sort="date" aria-sort="${apAria('date')}" title="클릭하여 날짜순 정렬">강습일 · 시간<span class="ap-sort-mark">${sortMark('date')}</span></th><th scope="col">강습생</th><th scope="col">배정 조건</th><th scope="col" class="ap-sortable${sort.key==='instructor'?' ap-sorted':''}" data-ap-sort="instructor" aria-sort="${apAria('instructor')}" title="클릭하여 강사순 정렬">제안 강사<span class="ap-sort-mark">${sortMark('instructor')}</span></th><th scope="col">확인 사항</th><th scope="col">예약</th></tr></thead><tbody>${sortedAll.map(item=>{const eligible=ids.has(item.id);return `<tr class="${eligible?'ap-row-ready':'ap-row-review'}" data-assignment-row="${escape(item.id||'')}"><td class="ap-time">${when(item,escape)}</td><th scope="row" class="ap-customer">${escape(item.customer||'예약 확인 필요')}</th><td class="ap-conditions">${conditionTags(item,escape)}</td><td class="ap-instructor">${eligible?`<span class="ap-ready-mark" aria-hidden="true">✓</span><strong>${escape(item.instructorName||'선택된 강사')}</strong>`:'<span class="ap-unassigned">미배정</span>'}</td><td class="ap-reasons">${eligible?`<span class="ap-ready-label">배정 가능</span>${strings(item.reasons).length?`<small>${escape(unique(strings(item.reasons)).join(' · '))}</small>`:''}`:`<span class="ap-review-label">확인 필요</span><ul>${reasonsFor(item).map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul>`}</td><td><button type="button" class="btn ghost small ap-open-reservation" data-assignment-open="${escape(item.id||'')}" data-plan-open="${escape(item.id||'')}" ${busy||!item.id?'disabled':''}>${eligible?'예약 보기':'조건 확인'} →</button></td></tr>`;}).join('')}</tbody></table></div>`:`<div class="ap-empty"><span class="ap-empty-mark" aria-hidden="true">✓</span><h3>새로 배정할 예약이 없습니다.</h3><p>${skipped?'조회된 예약에는 이미 담당 강사가 있습니다.':'조회 날짜나 조건을 바꿔 미배정 예약을 확인해 주세요.'}</p></div>`}${blocked.length?'<p class="ap-blocked-note">확인이 필요한 예약은 미배정 상태로 남습니다. 지정·리오더·시즌 담당 강사를 다른 강사로 바꾸지 않습니다.</p>':''}</div><footer class="ap-footer"><div><strong>${assignable.length?`${impact.count}건 배정 가능`:all.length?'조건 확인 후 다시 배정해 주세요.':'미배정 예약을 선택해 주세요.'}</strong><span>${preview?'체험 데이터에만 적용하며 서버에는 저장하지 않습니다.':'확정하면 배정 가능한 예약을 서버에 함께 저장합니다.'}</span></div><div class="ap-footer-actions"><button type="button" class="btn secondary" data-assignment-close data-plan-close ${busy?'disabled':''}>닫기</button><button type="button" class="btn primary" data-assignment-apply data-plan-apply ${busy||!assignable.length||impact.exceedsLimit?'disabled':''}>${busy?'배정 저장 중…':`${impact.count}건 배정 확정`}</button></div></footer></section>`;
}

/** Apply errors keep the proposed allocation visible for review and retry. */
export function bindAssignmentPlan(root,{plan={},onApply,onClose,onOpenReservation,onSort}={}){
  const view=root?.matches?.('[data-assignment-plan]')?root:root?.querySelector?.('[data-assignment-plan]');
  if(!view)return;
  const apply=view.querySelector('[data-assignment-apply]'),errorBox=view.querySelector('[data-assignment-error]');
  const isBusy=()=>view.dataset.busy==='true';
  const activeRows=assignableRows(plan);
  const impact=assignmentPlanImpact(plan);
  const actions=[...view.querySelectorAll('button')];
  const previousDisabled=new Map(actions.map(button=>[button,button.disabled]));
  const setBusy=value=>{
    view.dataset.busy=String(value);view.setAttribute('aria-busy',String(value));
    for(const button of actions)button.disabled=value||previousDisabled.get(button);
    if(apply)apply.textContent=value?'배정 저장 중…':`${impact.count}건 배정 확정`;
  };
  view.querySelectorAll('[data-assignment-close]').forEach(button=>button.addEventListener('click',()=>{if(!isBusy())onClose?.();}));
  view.querySelectorAll('[data-ap-sort]').forEach(th=>th.addEventListener('click',()=>{if(!isBusy())onSort?.(th.dataset.apSort);}));
  view.querySelectorAll('[data-assignment-open]').forEach(button=>{
    if(typeof onOpenReservation!=='function'){button.disabled=true;previousDisabled.set(button,true);return;}
    button.addEventListener('click',()=>{if(!isBusy())onOpenReservation(button.dataset.assignmentOpen);});
  });
  apply?.addEventListener('click',async()=>{
    if(isBusy()||view.dataset.applied==='true'||!activeRows.length||impact.exceedsLimit)return;
    if(typeof onApply!=='function'){errorBox.textContent='배정 저장 연결을 확인한 뒤 다시 시도해 주세요.';errorBox.hidden=false;return;}
    errorBox.textContent='';errorBox.hidden=true;setBusy(true);
    try{await onApply(activeRows);if(view.isConnected)view.dataset.applied='true';}
    catch(error){if(view.isConnected){errorBox.textContent=error?.message||'배정을 저장하지 못했습니다. 조건을 확인한 뒤 다시 시도해 주세요.';errorBox.hidden=false;errorBox.scrollIntoView?.({block:'nearest',behavior:'smooth'});}}
    finally{if(view.isConnected){setBusy(false);if(view.dataset.applied==='true'&&apply){apply.disabled=true;apply.textContent='배정 적용 완료';}}}
  });
  const dialog=view.closest('dialog');
  dialog?.addEventListener('cancel',event=>{if(isBusy())event.preventDefault();});
}
