const escapeFallback=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list=value=>Array.isArray(value)?value:[];
const timestamp=value=>{const time=new Date(value||'').getTime();return Number.isFinite(time)?time:0;};
const dateText=value=>timestamp(value)?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'시각 확인 필요';

/** Keep recipient notices visible even after the instructor loses access to the lesson. */
export function selectReservationChangeNotifications(state={}, {scope='all',unreadOnly=false}={}){
  const profile=state.profile;
  if(!profile?.user_id||profile.active===false||!['admin','instructor'].includes(profile.role))return [];
  const ownOnly=profile.role!=='admin'||scope==='mine';
  const byId=new Map();
  for(const row of list(state.reservationChangeNotifications)){
    if(!row?.id||ownOnly&&row.recipient_user_id!==profile.user_id||unreadOnly&&row.read_at)continue;
    byId.set(row.id,row);
  }
  return [...byId.values()].sort((a,b)=>timestamp(b.created_at)-timestamp(a.created_at)||String(b.id).localeCompare(String(a.id)));
}

/** The bell tracks the current user's unread notices, not another recipient's status. */
export function unreadReservationChangeNotifications(state={}){
  return selectReservationChangeNotifications(state,{scope:'mine',unreadOnly:true});
}

function accessibleSchedule(state,notice){
  const profile=state.profile;
  const schedule=list(state.schedules).find(row=>row.id===notice.reservation_id);
  if(!schedule)return null;
  if(profile?.role==='admin')return schedule;
  const assigned=[...list(schedule.instructorUserIds),schedule.instructorUserId,schedule.instructor_user_id];
  return profile?.user_id&&assigned.includes(profile.user_id)?schedule:null;
}

function settingsFor(ui){
  const settings={scope:'all',status:'all',limit:50,...ui.changeNotifications};
  settings.scope=settings.scope==='mine'?'mine':'all';
  settings.status=settings.status==='unread'?'unread':'all';
  settings.limit=Number.isSafeInteger(settings.limit)&&settings.limit>0?settings.limit:50;
  ui.changeNotifications=settings;
  return settings;
}

