// Shared byte-for-byte with backend/call-inbox/message-history-policy.mjs.
export const MESSAGE_HISTORY_DEFAULT_KEYWORDS = Object.freeze(['스키', '보드', '강습', '렌탈', '곤지암', '지산', '비발디']);
export function messageHistoryDefaultKeywords(source) {
  const name = String(source?.slug || source?.label || '').toLowerCase();
  if (/캐치|catch/.test(name)) return ['캐치', '스키', '보드', '강습', '렌탈', '곤지암'];
  if (/라이즌|라이젠|raizen/.test(name)) return ['라이즌', '라이젠', ...MESSAGE_HISTORY_DEFAULT_KEYWORDS];
  return [...MESSAGE_HISTORY_DEFAULT_KEYWORDS];
}
export const MESSAGE_ATTACHMENT_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/heic', 'image/heif', 'video/mp4', 'video/3gpp', 'audio/amr', 'audio/mpeg', 'audio/wav']);

// Search-only normalization. Never replace stored text or fingerprint input.
// Self-contained for Tasker's JavaScriptlet as well as the browser importer.
export function normalizeMessageSearchText(value) {
  var text = String(value == null ? '' : value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.toLowerCase().replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '');
}

export function normalizeMessagePhone(value) {
  var phone = typeof value === 'string' ? value.trim() : '';
  if (!phone || phone.length > 80) return '';
  // Korean dual-number message addresses append one ASCII # to the number.
  // Strip only that suffix, never service codes, embedded #, or other symbols.
  var dualNumber = phone.slice(-1) === '#';
  if (dualNumber) phone = phone.slice(0, -1);
  if (!/^[+0-9().\s-]+$/.test(phone)) return '';
  phone = phone.replace(/[().\s-]/g, '');
  if (/^(?:\+82|0082)/.test(phone) || /^82\d{8,11}$/.test(phone)) {
    phone = phone.replace(/^(?:\+82|0082|82)/, '');
    if (phone.charAt(0) !== '0') phone = '0' + phone;
  } else if (phone.slice(0, 2) === '00') phone = '+' + phone.slice(2);
  if (dualNumber && phone.replace(/^\+/, '').length < 8) return '';
  return /^(?:\+[1-9]\d{7,14}|\d{3,15})$/.test(phone) ? phone : '';
}

// An explicit recovery lookup needs a complete address, never a four-digit
// suffix. This is only an import selection hint, not proof of customer identity.
export function normalizeMessageRecoveryPhone(value) {
  const phone = normalizeMessagePhone(value);
  return /^(?:\+[1-9]\d{7,14}|\d{8,15})$/.test(phone) ? phone : '';
}

// Self-contained so the same predicate can also run in Tasker's JavaScriptlet.
// Generic 지원/합격 are not recruitment evidence (e.g. 장비 픽업 지원).
export function isRecruitmentText(value) {
  return /채용|면접|이력서|구인|구직|입사\s*지원|지원서|(?:강사|직원|알바|아르바이트)\s*모집|(?:스키|보드)?\s*강사\s*(?:입사\s*)?지원|\b(?:recruit(?:ing|ment)?|interview|curriculum\s+vitae|résumé)\b|resume\.(?:pdf|docx?)\b/i.test(String(value == null ? '' : value));
}

export function normalizeMessageMime(value) {
  const mime = String(value ?? '').split(';', 1)[0].trim().toLowerCase();
  return ({'image/jpg':'image/jpeg', 'image/pjpeg':'image/jpeg', 'image/x-ms-bmp':'image/bmp', 'audio/x-wav':'audio/wav', 'audio/wave':'audio/wav', 'audio/mp3':'audio/mpeg', 'audio/mpeg3':'audio/mpeg', 'video/3gp':'video/3gpp'})[mime] || mime;
}

// Inspect bytes rather than trusting XML MIME labels or uploaded metadata.
// This is a format signature check, not a full decoder/antivirus claim.
export function sniffMessageAttachment(bytes) {
  if (!(bytes instanceof Uint8Array)) return '';
  const length = bytes.length;
  const ascii = (start, count) => String.fromCharCode(...bytes.subarray(start, start + count));
  if (length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 && ascii(12, 4) === 'IHDR') return 'image/png';
  if (length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (length >= 26 && ascii(0, 2) === 'BM') return 'image/bmp';
  if (length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio/wav';
  if (length >= 6 && ascii(0, 6) === '#!AMR\n' || length >= 9 && ascii(0, 9) === '#!AMR-WB\n') return 'audio/amr';
  if (length >= 10 && ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (length >= 4 && bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 24) !== 8 && (bytes[1] & 6) !== 0 && (bytes[2] & 240) !== 0 && (bytes[2] & 240) !== 240 && (bytes[2] & 12) !== 12) return 'audio/mpeg';
  if (length >= 16 && ascii(4, 4) === 'ftyp') {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize < 16 || boxSize > length || boxSize > 4096) return '';
    const brands = [ascii(8, 4)];
    for (let at = 16; at + 4 <= boxSize; at += 4) brands.push(ascii(at, 4));
    if (brands.some(brand => /^(avif|avis)$/.test(brand))) return '';
    if (brands.some(brand => /^(heic|heix|hevc|hevx|heis|heim)$/.test(brand))) return 'image/heic';
    if (brands.some(brand => /^(mif1|msf1)$/.test(brand))) return 'image/heif';
    if (brands.some(brand => /^3g[pe][0-9a-z]$/i.test(brand))) return 'video/3gpp';
    if (brands.some(brand => /^(isom|iso[2-9]|mp4[12]|avc1|M4V |M4A |MSNV|dash)$/.test(brand))) return 'video/mp4';
  }
  return '';
}

export function filterMessageCandidates(records, keywords = MESSAGE_HISTORY_DEFAULT_KEYWORDS) {
  const texts = record => [record.body, record.subject, ...(record.attachments || []).map(part => part.name)].filter(value => typeof value === 'string');
  const terms = (Array.isArray(keywords) ? keywords : []).filter(value => typeof value === 'string').map(normalizeMessageSearchText).filter(Boolean);
  const blocked = new Set(), related = new Set();
  for (const record of records) {
    const phone = normalizeMessagePhone(record.phone);
    if (!phone) continue;
    const content = texts(record);
    if (isRecruitmentText(content.join('\n'))) blocked.add(phone);
    // Phone-backup contact labels help locate an existing business thread but
    // are neither message text nor a verified customer name. Only the local
    // parser supplies this field, and it is discarded before any upload.
    if ([...content, record.searchContactName].some(value => { const normalized = normalizeMessageSearchText(value); return terms.some(term => normalized.includes(term)); })) related.add(phone);
  }
  const included = [];
  let excludedRecruitment = 0, excludedUnrelated = 0;
  for (const record of records) {
    const phone = normalizeMessagePhone(record.phone);
    if (blocked.has(phone)) { excludedRecruitment++; continue; }
    if (!phone || !related.has(phone)) { excludedUnrelated++; continue; }
    included.push(record);
  }
  return {records: included, excludedRecruitment, excludedUnrelated, blockedPhones: [...blocked].sort()};
}

export async function messageFingerprint(record, crypto = globalThis.crypto) {
  const canonical = [record.transport, normalizeMessagePhone(record.phone), record.type, record.occurredAt, record.body, record.subject || '', (record.attachments || []).map(part => [String(part.sha256).toLowerCase(), normalizeMessageMime(part.mime), part.size])];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
