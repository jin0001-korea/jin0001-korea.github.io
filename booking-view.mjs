import { RAW_COLUMNS, parseKstDate, parseLessonInterval, expertRequirement, evaluateCandidates } from './booking-rules.mjs';

const fallbackEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1SdQoy71Dp2YUTlOYXMjP57gJ6D_fR7SdfWVDhCSk4N4/edit?gid=1274546051#gid=1274546051';
const kinds = {single:'일반',reorder:'리오더',season:'시즌 강습'};
const weekdays = ['일','월','화','수','목','금','토'];
const day = date => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
const numeric = value => value === '' || value === null || value === undefined ? null : Number.isFinite(Number(String(value).replaceAll(',',''))) ? Number(String(value).replaceAll(',','')) : null;
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values.filter(Boolean))];
const initials = value => String(value || '').slice(-2);
const option = (value,label,selected,escape) => `<option value="${escape(value)}" ${String(value)===String(selected)?'selected':''}>${escape(label)}</option>`;
const badge = (value,type='neutral',escape=fallbackEscape) => `<span class="bk-badge ${type}">${escape(value)}</span>`;
const dateText = value => {const parsed=parseKstDate(value);return parsed?`${parsed.slice(5).replace('-','.')} (${weekdays[new Date(`${parsed}T12:00:00+09:00`).getUTCDay()]})`:String(value||'—');};
const money = value => numeric(value)===null ? '—' : new Intl.NumberFormat('ko-KR').format(numeric(value));
const clone = value => JSON.parse(JSON.stringify(value));

function selectedIds(row,schedules=[]) {
  const schedule=schedules.find(item=>item.id===(row.schedule_id||row.scheduleId||row.id));
  return unique([...(row.instructorIds||row.instructor_ids||row.instructor_user_ids||[]),row.instructor_user_id,...(schedule?.instructorUserIds||[]),schedule?.instructorUserId]);
}

/** Retain the source columns verbatim; reservation metadata never replaces a raw cell. */
export function normalizeBookingRow(row={},state={}) {
  const raw={};for(const column of RAW_COLUMNS)raw[column.key]=row.raw?.[column.key]??row.raw_data?.[column.key]??'';
  return {...row,id:row.id||row.schedule_id||row.scheduleId||'',raw,
    age:row.age??null,experienceCount:row.experienceCount??row.experience_count??null,
    parallelLongTurn:row.parallelLongTurn??row.parallel_long_turn??null,
    kind:row.kind||'single',isReorder:row.isReorder??row.is_reorder??row.kind==='reorder',designated:row.designated===true,
    preferredInstructorId:row.preferredInstructorId??row.preferred_instructor_user_id??null,
    seasonId:row.seasonId??row.season_id??null,seasonTotal:row.seasonTotal??row.season_total??(state.seasonPackages||[]).find(pack=>pack.id===(row.seasonId??row.season_id))?.total_sessions??null,
    sessionNumber:row.sessionNumber??row.session_number??null,
    instructorIds:selectedIds(row,state.schedules),status:row.status||'received',
    expectedUpdatedAt:row.expectedUpdatedAt??row.updated_at??row.updatedAt??null};
}

function bookingState(state,ui,now) {
  const existing=ui.booking||{};
  const settings={date:'',company:'all',sport:'all',kind:'all',assignment:'all',query:'',limit:150,demo:!(state.reservations||[]).length,drawer:null,tab:'intake',...existing};
  if(settings.demo&&!settings.demoData)settings.demoData=createBookingDemo(now);
  ui.booking=settings;
  return settings;
}

/** Fictional examples stay in the page state. They are never written to the server. */
export function createBookingDemo(now=new Date()) {
  const base=new Date(`${day(now)}T12:00:00+09:00`);base.setDate(base.getDate()+1);
  const date=day(base),next=day(new Date(base.getTime()+86400000));
  const roster=[
    {user_id:'DEMO-SNOW-A',display_name:'체험 · 김설원',role:'instructor',active:true},
    {user_id:'DEMO-SNOW-B',display_name:'체험 · 이다온',role:'instructor',active:true},
    {user_id:'DEMO-SNOW-C',display_name:'체험 · 박하늘',role:'instructor',active:true},
  ];
  const capability=(person,expert,sports)=>({instructor_user_id:person.user_id,is_experienced:expert,verified:true,sports,locations:['곤지암','지산','비발디']});
  const make=(id,time,student,extra={})=>({id,raw:{A:date,B:time,C:`${String(Number(time.split(':')[0])+2).padStart(2,'0')}:${time.split(':')[1]}`,D:'스키',E:'라이즌 곤지암',F:'',G:'체험용 예시 예약입니다.',H:`체험 보호자 ${id.slice(-1)}`,I:student,J:'1회',K:'자녀',L:'',M:'1',N:'2시간',O:'입문',P:'',Q:'계좌이체',R:'',S:'',T:'149000',U:'',V:'',W:'',X:'149000',Y:'149000',Z:'0',AA:'1',AB:'',AC:'',AD:'',AE:'',AF:''},age:10,experience_count:0,parallel_long_turn:false,kind:'single',designated:false,instructorIds:[],status:'received',sheet_status:'not_connected',...extra});
  const seasonId='DEMO-SEASON-001';
  const rows=[
    make('DEMO-BOOKING-1','09:00','체험 강습생 A · 7세',{age:7,raw:undefined}),
    make('DEMO-BOOKING-2','11:10','체험 강습생 B · 10세',{kind:'reorder',designated:true,preferred_instructor_user_id:roster[0].user_id,age:10,experience_count:3}),
    make('DEMO-BOOKING-3','13:10','체험 강습생 C · 9세',{kind:'season',season_id:seasonId,session_number:2,age:9,experience_count:5,parallel_long_turn:true,preferred_instructor_user_id:roster[1].user_id,instructorIds:[roster[1].user_id],status:'confirmed'}),
    make('DEMO-BOOKING-4','15:10','체험 강습생 D · 성인',{age:26,experience_count:0,parallel_long_turn:false}),
    make('DEMO-BOOKING-5','09:00','체험 강습생 E · 11세',{age:11,experience_count:6,parallel_long_turn:null}),
    make('DEMO-BOOKING-6','11:10','체험 강습생 C · 9세',{kind:'season',season_id:seasonId,session_number:3,age:9,experience_count:5,parallel_long_turn:true,preferred_instructor_user_id:roster[1].user_id}),
  ];
  // A single altered row must not discard the complete raw-column fixture.
  rows[0].raw=make('DEMO-BOOKING-1','09:00','체험 강습생 A · 7세').raw;
  rows[0].raw.G='7세 이하 · 경력강사 배정이 필요한 체험 예시';
  rows[1].raw.G='이전 강사가 마음에 들어 같은 강사로 재등록';
  rows[2].raw.F=roster[1].display_name;rows[2].raw.G='시즌 6회 중 2회차 · 전 회차 같은 강사';
  rows[3].raw.D='보드';rows[3].raw.K='성인';rows[3].raw.M='2';rows[3].raw.I='체험 강습생 D · 성인 2명';
  rows[4].raw.A=next;rows[4].raw.G='경험 6회 · 패러렐 롱턴 가능 여부 확인 필요';
  rows[5].raw.A=next;rows[5].raw.G='시즌 6회 중 3회차 · 같은 강사 우선 유지';
  return {rows,roster,capabilities:[capability(roster[0],true,['스키','보드']),capability(roster[1],true,['스키']),capability(roster[2],false,['스키','보드'])],seasonPackages:[{id:seasonId,customer_name:'체험 강습생 C',total_sessions:6,instructor_user_id:roster[1].user_id}],timeOffRequests:[]};
}

