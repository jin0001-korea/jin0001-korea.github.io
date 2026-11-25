const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const rows = value => Array.isArray(value) ? value : [];
const KINDS = [
  {id:'payment_adjustment', title:'입금 요청 정정·추가입금 안내', description:'등록한 정정 총액·기입금액·추가 미수와 사유를 안내합니다. 승인 템플릿 설정 전에는 발송 대기로 보관합니다.'},
  {id:'lesson_reminder', title:'곤지암 강습 전날 안내', description:'곤지암 강습 전날 오후 6시부터 강사·집결 장소·렌탈·픽업 안내를 한 번 발송합니다.'},
  {id:'instructor_assignment', title:'프리랜서 강사 배정 안내', description:'프리랜서 강사가 강습에 배정되면 강사 본인에게 일정확인 링크를 알림톡으로 보냅니다. 발신은 코코넛렌탈샵 채널을 사용합니다.'},
  {id:'balance_due', title:'미수금 안내 (강습 2주 전)', description:'강습 시작 14일 전 오전 10시부터 미수금이 있는 예약에 금액과 카카오채널 결제 문의 방법을 한 번 안내합니다. 발송 시점에 미수가 해소되면 보내지 않습니다.'},
  {id:'reservation', title:'예약 접수 안내', description:'접수한 강습 일정과 예약 확인 링크를 안내합니다.'},
  {id:'pass', title:'수강권 등록 안내', description:'보유 횟수와 수강권 상태 확인 링크를 안내합니다.'},
  {id:'schedule_result', title:'일정 요청 처리 결과', description:'예약 변경·수강권 일정 신청의 승인 또는 반려 결과와 확인 링크를 안내합니다.'},
  {id:'report', title:'사진·영상 및 만족도 안내', description:'카페 보고서와 만족도 조사 링크를 함께 안내합니다.'},
];
const COMPANIES = [
  {company:'캐치', publicUrl:'https://pf.kakao.com/_aiQuG'},
  {company:'라이즌', publicUrl:'https://pf.kakao.com/_JxabMG'},
  {company:'코코넛렌탈샵', publicUrl:'https://pf.kakao.com/_mkzYn'},
];
const safeExternal = (value, host) => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};
const apiHelpUrl = value => safeExternal(value,'console.solapi.com') || safeExternal(value,'solapi.com');
const templateId = row => String(row?.templateId || '');
const channelId = row => String(row?.channelId || '');
const selectedCompany = (state, company = state.company) => rows(state.status?.companies).find(row => row.company === company) || {};
const savedTemplate = (state, kind) => rows(state.status?.selections).find(row => row.company === state.company && row.kind === kind);
const statusLabel = value => ({APPROVED:'승인 완료',INSPECTING:'검수 중',PENDING:'검수 대기',REJECTED:'반려',REGISTERED:'등록됨',DRAFT:'작성됨',REVIEWING:'검수 중',DELETED:'삭제됨'})[value] || value || '상태 확인 필요';
const statusClass = value => value === 'APPROVED' ? 'good' : value === 'REJECTED' ? 'attention' : '';
const categoryOptions = (categories, selected) => `<option value="">분류 선택</option>${rows(categories).map(row => `<option value="${esc(row.code)}" ${row.code === selected ? 'selected' : ''}>${esc(row.name || row.code)}</option>`).join('')}`;
function displayError(error, credentials = false) {
  // Fixed messages avoid reflecting API keys or raw provider/database text.
  const messages={
    unauthorized:'관리자 로그인이 만료되었습니다. 다시 로그인한 뒤 연결해 주세요.',
    admin_required:'비밀번호 설정을 마친 활성 관리자 계정으로 로그인해 주세요.',
    invalid_credentials:'API Key와 API Secret 형식을 확인해 주세요. 솔라피 로그인 아이디·비밀번호가 아닌 API 연동 키를 입력해야 합니다.',
    provider_invalid_key:'솔라피에서 API Key를 찾을 수 없습니다. 발급한 API Key를 확인해 주세요.',
    provider_signature_mismatch:'솔라피 인증 서명이 일치하지 않습니다. 같은 쌍으로 발급된 API Key와 API Secret인지 확인해 주세요.',
    provider_clock_skew:'연동 서버의 시간 차이로 솔라피 인증이 실패했습니다. 관리자에게 연결 점검을 요청해 주세요.',
    provider_duplicate_signature:'솔라피 인증 요청이 중복되었습니다. 잠시 후 다시 연결해 주세요.',
    provider_authorization:'솔라피 API 사용 권한과 본인인증·계정 상태를 확인해 주세요.',
    provider_limit:'솔라피 요청이 많습니다. 잠시 후 다시 연결해 주세요.',
    provider_unavailable:'솔라피 서버에 연결하지 못했습니다. 잠시 후 다시 연결해 주세요.',
    provider_response:'솔라피 응답을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.',
    configuration_failed:'연동 설정을 저장하거나 불러오지 못했습니다. 화면을 새로고침해 연결 상태를 확인해 주세요.',
  };
  if(typeof error?.code==='string'&&Object.hasOwn(messages,error.code))return messages[error.code];
  if (credentials) return '계정 연결을 확인하지 못했습니다. API Key와 API Secret, 솔라피 API 사용 권한을 확인해 주세요.';
  const message = String(error?.message || '');
  if (!/[가-힣]/u.test(message) || /api.?secret|api.?key|bearer|authorization|token|https?:\/\//i.test(message)) return '요청을 처리하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
  return message.slice(0,500);
}

function credentialSection(state) {
  const connected = state.status?.connected === true;
  return `<details class="sp-step sp-credentials" ${connected ? '' : 'open'}><summary><span class="sp-step-number">1</span><span><strong>솔라피 계정 연결</strong><small>${connected ? '연동 키가 저장되어 있습니다.' : '솔라피에서 발급한 연동 키를 이 화면에 입력하세요.'}</small></span><span class="sp-badge ${connected ? 'good' : ''}">${connected ? '키 연결됨' : '연결 필요'}</span></summary><div class="sp-step-body"><div class="sp-external-links"><a class="btn secondary small" href="https://console.solapi.com/login" target="_blank" rel="noopener noreferrer">솔라피 로그인 ↗</a>${apiHelpUrl(state.status?.setupUrls?.apiKeys) ? `<a class="btn ghost small" href="${esc(apiHelpUrl(state.status.setupUrls.apiKeys))}" target="_blank" rel="noopener noreferrer">API 키 발급 안내 ↗</a>` : ''}<a class="btn ghost small" href="https://center-pf.kakao.com/" target="_blank" rel="noopener noreferrer">카카오채널 관리자 ↗</a></div><form data-sp-form="credentials" autocomplete="off"><div class="sp-two-columns"><label class="field"><span class="field-label">API Key <b>*</b></span><input type="password" name="apiKey" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="300" placeholder="솔라피 API Key" ${state.loading || state.busy ? 'disabled' : ''}></label><label class="field"><span class="field-label">API Secret <b>*</b></span><input type="password" name="apiSecret" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="500" placeholder="솔라피 API Secret" ${state.loading || state.busy ? 'disabled' : ''}></label></div><p class="sp-help">로그인 비밀번호가 아닌 API 연동 키입니다. 입력값은 서버에 암호화해 저장하며, 저장 후 다시 표시하지 않습니다.</p><div class="sp-action-row"><span class="sp-help">${connected ? '새 키로 교체하면 기존 사업장별 채널·템플릿 선택을 다시 설정해야 합니다.' : '계정 연결만으로 고객 안내가 발송되지는 않습니다.'}</span><button class="btn primary" type="submit" ${state.loading || state.busy ? 'disabled' : ''}>${connected ? '새 키로 연결 확인·저장' : '연결 확인·저장'}</button></div></form></div></details>`;
}

function companySwitch(state) {
  return `<div class="sp-company-grid" aria-label="알림톡 사업장 선택">${COMPANIES.map(target => {
    const binding = selectedCompany(state, target.company), selected = state.company === target.company;
    return `<article class="sp-company ${selected ? 'selected' : ''}"><button type="button" data-sp-action="company" data-company="${esc(target.company)}" aria-pressed="${selected}" ${state.busy ? 'disabled' : ''}><span class="sp-company-icon" aria-hidden="true">${esc(target.company.slice(0,1))}</span><span><strong>${esc(target.company)}</strong><small>${binding.channelId ? esc(binding.channelName || '솔라피 채널 지정됨') : '솔라피 채널 선택 필요'}</small></span><span class="sp-company-check" aria-hidden="true">${selected ? '✓' : ''}</span></button><a href="${target.publicUrl}" target="_blank" rel="noopener noreferrer">지정한 카카오채널 보기 ↗</a></article>`;
  }).join('')}</div>`;
}

function channelSection(state) {
  const binding = selectedCompany(state), connected = state.status?.connected === true, chosen = state.channelChoice || '';
  const known = rows(state.channels).some(row => channelId(row) === chosen);
  return `<section class="sp-step"><header class="sp-step-heading"><span class="sp-step-number">2</span><div><h3>${esc(state.company)} 발신 채널</h3><p>솔라피에 등록된 채널 중 이 사업장의 채널을 선택하세요.</p></div><span class="sp-badge ${binding.channelId ? 'good' : ''}">${binding.channelId ? '채널 지정됨' : '선택 필요'}</span></header><div class="sp-step-body"><form data-sp-form="channel"><label class="field"><span class="field-label">솔라피 발신 채널 <b>*</b></span><select name="channelId" required ${!connected || state.busy || state.loading ? 'disabled' : ''}><option value="">채널 선택</option>${!known && chosen && binding.channelId === chosen ? `<option value="${esc(chosen)}" selected>${esc(binding.channelName || '저장된 채널')} · 목록 다시 확인 필요</option>` : ''}${rows(state.channels).map(row => `<option value="${esc(channelId(row))}" ${channelId(row) === chosen ? 'selected' : ''}>${esc(row.channelName || row.searchId || channelId(row))}${row.searchId && row.channelName ? ` (${esc(row.searchId)})` : ''}</option>`).join('')}</select></label><p class="sp-help">위 카카오채널 페이지와 선택한 채널의 이름을 확인해 주세요. 사업장별 발신 채널을 각각 지정합니다.</p><div class="sp-action-row"><button class="btn ghost small" type="button" data-sp-action="channels-refresh" ${!connected || state.busy ? 'disabled' : ''}>채널 목록 새로고침</button><div class="sp-button-group">${state.channelsNextKey ? `<button class="btn secondary small" type="button" data-sp-action="channels-more" ${state.busy ? 'disabled' : ''}>채널 더 보기</button>` : ''}<button class="btn primary" type="submit" ${!connected || !chosen || !known || state.busy ? 'disabled' : ''}>${esc(state.company)} 채널로 저장</button></div></div></form>${!connected ? '<p class="sp-inline-note">솔라피 계정을 연결하면 발신 채널을 불러옵니다.</p>' : ''}<details class="sp-channel-help" ${state.channelEnrollmentOpen ? 'open' : ''}><summary>목록에 채널이 없나요? 새 채널 연결</summary><p class="sp-help">카카오채널 관리자의 휴대전화로 인증번호를 받아 솔라피에 채널을 연결합니다. 비즈니스 채널이어야 합니다.</p><form data-sp-form="channel-token"><div class="sp-two-columns"><label class="field"><span class="field-label">채널 검색용 아이디 <b>*</b></span><input name="searchId" value="${esc(state.enrollment.searchId)}" autocomplete="off" maxlength="100" required placeholder="채널 검색용 아이디" ${!connected || state.busy ? 'disabled' : ''}></label><label class="field"><span class="field-label">채널 관리자 휴대전화 <b>*</b></span><input name="phoneNumber" value="${esc(state.enrollment.phoneNumber)}" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required placeholder="010-0000-0000" ${!connected || state.busy ? 'disabled' : ''}></label></div><button class="btn secondary small" type="submit" ${!connected || state.busy ? 'disabled' : ''}>관리자 휴대전화로 인증번호 요청</button></form><form data-sp-form="channel-connect" class="sp-token-form"><div class="sp-two-columns"><label class="field"><span class="field-label">인증번호 <b>*</b></span><input name="token" type="password" inputmode="numeric" autocomplete="one-time-code" required maxlength="30" placeholder="받은 인증번호" ${!connected || !state.tokenRequested || state.busy ? 'disabled' : ''}></label><label class="field"><span class="field-label">카카오채널 업종 <b>*</b></span><select name="channelCategory" required ${!connected || state.busy ? 'disabled' : ''}>${categoryOptions(state.channelCategories, state.enrollment.categoryCode)}</select></label></div><button class="btn primary small" type="submit" ${!connected || !state.tokenRequested || !state.enrollment.categoryCode || state.busy ? 'disabled' : ''}>${esc(state.company)} 채널 연결 완료</button></form></details></div></section>`;
}

function templateCard(state, kind) {
  const draft = rows(state.drafts).find(row => row.kind === kind.id), saved = savedTemplate(state,kind.id);
  const chosen = state.templateChoices[kind.id] || saved?.templateId || '', template = rows(state.templates).find(row => templateId(row) === chosen) || (saved?.templateId === chosen ? saved : null);
  const compatible = rows(template?.compatibleKinds).includes(kind.id) || template?.compatible === true;
  const approved = template?.status === 'APPROVED' && compatible;
  const channel = selectedCompany(state).channelId, bound = !!channel && channel === state.channelChoice, registered = state.createdTemplates[kind.id] || '';
  const ownedForInspection = !!chosen && (template?.canRequestInspection === true || chosen === registered || saved?.templateId === chosen);
  const canRequest = ownedForInspection && template?.status !== 'APPROVED' && !['INSPECTING','REVIEWING'].includes(template?.status);
  return `<article class="sp-template"><header><div><h4>${kind.title}</h4><p>${kind.description}</p></div><span class="sp-badge ${statusClass(saved?.status)}">${saved ? esc(statusLabel(saved.status)) : '설정 전'}</span></header>${draft ? `<details class="sp-draft"><summary>등록할 안내문 미리보기</summary><div class="sp-message-preview"><strong>${esc(draft.name || kind.title)}</strong><p>${esc(draft.content || '')}</p>${rows(draft.buttons).length ? `<div class="sp-preview-buttons">${draft.buttons.map(button => `<span>${esc(button.name || button.buttonName || '안내 링크')}</span>`).join('')}</div>` : ''}</div><p class="sp-help">#{…} 항목에는 고객별 예약 정보와 확인 링크가 들어갑니다.</p></details>` : '<p class="sp-help">안내문 초안을 불러오는 중입니다.</p>'}<label class="field"><span class="field-label">사용할 템플릿</span><select name="templateId" data-kind="${kind.id}" ${!bound || state.busy ? 'disabled' : ''}><option value="">템플릿 선택</option>${chosen && !rows(state.templates).some(row => templateId(row) === chosen) ? `<option value="${esc(chosen)}" selected>${esc(template?.name || '저장된 템플릿')} · ${esc(statusLabel(template?.status))}</option>` : ''}${rows(state.templates).map(row => `<option value="${esc(templateId(row))}" ${templateId(row) === chosen ? 'selected' : ''}>${esc(row.name || templateId(row))} · ${esc(statusLabel(row.status))}${!rows(row.compatibleKinds).includes(kind.id) ? ' · 양식 확인 필요' : ''}</option>`).join('')}</select></label>${template ? `<p class="sp-template-state ${approved ? 'good' : ''}">${esc(statusLabel(template.status))}${!compatible ? ' · 이 안내 유형에 필요한 항목과 버튼을 확인해 주세요.' : approved ? ' · 이 안내 유형에 사용할 수 있습니다.' : ' · 승인 후 사용하도록 저장할 수 있습니다.'}</p>` : ''}<div class="sp-template-actions"><button class="btn primary small" type="button" data-sp-action="template-save" data-kind="${kind.id}" ${!bound || !approved || state.busy ? 'disabled' : ''}>이 안내에 사용하도록 저장</button>${canRequest ? `<button class="btn secondary small" type="button" data-sp-action="inspection" data-kind="${kind.id}" ${state.busy ? 'disabled' : ''}>카카오 검수 요청</button>` : ''}</div><div class="sp-register-row"><span class="sp-help">맞는 템플릿이 없으면 위 안내문으로 등록하세요.</span><button class="btn ghost small" type="button" data-sp-action="template-create" data-kind="${kind.id}" ${!bound || !draft || !state.templateCategory || state.busy ? 'disabled' : ''}>솔라피에 새 템플릿 등록</button></div></article>`;
}

function templatesSection(state) {
  const connected = state.status?.connected === true, bound = selectedCompany(state).channelId && selectedCompany(state).channelId === state.channelChoice;
  return `<section class="sp-step"><header class="sp-step-heading"><span class="sp-step-number">3</span><div><h3>${esc(state.company)} 안내문 설정</h3><p>안내문을 등록하고 카카오 검수를 요청한 뒤, 승인된 템플릿을 선택합니다.</p></div></header><div class="sp-step-body"><div class="sp-template-tools"><label class="field"><span class="field-label">새 안내문의 카카오 분류</span><select name="templateCategory" ${!connected || state.busy ? 'disabled' : ''}>${categoryOptions(state.templateCategories,state.templateCategory)}</select></label><div class="sp-button-group"><button class="btn secondary small" type="button" data-sp-action="templates-refresh" ${!connected || !bound || state.busy ? 'disabled' : ''}>템플릿·검수 상태 새로고침</button>${state.templatesNextKey ? `<button class="btn ghost small" type="button" data-sp-action="templates-more" ${state.busy ? 'disabled' : ''}>템플릿 더 보기</button>` : ''}</div></div>${!bound ? '<p class="sp-inline-note">먼저 이 사업장의 솔라피 발신 채널을 저장해 주세요.</p>' : ''}<div class="sp-template-list">${KINDS.map(kind => templateCard(state,kind)).join('')}</div><p class="sp-help">템플릿 검수는 카카오에서 진행합니다. 반려되면 솔라피에서 사유를 확인해 주세요.</p></div></section>`;
}


const blockedLabels = {payment_adjustment_invalid:'입금 요청 정정 금액·사유 확인 필요',provider_not_connected:'솔라피 계정 연결 필요',channel_missing:'업체 발신 채널 설정 필요',delivery_disabled:'자동 발송 꺼짐',manually_paused:'자동 발송 일시 중지',credentials_changed:'연동 키 변경 · 자동 발송 재시작 필요',operator_inactive:'자동 발송 담당 관리자 확인 필요',reminder_invalid:'전날 안내 정보 확인 필요',balance_invalid:'미수금 안내 정보 확인 필요',student_count_missing:'강습 인원 확인 필요',source_link_unavailable:'고객 확인 링크 만료·해제',request_superseded:'신청 정보 변경·일정 경과',request_result_invalid:'일정 요청 결과 확인 필요',link_unavailable:'고객 확인 링크 생성 실패',invalid_date:'요청 일정 확인 필요',center_missing:'강습센터 미등록',center_changed:'강습센터 변경',missing_recipient:'전화번호 미등록',recipient_changed:'연락처 변경',customer_changed:'고객 정보 변경',instructor_missing:'담당 강사 미배정',template_missing:'템플릿 미설정',template_not_approved:'템플릿 승인 필요',provider_unavailable:'솔라피 연결 확인 필요',booking_changed:'예약 내용 변경',configuration_changed:'연동 설정 변경',report_link_invalid:'보고서 링크 확인 필요',message_too_long:'안내문 길이 확인 필요'};
const deliveryState = state => state.delivery?.workerReady === true ? (state.delivery.deliveryEnabled ? '자동 발송 켜짐' : '자동 발송 꺼짐') : state.loading ? '발송 상태 확인 중' : '발송 상태 확인 필요';
function deliverySection(state) {
  const delivery = state.delivery,ready = delivery?.workerReady === true,enabled = ready && delivery?.deliveryEnabled === true,canEnable = ready && delivery?.canEnable === true;
  const counts = delivery?.counts || {},number = key => Math.max(0,Number(counts[key]) || 0),blocked = Object.entries(delivery?.blockedCounts || {}).filter(([,count])=>Number(count)>0);
  const missing = rows(delivery?.missingTargets).filter(row=>COMPANIES.some(item=>item.company===row.company) && KINDS.some(item=>item.id===row.kind));
  const stamp = delivery?.activatedAt && Number.isFinite(new Date(delivery.activatedAt).getTime()) ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(delivery.activatedAt)) : '';
  return `<section class="sp-step sp-delivery"><header class="sp-step-heading"><span class="sp-step-number">4</span><div><h3>새 접수부터 자동 알림톡</h3><p>예약·수강권·보고서·곤지암 전날 안내와 일정 요청 처리 결과·입금 요청 정정의 발송 상태를 확인합니다.</p></div><span class="sp-badge ${enabled?'good':''}">${deliveryState(state)}</span></header><div class="sp-step-body"><p class="sp-inline-note">${enabled?`자동 발송이 켜져 있습니다.${stamp?` ${esc(stamp)} 이후의 새 접수부터 처리합니다.`:''}`:ready?'자동 발송은 꺼져 있습니다. 계정·채널·승인 템플릿을 준비한 뒤 시작할 수 있습니다.':'자동 발송 상태를 확인하지 못했습니다. 상태를 새로고침해 주세요.'}<br>시작 전 예약 접수 안내는 일괄 발송하지 않습니다. 등록한 입금 요청 정정과 일정 요청 처리 결과는 보관하며, 발송을 시작하면 승인 템플릿이 준비된 건부터 처리합니다. 대체 문자는 보내지 않습니다.</p>${ready?`<div class="sp-delivery-counts"><div><strong>${number('pending')+number('preparing')+number('sending')}</strong><span>처리 대기·진행</span></div><div><strong>${number('accepted')}</strong><span>솔라피 접수</span></div><div><strong>${number('delivered')}</strong><span>도달 확인</span></div><div><strong>${number('failed')}</strong><span>발송 실패</span></div><div><strong>${number('uncertain')}</strong><span>결과 미확인</span></div><div><strong>${number('blocked')}</strong><span>확인 필요</span></div></div><p class="sp-help">‘솔라피 접수’는 고객 도달이 확인된 상태가 아닙니다. 결과 미확인 건은 중복 발송을 막기 위해 자동 재발송하지 않습니다.</p>`:''}${missing.length?`<p class="sp-help">아직 준비가 필요한 안내: ${missing.map(row=>esc(row.company+' '+KINDS.find(item=>item.id===row.kind).title)).join(' · ')}${enabled?'<br>준비된 사업장·안내는 계속 발송됩니다. 위 안내는 채널과 승인 템플릿이 준비될 때까지 보류됩니다.':''}</p>`:''}${blocked.length?`<ul class="sp-blocked-list">${blocked.map(([reason,count])=>`<li><span>${esc(blockedLabels[reason] || '관리자 확인 필요')}</span><strong>${Math.max(0,Number(count)||0)}건</strong></li>`).join('')}</ul>`:''}<p class="sp-help">강습센터가 없는 수강권은 발신 채널을 정할 수 없어 발송을 보류합니다.</p><div class="sp-action-row"><button type="button" class="btn secondary small" data-sp-action="delivery-refresh" ${state.busy||state.loading?'disabled':''}>발송 상태 새로고침</button><button type="button" class="btn ${enabled?'secondary':'primary'}" data-sp-action="delivery-toggle" ${state.busy||state.loading||!ready||!enabled&&!canEnable?'disabled':''}>${enabled?'자동 발송 중지':'새 접수부터 자동 알림톡 시작'}</button></div></div></section>`;
}

