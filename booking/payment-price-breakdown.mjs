// Read-only quote arithmetic. This view never allocates a deposit or changes a draft.
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const amount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const count=value=>Number.isSafeInteger(value)&&value>0&&value<=1000?value:null;
const won=value=>amount(value)===null?'미확인':`${value.toLocaleString('ko-KR')}원`;
const signed=value=>Number.isSafeInteger(value)?`${value>0?'+':value<0?'−':''}${Math.abs(value).toLocaleString('ko-KR')}원`:'미확인';
const field=(team,name)=>list(team.proposedFields).find(item=>item?.field===name&&item.status!=='superseded'&&item.status!=='change_requested')?.value;
const stamp=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))+' (한국 시간)':'원문 시각 미확인';

function adjustedSchedule(data,sessions,total){
  const basis=data?.allocationBasis;
  if(basis?.version!==1||basis.status!=='verified'||basis.rounding!=='last_session'||sessions===null||basis.sessionCount!==sessions||amount(basis.baseTeamAmount)===null||amount(total)===null||basis.finalTeamAmount!==total||amount(basis.finalTotalAmount)===null||basis.finalTotalAmount!==data.totalQuotedAmount||!list(basis.evidence).some(row=>typeof row.messageId==='string'&&typeof row.quote==='string'&&row.quote.trim()))return null;
  const values=basis.sessionAmounts===undefined?Array.from({length:sessions},(_,index)=>index===sessions-1?total-Math.floor(total/sessions)*(sessions-1):Math.floor(total/sessions)):basis.sessionAmounts;
  if(!Array.isArray(values)||values.length!==sessions||values.some(value=>amount(value)===null)||values.reduce((sum,value)=>sum+value,0)!==total||data.perTeamSessionAmount!==values[0])return null;
  return {basis,values};
}

function rowOf(team,index){
  const data=team.priceBreakdown?.version===1?team.priceBreakdown:null;
  const students=count(data?.studentsPerTeam)??count(field(team,'studentCount'))??count(team.groupingEvidence?.studentCountPerTeam);
  const sessions=count(data?.sessionsPerTeam);
  const grossSession=amount(data?.perTeamSessionAmount),declaredTotal=amount(data?.perTeamTotalAmount);
  const calculatedTotal=grossSession!==null&&sessions!==null&&Number.isSafeInteger(grossSession*sessions)?grossSession*sessions:null;
  const adjusted=adjustedSchedule(data,sessions,declaredTotal);
  const inconsistent=!!data?.allocationBasis&&!adjusted||!adjusted&&declaredTotal!==null&&calculatedTotal!==null&&declaredTotal!==calculatedTotal;
  const total=inconsistent?null:declaredTotal;
  const warnings=list(data?.warnings).filter(item=>typeof item?.message==='string').map(item=>item.message);
  const inferenceWarning=list(data?.warnings).find(item=>['PRICE_SCOPE_INFERRED','RENTAL_SCOPE_INFERRED'].includes(item?.code));
  const inference=data?.scopeInference&&typeof data.scopeInference==='object'&&!Array.isArray(data.scopeInference)?data.scopeInference:null;
  const scopeInference=inference||inferenceWarning?{
    reason:typeof inference?.reason==='string'&&inference.reason.trim()?inference.reason:inferenceWarning?.message||'가격 범위를 원문 안내 합계와 대조해 제안했습니다.',
    alternatives:list(inference?.alternatives).filter(item=>item&&typeof item==='object'&&!Array.isArray(item)),evidence:list(inference?.evidence),
  }:null;
  if(inconsistent)warnings.push('회당 견적 × 회차와 팀 합계가 다릅니다. 원문 금액을 다시 확인하세요.');
  if(!data)warnings.push('이전 초안에는 회차별 계산 근거가 없습니다. 최신 상담을 다시 대조해 주세요.');
  if(sessions===null)warnings.push('강습 횟수가 확인되지 않아 회당 금액을 확정하지 않습니다.');
  const ratio=field(team,'lessonRatio');
  const minutes=field(team,'lessonMinutes');
  return {label:team.label||`상담 팀 ${index+1}`,inferred:team.groupingEvidence?.inferred===true,
    students,sessions,ratio:typeof ratio==='string'?ratio:'',minutes:[120,240].includes(minutes)?minutes:null,
    lesson:amount(data?.lessonFeePerTeamSession),rental:amount(data?.rentalFeePerTeamSession),rentalStatus:data?.rentalStatus||'unknown',
    grossSession,total,expectedTeams:count(data?.teamCount)??count(team.groupingEvidence?.teamCount),
    quotedTotal:amount(data?.totalQuotedAmount),statedTotal:amount(data?.statedTotalAmount),requiresReview:data?.status!=='calculated'||inconsistent||!!scopeInference,
    formula:typeof data?.formula==='string'?data.formula:'',evidence:[...list(data?.evidence),...list(scopeInference?.evidence),...list(adjusted?.basis.evidence)],scopeInference,adjusted,warnings};
}

