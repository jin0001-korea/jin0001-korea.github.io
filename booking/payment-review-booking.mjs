import {createBookingDraft,applyFemaleInstructorPreference,applyEnglishInstructorPreference,applyLevel2InstructorPreference} from './booking-view.mjs?v=100';
import {ensureBookingDates,bookingDateRows,sortBookingDates} from './booking-dates.mjs?v=70';
import {parseKstDate,parseLessonTime,lessonPlanEndTime,bookingLocation} from './booking-rules.mjs?v=35';
import {parseBookingAmount} from './booking-financial.mjs?v=12';
import {canonicalTelephone} from './customer-teams.mjs?v=27';
import {kakaoContactId,kakaoContactValue} from './kakao-contact.mjs?v=1';
import {paymentIntakeCorrectionError} from './payment-intake-state.mjs?v=8';
import {buildPaymentInstructorNotes} from './payment-instructor-notes.mjs?v=2';
import {defaultPaymentSeasonRegistration} from './payment-proposal-policy.mjs?v=5';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone=value=>JSON.parse(JSON.stringify(value));
const text=value=>typeof value==='string'&&!/^(?:unknown|미확인)$/i.test(value.trim())?value.trim():'';
const knownAmount=value=>value===null||value===undefined||value===''?null:parseBookingAmount(value);
const newId=()=>globalThis.crypto.randomUUID();
const fail=message=>{throw new Error(message);};
function reviewedParticipants(value,count){
  const blank=()=>Array.from({length:count||0},()=>({type:'',age:null}));
  if(!Array.isArray(value)||!value.length||value.length>20||value.length!==count)return blank();
  return value.map(row=>row?.type==='adult'?{type:'adult',age:null}:row?.type==='minor'?{type:'minor',age:Number.isSafeInteger(row.age)&&row.age>=1&&row.age<=19?row.age:null}:{type:'',age:null});
}
function appliedProposalNotes(approvedDraft){
  return buildPaymentInstructorNotes(approvedDraft);
}
function applyReviewedRegistration(draft,approvedDraft){
  const applied=approvedDraft.paymentComparison?.appliedProposal||{};
  const values=defaultPaymentSeasonRegistration(applied.registrationFields||{},{bookingType:applied.bookingType,sessions:applied.sessions||[approvedDraft],facts:applied.fields});
  if(values.paymentRequestCorrection!=null){const error=paymentIntakeCorrectionError(values.paymentRequestCorrection);if(error)fail(error);draft.paymentRequestCorrection={...clone(values.paymentRequestCorrection),reason:values.paymentRequestCorrection.reason.trim()};}
  const status=values.rentalPaymentStatus??applied.rentalPaymentStatus;
  if(['free','paid','onsite_unpaid'].includes(status)){
    if(status==='free'&&draft.rentalAmount!==null&&draft.rentalAmount!==0)fail('장비 무료 상태와 장비금액이 다릅니다. 검토 화면에서 확인해 주세요.');
    draft.rentalPaymentStatus=status;
    if(status==='free'){draft.rentalAmount=0;draft.rentalCustomAmount=false;draft.paymentReviewedRentalFee=0;}
  }
  if([4,6].includes(values.rentalHours))draft.rentalHours=values.rentalHours;
  if(typeof values.cashReceiptRequested==='boolean')draft.cashReceiptRequested=values.cashReceiptRequested;
  if(['team_phone','manual'].includes(values.cashReceiptNumberMode))draft.cashReceiptNumberMode=values.cashReceiptNumberMode;
  if(typeof values.cashReceiptNumber==='string')draft.cashReceiptNumber=values.cashReceiptNumber.replace(/[^0-9]/g,'').slice(0,20);
  for(const key of ['parallelLongTurn','snowboardNoviceTurn','juniorPreparation'])if(typeof values[key]==='boolean')draft[key]=values[key];
  if(Number.isSafeInteger(values.experienceCount)&&values.experienceCount>=0&&values.experienceCount<=999)draft.experienceCount=values.experienceCount;
  if(['가족','자녀','성인','단체'].includes(values.relationship))draft.raw.K=values.relationship;
  // 여자/영어 강사 요청은 특이사항(G)의 표준 문구로 동일하게 전달한다(접수 폼과 패리티).
  if(['','prefer','require'].includes(values.femalePreference))draft.raw.G=applyFemaleInstructorPreference(draft.raw.G,values.femalePreference);
  if(['','prefer','require'].includes(values.englishPreference))draft.raw.G=applyEnglishInstructorPreference(draft.raw.G,values.englishPreference);
  if(['','prefer','require'].includes(values.level2Preference))draft.raw.G=applyLevel2InstructorPreference(draft.raw.G,values.level2Preference);
  if(typeof values.ability==='string')draft.raw.O=values.ability.slice(0,200);
  if(typeof values.lessonCount==='string')draft.raw.J=values.lessonCount.slice(0,30);
  if(['single','reorder','season'].includes(values.kind))draft.kind=values.kind;
  if(typeof values.designated==='boolean')draft.designated=values.designated;
  if(typeof values.isReorder==='boolean')draft.isReorder=values.isReorder;
  if(draft.kind==='reorder')draft.isReorder=true;
  if(draft.isReorder)draft.designated=true;
  for(const key of ['preferredInstructorId','lessonPassId','seasonId']){
    if(values[key]===null||values[key]==='')draft[key]=null;
    else if(values[key]!==undefined){if(!UUID.test(values[key]))fail('연결할 강사·수강권·시즌 정보를 다시 확인해 주세요.');draft[key]=values[key];}
  }
  for(const key of ['seasonTotal','sessionNumber'])if(values[key]!==undefined){
    if(values[key]===null||values[key]==='')draft[key]=null;
    else if(Number.isSafeInteger(values[key])&&values[key]>=1&&values[key]<=100)draft[key]=values[key];
    else fail('시즌 총회차와 이번 회차를 다시 확인해 주세요.');
  }
  if(typeof values.patchEnabled==='boolean')draft.patchEnabled=values.patchEnabled;
  const patch=knownAmount(values.patchFee);draft.raw.U=values.patchEnabled===true&&patch!==null?String(patch):'';
  draft.raw.R=values.patchEnabled===true?text(values.patchPaymentStatus).slice(0,100):'';
  draft.raw.P=text(values.sessionNotes).slice(0,2000);
  if(typeof values.rentalCustomAmount==='boolean')draft.rentalCustomAmount=values.rentalCustomAmount;
  const separatePhone=canonicalTelephone(text(values.teamPhone));
  if(values.teamPhoneMode==='separate'){draft.teamPhoneMode='separate';draft.raw.L=separatePhone||'';}
  const notes=[text(values.preferredInstructor)?`지정 강사 요청: ${text(values.preferredInstructor)}`:'',text(values.pickup)?`픽업 요청: ${text(values.pickup)}`:''];
  draft.raw.G=[draft.raw.G,...notes].filter(Boolean).join('\n').slice(0,3000);
  // Bank-linked bookings always retain the verified bank transfer source.
  draft.raw.Q='계좌이체';
}


