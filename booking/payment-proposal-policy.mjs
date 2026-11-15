// Owner-confirmed 2026-11-14 defaults. Callers supply only source-verified facts
// and source-scoped originals. These remain proposals until staff saves a booking.
const rows=value=>Array.isArray(value)?value:[];
const current=fact=>fact&&!['conflict','change_requested'].includes(fact.status);
const unique=(facts,field)=>{
 const matching=facts.filter(fact=>fact.field===field);
 if(!matching.length||matching.some(fact=>!current(fact))||new Set(matching.map(fact=>JSON.stringify(fact.value))).size!==1)return null;
 return matching[0];
};
const policyFact=(source,field,value,rule,reason)=>({...source,field,value,inferred:true,policyRule:rule,requiresConfirmation:true,reason,status:'current'});
const receiptFields=new Set(['cashReceiptRequested','cashReceiptNumber','cashReceiptPhone','cashReceiptType','cashReceiptNumberMode','receiptRequested','receiptNumber','receiptType']);
const mentionsReceipt=value=>typeof value==='string'&&/(?:영수증|소득\s*공제|지출\s*증빙|cash[\s-]*receipt|tax[\s-]*receipt)/iu.test(value);

/** An owner-selected intake default, not a quoted consultation fact.
 * Callers provide the selected customer's originals and verified facts. Keep
 * provenance so a later source request can replace an automatic “미요청”,
 * while an explicit staff/source boolean continues to take precedence. */
export function defaultPaymentCashReceipt(registrationFields={}, {facts=[],sources=[],receipts=[]}={}){
 const fields={...registrationFields},automatic=fields.cashReceiptDefaulted===true&&fields.cashReceiptRequested===false;
 if(fields.cashReceiptDefaulted===false)return fields;
 if(typeof fields.cashReceiptRequested==='boolean'&&!automatic){delete fields.cashReceiptDefaulted;return fields;}
 delete fields.cashReceiptDefaulted;
 if(automatic)fields.cashReceiptRequested=null;
 const requested=unique(rows(facts),'cashReceiptRequested');
 if(requested&&typeof requested.value==='boolean'){fields.cashReceiptRequested=requested.value;return fields;}
 const hasNumber=typeof fields.cashReceiptNumber==='string'&&fields.cashReceiptNumber.trim();
 const hasMention=rows(facts).some(fact=>receiptFields.has(fact?.field)||mentionsReceipt(fact?.quote))||rows(receipts).length>0||rows(sources).some(source=>mentionsReceipt(typeof source==='string'?source:source?.text));
 if(hasNumber||hasMention)return fields;
 return {...fields,cashReceiptRequested:false,cashReceiptDefaulted:true};
}

/** Same-team purchased repeat lessons keep one season instructor. The caller
 * supplies source-verified facts; this is an operating default, never a quote.
 * Existing package links remain intact; repeat lessons automatically use a season. */
