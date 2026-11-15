// A manual, local-only export. It never changes the live v5 project or sends
// messages to a server. Candidates must be reviewed in the owner web screen.
import {isRecruitmentText, normalizeMessagePhone, normalizeMessageSearchText, messageHistoryDefaultKeywords, MESSAGE_HISTORY_DEFAULT_KEYWORDS} from './message-history-policy.mjs?v=6';
export const SMS_HISTORY_DEFAULT_KEYWORDS = MESSAGE_HISTORY_DEFAULT_KEYWORDS;
export const SMS_HISTORY_MAX_RECORDS = 10000;
export const SMS_HISTORY_MAX_BYTES = 10 * 1024 * 1024;

const xml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[char]));
const str = (arg, value = '') => `<Str sr="arg${arg}" ve="3">${xml(value)}</Str>`;
const int = (arg, value) => `<Int sr="arg${arg}" val="${value}"/>`;

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('가져올 날짜를 확인해 주세요.');
  const at = Date.parse(`${value}T00:00:00+09:00`);
  if (!Number.isSafeInteger(at) || new Date(at + 32400000).toISOString().slice(0, 10) !== value) throw new Error('가져올 날짜를 확인해 주세요.');
  return at;
}

function optionsFor({source, from, to, keywords = messageHistoryDefaultKeywords(source), now = Date.now()} = {}) {
  if (!source || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.id ?? '')) throw new Error('내보낼 휴대폰을 먼저 선택해 주세요.');
  const label = String(source.label ?? '').trim();
  if (!label || label.length > 160 || /[\u0000-\u001f\ufffe\uffff]/.test(label)) throw new Error('휴대폰 이름을 확인해 주세요.');
  const fromMs = dateValue(from), toMs = dateValue(to) + 86400000 - 1;
  const today = new Date(now + 32400000).toISOString().slice(0, 10);
  if (from < '2026-10-01' || from > to || to > today) throw new Error('2026년 10월 1일부터 오늘까지의 날짜를 선택해 주세요.');
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 20) throw new Error('찾을 단어를 1개 이상, 20개 이하로 입력해 주세요.');
  const terms = [...new Set(keywords.map(value => {
    if (typeof value !== 'string') throw new Error('찾을 단어를 확인해 주세요.');
    const term = value.trim();
    if (term.length < 2 || term.length > 40 || !normalizeMessageSearchText(term) || /[%\u0000-\u001f\ufffe\uffff]/.test(term)) throw new Error('찾을 단어는 2~40자로 입력해 주세요.');
    return term;
  }))];
  return {sourceId: source.id, label, from, to, fromMs, toMs, keywords: terms};
}

function safeFilenameLabel(source) {
  return String(source?.label ?? '휴대폰').replace(/[^\p{L}\p{N}_-]/gu, '-').replace(/-+/g, '-').slice(0, 32) || '휴대폰';
}

export function smsHistoryExportFilename({source, from, to} = {}) {
  const options = optionsFor({source, from, to});
  return `SLOPE-문자후보-${safeFilenameLabel(source)}-${options.from.replace(/-/g, '')}-${options.to.replace(/-/g, '')}-${options.sourceId.slice(0, 8)}.json`;
}

export function smsHistoryTaskerFilename({source, from, to} = {}) {
  return smsHistoryExportFilename({source, from, to}).replace('문자후보', '과거문자').replace(/\.json$/, '.prj.xml');
}

