/** Known labels are normalized for display; callers preserve saved raw aliases until edited. */
export const BOOKING_COMPANIES=Object.freeze([
  '곤지암 캐치스키',
  '곤지암 라이즌',
  '곤지암 코코넛렌탈샵',
  '지산 라이즌스키',
  // 2026-11-26 사장 정정: 비발디는 '지산 비발디스키'(오기)가 아니라 별도 지점 — 라이즌·캐치 각각.
  '비발디 라이즌스키',
  '비발디 캐치스키',
]);
const key=value=>String(value??'').normalize('NFKC').replace(/\s+/gu,'');
const aliases=new Map([
 ...['캐치','캐치스키','캐치곤지암','곤지암캐치','캐치스키곤지암','곤지암캐치스키'].map(value=>[value,BOOKING_COMPANIES[0]]),
 ...['라이즌곤지암','곤지암라이즌','라이즌스키곤지암','곤지암라이즌스키'].map(value=>[value,BOOKING_COMPANIES[1]]),
 ...['코코넛렌탈샵곤지암','곤지암코코넛렌탈샵'].map(value=>[value,BOOKING_COMPANIES[2]]),
 ...['라이즌지산','지산라이즌','라이즌스키지산','지산라이즌스키'].map(value=>[value,BOOKING_COMPANIES[3]]),
 // 구표기('지산 비발디스키' 계열)로 저장된 과거 값도 새 라벨로 정규화된다.
 ...['비발디스키지산','지산비발디스키','지산비발디','비발디지산','라이즌비발디','비발디라이즌','라이즌스키비발디','비발디라이즌스키'].map(value=>[value,BOOKING_COMPANIES[4]]),
 ...['캐치비발디','비발디캐치','캐치스키비발디','비발디캐치스키'].map(value=>[value,BOOKING_COMPANIES[5]]),
 // 리조트 공식 명칭 '비발디파크' 표기 변형(2026-11-27 감사 보강). 단독 '비발디파크'는 브랜드 불명이라 미매핑 원칙 유지.
 ...['비발디파크라이즌','비발디파크라이즌스키','라이즌비발디파크','라이즌스키비발디파크'].map(value=>[value,BOOKING_COMPANIES[4]]),
 ...['비발디파크캐치','비발디파크캐치스키','캐치비발디파크','캐치스키비발디파크'].map(value=>[value,BOOKING_COMPANIES[5]]),
]);
export function normalizeBookingCompany(value){return aliases.get(key(value))||String(value??'').trim();}
export function bookingCompanyOptions(legacy=[]){
  return [...new Set([...BOOKING_COMPANIES,...legacy.map(normalizeBookingCompany).filter(Boolean)])];
}
export function knownCompanyLocation(company){
  const known=BOOKING_COMPANIES.find(label=>label===normalizeBookingCompany(company));
  return known?known.split(' ')[0]:'';
}
