import {paymentReviewCommitInput} from './payment-review-booking.mjs?v=86';
import {assertPaymentCorrectionResult} from './payment-correction.mjs?v=2';
import {selectActiveCustomerNotices} from './customer-notice-filter.mjs?v=1';
import {rentalBridgeReservationId,validateRentalBridgeStatus} from './rental-bridge-view.mjs?v=31';
import { supabase, signOut, signIn } from './auth-client.mjs?v=16';
import { reservationInstructorOrder, ASSIGNMENT_REASON_LABELS } from './booking-rules.mjs?v=36';
import {customerTokenUrl} from './customer-links.mjs?v=17';
export { onSessionChange } from './auth-client.mjs?v=16';

const PAGE_SIZE = 500;
const DEFAULT_SETTINGS = Object.freeze({
  bookingExpertMode: 'either', bookingExpertAgeMax: 7,
  bookingExpertExperienceMin: 5, bookingExpertParallelMode: 'capable',
  bookingExpertSnowboardMode: 'capable',
});
const issue = (message, code = 'REQUEST_FAILED') => Object.assign(new Error(message), { code });
const fail = (error, fallback) => {
  if (!error) return;
  const codes = Object.keys(ASSIGNMENT_REASON_LABELS).filter(code => String(error.message || '').includes(code));
  const message = codes.length ? codes.map(code => ASSIGNMENT_REASON_LABELS[code]).join(' · ')
    : /[가-힣]/u.test(error.message || '') ? error.message
    : error.code === '40001' ? '다른 기기에서 기록을 변경했습니다. 최신 기록을 불러온 뒤 다시 저장해 주세요.'
    : error.code === '23505' ? '같은 예약 또는 시즌 회차가 이미 등록되어 있습니다.'
    : error.code === '42501' ? '예약 관리 권한이 있는 계정으로 로그인해 주세요.'
    : fallback || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  throw issue(message, error.code);
};

/** Membership in the database is the authority for access, not user metadata. */
async function requireBookingOperator({adminOnly=false}={}) {
  const account = await supabase.auth.getUser();
  const authError=account.error;
  if(authError&&([401,403].includes(authError.status)||['session_not_found','refresh_token_not_found','invalid_refresh_token','refresh_token_already_used','bad_jwt','invalid_jwt'].includes(authError.code)||authError.name==='AuthSessionMissingError')){
    await supabase.auth.signOut({scope:'local'}).catch(()=>{});
    throw issue('운영 로그인이 만료되었습니다. 다시 로그인해 주세요.','AUTH_REQUIRED');
  }
  fail(account.error, '로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
  if (!account.data?.user) throw issue('운영 계정으로 로그인해 주세요.', 'AUTH_REQUIRED');
  const member = await supabase.from('slope_members')
    .select('user_id,email,display_name,role,active,must_change_password,created_at')
    .eq('user_id', account.data.user.id).maybeSingle();
  fail(member.error, '운영 계정 정보를 확인하지 못했습니다.');
  const profile = member.data;
  let error;
  if (!profile || !['admin','counselor','instructor'].includes(profile.role)) error = issue('이 계정에는 예약 관리 권한이 없습니다.', 'BOOKING_ACCESS_REQUIRED');
  else if (!profile.active) error = issue('사용이 중지된 운영 계정입니다. 관리자에게 문의해 주세요.', 'ACCOUNT_DISABLED');
  else if (profile.must_change_password) error = issue('먼저 초기 비밀번호를 설정해 주세요.', 'PASSWORD_SETUP_REQUIRED');
  else if (adminOnly&&profile.role!=='admin') error = issue('운영 기준과 강사 조건은 관리자만 변경할 수 있습니다.', 'ADMIN_REQUIRED');
  else if (!['admin','counselor'].includes(profile.role)) error = issue('예약 관리는 관리자·상담사 계정으로 이용해 주세요.', 'BOOKING_ACCESS_REQUIRED');
  if (error) {
    // Preserve a valid instructor/setup session so the unified root can open its own screen.
    if(error.code==='ACCOUNT_DISABLED')await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    throw error;
  }
  return profile;
}

export async function login(credentials, suppliedPassword) {
  const email = typeof credentials === 'string' ? credentials : credentials?.email;
  const password = typeof credentials === 'string' ? suppliedPassword : credentials?.password;
  if (!String(email || '').trim() || !password) throw issue('아이디 또는 이메일과 비밀번호를 입력해 주세요.', 'INPUT_REQUIRED');
  const result = await signIn(String(email).trim(), password);
  if (result.error) {
    const code = result.error.code;
    const message = ['invalid_credentials', 'invalid_grant'].includes(code) ? '아이디 또는 이메일과 비밀번호를 확인해 주세요.'
      : code === 'email_not_confirmed' ? '인증이 완료되지 않은 계정입니다. 관리자에게 문의해 주세요.'
      : result.error.status === 429 ? '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
      : '로그인하지 못했습니다. 연결 상태와 계정 정보를 확인해 주세요.';
    throw issue(message, code || 'AUTH_FAILED');
  }
  if (!result.data?.session) throw issue('로그인 정보를 확인하지 못했습니다.', 'AUTH_REQUIRED');
  return requireBookingOperator();
}

export const logout = () => signOut();

async function readAll(table, columns, configure = query => query) {
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const response = await configure(supabase.from(table).select(columns))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    fail(response.error, '예약 운영 기록을 불러오지 못했습니다. 다시 불러와 주세요.');
    rows.push(...(response.data || []));
    if ((response.data || []).length < PAGE_SIZE) return rows;
  }
  throw issue('조회할 기록이 많습니다. 관리자에게 조회 기간 설정을 요청해 주세요.', 'ROW_LIMIT');
}

