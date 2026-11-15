import {MESSAGE_HISTORY_DEFAULT_KEYWORDS, MESSAGE_ATTACHMENT_MIMES, normalizeMessagePhone, normalizeMessageRecoveryPhone, normalizeMessageSearchText, normalizeMessageMime, sniffMessageAttachment, filterMessageCandidates, messageFingerprint} from './message-history-policy.mjs?v=6';

export const MESSAGE_BACKUP_MAX_BYTES = 128 * 1024 * 1024;
export const MESSAGE_BACKUP_MAX_RECORDS = 20000;
export const MESSAGE_PART_MAX_BYTES = 8 * 1024 * 1024;
export const MESSAGE_MEDIA_MAX_BYTES = 24 * 1024 * 1024;
export const MESSAGE_MAX_PARTS = 20;

function validText(value, label) {
  if (typeof value !== 'string' || value.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} 형식을 확인해 주세요. 문자 본문은 20,000자까지 가져올 수 있습니다.`);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label}의 문자 인코딩을 확인해 주세요.`);
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error(`${label}의 문자 인코딩을 확인해 주세요.`);
  }
  return value;
}

function checkedWindow(from, to, now) {
  const parseDay = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('가져올 날짜를 확인해 주세요.');
    const at = Date.parse(`${value}T00:00:00+09:00`);
    if (!Number.isSafeInteger(at) || new Date(at + 32400000).toISOString().slice(0, 10) !== value) throw new Error('가져올 날짜를 확인해 주세요.');
    return at;
  };
  const start = parseDay(from), end = parseDay(to) + 86400000;
  const today = new Date(now + 32400000).toISOString().slice(0, 10);
  if (from < '2026-10-01' || from > to || to > today) throw new Error('2026년 10월 1일부터 오늘까지의 날짜를 선택해 주세요.');
  return {start, end};
}

const children = (node, tag) => Array.from(node?.children || []).filter(child => child.tagName === tag);
const attribute = (node, name) => node.getAttribute(name) ?? '';
const meaningful = value => value && value !== 'null' && value !== 'insert-address-token';
const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

const markedAttribute = value => !['', 'null', '0', 'false'].includes(String(value).trim().toLowerCase());
function mmsSubject(element) {
  const raw = attribute(element, 'sub');
  if (raw === 'null') return '';
  // Some Android backups expose declared UTF-8 bytes as Latin1 characters.
  // Match the native collector without guessing other charsets or rewriting
  // already decoded Unicode. Require an exact byte round trip, including BOM.
  if (attribute(element, 'sub_cs') !== '106' || !raw || Array.from(raw).some(character => character.charCodeAt(0) > 255)) return raw;
  try {
    const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
    const encoded = new TextEncoder().encode(decoded);
    return encoded.length === bytes.length && encoded.every((byte, index) => byte === bytes[index]) ? decoded : raw;
  } catch { return raw; }
}

function unsupportedChatMetadata(element) {
  return attribute(element, 'status') === '11' || attribute(element, 're_type') === '7' || Array.from(element.attributes).some(({name, value}) => /^(?:group|is_group|chatbot|is_chatbot|bot(?:_|$)|is_bot)/i.test(name) && markedAttribute(value));
}
function chatPeerMatches(element, phone) {
  if (!normalizeMessageRecoveryPhone(phone)) return false;
  for (const name of ['address', 'recipients']) {
    const value = attribute(element, name);
    if (value && normalizeMessageRecoveryPhone(value) !== phone) return false;
  }
  const remote = attribute(element, 'remote_uri');
  return !remote || /^tel:/i.test(remote) && normalizeMessageRecoveryPhone(remote.slice(4)) === phone;
}

