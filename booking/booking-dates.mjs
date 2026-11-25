import {parseKstDate,parseLessonTime,parseLessonInterval,evaluateCandidates,bookingLocation,reservationInstructorOrder,lessonPlanSettings,applyLessonPlan,lessonIntervalsOverlap,learnerAgeDetails} from './booking-rules.mjs?v=36';
import {canonicalTelephone,normalizeCustomerText} from './customer-teams.mjs?v=28';
import {kakaoContactId} from './kakao-contact.mjs?v=1';
import {applyFinancialV3,bookingFinancialSummary,parseBookingAmount,FINANCIAL_VERSION} from './booking-financial.mjs?v=12';
import {TEAM_DRAFT_UI_FIELDS} from './team-drafts.mjs?v=36';

export const MAX_BOOKING_DATES=100;
const clone=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const rawOf=value=>value?.raw||value?.raw_data||{};
const text=value=>String(value??'');
const idOf=row=>text(row?.id||row?.schedule_id);
const customerId=row=>text(row?.customerId||row?.customer_id);
const teamId=row=>text(row?.customerTeamId||row?.customer_team_id);
const passId=row=>text(row?.lessonPassId||row?.lesson_pass_id);
const seasonId=row=>text(row?.seasonId||row?.season_id);
const cancelled=row=>['cancelled','canceled'].includes(row?.status);
const uuid=()=>globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return(c==='x'?n:(n&3)|8).toString(16);});
const same=(a,b)=>a.date===b.date&&a.startTime===b.startTime&&a.endTime===b.endTime&&a.company===b.company;
const validRows=draft=>Array.isArray(draft?.dateBatch?.rows)?draft.dateBatch.rows:[];
const editable=draft=>{if(draft?.id)throw new Error('이미 저장된 예약은 회차별 예약 변경으로 수정해 주세요.');};
const planFields=value=>{const {lessonMinutes,breakMinutes}=lessonPlanSettings(value);return {lessonMinutes,breakMinutes};};
const financialRawKeys=['T','U','R','Y','P'];
const financialKeys=['rentalPaymentStatus','rentalHours','rentalAmount','rentalCustomAmount'];
const correctionKeys=['paymentRequestCorrection','currentAmountOverride','currentAmountCorrectionId','amountCorrectionVersion'];
const clearCorrection=value=>{for(const key of [...correctionKeys,'paymentRequestCorrectionResult','current_amount_override','current_amount_correction_id','amount_correction_version'])delete value[key];return value;};
const financialValue=(draft,camel,snake)=>own(draft,camel)?draft[camel]:draft?.[snake]??null;
const financialOf=draft=>({raw:Object.fromEntries(financialRawKeys.map(key=>[key,text(rawOf(draft)[key])])),
  rentalPaymentStatus:financialValue(draft,'rentalPaymentStatus','rental_payment_status'),
  rentalHours:financialValue(draft,'rentalHours','rental_hours'),rentalAmount:financialValue(draft,'rentalAmount','rental_amount'),
  rentalCustomAmount:draft?.rentalCustomAmount===true,financialVersion:FINANCIAL_VERSION,
  ...Object.fromEntries(correctionKeys.filter(key=>own(draft,key)&&draft[key]!==null&&draft[key]!==undefined).map(key=>[key,clone(draft[key])]))});
