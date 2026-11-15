const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const isAdmin=profile=>profile?.role==='admin'&&profile.active===true&&!profile.must_change_password&&!!profile.user_id;
const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'시각 확인 필요';

export function customerRequestNotifications(state={},{unreadOnly=false}={}){
  if(!isAdmin(state.profile))return [];
  const recipients=new Map(list(state.notifications).filter(row=>row.user_id===state.profile.user_id).map(row=>[row.alert_id,row]));
  return list(state.alerts).filter(row=>row.category==='customer-request'&&row.active!==false&&!row.resolvedAt&&recipients.has(row.id))
    .map(row=>({...row,recipient:recipients.get(row.id)})).filter(row=>!unreadOnly||!row.recipient.read_at)
    .sort((a,b)=>Date.parse(b.lastDetectedAt)-Date.parse(a.lastDetectedAt)||String(b.id).localeCompare(String(a.id)));
}

export function renderCustomerRequestNotifications({state={},icon=()=>'',pushState={},pushBusy=false}={}){
  if(!isAdmin(state.profile))return '';
  const rows=customerRequestNotifications(state),unread=rows.filter(row=>!row.recipient.read_at).length;
  const pushLabel=pushState.enabled?'이 기기 알림 끄기':pushState.supported===false?'이 브라우저는 알림 미지원':'이 기기로 요청 알림 받기';
  return `<section class="panel customer-request-notifications" aria-label="고객 일정 요청 알림" style="margin-bottom:24px"><div class="panel-head" style="gap:12px;flex-wrap:wrap"><div><h2 class="panel-title">고객 일정 요청 <span class="count-sub">${rows.length}</span></h2><p class="muted">예약 변경과 수강권 새 일정 신청을 확인해 주세요.</p></div><a class="btn primary small" href="/booking/#changes">요청 검토하기 ${icon('arrow')}</a></div><div class="panel-body"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><button type="button" class="btn ${pushState.enabled?'secondary':'primary'} small" data-action="${pushState.enabled?'disable-push':'enable-push'}" ${pushBusy||pushState.supported===false?'disabled':''}>${icon('bell')}${pushBusy?'알림 설정 중…':pushLabel}</button><span class="field-help">${esc(pushState.message||(pushState.enabled?'이 기기의 브라우저 알림이 켜져 있습니다.':'웹을 닫은 뒤에도 받으려면 이 기기의 브라우저 알림을 켜 주세요.'))}</span></div><p class="field-help">읽지 않은 요청 알림 ${unread}건 · 읽음 처리는 예약 승인과 별개입니다. 승인·반려는 요청 검토 화면에서 진행하세요.</p>${rows.length?rows.slice(0,50).map(row=>`<article class="alert-card info" data-customer-request-alert="${esc(row.id)}"><div class="alert-top"><span class="attention-icon info">${icon('calendar')}</span><div style="flex:1"><h3 class="alert-title">${esc(row.title||'고객 일정 요청이 접수되었습니다')}</h3><p class="muted">${esc(stamp(row.lastDetectedAt))}</p></div><span class="status-badge ${row.recipient.read_at?'neutral':'info'}">${row.recipient.read_at?'읽음':'읽지 않음'}</span></div><p class="alert-detail">${esc(row.detail)}</p><div class="alert-actions"><a class="btn primary small" href="/booking/#changes">요청 검토하기 ${icon('arrow')}</a>${!row.recipient.read_at?`<button class="btn ghost small" type="button" data-alert-read="${esc(row.id)}">알림 읽음 처리</button>`:''}</div></article>`).join(''):'<p class="muted">새 고객 일정 요청이 도착하면 이곳에 표시됩니다.</p>'}${rows.length>50?'<p class="field-help">최근 50개 알림을 표시합니다. 전체 요청은 요청 검토 화면에서 확인하세요.</p>':''}</div></section>`;
}