export function renderSolapiSettings(options = {}) {
  if (options.profile?.role !== 'admin') return '';
  const state = {status:null,delivery:null,company:'캐치',channels:[],templates:[],drafts:[],channelCategories:[],templateCategories:[],channelChoice:'',templateChoices:{},createdTemplates:{},templateCategory:'',enrollment:{searchId:'',phoneNumber:'',categoryCode:''},loading:false,busy:false,error:'',message:'',...options};
  return `<section class="solapi-settings" data-sp-settings aria-label="솔라피 알림톡 연결"><header class="sp-heading"><div><span class="sp-kicker">CUSTOMER MESSAGES</span><h2>솔라피 · 카카오 알림톡</h2><p>예약 안내부터 강습 자료와 만족도 조사까지, 사업장별 채널을 연결합니다.</p></div><span class="sp-badge ${state.delivery?.deliveryEnabled ? 'good' : 'attention'}">${deliveryState(state)}</span></header><p class="sp-delivery-note">사업장별 발신 채널·안내문을 각각 연결하세요. 자동 발송은 아래에서 시작할 수 있으며, 시작 전 예약 접수 안내는 일괄 발송하지 않습니다. 등록한 입금 요청 정정·일정 처리 결과는 준비 후 이어서 발송합니다.</p><div class="sp-feedback-wrap"><p class="sp-error" data-sp-error role="alert" ${state.error ? '' : 'hidden'}>${esc(state.error)}</p><p class="sp-feedback" data-sp-feedback role="status" aria-live="polite" ${state.message ? '' : 'hidden'}>${esc(state.message)}</p></div>${credentialSection(state)}${companySwitch(state)}${channelSection(state)}${templatesSection(state)}${deliverySection(state)}</section>`;
}

