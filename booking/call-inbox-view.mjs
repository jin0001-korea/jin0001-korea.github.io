import {isDeletedCustomer} from './customer-delete.mjs?v=2';
import {canonicalTelephone,formatTelephone} from './customer-teams.mjs?v=27';
import {CALL_TASKER_SETUP_STEPS,CALL_TASKER_SETUP_LIMITATION} from './call-tasker-setup.mjs?v=14';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const WORKFLOW={new:'새 문의',in_progress:'상담 중',callback:'재연락 예정',closed:'처리 완료'};
const RESULTS={answered:'응답',outgoing:'발신',missed:'부재중',rejected:'거절',blocked:'차단'};
const canUse=profile=>profile?.active===true&&!profile.must_change_password&&['admin','counselor'].includes(profile.role);
const admin=profile=>canUse(profile)&&profile.role==='admin';
const localDateTime=value=>{
  if(!value||!Number.isFinite(new Date(value).getTime()))return '';
  return new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,16);
};
const stamp=value=>{
  if(!value||!Number.isFinite(new Date(value).getTime()))return '—';
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
};
const duration=value=>{const seconds=Math.max(0,Number(value)||0);return seconds>=60?`${Math.floor(seconds/60)}분${seconds%60?` ${seconds%60}초`:''}`:`${seconds}초`;};
const phoneLabel=value=>formatTelephone(value)||'발신번호 미표시';
const stateOf=ui=>{
  const defaults={mode:'all',sourceId:'',workflowStatus:'',query:'',from:'',to:'',offset:0,limit:100,detailId:null,detail:null,draft:null,baseline:null,detailRequest:0,detailLoading:false,saving:false,sourceBusy:null,sourceDrafts:{},error:'',history:{open:false,sourceId:'',from:'2026-10-01',to:'',busy:false,error:'',file:null,result:null}};
  const state=ui.callInbox??={};
  for(const [key,value] of Object.entries(defaults))if(state[key]===undefined)state[key]=value;
  return state;
};
const draftFor=call=>({workflowStatus:WORKFLOW[call?.workflowStatus]?call.workflowStatus:'new',callbackAt:localDateTime(call?.callbackAt),note:''});
const sameDraft=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
const allowedSources=(profile,data)=>list(data?.sources).filter(source=>admin(profile)||source.visibility==='staff');
const option=(value,label,current)=>`<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`;
const disabled=value=>value?'disabled':'';

export function hasUnsavedCallDraft(ui={}){
  const u=ui.callInbox;
  return !!u&&(!!u.saving||!!u.sourceBusy||!!u.draft&&!sameDraft(u.draft,u.baseline)||Object.values(u.sourceDrafts||{}).some(row=>row.visibility!==row.baselineVisibility||row.enabled!==row.baselineEnabled));
}
export function matchingCallCustomers(phone,customers=[],customerTeams=[]){
  const normalized=canonicalTelephone(phone);if(!normalized)return [];
  // 팀 별도 연락처(teamPhoneMode=separate)로 걸려온 전화도 그 고객에게 연결한다(2026-11-20).
  const teamPhoneCustomerIds=new Set(list(customerTeams).filter(team=>canonicalTelephone(team?.phone)===normalized).map(team=>team?.customer_id??team?.customerId).filter(Boolean));
  const seen=new Set();
  return list(customers).filter(customer=>{
    if(!customer?.id||isDeletedCustomer(customer)||seen.has(customer.id))return false;
    const matches=list(customer.contacts).some(contact=>canonicalTelephone(contact?.phone)===normalized)||teamPhoneCustomerIds.has(customer.id);
    if(matches)seen.add(customer.id);return matches;
  });
}
export function callSourceConnection(source={}){
  if(source.enabled===false)return {label:'수신 중지',tone:'muted'};
  if(!source.hasKey)return {label:'연결 전',tone:'muted'};
  if(!source.lastSeenAt)return {label:'수신 대기',tone:'waiting'};
  return {label:'서버 연결됨',tone:'good'};
}

