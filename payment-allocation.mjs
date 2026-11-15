import {hydratePaymentIntake,syncPaymentIntake} from './payment-intake-state.mjs?v=6';

// Suggested draft amounts only. This module never approves a review, writes a
// booking or allocates money in the bank ledger.
const rows=value=>Array.isArray(value)?value:[];
const money=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000?value:null;
const count=value=>Number.isSafeInteger(value)&&value>0&&value<=100?value:null;
const sourceFact=(team,name)=>rows(team.fields).find(field=>field?.field===name&&!['conflict','change_requested','superseded'].includes(field.status));
const chronological=(left,right)=>(left.date||'9999-99-99').localeCompare(right.date||'9999-99-99')||(left.startTime||'99:99').localeCompare(right.startTime||'99:99')||left.index-right.index;
const cited=evidence=>rows(evidence).length>0&&rows(evidence).every(item=>typeof item?.messageId==='string'&&!!item.messageId&&typeof item?.quote==='string'&&!!item.quote.trim());
const sum=values=>{const total=values.reduce((result,value)=>result+value,0);return money(total);};
const blockingPriceCodes=new Set(['TEAM_PRICE_SCOPE','SESSION_COUNT_UNCLEAR','SESSION_COUNT_SCOPE','PRICE_BASIS_CONFLICT','PRICE_BASIS_UNCLEAR','PRICE_AMOUNT_INVALID','LATER_PRICE_OR_STRUCTURE_CHANGE','QUOTED_TOTAL_MISMATCH','RENTAL_EXCEEDS_QUOTE','RENTAL_INCLUDED_UNPRICED','RENTAL_SEPARATE','RENTAL_SCOPE_UNCLEAR']);
const arithmeticSummaryLabels=new Set(['상담 금액 문구','금액 대조 항목','합산 검토 입금건','입금 금액 비교']);
const componentPriceCodes=new Set(['NON_INTEGER_SESSION_PRICE','PRICE_SCOPE_INFERRED','RENTAL_SCOPE_INFERRED','SINGLE_TEAM_PROPOSAL','LAST_SESSION_REMAINDER']);
const unpaidRentalStates=new Set([undefined,null,'','unconfirmed','onsite_unpaid']);
const won=value=>`${value.toLocaleString('ko-KR')}원`;

// A shortfall is not a discount. Only a fully scoped invoice whose entire
// lesson component is paid can suggest that its entire rental is unpaid.
function lessonOnlyRentalEligible(comparison,teams,{summaryOnly,bankAmount,availableAmount}){
 if(!teams.length||bankAmount!==availableAmount||comparison.candidateSetComplete!==true||comparison.truncated===true)return false;
 const threadId=teams[0].threadId,sources=rows(comparison.consultation?.teams),selectedSources=teams.map(team=>sources[team.teamIndex]);
 if(teams.some(team=>team.threadId!==threadId)||sources.filter(row=>row.threadId===threadId).length!==teams.length)return false;
 const coverage=comparison.consultation?.coverage,thread=rows(coverage?.threads).filter(row=>row.threadId===threadId);
 if(!summaryOnly&&(coverage?.complete!==true||thread.length!==1||thread[0].complete!==true||Number.isSafeInteger(thread[0].loadedMessages)&&Number.isSafeInteger(thread[0].suppliedMessages)&&thread[0].loadedMessages!==thread[0].suppliedMessages))return false;
 if(teams.length>1){
  const group=selectedSources[0]?.groupingEvidence;
  if(!cited([group])||group.teamCount!==teams.length)return false;
  // Different invoices in the same conversation cannot become one package just
  // because their sums coincide. Every team needs the same quoted grouping.
  if(selectedSources.some(source=>source?.groupingEvidence?.teamCount!==teams.length||source.groupingEvidence.messageId!==group.messageId||source.groupingEvidence.quote!==group.quote||!rows(source.priceBreakdown?.evidence).some(item=>item.messageId===group.messageId&&item.quote.includes(group.quote))))return false;
 }
 return teams.every((team,index)=>{
  const source=selectedSources[index],price=source?.priceBreakdown,rental=money(price?.rentalFeePerTeamSession),free=price?.rentalStatus==='free'&&rental===0;
  if(team.bookingType==='pass'||teams.length===1&&price?.teamCount!==1||!free&&(price?.rentalStatus!=='included_priced'||rental===null||rental<=0)||rows(price?.warnings).some(item=>!componentPriceCodes.has(item.code)))return false;
  const fields=[...rows(team.fields),...rows(source.facts),...rows(source.proposedFields)],allowed=value=>unpaidRentalStates.has(value)||free&&value==='free';
  if(fields.some(field=>['lessonFee','rentalFee','rentalPaymentStatus'].includes(field?.field)&&['conflict','change_requested'].includes(field.status)))return false;
  if(fields.some(field=>field?.field==='rentalPaymentStatus'&&!['superseded','rejected'].includes(field.status)&&!allowed(field.value)))return false;
  return allowed(team.registrationFields?.rentalPaymentStatus)&&rows(team.sessions).every(session=>allowed(session.rentalPaymentStatus));
 });
}

