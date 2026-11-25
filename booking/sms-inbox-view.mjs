import {isDeletedCustomer} from './customer-delete.mjs?v=2';
import {canonicalTelephone,formatTelephone} from './customer-teams.mjs?v=28';
import {renderSmsHistory,bindSmsHistory,isSmsHistoryOpen} from './sms-history-view.mjs?v=12';

const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const canUse=profile=>profile?.active===true&&!profile.must_change_password&&['admin','counselor'].includes(profile.role);
const allowedSources=(profile,data)=>list(data?.sources).filter(source=>profile.role==='admin'||source.visibility==='staff');
const disabled=value=>value?'disabled':'';
const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const monotonicTime=()=>globalThis.performance?.now?.();
const serverTimestamp=value=>{const at=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(at)&&at>0&&new Date(at).toISOString()===value?at:0;};
const stamp=value=>time(value)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'—';
const MEDIA_ORIGIN='https://ewiekbmjvgktwsbbxrzw.supabase.co';
const MEDIA_PREFIX='/storage/v1/object/sign/slope-message-media/';
const IMAGE_MIME=new Set(['image/jpeg','image/png','image/gif','image/webp','image/bmp']);
const AUDIO_MIME=new Set(['audio/mpeg','audio/mp3','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/amr','audio/3gpp']);
const VIDEO_MIME=new Set(['video/mp4','video/3gpp','video/webm']);
const day=value=>time(value)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(value)):'날짜 확인 필요';

