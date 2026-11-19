const fallbackEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const categories = [
  ['kindness', '친절도'],
  ['communication', '설명·전달력'],
  ['safety', '안전관리'],
  ['lesson', '강습 만족도'],
];

const validScore = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^[1-5]$/.test(value))) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
};
const average = (rows, key) => {
  const values = rows.map(row => validScore(row[key])).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const formattedScore = value => value === null ? '—' : value.toFixed(1);
const stars = value => `<span class="score-stars" aria-label="${value === null ? '아직 평점이 없습니다' : `5점 만점 중 ${formattedScore(value)}점`}"><span aria-hidden="true">★★★★★</span><span class="score-stars-fill" style="width:${value === null ? 0 : Math.max(0, Math.min(100, value * 20))}%" aria-hidden="true">★★★★★</span></span>`;
const dateLabel = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date) : '—';
};
const ratingCell = value => {
  const number = validScore(value);
  return number === null ? '<span class="score-unavailable">—</span>' : `<span class="score-table-number">${number}<small>점</small></span>`;
};

const BRAND_LABELS = { catchski: '캐치', risenski: '라이즌' };
// 설문 칭찬 글의 사이트 공개 상태 셀 — 공개 전엔 브랜드 버튼, 공개 후엔 내리기 버튼.
const publishCell = (escape, info) => {
  if (!info || !info.praise) return '<span class="score-unavailable">—</span>';
  return ['catchski', 'risenski'].map(brand => {
    const published = (info.publishedBrands || []).includes(brand);
    return `<button type="button" class="score-publish-btn${published ? ' is-on' : ''}" data-review-${published ? 'unpublish' : 'publish'}="${escape(info.scoreId)}:${brand}" title="${published ? '클릭하면 사이트에서 내립니다' : '클릭하면 해당 사이트 후기 위젯에 고객이 쓴 그대로 게시됩니다'}">${BRAND_LABELS[brand]}${published ? ' ✓' : ''}</button>`;
  }).join(' ');
};

