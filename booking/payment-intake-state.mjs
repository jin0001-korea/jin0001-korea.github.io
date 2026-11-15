import {defaultPaymentSeasonRegistration} from './payment-proposal-policy.mjs?v=5';
/** Editable review-only cards. No approval, network request or reservation write occurs here. */
export const MAX_PAYMENT_INTAKE_TEAMS=6;
export const MAX_PAYMENT_INTAKE_SESSIONS=100;
// Keep invalid numeric inputs distinguishable from unanswered null fields until validation.
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const uuid=()=>globalThis.crypto.randomUUID();
const strings=['company','customerName','phone','teamName','sport','date','startTime','notes','customerId','teamId'];
const numbers=['lessonMinutes','breakMinutes','studentCount','lessonFee','rentalFee','allocatedAmount'];
const common=['company','customerName','phone','customerId'];
const commonRegistration=['paymentSource','cashReceiptRequested','cashReceiptNumberMode','cashReceiptNumber','cashReceiptDefaulted'];
const sessionFields=['date','startTime','lessonMinutes','breakMinutes','lessonFee','rentalFee','allocatedAmount'];
const sessionRegistration=['rentalPaymentStatus','rentalHours','rentalCustomAmount','patchEnabled','patchFee','patchPaymentStatus','sessionNotes','paymentRequestCorrection'];
const metadata=['threadId','teamIndex','fields','requiresConfirmation','bookingType','scheduleStatus','totalSessions','selectionSource','sourcePass'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>own(value,key)).map(key=>[key,clone(value[key])]));
const applied=draft=>draft?.paymentComparison?.appliedProposal||{};
// Storage references are local to this snapshot. Original consultation/evidence and
// every editable value stay intact; expand before any source checking or editing.
function expandIntakeStorage(a){
 const storage=a.intakeStorage;if(storage===undefined)return;
 const invalid=()=>{throw new Error('저장된 상담 근거를 복원할 수 없습니다. 검토 내용을 다시 불러와 주세요.');};
 if(!storage||storage.version!==1||!Array.isArray(a.reviewedTeams)||Object.keys(storage).some(key=>!['version','fieldsTeamId','draftTeamId','quotes','teamQuotes','sources','teamSources'].includes(key))||own(storage,'quotes')!==own(storage,'teamQuotes')||own(storage,'sources')!==own(storage,'teamSources'))invalid();
 const active=id=>{const team=a.reviewedTeams.find(row=>row.id===id);if(!team||id!==a.activeTeamId||team.threadId!==a.threadId||team.teamIndex!==a.teamIndex)invalid();return team;};
 if(storage.teamQuotes!==undefined){
  if(!Array.isArray(storage.quotes)||!storage.quotes.every(value=>typeof value==='string')||!Array.isArray(storage.teamQuotes))invalid();
  for(const mapping of storage.teamQuotes){
   if(!Array.isArray(mapping)||mapping.length!==2||!Array.isArray(mapping[1]))invalid();
   const team=a.reviewedTeams.find(row=>row.id===mapping[0]);if(!team||!Array.isArray(team.fields))invalid();
   for(const pair of mapping[1]){if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair.some(n=>n<0))invalid();const field=team.fields[pair[0]],quote=storage.quotes[pair[1]];if(!field||typeof field!=='object'||Array.isArray(field)||typeof quote!=='string'||own(field,'quote'))invalid();field.quote=quote;}
  }
 }
 if(storage.teamSources!==undefined){
  if(!Array.isArray(storage.sources)||storage.sources.some(source=>!source||typeof source!=='object'||Array.isArray(source)||!Object.keys(source).length||Object.keys(source).some(key=>!['messageId','occurredAt'].includes(key)))||!Array.isArray(storage.teamSources))invalid();
  for(const mapping of storage.teamSources){
   if(!Array.isArray(mapping)||mapping.length!==2||!Array.isArray(mapping[1]))invalid();const team=a.reviewedTeams.find(row=>row.id===mapping[0]);if(!team||!Array.isArray(team.fields))invalid();
   for(const pair of mapping[1]){if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair.some(n=>n<0))invalid();const field=team.fields[pair[0]],source=storage.sources[pair[1]];if(!field||typeof field!=='object'||Array.isArray(field)||!source||Object.keys(source).some(key=>own(field,key)))invalid();Object.assign(field,clone(source));}
  }
 }
 if(storage.fieldsTeamId!==undefined){const team=active(storage.fieldsTeamId);if(own(a,'fields')||!Array.isArray(team.fields))invalid();a.fields=clone(team.fields);}
 if(storage.draftTeamId!==undefined){const team=active(storage.draftTeamId);if(own(a,'draft')||!team.draft)invalid();a.draft=clone(team.draft);}
 delete a.intakeStorage;
}
function compactIntakeStorage(next){
 const a=applied(next),teams=a.reviewedTeams||[],active=teams.find(row=>row.id===a.activeTeamId),storage={version:1};
 const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
 // Multi-team handoff reads each team's fields. A single lesson/pass also has
 // legacy direct handoff consumers, so its top-level inference reasons stay plain.
 if(teams.length>1&&teams.every(team=>team.bookingType!=='pass')&&active&&Array.isArray(a.fields)&&same(a.fields,active.fields)){delete a.fields;storage.fieldsTeamId=active.id;}
 if(active&&own(a,'draft')&&same(a.draft,active.draft)){delete a.draft;storage.draftTeamId=active.id;}
 const counts=new Map();for(const team of teams)for(const field of team.fields||[])if(typeof field?.quote==='string'&&new TextEncoder().encode(field.quote).length>=32)counts.set(field.quote,(counts.get(field.quote)||0)+1);
 const quotes=[...counts].filter(([,count])=>count>1).map(([quote])=>quote),indexes=new Map(quotes.map((quote,index)=>[quote,index])),teamQuotes=[];
 for(const team of teams){const refs=[];for(const [index,field]of (team.fields||[]).entries())if(indexes.has(field.quote)){refs.push([index,indexes.get(field.quote)]);delete field.quote;}if(refs.length)teamQuotes.push([team.id,refs]);}
 if(teamQuotes.length)Object.assign(storage,{quotes,teamQuotes});
 // These identifiers/timestamps are duplicated on every quoted field. Pool only
 // exact pairs in this snapshot; sourceId/threadId stay on their original field/team.
 const sourceCounts=new Map();for(const team of teams)for(const field of team.fields||[]){const source=pick(field,['messageId','occurredAt']),key=JSON.stringify(source);if(Object.keys(source).length)sourceCounts.set(key,(sourceCounts.get(key)||0)+1);}
 const sources=[...sourceCounts].filter(([key,count])=>count>1&&key.length>=32).map(([key])=>JSON.parse(key)),sourceIndexes=new Map(sources.map((source,index)=>[JSON.stringify(source),index])),teamSources=[];
 for(const team of teams){const refs=[];for(const [index,field]of (team.fields||[]).entries()){const key=JSON.stringify(pick(field,['messageId','occurredAt']));if(sourceIndexes.has(key)){refs.push([index,sourceIndexes.get(key)]);delete field.messageId;delete field.occurredAt;}}if(refs.length)teamSources.push([team.id,refs]);}
 if(teamSources.length)Object.assign(storage,{sources,teamSources});
 if(Object.keys(storage).length>1)a.intakeStorage=storage;
 return next;
}
// PostgreSQL jsonb::text adds spaces after separators and expands exponent-form
// numbers. Check the durable representation, not the larger hydrated editor copy.
function storedComparisonBytes(value){
 const json=JSON.stringify(value);let extra=0;
 for(const match of json.matchAll(/"(?:\\.|[^"\\])*"|[:,]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)){
  const token=match[0];if(token===','||token===':'){extra++;continue;}if(token.startsWith('"')||!/[eE]/.test(token))continue;
  const [mantissa,exponent]=token.toLowerCase().split('e'),unsigned=mantissa.replace('-',''),digits=unsigned.replace('.',''),point=(unsigned.includes('.')?unsigned.indexOf('.'):unsigned.length)+Number(exponent),length=(mantissa.startsWith('-')?1:0)+(point<=0?2-point+digits.length:point>=digits.length?point:digits.length+1);extra+=Math.max(0,length-token.length);
 }
 return new TextEncoder().encode(json).length+extra;
}
const finiteMoney=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function draftFields(value={}){return {...Object.fromEntries(strings.map(key=>[key,typeof value[key]==='string'?value[key]:''])),...Object.fromEntries(numbers.map(key=>[key,own(value,key)&&value[key]!==''?value[key]:null]))};}
function session(value={},registration={},id){const row={id:id||value.id||uuid(),...pick(draftFields(value),sessionFields),...pick(registration,sessionRegistration),...pick(value,sessionRegistration)};if(row.paymentRequestCorrection==null)delete row.paymentRequestCorrection;return row;}
function syncCorrectionMirror(team){
 team.registrationFields={...team.registrationFields};
 const correction=team.sessions?.[0]?.paymentRequestCorrection;
 if(correction)team.registrationFields.paymentRequestCorrection=clone(correction);else delete team.registrationFields.paymentRequestCorrection;
 return team;
}
function snapshot(draft,old={}){const a=applied(draft);return {...old,...pick(a,metadata),id:old.id||uuid(),label:draft.teamName||old.label||draft.customerName||'새 팀',draft:draftFields(draft),participants:clone(a.participants||[]),registrationFields:clone(a.registrationFields||{}),sessions:old.sessions?.length?clone(old.sessions):[session(draft,a.registrationFields)]};}
function setup(input={}){
 const next=clone(input),comparison=next.paymentComparison={version:1,status:'candidate',candidates:[],...obj(next.paymentComparison)},a=comparison.appliedProposal={...obj(comparison.appliedProposal)};
 expandIntakeStorage(a);
 if(!Array.isArray(a.reviewedTeams)||!a.reviewedTeams.length)a.reviewedTeams=[snapshot(next)];
 else a.reviewedTeams=a.reviewedTeams.map((value,index)=>{const team={...clone(value),id:value.id||uuid(),draft:draftFields(value.draft||{}),participants:clone(value.participants||[]),registrationFields:clone(value.registrationFields||{})};team.label=team.draft.teamName||team.label||next.customerName||`팀 ${index+1}`;team.sessions=Array.isArray(team.sessions)&&team.sessions.length?team.sessions.map(row=>session(row,{},row.id)): [session(team.draft,team.registrationFields)];return team;});
 const active=a.reviewedTeams.find(team=>team.id===a.activeTeamId)||a.reviewedTeams.find(team=>a.threadId&&team.threadId===a.threadId&&team.teamIndex===a.teamIndex)||a.reviewedTeams[0];
 a.activeTeamId=active.id;
 if(a.intakeVersion!==1){const updated=snapshot(next,active);updated.sessions[0]=session(next,updated.registrationFields,active.sessions[0].id);a.reviewedTeams[a.reviewedTeams.indexOf(active)]=updated;}
 for(const team of a.reviewedTeams)team.registrationFields=defaultPaymentSeasonRegistration(team.registrationFields,{bookingType:team.bookingType,sessions:team.sessions,facts:team.fields});
 a.intakeVersion=1;
 return next;
}
function promote(next,team){
 syncCorrectionMirror(team);
 const a=applied(next),commonValues=pick(next,common),commonValuesRegistration=pick(a.registrationFields||{},commonRegistration);
 Object.assign(next,draftFields(team.draft),pick(team.sessions[0],sessionFields),commonValues);
 for(const key of metadata)delete a[key];
 Object.assign(a,pick(team,metadata),{activeTeamId:team.id,participants:clone(team.participants||[]),registrationFields:{...clone(team.registrationFields||{}),...commonValuesRegistration,...pick(team.sessions[0],sessionRegistration)}});
 return next;
}
/** Restore the active card from durable data (stored top allocation is the whole bank allocation). */
export function hydratePaymentIntake(draft={}){const next=setup(draft),a=applied(next);return promote(next,a.reviewedTeams.find(team=>team.id===a.activeTeamId));}
/** Capture edits in the current top-level team and first session, leaving all other cards intact. */
export function syncPaymentIntake(draft={}){
 const next=setup(draft),a=applied(next),index=a.reviewedTeams.findIndex(team=>team.id===a.activeTeamId),old=a.reviewedTeams[index],team=snapshot(next,old);
 team.sessions[0]=session(next,a.registrationFields,old.sessions[0].id);
 team.registrationFields=defaultPaymentSeasonRegistration(team.registrationFields,{bookingType:team.bookingType,sessions:team.sessions,facts:team.fields});
 a.reviewedTeams[index]=syncCorrectionMirror(team);
 for(const row of a.reviewedTeams){Object.assign(row.draft,pick(next,common));row.registrationFields={...row.registrationFields,...pick(a.registrationFields||{},commonRegistration)};}
 return next;
}
export function paymentIntakeTeams(draft={}){return applied(syncPaymentIntake(draft)).reviewedTeams;}
export function switchPaymentIntakeTeam(draft,id){const next=syncPaymentIntake(draft),team=applied(next).reviewedTeams.find(row=>row.id===id);if(!team)throw new Error('확인할 팀 카드를 다시 선택해 주세요.');return promote(next,team);}
function finish(next,team){return promote(next,team);}
export function addPaymentIntakeTeam(draft,{copyDetails=true}={}){
 const next=syncPaymentIntake(draft),a=applied(next),source=a.reviewedTeams.find(team=>team.id===a.activeTeamId);
 if(a.reviewedTeams.length>=MAX_PAYMENT_INTAKE_TEAMS)throw new Error(`한 검토에서 최대 ${MAX_PAYMENT_INTAKE_TEAMS}팀까지 작성할 수 있습니다.`);
 if(source.bookingType==='pass')throw new Error('날짜 미정 수강권은 한 팀씩 검토해 주세요.');
 const team=copyDetails?clone(source):{draft:{...pick(source.draft,common),teamName:''},participants:[],registrationFields:pick(source.registrationFields,commonRegistration),bookingType:'lesson'};
 team.id=uuid();team.label=`팀 ${a.reviewedTeams.length+1}`;team.draft.teamName=team.label;team.draft.teamId='';team.draft.allocatedAmount=0;team.sessions=source.sessions.map(row=>({...clone(row),id:uuid(),allocatedAmount:0}));
 for(const row of team.sessions)delete row.paymentRequestCorrection;
 delete team.registrationFields.paymentRequestCorrection;
 // Passes, seasons and instructor/phone preferences belong to the original team.
 Object.assign(team.registrationFields,{kind:'single',isReorder:false,designated:false,preferredInstructorId:null,lessonPassId:null,seasonId:null,seasonTotal:null,sessionNumber:null,teamPhoneMode:'same',teamPhone:''});
 // New cards are staff-created copies, not another claim about the original source team.
 delete team.threadId;delete team.teamIndex;delete team.fields;delete team.sourcePass;team.selectionSource='staff';
 a.reviewedTeams.push(team);return finish(next,team);
}
export function removePaymentIntakeTeam(draft,id){const next=syncPaymentIntake(draft),a=applied(next);if(a.reviewedTeams.length===1)throw new Error('검토할 팀은 한 개 이상 남겨 주세요.');const index=a.reviewedTeams.findIndex(team=>team.id===id);if(index<0)return next;a.reviewedTeams.splice(index,1);return finish(next,a.reviewedTeams.find(team=>team.id===a.activeTeamId)||a.reviewedTeams[Math.min(index,a.reviewedTeams.length-1)]);}
const dateKey=row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')?row.date:'9999-99-99';
const sortSessions=team=>team.sessions.sort((a,b)=>dateKey(a).localeCompare(dateKey(b))||(a.startTime||'99:99').localeCompare(b.startTime||'99:99'));
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function activeMutation(draft,fn){const next=syncPaymentIntake(draft),a=applied(next),team=a.reviewedTeams.find(row=>row.id===a.activeTeamId);fn(team);return finish(next,team);}
export function addPaymentIntakeSessions(draft,dates){return activeMutation(draft,team=>{
 if(team.bookingType==='pass')throw new Error('날짜 미정 수강권에 강습 날짜를 임의로 추가할 수 없습니다.');
 if(!Array.isArray(dates)||dates.some(date=>!validDate(date)))throw new Error('추가할 강습 날짜를 확인해 주세요.');
 const first=team.sessions[0];for(const date of [...new Set(dates)]){if(team.sessions.some(row=>row.date===date&&row.startTime===first.startTime))continue;if(team.sessions.length>=MAX_PAYMENT_INTAKE_SESSIONS)throw new Error(`한 팀에 최대 ${MAX_PAYMENT_INTAKE_SESSIONS}회까지 작성할 수 있습니다.`);const added={...clone(first),id:uuid(),date,allocatedAmount:0};delete added.paymentRequestCorrection;team.sessions.push(added);}sortSessions(team);
 });}