// SMS senders also include service codes and international numbers. Booking
// contact validation is intentionally stricter and is used only for matching.
export function normalizeSmsPhone(value){
  const original=text(value),dualNumber=original.endsWith('#');
  let phone=(dualNumber?original.slice(0,-1):original).normalize('NFKC');
  if(!phone||!/^[+0-9().\s-]+$/u.test(phone))return '';
  phone=phone.replace(/[().\s-]/gu,'');
  if(/^(?:\+82|0082)/.test(phone)||/^82\d{8,11}$/.test(phone)){
    phone=phone.replace(/^(?:\+82|0082|82)/,'');
    if(!phone.startsWith('0'))phone=`0${phone}`;
  }else if(phone.startsWith('00'))phone=`+${phone.slice(2)}`;
  if(dualNumber&&phone.replace(/^\+/,'').length<8)return '';
  return /^(?:\+[1-9]\d{7,14}|\d{3,15})$/.test(phone)?phone:'';
}
export function smsThreadKey(sourceId,phone){
  const normalized=normalizeSmsPhone(phone);
  return text(sourceId)&&normalized?JSON.stringify([text(sourceId),normalized]):'';
}
export function matchingSmsCustomers(phone,customers=[],customerTeams=[]){
  const normalized=canonicalTelephone(normalizeSmsPhone(phone));
  if(!normalized)return [];
  // 팀 별도 연락처(teamPhoneMode=separate)로 온 문자도 그 고객에게 연결한다(2026-11-20).
  const teamPhoneCustomerIds=new Set(list(customerTeams).filter(team=>canonicalTelephone(team?.phone)===normalized).map(team=>team?.customer_id??team?.customerId).filter(Boolean));
  const seen=new Set();
  return list(customers).filter(customer=>{
    if(!customer?.id||isDeletedCustomer(customer)||seen.has(customer.id))return false;
    const matches=list(customer.contacts).some(contact=>canonicalTelephone(contact?.phone)===normalized)||teamPhoneCustomerIds.has(customer.id);
    if(matches)seen.add(customer.id);
    return matches;
  });
}
export function mergeSmsMessages(older=[],newer=[]){
  const unique=new Map();
  for(const message of [...list(older),...list(newer)]){
    if(!message?.id||!['received','sent'].includes(message.direction))continue;
    const existing=unique.get(message.id);
    if(!existing||time(message.updatedAt)>=time(existing.updatedAt))unique.set(message.id,message);
  }
  return [...unique.values()].sort((a,b)=>time(a.occurredAt)-time(b.occurredAt)||String(a.id).localeCompare(String(b.id)));
}
function stateOf(ui){
  const u=ui.smsInbox??={};
  const defaults={sourceId:'',query:'',offset:0,limit:50,selected:null,detail:null,detailRequest:0,detailLoading:false,olderLoading:false,detailError:'',customerId:'',error:'',pollRequest:0,pollLoading:false,threadVersion:'',newMessagesPending:false};
  for(const [key,value] of Object.entries(defaults))if(u[key]===undefined)u[key]=value;
  if(u.queryDraft===undefined)u.queryDraft=u.query;
  if(u.sourceDraftId===undefined)u.sourceDraftId=u.sourceId;
  if(!(u.mediaViews instanceof Map))u.mediaViews=new Map();
  if(!Number.isInteger(u.mediaRequest))u.mediaRequest=0;
  return u;
}
export function rememberSmsReadPosition(root,ui={}){
  const u=ui.smsInbox,scroll=root?.querySelector('[data-si-scroll]');
  if(scroll&&u?.selected)u.scrollRestore={key:smsThreadKey(u.selected.sourceId,u.selected.phone),top:scroll.scrollTop||0,atEnd:scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<48};
}
// The phone collector's last acknowledgement is separate from imported backups.
// Keep this request independent so an unavailable status endpoint cannot hide messages.
export async function refreshSmsSyncStatuses({ui={},onAction,isCurrent=()=>true,onChange,sourceId='',monotonicNow=monotonicTime}={}){
  if(!isCurrent())return {discarded:true};
  const u=stateOf(ui),request=(u.syncRequest||0)+1;u.syncRequest=request;u.syncLoading=true;u.syncError='';
  const current=()=>isCurrent()&&ui.smsInbox===u&&u.syncRequest===request;
  try{
    const result=await onAction('sync-status-list',sourceId?{sourceId}:{});
    if(!current())return {discarded:true};
    if(!result||!Array.isArray(result.statuses))throw Error('Invalid sync status response');
    u.syncStatuses=result.statuses.filter(status=>status&&typeof status.sourceId==='string'&&['calls','sms','mms','rcs'].includes(status.kind));
    const serverAt=serverTimestamp(result.serverNow),observedAt=monotonicNow();
    // A new response owns its clock anchor. Never combine a newer status with
    // an older server clock when an older API omits or corrupts this field.
    u.syncServerClock=serverAt&&Number.isFinite(observedAt)&&observedAt>=0?{at:serverAt,observedAt}:null;
    u.syncLoaded=true;return {ok:true};
  }catch{
    if(!current())return {discarded:true};
    u.syncError='최신 연결 상태를 확인하지 못했습니다. 문자 목록은 계속 이용할 수 있습니다.';
    return {error:true};
  }finally{if(current()){u.syncLoading=false;onChange?.();}}
}
const syncCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const syncKinds=[['sms','일반 문자 SMS'],['mms','장문·사진 MMS'],['rcs','삼성 채팅+'],['calls','전화 기록']];
const syncStaleAfterMs=6*60000;
export function renderSmsSyncStatuses({profile,data,ui={},now,monotonicNow=monotonicTime}={}){
  if(!canUse(profile))return '';
  const u=stateOf(ui),sources=allowedSources(profile,data).filter(source=>!u.sourceId||source.id===u.sourceId);
  if(!sources.length)return '';
  const clock=u.syncServerClock,observedNow=monotonicNow(),elapsed=clock?observedNow-clock.observedAt:null;
  const serverClock=now===undefined&&clock&&Number.isFinite(clock.at)&&Number.isFinite(observedNow)&&Number.isFinite(clock.observedAt)&&Number.isFinite(elapsed)&&elapsed>=0;
  const currentNow=now===undefined?(serverClock?clock.at+elapsed:Date.now()):now;
  const statuses=list(u.syncStatuses),known=u.syncLoaded===true;
  return `<section class="si-sync" aria-label="휴대폰 자동 동기화 상태"><header><strong>휴대폰 자동 동기화</strong><span>${u.syncLoading?'상태 확인 중…':'마지막 전송 결과'}</span>${profile.role==='admin'?'<button type="button" class="btn ghost small" data-si-open-phone-setup>휴대폰 연결 설정</button>':''}</header><p class="si-sync-note"><strong>아래 건수는 마지막 자동전송 1회의 결과</strong>이며, 백업 파일로 가져온 문자 건수와는 별개입니다. 전체 보관 문자 수가 아닙니다. 자동전송은 연결 시작 이후 최근 7일 범위입니다. 연결 전·7일 이전 기록은 SMS와 MMS·첨부를 모두 포함한 백업 XML로 가져와야 합니다. ${serverClock?'보고 간격은 서버 시각 기준입니다.':'보고 간격은 이 화면을 연 기기의 시각 기준입니다.'}</p>${u.syncError?`<p class="si-sync-error" role="status">${esc(u.syncError)}</p>`:''}<div class="si-sync-sources">${sources.map(source=>{
    const rows=syncKinds.map(([kind,label])=>{
      const status=statuses.filter(row=>row.sourceId===source.id&&row.kind===kind).sort((a,b)=>time(b.receivedAt)-time(a.receivedAt))[0];
      let summary,details='',received='',state='unknown',guidance='';
      if(!status){
        summary=!known?'연결 상태 확인 필요':kind==='rcs'?'채팅+ 자동전송 기록 없음 · v11 연결파일 확인':kind==='mms'?'장문·사진 연결파일 업데이트 필요':kind==='sms'?'문자 자동전송 기록 없음':'통화 자동전송 기록 없음';
        if(known&&['mms','rcs'].includes(kind))details=profile.role==='admin'?'통화 기록 탭 → 휴대폰 연결 설정에서 v11 연결파일을 받아 적용하세요.':'사장님에게 휴대폰 연결파일 업데이트를 요청하세요.';
      }else{
        const noun=kind==='calls'?'통화':'문자',submitted=syncCount(status.submitted),accepted=syncCount(status.accepted),counts=[];
        summary=submitted===0?`연결 응답 있음 · ${noun} 전송 0건`:submitted===null?'연결 응답 있음 · 전송 건수 확인 필요':`${noun} 전송 ${submitted}건${accepted!==null?` · 처리 확인 ${accepted}건`:''}`;
        const unsupported=syncCount(status.unsupported)||0,failed=syncCount(status.failed)||0,malformed=syncCount(status.malformed)||0,pending=syncCount(status.pending)||0;
        state=unsupported||failed||malformed?'attention':pending?'pending':'observed';
        if(state==='attention')summary=`동기화 미완료 · 확인 필요 · ${summary}`;
        else if(state==='pending')summary=`동기화 미완료 · 재확인 대기 · ${summary}`;
        if(kind==='mms'&&unsupported)guidance='지원하지 않는 메시지는 아직 저장되지 않았습니다. Tasker의 MMS 오류코드를 확인하세요. 표시 건수는 마지막 조회 범위이며 전체 과거 누락 건수가 아닙니다. 이전 기간의 장문·사진은 SMS+MMS 백업 XML로 가져오세요.';
        else if(kind==='mms'&&failed)guidance='실패한 MMS는 완료로 처리하지 않았습니다. 휴대폰 네트워크·권한을 확인하고 재실행한 뒤 실제 문자가 저장됐는지 확인하세요.';
        else if(kind==='mms'&&pending)guidance='다운로드 중이거나 재시도 시각을 기다리는 MMS가 있습니다. 미완료 건수가 없어지고 실제 대화가 보이는지 확인하세요.';
        if(kind==='rcs'&&(unsupported||failed||malformed))guidance='읽거나 저장하지 못한 채팅+가 있습니다. 삼성 메시지 저장소·사진 파일 권한과 Tasker의 RCS 오류코드를 확인하세요. 실패한 기록을 완료로 처리하지 않습니다.';
        else if(kind==='rcs'&&pending)guidance='새 메시지를 먼저 확인하며 밀린 기록을 나눠 가져오고 있습니다. 첨부 다운로드·재시도 대기도 포함됩니다. 전체 완료 여부는 다음 보고와 실제 대화를 대조하세요.';
        else if(kind==='rcs')guidance='이 보고는 마지막 조회 범위의 결과입니다. 기기 전체 채팅+의 수집 완료 건수는 아닙니다.';
        if(kind==='mms'&&syncCount(status.collectorVersion)!==null&&status.collectorVersion<9){state='attention';guidance=`연결파일 v${status.collectorVersion} 사용 중 · v9.1 연결파일 업데이트가 필요합니다. ${guidance}`.trim();}
        received=time(status.receivedAt)?stamp(status.receivedAt):'';
        if(syncCount(status.queried)!==null)counts.push(`조회 ${status.queried}건`);
        if(syncCount(status.inserted)!==null&&(!['mms','rcs'].includes(kind)||status.inserted>0))counts.push(`신규 저장 ${status.inserted}건`);
        if(syncCount(status.updated)>0)counts.push(`기존 기록 확인 ${status.updated}건`);
        if(syncCount(status.unsupported)>0)counts.push(`지원하지 않는 형식·주소·크기 ${status.unsupported}건`);
        if(syncCount(status.malformed)>0)counts.push(`읽기 오류 ${status.malformed}건`);
        if(syncCount(status.pending)>0)counts.push(`미완료·재확인 대기 ${status.pending}건`);
        if(syncCount(status.failed)>0)counts.push(`처리 실패 ${status.failed}건`);
        if(syncCount(status.ignored)>0)counts.push(`${kind==='calls'?'기존·수집범위 밖 제외':'제외'} ${status.ignored}건`);
        details=counts.join(' · ');
        const reportAt=time(status.receivedAt),age=Number.isFinite(currentNow)&&reportAt?currentNow-reportAt:null;
        if(age!==null&&age>=syncStaleAfterMs&&source.enabled!==false){
          state='attention';
          summary=`자동전송 확인 필요 · ${Math.floor(age/60000)}분째 새 보고 없음 · 마지막 결과: ${summary}`;
          guidance=`새 실행 보고가 없어 현재 진행 여부를 확인할 수 없습니다. Tasker 실행 상태와 휴대폰 네트워크·배터리 제한을 확인하세요.${guidance?` 마지막 보고 기준: ${guidance}`:''}`;
        }else if((age===null||age<0)&&source.enabled!==false){
          if(state==='observed')state='unknown';
          guidance=`보고 시각을 현재 시각과 대조할 수 없어 자동전송 상태를 판단할 수 없습니다. ${guidance}`.trim();
        }
      }
      if(source.enabled===false){
        state='paused';
        summary=status?`연결 중지 · 마지막 결과: ${summary}`:'연결 중지 · 자동전송 기록 없음';
        guidance=status?'연결을 중지하기 전의 결과입니다.':'';
        if(!status)details='';
      }
      return `<div class="si-sync-row" data-si-sync-kind="${kind}" data-si-sync-state="${state}"><strong>${label}</strong><div><span>${esc(summary)}</span>${received?`<time datetime="${esc(status.receivedAt)}">${esc(received)}</time>`:''}${details?`<small>${esc(details)}</small>`:''}${guidance?`<p class="si-sync-guidance">${esc(guidance)}</p>`:''}</div></div>`;
    }).join('');
    return `<article class="si-sync-source" data-si-sync-source="${esc(source.id)}"><h2>${esc(source.label)}${source.enabled===false?'<span>연결 중지</span>':''}</h2>${rows}</article>`;
  }).join('')}</div></section>`;
}
export function hasSmsFilterDraft(ui={}){
  const u=ui.smsInbox;
  return isSmsHistoryOpen(ui)||!!u&&(!!u.filterFocused||u.queryDraft!==undefined&&u.queryDraft!==u.query||u.sourceDraftId!==undefined&&u.sourceDraftId!==u.sourceId);
}
function visibleThreads(data,sources,sourceId){
  const ids=new Set(sources.map(source=>source.id));
  return list(data?.threads).filter(thread=>ids.has(thread.sourceId)&&(!sourceId||thread.sourceId===sourceId)&&smsThreadKey(thread.sourceId,thread.phone));
}
const threadVersion=thread=>thread?JSON.stringify([thread.lastMessageAt,thread.lastMessageBody,thread.lastSubject,thread.lastTransport,thread.lastAttachmentCount,thread.lastDirection,thread.messageCount]):'';
export function checkedSmsMediaUrl(value){
  let url;try{url=new URL(value);}catch{throw Error('첨부파일 주소를 확인하지 못했습니다. 다시 열어 주세요.');}
  if(url.origin!==MEDIA_ORIGIN||url.protocol!=='https:'||url.username||url.password||url.hash||!url.pathname.startsWith(MEDIA_PREFIX)||url.pathname.length<=MEDIA_PREFIX.length||!url.searchParams.get('token'))throw Error('첨부파일 주소를 확인하지 못했습니다. 다시 열어 주세요.');
  return url.href;
}
export function clearSmsMediaViews(ui={}){
  const u=ui.smsInbox;if(!u)return;
  u.mediaRequest=(u.mediaRequest||0)+1;
  for(const view of u.mediaViews?.values?.()||[]){if(view.timer)clearTimeout(view.timer);view.url='';}
  u.mediaViews?.clear?.();
}
const mediaSize=value=>Number.isFinite(value)&&value>=0?(value>=1048576?`${(value/1048576).toFixed(1)} MB`:`${Math.ceil(value/1024)} KB`):'';
const attachmentList=message=>list(message?.attachments).filter(part=>part&&typeof part.partId==='string'&&part.partId.length<=128&&typeof part.name==='string'&&typeof part.mime==='string'&&Number.isSafeInteger(part.size)&&part.size>=0);
function attachmentMarkup(message,u){
  return attachmentList(message).map(part=>{
    const view=u.mediaViews?.get(part.partId),active=view&&view.messageId===message.id&&view.threadKey===smsThreadKey(u.selected?.sourceId,u.selected?.phone);
    let url='';if(active&&view.url&&view.expiresAt>Date.now()){try{url=checkedSmsMediaUrl(view.url);}catch{}}
    const mime=part.mime.toLowerCase(),error=active?view.error:'';
    let preview='';
    if(url&&IMAGE_MIME.has(mime))preview=`<img class="si-media-image" data-si-media-element="${esc(part.partId)}" src="${esc(url)}" alt="${esc(part.name)}" loading="lazy" referrerpolicy="no-referrer">`;
    else if(url&&AUDIO_MIME.has(mime))preview=`<audio controls preload="metadata" data-si-media-element="${esc(part.partId)}" src="${esc(url)}"></audio>`;
    else if(url&&VIDEO_MIME.has(mime))preview=`<video controls playsinline preload="metadata" data-si-media-element="${esc(part.partId)}" src="${esc(url)}"></video>`;
    return `<section class="si-attachment"><div class="si-attachment-head"><span><strong>${esc(part.name)}</strong><small>${esc(mediaSize(part.size))}</small></span><button type="button" class="btn secondary small" data-si-media-open="${esc(part.partId)}" data-si-media-message="${esc(message.id)}" ${disabled(active&&view.loading)}>${active&&view.loading?'확인 중…':active&&(view.url||view.expired||view.error)?'다시 열기':'첨부 보기'}</button></div>${error?`<p class="si-media-error" role="alert">${esc(error)}</p>`:''}${active&&view.expired&&!error?'<p class="si-media-hint">열람 시간이 지났습니다. 다시 열기를 눌러 주세요.</p>':''}${preview}${url?`<div class="si-media-actions"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" download="${esc(part.name)}">파일 열기</a><button type="button" class="btn ghost small" data-si-media-close="${esc(part.partId)}">닫기</button></div>`:''}</section>`;
  }).join('');
}
const threadPreview=thread=>text(thread.lastMessageBody)||text(thread.lastSubject)||(Number(thread.lastAttachmentCount)>0?`사진·첨부 ${Number(thread.lastAttachmentCount)}개`:thread.lastTransport==='mms'?'장문·사진 문자(MMS)':'내용 없는 문자');
// 상담폼 본문에서 이름·종목·내용을 뽑아 접수 목록 표에 쓴다. 백필("[상담폼·과거] 이름\n강습 종목: 종목\n접수: …")과
// 실시간 메일("[상담폼] 제목\n\n본문") 포맷을 모두 다룬다.
const parseInquiry=body=>{
  const raw=text(body);
  const name=(raw.match(/\[상담폼[^\]]*\]\s*([^\n]+)/)||[])[1]?.trim()||'';
  const sport=(raw.match(/강습\s*종목\s*[:：]\s*([^\n]+)/)||[])[1]?.trim()||'';
  const content=raw.replace(/^\[상담폼[^\]]*\][^\n]*\n?/,'').replace(/강습\s*종목\s*[:：][^\n]*\n?/,'').replace(/접수\s*[:：][^\n]*\n?/,'').replace(/\s*\n\s*/g,' ').trim();
  return {name,sport,content};
};
function checkedDetail(result,key,phone){
  if(!result||smsThreadKey(result.sourceId,result.phone)!==key||!Array.isArray(result.messages)||result.messages.some(message=>normalizeSmsPhone(message.phone)!==phone))throw Error('문자 대화의 전화번호와 수신함을 확인하지 못했습니다.');
  return result;
}