/** Use the reviewed registration choice, never a raw candidate's suggested route. */
export function paymentReviewBookingType(approvedDraft={}){
  const applied=approvedDraft.paymentComparison?.appliedProposal;
  return applied?.bookingType==='pass'&&applied.scheduleStatus==='undated'?'pass':'lesson';
}

/** An approved undated payment opens an editable pass form without guessing sessions. */
export function createPaymentPassDraft(approvedDraft={},context={}){
  if(!UUID.test(approvedDraft.paymentReviewId||'')||!Number.isSafeInteger(approvedDraft.paymentReviewVersion)||approvedDraft.paymentReviewVersion<1)fail('승인된 입금 검토를 다시 열어 주세요.');
  if(paymentReviewBookingType(approvedDraft)!=='pass')fail('날짜 미정 수강권으로 검토한 내용을 확인해 주세요.');
  if(text(approvedDraft.date)||text(approvedDraft.startTime))fail('날짜 미정 수강권은 강습일·시작 시간을 비워야 합니다. 일정이 정해졌다면 예약으로 작성해 주세요.');
  const allocation=knownAmount(approvedDraft.paymentAllocationAmount);
  if(allocation===null||allocation<=0)fail('수강권에 반영할 입금액을 확인해 주세요.');
  const sessions=approvedDraft.paymentComparison.appliedProposal.totalSessions;
  const registration=approvedDraft.paymentComparison.appliedProposal.registrationFields||{};
  if(registration.paymentRequestCorrection||approvedDraft.paymentComparison.appliedProposal.reviewedTeams?.some(team=>team.registrationFields?.paymentRequestCorrection||team.sessions?.some(row=>row.paymentRequestCorrection)))fail('요청액 정정은 날짜가 정해진 회차별 예약에서 등록해 주세요.');
  const phone=canonicalTelephone(text(registration.teamPhoneMode==='separate'?registration.teamPhone:approvedDraft.phone))||'';
  const fixedInstructorId=text(registration.preferredInstructorId);
  if(fixedInstructorId&&!UUID.test(fixedInstructorId))fail('연결할 지정 강사 정보를 다시 확인해 주세요.');
  // 예약접수 인라인 발급과 동일한 항목을 메모로 함께 넘긴다(총 횟수·시간권·강습료·장비·받아야 할/받은/미수).
  const won=value=>value.toLocaleString('ko-KR');
  const lessonFee=knownAmount(approvedDraft.lessonFee),rentalFee=knownAmount(approvedDraft.rentalFee);
  const rentalLabel={free:'무료',paid:'결제완료',onsite_unpaid:'현장 결제',unconfirmed:'미확인'}[registration.rentalPaymentStatus];
  const sessionsKnown=Number.isSafeInteger(sessions)&&sessions>=1&&sessions<=100;
  const perSession=lessonFee===null?null:lessonFee+(registration.rentalPaymentStatus==='paid'&&rentalFee!==null?rentalFee:0);
  const expectedTotal=sessionsKnown&&perSession!==null?perSession*sessions:null;
  const carryLines=[
    sessionsKnown?`총 횟수: ${sessions}회`:null,
    [120,240].includes(approvedDraft.lessonMinutes)?`회당 강습시간: ${approvedDraft.lessonMinutes/60}시간`:null,
    lessonFee!==null?`회당 강습료: ${won(lessonFee)}원`:null,
    rentalLabel?`장비: ${rentalLabel}${[4,6].includes(registration.rentalHours)?` · ${registration.rentalHours}시간`:''}${rentalFee!==null?` · ${won(rentalFee)}원`:''}`:null,
    expectedTotal!==null?`받아야 할 금액: ${won(expectedTotal)}원 (총액)`:null,
    `받은 금액: ${won(allocation)}원`,
    expectedTotal!==null&&expectedTotal-allocation>0?`미수금: ${won(expectedTotal-allocation)}원`:null,
  ].filter(Boolean);
  const draft={id:newId(),customerName:text(approvedDraft.customerName),learnerName:text(approvedDraft.teamName),phone,company:text(approvedDraft.company),sport:['스키','보드'].includes(approvedDraft.sport)?approvedDraft.sport:'',totalSessions:Number.isSafeInteger(sessions)&&sessions>=1&&sessions<=100?sessions:'',lessonMinutes:[120,240].includes(approvedDraft.lessonMinutes)?approvedDraft.lessonMinutes:'',studentCount:Number.isInteger(approvedDraft.studentCount)&&approvedDraft.studentCount>=1&&approvedDraft.studentCount<=20?approvedDraft.studentCount:'',fixedInstructorId,notes:[...carryLines,appliedProposalNotes(approvedDraft)].filter(Boolean).join('\n').slice(0,2000),paymentReviewId:approvedDraft.paymentReviewId,paymentReviewVersion:approvedDraft.paymentReviewVersion,paymentAllocationAmount:allocation,paymentCommitRequestId:newId()};
  if(approvedDraft.paymentDepositId!==undefined){if(!UUID.test(approvedDraft.paymentDepositId||''))fail('연결된 입금 내역을 다시 확인해 주세요.');draft.paymentDepositId=approvedDraft.paymentDepositId;}
  // 고객 디렉터리 연결(2026-11-20, 예약 직행과 패리티): 선택된 고객·팀은 그대로 잇고,
  // 없는 쪽은 새 id+draft 를 동봉해 서버가 생성·연결한다(수강권만 등록된 고객이
  // 고객·팀 탭에 안 보이던 비대칭 + '승인한 고객 연결이 바뀌었습니다' 차단 해소).
  {
    const hasCustomer=UUID.test(approvedDraft.customerId||''),hasTeam=UUID.test(approvedDraft.teamId||'');
    draft.customerId=hasCustomer?approvedDraft.customerId:newId();
    draft.teamId=hasTeam?approvedDraft.teamId:newId();
    if(!hasCustomer)draft.customerDraft={id:draft.customerId,name:draft.customerName,contacts:phone?[{label:'고객 연락처',phone}]:[],notes:''};
    if(!hasTeam)draft.teamDraft={id:draft.teamId,customerId:draft.customerId,name:draft.learnerName,phone:'',defaults:{}};
  }
  return draft;
}


