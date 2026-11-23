import {buildMmsTaskerAction} from './call-tasker-mms.mjs?v=4';
import {buildRcsTaskerAction} from './call-tasker-rcs.mjs?v=2';
export const CALL_INGEST_ENDPOINT = 'https://ewiekbmjvgktwsbbxrzw.supabase.co/functions/v1/slope-call-inbox';

export const CALL_TASKER_SETUP_STEPS = Object.freeze([
  '각 휴대폰의 공식 Tasker를 6.6.18 이상 최신 정식 버전으로 업데이트합니다. 장문·사진 동기화에는 Java Code 동작이 필요합니다.',
  '새로 연결하는 휴대폰은 v11 연결파일을 내려받습니다. 이미 v10을 사용하는 휴대폰은 기존 연결파일로 업데이트하여 연결키를 유지할 수 있습니다. 파일을 준비한 뒤 해당 SLOPE 수신 프로젝트만 교체합니다.',
  'Tasker의 전화·통화기록·SMS 권한과 알림을 허용하고, 배터리 사용을 제한 없음으로 설정합니다. 삼성의 절전·초절전 앱 목록에서 Tasker를 제외합니다.',
  'Tasker 하단 프로젝트 탭을 길게 눌러 Import Project로 .prj.xml 파일을 가져옵니다. 통화·문자 동기화 v12, 장문·사진 동기화 v9, 채팅+ 동기화 v11 작업을 각각 한 번 실행합니다. 진단 프로젝트만으로는 자동 수집이 시작되지 않습니다.',
  '일반 문자·여러 줄 장문·사진 문자를 각각 보내 보고 문자 대화의 동기화 상태와 실제 내용을 확인합니다. 장문·사진은 다운로드가 끝난 뒤 다음 실행에서 확인하며, 두 번 연속 같은 첨부 구성이 확인되면 저장합니다.',
  '통화 종료 후 약 5초 및 2분 간격으로 확인합니다. 장문·사진과 삼성 채팅+ 작업도 각각 2분마다 확인합니다. 밀린 채팅+는 여러 번 나눠 가져오며 새 메시지를 먼저 처리합니다. 수동 실행 후 마지막 보고 시각과 미완료 건수를 확인하세요. Android 절전 상태에서는 실행이 늦어질 수 있습니다.',
]);

export const CALL_TASKER_SETUP_LIMITATION = '이미 있는 프로젝트라는 안내는 기존 버전과 이름이 같아서 표시될 수 있습니다. 위 교체 절차는 Tasker 설정만 바꾸며 휴대폰 문자와 사이트 저장 내역은 유지합니다. 실제 휴대폰의 문자·장문·사진 수신/발신 테스트가 필요합니다. v11은 기존 SMS·MMS와 삼성 채팅+ 저장소를 따로 확인합니다. 채팅+는 해당 저장소와 파일을 읽을 수 있는 기기에서 동작하며 권한·첨부 읽기 실패와 단체 대화는 미완료 상태로 표시합니다. 카카오 대화는 수집하지 않습니다. 연결 시작 이후 최근 7일 기록을 재확인하고 서버가 완료를 확인한 항목만 처리 완료로 기록합니다. 파일에는 해당 기기의 전송용 인증키가 포함됩니다.';

const xml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[char]));
const str = (arg, value = '') => `<Str sr="arg${arg}" ve="3">${xml(value)}</Str>`;
const int = (arg, value) => `<Int sr="arg${arg}" val="${value}"/>`;