// Root calls this after a successful list poll. Preserve already loaded history
// while guarding every response against login, selection and pagination changes.
export async function refreshSmsThread({root,ui={},profile,data,onAction,onChange,isCurrent=()=>true}={}){
  if(!isCurrent()||!canUse(profile))return {discarded:true};
  const u=stateOf(ui),selected=u.selected;
  if(!selected||!u.detail||u.detailLoading||u.olderLoading||u.pollLoading)return {discarded:true};
  const sources=allowedSources(profile,data);
  if(!sources.some(source=>source.id===selected.sourceId)){
    clearSmsMediaViews(ui);u.detailRequest++;u.pollRequest++;u.selected=null;u.detail=null;u.pollLoading=false;
    if(isCurrent())onChange?.();
    return {discarded:true};
  }
  const key=smsThreadKey(selected.sourceId,selected.phone),phone=normalizeSmsPhone(selected.phone);
  const summary=visibleThreads(data,sources,'').find(thread=>smsThreadKey(thread.sourceId,thread.phone)===key);
  const version=threadVersion(summary);
  if(!summary||version===u.threadVersion)return {discarded:true};
  const request=++u.pollRequest,detailRequest=u.detailRequest,original=u.detail;
  const sameRequest=()=>ui.smsInbox===u&&u.pollRequest===request&&u.detailRequest===detailRequest&&smsThreadKey(u.selected?.sourceId,u.selected?.phone)===key;
  const valid=()=>isCurrent()&&canUse(profile)&&sameRequest();
  const paint=()=>{
    if(!valid()||hasSmsFilterDraft(ui))return;
    const previous=root?.querySelector('[data-si-scroll]');
    const previousTop=previous?.scrollTop||0,atEnd=previous&&previous.scrollHeight-previous.scrollTop-previous.clientHeight<48;
    if(previous)u.scrollRestore={key,top:previousTop,atEnd};
    onChange?.();
    const next=root?.querySelector('[data-si-scroll]');
    if(next)next.scrollTop=atEnd?next.scrollHeight:previousTop;
  };
  if(!valid())return {discarded:true};
  u.pollLoading=true;
  const last=mergeSmsMessages([],original.messages).at(-1);
  let before=null,incoming=[],covered=false;
  try{
    for(let page=0;page<5;page++){
      const result=checkedDetail(await onAction?.('sms-thread-detail',{sourceId:selected.sourceId,phone,limit:100,...(before?{before}:{})}),key,phone);
      if(!valid())return {discarded:true};
      const batch=mergeSmsMessages([],result.messages);
      incoming=mergeSmsMessages(batch,incoming);
      const oldest=batch[0];
      covered=!last||!result.hasMore||!!oldest&&(time(oldest.occurredAt)<time(last.occurredAt)||time(oldest.occurredAt)===time(last.occurredAt)&&String(oldest.id).localeCompare(String(last.id))<=0);
      if(covered)break;
      if(!result.nextBefore||JSON.stringify(before)===JSON.stringify(result.nextBefore))break;
      before=result.nextBefore;
    }
    if(!valid())return {discarded:true};
    if(!covered){u.newMessagesPending=true;paint();return {pending:true};}
    u.detail={...original,messages:mergeSmsMessages(original.messages,incoming)};
    u.threadVersion=version;u.newMessagesPending=false;u.detailError='';paint();
    return {refreshed:true};
  }catch(error){
    if(valid()){u.detailError=error?.message||'최신 문자를 불러오지 못했습니다.';paint();}
    return {discarded:true};
  }finally{if(sameRequest())u.pollLoading=false;}
}
function messagesMarkup(messages,u){
  let previousDay='';
  return mergeSmsMessages([],messages).map(message=>{
    const date=day(message.occurredAt),divider=date!==previousDay?`<li class="si-date"><span>${esc(date)}</span></li>`:'';
    previousDay=date;
    return `${divider}<li class="si-message si-${message.direction}"><article><span class="si-message-direction">${message.direction==='sent'?'보낸 문자':'받은 문자'}${message.transport==='mms'?' · MMS':''}</span>${message.subject?`<h3 class="si-message-subject">${esc(message.subject)}</h3>`:''}${message.body?`<p>${esc(message.body)}</p>`:''}${attachmentMarkup(message,u)}<time datetime="${esc(message.occurredAt)}">${esc(stamp(message.occurredAt))}</time></article></li>`;
  }).join('');
}
function detailMarkup(sources,threads,u,customers,busy,customerTeams){
  const selected=u.selected;
  if(!selected)return '<section class="si-chat si-chat-empty"><strong>전화번호를 선택하세요</strong><p>고객과 주고받은 문자를 시간순으로 볼 수 있습니다.</p></section>';
  const source=sources.find(row=>row.id===selected.sourceId),key=smsThreadKey(selected.sourceId,selected.phone);
  if(!source||!key)return '<section class="si-chat si-chat-empty"><p>이 문자 대화에 접근할 수 없습니다.</p><button type="button" class="btn secondary" data-si-close>목록으로</button></section>';
  const detail=u.detail&&smsThreadKey(u.detail.sourceId,u.detail.phone)===key?u.detail:null;
  const messages=list(detail?.messages).filter(message=>normalizeSmsPhone(message.phone)===normalizeSmsPhone(selected.phone));
  const matches=matchingSmsCustomers(selected.phone,customers,customerTeams);
  const customerId=matches.some(customer=>customer.id===u.customerId)?u.customerId:(matches.length===1?matches[0].id:'');
  const latest=threads.find(thread=>smsThreadKey(thread.sourceId,thread.phone)===key);
  const lastDisplayed=messages.reduce((latestAt,message)=>Math.max(latestAt,time(message.occurredAt)),0);
  const hasNew=u.newMessagesPending||!!detail&&latest&&time(latest.lastMessageAt)>lastDisplayed;
  const bookable=!!canonicalTelephone(selected.phone);
  return `<section class="si-chat" data-si-chat tabindex="-1" aria-label="${esc(formatTelephone(selected.phone))} 문자 대화">
    <header class="si-chat-heading"><div><span>${esc(source.label)}</span><h2>${esc(formatTelephone(selected.phone))}</h2>${matches.length===1?`<p>등록고객 · ${esc(matches[0].name||'이름 없는 고객')}</p>`:''}</div><button type="button" class="btn ghost small" data-si-close aria-label="문자 대화 닫고 목록 보기">목록으로</button></header>
    <div class="si-chat-actions">${matches.length>1?`<label class="si-field"><span>같은 전화번호의 고객 선택</span><select data-si-customer>${option('','고객을 확인하고 선택하세요',customerId)}${matches.map(customer=>option(customer.id,customer.name||'이름 없는 고객',customerId)).join('')}</select></label>`:''}
      <button type="button" class="btn secondary small" data-si-booking ${disabled(busy||!bookable||matches.length>1&&!customerId)}>예약 접수로 →</button><button type="button" class="btn ghost small" data-si-detail-refresh ${disabled(u.detailLoading||u.olderLoading)}>대화 새로고침</button>
      ${!bookable?'<span class="si-muted">예약 접수에는 고객 연락처가 필요합니다.</span>':''}</div>
    ${u.detailError?`<p class="si-error" role="alert">${esc(u.detailError)} <button type="button" class="btn ghost small" data-si-detail-retry ${disabled(u.detailLoading||u.olderLoading)}>다시 시도</button></p>`:''}
    ${u.detailLoading?'<p class="si-loading" role="status">문자를 불러오고 있습니다.</p>':''}
    ${hasNew?'<button type="button" class="si-new-messages" data-si-new-messages>새 문자가 있습니다 · 최신 대화 보기 ↓</button>':''}
    <div class="si-message-scroll" data-si-scroll>
      ${detail?.hasMore?`<div class="si-older"><button type="button" class="btn secondary small" data-si-older ${disabled(u.olderLoading||u.detailLoading)}>${u.olderLoading?'이전 문자 불러오는 중…':'이전 문자 더 보기'}</button></div>`:''}
      ${messages.length?`<ol class="si-messages" aria-label="문자 내역">${messagesMarkup(messages,u)}</ol>`:!u.detailLoading&&!u.detailError?`<div class="si-empty"><p>${detail?'아직 동기화된 문자가 없습니다.':'대화 새로고침을 누르면 문자 내역을 불러옵니다.'}</p></div>`:''}
    </div><footer class="si-chat-footer">문자는 휴대폰에서 보내주세요. 여기서는 동기화된 내역을 확인합니다.</footer>
  </section>`;
}