/** A server-approved proposal stays an editable draft. Missing facts never inherit normal intake defaults. */
export function createPaymentBookingDraft(approvedDraft={},context={}){
  if(!UUID.test(approvedDraft.paymentReviewId||'')||!Number.isSafeInteger(approvedDraft.paymentReviewVersion)||approvedDraft.paymentReviewVersion<1)fail('승인된 입금 검토를 다시 열어 주세요.');
  const allocation=knownAmount(approvedDraft.paymentAllocationAmount);
  if(allocation===null)fail('이 예약에 배분할 입금액을 확인해 주세요.');
  const draft=createBookingDraft(context),raw=draft.raw;
  // These are evidence fields, not a merge of arbitrary model-provided booking properties.
  const time=parseLessonTime(text(approvedDraft.startTime));
  const minutes=[120,240].includes(approvedDraft.lessonMinutes)?approvedDraft.lessonMinutes:null;
  const count=Number.isInteger(approvedDraft.studentCount)&&approvedDraft.studentCount>=1&&approvedDraft.studentCount<=1000?approvedDraft.studentCount:null;
  const fee=knownAmount(approvedDraft.lessonFee),rental=knownAmount(approvedDraft.rentalFee);
  const breakKnown=minutes!==240||[0,60,120].includes(approvedDraft.breakMinutes);
  const pause=minutes===240&&breakKnown?approvedDraft.breakMinutes:0;
  Object.assign(raw,{A:parseKstDate(text(approvedDraft.date))||'',B:time&&time.hour<24?time.value:'',C:'',D:['스키','보드'].includes(approvedDraft.sport)?approvedDraft.sport:'',
    E:text(approvedDraft.company),F:'',G:appliedProposalNotes(approvedDraft),H:text(approvedDraft.customerName),I:text(approvedDraft.teamName),J:'',K:'',
    L:canonicalTelephone(text(approvedDraft.phone))||(kakaoContactId(approvedDraft.phone)?kakaoContactValue(kakaoContactId(approvedDraft.phone)):''),M:count===null?'':String(count),N:minutes===null?'':`${minutes/60}시간`,O:'',Q:'계좌이체',T:fee===null?'':String(fee),Y:String(allocation),X:'',Z:''});
  raw.C=minutes!==null&&breakKnown?lessonPlanEndTime(raw.B,minutes,pause)||'':'';
  Object.assign(draft,{lessonMinutes:minutes,breakMinutes:pause,participants:reviewedParticipants(approvedDraft.paymentComparison?.appliedProposal?.participants,count),
    age:null,ageBand:null,experienceCount:null,parallelLongTurn:null,snowboardNoviceTurn:null,instructorIds:[],preferredInstructorId:null,
    customerContactPhone:raw.L,teamPhoneMode:'same',rentalPaymentStatus:null,rentalHours:null,rentalAmount:rental,rentalCustomAmount:rental!==null,
    paymentReviewId:approvedDraft.paymentReviewId,paymentReviewVersion:approvedDraft.paymentReviewVersion,paymentAllocationAmount:allocation,
    paymentCommitRequestId:newId(),paymentReviewedRentalFee:rental,paymentNeedsBreakConfirmation:!breakKnown,
    location:bookingLocation({raw})});
  applyReviewedRegistration(draft,approvedDraft);
  if(approvedDraft.paymentDepositId!==undefined){if(!UUID.test(approvedDraft.paymentDepositId||''))fail('연결된 입금 내역을 다시 확인해 주세요.');draft.paymentDepositId=approvedDraft.paymentDepositId;}
  if(UUID.test(approvedDraft.customerId||'')){draft.customerId=approvedDraft.customerId;delete draft.customerDraft;}
  if(UUID.test(approvedDraft.teamId||'')&&UUID.test(approvedDraft.customerId||'')){draft.customerTeamId=approvedDraft.teamId;delete draft.teamDraft;}
  if(draft.customerDraft)Object.assign(draft.customerDraft,{name:raw.H,contacts:canonicalTelephone(draft.customerContactPhone)?[{label:'고객 연락처',phone:draft.customerContactPhone}]:[]});
  if(draft.teamDraft)Object.assign(draft.teamDraft,{customerId:draft.customerId,name:raw.I,phone:draft.teamPhoneMode==='separate'?raw.L:'',defaults:{}});
  // Discard the ordinary editor's initial date snapshot (today / 09:00 / 2 hours).
  delete draft.dateBatch;
  return ensureBookingDates(draft);
}