export function defaultPaymentSeasonRegistration(registrationFields={}, {bookingType='lesson',sessions=[],facts=[]}={}){
 const fields={...registrationFields};
 if(bookingType==='pass'||fields.lessonPassId||fields.seasonId)return fields;
 const verified=rows(facts).filter(fact=>current(fact)&&typeof fact.quote==='string'&&fact.quote.trim()&&fact.messageId);
 const dated=rows(sessions).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row?.date||'')&&verified.some(fact=>fact.field==='date'&&fact.value===row.date));
 if(!dated.length)return fields;
 const scheduled=new Set(dated.map(row=>`${row.date}:${row.startTime||''}`)).size;
 const counts=verified.filter(fact=>['lessonCount','lessonPassCount'].includes(fact.field)).map(fact=>typeof fact.value==='string'&&/^\d{1,3}$/.test(fact.value)?Number(fact.value):fact.value);
 if(counts.some(value=>!Number.isSafeInteger(value)||value<1||value>100)||new Set(counts).size>1)return fields;
 const total=counts[0]??scheduled;
 if(total<2||total<scheduled||total>100)return fields;
 return {...fields,kind:'season',seasonTotal:Number.isSafeInteger(fields.seasonTotal)&&fields.seasonTotal>=total?fields.seasonTotal:total,sessionNumber:1};
}
const sourceQuoteLines=fact=>String(fact?.quote||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
function sourceFactLines(fact,sourceText){
 const quoted=sourceQuoteLines(fact),quote=String(fact?.quote||'').trim();
 if(quoted.length!==1||typeof sourceText!=='string'||!quote)return quoted;
 const containing=[...new Set(sourceText.split(/\r?\n/).map(line=>line.trim()).filter(line=>line.includes(quote)))];
 // A short model quote may omit the field label. Restore only its unique
 // source line; repeated/ambiguous names cannot borrow a different context.
 return containing.length===1?containing:quoted;
}

/** Validate meaning as well as type before accepting legacy model fields.
 * The caller must first verify the quote against the source-owned original.
 * This never changes existing staff-entered booking/registration fields. */
export function normalizePaymentTypedProposalFact(fact,{sourceText}={}){
 if(!fact||typeof fact!=='object')return null;
 if(fact.field==='preferredInstructor'){
  if(typeof fact.value!=='string')return null;
  const value=fact.value.trim();
  if(!value||/(?:주니어\s*(?:기술\s*)?등급|목표|준비|대비|강습\s*경험|기존\s*고객|\d+\s*(?:회|시간|살|세))/u.test(value))return null;
  // A name must be present in a line that actually refers to an instructor.
  // An arbitrary word elsewhere in the invoice is not instructor evidence.
  if(!sourceFactLines(fact,sourceText).some(line=>/(?:강사|선생님|코치)/u.test(line)&&line.includes(value)))return null;
  return {...fact,value};
 }
 if(fact.field==='experienceCount'){
  const value=typeof fact.value==='string'&&/^\d+$/u.test(fact.value)?Number(fact.value):fact.value;
  if(!Number.isSafeInteger(value)||value<0||value>999)return null;
  const supported=sourceFactLines(fact,sourceText).some(line=>{
   if(/[?？]|미확인|모르|불명/u.test(line))return false;
   const experience=/(?:강습\s*)?경험\s*(?:횟수|은|는|이|을)?\s*[:;：]?\s*(무(?![가-힣])|없(?:음|어요|습니다|다)?|처음|\d{1,3}\s*(?:회|번)(?![0-9]|권))/u.exec(line);
   if(experience){
    const number=/\d+/u.exec(experience[1]),after=line.slice(experience.index+experience[0].length);
    if(!/^\s*(?:권|구매|예정|신청|예약|계획)/u.test(after)&&(number?Number(number[0]):0)===value)return true;
   }
   const direct=/^(?:\d+[.)]\s*)?(?:이전\s*|기존\s*)?(?:스키\s*|보드\s*)?강습\s*경험(?:\s*횟수)?\s*[:;：]\s*(.*?)\s*[.!]?$/u.exec(line);
   if(direct){
    const answer=direct[1].trim();
    if(value===0&&/^(?:무|없음|없어요|없습니다|처음|0(?:\s*회)?|무경험)$/u.test(answer))return true;
    const count=/^(\d{1,3})\s*(?:회|번)(?:\s*이상)?\s*(?:입니다|했어요|있어요|받았어요|받았습니다)?$/u.exec(answer);
    if(count&&Number(count[1])===value)return true;
   }
   // A purchased/future pass is not proof of previous lessons. This bounded
   // statement accepts completed lessons only, including ordinary prose.
   const completed=/(?:스키|보드|강습|레슨)[^\n.!?]{0,24}?(?<![0-9])(\d{1,3})\s*(?:회|번)(?:를|정도)?\s*(?:강습(?:을)?\s*)?(?:배웠|받았|했었|수강했)/u.exec(line);
   return !!completed&&Number(completed[1])===value;
  });
  return supported?{...fact,value}:null;
 }
 return fact;
}