export function updatePaymentIntakeSession(draft,id,patch={}){return activeMutation(draft,team=>{const row=team.sessions.find(value=>value.id===id);if(!row)throw new Error('수정할 회차를 다시 확인해 주세요.');Object.assign(row,pick(patch,[...sessionFields,...sessionRegistration]));if(row.paymentRequestCorrection==null)delete row.paymentRequestCorrection;if(own(patch,'lessonMinutes')&&patch.lessonMinutes===120)row.breakMinutes=0;sortSessions(team);});}
export function removePaymentIntakeSession(draft,id){return activeMutation(draft,team=>{if(team.sessions.length===1)throw new Error('검토할 회차는 한 개 이상 남겨 주세요.');team.sessions=team.sessions.filter(row=>row.id!==id);sortSessions(team);});}
/** Fees may be copied explicitly; manually divided bank amounts never are. */
export function copyPaymentIntakeSessionValues(draft,kind){return activeMutation(draft,team=>{const keys=kind==='schedule'?['startTime','lessonMinutes','breakMinutes']:kind==='financial'?['lessonFee','rentalFee','rentalPaymentStatus','rentalHours','rentalCustomAmount']:null;if(!keys)throw new Error('복사할 항목을 확인해 주세요.');for(const row of team.sessions.slice(1))for(const key of keys)if(own(team.sessions[0],key))row[key]=clone(team.sessions[0][key]);sortSessions(team);});}
export function paymentIntakeTotals(draft,remainingAmount=null){const teams=paymentIntakeTeams(draft),rows=teams.flatMap(team=>team.sessions);let allocatedAmount=0,lessonFee=0,rentalFee=0,unknownFees=0,invalidAllocations=0,unknownAllocations=0,requestedAmount=0,unknownRequestedAmounts=0;
 for(const row of rows){const amount=finiteMoney(row.allocatedAmount);if(amount===null){invalidAllocations++;if(row.allocatedAmount==null)unknownAllocations++;}else allocatedAmount+=amount;for(const key of ['lessonFee','rentalFee']){const n=finiteMoney(row[key]);if(n===null)unknownFees++;else if(key==='lessonFee')lessonFee+=n;else rentalFee+=n;}
  const corrected=row.paymentRequestCorrection?finiteMoney(row.paymentRequestCorrection.correctedRequestedAmount):null;
  if(row.paymentRequestCorrection){if(corrected===null)unknownRequestedAmounts++;else requestedAmount+=corrected;}
  else if(finiteMoney(row.lessonFee)===null||finiteMoney(row.rentalFee)===null)unknownRequestedAmounts++;else requestedAmount+=row.lessonFee+row.rentalFee;
 }
 return {teamCount:teams.length,sessionCount:rows.length,allocatedAmount,lessonFee,rentalFee,requestedAmount,unknownFees,unknownRequestedAmounts,invalidAllocations,unknownAllocations,remainingAmount:finiteMoney(remainingAmount)===null?null:remainingAmount-allocatedAmount};}
