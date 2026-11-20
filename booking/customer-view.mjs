import {canDeleteCustomer,customerDeletionPayload,customerDeletionUsage,isDeletedCustomer,customerDeletionConfirmed} from './customer-delete.mjs?v=2';
import {resizeParticipants} from './booking-participants.mjs?v=34';
import {canonicalTelephone,formatTelephone} from './customer-teams.mjs?v=27';
import {selectPassBalances} from './pass-view.mjs?v=48';
import {customerDirectoryTeams,customerContactChoices,customerDirectoryReservations,createCustomerDirectoryDraft,createCustomerTeamDraft,customerDirectoryPayload,customerTeamPayload,searchCustomerCandidates,CUSTOMER_AGE_BANDS,customerTeamAgeLabel} from './customer-directory.mjs?v=35';

const escapeFallback=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list=value=>Array.isArray(value)?value:[];
const clone=value=>JSON.parse(JSON.stringify(value));
const text=value=>String(value??'').trim();
function editorFacts(value){
  if(!value)return value;
  const result=clone(value),phone=value=>canonicalTelephone(value)||String(value??'').trim();
  if(Array.isArray(result.contacts))result.contacts=result.contacts.map(contact=>({...contact,label:String(contact.label||''),phone:phone(contact.phone)}));
  if('customerId' in result){
    result.teamPhoneMode=result.teamPhoneMode|| (phone(result.phone)?'separate':'same');
    result.phone=result.teamPhoneMode==='same'?'':phone(result.phone);
    const defaults=result.defaults||{},raw=defaults.raw||{},sport=defaults.sport||raw.D||'스키';
    result.defaults={...defaults,sport,age:defaults.ageBand?null:defaults.age??null,ageBand:CUSTOMER_AGE_BANDS.includes(defaults.ageBand)?defaults.ageBand:null,juniorPreparation:defaults.juniorPreparation===true,experienceCount:defaults.experienceCount??null,parallelLongTurn:defaults.parallelLongTurn===true?true:defaults.parallelLongTurn===false?false:null,snowboardNoviceTurn:defaults.snowboardNoviceTurn===true?true:defaults.snowboardNoviceTurn===false?false:null,raw:{...raw,D:sport,M:String(raw.M||'1'),N:raw.N||'',K:raw.K||'',O:raw.O||''}};
  }
  return result;
}
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(editorFacts(a)))===JSON.stringify(stable(editorFacts(b)));

// 고객 요약(2026-11-15): 미수(강습료 부분미결제) 여부 + 캐치/라이즌 소속 — 예약표 색 기준과 동일.
function customerFinanceBrand(customerId,state){
  const rows=customerDirectoryReservations(customerId,state);
  let due=0,catchCount=0,risenCount=0;
  for(const row of rows){
    const raw=rawOf(row);
    const t=Number(String(raw.T||'').replace(/[^0-9]/g,''))||0;
    const y=Number(String(raw.Y||'').replace(/[^0-9]/g,''))||0;
    if(t>0&&y<t)due+=t-y;
    const company=String(raw.E||'');
    if(company.includes('캐치'))catchCount++;else if(company.includes('라이즌'))risenCount++;
  }
  const brands=[catchCount?'catch':null,risenCount?'risen':null].filter(Boolean);
  return {due,brands,catchCount,risenCount,
    brandClass:due>0?'cd-row-due':brands.length===1?(brands[0]==='catch'?'cd-co-catch':'cd-co-risen'):brands.length>1?'cd-co-mixed':'',
    brandLabel:brands.length>1?`캐치 ${catchCount}건 · 라이즌 ${risenCount}건`:catchCount?`캐치 고객 (${catchCount}건)`:risenCount?`라이즌 고객 (${risenCount}건)`:'예약 이력 없음'};
}

const settings=ui=>({query:'',selectedId:null,editor:null,draft:null,baseline:null,suspended:false,error:'',saving:false,...ui.customers});
const shortId=id=>String(id||'').slice(-6).toUpperCase();
const option=(value,label,current,escape)=>`<option value="${escape(value)}" ${String(current)===String(value)?'selected':''}>${escape(label)}</option>`;
const boolValue=value=>value===true?'true':value===false?'false':'';
const boolean=value=>value==='true'?true:value==='false'?false:null;
const rawOf=row=>row.raw||row.raw_data||{};
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?String(value).replaceAll('-','.'):value||'날짜 확인';
export const hasUnsavedCustomerDraft=ui=>{const value=settings(ui||{});return !!value.saving||!!value.draft&&!same(value.draft,value.baseline);};
export function suspendCustomerEditor(ui){const value=settings(ui||{});if(value.saving)return false;if(value.editor&&value.draft)ui.customers={...value,suspended:true};return true;}

