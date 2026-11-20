import {scheduleRentalSummary,scheduleRentalLabel,renderScheduleRental} from './schedule-rental.mjs?v=1';
import {parseKstDate,parseLessonTime,lessonTimeLabel,parseLessonInterval,normalizeInstructorIds,bookingLocation} from './booking-rules.mjs?v=35';
import {bookingTeamLabel} from './customer-teams.mjs?v=27';
import {bookingFinancialSummary} from './booking-financial.mjs?v=12';

const DAY=86400000;
const MINUTE=60000;
const PIXELS_PER_MINUTE=1.1;
const escapeFallback=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const kstDate=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const clean=value=>String(value??'').normalize('NFKC').trim();
const first=(row,...keys)=>{for(const key of keys)if(row?.[key]!==undefined&&row?.[key]!==null)return row[key];return undefined;};
const rawOf=row=>row?.raw||row?.raw_data||{};
const unique=values=>[...new Set(values.filter(Boolean))];
const isCancelled=row=>!!(row?.cancelledAt||row?.cancelled_at)||['cancelled','canceled'].includes(row?.status);
const asNumber=value=>{if(value===''||value===undefined||value===null)return null;const number=Number(value);return Number.isInteger(number)&&number>=0?number:null;};
const timeText=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const timeMinutes=value=>{const parsed=parseLessonTime(value);return parsed?parsed.hour*60+parsed.minute:null;};
const relativeTimeLabel=minutes=>minutes<0?`전일 ${timeText((minutes%1440+1440)%1440)}`:lessonTimeLabel(timeText(minutes));
const midnight=date=>Date.parse(`${date}T00:00:00+09:00`);
const dateShift=(date,delta)=>kstDate(new Date(midnight(date)+delta*DAY));
const sameOverlap=(firstStart,firstEnd,lastStart,lastEnd)=>firstStart<lastEnd&&lastStart<firstEnd;

// Use only the saved correction pointer and current payment; never an unsaved
// editor intent, old source X/Z cells, or rental settlement alone.
function paymentCorrection(row){
  if(!row||isCancelled(row)||!clean(first(row,'currentAmountCorrectionId','current_amount_correction_id')))return null;
  const override=first(row,'currentAmountOverride','current_amount_override');if(override===undefined||override===null||override==='')return null;
  try{const saved={...row};delete saved.paymentRequestCorrection;const amounts=bookingFinancialSummary(saved);return amounts.balance>0?{outstandingAmount:amounts.balance}:null;}catch{return null;}
}
const paymentLabel=entry=>entry.paymentCorrection?`요청액 정정 · 미수 ${entry.paymentCorrection.outstandingAmount.toLocaleString('ko-KR')}원`:'';
const paymentBadge=(entry,escape)=>entry.paymentCorrection?`<span class="tt-payment-due-label" data-tt-payment-due title="${escape(paymentLabel(entry))}">미수 ${escape(entry.paymentCorrection.outstandingAmount.toLocaleString('ko-KR'))}원</span>`:'';

function configuration(ui={},now=new Date()){
  const filters=ui.timetable||{};
  return {date:parseKstDate(filters.date)||kstDate(now),company:filters.company||'all',sport:filters.sport||'all',selectedStart:parseLessonTime(filters.selectedStart)?.hour<24?parseLessonTime(filters.selectedStart).value:'09:00',selectedEnd:parseLessonTime(filters.selectedEnd)?.value||'11:00'};
}