function contextFor(state,settings) {
  if(!settings.demo)return {...state,reservations:(state.reservations||[]).map(row=>normalizeBookingRow(row,state))};
  const demo=settings.demoData;
  const reservations=demo.rows.map(row=>normalizeBookingRow(row,{seasonPackages:demo.seasonPackages}));
  const schedules=reservations.map(row=>{const interval=parseLessonInterval(row.raw);return {id:row.id,start:interval.start,end:interval.end,instructorUserIds:row.instructorIds,instructorUserId:row.instructorIds[0],location:row.raw.E,customer:row.raw.I};});
  return {...state,...demo,reservations,schedules,settings:{...state.settings,...demo.policy}};
}

export function selectBookingRows(state={},filters={}) {
  return (state.reservations||[]).map(row=>normalizeBookingRow(row,state)).filter(row=>{
    if(filters.date&&parseKstDate(row.raw.A)!==filters.date)return false;
    if(filters.company&&filters.company!=='all'&&row.raw.E!==filters.company)return false;
    if(filters.sport&&filters.sport!=='all'&&row.raw.D!==filters.sport)return false;
    if(filters.kind==='reorder'&&!row.isReorder)return false;
    if(filters.kind&&filters.kind!=='all'&&filters.kind!=='reorder'&&row.kind!==filters.kind)return false;
    if(filters.assignment==='unassigned'&&row.instructorIds.length)return false;
    if(filters.assignment==='assigned'&&!row.instructorIds.length)return false;
    if(filters.assignment==='unpaid'&&!(numeric(row.raw.Z)>0))return false;
    if(filters.query&&!`${Object.values(row.raw).join(' ')} ${row.id}`.normalize('NFKC').toLowerCase().includes(filters.query.normalize('NFKC').toLowerCase()))return false;
    return row.status!=='cancelled';
  }).sort((a,b)=>`${parseKstDate(a.raw.A)||''} ${a.raw.B}`.localeCompare(`${parseKstDate(b.raw.A)||''} ${b.raw.B}`)||a.id.localeCompare(b.id));
}

function instructorName(id,context) {return context.roster?.find(person=>person.user_id===id)?.display_name||'연결된 강사';}
function rowName(row) {return row.raw.I||row.raw.H||'예약';}
function policyValues(settings={}) {return {bookingExpertMode:settings.bookingExpertMode||'either',bookingExpertAgeMax:settings.bookingExpertAgeMax??7,bookingExpertExperienceMin:settings.bookingExpertExperienceMin??5,bookingExpertParallelMode:settings.bookingExpertParallelMode||'capable'};}
function requirementText(result) {return result.needsReview?'확인 필요':result.required?'경력강사 필요':'일반 배정 가능';}

function renderCell(row,column,context,escape) {
  const key=column.key,value=row.raw[key];
  if(key==='A')return `<strong>${escape(dateText(value))}</strong><small>${badge(kinds[row.kind]||'일반',row.kind==='single'?'neutral':'teal',escape)}${row.kind==='season'?` <span>${escape(row.sessionNumber||'—')}회차</span>`:''}${row.isReorder&&row.kind!=='reorder'?` ${badge('리오더','teal',escape)}`:''}</small>`;
  if(key==='F')return row.instructorIds.length?`<strong>${escape(row.instructorIds.map(id=>instructorName(id,context)).join(' · '))}</strong>${row.designated||row.isReorder||row.kind==='reorder'||row.kind==='season'?'<small class="bk-designated">같은 강사 지정</small>':''}`:`<span class="bk-unassigned">미배정</span>${value?`<small>시트: ${escape(value)}</small>`:''}`;
  if(key==='I'){const requirement=expertRequirement(row,context.settings);return `<strong>${escape(value||'—')}</strong><small>${escape(row.age===null?'나이 미확인':`${row.age}세`)} · ${escape(row.experienceCount===null?'경험 미확인':`경험 ${row.experienceCount}회`)}</small>${requirement.required||requirement.needsReview?badge(requirementText(requirement),requirement.needsReview?'amber':'teal',escape):''}`;}
  if(key==='G'||key==='O')return `<span class="bk-long-cell">${escape(value||'—')}</span>`;
  if(['T','U','V','W','X','Y','Z','AB'].includes(key))return `<span class="${key==='Z'&&numeric(value)>0?'bk-amount-due':''}">${escape(money(value))}</span>`;
  return escape(value===''||value===null?'—':value);
}