export function renderSmsInbox({profile,data,ui={},customers=[],customerTeams=[],loading=false,error='',busy=false}={}){
  if(!canUse(profile)){clearSmsMediaViews(ui);return '<section class="si-access"><h2>문자 대화</h2><p>관리자·상담사 로그인 후 이용할 수 있습니다.</p></section>';}
  const u=stateOf(ui),sources=allowedSources(profile,data),threads=visibleThreads(data,sources,u.sourceId);
  u.visibleSourceIds=sources.map(source=>source.id);
  if(u.selected&&!u.visibleSourceIds.includes(u.selected.sourceId))clearSmsMediaViews(ui);
  const total=Math.max(0,Number(data?.total)||0);
  const pageMessageCount=threads.reduce((count,thread)=>count+Math.max(0,Number(thread.messageCount)||0),0);
  const allThreadsVisible=!u.offset&&!data?.hasMore&&threads.length===total;
  const selectedKey=u.selected?smsThreadKey(u.selected.sourceId,u.selected.phone):'';
  return `<section class="sms-inbox" data-sms-inbox>
    <header class="si-heading"><div><h1>문자 대화</h1><p>업장과 전화번호별로 받은 문자·보낸 문자를 확인하세요.</p></div><button type="button" class="btn secondary small" data-si-refresh ${disabled(loading)}>새로고침</button></header>
    <form class="si-filters" data-si-filter-form><label class="si-field"><span>업장 휴대폰</span><select name="sourceId">${option('','전체 휴대폰',u.sourceDraftId)}${sources.map(source=>option(source.id,source.label,u.sourceDraftId)).join('')}</select></label><label class="si-field si-search"><span>전화번호·문자 내용 검색</span><input name="query" type="search" maxlength="120" value="${esc(u.queryDraft)}" placeholder="전화번호 또는 상담 내용"></label><button type="submit" class="btn secondary small" ${disabled(loading)}>검색</button></form>
    <p class="si-scope">휴대폰에서 자동 동기화하거나 백업으로 가져온 문자·장문·사진(MMS) 내역입니다. 첨부는 눌러서 열 수 있습니다. v11 연결파일은 삼성 채팅+ 저장소도 별도로 확인합니다. 자동전송 상태의 삼성 채팅+ 항목에서 적용 여부와 미완료 건수를 확인하세요. 카카오 대화는 자동 수집하지 않습니다. 백업에 완전하게 담긴 채팅+ 기록도 가져올 수 있습니다.</p>
    ${renderSmsSyncStatuses({profile,data,ui})}
    ${renderSmsHistory({profile,ui,sources,busy})}
    ${error||u.error?`<p class="si-error" role="alert">${esc(error||u.error)}</p>`:''}${loading?'<p class="si-loading" role="status">문자 목록을 확인하고 있습니다.</p>':''}
    <div class="si-layout ${u.selected?'has-detail':''}"><section class="si-thread-list" aria-label="전화번호별 문자 목록"><header><strong>전화번호별 대화 ${total}개</strong><span>${allThreadsVisible?'':'이 페이지 '}문자 ${pageMessageCount}건 · 최근 문자순</span></header>
      <div class="si-threads">${threads.map(thread=>{
        const key=smsThreadKey(thread.sourceId,thread.phone),matches=matchingSmsCustomers(thread.phone,customers,customerTeams),source=sources.find(row=>row.id===thread.sourceId);
        const customer=matches.length===1?`등록고객 · ${matches[0].name||'이름 없음'}`:matches.length>1?`같은 번호의 고객 ${matches.length}명`:'';
        return `<button type="button" class="si-thread ${key===selectedKey?'selected':''}" data-si-open data-si-source-id="${esc(thread.sourceId)}" data-si-phone="${esc(thread.phone)}" aria-pressed="${key===selectedKey}"><span class="si-thread-top"><strong>${esc(formatTelephone(thread.phone))}</strong><time>${esc(stamp(thread.lastMessageAt))}</time></span><span class="si-thread-meta"><span>${esc(source?.label||thread.sourceLabel)}</span>${customer?`<strong>${esc(customer)}</strong>`:''}<span>문자 ${Math.max(0,Number(thread.messageCount)||0)}개</span></span><span class="si-thread-preview"><span>${thread.lastDirection==='sent'?'보냄':'받음'}</span>${esc(threadPreview(thread))}</span></button>`;
      }).join('')||(!loading&&!error&&!u.error?`<div class="si-empty"><strong>${sources.length?'이 조건의 문자 대화가 없습니다.':'공유된 문자 수신함이 없습니다.'}</strong><p>${sources.length?'Tasker에서 문자 권한과 연결 설정을 확인한 뒤 동기화해 주세요.':profile.role==='admin'?'휴대폰 연결 설정을 확인해 주세요.':'사장님이 수신함을 공유하면 확인할 수 있습니다.'}</p></div>`:'')}</div>
      <nav class="si-pagination" aria-label="문자 목록 페이지"><button type="button" class="btn ghost small" data-si-page="previous" ${disabled(loading||!u.offset)}>이전</button><span>${total?`${Math.min(total,u.offset+1)}–${Math.min(total,u.offset+threads.length)}`:'0'} / ${total}</span><button type="button" class="btn ghost small" data-si-page="next" ${disabled(loading||!data?.hasMore)}>다음</button></nav>
    </section>${detailMarkup(sources,threads,u,customers,busy,customerTeams)}</div></section>`;
}