/** Keep actual schedule instants authoritative and retain source reservation context. */
export function normalizeTimetableAppointments(state={}){
  const schedules=Array.isArray(state.schedules)?state.schedules:[];
  const reservations=Array.isArray(state.reservations)?state.reservations:[];
  const bySchedule=new Map(schedules.map(row=>[String(row.id||row.schedule_id||''),row]));
  const byReservation=new Map(reservations.map(row=>[String(row.id||row.schedule_id||''),row]));
  const ids=unique([...bySchedule.keys(),...byReservation.keys()]);
  const packages=Array.isArray(state.seasonPackages)?state.seasonPackages:[];
  const passes=Array.isArray(state.lessonPasses)?state.lessonPasses:[];
  return ids.map(id=>{
    const reservation=byReservation.get(id),schedule=bySchedule.get(id),raw=rawOf(reservation);
    if(isCancelled(reservation)||isCancelled(schedule))return null;
    const planSource=schedule&&['lessonMinutes','lesson_minutes'].some(key=>Object.prototype.hasOwnProperty.call(schedule,key))?schedule:reservation;
    const schedulePlan=schedule?{...schedule,lessonMinutes:first(planSource,'lessonMinutes','lesson_minutes')??null,breakMinutes:first(planSource,'breakMinutes','break_minutes')??0}:null;
    let interval=schedulePlan?parseLessonInterval(schedulePlan):parseLessonInterval(reservation);
    let planNeedsReview=false;
    if(interval.error&&schedulePlan){const actual=parseLessonInterval({...schedulePlan,lessonMinutes:null,breakMinutes:0});if(!actual.error){interval=actual;planNeedsReview=true;}}
    if(interval.error&&reservation)interval=parseLessonInterval(reservation);
    if(interval.error)return null;
    const kind=reservation?.kind||reservation?.booking_kind||'single';
    const seasonId=first(reservation,'seasonId','season_id');
    const pack=packages.find(row=>String(row.id)===String(seasonId));
    const lessonPassId=first(reservation,'lessonPassId','lesson_pass_id');
    const pass=passes.find(row=>String(row.id)===String(lessonPassId));
    const preferred=clean(first(pass,'fixed_instructor_user_id','fixedInstructorId')||first(reservation,'preferredInstructorId','preferred_instructor_user_id')||(kind==='season'?first(pack,'instructor_user_id','instructorUserId'):''));
    const reorder=kind==='reorder'||first(reservation,'isReorder','is_reorder')===true;
    const designated=first(reservation,'designated','is_designated')===true;
    const fixed=designated||reorder||kind==='season'||!!lessonPassId;
    const assignedIds=unique([...normalizeInstructorIds(reservation),...normalizeInstructorIds(schedule)]);
    const heldIds=fixed&&preferred&&!assignedIds.includes(preferred)?[preferred]:[];
    return {id,lessonPassId,reservation:!!reservation,start:interval.start,end:interval.end,startAt:Date.parse(interval.start),endAt:Date.parse(interval.end),
      lessonMinutes:interval.lessonMinutes??null,breakMinutes:interval.breakMinutes||0,
      lessonSegments:interval.lessonSegments||[{start:interval.start,end:interval.end}],busySegments:interval.busySegments||[{start:interval.start,end:interval.end}],breakSegment:interval.breakSegment||null,
      customer:clean(raw.H||raw.I)?bookingTeamLabel(reservation,state):clean(first(schedule,'customer','customer_name')||first(reservation,'customer','customer_name'))||'강습생 확인 필요',
      company:clean(raw.E||reservation?.company||schedule?.company),location:clean(reservation?.location||schedule?.location||bookingLocation({raw})),sport:clean(raw.D||reservation?.sport||schedule?.sport),
      notes:[clean(raw.G||reservation?.notes||''),planNeedsReview?'강습 시간 설정 확인 필요':''].filter(Boolean).join(' · '),level:clean(raw.O||schedule?.level||''),people:asNumber(raw.M??reservation?.people),
      paymentCorrection:paymentCorrection(reservation),rental:scheduleRentalSummary(reservation||schedule||{}),kind,reorder,designated,seasonId,sessionNumber:first(reservation,'sessionNumber','session_number'),assignedIds,heldIds,preferredInstructorId:preferred};
  }).filter(Boolean);
}

function visualSegments(entry,dayStart,dayEnd){
  const parts=entry.lessonSegments.map((segment,index)=>({...segment,part:'lesson',segmentIndex:index,segmentCount:entry.lessonSegments.length}));
  if(entry.breakSegment&&entry.breakMinutes===60)parts.push({...entry.breakSegment,part:'break',segmentIndex:-1,segmentCount:entry.lessonSegments.length});
  return parts.map(segment=>({...entry,...segment,startAt:Date.parse(segment.start),endAt:Date.parse(segment.end),bookingStartAt:entry.startAt,bookingEndAt:entry.endAt}))
    .filter(segment=>sameOverlap(segment.startAt,segment.endAt,dayStart,dayEnd))
    .map(segment=>({...segment,startMinute:Math.max(0,(segment.startAt-dayStart)/MINUTE),endMinute:Math.min(1440,(segment.endAt-dayStart)/MINUTE),segmentOffsetMinutes:(segment.startAt-entry.startAt)/MINUTE}));
}

function laneLayout(entries){
  const sorted=entries.map(entry=>({...entry})).sort((a,b)=>a.startAt-b.startAt||a.endAt-b.endAt||a.id.localeCompare(b.id));
  let group=[],groupEnd=-Infinity,laneEnds=[];
  const finish=()=>{for(const entry of group){entry.laneCount=laneEnds.length;entry.conflict=group.some(other=>other.id!==entry.id&&sameOverlap(entry.startAt,entry.endAt,other.startAt,other.endAt));}group=[];laneEnds=[];};
  for(const entry of sorted){
    if(entry.startAt>=groupEnd){finish();groupEnd=-Infinity;}
    let lane=laneEnds.findIndex(end=>end<=entry.startAt);if(lane<0)lane=laneEnds.length;
    laneEnds[lane]=entry.endAt;entry.lane=lane;group.push(entry);groupEnd=Math.max(groupEnd,entry.endAt);
  }
  finish();return sorted;
}