/** Older reviews marked display-only arithmetic caps as incomplete source input. */
export function paymentSummaryOnlyCoverageLimit(comparison,selectedThreadIds){
 const coverage=comparison?.consultation?.coverage,limits=rows(coverage?.summaryLimits),selected=[...new Set(rows(selectedThreadIds))];
 if(comparison?.candidateSetComplete!==true||comparison.truncated===true||coverage?.complete!==false||!limits.length||!selected.length||selected.some(id=>typeof id!=='string'||!id))return false;
 if(limits.some(limit=>!arithmeticSummaryLabels.has(limit?.label)||![limit.shown,limit.total,limit.omitted].every(Number.isSafeInteger)||limit.shown<0||limit.omitted<=0||limit.total!==limit.shown+limit.omitted))return false;
 return selected.every(id=>{const matches=rows(coverage.threads).filter(thread=>thread?.threadId===id);if(matches.length!==1)return false;const thread=matches[0];return thread.complete===true&&Number.isSafeInteger(thread.loadedMessages)&&thread.loadedMessages>0&&Number.isSafeInteger(thread.suppliedMessages)&&thread.loadedMessages===thread.suppliedMessages;});
}

/** Equal package installments, retaining every won in the final session. */
export function splitPaymentAmountLastSession(total,sessionCount){
 if(money(total)===null||count(sessionCount)===null)throw new Error('배분할 금액과 강습 횟수를 확인해 주세요.');
 const unit=Math.floor(total/sessionCount),result=Array(sessionCount).fill(unit);result[result.length-1]=total-unit*(sessionCount-1);return result;
}

function proportional(total,weights){
 const denominator=weights.reduce((value,weight)=>value+BigInt(weight),0n);if(denominator===0n)return weights.map(()=>0);
 const result=weights.map(weight=>Number(BigInt(total)*BigInt(weight)/denominator));let rest=total-result.reduce((value,amount)=>value+amount,0);
 for(let index=result.length-1;index>=0&&rest;index--){const extra=Math.min(rest,weights[index]-result[index]);result[index]+=extra;rest-=extra;}
 return result;
}

function stateKey(draft,bankAmount,availableAmount){
 const comparison=draft.paymentComparison||{},a=comparison.appliedProposal||{};
 return JSON.stringify({bankAmount,availableAmount,candidateSetComplete:comparison.candidateSetComplete,truncated:comparison.truncated,coverage:comparison.consultation?.coverage,source:comparison.consultation?.teams,teams:rows(a.reviewedTeams).map(team=>({id:team.id,threadId:team.threadId,teamIndex:team.teamIndex,bookingType:team.bookingType,fields:team.fields,registrationFields:team.registrationFields,participants:team.participants,sessions:team.sessions}))});
}