/** Only teams explicitly included in the human-reviewed draft become editor cards. */
export function createPaymentBookingDrafts(approvedDraft={},context={}){
  const applied=approvedDraft.paymentComparison?.appliedProposal||{},teams=applied.reviewedTeams;
  if(!Array.isArray(teams)||!teams.length)return [createPaymentBookingDraft(approvedDraft,context)];
  if(teams.length>6||teams.some(team=>!team||typeof team!=='object'||team.bookingType==='pass'||!team.draft))fail('함께 작성할 강습 팀을 다시 확인해 주세요. 수강권은 별도로 작성합니다.');
  const total=knownAmount(approvedDraft.paymentAllocationAmount);if(total===null)fail('팀별로 나눌 입금액을 확인해 주세요.');
  const sessionRegistration=['rentalPaymentStatus','rentalHours','rentalCustomAmount','patchEnabled','patchFee','patchPaymentStatus','sessionNotes'];
  const rows=teams.map(team=>{
    if(team.sessions!==undefined&&(!Array.isArray(team.sessions)||!team.sessions.length||team.sessions.length>100||team.sessions.some(row=>!row||typeof row!=='object')))fail('검토한 회차별 일정을 다시 확인해 주세요.');
    return team.sessions||[team.draft];
  });
  const correctionIds=new Set();
  for(const [teamIndex,sessions] of rows.entries())for(const row of sessions){
    const correction=teams[teamIndex].sessions?row.paymentRequestCorrection:teams[teamIndex].registrationFields?.paymentRequestCorrection;
    if(correction==null)continue;
    const error=paymentIntakeCorrectionError(correction);if(error)fail(error);
    if(correctionIds.has(correction.requestId))fail('회차별 요청액 정정 번호가 중복되었습니다. 다시 확인해 주세요.');
    correctionIds.add(correction.requestId);
  }
  const explicit=rows.flat().some(row=>knownAmount(row.allocatedAmount)!==null);
  const allocations=rows.map((sessions,teamIndex)=>sessions.map((row,index)=>knownAmount(row.allocatedAmount)??(!explicit&&!teamIndex&&!index?total:0)));
  const allocated=allocations.flat().reduce((sum,value)=>sum+value,0);
  if(!Number.isSafeInteger(allocated)||allocated>total)fail('팀별 입금 배분액 합계가 승인한 입금액보다 큽니다.');
  const requestId=newId(),groupId=newId();
  const commonRegistration=Object.fromEntries(Object.entries(applied.registrationFields||{}).filter(([key])=>['paymentSource','cashReceiptRequested','cashReceiptNumberMode','cashReceiptNumber','cashReceiptDefaulted'].includes(key)));
  const drafts=teams.map((team,index)=>{
    const common={paymentReviewId:approvedDraft.paymentReviewId,paymentReviewVersion:approvedDraft.paymentReviewVersion,company:approvedDraft.company,customerName:approvedDraft.customerName,phone:approvedDraft.phone,customerId:approvedDraft.customerId,...(approvedDraft.paymentDepositId?{paymentDepositId:approvedDraft.paymentDepositId}:{})};
    const sessions=rows[index].map((row,rowIndex)=>{
      const registrationFields={...team.registrationFields,...commonRegistration,...Object.fromEntries(sessionRegistration.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))};
      // The team mirror belongs to its first session only. Never apply one
      // corrected total or retry ID to every date in a multi-session booking.
      if(team.sessions){delete registrationFields.paymentRequestCorrection;if(row.paymentRequestCorrection!=null)registrationFields.paymentRequestCorrection=clone(row.paymentRequestCorrection);}
      const value={...common,...team.draft,...row,teamName:text(team.draft.teamName)||text(team.label)||text(approvedDraft.customerName),paymentAllocationAmount:allocations[index][rowIndex],paymentComparison:{...approvedDraft.paymentComparison,appliedProposal:{...team,fields:team.fields||[],participants:team.participants||[],registrationFields}}};
      // A nested team/session cannot change the reviewed customer or the bank link.
      Object.assign(value,common,{paymentAllocationAmount:allocations[index][rowIndex]});
      const card=createPaymentBookingDraft(value,context);card.paymentCommitRequestId=requestId;return card;
    });
    let draft=sessions[0];draft.dateBatch.rows=sessions.map(card=>bookingDateRows(card)[0]);
    draft=sortBookingDates(draft);draft.commonGroupId=groupId;draft.sameCustomerNewTeam=index>0;
    return draft;
  });
  const customerId=drafts[0].customerId;
  for(const draft of drafts.slice(1)){draft.customerId=customerId;if(draft.customerDraft)draft.customerDraft={...clone(drafts[0].customerDraft),id:customerId};if(draft.teamDraft)draft.teamDraft.customerId=customerId;}
  return drafts;
}