/** Fetch only reservation/availability data; no reports, photos or survey text. */
export async function fetchDesk() {
  const profile = await requireBookingOperator();
  const scopedContext=profile.role==='counselor'?await rpc('slope_booking_workspace_context',{}):null;
  if(profile.role==='counselor'&&(!scopedContext||!Array.isArray(scopedContext.roster)))throw issue('예약 운영 기준을 불러오지 못했습니다. 다시 로그인해 주세요.','BOOKING_CONTEXT_UNAVAILABLE');
  const [roster, scheduleRows, assignments, reservations, seasonPackages, capabilities, timeOffRequests, settingsRows,lessonPasses,reservationChanges,customers,customerTeams,customerPeople,noticeResult,passStatuses,changeRequests,sheetsResult] = await Promise.all([
    scopedContext?Promise.resolve(scopedContext.roster||[]):readAll('slope_members', 'user_id,display_name,email,role,active,must_change_password,created_at,freelancer,phone', q => q.order('created_at').order('user_id')),
    readAll('slope_schedules', 'id,instructor_name,instructor_user_id,customer_name,phone,start_at,end_at,lesson_minutes,break_minutes,level,location,updated_at,cancelled_at', q => q.order('start_at').order('id')),
    readAll('slope_schedule_instructors', 'schedule_id,instructor_user_id', q => q.order('schedule_id').order('instructor_user_id')),
    readAll('slope_reservations', '*', q => q.order('created_at', { ascending: false }).order('id')),
    readAll('slope_season_packages', '*', q => q.order('created_at', { ascending: false }).order('id')),
    scopedContext?Promise.resolve(scopedContext.capabilities||[]):readAll('slope_instructor_capabilities', '*', q => q.order('instructor_user_id')),
    scopedContext?Promise.resolve(scopedContext.timeOffRequests||[]):readAll('slope_timeoff_requests', '*', q => q.order('date', { ascending: false }).order('id')),
    scopedContext?Promise.resolve([{data:scopedContext.settings||{},updated_at:scopedContext.settingsUpdatedAt||null}]):readAll('slope_settings', 'singleton,data,updated_at', q => q.eq('singleton', true)),
    readAll('slope_lesson_passes','*',q=>q.order('created_at',{ascending:false}).order('id')),
    readAll('slope_reservation_changes','*',q=>q.order('changed_at',{ascending:false}).order('id')),
    readAll('slope_customers','*',q=>q.order('name').order('id')),
    readAll('slope_customer_teams','*',q=>q.order('customer_id').order('name').order('id')),
    readAll('slope_customer_people','*',q=>q.order('customer_id').order('name').order('id')).catch(()=>[]),
    rpc('slope_customer_notice_queue',{p_limit:100}),
    rpc('slope_customer_pass_statuses',{}),
    profile.role==='admin'?readCustomerRequestQueues('pending').catch(error=>({requests:[],error:error.message})):Promise.resolve({requests:[]}),
    rpc('slope_sheets_sync_status',{}).then(status=>({status,error:''})).catch(()=>({status:null,error:'시트 기록 상태를 불러오지 못했습니다.'})),
  ]);
  const bySchedule = new Map();
  for (const row of assignments) {
    const ids = bySchedule.get(row.schedule_id) || [];
    ids.push(row.instructor_user_id); bySchedule.set(row.schedule_id, ids);
  }
  const activeIds=new Set(scheduleRows.filter(row=>!row.cancelled_at).map(row=>row.id));
  const activeReservations=reservations.filter(row=>!['cancelled','canceled'].includes(row.status)&&activeIds.has(row.id));
  const activeReservationIds=new Set(activeReservations.map(row=>row.id));
  const archivedIds=new Set(reservations.filter(row=>['cancelled','canceled'].includes(row.status)).map(row=>row.id));
  const schedules = scheduleRows.filter(row=>!row.cancelled_at&&!archivedIds.has(row.id)).map(row => ({
    id: row.id, instructor: row.instructor_name, instructorUserId: row.instructor_user_id,
    instructorUserIds: [...new Set([row.instructor_user_id, ...(bySchedule.get(row.id) || [])].filter(Boolean))],
    customer: row.customer_name, phone: row.phone || '', start: row.start_at, end: row.end_at,
    lessonMinutes: row.lesson_minutes ?? null, breakMinutes: row.break_minutes ?? 0,
    level: row.level || '', location: row.location || '', updatedAt: row.updated_at,
  }));
  const plans = new Map(schedules.map(row => [row.id, {lessonMinutes: row.lessonMinutes, breakMinutes: row.breakMinutes}]));
  return {
    profile, roster, schedules, paymentReservations: reservations.map(row => ({...row, ...plans.get(row.id)})), reservations: activeReservations.map(row => ({...row, ...plans.get(row.id)})), seasonPackages, capabilities, timeOffRequests,lessonPasses,reservationChanges,customers,customerTeams,customerPeople,customerNotices:selectActiveCustomerNotices(noticeResult?.notices||[],{reservations:activeReservations,schedules}),passStatuses:Array.isArray(passStatuses)?passStatuses:[],customerChangeRequests:changeRequests.requests.filter(row=>!row.reservationId||activeReservationIds.has(row.reservationId)),customerChangeRequestsError:changeRequests.error||'',
    settings: { ...DEFAULT_SETTINGS, ...(settingsRows[0]?.data || {}) },
    settingsUpdatedAt: settingsRows[0]?.updated_at || null, bookingUnavailable: null,
    sheetsSync:sheetsResult.status,sheetsSyncError:sheetsResult.error,
  };
}

export async function friendMatchList(offset=0) {
  await requireBookingOperator();
  return rpc('slope_friend_match_list',{p_offset:offset,p_limit:25});
}
export async function friendMatchBookingContacts(id) {
  await requireBookingOperator();
  return rpc('slope_friend_match_booking_contacts',{p_booking_id:id});
}
export async function friendMatchAccept(id) {
  await requireBookingOperator();
  return rpc('slope_friend_match_accept',{p_request_id:id});
}
export async function friendMatchGuardian(phone) {
  await requireBookingOperator();
  return rpc('slope_friend_match_guardian_approve',{p_phone:phone.replace(/[^0-9]/g,''),p_consent:true});
}
export async function friendMatchDetails(kind,id) {
  await requireBookingOperator();
  if(kind==='orders')return rpc('slope_friend_match_orders',{p_request_id:id});
  if(kind==='receipts')return rpc('slope_friend_match_cash_receipts',{p_request_id:id});
  if(kind==='notices')return rpc('slope_friend_match_delivery_status',{p_request_id:id});
  throw new Error('조회할 항목을 확인해 주세요.');
}
async function rpc(name, args) {
  const response = await supabase.rpc(name, args);
  fail(response.error, '예약·배정 조건을 확인하고 다시 시도해 주세요.');
  return response.data;
}

