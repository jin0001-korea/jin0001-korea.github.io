/** Browser-independent policy rules. All instants are parsed from ISO timestamps. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const defaults = {
  lateMinutes: 10,
  minDuration: 110,
  photoMinimum: 12,
  videoMinimum: 2,
  similarityThreshold: 0.8,
  timeRuleMode: 'either',
};

const instant = value => value ? new Date(value).getTime() : NaN;
const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu, '');
const customerKey = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
const phoneKey = value => String(value ?? '').replace(/\D/g, '');
function sameCustomer(left, right) {
  if (left.customerId && right.customerId) return String(left.customerId) === String(right.customerId);
  if (customerKey(left.customer) !== customerKey(right.customer)) return false;
  const leftPhone = phoneKey(left.phone);
  const rightPhone = phoneKey(right.phone);
  return !leftPhone || !rightPhone || leftPhone === rightPhone;
}

/** Reports are due 48 elapsed hours after the scheduled lesson ends. */
export function reportDeadline(schedule) {
  return new Date(instant(schedule?.end) + 48 * HOUR);
}

/** Character-trigram Dice score. This is textual overlap, not semantic AI. */
export function similarity(a, b) {
  const first = normalized(a);
  const second = normalized(b);
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (first.length < 3 || second.length < 3) return 0;
  const grams = text => new Set(Array.from({ length: text.length - 2 }, (_, i) => text.slice(i, i + 3)));
  const left = grams(first);
  const right = grams(second);
  let overlap = 0;
  for (const gram of left) if (right.has(gram)) overlap++;
  return 2 * overlap / (left.size + right.size);
}

