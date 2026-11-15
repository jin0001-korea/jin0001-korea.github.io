const LEGACY_STAFF_SITE='https://slope-instructor-desk.aurorapuppy34.chatgpt.site';
const PROJECT='ewiekbmjvgktwsbbxrzw';

export const bookingRoleLabel=role=>role==='counselor'?'상담사':role==='admin'?'관리자':'운영 계정';
export const canUseBooking=profile=>profile?.active===true&&!profile.must_change_password&&['admin','counselor'].includes(profile.role);
export const isUnifiedBookingLocation=(location=globalThis.location)=>/^\/booking(?:\/|$)/.test(location?.pathname||'');
export const bookingStorageKey=(location=globalThis.location)=>isUnifiedBookingLocation(location)?`slope-auth-${PROJECT}`:`slope-reservation-auth-${PROJECT}`;

/** Only fixed local destinations are supported; no caller-controlled return URL. */
export function bookingStaffLinks(location=globalThis.location){
  const base=isUnifiedBookingLocation(location)?'/':`${LEGACY_STAFF_SITE}/`;
  return {login:`${base}?next=booking`,home:`${base}#dashboard`,settings:`${base}#settings`};
}

export function bookingAdminNavigation(profile,location=globalThis.location){
  if(!canUseBooking(profile)||profile.role!=='admin')return [];
  const base=bookingStaffLinks(location).home.split('#')[0];
  return [['dashboard','운영 현황'],['schedules','강습 관리'],['alerts','알림'],['scores','만족도·리오더'],['instructors','계정·권한'],['settings','운영 설정']].map(([view,label])=>({label,href:`${base}#${view}`}));
}
