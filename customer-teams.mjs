import {parseLessonInterval} from './booking-rules.mjs?v=34';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const rawOf=row=>row?.raw||row?.raw_data||{};
const list=value=>Array.isArray(value)?value:[];
const rowId=row=>String(row?.id??row?.schedule_id??row?.scheduleId??'').trim();
const cancelled=row=>['cancelled','canceled'].includes(row?.status);
const unique=values=>[...new Set(values)];

/** Collapse formatting whitespace only; names and explicit team labels stay distinct. */
export const normalizeCustomerText=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ');

/** Syntactic Korean contact validation, never a claim of phone ownership. */
export function canonicalTelephone(value){
  const source=String(value??'').normalize('NFKC').trim();
  if(!source||!/^[+0-9()\s.-]+$/u.test(source))return null;
  let phone=source.replace(/[()\s.-]/gu,'');
  if(phone.startsWith('+82')||phone.startsWith('0082')){
    phone=phone.slice(phone.startsWith('+82')?3:4);
    if(!phone.startsWith('0'))phone=`0${phone}`;
  }
  return /^(?:010\d{8}|01[16789]\d{7,8}|02\d{7,8}|0(?:31|32|33|41|42|43|44|51|52|53|54|55|61|62|63|64)\d{7,8}|070\d{8}|050[2-8]\d{7,8}|(?:15|16|18)\d{6})$/.test(phone)?phone:null;
}

export function formatTelephone(value){
  const phone=canonicalTelephone(value);
  if(!phone)return String(value??'').normalize('NFKC').trim();
  const prefix=/^(?:15|16|18)\d{6}$/.test(phone)?4:phone.startsWith('02')?2:phone.startsWith('050')?4:3;
  return `${phone.slice(0,prefix)}-${phone.slice(prefix,-4)}${phone.length===8?'':'-'}${phone.slice(-4)}`.replace('--','-');
}

export function bookingTeamLabel(row={}){
  const raw=rawOf(row),customer=normalizeCustomerText(raw.H),team=normalizeCustomerText(raw.I);
  if(customer&&!team)return `${customer} · 기본팀`;
  if(customer&&team&&customer!==team)return `${customer} · ${team}`;
  return team||customer||'예약';
}

/** Empty I is a dedicated default-team sentinel, including when I literally says 기본 1팀. */
export function customerIdentity(row={}){
  const raw=rawOf(row),customerName=normalizeCustomerText(raw.H),telephone=canonicalTelephone(raw.L);
  const explicitTeam=normalizeCustomerText(raw.I),isDefault=!explicitTeam;
  const customerId=normalizeCustomerText(row.customerId??row.customer_id),customerTeamId=normalizeCustomerText(row.customerTeamId??row.customer_team_id);
  const customerKey=customerId?JSON.stringify(['customer',customerId]):customerName&&telephone?JSON.stringify([customerName,telephone]):null;
  const teamKey=customerId?(customerTeamId?JSON.stringify(['customer-team',customerId,customerTeamId]):null):customerKey?JSON.stringify([customerName,telephone,isDefault?'default':'explicit',explicitTeam]):null;
  return {customerName,telephone,customerId:customerId||null,customerTeamId:customerTeamId||null,linked:!!customerId,customerKey,teamKey,
    teamLabel:explicitTeam||'기본 1팀',teamName:explicitTeam,isDefault,teamMode:isDefault?'default':'explicit',sport:normalizeCustomerText(own(raw,'D')?raw.D:row.sport)};
}

const revision=row=>Date.parse(row?.updated_at||row?.updatedAt||row?.expectedUpdatedAt||'')||0;
function byId(rows){
  const result=new Map();
  for(const row of list(rows)){
    const id=rowId(row);if(!id)continue;
    const previous=result.get(id);
    if(!previous||revision(row)>revision(previous)||(revision(row)===revision(previous)&&cancelled(row)&&!cancelled(previous)))result.set(id,row);
  }
  return result;
}