function checkedText(value, label, maxLength = 160) {
  const result = String(value ?? '').trim();
  if (!result || result.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(result)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return result;
}

function sourceTime(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('연결 시작 시간이 올바르지 않습니다.');
  return result;
}

// Kept self-contained: this exact function also runs inside the generated
// JavaScriptlet. Tasker's SQL rows contain the first four numeric columns,
// followed by the entire number value (which can contain the divider).
export function callRowsToPayload(rows, options) {
  var since = Math.max(options.collectFrom, options.now - 604800000);
  var candidates = [];
  var input = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < input.length; i++) {
    var row = String(input[i]);
    var fields = [];
    var offset = 0;
    for (var column = 0; column < 4; column++) {
      var divider = row.indexOf('|', offset);
      if (divider < 0) break;
      fields.push(row.slice(offset, divider));
      offset = divider + 1;
    }
    if (fields.length !== 4 || !/^\d{1,20}$/.test(fields[0]) || !/^\d{1,16}$/.test(fields[1]) || !/^(1|2|3|5|6)$/.test(fields[2]) || !/^\d{1,9}$/.test(fields[3])) continue;
    var occurredAt = Number(fields[1]);
    var durationSeconds = Number(fields[3]);
    if (!isFinite(occurredAt) || occurredAt < since || occurredAt > options.now || durationSeconds > 86400) continue;
    var phone = row.slice(offset).trim();
    var digits = phone.replace(/[^0-9]/g, '');
    // Unknown/private placeholders, SIP addresses and malformed strings stay
    // unassociated with a customer. Preserve ordinary formatted phone numbers.
    if (phone.length > 80 || !/^\+?[0-9 ()\-.]+$/.test(phone) || digits.length < 3 || digits.length > 15) phone = '';
    var canonical = phone.replace(/[(). -]/g, '');
    if (/^(?:\+82|0082)/.test(canonical) || /^82\d{8,11}$/.test(canonical)) {
      canonical = canonical.replace(/^(?:\+82|0082|82)/, '');
      if (canonical.charAt(0) !== '0') canonical = '0' + canonical;
    } else if (canonical.slice(0, 2) === '00') {
      canonical = '+' + canonical.slice(2);
    }
    if (!/^(?:\+[1-9]\d{7,14}|\d{3,15})$/.test(canonical)) phone = '';
    candidates.push({externalId: fields[0] + ':' + fields[1], phone: phone, occurredAt: occurredAt, durationSeconds: durationSeconds, type: Number(fields[2])});
  }
  candidates.sort(function (a, b) { return b.occurredAt - a.occurredAt; });
  var records = [];
  var seen = Object.create(null);
  for (var index = 0; index < candidates.length && records.length < 100; index++) {
    if (seen[candidates[index].externalId]) continue;
    seen[candidates[index].externalId] = true;
    records.push(candidates[index]);
  }
  var payload = {action: 'ingest', records: records};
  // All accepted fields are ASCII. This is also the UTF-8 byte count.
  while (JSON.stringify(payload).length > 64000 && records.length) records.pop();
  return payload;
}

// These helpers are embedded verbatim in JavaScriptlets. Never pass a scalar
// epoch through Tasker's numeric variable bridge; persist the state as JSON.
export function taskerSmsSnapshot(previousJson, collectFrom, now) {
  var previous;
  try { previous = JSON.parse(previousJson); } catch (error) { previous = null; }
  var integer = function (value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 9007199254740991; };
  var floor = Math.max(collectFrom, now - 604800000);
  var state = {version: 2, collectFrom: collectFrom, completeThrough: collectFrom, lastFullAt: 0, active: null};
  if (previous && (previous.version === 1 || previous.version === 2) && previous.collectFrom === collectFrom) {
    if (integer(previous.completeThrough) && previous.completeThrough <= now) state.completeThrough = previous.completeThrough;
    // v1 skipped dual-number addresses ending in #. Replay the retained window
    // once, without claiming any of those skipped messages were acknowledged.
    if (previous.version === 2 && integer(previous.lastFullAt) && previous.lastFullAt <= now) state.lastFullAt = previous.lastFullAt;
    var active = previous.version === 2 ? previous.active : null;
    if (active && integer(active.since) && integer(active.until) && active.since <= active.until && active.until >= floor && active.until <= now && typeof active.full === 'boolean') {
      state.active = {since: Math.max(floor, active.since), until: active.until, full: active.full, cursor: null};
      if (active.cursor && integer(active.cursor.at) && active.cursor.at >= state.active.since && active.cursor.at <= active.until && /^\d{1,20}$/.test(String(active.cursor.id))) state.active.cursor = {at: active.cursor.at, id: String(active.cursor.id)};
    }
  }
  if (!state.active) {
    var full = !state.lastFullAt || now - state.lastFullAt >= 86400000;
    state.active = {since: full ? floor : Math.max(floor, state.completeThrough - 600000), until: now, full: full, cursor: null};
  }
  var scan = state.active;
  var selection = 'date >= ' + scan.since.toFixed(0) + ' AND date <= ' + scan.until.toFixed(0) + ' AND type IN (1,2)';
  if (scan.cursor) selection += ' AND (date > ' + scan.cursor.at.toFixed(0) + ' OR (date = ' + scan.cursor.at.toFixed(0) + ' AND _id > ' + scan.cursor.id + '))';
  return {state: state, selection: selection};
}