function rowsMarkup(rows){
  return `<table class="pr-price-table"><caption class="pr-price-sr">팀별 강습 횟수와 회당 견적</caption><thead><tr><th scope="col">팀</th><th scope="col">구성</th><th scope="col">횟수</th><th scope="col">회당 강습료</th><th scope="col">회당 장비</th><th scope="col">팀 견적 합계</th></tr></thead><tbody>${rows.map(row=>{
    const varying=row.adjusted&&new Set(row.adjusted.values).size>1;
    const sessionNote=varying?`<small>${row.adjusted.values.map((value,index)=>`${index+1}회 ${won(row.rental===null?null:value-row.rental)}`).join(' · ')}<br>원문 최종 합계에 맞춘 회차별 제안</small>`:'';
    const lesson=(row.lesson===null&&row.grossSession!==null?`미확인<small>회당 견적 ${won(row.grossSession)}<br>강습료·장비 분리 확인</small>`:won(row.lesson))+sessionNote;
    const rental=row.rentalStatus==='free'&&row.rental===0?'무료 · 0원':row.rental!==null?won(row.rental):({included_unpriced:'포함 · 금액 미확인',separate:'별도 · 금액 미확인',free:'무료 · 근거 확인'})[row.rentalStatus]||'미확인';
    return `<tr><th scope="row">${esc(row.label)}${row.inferred?'<small>구성 제안 · 현장 변경 가능</small>':''}${row.scopeInference?'<small>금액은 원문 합계 기준 추론</small>':''}</th><td data-label="구성">${row.students===null?'인원 미확인':`${row.students}명`}${row.ratio?`<small>강사:수강생 ${esc(row.ratio)}</small>`:''}</td><td data-label="횟수">${row.sessions===null?'미확인':`${row.sessions}회`}${row.minutes?`<small>회당 ${row.minutes/60}시간</small>`:''}</td><td data-label="회당 강습료">${lesson}</td><td data-label="회당 장비">${rental}</td><td data-label="팀 견적 합계" class="pr-price-team-total">${won(row.total)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function adjustmentMarkup(rows){
  const labels={percent_discount:'할인',amount_discount:'별도 할인',rounding:'단수 정리'};
  return rows.filter(row=>row.adjusted&&(list(row.adjusted.basis.adjustments).length||new Set(row.adjusted.values).size>1)).map(row=>{
    const basis=row.adjusted.basis;
    const details=list(basis.adjustments).map(item=>{
      const percent=Number.isSafeInteger(item.percentBasisPoints)&&item.percentBasisPoints>0&&item.percentBasisPoints<=10000?`${item.percentBasisPoints/100}% `:'';
      const label=item.alreadyApplied===true?'이미 반영된 할인 · 중복 할인하지 않음':`${percent}${labels[item.kind]||'원문 금액 조정'}${item.kind==='rounding'?` ${signed(item.amount)}`:amount(item.amount)!==null?` −${won(item.amount)}`:''}`;
      return `<p>${esc(label)}${typeof item.quote==='string'?`<br><small>${esc(item.quote)}</small>`:''}</p>`;
    }).join('');
    return `<details class="pr-price-evidence"><summary>${esc(row.label)} · 할인·회차 조정 근거</summary><p>조정 전 팀 합계 ${won(basis.baseTeamAmount)} → 최종 ${won(basis.finalTeamAmount)}</p>${details}<p>회차별 금액과 입금 배분은 담당자가 확인한 뒤 예약 작성창에서 저장합니다.</p></details>`;
  }).join('');
}

function scopeInferenceMarkup(rows){
  const inferred=[...new Map(rows.filter(row=>row.scopeInference).map(row=>[JSON.stringify([row.statedTotal,row.scopeInference.reason,row.scopeInference.alternatives]),row])).values()];
  const notes=inferred.map(row=>`<p class="pr-price-warning">${esc(row.scopeInference.reason)}${row.statedTotal===null?'':` 원문 안내 합계 ${won(row.statedTotal)}와 대조한 추론입니다. 실제 입금액은 별도 값입니다.`}</p>`).join('');
  const labels={student_package:'인당 전체권',student_session:'인당 회당',team_package:'팀당 전체권',team_session:'팀당 회당'};
  const details=inferred.filter(row=>row.scopeInference.alternatives.length).map(row=>`<details class="pr-price-evidence"><summary>가격 범위 해석 비교</summary><table class="pr-price-table"><caption class="pr-price-sr">원문 안내 합계와 가격 범위별 견적 비교</caption><thead><tr><th scope="col">해석</th><th scope="col">회당 견적</th><th scope="col">팀 견적 합계</th><th scope="col">전체 견적 합계</th></tr></thead><tbody>${row.scopeInference.alternatives.map(alternative=>{
    const total=amount(alternative.totalQuotedAmount),match=row.statedTotal===null?'원문 합계 미확인':total===null?'금액 미확인':total===row.statedTotal?'원문 합계와 일치':'원문 합계와 불일치';
    return `<tr><th scope="row">${esc(typeof alternative.label==='string'&&alternative.label?alternative.label:Object.hasOwn(labels,alternative.priceBasis)?labels[alternative.priceBasis]:'가격 범위 미확인')}${typeof alternative.formula==='string'&&alternative.formula?`<small>${esc(alternative.formula)}</small>`:''}</th><td data-label="회당 견적">${won(alternative.perTeamSessionAmount)}<small>강습료 ${won(alternative.lessonFeePerTeamSession)} · 장비 ${won(alternative.rentalFeePerTeamSession)}</small></td><td data-label="팀 견적 합계">${won(alternative.perTeamTotalAmount)}</td><td data-label="전체 견적 합계">${won(total)}<small>${match}</small></td></tr>`;
  }).join('')}</tbody></table></details>`).join('');
  return {notes,details,inferred:inferred.length>0};
}

function groupMarkup(comparison,threadId,bankAmount,showSource){
  const teams=list(comparison.consultation?.teams).filter(team=>team?.threadId===threadId);
  if(!teams.length)return '';
  const candidate=list(comparison.candidates).find(item=>item?.threadId===threadId);
  const rows=teams.map(rowOf),expected=[...new Set(rows.map(row=>row.expectedTeams).filter(value=>value!==null))];
  const inference=scopeInferenceMarkup(rows);
  const warnings=rows.flatMap(row=>row.warnings);
  const incomplete=expected.length===1&&expected[0]!==rows.length;
  if(incomplete)warnings.push(`원문은 ${expected[0]}팀인데 현재 ${rows.length}팀만 표시됩니다. 전체 팀을 확인하세요.`);
  const allTotals=rows.every(row=>row.total!==null),sum=allTotals?rows.reduce((total,row)=>total+row.total,0):null;
  const safeSum=Number.isSafeInteger(sum)?sum:null;
  const quoted=[...new Set(rows.map(row=>row.quotedTotal).filter(value=>value!==null))];
  const quoteMismatch=safeSum!==null&&quoted.length===1&&quoted[0]!==safeSum;
  if(quoteMismatch)warnings.push(`팀 합계와 원문 안내 합계 ${won(quoted[0])}가 다릅니다. 할인·장비·추가 항목을 확인하세요.`);
  const review=rows.some(row=>row.requiresReview)||incomplete||quoteMismatch;
  const difference=safeSum!==null&&!incomplete&&amount(bankAmount)!==null?bankAmount-safeSum:null;
  const evidence=[...new Map(rows.flatMap(row=>row.evidence).filter(item=>typeof item?.quote==='string'&&item.quote.trim()).map(item=>[`${item.messageId||''}\u0000${item.quote}`,item])).values()];
  const formulas=[...new Set(rows.map(row=>row.formula).filter(Boolean))];
  const details=formulas.length||evidence.length?`<details class="pr-price-evidence"><summary>계산식·원문 근거 보기</summary>${formulas.map(formula=>`<p class="pr-price-formula">${esc(formula)}</p>`).join('')}${evidence.map(item=>`<figure><figcaption>${esc(stamp(item.occurredAt))}</figcaption><blockquote>${esc(item.quote)}</blockquote></figure>`).join('')}</details>`:'';
  return `<section class="pr-price-breakdown" aria-label="팀별·회차별 금액 대조"><header><strong>팀별·회차별 금액</strong><span>${inference.inferred?'원문 합계 기준 추론 · 확인 필요':review?'추가 확인 필요':'원문 기준 계산 · 검토 필요'}</span></header>${showSource?`<p class="pr-price-source">${esc(candidate?.sourceLabel||'상담 후보')} · ${esc(candidate?.phone||candidate?.displayName||'연락처 미확인')}</p>`:''}${rowsMarkup(rows)}<dl class="pr-price-totals"><div><dt>팀 견적 합계${incomplete?' · 일부':''}</dt><dd>${won(safeSum)}</dd></div><div><dt>현재 입금액</dt><dd>${won(bankAmount)}</dd></div><div class="${difference!==null&&difference!==0?'pr-price-difference':''}"><dt>입금 − 견적</dt><dd>${signed(difference)}</dd></div></dl><p class="pr-price-note">견적 계산이며 입금 배분은 아직 확정하지 않았습니다. 분할·합산 입금은 다른 입금건도 함께 대조하세요.</p>${inference.notes}${[...new Set(warnings)].map(warning=>`<p class="pr-price-warning">${esc(warning)}</p>`).join('')}${adjustmentMarkup(rows)}${inference.details}${details}</section>`;
}

/** Render each consultation candidate independently; never sum competing identities. */
export function renderPaymentPriceBreakdown(comparison,bankAmount,{threadId}={}){
  if(!comparison||typeof comparison!=='object')return '';
  const threads=[...new Set(list(comparison.consultation?.teams).map(team=>team?.threadId).filter(value=>typeof value==='string'&&value))];
  const selected=threadId===undefined?threads:threads.filter(value=>value===threadId);
  return selected.map(id=>groupMarkup(comparison,id,bankAmount,threadId===undefined&&selected.length>1)).join('');
}