export function buildTimetableModel(state={},filters={},options={}){
  const normalized=configuration({timetable:filters},options.now||new Date());
  const dayStart=midnight(normalized.date),dayEnd=dayStart+DAY;
  const allAppointments=normalizeTimetableAppointments(state);
  const appointments=allAppointments.filter(entry=>sameOverlap(entry.startAt,entry.endAt,dayStart,dayEnd)).map(entry=>({...entry,
    startMinute:Math.max(0,(entry.startAt-dayStart)/MINUTE),endMinute:Math.min(1440,(entry.endAt-dayStart)/MINUTE),
    muted:(normalized.company!=='all'&&entry.company!==normalized.company)||(normalized.sport!=='all'&&entry.sport!==normalized.sport)}));
  const referencedIds=new Set(appointments.flatMap(entry=>[...entry.assignedIds,...entry.heldIds]));
  const roster=(Array.isArray(state.roster)?state.roster:[]).filter(person=>person.role==='instructor'&&(person.active||referencedIds.has(String(person.user_id||person.id))));
  const teachers=roster.map(person=>({id:String(person.user_id||person.id),name:person.display_name||person.name||'강사',active:person.active===true}));
  for(const id of referencedIds)if(!teachers.some(person=>person.id===id))teachers.push({id,name:'연결 계정 확인 필요',active:false});
  const allLeaves=(state.timeOffRequests||[]).filter(row=>['pending','approved'].includes(row.status)&&parseKstDate(row.date||row.requested_date||row.leave_date)===normalized.date);
  const capabilities=state.capabilities||[];
  const columns=teachers.map(teacher=>{
    const entries=appointments.filter(entry=>entry.assignedIds.includes(teacher.id)||entry.heldIds.includes(teacher.id)).map(entry=>({...entry,held:!entry.assignedIds.includes(teacher.id)&&entry.heldIds.includes(teacher.id)}));
    const leaves=allLeaves.filter(row=>String(row.instructor_user_id||row.instructorUserId)===teacher.id);
    return {...teacher,entries:laneLayout(entries.flatMap(entry=>visualSegments(entry,dayStart,dayEnd))),gaps:entries.filter(entry=>entry.breakMinutes===120&&entry.breakSegment),leaves,capability:capabilities.find(row=>String(row.instructor_user_id||row.instructorUserId)===teacher.id),count:entries.length};
  });
  const startMinute=Math.min(420,...appointments.map(entry=>Math.floor(entry.startMinute/60)*60));
  const selectedStart=timeMinutes(normalized.selectedStart),selectedEnd=timeMinutes(normalized.selectedEnd);
  const unknownPeople=appointments.filter(entry=>entry.people===null).length;
  return {...normalized,dayStart,dayEnd,startMinute,endMinute:1440,pixelsPerMinute:PIXELS_PER_MINUTE,height:(1440-startMinute)*PIXELS_PER_MINUTE,
    appointments,allAppointments,timeOffRequests:state.timeOffRequests||[],columns,unassigned:appointments.filter(entry=>!entry.assignedIds.length),
    companies:unique(normalizeTimetableAppointments(state).map(entry=>entry.company)).sort((a,b)=>a.localeCompare(b,'ko')),
    selectedStartMinute:selectedStart,selectedEndMinute:selectedEnd,
    selectedDuration:selectedStart!==null&&selectedEnd!==null&&selectedEnd>selectedStart?selectedEnd-selectedStart:120,
    totalPeople:appointments.reduce((sum,entry)=>sum+(entry.people||0),0),unknownPeople};
}

/** Availability means only this time window is clear; learner fit is checked at registration. */
export function getInstructorAvailability(model,instructorId,startTime=model.selectedStart,endTime=model.selectedEnd){
  const column=model.columns.find(person=>person.id===instructorId);
  const start=timeMinutes(startTime),end=timeMinutes(endTime);
  const result=(status,label,available,note='',extra={})=>({status,label,available,timeFree:available,canCreate:available,note,...extra});
  if(!column||start===null||end===null||end<=start||start>=1440||end>2100)return result('invalid','시간 확인 필요',false);
  if(!column.active)return result('inactive','계정 확인 필요',false);
  const startAt=model.dayStart+start*MINUTE,endAt=model.dayStart+end*MINUTE;
  const leaves=(model.timeOffRequests||column.leaves).filter(row=>{const date=parseKstDate(row.date||row.requested_date||row.leave_date);return ['pending','approved'].includes(row.status)&&String(row.instructor_user_id||row.instructorUserId)===column.id&&date&&sameOverlap(midnight(date),midnight(date)+DAY,startAt,endAt);});
  if(leaves.length)return result('leave',leaves.some(row=>row.status==='approved')?'휴무':'휴무 신청',false,'강습이 이어지는 날짜의 휴무를 확인해 주세요.');
  const overlaps=(model.allAppointments||column.entries).filter(entry=>(entry.assignedIds.includes(column.id)||entry.heldIds.includes(column.id))&&entry.busySegments.some(segment=>sameOverlap(Date.parse(segment.start),Date.parse(segment.end),startAt,endAt)));
  if(overlaps.length)return result('busy','시간 중복',false,`${overlaps.length}건의 강습·지정 예약과 겹칩니다.`,{overlaps});
  const capability=column.capability;
  if(!capability||capability.verified!==true)return result('unverified','강사 정보 확인',false,'시간은 비어 있으나 담당 조건 확인이 필요합니다.',{timeFree:true});
  const sports=Array.isArray(capability.sports)?capability.sports.map(clean):[];
  const locations=Array.isArray(capability.locations)?capability.locations.map(clean):[];
  if(model.sport!=='all'&&!sports.includes(model.sport))return result('condition','종목 확인 필요',false,'선택한 종목의 담당 정보를 확인해 주세요.',{timeFree:true});
  const location=model.company==='all'?'':bookingLocation({raw:{E:model.company}});
  if(location&&!locations.includes(location))return result('condition','지점 확인 필요',false,'선택한 업체·지점의 담당 정보를 확인해 주세요.',{timeFree:true});
  return result('free','시간 비어있음',true,'나이·수준 등 예약 조건은 접수 시 확인해 주세요.');
}

