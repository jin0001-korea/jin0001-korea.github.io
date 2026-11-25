import { supabase } from './auth-client.mjs?v=16';
import { reservationInstructorOrder } from './booking-rules.mjs';
import {currentScheduleInstructorName} from './staff-directory.mjs?v=1';

const PAGE_SIZE = 500;
const TABLES = {
  members: 'slope_members', schedules: 'slope_schedules', reports: 'slope_reports',
  proofs: 'slope_proofs', responses: 'slope_responses', reviews: 'slope_reviews', settings: 'slope_settings',
};
const normalizeName = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR');
const cancelledSchedule = row => Boolean(row?.cancelled_at) || ['cancelled','canceled'].includes(row?.status);

function fail(error, context = '요청을 처리하지 못했습니다.') {
  if (!error) return;
  const messages = {
    '42501': '이 작업을 수행할 권한이 없습니다. 계정과 담당 일정을 확인해 주세요.',
    '23503': '연결할 일정 또는 계정이 없습니다. 화면을 새로고침해 주세요.',
    '23505': '같은 항목이 이미 등록되어 있습니다. 화면을 새로고침해 주세요.',
    '23514': '입력값이 운영 기준과 맞지 않습니다. 시각과 필수 응답을 확인해 주세요.',
    '23502': '필수 입력값이 누락되었습니다.',
    'PGRST116': '해당 항목을 조회할 수 없습니다. 계정 권한을 확인해 주세요.',
    'PGRST301': '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.',
    'PGRST302': '로그인이 필요합니다.',
    'PGRST205': '서버 구성이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.',
  };
  const issue = new Error(messages[error.code] || context);
  issue.code = error.code || 'REMOTE_REQUEST_FAILED';
  throw issue;
}

function scheduleKey(value) {
  const id = String(value ?? '');
  if (!id || id.length > 120 || id.trim() !== id || id === '.' || id === '..' || /[\u0000-\u001f/\\]/u.test(id)) {
    throw new Error('일정 ID는 120자 이내로 입력하고, 슬래시·역슬래시·제어 문자를 제외해 주세요.');
  }
  return id;
}

function applyKeys(query, keys) {
  for (const [key, value] of Object.entries(keys)) query = query.eq(key, value);
  return query;
}

async function readAll(table, columns = '*', configure = query => query) {
  const all = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await configure(supabase.from(table).select(columns)).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    fail(error, '운영 데이터를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.');
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return all;
  }
  throw new Error('조회할 기록이 많습니다. 관리자에게 조회 기간 설정을 요청해 주세요.');
}

/** Narrow server-authorized projection; instructors never fetch raw reservations. */
export async function fetchScheduleRentalSummaries(scheduleIds) {
  const ids=[...new Set(scheduleIds)],facts=new Map();
  for(let offset=0;offset<ids.length;offset+=PAGE_SIZE){
    const requested=ids.slice(offset,offset+PAGE_SIZE),allowed=new Set(requested);
    const {data,error}=await supabase.rpc('slope_schedule_rental_summaries',{p_schedule_ids:requested});
    fail(error,'장비 예약기록을 불러오지 못했습니다. 최신 기록을 다시 불러와 주세요.');
    if(!Array.isArray(data)||data.length>requested.length)throw new Error('장비 예약기록 응답을 확인하지 못했습니다.');
    for(const row of data){
      if(!row||!allowed.has(row.schedule_id)||facts.has(row.schedule_id)
        ||!['unknown','free','paid','onsite_unpaid'].includes(row.payment_status)
        ||![null,4,6].includes(row.booked_hours)
        ||row.payment_status==='unknown'&&row.booked_hours!==null
        ||row.use_hours!==(row.booked_hours===4?5:row.booked_hours===6?7:null)){
        throw new Error('장비 예약기록 응답을 확인하지 못했습니다.');
      }
      facts.set(row.schedule_id,{paymentStatus:row.payment_status,bookedHours:row.booked_hours,useHours:row.use_hours,available:true});
    }
  }
  return facts;
}

/** 고객 연락처 디렉토리 우선 오버레이(2026-11-20): 고객·팀 탭 번호 수정이 강사 웹에 바로 보이게.
 *  표시 전용 — slope_schedules.phone/raw.L 스냅샷은 건드리지 않는다. 카카오ID 등 비전화 문자열 허용. */