// 상담문의(아임웹 상담폼) 전용 접수 목록. 문자 대화와 달리 접수일/이름/전화/종목/내용 표로 보여준다.
// 동기화·과거가져오기 등 폰 전용 UI는 뺀다. 바인딩은 bindSmsInbox를 그대로 재사용(같은 data-si-* 셀렉터).
export function renderFormInbox({profile,data,ui={},customers=[],customerTeams=[],loading=false,error='',busy=false}={}){
  if(!canUse(profile)){clearSmsMediaViews(ui);return '<section class="si-access"><h2>상담문의</h2><p>관리자·상담사 로그인 후 이용할 수 있습니다.</p></section>';}
  const u=stateOf(ui),sources=allowedSources(profile,data),threads=visibleThreads(data,sources,u.sourceId);
  u.visibleSourceIds=sources.map(source=>source.id);
  if(u.selected&&!u.visibleSourceIds.includes(u.selected.sourceId))clearSmsMediaViews(ui);
  const total=Math.max(0,Number(data?.total)||0),selectedKey=u.selected?smsThreadKey(u.selected.sourceId,u.selected.phone):'';
  return `<section class="sms-inbox" data-sms-inbox>
    <header class="si-heading"><div><h1>상담문의 접수</h1><p>아임웹 상담 신청 내역입니다. 행을 누르면 상세 내용과 상담 메모를 볼 수 있습니다.</p></div><button type="button" class="btn secondary small" data-si-refresh ${disabled(loading)}>새로고침</button></header>
    <form class="si-filters" data-si-filter-form><label class="si-field"><span>상담폼</span><select name="sourceId">${sources.map(source=>option(source.id,source.label,u.sourceDraftId||u.sourceId)).join('')}</select></label><label class="si-field si-search"><span>이름·전화번호·내용 검색</span><input name="query" type="search" maxlength="120" value="${esc(u.queryDraft)}" placeholder="이름 또는 전화번호"></label><button type="submit" class="btn secondary small" ${disabled(loading)}>검색</button></form>
    ${error||u.error?`<p class="si-error" role="alert">${esc(error||u.error)}</p>`:''}${loading?'<p class="si-loading" role="status">상담 접수 내역을 확인하고 있습니다.</p>':''}
    <div class="si-layout fi-layout ${u.selected?'has-detail':''}"><section class="si-thread-list" aria-label="상담문의 접수 목록"><header><strong>접수 ${total}건</strong><span>최근 접수순 · 한국 시간</span></header>
      <div class="ci-table-wrap"><table class="ci-table"><thead><tr><th>접수일시</th><th>이름</th><th>전화번호</th><th>종목</th><th>내용</th></tr></thead><tbody>${threads.map(thread=>{
        const key=smsThreadKey(thread.sourceId,thread.phone),q=parseInquiry(thread.lastMessageBody),matches=matchingSmsCustomers(thread.phone,customers,customerTeams);
        const name=q.name||(matches.length===1?matches[0].name:'')||'—',count=Math.max(0,Number(thread.messageCount)||0);
        return `<tr class="${key===selectedKey?'selected':''}" data-si-open data-si-source-id="${esc(thread.sourceId)}" data-si-phone="${esc(thread.phone)}" role="button" tabindex="0" aria-pressed="${key===selectedKey}"><td><strong>${esc(stamp(thread.lastMessageAt))}</strong>${count>1?`<small>재접수 ${count}건</small>`:''}</td><td><strong>${esc(name)}</strong></td><td>${esc(formatTelephone(thread.phone))}</td><td>${esc(q.sport||'—')}</td><td class="ci-last-note">${q.content?`<span>${esc(q.content.slice(0,90))}</span>`:'<span class="si-muted">—</span>'}</td></tr>`;
      }).join('')||(!loading&&!error&&!u.error?`<tr><td colspan="5"><div class="si-empty"><strong>${sources.length?'이 조건의 상담문의가 없습니다.':'공유된 상담폼 수신함이 없습니다.'}</strong><p>${sources.length?'아임웹 상담폼이 들어오면 여기에 접수됩니다.':'사장님이 수신함을 공유하면 확인할 수 있습니다.'}</p></div></td></tr>`:'')}</tbody></table></div>
      <nav class="si-pagination" aria-label="상담문의 페이지"><button type="button" class="btn ghost small" data-si-page="previous" ${disabled(loading||!u.offset)}>이전</button><span>${total?`${Math.min(total,u.offset+1)}–${Math.min(total,u.offset+threads.length)}`:'0'} / ${total}</span><button type="button" class="btn ghost small" data-si-page="next" ${disabled(loading||!data?.hasMore)}>다음</button></nav>
    </section>${u.selected?detailMarkup(sources,threads,u,customers,busy,customerTeams):''}</div></section>`;
}

