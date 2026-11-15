import {participantAgeDetails,participantValidationError} from './booking-participants.mjs?v=32';
import {knownCompanyLocation} from './company-options.mjs?v=31';
/** Reservation and assignment rules shared by the workbench and its preview.
 * The server independently validates every saved assignment. This module never
 * grants permission or treats a candidate suggestion as a confirmed booking.
 */
const DAY = 86_400_000;
const OFFSET = 9 * 60 * 60 * 1000;
const COLUMN_LABELS = [
  '날짜', '시작시간', '종료시간', '스키', '강습업체', '강사님', '특이사항',
  '입금자', '강습생', '횟수', '관계', '연락처', '강습인원수', '강습시간', '수준',
  '견적영수증요청', '결제 소스', '패치결제', '장비결제', '강습요금',
  '패치요금', '장비렌탈', '리프트기타', '요청금액', '입금금액',
  '추가입금필요액', '원본 환산값', '강사정산액', '정산일', '원본 AD', '원본 AE', '원본 AF',
];
const columnKey = index => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;

/** Keys keep the source sheet's exact positions, including unlabelled columns. */
export const RAW_COLUMNS = Object.freeze(COLUMN_LABELS.map((label, index) => Object.freeze({
  key: columnKey(index), label,
  ...(index === 26 ? { sourceLabel: '', note: '원본 AA열의 환산값입니다. 강습 건수나 인원과 별도입니다.' } : {}),
})));

const rawOf = booking => booking?.raw || booking?.raw_data || booking || {};
const own = (object, name) => Object.prototype.hasOwnProperty.call(object || {}, name);
const pick = (object, ...names) => {
  for (const name of names) if (own(object, name)) return object[name];
  return undefined;
};
const normalized = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
const booleanOrNull = value => value === true || value === false ? value : null;
const integerOrNull = (value, maximum = 1000) => {
  if (value === null || value === undefined || normalized(value) === '') return null;
  const result = Number(value);
  return Number.isInteger(result) && result >= 0 && result <= maximum ? result : null;
};