function completeChatSms(element, phone) {
  // SMS Backup & Restore can export a complete chat text as an ordinary SMS
  // row. The chat marker alone does not mean its body is unavailable. Admit
  // only a plain, one-to-one text; never turn a file/event placeholder into SMS.
  const body = attribute(element, 'body');
  if (![1, 2].includes(Number(attribute(element, 'type'))) || !body.trim() || body.trim() === 'null' || normalizeMessageMime(attribute(element, 'content_type')) !== 'text/plain' || element.children.length || !chatPeerMatches(element, phone)) return false;
  if (/^(?:content|file):\/\//i.test(body.trim())) return false;
  return !Array.from(element.attributes).some(({name, value}) => /^(?:_?data|file|attachment|thumbnail|is_file_?transfer)/i.test(name) && markedAttribute(value));
}

function mmsPhone(element) {
  const addrRoot = children(element, 'addrs')[0];
  const allAddrs = children(addrRoot, 'addr').map(addr => ({raw: attribute(addr, 'address').trim(), type: attribute(addr, 'type')})).filter(addr => addr.raw && addr.raw !== 'null');
  const addrs = allAddrs.filter(addr => meaningful(addr.raw));
  const top = attribute(element, 'address').split('~').map(value => value.trim()).filter(meaningful);
  const from = [...new Set(addrs.filter(addr => addr.type === '137').map(addr => normalizeMessagePhone(addr.raw) || addr.raw))];
  const to = [...new Set(addrs.filter(addr => addr.type === '151').map(addr => normalizeMessagePhone(addr.raw) || addr.raw))];
  const cc = addrs.filter(addr => ['129', '130'].includes(addr.type));
  // The own-number token still counts as a participant: own token + another
  // TO recipient in an incoming message is a group, not a one-to-one thread.
  const allTo = new Set(allAddrs.filter(addr => addr.type === '151').map(addr => normalizeMessagePhone(addr.raw) || addr.raw));
  const allFrom = new Set(allAddrs.filter(addr => addr.type === '137').map(addr => normalizeMessagePhone(addr.raw) || addr.raw));
  if (top.length > 1 || from.length > 1 || to.length > 1 || allTo.size > 1 || allFrom.size > 1 || cc.length) return {group: true, phone: '', diagnosticPhones: [...new Set([...top,...addrs.map(addr=>addr.raw)].map(normalizeMessagePhone).filter(Boolean))]};
  const type = Number(attribute(element, 'msg_box'));
  const counterpart = type === 1 ? from : to;
  return {group: false, phone: normalizeMessagePhone(counterpart[0] || top[0] || '')};
}

function attachmentName(part, index) {
  const raw = [attribute(part, 'cl'), attribute(part, 'name')].find(meaningful) || `첨부-${index + 1}`;
  return raw.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) || `첨부-${index + 1}`;
}