/** Propose an edit only. Availability and fixed-teacher rules are reviewed in the booking drawer. */
export function proposeTimetableMove(model,{id,instructorId,startTime,segmentIndex=0}={}){
  const entry=model?.appointments?.find(row=>row.id===String(id));
  if(!entry?.reservation)return {error:'기존 가져온 일정은 예약 화면에서 확인해 주세요.'};
  const column=model.columns.find(row=>row.id===String(instructorId));
  if(!column)return {error:'이동할 강사를 확인해 주세요.'};
  const selectedStart=timeMinutes(startTime),segment=entry.lessonSegments[segmentIndex];
  if(!Number.isInteger(segmentIndex)||!segment)return {error:'이동할 강습 구간을 확인해 주세요.'};
  const start=selectedStart===null?null:selectedStart-(Date.parse(segment.start)-entry.startAt)/MINUTE,duration=(entry.endAt-entry.startAt)/MINUTE;
  if(start===null||start<0||start>=1440||!Number.isInteger(duration)||duration<=0)return {error:'시작·종료 시각을 확인해 주세요.'};
  const end=start+duration;
  if(end>2100)return {error:'강습 종료시간 범위를 확인해 주세요.'};
  if(!parseKstDate(model.date))return {error:'이동할 날짜를 확인해 주세요.'};
  return {move:{id:entry.id,date:model.date,startTime:timeText(start),endTime:timeText(end),instructorId:column.id,...(entry.lessonMinutes?{lessonMinutes:entry.lessonMinutes,breakMinutes:entry.breakMinutes}:{})}};
}

