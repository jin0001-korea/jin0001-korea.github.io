import {normalizeMessagePhone,normalizeMessageRecoveryPhone,normalizeMessageSearchText,messageHistoryDefaultKeywords,filterMessageCandidates} from './message-history-policy.mjs?v=6';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const canManage=(profile,ui)=>profile?.active===true&&profile.role==='admin'&&!profile.must_change_password&&!ui?.booking?.demo;
const enabledSources=sources=>(Array.isArray(sources)?sources:[]).filter(source=>source?.enabled!==false&&source.id);
const disabled=value=>value?'disabled':'';
const bytes=value=>new TextEncoder().encode(value).length;
const FIRST_DAY='2026-10-01';
const MAX_FILE_BYTES=10*1024*1024;
const MAX_BACKUP_BYTES=128*1024*1024;
const STORAGE_ORIGIN='https://ewiekbmjvgktwsbbxrzw.supabase.co';
const SAFE_IMAGES=new Set(['image/jpeg','image/png','image/gif','image/webp','image/bmp']);
const SAFE_AUDIO=new Set(['audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/aac','audio/3gpp']);
const SAFE_VIDEO=new Set(['video/mp4','video/webm','video/3gpp']);
const PAGE_SIZE=30;
const stamp=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export const smsHistoryToday=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function validateSmsHistoryWindow(from,to,now=Date.now()){
  if(!validDay(from)||!validDay(to)||from<FIRST_DAY||from>to||to>smsHistoryToday(now))throw Error('2026년 10월 1일부터 오늘까지의 기간을 선택해 주세요.');
  return {start:Date.parse(`${from}T00:00:00+09:00`),end:Date.parse(`${to}T00:00:00+09:00`)+86400000};
}
export function smsHistoryKeywords(value){
  const words=(Array.isArray(value)?value:String(value??'').split(/[,\n]/u)).map(word=>String(word).trim()).filter(Boolean);
  if(!words.length||words.length>20||words.some(word=>word.length<2||word.length>40||!normalizeMessageSearchText(word)||/[%\u0000-\u001f\u007f]/u.test(word)))throw Error('관련 단어를 쉼표로 구분해 1~20개 적어 주세요. 단어당 2~40자이며 %는 사용할 수 없습니다.');
  return [...new Set(words)];
}
const hasLoneSurrogate=value=>/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function checkedPhone(value){
  const phone=normalizeMessagePhone(value);
  if(!phone)throw Error('파일에 올바르지 않은 전화번호가 있습니다. 다시 내보내 주세요.');
  return phone;
}
export function parseSmsHistoryFile(raw,{sourceId,from,to,keywords,now=Date.now()}={}){
  const {start,end}=validateSmsHistoryWindow(from,to,now),words=smsHistoryKeywords(keywords);
  if(typeof raw!=='string'||bytes(raw)>MAX_FILE_BYTES)throw Error('파일은 10 MB까지 가져올 수 있습니다. 기간을 나누어 내보내 주세요.');
  let file;try{file=JSON.parse(raw);}catch{throw Error('문자 후보 JSON 파일을 선택해 주세요. Tasker 연결파일(XML)은 가져올 수 없습니다.');}
  if(!file||file.format!=='slope-sms-history-v1'||file.sourceId!==sourceId||file.from!==from||file.to!==to||!Array.isArray(file.records)||file.records.length>10000)throw Error('선택한 휴대폰·기간과 파일이 일치하지 않습니다. 파일을 만들 때 사용한 조건을 선택해 주세요.');
  const all=new Map();
  for(const row of file.records){
    if(!row||typeof row!=='object'||typeof row.externalId!=='string'||!/^\d{1,20}$/.test(row.externalId)||!Number.isSafeInteger(row.occurredAt)||row.occurredAt<start||row.occurredAt>=end||row.occurredAt>now+300000||![1,2].includes(row.type)||typeof row.body!=='string'||row.body.length>20000||hasLoneSurrogate(row.body)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.body))throw Error('파일에 날짜나 문자 형식이 맞지 않는 항목이 있습니다. 기간을 확인해 다시 내보내 주세요.');
    const record={externalId:row.externalId,phone:checkedPhone(row.phone),occurredAt:row.occurredAt,type:row.type,body:row.body};
    const earlier=all.get(record.externalId);
    if(earlier&&JSON.stringify(earlier)!==JSON.stringify(record))throw Error('같은 문자 번호에 다른 내용이 있습니다. 해당 휴대폰에서 다시 내보내 주세요.');
    all.set(record.externalId,record);
  }
  const filtered=filterMessageCandidates([...all.values()],words);
  const records=filtered.records.sort((a,b)=>a.occurredAt-b.occurredAt||a.externalId.length-b.externalId.length||a.externalId.localeCompare(b.externalId));
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  const rawRecords=Number.isSafeInteger(file.rawRecords)&&file.rawRecords>=file.records.length?file.rawRecords:null;
  const inRangeRecords=rawRecords!==null&&Number.isSafeInteger(file.inRangeRecords)&&file.inRangeRecords>=file.records.length&&file.inRangeRecords<=rawRecords?file.inRangeRecords:null;
  return {format:file.format,sourceId,from,to,keywords:words,records,rawRecords,inRangeRecords,excludedUnrelated:filtered.excludedUnrelated+count(file.excludedUnrelated),excludedRecruitment:filtered.excludedRecruitment+count(file.excludedRecruitment),duplicateCount:count(file.duplicateCount)+file.records.length-all.size,duplicates:file.records.length-all.size,skippedUnsupported:count(file.skippedUnsupported)};
}
export function smsHistoryBatches({sourceId,from,to,records}){
  const batches=[];let batch=[];
  const size=items=>bytes(JSON.stringify({action:'sms-history-import',sourceId,from,to,records:items}));
  for(const record of records){
    if(size([record])>62000)throw Error('선택한 문자 중 한 건의 내용이 너무 깁니다. 해당 문자를 선택 해제하고 다시 가져와 주세요.');
    if(batch.length&&(batch.length>=100||size([...batch,record])>62000)){batches.push({sourceId,from,to,records:batch});batch=[];}
    batch.push(record);
  }
  if(batch.length)batches.push({sourceId,from,to,records:batch});
  return batches;
}
export function isSmsHistoryOpen(ui={}){return ui.smsInbox?.history?.open===true;}
export function hasSmsHistoryWork(ui={}){const h=ui.smsInbox?.history;return !!h?.open&&(!!h.busy||!!h.reading||!!h.records?.length);}
export function clearSmsHistory(ui={}){
  const h=ui.smsInbox?.history;
  if(h){h.request++;h.open=false;revokeHistoryPreviews(h);h.records=[];h.selected?.clear();h.imported?.clear();clearHistoryPhoneRecovery(h);h.fileName='';h.error='';h.notice='';delete ui.smsInbox.history;}
}
const defaultKeywordsFor=(sources,id)=>messageHistoryDefaultKeywords(sources.find(source=>source.id===id)).join(', ');
function changeHistorySource(h,id,sources){
  if(h.sourceId===id)return;
  h.keywordDrafts??=Object.create(null);
  if(h.sourceId)h.keywordDrafts[h.sourceId]=h.keywords;
  h.sourceId=id;
  h.keywords=Object.hasOwn(h.keywordDrafts,id)?h.keywordDrafts[id]:defaultKeywordsFor(sources,id);
}
function stateOf(ui,sources){
  const u=ui.smsInbox??={};
  const preferred=(sources.find(source=>source.id===u.sourceId)||sources.find(source=>/라이즌|라이젠|raizen/i.test(source.label))||sources[0])?.id||'';
  const h=u.history??={open:false,sourceId:preferred,sourceChosen:false,from:FIRST_DAY,to:smsHistoryToday(),keywords:defaultKeywordsFor(sources,preferred),keywordDrafts:Object.create(null),records:[],selected:new Set(),imported:new Set(),request:0,reading:false,busy:false,error:'',notice:'',fileName:'',query:'',page:0,saved:0,previews:new Map(),issues:[]};
  // Retained state without the new flag may contain an operator's selection.
  h.sourceChosen??=true;
  if(!h.fileName&&!h.reading&&!h.busy&&(!h.open&&!h.sourceChosen||!sources.some(source=>source.id===h.sourceId)))changeHistorySource(h,preferred,sources);
  return h;
}
function candidates(h){
  const query=h.query.trim().toLocaleLowerCase('ko-KR'),phone=normalizeMessagePhone(query);
  return h.records.filter(row=>!query||`${row.phone}\n${row.subject||''}\n${row.body}`.toLocaleLowerCase('ko-KR').includes(query)||(phone&&normalizeMessagePhone(row.phone).includes(phone)));
}
const selectedRecords=h=>h.records.filter(row=>h.selected.has(row.externalId)&&!h.imported.has(row.externalId));
function clearHistoryPhoneRecovery(h){
  h.backupFile=null;h.backupScope=null;h.phoneDiagnostics=[];h.phoneQuery='';h.phoneReview=null;h.phoneError='';
}
const sameHistoryScope=(h,scope)=>!!scope&&h.sourceId===scope.sourceId&&h.from===scope.from&&h.to===scope.to&&h.keywords===scope.keywords;
const parseBackup=(raw,options)=>import('./message-backup-parser.mjs?v=8').then(module=>module.parseMessageBackupXml(raw,options));
// Re-read the local File only on an exact-number lookup. Contact
// labels and diagnostics stay local. Importing original messages is a separate action.
export async function inspectSmsHistoryPhone({ui,history,phone,isCurrent=()=>true,onChange,parse=parseBackup}={}){
  const h=history,current=()=>isCurrent()&&ui.smsInbox?.history===h&&h.open;
  if(!current()||h.busy||h.reading)return {discarded:true};
  h.phoneReview=null;h.phoneError='';
  const canonical=normalizeMessageRecoveryPhone(phone),file=h.backupFile,scope=h.backupScope;
  if(!canonical){h.phoneError='전화번호 전체를 입력해 주세요. 끝번호만으로는 확인하지 않습니다.';onChange?.();return {invalid:true};}
  if(h.fileKind!=='backup'||!file||!sameHistoryScope(h,scope)){h.phoneError='선택한 업장 휴대폰의 SMS·MMS 백업 XML을 먼저 열어 주세요.';onChange?.();return {invalid:true};}
  const request=++h.request;h.reading=true;h.phoneQuery=canonical;onChange?.();
  const unchanged=()=>current()&&h.request===request&&h.backupFile===file&&sameHistoryScope(h,scope);
  try{
    const raw=await file.text();if(!unchanged())return {discarded:true};
    const result=await parse(raw,{sourceId:scope.sourceId,from:scope.from,to:scope.to,keywords:smsHistoryKeywords(scope.keywords),recoveryPhone:canonical});
    if(!unchanged())return {discarded:true};
    const diagnostic=h.phoneDiagnostics?.find(item=>item.phone===canonical)||result.phoneDiagnostics?.find(item=>item.phone===canonical)||{phone:canonical,total:0,sms:0,mms:0,inRange:0};
    const records=diagnostic.recruitmentExcluded?[]:result.records.filter(record=>normalizeMessagePhone(record.phone)===canonical);
    h.phoneReview={phone:canonical,diagnostic,records,scope,file};
    return {records:records.length};
  }catch(error){if(unchanged())h.phoneError=error?.message||'이 백업 파일에서 번호를 확인하지 못했습니다.';return {error};}
  finally{if(h.request===request)h.reading=false;if(current())onChange?.();}
}
export function addSmsHistoryPhoneCandidates({ui,history,isCurrent=()=>true}={}){
  const h=history,review=h.phoneReview;
  if(!isCurrent()||ui.smsInbox?.history!==h||!h.open||h.busy||h.reading||!review||review.file!==h.backupFile||!sameHistoryScope(h,review.scope)||review.phone!==normalizeMessageRecoveryPhone(h.phoneQuery)||review.diagnostic.recruitmentExcluded)return {discarded:true};
  const existing=new Set(h.records.map(record=>record.externalId));let added=0;
  for(const record of review.records){
    if(normalizeMessagePhone(record.phone)!==review.phone||existing.has(record.externalId))continue;
    h.records.push(record);existing.add(record.externalId);added++;
  }
  h.records.sort((a,b)=>a.occurredAt-b.occurredAt||a.externalId.localeCompare(b.externalId));
  h.query=review.phone;h.page=0;review.added=true;
  h.notice=`이 번호의 문자 ${added}건을 후보에 추가했습니다. 아래 원문을 확인하고 가져올 문자를 선택해 주세요. 아직 서버로 전송하지 않았습니다.`;
  return {added};
}
function historyPhoneRecoveryMarkup(h){
  if(h.fileKind!=='backup'||!h.backupFile)return '';
  const review=h.phoneReview,d=review?.diagnostic,count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  const reasons=d?[[d.outsideWindow,'기간 밖'],[d.keywordExcluded,'검색어 미일치'],[d.recruitmentExcluded,'채용 관련 번호'],[d.unsupported,'형식·첨부 문제'],[d.groups,'단체 MMS'],[d.rcs,'RCS·채팅+'],[d.duplicateCount,'파일 내 중복']].filter(([n])=>count(n)>0).map(([n,label])=>`${label} ${n}건`).join(' · '):'';
  const existing=new Set(h.records.map(record=>record.externalId)),available=review?.records.filter(record=>!existing.has(record.externalId)).length||0;
  return `<div data-sh-phone-recovery><div class="sh-file-bar"><label style="width:230px;max-width:100%"><span class="sh-sr-only">누락 확인할 전화번호 전체</span><input type="tel" inputmode="tel" autocomplete="off" style="min-height:44px" data-sh-phone maxlength="40" placeholder="누락 확인할 전화번호 전체" value="${esc(h.phoneQuery||'')}" ${disabled(h.busy||h.reading)}></label><button type="button" class="btn secondary small" style="min-height:44px" data-sh-phone-check ${disabled(h.busy||h.reading)}>번호로 누락 확인</button></div><p class="sh-review-help">검색어 적용 전 이 XML 파일의 SMS·MMS를 번호로 확인합니다. 채용 관련 번호는 계속 제외합니다.</p>${h.phoneError?`<p class="sh-error" role="alert">${esc(h.phoneError)}</p>`:''}${review?`<div class="sh-review-help" role="status" data-sh-phone-diagnostic><strong>${esc(review.phone)} · 이 백업 파일에서 ${count(d.total)}건</strong><br>일반 SMS ${count(d.sms)}건 · 장문·사진 MMS ${count(d.mms)}건 · 선택 기간 내 ${count(d.inRange)}건${reasons?`<br>첫 검사 제외 사유: ${esc(reasons)}`:''}${d.total?`<br>번호 재확인 후 가져올 수 있는 원문 ${review.records.length}건${available?` · 현재 후보에 없는 ${available}건`:''}`:'<br>이 파일에서 찾지 못했습니다. 휴대폰 원문이 없다는 뜻은 아닙니다. 백업 기간·대화 선택·MMS 포함 여부를 확인해 주세요.'}${d.recruitmentExcluded?'<br>채용 관련 대화가 있는 번호이므로 후보에 추가할 수 없습니다.':''}${available&&!d.recruitmentExcluded?`<div class="sh-select-actions"><button type="button" class="btn secondary small" style="min-height:44px" data-sh-phone-add ${disabled(h.busy||h.reading)}>가져올 후보에 ${available}건 추가</button></div>`:''}</div>`:''}</div>`;
}
export function smsHistoryCandidateCounts(records=[]){
  const counts={sms:0,mmsText:0,mmsAttachments:0,conversations:0},phones=new Set();
  for(const row of records){
    if(row.transport==='mms')counts[row.attachments?.length?'mmsAttachments':'mmsText']++;
    else counts.sms++;
    const phone=normalizeMessagePhone(row.phone);if(phone)phones.add(phone);
  }
  counts.conversations=phones.size;
  return counts;
}
export function smsHistoryImportSummary(result={}){
  const valid=value=>Number.isSafeInteger(value)&&value>=0;
  const parts=[];
  if(valid(result.rawRecords))parts.push(`원본 조회·백업 ${result.rawRecords}건`);
  else parts.push('원본 전체 건수 정보가 없는 이전 형식 파일');
  if(valid(result.inRangeRecords))parts.push(`선택 기간 내 ${result.inRangeRecords}건`);
  if(valid(result.transportCounts?.sms)&&valid(result.transportCounts?.mms))parts.push(`파일 원본 SMS ${result.transportCounts.sms}건 · MMS ${result.transportCounts.mms}건`);
  parts.push(`후보 ${Array.isArray(result.records)?result.records.length:0}건`);
  for(const [value,label] of [[result.skippedOutsideWindow,'기간 밖'],[result.excludedRecruitment,'채용 관련 번호'],[result.excludedUnrelated,'검색어 없는 번호'],[result.skippedUnsupported,'형식·첨부 문제'],[result.skippedGroups,'단체 MMS'],[result.skippedRcs,'RCS·채팅+'],[result.duplicateCount??result.duplicates,'파일 내 중복']]){
    if(valid(value)&&value>0)parts.push(`${label} 제외 ${value}건`);
  }
  return parts.join(' · ');
}
// A completed import must not be hidden by a previous inbox search or page.
// Invalidate in-flight detail/media requests before switching the displayed source.
function resetInboxForSavedHistory(ui,sourceId){
  const u=ui.smsInbox;if(!u)return;
  u.sourceId=sourceId;u.sourceDraftId=sourceId;u.query='';u.queryDraft='';u.offset=0;u.filterFocused=false;u.error='';
  u.detailRequest=(u.detailRequest||0)+1;u.pollRequest=(u.pollRequest||0)+1;u.mediaRequest=(u.mediaRequest||0)+1;
  for(const view of u.mediaViews?.values?.()||[]){if(view.timer)clearTimeout(view.timer);view.url='';}
  u.mediaViews?.clear?.();
  Object.assign(u,{selected:null,detail:null,detailLoading:false,olderLoading:false,detailError:'',pollLoading:false,threadVersion:'',newMessagesPending:false,customerId:''});
}
export function historyImportIssues(result={}){
  const notices=Array.isArray(result.issues)?result.issues.filter(item=>typeof item==='string').slice(0,20):[];
  if(Number.isSafeInteger(result.skippedUnsupported)&&result.skippedUnsupported>0)notices.push(`지원하지 않는 형식 또는 누락된 첨부가 있는 ${result.skippedUnsupported}건은 제외되었습니다.`);
  if(Number.isSafeInteger(result.skippedGroups)&&result.skippedGroups>0)notices.push(`여러 수신자가 있는 단체 MMS ${result.skippedGroups}건은 제외되었습니다.`);
  if(Number.isSafeInteger(result.skippedRcs)&&result.skippedRcs>0)notices.push(`RCS·채팅+ 메시지 ${result.skippedRcs}건은 이번 가져오기에서 제외되었습니다.`);
  return [...new Set(notices)];
}
const attachmentKey=(record,part)=>JSON.stringify([record.externalId,part.sha256,part.name,part.mime,part.size]);
export function revokeHistoryPreviews(history){
  for(const preview of history?.previews?.values?.()||[])if(preview?.url)URL.revokeObjectURL(preview.url);
  history?.previews?.clear?.();
}
export function historyAttachmentBlob(part){
  if(!part||typeof part.base64!=='string'||!Number.isSafeInteger(part.size)||part.size<1||part.size>8*1024*1024||!/^[-a-z0-9.+]+\/[-a-z0-9.+]+$/i.test(part.mime||''))throw Error('첨부파일 정보를 확인하지 못했습니다. 백업 파일을 다시 선택해 주세요.');
  let binary;try{binary=atob(part.base64);}catch{throw Error('첨부파일 데이터를 읽지 못했습니다.');}
  if(binary.length!==part.size)throw Error('첨부파일 크기가 맞지 않습니다. 백업 파일을 다시 만들어 주세요.');
  const data=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);
  return new Blob([data],{type:part.mime});
}
export function createHistoryAttachmentPreview(history,record,part){
  const key=attachmentKey(record,part);history.previews??=new Map();
  const previous=history.previews.get(key);if(previous)return previous;
  const preview={url:URL.createObjectURL(historyAttachmentBlob(part)),mime:part.mime,name:part.name};
  history.previews.set(key,preview);return preview;
}
function historyAttachmentsMarkup(record,h){
  if(!Array.isArray(record.attachments)||!record.attachments.length)return '';
  return `<span class="sh-attachments">${record.attachments.map((part,index)=>{
    const preview=h.previews?.get(attachmentKey(record,part)),image=SAFE_IMAGES.has(part.mime),audio=SAFE_AUDIO.has(part.mime),video=SAFE_VIDEO.has(part.mime);
    const media=preview?(image?`<img src="${esc(preview.url)}" alt="${esc(part.name)}" loading="lazy">`:audio?`<audio src="${esc(preview.url)}" controls preload="none"></audio>`:video?`<video src="${esc(preview.url)}" controls preload="metadata"></video>`:''):'';
    return `<span class="sh-attachment"><span><strong>${image?'사진':audio?'음성':video?'영상':'첨부파일'}</strong> ${esc(part.name)} <small>${(part.size/1024).toFixed(0)} KB</small></span>${preview?`${media}<a href="${esc(preview.url)}" download="${esc(part.name)}" data-sh-local-download>파일 저장</a>`:`<button type="button" class="btn ghost small" data-sh-preview-record="${esc(record.externalId)}" data-sh-preview-part="${index}">${image||audio||video?'휴대폰 파일 미리보기':'파일 확인'}</button>`}</span>`;
  }).join('')}</span>`;
}
export function assertSmsMediaUploadUrl(value){
  let url;try{url=new URL(value);}catch{throw Error('첨부파일 업로드 주소를 확인하지 못했습니다.');}
  if(url.origin!==STORAGE_ORIGIN||!url.pathname.startsWith('/storage/v1/object/upload/sign/slope-message-media/')||url.pathname.endsWith('/')||!url.searchParams.get('token')||url.username||url.password||url.hash||/%2f|%5c|\.\./i.test(url.pathname))throw Error('허용되지 않은 첨부파일 업로드 주소입니다.');
  return url.href;
}
export async function importHistoryMediaRecord({record,sourceId,from,to,onAction,isCurrent=()=>true,upload=globalThis.fetch}={}){
  const attachments=Array.isArray(record.attachments)?record.attachments:[];
  if(!isCurrent())return {discarded:true};
  const metadata={externalId:record.externalId,transport:record.transport,phone:record.phone,occurredAt:record.occurredAt,type:record.type,body:record.body,subject:record.subject||'',attachments:attachments.map(({name,mime,size,sha256})=>({name,mime,size,sha256}))};
  const payload={sourceId,from,to,record:metadata};
  if(bytes(JSON.stringify({action:'sms-media-prepare',...payload}))>62000)throw Error('선택한 문자의 본문·제목·첨부파일 정보가 너무 큽니다. 이 문자를 선택 해제하고 나머지를 가져와 주세요.');
  const prepared=await onAction('sms-media-prepare',payload);
  if(!isCurrent())return {discarded:true};
  if(!prepared||typeof prepared.messageId!=='string'||!/^[0-9a-f-]{36}$/i.test(prepared.messageId)||typeof prepared.ready!=='boolean')throw Error('첨부 메시지 저장 준비를 확인하지 못했습니다.');
  if(prepared.ready)return {accepted:1};
  if(!Array.isArray(prepared.parts)||prepared.parts.length!==attachments.length)throw Error('첨부파일 목록을 확인하지 못했습니다. 다시 시도해 주세요.');
  // The store returns fingerprint order. Backup filenames can change between
  // exports, so retries match bytes at each position and retain stored names.
  // Validate the complete manifest before sending any attachment bytes.
  const partIds=new Set();
  const parts=prepared.parts.map((part,index)=>{
    const local=attachments[index];
    if(!part||typeof part.partId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part.partId)||partIds.has(part.partId.toLowerCase())||local.sha256!==part.sha256||local.mime!==part.mime||local.size!==part.size)throw Error('첨부파일 내용과 저장 정보가 일치하지 않습니다.');
    partIds.add(part.partId.toLowerCase());
    return {local,uploadUrl:part.uploadUrl?assertSmsMediaUploadUrl(part.uploadUrl):''};
  });
  for(const {local,uploadUrl} of parts){
    if(!isCurrent())return {discarded:true};
    if(uploadUrl){
      const body=historyAttachmentBlob(local);
      const response=await upload(uploadUrl,{method:'PUT',headers:{'Content-Type':local.mime},body,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
      if(!isCurrent())return {discarded:true};
      if(!response?.ok)throw Error('첨부파일을 저장하지 못했습니다. 다시 가져오기를 누르면 완료된 항목을 이어서 확인합니다.');
    }
  }
  if(!isCurrent())return {discarded:true};
  const completed=await onAction('sms-media-complete',{messageId:prepared.messageId});
  if(!isCurrent())return {discarded:true};
  if(completed?.messageId!==prepared.messageId||completed.ready!==true||completed.accepted!==1)throw Error('첨부 메시지 저장 완료를 확인하지 못했습니다. 다시 시도해 주세요.');
  return {accepted:1};
}
export function renderSmsHistory({profile,ui={},sources=[],busy=false}={}){
  if(!canManage(profile,ui)){clearSmsHistory(ui);return '';}
  const available=enabledSources(sources),h=stateOf(ui,available);
  if(!h.open)return `<div class="sh-entry"><button type="button" class="btn secondary small" data-sh-open ${disabled(busy||!available.length)}>과거 문자 가져오기</button></div>`;
  const source=available.find(row=>row.id===h.sourceId),locked=h.reading||h.busy||!!h.fileName;
  const filtered=candidates(h),page=Math.min(h.page,Math.max(0,Math.ceil(filtered.length/PAGE_SIZE)-1)),visible=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE),selected=selectedRecords(h),counts=smsHistoryCandidateCounts(h.records);
  const phoneLabel=[source?.label,source?.deviceModel].filter(Boolean).join(' · ')||'선택한 휴대폰';
  return `<section class="sms-history" data-sms-history aria-labelledby="sh-title">
    <header class="sh-heading"><div><span>사장님 전용 · 과거 문자</span><h2 id="sh-title" tabindex="-1">일반·장문·사진 문자 가져오기</h2></div><button type="button" class="btn ghost small" data-sh-close ${disabled(h.busy||h.reading)}>닫기</button></header>
    <p class="sh-intro">일반 문자와 장문·사진문자를 휴대폰 백업 파일에서 확인합니다. 채용·강사 지원·이력서 상담이 있는 번호는 대화 전체를 제외하고, 선택한 고객 상담만 저장합니다.</p>
    <form class="sh-form" data-sh-form><label><span>업장 휴대폰</span><select name="sourceId" ${disabled(locked)}>${available.map(row=>`<option value="${esc(row.id)}" ${row.id===h.sourceId?'selected':''}>${esc(row.label)}</option>`).join('')}</select></label><label><span>시작일</span><input name="from" type="date" min="${FIRST_DAY}" max="${smsHistoryToday()}" value="${esc(h.from)}" required ${disabled(locked)}></label><label><span>종료일</span><input name="to" type="date" min="${FIRST_DAY}" max="${smsHistoryToday()}" value="${esc(h.to)}" required ${disabled(locked)}></label><label class="sh-keywords"><span>찾을 단어 · 쉼표로 구분</span><input name="keywords" value="${esc(h.keywords)}" maxlength="820" required ${disabled(locked)}></label></form>
    <p class="sh-review-help">띄어쓰기·줄바꿈·숨은 공백을 구분하지 않고 찾습니다. 검색어가 발견된 전화번호는 선택 기간의 답장·입금자명·사진도 함께 후보로 표시합니다. 확인하고 선택한 내용만 저장합니다.</p>
    <section class="sh-backup-guide" data-sh-backup-guide tabindex="-1"><strong>① SMS·MMS 전체 백업 · 일반 문자 + 장문 + 사진</strong><p><a href="https://play.google.com/store/apps/details?id=com.riteshsahu.SMSBackupRestore" target="_blank" rel="noopener noreferrer">SMS Backup &amp; Restore · SyncTech Pty Ltd</a>의 무료 버전을 사용하세요.</p><ol><li>${esc(phoneLabel)}에서 앱을 열고 <strong>백업 설정 → 메시지</strong>를 선택하세요.</li><li><strong>메시지(SMS)와 MMS 메시지 및 첨부 미디어</strong>를 모두 켜세요. 장문과 사진도 함께 들어갑니다. 가능하면 위 기간으로 범위를 지정하세요.</li><li>저장 위치는 <strong>휴대폰 내부 저장소</strong>로 선택한 뒤 백업하세요. Google Drive 연결은 필요하지 않습니다.</li><li>완료되면 아래에서 <strong>sms-… .xml 백업 파일</strong>을 선택하세요.</li></ol><p>XML 파일은 128MB·20,000건까지, 첨부는 파일당 8MB·문자당 합계 24MB까지 확인합니다. 파일은 이 브라우저에서만 읽습니다. 선택하지 않은 문자는 서버로 보내지 않습니다. 백업에 번호·본문·첨부가 완전하게 들어 있는 채팅+·RCS 기록도 확인합니다. 카카오톡·삭제된 메시지는 가져오지 않습니다. 실시간 채팅+ 동기화는 별도입니다.</p></section>
    <div class="sh-file-bar"><label class="btn secondary sh-file ${locked?'is-disabled':''}">② SMS·MMS 백업 XML 선택<input type="file" accept=".xml,.json,application/xml,text/xml,application/json" data-sh-file ${disabled(locked)}></label>${h.fileName?`<span>${esc(h.fileName)}</span><button type="button" class="btn ghost small" data-sh-reset ${disabled(h.busy||h.reading)}>파일·조건 다시 선택</button>`:'<span>선택한 파일은 이 브라우저에서만 미리 봅니다.</span>'}</div>
    <details class="sh-help" data-sh-legacy-export><summary>이전 Tasker SMS 전용 파일 사용 · 선택 사항</summary><button type="button" class="btn secondary" data-sh-tasker-download ${disabled(h.reading||h.busy||!source)}>Tasker 일반 SMS 전용 내보내기 파일 받기</button><ol><li>${esc(phoneLabel)}의 Chrome에서 위 파일을 받고 Tasker의 <strong>SLOPE 과거문자</strong> 프로젝트로 가져오세요. 기존 통화·문자 자동 동기화 프로젝트는 그대로 둡니다.</li><li>과거 문자 내보내기 작업 전체에서 ▶를 누르세요. 문자·파일 접근 권한이 필요할 수 있습니다.</li><li>완료 후 <strong>Download 폴더의 SLOPE-문자후보… .json 파일</strong>을 선택하세요.</li></ol><p><strong>이 구형 내보내기는 일반 SMS만 포함합니다.</strong> 장문·사진문자는 위 백업 XML을 이용하세요. 과거 장문·사진이 필요하면 SMS와 MMS·첨부 미디어를 모두 백업하세요.</p></details>
    ${h.fileName?`<p class="sh-review-help" data-sh-file-scope><strong>${esc(phoneLabel)}</strong> · ${esc(h.from)} ~ ${esc(h.to)} · ${h.fileKind==='sms-only'?'이전 일반 SMS 전용 파일':'SMS·MMS 백업 XML에 실제 포함된 문자'}를 확인합니다. 휴대폰 전체 문자와 같은 건수인지 확인한 결과는 아닙니다.</p>`:''}
    ${h.fileName&&h.fileKind==='backup'&&h.transportCounts?`<p class="sh-review-help" data-sh-backup-counts>파일 전체: 일반 SMS ${h.transportCounts.sms}건 · 장문·사진 MMS ${h.transportCounts.mms}건. 아래 후보 건수는 기간·검색어·채용 제외를 적용한 결과입니다.</p>${h.transportCounts.mms===0?'<div class="sh-import-issues" role="alert" data-sh-mms-missing><strong>이 백업 XML에는 MMS가 0건입니다.</strong><p>휴대폰에 장문·사진문자가 있다면 MMS 메시지 및 첨부 미디어 옵션을 켜고 다시 백업해 주세요. 아래 파일·조건 다시 선택으로 교체할 수 있습니다.</p></div>':''}`:''}
    ${h.fileName&&h.fileKind==='sms-only'?'<div class="sh-import-issues" role="alert" data-sh-sms-only><strong>이 파일에는 장문·사진 MMS가 없습니다.</strong><p>일반 SMS만 가져왔습니다. ① 안내에 따라 SMS와 MMS 메시지·첨부 미디어를 모두 포함한 백업 XML을 만들어 가져오세요. 기존에 저장한 문자는 중복 추가되지 않습니다.</p></div>':''}
    ${!h.fileName&&h.error?`<p class="sh-error" role="alert">${esc(h.error)}</p>`:''}${!h.fileName&&h.notice?`<p class="sh-notice" role="status">${esc(h.notice)}</p>`:''}${h.reading?'<p class="sh-notice" role="status">휴대폰 파일을 읽고 있습니다… 사진이 많으면 잠시 걸릴 수 있습니다.</p>':''}${h.issues?.length?`<div class="sh-import-issues" role="status"><strong>가져오기에서 제외된 항목을 확인하세요</strong><ul>${h.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul></div>`:''}
    ${historyPhoneRecoveryMarkup(h)}
    ${h.fileName?`<section class="sh-review" aria-label="가져올 문자 선택"><header><strong>후보 ${h.records.length}건 · 선택 ${selected.length}건${h.saved?` · 처리 확인 ${h.saved}건`:''}</strong><label><span class="sh-sr-only">후보 전화번호·내용 검색</span><input type="search" data-sh-query value="${esc(h.query)}" placeholder="후보에서 전화번호·내용 찾기" maxlength="120" ${disabled(h.busy)}></label></header>${h.auditSummary?`<p class="sh-review-help" data-sh-import-summary>파일 첫 검사: ${esc(h.auditSummary)}</p>`:''}<p class="sh-review-help" data-sh-candidate-counts>일반 SMS ${counts.sms}건 · 텍스트 MMS ${counts.mmsText}건 · 사진·첨부 MMS ${counts.mmsAttachments}건 · 전화번호별 대화 ${counts.conversations}개</p><p class="sh-review-help">문자 여러 건이 같은 전화번호의 대화 하나로 묶입니다. 관련 대화의 장문·사진과 답변도 후보로 표시합니다. 개인 대화가 섞이지 않았는지 내용을 확인하고 선택하세요. 채용 관련 번호는 후보에서 제외됩니다.</p><div class="sh-select-actions"><button type="button" class="btn ghost small" data-sh-select="page" ${disabled(h.busy||!visible.length)}>이 페이지 선택</button><button type="button" class="btn ghost small" data-sh-select="all" ${disabled(h.busy||!filtered.length)}>검색된 ${filtered.length}건 선택</button><button type="button" class="btn ghost small" data-sh-select="none" ${disabled(h.busy||!h.selected.size)}>선택 해제</button></div>
      <div class="sh-message-list">${visible.map(row=>`<label class="sh-message ${h.imported.has(row.externalId)?'is-imported':''}"><input type="checkbox" data-sh-record="${esc(row.externalId)}" ${h.selected.has(row.externalId)?'checked':''} ${disabled(h.busy||h.imported.has(row.externalId))}><span><span class="sh-message-meta"><strong>${esc(row.phone)}</strong><time>${esc(stamp(row.occurredAt))}</time><span>${h.imported.has(row.externalId)?'처리 확인':row.type===1?'받은 문자':'보낸 문자'}${row.transport==='mms'?' · MMS':''}</span></span>${row.subject?`<strong class="sh-message-subject">${esc(row.subject)}</strong>`:''}<span class="sh-message-body">${esc(row.body||((row.attachments?.length)?'첨부 메시지':''))}</span>${historyAttachmentsMarkup(row,h)}</span></label>`).join('')||'<p class="sh-empty">이 조건에 맞는 후보 문자가 없습니다.</p>'}</div>
      <nav class="sh-pagination" aria-label="문자 후보 페이지"><button type="button" class="btn ghost small" data-sh-page="previous" ${disabled(h.busy||!page)}>이전</button><span>${filtered.length?`${page*PAGE_SIZE+1}–${Math.min(filtered.length,(page+1)*PAGE_SIZE)} / ${filtered.length}`:'0 / 0'}</span><button type="button" class="btn ghost small" data-sh-page="next" ${disabled(h.busy||(page+1)*PAGE_SIZE>=filtered.length)}>다음</button></nav>
      <footer class="sh-save"><div class="sh-save-copy"><strong>${esc(source?.label||'휴대폰을 확인해 주세요')}</strong><p>${source?.visibility==='staff'?'가져온 문자는 상담사에게도 공유됩니다.':'가져온 문자는 사장님만 볼 수 있습니다.'} 처리 확인 건수에는 기존 저장 문자도 포함되며, 신규 저장 건수와 다릅니다.</p><div class="sh-save-feedback">${h.error?`<p class="sh-error" role="alert">${esc(h.error)}</p>`:''}${h.notice?`<p class="sh-notice" role="status">${esc(h.notice)}</p>`:''}</div></div><div class="sh-save-actions"><button type="button" class="btn primary" data-sh-import ${disabled(h.busy||!selected.length||!source)}>${h.busy?`저장 중… ${h.saved}건 처리 확인`:`③ 선택 ${selected.length}건 가져오기`}</button>${h.saved?`<button type="button" class="btn secondary" data-sh-show-saved ${disabled(h.busy||h.reading)}>저장된 문자 보기</button>`:''}</div></footer></section>`:''}
  </section>`;
}

function download(text,filename,type){
  const url=URL.createObjectURL(new Blob([text],{type})),anchor=document.createElement('a');
  try{anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export async function importSelectedSmsHistory({ui,history,onAction,isCurrent=()=>true,onChange,onRefresh,upload=globalThis.fetch}={}){
  const h=history;
  const current=()=>isCurrent()&&ui.smsInbox?.history===h&&h.open;
  if(!current()||h.busy||h.reading)return {discarded:true};
  const records=selectedRecords(h);if(!records.length)return {discarded:true};
  const mediaRecords=records.filter(row=>/^backup-(?:sms|mms):/.test(row.externalId));
  const batches=smsHistoryBatches({sourceId:h.sourceId,from:h.from,to:h.to,records:records.filter(row=>!/^backup-(?:sms|mms):/.test(row.externalId))});
  const operations=[...batches.map(batch=>({batch})),...mediaRecords.map(record=>({record}))];
  h.busy=true;h.error='';h.notice='선택한 문자를 저장하고 있습니다.';onChange?.();
  try{
    for(const operation of operations){
      if(!current())return {discarded:true};
      const {batch,record}=operation;
      const result=record?await importHistoryMediaRecord({record,sourceId:h.sourceId,from:h.from,to:h.to,onAction,isCurrent:current,upload}):await onAction('sms-history-import',batch);
      if(!current()||result?.discarded)return {discarded:true};
      const completedRecords=record?[record]:batch.records;
      if(!result||result.accepted!==completedRecords.length||(!record&&result.ignored!==0))throw Error('저장 결과를 확인하지 못했습니다. 다시 가져오면 이미 저장된 문자는 중복 추가되지 않습니다.');
      for(const row of completedRecords){h.imported.add(row.externalId);h.selected.delete(row.externalId);}
      h.saved+=completedRecords.length;h.notice=`${h.saved}건 처리 확인했습니다. 남은 문자를 처리하고 있습니다.`;onChange?.();
    }
    h.notice=`선택한 문자 ${h.saved}건 처리 확인 완료. 기존에 저장된 문자도 포함된 건수입니다. ‘저장된 문자 보기’를 누르면 전화번호별 대화 목록으로 이동합니다.${h.fileKind==='sms-only'?' 장문·사진 MMS는 아직 이 파일로 가져오지 않았습니다.':''}`;
    return {accepted:records.length};
  }catch(error){if(current()){h.error=error?.message||'문자를 저장하지 못했습니다. 다시 시도해 주세요.';h.notice=`${h.saved}건 처리 확인 · 선택된 ${selectedRecords(h).length}건은 다시 가져올 수 있습니다.`;}return {error};}
  finally{h.busy=false;if(current()){if(h.saved)resetInboxForSavedHistory(ui,h.sourceId);onChange?.();if(h.saved)onRefresh?.();}}
}
export function bindSmsHistory(root,{profile,ui={},sources=[],onChange,onRefresh,onAction,isCurrent=()=>true,busy=false,onDownload=download,upload=globalThis.fetch}={}){
  if(!canManage(profile,ui))return;
  const available=enabledSources(sources),h=stateOf(ui,available);
  const current=()=>isCurrent()&&canManage(profile,ui)&&ui.smsInbox?.history===h;
  const blocked=()=>h.busy||h.reading||(typeof busy==='function'?busy():busy);
  const paint=()=>{if(current())onChange?.();};
  root.querySelector('[data-sh-open]')?.addEventListener('click',()=>{if(!current()||blocked()||!available.length)return;h.open=true;paint();globalThis.requestAnimationFrame?.(()=>root.querySelector('#sh-title')?.focus({preventScroll:true}));});
  root.querySelector('[data-sh-close]')?.addEventListener('click',()=>{if(!current()||blocked())return;const saved=h.saved;clearSmsHistory(ui);onChange?.();if(saved)onRefresh?.();});
  root.querySelector('[data-sh-show-saved]')?.addEventListener('click',()=>{
    if(!current()||blocked()||!h.saved)return;
    resetInboxForSavedHistory(ui,h.sourceId);
    // Keep any failed selections so reopening this panel can resume the import.
    h.open=false;revokeHistoryPreviews(h);paint();onRefresh?.();
    globalThis.requestAnimationFrame?.(()=>root.querySelector('.si-thread-list')?.scrollIntoView({block:'nearest'}));
  });
  const form=root.querySelector('[data-sh-form]');
  const capture=event=>{
    if(!current()||h.fileName||blocked()||!form)return;
    const nextSource=form.elements.namedItem('sourceId').value,sourceChanged=nextSource!==h.sourceId;
    if(!available.some(source=>source.id===nextSource))return;
    if(event?.target?.name==='sourceId'||sourceChanged)h.sourceChosen=true;
    for(const name of ['from','to','keywords'])h[name]=form.elements.namedItem(name).value;
    if(sourceChanged){
      changeHistorySource(h,nextSource,available);
      // A select may emit both input and change. Keep a detached form's second
      // event from copying the previous phone's words back over the new ones.
      form.elements.namedItem('keywords').value=h.keywords;
      paint();
    }
  };
  form?.addEventListener('input',capture);form?.addEventListener('change',capture);
  form?.addEventListener('submit',event=>{event.preventDefault();capture();});
  root.querySelector('[data-sh-tasker-download]')?.addEventListener('click',async event=>{
    event.preventDefault();if(!current()||blocked())return;capture();h.error='';
    const source=available.find(row=>row.id===h.sourceId);if(!source)return;
    try{
      validateSmsHistoryWindow(h.from,h.to);const keywords=smsHistoryKeywords(h.keywords);
      const request=++h.request;h.reading=true;paint();
      const module=await import('./sms-history-export.mjs?v=7');
      if(!current()||!h.open||request!==h.request)return;
      const args={source,from:h.from,to:h.to,keywords};
      const xml=module.buildSmsHistoryExportProject(args);
      onDownload(xml,module.smsHistoryTaskerFilename(args),'application/xml;charset=utf-8');
      h.notice='일반 SMS 전용 내보내기 설정을 받았습니다. Tasker에 별도 프로젝트로 가져온 뒤 과거 문자 내보내기를 실행해 주세요. 장문·사진 MMS는 위 안내의 백업 XML을 이용하세요.';
    }catch(error){if(current())h.error=error?.message||'내보내기 파일을 만들지 못했습니다.';}
    finally{h.reading=false;paint();}
  });
  root.querySelector('[data-sh-file]')?.addEventListener('change',async event=>{
    if(!current()||blocked()||h.fileName)return;capture();
    const file=event.currentTarget.files?.[0];if(!file)return;
    h.error='';h.notice='';const scope={sourceId:h.sourceId,from:h.from,to:h.to,keywords:h.keywords};const request=++h.request;h.reading=true;paint();
    try{
      if(file.size>MAX_BACKUP_BYTES)throw Error('백업 XML은 128 MB까지 가져올 수 있습니다. 기간을 나누어 백업해 주세요.');
      const raw=await file.text();
      if(!current()||!h.open||h.request!==request||!sameHistoryScope(h,scope))return;
      const options={sourceId:scope.sourceId,from:scope.from,to:scope.to,keywords:smsHistoryKeywords(scope.keywords)};
      const parsed=raw.trimStart().startsWith('<')?await parseBackup(raw,options):parseSmsHistoryFile(raw,options);
      if(!current()||!h.open||h.request!==request||!sameHistoryScope(h,scope))return;
      revokeHistoryPreviews(h);
      h.issues=historyImportIssues(parsed);
      h.auditSummary=smsHistoryImportSummary(parsed);
      clearHistoryPhoneRecovery(h);
      h.fileKind=parsed.format==='slope-sms-history-v1'?'sms-only':'backup';
      if(h.fileKind==='backup'){h.backupFile=file;h.backupScope=scope;h.phoneDiagnostics=parsed.phoneDiagnostics||[];}
      h.transportCounts=parsed.transportCounts;h.inRangeTransportCounts=parsed.inRangeTransportCounts;
      h.records=parsed.records;h.selected=new Set();h.imported=new Set();h.saved=0;h.fileName=file.name;h.page=0;h.query='';
      h.notice=`관련 문자 후보 ${parsed.records.length}건입니다. 내용을 확인하고 가져올 문자를 선택하세요.${parsed.excluded?` 관련 단어가 없는 ${parsed.excluded}건은 제외했습니다.`:''}${parsed.excludedRecruitment?` 채용 관련 번호의 문자 ${parsed.excludedRecruitment}건은 제외했습니다.`:''}${parsed.excludedUnrelated?` 검색어가 없는 대화의 문자 ${parsed.excludedUnrelated}건은 제외했습니다.`:''}`;
    }catch(error){if(current()&&h.request===request)h.error=error?.message||'파일을 읽지 못했습니다.';}
    finally{h.reading=false;paint();}
  });
  root.querySelector('[data-sh-reset]')?.addEventListener('click',()=>{if(!current()||blocked())return;h.request++;revokeHistoryPreviews(h);clearHistoryPhoneRecovery(h);h.issues=[];h.auditSummary='';h.records=[];h.selected.clear();h.imported.clear();h.fileName='';h.fileKind='';h.transportCounts=null;h.inRangeTransportCounts=null;h.error='';h.notice='';h.query='';h.page=0;h.saved=0;paint();});
  root.querySelector('[data-sh-phone]')?.addEventListener('input',event=>{
    if(!current()||blocked())return;
    h.phoneQuery=event.currentTarget.value;h.phoneReview=null;h.phoneError='';
    const position=event.currentTarget.selectionStart;paint();const input=root.querySelector('[data-sh-phone]');input?.focus?.({preventScroll:true});try{input?.setSelectionRange?.(position,position);}catch{}
  });
  const inspectPhone=async()=>{
    if(!current()||blocked()||!available.some(source=>source.id===h.sourceId))return;
    await inspectSmsHistoryPhone({ui,history:h,phone:root.querySelector('[data-sh-phone]')?.value??h.phoneQuery,isCurrent:current,onChange:paint});
  };
  root.querySelector('[data-sh-phone-check]')?.addEventListener('click',inspectPhone);
  root.querySelector('[data-sh-phone]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();return inspectPhone();}});
  root.querySelector('[data-sh-phone-add]')?.addEventListener('click',()=>{
    if(!current()||blocked()||!available.some(source=>source.id===h.sourceId))return;
    const result=addSmsHistoryPhoneCandidates({ui,history:h,isCurrent:current});if(result.discarded)return;paint();root.querySelector('.sh-review')?.scrollIntoView?.({block:'nearest'});
  });
  root.querySelector('[data-sh-query]')?.addEventListener('input',event=>{
    if(!current()||blocked())return;h.query=event.currentTarget.value;h.page=0;
    const position=event.currentTarget.selectionStart;paint();const input=root.querySelector('[data-sh-query]');input?.focus({preventScroll:true});try{input?.setSelectionRange(position,position);}catch{}
  });
  root.querySelectorAll('[data-sh-record]').forEach(input=>input.addEventListener('change',()=>{if(!current()||blocked()||h.imported.has(input.dataset.shRecord))return;if(input.checked)h.selected.add(input.dataset.shRecord);else h.selected.delete(input.dataset.shRecord);paint();}));
  root.querySelectorAll('[data-sh-select]').forEach(button=>button.addEventListener('click',()=>{if(!current()||blocked())return;const mode=button.dataset.shSelect;if(mode==='none')h.selected.clear();else{let rows=candidates(h);if(mode==='page')rows=rows.slice(h.page*PAGE_SIZE,(h.page+1)*PAGE_SIZE);for(const row of rows)if(!h.imported.has(row.externalId))h.selected.add(row.externalId);}paint();}));
  root.querySelectorAll('[data-sh-page]').forEach(button=>button.addEventListener('click',()=>{if(!current()||blocked())return;h.page=Math.max(0,Math.min(Math.ceil(candidates(h).length/PAGE_SIZE)-1,h.page+(button.dataset.shPage==='next'?1:-1)));paint();root.querySelector('.sh-review')?.scrollIntoView({block:'nearest'});}));
  root.querySelectorAll('[data-sh-preview-record]').forEach(button=>button.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation?.();if(!current()||blocked())return;
    const record=h.records.find(row=>row.externalId===button.dataset.shPreviewRecord),part=record?.attachments?.[Number(button.dataset.shPreviewPart)];
    if(!record||!part)return;
    try{createHistoryAttachmentPreview(h,record,part);paint();}catch(error){h.error=error?.message||'첨부파일을 열지 못했습니다.';paint();}
  }));
  root.querySelectorAll('[data-sh-local-download]').forEach(link=>link.addEventListener('click',event=>event.stopPropagation?.()));
  root.querySelector('[data-sh-import]')?.addEventListener('click',async()=>{
    if(!current()||blocked()||!available.some(source=>source.id===h.sourceId))return;
    try{await importSelectedSmsHistory({ui,history:h,onAction,isCurrent:()=>current()&&canManage(profile,ui),onChange:paint,onRefresh,upload});}catch(error){if(current()){h.error=error?.message||'문자 선택을 확인해 주세요.';paint();}}
  });
}
