import { getWarnings, reportDeadline } from './rules.mjs';
import { warningEvidenceMatches } from './warning-evidence.mjs?v=17';
import {schedulePaymentNeedsAttention,renderSchedulePayment} from './schedule-payment.mjs?v=2';

const escapeFallback = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const groups = [['proof','현장 인증'],['report','보고서'],['guidelines','가이드라인'],['evaluation','평가 · 확인']];
const groupKeys = groups.map(([key]) => key);
const initialFilters = { from:'', to:'', instructor:'', query:'', status:'all', sort:'desc', limit:200, groups:groupKeys };
const timeCategories = new Set(['late-start','upload-delay','short-duration']);
const guidelineCategories = new Set(['photos','videos','consecutive','guideline']);
const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
const koreaDayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const koreaTimeFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const validDate = value => value && Number.isFinite(new Date(value).getTime());
const day = value => validDate(value) ? koreaDayFormat.format(new Date(value)) : '';
const clock = value => validDate(value) ? koreaTimeFormat.format(new Date(value)) : '—';
const dateTime = value => validDate(value) ? `${day(value).slice(5).replace('-','.')} ${clock(value)}` : '—';
const scoreNumber = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5 ? Number(value) : null;
const safeURL = value => {try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;} catch{return null;}};
const settingsFor = filters => ({...initialFilters,...filters,groups:Array.isArray(filters?.groups)?filters.groups.filter(key=>groupKeys.includes(key)):groupKeys});

/** Decorate only authorized schedules. No free-text survey feedback is read. */
export function selectOverviewRows(state = {}, filters = {}, {role = 'admin', profile = state.profile || {}, now = new Date()} = {}) {
  const selected = settingsFor(filters);
  const schedules = (state.schedules || []).filter(lesson => role === 'admin' || profile.user_id && [lesson.instructorUserId,...(lesson.instructorUserIds || [])].includes(profile.user_id));
  // Cross-report comparisons come from persisted server alerts when available.
  // Single-lesson immediate checks stay linear even across years of schedules.
  const immediate=Array.isArray(state.alerts)?schedules.flatMap(lesson=>getWarnings([lesson],state.settings||{},now)):getWarnings(schedules,state.settings||{},now);
  const warningMap = new Map(immediate.map(warning=>[warning.id,warning]));
  for(const warning of state.alerts || []) {
    if(warning.active === false || warning.resolved_at || warning.resolvedAt) continue;
    const scheduleId=warning.scheduleId || warning.schedule_id;
    if(schedules.some(lesson=>lesson.id===scheduleId)) warningMap.set(warning.id,{...warning,scheduleId});
  }
  const warningBuckets=new Map();for(const warning of warningMap.values()){const bucket=warningBuckets.get(warning.scheduleId)||[];bucket.push(warning);warningBuckets.set(warning.scheduleId,bucket);}
  const scoreBuckets=new Map();for(const score of state.scores||[]){if(role!=='admin'&&score.instructor_user_id!==profile.user_id)continue;const value=scoreNumber(score.overall);if(value===null)continue;const bucket=scoreBuckets.get(score.schedule_id)||[];bucket.push(value);scoreBuckets.set(score.schedule_id,bucket);}
  const people=new Map((state.roster || []).map(person=>[person.user_id,person.display_name]));
  const rows=schedules.map(lesson=>{
    const instructorIds=[...new Set([lesson.instructorUserId,...(lesson.instructorUserIds || [])].filter(Boolean))];
    const instructorNames=instructorIds.length?instructorIds.map(id=>people.get(id)||(id===lesson.instructorUserId?lesson.instructor:'공동 강사')).filter(Boolean):[lesson.instructor || '미배정'];
    const warnings=warningBuckets.get(lesson.id)||[];
    const scores=scoreBuckets.get(lesson.id)||[];
    const submitted=lesson.report?.submittedAt;
    const deadline=reportDeadline(lesson);
    const ended=validDate(lesson.end)&&new Date(lesson.end)<new Date(now);
    const overdue=!lesson.report && validDate(deadline)&&new Date(now)>deadline;
    const duration=validDate(lesson.checkIn?.eventAt)&&validDate(lesson.checkOut?.eventAt)?Math.round((new Date(lesson.checkOut.eventAt)-new Date(lesson.checkIn.eventAt))/60000):null;
    let responses=0,reviews=0;
    for(const warning of warnings){
      const response=lesson.responses?.[warning.id],review=lesson.reviews?.[warning.id];
      const matching=Array.isArray(response)?response:response?[response]:[];
      if(matching.some(item=>warningEvidenceMatches(warning,item.evidence)&&(role==='admin'||!item.by||item.by===profile.user_id)))responses++;
      if(review&&['confirmed','dismissed'].includes(review.result)&&warningEvidenceMatches(warning,review.evidence))reviews++;
    }
    return {lesson,id:lesson.id,date:day(lesson.start),start:lesson.start,end:lesson.end,customer:lesson.customer,instructorIds,instructorNames,instructorText:instructorNames.join(' · '),warnings,warningCount:warnings.length,responses,reviews,ended,overdue,deadline,submitted,duration,score:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null,scoreCount:scores.length};
  });
  return rows.filter(row=>{
    if(selected.from&&row.date<selected.from)return false;
    if(selected.to&&row.date>selected.to)return false;
    if(selected.instructor==='__unassigned'&&row.instructorIds.length)return false;
    if(selected.instructor&&selected.instructor!=='__unassigned'&&!row.instructorIds.includes(selected.instructor))return false;
    if(selected.query&&!normalized(`${row.customer} ${row.instructorText} ${row.id}`).includes(normalized(selected.query)))return false;
    if(selected.status==='unregistered'&&(!row.ended||row.lesson.report))return false;
    if(selected.status==='overdue'&&!row.overdue)return false;
    if(selected.status==='time'&&!row.warnings.some(w=>timeCategories.has(w.category)))return false;
    if(selected.status==='missing'&&!row.warnings.some(w=>String(w.category).startsWith('missing-check')))return false;
    if(selected.status==='guidelines'&&!row.warnings.some(w=>guidelineCategories.has(w.category)))return false;
    if(selected.status==='warnings'&&!row.warningCount)return false;
    return true;
  }).sort((a,b)=>{
    const delta=(new Date(a.start).getTime()||0)-(new Date(b.start).getTime()||0);
    return (selected.sort==='asc'?delta:-delta)||String(a.id).localeCompare(String(b.id),'ko');
  });
}