function customerMarkup(call,customers,customerTeams){
  const matches=matchingCallCustomers(call.phone,customers,customerTeams);
  return matches.length===1?`<strong>${esc(matches[0].name||'이름 없는 고객')}</strong><small class="ci-registered">등록고객</small>`:matches.length>1?`<strong>같은 번호의 고객 ${matches.length}명</strong><small>상담 후 고객을 선택하세요</small>`:'<strong>새 문의</strong><small>고객 등록 전</small>';
}
// 통화 차수(2026-11-20 사용자 지시): 이 번호의 몇 번째 통화인지 — 서버 inbox-list 가 동봉.
function callSequenceLabel(call){
  const seq=Number(call?.phoneSequence);
  if(!Number.isInteger(seq)||seq<1)return '';
  const total=Number(call?.phoneTotal);
  return (seq===1?'첫 문의':`${seq}번째 통화`)+(Number.isInteger(total)&&total>1?` · 총 ${total}회`:'');
}
function sourceCards(profile,sources,u,busy){
  if(!sources.length)return '';
  return `<div class="ci-source-cards">${sources.map(source=>{
    const connection=callSourceConnection(source);
    return `<button type="button" class="ci-source-card ${u.sourceId===source.id?'selected':''}" data-ci-source="${esc(source.id)}" aria-pressed="${u.sourceId===source.id}" ${disabled(busy)}><span class="ci-source-card-heading"><strong>${esc(source.label)}</strong><span class="ci-badge ci-${connection.tone}">${connection.label}</span></span><span>${esc(source.deviceModel||'휴대폰 정보 미등록')}</span><small>${source.lastSeenAt?`최근 동기화 ${esc(stamp(source.lastSeenAt))}`:'휴대폰 설정 후 테스트 전화로 확인하세요'}${admin(profile)?` · ${source.visibility==='staff'?'상담사 공유':'사장님만'}`:''}</small></button>`;
  }).join('')}</div>`;
}
function sourceSettings(profile,sources,u,busy){
  if(!admin(profile)||!sources.length)return '';
  return `<details class="ci-source-settings" ${u.settingsOpen?'open':''} data-ci-settings><summary>휴대폰 연결 · 공개 범위</summary><div class="ci-source-settings-intro"><p>각 휴대폰에 Tasker와 연결 설정을 설치합니다. 전화·문자 권한과 백그라운드 실행을 허용한 뒤 통화와 문자 수신을 확인하세요.</p><p>처음에는 사장님만 볼 수 있습니다. 상담사가 기록을 함께 관리하려면 <strong>상담사 공유</strong>로 저장하세요.</p><details class="ci-setup-help" ${u.setupHelpOpen?'open':''} data-ci-setup-help><summary>설치 순서</summary><div><a class="ci-install-link" href="https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm" target="_blank" rel="noopener noreferrer">Google Play에서 공식 Tasker 설치 ↗</a><ol>${CALL_TASKER_SETUP_STEPS.map(step=>`<li>${esc(step)}</li>`).join('')}</ol><p>${esc(CALL_TASKER_SETUP_LIMITATION)}</p></div></details></div><div class="ci-source-forms">${sources.map(source=>{
    const draft=u.sourceDrafts?.[source.id],visibility=draft?.visibility??source.visibility,enabled=draft?.enabled??source.enabled;
    return `<section class="ci-source-setting" data-ci-source-setting="${esc(source.id)}"><header><strong>${esc(source.label)}</strong><small>${esc(source.deviceModel||'휴대폰 정보 미등록')}</small></header><form data-ci-source-form="${esc(source.id)}"><label class="field"><span class="field-label">상담 기록 공개</span><select name="visibility" ${disabled(busy)}>${option('admin','사장님만',visibility)}${option('staff','상담사 공유',visibility)}</select></label><label class="ci-check"><input name="enabled" type="checkbox" ${enabled!==false?'checked':''} ${disabled(busy)}>자동 수신 사용</label><button type="submit" class="btn secondary small" ${disabled(busy)}>설정 저장</button></form><div class="ci-source-actions"><button type="button" class="btn primary small" data-ci-source-key="${esc(source.id)}" ${disabled(busy||source.enabled===false)}>${source.hasKey?'연결파일 다시 만들기':'휴대폰 연결파일 만들기'}</button>${source.hasKey?`<button type="button" class="btn ghost small" data-ci-source-revoke="${esc(source.id)}" ${disabled(busy)}>휴대폰 연결 해제</button>`:''}</div><p class="ci-source-help">연결파일에는 이 휴대폰의 수신 전용 키가 포함됩니다. 해당 휴대폰에서만 사용하세요.${source.hasKey?' 다시 만들면 이전 연결파일의 키는 사용할 수 없습니다.':''}</p>${source.collectFrom?`<p class="ci-source-help">수집 시작: ${esc(stamp(source.collectFrom))} 이후 통화·문자</p>`:''}</section>`;
  }).join('')}</div><section class="ci-source-settings-intro"><strong>채팅+ v11 업데이트</strong><p>v10을 사용 중이면 기존 연결파일을 선택해 채팅+ 작업만 업데이트하세요. 연결키와 이전 수집 기록을 유지하며 발신 사진 크기 검증과 대화 상대 확인을 보완합니다.</p><a class="btn secondary small" href="./rcs-update.html" target="_blank" rel="noopener noreferrer" data-ci-rcs-update>기존 연결파일로 v11 업데이트</a></section><section class="ci-source-settings-intro"><strong>MMS 오류 진단</strong><p>기존 연결파일은 그대로 두고 진단 프로젝트만 추가하세요. 최근 7일의 주소 형식만 확인하며, 전화번호·문자 본문·사진은 결과에 포함하지 않습니다. 실행하면 진단 결과가 클립보드에 복사됩니다.</p><a class="btn secondary small" href="./SLOPE-MMS-address-diagnostic.prj.xml" download="SLOPE-MMS-address-diagnostic.prj.xml" data-ci-mms-diagnostic>MMS 진단 파일 받기</a></section><section class="ci-source-settings-intro"><strong>채팅+ 자동 수집 진단</strong><p>일반 문자는 들어오는데 채팅+가 빠지면, 해당 휴대폰의 채팅 저장소 접근을 확인합니다. 원인 확인용이며 실행만으로 자동 수집을 시작하지 않습니다.</p><a class="btn secondary small" href="./rcs-diagnostic.html" target="_blank" rel="noopener noreferrer" data-ci-rcs-diagnostic>채팅+ 진단 안내 열기</a><p>자동 수집 실행 후 미완료·실패가 남으면, 기존 연결을 유지한 채 원인만 확인할 수 있습니다.</p><a class="btn secondary small" href="./rcs-pending-diagnostic.html" target="_blank" rel="noopener noreferrer" data-ci-rcs-pending-diagnostic>채팅+ 미완료 확인</a></section></details>`;
}
function detailMarkup(profile,sources,u,customers,busy,customerTeams){
  if(!u.detailId)return '<aside class="ci-detail ci-detail-empty"><strong>전화를 선택하면 상담을 이어갈 수 있습니다.</strong><p>상담 메모와 재연락 일정을 같은 기록에 남기세요.</p></aside>';
  if(u.detailLoading)return '<aside class="ci-detail" data-ci-detail tabindex="-1"><header class="ci-detail-head"><p role="status">상담 기록을 불러오고 있습니다.</p><button type="button" class="ci-close" data-ci-detail-close aria-label="상담 상세 닫기">×</button></header></aside>';
  const call=u.detail?.call;
  if(!call||call.id!==u.detailId||!sources.some(source=>source.id===call.sourceId))return `<aside class="ci-detail" data-ci-detail tabindex="-1"><header class="ci-detail-head"><p>선택한 상담 기록을 확인할 수 없습니다.</p><button type="button" class="ci-close" data-ci-detail-close aria-label="상담 상세 닫기" ${disabled(busy)}>×</button></header><button type="button" class="btn secondary small" data-ci-detail-retry ${disabled(busy)}>다시 불러오기</button></aside>`;
  const draft=u.draft||draftFor(call),matches=matchingCallCustomers(call.phone,customers,customerTeams),currentCustomerId=matches.some(customer=>customer.id===u.customerId)?u.customerId:(matches.length===1?matches[0].id:'');
  return `<aside class="ci-detail" data-ci-detail tabindex="-1" aria-label="선택한 전화 상담"><header class="ci-detail-head"><div><span>${esc(call.sourceLabel||sources.find(source=>source.id===call.sourceId)?.label||'수신함')}</span><h2>${esc(phoneLabel(call.phone))}</h2><p>${esc(stamp(call.occurredAt))} · ${RESULTS[call.result]||'확인 필요'}${call.result==='answered'?` · ${esc(duration(call.durationSeconds))}`:''}${callSequenceLabel(call)?` · ${esc(callSequenceLabel(call))}`:''}</p></div><button type="button" class="ci-close" data-ci-detail-close aria-label="상담 상세 닫기" ${disabled(busy)}>×</button></header><div class="ci-booking-action">${matches.length>1?`<label class="field"><span class="field-label">같은 전화번호의 고객 선택</span><select data-ci-customer ${disabled(busy)}>${option('','고객을 확인하고 선택하세요',currentCustomerId)}${matches.map(customer=>option(customer.id,`${customer.name||'이름 없음'} · ${String(customer.id).slice(-6)}`,currentCustomerId)).join('')}</select></label>`:matches.length===1?`<p><strong>${esc(matches[0].name||'이름 없는 고객')}</strong><span>기존 고객 정보와 연결할 수 있습니다.</span></p>`:'<p><strong>새 문의</strong><span>예약 접수에서 고객 정보를 확인하세요.</span></p>'}<button type="button" class="btn secondary small" data-ci-booking ${disabled(busy||!canonicalTelephone(call.phone)||matches.length>1&&!currentCustomerId)}>예약 접수로 →</button></div><form data-ci-note-form><div class="ci-note-fields"><label class="field"><span class="field-label">상담 상태</span><select name="workflowStatus" ${disabled(busy)}>${Object.entries(WORKFLOW).map(([value,label])=>option(value,label,draft.workflowStatus)).join('')}</select></label><label class="field ci-callback" data-ci-callback ${draft.workflowStatus==='callback'?'':'hidden'}><span class="field-label">재연락 날짜·시간 <b>*</b></span><input name="callbackAt" type="datetime-local" value="${esc(draft.callbackAt)}" ${draft.workflowStatus==='callback'?'required':''} ${disabled(busy)}></label></div><label class="field"><span class="field-label">상담 메모</span><textarea name="note" rows="3" maxlength="2000" placeholder="문의 내용, 안내한 금액, 다음 확인할 내용을 남기세요." ${disabled(busy)}>${esc(draft.note)}</textarea></label><p class="ci-form-error" data-ci-form-error role="alert" ${u.detailError?'':'hidden'}>${esc(u.detailError||'')}</p><div class="ci-save-row"><span>메모는 작성자·시각과 함께 남습니다.</span><button type="submit" class="btn primary small" ${disabled(busy)}>${u.saving?'저장 중…':'상담 기록 저장'}</button></div></form><section class="ci-history"><h3>상담 이력 <span>${list(u.detail.notes).length}</span></h3>${list(u.detail.notes).map(note=>`<article><header><strong>${esc(note.actorName||'운영 담당자')}</strong><time>${esc(stamp(note.createdAt))}</time></header><p>${esc(note.text)}</p></article>`).join('')||'<p class="ci-muted">아직 남긴 상담 메모가 없습니다.</p>'}</section></aside>`;
}