/** ISO or dotted Korean sheet dates. No locale-dependent Date string parsing. */
export function parseKstDate(value) {
  const text = normalized(value);
  const match = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Endpoints may use business-day hours up to 35:00; starts are checked separately. */
export function parseLessonTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(normalized(value));
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 35 || minute > 59 || (hour === 35 && minute !== 0)) return null;
  return { hour, minute, dayOffset: Math.floor(hour / 24), value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

/** Readable clock for a persisted business-day endpoint; keep the raw cell intact. */
export function lessonTimeLabel(value) {
  const parsed = parseLessonTime(value);
  if (!parsed || parsed.hour < 24 || (parsed.hour === 24 && parsed.minute === 0)) return String(value ?? '');
  return `익일 ${String(parsed.hour % 24).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}

const dateAt = (date, offset = 0) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
const isoAt = (date, time) => `${dateAt(date, time.dayOffset)}T${String(time.hour % 24).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}:00+09:00`;
const kstDay = value => {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? new Date(instant + OFFSET).toISOString().slice(0, 10) : null;
};
const intervalError = error => ({ start: null, end: null, date: null, startDate: null, endDate: null, busySegments: [], lessonSegments: [], breakSegment: null, error });

/** Explicit lesson products never infer breaks from old spreadsheet labels. */
export function lessonPlanSettings(booking = {}) {
  const value = pick(booking, 'lessonMinutes', 'lesson_minutes');
  const pause = pick(booking, 'breakMinutes', 'break_minutes');
  const explicit = value !== undefined && value !== null && value !== '';
  const lessonMinutes = explicit ? Number(value) : null;
  const breakMinutes = pause === undefined || pause === null || pause === '' ? 0 : Number(pause);
  const valid = (explicit ? [120, 240].includes(lessonMinutes) : lessonMinutes === null)
    && [0, 60, 120].includes(breakMinutes) && (lessonMinutes === 240 || breakMinutes === 0);
  return { lessonMinutes, breakMinutes, explicit, error: valid ? null : '강습은 2시간 또는 4시간으로 선택하고, 휴식은 4시간 강습에서 선택해 주세요.' };
}

/** Preserve the booking date by representing next-day ends as 25:00, 26:00, etc. */
export function lessonPlanEndTime(startTime, lessonMinutes, breakMinutes = 0) {
  const plan = lessonPlanSettings({ lessonMinutes, breakMinutes }), start = parseLessonTime(startTime);
  if (plan.error || !plan.explicit || !start || start.hour >= 24) return null;
  const end = start.hour * 60 + start.minute + plan.lessonMinutes + plan.breakMinutes;
  return end <= 2100 ? `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` : null;
}

/** Editor action: choosing a product updates the sheet's duration and outer end. */
export function applyLessonPlan(booking = {}, patch = {}) {
  const next = { ...booking, ...patch, raw: { ...rawOf(booking) } };
  if (own(patch, 'startTime')) { next.raw.B = patch.startTime; delete next.startTime; }
  const plan = lessonPlanSettings(next);
  next.lessonMinutes = plan.lessonMinutes; next.breakMinutes = plan.breakMinutes;
  if (plan.explicit) {
    next.raw.N = `${plan.lessonMinutes / 60}시간`;
    next.raw.C = lessonPlanEndTime(next.raw.B, plan.lessonMinutes, plan.breakMinutes) || '';
  }
  return next;
}

function withLessonPlan(interval, booking) {
  const plan = lessonPlanSettings(booking), raw = rawOf(booking);
  if (plan.error) return intervalError(plan.error);
  const start = Date.parse(interval.start), end = Date.parse(interval.end);
  if (plan.explicit && end - start !== (plan.lessonMinutes + plan.breakMinutes) * 60000) return intervalError('종료 시각이 선택한 강습 시간·휴식 시간과 맞지 않습니다.');
  if (plan.explicit && own(raw, 'N') && normalized(raw.N) !== `${plan.lessonMinutes / 60}시간`) return intervalError('강습시간 항목과 선택한 2시간·4시간 설정이 다릅니다.');
  const outer = { start: interval.start, end: interval.end };
  const firstEnd = new Date(start + 120 * 60000).toISOString();
  const secondStart = new Date(start + (120 + plan.breakMinutes) * 60000).toISOString();
  const lessonSegments = plan.breakMinutes ? [{ start: interval.start, end: firstEnd }, { start: secondStart, end: interval.end }] : [outer];
  return { ...interval, ...plan, lessonSegments,
    busySegments: plan.breakMinutes === 120 ? lessonSegments : [outer],
    breakSegment: plan.breakMinutes ? { start: firstEnd, end: secondStart } : null };
}

/** Half-open busy intervals allow a two-hour lesson exactly inside a two-hour break. */
export function lessonIntervalsOverlap(first, second) {
  if (!first || !second || first.error || second.error) return false;
  const segments = value => Array.isArray(value.busySegments) ? value.busySegments : [{ start: value.start, end: value.end }];
  return segments(first).some(a => segments(second).some(b => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)));
}

/** B/C retain the outer span; only explicitly configured plans release a break. */
export function parseLessonInterval(booking) {
  const raw = rawOf(booking);
  const hasRawDate = own(raw, 'A') || own(raw, 'B') || own(raw, 'C');
  if (!hasRawDate) {
    const start = pick(booking, 'start', 'start_at'), end = pick(booking, 'end', 'end_at');
    const first = Date.parse(start), last = Date.parse(end);
    if (!Number.isFinite(first) || !Number.isFinite(last)) return intervalError('날짜와 시작·종료 시각을 확인해 주세요.');
    if (last <= first) return intervalError('종료 시각은 시작 시각 이후여야 합니다.');
    return withLessonPlan({ start: new Date(first).toISOString(), end: new Date(last).toISOString(), date: kstDay(start), startDate: kstDay(start), endDate: kstDay(end), error: null }, booking);
  }
  const date = parseKstDate(raw.A), first = parseLessonTime(raw.B), last = parseLessonTime(raw.C);
  if (!date) return intervalError('강습 날짜를 확인해 주세요.');
  if (!first || !last || first.hour >= 24) return intervalError('시작·종료 시각을 확인해 주세요.');
  const start = isoAt(date, first), end = isoAt(date, last);
  if (Date.parse(end) <= Date.parse(start)) return intervalError('종료 시각은 시작 시각 이후여야 합니다.');
  return withLessonPlan({ start, end, date, startDate: kstDay(start), endDate: kstDay(end), error: null }, booking);
}

/** Canonical settings are bookingExpert*. Older preview aliases remain readable. */
export function bookingPolicy(settings = {}) {
  const number = (canonical, alias, fallback, maximum) => integerOrNull(pick(settings, canonical, alias), maximum) ?? fallback;
  const mode = pick(settings, 'bookingExpertMode', 'expertMode');
  const parallelMode = pick(settings, 'bookingExpertParallelMode', 'expertParallelMode');
  const snowboardMode = pick(settings, 'bookingExpertSnowboardMode', 'expertSnowboardMode');
  return {
    ageMax: number('bookingExpertAgeMax', 'expertAgeMax', 7, 120),
    experienceMin: number('bookingExpertExperienceMin', 'expertExperienceMin', 5, 1000),
    mode: ['either', 'both', 'age', 'skill'].includes(mode) ? mode : 'either',
    parallelMode: ['capable', 'not_capable', 'either'].includes(parallelMode) ? parallelMode : 'capable',
    snowboardMode: ['capable', 'not_capable', 'either'].includes(snowboardMode) ? snowboardMode : 'capable',
  };
}

/** Answers stay separate even when an operator changes the lesson sport. */
export function sportSkill(booking = {}) {
  const raw = rawOf(booking);
  const explicit = normalized(own(raw, 'D') ? raw.D : pick(booking, 'sport'));
  // Existing ski records and callers without a sport retain their old meaning.
  const sport = explicit || '스키';
  if (sport === '보드') return { sport, key: 'snowboardNoviceTurn', label: 'S자 너비스턴', value: booleanOrNull(pick(booking, 'snowboardNoviceTurn', 'snowboard_novice_turn')) };
  if (sport === '스키') return { sport, key: 'parallelLongTurn', label: '패러렐 롱턴', value: booleanOrNull(pick(booking, 'parallelLongTurn', 'parallel_long_turn')) };
  return { sport, key: null, label: '종목별 기술', value: null };
}

/** Unknown input never silently becomes an inexperienced learner or an adult. */
export function learnerAgeDetails(booking = {}) {
  if(Array.isArray(booking.participants)){
    const details=participantAgeDetails(booking.participants),error=participantValidationError(booking.participants,booking.raw?.M??booking.raw_data?.M??booking.participants.length);
    return{age:details.age,ageBand:details.ageBand,eligibilityAge:error?null:details.ageBand==='adult'?19:details.age,needsReview:!!error||!details.known,error};
  }
  const exact = pick(booking, 'age', 'learnerAge', 'learner_age');
  const band = normalized(pick(booking, 'ageBand', 'age_band'));
  const hasExact = exact !== undefined && exact !== null && normalized(exact) !== '';
  const age = typeof exact === 'boolean' ? null : integerOrNull(exact, 120);
  const ageBand = ['20s', '30s', '40s', '50s', '60s'].includes(band) ? band : null;
  const error = hasExact && band ? '정확한 나이와 성인 연령대 중 하나만 선택해 주세요.'
    : hasExact && age === null ? '나이를 0~120 사이의 정수로 입력해 주세요.'
      : band && !ageBand ? '성인 연령대를 20대부터 60대 중에서 선택해 주세요.' : null;
  // A band's lower bound is only an assignment guard; it is never a stored exact age.
  const eligibilityAge = error ? null : ageBand ? Number(ageBand.slice(0, 2)) : age;
  return { age, ageBand, eligibilityAge, needsReview: !!error || eligibilityAge === null, error };
}

/** Unknown input never silently becomes an inexperienced learner or an adult. */
export function expertRequirement(booking = {}, settings = {}) {
  const policy = bookingPolicy(settings);
  const ageDetails = learnerAgeDetails(booking), { age, ageBand, eligibilityAge } = ageDetails;
  const experienceCount = integerOrNull(pick(booking, 'experienceCount', 'experience_count', 'priorLessonCount', 'prior_lesson_count'));
  const parallelLongTurn = booleanOrNull(pick(booking, 'parallelLongTurn', 'parallel_long_turn'));
  const snowboardNoviceTurn = booleanOrNull(pick(booking, 'snowboardNoviceTurn', 'snowboard_novice_turn'));
  const skill = sportSkill(booking), skillMode = skill.sport === '보드' ? policy.snowboardMode : policy.parallelMode;
  // 운영 정책(2026-11-15): 기술 응답 미선택은 '불가'로 간주하고 접수를 막지 않는다.
  // 나이도 선택 입력 — 값이 잘못 들어온 경우에만 확인을 요구한다.
  const skillValue = skill.value ?? false;
  // 수준이 '입문'이면 이전 강습 경험은 자동으로 0회다.
  const ability = normalized(pick(booking, 'ability') ?? rawOf(booking).O);
  const effectiveExperience = experienceCount ?? (ability === '입문' ? 0 : null);
  const missing = [];
  if (ageDetails.error) missing.push('나이');
  if (effectiveExperience === null) missing.push('강습 경험 횟수');
  const ageMatch = eligibilityAge !== null && eligibilityAge <= policy.ageMax;
  const skillResponseMatch = (skillMode === 'either' || (skillMode === 'not_capable' ? !skillValue : skillValue));
  const skillMatch = effectiveExperience !== null && effectiveExperience >= policy.experienceMin && skillResponseMatch;
  const required = policy.mode === 'age' ? ageMatch : policy.mode === 'skill' ? skillMatch : policy.mode === 'both' ? ageMatch && skillMatch : ageMatch || skillMatch;
  const reasons = [];
  if (ageMatch && policy.mode !== 'skill') reasons.push(ageBand ? `${ageBand.slice(0, 2)}대 · 연령 기준에 따른 경력강사 배정` : `${policy.ageMax}세 이하`);
  if (skillMatch && policy.mode !== 'age') reasons.push(`강습 경험 ${policy.experienceMin}회 이상 · ${skill.label} ${skillMode === 'not_capable' ? '불가능' : skillMode === 'either' ? '응답 확인' : '가능'}`);
  return { required, needsReview: missing.length > 0, missing, reasons, age, ageBand, ageError:ageDetails.error, experienceCount: effectiveExperience, parallelLongTurn, snowboardNoviceTurn, skillKey: skill.key, skillLabel: skill.label, skillValue, skillMode, policy };
}

export function normalizeInstructorIds(schedule = {}) {
  const many = pick(schedule, 'instructorUserIds', 'instructor_user_ids', 'instructorIds');
  const primary = pick(schedule, 'instructorUserId', 'instructor_user_id');
  return [...new Set([...(Array.isArray(many) ? many : []), primary].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

/** The fixed teacher remains primary when additional instructors are selected. */
export function reservationInstructorOrder(booking = {}) {
  const ids=normalizeInstructorIds(booking);
  const preferred=booking.preferredInstructorId||booking.preferred_instructor_user_id;
  const fixed=booking.designated||booking.isReorder||booking.is_reorder||['reorder','season'].includes(booking.kind);
  return fixed&&ids.includes(preferred)?[preferred,...ids.filter(id=>id!==preferred)]:ids;
}

const REASONS = Object.freeze({
  INPUT_REVIEW: '나이·강습 경험·종목별 기술 응답을 확인해 주세요.',
  INVALID_INTERVAL: '강습 날짜 또는 시작·종료 시각을 확인해 주세요.',
  INACTIVE: '사용 중인 강사 계정이 아닙니다.',
  CAPABILITY_UNVERIFIED: '관리자가 강사 배정 정보를 확인해야 합니다.',
  EXPERIENCED_REQUIRED: '경력강사가 필요한 강습입니다.',
  SPORT_UNCONFIRMED: '종목 배정 정보를 확인해야 합니다.',
  SPORT_MISMATCH: '담당 가능한 종목이 아닙니다.',
  LOCATION_UNCONFIRMED: '지점 배정 정보를 확인해야 합니다.',
  LOCATION_MISMATCH: '담당 가능한 지점이 아닙니다.',
  INSTRUCTOR_REQUIRED: '지정·리오더 담당 강사를 선택해 주세요.',
  SEASON_UNCONFIRMED: '연결된 시즌강습 묶음을 확인해 주세요.',
  SEASON_INSTRUCTOR_CONFLICT: '같은 시즌강습의 회차에 서로 다른 담당 강사가 있습니다.',
  SEASON_SESSION_UNAVAILABLE: '시즌강습의 모든 예약 회차에 가능한 강사가 필요합니다.',
  SEASON_SESSION_PAST: '시즌강습에 이미 종료된 미배정 회차가 있어 먼저 확인해야 합니다.',
  DESIGNATION_CONFLICT: '시즌권 담당 강사와 지정 강사가 다릅니다.',
  FIXED_INSTRUCTOR: '지정·리오더·시즌권·수강권의 담당 강사를 유지합니다.',
  PASS_UNCONFIRMED: '연결된 수강권 정보를 확인해 주세요.',
  PASS_INSTRUCTOR_CONFLICT: '수강권 담당 강사와 지정·시즌 강사가 다릅니다.',
  PASS_SPORT_MISMATCH: '수강권의 종목과 예약 종목이 다릅니다.',
  PASS_INACTIVE: '사용 가능한 수강권인지 확인해 주세요.',
  PASS_SESSION_UNAVAILABLE: '수강권의 다른 예약 회차에도 가능한 강사가 필요합니다.',
  OVERLAP: '같은 시간에 다른 강습이 배정되어 있습니다.',
  TIME_OFF: '해당 날짜에 휴무가 신청되었거나 승인되었습니다.',
});

export const ASSIGNMENT_REASON_LABELS = REASONS;

export function bookingLocation(booking = {}) {
  const explicit = normalized(pick(booking, 'location', 'location_name'));
  if (explicit) return explicit;
  const company = normalized(rawOf(booking).E);
  return knownCompanyLocation(company)||(company ? company.split(' ').at(-1) : '');
}

function dayTouches(interval, date) {
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  return Number.isFinite(dayStart) && Date.parse(interval.start) < dayStart + DAY && Date.parse(interval.end) > dayStart;
}
const cancelled = value => ['cancelled', 'canceled'].includes(value?.status) || Boolean(value?.cancelledAt || value?.cancelled_at);

/**
 * All candidates remain visible with exclusion reasons; eligible is a subset.
 * Fixed instructors are hard constraints, never a preference to fall back from.
 */
function evaluateSingleBookingCandidates(booking = {}, context = {}) {
  const { roster = [], capabilities = [], schedules = [], reservations = [], seasonPackages = [], lessonPasses = [], timeOffRequests = [], settings = {} } = context;
  const interval = parseLessonInterval(booking), expert = expertRequirement(booking, settings);
  const raw = rawOf(booking), sport = normalized(own(raw, 'D') ? raw.D : pick(booking, 'sport')), location = bookingLocation(booking);
  const kind = pick(booking, 'kind', 'booking_kind') || 'single';
  const isReorder = kind === 'reorder' || pick(booking, 'isReorder', 'is_reorder') === true;
  const designated = pick(booking, 'designated', 'is_designated') === true;
  const preferred = normalized(pick(booking, 'preferredInstructorId', 'preferred_instructor_user_id'));
  const seasonId = normalized(pick(booking, 'seasonId', 'season_id'));
  const season = seasonPackages.find(item => String(item.id) === seasonId);
  const seasonInstructor = normalized(pick(season, 'instructor_user_id', 'instructorUserId', 'instructorId'));
  const lessonPassId = normalized(pick(booking, 'lessonPassId', 'lesson_pass_id'));
  const lessonPass = lessonPasses.find(item => String(item.id) === lessonPassId);
  const passInstructor = normalized(pick(lessonPass, 'fixed_instructor_user_id', 'fixedInstructorId'));
  const globalCodes = [];
  if (expert.needsReview) globalCodes.push('INPUT_REVIEW');
  if (interval.error) globalCodes.push('INVALID_INTERVAL');
  if ((isReorder || designated) && !preferred) globalCodes.push('INSTRUCTOR_REQUIRED');
  if (kind === 'season' && seasonId && !season) globalCodes.push('SEASON_UNCONFIRMED');
  if (kind === 'season' && seasonInstructor && preferred && seasonInstructor !== preferred) globalCodes.push('DESIGNATION_CONFLICT');
  if (lessonPassId && !lessonPass) globalCodes.push('PASS_UNCONFIRMED');
  if (lessonPass && lessonPass.status && lessonPass.status !== 'active') globalCodes.push('PASS_INACTIVE');
  if (lessonPass?.sport && normalized(lessonPass.sport) !== sport) globalCodes.push('PASS_SPORT_MISMATCH');
  const requestedInstructor = kind === 'season' ? seasonInstructor || preferred || null : (isReorder || designated) ? preferred || null : null;
  if (passInstructor && ((preferred && preferred !== passInstructor) || (requestedInstructor && requestedInstructor !== passInstructor))) globalCodes.push('PASS_INSTRUCTOR_CONFLICT');
  const requiredInstructorId = passInstructor || requestedInstructor;
  const currentId = normalized(pick(booking, 'id', 'schedule_id', 'scheduleId'));
  const reservationById = new Map(reservations.map(item => [String(item.schedule_id || item.id), item]));
  const candidates = roster.filter(member => member.role === 'instructor').map(member => {
    const instructorId = String(member.user_id || member.userId || member.id || '');
    const capability = capabilities.find(item => String(item.instructor_user_id || item.instructorUserId) === instructorId);
    const reasonCodes = [...globalCodes];
    const reasons = [];
    if (!member.active) reasonCodes.push('INACTIVE');
    if (!capability || capability.verified !== true) reasonCodes.push('CAPABILITY_UNVERIFIED');
    if (expert.required && capability?.is_experienced !== true && capability?.isExperienced !== true) reasonCodes.push('EXPERIENCED_REQUIRED');
    const sports = Array.isArray(capability?.sports) ? capability.sports.map(normalized) : [];
    const locations = Array.isArray(capability?.locations) ? capability.locations.map(normalized) : [];
    if (!sport || !sports.length) reasonCodes.push('SPORT_UNCONFIRMED');
    else if (!sports.includes(sport)) reasonCodes.push('SPORT_MISMATCH');
    if (!location || !locations.length) reasonCodes.push('LOCATION_UNCONFIRMED');
    else if (!locations.includes(location)) reasonCodes.push('LOCATION_MISMATCH');
    if (requiredInstructorId && instructorId !== requiredInstructorId) reasonCodes.push('FIXED_INSTRUCTOR');
    let workload = 0;
    if (!interval.error) {
      const countedWorkload = new Set();
      for (const schedule of schedules) {
        const scheduleId = String(schedule.id || schedule.schedule_id || '');
        if (scheduleId === currentId || cancelled(schedule) || cancelled(reservationById.get(scheduleId)) || !normalizeInstructorIds(schedule).includes(instructorId)) continue;
        const other = parseLessonInterval(schedule);
        if (other.error) continue;
        if (dayTouches(other, interval.startDate)) { workload++; countedWorkload.add(scheduleId); }
        if (lessonIntervalsOverlap(other, interval)) reasonCodes.push('OVERLAP');
      }
      // A requested instructor's time is reserved before final assignment too.
      // Otherwise another booking could consume the slot while the first is
      // still in reception, breaking the reorder/season continuity promise.
      for (const reservation of reservations) {
        const reservationId = String(reservation.id || reservation.schedule_id || '');
        if (reservationId === currentId || cancelled(reservation)) continue;
        const reservationKind = pick(reservation, 'kind', 'booking_kind') || 'single';
        const reservedPassId = normalized(pick(reservation, 'lessonPassId', 'lesson_pass_id'));
        const reservedPass = lessonPasses.find(item => String(item.id) === reservedPassId);
        const reservedPassInstructor = normalized(pick(reservedPass, 'fixed_instructor_user_id', 'fixedInstructorId'));
        const isFixed = reservedPassInstructor || reservationKind === 'season' || reservationKind === 'reorder' || pick(reservation, 'designated', 'is_designated') === true || pick(reservation, 'isReorder', 'is_reorder') === true;
        if (!isFixed) continue;
        const reservedSeasonId = normalized(pick(reservation, 'seasonId', 'season_id'));
        const reservedSeason = seasonPackages.find(item => String(item.id) === reservedSeasonId);
        const heldInstructor = reservedPassInstructor || normalized(pick(reservation, 'preferredInstructorId', 'preferred_instructor_user_id')) || (reservationKind === 'season' ? normalized(pick(reservedSeason, 'instructor_user_id', 'instructorUserId', 'instructorId')) : '');
        if (heldInstructor !== instructorId) continue;
        let other = parseLessonInterval(reservation);
        if (other.error) {
          const attachedSchedule = schedules.find(item => String(item.id || item.schedule_id || '') === reservationId);
          if (attachedSchedule) other = parseLessonInterval(attachedSchedule);
        }
        if (other.error) continue;
        if (!countedWorkload.has(reservationId) && dayTouches(other, interval.startDate)) { workload++; countedWorkload.add(reservationId); }
        if (lessonIntervalsOverlap(other, interval)) reasonCodes.push('OVERLAP');
      }
      const leave = timeOffRequests.some(request => {
        if (String(request.instructor_user_id || request.instructorUserId || '') !== instructorId || !['pending', 'approved'].includes(request.status)) return false;
        const date = parseKstDate(request.date || request.leave_date || request.requested_date);
        return date && dayTouches(interval, date);
      });
      if (leave) reasonCodes.push('TIME_OFF');
    }
    const codes = [...new Set(reasonCodes)];
    if (!codes.length) {
      reasons.push('시간·휴무·종목·지점 확인');
      if (expert.required) reasons.push('경력강사 조건 충족');
      if (requiredInstructorId) reasons.push(passInstructor ? '수강권 동일 강사 유지' : kind === 'season' ? '시즌권 동일 강사 유지' : isReorder ? '리오더 담당 강사 유지' : '지정 강사 유지');
    }
    return { instructorId, userId: instructorId, name: member.display_name || member.name || '', eligible: codes.length === 0, reasonCodes: codes, blockedReasons: codes.map(code => REASONS[code]), reasons, requiresExperienced: expert.required, workload };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.workload - b.workload || a.name.localeCompare(b.name, 'ko-KR') || a.instructorId.localeCompare(b.instructorId));
  const missingRequiredInstructor = requiredInstructorId && !candidates.some(item => item.instructorId === requiredInstructorId);
  const reasons = [...globalCodes.map(code => REASONS[code])];
  if (missingRequiredInstructor) reasons.push('담당 강사 계정을 확인해 주세요.');
  return { candidates, eligible: candidates.filter(item => item.eligible), requiredInstructorId, needsReview: globalCodes.length > 0 || !!missingRequiredInstructor, reasons, expert, interval };
}

/** A package's first teacher must be available for all of its booked sessions. */
export function evaluateCandidates(booking = {}, context = {}) {
  let result = evaluateSingleBookingCandidates(booking, context);
  const passId = normalized(pick(booking, 'lessonPassId', 'lesson_pass_id'));
  const pass = (context.lessonPasses || []).find(item => String(item.id) === passId);
  const seasonId = normalized(pick(booking, 'seasonId', 'season_id'));
  const season = (context.seasonPackages || []).find(item => String(item.id) === seasonId);
  const groups = [];
  if (pass && !normalized(pick(pass, 'fixed_instructor_user_id', 'fixedInstructorId')))
    groups.push({ id:passId, keys:['lessonPassId','lesson_pass_id'], conflict:'PASS_INSTRUCTOR_CONFLICT', unavailable:'PASS_SESSION_UNAVAILABLE', detail:'passConflicts' });
  if (season && (pick(booking, 'kind', 'booking_kind') || 'single') === 'season')
    groups.push({ id:seasonId, keys:['seasonId','season_id'], conflict:'SEASON_INSTRUCTOR_CONFLICT', unavailable:'SEASON_SESSION_UNAVAILABLE', detail:'seasonConflicts' });
  for (const group of groups) result = evaluatePackagePeers(booking, context, result, group);
  return result;
}

function evaluatePackagePeers(booking, context, result, group) {
  const idOf = item => normalized(pick(item, 'id', 'schedule_id', 'scheduleId'));
  const currentId = idOf(booking), schedules = context.schedules || [];
  const requestedNow = context.now instanceof Date ? context.now.getTime()
    : typeof context.now === 'number' ? context.now : Date.parse(context.now);
  const now = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const peers = (context.reservations || []).filter(item => idOf(item) !== currentId
    && normalized(pick(item, ...group.keys)) === group.id && !cancelled(item)
    && !cancelled(schedules.find(schedule => idOf(schedule) === idOf(item))));
  if (!peers.length) return result;
  // An edited session's former time/teacher must not block its prospective teacher.
  const peerContext = { ...context,
    reservations: (context.reservations || []).filter(item => idOf(item) !== currentId),
    schedules: schedules.filter(item => idOf(item) !== currentId),
  };
  const checks = peers.map(peer => {
    const schedule = schedules.find(item => idOf(item) === idOf(peer));
    const primary = normalized(pick(schedule, 'instructorUserId', 'instructor_user_id'))
      || reservationInstructorOrder(peer)[0] || normalizeInstructorIds(schedule)[0];
    const evaluation = evaluateSingleBookingCandidates(peer, peerContext);
    return { peer, primary, evaluation };
  });
  // Checking each peer only against the selected row misses conflicts between
  // two later sessions. One teacher must be able to cover the entire package.
  const groupIntervals = [result.interval, ...checks.map(check => check.evaluation.interval)];
  const candidates = result.candidates.map(candidate => {
    const conflicts = checks.flatMap(({ peer, primary, evaluation }, index) => {
      const other = evaluation.candidates.find(item => item.instructorId === candidate.instructorId);
      const codes = [...(other?.reasonCodes || ['INACTIVE'])];
      if (primary && primary !== candidate.instructorId) codes.push(group.conflict);
      if (group.detail === 'seasonConflicts' && !primary && Date.parse(evaluation.interval.end) <= now) codes.push('SEASON_SESSION_PAST');
      if (groupIntervals.some((interval, at) => at !== index + 1 && lessonIntervalsOverlap(interval, evaluation.interval))) codes.push('OVERLAP');
      const reasonCodes = [...new Set(codes)];
      return reasonCodes.length ? [{ reservationId: idOf(peer), date: evaluation.interval.startDate,
        reasonCodes, reasons: reasonCodes.map(code => REASONS[code]) }] : [];
    });
    if (!conflicts.length) return candidate;
    const reasonCodes = [...new Set([...candidate.reasonCodes, group.unavailable, ...conflicts.flatMap(item => item.reasonCodes)])];
    return { ...candidate, eligible: false, reasons: [], reasonCodes, [group.detail]: conflicts,
      blockedReasons: [...candidate.blockedReasons, ...conflicts.map(item => `${item.date || '다른 회차'} · ${item.reasons.join(' · ')}`)] };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.workload - b.workload
    || a.name.localeCompare(b.name, 'ko-KR') || a.instructorId.localeCompare(b.instructorId));
  return { ...result, candidates, eligible: candidates.filter(item => item.eligible) };
}