function renderTable(rows,context,settings,escape) {
  const shown=rows.slice(0,settings.limit);
  return `<section class="panel bk-table-panel"><div class="bk-table-title"><div><h2>전체 예약·배정표 <span>${rows.length}<small>건</small></span></h2><p>한 행에 한 강습 · 원본 열 순서 유지</p></div><span class="bk-scroll-note">모든 항목을 좌우로 확인하세요 ↔</span></div><div class="bk-table-scroll" tabindex="0" role="region" aria-label="전체 예약 원본 항목과 강사 배정표"><table class="bk-table"><caption class="bk-sr-only">기존 시트 A열부터 AF열까지 보존한 예약 ${rows.length}건</caption><thead><tr>${RAW_COLUMNS.map(column=>`<th scope="col" class="bk-col-${column.key}"><span class="bk-column-letter">${escape(column.key)}</span>${escape(column.label||`원본 ${column.key}`)}</th>`).join('')}<th class="bk-table-action" scope="col">예약 관리</th></tr></thead><tbody>${shown.map(row=>`<tr data-booking-row="${escape(row.id)}" class="${settings.draft?.id===row.id?'selected':''}">${RAW_COLUMNS.map(column=>`<td class="bk-col-${column.key}">${renderCell(row,column,context,escape)}</td>`).join('')}<td class="bk-table-action"><button type="button" class="btn secondary small" data-bk-open="${escape(row.id)}">접수·배정 →</button></td></tr>`).join('')||`<tr><td colspan="${RAW_COLUMNS.length+1}" class="bk-table-empty"><strong>조건에 맞는 예약이 없습니다.</strong><p>조회 조건을 바꾸거나 새 예약을 등록해 주세요.</p></td></tr>`}</tbody></table></div><div class="bk-table-bottom"><span>${settings.demo?'체험 데이터 · 서버와 구글시트에 저장하지 않습니다.':'웹에서 저장한 예약 · 구글시트 자동 기록은 아직 연결 전입니다.'}</span>${shown.length<rows.length?`<button type="button" class="btn ghost small" data-bk-more>150건 더 보기 (${shown.length}/${rows.length})</button>`:'<span>A~AF 전체 항목</span>'}</div></section>`;
}

function renderTimeSummary(rows,context,escape) {
  const groups=new Map();for(const row of rows){const key=`${parseKstDate(row.raw.A)||''} ${row.raw.B}`;const group=groups.get(key)||{date:row.raw.A,time:row.raw.B,lessons:0,people:0,unassigned:0};group.lessons++;group.people+=numeric(row.raw.M)||0;if(!row.instructorIds.length)group.unassigned++;groups.set(key,group);}
  return `<details class="bk-time-summary"><summary>시간대별 수량 확인 <span>${groups.size}개 시간대</span></summary><div>${[...groups.values()].map(group=>`<article><span>${escape(dateText(group.date))} <strong>${escape(group.time)}</strong></span><span>강습 <b>${group.lessons}</b>건 · 인원 <b>${group.people}</b>명 ${group.unassigned?`· <em>미배정 ${group.unassigned}건</em>`:''}</span></article>`).join('')||'<p>표시할 시간대가 없습니다.</p>'}</div></details>`;
}

function inputField(key,label,value,escape,attrs='') {return `<label class="field bk-field-${key}"><span class="field-label">${escape(label)} <small>${escape(key)}</small></span><input name="raw_${escape(key)}" value="${escape(value)}" ${attrs}></label>`;}
function selectField(name,label,value,choices,escape,attrs='') {if(value!==''&&value!==null&&value!==undefined&&!choices.some(([key])=>String(key)===String(value)))choices=[[value,String(value)],...choices];return `<label class="field"><span class="field-label">${escape(label)}</span><select name="${escape(name)}" ${attrs}>${choices.map(([key,text])=>option(key,text,value,escape)).join('')}</select></label>`;}
function rawTextarea(key,label,value,escape,rows=3) {return `<label class="field bk-field-${key}"><span class="field-label">${escape(label)} <small>${escape(key)}</small></span><textarea name="raw_${escape(key)}" rows="${rows}">${escape(value)}</textarea></label>`;}

function rawIntake(draft,context,escape) {
  const raw=draft.raw,companies=unique([...(context.reservations||[]).map(row=>row.raw.E),'캐치스키 곤지암','라이즌 곤지암','라이즌 지산','라이즌 비발디','코코넛 곤지암']);
  const preferred=draft.preferredInstructorId||'';
  const packageRows=context.seasonPackages||[];
  return `<section data-bk-pane="intake"><div class="bk-section-label"><span>01</span><h3>예약 구분</h3></div><div class="bk-kind-options">${Object.entries(kinds).map(([key,label])=>`<label class="${draft.kind===key?'selected':''}"><input type="radio" name="kind" value="${key}" ${draft.kind===key?'checked':''}><strong>${label}</strong><small>${key==='single'?'개별 강습':key==='reorder'?'만족한 강사로 재등록':'여러 회차 일괄 구매'}</small></label>`).join('')}</div><label class="check-field bk-reorder-check"><input name="isReorder" type="checkbox" ${draft.isReorder?'checked':''}> 이전 강사가 마음에 들어 재등록한 리오더</label><div class="bk-preference"><label class="check-field"><input name="designated" type="checkbox" ${draft.designated?'checked':''}> 같은 강사 지정</label>${selectField('preferredInstructorId','지정 강사',preferred,[['','선택해 주세요'],...(context.roster||[]).filter(person=>person.active&&person.role==='instructor').map(person=>[person.user_id,person.display_name])],escape)}</div><div class="bk-season-fields" ${draft.kind==='season'?'':'hidden'}>${selectField('seasonId','시즌 강습 묶음',draft.seasonId||'',[['','새 시즌 강습 등록'],...packageRows.map(pack=>[pack.id,`${pack.customer_name||pack.customerName||'시즌 강습'} · ${pack.total_sessions||pack.totalSessions}회`])],escape)}<div class="bk-form-grid"><label class="field"><span class="field-label">구매 총회차</span><input type="number" name="seasonTotal" min="1" max="100" value="${escape(draft.seasonTotal||'')}"></label><label class="field"><span class="field-label">이번 회차</span><input type="number" name="sessionNumber" min="1" max="100" value="${escape(draft.sessionNumber||'')}"></label></div><p class="bk-field-note">묶음의 담당 강사를 모든 회차에 유지합니다.</p></div><div class="bk-section-label"><span>02</span><h3>고객·강습 조건</h3></div><div class="bk-form-grid">${inputField('H','입금자',raw.H,escape,'maxlength="120"')}${inputField('I','강습생',raw.I,escape,'required maxlength="120"')}${inputField('L','연락처',raw.L,escape,'type="tel" maxlength="30"')}${inputField('M','인원',raw.M,escape,'type="number" min="1" max="1000" required')}<label class="field"><span class="field-label">나이 <b>*</b></span><input name="age" type="number" min="1" max="120" value="${escape(draft.age??'')}" placeholder="미확인"></label><label class="field"><span class="field-label">이전 강습 경험 <b>*</b></span><span class="bk-suffixed"><input name="experienceCount" type="number" min="0" max="999" value="${escape(draft.experienceCount??'')}" placeholder="미확인"><span>회</span></span></label></div>${selectField('parallelLongTurn','패러렐 롱턴 가능 여부',draft.parallelLongTurn===null?'':String(draft.parallelLongTurn),[['','미확인'],['true','가능'],['false','아직 불가능']],escape)}<div class="bk-requirement" data-bk-requirement>${renderRequirement(draft,context,escape)}</div><div class="bk-form-grid">${selectField('raw_K','관계',raw.K,[['','선택'],['가족','가족'],['자녀','자녀'],['아빠, 자녀','아빠, 자녀'],['어린이','어린이'],['성인','성인'],['단체','단체']],escape)}${inputField('J','횟수',raw.J,escape,'maxlength="30"')}${inputField('O','수준',raw.O,escape,'maxlength="200"')}</div>${rawTextarea('G','특이사항·요청사항',raw.G,escape)}<div class="bk-section-label"><span>03</span><h3>날짜·시간·업체</h3></div><div class="bk-form-grid">${inputField('A','날짜',parseKstDate(raw.A)||'',escape,'type="date" required')}${selectField('raw_D','종목',raw.D,[['스키','스키'],['보드','보드']],escape)}${inputField('B','시작시간',raw.B,escape,'placeholder="09:00" pattern="(?:[01]?[0-9]|2[0-3]):[0-5][0-9]|24:00" required')}${inputField('C','종료시간',raw.C,escape,'placeholder="11:00" pattern="(?:[01]?[0-9]|2[0-3]):[0-5][0-9]|24:00" required')}${selectField('raw_N','강습시간',raw.N,[['','선택'],['2시간','2시간'],['3시간','3시간'],['4시간','4시간']],escape)}${inputField('E','강습업체·지점',raw.E,escape,'list="bk-company-options" required maxlength="200"')}</div><datalist id="bk-company-options">${companies.map(company=>`<option value="${escape(company)}"></option>`).join('')}</datalist></section>`;
}

