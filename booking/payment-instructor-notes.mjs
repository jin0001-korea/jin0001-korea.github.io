const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const GENERATED_NOTICES=[
  'AI 분석 초안입니다. 은행 캡처와 문자 원문을 대조한 뒤 직원이 승인해야 합니다.',
  '은행 화면에서 입금의 연도·날짜·시각을 모두 확인하지 못해 고객을 자동 연결하지 않았습니다. 입금 시각을 원본에서 직접 확인해 주세요.',
  '입금 시각은 은행 화면에 보이는 분 단위까지 확인했습니다. 초 단위는 표시되지 않아 추정하지 않았습니다.',
  '별도 시간대 표시가 없는 은행 시각은 한국 시간(Asia/Seoul, UTC+09:00)으로 해석합니다.',
  '카드 결제·정산 메모로 보여 개인 고객과 자동 연결하지 않았습니다.',
  '저장된 문자·카카오 원문에서 비교 후보를 찾지 못했습니다. 고객 정보와 확인 사유를 직접 입력해 주세요.',
  '입금과 고객의 연결이 불확실합니다. 후보 원문을 확인하고 고객과 예약 정보를 직접 선택해 주세요.',
  '후보 또는 원문 조회 범위가 제한되어 고객을 확정하지 않았습니다. 다른 후보와 생략된 원문을 추가로 확인해 주세요.',
  '이 캡처에는 별도 확인이 필요한 거래행도 있습니다.',
  '일정 확인 필요 · 상담 원문에 강습 취소 내용이 있어 날짜·시간을 자동 입력하지 않았습니다. 담당자가 현재 예약 여부를 확인해 주세요.',
  '장비 결제 제안 · 원문 전체 견적과 입금액이 일치하고 회차 배분에 장비요금이 포함됩니다. 담당자 확인 필요.',
];
const labels={date:'강습일',startTime:'시작 시간',studentCount:'인원',participants:'참가자',company:'업체',sport:'종목'};

// Only recognize strings written by this application's former note generators.
// Human notes are never classified by generic words such as AI, 추정 or 확인.
function generatedNotes(proposal,comparison){
  const generated=new Set(GENERATED_NOTICES);
  for(const line of list(comparison?.analysisNotes))generated.add(text(line));
  const proposals=[proposal,...list(proposal?.reviewedTeams)];
  for(const row of proposals){
    const history=text(row?.instructorHistoryProposal?.reason);if(history)generated.add(`기존 강사 제안 · ${history}`);
    const allocation=text(row?.allocationProposal?.reason);if(allocation)generated.add(allocation);
    for(const fact of list(row?.fields)){
      const reason=text(fact?.reason);if(!reason)continue;
      if(fact.inferred)generated.add(`상담 근거 확인 · ${labels[fact.field]||'상담 제안'}: ${reason}`);
      if((fact.inferred||fact.draftPreferred)&&fact.policyRule)generated.add(reason);
      if((fact.inferred||fact.draftPreferred)&&['date','startTime'].includes(fact.field))generated.add(`${fact.field==='date'?'날짜':'시간'} ${fact.draftPreferred?'변경 제안':'추정'} · ${reason}`);
    }
  }
  return generated;
}
function legacyGeneratedLine(line){
  return /^검색용 이름은 .{1,100}로 정리했으며 은행 입금자 표시는 원본대로 유지했습니다\.$/u.test(line)
    ||/^기존 수강권(?:의 일정이 정해진)? 회차입니다\.(?: 원래 수강권 총 \d{1,3}회\.)? 연결 수강권과 이번 회차 배분액을 확인하세요\.$/u.test(line);
}
function instructorFact(fact){
  if(!text(fact?.quote)||!fact.messageId||['conflict','change_requested'].includes(fact.status))return '';
  const value=text(fact.value);
  if(fact.field==='notes')return value;
  if(fact.field==='experience'&&value)return `강습 경험: ${value}`;
  if(fact.field==='ability'&&value)return `현재 수준: ${value}`;
  if(['goal','lessonGoal'].includes(fact.field)&&value)return `목표: ${value}`;
  if(fact.field==='experienceCount'&&Number.isSafeInteger(fact.value)&&fact.value>=0)return `이전 강습 경험: ${fact.value}회`;
  if(fact.field==='juniorPreparation'&&fact.value===true&&/(?:목표|준비|도전|희망)/u.test(fact.quote))return '목표: 주니어 기술등급 준비';
  return '';
}

/** Instructor-facing notes, separate from immutable review evidence and reasoning.
 * includeFacts is only for initial proposal filling, never a later staff-edited handoff.
 */
export function buildPaymentInstructorNotes(draft={}, {proposal=draft.paymentComparison?.appliedProposal,comparison=draft.paymentComparison,includeFacts=false,omitProposalFacts=false}={}){
  const generated=generatedNotes(proposal,comparison);
  const inferredGrouping=list(comparison?.consultation?.teams).some(team=>team.threadId===proposal?.threadId&&team.groupingEvidence?.inferred);
  if(inferredGrouping)generated.add('구성은 현장에서 변경 가능함');
  if(omitProposalFacts)for(const fact of list(proposal?.fields)){const note=instructorFact(fact);if(note)generated.add(note);}
  const clean=value=>{
    let body=`\n${text(value)}\n`;
    for(const note of generated)if(note)body=body.split(`\n${note}\n`).join('\n');
    return body.split('\n').map(line=>line.trim()).filter(line=>!generated.has(line)&&!legacyGeneratedLine(line)).join('\n').trim();
  };
  let result=clean(draft.notes);
  // Older multi-team generators appended this exact suffix to an existing note.
  if(inferredGrouping)result=result.replace(/ \/ 구성은 현장에서 변경 가능함(?=\n|$)/gu,'');
  if(includeFacts)for(const fact of list(proposal?.fields)){
    const note=clean(instructorFact(fact));if(!note||result.includes(note))continue;
    const combined=[result,note].filter(Boolean).join('\n');if(combined.length<=3000)result=combined;
  }
  return result;
}