function financialSnapshot(value,fallback){
  const next=clone(fallback),source=value&&typeof value==='object'?value:{};
  for(const key of financialRawKeys)if(own(source.raw,key))next.raw[key]=text(source.raw[key]);
  for(const key of financialKeys)if(own(source,key))next[key]=source[key];
  for(const key of correctionKeys)if(own(source,key)){if(source[key]===null||source[key]===undefined)delete next[key];else next[key]=clone(source[key]);}
  next.financialVersion=FINANCIAL_VERSION;return next;
}
const freshDateFinancial=source=>clearCorrection({...clone(source),raw:{...clone(source.raw),Y:'0',U:'',R:''}});
const paymentFields=['paymentReviewId','paymentReviewVersion','paymentDepositId','paymentCommitRequestId','paymentNeedsBreakConfirmation','paymentReviewedRentalFee'];
function paymentMetadata(draft,financial){
  if(!draft?.paymentReviewId)return {};
  let amount=null;try{amount=parseBookingAmount(financial?.raw?.Y);}catch{/* Validation keeps an invalid entry editable. */}
  return {...Object.fromEntries(paymentFields.filter(key=>own(draft,key)).map(key=>[key,draft[key]])),paymentAllocationAmount:amount};
}
// Reference quotes belong to a dated row. An absent legacy row value is unknown,
// never the first session's quote copied into a different lesson.
function paymentRowMetadata(draft,row,financial=row.financial){
  return paymentMetadata({...draft,paymentNeedsBreakConfirmation:row.paymentNeedsBreakConfirmation===true,
    paymentReviewedRentalFee:own(row,'paymentReviewedRentalFee')?row.paymentReviewedRentalFee:null},financial);
}
function applyFinancialSnapshot(draft,financial){
  draft.raw={...draft.raw,...clone(financial.raw)};
  for(const key of financialKeys)draft[key]=financial[key];
  for(const key of correctionKeys){if(own(financial,key)&&financial[key]!==null&&financial[key]!==undefined)draft[key]=clone(financial[key]);else delete draft[key];}
  draft.patchEnabled=!!(text(financial.raw.U).trim()||text(financial.raw.R).trim());
  draft.financialVersion=FINANCIAL_VERSION;
  Object.assign(draft,paymentMetadata(draft,financial));
  try{draft.raw=applyFinancialV3(draft);}catch{/* Keep invalid amounts editable and let validation report them. */}
  return draft;
}
const scheduleOf=draft=>{const raw=rawOf(draft);return {date:parseKstDate(raw.A)||text(raw.A),startTime:text(raw.B),endTime:text(raw.C),company:text(raw.E),duration:text(raw.N),...planFields(draft)};};
const firstRow=draft=>({id:text(draft?.id||validRows(draft)[0]?.id||draft?.submissionId),...scheduleOf(draft),financial:financialOf(draft),...paymentMetadata(draft,financialOf(draft))});
const idFactory=options=>typeof options?.uuid==='function'?options.uuid:uuid;
const rowIdFactory=(options,used)=>{
  for(let i=0;i<20;i++){const id=`booking-${idFactory(options)()}`;if(!used.has(id)){used.add(id);return id;}}
  throw new Error('회차별 예약 번호를 만들지 못했습니다. 다시 시도해 주세요.');
};

/** Raw A/B/C/E/N remain the first session's authoritative editable fields. */
export function bookingDateRows(draft={}){
  const first=firstRow(draft);
  if(draft.id)return[first];
  const defaults=freshDateFinancial(first.financial);
  return[first,...validRows(draft).slice(1).map(row=>{const financial=financialSnapshot(row.financial,defaults);return {id:text(row.id),date:text(row.date),startTime:text(row.startTime),endTime:text(row.endTime),company:text(row.company),duration:text(row.duration),...planFields(row),financial,...paymentRowMetadata(draft,row,financial)};})];
}