/** Warning ids remain stable across renders. Responses never suppress evidence. */
export function getWarnings(schedules, settings = {}, now = new Date(), options = {}) {
  const policy = { ...defaults, ...settings };
  for (const key of ['lateMinutes', 'minDuration', 'photoMinimum', 'videoMinimum', 'similarityThreshold']) {
    policy[key] = numeric(policy[key], defaults[key]);
  }
  const current = instant(now);
  const warnings = [];
  const add = (schedule, key, category, title, detail, extra = {}) => warnings.push({
    id: `${schedule.id}:${key}`,
    scheduleId: schedule.id,
    category,
    title,
    detail,
    severity: 'warning',
    requiresResponse: true,
    ...extra,
  });

  for (const schedule of schedules) {
    const start = instant(schedule.start);
    const end = instant(schedule.end);
    const deadline = reportDeadline(schedule).getTime();
    const checkIn = schedule.checkIn;
    const checkOut = schedule.checkOut;
    const report = schedule.report;

    if (current > end) {
      if (!checkIn?.photoId) add(schedule, 'missing-check-in', 'missing-check-in', '만남 사진 인증 누락', '강습 종료 후에도 만남 패찰 사진이 등록되지 않았습니다.');
      if (!checkOut?.photoId) add(schedule, 'missing-check-out', 'missing-check-out', '헤어짐 사진 인증 누락', '강습 종료 후에도 헤어짐 패찰 사진이 등록되지 않았습니다.');
    }

    if ((!report && current > deadline) || (report && instant(report.submittedAt) > deadline)) {
      add(schedule, 'report-overdue', 'report-overdue', report ? '보고서 등록 기한 초과' : '보고서 미등록 · 48시간 초과', '강습 종료 후 48시간 내 카페 링크와 보고서를 등록해야 합니다. 미준수 시 패널티 검토 대상입니다.', { severity: 'danger' });
    }

    const timeWarnings = [];
    const threshold = policy.lateMinutes * MINUTE;
    const inEvent = instant(checkIn?.eventAt);
    const inUpload = instant(checkIn?.uploadedAt);
    const outEvent = instant(checkOut?.eventAt);
    const outUpload = instant(checkOut?.uploadedAt);
    const startDelay = Math.max(inEvent - start, inUpload - start);
    if (checkIn && startDelay >= threshold) {
      timeWarnings.push(['late-start', 'late-start', '시작 시간 확인 필요', `예정 시작보다 만남 또는 인증 업로드가 ${Math.floor(startDelay / MINUTE)}분 늦습니다.`]);
    }
    for (const [event, upload, key, label] of [[inEvent, inUpload, 'in', '만남'], [outEvent, outUpload, 'out', '헤어짐']]) {
      if (upload - event >= threshold) timeWarnings.push([`upload-delay-${key}`, 'upload-delay', `${label} 사진 업로드 지연`, `입력한 ${label} 시각부터 업로드까지 ${Math.floor((upload - event) / MINUTE)}분이 지났습니다.`]);
    }
    const duration = (outEvent - inEvent) / MINUTE;
    const short = Number.isFinite(duration) && duration < policy.minDuration;
    const hasDelay = timeWarnings.length > 0;
    if (policy.timeRuleMode !== 'both' || (hasDelay && short)) {
      for (const [key, category, title, detail] of timeWarnings) add(schedule, key, category, title, detail);
      if (short) add(schedule, 'short-duration', 'short-duration', '강습 시간 확인 필요', duration < 0 ? '헤어짐 시각이 만남 시각보다 빠릅니다. 입력 시각을 확인해 주세요.' : `입력한 만남~헤어짐 간격은 ${Math.floor(duration)}분으로 최소 ${policy.minDuration}분보다 짧습니다.`);
    }

    if (report) {
      if (numeric(report.photoCount, 0) < policy.photoMinimum) add(schedule, 'photos', 'photos', '기본 사진 수 부족', `강사 응답: ${numeric(report.photoCount, 0)}장 / 기준: ${policy.photoMinimum}장 이상`);
      if (numeric(report.videoCount, 0) < policy.videoMinimum) add(schedule, 'videos', 'videos', '동영상 수 부족', `강사 응답: ${numeric(report.videoCount, 0)}개 / 기준: ${policy.videoMinimum}개 이상`);
      if (report.consecutive === true) add(schedule, 'consecutive', 'consecutive', '연속 사진 가이드라인 위반', '강사가 연속 사진 2장 이상 촬영했다고 응답했습니다.');
      if (report.guideline === false) add(schedule, 'guideline', 'guideline', '가이드라인 미준수 응답', '강사가 촬영·보고서 가이드라인을 준수하지 못했다고 응답했습니다.');
    }
  }

  if (options.includeSimilarity !== false) {
  for (let i = 0; i < schedules.length; i++) {
    const left = schedules[i];
    if (normalized(left.report?.text).length < 30) continue;
    for (let j = i + 1; j < schedules.length; j++) {
      const right = schedules[j];
      if (left.id === right.id || sameCustomer(left, right)) continue;
      if (instant(left.start) === instant(right.start) && instant(left.end) === instant(right.end)) continue;
      if (normalized(right.report?.text).length < 30) continue;
      const score = similarity(left.report.text, right.report.text);
      if (score < policy.similarityThreshold) continue;
      for (const [currentSchedule, related] of [[left, right], [right, left]]) {
        add(currentSchedule, `similarity:${related.id}`, 'similarity', '다른 강습 보고서와 내용 유사', `다른 고객·다른 시간대의 보고서와 문자 패턴 유사도 ${Math.round(score * 100)}%입니다. 강사 확인과 관리자 검토가 필요합니다.`, { relatedScheduleId: related.id, score });
      }
    }
  }
  }
  return warnings;
}