/** Build a single authenticated ledger commit, never a legacy reservation write. Server revalidates all facts. */
export function paymentReviewCommitInput(payloads,requestId){
  const rows=Array.isArray(payloads)?payloads:[payloads];
  const linked=row=>['paymentReviewId','paymentReviewVersion','paymentDepositId','paymentAllocationAmount','paymentCommitRequestId'].some(key=>Object.prototype.hasOwnProperty.call(row||{},key));
  if(!rows.length||rows.every(row=>!linked(row)))return null;
  const first=rows[0];
  if(!UUID.test(first?.paymentReviewId||'')||!Number.isSafeInteger(first?.paymentReviewVersion)||first.paymentReviewVersion<1)fail('입금 검토 연결을 다시 확인해 주세요.');
  const ids=new Set(),copies=[],allocations=[];
  for(const row of rows){
    if(!row||row.paymentReviewId!==first.paymentReviewId||row.paymentReviewVersion!==first.paymentReviewVersion||(row.paymentDepositId||null)!==(first.paymentDepositId||null))fail('같은 입금 검토의 예약만 함께 저장할 수 있습니다. 검토 버전도 확인해 주세요.');
    if(typeof row.id!=='string'||!row.id.trim()||ids.has(row.id))fail('예약별 저장 번호를 다시 확인해 주세요.');
    ids.add(row.id);
    const amount=parseBookingAmount(row.raw?.Y??row.raw_data?.Y,'이 예약에 배분할 입금액');
    const copy=clone(row);copy.paymentAllocationAmount=amount;
    copies.push(copy);allocations.push({reservationId:row.id,amount});
  }
  const stable=requestId||first.paymentCommitRequestId;
  if(!UUID.test(stable||'')||!requestId&&rows.some(row=>row.paymentCommitRequestId!==stable))fail('입금 예약의 저장 요청 번호를 다시 확인해 주세요.');
  const total=allocations.reduce((sum,item)=>sum+item.amount,0);
  if(!Number.isSafeInteger(total))fail('배분할 입금액 합계를 확인해 주세요.');
  return {p_review_id:first.paymentReviewId,p_expected_version:first.paymentReviewVersion,p_payloads:copies,p_allocations:allocations,p_request_id:stable};
}