function decodeAttachment(part) {
  const base64 = part.base64.replace(/\s/g, '');
  if (!base64) throw new Error('첨부 내용이 백업에 없습니다. 사진·미디어 포함 옵션을 켜고 다시 백업해 주세요.');
  if (base64.length > Math.ceil(MESSAGE_PART_MAX_BYTES / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('첨부 파일이 8MB를 넘거나 Base64 형식이 올바르지 않습니다.');
  let binary;
  try { binary = atob(base64); } catch { throw new Error('첨부 파일의 Base64 내용을 읽을 수 없습니다.'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (!bytes.length || bytes.length > MESSAGE_PART_MAX_BYTES) throw new Error('첨부 파일은 1바이트 이상, 8MB 이하만 가져올 수 있습니다.');
  const actual = sniffMessageAttachment(bytes);
  const declared = normalizeMessageMime(part.mime);
  if (!actual || !MESSAGE_ATTACHMENT_MIMES.includes(actual)) throw new Error('지원하지 않는 첨부 파일 형식입니다. 이 문자는 첨부를 누락한 채 저장하지 않습니다.');
  const heifFamily = ['image/heic', 'image/heif'].includes(declared) && ['image/heic', 'image/heif'].includes(actual);
  if (declared && declared !== 'application/octet-stream' && declared !== actual && !heifFamily) throw new Error('첨부 파일의 실제 형식과 백업에 표시된 형식이 다릅니다.');
  return {bytes, base64, mime: actual};
}

/**
 * Read SMS Backup & Restore XML locally. Nothing in this module uploads data.
 * Source schema: https://www.synctech.com.au/sms-backup-restore/fields-in-xml-backup-files/
 * Both SMS and MMS XML dates are milliseconds; Android's native MMS provider
 * uses seconds, but these backups have already converted them.
 */
export async function parseMessageBackupXml(raw, {sourceId, from = '2026-10-01', to, keywords = MESSAGE_HISTORY_DEFAULT_KEYWORDS, recoveryPhone, now = Date.now(), DOMParser: Parser = globalThis.DOMParser, crypto = globalThis.crypto} = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('SMS Backup & Restore XML 파일을 선택해 주세요.');
  if (raw.length > MESSAGE_BACKUP_MAX_BYTES || new TextEncoder().encode(raw).byteLength > MESSAGE_BACKUP_MAX_BYTES) throw new Error('백업 파일은 128MB까지 열 수 있습니다. 백업 날짜 범위를 나누어 주세요.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw)) throw new Error('DOCTYPE 또는 ENTITY가 포함된 XML은 가져올 수 없습니다.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId ?? '')) throw new Error('가져올 휴대폰을 선택해 주세요.');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('현재 시각을 확인해 주세요.');
  const window = checkedWindow(from, to, now);
  const targetPhone = recoveryPhone == null ? '' : normalizeMessageRecoveryPhone(recoveryPhone);
  if (recoveryPhone != null && !targetPhone) throw new Error('복구할 전화번호 전체를 입력해 주세요. 끝번호만으로 문자를 가져오지 않습니다.');
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 20 || keywords.some(term => typeof term !== 'string' || term.trim().length < 2 || term.trim().length > 40 || !normalizeMessageSearchText(term) || /[\u0000-\u001f\u007f]/.test(term))) throw new Error('찾을 단어를 2~40자로, 1~20개 입력해 주세요.');
  if (typeof Parser !== 'function' || !crypto?.subtle) throw new Error('이 브라우저에서 백업 파일을 읽을 수 없습니다. 최신 Chrome을 사용해 주세요.');
  const document = new Parser().parseFromString(raw, 'application/xml');
  if(document.documentElement?.tagName==='TaskerData')throw new Error('Tasker 연결 설정 XML입니다. 문자 내용이 담긴 SMS Backup & Restore의 sms-… .xml 백업을 선택해 주세요. 장문·사진 MMS와 첨부 미디어를 포함해 백업해야 합니다.');
  if (document.getElementsByTagName('parsererror').length || document.documentElement?.tagName !== 'smses') throw new Error('SMS Backup & Restore의 올바른 XML 백업 파일인지 확인해 주세요.');
  const elements = Array.from(document.documentElement.children);
  if (elements.length > MESSAGE_BACKUP_MAX_RECORDS) throw new Error('백업에 20,000건이 넘습니다. 날짜 범위를 나누어 주세요.');
  if (elements.some(element => !['sms', 'mms'].includes(element.tagName))) throw new Error('지원하지 않는 메시지 요소가 포함되어 있습니다.');
  const pending = [], issues = [], diagnosticByPhone = new Map();
  const localContactName = element => {
    const value=attribute(element,'contact_name').trim();
    return value && value!=='null' && value.length<=200 && !/[\u0000-\u001f\u007f]/.test(value) ? value : '';
  };
  const diagnostic = phone => {
    if (!phone) return null;
    if (!diagnosticByPhone.has(phone)) diagnosticByPhone.set(phone,{phone,contactNames:[],total:0,sms:0,mms:0,inRange:0,outsideWindow:0,keywordExcluded:0,recruitmentExcluded:0,unsupported:0,groups:0,rcs:0,included:0,duplicateCount:0});
    return diagnosticByPhone.get(phone);
  };
  const increment = (phones,key) => {for(const phone of phones){const item=diagnostic(phone);if(item)item[key]++;}};
  const transportCounts={sms:0,mms:0},inRangeTransportCounts={sms:0,mms:0};
  let skippedGroups = 0, skippedUnsupported = 0, skippedOutsideWindow = 0, skippedRcs = 0, inRangeRecords = 0;
  for (const element of elements) {
    transportCounts[element.tagName]++;
    const address = element.tagName==='sms' ? {group:false,phone:normalizeMessagePhone(attribute(element,'address'))} : mmsPhone(element);
    const diagnosticPhones = address.group ? address.diagnosticPhones : address.phone ? [address.phone] : [];
    const searchContactName = localContactName(element);
    for(const phone of diagnosticPhones){
      const item=diagnostic(phone);item.total++;item[element.tagName]++;
      if(searchContactName && item.contactNames.length<10 && !item.contactNames.includes(searchContactName))item.contactNames.push(searchContactName);
    }
    const at = Number(attribute(element, 'date'));
    if (!/^\d{1,16}$/.test(attribute(element, 'date')) || !Number.isSafeInteger(at)) throw new Error('문자의 날짜가 올바르지 않습니다. 원본 XML 백업을 확인해 주세요.');
    if (at < window.start || at >= window.end || at > now) { skippedOutsideWindow++; increment(diagnosticPhones,'outsideWindow'); continue; }
    inRangeRecords++;
    increment(diagnosticPhones,'inRange');
    inRangeTransportCounts[element.tagName]++;
    const chat = attribute(element, 's_chat') === '1';
    const unsupportedChat = chat && (unsupportedChatMetadata(element) || (element.tagName === 'sms' ? !completeChatSms(element, address.phone) : !address.group && !chatPeerMatches(element, address.phone)));
    if (unsupportedChat || /@(?:bot\.)?rcs\.google\.com/i.test(attribute(element, 'address'))) { skippedRcs++; increment(diagnosticPhones,'rcs'); continue; }
    const transport = element.tagName;
    const type = Number(attribute(element, transport === 'sms' ? 'type' : 'msg_box'));
    if (![1, 2].includes(type)) { skippedUnsupported++; increment(diagnosticPhones,'unsupported'); continue; }
    let phone, body = '', subject = '', attachments = [], invalidPart = '';
    if (transport === 'sms') {
      phone = address.phone;
      body = validText(attribute(element, 'body'), 'SMS 본문');
    } else {
      if (address.group) { skippedGroups++; increment(diagnosticPhones,'groups'); continue; }
      phone = address.phone;
      subject = validText(mmsSubject(element), 'MMS 제목');
      const partsRoot = children(element, 'parts')[0];
      if (!partsRoot) invalidPart = 'MMS 본문·첨부 목록이 백업에 없습니다.';
      const parts = children(partsRoot, 'part').map((part, index) => ({part, index, seq: Number(attribute(part, 'seq')) || 0})).sort((a, b) => a.seq - b.seq || a.index - b.index);
      const texts = [];
      for (const {part, index} of parts) {
        const mime = normalizeMessageMime(attribute(part, 'ct'));
        if (mime === 'application/smil') continue;
        if (['text/plain', 'text/html'].includes(mime)) {
          if (!part.hasAttribute('text')) invalidPart = '텍스트 파트의 본문이 백업에 없습니다.';
          else texts.push(attribute(part, 'text'));
        } else attachments.push({name: attachmentName(part, index), mime, base64: attribute(part, 'data')});
      }
      body = validText(texts.join('\n'), 'MMS 본문');
      if (!body && !subject && !attachments.length) invalidPart = '본문이나 첨부가 없는 MMS입니다.';
    }
    if (!phone) { skippedUnsupported++; issues.push('상대방 전화번호를 확인할 수 없는 문자를 제외했습니다.'); continue; }
    pending.push({transport, phone, occurredAt: at, type, body, subject, attachments, invalidPart, searchContactName});
  }
  // Recruitment is evaluated against all date-window text/filenames before any
  // attachment is decoded, hashed, previewed or uploaded.
  const filtered = filterMessageCandidates(pending, keywords);
  const blockedPhones=new Set(filtered.blockedPhones),includedBeforeRecovery=new Set(filtered.records);
  for(const candidate of pending){
    if(blockedPhones.has(candidate.phone))increment([candidate.phone],'recruitmentExcluded');
    else if(!includedBeforeRecovery.has(candidate))increment([candidate.phone],'keywordExcluded');
  }
  // Recovery is a local, explicitly requested selection of one exact number.
  // It can bypass only keyword filtering, never recruitment/date/group/media
  // checks. The normal UI still requires selecting records and importing them.
  const selectedCandidates=targetPhone ? pending.filter(candidate=>candidate.phone===targetPhone&&!blockedPhones.has(candidate.phone)) : filtered.records;
  const records = [], seen = new Set();
  let duplicateCount = 0;
  for (const candidate of selectedCandidates) {
    let media;
    try {
      if (candidate.invalidPart) throw new Error(candidate.invalidPart);
      if (candidate.subject.length > 1000) throw new Error('MMS 제목이 1,000자를 넘습니다. 제목을 잘라 저장하지 않고 이 문자를 제외했습니다.');
      if (candidate.attachments.length > MESSAGE_MAX_PARTS) throw new Error('첨부가 20개를 넘습니다. 이 문자는 일부 첨부만 저장하지 않습니다.');
      media = [];
      let totalBytes = 0;
      for (const attachment of candidate.attachments) {
        const decoded = decodeAttachment(attachment);
        totalBytes += decoded.bytes.length;
        if (totalBytes > MESSAGE_MEDIA_MAX_BYTES) throw new Error('한 문자의 첨부 용량이 24MB를 넘습니다.');
        media.push({name: attachment.name, mime: decoded.mime, size: decoded.bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', decoded.bytes)), base64: decoded.base64});
      }
    } catch (error) {
      skippedUnsupported++;
      increment([candidate.phone],'unsupported');
      issues.push(`${new Date(candidate.occurredAt + 32400000).toISOString().slice(0, 10)} · 끝번호 ${candidate.phone.slice(-4)}: ${error.message}`);
      continue;
    }
    const record = {externalId: '', transport: candidate.transport, phone: candidate.phone, occurredAt: candidate.occurredAt, type: candidate.type, body: candidate.body, subject: candidate.subject, attachments: media};
    record.externalId = `backup-${record.transport}:${await messageFingerprint(record, crypto)}`;
    if (seen.has(record.externalId)) { duplicateCount++; increment([candidate.phone],'duplicateCount'); continue; }
    seen.add(record.externalId);
    records.push(record);
    increment([candidate.phone],'included');
  }
  records.sort((left, right) => left.occurredAt - right.occurredAt || left.externalId.localeCompare(right.externalId));
  if (skippedGroups) issues.push(`단체 MMS ${skippedGroups}건은 고객 한 명에게 임의 배정하지 않고 제외했습니다.`);
  if (skippedRcs) issues.push(`원문·상대방을 완전하게 확인할 수 없는 RCS/채팅+ 메시지 ${skippedRcs}건은 이번 가져오기에서 제외했습니다.`);
  return {format: 'slope-message-backup-v1', sourceId, from, to, rawRecords: elements.length, inRangeRecords, transportCounts,inRangeTransportCounts,records, phoneDiagnostics:[...diagnosticByPhone.values()].sort((a,b)=>a.phone.localeCompare(b.phone)), ...(targetPhone?{recoveryPhone:targetPhone}:{}), excludedRecruitment: filtered.excludedRecruitment, excludedUnrelated: targetPhone?pending.filter(candidate=>!includedBeforeRecovery.has(candidate)&&candidate.phone!==targetPhone&&!blockedPhones.has(candidate.phone)).length:filtered.excludedUnrelated, skippedUnsupported, skippedGroups, skippedOutsideWindow, skippedRcs, duplicateCount, issues};
}