export function bindSmsInbox(root,{profile,data,ui={},customers=[],customerTeams=[],onChange,onRefresh,onAction,onCreateBooking,onError,onOpenPhoneSetup,isCurrent=()=>true,busy=false}={}){
  if(!canUse(profile))return;
  const u=stateOf(ui),sources=allowedSources(profile,data),sourcesById=new Map(sources.map(source=>[source.id,source]));
  bindSmsHistory(root,{profile,data,ui,sources,onChange,onRefresh,onAction,isCurrent,busy});
  const current=()=>isCurrent()&&canUse(profile)&&ui.smsInbox===u;
  const blocked=()=>typeof busy==='function'?busy():!!busy;
  root.querySelector('[data-si-open-phone-setup]')?.addEventListener('click',()=>{if(current()&&!blocked()&&profile.role==='admin')onOpenPhoneSetup?.();});
  const paint=()=>{if(current())onChange?.();};
  const report=error=>{if(current())onError?.(error?.message||'문자 정보를 불러오지 못했습니다.');};
  const refreshList=()=>{try{Promise.resolve(onRefresh?.()).catch(report);}catch(error){report(error);}};
  const clearDetail=()=>{clearSmsMediaViews(ui);u.detailRequest++;u.pollRequest++;u.selected=null;u.detail=null;u.detailLoading=false;u.olderLoading=false;u.pollLoading=false;u.detailError='';u.customerId='';u.threadVersion='';u.newMessagesPending=false;delete u.scrollRestore;};
  const loadDetail=async(selected,{older=false,refresh=false}={})=>{
    if(!current()||!selected||!sourcesById.has(selected.sourceId))return;
    const phone=normalizeSmsPhone(selected.phone),key=smsThreadKey(selected.sourceId,phone);
    if(!key)return;
    const previousKey=u.selected?smsThreadKey(u.selected.sourceId,u.selected.phone):'';
    if(older&&(previousKey!==key||u.detailLoading||u.olderLoading||!u.detail?.hasMore||!u.detail?.nextBefore))return;
    if(!older&&!refresh&&previousKey===key)return;
    if(!older)clearSmsMediaViews(ui);
    const request=++u.detailRequest,before=older?u.detail.nextBefore:null;
    u.pollRequest++;u.pollLoading=false;
    delete u.scrollRestore;
    const scroll=root.querySelector('[data-si-scroll]'),scrollHeight=scroll?.scrollHeight||0,scrollTop=scroll?.scrollTop||0;
    const existing=older?u.detail:null;
    u.selected={sourceId:selected.sourceId,phone};u.detailError='';u.error='';
    if(older)u.olderLoading=true;
    else{u.detailLoading=true;u.olderLoading=false;if(previousKey!==key){u.detail=null;u.customerId='';}}
    paint();
    const sameRequest=()=>ui.smsInbox===u&&u.detailRequest===request&&smsThreadKey(u.selected?.sourceId,u.selected?.phone)===key;
    const valid=()=>current()&&sameRequest();
    try{
      const result=await onAction?.('sms-thread-detail',{sourceId:selected.sourceId,phone,limit:50,...(before?{before}: {})});
      if(!valid())return;
      checkedDetail(result,key,phone);
      u.detail={...result,messages:mergeSmsMessages(existing?.messages,result.messages)};
      u.threadVersion=threadVersion(visibleThreads(data,sources,'').find(thread=>smsThreadKey(thread.sourceId,thread.phone)===key));
      u.newMessagesPending=false;
    }catch(error){if(valid()){u.detailError=error?.message||'문자 대화를 불러오지 못했습니다.';report(error);}}
    finally{
      if(sameRequest()){u.detailLoading=false;u.olderLoading=false;}
      if(valid()){
        paint();
        globalThis.requestAnimationFrame?.(()=>{
          if(!valid())return;
          const target=root.querySelector('[data-si-scroll]');
          if(target)target.scrollTop=older?Math.max(0,target.scrollHeight-scrollHeight+scrollTop):target.scrollHeight;
          if(!older)root.querySelector('[data-si-chat]')?.focus({preventScroll:true});
        });
      }
    }
  };
  const paintMedia=()=>{
    if(!current())return;
    const scroll=root.querySelector('[data-si-scroll]');
    if(scroll&&u.selected)u.scrollRestore={key:smsThreadKey(u.selected.sourceId,u.selected.phone),top:scroll.scrollTop||0,atEnd:scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<48};
    paint();
  };
  const mediaPart=(messageId,partId)=>{
    if(!u.selected||!sourcesById.has(u.selected.sourceId)||!allowedSources(profile,data).some(source=>source.id===u.selected.sourceId)||u.visibleSourceIds&&!u.visibleSourceIds.includes(u.selected.sourceId))return null;
    if(smsThreadKey(u.detail?.sourceId,u.detail?.phone)!==smsThreadKey(u.selected.sourceId,u.selected.phone))return null;
    const message=list(u.detail?.messages).find(row=>row.id===messageId&&normalizeSmsPhone(row.phone)===normalizeSmsPhone(u.selected.phone));
    return attachmentList(message).find(part=>part.partId===partId)||null;
  };
  root.querySelectorAll('[data-si-media-open]').forEach(button=>button.addEventListener('click',async()=>{
    if(!current())return;
    const partId=button.dataset.siMediaOpen,messageId=button.dataset.siMediaMessage,part=mediaPart(messageId,partId);
    if(!part||u.mediaViews.get(partId)?.loading)return;
    const previous=u.mediaViews.get(partId);if(previous?.timer)clearTimeout(previous.timer);
    const request=++u.mediaRequest,threadKey=smsThreadKey(u.selected.sourceId,u.selected.phone);
    const view={messageId,partId,threadKey,request,loading:true,url:'',expiresAt:0,error:'',expired:false};
    u.mediaViews.set(partId,view);
    const valid=()=>current()&&u.mediaViews.get(partId)===view&&smsThreadKey(u.selected?.sourceId,u.selected?.phone)===threadKey&&!!mediaPart(messageId,partId);
    paintMedia();
    try{
      const result=await onAction?.('sms-media-attachment',{partId});
      if(!valid())return;
      const lifetime=Number(result?.expiresIn);
      if(!result||result.name!==part.name||result.mime!==part.mime||result.size!==part.size||!Number.isFinite(lifetime)||lifetime<=0)throw Error('첨부파일 정보를 확인하지 못했습니다. 대화를 새로고침한 뒤 다시 열어 주세요.');
      view.url=checkedSmsMediaUrl(result.url);view.expiresAt=Date.now()+Math.min(60,lifetime)*1000;
      view.timer=setTimeout(()=>{
        view.url='';view.expired=true;delete view.timer;
        if(valid())paintMedia();
      },Math.min(60,lifetime)*1000);
      view.timer?.unref?.();
    }catch(error){if(valid()){view.url='';view.error=error?.message||'첨부파일을 열지 못했습니다. 다시 시도해 주세요.';}}
    finally{view.loading=false;if(valid())paintMedia();}
  }));
  root.querySelectorAll('[data-si-media-close]').forEach(button=>button.addEventListener('click',()=>{
    if(!current())return;const view=u.mediaViews.get(button.dataset.siMediaClose);if(!view)return;
    if(view.timer)clearTimeout(view.timer);view.url='';u.mediaViews.delete(button.dataset.siMediaClose);paintMedia();
  }));
  root.querySelectorAll('[data-si-media-element]').forEach(element=>element.addEventListener('error',()=>{
    if(!current())return;const view=u.mediaViews.get(element.dataset.siMediaElement);if(!view||!mediaPart(view.messageId,view.partId))return;
    if(view.timer)clearTimeout(view.timer);view.url='';view.expired=true;view.error='첨부파일을 불러오지 못했습니다. 다시 열기를 눌러 주세요.';paintMedia();
  }));
  const filterForm=root.querySelector('[data-si-filter-form]');
  const captureFilters=()=>{if(current()){u.queryDraft=filterForm.elements.namedItem('query').value;u.sourceDraftId=filterForm.elements.namedItem('sourceId').value;}};
  filterForm?.addEventListener('input',captureFilters);
  filterForm?.addEventListener('change',captureFilters);
  filterForm?.addEventListener('focusin',()=>{if(current())u.filterFocused=true;});
  filterForm?.addEventListener('focusout',event=>{if(current()&&!filterForm.contains?.(event.relatedTarget))u.filterFocused=false;});
  filterForm?.addEventListener('submit',event=>{
    event.preventDefault();if(!current())return;
    const form=event.currentTarget,sourceId=form.elements.namedItem('sourceId').value;
    if(sourceId&&!sourcesById.has(sourceId))return;
    clearDetail();u.sourceId=sourceId;u.query=text(form.elements.namedItem('query').value).slice(0,120);u.queryDraft=u.query;u.sourceDraftId=u.sourceId;u.filterFocused=false;u.offset=0;u.error='';paint();refreshList();
  });
  root.querySelectorAll('[data-si-open]').forEach(button=>button.addEventListener('click',()=>{
    const {siSourceId:sourceId,siPhone:phone}=button.dataset;
    const thread=visibleThreads(data,sources,u.sourceId).find(row=>smsThreadKey(row.sourceId,row.phone)===smsThreadKey(sourceId,phone));
    if(thread)void loadDetail(thread);
  }));
  root.querySelector('[data-si-close]')?.addEventListener('click',()=>{if(current()){clearDetail();paint();}});
  for(const selector of ['[data-si-detail-refresh]','[data-si-detail-retry]','[data-si-new-messages]'])root.querySelector(selector)?.addEventListener('click',()=>{if(current())void loadDetail(u.selected,{refresh:true});});
  root.querySelector('[data-si-older]')?.addEventListener('click',()=>{if(current())void loadDetail(u.selected,{older:true});});
  root.querySelector('[data-si-refresh]')?.addEventListener('click',()=>{if(current()){refreshList();if(u.selected)void loadDetail(u.selected,{refresh:true});}});
  root.querySelectorAll('[data-si-page]').forEach(button=>button.addEventListener('click',()=>{
    if(!current())return;
    const next=button.dataset.siPage==='next';
    if(next&&!data?.hasMore||!next&&!u.offset)return;
    clearDetail();u.offset=Math.max(0,u.offset+(next?1:-1)*u.limit);paint();refreshList();
  }));
  root.querySelector('[data-si-customer]')?.addEventListener('change',event=>{if(current()){u.customerId=event.currentTarget.value;paint();}});
  root.querySelector('[data-si-booking]')?.addEventListener('click',()=>{
    if(!current()||blocked()||!u.selected||!sourcesById.has(u.selected.sourceId)||!canonicalTelephone(u.selected.phone))return;
    const matches=matchingSmsCustomers(u.selected.phone,customers,customerTeams),customer=matches.length===1?matches[0]:matches.find(row=>row.id===u.customerId);
    if(matches.length>1&&!customer)return;
    onCreateBooking?.({...u.selected,sourceLabel:sourcesById.get(u.selected.sourceId).label},{matchedCustomer:customer||null});
  });
  if(u.scrollRestore){
    const restore=u.scrollRestore;delete u.scrollRestore;
    const target=root.querySelector('[data-si-scroll]');
    if(current()&&target&&restore.key===smsThreadKey(u.selected?.sourceId,u.selected?.phone))target.scrollTop=restore.atEnd?target.scrollHeight:restore.top;
  }
}
