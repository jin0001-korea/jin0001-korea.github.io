import {renderPaymentConversation} from './payment-conversation.mjs?v=2';

// 상담·전화 탭의 카카오 채널 열람(읽기 전용, 2026-11-16).
// 수집기(kakao-collect)가 저장한 캡처를 캐치/라이즌별 방 목록 → 원문으로 보여준다.
// lastCapturedAt은 "마지막 성공 수집 시각"이며 대화 시각과 별개다.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text=value=>String(value??'').trim();
const list=value=>Array.isArray(value)?value:[];
const stampFormatter=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const stamp=value=>value&&Number.isFinite(Date.parse(value))?stampFormatter.format(new Date(value)):'—';
const CHANNELS=[['','전체 채널'],['캐치 카카오 상담','캐치'],['라이즌 카카오 상담','라이즌']];

export function kakaoInboxState(ui={}){
  return {label:'',query:'',offset:0,limit:30,loading:false,error:'',data:null,detailKey:'',detail:null,detailLoading:false,detailError:'',...(ui.kakaoInbox||{})};
}
const roomKey=room=>`${room.sourceUrl}::${room.displayName}`;

function sourceCards(collection){
  const sources=list(collection?.sources);
  if(!sources.length)return '';
  return `<div class="ci-sources kk-sources">${sources.map(source=>{
    const label=text(source.sourceLabel).includes('캐치')?'캐치 카카오':'라이즌 카카오';
    const collected=Number(source.captureCount)>0;
    return `<article class="ci-source"><strong>${esc(label)}</strong><span class="ci-badge ${collected?'ci-good':'ci-muted'}">${collected?'수집됨':'수집 전'}</span><small>캡처 ${Number(source.captureCount)||0}건${source.lastCapturedAt?` · 마지막 수집 ${esc(stamp(source.lastCapturedAt))}`:''}</small></article>`;
  }).join('')}</div>`;
}