/** Build a reviewable calculation from the already selected, cited quotation. */
export function buildPaymentAllocationProposal(input,{depositAmount,remainingAmount=depositAmount}={}){
 const bankAmount=money(depositAmount),availableAmount=money(remainingAmount),warnings=[];
 const warn=(code,message)=>{if(!warnings.some(item=>item.code===code))warnings.push({code,message});};
 const result={version:1,status:'unavailable',needsStaffConfirmation:true,basis:'source_final_quote',bankAmount,availableAmount,quoteTotal:null,proposedAmount:0,unallocatedAmount:availableAmount,rows:[],warnings,reason:'원문의 팀별 최종 금액과 회차를 확인해 주세요.',fingerprint:''};
 if(bankAmount===null||availableAmount===null||availableAmount>bankAmount){warn('BANK_AMOUNT_INVALID','실제 입금액과 아직 배분하지 않은 금액을 확인해 주세요.');return result;}
 if(!input?.paymentComparison?.appliedProposal?.intakeVersion){warn('INTAKE_REQUIRED','먼저 상담의 팀·회차 제안을 작성란에 반영해 주세요.');return result;}
 const draft=syncPaymentIntake(input),comparison=draft.paymentComparison,a=comparison.appliedProposal,teams=rows(a.reviewedTeams),sourceTeams=rows(comparison.consultation?.teams);
 result.fingerprint=stateKey(draft,bankAmount,availableAmount);
 if(!teams.length||teams.length>6){warn('TEAM_COUNT_INVALID','작성할 팀을 확인해 주세요.');return result;}
 const coverage=comparison.consultation?.coverage;
 const summaryOnly=paymentSummaryOnlyCoverageLimit(comparison,teams.map(team=>team.threadId));
 if(comparison.candidateSetComplete===false||comparison.truncated===true||coverage?.complete===false&&!summaryOnly||Array.isArray(coverage)&&coverage.some(row=>row.complete===false))warn('SOURCE_INCOMPLETE','상담 조회 범위가 불완전하여 입금 배분을 직접 확인해야 합니다.');
 const selected=new Set(),threads=new Set(),invoiceTotals=new Map();let incomplete=false;
 for(const team of teams){
  const source=Number.isSafeInteger(team.teamIndex)?sourceTeams[team.teamIndex]:null,key=`${team.threadId}:${team.teamIndex}`;
  if(!source||source.threadId!==team.threadId||selected.has(key)){warn('SOURCE_TEAM_UNCLEAR','중복되거나 원문과 연결되지 않은 팀은 자동 배분하지 않습니다.');incomplete=true;continue;}
  selected.add(key);threads.add(team.threadId);
  const price=source.priceBreakdown,basis=price?.allocationBasis;
  if(price?.version!==1||!cited(basis?.evidence||price?.evidence)){warn('QUOTE_EVIDENCE_MISSING','팀별 최종 견적의 원문 근거가 부족합니다.');incomplete=true;continue;}
  const adjusted=basis?.version===1&&basis.status==='verified',teamTotal=money(adjusted?basis.finalTeamAmount:price.perTeamTotalAmount),sessions=count(adjusted?basis.sessionCount:price.sessionsPerTeam);
  const priceWarnings=rows(price.warnings);
  const calculable=price.status==='calculated'||price.status==='review_required'&&priceWarnings.length>0&&priceWarnings.every(item=>['NON_INTEGER_SESSION_PRICE','PRICE_SCOPE_INFERRED','RENTAL_SCOPE_INFERRED'].includes(item.code));
  if(basis&&(!adjusted||!cited(basis.evidence))||priceWarnings.some(item=>blockingPriceCodes.has(item.code))||!adjusted&&!calculable){
   warn('QUOTE_REQUIRES_REVIEW','할인·최종 견적 또는 이후 변경에 확인할 내용이 있습니다. 원문 금액을 먼저 정리해 주세요.');incomplete=true;continue;
  }
  if(teamTotal===null||sessions===null){warn('QUOTE_AMOUNT_UNKNOWN','팀별 최종 금액이나 구매 회차가 미확인입니다.');incomplete=true;continue;}
  const invoiceTotal=money(adjusted?basis.finalTotalAmount??price.totalQuotedAmount:price.totalQuotedAmount);
  if(invoiceTotal!==null){const totals=invoiceTotals.get(team.threadId)||new Set();totals.add(invoiceTotal);invoiceTotals.set(team.threadId,totals);}
  const pass=team.bookingType==='pass',sessionRows=rows(team.sessions).map((session,index)=>({...session,index})).sort(chronological);
  if(!sessionRows.length||(!pass&&sessionRows.length!==sessions)||(pass&&sessionRows.length!==1)){
   warn('SESSION_COVERAGE_INCOMPLETE',`원문의 ${sessions}회와 작성된 회차가 다릅니다. 날짜를 추정해 회차를 만들거나 한 회차에 전액을 넣지 않습니다.`);incomplete=true;continue;
  }
  const rental=price.rentalStatus==='free'?0:money(price.rentalFeePerTeamSession);
  if(rental===null||price.rentalStatus==='free'&&money(price.rentalFeePerTeamSession)!==0){warn('RENTAL_AMOUNT_UNKNOWN','원문 금액에서 장비요금을 구분할 수 없어 배분 초안을 보류합니다.');incomplete=true;continue;}
  const explicitAmounts=adjusted&&basis.sessionAmounts!==undefined?basis.sessionAmounts:null;
  if(explicitAmounts!==null&&(!Array.isArray(explicitAmounts)||explicitAmounts.length!==sessions||explicitAmounts.some(value=>money(value)===null)||sum(explicitAmounts)!==teamTotal)){warn('SESSION_AMOUNTS_INVALID','원문에 지정된 회차별 금액과 최종 견적이 일치하지 않습니다.');incomplete=true;continue;}
  const gross=pass?[teamTotal]:explicitAmounts?[...explicitAmounts]:splitPaymentAmountLastSession(teamTotal,sessions),baselineFee=money(sourceFact(team,'lessonFee')?.value)??money(price.lessonFeePerTeamSession),baselineRental=money(sourceFact(team,'rentalFee')?.value)??rental;
  for(const [index,session]of sessionRows.entries()){
   const lessonFee=pass?money(session.lessonFee):gross[index]-rental,rentalFee=pass?money(session.rentalFee):rental;
   if(lessonFee!==null&&lessonFee<0){warn('RENTAL_EXCEEDS_FINAL_QUOTE','최종 회당 금액보다 장비요금이 커서 원문을 확인해야 합니다.');incomplete=true;continue;}
   if(session.allocatedAmount!==null&&session.allocatedAmount!==undefined&&money(session.allocatedAmount)===null){warn('INVALID_EXISTING_ALLOCATION','현재 배분액에 잘못된 값이 있습니다.');incomplete=true;continue;}
   if(money(session.allocatedAmount)>0)warn('EXISTING_ALLOCATION','이미 입력한 입금 배분액을 유지합니다. 자동 제안으로 덮어쓰지 않습니다.');
   if(!pass&&((money(session.lessonFee)!==null&&session.lessonFee!==baselineFee&&session.lessonFee!==lessonFee)||(money(session.rentalFee)!==null&&session.rentalFee!==baselineRental&&session.rentalFee!==rentalFee)))warn('MANUAL_FEE_CHANGED','담당자가 바꾼 강습료·장비금액을 유지합니다. 새 금액은 직접 대조해 주세요.');
   result.rows.push({teamId:team.id,sessionId:session.id,amount:gross[index],lessonFee,rentalFee,roundingAdjustment:pass?0:gross[index]-Math.floor(teamTotal/sessions),threadId:team.threadId,teamIndex:team.teamIndex});
  }
 }
 if(incomplete||result.rows.length!==teams.reduce((total,team)=>total+rows(team.sessions).length,0)){result.rows=[];return result;}
 const quoteTotal=sum(result.rows.map(row=>row.amount));if(quoteTotal===null){warn('QUOTE_TOTAL_INVALID','전체 견적 금액이 저장 가능한 범위를 벗어납니다.');result.rows=[];return result;}
 result.quoteTotal=quoteTotal;
 for(const [thread,totals]of invoiceTotals){const ownTotal=sum(result.rows.filter(row=>row.threadId===thread).map(row=>row.amount));if(totals.size!==1||!totals.has(ownTotal))warn('INVOICE_TOTAL_MISMATCH','선택한 팀의 합계와 원문 전체 금액이 다릅니다. 누락된 팀·다른 입금건을 확인해 주세요.');}
 if(threads.size>1)warn('MULTIPLE_CONVERSATIONS','서로 다른 상담 출처를 함께 배분하는 제안입니다. 같은 강습대금인지 담당자가 확인해야 합니다.');
 const lessonTotal=result.rows.every(row=>money(row.lessonFee)!==null)?sum(result.rows.map(row=>row.lessonFee)):null,rentalTotal=result.rows.every(row=>money(row.rentalFee)!==null)?sum(result.rows.map(row=>row.rentalFee)):null;
 const lessonOnly=!warnings.length&&invoiceTotals.size===1&&lessonTotal>0&&rentalTotal>0&&availableAmount===lessonTotal&&quoteTotal-availableAmount===rentalTotal&&lessonOnlyRentalEligible(comparison,teams,{summaryOnly,bankAmount,availableAmount});
 if(lessonOnly){
  result.basis='source_lesson_only_rental_unpaid';result.rentalUnpaidAmount=rentalTotal;result.inferred=true;
  result.reason=`장비 미결제 추론 · 원문 전체 견적 ${won(quoteTotal)} 중 강습료 합계(${won(lessonTotal)})가 실제 입금액과 일치하고, 차액 ${won(rentalTotal)}은 장비요금 전체와 같습니다. 강습료만 배분하고 장비요금은 현장 미결제로 제안합니다. 할인·면제나 다른 입금이 아닌지 담당자가 확인해야 합니다.`;
  for(const row of result.rows){row.amount=row.lessonFee;if(row.rentalFee>0)row.rentalPaymentStatus='onsite_unpaid';}
 }else if(availableAmount<quoteTotal){warn('PARTIAL_DEPOSIT','입금액이 최종 견적보다 적습니다. 견적 비율에 따른 배분 예시이며 실제로 납부한 팀·회차를 확인해야 합니다.');const values=proportional(availableAmount,result.rows.map(row=>row.amount));for(const [index,row]of result.rows.entries())row.amount=values[index];}
 else if(availableAmount>quoteTotal)warn('EXCESS_DEPOSIT','입금액이 최종 견적보다 많습니다. 원문 견적까지만 제안하고 초과액은 미배분으로 남깁니다.');
 result.proposedAmount=sum(result.rows.map(row=>row.amount));result.unallocatedAmount=availableAmount-result.proposedAmount;
 result.status=warnings.length?'review_required':'ready';
 if(!lessonOnly)result.reason=warnings.length?'원문 금액을 기준으로 계산한 배분 예시입니다. 표시된 확인 사항을 대조한 뒤 담당자가 반영해 주세요.':'원문 최종 견적과 실제 입금액이 일치합니다. 팀·회차별 배분 초안이며 담당자가 예약 저장 전에 확인합니다.';
 return result;
}