function customerForm(draft,escape){
  return `<label class="field"><span class="field-label">고객명 · 입금자 <b>*</b></span><input name="customerName" required maxlength="120" autocomplete="name" value="${escape(draft.name)}" placeholder="예약 고객명 또는 입금자명"></label><div class="cd-section-heading"><div><h3>고객 연락처</h3><p>한 고객이 사용하는 번호를 함께 등록하세요.</p></div><button type="button" class="btn secondary small" data-customer-contact-add ${list(draft.contacts).length>=20?'disabled':''}>+ 연락처</button></div><div class="cd-contact-fields">${list(draft.contacts).map((contact,index)=>`<div class="cd-contact-row" data-customer-contact-row="${index}"><label class="field"><span class="field-label">구분</span><input name="contactLabel_${index}" maxlength="80" value="${escape(contact.label)}" placeholder="엄마 · 아빠 · 업무폰"></label><label class="field"><span class="field-label">전화번호</span><input name="contactPhone_${index}" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" value="${escape(formatTelephone(contact.phone))}" placeholder="010-1234-5678"></label><button type="button" class="icon-btn" data-customer-contact-remove="${index}" aria-label="연락처 ${index+1} 삭제">×</button></div>`).join('')||'<p class="cd-muted">연락처 없이 등록할 수 있습니다. 필요할 때 추가하세요.</p>'}</div><label class="field"><span class="field-label">상담 메모</span><textarea name="customerNotes" rows="4" maxlength="2000" placeholder="가족 구분, 연락 가능한 시간 등">${escape(draft.notes||'')}</textarea></label><p class="cd-footnote">이름이나 전화번호가 같은 다른 고객과 자동으로 합치지 않습니다.</p>`;
}
function teamForm(draft,state,escape){
  const customer=list(state.customers).find(row=>row.id===draft.customerId),defaults=draft.defaults||{},raw=defaults.raw||{};
  const phones=customerContactChoices(customer||{}),customerPhone=phones[0]?.phone||'',ownPhone=canonicalTelephone(draft.phone)||'',phoneMode=draft.teamPhoneMode||(ownPhone&&ownPhone!==customerPhone?'separate':'same'),band=CUSTOMER_AGE_BANDS.includes(defaults.ageBand)?defaults.ageBand:'';
  return `<div class="cd-team-owner"><span>예약 고객</span><strong>${escape(customer?.name||'고객 확인 필요')}</strong><small>고객번호 ${escape(shortId(draft.customerId))}</small></div><label class="field"><span class="field-label">강습생 · 팀 이름</span><input name="teamName" maxlength="120" value="${escape(draft.name)}" placeholder="예: 엄마, 아빠, 첫째, 막내"><span class="field-help">비워두면 이 고객의 기본 1팀으로 등록합니다.</span></label><fieldset class="cd-team-contact"><legend>팀 연락처</legend><div class="cd-choice-row"><label><input type="radio" name="teamPhoneMode" value="same" ${phoneMode==='same'?'checked':''}><span>고객 연락처와 동일</span></label><label><input type="radio" name="teamPhoneMode" value="separate" ${phoneMode==='separate'?'checked':''}><span>팀 연락처 별도</span></label></div><p class="cd-contact-inherit" data-cd-contact-inherit ${phoneMode==='same'?'':'hidden'}>${escape(formatTelephone(customerPhone)||'고객 연락처 미등록')}</p><label class="field" data-cd-team-phone ${phoneMode==='separate'?'':'hidden'}><span class="field-label">이 팀의 연락처</span><input name="teamPhone" type="tel" inputmode="tel" maxlength="30" value="${escape(formatTelephone(draft.phone))}" placeholder="이 팀 담당자의 전화번호" list="cd-customer-phone-options" ${phoneMode==='same'?'disabled':''}><datalist id="cd-customer-phone-options">${phones.map(contact=>`<option value="${escape(contact.formatted)}">${escape(contact.label)}</option>`).join('')}</datalist></label></fieldset><div class="cd-section-heading"><div><h3>다음 예약의 기본 강습 조건</h3><p>예약을 추가할 때 가져오며, 예약마다 수정할 수 있습니다.</p></div></div><div class="cd-form-grid"><label class="field"><span class="field-label">종목</span><select name="teamSport">${['스키','보드'].map(value=>option(value,value,defaults.sport||raw.D||'스키',escape)).join('')}</select></label><label class="field"><span class="field-label">강습인원수</span><input name="teamHeadcount" type="number" min="1" max="1000" value="${escape(raw.M||'1')}"></label>${renderTeamParticipants(draft,escape)}<label class="field"><span class="field-label">이전 강습 경험 · 회</span><input name="teamExperience" type="number" min="0" max="999" value="${escape(defaults.experienceCount??'')}" placeholder="미확인"></label><label class="field"><span class="field-label">스키 패러렐 롱턴</span><select name="teamParallel">${[['','미확인'],['true','가능'],['false','불가능']].map(([value,label])=>option(value,label,boolValue(defaults.parallelLongTurn),escape)).join('')}</select></label><label class="field"><span class="field-label">보드 S자 너비스턴</span><select name="teamSnowboard">${[['','미확인'],['true','가능'],['false','불가능']].map(([value,label])=>option(value,label,boolValue(defaults.snowboardNoviceTurn),escape)).join('')}</select></label><label class="field"><span class="field-label">강습시간</span><select name="teamDuration">${[['','미정'],['2시간','2시간'],['3시간','3시간'],['4시간','4시간']].map(([value,label])=>option(value,label,raw.N||'',escape)).join('')}</select></label><label class="field"><span class="field-label">관계</span><input name="teamRelation" maxlength="120" value="${escape(raw.K||'')}" placeholder="자녀 · 성인 · 가족"></label></div><label class="cd-junior-preparation"><input name="teamJuniorPreparation" type="checkbox" ${defaults.juniorPreparation===true?'checked':''}><span><strong>주니어 기술등급제 준비</strong><small>이 팀 예약에 기술등급제 준비 여부를 함께 표시합니다.</small></span></label><label class="field"><span class="field-label">수준 메모</span><input name="teamLevel" maxlength="200" value="${escape(raw.O||'')}" placeholder="이전 강습에서 확인한 수준"></label>`;
}
function renderEditor(value,state,escape,preview){
  if(!value.editor||!value.draft)return '';
  const customer=value.editor==='customer';
  if(value.suspended)return `<div class="cd-resume"><div><strong>작성 중인 ${customer?'고객':'팀'} 정보</strong><span>${escape(value.draft.name||'이름 미입력')} · 입력 내용이 보관되어 있습니다.</span></div><button type="button" class="btn secondary small" data-customer-resume>이어서 작성</button></div>`;
  return `<div class="cd-overlay" data-customer-backdrop><aside class="cd-drawer" role="dialog" aria-modal="true" aria-labelledby="customer-editor-title"><header><div><span class="cd-eyebrow">CUSTOMER FILE${preview?' · 체험':''}</span><h2 id="customer-editor-title">${customer?'고객':'팀'} ${value.draft.expectedUpdatedAt?'정보 수정':'등록'}</h2><p>${customer?'고객의 여러 연락처를 한곳에서 관리하세요.':'팀별 연락처와 강습 조건을 기억합니다.'}</p></div><button type="button" class="icon-btn" data-customer-close aria-label="작성 중인 고객 정보 접기">×</button></header><form class="cd-editor-form" novalidate><div class="cd-editor-body"><div class="cd-form-error" role="alert" ${value.error?'':'hidden'}>${escape(value.error)}</div>${customer?customerForm(value.draft,escape):teamForm(value.draft,state,escape)}${value.discardPrompt?'<div class="cd-discard"><p>작성한 내용을 비울까요? 저장된 고객과 예약은 유지됩니다.</p><button type="button" class="btn secondary small" data-customer-discard-cancel>계속 작성</button><button type="button" class="btn secondary small" data-customer-discard-confirm>작성 내용 비우기</button></div>':'<button type="button" class="btn ghost small" data-customer-discard>작성 내용 비우기</button>'}</div><footer><span>${preview?'체험 정보 · 서버에 저장되지 않습니다.':'기존 예약 내용은 그대로 유지됩니다.'}</span><div><button type="button" class="btn secondary" data-customer-close>접어두기</button><button type="submit" class="btn primary">${customer?'고객':'팀'} 저장</button></div></footer></form></aside></div>`;
}

