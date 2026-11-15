const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'});
const time=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const stamp=value=>Number.isFinite(Date.parse(value))?`${date.format(new Date(value))} ${time.format(new Date(value))}`:'일정 확인 필요';
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const period=(start,end)=>`${stamp(start)}${Number.isFinite(Date.parse(end))?`–${Number.isFinite(Date.parse(start))&&day.format(new Date(start))===day.format(new Date(end))?time.format(new Date(end)):stamp(end)}`:''}`;
const labels={pending:'검토 대기',approved:'승인 완료',rejected:'반려',cancelled:'고객 요청 취소',stale:'예약 변경됨 · 재요청 필요'};
export const canReviewCustomerChanges=profile=>profile?.role==='admin'&&profile.active===true&&!profile.must_change_password;
const isPassSchedule=row=>row?.requestKind==='pass_schedule';
export const customerRequestKey=row=>isPassSchedule(row)?`pass_schedule:${row.id}`:String(row?.id??'');
const statusLabel=row=>row.status==='stale'&&isPassSchedule(row)?'수강권 변경됨 · 재요청 필요':labels[row.status]||'상태 확인 필요';
const remainingLabel=row=>Number.isInteger(row.remainingSessions)&&row.remainingSessions>=0?`신청 가능한 잔여 ${row.remainingSessions}회`:'잔여 회차 확인 필요';
export function renderRequestResultNotification(row={}){
  if(!['approved','rejected'].includes(row.status))return '';
  const notice=row.resultNotification&&typeof row.resultNotification==='object'?row.resultNotification:{};
  const labels={not_required:'자동 알림 대상 아님',queued:'발송 대기',pending:'발송 대기',blocked:'발송 보류',preparing:'발송 준비 중',sending:'발송 요청 중',accepted:'솔라피 접수 · 도달 확인 중',delivered:'고객 도달 확인',failed:'발송 실패',uncertain:'발송 결과 미확인',skipped:'발송 제외'};
  const reasons={source_link_unavailable:'고객 확인 링크가 만료되거나 해제되어 발송하지 않았습니다.',request_superseded:'예약·수강권 정보가 변경되었거나 신청 일정이 지나 발송하지 않았습니다.',center_changed:'강습센터 변경으로 발송하지 않았습니다.',provider_not_connected:'솔라피 연결 상태를 확인해 주세요.',delivery_disabled:'자동 알림톡이 꺼져 있습니다.',template_missing:'사용할 결과 안내 템플릿을 설정해야 합니다.',template_not_approved:'결과 안내 템플릿의 카카오 승인이 필요합니다.',center_missing:'강습센터를 확인해 주세요.',missing_recipient:'고객 연락처를 확인해 주세요.',recipient_changed:'고객 연락처가 변경되어 발송을 보류했습니다.',customer_changed:'고객 정보가 변경되어 발송을 보류했습니다.',request_result_invalid:'일정 요청 결과를 확인해 주세요.',link_unavailable:'고객 확인 링크를 생성하지 못했습니다.',invalid_date:'요청 일정을 확인해 주세요.',configuration_changed:'알림톡 설정 변경으로 발송을 보류했습니다.',provider_unavailable:'솔라피 연결 상태를 확인해 주세요.'};
  const label=Object.hasOwn(labels,notice.status)?labels[notice.status]:'발송 상태 확인 필요';
  const reason=Object.hasOwn(reasons,notice.reason)?reasons[notice.reason]:'';
  return `<div><dt>결과 알림톡</dt><dd><strong>${label}</strong>${reason?`<br><span>${reason}</span>`:''}${notice.updatedAt&&Number.isFinite(Date.parse(notice.updatedAt))?` <small>${esc(stamp(notice.updatedAt))}</small>`:''}<br><small>고객 확인 링크에서도 처리 결과를 확인할 수 있습니다.</small></dd></div>`;
}
function renderPassDetails(row){
  const details=row.details&&typeof row.details==='object'?row.details:{};
  const lesson=[120,240].includes(details.lessonMinutes)?`${details.lessonMinutes/60}시간`:'확인 필요';
  const pause=[0,60,120].includes(details.breakMinutes)?details.breakMinutes?`중간 휴식 ${details.breakMinutes/60}시간`:'휴식 없음':'휴식 확인 필요';
  const age=['20s','30s','40s','50s','60s'].includes(details.ageBand)?`성인 ${details.ageBand.slice(0,2)}대`:Number.isInteger(details.age)&&details.age>=0?`${details.age}세`:'미확인';
  const count=Number.isInteger(details.studentCount)&&details.studentCount>0?`${details.studentCount}명`:'확인 필요';
  const experience=Number.isInteger(details.experienceCount)&&details.experienceCount>=0?`${details.experienceCount}회`:'미확인';
  const board=row.sport==='보드',skill=board?details.snowboardNoviceTurn:details.parallelLongTurn;
  return `<section class="ccr-pass-details" aria-label="수강권 신청 강습 정보"><h3>신청 강습 정보</h3><dl><div><dt>강습 구성</dt><dd>${lesson} · ${pause}</dd></div><div><dt>강습생</dt><dd>${count} · ${age}</dd></div><div><dt>강습 경험</dt><dd>${experience}</dd></div><div><dt>${board?'S자 너비스턴':'패러렐 롱턴'}</dt><dd>${skill===true?'가능':skill===false?'불가능':'미확인'}</dd></div><div><dt>주니어 기술등급제</dt><dd>${details.juniorPreparation===true?'준비':details.juniorPreparation===false?'준비 안 함':'미확인'}</dd></div></dl></section>`;
}
function renderTeacherAvailability(row){
  const people=Array.isArray(row.currentInstructors)?row.currentInstructors.filter(person=>person&&typeof person==='object'):[];
  const proposed=Array.isArray(row.proposedInstructors)?row.proposedInstructors.filter(person=>person&&typeof person==='object'):[];
  const states={available:['기존 강사 유지 가능','가능'],unavailable:['기존 강사 유지 불가','불가'],unassigned:['기존 배정 강사 없음','신규 배정'],unknown:['기존 강사 유지 여부 확인 필요','확인 필요']};
  const status=Object.hasOwn(states,row.sameInstructorStatus)?row.sameInstructorStatus:row.canKeepCurrentInstructors===true?'available':row.canKeepCurrentInstructors===false?'unavailable':'unknown';
  const [title,badge]=states[status];
  const fallback={available:'희망 일정에도 기존·고정 강사로 진행할 수 있습니다.',unavailable:'희망 일정에는 기존·고정 강사 배정을 유지할 수 없습니다. 아래 사유와 배정 예정 강사를 확인해 주세요.',unassigned:'기존·고정 강사가 없어 희망 일정에 맞는 강사를 새로 배정합니다.',unknown:'새로고침하여 기존·고정 강사의 배정 가능 여부를 다시 확인해 주세요.'};
  return `<section class="ccr-teachers ccr-teachers-${status}" aria-label="기존 강사 유지 여부"><header><h3>${title}</h3><span class="ccr-teacher-badge">${badge}</span></header><p class="ccr-teacher-summary">${esc(row.sameInstructorMessage||fallback[status])}</p>${people.length?`<ul class="ccr-teacher-list">${people.map(person=>`<li><div><strong>${esc(person.name||'강사 확인 필요')}</strong><span>${person.canKeep===true?'유지 가능':person.canKeep===false?'유지 불가':'확인 필요'}</span></div>${person.reason?`<p>${esc(person.reason)}</p>`:''}</li>`).join('')}</ul>`:''}<div class="ccr-proposed-teachers"><span>승인 시 배정 예정</span><strong>${row.canApprove===true?esc(proposed.map(person=>person.name||'강사 확인 필요').join(' · ')||'승인 시 다시 확인'):'현재 배정 확정 불가'}</strong></div><small>승인하는 시점에 강사 일정과 배정 조건을 다시 확인합니다.</small></section>`;
}