/** Repeat lessons are grouped automatically; their teacher is chosen at assignment. */
export function automaticBookingSeason(draft={},context={}){
 const next=clone(draft);
 if(next.id||next.bookingType==='pass')return next;
 const count=Math.max(1,bookingDateRows(next).filter(row=>parseKstDate(row.date)).length);
 const pack=(context.seasonPackages||[]).find(item=>text(item.id)===seasonId(next));
 // 수강권 연결 예약(N9, 2026-11-16): 10회권이면 구매총회차 10으로 묶여 시즌 취급 —
 // 같은 강사 유지 자체는 수강권 fixed_instructor 규칙이 보장한다.
 const linkedPass=(context.lessonPasses||[]).find(item=>text(item.id)===text(next.lessonPassId));
 // 회차 수에서 자동 유도된 seasonTotal 은 회차가 줄면 같이 줄어야 한다('총 N회차' 고착 수정,
 // 2026-11-17). seasonTotalAuto 에 "자동 유도 당시 값"을 기억해 두고, 저장된 seasonTotal 이
 // 그 값 그대로면 count 기반으로 다시 계산한다. 패키지·수강권·검토가 명시한 값은 유지.
 const autoDerived=Number.isInteger(Number(next.seasonTotalAuto))&&Number(next.seasonTotalAuto)===Number(next.seasonTotal);
 const requested=Number(pack?.total_sessions??pack?.totalSessions??linkedPass?.total_sessions??linkedPass?.totalSessions??(autoDerived?NaN:next.seasonTotal));
 const total=Math.max(Number.isInteger(requested)&&requested>0?requested:1,count);
 if(Number.isInteger(requested)&&requested>0)delete next.seasonTotalAuto;else next.seasonTotalAuto=total;
 if(seasonId(next)||total>1){
  next.kind='season';next.seasonTotal=total;
  const occupied=new Set((context.reservations||[]).filter(row=>seasonId(next)&&seasonId(row)===seasonId(next)).map(row=>Number(row.sessionNumber??row.session_number)));
  let number=1;while(occupied.has(number))number++;next.sessionNumber=seasonId(next)&&!Array.isArray(context.reservations)?(next.sessionNumber||1):number;
 }else {next.kind=next.isReorder?'reorder':'single';next.seasonTotal=1;next.sessionNumber=null;}
 return next;
}

/** Allocate once, then retain both batch and per-row IDs through navigation/retry. */
export function ensureBookingDates(draft={},options={}){
  const next=clone(draft);if(next.id){delete next.dateBatch;return next;}
  const rows=bookingDateRows(next),used=new Set(rows.map(row=>row.id).filter(Boolean));
  if(!rows[0].id)rows[0].id=rowIdFactory(options,used);
  // The card identity stays fixed even when an earlier date becomes its first row.
  next.submissionId ||= rows[0].id;
  for(const row of rows.slice(1))if(!row.id)row.id=rowIdFactory(options,used);
  next.dateBatch={id:text(next.dateBatch?.id)||idFactory(options)(),rows};
  if(next.paymentReviewId)next.paymentAllocationAmount=rows[0].paymentAllocationAmount;
  return automaticBookingSeason(next);
}

/** Move complete dated rows together, including their stable IDs and lesson plans. */
export function sortBookingDates(draft,options={}){
  editable(draft);const next=ensureBookingDates(draft,options),rows=next.dateBatch.rows;
  const minute=value=>{const time=parseLessonTime(value);return time?time.hour*60+time.minute:Infinity;};
  rows.sort((a,b)=>(parseKstDate(a.date)||'9999').localeCompare(parseKstDate(b.date)||'9999')||minute(a.startTime)-minute(b.startTime));
  const first=rows[0];
  next.raw={...next.raw,A:first.date,B:first.startTime,C:first.endTime,E:first.company,N:first.duration};
  Object.assign(next,paymentRowMetadata(next,first));
  Object.assign(next,planFields(first));applyFinancialSnapshot(next,first.financial);next.location=bookingLocation({raw:next.raw});
  return next;
}

/** Calendar selections always appear earliest first; duplicates remain single rows. */
export function addBookingDates(draft,dates,options={}){
  editable(draft);const next=ensureBookingDates(draft,options),rows=next.dateBatch.rows,first=rows[0],used=new Set(rows.map(row=>row.id));
  if(!Array.isArray(dates))throw new Error('추가할 날짜를 선택해 주세요.');
  for(const value of dates){
    const date=parseKstDate(value);if(!date)throw new Error('추가할 강습 날짜를 확인해 주세요.');
    const financial=freshDateFinancial(first.financial),row={...first,date,financial,...paymentMetadata(next,financial)};if(rows.some(existing=>same(existing,row)))continue;
    if(rows.length>=MAX_BOOKING_DATES)throw new Error(`한 번에 최대 ${MAX_BOOKING_DATES}회까지 등록할 수 있습니다.`);
    row.id=rowIdFactory(options,used);rows.push(row);
  }
  return sortBookingDates(next,options);
}