/** An explicit actual-assignment array, including [], overrides stale scalar and schedule values. */
function actualIds(row,schedule){
  const from=value=>{
    for(const key of ['instructorIds','instructorUserIds','instructor_user_ids','instructor_ids'])if(own(value,key)&&Array.isArray(value[key]))return unique(value[key].filter(id=>typeof id==='string'&&id.trim()).map(id=>id.trim()));
    for(const key of ['instructorUserId','instructor_user_id'])if(typeof value?.[key]==='string'&&value[key].trim())return [value[key].trim()];
    return null;
  };
  return from(row)??from(schedule)??[];
}

function timing(row,schedule){
  let interval=schedule?parseLessonInterval(schedule):{error:true};
  if(interval.error)interval=parseLessonInterval(row);
  if(interval.error)return {date:normalizeCustomerText(rawOf(row).A),startTime:normalizeCustomerText(rawOf(row).B),endTime:normalizeCustomerText(rawOf(row).C),startAt:null,endAt:null};
  const clock=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  return {date:interval.startDate,startTime:clock(interval.start),endTime:interval.endDate!==interval.startDate?clock(interval.end)==='00:00'?'24:00':`익일 ${clock(interval.end)}`:clock(interval.end),startAt:Date.parse(interval.start),endAt:Date.parse(interval.end)};
}