export async function fetchScheduleCustomerPhones(scheduleIds) {
  const ids=[...new Set(scheduleIds)],facts=new Map();
  for(let offset=0;offset<ids.length;offset+=PAGE_SIZE){
    const requested=ids.slice(offset,offset+PAGE_SIZE),allowed=new Set(requested);
    const {data,error}=await supabase.rpc('slope_schedule_customer_phones',{p_schedule_ids:requested});
    fail(error,'고객 연락처를 불러오지 못했습니다. 최신 기록을 다시 불러와 주세요.');
    if(!Array.isArray(data)||data.length>requested.length)throw new Error('고객 연락처 응답을 확인하지 못했습니다.');
    for(const row of data){
      if(!row||!allowed.has(row.schedule_id)||facts.has(row.schedule_id)||typeof row.phone!=='string'||row.phone.length>40)
        throw new Error('고객 연락처 응답을 확인하지 못했습니다.');
      facts.set(row.schedule_id,row.phone);
    }
  }
  return facts;
}

/** Amount correction projection only; never fetch reservation source data for instructors. */
export async function fetchSchedulePaymentCorrections(scheduleIds) {
  if(!Array.isArray(scheduleIds))throw new Error('조회할 일정 목록을 확인해 주세요.');
  const ids=[...new Set(scheduleIds.map(scheduleKey))],facts=new Map();
  for(let offset=0;offset<ids.length;offset+=200){
    const requested=ids.slice(offset,offset+200),allowed=new Set(requested);
    const {data,error}=await supabase.rpc('slope_payment_request_correction_schedule_flags',{p_schedule_ids:requested});
    fail(error,'요청금액 정정 기록을 불러오지 못했습니다. 최신 기록을 다시 불러와 주세요.');
    if(!data||!Array.isArray(data.items)||data.items.length>requested.length)throw new Error('요청금액 정정 응답을 확인하지 못했습니다.');
    for(const row of data.items){
      if(!row||!allowed.has(row.scheduleId)||facts.has(row.scheduleId)||typeof row.hasCorrection!=='boolean'||typeof row.needsAdditionalPayment!=='boolean'
        ||!Number.isSafeInteger(row.outstandingAmount)||row.outstandingAmount<0||typeof row.reason!=='string'||row.reason.length>1000
        ||row.needsAdditionalPayment&&(!row.hasCorrection||row.outstandingAmount===0))throw new Error('요청금액 정정 응답을 확인하지 못했습니다.');
      facts.set(row.scheduleId,{available:true,hasCorrection:row.hasCorrection,outstandingAmount:row.outstandingAmount,needsAdditionalPayment:row.needsAdditionalPayment,reason:row.reason});
    }
  }
  return facts;
}

/** Use separate INSERT/UPDATE payloads so immutable server columns are never updated. */
async function writeRecord(table, keys, fields) {
  const firstKey = Object.keys(keys)[0];
  const { data: existing, error: readError } = await applyKeys(supabase.from(table).select(firstKey), keys).maybeSingle();
  fail(readError);
  if (existing) {
    const { data, error } = await applyKeys(supabase.from(table).update(fields), keys).select(firstKey).maybeSingle();
    fail(error, '변경 내용을 저장하지 못했습니다.');
    if (!data) throw new Error('저장할 항목이 없거나 접근 권한이 변경되었습니다. 화면을 새로고침해 주세요.');
    return;
  }
  const { error } = await supabase.from(table).insert({ ...keys, ...fields }).select(firstKey).single();
  if (error?.code === '23505') {
    // Another authorized session may have created the same record after our lookup.
    const retry = await applyKeys(supabase.from(table).update(fields), keys).select(firstKey).maybeSingle();
    fail(retry.error, '변경 내용을 저장하지 못했습니다.');
    if (!retry.data) throw new Error('저장 권한이 변경되었습니다. 화면을 새로고침해 주세요.');
    return;
  }
  fail(error, '등록 내용을 저장하지 못했습니다.');
}