export function smsRowsToPlan(rows, options) {
  var snapshot = options.snapshot;
  var scan = snapshot.state.active;
  var maximumBatches = options.maxBatches || 20;
  var maximumBytes = options.maxBytes || 62000;
  if (!Array.isArray(rows)) throw new Error('SMS_ARRAY_FORMAT: 문자 조회 배열을 확인해 주세요.');
  var input = rows;
  var diagnostic = {collectorVersion: 5, queried: input.length, parsed: 0, eligible: 0, submitted: 0, malformed: 0, beforeStart: 0, afterNow: 0, unsupported: 0};
  var utf8Bytes = function (text) {
    var count = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 128) count++;
      else if (code < 2048) count += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { count += 4; i++; }
      else count += 3;
    }
    return count;
  };
  var idCompare = function (a, b) {
    a = String(a).replace(/^0+(?=\d)/, ''); b = String(b).replace(/^0+(?=\d)/, '');
    return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  };
  var candidates = [];
  for (var index = 0; index < input.length; index++) {
    var raw = String(input[index]);
    var fields = [];
    var start = 0;
    // Body is the final column: pipes and newlines in the message stay intact.
    for (var column = 0; column < 4; column++) {
      var divider = raw.indexOf('|', start);
      if (divider < 0) break;
      fields.push(raw.slice(start, divider));
      start = divider + 1;
    }
    if (fields.length !== 4 || !/^\d{1,20}$/.test(fields[0]) || !/^\d{1,16}$/.test(fields[1]) || !/^\d+$/.test(fields[2])) { diagnostic.malformed++; continue; }
    var at = Number(fields[1]);
    if (!isFinite(at) || at > 9007199254740991) { diagnostic.malformed++; continue; }
    diagnostic.parsed++;
    if (at < scan.since || scan.cursor && (at < scan.cursor.at || at === scan.cursor.at && idCompare(fields[0], scan.cursor.id) <= 0)) { diagnostic.beforeStart++; continue; }
    if (at > scan.until) { diagnostic.afterNow++; continue; }
    var type = Number(fields[2]);
    var phone = fields[3].trim();
    // Dual-number SMS addresses contain one trailing #. Never remove embedded
    // hashes, multiple terminators, USSD stars or other non-phone characters.
    var dualNumber = phone.charAt(phone.length - 1) === '#';
    if (dualNumber) phone = phone.slice(0, -1);
    var canonical = phone.replace(/[().\s-]/g, '');
    if (/^(?:\+82|0082)/.test(canonical) || /^82\d{8,11}$/.test(canonical)) {
      canonical = canonical.replace(/^(?:\+82|0082|82)/, '');
      if (canonical.charAt(0) !== '0') canonical = '0' + canonical;
    } else if (canonical.slice(0, 2) === '00') canonical = '+' + canonical.slice(2);
    var record = null;
    if ((type !== 1 && type !== 2) || phone.length + (dualNumber ? 1 : 0) > 80 || !/^[+0-9().\s-]+$/.test(phone) || !/^(?:\+[1-9]\d{7,14}|\d{3,15})$/.test(canonical) || dualNumber && canonical.replace(/^\+/, '').length < 8) diagnostic.unsupported++;
    else {
      var body = raw.slice(start);
      if (body.length > 20000) throw new Error('SMS_BODY_TOO_LARGE: 문자 본문이 전송 한도를 초과해 동기화를 멈췄습니다.');
      record = {externalId: fields[0], phone: canonical, occurredAt: at, type: type, body: body};
      diagnostic.eligible++;
    }
    candidates.push({record: record, cursor: {at: at, id: fields[0]}});
  }
  if (diagnostic.malformed) throw new Error('SMS_ROW_FORMAT: 문자 조회 결과를 해석하지 못해 동기화를 멈췄습니다.');
  candidates.sort(function (a, b) { return a.cursor.at - b.cursor.at || idCompare(a.cursor.id, b.cursor.id); });
  var batches = [];
  var records = [];
  var cursor = scan.cursor;
  var seen = Object.create(null);
  var consumed = 0;
  var payload = function (items) {
    var counts = JSON.parse(JSON.stringify(diagnostic)); counts.submitted = items.length;
    return {action: 'sms-ingest', records: items, diagnostic: counts};
  };
  for (var next = 0; next < candidates.length; next++) {
    var candidate = candidates[next];
    if (candidate.record && !seen[candidate.record.externalId]) {
      var proposed = records.concat([candidate.record]);
      if (proposed.length > 100 || utf8Bytes(JSON.stringify(payload(proposed))) > maximumBytes) {
        if (!records.length) throw new Error('SMS_BODY_TOO_LARGE: 문자 한 건이 전송 한도를 초과해 동기화를 멈췄습니다.');
        batches.push({payload: payload(records), cursor: cursor});
        records = [];
        if (batches.length >= maximumBatches) break;
        proposed = [candidate.record];
      }
      if (utf8Bytes(JSON.stringify(payload(proposed))) > maximumBytes) throw new Error('SMS_BODY_TOO_LARGE: 문자 한 건이 전송 한도를 초과해 동기화를 멈췄습니다.');
      records = proposed;
      seen[candidate.record.externalId] = true;
    }
    cursor = candidate.cursor;
    consumed++;
  }
  if (batches.length < maximumBatches && (records.length || !batches.length || consumed === candidates.length)) batches.push({payload: payload(records), cursor: cursor});
  return {state: snapshot.state, batches: batches, exhausted: consumed === candidates.length};
}