/** Read-only matching and history. Suggestions never assign an instructor or consume a lesson. */
export function customerTeamHistory(draft={},context={},options={}){
  const identity=customerIdentity(draft),canMatch=!!identity.customerKey;
  const empty={identity,canMatch,notice:'',teams:[],history:[],suggestedInstructorIds:[],suggestedInstructorNames:[],suggestionSourceIds:[]};
  if(!identity.customerName)return {...empty,notice:'고객명(입금자)을 입력하면 기존 팀과 강습 기록을 확인합니다.'};
  if(!identity.telephone&&!identity.customerId)return {...empty,notice:'유효한 전화번호를 입력하면 같은 고객·팀의 이전 담당 강사를 확인합니다.'};
  const currentId=rowId(draft),schedules=byId(context.schedules),roster=new Map(list(context.roster).map(person=>[String(person.user_id||person.id||''),person]));
  const customerRows=[...byId(context.reservations).values()].filter(row=>{
    const id=rowId(row);return id!==currentId&&!cancelled(row)&&!cancelled(schedules.get(id))&&customerIdentity(row).customerKey===identity.customerKey;
  });
  const grouped=new Map();
  for(const row of customerRows){
    const team=customerIdentity(row);if(!team.teamKey)continue;
    const previous=grouped.get(team.teamKey)||{key:team.teamKey,label:team.teamLabel,isDefault:team.isDefault,teamName:team.teamName,customerTeamId:team.customerTeamId,sports:[],bookingCount:0};
    previous.bookingCount++;if(team.sport&&!previous.sports.includes(team.sport))previous.sports.push(team.sport);grouped.set(team.teamKey,previous);
  }
  if(identity.customerId)for(const row of list(context.customerTeams)){
    if(String(row.customer_id??row.customerId)!==identity.customerId)continue;
    const key=JSON.stringify(['customer-team',identity.customerId,String(row.id)]),teamName=normalizeCustomerText(row.name),previous=grouped.get(key);
    if(previous){previous.label=teamName||'기본 1팀';previous.teamName=teamName;previous.isDefault=!teamName;}
    else grouped.set(key,{key,label:teamName||'기본 1팀',isDefault:!teamName,teamName,customerTeamId:String(row.id),sports:row.defaults?.sport?[row.defaults.sport]:[],bookingCount:0});
  }
  const teams=[...grouped.values()].map(team=>({...team,sports:team.sports.sort((a,b)=>a.localeCompare(b,'ko'))})).sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||a.label.localeCompare(b.label,'ko'));
  const now=options.now===undefined?Date.now():new Date(options.now).getTime(),desired=parseLessonInterval(draft),desiredStart=desired.error?null:Date.parse(desired.start);
  const history=customerRows.filter(row=>{const team=customerIdentity(row);return identity.teamKey&&team.teamKey===identity.teamKey&&team.sport===identity.sport;}).map(row=>{
    const id=rowId(row),schedule=schedules.get(id),time=timing(row,schedule),instructorIds=actualIds(row,schedule);
    const seasonId=String(row.seasonId??row.season_id??'').trim(),season=seasonId?list(context.seasonPackages).find(pack=>String(pack.id)===seasonId):null;
    const sessionNumber=Number(row.sessionNumber??row.session_number),seasonTotal=Number(season?.total_sessions??season?.totalSessions);
    const seasonSessionLabel=season&&Number.isInteger(sessionNumber)&&Number.isInteger(seasonTotal)&&sessionNumber>=1&&sessionNumber<=seasonTotal?`시즌 ${sessionNumber}/${seasonTotal}회차`:null;
    const instructorNames=instructorIds.map(id=>roster.get(id)?.display_name||roster.get(id)?.name||'연결 계정 확인 필요');
    const legacyInstructorName=instructorIds.length?'':normalizeCustomerText(rawOf(row).F||row.instructor_name||schedule?.instructor||schedule?.instructor_name);
    const isPast=time.endAt!==null&&Number.isFinite(now)&&time.endAt<=now;
    const isUpcoming=time.startAt!==null&&Number.isFinite(now)&&time.startAt>now;
    const isOngoing=time.startAt!==null&&Number.isFinite(now)&&time.startAt<=now&&time.endAt>now;
    return {id,...time,sport:identity.sport,teamLabel:identity.teamLabel,customerName:identity.customerName,instructorIds,instructorNames,legacyInstructorName,
      instructorLabel:instructorNames.length?instructorNames.join(' · '):legacyInstructorName&&legacyInstructorName!=='미배정'?`${legacyInstructorName} · 계정 확인 필요`:'미배정',
      isPast,isUpcoming,isOngoing,isBeforeCurrent:time.endAt!==null&&desiredStart!==null&&time.endAt<=desiredStart,
      timingLabel:isPast?'지난 일정':isUpcoming?'예정':isOngoing?'진행 시간':'시간 확인 필요',status:row.status||'received',recordedSession:normalizeCustomerText(rawOf(row).J),seasonSessionLabel};
  }).sort((a,b)=>(a.startAt??Infinity)-(b.startAt??Infinity)||a.id.localeCompare(b.id));
  history.forEach((entry,index)=>{entry.registrationNumber=index+1;entry.sessionLabel=entry.seasonSessionLabel||entry.recordedSession||`등록 ${index+1}번째`;entry.sessionSource=entry.seasonSessionLabel?'season':entry.recordedSession?'raw':'registration';});
  const previousAssigned=history.filter(entry=>['스키','보드'].includes(identity.sport)&&entry.isPast&&entry.isBeforeCurrent&&entry.instructorIds.length).sort((a,b)=>b.endAt-a.endAt||b.startAt-a.startAt||a.id.localeCompare(b.id));
  const latestEnd=previousAssigned[0]?.endAt;
  const latest=previousAssigned.filter(entry=>entry.endAt===latestEnd);
  const suggestedInstructorIds=unique(latest.flatMap(entry=>entry.instructorIds)).filter(id=>{const person=roster.get(id);return person?.role==='instructor'&&person.active===true;});
  const suggestedInstructorNames=suggestedInstructorIds.map(id=>roster.get(id)?.display_name||roster.get(id)?.name||'강사');
  let notice='';
  if(!['스키','보드'].includes(identity.sport))notice='종목을 선택하면 같은 팀의 담당 기록을 확인합니다.';
  else if(!history.length)notice='이 고객·팀·종목의 기존 강습 기록이 없습니다.';
  else if(desiredStart===null)notice='날짜와 시간을 입력하면 이전 담당 강사를 확인합니다.';
  else if(!previousAssigned.length)notice='현재 예약 전의 지난 일정에 실제 배정된 강사 기록이 없습니다.';
  else if(!suggestedInstructorIds.length)notice='최근 담당 강사의 활성 계정을 확인해 주세요.';
  else if(suggestedInstructorIds.length>1)notice='최근 공동 담당 기록입니다. 같은 강사로 지정할 담당자를 선택해 주세요.';
  return {identity,canMatch,notice,teams,history,suggestedInstructorIds,suggestedInstructorNames,suggestionSourceIds:latest.map(entry=>entry.id)};
}