export async function fetchWorkspace(defaultSettings = {}, options = {}) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  fail(authError, '로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
  if (!auth?.user) throw new Error('로그인이 필요합니다.');
  const { data: profile, error: profileError } = await supabase.from(TABLES.members).select('*').eq('user_id', auth.user.id).maybeSingle();
  fail(profileError, '계정 정보를 확인하지 못했습니다.');
  if (!profile) throw Object.assign(new Error('발급된 운영 계정이 없습니다. 관리자에게 계정 발급을 요청해 주세요.'), {code:'ACCOUNT_UNAVAILABLE'});
  if (!profile.active) throw Object.assign(new Error('사용이 중지된 계정입니다. 관리자에게 문의해 주세요.'), {code:'ACCOUNT_UNAVAILABLE'});
  if (!['admin', 'instructor', 'counselor'].includes(profile.role)) throw Object.assign(new Error('허용되지 않은 계정 권한입니다. 관리자에게 문의해 주세요.'), {code:'ACCOUNT_UNAVAILABLE'});
  // Route counseling staff and password setup before reading instructor operations.
  if (profile.must_change_password || profile.role === 'counselor' || options.profileOnly === true || profile.role === 'admin' && options.booking === true) return {
    profile, roster: [], schedules: [], archivedSchedules: [], scores: [], metrics: [], notifications: [], alerts: [],
    reservationChangeNotifications: [], reservationChangeNotificationsUnavailable: null,
    settings: { ...defaultSettings }, settingsUpdatedAt: undefined,
    reservations: [], seasonPackages: [],lessonPasses:[], capabilities: [], timeOffRequests: [], reservationFlags: [],reorderRegistrations:null,webReordersUnavailable:null,
    bookingUnavailable: null, outbox: [], importedAt: null,
  };

  const [roster, scheduleRows, reports, proofs, responses, reviews, settingsRows, assignments, scores, alerts, notifications, metrics, reservationChanges] = await Promise.all([
    readAll(TABLES.members, '*', query => query.order('created_at').order('user_id')),
    // phone 컬럼은 2026-11-27부터 select 권한이 없다(개인정보 당일 제한) — 번호는 전용 RPC로만.
    readAll(TABLES.schedules, 'id,instructor_name,instructor_user_id,customer_name,start_at,end_at,level,location,created_at,updated_at,lesson_minutes,break_minutes,cancelled_at', query => query.order('start_at').order('id')),
    readAll(TABLES.reports, '*', query => query.order('schedule_id')),
    readAll(TABLES.proofs, '*', query => query.order('schedule_id').order('kind')),
    readAll(TABLES.responses, '*', query => query.order('schedule_id').order('warning_id')),
    readAll(TABLES.reviews, '*', query => query.order('schedule_id').order('warning_id')),
    readAll(TABLES.settings, 'singleton,data,updated_at', query => query.eq('singleton', true)),
    readAll('slope_schedule_instructors','schedule_id,instructor_user_id',query=>query.order('schedule_id').order('instructor_user_id')),
    readAll('slope_survey_scores','id,schedule_id,instructor_user_id,overall,kindness,communication,safety,lesson,submitted_at',query=>query.order('submitted_at')),
    readAll('slope_alerts','id,schedule_id,category,title,detail,severity,related_schedule_id,score,evidence_hash,generation,active,first_detected_at,last_detected_at,resolved_at,request_kind,request_id',query=>query.eq('active',true).order('id')),
    readAll('slope_alert_recipients','alert_id,user_id,read_at,notified_at',query=>query.eq('user_id',profile.user_id).order('alert_id')),
    readAll('slope_instructor_metrics','*',query=>query.order('period_start',{ascending:false}).order('id')),
    readAll('slope_reservation_change_notifications','id,change_id,reservation_id,recipient_user_id,title,message,created_at,read_at',query=>{
      const scoped=profile.role==='admin'?query:query.eq('recipient_user_id',profile.user_id);
      return scoped.order('created_at',{ascending:false}).order('id',{ascending:false});
    }).then(rows=>({rows,error:null})).catch(error=>({rows:[],error:error.message||'예약 변경 알림을 불러오지 못했습니다.'})),
  ]);
  const cancelledIds=new Set(scheduleRows.filter(cancelledSchedule).map(row=>row.id));
  const cancelledAlertIds=new Set(alerts.filter(row=>cancelledIds.has(row.schedule_id)||cancelledIds.has(row.related_schedule_id)).map(row=>row.id));
  const paymentIds=scheduleRows.filter(row=>!cancelledSchedule(row)&&(profile.role==='admin'||row.instructor_user_id===profile.user_id||assignments.some(item=>item.schedule_id===row.id&&item.instructor_user_id===profile.user_id))).map(row=>row.id);
  const [rentalResult,paymentResult,phoneResult]=await Promise.all([
    fetchScheduleRentalSummaries(scheduleRows.filter(row=>!cancelledSchedule(row)).map(row=>row.id))
      .then(facts=>({facts,error:null})).catch(error=>({facts:new Map(),error:error.message||'장비 예약기록을 불러오지 못했습니다.'})),
    fetchSchedulePaymentCorrections(paymentIds)
      .then(facts=>({facts,error:null})).catch(error=>({facts:new Map(),error:error.message||'요청금액 정정 기록을 불러오지 못했습니다.'})),
    fetchScheduleCustomerPhones(scheduleRows.filter(row=>!cancelledSchedule(row)).map(row=>row.id))
      .then(facts=>({facts,error:null})).catch(()=>({facts:new Map(),error:null})),
  ]);
  const paymentScope=new Set(paymentIds);
  const schedules = scheduleRows.map(row => ({
    id: row.id, updatedAt:row.updated_at, cancelledAt:row.cancelled_at||null, status:cancelledSchedule(row)?'cancelled':'active', instructor: currentScheduleInstructorName(row,assignments,roster), instructorUserId: row.instructor_user_id, instructorUserIds:[...new Set([row.instructor_user_id,...assignments.filter(a=>a.schedule_id===row.id).map(a=>a.instructor_user_id)].filter(Boolean))],
    customer: row.customer_name, phone: phoneResult.facts.get(row.id) ?? '', start: row.start_at, end: row.end_at,
    level: row.level || '', location: row.location || '', checkIn: null, checkOut: null,
    report: null, responses: {}, reviews: {}, sample: false,
    rental:rentalResult.error?{available:false}:rentalResult.facts.get(row.id)||{paymentStatus:'unknown',bookedHours:null,useHours:null,available:true},
    paymentCorrection:paymentScope.has(row.id)&&paymentResult.error?{available:false}:paymentResult.facts.get(row.id)||{available:true,hasCorrection:false,outstandingAmount:0,needsAdditionalPayment:false,reason:''},
  }));
  const byId = new Map(schedules.map(row => [row.id, row]));
  for (const row of reports) {
    const schedule = byId.get(row.schedule_id);
    if (schedule) schedule.report = {
      link: row.link, text: row.body, photoCount: row.photo_count, videoCount: row.video_count,
      consecutive: row.consecutive, guideline: row.guideline, feeNoticeAck: row.fee_notice_ack,
      submittedAt: row.submitted_at, updatedAt: row.updated_at,
    };
  }
  for (const row of proofs) {
    const schedule = byId.get(row.schedule_id);
    if (schedule && ['checkIn', 'checkOut'].includes(row.kind)) schedule[row.kind] = {
      eventAt: row.event_at, uploadedAt: row.uploaded_at, photoId: row.storage_path,
    };
  }
  for (const row of responses) {
    const schedule = byId.get(row.schedule_id);
    if (schedule) schedule.responses[row.warning_id] = {
      answer: row.answer, note: row.note || '', evidence: row.evidence,
      at: row.responded_at, by: row.responded_by,
    };
  }
  for (const row of reviews) {
    const schedule = byId.get(row.schedule_id);
    if (schedule) schedule.reviews[row.warning_id] = {
      result: row.result, note: row.note || '', evidence: row.evidence,
      at: row.reviewed_at, by: row.reviewed_by,
    };
  }
  return {
    profile, roster, schedules:schedules.filter(row=>!cancelledIds.has(row.id)), archivedSchedules:schedules.filter(row=>cancelledIds.has(row.id)), scores, metrics, notifications:notifications.filter(row=>!cancelledAlertIds.has(row.alert_id)),
    reservationChangeNotifications:reservationChanges.rows,reservationChangeNotificationsUnavailable:reservationChanges.error,
    alerts:alerts.filter(row=>!cancelledAlertIds.has(row.id)).map(row=>({id:row.id,scheduleId:row.schedule_id,category:row.category,requestKind:row.request_kind,requestId:row.request_id,title:row.title,detail:row.detail,severity:row.severity,relatedScheduleId:row.related_schedule_id,score:row.score,evidenceHash:row.evidence_hash,generation:row.generation,active:row.active,firstDetectedAt:row.first_detected_at,lastDetectedAt:row.last_detected_at,resolvedAt:row.resolved_at,requiresResponse:row.category!=='customer-request',source:'server'})),settingsUpdatedAt:settingsRows[0]?.updated_at, settings: { ...defaultSettings, ...(settingsRows[0]?.data || {}) },
    ...await fetchBookingWorkspace(profile).catch(error=>({reservations:[],seasonPackages:[],capabilities:[],timeOffRequests:[],reservationFlags:[],timeOffCalendar:null,timeOffCalendarError:'휴무 신청 달력을 불러오지 못했습니다.',bookingUnavailable:error.message||'예약 운영 정보를 불러오지 못했습니다.'})),
    outbox: [], importedAt: null,
  };
}

