const MAX_PARTICIPANTS = 1000;
const blank = () => ({type:'', age:null});
const objectRow = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unanswered = value => value === null || value === undefined || typeof value === 'string' && value.trim() === '';

function integer(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function participantCount(value) {
  const count = integer(value);
  return count !== null && count >= 1 && count <= MAX_PARTICIPANTS ? count : null;
}

function minorAge(value) {
  const age = enteredAge(value);
  // Booking ages use the owner's Korean school-age convention (고3 = 19).
  return age !== null && Number.isInteger(age) && age >= 1 && age <= 19 ? age : null;
}

function enteredAge(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))) return null;
  const age = Number(value);
  return Number.isFinite(age) ? age : null;
}

function normalizedRow(value) {
  if (!objectRow(value)) return blank();
  const type = value.type === 'adult' || value.type === 'minor' ? value.type : '';
  return {type, age:type === 'minor' ? enteredAge(value.age) : null};
}

/** Missing legacy participant details remain unanswered; a shared age is never copied. */
export function normalizeParticipants(value, count) {
  const source = Array.isArray(value) ? value : [];
  const size = participantCount(count === undefined ? source.length : count);
  if (size === null) return [];
  return Array.from({length:size}, (_, index) => normalizedRow(source[index]));
}

/** Return independent rows while retaining the first N answers during a size change. */
export function resizeParticipants(value, count) {
  return normalizeParticipants(value, count);
}

export function participantValidationError(value, count) {
  const size = participantCount(count);
  if (size === null) return '강습 인원을 1명 이상 1000명 이하의 정수로 입력해 주세요.';
  if (!Array.isArray(value) || value.length !== size) return '강습 인원과 참가자 정보 수를 확인해 주세요.';
  for (let index = 0; index < value.length; index++) {
    const row = value[index], label = `${index + 1}번째 참가자`;
    // 2026-11-16 운영 결정: 성인·미성년 구분도 선택 입력 — 미선택('')이면 미확인으로 저장한다.
    if (!objectRow(row) || !['adult','minor',''].includes(row.type ?? '')) return `${label}의 성인·미성년 구분을 확인해 주세요.`;
    // 나이는 선택 입력(2026-11-15 운영 결정) — 적으면 1~19세 검증, 비우면 통과.
    if (row.type === 'minor' && !unanswered(row.age) && minorAge(row.age) === null) return `${label}의 나이를 1~19세 사이의 정수로 입력해 주세요.`;
    if (row.type === 'adult' && !unanswered(row.age)) return `${label}는 성인으로 선택되어 있어 나이를 입력하지 않습니다.`;
  }
  return '';
}

/** Expose only participant categories and ages, never unrelated source properties. */
export function participantSummary(value) {
  const rows = normalizeParticipants(value);
  if (!rows.length) return '참가자 미확인';
  const adults = rows.filter(row => row.type === 'adult').length;
  const minors = rows.filter(row => row.type === 'minor');
  const missing = rows.length - adults - minors.length;
  const ages = minors.map(row => row.age === null ? '나이 미입력' : `${row.age}세`).join(', ');
  return [adults ? `성인 ${adults}명` : '', minors.length ? `미성년 ${minors.length}명(${ages})` : '', missing ? `구분 미입력 ${missing}명` : ''].filter(Boolean).join(' · ');
}

/** The youngest known minor controls age eligibility; incomplete rows remain unknown. */
export function participantAgeDetails(value) {
  const hasParticipants = Array.isArray(value) && value.length > 0;
  if (!hasParticipants) return {age:null, ageBand:null, known:false, invalid:!unanswered(value) && !Array.isArray(value), hasParticipants:false};
  if (value.length > MAX_PARTICIPANTS) return {age:null, ageBand:null, known:false, invalid:true, hasParticipants:true};
  let known = true, invalid = false, adults = 0;
  const ages = [];
  for (const row of value) {
    if (!objectRow(row)) {known = false; invalid = true; continue;}
    if (row.type === 'adult') {
      adults++;
      if (!unanswered(row.age)) {known = false; invalid = true;}
    } else if (row.type === 'minor') {
      const age = minorAge(row.age);
      if (age !== null) ages.push(age);
      else {known = false; if (!unanswered(row.age)) invalid = true;}
    } else {
      known = false;
      if (!unanswered(row.type) || !unanswered(row.age)) invalid = true;
    }
  }
  const age = ages.length ? Math.min(...ages) : null;
  return {age, ageBand:known && adults === value.length ? 'adult' : null, known:known && !invalid, invalid, hasParticipants:true};
}
