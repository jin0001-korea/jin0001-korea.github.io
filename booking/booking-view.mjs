import {BOOKING_START_TIMES,isBookingStartTime} from './booking-time-options.mjs?v=1';
import {linkCommonCustomerDraft,syncCommonCustomerDrafts} from './booking-customer-common.mjs?v=38';
import {bookingCompanyOptions,normalizeBookingCompany} from './company-options.mjs?v=31';
import {normalizeParticipants,resizeParticipants,participantValidationError,participantSummary} from './booking-participants.mjs?v=34';
import {rentalDetails,rentalDefaultAmount,rentalStatusLabel} from './rental-fields.mjs?v=32';
import {renderRentalBridgePanel} from './rental-bridge-view.mjs?v=31';
import {FINANCIAL_VERSION,bookingFinancialSummary,applyFinancialV3,bookingPaymentSourceOptions} from './booking-financial.mjs?v=12';
import {assertPaymentCorrectionResult} from './payment-correction.mjs?v=2';
import {canonicalTelephone,formatTelephone,customerIdentity,customerTeamHistory,bookingTeamLabel,directoryDisplayNames} from './customer-teams.mjs?v=27';
import {kakaoContactId,kakaoContactValue,kakaoContactLabel} from './kakao-contact.mjs?v=1';
import {createDraftDeck,ensureDraftDeck,preserveActiveDraft,addDraftCard,selectDraftCard,activeDraftCard,markDraftCardSaving,markDraftCardSaved,markDraftCardFailed,resumeDraftDeck,discardDraftCard,discardDraftDeck,draftDeckSummary,hasUnsavedTeamDrafts} from './team-drafts.mjs?v=36';
import {searchCustomerCandidates,customerDirectorySelection,customerContactChoices,customerDirectoryTeams} from './customer-directory.mjs?v=35';
import {automaticBookingSeason,ensureBookingDates,addBookingDates,updateBookingDate,removeBookingDate,applyCommonBookingDateValues,applyCommonBookingDateFinancials,bookingDateRows,buildBookingBatch,copyBookingDatesForTeam,evaluateBookingBatchCandidates} from './booking-dates.mjs?v=70';
import { RAW_COLUMNS, parseKstDate, parseLessonTime, parseLessonInterval, expertRequirement, evaluateCandidates, sportSkill, bookingLocation, lessonPlanSettings, lessonPlanEndTime, lessonTimeLabel, applyLessonPlan, learnerAgeDetails } from './booking-rules.mjs?v=35';

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
function startTimeField(name,value,escape,attributes=''){
 const current=parseLessonTime(value)?.value||String(value||'');
 const legacy=current&&!isBookingStartTime(current);
 return `<label class="field"><span class="field-label">시작시간</span><select name="${escape(name)}" ${attributes}>${option('','시간 선택',current,escape)}${legacy?`<option value="${escape(current)}" selected disabled>기존 ${escape(current)} · 변경 시 시간 선택</option>`:''}${BOOKING_START_TIMES.map(time=>option(time,time,current,escape)).join('')}</select></label>`;
}
const badge = (value,type='neutral',escape=fallbackEscape) => `<span class="bk-badge ${type}">${escape(value)}</span>`;
const dateText = value => {const parsed=parseKstDate(value);return parsed?`${parsed.slice(5).replace('-','.')} (${weekdays[new Date(`${parsed}T12:00:00+09:00`).getUTCDay()]})`:String(value||'—');};
const money = value => numeric(value)===null ? '—' : new Intl.NumberFormat('ko-KR').format(numeric(value));
const clone = value => JSON.parse(JSON.stringify(value));
const bookingRailObservers=new WeakMap();
function keepActiveCardVisible(view,key){
  const rail=view.querySelector('.bk-card-rail'),selected=rail?[...rail.querySelectorAll('[data-bk-card-key]')].find(button=>button.dataset.bkCardKey===key):null;
  if(!rail?.getBoundingClientRect||!selected?.getBoundingClientRect)return;
  const area=rail.getBoundingClientRect(),item=selected.getBoundingClientRect();if(area.width<=0||item.width<=0)return;
  if(item.right>area.right)rail.scrollLeft+=item.right-area.right+5;else if(item.left<area.left)rail.scrollLeft-=area.left-item.left+5;
}
function keepActiveTeamVisible(root){
  const board=root.querySelector('[data-bk-team-board]'),column=board?.querySelector('.bk-team-column.is-active');
  if(!board?.getBoundingClientRect||!column?.getBoundingClientRect)return;
  const area=board.getBoundingClientRect(),item=column.getBoundingClientRect();
  if(item.right>area.right)board.scrollLeft+=item.right-area.right+2;else if(item.left<area.left)board.scrollLeft-=area.left-item.left+2;
}
const ageBands=[['20s','성인 20대'],['30s','성인 30대'],['40s','성인 40대'],['50s','성인 50대'],['60s','성인 60대']];
const customerPhoneOf=draft=>String(draft.customerContactPhone??draft.customer_contact_phone??((draft.teamPhoneMode??draft.team_phone_mode)==='separate'?'':draft.raw?.L??''));
// 전화·카카오 ID 겸용 표시: 전화가 아니면 '카카오 아이디' 라벨, 둘 다 아니면 빈 문자열.
const contactDisplay=value=>formatTelephone(value)||kakaoContactLabel(value);
function setStableHTML(node,markup){if(!node)return;if(node._bkStableMarkup!==markup&&node.innerHTML!==markup)node.innerHTML=markup;node._bkStableMarkup=markup;}
const ageLabel=draft=>ageBands.find(([key])=>key===draft.ageBand)?.[1]||(draft.age===null||draft.age===undefined?'나이 미확인':`${draft.age}세`);
const booleanAnswer = value => value===true||value===false?value:null;
const aliased = (row,camel,snake) => Object.prototype.hasOwnProperty.call(row,camel)?row[camel]:row[snake];
const skillColumns=[{key:'parallelLongTurn',label:'패러렐 롱턴',sport:'스키',metadata:true},{key:'snowboardNoviceTurn',label:'S자 너비스턴',sport:'보드',metadata:true}];
const rentalColumns=[{key:'rentalPaymentStatus',label:'장비렌탈 결제상태',metadata:'rental'},{key:'rentalHours',label:'장비렌탈 이용시간',metadata:'rental'},{key:'rentalAmount',label:'장비렌탈 금액',metadata:'rental'}];
const hiddenRawColumns=new Set(['S','V','W']);
// 2026-11-15 열 통일(사용자 확정): **구글 스프레드시트(미러 시트) 열 순서 기준**.
// 날짜·시간→종목·업체→담당강사→고객·연락처·팀→인원→종목기술→강습시간→횟수→
// 관계·수준·특이사항→영수증·결제소스→강습료→장비렌탈→요청·입금·미수→패치→정산·원본.
const SHEET_COLUMN_ORDER=['A','B','C','D','E','F','H','L','I','M','parallelLongTurn','snowboardNoviceTurn','N','J','K','O','G','P','Q','T','rentalPaymentStatus','rentalHours','rentalAmount','X','Y','Z','R','U','AA','AB','AC','AD','AE','AF'];
const tableColumns=(()=>{
  const base=RAW_COLUMNS.filter(column=>!hiddenRawColumns.has(column.key)).map(column=>column.key==='U'?{...column,label:'패치요금(합계 제외)'}:column);
  const byKey=new Map([...base,...skillColumns,...rentalColumns].map(column=>[column.key,column]));
  return SHEET_COLUMN_ORDER.map(key=>byKey.get(key)).filter(Boolean);
})();
const passIdOf = row => row?.lessonPassId??row?.lesson_pass_id??null;
const isCancelled = row => ['cancelled','canceled'].includes(row?.status)||!!(row?.cancelled_at||row?.cancelledAt);


function selectedIds(row,schedules=[]) {
  if(Object.prototype.hasOwnProperty.call(row,'instructorIds'))return unique(Array.isArray(row.instructorIds)?row.instructorIds:[]);
  const schedule=schedules.find(item=>item.id===(row.schedule_id||row.scheduleId||row.id));
  return unique([...(row.instructorIds||row.instructor_ids||row.instructor_user_ids||[]),row.instructor_user_id,...(schedule?.instructorUserIds||[]),schedule?.instructorUserId]);
}

/** Retain the source columns verbatim; reservation metadata never replaces a raw cell. */
export function normalizeBookingRow(row={},state={}) {
  const raw={};for(const column of RAW_COLUMNS)raw[column.key]=row.raw?.[column.key]??row.raw_data?.[column.key]??'';
  const rental=rentalDetails(row),schedule=(state.schedules||[]).find(item=>item.id===(row.id||row.schedule_id||row.scheduleId));
  const hasPlan=Object.prototype.hasOwnProperty.call(row,'lessonMinutes')||Object.prototype.hasOwnProperty.call(row,'lesson_minutes');
  const plan=lessonPlanSettings(hasPlan?row:row.schedule||schedule||row);
  return {...row,id:row.id||row.schedule_id||row.scheduleId||'',raw,
    lessonMinutes:plan.lessonMinutes,breakMinutes:plan.breakMinutes,
    ...(Array.isArray(row.participants)?{participants:normalizeParticipants(row.participants,numeric(raw.M))}:{}),
    cashReceiptRequested:typeof aliased(row,'cashReceiptRequested','cash_receipt_requested')==='boolean'?aliased(row,'cashReceiptRequested','cash_receipt_requested'):null,
    cashReceiptNumberMode:aliased(row,'cashReceiptNumberMode','cash_receipt_number_mode')==='manual'?'manual':'team_phone',
    cashReceiptNumber:typeof row.cashReceiptNumber==='string'?row.cashReceiptNumber:'',cashReceiptNumberSet:aliased(row,'cashReceiptNumberSet','cash_receipt_number_set')===true,
    age:row.age??null,ageBand:aliased(row,'ageBand','age_band')||null,juniorPreparation:aliased(row,'juniorPreparation','junior_preparation')===true,
    customerContactPhone:aliased(row,'customerContactPhone','customer_contact_phone')??(aliased(row,'teamPhoneMode','team_phone_mode')==='separate'?'':raw.L),teamPhoneMode:aliased(row,'teamPhoneMode','team_phone_mode')==='separate'?'separate':'same',experienceCount:aliased(row,'experienceCount','experience_count')??null,
    parallelLongTurn:booleanAnswer(aliased(row,'parallelLongTurn','parallel_long_turn')),
    snowboardNoviceTurn:booleanAnswer(aliased(row,'snowboardNoviceTurn','snowboard_novice_turn')),
    lessonPassId:passIdOf(row),
    customerId:aliased(row,'customerId','customer_id')||null,customerTeamId:aliased(row,'customerTeamId','customer_team_id')||null,
    financialVersion:row.financialVersion??row.financial_version??null,
    currentAmountOverride:aliased(row,'currentAmountOverride','current_amount_override')??null,
    currentAmountCorrectionId:aliased(row,'currentAmountCorrectionId','current_amount_correction_id')??null,
    amountCorrectionVersion:aliased(row,'amountCorrectionVersion','amount_correction_version')??0,
    rentalPaymentStatus:rental.status,rentalHours:rental.hours,rentalAmount:rental.amount,
    rentalCustomAmount:Object.prototype.hasOwnProperty.call(row,'rentalCustomAmount')?row.rentalCustomAmount===true:rental.customAmount===true,
    kind:row.kind||'single',isReorder:row.isReorder??row.is_reorder??row.kind==='reorder',designated:row.designated===true,
    preferredInstructorId:aliased(row,'preferredInstructorId','preferred_instructor_user_id')??null,
    seasonId:aliased(row,'seasonId','season_id')??null,seasonTotal:row.seasonTotal??row.season_total??(state.seasonPackages||[]).find(pack=>pack.id===(row.seasonId??row.season_id))?.total_sessions??null,
    // seasonTotalAuto(자동 유도 마커, 2026-11-17)가 재정규화에서 떨어지면 자동 계산된
    // 총회차가 "명시값"으로 둔갑해 회차를 지워도 줄지 않는다. 반드시 함께 통과시킨다.
    ...(Number.isInteger(Number(row.seasonTotalAuto))?{seasonTotalAuto:Number(row.seasonTotalAuto)}:{}),
    sessionNumber:row.sessionNumber??row.session_number??null,
    instructorIds:selectedIds(row,state.schedules),status:row.status||'received',
    expectedUpdatedAt:row.expectedUpdatedAt??row.updated_at??row.updatedAt??null};
}

function bookingState(state,ui,now) {
  const existing=ui.booking||{};
  const settings={date:'',company:'all',sport:'all',kind:'all',assignment:'all',query:'',limit:150,demo:!(state.reservations||[]).length,drawer:null,reviewSaving:false,tab:'intake',...existing};
  if(settings.demo&&!settings.demoData)settings.demoData=createBookingDemo(now);
  if(settings.draft&&['reservation','review'].includes(settings.drawer)){
    settings.teamDeck=ensureDraftDeck(settings.teamDeck,settings.draft,{tab:settings.tab});
    settings.teamDeck=preserveActiveDraft(settings.teamDeck,settings.draft,settings.tab);
    settings.draft=clone(activeDraftCard(settings.teamDeck).draft);
    settings.deckMode??=settings.demo?'demo':'operational';
  }
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
  const make=(id,time,student,extra={})=>({id,raw:{A:date,B:time,C:`${String(Number(time.split(':')[0])+2).padStart(2,'0')}:${time.split(':')[1]}`,D:'스키',E:'곤지암 라이즌',F:'',G:'체험용 예시 예약입니다.',H:`체험 보호자 ${id.slice(-1)}`,I:student,J:'1회',K:'자녀',L:'',M:'1',N:'2시간',O:'입문',P:'',Q:'계좌이체',R:'',S:'',T:'149000',U:'',V:'',W:'',X:'149000',Y:'149000',Z:'0',AA:'1',AB:'',AC:'',AD:'',AE:'',AF:''},age:10,experience_count:0,parallel_long_turn:false,kind:'single',designated:false,instructorIds:[],status:'received',sheet_status:'not_connected',...extra});
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
  rows[3].snowboard_novice_turn=false;rows[3].raw.D='보드';rows[3].raw.K='성인';rows[3].raw.M='2';rows[3].raw.I='체험 강습생 D · 성인 2명';
  rows[4].raw.A=next;rows[4].raw.G='경험 6회 · 패러렐 롱턴 가능 여부 확인 필요';
  rows[5].raw.A=next;rows[5].raw.G='시즌 6회 중 3회차 · 같은 강사 우선 유지';
  for(const index of [1,2,5]){rows[index].raw.H='체험 가족(가상)';rows[index].raw.L='010-0000-0001';rows[index].raw.I=index===1?'첫째':'막내';}
  const past=day(new Date(base.getTime()-8*86400000));
  for(const [index,team]of ['첫째','막내'].entries()){
    const history=make(`DEMO-FAMILY-HISTORY-${index+1}`,index?'13:10':'11:10',team,{age:index?9:10,experience_count:index?4:2,instructorIds:[roster[index].user_id],status:'confirmed'});
    Object.assign(history.raw,{A:past,H:'체험 가족(가상)',L:'010-0000-0001',I:team,J:'1회차',F:roster[index].display_name,G:'가상 가족의 이전 담당 강사 확인용 예시'});rows.push(history);
  }
  const family=customerIdentity(rows[2]),teamKey={name:family.customerName,phone:family.telephone,teamMode:family.teamMode,team:family.teamName,sport:family.sport};
  return {rows,roster,capabilities:[capability(roster[0],true,['스키','보드']),capability(roster[1],true,['스키']),capability(roster[2],false,['스키','보드'])],seasonPackages:[{id:seasonId,customer_name:'체험 가족(가상)',customer_team_key:teamKey,total_sessions:6,instructor_user_id:roster[1].user_id}],timeOffRequests:[],lessonPasses:[],reservationChanges:[]};
}

function contextFor(state,settings,now=new Date()) {
  if(!settings.demo)return {...state,paymentCorrectionHistories:settings.paymentCorrectionHistories||{},bookingNow:now,reservations:(state.reservations||[]).map(row=>normalizeBookingRow(row,state))};
  const demo=settings.demoData;
  const reservations=demo.rows.map(row=>normalizeBookingRow(row,{seasonPackages:demo.seasonPackages}));
  const schedules=reservations.map(row=>{const interval=parseLessonInterval(row);return {id:row.id,start:interval.start,end:interval.end,lessonMinutes:row.lessonMinutes,breakMinutes:row.breakMinutes,instructorUserIds:row.instructorIds,instructorUserId:row.instructorIds[0],location:row.raw.E,customer:bookingTeamLabel(row)};});
  return {...state,...demo,customers:demo.customers||[],customerTeams:demo.customerTeams||[],customerPeople:demo.customerPeople||[],bookingNow:now,lessonPasses:demo.lessonPasses||[],reservationChanges:demo.reservationChanges||[],passBalances:[],reservations,schedules,settings:{...state.settings,...demo.policy}};
}

/** Shared view context keeps the table, timetable and assignment plan in sync. */
export function getBookingContext(state={},ui={},now=new Date()) {
  return contextFor(state,bookingState(state,ui,now),now);
}

export function createBookingDraft(context,now=new Date()) { return newDraft(context,now); }

/** Open a card without replacing another team's in-memory draft. */
export function openBookingDraft(ui,draft,{tab='intake',replaceCurrent=false,baseline}={}){
  const settings=ui.booking||{},mode=settings.demo?'demo':'operational';
  if(settings.deckSaving||settings.reviewSaving)return settings;
  let deck=settings.teamDeck;
  if(settings.deckMode&&settings.deckMode!==mode){if(hasUnsavedTeamDrafts(deck)){settings.deckNotice='작성중 초안을 정리한 뒤 예약 모드를 전환해 주세요.';return settings;}deck=null;settings.deckMode=mode;}
  if(deck?.cards?.length){
    if(settings.draft)deck=preserveActiveDraft(deck,settings.draft,settings.tab);
    if(!draft.id&&!draft.sameCustomerNewTeam&&!replaceCurrent&&hasUnsavedTeamDrafts(deck)){
      const current=activeDraftCard(deck),pending=current&&current.status!=='saved'?current:deck.cards.find(card=>card.status!=='saved');
      if(pending){deck=resumeDraftDeck(selectDraftCard(deck,pending.key));const card=activeDraftCard(deck);ui.booking={...settings,teamDeck:deck,drawer:'reservation',draft:clone(card.draft),tab:card.tab,review:null,deckNotice:'기존 작성하던 카드를 먼저 확인해 주세요',focusExistingDraft:true};return ui.booking;}
    }
    const existing=deck.cards.find(card=>draft.id&&card.serverId===draft.id);
    if(existing?.status==='saved'&&!replaceCurrent)deck=markDraftCardSaved(deck,existing.key,draft);
    deck=addDraftCard(deck,draft,{tab,...(baseline!==undefined?{baseline}:{})});
    if(existing&&replaceCurrent)deck=preserveActiveDraft(deck,draft,tab);
  }else deck=createDraftDeck(draft,{tab,...(baseline!==undefined?{baseline}:{})});
  deck=resumeDraftDeck(deck);const active=activeDraftCard(deck);
  ui.booking={...settings,teamDeck:deck,deckMode:settings.deckMode||mode,drawer:'reservation',draft:clone(active.draft),tab:active.tab,review:null,reviewSaving:false,deckSaving:false,deckMotion:'forward',discardPrompt:false,closeCardKey:null,cardListOpen:false,deckNotice:null,focusNewTeam:draft.sameCustomerNewTeam===true&&!settings.teamDeck?.cards?.some(card=>card.key===active.key),candidateRequestToken:null};
  return ui.booking;
}

/** Closing the editor discards local cards only; saved server reservations stay intact. */
export function closeBookingDrafts(ui){
  const settings=ui.booking;if(!settings)return true;
  if(settings.deckSaving||settings.reviewSaving||settings.deleteSaving||settings.deleteRequest||draftDeckSummary(settings.teamDeck).busy)return false;
  Object.assign(settings,{teamDeck:discardDraftDeck(settings.teamDeck),drawer:null,draft:null,review:null,reviewSaving:false,deckWriteToken:null,discardPrompt:false,closeCardKey:null,cardListOpen:false,cardListQuery:'',candidateRequestToken:null,deckNotice:null,focusNewTeam:false});
  ui.booking=settings;return true;
}
/** Navigation also closes this editor; there is no hidden resume queue. */
export function suspendBookingDrafts(_root,ui){return closeBookingDrafts(ui);}

/** Another family team starts a separate reservation with independent conditions and payment. */
export function createSameCustomerTeamDraft(source,context={},now=new Date(),{copyConditions=false}={}) {
  let draft=newDraft(context,now);const normalized=normalizeBookingRow(source),raw=normalized.raw;
  for(const key of ['H','L','A','B','C','D','E','K','M','N'])draft.raw[key]=raw[key];
  draft.customerContactPhone=customerPhoneOf(normalized);draft.teamPhoneMode='same';draft.raw.L=draft.customerContactPhone;
  draft.customerId=normalized.customerId||draft.customerId;
  if(source.customerDraft)draft.customerDraft=clone(source.customerDraft);
  else if(normalized.customerId)delete draft.customerDraft;
  // 새 팀도 같은 고객 — 저장 전 담아 둔 개인 명부를 그대로 이어서 보여 준다(N1, 2026-11-16).
  if(Array.isArray(source.pendingPeople)&&source.pendingPeople.length)draft.pendingPeople=clone(source.pendingPeople);
  draft.customerTeamId=crypto.randomUUID();draft.teamDraft={id:draft.customerTeamId,customerId:draft.customerId,name:'',phone:'',defaults:{}};
  draft.participants=resizeParticipants([],numeric(draft.raw.M));
  if(copyConditions){for(const key of ['age','ageBand','juniorPreparation','experienceCount','parallelLongTurn','snowboardNoviceTurn'])draft[key]=normalized[key];draft.participants=normalizeParticipants(normalized.participants,numeric(draft.raw.M));draft.raw.O=raw.O;}
  const scheduleSource=source.savedBatchRows?.length>1?{...source,id:'',submissionId:null,dateBatch:{rows:source.savedBatchRows.map(row=>({id:row.id,date:row.raw.A,startTime:row.raw.B,endTime:row.raw.C,company:row.raw.E||raw.E,duration:row.raw.N||raw.N,lessonMinutes:row.lessonMinutes??row.lesson_minutes??null,breakMinutes:row.breakMinutes??row.break_minutes??0,financial:{...row,raw:{...row.raw}}}))}}:source;
  draft=copyBookingDatesForTeam(scheduleSource,draft,{copyFinancials:copyConditions});draft.sameCustomerNewTeam=true;draft.copiedTeamConditions=copyConditions;draft=linkCommonCustomerDraft(source,draft).draft;
  return draft;
}

function prepareCustomerIdentity(draft){
  const next=clone(draft);
  if(next.id&&!next.customerId)return next;
  if(!next.customerId){next.customerId=crypto.randomUUID();next.customerDraft={id:next.customerId,name:'',contacts:[],notes:''};}
  if(!next.customerTeamId){next.customerTeamId=crypto.randomUUID();next.teamDraft={id:next.customerTeamId,customerId:next.customerId,name:'',phone:'',defaults:{}};}
  if(next.customerDraft){next.customerDraft={...next.customerDraft,id:next.customerId,name:next.raw.H,contacts:next.sameCustomerNewTeam?clone(next.customerDraft.contacts||[]):canonicalTelephone(customerPhoneOf(next))?[{label:'고객 연락처',phone:canonicalTelephone(customerPhoneOf(next))}]:[]};}
  if(next.teamDraft)next.teamDraft={...next.teamDraft,id:next.customerTeamId,customerId:next.customerId,name:next.raw.I,phone:next.teamPhoneMode==='separate'?next.raw.L:'',defaults:{sport:next.raw.D,age:next.age,ageBand:next.ageBand,participants:clone(next.participants||[]),juniorPreparation:next.juniorPreparation,experienceCount:next.experienceCount,parallelLongTurn:next.parallelLongTurn,snowboardNoviceTurn:next.snowboardNoviceTurn,raw:Object.fromEntries(['D','K','M','N','O'].map(key=>[key,next.raw[key]]))}};
  return next;
}

export function renderBookingEditor({state={},ui={},escapeHTML=fallbackEscape,now=new Date()}={}) {
  const role=state.profile?.role||ui.role;if(!['admin','counselor'].includes(role))return '';
  const settings=bookingState(state,ui,now);settings.canManagePolicy=role==='admin';if(!settings.canManagePolicy&&settings.drawer==='settings')settings.drawer=null;
  return `<section class="booking-page booking-editor-only">${renderDrawer(settings,contextFor(state,settings,now),escapeHTML)}</section>`;
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
    if(filters.assignment==='unpaid'&&!(financialSummary(row)?.balance>0))return false;
    if(filters.query){
      // 디렉토리에서 바꾼 새 고객·팀 이름으로도 검색된다(표시와 검색 기준 일치, 2026-11-20).
      const directory=directoryDisplayNames(row,state);
      const haystack=`${Object.values(row.raw).join(' ')} ${row.id} ${directory.customerName||''} ${directory.teamName||''}`;
      if(!haystack.normalize('NFKC').toLowerCase().includes(filters.query.normalize('NFKC').toLowerCase()))return false;
    }
    return !isCancelled(row);
  }).sort((a,b)=>`${parseKstDate(a.raw.A)||''} ${a.raw.B}`.localeCompare(`${parseKstDate(b.raw.A)||''} ${b.raw.B}`)||a.id.localeCompare(b.id));
}

function instructorName(id,context) {return context.roster?.find(person=>person.user_id===id)?.display_name||'연결된 강사';}
function rowName(row,context) {return bookingTeamLabel(row,context)||'예약';}
function policyValues(settings={}) {return {bookingExpertMode:settings.bookingExpertMode||'either',bookingExpertAgeMax:settings.bookingExpertAgeMax??7,bookingExpertExperienceMin:settings.bookingExpertExperienceMin??5,bookingExpertParallelMode:settings.bookingExpertParallelMode||'capable',bookingExpertSnowboardMode:settings.bookingExpertSnowboardMode||'capable'};}
function requirementText(result) {return result.needsReview?'확인 필요':result.required?'경력강사 필요':'일반 배정 가능';}
function financialSummary(row){try{return bookingFinancialSummary(row);}catch{return null;}}

// 예약표 정렬·열 필터·색상 (2026-11-15 운영 요청 #12)
function columnCellText(row,column,context){
  const key=column.key;
  if(column.metadata==='rental'){const rental=rentalDetails(row);return key==='rentalPaymentStatus'?rentalStatusLabel(rental.status):key==='rentalHours'?(rental.hours===null?'':`${rental.hours}시간`):rental.amount===null?'':String(rental.amount);}
  if(column.metadata){const answer=row[key];return row.raw.D!==column.sport?'':answer===null?'미확인':answer?'가능':'불가능';}
  if(key==='F')return row.instructorIds.length?row.instructorIds.map(id=>instructorName(id,context)).join(' · '):'미배정';
  if(key==='X'||key==='Z'){const summary=financialSummary(row);const amount=key==='X'?summary?.requested:summary?.balance;return amount===null||amount===undefined?String(row.raw[key]??''):String(amount);}
  // 디렉토리 연결 행의 고객(H)·팀(I) 표시는 최신 디렉토리 이름을 따른다(2026-11-20).
  // raw 스냅샷·매칭 키는 보존 — 정렬·열 필터·표시가 같은 값을 쓰도록 반드시 여기서 치환.
  if(key==='H'||key==='I'){
    const directory=directoryDisplayNames(row,context);
    if(key==='H'&&directory.customerName)return directory.customerName;
    if(key==='I'&&directory.teamName!==null)return directory.teamName||String(row.raw.I??'');
  }
  return String(row.raw[key]??'');
}
const NUMERIC_SORT_KEYS=new Set(['M','T','U','X','Y','Z','AB','rentalAmount','rentalHours']);
function columnSortValue(row,column,context){
  if(column.key==='A')return `${parseKstDate(row.raw.A)||''} ${row.raw.B||''}`;
  const text=columnCellText(row,column,context);
  if(NUMERIC_SORT_KEYS.has(column.key)){const n=Number(String(text).replace(/[^0-9.-]/gu,''));return text.trim()===''?null:Number.isFinite(n)?n:null;}
  return text;
}
export function sortBookingTableRows(rows,settings={},context={}){
  const column=tableColumns.find(item=>item.key===settings.sortKey);
  if(!column||!['asc','desc'].includes(settings.sortDir))return rows;
  const dir=settings.sortDir==='desc'?-1:1,empty=value=>value===null||value===undefined||value==='';
  return rows.map((row,index)=>({row,index,value:columnSortValue(row,column,context)}))
    .sort((a,b)=>{
      if(empty(a.value)&&empty(b.value))return a.index-b.index;
      if(empty(a.value))return 1;if(empty(b.value))return -1;
      const cmp=typeof a.value==='number'&&typeof b.value==='number'?a.value-b.value
        :String(a.value).localeCompare(String(b.value),'ko-KR',{numeric:true});
      return cmp*dir||a.index-b.index;
    }).map(item=>item.row);
}
/** 엑셀식 다중 열 필터: settings.colFilters = {열키:[선택값...]} — 모든 조건 AND. */
export function filterBookingTableRows(rows,settings={},context={},{skipKey=null}={}){
  const filters=settings.colFilters&&typeof settings.colFilters==='object'?settings.colFilters:{};
  let result=rows;
  for(const [key,values] of Object.entries(filters)){
    if(key===skipKey)continue;
    const column=tableColumns.find(item=>item.key===key);
    if(!column||!Array.isArray(values))continue;
    if(!values.length){result=[];continue;}
    const allowed=new Set(values.map(String));
    result=result.filter(row=>allowed.has(columnCellText(row,column,context).trim()||'(비어 있음)'));
  }
  return result;
}
export function bookingRowColorClasses(row){
  const company=String(row?.raw?.E||'');
  const tint=company.includes('캐치')?'bk-co-catch':company.includes('라이즌')?'bk-co-risen':'';
  // 2026-11-15 운영 결정: 빨간 행은 '강습료' 부분미결제만. 장비렌탈 미결제(당일
  // 코코넛 실사용 확인)는 정상 흐름이라 빨간색으로 표시하지 않는다.
  const lessonFee=numeric(row?.raw?.T),paid=numeric(row?.raw?.Y);
  const due=lessonFee!==null&&lessonFee>0&&(paid===null?0:paid)<lessonFee?'bk-row-due':'';
  return [due,tint].filter(Boolean).join(' ');
}

function renderCell(row,column,context,escape) {
  const key=column.key,value=row.raw[key];
  if(column.metadata==='rental'){
    const rental=rentalDetails(row);
    if(key==='rentalPaymentStatus')return badge(rentalStatusLabel(rental.status),rental.status==='onsite_unpaid'?'amber':rental.status==='paid'?'teal':'neutral',escape);
    if(key==='rentalHours')return rental.hours===null?'—':`${rental.hours}시간`;
    return rental.amount===null?'—':`${money(rental.amount)}원`;
  }
  if(column.metadata){const answer=row[key];return row.raw.D!==column.sport?'<span class="bk-skill-na">해당 없음</span>':badge(answer===null?'미확인':answer?'가능':'불가능',answer===null?'amber':answer?'teal':'neutral',escape);}
  if(key==='C')return escape(lessonTimeLabel(value)||'—');
  if(key==='A')return `<strong>${escape(dateText(value))}</strong><small>${badge(kinds[row.kind]||'일반',row.kind==='single'?'neutral':'teal',escape)}${row.kind==='season'?` <span>${escape(row.sessionNumber||'—')}회차</span>`:''}${row.isReorder&&row.kind!=='reorder'?` ${badge('리오더','teal',escape)}`:''}</small>`;
  if(key==='F')return row.instructorIds.length?`<strong>${escape(row.instructorIds.map(id=>instructorName(id,context)).join(' · '))}</strong>${row.lessonPassId||row.designated||row.isReorder||row.kind==='reorder'||row.kind==='season'?'<small class="bk-designated">같은 강사 지정</small>':''}`:`<span class="bk-unassigned">미배정</span>${value?`<small>시트: ${escape(value)}</small>`:''}`;
  if(key==='I'){const requirement=expertRequirement(row,context.settings),pass=(context.lessonPasses||[]).find(item=>item.id===row.lessonPassId);return `<strong>${escape(bookingTeamLabel(row,context)||'—')}</strong><small>${escape(ageLabel(row))} · ${escape(row.experienceCount===null?'경험 미확인':`경험 ${row.experienceCount}회`)}</small>${requirement.required||requirement.needsReview?badge(requirementText(requirement),requirement.needsReview?'amber':'teal',escape):''}${row.juniorPreparation?badge('주니어 기술등급제 준비','teal',escape):''}${row.lessonPassId?badge(pass?`${Number(pass.total_sessions)}회 수강권`:'수강권 연결','neutral',escape):''}`;}
  if(key==='N'&&lessonPlanSettings(row).explicit){const plan=lessonPlanSettings(row);return `<strong>${plan.lessonMinutes/60}시간</strong><small>${plan.breakMinutes?`휴식 ${plan.breakMinutes/60}시간 · 총 ${(plan.lessonMinutes+plan.breakMinutes)/60}시간`:'휴식 없이 연속'}</small>`;}
  if(key==='H'){const d=directoryDisplayNames(row,context);if(d.customerName)return escape(d.customerName);}
  if(key==='G'||key==='O')return `<span class="bk-long-cell">${escape(value||'—')}</span>`;
  if(['T','U','X','Y','Z','AB'].includes(key)){const summary=financialSummary(row),amount=key==='X'?summary?.requested:key==='Z'?summary?.balance:value;return `<span class="${key==='Z'&&Number(amount)>0?'bk-amount-due':''}">${escape(money(amount))}</span>${key==='X'&&rentalDetails(row).amount===null?'<small class="bk-rental-unknown" data-bk-rental-unknown>장비금액 미확인</small>':''}`;}
  return escape(value===''||value===null?'—':value);
}

/** 엑셀식 열 필터 팝오버: 다른 열 필터를 적용한 뒤 남는 값 목록(체크박스·건수). */
function filterPopoverValues(settings,allRows,context,key){
  const column=tableColumns.find(item=>item.key===key);if(!column)return null;
  const scoped=filterBookingTableRows(allRows,settings,context,{skipKey:key});
  const counts=new Map();
  for(const row of scoped){const value=columnCellText(row,column,context).trim()||'(비어 있음)';counts.set(value,(counts.get(value)||0)+1);}
  const values=[...counts.keys()].sort((a,b)=>a.localeCompare(b,'ko-KR',{numeric:true})).slice(0,300);
  return {column,values,counts};
}
function renderFilterPopover(settings,allRows,context,escape){
  const key=settings.filterOpenKey;if(!key)return '';
  const info=filterPopoverValues(settings,allRows,context,key);if(!info)return '';
  const active=settings.colFilters?.[key];
  const selected=Array.isArray(active)?new Set(active.map(String)):null; // null = 전체 선택
  return `<div class="bk-filter-pop" data-bk-filter-pop role="dialog" aria-label="${escape(info.column.label||key)} 열 필터"><header><strong>${escape(info.column.label||key)} 필터</strong><button type="button" class="icon-btn" data-bk-filter-close aria-label="필터 닫기">×</button></header><input type="search" data-bk-filter-search placeholder="값 검색" autocomplete="off"><div class="bk-filter-actions"><button type="button" data-bk-filter-all>전체 선택</button><button type="button" data-bk-filter-none>전체 해제</button></div><div class="bk-filter-list">${info.values.map(value=>`<label data-bk-filter-row><input type="checkbox" data-bk-filter-value="${escape(value)}" ${!selected||selected.has(value)?'checked':''}> <span>${escape(value)}</span><small>${info.counts.get(value)}</small></label>`).join('')||'<p class="bk-field-note">표시할 값이 없습니다.</p>'}</div><footer><button type="button" class="btn ghost small" data-bk-filter-clear>이 열 필터 지우기</button><button type="button" class="btn secondary small" data-bk-filter-close>닫기</button></footer></div>`;
}
function renderTable(rows,context,settings,escape,allRows=rows) {
  const sorted=sortBookingTableRows(rows,settings,context);
  const shown=sorted.slice(0,settings.limit);
  const sortMark=key=>settings.sortKey===key?(settings.sortDir==='desc'?' ▼':' ▲'):'';
  const ariaSort=key=>settings.sortKey===key?(settings.sortDir==='desc'?'descending':'ascending'):'none';
  return `<section class="panel bk-table-panel${settings.tableFullscreen?' bk-table-panel--full':''}"><div class="bk-table-title"><div><h2>전체 예약·배정표 <span>${rows.length}<small>건</small></span></h2><p>한 행에 한 강습 · 행의 예약 변경을 누르면 모든 항목을 수정할 수 있습니다</p></div><div class="bk-table-title-actions"><button type="button" class="btn ${settings.tableFullscreen?'primary':'secondary'} small" data-bk-fullscreen aria-pressed="${settings.tableFullscreen?'true':'false'}">${settings.tableFullscreen?'✕ 전체화면 닫기 (Esc)':'⛶ 표 전체화면'}</button><span class="bk-scroll-note">모든 항목을 좌우로 확인하세요 ↔</span></div></div><div class="bk-table-scroll" tabindex="0" role="region" aria-label="전체 예약 원본 항목과 강사 배정표"><table class="bk-table"><caption class="bk-sr-only">기존 시트 열 순서를 유지한 예약 ${rows.length}건</caption><thead><tr><th class="bk-col-bulk" scope="col" title="그룹 수정 선택"><input type="checkbox" data-bk-bulk-all aria-label="표시된 예약 전체 선택"${shown.length&&shown.every(row=>(settings.bulkIds||[]).includes(row.id))?' checked':''}></th>${tableColumns.map(column=>`<th scope="col" class="bk-col-${column.key}${settings.sortKey===column.key?' bk-sorted':''}" data-bk-sort="${column.key}" aria-sort="${ariaSort(column.key)}" title="클릭하여 정렬"><span class="bk-column-letter">${escape(column.metadata==='rental'?'장비렌탈':column.metadata?column.sport:column.key)}</span>${escape(column.label||`원본 ${column.key}`)}<span class="bk-sort-mark">${sortMark(column.key)}</span><button type="button" class="bk-filter-btn${Array.isArray(settings.colFilters?.[column.key])?' is-active':''}" data-bk-colfilter="${column.key}" aria-label="${escape(column.label||column.key)} 열 필터" title="엑셀식 필터">▾</button></th>`).join('')}<th class="bk-table-action" scope="col">예약 관리</th></tr></thead><tbody>${shown.map(row=>`<tr data-booking-row="${escape(row.id)}" class="${[settings.draft?.id===row.id?'selected':'',bookingRowColorClasses(row)].filter(Boolean).join(' ')}"><td class="bk-col-bulk"><input type="checkbox" data-bk-bulk-row="${escape(row.id)}"${(settings.bulkIds||[]).includes(row.id)?' checked':''} aria-label="그룹 수정 선택"></td>${tableColumns.map(column=>`<td class="bk-col-${column.key}">${renderCell(row,column,context,escape)}</td>`).join('')}<td class="bk-table-action"><button type="button" class="btn secondary small" data-bk-open="${escape(row.id)}">예약 변경</button><button type="button" class="btn ghost small" data-bk-detail="${escape(row.id)}">전체보기</button></td></tr>`).join('')||`<tr><td colspan="${tableColumns.length+2}" class="bk-table-empty"><strong>조건에 맞는 예약이 없습니다.</strong><p>조회 조건을 바꾸거나 새 예약을 등록해 주세요.</p></td></tr>`}</tbody></table></div>${renderFilterPopover(settings,allRows,context,escape)}<div class="bk-table-bottom"><span>${settings.demo?'체험 데이터 · 서버와 구글시트에 저장하지 않습니다.':'웹에서 저장한 예약 · 자동 기록 상태는 Google Sheets 표시에서 확인하세요.'}</span>${shown.length<rows.length?`<button type="button" class="btn ghost small" data-bk-more>150건 더 보기 (${shown.length}/${rows.length})</button>`:'<span>원본 형식 유지 · 중복 항목 숨김</span>'}</div></section>`;
}

function renderTimeSummary(rows,context,escape) {
  const groups=new Map();for(const row of rows){const key=`${parseKstDate(row.raw.A)||''} ${row.raw.B}`;const group=groups.get(key)||{date:row.raw.A,time:row.raw.B,lessons:0,people:0,unassigned:0};group.lessons++;group.people+=numeric(row.raw.M)||0;if(!row.instructorIds.length)group.unassigned++;groups.set(key,group);}
  return `<details class="bk-time-summary"><summary>시간대별 수량 확인 <span>${groups.size}개 시간대</span></summary><div>${[...groups.values()].map(group=>`<article><span>${escape(dateText(group.date))} <strong>${escape(group.time)}</strong></span><span>강습 <b>${group.lessons}</b>건 · 인원 <b>${group.people}</b>명 ${group.unassigned?`· <em>미배정 ${group.unassigned}건</em>`:''}</span></article>`).join('')||'<p>표시할 시간대가 없습니다.</p>'}</div></details>`;
}

function inputField(key,label,value,escape,attrs='') {return `<label class="field bk-field-${key}"><span class="field-label">${escape(label)}</span><input name="raw_${escape(key)}" value="${escape(value)}" ${attrs}></label>`;}
function selectField(name,label,value,choices,escape,attrs='') {if(value!==''&&value!==null&&value!==undefined&&!choices.some(([key])=>String(key)===String(value)))choices=[[value,String(value)],...choices];return `<label class="field"><span class="field-label">${escape(label)}</span><select name="${escape(name)}" ${attrs}>${choices.map(([key,text])=>option(key,text,value,escape)).join('')}</select></label>`;}
function rawTextarea(key,label,value,escape,rows=3) {return `<label class="field bk-field-${key}"><span class="field-label">${escape(label)}</span><textarea name="raw_${escape(key)}" rows="${rows}">${escape(value)}</textarea></label>`;}

function renderSportSkillFields(draft,escape) {
  const active=sportSkill(draft);
  return `<div class="bk-sport-skill-fields" data-bk-sport-skills>${skillColumns.map(column=>`<div data-bk-skill-sport="${column.sport}" ${active.sport===column.sport?'':'hidden'}>${selectField(column.key,`${column.sport} · ${column.label} 가능 여부`,draft[column.key]===null?'':String(draft[column.key]),[['','미확인'],['true','가능'],['false','불가능']],escape,active.sport===column.sport?'':'disabled')}</div>`).join('')}</div>`;
}

function syncSportSkillFields(form,draft) {
  const active=sportSkill(draft);
  form.querySelectorAll('[data-bk-skill-sport]').forEach(element=>{
    const applies=element.dataset.bkSkillSport===active.sport;
    element.hidden=!applies;
    element.querySelectorAll('select').forEach(select=>select.disabled=!applies);
  });
}

function passAvailable(pass,context) {
  const balance=(context.passBalances||[]).find(row=>(row.id||row.lesson_pass_id)===pass.id);
  const provided=balance?.available_sessions??balance?.remaining_sessions??pass.available_sessions??pass.remaining_sessions;
  if(provided!==undefined&&provided!==null&&Number.isFinite(Number(provided)))return Number(provided);
  const linked=(context.reservations||[]).filter(row=>passIdOf(row)===pass.id&&!['cancelled','canceled'].includes(row.status)).length;
  return Math.max(0,Number(pass.total_sessions||0)-linked);
}

const wantsSameInstructor=draft=>draft.designated||draft.isReorder||draft.kind==='reorder';
function customerIdentitySignature(draft){const identity=customerIdentity(draft);return JSON.stringify([identity.customerKey,identity.teamKey,identity.sport]);}
function customerPhoneNotice(draft,context) {
  const phone=customerPhoneOf(draft).trim();
  if(draft.contactKakaoMode&&!phone)return {invalid:true,text:'카카오톡 ID를 입력해 주세요. 전화번호를 받으면 예외 체크를 해제하세요.'};
  if(!phone)return {invalid:false,text:'전화번호를 입력하면 같은 고객의 팀과 강습 이력을 확인할 수 있습니다.'};
  if(kakaoContactId(phone))return {invalid:false,text:'전화 대신 카카오톡 ID로 기록합니다. 알림톡·문자는 발송되지 않아 안내는 직접 전달해 주세요.'};
  if(canonicalTelephone(phone))return {invalid:false,text:draft.customerId&&!draft.customerDraft?'선택한 고객에 연결된 이번 예약의 연락처입니다.':'기존 고객 후보를 선택하면 연락처가 달라도 같은 고객 이력으로 이어집니다.'};
  const original=(context.reservations||[]).find(row=>row.id===draft.id);
  const unchanged=original&&customerPhoneOf(original)===customerPhoneOf(draft);
  return {invalid:true,text:unchanged?'연락처 확인 필요 · 이력 자동 대조 안 함':'전화번호 형식을 확인해 주세요. 예: 010-1234-5678 · 해외 고객은 카카오톡 ID 예외를 선택하세요.'};
}

function renderCustomerTeamChoices(draft,context,escape) {
  const result=customerTeamHistory(draft,context,{now:context.bookingNow});
  return result.canMatch&&result.teams.length?`<span class="bk-team-choice-label">이 고객의 기존 팀</span><div class="bk-team-chips">${result.teams.map(team=>`<button type="button" class="${team.key===result.identity.teamKey?'selected':''}" data-bk-team="${escape(team.key)}" data-bk-customer-key="${escape(result.identity.customerKey)}" data-bk-team-value="${escape(team.isDefault?'':team.label)}">${escape(team.label)}<small>${!team.isDefault&&team.label==='기본 1팀'?'이름 지정 · ':''}${Number(team.bookingCount)||0}건</small></button>`).join('')}</div>`:'';
}

function renderCustomerHistory(draft,context,escape) {
  const result=customerTeamHistory(draft,context,{now:context.bookingNow}),identity=customerIdentitySignature(draft);
  return `<section class="bk-customer-history"><header><h4>같은 팀 강습 이력</h4><span>${escape(result.identity.teamLabel||'기본 1팀')} · ${escape(result.identity.sport||draft.raw.D||'종목 미선택')}</span></header>${result.canMatch?`${result.suggestedInstructorIds.length?`<div class="bk-history-recommendations"><span>이전 담당 강사</span>${result.suggestedInstructorIds.map(id=>`<button type="button" class="btn secondary small" data-bk-history-instructor="${escape(id)}" data-bk-history-identity="${escape(identity)}">${escape(changeInstructorName(id,context))} · 이 강사 지정</button>`).join('')}</div>`:''}${result.history.length?`<div class="bk-team-history-scroll"><table class="bk-team-history-table"><thead><tr><th>날짜·시간</th><th>팀·회차</th><th>담당 강사</th></tr></thead><tbody>${result.history.map(item=>`<tr><td>${escape(parseKstDate(item.date)?.replaceAll('-','.')||item.date||'—')}<small>${escape(item.startTime||'')}–${escape(item.endTime||'')} · ${escape(item.timingLabel||'시간 확인 필요')}</small></td><td>${escape(item.teamLabel)}<small>${escape(item.sessionLabel||'—')}</small></td><td>${escape(item.instructorLabel||'미배정')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="bk-field-note">같은 고객·팀·종목으로 등록한 다른 강습이 없습니다.</p>'}`:`<p class="bk-field-note">${escape(result.notice||'고객명과 올바른 전화번호를 입력하면 이력을 확인할 수 있습니다.')}</p>`}</section>`;
}

function renderDateCalendar(draft,escape){
  if(!draft.datePickerOpen||draft.id)return '';
  const month=/^\d{4}-\d{2}$/.test(draft.datePickerMonth||'')?draft.datePickerMonth:(parseKstDate(draft.raw.A)||day(new Date())).slice(0,7);
  const start=new Date(`${month}-01T00:00:00Z`),days=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate(),offset=start.getUTCDay(),rows=bookingDateRows(draft),selected=new Set(rows.map(row=>row.date));
  return `<div class="bk-date-calendar" data-bk-date-calendar><label class="field"><span class="field-label">날짜를 여러 개 선택하세요</span><input type="month" name="batchCalendarMonth" value="${escape(month)}"></label><div class="bk-calendar-grid">${weekdays.map(label=>`<span>${label}</span>`).join('')}${Array.from({length:offset},()=>'<i></i>').join('')}${Array.from({length:days},(_,index)=>{const date=`${month}-${String(index+1).padStart(2,'0')}`,on=selected.has(date);return `<button type="button" data-bk-date-pick="${date}" aria-pressed="${on}" class="${on?'selected':''}" ${on&&rows.length===1?'disabled title="마지막 일정은 회차 카드의 날짜 입력란에서 변경해 주세요."':''}>${index+1}${on?'<small>선택</small>':''}</button>`;}).join('')}</div><p class="bk-field-note">선택한 날짜를 다시 누르면 취소됩니다. 마지막 일정은 회차 카드의 날짜 입력란에서 변경해 주세요. 빠른 날짜부터 왼쪽 → 오른쪽으로 정렬합니다. 시간·요금은 첫 회차에서 가져오고 입금액은 0원으로 시작합니다.</p><button type="button" class="btn primary small" data-bk-calendar-done>날짜 선택 완료 · ${rows.length}회</button></div>`;
}

function lessonPlanChoices(booking,{review=false}={}){const plan=lessonPlanSettings(booking);return [...(!plan.explicit?[['',review?'강습시간 확인':'기존 입력 유지']]:[]),['120','2시간 강습'],['240','4시간 강습']];}
function datePlanDraft(row){return {paymentNeedsBreakConfirmation:row.paymentNeedsBreakConfirmation,lessonMinutes:row.lessonMinutes,breakMinutes:row.breakMinutes,raw:{A:row.date,B:row.startTime,C:row.endTime,E:row.company,N:row.duration}};}
function lessonClock(value,date){const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));return day(value)!==parseKstDate(date)?clock==='00:00'?'24:00':`익일 ${clock}`:clock;}
function renderLessonTimeline(booking,escape){
  const plan=lessonPlanSettings(booking),raw=booking.raw||{};
  if(booking.paymentNeedsBreakConfirmation&&plan.lessonMinutes===240)return '<p class="bk-plan-note is-incomplete">4시간 강습의 중간 휴식을 확인해 주세요.</p>';
  if(!plan.explicit)return '<p class="bk-plan-note">기존에 입력한 시작·종료시간을 유지합니다. 2시간 또는 4시간을 선택하면 종료시간이 자동 계산됩니다.</p>';
  const interval=parseLessonInterval(booking);
  if(interval.error)return `<p class="bk-plan-note is-incomplete">${escape(plan.error||(!lessonPlanEndTime(raw.B,plan.lessonMinutes,plan.breakMinutes)?'시작시간을 00:00~23:59 사이로 입력해 주세요. 야간 강습은 다음 날까지 이어질 수 있습니다.':interval.error))}</p>`;
  const segments=[];
  interval.lessonSegments.forEach((segment,index)=>{segments.push({...segment,type:'lesson',label:`강습 ${Math.round((Date.parse(segment.end)-Date.parse(segment.start))/60000)/60}시간`});if(index===0&&interval.breakSegment)segments.push({...interval.breakSegment,type:'break',label:`휴식 ${plan.breakMinutes/60}시간`});});
  return `<div class="bk-lesson-timeline" data-bk-lesson-timeline><div class="bk-lesson-timeline-heading"><strong>강습 ${plan.lessonMinutes/60}시간${plan.breakMinutes?` + 휴식 ${plan.breakMinutes/60}시간`:''}</strong><span>전체 일정 ${(plan.lessonMinutes+plan.breakMinutes)/60}시간</span></div><div class="bk-lesson-segments">${segments.map(segment=>`<div class="bk-lesson-segment ${segment.type}"><strong>${escape(segment.label)}</strong><span>${escape(lessonClock(segment.start,raw.A))}–${escape(lessonClock(segment.end,raw.A))}</span></div>`).join('')}</div>${plan.breakMinutes?`<p class="bk-plan-note">${plan.breakMinutes===120?'2시간 휴식 중에는 담당 강사에게 다른 2시간 강습을 배정할 수 있습니다.':'1시간 휴식도 담당 강사의 일정에 포함됩니다.'}</p>`:''}</div>`;
}
function renderLessonPlanFields(booking,escape,{rowId=null,review=false}={}){
  const plan=lessonPlanSettings(booking),raw=booking.raw||{},prefix=rowId?`date_${rowId}_`:'',lessonName=`${prefix}lessonMinutes`,breakName=`${prefix}breakMinutes`,endName=rowId?`${prefix}endTime`:'raw_C',durationName=rowId?`${prefix}duration`:'raw_N';
  return `<div class="bk-lesson-plan ${plan.lessonMinutes===240?'has-break':''}" data-bk-plan-fields="${escape(rowId||'primary')}"><div class="bk-plan-options">${selectField(lessonName,'강습 시간',plan.lessonMinutes===null?'':String(plan.lessonMinutes),lessonPlanChoices(booking,{review}),escape,`data-bk-plan-duration-select ${rowId?'data-bk-date-field="lessonMinutes"':''}`)}<div data-bk-plan-break ${plan.lessonMinutes===240?'':'hidden'}>${selectField(breakName,'2시간 강습 후 중간 휴식',booking.paymentNeedsBreakConfirmation?'':String(plan.breakMinutes),[...(booking.paymentNeedsBreakConfirmation?[['','휴식 여부 확인']]:[]),['0','휴식 없이 4시간 연속'],['60','1시간 쉬고 2시간 더'],['120','2시간 쉬고 2시간 더']],escape,`data-bk-plan-break-select ${booking.paymentNeedsBreakConfirmation?'required':''} ${rowId?'data-bk-date-field="breakMinutes"':''} ${plan.lessonMinutes===240?'':'disabled'}`)}</div><label class="field bk-plan-end"><span class="field-label">종료시간 <small data-bk-plan-end-note>${plan.explicit||review?'자동 계산':'직접 입력'}${lessonTimeLabel(raw.C)!==String(raw.C||'')?` · ${escape(lessonTimeLabel(raw.C))}`:''}</small></span><input name="${escape(endName)}" value="${escape(raw.C||'')}" placeholder="${review?'시작시간·강습시간 확인 후 계산':'11:00'}" ${plan.explicit||review?'readonly aria-readonly="true"':'required'} data-bk-plan-end-input></label><label class="field bk-plan-legacy-duration" data-bk-plan-legacy ${plan.explicit||review?'hidden':''}><span class="field-label">기존 강습시간 표기 <small>N</small></span><input name="${escape(durationName)}" value="${escape(raw.N||'')}" ${plan.explicit?'readonly':''} data-bk-plan-raw-duration></label></div><div class="bk-plan-preview" data-bk-plan-preview aria-live="polite">${review&&!plan.explicit?'<p class="bk-plan-note">강습시간과 시작시간을 확인하면 종료시간이 계산됩니다.</p>':renderLessonTimeline(booking,escape)}</div></div>`;
}
function sessionDraft(draft,row){const next={...draft,...(row.financial||{}),raw:{...draft.raw,...(row.financial?.raw||{}),A:row.date,B:row.startTime,C:row.endTime,E:row.company,N:row.duration},id:'',lessonMinutes:row.lessonMinutes,breakMinutes:row.breakMinutes,paymentNeedsBreakConfirmation:row.paymentNeedsBreakConfirmation===true,paymentReviewedRentalFee:row.paymentReviewedRentalFee??null};for(const key of ['paymentRequestCorrection','currentAmountOverride','currentAmountCorrectionId','amountCorrectionVersion'])if(!Object.hasOwn(row.financial||{},key))delete next[key];return next;}
function renderExtraDateRow(row,index,escape,context,draft){
  const value=sessionDraft(draft,row);
  return `<article class="bk-date-row" data-bk-date-row="${escape(row.id)}"><div class="bk-date-row-title"><strong>${index+2}회차</strong><span data-bk-session-date>${escape(dateText(row.date))}</span><button type="button" class="btn ghost small" data-bk-date-remove="${escape(row.id)}" aria-label="${index+2}회 일정 삭제" title="이 회차 빼기">×</button></div><div class="bk-session-body"><div class="bk-session-timing"><div class="bk-date-row-fields"><label class="field"><span class="field-label">날짜 <b>*</b></span><input name="date_${escape(row.id)}_date" type="date" required data-bk-date-field="date" data-bk-date-id="${escape(row.id)}" value="${escape(row.date||'')}"></label>${startTimeField(`date_${row.id}_startTime`,row.startTime,escape,`required data-bk-date-field="startTime" data-bk-date-id="${escape(row.id)}"`)}</div>${renderLessonPlanFields(datePlanDraft(row),escape,{rowId:row.id})}</div>${rawFinancial(value,escape,{rowId:row.id})}</div></article>`;
}
function renderSessionJumps(draft,escape){
  const rows=bookingDateRows(draft);if(rows.length<2)return '';
  return `<nav class="bk-session-jumps" aria-label="회차 바로가기">${rows.map((row,index)=>`<button type="button" data-bk-session-jump="${escape(row.id)}">${index+1}회 · ${escape(dateText(row.date))}</button>`).join('')}</nav>`;
}
function renderTeamSchedule(draft,context,escape){
  const raw=draft.raw,rows=bookingDateRows(draft),extra=rows.slice(1);
  // 날짜 미정 수강권(2026-11-16 확정): 팝업이 아니라 이 날짜지정 블록 자체가 발급 모드로 바뀐다.
  // 날짜·시간만 생략하고 몇 시간권·총 횟수·강습료·장비 결제상태·받아야 할/받은/미수금을 그대로 받는다.
  if(!draft.id&&draft.passIssueMode){
    const done=draft.passIssueDone;
    return `<section class="bk-team-schedule bk-pass-mode" data-bk-team-schedule data-bk-pane="financial"><div class="bk-section-label"><span>03</span><h3>수강권으로 발급</h3><small>날짜·시간 미정</small></div>
    <p class="bk-session-caption">날짜·시간 지정만 생략합니다. 몇 시간권 · 몇 회인지와 금액을 확인하고 발급하세요. <button type="button" class="btn ghost small" data-bk-pass-mode-off>← 날짜 지정으로 돌아가기</button></p>
    ${(Array.isArray(draft.passConfigs)&&draft.passConfigs.length?draft.passConfigs:[{issueId:'seed',minutes:String(raw.N||'').trim(),sessions:draft.passTotalSessions??'',fee:raw.T??'',done:null}]).map((config,index)=>`<div class="bk-form-grid bk-pass-terms" data-bk-pass-config="${escape(config.issueId)}">
      <label class="field"><span class="field-label">몇 시간권 <b>*</b></span><select name="passCfg_${escape(config.issueId)}_minutes" required ${config.done?'disabled':''}><option value="">선택해 주세요</option><option value="2시간" ${config.minutes==='2시간'?'selected':''}>2시간권</option><option value="4시간" ${config.minutes==='4시간'?'selected':''}>4시간권</option></select></label>
      <label class="field"><span class="field-label">횟수 <b>*</b></span><span class="bk-suffixed"><input name="passCfg_${escape(config.issueId)}_sessions" type="number" min="1" max="100" step="1" required inputmode="numeric" value="${escape(String(config.sessions??''))}" placeholder="회" ${config.done?'disabled':''}><span>회</span></span></label>
      <label class="field"><span class="field-label">회당 강습료 <b>*</b></span><span class="bk-suffixed"><input name="passCfg_${escape(config.issueId)}_fee" type="number" min="0" step="1" required inputmode="numeric" value="${escape(String(config.fee??''))}" placeholder="원" ${config.done?'disabled':''}><span>원</span></span></label>
      <div class="field bk-pass-config-state">${config.done?`<span class="bk-pass-inline-done" role="status">발급 완료${config.done.passId?` · 끝자리 ${escape(String(config.done.passId).slice(-6))}`:''}</span>`:(Array.isArray(draft.passConfigs)&&draft.passConfigs.length>1?`<button type="button" class="btn ghost small" data-bk-pass-config-remove="${escape(config.issueId)}" title="이 구성 빼기">×</button>`:'')}</div>
    </div>`).join('')}
    <p><button type="button" class="btn secondary small" data-bk-pass-config-add>＋ 다른 시간권 추가 (예: 4시간권 몇 회 추가)</button></p>
    ${rawFinancial(draft,escape,{}).replace('이 회차의 금액','수강권 금액 · 장비는 회당 기준')}
    <p class="bk-field-note">받아야 할 금액(자동) = 각 구성의 (회당 강습료 + 장비 결제완료 금액) × 횟수의 합. 받은 금액과의 차액이 미수금입니다.</p>
    ${done?`<p class="bk-pass-inline-done" role="status">수강권 발급 완료 — 수강권 탭에서 일정 등록·고객 링크를 이어갈 수 있습니다.</p>`:''}
    <p class="bk-form-error" data-bk-pass-inline-error role="alert" hidden></p>
    <div class="bk-pass-inline-actions"><button type="submit" class="btn primary" data-bk-pass-inline-issue ${done?'disabled':''}>${done?'발급 완료':'이 팀 수강권 발급'}</button></div></section>`;
  }
  return `<section class="bk-team-schedule" data-bk-team-schedule data-bk-pane="financial"><div class="bk-section-label"><span>03</span><h3>회차별 일정·금액</h3><small>${draft.id?'예약된 1회차':`${rows.length}회 접수`}</small></div><p class="bk-session-caption">빠른 날짜부터 왼쪽 → 오른쪽 · 입금액도 해당 회차에 기록합니다.</p>${!draft.id?`<div class="bk-session-toolbar"><div class="bk-schedule-actions"><button type="button" class="btn secondary small" data-bk-calendar-toggle aria-expanded="${!!draft.datePickerOpen}">달력에서 여러 날짜 선택</button><button type="button" class="btn secondary small" data-bk-issue-pass title="날짜를 정하지 않은 구매는 수강권으로 발급합니다">날짜 미정 · 수강권으로 발급 →</button></div>${extra.length?`<div class="bk-bulk-apply"><h4>첫 회차 기준으로 빠르게 입력</h4><p>총 ${rows.length}회차에 적용 · 이후 개별 수정 가능</p><div class="bk-bulk-buttons"><button type="button" class="bk-bulk-button" data-bk-common-dates><span aria-hidden="true">◷</span><span><strong>시간·휴식 같게 적용</strong><small>시작시간 · 강습시간 · 중간 휴식</small></span></button><button type="button" class="bk-bulk-button" data-bk-common-fees><span aria-hidden="true">₩</span><span><strong>${draft.paymentReviewId?'강습료·장비요금 같게 적용':'강습료·장비요금·입금액 같게 적용'}</strong><small>${draft.paymentReviewId?'입금 배분액은 복사하지 않습니다':'1회차 금액을 각 회차에 복사'}</small></span></button></div><div data-bk-bulk-feedback role="status" aria-live="polite"></div></div>`:''}</div>`:''}<div class="bk-session-workspace ${draft.datePickerOpen&&!draft.id?'calendar-open':''}">${renderDateCalendar(draft,escape)}<div class="bk-session-branches">${renderSessionJumps(draft,escape)}<div class="bk-session-list bk-session-board" data-bk-session-list><article class="bk-date-row bk-primary-date" data-bk-date-row="${escape(rows[0].id)}"><div class="bk-date-row-title"><strong>1회차</strong><span data-bk-session-date>${escape(dateText(raw.A))}</span>${!draft.id&&extra.length?`<button type="button" class="btn ghost small" data-bk-date-remove="${escape(rows[0].id)}" aria-label="1회 일정 삭제" title="이 회차 빼기">×</button>`:''}</div><div class="bk-session-body"><div class="bk-session-timing"><div class="bk-form-grid bk-first-date">${inputField('A','날짜',parseKstDate(raw.A)||'',escape,'type="date" required')}${startTimeField('raw_B',raw.B,escape,'required')}</div>${renderLessonPlanFields(draft,escape)}</div>${rawFinancial(draft,escape,{history:context.paymentCorrectionHistories?.[draft.id]})}</div></article>${extra.map((row,index)=>renderExtraDateRow(row,index,escape,context,draft)).join('')}</div><div class="bk-grand-total" data-bk-grand-total hidden aria-live="polite"></div></div></div>${draft.savedBatchRows?.length?`<div class="bk-saved-batch" data-bk-saved-batch><strong>함께 저장한 ${draft.savedBatchRows.length}회</strong>${draft.savedBatchRows.map(row=>`<button type="button" class="btn ghost small" data-bk-open-saved-date="${escape(row.id)}">${escape(dateText(row.raw?.A))} · ${escape(row.raw?.B)}–${escape(row.raw?.C)} <span>예약 변경 →</span></button>`).join('')}</div>`:''}</section>`;
}

function directoryCustomer(draft,context){return (context.customers||[]).find(customer=>customer.id===draft.customerId)||null;}
// 고객 공통의 개인(1..n) 명부 관리 — 팀 참가자는 아래 팀 정보에서 클릭 선택한다.

// 수강권 인라인 발급(2026-11-15 확정): 별도 페이지·드로어 없이 예약창 그대로.
// 고객·명부·팀 입력을 쓰고, 날짜만 생략한 채 팀별 '몇 회'만 받아 발급한다.
// 수강권에 같이 실을 조건(2026-11-15 확정): 날짜만 미정일 뿐 회당 강습시간·강습료·장비·입금을
// 예약폼 값 그대로 담는다. 수강권 테이블에 별도 열이 없어 notes에 표준 줄로 적는다.
export function passIssueCarryLines(draft){
  const raw=draft?.raw||{};const lines=[];
  if(String(raw.N||'').trim())lines.push(`회당 강습시간: ${String(raw.N).trim()}`);
  if(numeric(raw.T))lines.push(`회당 강습료: ${money(numeric(raw.T))}원`);
  if(draft?.rentalPaymentStatus){
    const label=rentalStatusLabel(draft.rentalPaymentStatus)||draft.rentalPaymentStatus;
    lines.push(`장비: ${label}${[4,6].includes(draft.rentalHours)?` · ${draft.rentalHours}시간`:''}${Number.isInteger(draft.rentalAmount)?` · ${money(draft.rentalAmount)}원`:''}`);
  }
  if(numeric(raw.X)!==null)lines.push(`받아야 할 금액: ${money(numeric(raw.X))}원 (총액)`);
  if(numeric(raw.Y))lines.push(`받은 금액: ${money(numeric(raw.Y))}원`);
  if(numeric(raw.Z)!==null&&numeric(raw.Z)>0)lines.push(`미수금: ${money(numeric(raw.Z))}원`);
  return lines;
}
// 수강권 캐리라인 역파싱(2026-11-17 사용자 확정): 발급 때 넣은 시간권·비율·강습료·장비를
// 일정 등록 프리필로 쓴다 — 고객에게 이미 받은 값을 다시 묻지 않는다.
// 줄 형식은 passIssueCarryLines/createPaymentPassDraft가 쓰는 표준 문구와 같아야 한다.
export function parsePassCarry(pass={}){
  const lines=String(pass.notes||'').split('\n').map(line=>line.trim());
  const take=prefix=>{const line=lines.find(item=>item.startsWith(prefix));return line?line.slice(prefix.length).trim():'';};
  const amountOf=value=>{const match=/([0-9][0-9,]*)\s*원/.exec(value);return match?Number(match[1].replace(/,/g,'')):null;};
  const minutes=[120,240].includes(Number(pass.lessonMinutes??pass.lesson_minutes))?Number(pass.lessonMinutes??pass.lesson_minutes):null;
  const ratio=/^1:(\d{1,2})$/.exec(String(pass.lessonRatio??pass.lesson_ratio??'').trim());
  const fee=amountOf(take('회당 강습료:'));
  const rentalLine=take('장비:');
  const rentalStatus=rentalLine.includes('결제완료')?'paid':rentalLine.includes('무료')?'free':rentalLine.includes('미결제')?'onsite_unpaid':null;
  const rentalHours=/([46])\s*시간/.exec(rentalLine);
  return {minutes,students:ratio?Number(ratio[1]):null,fee,
    rental:rentalStatus?{status:rentalStatus,hours:rentalHours?Number(rentalHours[1]):null,amount:rentalStatus==='free'?0:amountOf(rentalLine)}:null};
}
export function applyPassCarryDraft(draft,pass){
  if(!pass)return draft;
  const carry=parsePassCarry(pass);let next=clone(draft);
  if(carry.minutes){next=applyLessonPlan(next,{lessonMinutes:carry.minutes,breakMinutes:carry.minutes===240?(next.breakMinutes??0):0});next.raw={...next.raw,N:`${carry.minutes/60}시간`};}
  if(carry.students){next.raw={...next.raw,M:String(carry.students)};next.participants=resizeParticipants(next.participants,carry.students);}
  if(carry.fee!==null)next.raw={...next.raw,T:String(carry.fee)};
  if(carry.rental){
    const defaultRate=carry.rental.hours===4?13000:carry.rental.hours===6?18000:null;
    next.rentalPaymentStatus=carry.rental.status;next.rentalHours=carry.rental.hours;next.rentalAmount=carry.rental.amount;
    next.rentalCustomAmount=carry.rental.status!=='free'&&Number.isInteger(carry.rental.amount)&&carry.rental.amount!==defaultRate;
  }
  // 수강권은 구매 시 수납 완료 — 이 회차 받은 금액을 자동으로 채워 미수 0으로 시작한다.
  if(carry.fee!==null)next.raw={...next.raw,Y:String(carry.fee+(carry.rental?.status==='paid'&&Number.isInteger(carry.rental.amount)?carry.rental.amount:0))};
  return next;
}
function renderPassIssueModal(settings,context,escape){
  if(!settings.passIssueOpen)return '';
  const deck=settings.teamDeck||{cards:[]};
  const cards=(deck.cards||[]).filter(card=>!card.draft?.id);
  const results=settings.passIssueResults||{};
  const rows=cards.map((card,index)=>{
    const draft=card.draft||{},raw=draft.raw||{};
    const paid=numeric(raw.Y)||0;
    const done=results[card.key];
    const carry=passIssueCarryLines(draft);
    return `<div class="bk-pass-team-row${done?' is-done':''}" data-bk-pass-team="${escape(card.key)}"><div class="bk-pass-team-info"><strong>${escape(raw.I||`팀 ${index+1}`)}</strong><small>${escape(raw.H||'고객')} · 인원 ${escape(raw.M||'1')}명 · 입금 ${money(paid)}원</small>${carry.length?`<small class="bk-pass-carry">${escape(carry.join(' · '))}</small>`:'<small class="bk-pass-carry">시간·금액 미입력 — 팀 정보에서 채우면 수강권에 함께 담깁니다.</small>'}</div>${done?`<span class="bk-pass-done">발급 완료 · ${escape(String(done.totalSessions))}회</span>`:`<label class="bk-pass-count"><input data-bk-pass-sessions type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="회"><span>회</span></label>`}</div>`;
  }).join('');
  const totalPaid=cards.reduce((sum,card)=>sum+(numeric(card.draft?.raw?.Y)||0),0);
  return `<div class="bk-passissue-backdrop" data-bk-passissue-backdrop><section class="bk-passissue" role="dialog" aria-modal="true" aria-label="수강권 발급"><header><div><span class="bk-eyebrow">LESSON PASS</span><h3>수강권으로 발급</h3><p>날짜만 미정일 뿐, 입력한 시간·강습료·장비·입금과 고객·명부·팀 정보가 그대로 담깁니다. 각 팀의 총 횟수만 적어 주세요.</p></div><button type="button" class="icon-btn" data-bk-passissue-close aria-label="닫기">×</button></header><div class="bk-passissue-body">${rows||'<p class="bk-field-note">발급할 팀 카드가 없습니다. 팀 정보를 먼저 입력해 주세요.</p>'}<p class="bk-form-error" data-bk-passissue-error role="alert" hidden></p></div><footer><div class="bk-passissue-total"><span>고객 총 입금액</span><strong>${money(totalPaid)}원</strong></div><div><button type="button" class="btn secondary" data-bk-passissue-close>닫기</button><button type="button" class="btn primary" data-bk-passissue-confirm ${cards.length?'':'disabled'}>수강권 발급</button></div></footer></section></div>`;
}

// 새 고객(미저장)도 명부를 바로 적게 한다(2026-11-15): draft.pendingPeople에 담았다가
// 첫 저장으로 고객 ID가 생기면 그대로 서버 명부에 등록된다.
// ⚠️ 판정은 customerId 유무가 아니다 — prepareCustomerIdentity가 입력 즉시 새 고객에게
// UUID를 미리 발급하므로(customerDraft 동반), customerDraft가 남아 있으면 아직 서버에 없는 고객이다.
export function bookingCustomerSaved(draft){
  return !!draft.customerId&&!draft.customerDraft;
}
export function bookingRosterPeople(draft,context){
  if(bookingCustomerSaved(draft))return customerPeopleOf(context,draft.customerId);
  return Array.isArray(draft.pendingPeople)?draft.pendingPeople:[];
}
function renderPeopleManager(draft,context,escape){
  const pendingMode=!bookingCustomerSaved(draft);
  const people=bookingRosterPeople(draft,context);
  const note=pendingMode?'<p class="bk-field-note" data-bk-people-hint>아직 고객 저장 전입니다. 지금 추가한 개인은 첫 저장 때 고객 명부에 함께 등록됩니다.</p>':'';
  // 여러 명 연속 추가가 기본 사용 패턴 — 추가 후에도 접히지 않게 열림 상태를 draft에 보존한다(2026-11-16).
  const open=!people.length||draft.peopleRosterOpen!==false;
  return `<details class="bk-people-manager" data-bk-people-manager ${open?'open':''}><summary>개인 명부 <small>${people.length}명 · ${pendingMode?'저장 시 함께 등록':'팀 구성 때 클릭으로 선택'}</small></summary>${note}<div class="bk-team-chips">${people.map(person=>`<span class="bk-person-chip">${escape(person.name)}<small>${person.person_type==='minor'?`미성년${Number.isInteger(person.age)?` ${person.age}세`:''}`:'성인'}${Number.isInteger(person.experience_count)?` · 경험 ${person.experience_count}회`:''}</small><button type="button" data-bk-person-delete="${escape(person.id)}" aria-label="${escape(person.name)} 명부에서 삭제" title="명부에서 삭제">×</button></span>`).join('')||'<span class="bk-field-note">아직 등록한 개인이 없습니다. 가족·일행을 등록해 두면 팀 구성이 빨라집니다.</span>'}</div><div class="bk-person-add"><input data-bk-person-name maxlength="120" placeholder="이름 (예: 엄마, 첫째)"><select data-bk-person-type><option value="adult">성인</option><option value="minor">미성년</option></select><input data-bk-person-age type="number" min="1" max="19" step="1" inputmode="numeric" placeholder="나이(선택)" disabled><input data-bk-person-exp type="number" min="0" max="999" step="1" inputmode="numeric" placeholder="강습 경험(선택)"><button type="button" class="btn secondary small" data-bk-person-add>명부에 추가</button></div><p class="bk-field-note" data-bk-person-feedback role="status"></p></details>`;
}

function renderDirectorySelection(draft,context,escape){
  const customer=directoryCustomer(draft,context),teams=customer?customerDirectoryTeams(customer.id,context):[],locked=!!draft.id&&!!draft.customerId;
  if(customer){const contacts=customerContactChoices(customer,teams);return `<div class="bk-linked-customer" data-bk-linked-customer><header><div><small>고객 기록 연결됨</small><strong>${escape(customer.name)} <span>#${escape(customer.id.slice(-6))}</span></strong></div>${!locked?'<button type="button" class="btn ghost small" data-bk-unlink-customer>새 고객으로 입력</button>':''}</header><div class="bk-contact-options">${contacts.map(contact=>`<button type="button" data-bk-contact-phone="${escape(contact.phone)}" class="${canonicalTelephone(customerPhoneOf(draft))===contact.phone?'selected':''}"><span>${escape(contact.label)}</span>${escape(contact.formatted||formatTelephone(contact.phone))}</button>`).join('')||'<span class="bk-field-note">등록된 연락처가 없습니다. 이번 예약의 연락처를 입력해 주세요.</span>'}</div>${teams.length?`<span class="bk-team-choice-label">등록된 팀 선택</span><div class="bk-team-chips">${teams.map(team=>`<button type="button" data-bk-directory-team="${escape(team.id)}" class="${draft.customerTeamId===team.id?'selected':''}" ${locked?'disabled':''}>${escape(team.label)}${team.phone?`<small>${escape(formatTelephone(team.phone))}</small>`:''}</button>`).join('')}</div>`:''}${renderPeopleManager(draft,context,escape)}<p class="bk-field-note">${locked?'고객·팀 이름은 고객관리에서 수정할 수 있습니다. 이번 예약의 연락처는 따로 변경할 수 있습니다.':'이 고객의 연락처와 팀을 선택하세요. 이름이나 번호가 같아도 선택하기 전에는 연결되지 않습니다.'}</p></div>`;}


  return '';
  return '';
}
function renderCustomerSuggestions(draft,context,escape){
  if(draft.customerId&&!draft.customerDraft)return '';
  const matches=searchCustomerCandidates(customerPhoneOf(draft),context).filter(match=>match.customerId!==draft.customerId);
  if(!matches.length)return '';
  return `<div class="bk-customer-suggestions" role="group" aria-label="전화번호로 찾은 고객 후보"><header><strong>기존 고객 후보</strong><small>번호와 팀을 확인하고 선택하세요</small></header>${matches.map(match=>`<button type="button" data-bk-select-customer="${escape(match.customerId)}"><span><strong>${escape(match.name)}</strong><small>${escape(match.matchLabel)}${match.matchedContact?.source==='history'?' · 이전 예약 연락처':''} · ${escape(formatTelephone(match.matchedPhone))}</small></span><span>${match.teams.length}팀 · ${match.bookingCount}건 <small>#${escape(match.customerId.slice(-6))}</small></span></button>`).join('')}</div>`;
}
function renderTeamPhoneFields(draft,escape){
  const separate=draft.teamPhoneMode==='separate';
  return `<fieldset class="bk-team-phone" data-bk-team-phone><legend>이 팀의 연락처</legend><div class="bk-team-phone-options">${[['same','고객과 동일'],['separate','별도 번호']].map(([value,label])=>`<label class="${(separate?'separate':'same')===value?'selected':''}"><input type="radio" name="teamPhoneMode" value="${value}" ${(separate?'separate':'same')===value?'checked':''}>${label}</label>`).join('')}</div><label class="field bk-separate-phone" data-bk-separate-phone ${separate?'':'hidden'}><span class="field-label">팀 연락처 <b>*</b> <small>L</small></span><input name="teamPhone" value="${escape(separate?draft.raw.L:'')}" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" placeholder="이 팀의 연락 가능한 번호" ${separate?'':'disabled'}></label><p class="bk-field-note" data-bk-team-phone-summary>${separate?'강습 안내는 이 팀의 별도 번호를 사용합니다.':`고객 연락처 ${escape(contactDisplay(customerPhoneOf(draft))||'미입력')}를 함께 사용합니다.`}</p></fieldset>`;
}
function renderParticipantRows(draft,escape){
  return resizeParticipants(draft.participants,numeric(draft.raw.M)).map((person,index)=>`<fieldset class="bk-participant-row" data-bk-participant="${index}"><legend>강습생 ${index+1}</legend>${selectField(`participant_${index}_type`,'성인·미성년',person.type,[['','미확인'],['adult','성인'],['minor','미성년']],escape)}<label class="field" data-bk-participant-age ${person.type==='minor'?'':'hidden'}><span class="field-label">나이</span><span class="bk-suffixed"><input type="number" name="participant_${index}_age" value="${escape(person.age??'')}" min="1" max="19" step="1" inputmode="numeric" placeholder="미입력 가능" ${person.type==='minor'?'':'disabled'}><span>세</span></span></label></fieldset>`).join('');
}
// 고객 단위 개인 명부(2026-11-15 #7): 클릭 선택으로 팀 참가자를 채운다.
export function customerPeopleOf(context,customerId){
  if(!customerId)return [];
  return (context?.customerPeople||[]).filter(person=>String(person.customer_id||person.customerId)===String(customerId));
}
// 개인 명부: 클릭 = 이 팀 참여(opt-in, 2026-11-16). 팀 이름·인원·경험도 선택을 따라간다.
// 2026-11-17: 입금검토 양식도 같은 명부 선택을 쓰도록 모듈로 승격·export.
export function applyPeopleSelection(draft,people,ids){
  const participants=participantsFromPeople(people,ids);
  const picked=people.filter(person=>ids.includes(String(person.id)));
  const next={...draft,participantPersonIds:ids,participants,raw:{...draft.raw,M:participants.length?String(participants.length):draft.raw.M}};
  // 팀 이름: 비어 있거나 직전 자동값 그대로면 선택한 명부 이름으로 채운다(직접 입력은 보존).
  const autoName=picked.map(person=>person.name).join('·');
  const previousAuto=draft.autoTeamNameFromPeople||'';
  if(autoName&&(!String(draft.raw.I||'').trim()||String(draft.raw.I).trim()===previousAuto)){next.raw.I=autoName;next.autoTeamNameFromPeople=autoName;}
  // 경험: 선택 인원 중 기록된 값이 있으면 최소값으로 프리필(요건 판정은 보수적으로).
  const known=picked.map(person=>person.experience_count).filter(value=>Number.isInteger(value)&&value>=0);
  if(known.length)next.experienceCount=Math.min(...known);
  return next;
}
/** 선택한 개인들을 예약 participants 스냅샷({type,age})으로 변환한다. */
export function participantsFromPeople(people,selectedIds){
  const selected=new Set(Array.isArray(selectedIds)?selectedIds.map(String):[]);
  return (people||[]).filter(person=>selected.has(String(person.id)))
    .map(person=>({type:person.person_type==='minor'?'minor':'adult',age:person.person_type==='minor'&&Number.isInteger(person.age)?person.age:null}));
}
// 여자 강사 요청(2026-11-15): 특이사항(G)의 표준 문구 한 줄로 저장한다.
// 별도 열이 없는 시트 미러 구조에서 예약표·강사배정·강사 전달 노트에 그대로 보이게 하기 위한 방식.
const FEMALE_PREF_LINES=Object.freeze({prefer:'여자 강사 선호',require:'여자 강사 필수'});
export function femaleInstructorPreference(noteText){
  const lines=String(noteText||'').split('\n').map(line=>line.trim());
  return lines.includes(FEMALE_PREF_LINES.require)?'require':lines.includes(FEMALE_PREF_LINES.prefer)?'prefer':'';
}
export function applyFemaleInstructorPreference(noteText,pref){
  const keep=String(noteText||'').split('\n').filter(line=>!Object.values(FEMALE_PREF_LINES).includes(line.trim()));
  if(FEMALE_PREF_LINES[pref])keep.unshift(FEMALE_PREF_LINES[pref]);
  return keep.join('\n').replace(/^\n+|\n+$/g,'');
}
// 영어 강사 요청(2026-11-17): 여자 강사와 동일하게 특이사항(G) 표준 문구 한 줄로 저장.
const ENGLISH_PREF_LINES=Object.freeze({prefer:'영어 강사 선호',require:'영어 강사 필수'});
export function englishInstructorPreference(noteText){
  const lines=String(noteText||'').split('\n').map(line=>line.trim());
  return lines.includes(ENGLISH_PREF_LINES.require)?'require':lines.includes(ENGLISH_PREF_LINES.prefer)?'prefer':'';
}
export function applyEnglishInstructorPreference(noteText,pref){
  const keep=String(noteText||'').split('\n').filter(line=>!Object.values(ENGLISH_PREF_LINES).includes(line.trim()));
  if(ENGLISH_PREF_LINES[pref])keep.unshift(ENGLISH_PREF_LINES[pref]);
  return keep.join('\n').replace(/^\n+|\n+$/g,'');
}
function renderPeoplePicker(draft,context,escape){
  const people=bookingRosterPeople(draft,context);
  if(!people.length)return '';
  // 2026-11-16 변경: 클릭 = 이 팀 참여(opt-in). 아무도 클릭 안 하면 전원 참가 기본은 유지.
  const untouched=!Array.isArray(draft.participantPersonIds);
  const selected=untouched?new Set():new Set(draft.participantPersonIds.map(String));
  const hint=untouched?'클릭한 사람만 이 팀 참여 · 아무도 안 누르면 전원 참가':`이 팀 참여 ${selected.size}명 · 강습생 정보와 인원수 자동`;
  return `<div class="bk-people-picker" data-bk-people-picker><span class="bk-team-choice-label">개인 명부에서 선택 <small>${hint}</small></span><div class="bk-team-chips">${people.map(person=>`<button type="button" data-bk-person-pick="${escape(person.id)}" class="${selected.has(String(person.id))?'selected':''}" aria-pressed="${selected.has(String(person.id))}">${escape(person.name)}<small>${person.person_type==='minor'?`미성년${Number.isInteger(person.age)?` ${person.age}세`:''}`:'성인'}${Number.isInteger(person.experience_count)?`<b class="bk-person-exp">경험 ${person.experience_count}회</b>`:''}</small></button>`).join('')}${untouched?'':'<button type="button" class="bk-people-reset" data-bk-person-all>전원 참가로</button>'}</div></div>`;
}
// 2026-11-17: 입금검토 양식도 예약접수와 동일하게 명부 선택을 보여준다(명부가 있을 때).
function renderParticipantFields(draft,escape,context,{review=false}={}){return `<div class="bk-participants" data-bk-participants><div class="bk-participant-heading"><strong>강습생별 정보 <b>*</b></strong><span>미성년자는 나이를 직접 입력해 주세요.</span></div>${context&&(!review||bookingRosterPeople(draft,context).length)?renderPeoplePicker(draft,context,escape):''}<div data-bk-participant-rows>${renderParticipantRows(draft,escape)}</div></div>`;}
function refreshParticipantFields(form,draft,escape){const target=form.querySelector('[data-bk-participant-rows]');if(target)setStableHTML(target,renderParticipantRows(draft,escape));}
function renderCashReceiptFields(draft,escape){
  // 현금영수증은 계좌이체 결제에만 해당. 결제소스가 '명시적으로' 다른 수단이면
  // 자동 '아니오'+잠금. 소스 미확인(미응답)일 때는 기본값을 날조하지 않는다.
  const paymentSourceValue=String(draft.raw?.Q||'').trim();
  const transferSource=paymentSourceValue==='계좌이체',nonTransferSource=!!paymentSourceValue&&!transferSource;
  const requested=!nonTransferSource&&draft.cashReceiptRequested===true,manual=draft.cashReceiptNumberMode==='manual';
  const receiptValue=nonTransferSource?'false':(typeof draft.cashReceiptRequested==='boolean'?String(draft.cashReceiptRequested):'');
  return `<div class="bk-receipt-fields"><h4>현금영수증</h4>${selectField('cashReceiptRequested',nonTransferSource?'현금영수증 요청 (계좌이체만 해당)':'현금영수증 요청',receiptValue,[['','선택해 주세요'],['true','예'],['false','아니오']],escape,nonTransferSource?'disabled':'')}<div data-bk-receipt-details ${requested?'':'hidden'}>${selectField('cashReceiptNumberMode','발급번호',manual?'manual':'team_phone',[['team_phone','팀 연락처와 동일'],['manual','직접 입력']],escape,requested?'':'disabled')}<p class="bk-field-note" data-bk-receipt-phone ${manual?'hidden':''}>팀 연락처 ${escape(contactDisplay(draft.raw.L)||'미입력')}로 요청합니다.</p><label class="field" data-bk-receipt-manual ${manual?'':'hidden'}><span class="field-label">현금영수증 발급번호 <b>*</b></span><input name="cashReceiptNumber" type="text" inputmode="numeric" maxlength="30" autocomplete="off" value="${escape(draft.cashReceiptNumber||'')}" placeholder="${draft.cashReceiptNumberSet?'기존 발급번호 등록됨 · 관리자만 확인':'전화번호·사업자번호·카드번호 직접 입력'}" ${requested&&manual?draft.cashReceiptNumberSet?'':'required':'disabled'}><span class="bk-field-note">숫자 8~20자리${draft.cashReceiptNumberSet?' · 비워두면 기존 번호를 유지합니다.':''}</span></label></div></div>`;
}
function refreshCashReceiptFields(form,draft){
  // 명시적 비계좌이체 결제소스만 현금영수증 자동 '아니오' + 잠금 (미확인은 그대로).
  const sourceValue=String(form.elements.namedItem('raw_Q')?.value||draft.raw?.Q||'').trim();
  const nonTransfer=!!sourceValue&&sourceValue!=='계좌이체';
  const requestSelect=form.elements.namedItem('cashReceiptRequested');
  if(nonTransfer){draft.cashReceiptRequested=false;if(requestSelect){requestSelect.value='false';requestSelect.disabled=true;}}
  else if(requestSelect)requestSelect.disabled=false;
  const requested=!nonTransfer&&draft.cashReceiptRequested===true,manual=draft.cashReceiptNumberMode==='manual';
  const details=form.querySelector('[data-bk-receipt-details]'),number=form.elements.namedItem('cashReceiptNumber'),mode=form.elements.namedItem('cashReceiptNumberMode'),manualBlock=form.querySelector('[data-bk-receipt-manual]'),phone=form.querySelector('[data-bk-receipt-phone]');
  if(details)details.hidden=!requested;if(mode)mode.disabled=!requested;if(manualBlock)manualBlock.hidden=!manual;if(number){number.disabled=!requested||!manual;number.required=requested&&manual&&!draft.cashReceiptNumberSet;}if(phone){phone.hidden=manual;phone.textContent=`팀 연락처 ${contactDisplay(draft.raw.L)||'미입력'}로 요청합니다.`;}
}

function refreshLearnerFields(form,draft){
  refreshCashReceiptFields(form,draft);
  const exact=form.querySelector('[data-bk-exact-age]'),age=form.elements.namedItem('age');if(exact)exact.hidden=!!draft.ageBand;if(age){age.disabled=!!draft.ageBand;if(draft.ageBand)age.value='';}
  const separate=draft.teamPhoneMode==='separate',block=form.querySelector('[data-bk-separate-phone]'),phone=form.elements.namedItem('teamPhone');if(block)block.hidden=!separate;if(phone)phone.disabled=!separate;
  form.querySelectorAll('input[name="teamPhoneMode"]').forEach(input=>input.closest?.('label')?.classList.toggle('selected',input.checked));
  const summary=form.querySelector('[data-bk-team-phone-summary]');if(summary)summary.textContent=separate?'강습 안내는 이 팀의 별도 번호를 사용합니다.':`고객 연락처 ${contactDisplay(customerPhoneOf(draft))||'미입력'}를 함께 사용합니다.`;
}
function renderCustomerBlock(draft,context,escape,{review=false}={}) {
  const original=(context.reservations||[]).find(row=>row.id===draft.id),legacy=original&&!String(original.raw.H||'').trim()&&String(original.raw.I||'').trim(),locked=!!draft.id&&!!draft.customerId;
  const phone=customerPhoneNotice(draft,context),companies=bookingCompanyOptions([draft.raw.E,...(context.reservations||[]).map(row=>row.raw?.E)]);
  // 카카오 ID 예외(2026-11-17): 저장값 '카카오:아이디' 또는 체크 상태로 모드를 판단한다.
  const contactValue=customerPhoneOf(draft),contactKakaoId=kakaoContactId(contactValue),kakaoMode=draft.contactKakaoMode??!!contactKakaoId;
  const phonePlaceholder=review?'고객 연락 가능한 번호':'번호 4자리부터 기존 고객 찾기';
  return `<section class="bk-customer-block" data-bk-customer-block><div class="bk-section-label"><span>01</span><h3>고객 공통정보</h3><small>같은 고객의 팀이 함께 사용합니다</small></div><div class="bk-customer-fields"><div class="bk-customer-grid"><label class="field bk-field-H"><span class="field-label">고객명(입금자) <b>*</b></span><input name="raw_H" value="${escape((draft.customerId?directoryDisplayNames(draft,context).customerName:null)||draft.raw.H)}" required maxlength="120" autocomplete="name" placeholder="고객명 또는 입금자명" ${locked?'disabled':''}></label><div class="field bk-field-L"><span class="field-label">고객 연락처 <b>*</b></span><input name="raw_L" value="${escape(kakaoMode?(contactKakaoId??contactValue):contactValue)}" required type="${kakaoMode?'text':'tel'}" inputmode="${kakaoMode?'text':'tel'}" autocomplete="${kakaoMode?'off':'tel'}" maxlength="30" placeholder="${kakaoMode?'카카오톡 ID':phonePlaceholder}" data-bk-phone-placeholder="${escape(phonePlaceholder)}" aria-label="고객 연락처" aria-describedby="bk-phone-feedback" aria-invalid="${phone.invalid?'true':'false'}"><span id="bk-phone-feedback" class="bk-phone-feedback ${phone.invalid?'is-invalid':''}" data-bk-phone-feedback aria-live="polite">${escape(review&&!phone.invalid&&!kakaoMode?'상담 원문의 고객 연락처와 대조해 주세요.':phone.text)}</span><label class="check-field bk-kakao-contact"><input type="checkbox" name="contactKakaoMode" ${kakaoMode?'checked':''}> 해외 거주 등 · 전화 대신 카카오톡 ID 기록</label></div><label class="field bk-field-E"><span class="field-label">강습업체·지점 <b>*</b></span><select name="raw_E" required>${option('','업체·지점 선택',normalizeBookingCompany(draft.raw.E),escape)}${companies.map(company=>option(company,company,normalizeBookingCompany(draft.raw.E),escape)).join('')}</select></label>${selectField('raw_Q','결제 소스 *',draft.raw.Q,[['','선택해 주세요'],...bookingPaymentSourceOptions(draft.raw.Q).map(item=>[item.value,item.label])],escape,'required')}</div>${renderCashReceiptFields(draft,escape)}</div>${legacy?'<p class="bk-field-note">고객명을 입력하면 팀 이력을 연결할 수 있습니다.</p>':''}${review?(draft.customerId?`<div data-bk-directory-selection>${renderPeopleManager(draft,context,escape)}</div>`:'<p class="bk-field-note">상담 후보에서 기존 고객을 연결하면 개인 명부(수강생 이름)를 선택할 수 있습니다. 새 고객의 명부는 예약 저장 때 함께 만들어집니다.</p>'):`<div data-bk-customer-suggestions>${renderCustomerSuggestions(draft,context,escape)}</div><div data-bk-directory-selection>${renderDirectorySelection(draft,context,escape)||renderPeopleManager(draft,context,escape)}</div>`}</section>`;
}
function renderTeamEditor(draft,context,escape,settings){
  const locked=!!draft.id&&!!draft.customerId;
  return `<section class="bk-team-block" data-bk-team-block data-bk-pane="team">${draft.sameCustomerNewTeam?'<p class="bk-family-draft-note">새 팀 · 공통정보와 일정 가져옴</p>':''}<div class="bk-team-identity"><div><label class="field bk-field-I"><span class="field-label">강습생·팀 <small>선택 · 저장 후에도 변경 가능</small></span><input name="raw_I" value="${escape((()=>{if(!draft.customerId||!draft.customerTeamId)return draft.raw.I;const d=directoryDisplayNames(draft,context);return d.teamName!==null?d.teamName:draft.raw.I;})())}" maxlength="120" placeholder="예: 엄마, 아빠, 첫째, 막내"></label><p class="bk-field-note" data-bk-team-notice>비워두면 기본 1팀입니다. 팀이 여러 개면 구분해 주세요.</p><div data-bk-team-choices>${renderCustomerTeamChoices(draft,context,escape)}</div></div>${renderTeamPhoneFields(draft,escape)}${renderPassSelector(draft,context,escape)}</div>${renderTeamConditions(draft,context,escape)}${renderTeamSchedule(draft,context,escape)}<div class="bk-add-team-options"><label class="check-field"><input type="checkbox" name="copyTeamConditions" ${draft.copyTeamConditions?'checked':''}> 다른 팀에도 나이·경험·실력·준비·회차별 금액 가져오기</label><button type="button" class="btn secondary small bk-new-team" data-bk-new-team data-bk-add-team="${escape(draft.id||'')}">같은 고객 다른 팀 추가 →</button><p class="bk-field-note">고객 공통정보와 일정은 항상 가져옵니다. ${draft.paymentReviewId?'체크하면 강습료·장비요금을 복사합니다. 새 팀의 입금 배분액은 0원으로 시작합니다.':'체크하면 각 회차의 강습료·장비요금·입금액도 복사합니다.'}</p></div><details class="bk-optional-assignment" ${settings.tab==='assignment'||draft.instructorIds?.length?'open':''}><summary>강사 배정 <span>선택 · 저장 후에도 가능</span></summary>${renderAssignment(draft,context,escape)}</details>${draft.id?`<details class="bk-inline-history" ${settings.tab==='history'?'open':''}><summary>변경 이력</summary>${renderChangeHistory(draft,context,escape)}</details>`:''}</section>`;
}

function teamBoardCards(settings){
  const active=activeDraftCard(settings.teamDeck),group=active?.draft?.commonGroupId;
  return (settings.teamDeck?.cards||[]).filter(card=>card.key===active?.key||group&&card.draft.commonGroupId===group);
}
function boardSessionRows(draft){
  return draft.savedBatchRows?.length>1?draft.savedBatchRows.map(saved=>{const row=saved.id===draft.id?draft:saved;return {date:row.raw?.A,startTime:row.raw?.B,endTime:row.raw?.C,financial:row};}):bookingDateRows(draft);
}
function renderTeamPreview(draft,context,escape){
  const rows=boardSessionRows(draft),skill=sportSkill(draft),teacher=(context.roster||[]).find(person=>person.user_id===draft.preferredInstructorId);
  return `<div class="bk-team-preview"><dl>${[
    ['팀 연락처',contactDisplay(draft.raw.L)||'미입력'],['강습',`${draft.raw.D||'종목 미입력'} · 1:${draft.raw.M||'—'} · ${kinds[draft.kind]||'일반'}`],
    ['강습생',participantSummary(draft.participants)||ageLabel(draft)],['관계',draft.raw.K||'미입력'],['경험·수준',`${draft.experienceCount??'—'}회 · ${draft.raw.O||'미입력'}`],
    ['기술·준비',`${skill.label||'기술'} ${skill.value===true?'가능':skill.value===false?'불가능':'미확인'} · 주니어 준비 ${draft.juniorPreparation?'예':'아니오'}`],
    ['지정 강사',teacher?.display_name||'선택 없음'],...(draft.raw.G?[['특이사항',draft.raw.G]]:[])
  ].map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><h4>회차별 일정·금액 · ${rows.length}회</h4><ol>${rows.map((row,index)=>{const financial=row.financial||{},rental=rentalDetails(financial);return `<li><strong>${index+1}회 · ${escape(dateText(row.date))}</strong><span>${escape(row.startTime||'시작 미입력')}–${escape(row.endTime||'종료 미입력')}</span><span>강습료 <b>${escape(money(financial.raw?.T))}원</b></span><span>장비 <b>${escape(money(rental.amount))}원</b> · ${escape(rentalStatusLabel(rental.status))}</span><span>입금액 <b>${escape(money(financial.raw?.Y))}원</b></span></li>`;}).join('')}</ol></div>`;
}
function rawIntake(draft,context,escape,settings){
  const cards=teamBoardCards(settings),activeKey=settings.teamDeck?.activeKey;
  return `<section data-bk-pane="intake" class="bk-onepage-intake">${renderCustomerBlock(draft,context,escape)}<section class="bk-team-branches"><div class="bk-section-label"><span>02</span><h3>팀별 정보</h3><small>같은 고객 ${cards.length}팀 · 팀을 선택해 입력하세요</small></div><div class="bk-team-board ${cards.length>1?'has-many':''}" data-bk-team-board>${cards.map((card,index)=>{const active=card.key===activeKey;return `<article class="bk-team-column ${active?'is-active':''}" data-bk-team-column="${escape(card.key)}"><header class="bk-team-column-header"><div><small>${index+1}팀 · ${escape(cardStatusLabel(card,settings.demo))}</small><h3 data-bk-board-team-name>${escape(card.draft.raw.I||'기본팀')}</h3><span>${active?'현재 입력 중':'작성 내용 보관 중'}</span></div>${active?'':`<button type="button" class="bk-board-select" data-bk-board-select="${escape(card.key)}">이 팀 입력</button>`}<button type="button" data-bk-close-card="${escape(card.key)}" aria-label="${escape(cardTitle(card))} 카드 닫기" title="이 팀 카드 닫기">×</button></header>${active?renderTeamEditor(draft,context,escape,settings):renderTeamPreview(card.draft,context,escape)}</article>`;}).join('')}</div></section></section>`;
}

function refreshLessonPlanFields(form,draft,escape=fallbackEscape){
  const values=[{key:'primary',booking:draft},...bookingDateRows(draft).slice(1).map(row=>({key:row.id,booking:datePlanDraft(row)}))];
  for(const {key,booking}of values){
    const rowId=key==='primary'?bookingDateRows(draft)[0].id:key;
    const rowNode=[...form.querySelectorAll('[data-bk-date-row]')].find(node=>node.dataset.bkDateRow===rowId);
    const dateLabel=rowNode?.querySelector('[data-bk-session-date]');if(dateLabel)dateLabel.textContent=dateText(booking.raw.A);
    const block=[...form.querySelectorAll('[data-bk-plan-fields]')].find(node=>node.dataset.bkPlanFields===key);if(!block)continue;
    const plan=lessonPlanSettings(booking);block.classList.toggle('has-break',plan.lessonMinutes===240);const lesson=block.querySelector('[data-bk-plan-duration-select]'),pause=block.querySelector('[data-bk-plan-break-select]');
    if(lesson){lesson.innerHTML=lessonPlanChoices(booking).map(([value,label])=>option(value,label,plan.lessonMinutes===null?'':String(plan.lessonMinutes),escape)).join('');lesson.value=plan.lessonMinutes===null?'':String(plan.lessonMinutes);}
    const breakBlock=block.querySelector('[data-bk-plan-break]');if(breakBlock)breakBlock.hidden=plan.lessonMinutes!==240;if(pause){pause.disabled=plan.lessonMinutes!==240;pause.value=booking.paymentNeedsBreakConfirmation?'':String(plan.breakMinutes);pause.required=booking.paymentNeedsBreakConfirmation===true;}
    const end=block.querySelector('[data-bk-plan-end-input]');if(end){end.value=booking.raw.C||'';end.readOnly=plan.explicit;end.required=!plan.explicit;end.setAttribute('aria-readonly',String(plan.explicit));}
    const endNote=block.querySelector('[data-bk-plan-end-note]');if(endNote)endNote.textContent=(plan.explicit?'자동 계산':'직접 입력')+(lessonTimeLabel(booking.raw.C)!==String(booking.raw.C||'')?' · '+lessonTimeLabel(booking.raw.C):'');
    const rawDuration=block.querySelector('[data-bk-plan-raw-duration]');if(rawDuration){rawDuration.value=booking.raw.N||'';rawDuration.readOnly=plan.explicit;}
    const legacy=block.querySelector('[data-bk-plan-legacy]');if(legacy)legacy.hidden=plan.explicit;
    const preview=block.querySelector('[data-bk-plan-preview]');if(preview)preview.innerHTML=renderLessonTimeline(booking,escape);
  }
}

function refreshPhoneFeedback(form,draft,context){
  const phone=customerPhoneNotice(draft,context),field=form.elements.namedItem('raw_L'),feedback=form.querySelector('[data-bk-phone-feedback]');
  field?.setAttribute?.('aria-invalid',phone.invalid?'true':'false');
  if(feedback){feedback.textContent=phone.text;feedback.classList?.toggle('is-invalid',phone.invalid);}
}
// 카카오 ID 예외 체크 토글: 재렌더 없이 입력칸을 전화↔카카오 ID 모드로 바꾼다.
function updateKakaoContactField(form,draft,context){
  const input=form.elements.namedItem('raw_L'),box=form.elements.namedItem('contactKakaoMode');
  if(!input||!box)return;
  const kakao=box.checked===true;
  input.type=kakao?'text':'tel';
  input.setAttribute('inputmode',kakao?'text':'tel');
  input.setAttribute('autocomplete',kakao?'off':'tel');
  input.placeholder=kakao?'카카오톡 ID':(input.dataset?.bkPhonePlaceholder||input.placeholder);
  const id=kakaoContactId(input.value);
  if(kakao&&id!==null)input.value=id;
  refreshPhoneFeedback(form,draft,context);
}
function refreshCustomerPanels(form,draft,context,escape) {
  if(draft.historyInstructorSelection){const result=customerTeamHistory(draft,context,{now:context.bookingNow});if(!result.suggestedInstructorIds.includes(draft.historyInstructorSelection.instructorId)){if(draft.preferredInstructorId===draft.historyInstructorSelection.instructorId)draft.preferredInstructorId=null;delete draft.historyInstructorSelection;}}
  refreshPhoneFeedback(form,draft,context);
  setStableHTML(form.querySelector('[data-bk-customer-suggestions]'),renderCustomerSuggestions(draft,context,escape));
  setStableHTML(form.querySelector('[data-bk-directory-selection]'),renderDirectorySelection(draft,context,escape)||renderPeopleManager(draft,context,escape));
  setStableHTML(form.querySelector('[data-bk-team-choices]'),renderCustomerTeamChoices(draft,context,escape));
  const history=form.querySelector('[data-bk-customer-history]');if(history){history.hidden=!wantsSameInstructor(draft);setStableHTML(history,renderCustomerHistory(draft,context,escape));}
  const preferred=form.elements.namedItem('preferredInstructorId');if(preferred)preferred.value=draft.preferredInstructorId||'';
  const passBlock=form.querySelector('.bk-pass-connection');if(passBlock)passBlock.outerHTML=renderPassSelector(draft,context,escape);
  const season=form.elements.namedItem('seasonId');if(season)season.innerHTML=option('','새 시즌 강습 등록',draft.seasonId||'',escape)+availableSeasonPackages(draft,context).map(pack=>option(pack.id,seasonPackageLabel(pack,draft,context),draft.seasonId||'',escape)).join('');
}

function bookingMatchesPass(draft,pass,context){
  const customerId=pass.customer_id||pass.customerId,teamId=pass.customer_team_id||pass.customerTeamId;
  if(customerId||teamId)return !!customerId&&!!teamId&&customerId===draft.customerId&&teamId===draft.customerTeamId&&pass.sport===draft.raw.D;
  const customer=String(draft.raw.H||'').trim(),team=String(draft.raw.I||'').trim(),phone=canonicalTelephone(pass.phone);
  if(!customer||!team||String(pass.customer_name||'').trim()!==customer||String(pass.learner_name||'').trim()!==team||pass.sport!==draft.raw.D)return false;
  // Passes may be issued before a phone is known; only a supplied phone must match.
  if(!String(pass.phone||'').trim())return true;
  if(!phone)return false;
  const owner=directoryCustomer(draft,context),contacts=owner?customerContactChoices(owner,customerDirectoryTeams(owner.id,context)).map(item=>item.phone):[];
  return phone===canonicalTelephone(draft.raw.L)||contacts.includes(phone);
}
function renderPassSelector(draft,context,escape) {
  const team=String(draft.raw.I||'').trim();
  const passes=(context.lessonPasses||[]).filter(pass=>pass.id===draft.lessonPassId||bookingMatchesPass(draft,pass,context));
  const selected=(context.lessonPasses||[]).find(pass=>pass.id===draft.lessonPassId);
  const locked=!!draft.id&&!!draft.lessonPassId;
  return `<div class="bk-pass-connection"><label class="field"><span class="field-label">연결 수강권</span><select name="lessonPassId" ${locked?'disabled':''}><option value="">수강권 연결 안 함</option>${passes.map(pass=>{const remaining=passAvailable(pass,context);return `<option value="${escape(pass.id)}" ${draft.lessonPassId===pass.id?'selected':''} ${remaining<=0&&draft.lessonPassId!==pass.id?'disabled':''}>${escape(pass.customer_name)} · ${escape(pass.learner_name||'기본 1팀')} · ${escape(pass.sport)} · ${Number(pass.total_sessions)}회권 · 미예약 ${remaining}회</option>`;}).join('')}${draft.lessonPassId&&!selected?`<option value="${escape(draft.lessonPassId)}" selected>연결된 수강권 · 정보 확인 필요</option>`:''}</select></label><p class="bk-field-note" data-bk-pass-summary>${selected?`${escape(selected.customer_name)} · ${escape(selected.learner_name||'기본 1팀')} · 총 ${Number(selected.total_sessions)}회 · 미예약 ${passAvailable(selected,context)}회${locked?' · 기존 연결 유지':''}`:passes.length?'같은 고객·팀·종목의 수강권을 선택할 수 있습니다.':!team?'수강권은 강습생·팀을 입력한 예약에 연결할 수 있습니다.':'고객·팀·종목이 일치하는 수강권이 없습니다.'}</p></div>`;
}

function seasonCustomerKey(draft){const identity=customerIdentity(draft);return {name:identity.customerName||identity.teamName,phone:identity.telephone,teamMode:identity.teamMode,team:identity.teamName,sport:identity.sport};}
function storedSeasonKey(pack){let key=pack.customer_team_key||pack.customerTeamKey;if(typeof key==='string'){try{return JSON.parse(key);}catch{return null;}}return key||null;}
function matchesSeasonKey(draft,pack){
  const expected=seasonCustomerKey(draft),key=storedSeasonKey(pack),customerId=pack.customer_id||pack.customerId,teamId=pack.customer_team_id||pack.customerTeamId;
  if(customerId||teamId)return !!customerId&&!!teamId&&customerId===draft.customerId&&teamId===draft.customerTeamId&&(!key?.sport||key.sport===expected.sport);
  return !!key&&Object.keys(expected).every(name=>String(key[name]??'')===String(expected[name]??''));
}
function manualNoPhoneSeason(draft,pack,context){
  if(String(draft.raw.H||'').trim()===''||String(draft.raw.L||'').trim()!==''||storedSeasonKey(pack)?.phone!==null||!matchesSeasonKey(draft,pack))return false;
  const linked=(context.reservations||[]).filter(row=>(row.seasonId||row.season_id)===pack.id);
  return linked.length>0&&linked.every(row=>String(row.raw?.L??row.raw_data?.L??'').trim()==='');
}
function availableSeasonPackages(draft,context){return (context.seasonPackages||[]).filter(pack=>pack.id===draft.seasonId||(draft.customerId&&draft.customerTeamId||customerIdentity(draft).customerKey)&&matchesSeasonKey(draft,pack)||manualNoPhoneSeason(draft,pack,context));}
function seasonPackageLabel(pack,draft,context){const key=storedSeasonKey(pack),team=key?.teamMode==='default'?'기본 1팀':key?.team||'팀 정보 확인';return `${pack.customer_name||pack.customerName||'시즌 강습'} · ${team} · ${pack.total_sessions||pack.totalSessions}회${manualNoPhoneSeason(draft,pack,context)?' (전화 미입력 · 고객 확인)':''}`;}

function renderTeamConditions(draft,context,escape,{review=false}={}) {
  draft=automaticBookingSeason(draft,context);
  const raw=draft.raw,preferred=draft.preferredInstructorId||'',packageRows=availableSeasonPackages(draft,context);
  return `<div class="bk-condition-panel">
    <div class="bk-team-reservation-fields">
      <div class="bk-kind-field"><span class="field-label">예약 구분 · 자동</span><strong data-bk-automatic-kind>${draft.kind==='season'?'시즌강습 · 같은 팀 모든 회차에 같은 강사':draft.isReorder?'리오더':'일반 강습'}</strong></div>
      <div class="bk-preference"><label class="check-field"><input name="designated" type="checkbox" ${draft.designated?'checked':''}> 같은 강사 지정</label>${selectField('preferredInstructorId','지정 강사',preferred,[['','선택해 주세요'],...(context.roster||[]).filter(person=>person.active&&person.role==='instructor').map(person=>[person.user_id,person.display_name])],escape)}${review?selectField('femalePreference','여자 강사',femaleInstructorPreference(raw.G),[['','무관'],['prefer','선호'],['require','필수']],escape):`<div class="field bk-female-pref"><span class="field-label">여자 강사</span><div class="bk-female-pref-options" role="group" aria-label="여자 강사 요청">${[['','무관'],['prefer','선호'],['require','필수']].map(([value,label])=>`<button type="button" class="btn small ${femaleInstructorPreference(raw.G)===value?'primary':'secondary'}" data-bk-female-pref="${value}" aria-pressed="${femaleInstructorPreference(raw.G)===value}">${label}</button>`).join('')}</div></div>`}${review?selectField('englishPreference','영어 강사',englishInstructorPreference(raw.G),[['','무관'],['prefer','선호'],['require','필수']],escape):`<div class="field bk-english-pref"><span class="field-label">영어 강사</span><div class="bk-female-pref-options" role="group" aria-label="영어 강사 요청">${[['','무관'],['prefer','선호'],['require','필수']].map(([value,label])=>`<button type="button" class="btn small ${englishInstructorPreference(raw.G)===value?'primary':'secondary'}" data-bk-english-pref="${value}" aria-pressed="${englishInstructorPreference(raw.G)===value}">${label}</button>`).join('')}</div></div>`}</div>
      <label class="check-field bk-reorder-check"><input name="isReorder" type="checkbox" ${draft.isReorder?'checked':''}> 이전 강사가 마음에 들어 재등록한 리오더</label>
    </div>
    ${review?'':`<div data-bk-customer-history ${wantsSameInstructor(draft)?'':'hidden'}>${renderCustomerHistory(draft,context,escape)}</div>`}
    <div class="bk-season-fields">${packageRows.length?selectField('seasonId','이어서 등록할 시즌 묶음',draft.seasonId||'',[['','새로 구매한 강습'],...packageRows.map(pack=>[pack.id,seasonPackageLabel(pack,draft,context)])],escape):''}<div class="field"><span class="field-label">구매 총회차 · 자동</span><strong data-bk-season-total>${escape(String(automaticBookingSeason(draft,context).seasonTotal||bookingDateRows(draft).length||1))}회</strong></div><p class="bk-field-note">회차 수만큼 자동 계산합니다. 2회 이상이면 시즌강습으로 묶여 강사 배정 때 모든 회차에 같은 강사를 배정합니다. 횟수만 사고 날짜는 나중에 정하면 [날짜 미정 · 수강권으로 발급]을 쓰세요.</p></div>
    <div class="bk-team-learner-fields">
      ${selectField('raw_D','종목',raw.D,[['','종목 선택'],['스키','스키'],['보드','보드']],escape,'required')}
      ${inputField('M','강습인원수',raw.M,escape,'type="number" min="1" max="1000" step="1" required')}
      <label class="field"><span class="field-label">이전 강습 경험 <b>*</b></span><span class="bk-suffixed"><input name="experienceCount" type="number" min="0" max="999" step="1" required value="${escape(draft.experienceCount??'')}" placeholder="미확인"><span>회</span></span></label>
      ${selectField('raw_K','관계',raw.K,[['','선택'],['가족','가족'],['자녀','자녀'],['성인','성인'],['단체','단체']],escape)}<div class="field"><span class="field-label">횟수 · 자동</span><strong class="bk-auto-count" data-bk-auto-count>${escape(raw.J||String(bookingDateRows(draft).length)+'회')}</strong><input type="hidden" name="raw_J" value="${escape(raw.J||'')}"></div>${inputField('O','수준',raw.O,escape,'maxlength="200"')}
    </div>
    <div class="bk-team-ability-fields">${renderParticipantFields(draft,escape,context,{review})}${renderSportSkillFields(draft,escape)}<label class="check-field bk-junior-preparation"><input type="checkbox" name="juniorPreparation" ${draft.juniorPreparation?'checked':''}> 주니어 기술등급제 준비</label></div>
    <div class="bk-requirement" data-bk-requirement>${renderRequirement(draft,context,escape)}</div>${rawTextarea('G','특이사항·요청사항',raw.G,escape,1)}
  </div>`;
}

function renderRequirement(draft,context,escape) {
  const result=expertRequirement(draft,context.settings);
  return `${badge(requirementText(result),result.needsReview?'amber':result.required?'teal':'neutral',escape)}<span>${escape((result.reasons||[]).join(' · ')||'입력한 강습 조건을 기준으로 배정합니다.')}</span>`;
}

export function paymentCorrectionDeliveryLabel(delivery={}){
  const reason={template_missing:'추가입금 안내 템플릿 승인·설정 대기',template_not_approved:'추가입금 안내 템플릿 승인·설정 대기',delivery_disabled:'자동 발송 꺼짐',provider_not_connected:'솔라피 연결 필요',channel_missing:'업체 발신 채널 설정 필요',replaced:'새 정정으로 대체되어 발송하지 않음',paid:'추가미수가 없어 발송하지 않음',cancelled:'취소되어 발송하지 않음'}[delivery.reason];
  if(reason&&['blocked','skipped','not_required'].includes(delivery.status))return reason;
  return {queued:'추가입금 안내 발송 대기',blocked:'안내 설정 확인 필요',pending:'추가입금 안내 처리 대기',preparing:'안내 발송 준비 중',sending:'안내 전송 중',accepted:'솔라피 접수 · 도달 확인 중',delivered:'안내 도달 완료',failed:'안내 발송 실패',uncertain:'결과 미확인 · 중복 방지를 위해 자동 재전송 안 함',skipped:'안내 발송 생략',not_required:'추가미수 없음 · 안내 발송 대상 아님'}[delivery.status]||'안내 처리 상태 미확인';
}
function paymentCorrectionHistory(draft,history,escape){
  if(!draft.id)return '';
  const rows=list(history?.corrections),current=history?.current;
  return `<details class="bk-inline-history bk-payment-correction-history" ${history?'open':''}><summary>요청액 정정 이력·안내 상태</summary><button type="button" class="btn ghost small" data-bk-correction-history="${escape(draft.id)}" ${history?.loading?'disabled':''}>${history?.loading?'서버 기록 조회 중…':'서버 기록 새로고침'}</button>${history?.error?`<p class="bk-financial-error" role="alert">${escape(history.error)}</p>`:''}${current?`<p>서버 현재 요청액 ${money(current.requestedAmount)}원 · 기입금 ${money(current.paidAmount)}원 · 추가미수 ${money(current.outstandingAmount)}원</p>`:''}${history?.loadedAt&&!rows.length?'<p class="bk-field-note">저장된 요청액 정정 이력이 없습니다.</p>':''}${rows.map(row=>`<article><strong>${row.initialRegistration?'신규 예약 정정 총액 '+money(row.correctedRequestedAmount)+'원':money(row.previousRequestedAmount)+'원 → '+money(row.correctedRequestedAmount)+'원'}</strong><p>기입금 ${money(row.paidAmount)}원 · 정정 당시 추가미수 ${money(row.outstandingAmount)}원</p><p>${escape(row.reason)}</p><small>${escape(row.createdAt||'')} · ${escape(row.actorName||'담당자')}</small><p role="status">${escape(paymentCorrectionDeliveryLabel(row.delivery))}</p></article>`).join('')}</details>`;
}
function paymentCorrectionFields(draft,history,escape,{review=false}={}){
  const intent=draft.paymentRequestCorrection,enabled=!!intent,stored=draft.currentAmountOverride??draft.current_amount_override??null;
  return `<details class="bk-payment-correction" data-bk-payment-correction ${enabled||stored!==null?'open':''}><summary>별도 총액 정정·추가입금 안내</summary><input type="hidden" name="paymentCorrectionCurrentAmount" value="${escape(stored??'')}"><p class="bk-field-note">보통은 강습료·장비요금과 실제 받은 금액만 입력하면 미수금이 자동 계산됩니다. 구성 금액과 다른 총액으로 정정하거나 추가입금 안내를 등록할 때 사용하세요.</p><label class="check-field"><input type="checkbox" name="paymentCorrectionEnabled" ${enabled?'checked':''}> 잘못 안내한 요청액 정정</label><div data-bk-correction-inputs ${enabled?'':'hidden'}><label class="field"><span class="field-label">별도로 정정할 총액</span><input type="number" name="paymentCorrectionAmount" value="${escape(intent?.correctedRequestedAmount??'')}" min="0" max="1000000000" step="1" inputmode="numeric" ${enabled?'required':'disabled'}></label><label class="field"><span class="field-label">요청액 정정 사유 · 고객 안내에 포함</span><textarea name="paymentCorrectionReason" maxlength="300" rows="2" ${enabled?'required':'disabled'} placeholder="예: 안내에서 빠진 장비요금 반영">${escape(intent?.reason||'')}</textarea></label><p class="bk-field-note">${review?'예약 작성을 누르면 정정 총액과 사유도 작성 화면에 그대로 채워집니다. 최종 예약 저장 시 정정 이력·특이사항과 추가입금 안내 요청을 함께 등록합니다.':'예약 저장 시 정정 이력·특이사항과 고객 추가입금 안내 요청을 함께 등록합니다.'} 실제 받은 금액은 위 입력란에서 확인하세요. 은행 입금 원문과 확정된 배분 원장은 바꾸지 않습니다. 안내의 실제 발송 상태는 저장 후 서버 기록에서 확인하세요.</p></div>${stored!==null?`<p class="bk-field-note">이 예약에는 저장된 별도 정정 총액 ${money(stored)}원이 적용됩니다. 강습료·장비요금 합계 대신 이 금액을 기준으로 미수금을 계산합니다. 총액을 바꾸려면 위 항목을 선택하세요.</p>${draft.id&&!review?'<button type="button" class="btn secondary small" data-bk-correction-use-fees>강습료·장비요금 합계로 바꾸기</button>':''}`:''}${paymentCorrectionHistory(draft,history,escape)}</details>`;
}
function requestedAmountExplanation(draft){
  if(draft.paymentRequestCorrection)return '실제 받아야 할 금액에 아래의 별도 정정 총액을 적용합니다. 미수금 = 정정 총액 − 실제 받은 금액';
  if(draft.currentAmountOverride!==null&&draft.currentAmountOverride!==undefined||draft.current_amount_override!==null&&draft.current_amount_override!==undefined)return '저장된 별도 정정 총액이 적용되어 있습니다. 강습료·장비요금 합계와 다를 수 있으며, 미수금은 이 총액에서 실제 받은 금액을 빼서 계산합니다.';
  return '실제 받아야 할 금액 = 강습료 + 장비요금 · 미수금 = 실제 받아야 할 금액 − 실제 받은 금액';
}

function correctionFromForm(form,draft,prefix=''){
  const control=form.elements.namedItem(`${prefix}paymentCorrectionEnabled`);if(!control)return draft.paymentRequestCorrection;
  if(!control.checked)return undefined;
  return {requestId:draft.paymentRequestCorrection?.requestId||crypto.randomUUID(),expectedVersion:draft.paymentRequestCorrection?.expectedVersion??draft.amountCorrectionVersion??0,correctedRequestedAmount:numeric(form.elements.namedItem(`${prefix}paymentCorrectionAmount`)?.value),reason:String(form.elements.namedItem(`${prefix}paymentCorrectionReason`)?.value||'')};
}
function correctionValidationError(draft,original){
  const intent=draft.paymentRequestCorrection;if(!intent)return null;
  if(!Number.isSafeInteger(intent.correctedRequestedAmount)||intent.correctedRequestedAmount<0||intent.correctedRequestedAmount>1000000000)return '정정 요청액을 0원 이상 10억원 이하의 정수로 입력해 주세요.';
  if(!String(intent.reason||'').trim()||String(intent.reason).trim().length>300)return '요청액 정정 사유를 1~300자로 입력해 주세요.';
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.requestId||'')||!Number.isSafeInteger(intent.expectedVersion)||intent.expectedVersion<0)return '요청액 정정 정보를 다시 확인해 주세요.';
  return null;
}

function rawFinancial(draft,escape,{rowId=null,review=false,history=null}={}) {
  const raw=draft.raw,knownFees=numeric(raw.T)!==null&&rentalDetails(draft).amount!==null,correctedAmount=draft.paymentRequestCorrection?.correctedRequestedAmount,knownCorrection=Number.isSafeInteger(correctedAmount)&&correctedAmount>=0&&correctedAmount<=1_000_000_000,summary=review&&!knownFees&&!knownCorrection?null:financialSummary(draft),displayed=summary?{X:String(summary.requested),Z:review&&numeric(raw.Y)===null?'':String(summary.balance)}:review?{X:'',Z:''}:raw,patch=!!draft.patchEnabled||!!raw.U||!!raw.R;
  let html=`<section class="bk-financial-panel" data-bk-session-financial="${escape(rowId||'primary')}"><h4>이 회차의 금액</h4>${draft.paymentReviewId?'<p class="bk-field-note">입금 검토에서 연결된 예약입니다. 한 입금액을 여러 회차·팀에 중복 기록하지 말고 나누어 배분해 주세요.</p>':''}${draft.paymentReviewedRentalFee!==null&&draft.paymentReviewedRentalFee!==undefined&&!draft.rentalPaymentStatus?`<p class="bk-field-note">검토된 장비금액 ${money(draft.paymentReviewedRentalFee)}원 · 결제상태와 이용시간을 확인해 주세요.</p>`:''}<div class="bk-session-fee-grid">${inputField('T','강습료 *',raw.T,escape,'type="number" inputmode="numeric" min="0" step="1" required placeholder="무료이면 0"')}</div>${renderRentalFields(draft,escape)}<div class="bk-form-grid bk-financial-total bk-financial-summary">${inputField('X',draft.paymentRequestCorrection||draft.currentAmountOverride!=null||draft.current_amount_override!=null?'실제 받아야 할 금액 (별도 정정)':'실제 받아야 할 금액 (자동)',displayed.X,escape,'readonly aria-readonly="true"')}${inputField('Y',draft.paymentReviewId?'이 회차 실제 받은 금액':'실제 받은 금액',raw.Y,escape,'type="number" min="0" step="1" inputmode="numeric" placeholder="실제 받은 금액 입력"')}${inputField('Z','미수금 (자동)',displayed.Z,escape,'readonly aria-readonly="true"')}</div>${review&&draft.bookingType==='pass'&&draft.scheduleStatus==='undated'?'<p class="bk-field-note" data-pr-correction-unavailable>날짜 미정 수강권은 회차별 예약을 작성할 때 요청액을 정정할 수 있습니다.</p>':paymentCorrectionFields(draft,history,escape,{review})}<p class="bk-field-note" data-bk-requested-explanation>${escape(requestedAmountExplanation(draft))}</p><p class="bk-rental-unknown" data-bk-rental-unknown ${rentalDetails(draft).amount===null?'':'hidden'}>장비금액 미확인</p><p class="bk-overpaid-note" data-bk-overpaid ${summary?.overpaid>0?'':'hidden'}>초과입금 <strong>${money(summary?.overpaid||0)}원</strong></p><div class="bk-financial-error bk-field-note" data-bk-financial-error role="status" hidden></div><details class="bk-session-extras" ${patch||raw.P?'open':''}><summary>기타 금액·메모 <small>선택</small></summary><div class="bk-patch-fields"><label class="check-field"><input type="checkbox" name="patchEnabled" ${patch?'checked':''}> 패치요금 별도 기록 (합계 제외)</label><div data-bk-patch-inputs ${patch?'':'hidden'}><div class="bk-form-grid">${inputField('U','패치요금',raw.U,escape,`inputmode="numeric" ${patch?'':'disabled'}`)}${selectField('raw_R','패치결제',raw.R,[['','미확인'],['O','O'],['X','X']],escape,patch?'':'disabled')}</div></div></div>${rawTextarea('P','회차별 금액·요청 메모',raw.P,escape,2)}</details></section>`;
  if(rowId)html=html.replace(/name="([^"]+)"/g,(_,name)=>`name="date_${escape(rowId)}_${name}"`);
  return html;
}
function sessionFinancialForm(form,rowId){
  const block=[...form.querySelectorAll('[data-bk-session-financial]')].find(node=>node.dataset.bkSessionFinancial===String(rowId||'primary'));
  // closest('form') 는 실제 폼을 돌려준다 — 없으면 rentalStudentCount 가 인원수(raw_M)를
  // 못 찾아 회차별 장비 자동금액이 1인분으로 계산된다(2026-11-20 사용자 신고: 2회차 1.3만원 부족).
  return {elements:{namedItem:name=>form.elements.namedItem(rowId?`date_${rowId}_${name}`:name)},querySelector:selector=>block?.querySelector(selector)||null,closest:selector=>selector==='form'?form:form.closest?.(selector)||null};
}
function sessionFinancialTarget(target){
  const block=target.closest?.('[data-bk-session-financial]');if(!block)return null;
  const id=block.dataset.bkSessionFinancial,prefix=id==='primary'?'':`date_${id}_`;
  return {rowId:id==='primary'?null:id,name:String(target.name||'').slice(prefix.length)};
}

function updateGrandTotal(form,deck=null,context=null,activeDraft=null){
  // 총입금액 = 고객 전체(열린 모든 팀 카드 × 모든 회차)의 합 (2026-11-15 확정).
  // 활성 카드는 화면 입력값, 나머지 카드는 보관된 초안으로 합산한다.
  // 2026-11-17: 이미 서버에 저장된 같은 고객 예약도 합산한다 — 팀을 하나씩 저장하며
  // 작성해도 "고객 전체" 총합이 흔들리지 않게(김한범 건).
  const host=form.closest?.('form')||form;
  const target=host.querySelector?.('[data-bk-grand-total]');if(!target)return;
  let requested=0,paid=0,unknown=false,sessions=0;
  const blocks=[...host.querySelectorAll('[data-bk-session-financial]')];
  for(const block of blocks){
    const read=suffix=>{const input=[...block.querySelectorAll('input')].find(el=>(el.name||'').endsWith(suffix));return numeric(input?.value);};
    const x=read('raw_X'),y=read('raw_Y');
    if(x===null)unknown=true;else requested+=x;
    paid+=y??0;sessions++;
  }
  let teams=1;
  const activeKey=deck?.activeKey,deckRowIds=new Set(),openTeamKeys=new Set();
  const teamKeyOf=source=>String(source?.customerTeamId||'')||`name:${String(source?.raw?.I||'').normalize('NFKC').replace(/\s+/gu,'')}`;
  if(activeDraft){openTeamKeys.add(teamKeyOf(activeDraft));for(const row of bookingDateRows(activeDraft))if(row.id)deckRowIds.add(row.id);}
  for(const card of (deck?.cards||[])){
    openTeamKeys.add(teamKeyOf(card.draft));
    for(const row of bookingDateRows(card.draft||{}))if(row.id)deckRowIds.add(row.id);
    if(card.key===activeKey)continue;
    teams++;
    for(const row of bookingDateRows(card.draft||{})){
      try{const summary=bookingFinancialSummary({...card.draft,raw:{...card.draft.raw,...row.raw},rentalPaymentStatus:row.financial?.rentalPaymentStatus??card.draft.rentalPaymentStatus,rentalHours:row.financial?.rentalHours??card.draft.rentalHours,rentalAmount:row.financial?.rentalAmount??card.draft.rentalAmount});
        requested+=summary.requested;paid+=summary.paid;sessions++;
      }catch{unknown=true;sessions++;}
    }
  }
  let savedSessions=0;const savedTeamKeys=new Set();
  const customerId=activeDraft?.customerId||[...(deck?.cards||[])].map(card=>card.draft?.customerId).find(Boolean)||null;
  if(customerId&&Array.isArray(context?.reservations)){
    for(const row of context.reservations){
      if((row.customerId||row.customer_id)!==customerId)continue;
      if(['cancelled','canceled'].includes(row.status))continue;
      if(row.id&&deckRowIds.has(row.id))continue;
      const x=numeric(row.raw?.X),y=numeric(row.raw?.Y);
      if(x===null)unknown=true;else requested+=x;
      paid+=y??0;sessions++;savedSessions++;
      const key=teamKeyOf(row);if(!openTeamKeys.has(key))savedTeamKeys.add(key);
    }
    teams+=savedTeamKeys.size;
  }
  // 2026-11-17(사용자 확정): 1팀 1회차여도 항상 표시 — 계산이 맞는지 눈으로 확인하는 용도.
  if(!sessions){target.hidden=true;return;}
  const balance=Math.max(requested-paid,0);
  target.hidden=false;
  target.innerHTML=`<strong>고객 전체 ${teams>1?`${teams}팀 · `:''}${sessions}회차 총합${savedSessions?` · 저장된 ${savedSessions}회 포함`:''}</strong><span>실제 받아야 할 금액(자동) ${unknown?'일부 미확인 · ':''}${money(requested)}원</span><span>실제 받은 금액 ${money(paid)}원</span><span class="${balance>0?'bk-grand-balance-due':''}">미수금(자동) ${money(balance)}원</span>`;
}
function updateFinancialFields(form,{initializeCorrection=false}={}) {
  const patch=form.elements.namedItem('patchEnabled'),group=form.querySelector('[data-bk-patch-inputs]');
  if(patch){
    if(group)group.hidden=!patch.checked;
    for(const name of ['raw_U','raw_R']){const field=form.elements.namedItem(name);if(field){field.disabled=!patch.checked;if(!patch.checked)field.value='';}}
  }
  const error=form.querySelector('[data-bk-financial-error]');
  const correction=form.elements.namedItem('paymentCorrectionEnabled'),amount=form.elements.namedItem('paymentCorrectionAmount'),reason=form.elements.namedItem('paymentCorrectionReason');
  const correcting=correction?.checked===true,correctionInputs=form.querySelector('[data-bk-correction-inputs]');
  if(correctionInputs)correctionInputs.hidden=!correcting;
  for(const field of [amount,reason])if(field){field.disabled=!correcting;field.required=correcting;}
  // 정정 중에도 기입금(실제 받은 금액)은 수정·동시 저장 가능 (0488c73 정책).
  if(initializeCorrection&&correcting&&amount&&amount.value==='')amount.value=form.elements.namedItem('raw_X')?.value||'';
  try{
    const raw=Object.fromEntries(['T','U','Y'].map(key=>[key,form.elements.namedItem(`raw_${key}`)?.value||'']));
    const row={raw,rentalPaymentStatus:form.elements.namedItem('rentalPaymentStatus')?.value||null,rentalHours:numeric(form.elements.namedItem('rentalHours')?.value),rentalAmount:form.elements.namedItem('rentalAmount')?.value??null,currentAmountOverride:numeric(form.elements.namedItem('paymentCorrectionCurrentAmount')?.value),...(correcting?{paymentRequestCorrection:{correctedRequestedAmount:numeric(amount?.value)}}:{})};
    const summary=bookingFinancialSummary(row);
    const explanation=form.querySelector('[data-bk-requested-explanation]');if(explanation)explanation.textContent=requestedAmountExplanation(row);
    const requestedLabel=form.querySelector('.bk-field-X .field-label');if(requestedLabel)requestedLabel.textContent=correcting||row.currentAmountOverride!=null?'실제 받아야 할 금액 (별도 정정)':'실제 받아야 할 금액 (자동)';
    const unknown=form.querySelector('[data-bk-rental-unknown]');if(unknown)unknown.hidden=rentalDetails(row).amount!==null;
    for(const [name,amount]of [['raw_X',summary.requested],['raw_Z',summary.balance]]){const field=form.elements.namedItem(name);if(field)field.value=String(amount);}
    const overpaid=form.querySelector('[data-bk-overpaid]');if(overpaid){overpaid.hidden=!summary.overpaid;overpaid.innerHTML=`초과입금 <strong>${money(summary.overpaid)}원</strong>`;}
    const paid=form.querySelector('[data-bk-correction-paid]'),balance=form.querySelector('[data-bk-correction-balance]');if(paid)paid.value=String(summary.paid);if(balance)balance.value=String(summary.balance);
    if(error){error.hidden=true;error.textContent='';}
  }catch(issue){
    if(error){error.hidden=false;error.textContent=issue.message;}
    for(const name of ['raw_X','raw_Z']){const field=form.elements.namedItem(name);if(field)field.value='';}
    const balance=form.querySelector('[data-bk-correction-balance]');if(balance)balance.value='';
  }
}

function renderRentalFields(draft,escape) {
  const rental=rentalDetails(draft),active=!!rental.status,free=rental.status==='free';
  const custom=active&&!free&&draft.rentalCustomAmount===true;
  return `<fieldset class="bk-rental-fields"><legend>장비렌탈</legend>${selectField('rentalPaymentStatus','장비렌탈 결제상태',rental.status||'onsite_unpaid',[['onsite_unpaid','미결제(당일 코코넛 실사용 확인)'],['free','무료'],['paid','결제완료']],escape)}<div class="bk-form-grid">${selectField('rentalHours','이용시간',rental.hours??'',[['','선택'],['4','4시간'],['6','6시간']],escape,`${active?'':'disabled'} ${active&&!free?'required':''}`)}<label class="field"><span class="field-label">렌탈 금액</span><span class="bk-suffixed"><input type="number" name="rentalAmount" value="${escape(rental.amount??'')}" min="0" step="1" inputmode="numeric" ${active?'':'disabled'} ${custom?'':'readonly'} ${active&&!free?'required':''}><span>원</span></span></label></div><label class="check-field"><input type="checkbox" name="rentalCustomAmount" ${custom?'checked':''} ${active&&!free?'':'disabled'}> 기타금액 직접 입력</label><p class="bk-field-note bk-rental-price-note">4시간 13,000원 · 6시간 18,000원 (서비스 1시간 포함)</p></fieldset>${draft.id?renderRentalBridgePanel(draft,escape):''}`;
}

// The review uses the same reservation controls without mounting booking write handlers.
// Aliases are limited to input names; source text and evidence are never rewritten.
const paymentIntakeFieldNames=Object.freeze({
  raw_H:'customerName',raw_L:'phone',raw_E:'company',raw_Q:'paymentSource',
  raw_I:'teamName',raw_D:'sport',raw_M:'studentCount',raw_K:'relationship',
  raw_J:'lessonCount',raw_O:'ability',raw_G:'notes',raw_A:'date',raw_B:'startTime',
  raw_C:'endTime',raw_N:'duration',raw_T:'lessonFee',raw_Y:'allocatedAmount',
  raw_X:'requestedAmount',raw_Z:'balanceAmount',raw_P:'sessionNotes',
  raw_U:'patchFee',raw_R:'patchPaymentStatus'
});

/** Pure shared intake fragments. The review owns navigation, state and human approval. */
export function renderBookingPaymentIntake(draft={},escape=fallbackEscape,{section='common',context={},prefix=''}={}) {
  const raw={...Object.fromEntries(RAW_COLUMNS.map(({key})=>[key,''])),...(draft.raw||{})};
  const prepared={...draft,id:'',raw,parallelLongTurn:typeof draft.parallelLongTurn==='boolean'?draft.parallelLongTurn:null,snowboardNoviceTurn:typeof draft.snowboardNoviceTurn==='boolean'?draft.snowboardNoviceTurn:null};
  const reviewContext={...context,reservations:context.reservations||[],settings:context.settings||{}};
  let html='';
  if(section==='common')html=renderCustomerBlock(prepared,reviewContext,escape,{review:true});
  else if(section==='team')html=`<section class="bk-team-block" data-pr-intake-team-fields><div class="bk-team-identity"><div>${inputField('I','강습생·팀',raw.I,escape,'maxlength="120" placeholder="예: 엄마·아빠, 자녀팀"')}<p class="bk-field-note">비워두면 고객명과 같은 기본팀입니다. 여러 팀은 구분해 주세요.</p></div>${renderTeamPhoneFields(prepared,escape)}${renderPassSelector(prepared,reviewContext,escape)}</div>${renderTeamConditions(prepared,reviewContext,escape,{review:true})}</section>`;
  else if(section==='session'){
    const minutes=numeric(prepared.lessonMinutes),pause=numeric(prepared.breakMinutes);
    prepared.paymentNeedsBreakConfirmation=minutes===240&&pause===null;
    const validStart=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(raw.B||'')),undatedPass=prepared.bookingType==='pass'&&prepared.scheduleStatus==='undated';
    prepared.raw.C=validStart&&minutes&&!prepared.paymentNeedsBreakConfirmation&&!undatedPass?lessonPlanEndTime(raw.B,minutes,pause??0)||'':'';
    prepared.raw.N=minutes?`${minutes/60}시간`:'';
    html=undatedPass?`<div class="bk-date-row" data-pr-intake-session-fields><div class="bk-date-primary-fields">${selectField('lessonMinutes','회당 강습 시간',minutes===null?'':String(minutes),lessonPlanChoices(prepared,{review:true}),escape)}</div>${rawFinancial(prepared,escape,{review:true})}</div>`:`<div class="bk-date-row" data-pr-intake-session-fields><div class="bk-date-primary-fields">${inputField('A','강습일',raw.A,escape,'type="date"')}${startTimeField('raw_B',raw.B,escape)}${renderLessonPlanFields(prepared,escape,{review:true})}</div>${rawFinancial(prepared,escape,{review:true})}</div>`;
  }else throw new TypeError('Unknown payment intake section');
  return html.replace(/name="([^"]+)"/g,(_,name)=>{
    const alias=paymentIntakeFieldNames[name]||name;
    return `name="${escape(prefix+alias)}" data-pr-intake-field="${escape(alias)}"`;
  });
}

// Reuse the manual reservation controls in the bank-review intake.
export function renderBookingReviewFields(draft,escape=fallbackEscape,section='team') {
  if(section==='common')return `${selectField('paymentSource','결제 소스',draft.paymentSource||'계좌이체',[['계좌이체','계좌이체 · 은행 입금 검토']],escape,'disabled')}${renderCashReceiptFields(draft,escape)}`;
  if(section==='rental')return renderRentalFields(draft,escape);
  return `${selectField('relationship','관계',draft.relationship||'',[['','선택'],['가족','가족'],['자녀','자녀'],['성인','성인'],['단체','단체']],escape)}<label class="field"><span class="field-label">이전 강습 경험</span><input name="experienceCount" type="number" min="0" max="999" step="1" value="${escape(draft.experienceCount??'')}" placeholder="미확인"></label><label class="field"><span class="field-label">수준</span><input name="ability" value="${escape(draft.ability||'')}" maxlength="200" placeholder="미확인"></label><label class="field"><span class="field-label">희망·지정 강사</span><input name="preferredInstructor" value="${escape(draft.preferredInstructor||'')}" maxlength="120" placeholder="선택 · 저장 후 배정 가능"></label>${renderParticipantFields(draft,escape)}${renderSportSkillFields(draft,escape)}<label class="check-field bk-junior-preparation"><input type="checkbox" name="juniorPreparation" ${draft.juniorPreparation?'checked':''}> 주니어 기술등급제 준비</label>`;
}
export function syncBookingReviewRentalFields(form){updateRentalFields(form);}
export function syncBookingReviewFinancialFields(form,options={}){
  updateFinancialFields({elements:{namedItem:name=>form.elements.namedItem(paymentIntakeFieldNames[name]||name)},querySelector:selector=>form.querySelector?.(selector)||null},options);
  if(numeric(form.elements.namedItem('allocatedAmount')?.value)===null){
    const paid=form.querySelector?.('[data-bk-correction-paid]'),balance=form.querySelector?.('[data-bk-correction-balance]'),totalBalance=form.elements.namedItem('balanceAmount');
    if(paid)paid.value='미확인';if(balance)balance.value='';if(totalBalance)totalBalance.value='';
  }
}

function rentalStudentCount(scope){
  // 세션(회차)별 fieldset 에는 raw_M 이 없으므로 상위 form 까지 올라가 찾는다.
  // 입금검토 양식은 인원이 alias(studentCount)라 그 이름도 함께 찾는다(2026-11-17).
  const direct=scope.elements?.namedItem?.('raw_M')||scope.elements?.namedItem?.('M')||scope.elements?.namedItem?.('studentCount');
  const outer=scope.closest?.('form')?.elements.namedItem('raw_M')||scope.closest?.('form')?.elements.namedItem('studentCount');
  const count=Number((direct||outer)?.value);
  return Number.isSafeInteger(count)&&count>0?count:1;
}
function updateRentalFields(form) {
  const status=form.elements.namedItem('rentalPaymentStatus');
  const hours=form.elements.namedItem('rentalHours');
  const amount=form.elements.namedItem('rentalAmount');
  const custom=form.elements.namedItem('rentalCustomAmount');
  if(!status||!hours||!amount||!custom)return;
  const active=!!status.value,free=status.value==='free';
  // 운영 기본(2026-11-16, N8): 결제완료는 4시간권 금액만 받는다 — 비어 있으면 4시간을 기본 선택.
  if(status.value==='paid'&&!hours.value)hours.value='4';
  if(!active){hours.value='';amount.value='';custom.checked=false;}
  else if(free){amount.value='0';custom.checked=false;}
  else if(!custom.checked){
    // 장비렌탈은 1인 단가 × 강습인원수 (예: 4시간 13,000원 × 2명 = 26,000원)
    const per=rentalDefaultAmount(hours.value);
    amount.value=per===null?'':String(per*rentalStudentCount(form));
  }
  // 미결제(onsite_unpaid)는 이용시간 미정일 수 있어 필수 아님 —
  // 당일 코코넛렌탈샵 실제 이용금액으로 확정한다. 금액은 참고 추정치.
  const paidStatus=status.value==='paid';
  hours.disabled=!active;hours.required=paidStatus;
  custom.disabled=!active||free;
  amount.disabled=!active;amount.readOnly=!active||free||!custom.checked;amount.required=paidStatus;
}

function candidateResult(draft,context) {
  try{return (bookingDateRows(draft).length>1?evaluateBookingBatchCandidates:evaluateCandidates)(draft,{roster:context.roster||[],capabilities:context.capabilities||[],schedules:context.schedules||[],reservations:context.reservations||[],seasonPackages:context.seasonPackages||[],lessonPasses:context.lessonPasses||[],timeOffRequests:context.timeOffRequests||[],settings:context.settings||{}});}catch{return {candidates:[],eligible:[],needsReview:true,reasons:['배정 조건을 확인하지 못했습니다. 입력값과 강사 설정을 확인해 주세요.']};}
}

function renderAssignment(draft,context,escape) {
  const result=candidateResult(draft,context),rows=result.candidates||[],eligible=rows.filter(candidate=>candidate.eligible);
  const selected=unique(draft.instructorIds||[]);
  return `<section data-bk-pane="assignment"><div class="bk-section-label"><span>06</span><h3>강사 배정</h3></div>${bookingDateRows(draft).length>1?`<p class="bk-multi-fee-note">선택한 ${bookingDateRows(draft).length}회 전체에 가능한 강사를 표시합니다. 지정·시즌 강사는 모든 회차에 유지됩니다.</p>`:''}<div class="bk-requirement">${renderRequirement(draft,context,escape)}</div>${result.requiredInstructorId?`<div class="bk-fixed-teacher">${badge(draft.lessonPassId?'수강권 담당 유지':draft.kind==='season'?'시즌 담당 유지':draft.kind==='reorder'?'리오더 지정':'지정 강사','teal',escape)}<strong>${escape(instructorName(result.requiredInstructorId,context))}</strong></div>`:''}${result.reasons?.length?`<ul class="bk-review-list">${result.reasons.map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul>`:''}<div class="bk-candidate-heading"><strong>배정 가능 ${eligible.length}명</strong><button type="button" class="btn secondary small" data-bk-suggest ${eligible.length&&!result.needsReview?'':'disabled'}>자동 배정안 만들기</button></div>${draft.suggestion?`<div class="bk-suggestion"><strong>배정 제안</strong><span>${escape(selected.map(id=>instructorName(id,context)).join(' · ')||'—')}</span><small>조건과 일정이 맞는 후보입니다. 저장하면 배정이 확정됩니다.</small></div>`:''}<div class="bk-candidates">${rows.map(candidate=>{const id=candidate.instructorId||candidate.instructor_user_id||candidate.id;const name=candidate.name||instructorName(id,context);return `<label class="bk-candidate ${candidate.eligible?'':'blocked'}"><input type="checkbox" name="instructorIds" value="${escape(id)}" ${selected.includes(id)?'checked':''} ${candidate.eligible?'':'disabled'}><span class="bk-person-avatar">${escape(initials(name))}</span><span><strong>${escape(name)}</strong><small>${escape((candidate.eligible?candidate.reasons:candidate.blockedReasons)?.join(' · ')||(candidate.eligible?'배정 가능':'조건 확인 필요'))}</small></span>${badge(candidate.eligible?'가능':'제외',candidate.eligible?'teal':'neutral',escape)}</label>`;}).join('')||'<div class="bk-candidate-empty">배정할 강사가 없습니다.<br>강사 조건 설정에서 종목·지점·경력을 확인해 주세요.</div>'}</div>${selected.length?`<button type="button" class="btn ghost small" data-bk-clear-assignment>배정 선택 해제</button>`:''}<div class="bk-section-label bk-board-heading"><span>TIME</span><h3>해당일 강사 일정</h3></div>${renderInstructorBoard(draft,context,escape)}</section>`;
}

function renderInstructorBoard(draft,context,escape) {
  const date=parseKstDate(draft.raw.A),schedules=context.schedules||[];
  return `<div class="bk-mini-board">${(context.roster||[]).filter(person=>person.role==='instructor'&&person.active).map(person=>{const lessons=schedules.filter(lesson=>lesson.id!==draft.id&&!isCancelled(lesson)&&!context.reservations.some(row=>row.id===lesson.id&&isCancelled(row))&&unique([lesson.instructorUserId,...(lesson.instructorUserIds||[])]).includes(person.user_id)&&lesson.start&&day(lesson.start)===date).sort((a,b)=>new Date(a.start)-new Date(b.start));const leave=(context.timeOffRequests||[]).find(request=>(request.instructor_user_id||request.instructorUserId)===person.user_id&&(request.requested_date||request.date||request.leave_date)===date&&['pending','approved'].includes(request.status));return `<article><strong>${escape(person.display_name)}</strong><div>${leave?badge(leave.status==='approved'?'휴무 승인':'휴무 신청','amber',escape):''}${lessons.map(lesson=>{const interval=parseLessonInterval(lesson),segments=interval.error?[{start:lesson.start,end:lesson.end}]:interval.busySegments,plan=lessonPlanSettings(lesson);return segments.map((segment,index)=>`<span class="bk-board-lesson">${escape(lessonClock(segment.start,date))}–${escape(lessonClock(segment.end,date))}<small>${escape(lesson.customer||'배정 강습')}${plan.breakMinutes===120?` · ${index+1}부`:plan.breakMinutes===60?' · 휴식 1시간 포함':''}</small></span>`).join('');}).join('')||(!leave?'<span class="bk-board-free">등록된 강습 없음</span>':'')}</div></article>`;}).join('')||'<p>강사 계정을 먼저 등록해 주세요.</p>'}</div>`;
}

const changeFields=[['customerId','연결 고객'],['customerTeamId','연결 팀'],['lessonMinutes','강습 시간 설정'],['breakMinutes','중간 휴식'],
  ['participants','참가자별 성인·미성년·나이'],['cashReceiptRequested','현금영수증 요청'],['cashReceiptNumberMode','현금영수증 번호 설정'],['cashReceiptNumber','현금영수증 발급번호 변경'],['age','나이'],['ageBand','성인 연령대'],['juniorPreparation','주니어 기술등급제 준비'],['customerContactPhone','고객 연락처'],['teamPhoneMode','팀 연락처 설정'],['experienceCount','이전 강습 경험'],['parallelLongTurn','패러렐 롱턴'],['snowboardNoviceTurn','S자 너비스턴'],
  ['kind','예약 구분'],['isReorder','리오더'],['designated','같은 강사 지정'],['preferredInstructorId','지정 강사'],
  ['seasonId','시즌 강습 묶음'],['seasonTotal','구매 총회차'],['sessionNumber','이번 회차'],['lessonPassId','연결 수강권'],
  ['instructorIds','담당 강사'],['rentalPaymentStatus','장비렌탈 결제상태'],['rentalHours','장비렌탈 이용시간'],['rentalAmount','장비렌탈 금액']
];
const reasonPresets=['고객 요청','일정 변경','담당 강사 변경','접수 정보 정정','금액 정정'];
const changeInstructorName=(id,context)=>context.roster?.find(person=>person.user_id===id)?.display_name||id;

function changeValue(value,key,context) {
  if(key==='lessonMinutes'&&(value===null||value===undefined||value===''))return '기존 시간 유지';
  if(value===null||value===undefined||value==='')return '—';
  if(['parallelLongTurn','snowboardNoviceTurn'].includes(key))return value?'가능':'불가능';
  if(key==='participants')return participantSummary(value)||'미입력';
  if(key==='cashReceiptRequested')return value===true?'예':value===false?'아니오':'미선택';
  if(key==='cashReceiptNumberMode')return value==='manual'?'직접 입력':'팀 연락처와 동일';
  if(key==='cashReceiptNumber')return value?'새 번호 입력':'기존 번호 유지';
  if(key==='ageBand')return ageBands.find(([id])=>id===value)?.[1]||String(value);
  if(key==='teamPhoneMode')return value==='separate'?'별도 번호':'고객과 동일';
  if(['designated','isReorder','juniorPreparation'].includes(key))return value?'예':'아니오';
  if(key==='lessonMinutes')return value===null?'기존 시간 유지':`${Number(value)/60}시간`;
  if(key==='breakMinutes')return Number(value)?`${Number(value)/60}시간`:'휴식 없이 연속';
  if(key==='kind')return kinds[value]||value;
  if(key==='customerId')return (context.customers||[]).find(item=>item.id===value)?.name||String(value);
  if(key==='customerTeamId')return (context.customerTeams||[]).find(item=>item.id===value)?.name||'기본 1팀';
  if(key==='instructorIds')return value.length?value.map(id=>changeInstructorName(id,context)).join(' · '):'미배정';
  if(key==='preferredInstructorId')return changeInstructorName(value,context);
  if(key==='rentalPaymentStatus')return rentalStatusLabel(value);
  if(key==='rentalHours')return `${value}시간`;
  if(key==='rentalAmount'||['T','U','V','W','X','Y','Z','AB'].includes(key))return numeric(value)===null?String(value):`${money(value)}원`;
  if(key==='lessonPassId'){const pass=(context.lessonPasses||[]).find(item=>item.id===value);return pass?`${pass.learner_name||pass.customer_name} · ${pass.total_sessions}회권`:String(value);}
  return String(value);
}

/** Compare saved facts, excluding UI state and generated version markers. */
export function bookingChangeItems(before={},after={},context={}) {
  const old=normalizeBookingRow(before,context),next=normalizeBookingRow(after,context),changes=[];
  for(const column of RAW_COLUMNS){
    if(column.key==='F')continue;
    const previous=String(old.raw[column.key]??''),current=String(next.raw[column.key]??'');
    if(previous!==current)changes.push({key:`raw_${column.key}`,label:column.label||`원본 ${column.key}`,before:changeValue(previous,column.key,context),after:changeValue(current,column.key,context)});
  }
  for(const [key,label]of changeFields){
    if(JSON.stringify(old[key]??null)!==JSON.stringify(next[key]??null))changes.push({key,label,before:changeValue(old[key],key,context),after:changeValue(next[key],key,context)});
  }
  if(next.paymentRequestCorrection)changes.push({key:'paymentRequestCorrection',label:'잘못 안내한 요청액 정정',before:`${money(bookingFinancialSummary(old).requested)}원`,after:`${money(next.paymentRequestCorrection.correctedRequestedAmount)}원 · ${next.paymentRequestCorrection.reason}`});
  return changes;
}

function renderChangeTable(changes,escape) {
  return `<div class="bk-change-table-scroll"><table class="bk-change-table"><thead><tr><th scope="col">변경 항목</th><th scope="col">변경 전</th><th scope="col">변경 후</th></tr></thead><tbody>${changes.map(change=>`<tr data-bk-change-key="${escape(change.key)}"><th scope="row">${escape(change.label)}</th><td>${escape(change.before)}</td><td>${escape(change.after)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderChangeHistory(draft,context,escape) {
  const entries=(context.reservationChanges||[]).filter(entry=>(entry.reservation_id||entry.reservationId)===draft.id).sort((a,b)=>String(b.changed_at||b.changedAt||'').localeCompare(String(a.changed_at||a.changedAt||'')));
  return `<section data-bk-pane="history"><div class="bk-section-label"><span>LOG</span><h3>예약 변경 이력</h3></div><div class="bk-history-list">${entries.map(entry=>{
    const before=entry.before_snapshot||entry.before||{},after=entry.after_snapshot||entry.after||{};
    const changes=bookingChangeItems(before,after,context),when=entry.changed_at||entry.changedAt;
    const parsed=when?new Date(when):null,date=parsed&&Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(parsed):'시간 미기록';
    const selected=entry.notify_instructor_ids||entry.notification_instructor_ids||[];
    return `<article class="bk-history-entry"><header><strong>${escape(entry.actor_name||entry.actorName||'관리자')}</strong><time>${escape(date)}</time></header><p class="bk-history-reason">${escape(entry.change_reason||entry.reason||'사유 미기록')}</p>${changes.length?renderChangeTable(changes,escape):'<p class="bk-field-note">상세 변경 항목이 없습니다.</p>'}${selected.length?`<p class="bk-field-note">선택한 알림 대상: ${escape(selected.map(id=>changeInstructorName(id,context)).join(' · '))}</p>`:''}</article>`;
  }).join('')||'<div class="bk-history-empty">아직 변경 이력이 없습니다.</div>'}</div></section>`;
}

const cardStatusLabel=(card,demo)=>card.saveState==='saving'?'저장 중':card.status==='saved'?(demo?'체험 저장됨':'저장 완료'):card.status==='edited'?'수정 중':'작성 중';
const compactText=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/gu,' ');
export function describeBookingCard(card={}){
  const draft=card.draft||{},raw=draft.raw||{},customer=compactText(raw.H)||'고객명 입력 전',team=compactText(raw.I)||(draft.sameCustomerNewTeam?'새 팀 이름 입력':'기본 1팀');
  const phone=canonicalTelephone(raw.L),phoneSuffix=phone?.slice(-4)||'',contact=phoneSuffix?`연락처 끝 ${phoneSuffix}`:'';
  const rows=draft.id&&draft.savedBatchRows?.length?draft.savedBatchRows.map(row=>{const facts=row.id===draft.id?raw:row.raw||{};return {date:facts.A,startTime:facts.B,endTime:facts.C,company:facts.E};}):bookingDateRows(draft);
  const first=rows[0]||{},date=parseKstDate(raw.A||first.date),shortDate=date?date.slice(5).replace('-','.'):'날짜 미정',start=compactText(raw.B||first.startTime),end=compactText(raw.C||first.endTime),count=Math.max(rows.length,1);
  const time=start?`${start}${end?`–${end}`:''}`:'시간 미정';
  const when=`${shortDate} ${time}${count>1?` · ${count}회`:''}`;
  const company=compactText(raw.E);
  const search=[customer,team,raw.L,phone,phoneSuffix,company,...rows.flatMap(row=>[row.date,row.startTime,row.endTime,row.company]),raw.A,date,shortDate].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('ko-KR');
  return {customer,team,phoneSuffix,contact,when,count,company,search,label:`${customer} · ${team} · ${when}${contact?` · ${contact}`:''}`};
}
const cardTitle=card=>{const details=describeBookingCard(card);return `${details.customer} · ${details.team}`;};
function renderCardLabel(card,settings,escape,{fullPhone=false}={}){const details=describeBookingCard(card);return `<span class="bk-card-customer" data-bk-card-customer>${escape(details.customer)}${details.phoneSuffix?`<small>· ${escape(fullPhone?formatTelephone(card.draft.raw.L):details.phoneSuffix)}</small>`:''}</span><strong data-bk-card-team>${escape(details.team)}</strong><span class="bk-card-when" data-bk-card-when>${escape(details.when)}</span><small class="bk-card-status" data-bk-card-state>${cardStatusLabel(card,settings.demo)}</small>`;}
function renderDeckPeeks(settings,escape){
  const cards=(settings.teamDeck?.cards||[]).filter(card=>card.key!==settings.teamDeck.activeKey).slice(-2).reverse();
  return cards.map((card,index)=>`<div class="bk-card-peek peek-${index+1}" inert aria-hidden="true"><span>${escape(cardTitle(card))}</span></div>`).join('');
}
function renderAllCards(settings,escape,pending,review){
  if(!settings.cardListOpen)return '';
  const summary=draftDeckSummary(settings.teamDeck),query=String(settings.cardListQuery||'').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const matches=card=>!query||describeBookingCard(card).search.includes(query)||describeBookingCard(card).search.replace(/\D/gu,'').includes(query.replace(/[^0-9]/gu,''))&&query.replace(/[^0-9]/gu,'').length>=4;
  const visible=settings.teamDeck.cards.filter(matches).length;
  return `<section class="bk-all-cards" aria-label="열어 둔 예약 카드 전체 목록"><label class="bk-card-search"><span>고객·팀·연락처·날짜로 찾기</span><input type="search" data-bk-card-search value="${escape(settings.cardListQuery||'')}" placeholder="예: 김민수, 막내, 5678, 11.08" autocomplete="off" ${pending||review?'disabled':''}></label><div class="bk-all-cards-caption"><span data-bk-card-search-count>${visible} / ${summary.total}개</span><span>카드를 선택하면 입력을 이어갑니다.</span></div><div class="bk-all-cards-list">${settings.teamDeck.cards.map(card=>{const details=describeBookingCard(card);return `<div class="bk-all-card ${card.key===settings.teamDeck.activeKey?'is-active':''}" data-bk-list-card="${escape(card.key)}" ${matches(card)?'':'hidden'}><button type="button" data-bk-card-key="${escape(card.key)}" data-bk-card-status="${escape(card.status)}" aria-label="${escape(details.label)} 열기" ${pending||review?'disabled':''}>${renderCardLabel(card,settings,escape,{fullPhone:true})}</button><button type="button" class="bk-card-close" data-bk-close-card="${escape(card.key)}" aria-label="${escape(details.label)} 카드 닫기" title="이 카드 닫기" ${pending||review?'disabled':''}>×</button></div>`;}).join('')}</div><p class="bk-cards-empty" data-bk-card-search-empty ${visible?'hidden':''}>일치하는 예약 카드가 없습니다.</p><div class="bk-all-cards-actions">${summary.saved?`<button type="button" class="btn secondary small" data-bk-close-saved ${pending||review?'disabled':''}>저장 완료 카드 ${summary.saved}개 닫기</button>`:''}<button type="button" class="btn ghost small" data-bk-discard ${pending||review?'disabled':''}>모든 카드 정리…</button></div>${settings.discardPrompt?`<div class="bk-deck-discard-confirm" role="alert"><strong>열어 둔 예약 ${summary.total}개를 모두 닫을까요?</strong><p>저장하지 않은 초안 ${summary.pending}개는 버려집니다. 서버에 저장된 예약은 유지됩니다.</p><button type="button" class="btn secondary small" data-bk-discard-cancel>계속 작성</button><button type="button" class="btn ghost small" data-bk-discard-confirm>모든 초안 버리고 카드 닫기</button></div>`:''}</section>`;
}
function renderDeckRail(settings,escape){
  const deck=settings.teamDeck,summary=draftDeckSummary(deck);if(!summary.total)return '';
  const pending=!!settings.deckSaving||!!settings.reviewSaving||summary.busy,review=settings.drawer==='review';
  const index=deck.cards.findIndex(card=>card.key===deck.activeKey);
  return `<div class="bk-deck-controls ${summary.total===1?'is-single-card':''} ${settings.cardListOpen?'is-list-open':''}"><div class="bk-deck-heading"><strong>열어 둔 예약 <small>${summary.total}개</small></strong><button type="button" class="btn secondary small" data-bk-all-cards-toggle aria-expanded="${!!settings.cardListOpen}" ${pending||review?'disabled':''}>${settings.cardListOpen?'목록 접기':`전체 ${summary.total}개 보기`}</button></div><nav class="bk-card-rail" aria-label="열어 둔 예약 카드">${deck.cards.map(card=>{const details=describeBookingCard(card);return `<div class="bk-rail-card ${card.key===deck.activeKey?'is-active':''}" data-bk-rail-card="${escape(card.key)}"><button type="button" data-bk-card-key="${escape(card.key)}" data-bk-card-status="${escape(card.status)}" aria-current="${card.key===deck.activeKey?'step':'false'}" aria-label="${escape(details.label)} 열기" ${pending||review?'disabled':''}>${renderCardLabel(card,settings,escape)}</button><button type="button" class="bk-card-close" data-bk-close-card="${escape(card.key)}" aria-label="${escape(details.label)} 카드 닫기" title="이 카드 닫기" ${pending||review?'disabled':''}>×</button></div>`;}).join('')}</nav><div class="bk-deck-navigation"><button type="button" class="btn ghost small" data-bk-card-prev ${pending||review||index<=0?'disabled':''}>← 이전 카드</button><span>${index+1} / ${summary.total} · ${paymentGroupSaveLabel(settings)?'같은 입금의 모든 팀 함께 저장':'현재 카드의 일정만 저장'}</span><button type="button" class="btn ghost small" data-bk-card-next ${pending||review||index>=summary.total-1?'disabled':''}>다음 카드 →</button></div>${renderAllCards(settings,escape,pending,review)}</div>`;
}
function renderCardCloseConfirm(settings,escape){
  const card=settings.teamDeck?.cards?.find(item=>item.key===settings.closeCardKey);if(!card)return '';
  const details=describeBookingCard(card);
  return `<div class="bk-card-close-layer" data-bk-card-close-confirmation><section class="bk-card-close-confirm" role="alertdialog" aria-modal="true" aria-labelledby="bk-card-close-title" aria-describedby="bk-card-close-description"><span>이 카드만 닫기</span><h3 id="bk-card-close-title">${escape(details.customer)} · ${escape(details.team)}</h3><p class="bk-close-card-when">${escape(details.when)}${details.contact?` · ${escape(details.contact)}`:''}</p><p id="bk-card-close-description">${card.status==='edited'?'이 카드에서 수정한 내용을 버리고 닫습니다. 서버에 저장된 예약은 그대로 유지됩니다.':'아직 저장하지 않은 이 카드의 입력 내용을 버리고 닫습니다.'}</p><div><button type="button" class="btn secondary" data-bk-card-close-cancel>계속 작성</button><button type="button" class="btn primary" data-bk-card-close-confirm>이 카드 초안 버리고 닫기</button></div></section></div>`;
}

/** Close only a captured local card; persisted reservations are never deleted here. */
export function closeBookingDraftCard(ui,key,{discard=false}={}){
  const settings=ui.booking;if(!settings||settings.deckSaving||settings.reviewSaving||settings.deleteSaving||settings.deleteRequest||settings.drawer==='review'||draftDeckSummary(settings.teamDeck).busy)return {closed:false,blocked:true};
  const target=settings.teamDeck?.cards?.find(card=>card.key===key);if(!target)return {closed:false,missing:true};
  if(target.status!=='saved'&&!discard){settings.closeCardKey=key;settings.discardPrompt=false;return {closed:false,needsConfirmation:true};}
  const deck=discardDraftCard(settings.teamDeck,key),active=activeDraftCard(deck);
  Object.assign(settings,{teamDeck:deck,draft:active?clone(active.draft):null,tab:active?.tab||'intake',drawer:active?'reservation':null,review:null,closeCardKey:null,discardPrompt:false,deckMotion:null,focusNewTeam:false,...(!active?{cardListOpen:false,cardListQuery:'',deckNotice:null}:{})});
  return {closed:true,remaining:deck.cards.length};
}

export function applyReservationCancellation(value={},id,result={}){
  const source=(value.reservations||[]).find(row=>row.id===id),scheduleIds=new Set([id,source?.schedule_id,source?.scheduleId].filter(Boolean)),passId=passIdOf(source),stamp=result.cancelledAt||result.updatedAt||null;
  return {...value,reservations:(value.reservations||[]).map(row=>row.id===id?{...row,status:'cancelled',cancelledAt:stamp,cancelled_at:stamp,...(result.updatedAt?{updated_at:result.updatedAt,expectedUpdatedAt:result.updatedAt}:{})}:row),
    schedules:(value.schedules||[]).map(row=>scheduleIds.has(row.id)?{...row,status:'cancelled',cancelledAt:stamp,cancelled_at:stamp}:row),
    passStatuses:passId?(value.passStatuses||[]).filter(row=>(row.passId||row.pass_id)!==passId):value.passStatuses||[]};
}
export function completeReservationDeletion(ui,request,result){
  const settings=ui.booking;
  if(!settings||settings.deleteRequest?.requestId!==request.requestId)return {discarded:true};
  if(result?.id!==request.reservationId||result?.status!=='cancelled')throw new Error('삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
  const deck=discardDraftCard(settings.teamDeck,request.cardKey),active=activeDraftCard(deck);
  ui.booking={...settings,teamDeck:deck,draft:active?clone(active.draft):null,tab:active?.tab||'intake',drawer:active?'reservation':null,review:null,deleteRequest:null,deleteSaving:false,closeCardKey:null,discardPrompt:false,cardListOpen:false,cardListQuery:'',deckNotice:null,deckMotion:null};
  return {deleted:true,remaining:deck.cards.length};
}
function renderReservationDelete(settings,escape){
  const request=settings.deleteRequest;if(!request)return '';
  const details=describeBookingCard({draft:request.snapshot}),pending=settings.deleteSaving===true;
  return `<div class="bk-delete-layer"><section class="bk-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="bk-delete-title" aria-describedby="bk-delete-description"><span class="bk-delete-eyebrow">예약 한 건 삭제</span><h3 id="bk-delete-title">이 예약을 삭제할까요?</h3><dl><div><dt>고객</dt><dd data-bk-delete-customer>${escape(details.customer)}</dd></div><div><dt>강습생·팀</dt><dd data-bk-delete-team>${escape(details.team)}</dd></div><div><dt>강습 일정</dt><dd data-bk-delete-when>${escape(details.when)}</dd></div></dl><p id="bk-delete-description">선택한 예약 한 건을 예약표와 강사 일정에서 제외합니다. 결제·현금영수증 등 기존 기록은 보관됩니다.</p>${request.edited?'<p class="bk-delete-draft-note">이 카드의 저장하지 않은 수정 내용도 함께 버려집니다.</p>':''}<form class="bk-delete-form" ${pending?'data-busy="1"':''}><label class="field"><span class="field-label">삭제 사유 <small>선택</small></span><textarea name="deleteReason" rows="2" maxlength="1000" placeholder="필요하면 사유를 남겨 주세요." ${pending||request.submitted?'readonly':''}>${escape(request.reason||'')}</textarea></label><p class="bk-delete-error" data-bk-delete-error role="alert" ${request.error?'':'hidden'}>${escape(request.error||'')}</p><div class="bk-delete-actions"><button type="button" class="btn secondary" data-bk-delete-cancel ${pending?'disabled':''}>예약 유지</button><button type="submit" class="btn bk-danger" data-bk-delete-submit ${pending?'disabled':''}>${pending?'삭제 중…':'이 예약 삭제'}</button></div></form></section></div>`;
}

function renderDeckSaveNotice(settings,escape){
  const active=activeDraftCard(settings.teamDeck),summary=draftDeckSummary(settings.teamDeck);
  if(!active)return '';
  if(!summary.pending)return `<div class="bk-deck-summary" data-bk-deck-summary role="status"><strong>${summary.saved}개 카드 ${settings.demo?'체험 저장 완료':'저장 완료'}</strong><span>모든 카드의 예약이 ${settings.demo?'체험 데이터에 반영됐습니다.':'서버에 저장됐습니다.'}</span><button type="button" class="btn secondary small" data-bk-close>입력창 닫기</button></div>`;
  if(active.status==='saved')return `<div class="bk-card-saved-note" role="status">이 팀은 ${settings.demo?'체험 저장됐습니다.':'서버에 저장됐습니다.'} 다른 팀 카드를 이어서 작성할 수 있습니다.</div>`;
  return '';
}
function renderCardError(settings,escape){const error=activeDraftCard(settings.teamDeck)?.error;return `<div class="bk-form-error" role="alert" ${error?'':'hidden'}>${escape(error||'')}</div>`;}

function renderChangeReview(settings,context,escape) {
  const review=settings.review;if(!review)return '';
  const pending=settings.reviewSaving===true;
  const changes=bookingChangeItems(review.before,review.after,context);
  const previous=normalizeBookingRow(review.before,context).instructorIds,next=normalizeBookingRow(review.after,context).instructorIds;
  const recipients=unique([...previous,...next]),selected=review.notificationInstructorIds||[];
  return `<div class="bk-drawer-backdrop" data-bk-backdrop><div class="bk-team-deck">${renderDeckPeeks(settings,escape)}<aside data-bk-active-card="${escape(settings.teamDeck?.activeKey||'')}" class="bk-drawer bk-change-review" role="dialog" aria-modal="true" aria-label="예약 변경 검토"><header><div><span>RESERVATION CHANGE</span><h2>예약 변경 검토</h2><p>${escape(rowName(review.after))} · ${changes.length}개 항목 변경</p></div><button type="button" class="btn ghost small bk-window-close" data-bk-change-cancel title="입력창 닫기 — 저장하지 않은 내용 삭제" ${pending?'disabled':''} aria-label="입력창 닫기 — 저장하지 않은 변경 삭제">입력창 닫기 <b aria-hidden="true">×</b></button></header>${renderDeckRail(settings,escape)}<form class="bk-change-review-form" data-bk-review-form ${pending?'data-busy="1"':''} novalidate><div class="bk-drawer-body"><p class="bk-review-saving" data-bk-review-saving role="status" ${pending?'':'hidden'}>변경 내용을 저장하고 있습니다. 잠시 기다려 주세요.</p><div class="bk-form-error" role="alert" hidden></div>${renderChangeTable(changes,escape)}<div class="bk-section-label"><span>WHY</span><h3>변경 사유 (선택)</h3></div>${selectField('changeReasonPreset','변경 사유 선택',review.reasonPreset||'',[['','선택해 주세요'],...reasonPresets.map(reason=>[reason,reason]),['direct','직접 입력']],escape)}<label class="field"><span class="field-label">상세 사유</span><textarea name="changeReasonText" maxlength="1000" rows="3" placeholder="변경 사유를 직접 적거나 선택한 사유에 설명을 더해 주세요.">${escape(review.reasonText||'')}</textarea></label><fieldset class="bk-change-notifications"><legend>강사 웹 알림</legend><p class="bk-field-note">알릴 강사를 선택해 주세요.</p>${recipients.map(id=>`<label class="check-field"><input type="checkbox" name="notificationInstructorIds" value="${escape(id)}" ${selected.includes(id)?'checked':''}><span>${escape(changeInstructorName(id,context))} <small>${previous.includes(id)&&next.includes(id)?'계속 담당':previous.includes(id)?'이전 담당':'변경 후 담당'}</small></span></label>`).join('')||'<p class="bk-field-note">배정된 강사가 없습니다.</p>'}${review.after.paymentRequestCorrection?'<p class="bk-field-note">정정 뒤 추가미수가 남으면 저장 시 추가입금 알림톡을 요청합니다. 승인된 템플릿이 없으면 발송 대기로 남으며, 실제 도달 여부는 정정 이력에서 확인할 수 있습니다.</p>':'<label class="check-field bk-customer-sms"><input type="checkbox" name="customerSms" disabled> 고객 문자 <small>문자 서비스 연결 후 이용</small></label>'}</fieldset></div><footer><span>변경 내용과 사유를 확인한 후 확정해 주세요.</span><div><button type="button" class="btn ghost" data-bk-change-cancel ${pending?'disabled':''}>입력창 닫기</button><button type="button" class="btn secondary" data-bk-review-back ${pending?'disabled':''}>돌아가기</button><button type="submit" class="btn primary" ${pending?'disabled':''}>${pending?'변경 저장 중…':'변경 확정'}</button></div></footer></form></aside></div></div>`;
}

function paymentBookingGroupCards(settings){
  // 2026-11-16(N11): 입금검토 연결 여부와 무관하게, 같은 고객 묶음(commonGroupId)의
  // 미저장 팀 카드는 전부 한 번에 저장한다 — 팀별 저장으로 인한 중복 예약 방지.
  const source=settings.draft;
  if(source?.id||!source?.commonGroupId)return [];
  return (settings.teamDeck?.cards||[]).filter(card=>!card.serverId&&!card.draft.id&&card.status!=='saved'
    &&!card.draft.passIssueDone
    &&card.draft.commonGroupId===source.commonGroupId
    &&(card.draft.paymentReviewId||null)===(source.paymentReviewId||null));
}
const paymentGroupSaveLabel=settings=>{const cards=paymentBookingGroupCards(settings);return cards.length>1?`${cards.length}팀 · ${cards.reduce((sum,card)=>sum+bookingDateRows(card.draft).length,0)}회 함께 저장`:'';};

/** Prepare every unsaved team from one reviewed deposit before any RPC runs. */
export function preparePaymentBookingGroup(settings,context={}){
  const cards=paymentBookingGroupCards(settings),source=settings.draft,paymentLinked=!!source?.paymentReviewId;
  // 비연결(일반) 그룹도 한 번에 저장한다 — 재시도 멱등용 배치 번호를 그룹에 고정한다.
  const requestId=paymentLinked?source?.paymentCommitRequestId:(source.commonGroupBatchId||(source.commonGroupBatchId=globalThis.crypto.randomUUID()));
  const entries=[],errors=[],error=(card,index,rowId,message)=>errors.push({cardKey:card.key,index,rowId,message});
  if(cards.length<2)return null;
  if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)){
    error(cards[0],0,'','입금 예약의 저장 요청 번호를 다시 확인해 주세요.');return {entries,payloads:[],requestId,errors};
  }
  for(const card of cards){
    if(paymentLinked&&(card.draft.paymentReviewVersion!==source.paymentReviewVersion||(card.draft.paymentDepositId||null)!==(source.paymentDepositId||null)))error(card,0,'','같은 입금 검토의 최신 예약 카드만 함께 저장할 수 있습니다.');
    const draft=prepareCustomerIdentity(card.draft);if(paymentLinked)draft.paymentCommitRequestId=requestId;
    const batch=buildBookingBatch(draft,context);entries.push({key:card.key,draft:batch.draft,payloads:batch.payloads});
  }
  const payloads=entries.flatMap(entry=>entry.payloads),ids=new Set(payloads.map(row=>row.id));
  if(payloads.length>100)error(cards[0],0,'','한 입금에서 한 번에 최대 100회까지 예약할 수 있습니다.');
  if(ids.size!==payloads.length)error(cards[0],0,'','팀·회차별 예약 번호가 중복되었습니다. 초안을 다시 확인해 주세요.');
  const base={...context,reservations:(context.reservations||[]).filter(row=>!ids.has(row.id)),schedules:(context.schedules||[]).filter(row=>!ids.has(row.id)),passBalances:[]};
  const schedule=payload=>{const interval=parseLessonInterval(payload);return {id:payload.id,start:interval.start,end:interval.end,lessonMinutes:payload.lessonMinutes,breakMinutes:payload.breakMinutes,instructorUserIds:payload.instructorIds,instructorUserId:payload.instructorIds[0]||null};};
  for(const [entryIndex,entry]of entries.entries()){
    const ownIds=new Set(entry.payloads.map(row=>row.id)),others=payloads.filter(row=>!ownIds.has(row.id)),card=cards[entryIndex];
    const groupContext={...base,pendingReservations:[...(base.pendingReservations||[]),...others],schedules:[...base.schedules,...others.map(schedule)]};
    const checked=buildBookingBatch(entry.draft,groupContext);entry.payloads=checked.payloads;entry.draft=checked.draft;
    for(const issue of checked.errors)error(card,issue.index,issue.rowId,issue.message);
    for(const [index,row]of checked.payloads.entries()){
      const peers=payloads.filter(other=>other.id!==row.id),rowContext={...base,reservations:[...base.reservations,...peers],schedules:[...base.schedules,...peers.map(schedule)]};
      const message=validationError({...row,id:''},rowContext);
      if(message&&!errors.some(item=>item.cardKey===card.key&&item.rowId===row.id&&item.message===message))error(card,index,row.id,message);
    }
  }
  return {entries,payloads:entries.flatMap(entry=>entry.payloads),requestId,errors};
}

/** 입금검토 바로 저장(2026-11-17 사용자 확정): 검토양식이 곧 예약접수 양식 — [예약 저장]을
 * 누르면 드로어를 다시 열지 않고 승인 초안 팀들을 여기서 검증해 그대로 서버로 보낸다.
 * 검증 규칙은 드로어의 묶음 저장(preparePaymentBookingGroup)과 동일해야 한다. */
export function preparePaymentDirectCommit(drafts,context={}){
  if(!Array.isArray(drafts)||!drafts.length)return {entries:[],payloads:[],requestId:'',errors:[{cardKey:'',index:0,rowId:'',message:'저장할 예약 내용을 확인해 주세요.'}]};
  if(drafts.length>1){
    const group=globalThis.crypto.randomUUID();
    const cards=drafts.map((draft,index)=>({key:`direct-${index}`,status:'editing',draft:{...draft,commonGroupId:group}}));
    const prepared=preparePaymentBookingGroup({draft:cards[0].draft,teamDeck:{cards,activeKey:cards[0].key}},context);
    return prepared||{entries:[],payloads:[],requestId:'',errors:[{cardKey:'',index:0,rowId:'',message:'함께 저장할 팀 구성을 확인해 주세요.'}]};
  }
  const draft=prepareCustomerIdentity(drafts[0]),requestId=draft.paymentCommitRequestId;
  const errors=[];
  if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))errors.push({cardKey:'direct-0',index:0,rowId:'',message:'입금 예약의 저장 요청 번호를 다시 확인해 주세요.'});
  const batch=buildBookingBatch(draft,context);
  for(const issue of batch.errors)errors.push({cardKey:'direct-0',index:issue.index,rowId:issue.rowId,message:issue.message});
  const ids=new Set(batch.payloads.map(row=>row.id));
  const base={...context,reservations:(context.reservations||[]).filter(row=>!ids.has(row.id)),schedules:(context.schedules||[]).filter(row=>!ids.has(row.id)),passBalances:[]};
  for(const [index,row]of batch.payloads.entries()){
    const peers=batch.payloads.filter(other=>other.id!==row.id);
    const message=validationError({...row,id:''},{...base,reservations:[...base.reservations,...peers]});
    if(message&&!errors.some(item=>item.rowId===row.id&&item.message===message))errors.push({cardKey:'direct-0',index,rowId:row.id,message});
  }
  return {entries:[{key:'direct-0',draft:batch.draft,payloads:batch.payloads}],payloads:batch.payloads,requestId,errors};
}

function bookingSaveScope(settings){
  const draft=settings.draft,active=settings.teamDeck?.activeKey;
  const group=paymentGroupSaveLabel(settings);if(group)return `같은 입금의 ${group}`;
  const pending=(settings.teamDeck?.cards||[]).filter(card=>card.key!==active&&card.status!=='saved').length;
  const team=String(draft?.raw?.I||'기본팀').trim()||'기본팀';
  return `${team} · ${activeDraftCard(settings.teamDeck)?.status==='saved'?'저장 완료':draft?.id?'현재 예약 변경 검토':`${bookingDateRows(draft).length}회만 저장`}${pending?` · 다른 접수 ${pending}개 작성 중`:''}`;
}
function renderDrawer(settings,context,escape) {
  if(!settings.drawer)return '';
  if(settings.drawer==='settings')return settings.canManagePolicy?renderSettingsDrawer(settings,context,escape):'';
  if(settings.drawer==='review')return renderChangeReview(settings,context,escape);
  const draft=settings.draft;if(!draft)return '';
  const pane=settings.tab||'intake',active=activeDraftCard(settings.teamDeck),busy=settings.deckSaving||settings.reviewSaving||settings.deleteSaving||!!settings.deleteRequest||draftDeckSummary(settings.teamDeck).busy;
  const saved=context.reservations.find(row=>row.id===draft.id),deletable=!!saved&&!isCancelled(saved)&&active?.serverId===draft.id;
  return `<div class="bk-drawer-backdrop" data-bk-backdrop><div class="bk-team-deck"><aside data-bk-active-card="${escape(settings.teamDeck?.activeKey||'')}" class="bk-drawer bk-deck-drawer bk-board-layout bk-compact-layout" data-bk-card-status="${escape(active?.status||'draft')}" role="dialog" aria-modal="true" aria-label="예약 접수와 강사 배정"><header><div><span>${draft.id?'예약 관리':'NEW RESERVATION'}${settings.demo?' · 체험':''}</span><h2 class="bk-active-title"><span data-bk-active-customer>${escape(describeBookingCard(active||{draft}).customer)}</span><small data-bk-active-team>${escape(describeBookingCard(active||{draft}).team)}</small></h2><p data-bk-active-summary>${escape(describeBookingCard(active||{draft}).when)}${describeBookingCard(active||{draft}).contact?` · ${escape(describeBookingCard(active||{draft}).contact)}`:''}</p></div><button type="button" class="btn ghost small bk-window-close" data-bk-close aria-label="입력창 닫기 — 저장하지 않은 내용 삭제" title="입력창 닫기 — 저장하지 않은 내용 삭제" ${busy?'disabled':''}>입력창 닫기 <b aria-hidden="true">×</b></button></header>${renderDeckRail(settings,escape)}<nav class="bk-drawer-tabs" aria-label="예약 입력 위치 바로가기">${[['intake','01 고객 공통'],['team','02 팀 정보'],['financial','03 일정·금액'],['assignment','강사 선택(선택)'],...(draft.id?[['history','변경 이력']]:[])].map(([key,label])=>`<button type="button" data-bk-tab="${key}" class="${pane===key?'active':''}">${label}</button>`).join('')}</nav><form class="bk-reservation-form" ${busy?'data-busy="1"':''} novalidate><div class="bk-drawer-body"><p class="bk-review-saving" data-bk-deck-saving role="status" ${busy?'':'hidden'}>${paymentGroupSaveLabel(settings)?'같은 입금의 모든 팀·회차를 함께 저장하고 있습니다.':'이 팀의 예약을 저장하고 있습니다.'}</p>${renderDeckSaveNotice(settings,escape)}${settings.deckNotice?`<p class="bk-deck-notice" role="status" tabindex="-1" data-bk-existing-draft-notice>${escape(settings.deckNotice)}</p>`:''}${renderCardError(settings,escape)}<div class="bk-onepage-layout">${rawIntake(draft,context,escape,settings)}</div></div><footer><span class="bk-save-scope" data-bk-save-scope title="${escape(bookingSaveScope(settings))}">${escape(bookingSaveScope(settings))}</span><div>${deletable?`<button type="button" class="btn ghost bk-delete-reservation" data-bk-delete-reservation ${busy?'disabled':''}>예약 삭제</button>`:''}<button type="button" class="btn secondary" data-bk-close ${busy?'disabled':''}>입력창 닫기</button><button type="submit" class="btn primary" ${busy||active?.status==='saved'?'disabled':''}>${draft.id?'변경 내용 검토':paymentGroupSaveLabel(settings)|| (bookingDateRows(draft).length>1?`${bookingDateRows(draft).length}회 한 번에 저장`:settings.demo?'체험 예약 저장':'예약 저장')}</button></div></footer></form>${renderPassIssueModal(settings,context,escape)}${renderCardCloseConfirm(settings,escape)}${renderReservationDelete(settings,escape)}</aside></div></div>`;
}

function renderSettingsDrawer(settings,context,escape) {
  const policy=policyValues(context.settings),people=(context.roster||[]).filter(person=>person.role==='instructor'&&person.active);
  return `<div class="bk-drawer-backdrop" data-bk-backdrop><aside class="bk-drawer bk-settings-drawer" role="dialog" aria-modal="true" aria-label="강사 조건과 자동 배정 기준"><header><div><span>ASSIGNMENT SETTINGS${settings.demo?' · 체험':''}</span><h2>강사 조건·배정 기준</h2><p>관리자가 확인한 조건으로 배정합니다.</p></div><button type="button" class="icon-btn" data-bk-close aria-label="설정 창 닫기">×</button></header><div class="bk-drawer-body"><form class="bk-policy-form"><h3>경력강사 필요 기준</h3><div class="bk-form-grid"><label class="field"><span class="field-label">나이 기준 · 이하</span><input name="bookingExpertAgeMax" type="number" min="0" max="18" required value="${escape(policy.bookingExpertAgeMax)}"></label><label class="field"><span class="field-label">강습 경험 기준 · 이상</span><input name="bookingExpertExperienceMin" type="number" min="1" max="100" required value="${escape(policy.bookingExpertExperienceMin)}"></label></div>${selectField('bookingExpertMode','조건 적용',policy.bookingExpertMode,[['either','나이 조건 또는 경험·종목별 기술 조건'],['both','나이 조건과 경험·종목별 기술 조건 모두'],['age','나이 조건만'],['skill','경험·종목별 기술 조건만']],escape)}${selectField('bookingExpertParallelMode','스키 · 경험 기준에 적용할 패러렐 롱턴 응답',policy.bookingExpertParallelMode,[['capable','패러렐 롱턴 가능'],['not_capable','패러렐 롱턴 불가능'],['either','가능·불가능 응답 모두']],escape)}${selectField('bookingExpertSnowboardMode','보드 · 경험 기준에 적용할 S자 너비스턴 응답',policy.bookingExpertSnowboardMode,[['capable','S자 너비스턴 가능'],['not_capable','S자 너비스턴 불가능'],['either','가능·불가능 응답 모두']],escape)}<p class="bk-field-note">강습 경험 횟수와 위 응답 조건을 함께 확인합니다.</p><div class="bk-form-error" role="alert" hidden></div><button type="submit" class="btn secondary small">배정 기준 저장</button></form><div class="bk-settings-divider"></div><h3>강사별 확인 정보</h3><p class="bk-field-note">종목·지점·경력을 확인한 강사만 자동 배정에 포함됩니다.</p>${people.map(person=>{const capability=(context.capabilities||[]).find(item=>(item.instructor_user_id||item.instructorUserId)===person.user_id)||{};return `<form class="bk-capability-form" data-instructor="${escape(person.user_id)}"><h4>${escape(person.display_name)}</h4><div class="bk-capability-flags"><label class="check-field"><input type="checkbox" name="isExperienced" ${capability.is_experienced||capability.isExperienced?'checked':''}> 경력강사</label><label class="check-field"><input type="checkbox" name="verified" ${capability.verified?'checked':''}> 관리자 확인 완료</label></div><fieldset><legend>가능 종목</legend>${['스키','보드'].map(sport=>`<label class="check-field"><input type="checkbox" name="sports" value="${sport}" ${list(capability.sports).includes(sport)?'checked':''}> ${sport}</label>`).join('')}</fieldset><label class="field"><span class="field-label">가능 지점</span><input name="locations" value="${escape(list(capability.locations).join(', '))}" placeholder="곤지암, 지산, 비발디"><span class="field-help">쉼표로 구분해 입력하세요.</span></label><div class="bk-form-error" role="alert" hidden></div><button type="submit" class="btn secondary small">강사 조건 저장</button></form>`;}).join('')||'<p class="bk-field-note">등록된 강사 계정이 없습니다.</p>'}</div><footer><span>${settings.demo?'체험 설정 · 실제 기록 없음':'관리자 전용 설정'}</span><button type="button" class="btn primary" data-bk-close>완료</button></footer></aside></div>`;
}

// 한 예약의 모든 열(숨김 원본 포함)을 세로로 보여주는 전체보기 팝업 (#12).
function renderRowDetail(settings,context,escape){
  const id=settings.detailId;if(!id)return '';
  const source=(context.reservations||[]).find(row=>row.id===id);if(!source)return '';
  const row=normalizeBookingRow(source,context),summary=financialSummary(row),rental=rentalDetails(row);
  const value=v=>v===''||v===null||v===undefined?'—':String(v);
  const entries=[
    ['담당 강사',row.instructorIds.length?row.instructorIds.map(x=>instructorName(x,context)).join(' · '):'미배정'],
    ['장비렌탈',`${rentalStatusLabel(rental.status)}${rental.hours?` · ${rental.hours}시간`:''}${rental.amount===null?'':` · ${money(rental.amount)}원`}`],
    ['요청금액(자동)',summary?`${money(summary.requested)}원`:'—'],
    ['미수금(자동)',summary?`${money(summary.balance)}원`:'—'],
    ...RAW_COLUMNS.map(column=>[column.label||`원본 ${column.key}`,value(row.raw[column.key])]),
  ];
  return `<div class="bk-detail-backdrop" data-bk-detail-backdrop><section class="bk-detail-pop" role="dialog" aria-modal="true" aria-label="예약 전체보기"><header><h3>${escape(rowName(row,context))} <small>${escape(dateText(row.raw.A))} ${escape(row.raw.B||'')}</small></h3><button type="button" class="icon-btn" data-bk-detail-close aria-label="전체보기 닫기">×</button></header><dl>${entries.map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl><footer><button type="button" class="btn secondary small" data-bk-detail-open="${escape(row.id)}">예약 변경 열기</button><button type="button" class="btn ghost small" data-bk-detail-close>닫기</button></footer></section></div>`;
}

// 고객관리 이력 표의 금액 빠른 수정(2026-11-15): 강습료·입금액·장비상태만 바꿔
// 기존 예약 변경 계약(검증·변경이력·요청액 자동계산)을 그대로 태운다.
export function buildQuickAmountChange(row,context,{lessonFee,paidAmount,rentalPaymentStatus,rentalHours,rentalAmount}={}){
  const draft=normalizeBookingRow(clone(row),context);
  draft.raw={...draft.raw,
    T:lessonFee===undefined?String(draft.raw.T??''):String(lessonFee??''),
    Y:paidAmount===undefined?String(draft.raw.Y??''):String(paidAmount??'')};
  if(rentalPaymentStatus!==undefined){
    const status=['free','paid','onsite_unpaid'].includes(rentalPaymentStatus)?rentalPaymentStatus:null;
    draft.rentalPaymentStatus=status;
    const hours=[4,6].includes(Number(rentalHours))?Number(rentalHours):null;
    draft.rentalHours=status?hours:null;
    const per=rentalDefaultAmount(draft.rentalHours),count=Math.max(1,numeric(draft.raw.M)||1);
    draft.rentalAmount=status==='free'?0:status&&per!==null?per*count:null;
    // 그룹 수정(2026-11-17): 직접 입력한 렌탈 금액은 기본요금 대신 그대로 보존한다.
    if(rentalAmount!==undefined&&rentalAmount!==null&&Number.isSafeInteger(Number(rentalAmount))&&status!=='free'){
      draft.rentalAmount=Number(rentalAmount);
      draft.rentalCustomAmount=Number(rentalAmount)!==(per!==null?per*count:null);
    }
  }
  let error=validationError(draft,context);
  // 금액만 고치는 경로: 현금영수증 미응답(레거시)은 그대로 보존하고 막지 않되,
  // 그 뒤의 금액·렌탈 검증은 임시값으로 끝까지 수행한다.
  if(error&&/현금영수증/.test(error)&&(row.cashReceiptRequested??row.cash_receipt_requested??null)===null)
    error=validationError({...draft,cashReceiptRequested:false},context);
  if(error)throw Object.assign(new Error(error),{code:'QUICK_AMOUNT_INVALID'});
  return bookingPayload(draft,context);
}

export function renderBookingPage({state={},ui={},escapeHTML=fallbackEscape,icon=()=>'',now=new Date()}={}) {
  const role=state.profile?.role||ui.role;if(!['admin','counselor'].includes(role))return '<section class="panel"><div class="empty-state"><strong>예약 관리 권한이 필요합니다.</strong></div></section>';
  const escape=escapeHTML,settings=bookingState(state,ui,now),context=contextFor(state,settings,now),allRows=selectBookingRows(context,settings);
  const rows=filterBookingTableRows(allRows,settings,context);
  const total=context.reservations.filter(row=>!isCancelled(row)).length,people=rows.reduce((sum,row)=>sum+(numeric(row.raw.M)||0),0),unassigned=rows.filter(row=>!row.instructorIds.length).length,expert=rows.filter(row=>expertRequirement(row,context.settings).required).length;
  settings.canManagePolicy=role==='admin';if(!settings.canManagePolicy&&settings.drawer==='settings')settings.drawer=null;
  const companies=unique(context.reservations.map(row=>row.raw.E));
  return `<section class="booking-page" aria-label="예약 접수와 강사 배정"><div class="bk-page-heading"><div><span class="bk-eyebrow">RESERVATION DESK</span><h1>예약·강사 배정</h1><p>전체 예약을 세로로 확인하고, 접수부터 강사 배정까지 이어서 처리하세요.</p></div><div class="bk-heading-actions"><button type="button" class="btn secondary" data-bk-autoassign-top>자동배정</button>${settings.canManagePolicy?`<button type="button" class="btn secondary" data-bk-settings>${icon('settings')}강사 조건 설정</button>`:''}<button type="button" class="btn primary" data-bk-new>${icon('plus')}예약 등록</button></div></div><div class="bk-mode-bar"><div>${badge(settings.demo?'체험 예약표':'운영 예약표',settings.demo?'amber':'teal',escape)}<span>${settings.demo?'예시로 접수·리오더·시즌 배정을 직접 해보세요. 실제 기록은 바뀌지 않습니다.':'서버에 저장된 예약을 관리합니다.'}</span></div><button type="button" class="bk-mode-toggle" data-bk-demo>${settings.demo?'운영 예약표로 전환':'체험 데이터 보기'} →</button></div><div class="bk-stats"><article><span>조회된 강습</span><strong>${rows.length}<small>건</small></strong><p>전체 ${total}건 중</p></article><article><span>강습생 인원</span><strong>${people}<small>명</small></strong><p>현재 조회된 인원 합계</p></article><article class="bk-stat-highlight"><span>미배정</span><strong>${unassigned}<small>건</small></strong><p>담당 강사 배정 필요</p></article><article><span>경력강사 필요</span><strong>${expert}<small>건</small></strong><p>나이·경험·종목별 기술 응답 기준</p></article></div><section class="panel bk-filters"><form class="bk-filter-form"><label><span>강습일</span><input type="date" name="date" value="${escape(settings.date)}"></label><label><span>강습업체·지점</span><select name="company">${option('all','전체 업체',settings.company,escape)}${companies.map(company=>option(company,company,settings.company,escape)).join('')}</select></label><label><span>종목</span><select name="sport">${[['all','전체'],['스키','스키'],['보드','보드']].map(([key,label])=>option(key,label,settings.sport,escape)).join('')}</select></label><label><span>예약 구분</span><select name="kind">${option('all','전체',settings.kind,escape)}${Object.entries(kinds).map(([key,label])=>option(key,label,settings.kind,escape)).join('')}</select></label><label class="bk-search"><span>검색</span><input type="search" name="query" value="${escape(settings.query)}" placeholder="강습생 · 입금자 · 특이사항"></label><button type="submit" class="btn secondary">조회</button><button type="button" class="btn ghost" data-bk-reset>초기화</button></form><div class="bk-quick-filters">${[['all','전체'],['unassigned','미배정'],['assigned','배정 완료'],['unpaid','추가입금 필요']].map(([key,label])=>`<button type="button" data-bk-assignment="${key}" class="${settings.assignment===key?'active':''}" aria-pressed="${settings.assignment===key}">${label}</button>`).join('')}${Object.values(settings.colFilters||{}).filter(Array.isArray).length?`<button type="button" class="bk-filters-clear" data-bk-filters-clear>열 필터 ${Object.values(settings.colFilters||{}).filter(Array.isArray).length}개 지우기 ✕</button>`:''}<button type="button" class="btn secondary small" data-bk-bulk-open ${(settings.bulkIds||[]).length?'':'hidden'}>☑ 선택 ${(settings.bulkIds||[]).length}건 그룹 수정</button><button type="button" class="bk-filters-clear" data-bk-bulk-clear ${(settings.bulkIds||[]).length?'':'hidden'}>선택 해제 ✕</button><span class="bk-color-legend"><i class="bk-legend-due"></i>입금요청 필요 <i class="bk-legend-catch"></i>캐치 <i class="bk-legend-risen"></i>라이즌</span><a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">기존 구글시트 ↗</a></div></section>${renderTimeSummary(rows,context,escape)}${renderBulkEditor(settings,escape)}${renderTable(rows,context,settings,escape,allRows)}<p class="bk-source-status">${badge(settings.demo?'체험 데이터':'웹 예약 기록','neutral',escape)} ${settings.demo?'예시 예약은 실제 구글시트에 반영되지 않습니다.':'원본 형식의 입력값을 보존합니다. 자동 기록 결과는 Google Sheets 상태 표시에서 확인하세요.'}</p>${renderRowDetail(settings,context,escape)}${renderDrawer(settings,context,escape)}</section>`;
}

// 예약표 그룹 수정(2026-11-17 사용자 확정): 행 체크 → 장비렌탈 상태·시간·금액과
// 받은 금액을 한 번에 적용. 요청액·미수금은 저장 시 자동 재계산(FINANCIAL v3).
function renderBulkEditor(settings,escape){
  const ids=settings.bulkIds||[];
  if(!settings.bulkOpen||!ids.length)return '';
  const result=settings.bulkResult;
  return `<section class="panel bk-bulk-editor" data-bk-bulk-editor><div class="bk-section-label"><span>GROUP</span><h3>선택한 ${ids.length}건 그룹 수정</h3><small>'변경 안 함'·빈칸 항목은 그대로 둡니다</small></div><div class="bk-form-grid">${selectField('bulkRentalStatus','장비렌탈 결제상태','keep',[['keep','변경 안 함'],['onsite_unpaid','미결제(당일 코코넛 실사용 확인)'],['free','무료'],['paid','결제완료']],escape)}${selectField('bulkRentalHours','장비렌탈 이용시간','keep',[['keep','변경 안 함(자동 기본요금)'],['4','4시간'],['6','6시간']],escape)}<label class="field"><span class="field-label">렌탈 금액 <small>비우면 기본요금×인원 자동</small></span><span class="bk-suffixed"><input type="number" name="bulkRentalAmount" min="0" step="1" inputmode="numeric" placeholder="자동"><span>원</span></span></label><label class="field"><span class="field-label">받은 금액(입금액) <small>비우면 변경 안 함</small></span><span class="bk-suffixed"><input type="number" name="bulkPaidAmount" min="0" step="1" inputmode="numeric" placeholder="변경 안 함"><span>원</span></span></label></div><p class="bk-field-note">실제 받아야 할 금액·미수금은 강습료+장비 기준으로 저장 시 자동 재계산됩니다. 각 건은 개별 검증을 통과해야 저장되고, 실패한 건은 건너뛴 뒤 아래에 사유가 남으며 선택 상태로 유지됩니다.</p>${result?`<div class="bk-bulk-result" role="status"><strong>적용 결과 · 성공 ${result.ok}건 · 실패 ${result.failed.length}건</strong>${result.failed.length?`<ul>${result.failed.map(item=>`<li>${escape(item.label)} — ${escape(item.message)}</li>`).join('')}</ul>`:''}</div>`:''}<div class="bk-pass-inline-actions"><button type="button" class="btn primary" data-bk-bulk-apply>선택 ${ids.length}건에 적용</button><button type="button" class="btn ghost" data-bk-bulk-close>닫기</button></div></section>`;
}
function draftFromForm(form,draft) {
  const data=new FormData(form);let next=clone(draft);
  for(const column of RAW_COLUMNS){const key=`raw_${column.key}`;if(column.key!=='L'&&data.has(key)){const value=String(data.get(key)||'');if(column.key!=='E'||normalizeBookingCompany(value)!==normalizeBookingCompany(draft.raw.E))next.raw[column.key]=value;}}
  if(data.has('raw_L')){
    const typed=String(data.get('raw_L')||''),kakaoBox=form.elements.namedItem('contactKakaoMode');
    if(kakaoBox){
      // 카카오 ID 예외: 체크 상태면 입력값을 '카카오:아이디' 저장 형태로 감싼다.
      next.contactKakaoMode=kakaoBox.checked===true;
      next.customerContactPhone=next.contactKakaoMode?kakaoContactValue(kakaoContactId(typed)??typed.trim()):typed;
    }else next.customerContactPhone=typed;
  }
  if(data.has('teamPhoneMode'))next.teamPhoneMode=data.get('teamPhoneMode')==='separate'?'separate':'same';
  if(next.teamPhoneMode==='separate'){if(data.has('teamPhone'))next.raw.L=String(data.get('teamPhone')||'');}
  else next.raw.L=customerPhoneOf(next);
  if(data.has('lessonMinutes'))next.lessonMinutes=numeric(data.get('lessonMinutes'));
  if(data.has('breakMinutes'))next.breakMinutes=numeric(data.get('breakMinutes'))??0;
  if(next.lessonMinutes!==240){next.breakMinutes=0;if(next.paymentReviewId)next.paymentNeedsBreakConfirmation=false;}
  else if(next.paymentReviewId&&data.has('breakMinutes')&&String(data.get('breakMinutes'))!=='')next.paymentNeedsBreakConfirmation=false;
  if(lessonPlanSettings(next).explicit&&!next.paymentNeedsBreakConfirmation)next=applyLessonPlan(next);
  const patch=form.elements.namedItem('patchEnabled');
  if(patch){next.patchEnabled=patch.checked;if(!patch.checked){next.raw.U='';next.raw.R='';}}
  next.financialVersion=FINANCIAL_VERSION;
  if(next.raw.E!==draft.raw.E)next.location=bookingLocation({raw:next.raw});
  next.kind=String(data.get('kind')||next.kind||'single');
  for(const name of ['isReorder','designated','copyTeamConditions']){const field=form.elements.namedItem(name);if(field&&!field.disabled)next[name]=field.checked===true;}
  if(next.kind==='reorder')next.isReorder=true;if(next.isReorder)next.designated=true;
  if(data.has('participant_0_type')){
    next.participants=resizeParticipants(next.participants,numeric(next.raw.M)).map((person,index)=>{const type=data.has(`participant_${index}_type`)?String(data.get(`participant_${index}_type`)||''):person.type;return{type,age:type==='adult'?null:data.has(`participant_${index}_age`)?numeric(data.get(`participant_${index}_age`)):person.age};});
  }
  if(data.has('cashReceiptRequested')){next.cashReceiptRequested=data.get('cashReceiptRequested')==='true'?true:data.get('cashReceiptRequested')==='false'?false:null;}
  if(data.has('cashReceiptNumberMode'))next.cashReceiptNumberMode=data.get('cashReceiptNumberMode')==='manual'?'manual':'team_phone';
  if(data.has('cashReceiptNumber'))next.cashReceiptNumber=String(data.get('cashReceiptNumber')||'');
  if(next.cashReceiptRequested!==true){next.cashReceiptNumber='';next.cashReceiptNumberMode='team_phone';}
  if(data.has('ageBand'))next.ageBand=String(data.get('ageBand')||'')||null;
  if(next.ageBand)next.age=null;else if(data.has('age'))next.age=numeric(data.get('age'));
  const junior=form.elements.namedItem('juniorPreparation');if(junior&&!junior.disabled)next.juniorPreparation=junior.checked===true;
  if(data.has('experienceCount'))next.experienceCount=numeric(data.get('experienceCount'));
  if(data.has('parallelLongTurn'))next.parallelLongTurn=data.get('parallelLongTurn')==='true'?true:data.get('parallelLongTurn')==='false'?false:null;
  if(data.has('snowboardNoviceTurn'))next.snowboardNoviceTurn=data.get('snowboardNoviceTurn')==='true'?true:data.get('snowboardNoviceTurn')==='false'?false:null;
  if(data.has('lessonPassId'))next.lessonPassId=String(data.get('lessonPassId')||'')||null;
  if(data.has('rentalPaymentStatus'))next.rentalPaymentStatus=String(data.get('rentalPaymentStatus')||'')||null;
  if(data.has('rentalHours'))next.rentalHours=numeric(data.get('rentalHours'));
  if(data.has('rentalAmount'))next.rentalAmount=numeric(data.get('rentalAmount'));
  if(data.has('rentalPaymentStatus'))next.rentalCustomAmount=data.has('rentalCustomAmount');
  if(next.rentalPaymentStatus===null){next.rentalHours=null;next.rentalAmount=null;next.rentalCustomAmount=false;}
  else if(next.rentalPaymentStatus==='free'){next.rentalAmount=0;next.rentalCustomAmount=false;}
  const correction=correctionFromForm(form,next);if(correction)next.paymentRequestCorrection=correction;else delete next.paymentRequestCorrection;
  try{next.raw=applyFinancialV3(next);}catch{/* Keep invalid entered values available for correction. */}

  if(data.has('preferredInstructorId'))next.preferredInstructorId=String(data.get('preferredInstructorId')||'')||null;
  if(data.has('passTotalSessions'))next.passTotalSessions=String(data.get('passTotalSessions')||'').trim();
  // 수강권 구성 행(passCfg_{issueId}_*): 폼의 행 집합은 항상 draft.passConfigs 가 원천이다
  // (행 추가·삭제는 update 로 draft 를 바꾼 뒤 재렌더). 발급 완료 행은 입력이 disabled 라
  // FormData 에 없으므로 기존 값을 유지하고, 발급번호(issueId)는 멱등 키로 그대로 보존한다.
  if(Array.isArray(next.passConfigs)&&next.passConfigs.length){
    next.passConfigs=next.passConfigs.map(row=>({...row,
      minutes:data.has(`passCfg_${row.issueId}_minutes`)?String(data.get(`passCfg_${row.issueId}_minutes`)||'').trim():row.minutes,
      sessions:data.has(`passCfg_${row.issueId}_sessions`)?String(data.get(`passCfg_${row.issueId}_sessions`)||'').trim():row.sessions,
      fee:data.has(`passCfg_${row.issueId}_fee`)?String(data.get(`passCfg_${row.issueId}_fee`)||'').trim():row.fee}));
  }
  if(next.historyInstructorSelection&&next.historyInstructorSelection.identity!==customerIdentitySignature(next)){next.preferredInstructorId=null;delete next.historyInstructorSelection;}
  if(data.has('seasonId'))next.seasonId=String(data.get('seasonId')||'')||null;
  if(data.has('seasonTotal'))next.seasonTotal=numeric(data.get('seasonTotal'));if(data.has('sessionNumber'))next.sessionNumber=numeric(data.get('sessionNumber'));
  const checkedIds=[...form.querySelectorAll('input[name="instructorIds"]:checked')].map(input=>input.value);
  // Keep existing assignments visible even when newly edited conditions block them.
  // Saving then requires an explicit valid re-selection or clearing the assignment.
  next.instructorIds=unique(checkedIds);
  if(!next.id){
    if(next.raw.H!==draft.raw.H&&next.customerId&&(!next.customerDraft||(next.sameCustomerNewTeam&&!next.commonGroupId))){
      next.customerId=null;next.customerTeamId=null;delete next.commonGroupId;delete next.customerDraft;delete next.teamDraft;next.lessonPassId=null;next.seasonId=null;next.preferredInstructorId=null;next.instructorIds=[];next.sameCustomerNewTeam=false;
    }else if(next.raw.I!==draft.raw.I&&next.customerTeamId&&!next.teamDraft){next.customerTeamId=null;delete next.teamDraft;next.lessonPassId=null;next.seasonId=null;next.preferredInstructorId=null;next.instructorIds=[];}
  }
  if(data.has('batchCalendarMonth'))next.datePickerMonth=String(data.get('batchCalendarMonth')||'');
  for(const [field,key]of [['batchRepeatStart','repeatStart'],['batchRepeatWeeks','repeatWeeks'],['batchRepeatCount','repeatCount']])if(data.has(field))next[key]=String(data.get(field)||'');
  if(!next.id&&next.dateBatch){
    next=ensureBookingDates(next);
    for(const row of bookingDateRows(next).slice(1)){
      const changes={};for(const key of ['date','startTime','endTime','company','duration'])if(data.has(`date_${row.id}_${key}`)){const value=String(data.get(`date_${row.id}_${key}`)||'');if(key!=='company'||normalizeBookingCompany(value)!==normalizeBookingCompany(row.company))changes[key]=value;}
      const prefix=`date_${row.id}_`,financial={raw:{}};
      for(const key of ['T','Y','U','R','P'])if(data.has(`${prefix}raw_${key}`))financial.raw[key]=String(data.get(`${prefix}raw_${key}`)||'');
      const patch=form.elements.namedItem(`${prefix}patchEnabled`);if(patch&&!patch.checked){financial.raw.U='';financial.raw.R='';}
      for(const key of ['rentalPaymentStatus','rentalHours','rentalAmount'])if(data.has(prefix+key))financial[key]=key==='rentalPaymentStatus'?String(data.get(prefix+key)||'')||null:numeric(data.get(prefix+key));
      if(data.has(prefix+'rentalPaymentStatus'))financial.rentalCustomAmount=data.has(prefix+'rentalCustomAmount');
      if(financial.rentalPaymentStatus===null){financial.rentalHours=null;financial.rentalAmount=null;financial.rentalCustomAmount=false;}
      if(financial.rentalPaymentStatus==='free'){financial.rentalAmount=0;financial.rentalCustomAmount=false;}
      if(form.elements.namedItem(`${prefix}paymentCorrectionEnabled`))financial.paymentRequestCorrection=correctionFromForm(form,row.financial,prefix)||null;
      if(Object.keys(financial.raw).length||Object.keys(financial).length>1)changes.financial=financial;
      for(const key of ['lessonMinutes','breakMinutes'])if(data.has(`date_${row.id}_${key}`))changes[key]=numeric(data.get(`date_${row.id}_${key}`));
      if(changes.lessonMinutes!==undefined&&changes.lessonMinutes!==240)changes.breakMinutes=0;
      if(Object.keys(changes).length)next=updateBookingDate(next,row.id,changes);
    }
  }
  if(!next.id&&next.dateBatch&&next.raw.E!==draft.raw.E){
    for(const row of bookingDateRows(next).slice(1))next=updateBookingDate(next,row.id,{company:next.raw.E});
  }
  return prepareCustomerIdentity(automaticBookingSeason(next));
}

function newDraft(context,now) {
  const raw={};for(const column of RAW_COLUMNS)raw[column.key]='';
  Object.assign(raw,{A:day(now),B:'09:00',C:'11:00',D:'스키',E:'',J:'1회',M:'1',N:'2시간'});
  return ensureBookingDates(prepareCustomerIdentity(normalizeBookingRow({raw,participants:[{type:'',age:null}],cashReceiptRequested:null,cashReceiptNumberMode:'team_phone',cashReceiptNumber:'',lessonMinutes:120,breakMinutes:0,age:null,ageBand:null,juniorPreparation:false,customerContactPhone:'',teamPhoneMode:'same',experience_count:null,parallel_long_turn:null,snowboard_novice_turn:null,lessonPassId:null,rentalPaymentStatus:null,rentalHours:null,rentalAmount:null,financialVersion:FINANCIAL_VERSION,kind:'single',designated:false,status:'received'})));
}

function validationError(draft,context) {
  draft=automaticBookingSeason(draft,context);
  const original=(context.reservations||[]).find(row=>row.id===draft.id);
  const correctionError=correctionValidationError(draft,original);if(correctionError)return correctionError;
  if(isCancelled(draft)||isCancelled(original))return '삭제된 예약은 수정할 수 없습니다.';
  const legacyCustomer=original&&!String(original.raw.H||'').trim()&&String(original.raw.I||'').trim()&&String(original.raw.I||'')===String(draft.raw.I||'');
  if(!draft.raw.H.trim()&&!legacyCustomer)return '고객명(입금자)을 입력해 주세요.';
  if(draft.sameCustomerNewTeam&&!String(draft.raw.I||'').trim())return '다른 팀을 구분할 강습생·팀 이름을 입력해 주세요.';
  if(draft.teamDraft&&draft.customerId&&(context.customerTeams||[]).some(team=>(team.customer_id||team.customerId)===draft.customerId&&String(team.name||'').trim()===String(draft.raw.I||'').trim()&&team.id!==draft.customerTeamId))return '이 고객에게 같은 이름의 팀이 있습니다. 등록된 팀에서 선택해 주세요.';
  const phone=String(draft.raw.L||'').trim(),customerContact=customerPhoneOf(draft);
  // 카카오 ID 예외: '카카오:아이디' 값은 전화 형식 검사를 대신한다(별도 팀 번호는 전화만).
  if(!canonicalTelephone(customerContact)&&!kakaoContactId(customerContact))return draft.contactKakaoMode?'카카오톡 ID를 입력해 주세요.':'고객 연락처를 올바르게 입력해 주세요. 해외 고객은 카카오톡 ID 예외를 선택할 수 있습니다.';
  if(!canonicalTelephone(phone)&&!(draft.teamPhoneMode!=='separate'&&kakaoContactId(phone)))return '강습 안내를 받을 팀 연락처를 올바르게 입력해 주세요.';
  if(phone&&!canonicalTelephone(phone)&&!kakaoContactId(phone)&&(!original||String(original.raw.L||'')!==String(draft.raw.L||'')))return '전화번호 형식을 확인해 주세요. 예: 010-1234-5678';
  if(!draft.raw.E.trim())return '강습업체·지점을 입력해 주세요.';
  if(!['스키','보드'].includes(String(draft.raw.D||'').trim()))return '강습 종목을 선택해 주세요.';
  if(!Number.isInteger(numeric(draft.raw.M))||numeric(draft.raw.M)<1||numeric(draft.raw.M)>1000)return '강습 인원을 1명 이상으로 확인해 주세요.';
  const participantError=participantValidationError(draft.participants,numeric(draft.raw.M));if(participantError)return participantError;
  const learnerAge=learnerAgeDetails(draft);if(learnerAge.error)return learnerAge.error;
  // 운영 결정(2026-11-15): 수준 '입문'이면 이전 강습 경험은 자동 0회.
  if((draft.experienceCount===null||draft.experienceCount===undefined)&&String(draft.raw.O||'').trim()==='입문')draft.experienceCount=0;
  if(draft.experienceCount===null||draft.experienceCount===undefined)return '이전 강습 경험을 입력해 주세요. 처음이면 0회를 입력해 주세요.';
  // 기술 응답(패러렐 롱턴·S자 너비스턴) 미선택은 '불가'로 간주 — 접수를 막지 않는다.
  if(!String(draft.raw.Q||'').trim())return '결제 소스를 선택해 주세요.';
  // 현금영수증은 계좌이체 결제에만 해당 — 명시적 다른 수단이면 자동 '아니오'.
  {const q=String(draft.raw.Q||'').trim();if(q&&q!=='계좌이체')draft.cashReceiptRequested=false;}
  if(String(draft.raw.T??'').trim()===''||!Number.isSafeInteger(numeric(draft.raw.T))||numeric(draft.raw.T)<0)return '강습요금을 0원 이상의 정수로 입력해 주세요. 무료이면 0원을 입력해 주세요.';
  // 2026-11-17(사용자 확정): 현금영수증 요청은 필수 입력이 아니다 — '미확인(선택 안 함)'도 저장.
  if(draft.cashReceiptRequested!==null&&typeof draft.cashReceiptRequested!=='boolean')return '현금영수증 요청 여부를 확인해 주세요.';
  if(draft.cashReceiptRequested&&draft.cashReceiptNumberMode==='manual'&&!/^\d{8,20}$/.test(String(draft.cashReceiptNumber||'').replace(/[-\s]/g,''))&&!(draft.cashReceiptNumberSet&&original?.cashReceiptNumberMode==='manual'&&!String(draft.cashReceiptNumber||'').trim()))return '현금영수증 발급번호를 숫자 8~20자리로 입력해 주세요.';
  if(draft.experienceCount!==null&&(!Number.isInteger(draft.experienceCount)||draft.experienceCount<0||draft.experienceCount>999))return '강습 경험을 0회 이상의 정수로 입력해 주세요.';
  const customerPhone=customerPhoneOf(draft),oldCustomerPhone=original?customerPhoneOf(original):null;
  if(customerPhone.trim()&&!canonicalTelephone(customerPhone)&&!kakaoContactId(customerPhone)&&customerPhone!==oldCustomerPhone)return '고객 전화번호 형식을 확인해 주세요. 예: 010-1234-5678';
  if(draft.teamPhoneMode==='separate'&&!String(draft.raw.L||'').trim())return '팀의 별도 전화번호를 입력해 주세요.';
  const interval=parseLessonInterval(draft);if(interval.error)return interval.error;
  if(![null,'free','paid','onsite_unpaid'].includes(draft.rentalPaymentStatus))return '장비렌탈 결제상태를 확인해 주세요.';
  if(draft.rentalPaymentStatus==='free'&&draft.rentalAmount!==0)return '무료 장비렌탈은 금액을 0원으로 기록해 주세요.';
  if(draft.rentalPaymentStatus==='paid'){
    if(![4,6].includes(draft.rentalHours))return '장비렌탈 이용시간을 4시간 또는 6시간으로 선택해 주세요.';
    if(!Number.isSafeInteger(draft.rentalAmount)||draft.rentalAmount<0)return '장비렌탈 금액을 0원 이상의 정수로 입력해 주세요.';
  }
  // 2026-11-15 운영 결정: 미결제는 시간·금액 미정 그대로 저장 — 당일 코코넛렌탈샵
  // 실사용 시간·금액으로 확정한다. 적어 두는 값이 있으면 형식만 검증한다.
  if(draft.rentalPaymentStatus==='onsite_unpaid'){
    if(draft.rentalHours!==null&&draft.rentalHours!==undefined&&![4,6].includes(draft.rentalHours))return '장비렌탈 이용시간은 4시간·6시간만 선택할 수 있습니다. 미정이면 비워 두세요.';
    if(draft.rentalAmount!==null&&draft.rentalAmount!==undefined&&(!Number.isSafeInteger(draft.rentalAmount)||draft.rentalAmount<0))return '장비렌탈 금액을 0원 이상의 정수로 입력하거나 비워 두세요.';
  }

  if(draft.paymentNeedsBreakConfirmation&&draft.lessonMinutes===240)return '4시간 강습의 중간 휴식을 확인해 주세요.';
  if(draft.paymentReviewId&&draft.paymentReviewedRentalFee!==null&&draft.paymentReviewedRentalFee!==undefined&&!draft.rentalPaymentStatus)return '입금 검토에 장비금액이 있습니다. 장비렌탈 결제상태와 이용시간을 확인해 주세요.';

  if(draft.lessonPassId){
    const pass=(context.lessonPasses||[]).find(item=>item.id===draft.lessonPassId);
    if(!pass)return '연결된 수강권 정보를 다시 확인해 주세요.';
    if(pass.status&&pass.status!=='active')return '사용 가능한 수강권을 선택해 주세요.';
    const existing=(context.reservations||[]).some(row=>row.id===draft.id&&passIdOf(row)===pass.id);
    if(!existing&&passAvailable(pass,context)<=0)return '수강권의 미예약 잔여 횟수가 없습니다.';
    if(!existing&&!bookingMatchesPass(draft,pass,context))return '수강권의 고객·팀·종목과 연락처를 확인해 주세요.';
    const evaluation=candidateResult(draft,context);
    const selected=evaluation.candidates?.find(item=>item.instructorId===evaluation.requiredInstructorId);
    const codes=selected?.reasonCodes||[];
    if(codes.includes('PASS_INSTRUCTOR_CONFLICT'))return '수강권 담당 강사와 지정·시즌 담당 강사가 다릅니다.';
    if(codes.includes('TIME_OFF'))return '수강권 담당 강사의 휴무 신청·승인 날짜입니다.';
    if(codes.includes('OVERLAP'))return '수강권 담당 강사의 다른 강습·지정 예약과 시간이 겹칩니다.';
  }
  if((draft.isReorder||draft.kind==='reorder'||draft.designated)&&!draft.preferredInstructorId)return '지정 강사를 선택해 주세요.';
  if(draft.kind==='season'&&(!Number.isInteger(draft.seasonTotal)||!Number.isInteger(draft.sessionNumber)||draft.seasonTotal<1||draft.seasonTotal>100||draft.sessionNumber<1||draft.sessionNumber>draft.seasonTotal))return '구매 총회차와 등록 일정을 확인해 주세요.';
  if(draft.kind==='season'&&draft.seasonId){const pack=(context.seasonPackages||[]).find(item=>item.id===draft.seasonId);if(pack&&(pack.customer_team_key||pack.customerTeamKey)&&!matchesSeasonKey(draft,pack))return '연결된 시즌 강습의 고객·전화번호·팀·종목이 다릅니다. 같은 팀의 묶음을 선택해 주세요.';if(pack&&!pack.customer_team_key&&!pack.customerTeamKey&&original&&Object.keys(seasonCustomerKey(original)).some(key=>String(seasonCustomerKey(original)[key]??'')!==String(seasonCustomerKey(draft)[key]??'')))return '연결된 시즌 강습의 고객·팀 정보를 확인한 뒤 묶음을 선택해 주세요.';}
  try{bookingFinancialSummary(draft);}catch(issue){return issue.message;}
  if(draft.instructorIds.length){const evaluation=candidateResult(draft,context);const allowed=new Set((evaluation.candidates||[]).filter(person=>person.eligible).map(person=>person.instructorId||person.id));if(evaluation.needsReview)return '배정 전에 나이·경험·종목별 기술 응답과 강사 조건을 확인해 주세요.';if(draft.instructorIds.some(id=>!allowed.has(id)))return '선택한 강사의 일정·휴무·배정 조건이 맞지 않습니다. 강사 배정에서 다시 확인해 주세요.';if(evaluation.requiredInstructorId&&!draft.instructorIds.includes(evaluation.requiredInstructorId))return '지정된 담당 강사를 배정에 포함해 주세요.';}
  return null;
}

function bookingPayload(draft,context) {
  const payload=prepareCustomerIdentity(draft);
  for(const key of ['commonGroupId','suggestion','rentalCustomAmount','patchEnabled','sameCustomerNewTeam','historyInstructorSelection','copyTeamConditions','copiedTeamConditions','datePickerOpen','datePickerMonth','repeatDatesOpen','repeatStart','repeatWeeks','repeatCount','savedBatchRows','dateBatch','participantPersonIds','pendingPeople','passIssueMode','passTotalSessions','passIssueDone','passConfigs','autoTeamNameFromPeople','peopleRosterOpen','commonGroupBatchId'])delete payload[key];
  // 횟수(J) 입력 폐지(2026-11-15) — 비어 있으면 회차 수로 자동 확정.
  // 검토 분석이 제안한 횟수(raw.J)는 보존한다(검토 화면 lessonCount와 공유 필드).
  if(!String(payload.raw?.J||'').trim())payload.raw={...payload.raw,J:String(bookingDateRows(payload).length)+'회'};
  // 성인·미성년 미확인(2026-11-16 선택화): 서버는 ''를 거부하고 NULL(레거시 미확인)만 허용 —
  // 하나라도 미확인이면 participants 전체를 미확인(null)으로 저장한다.
  if(Array.isArray(payload.participants)&&payload.participants.some(person=>!['adult','minor'].includes(person?.type)))payload.participants=null;
  payload.raw=applyFinancialV3(payload);payload.financialVersion=FINANCIAL_VERSION;
  if(payload.paymentRequestCorrection)payload.paymentRequestCorrection={...payload.paymentRequestCorrection,reason:String(payload.paymentRequestCorrection.reason).trim()};
  if(payload.paymentReviewId)payload.paymentAllocationAmount=bookingFinancialSummary(payload).paid;
  payload.instructorIds=unique(payload.instructorIds);
  payload.raw.F=payload.instructorIds.length?payload.instructorIds.map(id=>instructorName(id,context)).join(' · '):payload.raw.F;
  payload.status=payload.instructorIds.length?'confirmed':'received';
  return payload;
}

/** All mutations are passed to authenticated parent callbacks; demo writes remain in memory. */
export {validationError as validateBookingIntake};

export function bindBookingPage(root,{state={},ui={},onChange,onSave,onSaveBatch,onChangeReservation,onLoadPaymentRequestCorrections,onDeleteReservation,onAssign,onOpenLesson,onSaveCapabilities,onSavePolicy,onCandidates,onAutoAssign,onIssuePass,onCreatePass,onSaveCustomerPerson,onDeleteCustomerPerson,onBulkAmounts,now=new Date()}={}) {
  bookingRailObservers.get(root)?.disconnect();bookingRailObservers.delete(root);
  const role=state.profile?.role||ui.role;if(!['admin','counselor'].includes(role))return;
  const view=root.querySelector('.booking-page');if(!view)return;
  const settings=bookingState(state,ui,now),context=contextFor(state,settings,now),escape=fallbackEscape;
  const update=changes=>{Object.assign(settings,ui.booking||{},changes,{candidateRequestToken:null});ui.booking=settings;if(onChange)onChange(settings);else{view.outerHTML=renderBookingPage({state,ui,now});bindBookingPage(root,{state,ui,onSave,onSaveBatch,onChangeReservation,onLoadPaymentRequestCorrections,onDeleteReservation,onAssign,onOpenLesson,onSaveCapabilities,onSavePolicy,onCandidates,onAutoAssign,now});}};
  const busy=()=>settings.deckSaving||settings.reviewSaving||settings.deleteSaving||!!settings.deleteRequest||draftDeckSummary(settings.teamDeck).busy;
  const preserveDraft=()=>{const form=view.querySelector('.bk-reservation-form');if(settings.draft&&!busy())settings.teamDeck=ensureDraftDeck(settings.teamDeck,settings.draft,{tab:settings.tab});if(form&&settings.draft&&!busy())settings.draft=draftFromForm(form,settings.draft);if(settings.draft&&!busy()){settings.teamDeck=ensureDraftDeck(settings.teamDeck,settings.draft,{tab:settings.tab});settings.teamDeck=preserveActiveDraft(settings.teamDeck,settings.draft,settings.tab);settings.teamDeck=syncCommonCustomerDrafts(settings.teamDeck,settings.draft);settings.draft=clone(activeDraftCard(settings.teamDeck).draft);settings.deckMode??=settings.demo?'demo':'operational';if(ui.booking){ui.booking.teamDeck=settings.teamDeck;ui.booking.draft=settings.draft;}}syncIndicators();};
  const filterCardList=()=>{
    const query=String(settings.cardListQuery||'').normalize('NFKC').toLocaleLowerCase('ko-KR').trim(),digits=query.replace(/[^0-9]/gu,'');let count=0;
    view.querySelectorAll('[data-bk-list-card]').forEach(row=>{const card=settings.teamDeck?.cards?.find(item=>item.key===row.dataset.bkListCard),search=card?describeBookingCard(card).search:'',visible=!!card&&(!query||search.includes(query)||digits.length>=4&&search.replace(/\D/gu,'').includes(digits));row.hidden=!visible;if(visible)count++;});
    const countNode=view.querySelector('[data-bk-card-search-count]');if(countNode)countNode.textContent=`${count} / ${settings.teamDeck?.cards?.length||0}개`;
    const empty=view.querySelector('[data-bk-card-search-empty]');if(empty)empty.hidden=count>0;
  };
  const syncIndicators=()=>{
    const deck=settings.teamDeck,active=activeDraftCard(deck);if(!active)return;
    view.querySelectorAll('[data-bk-card-key]').forEach(button=>{const card=deck.cards.find(item=>item.key===button.dataset.bkCardKey);if(card){button.dataset.bkCardStatus=card.status;const label=renderCardLabel(card,settings,escape,{fullPhone:!!button.closest?.('.bk-all-card')});if(button._bkLabelMarkup!==label&&button.innerHTML!==label)button.innerHTML=label;button._bkLabelMarkup=label;button.setAttribute?.('aria-label',`${describeBookingCard(card).label} 열기`);}});
    view.querySelectorAll('[data-bk-close-card]').forEach(button=>{const card=deck.cards.find(item=>item.key===button.dataset.bkCloseCard);if(card)button.setAttribute?.('aria-label',`${describeBookingCard(card).label} 카드 닫기`);});
    view.querySelectorAll('[data-bk-team-column]').forEach(node=>{const card=deck.cards.find(item=>item.key===node.dataset.bkTeamColumn);if(!card)return;const title=node.querySelector('[data-bk-board-team-name]');if(title)title.textContent=card.draft.raw.I||'기본팀';const preview=node.querySelector('.bk-team-preview');if(preview){const markup=renderTeamPreview(card.draft,context,escape);if(preview.outerHTML!==markup)preview.outerHTML=markup;}});
    const details=describeBookingCard(active);for(const [selector,value]of [['[data-bk-active-customer]',details.customer],['[data-bk-active-team]',details.team],['[data-bk-active-summary]',`${details.when}${details.contact?` · ${details.contact}`:''}`]]){const node=view.querySelector(selector);if(node)node.textContent=value;}
    const drawer=view.querySelector('[data-bk-active-card]');if(drawer)drawer.dataset.bkCardStatus=active.status;
    const scope=view.querySelector('[data-bk-save-scope]');if(scope){scope.textContent=bookingSaveScope(settings);scope.title=scope.textContent;}
    const submit=view.querySelector('.bk-reservation-form button[type="submit"]');if(submit)submit.disabled=!!busy()||active.status==='saved';filterCardList();
  };
  const updatePreservingScroll=changes=>{const scroll=view.querySelector('.bk-drawer-body')?.scrollTop||0,left=view.querySelector('[data-bk-team-board]')?.scrollLeft||0,sessionLeft=view.querySelector('[data-bk-session-list]')?.scrollLeft||0;update(changes);const body=root.querySelector('.bk-drawer-body'),board=root.querySelector('[data-bk-team-board]'),sessions=root.querySelector('[data-bk-session-list]');if(body)body.scrollTop=scroll;if(board)board.scrollLeft=left;if(sessions)sessions.scrollLeft=sessionLeft;};
  const cancelCardClose=()=>{if(busy())return;const key=settings.closeCardKey;updatePreservingScroll({closeCardKey:null,focusCardCloseKey:key});};
  const fold=()=>{if(busy()||!closeBookingDrafts(ui))return;update({...ui.booking});};

  const open=draft=>{if(busy())return;preserveDraft();openBookingDraft(ui,draft,{tab:'intake'});update({...ui.booking});};
  const savedSnapshot=(key,payload,result)=>{
    if(!settings.demo)assertPaymentCorrectionResult(payload,result);
    const snapshot={commonGroupId:ui.booking.teamDeck.cards.find(card=>card.key===key)?.draft?.commonGroupId,...(result?.reservation||{...payload,...(result||{}),id:result?.id||payload.id,expectedUpdatedAt:result?.updatedAt||result?.updated_at||payload.expectedUpdatedAt}),customerDraft:null,teamDraft:null,dateBatch:null,datePickerOpen:false,repeatDatesOpen:false,sameCustomerNewTeam:false,copiedTeamConditions:false,...(result?.reservations?.length>1?{savedBatchRows:result.reservations.map(row=>normalizeBookingRow(row,context))}:{})};
    delete snapshot.paymentRequestCorrection;return snapshot;
  };
  const clearSavedIntent=(deck,key)=>{
    const card=deck.cards.find(row=>row.key===key);if(!card)return;
    // A confirmed reservation uses ordinary edit APIs after this one-time bank
    // allocation. Merging a server snapshot must not retain the intake route.
    for(const target of [card.draft,card.baseline])for(const field of ['paymentRequestCorrection','paymentReviewId','paymentReviewVersion','paymentDepositId','paymentCommitRequestId','paymentAllocationAmount','paymentNeedsBreakConfirmation','paymentReviewedRentalFee'])delete target[field];
  };
  // 첫 저장으로 고객 ID가 생기면 작성 중 담아 둔 개인 명부를 서버에 등록한다(2026-11-15).
  const flushPendingPeople=(deck,key,customerId)=>{
    if(typeof onSaveCustomerPerson!=='function'||!customerId)return;
    const card=deck?.cards?.find(row=>row.key===key),pending=card?.draft?.pendingPeople;
    if(!Array.isArray(pending)||!pending.length)return;
    const rows=pending.map(person=>({id:person.id,customerId,name:person.name,personType:person.person_type==='minor'?'minor':'adult',...(Number.isInteger(person.age)?{age:person.age}:{}),...(Number.isInteger(person.experience_count)?{experienceCount:person.experience_count}:{})}));
    for(const target of [card.draft,card.baseline])if(target){delete target.pendingPeople;if(!target.customerId)target.customerId=customerId;}
    (async()=>{
      for(const row of rows){
        try{
          const result=await onSaveCustomerPerson(row);
          state.customerPeople=[...(state.customerPeople||[]),result?.person||{id:row.id,customer_id:customerId,name:row.name,person_type:row.personType,age:row.age??null,experience_count:row.experienceCount??null}];
        }catch{}
      }
      if(ui.booking)update({});
    })();
  };
  const finishSaved=(key,payload,result,requestToken)=>{
    if(result?.discarded||ui.booking?.deckWriteToken!==requestToken||!ui.booking?.teamDeck?.cards?.some(card=>card.key===key))return;
    const deck=markDraftCardSaved(ui.booking.teamDeck,key,{...result,reservation:savedSnapshot(key,payload,result)});
    clearSavedIntent(deck,key);
    flushPendingPeople(deck,key,result?.reservation?.customer_id||result?.reservations?.[0]?.customer_id||'');
    const active=activeDraftCard(deck);update({teamDeck:deck,draft:clone(active.draft),drawer:'reservation',review:null,reviewSaving:false,deckSaving:false,tab:active.tab});
  };
  const finishPaymentGroup=(group,result,requestToken)=>{
    if(result?.discarded||ui.booking?.deckWriteToken!==requestToken)return;
    const rows=result?.reservations;
    if(!Array.isArray(rows)||rows.length!==group.payloads.length||new Set(rows.map(row=>row.id)).size!==group.payloads.length||rows.some(row=>!group.payloads.some(payload=>payload.id===row.id)))throw new Error('전체 팀의 저장 결과를 확인하지 못했습니다. 같은 카드에서 다시 저장해 주세요.');
    if(!settings.demo)for(const payload of group.payloads)assertPaymentCorrectionResult(payload,rows.find(row=>row.id===payload.id));
    // Validate the entire receipt before marking any one card saved.
    let deck=ui.booking.teamDeck;
    for(const entry of group.entries){
      const reservations=entry.payloads.map(payload=>rows.find(row=>row.id===payload.id)),saved={...result,reservations,reservation:reservations[0]};
      deck=markDraftCardSaved(deck,entry.key,{...saved,reservation:savedSnapshot(entry.key,entry.payloads[0],saved)});clearSavedIntent(deck,entry.key);
      flushPendingPeople(deck,entry.key,reservations[0]?.customer_id||'');
    }
    const active=activeDraftCard(deck);update({teamDeck:deck,draft:clone(active.draft),drawer:'reservation',review:null,reviewSaving:false,deckSaving:false,tab:active.tab,deckNotice:`${group.entries.length}팀 · ${rows.length}회 예약을 모두 저장했습니다.`});
    root.querySelector('[data-bk-deck-summary],[data-bk-existing-draft-notice]')?.scrollIntoView?.({block:'nearest'});
  };
  const showError=(form,message)=>{const box=form.querySelector('.bk-form-error');if(box){box.textContent=message;box.hidden=false;box.scrollIntoView({block:'nearest'});}const invalid=form.querySelector(':invalid');if(invalid){const details=invalid.closest?.('details');if(details)details.open=true;invalid.scrollIntoView?.({block:'center'});invalid.focus?.({preventScroll:true});}};
  const run=async(form,work,groupKeys=[])=>{
    const review=form===view.querySelector('.bk-change-review-form');
    const reservation=review||form===view.querySelector('.bk-reservation-form'),key=activeDraftCard(settings.teamDeck)?.key;
    const requestToken=reservation?`write-${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`:null;
    const ownsCurrentUI=()=>!reservation||ui.booking?.deckWriteToken===requestToken&&ui.booking?.teamDeck?.cards?.some(card=>card.key===key);
    if(form.dataset.busy||reservation&&busy())return;
    form.dataset.busy='1';if(review)settings.reviewSaving=true;
    if(reservation){settings.deckSaving=true;settings.deckWriteToken=requestToken;settings.teamDeck=markDraftCardSaving(settings.teamDeck,key);if(ui.booking){ui.booking.deckSaving=true;ui.booking.deckWriteToken=requestToken;ui.booking.teamDeck=settings.teamDeck;}}
    if(reservation&&groupKeys.length){settings.teamDeck=clone(settings.teamDeck);for(const card of settings.teamDeck.cards)if(groupKeys.includes(card.key)){card.saveState='saving';card.error=null;}ui.booking.teamDeck=settings.teamDeck;}
    const buttons=[...new Set([...form.querySelectorAll(reservation?'button':'button[type="submit"]'),...(reservation?view.querySelectorAll('[data-bk-change-cancel],[data-bk-close],[data-bk-card-key],[data-bk-card-prev],[data-bk-card-next],[data-bk-add-team],[data-bk-discard],[data-bk-close-card],[data-bk-all-cards-toggle],[data-bk-close-saved],[data-bk-card-close-cancel],[data-bk-card-close-confirm]'):[])])];
    const buttonStates=buttons.map(button=>({button,disabled:button.disabled}));
    buttons.forEach(button=>button.disabled=true);
    const inputs=reservation?[...new Set([...form.querySelectorAll('input,select,textarea'),...view.querySelectorAll('[data-bk-card-search]')])].map(input=>({input,disabled:input.disabled})):[];inputs.forEach(({input})=>input.disabled=true);
    const progress=form.querySelector('[data-bk-review-saving],[data-bk-deck-saving]');if(progress)progress.hidden=false;
    try{await work(key,requestToken);}
    catch(error){if(!ownsCurrentUI())return;if(reservation){settings.teamDeck=ui.booking.teamDeck;for(const cardKey of groupKeys.length?groupKeys:[key])settings.teamDeck=markDraftCardFailed(settings.teamDeck,cardKey,error);ui.booking.teamDeck=settings.teamDeck;}const current=review?(root.querySelector('.booking-page')||view).querySelector('.bk-change-review-form')||form:form;showError(current,error.message||'저장하지 못했습니다. 다시 시도해 주세요.');}
    finally{
      if(ownsCurrentUI()||form.isConnected===false){delete form.dataset.busy;buttonStates.forEach(({button,disabled})=>button.disabled=disabled);inputs.forEach(({input,disabled})=>input.disabled=disabled);if(progress)progress.hidden=true;}
      if(ownsCurrentUI()){
        if(reservation){settings.deckSaving=false;settings.deckWriteToken=null;if(ui.booking){ui.booking.deckSaving=false;ui.booking.deckWriteToken=null;}}
        if(review){settings.reviewSaving=false;if(ui.booking)ui.booking.reviewSaving=false;const currentView=root.querySelector('.booking-page')||view,current=currentView.querySelector('.bk-change-review-form');if(current){delete current.dataset.busy;current.querySelectorAll('button').forEach(button=>button.disabled=false);const status=current.querySelector('[data-bk-review-saving]');if(status)status.hidden=true;}currentView.querySelectorAll('[data-bk-change-cancel]').forEach(button=>button.disabled=false);}
      }
    }
  };

  const savePaymentGroup=form=>{
    if(paymentBookingGroupCards(settings).length<2)return false;
    let group;
    try{group=preparePaymentBookingGroup(settings,context);}catch(error){showError(form,error.message||'함께 저장할 팀·회차를 확인해 주세요.');return true;}
    const deck=clone(settings.teamDeck);
    for(const entry of group.entries){const card=deck.cards.find(row=>row.key===entry.key);card.draft=clone(entry.draft);}
    settings.teamDeck=deck;settings.draft=clone(activeDraftCard(deck).draft);ui.booking.teamDeck=deck;ui.booking.draft=settings.draft;
    if(group.errors.length){
      const first=group.errors[0],card=deck.cards.find(row=>row.key===first.cardKey),team=card?.draft?.raw?.I||'기본팀';
      const message=`${team} · ${first.index+1}회: ${group.errors.filter(error=>error.cardKey===first.cardKey&&error.rowId===first.rowId).map(error=>error.message).join('\n')}`;
      const failed=selectDraftCard(markDraftCardFailed(deck,first.cardKey,new Error(message)),first.cardKey),active=activeDraftCard(failed);
      update({teamDeck:failed,draft:clone(active.draft),drawer:'reservation',tab:active.tab,deckNotice:'입력 내용을 확인한 뒤 모든 팀을 함께 저장해 주세요.'});
      const current=root.querySelector('.bk-reservation-form');if(current){showError(current,message);const row=[...current.querySelectorAll('[data-bk-date-row]')].find(node=>node.dataset.bkDateRow===first.rowId);row?.classList.add('has-error');row?.scrollIntoView?.({block:'nearest'});}
      return true;
    }
    run(form,async(_key,requestToken)=>{
      if(typeof onSaveBatch!=='function')throw new Error('여러 팀의 예약 저장 연결을 확인해 주세요.');
      const result=await onSaveBatch(group.payloads,group.requestId);finishPaymentGroup(group,result,requestToken);
    },group.entries.map(entry=>entry.key));
    return true;
  };

  const cancelDelete=()=>{if(settings.deleteSaving)return;updatePreservingScroll({deleteRequest:null,deleteSaving:false,focusDeleteButton:true});};
  view.querySelector('[data-bk-delete-reservation]')?.addEventListener('click',()=>{
    if(busy())return;preserveDraft();const card=activeDraftCard(settings.teamDeck),original=context.reservations.find(row=>row.id===card?.serverId);
    if(!card?.serverId||!original||isCancelled(original))return;
    const snapshot=card.baseline?.id===card.serverId?card.baseline:original;
    updatePreservingScroll({deleteRequest:{reservationId:card.serverId,expectedUpdatedAt:snapshot.expectedUpdatedAt||snapshot.updated_at||snapshot.updatedAt||null,requestId:crypto.randomUUID(),cardKey:card.key,snapshot:clone(snapshot),edited:card.status==='edited',reason:'',error:'',submitted:false},deleteSaving:false,closeCardKey:null,discardPrompt:false});
  });
  view.querySelector('[data-bk-delete-cancel]')?.addEventListener('click',cancelDelete);
  const deleteForm=view.querySelector('.bk-delete-form');
  deleteForm?.addEventListener('input',event=>{if(event.target.name==='deleteReason'&&!settings.deleteSaving&&!settings.deleteRequest?.submitted){settings.deleteRequest.reason=event.target.value;if(ui.booking?.deleteRequest)ui.booking.deleteRequest.reason=event.target.value;}});
  deleteForm?.addEventListener('submit',async event=>{
    event.preventDefault();if(settings.deleteSaving||!settings.deleteRequest)return;
    const request=settings.deleteRequest;
    if(!request.submitted)request.reason=String(deleteForm.elements.namedItem('deleteReason')?.value||'').trim();
    request.submitted=true;request.error='';updatePreservingScroll({deleteSaving:true,deleteRequest:request});
    try{
      if(typeof onDeleteReservation!=='function')throw new Error('예약 삭제 연결을 확인해 주세요.');
      const result=await onDeleteReservation({reservationId:request.reservationId,expectedUpdatedAt:request.expectedUpdatedAt,requestId:request.requestId,reason:request.reason});
      if(result?.discarded||ui.booking?.deleteRequest?.requestId!==request.requestId)return;
      const completed=completeReservationDeletion(ui,request,result);if(completed.discarded)return;
      state=applyReservationCancellation(state,request.reservationId,result);update({...ui.booking});
    }catch(error){if(ui.booking?.deleteRequest?.requestId===request.requestId)updatePreservingScroll({deleteSaving:false,deleteRequest:{...request,error:error.message||'예약을 삭제하지 못했습니다. 다시 시도해 주세요.'}});}
  });
  view.querySelector('.bk-filter-form')?.addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);update({date:String(form.get('date')||''),company:String(form.get('company')||'all'),sport:String(form.get('sport')||'all'),kind:String(form.get('kind')||'all'),query:String(form.get('query')||'').trim(),limit:150});});
  view.querySelector('[data-bk-reset]')?.addEventListener('click',()=>update({date:'',company:'all',sport:'all',kind:'all',assignment:'all',query:'',limit:150,sortKey:null,sortDir:null,colFilters:{},filterOpenKey:null}));
  view.querySelectorAll('th[data-bk-sort]').forEach(th=>th.addEventListener('click',event=>{
    if(event.target.closest?.('[data-bk-colfilter]'))return;
    const key=th.dataset.bkSort;
    const dir=settings.sortKey===key?(settings.sortDir==='asc'?'desc':settings.sortDir==='desc'?null:'asc'):'asc';
    update(dir?{sortKey:key,sortDir:dir}:{sortKey:null,sortDir:null});
  }));
  // 엑셀식 열 필터 (#12 보완): 머리글 ▾ → 값 체크리스트.
  view.querySelectorAll('[data-bk-colfilter]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    const key=button.dataset.bkColfilter;
    update({filterOpenKey:settings.filterOpenKey===key?null:key});
  }));
  view.querySelector('[data-bk-filters-clear]')?.addEventListener('click',()=>update({colFilters:{},filterOpenKey:null}));
  {
    const pop=view.querySelector('[data-bk-filter-pop]');
    if(pop){
      const key=settings.filterOpenKey;
      const info=filterPopoverValues(settings,selectBookingRows(context,settings),context,key);
      const closeFilter=()=>update({filterOpenKey:null});
      pop.querySelectorAll('[data-bk-filter-close]').forEach(button=>button.addEventListener('click',closeFilter));
      pop.querySelector('[data-bk-filter-search]')?.addEventListener('input',event=>{
        const query=String(event.target.value||'').toLocaleLowerCase('ko-KR');
        pop.querySelectorAll('[data-bk-filter-row]').forEach(row=>{row.hidden=!!query&&!row.textContent.toLocaleLowerCase('ko-KR').includes(query);});
      });
      const applySelection=set=>{
        const next={...(settings.colFilters||{})};
        if(info&&set.size>=info.values.length)delete next[key];else next[key]=[...set];
        update({colFilters:next});
      };
      pop.querySelectorAll('[data-bk-filter-value]').forEach(box=>box.addEventListener('change',()=>{
        const current=Array.isArray(settings.colFilters?.[key])?new Set(settings.colFilters[key].map(String)):new Set(info?info.values:[]);
        if(box.checked)current.add(box.dataset.bkFilterValue);else current.delete(box.dataset.bkFilterValue);
        applySelection(current);
      }));
      pop.querySelector('[data-bk-filter-all]')?.addEventListener('click',()=>{const next={...(settings.colFilters||{})};delete next[key];update({colFilters:next});});
      pop.querySelector('[data-bk-filter-none]')?.addEventListener('click',()=>applySelection(new Set()));
      pop.querySelector('[data-bk-filter-clear]')?.addEventListener('click',()=>{const next={...(settings.colFilters||{})};delete next[key];update({colFilters:next,filterOpenKey:null});});
    }
  }
  // 그룹 수정(2026-11-17 사용자 확정): 행 선택은 재렌더 없이 유지(가로 스크롤 보존), 적용 때만 갱신.
  const syncBulkToolbar=()=>{
    const count=(settings.bulkIds||[]).length,open=view.querySelector('[data-bk-bulk-open]'),clear=view.querySelector('[data-bk-bulk-clear]');
    if(open){open.hidden=!count;open.textContent=`☑ 선택 ${count}건 그룹 수정`;}
    if(clear)clear.hidden=!count;
    const boxes=[...view.querySelectorAll('[data-bk-bulk-row]')],all=view.querySelector('[data-bk-bulk-all]');
    if(all)all.checked=boxes.length>0&&boxes.every(box=>box.checked);
  };
  const rememberBulk=ids=>{settings.bulkIds=ids;if(ui.booking)ui.booking.bulkIds=ids;syncBulkToolbar();};
  view.querySelectorAll('[data-bk-bulk-row]').forEach(box=>box.addEventListener('change',()=>{
    const ids=new Set(settings.bulkIds||[]);
    if(box.checked)ids.add(box.dataset.bkBulkRow);else ids.delete(box.dataset.bkBulkRow);
    rememberBulk([...ids]);
  }));
  view.querySelector('[data-bk-bulk-all]')?.addEventListener('change',event=>{
    const ids=new Set(settings.bulkIds||[]);
    view.querySelectorAll('[data-bk-bulk-row]').forEach(box=>{box.checked=event.target.checked;if(event.target.checked)ids.add(box.dataset.bkBulkRow);else ids.delete(box.dataset.bkBulkRow);});
    rememberBulk([...ids]);
  });
  view.querySelector('[data-bk-bulk-open]')?.addEventListener('click',()=>update({bulkOpen:true,bulkResult:null}));
  view.querySelector('[data-bk-bulk-clear]')?.addEventListener('click',()=>update({bulkIds:[],bulkOpen:false,bulkResult:null}));
  view.querySelector('[data-bk-bulk-close]')?.addEventListener('click',()=>update({bulkOpen:false}));
  view.querySelector('[data-bk-bulk-apply]')?.addEventListener('click',async event=>{
    if(busy()||!onBulkAmounts)return;
    const ids=[...(settings.bulkIds||[])];if(!ids.length)return;
    const editor=view.querySelector('[data-bk-bulk-editor]');
    const field=name=>editor?.querySelector(`[name=${name}]`);
    const amountValue=name=>{const raw=String(field(name)?.value??'').trim();if(raw==='')return null;const value=Number(raw);return Number.isSafeInteger(value)&&value>=0?value:NaN;};
    const values={rentalStatus:field('bulkRentalStatus')?.value||'keep',rentalHours:field('bulkRentalHours')?.value||'keep',rentalAmount:amountValue('bulkRentalAmount'),paidAmount:amountValue('bulkPaidAmount')};
    if(Number.isNaN(values.rentalAmount)||Number.isNaN(values.paidAmount))return update({bulkResult:{ok:0,failed:[{label:'입력 확인',message:'금액은 0 이상의 정수로 입력해 주세요.'}],failedIds:ids}});
    if(values.rentalStatus==='keep'&&values.rentalHours==='keep'&&values.rentalAmount===null&&values.paidAmount===null)return update({bulkResult:{ok:0,failed:[{label:'입력 확인',message:'변경할 항목을 하나 이상 선택해 주세요.'}],failedIds:ids}});
    event.target.disabled=true;
    try{
      const result=await onBulkAmounts(ids,values);
      if(result?.discarded)return;
      update({bulkResult:result,bulkIds:result?.failedIds||[],bulkOpen:true});
    }catch(error){update({bulkResult:{ok:0,failed:[{label:'적용 실패',message:error?.message||'그룹 수정을 적용하지 못했습니다.'}],failedIds:ids},bulkIds:ids});}
    finally{event.target.disabled=false;}
  });
  view.querySelectorAll('[data-bk-detail]').forEach(button=>button.addEventListener('click',()=>update({detailId:button.dataset.bkDetail})));
  // 표 전체화면(#12 보완): 표 패널을 화면 전체로 펼친다. 행의 예약 변경 창은 그 위에 뜬다.
  view.querySelector('[data-bk-fullscreen]')?.addEventListener('click',()=>update({tableFullscreen:!settings.tableFullscreen}));
  if(settings.tableFullscreen){
    const escClose=event=>{if(event.key==='Escape'&&!settings.drawer&&!settings.detailId){document.removeEventListener?.('keydown',escClose);update({tableFullscreen:false});}};
    document.addEventListener?.('keydown',escClose);
  }
  // 개인 명부 추가폼: 미성년을 고르면 나이 입력이 열린다 (성인은 나이 저장 안 함).
  view.querySelectorAll('[data-bk-person-type]').forEach(select=>select.addEventListener('change',()=>{
    const age=select.closest('[data-bk-people-manager]')?.querySelector('[data-bk-person-age]');
    if(age){age.disabled=select.value!=='minor';if(age.disabled)age.value='';}
  }));
  view.querySelectorAll('[data-bk-detail-close]').forEach(button=>button.addEventListener('click',()=>update({detailId:null})));
  view.querySelector('[data-bk-detail-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget)update({detailId:null});});
  view.querySelector('[data-bk-demo]')?.addEventListener('click',()=>{if(busy())return;preserveDraft();if(hasUnsavedTeamDrafts(settings.teamDeck)){update({deckNotice:'작성 중인 카드를 저장하거나 닫은 뒤 전환해 주세요.'});return;}update({demo:!settings.demo,date:'',company:'all',sport:'all',kind:'all',assignment:'all',query:'',drawer:null,draft:null,teamDeck:null,deckMode:null,review:null,deckNotice:null});});
  view.querySelector('[data-bk-settings]')?.addEventListener('click',()=>{if(role!=='admin'||busy())return;if(!closeBookingDrafts(ui))return;update({...ui.booking,drawer:'settings',draft:null});});
  view.querySelector('[data-bk-new]')?.addEventListener('click',()=>open(newDraft(context,now)));
  view.querySelectorAll('[data-bk-assignment]').forEach(button=>button.addEventListener('click',()=>update({assignment:button.dataset.bkAssignment,limit:150})));
  view.querySelector('[data-bk-more]')?.addEventListener('click',()=>update({limit:settings.limit+150}));
  view.querySelectorAll('[data-bk-open]').forEach(button=>button.addEventListener('click',()=>{const row=context.reservations.find(item=>item.id===button.dataset.bkOpen);if(row)open(clone(row));}));
  view.querySelectorAll('[data-bk-detail-open]').forEach(button=>button.addEventListener('click',()=>{settings.detailId=null;if(ui.booking)ui.booking.detailId=null;const row=context.reservations.find(item=>item.id===button.dataset.bkDetailOpen);if(row)open(clone(row));}));
  view.querySelectorAll('[data-bk-add-team]').forEach(button=>button.addEventListener('click',()=>{
    if(busy())return;
    const current=button.dataset.bkNewTeam!==undefined;if(current)preserveDraft();
    const source=current?settings.draft:context.reservations.find(row=>row.id===button.dataset.bkAddTeam);
    if(source){
      const child=createSameCustomerTeamDraft(source,context,now,{copyConditions:current&&source.copyTeamConditions===true});
      if(current){if(source.commonGroupId)child.commonGroupId=source.commonGroupId;settings.draft={...source,commonGroupId:child.commonGroupId};settings.teamDeck=preserveActiveDraft(settings.teamDeck,settings.draft,settings.tab);if(ui.booking){ui.booking.draft=settings.draft;ui.booking.teamDeck=settings.teamDeck;}}
      open(child);
    }
  }));
  view.querySelectorAll('[data-bk-open-saved-date]').forEach(button=>button.addEventListener('click',()=>{if(busy())return;const row=context.reservations.find(item=>item.id===button.dataset.bkOpenSavedDate);if(row)open(clone(row));else onOpenLesson?.(button.dataset.bkOpenSavedDate);}));
  view.querySelectorAll('[data-bk-correction-history]').forEach(button=>button.addEventListener('click',async()=>{
    if(busy())return;preserveDraft();const id=button.dataset.bkCorrectionHistory,token=crypto.randomUUID();
    const set=value=>updatePreservingScroll({paymentCorrectionHistories:{...(ui.booking?.paymentCorrectionHistories||{}),[id]:value}});
    set({...settings.paymentCorrectionHistories?.[id],loading:true,error:'',token});
    try{
      if(settings.demo)throw new Error('체험 예약에는 실제 정정·발송 기록이 없습니다.');
      if(typeof onLoadPaymentRequestCorrections!=='function')throw new Error('정정 기록 조회 연결을 확인해 주세요.');
      const result=await onLoadPaymentRequestCorrections(id);if(ui.booking?.paymentCorrectionHistories?.[id]?.token!==token)return;
      set({...result,loading:false,error:'',loadedAt:new Date().toISOString(),token});
    }catch(error){if(ui.booking?.paymentCorrectionHistories?.[id]?.token===token)set({loading:false,error:error.message||'정정 기록을 불러오지 못했습니다. 다시 조회해 주세요.',token});}
  }));
  view.querySelectorAll('[data-bk-auto]').forEach(button=>button.addEventListener('click',()=>onAutoAssign?.(button.dataset.bkAuto)));
  view.querySelector('[data-bk-autoassign-top]')?.addEventListener('click',()=>{if(!busy())onAutoAssign?.();});
  view.querySelectorAll('[data-bk-close]').forEach(button=>button.addEventListener('click',fold));
  view.querySelector('[data-bk-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget)fold();});
  view.querySelectorAll('[data-bk-tab]').forEach(button=>button.addEventListener('click',()=>{if(busy())return;preserveDraft();settings.teamDeck=preserveActiveDraft(settings.teamDeck,settings.draft,button.dataset.bkTab);update({tab:button.dataset.bkTab,teamDeck:settings.teamDeck});const target=root.querySelector(`[data-bk-pane="${button.dataset.bkTab}"]`);const details=target?.closest?.('details');if(details)details.open=true;target?.scrollIntoView?.({block:'start',behavior:'smooth'});}));
  const selectCard=key=>{if(busy()||settings.drawer==='review'||settings.closeCardKey)return;preserveDraft();const deck=selectDraftCard(settings.teamDeck,key,{currentDraft:settings.draft,currentTab:settings.tab}),active=activeDraftCard(deck);if(active){updatePreservingScroll({teamDeck:deck,draft:clone(active.draft),tab:active.tab,drawer:'reservation',review:null,deckMotion:null,discardPrompt:false,closeCardKey:null,cardListOpen:false,focusNewTeam:false});keepActiveTeamVisible(root);}};
  view.querySelectorAll('[data-bk-card-key]').forEach(button=>button.addEventListener('click',()=>selectCard(button.dataset.bkCardKey)));
  view.querySelectorAll('[data-bk-board-select]').forEach(button=>button.addEventListener('click',()=>selectCard(button.dataset.bkBoardSelect)));
  for(const [selector,direction]of [['[data-bk-card-prev]',-1],['[data-bk-card-next]',1]])view.querySelector(selector)?.addEventListener('click',()=>{const cards=settings.teamDeck?.cards||[],index=cards.findIndex(card=>card.key===settings.teamDeck.activeKey),target=cards[index+direction];if(target)selectCard(target.key);});
  view.querySelector('[data-bk-all-cards-toggle]')?.addEventListener('click',()=>{if(busy()||settings.drawer==='review'||settings.closeCardKey)return;preserveDraft();updatePreservingScroll({cardListOpen:!settings.cardListOpen,focusCardSearch:!settings.cardListOpen,discardPrompt:false});});
  view.querySelector('[data-bk-card-search]')?.addEventListener('input',event=>{if(busy()||settings.drawer==='review'||settings.closeCardKey)return;settings.cardListQuery=event.target.value;if(ui.booking)ui.booking.cardListQuery=settings.cardListQuery;filterCardList();});
  view.querySelectorAll('[data-bk-close-card]').forEach(button=>button.addEventListener('click',()=>{
    if(busy()||settings.drawer==='review'||settings.closeCardKey)return;preserveDraft();const key=button.dataset.bkCloseCard;
    const result=closeBookingDraftCard(ui,key);if(result.blocked||result.missing)return;
    updatePreservingScroll({...ui.booking,focusCardCloseKey:null});
  }));
  view.querySelector('[data-bk-card-close-cancel]')?.addEventListener('click',cancelCardClose);
  view.querySelector('[data-bk-card-close-confirm]')?.addEventListener('click',()=>{
    if(busy()||settings.drawer==='review')return;const key=settings.closeCardKey;if(!key)return;
    const result=closeBookingDraftCard(ui,key,{discard:true});if(result.closed)updatePreservingScroll({...ui.booking,focusCardCloseKey:null});
  });
  view.querySelector('[data-bk-close-saved]')?.addEventListener('click',()=>{
    if(busy()||settings.drawer==='review'||settings.closeCardKey)return;preserveDraft();
    const keys=(settings.teamDeck?.cards||[]).filter(card=>card.status==='saved'&&card.saveState==='idle').map(card=>card.key);
    for(const key of keys)closeBookingDraftCard(ui,key);
    updatePreservingScroll({...ui.booking,focusCardCloseKey:null});
  });
  view.querySelector('[data-bk-discard]')?.addEventListener('click',()=>{if(busy()||settings.drawer==='review'||settings.closeCardKey)return;preserveDraft();updatePreservingScroll({discardPrompt:true,cardListOpen:true});});
  view.querySelector('[data-bk-discard-cancel]')?.addEventListener('click',()=>{if(!busy())updatePreservingScroll({discardPrompt:false});});
  view.querySelector('[data-bk-discard-confirm]')?.addEventListener('click',()=>{if(!busy()&&settings.drawer!=='review')update({teamDeck:discardDraftDeck(settings.teamDeck),draft:null,drawer:null,review:null,discardPrompt:false,closeCardKey:null,cardListOpen:false,cardListQuery:'',deckNotice:null});});

  const form=view.querySelector('.bk-reservation-form');
  if(form){
    for(const [selector,markup]of [['[data-bk-customer-suggestions]',renderCustomerSuggestions(settings.draft,context,escape)],['[data-bk-directory-selection]',renderDirectorySelection(settings.draft,context,escape)||renderPeopleManager(settings.draft,context,escape)],['[data-bk-team-choices]',renderCustomerTeamChoices(settings.draft,context,escape)],['[data-bk-customer-history]',renderCustomerHistory(settings.draft,context,escape)]]){const node=form.querySelector(selector);if(node?.nodeType===1)node._bkStableMarkup=markup;}
    const refreshCustomer=()=>{preserveDraft();refreshCustomerPanels(form,settings.draft,context,escape);preserveDraft();};
    const invalidateCandidates=()=>{settings.candidateRequestToken=null;if(ui.booking)ui.booking.candidateRequestToken=null;};
    updateGrandTotal(form,settings.teamDeck,context,settings.draft); // 열자마자 고객 전체 합계 표시
    form.addEventListener('input',event=>{
      const session=sessionFinancialTarget(event.target);
      if(session?.rowId){
        invalidateCandidates();const scoped=sessionFinancialForm(form,session.rowId);
        if(['raw_T','raw_U','raw_Y','rentalAmount','paymentCorrectionAmount'].includes(session.name))updateFinancialFields(scoped);updateGrandTotal(form,settings.teamDeck,context,settings.draft);
        preserveDraft();syncIndicators();return;
      }
      if(event.target.name==='raw_M'){preserveDraft();refreshParticipantFields(form,settings.draft,escape);const target=form.querySelector('[data-bk-requirement]');if(target)target.innerHTML=renderRequirement(settings.draft,context,escape);return;}
      if(/^participant_\d+_age$/.test(event.target.name||'')){preserveDraft();const target=form.querySelector('[data-bk-requirement]');if(target)target.innerHTML=renderRequirement(settings.draft,context,escape);return;}
      if(event.target.name==='cashReceiptNumber'){preserveDraft();return;}
      invalidateCandidates();
      if(['raw_T','raw_U','raw_Y','rentalAmount','paymentCorrectionAmount'].includes(event.target.name)){updateFinancialFields(form);updateGrandTotal(form,settings.teamDeck,context,settings.draft);preserveDraft();}
      if(['raw_H','raw_L','raw_I','teamPhone','contactKakaoMode'].includes(event.target.name)){
        if(event.target.name==='contactKakaoMode'){preserveDraft();updateKakaoContactField(form,settings.draft,context);}
        refreshCustomer();
      }
      preserveDraft();
      if(['raw_A','raw_B','raw_C','raw_N'].includes(event.target.name)||String(event.target.name||'').startsWith('date_'))refreshLessonPlanFields(form,settings.draft,escape);
      refreshLearnerFields(form,settings.draft);syncIndicators();
      // 수강권 모드의 X·Z(총액)는 회차 단위 재계산보다 뒤에 덮어써야 한다.
      if(settings.draft.passIssueMode)setTimeout(()=>{if(settings.draft.passIssueMode&&form.isConnected)syncPassFinancial(form);},0);
    });
    form.addEventListener('focusout',event=>{if(['raw_L','teamPhone'].includes(event.target.name)){const before=customerIdentitySignature(settings.draft);if(canonicalTelephone(event.target.value))event.target.value=formatTelephone(event.target.value);preserveDraft();if(before===customerIdentitySignature(settings.draft))refreshPhoneFeedback(form,settings.draft,context);else refreshCustomerPanels(form,settings.draft,context,escape);}});
    const selectDirectoryCustomer=(customerId,teamId=null)=>{
      if(busy()||settings.draft.id&&settings.draft.customerId)return;
      preserveDraft();if(teamId&&settings.draft.customerId===customerId&&settings.draft.customerTeamId===teamId&&!settings.draft.teamDraft)return;
      const selected=customerDirectorySelection(customerId,teamId,context,{activeOnly:true});if(!selected)return;
      const sameCustomer=selected.customerId===settings.draft.customerId&&!settings.draft.customerDraft;
      const currentPhone=customerPhoneOf(settings.draft);
      const exactContact=canonicalTelephone(currentPhone)&&searchCustomerCandidates(currentPhone,{...context,customers:[selected.customer]}).some(match=>match.matchKind==='exact');
      const customerContactPhone=sameCustomer||exactContact?currentPhone:selected.customerContactPhone??selected.raw.L;
      const teamContact=String(selected.team?.phone||'').trim(),phoneKey=value=>canonicalTelephone(value)||String(value||'').trim();
      const teamPhoneMode=teamId&&teamContact&&phoneKey(teamContact)!==phoneKey(customerContactPhone)?'separate':'same';
      const next={...settings.draft,commonGroupId:null,customerId:selected.customerId,customerTeamId:selected.customerTeamId,customerDraft:null,teamDraft:null,raw:{...settings.draft.raw,...selected.raw,L:teamPhoneMode==='separate'?selected.raw.L:customerContactPhone},customerContactPhone,teamPhoneMode,sameCustomerNewTeam:false,lessonPassId:null,seasonId:null,preferredInstructorId:null,instructorIds:[],historyInstructorSelection:null,age:null,ageBand:null,participants:(()=>{const roster=customerPeopleOf(context,selected.customerId);return roster.length?participantsFromPeople(roster,roster.map(person=>String(person.id))):resizeParticipants([],numeric(selected.raw?.M||settings.draft.raw.M));})(),participantPersonIds:undefined,juniorPreparation:false,experienceCount:null,parallelLongTurn:null,snowboardNoviceTurn:null};
      if(Array.isArray(next.participants)&&next.participants.length)next.raw={...next.raw,M:String(next.participants.length)};
      if(teamId){
        const defaults=selected.defaults||{};
        for(const key of ['D','K','M','O'])if(defaults.raw?.[key]!==undefined)next.raw[key]=defaults.raw[key];
        if(defaults.sport)next.raw.D=defaults.sport;
        for(const key of ['age','ageBand','experienceCount','parallelLongTurn','snowboardNoviceTurn'])next[key]=defaults[key]??null;
        next.participants=normalizeParticipants(defaults.participants,numeric(next.raw.M));
        next.juniorPreparation=defaults.juniorPreparation===true;
        const duration=String(defaults.raw?.N||'').trim();
        if(!next.id&&['2시간','4시간'].includes(duration)){
          const currentPlan=lessonPlanSettings(settings.draft);
          next.lessonMinutes=duration==='4시간'?240:120;
          next.breakMinutes=next.lessonMinutes===240&&currentPlan.lessonMinutes===240?currentPlan.breakMinutes:0;
          Object.assign(next,applyLessonPlan(next));
        }
      }
      // 작성 중 담아 둔 개인(pendingPeople)은 링크한 기존 고객의 명부로 즉시 등록한다 — 조용한 유실 금지.
      const pendingToLink=Array.isArray(settings.draft.pendingPeople)?settings.draft.pendingPeople:[];
      delete next.pendingPeople;
      update({draft:prepareCustomerIdentity(next)});
      if(pendingToLink.length&&typeof onSaveCustomerPerson==='function')(async()=>{
        for(const person of pendingToLink){
          try{
            const result=await onSaveCustomerPerson({id:person.id,customerId:selected.customerId,name:person.name,personType:person.person_type==='minor'?'minor':'adult',...(Number.isInteger(person.age)?{age:person.age}:{})});
            state.customerPeople=[...(state.customerPeople||[]),result?.person||{id:person.id,customer_id:selected.customerId,name:person.name,person_type:person.person_type,age:person.age??null}];
          }catch{}
        }
        preserveDraft();
        if(!Array.isArray(settings.draft.participantPersonIds)&&settings.draft.customerId===selected.customerId&&bookingCustomerSaved(settings.draft)){
          const roster=customerPeopleOf(context,selected.customerId);
          const everyone=participantsFromPeople(roster,roster.map(person=>String(person.id)));
          update({draft:{...settings.draft,participants:everyone,raw:{...settings.draft.raw,M:String(everyone.length)}}});
        }else update({});
      })();
    };
    const mutateDates=change=>{if(busy()||settings.draft.id)return;preserveDraft();try{const draft=change(ensureBookingDates(settings.draft));settings.teamDeck=preserveActiveDraft(settings.teamDeck,draft,settings.tab);updatePreservingScroll({draft,teamDeck:settings.teamDeck});}catch(error){showError(form,error.message);}};
    form.addEventListener('click',event=>{
      if(event.target.closest?.('[data-bk-correction-use-fees]')){
        if(busy())return;
        const target=sessionFinancialTarget(event.target),scoped=sessionFinancialForm(form,target?.rowId),control=scoped.elements.namedItem('paymentCorrectionEnabled'),amount=scoped.elements.namedItem('paymentCorrectionAmount'),reason=scoped.elements.namedItem('paymentCorrectionReason');
        try{
          const lesson=scoped.elements.namedItem('raw_T')?.value,rentalStatus=scoped.elements.namedItem('rentalPaymentStatus')?.value||null,rentalAmount=scoped.elements.namedItem('rentalAmount')?.value;
          if(String(lesson??'').trim()===''||!rentalStatus||['paid','onsite_unpaid'].includes(rentalStatus)&&String(rentalAmount??'').trim()==='')throw new Error('강습료·장비요금을 먼저 확인해 주세요.');
          const total=bookingFinancialSummary({raw:{T:lesson,Y:scoped.elements.namedItem('raw_Y')?.value},rentalPaymentStatus:rentalStatus,rentalAmount}).requested;
          if(!control||!amount||!reason)return;
          control.checked=true;amount.value=String(total);if(!reason.value.trim())reason.value='기존 별도 정정 총액을 현재 강습료·장비요금 합계로 변경';
          updateFinancialFields(scoped);preserveDraft();syncIndicators();
        }catch(error){showError(form,error.message);}
        return;
      }
      const selectCustomer=event.target.closest?.('[data-bk-select-customer]');if(selectCustomer){selectDirectoryCustomer(selectCustomer.dataset.bkSelectCustomer);return;}
      const selectTeam=event.target.closest?.('[data-bk-directory-team]');if(selectTeam){selectDirectoryCustomer(settings.draft.customerId,selectTeam.dataset.bkDirectoryTeam);return;}
      const contact=event.target.closest?.('[data-bk-contact-phone]');if(contact){if(busy())return;const input=form.elements.namedItem('raw_L');if(input)input.value=formatTelephone(contact.dataset.bkContactPhone);refreshCustomer();return;}
      // 여자/영어 강사 무관/선호/필수: 특이사항(G) 표준 문구를 바꿔 저장한다.
      const femalePref=event.target.closest?.('[data-bk-female-pref]');if(femalePref){
        if(busy())return;preserveDraft();
        const draft=settings.draft;
        update({draft:{...draft,raw:{...draft.raw,G:applyFemaleInstructorPreference(draft.raw.G,femalePref.dataset.bkFemalePref)}}});return;
      }
      const englishPref=event.target.closest?.('[data-bk-english-pref]');if(englishPref){
        if(busy())return;preserveDraft();
        const draft=settings.draft;
        update({draft:{...draft,raw:{...draft.raw,G:applyEnglishInstructorPreference(draft.raw.G,englishPref.dataset.bkEnglishPref)}}});return;
      }
      const personAll=event.target.closest?.('[data-bk-person-all]');if(personAll){
        if(busy())return;preserveDraft();
        const draft={...settings.draft};delete draft.participantPersonIds;delete draft.autoTeamNameFromPeople;
        const people=bookingRosterPeople(draft,context);
        const everyone=participantsFromPeople(people,people.map(person=>String(person.id)));
        update({draft:{...draft,participants:everyone.length?everyone:draft.participants,raw:{...draft.raw,M:everyone.length?String(everyone.length):draft.raw.M}}});return;
      }
      const personPick=event.target.closest?.('[data-bk-person-pick]');if(personPick){
        if(busy())return;preserveDraft();
        const draft=settings.draft,people=bookingRosterPeople(draft,context);
        // 미조작 상태의 첫 클릭은 '그 사람만 참여'로 시작한다(전원에서 빼는 방식 아님).
        const current=Array.isArray(draft.participantPersonIds)?new Set(draft.participantPersonIds.map(String)):new Set();
        const personId=personPick.dataset.bkPersonPick;
        if(current.has(personId))current.delete(personId);else current.add(personId);
        const ids=people.map(person=>String(person.id)).filter(id=>current.has(id));
        update({draft:applyPeopleSelection(draft,people,ids)});return;
      }
      const personDelete=event.target.closest?.('[data-bk-person-delete]');if(personDelete){
        if(busy())return;
        const pendingId=personDelete.dataset.bkPersonDelete;
        if(!bookingCustomerSaved(settings.draft)&&Array.isArray(settings.draft.pendingPeople)&&settings.draft.pendingPeople.some(person=>String(person.id)===String(pendingId))){
          preserveDraft();const draft=settings.draft;
          const pendingPeople=draft.pendingPeople.filter(person=>String(person.id)!==String(pendingId));
          const ids=Array.isArray(draft.participantPersonIds)?draft.participantPersonIds.filter(id=>String(id)!==String(pendingId)):undefined;
          update({draft:{...draft,pendingPeople,...(ids!==undefined?{participantPersonIds:ids}:{})}});return;
        }
        if(!onDeleteCustomerPerson)return;
        const personId=personDelete.dataset.bkPersonDelete;personDelete.disabled=true;
        Promise.resolve(onDeleteCustomerPerson(personId)).then(()=>{
          state.customerPeople=(state.customerPeople||[]).filter(person=>String(person.id)!==String(personId));
          preserveDraft();update({});
        }).catch(error=>{personDelete.disabled=false;showError(form,error?.message||'명부에서 삭제하지 못했습니다.');});
        return;
      }
      const personAdd=event.target.closest?.('[data-bk-person-add]');if(personAdd){
        if(busy()||!onSaveCustomerPerson)return;
        const scope=personAdd.closest('[data-bk-people-manager]')||form;
        const nameInput=scope.querySelector('[data-bk-person-name]'),typeInput=scope.querySelector('[data-bk-person-type]'),ageInput=scope.querySelector('[data-bk-person-age]'),expInput=scope.querySelector('[data-bk-person-exp]'),feedback=scope.querySelector('[data-bk-person-feedback]');
        const name=String(nameInput?.value||'').trim(),personType=typeInput?.value==='minor'?'minor':'adult';
        const ageText=personType==='minor'?String(ageInput?.value||'').trim():'';
        const expText=String(expInput?.value||'').trim();
        const experience=expText!==''&&Number.isInteger(Number(expText))&&Number(expText)>=0&&Number(expText)<=999?Number(expText):null;
        if(!name){if(feedback)feedback.textContent='이름을 입력해 주세요.';return;}
        const clearInputs=()=>{if(nameInput){nameInput.value='';nameInput.focus?.();}if(ageInput)ageInput.value='';if(expInput)expInput.value='';};
        if(!bookingCustomerSaved(settings.draft)){
          // 고객 저장 전: 로컬 명부에 담아 두고 첫 저장 때 서버에 함께 등록한다.
          preserveDraft();const draft=settings.draft;
          const person={id:globalThis.crypto.randomUUID(),customer_id:'',name,person_type:personType,age:ageText?Number(ageText):null,experience_count:experience};
          const pendingPeople=[...(Array.isArray(draft.pendingPeople)?draft.pendingPeople:[]),person];
          const next={...draft,pendingPeople,peopleRosterOpen:true};
          if(!Array.isArray(draft.participantPersonIds)){
            // 미조작 = 전원 참가 약속은 프리필로 지킨다(선택 칩은 opt-in 표시).
            const everyone=participantsFromPeople(pendingPeople,pendingPeople.map(row=>String(row.id)));
            next.participants=everyone;next.raw={...draft.raw,M:String(everyone.length)};
          }
          clearInputs();
          update({draft:next});return;
        }
        const payload={id:globalThis.crypto.randomUUID(),customerId:settings.draft.customerId,name,personType,...(ageText?{age:Number(ageText)}:{}),...(experience!==null?{experienceCount:experience}:{})};
        personAdd.disabled=true;
        Promise.resolve(onSaveCustomerPerson(payload)).then(result=>{
          const saved={experience_count:experience,...(result?.person||{id:payload.id,customer_id:payload.customerId,name,person_type:personType,age:ageText?Number(ageText):null})};
          state.customerPeople=[...(state.customerPeople||[]),saved];
          preserveDraft();clearInputs();
          const next={...settings.draft,peopleRosterOpen:true};
          if(!Array.isArray(next.participantPersonIds)){
            const roster=customerPeopleOf(context,next.customerId);
            const everyone=participantsFromPeople(roster,roster.map(person=>String(person.id)));
            if(everyone.length){next.participants=everyone;next.raw={...next.raw,M:String(everyone.length)};}
          }
          update({draft:next});
        }).catch(error=>{personAdd.disabled=false;if(feedback)feedback.textContent=error?.message||'명부에 저장하지 못했습니다.';});
        return;
      }
      if(event.target.closest?.('[data-bk-unlink-customer]')){if(busy()||settings.draft.id)return;preserveDraft();const next={...settings.draft,commonGroupId:null,customerId:null,customerTeamId:null,customerDraft:null,teamDraft:null,lessonPassId:null,seasonId:null,preferredInstructorId:null,instructorIds:[],sameCustomerNewTeam:false};update({draft:prepareCustomerIdentity(next)});return;}
      const jump=event.target.closest?.('[data-bk-session-jump]');if(jump){const row=[...form.querySelectorAll('[data-bk-date-row]')].find(item=>item.dataset.bkDateRow===jump.dataset.bkSessionJump);row?.scrollIntoView?.({block:'nearest',inline:'center',behavior:'smooth'});return;}
      if(event.target.closest?.('[data-bk-calendar-done]')){mutateDates(draft=>({...draft,datePickerOpen:false}));root.querySelector('[data-bk-session-list]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});return;}
      if(event.target.closest?.('[data-bk-calendar-toggle]')){mutateDates(draft=>({...draft,datePickerOpen:!draft.datePickerOpen}));return;}
      const datePick=event.target.closest?.('[data-bk-date-pick]');if(datePick){mutateDates(draft=>{const found=bookingDateRows(draft).find(row=>row.date===datePick.dataset.bkDatePick);return found?removeBookingDate(draft,found.id):addBookingDates(draft,[datePick.dataset.bkDatePick]);});return;}
      if(event.target.closest?.('[data-bk-common-dates]')){mutateDates(applyCommonBookingDateValues);const note=root.querySelector('[data-bk-bulk-feedback]');if(note)note.textContent='시간·휴식을 모든 회차에 적용했습니다.';return;}
      if(event.target.closest?.('[data-bk-common-fees]')){mutateDates(applyCommonBookingDateFinancials);const note=root.querySelector('[data-bk-bulk-feedback]');if(note)note.textContent='강습료·장비요금·입금액을 모든 회차에 적용했습니다.';return;}
      const dateRemove=event.target.closest?.('[data-bk-date-remove]');if(dateRemove){mutateDates(draft=>removeBookingDate(draft,dateRemove.dataset.bkDateRemove));return;}
      const team=event.target.closest?.('[data-bk-team]'),teacher=event.target.closest?.('[data-bk-history-instructor]');
      if(team||teacher)invalidateCandidates();
      if(team){
        preserveDraft();const result=customerTeamHistory(settings.draft,context,{now});
        if(!result.canMatch||team.dataset.bkCustomerKey!==result.identity.customerKey||!result.teams.some(item=>item.key===team.dataset.bkTeam))return;
        const matching=result.teams.find(item=>item.key===team.dataset.bkTeam);if(matching?.customerTeamId){selectDirectoryCustomer(settings.draft.customerId,matching.customerTeamId);return;}
        const input=form.elements.namedItem('raw_I');if(input)input.value=team.dataset.bkTeamValue||'';refreshCustomer();
      }
      if(teacher){
        preserveDraft();const result=customerTeamHistory(settings.draft,context,{now}),id=teacher.dataset.bkHistoryInstructor;
        if(!wantsSameInstructor(settings.draft)||teacher.dataset.bkHistoryIdentity!==customerIdentitySignature(settings.draft)||!result.suggestedInstructorIds.includes(id))return;
        const preferred=form.elements.namedItem('preferredInstructorId');if(preferred)preferred.value=id;
        settings.draft.preferredInstructorId=id;settings.draft.historyInstructorSelection={instructorId:id,identity:customerIdentitySignature(settings.draft)};
        refreshCustomerPanels(form,settings.draft,context,escape);
        preserveDraft();
      }
    });
    // 명부 details의 열림 상태는 리렌더를 넘어 유지한다(toggle은 버블링 안 됨 → capture).
    form.addEventListener('toggle',event=>{
      const manager=event.target?.matches?.('[data-bk-people-manager]')?event.target:null;
      if(manager)settings.draft.peopleRosterOpen=manager.open;
    },true);
    form.addEventListener('change',event=>{
      invalidateCandidates();
      if(settings.draft.passIssueMode)setTimeout(()=>{if(settings.draft.passIssueMode&&form.isConnected)syncPassFinancial(form);},0);
      const session=sessionFinancialTarget(event.target);
      if(session?.rowId){
        const scoped=sessionFinancialForm(form,session.rowId);
        if(['rentalPaymentStatus','rentalHours','rentalCustomAmount','rentalAmount'].includes(session.name))updateRentalFields(scoped);
        updateFinancialFields(scoped,{initializeCorrection:session.name==='paymentCorrectionEnabled'});preserveDraft();syncIndicators();return;
      }
      if(event.target.name==='raw_M'||/^participant_\d+_type$/.test(event.target.name||'')){
        preserveDraft();refreshParticipantFields(form,settings.draft,escape);
        // 인원수가 바뀌면 장비렌탈 자동금액(단가×인원)과 요청금액도 다시 계산한다.
        if(event.target.name==='raw_M'){updateRentalFields(form);for(const scoped of form.querySelectorAll('fieldset[data-bk-session-financial]'))updateRentalFields(scoped);updateFinancialFields(form);}
        const target=form.querySelector('[data-bk-requirement]');if(target)target.innerHTML=renderRequirement(settings.draft,context,escape);return;}
      if(/^participant_\d+_age$/.test(event.target.name||'')){preserveDraft();return;}
      if(['cashReceiptRequested','cashReceiptNumberMode','raw_Q'].includes(event.target.name)){preserveDraft();refreshCashReceiptFields(form,settings.draft);return;}
      if(['lessonMinutes','breakMinutes'].includes(event.target.name)||String(event.target.name||'').startsWith('date_')){preserveDraft();refreshLessonPlanFields(form,settings.draft,escape);return;}
      if(event.target.name==='batchCalendarMonth'){preserveDraft();update({draft:settings.draft});return;}
      // Input already refreshed the candidates. Replacing them on blur/change loses the pointer click.
      if(['raw_H','raw_L','raw_I','teamPhone'].includes(event.target.name)){preserveDraft();refreshPhoneFeedback(form,settings.draft,context);refreshLearnerFields(form,settings.draft);return;}
      if(['ageBand','teamPhoneMode','juniorPreparation'].includes(event.target.name)){preserveDraft();refreshLearnerFields(form,settings.draft);refreshCustomerPanels(form,settings.draft,context,escape);const requirement=form.querySelector('[data-bk-requirement]');if(requirement)requirement.innerHTML=renderRequirement(settings.draft,context,escape);return;}
      if(['patchEnabled','raw_T','raw_U','raw_Y','paymentCorrectionEnabled','paymentCorrectionAmount','paymentCorrectionReason'].includes(event.target.name)){updateFinancialFields(form,{initializeCorrection:event.target.name==='paymentCorrectionEnabled'});preserveDraft();return;}
      if(['rentalPaymentStatus','rentalHours','rentalCustomAmount','rentalAmount'].includes(event.target.name)){
        updateRentalFields(form,event.target.name);updateFinancialFields(form);preserveDraft();return;
      }

      if(event.target.name==='lessonPassId'){
        const pass=(context.lessonPasses||[]).find(item=>item.id===event.target.value);
        if(pass){
          const bound=!!(pass.customer_id||pass.customerId);
          for(const [key,value] of Object.entries(bound?{D:pass.sport}:{H:pass.customer_name,I:pass.learner_name||'',L:pass.phone||'',D:pass.sport})){
            const input=form.elements.namedItem(`raw_${key}`);if(input)input.value=value||'';
          }
          const preferred=form.elements.namedItem('preferredInstructorId');
          if(preferred&&!preferred.value&&pass.fixed_instructor_user_id)preferred.value=pass.fixed_instructor_user_id;
        }
      }
      if(event.target.name==='preferredInstructorId'&&settings.draft.historyInstructorSelection?.instructorId!==event.target.value)delete settings.draft.historyInstructorSelection;
      if(event.target.name==='seasonId'){
        // 구매 총회차는 입력이 아니라 자동(패키지 ?? 상담 fact ?? 회차 수) — 표시만 갱신한다(2026-11-16).
        const selected=context.seasonPackages?.find(pack=>pack.id===event.target.value);
        if(selected){const instructorField=form.elements.namedItem('preferredInstructorId');if(instructorField)instructorField.value=selected.instructor_user_id||selected.instructorUserId||'';settings.draft=automaticBookingSeason({...settings.draft,seasonId:selected.id},context);}
        else settings.draft=automaticBookingSeason({...settings.draft,seasonId:null},context);
        const totalBadge=form.querySelector('[data-bk-season-total]');if(totalBadge)totalBadge.textContent=`${settings.draft.seasonTotal||bookingDateRows(settings.draft).length||1}회`;
        const kind=form.querySelector('[data-bk-automatic-kind]');
        if(kind)kind.textContent=settings.draft.kind==='season'?'시즌강습 · 같은 팀 모든 회차에 같은 강사':settings.draft.isReorder?'리오더':'일반 강습';
      }
      if(['age','experienceCount','parallelLongTurn','snowboardNoviceTurn','lessonPassId','kind','isReorder','designated','preferredInstructorId','seasonId','raw_H','raw_L','raw_I','raw_A','raw_B','raw_C','raw_D','raw_E'].includes(event.target.name)){
        preserveDraft();refreshLessonPlanFields(form,settings.draft,escape);syncSportSkillFields(form,settings.draft);const requirement=form.querySelector('[data-bk-requirement]');if(requirement)requirement.innerHTML=renderRequirement(settings.draft,context,escape);
        refreshCustomerPanels(form,settings.draft,context,escape);
        preserveDraft();
        const pass=(context.lessonPasses||[]).find(item=>item.id===settings.draft.lessonPassId),summary=form.querySelector('[data-bk-pass-summary]');
        if(summary)summary.textContent=pass?`${pass.learner_name||pass.customer_name} · 총 ${Number(pass.total_sessions)}회 · 미예약 ${passAvailable(pass,context)}회`:'수강권 연결 없이 예약을 접수합니다.';
        // 수강권 선택(2026-11-17 사용자 확정): 발급 때 넣은 시간권·비율·강습료·장비·수납액을
        // 그대로 가져온다 — 이미 받은 값을 다시 입력하게 하지 않는다.
        if(event.target.name==='lessonPassId'&&pass){update({draft:applyPassCarryDraft(settings.draft,pass)});return;}
        if(settings.tab==='assignment')update({draft:settings.draft});
      }
    });
    view.querySelector('[data-bk-suggest]')?.addEventListener('click',async event=>{
      if(busy())return;preserveDraft();
      const button=event.currentTarget,key=activeDraftCard(settings.teamDeck)?.key,mode=settings.demo,tab=settings.tab;
      const requestedDraft=clone(settings.draft),snapshot=JSON.stringify(requestedDraft),requestToken=`candidates-${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`;
      settings.candidateRequestToken=requestToken;if(ui.booking)ui.booking.candidateRequestToken=requestToken;
      button.dataset.candidateRequest=requestToken;button.disabled=true;button.textContent='배정 조건 확인 중…';
      const isCurrent=()=>ui.booking?.candidateRequestToken===requestToken&&ui.booking.demo===mode&&ui.booking.tab===tab&&ui.booking.teamDeck?.activeKey===key&&JSON.stringify(ui.booking.draft)===snapshot;
      try{
        let evaluation=candidateResult(requestedDraft,context);
        if(!mode&&typeof onCandidates==='function'){
          const requests=bookingDateRows(requestedDraft).length>1?buildBookingBatch(requestedDraft,context).payloads:[requestedDraft];
          const servers=await Promise.all(requests.map(payload=>onCandidates(clone(payload))));if(servers.some(server=>server?.discarded)||!isCurrent())return;
          const results=servers.filter(Boolean).map(server=>({...server,requiredInstructorId:server.requiredInstructorId??server.required_instructor_id,needsReview:server.needsReview??server.needs_review,candidates:(server.candidates||[]).map(person=>({...person,instructorId:person.instructorId||person.instructor_user_id||person.user_id||person.id}))}));
          if(results.length===1)evaluation={...evaluation,...results[0],requiredInstructorId:results[0].requiredInstructorId??evaluation.requiredInstructorId,needsReview:results[0].needsReview??evaluation.needsReview};
          else if(results.length)evaluation={...evaluation,needsReview:evaluation.needsReview||results.some(result=>result.needsReview),candidates:evaluation.candidates.map(person=>{const peers=results.map(result=>result.candidates.find(peer=>peer.instructorId===person.instructorId));return {...person,eligible:person.eligible&&peers.every(peer=>peer?.eligible),blockedReasons:[...(person.blockedReasons||[]),...peers.flatMap((peer,index)=>peer?.eligible?[]:(peer?.blockedReasons||['일정 확인 필요']).map(reason=>`${requests[index].raw.A} · ${reason}`))]};})};
        }
        if(!isCurrent())return;
        const eligible=(evaluation.candidates||[]).filter(person=>person.eligible);
        if(evaluation.needsReview||!eligible.length){showError(form,(evaluation.reasons||[]).join(' · ')||'확인된 조건에 맞는 배정 가능 강사가 없습니다.');return;}
        const recommended=evaluation.requiredInstructorId||eligible[0].instructorId||eligible[0].id;
        const suggestedDraft={...requestedDraft,instructorIds:[recommended],suggestion:true};
        if(requestedDraft.kind==='season'&&!requestedDraft.seasonId&&!requestedDraft.preferredInstructorId)suggestedDraft.preferredInstructorId=recommended;
        update({draft:suggestedDraft,tab:'assignment'});
      }catch(error){if(isCurrent())showError(form,error.message||'배정 조건을 확인하지 못했습니다.');}
      finally{
        if(ui.booking?.candidateRequestToken===requestToken)ui.booking.candidateRequestToken=null;
        if(button.dataset.candidateRequest===requestToken){delete button.dataset.candidateRequest;button.disabled=false;button.textContent='자동 배정안 만들기';}
      }
    });
    // 수강권 발급 모드(2026-11-16): 날짜지정 블록이 그 자리에서 발급 패널로 바뀐다.
    // 발급 폼의 구성 행(발급 완료 행 포함)을 화면/저장 상태에서 읽는다.
    const readPassConfigs=form=>{
      const draft=settings.draft;
      const rows=Array.isArray(draft.passConfigs)&&draft.passConfigs.length?draft.passConfigs:[{issueId:'seed',minutes:String(draft.raw?.N||'').trim(),sessions:String(draft.passTotalSessions||'').trim(),fee:String(draft.raw?.T??'').trim(),done:null}];
      return rows.map(row=>{
        const field=name=>form.elements.namedItem(`passCfg_${row.issueId}_${name}`);
        return {...row,
          minutes:String(field('minutes')?.value??row.minutes??'').trim(),
          sessions:String(field('sessions')?.value??row.sessions??'').trim(),
          fee:String(field('fee')?.value??row.fee??'').trim()};
      });
    };
    const syncPassFinancial=form=>{
      if(!settings.draft.passIssueMode)return;
      const read=name=>form.elements.namedItem(name);
      const configs=readPassConfigs(form);
      const status=read('rentalPaymentStatus')?.value||settings.draft.rentalPaymentStatus||'';
      const rental=status==='paid'?numeric(read('rentalAmount')?.value??String(settings.draft.rentalAmount??'')):status?0:null;
      // 받아야 할 금액 = 각 구성의 (회당 강습료 + 회당 장비 결제완료) × 횟수 합.
      let x=rental===null||!configs.length?null:0;
      if(x!==null)for(const row of configs){
        const n=Number(row.sessions),fee=numeric(row.fee);
        if(!Number.isInteger(n)||n<1||n>100||fee===null){x=null;break;}
        x+=(fee+rental)*n;
      }
      const y=numeric(read('raw_Y')?.value)??0;
      const X=read('raw_X'),Z=read('raw_Z');
      if(X)X.value=x===null?'':String(x);
      if(Z)Z.value=x===null?'':String(Math.max(x-y,0));
      // 단일 회차 기준으로 계산된 초과입금 경고는 총액 기준으로 다시 판정한다(N7, 2026-11-16).
      const over=form.querySelector('[data-bk-overpaid]');
      if(over){const overpaid=x!==null&&y>x?y-x:0;over.hidden=!(overpaid>0);const strong=over.querySelector('strong');if(strong)strong.textContent=`${overpaid.toLocaleString('ko-KR')}원`;}
    };
    const issueInlinePass=async form=>{
      if(busy())return;preserveDraft();syncPassFinancial(form);preserveDraft();
      const draft=settings.draft,raw=draft.raw;
      const errorBox=form.querySelector('[data-bk-pass-inline-error]');
      const fail=message=>{if(errorBox){errorBox.textContent=message;errorBox.hidden=false;errorBox.scrollIntoView?.({block:'nearest'});}};
      // 구성 행(2시간/4시간 × 횟수 × 회당 강습료)마다 수강권 1장을 발급한다(2026-11-20 사용자 확정:
      // 고객별 발급, 혼합 구성 지원). 발급번호는 행 생성 시 고정 — 연타·재시도에도 중복 없음.
      const configs=readPassConfigs(form);
      const pendingRows=configs.filter(row=>!row.done);
      if(!pendingRows.length)return fail('모든 구성이 이미 발급되었습니다.');
      for(const row of pendingRows){
        const n=Number(row.sessions);
        if(!['2시간','4시간'].includes(row.minutes))return fail('각 구성의 시간권(2시간·4시간)을 선택해 주세요.');
        if(!Number.isInteger(n)||n<1||n>100)return fail('각 구성의 횟수를 1~100회 정수로 입력해 주세요.');
        if(numeric(row.fee)===null)return fail('각 구성의 회당 강습료를 입력해 주세요. 무료면 0.');
      }
      if(!draft.rentalPaymentStatus)return fail('장비 결제 상태를 선택해 주세요.');
      if(draft.rentalPaymentStatus==='paid'&&numeric(String(draft.rentalAmount??''))===null)return fail('장비 결제완료 금액을 확인해 주세요.');
      if(!String(raw.H||'').trim())return fail('고객명(입금자)을 먼저 입력해 주세요.');
      if(typeof onCreatePass!=='function')return fail('수강권 발급 연결을 확인해 주세요.');
      const roster=bookingRosterPeople(draft,context);
      const ids=Array.isArray(draft.participantPersonIds)?draft.participantPersonIds:roster.map(person=>String(person.id));
      const participants=roster.length?participantsFromPeople(roster,ids):(Array.isArray(draft.participants)?draft.participants.map(person=>({type:person?.type==='minor'?'minor':'adult',age:person?.type==='minor'&&Number.isInteger(person?.age)?person.age:null})):[]);
      const headcount=numeric(raw.M)||participants.length||1;
      // 고객 디렉터리 연결(2026-11-20): 예약 저장과 같은 계약 — 선택된 고객·팀과 draft 동봉.
      const directoryLink=draft.customerId&&draft.customerTeamId?{customerId:draft.customerId,teamId:draft.customerTeamId,...(draft.customerDraft?{customerDraft:{...draft.customerDraft,id:draft.customerId,name:String(raw.H||'').trim()}}:{}),...(draft.teamDraft?{teamDraft:{...draft.teamDraft,id:draft.customerTeamId,customerId:draft.customerId,name:String(raw.I||'').trim()}}:{})}:{};
      if(errorBox)errorBox.hidden=true;
      const submitButton=form.querySelector('[data-bk-pass-inline-issue]');if(submitButton)submitButton.disabled=true;
      const nextConfigs=configs.map(row=>({...row}));
      try{
        for(const row of nextConfigs){
          if(row.done)continue;
          const n=Number(row.sessions);
          const saved=await onCreatePass({id:row.issueId,customerName:String(raw.H||'').trim(),learnerName:String(raw.I||raw.H||'').trim()||'수강권',phone:String(raw.L||draft.customerContactPhone||'').trim(),company:String(raw.E||'').trim(),sport:['스키','보드'].includes(String(raw.D||'').trim())?String(raw.D).trim():'스키',totalSessions:n,lessonMinutes:row.minutes==='4시간'?240:120,lessonRatio:headcount>=1&&headcount<=99?`1:${headcount}`:'',participants,fixedInstructorId:draft.preferredInstructorId||'',...directoryLink,notes:[`총 횟수: ${n}회`,`구성: ${row.minutes}권 ${n}회 · 회당 강습료 ${Number(numeric(row.fee)).toLocaleString('ko-KR')}원`,...passIssueCarryLines(draft),String(raw.G||'').trim()].filter(Boolean).join('\n').slice(0,2000)});
          row.done={totalSessions:n,passId:saved?.id||null};
        }
        update({draft:{...settings.draft,passConfigs:nextConfigs,passIssueDone:{totalSessions:nextConfigs.reduce((sum,row)=>sum+(row.done?.totalSessions||0),0),passId:nextConfigs[0]?.done?.passId||null}}});
      }catch(error){
        if(submitButton)submitButton.disabled=false;
        // 이미 성공한 행의 done 을 보존해 재클릭 시 그 행은 건너뛴다(부분 실패 안전).
        update({draft:{...settings.draft,passConfigs:nextConfigs}});
        fail(error?.message||'수강권을 발급하지 못했습니다. 다시 시도해 주세요.');
      }
    };
    view.querySelector('[data-bk-issue-pass]')?.addEventListener('click',()=>{
      if(busy())return;preserveDraft();
      if(typeof onCreatePass==='function'){
        const draft=settings.draft;
        // 구성 행(2시간/4시간 × 횟수)마다 발급번호를 '지금' 고정한다 — 버튼 연타·재시도에도
        // 같은 번호로 서버 멱등이 걸려 수강권이 중복 발급되지 않는다(2026-11-20 사용자 신고).
        const configs=Array.isArray(draft.passConfigs)&&draft.passConfigs.length?draft.passConfigs:[{issueId:globalThis.crypto.randomUUID(),minutes:String(draft.raw?.N||'').trim(),sessions:String(draft.passTotalSessions||'').trim(),fee:String(draft.raw?.T??'').trim(),done:null}];
        update({draft:{...draft,passIssueMode:true,passConfigs:configs}});return;
      }
      if(typeof onIssuePass==='function')onIssuePass(clone(settings.draft));
    });
    view.querySelector('[data-bk-pass-config-add]')?.addEventListener('click',()=>{
      if(busy())return;preserveDraft();
      const draft=settings.draft,configs=Array.isArray(draft.passConfigs)?draft.passConfigs:[];
      const used=new Set(configs.map(row=>row.minutes));
      update({draft:{...draft,passConfigs:[...configs,{issueId:globalThis.crypto.randomUUID(),minutes:used.has('2시간')&&!used.has('4시간')?'4시간':'',sessions:'',fee:String(draft.raw?.T??'').trim(),done:null}]}});
    });
    view.querySelectorAll('[data-bk-pass-config-remove]').forEach(button=>button.addEventListener('click',()=>{
      if(busy())return;preserveDraft();
      const draft=settings.draft,configs=(draft.passConfigs||[]).filter(row=>row.issueId!==button.dataset.bkPassConfigRemove||row.done);
      if(!configs.length)return;
      update({draft:{...draft,passConfigs:configs}});
    }));
    view.querySelector('[data-bk-pass-mode-off]')?.addEventListener('click',()=>{
      if(busy())return;preserveDraft();
      update({draft:{...settings.draft,passIssueMode:false}});
    });
    if(settings.draft.passIssueMode)syncPassFinancial(form);
    // 수강권 인라인 발급 모달
    view.querySelectorAll('[data-bk-passissue-close]').forEach(button=>button.addEventListener('click',()=>update({passIssueOpen:false})));
    view.querySelector('[data-bk-passissue-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget)update({passIssueOpen:false});});
    view.querySelector('[data-bk-passissue-confirm]')?.addEventListener('click',async event=>{
      if(busy()||typeof onCreatePass!=='function')return;
      const modal=event.target.closest('.bk-passissue'),errorBox=modal.querySelector('[data-bk-passissue-error]');
      const pending=[...modal.querySelectorAll('[data-bk-pass-team]')].filter(row=>row.querySelector('[data-bk-pass-sessions]'));
      const entries=pending.map(row=>({key:row.dataset.bkPassTeam,sessions:Number(row.querySelector('[data-bk-pass-sessions]').value||'')}));
      const invalid=entries.find(entry=>!Number.isInteger(entry.sessions)||entry.sessions<1||entry.sessions>100);
      if(invalid||!entries.length){errorBox.hidden=false;errorBox.textContent='각 팀의 총 횟수를 1~100회 정수로 입력해 주세요.';return;}
      event.target.disabled=true;errorBox.hidden=true;
      const results={...(settings.passIssueResults||{})};
      // 발급번호를 팀 키별로 고정(최초 시도 때 생성 후 재사용) — 실패 후 재클릭·연타에도
      // 서버 멱등으로 같은 수강권 1장만 만들어진다(2026-11-20 중복 발급 신고 수정).
      const issueIds={...(settings.passIssueIds||{})};
      for(const entry of entries)issueIds[entry.key]??=globalThis.crypto.randomUUID();
      update({passIssueIds:issueIds});
      try{
        for(const entry of entries){
          if(results[entry.key])continue;
          const card=(settings.teamDeck?.cards||[]).find(item=>item.key===entry.key);if(!card)continue;
          const draft=card.draft||{},raw=draft.raw||{};
          const roster=customerPeopleOf(context,draft.customerId);
          const ids=Array.isArray(draft.participantPersonIds)?draft.participantPersonIds:roster.map(person=>String(person.id));
          const participants=roster.length?participantsFromPeople(roster,ids):(Array.isArray(draft.participants)?draft.participants.map(person=>({type:person?.type==='minor'?'minor':'adult',age:person?.type==='minor'&&Number.isInteger(person?.age)?person.age:null})):[]);
          const headcount=numeric(raw.M)||participants.length||1;
          const directoryLink=draft.customerId&&draft.customerTeamId?{customerId:draft.customerId,teamId:draft.customerTeamId,...(draft.customerDraft?{customerDraft:{...draft.customerDraft,id:draft.customerId,name:String(raw.H||'').trim()}}:{}),...(draft.teamDraft?{teamDraft:{...draft.teamDraft,id:draft.customerTeamId,customerId:draft.customerId,name:String(raw.I||'').trim()}}:{})}:{};
          const saved=await onCreatePass({id:issueIds[entry.key],customerName:String(raw.H||'').trim(),learnerName:String(raw.I||raw.H||'').trim()||'수강권',phone:String(raw.L||draft.customerContactPhone||'').trim(),company:String(raw.E||'').trim(),sport:['스키','보드'].includes(String(raw.D||'').trim())?String(raw.D).trim():'스키',totalSessions:entry.sessions,lessonRatio:headcount>=1&&headcount<=99?`1:${headcount}`:'',participants,fixedInstructorId:draft.preferredInstructorId||'',...directoryLink,notes:[...passIssueCarryLines(draft),String(raw.G||'').trim()].filter(Boolean).join('\n').slice(0,2000)});
          results[entry.key]={totalSessions:entry.sessions,passId:saved?.id||null};
          update({passIssueResults:{...results}});
        }
        update({passIssueResults:results});
      }catch(error){event.target.disabled=false;errorBox.hidden=false;errorBox.textContent=error?.message||'수강권을 발급하지 못했습니다.';update({passIssueResults:{...results}});return;}
    });
    view.querySelector('[data-bk-clear-assignment]')?.addEventListener('click',()=>{preserveDraft();update({draft:{...settings.draft,raw:{...settings.draft.raw,F:''},instructorIds:[],suggestion:false}});});
    form.addEventListener('submit',event=>{event.preventDefault();if(busy())return;preserveDraft();
      if(!settings.draft.id&&settings.draft.passIssueMode){void issueInlinePass(form);return;}
      // 수강권으로 이미 발급한 팀은 예약으로 다시 저장하지 않는다 — 중복 등록 방지(N2, 2026-11-16).
      if(!settings.draft.id&&settings.draft.passIssueDone){showError(form,'이 팀은 이미 수강권으로 발급했습니다. 날짜가 정해지면 수강권 탭의 [일정 등록]으로 이어가 주세요. 예약으로 따로 저장하면 중복 등록이 됩니다.');return;}
      if(activeDraftCard(settings.teamDeck)?.status==='saved'){showError(form,'변경된 항목이 없습니다.');return;}if(settings.deckMode!==(settings.demo?'demo':'operational')){showError(form,'체험과 운영 예약 카드를 함께 저장할 수 없습니다. 초안을 확인해 주세요.');return;}if(savePaymentGroup(form))return;const draft=settings.draft,ownIds=new Set(bookingDateRows(draft).map(row=>row.id).filter(Boolean)),validationContext=!draft.id&&bookingDateRows(draft).length>1?{...context,reservations:context.reservations.filter(row=>!ownIds.has(row.id)),schedules:(context.schedules||[]).filter(row=>!ownIds.has(row.id)),passBalances:[]}:context,error=validationError(draft,validationContext);if(error){showError(form,error);return;}
      const payload=bookingPayload(draft,context),card=activeDraftCard(settings.teamDeck),cachedBaseline=card?.serverId===payload.id&&card?.baseline?.id===payload.id&&card?.baseline?.expectedUpdatedAt?card.baseline:null,original=payload.id?(context.reservations.find(row=>row.id===payload.id)||cachedBaseline):null;
      if(original){
        if(!bookingChangeItems(original,payload,context).length){showError(form,'변경된 항목이 없습니다.');return;}
        update({drawer:'review',reviewSaving:false,review:{before:clone(original),after:payload,returnTab:settings.tab,reasonPreset:payload.paymentRequestCorrection?'금액 정정':'',reasonText:payload.paymentRequestCorrection?.reason||'',notificationInstructorIds:[],cardKey:settings.teamDeck.activeKey}});return;
      }
      if(bookingDateRows(draft).length>1){
        const prepared=prepareCustomerIdentity(draft),batch=buildBookingBatch(prepared,context);
        settings.draft=batch.draft;settings.teamDeck=preserveActiveDraft(settings.teamDeck,batch.draft,settings.tab);ui.booking.teamDeck=settings.teamDeck;ui.booking.draft=batch.draft;
        const errors=[...batch.errors];for(const [index,row]of batch.payloads.entries()){const error=validationError({...row,id:''},validationContext);if(error&&!errors.some(item=>item.index===index&&item.message===error))errors.push({index,rowId:row.id,message:error});}
        if(errors.length){form.querySelectorAll('[data-bk-date-row]').forEach(row=>row.classList?.toggle('has-error',errors.some(error=>error.rowId===row.dataset.bkDateRow)));showError(form,errors.map(item=>`${item.index+1}회: ${item.message}`).join('\n'));return;}
        run(form,async(key,requestToken)=>{
          if(typeof onSaveBatch!=='function')throw new Error('여러 날짜 저장 연결이 아직 준비되지 않았습니다.');
          const result=await onSaveBatch(batch.payloads,batch.batchId);if(result?.discarded)return;
          if(!Array.isArray(result?.reservations)||result.reservations.length!==batch.payloads.length||new Set(result.reservations.map(row=>row.id)).size!==batch.payloads.length||result.reservations.some(row=>!batch.payloads.some(payload=>payload.id===row.id)))throw new Error('저장 결과를 확인하지 못했습니다. 같은 카드에서 다시 저장해 주세요.');
          if(!settings.demo)for(const payload of batch.payloads)assertPaymentCorrectionResult(payload,result.reservations.find(row=>row.id===payload.id));
          const first=result.reservations.find(row=>row.id===batch.payloads[0].id);if(!first)throw new Error('첫 회차의 저장 결과를 다시 확인해 주세요.');
          finishSaved(key,batch.payloads[0],{...result,reservation:first},requestToken);
        });return;
      }
      run(form,async(key,requestToken)=>{
        let result;
        if(typeof onSave==='function'){
          if(!payload.id){settings.draft.submissionId ||= `booking-${crypto.randomUUID()}`;payload.id=bookingDateRows(settings.draft)[0]?.id||settings.draft.submissionId;}
          delete payload.submissionId;result=await onSave(payload);
        }
        else if(settings.demo){payload.id=payload.id||bookingDateRows(settings.draft)[0]?.id||settings.draft.submissionId||`DEMO-BOOKING-${Date.now()}`;if(payload.kind==='season'&&!payload.seasonId){payload.seasonId=`DEMO-SEASON-${Date.now()}`;settings.demoData.seasonPackages.push({id:payload.seasonId,customer_name:payload.raw.H||payload.raw.I,customer_team_key:seasonCustomerKey(payload),total_sessions:payload.seasonTotal,instructor_user_id:payload.preferredInstructorId});}const pass=(settings.demoData.lessonPasses||[]).find(item=>item.id===payload.lessonPassId);if(pass&&!pass.fixed_instructor_user_id&&payload.instructorIds.length)pass.fixed_instructor_user_id=payload.instructorIds[0];const index=settings.demoData.rows.findIndex(row=>row.id===payload.id);if(index>=0)settings.demoData.rows[index]=payload;else settings.demoData.rows.push(payload);result={reservation:payload};}
        else{if(typeof onSave!=='function')throw new Error('예약 저장 연결이 아직 준비되지 않았습니다.');if(!payload.id){settings.draft.submissionId ||= `booking-${crypto.randomUUID()}`;payload.id=bookingDateRows(settings.draft)[0]?.id||settings.draft.submissionId;}delete payload.submissionId;result=await onSave(payload);}
        finishSaved(key,payload,result,requestToken);
      });
    });
  }
  const reviewForm=view.querySelector('.bk-change-review-form');
  if(reviewForm&&settings.review){
    const review=settings.review;
    const preserveReview=()=>{
      review.reasonPreset=String(reviewForm.elements.namedItem('changeReasonPreset')?.value||'');
      review.reasonText=String(reviewForm.elements.namedItem('changeReasonText')?.value||'');
      review.notificationInstructorIds=[...reviewForm.querySelectorAll('input[name="notificationInstructorIds"]:checked')].map(input=>input.value);
    };
    reviewForm.addEventListener('input',preserveReview);reviewForm.addEventListener('change',preserveReview);
    view.querySelector('[data-bk-review-back]')?.addEventListener('click',()=>{if(settings.reviewSaving)return;preserveReview();update({drawer:'reservation',tab:review.returnTab||'intake',review:null});});
    view.querySelectorAll('[data-bk-change-cancel]').forEach(button=>button.addEventListener('click',fold));
    reviewForm.addEventListener('submit',event=>{
      event.preventDefault();if(busy())return;preserveReview();
      const preset=reasonPresets.includes(review.reasonPreset)?review.reasonPreset:'',detail=review.reasonText.trim();
      // 운영 결정(2026-11-15): 사유 입력을 강제하지 않는다 — 비우면 기본 사유로 저장.
      const reason=(preset?`${preset}${detail?` · ${detail}`:''}`:detail)||'운영 변경';
      if(reason.length>1000){showError(reviewForm,'변경 사유를 1,000자 이내로 입력해 주세요.');return;}
      const latest=contextFor(state,settings,now),error=validationError(review.after,latest);
      if(error){showError(reviewForm,error);return;}
      const recipients=new Set([...normalizeBookingRow(review.before,latest).instructorIds,...normalizeBookingRow(review.after,latest).instructorIds]);
      const notificationSelection={instructorIds:unique(review.notificationInstructorIds).filter(id=>recipients.has(id)),customerSms:false};
      run(reviewForm,async(key,requestToken)=>{
        if(typeof onChangeReservation!=='function')throw new Error('예약 변경 저장 연결이 아직 준비되지 않았습니다.');
        const payload=bookingPayload(review.after,latest),result=await onChangeReservation(payload,reason,notificationSelection);
        finishSaved(key,payload,result,requestToken);
      });
    });
  }

  view.querySelector('.bk-policy-form')?.addEventListener('submit',event=>{event.preventDefault();if(role!=='admin')return;const target=event.currentTarget;run(target,async()=>{const values=new FormData(target),payload={bookingExpertMode:String(values.get('bookingExpertMode')||'either'),bookingExpertAgeMax:Number(values.get('bookingExpertAgeMax')),bookingExpertExperienceMin:Number(values.get('bookingExpertExperienceMin')),bookingExpertParallelMode:String(values.get('bookingExpertParallelMode')||'capable'),bookingExpertSnowboardMode:String(values.get('bookingExpertSnowboardMode')||'capable')};if(settings.demo){settings.demoData.policy={...settings.demoData.policy,...payload};context.settings={...context.settings,...payload};state={...state,settings:{...state.settings,...payload}};}else{if(typeof onSavePolicy!=='function')throw new Error('배정 기준 저장 연결이 아직 준비되지 않았습니다.');const result=await onSavePolicy(payload);if(result?.discarded)return;}update({drawer:'settings'});});});
  view.querySelectorAll('.bk-capability-form').forEach(target=>target.addEventListener('submit',event=>{event.preventDefault();if(role!=='admin')return;run(target,async()=>{const values=new FormData(target),payload={instructorUserId:target.dataset.instructor,isExperienced:values.has('isExperienced'),verified:values.has('verified'),sports:values.getAll('sports').map(String),locations:unique(String(values.get('locations')||'').split(',').map(value=>value.trim()))};if(payload.verified&&(!payload.sports.length||!payload.locations.length))throw new Error('확인 완료로 저장하려면 가능 종목과 지점을 입력해 주세요.');if(settings.demo){const index=settings.demoData.capabilities.findIndex(row=>row.instructor_user_id===payload.instructorUserId);const record={instructor_user_id:payload.instructorUserId,is_experienced:payload.isExperienced,verified:payload.verified,sports:payload.sports,locations:payload.locations};if(index<0)settings.demoData.capabilities.push(record);else settings.demoData.capabilities[index]=record;}else{if(typeof onSaveCapabilities!=='function')throw new Error('강사 조건 저장 연결이 아직 준비되지 않았습니다.');const result=await onSaveCapabilities(payload);if(result?.discarded)return;}update({drawer:'settings'});});}));
  view.addEventListener('keydown',event=>{if(!settings.drawer)return;if(event.key==='Escape'){event.preventDefault();if(settings.deleteRequest){cancelDelete();return;}if(settings.closeCardKey){cancelCardClose();return;}if(settings.discardPrompt){updatePreservingScroll({discardPrompt:false});return;}if(settings.cardListOpen){updatePreservingScroll({cardListOpen:false});return;}fold();return;}if(event.key==='Tab'){const drawer=view.querySelector(settings.deleteRequest?'.bk-delete-confirm':settings.closeCardKey?'.bk-card-close-confirm':'.bk-drawer'),focusable=[...drawer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]')].filter(element=>element.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===drawer)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  // Focus the drawer without stealing focus on background server refreshes.
  if(settings.drawer){
    const drawer=view.querySelector('.bk-drawer');drawer.setAttribute('tabindex','-1');
    if(settings.deleteRequest)view.querySelector('[data-bk-delete-cancel]')?.focus({preventScroll:true});
    else if(settings.focusDeleteButton){view.querySelector('[data-bk-delete-reservation]')?.focus({preventScroll:true});settings.focusDeleteButton=false;}
    else if(settings.closeCardKey)view.querySelector('[data-bk-card-close-cancel]')?.focus({preventScroll:true});
    else if(settings.focusCardCloseKey){const target=[...view.querySelectorAll('[data-bk-close-card]')].find(button=>button.dataset.bkCloseCard===settings.focusCardCloseKey&&button.getClientRects?.().length);target?.focus({preventScroll:true});settings.focusCardCloseKey=null;}
    else if(settings.focusCardSearch){view.querySelector('[data-bk-card-search]')?.focus({preventScroll:true});settings.focusCardSearch=false;}
    else if(settings.focusExistingDraft){const input=view.querySelector('[name="raw_H"]:not(:disabled),[name="raw_I"]:not(:disabled),.bk-reservation-form input:not(:disabled)');input?.focus({preventScroll:true});view.querySelector('[data-bk-existing-draft-notice]')?.scrollIntoView?.({block:'nearest'});settings.focusExistingDraft=false;}
    else if(settings.focusNewTeam){keepActiveTeamVisible(view);const input=view.querySelector('[name="raw_I"]');input?.focus({preventScroll:true});input?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});settings.focusNewTeam=false;}
    else if(!view.contains(document.activeElement))drawer.focus({preventScroll:true});
    keepActiveCardVisible(view,settings.teamDeck?.activeKey);
    const rail=view.querySelector('.bk-card-rail');
    if(rail&&typeof ResizeObserver==='function'){const observer=new ResizeObserver(()=>keepActiveCardVisible(view,settings.teamDeck?.activeKey));observer.observe(rail);bookingRailObservers.set(root,observer);}
  }
}