const coreColumns = [
  {key:'date',label:'강습일',className:'ov-date',value:row=>row.date},
  {key:'time',label:'시작 — 종료',className:'ov-time',value:row=>`${clock(row.start)} — ${clock(row.end)}`},
  {key:'customer',label:'고객',className:'ov-customer',value:row=>row.customer},
  {key:'instructor',label:'담당 강사',className:'ov-instructor',value:row=>row.instructorText},
  {key:'id',label:'일정 ID',className:'ov-id',value:row=>row.id},
];
const extraColumns = [
  {group:'proof',key:'meet',label:'만남 실제 / 업로드',value:row=>`${dateTime(row.lesson.checkIn?.eventAt)} / ${dateTime(row.lesson.checkIn?.uploadedAt)}`},
  {group:'proof',key:'leave',label:'헤어짐 실제 / 업로드',value:row=>`${dateTime(row.lesson.checkOut?.eventAt)} / ${dateTime(row.lesson.checkOut?.uploadedAt)}`},
  {group:'proof',key:'duration',label:'실제 강습시간',value:row=>row.duration===null?'':row.duration},
  {group:'report',key:'deadline',label:'보고서 마감',value:row=>validDate(row.deadline)?`${day(row.deadline)} ${clock(row.deadline)}`:''},
  {group:'report',key:'submitted',label:'보고서 등록',value:row=>validDate(row.submitted)?`${day(row.submitted)} ${clock(row.submitted)}`:''},
  {group:'report',key:'link',label:'카페 링크',value:row=>safeURL(row.lesson.report?.link)||''},
  {group:'guidelines',key:'photos',label:'사진 수 (응답)',value:row=>row.lesson.report?.photoCount??''},
  {group:'guidelines',key:'videos',label:'영상 수 (응답)',value:row=>row.lesson.report?.videoCount??''},
  {group:'guidelines',key:'consecutive',label:'연속 촬영 응답',value:row=>typeof row.lesson.report?.consecutive==='boolean'?(row.lesson.report.consecutive?'있음':'없음'):''},
  {group:'guidelines',key:'guideline',label:'가이드라인 응답',value:row=>typeof row.lesson.report?.guideline==='boolean'?(row.lesson.report.guideline?'준수':'미준수'):''},
  {group:'evaluation',key:'warnings',label:'확인 경고',value:row=>row.warningCount},
  {group:'evaluation',key:'responses',label:'강사 응답 / 항목',value:row=>`${row.responses} / ${row.warningCount}`},
  {group:'evaluation',key:'reviews',label:'관리자 검토 / 항목',value:row=>`${row.reviews} / ${row.warningCount}`},
  {group:'evaluation',key:'score',label:'고객 평점 (5점)',value:row=>row.score===null?'':row.score.toFixed(1)},
];
const columnsFor = visible => [...coreColumns,...extraColumns.filter(column=>visible.includes(column.group))];
const csvCell = value => {let text=String(value??'');if(/^(?:\s*[=+@-]|[\t\r])/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};

/** Export exactly the filtered/visible table; Excel formula prefixes are neutralized. */
export function exportOverviewCSV(rows, visibleGroups = groupKeys) {
  const columns=columnsFor(visibleGroups);
  return '\uFEFF'+[columns.map(column=>column.label),...rows.map(row=>columns.map(column=>column.value(row)))].map(values=>values.map(csvCell).join(',')).join('\r\n');
}

function rowCell(row,column,escape) {
  const report=row.lesson.report;
  const badge=(value,type='neutral')=>`<span class="ov-badge ${type}">${escape(value)}</span>`;
  if(column.key==='date')return `<strong>${escape(row.date||'—')}</strong>`;
  if(column.key==='customer')return `<strong>${escape(row.customer||'—')}</strong><small>${escape(row.lesson.level||'스키 강습')}</small>${renderSchedulePayment(row.lesson,{compact:true,escapeHTML:escape})}`;
  if(column.key==='instructor')return `<span>${escape(row.instructorText)}</span>${row.instructorIds.length>1?'<small>공동 강습</small>':!row.instructorIds.length?'<small class="ov-attention">계정 미배정</small>':''}`;
  if(column.key==='meet'||column.key==='leave') {const proof=row.lesson[column.key==='meet'?'checkIn':'checkOut'];return proof?`<strong>${dateTime(proof.eventAt)}</strong><small>업로드 ${dateTime(proof.uploadedAt)}</small>`:'<span class="ov-empty">미등록</span>';}
  if(column.key==='duration')return row.duration===null?'—':`${row.duration}<small>분${row.duration<0?' · 시각 확인':''}</small>`;
  if(column.key==='deadline')return `<span>${dateTime(row.deadline)}</span>${row.overdue?badge('기한 초과','danger'):!report&&row.ended?'<small>등록 대기</small>':''}`;
  if(column.key==='submitted')return report?`<span>${dateTime(row.submitted)}</span>${validDate(row.submitted)&&new Date(row.submitted)>row.deadline?badge('지연 등록','warning'):badge('등록 완료','success')}`:badge(row.ended?'미등록':'강습 예정',row.ended?'warning':'neutral');
  if(column.key==='link'){const url=safeURL(report?.link);return url?`<a class="ov-cafe-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(row.customer)} 고객 카페 게시물 열기">카페 열기 ↗</a>`:'—';}
  if(column.key==='photos'||column.key==='videos')return report?`<span title="카페 게시물의 촬영 수에 대한 강사 직접 응답입니다.">${escape(column.value(row))}<small>${column.key==='photos'?'장':'개'}</small></span>`:'—';
  if(column.key==='consecutive')return typeof report?.consecutive==='boolean'?badge(report.consecutive?'있음':'없음',report.consecutive?'warning':'success'):'—';
  if(column.key==='guideline')return typeof report?.guideline==='boolean'?badge(report.guideline?'준수':'미준수',report.guideline?'success':'warning'):'—';
  if(column.key==='warnings')return row.warningCount?badge(row.warningCount+'건',row.warnings.some(w=>w.severity==='danger')?'danger':'warning'):badge('0건','success');
  if(column.key==='responses'||column.key==='reviews')return row.warningCount?`<span title="경고 항목 수 기준입니다.">${column.key==='responses'?row.responses:row.reviews} <span class="ov-empty">/ ${row.warningCount}</span></span>`:'<span class="ov-empty">대상 없음</span>';
  if(column.key==='score')return row.score===null?'<span class="ov-empty">응답 없음</span>':`<strong class="ov-score">${row.score.toFixed(1)}</strong><small>${row.scoreCount}건 응답</small>`;
  return escape(column.value(row)||'—');
}

export function renderOverview({state = {},ui = {},escapeHTML,now = new Date()} = {}) {
  const escape=typeof escapeHTML==='function'?escapeHTML:escapeFallback;
  const filters=settingsFor(ui.overview);
  const options={role:ui.role||state.profile?.role||'instructor',profile:state.profile,now};
  const all=selectOverviewRows(state,{},options),rows=selectOverviewRows(state,filters,options),columns=columnsFor(filters.groups);
  const shown=rows.slice(0,Math.max(200,Number(filters.limit)||200));
  const people=(state.roster||[]).filter(person=>person.role==='instructor');
  const presets=[['all','전체'],['unregistered','보고서 미등록'],['overdue','기한 초과'],['time','시간 확인'],['guidelines','가이드라인'],['warnings','모든 경고']];
  return `<section class="overview-page" aria-label="강습 통합 현황"><div class="panel ov-filter-panel"><form class="ov-filter-form" aria-label="현황표 조회 조건"><label class="ov-field"><span>시작일</span><input type="date" name="from" value="${escape(filters.from)}" aria-label="조회 시작일"></label><label class="ov-field"><span>종료일</span><input type="date" name="to" value="${escape(filters.to)}" aria-label="조회 종료일"></label>${options.role==='admin'?`<label class="ov-field ov-person-filter"><span>담당 강사</span><select name="instructor" aria-label="담당 강사 필터"><option value="">모든 강사</option><option value="__unassigned" ${filters.instructor==='__unassigned'?'selected':''}>계정 미배정</option>${people.map(person=>`<option value="${escape(person.user_id)}" ${filters.instructor===person.user_id?'selected':''}>${escape(person.display_name)}</option>`).join('')}</select></label>`:''}<label class="ov-field ov-query"><span>검색</span><input name="query" type="search" value="${escape(filters.query)}" placeholder="고객명 · 강사명 · 일정 ID" aria-label="통합 현황 검색"></label><label class="ov-field"><span>정렬</span><select name="sort" aria-label="강습 정렬"><option value="desc" ${filters.sort==='desc'?'selected':''}>최근 강습부터</option><option value="asc" ${filters.sort==='asc'?'selected':''}>이른 강습부터</option></select></label><button class="btn primary" type="submit">조회</button><button class="btn ghost" type="button" data-overview-reset>초기화</button></form><div class="ov-presets" aria-label="빠른 조회">${presets.map(([id,label])=>`<button type="button" data-overview-status="${id}" class="${filters.status===id?'active':''}" aria-pressed="${filters.status===id}">${label}</button>`).join('')}<button type="button" data-overview-status="missing" class="${filters.status==='missing'?'active':''}" aria-pressed="${filters.status==='missing'}">현장 사진 누락</button></div></div><section class="panel ov-table-panel"><div class="ov-table-head"><div><h2>강습 전체 현황 <span>${rows.length}<small> / ${all.length}건</small></span></h2><p>한 행에 한 강습을 표시합니다. 사진·영상 수와 가이드라인은 강사 응답 기준입니다.</p></div>${options.role==='admin'?'<button class="btn secondary small" type="button" data-overview-export>현재 표 CSV 내보내기</button>':''}</div><div class="ov-column-toolbar"><strong>표시할 항목</strong><span class="ov-core-label">일정 기본 정보</span>${groups.map(([key,label])=>`<label><input type="checkbox" data-overview-group="${key}" ${filters.groups.includes(key)?'checked':''}>${label}</label>`).join('')}<span class="ov-scroll-hint">좌우로 이동해 모든 항목을 확인하세요 ↔</span></div><div class="ov-scroll" tabindex="0" role="region" aria-label="가로 스크롤 강습 현황표"><table class="ov-table"><caption class="ov-sr-only">한국 시간 기준 강습 ${rows.length}건의 일정, 현장 인증, 보고서, 강사 응답과 고객 평점</caption><thead><tr>${columns.map(column=>`<th scope="col" class="${column.className||''}">${escape(column.label)}</th>`).join('')}<th scope="col" class="ov-action">상세</th></tr></thead><tbody>${shown.map(row=>`<tr class="${row.overdue?'ov-row-overdue':''}${schedulePaymentNeedsAttention(row.lesson)?' schedule-payment-due':''}">${columns.map(column=>`<td class="${column.className||''}">${rowCell(row,column,escape)}</td>`).join('')}<td class="ov-action"><button class="btn ghost small" type="button" data-overview-detail="${escape(row.id)}" aria-label="${escape(row.customer)} 고객 ${escape(row.id)} 강습 상세">상세 →</button></td></tr>`).join('')||`<tr><td class="ov-empty-row" colspan="${columns.length+1}"><strong>조건에 맞는 강습이 없습니다.</strong><p>조회 기간이나 빠른 조회 조건을 변경해 주세요.</p></td></tr>`}</tbody></table></div>${shown.length<rows.length?`<div class="ov-load-more"><span>${shown.length} / ${rows.length}건 표시 · CSV는 조회된 전체 행을 내보냅니다.</span><button class="btn secondary small" type="button" data-overview-more>200건 더 보기</button></div>`:''}<div class="ov-table-footer"><span>모든 시간은 한국 시간(KST) · 마감은 예정 종료 후 48시간</span><span>평점은 해당 강습의 고객 별점입니다.</span></div></section></section>`;
}

/** Bind only this view's controls; no global listeners or scheduled work. */
export function bindOverview(root,{state,ui = {},onOpenLesson,onChange} = {}) {
  const view=root.querySelector('.overview-page');if(!view)return;
  const update=changes=>{ui.overview={...settingsFor(ui.overview),limit:200,...changes};if(onChange)onChange(ui.overview);else {view.outerHTML=renderOverview({state,ui});bindOverview(root,{state,ui,onOpenLesson});}};
  view.querySelector('.ov-filter-form').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);const from=String(form.get('from')||''),to=String(form.get('to')||'');if(from&&to&&from>to){event.currentTarget.elements.namedItem('to').setCustomValidity('종료일은 시작일 이후로 선택해 주세요.');event.currentTarget.reportValidity();return;}event.currentTarget.elements.namedItem('to').setCustomValidity('');update({from,to,instructor:String(form.get('instructor')||''),query:String(form.get('query')||'').trim(),sort:String(form.get('sort')||'desc')});});
  view.querySelectorAll('.ov-filter-form [name="from"],.ov-filter-form [name="to"]').forEach(input=>input.addEventListener('input',()=>view.querySelector('[name="to"]').setCustomValidity('')));
  view.querySelectorAll('[data-overview-status]').forEach(button=>button.addEventListener('click',()=>update({status:button.dataset.overviewStatus})));
  view.querySelector('[data-overview-more]')?.addEventListener('click',()=>update({limit:(Number(ui.overview?.limit)||200)+200}));
  view.querySelector('[data-overview-reset]').addEventListener('click',()=>update({...initialFilters,groups:[...groupKeys]}));
  view.querySelectorAll('[data-overview-group]').forEach(input=>input.addEventListener('change',()=>update({groups:[...view.querySelectorAll('[data-overview-group]:checked')].map(element=>element.dataset.overviewGroup)})));
  view.querySelectorAll('[data-overview-detail]').forEach(button=>button.addEventListener('click',()=>onOpenLesson?.(button.dataset.overviewDetail)));
  view.querySelector('[data-overview-export]')?.addEventListener('click',()=>{if((ui.role||state.profile?.role)!=='admin')return;const filters=settingsFor(ui.overview),rows=selectOverviewRows(state,filters,{role:ui.role||state.profile?.role,profile:state.profile});const blob=new Blob([exportOverviewCSV(rows,filters.groups)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`SLOPE-통합현황-${day(new Date())}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
}