function renderTags(entry,escape){
  return `${entry.held?'<span class="tt-event-tag hold">지정·미배정</span>':''}${entry.lessonPassId?'<span class="tt-event-tag season">수강권</span>':''}${entry.reorder?'<span class="tt-event-tag reorder">리오더</span>':''}${entry.kind==='season'||entry.seasonId?`<span class="tt-event-tag season">시즌${entry.sessionNumber?' '+escape(entry.sessionNumber)+'회차':''}</span>`:''}${entry.designated&&!entry.reorder&&entry.kind!=='season'?'<span class="tt-event-tag">지정</span>':''}${entry.conflict?'<span class="tt-event-tag conflict">겹침</span>':''}`;
}
function eventBlock(entry,column,model,escape){
  const top=(entry.startMinute-model.startMinute)*model.pixelsPerMinute;
  const height=(entry.endMinute-entry.startMinute)*model.pixelsPerMinute;
  const startText=entry.startAt<model.dayStart?`전일 ${timeText(Math.round((entry.startAt-model.dayStart+DAY)/MINUTE))}`:timeText(Math.floor(entry.startMinute));
  const endText=entry.endAt>model.dayEnd?`익일 ${timeText(Math.round((entry.endAt-model.dayEnd)/MINUTE))}`:timeText(Math.floor(entry.endMinute));
  const split=entry.segmentCount>1,partLabel=entry.part==='break'?'1시간 휴식 · 시간 확보':split?`4시간 강습 · ${entry.segmentIndex+1}/2 구간`:entry.lessonMinutes?`${entry.lessonMinutes/60}시간 강습`:'';
  const partner=split&&entry.part==='lesson'?entry.lessonSegments[entry.segmentIndex===0?1:0]:null;
  const partnerLabel=partner?`${entry.segmentIndex===0?'이어서':'앞 강습'} ${relativeTimeLabel(Math.round((Date.parse(partner.start)-model.dayStart)/MINUTE))}–${relativeTimeLabel(Math.round((Date.parse(partner.end)-model.dayStart)/MINUTE))}`:'';
  const title=`${startText}–${endText} · ${entry.customer}${partLabel?' · '+partLabel:''}${partnerLabel?' · '+partnerLabel:''}${entry.company?' · '+entry.company:''}${paymentLabel(entry)?' · '+paymentLabel(entry):''}${entry.notes?' · '+entry.notes:''}${entry.held?' · 지정 강사 미배정':''} · ${scheduleRentalLabel(entry)}`;
  if(entry.part==='break')return `<div class="tt-reserved-break ${entry.conflict?'overlapping':''} ${entry.muted?'muted':''}" data-tt-break="${escape(entry.id)}" style="top:${top}px;height:${height}px;left:calc(${entry.lane/entry.laneCount*100}% + 4px);width:calc(${100/entry.laneCount}% - 8px)" title="${escape(title)}"><span>${escape(startText)}–${escape(endText)} · 휴식</span><strong>${escape(entry.customer)}</strong><small>1시간 휴식 · 시간 확보${entry.conflict?' · 겹침':''}</small></div>`;
  return `<div class="tt-event-wrap ${entry.reservation?'editable':''} ${split?'split-lesson':''}" data-tt-part="${entry.segmentIndex+1}" style="top:${top}px;height:${height}px;left:calc(${entry.lane/entry.laneCount*100}% + 4px);width:calc(${100/entry.laneCount}% - 8px)"><button type="button" class="tt-event ${entry.held?'held':''} ${entry.muted?'muted':''} ${entry.conflict?'overlapping':''} ${entry.sport==='보드'?'board':''} ${entry.paymentCorrection?'payment-due':''}" data-tt-reservation="${escape(entry.id)}" data-tt-instructor="${escape(column.id)}" ${entry.reservation?`draggable="false" data-tt-drag-id="${escape(entry.id)}" data-tt-segment-offset="${entry.segmentOffsetMinutes}"`:''} title="${escape(title)}" aria-label="${escape(title)}"><span class="tt-event-time${entry.paymentCorrection?' tt-payment-time':''}">${escape(startText)} — ${escape(endText)}${paymentBadge(entry,escape)}</span><strong>${escape(entry.customer)}</strong>${partLabel?`<span class="tt-event-plan">${escape(partLabel)}</span>`:''}${partnerLabel?`<span class="tt-event-partner">${escape(partnerLabel)}</span>`:''}<span class="tt-event-meta">${escape(entry.sport||'종목 확인')}${entry.people===null?'':` · ${entry.people}명`}${entry.level?` · ${escape(entry.level)}`:''}</span><span class="tt-event-tags">${renderTags(entry,escape)}</span>${renderScheduleRental(entry,{compact:true,escapeHTML:escape})}${entry.notes?`<span class="tt-event-note">${escape(entry.notes)}</span>`:''}</button>${entry.reservation?`<button type="button" class="tt-event-change" data-tt-change="${escape(entry.id)}" aria-label="${escape(entry.customer)} 일정 변경">일정 변경</button>`:''}</div>`;
}
function gapBlock(entry,model,escape){
  const start=Math.max(0,(Date.parse(entry.breakSegment.start)-model.dayStart)/MINUTE),end=Math.min(1440,(Date.parse(entry.breakSegment.end)-model.dayStart)/MINUTE);
  if(end<=start)return '';
  return `<div class="tt-free-break" data-tt-free-break="${escape(entry.id)}" style="top:${(start-model.startMinute)*model.pixelsPerMinute}px;height:${(end-start)*model.pixelsPerMinute}px" aria-hidden="true"><span>${escape(entry.customer)} · 2시간 휴식</span><small>다른 2시간 강습 배정 가능</small></div>`;
}
function columnBody(column,model,escape){
  const selectedStart=model.selectedStartMinute,selectedEnd=model.selectedEndMinute;
  const availability=getInstructorAvailability(model,column.id);
  const selectionTop=Math.max(model.startMinute,selectedStart??model.startMinute);
  const selectionEnd=Math.min(1440,selectedEnd??selectionTop);
  const selected=selectedStart!==null&&selectedEnd!==null&&selectedEnd>selectedStart&&selectionEnd>selectionTop?`<div class="tt-selected-window ${availability.status}" style="top:${(selectionTop-model.startMinute)*model.pixelsPerMinute}px;height:${(selectionEnd-selectionTop)*model.pixelsPerMinute}px" aria-hidden="true"></div>`:'';
  let slots='';
  for(let minute=model.startMinute;minute<1440;minute+=10){
    const end=minute+model.selectedDuration;
    const result=end<=2100?getInstructorAvailability(model,column.id,timeText(minute),timeText(end)):null;
    slots+=`<button type="button" class="tt-slot" data-tt-slot="${timeText(minute)}" data-tt-end="${end<=2100?timeText(end):''}" data-tt-instructor="${escape(column.id)}" style="top:${(minute-model.startMinute)*model.pixelsPerMinute}px;height:${10*model.pixelsPerMinute}px" aria-label="${escape(column.name)} ${timeText(minute)}부터 ${end<=2100?lessonTimeLabel(timeText(end)):'시간 확인'} 예약 접수" title="${escape(result?.canCreate?`${timeText(minute)}부터 예약 접수`:result?.label||'종료 시각 확인 필요')}" ${result?.canCreate?'':'disabled'}></button>`;
  }
  return `<div class="tt-column ${column.leaves.length?'on-leave':''}" data-tt-column="${escape(column.id)}" style="height:${model.height}px">${selected}${slots}${column.gaps.map(entry=>gapBlock(entry,model,escape)).join('')}${column.leaves.length?`<div class="tt-leave-wash"><strong>${column.leaves.some(row=>row.status==='approved')?'휴무':'휴무 신청 중'}</strong><span>${column.entries.length?'연결된 강습 조정 필요':''}</span></div>`:''}${column.entries.map(entry=>eventBlock(entry,column,model,escape)).join('')}<div class="tt-drop-preview" data-tt-drop-preview hidden aria-hidden="true"><span></span></div></div>`;
}
const option=(value,label,current,escape)=>`<option value="${escape(value)}" ${value===current?'selected':''}>${escape(label)}</option>`;
function timeOptions(current,escape,end=false){let result='';for(let minute=0;minute<=(end?2100:1430);minute+=10)result+=option(timeText(minute),lessonTimeLabel(timeText(minute)),current,escape);return result;}