export async function saveRemoteReport(id, report) {
  if (report.feeNoticeAck !== true) throw new Error('가이드라인 미준수 시 용역비용 반영 안내를 확인해 주세요.');
  const body = String(report.text ?? '').trim();
  let link;
  try {
    link = new URL(report.link);
    if (!['http:', 'https:'].includes(link.protocol)) throw new Error();
  } catch { throw new Error('올바른 http 또는 https 카페 링크를 입력해 주세요.'); }
  if (body.length < 30 || body.length > 15000) throw new Error('보고서 내용은 30자 이상 15,000자 이하로 입력해 주세요.');
  for (const value of [report.photoCount, report.videoCount]) {
    if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error('사진·동영상 수는 0부터 999까지의 정수로 입력해 주세요.');
  }
  if (typeof report.consecutive !== 'boolean' || typeof report.guideline !== 'boolean') throw new Error('촬영 방식과 가이드라인 준수 여부에 응답해 주세요.');
  await writeRecord(TABLES.reports, { schedule_id: scheduleKey(id) }, {
    link: link.href, body, photo_count: report.photoCount, video_count: report.videoCount,
    consecutive: report.consecutive, guideline: report.guideline, fee_notice_ack: true,
  });
}

export async function saveRemoteProof(id, kind, file, eventAt) {
  const scheduleId = scheduleKey(id);
  if (!['checkIn', 'checkOut'].includes(kind)) throw new Error('사진 인증 구분이 올바르지 않습니다.');
  const mimeExtensions = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  };
  const extensionTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
  const type = file?.type || extensionTypes[String(file?.name || '').split('.').pop().toLowerCase()];
  if (!file || !mimeExtensions[type]) throw new Error('JPG, PNG, WebP 또는 HEIC 사진을 선택해 주세요.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('0바이트보다 크고 15MB 이하인 사진을 선택해 주세요.');
  const event = new Date(eventAt);
  if (!Number.isFinite(event.getTime())) throw new Error('실제 만남·헤어짐 시각을 확인해 주세요.');
  const storagePath = `${scheduleId}/${kind}/${crypto.randomUUID()}.${mimeExtensions[type]}`;
  const bucket = supabase.storage.from('slope-proofs');
  const upload = await bucket.upload(storagePath, file, { contentType: type, upsert: false, cacheControl: '0' });
  fail(upload.error, '인증 사진을 업로드하지 못했습니다. 파일 형식과 계정 권한을 확인해 주세요.');
  try {
    await writeRecord(TABLES.proofs, { schedule_id: scheduleId, kind }, { storage_path: storagePath, event_at: event.toISOString() });
  } catch (error) {
    // Only a newly uploaded, unreferenced object is eligible for server-side cleanup.
    await bucket.remove([storagePath]).catch(() => {});
    throw error;
  }
  return storagePath;
}