function renderRequirement(draft,context,escape) {
  const result=expertRequirement(draft,context.settings);
  return `${badge(requirementText(result),result.needsReview?'amber':result.required?'teal':'neutral',escape)}<span>${escape((result.reasons||[]).join(' · ')||'입력한 강습 조건을 기준으로 배정합니다.')}</span>`;
}

function rawFinancial(draft,escape) {
  const raw=draft.raw;
  return `<section data-bk-pane="financial"><div class="bk-section-label"><span>04</span><h3>결제·정산 정보</h3></div>${rawTextarea('P','견적·영수증 요청',raw.P,escape,2)}<div class="bk-form-grid">${inputField('Q','결제 소스',raw.Q,escape,'maxlength="200"')}${selectField('raw_R','패치결제',raw.R,[['','미확인'],['O','O'],['X','X']],escape)}${selectField('raw_S','장비결제',raw.S,[['','미확인'],['O','O'],['X','X']],escape)}${['T','U','V','W'].map(key=>inputField(key,RAW_COLUMNS.find(column=>column.key===key)?.label||key,raw[key],escape,'inputmode="decimal"')).join('')}</div><button type="button" class="btn ghost small bk-calculate" data-bk-calculate>요금 합계·추가입금 계산</button><div class="bk-form-grid bk-financial-total">${['X','Y','Z'].map(key=>inputField(key,RAW_COLUMNS.find(column=>column.key===key)?.label||key,raw[key],escape,'inputmode="decimal"')).join('')}</div><div class="bk-form-grid">${inputField('AA','환산 단위',raw.AA,escape)}${inputField('AB','강사정산액',raw.AB,escape,'inputmode="decimal"')}${inputField('AC','정산일',raw.AC,escape)}</div><details class="bk-extra-raw"><summary>추가 원본 항목</summary><div class="bk-form-grid">${['AD','AE','AF'].map(key=>inputField(key,`원본 ${key}`,raw[key],escape)).join('')}</div></details></section>`;
}

function candidateResult(draft,context) {
  try{return evaluateCandidates(draft,{roster:context.roster||[],capabilities:context.capabilities||[],schedules:context.schedules||[],reservations:context.reservations||[],seasonPackages:context.seasonPackages||[],timeOffRequests:context.timeOffRequests||[],settings:context.settings||{}});}catch{return {candidates:[],eligible:[],needsReview:true,reasons:['배정 조건을 확인하지 못했습니다. 입력값과 강사 설정을 확인해 주세요.']};}
}