export function renderKakaoInbox({ui={}}={}){
  const settings=kakaoInboxState(ui);
  const data=settings.data,rooms=list(data?.threads);
  const detailOpen=!!settings.detailKey;
  return `<section class="ci-page kk-page" data-kakao-inbox aria-label="카카오 채널 상담">
  <div class="ci-heading"><div><h2>카카오 채널 상담</h2><p>수집된 캐치·라이즌 카카오 대화를 원문으로 확인합니다. 수집 시각 이후 대화는 다음 수집 때 반영됩니다.</p></div></div>
  ${sourceCards(data?.collection)}
  <form class="ci-filters kk-filters" data-kakao-filters><label><span>채널</span><select name="label">${CHANNELS.map(([value,label])=>`<option value="${esc(value)}" ${settings.label===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label><span>방 이름 검색</span><input name="query" type="search" value="${esc(settings.query)}" placeholder="고객·방 이름 일부" autocomplete="off"></label><button type="submit" class="btn secondary small">조회</button></form>
  ${settings.error?`<p class="ci-error" role="alert">${esc(settings.error)}</p>`:''}
  <div class="ci-layout ${detailOpen?'has-detail':''}">
    <div class="ci-list kk-rooms" role="list">
      ${settings.loading?'<p class="ci-loading" role="status">카카오 상담 방을 불러오는 중…</p>':''}
      ${!settings.loading&&!rooms.length?'<p class="ci-empty">조건에 맞는 수집된 대화가 없습니다.</p>':''}
      ${rooms.map(room=>`<button type="button" class="ci-item kk-room ${settings.detailKey===roomKey(room)?'selected':''}" data-kakao-room="${esc(roomKey(room))}" data-kakao-room-url="${esc(room.sourceUrl)}" data-kakao-room-name="${esc(room.displayName)}"><strong>${esc(room.displayName)}</strong><small>${text(room.sourceLabel).includes('캐치')?'캐치':'라이즌'} · 메시지 ${Number(room.messageCount)||0}개 · 수집 ${esc(stamp(room.lastCapturedAt))}</small></button>`).join('')}
      ${data&&Number(data.total)>rooms.length+settings.offset?`<button type="button" class="btn ghost small" data-kakao-more>더 보기 (${Number(data.total)-settings.offset-rooms.length}개 남음)</button>`:''}
    </div>
    ${detailOpen?`<aside class="ci-detail kk-detail" aria-label="카카오 원문">
      <header><strong>${esc(settings.detail?.displayName||settings.detailKey.split('::')[1]||'')}</strong><button type="button" class="icon-btn" data-kakao-detail-close aria-label="원문 닫기">×</button></header>
      ${settings.detailLoading?'<p class="ci-loading" role="status">원문을 불러오는 중…</p>':''}
      ${settings.detailError?`<p class="ci-error" role="alert">${esc(settings.detailError)}</p>`:''}
      ${settings.detail?renderPaymentConversation(kakaoDetailRows(settings.detail),{external:true}):''}
    </aside>`:''}
  </div></section>`;
}

/** 서버 캡처 행(30건 청크)을 payment-conversation이 합치는 row 배열로 평탄화한다. */
export function kakaoDetailRows(detail){
  const rows=[];
  for(const capture of list(detail?.captures))for(const message of list(capture.messages))
    rows.push({...message,sourceLabel:capture.sourceLabel,sourceUrl:capture.sourceUrl,displayName:capture.displayName,capturedAt:capture.capturedAt,verification:'external_capture'});
  return rows;
}

export function bindKakaoInbox(root,{ui={},onChange,onAction,isCurrent=()=>true}={}){
  const view=root.querySelector('[data-kakao-inbox]');if(!view)return;
  const settings=kakaoInboxState(ui);
  const update=changes=>{ui.kakaoInbox={...kakaoInboxState(ui),...changes};onChange?.();};
  const load=async(changes={})=>{
    const next={...kakaoInboxState(ui),...changes,loading:true,error:''};
    ui.kakaoInbox=next;onChange?.();
    try{
      const result=await onAction('external-threads',{...(next.label?{label:next.label}:{}),...(next.query?{query:next.query}:{}),limit:next.limit,offset:next.offset});
      if(!isCurrent())return;
      if(!Array.isArray(result?.threads))throw new Error('카카오 상담 목록을 확인하지 못했습니다.');
      const previous=next.offset>0?list(ui.kakaoInbox?.data?.threads):[];
      update({loading:false,data:{...result,threads:[...previous,...result.threads]},error:''});
    }catch(error){if(isCurrent())update({loading:false,error:error?.message||'카카오 상담을 불러오지 못했습니다.'});}
  };
  const openDetail=async(url,name)=>{
    const key=`${url}::${name}`;
    update({detailKey:key,detail:null,detailLoading:true,detailError:''});
    try{
      const result=await onAction('external-thread-detail',{sourceUrl:url,displayName:name});
      if(!isCurrent()||kakaoInboxState(ui).detailKey!==key)return;
      if(!Array.isArray(result?.captures))throw new Error('원문을 확인하지 못했습니다.');
      update({detailLoading:false,detail:result});
    }catch(error){if(isCurrent()&&kakaoInboxState(ui).detailKey===key)update({detailLoading:false,detailError:error?.message||'원문을 불러오지 못했습니다.'});}
  };
  view.querySelector('[data-kakao-filters]')?.addEventListener('submit',event=>{
    event.preventDefault();
    const values=new FormData(event.currentTarget);
    void load({label:text(values.get('label')),query:text(values.get('query')),offset:0,detailKey:'',detail:null});
  });
  view.querySelectorAll('[data-kakao-room]').forEach(button=>button.addEventListener('click',()=>{void openDetail(button.dataset.kakaoRoomUrl,button.dataset.kakaoRoomName);}));
  view.querySelector('[data-kakao-more]')?.addEventListener('click',()=>{void load({offset:kakaoInboxState(ui).offset+kakaoInboxState(ui).limit});});
  view.querySelector('[data-kakao-detail-close]')?.addEventListener('click',()=>update({detailKey:'',detail:null,detailError:''}));
  if(!settings.data&&!settings.loading)void load({offset:0});
}