export function koreanAgeForSchoolGrade(value){
 const match=/^(초(?:등(?:학교)?)?|중(?:학교)?|고(?:등학교)?)[ ]*([1-6])(?:[ ]*학년)?$/u.exec(String(value??'').trim());
 if(!match)return null;
 const grade=Number(match[2]),school=match[1][0];if(school!=='초'&&grade>3)return null;
 return grade+({초:7,중:13,고:16})[school];
}
function rosterToken(value){
 const text=value.trim(),gradeAge=koreanAgeForSchoolGrade(text);
 if(gradeAge!==null)return {type:'minor',age:gradeAge,grade:text};
 if(/^(엄마|아빠|성인)$/u.test(text))return {type:'adult',age:null};
 const age=/^([1-9][0-9]?)\s*세$/u.exec(text);if(age)return {type:Number(age[1])<=19?'minor':'adult',age:Number(age[1])};
 return null;
}
function gradeParticipants(fact){
 if(!Array.isArray(fact?.value)||!fact.value.some(row=>row.type==='minor'&&row.age===null))return null;
 const rosters=String(fact.quote||'').split(/\r?\n/).map(line=>line.replace(/^\s*(?:\d+[.)]\s*)?강습생\s*(?:연령|나이)\s*[:;：]\s*/u,'').split(/\s*[,，]\s*/u).map(rosterToken)).filter(tokens=>tokens.length&&tokens.every(Boolean)&&tokens.some(row=>row.grade));
 const matching=rosters.map(tokens=>tokens.length===fact.value.length&&tokens.every((row,index)=>row.type===fact.value[index].type)?tokens:fact.value.every(row=>row.type==='minor')&&tokens.filter(row=>row.type==='minor').length===fact.value.length?tokens.filter(row=>row.type==='minor'):null).filter(Boolean);
 if(matching.length!==1)return null;
 const roster=matching[0],changes=[];
 const value=fact.value.map((row,index)=>{const token=roster[index];if(row.type!=='minor'||row.age!==null||!token.grade)return {...row};changes.push(`${token.grade}→${token.age}세`);return {...row,age:token.age};});
 if(!changes.length)return null;
 return policyFact(fact,'participants',value,'school-grade-korean-age',`한국식 나이 추정 · ${changes.join(', ')}. 담당자 확인 필요.`);
}
function sourceLines(sources){return rows(sources).flatMap(source=>typeof source?.text==='string'?source.text.split(/\r?\n/).map(quote=>({source,quote:quote.trim()})).filter(row=>row.quote):[]);}
function invoiceRentalHours(sources,invoiceEvidence){
 const found=[];let mentioned=false,ambiguous=false;
 for(const evidence of rows(invoiceEvidence)){
  const source=rows(sources).find(row=>(row.messageId||row.id)===evidence.messageId),quote=String(evidence.quote||'');
  if(!source||!quote.trim()||!source.text?.includes(quote))continue;
  for(const line of quote.split(/\r?\n/).map(value=>value.trim())){
   // Read only the verified invoice's rental line, not another message, a
   // follow-up coupon or the resort/lift conditions appended to the invoice.
   if(/(?:광고|홍보|프로모션|쿠폰|다음|추후|요금표|일반\s*요금|리프트|패찰|강습\s*허용권)/u.test(line))continue;
   const match=/^(?:[-*•]\s*)?(?:장비\s*(?:렌탈|대여)?|렌탈|대여)\s*(?:요금|할인(?:가)?|이용(?:시간)?|비용|포함|무료|유료|안내)?\s*(?:[:;：]|\(|\[)?\s*(\d{1,2})\s*시간/u.exec(line);
   if(!match)continue;mentioned=true;
   if(new Set([...line.matchAll(/(?<![0-9])(\d{1,2})\s*시간/gu)].map(item=>Number(item[1]))).size>1){ambiguous=true;continue;}
   const value=Number(match[1]);
   if(![4,6].includes(value)){ambiguous=true;continue;}
   found.push({field:'rentalHours',value,quote:line,messageId:source.messageId||source.id,occurredAt:source.occurredAt||null,status:'current',reason:'같은 검증된 결제 안내 원문에 명시된 장비 이용시간입니다.'});
  }
 }
 const agreed=!ambiguous&&unique(found,'rentalHours');
 return {mentioned,fact:agreed||null};
}
function juniorGoalEvidence(facts,lines){
 const participants=unique(facts,'participants')?.value;
 if(Array.isArray(participants)&&participants.length&&participants.every(row=>row.type==='adult'))return [];
 return lines.filter(({quote})=>{
  if(quote.length>200||!/(?:주니어\s*(?:기술\s*)?등급(?:제)?)/u.test(quote)||!/(?:목표|준비|대비|도전)/u.test(quote))return false;
  // Programme advertising, conditional offers, questions and negative goals
  // must not turn into a learner's preparation preference.
  if(/(?:홍보|광고|프로그램|모집|과정\s*안내|이벤트|쿠폰|할인|요금표|원하시면|하시면|한다면|하려면|하나요|인가요|가능한가|미정|고민|문의|여부|[?？]|않|아니|아님|없|안\s*(?:준비|대비|도전)|준비\s*안)/u.test(quote))return false;
  const ages=[...quote.matchAll(/(?<![0-9])([1-9][0-9]?)\s*(?:살|세)/gu)].map(match=>Number(match[1]));
  if(ages.length&&Array.isArray(participants)&&participants.length&&participants.every(row=>Number.isSafeInteger(row.age))&&!participants.some(row=>ages.includes(row.age)))return false;
  return true;
 });
}
function juniorPreparationFacts(facts,lines){
 if(facts.some(fact=>fact.field==='juniorPreparation'))return [];
 const evidence=juniorGoalEvidence(facts,lines);if(!evidence.length)return [];
 const {source,quote}=evidence[0];
 return [policyFact({quote,messageId:source.messageId||source.id,occurredAt:source.occurredAt||null},'juniorPreparation',true,'source-junior-preparation','원문에 명시된 주니어 기술등급 목표·준비를 반영한 제안입니다. 등급 보유나 패러렐 가능을 확정하지 않으며 담당자가 확인합니다.')];
}
function explicitParallelResponses(lines){
 return lines.flatMap(({source,quote})=>{
  const match=/^(?:\d+[.)]\s*)?(?:스키\s*)?(?:패러렐|패럴렐|페러렐)\s*롱턴\s*(?:가능\s*여부|가능|여부)?\s*[:;：]\s*(가능|불가|불가능|가능해요|가능합니다|못해요|아니오|예|네|무)\s*[.!]?$/u.exec(quote);
  if(!match)return [];
  return [{field:'parallelLongTurn',value:/^(가능|가능해요|가능합니다|예|네)$/u.test(match[1]),quote,messageId:source.messageId||source.id,occurredAt:source.occurredAt||null,status:'current',reason:'같은 상담 원문에 명시된 패러렐 롱턴 응답입니다.'}];
 });
}
function hasAdvancedEvidence(facts,lines){
 if(facts.some(fact=>current(fact)&&fact.field==='experienceCount'&&Number.isSafeInteger(fact.value)&&fact.value>=6&&fact.value<=999)||facts.some(fact=>current(fact)&&fact.field==='juniorPreparation'&&fact.value===true)||juniorGoalEvidence(facts,lines).length)return true;
 return lines.some(({quote})=>{
  // A price list, future pass purchase or generic certification advertisement
  // does not establish this learner's previous lessons or qualification.
  const experience=/^(?:\d+[.)]\s*)?(?:스키\s*)?강습\s*경험\s*[:;：]\s*(\d{1,3})\s*회(?:\s*이상)?\s*(?:입니다|했어요|있어요)?[.!]?$/u.exec(quote);
  if(experience&&Number(experience[1])>=6)return true;
  return /^(?:\d+[.)]\s*)?주니어\s*(?:기술\s*)?등급(?:제)?\s*(?:보유|취득|합격|자격|여부)?\s*[:;：]\s*(?:(?:[1-9]\s*(?:급|등급|레벨)(?:\s*(?:보유|취득|합격|통과))?)|있(?:음|어요)|보유|취득|합격)\s*[.!]?$/u.test(quote)||/^(?:저는|아이는|저희\s*아이는|우리\s*아이는)\s*주니어\s*(?:기술\s*)?등급(?:제)?\s*[1-9]\s*(?:급|등급|레벨)을?\s*(?:땄|취득했|합격했|통과했|보유하고)/u.test(quote);
 });
}

