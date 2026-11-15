// Source-only schedule proposals for one team and one dated lesson. This module
// never confirms a booking or writes data; every result requires staff review.
const list=value=>Array.isArray(value)?value:[];
const idOf=value=>value?.messageId||value?.id;
const epoch=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const received=value=>['received','in','inbound','incoming'].includes(value?.direction);
const sent=value=>['sent','out','outbound','outgoing'].includes(value?.direction);
const pad=value=>String(value).padStart(2,'0');
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const compact=value=>String(value||'').replace(/\s/gu,'');
const scheduleToken=text=>/(?:\d{1,2}\s*(?:월|일|시|:\d{2})|시간|날짜|일정)/u.test(text);
const changeToken=text=>/변경|바꿔|바꿀|바꾸|옮겨|옮길|할게|하겠|부탁|괜찮/u.test(text);
const uncertain=text=>/[?？]|(?:가능|괜찮|될|되)[가-힣\s]{0,8}(?:까요|나요)|궁금|할\s*수|수도|(?:가능하|된다|되|괜찮으시)면|아마|또는|아니면|혹은|중에|사이/u.test(text);
const rejected=text=>/취소|거절|불가|어렵|안\s*(?:됩|되|해|하|바꿔|바꾸)|못\s*(?:합|해|하|바꿔|바꾸)|않|말고|유지|그대로/u.test(text);
const otherTopic=text=>/현금영수증|환불|입금|장비|렌탈|픽업|숙소|주차/u.test(text);
const alternatives=text=>/또는|아니면|혹은|중에|(?:일|시)\s*(?:나|이나)/u.test(text);
const ordered=originals=>[...originals].sort((a,b)=>(epoch(a.occurredAt)??-Infinity)-(epoch(b.occurredAt)??-Infinity));

// Retrieval priority only: return at most 12 original IDs, never an acceptance
// decision. Callers still scope every ID to its source and bound the final set.
export function paymentScheduleEvidenceIds(originals){
  const rows=ordered(list(originals)),ids=[],add=row=>{const id=idOf(row);if(id&&!ids.includes(id)&&ids.length<12)ids.push(id);};
  const anchors=rows.filter(row=>sent(row)&&/강습|수업|레슨/u.test(row.text||'')&&/\d{1,2}\s*월\s*\d{1,2}\s*일/u.test(row.text||'')&&/\d{1,2}\s*[-~–]\s*\d{1,2}\s*시/u.test(row.text||''));
  for(const row of anchors.slice(-2).reverse())add(row);
  for(let index=rows.length-1;index>=0;index--){
    const row=rows[index];if(!received(row)||typeof row.text!=='string'||!scheduleToken(row.text)||!changeToken(row.text))continue;
    add(row);if(sent(rows[index+1]))add(rows[index+1]);
  }
  return ids;
}