export async function getRemotePhoto(path) {
  if (typeof path !== 'string' || !path) throw new Error('등록된 인증 사진 경로가 없습니다.');
  const { data, error } = await supabase.storage.from('slope-proofs').download(path, {cacheNonce:crypto.randomUUID()}, {cache:'no-store'});
  fail(error, '사진을 불러오지 못했습니다. 담당 일정과 계정 권한을 확인해 주세요.');
  return data;
}

export async function saveRemoteResponse(id, warningId, response) {
  if (!['confirm', 'dispute'].includes(response.answer)) throw new Error('경고 내용의 사실 여부를 선택해 주세요.');
  const note = String(response.note ?? '').trim();
  if (response.answer === 'dispute' && !note) throw new Error('이의 제기 사유를 입력해 주세요.');
  await writeRecord(TABLES.responses, { schedule_id: scheduleKey(id), warning_id: String(warningId) }, {
    answer: response.answer, note, evidence: String(response.evidence ?? ''),
  });
}

export async function saveRemoteReview(id, warningId, review) {
  if (!['confirmed', 'dismissed', 'followup'].includes(review.result)) throw new Error('관리자 검토 결과를 선택해 주세요.');
  const note = String(review.note ?? '').trim();
  if (review.result === 'followup' && !note) throw new Error('추가 확인 요청 사유를 입력해 주세요.');
  await writeRecord(TABLES.reviews, { schedule_id: scheduleKey(id), warning_id: String(warningId) }, {
    result: review.result, note, evidence: String(review.evidence ?? ''),
  });
}

export async function saveRemoteSettings(data) {
  await writeRecord(TABLES.settings, { singleton: true }, { data });
}