/** Count includes the selected start date; repeated existing dates are kept once. */
export function repeatBookingDates(draft,{startDate,count,intervalWeeks=1}={},options={}){
  editable(draft);const date=parseKstDate(startDate||rawOf(draft).A),total=Number(count),weeks=Number(intervalWeeks);
  if(!date||!Number.isInteger(total)||total<1||total>MAX_BOOKING_DATES||!Number.isInteger(weeks)||weeks<1||weeks>52)throw new Error('반복 시작일과 1~100회 사이의 횟수를 확인해 주세요.');
  const start=Date.parse(`${date}T00:00:00Z`),dates=Array.from({length:total},(_,index)=>new Date(start+index*weeks*7*86400000).toISOString().slice(0,10));
  if(dates.some(value=>!parseKstDate(value)))throw new Error('반복 일정의 마지막 날짜를 확인해 주세요.');
  return addBookingDates(draft,dates,options);
}

export function updateBookingDate(draft,rowId,patch={},options={}){
  editable(draft);const next=ensureBookingDates(draft,options),rows=next.dateBatch.rows,index=rows.findIndex(row=>row.id===rowId);
  if(index<0)throw new Error('수정할 회차를 다시 확인해 주세요.');
  for(const key of ['date','startTime','endTime','company','duration'])if(own(patch,key))rows[index][key]=text(patch[key]);
  for(const key of ['lessonMinutes','breakMinutes'])if(own(patch,key))rows[index][key]=patch[key];
  if(rows[index].paymentReviewId&&(own(patch,'breakMinutes')&&[0,60,120].includes(patch.breakMinutes)||own(patch,'lessonMinutes')&&Number(patch.lessonMinutes)!==240))rows[index].paymentNeedsBreakConfirmation=false;
  if(own(patch,'financial'))rows[index].financial=financialSnapshot(patch.financial,rows[index].financial);
  Object.assign(rows[index],paymentRowMetadata(next,rows[index]));
  if(own(patch,'lessonMinutes')&&Number(patch.lessonMinutes)===120)rows[index].breakMinutes=0;
  if(['startTime','lessonMinutes','breakMinutes'].some(key=>own(patch,key))&&lessonPlanSettings(rows[index]).explicit){
    const row=rows[index],updated=applyLessonPlan({...planFields(row),raw:{B:row.startTime,C:row.endTime,N:row.duration}});
    Object.assign(row,planFields(updated),{endTime:updated.raw.C,duration:updated.raw.N});
  }
  if(index===0){next.raw={...next.raw,A:rows[0].date,B:rows[0].startTime,C:rows[0].endTime,E:rows[0].company,N:rows[0].duration};Object.assign(next,paymentRowMetadata(next,rows[0]));Object.assign(next,planFields(rows[0]));applyFinancialSnapshot(next,rows[0].financial);}
  return next;
}

export function removeBookingDate(draft,rowId,options={}){
  editable(draft);const next=ensureBookingDates(draft,options),rows=next.dateBatch.rows,index=rows.findIndex(row=>row.id===rowId);
  if(index<0)return next;
  if(rows.length===1)throw new Error('등록할 일정은 한 개 이상 남겨 주세요.');
  rows.splice(index,1);
  // Promote the remaining row as a whole. The card and row IDs stay stable for retries.
  if(index===0){const first=rows[0];next.raw={...next.raw,A:first.date,B:first.startTime,C:first.endTime,E:first.company,N:first.duration};Object.assign(next,paymentRowMetadata(next,first));Object.assign(next,planFields(first));applyFinancialSnapshot(next,first.financial);next.location=bookingLocation({raw:next.raw});}
  return sortBookingDates(next,options);
}