async function readCustomerRequestQueues(status){
 const names=['slope_customer_change_queue','slope_pass_schedule_request_queue'];
 const results=await Promise.allSettled(names.map(name=>rpc(name,{p_status:status,p_limit:100})));
 const requests=[],errors=[];
 results.forEach((result,index)=>{
  if(result.status==='rejected'){errors.push(result.reason?.message||'고객 요청 목록을 불러오지 못했습니다.');return;}
  if(!Array.isArray(result.value?.requests)){errors.push('고객 요청 목록을 확인하지 못했습니다. 다시 불러와 주세요.');return;}
  requests.push(...result.value.requests.map(row=>({...row,requestKind:index===1?'pass_schedule':'reservation_change'})));
 });
 if(errors.length===2)throw issue(errors.join(' '));
 requests.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||String(a.id).localeCompare(String(b.id)));
 return {requests:requests.slice(0,100),error:[...new Set(errors)].join(' ')};
}

export async function fetchCustomerChangeRequests({status='pending'}={}){
 await requireBookingOperator({adminOnly:true});
 if(!['pending','all'].includes(status))throw issue('고객 요청 조회 조건을 확인해 주세요.','INPUT_REQUIRED');
 return readCustomerRequestQueues(status);
}

export async function reviewCustomerChange(requestId,decision,reviewNote,expectedUpdatedAt,requestKind='reservation_change'){
  await requireBookingOperator({adminOnly:true});
  const note=String(reviewNote||'').trim();
  if(!['reservation_change','pass_schedule'].includes(requestKind))throw issue('고객 요청 유형을 확인해 주세요.','INPUT_REQUIRED');
  if(typeof requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)||!['approved','rejected'].includes(decision)
    ||typeof expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(expectedUpdatedAt))||note.length>1000||decision==='rejected'&&!note)throw issue('변경 요청과 검토 사유를 확인해 주세요.','INPUT_REQUIRED');
  const result=await rpc(requestKind==='pass_schedule'?'slope_review_pass_schedule_request':'slope_review_customer_change',{p_request_id:requestId,p_decision:decision,p_review_note:note,p_expected_updated_at:expectedUpdatedAt});
  if(result?.ok!==true&&!(result?.ok===false&&result.status==='stale'))throw issue('검토 결과를 확인하지 못했습니다. 새로고침 후 처리 상태를 확인해 주세요.');
  return result;
}

export async function createCustomerLink(kind,subjectIds){
  const profile=await requireBookingOperator();
  if(kind==='survey'&&profile.role!=='admin')throw issue('설문 링크는 관리자만 관리할 수 있습니다.','ADMIN_REQUIRED');
  if(!['reservation','pass','survey'].includes(kind)||!Array.isArray(subjectIds)||!subjectIds.length||subjectIds.length>100)throw issue('고객 안내에 연결할 예약이나 수강권을 확인해 주세요.','INPUT_REQUIRED');
  const response=await supabase.functions.invoke('slope-customer-portal',{body:{action:'create-link',kind,subjectIds}});
  if(response.error){
    // 서버가 밝힌 한국어 사유를 그대로 보여 진단 가능하게 한다(2026-11-16 — 전엔 모든 실패가 같은 문구).
    let body;try{body=await response.error.context?.clone().json();}catch{}
    const message=typeof body?.message==='string'&&/[가-힣]/u.test(body.message)?body.message.slice(0,200):'고객 확인 링크를 만들지 못했습니다. 다시 시도해 주세요.';
    throw issue(message,body?.error||'REQUEST_FAILED');
  }
  if(!response.data?.url)throw issue('고객 링크를 확인하지 못했습니다.');
  if(!customerTokenUrl(response.data.url,kind))throw issue('고객 확인 링크 주소를 확인하지 못했습니다.');
  return response.data;
}

/** Read-only rental facts never update the reservation's own payment inputs. */
export async function lookupRentalStatus(sourceReservationId){
  const id=rentalBridgeReservationId(sourceReservationId);
  await requireBookingOperator();
  const response=await supabase.functions.invoke('slope-rental-bridge',{body:{action:'rental_status',source_reservation_id:id}});
  if(response.error){
    let source;
    try{source=await response.error.context?.clone().json();}catch{}
    const message=typeof source?.error==='string'&&/[가-힣]/u.test(source.error)?source.error.slice(0,240):'렌탈 현장에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.';
    if(/렌탈 매장 연결 설정/.test(message))throw issue(message,'RENTAL_BRIDGE_NOT_CONFIGURED');
    fail({...response.error,message},'렌탈 현장 정보를 불러오지 못했습니다.');
  }
  return validateRentalBridgeStatus(response.data,id);
}

function correctionPayload(payload){
  if(!payload?.paymentRequestCorrection)return payload;
  const value=payload.paymentRequestCorrection,keys=['requestId','expectedVersion','correctedRequestedAmount','reason'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key))
    ||typeof value.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)||!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0
    ||!Number.isSafeInteger(value.correctedRequestedAmount)||value.correctedRequestedAmount<0||value.correctedRequestedAmount>1000000000
    ||typeof value.reason!=='string'||!value.reason.trim()||value.reason.trim().length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.reason))throw issue('요청액 정정의 금액·사유·현재 버전을 확인해 주세요.','INPUT_REQUIRED');
  return {...payload,paymentRequestCorrection:{...value,reason:value.reason.trim()}};
}