export function renderChangeNotifications({state={},ui={},escapeHTML=escapeFallback,icon=()=>''}={}){
  const settings=settingsFor(ui),admin=state.profile?.role==='admin',ownUnread=unreadReservationChangeNotifications(state).length;
  const rows=selectReservationChangeNotifications(state,{scope:settings.scope,unreadOnly:settings.status==='unread'});
  const unavailable=state.reservationChangeNotificationsUnavailable;
  const card=notice=>{
    const own=notice.recipient_user_id===state.profile?.user_id,schedule=accessibleSchedule(state,notice);
    const recipient=admin?list(state.roster).find(person=>person.user_id===notice.recipient_user_id)?.display_name:null;
    return `<article class="alert-card ${notice.read_at?'':'info'}" data-reservation-change-notification="${escapeHTML(notice.id)}" style="overflow-wrap:anywhere"><div class="alert-top"><span class="attention-icon info">${icon('calendar')}</span><div style="flex:1;min-width:0"><h3 class="alert-title">${escapeHTML(notice.title||'예약이 변경되었습니다')}</h3><p class="muted">${escapeHTML(dateText(notice.created_at))}${admin?` · 수신: ${escapeHTML(own?'나':recipient||'강사')}`:''}</p></div><span class="status-badge ${notice.read_at?'neutral':'info'}">${notice.read_at?'읽음':'읽지 않음'}</span></div><p class="alert-detail" style="white-space:pre-wrap">${escapeHTML(notice.message)}</p><div class="alert-actions" style="flex-wrap:wrap">${own&&!notice.read_at?`<button type="button" class="btn secondary small" data-change-notification-read="${escapeHTML(notice.id)}">읽음 처리</button>`:''}${schedule?`<button type="button" class="btn ghost small" data-change-notification-open="${escapeHTML(notice.id)}">일정 보기 ${icon('arrow')}</button>`:''}</div></article>`;
  };
  return `<section class="panel reservation-change-notifications" aria-label="예약 변경 알림" style="margin-bottom:24px"><div class="panel-head" style="flex-wrap:wrap;gap:12px"><div><h2 class="panel-title">예약 변경 알림 <span class="count-sub">${rows.length}</span></h2><p class="muted">날짜·시간·장소와 담당 배정의 변경 안내를 확인하세요.</p></div><span class="status-badge ${ownUnread?'info':'neutral'}">내 읽지 않은 알림 ${ownUnread}건</span></div><div class="panel-body"><div class="toolbar" style="padding:0;margin-bottom:16px;flex-wrap:wrap;gap:12px">${admin?`<div class="filter-tabs" aria-label="예약 변경 알림 수신함">${[['all','전체 수신함'],['mine','내 알림']].map(([value,label])=>`<button type="button" data-change-notification-scope="${value}" class="${settings.scope===value?'active':''}" aria-pressed="${settings.scope===value}">${label}</button>`).join('')}</div>`:''}<div class="filter-tabs" aria-label="예약 변경 알림 읽음 상태">${[['all','전체'],['unread','읽지 않음']].map(([value,label])=>`<button type="button" data-change-notification-status="${value}" class="${settings.status===value?'active':''}" aria-pressed="${settings.status===value}">${label}</button>`).join('')}</div></div><p class="field-help" style="margin-bottom:16px">예약 변경 안내의 읽음 상태를 기록합니다.</p><div class="warning-box" data-change-notification-error role="alert" hidden></div>${unavailable?'<div class="warning-box" role="status">예약 변경 알림을 불러오지 못했습니다. 새로고침해 주세요.</div>':rows.length?rows.slice(0,settings.limit).map(card).join(''):'<div class="empty-state"><strong>예약 변경 알림이 없어요</strong><p>예약 변경 안내가 도착하면 이곳에서 확인할 수 있습니다.</p></div>'}${!unavailable&&rows.length>settings.limit?`<button type="button" class="btn secondary small" data-change-notification-more>이전 알림 더 보기 (${rows.length-settings.limit}건)</button>`:''}</div></section>`;
}

export function bindChangeNotifications(root,{state={},ui={},onChange,onRead,onOpenLesson,onError}={}){
  const view=root.querySelector('.reservation-change-notifications');if(!view)return;
  const settings=settingsFor(ui);
  const update=changes=>{Object.assign(settings,changes);ui.changeNotifications=settings;onChange?.(settings);};
  view.querySelectorAll('[data-change-notification-scope]').forEach(button=>button.onclick=()=>update({scope:button.dataset.changeNotificationScope,limit:50}));
  view.querySelectorAll('[data-change-notification-status]').forEach(button=>button.onclick=()=>update({status:button.dataset.changeNotificationStatus,limit:50}));
  view.querySelector('[data-change-notification-more]')?.addEventListener('click',()=>update({limit:settings.limit+50}));
  const notices=selectReservationChangeNotifications(state);
  view.querySelectorAll('[data-change-notification-open]').forEach(button=>button.onclick=()=>{
    const notice=notices.find(row=>row.id===button.dataset.changeNotificationOpen);
    const schedule=notice&&accessibleSchedule(state,notice);
    if(schedule)onOpenLesson?.(schedule.id,'proof');
  });
  view.querySelectorAll('[data-change-notification-read]').forEach(button=>button.onclick=async()=>{
    const notice=notices.find(row=>row.id===button.dataset.changeNotificationRead);
    if(button.disabled||!notice||notice.read_at||notice.recipient_user_id!==state.profile?.user_id)return;
    button.disabled=true;
    try{
      if(typeof onRead!=='function')throw new Error('예약 변경 알림 읽음 저장을 연결하지 못했습니다.');
      await onRead(notice.id);
    }catch(error){
      const message=error?.message||'예약 변경 알림 읽음 상태를 저장하지 못했습니다.';
      const box=view.querySelector('[data-change-notification-error]');
      if(box){box.textContent=message;box.hidden=false;}
      onError?.(message);
    }finally{button.disabled=false;}
  });
}