/** Render only numeric customer ratings and their aggregates. */
export function renderScorePage({ role, profile = {}, scores = [], roster = [], schedules = [], reviewPublish = null, escapeHTML } = {}) {
  const escape = typeof escapeHTML === 'function' ? escapeHTML : fallbackEscape;
  const admin = role === 'admin';
  const userId = profile.user_id || profile.id || null;
  const rows = Array.isArray(scores) ? scores.filter(row => row && validScore(row.overall) !== null && (admin || userId && row.instructor_user_id === userId)) : [];
  const people = Array.isArray(roster) ? roster : [];
  const lessons = Array.isArray(schedules) ? schedules : [];
  const overall = average(rows, 'overall');
  const evaluatedLessons = new Set(rows.map(row => row.schedule_id).filter(Boolean)).size;
  const names = new Map(people.filter(person => person?.user_id).map(person => [person.user_id, String(person.display_name || '강사')]));
  if (userId && !names.has(userId)) names.set(userId, String(profile.display_name || '담당 강사'));
  const scheduleById = new Map(lessons.filter(lesson => lesson?.id).map(lesson => [lesson.id, lesson]));
  const recent = [...rows].sort((left, right) => {
    const a = new Date(left.submitted_at).getTime();
    const b = new Date(right.submitted_at).getTime();
    return (Number.isFinite(b) ? b : 0) - (Number.isFinite(a) ? a : 0);
  }).slice(0, 20);
  const instructorIds = [...new Set([
    ...people.filter(person => person?.role === 'instructor').map(person => person.user_id),
    ...rows.map(row => row.instructor_user_id),
  ].filter(Boolean))];

  const summary = `<section class="score-overview" aria-label="고객 평가 요약"><article class="panel score-summary"><span class="score-eyebrow">CUSTOMER RATINGS</span><h2>${admin ? '전체 고객 종합 평점' : `${escape(profile.display_name || '담당 강사')} 강사님의 종합 평점`}</h2><div class="score-overall-value">${formattedScore(overall)}<small>/ 5점</small></div>${stars(overall)}<p class="score-summary-meta">고객 응답 <strong>${rows.length}건</strong><span></span>평가된 강습 <strong>${evaluatedLessons}건</strong></p></article><section class="panel score-categories"><div class="panel-head"><h2 class="panel-title">항목별 평점</h2><span class="score-scale">5점 만점</span></div><div class="score-category-grid">${categories.map(([key, label]) => {
    const value = average(rows, key);
    return `<div class="score-category"><div class="score-category-top"><span>${label}</span><strong>${formattedScore(value)}<small>점</small></strong></div><div class="score-meter" aria-label="${label} ${value === null ? '응답 없음' : `${formattedScore(value)}점`}"><i style="width:${value === null ? 0 : value * 20}%"></i></div></div>`;
  }).join('')}</div></section></section>`;

  const instructorCards = admin ? `<section class="score-instructors"><div class="score-section-head"><h2>강사별 고객 평가</h2><span>${instructorIds.length}명</span></div>${instructorIds.length ? `<div class="score-instructor-grid">${instructorIds.map(id => {
    const individual = rows.filter(row => row.instructor_user_id === id);
    const value = average(individual, 'overall');
    return `<article class="panel score-instructor-card"><div class="score-instructor-top"><span class="score-instructor-avatar" aria-hidden="true">${escape((names.get(id) || '강사').slice(-2))}</span><div><h3>${escape(names.get(id) || '이름 미등록 강사')}</h3><span>고객 응답 ${individual.length}건</span></div></div><div class="score-instructor-rating"><strong>${formattedScore(value)}<small>/ 5</small></strong>${stars(value)}</div><div class="score-instructor-categories">${categories.map(([key, label]) => `<div><span>${label}</span><strong>${formattedScore(average(individual, key))}</strong></div>`).join('')}</div></article>`;
  }).join('')}</div>` : '<div class="panel score-empty"><span class="score-empty-mark" aria-hidden="true">☆</span><strong>등록된 강사 계정이 없습니다.</strong><p>강사 계정을 발급하고 일정을 배정해 주세요.</p></div>'}</section>` : '';

  // 사이트 공개(admin 전용): 설문 칭찬 글을 캐치/라이즌 후기 위젯에 게시한다 —
  // 별도 화면 없이 이 표의 열 두 개로 끝낸다(2026-11-20 사용자 확정).
  const publishInfo = admin && reviewPublish ? reviewPublish : null;
  const publishColumns = publishInfo ? '<th>후기</th><th>사이트 공개</th>' : '';
  const publishCells = row => {
    if (!publishInfo) return '';
    const info = publishInfo.byScoreId?.[row.id];
    const praise = info?.praise || '';
    const shortPraise = praise.length > 24 ? praise.slice(0, 24) + '…' : praise;
    return `<td class="score-praise" title="${escape(praise)}">${praise ? escape(shortPraise) : '<span class="score-unavailable">—</span>'}</td><td class="score-publish">${publishCell(escape, info ? { ...info, scoreId: row.id } : null)}</td>`;
  };
  const publishNotice = publishInfo ? `<div class="score-publish-foot">${publishInfo.error ? `<span class="score-publish-error">${escape(publishInfo.error)}</span>` : publishInfo.notice ? `<span class="score-publish-ok">${escape(publishInfo.notice)}</span>` : ''}<span class="score-publish-hint">공개 버튼을 누르면 고객이 쓴 그대로 사이트 후기 위젯에 게시됩니다.</span><button type="button" class="btn-ghost" data-review-jsonld="catchski">캐치 JSON-LD 복사</button><button type="button" class="btn-ghost" data-review-jsonld="risenski">라이즌 JSON-LD 복사</button></div>` : '';
  const recentRatings = `<section class="panel score-recent"><div class="panel-head"><div><h2 class="panel-title">최근 고객 평가</h2><p class="score-panel-description">${recent.length ? `최근 ${recent.length}건의 항목별 점수입니다.` : '고객이 응답한 강습 평가가 이곳에 표시됩니다.'}</p></div><span class="score-scale">총 ${rows.length}건</span></div>${recent.length ? `<div class="table-wrap"><table class="score-table"><thead><tr>${admin ? '<th>담당 강사</th>' : ''}<th>강습일</th><th>응답일</th><th>종합</th>${categories.map(([, label]) => `<th>${label}</th>`).join('')}${publishColumns}</tr></thead><tbody>${recent.map(row => {
    const schedule = scheduleById.get(row.schedule_id);
    return `<tr>${admin ? `<td class="score-table-person">${escape(names.get(row.instructor_user_id) || '이름 미등록 강사')}</td>` : ''}<td>${dateLabel(schedule?.start || schedule?.start_at)}</td><td>${dateLabel(row.submitted_at)}</td><td class="score-table-overall">${ratingCell(row.overall)}</td>${categories.map(([key]) => `<td>${ratingCell(row[key])}</td>`).join('')}${publishCells(row)}</tr>`;
  }).join('')}</tbody></table></div>${publishNotice}` : `<div class="score-empty"><span class="score-empty-mark" aria-hidden="true">☆</span><strong>고객 응답이 쌓이면 점수가 표시됩니다.</strong><p>평가가 등록되면 종합 평점과 항목별 점수를 확인할 수 있습니다.${publishInfo ? ' 후기(칭찬 글)가 함께 접수되면 이 표에서 바로 캐치스키·라이즌 사이트로 공개할 수 있습니다.' : ''}</p></div>`}</section>`;

  return `<div class="score-page">${summary}${instructorCards}${recentRatings}</div>`;
}