export function renderCustomerChanges({profile,requests=[],status='pending',loading=false,error='',notes={},busy=false}={}){
  if(!canReviewCustomerChanges(profile))return '<section class="panel ccr-empty"><h2>관리자 전용 메뉴입니다.</h2><p>예약 변경과 수강권 새 일정 신청은 관리자가 검토합니다.</p></section>';
  const rows=Array.isArray(requests)?requests:[];
  return `<section class="ccr-page"><header class="ccr-heading"><div><span class="ccr-eyebrow">CUSTOMER REQUESTS</span><h1>고객 일정 요청</h1><p>예약 변경과 수강권 새 일정 신청을 한곳에서 검토하세요.</p></div><button type="button" class="btn secondary" data-ccr-refresh ${loading||busy?'disabled':''}>${loading?'확인 중…':'새로고침'}</button></header><div class="ccr-policy"><strong>기존 예약은 승인 전까지 유지되며, 수강권 새 일정은 승인 시에만 등록됩니다.</strong><span>변경 요청은 강습 시작 7일 전까지 접수됩니다. 수강권 새 일정 신청은 신청 가능한 잔여 회차를 사용하며, 요청 중에는 잔여 회차가 줄지 않습니다. 요청한 시간은 선점되지 않으며, 승인 시 강사 일정과 배정 조건을 다시 확인합니다.</span></div><div class="ccr-toolbar"><div role="group" aria-label="고객 일정 요청 상태">${[['pending','검토 대기'],['all','전체 이력']].map(([value,label])=>`<button type="button" class="btn ${status===value?'primary':'secondary'} small" data-ccr-filter="${value}" aria-pressed="${status===value}" ${busy?'disabled':''}>${label}</button>`).join('')}</div><span>${rows.length}건${rows.length>=100?' · 최근 100건 표시':''}</span></div>${error?`<p class="ccr-error" role="alert">${esc(error)}</p>`:''}${loading?'<p class="ccr-loading" role="status">최신 변경 요청과 배정 가능 여부를 확인하고 있습니다.</p>':''}<div class="ccr-list">${rows.map(row=>{
    const pending=row.status==='pending',passSchedule=isPassSchedule(row),key=customerRequestKey(row),id=esc(key),note=notes[key]??'';
    return `<article class="panel ccr-card" data-ccr-card="${id}"><header><div><span class="ccr-kind ${passSchedule?'ccr-kind-pass':'ccr-kind-change'}">${passSchedule?'수강권 새 일정 신청':'예약 변경 요청'}</span><span class="ccr-customer">${esc(row.customerName||'고객')} <small>${esc(row.phone||'연락처 미등록')}</small></span><h2>${esc(row.teamLabel||'기본 1팀')} <small>${esc(row.sport||'강습')} · ${esc(row.company||'장소 확인 필요')}</small></h2></div><span class="ccr-status ccr-${esc(row.status)}">${esc(statusLabel(row))}</span></header><div class="ccr-comparison"><div><span>${passSchedule?'미정 수강권':'기존 예약'}</span><strong>${passSchedule?esc(remainingLabel(row)):esc(period(row.originalStartAt||row.currentStartAt,row.originalEndAt||row.currentEndAt))}</strong>${passSchedule?'<small>승인 전에는 회차를 차감하지 않습니다.</small>':''}</div><span class="ccr-arrow" aria-hidden="true">→</span><div class="ccr-requested"><span>${passSchedule?'새 일정 희망':'변경 희망'}</span><strong>${esc(period(row.requestedStartAt,row.requestedEndAt))}</strong></div></div>${passSchedule?renderPassDetails(row):''}${pending?renderTeacherAvailability(row):''}<dl class="ccr-details"><div><dt>요청 사유</dt><dd>${esc(row.reason||'입력하지 않음')}</dd></div><div><dt>접수 시각</dt><dd>${esc(stamp(row.createdAt))}</dd></div>${pending?(row.canApprove===true?'':`<div><dt>승인 제한</dt><dd class="ccr-blocked">${esc(row.blockedReason||'현재 배정 조건을 다시 확인해 주세요.')}</dd></div>`):`<div><dt>검토 결과</dt><dd>${esc(row.reviewNote||statusLabel(row)||'—')}${row.reviewedAt?` <small>${esc(stamp(row.reviewedAt))}</small>`:''}</dd></div>`}${renderRequestResultNotification(row)}</dl>${pending?`<form data-ccr-form="${id}"><label class="field"><span class="field-label">고객에게 표시할 검토 내용 <small>반려 시 필수</small></span><textarea name="reviewNote" data-ccr-note="${id}" rows="2" maxlength="1000" placeholder="승인 안내 또는 변경이 어려운 사유를 입력해 주세요." ${busy?'disabled':''}>${esc(note)}</textarea></label><div class="ccr-actions"><button type="button" class="btn secondary" data-ccr-reject="${id}" ${busy||loading?'disabled':''}>반려</button><button type="button" class="btn primary" data-ccr-approve="${id}" ${busy||loading||row.canApprove!==true?'disabled':''}>${passSchedule?'새 일정 승인':'일정 변경 승인'}</button></div><p class="ccr-row-error" role="alert" hidden></p></form>`:''}</article>`;
  }).join('')||(!loading&&!error?`<section class="panel ccr-empty"><h2>${status==='pending'?'검토를 기다리는 요청이 없습니다.':'아직 접수된 변경 요청이 없습니다.'}</h2><p>고객이 예약확인 링크에서 변경을 요청하거나 수강권 링크에서 새 일정을 신청하면 이곳에 표시됩니다.</p></section>`:'')}</div></section>`;
}