function clock(text){
  const match=/^(오전|오후)?\s*(\d{1,2})(?:\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?|\s*:\s*(\d{2}))$/u.exec(text.trim());
  if(!match)return null;let hour=Number(match[2]);const minute=match[4]?30:Number(match[3]??match[5]??0);
  if(hour>23||minute>59||match[1]&&(hour<1||hour>12))return null;
  if(match[1])hour=hour%12+(match[1]==='오후'?12:0);
  // A bare 2시 is not enough to choose 02:00 versus 14:00.
  if(!match[1]&&!match[5]&&hour>=1&&hour<=8)return null;
  return `${pad(hour)}:${pad(minute)}`;
}
function anchorEvidence(anchor,rows){
  if(!dateValid(anchor?.date)||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(anchor?.startTime||''))return null;
  const row=rows.find(row=>idOf(row)===anchor.messageId);if(!row||!sent(row)||!anchor.quote?.trim()||!row.text.includes(anchor.quote))return null;
  const [year,month,day]=anchor.date.split('-').map(Number),hour=Number(anchor.startTime.slice(0,2));
  const datePattern=new RegExp(`(?:(?:${year})\\s*년\\s*)?0?${month}\\s*월\\s*0?${day}\\s*일`,'u');
  const line=anchor.quote.split(/\r?\n/u).find(line=>datePattern.test(line)&&new RegExp(`(?:^|[^0-9])0?${hour}\\s*(?:[-~–]|시|:${anchor.startTime.slice(3)})`,'u').test(line));
  if(!line)return null;
  const explicit=/\d{4}\s*년/u.test(line);
  if(!explicit){
    const at=epoch(row.occurredAt);if(at===null)return null;const local=new Date(at+9*3600000).toISOString().slice(0,10),sourceYear=Number(local.slice(0,4));
    const expected=`${sourceYear}-${pad(month)}-${pad(day)}`;const inferredYear=expected<local?sourceYear+1:sourceYear;
    if(year!==inferredYear||Date.parse(anchor.date)-Date.parse(local)>180*86400000)return null;
  }
  return {row,quote:line.trim(),inferred:!explicit};
}
function dateRange(text,anchorDate){
  const match=/(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*[-~–]\s*(\d{1,2})\s*(?:월|\/)\s*(\d{1,2})\s*일?/u.exec(text);
  if(!match)return null;let year=Number(anchorDate.slice(0,4));const start=`${year}-${pad(match[1])}-${pad(match[2])}`;
  if(Number(match[3])<Number(match[1]))year++;const end=`${year}-${pad(match[3])}-${pad(match[4])}`;
  return dateValid(start)&&dateValid(end)&&end>=start&&Date.parse(end)-Date.parse(start)<=31*86400000?{start,end}:null;
}
function requestedDate(text,currentDate,range){
  const matches=[...text.matchAll(/((?:(\d{4})\s*년\s*)?(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일)\s*(?:로|으로)\s*(?=변경|바꿔|바꿀|바꾸|옮겨|옮길|할게|하겠|해\s*주|부탁|괜찮)/gu)];
  if(matches.length!==1)return null;const target=matches[0],day=Number(target[4]),[year,month,oldDay]=currentDate.split('-').map(Number);
  const before=text.slice(0,target.index),from=/(\d{1,2})\s*일\s*(?:을|에서)/u.exec(before);
  if(from&&Number(from[1])!==oldDay)return null;
  if(target[3]){const selectedYear=target[2]?Number(target[2]):year+(Number(target[3])<month&&Number(target[3])===1&&month===12?1:0),date=`${selectedYear}-${pad(target[3])}-${pad(day)}`;return dateValid(date)?{date,inferred:!target[2],context:'기존 강습 일정의 연도와 원문 월·일'}:null;}
  if(range){const options=[];for(let at=Date.parse(range.start);at<=Date.parse(range.end);at+=86400000){const date=new Date(at).toISOString().slice(0,10);if(Number(date.slice(8))===day)options.push(date);}if(options.length===1)return {date:options[0],inferred:true,context:'앞서 문의한 날짜 범위와 구체적으로 선택한 일자'};}
  if(!from||Number(from[1])!==oldDay||day<oldDay)return null;
  const date=`${year}-${pad(month)}-${pad(day)}`;return dateValid(date)?{date,inferred:true,context:'기존 강습일과 “이전 일자에서 새 일자로” 지정한 변경 문맥'}:null;
}
function requestedTime(text){
  const matches=[...text.matchAll(/((?:오전|오후)?\s*\d{1,2}(?:\s*시(?:\s*\d{1,2}\s*분|\s*반)?|:\d{2}))\s*(?:로|으로)\s*(?=변경|바꿔|바꿀|바꾸|옮겨|옮길|할게|하겠|해\s*주|부탁|진행)/gu)];
  return matches.length===1?clock(matches[0][1]):null;
}
function acknowledgement(text){
  if(text.length>180||uncertain(text)||rejected(text)||otherTopic(text)||/말씀\s*주|알려\s*주|정해\s*주|선택\s*해/u.test(text))return false;
  return /^(?:안녕하세요[\s.!]*|감사합니다[\s.!]*)?(?:네|넵|넹|예|알겠습니다|확인했습니다|확인하였습니다|가능합니다|변경했습니다|변경해드렸습니다|예약\s*변경)/u.test(text.trim());
}

export function resolvePaymentSchedule({anchor,originals,coverageComplete,threadId,teamCount,sessionCount}={}){
  const unavailable=reason=>({status:'unresolved',reason,proposalFacts:[],changes:[],evidenceIds:[],requiresConfirmation:true});
  const input=list(originals);
  if(coverageComplete!==true||teamCount!==1||sessionCount!==1)return unavailable('scope_incomplete_or_multiple');
  if(!input.length||input.length>500||input.some(row=>typeof row?.text!=='string'||!idOf(row)||threadId&&row.threadId&&row.threadId!==threadId||row.excerpt===true||row.suppliedText!==undefined&&row.suppliedText!==row.text))return unavailable('originals_unverified');
  const rows=ordered(input),basis=anchorEvidence(anchor,rows);if(!basis)return unavailable('anchor_unverified');
  const anchorAt=epoch(basis.row.occurredAt);if(anchorAt===null)return unavailable('anchor_time_unknown');
  if(rows.some(row=>epoch(row.occurredAt)===null&&scheduleToken(row.text)&&changeToken(row.text)))return unavailable('schedule_time_unknown');
  if(rows.some(row=>!received(row)&&!sent(row)&&scheduleToken(row.text)&&changeToken(row.text)))return unavailable('schedule_direction_unknown');
  let date=anchor.date,startTime=anchor.startTime,pending=null,range=null;const selected=new Map(),history=new Map();
  const revert=fields=>{for(const field of fields){const stack=history.get(field)||[],previous=stack.pop();if(!previous)continue;if(previous.fact)selected.set(field,previous.fact);else selected.delete(field);if(field==='date')date=previous.value;else startTime=previous.value;}};
  const select=(request,acceptedBy=null)=>{
    for(const [field,value]of Object.entries(request.values)){
      const previousValue=field==='date'?date:startTime;
      if(!request.applied){const stack=history.get(field)||[];stack.push({fact:selected.get(field),value:previousValue});history.set(field,stack);}
      if(field==='date')date=value;else startTime=value;
      const explanation=acceptedBy?'고객이 구체적으로 선택한 변경에 바로 이어진 직원의 수락을 확인했습니다.':'고객의 명확한 변경 선택을 희망 일정 초안에 반영했습니다. 직원의 확정 답변은 아직 확인하지 못했습니다.';
      const reason=`${explanation} ${field==='date'&&request.dateContext?`${request.dateContext}에서 날짜를 연결했습니다. `:''}${field==='date'&&basis.inferred?`기준 안내의 ${anchor.date.slice(0,4)}년은 원문 전송일을 기준으로 추정한 연도이므로 확인이 필요합니다. `:''}실제 예약 확정은 아니며 담당자가 최종 날짜·시간을 확인해야 합니다.`;
      const evidenceIds=[anchor.messageId,...request.contextIds,idOf(request.message),...(acceptedBy?[idOf(acceptedBy)]:[])];
      selected.set(field,{field,value,previousValue:selected.get(field)?.previousValue??previousValue,quote:request.message.text.trim(),messageId:idOf(request.message),occurredAt:request.message.occurredAt,status:acceptedBy?'change_confirmed':'change_requested',draftPreferred:true,requiresConfirmation:true,inferred:field==='date'&&request.dateInferred,reason,evidenceIds:[...new Set(evidenceIds)],...(acceptedBy?{acceptance:{messageId:idOf(acceptedBy),quote:acceptedBy.text.trim(),occurredAt:acceptedBy.occurredAt}}:{})});
    }
    request.applied=true;
  };
  for(const message of rows){
    const at=epoch(message.occurredAt);if(at===null||at<=anchorAt)continue;
    const text=message.text.trim();if(!text)continue;
    const cancellation=!otherTopic(text)&&/(?:예약|강습|수업|일정).{0,12}취소|취소.{0,12}(?:예약|강습|수업|일정)/u.test(text)&&!/취소\s*(?:시|규정|불가)|취소할\s*(?:수|경우)/u.test(text)&&!uncertain(text);
    if(cancellation)return {...unavailable('schedule_cancelled'),status:'blocked',anchor:{...anchor,quote:basis.quote,inferred:basis.inferred},blockedFields:['date','startTime'],evidenceIds:[anchor.messageId,idOf(message)]};
    if(rejected(text)&&!otherTopic(text)&&text.length<=200&&!/규정|일\s*전|변경\s*시|사정에\s*따라/u.test(text)){
      const explicit=[...(/날짜|일정|\d{1,2}\s*일/u.test(text)?['date']:[]),...(/시간|\d{1,2}\s*시/u.test(text)?['startTime']:[])];
      const affected=explicit.length?explicit:pending?Object.keys(pending.values):[];
      if(!pending||pending.applied)revert(affected);pending=null;continue;
    }
    if(received(message)){
      const candidateRange=dateRange(text,date);if(candidateRange)range={...candidateRange,messageId:idOf(message)};
      const nextDate=requestedDate(text,date,range),nextTime=requestedTime(text),values={...(nextDate?{date:nextDate.date}:{}),...(nextTime?{startTime:nextTime}:{})};
      if(!Object.keys(values).length||otherTopic(text)||alternatives(text)){pending=null;continue;}
      const request={message,values,contextIds:nextDate&&range?[range.messageId]:[],dateInferred:nextDate?.inferred,dateContext:nextDate?.context};
      pending=request;
      if(!uncertain(text))select(request);
    }else if(sent(message)){
      if(pending&&at>=epoch(pending.message.occurredAt)&&at-epoch(pending.message.occurredAt)<=48*3600000&&acknowledgement(text)){select(pending,message);pending=null;continue;}
      pending=null;
    }else pending=null;
  }
  if(!selected.size)return unavailable('no_resolved_change');
  const proposalFacts=[...selected.values()],evidenceIds=[...new Set(proposalFacts.flatMap(fact=>fact.evidenceIds))];
  return {status:'resolved',anchor:{...anchor,quote:basis.quote,inferred:basis.inferred},date,startTime,proposalFacts,evidenceIds,requiresConfirmation:true,resolutionType:proposalFacts.every(fact=>fact.status==='change_confirmed')?'customer_choice_acknowledged':'customer_choice_requested',changes:proposalFacts.map(fact=>({threadId,field:fact.field,before:fact.previousValue,after:fact.value,status:fact.status==='change_confirmed'?'confirmed':'requested',quote:fact.quote,messageId:fact.messageId,evidenceIds:fact.evidenceIds}))};
}