/** Additional/replacement facts, never bank/customer identity or booked values. */
export function derivePaymentProposalPolicyFacts({facts=[],sources=[],invoiceEvidence=[]}={}){
 const additions=[],company=unique(facts,'company'),free=unique(facts,'rentalPaymentStatus'),hours=facts.filter(fact=>fact.field==='rentalHours');
 const rentalHours=company?.value==='곤지암 캐치스키'?6:['곤지암 라이즌','지산 라이즌스키'].includes(company?.value)?4:null;
 const explicitHours=invoiceRentalHours(sources,invoiceEvidence);
 if(!hours.length&&explicitHours.fact)additions.push(explicitHours.fact);
 else if(free?.value==='free'&&rentalHours!==null&&!hours.length&&!explicitHours.mentioned)additions.push(policyFact(free,'rentalHours',rentalHours,'free-equipment-hours',`무료 장비 운영 기준 · ${company.value} ${rentalHours}시간 제안. 담당자 확인 필요.`));
 const participants=unique(facts,'participants'),graded=gradeParticipants(participants);if(graded)additions.push(graded);
 const lines=sourceLines(sources);additions.push(...juniorPreparationFacts(facts,lines));
 const sport=unique(facts,'sport');
 if(sport?.value==='스키'&&!facts.some(fact=>fact.field==='parallelLongTurn')){
  const responses=explicitParallelResponses(lines),response=unique(responses,'parallelLongTurn');
  if(response)additions.push(response);
  else if(!responses.length&&!hasAdvancedEvidence(facts,lines))additions.push(policyFact(sport,'parallelLongTurn',false,'parallel-unqualified-default','운영 기준 · 주니어 기술등급·강습 경험 6회 이상 근거가 없어 패러렐 불가 제안. 담당자 확인 필요.'));
 }
 return additions;
}