export async function fetchPaymentRequestCorrections(reservationId){
  await requireBookingOperator();const id=lessonId(reservationId),result=await rpc('slope_payment_request_correction_history',{p_reservation_id:id});
  const amount=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000000;
  if(!result||!Array.isArray(result.corrections)||result.corrections.length>100||!result.current
    ||!['requestedAmount','paidAmount','outstandingAmount'].every(key=>amount(result.current[key]))
    ||result.corrections.some(row=>row?.reservationId!==id||!['previousRequestedAmount','correctedRequestedAmount','paidAmount','outstandingAmount'].every(key=>amount(row[key]))||typeof row.reason!=='string'||row.reason.length>300||typeof row.delivery?.status!=='string'))throw issue('서버의 정정 기록을 확인하지 못했습니다. 다시 조회해 주세요.','CORRECTION_HISTORY_INVALID');
  return result;
}

export async function saveReservation(payload) {
  await requireBookingOperator();
  if (!payload || typeof payload !== 'object') throw issue('예약 내용을 확인해 주세요.', 'INPUT_REQUIRED');
  const value={...correctionPayload(payload),instructorIds:reservationInstructorOrder(payload)};
  const paymentInput=paymentReviewCommitInput([value],value.paymentCommitRequestId);
  if(paymentInput){const result=await rpc('slope_commit_payment_review',paymentInput);const row=result?.reservations?.[0];if(!row)throw issue('예약 반영 결과를 확인하지 못했습니다. 다시 시도해 주세요.','PAYMENT_COMMIT_UNCONFIRMED');assertPaymentCorrectionResult(value,row);return {...row,id:row.id,updatedAt:row.updatedAt||row.updated_at,paymentReview:result.review,replayed:result.replayed};}
  const passId=payload.lessonPassId||payload.lesson_pass_id;
  const result=await(passId?rpc('slope_save_pass_reservation',{p_payload:value,p_pass_id:passId}):rpc('slope_save_reservation', {p_payload:value}));assertPaymentCorrectionResult(value,result);return result;
}

/** 전체 예약·배정표에서 특이사항(G)만 바로 저장. 다른 필드는 건드리지 않는다(2026-11-24). */
export async function updateReservationNotes(id,notes,expectedUpdatedAt){
  await requireBookingOperator();
  const bookingId=String(id||'');
  if(!bookingId)throw issue('예약을 확인해 주세요.','INPUT_REQUIRED');
  const result=await rpc('slope_update_reservation_notes',{p_id:bookingId,p_notes:notes==null?null:String(notes),p_expected:expectedUpdatedAt||null});
  return {id:result?.id||bookingId,updatedAt:result?.updatedAt||result?.updated_at,notes:result?.notes??''};
}
/** New grouped dates commit atomically and retry the same server batch identity. */
export async function saveReservationBatch(payloads,batchId){
  await requireBookingOperator();
  if(!Array.isArray(payloads)||!payloads.length||payloads.length>100||!batchId)throw issue('함께 저장할 강습 일정을 확인해 주세요.','INPUT_REQUIRED');
  const values=payloads.map(payload=>({...correctionPayload(payload),instructorIds:reservationInstructorOrder(payload)}));
  const paymentInput=paymentReviewCommitInput(values,batchId);
  const result=await(paymentInput?rpc('slope_commit_payment_review',paymentInput):rpc('slope_save_reservation_batch',{p_payloads:values,p_batch_id:batchId}));
  for(const payload of values)assertPaymentCorrectionResult(payload,result?.reservations?.find(row=>row.id===payload.id));return result;
}
export async function saveCustomer(payload){
  await requireBookingOperator();
  if(!payload?.id||!String(payload.name||'').trim())throw issue('고객명을 입력해 주세요.','INPUT_REQUIRED');
  return rpc('slope_save_customer',{p_payload:payload});
}
export async function deleteCustomer(payload){
  await requireBookingOperator({adminOnly:true});
  if(!payload?.id||!payload.expectedUpdatedAt||!Array.isArray(payload.expectedTeams))throw issue('삭제할 고객과 팀의 최신 정보를 확인해 주세요.','INPUT_REQUIRED');
  return rpc('slope_delete_customer',{p_payload:payload});
}
export async function saveCustomerTeam(payload){
  await requireBookingOperator();
  if(!payload?.id||!(payload.customerId||payload.customer_id))throw issue('팀의 고객을 선택해 주세요.','INPUT_REQUIRED');
  return rpc('slope_save_customer_team',{p_payload:payload});
}
export async function saveCustomerPerson(payload){
  await requireBookingOperator();
  if(!payload?.id||!(payload.customerId||payload.customer_id)||!String(payload.name||'').trim())throw issue('개인의 고객과 이름을 확인해 주세요.','INPUT_REQUIRED');
  return rpc('slope_save_customer_person',{p_payload:payload});
}
export async function deleteCustomerPerson(id){
  await requireBookingOperator();
  if(!id)throw issue('삭제할 개인을 확인해 주세요.','INPUT_REQUIRED');
  return rpc('slope_delete_customer_person',{p_id:id});
}

export async function changeReservation(payload,reason,selection={}){
  await requireBookingOperator();
  if(!payload?.id||!payload.expectedUpdatedAt||!String(reason||'').trim())throw issue('변경할 예약과 변경 사유를 확인해 주세요.','INPUT_REQUIRED');
  const notifyInstructorIds=instructorIds(selection.instructorIds||[]);
  const value={...correctionPayload(payload),instructorIds:reservationInstructorOrder(payload),notifyInstructorIds};
  const result=await rpc('slope_change_reservation',{p_payload:value,p_change_reason:String(reason).trim()});assertPaymentCorrectionResult(value,result);return result;
}

/** Archive one saved lesson. Reuse requestId after an uncertain network response. */
export async function cancelReservation({reservationId,expectedUpdatedAt,requestId,reason=''}={}){
  await requireBookingOperator();
  const id=lessonId(reservationId),memo=String(reason??'').trim();
  if(typeof expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(expectedUpdatedAt))
    ||typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)||memo.length>1000){
    throw issue('삭제할 예약과 최신 기록을 확인해 주세요.','INPUT_REQUIRED');
  }
  const result=await rpc('slope_cancel_reservation',{p_reservation_id:id,p_expected_updated_at:expectedUpdatedAt,p_request_id:requestId,p_reason:memo});
  if(result?.id!==id||result.status!=='cancelled'||result.deleted!==true||!result.cancelledAt||!result.updatedAt){
    throw issue('삭제 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.','CANCEL_RESULT_UNCONFIRMED');
  }
  return result;
}