function parseCSV(text) {
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (quoted) {
      if (character === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += character;
      continue;
    }
    if (character === '"') {
      if (field || afterQuote) throw new Error('따옴표 위치가 잘못되었습니다.');
      quoted = true;
    } else if (character === ',' || character === '\n' || character === '\r') {
      row.push(field);
      field = '';
      afterQuote = false;
      if (character !== ',') {
        if (character === '\r' && source[i + 1] === '\n') i++;
        if (row.some(value => value.trim())) records.push(row);
        row = [];
      }
    } else if (afterQuote) {
      if (!/\s/.test(character)) throw new Error('닫는 따옴표 뒤에 잘못된 문자가 있습니다.');
    } else field += character;
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있습니다.');
  row.push(field);
  if (row.some(value => value.trim())) records.push(row);
  return records;
}

const aliases = {
  id: ['일정id', '일정번호', 'id', 'scheduleid'],
  instructor: ['강사명', '강사', 'instructor', 'instructorname'],
  customer: ['고객명', '고객', '강습생', 'customer', 'customername'],
  phone: ['전화번호', '고객전화번호', '연락처', '고객연락처', '휴대폰', 'phone', 'customerphone'],
  date: ['날짜', '강습일', '강습날짜', 'date'],
  start: ['시작시간', '시작시각', '시작', 'start', 'starttime'],
  end: ['종료시간', '종료시각', '종료', 'end', 'endtime'],
};
const headerKey = value => String(value).trim().toLowerCase().replace(/[\s_-]/g, '');

function koreanDateTime(dateInput, timeInput) {
  const date = String(dateInput).trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  const time = String(timeInput).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!date || !time) throw new Error('날짜는 YYYY-MM-DD, 시간은 HH:mm 형식이어야 합니다.');
  const [, yearText, monthText, dayText] = date;
  const [year, month, day] = [yearText, monthText, dayText].map(Number);
  const [hour, minute, second] = [time[1], time[2], time[3] ?? 0].map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) throw new Error('유효하지 않은 날짜 또는 시간입니다.');
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) throw new Error('실제로 존재하지 않는 날짜입니다.');
  const pad = value => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+09:00`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

/** CSV import never mutates existing schedules; caller chooses merge behavior. */
export function parseScheduleCSV(text) {
  let records;
  try { records = parseCSV(text); }
  catch (error) { return { rows: [], errors: [`CSV 형식 오류: ${error.message}`] }; }
  if (records.length < 1) return { rows: [], errors: ['CSV 파일이 비어 있습니다.'] };
  const headers = records[0].map(headerKey);
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, choices]) => [key, headers.findIndex(value => choices.includes(value))]));
  const required = ['instructor', 'customer', 'date', 'start', 'end'];
  const missing = required.filter(key => columns[key] === -1);
  if (missing.length) return { rows: [], errors: [`필수 열이 없습니다: ${missing.map(key => aliases[key][0]).join(', ')}`] };
  const rows = [];
  const errors = [];
  const ids = new Set();
  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const value = key => (record[columns[key]] ?? '').trim();
    try {
      if (record.length !== headers.length) throw new Error(`열 개수가 헤더(${headers.length}개)와 다릅니다.`);
      if (!value('instructor') || !value('customer')) throw new Error('강사명과 고객명은 비워 둘 수 없습니다.');
      const start = koreanDateTime(value('date'), value('start'));
      const end = koreanDateTime(value('date'), value('end'));
      if (instant(end) <= instant(start)) throw new Error('종료시간은 같은 날의 시작시간보다 늦어야 합니다.');
      const phone = value('phone').replace(/[\s()-]/g, '');
      if (phone && !/^0\d{8,10}$/.test(phone)) throw new Error('전화번호는 0으로 시작하는 9~11자리 번호여야 합니다. 숫자 열의 앞자리 0을 확인해 주세요.');
      const instructor = value('instructor');
      const customer = value('customer');
      const id = value('id') || `csv-${stableHash([instructor, customer, start, end, phone].join('|'))}`;
      if (ids.has(id)) throw new Error(`중복 일정ID: ${id}`);
      ids.add(id);
      rows.push({ id, instructor, customer, phone, start, end, checkIn: null, checkOut: null, report: null, responses: {} });
    } catch (error) { errors.push(`${index + 1}행: ${error.message}`); }
  }
  if (records.length === 1) errors.push('헤더 아래에 일정 데이터가 없습니다.');
  return { rows, errors };
}
