import {hydratePaymentIntake,validatePaymentIntake,paymentIntakeTotals} from './payment-intake-state.mjs?v=8';
import {canonicalTelephone,normalizeCustomerText} from './customer-teams.mjs?v=27';
import {parseKstDate,parseLessonTime} from './booking-rules.mjs?v=35';

const list=value=>Array.isArray(value)?value:[];
const clone=value=>structuredClone(value);
const text=value=>normalizeCustomerText(value);
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'');
const money=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000000;
const raw=row=>row?.raw||row?.raw_data||{};
const number=value=>{const parsed=typeof value==='number'?value:typeof value==='string'&&/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value.trim())?Number(value.replaceAll(',','')):NaN;return Number.isSafeInteger(parsed)&&parsed>=0?parsed:null;};
const idOf=row=>text(row?.id||row?.scheduleId||row?.schedule_id);
const customerId=row=>text(row?.customerId||row?.customer_id);
const customerTeamId=row=>text(row?.customerTeamId||row?.customer_team_id||row?.teamId);
const cancelled=row=>['cancelled','canceled','deleted','refunded'].includes(text(row?.status).toLowerCase())||!!(row?.cancelledAt||row?.cancelled_at||row?.deletedAt||row?.deleted_at);
const removed=row=>['deleted','refunded'].includes(text(row?.status).toLowerCase())||!!(row?.deletedAt||row?.deleted_at);
const sport=value=>({ski:'스키',board:'보드'})[value]||text(value);
const clock=value=>parseLessonTime(text(value))?.value||'';
const sourceId=row=>text(row?.reservationId||row?.reservation_id||row?.bookingId||row?.scheduleId||row?.schedule_id);
const teamLabel=team=>text(team.draft?.teamName||team.label);
function reservationFacts(row){
  const cells=raw(row),separate=(row.teamPhoneMode||row.team_phone_mode)==='separate';
  const rentalStatus=row.rentalPaymentStatus??row.rental_payment_status;
  const hours=/^(\d+)\s*시간$/u.exec(text(cells.N)),lessonMinutes=number(row.lessonMinutes??row.lesson_minutes)??(hours?Number(hours[1])*60:null);
  const start=parseLessonTime(text(cells.B)),end=parseLessonTime(text(cells.C)),elapsed=start&&end?(end.hour*60+end.minute)-(start.hour*60+start.minute):null;
  const recordedBreak=elapsed!==null&&lessonMinutes!==null&&elapsed>=lessonMinutes?elapsed-lessonMinutes:null;
  const agrees=(left,right,normalize=text)=>left===null||left===undefined||left===''||right===null||right===undefined||right===''||normalize(left)===normalize(right);
  const consistent=agrees(row.date,cells.A,parseKstDate)&&agrees(row.startTime,cells.B,clock)&&agrees(row.company,cells.E)&&agrees(row.sport,cells.D,sport)&&agrees(row.customerName||row.customer_name,cells.H)&&agrees(row.teamName,cells.I)
    &&(separate||agrees(row.customerContactPhone||row.customer_contact_phone,cells.L,canonicalTelephone))&&agrees(row.studentCount,cells.M,number)&&agrees(row.lessonFee,cells.T,number)
    &&agrees(row.lessonMinutes??row.lesson_minutes,hours?Number(hours[1])*60:null,number)&&agrees(row.breakMinutes??row.break_minutes,recordedBreak,number);
  return {
    consistent,
    date:parseKstDate(row.date||cells.A)||'',startTime:clock(row.startTime||cells.B),company:text(row.company||cells.E),sport:sport(row.sport||cells.D),
    customerName:text(row.customerName||row.customer_name||cells.H),teamName:text(row.teamName||cells.I),
    phone:canonicalTelephone(row.customerContactPhone||row.customer_contact_phone||(!separate&&(row.phone||cells.L)))||'',
    teamPhone:canonicalTelephone(cells.L||row.phone)||'',customerId:customerId(row),teamId:customerTeamId(row),
    paid:number(cells.Y??row.paidAmount),lessonFee:number(cells.T??row.lessonFee),rentalFee:rentalStatus==='free'?0:number(row.rentalAmount??row.rental_amount),
    studentCount:number(row.studentCount??cells.M),lessonMinutes,breakMinutes:number(row.breakMinutes??row.break_minutes)??recordedBreak,
  };
}
function matchesSession(target,amount,team,session,originalTeam,originalSession){
  if(!target.facts.consistent)return false;
  const draft=team.draft,explicit=sourceId(originalSession)||sourceId(originalTeam?.draft)||sourceId(originalTeam);
  if(explicit&&explicit!==target.id)return false;
  const expected={date:parseKstDate(session.date)||'',startTime:clock(session.startTime),company:text(draft.company),sport:sport(draft.sport),customerName:text(draft.customerName),teamName:teamLabel(team),phone:canonicalTelephone(draft.phone)||''};
  for(const key of Object.keys(expected))if(!expected[key]||expected[key]!==target.facts[key])return false;
  if(session.allocatedAmount!==amount||target.facts.paid===null||target.facts.paid<amount)return false;
  if(draft.customerId&&draft.customerId!==target.facts.customerId||draft.teamId&&draft.teamId!==target.facts.teamId)return false;
  if(team.registrationFields?.teamPhoneMode==='separate'&&canonicalTelephone(team.registrationFields.teamPhone)!==target.facts.teamPhone)return false;
  for(const key of ['lessonMinutes','breakMinutes','lessonFee','rentalFee'])if(session[key]!==null&&session[key]!==undefined&&session[key]!==''&&session[key]!==target.facts[key])return false;
  if(draft.studentCount!==null&&draft.studentCount!==undefined&&draft.studentCount!==target.facts.studentCount)return false;
  return true;
}

