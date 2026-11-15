const text=value=>typeof value==='string'?value:'';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const phoneKey=value=>{let key=text(value).replace(/\D/g,'');if(/^82[1-9][0-9]{7,10}$/.test(key))key='0'+key.slice(2);return key;};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>0&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const captured=row=>row.verification==='external_capture'||row.kind==='kakao';
function safeSource(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function messageTime(row){
  const value=text(row.occurredAt);
  if(validDate(value))return {date:value,epoch:null,label:`${value} · 시간 미확인`,datetime:value};
  const match=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,9})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if(match&&validDate(match[1])){
    const epoch=Date.parse(value);
    if(Number.isFinite(epoch)){
      const korea=new Date(epoch+9*60*60*1000).toISOString(),date=korea.slice(0,10),clock=korea.slice(11,match[4]===undefined?16:19)+(match[5]||'');
      return {date,epoch,label:`${date} ${clock} (KST)`,datetime:value};
    }
  }
  return {date:'',epoch:null,label:row.observedTime?`화면 표시 ${text(row.observedTime)} · 전체 날짜·시간 미확인`:'전체 날짜·시간 미확인',datetime:''};
}
function direction(row){
  const value=text(row.direction).toLowerCase();
  return ['sent','out','outgoing','outbound'].includes(value)?'outgoing':['received','in','incoming','inbound'].includes(value)?'incoming':'unknown';
}
function groupKey(row,index,external){
  const channel=external||captured(row)?'kakao':'sms',source=safeSource(row.sourceUrl),phone=phoneKey(row.phone),thread=text(row.threadId);
  if(thread)return JSON.stringify([channel,text(row.sourceId),source,phone,thread]);
  if(channel==='sms'&&row.sourceId&&phone)return JSON.stringify([channel,text(row.sourceId),phone]);
  // Channel-wide URLs and display names alone do not identify a customer thread.
  if(channel==='kakao'&&/\/chats\/[^/?#]+(?:[?#]|$)/.test(source))return JSON.stringify([channel,source,phone,text(row.displayName)]);
  return JSON.stringify([channel,'unresolved',index]);
}
function bubble(row,external){
  const mode=direction(row),isExternal=external||captured(row),time=messageTime(row),body=text(row.text),source=safeSource(row.sourceUrl);
  const directionLabel=mode==='outgoing'?(isExternal?'보낸 대화':'보낸 문자'):mode==='incoming'?(isExternal?'받은 대화':'받은 문자'):'방향 미확인';
  const kind=isExternal?'카카오 상담':row.kind==='sms'?'일반 문자':row.kind==='mms'?'장문·사진 문자':text(row.kind)||'상담 원문';
  const captureTime=isExternal&&row.capturedAt?messageTime({occurredAt:row.capturedAt}).label:'';
  return `<article class="pr-evidence pr-chat-message pr-chat-${mode}"><header><strong>${esc(directionLabel)}</strong><span>${esc(kind)}</span><time${time.datetime?` datetime="${esc(time.datetime)}"`:''}>${esc(time.label)}</time><span class="pr-chat-verification">${isExternal?'첨부된 대화 원문 · 직접 확인 필요':'저장된 상담 원문'}</span>${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">원문 출처</a>`:''}${captureTime?`<small>캡처 수집 시각 ${esc(captureTime)} · 대화 시각과 별개</small>`:''}</header><div class="pr-chat-bubble"><pre>${esc(body.slice(0,600))}${body.length>600?'…':''}</pre>${body.length>600?`<details class="pr-original-expand"><summary>상담 원문 전체 펼치기</summary><pre>${esc(body)}</pre></details>`:''}${row.excerpt?'<p class="pr-chat-excerpt">수집된 원문의 일부입니다. 원문 출처에서 나머지 내용을 확인하세요.</p>':''}</div></article>`;
}

/** Read-only message bubbles; grouping never establishes a customer identity. */
export function renderPaymentConversation(rows,{external=false,evidenceOnly=false}={}){
  if(!Array.isArray(rows)||!rows.length)return '';
  const groups=new Map();
  rows.forEach((row,index)=>{if(!row||typeof row!=='object')return;const key=groupKey(row,index,external);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row,index,time:messageTime(row)});});
  return [...groups.values()].map(entries=>{
    // Unknown times retain supplied order. Capture times never determine chat order.
    if(entries.every(item=>item.time.epoch!==null))entries.sort((a,b)=>a.time.epoch-b.time.epoch||a.index-b.index);
    const first=entries[0].row,kakao=external||captured(first),title=text(first.sourceLabel)||text(first.channelName)||(kakao?'카카오 상담':'문자 상담'),identity=text(first.phone)||text(first.displayName)||'번호 미확인';
    let previousDate=null;
    const messages=entries.map(({row,time})=>{const date=time.date||'unknown',separator=date===previousDate?'':`<div class="pr-chat-date"><span>${date==='unknown'?'대화 날짜 미확인':`${date.replace(/-/g,'.')} · 한국 시간`}</span></div>`;previousDate=date;return separator+bubble(row,external);}).join('');
    return `<section class="pr-conversation pr-conversation-${kakao?'kakao':'sms'}" aria-label="${esc(title)} 상담 원문"><header class="pr-conversation-header"><span class="pr-chat-channel">${kakao?'KAKAO':'SMS · MMS'}</span><div><strong>${esc(title)}</strong><span>${esc(identity)}${first.phone&&first.displayName?` · ${esc(first.displayName)}`:''}</span></div><small>${entries.length}개 ${evidenceOnly?'인용 근거':'원문'}</small></header><div class="pr-conversation-messages" tabindex="0" role="region" aria-label="${esc(title)} 대화 원문 목록">${messages}</div></section>`;
  }).join('');
}
