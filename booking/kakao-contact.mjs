// 카카오 ID 연락처 (2026-11-17): 해외 거주 등 전화가 없는 고객은 연락처 자리에
// '카카오:아이디'를 기록한다. 전화번호가 아니므로 알림톡·문자·고객 후보 대조는
// 자연히 건너뛰고, 서버는 private.slope_booking_kakao_contact 로 같은 규칙을 검증한다.
// (backend/customer-kakao-contact.sql — 값 규칙을 바꾸면 양쪽을 함께 바꿀 것)
const KAKAO_CONTACT=/^(?:카카오톡|카카오|kakao)\s*[:：]\s*(.+)$/iu;

/** '카카오:아이디' 형태면 아이디를, 아니면 null 을 돌려준다. */
export function kakaoContactId(value){
  const match=String(value??'').trim().match(KAKAO_CONTACT);
  if(!match)return null;
  const id=match[1].trim();
  return id&&id.length<=40&&!/[\u0000-\u001F]/u.test(id)?id:null;
}

/** 아이디 입력값을 저장용 '카카오:아이디' 로 만든다. 빈 값은 빈 문자열. */
export function kakaoContactValue(id){
  const text=String(id??'').trim();
  return text?`카카오:${kakaoContactId(text)??text}`:'';
}

/** 표시용 라벨. 카카오 값이 아니면 빈 문자열(전화 포맷터와 || 로 조합). */
export function kakaoContactLabel(value){
  const id=kakaoContactId(value);
  return id?`카카오 ${id}`:'';
}
