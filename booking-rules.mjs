/** Reservation and assignment rules shared by the workbench and its preview.
 * The server independently validates every saved assignment. This module never
 * grants permission or treats a candidate suggestion as a confirmed booking.
 */
const DAY = 86_400_000;
const OFFSET = 9 * 60 * 60 * 1000;
const COLUMN_LABELS = [
  '날짜', '시작시간', '종료시간', '스키', '강습업체', '강사님', '특이사항',
  '입금자', '강습생', '횟수', '관계', '연락처', '인원', '강습시간', '수준',
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

/** 24:00 is the following midnight; 24:01 and malformed times are rejected. */
export function parseLessonTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(normalized(value));
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return { hour, minute, dayOffset: hour === 24 ? 1 : 0, value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

const dateAt = (date, offset = 0) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
const isoAt = (date, time) => `${dateAt(date, time.dayOffset)}T${String(time.hour % 24).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}:00+09:00`;
const kstDay = value => {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? new Date(instant + OFFSET).toISOString().slice(0, 10) : null;
};
const intervalError = error => ({ start: null, end: null, date: null, startDate: null, endDate: null, error });

/** Actual B/C times determine overlap. N is a separately retained product label. */
export function parseLessonInterval(booking) {
  const raw = rawOf(booking);
  const hasRawDate = own(raw, 'A') || own(raw, 'B') || own(raw, 'C');
  if (!hasRawDate) {
    const start = pick(booking, 'start', 'start_at'), end = pick(booking, 'end', 'end_at');
    const first = Date.parse(start), last = Date.parse(end);
    if (!Number.isFinite(first) || !Number.isFinite(last)) return intervalError('날짜와 시작·종료 시각을 확인해 주세요.');
    if (last <= first) return intervalError('종료 시각은 시작 시각 이후여야 합니다.');
    return { start: new Date(first).toISOString(), end: new Date(last).toISOString(), date: kstDay(start), startDate: kstDay(start), endDate: kstDay(end), error: null };
  }
  const date = parseKstDate(raw.A), first = parseLessonTime(raw.B), last = parseLessonTime(raw.C);
  if (!date) return intervalError('강습 날짜를 확인해 주세요.');
  if (!first || !last) return intervalError('시작·종료 시각을 확인해 주세요.');
  const start = isoAt(date, first), end = isoAt(date, last);
  if (Date.parse(end) <= Date.parse(start)) return intervalError('종료 시각은 시작 시각 이후여야 합니다.');
  return { start, end, date, startDate: kstDay(start), endDate: kstDay(end), error: null };
}

/** Canonical settings are bookingExpert*. Older preview aliases remain readable. */
export function bookingPolicy(settings = {}) {
  const number = (canonical, alias, fallback, maximum) => integerOrNull(pick(settings, canonical, alias), maximum) ?? fallback;
  const mode = pick(settings, 'bookingExpertMode', 'expertMode');
  const parallelMode = pick(settings, 'bookingExpertParallelMode', 'expertParallelMode');
  return {
    ageMax: number('bookingExpertAgeMax', 'expertAgeMax', 7, 120),
    experienceMin: number('bookingExpertExperienceMin', 'expertExperienceMin', 5, 1000),
    mode: ['either', 'both', 'age', 'skill'].includes(mode) ? mode : 'either',
    parallelMode: ['capable', 'not_capable', 'either'].includes(parallelMode) ? parallelMode : 'capable',
  };
}

/** Unknown input never silently becomes an inexperienced learner or an adult. */
export function expertRequirement(booking = {}, settings = {}) {
  const policy = bookingPolicy(settings);
  const age = integerOrNull(pick(booking, 'age', 'learnerAge', 'learner_age'), 120);
  const experienceCount = integerOrNull(pick(booking, 'experienceCount', 'experience_count', 'priorLessonCount', 'prior_lesson_count'));
  const parallelLongTurn = booleanOrNull(pick(booking, 'parallelLongTurn', 'parallel_long_turn'));
  const missing = [];
  if (age === null) missing.push('나이');
  if (experienceCount === null) missing.push('강습 경험 횟수');
  if (parallelLongTurn === null) missing.push('패러렐 롱턴 가능 여부');
  const ageMatch = age !== null && age <= policy.ageMax;
  const parallelMatch = parallelLongTurn !== null && (policy.parallelMode === 'either' || (policy.parallelMode === 'not_capable' ? !parallelLongTurn : parallelLongTurn));
  const skillMatch = experienceCount !== null && experienceCount >= policy.experienceMin && parallelMatch;
  const required = policy.mode === 'age' ? ageMatch : policy.mode === 'skill' ? skillMatch : policy.mode === 'both' ? ageMatch && skillMatch : ageMatch || skillMatch;
  const reasons = [];
  if (ageMatch && policy.mode !== 'skill') reasons.push(`${policy.ageMax}세 이하`);
  if (skillMatch && policy.mode !== 'age') reasons.push(`강습 경험 ${policy.experienceMin}회 이상 · 패러렐 롱턴 ${policy.parallelMode === 'not_capable' ? '불가능' : policy.parallelMode === 'either' ? '응답 확인' : '가능'}`);
  return { required, needsReview: missing.length > 0, missing, reasons, age, experienceCount, parallelLongTurn, policy };
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
  INPUT_REVIEW: '나이·강습 경험·패러렐 롱턴 응답을 확인해 주세요.',
  INVALID_INTERVAL: '강습 날짜 또는 시작·종료 시각을 확인해 주세요.',
  INACTIVE: '사용 중인 강사 계정이 아닙니다.',
  CAPABILITY_UNVERIFIED: '관리자가 강사 배정 정보를 확인해야 합니다.',
  EXPERIENCED_REQUIRED: '경력강사가 필요한 강습입니다.',
  SPORT_UNCONFIRMED: '종목 배정 정보를 확인해야 합니다.',
  SPORT_MISMATCH: '담당 가능한 종목이 아닙니다.',
  LOCATION_UNCONFIRMED: '지점 배정 정보를 확인해야 합니다.',
  LOCATION_MISMATCH: '담당 가능한 지점이 아닙니다.',
  INSTRUCTOR_REQUIRED: '지정·리오더 담당 강사를 선택해 주세요.',
  SEASON_UNCONFIRMED: '시즌권 담당 강사를 확인해 주세요.',
  DESIGNATION_CONFLICT: '시즌권 담당 강사와 지정 강사가 다릅니다.',
  FIXED_INSTRUCTOR: '지정·리오더·시즌권의 담당 강사를 유지합니다.',
  OVERLAP: '같은 시간에 다른 강습이 배정되어 있습니다.',
  TIME_OFF: '해당 날짜에 휴무가 신청되었거나 승인되었습니다.',
});

export const ASSIGNMENT_REASON_LABELS = REASONS;

export function bookingLocation(booking = {}) {
  const explicit = normalized(pick(booking, 'location', 'location_name'));
  if (explicit) return explicit;
  const company = normalized(rawOf(booking).E);
  return company ? company.split(' ').at(-1) : '';
}

function dayTouches(interval, date) {
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  return Number.isFinite(dayStart) && Date.parse(interval.start) < dayStart + DAY && Date.parse(interval.end) > dayStart;
}
const cancelled = value => ['cancelled', 'canceled'].includes(value?.status);

/**
 * All candidates remain visible with exclusion reasons; eligible is a subset.
 * Fixed instructors are hard constraints, never a preference to fall back from.
 */
export function evaluateCandidates(booking = {}, context = {}) {
  const { roster = [], capabilities = [], schedules = [], reservations = [], seasonPackages = [], timeOffRequests = [], settings = {} } = context;
  const interval = parseLessonInterval(booking), expert = expertRequirement(booking, settings);
  const raw = rawOf(booking), sport = normalized(pick(booking, 'sport') ?? raw.D), location = bookingLocation(booking);
  const kind = pick(booking, 'kind', 'booking_kind') || 'single';
  const isReorder = kind === 'reorder' || pick(booking, 'isReorder', 'is_reorder') === true;
  const designated = pick(booking, 'designated', 'is_designated') === true;
  const preferred = normalized(pick(booking, 'preferredInstructorId', 'preferred_instructor_user_id'));
  const seasonId = normalized(pick(booking, 'seasonId', 'season_id'));
  const season = seasonPackages.find(item => String(item.id) === seasonId);
  const seasonInstructor = normalized(pick(season, 'instructor_user_id', 'instructorUserId', 'instructorId'));
  const globalCodes = [];
  if (expert.needsReview) globalCodes.push('INPUT_REVIEW');
  if (interval.error) globalCodes.push('INVALID_INTERVAL');
  if ((isReorder || designated) && !preferred) globalCodes.push('INSTRUCTOR_REQUIRED');
  if (kind === 'season' && seasonId && (!season || !seasonInstructor)) globalCodes.push('SEASON_UNCONFIRMED');
  if (kind === 'season' && seasonInstructor && preferred && seasonInstructor !== preferred) globalCodes.push('DESIGNATION_CONFLICT');
  const requiredInstructorId = kind === 'season' ? seasonInstructor || preferred || null : (isReorder || designated) ? preferred || null : null;
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
        if (Date.parse(other.start) < Date.parse(interval.end) && Date.parse(other.end) > Date.parse(interval.start)) reasonCodes.push('OVERLAP');
      }
      // A requested instructor's time is reserved before final assignment too.
      // Otherwise another booking could consume the slot while the first is
      // still in reception, breaking the reorder/season continuity promise.
      for (const reservation of reservations) {
        const reservationId = String(reservation.id || reservation.schedule_id || '');
        if (reservationId === currentId || cancelled(reservation)) continue;
        const reservationKind = pick(reservation, 'kind', 'booking_kind') || 'single';
        const isFixed = reservationKind === 'season' || reservationKind === 'reorder' || pick(reservation, 'designated', 'is_designated') === true || pick(reservation, 'isReorder', 'is_reorder') === true;
        if (!isFixed) continue;
        const reservedSeasonId = normalized(pick(reservation, 'seasonId', 'season_id'));
        const reservedSeason = seasonPackages.find(item => String(item.id) === reservedSeasonId);
        const heldInstructor = normalized(pick(reservation, 'preferredInstructorId', 'preferred_instructor_user_id')) || (reservationKind === 'season' ? normalized(pick(reservedSeason, 'instructor_user_id', 'instructorUserId', 'instructorId')) : '');
        if (heldInstructor !== instructorId) continue;
        let other = parseLessonInterval(reservation);
        if (other.error) {
          const attachedSchedule = schedules.find(item => String(item.id || item.schedule_id || '') === reservationId);
          if (attachedSchedule) other = parseLessonInterval(attachedSchedule);
        }
        if (other.error) continue;
        if (!countedWorkload.has(reservationId) && dayTouches(other, interval.startDate)) { workload++; countedWorkload.add(reservationId); }
        if (Date.parse(other.start) < Date.parse(interval.end) && Date.parse(other.end) > Date.parse(interval.start)) reasonCodes.push('OVERLAP');
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
      if (requiredInstructorId) reasons.push(kind === 'season' ? '시즌권 동일 강사 유지' : isReorder ? '리오더 담당 강사 유지' : '지정 강사 유지');
    }
    return { instructorId, userId: instructorId, name: member.display_name || member.name || '', eligible: codes.length === 0, reasonCodes: codes, blockedReasons: codes.map(code => REASONS[code]), reasons, requiresExperienced: expert.required, workload };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.workload - b.workload || a.name.localeCompare(b.name, 'ko-KR') || a.instructorId.localeCompare(b.instructorId));
  const missingRequiredInstructor = requiredInstructorId && !candidates.some(item => item.instructorId === requiredInstructorId);
  const reasons = [...globalCodes.map(code => REASONS[code])];
  if (missingRequiredInstructor) reasons.push('담당 강사 계정을 확인해 주세요.');
  return { candidates, eligible: candidates.filter(item => item.eligible), requiredInstructorId, needsReview: globalCodes.length > 0 || !!missingRequiredInstructor, reasons, expert, interval };
}