// Self-contained ES5-compatible helper: copied verbatim into the JavaScriptlet.
// Only the first four separators are structural, preserving pipes/newlines in
// the entire SMS body exactly as in the live collector.
export function smsHistoryRowsToExport(rows, options) {
  if (!Array.isArray(rows)) throw new Error('HISTORY_ROWS_INVALID: 문자 조회 결과를 확인해 주세요.');
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
  var compareId = function (left, right) {
    left = String(left).replace(/^0+(?=\d)/, ''); right = String(right).replace(/^0+(?=\d)/, '');
    return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
  };
  var terms = options.keywords.map(function (term) { return normalizeMessageSearchText(term); }).filter(function (term) { return term.length > 0; });
  if (!terms.length) throw new Error('HISTORY_KEYWORDS_INVALID: 찾을 단어를 확인해 주세요.');
  var records = [], seen = Object.create(null), blockedPhones = Object.create(null), relatedPhones = Object.create(null);
  var bytes = 0, skipped = 0, excludedRecruitment = 0, excludedUnrelated = 0, inRangeRecords = 0, duplicateCount = 0;
  var until = Math.min(options.toMs, options.now);
  for (var before = 0; before < rows.length; before++) {
    var preliminary = String(rows[before]).match(/^(\d{1,20})\|(\d{1,16})\|([12])\|([^|]*)\|([\s\S]*)$/);
    if (!preliminary) continue;
    var preliminaryAt = Number(preliminary[2]);
    if (preliminaryAt < options.fromMs || preliminaryAt > until) continue;
    var preliminaryPhone = normalizeMessagePhone(preliminary[4]);
    if (!preliminaryPhone) continue;
    if (isRecruitmentText(preliminary[5])) blockedPhones[preliminaryPhone] = true;
    var searchable = normalizeMessageSearchText(preliminary[5]);
    if (terms.some(function (term) { return searchable.indexOf(term) >= 0; })) relatedPhones[preliminaryPhone] = true;
  }
  for (var index = 0; index < rows.length; index++) {
    var raw = String(rows[index]), fields = [], start = 0;
    for (var column = 0; column < 4; column++) {
      var divider = raw.indexOf('|', start);
      if (divider < 0) break;
      fields.push(raw.slice(start, divider));
      start = divider + 1;
    }
    if (fields.length !== 4 || !/^\d{1,20}$/.test(fields[0]) || !/^\d{1,16}$/.test(fields[1]) || !/^\d+$/.test(fields[2])) throw new Error('HISTORY_ROW_FORMAT: 문자 조회 결과를 해석하지 못했습니다. 파일은 저장하지 않았습니다.');
    var at = Number(fields[1]);
    if (!isFinite(at) || at > 9007199254740991) throw new Error('HISTORY_ROW_FORMAT: 문자 날짜를 확인하지 못했습니다.');
    var body = raw.slice(start);
    if (at < options.fromMs || at > until) continue;
    inRangeRecords++;
    var type = Number(fields[2]), phone = fields[3].trim();
    var canonical = normalizeMessagePhone(phone);
    if ((type !== 1 && type !== 2) || !canonical) { skipped++; continue; }
    if (blockedPhones[canonical]) { excludedRecruitment++; continue; }
    if (!relatedPhones[canonical]) { excludedUnrelated++; continue; }
    var invalidUnicode = false;
    for (var character = 0; character < body.length; character++) {
      var unit = body.charCodeAt(character);
      if (unit >= 55296 && unit <= 56319) {
        var nextUnit = body.charCodeAt(character + 1);
        if (!(nextUnit >= 56320 && nextUnit <= 57343)) { invalidUnicode = true; break; }
        character++;
      } else if (unit >= 56320 && unit <= 57343) { invalidUnicode = true; break; }
    }
    if (body.length > 20000 || invalidUnicode || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new Error('HISTORY_BODY_INVALID: 가져올 수 없는 문자 본문이 있습니다. 날짜 범위를 좁혀 주세요.');
    var record = {externalId: fields[0], phone: canonical, occurredAt: at, type: type, body: body};
    var serialized = JSON.stringify(record);
    if (seen[record.externalId]) {
      if (seen[record.externalId] !== serialized) throw new Error('HISTORY_ID_CONFLICT: 같은 문자 번호의 내용이 다릅니다. 내보내기를 다시 실행해 주세요.');
      duplicateCount++;
      continue;
    }
    seen[record.externalId] = serialized;
    records.push(record);
    bytes += utf8Bytes(serialized) + 1;
    if (records.length > 10000 || bytes > 10485760) throw new Error('HISTORY_EXPORT_TOO_LARGE: 후보가 1만 건 또는 10MB를 넘습니다. 날짜 범위를 나누어 가져와 주세요. 파일은 일부만 저장하지 않습니다.');
  }
  records.sort(function (a, b) { return a.occurredAt - b.occurredAt || compareId(a.externalId, b.externalId); });
  var file = {format: 'slope-sms-history-v1', sourceId: options.sourceId, from: options.from, to: options.to, exportedAt: new Date(options.now).toISOString(), keywords: options.keywords, records: records, rawRecords: rows.length, inRangeRecords: inRangeRecords, duplicateCount: duplicateCount, skippedUnsupported: skipped, excludedRecruitment: excludedRecruitment, excludedUnrelated: excludedUnrelated};
  var output = JSON.stringify(file);
  if (utf8Bytes(output) > 10485760) throw new Error('HISTORY_EXPORT_TOO_LARGE: 후보 파일이 10MB를 넘습니다. 날짜 범위를 나누어 가져와 주세요.');
  return output;
}

function stableTaskId(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  // Distinct from the live project's task/profile ID range (< 1,500,030,003).
  return 1600000000 + hash % 300000000;
}

function javascriptAction(index, code) {
  return `<Action sr="act${index}" ve="7"><code>129</code>${str(0, code)}${str(1)}${int(2, 1)}${int(3, 90)}</Action>`;
}

/**
 * Official JS API: writeFile(path, text, append) returns success; readFile(path)
 * reads back contents. Relative paths resolve from shared internal storage.
 * https://tasker.joaoapps.com/userguide/en/javascript.html#writeFile
 * SQL/JavaScriptlet XML uses the same verified action layouts as the live v5
 * export. Android SMS and storage permissions must be granted on the device.
 */
export function buildSmsHistoryExportProject({source, from, to, keywords} = {}) {
  const options = optionsFor({source, from, to, keywords});
  const namespace = `hist_${source.id.toLowerCase().replace(/-/g, '_')}`;
  const rowsVariable = `${namespace}_rows`;
  const taskId = stableTaskId(`sms-history:${source.id}`);
  const timestamp = Date.now();
  const filename = smsHistoryExportFilename({source, from, to});
  const path = `Download/${filename}`;
  const select = `date >= ${options.fromMs.toFixed(0)} AND date <= ${options.toMs.toFixed(0)} AND type IN (1,2)`;
  const code = `${isRecruitmentText.toString()}\n${normalizeMessagePhone.toString()}\n${normalizeMessageSearchText.toString()}\n${smsHistoryRowsToExport.toString()}\n(function () {\n  var options = ${JSON.stringify(options)};\n  options.now = Date.now();\n  var output = smsHistoryRowsToExport(typeof ${rowsVariable} === 'undefined' ? [] : ${rowsVariable}, options);\n  var path = ${JSON.stringify(path)};\n  var ok = writeFile(path, output, false);\n  if (ok !== true && ok !== 'true') throw new Error('HISTORY_FILE_WRITE: Tasker의 파일 접근 권한을 허용한 뒤 다시 실행해 주세요.');\n  if (readFile(path) !== output) throw new Error('HISTORY_FILE_VERIFY: 저장된 파일을 확인하지 못했습니다. 파일 접근 권한을 확인하고 다시 실행해 주세요.');\n  var result = JSON.parse(output);\n  flashLong('문자 후보 ' + result.records.length + '건 저장 완료. 다운로드 폴더의 파일을 SLOPE 과거 문자 가져오기에서 선택하세요.' + (result.excludedRecruitment ? ' 채용·면접 대화 제외: ' + result.excludedRecruitment + '건' : '') + (result.skippedUnsupported ? ' 번호 형식 등으로 제외: ' + result.skippedUnsupported + '건' : ''));\n})();`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TaskerData sr="" dvi="1" tv="6.3.5">
<Project sr="proj0" ve="2"><cdate>${timestamp}</cdate><mdate>${timestamp}</mdate><name>${xml(`SLOPE 과거문자 · ${options.label} [${source.id}]`)}</name><tids>${taskId}</tids><Img sr="icon" ve="2"><nme>mw_action_home</nme></Img></Project>
<Task sr="task${taskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${taskId}</id><nme>${xml(`과거문자 후보 저장 · ${options.label} · ${from}~${to}`)}</nme><pri>6</pri>
<Action sr="act0" ve="7"><code>667</code>${int(0, 2)}${str(1, 'content://sms')}${str(2)}${str(3, '_id,date,type,address,body')}${str(4, select)}${str(5)}${str(6, 'date ASC, _id ASC')}${str(7, '|')}${str(8, `%${rowsVariable}`)}${int(9, 0)}${int(10, 1)}</Action>
${javascriptAction(1, code)}
</Task>
</TaskerData>`;
}