/** Reconcile a frozen server review with its exact committed ledger targets.
 * This is an ephemeral booking handoff only. Never persist this reduced draft
 * through review-save: the original review and evidence remain the audit record.
 */
export function reconcilePaymentReviewProgress(review={},context={}){
  const savedSessions=[],remaining=money(review.remainingAmount)?review.remainingAmount:null;
  const result=(kind,draft=null,error='')=>({kind,draft,savedSessions:clone(savedSessions),remainingAmount:remaining,error});
  const blocked=message=>result('blocked',null,message);
  if(!money(review.amount)||!money(review.allocatedAmount)||remaining===null||review.allocatedAmount+remaining!==review.amount||!Array.isArray(review.allocations))return blocked('입금 배분 잔액을 확인하지 못했습니다. 입금 검토를 새로 불러와 주세요.');
  const allocations=review.allocations;
  if(allocations.some(row=>!row||!money(row.amount))||allocations.reduce((sum,row)=>sum+row.amount,0)!==review.allocatedAmount)return blocked('저장된 입금 배분 기록과 잔액이 다릅니다. 관리자 확인이 필요합니다.');
  if(!allocations.length)return result('none');
  if(!['approved','committed'].includes(review.status))return blocked('입금 배분이 있는 검토의 상태를 확인해 주세요.');
  const originalTeams=review.draft?.paymentComparison?.appliedProposal?.reviewedTeams;
  if(!Array.isArray(originalTeams)||!originalTeams.length||originalTeams.some(team=>team.bookingType==='pass'||!team.draft||!Array.isArray(team.sessions)||!team.sessions.length))return blocked('저장한 예약과 대조할 원래 팀·회차가 없습니다. 관리자 확인이 필요합니다.');
  let draft;
  try{draft=hydratePaymentIntake(review.draft);}catch{return blocked('저장된 팀·회차 근거를 복원하지 못했습니다. 입금 검토를 다시 불러와 주세요.');}
  const applied=draft.paymentComparison.appliedProposal,teams=applied.reviewedTeams,seenTargets=new Set(),usedSessions=new Set(),matchedTeamIds=new Map();
  if(teams.some(team=>team.sessions.some(session=>!money(session.allocatedAmount))))return blocked('원래 회차별 입금 배분액이 불명확합니다. 관리자 확인이 필요합니다.');
  for(const allocation of allocations){
    const reservationId=text(allocation.reservationId);
    if(!reservationId||allocation.lessonPassId||seenTargets.has(reservationId))return blocked('수강권 또는 중복된 입금 배분 대상은 예약 회차와 자동 대조할 수 없습니다.');
    seenTargets.add(reservationId);
    const rows=list(Array.isArray(context.paymentReservations)?context.paymentReservations:context.reservations).filter(row=>idOf(row)===reservationId);
    if(rows.length!==1||removed(rows[0]))return blocked('이미 배분된 예약이 없거나 삭제·환불되었습니다. 기존 예약을 확인한 뒤 진행해 주세요.');
    if(rows[0].paymentReviewId&&rows[0].paymentReviewId!==review.id)return blocked('예약에 연결된 입금 검토 번호가 현재 배분 기록과 다릅니다. 기존 예약을 확인해 주세요.');
    const target={id:reservationId,row:rows[0],facts:reservationFacts(rows[0])},matches=[];
    for(const [teamIndex,team] of teams.entries())for(const [sessionIndex,session] of team.sessions.entries()){
      if(matchesSession(target,allocation.amount,team,session,originalTeams[teamIndex],originalTeams[teamIndex]?.sessions?.[sessionIndex]))matches.push({team,session,teamIndex,sessionIndex,key:`${teamIndex}:${sessionIndex}`});
    }
    if(matches.length!==1||usedSessions.has(matches[0]?.key))return blocked('이미 저장된 예약이 원래 팀·날짜·금액과 하나로 일치하지 않습니다. 중복 예약을 막기 위해 자동 이어 작성을 보류했습니다.');
    const match=matches[0];usedSessions.add(match.key);
    if(!uuid(target.facts.customerId)||!uuid(target.facts.teamId))return blocked('저장된 예약의 고객·팀 연결을 확인하지 못했습니다. 고객을 중복 생성하지 않도록 관리자 확인이 필요합니다.');
    const prior=matchedTeamIds.get(match.team.id);if(prior&&prior!==target.facts.teamId)return blocked('같은 검토 팀이 서로 다른 고객 팀에 저장되어 있습니다. 기존 예약을 확인해 주세요.');
    matchedTeamIds.set(match.team.id,target.facts.teamId);
    savedSessions.push({reservationId,teamId:match.team.id,sessionId:match.session.id,amount:allocation.amount,cancelled:cancelled(target.row),customerId:target.facts.customerId,customerTeamId:target.facts.teamId,teamName:teamLabel(match.team),date:match.session.date,startTime:match.session.startTime});
  }
  const customers=new Set(savedSessions.map(row=>row.customerId));
  if(customers.size!==1)return blocked('같은 입금의 예약이 여러 고객에 연결되어 있습니다. 고객 연결을 먼저 확인해 주세요.');
  const linkedCustomer=[...customers][0];
  if(draft.customerId&&draft.customerId!==linkedCustomer||teams.some(team=>team.draft.customerId&&team.draft.customerId!==linkedCustomer)||list(context.customers).some(row=>text(row.id)===linkedCustomer&&cancelled(row)))return blocked('원래 검토와 저장된 예약의 고객 연결이 다릅니다. 고객을 확인해 주세요.');
  const pending=[];
  for(const [teamIndex,team] of teams.entries()){
    team.sessions=team.sessions.filter((session,index)=>!usedSessions.has(`${teamIndex}:${index}`));
    if(!team.sessions.length)continue;
    if(!Array.isArray(context.customerTeams))return blocked('기존 고객의 팀 목록을 불러오지 못했습니다. 중복 팀을 만들지 않도록 다시 불러와 주세요.');
    if(text(team.draft.customerName)!==text(draft.customerName)||canonicalTelephone(team.draft.phone)!==canonicalTelephone(draft.phone))return blocked('남은 팀의 고객 이름·연락처가 검토의 고객과 다릅니다. 고객 연결을 확인해 주세요.');
    const knownTeam=matchedTeamIds.get(team.id),explicit=text(team.draft.teamId),candidateIds=new Set();
    for(const row of list(context.customerTeams))if(customerId(row)===linkedCustomer&&text(row.name)===teamLabel(team)&&!cancelled(row)&&uuid(text(row.id)))candidateIds.add(text(row.id));
    if(knownTeam)candidateIds.add(knownTeam);
    if(explicit){
      if(!uuid(explicit)||!candidateIds.has(explicit)||knownTeam&&knownTeam!==explicit)return blocked('남은 팀의 기존 고객 팀 연결을 확인하지 못했습니다. 고객·팀을 다시 확인해 주세요.');
    }else if(!knownTeam&&candidateIds.size>1)return blocked('같은 고객에게 이름이 같은 팀이 여러 개 있습니다. 남은 팀을 직접 확인해 주세요.');
    team.draft.customerId=linkedCustomer;team.draft.teamId=explicit||knownTeam||[...candidateIds][0]||'';
    Object.assign(team.draft,Object.fromEntries(['date','startTime','lessonMinutes','breakMinutes','lessonFee','rentalFee','allocatedAmount'].map(key=>[key,team.sessions[0][key]])));
    pending.push(team);
  }
  if(!pending.length)return result('complete');
  applied.reviewedTeams=pending;applied.activeTeamId=pending[0].id;draft.customerId=linkedCustomer;
  draft=hydratePaymentIntake(draft);
  const total=paymentIntakeTotals(draft).allocatedAmount;
  if(!Number.isSafeInteger(total)||total>remaining)return blocked('남은 팀·회차의 배분액이 미배분 입금액보다 큽니다. 기존 배분을 확인해 주세요.');
  const problem=validatePaymentIntake(draft,remaining,{allowIncomplete:true});if(problem)return blocked(problem);
  return result('partial',draft);
}