/** Deliberate common-value action leaves each chosen calendar date unchanged. */
export function applyCommonBookingDateValues(draft,options={}){
  editable(draft);const next=ensureBookingDates(draft,options),first=next.dateBatch.rows[0];
  for(const row of next.dateBatch.rows.slice(1))Object.assign(row,{startTime:first.startTime,endTime:first.endTime,company:first.company,duration:first.duration,...planFields(first),...(next.paymentReviewId?{paymentNeedsBreakConfirmation:first.paymentNeedsBreakConfirmation===true}:{})});
  return next;
}

/** Explicitly copy tuition, rental and received money; patch fees and notes remain per date. */
export function applyCommonBookingDateFinancials(draft,options={}){
  editable(draft);const next=ensureBookingDates(draft,options),first=next.dateBatch.rows[0].financial;
  for(const row of next.dateBatch.rows.slice(1)){
    row.financial=financialSnapshot({raw:{T:first.raw.T,...(!next.paymentReviewId?{Y:first.raw.Y}:{})},...Object.fromEntries(financialKeys.map(key=>[key,first[key]]))},row.financial);
    Object.assign(row,paymentRowMetadata(next,row));
  }
  return next;
}

/** Another team inherits dates and, only when selected, each date's complete financial facts. */
export function copyBookingDatesForTeam(source,newDraft,options={}){
  editable(newDraft);const next=clearCorrection(clone(newDraft));delete next.dateBatch;
  if(source.paymentReviewId){
    Object.assign(next,paymentMetadata(source,{raw:{Y:'0'}}),{paymentReviewedRentalFee:options.copyFinancials===true?source.paymentReviewedRentalFee??null:null});
    next.paymentCommitRequestId=idFactory(options)();
    next.raw={...next.raw,Y:'0'};
  }
  const rows=bookingDateRows(source),used=new Set(rows.map(row=>row.id).filter(Boolean));
  const financial=financialOf(next),copyFinancials=options.copyFinancials===true;
  next.submissionId=rowIdFactory(options,used);
  next.raw={...next.raw,A:rows[0].date,B:rows[0].startTime,C:rows[0].endTime,E:rows[0].company,N:rows[0].duration};
  Object.assign(next,planFields(rows[0]));
  next.dateBatch={id:idFactory(options)(),rows:rows.map((row,index)=>{
    const money=clearCorrection(copyFinancials?clone(row.financial):index===0?clone(financial):freshDateFinancial(financial));
    if(next.paymentReviewId)money.raw.Y='0';
    return {...row,id:index===0?next.submissionId:rowIdFactory(options,used),financial:money,...paymentRowMetadata(next,{...row,paymentReviewedRentalFee:copyFinancials?row.paymentReviewedRentalFee??null:null},money)};
  })};
  if(copyFinancials)applyFinancialSnapshot(next,next.dateBatch.rows[0].financial);
  return next;
}

const uiFields=[...TEAM_DRAFT_UI_FIELDS,'dateBatch','candidateRequestToken','seasonTotalAuto','contactKakaoMode'];
const overlaps=lessonIntervalsOverlap;
function sameTeam(a,b){
  const ca=customerId(a),cb=customerId(b),ta=teamId(a),tb=teamId(b);
  if(ca||cb||ta||tb)return !!ca&&ca===cb&&!!ta&&ta===tb;
  const ar=rawOf(a),br=rawOf(b),phone=canonicalTelephone(ar.L);
  return !!phone&&phone===canonicalTelephone(br.L)&&normalizeCustomerText(ar.H)!==''&&normalizeCustomerText(ar.H)===normalizeCustomerText(br.H)&&normalizeCustomerText(ar.I)===normalizeCustomerText(br.I)&&normalizeCustomerText(ar.D)===normalizeCustomerText(br.D);
}
const keyError=(row,index,message)=>({rowId:row.id,index,message});

