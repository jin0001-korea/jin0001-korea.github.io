import {activeNoticeReservationIds,selectActiveCustomerNotices} from './customer-notice-filter.mjs?v=1';
import {directoryDisplayNames} from './customer-teams.mjs?v=28';
import {parseLessonInterval,normalizeInstructorIds} from './booking-rules.mjs?v=36';
import {bookingStaffLinks} from './booking-access.mjs?v=27';
import {CUSTOMER_PORTAL} from './customer-links.mjs?v=17';
export {CUSTOMER_PORTAL};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'});
const changePolicy='링크에서 예약 변경을 요청할 수 있습니다. 기존 강습과 희망 강습 시작까지 모두 7일 이상 남아 있어야 하며, 관리자 승인 후 변경이 확정됩니다.';
const clock=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const confirmationNotice='신청하신 종목(스키·보드), 강습 구성, 날짜·시간이 맞는지 꼭 확인해 주세요.';
// 수동 복사·발송될 수 있는 안내문이므로 머리글은 SLOPE 가 아니라 브랜드명으로(2026-11-21 사용자 확인).
const brandOf=value=>{const text=String(value||'');return text.includes('캐치')?'캐치':text.includes('라이즌')?'라이즌':text.includes('코코넛')?'코코넛렌탈샵':'곤지암 스키스쿨';};
function compositionLabel(row){
 const raw=String(row.raw?.M??'').trim(),students=/^[0-9]{1,4}$/.test(raw)?Number(raw):0,teachers=normalizeInstructorIds(row).length;
 if(students<1||students>1000)return '강습 구성 확인 필요';
 return teachers?`${teachers}:${students} (강사 ${teachers}명 · 강습생 ${students}명)`:`강습생 ${students}명 · 강사 배정 예정`;
}
export function customerNoticeMessage(notice,context={},url=''){
  const ids=new Set(notice.subjectIds||[]);
  if(notice.kind==='pass'){
    const passes=(context.lessonPasses||[]).filter(row=>ids.has(row.id));
    // 디렉터리 연결 수강권은 최신 고객·팀 이름으로 안내한다(2026-11-20).
    return [`[${brandOf(passes[0]?.company)} 수강권 등록 안내]`,...passes.map(row=>{const d=directoryDisplayNames({customerId:row.customer_id??row.customerId,customerTeamId:row.customer_team_id??row.customerTeamId},context);return `${d.customerName||row.customer_name||row.customerName||'고객'}님 · ${(d.teamName!==null&&d.teamName!==''?d.teamName:'')||row.learner_name||row.learnerName||'기본 팀'}\n${row.sport||'강습'} ${row.total_sessions??row.totalSessions}회 수강권\n날짜·시간은 추후 예약할 수 있습니다.`;}),'날짜 미정인 잔여 회차도 링크에서 새 일정을 신청할 수 있습니다. 희망 강습 시작까지 7일 이상 남은 일정을 선택해 주세요. 신규 예약은 관리자 승인 후 확정됩니다. 날짜가 정해진 회차는 '+changePolicy,url?`수강권 상태 확인: ${url}`:'수강권 상태 확인 링크를 생성해 주세요.'].join('\n\n');
  }
  const active=activeNoticeReservationIds(context);
  const rows=(context.reservations||[]).filter(row=>ids.has(row.id)&&active.has(row.id)).sort((a,b)=>Date.parse(parseLessonInterval(a).start)-Date.parse(parseLessonInterval(b).start));
  if(!rows.length)return '';
  return [`[${brandOf(rows[0]?.raw?.E||rows[0]?.company)} 예약 접수 안내]`,...rows.slice(0,3).map(row=>{const raw=row.raw||{},interval=parseLessonInterval(row);const time=interval.error?'일정 확인 필요':`${date.format(new Date(interval.start))}\n${clock.format(new Date(interval.start))}–${date.format(new Date(interval.start))!==date.format(new Date(interval.end))?'다음 날 ':''}${clock.format(new Date(interval.end))}${interval.breakMinutes?` · 중간 ${interval.breakMinutes/60}시간 휴식`:''}`;const d=directoryDisplayNames(row,context);return `${d.customerName||raw.H||'고객'}님 · ${(d.teamName!==null&&d.teamName!==''?d.teamName:'')||raw.I||'기본 팀'}\n${time}\n${raw.E||'장소 확인 필요'} · ${raw.D||'종목 확인 필요'}\n강습 구성: ${compositionLabel(row)}\n담당 강사: ${raw.F&&raw.F!=='미배정'?raw.F:'배정 후 안내'}`;}),...(rows.length>3?[`외 ${rows.length-3}건 · 전체 ${rows.length}건의 일정은 아래 링크에서 확인해 주세요.`]:[]),confirmationNotice,changePolicy,url?`예약 내용 확인: ${url}`:'예약 확인 링크를 생성해 주세요.'].join('\n\n');
}
export function demoCustomerNotices(context={}){
  const active=activeNoticeReservationIds(context);
  return [...(context.reservations||[]).filter(row=>active.has(row.id)).slice(0,3).map(row=>({id:`demo-${row.id}`,kind:'reservation',subjectIds:[row.id],recipient:row.raw?.L||'',status:'provider_not_connected'})),...(context.lessonPasses||[]).slice(0,2).map(row=>({id:`demo-${row.id}`,kind:'pass',subjectIds:[row.id],recipient:row.phone||'',status:'provider_not_connected'}))];
}
const deliveryLabels={pending:'발송 대기',processing:'발송 처리 중',accepted:'솔라피 접수 · 전달 확인 중',delivered:'전달 완료',uncertain:'발송 결과 확인 필요',failed:'발송 실패',held:'설정·예약 확인 필요',cancelled:'발송 제외',partial:'일부 처리 완료'};
let noticePane='customer'; // 고객/강사 서브탭 선택(세션 내 유지)
const deliveryReasons={center_missing:'강습센터 확인 필요',center_changed:'강습센터 변경됨',missing_recipient:'고객 연락처 확인 필요',recipient_changed:'고객 연락처 변경됨',customer_changed:'고객 정보 변경됨',template_missing:'승인된 안내문 연결 필요',template_not_approved:'안내문 승인 확인 필요',instructor_missing:'담당 강사 확인 필요',booking_changed:'예약 정보 변경됨',configuration_changed:'발송 설정 변경됨',report_link_invalid:'보고서 링크 확인 필요',provider_unavailable:'솔라피 연결 확인 필요',send_result_unknown:'중복 발송을 막기 위해 자동 재발송하지 않습니다.',delivery_failed:'솔라피에서 전달 실패로 확인됨',provider_rejected:'솔라피에서 발송 거절됨',activation_reset:'자동 발송 재시작 이전 안내',cancelled:'취소된 예약',missing_record:'예약을 찾을 수 없음',worker_busy:'다음 발송 순서 대기'};
function deliveryInfo(notice,demo){
  if(demo)return {label:'가상 안내',detail:''};
  const delivery=notice.delivery;
  if(!delivery)return {label:notice.status==='missing_recipient'?'연락처 확인 필요':'자동 발송 이력 없음',detail:'자동 발송을 시작하기 전 안내는 소급 발송하지 않습니다.'};
  const counts=Object.entries(delivery.counts||{}).filter(([key,value])=>deliveryLabels[key]&&Number.isSafeInteger(value)&&value>0).map(([key,value])=>`${deliveryLabels[key]} ${value}건`).join(' · ');
  const reasons=[...new Set((Array.isArray(delivery.reasons)?delivery.reasons:[]).map(reason=>deliveryReasons[reason]||'발송 설정에서 확인해 주세요.'))].join(' ');
  return {label:deliveryLabels[delivery.status]||'발송 상태 확인 필요',detail:[counts,reasons].filter(Boolean).join(' / ')};
}
export function renderCustomerNotices({state={},demo=false,profile=state.profile,settingsHref=bookingStaffLinks().settings}={}){
  const canConfigure=profile?.role==='admin'&&profile.active===true&&!profile.must_change_password;
  const notices=selectActiveCustomerNotices(demo?demoCustomerNotices(state):state.customerNotices||[],state);
  // 강사 안내(2026-11-27): 프리랜서 강사배정 알림톡 발송내역을 고객 안내와 구별해 함께 보여준다.
  const instructorNotices=Array.isArray(state.instructorNotices)?state.instructorNotices:[];
  const instrStatus={delivered:'전달 완료',accepted:'솔라피 접수',pending:'발송 대기',preparing:'발송 준비 중',sending:'발송 중',blocked:'보류 · 확인 필요',failed:'발송 실패',uncertain:'결과 미확인',skipped:'묶음 생략'};
  const instrReason=r=>r==='grouped_same_instructor'?'같은 강사 다건 배정 — 알림톡 1건으로 묶음(링크에서 전체 일정 확인)':r==='template_missing'?'안내문(버튼형 v2) 승인 대기 — 승인 후 자동 발송':(deliveryReasons[r]||r||'');
  const kstDT=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t)):'';};
  const instructorSection=`<section class="cn-instructor"><p class="cn-pane-desc" style="margin:2px 0 12px;color:#6b7b72;font-size:13px;">프리랜서 강사에게 나간 강습 배정 알림톡입니다. 내용은 "강습이 배정되었습니다 + 본인 일정확인 링크" 고정 양식이며, 고객 연락처는 담기지 않습니다.</p><div class="cn-list">${instructorNotices.map(n=>`<article class="panel cn-card"><header><strong>강사 배정 안내 · ${esc(n.instructorName||'강사')}</strong><span>${esc(instrStatus[n.status]||n.status||'')}</span></header>${n.reason?`<p class="cn-delivery-detail">${esc(instrReason(n.reason))}</p>`:''}<p class="cn-recipient">받는 번호 ${esc(n.recipient||'미등록')} · 대상 강습 ${esc(kstDT(n.startAt))} · ${esc(n.customerLabel||'')} ${esc(n.teamLabel||'')}</p><pre>${esc((n.instructorName||'강사')+' 강사님, 강습이 배정되었습니다.\n[내 강습 일정 보기] 버튼 → 배정된 전체 일정 확인 (발송 시점에 새 링크 발급)')}</pre></article>`).join('')||'<div class="panel cn-empty"><strong>아직 강사 안내 발송 기록이 없습니다.</strong><p>프리랜서 강사를 강습에 배정하면 자동으로 발송되고 이곳에 기록됩니다.</p></div>'}</div></section>`;
  // 서브탭(2026-11-27 사용자 지시): 고객/강사 알림톡을 한 화면에 쌓지 않고 버튼으로 전환해 본다.
  // 선택값은 모듈 변수로 유지 — 전체 화면 재렌더(데이터 새로고침) 후에도 보던 탭이 유지된다.
  const pane=noticePane==='instructor'?'instructor':'customer';
  const paneBtn=(id,label,count)=>`<button type="button" class="btn ${pane===id?'primary':'secondary'} small" data-cn-pane-btn="${id}" aria-pressed="${pane===id}">${label} <span style="opacity:.75;">${count}</span></button>`;
  return `<section class="cn-page"><header><span class="cn-eyebrow">CUSTOMER MESSAGES</span><h1>고객·강사 안내</h1><p>예약·수강권 안내(고객)와 강습 배정 안내(강사)를 구별해 확인하세요.</p></header><div class="cn-pane-nav" style="display:flex;gap:8px;margin:0 0 14px;">${paneBtn('customer','고객 알림톡',notices.length)}${paneBtn('instructor','강사 알림톡',instructorNotices.length)}</div><div data-cn-pane="customer" ${pane==='customer'?'':'hidden'}><div class="cn-connection"><strong>알림톡 발송 현황</strong><p>예약·수강권 안내가 고객에게 전달되었는지 확인하세요. 발송 채널과 안내문 설정은 관리자가 관리합니다.</p>${canConfigure?`<a class="btn secondary small" href="${esc(settingsHref)}">알림톡 연동 설정</a>`:''} <a href="${CUSTOMER_PORTAL}/survey.html?demo=survey" target="_blank" rel="noopener noreferrer">고객 설문 화면 미리 보기 ↗</a></div><div class="cn-list">${notices.map(notice=>`<article class="panel cn-card"><header><strong>${notice.kind==='pass'?'수강권 등록 안내':'예약 접수 안내'}${notice.subjectIds?.length>1?` · ${notice.subjectIds.length}건 함께`:''}</strong><span>${esc(deliveryInfo(notice,demo).label)}</span></header><p class="cn-delivery-detail">${esc(deliveryInfo(notice,demo).detail)}</p><p class="cn-recipient">받는 번호 ${esc(notice.recipient||'미등록')}</p><pre>${esc(customerNoticeMessage(notice,state))}</pre><button type="button" class="btn secondary" data-customer-notice="${esc(notice.id)}">확인 링크·안내문 만들기</button><p class="cn-error" role="alert" hidden></p></article>`).join('')||'<div class="panel cn-empty"><strong>아직 생성된 고객 안내가 없습니다.</strong><p>새 예약을 저장하거나 날짜 미정 수강권을 발급하면 자동으로 이곳에 준비됩니다.</p></div>'}</div></div><div data-cn-pane="instructor" ${pane==='instructor'?'':'hidden'}>${instructorSection}</div></section>`;
}
export function bindCustomerNotices(root,{state={},demo=false,onCreateLink}={}){
  root.querySelectorAll('[data-cn-pane-btn]').forEach(button=>button.addEventListener('click',()=>{
    noticePane=button.dataset.cnPaneBtn==='instructor'?'instructor':'customer';
    root.querySelectorAll('[data-cn-pane]').forEach(panel=>{panel.hidden=panel.dataset.cnPane!==noticePane;});
    root.querySelectorAll('[data-cn-pane-btn]').forEach(other=>{const on=other.dataset.cnPaneBtn===noticePane;other.classList.toggle('primary',on);other.classList.toggle('secondary',!on);other.setAttribute('aria-pressed',String(on));});
  }));
  root.querySelectorAll('[data-customer-notice]').forEach(button=>button.addEventListener('click',async()=>{
    const notice=selectActiveCustomerNotices(demo?demoCustomerNotices(state):state.customerNotices||[],state).find(row=>row.id===button.dataset.customerNotice);if(!notice||button.disabled)return;
    const error=button.closest('.cn-card').querySelector('.cn-error');error.hidden=true;button.disabled=true;
    try{await onCreateLink(notice.kind,notice.subjectIds,notice);}catch(issue){error.textContent=issue.message||'고객 링크를 만들지 못했습니다.';error.hidden=false;}finally{button.disabled=false;}
  }));
}
