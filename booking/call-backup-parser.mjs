// 과거 통화 백업 파서(2026-11-23): SMS Backup & Restore 의 통화기록 백업 calls.xml 을
// 브라우저 안에서만 읽어 선택 가져오기 후보를 만든다. 업로드·전송은 하지 않는다.
// XML 루트 <calls>, 요소 <call number="" duration="" date="(ms)" type="1|2|3|5|..."/>.
// type: 1 수신응답, 2 발신, 3 부재중, 5 거절. 그 외(4 음성사서함 등)는 제외한다.
const TYPE_RESULT = new Map([[1, 'answered'], [2, 'outgoing'], [3, 'missed'], [5, 'rejected'], [6, 'blocked']]);
const attribute = (element, name) => element.getAttribute(name) ?? '';

function normalizeBackupCallPhone(raw) {
  let phone = String(raw || '').replace(/[^+\d]/g, '');
  if (!phone) return '';
  if (/^(?:\+82|0082)/.test(phone)) { phone = phone.replace(/^(?:\+82|0082)/, ''); if (phone[0] !== '0') phone = '0' + phone; }
  else if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  else if (/^82\d{8,11}$/.test(phone)) phone = '0' + phone.slice(2);
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  if (/^\d{3,15}$/.test(phone)) return phone;
  return '';
}

function dayStartMs(value) {
  const at = Date.parse(`${value}T00:00:00+09:00`);
  if (!Number.isSafeInteger(at) || new Date(at + 32400000).toISOString().slice(0, 10) !== value) throw new Error('가져올 날짜를 확인해 주세요.');
  return at;
}

/** 통화기록 백업 XML → 날짜 범위 안의 저장 후보. 기본 선택은 0건(UI에서 고른다). */
// 투넘버(듀얼넘버): SMS Backup & Restore 는 둘째 회선(업무) 통화의 상대 번호 끝에 '#'을 붙인다
// (문자 쪽 sms-inbox-view 와 동일 규약). dualNumberOnly=true 면 '#' 붙은 업무번호만 남기고 '#' 제거.
export function parseCallBackupXml(raw, { sourceId, from = '2026-10-01', to, now = Date.now(), dualNumberOnly = false } = {}) {
  if (typeof sourceId !== 'string' || !sourceId) throw new Error('업장 휴대폰을 먼저 선택해 주세요.');
  const today = new Date(now + 32400000).toISOString().slice(0, 10);
  const toDay = to || today;
  const window = { start: dayStartMs(from), end: dayStartMs(toDay) + 86400000 };
  if (window.start < dayStartMs('2026-10-01')) throw new Error('2026-10-01 이후만 가져올 수 있습니다.');
  if (window.start >= window.end) throw new Error('시작일이 종료일보다 늦습니다.');
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('통화기록 백업 XML을 읽지 못했습니다. 원본 파일을 확인해 주세요.');
  const root = doc.documentElement?.tagName;
  if (root === 'smses') throw new Error('문자(SMS) 백업 파일입니다. 통화기록 백업(calls)을 선택해 주세요.');
  if (root === 'TaskerData') throw new Error('Tasker 연결 설정 XML입니다. 통화기록 백업 파일을 선택해 주세요.');
  if (root !== 'calls') throw new Error('통화기록 백업(calls) XML이 아닙니다. SMS Backup & Restore 에서 통화기록을 백업해 주세요.');
  const elements = Array.from(doc.documentElement.children);
  if (elements.some(element => element.tagName !== 'call')) throw new Error('지원하지 않는 요소가 포함된 백업입니다.');

  let rawCount = elements.length, inRange = 0, skippedUnsupported = 0, skippedNoPhone = 0, skippedOutside = 0, skippedPersonalLine = 0;
  const seen = new Set(), candidates = [];
  for (const element of elements) {
    const dateText = attribute(element, 'date');
    const at = Number(dateText);
    if (!/^\d{1,16}$/.test(dateText) || !Number.isSafeInteger(at)) throw new Error('통화의 날짜가 올바르지 않습니다. 원본 XML 백업을 확인해 주세요.');
    if (at < window.start || at >= window.end || at > now) { skippedOutside++; continue; }
    inRange++;
    const type = Number(attribute(element, 'type'));
    if (!TYPE_RESULT.has(type)) { skippedUnsupported++; continue; }
    const rawNumber = attribute(element, 'number').trim();
    const dualLine = rawNumber.endsWith('#');
    // 캐치스키(투넘버): 업무회선('#')만. 개인회선은 건너뛴다. dualNumberOnly=false 면 모두 포함하되 '#'만 제거.
    if (dualNumberOnly && !dualLine) { skippedPersonalLine++; continue; }
    const phone = normalizeBackupCallPhone(dualLine ? rawNumber.slice(0, -1) : rawNumber);
    if (!phone) { skippedNoPhone++; continue; }
    let duration = Number(attribute(element, 'duration'));
    if (!Number.isInteger(duration) || duration < 0) duration = 0;
    if (duration > 604800) duration = 604800;
    const externalId = `bkcall:${at}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    candidates.push({ externalId, phone, occurredAt: new Date(at).toISOString(), durationSeconds: duration, result: TYPE_RESULT.get(type), contactName: attribute(element, 'contact_name').trim().slice(0, 60) });
  }
  candidates.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.externalId.localeCompare(b.externalId));
  const issues = [];
  if (dualNumberOnly) issues.push(`투넘버 업무회선(끝 #)만 가져옵니다. 개인회선 통화 ${skippedPersonalLine}건은 제외했습니다.`);
  if (skippedUnsupported) issues.push(`저장 대상이 아닌 통화 유형 ${skippedUnsupported}건은 제외했습니다.`);
  if (skippedNoPhone) issues.push(`번호를 확인할 수 없는 통화 ${skippedNoPhone}건은 제외했습니다.`);
  // 서버 RPC는 [from, to) 반열림 경계를 요구한다. window.start/end 는 정확한 KST 자정이므로
  // 그대로 ISO(Z)로 넘기면 'Asia/Seoul 자정' 일 경계 검증을 통과한다. toBoundary 는 종료일 '다음날' 자정.
  return { format: 'slope-call-backup-v1', sourceId, from, to: toDay,
    fromBoundary: new Date(window.start).toISOString(), toBoundary: new Date(window.end).toISOString(),
    rawCount, inRange, skippedOutside, records: candidates, issues };
}