// 전체 통화 ↔ 콜백 필요 보기 전환 토글. 두 뷰 공통.
const modeToggle=u=>`<div class="ci-modes" role="group" aria-label="통화 보기"><button type="button" class="ci-mode ${u.mode!=='callback'?'active':''}" data-ci-mode="all" aria-pressed="${u.mode!=='callback'}">전체 통화</button><button type="button" class="ci-mode ${u.mode==='callback'?'active':''}" data-ci-mode="callback" aria-pressed="${u.mode==='callback'}">콜백 필요</button></div>`;
// 콜백 필요 목록: 부재중이거나 번호별 응답통화 총합이 80초 미만인 번호만. 서버 callback-list 집계 결과(data.rows)를 표로.
function renderCallbackList({profile,data,ui,u,sources,customers,customerTeams,loading,error,busy,blocked}){
  const rows=list(data?.rows);
  const total=Number.isFinite(Number(data?.total))?Number(data.total):rows.length;
  return `<section class="call-inbox" data-call-inbox><header class="ci-heading"><div><h1>콜백 필요</h1><p>부재중이거나 통화가 1분 20초 미만이라 다시 전화해야 할 번호입니다.</p></div><button type="button" class="btn secondary small" data-ci-refresh ${disabled(blocked||loading)}>새로고침</button></header>${modeToggle(u)}<form class="ci-filters" data-ci-filter-form><label class="field"><span class="field-label">수신함</span><select name="sourceId" ${disabled(blocked)}>${option('','전체 수신함',u.sourceId)}${sources.map(source=>option(source.id,source.label,u.sourceId)).join('')}</select></label><label class="field ci-search"><span class="field-label">전화번호 검색</span><input name="query" value="${esc(u.query)}" maxlength="120" type="search" placeholder="전화번호" ${disabled(blocked)}></label><label class="field"><span class="field-label">시작일</span><input name="from" type="date" value="${esc(u.from)}" ${disabled(blocked)}></label><label class="field"><span class="field-label">종료일</span><input name="to" type="date" value="${esc(u.to)}" ${disabled(blocked)}></label><button type="submit" class="btn secondary small" ${disabled(blocked||loading)}>조회</button></form>${error||u.error?`<p class="ci-error" role="alert">${esc(error||u.error)}</p>`:''}${loading?'<p class="ci-loading" role="status">콜백 대상을 확인하고 있습니다.</p>':''}<p class="ci-callback-note">최근 통화일 기준 정렬 · 마지막 발신은 우리가 그 번호로 전화한 가장 최근 날짜입니다(발신 수집 연결 후 기록부터 쌓임).</p><div class="ci-layout ${u.detailId?'has-detail':''}"><div class="ci-list"><div class="ci-list-heading"><strong>${total}명</strong><span>다시 전화할 번호</span></div>${rows.length?`<div class="ci-table-wrap"><table class="ci-table"><thead><tr><th>마지막 통화</th><th>마지막 발신</th><th>전화번호·고객</th><th>사유</th><th>총 통화시간</th><th>통화수</th><th><span class="ci-visually-hidden">상담</span></th></tr></thead><tbody>${rows.map(row=>`<tr class="${u.detailId===row.lastCallId?'selected':''}"><td><strong>${esc(stamp(row.lastContactAt))}</strong><small>${esc(row.sourceLabel||sources.find(s=>s.id===row.sourceId)?.label||'')}</small></td><td>${row.lastOutgoingAt?`<strong>${esc(stamp(row.lastOutgoingAt))}</strong>`:'<small>발신 기록 없음</small>'}</td><td><strong>${esc(phoneLabel(row.phone))}</strong><span class="ci-customer-match">${customerMarkup({phone:row.phone},customers,customerTeams)}</span></td><td>${row.missed?'<span class="ci-result ci-result-missed">부재중</span> ':''}${Number(row.totalDuration)<80?'<span class="ci-result ci-result-rejected">짧은통화</span>':''}</td><td>${esc(duration(row.totalDuration))}</td><td>${Number(row.callCount)||0}회</td><td><button type="button" class="btn secondary small" data-ci-detail-open="${esc(row.lastCallId)}" ${disabled(blocked)}>상담</button></td></tr>`).join('')}</tbody></table></div>`:!loading&&!error&&!u.error?'<div class="ci-empty"><h2>콜백 대상이 없습니다.</h2><p>부재중이거나 통화가 짧았던 번호가 여기에 모입니다.</p></div>':''}<div class="ci-pagination"><button type="button" class="btn ghost small" data-ci-page="previous" ${disabled(blocked||loading||!u.offset)}>이전</button><span>${total?`${Math.min(total,Number(u.offset||0)+1)}–${Math.min(total,Number(u.offset||0)+rows.length)}`:'0'} / ${total}</span><button type="button" class="btn ghost small" data-ci-page="next" ${disabled(blocked||loading||!data?.hasMore)}>다음</button></div></div>${detailMarkup(profile,sources,u,customers,blocked,customerTeams)}</div></section>`;
}

