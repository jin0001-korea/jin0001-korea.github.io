const escapeFallback = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const numberOf = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const rateOf = value => { const number=numberOf(value); return number !== null && number<=100 ? number : null; };
const integerOf = value => { const number=numberOf(value); return Number.isSafeInteger(number) ? number : null; };
const displayNumber = value => value === null ? '—' : new Intl.NumberFormat('ko-KR', {maximumFractionDigits:4}).format(value);
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z'));
const periodKey = row => `${row.period_start}/${row.period_end}`;
const dateText = value => String(value||'').replaceAll('-','.');
const timeText = value => {
  const date=new Date(value);
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date) : '—';
};
const sourceText = row => row.source_label || (row.source==='google_sheet' ? '구글시트' : row.source==='manual' ? '관리자 등록' : row.source || '출처 미등록');
const scoreText = row => {
  const score=numberOf(row?.satisfaction_score), scale=numberOf(row?.satisfaction_scale);
  return score===null ? '—' : scale!==null && scale>0 ? `${displayNumber(score)} / ${displayNumber(scale)}` : `${displayNumber(score)}점`;
};

/** Source performance remains separate from native five-star customer ratings. */
export function renderPerformance({role,profile={},metrics=[],roster=[],escapeHTML}={}) {
  const escape=typeof escapeHTML==='function' ? escapeHTML : escapeFallback;
  const admin=role==='admin', userId=profile.user_id||profile.id;
  const people=new Map((Array.isArray(roster)?roster:[]).filter(person=>person?.user_id).map(person=>[person.user_id,String(person.display_name||'강사')]));
  if(userId && !people.has(userId))people.set(userId,String(profile.display_name||'담당 강사'));
  const rows=(Array.isArray(metrics)?metrics:[]).filter(row=>row && validDate(row.period_start) && validDate(row.period_end) && row.period_end>=row.period_start && (admin || userId && row.instructor_user_id===userId)).sort((a,b)=>
    b.period_end.localeCompare(a.period_end)||b.period_start.localeCompare(a.period_start)||String(a.instructor_user_id).localeCompare(String(b.instructor_user_id))||String(b.source_updated_at||b.updated_at||'').localeCompare(String(a.source_updated_at||a.updated_at||''))
  );
  const latestKey=rows.length?periodKey(rows[0]):null;
  const latest=rows.filter(row=>periodKey(row)===latestKey);
  const history=rows.filter(row=>periodKey(row)!==latestKey);
  const own=admin?null:latest[0]||null;
  const period=latest.length?`${dateText(latest[0].period_start)} — ${dateText(latest[0].period_end)}`:'집계 기간 미등록';
  const card=(label,value,unit,detail,kind)=>`<article class="panel performance-kpi ${kind}"><span>${label}</span><strong>${value}${unit?`<small>${unit}</small>`:''}</strong><p>${detail}</p></article>`;
  const available=key=>new Set(latest.filter(row=>(key==='reorder_rate'?rateOf(row[key]):key==='reorder_count'?integerOf(row[key]):numberOf(row[key]))!==null).map(row=>row.instructor_user_id)).size;
  const adminDetail=key=>latest.length?`수치가 있는 강사 ${available(key)}명 · 아래 표에서 개별 확인`:'과거 집계 등록 후 표시';
  const cards=admin && latest.length
    ? card('시트 만족도','강사별','',adminDetail('satisfaction_score'),'satisfaction')+card('리오더 건수','강사별','',adminDetail('reorder_count'),'reorders')+card('리오더 비율','강사별','',adminDetail('reorder_rate'),'ratio')
    : card('시트 만족도',own?escape(scoreText(own)):'—','',own?'원본 시트의 점수·척도 그대로':'과거 집계 등록 후 표시','satisfaction')+card('리오더 건수',displayNumber(integerOf(own?.reorder_count)),own&&integerOf(own.reorder_count)!==null?'건':'',own?'원본 시트의 집계값':'과거 집계 등록 후 표시','reorders')+card('리오더 비율',displayNumber(rateOf(own?.reorder_rate)),own&&rateOf(own.reorder_rate)!==null?'%':'',own?'원본 시트의 비율 그대로':'과거 집계 등록 후 표시','ratio');
  const table=(records,caption)=>`<div class="table-wrap performance-table-wrap"><table class="performance-table"><caption>${caption}</caption><thead><tr>${admin?'<th scope="col">강사</th>':''}<th scope="col">집계 기간</th><th scope="col">시트 만족도</th><th scope="col">리오더 건수</th><th scope="col">리오더 비율</th><th scope="col">총 강습</th><th scope="col">출처</th><th scope="col">갱신 시각</th></tr></thead><tbody>${records.map(row=>`<tr>${admin?`<th scope="row">${escape(people.get(row.instructor_user_id)||'이름 미등록 강사')}</th>`:''}<td class="performance-period-cell">${dateText(row.period_start)}<br><span>— ${dateText(row.period_end)}</span></td><td class="performance-number">${escape(scoreText(row))}</td><td class="performance-number">${displayNumber(integerOf(row.reorder_count))}${integerOf(row.reorder_count)!==null?'<small> 건</small>':''}</td><td class="performance-number">${displayNumber(rateOf(row.reorder_rate))}${rateOf(row.reorder_rate)!==null?'<small> %</small>':''}</td><td class="performance-number">${displayNumber(integerOf(row.total_lessons))}${integerOf(row.total_lessons)!==null?'<small> 건</small>':''}</td><td>${escape(sourceText(row))}</td><td>${timeText(row.source_updated_at||row.updated_at)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<section class="performance-page" aria-labelledby="performance-heading"><div class="performance-section-head"><div><span class="performance-eyebrow">SHEET PERFORMANCE</span><h2 id="performance-heading">과거 만족도 · 리오더 집계</h2><p>이전 시즌의 원본 성과 자료를 같은 집계 기간으로 확인합니다. 예약의 Google Sheets 자동 기록과 별도이며, 고객 자유 의견은 표시하지 않습니다.</p></div><span class="performance-period">${escape(period)}</span></div><div class="performance-summary">${cards}</div><section class="panel performance-records"><div class="panel-head"><div><h3 class="panel-title">${admin?'강사별 실적':'나의 실적'}</h3><p class="performance-description">${latest.length?'가장 최근 집계 기간의 원본 수치입니다.':'이전 시즌의 집계 자료를 등록하면 표시됩니다.'}</p></div><span class="performance-source-status">${latest.length?'집계값 등록':'과거 집계 미등록'}</span></div>${latest.length?table(latest,'최근 기간의 강사별 만족도와 리오더 실적'):'<div class="performance-empty"><strong>아직 등록된 과거 성과 집계가 없습니다.</strong><p>현재 예약의 시트 자동 기록과 별도로, 이전 시즌의 만족도 점수·리오더 건수·비율을 등록하면 확인할 수 있습니다.</p><span>아직 받은 수치가 없으므로 0으로 표시하지 않습니다.</span></div>'}</section>${history.length?`<details class="panel performance-history"><summary>이전 집계 기간 보기 <span>${history.length}건</span></summary>${table(history,'이전 기간의 강사별 만족도와 리오더 실적')}</details>`:''}<p class="performance-note">시트 만족도는 원본의 5점·10점·100점 척도를 유지합니다. 리오더 비율은 원본 시트의 값을 표시하며 건수만으로 계산하지 않습니다. 빈 값은 ‘—’로 표시합니다.</p></section>`;
}