export function acknowledgeSmsBatch(plan, index, response, status) {
  var batch = plan.batches[index];
  if (!batch || !response || !(Number(status) >= 200 && Number(status) < 300) || typeof response.accepted !== 'number' || response.accepted !== batch.payload.records.length || response.ignored !== 0) throw new Error('SMS_SYNC_UNCONFIRMED: 서버 저장 확인에 실패했습니다. 다음 실행에서 다시 시도합니다.');
  var state = JSON.parse(JSON.stringify(plan.state));
  state.active.cursor = batch.cursor;
  if (index === plan.batches.length - 1 && plan.exhausted) {
    state.completeThrough = state.active.until;
    if (state.active.full) state.lastFullAt = state.active.until;
    state.active = null;
  }
  return state;
}

export function smsBatchRequestBody(planJson, rawIndex) {
  var plan;
  try { plan = JSON.parse(planJson); } catch (error) { throw new Error('SMS_PLAN_INVALID: 문자 전송 계획을 확인하지 못했습니다.'); }
  var index = typeof rawIndex === 'number' || typeof rawIndex === 'string' && /^\d+$/.test(rawIndex) ? Number(rawIndex) : NaN;
  if (!isFinite(index) || Math.floor(index) !== index || index < 0 || !plan || !Array.isArray(plan.batches) || index >= plan.batches.length) throw new Error('SMS_BATCH_INVALID: 문자 전송 순서를 확인하지 못했습니다.');
  var batch = plan.batches[index];
  if (!batch || !batch.payload || batch.payload.action !== 'sms-ingest' || !Array.isArray(batch.payload.records)) throw new Error('SMS_BATCH_INVALID: 문자 전송 내용을 확인하지 못했습니다.');
  return JSON.stringify(batch.payload);
}

function javascriptAction(index, code) {
  return `<Action sr="act${index}" ve="7"><code>129</code>${str(0, code)}${str(1)}${int(2, 1)}${int(3, 45)}</Action>`;
}

function stableId(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return 10000 + value % 500000000;
}

