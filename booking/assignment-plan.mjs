import {
  ASSIGNMENT_REASON_LABELS, evaluateCandidates, expertRequirement,
  normalizeInstructorIds, parseLessonInterval,
} from './booking-rules.mjs?v=35';
import {bookingTeamLabel} from './customer-teams.mjs?v=27';

/** These plans are suggestions. The server must validate the confirmed batch. */
export const ASSIGNMENT_PLAN_REASON_LABELS = Object.freeze({
  ...ASSIGNMENT_REASON_LABELS,
  PAST_LESSON: '이미 종료된 강습은 자동배정하지 않습니다.',
  NO_INSTRUCTORS: '배정할 강사 계정이 없습니다.',
  MISSING_ID: '예약 고유번호를 확인해 주세요.',
  DUPLICATE_RESERVATION: '같은 예약이 중복되어 있습니다. 목록을 다시 불러와 주세요.',
  REQUIRED_INSTRUCTOR_UNAVAILABLE: '지정된 담당 강사 계정을 확인해 주세요.',
  NO_ELIGIBLE_INSTRUCTOR: '현재 조건에 맞는 배정 가능 강사가 없습니다.',
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const pick = (value, ...keys) => {
  for (const key of keys) if (own(value, key)) return value[key];
  return undefined;
};
const idOf = row => String(pick(row, 'id', 'schedule_id', 'scheduleId') || '').trim();
const unique = values => [...new Set(values.filter(Boolean))];
const isCancelled = row => ['cancelled', 'canceled'].includes(row?.status) || Boolean(row?.cancelledAt || row?.cancelled_at);
const passIdOf = row => String(pick(row, 'lessonPassId', 'lesson_pass_id') || '').trim();
const passTeacher = row => String(pick(row, 'fixed_instructor_user_id', 'fixedInstructorId') || '').trim();
const seasonIdOf = row => String(pick(row, 'seasonId', 'season_id') || '').trim();
const seasonTeacher = row => String(pick(row, 'instructor_user_id', 'instructorUserId', 'instructorId') || '').trim();
const fixed = (row, passes = []) => Boolean(passTeacher(passes.find(item => String(item.id) === passIdOf(row)))) || row?.kind === 'season' || row?.kind === 'reorder'
  || row?.booking_kind === 'season' || row?.booking_kind === 'reorder'
  || pick(row, 'isReorder', 'is_reorder') === true
  || pick(row, 'designated', 'is_designated') === true;
const safeTime = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : Infinity;
const rowCustomer = row => {
  const raw = row?.raw || row?.raw_data || {};
  return String(raw.H || raw.I ? bookingTeamLabel(row) : row?.customer || row?.customer_name || '예약');
};
const normKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
// 고객 단위 식별: 고객 ID가 있으면 그것을, 없으면 연락처+고객명을 쓴다.
// 팀명(I)은 제외해 가족 팀 재구성 후에도 같은 고객으로 묶인다.
const customerKeyOf = row => {
  const direct = String(pick(row, 'customerId', 'customer_id') || '').trim();
  if (direct) return `c:${direct}`;
  const raw = row?.raw || row?.raw_data || {};
  const phone = normKey(raw.L || row?.phone || row?.customer_phone);
  const name = normKey(raw.H || row?.customer || row?.customer_name);
  return phone || name ? `r:${phone}|${name}` : '';
};

function assignedIds(row, schedulesById) {
  const schedule = schedulesById.get(idOf(row));
  return unique([
    ...normalizeInstructorIds(row),
    ...(Array.isArray(row?.instructor_ids) ? row.instructor_ids : []),
    ...(schedule && !isCancelled(schedule) ? normalizeInstructorIds(schedule) : []),
  ]);
}

function conditions(row, expert, requiredInstructorId) {
  const labels = [...expert.reasons];
  if (requiredInstructorId) labels.push(passIdOf(row) ? '수강권 동일 강사 유지' : row.kind === 'season' ? '시즌권 동일 강사 유지'
    : row.kind === 'reorder' || pick(row, 'isReorder', 'is_reorder') === true
      ? '리오더 담당 강사 유지' : '지정 강사 유지');
  return unique(labels);
}

/**
 * Plan up to 100 currently unassigned rows without mutating its inputs.
 * Fixed-teacher bookings come first, then experienced-instructor bookings.
 * Each suggestion occupies its interval before the next booking is examined.
 */
export function buildAssignmentPlan(rows = [], context = {}, options = {}) {
  const suppliedRows = Array.isArray(rows) ? rows : [];
  const schedules = Array.isArray(context.schedules) ? context.schedules : [];
  const schedulesById = new Map(schedules.map(row => [idOf(row), row]));
  const lessonPasses = (Array.isArray(context.lessonPasses) ? context.lessonPasses : []).map(pass => ({ ...pass }));
  const seasonPackages = (Array.isArray(context.seasonPackages) ? context.seasonPackages : []).map(pack => ({ ...pack }));
  const active = suppliedRows.filter(row => row && !isCancelled(row));
  const skippedAssigned = active.filter(row => assignedIds(row, schedulesById).length > 0).length;
  const unassigned = active.filter(row => assignedIds(row, schedulesById).length === 0);
  const requestedLimit = Number(options.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 100;
  const suppliedNow = options.now === undefined ? Date.now() : new Date(options.now).getTime();
  const now = Number.isFinite(suppliedNow) ? suppliedNow : Date.now();
  const counts = new Map();
  for (const row of active) counts.set(idOf(row), (counts.get(idOf(row)) || 0) + 1);

  const queue = unassigned.map((row, index) => ({
    row, index, id: idOf(row), interval: parseLessonInterval(row),
    expert: expertRequirement(row, context.settings || {}),
  })).sort((a, b) => Number(fixed(b.row, lessonPasses)) - Number(fixed(a.row, lessonPasses))
    || Number(b.expert.required) - Number(a.expert.required)
    || safeTime(a.interval.start) - safeTime(b.interval.start)
    || a.id.localeCompare(b.id) || a.index - b.index).slice(0, limit);

  let stagedSchedules = schedules.slice();
  const reservationMap = new Map((Array.isArray(context.reservations) ? context.reservations : [])
    .filter(Boolean).map(row => [idOf(row), row]));
  for (const row of active) {
    const id = idOf(row);
    if (id) reservationMap.set(id, { ...(reservationMap.get(id) || {}), ...row });
  }
  // 고객 단위 강사 연속성(2026-11-15): 같은 고객의 기존 배정 강사를 우선
  // 후보로 쓴다. 가족 팀 재구성(1:1×3 → 2:1+1:1)에서도 기존 담당 강사들이
  // 유지되도록, 적격 후보 중 이전 담당자를 먼저 고르는 소프트 우선 규칙이다.
  // 동시간 팀들은 선점(stagedSchedules) 규칙이 중복 배정을 막는다.
  const previousByCustomer = new Map();
  const historyRows = [...reservationMap.values()]
    .filter(peer => !isCancelled(peer))
    .map(peer => ({ peer, ids: assignedIds(peer, schedulesById), time: safeTime(parseLessonInterval(peer).start) }))
    .filter(item => item.ids.length)
    .sort((a, b) => b.time - a.time);
  for (const { peer, ids } of historyRows) {
    const key = customerKeyOf(peer);
    if (!key) continue;
    previousByCustomer.set(key, unique([...(previousByCustomer.get(key) || []), ...ids]));
  }
  const items = [];
  for (const entry of queue) {
    const { row, id, interval, expert } = entry;
    const seasonId = seasonIdOf(row);
    const seasonReservationIds = seasonId && seasonPackages.some(pack => String(pack.id) === seasonId)
      ? [...reservationMap.values()].filter(peer => seasonIdOf(peer) === seasonId && !isCancelled(peer)
        && !isCancelled(schedulesById.get(idOf(peer))) && !assignedIds(peer, schedulesById).length).map(idOf).filter(Boolean)
      : [];
    const base = {
      id, customer: rowCustomer(row), start: interval.start, end: interval.end,
      lessonMinutes:interval.lessonMinutes, breakMinutes:interval.breakMinutes, busySegments:interval.busySegments,
      instructorId: null, instructorName: '', instructorIds: [], eligible: false,
      recommended: false, reasonCodes: [], reasons: [], conditionLabels: [],
      previousInstructorIds: previousByCustomer.get(customerKeyOf(row)) || [],
      expectedUpdatedAt: pick(row, 'expectedUpdatedAt', 'updated_at', 'updatedAt') || null,
      requiresExperienced: expert.required,
      ...(seasonReservationIds.length ? { seasonId, seasonReservationIds } : {}),
    };
    const prevent = [];
    if (!id) prevent.push('MISSING_ID');
    else if (counts.get(id) > 1) prevent.push('DUPLICATE_RESERVATION');
    if (interval.error) prevent.push('INVALID_INTERVAL');
    else if (Date.parse(interval.end) <= now) prevent.push('PAST_LESSON');
    if (prevent.length) {
      base.reasonCodes = prevent;
      base.reasons = prevent.map(code => ASSIGNMENT_PLAN_REASON_LABELS[code]);
      base.conditionLabels = conditions(row, expert, null);
      items.push(base); continue;
    }

    const evaluation = evaluateCandidates(row, {
      ...context, now, lessonPasses, seasonPackages, schedules: stagedSchedules, reservations: [...reservationMap.values()],
    });
    base.conditionLabels = conditions(row, expert, evaluation.requiredInstructorId);
    const preferred = !evaluation.needsReview && base.previousInstructorIds.length
      ? evaluation.eligible.find(candidate => base.previousInstructorIds.includes(candidate.instructorId)) : null;
    const chosen = !evaluation.needsReview ? (preferred || evaluation.eligible[0]) : null;
    if (!chosen) {
      const required = evaluation.requiredInstructorId;
      const fixedCandidate = required ? evaluation.candidates.find(candidate => candidate.instructorId === required) : null;
      const codes = required && fixedCandidate ? fixedCandidate.reasonCodes
        : required && !fixedCandidate ? ['REQUIRED_INSTRUCTOR_UNAVAILABLE']
          : evaluation.candidates.flatMap(candidate => candidate.reasonCodes);
      if (!evaluation.candidates.length && !required) codes.push('NO_INSTRUCTORS');
      if (expert.needsReview) codes.push('INPUT_REVIEW');
      base.reasonCodes = unique(codes.length ? codes : ['NO_ELIGIBLE_INSTRUCTOR']);
      base.reasons = unique([
        ...(evaluation.reasons || []),
        ...base.reasonCodes.map(code => ASSIGNMENT_PLAN_REASON_LABELS[code] || code),
      ]);
      items.push(base); continue;
    }

    const suggestion = {
      ...base, instructorId: chosen.instructorId, instructorName: chosen.name,
      instructorIds: [chosen.instructorId], eligible: true, recommended: true,
      reasons: preferred ? unique([...chosen.reasons, '같은 고객 담당 강사 유지']) : [...chosen.reasons],
    };
    items.push(suggestion);
    {
      const customerKey = customerKeyOf(row);
      if (customerKey) previousByCustomer.set(customerKey, unique([chosen.instructorId, ...(previousByCustomer.get(customerKey) || [])]));
    }
    const lessonPassId = passIdOf(row);
    if (lessonPassId) {
      const pass = lessonPasses.find(item => String(item.id) === lessonPassId);
      if (pass && !passTeacher(pass)) pass.fixed_instructor_user_id = chosen.instructorId;
    }
    if (seasonId) {
      const season = seasonPackages.find(item => String(item.id) === seasonId);
      if (season && !seasonTeacher(season)) season.instructor_user_id = chosen.instructorId;
    }
    const staged = {
      id, start: interval.start, end: interval.end, lessonMinutes:interval.lessonMinutes, breakMinutes:interval.breakMinutes,
      instructorUserId: chosen.instructorId, instructorUserIds: [chosen.instructorId],
    };
    stagedSchedules = [...stagedSchedules.filter(schedule => idOf(schedule) !== id), staged];
    reservationMap.set(id, {
      ...row, instructorIds: [chosen.instructorId], instructorUserIds: [chosen.instructorId],
      instructor_user_id: chosen.instructorId, status: 'confirmed',
    });
  }

  return {
    items, assignable: items.filter(item => item.eligible), blocked: items.filter(item => !item.eligible),
    skippedAssigned, total: active.length, unassignedTotal: unassigned.length,
    processed: items.length, limit, limited: unassigned.length > limit,
    remaining: Math.max(0, unassigned.length - items.length),
  };
}