// 과거 통화 백업 가져오기(2026-11-23): 자동수집은 최근 7일만이라 10/1부터의 발신은 이걸로 보충.
// SMS Backup & Restore 통화기록 백업(calls.xml)을 브라우저에서만 읽어 선택 저장.
function renderCallHistory(u,sources,profile){
  if(!admin(profile))return '';
  const h=u.history,file=h.file,result=h.result;
  if(!h.open)return `<section class="ci-history ci-history-closed"><button type="button" class="btn secondary small" data-ci-history-open>과거 통화 가져오기 (10/1~)</button><span class="ci-history-hint">자동 수집은 최근 7일만 — 그 이전 발신은 통화기록 백업으로 보충합니다.</span></section>`;
  const byResult=file?file.records.reduce((acc,r)=>{acc[r.result]=(acc[r.result]||0)+1;return acc;},{}):{};
  const summary=file?Object.entries(byResult).map(([k,n])=>`${RESULTS[k]||k} ${n}`).join(' · '):'';
  return `<section class="ci-history" data-ci-history><header class="ci-history-head"><strong>과거 통화 가져오기</strong><button type="button" class="btn ghost small" data-ci-history-close ${h.busy?'disabled':''}>닫기</button></header>
  <ol class="ci-history-guide"><li>휴대폰 <b>SMS Backup & Restore</b> 앱에서 <b>통화 기록</b>을 백업합니다(문자 아님). 날짜는 2026-10-01부터.</li><li>생성된 <b>calls*.xml</b> 파일을 아래에서 선택하면 브라우저 안에서만 읽습니다(서버 전송 전).</li><li>발신 등 필요한 유형을 확인하고 가져오기를 누릅니다. 이미 있는 통화는 자동으로 건너뜁니다.</li></ol>
  <div class="ci-history-form"><label class="field"><span class="field-label">업장 휴대폰</span><select data-ci-history-source ${h.busy?'disabled':''}>${['<option value="">선택</option>',...sources.map(s=>`<option value="${esc(s.id)}" ${h.sourceId===s.id?'selected':''}>${esc(s.label)}</option>`)].join('')}</select></label>
  <label class="field"><span class="field-label">시작일</span><input type="date" data-ci-history-from value="${esc(h.from)}" min="2026-10-01" ${h.busy?'disabled':''}></label>
  <label class="field"><span class="field-label">종료일</span><input type="date" data-ci-history-to value="${esc(h.to)}" min="2026-10-01" ${h.busy?'disabled':''}></label>
  <label class="field"><span class="field-label">통화기록 백업 파일</span><input type="file" accept=".xml,text/xml,application/xml" data-ci-history-file ${h.busy||!h.sourceId?'disabled':''}></label></div>
  ${h.error?`<p class="ci-history-error" role="alert">${esc(h.error)}</p>`:''}
  ${file?`<div class="ci-history-preview"><strong>가져올 통화 ${file.records.length}건</strong>${summary?`<span>${esc(summary)}</span>`:''}${file.issues.length?`<ul>${file.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}<button type="button" class="btn primary small" data-ci-history-import ${h.busy||!file.records.length?'disabled':''}>${h.busy?'가져오는 중…':`${file.records.length}건 가져오기`}</button></div>`:''}
  ${result?`<p class="ci-history-result">저장 ${result.inserted}건 · 이미 있던 통화 ${result.accepted-result.inserted}건 건너뜀 (총 ${result.accepted}건 확인).</p>`:''}
  </section>`;
}
export function renderCallInbox({profile,data,ui={},customers=[],customerTeams=[],loading=false,error='',busy=false}={}){
  if(!canUse(profile))return '<section class="ci-access"><h2>상담·전화</h2><p>관리자·상담사 로그인 후 이용할 수 있습니다.</p></section>';
  const u=stateOf(ui),sources=allowedSources(profile,data),sourceIds=new Set(sources.map(source=>source.id)),calls=list(data?.calls).filter(call=>sourceIds.has(call.sourceId)),blocked=!!busy||!!u.saving||!!u.sourceBusy;
  if(u.mode==='callback')return renderCallbackList({profile,data,ui,u,sources,customers,customerTeams,loading,error,busy,blocked});
  const total=Number.isFinite(Number(data?.total))?Number(data.total):calls.length;
  return `<section class="call-inbox" data-call-inbox><header class="ci-heading"><div><h1>상담·전화</h1><p>들어온 전화를 확인하고 상담과 예약 접수를 이어가세요.</p></div><button type="button" class="btn secondary small" data-ci-refresh ${disabled(blocked||loading)}>새로고침</button></header>${renderCallHistory(u,sources,profile)}${modeToggle(u)}${sourceCards(profile,sources,u,blocked)}${sourceSettings(profile,sources,u,blocked)}<form class="ci-filters" data-ci-filter-form><label class="field"><span class="field-label">수신함</span><select name="sourceId" ${disabled(blocked)}>${option('','전체 수신함',u.sourceId)}${sources.map(source=>option(source.id,source.label,u.sourceId)).join('')}</select></label><label class="field"><span class="field-label">상담 상태</span><select name="workflowStatus" ${disabled(blocked)}>${option('','전체 상태',u.workflowStatus)}${Object.entries(WORKFLOW).map(([value,label])=>option(value,label,u.workflowStatus)).join('')}</select></label><label class="field ci-search"><span class="field-label">전화번호·상담 메모 검색</span><input name="query" value="${esc(u.query)}" maxlength="120" type="search" placeholder="전화번호 또는 메모" ${disabled(blocked)}></label><label class="field"><span class="field-label">시작일</span><input name="from" type="date" value="${esc(u.from)}" ${disabled(blocked)}></label><label class="field"><span class="field-label">종료일</span><input name="to" type="date" value="${esc(u.to)}" ${disabled(blocked)}></label><button type="submit" class="btn secondary small" ${disabled(blocked||loading)}>조회</button></form>${error||u.error?`<p class="ci-error" role="alert">${esc(error||u.error)}</p>`:''}${loading?'<p class="ci-loading" role="status">전화 상담 기록을 확인하고 있습니다.</p>':''}<div class="ci-layout ${u.detailId?'has-detail':''}"><div class="ci-list"><div class="ci-list-heading"><strong>${total}건</strong><span>최신 전화부터 · 한국 시간</span></div>${calls.length?`<div class="ci-table-wrap"><table class="ci-table"><thead><tr><th>수신 시각·수신함</th><th>전화번호·고객</th><th>통화 결과</th><th>상담 상태</th><th>최근 메모·재연락</th><th><span class="ci-visually-hidden">상담 상세</span></th></tr></thead><tbody>${calls.map(call=>`<tr class="${u.detailId===call.id?'selected':''}"><td><strong>${esc(stamp(call.occurredAt))}</strong><small>${esc(call.sourceLabel||sources.find(source=>source.id===call.sourceId)?.label)}</small></td><td><strong>${esc(phoneLabel(call.phone))}</strong><span class="ci-customer-match">${customerMarkup(call,customers,customerTeams)}</span>${callSequenceLabel(call)?`<small class="ci-seq">${esc(callSequenceLabel(call))}</small>`:''}</td><td><span class="ci-result ci-result-${Object.hasOwn(RESULTS,call.result)?call.result:'unknown'}">${RESULTS[call.result]||'확인 필요'}</span>${call.result==='answered'?`<small>${esc(duration(call.durationSeconds))}</small>`:''}</td><td><span class="ci-workflow ci-workflow-${Object.hasOwn(WORKFLOW,call.workflowStatus)?call.workflowStatus:'unknown'}">${WORKFLOW[call.workflowStatus]||'확인 필요'}</span></td><td class="ci-last-note"><span>${esc(call.lastNote||'메모 없음')}</span>${call.callbackAt?`<small>재연락 ${esc(stamp(call.callbackAt))}</small>`:''}</td><td><button type="button" class="btn secondary small" data-ci-detail-open="${esc(call.id)}" ${disabled(blocked)}>상담</button></td></tr>`).join('')}</tbody></table></div>`:!loading&&!error&&!u.error?`<div class="ci-empty"><h2>${sources.length?'이 조건의 전화 기록이 없습니다.':'공유된 전화 수신함이 없습니다.'}</h2><p>${sources.length?'휴대폰 연결 후 들어온 전화가 여기에 쌓입니다.':admin(profile)?'수신함 설정을 확인한 뒤 새로고침해 주세요.':'사장님이 수신함을 상담사에게 공유하면 기록을 볼 수 있습니다.'}</p></div>`:''}<div class="ci-pagination"><button type="button" class="btn ghost small" data-ci-page="previous" ${disabled(blocked||loading||!u.offset)}>이전</button><span>${total?`${Math.min(total,Number(u.offset||0)+1)}–${Math.min(total,Number(u.offset||0)+calls.length)}`:'0'} / ${total}</span><button type="button" class="btn ghost small" data-ci-page="next" ${disabled(blocked||loading||!data?.hasMore)}>다음</button></div></div>${detailMarkup(profile,sources,u,customers,blocked,customerTeams)}</div></section>`;
}

export function bindCallInbox(root,{profile,data,ui={},customers=[],customerTeams=[],onChange,onRefresh,onAction,onCreateBooking,onError,onSetupDownload,isCurrent=()=>true}={}){
  if(!canUse(profile))return;
  const u=stateOf(ui),sources=allowedSources(profile,data),sourcesById=new Map(sources.map(row=>[row.id,row]));
  const current=()=>isCurrent()&&canUse(profile);
  const busy=()=>!!u.saving||!!u.sourceBusy;
  const paint=()=>{if(current())onChange?.();};
  const notify=error=>{if(current())onError?.(error?.message||'상담 정보를 처리하지 못했습니다. 다시 시도해 주세요.');};
  const confirmDiscard=()=>!hasUnsavedCallDraft(ui)||globalThis.confirm?.('저장하지 않은 상담 내용이 있습니다. 내용을 비우고 이동하시겠습니까?')===true;
  const clearDetail=()=>{u.detailRequest=(u.detailRequest||0)+1;u.detailId=null;u.detail=null;u.draft=null;u.baseline=null;u.customerId='';u.detailError='';u.detailLoading=false;};
  const refresh=()=>{try{Promise.resolve(onRefresh?.()).catch(notify);}catch(error){notify(error);}};
  // 과거 통화 가져오기(2026-11-23): 파일은 브라우저 안에서만 파싱, 선택분만 call-history-import 로 전송.
  const h=u.history;
  const historyBusy=()=>!!h.busy;
  root.querySelector('[data-ci-history-open]')?.addEventListener('click',()=>{if(current()){h.open=true;h.error='';paint();}});
  root.querySelector('[data-ci-history-close]')?.addEventListener('click',()=>{if(current()&&!historyBusy()){h.open=false;h.file=null;h.result=null;h.error='';paint();}});
  root.querySelector('[data-ci-history-source]')?.addEventListener('change',e=>{if(current()&&!historyBusy()){h.sourceId=e.target.value;h.file=null;h.result=null;h.error='';paint();}});
  root.querySelector('[data-ci-history-from]')?.addEventListener('change',e=>{if(current()&&!historyBusy()){h.from=e.target.value;h.file=null;paint();}});
  root.querySelector('[data-ci-history-to]')?.addEventListener('change',e=>{if(current()&&!historyBusy()){h.to=e.target.value;h.file=null;paint();}});
  root.querySelector('[data-ci-history-file]')?.addEventListener('change',async e=>{
    const input=e.target,picked=input.files?.[0];if(!picked||!current()||historyBusy())return;
    h.busy=true;h.error='';h.file=null;h.result=null;paint();
    try{
      if(picked.size>128*1024*1024)throw Error('백업 파일이 너무 큽니다(128MB 초과).');
      const raw=await picked.text();
      const module=await import('./call-backup-parser.mjs?v=1');
      const parsed=module.parseCallBackupXml(raw,{sourceId:h.sourceId,from:h.from,to:h.to||undefined});
      if(!current())return;
      if(!parsed.records.length)throw Error('선택한 날짜 범위에 가져올 통화가 없습니다. 날짜와 백업 파일을 확인해 주세요.');
      h.file=parsed;
    }catch(error){if(current())h.error=error.message||'백업 파일을 읽지 못했습니다.';}
    finally{if(current()){h.busy=false;try{input.value='';}catch{}paint();}}
  });
  root.querySelector('[data-ci-history-import]')?.addEventListener('click',async()=>{
    if(!current()||historyBusy()||!h.file?.records.length)return;
    h.busy=true;h.error='';paint();
    const totals={accepted:0,inserted:0};
    try{
      const records=h.file.records;
      for(let i=0;i<records.length;i+=100){
        const batch=records.slice(i,i+100).map(({contactName,...rest})=>rest);
        const result=await onAction?.('call-history-import',{sourceId:h.file.sourceId,from:h.file.fromBoundary,to:h.file.toBoundary,records:batch});
        if(!current())return;
        totals.accepted+=Number(result?.accepted)||0;totals.inserted+=Number(result?.inserted)||0;
      }
      h.result=totals;h.file=null;
    }catch(error){if(current())h.error=error.message||'가져오기를 완료하지 못했습니다. 다시 시도해 주세요.';}
    finally{if(current()){h.busy=false;paint();refresh();}}
  });
  const changedFilters=values=>{
    if(!current()||busy()||!confirmDiscard())return false;
    clearDetail();u.sourceDrafts={};Object.assign(u,values,{offset:0,error:''});paint();refresh();return true;
  };
  const openDetail=async(id,{force=false}={})=>{
    if(!current()||busy()||!force&&id===u.detailId||!force&&!confirmDiscard())return;
    const sourceCall=list(data?.calls).find(row=>row.id===id);
    if(sourceCall&&!sourcesById.has(sourceCall.sourceId))return;
    const request=++u.detailRequest;u.detailId=id;u.detailLoading=true;u.detailError='';u.error='';u.detail=null;u.draft=null;u.baseline=null;u.customerId='';u.sourceDrafts={};paint();
    try{
      const result=await onAction?.('call-detail',{callId:id});
      if(!current()||u.detailRequest!==request||u.detailId!==id)return;
      if(!result?.call||result.call.id!==id||!sourcesById.has(result.call.sourceId))throw Error('이 상담 기록을 확인할 수 없습니다.');
      u.detail=result;u.draft=draftFor(result.call);u.baseline={...u.draft};
    }catch(error){if(current()&&u.detailRequest===request){u.detailError=error.message||'상담 기록을 불러오지 못했습니다.';u.error=u.detailError;}}
    finally{if(current()&&u.detailRequest===request){u.detailLoading=false;paint();globalThis.requestAnimationFrame?.(()=>root.querySelector('[data-ci-detail]')?.focus({preventScroll:true}));}}
  };
  root.querySelector('[data-ci-refresh]')?.addEventListener('click',()=>{if(current()&&!busy())refresh();});
  root.querySelectorAll('[data-ci-mode]').forEach(button=>button.addEventListener('click',()=>{
    if(!current()||busy())return;
    const next=button.dataset.ciMode==='callback'?'callback':'all';
    if(next===(u.mode||'all')||!confirmDiscard())return;
    clearDetail();u.mode=next;u.sourceDrafts={};Object.assign(u,{offset:0,error:''});paint();refresh();
  }));
  root.querySelector('[data-ci-settings]')?.addEventListener('toggle',event=>{u.settingsOpen=event.currentTarget.open;});
  root.querySelector('[data-ci-setup-help]')?.addEventListener('toggle',event=>{u.setupHelpOpen=event.currentTarget.open;});
  root.querySelectorAll('[data-ci-source]').forEach(button=>button.addEventListener('click',()=>changedFilters({sourceId:u.sourceId===button.dataset.ciSource?'':button.dataset.ciSource})));
  const filterForm=root.querySelector('[data-ci-filter-form]');
  filterForm?.addEventListener('submit',event=>{
    event.preventDefault();const values=Object.fromEntries(['sourceId','workflowStatus','query','from','to'].map(name=>[name,text(filterForm.elements.namedItem(name)?.value)]));
    if(values.from&&values.to&&values.from>values.to){u.error='조회 시작일을 종료일보다 앞선 날짜로 선택해 주세요.';paint();return;}
    changedFilters(values);
  });
  root.querySelectorAll('[data-ci-page]').forEach(button=>button.addEventListener('click',()=>{
    if(!current()||busy()||!confirmDiscard())return;
    const offset=button.dataset.ciPage==='next'?Number(u.offset||0)+Number(u.limit||100):Math.max(0,Number(u.offset||0)-Number(u.limit||100));
    clearDetail();u.offset=offset;paint();refresh();
  }));
  root.querySelectorAll('[data-ci-detail-open]').forEach(button=>button.addEventListener('click',()=>void openDetail(button.dataset.ciDetailOpen)));
  root.querySelector('[data-ci-detail-retry]')?.addEventListener('click',()=>void openDetail(u.detailId,{force:true}));
  root.querySelector('[data-ci-detail-close]')?.addEventListener('click',()=>{if(current()&&!busy()&&confirmDiscard()){clearDetail();paint();}});
  root.querySelector('[data-ci-customer]')?.addEventListener('change',event=>{u.customerId=event.currentTarget.value;const button=root.querySelector('[data-ci-booking]');if(button)button.disabled=!u.customerId||busy();});
  root.querySelector('[data-ci-booking]')?.addEventListener('click',()=>{
    if(!current()||busy()||!u.detail?.call||!canonicalTelephone(u.detail.call.phone))return;
    if(hasUnsavedCallDraft(ui)){u.detailError='작성한 상담 기록을 먼저 저장한 뒤 예약 접수를 열어 주세요.';paint();return;}
    const matches=matchingCallCustomers(u.detail.call.phone,customers,customerTeams),customer=matches.length===1?matches[0]:matches.find(row=>row.id===u.customerId);
    if(matches.length>1&&!customer)return;
    onCreateBooking?.(u.detail.call,{matchedCustomer:customer||null});
  });
  const noteForm=root.querySelector('[data-ci-note-form]');
  const captureDraft=()=>{
    if(!u.detail?.call)return;
    u.draft={workflowStatus:noteForm.elements.namedItem('workflowStatus').value,callbackAt:noteForm.elements.namedItem('callbackAt').value,note:noteForm.elements.namedItem('note').value};
  };
  noteForm?.addEventListener('input',captureDraft);
  noteForm?.addEventListener('change',()=>{captureDraft();const visible=u.draft.workflowStatus==='callback',field=noteForm.querySelector('[data-ci-callback]'),input=noteForm.elements.namedItem('callbackAt');if(field)field.hidden=!visible;input.required=visible;});
  noteForm?.addEventListener('submit',async event=>{
    event.preventDefault();if(!current()||busy()||!u.detail?.call)return;captureDraft();
    const draft={...u.draft},id=u.detailId,request=u.detailRequest;
    const callbackAt=draft.workflowStatus==='callback'?draft.callbackAt:'';
    if(!Object.hasOwn(WORKFLOW,draft.workflowStatus)){u.detailError='상담 상태를 확인해 주세요.';paint();return;}
    if(callbackAt&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(callbackAt)||draft.workflowStatus==='callback'&&!callbackAt||callbackAt&&!Number.isFinite(new Date(`${callbackAt}:00+09:00`).getTime())){u.detailError='재연락 날짜와 시간을 입력해 주세요.';paint();return;}
    if(text(draft.note).length>2000){u.detailError='상담 메모는 2,000자 이하로 입력해 주세요.';paint();return;}
    u.saving=true;u.detailError='';paint();
    try{
      const result=await onAction?.('call-save',{callId:id,workflowStatus:draft.workflowStatus,callbackAt:callbackAt?new Date(`${callbackAt}:00+09:00`).toISOString():null,...(text(draft.note)?{note:text(draft.note)}:{})});
      if(!current()||u.detailRequest!==request||u.detailId!==id)return;
      if(result?.call?.id!==id||!sourcesById.has(result.call.sourceId))throw Error('상담 저장 결과를 확인하지 못했습니다.');
      u.detail={...u.detail,call:result.call};u.draft=draftFor(result.call);u.baseline={...u.draft};
      try{const detail=await onAction?.('call-detail',{callId:id});if(current()&&u.detailRequest===request&&detail?.call?.id===id&&sourcesById.has(detail.call.sourceId))u.detail=detail;}catch{if(current()&&u.detailRequest===request)u.detailError='기록은 저장했습니다. 이력을 보려면 새로고침해 주세요.';}
      refresh();
    }catch(error){if(current()&&u.detailRequest===request){u.detailError=error.message||'상담 기록을 저장하지 못했습니다.';notify(error);}}
    finally{if(current()&&u.detailRequest===request){u.saving=false;paint();}}
  });
  if(!admin(profile))return;
  const updateSource=async(id,action,payload={},download=false)=>{
    if(!current()||busy()||!sourcesById.has(id))return;
    u.sourceBusy=id;u.error='';paint();
    try{
      const result=await onAction?.(action,{sourceId:id,...payload});
      if(!current())return;
      if(download){if(!result?.token||result?.source?.id!==id||typeof onSetupDownload!=='function')throw Error('휴대폰 연결파일을 만들지 못했습니다. 다시 만들어 주세요.');await onSetupDownload({source:result.source,token:result.token});}
      delete u.sourceDrafts?.[id];refresh();
    }catch(error){if(current()){u.error=error.message||'휴대폰 설정을 저장하지 못했습니다.';notify(error);}}
    finally{if(current()){u.sourceBusy=null;paint();}}
  };
  root.querySelectorAll('[data-ci-source-form]').forEach(form=>{
    const id=form.dataset.ciSourceForm,source=sourcesById.get(id);if(!source)return;
    const capture=()=>{u.sourceDrafts??={};u.sourceDrafts[id]={visibility:form.elements.namedItem('visibility').value,enabled:form.elements.namedItem('enabled').checked,baselineVisibility:source.visibility,baselineEnabled:source.enabled!==false};};
    form.addEventListener('change',capture);
    form.addEventListener('submit',event=>{event.preventDefault();capture();const draft=u.sourceDrafts[id];void updateSource(id,'source-update',{visibility:draft.visibility,enabled:draft.enabled});});
  });
  root.querySelectorAll('[data-ci-source-key]').forEach(button=>button.addEventListener('click',()=>{
    const source=sourcesById.get(button.dataset.ciSourceKey);if(!source||busy())return;
    if(source.hasKey&&globalThis.confirm?.('연결파일을 다시 만들면 기존 휴대폰의 연결키가 해제됩니다. 새 연결파일을 만드시겠습니까?')!==true)return;
    void updateSource(source.id,'source-key',{},true);
  }));
  root.querySelectorAll('[data-ci-source-revoke]').forEach(button=>button.addEventListener('click',()=>{
    const source=sourcesById.get(button.dataset.ciSourceRevoke);if(!source||busy())return;
    if(globalThis.confirm?.('이 휴대폰의 자동 수신 연결을 해제하시겠습니까? 기존 상담 기록은 남습니다.')!==true)return;
    void updateSource(source.id,'source-revoke');
  }));
}