export function renderTimetable({state={},ui={},escapeHTML=escapeFallback,icon=()=>'',now=new Date()}={}){
  const escape=escapeHTML,filters=configuration(ui,now),model=buildTimetableModel(state,filters,{now});
  const dateLabel=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date(model.dayStart));
  const free=model.columns.filter(column=>getInstructorAvailability(model,column.id).canCreate).length;
  const dateKnown=Number.isFinite(model.dayStart);
  let times='';for(let minute=model.startMinute;minute<=1440;minute+=30)times+=`<span class="tt-time-label ${minute%60===0?'hour':''}" style="top:${(minute-model.startMinute)*model.pixelsPerMinute}px">${timeText(minute)}</span>`;
  const dayValues=[...new Set(model.appointments.map(entry=>entry.id))];
  return `<section class="tt-page" aria-label="강사별 당일 시간표"><div class="tt-heading"><div><span class="tt-eyebrow">DAILY INSTRUCTOR BOARD</span><h1>강사 시간표</h1><p>세로는 시간, 가로는 강사입니다. 강습과 빈 시간을 함께 확인하세요.</p></div><span class="tt-date-title">${escape(dateLabel)}</span></div><div class="panel tt-controls"><form class="tt-filter-form"><div class="tt-date-controls"><button type="button" class="icon-btn" data-tt-day="-1" aria-label="이전 날짜">‹</button><input id="tt-date" name="date" type="date" value="${escape(model.date)}" aria-label="시간표 날짜" required><button type="button" class="icon-btn" data-tt-day="1" aria-label="다음 날짜">›</button><button type="button" class="btn ghost small" data-tt-today>오늘</button></div><label><span>강습업체·지점</span><select name="company">${option('all','전체 업체',model.company,escape)}${model.companies.map(company=>option(company,company,model.company,escape)).join('')}</select></label><label><span>종목</span><select name="sport">${option('all','전체 종목',model.sport,escape)}${option('스키','스키',model.sport,escape)}${option('보드','보드',model.sport,escape)}</select></label><div class="tt-window-input"><span>끼워넣을 강습시간</span><div><select name="selectedStart" aria-label="끼워넣을 시작시간">${timeOptions(model.selectedStart,escape)}</select><span>—</span><select name="selectedEnd" aria-label="끼워넣을 종료시간">${timeOptions(model.selectedEnd,escape,true)}</select></div></div><button type="submit" class="btn primary small">시간 확인</button></form><div class="tt-summary"><span>당일 강습 <strong>${dayValues.length}건</strong></span><span>강습생 <strong>${model.totalPeople}명${model.unknownPeople?` + ${model.unknownPeople}건 미확인`:''}</strong></span><span>미배정 <strong>${model.unassigned.length}건</strong></span><span>선택 시간 비는 강사 <strong>${free}명</strong></span></div></div><div class="tt-board-notice"><span class="tt-notice-dot"></span><p>빈 시간은 눌러서 예약을 접수할 수 있습니다. 강습을 끌거나 ‘일정 변경’을 눌러 변경안을 검토하세요. 나이·수준·경력 조건은 접수할 때 확인합니다.${model.company!=='all'||model.sport!=='all'?' 조회 조건 밖의 강습도 회색으로 표시하여 시간 겹침을 확인합니다.':''}</p></div><p class="tt-move-feedback" data-tt-move-feedback role="status" aria-live="polite" hidden></p>${model.columns.length?`<div class="panel tt-board"><div class="tt-scroll" tabindex="0" role="region" aria-label="시간은 세로, 강사는 가로인 당일 일정표"><div class="tt-grid" style="--tt-columns:${model.columns.length};--tt-height:${model.height}px;--tt-minute:${model.pixelsPerMinute}px"><div class="tt-corner">시간<span>${model.selectedStart}–${model.selectedEnd}</span></div>${model.columns.map(column=>{const availability=getInstructorAvailability(model,column.id);return `<div class="tt-instructor-head" data-tt-instructor="${escape(column.id)}"><div><strong>${escape(column.name)}</strong><span>${column.count}건</span></div><span class="tt-availability ${availability.status}" data-tt-status="${availability.status}" title="${escape(availability.note)}">${escape(availability.label)}</span></div>`;}).join('')}<div class="tt-time-axis" style="height:${model.height}px">${times}</div>${model.columns.map(column=>columnBody(column,model,escape)).join('')}</div></div><div class="tt-legend"><span><i class="ski"></i>강습</span><span><i class="hold"></i>지정·미배정</span><span><i class="leave"></i>휴무·신청</span><span><i class="selected"></i>선택한 시간</span><span>2시간 휴식 구간은 다른 강습 배정 가능</span></div></div>`:`<section class="panel tt-empty"><strong>등록된 강사 계정이 없습니다.</strong><p>강사 계정이 연결되면 이곳에 시간표가 표시됩니다.</p></section>`}${model.unassigned.length?`<section class="panel tt-unassigned"><div><h2>당일 미배정 강습 <span>${model.unassigned.length}건</span></h2><p>지정 강사가 있는 미배정 강습은 해당 강사 열에도 표시됩니다.</p></div><div class="tt-unassigned-list">${model.unassigned.map(entry=>`<button type="button" class="${entry.paymentCorrection?'payment-due':''}" data-tt-reservation="${escape(entry.id)}" title="${escape([paymentLabel(entry),entry.notes].filter(Boolean).join(' · '))}"><span>${timeText(Math.floor(entry.startMinute))}–${timeText(Math.floor(entry.endMinute))}${entry.breakMinutes?` · 중간 ${entry.breakMinutes/60}시간 휴식`:''}</span>${paymentBadge(entry,escape)}<strong>${escape(entry.customer)}</strong><small>${entry.heldIds.length?'지정·미배정':'담당 미배정'}</small>${renderScheduleRental(entry,{compact:true,escapeHTML:escape})}</button>`).join('')}</div></section>`:''}<span class="tt-sr-only" data-tt-current-date="${escape(model.date)}">${dateKnown?'한국 시간 기준':''}</span></section>`;
}