/** 하드 삭제(완전 삭제, 관리자 전용): 선택 예약과 자식 레코드(현금영수증 요청·변경요청·취소기록 등)를 영구 삭제한다. 되돌릴 수 없다. */
export async function purgeReservations(ids){
  await requireBookingOperator({adminOnly:true});
  if(!Array.isArray(ids)||!ids.length||ids.length>500)throw issue('삭제할 예약을 다시 확인해 주세요.','INPUT_REQUIRED');
  const clean=ids.map(id=>lessonId(id));
  const result=await rpc('slope_purge_reservations',{p_ids:clean});
  return {deletedIds:Array.isArray(result?.deletedIds)?result.deletedIds:[],deleted:Number(result?.deleted)||0};
}

/** 그룹선택 강사 일괄배정(관리자 전용): 선택 강사를 선택 예약들에 건별 배정. 겹침·자격·고정강사 안 맞는 건은 건너뛰고 사유 반환. */
export async function bulkAssignInstructor(ids,instructorId){
  await requireBookingOperator({adminOnly:true});
  if(!Array.isArray(ids)||!ids.length||ids.length>200)throw issue('배정할 예약을 다시 확인해 주세요.','INPUT_REQUIRED');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(instructorId||'')))throw issue('배정할 강사를 선택해 주세요.','INPUT_REQUIRED');
  const clean=ids.map(id=>lessonId(id));
  const result=await rpc('slope_bulk_assign_instructor',{p_ids:clean,p_instructor_id:instructorId});
  return {ok:Number(result?.ok)||0,failed:Array.isArray(result?.failed)?result.failed:[],failedIds:Array.isArray(result?.failedIds)?result.failedIds:[]};
}