/** Fill an untouched draft; staff-entered amounts and fees are never replaced. */
export function applyPaymentAllocationProposal(input,proposal,{onlyUnallocated=true,allowReviewRequired=false}={}){
 const draft=syncPaymentIntake(input),fresh=buildPaymentAllocationProposal(draft,{depositAmount:proposal?.bankAmount,remainingAmount:proposal?.availableAmount});
 if(!proposal?.fingerprint||fresh.fingerprint!==proposal.fingerprint)throw new Error('팀·회차나 금액이 바뀌었습니다. 입금 배분 제안을 다시 계산해 주세요.');
 if(fresh.status==='unavailable'||fresh.status==='review_required'&&!allowReviewRequired)return draft;
 if(fresh.warnings.some(item=>['EXISTING_ALLOCATION','MANUAL_FEE_CHANGED','INVALID_EXISTING_ALLOCATION'].includes(item.code)))return draft;
 const a=draft.paymentComparison.appliedProposal;
 if(onlyUnallocated&&rows(a.reviewedTeams).some(team=>rows(team.sessions).some(session=>money(session.allocatedAmount)>0)))return draft;
 for(const row of fresh.rows){const team=a.reviewedTeams.find(team=>team.id===row.teamId),session=team?.sessions.find(session=>session.id===row.sessionId);if(!session)throw new Error('배분할 회차를 다시 확인해 주세요.');session.allocatedAmount=row.amount;if(row.lessonFee!==null)session.lessonFee=row.lessonFee;if(row.rentalFee!==null)session.rentalFee=row.rentalFee;if(row.rentalPaymentStatus==='onsite_unpaid')session.rentalPaymentStatus='onsite_unpaid';}
 for(const team of a.reviewedTeams){const first=team.sessions[0];Object.assign(team.draft,{allocatedAmount:first.allocatedAmount,lessonFee:first.lessonFee,rentalFee:first.rentalFee});}
 if(fresh.basis==='source_lesson_only_rental_unpaid')for(const team of a.reviewedTeams){
  if(team.sessions.some(session=>session.rentalFee>0))team.registrationFields.rentalPaymentStatus='onsite_unpaid';
 }
 a.allocationProposal={version:1,status:'proposed',needsStaffConfirmation:true,basis:fresh.basis,bankAmount:fresh.bankAmount,quoteTotal:fresh.quoteTotal,amount:fresh.proposedAmount,unallocatedAmount:fresh.unallocatedAmount,...(fresh.basis==='source_lesson_only_rental_unpaid'?{inferred:true,rentalUnpaidAmount:fresh.rentalUnpaidAmount,reason:fresh.reason}:{}),...(fresh.warnings.length?{warningCodes:fresh.warnings.map(item=>item.code)}:{})};
 return hydratePaymentIntake(draft);
}