function renderAssignment(draft,context,escape) {
  const result=candidateResult(draft,context),rows=result.candidates||[],eligible=rows.filter(candidate=>candidate.eligible);
  const selected=unique(draft.instructorIds||[]);
  return `<section data-bk-pane="assignment"><div class="bk-section-label"><span>05</span><h3>강사 배정</h3></div><div class="bk-requirement">${renderRequirement(draft,context,escape)}</div>${result.requiredInstructorId?`<div class="bk-fixed-teacher">${badge(draft.kind==='season'?'시즌 담당 유지':draft.kind==='reorder'?'리오더 지정':'지정 강사','teal',escape)}<strong>${escape(instructorName(result.requiredInstructorId,context))}</strong></div>`:''}${result.reasons?.length?`<ul class="bk-review-list">${result.reasons.map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul>`:''}<div class="bk-candidate-heading"><strong>배정 가능 ${eligible.length}명</strong><button type="button" class="btn secondary small" data-bk-suggest ${eligible.length&&!result.needsReview?'':'disabled'}>자동 배정안 만들기</button></div>${draft.suggestion?`<div class="bk-suggestion"><strong>배정 제안</strong><span>${escape(selected.map(id=>instructorName(id,context)).join(' · ')||'—')}</span><small>조건과 일정이 맞는 후보입니다. 저장하면 배정이 확정됩니다.</small></div>`:''}<div class="bk-candidates">${rows.map(candidate=>{const id=candidate.instructorId||candidate.instructor_user_id||candidate.id;const name=candidate.name||instructorName(id,context);return `<label class="bk-candidate ${candidate.eligible?'':'blocked'}"><input type="checkbox" name="instructorIds" value="${escape(id)}" ${selected.includes(id)?'checked':''} ${candidate.eligible?'':'disabled'}><span class="bk-person-avatar">${escape(initials(name))}</span><span><strong>${escape(name)}</strong><small>${escape((candidate.eligible?candidate.reasons:candidate.blockedReasons)?.join(' · ')||(candidate.eligible?'배정 가능':'조건 확인 필요'))}</small></span>${badge(candidate.eligible?'가능':'제외',candidate.eligible?'teal':'neutral',escape)}</label>`;}).join('')||'<div class="bk-candidate-empty">배정할 강사가 없습니다.<br>강사 조건 설정에서 종목·지점·경력을 확인해 주세요.</div>'}</div>${selected.length?`<button type="button" class="btn ghost small" data-bk-clear-assignment>배정 선택 해제</button>`:''}<div class="bk-section-label bk-board-heading"><span>TIME</span><h3>해당일 강사 일정</h3></div>${renderInstructorBoard(draft,context,escape)}</section>`;
}

function renderInstructorBoard(draft,context,escape) {
  const date=parseKstDate(draft.raw.A),schedules=context.schedules||[];
  return `<div class="bk-mini-board">${(context.roster||[]).filter(person=>person.role==='instructor'&&person.active).map(person=>{const lessons=schedules.filter(lesson=>lesson.id!==draft.id&&unique([lesson.instructorUserId,...(lesson.instructorUserIds||[])]).includes(person.user_id)&&lesson.start&&day(lesson.start)===date).sort((a,b)=>new Date(a.start)-new Date(b.start));const clock=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));const leave=(context.timeOffRequests||[]).find(request=>(request.instructor_user_id||request.instructorUserId)===person.user_id&&(request.requested_date||request.date||request.leave_date)===date&&['pending','approved'].includes(request.status));return `<article><strong>${escape(person.display_name)}</strong><div>${leave?badge(leave.status==='approved'?'휴무 승인':'휴무 신청','amber',escape):''}${lessons.map(lesson=>`<span class="bk-board-lesson">${escape(clock(lesson.start))}–${escape(clock(lesson.end))}<small>${escape(lesson.customer||'배정 강습')}</small></span>`).join('')||(!leave?'<span class="bk-board-free">등록된 강습 없음</span>':'')}</div></article>`;}).join('')||'<p>강사 계정을 먼저 등록해 주세요.</p>'}</div>`;
}

function renderDrawer(settings,context,escape) {
  if(!settings.drawer)return '';
  if(settings.drawer==='settings')return renderSettingsDrawer(settings,context,escape);
  const draft=settings.draft;if(!draft)return '';
  const pane=settings.tab||'intake';
  return `<div class="bk-drawer-backdrop" data-bk-backdrop><aside class="bk-drawer" role="dialog" aria-modal="true" aria-label="예약 접수와 강사 배정"><header><div><span>${draft.id?'예약 관리':'NEW RESERVATION'}${settings.demo?' · 체험':''}</span><h2>${escape(draft.id?rowName(draft):'새 예약 접수')}</h2><p>${escape(draft.id||'고객 정보부터 배정까지 한 번에 확인하세요.')}</p></div><button type="button" class="icon-btn" data-bk-close aria-label="예약 창 닫기">×</button></header><nav class="bk-drawer-tabs" aria-label="예약 입력 단계">${[['intake','접수 정보'],['financial','금액·원본'],['assignment','강사 배정']].map(([key,label])=>`<button type="button" data-bk-tab="${key}" class="${pane===key?'active':''}">${label}</button>`).join('')}</nav><form class="bk-reservation-form" novalidate><div class="bk-drawer-body"><div class="bk-form-error" role="alert" hidden></div>${rawIntake(draft,context,escape)}${rawFinancial(draft,escape)}${renderAssignment(draft,context,escape)}</div><footer><span>${settings.demo?'체험 모드 · 실제 기록 없음':'서버 저장 · 시트 자동 기록 미연결'}</span><div><button type="button" class="btn secondary" data-bk-close>닫기</button><button type="submit" class="btn primary">${settings.demo?'체험 예약 저장':'예약·배정 저장'}</button></div></footer></form></aside></div><style>.booking-page [data-bk-pane]{display:none}.booking-page [data-bk-pane="${pane}"]{display:block}</style>`;
}

function renderSettingsDrawer(settings,context,escape) {
  const policy=policyValues(context.settings),people=(context.roster||[]).filter(person=>person.role==='instructor'&&person.active);
  return `<div class="bk-drawer-backdrop" data-bk-backdrop><aside class="bk-drawer bk-settings-drawer" role="dialog" aria-modal="true" aria-label="강사 조건과 자동 배정 기준"><header><div><span>ASSIGNMENT SETTINGS${settings.demo?' · 체험':''}</span><h2>강사 조건·배정 기준</h2><p>관리자가 확인한 조건으로 배정합니다.</p></div><button type="button" class="icon-btn" data-bk-close aria-label="설정 창 닫기">×</button></header><div class="bk-drawer-body"><form class="bk-policy-form"><h3>경력강사 필요 기준</h3><div class="bk-form-grid"><label class="field"><span class="field-label">나이 기준 · 이하</span><input name="bookingExpertAgeMax" type="number" min="0" max="18" required value="${escape(policy.bookingExpertAgeMax)}"></label><label class="field"><span class="field-label">강습 경험 기준 · 이상</span><input name="bookingExpertExperienceMin" type="number" min="1" max="100" required value="${escape(policy.bookingExpertExperienceMin)}"></label></div>${selectField('bookingExpertMode','조건 적용',policy.bookingExpertMode,[['either','나이 조건 또는 경험·패러렐 조건'],['both','나이 조건과 경험·패러렐 조건 모두'],['age','나이 조건만'],['skill','경험·패러렐 조건만']],escape)}${selectField('bookingExpertParallelMode','경험 기준에 적용할 패러렐 롱턴 응답',policy.bookingExpertParallelMode,[['capable','패러렐 롱턴 가능'],['not_capable','패러렐 롱턴 불가능'],['either','가능·불가능 응답 모두']],escape)}<p class="bk-field-note">강습 경험 횟수와 위 응답 조건을 함께 확인합니다.</p><div class="bk-form-error" role="alert" hidden></div><button type="submit" class="btn secondary small">배정 기준 저장</button></form><div class="bk-settings-divider"></div><h3>강사별 확인 정보</h3><p class="bk-field-note">종목·지점·경력을 확인한 강사만 자동 배정에 포함됩니다.</p>${people.map(person=>{const capability=(context.capabilities||[]).find(item=>(item.instructor_user_id||item.instructorUserId)===person.user_id)||{};return `<form class="bk-capability-form" data-instructor="${escape(person.user_id)}"><h4>${escape(person.display_name)}</h4><div class="bk-capability-flags"><label class="check-field"><input type="checkbox" name="isExperienced" ${capability.is_experienced||capability.isExperienced?'checked':''}> 경력강사</label><label class="check-field"><input type="checkbox" name="verified" ${capability.verified?'checked':''}> 관리자 확인 완료</label></div><fieldset><legend>가능 종목</legend>${['스키','보드'].map(sport=>`<label class="check-field"><input type="checkbox" name="sports" value="${sport}" ${list(capability.sports).includes(sport)?'checked':''}> ${sport}</label>`).join('')}</fieldset><label class="field"><span class="field-label">가능 지점</span><input name="locations" value="${escape(list(capability.locations).join(', '))}" placeholder="곤지암, 지산, 비발디"><span class="field-help">쉼표로 구분해 입력하세요.</span></label><div class="bk-form-error" role="alert" hidden></div><button type="submit" class="btn secondary small">강사 조건 저장</button></form>`;}).join('')||'<p class="bk-field-note">등록된 강사 계정이 없습니다.</p>'}</div><footer><span>${settings.demo?'체험 설정 · 실제 기록 없음':'관리자 전용 설정'}</span><button type="button" class="btn primary" data-bk-close>완료</button></footer></aside></div>`;
}

export function renderBookingPage({state={},ui={},escapeHTML=fallbackEscape,icon=()=>'',now=new Date()}={}) {
  if((ui.role||state.profile?.role)!=='admin')return '<section class="panel"><div class="empty-state"><strong>관리자 전용 화면입니다.</strong></div></section>';
  const escape=escapeHTML,settings=bookingState(state,ui,now),context=contextFor(state,settings),rows=selectBookingRows(context,settings);
  const total=context.reservations.filter(row=>row.status!=='cancelled').length,people=rows.reduce((sum,row)=>sum+(numeric(row.raw.M)||0),0),unassigned=rows.filter(row=>!row.instructorIds.length).length,expert=rows.filter(row=>expertRequirement(row,context.settings).required).length;
  const companies=unique(context.reservations.map(row=>row.raw.E));
  return `<section class="booking-page" aria-label="예약 접수와 강사 배정"><div class="bk-page-heading"><div><span class="bk-eyebrow">RESERVATION DESK</span><h1>예약·강사 배정</h1><p>전체 예약을 세로로 확인하고, 접수부터 강사 배정까지 이어서 처리하세요.</p></div><div class="bk-heading-actions"><button type="button" class="btn secondary" data-bk-settings>${icon('settings')}강사 조건 설정</button><button type="button" class="btn primary" data-bk-new>${icon('plus')}예약 등록</button></div></div><div class="bk-mode-bar"><div>${badge(settings.demo?'체험 예약표':'운영 예약표',settings.demo?'amber':'teal',escape)}<span>${settings.demo?'예시로 접수·리오더·시즌 배정을 직접 해보세요. 실제 기록은 바뀌지 않습니다.':'서버에 저장된 예약을 관리합니다.'}</span></div><button type="button" class="bk-mode-toggle" data-bk-demo>${settings.demo?'운영 예약표로 전환':'체험 데이터 보기'} →</button></div><div class="bk-stats"><article><span>조회된 강습</span><strong>${rows.length}<small>건</small></strong><p>전체 ${total}건 중</p></article><article><span>강습생 인원</span><strong>${people}<small>명</small></strong><p>현재 조회된 인원 합계</p></article><article class="bk-stat-highlight"><span>미배정</span><strong>${unassigned}<small>건</small></strong><p>담당 강사 배정 필요</p></article><article><span>경력강사 필요</span><strong>${expert}<small>건</small></strong><p>나이·경험·패러렐 응답 기준</p></article></div><section class="panel bk-filters"><form class="bk-filter-form"><label><span>강습일</span><input type="date" name="date" value="${escape(settings.date)}"></label><label><span>강습업체·지점</span><select name="company">${option('all','전체 업체',settings.company,escape)}${companies.map(company=>option(company,company,settings.company,escape)).join('')}</select></label><label><span>종목</span><select name="sport">${[['all','전체'],['스키','스키'],['보드','보드']].map(([key,label])=>option(key,label,settings.sport,escape)).join('')}</select></label><label><span>예약 구분</span><select name="kind">${option('all','전체',settings.kind,escape)}${Object.entries(kinds).map(([key,label])=>option(key,label,settings.kind,escape)).join('')}</select></label><label class="bk-search"><span>검색</span><input type="search" name="query" value="${escape(settings.query)}" placeholder="강습생 · 입금자 · 특이사항"></label><button type="submit" class="btn secondary">조회</button><button type="button" class="btn ghost" data-bk-reset>초기화</button></form><div class="bk-quick-filters">${[['all','전체'],['unassigned','미배정'],['assigned','배정 완료'],['unpaid','추가입금 필요']].map(([key,label])=>`<button type="button" data-bk-assignment="${key}" class="${settings.assignment===key?'active':''}" aria-pressed="${settings.assignment===key}">${label}</button>`).join('')}<a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">기존 구글시트 ↗</a></div></section>${renderTimeSummary(rows,context,escape)}${renderTable(rows,context,settings,escape)}<p class="bk-source-status">${badge('구글시트 자동 기록 미연결','neutral',escape)} 원본 형식의 입력값을 보존합니다. 실제 시트 반영은 연결 후 사용할 수 있습니다.</p>${renderDrawer(settings,context,escape)}</section>`;
}

function draftFromForm(form,draft) {
  const data=new FormData(form),next=clone(draft);
  for(const column of RAW_COLUMNS){const key=`raw_${column.key}`;if(data.has(key))next.raw[column.key]=String(data.get(key)||'');}
  next.kind=String(data.get('kind')||next.kind||'single');next.isReorder=data.has('isReorder')||next.kind==='reorder';next.designated=data.has('designated')||next.isReorder;
  next.age=numeric(data.get('age'));next.experienceCount=numeric(data.get('experienceCount'));
  next.parallelLongTurn=data.get('parallelLongTurn')==='true'?true:data.get('parallelLongTurn')==='false'?false:null;
  next.preferredInstructorId=String(data.get('preferredInstructorId')||'')||null;
  next.seasonId=String(data.get('seasonId')||'')||null;next.seasonTotal=numeric(data.get('seasonTotal'));next.sessionNumber=numeric(data.get('sessionNumber'));
  const checkedIds=[...form.querySelectorAll('input[name="instructorIds"]:checked')].map(input=>input.value);
  // Keep existing assignments visible even when newly edited conditions block them.
  // Saving then requires an explicit valid re-selection or clearing the assignment.
  next.instructorIds=unique(checkedIds);
  return next;
}

function newDraft(context,now) {
  const raw={};for(const column of RAW_COLUMNS)raw[column.key]='';
  Object.assign(raw,{A:day(now),B:'09:00',C:'11:00',D:'스키',E:context.reservations?.[0]?.raw.E||'라이즌 곤지암',J:'1회',M:'1',N:'2시간'});
  return normalizeBookingRow({raw,age:null,experience_count:null,parallel_long_turn:null,kind:'single',designated:false,status:'received'});
}

function validationError(draft,context) {
  if(!draft.raw.I.trim())return '강습생 정보를 입력해 주세요.';
  if(!draft.raw.E.trim())return '강습업체·지점을 입력해 주세요.';
  if(!Number.isInteger(numeric(draft.raw.M))||numeric(draft.raw.M)<1||numeric(draft.raw.M)>1000)return '강습 인원을 1명 이상으로 확인해 주세요.';
  if(draft.age!==null&&(!Number.isInteger(draft.age)||draft.age<1||draft.age>120))return '나이를 1~120 사이의 정수로 입력해 주세요.';
  if(draft.experienceCount!==null&&(!Number.isInteger(draft.experienceCount)||draft.experienceCount<0||draft.experienceCount>999))return '강습 경험을 0회 이상의 정수로 입력해 주세요.';
  const interval=parseLessonInterval(draft.raw);if(interval.error)return interval.error;
  if((draft.isReorder||draft.kind==='reorder'||draft.designated)&&!draft.preferredInstructorId)return '지정 강사를 선택해 주세요.';
  if(draft.kind==='season'&&(!Number.isInteger(draft.seasonTotal)||!Number.isInteger(draft.sessionNumber)||draft.seasonTotal<1||draft.seasonTotal>100||draft.sessionNumber<1||draft.sessionNumber>draft.seasonTotal))return '시즌 총회차와 이번 회차를 확인해 주세요.';
  if(draft.kind==='season'&&!draft.preferredInstructorId&&!draft.seasonId)return '전 회차를 담당할 시즌 강사를 선택해 주세요.';
  for(const key of ['T','U','V','W','X','Y','Z','AB'])if(draft.raw[key]!==''&&numeric(draft.raw[key])===null)return `${RAW_COLUMNS.find(column=>column.key===key)?.label||key}을 숫자로 입력해 주세요.`;
  if(draft.instructorIds.length){const evaluation=candidateResult(draft,context);const allowed=new Set((evaluation.candidates||[]).filter(person=>person.eligible).map(person=>person.instructorId||person.id));if(evaluation.needsReview)return '배정 전에 나이·경험·패러렐 응답과 강사 조건을 확인해 주세요.';if(draft.instructorIds.some(id=>!allowed.has(id)))return '선택한 강사의 일정·휴무·배정 조건이 맞지 않습니다. 강사 배정에서 다시 확인해 주세요.';if(evaluation.requiredInstructorId&&!draft.instructorIds.includes(evaluation.requiredInstructorId))return '지정된 담당 강사를 배정에 포함해 주세요.';}
  return null;
}

/** All mutations are passed to authenticated parent callbacks; demo writes remain in memory. */
export function bindBookingPage(root,{state={},ui={},onChange,onSave,onAssign,onOpenLesson,onSaveCapabilities,onSavePolicy,onCandidates,now=new Date()}={}) {
  const view=root.querySelector('.booking-page');if(!view)return;
  const settings=bookingState(state,ui,now),context=contextFor(state,settings),escape=fallbackEscape;
  const update=changes=>{Object.assign(settings,changes);ui.booking=settings;if(onChange)onChange(settings);else{view.outerHTML=renderBookingPage({state,ui,now});bindBookingPage(root,{state,ui,onSave,onAssign,onOpenLesson,onSaveCapabilities,onSavePolicy,onCandidates,now});}};
  const preserveDraft=()=>{const form=view.querySelector('.bk-reservation-form');if(form&&settings.draft)settings.draft=draftFromForm(form,settings.draft);};
  const showError=(form,message)=>{const box=form.querySelector('.bk-form-error');if(box){box.textContent=message;box.hidden=false;box.scrollIntoView({block:'nearest'});}};
  const run=async(form,work)=>{if(form.dataset.busy)return;form.dataset.busy='1';const buttons=[...form.querySelectorAll('button[type="submit"]')];buttons.forEach(button=>button.disabled=true);try{await work();}catch(error){showError(form,error.message||'저장하지 못했습니다. 다시 시도해 주세요.');}finally{delete form.dataset.busy;buttons.forEach(button=>button.disabled=false);}};
  view.querySelector('.bk-filter-form')?.addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);update({date:String(form.get('date')||''),company:String(form.get('company')||'all'),sport:String(form.get('sport')||'all'),kind:String(form.get('kind')||'all'),query:String(form.get('query')||'').trim(),limit:150});});
  view.querySelector('[data-bk-reset]')?.addEventListener('click',()=>update({date:'',company:'all',sport:'all',kind:'all',assignment:'all',query:'',limit:150}));
  view.querySelector('[data-bk-demo]')?.addEventListener('click',()=>update({demo:!settings.demo,date:'',company:'all',sport:'all',kind:'all',assignment:'all',query:'',drawer:null,draft:null}));
  view.querySelector('[data-bk-settings]')?.addEventListener('click',()=>update({drawer:'settings'}));
  view.querySelector('[data-bk-new]')?.addEventListener('click',()=>update({drawer:'reservation',tab:'intake',draft:newDraft(context,now)}));
  view.querySelectorAll('[data-bk-assignment]').forEach(button=>button.addEventListener('click',()=>update({assignment:button.dataset.bkAssignment,limit:150})));
  view.querySelector('[data-bk-more]')?.addEventListener('click',()=>update({limit:settings.limit+150}));
  view.querySelectorAll('[data-bk-open]').forEach(button=>button.addEventListener('click',()=>{const row=context.reservations.find(item=>item.id===button.dataset.bkOpen);if(row)update({drawer:'reservation',tab:'intake',draft:clone(row)});}));
  view.querySelectorAll('[data-bk-close]').forEach(button=>button.addEventListener('click',()=>update({drawer:null,draft:null})));
  view.querySelector('[data-bk-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget)update({drawer:null,draft:null});});
  view.querySelectorAll('[data-bk-tab]').forEach(button=>button.addEventListener('click',()=>{preserveDraft();update({tab:button.dataset.bkTab});}));
  const form=view.querySelector('.bk-reservation-form');
  if(form){
    form.addEventListener('change',event=>{
      if(event.target.name==='seasonId'){
        const selected=context.seasonPackages?.find(pack=>pack.id===event.target.value);
        if(selected){form.elements.namedItem('seasonTotal').value=selected.total_sessions||selected.totalSessions||'';form.elements.namedItem('preferredInstructorId').value=selected.instructor_user_id||selected.instructorUserId||'';const existing=context.reservations.filter(row=>row.seasonId===selected.id);form.elements.namedItem('sessionNumber').value=existing.length?Math.max(...existing.map(row=>row.sessionNumber||0))+1:1;}
      }
      if(event.target.name==='kind'){
        form.querySelector('.bk-season-fields').hidden=event.target.value!=='season';
        form.querySelectorAll('.bk-kind-options label').forEach(label=>label.classList.toggle('selected',!!label.querySelector('input:checked')));
        if(event.target.value==='reorder'){form.elements.namedItem('designated').checked=true;form.elements.namedItem('isReorder').checked=true;}
      }
      if(['age','experienceCount','parallelLongTurn','kind','isReorder','preferredInstructorId','seasonId','raw_A','raw_B','raw_C','raw_D','raw_E'].includes(event.target.name)){
        preserveDraft();const requirement=form.querySelector('[data-bk-requirement]');if(requirement)requirement.innerHTML=renderRequirement(settings.draft,context,escape);
        if(settings.tab==='assignment')update({draft:settings.draft});
      }
    });
    view.querySelector('[data-bk-calculate]')?.addEventListener('click',()=>{const sum=['T','U','V','W'].reduce((total,key)=>total+(numeric(form.elements.namedItem(`raw_${key}`).value)||0),0);form.elements.namedItem('raw_X').value=String(sum);form.elements.namedItem('raw_Z').value=String(sum-(numeric(form.elements.namedItem('raw_Y').value)||0));preserveDraft();});
    view.querySelector('[data-bk-suggest]')?.addEventListener('click',async event=>{preserveDraft();const button=event.currentTarget;button.disabled=true;button.textContent='배정 조건 확인 중…';try{let evaluation=candidateResult(settings.draft,context);if(!settings.demo&&typeof onCandidates==='function'){const server=await onCandidates(clone(settings.draft));if(server)evaluation={...server,requiredInstructorId:server.requiredInstructorId??server.required_instructor_id,needsReview:server.needsReview??server.needs_review,candidates:(server.candidates||[]).map(person=>({...person,instructorId:person.instructorId||person.instructor_user_id||person.user_id||person.id}))};}const eligible=(evaluation.candidates||[]).filter(person=>person.eligible);if(evaluation.needsReview||!eligible.length){showError(form,(evaluation.reasons||[]).join(' · ')||'확인된 조건에 맞는 배정 가능 강사가 없습니다.');return;}const recommended=evaluation.requiredInstructorId||eligible[0].instructorId||eligible[0].id;update({draft:{...settings.draft,instructorIds:[recommended],suggestion:true},tab:'assignment'});}catch(error){showError(form,error.message||'배정 조건을 확인하지 못했습니다.');}finally{button.disabled=false;button.textContent='자동 배정안 만들기';}});
    view.querySelector('[data-bk-clear-assignment]')?.addEventListener('click',()=>{preserveDraft();update({draft:{...settings.draft,raw:{...settings.draft.raw,F:''},instructorIds:[],suggestion:false}});});
    form.addEventListener('submit',event=>{event.preventDefault();preserveDraft();const draft=settings.draft,error=validationError(draft,context);if(error){showError(form,error);return;}run(form,async()=>{
      const payload=clone(draft);delete payload.suggestion;payload.instructorIds=unique(payload.instructorIds);payload.raw.F=payload.instructorIds.length?payload.instructorIds.map(id=>instructorName(id,context)).join(' · '):payload.raw.F;payload.status=payload.instructorIds.length?'confirmed':'received';
      if(settings.demo){payload.id=payload.id||`DEMO-BOOKING-${Date.now()}`;if(payload.kind==='season'&&!payload.seasonId){payload.seasonId=`DEMO-SEASON-${Date.now()}`;settings.demoData.seasonPackages.push({id:payload.seasonId,customer_name:payload.raw.I,total_sessions:payload.seasonTotal,instructor_user_id:payload.preferredInstructorId});}const index=settings.demoData.rows.findIndex(row=>row.id===payload.id);if(index>=0)settings.demoData.rows[index]=payload;else settings.demoData.rows.push(payload);}
      else{if(typeof onSave!=='function')throw new Error('예약 저장 연결이 아직 준비되지 않았습니다.');await onSave(payload);}
      update({drawer:null,draft:null});
    });});
  }
  view.querySelector('.bk-policy-form')?.addEventListener('submit',event=>{event.preventDefault();const target=event.currentTarget;run(target,async()=>{const values=new FormData(target),payload={bookingExpertMode:String(values.get('bookingExpertMode')||'either'),bookingExpertAgeMax:Number(values.get('bookingExpertAgeMax')),bookingExpertExperienceMin:Number(values.get('bookingExpertExperienceMin')),bookingExpertParallelMode:String(values.get('bookingExpertParallelMode')||'capable')};if(settings.demo){settings.demoData.policy={...settings.demoData.policy,...payload};context.settings={...context.settings,...payload};state={...state,settings:{...state.settings,...payload}};}else{if(typeof onSavePolicy!=='function')throw new Error('배정 기준 저장 연결이 아직 준비되지 않았습니다.');await onSavePolicy(payload);}update({drawer:'settings'});});});
  view.querySelectorAll('.bk-capability-form').forEach(target=>target.addEventListener('submit',event=>{event.preventDefault();run(target,async()=>{const values=new FormData(target),payload={instructorUserId:target.dataset.instructor,isExperienced:values.has('isExperienced'),verified:values.has('verified'),sports:values.getAll('sports').map(String),locations:unique(String(values.get('locations')||'').split(',').map(value=>value.trim()))};if(payload.verified&&(!payload.sports.length||!payload.locations.length))throw new Error('확인 완료로 저장하려면 가능 종목과 지점을 입력해 주세요.');if(settings.demo){const index=settings.demoData.capabilities.findIndex(row=>row.instructor_user_id===payload.instructorUserId);const record={instructor_user_id:payload.instructorUserId,is_experienced:payload.isExperienced,verified:payload.verified,sports:payload.sports,locations:payload.locations};if(index<0)settings.demoData.capabilities.push(record);else settings.demoData.capabilities[index]=record;}else{if(typeof onSaveCapabilities!=='function')throw new Error('강사 조건 저장 연결이 아직 준비되지 않았습니다.');await onSaveCapabilities(payload);}update({drawer:'settings'});});}));
  view.addEventListener('keydown',event=>{if(!settings.drawer)return;if(event.key==='Escape'){event.preventDefault();update({drawer:null,draft:null});return;}if(event.key==='Tab'){const drawer=view.querySelector('.bk-drawer'),focusable=[...drawer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]')].filter(element=>element.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===drawer)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  // Focus the drawer without stealing focus on background server refreshes.
  if(settings.drawer){const drawer=view.querySelector('.bk-drawer');drawer.setAttribute('tabindex','-1');if(!view.contains(document.activeElement))drawer.focus({preventScroll:true});}
}