/** Import keeps lesson identity stable and never silently reassigns an existing instructor. */
export async function importRemoteSchedules(rows, roster = []) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('가져올 일정이 없습니다.');
  if (rows.length > 5000) throw new Error('한 번에 5,000건까지 가져올 수 있습니다. 파일을 나누어 등록해 주세요.');
  const ids = rows.map(row => scheduleKey(row.id));
  if (new Set(ids).size !== ids.length) throw new Error('중복된 일정 ID가 있습니다.');
  const currentRows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const managed=await supabase.from('slope_reservations').select('id').in('id',ids.slice(i,i+100));
    fail(managed.error,'예약 구분을 확인하지 못했습니다.');
    if(managed.data?.length)throw new Error('웹에서 접수한 예약은 예약·강사 배정 화면에서 수정해 주세요. 원본 항목과 시즌 담당을 함께 보존합니다.');
    const { data, error } = await supabase.from(TABLES.schedules).select('id,instructor_name,instructor_user_id,customer_name,level,location').in('id', ids.slice(i, i + 100));
    fail(error, '기존 일정 정보를 확인하지 못했습니다.');
    currentRows.push(...(data || []));
  }
  const existing = new Map(currentRows.map(row => [row.id, row]));
  const approved = roster.filter(member => member.active && member.role === 'instructor');
  const names = new Map();
  for (const member of approved) {
    const key = normalizeName(member.display_name);
    names.set(key, [...(names.get(key) || []), member]);
  }
  const payload = rows.map(row => {
    const old = existing.get(row.id);
    const instructor = String(row.instructor ?? '').trim();
    const customer = String(row.customer ?? '').trim();
    if (!instructor || !customer) throw new Error('강사명과 고객명은 비워 둘 수 없습니다.');
    if (old && (normalizeName(old.instructor_name) !== normalizeName(instructor) || normalizeName(old.customer_name) !== normalizeName(customer))) {
      throw new Error(`${row.id}: 기존 강사 또는 고객과 다릅니다. 새 일정 ID를 사용해 주세요.`);
    }
    const candidates = names.get(normalizeName(instructor)) || [];
    let instructorUserId = candidates.length === 1 ? candidates[0].user_id : null;
    if (old?.instructor_user_id) {
      if (instructorUserId && instructorUserId !== old.instructor_user_id) {
        throw new Error(`${row.id}: 기존 담당 계정과 이름이 같은 다른 계정이 있습니다. 강사 배정을 직접 확인해 주세요.`);
      }
      instructorUserId = old.instructor_user_id;
    }
    const start = new Date(row.start), end = new Date(row.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error(`${row.id}: 시작·종료 시각을 확인해 주세요.`);
    const core = {
      id: row.id, instructor_name: instructor, instructor_user_id: instructorUserId,
      customer_name: customer, phone: String(row.phone ?? ''), start_at: start.toISOString(), end_at: end.toISOString(),
      level: Object.hasOwn(row, 'level') ? String(row.level ?? '') : (old?.level || ''),
      location: Object.hasOwn(row, 'location') ? String(row.location ?? '') : (old?.location || ''),
    };
    return core;
  });
  // All rows use one statement: an invalid row cannot leave a partially imported file.
  const { data, error } = await supabase.from(TABLES.schedules).upsert(payload, { onConflict: 'id', defaultToNull: false }).select('id');
  fail(error, '일정을 저장하지 못했습니다. 관리자 권한과 입력값을 확인해 주세요.');
  if (data?.length !== rows.length) throw new Error('일부 일정을 저장할 권한이 없습니다. 화면을 새로고침해 주세요.');
  return data.length;
}

export async function updateAssignment(scheduleId, userId, name) {
  const fields = { instructor_user_id: null };
  if (userId) {
    const { data: member, error } = await supabase.from(TABLES.members).select('user_id,display_name,role,active').eq('user_id', userId).maybeSingle();
    fail(error, '강사 계정을 확인하지 못했습니다.');
    if (!member?.active || member.role !== 'instructor') throw new Error('활성 상태의 강사 계정만 배정할 수 있습니다.');
    if (name && normalizeName(name) !== normalizeName(member.display_name)) throw new Error('선택한 강사 계정과 이름이 다릅니다.');
    fields.instructor_user_id = member.user_id;
    fields.instructor_name = member.display_name;
  } else if (name) fields.instructor_name = String(name).trim();
  const { data, error } = await supabase.from(TABLES.schedules).update(fields).eq('id', scheduleKey(scheduleId)).select('id').maybeSingle();
  fail(error, '담당 강사를 변경하지 못했습니다.');
  if (!data) throw new Error('변경할 일정이 없거나 관리자 권한이 없습니다.');
}

export async function accountAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('slope-accounts', { body: { ...payload, action } });
  if (error) {
    let message;
    try {
      const body = await error.context?.clone().json();
      message = typeof body?.error === 'string' && body.error.length < 300 ? body.error : null;
    } catch { /* Never log function request bodies or credentials. */ }
    throw new Error(message || '계정 작업을 처리하지 못했습니다. 로그인 상태와 관리자 권한을 확인해 주세요.');
  }
  if (data?.error || data?.ok === false) throw new Error(typeof data.error === 'string' ? data.error : '계정 작업을 처리하지 못했습니다.');
  return data;
}

export async function setMemberStatus(userId, changes = {}) {
  return accountAction('update-member', { ...changes, userId });
}

