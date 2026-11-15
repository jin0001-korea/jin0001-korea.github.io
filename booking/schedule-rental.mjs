// Reservation-record facts only. Never infer payment from old sheet cells or
// treat these flags as live rental-shop settlement/return information.
const esc=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const first=(value,...keys)=>{for(const key of keys)if(own(value,key))return value[key];return undefined;};
export function scheduleRentalSummary(source={}){
  const value=source.rental&&typeof source.rental==='object'?source.rental:source;
  if(value.available===false)return {status:'unknown',bookedHours:null,useHours:null,available:false};
  const input=first(value,'paymentStatus','payment_status','rentalPaymentStatus','rental_payment_status','status');
  const status=['free','paid','onsite_unpaid'].includes(input)?input:'unknown';
  const inputHours=first(value,'bookedHours','booked_hours','rentalHours','rental_hours');
  const bookedHours=status!=='unknown'&&[4,6].includes(Number(inputHours))?Number(inputHours):null;
  return {status,bookedHours,useHours:bookedHours===4?5:bookedHours===6?7:null,available:true};
}
export function scheduleRentalLabel(source={}){
  const facts=scheduleRentalSummary(source);
  if(!facts.available)return '장비 예약기록 조회 불가';
  const text={free:'장비 무료',paid:'장비 기결제',onsite_unpaid:'장비 현장결제 예정',unknown:'장비 미확인'}[facts.status];
  return `${text}${facts.useHours?` · 이용 ${facts.useHours}시간`:''} (예약기록)`;
}
export function renderScheduleRental(source={}, {compact=false,escapeHTML=esc}={}){
  const facts=scheduleRentalSummary(source),escape=escapeHTML;
  const note='강습 예약에 입력된 기록입니다. 렌탈 현장 수납·추가금·반납은 별도 확인하세요.';
  const hours=facts.bookedHours?`예약 ${facts.bookedHours}시간 → 이용 ${facts.useHours}시간 · 서비스 1시간`:'';
  return `<span class="schedule-rental ${facts.status}${facts.available?'':' unavailable'}${compact?' compact':''}" data-schedule-rental="${facts.status}" title="${escape([scheduleRentalLabel(source),hours,note].filter(Boolean).join(' · '))}"><strong>${escape(scheduleRentalLabel(source))}</strong>${!compact&&hours?`<small>${escape(hours)}</small>`:''}${!compact?`<small class="schedule-rental-note">${escape(note)}</small>`:''}</span>`;
}