export function mountSolapiSettings(root, options = {}) {
  const state = {profile:options.profile,status:null,delivery:null,company:'캐치',channels:[],channelsNextKey:null,templates:[],templatesNextKey:null,drafts:[],channelCategories:[],templateCategories:[],channelChoice:'',templateChoices:{},createdTemplates:{},templateCategory:'',enrollment:{searchId:'',phoneNumber:'',categoryCode:''},tokenRequested:false,verificationKey:'',channelEnrollmentOpen:false,loading:true,busy:false,error:'',message:''};
  let disposed = false, request = 0, credentialDirty = false, refreshing = false;
  const abort = new AbortController();
  const admin = () => options.profile?.role === 'admin' && !disposed;
  const api = (action,payload = {}) => options.api(action,payload,{signal:abort.signal});
  const clearSensitiveInputs = () => {
    for (const input of root.querySelectorAll('input[name="apiKey"],input[name="apiSecret"],input[name="token"]')) input.value = '';
  };
  const clearToken = () => { const field = root.querySelector('input[name="token"]');if (field) field.value = ''; };
  const paint = () => {
    if (disposed) return;
    // Preserve the live credential elements while editing; never serialize their values.
    const form = credentialDirty ? root.querySelector('[data-sp-form="credentials"]') : null;
    const tokenField = state.tokenRequested ? root.querySelector('input[name="token"]') : null;
    root.innerHTML = renderSolapiSettings(state);
    if (form) root.querySelector('[data-sp-form="credentials"]')?.replaceWith?.(form);
    if (tokenField) { root.querySelector('input[name="token"]')?.replaceWith?.(tokenField);tokenField.disabled = !state.status?.connected || state.busy || state.loading; }
  };
  const notify = (message,error = '') => {
    if (disposed) return;
    state.message = message;state.error = error;
    const errorNode = root.querySelector('[data-sp-error]'),messageNode = root.querySelector('[data-sp-feedback]');
    if (errorNode) { errorNode.textContent = error;errorNode.hidden = !error; }
    if (messageNode) { messageNode.textContent = message;messageNode.hidden = !message; }
  };
  const restoreVerification = () => {
    const pending = state.status?.connected ? rows(state.status.pendingVerifications).find(row => row.company === state.company && typeof row.searchId === 'string' && /^01[016789]\d{7,8}$/.test(row.phoneNumber || '') && Date.parse(row.expiresAt) > Date.now()) : null;
    const key = pending ? JSON.stringify([pending.company,pending.searchId,pending.phoneNumber,pending.expiresAt]) : '';
    if (key !== state.verificationKey) clearToken();
    if (pending) {
      const categoryCode = key === state.verificationKey ? state.enrollment.categoryCode : state.channelCategories.some(row => row.code === '00800080001') ? '00800080001' : '';
      state.enrollment = {searchId:pending.searchId,phoneNumber:pending.phoneNumber,categoryCode};
      state.tokenRequested = true;state.channelEnrollmentOpen = true;
    } else if (state.verificationKey) {
      state.enrollment = {searchId:'',phoneNumber:'',categoryCode:''};state.tokenRequested = false;
    }
    state.verificationKey = key;
  };
  const setStatus = result => {
    if (typeof result?.connected === 'boolean') state.status = result;
    const saved = selectedCompany(state);
    state.channelChoice = saved.channelId || '';
    restoreVerification();
  };
  const merge = (old,values,key) => [...new Map([...old,...values].map(row => [row[key],row])).values()];
  async function loadChannels(more = false) {
    const result = await api('list-channels',more && state.channelsNextKey ? {startKey:state.channelsNextKey} : {});
    if (disposed) return;
    state.channels = more ? merge(state.channels,rows(result.channels),'channelId') : rows(result.channels);
    state.channelsNextKey = result.nextKey || null;
  }
  async function loadTemplates(more = false) {
    const binding = selectedCompany(state);
    if (!binding.channelId) { state.templates = [];state.templatesNextKey = null;return; }
    const result = await api('list-templates',{company:state.company,channelId:binding.channelId,...(more && state.templatesNextKey ? {startKey:state.templatesNextKey} : {})});
    if (disposed) return;
    state.templates = more ? merge(state.templates,rows(result.templates),'templateId') : rows(result.templates);
    state.templatesNextKey = result.nextKey || null;
  }
  async function loadDrafts() {
    const result = await api('template-drafts',{company:state.company});
    if (!disposed) state.drafts = rows(result.drafts);
  }
  async function loadDelivery() {
    const result = await api('delivery-status');
    if (!disposed) state.delivery = result;
  }
  async function loadCategories() {
    const result = await api('list-categories');
    if (!disposed) { state.channelCategories = rows(result.channelCategories);state.templateCategories = rows(result.templateCategories);if (!state.enrollment.categoryCode && state.channelCategories.some(row => row.code === '00800080001')) state.enrollment.categoryCode = '00800080001'; }
  }
  async function refresh() {
    if (!admin() || state.busy || refreshing) return;
    refreshing = true;state.loading = true;paint();
    const stamp = ++request;
    try {
      const result = await api('status');
      if (disposed || stamp !== request) return;
      setStatus(result);
      const tasks = [loadDrafts(),loadDelivery()];
      if (result.connected) tasks.push(loadChannels(),loadCategories(),loadTemplates());
      const results = await Promise.allSettled(tasks);
      if (disposed || stamp !== request) return;
      const rejected = results.find(result => result.status === 'rejected');
      state.error = rejected ? displayError(rejected.reason) : '';
    } catch(error) { if (!disposed && stamp === request) state.error = displayError(error); }
    finally { refreshing = false;if (!disposed && stamp === request) { state.loading = false;paint(); } }
  }
  async function task(work,{credentials = false} = {}) {
    if (!admin() || state.busy || state.loading) return;
    state.busy = true;state.error = '';state.message = '';paint();
    try { await work(); }
    catch(error) { if (!disposed) state.error = displayError(error,credentials); }
    finally { if (!disposed) { state.busy = false;paint(); } }
  }
  const formValue = (form,name) => String(form.querySelector(`[name="${name}"]`)?.value || '').trim();
  const submit = async event => {
    const form = event.target;
    if (!form.matches?.('[data-sp-form]')) return;
    event.preventDefault();
    if (!admin() || state.busy || state.loading) return;
    const kind = form.dataset.spForm;
    if (kind === 'credentials') {
      const apiKey = formValue(form,'apiKey'),apiSecret = formValue(form,'apiSecret');
      if (!apiKey || !apiSecret) { notify('','API Key와 API Secret을 모두 입력해 주세요.');return; }
      clearSensitiveInputs();credentialDirty = false;
      await task(async () => {
        const result = await api('connect',{apiKey,apiSecret});
        if (disposed) return;
        setStatus(result);state.channels = rows(result.channels);state.templates = [];state.templateChoices = {};state.createdTemplates = {};
        state.message = '솔라피 계정을 연결했습니다. 사업장별 발신 채널을 확인해 주세요.';
        options.onSaved?.(result);options.onDirty?.(false);
        const results = await Promise.allSettled([loadChannels(),loadCategories(),loadTemplates(),loadDelivery()]);
        if (disposed) return;
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected) state.error = displayError(rejected.reason);
      },{credentials:true});
      return;
    }
    if (kind === 'channel') {
      const selected = formValue(form,'channelId');
      if (!state.channels.some(row => channelId(row) === selected)) { notify('','솔라피 목록에 있는 채널을 선택해 주세요.');return; }
      await task(async () => {
        const result = await api('save-channel',{company:state.company,channelId:selected});
        if (disposed) return;
        setStatus(result);state.templateChoices = {};state.createdTemplates = {};
        state.message = `${state.company}의 발신 채널을 저장했습니다.`;options.onSaved?.(result);options.onDirty?.(false);
        await loadTemplates();await loadDelivery();
      });
      return;
    }
    if (kind === 'channel-token') {
      const searchId = formValue(form,'searchId'),phoneNumber = formValue(form,'phoneNumber');
      if (!searchId || !/^0\d{8,10}$/.test(phoneNumber.replace(/\D/g,''))) { notify('','채널 검색용 아이디와 관리자 휴대전화 번호를 확인해 주세요.');return; }
      state.enrollment.searchId = searchId;state.enrollment.phoneNumber = phoneNumber;state.channelEnrollmentOpen = true;
      await task(async () => {
        const result = await api('channel-token',{company:state.company,searchId,phoneNumber});
        if (disposed) return;
        setStatus(result);
        state.tokenRequested = true;state.message = '인증번호를 요청했습니다. 휴대전화에서 확인한 번호를 입력해 주세요.';
      });
      return;
    }
    if (kind === 'channel-connect') {
      const token = formValue(form,'token'),categoryCode = formValue(form,'channelCategory');
      if (!token || !categoryCode || !state.tokenRequested) { notify('','받은 인증번호와 채널 업종을 확인해 주세요.');return; }
      clearToken();
      await task(async () => {
        const result = await api('channel-connect',{company:state.company,...state.enrollment,token,categoryCode});
        if (disposed) return;
        setStatus(result);state.tokenRequested = false;state.channelEnrollmentOpen = false;state.message = `${state.company} 카카오채널을 연결했습니다.`;
        options.onSaved?.(result);options.onDirty?.(false);await loadChannels();await loadTemplates();await loadDelivery();
      });
    }
  };
  const input = event => {
    const target = event.target;
    if (target.name === 'apiKey' || target.name === 'apiSecret') credentialDirty = true;
    if (target.name === 'searchId' || target.name === 'phoneNumber') state.enrollment[target.name] = target.value;
    options.onDirty?.(true);
  };
  const change = event => {
    const target = event.target;
    if (target.name === 'channelId') { state.channelChoice = target.value;options.onDirty?.(true);paint(); }
    if (target.name === 'templateId') { state.templateChoices[target.dataset.kind] = target.value;options.onDirty?.(true);paint(); }
    if (target.name === 'templateCategory') { state.templateCategory = target.value;paint(); }
    if (target.name === 'channelCategory') { state.enrollment.categoryCode = target.value;state.channelEnrollmentOpen = true;paint(); }
  };
  const click = async event => {
    const button = event.target.closest?.('[data-sp-action]');
    if (!button || !root.contains(button) || button.disabled || !admin() || state.busy || state.loading) return;
    const action = button.dataset.spAction,kind = button.dataset.kind;
    if (action === 'company') {
      if (!COMPANIES.some(row => row.company === button.dataset.company) || state.company === button.dataset.company) return;
      clearToken();state.company = button.dataset.company;state.channelChoice = selectedCompany(state).channelId || '';
      state.templates = [];state.templatesNextKey = null;state.templateChoices = {};state.createdTemplates = {};state.drafts = [];state.tokenRequested = false;state.channelEnrollmentOpen = false;
      state.enrollment = {searchId:'',phoneNumber:'',categoryCode:''};state.verificationKey = '';restoreVerification();
      await task(async () => { await loadDrafts();if (state.status?.connected) await loadTemplates(); });
      return;
    }
    await task(async () => {
      if (action === 'delivery-refresh') { await loadDelivery();return; }
      if (action === 'delivery-toggle') {
        const enabled = state.delivery?.deliveryEnabled === true;
        if (state.delivery?.workerReady !== true || !enabled && state.delivery?.canEnable !== true) throw new Error('계정과 사업장별 승인 템플릿을 먼저 준비해 주세요.');
        const result = await api('delivery-enable',{enabled:!enabled});
        if (disposed) return;state.delivery = result;
        state.message = result.deliveryEnabled ? '새 접수부터 자동 알림톡을 시작했습니다. 입금 요청 정정·일정 처리 결과의 대기 건도 준비된 안내부터 이어서 발송합니다.' : '자동 알림톡을 중지했습니다.';options.onSaved?.(result);return;
      }
      if (action === 'channels-refresh' || action === 'channels-more') { await loadChannels(action.endsWith('more'));return; }
      if (action === 'templates-refresh' || action === 'templates-more') { await loadTemplates(action.endsWith('more'));return; }
      if (!KINDS.some(row => row.id === kind)) return;
      const saved = savedTemplate(state,kind),id = state.templateChoices[kind] || saved?.templateId || '',binding = selectedCompany(state);
      if (!binding.channelId || binding.channelId !== state.channelChoice) throw new Error('이 사업장의 발신 채널부터 저장해 주세요.');
      if (action === 'template-save') {
        const result = await api('save-template-selection',{company:state.company,kind,channelId:binding.channelId,templateId:id});
        if (disposed) return;
        setStatus(result);state.message = `${state.company} ${KINDS.find(row => row.id === kind).title} 템플릿을 저장했습니다.`;options.onSaved?.(result);options.onDirty?.(false);await loadDelivery();
      } else if (action === 'template-create') {
        if (!state.templateCategory) throw new Error('새 안내문의 카카오 분류를 선택해 주세요.');
        const result = await api('create-template',{company:state.company,kind,channelId:binding.channelId,categoryCode:state.templateCategory});
        if (disposed) return;
        setStatus(result);const id = templateId(result.template);
        if (id) { state.createdTemplates[kind] = id;state.templateChoices[kind] = id;state.templates = merge(state.templates,[result.template],'templateId'); }
        state.message = result.reused ? '등록된 안내문을 불러왔습니다. 검수 상태를 확인해 주세요.' : '솔라피에 안내문을 등록했습니다. 카카오 검수를 요청해 주세요.';
        options.onSaved?.(result);await loadTemplates();
      } else if (action === 'inspection') {
        const result = await api('request-inspection',{company:state.company,templateId:id});
        if (disposed) return;
        setStatus(result);state.message = '카카오 검수를 요청했습니다. 승인되면 이 안내에 사용하도록 저장해 주세요.';options.onSaved?.(result);await loadTemplates();
      }
    });
  };
  paint();
  if (admin()) { root.addEventListener('submit',submit);root.addEventListener('input',input);root.addEventListener('change',change);root.addEventListener('click',click);void refresh(); }
  return {refresh,cleanup(){if (disposed) return;clearSensitiveInputs();disposed = true;request++;abort.abort();root.removeEventListener('submit',submit);root.removeEventListener('input',input);root.removeEventListener('change',change);root.removeEventListener('click',click);}};
}