/** Actual issuance identifiers and the ledger are visible to the owner role only. */
export async function listCashReceipts({status='pending',limit=200,offset=0}={}){
  await requireBookingOperator({adminOnly:true});
  if(!['pending','issued','all'].includes(status)||!Number.isSafeInteger(limit)||limit<1||limit>200
    ||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw issue('현금영수증 조회 조건을 확인해 주세요.','INPUT_REQUIRED');
  return rpc('slope_cash_receipt_list',{p_status:status,p_limit:limit,p_offset:offset});
}

/** Keep requestId stable while retrying an uncertain response; the server deduplicates it. */
export async function issueCashReceipt({reservationId,requestId,expectedVersion,expectedOutstandingAmount,amount=null,note=''}={}){
  await requireBookingOperator({adminOnly:true});
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const id=lessonId(reservationId),memo=String(note??'').trim();
  if(!uuid(requestId)||!uuid(expectedVersion)||!Number.isSafeInteger(expectedOutstandingAmount)||expectedOutstandingAmount<0
    ||amount!==null&&(!Number.isSafeInteger(amount)||amount<1||amount>expectedOutstandingAmount)||memo.length>1000){
    throw issue('발급할 강습과 최신 금액을 확인해 주세요.','INPUT_REQUIRED');
  }
  return rpc('slope_issue_cash_receipt',{p_reservation_id:id,p_request_id:requestId,p_expected_version:expectedVersion,
    p_expected_outstanding_amount:expectedOutstandingAmount,p_amount:amount,p_note:memo});
}

export async function getCandidates(payload) {
  await requireBookingOperator();
  const passId=payload?.lessonPassId||payload?.lesson_pass_id;
  return passId?rpc('slope_pass_booking_candidates',{p_payload:payload,p_pass_id:passId}):rpc('slope_booking_candidates', { p_payload: payload });
}

/** A pass is issued independently: dates and schedules are chosen later. */
export async function createLessonPass(payload){
  await requireBookingOperator();
  if(!payload||!String(payload.customerName||'').trim()||!String(payload.learnerName||'').trim())throw issue('고객과 강습생 정보를 입력해 주세요.','INPUT_REQUIRED');
  if(!['스키','보드'].includes(payload.sport)||!Number.isInteger(payload.totalSessions)||payload.totalSessions<1||payload.totalSessions>100)throw issue('수강권 종목과 총 횟수를 확인해 주세요.','INPUT_REQUIRED');
  const linked=['paymentReviewId','paymentReviewVersion','paymentAllocationAmount','paymentDepositId','paymentCommitRequestId'].some(key=>Object.hasOwn(payload,key));
  if(linked){
    const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if(!uuid(payload.paymentReviewId)||!uuid(payload.id)||!uuid(payload.paymentCommitRequestId)||!Number.isSafeInteger(payload.paymentReviewVersion)||payload.paymentReviewVersion<1||!Number.isSafeInteger(payload.paymentAllocationAmount)||payload.paymentAllocationAmount<=0)throw issue('승인된 입금 검토와 수강권 반영 금액을 다시 확인해 주세요.','INPUT_REQUIRED');
    const result=await rpc('slope_commit_payment_pass',{p_review_id:payload.paymentReviewId,p_expected_version:payload.paymentReviewVersion,p_payload:{...payload,customerName:String(payload.customerName).trim(),learnerName:String(payload.learnerName).trim()},p_amount:payload.paymentAllocationAmount,p_request_id:payload.paymentCommitRequestId});
    if(!result?.pass?.id||result.pass.id!==payload.id)throw issue('수강권 발급 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.','PAYMENT_COMMIT_UNCONFIRMED');
    return result;
  }
  return rpc('slope_create_lesson_pass',{p_payload:{...payload,customerName:String(payload.customerName).trim(),learnerName:String(payload.learnerName).trim()}});
}
/** 연결 기록이 없는 수강권만 서버가 지운다. 서버 응답으로만 삭제 완료를 믿는다. */
export async function deleteLessonPass(payload){
  await requireBookingOperator();
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if(!payload||!uuid(payload.id)||!uuid(payload.requestId))throw issue('삭제할 수강권을 다시 선택해 주세요.','INPUT_REQUIRED');
  if(typeof payload.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(payload.expectedUpdatedAt)))throw issue('수강권의 최신 정보를 다시 불러와 주세요.','INPUT_REQUIRED');
  const reason=String(payload.reason||'').trim();
  if(reason.length>1000)throw issue('삭제 사유는 1000자 이내로 입력해 주세요.','INPUT_REQUIRED');
  const result=await rpc('slope_delete_lesson_pass',{p_payload:{id:payload.id,expectedUpdatedAt:payload.expectedUpdatedAt,requestId:payload.requestId,reason}});
  if(result?.id!==payload.id||result.deleted!==true)throw issue('수강권 삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.','PASS_DELETE_UNCONFIRMED');
  return result;
}
/** 예약·수강권이 연결되지 않은 팀만 삭제한다(관리자 전용). 서버가 연결 건수를 재검증한다. */
export async function deleteCustomerTeam(payload){
  await requireBookingOperator();
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if(!payload||!uuid(payload.id))throw issue('삭제할 팀을 다시 선택해 주세요.','INPUT_REQUIRED');
  const result=await rpc('slope_delete_customer_team',{p_payload:{id:payload.id}});
  if(result?.id!==payload.id||result.deleted!==true)throw issue('팀 삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.','TEAM_DELETE_UNCONFIRMED');
  return result;
}
/** 발급된 수강권의 시간권(2시간/4시간)·종목(스키/보드)만 수정한다 — 고객·횟수는 서버 트리거가 불변 보장(관리자 전용). */
export async function updateLessonPass(payload){
  await requireBookingOperator();
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if(!payload||!uuid(payload.id))throw issue('수정할 수강권을 다시 선택해 주세요.','INPUT_REQUIRED');
  if(typeof payload.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(payload.expectedUpdatedAt)))throw issue('수강권의 최신 정보를 다시 불러와 주세요.','INPUT_REQUIRED');
  const hasMinutes=payload.lessonMinutes!==undefined&&payload.lessonMinutes!==null&&payload.lessonMinutes!=='';
  const hasSport=payload.sport!==undefined&&payload.sport!==null&&payload.sport!=='';
  const hasNotes=typeof payload.notes==='string';
  const hasCompany=typeof payload.company==='string'&&payload.company.trim()!=='';
  const hasCount=payload.studentCount!==undefined&&payload.studentCount!==null&&payload.studentCount!=='';
  const hasInstructor=typeof payload.fixedInstructorId==='string'&&uuid(payload.fixedInstructorId);
  const hasBooking=payload.booking&&typeof payload.booking==='object'&&!Array.isArray(payload.booking);
  if(!hasMinutes&&!hasSport&&!hasNotes&&!hasCompany&&!hasCount&&!hasInstructor&&!hasBooking)throw issue('변경할 항목을 선택해 주세요.','INPUT_REQUIRED');
  if(hasMinutes&&![120,240].includes(payload.lessonMinutes))throw issue('시간권은 2시간 또는 4시간만 선택할 수 있습니다.','INPUT_REQUIRED');
  if(hasSport&&!['스키','보드'].includes(payload.sport))throw issue('종목은 스키 또는 보드만 선택할 수 있습니다.','INPUT_REQUIRED');
  if(hasNotes&&payload.notes.length>2000)throw issue('메모는 2000자 이내여야 합니다.','INPUT_REQUIRED');
  if(hasCompany&&payload.company.trim().length>120)throw issue('강습센터 이름을 확인해 주세요.','INPUT_REQUIRED');
  if(hasCount&&(!Number.isInteger(payload.studentCount)||payload.studentCount<1||payload.studentCount>20))throw issue('강습 인원은 1명부터 20명까지입니다.','INPUT_REQUIRED');
  const result=await rpc('slope_update_lesson_pass',{p_payload:{id:payload.id,expectedUpdatedAt:payload.expectedUpdatedAt,...(hasMinutes?{lessonMinutes:payload.lessonMinutes}:{}),...(hasSport?{sport:payload.sport}:{}),...(hasNotes?{notes:payload.notes}:{}),...(hasCompany?{company:payload.company.trim()}:{}),...(hasCount?{studentCount:payload.studentCount}:{}),...(hasInstructor?{fixedInstructorId:payload.fixedInstructorId}:{}),...(hasBooking?{booking:payload.booking}:{})}});
  if(result?.id!==payload.id)throw issue('수강권 수정 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.','PASS_UPDATE_UNCONFIRMED');
  return result;
}

const lessonId=value=>{
  if(typeof value!=='string'||!value||value.length>120||value.trim()!==value||['.','..'].includes(value)||/[\u0000-\u001f/\\]/u.test(value))throw issue('연결할 강습 일정을 확인해 주세요.','INPUT_REQUIRED');
  return value;
};
function instructorIds(value,{maximum=50,exactlyOne=false}={}){
  if(!Array.isArray(value)||value.length>maximum||(exactlyOne&&value.length!==1))throw issue('담당 강사 선택을 확인해 주세요.','INPUT_REQUIRED');
  const ids=value.map(id=>{
    if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim()))throw issue('담당 강사 계정을 확인해 주세요.','INPUT_REQUIRED');
    return id.trim().toLowerCase();
  });
  return [...new Set(ids)];
}

/** Existing imported lessons remain editable here after the sites were split. */
export async function assignExistingLesson(scheduleId,selectedIds){
  await requireBookingOperator({adminOnly:true});
  const id=lessonId(scheduleId),ids=instructorIds(selectedIds);
  const managed=await supabase.from('slope_reservations').select('id').eq('id',id).maybeSingle();
  fail(managed.error,'예약 구분을 확인하지 못했습니다. 최신 기록을 다시 불러와 주세요.');
  if(managed.data)throw issue('이 예약은 예약표의 접수·배정 창에서 수정해 주세요.','MANAGED_RESERVATION');
  return rpc('slope_assign_instructors',{p_schedule_id:id,p_instructor_ids:ids});
}

