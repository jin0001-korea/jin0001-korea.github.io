import {canonicalTelephone,normalizeCustomerText} from './customer-teams.mjs?v=26';
import {parseKstDate,parseLessonInterval} from './booking-rules.mjs?v=34';

// Read-only preference proposals. No identity link, assignment, availability
// override, reservation write or notification is produced by this helper.
const list=value=>Array.isArray(value)?value:[];
const text=value=>normalizeCustomerText(value);
const raw=row=>row?.raw||row?.raw_data||{};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const idOf=row=>text(row?.id||row?.scheduleId||row?.schedule_id);
const customerId=row=>text(row?.customerId||row?.customer_id);
const teamId=row=>text(row?.teamId||row?.customerTeamId||row?.customer_team_id);
const customerName=row=>text(row?.customerName||raw(row).H);
const teamName=row=>text(row?.teamName||raw(row).I);
const unique=values=>[...new Set(values.filter(Boolean))];
const cancelled=row=>['cancelled','canceled','deleted'].includes(row?.status)||!!(row?.cancelledAt||row?.cancelled_at||row?.deletedAt||row?.deleted_at);
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const sport=value=>({ski:'스키',board:'보드'})[value]||text(value);
const rowPhoneMatches=(row,phone)=>phone&&[row?.phone,row?.customerContactPhone,row?.customer_contact_phone,raw(row).L].some(value=>canonicalTelephone(value)===phone);
const customerPhoneMatches=(row,phone)=>phone&&list(row?.contacts).some(contact=>canonicalTelephone(contact?.phone)===phone);
const personId=row=>text(row?.user_id||row?.userId||row?.id);
const personName=row=>text(row?.display_name||row?.displayName||row?.name);
const activeInstructor=row=>row?.active===true&&row?.role==='instructor'&&uuid(personId(row));
const timestamp=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;

function scopedOriginals(originals,candidate,phone){
  const external=new Set(list(candidate?.externalEvidence).map(row=>row.sourceUrl).filter(Boolean));
  return list(originals).filter(row=>{
    if(typeof row?.text!=='string'||!row.text.trim())return false;
    if(row.threadId&&candidate?.threadId&&row.threadId!==candidate.threadId)return false;
    if(candidate?.sourceId){if(row.sourceId!==candidate.sourceId)return false;}
    else if(!row.sourceUrl||!external.has(row.sourceUrl))return false;
    return !row.phone||!phone||canonicalTelephone(row.phone)===phone;
  });
}

function instructorRequest(originals){
  const events=[];
  for(const original of originals)for(const line of original.text.split(/\r?\n/u)){
    const teacherContext=/강사|선생|쌤|코치/u.test(line)||/강사|선생|쌤|코치/u.test(original.text)&&/(?:다른|새로운)\s*분|지정\s*취소/u.test(line);
    if(!teacherContext||/일반\s*(?:안내|규정)|유의\s*사항|가격표|요금표|프로모션|광고/u.test(line))continue;
    if(['sent','outgoing'].includes(original.direction)&&/(?:변경|교체)[^\n.!?]{0,35}(?:경우|가능|불가|될\s*수|수\s*있|시\s*추가)/u.test(line)&&!/(?:변경|교체)(?:했습니다|해드|\s*완료)|요청하신/u.test(line))continue;
    const negated=/(?:변경|교체)\s*(?:요청)?\s*(?:없|안\s*함|하지\s*(?:않|말))|(?:변경|교체)\s*요청(?:은|을)?\s*취소/u.test(line);
    const different=/(?:다른|새로운|새)\s*(?:분|강사|선생|쌤|코치)/u.test(line)||!negated&&/(?:강사|선생(?:님)?|쌤|코치)[^\n.!?]{0,35}(?:말고|아닌|제외|원하지|바꿔|바꾸)|(?:변경|교체|바꿔|바꾸)[^\n.!?]{0,20}(?:강사|선생|쌤|코치)/u.test(line);
    const change=different||!negated&&/(?:강사|선생(?:님)?|쌤|코치)[^\n.!?]{0,35}(?:변경|교체)|(?:강사\s*)?지정\s*(?:취소|하지\s*않)|(?:강사|선생(?:님)?|쌤|코치)[^\n.!?]{0,25}(?:아무나|누구든|상관없)/u.test(line);
    const resume=!different&&(negated||/(?:기존|이전|원래|같은|동일한)\s*(?:담당\s*)?(?:강사|선생(?:님)?|쌤|코치)(?:님)?[^\n.!?]{0,20}(?:그대로|부탁|진행|해주세요|원해|좋겠|다시)/u.test(line));
    if(change||resume)events.push({type:change?'change':'resume',quote:line.trim(),messageId:text(original.messageId||original.id),occurredAt:original.occurredAt||null,at:timestamp(original.occurredAt)});
  }
  if(!events.some(row=>row.type==='change'))return {blocked:false};
  if(events.some(row=>!Number.isFinite(row.at)))return {blocked:true,reason:'강사 변경·지정 취소 요청이 있어 기존 강사를 자동으로 제안하지 않습니다. 원문의 최종 요청을 확인해 주세요.',events};
  const latest=Math.max(...events.map(row=>row.at)),current=events.filter(row=>row.at===latest);
  if(current.some(row=>row.type==='change'))return {blocked:true,reason:'최근 상담에 강사 변경·지정 취소 요청이 있어 기존 강사를 자동으로 제안하지 않습니다.',events:current};
  return {blocked:false,events:current};
}