export function bindTimetable(root,{state={},ui={},onChange,onOpenReservation,onCreateReservation,onMoveReservation,now=new Date()}={}){
  const view=root.querySelector('.tt-page');if(!view)return;
  const filters=configuration(ui,now),model=buildTimetableModel(state,filters,{now});
  const feedback=view.querySelector('[data-tt-move-feedback]'),scroller=view.querySelector('.tt-scroll');
  const document=view.ownerDocument,window=document?.defaultView;
  const announce=(message,error=false)=>{if(feedback){feedback.textContent=message;feedback.hidden=!message;feedback.classList.toggle('error',error);}};
  const columns=[...view.querySelectorAll('[data-tt-column]')];
  let dragged=null,suppressClickUntil=0,scrollFrame=null;
  const clearPreview=()=>columns.forEach(column=>{column.classList.remove('tt-drop-target');const marker=column.querySelector('[data-tt-drop-preview]');if(marker)marker.hidden=true;});
  const finishDrag=()=>{
    const previous=dragged;dragged=null;
    if(previous?.active)suppressClickUntil=Date.now()+300;
    view.classList.remove('tt-is-dragging');clearPreview();
    if(scrollFrame!==null){window?.cancelAnimationFrame(scrollFrame);scrollFrame=null;}
    try{if(previous?.button.hasPointerCapture?.(previous.pointerId))previous.button.releasePointerCapture(previous.pointerId);}catch{}
  };
  const open=id=>{if(Date.now()>=suppressClickUntil)onOpenReservation?.(id);};
  const columnAt=point=>{
    const column=document?.elementFromPoint(point.clientX,point.clientY)?.closest('[data-tt-column]');
    return columns.includes(column)?column:null;
  };
  const dropProposal=(point,column)=>{
    const minute=Math.round((model.startMinute+(point.clientY-column.getBoundingClientRect().top-dragged.offset)/model.pixelsPerMinute)/10)*10;
    if(!Number.isFinite(minute)||minute<0||minute>=1440)return {error:'당일 시간표 안에서 이동할 시간을 선택해 주세요.'};
    return proposeTimetableMove(model,{id:dragged.id,instructorId:column.dataset.ttColumn,startTime:timeText(minute)});
  };
  const preview=point=>{
    clearPreview();const column=columnAt(point);if(!column)return;
    const result=dropProposal(point,column);
    if(result.error){announce(result.error,true);return;}
    column.classList.add('tt-drop-target');
    const marker=column.querySelector('[data-tt-drop-preview]');
    if(marker){marker.hidden=false;marker.style.top=`${(timeMinutes(result.move.startTime)-model.startMinute)*model.pixelsPerMinute}px`;marker.style.height=`${(Math.min(1440,timeMinutes(result.move.endTime))-timeMinutes(result.move.startTime))*model.pixelsPerMinute}px`;marker.querySelector('span').textContent=`${result.move.startTime}–${lessonTimeLabel(result.move.endTime)} · 변경안`;}
  };
  const autoScroll=()=>{
    if(!dragged?.active||!scroller||!window?.requestAnimationFrame)return;
    const tick=()=>{
      if(!dragged?.active)return;
      const point=dragged.point,bounds=scroller.getBoundingClientRect();
      if(point.clientX>=bounds.left&&point.clientX<=bounds.right&&point.clientY>=bounds.top&&point.clientY<=bounds.bottom){
        const oldTop=scroller.scrollTop,oldLeft=scroller.scrollLeft;
        scroller.scrollTop+=point.clientY<bounds.top+120?-12:point.clientY>bounds.bottom-40?12:0;
        scroller.scrollLeft+=point.clientX<bounds.left+35?-12:point.clientX>bounds.right-35?12:0;
        if(oldTop!==scroller.scrollTop||oldLeft!==scroller.scrollLeft)preview(point);
      }
      scrollFrame=window.requestAnimationFrame(tick);
    };
    scrollFrame=window.requestAnimationFrame(tick);
  };
  const update=patch=>{ui.timetable={...filters,...patch};onChange?.(ui.timetable);};
  view.querySelector('.tt-filter-form').onsubmit=event=>{event.preventDefault();const values=new FormData(event.currentTarget);update({date:String(values.get('date')),company:String(values.get('company')),sport:String(values.get('sport')),selectedStart:String(values.get('selectedStart')),selectedEnd:String(values.get('selectedEnd'))});};
  view.querySelector('#tt-date').onchange=event=>{if(parseKstDate(event.target.value))update({date:event.target.value});};
  view.querySelectorAll('[data-tt-day]').forEach(button=>button.onclick=()=>update({date:dateShift(filters.date,Number(button.dataset.ttDay))}));
  view.querySelector('[data-tt-today]').onclick=()=>update({date:kstDate(now)});
  view.querySelectorAll('[data-tt-reservation]').forEach(button=>button.onclick=()=>open(button.dataset.ttReservation));
  view.querySelectorAll('[data-tt-change]').forEach(button=>button.onclick=()=>open(button.dataset.ttChange));
  view.querySelectorAll('[data-tt-slot]').forEach(button=>button.onclick=()=>{if(!button.disabled)onCreateReservation?.({date:filters.date,startTime:button.dataset.ttSlot,endTime:button.dataset.ttEnd,instructorId:button.dataset.ttInstructor});});
  view.querySelectorAll('[data-tt-drag-id]').forEach(button=>{
    button.draggable=false;
    button.classList.toggle('tt-movable',typeof onMoveReservation==='function');
    button.ondragstart=event=>event.preventDefault();
    button.onpointerdown=event=>{
      if(typeof onMoveReservation!=='function'||event.button!==0||event.isPrimary===false||event.pointerType==='touch'||dragged)return;
      const bounds=button.getBoundingClientRect();
      dragged={id:button.dataset.ttDragId,button,pointerId:event.pointerId,originX:event.clientX,originY:event.clientY,offset:Math.max(0,Math.min(bounds.height,event.clientY-bounds.top))+(Number(button.dataset.ttSegmentOffset)||0)*model.pixelsPerMinute,active:false};
      try{button.setPointerCapture?.(event.pointerId);}catch{}
    };
    button.onpointermove=event=>{
      if(!dragged||dragged.button!==button||dragged.pointerId!==event.pointerId)return;
      dragged.point={clientX:event.clientX,clientY:event.clientY};
      if(!dragged.active){
        if(Math.hypot(event.clientX-dragged.originX,event.clientY-dragged.originY)<6)return;
        dragged.active=true;suppressClickUntil=Infinity;view.classList.add('tt-is-dragging');
        announce('이동할 시간·강사 칸에 놓으면 변경안을 검토합니다.');autoScroll();
      }
      event.preventDefault();preview(dragged.point);
    };
    button.onpointerup=async event=>{
      if(!dragged||dragged.button!==button||dragged.pointerId!==event.pointerId)return;
      if(!dragged.active){finishDrag();return;}
      event.preventDefault();const column=columnAt(event),result=column?dropProposal(event,column):{error:'일정 변경을 취소했습니다.'};finishDrag();
      if(result.error){announce(result.error,true);return;}
      announce('변경안을 열었습니다. 예약 조건을 확인한 뒤 저장해 주세요.');
      try{await onMoveReservation(result.move);}catch(error){announce(error?.message||'변경안을 열지 못했습니다. 다시 시도해 주세요.',true);}
    };
    button.onpointercancel=event=>{if(dragged?.button===button&&dragged.pointerId===event.pointerId){const active=dragged.active;finishDrag();if(active)announce('일정 변경을 취소했습니다.');}};
    button.onlostpointercapture=()=>{if(dragged?.button===button){const active=dragged.active;finishDrag();if(active)announce('일정 변경을 취소했습니다.');}};
  });
  view.onkeydown=event=>{if(event.key==='Escape'&&dragged?.active){event.preventDefault();finishDrag();announce('일정 변경을 취소했습니다.');}};
}
