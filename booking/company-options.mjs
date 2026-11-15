/** Known labels are normalized for display; callers preserve saved raw aliases until edited. */
export const BOOKING_COMPANIES=Object.freeze([
  '곤지암 캐치스키',
  '곤지암 라이즌',
  '곤지암 코코넛렌탈샵',
  '지산 라이즌스키',
  '지산 비발디스키',
]);
const key=value=>String(value??'').normalize('NFKC').replace(/\s+/gu,'');
const aliases=new Map([
 ...['캐치','캐치스키','캐치곤지암','곤지암캐치','캐치스키곤지암','곤지암캐치스키'].map(value=>[value,BOOKING_COMPANIES[0]]),
 ...['라이즌곤지암','곤지암라이즌','라이즌스키곤지암','곤지암라이즌스키'].map(value=>[value,BOOKING_COMPANIES[1]]),
 ...['코코넛렌탈샵곤지암','곤지암코코넛렌탈샵'].map(value=>[value,BOOKING_COMPANIES[2]]),
 ...['라이즌지산','지산라이즌','라이즌스키지산','지산라이즌스키'].map(value=>[value,BOOKING_COMPANIES[3]]),
 ...['비발디스키지산','지산비발디스키'].map(value=>[value,BOOKING_COMPANIES[4]]),
]);
export function normalizeBookingCompany(value){return aliases.get(key(value))||String(value??'').trim();}
export function bookingCompanyOptions(legacy=[]){
  return [...new Set([...BOOKING_COMPANIES,...legacy.map(normalizeBookingCompany).filter(Boolean)])];
}
export function knownCompanyLocation(company){
  const known=BOOKING_COMPANIES.find(label=>label===normalizeBookingCompany(company));
  return known?known.split(' ')[0]:'';
}
