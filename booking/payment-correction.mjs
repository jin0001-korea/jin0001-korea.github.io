import {parseBookingAmount} from './booking-financial.mjs?v=12';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const amount=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000;
const failure=()=>Object.assign(new Error('요청액 정정의 서버 저장 결과를 확인하지 못했습니다. 같은 카드에서 다시 저장해 결과를 확인해 주세요.'),{code:'CORRECTION_RESULT_UNCONFIRMED'});

/** A saved reservation ID alone cannot prove that its correction was committed. */
export function assertPaymentCorrectionResult(payload,result){
  const intent=payload?.paymentRequestCorrection;if(!intent)return null;
  const row=result?.reservation||result,receipt=row?.paymentRequestCorrectionResult||result?.paymentRequestCorrectionResult;
  const current=key=>row?.[key]??row?.[({currentAmountOverride:'current_amount_override',currentAmountCorrectionId:'current_amount_correction_id',amountCorrectionVersion:'amount_correction_version'})[key]]??result?.[key];
  let paid;try{paid=parseBookingAmount(payload.raw?.Y??payload.raw_data?.Y);}catch{throw failure();}
  if(!row||row.id!==payload.id||!receipt||!uuid(receipt.id)||receipt.reservationId!==payload.id
    ||receipt.requestId!==intent.requestId||receipt.version!==intent.expectedVersion+1
    ||receipt.correctedRequestedAmount!==intent.correctedRequestedAmount||receipt.paidAmount!==paid
    ||receipt.reason!==String(intent.reason||'').trim()
    ||!amount(receipt.previousRequestedAmount)||!amount(receipt.correctedRequestedAmount)||!amount(receipt.paidAmount)
    ||receipt.outstandingAmount!==Math.max(receipt.correctedRequestedAmount-paid,0)
    ||current('currentAmountOverride')!==receipt.correctedRequestedAmount
    ||current('currentAmountCorrectionId')!==receipt.id||current('amountCorrectionVersion')!==receipt.version)throw failure();
  return receipt;
}