export function bindCustomerChanges(root,{profile,requests=[],notes={},onFilter,onRefresh,onReview,isCurrent=()=>true}={}){
  if(!canReviewCustomerChanges(profile))return;
  let saving=false;
  const current=()=>isCurrent()&&canReviewCustomerChanges(profile);
  root.querySelectorAll('[data-ccr-filter]').forEach(button=>button.addEventListener('click',()=>{if(!saving&&!button.disabled&&current())onFilter?.(button.dataset.ccrFilter);}));
  root.querySelector('[data-ccr-refresh]')?.addEventListener('click',event=>{if(!saving&&!event.currentTarget.disabled&&current())onRefresh?.();});
  root.querySelectorAll('[data-ccr-note]').forEach(input=>input.addEventListener('input',()=>{if(current())notes[input.dataset.ccrNote]=input.value;}));
  root.querySelectorAll('[data-ccr-form]').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
  for(const decision of ['approved','rejected']){
    const key=decision==='approved'?'ccrApprove':'ccrReject';
    root.querySelectorAll(decision==='approved'?'[data-ccr-approve]':'[data-ccr-reject]').forEach(button=>button.addEventListener('click',async()=>{
      if(saving||button.disabled||!current())return;
      const request=requests.find(row=>customerRequestKey(row)===button.dataset[key]);
      if(!request||request.status!=='pending'||decision==='approved'&&request.canApprove!==true)return;
      const requestKey=customerRequestKey(request),form=button.closest('[data-ccr-form]'),note=form?.querySelector('textarea'),error=form?.querySelector('.ccr-row-error');
      const value=String(note?.value??notes[requestKey]??'').trim();
      if(error){error.hidden=true;error.textContent='';}
      if(decision==='rejected'&&!value){if(error){error.textContent='고객에게 안내할 반려 사유를 입력해 주세요.';error.hidden=false;}note?.focus();return;}
      if(value.length>1000){if(error){error.textContent='검토 내용은 1,000자 이하로 입력해 주세요.';error.hidden=false;}return;}
      notes[requestKey]=value;saving=true;
      const controls=[...root.querySelectorAll('button, textarea')],previous=controls.map(control=>control.disabled);
      controls.forEach(control=>{control.disabled=true;});
      try{
        const result=await onReview?.(request,decision,value);
        if(!current()||result?.discarded)return;
        if(result?.ok===false&&error){error.textContent=result.message||'예약 정보가 변경되었습니다. 최신 요청을 다시 확인해 주세요.';error.hidden=false;}
      }catch(issue){if(current()&&error){error.textContent=issue.message||'변경 요청을 처리하지 못했습니다. 새로고침 후 다시 확인해 주세요.';error.hidden=false;}}
      finally{saving=false;controls.forEach((control,index)=>{control.disabled=previous[index];});}
    }));
  }
}