export async function assignInstructors(scheduleId,userIds){
 const managed=await supabase.from('slope_reservations').select('*').eq('id',scheduleKey(scheduleId)).maybeSingle();
 fail(managed.error,'예약 배정 정보를 확인하지 못했습니다.');
 if(managed.data)return saveRemoteReservation(reservationPayload(managed.data,{instructorIds:userIds,status:userIds.length?'confirmed':'received'}));
 const {error}=await supabase.rpc('slope_assign_instructors',{p_schedule_id:scheduleKey(scheduleId),p_instructor_ids:userIds});
 fail(error,'담당 강사를 배정하지 못했습니다. 계정 상태와 관리자 권한을 확인해 주세요.');
}
// 강사 후기 공개(slope-reviews Edge). invoke 는 GET/DELETE 쿼리를 함수명 문자열에 싣는다.
export async function reviewsAction(kind,payload={}){
 const call=async(path,options)=>{
  const {data,error}=await supabase.functions.invoke(path,options);
  if(error){let message;try{message=(await error.context?.clone().json())?.message;}catch{}throw new Error(typeof message==='string'&&/[가-힣]/u.test(message)?message:'후기 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  if(data?.error)throw new Error(data.message||data.error);return data;
 };
 if(kind==='queue')return call(`slope-reviews?queue=1&t=${Date.now()}`,{method:'GET'});
 if(kind==='list'){
  if(!['catchski','risenski'].includes(payload.brand))throw new Error('브랜드를 확인해 주세요.');
  return call(`slope-reviews?brand=${payload.brand}&t=${Date.now()}`,{method:'GET'});
 }
 if(kind==='publish')return call('slope-reviews',{method:'POST',body:payload});
 if(kind==='remove'){
  if(/^[0-9a-f-]{36}$/i.test(String(payload.id||'')))return call(`slope-reviews?id=${payload.id}`,{method:'DELETE'});
  if(/^[0-9a-f-]{36}$/i.test(String(payload.scoreId||''))&&['catchski','risenski'].includes(payload.brand))return call(`slope-reviews?scoreId=${payload.scoreId}&brand=${payload.brand}`,{method:'DELETE'});
  throw new Error('내릴 후기를 확인해 주세요.');
 }
 throw new Error('후기 요청을 확인해 주세요.');
}
export async function surveyAction(action,payload={}){
 const {data,error}=await supabase.functions.invoke('slope-surveys',{body:{...payload,action}});
 if(error){let message;try{message=(await error.context?.clone().json())?.error;}catch{}throw new Error(typeof message==='string'?message:'만족도 설문을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
 if(data?.error)throw new Error(data.error);return data;
}

/** Real background-check service; no scheduler secret ever enters the client. */
export async function automationAction(action,payload={}){
 const {data,error}=await supabase.functions.invoke('slope-checks',{body:{...payload,action}});
 if(error){let message;try{message=(await error.context?.clone().json())?.error;}catch{}throw new Error(typeof message==='string'?message:'자동 점검 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
 if(data?.error)throw new Error(data.error);return data;
}
export async function markAlertRead(alertId){
 const {error}=await supabase.rpc('slope_mark_alert_read',{p_alert_id:String(alertId)});
 fail(error,'알림 읽음 상태를 저장하지 못했습니다.');
}

export async function markReservationChangeNotificationRead(notificationId){
 const id=String(notificationId??'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('예약 변경 알림을 다시 확인해 주세요.');
 const {error}=await supabase.rpc('slope_mark_reservation_change_notification_read',{p_notification_id:id});
 fail(error,'예약 변경 알림의 읽음 상태를 저장하지 못했습니다.');
}

/** Raw reservation/settlement columns are fetched only by administrators. */
async function fetchBookingWorkspace(profile){
  const admin=profile.role==='admin';
  const [reservations,seasonPackages,capabilities,timeOffRequests,reservationFlags,calendarResult,sheetsResult,reorderResult,lessonPasses]=await Promise.all([
    admin?readAll('slope_reservations','*',q=>q.order('created_at',{ascending:false}).order('id')):[],
    admin?readAll('slope_season_packages','*',q=>q.order('created_at',{ascending:false}).order('id')):[],
    admin?readAll('slope_instructor_capabilities','*',q=>q.order('instructor_user_id')):[],
    readAll('slope_timeoff_requests','*',q=>q.order('date',{ascending:false}).order('id')),
    admin?[]:bookingRpc('slope_my_reservation_flags'),
    fetchTimeOffCalendar().then(calendar=>({calendar,error:null})).catch(()=>({calendar:null,error:'휴무 신청 달력을 불러오지 못했습니다.'})),
    admin?bookingRpc('slope_sheets_sync_status').then(status=>({status,error:''})).catch(()=>({status:null,error:'시트 기록 상태를 불러오지 못했습니다.'})):Promise.resolve({status:null,error:''}),
    admin?Promise.resolve({rows:null,error:null}):fetchOwnReorderRegistrations().then(rows=>({rows,error:null})).catch(()=>({rows:[],error:'리오더 집계를 불러오지 못했습니다.'})),
    admin?readAll('slope_lesson_passes','id,fixed_instructor_user_id',q=>q.order('id')):Promise.resolve([]),
  ]);
  return {reservations,seasonPackages,lessonPasses,capabilities,timeOffRequests,reservationFlags,reorderRegistrations:reorderResult.rows,webReordersUnavailable:reorderResult.error,timeOffCalendar:calendarResult.calendar,timeOffCalendarError:calendarResult.error,sheetsSync:sheetsResult.status,sheetsSyncError:sheetsResult.error,bookingUnavailable:null};
}

async function fetchOwnReorderRegistrations(){
  const rows=await bookingRpc('slope_my_reorder_registrations');
  const uuid=value=>value===null||typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const ids=new Set();
  if(!Array.isArray(rows))throw new Error('리오더 집계 응답을 확인하지 못했습니다.');
  for(const row of rows){
    if(!row||typeof row.id!=='string'||!row.id||row.id.length>120||ids.has(row.id)
      ||!uuid(row.lesson_pass_id)||!uuid(row.season_id)||typeof row.assigned_to_me!=='boolean'
      ||typeof row.designated_to_me!=='boolean'||typeof row.reorder_for_me!=='boolean'||(!row.assigned_to_me&&!row.designated_to_me)){
      throw new Error('리오더 집계 응답을 확인하지 못했습니다.');
    }
    ids.add(row.id);
  }
  // Copy only the explicitly permitted projection; do not retain raw customer,
  // phone, accounting, report or other-instructor fields in this metrics state.
  return rows.map(row=>({id:row.id,lesson_pass_id:row.lesson_pass_id,season_id:row.season_id,
    assigned_to_me:row.assigned_to_me,designated_to_me:row.designated_to_me,reorder_for_me:row.reorder_for_me}));
}

async function fetchTimeOffCalendar(){
  const calendar=await bookingRpc('slope_timeoff_calendar');
  const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if(!calendar||!validDay(calendar.fromDate)||!validDay(calendar.throughDate)||calendar.fromDate>calendar.throughDate
    ||!Array.isArray(calendar.allowedDates)||!calendar.allowedDates.every(date=>validDay(date)&&date>=calendar.fromDate&&date<=calendar.throughDate)){
    throw new Error('휴무 신청 달력 응답을 확인하지 못했습니다.');
  }
  return {allowedDates:[...new Set(calendar.allowedDates)],fromDate:calendar.fromDate,throughDate:calendar.throughDate};
}

async function bookingRpc(name,args={}){
  const {data,error}=await supabase.rpc(name,args);
  if(error){
    const message=error.message||'';
    const safeMessage=/[가-힣]/u.test(message)?message:
      error.code==='40001'?'다른 기기에서 예약을 변경했습니다. 최신 기록을 확인한 뒤 다시 저장해 주세요.':
      error.code==='23505'?'이미 등록된 회차 또는 휴무 신청입니다. 최신 기록을 확인해 주세요.':
      error.code==='42501'?'이 작업을 수행할 권한이 없습니다.':
      '예약·배정 조건을 확인하고 다시 시도해 주세요.';
    const issue=new Error(safeMessage);issue.code=error.code;throw issue;
  }
  return data;
}

export function saveRemoteReservation(payload){
  return bookingRpc('slope_save_reservation',{p_payload:{...payload,instructorIds:reservationInstructorOrder(payload)}});
}
export const getReservationCandidates=payload=>bookingRpc('slope_booking_candidates',{p_payload:payload});
export const requestTimeOff=({date,note=''})=>bookingRpc('slope_request_timeoff',{p_date:date,p_note:note});
export const reviewTimeOff=({id,status,note=''})=>bookingRpc('slope_review_timeoff',{p_id:id,p_status:status,p_note:note});
export const cancelTimeOff=id=>bookingRpc('slope_cancel_timeoff',{p_id:id});

export async function saveInstructorCapabilities(value){
  await writeRecord('slope_instructor_capabilities',{instructor_user_id:value.instructorUserId},{
    is_experienced:value.isExperienced===true,
    sports:value.sports||[],locations:value.locations||[],verified:value.verified===true,
  });
}

/** Assignment edits retain all source columns and the reservation revision. */
export function reservationPayload(row,patch={}){
  return {
    id:row.id,raw:{...row.raw},age:row.age,experienceCount:row.experience_count,
    parallelLongTurn:row.parallel_long_turn,kind:row.kind,isReorder:row.is_reorder,
    designated:row.designated,preferredInstructorId:row.preferred_instructor_user_id,
    seasonId:row.season_id,seasonTotal:row.season_total,sessionNumber:row.session_number,
    status:row.status,location:row.location||undefined,expectedUpdatedAt:row.updated_at,
    instructorIds:row.instructor_ids||[],...patch,
  };
}