export function paymentIntakeCorrectionError(value){
 if(value==null)return '';
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['requestId','expectedVersion','correctedRequestedAmount','reason'].includes(key))||typeof value.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)||value.expectedVersion!==0)return '요청액 정정 정보를 다시 확인해 주세요.';
 if(finiteMoney(value.correctedRequestedAmount)===null||value.correctedRequestedAmount>1000000000)return '정정할 회차 총액을 0원 이상 10억원 이하의 정수로 입력해 주세요.';
 if(typeof value.reason!=='string'||!value.reason.trim()||value.reason.trim().length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.reason))return '요청액 정정 사유를 1~300자로 입력해 주세요.';
 return '';
}
export function validatePaymentIntake(draft,remainingAmount=null,{allowIncomplete=false}={}){const teams=paymentIntakeTeams(draft),totals=paymentIntakeTotals(draft,remainingAmount);if(teams.length>MAX_PAYMENT_INTAKE_TEAMS)return `최대 ${MAX_PAYMENT_INTAKE_TEAMS}팀까지 작성할 수 있습니다.`;
 if(teams.some(team=>team.sessions.length>MAX_PAYMENT_INTAKE_SESSIONS))return `한 팀에 최대 ${MAX_PAYMENT_INTAKE_SESSIONS}회까지 작성할 수 있습니다.`;
 if(teams.length>1&&teams.some(team=>team.bookingType==='pass'))return '날짜 미정 수강권은 한 팀씩 검토해 주세요.';
 if(teams.some(team=>team.bookingType==='pass'&&(team.sessions.length!==1||team.sessions.some(row=>row.date||row.startTime))))return '날짜 미정 수강권의 강습일·시간을 비워 주세요.';
 const correctionIds=new Set();for(const team of teams)for(const row of team.sessions){if(!row.paymentRequestCorrection)continue;if(team.bookingType==='pass')return '요청액 정정은 날짜가 정해진 회차별 예약에서 등록해 주세요.';const error=paymentIntakeCorrectionError(row.paymentRequestCorrection);if(error)return error;const id=row.paymentRequestCorrection.requestId.toLowerCase();if(correctionIds.has(id))return '팀·회차별 요청액 정정은 각각 따로 입력해 주세요.';correctionIds.add(id);}
 if(totals.invalidAllocations>(allowIncomplete?totals.unknownAllocations:0)||!Number.isSafeInteger(totals.allocatedAmount))return '회차별 입금 배분액을 0원 이상의 정수로 확인해 주세요.';
 if(totals.remainingAmount!==null&&totals.remainingAmount<0)return '팀·회차별 입금 배분액 합계가 아직 배분하지 않은 입금액보다 큽니다.';
 for(const team of teams)for(const row of team.sessions){if(row.date&&!validDate(row.date))return '강습 날짜를 확인해 주세요.';if(row.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime))return '강습 시작 시간을 확인해 주세요.';for(const key of ['lessonFee','rentalFee'])if(row[key]!==null&&row[key]!==''&&finiteMoney(row[key])===null)return '회차별 강습료·장비금액을 0원 이상의 정수로 확인해 주세요.';}
 if(storedComparisonBytes(serializePaymentIntake(draft).paymentComparison||{})>128000)return '검토 내용이 저장 가능한 크기를 넘었습니다. 팀·회차를 나누어 검토해 주세요.';return '';
}
/** Persist total allocation for the unchanged approval endpoint; each card retains its own amount. */
export function serializePaymentIntake(draft){const next=syncPaymentIntake(draft);next.allocatedAmount=paymentIntakeTotals(next).allocatedAmount;return compactIntakeStorage(next);}