function renderHistory(customer,state,escape){
  const rows=customerDirectoryReservations(customer.id,state),roster=new Map(list(state.roster).map(person=>[person.user_id,person.display_name]));
  // 2026-11-15: 이력 표에서 강습료·입금액·장비결제를 바로 수정한다. 요청액·미수는 자동.
  const won=value=>Number.isFinite(value)?value.toLocaleString('ko-KR'):'—';
  const amountCell=row=>{
    const raw=rawOf(row);
    const status=['free','paid','onsite_unpaid'].includes(row.rental_payment_status??row.rentalPaymentStatus)?(row.rental_payment_status??row.rentalPaymentStatus):'';
    const hours=[4,6].includes(Number(row.rental_hours??row.rentalHours))?Number(row.rental_hours??row.rentalHours):'';
    const rentalAmount=status==='free'?0:Number.isFinite(Number(row.rental_amount??row.rentalAmount))&&(row.rental_amount??row.rentalAmount)!==null?Number(row.rental_amount??row.rentalAmount):null;
    const t=Number(String(raw.T||'').replace(/[^0-9]/g,''))||0,y=Number(String(raw.Y||'').replace(/[^0-9]/g,''))||0;
    const requested=t+(['paid','onsite_unpaid'].includes(status)&&rentalAmount!==null?rentalAmount:0);
    return {raw,status,hours,requested,due:requested-y};
  };
  return `<section class="cd-history"><div class="cd-section-heading"><div><h3>이 고객의 예약 이력 <small>${rows.length}건</small></h3><p>강습료·입금액·장비결제는 표에서 바로 수정할 수 있습니다. 저장하면 변경 이력에 남습니다.</p></div></div>${rows.length?`<div class="cd-history-scroll" tabindex="0" role="region" aria-label="고객의 팀별 예약 이력"><table><thead><tr><th>날짜 · 시간</th><th>팀 · 회차</th><th>담당 강사</th><th>강습료</th><th>입금액</th><th>장비결제</th><th>요청 · 미수</th><th></th></tr></thead><tbody>${rows.slice(0,100).map(row=>{const cell=amountCell(row),raw=cell.raw,ids=row.instructorIds||row.instructor_user_ids||row.instructor_ids||[],names=ids.map(id=>roster.get(id)).filter(Boolean);const company=String(raw.E||'');const rowTint=cell.due>0&&(Number(String(raw.T||'').replace(/[^0-9]/g,''))||0)>0?'cd-row-due':company.includes('캐치')?'cd-co-catch':company.includes('라이즌')?'cd-co-risen':'';return `<tr data-cd-row="${escape(row.id)}" class="${rowTint}"><td>${escape(dateLabel(raw.A))}<small>${escape(raw.B||'')}–${escape(raw.C||'')}</small></td><td>${escape(raw.I||'기본 1팀')}<small>${escape(raw.J||'회차 미입력')} · ${escape(raw.D||'')}</small></td><td>${escape(names.join(' · ')||raw.F||'미배정')}</td><td class="cd-amt"><input data-cd-t value="${escape(raw.T||'')}" inputmode="numeric" maxlength="9" aria-label="강습료"></td><td class="cd-amt"><input data-cd-y value="${escape(raw.Y||'')}" inputmode="numeric" maxlength="9" aria-label="입금액"></td><td class="cd-rental"><select data-cd-rs aria-label="장비결제 상태"><option value="" ${cell.status===''?'selected':''}>미선택</option><option value="onsite_unpaid" ${cell.status==='onsite_unpaid'?'selected':''}>미결제</option><option value="free" ${cell.status==='free'?'selected':''}>무료</option><option value="paid" ${cell.status==='paid'?'selected':''}>결제완료</option></select><select data-cd-rh aria-label="장비 이용시간" ${cell.status==='paid'||cell.status==='onsite_unpaid'?'':'hidden'}><option value="" ${cell.hours===''?'selected':''}>시간 미정</option><option value="4" ${cell.hours===4?'selected':''}>4시간</option><option value="6" ${cell.hours===6?'selected':''}>6시간</option></select></td><td class="cd-due" data-cd-due>${won(cell.requested)}<small data-cd-due-note class="${cell.due>0?'is-due':''}">${cell.due>0?`미수 ${won(cell.due)}`:'완납'}</small></td><td class="cd-save"><button type="button" class="btn secondary small" data-cd-amt-save="${escape(row.id)}" disabled>저장</button><small data-cd-amt-note role="status"></small></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="cd-empty compact">아직 연결된 예약이 없습니다. 팀을 선택해 첫 예약을 추가하세요.</div>'}</section>`;
}
// 이 고객의 수강권 보유 현황(2026-11-20 사용자 지시): 몇 장을 어떤 구성으로 갖고 있는지
// 예약 이력과 나란히 보여주고, [변경]으로 시간권 수정·삭제 창을 바로 연다.
function renderCustomerPasses(customer,state,escape){
  const passes=selectPassBalances(state).filter(pass=>(pass.customer_id??pass.customerId)===customer.id);
  const issuedDate=value=>value&&Number.isFinite(Date.parse(value))?dateLabel(String(value).slice(0,10)):'—';
  return `<div class="cd-section-heading"><div><h3>수강권 <small>${passes.length}장</small></h3><p>시간권 변경·삭제는 [변경]에서, 일정 등록은 예약표의 수강권 블록에서 합니다.</p></div></div>${passes.length?`<div class="cd-pass-list">${passes.map(pass=>`<article class="cd-pass-card" data-cd-pass="${escape(pass.id)}"><header><div><h4>${escape(pass.learnerName||'기본 팀')}</h4><span>${escape(pass.sport||'종목 확인')} · ${pass.lessonMinutes===240?'4시간권':pass.lessonMinutes===120?'2시간권':'시간권 미정'} · ${pass.total===null?'횟수 미정':`총 ${pass.total}회`}</span></div><button type="button" class="btn ghost small" data-cd-pass-edit="${escape(pass.id)}" ${pass.id?'':'disabled'}>변경</button></header><p class="cd-pass-counts">강습완료 ${pass.completed}회 · 예약·진행중 ${pass.pending}회 · <strong class="${pass.available===0?'used':''}">미예약 잔여 ${pass.available===null?'—':`${pass.available}회`}</strong></p><small>발급 ${escape(issuedDate(pass.created_at||pass.createdAt))} · ${escape(pass.instructorName||'강사 미정')}</small></article>`).join('')}</div>`:'<div class="cd-empty compact">발급된 수강권이 없습니다. 예약표의 수강권 블록에서 발급합니다.</div>'}`;
}
function renderDeleteConfirmation(customer,state,value,escape){
  if(value.deleteTarget?.payload?.id!==customer.id)return '';
  const target=value.deleteTarget,usage=customerDeletionUsage(customer.id,state);
  return `<section class="cd-delete-confirmation" aria-label="고객 삭제 확인"><h3>${escape(target.name)} 고객을 목록에서 삭제할까요?</h3><p>고객번호 #${escape(shortId(customer.id))} · 이 고객과 소속 팀 ${target.payload.expectedTeams.length}개를 고객 목록과 새 예약의 고객 선택에서 제외합니다.</p><p>기존 예약·수강권·시즌권·입금 검토·고객 안내와 문자·통화 원문은 그대로 유지됩니다. 이력 연결을 위해 고객 연락처·메모와 팀 정보도 보관합니다.</p>${usage.length?`<p class="cd-footnote">유지되는 연결 기록: ${usage.map(row=>`${escape(row.label)} ${row.count}건`).join(' · ')}. 연결 기록이 있어도 목록에서 삭제할 수 있습니다.</p>`:''}<p class="cd-form-error" data-customer-delete-error role="alert" ${value.deleteError?'':'hidden'}>${escape(value.deleteError||'')}</p><div class="cd-delete-actions"><button type="button" class="btn secondary" data-customer-delete-cancel ${value.saving?'disabled':''}>취소</button><button type="button" class="btn secondary cd-delete-button" data-customer-delete-confirm ${value.saving?'disabled':''}>${value.saving?'삭제 중…':'목록에서 삭제'}</button></div></section>`;
}
function renderDetail(customer,state,escape,value,ui){
  if(!customer)return '<section class="panel cd-detail cd-empty"><strong>고객을 선택해 주세요.</strong><p>연락처와 팀별 예약 이력을 확인하고 다음 강습을 추가할 수 있습니다.</p></section>';
  const teams=customerDirectoryTeams(customer.id,state),contacts=customerContactChoices(customer,teams);
  return `<section class="panel cd-detail" data-customer-detail="${escape(customer.id)}"><div class="cd-detail-heading"><div><span class="cd-eyebrow">고객번호 ${escape(shortId(customer.id))}</span><h2>${escape(customer.name)}</h2><div class="cd-brand-line">${(()=>{const finance=customerFinanceBrand(customer.id,state);return `${finance.catchCount?`<span class="cd-brand-chip cd-chip-catch">캐치 ${finance.catchCount}건</span>`:''}${finance.risenCount?`<span class="cd-brand-chip cd-chip-risen">라이즌 ${finance.risenCount}건</span>`:''}${finance.due>0?`<span class="cd-brand-chip cd-chip-due">미수 ${finance.due.toLocaleString('ko-KR')}원</span>`:finance.brands.length?'<span class="cd-brand-chip">완납</span>':''}`;})()}</div></div><div class="cd-detail-actions"><button type="button" class="btn secondary small" data-customer-edit="${escape(customer.id)}">고객 정보 수정</button>${canDeleteCustomer(state,ui)?`<button type="button" class="btn secondary small cd-delete-button" data-customer-delete="${escape(customer.id)}">고객 삭제</button>`:''}</div></div>${value.deleteError&&!value.deleteTarget?`<p class="cd-form-error" role="alert">${escape(value.deleteError)}</p>`:''}${canDeleteCustomer(state,ui)?renderDeleteConfirmation(customer,state,value,escape):''}<div class="cd-contact-list">${contacts.map(contact=>`<div><span>${escape(contact.label)}</span><strong>${escape(contact.formatted)}</strong></div>`).join('')||'<p class="cd-muted">등록된 연락처가 없습니다.</p>'}</div>${customer.notes?`<div class="cd-notes">${escape(customer.notes)}</div>`:''}<div class="cd-section-heading"><div><h3>강습생 · 팀 <small>${teams.length}팀</small></h3><p>같은 고객의 다른 팀과 강습 기록을 구분합니다.</p></div><button type="button" class="btn secondary small" data-customer-team-new="${escape(customer.id)}">+ 팀 추가</button></div><div class="cd-team-grid">${teams.map(team=>{const rows=customerDirectoryReservations(customer.id,state,team.id);return `<article data-customer-team-card="${escape(team.id)}"><header><div><h4>${escape(team.name||'기본 1팀')}</h4><span>${escape(team.defaults?.sport||team.defaults?.raw?.D||'종목 미정')} · 등록 예약 ${rows.length}건</span></div><button type="button" class="btn ghost small" data-customer-team-edit="${escape(team.id)}">수정</button></header><div class="cd-team-preparation"><span>${escape(customerTeamAgeLabel(team.defaults))}</span>${team.defaults?.juniorPreparation===true?'<strong>주니어 기술등급제 준비</strong>':''}</div><p>${escape(formatTelephone(team.phone)||'고객 연락처와 동일')}</p><button type="button" class="btn primary small" data-customer-book="${escape(customer.id)}" data-customer-book-team="${escape(team.id)}">이 팀 예약 추가 →</button></article>`;}).join('')||'<div class="cd-empty compact">팀을 등록하면 다음 예약에서 다시 입력할 필요가 없습니다.</div>'}</div>${!teams.length?`<button type="button" class="btn secondary cd-first-book" data-customer-book="${escape(customer.id)}">이 고객 새 예약 접수 →</button>`:''}${renderCustomerPasses(customer,state,escape)}${renderHistory(customer,state,escape)}</section>`;
}

export function renderCustomers({state={},ui={},escapeHTML=escapeFallback}={}){
  const value=settings(ui),escape=escapeHTML,preview=ui.booking?.demo!==false;
  const query=text(value.query).normalize('NFKC'),phoneMatches=new Set(searchCustomerCandidates(query,state,{limit:50}).map(row=>row.customerId));
  const activeCustomers=list(state.customers).filter(customer=>!isDeletedCustomer(customer));
  const rows=activeCustomers.filter(customer=>!query||`${customer.name} ${customer.notes||''} ${customerContactChoices(customer,customerDirectoryTeams(customer.id,state)).map(row=>`${row.phone} ${row.formatted} ${row.label}`).join(' ')} ${customerDirectoryTeams(customer.id,state).map(team=>team.name).join(' ')}`.normalize('NFKC').toLowerCase().includes(query.toLowerCase())||phoneMatches.has(customer.id));
  const selected=activeCustomers.find(customer=>customer.id===value.selectedId)||null;
  return `<section class="customer-page" aria-label="고객 관리"><div class="cd-heading"><div><span class="cd-eyebrow">CUSTOMER DIRECTORY</span><h1>고객 · 팀</h1><p>연락처는 여러 개여도 고객은 하나로. 팀별 기록을 이어서 예약하세요.</p></div><button type="button" class="btn primary" data-customer-new>+ 고객 등록</button></div>${renderEditor(value,state,escape,preview)}<div class="cd-mode-note"><span>${preview?'체험 고객':'운영 고객'}</span><p>동명이인은 각각 관리합니다. 전화번호가 비슷해도 직접 선택한 고객에만 연결됩니다.</p></div><div class="cd-workspace"><section class="panel cd-directory"><form class="cd-search-form"><label><span>고객 · 팀 · 연락처 찾기</span><div><input name="customerQuery" type="search" value="${escape(value.query)}" placeholder="이름 또는 전화번호 일부" autocomplete="off"><button type="submit" class="btn secondary small">검색</button></div></label></form><div class="cd-directory-count">${rows.length}명 <span>전체 ${activeCustomers.length}명</span></div><div class="cd-customer-list">${rows.slice(0,200).map(customer=>{const teams=customerDirectoryTeams(customer.id,state),phones=customerContactChoices(customer,teams),bookings=customerDirectoryReservations(customer.id,state);const finance=customerFinanceBrand(customer.id,state);return `<button type="button" class="cd-customer-row ${finance.brandClass} ${selected?.id===customer.id?'selected':''}" data-customer-select="${escape(customer.id)}" aria-pressed="${selected?.id===customer.id}"><span class="cd-avatar">${escape(String(customer.name||'?').slice(-2))}</span><span><strong>${escape(customer.name)}${finance.catchCount?'<i class="cd-dot cd-dot-catch" title="캐치"></i>':''}${finance.risenCount?'<i class="cd-dot cd-dot-risen" title="라이즌"></i>':''}</strong><small>${escape(phones[0]?.formatted||'연락처 미등록')}${phones.length>1?` 외 ${phones.length-1}개`:''}</small><small>${teams.length}팀 · 등록 예약 ${bookings.length}건${finance.due>0?` · <em class="cd-due-badge">미수 ${finance.due.toLocaleString('ko-KR')}원</em>`:''}</small></span><span class="cd-customer-code">#${escape(shortId(customer.id))}</span></button>`;}).join('')||`<div class="cd-empty compact"><strong>${query?'일치하는 고객이 없습니다.':'아직 등록한 고객이 없습니다.'}</strong><p>${query?'검색어를 바꾸거나 새로운 고객으로 등록하세요.':'고객을 등록하면 여러 연락처와 팀을 함께 관리할 수 있습니다.'}</p></div>`}</div></section>${renderDetail(selected,state,escape,value,ui)}</div></section>`;
}

function renderTeamParticipantRows(draft,escape){return resizeParticipants(draft.defaults?.participants,Number(draft.defaults?.raw?.M||1)).map((person,index)=>`<fieldset class="cd-participant-row"><legend>강습생 ${index+1}</legend><label class="field"><span class="field-label">성인·미성년 *</span><select name="teamParticipant_${index}_type" required>${[['','선택해 주세요'],['adult','성인'],['minor','미성년']].map(([value,label])=>option(value,label,person.type,escape)).join('')}</select></label><label class="field" data-cd-participant-age ${person.type==='minor'?'':'hidden'}><span class="field-label">나이 *</span><input name="teamParticipant_${index}_age" type="number" inputmode="numeric" min="1" max="19" step="1" value="${escape(person.age??'')}" placeholder="직접 입력" ${person.type==='minor'?'required':'disabled'}></label></fieldset>`).join('');}
function renderTeamParticipants(draft,escape){return `<div class="cd-participants" data-cd-participants><strong>강습생별 정보</strong><p>미성년자는 나이를 직접 입력해 주세요.</p><div data-cd-participant-rows>${renderTeamParticipantRows(draft,escape)}</div></div>`;}
function formDraft(form,value){
  const draft=clone(value.draft),get=name=>String(form.elements.namedItem(name)?.value??'');
  if(value.editor==='customer')return {...draft,name:get('customerName'),notes:get('customerNotes'),contacts:list(draft.contacts).map((_,index)=>({label:get(`contactLabel_${index}`),phone:get(`contactPhone_${index}`)}))};
  const sport=get('teamSport'),ageBand=(form.elements.namedItem('teamAgeBand')?get('teamAgeBand'):draft.defaults?.ageBand)||null,teamPhoneMode=get('teamPhoneMode')||draft.teamPhoneMode||'same';
  return {...draft,name:get('teamName'),teamPhoneMode,phone:teamPhoneMode==='same'?'':get('teamPhone'),defaults:{...(draft.defaults||{}),sport,age:form.elements.namedItem('teamAge')?(ageBand?null:get('teamAge')===''?null:Number(get('teamAge'))):draft.defaults?.age??null,ageBand,...(form.elements.namedItem('teamParticipant_0_type')?{participants:resizeParticipants(draft.defaults?.participants,Number(get('teamHeadcount'))).map((person,index)=>{const type=form.elements.namedItem(`teamParticipant_${index}_type`)?get(`teamParticipant_${index}_type`):person.type;return{type,age:type==='adult'?null:form.elements.namedItem(`teamParticipant_${index}_age`)?get(`teamParticipant_${index}_age`)===''?null:Number(get(`teamParticipant_${index}_age`)):person.age};})}:{}),juniorPreparation:form.elements.namedItem('teamJuniorPreparation')?.checked===true,experienceCount:get('teamExperience')===''?null:Number(get('teamExperience')),parallelLongTurn:boolean(get('teamParallel')),snowboardNoviceTurn:boolean(get('teamSnowboard')),raw:{...(draft.defaults?.raw||{}),D:sport,M:get('teamHeadcount'),N:get('teamDuration'),K:get('teamRelation'),O:get('teamLevel')}}};
}

export function bindCustomers(root,{state={},ui={},onChange,onSaveCustomer,onSaveTeam,onDeleteCustomer,onNewReservation,onQuickAmounts}={}){
  const view=root.querySelector('.customer-page');if(!view)return;
  const update=changes=>{ui.customers={...settings(ui),...changes};onChange?.(ui.customers);};
  const busy=()=>settings(ui).saving;
  // 수강권 [변경](2026-11-20): 수강권 블록과 같은 변경·삭제 창을 이 탭에서 연다(ui.passes 상태 공유).
  view.querySelectorAll('[data-cd-pass-edit]').forEach(button=>button.addEventListener('click',()=>{
    if(busy()||button.disabled)return;
    const pass=selectPassBalances(state).find(row=>row.id===button.dataset.cdPassEdit);
    if(!pass)return;
    ui.passes={...(ui.passes||{}),editRequest:{id:pass.id,lessonMinutes:pass.lessonMinutes||120,error:'',saving:false},deleteRequest:null};
    onChange?.(ui.customers);
  }));
  // 이력 표 금액 빠른 수정 (2026-11-15): 입력이 바뀌면 요청·미수 미리보기 + 저장 활성화.
  view.querySelectorAll('[data-cd-row]').forEach(tr=>{
    const id=tr.dataset.cdRow;
    const t=tr.querySelector('[data-cd-t]'),y=tr.querySelector('[data-cd-y]'),rs=tr.querySelector('[data-cd-rs]'),rh=tr.querySelector('[data-cd-rh]');
    const save=tr.querySelector('[data-cd-amt-save]'),note=tr.querySelector('[data-cd-amt-note]'),due=tr.querySelector('[data-cd-due]');
    if(!t||!y||!rs||!save)return;
    const won=value=>Number.isFinite(value)?value.toLocaleString('ko-KR'):'—';
    const per=hours=>Number(hours)===4?13000:Number(hours)===6?18000:null;
    const headcount=()=>{const row=(state.reservations||[]).find(item=>item.id===id);const m=Number(String((row?.raw||row?.raw_data||{}).M||'').replace(/[^0-9]/g,''));return m>=1?m:1;};
    const refresh=()=>{
      const status=rs.value;if(rh)rh.hidden=!(status==='paid'||status==='onsite_unpaid');
      const lesson=Number(String(t.value||'').replace(/[^0-9]/g,''))||0;
      const paid=Number(String(y.value||'').replace(/[^0-9]/g,''))||0;
      const rent=status==='free'?0:(status==='paid'||status==='onsite_unpaid')&&per(rh?.value)!==null?per(rh.value)*headcount():0;
      const requested=lesson+rent,gap=requested-paid;
      if(due)due.innerHTML=`${won(requested)}<small data-cd-due-note class="${gap>0?'is-due':''}">${gap>0?`미수 ${won(gap)}`:'완납'}</small>`;
      save.disabled=false;if(note)note.textContent='';
    };
    for(const field of [t,y,rs,rh])field?.addEventListener('input',refresh),field?.addEventListener('change',refresh);
    save.addEventListener('click',async()=>{
      if(busy()||typeof onQuickAmounts!=='function')return;
      save.disabled=true;const prior=save.textContent;save.textContent='저장 중…';if(note)note.textContent='';
      try{
        await onQuickAmounts(id,{lessonFee:String(t.value||'').replace(/[^0-9]/g,''),paidAmount:String(y.value||'').replace(/[^0-9]/g,''),rentalPaymentStatus:rs.value||null,rentalHours:rh&&rh.value?Number(rh.value):null});
        save.textContent='저장됨';if(note)note.textContent='변경 이력에 기록되었습니다.';
      }catch(error){
        save.disabled=false;save.textContent=prior;
        if(note){note.textContent=error?.message||'저장하지 못했습니다.';note.classList.add('is-error');}
      }
    });
  });
  const begin=(editor,draft)=>{if(busy())return;const previous=settings(ui);if(previous.draft&&!same(previous.draft,previous.baseline)){update({suspended:false,error:'작성 중인 정보를 저장하거나 비운 뒤 다른 정보를 여세요.'});return;}update({editor,draft,baseline:clone(draft),suspended:false,error:'',discardPrompt:false,deleteTarget:null,deleteError:''});};
  const editCustomer=id=>{const row=list(state.customers).find(item=>item.id===id);if(row)begin('customer',{id:row.id,name:row.name,contacts:clone(row.contacts||[]),notes:row.notes||'',expectedUpdatedAt:row.updated_at||row.updatedAt||null});};
  const editTeam=id=>{const row=list(state.customerTeams).find(item=>item.id===id);if(!row)return;const customer=list(state.customers).find(item=>item.id===(row.customer_id||row.customerId)),customerPhone=customerContactChoices(customer||{})[0]?.phone||'',phone=canonicalTelephone(row.phone)||'';begin('team',{id:row.id,customerId:row.customer_id||row.customerId,name:row.name||'',phone:row.phone||'',teamPhoneMode:phone&&phone!==customerPhone?'separate':'same',defaults:clone(row.defaults||{}),expectedUpdatedAt:row.updated_at||row.updatedAt||null});};
  view.querySelectorAll('[data-customer-new]').forEach(button=>button.onclick=()=>begin('customer',createCustomerDirectoryDraft()));
  view.querySelectorAll('[data-customer-edit]').forEach(button=>button.onclick=()=>editCustomer(button.dataset.customerEdit));
  view.querySelectorAll('[data-customer-team-new]').forEach(button=>button.onclick=()=>begin('team',createCustomerTeamDraft(button.dataset.customerTeamNew)));
  view.querySelectorAll('[data-customer-team-edit]').forEach(button=>button.onclick=()=>editTeam(button.dataset.customerTeamEdit));
  view.querySelectorAll('[data-customer-select]').forEach(button=>button.onclick=()=>{if(!busy())update({selectedId:button.dataset.customerSelect,deleteTarget:null,deleteError:''});});
  view.querySelectorAll('[data-customer-book]').forEach(button=>button.onclick=()=>{if(busy())return;if(hasUnsavedCustomerDraft(ui)){update({suspended:false,error:'작성 중인 고객·팀 정보를 저장한 뒤 예약을 추가해 주세요.'});return;}onNewReservation?.({customerId:button.dataset.customerBook,customerTeamId:button.dataset.customerBookTeam||null});});
  view.querySelectorAll('[data-customer-delete]').forEach(button=>button.onclick=()=>{
    if(busy()||!canDeleteCustomer(state,ui))return;
    if(hasUnsavedCustomerDraft(ui)){update({suspended:false,error:'작성 중인 고객·팀 정보를 저장하거나 비운 뒤 삭제해 주세요.'});return;}
    const customer=list(state.customers).find(row=>row.id===button.dataset.customerDelete);if(!customer||isDeletedCustomer(customer))return;
    try{update({editor:null,draft:null,baseline:null,suspended:false,error:'',deleteTarget:{name:customer.name,payload:customerDeletionPayload(customer,state)},deleteError:''});}
    catch(error){update({deleteError:error.message});}
  });
  view.querySelector('[data-customer-delete-cancel]')?.addEventListener('click',()=>{if(!busy())update({deleteTarget:null,deleteError:''});});
  view.querySelector('[data-customer-delete-confirm]')?.addEventListener('click',async()=>{
    const target=settings(ui).deleteTarget;if(busy()||!target||!canDeleteCustomer(state,ui))return;
    const box=view.querySelector('[data-customer-delete-error]');
    const report=message=>{if(box){box.textContent=message;box.hidden=false;}ui.customers={...settings(ui),deleteError:message};};
    if(typeof onDeleteCustomer!=='function'){report('고객 삭제 연결을 확인해 주세요.');return;}
    const token={};ui.customers={...settings(ui),saving:true,writeToken:token,deleteError:''};if(box)box.hidden=true;
    const controls=[...view.querySelectorAll('button,input,select,textarea')],disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
    try{
      const result=await onDeleteCustomer(clone(target.payload));
      if(result?.discarded||ui.customers?.writeToken!==token||!view.isConnected)return;
      if(!customerDeletionConfirmed(result,target.payload.id))throw Error('고객 삭제 완료를 확인하지 못했습니다. 다시 시도해 주세요.');
      update({selectedId:null,deleteTarget:null,deleteError:'',editor:null,draft:null,baseline:null,error:'',saving:false,writeToken:null});
    }catch(error){if(ui.customers?.writeToken===token&&view.isConnected)report(error?.message||'고객을 삭제하지 못했습니다. 다시 시도해 주세요.');}
    finally{if(ui.customers?.writeToken===token)ui.customers={...settings(ui),saving:false,writeToken:null};controls.forEach((control,index)=>{if(control.isConnected)control.disabled=disabled[index];});}
  });
  view.querySelector('.cd-search-form')?.addEventListener('submit',event=>{event.preventDefault();if(!busy())update({query:String(new FormData(event.currentTarget).get('customerQuery')||'')});});
  view.querySelector('[data-customer-resume]')?.addEventListener('click',()=>update({suspended:false}));
  const form=view.querySelector('.cd-editor-form');if(!form)return;
  const remember=()=>{if(busy())return;ui.customers={...settings(ui),draft:formDraft(form,settings(ui))};};
  const close=()=>{if(busy())return;remember();update({suspended:true,discardPrompt:false});};
  const synchronizeTeamFields=()=>{
    if(settings(ui).editor!=='team')return;
    for(const [index]of resizeParticipants(settings(ui).draft?.defaults?.participants,Number(form.elements.namedItem('teamHeadcount')?.value||1)).entries()){const type=form.elements.namedItem(`teamParticipant_${index}_type`),age=form.elements.namedItem(`teamParticipant_${index}_age`),label=age?.closest?.('[data-cd-participant-age]');if(label)label.hidden=type?.value!=='minor';if(age){age.disabled=type?.value!=='minor';age.required=type?.value==='minor';}}
    const band=String(form.elements.namedItem('teamAgeBand')?.value||''),exact=form.querySelector('[data-cd-exact-age]'),number=form.elements.namedItem('teamAge'),note=form.querySelector('[data-cd-age-band-note]');
    if(exact)exact.hidden=!!band;if(number)number.disabled=!!band;if(note){note.hidden=!band;note.textContent=band?`${band.slice(0,2)}대로 등록합니다.`:'';}
    const separate=form.elements.namedItem('teamPhoneMode')?.value==='separate',phoneField=form.querySelector('[data-cd-team-phone]'),phone=form.elements.namedItem('teamPhone'),inherit=form.querySelector('[data-cd-contact-inherit]');
    if(phoneField)phoneField.hidden=!separate;if(phone)phone.disabled=!separate;if(inherit)inherit.hidden=separate;
  };
  for(const type of ['input','change'])form.addEventListener(type,event=>{if(event.target.name==='teamHeadcount'){remember();const target=form.querySelector('[data-cd-participant-rows]');if(target)target.innerHTML=renderTeamParticipantRows(settings(ui).draft,escapeFallback);}synchronizeTeamFields();remember();});
  view.querySelectorAll('[data-customer-close]').forEach(button=>button.onclick=close);
  view.querySelector('[data-customer-backdrop]')?.addEventListener('click',event=>{if(event.target===event.currentTarget)close();});
  view.querySelector('[data-customer-contact-add]')?.addEventListener('click',()=>{if(busy())return;remember();const value=settings(ui);if(value.draft.contacts.length>=20)return;value.draft.contacts.push({label:'',phone:''});update({draft:value.draft});});
  view.querySelectorAll('[data-customer-contact-remove]').forEach(button=>button.onclick=()=>{if(busy())return;remember();const value=settings(ui);value.draft.contacts.splice(Number(button.dataset.customerContactRemove),1);update({draft:value.draft});});
  view.querySelector('[data-customer-discard]')?.addEventListener('click',()=>{remember();update({discardPrompt:true});});
  view.querySelector('[data-customer-discard-cancel]')?.addEventListener('click',()=>update({discardPrompt:false}));
  view.querySelector('[data-customer-discard-confirm]')?.addEventListener('click',()=>{if(!busy())update({editor:null,draft:null,baseline:null,error:'',suspended:false,discardPrompt:false});});
  form.querySelectorAll('input[type="tel"]').forEach(input=>input.addEventListener('blur',()=>{if(canonicalTelephone(input.value))input.value=formatTelephone(input.value);remember();}));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy())return;remember();const value=settings(ui),kind=value.editor,box=form.querySelector('.cd-form-error');
    const report=message=>{box.textContent=message;box.hidden=false;ui.customers={...settings(ui),error:message};box.scrollIntoView?.({block:'nearest'});};
    let payload;try{payload=kind==='customer'?customerDirectoryPayload(value.draft):customerTeamPayload(value.draft);}catch(error){report(error.message);return;}
    const save=kind==='customer'?onSaveCustomer:onSaveTeam;if(typeof save!=='function'){report('고객 정보 저장 연결을 확인해 주세요.');return;}
    const token={};ui.customers={...value,saving:true,writeToken:token,error:''};box.hidden=true;
    const controls=[...view.querySelectorAll('button,input,select,textarea')],disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
    try{
      const result=await save(payload);
      if(result?.discarded||ui.customers?.writeToken!==token||!view.isConnected)return;
      const saved=result?.[kind==='customer'?'customer':'team']||result;
      if(!saved?.id)throw new Error('저장된 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
      update({selectedId:kind==='customer'?saved.id:payload.customerId,editor:null,draft:null,baseline:null,suspended:false,error:'',saving:false,writeToken:null});
    }catch(error){if(ui.customers?.writeToken===token&&form.isConnected){report(error?.message||'고객 정보를 저장하지 못했습니다. 다시 시도해 주세요.');}}
    finally{if(ui.customers?.writeToken===token)ui.customers={...settings(ui),saving:false,writeToken:null};controls.forEach((control,index)=>{if(control.isConnected)control.disabled=disabled[index];});}
  });
  view.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const drawer=view.querySelector('.cd-drawer'),controls=[...drawer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(control=>control.getClientRects().length);
    if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
  });
  if(!view.querySelector('.cd-drawer')?.contains(document.activeElement))form.querySelector('input')?.focus({preventScroll:true});
}