function assignment(row,schedule){
  for(const value of [row,schedule]){
    for(const key of ['instructorIds','instructorUserIds','instructor_ids','instructor_user_ids'])if(own(value,key)&&Array.isArray(value[key]))return {ids:unique(value[key].map(text)),name:'',explicit:true};
    for(const key of ['instructorUserId','instructor_user_id'])if(text(value?.[key]))return {ids:[text(value[key])],name:'',explicit:true};
  }
  return {ids:[],name:text(row?.instructorName||row?.instructor_name||raw(row).F||schedule?.instructorName||schedule?.instructor_name),explicit:false};
}

function priorTiming(row,schedule,now,desiredDate,desiredStart){
  const date=parseKstDate(row?.date||raw(row).A);if(!date)return null;
  const interval=parseLessonInterval(schedule||row);
  // A date-only history record becomes eligible only after that entire Korean
  // calendar day has ended; no unrecorded lesson duration is invented.
  const end=interval.error?Date.parse(`${date}T23:59:59.999+09:00`):Date.parse(interval.end);
  if(!Number.isFinite(end)||end>now||Number.isFinite(desiredStart)&&end>desiredStart||!Number.isFinite(desiredStart)&&desiredDate&&date>=desiredDate)return null;
  return {date,end};
}

/** Prefer the last unambiguous actual teacher without linking the customer. */
export function buildPaymentInstructorHistoryProposal({draft={},registrationFields={},candidate={},originals=[],coverageComplete=false,customerContext=null,bookingContext={},currentTeamCount=1,now=Date.now()}={}){
  const result={version:1,status:'unavailable',registrationFields:{},needsStaffConfirmation:true,reason:'같은 고객·팀의 이전 담당 강사 이력을 확인하지 못했습니다.',warnings:[],evidence:null};
  const blocked=(code,reason)=>({...result,status:'blocked',reason,warnings:[{code,message:reason}]});
  if(text(registrationFields.preferredInstructorId)||text(registrationFields.preferredInstructor))return {...result,status:'preserved',reason:'직접 선택했거나 상담에서 요청한 강사를 유지합니다.'};
  const phone=canonicalTelephone(draft.phone||candidate.phone),selectedCustomer=text(draft.customerId),selectedTeam=text(draft.teamId||draft.customerTeamId),company=text(draft.company),currentSport=sport(draft.sport);
  if(!phone&&!selectedCustomer)return result;
  if(!['스키','보드'].includes(currentSport)||!company)return result;
  const sources=scopedOriginals(originals,candidate,phone);
  if(coverageComplete!==true||!sources.length)return blocked('INSTRUCTOR_SOURCE_INCOMPLETE','최신 상담 원문을 충분히 확인하지 못해 이전 강사 자동 제안을 보류합니다.');
  const request=instructorRequest(sources);if(request.blocked)return {...blocked('INSTRUCTOR_CHANGE_REQUEST',request.reason),evidence:{requests:request.events}};
  const contextMatches=!!customerContext&&canonicalTelephone(customerContext.phone)===phone&&(!candidate.sourceId||!customerContext.sourceId||customerContext.sourceId===candidate.sourceId);
  const exactContext=contextMatches?customerContext:null;
  const customers=[...list(bookingContext.customers).filter(row=>!row.deleted_at&&!row.deletedAt&&customerPhoneMatches(row,phone)),...list(exactContext?.customers)];
  const matchingCustomerIds=new Set(customers.map(row=>text(row.id)).filter(Boolean));
  const allTeams=[...list(bookingContext.customerTeams),...list(exactContext?.teams)];
  for(const team of allTeams)if(phone&&canonicalTelephone(team.phone)===phone&&customerId(team))matchingCustomerIds.add(customerId(team));
  const globalRows=list(bookingContext.reservations).filter(row=>selectedCustomer?customerId(row)===selectedCustomer:rowPhoneMatches(row,phone)||matchingCustomerIds.has(customerId(row)));
  // Prefer full operational rows with authoritative assignment arrays over the
  // small name-only context record for the same reservation ID.
  const byId=new Map();for(const row of [...list(exactContext?.reservations),...globalRows])if(idOf(row)){const previous=byId.get(idOf(row));byId.set(idOf(row),previous?{...row,...(cancelled(previous)?{status:'cancelled'}:{})}:row);}
  let history=[...byId.values()].filter(row=>!cancelled(row)&&sport(row.sport||raw(row).D)===currentSport&&text(row.company||raw(row).E)===company);
  if(!history.length)return result;
  const customerIds=unique([...customers.map(row=>text(row.id)),...history.map(customerId)]);
  let chosenCustomer=selectedCustomer;
  if(chosenCustomer)history=history.filter(row=>customerId(row)===chosenCustomer);
  else if(customerIds.length>1)return blocked('INSTRUCTOR_CUSTOMER_AMBIGUOUS','같은 연락처에 고객이 여러 명입니다. 고객을 선택한 뒤 이전 강사를 확인해 주세요.');
  else if(customerIds.length===1){chosenCustomer=customerIds[0];history=history.filter(row=>customerId(row)===chosenCustomer);}
  else{
    const names=unique(history.map(customerName));
    if(names.length!==1||!text(draft.customerName)||names[0]!==text(draft.customerName))return blocked('INSTRUCTOR_CUSTOMER_AMBIGUOUS','연락처만으로 이전 수강 고객을 확정할 수 없습니다. 고객·팀을 확인해 주세요.');
  }
  if(!history.length)return result;
  const teamKey=row=>teamId(row)||`legacy:${teamName(row)}`;
  let chosenTeam=selectedTeam,teamRows;
  if(chosenTeam)teamRows=history.filter(row=>teamId(row)===chosenTeam);
  else{
    const name=text(draft.teamName),named=name&&!/^(?:상담\s*팀\s*\d*|새\s*팀|\d+팀)$/u.test(name)?history.filter(row=>teamName(row)===name):[];
    const namedKeys=unique(named.map(teamKey)),keys=unique(history.map(teamKey));
    if(namedKeys.length===1)teamRows=named;
    else if(keys.length===1&&currentTeamCount===1)teamRows=history;
    else return blocked('INSTRUCTOR_TEAM_AMBIGUOUS','기존 강습 팀이 여러 개이거나 이번 팀과 연결이 불명확합니다. 팀별 이전 강사를 직접 확인해 주세요.');
    chosenTeam=teamId(teamRows[0]);
  }
  if(!teamRows.length)return result;
  const instant=now instanceof Date?now.getTime():typeof now==='number'?now:Date.parse(now);
  if(!Number.isFinite(instant))return blocked('INSTRUCTOR_HISTORY_TIME','현재 시각을 확인하지 못해 지난 강습 이력을 구분할 수 없습니다.');
  const desiredDate=parseKstDate(draft.date),desiredStart=desiredDate&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime||'')?Date.parse(`${desiredDate}T${draft.startTime}:00+09:00`):NaN,schedules=new Map(list(bookingContext.schedules).map(row=>[idOf(row),row]));
  const past=teamRows.flatMap(row=>{const schedule=schedules.get(idOf(row));if(cancelled(schedule))return [];const timing=priorTiming(row,schedule,instant,desiredDate,desiredStart),teacher=assignment(row,schedule);return timing&&(teacher.ids.length||teacher.name&&!['미배정','없음','미정'].includes(teacher.name))?[{row,...timing,teacher}]:[];});
  if(!past.length)return result;
  const latestEnd=Math.max(...past.map(row=>row.end)),latest=past.filter(row=>row.end===latestEnd),roster=list(bookingContext.roster),resolved=[];
  for(const entry of latest){
    if(entry.teacher.ids.length>1||!entry.teacher.ids.length&&/[·,/|&]/u.test(entry.teacher.name))return blocked('INSTRUCTOR_MULTIPLE','최근 강습에 담당 강사가 여러 명입니다. 이번에 지정할 강사를 선택해 주세요.');
    if(entry.teacher.ids.length===1){const person=roster.find(row=>personId(row)===entry.teacher.ids[0]);if(!activeInstructor(person))return blocked('INSTRUCTOR_INACTIVE','최근 담당 강사가 현재 활동 중인 강사 명단에 없습니다. 담당자를 확인해 주세요.');resolved.push(person);}
    else{
      const people=roster.filter(row=>activeInstructor(row)&&personName(row)===entry.teacher.name);
      if(people.length!==1)return blocked(people.length?'INSTRUCTOR_NAME_AMBIGUOUS':'INSTRUCTOR_INACTIVE','이전 담당 강사 이름과 현재 강사 계정을 하나로 연결할 수 없습니다. 담당자를 확인해 주세요.');
      resolved.push(people[0]);
    }
  }
  const ids=unique(resolved.map(personId));if(ids.length!==1)return blocked('INSTRUCTOR_MULTIPLE','최근 같은 팀 강습에 서로 다른 담당 강사가 있습니다. 지정할 강사를 직접 선택해 주세요.');
  const teacher=resolved[0],name=personName(teacher),teacherId=personId(teacher),latestDate=latest[0].date;
  return {...result,status:'proposed',registrationFields:{designated:true,preferredInstructorId:teacherId,preferredInstructor:name},reason:`${latestDate} 같은 고객·팀의 ${currentSport} 강습 담당 ${name} 강사를 이전 이력 기준으로 제안했습니다. 상담에 강사 변경 요청이 없어 지정 강사란에 채우며, 담당자가 확인해야 합니다. 실제 배정은 일정·휴무·배정 조건을 확인한 뒤 확정합니다.`,evidence:{reservationIds:latest.map(entry=>idOf(entry.row)),customerId:chosenCustomer||null,teamId:chosenTeam||null,instructorId:teacherId,instructorName:name,latestDate,...(request.events?{requests:request.events}:{})}};
}