/** Build an all-or-none proposal. The server remains authoritative for concurrent writes. */
export function buildBookingBatch(draft={},context={},options={}){
  let prepared=automaticBookingSeason(ensureBookingDates(draft,options),context);
  // 일정과 금액·구성까지 완전히 동일한 "유령 복제" 회차만 저장 직전에 하나로 접는다
  // (2026-11-17: 서버의 '같은 팀의 일괄 예약 날짜·시간이 서로 겹칩니다' 차단 원인).
  // 금액이 다른 같은 시각 회차는 사람이 판단해야 하므로 기존 중복 오류를 그대로 낸다.
  const sameFull=(a,b)=>same(a,b)&&a.lessonMinutes===b.lessonMinutes&&a.breakMinutes===b.breakMinutes&&JSON.stringify(a.financial??null)===JSON.stringify(b.financial??null);
  const allRows=bookingDateRows(prepared),kept=[];
  const rows=allRows.filter(row=>{if(row.date&&kept.some(prev=>sameFull(prev,row)))return false;kept.push(row);return true;});
  if(rows.length!==allRows.length&&prepared.dateBatch){
    prepared.dateBatch.rows=prepared.dateBatch.rows.filter(row=>rows.some(keep=>keep.id===row.id));
    prepared=automaticBookingSeason(prepared,context);
  }
  const errors=[];
  const payloads=rows.map((row,index)=>{
    const value=applyFinancialSnapshot(clone(prepared),row.financial);for(const key of uiFields)delete value[key];
    value.id=row.id;value.raw={...value.raw,A:row.date,B:row.startTime,C:row.endTime,E:row.company,N:row.duration};
    Object.assign(value,paymentRowMetadata(prepared,row));
    Object.assign(value,planFields(row));
    // Legacy payroll fields are not copied to newly added sessions. Explicit
    // tuition, rental and received amounts stay attached to each stable row ID.
    if(index>0){value.raw.AB='';value.raw.AC='';}
    value.instructorIds=reservationInstructorOrder(value);
    value.location=bookingLocation({raw:value.raw});
    value.status=value.instructorIds.length?'confirmed':'received';
    value.financialVersion=FINANCIAL_VERSION;
    try{value.raw=applyFinancialV3(value);}catch(error){errors.push(keyError(row,index,error.message));}
    if(!draft.id){delete value.expectedUpdatedAt;delete value.updated_at;delete value.updatedAt;delete value.created_at;delete value.createdAt;}
    return value;
  });
  const ids=new Set();
  for(const [index,row]of rows.entries()){
    if(!row.id||ids.has(row.id))errors.push(keyError(row,index,'회차별 예약 번호가 중복되었습니다. 초안을 다시 확인해 주세요.'));
    ids.add(row.id);
  }
  if(rows.length>MAX_BOOKING_DATES)errors.push(keyError(rows[0],0,`한 번에 최대 ${MAX_BOOKING_DATES}회까지 등록할 수 있습니다.`));
  const savedRows=(context.reservations||[]).filter(row=>!ids.has(idOf(row))),pendingRows=(context.pendingReservations||[]).filter(row=>!ids.has(idOf(row)));
  const existingRows=[...savedRows,...pendingRows],intervals=payloads.map(parseLessonInterval);
  if(prepared.kind==='season'){
    const pack=(context.seasonPackages||[]).find(item=>text(item.id)===seasonId(prepared));
    const total=Number(pack?.total_sessions??pack?.totalSessions??prepared.seasonTotal),start=prepared.id?(Number(prepared.sessionNumber)||1):1;
    const occupied=new Set(existingRows.filter(row=>seasonId(prepared)&&seasonId(row)===seasonId(prepared)).map(row=>Number(row.sessionNumber??row.session_number)));
    let session=start;
    for(const [index,payload]of payloads.entries()){
      while(occupied.has(session))session++;
      payload.seasonTotal=total;payload.sessionNumber=session;
      if(!Number.isInteger(total)||total<1||total>100||!Number.isInteger(start)||start<1||session>total)errors.push(keyError(rows[index],index,'시즌 강습의 미예약 회차보다 추가할 일정이 많습니다. 구매 총회차를 확인해 주세요.'));
      occupied.add(session++);
    }
  }
  const selectedPass=(context.lessonPasses||[]).find(item=>text(item.id)===passId(prepared));
  if(passId(prepared)){
    const used=new Set(existingRows.filter(row=>passId(row)===passId(prepared)).map(idOf)).size;
    if(!selectedPass)errors.push(keyError(rows[0],0,'연결된 수강권 정보를 다시 확인해 주세요.'));
    else if(Number(selectedPass.total_sessions??selectedPass.totalSessions)-used<rows.length)errors.push(keyError(rows[0],0,'수강권의 미예약 잔여 횟수보다 추가할 일정이 많습니다.'));
  }
  const peerSchedules=payloads.map((payload,index)=>({id:payload.id,start:intervals[index].start,end:intervals[index].end,...planFields(payload),instructorUserIds:payload.instructorIds,instructorUserId:payload.instructorIds[0]||null}));
  const validationContext={...context,reservations:[...existingRows,...payloads],schedules:[...(context.schedules||[]).filter(row=>!ids.has(idOf(row))),...peerSchedules]};
  for(const [index,payload]of payloads.entries()){
    const row=rows[index],interval=intervals[index];
    const add=message=>{if(!errors.some(error=>error.rowId===row.id&&error.message===message))errors.push(keyError(row,index,message));};
    if(interval.error)add(interval.error);
    if(payload.paymentNeedsBreakConfirmation&&payload.lessonMinutes===240)add('4시간 강습의 중간 휴식을 확인해 주세요.');
    if(payload.paymentReviewId&&payload.paymentReviewedRentalFee!==null&&payload.paymentReviewedRentalFee!==undefined&&!payload.rentalPaymentStatus)add('입금 검토에 장비금액이 있습니다. 장비렌탈 결제상태와 이용시간을 확인해 주세요.');
    const ageDetails=learnerAgeDetails(payload);if(ageDetails.error)add(ageDetails.error);
    if(!text(payload.raw.E).trim())add('강습업체·지점을 입력해 주세요.');
    if(!text(payload.raw.H).trim())add('고객명(입금자)을 입력해 주세요.');
    if(text(payload.raw.L).trim()&&!canonicalTelephone(payload.raw.L)&&!kakaoContactId(payload.raw.L))add('전화번호 형식을 확인해 주세요.');
    if(!Number.isInteger(Number(payload.raw.M))||Number(payload.raw.M)<1||Number(payload.raw.M)>1000)add('강습 인원을 1명 이상으로 확인해 주세요.');
    if(!['스키','보드'].includes(payload.raw.D))add('강습 종목을 선택해 주세요.');
    if(!text(payload.raw.T).trim())add('강습요금을 입력해 주세요. 무료이면 0원을 입력해 주세요.');
    for(let other=0;other<intervals.length;other++)if(other!==index&&overlaps(interval,intervals[other]))add(`${other+1}회차와 강습 시간이 겹칩니다.`);
    const conflict=existingRows.find(other=>!cancelled(other)&&sameTeam(payload,other)&&overlaps(interval,parseLessonInterval(other)));
    if(conflict)add('같은 팀의 기존 예약과 강습 시간이 겹칩니다.');
    if(selectedPass&&existingRows.some(other=>passId(other)===selectedPass.id&&overlaps(interval,parseLessonInterval(other))))add('같은 수강권의 기존 강습과 시간이 겹칩니다.');
    const result=evaluateCandidates(payload,validationContext);
    if(payload.instructorIds.length){
      if(result.needsReview)add('배정 전에 나이·경험·종목별 기술 응답과 강사 조건을 확인해 주세요.');
      for(const selected of payload.instructorIds){const candidate=result.candidates.find(item=>item.instructorId===selected);if(!candidate?.eligible)add(candidate?.blockedReasons?.join(' · ')||'선택한 강사 계정을 확인해 주세요.');}
      if(result.requiredInstructorId&&!payload.instructorIds.includes(result.requiredInstructorId))add('지정된 담당 강사를 배정에 포함해 주세요.');
    }else if(result.requiredInstructorId){
      const fixed=result.candidates.find(item=>item.instructorId===result.requiredInstructorId);
      if(!fixed)add('전 회차를 담당할 강사 계정을 확인해 주세요.');
      else for(const code of ['OVERLAP','TIME_OFF','INACTIVE'])if(fixed.reasonCodes.includes(code))add(fixed.blockedReasons[fixed.reasonCodes.indexOf(code)]);
    }
    if((prepared.designated||prepared.isReorder||prepared.kind==='reorder')&&!prepared.preferredInstructorId)add('지정 강사를 선택해 주세요.');
  }
  const totals=payloads.reduce((sum,payload)=>{try{const value=bookingFinancialSummary(payload);sum.requested+=value.requested;sum.paid+=value.paid;sum.balance+=value.balance;sum.overpaid+=value.overpaid;}catch{/* Per-row error above. */}return sum;},{requested:0,paid:0,balance:0,overpaid:0});
  totals.netBalance=Math.max(totals.requested-totals.paid,0);
  totals.netOverpaid=Math.max(totals.paid-totals.requested,0);
  return {draft:prepared,batchId:prepared.dateBatch?.id||null,payloads,errors,totals,valid:errors.length===0};
}