/**
 * Produces a device-specific Tasker project, not an installation or a claim of
 * device compatibility. Action layouts are from original Tasker exports listed
 * in backend/call-inbox/TASKER-SETUP.md. Never log the returned credential file.
 */
export function buildCallTaskerProject({source, token, endpoint = CALL_INGEST_ENDPOINT} = {}) {
  if (!source || !/^[A-Za-z0-9_-]{1,128}$/.test(String(source.id ?? ''))) throw new Error('기기 식별자가 올바르지 않습니다.');
  const label = checkedText(source.label, '기기 이름');
  const model = source.deviceModel ? checkedText(source.deviceModel, '기기 모델') : '';
  const credential = String(token ?? '');
  if (!/^scall_[0-9a-f-]{36}_[0-9a-f]{64}$/.test(credential) || !credential.startsWith(`scall_${source.id}_`)) throw new Error('해당 기기의 전송용 인증키가 필요합니다.');
  let target;
  try { target = new URL(endpoint); } catch { throw new Error('전송 주소가 올바르지 않습니다.'); }
  if (target.href !== CALL_INGEST_ENDPOINT) throw new Error('등록된 수신 기록 전송 주소가 필요합니다.');
  const collectFrom = sourceTime(source.collectFrom);
  const identifier = String(source.id).toLowerCase().replace(/-/g, '_');
  const namespace = `crm_${identifier}`;
  const snapshotVariable = `${namespace}_snapshot`;
  const selectionVariable = `${namespace}_selection`;
  const rowsVariable = `${namespace}_rows`;
  const bodyVariable = `${namespace}_body`;
  const taskId = stableId(source.id) * 3;
  const idleId = taskId + 1;
  const repeatId = taskId + 2;
  const mmsTaskId = stableId(`${source.id}:mms`) * 3;
  const mmsRepeatId = mmsTaskId + 1;
  const rcsTaskId = stableId(`${source.id}:rcs`) * 3;
  const rcsRepeatId = rcsTaskId + 1;
  const timestamp = Date.now();
  const nameSuffix = `${label} [${source.id}]`;
  const projectName = `SLOPE 수신 · ${label}${model ? ` · ${model}` : ''} [${source.id}]`;
  const taskName = `통화·문자 동기화 v12 · ${nameSuffix}`;
  // Tasker may export numeric JSlet variables as rounded scientific notation.
  // Keep epoch values inside JSON and the complete SQL selection as text; both
  // survive Tasker's variable bridge without precision loss or invalid SQL.
  const preparation = `var ${snapshotVariable} = (function () {\n  var capturedNow = Date.now();\n  return JSON.stringify({now: capturedNow, since: Math.max(${collectFrom}, capturedNow - 604800000)});\n})();\nsetLocal('${snapshotVariable}', ${snapshotVariable});\nvar ${selectionVariable} = 'date >= ' + JSON.parse(${snapshotVariable}).since.toFixed(0) + ' AND type IN (1,2,3,5,6)';\nsetLocal('${selectionVariable}', ${selectionVariable});`;
  const serialization = `${callRowsToPayload.toString()}\nvar ${bodyVariable} = '';\nvar http_data = '';\nvar http_response_code = '0';\nsetLocal('${bodyVariable}', ${bodyVariable});\nsetLocal('http_data', http_data);\nsetLocal('http_response_code', http_response_code);\n${bodyVariable} = (function () {\n  var payload = callRowsToPayload(typeof ${rowsVariable} === 'undefined' ? [] : ${rowsVariable}, {collectFrom: ${collectFrom}, now: JSON.parse(${snapshotVariable}).now});\n  payload.diagnostic = {collectorVersion: 6, submitted: payload.records.length};\n  return JSON.stringify(payload);\n})();\nsetLocal('${bodyVariable}', ${bodyVariable});`;
  const result = `if (typeof http_response_code !== 'undefined' && Number(http_response_code) >= 200 && Number(http_response_code) < 300) {\n  setGlobal('CRM_${identifier}_LastSync', String(Date.now()));\n}`;
  const relevantVariables = `<StringArray sr=""><_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES0>%http_data\n응답 데이터\n서버 응답</_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES0><_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES1>%http_response_code\nHTTP 상태\n서버 응답 상태</_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES1></StringArray>`;
  const httpVariables = `<Bundle sr="arg0"><Vals sr="val"><net.dinglisch.android.tasker.RELEVANT_VARIABLES>${xml(relevantVariables)}</net.dinglisch.android.tasker.RELEVANT_VARIABLES><net.dinglisch.android.tasker.RELEVANT_VARIABLES-type>[Ljava.lang.String;</net.dinglisch.android.tasker.RELEVANT_VARIABLES-type></Vals></Bundle>`;
  const httpAction = (index, variable) => `<Action sr="act${index}" ve="7"><code>339</code>${httpVariables}${int(1, 1)}${str(2, target.href)}${str(3, `Content-Type:application/json\nAuthorization:Bearer ${credential}`)}${str(4)}${str(5, `%${variable}`)}${str(6)}${str(7)}${int(8, 30)}${int(9, 0)}${int(10, 0)}${int(11, 0)}${int(12, 1)}</Action>`;
  const smsSnapshotVariable = `${namespace}_smssnapshot`;
  const smsSelectionVariable = `${namespace}_smsselection`;
  const smsRowsVariable = `${namespace}_smsrows`;
  const smsPlanVariable = `${namespace}_smsplan`;
  const smsBodyVariable = `${namespace}_smsbody`;
  const smsStateGlobal = `CRM_${identifier}_SmsState`;
  // Explicitly publish every inter-action output. A short rejected request
  // matched the unresolved %..._smsbody length; do not rely on implicit export.
  // Keep the JS bindings equal to the explicitly published values as well:
  // Auto Exit must never restore an older injected binding after setLocal.
  const smsPreparation = `${taskerSmsSnapshot.toString()}\nvar ${smsSnapshotVariable} = JSON.stringify(taskerSmsSnapshot(global('${smsStateGlobal}'), ${collectFrom}, Date.now()));\nsetLocal('${smsSnapshotVariable}', ${smsSnapshotVariable});\nvar ${smsSelectionVariable} = JSON.parse(${smsSnapshotVariable}).selection;\nsetLocal('${smsSelectionVariable}', ${smsSelectionVariable});`;
  const smsPlanning = `${smsRowsToPlan.toString()}\nvar ${smsPlanVariable} = (function () {\n  if (typeof ${smsSnapshotVariable} === 'undefined') throw new Error('SMS_PLAN_INVALID: 문자 조회 기준이 없습니다.');\n  var plan = smsRowsToPlan(typeof ${smsRowsVariable} === 'undefined' ? [] : ${smsRowsVariable}, {snapshot: JSON.parse(${smsSnapshotVariable}), maxBatches: 1});\n  if (plan.batches.length !== 1) throw new Error('SMS_PLAN_INVALID: 문자 전송 계획이 없습니다.');\n  return JSON.stringify(plan);\n})();\nsetLocal('${smsPlanVariable}', ${smsPlanVariable});`;
  // Clear the old body and HTTP result before publishing a verified new body.
  // Send one batch per run without native loop/index-variable dependencies.
  const smsBody = `${smsBatchRequestBody.toString()}\nvar ${smsBodyVariable} = '';\nvar http_data = '';\nvar http_response_code = '0';\nsetLocal('${smsBodyVariable}', ${smsBodyVariable});\nsetLocal('http_data', http_data);\nsetLocal('http_response_code', http_response_code);\n${smsBodyVariable} = smsBatchRequestBody(typeof ${smsPlanVariable} === 'undefined' ? '' : ${smsPlanVariable}, 0);\nsetLocal('${smsBodyVariable}', ${smsBodyVariable});`;
  const smsAcknowledgement = `${acknowledgeSmsBatch.toString()}\n(function () {\n  var response;\n  try { response = JSON.parse(typeof http_data === 'undefined' ? '' : http_data); } catch (error) { throw new Error('SMS_SYNC_UNCONFIRMED: 서버 응답을 확인하지 못했습니다. 다음 실행에서 다시 시도합니다.'); }\n  var state = acknowledgeSmsBatch(JSON.parse(${smsPlanVariable}), 0, response, typeof http_response_code === 'undefined' ? 0 : http_response_code);\n  setGlobal('${smsStateGlobal}', JSON.stringify(state));\n})();`;
  const profile = (id, name, context, targetTaskId=taskId) => `<Profile sr="prof${id}" ve="2"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><flags>8</flags><id>${id}</id><mid0>${targetTaskId}</mid0><nme>${xml(name)}</nme>${context}</Profile>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<TaskerData sr="" dvi="1" tv="6.6.18">
${profile(idleId, `통화 종료 · ${nameSuffix}`, '<Event sr="con0" ve="2"><code>4</code></Event>')}
${profile(repeatId, `통화·문자 재확인 2분 · ${nameSuffix}`, '<Time sr="con0"><fh>-1</fh><fm>-1</fm><rep>2</rep><repval>2</repval><th>-1</th><tm>-1</tm></Time>')}
${profile(mmsRepeatId, `장문·사진 재확인 2분 · ${nameSuffix}`, '<Time sr="con0"><fh>-1</fh><fm>-1</fm><rep>2</rep><repval>2</repval><th>-1</th><tm>-1</tm></Time>', mmsTaskId)}
${profile(rcsRepeatId, `채팅+ 재확인 2분 · ${nameSuffix}`, '<Time sr="con0"><fh>-1</fh><fm>-1</fm><rep>2</rep><repval>2</repval><th>-1</th><tm>-1</tm></Time>', rcsTaskId)}
<Project sr="proj0" ve="2"><cdate>${timestamp}</cdate><mdate>${timestamp}</mdate><name>${xml(projectName)}</name><pids>${idleId},${repeatId},${mmsRepeatId},${rcsRepeatId}</pids><tids>${taskId},${mmsTaskId},${rcsTaskId}</tids><Img sr="icon" ve="2"><nme>mw_action_home</nme></Img></Project>
<Task sr="task${taskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${taskId}</id><nme>${xml(taskName)}</nme><pri>6</pri>
<Action sr="act0" ve="7"><code>30</code>${int(0, 0)}${int(1, 5)}${int(2, 0)}${int(3, 0)}${int(4, 0)}</Action>
${javascriptAction(1, preparation)}
<Action sr="act2" ve="7"><code>667</code>${int(0, 2)}${str(1, 'content://call_log/calls')}${str(2)}${str(3, '_id,date,type,duration,number')}${str(4, `%${selectionVariable}`)}${str(5)}${str(6, 'date DESC, _id DESC')}${str(7, '|')}${str(8, `%${rowsVariable}`)}${int(9, 0)}${int(10, 1)}</Action>
${javascriptAction(3, serialization)}
${httpAction(4, bodyVariable)}
${javascriptAction(5, result)}
${javascriptAction(6, smsPreparation)}
<Action sr="act7" ve="7"><code>667</code>${int(0, 2)}${str(1, 'content://sms')}${str(2)}${str(3, '_id,date,type,address,body')}${str(4, `%${smsSelectionVariable}`)}${str(5)}${str(6, 'date ASC, _id ASC')}${str(7, '|')}${str(8, `%${smsRowsVariable}`)}${int(9, 0)}${int(10, 1)}</Action>
${javascriptAction(8, smsPlanning)}
${javascriptAction(9, smsBody)}
${httpAction(10, smsBodyVariable)}
${javascriptAction(11, smsAcknowledgement)}
</Task>
<Task sr="task${mmsTaskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${mmsTaskId}</id><nme>${xml(`장문·사진 동기화 v9 · ${nameSuffix}`)}</nme><pri>6</pri>
${buildMmsTaskerAction({source,token:credential,endpoint:target.href,index:0})}
</Task>
<Task sr="task${rcsTaskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${rcsTaskId}</id><nme>${xml(`채팅+ 동기화 v11 · ${nameSuffix}`)}</nme><pri>6</pri>
${buildRcsTaskerAction({source,token:credential,endpoint:target.href,index:0})}
</Task>
</TaskerData>`;
}