/** A batch contains identities/revisions only; the server preserves the raw row. */
export async function applyAssignments(items){
  await requireBookingOperator();
  if(!Array.isArray(items)||!items.length||items.length>100)throw issue('자동배정할 예약을 1~100건으로 확인해 주세요.','INPUT_REQUIRED');
  const seen=new Set();
  const assignments=items.map(item=>{
    const id=lessonId(item?.id);
    if(seen.has(id))throw issue('같은 예약이 자동배정안에 두 번 포함되어 있습니다.','INPUT_REQUIRED');
    seen.add(id);
    const revision=item?.expectedUpdatedAt;
    if(typeof revision!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(revision)||!Number.isFinite(Date.parse(revision)))throw issue('최신 예약을 불러온 뒤 자동배정안을 다시 만들어 주세요.','INPUT_REQUIRED');
    return {id,expectedUpdatedAt:revision,instructorIds:instructorIds(item?.instructorIds,{maximum:1,exactlyOne:true})};
  });
  return rpc('slope_apply_booking_assignments',{p_assignments:assignments});
}

/** Write mutable columns only, so immutable identity grants stay effective. */
async function writeRecord(table, keys, fields) {
  const firstKey = Object.keys(keys)[0];
  const withKeys = query => Object.entries(keys).reduce((value, [key, expected]) => value.eq(key, expected), query);
  const existing = await withKeys(supabase.from(table).select(firstKey)).maybeSingle();
  fail(existing.error, '수정할 기록을 확인하지 못했습니다.');
  if (existing.data) {
    const changed = await withKeys(supabase.from(table).update(fields)).select(firstKey).maybeSingle();
    fail(changed.error, '변경 내용을 저장하지 못했습니다.');
    if (!changed.data) throw issue('변경 권한이 바뀌었습니다. 최신 기록을 다시 확인해 주세요.', '40001');
    return changed.data;
  }
  const created = await supabase.from(table).insert({ ...keys, ...fields }).select(firstKey).single();
  if (created.error?.code === '23505') {
    const changed = await withKeys(supabase.from(table).update(fields)).select(firstKey).maybeSingle();
    fail(changed.error, '변경 내용을 저장하지 못했습니다.');
    if (!changed.data) throw issue('최신 기록을 다시 확인해 주세요.', '40001');
    return changed.data;
  }
  fail(created.error, '새 기록을 저장하지 못했습니다.');
  return created.data;
}

export async function saveCapabilities(value) {
  await requireBookingOperator({adminOnly:true});
  if (!value?.instructorUserId) throw issue('강사를 선택해 주세요.', 'INPUT_REQUIRED');
  const sports = [...new Set(Array.isArray(value.sports) ? value.sports : [])];
  const locations = [...new Set((Array.isArray(value.locations) ? value.locations : []).map(item => String(item).trim()).filter(Boolean))];
  if (sports.some(sport => !['스키', '보드'].includes(sport))) throw issue('가능 종목을 확인해 주세요.', 'INPUT_REQUIRED');
  if (value.verified && (!sports.length || !locations.length)) throw issue('가능 종목과 지점을 확인한 뒤 확인 완료로 저장해 주세요.', 'INPUT_REQUIRED');
  // 강사 속성(2026-11-25): 성별·레벨·영어가능 — 예약 선호(여자/레벨2/영어) 매칭용.
  const gender = ['여','남'].includes(value.gender) ? value.gender : null;
  const instructor_level = [1,2,3].includes(Number(value.instructorLevel)) ? Number(value.instructorLevel) : null;
  return writeRecord('slope_instructor_capabilities', { instructor_user_id: value.instructorUserId }, {
    is_experienced: value.isExperienced === true, verified: value.verified === true, sports, locations,
    gender, instructor_level, english_capable: value.englishCapable === true,
  });
}

export async function savePolicy(settings = {}) {
  await requireBookingOperator({adminOnly:true});
  const patch = {};
  const mode = settings.bookingExpertMode ?? settings.expertMode;
  const parallel = settings.bookingExpertParallelMode ?? settings.expertParallelMode;
  const snowboard = settings.bookingExpertSnowboardMode ?? settings.expertSnowboardMode;
  const age = settings.bookingExpertAgeMax ?? settings.expertAgeMax;
  const experience = settings.bookingExpertExperienceMin ?? settings.expertExperienceMin;
  if (mode !== undefined) {
    if (!['either', 'both', 'age', 'skill'].includes(mode)) throw issue('경력강사 조건 적용 방식을 확인해 주세요.', 'INPUT_REQUIRED');
    patch.bookingExpertMode = mode;
  }
  if (parallel !== undefined) {
    if (!['capable', 'not_capable', 'either'].includes(parallel)) throw issue('패러렐 롱턴 기준을 확인해 주세요.', 'INPUT_REQUIRED');
    patch.bookingExpertParallelMode = parallel;
  }
  if(snowboard!==undefined){
    if(!['capable','not_capable','either'].includes(snowboard))throw issue('S자 너비스턴 기준을 확인해 주세요.','INPUT_REQUIRED');
    patch.bookingExpertSnowboardMode=snowboard;
  }
  if (age !== undefined) {
    if (!Number.isInteger(Number(age)) || Number(age) < 0 || Number(age) > 120) throw issue('나이 기준을 확인해 주세요.', 'INPUT_REQUIRED');
    patch.bookingExpertAgeMax = Number(age);
  }
  if (experience !== undefined) {
    if (!Number.isInteger(Number(experience)) || Number(experience) < 0 || Number(experience) > 1000) throw issue('경험 횟수 기준을 확인해 주세요.', 'INPUT_REQUIRED');
    patch.bookingExpertExperienceMin = Number(experience);
  }
  if (!Object.keys(patch).length) throw issue('변경할 배정 기준을 확인해 주세요.', 'INPUT_REQUIRED');
  const existing = await supabase.from('slope_settings').select('data,updated_at').eq('singleton', true).maybeSingle();
  fail(existing.error, '기존 운영 기준을 확인하지 못했습니다.');
  const data = { ...(existing.data?.data || {}), ...patch };
  if (!existing.data) {
    const created = await supabase.from('slope_settings').insert({ singleton: true, data }).select('singleton').single();
    if (created.error?.code === '23505') throw issue('다른 기기에서 운영 기준을 변경했습니다. 다시 불러와 주세요.', '40001');
    fail(created.error, '배정 기준을 저장하지 못했습니다.');
    return data;
  }
  const changed = await supabase.from('slope_settings').update({ data }).eq('singleton', true)
    .eq('updated_at', existing.data.updated_at).select('singleton').maybeSingle();
  fail(changed.error, '배정 기준을 저장하지 못했습니다.');
  if (!changed.data) throw issue('다른 기기에서 운영 기준을 변경했습니다. 다시 불러와 주세요.', '40001');
  return data;
}