/** One common teacher must be eligible on every proposed date, never just the first. */
export function evaluateBookingBatchCandidates(draft={},context={}){
  if(bookingDateRows(draft).length===1)return evaluateCandidates(draft,context);
  const batch=buildBookingBatch(draft,context),ownIds=new Set(batch.payloads.map(row=>row.id));
  const reservations=[...(context.reservations||[]).filter(row=>!ownIds.has(idOf(row))),...(context.pendingReservations||[]).filter(row=>!ownIds.has(idOf(row))),...batch.payloads];
  const schedules=[...(context.schedules||[]).filter(row=>!ownIds.has(idOf(row))),...batch.payloads.map(row=>({id:row.id,...parseLessonInterval(row),instructorUserIds:row.instructorIds,instructorUserId:row.instructorIds[0]||null}))];
  const results=batch.payloads.map(payload=>evaluateCandidates(payload,{...context,reservations,schedules})),first=results[0];
  const candidates=first.candidates.map(candidate=>{
    const peers=results.map(result=>result.candidates.find(item=>item.instructorId===candidate.instructorId));
    const reasonCodes=[...new Set(peers.flatMap(peer=>peer?.reasonCodes||['INACTIVE']))];
    const blockedReasons=peers.flatMap((peer,index)=>peer?.eligible?[]:(peer?.blockedReasons||['강사 계정을 확인해 주세요.']).map(reason=>`${batch.payloads[index].raw.A} · ${reason}`));
    const eligible=peers.every(peer=>peer?.eligible);
    return {...candidate,eligible,reasonCodes,blockedReasons,workload:peers.reduce((sum,peer)=>sum+(peer?.workload||0),0),reasons:eligible?[`${batch.payloads.length}회 전체 일정·휴무·종목·지점 확인`,...(candidate.reasons||[]).filter(reason=>reason!=='시간·휴무·종목·지점 확인')]:[],dateCount:batch.payloads.length};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.workload-b.workload||a.name.localeCompare(b.name,'ko-KR')||a.instructorId.localeCompare(b.instructorId));
  const reasons=[...new Set(results.flatMap((result,index)=>result.reasons.map(reason=>`${batch.payloads[index].raw.A} · ${reason}`)))];
  return {...first,candidates,eligible:candidates.filter(candidate=>candidate.eligible),needsReview:results.some(result=>result.needsReview),reasons,dateCount:batch.payloads.length};
}
