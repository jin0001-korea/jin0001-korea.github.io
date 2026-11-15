// Read-only, server-authorized staff corrections. Ordinary rental settlement
// flags are a separate source and never create this payment warning.
const escapeText=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function schedulePaymentSummary(schedule={}){
  const value=schedule.paymentCorrection;
  if(schedule.cancelledAt||schedule.cancelled_at||['cancelled','canceled'].includes(schedule.status))return {available:true,needsAdditionalPayment:false,outstandingAmount:0,reason:''};
  if(!value)return {available:true,needsAdditionalPayment:false,outstandingAmount:0,reason:''};
  if(value.available===false||typeof value.hasCorrection!=='boolean'||typeof value.needsAdditionalPayment!=='boolean'||!Number.isSafeInteger(value.outstandingAmount)||value.outstandingAmount<0)return {available:false,needsAdditionalPayment:false,outstandingAmount:null,reason:''};
  return {available:true,needsAdditionalPayment:value.hasCorrection&&value.needsAdditionalPayment&&value.outstandingAmount>0,outstandingAmount:value.outstandingAmount,reason:typeof value.reason==='string'?value.reason.slice(0,1000):''};
}
export const schedulePaymentNeedsAttention=schedule=>schedulePaymentSummary(schedule).needsAdditionalPayment;
export function renderSchedulePayment(schedule={}, {compact=false,escapeHTML=escapeText}={}){
  const facts=schedulePaymentSummary(schedule),escape=escapeHTML;
  if(!facts.available)return '<span class="schedule-payment-unavailable">정정 금액 조회 불가</span>';
  if(!facts.needsAdditionalPayment)return '';
  const amount=new Intl.NumberFormat('ko-KR').format(facts.outstandingAmount);
  return `<span class="schedule-payment-notice${compact?' compact':''}" data-schedule-payment="due"><strong>요청금액 정정 · 미수 ${amount}원</strong><small>추가 입금 확인 필요</small>${facts.reason?`<small class="schedule-payment-reason">특이사항 · ${escape(facts.reason)}</small>`:''}</span>`;
}
