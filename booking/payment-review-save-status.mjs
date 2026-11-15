const list=value=>Array.isArray(value)?value:[];
const amount=value=>Number.isSafeInteger(value)&&value>=0;
const target=value=>typeof value==='string'&&value.trim().length>0;

/** Only persisted reservation/pass allocation rows can establish a saved record. */
export function paymentReviewSaveStatus(review={}){
 review=review&&typeof review==='object'?review:{};
 const allocations=list(review.allocations).filter(row=>row&&amount(row.amount)&&target(row.reservationId)!==target(row.lessonPassId));
 const reservationIds=[...new Set(allocations.map(row=>row.reservationId).filter(value=>typeof value==='string'&&value.trim()))],passIds=[...new Set(allocations.map(row=>row.lessonPassId).filter(value=>typeof value==='string'&&value.trim()))];
 const saved=reservationIds.length+passIds.length>0,allocatedAmount=allocations.reduce((sum,row)=>sum+row.amount,0),complete=saved&&review.status==='committed'&&review.remainingAmount===0&&amount(review.amount)&&allocatedAmount===review.amount;
 const detail=[reservationIds.length?`예약 ${reservationIds.length}건`:'',passIds.length?`수강권 ${passIds.length}건`:''].filter(Boolean).join(' · ');
 return {saved,complete,label:saved?complete?'저장 완료':'일부 저장':'',detail,allocations,reservationIds,passIds,allocatedAmount,remainingAmount:amount(review.remainingAmount)?review.remainingAmount:null};
}

/** Upload summaries count completed bank reviews, not reservations or draft saves. */
export function paymentUploadSaveStatus(upload={}){
 upload=upload&&typeof upload==='object'?upload:{};
 const total=upload.reviewCount,completed=upload.committedReviewCount;
 if(!Number.isSafeInteger(total)||total<1||!Number.isSafeInteger(completed)||completed<1||completed>total)return null;
 return {complete:completed===total,label:completed===total?'저장 완료':`일부 저장 ${completed}/${total}건`};
}