/** Staff credentials remain in Supabase auth; device ingestion keys never enter app state. */
export async function callInboxAction(action,payload={}){
  const allowed=['inbox-list','callback-list','call-detail','call-save','source-update','source-key','source-revoke','sms-thread-list','sms-thread-detail','sync-status-list','sms-history-import','sms-media-prepare','sms-media-complete','sms-media-attachment','call-history-import'];
  if(!allowed.includes(action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw issue('상담 요청을 확인해 주세요.','INPUT_REQUIRED');
  await requireBookingOperator({adminOnly:action.startsWith('source-')||['sms-history-import','sms-media-prepare','sms-media-complete','call-history-import'].includes(action)});
  const response=await supabase.functions.invoke('slope-call-inbox',{body:{...payload,action}});
  if(response.error){
    let body;try{body=await response.error.context?.clone().json();}catch{}
    const message=typeof body?.message==='string'&&/[가-힣]/u.test(body.message)?body.message.slice(0,240):'상담 기록 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    const code=body?.error==='UNAUTHORIZED'?'AUTH_REQUIRED':body?.error==='FORBIDDEN'?'BOOKING_ACCESS_REQUIRED':typeof body?.error==='string'?body.error:'REQUEST_FAILED';
    throw issue(message,code);
  }
  if(!response.data||typeof response.data!=='object'||response.data.error)throw issue('상담 처리 결과를 확인하지 못했습니다. 새로고침 후 다시 확인해 주세요.');
  return response.data;
}

/** Bank screenshots and AI drafts are isolated from live reservation writes. */
// 강사 후기(slope-reviews Edge) — 공개 GET 도 데스크에서는 세션으로 호출하고,
// 대기열·등록·공개·삭제는 서버가 JWT 로 운영진을 재검증한다. invoke 는 GET/DELETE 의
// 쿼리를 함수명 문자열에 실어야 한다(invoke 자체에 query 옵션이 없음).
export async function reviewsAction(kind,payload={}){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw issue('후기 요청을 확인해 주세요.','INPUT_REQUIRED');
  await requireBookingOperator();
  const call=async(path,options)=>{
    const response=await supabase.functions.invoke(path,options);
    if(response.error){
      let body;try{body=await response.error.context?.clone().json();}catch{}
      const message=typeof body?.message==='string'&&/[가-힣]/u.test(body.message)?body.message.slice(0,300):'후기 서버에 연결하지 못했습니다. 다시 시도해 주세요.';
      const code=body?.error==='UNAUTHORIZED'?'AUTH_REQUIRED':body?.error==='FORBIDDEN'?'BOOKING_ACCESS_REQUIRED':body?.error||'REQUEST_FAILED';
      throw issue(message,code);
    }
    if(response.data?.error)throw issue(response.data.message||'후기를 처리하지 못했습니다.',response.data.error);
    return response.data;
  };
  if(kind==='list'){
    if(!['catchski','risenski'].includes(payload.brand))throw issue('브랜드를 확인해 주세요.','INPUT_REQUIRED');
    return call(`slope-reviews?brand=${payload.brand}&t=${Date.now()}`,{method:'GET'});
  }
  if(kind==='queue')return call(`slope-reviews?queue=1&t=${Date.now()}`,{method:'GET'});
  if(kind==='create'||kind==='publish')return call('slope-reviews',{method:'POST',body:payload});
  if(kind==='remove'){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(payload.id||'')))throw issue('삭제할 후기를 확인해 주세요.','INPUT_REQUIRED');
    return call(`slope-reviews?id=${payload.id}`,{method:'DELETE'});
  }
  throw issue('후기 요청을 확인해 주세요.','INPUT_REQUIRED');
}
export async function paymentReviewAction(action,payload={}){
  const allowed=['upload-prepare','upload-complete','upload-list','upload-detail','upload-analyze','upload-analyze-extract','upload-analyze-match','upload-analyze-poll','upload-delete','upload-done','upload-reanalyze','review-reanalyze','review-save','review-approve','link-code','connect-code','link-status','link-revoke','find-candidates','conversation-detail','review-status','external-threads','external-thread-detail'];
  if(!allowed.includes(action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw issue('입금 검토 요청을 확인해 주세요.','INPUT_REQUIRED');
  await requireBookingOperator();
  const response=await supabase.functions.invoke('slope-payment-review',{body:{...payload,action}});
  if(response.error){
    let body;try{body=await response.error.context?.clone().json();}catch{}
    const message=typeof body?.message==='string'&&/[가-힣]/u.test(body.message)?body.message.slice(0,300):'입금 검토 서버에 연결하지 못했습니다. 다시 시도해 주세요.';
    const code=body?.error==='UNAUTHORIZED'?'AUTH_REQUIRED':body?.error==='FORBIDDEN'?'BOOKING_ACCESS_REQUIRED':body?.error||'REQUEST_FAILED';
    throw issue(message,code);
  }
  if(response.data?.error)throw issue(response.data.message||'입금 검토를 처리하지 못했습니다.',response.data.error);
  return response.data;
}
