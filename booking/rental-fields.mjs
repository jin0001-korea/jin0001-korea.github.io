// Reservation-owned rental facts. Original sheet cells stay untouched.
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const pick=(row,camel,snake)=>own(row,camel)?row[camel]:row?.[snake];
export function rentalDefaultAmount(hours){
  return Number(hours)===4?13000:Number(hours)===6?18000:null;
}
export function rentalStatusLabel(status){
  // '미확인' 상태 표기는 폐지 — 상태가 비어 있으면 미결제로 본다.
  // 미결제는 이용시간 미정일 수 있어 코코넛렌탈샵 실제 이용금액으로 확정한다.
  return ({free:'무료',paid:'결제완료',onsite_unpaid:'미결제(당일 코코넛 실사용 확인)'})[status]||'미결제(당일 코코넛 실사용 확인)';
}
export function rentalDetails(row={}){
  const input=pick(row,'rentalPaymentStatus','rental_payment_status');
  const status=['free','paid','onsite_unpaid'].includes(input)?input:null;
  if(!status)return {status:null,hours:null,amount:null,customAmount:false};
  const rawHours=pick(row,'rentalHours','rental_hours');
  const hours=[4,6].includes(Number(rawHours))?Number(rawHours):null;
  const rawAmount=pick(row,'rentalAmount','rental_amount');
  const number=rawAmount===null||rawAmount===undefined||rawAmount===''?null:Number(rawAmount);
  const amount=status==='free'?0:Number.isSafeInteger(number)&&number>=0?number:null;
  return {status,hours,amount,customAmount:status!=='free'&&amount!==null&&amount!==rentalDefaultAmount(hours)};
}

/** Unknown is a separate confirmation state; it never means free or already paid. */
export function rentalConfirmationPolicy(row={}){
  const required=rentalDetails(row).status===null;
  return {confirmationRequired:required,customerConfirmationRequired:required,staffConfirmationRequired:required};
}
