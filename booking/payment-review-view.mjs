import {reconcilePaymentReviewProgress} from './payment-review-progress.mjs?v=3';
import {buildPaymentInstructorNotes} from './payment-instructor-notes.mjs?v=2';
import {syncBookingReviewRentalFields,syncBookingReviewFinancialFields} from './booking-view.mjs?v=81';
import {hydratePaymentIntake,syncPaymentIntake,paymentIntakeTeams,paymentIntakeTotals,serializePaymentIntake,validatePaymentIntake,switchPaymentIntakeTeam,addPaymentIntakeTeam,removePaymentIntakeTeam,addPaymentIntakeSessions,removePaymentIntakeSession,copyPaymentIntakeSessionValues} from './payment-intake-state.mjs?v=7';
import {preparePaymentIntake,renderPaymentIntake,capturePaymentIntakeSessions,scopedPaymentIntakeForm,syncPaymentIntakeTotals} from './payment-intake-view.mjs?v=73';
import {BOOKING_COMPANIES} from './company-options.mjs?v=31';
import {renderPaymentConversation} from './payment-conversation.mjs?v=2';
import {renderPaymentPriceBreakdown} from './payment-price-breakdown.mjs?v=3';
import {derivePaymentProposalPolicyFacts,normalizePaymentTypedProposalFact,defaultPaymentCashReceipt,defaultPaymentSeasonRegistration} from './payment-proposal-policy.mjs?v=5';
import {buildPaymentAllocationProposal,applyPaymentAllocationProposal,paymentSummaryOnlyCoverageLimit} from './payment-allocation.mjs?v=5';
import {buildPaymentInstructorHistoryProposal} from './payment-instructor-history.mjs?v=2';
import {recoverPaymentSourceSession} from './payment-session-proposals.mjs?v=1';
import {resolvePaymentSchedule} from './payment-schedule-resolution.mjs?v=2';
import {paymentReviewSaveStatus,paymentUploadSaveStatus} from './payment-review-save-status.mjs?v=2';
import {savedPaymentRecords,renderSavedPaymentRecords} from './payment-saved-records-view.mjs?v=2';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value:'';
const disabled=value=>value?'disabled':'';
const won=value=>Number.isSafeInteger(value)&&value>=0?`${value.toLocaleString('ko-KR')}원`:'금액 미확인';
const stampFormatter=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const stamp=value=>Number.isFinite(Date.parse(value))?stampFormatter.format(new Date(value)):'시각 미확인';
const ORIGIN='https://ewiekbmjvgktwsbbxrzw.supabase.co';
const BUCKET='slope-payment-captures';
const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
const phoneKey=value=>{let key=String(value||'').replace(/[^0-9]/g,'');if(/^82[1-9][0-9]{7,10}$/.test(key))key='0'+key.slice(2);return key;};
const MAX_IMAGE_BYTES=8*1024*1024;
const MAX_BATCH_UPLOADS=12;
const validBankDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>0&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const validBankTime=value=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value);
function bankFields(value){
  const raw=text(value);
  if(!raw)return {bankDate:'',bankTime:'',displayTime:'',bankTimestampError:''};
  if(validBankDate(raw))return {bankDate:raw,bankTime:'',displayTime:'',bankTimestampError:''};
  const match=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,9})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.exec(raw);
  if(!match||!validBankDate(match[1]))return {bankDate:'',bankTime:'',displayTime:'',bankTimestampError:'입금 날짜와 시간을 원본에서 다시 확인해 주세요.'};
  const epoch=Date.parse(raw+(match[6]?'':'+09:00'));
  if(!Number.isFinite(epoch))return {bankDate:'',bankTime:'',displayTime:'',bankTimestampError:'입금 날짜와 시간을 원본에서 다시 확인해 주세요.'};
  // Convert only the display to Korea time. The exact source string stays on the edit.
  const korea=new Date(epoch+9*60*60*1000).toISOString(),fraction=match[5]||'',clock=korea.slice(11,match[4]===undefined?16:19),displayTime=clock+fraction;
  return {bankDate:korea.slice(0,10),bankTime:clock+fraction.slice(0,4),displayTime,bankTimestampError:''};
}
function bankInputError(date,time){
  if(date&&!validBankDate(date))return '입금 날짜를 실제 존재하는 날짜로 입력해 주세요.';
  if(time&&!validBankTime(time))return '입금 시간을 00:00~23:59 범위로 입력해 주세요. 초가 보이면 초까지 입력하세요.';
  if(time&&!date)return '입금 시간을 입력하려면 입금 날짜도 확인해 주세요.';
  return '';
}
function bankSummary(edit){
  const parsed=bankFields(edit.transactionDate);
  if(edit.bankTimestampError||parsed.bankTimestampError)return '입금 날짜·시간 확인 필요';
  if(!parsed.bankDate)return '입금 날짜·시간 미확인 · 확인 필요';
  return `${parsed.bankDate}${parsed.displayTime?` ${parsed.displayTime} (KST)${parsed.displayTime.length===5?' · 초 미확인 · 확인 필요':''}`: ' · 시간 미확인 · 확인 필요'}`;
}
function latestProposalFor(u,edit){
  const result=u.latestProposal;
  return result&&edit?.id===result.reviewId&&edit.version===result.expectedVersion?result:null;
}
const freshnessKey=edit=>edit?.id&&Number.isSafeInteger(edit.version)?`${edit.id}:${edit.version}`:'';
function unlinkedSourceCandidates(edit,result){
  const saved=list(edit?.draft.paymentComparison?.candidates),refs=list(edit?.evidenceRefs);
  return list(result?.candidates).filter(candidate=>candidate?.sourceId&&phoneKey(candidate.phone)&&list(candidate.messages).some(message=>typeof message.text==='string')&&(candidate.nameMatched===true||phoneKey(edit?.draft.phone)&&phoneKey(edit.draft.phone)===phoneKey(candidate.phone))).filter(candidate=>{
    const linked=saved.find(row=>row.sourceId===candidate.sourceId&&phoneKey(row.phone)===phoneKey(candidate.phone));
    return !linked||list(candidate.messages).some(message=>!refs.some(ref=>ref.sourceId===candidate.sourceId&&ref.messageId===(message.id||message.messageId))&&!list(linked.evidenceRefs).some(ref=>ref.sourceId===candidate.sourceId&&ref.messageId===(message.id||message.messageId)));
  });
}
function sourceFreshnessMarkup(u,edit,busy){
  const result=u.sourceFreshness?.[freshnessKey(edit)];if(!result)return '';
  if(result.status==='loading')return '<p class="pr-field-note" role="status">이 검토에 연결되지 않은 문자·MMS가 있는지 확인하고 있습니다…</p>';
  if(result.status==='failed')return '<p class="pr-warning">최신 문자·MMS 연결 여부를 확인하지 못했습니다. 아래 최신 상담 다시 분석으로 재확인할 수 있습니다.</p>';
  const candidates=unlinkedSourceCandidates(edit,result);if(!candidates.length)return '';
  return `<section class="pr-warning pr-source-freshness" role="status"><strong>이 검토에 연결되지 않은 문자·MMS가 있습니다</strong><p>${candidates.map(candidate=>`${esc(candidate.sourceLabel||'문자 수신함')} · ${esc(candidate.phone)}`).join(' / ')}</p><p>현재 화면은 저장된 분석 결과입니다. 최신 상담을 다시 분석한 뒤 새 팀·금액 제안을 반영하세요. 검색 후보가 같은 고객인지 원문을 대조해야 합니다.</p><button type="button" class="btn primary small" data-pr-freshness-reanalyze ${disabled(busy)}>문자·MMS 포함 최신 상담 다시 분석</button></section>`;
}
export function applyLatestPaymentProposal(edit,result){
  const proposal=result?.proposal;
  if(!edit?.id||edit.status!=='draft'||result?.reviewId!==edit.id||result.expectedVersion!==edit.version||!proposal||proposal.payerName!==edit.payerName||proposal.amount!==edit.amount||String(proposal.transactionDate||'')!==String(edit.transactionDate||''))return false;
  const comparison=normalizePaymentDraft(proposal.draft).paymentComparison;
  if(!comparison)return false;
  // Replace only the suggested evidence. Staff-entered booking and bank fields
  // remain intact until the operator explicitly selects and applies a team.
  if(edit.draft.paymentComparison?.appliedProposal)comparison.appliedProposal=JSON.parse(JSON.stringify(edit.draft.paymentComparison.appliedProposal));
  else delete comparison.appliedProposal;
  comparison.refreshedForReview=true;
  edit.draft.paymentComparison=comparison;
  edit.evidenceRefs=list(proposal.evidenceRefs).map(row=>({sourceId:row.sourceId,messageId:row.messageId}));
  invalidate(edit);
  return true;
}
function latestTeamActions(comparison,busy,kind){
  return list(comparison?.candidates).map((candidate,index)=>{const teams=list(comparison?.consultation?.teams).filter(team=>team.threadId===candidate.threadId);return teams.length?`<button type="button" class="btn primary small" data-pr-apply-${kind}-teams="${index}" ${disabled(busy||teams.length>6)}>${esc(candidate.sourceLabel||'이 상담')} ${teams.length}팀·강습 내용 적용</button>`:'';}).join('');
}
function latestAnalysisMarkup(u,edit,busy){
  if(!edit?.id||edit.status!=='draft')return '';
  const result=latestProposalFor(u,edit),comparison=result?.proposal?.draft?.paymentComparison;
  const teamCount=value=>list(value?.consultation?.teams).length;
  return `${sourceFreshnessMarkup(u,edit,busy)}<section class="pr-latest-analysis" aria-label="최신 상담 재대조"><div><strong>최신 상담으로 팀·회차 다시 계산</strong><p>새 문자·카카오 원문을 분석해 모든 팀과 날짜를 작성란에 함께 채웁니다.</p></div><button type="button" class="btn secondary small" data-pr-review-reanalyze ${disabled(busy)}>${u.reanalyzingReviewId===edit.id?'최신 상담 분석 중…':'최신 상담 다시 분석'}</button>${comparison?`<div class="pr-latest-preview" role="region" aria-label="새 분석 결과 비교"><h4>${list(comparison.candidates).length===1&&list(edit.draft.paymentComparison?.candidates).length<=1?`기존 제안 ${teamCount(edit.draft.paymentComparison)}팀 → 새 제안 ${teamCount(comparison)}팀`:'상담 출처별 팀·회차 분석'}</h4><p>입금 ${won(edit.amount)} · ${esc(edit.payerName)} · ${esc(bankSummary(edit))}</p><p>${list(comparison.candidates).map(candidate=>`${esc(candidate.sourceLabel||'상담')} · ${esc(candidate.phone||'전화번호 확인 필요')}`).join(' / ')||'연결된 상담 후보 없음'}</p>${renderPaymentPriceBreakdown(comparison,edit.amount)}<p>자동 반영되지 않은 결과는 상담 출처를 확인한 뒤 팀 전체를 반영할 수 있습니다. 기존 팀·회차 입력은 새 제안으로 바뀌고, 입금 배분액도 원문 견적에 따라 초안으로 제안하므로 담당자가 확인합니다. 은행 내역과 고객·확인 메모는 유지합니다.</p><div class="pr-latest-actions">${latestTeamActions(comparison,busy,'latest')}<button type="button" class="btn secondary small" data-pr-apply-latest ${disabled(busy)}>새 분석 근거 반영</button><button type="button" class="btn ghost small" data-pr-dismiss-latest ${disabled(busy)}>기존 내용 유지</button></div></div>`:''}</section>`;
}
function uploadAnalysisMarkup(u,edit,busy){
  const uploadId=u.detail?.upload?.id,result=u.uploadAnalysisPreviews?.[uploadId],error=u.uploadAnalysisErrors?.[uploadId];
  if(!result)return error?`<p class="pr-feedback pr-error" data-pr-upload-analysis-error role="alert">${esc(error)}</p>`:'';
  const proposals=list(result.proposals),index=Math.min(Math.max(result.selectedIndex||0,0),Math.max(0,proposals.length-1)),proposal=proposals[index],comparison=proposal?.draft?.paymentComparison;
  const sameBank=edit?.status==='draft'&&proposal?.payerName===edit.payerName&&proposal?.amount===edit.amount&&String(proposal?.transactionDate||'')===String(edit.transactionDate||'');
  const explanation={not_bank:'이번 원본은 은행 입금내역으로 확인되지 않았습니다.',no_deposits:'이번 원본에서 입금 내역을 찾지 못했습니다.',needs_review:'원본의 입금 내역을 직접 확인해야 합니다.'}[result.outcome];
  return `<section class="pr-latest-analysis pr-upload-analysis" data-pr-upload-analysis aria-label="새 원본 분석 결과"><h3>새 원본 분석 결과</h3><p>사진 원본과 현재 저장된 상담을 새로 읽었습니다. 기존 검토·예약 내용은 유지했습니다.</p>${proposals.length>1?`<label class="pr-field"><span>이번에 읽은 입금 ${proposals.length}건</span><select data-pr-upload-analysis-row ${disabled(busy)}>${proposals.map((row,i)=>option(String(i),`${row.payerName||'입금자 미확인'} · ${won(row.amount)}`,String(index))).join('')}</select></label>`:''}<div class="pr-latest-preview" role="region" aria-label="새 분석 결과 상세">${proposal?`<p><strong>${esc(proposal.payerName||'입금자 미확인')} · ${won(proposal.amount)}</strong><br>${esc(bankSummary(proposal))}</p>${comparison?renderPaymentPriceBreakdown(comparison,proposal.amount):'<p>상담 제안을 확인하지 못했습니다. 원본과 직접 대조하세요.</p>'}${sameBank&&comparison?'<p>자동 반영되지 않은 결과는 상담 출처를 확인한 뒤 팀 전체를 반영할 수 있습니다. 기존 팀·회차 입력은 바뀌고, 입금 배분액도 원문 견적에 따라 초안으로 제안하므로 담당자가 확인합니다. 은행 내역과 고객·확인 메모는 유지합니다.</p>':edit?.status==='draft'?'<p>현재 검토와 은행 값이 다르면 원본을 대조해 직접 수정한 뒤 근거를 반영하세요.</p>':'<p>작성 준비·예약 반영한 검토는 새 제안과 나란히 확인할 수 있습니다.</p>'}`:`<p>${esc(explanation||'새 검토 제안을 만들지 못했습니다. 원본을 확인하세요.')}</p>`}<div class="pr-latest-actions">${(()=>{const adoptable=proposals.filter(row=>row.rowKey&&!list(u.detail?.reviews).some(existing=>existing.rowKey===row.rowKey)).length;return adoptable&&u.detail?.upload?.status==='ready'?`<button type="button" class="btn primary small" data-pr-adopt-upload-analysis ${disabled(busy)}>읽은 입금 ${adoptable}건 검토 초안 만들기</button>`:'';})()}${sameBank&&comparison?latestTeamActions(comparison,busy,'upload'):''}${sameBank&&comparison?`<button type="button" class="btn secondary small" data-pr-apply-upload-analysis ${disabled(busy)}>이 검토에 새 분석 근거 반영</button>`:''}<button type="button" class="btn ghost small" data-pr-dismiss-upload-analysis ${disabled(busy)}>새 분석 닫기</button></div></div></section>`;
}
const draftStrings=['company','customerName','phone','teamName','sport','date','startTime','notes','customerId','teamId'];
const draftNumbers=['lessonMinutes','breakMinutes','studentCount','lessonFee','rentalFee','allocatedAmount'];
const labels={pending:'업로드 확인 중',ready:'업로드 완료',awaiting_analysis:'분석 요청 대기',deleting:'삭제 처리 필요',analyzing:'자동 분석 중',analysis_failed:'분석 실패 · 재시도 가능',analysis_succeeded:'분석 완료 · 직접 확인 필요',draft:'대조 필요',approved:'작성 준비 완료',committed:'예약·수강권 반영'};
const queueStatus=upload=>upload.deletingAt?'deleting':upload.status==='pending'?'pending':upload.analysisStatus==='running'?'analyzing':upload.analysisStatus==='failed'?'analysis_failed':upload.analysisStatus==='succeeded'&&!['draft','approved','committed'].includes(upload.reviewStatus)?'analysis_succeeded':upload.reviewStatus||'ready';
const completedReviewUpload=upload=>Number.isSafeInteger(upload.reviewCount)?upload.reviewCount>0&&upload.committedReviewCount===upload.reviewCount:upload.reviewStatus==='committed';
const visibleQueueUploads=(data,filter)=>data?.filter===filter?list(data.uploads):list(data?.uploads).filter(row=>filter==='all'||(filter==='completed'?completedReviewUpload(row):!completedReviewUpload(row)));
const analysisExpired=upload=>upload?.analysisStatus==='running'&&Number.isFinite(Date.parse(upload.analysisLeaseExpiresAt))&&Date.parse(upload.analysisLeaseExpiresAt)<=Date.now();
const protectedUpload=detail=>Number(detail?.upload?.approvedReviewCount)>0||Number(detail?.upload?.committedReviewCount)>0||['approved','committed'].includes(detail?.upload?.reviewStatus)||list(detail?.reviews).some(review=>['approved','committed'].includes(review.status));
const deletionProtectedUpload=detail=>{
  const upload=detail?.upload||{},reviews=list(detail?.reviews).filter(row=>row.id),fullySaved=completedReviewUpload(upload)||(reviews.length>0&&reviews.every(row=>row.status==='committed')&&(!Number.isSafeInteger(upload.reviewCount)||upload.reviewCount===reviews.length));
  if(fullySaved)return false;
  if(reviews.some(review=>review.status==='committed'||Number(review.allocatedAmount)>0||list(review.allocations).length>0))return true;
  if(typeof upload.canDelete==='boolean')return !upload.canDelete;
  return upload.deletionProtected===true||(upload.deletionProtected!==false&&protectedUpload(detail));
};
const deletionProtectedMessage='아직 예약·수강권에 반영하지 않은 입금이 있습니다. 남은 예약을 저장한 뒤 캡처를 삭제해 주세요.';
const actionErrors={UPLOAD_PARTIALLY_ALLOCATED:deletionProtectedMessage,ANALYSIS_API_KEY_INVALID:'자동 분석 API 키를 인증하지 못했습니다. 관리자에게 API 키 설정을 확인해 달라고 요청하세요.',ANALYSIS_API_ACCESS_DENIED:'자동 분석 API 접근이 거절되었습니다. 관리자에게 프로젝트·모델 접근 권한을 확인해 달라고 요청하세요.',ANALYSIS_BATCH_INCOMPLETE:'선택한 사진의 은행 내역을 모두 읽어야 합산 대조할 수 있습니다. 실패하거나 진행 중인 사진을 확인하고 같은 선택으로 이어서 분석하세요.',ANALYSIS_NOT_CONFIGURED:'자동 분석 API가 아직 설정되지 않았습니다. 관리자에게 API 설정을 요청해 주세요.',API_NOT_CONFIGURED:'자동 분석 API가 아직 설정되지 않았습니다. 관리자에게 API 설정을 요청해 주세요.',ANALYSIS_TIMEOUT:'자동 분석 응답이 지연되었습니다. 상태를 새로고침한 뒤 다시 시도해 주세요.',ANALYSIS_RATE_LIMITED:'분석 요청이 잠시 몰렸습니다. 잠시 후 다시 시도해 주세요.',ANALYSIS_QUOTA_EXCEEDED:'AI 분석 크레딧이 부족하거나 사용 한도에 도달했습니다. OpenAI API 크레딧을 충전하거나 사용 한도를 확인한 뒤 다시 분석해 주세요.',ANALYSIS_INVALID_RESPONSE:'분석 결과를 확인하지 못했습니다. 원본을 확인한 뒤 다시 시도하거나 직접 입력해 주세요.',ANALYSIS_CONSULTATION_INVALID_RESPONSE:'입금 정보는 확인했지만 상담 분석 응답을 검증하지 못해 초안을 저장하지 못했습니다. 사진은 저장되어 있어 다시 올리지 않아도 됩니다.',ANALYSIS_FAILED:'자동 분석에 실패했습니다. 다시 시도하거나 입금건을 직접 입력해 주세요.',ANALYSIS_CONFLICT:'분석 중 검토 내용이 변경되었습니다. 최신 내용을 불러온 뒤 확인해 주세요.',UPLOAD_PROTECTED:'검토 승인 또는 예약에 반영된 캡처는 삭제하거나 다시 분석할 수 없습니다.',DELETE_CONFLICT:'다른 삭제 요청과 겹쳤습니다. 대기열을 새로고침해 캡처 상태를 확인해 주세요.',UPLOAD_IN_USE:'검토 승인 또는 예약에 반영된 캡처는 삭제하거나 다시 분석할 수 없습니다.',UPLOAD_DELETING:'이 캡처는 삭제 중입니다. 대기열을 새로고침해 주세요.',UPLOAD_DELETED:'이 캡처는 이미 삭제되었습니다. 대기열을 새로고침해 주세요.',DELETE_FAILED:'캡처를 삭제하지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요.'};
const actionError=(error,fallback)=>actionErrors[error?.code]||actionErrors[error]||(typeof error?.message==='string'?error.message:typeof error==='string'&&error?error:fallback);
function analysisMessage(upload,reviews=[]){
  if(upload.deletingAt)return '캡처 삭제가 완료되지 않았습니다. 삭제 다시 시도를 눌러 마무리해 주세요.';
  if(analysisExpired(upload))return '이전 분석의 응답 시간이 지났습니다. 자동 분석 재시도로 다시 확인해 주세요.';
  if(upload.analysisStatus==='running')return '은행 캡처와 저장된 문자·수집된 카카오 대화를 분석하고 있습니다. 잠시 후 상태를 새로고침해 주세요.';
  if(upload.analysisStatus==='failed')return actionError(upload.analysisError||upload.analysisErrorCode,'자동 분석에 실패했습니다. 기존 검토 초안을 확인하거나 다시 시도해 주세요.');
  if(upload.analysisStatus!=='succeeded')return '자동 분석을 누르면 입금자·금액과 저장된 문자·수집된 카카오 대화를 대조해 검토 초안을 만듭니다.';
  if(upload.analysisOutcome==='not_bank')return '은행 입금내역으로 확인되지 않았습니다. 올바른 캡처를 다시 올리거나 입금건을 직접 입력하세요.';
  if(upload.analysisOutcome==='no_deposits')return '입금 내역을 찾지 못했습니다. 캡처 범위를 확인하거나 입금건을 직접 입력하세요.';
  if(upload.analysisOutcome==='needs_review')return '입금 내역에 추가 확인이 필요합니다. 원본과 검토 내용을 직접 대조해 주세요.';
  return reviews.length||upload.reviewCount>0?'저장된 분석 결과입니다. 사진과 최신 상담을 새로 읽으려면 AI 다시 분석을 누르세요.':'자동 분석을 마쳤지만 검토 초안이 없습니다. 원본을 확인하고 입금건을 직접 입력하세요.';
}
export const canReviewPayments=(profile,ui={})=>profile?.active===true&&!profile.must_change_password&&['admin','counselor'].includes(profile.role)&&!ui.booking?.demo;
export function emptyPaymentDraft(){return {...Object.fromEntries(draftStrings.map(key=>[key,''])),...Object.fromEntries(draftNumbers.map(key=>[key,null]))};}
export function normalizePaymentDraft(value={}){
  const result=emptyPaymentDraft();
  for(const key of draftStrings)result[key]=text(value[key]);
  for(const key of draftNumbers)result[key]=Number.isSafeInteger(value[key])&&value[key]>=0?value[key]:null;
  if(!['스키','보드'].includes(result.sport))result.sport='';
  if(result.date&&!/^\d{4}-\d{2}-\d{2}$/.test(result.date))result.date='';
  if(result.startTime&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.startTime))result.startTime='';
  if(value.paymentComparison?.version===1&&['candidate','matched','unmatched'].includes(value.paymentComparison.status)&&Array.isArray(value.paymentComparison.candidates)){try{result.paymentComparison=JSON.parse(JSON.stringify(value.paymentComparison));}catch{}}
  return result;
}
function stateOf(ui){const u=ui.paymentReview??={};const defaults={selectedUploadId:'',detail:null,detailRequest:0,detailLoading:false,detailError:'',previewRequest:0,previewLoading:false,previewError:'',previewFailedUrl:'',previewAutoRetried:false,activeKey:'',edits:{},filter:'pending',offset:0,limit:30,error:'',notice:'',busy:false,uploading:false,files:[],candidates:[],candidateLoading:false,connectionCode:null,analyzingUploadId:'',selectedUploadIds:[],selectedUploads:{},batchUploadIds:[],batchResults:[],batchPhase:'',batchRequest:0};for(const [key,value] of Object.entries(defaults))if(u[key]===undefined)u[key]=value;return u;}
export function hasPaymentReviewInFlight(ui={}){const u=ui.paymentReview;return !!u&&(!!u.busy||!!u.uploading||!!u.handoffPending);}
export function suspendPaymentReview(root,ui={}){
  const u=ui.paymentReview;if(!u)return;
  const edit=activeEdit(u);if(edit&&captureForm(root?.querySelector?.('[data-pr-review-form]'),edit))invalidate(edit);
  // Drafts remain in this authenticated tab's memory; logout clears them.
  // Fence read responses from the old view without cancelling writes/uploads.
  for(const key of ['detailRequest','previewRequest','contextRequest','candidateRequest','comparisonRequest'])u[key]=(u[key]||0)+1;
  for(const key of ['detailLoading','previewLoading','candidateLoading','candidateContextLoading'])u[key]=false;
  u.comparisonLoading='';
  u.savedRecords=null;
  for(const [key,value] of Object.entries(u.sourceFreshness||{}))if(value?.status==='loading')delete u.sourceFreshness[key];
}
export function hasPaymentReviewWork(ui={}){const u=ui.paymentReview;return !!u&&(!!u.busy||!!u.uploading||Object.values(u.edits||{}).some(edit=>edit.dirty));}
export function clearPaymentReview(ui={}){
  const u=ui.paymentReview;if(!u)return;
  u.detailRequest=(u.detailRequest||0)+1;
  for(const file of u.files||[])if(file.preview)URL.revokeObjectURL(file.preview);
  u.connectionCode=null;u.files=[];u.edits={};u.detail=null;delete ui.paymentReview;delete ui.paymentReviewLinkStatus;
}
/** Adopt the commit receipt without replacing another open review or local draft. */
export function adoptPaymentReviewSave(ui,review){
  const u=ui?.paymentReview,status=paymentReviewSaveStatus(review);
  if(!u||typeof review?.id!=='string'||!Number.isSafeInteger(review.version)||review.version<1||!['approved','committed'].includes(review.status)||!status.saved)return false;
  const rows=list(u.detail?.reviews),index=rows.findIndex(row=>row.id===review.id),previous=index>=0?rows[index]:null;
  if(previous&&(previous.version>review.version||previous.version===review.version&&paymentReviewSaveStatus(previous).allocations.some(row=>!status.allocations.some(next=>(next.reservationId||null)===(row.reservationId||null)&&(next.lessonPassId||null)===(row.lessonPassId||null)&&next.amount===row.amount))))return false;
  const saved=JSON.parse(JSON.stringify(review));
  if(u.detail?.upload?.id===saved.uploadId){
    if(index>=0)rows[index]=saved;else rows.push(saved);
    u.detail.reviews=rows;u.detailRequest=(u.detailRequest||0)+1;u.detailLoading=false;u.detailError='';
    const serverRows=rows.filter(row=>row.id&&Number.isSafeInteger(row.version));
    const counts={reviewCount:serverRows.length,pendingReviewCount:serverRows.filter(row=>row.status==='draft').length,approvedReviewCount:serverRows.filter(row=>row.status==='approved').length,committedReviewCount:serverRows.filter(row=>row.status==='committed').length};
    const summary={...counts,reviewStatus:counts.pendingReviewCount?'draft':counts.approvedReviewCount?'approved':'committed',deletionProtected:true};
    const queue=ui.paymentReviewData,listed=list(queue?.uploads).find(upload=>upload.id===saved.uploadId),wasComplete=listed&&completedReviewUpload(listed);
    Object.assign(u.detail.upload,summary);
    if(u.selectedUploads?.[saved.uploadId])Object.assign(u.selectedUploads[saved.uploadId],summary);
    if(listed)Object.assign(listed,summary);
    // The commit receipt can move this upload out of a cached pending page even
    // when the following list refresh fails. Counts describe server reviews only.
    if(listed&&!wasComplete&&summary.reviewStatus==='committed'){
      if(Number.isSafeInteger(queue.pendingTotal))queue.pendingTotal=Math.max(0,queue.pendingTotal-1);
      if(Number.isSafeInteger(queue.completedTotal))queue.completedTotal++;
      if(queue.filter==='pending'){
        queue.uploads=queue.uploads.filter(upload=>upload.id!==saved.uploadId);
        if(Number.isSafeInteger(queue.total))queue.total=Math.max(0,queue.total-1);
      }
    }
  }
  u.edits??={};delete u.edits[saved.id];
  if(u.detail?.upload?.id===saved.uploadId)editOf(u,saved);
  if(u.approvedHandoff?.paymentReviewId===saved.id)delete u.approvedHandoff;
  u.notice=`${saved.payerName||'입금자'} · ${status.label} · ${status.detail}${status.complete?' · 입금 배분 완료':status.remainingAmount!==null?` · 미배분 ${won(status.remainingAmount)}`:''}`;
  return true;
}
function keyFor(review){return review.id||`new:${review.rowKey}`;}
function editOf(u,review){
  const key=keyFor(review),serverSnapshot=JSON.stringify([review.version,review.status,review.payerName,review.transactionDate,review.amount,review.remainingAmount,review.draft,review.evidenceRefs,review.externalEvidence,review.manualReason,review.evidence,review.allocations]);let edit=u.edits[key];
  const changed=!edit||edit.serverSnapshot!==serverSnapshot,hydrating=!edit||(!edit.dirty&&changed);
  if(changed&&u.approvedHandoff?.paymentReviewId===review.id)delete u.approvedHandoff;
  if(!edit||(!edit.dirty&&changed)){
    edit=u.edits[key]={uploadId:review.uploadId||u.detail?.upload?.id||u.selectedUploadId||'',id:review.id||null,rowKey:review.rowKey||'',version:review.version??null,payerName:text(review.payerName),transactionDate:text(review.transactionDate),...bankFields(review.transactionDate),amount:Number.isSafeInteger(review.amount)?review.amount:null,draft:normalizePaymentDraft(review.draft),evidenceRefs:list(review.evidenceRefs).map(row=>({sourceId:row.sourceId,messageId:row.messageId})),externalEvidence:list(review.externalEvidence).map(row=>({...row})),manualReason:text(review.manualReason),evidence:list(review.evidence).filter(row=>row&&['stored_message','external_capture'].includes(row.verification)&&typeof row.text==='string'),checks:{bank:false,customer:false,details:false},dirty:false,status:review.status||'draft',remainingAmount:Number.isSafeInteger(review.remainingAmount)?review.remainingAmount:review.amount,serverSnapshot};
  }
  else if(changed){
    // Keep local text and optimistic edit version, but server lifecycle/balance always wins.
    edit.serverSnapshot=serverSnapshot;edit.status=review.status||'draft';
    edit.remainingAmount=Number.isSafeInteger(review.remainingAmount)?review.remainingAmount:review.amount;
    edit.checks={bank:false,customer:false,details:false};
    if(review.status==='committed')edit.remoteCommitted=true;
  }
  edit.serverAllocatedAmount=Number.isSafeInteger(review.allocatedAmount)?review.allocatedAmount:Number.isSafeInteger(review.amount)&&Number.isSafeInteger(review.remainingAmount)?review.amount-review.remainingAmount:null;
  if(hydrating&&edit.draft.paymentComparison?.appliedProposal?.intakeVersion===1)edit.draft=hydratePaymentIntake(edit.draft);
  if(hydrating&&edit.status==='draft'){
    if(!edit.draft.customerName.trim()&&edit.payerName.trim()){edit.draft.customerName=edit.payerName.trim();edit.defaultedNames=true;}
    if(!edit.draft.teamName.trim()&&edit.draft.customerName.trim()){edit.draft.teamName=edit.draft.customerName.trim();edit.defaultedTeamName=edit.draft.teamName;edit.defaultedNames=true;}
    if(edit.defaultedNames)invalidate(edit);
  }
  return edit;
}
function activeEdit(u){return u.edits[u.activeKey]||null;}
const invalidate=edit=>{edit.dirty=true;edit.checks={bank:false,customer:false,details:false};};
function paymentReviewIssue(edit,{approve=false}={}){
  const issue=(message,field='',check='',action='')=>({message,field,check,action});
  if(!edit?.payerName?.trim())return issue('입금자명을 입력해 주세요.','payerName');
  if(!Number.isSafeInteger(edit.amount)||edit.amount<=0)return issue('입금액을 1원 이상의 정수로 입력해 주세요.','amount');
  if(edit.bankTimestampError)return issue(edit.bankTimestampError,!edit.bankDate||!validBankDate(edit.bankDate)?'bankDate':'bankTime');
  if(edit.numericInputError)return issue('금액·인원·횟수·나이를 입력 범위 안의 정수로 확인해 주세요.',edit.numericInputError);
  const bankError=bankInputError(edit.bankDate||'',edit.bankTime||'');if(bankError)return issue(bankError,!edit.bankDate||!validBankDate(edit.bankDate)?'bankDate':'bankTime');
  const intake=edit.draft?.paymentComparison?.appliedProposal?.intakeVersion===1,allocated=intake?paymentIntakeTotals(edit.draft).allocatedAmount:edit.draft?.allocatedAmount;
  if(intake){const problem=validatePaymentIntake(edit.draft,edit.remainingAmount??edit.amount,{allowIncomplete:!approve});if(problem)return issue(problem,'allocatedAmount');}
  if(allocated!==null&&(!Number.isSafeInteger(allocated)||allocated<0||allocated>edit.amount))return issue('이번 예약에 반영할 입금액은 실제 입금액 이내로 입력해 주세요.','allocatedAmount');
  if(Number.isSafeInteger(edit.remainingAmount)&&allocated!==null&&allocated>edit.remainingAmount)return issue('아직 배분하지 않은 잔액보다 큰 금액을 반영할 수 없습니다.','allocatedAmount');
  if(edit.passCountInvalid)return issue('수강권 횟수는 확인된 1~100회의 정수로 입력하거나 미확인이면 비워 주세요.','passTotalSessions');
  if(isUndatedPass(edit.draft)&&(edit.draft.date||edit.draft.startTime))return issue('날짜 미정 수강권은 강습일·시작 시간을 비워 주세요. 일정이 정해졌다면 등록 유형을 예약으로 선택하세요.',edit.draft.date?'date':'startTime');
  if(!approve)return null;
  if(allocated===null||allocated<=0)return issue('이번 예약에 반영할 입금액을 입력해 주세요.','allocatedAmount');
  return null;
}
export function paymentReviewValidation(edit,options={}){return paymentReviewIssue(edit,options)?.message||'';}
function cachedApprovedDraft(u,edit){const saved=u.approvedHandoff;return saved&&edit?.status==='approved'&&!edit.dirty&&!edit.receiptPolicyChanged&&!edit.notesPolicyChanged&&saved.paymentReviewId===edit.id&&saved.paymentReviewVersion===edit.version?saved:null;}

export function checkedPaymentImageUrl(value,{upload=false}={}){
  let url;try{url=new URL(value);}catch{throw Error('캡처 저장소 주소를 확인하지 못했습니다.');}
  const prefix=upload?`/storage/v1/object/upload/sign/${BUCKET}/`:`/storage/v1/object/sign/${BUCKET}/`;
  if(url.origin!==ORIGIN||url.protocol!=='https:'||url.username||url.password||url.hash||!url.pathname.startsWith(prefix)||url.pathname.length<=prefix.length||!url.searchParams.get('token')||/%2f|%5c|\.\./i.test(url.pathname))throw Error('허용되지 않은 캡처 저장소 주소입니다.');
  return url.href;
}
export async function uploadPaymentScreenshot(file,{requestId,onAction,upload=globalThis.fetch,crypto=globalThis.crypto,isCurrent=()=>true}={}){
  if(!file||!IMAGE_TYPES.has(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_IMAGE_BYTES)throw Error('PNG·JPG·WebP 캡처를 파일당 8 MB 이하로 선택해 주세요.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const kind=bytes.length>12&&bytes[0]===137&&String.fromCharCode(...bytes.slice(1,4))==='PNG'?'image/png':bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':'';
  if(kind!==file.type||bytes.length!==file.size)throw Error('캡처 파일의 형식이나 크기가 맞지 않습니다. 다시 저장한 이미지를 선택해 주세요.');
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(!isCurrent())return {discarded:true};
  const prepared=await onAction('upload-prepare',{name:file.name,mime:file.type,size:file.size,sha256,requestId});
  if(!isCurrent())return {discarded:true};
  if(!prepared?.upload?.id)throw Error('캡처 업로드 준비를 확인하지 못했습니다.');
  if(prepared.upload.status!=='ready'){
    const url=checkedPaymentImageUrl(prepared.uploadUrl,{upload:true});
    const response=await upload(url,{method:'PUT',headers:{'Content-Type':file.type},body:file,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
    if(!isCurrent())return {discarded:true};
    if(!response?.ok)throw Error('캡처 전송이 완료되지 않았습니다. 다시 업로드해 주세요.');
  }
  const completed=await onAction('upload-complete',{uploadId:prepared.upload.id});
  if(!isCurrent())return {discarded:true};
  if(completed?.upload?.id!==prepared.upload.id||completed.upload.status!=='ready')throw Error('캡처 저장 완료를 확인하지 못했습니다.');
  return completed;
}
function option(value,label,current){return `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;}
function field(name,label,value,{type='text',wide=false,step='',min='',max='',help='',placeholder='미확인',disabled:locked=false}={}){return `<label class="pr-field ${wide?'pr-wide':''}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value??'')}" placeholder="${esc(placeholder)}" ${step?`step="${step}"`:''} ${min!==''?`min="${min}"`:''} ${max!==''?`max="${max}"`:''} ${disabled(locked)}>${help?`<small>${help}</small>`:''}</label>`;}
function originalTime(row){
  const value=text(row.occurredAt);
  if(validBankDate(value))return `${value} · 시간 미확인`;
  if(/(?:Z|[+-]\d{2}:\d{2})$/.test(value)){const parts=bankFields(value);if(parts.bankDate)return `${parts.bankDate} ${parts.displayTime} (KST)`;}
  return row.observedTime?`화면 표시 ${text(row.observedTime)} · 전체 날짜·시간 미확인`:'전체 날짜·시간 미확인';
}
function evidenceRowsMarkup(rows,{external=false,evidenceOnly=false}={}){return renderPaymentConversation(rows,{external,evidenceOnly});}

function mergeConversationRows(...groups){
  const rows=[],positions=new Map();
  for(const row of groups.flat()){
    if(!row||typeof row!=='object')continue;
    const id=row.messageId||row.id,key=id?JSON.stringify([row.sourceId||row.sourceUrl||'',id]):null,index=key===null?undefined:positions.get(key);
    if(index===undefined){if(key!==null)positions.set(key,rows.length);rows.push({...row});continue;}
    const previous=rows[index],oldBody=text(previous.text),newBody=text(row.text);
    // The same immutable message can appear as a short evidence excerpt and a full page.
    // Preserve differing originals if neither contains the other.
    if(!oldBody.includes(newBody)&&!newBody.includes(oldBody)){rows.push({...row});continue;}
    rows[index]={...previous,...Object.fromEntries(Object.entries(row).filter(([,value])=>value!==null&&value!==undefined&&value!=='')),text:newBody.length>oldBody.length?newBody:oldBody};
  }
  return rows;
}
function evidenceMarkup(edit){
  if(!edit.evidence.length)return '<p class="pr-warning">연결된 상담 원문이 없습니다. 고객 정보를 직접 확인하고 확인 경로를 기록해 주세요.</p>';
  return `<p class="pr-comparison-note">저장된 분석에 연결된 인용 근거입니다. 상담 전체를 불러온 상태는 아닙니다.</p>${evidenceRowsMarkup(edit.evidence,{evidenceOnly:true})}`;
}
const registrationDefaults={kind:'single',designated:false,isReorder:false,preferredInstructorId:'',lessonPassId:'',seasonId:'',seasonTotal:null,sessionNumber:null,teamPhoneMode:'same',teamPhone:'',lessonCount:'',patchEnabled:false,patchFee:null,patchPaymentStatus:'',sessionNotes:'',paymentSource:'계좌이체',cashReceiptRequested:null,cashReceiptNumberMode:'team_phone',cashReceiptNumber:'',relationship:'',experienceCount:null,ability:'',preferredInstructor:'',parallelLongTurn:null,snowboardNoviceTurn:null,juniorPreparation:false,rentalPaymentStatus:'',rentalHours:null,rentalCustomAmount:false,lessonRatio:'',femalePreference:''};
const comparisonLabels={customerName:'고객명',phone:'연락처',teamName:'강습생·팀',sport:'종목',date:'강습일',dateMention:'대화에 나온 날짜 · 연도 확인',timeMention:'대화에 나온 시간 · 확정 확인',age:'강습생 나이',startTime:'시작 시간',studentCount:'인원',lessonMinutes:'강습시간',lessonFee:'강습료',rentalFee:'장비금액',company:'업체',notes:'상담 내용',schedule:'일정',count:'횟수',lessonCount:'강습 횟수',price:'금액',cashReceiptRequested:'현금영수증 요청',cashReceiptPhone:'현금영수증 번호',cashReceiptNumber:'현금영수증 번호',cashReceiptType:'현금영수증 유형',teamCount:'팀 수',inferredTeamCount:'팀 수 추정',groupReason:'팀 구분 근거',receiptRequested:'현금영수증 요청',receiptNumber:'현금영수증 번호',receiptType:'현금영수증 유형',paymentSource:'입금 계좌·명의 안내',studentAges:'강습생 나이',relationship:'강습생 관계',experience:'강습 경험',ability:'실력',preferredInstructor:'희망 강사',lessonRatio:'강습 비율',contactPhone:'상담 연락처',contactRole:'연락처 용도',breakMinutes:'중간 휴식',allocatedAmount:'이번 예약 반영 입금액',juniorPreparation:'주니어 준비',parallelLongTurn:'패럴렐 롱턴',snowboardNoviceTurn:'보드 기초 턴',experienceCount:'강습 경험 횟수',lessonPassCount:'수강권 횟수',seasonCount:'시즌 횟수',reservationKind:'등록 유형',scheduleStatus:'일정 상태',rentalHours:'장비 대여 시간',rentalPaymentStatus:'장비 결제 안내',pickup:'픽업',participants:'강습생',age:'나이'};
const readableFact=value=>Array.isArray(value)?value.map(readableFact).join(', '):value&&typeof value==='object'?Object.entries(value).map(([key,item])=>`${comparisonLabels[key]||key}: ${readableFact(item)}`).join(' · '):typeof value==='boolean'?(value?'예':'아니요'):String(value??'미확인');
const originalFor=(edit,messageId)=>edit.evidence.find(row=>(row.messageId||row.id)===messageId);
function visibleTypedFact(fact,edit){
  if(['preferredInstructor','experienceCount'].includes(fact?.field))return !!normalizePaymentTypedProposalFact(fact,{sourceText:originalFor(edit,fact.messageId)?.text});
  return !(fact?.field==='experience'&&/(?:기존\s*고객|시즌)/u.test(String(fact.value))&&!/(?:\d+\s*회|경험\s*(?:무|없))/u.test(String(fact.value)));
}
function coveredSessionConflict(fact,context,edit){
  if(fact.status!=='conflict'||!['date','startTime'].includes(fact.field)||!context?.team)return false;
  const team=list(registrationOf(edit.draft).reviewedTeams).find(row=>row.threadId===context.candidate.threadId&&row.teamIndex===context.teamIndex);
  return list(team?.fields).some(row=>row.field===fact.field&&row.value===fact.value&&row.status!=='conflict'&&text(row.quote).replace(/^[-•·]\s*/u,'').includes(text(fact.quote).replace(/^[-•·]\s*/u,'')));
}
function consultationMaterialMarkup(consultation,threadId,edit){
  const contacts=list(consultation.contacts).filter(row=>row.threadId===threadId),receipts=list(consultation.receipts).filter(row=>row.threadId===threadId),inferences=list(consultation.teamGroupingInference).filter(row=>row.threadId===threadId&&row.inferred===true),facts=list(consultation.facts).filter(row=>row.threadId===threadId&&visibleTypedFact(row,edit));
  return `${contacts.length?`<section class="pr-consultation-contacts"><h4>상담에 나온 연락처 · 직접 확인</h4>${contacts.map(contact=>`<article><strong>${esc(({primary:'주 연락처',additional:'추가 연락처'})[contact.label]||contact.label||'연락처 후보')}</strong><span>${esc(contact.phone||'번호 미확인')}</span>${phoneKey(contact.phone)&&phoneKey(contact.phone)===phoneKey(edit.draft.phone)?'<small class="pr-current-contact">현재 검토 연락처</small>':''}<blockquote>${esc(contact.quote||'연락처 용도를 원문에서 확인하세요.')}</blockquote><small>${esc(originalFor(edit,contact.messageId)?originalTime(originalFor(edit,contact.messageId)):'대화 전체 날짜·시간 미확인')}</small></article>`).join('')}<p>주 연락처와 추가 연락처의 용도를 확인해 고객 정보에 직접 반영하세요.</p></section>`:''}${receipts.length?`<section class="pr-receipt-material"><h4>현금영수증 확인 자료</h4><p>고객 확인 후 발급 요청과 번호를 직접 대조하세요.</p>${receipts.map(receipt=>`<dl><div><dt>발급 요청</dt><dd>${({yes:'요청함',no:'요청하지 않음',unknown:'요청 여부 미확인'})[receipt.requested]||'요청 여부 미확인'}</dd></div><div><dt>요청 번호</dt><dd>${esc(receipt.number||'미확인')}</dd></div><div><dt>발급 유형</dt><dd>${esc(receipt.type||'미확인')}</dd></div></dl><blockquote>${esc(receipt.quote||'근거 원문 확인 필요')}</blockquote><small>${esc(originalFor(edit,receipt.messageId)?originalTime(originalFor(edit,receipt.messageId)):'대화 전체 날짜·시간 미확인')}</small>`).join('')}</section>`:''}${facts.length?`<section class="pr-consultation-facts"><h4>상담에 명시된 내용</h4>${facts.map(fact=>`<div>${['dateMention','timeMention'].includes(fact.field)?'<span class="pr-flag danger" title="직접 확인 필요">❗</span>':fact.inferred?'<span class="pr-flag warn" title="검토 필요 · 유추값">⚠️</span>':''}<strong>${esc(comparisonLabels[fact.field]||fact.field)}</strong><span>${esc(readableFact(fact.value))}</span>${fact.quote?`<blockquote>${esc(fact.quote)}</blockquote>`:''}<small>${esc(originalFor(edit,fact.messageId)?originalTime(originalFor(edit,fact.messageId)):'대화 전체 날짜·시간 미확인')}</small></div>`).join('')}</section>`:''}${inferences.length?`<section class="pr-team-inference"><h4>팀 구분 추정 · 직접 확인 필요</h4>${inferences.map(group=>`<article><span class="pr-coverage-badge pr-coverage-needs_review">${esc(group.label||`${Number.isSafeInteger(group.teamCount)?group.teamCount:'미확인'}팀 추정`)}</span><p>${esc(group.reason||'팀 구분 근거를 원문과 직접 대조해 주세요.')}</p>${list(group.evidenceIds).map(id=>originalFor(edit,id)).filter(Boolean).map(row=>`<blockquote>${esc(row.text)}<small>${esc(originalTime(row))}</small></blockquote>`).join('')}</article>`).join('')}<p>팀 구분은 원문을 대조해 직접 확정하세요.</p></section>`:''}`;
}
function proposedFieldsMarkup(candidate,edit,{candidateIndex=0,teamIndex=-1,busy=false}={}){
  const context=proposalContext(edit,candidateIndex,teamIndex),fields=context?.fields||[];if(!fields.length)return '';
  const locked=busy||edit.status!=='draft',multiple=!context.team&&context.teams.length>1,canApply=fields.some(fact=>normalizedProposalFact(fact,edit,candidate));
  return `<section class="pr-proposed-fields"><h4>${context.team?'이 팀에 반영할 상담 제안':'상담 기반 검토 제안'} · 직접 확인</h4><p>분석한 팀·회차는 작성란에 함께 채웁니다. 아래는 반영 근거와 필요한 경우 사용할 개별 수정 도구입니다.</p>${fields.map((fact,index)=>{if(!visibleTypedFact(fact,edit)||coveredSessionConflict(fact,context,edit))return '';const valid=normalizedProposalFact(fact,edit,candidate);const flagIcon=fact.status==='conflict'?'<span class="pr-flag danger" title="직접 확인 필요">❗</span>':['dateMention','timeMention'].includes(fact.field)?'<span class="pr-flag danger" title="직접 확인 필요">❗</span>':fact.inferred||fact.status==='change_requested'?'<span class="pr-flag warn" title="검토 필요 · 유추값">⚠️</span>':'';return `<div>${flagIcon}<strong>${esc(comparisonLabels[fact.field]||fact.field)}${fact.inferred?' · 추정':fact.status==='change_requested'?' · 변경 요청':fact.status==='conflict'?' · 상충 확인 필요':''}</strong><span>${esc(proposalValueText(fact))}</span><details class="pr-fact-evidence"><summary>원문 근거 · ${esc(proposalSource(edit,candidate,fact.messageId)?originalTime(proposalSource(edit,candidate,fact.messageId)):'대화 전체 날짜·시간 미확인')}</summary><blockquote>${esc(fact.quote||fact.reason||'제안 근거를 원문에서 확인하세요.')}</blockquote>${fact.reason?`<small>${esc(fact.reason)}</small>`:''}</details>${valid?`<button type="button" class="btn ghost small" data-pr-apply-proposal="${candidateIndex}:${teamIndex}:${index}" ${disabled(locked)}>이 값 반영</button>`:''}</div>`;}).join('')}${multiple?'<p class="pr-warning">각 팀은 작성란에서 함께 확인하고 수정할 수 있습니다. 다른 상담 출처인 경우에만 출처를 선택하세요.</p>':`<button type="button" class="btn secondary small" ${context.team?`data-pr-apply-team="${candidateIndex}:${teamIndex}"`:`data-pr-apply-candidate="${candidateIndex}"`} ${disabled(locked||!canApply)}>${context.team&&edit.draft.paymentComparison?.refreshedForReview?'이 팀의 강습정보로 변경':'검토 양식에 반영'}</button>`}</section>`;
}
const proposalRegistrationFields=new Set(['reservationKind','scheduleStatus','lessonPassCount']);
const proposalLessonFields=new Set(['company','teamName','notes','experience','sport','date','startTime','lessonMinutes','breakMinutes','studentCount','lessonFee','rentalFee','rentalPaymentStatus','lessonRatio','participants',...Object.keys(registrationDefaults).filter(key=>key!=='paymentSource'),...proposalRegistrationFields]);
const registrationOf=draft=>draft.paymentComparison?.appliedProposal||{};
const isUndatedPass=draft=>registrationOf(draft).bookingType==='pass'&&registrationOf(draft).scheduleStatus==='undated';
function proposalSource(edit,candidate,messageId){
  if(!candidate||!messageId)return null;
  const expectedSources=new Set(candidate.sourceId?[candidate.sourceId]:list(candidate.evidenceRefs).filter(ref=>ref.messageId===messageId).map(ref=>ref.sourceId).filter(Boolean));
  const stored=list(edit.evidence).find(row=>row.verification==='stored_message'&&(row.messageId||row.id)===messageId&&expectedSources.has(row.sourceId));
  if(stored)return stored;
  // External captures are scoped by channel URL and immutable message ID too.
  const external=list(candidate.externalEvidence).find(row=>(row.messageId||row.id)===messageId&&row.sourceUrl);
  if(!external)return null;
  return list(edit.evidence).find(row=>row.verification==='external_capture'&&(row.messageId||row.id)===messageId&&row.sourceUrl===external.sourceUrl)||external;
}
function originalEpoch(value){return typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;}
function canonicalProposalParticipants(value){
  if(!Array.isArray(value)||!value.length||value.length>20)return null;
  if(value.some(row=>!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['type','age'].includes(key))||!['adult','minor',''].includes(row.type)||(row.type==='minor'?row.age!==null&&(!Number.isSafeInteger(row.age)||row.age<1||row.age>19):row.age!==null)))return null;
  return value.map(row=>({type:row.type,age:row.age}));
}
function normalizedProposalFact(fact,edit,candidate){
  if(!fact||!proposalLessonFields.has(fact.field))return null;
  const source=proposalSource(edit,candidate,fact.messageId),ownedCompany=fact.field==='company'&&(fact.sourceDerived===true||fact.provenance==='consultation_source')&&!!text(fact.reason).trim();
  if(!ownedCompany&&(!source||!text(fact.quote).trim()||!text(source.text).includes(fact.quote)))return null;
  if(fact.inferred===true&&!text(fact.reason).trim())return null;
  let value=fact.value;
  if(['lessonMinutes','breakMinutes','studentCount','lessonFee','rentalFee','lessonPassCount','experienceCount','rentalHours'].includes(fact.field)){
    if(typeof value==='string'&&/^\d+$/.test(value))value=Number(value);
    if(!Number.isSafeInteger(value)||value<0||value>1_000_000_000)return null;
    if(fact.field==='experienceCount'&&value>999||fact.field==='rentalHours'&&![4,6].includes(value)||fact.field==='lessonMinutes'&&![120,240].includes(value)||fact.field==='breakMinutes'&&![0,60,120].includes(value)||fact.field==='studentCount'&&(value<1||value>20)||fact.field==='lessonPassCount'&&(value<1||value>100))return null;
  }else if(fact.field==='participants'){value=canonicalProposalParticipants(value);if(!value)return null;}
  else if(['cashReceiptRequested','juniorPreparation','parallelLongTurn','snowboardNoviceTurn','rentalCustomAmount'].includes(fact.field)){if(typeof value!=='boolean')return null;}
  else{
    if(typeof value!=='string'||!value.trim()||value.length>(['notes','experience'].includes(fact.field)?3000:120))return null;value=value.trim();
    if(fact.field==='cashReceiptNumberMode'&&!['team_phone','manual'].includes(value)||fact.field==='cashReceiptNumber'&&!/^[0-9 -]{8,30}$/.test(value)||fact.field==='rentalPaymentStatus'&&!['free','paid','onsite_unpaid','unconfirmed'].includes(value)||fact.field==='lessonRatio'&&!/^\d{1,2}:\d{1,2}$/.test(value)||fact.field==='reservationKind'&&!['lesson','pass'].includes(value)||fact.field==='scheduleStatus'&&!['confirmed','undated'].includes(value)||fact.field==='company'&&!BOOKING_COMPANIES.includes(value)||fact.field==='sport'&&!['스키','보드'].includes(value)||fact.field==='date'&&!validBankDate(value)||fact.field==='startTime'&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
  }
  return normalizePaymentTypedProposalFact({...fact,value,occurredAt:source?.occurredAt||null},{sourceText:source?.text});
}
function invoiceSupplementFacts(edit,candidate,team,existing){
  const group=team?.groupingEvidence,source=proposalSource(edit,candidate,group?.messageId),quote=text(group?.quote);
  if(!source||!quote.trim()||!source.text.includes(quote)||!(team.priceBreakdown?.status==='calculated'||team.priceBreakdown?.allocationBasis?.status==='verified')||!list(team.priceBreakdown.evidence).some(row=>row.messageId===group.messageId&&text(row.quote).includes(quote)&&source.text.includes(row.quote)))return [];
  const facts=[],make=(field,value,quoted,original=source)=>({field,value,quote:quoted,messageId:original.messageId||original.id,status:'current',occurredAt:original.occurredAt||null,reason:'같은 상담의 검증된 결제 안내 원문에 명시된 항목입니다.'});
  const absent=field=>!existing.some(fact=>fact.field===field);
  if(absent('relationship')&&/(?:^|\s)가족(?:\s|$)/u.test(quote))facts.push(make('relationship','가족',quote));
  const counts=[...quote.matchAll(/\b([1-9][0-9]{0,2})\s*회/gu)].map(match=>Number(match[1]));
  if(absent('lessonCount')&&counts.length===1&&counts[0]===team.priceBreakdown.sessionsPerTeam)facts.push(make('lessonCount',String(counts[0]),quote));
  // Only the short invoice heading before the verified quote is considered.
  // Generic prices, resort costs, rental ads and later marketing are excluded.
  const index=source.text.indexOf(quote),header=index<=2000?source.text.slice(0,index):'',lines=header.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const sportValues=[...new Set(existing.filter(fact=>fact.field==='sport'&&['스키','보드'].includes(fact.value)).map(fact=>fact.value))];
  const levels=lines.filter(line=>/^(?:입문|초급|중급|상급)\s+(?:가족\s+)?(?:스키|보드)\s*강습$/u.test(line)&&sportValues.length===1&&line.includes(sportValues[0]));
  if(group.totalStudentCount===1)levels.push(...lines.filter(line=>line.length<=160&&/(?:어린이|강습생|학생|여아|남아|성인|\d{1,2}\s*세|학년)/u.test(line)&&!/[?？]|보호자|동반|또는|아니면|희망|목표|이상|이하/u.test(line)&&/(?:^|\s)(?:입문|초급|중급|상급)(?:\s|$)/u.test(line)));
  const levelValues=[...new Set(levels.flatMap(line=>[...line.matchAll(/입문|초급|중급|상급/gu)].map(match=>match[0])))];
  if(absent('ability')&&levelValues.length===1)facts.push(make('ability',levelValues[0],levels[0]));
  const rosters=lines.filter(line=>line.length<=160&&line.split(/\s*[,，]\s*/u).length===group.totalStudentCount&&line.split(/\s*[,，]\s*/u).every(token=>/^(?:엄마|아빠|성인|초\s*[1-6]|중\s*[1-3]|고\s*[1-3]|[1-9][0-9]?\s*세)$/u.test(token)));
  if(rosters.length===1)facts.push(make('notes',`참가자 원문 · ${rosters[0]}`,rosters[0]));
  const rental=lines.map(line=>line.match(/장비\s*렌탈[^\n.!?]{0,40}종일[^\n.!?]{0,40}무료[^\n.!?]{0,30}[.!?]?/u)?.[0]).filter(Boolean);
  if(rental.length===1)facts.push(make('notes',`장비 조건 원문 · ${rental[0]}`,rental[0]));
  // Preserve literal ages/grades from the same source's nearby participant form;
  // never turn grades into an invented exact age or fill another customer's row.
  const invoiceAt=originalEpoch(source.occurredAt),ageRows=[];
  for(const ref of list(candidate.evidenceRefs)){
    const original=proposalSource(edit,candidate,ref.messageId),at=originalEpoch(original?.occurredAt);
    if(!original||!Number.isFinite(invoiceAt)||!Number.isFinite(at)||Math.abs(at-invoiceAt)>86400000)continue;
    for(const line of original.text.split(/\r?\n/)){
      const match=/^\s*(?:\d+[.)]\s*)?강습생\s*(?:연령|나이)\s*[:;：]\s*(.{1,160})\s*$/u.exec(line);if(!match)continue;
      const tokens=match[1].trim().split(/\s*[,，]\s*/u);if(tokens.length!==group.totalStudentCount||!tokens.every(token=>/^(?:[1-9][0-9]?\s*세|초\s*[1-6]|중\s*[1-3]|고\s*[1-3])$/u.test(token)))continue;
      ageRows.push({line:line.trim(),value:match[1].trim(),original});
    }
  }
  if(new Set(ageRows.map(row=>row.value)).size===1){const row=ageRows[0];facts.push(make('notes',`강습생 연령 원문 · ${row.value}`,row.line,row.original));}
  return facts;
}
function resolvedScheduleContext(edit,candidate,team,teams,fields){
  if(!team||team.bookingType==='pass'||teams.length!==1)return null;
  const comparison=edit.draft.paymentComparison,coverage=list(comparison?.consultation?.coverage?.threads).find(row=>row.threadId===candidate.threadId);
  const originals=list(edit.evidence).filter(row=>row.verification==='stored_message'&&candidate.sourceId&&row.sourceId===candidate.sourceId&&(!row.phone||phoneKey(row.phone)===phoneKey(candidate.phone))).map(row=>({...row,threadId:candidate.threadId,messageId:row.messageId||row.id}));
  const unique=[...new Map(originals.map(row=>[row.messageId,row])).values()],fresh=edit.consultationSourceCoverage?.[candidate.threadId];
  const complete=candidateSourceComplete(comparison,candidate)&&(fresh?fresh.complete===true:Number.isSafeInteger(coverage?.suppliedMessages)&&coverage.suppliedMessages>0&&unique.length>=coverage.suppliedMessages);
  const sessionCount=team.priceBreakdown?.allocationBasis?.sessionCount??team.priceBreakdown?.sessionsPerTeam??team.totalSessions??list(team.sessions).length;
  if(!complete||sessionCount!==1)return null;
  const anchors=[];
  if(team.scheduleResolution?.anchor)anchors.push(team.scheduleResolution.anchor);
  if(list(team.sessions).length===1){const row=team.sessions[0],source=proposalSource(edit,candidate,row.messageId||list(row.evidenceIds)[0]);if(source)anchors.push({date:row.date,startTime:row.startTime,messageId:source.messageId||source.id,quote:row.quote||source.text});}
  const invoiceId=team.groupingEvidence?.messageId||list(team.priceBreakdown?.evidence)[0]?.messageId;
  const invoice=proposalSource(edit,candidate,invoiceId),dates=fields.filter(fact=>fact.field==='date'&&fact.messageId===invoiceId&&!['conflict','change_requested'].includes(fact.status)),times=fields.filter(fact=>fact.field==='startTime'&&fact.messageId===invoiceId&&!['conflict','change_requested'].includes(fact.status));
  if(invoice&&new Set(dates.map(row=>row.value)).size===1&&new Set(times.map(row=>row.value)).size===1)anchors.push({date:dates[0].value,startTime:times[0].value,messageId:invoiceId,quote:invoice.text});
  for(const anchor of anchors){
    const resolved=resolvePaymentSchedule({anchor,originals:unique,coverageComplete:true,threadId:candidate.threadId,teamCount:teams.length,sessionCount});
    if(!['resolved','blocked'].includes(resolved.status))continue;
    const proof=resolved.evidenceIds.map(id=>proposalSource(edit,candidate,id));
    if(proof.some(source=>!source||source.verification!=='stored_message'||source.sourceId!==candidate.sourceId))continue;
    const references=new Map(list(edit.evidenceRefs).map(ref=>[`${ref.sourceId}:${ref.messageId}`,ref]));
    for(const source of proof)references.set(`${source.sourceId}:${source.messageId||source.id}`,{sourceId:source.sourceId,messageId:source.messageId||source.id});
    if(references.size>30)continue;
    return resolved;
  }
  return null;
}
function proposalContext(edit,candidateIndex,teamIndex=-1){
  const comparison=edit.draft.paymentComparison,candidate=list(comparison?.candidates)[candidateIndex];if(!candidate)return null;
  const allTeams=list(comparison.consultation?.teams),team=teamIndex<0?null:allTeams[teamIndex];if(teamIndex>=0&&(!team||team.threadId!==candidate.threadId))return null;
  const teams=allTeams.filter(row=>row.threadId===candidate.threadId),own=team?(Array.isArray(team.proposedFields)?team.proposedFields:list(team.facts)):list(candidate.proposedFields);let fields=[...own];
  if(team)for(const fact of list(candidate.proposedFields))if((teams.length===1||fact.field==='company')&&!own.some(row=>row.field===fact.field))fields.push(fact);
  if(team)fields.push(...invoiceSupplementFacts(edit,candidate,team,fields));
  const normalized=fields.map(fact=>normalizedProposalFact(fact,edit,candidate)).filter(Boolean),sourceIds=[...new Set([...list(candidate.evidenceRefs).map(ref=>ref.messageId),...normalized.map(fact=>fact.messageId)])],sources=sourceIds.map(id=>proposalSource(edit,candidate,id)).filter(Boolean);
  const price=team?.priceBreakdown,invoiceEvidence=price?.status==='calculated'||price?.allocationBasis?.status==='verified'?price.evidence:[];
  const policies=derivePaymentProposalPolicyFacts({facts:normalized,sources,invoiceEvidence});
  if(policies.some(fact=>fact.field==='participants'))fields=fields.filter(fact=>fact.field!=='participants');
  fields.push(...policies);
  const scheduleResolution=resolvedScheduleContext(edit,candidate,team,teams,normalized);
  if(scheduleResolution){
    const replaced=new Set([...scheduleResolution.proposalFacts.map(fact=>fact.field),...list(scheduleResolution.blockedFields)]);
    fields=fields.filter(fact=>!replaced.has(fact.field));fields.push(...scheduleResolution.proposalFacts);
  }
  return {candidate,team,teams,teamIndex,candidateIndex,fields,scheduleResolution};
}
function settledProposalFacts(context,edit){
  const normalized=context.fields.map(fact=>normalizedProposalFact(fact,edit,context.candidate)).filter(Boolean),changes=list(edit.draft.paymentComparison?.consultation?.changes).filter(row=>row.threadId===context.candidate.threadId),grouped=new Map();
  for(const fact of normalized){if(!grouped.has(fact.field))grouped.set(fact.field,[]);grouped.get(fact.field).push(fact);}
  const result=[];
  for(const facts of grouped.values()){
    const preferred=list(context.scheduleResolution?.proposalFacts).find(proposal=>facts.some(fact=>fact.field===proposal.field&&fact.value===proposal.value&&fact.messageId===proposal.messageId&&fact.quote===proposal.quote));
    if(preferred){const fact=facts.find(fact=>fact.field===preferred.field&&fact.value===preferred.value&&fact.messageId===preferred.messageId&&fact.quote===preferred.quote);result.push(fact);continue;}
    if(facts[0]?.field==='notes'){const seen=new Set();for(const fact of facts)if(!['change_requested','conflict'].includes(fact.status)&&!seen.has(fact.value)){result.push(fact);seen.add(fact.value);}continue;}
    const values=new Set(facts.map(fact=>JSON.stringify(fact.value)));if(values.size>1)continue;
    const fact=[...facts].sort((a,b)=>(originalEpoch(b.occurredAt)||0)-(originalEpoch(a.occurredAt)||0))[0];
    if(['change_requested','conflict'].includes(fact.status))continue;
    const factTime=originalEpoch(fact.occurredAt);
    if(changes.some(change=>change.field===fact.field&&String(change.after??'')!==String(fact.value??'')&&(()=>{const at=originalEpoch(proposalSource(edit,context.candidate,change.messageId)?.occurredAt);return !Number.isFinite(at)||!Number.isFinite(factTime)||at>=factTime;})()))continue;
    result.push(fact);
  }
  return result;
}
function reviewedSourcePass(edit,context){
  const source=context.team?.sourcePass;
  if(source?.bookingType!=='pass'||source.requiresLinkReview!==true)return null;
  const evidenceIds=[...new Set(list(source.evidenceIds))].filter(id=>typeof id==='string'&&proposalSource(edit,context.candidate,id));
  if(!evidenceIds.length)return null;
  return {bookingType:'pass',totalSessions:Number.isSafeInteger(source.totalSessions)&&source.totalSessions>=1&&source.totalSessions<=100?source.totalSessions:null,requiresLinkReview:true,evidenceIds};
}
function applyProposalContext(edit,context,{onlyBlank=false,singleFact=null,replaceLesson=false}={}){
  if(!context)return {applied:0,skipped:0};
  const prior=edit.draft.paymentComparison?.appliedProposal,chosen=singleFact?[normalizedProposalFact(singleFact,edit,context.candidate)].filter(Boolean):settledProposalFacts(context,edit),applied=[],skipped=[],sameTeam=prior?.threadId===context.candidate.threadId&&prior?.teamIndex===context.teamIndex;
  if(!chosen.length)return {applied:0,skipped:0};
  let cleared=0;const clearedValues=[];
  if(prior&&!sameTeam)for(const previous of list(prior.fields)){
    if(previous.field==='participants'||proposalRegistrationFields.has(previous.field)||!proposalLessonFields.has(previous.field)||chosen.some(fact=>fact.field===previous.field))continue;
    if(JSON.stringify(edit.draft[previous.field])===JSON.stringify(previous.value)){clearedValues.push([previous.field,edit.draft[previous.field]]);edit.draft[previous.field]=draftNumbers.includes(previous.field)?null:'';cleared++;}
  }
  for(const fact of chosen){
    if(fact.field==='participants'||proposalRegistrationFields.has(fact.field))continue;
    if(fact.field==='experience'){applied.push(fact);continue;}
    if(fact.field==='notes'){const current=text(edit.draft.notes);if(!current.includes(fact.value)){const combined=[current,fact.value].filter(Boolean).join('\n');if(combined.length<=3000){edit.draft.notes=combined;applied.push(fact);}else skipped.push(fact.field);}continue;}
    const extra=Object.hasOwn(registrationDefaults,fact.field),current=extra?reviewRegistrationFields(edit)[fact.field]:edit.draft[fact.field],blank=extra&&!Object.hasOwn(prior?.registrationFields||{},fact.field)&&!list(prior?.fields).some(row=>row.field===fact.field)||current===null||current===undefined||current===''||fact.field==='teamName'&&current===edit.defaultedTeamName,previous=list(prior?.fields).find(row=>row.field===fact.field);
    if(onlyBlank&&!blank)continue;
    if(!blank&&JSON.stringify(current)!==JSON.stringify(fact.value)&&(onlyBlank||(!singleFact&&!replaceLesson&&JSON.stringify(previous?.value)!==JSON.stringify(current)))){skipped.push(fact.field);continue;}
    if(JSON.stringify(current)!==JSON.stringify(fact.value)||!previous||!sameTeam){edit.draft[fact.field]=fact.value;applied.push(fact);}
  }
  const participantFact=chosen.find(fact=>fact.field==='participants');let participants;
  if(participantFact){
    const current=prior?.participants;
    if(edit.draft.studentCount===null||edit.draft.studentCount===undefined){edit.draft.studentCount=participantFact.value.length;applied.push({...participantFact,field:'studentCount',value:participantFact.value.length,inferred:true,reason:'원문에서 구분된 참가자 수를 반영했습니다.'});}
    if(edit.draft.studentCount===participantFact.value.length&&(!onlyBlank||!current?.length)){participants=participantFact.value;applied.push(participantFact);}else skipped.push('participants');
  }
  const registrationFacts=chosen.filter(fact=>proposalRegistrationFields.has(fact.field)),registration=sameTeam||prior?.selectionSource==='staff'?{bookingType:prior?.bookingType,scheduleStatus:prior?.scheduleStatus,totalSessions:prior?.totalSessions,scheduleInference:prior?.scheduleInference}:{};
  for(const fact of registrationFacts){
    const key=({reservationKind:'bookingType',scheduleStatus:'scheduleStatus',lessonPassCount:'totalSessions'})[fact.field];
    if(prior?.selectionSource==='staff'&&!singleFact&&!replaceLesson){registration[key]=prior[key];skipped.push(fact.field);continue;}
    if(onlyBlank&&prior?.[key]!==undefined)continue;
    registration[key]=fact.value;applied.push(fact);
  }
  if(registration.bookingType==='pass'&&registration.scheduleStatus==='undated'){
    const inference=context.team?.scheduleInference||context.candidate.scheduleInference;if(inference)registration.scheduleInference=JSON.parse(JSON.stringify(inference));
  }
  if(!applied.length){for(const [field,value] of clearedValues)edit.draft[field]=value;return {applied:0,skipped:skipped.length};}
  if(context.team?.label&&(replaceLesson||!text(edit.draft.teamName).trim()||edit.draft.teamName===edit.defaultedTeamName||edit.draft.teamName===edit.proposalTeamLabel)){edit.draft.teamName=context.team.label;edit.proposalTeamLabel=context.team.label;}
  const kept=sameTeam?list(prior?.fields).filter(old=>!applied.some(row=>row.field===old.field)):[];
  edit.draft.paymentComparison.appliedProposal={threadId:context.candidate.threadId,teamIndex:context.teamIndex,fields:[...kept,...applied],requiresConfirmation:true,...(prior?.reviewedTeams?{reviewedTeams:prior.reviewedTeams,activeTeamId:prior.activeTeamId,intakeVersion:prior.intakeVersion}:{}),...(prior?.registrationFields?{registrationFields:sameTeam?prior.registrationFields:Object.fromEntries(Object.entries(prior.registrationFields).filter(([key])=>['paymentSource','cashReceiptRequested','cashReceiptNumberMode','cashReceiptNumber'].includes(key)))}:{}),...Object.fromEntries(Object.entries(registration).filter(([,value])=>value!==undefined)),...(prior?.selectionSource==='staff'?{selectionSource:'staff'}:{}),...(participants?{participants}:sameTeam&&prior?.participants&&prior.participants.length===edit.draft.studentCount?{participants:prior.participants}:{})};
  const savedProposal=edit.draft.paymentComparison.appliedProposal;
  const sourcePass=reviewedSourcePass(edit,context);if(sourcePass)savedProposal.sourcePass=sourcePass;
  edit.draft.notes=buildPaymentInstructorNotes(edit.draft,{includeFacts:true});
  for(const fact of applied)if(Object.hasOwn(registrationDefaults,fact.field)&&fact.field!=='paymentSource'){savedProposal.registrationFields??={};savedProposal.registrationFields[fact.field]=fact.value;}
  invalidate(edit);return {applied:applied.length,skipped:skipped.length,cleared};
}
const meaningfulProposal=fact=>proposalLessonFields.has(fact?.field)&&!['company','notes','experience','reservationKind','scheduleStatus'].includes(fact.field);
function proposalCandidateIndexes(comparison){
  return list(comparison?.candidates).map((candidate,index)=>({candidate,index})).filter(({candidate})=>list(candidate.proposedFields).some(meaningfulProposal)||list(comparison?.consultation?.teams).some(team=>team.threadId===candidate.threadId&&list(team.proposedFields||team.facts).some(meaningfulProposal))).map(row=>row.index);
}
function candidateSourceComplete(comparison,candidate){
  const coverage=comparison?.consultation?.coverage,thread=list(coverage?.threads).find(row=>row.threadId===candidate?.threadId);
  if(coverage?.complete===false)return paymentSummaryOnlyCoverageLimit(comparison,[candidate?.threadId]);
  if(thread)return thread.complete===true&&(!Number.isSafeInteger(thread.loadedMessages)||!Number.isSafeInteger(thread.suppliedMessages)||thread.loadedMessages===thread.suppliedMessages);
  return coverage?.complete===true;
}
function initializeActiveProposal(u,review,{bookingContext={},customerContext=null,afterSourceLoad=false}={}){
  const edit=activeEdit(u),comparison=edit?.draft.paymentComparison,a=comparison?.appliedProposal;
  // Rendering may have created an empty intake card before source loading ends.
  // That placeholder is not an applied analysis or a staff-authored team.
  const appliedSource=!!a&&(!!a.threadId||list(a.fields).length>0||list(a.reviewedTeams).some(team=>team.threadId||list(team.fields).length));
  const refreshOwnProposal=afterSourceLoad&&edit?.proposalAutoInitialized&&!edit.staffEdited;
  if(!edit||edit.staffEdited||!refreshOwnProposal&&edit.dirty&&!edit.defaultedNames||review?.status!=='draft'||!Number.isSafeInteger(review.analysisGeneratedVersion)||review.version!==review.analysisGeneratedVersion||review.approvedAt||review.approvedBy||text(review.manualReason).trim()||appliedSource&&!refreshOwnProposal||u.proposalDismissed?.[edit.id]===edit.version)return;
  if(comparison?.candidateSetComplete===false)return;
  const candidates=list(comparison?.candidates),eligible=candidates.length===1?[0]:proposalCandidateIndexes(comparison);
  if(eligible.length!==1)return;
  const candidateIndex=eligible[0],candidate=candidates[candidateIndex],coverage=comparison.consultation?.coverage;
  customerContext??=u.comparisonOriginals?.[candidate?.threadId]||null;
  if(coverage?.complete===false&&!candidateSourceComplete(comparison,candidate))return;
  if(comparison.candidateSetComplete!==true&&(coverage?.complete===false||Array.isArray(coverage)&&coverage.some(row=>row.complete===false)||comparison.truncated===true))return;
  // A name-only secondary source without lesson proposals does not suppress a
  // separately grounded invoice. Keep every source separate; do not merge peers.
  if(candidates.length>1&&(comparison.candidateSetComplete!==true||!candidateSourceComplete(comparison,candidate)||!candidate.sourceId||!phoneKey(candidate.phone)))return;
  const matching=list(comparison.consultation?.teams).map((team,index)=>({team,index})).filter(row=>row.team.threadId===candidate.threadId);
  const sourceFacts=[...list(candidate.proposedFields),...matching.flatMap(({team})=>[...list(team.facts),...list(team.proposedFields)])];
  if(sourceFacts.some(fact=>proposalLessonFields.has(fact?.field)&&fact.field!=='company'&&text(fact.quote).trim()&&!proposalSource(edit,candidate,fact.messageId)))return;
  if(matching.length>1){
    if(comparison.candidateSetComplete!==true||!candidateSourceComplete(comparison,candidate)||matching.length>6||matching.some(({team})=>team.bookingType==='pass'))return;
    // Auto-create all teams only for an explicit, source-verified team count.
    // Ambiguous candidates or several unrelated lessons still require selection.
    if(matching.some(({team,index})=>{const group=team.groupingEvidence,source=proposalSource(edit,candidate,group?.messageId);return group?.teamCount!==matching.length||!text(group.quote).trim()||!source?.text.includes(group.quote)||!settledProposalFacts(proposalContext(edit,candidateIndex,index),edit).some(meaningfulProposal);}))return;
    // Only the generated, still-empty lesson form may be initialized this way.
    if(!refreshOwnProposal&&['sport','date','startTime','lessonMinutes','studentCount','lessonFee','rentalFee','teamId'].some(key=>edit.draft[key]!==''&&edit.draft[key]!==null&&edit.draft[key]!==undefined))return;
    try{const result=applyPaymentCandidateTeams(edit,candidateIndex,{bookingContext,customerContext});edit.proposalAutoInitialized=true;edit.draft.paymentComparison.appliedProposal.selectionSource='analysis';for(const team of edit.draft.paymentComparison.appliedProposal.reviewedTeams)team.selectionSource='analysis';u.reviewError='';u.notice=`상담 원문에 근거한 ${result.teamCount}팀의 종목·일정·금액을 작성란에 채웠습니다. 팀 구성과 입금 배분액을 확인한 뒤 저장하세요.${result.notesOmitted?' 메모 길이 제한으로 일부 상담 메모는 원문에서 확인해야 합니다.':''}`;}catch(error){u.reviewError=text(error?.message)||'상담 팀 제안을 작성란에 반영하지 못했습니다.';}
    return;
  }
  if(matching.length!==1||list(comparison.consultation?.teamGroupingInference).some(row=>row.threadId===candidate.threadId&&row.teamCount>1))return;
  if(comparison.candidateSetComplete===true&&candidateSourceComplete(comparison,candidate)&&matching[0].team.priceBreakdown?.version===1){
    try{const result=applyPaymentCandidateTeams(edit,candidateIndex,{bookingContext,customerContext});edit.proposalAutoInitialized=true;edit.draft.paymentComparison.appliedProposal.selectionSource='analysis';for(const team of edit.draft.paymentComparison.appliedProposal.reviewedTeams)team.selectionSource='analysis';u.reviewError='';u.notice=`상담 원문의 팀·회차와 금액을 작성란에 채웠습니다. 자동 배분 초안과 운영 기준 제안은 담당자가 확인하세요.${result.notesOmitted?' 메모 한도로 일부 내용은 상담 원문에서 확인해야 합니다.':''}`;}catch(error){u.reviewError=text(error?.message)||'상담 회차 제안을 반영하지 못했습니다.';}
    return;
  }
  const result=applyProposalContext(edit,proposalContext(edit,candidateIndex,matching[0].index),{onlyBlank:true});if(result.applied){edit.proposalAutoInitialized=true;u.notice='상담 기반 초안을 빈 항목에 반영했습니다. 고객·일정·참가자 정보를 확인한 뒤 저장하고 대조해 주세요.';}
}
function proposalValueText(fact){
  if(fact.field==='reservationKind')return fact.value==='pass'?'날짜 미정 수강권':fact.value==='lesson'?'날짜가 정해진 예약':readableFact(fact.value);
  if(fact.field==='scheduleStatus')return fact.value==='undated'?'날짜 미정':fact.value==='confirmed'?'일정 확인':readableFact(fact.value);
  if(fact.field==='rentalPaymentStatus')return ({free:'장비 무료',paid:'결제 완료',onsite_unpaid:'현장 결제',unconfirmed:'미확인'})[fact.value]||readableFact(fact.value);
  if(fact.field==='participants'&&Array.isArray(fact.value))return fact.value.map(row=>row.type==='adult'?'성인':row.type==='minor'?`미성년 ${row.age===null?'나이 미확인':`${row.age}세`}`:'구분 미확인').join(' · ');
  return readableFact(fact.value);
}
const signedWon=value=>Number.isSafeInteger(value)?`${value<0?'−':value>0?'+':''}${Math.abs(value).toLocaleString('ko-KR')}원`:'차이 미확인';
function retrievalSignalsMarkup(candidate){
  const labels={payer_hint:'저장된 입금자 검색어로 조회',payer_text:'원문에 입금자명 포함',phone_in_customer_text:'고객이 대화에 적은 번호로 조회',amount_and_time:'은행 금액·대화 시각 근접',phone_from_saved_kakao:'저장된 카카오의 고객 연락처로 문자 조회'},signals=[...new Set(list(candidate.retrievalSignals))].filter(key=>labels[key]);
  return signals.length?`<div class="pr-retrieval-signals"><strong>후보를 찾은 근거</strong><p>${signals.map(key=>`<span class="pr-coverage-badge">${labels[key]}</span>`).join(' ')}</p><small>검색 단서입니다. 같은 고객인지와 실제 입금 관계는 원문·전화번호·입금 내역을 직접 대조하세요.</small></div>`:'';
}
function reviewedTeamSnapshot(edit,context){
  const draft=emptyPaymentDraft(),fields=settledProposalFacts(context,edit),registrationFields={};
  for(const fact of fields){if(fact.field==='notes'){if(!draft.notes.includes(fact.value))draft.notes=[draft.notes,fact.value].filter(Boolean).join('\n');}else if(draftStrings.includes(fact.field)||draftNumbers.includes(fact.field))draft[fact.field]=fact.value;else if(Object.hasOwn(registrationDefaults,fact.field))registrationFields[fact.field]=fact.value;}
  const count=context.teams.length,label=context.team?.label||draft.teamName||`${edit.draft.customerName||edit.payerName||'고객'} ${count>1?`${context.teamIndex+1}팀`:''}`.trim();
  draft.teamName=draft.teamName||label;draft.allocatedAmount=0;
  const sourcePass=reviewedSourcePass(edit,context);
  const snapshot={threadId:context.candidate.threadId,teamIndex:context.teamIndex,label,bookingType:context.team?.bookingType||'lesson',scheduleStatus:context.team?.scheduleStatus||'unknown',...(sourcePass?{sourcePass}:{}),draft,participants:fields.find(fact=>fact.field==='participants')?.value||[],registrationFields,fields:fields.map(fact=>({...fact}))};
  if(context.scheduleResolution)snapshot.scheduleResolution=context.scheduleResolution;
  const sessions=reviewedSourceSessions(edit,context,snapshot);if(sessions){snapshot.sessions=sessions.rows;snapshot.fields.push(...sessions.facts);Object.assign(draft,Object.fromEntries(['date','startTime','lessonMinutes','breakMinutes','lessonFee','rentalFee','allocatedAmount'].map(key=>[key,sessions.rows[0][key]])));}
  draft.notes=buildPaymentInstructorNotes(draft,{proposal:snapshot,comparison:edit.draft.paymentComparison,includeFacts:true});
  return snapshot;
}
function reviewedSourceSessions(edit,context,snapshot){
  const sourceRows=list(context.team?.sessions);if(sourceRows.length<2||snapshot.bookingType==='pass')return null;
  if(sourceRows.length>100)throw Error('원문 회차가 100회를 넘습니다. 팀·회차를 나누어 검토해 주세요.');
  const originalFacts=[...list(context.team?.facts),...list(context.team?.proposedFields)],facts=[],seen=new Set();
  const rows=sourceRows.map(originalRow=>{
    let row=originalRow;
    const originalSource=[row.messageId,...list(row.evidenceIds)].filter(Boolean).map(id=>proposalSource(edit,context.candidate,id)).find(source=>source&&text(row.quote).trim()&&source.text.includes(row.quote));
    const recovered=originalSource?recoverPaymentSourceSession(row,originalSource,{lessonMinutes:snapshot.draft.lessonMinutes}):null;if(recovered)row=recovered;
    const ids=[...new Set([row.messageId,...list(row.evidenceIds)].filter(Boolean))],find=(field,value)=>originalFacts.map(fact=>normalizedProposalFact(fact,edit,context.candidate)).find(fact=>fact&&fact.field===field&&fact.value===value&&ids.includes(fact.messageId)&&!['conflict','change_requested'].includes(fact.status));
    let date=find('date',row.date),time=find('startTime',row.startTime);
    if(recovered){date=normalizedProposalFact({field:'date',value:row.date,quote:row.quote,messageId:row.messageId,status:'current',inferred:row.inferred,reason:row.reason},edit,context.candidate);time=normalizedProposalFact({field:'startTime',value:row.startTime,quote:row.quote,messageId:row.messageId,status:'current'},edit,context.candidate);}
    const source=ids.map(id=>proposalSource(edit,context.candidate,id)).find(original=>original&&text(row.quote).trim()&&original.text.includes(row.quote));
    if(!date&&source&&validBankDate(row.date)){
      const year=Number(row.date.slice(0,4)),month=Number(row.date.slice(5,7)),day=Number(row.date.slice(8)),explicit=new RegExp(`${year}(?:[-./]0?${month}[-./]0?${day}|\\s*년\\s*0?${month}\\s*월\\s*0?${day}\\s*일)`).test(row.quote),partial=new RegExp(`(?:^|[^0-9])0?${month}(?:[./-]|\\s*월\\s*)0?${day}(?:일|[^0-9]|$)`).test(row.quote);
      if(explicit||row.yearConfirmed===false&&partial)date=normalizedProposalFact({field:'date',value:row.date,quote:row.quote,messageId:source.messageId||source.id,...(!explicit?{inferred:true,reason:`상담 시점에 따른 ${year}년 강습일 제안입니다. 예약 연도를 확인하세요.`}:{})},edit,context.candidate);
    }
    if(!time&&source&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)){
      const hour=Number(row.startTime.slice(0,2)),minute=Number(row.startTime.slice(3)),matches=new RegExp(`(?:^|[^0-9])0?${hour}(?::${String(minute).padStart(2,'0')}|\\s*시${minute?`\\s*${minute}\\s*분`:''}|${minute?'(?!)':'[-~–]'})`).test(row.quote);
      if(matches)time=normalizedProposalFact({field:'startTime',value:row.startTime,quote:row.quote,messageId:source.messageId||source.id},edit,context.candidate);
    }
    if(!date||!time)throw Error('회차별 날짜·시간의 원문을 확인하지 못했습니다. 상담 원문과 각 회차를 먼저 대조해 주세요.');
    const key=`${date.value}:${time.value}`;if(seen.has(key))throw Error('같은 팀의 날짜·시간이 겹치는 회차 제안입니다. 원문을 먼저 확인해 주세요.');seen.add(key);facts.push(date,time);
    return {id:globalThis.crypto.randomUUID(),date:date.value,startTime:time.value,lessonMinutes:recovered?.lessonMinutes??snapshot.draft.lessonMinutes,breakMinutes:recovered?.breakMinutes??snapshot.draft.breakMinutes,lessonFee:snapshot.draft.lessonFee,rentalFee:snapshot.draft.rentalFee,allocatedAmount:0,...Object.fromEntries(['rentalPaymentStatus','rentalHours','rentalCustomAmount'].filter(key=>Object.hasOwn(snapshot.registrationFields,key)).map(key=>[key,snapshot.registrationFields[key]]))};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));
  return {rows,facts};
}
/** Explicitly replace editable cards with one selected consultation's complete team proposal. */
export function applyPaymentCandidateTeams(edit,candidateIndex,{bookingContext={},customerContext=null}={}){
  if(edit?.status!=='draft'||!Number.isSafeInteger(candidateIndex))throw Error('작성할 상담 제안을 다시 확인해 주세요.');
  const comparison=edit.draft.paymentComparison,candidate=list(comparison?.candidates)[candidateIndex];
  const indexes=list(comparison?.consultation?.teams).map((team,index)=>({team,index})).filter(row=>row.team.threadId===candidate?.threadId);
  if(!candidate||!indexes.length||indexes.length>6)throw Error('작성할 팀 제안은 1~6팀이어야 합니다. 상담 원문을 다시 확인해 주세요.');
  if(indexes.length>1&&indexes.some(({team})=>team.bookingType==='pass'))throw Error('날짜 미정 수강권은 한 팀씩 검토해 주세요.');
  let fieldCount=0,skippedFields=0,notesOmitted=0;
  const snapshots=indexes.map(({team,index})=>{
    const context=proposalContext(edit,candidateIndex,index),facts=settledProposalFacts(context,edit);
    if(!facts.some(fact=>!['company','reservationKind','scheduleStatus'].includes(fact.field)))throw Error('이 팀의 문자·MMS 원문을 먼저 불러와 확인해 주세요. 원문이 검증되지 않은 값은 반영하지 않습니다.');
    fieldCount+=facts.length;skippedFields+=Math.max(0,context.fields.length-facts.length);
    const snapshot=reviewedTeamSnapshot(edit,context);snapshot.id=globalThis.crypto.randomUUID();snapshot.fields=snapshot.fields.filter((fact,index,all)=>all.findIndex(other=>other.field===fact.field&&other.messageId===fact.messageId&&JSON.stringify(other.value)===JSON.stringify(fact.value))===index);
    snapshot.requiresConfirmation=true;snapshot.selectionSource='staff';
    snapshot.bookingType=['lesson','pass'].includes(team.bookingType)?team.bookingType:'';
    snapshot.scheduleStatus=team.scheduleStatus||'unknown';
    snapshot.totalSessions=facts.find(fact=>fact.field==='lessonPassCount')?.value;
    snapshot.registrationFields=defaultPaymentSeasonRegistration(snapshot.registrationFields,{bookingType:snapshot.bookingType,sessions:snapshot.sessions||[snapshot.draft],facts:snapshot.fields});
    const staffNotes=buildPaymentInstructorNotes(edit.draft,{omitProposalFacts:true});if(staffNotes.length>3000)throw Error('직접 입력한 메모가 3,000자를 넘습니다. 메모를 확인해 주세요.');
    const proposedNotes=text(snapshot.draft.notes);snapshot.draft.notes=staffNotes;
    for(const line of proposedNotes.split('\n').filter(Boolean)){if(snapshot.draft.notes.includes(line))continue;const combined=[snapshot.draft.notes,line].filter(Boolean).join('\n');if(combined.length<=3000)snapshot.draft.notes=combined;else notesOmitted++;}
    return snapshot;
  });
  const old=edit.draft,registration=reviewRegistrationFields(edit),phone=phoneKey(candidate.phone),priorPhone=phoneKey(old.phone),phoneFilled=!priorPhone&&/^\d{6,15}$/.test(phone),phoneConflict=!!priorPhone&&!!phone&&priorPhone!==phone;
  const common={customerName:old.customerName||edit.payerName,phone:phoneFilled?phone:old.phone,customerId:phoneFilled?'':old.customerId,company:snapshots[0].draft.company||old.company};
  const commonKeys=['paymentSource',...(typeof registration.cashReceiptRequested==='boolean'&&!registration.cashReceiptDefaulted?['cashReceiptRequested','cashReceiptNumberMode','cashReceiptNumber']:[])];
  const commonFields=Object.fromEntries(commonKeys.filter(key=>registration[key]!==null&&registration[key]!==undefined&&registration[key]!=='').map(key=>[key,registration[key]]));
  for(const snapshot of snapshots){Object.assign(snapshot.draft,common,{teamId:'',allocatedAmount:0});snapshot.registrationFields={...snapshot.registrationFields,...commonFields};}
  const originals=edit.evidence.filter(row=>row.verification==='stored_message'&&candidate.sourceId&&row.sourceId===candidate.sourceId&&(!row.phone||phoneKey(row.phone)===phoneKey(candidate.phone))||row.verification==='external_capture'&&list(candidate.externalEvidence).some(ref=>ref.sourceUrl===row.sourceUrl));
  for(const snapshot of snapshots){
    const history=buildPaymentInstructorHistoryProposal({draft:{...snapshot.draft,customerId:old.customerId,teamId:snapshots.length===1?old.teamId:''},registrationFields:snapshot.registrationFields,candidate,originals,coverageComplete:candidateSourceComplete(comparison,candidate),customerContext,bookingContext,currentTeamCount:snapshots.length});
    if(history.status==='proposed'){Object.assign(snapshot.registrationFields,history.registrationFields);snapshot.instructorHistoryProposal={...history};}
  }
  const first=snapshots[0],next={...old,...first.draft,...common,paymentComparison:{...comparison,appliedProposal:{...first,registrationFields:first.registrationFields,participants:first.participants,reviewedTeams:snapshots,activeTeamId:first.id,intakeVersion:1,requiresConfirmation:true}}};
  let hydrated=hydratePaymentIntake(next);
  const allocation=buildPaymentAllocationProposal(hydrated,{depositAmount:edit.amount,remainingAmount:edit.remainingAmount??edit.amount});
  if(allocation.status==='ready')hydrated=applyPaymentAllocationProposal(hydrated,allocation);
  if(allocation.status==='ready'){
    const teams=registrationOf(hydrated).reviewedTeams;let rentalFilled=false;
    for(const team of teams){const price=comparison.consultation.teams[team.teamIndex]?.priceBreakdown;if(price?.rentalStatus!=='included_priced')continue;
      if(list(price.evidence).some(row=>/(?:장비|렌탈)[^\n.!?]{0,40}(?:현장\s*(?:결제|지불)|별도\s*(?:결제|입금|납부))/u.test(text(row.quote))))continue;
      for(const session of team.sessions)if(!session.rentalPaymentStatus&&Number.isSafeInteger(session.rentalFee)&&session.rentalFee>0&&session.allocatedAmount===session.lessonFee+session.rentalFee){session.rentalPaymentStatus='paid';rentalFilled=true;}
      if(team.sessions.every(session=>session.rentalPaymentStatus==='paid'))team.registrationFields.rentalPaymentStatus='paid';
    }
    if(rentalFilled)hydrated=hydratePaymentIntake(hydrated);
  }
  const problem=validatePaymentIntake(hydrated,edit.remainingAmount??edit.amount,{allowIncomplete:true});
  if(problem)throw Error(problem);
  const references=new Map(list(edit.evidenceRefs).map(ref=>[`${ref.sourceId}:${ref.messageId}`,ref]));
  for(const snapshot of snapshots)for(const id of [...list(snapshot.scheduleResolution?.evidenceIds),...snapshot.fields.filter(row=>row.draftPreferred).flatMap(fact=>list(fact.evidenceIds))]){
    const source=proposalSource(edit,candidate,id);if(source?.verification==='stored_message')references.set(`${source.sourceId}:${source.messageId||source.id}`,{sourceId:source.sourceId,messageId:source.messageId||source.id});
  }
  if(references.size>30)throw Error('최신 일정 변경의 원문 근거가 저장 한도를 넘습니다. 상담을 다시 분석해 주세요.');
  edit.evidenceRefs=[...references.values()];edit.draft=hydrated;invalidate(edit);return {teamCount:snapshots.length,fieldCount,skippedFields,notesOmitted,phoneFilled,phoneConflict,allocationStatus:allocation.status};
}
function allocationProposalMarkup(edit,busy){
  const applied=registrationOf(edit.draft);if(!applied.intakeVersion)return '';
  const proposal=buildPaymentAllocationProposal(edit.draft,{depositAmount:edit.amount,remainingAmount:edit.remainingAmount??edit.amount}),saved=applied.allocationProposal;
  if(saved?.needsStaffConfirmation)return `<section class="pr-warning" data-pr-allocation-proposal role="status"><strong>자동 배분 초안 · 담당자 확인 필요</strong>${saved.basis==='source_lesson_only_rental_unpaid'?`<p>강습료 ${won(saved.amount)} 입금 · 장비 ${won(saved.rentalUnpaidAmount)} 미결제 제안</p><p>${esc(saved.reason)}</p>`:`<p>원문 최종 견적 ${won(saved.quoteTotal)}을 기준으로 팀·회차에 ${won(saved.amount)}을 제안했습니다. 할인·단수 정리·회차별 금액과 현재 입력을 확인하고, 일반 예약 작성 화면에서 저장해야 확정됩니다.</p>`}</section>`;
  if(proposal.status==='unavailable')return `<section class="pr-field-note" data-pr-allocation-proposal><strong>입금 배분 확인 필요</strong><p>${esc(proposal.reason)}</p>${proposal.warnings.map(row=>`<p>${esc(row.message)}</p>`).join('')}</section>`;
  const protectedValues=proposal.warnings.some(row=>['EXISTING_ALLOCATION','MANUAL_FEE_CHANGED','INVALID_EXISTING_ALLOCATION'].includes(row.code));
  return `<section class="pr-warning" data-pr-allocation-proposal><strong>자동 배분 제안 · 담당자 확인 필요</strong><p>${esc(proposal.reason)}</p><p>원문 견적 ${won(proposal.quoteTotal)} · 배분 제안 ${won(proposal.proposedAmount)} · 남는 입금 ${won(proposal.unallocatedAmount)}</p>${proposal.warnings.map(row=>`<p>${esc(row.message)}</p>`).join('')}<button type="button" class="btn secondary small" data-pr-apply-allocation ${disabled(busy||protectedValues||edit.status!=='draft')}>팀·회차 배분 제안 반영</button></section>`;
}
function candidateTeamsAction(edit,candidate,index,teams,busy){
  if(!teams.length)return '';
  return `<section class="pr-latest-actions pr-build-teams"><p>선택한 상담의 ${teams.length}팀으로 현재 팀·회차 카드를 다시 만듭니다. 은행 내역은 유지하고 원문 견적에 맞는 팀·회차 입금 배분을 초안으로 제안하며 담당자가 확인합니다.</p><button type="button" class="btn primary small" data-pr-build-candidate-teams="${index}" ${disabled(busy||edit.status!=='draft'||teams.length>6)}>이 상담의 ${teams.length}팀으로 검토 내용 만들기</button></section>`;
}
function enrichInstructorHistory(edit,candidateIndex,{bookingContext={},customerContext=null}={}){
  if(edit.staffEdited||!edit.proposalAutoInitialized||!registrationOf(edit.draft).intakeVersion)return;
  const comparison=edit.draft.paymentComparison,candidate=list(comparison.candidates)[candidateIndex];if(!candidate)return;
  const draft=syncPaymentIntake(edit.draft),a=registrationOf(draft);let changed=false;
  for(const team of list(a.reviewedTeams).filter(row=>row.threadId===candidate.threadId)){
    const prior=team.instructorHistoryProposal,registration={...team.registrationFields},wasSuggested=prior?.status==='proposed'&&registration.preferredInstructorId===prior.registrationFields?.preferredInstructorId&&registration.preferredInstructor===prior.registrationFields?.preferredInstructor;
    if(wasSuggested){delete registration.preferredInstructorId;delete registration.preferredInstructor;delete registration.designated;}
    const history=buildPaymentInstructorHistoryProposal({draft:{...team.draft,customerId:draft.customerId,teamId:a.reviewedTeams.length===1?draft.teamId:''},registrationFields:registration,candidate,originals:edit.evidence,coverageComplete:candidateSourceComplete(comparison,candidate),customerContext,bookingContext,currentTeamCount:a.reviewedTeams.length});
    if(history.status==='proposed'){
      const next={...registration,...history.registrationFields};if(JSON.stringify(next)!==JSON.stringify(team.registrationFields)){team.registrationFields=next;changed=true;}
      team.instructorHistoryProposal={...history};const notes=buildPaymentInstructorNotes(team.draft,{proposal:{...team,instructorHistoryProposal:prior||history},comparison});if(team.draft.notes!==notes){team.draft.notes=notes;changed=true;}
    }else if(wasSuggested&&history.status==='blocked'){team.registrationFields=registration;team.draft.notes=team.draft.notes.split('\n').filter(line=>line!==`기존 강사 제안 · ${prior.reason}`).join('\n');team.instructorHistoryProposal={...history};changed=true;}
  }
  if(changed){edit.draft=hydratePaymentIntake(draft);invalidate(edit);edit.analysisAppliedBaseline=JSON.stringify(serializePaymentIntake(edit.draft));}
}
function includedTeam(edit,threadId,index){return list(registrationOf(edit.draft).reviewedTeams).some(team=>team.threadId===threadId&&team.teamIndex===index);}
function evidenceSourceId(edit,row){
  if(row.sourceId)return row.sourceId;
  const matches=[...new Set(list(edit.evidenceRefs).filter(ref=>ref.messageId===(row.messageId||row.id)).map(ref=>ref.sourceId).filter(Boolean))];
  return matches.length===1?matches[0]:'';
}
/** Original-view scopes are independent of whether AI produced a proposal. */
function originalSources(u,edit){
  const sources=list(edit?.draft.paymentComparison?.candidates).map(row=>({...row}));
  const key=row=>row?.sourceId&&phoneKey(row.phone)?`${row.sourceId}:${phoneKey(row.phone)}`:'';
  const add=source=>{
    if(!source?.sourceId||!phoneKey(source.phone))return;
    const identity=key(source),existing=sources.find(row=>key(row)===identity);
    const refs=list(edit?.evidence).filter(row=>row.verification==='stored_message'&&evidenceSourceId(edit,row)===source.sourceId&&phoneKey(row.phone)===phoneKey(source.phone)).map(row=>({sourceId:source.sourceId,messageId:row.messageId||row.id}));
    if(existing){existing.evidenceRefs=[...new Map([...list(existing.evidenceRefs),...refs].map(ref=>[JSON.stringify([ref.sourceId||existing.sourceId,ref.messageId]),ref])).values()];return;}
    sources.push({sourceId:source.sourceId,phone:phoneKey(source.phone),sourceLabel:source.sourceLabel||'문자 상담',threadId:`message-source:${identity}`,evidenceRefs:refs,originalOnly:true});
  };
  if(Number.isSafeInteger(u.selectedCandidate))add(list(u.candidates)[u.selectedCandidate]);
  for(const row of list(edit?.evidence))if(row.verification==='stored_message')add({...row,sourceId:evidenceSourceId(edit,row)});
  // 검토의 전화번호와 같은 번호로 찾은 후보는 신원 선택 없이도 원문 열람 대상이다.
  // 예약 변경·날짜 미정 수강권처럼 분석이 근거를 못 붙인 입금도 최근 대화를 바로 본다.
  const reviewPhone=phoneKey(edit?.draft.phone);
  if(reviewPhone)for(const row of list(u.candidates))if(phoneKey(row.phone)===reviewPhone)add(row);
  return sources;
}
function comparisonThreadRows(u,edit,candidate){
  const refs=list(candidate.evidenceRefs),originals=edit.evidence.filter(row=>refs.some(ref=>ref.messageId===(row.messageId||row.id)&&(!ref.sourceId||ref.sourceId===evidenceSourceId(edit,row)))),loaded=u.comparisonOriginals?.[candidate.threadId];
  return {loaded,conversation:mergeConversationRows(originals.filter(row=>row.verification!=='external_capture'),list(loaded?.messages)).map(row=>({...row,sourceId:row.sourceId||candidate.sourceId,sourceLabel:row.sourceLabel||candidate.sourceLabel,phone:row.phone||candidate.phone})),externalConversation:mergeConversationRows(originals.filter(row=>row.verification==='external_capture'),list(candidate.externalEvidence))};
}
function comparisonOriginalsMarkup(u,edit,busy){
  const candidates=originalSources(u,edit);
  if(!candidates.length)return evidenceMarkup(edit);
  const selected=Math.min(Math.max(Number(u.comparisonActiveIndex)||0,0),candidates.length-1),candidate=candidates[selected],{loaded,conversation,externalConversation}=comparisonThreadRows(u,edit,candidate),loading=u.comparisonLoading===candidate.threadId;
  return `${candidates.length>1?`<label class="pr-field pr-original-picker"><span>확인할 상담 번호·채널</span><select data-pr-original-candidate ${disabled(busy)}>${candidates.map((row,index)=>option(String(index),`${row.sourceLabel||'출처 미확인'} · ${row.phone||'연락처 미확인'}`,String(selected))).join('')}</select></label>`:''}<div class="pr-original-caption"><strong>${esc(candidate.sourceLabel||'상담 출처 미확인')}</strong><span>${esc(candidate.phone||'연락처 미확인')}</span></div><p class="pr-comparison-note">보낸 문자와 받은 문자를 원래 순서로 표시합니다. 말풍선의 날짜·시간을 입금 시각과 대조하세요.</p>${u.comparisonError?`<p class="pr-warning">${esc(u.comparisonError)}</p>`:''}${loading?'<p class="pr-original-loading" role="status">같은 번호의 저장된 상담 원문을 불러오는 중…</p>':''}${!loaded?'<p class="pr-comparison-note">현재는 인용 근거입니다. 전체 상담 조회를 마치기 전에는 전체 대화 건수가 아닙니다.</p>':''}${loaded?.validationIncomplete?'<p class="pr-warning">일부 원문의 출처를 확인하지 못했습니다. 확인된 원문만 표시하며 전체 상담을 다시 불러올 수 있습니다.</p>':''}${conversation.length?evidenceRowsMarkup(conversation,{evidenceOnly:!loaded}):externalConversation.length?'':'<p class="pr-missing">저장된 문자 원문을 확인하지 못했습니다. 후보 문구만으로 고객을 확정하지 마세요.</p>'}${evidenceRowsMarkup(externalConversation,{external:true})}${candidate.sourceId&&candidate.phone&&(!loaded||loaded.nextBefore||loaded.validationIncomplete)?`<button type="button" class="btn secondary small" data-pr-comparison-thread="${selected}" ${disabled(busy||loading)}>${loading?'원문 불러오는 중…':loaded?.nextBefore?'이전 상담 원문 더 보기':loaded?.validationIncomplete?'상담 원문 다시 불러오기':'같은 번호 상담 원문 불러오기'}</button>`:''}${loaded?`<p class="pr-comparison-note">저장된 문자 ${conversation.length}건 표시${loaded.nextBefore?' · 이전 이력 더 있음':''}</p>`:''}`;
}
function comparisonMoneyMarkup(candidate,busy){
  const visibleComparisons=[...new Map(list(candidate.comparisons).map(row=>[JSON.stringify([row.bankTotal,row.quotedTotal,row.difference,row.reason,list(row.bankRows).map(bank=>[bank.uploadId,bank.payerName,bank.amount,bank.transactionDate])]),row])).values()];
  return `<section class="pr-money-panel"><h4>입금·상담 금액 대조</h4><p class="pr-comparison-note">은행 입금이 어떤 강습료·장비요금을 포함하는지 확인합니다.</p>${candidate.coverageInference?`<div class="pr-coverage-inference"><span class="pr-coverage-badge pr-coverage-${esc(['lesson_only','lesson_and_rental','split_total'].includes(candidate.coverageInference.kind)?candidate.coverageInference.kind:'needs_review')}">${esc(candidate.coverageInference.label||'입금 범위 확인 필요')} · 추정</span><p>${esc(candidate.coverageInference.reason||'원문과 입금 금액을 대조해 확인하세요.')}</p></div>`:''}${visibleComparisons.map(row=>`<dl class="pr-comparison-money"><div><dt>은행 입금 합계</dt><dd>${won(row.bankTotal)}</dd></div><div><dt>상담 안내 금액</dt><dd>${won(row.quotedTotal)}</dd></div><div><dt>차이 확인</dt><dd>${signedWon(row.difference)}</dd></div><div class="pr-wide"><dt>대조 근거</dt><dd>${esc(row.reason||'입금건과 상담 금액을 직접 확인하세요.')}</dd></div>${list(row.bankRows).length?`<div class="pr-wide pr-comparison-bank-rows"><dt>합계에 포함된 은행 입금건</dt><dd>${row.bankRows.map(bank=>`<article><strong>${esc(bank.payerName||'입금자 미확인')} · ${won(bank.amount)}</strong><span>${esc(bankSummary({transactionDate:bank.transactionDate}))}</span>${bank.uploadId?`<button type="button" class="btn ghost small" data-pr-comparison-upload="${esc(bank.uploadId)}" ${disabled(busy)}>해당 캡처 확인</button>`:''}</article>`).join('')}</dd></div>`:''}</dl>`).join('')}${list(candidate.moneyFacts).length?`<details class="pr-money-facts"><summary>금액 근거 문구 ${candidate.moneyFacts.length}개</summary>${list(candidate.moneyFacts).map(fact=>`<p><b>${won(fact.amount)}</b> <span class="pr-money-fact-label">${({total:'안내 합계',component:'항목 금액',deposit:'예약금 문구',paid:'입금 언급',balance:'잔액 안내',refund:'환불 안내',unknown:'금액 문구'})[fact.role]||'금액 문구'}${fact.componentType?` · ${({lesson:'강습',rental:'장비',other:'기타'})[fact.componentType]||'항목 미확인'}`:''}${['onsite','waived','cancelled'].includes(fact.settlement)?` · ${({onsite:'현장 결제 안내',waived:'면제 안내',cancelled:'취소 안내'})[fact.settlement]}`:''}</span><q>${esc(fact.quote)}</q>${fact.contextQuote?`<small>앞뒤 원문: “${esc(fact.contextQuote)}”</small>`:''}</p>`).join('')}</details>`:''}</section>`;
}
function paymentComparisonMarkup(u,edit,busy){
  const comparison=edit.draft.paymentComparison;if(!comparison)return '<p class="pr-missing">상담 후보를 선택하면 팀·강습 내용과 금액 대조를 나란히 확인할 수 있습니다.</p>';
  const consultation=comparison.consultation||{},teams=list(consultation.teams),changes=list(consultation.changes);
  return `<section class="pr-payment-comparison"><p class="pr-comparison-note">${comparison.status==='matched'?'연결된 상담 근거를 직접 확인하세요.':comparison.status==='candidate'?'상담 후보입니다. 고객·연락처가 확정된 것은 아닙니다.':'조회한 문자·수집된 카카오 대화에서 비교 후보를 찾지 못했습니다.'}</p>${list(comparison.warnings).map(warning=>`<p class="pr-warning">${esc(warning)}</p>`).join('')}${list(comparison.analysisNotes).length?`<details class="pr-analysis-notices"><summary>분석·대조 안내</summary>${list(comparison.analysisNotes).map(note=>`<p class="pr-comparison-note">${esc(note)}</p>`).join('')}</details>`:''}${list(comparison.candidates).map((candidate,index)=>{
    const candidateTeams=teams.filter(row=>row.threadId===candidate.threadId),candidateChanges=changes.filter(row=>row.threadId===candidate.threadId).sort((a,b)=>(originalEpoch(proposalSource(edit,candidate,b.messageId)?.occurredAt)||0)-(originalEpoch(proposalSource(edit,candidate,a.messageId)?.occurredAt)||0));
    return `<article class="pr-comparison-candidate"><header><strong>${esc(candidate.sourceLabel||'상담 출처 미확인')}</strong><span>${esc(candidate.phone||'연락처 미확인')} · 상담 후보</span></header><div class="pr-team-money-grid"><section class="pr-lesson-panel"><h4>팀·강습 정보 · 예약에 넣을 내용</h4><p class="pr-comparison-note">팀별 인원·종목·일정·장비 조건을 확인한 뒤 오른쪽 검토 양식에 반영합니다.</p>${renderPaymentPriceBreakdown(comparison,edit.amount,{threadId:candidate.threadId})}${candidateTeamsAction(edit,candidate,index,candidateTeams,busy)}${candidateTeams.length?`<div class="pr-consultation-teams">${candidateTeams.map(team=>`<article><b>${esc(team.label||'팀 미확인')} · ${team.bookingType==='pass'?'수강권':team.bookingType==='lesson'?'일반 강습':'유형 미확인'}</b><span>${({confirmed:'상담상 일정 확인',undated:'날짜 미정',change_requested:'일정 변경 요청',unknown:'일정 미확인'})[team.scheduleStatus]||'일정 미확인'}</span><label class="pr-include-team"><input type="checkbox" data-pr-include-team="${index}:${teams.indexOf(team)}" ${includedTeam(edit,candidate.threadId,teams.indexOf(team))?'checked':''} ${disabled(busy||edit.status!=='draft')}> 함께 작성할 팀에 포함</label>${team.groupingEvidence?`<p class="pr-team-composition">${Number.isSafeInteger(team.groupingEvidence.studentCountPerTeam)?`팀당 ${team.groupingEvidence.studentCountPerTeam}명`:'팀당 인원 확인'} · ${Number.isSafeInteger(team.groupingEvidence.teamCount)?`${team.groupingEvidence.teamCount}팀`:'팀 수 확인'}${Number.isSafeInteger(team.groupingEvidence.totalStudentCount)?` · 총 ${team.groupingEvidence.totalStudentCount}명`:''}</p>`:''}${proposedFieldsMarkup(candidate,edit,{candidateIndex:index,teamIndex:teams.indexOf(team),busy})}</article>`).join('')}</div>`:proposedFieldsMarkup(candidate,edit,{candidateIndex:index,busy})}${candidateChanges.length?`<details class="pr-consultation-changes" open><summary>최근 상담 변경 ${candidateChanges.length}건</summary>${candidateChanges.map(change=>`<p><b>${change.status==='confirmed'?'변경 확인':'변경 요청'}</b> · ${esc(comparisonLabels[change.field]||change.field)}: ${esc(change.before??'이전 내용 미확인')} → ${esc(change.after??'변경 내용 미확인')}${change.quote?`<small>“${esc(change.quote)}”</small>`:''}</p>`).join('')}</details>`:''}</section>${comparisonMoneyMarkup(candidate,busy)}</div><details class="pr-additional-material"><summary>연락처·현금영수증·추가 상담 근거</summary>${retrievalSignalsMarkup(candidate)}<p class="pr-comparison-note">${esc(candidate.reason||'입금 내역과 상담 원문을 직접 대조해 주세요.')}</p>${consultationMaterialMarkup(consultation,candidate.threadId,edit)}</details></article>`;
  }).join('')}${(consultation.coverage?.complete===false||(Array.isArray(consultation.coverage)&&consultation.coverage.some(row=>row.complete===false)))?'<p class="pr-warning">일부 상담 이력을 모두 확인하지 못했습니다. 최근 변경이나 추가 입금이 있는지 원문을 확인하세요.</p>':''}</section>`;
}
function matchedContextMarkup(u,edit,busy){
  if(u.candidateContextLoading)return '<p class="pr-missing" role="status">같은 전화번호의 고객·팀·예약을 확인하고 있습니다.</p>';
  const context=u.candidateContext;if(!context)return '';
  if(context.phone&&phoneKey(context.phone)!==phoneKey(edit.draft.phone))return '<p class="pr-warning">전화번호가 바뀌었습니다. 상담 후보를 다시 찾아 고객·팀을 확인해 주세요.</p>';
  const customers=list(context.customers),teams=list(context.teams).filter(team=>team.customerId===edit.draft.customerId),reservations=list(context.reservations);
  return `<section class="pr-matched-context"><h4>같은 번호의 고객·팀 확인</h4>${customers.length?`<label class="pr-field"><span>기존 고객 · 직접 선택</span><select data-pr-match-customer ${disabled(busy)}>${option('','연결하지 않고 직접 입력',edit.draft.customerId)}${customers.map(customer=>option(customer.id,customer.name||'고객명 미확인',edit.draft.customerId)).join('')}</select></label>${customers.length>1?'<p class="pr-missing">같은 번호의 고객이 여러 명입니다. 입금자와 강습생을 대조해 선택하세요.</p>':''}${edit.draft.customerId?`<label class="pr-field"><span>기존 강습생 팀 · 직접 선택</span><select data-pr-match-team ${disabled(busy)}>${option('','기존 팀 연결하지 않음',edit.draft.teamId)}${teams.map(team=>option(team.id,`${team.name||'기본 팀'}${team.phone?` · ${team.phone}`:''}`,edit.draft.teamId)).join('')}</select></label>`:''}`:'<p class="pr-missing">같은 번호로 등록된 고객이 없습니다. 오른쪽에서 새 고객 정보를 확인해 주세요.</p>'}${reservations.length?`<div class="pr-matched-history"><strong>같은 번호의 기존 예약 · 최근 ${reservations.length}건</strong>${reservations.map(row=>`<article><b>${esc(row.customerName||'고객 미확인')} · ${esc(row.teamName||'기본 팀')}</b><span>${esc(row.date||'날짜 미확인')} ${esc(row.startTime||'시간 미확인')} · ${esc(row.sport||'종목 미확인')}</span><small>${esc(row.company||'업체 미확인')} · ${esc(row.instructorName||'강사 미배정')}</small></article>`).join('')}</div>`:''}</section>`;
}
function candidateMarkup(u,edit,busy){
  return `<div class="pr-section-title"><span>전화번호·상담 후보 찾기</span><button type="button" class="btn secondary small" data-pr-find ${disabled(busy||u.candidateLoading)}>${u.candidateLoading?'찾는 중…':'입금자·금액으로 찾기'}</button></div>${u.candidateSearched&&!u.candidates.length?'<p class="pr-missing">일치하는 원문을 찾지 못했습니다. 아래에서 직접 확인한 내용을 입력해 주세요.</p>':''}<div class="pr-candidates">${u.candidates.map((candidate,index)=>`<label class="pr-candidate"><input type="radio" name="paymentCandidate" data-pr-candidate="${index}" ${u.selectedCandidate===index?'checked':''} ${disabled(busy)}><span><strong>${esc(candidate.phone||'번호 미확인')} · ${esc(candidate.sourceLabel||'업체 미확인')}</strong><small>${candidate.nameMatched?'입금자 이름 포함':''}${candidate.nameMatched&&candidate.amountMatched?' · ':''}${candidate.amountMatched?'입금액 포함':''}</small>${candidate.customerName||candidate.teamName?`<small>${esc(candidate.customerName||'고객 미확인')} · ${esc(candidate.teamName||'팀 미확인')}</small>`:''}${list(candidate.reservations).map(row=>`<small>${esc(row.customerName||'')} ${esc(row.teamName||'')} · ${esc(row.date||'날짜 미확인')} ${esc(row.startTime||'시간 미확인')} ${esc(row.instructorName||'강사 미배정')}</small>`).join('')}</span></label>`).join('')}</div>${matchedContextMarkup(u,edit,busy)}`;
}
function savedBadgeMarkup(status){
  if(!status?.label)return '';
  return `<span class="pr-save-badge ${status.complete?'is-complete':'is-partial'}" data-pr-save-state="${status.complete?'complete':'partial'}">${esc(status.label)}${status.detail?` · ${esc(status.detail)}`:''}</span>`;
}
function reviewSaveBadge(review){return savedBadgeMarkup(paymentReviewSaveStatus(review));}
function savedReviewName(review,label,busy=false){return paymentReviewSaveStatus(review).saved?`<button type="button" class="pr-saved-name" data-pr-open-saved-review="${esc(review.id)}" ${disabled(busy)}>${esc(label)}</button>`:esc(label);}
function committedReviewMarkup(u,edit,bookingContext={}){
  const review=list(u.detail?.reviews).find(row=>row.id===edit.id),status=paymentReviewSaveStatus(review);
  if(!status.saved)return '';
  const reservations=list(bookingContext.paymentReservations||bookingContext.reservations);
  const records=status.allocations.map(allocation=>{
    if(allocation.lessonPassId)return `<li><button type="button" class="pr-saved-name" data-pr-open-saved-record="${esc(allocation.lessonPassId)}" data-pr-saved-kind="pass" data-pr-saved-review="${esc(review.id)}">수강권 저장 완료</button> · ${won(allocation.amount)}</li>`;
    const reservation=reservations.find(row=>row.id===allocation.reservationId);
    if(!reservation)return `<li data-pr-saved-reservation="${esc(allocation.reservationId)}"><button type="button" class="pr-saved-name" data-pr-open-saved-record="${esc(allocation.reservationId)}" data-pr-saved-kind="reservation" data-pr-saved-review="${esc(review.id)}">예약 저장 완료</button> · ${won(allocation.amount)} · 예약 세부 내역 미확인</li>`;
    const raw=reservation.raw||reservation.raw_data||{},team=reservation.teamName||reservation.team_name||raw.I||'팀 미확인',date=reservation.date||raw.A||'날짜 미확인',start=reservation.startTime||reservation.start_time||raw.B||'시간 미확인',end=reservation.endTime||reservation.end_time||raw.C||'',state=text(reservation.status).trim().toLowerCase();
    const removed=state==='deleted'||reservation.deletedAt||reservation.deleted_at,cancelled=['cancelled','canceled'].includes(state)||reservation.cancelledAt||reservation.cancelled_at;
    const lifecycle=removed?'삭제됨 · 저장·입금 배분 이력 유지':state==='refunded'?'환불됨 · 저장·입금 배분 이력 유지':cancelled?'취소됨 · 저장·입금 배분 이력 유지':'예약 저장 완료';
    return `<li data-pr-saved-reservation="${esc(allocation.reservationId)}"><strong><button type="button" class="pr-saved-name" data-pr-open-saved-record="${esc(allocation.reservationId)}" data-pr-saved-kind="reservation" data-pr-saved-review="${esc(review.id)}">${esc(team)}</button></strong> · ${esc(date)} ${esc(start)}${end?`–${esc(end)}`:''} · ${won(allocation.amount)} · <b>${esc(lifecycle)}</b></li>`;
  }).join('');
  return `<section class="pr-notice pr-save-summary" data-pr-saved-records role="status"><strong>${esc(status.label)} · ${esc(status.detail)}</strong><p>${status.complete?'서버에 저장하고 이 입금의 배분을 완료했습니다.':`아래 내역은 서버에 저장됐습니다. ${status.remainingAmount!==null?`아직 배분하지 않은 입금액 ${won(status.remainingAmount)}.`:'나머지 입금 배분 상태를 확인해 주세요.'}`}</p><ul>${records}</ul></section>`;
}

function reviewRegistrationFields(edit){
  const applied=registrationOf(edit.draft),fields={...registrationDefaults,...(applied.registrationFields||{})};
  const comparison=edit.draft.paymentComparison,candidate=list(comparison?.candidates).find(row=>row.threadId===applied.threadId);
  const verified=list(applied.fields).map(fact=>normalizedProposalFact(fact,edit,candidate)).filter(Boolean);
  for(const valid of verified)if(Object.hasOwn(registrationDefaults,valid.field)&&valid.field!=='paymentSource'&&!Object.hasOwn(applied.registrationFields||{},valid.field))fields[valid.field]=valid.value;
  if(applied.registrationFields?.rentalCustomAmount===undefined)fields.rentalCustomAmount=fields.rentalPaymentStatus!=='free'&&Number.isSafeInteger(edit.draft.rentalFee);
  if(edit.status==='committed')return fields;
  const consultation=comparison?.consultation,teams=list(consultation?.teams).filter(row=>row.threadId===candidate?.threadId),activeTeam=list(consultation?.teams)[applied.teamIndex];
  const threadFacts=[...list(applied.fields),...list(candidate?.proposedFields),...list(consultation?.facts).filter(row=>row.threadId===candidate?.threadId),...teams.flatMap(row=>[...list(row.facts),...list(row.proposedFields)])];
  const receipts=[...list(consultation?.receipts).filter(row=>row.threadId===candidate?.threadId),...threadFacts.filter(row=>/^(?:cashReceipt|receipt)/u.test(row?.field||''))];
  const sources=candidate?list(edit.evidence).filter(row=>row.verification==='stored_message'&&candidate.sourceId&&row.sourceId===candidate.sourceId&&(!row.phone||phoneKey(row.phone)===phoneKey(candidate.phone))||row.verification==='external_capture'&&list(candidate.externalEvidence).some(ref=>ref.sourceUrl===row.sourceUrl)):list(edit.evidence);
  const proposed=[...list(candidate?.proposedFields),...(activeTeam?.threadId===candidate?.threadId?[...list(activeTeam?.facts),...list(activeTeam?.proposedFields)]:[])].map(fact=>normalizedProposalFact(fact,edit,candidate)).filter(Boolean);
  return defaultPaymentCashReceipt(fields,{facts:[...verified,...proposed],sources:[...sources,...list(candidate?.externalEvidence)],receipts});
}
function formMarkup(u,edit,busy,bookingContext={}){
  const serverReview=list(u.detail?.reviews).find(row=>row.id===edit.id);
  const progress=serverReview&&(list(serverReview.allocations).length||Number(serverReview.allocatedAmount)>0)?reconcilePaymentReviewProgress(serverReview,bookingContext):{kind:'none'};
  edit.paymentProgress=progress;
  const partial=progress.kind!=='none'&&edit.status!=='committed',progressBlocked=partial&&progress.kind!=='partial';
  // A partially committed review is immutable. Render a separate pending-only
  // projection; never overwrite the saved analysis or a staff-authored draft.
  if(partial)edit={...edit,draft:progress.draft||JSON.parse(JSON.stringify(edit.draft)),dirty:false,receiptPolicyChanged:false,notesPolicyChanged:false};
  const fields=reviewRegistrationFields(edit),applied=registrationOf(edit.draft);
  if(edit.status!=='committed'&&JSON.stringify([applied.registrationFields?.cashReceiptRequested??null,applied.registrationFields?.cashReceiptDefaulted])!==JSON.stringify([fields.cashReceiptRequested??null,fields.cashReceiptDefaulted]))edit.receiptPolicyChanged=true;
  if(applied.intakeVersion&&edit.status!=='committed'){
    applied.registrationFields??={};
    applied.registrationFields.cashReceiptRequested=fields.cashReceiptRequested;
    if(Object.hasOwn(fields,'cashReceiptDefaulted'))applied.registrationFields.cashReceiptDefaulted=fields.cashReceiptDefaulted;
    else delete applied.registrationFields.cashReceiptDefaulted;
  }
  preparePaymentIntake(edit,fields);
  if(edit.status!=='committed'){
    const comparison=edit.draft.paymentComparison,proposal=registrationOf(edit.draft);
    for(const team of list(proposal.reviewedTeams)){
      const notes=buildPaymentInstructorNotes(team.draft,{proposal:team,comparison});
      if(notes!==team.draft.notes){team.draft.notes=notes;edit.notesPolicyChanged=true;}
    }
    const notes=buildPaymentInstructorNotes(edit.draft);
    if(notes!==edit.draft.notes){edit.draft.notes=notes;edit.notesPolicyChanged=true;}
  }
  const d=edit.draft,committed=edit.status==='committed',locked=busy||committed||partial,cached=cachedApprovedDraft(u,edit),approvalHint=committed?'서버에 저장된 예약·수강권입니다. 변경은 해당 내역에서 진행해 주세요.':progressBlocked?(progress.error||'이미 저장된 예약입니다. 예약 목록에서 확인해 주세요.'):cached?'작성 내용을 다시 열 수 있습니다.':paymentReviewValidation(edit,{approve:true});
  const pass=isUndatedPass(d),registration=registrationOf(d),destination=pass?'수강권':'예약',missing=committed?[]:[!d.sport&&'종목',!pass&&!d.date&&'날짜',!pass&&!d.startTime&&'시간',!d.studentCount&&'인원',![120,240].includes(Number(d.lessonMinutes))&&'강습시간(2·4시간)',Number(d.lessonMinutes)===240&&![0,60,120].includes(Number(d.breakMinutes))&&'휴식 구성(연속·분할)',(d.lessonFee===null||d.lessonFee===undefined||d.lessonFee==='')&&'회당 강습료'].filter(Boolean);
  return `<form data-pr-review-form novalidate>${committedReviewMarkup(u,edit,bookingContext)}${edit.remoteCommitted&&edit.dirty&&!u.reviewError?'<p class="pr-feedback pr-error" role="alert">다른 작업에서 이미 예약·수강권에 반영한 검토입니다. 수정 취소를 눌러 서버 내용을 다시 확인해 주세요.</p>':''}<section class="pr-intake-block pr-bank-fields"><h4>은행 입금 내역</h4><div class="pr-fields">${field('payerName','입금자명',edit.payerName,{disabled:locked})}${field('amount','실제 입금액',edit.amount,{type:'number',min:'1',step:'1',disabled:locked})}${field('bankDate','입금 날짜 · 한국 시간',edit.bankDate,{type:'date',disabled:locked})}${field('bankTime','입금 시간 · 한국 시간',edit.bankTime,{type:'time',step:'any',disabled:locked})}</div>${!edit.bankDate||!edit.bankTime||edit.bankTimestampError?'<p class="pr-warning">입금 날짜·시간 확인 필요. 원본에 없는 날짜·시간은 추정하지 않습니다.</p>':''}</section>${committed||progressBlocked?'':renderPaymentIntake(edit,u,esc,{context:bookingContext,locked})}${partial&&progress.savedSessions?.some(row=>row.cancelled)?`<p class="pr-warning">${esc(progress.savedSessions.filter(row=>row.cancelled).map(row=>row.teamName).join(', '))} 예약은 저장 후 취소된 상태입니다. 해당 입금 배분 기록은 유지되며, 아래에는 아직 저장하지 않은 예약만 표시합니다.</p>`:''}${partial?`<p class="pr-feedback ${progressBlocked?'pr-error':''}" role="status">${esc(progressBlocked?progress.error||'저장된 예약을 예약 목록에서 확인해 주세요.':'이미 저장된 팀·날짜를 제외했습니다. 남은 예약 작성을 누르면 나머지만 작성합니다. 변경할 내용은 예약 작성창에서 수정해 주세요.')}</p>`:committed?'':allocationProposalMarkup(edit,locked)}${missing.length?`<p class="pr-warning pr-flag-summary"><span class="pr-flag danger">❗ 직접 확인 필요</span> ${esc(missing.join(' · '))} 미확인. 임의로 채우지 않습니다. 원문을 대조하고 ${destination} 작성에서 확인하세요.</p>`:''}<label class="pr-field"><span>상담 확인 메모 · 선택</span><textarea name="manualReason" rows="2" maxlength="2000" placeholder="예: 고객에게 전화로 입금자·번호·희망 일정을 확인함" ${disabled(locked)}>${esc(edit.manualReason)}</textarea></label><div class="pr-allocation"><span>아직 배분하지 않은 입금액</span><strong>${won(Number.isSafeInteger(edit.remainingAmount)?edit.remainingAmount:edit.amount)}</strong></div><div class="pr-approval"><p class="pr-actions-note">${committed?'이 입금의 배분을 완료했습니다.':partial?'남은 예약 작성을 누르면 아직 저장하지 않은 팀·날짜만 작성 화면으로 이동합니다. 실제 예약은 작성 화면에서 저장해야 등록됩니다.':`${destination} 작성을 누르면 입력 내용을 저장하고 작성 화면으로 이동합니다. 실제 ${destination}은 작성 화면에서 저장해야 등록됩니다.`}</p>${u.reviewError?`<p class="pr-feedback pr-error" role="alert">${esc(u.reviewError)}</p>`:''}<p class="pr-actions-note" id="pr-approval-hint" data-pr-approval-hint role="status">${esc(approvalHint||'빠진 고객·강습 정보는 작성 화면에서 이어서 입력할 수 있습니다.')}</p><div class="pr-actions"><button type="button" class="btn ghost" data-pr-discard ${disabled(busy||!edit.dirty)}>${edit.id?'수정 취소':'입력 취소'}</button><button type="button" class="btn secondary" data-pr-save ${disabled(locked||!edit.dirty&&!edit.receiptPolicyChanged&&!edit.notesPolicyChanged)}>검토 내용 저장</button><button type="button" class="btn primary" data-pr-approve aria-describedby="pr-approval-hint" ${disabled(busy||committed||progressBlocked)}>${partial?'남은 예약 작성':cached?`${destination} 작성 다시 열기`:`${destination} 작성`}</button></div></div></form>`;
}
function detailMarkup(u,busy,bookingContext={}){
  if(u.detailLoading)return `<section class="pr-detail"><header class="pr-detail-heading"><button type="button" class="btn ghost small" data-pr-back ${disabled(busy)}>목록으로</button><h2>캡처 불러오기</h2></header><div class="pr-empty" role="status">캡처와 검토 내용을 불러오고 있습니다.</div></section>`;
  const detail=u.detail,upload=detail?.upload;
  if(!upload)return u.selectedUploadId?`<section class="pr-detail"><header class="pr-detail-heading"><button type="button" class="btn ghost small" data-pr-back ${disabled(busy)}>목록으로</button><h2>캡처 조회 확인</h2></header><div class="pr-empty" role="alert"><strong>캡처를 불러오지 못했습니다</strong><p>${esc(u.detailError||'연결을 확인하고 다시 불러와 주세요.')}</p><button type="button" class="btn secondary" data-pr-detail-refresh ${disabled(busy)}>다시 불러오기</button></div></section>`:'<section class="pr-detail"><div class="pr-empty"><strong>검토할 캡처를 선택하세요</strong>캡처를 선택한 뒤 자동 분석으로 검토 초안을 만듭니다.</div></section>';
  const reviews=list(detail.reviews),edit=activeEdit(u),protectedReview=protectedUpload(detail),deleteProtected=deletionProtectedUpload(detail),deleting=!!upload.deletingAt,running=upload.analysisStatus==='running'||u.analyzingUploadId===upload.id,expired=analysisExpired(upload)&&u.analyzingUploadId!==upload.id;let imageUrl='';try{if(detail.imageUrl&&!deleting)imageUrl=checkedPaymentImageUrl(detail.imageUrl);}catch{}
  const savedResult=upload.analysisStatus==='succeeded'||protectedReview,previewFailed=u.previewFailedUrl===imageUrl;
  const status=queueStatus({...upload,reviewStatus:edit?.status||upload.reviewStatus}),analysisUpload=running?{...upload,analysisStatus:'running',...(u.analyzingUploadId===upload.id?{analysisLeaseExpiresAt:null}:{})}:upload;
  const analysisLocked=busy||(running&&!expired)||deleting||upload.status!=='ready',aiRunning=list(u.uploadAnalysisRunningIds).includes(upload.id)||(running&&!expired);
  const analysisActions=`${savedResult?'':`<button type="button" class="btn primary" data-pr-analyze ${disabled(analysisLocked)}>${aiRunning?'AI 분석 중…':expired||upload.analysisStatus==='failed'?'자동 분석 재시도':'자동 분석'}</button>`}<button type="button" class="btn secondary small" data-pr-detail-refresh ${disabled(busy)}>결과 새로고침</button>${savedResult?`<button type="button" class="btn primary" data-pr-upload-reanalyze ${disabled(analysisLocked)}>${aiRunning?'AI 분석 중…':'AI 다시 분석'}</button>`:''}<button type="button" class="btn ghost small pr-delete" data-pr-delete ${disabled(busy||(running&&!expired)||deleteProtected)}>${deleting?'삭제 다시 시도':'캡처 삭제'}</button>`;
  return `<section class="pr-detail" data-pr-review-key="${esc(u.activeKey)}"><header class="pr-detail-heading"><button type="button" class="btn ghost small pr-mobile-back" data-pr-back ${disabled(busy)}>목록으로</button><div><h2>${edit?savedReviewName(reviews.find(row=>row.id===edit.id),edit.payerName||'입금자 미확인',busy):'입금 내역 검토'}${reviewSaveBadge(reviews.find(row=>row.id===edit?.id))}</h2><p>${esc(upload.name||'은행 캡처')} · ${esc(stamp(upload.createdAt))}</p></div><span class="pr-tag ${esc(status)}">${status==='committed'&&edit&&isUndatedPass(edit.draft)?'수강권 반영':labels[status]||'상태 확인'}</span></header><nav class="pr-mobile-sections" aria-label="입금 검토 화면 이동">${[['bank','사진'],['conversation','상담 원문'],['results','분석 결과'],['intake','예약 내용']].map(([section,label])=>`<button type="button" class="btn secondary small" data-pr-jump="${section}">${label}</button>`).join('')}</nav><section class="pr-analysis-box" aria-label="캡처 자동 분석"><div class="pr-analysis-copy"><strong>캡처 → 자동 분석 → 예약 작성</strong><p role="${upload.analysisStatus==='failed'?'alert':'status'}">${esc(analysisMessage(analysisUpload,reviews))}</p><small>자동 대조 범위: 저장된 문자(SMS/MMS)·수집된 카카오 대화. 카카오: 수집 시점 기준. 원문 시각과 출처를 직접 확인하세요.</small><p class="pr-analysis-cost"><small>AI 분석은 크레딧을 사용합니다. 결과 새로고침은 저장된 결과만 읽고 작성 중인 내용은 유지합니다.</small></p>${upload.analysisFinishedAt||upload.analysisCompletedAt?`<small>최근 분석 ${esc(stamp(upload.analysisFinishedAt||upload.analysisCompletedAt))}</small>`:''}${deleteProtected?'<small>남은 입금의 예약·수강권 반영을 마친 뒤 캡처를 삭제할 수 있습니다.</small>':protectedReview?'<small>캡처를 삭제해도 저장된 예약·수강권·입금 배분·검토 이력은 유지됩니다.</small>':''}</div><div class="pr-analysis-actions">${analysisActions}</div></section>${uploadAnalysisMarkup(u,edit,busy||running||deleting)}${latestAnalysisMarkup(u,edit,busy||running||deleting)}<div class="pr-review-tabs">${reviews.map(review=>`<button type="button" class="btn ${keyFor(review)===u.activeKey?'primary':'secondary'} small" data-pr-review="${esc(keyFor(review))}" ${disabled(busy)}>${esc(review.payerName||'입금자 미확인')}${reviewSaveBadge(review)} · ${won(review.amount)}</button>`).join('')}<button type="button" class="btn secondary small" data-pr-new-row ${disabled(busy||running||deleting||upload.status!=='ready')}>＋ 입금건 직접 입력</button></div><div class="pr-bank-toolbar">${edit?`<dl class="pr-bank-summary"><div><dt>확인할 입금자</dt><dd>${esc(edit.payerName||'미확인')}</dd></div><div><dt>실제 입금액</dt><dd>${won(edit.amount)}</dd></div><div class="pr-bank-wide"><dt>입금 날짜·시간 · 한국 시간</dt><dd data-pr-bank-timestamp>${esc(bankSummary(edit))}</dd></div></dl>`:''}<details class="pr-bank-original" data-pr-section="bank" tabindex="-1" data-pr-panel="bank" ${u.openPanels?.bank?'open':''}><summary>은행 캡처 원본 보기</summary>${imageUrl?`<figure class="pr-source-image">${previewFailed?'':`<img data-pr-bank-image src="${esc(imageUrl)}" alt="검토 중인 은행 캡처" referrerpolicy="no-referrer">`}<figcaption>캡처의 입금자·금액·입금 날짜와 시간을 대조하세요.</figcaption><a href="${esc(imageUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">원본 크게 보기</a></figure>`:'<p class="pr-missing">캡처 열람 시간이 지났거나 원본을 불러오지 못했습니다. 사진을 다시 불러와 주세요.</p>'}${u.previewLoading?'<p class="pr-preview-status" role="status">사진을 다시 불러오고 있습니다…</p>':''}${u.previewError?`<p class="pr-preview-error" role="alert">${esc(u.previewError)}</p>`:''}<button type="button" class="btn secondary small" data-pr-image-refresh ${disabled(busy||u.previewLoading)}>사진 다시 불러오기</button></details></div><div class="pr-review-grid pr-review-workspace"><aside class="pr-review-tools"><details class="pr-evidence-pane" data-pr-section="conversation" data-pr-panel="conversation" tabindex="-1" ${u.openPanels?.conversation?'open':''}><summary>상담 원문 · 문자·카카오 대화</summary>${edit?`${comparisonOriginalsMarkup(u,edit,busy||running||deleting)}<details class="pr-manual-candidate" data-pr-panel="candidate" ${u.openPanels?.candidate?'open':''}><summary>다른 전화번호·상담 후보 찾기</summary>${candidateMarkup(u,edit,busy||running||deleting)}</details>`:''}</details><details class="pr-proposals-pane" data-pr-section="results" data-pr-panel="results" tabindex="-1" ${u.openPanels?.results?'open':''}><summary>분석 제안 · 팀·강습 및 입금 대조</summary>${edit?paymentComparisonMarkup(u,edit,busy||running||deleting):''}</details></aside><div class="pr-form-pane" data-pr-section="intake" tabindex="-1">${edit?`<h3 class="pr-section-title">③ 대조 후 ${isUndatedPass(edit.draft)?'수강권':'예약'}에 넘길 내용</h3>${formMarkup(u,edit,busy||running||deleting,bookingContext)}`:`<div class="pr-empty"><strong>${running?'검토 초안을 만들고 있습니다.':'아직 검토 초안이 없습니다.'}</strong>${running?'분석 상태를 새로고침해 결과를 확인하세요.':'위의 자동 분석을 누르거나 입금건을 직접 입력하세요.'} 관리자·상담사가 내용을 확인하고 예약 작성을 누르면 입력을 이어갈 수 있습니다.</div>`}</div></div></section>`;
}
const batchEligible=upload=>upload?.status==='ready'&&!upload.deletingAt&&!upload.deletedAt;
const completedBatchUpload=upload=>batchEligible(upload)&&(upload.analysisStatus==='succeeded'||protectedUpload({upload}));
const sameUploadSet=(left,right)=>left.length===right.length&&left.every(id=>right.includes(id));
function queueSaveStatus(u,upload){
  if(u.detail?.upload?.id===upload.id){
    const statuses=list(u.detail.reviews).filter(row=>row.id).map(paymentReviewSaveStatus);
    if(statuses.some(row=>row.saved)){
      if(statuses.length===1)return statuses[0];
      const completed=statuses.filter(row=>row.complete).length,complete=completed===statuses.length;
      return {complete,label:complete?'저장 완료':completed?`일부 저장 ${completed}/${statuses.length}건`:'일부 저장'};
    }
  }
  return paymentUploadSaveStatus(upload);
}
const unmatchedStamp=value=>text(value)?text(value).replace('T',' ').replace(/(?:\+\d{2}:\d{2}|Z)$/,''):'';
function unmatchedDepositsMarkup(u,data,locked){
  if(u.filter!=='unmatched')return '';
  const rows=list(data?.deposits);
  if(!rows.length)return '<p class="pr-unmatched-note">상담 원문을 못 찾은 입금 건이 없습니다.</p>';
  return `<section class="pr-unmatched-list" aria-label="원문 없음 입금 모음"><p class="pr-unmatched-note">상담 원문을 못 찾은 입금 ${rows.length}건 · 입금일 순. 입금자명을 누르면 해당 검토로 이동합니다.</p><table><thead><tr><th>입금일시</th><th>입금자명</th><th>금액</th><th>캡처</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(unmatchedStamp(row.transactionDate)||'일시 미확인')}</td><td><button type="button" class="pr-saved-name" data-pr-unmatched="${esc(row.uploadId)}:${esc(row.rowKey)}" ${disabled(locked)}>${esc(row.payerName||'입금자 미확인')}</button></td><td>${Number.isSafeInteger(row.amount)?won(row.amount):'미확인'}</td><td class="pr-unmatched-capture">${esc(row.uploadName||'')}</td></tr>`).join('')}</tbody></table></section>`;
}
function queueItemMarkup(u,upload,locked){
  const protectedReview=protectedUpload({upload}),deletionBlocked=deletionProtectedUpload({upload}),running=upload.analysisStatus==='running'&&!analysisExpired(upload),reason=deletionBlocked?deletionProtectedMessage:running?'진행 중인 분석을 마친 뒤 삭제할 수 있습니다.':'캡처 이미지를 삭제합니다. 저장된 예약·입금 기록은 유지됩니다.';
  return `<div class="pr-queue-row"><label class="pr-select-capture"><input type="checkbox" data-pr-select-upload="${esc(upload.id)}" aria-label="${esc(upload.name||'은행 캡처')} 함께 분석할 사진 선택" ${u.selectedUploadIds.includes(upload.id)?'checked':''} ${disabled(locked||!batchEligible(upload))}><span class="pr-sr-only">사진 선택</span></label><button type="button" class="pr-item ${u.selectedUploadId===upload.id?'selected':''}" data-pr-upload="${esc(upload.id)}" ${disabled(locked)}><span class="pr-item-top"><strong>${esc(upload.payerName||upload.name||'은행 캡처')}${savedBadgeMarkup(queueSaveStatus(u,upload))}</strong>${Number.isSafeInteger(upload.amount)?`<b>${won(upload.amount)}</b>`:''}</span><small>${esc(stamp(upload.createdAt))}</small><span class="pr-tag ${esc(queueStatus(upload))}">${labels[queueStatus(upload)]||'상태 확인'}</span>${Number.isSafeInteger(upload.reviewCount)?`<small>입금 검토 ${upload.reviewCount}건</small>`:''}${protectedReview?'<small>승인한 검토는 유지 · 합계 참고</small>':''}</button>${upload.reviewDoneAt?`<button type="button" class="btn ghost small" data-pr-mark-undone="${esc(upload.id)}" title="수동 완료를 해제하고 대기열로 되돌립니다." ${disabled(locked)}>대기로</button>`:u.filter!=='completed'?`<button type="button" class="btn ghost small" data-pr-mark-done="${esc(upload.id)}" title="수동으로 저장 완료 처리합니다. 원문 없음 추적에는 그대로 남습니다." ${disabled(locked||running)}>완료로</button>`:''}<button type="button" class="btn ghost small pr-queue-delete" data-pr-delete-upload="${esc(upload.id)}" aria-label="${esc(upload.name||'은행 캡처')} 캡처 삭제" title="${esc(reason)}" ${disabled(locked||running||deletionBlocked)}>${upload.deletingAt?'삭제 재시도':'삭제'}</button></div>`;
}
function batchMarkup(u,busy){
  const results=list(u.batchResults),done=results.filter(row=>row.status==='succeeded').length,same=sameUploadSet(u.batchUploadIds,u.selectedUploadIds),resumable=same&&results.some(row=>row.status!=='succeeded'),canReanalyze=!resumable&&u.selectedUploadIds.length>0&&u.selectedUploadIds.every(id=>completedBatchUpload(u.selectedUploads[id])),statusLabels={pending:'대기',extracting:'은행 내역 읽는 중',extracted:'은행 내역 확인 · 합산 대조 대기',matching:'상담·합산 대조 중',succeeded:'검토 결과 확인 가능',failed:'확인 필요 · 이어서 분석 가능',running:'서버 처리 중 · 잠시 후 이어서 분석'};
  return `<section class="pr-batch" aria-label="여러 사진 함께 분석"><div class="pr-batch-heading"><div><strong>함께 분석할 사진 ${u.selectedUploadIds.length} / ${MAX_BATCH_UPLOADS}장</strong><p>새 사진은 AI로 함께 분석합니다. 결과 새로고침은 저장된 결과만 읽습니다. AI 분석은 크레딧을 사용하며 작성 중인 내용은 유지합니다.</p></div><button type="button" class="btn primary" data-pr-analyze-batch ${disabled(busy||!u.selectedUploadIds.length)}>${busy&&u.batchPhase?u.batchPhase==='extract'?'1/2 은행 내역 읽기…':'2/2 상담·합산 대조…':resumable?'선택 사진 이어서 분석':canReanalyze||same&&results.length&&done===results.length?'선택 결과 새로고침':'선택 사진 AI 분석'}</button></div><div class="pr-batch-select">${canReanalyze?`<button type="button" class="btn secondary small" data-pr-reanalyze-batch ${disabled(busy)}>${list(u.uploadAnalysisRunningIds).length?'AI 분석 중…':'선택 사진 AI 다시 분석'}</button><small>AI 크레딧을 사용해 선택한 사진 원본과 최신 상담을 새로 분석합니다.</small>`:''}<button type="button" class="btn secondary small" data-pr-select-all ${disabled(busy)}>현재 페이지 모두 선택</button><button type="button" class="btn ghost small" data-pr-clear-selection ${disabled(busy||!u.selectedUploadIds.length)}>선택 해제</button><small>최대 12장 · 다른 페이지의 선택도 유지됩니다.</small></div>${u.files.length?`<ul class="pr-file-progress" aria-label="사진 업로드 상태">${u.files.map(item=>`<li><span>${esc(item.file?.name||'캡처')}</span><b>${({pending:'전송 대기',uploading:'전송 중…',ready:'업로드 완료',failed:'전송 실패 · 재시도 가능'})[item.status]||'상태 확인'}</b>${item.error?`<small>${esc(item.error)}</small>`:''}</li>`).join('')}</ul>`:''}${results.length?`<div class="pr-batch-progress" role="status"><strong>${u.batchPhase==='extract'?'1/2 은행 내역 읽기':u.batchPhase==='match'?'2/2 상담·합산 대조':'사진별 분석 결과'} · 완료 ${done}/${results.length}</strong><ol>${results.map(row=>`<li class="pr-batch-${esc(row.status)}"><span>${esc(row.name||'은행 캡처')}</span><b>${statusLabels[row.status]||'상태 확인'}</b>${row.preservedCount>0?`<small class="pr-preserved-reviews">직접 수정·승인한 검토 ${row.preservedCount}건 유지</small>`:row.preserved?'<small class="pr-preserved-reviews">직접 수정·승인한 검토 유지</small>':''}${row.error?`<small>${esc(row.error)}</small>`:''}</li>`).join('')}</ol></div>`:''}</section>`;
}
export function renderPaymentReview({profile,ui={},data={},loading=false,error='',busy=false,bookingContext={}}={}){
  if(!canReviewPayments(profile,ui)){clearPaymentReview(ui);return '<section class="panel pr-empty"><strong>관리자·상담사 전용 메뉴입니다.</strong>운영 계정으로 로그인해 주세요.</section>';}
  const u=stateOf(ui),locked=busy||u.busy||u.uploading,uploads=list(data?.uploads),visible=visibleQueueUploads(data,u.filter);
  for(const upload of uploads)u.selectedUploads[upload.id]={...u.selectedUploads[upload.id],...upload};
  const offset=Number.isSafeInteger(u.offset)&&u.offset>=0?u.offset:0,total=Number.isSafeInteger(data?.total)&&data.total>=0?data.total:uploads.length,limit=30,page=Math.floor(offset/limit)+1,pages=Math.max(1,Math.ceil(total/limit));
  return `<section class="pr-page" data-payment-review><header class="pr-heading"><div><h1>입금 검토</h1><p>은행 캡처와 상담 원문을 대조한 뒤 예약 작성으로 넘깁니다.</p></div><button type="button" class="btn secondary" data-pr-refresh ${disabled(loading||locked)}>새로고침</button></header><details class="pr-workspace-tools" data-pr-panel="tools" ${!u.selectedUploadId||u.openPanels?.tools||locked&&!!u.batchPhase?'open':''}><summary>사진 올리기·분석 관리 <span>선택 ${u.selectedUploadIds.length}장 · 캡처 ${total}건</span></summary><div class="pr-upload"><div class="pr-upload-copy"><strong>은행 입금내역 캡처 올리기</strong><p>PNG·JPG·WebP · 파일당 8 MB · 한 번에 최대 12장. 업로드 후 사진을 선택해 함께 분석하세요.</p></div><label class="btn primary pr-file ${locked?'is-disabled':''}">사진 여러 장 선택<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-pr-file ${disabled(locked)}></label><details class="pr-optional-link"><summary>ChatGPT 연결 · 선택 사항</summary><p>자동 분석은 ChatGPT 대화나 계정 연결 없이 사용할 수 있습니다.</p><div class="pr-link-controls"><span class="pr-link-status">${ui.paymentReviewLinkStatus?.connected===true?'ChatGPT 연결됨':ui.paymentReviewLinkStatus?.connected===false?'ChatGPT 미연결':'ChatGPT 연결 확인 필요'}</span>${ui.paymentReviewLinkStatus?.connected===true?`<button type="button" class="btn secondary" data-pr-disconnect ${disabled(locked)}>연결 해제</button>`:`<button type="button" class="btn secondary" data-pr-connect ${disabled(locked)}>ChatGPT 연결</button>`}<button type="button" class="btn ghost small" data-pr-link-status ${disabled(locked)}>연결 확인</button></div></details></div>${u.connectionCode?`<div class="pr-connection-code"><strong>ChatGPT 연결 코드</strong><code>${esc(u.connectionCode.code)}</code><p>이 코드를 현재 ChatGPT 대화에 입력하세요. ${u.connectionCode.expiresAt?`${esc(stamp(u.connectionCode.expiresAt))}까지 사용할 수 있습니다.`:''}</p><button type="button" class="btn secondary small" data-pr-copy-code>코드 복사</button><button type="button" class="btn ghost small" data-pr-hide-code>코드 닫기</button></div>`:''}${batchMarkup(u,locked)}</details>${error||u.error?`<p class="pr-feedback pr-error" role="alert">${esc(error||u.error)}</p>`:''}${u.notice?`<p class="pr-feedback pr-notice" role="status">${esc(u.notice)}</p>`:''}${u.files.some(item=>item.status==='failed')?`<button type="button" class="btn secondary small" data-pr-retry-uploads ${disabled(locked)}>실패한 캡처 다시 업로드</button>`:''}<div class="pr-layout ${u.selectedUploadId?'has-detail':''}"><aside class="pr-queue"><header class="pr-queue-head"><strong>${u.filter==='completed'?'저장 완료 캡처':'캡처 대기열'}</strong><span>전체 ${total}건</span></header><div class="pr-filters">${[['pending','대기열','pendingTotal'],['unmatched','원문 없음','unmatchedTotal'],['completed','저장 완료','completedTotal']].map(([value,label,totalKey])=>`<button type="button" class="btn ${u.filter===value?'primary':'secondary'} small" data-pr-filter="${value}" aria-pressed="${u.filter===value}" ${disabled(locked||loading)}>${label}${Number.isSafeInteger(data?.[totalKey])?` <span>${data[totalKey]}</span>`:''}</button>`).join('')}</div>${unmatchedDepositsMarkup(u,data,locked)}<div class="pr-queue-list">${visible.map(upload=>queueItemMarkup(u,upload,locked)).join('')||`<div class="pr-empty">${loading?'대기열을 불러오고 있습니다.':u.filter==='completed'?'저장 완료된 캡처가 없습니다.':total>0?'이 페이지에 표시할 캡처가 없습니다. 이전 페이지나 새로고침으로 확인해 주세요.':'등록된 캡처가 없습니다.'}</div>`}</div><nav class="pr-pagination" aria-label="캡처 대기열 페이지"><button type="button" class="btn ghost small" data-pr-page="previous" ${disabled(locked||loading||offset===0)}>이전</button><span>${page} / ${pages}</span><button type="button" class="btn ghost small" data-pr-page="next" ${disabled(locked||loading||offset+limit>=total)}>다음</button></nav></aside>${detailMarkup(u,locked,bookingContext)}</div>${renderSavedPaymentRecords(u.savedRecords,esc)}</section>`;
}
const paymentFormBaselines=new WeakMap();
function paymentFormSignature(form,defaults=false){
  const controls=Array.from(form?.querySelectorAll?.('input[name],select[name],textarea[name]')||[]);
  if(!controls.length)return null;
  return JSON.stringify(controls.map(input=>{
    const checkable=['checkbox','radio'].includes(input.type),select=input.tagName==='SELECT';
    const value=defaults&&!checkable?(select?Array.from(input.options||[]).find(option=>option.defaultSelected)?.value??input.options?.[0]?.value??'':input.defaultValue??''):input.value??'';
    return [input.name,String(value),checkable?(defaults?input.defaultChecked:input.checked)===true:null,defaults?false:input.validity?.badInput===true];
  }));
}
function captureForm(form,edit){
  if(!form||!edit||edit.paymentProgress&&edit.paymentProgress.kind!=='none')return false;
  const cards=Array.from(form.querySelectorAll?.('[data-pr-intake-team-id][data-pr-intake-prefix]')||[]).filter(card=>card?.dataset?.prIntakeTeamId&&typeof card.dataset.prIntakePrefix==='string');
  if(!cards.length)return captureSingleTeamForm(form,edit);
  const signature=paymentFormSignature(form);if(signature!==null&&signature===paymentFormBaselines.get(form))return false;
  const activeId=registrationOf(edit.draft).activeTeamId;let changed=false,invalidNumber='';
  for(const card of cards){
    const scoped=scopedPaymentIntakeForm(form,card),ownSignature=paymentFormSignature(scoped);
    if(ownSignature!==null&&ownSignature===paymentFormBaselines.get(scoped))continue;
    const id=card.dataset.prIntakeTeamId;if(!paymentIntakeTeams(edit.draft).some(team=>team.id===id))continue;
    edit.draft=switchPaymentIntakeTeam(edit.draft,id);
    changed=captureSingleTeamForm(scoped,edit)||changed;if(edit.numericInputError&&!invalidNumber)invalidNumber=edit.numericInputError;
  }
  if(activeId&&paymentIntakeTeams(edit.draft).some(team=>team.id===activeId))edit.draft=switchPaymentIntakeTeam(edit.draft,activeId);
  invalidNumber='';for(const input of form.querySelectorAll?.('input[type="number"]')||[]){if(input.disabled||input.readOnly)continue;const value=String(input.value||'').trim();if(input.validity?.badInput||value&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||input.validity?.rangeUnderflow||input.validity?.rangeOverflow||input.validity?.stepMismatch)){invalidNumber=input.name;break;}}
  edit.numericInputError=invalidNumber;
  if(signature!==null)paymentFormBaselines.set(form,signature);
  return changed;
}
function captureSingleTeamForm(form,edit){
  if(!form||!edit)return false;
  const signature=paymentFormSignature(form);
  // Legacy drafts acquire structural/default fields when rendered by the shared
  // intake. Reading untouched controls must not silently apply those defaults or
  // turn a saved review into an unsaved staff edit. Browser default values also
  // distinguish real input (including autofill) made before the first capture.
  if(signature!==null&&signature===paymentFormBaselines.get(form))return false;
  const previous=JSON.stringify([edit.payerName,edit.amount,edit.transactionDate,edit.bankDate,edit.bankTime,edit.bankTimestampError,edit.draft,edit.manualReason,edit.numericInputError||'']),priorCustomerName=edit.draft.customerName,priorPhone=edit.draft.phone,priorTeamName=edit.draft.teamName;
  edit.numericInputError='';
  for(const input of form.querySelectorAll?.('input[type="number"]')||[]){
    if(input.disabled||input.readOnly)continue;
    const value=String(input.value||'').trim();
    if(input.validity?.badInput||value&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||input.validity?.rangeUnderflow||input.validity?.rangeOverflow||input.validity?.stepMismatch)){edit.numericInputError=input.name;break;}
  }
  const value=name=>form.elements.namedItem(name)?.value??'';
  const integer=name=>{const raw=String(value(name)).trim();return /^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;};
  edit.payerName=String(value('payerName')).trim();edit.amount=integer('amount');
  if(edit.serverAllocatedAmount===0||!edit.id)edit.remainingAmount=edit.amount;
  const dateInput=form.elements.namedItem('bankDate'),timeInput=form.elements.namedItem('bankTime');
  if(dateInput||timeInput){
    const date=dateInput?String(dateInput.value).trim():edit.bankDate||'',time=timeInput?String(timeInput.value).trim():edit.bankTime||'',changed=date!==(edit.bankDate||'')||time!==(edit.bankTime||'');
    if(changed){
      edit.bankDate=date;edit.bankTime=time;
      edit.bankTimestampError=bankInputError(date,time);
      if(!edit.bankTimestampError)edit.transactionDate=date?(time?`${date}T${time}+09:00`:date):'';
    }
    if(dateInput?.validity?.badInput||timeInput?.validity?.badInput){edit.bankInputInvalid=true;edit.bankTimestampError='입금 날짜와 시간을 끝까지 확인해 입력하거나 미확인 항목은 비워 주세요.';}
    else if(edit.bankInputInvalid){edit.bankInputInvalid=false;edit.bankTimestampError=bankInputError(date,time);}
  }
  for(const key of draftStrings)if(form.elements.namedItem(key))edit.draft[key]=String(value(key));
  for(const key of draftNumbers)if(form.elements.namedItem(key))edit.draft[key]=integer(key);
  const typeInput=form.elements.namedItem('reservationKind'),countInput=form.elements.namedItem('passTotalSessions');
  if(typeInput){
    const kind=String(typeInput.value),prior=registrationOf(edit.draft);
    if(['','lesson','pass'].includes(kind)&&kind!==(prior.bookingType||'')){
      edit.draft.paymentComparison??={version:1,status:'unmatched',candidates:[]};
      edit.draft.paymentComparison.appliedProposal={...prior,fields:list(prior.fields).filter(fact=>!proposalRegistrationFields.has(fact.field)),bookingType:kind,scheduleStatus:kind==='pass'?'undated':kind==='lesson'?'confirmed':'unknown',selectionSource:'staff',requiresConfirmation:true};
      delete edit.draft.paymentComparison.appliedProposal.scheduleInference;
    }
  }
  if(countInput&&isUndatedPass(edit.draft)){
    const raw=String(countInput.value).trim(),count=/^\d+$/.test(raw)?Number(raw):null,valid=count!==null&&Number.isSafeInteger(count)&&count>=1&&count<=100;
    edit.passCountInput=raw;edit.passCountInvalid=countInput.validity?.badInput===true||!!raw&&!valid;
    const applied=registrationOf(edit.draft),unknown=!raw&&(applied.totalSessions===null||applied.totalSessions===undefined);
    if(!unknown){if((valid?count:undefined)!==applied.totalSessions)applied.selectionSource='staff';if(valid)applied.totalSessions=count;else delete applied.totalSessions;}
  }else edit.passCountInvalid=false;
  const priorRegistration=reviewRegistrationFields(edit),registrationFields={...priorRegistration};
  for(const name of Object.keys(registrationDefaults)){
    const input=form.elements.namedItem(name);if(!input)continue;
    if(['cashReceiptRequested','parallelLongTurn','snowboardNoviceTurn'].includes(name))registrationFields[name]=input.value==='true'?true:input.value==='false'?false:null;
    else if(['juniorPreparation','rentalCustomAmount','designated','isReorder','patchEnabled'].includes(name))registrationFields[name]=input.checked===true;
    else if(['experienceCount','rentalHours','seasonTotal','sessionNumber','patchFee'].includes(name))registrationFields[name]=integer(name);
    else registrationFields[name]=String(input.value||'').trim();
  }
  const rentalAmount=form.elements.namedItem('rentalAmount');if(rentalAmount)edit.draft.rentalFee=integer('rentalAmount');
  if(JSON.stringify(priorRegistration)!==JSON.stringify(registrationFields)){
    edit.draft.paymentComparison??={version:1,status:'unmatched',candidates:[]};edit.draft.paymentComparison.appliedProposal??={fields:[],requiresConfirmation:true};edit.draft.paymentComparison.appliedProposal.registrationFields=registrationFields;
  }
  const participantCount=edit.draft.studentCount,participantRows=[];
  for(let index=0;index<(Number.isSafeInteger(participantCount)?participantCount:0);index++){
    const typeInput=form.elements.namedItem(`participant_${index}_type`);if(!typeInput)break;const type=['adult','minor'].includes(typeInput.value)?typeInput.value:'';
    participantRows.push({type,age:type==='minor'?integer(`participant_${index}_age`):null});
  }
  if(participantRows.length){
    const old=list(registrationOf(edit.draft).participants),blank=Array.from({length:participantRows.length},()=>({type:'',age:null}));
    if(JSON.stringify(old.length===participantRows.length?old:blank)!==JSON.stringify(participantRows)){
      edit.draft.paymentComparison??={version:1,status:'unmatched',candidates:[]};edit.draft.paymentComparison.appliedProposal??={fields:[],requiresConfirmation:true};edit.draft.paymentComparison.appliedProposal.participants=participantRows;
    }
  }
  edit.manualReason=String(value('manualReason'));
  if(edit.draft.customerName!==priorCustomerName||edit.draft.phone!==priorPhone){edit.draft.customerId='';edit.draft.teamId='';}
  else if(edit.draft.teamName!==priorTeamName)edit.draft.teamId='';
  capturePaymentIntakeSessions(form,edit);
  const appliedNow=registrationOf(edit.draft),included=list(appliedNow.reviewedTeams),selected=included.find(team=>team.threadId===appliedNow.threadId&&team.teamIndex===appliedNow.teamIndex);
  if(selected&&appliedNow.intakeVersion!==1){selected.draft=Object.fromEntries([...draftStrings,...draftNumbers].map(key=>[key,edit.draft[key]]));selected.participants=list(appliedNow.participants);selected.registrationFields={...reviewRegistrationFields(edit)};selected.label=edit.draft.teamName||selected.label;}
  if(signature!==null)paymentFormBaselines.set(form,signature);
  const changed=previous!==JSON.stringify([edit.payerName,edit.amount,edit.transactionDate,edit.bankDate,edit.bankTime,edit.bankTimestampError,edit.draft,edit.manualReason,edit.numericInputError||'']);
  if(changed)edit.staffEdited=true;
  return changed;
}
function putReview(u,review){
  if(!review||typeof review.id!=='string'||!Number.isSafeInteger(review.version))throw Error('검토 저장 결과를 확인하지 못했습니다.');
  // 같은 rowKey의 미저장 로컬 행이 서버 저장본으로 바뀌면 교체한다(탭 중복 방지).
  const rows=list(u.detail?.reviews).filter(row=>row.id||!review.rowKey||row.rowKey!==review.rowKey);
  const index=rows.findIndex(row=>row.id===review.id);
  if(index<0)rows.push(review);else rows[index]=review;
  u.detail.reviews=rows;delete u.edits[review.id];if(review.rowKey)delete u.edits[`new:${review.rowKey}`];u.activeKey=review.id;return editOf(u,review);
}
export function bindPaymentReview(root,{profile,ui={},data={},bookingContext={},onChange,onRefresh,onAction,onOpenBooking,onLoadSavedReservations,onEditSavedReservation,isCurrent=()=>true,busy=false,upload=globalThis.fetch,crypto=globalThis.crypto,confirm=message=>globalThis.confirm?.(message)===true}={}){
  if(!canReviewPayments(profile,ui))return;
  const u=stateOf(ui),current=()=>isCurrent()&&ui.paymentReview===u&&canReviewPayments(profile,ui);
  const blocked=()=>u.busy||u.handoffPending||u.uploading||(typeof busy==='function'?busy():!!busy);
  const paint=()=>{if(current())onChange?.();};
  const safeError=(error,fallback)=>typeof error?.message==='string'?error.message:fallback;
  const dirty=()=>Object.values(u.edits).some(edit=>edit.dirty);
  root.querySelectorAll('[data-pr-panel]').forEach(panel=>panel.addEventListener('toggle',()=>{if(!current()||panel.isConnected===false)return;u.openPanels??={};u.openPanels[panel.dataset.prPanel]=panel.open===true;}));
  const preserveCurrent=()=>{captureCurrent();return true;};
  const refresh=async()=>{try{await onRefresh?.();}catch(error){if(current()){u.error=safeError(error,'대기열을 불러오지 못했습니다.');paint();}}};
  const openSavedRecords=async(reviewId,selectedKey='')=>{
    if(!current()||blocked()||u.savedRecords?.editing)return;
    const review=list(u.detail?.reviews).find(row=>row.id===reviewId),status=paymentReviewSaveStatus(review);
    if(!review||!status.saved)return;
    const linked=savedPaymentRecords(review,{});
    if(selectedKey&&!linked.some(row=>row.key===selectedKey)){u.reviewError='이 입금에 연결된 저장 내역을 다시 선택해 주세요.';paint();return;}
    preserveCurrent();
    const uploadId=u.detail.upload.id,activeKey=u.activeKey,panel={reviewId,selectedKey,review:null,bookingContext:null,loading:true,editing:false,error:''};
    u.savedRecords=panel;paint();
    const selected=()=>current()&&u.savedRecords===panel&&u.selectedUploadId===uploadId&&u.activeKey===activeKey;
    try{
      if(typeof onLoadSavedReservations!=='function')throw Error('저장된 예약 조회 연결을 확인해 주세요.');
      const result=await onLoadSavedReservations({reviewId});
      if(!selected())return;
      if(result?.review?.id!==reviewId||result.review.uploadId!==uploadId||!Number.isSafeInteger(result.review.version)||result.review.version<review.version||!paymentReviewSaveStatus(result.review).saved||!result.bookingContext||typeof result.bookingContext!=='object')throw Error('선택한 입금의 최신 저장 내역을 확인하지 못했습니다. 다시 불러와 주세요.');
      const records=savedPaymentRecords(result.review,result.bookingContext);
      if(selectedKey&&!records.some(row=>row.key===selectedKey))throw Error('선택한 예약이 이 입금의 저장 내역에 없습니다. 목록을 다시 확인해 주세요.');
      panel.review=result.review;panel.bookingContext=result.bookingContext;panel.selectedKey=selectedKey||records[0]?.key||'';
    }catch(error){if(selected())panel.error=safeError(error,'저장된 예약을 불러오지 못했습니다. 다시 시도해 주세요.');}
    finally{if(selected()){panel.loading=false;paint();}}
  };
  root.querySelectorAll('[data-pr-open-saved-review]').forEach(button=>button.addEventListener('click',()=>openSavedRecords(button.dataset.prOpenSavedReview)));
  root.querySelectorAll('[data-pr-open-saved-record]').forEach(button=>button.addEventListener('click',()=>openSavedRecords(button.dataset.prSavedReview,`${button.dataset.prSavedKind==='pass'?'pass':'reservation'}:${button.dataset.prOpenSavedRecord}`)));
  const closeSavedRecords=()=>{
    if(!current()||u.savedRecords?.editing)return;
    const reviewId=u.savedRecords?.reviewId;u.savedRecords=null;paint();
    Array.from(root.querySelectorAll('[data-pr-open-saved-review]')).find(button=>button.dataset.prOpenSavedReview===reviewId)?.focus?.({preventScroll:true});
  };
  root.querySelector('[data-pr-saved-close]')?.addEventListener('click',closeSavedRecords);
  root.querySelector('[data-pr-saved-reload]')?.addEventListener('click',()=>{const panel=u.savedRecords;if(panel&&!panel.loading&&!panel.editing)void openSavedRecords(panel.reviewId,panel.selectedKey);});
  root.querySelectorAll('[data-pr-saved-select]').forEach(button=>button.addEventListener('click',()=>{
    const panel=u.savedRecords;if(!current()||blocked()||!panel||panel.loading||panel.editing)return;
    if(!savedPaymentRecords(panel.review,panel.bookingContext).some(row=>row.key===button.dataset.prSavedSelect))return;
    panel.selectedKey=button.dataset.prSavedSelect;panel.error='';paint();
  }));
  root.querySelector('[data-pr-saved-edit]')?.addEventListener('click',async event=>{
    const panel=u.savedRecords;if(!current()||blocked()||!panel||panel.loading||panel.editing)return;
    const reservationId=event.currentTarget.dataset.prSavedEdit,record=savedPaymentRecords(panel.review,panel.bookingContext).find(row=>row.key===panel.selectedKey);
    if(!list(u.detail?.reviews).some(row=>row.id===panel.reviewId)||record?.kind!=='reservation'||record.id!==reservationId||!record.canEdit){panel.error='이 입금에 연결된 수정 가능한 예약을 선택해 주세요. 취소·삭제·환불된 예약은 조회만 할 수 있습니다.';paint();return;}
    panel.editing=true;panel.error='';paint();
    try{
      if(typeof onEditSavedReservation!=='function')throw Error('예약 수정 화면 연결을 확인해 주세요.');
      const result=await onEditSavedReservation({reviewId:panel.reviewId,reservationId});
      if(!current()||u.savedRecords!==panel)return;
      if(result?.opened!==true)throw Error('예약 수정 화면을 열지 못했습니다. 다시 시도해 주세요.');
      u.savedRecords=null;
    }catch(error){if(current()&&u.savedRecords===panel)panel.error=safeError(error,'예약 수정 화면을 열지 못했습니다. 다시 시도해 주세요.');}
    finally{if(current()){panel.editing=false;paint();}}
  });
  const savedDialog=root.querySelector('[data-pr-saved-details]');
  if(savedDialog){
    savedDialog.setAttribute?.('tabindex','-1');
    savedDialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();closeSavedRecords();return;}
      if(event.key!=='Tab')return;
      const buttons=Array.from(savedDialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(node=>!node.hidden),first=buttons[0],last=buttons.at(-1);
      if(!buttons.length){event.preventDefault();savedDialog.focus?.();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
    if(!savedDialog.contains?.(globalThis.document?.activeElement)){
      const selected=Array.from(savedDialog.querySelectorAll('[data-pr-saved-select]')).find(button=>!button.disabled&&button.dataset.prSavedSelect===u.savedRecords?.selectedKey),close=savedDialog.querySelector('[data-pr-saved-close]');
      (selected||(!close?.disabled&&close)||savedDialog)?.focus?.({preventScroll:true});
    }
  }
  const loadComparisonOriginals=async(candidateIndex=0,{append=false,refresh=false}={})=>{
    const selectedEdit=activeEdit(u),candidate=originalSources(u,selectedEdit)[candidateIndex];
    if(!current()||blocked()||!selectedEdit||!candidate?.sourceId||!candidate.phone)return;
    const prior=u.comparisonOriginals?.[candidate.threadId];if(prior&&!refresh&&(!append||!prior.nextBefore&&!prior.validationIncomplete))return prior;
    const key=u.activeKey,request=(u.comparisonRequest||0)+1;u.comparisonRequest=request;u.comparisonLoading=candidate.threadId;u.comparisonError='';paint();
    try{
      const result=await onAction('conversation-detail',{sourceId:candidate.sourceId,phone:candidate.phone,limit:100,...(append&&prior?.nextBefore?{before:prior.nextBefore}:{})});
      if(!current()||u.activeKey!==key||selectedEdit!==activeEdit(u)||request!==u.comparisonRequest)return;
      if(result?.sourceId!==candidate.sourceId||phoneKey(result?.phone)!==phoneKey(candidate.phone)||!Array.isArray(result.messages))throw Error('선택한 후보의 상담 원문을 확인하지 못했습니다.');
      const originals=result.messages.filter(row=>/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.id||row.messageId||'')&&typeof row.text==='string'&&(!row.sourceId||row.sourceId===candidate.sourceId)&&(!row.phone||phoneKey(row.phone)===phoneKey(candidate.phone))).map(row=>({...row,sourceId:candidate.sourceId,sourceLabel:candidate.sourceLabel,phone:candidate.phone,verification:'stored_message'}));
      const continuing=append&&!!prior?.nextBefore,validationIncomplete=originals.length!==result.messages.length||continuing&&prior.validationIncomplete===true;
      u.comparisonOriginals??={};const messages=mergeConversationRows(continuing?list(prior.messages):[],originals),loaded={...result,messages,validationIncomplete};u.comparisonOriginals[candidate.threadId]=loaded;
      // The same authenticated original must be available both to the bubble UI
      // and to field validation before the operator saves the refreshed proposal.
      selectedEdit.evidence=mergeConversationRows(selectedEdit.evidence.map(row=>row.verification==='stored_message'&&!row.sourceId&&evidenceSourceId(selectedEdit,row)?{...row,sourceId:evidenceSourceId(selectedEdit,row)}:row),originals);
      selectedEdit.consultationSourceCoverage??={};selectedEdit.consultationSourceCoverage[candidate.threadId]={complete:!result.nextBefore&&!validationIncomplete,loadedMessages:messages.length};
      if(!candidate.originalOnly){
        initializeActiveProposal(u,list(u.detail?.reviews).find(review=>keyFor(review)===u.activeKey),{bookingContext,customerContext:result,afterSourceLoad:true});
        enrichInstructorHistory(selectedEdit,candidateIndex,{bookingContext,customerContext:result});
      }
      return loaded;
    }catch(error){if(current()&&u.activeKey===key&&request===u.comparisonRequest)u.comparisonError=safeError(error,'상담 원문을 불러오지 못했습니다.');}
    finally{if(current()&&request===u.comparisonRequest){u.comparisonLoading='';paint();}}
  };
  const checkSourceFreshness=async()=>{
    const selectedEdit=activeEdit(u),key=freshnessKey(selectedEdit);
    if(!current()||blocked()||!key||selectedEdit.status!=='draft'||!selectedEdit.payerName.trim())return;
    u.sourceFreshness??={};if(u.sourceFreshness[key])return;
    u.sourceFreshness[key]={status:'loading'};paint();
    try{
      const result=await onAction('find-candidates',{payerName:selectedEdit.payerName.trim(),amount:selectedEdit.amount,...(selectedEdit.draft.phone?{phone:selectedEdit.draft.phone}:{})});
      if(!current())return;
      if(!Array.isArray(result?.candidates))throw Error('문자 후보를 확인하지 못했습니다.');
      u.sourceFreshness[key]={status:'ready',candidates:result.candidates};
    }catch{if(current())u.sourceFreshness[key]={status:'failed'};}
    finally{if(current()&&selectedEdit===activeEdit(u))paint();}
  };
  // 상담 원문 자동 표시(2026-11-15): 분석이 근거를 못 붙인 검토(예약 변경·날짜 미정 수강권 등)도
  // 입금자·금액·번호로 후보를 자동 조회하고, 검토 번호와 같은 번호의 최근 대화는 바로 불러온다.
  // 번호가 다른 후보는 목록만 보여 주고 신원 확정(선택)은 담당자가 한다.
  const autoConversation=async()=>{
    const selectedEdit=activeEdit(u);
    if(!current()||blocked()||!selectedEdit)return;
    // 근거가 하나라도 연결돼 있으면 기존 로딩 동작을 그대로 둔다.
    // 여기는 "연결된 상담 원문이 없습니다"로 끝나던 빈 검토 전용이다.
    if(originalSources(u,selectedEdit).length)return;
    u.autoCandidateTried??={};const key=u.activeKey;
    if(u.autoCandidateTried[key]||u.candidateSearched||u.candidateLoading||!selectedEdit.payerName?.trim())return;
    u.autoCandidateTried[key]=true;
    try{
      const seeded=u.sourceFreshness?.[freshnessKey(selectedEdit)];
      const result=seeded?.status==='ready'?{candidates:seeded.candidates}:await onAction('find-candidates',{payerName:selectedEdit.payerName.trim(),amount:selectedEdit.amount,...(selectedEdit.draft.phone?{phone:selectedEdit.draft.phone}:{})});
      if(!current()||u.activeKey!==key||selectedEdit!==activeEdit(u)||!Array.isArray(result?.candidates))return;
      u.candidates=result.candidates;u.candidateSearched=true;u.selectedCandidate=null;
      u.openPanels??={};u.openPanels.conversation=true;if(result.candidates.length)u.openPanels.candidate=true;
      const sources=originalSources(u,selectedEdit);
      if(sources.length){u.comparisonActiveIndex=0;paint();await loadComparisonOriginals(0);}
      else paint();
    }catch{}
  };
  const scrollSection=section=>{
    const selector={bank:'[data-pr-section="bank"]',conversation:'[data-pr-section="conversation"]',results:'[data-pr-section="results"]',intake:'[data-pr-section="intake"]'}[section];if(!selector)return;
    const target=root.querySelector(selector);if(!target)return;
    if(['bank','conversation','results'].includes(section)){u.openPanels??={};u.openPanels[section]=true;target.open=true;}
    u.sectionNavigation=(u.sectionNavigation||0)+1;target.scrollIntoView?.({block:'start',behavior:'auto'});target.focus?.({preventScroll:true});
  };
  root.querySelectorAll('[data-pr-jump]').forEach(button=>button.addEventListener('click',()=>{if(current()&&!blocked()&&!u.detailLoading)scrollSection(button.dataset.prJump);}));
  const loadDetail=async(uploadId,{preserveFeedback=false,section='',targetKey=''}={})=>{
    if(!current()||blocked()||!preserveCurrent())return;
    const previous=u.selectedUploadId===uploadId?u.detail:null,previousKey=u.activeKey;
    u.savedRecords=null;const request=++u.detailRequest;u.openPanels??={};u.openPanels.tools=false;u.selectedUploadId=uploadId;u.detailLoading=true;u.detailError='';u.previewRequest++;u.previewLoading=false;u.previewError='';u.previewFailedUrl='';u.previewAutoRetried=false;u.detail=previous;u.activeKey=previous?previousKey:'';if(!preserveFeedback)u.error='';u.reviewError='';u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.candidateSearched=false;u.selectedCandidate=null;paint();
    try{
      const result=await onAction('upload-detail',{uploadId});
      if(!current()||request!==u.detailRequest||u.selectedUploadId!==uploadId)return;
      if(result?.upload?.id!==uploadId||!Array.isArray(result.reviews))throw Error('선택한 캡처 정보를 확인하지 못했습니다.');
      // Unsaved manually added rows have no server ID yet. Keep them selectable
      // when returning to their capture, including after a server refresh.
      const localRows=Object.values(u.edits).filter(edit=>!edit.id&&edit.uploadId===uploadId&&edit.dirty).map(edit=>({rowKey:edit.rowKey,uploadId,status:'draft',payerName:edit.payerName,amount:edit.amount,draft:edit.draft}));
      u.detail={...result,reviews:[...result.reviews,...localRows.filter(local=>!result.reviews.some(row=>row.rowKey===local.rowKey))]};
      for(const review of result.reviews)editOf(u,review);
      if(previous&&['running','succeeded','failed'].includes(result.upload.analysisStatus)){
        if(result.upload.analysisStatus==='failed'){u.notice='';if(!u.error)u.error=actionError(result.upload.analysisError||result.upload.analysisErrorCode,'자동 분석에 실패했습니다. 다시 시도해 주세요.');}
        else if(!u.error)u.notice=analysisMessage(result.upload,result.reviews);
      }
      const targeted=targetKey?u.detail.reviews.find(review=>review.rowKey===targetKey):null;
      u.activeKey=targeted?keyFor(targeted):u.detail.reviews.some(review=>keyFor(review)===previousKey)?previousKey:u.detail.reviews.length?keyFor(u.detail.reviews.find(review=>review.status==='draft')||u.detail.reviews[0]):'';
      initializeActiveProposal(u,result.reviews.find(review=>keyFor(review)===u.activeKey),{bookingContext});
      if(activeEdit(u)?.remoteCommitted&&activeEdit(u).dirty)u.reviewError='다른 작업에서 이미 예약·수강권에 반영한 검토입니다. 입력한 수정 내용은 보존했지만 추가 저장·승인은 할 수 없습니다. 확인 후 수정 취소를 눌러 서버 내용을 다시 보세요.';
    }catch(error){if(current()&&request===u.detailRequest){u.detailError=safeError(error,'캡처를 불러오지 못했습니다.');u.error=u.detailError;}}
    finally{if(current()&&request===u.detailRequest){
      const indexes=proposalCandidateIndexes(activeEdit(u)?.draft.paymentComparison),sourceIndex=indexes.length===1?indexes[0]:0;
      u.detailLoading=false;u.comparisonActiveIndex=sourceIndex;paint();
      const destination=section==='results'?'intake':section,candidate=list(activeEdit(u)?.draft.paymentComparison?.candidates)[sourceIndex],waitingForOriginals=!!(candidate?.sourceId&&candidate.phone);
      if(destination&&u.detail?.upload?.id===uploadId)scrollSection(destination);else root.querySelector('.pr-detail')?.scrollIntoView?.({block:'start',behavior:'auto'});
      const navigation=u.sectionNavigation||0;
      await Promise.allSettled([waitingForOriginals?loadComparisonOriginals(sourceIndex):Promise.resolve(),checkSourceFreshness()]);
      if(current()&&request===u.detailRequest&&u.selectedUploadId===uploadId)void autoConversation().catch(()=>{});
      // Mobile stacks the conversation above the result. Its asynchronous load
      // must not move the requested result off screen; honor a later user jump.
      if(destination&&waitingForOriginals&&current()&&request===u.detailRequest&&u.selectedUploadId===uploadId&&navigation===(u.sectionNavigation||0))scrollSection(destination);
    }}
  };
  const runUploads=async()=>{
    if(!current()||blocked())return;
    u.uploading=true;u.error='';let completed=0,lastUploadId='';paint();
    try{
      for(const item of u.files.filter(row=>row.status!=='ready')){
        if(!current())return;
        item.status='uploading';u.notice=`캡처 ${u.files.indexOf(item)+1}/${u.files.length} 전송 중…`;paint();
        try{
          const result=await uploadPaymentScreenshot(item.file,{requestId:item.requestId,onAction,upload,crypto,isCurrent:current});
          if(!current()||result?.discarded)return;
          item.status='ready';item.error='';item.uploadId=result.upload.id;lastUploadId=result.upload.id;completed++;u.selectedUploads[result.upload.id]=result.upload;if(!u.selectedUploadIds.includes(result.upload.id)&&u.selectedUploadIds.length<MAX_BATCH_UPLOADS)u.selectedUploadIds.push(result.upload.id);
        }catch(error){item.status='failed';item.error=safeError(error,'캡처를 저장하지 못했습니다.');if(current())u.error=`${item.file.name}: ${item.error}`;}
      }
      if(current())u.notice=`캡처 ${u.files.filter(row=>row.status==='ready').length}건 저장 완료. 선택한 사진을 한 번에 분석해 검토 초안을 만드세요.`;
    }finally{u.uploading=false;if(current()){if(lastUploadId)u.offset=0;paint();refresh();if(lastUploadId&&!dirty())void loadDetail(lastUploadId);}}
  };
  root.querySelector('[data-pr-file]')?.addEventListener('change',async event=>{
    if(!current()||blocked()||!preserveCurrent())return;
    const files=[...(event.currentTarget.files||[])];if(!files.length)return;
    if(files.length>MAX_BATCH_UPLOADS){u.error='캡처는 한 번에 12개까지 선택해 주세요.';paint();return;}
    for(const file of files)if(!IMAGE_TYPES.has(file.type)||file.size<1||file.size>MAX_IMAGE_BYTES){u.error='PNG·JPG·WebP 캡처를 파일당 8 MB 이하로 선택해 주세요.';paint();return;}
    u.files=files.map(file=>({file,requestId:crypto.randomUUID(),status:'pending'}));await runUploads();
  });
  root.querySelector('[data-pr-retry-uploads]')?.addEventListener('click',()=>runUploads());
  root.querySelector('[data-pr-refresh]')?.addEventListener('click',async()=>{if(!current()||blocked())return;captureCurrent();if(!preserveCurrent())return;const uploadId=u.selectedUploadId;await refresh();if(current()&&u.selectedUploadId===uploadId&&uploadId)await loadDetail(uploadId);});
  const refreshSavedResult=()=>{if(!current()||blocked()||u.detailLoading)return;captureCurrent();if(u.selectedUploadId)return loadDetail(u.selectedUploadId,{section:'intake'});};
  root.querySelector('[data-pr-detail-refresh]')?.addEventListener('click',refreshSavedResult);
  const captureCurrent=()=>{const edit=activeEdit(u);if(edit&&captureForm(root.querySelector('[data-pr-review-form]'),edit))invalidate(edit);};
  const refreshPreview=async()=>{
    if(!current()||blocked()||u.previewLoading||u.detailLoading)return;
    const detail=u.detail,uploadId=detail?.upload?.id,detailRequest=u.detailRequest;
    if(!uploadId||uploadId!==u.selectedUploadId||detail.upload.deletingAt)return;
    captureCurrent();
    const request=++u.previewRequest,selected=()=>current()&&request===u.previewRequest&&detailRequest===u.detailRequest&&u.detail===detail&&u.selectedUploadId===uploadId;
    u.previewLoading=true;u.previewError='';paint();
    try{
      const result=await onAction('upload-detail',{uploadId});
      if(!selected())return;
      if(result?.upload?.id!==uploadId||result.upload.deletingAt||!result.imageUrl)throw Error('사진 열람 주소를 확인하지 못했습니다. 다시 불러와 주세요.');
      // Renew only the signed image URL. In-progress review edits and human
      // checkboxes must survive this read, including changes made while waiting.
      detail.imageUrl=checkedPaymentImageUrl(result.imageUrl);u.previewFailedUrl='';
    }catch(error){if(selected())u.previewError=safeError(error,'사진을 불러오지 못했습니다. 연결을 확인하고 다시 불러와 주세요.');}
    finally{if(selected()){u.previewLoading=false;paint();}}
  };
  root.querySelector('[data-pr-image-refresh]')?.addEventListener('click',()=>{if(current()){u.previewAutoRetried=true;return refreshPreview();}});
  const bankImage=root.querySelector('[data-pr-bank-image]'),boundImageUrl=u.detail?.imageUrl;
  bankImage?.addEventListener('error',()=>{
    if(!current()||blocked()||u.detailLoading||bankImage.isConnected===false||!boundImageUrl||u.detail?.imageUrl!==boundImageUrl||u.previewFailedUrl===boundImageUrl)return;
    captureCurrent();u.previewFailedUrl=boundImageUrl;
    if(u.previewAutoRetried){u.previewError='사진을 표시하지 못했습니다. 사진 다시 불러오기를 눌러 주세요.';paint();return;}
    u.previewAutoRetried=true;void refreshPreview();
  });
  const discardUnsaved=()=>{for(const [key,edit] of Object.entries(u.edits))if(edit.dirty){delete u.edits[key];const original=list(u.detail?.reviews).find(row=>keyFor(row)===key);if(original)editOf(u,original);}if(!u.edits[u.activeKey]){const first=list(u.detail?.reviews)[0];u.activeKey=first?keyFor(first):'';}};
  const updateQueue=upload=>{u.selectedUploads[upload.id]={...u.selectedUploads[upload.id],...upload};const index=list(data.uploads).findIndex(row=>row.id===upload.id);if(index>=0)data.uploads[index]={...data.uploads[index],...upload};};
  const knownUpload=id=>list(data.uploads).find(row=>row.id===id)||u.selectedUploads[id]||(u.detail?.upload?.id===id?u.detail.upload:null);
  root.querySelectorAll('[data-pr-select-upload]').forEach(input=>input.addEventListener('change',()=>{
    if(!current()||blocked())return;
    const id=input.dataset.prSelectUpload,upload=knownUpload(id);if(!batchEligible(upload)){input.checked=false;return;}
    if(input.checked){if(!u.selectedUploadIds.includes(id)){if(u.selectedUploadIds.length>=MAX_BATCH_UPLOADS){input.checked=false;u.error='한 번에 12장까지 함께 분석할 수 있습니다.';paint();return;}u.selectedUploadIds.push(id);}u.selectedUploads[id]=upload;}
    else u.selectedUploadIds=u.selectedUploadIds.filter(value=>value!==id);
    u.error='';paint();
  }));
  root.querySelector('[data-pr-select-all]')?.addEventListener('click',()=>{
    if(!current()||blocked())return;
    for(const upload of visibleQueueUploads(data,u.filter))if(batchEligible(upload)&&!u.selectedUploadIds.includes(upload.id)&&u.selectedUploadIds.length<MAX_BATCH_UPLOADS){u.selectedUploadIds.push(upload.id);u.selectedUploads[upload.id]=upload;}
    u.error='';u.notice=`${u.selectedUploadIds.length}장 선택했습니다. 선택한 사진을 한 번에 분석하세요.`;paint();
  });
  root.querySelector('[data-pr-clear-selection]')?.addEventListener('click',()=>{if(current()&&!blocked()){u.selectedUploadIds=[];paint();}});
  const adoptBatchResult=result=>{
    updateQueue(result.upload);
    if(u.detail?.upload?.id!==result.upload.id)return;
    u.detail={...u.detail,upload:{...u.detail.upload,...result.upload}};
    if(Array.isArray(result.reviews))for(const review of result.reviews){
      if(!review||typeof review.id!=='string'||!Number.isSafeInteger(review.version))continue;
      const index=u.detail.reviews.findIndex(row=>row.id===review.id);if(index>=0)u.detail.reviews[index]=review;else u.detail.reviews.push(review);
      if(!u.edits[review.id]?.dirty){delete u.edits[review.id];editOf(u,review);}
    }
    if(!u.activeKey&&u.detail.reviews.length)u.activeKey=keyFor(u.detail.reviews.find(review=>review.status==='draft')||u.detail.reviews[0]);
  };
  const runBatch=async({refreshAnalysis=false}={})=>{
    if(!current()||blocked()||u.detailLoading)return;
    const uploadIds=[...new Set(u.selectedUploadIds)];
    if(!uploadIds.length||uploadIds.length>MAX_BATCH_UPLOADS){u.error='함께 분석할 사진을 1~12장 선택해 주세요.';paint();return;}
    const selected=uploadIds.map(knownUpload);if(selected.some(upload=>!batchEligible(upload))){u.error='업로드가 완료된 사진만 선택해 주세요. 삭제 중인 사진은 선택할 수 없습니다.';paint();return;}
    if(refreshAnalysis&&sameUploadSet(u.batchUploadIds,uploadIds)&&u.batchResults.some(row=>!row.matched)){u.error='진행 중인 대조는 선택 사진 이어서 분석으로 마무리해 주세요.';paint();return;}
    if(refreshAnalysis&&!selected.every(completedBatchUpload)){u.error='분석이 완료된 사진을 선택한 뒤 최신 상담을 다시 대조해 주세요.';paint();return;}
    captureCurrent(); // Batch results are separate from preserved local edits.
    const incompleteBatch=sameUploadSet(u.batchUploadIds,uploadIds)&&u.batchResults.some(row=>!row.matched);
    if(!refreshAnalysis&&!incompleteBatch&&(selected.every(completedBatchUpload)||sameUploadSet(u.batchUploadIds,uploadIds)&&u.batchResults.length===uploadIds.length&&u.batchResults.every(row=>row.matched))){
      u.error='';u.notice='저장된 분석 결과를 새로 불러옵니다. 원본과 최신 상담을 새로 분석하려면 선택 사진 AI 다시 분석을 누르세요.';paint();await refresh();if(uploadIds.includes(u.selectedUploadId))await loadDetail(u.selectedUploadId,{preserveFeedback:true,section:'intake'});return;
    }
    if(refreshAnalysis||!sameUploadSet(u.batchUploadIds,uploadIds)){
      u.batchUploadIds=[...uploadIds];u.batchResults=selected.map(upload=>({uploadId:upload.id,name:upload.name,status:'pending',phase:'extract',requestId:crypto.randomUUID(),matched:false,rescan:(refreshAnalysis||upload.analysisStatus==='succeeded')&&!protectedUpload({upload,reviews:u.detail?.upload?.id===upload.id?u.detail.reviews:[]})}));
    }
    const request=++u.batchRequest,active=()=>current()&&request===u.batchRequest&&sameUploadSet(u.selectedUploadIds,uploadIds);u.busy=true;u.batchPhase='extract';u.error='';u.notice='';u.reviewError='';paint();
    try{
      let ready=true;
      for(const row of u.batchResults){
        if(!active())return;
        row.error='';row.phase='extract';if(!row.matched)row.status='extracting';paint();
        try{
          const result=await onAction('upload-analyze-extract',{uploadId:row.uploadId});if(!active())return;
          if(result?.upload?.id!==row.uploadId||!['ready','running'].includes(result?.extraction?.status))throw Error('은행 내역 읽기 결과를 확인하지 못했습니다.');
          updateQueue(result.upload);
          if(result.extraction.status==='ready'){row.status=row.matched?'succeeded':'extracted';row.error='';}
          else{ready=false;row.status='running';row.error='다른 분석이 진행 중입니다. 잠시 후 같은 선택으로 이어서 분석하세요.';}
        }catch(error){if(!active())return;ready=false;row.status='failed';row.error=actionError(error,'은행 내역을 읽지 못했습니다. 다시 시도해 주세요.');row.errorCode=error?.code||'ANALYSIS_FAILED';}
        paint();
      }
      if(!ready){u.error=actionErrors.ANALYSIS_BATCH_INCOMPLETE;return;}
      u.batchPhase='match';paint();
      for(const row of u.batchResults){
        if(!active())return;if(row.matched){row.status='succeeded';continue;}
        row.phase='match';row.status='matching';row.error='';paint();
        try{
          const result=await onAction('upload-analyze-match',{uploadId:row.uploadId,uploadIds:[...uploadIds],requestId:row.requestId,...(row.rescan?{rescan:true}:{})});if(!active())return;
          const status=result?.analysis?.status||result?.upload?.analysisStatus;
          if(result?.upload?.id!==row.uploadId||!['succeeded','running','failed'].includes(status)||(result.upload.analysisStatus&&result.upload.analysisStatus!==status&&!(result.preserved===true&&status==='succeeded'))||(result.reviews!==undefined&&!Array.isArray(result.reviews)))throw Error('상담·합산 대조 결과를 확인하지 못했습니다.');
          adoptBatchResult(result);row.status=status;row.matched=status==='succeeded';row.preserved=result.preserved===true;row.preservedCount=Number.isSafeInteger(result.preservedCount)&&result.preservedCount>=0?result.preservedCount:0;
          if(status==='failed'){row.errorCode=result.analysis?.errorCode||result.upload.analysisErrorCode;row.error=actionError(result.analysis?.error||row.errorCode,'상담·합산 대조에 실패했습니다. 같은 선택으로 이어서 분석하세요.');}
          if(status==='running')row.error='서버에서 처리 중입니다. 잠시 후 같은 선택으로 이어서 분석하세요.';
          // 간헐 오류(응답 검증 실패·시간 초과)는 자동으로 한 번 더 — 새 호출이라 150초 예산도 새로 받는다.
          if(row.status==='failed'&&!row.autoRetried&&['ANALYSIS_CONSULTATION_INVALID_RESPONSE','ANALYSIS_TIMEOUT','ANALYSIS_FAILED'].includes(String(row.errorCode||''))){
            row.autoRetried=true;row.status='matching';row.error='대조가 불안정해 자동으로 한 번 더 시도합니다…';paint();
            const retryResult=await onAction('upload-analyze-match',{uploadId:row.uploadId,uploadIds:[...uploadIds],requestId:crypto.randomUUID()});if(!active())return;
            const retryStatus=retryResult?.analysis?.status||retryResult?.upload?.analysisStatus;
            if(retryResult?.upload?.id===row.uploadId&&['succeeded','running','failed'].includes(retryStatus)&&(retryResult.reviews===undefined||Array.isArray(retryResult.reviews))){
              adoptBatchResult(retryResult);row.status=retryStatus;row.matched=retryStatus==='succeeded';row.preserved=retryResult.preserved===true;row.preservedCount=Number.isSafeInteger(retryResult.preservedCount)&&retryResult.preservedCount>=0?retryResult.preservedCount:0;
              if(retryStatus==='failed'){row.errorCode=retryResult.analysis?.errorCode||retryResult.upload.analysisErrorCode;row.error=actionError(retryResult.analysis?.error||row.errorCode,'상담·합산 대조에 실패했습니다. 같은 선택으로 이어서 분석하세요.');}
              else row.error=retryStatus==='running'?'서버에서 처리 중입니다. 잠시 후 같은 선택으로 이어서 분석하세요.':'';
            }else{row.status='failed';row.error=actionError(row.errorCode,'상담·합산 대조에 실패했습니다. 같은 선택으로 이어서 분석하세요.');}
          }
        }catch(error){if(!active())return;row.status='failed';row.errorCode=error?.code||'ANALYSIS_FAILED';row.error=actionError(error,'상담·합산 대조에 실패했습니다. 같은 선택으로 이어서 분석하세요.');}
        paint();
      }
    }finally{
      u.busy=false;u.batchPhase='';
      if(active()){
        const count=u.batchResults.filter(row=>row.status==='succeeded').length,notice=`선택한 ${uploadIds.length}장 중 ${count}장 분석 완료. ${count===uploadIds.length?'사진별 검토 내용을 확인하고 예약 작성을 눌러 주세요.':'사진별 상태를 확인하고 같은 선택으로 이어서 분석하세요.'}`;
        u.notice=notice;if(count===uploadIds.length){u.openPanels??={};u.openPanels.tools=false;}paint();refresh();
        if(uploadIds.includes(u.selectedUploadId)){if(!dirty())await loadDetail(u.selectedUploadId,{preserveFeedback:true});else{u.comparisonOriginals={};u.comparisonActiveIndex=0;if(list(activeEdit(u)?.draft.paymentComparison?.candidates).length)await loadComparisonOriginals(0);}}
        if(active()){u.openPanels??={};u.openPanels.tools=count!==uploadIds.length;u.notice=notice;paint();}
      }
    }
  };
  root.querySelector('[data-pr-analyze-batch]')?.addEventListener('click',()=>runBatch());
  const reanalyzeCaptures=async uploadIds=>{
    if(!current()||blocked()||u.detailLoading)return;
    const ids=[...new Set(uploadIds)].filter(Boolean),uploads=ids.map(knownUpload);
    if(!ids.length||ids.length>MAX_BATCH_UPLOADS||uploads.some(upload=>!batchEligible(upload)||upload.analysisStatus==='running'&&!analysisExpired(upload)))return;
    captureCurrent();
    const selectedUploadId=u.selectedUploadId,request=(u.uploadAnalysisRequest||0)+1;u.uploadAnalysisRequest=request;
    const active=()=>current()&&request===u.uploadAnalysisRequest&&u.selectedUploadId===selectedUploadId;
    u.uploadAnalysisPreviews??={};u.uploadAnalysisErrors??={};u.uploadAnalysisRunningIds=ids;u.latestUploadAnalysis=null;
    for(const id of ids){delete u.uploadAnalysisPreviews[id];delete u.uploadAnalysisErrors[id];}
    u.busy=true;u.error='';u.notice='';paint();let completed=0,filled=false;
    try{
      for(const uploadId of ids){
        if(!active())return;
        try{
          const result=await onAction('upload-reanalyze',{uploadId});if(!active())return;
          if(result?.uploadId!==uploadId||result.bankSource!=='verified_image'||result.readOnly!==true||!['drafts','not_bank','no_deposits','needs_review'].includes(result.outcome)||!Array.isArray(result.proposals)||result.proposals.length>12)throw Error('새 원본 분석 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
          const edit=activeEdit(u),matches=result.proposals.map((proposal,index)=>({proposal,index})).filter(({proposal})=>edit&&proposal.payerName===edit.payerName&&proposal.amount===edit.amount&&String(proposal.transactionDate||'')===String(edit.transactionDate||'')),preview={...result,selectedIndex:matches.length===1?matches[0].index:0};u.uploadAnalysisPreviews[uploadId]=preview;u.latestUploadAnalysis=preview;completed++;
          if(uploadId===u.selectedUploadId&&matches.length===1)filled=await applyAutomaticAnalysisTeams('upload')||filled;
        }catch(error){
          if(!active())return;
          u.error=actionError(error,'원본 사진과 최신 상담을 다시 분석하지 못했습니다. 다시 시도해 주세요.');u.uploadAnalysisErrors[uploadId]=u.error;
          if(error?.code==='ANALYSIS_QUOTA_EXCEEDED')break;
        }
        paint();
      }
      if(active()&&completed&&!filled&&!u.reviewError)u.notice=`원본 사진 ${completed}/${ids.length}장을 새로 분석했습니다. 상담 출처 또는 입금 내역을 확인해야 하는 결과는 아래에 표시했습니다.`;
    }finally{u.busy=false;u.uploadAnalysisRunningIds=[];if(active()){paint();if(filled)scrollSection('intake');else root.querySelector('[data-pr-upload-analysis]')?.scrollIntoView?.({block:'start',behavior:'smooth'});}}
  };
  root.querySelector('[data-pr-upload-reanalyze]')?.addEventListener('click',()=>reanalyzeCaptures([u.detail?.upload?.id]));
  root.querySelector('[data-pr-reanalyze-batch]')?.addEventListener('click',()=>reanalyzeCaptures(u.selectedUploadIds));
  root.querySelector('[data-pr-upload-analysis-row]')?.addEventListener('change',event=>{
    if(!current()||blocked())return;const preview=u.uploadAnalysisPreviews?.[u.detail?.upload?.id],index=Number(event.target.value);
    if(!preview||!Number.isSafeInteger(index)||!preview.proposals[index])return;preview.selectedIndex=index;u.latestUploadAnalysis=preview;paint();
  });
  const applyNewAnalysisTeams=async(kind,candidateIndex,{withinAnalysis=false}={})=>{
    if(!current()||blocked()&&!withinAnalysis||!Number.isSafeInteger(candidateIndex))return false;
    captureCurrent();const edit=activeEdit(u),uploadId=u.detail?.upload?.id;
    const preview=u.uploadAnalysisPreviews?.[uploadId],result=kind==='latest'?latestProposalFor(u,edit):{reviewId:edit?.id,expectedVersion:edit?.version,proposal:preview?.proposals?.[preview.selectedIndex||0]};
    const candidate=result?.proposal?.draft?.paymentComparison?.candidates?.[candidateIndex];
    if(!edit||edit.status!=='draft'||!candidate)return false;
    const key=u.activeKey,version=edit.version,before=JSON.stringify(edit.draft),saved=list(u.detail?.reviews).find(row=>row.id===edit.id);
    const baselineMatches=edit.analysisAppliedBaseline===JSON.stringify(serializePaymentIntake(edit.draft));
    const humanEdited=!baselineMatches&&(typeof edit.analysisAppliedBaseline==='string'||edit.staffEdited||!Number.isSafeInteger(saved?.analysisGeneratedVersion)||saved.version!==saved.analysisGeneratedVersion||text(edit.manualReason).trim()||edit.dirty&&!edit.defaultedNames&&!edit.proposalAutoInitialized);
    const count=list(result.proposal.draft.paymentComparison.consultation?.teams).filter(team=>team.threadId===candidate.threadId).length;
    if(humanEdited&&!confirm(`직접 입력한 팀·회차 내용을 새 분석의 ${count}팀 전체로 바꿀까요? 모든 날짜·강습정보·입금 배분 초안을 함께 채웁니다. 은행 내역과 고객·확인 메모는 유지합니다.`)){u.notice='직접 입력한 내용을 유지했습니다. 새 분석 근거는 아래에서 확인할 수 있습니다.';return false;}
    const staged={...edit,draft:normalizePaymentDraft(edit.draft),evidence:[...edit.evidence],evidenceRefs:[...edit.evidenceRefs]};
    if(!applyLatestPaymentProposal(staged,result)){u.reviewError='새 분석과 현재 검토의 입금자·금액·시각 또는 버전이 다릅니다. 원본을 먼저 대조해 주세요.';paint();return false;}
    u.busy=true;u.error='';u.reviewError='';paint();
    try{
      let customerContext=null;
      if(candidate.sourceId&&candidate.phone){
        const originals=await onAction('conversation-detail',{sourceId:candidate.sourceId,phone:candidate.phone,limit:100});
        if(originals?.sourceId!==candidate.sourceId||originals?.phone!==candidate.phone||!Array.isArray(originals.messages))throw Error('새 분석에 연결된 상담 원문을 확인하지 못했습니다.');
        const messages=originals.messages.filter(row=>/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/i.test(row.id||row.messageId||'')&&typeof row.text==='string'&&(!row.sourceId||row.sourceId===candidate.sourceId)&&(!row.phone||phoneKey(row.phone)===phoneKey(candidate.phone))).map(row=>({...row,sourceId:candidate.sourceId,sourceLabel:candidate.sourceLabel,phone:candidate.phone,verification:'stored_message'}));
        staged.evidence=mergeConversationRows(staged.evidence,messages);
        customerContext=originals;
      }
      if(!current()||u.selectedUploadId!==uploadId||u.activeKey!==key||activeEdit(u)!==edit||edit.version!==version)return;
      if(before!==JSON.stringify(edit.draft))throw Error('원문을 불러오는 동안 작성 내용이 바뀌었습니다. 현재 내용을 확인하고 다시 적용해 주세요.');
      const applied=applyPaymentCandidateTeams(staged,candidateIndex,{bookingContext,customerContext});
      Object.assign(edit,{draft:staged.draft,evidence:staged.evidence,evidenceRefs:staged.evidenceRefs,dirty:true,checks:{bank:false,customer:false,details:false},staffEdited:false,proposalAutoInitialized:true});
      edit.analysisAppliedBaseline=JSON.stringify(serializePaymentIntake(edit.draft));
      u.latestProposal=null;u.comparisonOriginals={};u.comparisonActiveIndex=candidateIndex;u.intakeCalendarOpen=false;
      if(kind==='upload'&&u.uploadAnalysisPreviews)delete u.uploadAnalysisPreviews[uploadId];
      const sessionCount=paymentIntakeTeams(edit.draft).reduce((total,team)=>total+team.sessions.length,0);
      u.notice=`새 분석의 ${applied.teamCount}팀 · ${sessionCount}회차를 작성란에 모두 채웠습니다. 날짜·강습정보·입금 배분을 확인하고 예약을 저장하세요.${applied.notesOmitted?' 메모 길이 제한으로 일부 상담 메모는 원문에서 확인해 주세요.':''}${applied.skippedFields?' 근거가 부족하거나 상충하는 항목은 미확인으로 표시했습니다.':''}`;
      u.openPanels??={};u.openPanels.results=false;
      return true;
    }catch(error){if(current()&&activeEdit(u)===edit)u.reviewError=safeError(error,'새 분석의 팀·강습 내용을 적용하지 못했습니다. 기존 작성 내용은 유지했습니다.');return false;}
    finally{if(!withinAnalysis)u.busy=false;if(current()&&activeEdit(u)===edit){paint();if(!u.reviewError)scrollSection('intake');}}
  };
  const applyAutomaticAnalysisTeams=async kind=>{
    const edit=activeEdit(u),preview=u.uploadAnalysisPreviews?.[u.detail?.upload?.id],proposal=kind==='latest'?latestProposalFor(u,edit)?.proposal:preview?.proposals?.[preview.selectedIndex||0],comparison=proposal?.draft?.paymentComparison;
    if(!edit||edit.status!=='draft'||!comparison)return false;
    const indexes=proposalCandidateIndexes(comparison);
    if(indexes.length!==1){u.reviewError=indexes.length?'서로 다른 상담 출처에 강습 제안이 있습니다. 해당 고객의 상담 출처를 한 번 선택해 주세요.':'새 분석에서 작성할 팀·날짜를 확인하지 못했습니다. 원문 근거를 확인해 주세요.';return false;}
    return applyNewAnalysisTeams(kind,indexes[0],{withinAnalysis:true});
  };
  root.querySelectorAll('[data-pr-apply-latest-teams]').forEach(button=>button.addEventListener('click',()=>applyNewAnalysisTeams('latest',Number(button.dataset.prApplyLatestTeams))));
  root.querySelectorAll('[data-pr-apply-upload-teams]').forEach(button=>button.addEventListener('click',()=>applyNewAnalysisTeams('upload',Number(button.dataset.prApplyUploadTeams))));
  root.querySelector('[data-pr-apply-upload-analysis]')?.addEventListener('click',()=>{
    if(!current()||blocked())return;captureCurrent();const edit=activeEdit(u),preview=u.uploadAnalysisPreviews?.[u.detail?.upload?.id],proposal=preview?.proposals?.[preview.selectedIndex||0];
    if(!applyLatestPaymentProposal(edit,{reviewId:edit?.id,expectedVersion:edit?.version,proposal})){u.error='새 원본 분석과 현재 검토의 입금자·금액·시각을 먼저 대조해 주세요.';paint();return;}
    u.latestProposal=null;u.comparisonOriginals={};u.comparisonActiveIndex=0;u.candidates=[];u.selectedCandidate=null;u.reviewError='';u.error='';u.notice='새 원본 분석의 상담 근거를 반영했습니다. 직접 입력한 고객·팀·일정·금액은 유지했습니다.';paint();void loadComparisonOriginals(0);
  });
  root.querySelector('[data-pr-dismiss-upload-analysis]')?.addEventListener('click',()=>{
    if(!current()||blocked())return;const uploadId=u.detail?.upload?.id;if(u.uploadAnalysisPreviews)delete u.uploadAnalysisPreviews[uploadId];if(u.latestUploadAnalysis?.uploadId===uploadId)u.latestUploadAnalysis=null;paint();
  });
  // AI 다시 분석은 미리보기만 반환한다(저장본 보호). 검토 초안이 없는 입금은
  // 여기서 초안으로 받아 적어야 저장·승인→예약 작성으로 이어진다. (2026-11-15)
  root.querySelector('[data-pr-adopt-upload-analysis]')?.addEventListener('click',()=>{
    if(!current()||blocked()||!preserveCurrent())return;
    const uploadId=u.detail?.upload?.id,result=u.uploadAnalysisPreviews?.[uploadId];
    if(!uploadId||u.detail?.upload?.status!=='ready'||u.detail.upload.deletingAt||!list(result?.proposals).length)return;
    let firstKey='';
    for(const proposal of list(result.proposals)){
      if(!proposal?.rowKey||proposal.uploadId&&proposal.uploadId!==uploadId)continue;
      if(list(u.detail.reviews).some(row=>row.rowKey===proposal.rowKey))continue;
      // version=analysisGeneratedVersion 표식이 있어야 initializeActiveProposal의 '미수정 생성 초안'
      // 가드를 통과해 팀·회차가 버튼 없이 자동으로 채워진다(2026-11-16). 서버 저장 시 실제 버전으로 대체됨.
      const review=JSON.parse(JSON.stringify({rowKey:proposal.rowKey,status:'draft',version:1,analysisGeneratedVersion:1,payerName:proposal.payerName||'',amount:proposal.amount,transactionDate:proposal.transactionDate??null,draft:proposal.draft,evidenceRefs:list(proposal.evidenceRefs)}));
      const edit=editOf(u,review);edit.dirty=true;
      u.detail.reviews=[...list(u.detail.reviews),review];
      if(!firstKey)firstKey=keyFor(review);
    }
    if(!firstKey){u.notice='읽은 입금마다 이미 검토 초안이 있습니다.';paint();return;}
    u.activeKey=firstKey;initializeActiveProposal(u,list(u.detail.reviews).find(row=>keyFor(row)===firstKey),{bookingContext});
    u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.candidateSearched=false;u.selectedCandidate=null;u.reviewError='';u.comparisonActiveIndex=0;
    u.notice='읽은 입금을 검토 초안으로 만들었습니다. 입금자별 내용을 확인하고 저장·승인하면 예약 작성이 열립니다.';paint();
    void Promise.allSettled([loadComparisonOriginals(0),checkSourceFreshness()]).then(()=>autoConversation());
  });
  const reanalyzeCurrentReview=async()=>{
    if(!current()||blocked()||u.detailLoading)return;
    captureCurrent();
    const edit=activeEdit(u),upload=u.detail?.upload;
    if(!edit?.id||edit.status!=='draft'||upload?.status!=='ready'||upload.deletingAt||upload.analysisStatus==='running')return;
    const reviewId=edit.id,expectedVersion=edit.version,uploadId=upload.id;
    const selected=()=>current()&&u.selectedUploadId===uploadId&&activeEdit(u)?.id===reviewId&&activeEdit(u)?.version===expectedVersion;
    u.busy=true;u.reanalyzingReviewId=reviewId;u.latestProposal=null;u.error='';u.notice='';paint();
    try{
      const result=await onAction('review-reanalyze',{reviewId,expectedVersion});
      if(!selected())return;
      if(result?.reviewId!==reviewId||result.expectedVersion!==expectedVersion||!normalizePaymentDraft(result.proposal?.draft).paymentComparison)throw Error('새 분석 결과를 확인하지 못했습니다. 최신 검토 내용을 다시 불러와 주세요.');
      u.latestProposal=result;
      await applyAutomaticAnalysisTeams('latest');
    }catch(error){if(selected())u.error=actionError(error,'최신 상담을 분석하지 못했습니다. 다시 시도해 주세요.');}
    finally{u.busy=false;u.reanalyzingReviewId='';if(selected()){paint();if(!u.latestProposal)scrollSection('intake');else root.querySelector('.pr-latest-preview')?.scrollIntoView?.({block:'start',behavior:'smooth'});}}
  };
  root.querySelector('[data-pr-review-reanalyze]')?.addEventListener('click',reanalyzeCurrentReview);
  root.querySelector('[data-pr-freshness-reanalyze]')?.addEventListener('click',reanalyzeCurrentReview);
  root.querySelector('[data-pr-apply-latest]')?.addEventListener('click',()=>{
    if(!current()||blocked())return;
    captureCurrent();const edit=activeEdit(u),result=latestProposalFor(u,edit);
    if(!result||!applyLatestPaymentProposal(edit,result)){u.error='입금 정보나 검토 버전이 바뀌었습니다. 저장 후 최신 상담을 다시 분석해 주세요.';paint();return;}
    u.latestProposal=null;u.comparisonOriginals={};u.comparisonActiveIndex=0;u.candidates=[];u.selectedCandidate=null;u.reviewError='';
    u.notice='새 분석 근거를 반영했습니다. 고객·일정·금액 입력은 유지했습니다. 팀 제안을 선택해 검토 내용에 적용한 뒤 저장하고 다시 대조하세요.';
    paint();scrollSection('results');void loadComparisonOriginals(0);
  });
  root.querySelector('[data-pr-dismiss-latest]')?.addEventListener('click',()=>{if(!current()||blocked())return;u.latestProposal=null;u.notice='기존 검토 내용을 유지했습니다.';paint();});
  root.querySelector('[data-pr-analyze]')?.addEventListener('click',async()=>{
    if(!current()||blocked()||u.detailLoading)return;
    const upload=u.detail?.upload,uploadId=upload?.id;
    if(!uploadId||u.selectedUploadId!==uploadId||upload.status!=='ready'||(upload.analysisStatus==='running'&&!analysisExpired(upload))||upload.deletingAt)return;
    captureCurrent();
    if(upload.analysisStatus==='succeeded'||protectedUpload(u.detail)){await refreshSavedResult();return;}
    if(dirty()){
      if(confirm(`“${upload.name||'은행 캡처'}”의 저장하지 않은 수정 내용을 취소하고 ${upload.analysisStatus==='succeeded'?'저장된 분석 결과를 불러올까요?':'자동 분석할까요?'} 저장된 검토 초안은 유지됩니다.`)!==true){paint();return;}
      discardUnsaved();
    }
    const request=++u.detailRequest,selected=()=>current()&&request===u.detailRequest&&u.selectedUploadId===uploadId&&u.detail?.upload?.id===uploadId;
    u.busy=true;u.analyzingUploadId=uploadId;u.error='';u.reviewError='';u.notice='';paint();
    try{
      let result=await onAction('upload-analyze',{uploadId});
      let status=result?.analysis?.status||result?.upload?.analysisStatus;
      // 상담 대조 응답 검증 실패·시간 초과는 모델 간헐 오류가 대부분 — 자동으로 한 번 더
      // 시도한다(새 호출 = 새 150초 예산, 사진·은행 추출은 서버에 보존돼 대조만 다시 수행).
      const retryable=['ANALYSIS_CONSULTATION_INVALID_RESPONSE','ANALYSIS_TIMEOUT','ANALYSIS_FAILED'];
      if(selected()&&status==='failed'&&retryable.includes(String(result?.analysis?.errorCode||result?.analysis?.error||result?.upload?.analysisErrorCode||''))){
        u.notice='상담 대조가 불안정해 자동으로 한 번 더 분석합니다…';paint();
        result=await onAction('upload-analyze',{uploadId});
        status=result?.analysis?.status||result?.upload?.analysisStatus;
      }
      if(!selected())return;
      if(result?.upload?.id!==uploadId||!['succeeded','running','failed'].includes(status)||(result.upload.analysisStatus&&result.upload.analysisStatus!==status)||(result.reviews!==undefined&&!Array.isArray(result.reviews)))throw Error('자동 분석 결과를 확인하지 못했습니다. 상태를 새로고침해 주세요.');
      const nextUpload={...upload,...result.upload,analysisStatus:status,analysisOutcome:result.analysis?.outcome||result.upload.analysisOutcome,analysisError:result.analysis?.error||result.upload.analysisError||result.analysis?.errorCode||result.upload.analysisErrorCode,analysisLeaseExpiresAt:result.analysis?.leaseExpiresAt??result.upload.analysisLeaseExpiresAt};
      u.detail={...u.detail,upload:nextUpload};updateQueue(nextUpload);
      // Analysis can only provide drafts. Human comparison and approval remain separate actions.
      if(Array.isArray(result.reviews)){
        for(const review of result.reviews){if(!review||typeof review.id!=='string'||!Number.isSafeInteger(review.version)||review.status!=='draft')continue;const rows=u.detail.reviews,index=rows.findIndex(row=>row.id===review.id);if(index>=0)rows[index]=review;else rows.push(review);delete u.edits[review.id];editOf(u,review);}
        if(!u.activeKey&&u.detail.reviews.length)u.activeKey=keyFor(u.detail.reviews[0]);
        initializeActiveProposal(u,u.detail.reviews.find(review=>keyFor(review)===u.activeKey),{bookingContext});
      }
      if(status==='failed')u.error=actionError(nextUpload.analysisError||result.analysis,'자동 분석에 실패했습니다. 기존 검토 초안을 확인하거나 다시 시도해 주세요.');
      else u.notice=analysisMessage(nextUpload,u.detail.reviews);
    }catch(error){if(selected())u.error=actionError(error,'자동 분석에 실패했습니다. 다시 시도해 주세요.');}
    finally{
      u.busy=false;u.analyzingUploadId='';
      if(selected()){paint();refresh();if(!dirty())await loadDetail(uploadId,{preserveFeedback:true});else{u.comparisonOriginals={};u.comparisonActiveIndex=0;if(list(activeEdit(u)?.draft.paymentComparison?.candidates).length)await loadComparisonOriginals(0);}}
    }
  });
  const deleteCapture=async uploadId=>{
    if(!current()||blocked()||u.detailLoading)return;
    const selectedUploadId=u.selectedUploadId,detailId=u.detail?.upload?.id,selectedTarget=selectedUploadId===uploadId&&detailId===uploadId;
    let targetDetail=selectedTarget?u.detail:null,upload=targetDetail?.upload||knownUpload(uploadId);
    if(!uploadId||!upload||(upload.analysisStatus==='running'&&!analysisExpired(upload)))return;
    if(deletionProtectedUpload(targetDetail||{upload})){u.error=deletionProtectedMessage;paint();return;}
    captureCurrent();
    const request=++u.detailRequest,selected=()=>current()&&request===u.detailRequest&&u.selectedUploadId===selectedUploadId&&u.detail?.upload?.id===detailId;
    u.busy=true;paint();
    try{
      if(!targetDetail){
        targetDetail=await onAction('upload-detail',{uploadId});if(!selected())return;
        if(targetDetail?.upload?.id!==uploadId||!Array.isArray(targetDetail.reviews))throw Error('삭제할 캡처 상태를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        upload=targetDetail.upload;updateQueue(upload);
        if(upload.analysisStatus==='running'&&!analysisExpired(upload)){u.error='진행 중인 분석을 마친 뒤 캡처를 삭제할 수 있습니다.';return;}
        if(deletionProtectedUpload(targetDetail)){u.error=deletionProtectedMessage;return;}
      }
      const targetDirty=Object.values(u.edits).some(edit=>edit.uploadId===uploadId&&edit.dirty);
      if(confirm(`“${upload.name||'은행 캡처'}” 캡처 이미지를 삭제할까요? 저장된 예약·수강권·입금 배분·검토 이력은 유지됩니다.${targetDirty?' 저장하지 않은 수정 내용은 삭제됩니다.':''} 삭제한 사진은 복구할 수 없습니다.`)!==true)return;
      u.error='';u.notice='';paint();
      const result=await onAction('upload-delete',{uploadId});
      if(!selected())return;
      if(result?.deleted!==true||result.uploadId!==uploadId)throw Error('캡처 삭제 결과를 확인하지 못했습니다. 대기열을 새로고침해 주세요.');
      if(selectedTarget){u.detailRequest++;u.selectedUploadId='';u.detail=null;u.detailLoading=false;u.activeKey='';u.savedRecords=null;u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.candidateLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.candidateRequest=(u.candidateRequest||0)+1;u.reviewError='';}
      const deletedReviews=new Set(list(targetDetail?.reviews).map(review=>review.id));
      for(const [key,edit] of Object.entries(u.edits))if(edit.uploadId===uploadId){deletedReviews.add(edit.id);delete u.edits[key];}
      if(deletedReviews.has(u.approvedHandoff?.paymentReviewId))delete u.approvedHandoff;
      if(u.uploadAnalysisPreviews)delete u.uploadAnalysisPreviews[uploadId];if(u.uploadAnalysisErrors)delete u.uploadAnalysisErrors[uploadId];if(u.latestUploadAnalysis?.uploadId===uploadId)u.latestUploadAnalysis=null;
      if(Array.isArray(data.uploads)){data.uploads=data.uploads.filter(row=>row.id!==uploadId);const countKey=completedReviewUpload(upload)?'completedTotal':'pendingTotal';if(Number.isSafeInteger(data[countKey]))data[countKey]=Math.max(0,data[countKey]-1);if(Number.isSafeInteger(data.total))data.total=Math.max(0,data.total-1);if(u.offset>0&&!data.uploads.length)u.offset=Math.max(0,u.offset-30);}
      for(const file of u.files.filter(row=>row.uploadId===uploadId))if(file.preview)URL.revokeObjectURL(file.preview);
      u.files=u.files.filter(row=>row.uploadId!==uploadId);u.selectedUploadIds=u.selectedUploadIds.filter(id=>id!==uploadId);delete u.selectedUploads[uploadId];u.batchResults=u.batchResults.filter(row=>row.uploadId!==uploadId);u.batchUploadIds=u.batchUploadIds.filter(id=>id!==uploadId);u.notice=`“${upload.name||'은행 캡처'}” 캡처를 삭제했습니다.`;refresh();
    }catch(error){if(selected()){u.error=['UPLOAD_PROTECTED','UPLOAD_IN_USE'].includes(error?.code)?deletionProtectedMessage:actionError(error,'캡처를 삭제하지 못했습니다. 다시 시도해 주세요.');if(['DELETE_FAILED','UPLOAD_DELETING'].includes(error?.code)){u.busy=false;refresh();if(selectedTarget)await loadDetail(uploadId,{preserveFeedback:true});}}}
    finally{u.busy=false;paint();}
  };
  root.querySelector('[data-pr-delete]')?.addEventListener('click',()=>deleteCapture(u.detail?.upload?.id));
  root.querySelectorAll('[data-pr-delete-upload]').forEach(button=>button.addEventListener('click',()=>deleteCapture(button.dataset.prDeleteUpload)));
  const markUploadDone=async(uploadId,done)=>{
    if(!current()||blocked())return;u.busy=true;u.error='';paint();
    try{await onAction('upload-done',{uploadId,done});u.notice=done?'캡처를 저장 완료로 옮겼습니다. 원문 없음 추적에는 그대로 남습니다.':'캡처를 대기열로 되돌렸습니다.';u.busy=false;await refresh();}
    catch(error){u.error=safeError(error,'완료 처리를 저장하지 못했습니다. 다시 시도해 주세요.');u.busy=false;paint();}
  };
  root.querySelectorAll('[data-pr-mark-done]').forEach(button=>button.addEventListener('click',()=>markUploadDone(button.dataset.prMarkDone,true)));
  root.querySelectorAll('[data-pr-mark-undone]').forEach(button=>button.addEventListener('click',()=>markUploadDone(button.dataset.prMarkUndone,false)));
  root.querySelectorAll('[data-pr-upload]').forEach(button=>button.addEventListener('click',()=>{void(async()=>{const uploadId=button.dataset.prUpload;await loadDetail(uploadId);if(current()&&u.filter==='completed'&&u.detail?.upload?.id===uploadId){const review=list(u.detail.reviews).find(row=>keyFor(row)===u.activeKey);if(paymentReviewSaveStatus(review).saved)await openSavedRecords(review.id);}})();}));
  root.querySelectorAll('[data-pr-comparison-upload]').forEach(button=>button.addEventListener('click',()=>{if(!current()||blocked())return;captureCurrent();return loadDetail(button.dataset.prComparisonUpload);}));
  root.querySelectorAll('[data-pr-unmatched]').forEach(button=>button.addEventListener('click',()=>{if(!current()||blocked())return;const value=button.dataset.prUnmatched,separator=value.indexOf(':');if(separator<1)return;captureCurrent();return loadDetail(value.slice(0,separator),{targetKey:value.slice(separator+1)});}));
  root.querySelector('[data-pr-back]')?.addEventListener('click',()=>{if(!current()||blocked()||!preserveCurrent())return;u.detailRequest++;u.previewRequest++;u.selectedUploadId='';u.detail=null;u.detailLoading=false;u.detailError='';u.previewLoading=false;u.previewError='';u.activeKey='';u.savedRecords=null;u.error='';paint();});
  root.querySelectorAll('[data-pr-filter]').forEach(button=>button.addEventListener('click',()=>{if(!current()||blocked()||ui.paymentReviewLoading||!preserveCurrent())return;const filter=['completed','all','unmatched'].includes(button.dataset.prFilter)?button.dataset.prFilter:'pending';if(filter===u.filter)return;u.filter=filter;u.offset=0;u.limit=30;u.savedRecords=null;u.detailRequest++;u.selectedUploadId='';u.detail=null;u.detailLoading=false;u.activeKey='';u.error='';u.reviewError='';paint();void refresh();}));
  root.querySelectorAll('[data-pr-page]').forEach(button=>button.addEventListener('click',()=>{
    if(!current()||blocked()||ui.paymentReviewLoading||!preserveCurrent())return;
    const offset=Number.isSafeInteger(u.offset)&&u.offset>=0?u.offset:0,total=Number.isSafeInteger(data?.total)&&data.total>=0?data.total:list(data?.uploads).length,next=button.dataset.prPage==='next';
    if(next?offset+30>=total:offset===0)return;
    u.offset=next?offset+30:Math.max(0,offset-30);u.limit=30;u.detailRequest++;u.selectedUploadId='';u.detail=null;u.detailLoading=false;u.activeKey='';
    u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.error='';u.reviewError='';paint();refresh();
  }));

  root.querySelectorAll('[data-pr-review]').forEach(button=>button.addEventListener('click',()=>{if(!current()||blocked()||!preserveCurrent())return;const review=list(u.detail?.reviews).find(row=>keyFor(row)===button.dataset.prReview);if(review){u.activeKey=keyFor(review);editOf(u,review);initializeActiveProposal(u,review,{bookingContext});u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.candidateSearched=false;u.selectedCandidate=null;u.reviewError='';u.comparisonActiveIndex=0;u.savedRecords=null;paint();if(paymentReviewSaveStatus(review).saved)void openSavedRecords(review.id);else void Promise.allSettled([loadComparisonOriginals(0),checkSourceFreshness()]).then(()=>autoConversation());}}));
  root.querySelector('[data-pr-new-row]')?.addEventListener('click',()=>{
    if(!current()||blocked()||!preserveCurrent()||u.detail?.upload?.status!=='ready'||u.detail?.upload?.analysisStatus==='running'||u.detail?.upload?.deletingAt)return;
    const rowKey=crypto.randomUUID(),review={rowKey,status:'draft',draft:emptyPaymentDraft()},edit=editOf(u,review);
    edit.dirty=true;u.detail.reviews=[...list(u.detail.reviews),review];u.activeKey=keyFor(review);u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.candidateSearched=false;u.reviewError='';paint();
  });
  root.querySelector('[data-pr-link-status]')?.addEventListener('click',async()=>{
    if(!current()||blocked())return;u.busy=true;u.error='';paint();
    try{const result=await onAction('link-status',{});if(!current())return;if(typeof result?.connected!=='boolean')throw Error('ChatGPT 연결 상태를 확인하지 못했습니다.');ui.paymentReviewLinkStatus=result;if(result.connected)u.connectionCode=null;}
    catch(error){if(current())u.error=safeError(error,'ChatGPT 연결 상태를 확인하지 못했습니다.');}
    finally{u.busy=false;paint();}
  });
  root.querySelector('[data-pr-disconnect]')?.addEventListener('click',async()=>{
    if(!current()||blocked())return;u.busy=true;u.error='';paint();
    try{const result=await onAction('link-revoke',{});if(!current())return;if(result?.revoked!==true)throw Error('ChatGPT 연결 해제 결과를 확인하지 못했습니다.');ui.paymentReviewLinkStatus={connected:false,links:[]};u.connectionCode=null;u.notice='ChatGPT 연결을 해제했습니다.';}
    catch(error){if(current())u.error=safeError(error,'ChatGPT 연결을 해제하지 못했습니다.');}
    finally{u.busy=false;paint();}
  });
  root.querySelector('[data-pr-connect]')?.addEventListener('click',async()=>{
    if(!current()||blocked())return;u.busy=true;u.error='';u.connectionCode=null;paint();
    try{const result=await onAction('connect-code',{});if(!current())return;if(typeof result?.code!=='string'||result.code.length>128)throw Error('연결 코드를 확인하지 못했습니다.');u.connectionCode={code:result.code,expiresAt:result.expiresAt};}
    catch(error){if(current())u.error=safeError(error,'ChatGPT 연결 코드를 만들지 못했습니다.');}
    finally{u.busy=false;paint();}
  });
  root.querySelector('[data-pr-copy-code]')?.addEventListener('click',async()=>{if(!current()||!u.connectionCode)return;try{await navigator.clipboard.writeText(u.connectionCode.code);if(current()){u.notice='연결 코드를 복사했습니다. 현재 ChatGPT 대화에 입력하세요.';paint();}}catch{if(current()){u.error='자동 복사가 차단되었습니다. 표시된 연결 코드를 직접 복사해 주세요.';paint();}}});
  root.querySelector('[data-pr-hide-code]')?.addEventListener('click',()=>{if(current()){u.connectionCode=null;paint();}});
  const form=root.querySelector('[data-pr-review-form]'),edit=activeEdit(u),reviewBlocked=()=>blocked()||u.detail?.upload?.analysisStatus==='running'||!!u.detail?.upload?.deletingAt;
  if(form&&!paymentFormBaselines.has(form)){const baseline=paymentFormSignature(form,true);if(baseline!==null)paymentFormBaselines.set(form,baseline);}
  for(const card of form?.querySelectorAll?.('[data-pr-intake-team-id][data-pr-intake-prefix]')||[]){if(!card?.dataset?.prIntakeTeamId||typeof card.dataset.prIntakePrefix!=='string')continue;const scoped=scopedPaymentIntakeForm(form,card);if(!paymentFormBaselines.has(scoped)){const baseline=paymentFormSignature(scoped,true);if(baseline!==null)paymentFormBaselines.set(scoped,baseline);}}
  const teamBoard=root.querySelector('.pr-intake-team-board'),activeCard=root.querySelector('.pr-intake-team-card.is-active'),sessionBoard=root.querySelector('.pr-intake-session-board');
  if(teamBoard&&activeCard&&typeof activeCard.getBoundingClientRect==='function'){
    const teamKey=`${u.activeKey}:${registrationOf(edit.draft).activeTeamId}`;
    u.intakeScroll??={};
    const restore=()=>{if(!current()||teamBoard.isConnected===false)return;
      if(u.intakeScroll.teamKey===teamKey)teamBoard.scrollLeft=u.intakeScroll.teamLeft||0;
      else teamBoard.scrollLeft+=activeCard.getBoundingClientRect().left-teamBoard.getBoundingClientRect().left;
      u.intakeScroll.teamKey=teamKey;u.intakeScroll.teamLeft=teamBoard.scrollLeft;
      if(sessionBoard)sessionBoard.scrollLeft=u.intakeScroll.sessions?.[teamKey]||0;
    };
    restore();
    teamBoard.addEventListener('scroll',()=>{if(current()&&teamBoard.isConnected!==false){u.intakeScroll.teamKey=teamKey;u.intakeScroll.teamLeft=teamBoard.scrollLeft;}},{passive:true});
    sessionBoard?.addEventListener('scroll',()=>{if(current()&&sessionBoard.isConnected!==false){u.intakeScroll.sessions??={};u.intakeScroll.sessions[teamKey]=sessionBoard.scrollLeft;}},{passive:true});
  }
  const updateApproval=()=>{
    const save=root.querySelector('[data-pr-save]'),approve=root.querySelector('[data-pr-approve]'),discard=root.querySelector('[data-pr-discard]');
    if(discard)discard.disabled=reviewBlocked()||!edit.dirty;
    if(save){save.disabled=reviewBlocked()||!edit.dirty&&!edit.receiptPolicyChanged&&!edit.notesPolicyChanged||edit.status==='committed';save.textContent='검토 내용 저장';}
    if(approve)approve.disabled=reviewBlocked()||edit.status==='committed';
    const hint=root.querySelector('[data-pr-approval-hint]');if(hint)hint.textContent=cachedApprovedDraft(u,edit)?'작성 내용을 다시 열 수 있습니다.':paymentReviewValidation(edit,{approve:true})||'빠진 고객·강습 정보는 작성 화면에서 이어서 입력할 수 있습니다.';
  };
  const showReviewIssue=issue=>{
    u.reviewError=issue.message;paint();
    const freshForm=root.querySelector('[data-pr-review-form]'),target=issue.field?freshForm?.elements?.namedItem(issue.field):issue.action?root.querySelector(`[data-pr-${issue.action}]`):root.querySelector('[data-pr-approval-hint]');
    target?.setAttribute?.('aria-invalid','true');target?.focus?.({preventScroll:true});target?.scrollIntoView?.({block:'center',behavior:'smooth'});
  };
  if(form&&edit){
    form.addEventListener('submit',event=>event.preventDefault());
    const capture=event=>{
      if(!current()||reviewBlocked()||edit!==activeEdit(u)||edit.status==='committed')return;
      const name=event.target?.dataset?.prIntakeField||event.target?.name||'',fullName=event.target?.name||'',prefix=fullName.slice(0,Math.max(0,fullName.length-name.length));
      if(name==='reservationKind'&&event.target.value==='pass'){
        const card=event.target.closest?.('[data-pr-intake-team-id]'),team=paymentIntakeTeams(edit.draft).find(row=>row.id===card?.dataset?.prIntakeTeamId);
        if(team?.sessions.some(row=>row.paymentRequestCorrection)){
          event.target.value=team.bookingType||'';
          u.reviewError='요청액 정정은 날짜가 있는 회차별 예약에 반영됩니다. 정정을 해제한 뒤 날짜 미정 수강권으로 바꿔 주세요.';paint();return;
        }
      }
      if(['rentalPaymentStatus','rentalHours','rentalCustomAmount'].includes(name))syncBookingReviewRentalFields({elements:{namedItem:key=>form.elements.namedItem(prefix+key)}});
      const financialBlock=event.target?.closest?.('[data-bk-session-financial]');
      if(financialBlock&&(['paymentCorrectionEnabled','paymentCorrectionAmount','paymentCorrectionReason'].includes(name)||financialBlock.querySelector('[data-pr-intake-field="paymentCorrectionEnabled"]')?.checked))syncBookingReviewFinancialFields({elements:{namedItem:key=>form.elements.namedItem(prefix+key)},querySelector:selector=>financialBlock.querySelector(selector)},{initializeCorrection:name==='paymentCorrectionEnabled'});
      let receiptDefaultChanged=false;
      if(['cashReceiptRequested','cashReceiptNumber'].includes(name)){
        const applied=registrationOf(edit.draft);
        for(const owner of [applied,...list(applied.reviewedTeams)])if(owner.registrationFields?.cashReceiptDefaulted===true){owner.registrationFields.cashReceiptDefaulted=false;receiptDefaultChanged=true;}
      }
      const invalid=!!(edit.passCountInvalid||edit.bankInputInvalid),changed=captureForm(form,edit);
      if(!changed&&!receiptDefaultChanged&&invalid===!!(edit.passCountInvalid||edit.bankInputInvalid))return;
      if(receiptDefaultChanged)edit.staffEdited=true;
      invalidate(edit);u.reviewError='';updateApproval();syncPaymentIntakeTotals(root,edit);
      const dependent=['reservationKind','cashReceiptRequested','cashReceiptNumberMode','sport','studentCount','rentalPaymentStatus','rentalHours','rentalCustomAmount','teamPhoneMode','kind','seasonTotal','isReorder','lessonMinutes','breakMinutes','date','patchEnabled'];
      if(dependent.includes(name)||/^participant_\d+_type$/.test(name)||event.type==='change'&&['startTime','lessonFee','rentalAmount','allocatedAmount','patchFee','teamName','customerName','phone','paymentCorrectionEnabled','paymentCorrectionAmount'].includes(name))paint();
    };
    form.addEventListener('input',capture);form.addEventListener('change',capture);

  }
  const mutateIntake=(mutator,owner=null)=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||edit.status==='committed')return;
    try{captureForm(form,edit);const id=owner?.closest?.('[data-pr-intake-team-id]')?.dataset?.prIntakeTeamId;if(id)edit.draft=switchPaymentIntakeTeam(edit.draft,id);const before=JSON.stringify(serializePaymentIntake(edit.draft));edit.draft=mutator(edit.draft);if(before!==JSON.stringify(serializePaymentIntake(edit.draft)))edit.staffEdited=true;delete edit.passCountInput;edit.passCountInvalid=false;invalidate(edit);u.reviewError='';paint();}
    catch(error){u.reviewError=safeError(error,'팀·회차 입력을 확인해 주세요.');paint();}
  };
  root.querySelector('[data-pr-apply-allocation]')?.addEventListener('click',()=>mutateIntake(draft=>{
    const proposal=buildPaymentAllocationProposal(draft,{depositAmount:edit.amount,remainingAmount:edit.remainingAmount??edit.amount});
    if(proposal.status==='unavailable'||proposal.warnings.some(row=>['EXISTING_ALLOCATION','MANUAL_FEE_CHANGED','INVALID_EXISTING_ALLOCATION'].includes(row.code)))throw Error('기존 입력이나 원문 금액이 달라 자동 배분할 수 없습니다. 회차별 금액을 직접 확인해 주세요.');
    const next=applyPaymentAllocationProposal(draft,proposal,{allowReviewRequired:true});
    u.notice='팀·회차 입금 배분 초안을 반영했습니다. 담당자가 금액을 확인하고 일반 예약 작성 화면에서 저장하세요.';return next;
  }));
  root.querySelectorAll('[data-pr-select-team]').forEach(button=>button.addEventListener('click',()=>{if(!current()||reviewBlocked()||!edit)return;try{if(captureForm(form,edit))invalidate(edit);edit.draft=switchPaymentIntakeTeam(edit.draft,button.dataset.prSelectTeam);delete edit.passCountInput;u.intakeCalendarOpen=false;u.reviewError='';paint();}catch(error){u.reviewError=safeError(error,'팀 카드를 확인해 주세요.');paint();}}));
  root.querySelector('[data-pr-add-team]')?.addEventListener('click',()=>mutateIntake(draft=>addPaymentIntakeTeam(draft,{copyDetails:true})));
  root.querySelectorAll('[data-pr-remove-team]').forEach(button=>button.addEventListener('click',()=>{if(confirm('이 팀의 작성 카드를 삭제할까요? 다른 팀과 은행 캡처는 유지됩니다.'))mutateIntake(draft=>removePaymentIntakeTeam(draft,button.dataset.prRemoveTeam));}));
  root.querySelectorAll('[data-pr-remove-session]').forEach(button=>button.addEventListener('click',()=>{if(confirm('이 회차의 작성 카드를 삭제할까요?'))mutateIntake(draft=>removePaymentIntakeSession(draft,button.dataset.prRemoveSession),button);}));
  root.querySelectorAll('[data-pr-copy-sessions]').forEach(button=>button.addEventListener('click',()=>mutateIntake(draft=>copyPaymentIntakeSessionValues(draft,button.dataset.prCopySessions),button)));
  root.querySelectorAll('[data-pr-calendar-toggle]').forEach(button=>button.addEventListener('click',()=>{if(!current()||reviewBlocked())return;if(captureForm(form,edit))invalidate(edit);const id=button.closest?.('[data-pr-intake-team-id]')?.dataset?.prIntakeTeamId||registrationOf(edit.draft).activeTeamId;const same=u.intakeCalendarTeamId===id;edit.draft=switchPaymentIntakeTeam(edit.draft,id);u.intakeCalendarTeamId=id;u.intakeCalendarOpen=same?!u.intakeCalendarOpen:true;u.intakeCalendarMonth=String(edit.draft.date||new Date().toISOString()).slice(0,7);u.intakeCalendarDates=[];paint();}));
  root.querySelector('[data-pr-calendar-close]')?.addEventListener('click',()=>{u.intakeCalendarOpen=false;paint();});
  root.querySelectorAll('[data-pr-calendar-month]').forEach(button=>button.addEventListener('click',()=>{if(!current()||reviewBlocked())return;const month=new Date(`${u.intakeCalendarMonth}-01T12:00:00Z`);month.setUTCMonth(month.getUTCMonth()+Number(button.dataset.prCalendarMonth));u.intakeCalendarMonth=month.toISOString().slice(0,7);paint();}));
  root.querySelectorAll('[data-pr-intake-date]').forEach(button=>button.addEventListener('click',()=>{if(!current()||reviewBlocked())return;const date=button.dataset.prIntakeDate,selected=new Set(u.intakeCalendarDates||[]);selected.has(date)?selected.delete(date):selected.add(date);u.intakeCalendarDates=[...selected].sort();paint();}));
  root.querySelectorAll('[data-pr-add-dates]').forEach(button=>button.addEventListener('click',()=>{const dates=[...(u.intakeCalendarDates||[])],owner=u.intakeCalendarTeamId;u.intakeCalendarOpen=false;u.intakeCalendarDates=[];mutateIntake(draft=>addPaymentIntakeSessions(owner?switchPaymentIntakeTeam(draft,owner):draft,dates),button);}));
  const applySelectedProposal=(candidateIndex,teamIndex=-1,singleIndex=null)=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||edit.status!=='draft'||!Number.isSafeInteger(candidateIndex)||!Number.isSafeInteger(teamIndex))return;
    const context=proposalContext(edit,candidateIndex,teamIndex);if(!context||!context.team&&context.teams.length>1&&singleIndex===null){u.reviewError='반영할 팀의 상담 제안을 선택해 주세요.';paint();return;}
    if(singleIndex!==null&&(!Number.isSafeInteger(singleIndex)||singleIndex<0||singleIndex>=context.fields.length))return;
    if(captureForm(form,edit))invalidate(edit);
    const included=registrationOf(edit.draft).intakeVersion===1&&list(registrationOf(edit.draft).reviewedTeams).find(team=>team.threadId===context.candidate.threadId&&team.teamIndex===teamIndex);
    if(included?.id)edit.draft=switchPaymentIntakeTeam(edit.draft,included.id);
    const result=applyProposalContext(edit,context,{singleFact:singleIndex===null?null:context.fields[singleIndex],replaceLesson:singleIndex===null&&!!context.team&&edit.draft.paymentComparison?.refreshedForReview===true});
    if(result.applied){u.reviewError='';u.notice=`상담 제안을 검토 양식에 반영했습니다.${result.cleared?' 이전 팀에서만 반영한 값은 비웠습니다.':''}${result.skipped?' 직접 입력한 값이나 상충하는 항목은 유지했습니다.':''} 저장한 뒤 고객·일정·참가자 정보를 다시 대조하세요.`;}
    else u.reviewError='반영할 확정 가능한 값이 없거나 직접 입력한 값과 다릅니다. 원문을 확인하고 필요한 항목의 “이 값 반영”을 선택하세요.';
    paint();
  };
  root.querySelectorAll('[data-pr-build-candidate-teams]').forEach(button=>button.addEventListener('click',async()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||edit.status!=='draft')return;
    const candidateIndex=Number(button.dataset.prBuildCandidateTeams),candidate=list(edit.draft.paymentComparison?.candidates)[candidateIndex];if(!candidate)return;
    if(captureForm(form,edit))invalidate(edit);
    const count=list(edit.draft.paymentComparison?.consultation?.teams).filter(team=>team.threadId===candidate.threadId).length;
    if(!confirm(`현재 팀·회차 입력을 이 상담의 ${count}팀으로 다시 만들까요? 은행 입금 내역과 직접 확인 메모는 유지합니다. 원문 견적에 따른 입금 배분 초안도 함께 제안하므로 담당자가 확인합니다.`))return;
    const key=u.activeKey,before=JSON.stringify(edit.draft);
    if(candidate.sourceId&&candidate.phone)await loadComparisonOriginals(candidateIndex);
    if(!current()||key!==u.activeKey||edit!==activeEdit(u))return;
    if(before!==JSON.stringify(edit.draft)){u.reviewError='원문을 불러오는 동안 입력 내용이 바뀌었습니다. 현재 내용을 확인하고 다시 눌러 주세요.';paint();return;}
    try{
      const result=applyPaymentCandidateTeams(edit,candidateIndex);
      u.reviewError='';u.intakeCalendarOpen=false;u.openPanels??={};u.openPanels.results=true;
      u.notice=`이 상담의 ${result.teamCount}팀을 검토 카드에 반영했습니다. 팀별 강습료와 입금 배분액을 대조하고 저장하세요.${result.notesOmitted?' 메모 길이 제한으로 일부 상담 메모는 작성란에 넣지 못했습니다. 상담 원문에서 확인해 주세요.':''}${result.phoneFilled?' 선택한 상담 번호를 연락처 후보로 채웠습니다. 같은 고객인지 확인하세요.':''}${result.phoneConflict?' 기존 연락처는 유지했습니다. 선택한 상담 번호와 달라 직접 대조가 필요합니다.':''}${result.skippedFields?' 원문 검증이 부족하거나 상충하는 항목은 비워 두었습니다.':''}`;
      paint();scrollSection('intake');
    }catch(error){u.reviewError=safeError(error,'상담 팀 제안을 반영하지 못했습니다. 원문을 확인해 주세요.');paint();}
  }));
  root.querySelectorAll('[data-pr-include-team]').forEach(input=>input.addEventListener('change',()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||edit.status!=='draft')return;
    const [candidateIndex,teamIndex]=String(input.dataset.prIncludeTeam).split(':').map(Number),context=proposalContext(edit,candidateIndex,teamIndex);if(!context?.team)return;
    captureForm(form,edit);edit.draft.paymentComparison.appliedProposal??={fields:[],requiresConfirmation:true};let applied=registrationOf(edit.draft);
    const existing=list(applied.reviewedTeams).find(team=>team.threadId===context.candidate.threadId&&team.teamIndex===teamIndex);
    if(!input.checked&&existing?.id&&applied.intakeVersion===1){
      try{edit.draft=removePaymentIntakeTeam(edit.draft,existing.id);}catch(error){u.reviewError=safeError(error,'검토할 팀을 한 개 이상 남겨 주세요.');paint();return;}
    }else{
      const teams=list(applied.reviewedTeams).filter(team=>team!==existing);
      if(input.checked){
        const first=teams.length===1&&teams[0],blank=first&&!first.threadId&&list(first.sessions).length===1&&!list(first.participants).length&&['sport','date','startTime','lessonMinutes','studentCount','lessonFee','rentalFee'].every(field=>first.draft?.[field]===null||first.draft?.[field]===undefined||first.draft?.[field]==='')&&(!first.draft?.teamName||first.draft.teamName===edit.defaultedTeamName||first.draft.teamName===edit.draft.customerName)&&!text(first.draft?.notes).trim();
        let selected;try{selected=existing||reviewedTeamSnapshot(edit,context);}catch(error){u.reviewError=safeError(error,'상담 회차 원문을 확인해 주세요.');paint();return;}
        if(!existing&&blank){
          // The untouched initial card is a placeholder, not a third family team.
          // Keep its bank allocation exactly once when the first real team replaces it.
          selected.id=first.id;selected.draft.allocatedAmount=first.sessions[0].allocatedAmount;
          teams.splice(0,1,selected);applied.activeTeamId=selected.id;
        }else teams.push(selected);
      }
      applied.reviewedTeams=teams;
      if(applied.intakeVersion===1)edit.draft=hydratePaymentIntake(edit.draft);
    }
    invalidate(edit);u.reviewError='';u.notice='함께 작성할 팀을 변경했습니다. 팀별 구성과 입금 배분을 확인하고 저장하세요.';paint();
  }));
  root.querySelectorAll('[data-pr-apply-candidate]').forEach(button=>button.addEventListener('click',()=>applySelectedProposal(Number(button.dataset.prApplyCandidate))));
  root.querySelectorAll('[data-pr-apply-team]').forEach(button=>button.addEventListener('click',()=>{const [candidateIndex,teamIndex]=String(button.dataset.prApplyTeam).split(':').map(Number);applySelectedProposal(candidateIndex,teamIndex);}));
  root.querySelectorAll('[data-pr-apply-proposal]').forEach(button=>button.addEventListener('click',()=>{const [candidateIndex,teamIndex,singleIndex]=String(button.dataset.prApplyProposal).split(':').map(Number);applySelectedProposal(candidateIndex,teamIndex,singleIndex);}));
  root.querySelectorAll('[data-pr-comparison-thread]').forEach(button=>button.addEventListener('click',()=>loadComparisonOriginals(Number(button.dataset.prComparisonThread),{append:true})));
  root.querySelector('[data-pr-original-candidate]')?.addEventListener('change',event=>{
    if(!current()||reviewBlocked())return;const index=Number(event.target.value);if(!Number.isSafeInteger(index)||!originalSources(u,edit)[index])return;
    u.comparisonActiveIndex=index;paint();void loadComparisonOriginals(index);
  });
  root.querySelector('[data-pr-find]')?.addEventListener('click',async()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u))return;
    if(captureForm(form,edit))invalidate(edit);const key=u.activeKey,request=(u.candidateRequest||0)+1;u.candidateRequest=request;u.candidateLoading=true;u.error='';paint();
    try{
      const result=await onAction('find-candidates',{payerName:edit.payerName.trim(),amount:edit.amount,...(edit.draft.phone?{phone:edit.draft.phone}:{})});
      if(!current()||u.activeKey!==key||u.candidateRequest!==request)return;
      if(!Array.isArray(result?.candidates))throw Error('상담 후보 조회 결과를 확인하지 못했습니다.');
      u.candidates=result.candidates;u.candidateSearched=true;u.selectedCandidate=null;
    }catch(error){if(current()&&u.activeKey===key)u.error=safeError(error,'상담 후보를 찾지 못했습니다.');}
    finally{if(current()&&u.candidateRequest===request){u.candidateLoading=false;paint();}}
  });
  root.querySelectorAll('[data-pr-candidate]').forEach(input=>input.addEventListener('change',async()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||!input.checked)return;
    const index=Number(input.dataset.prCandidate),candidate=u.candidates[index];if(!candidate?.sourceId||!candidate.phone)return;
    const key=u.activeKey,request=(u.contextRequest||0)+1;u.contextRequest=request;u.selectedCandidate=index;edit.draft.phone=candidate.phone;
    edit.draft.customerId='';edit.draft.teamId='';u.candidateContext=null;u.candidateContextLoading=true;
    edit.evidenceRefs=list(candidate.messages).map(row=>({sourceId:candidate.sourceId,messageId:row.messageId||row.id}));
    edit.evidence=list(candidate.messages).map(row=>({...row,id:row.messageId||row.id,messageId:row.messageId||row.id,sourceId:candidate.sourceId,sourceLabel:candidate.sourceLabel,phone:candidate.phone,verification:'stored_message'}));
    const sourceIndex=originalSources(u,edit).findIndex(row=>row.sourceId===candidate.sourceId&&phoneKey(row.phone)===phoneKey(candidate.phone));
    u.comparisonActiveIndex=sourceIndex;edit.staffEdited=true;invalidate(edit);u.reviewError='';paint();
    try{
      const result=await loadComparisonOriginals(sourceIndex,{refresh:true});
      if(!current()||u.activeKey!==key||u.contextRequest!==request)return;
      if(result)u.candidateContext=result;
    }catch(error){if(current()&&u.contextRequest===request)u.error=safeError(error,'기존 고객·팀을 불러오지 못했습니다.');}
    finally{if(current()&&u.contextRequest===request){u.candidateContextLoading=false;paint();}}
  }));
  root.querySelector('[data-pr-match-customer]')?.addEventListener('change',event=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u))return;
    if(u.candidateContext?.phone&&phoneKey(u.candidateContext.phone)!==phoneKey(edit.draft.phone)){u.reviewError='현재 전화번호의 상담 후보를 다시 확인해 주세요.';paint();return;}
    const id=event.currentTarget.value,customer=list(u.candidateContext?.customers).find(row=>row.id===id);if(id&&!customer)return;
    edit.draft.customerId=customer?.id||'';edit.draft.teamId='';if(customer)edit.draft.customerName=text(customer.name);invalidate(edit);paint();
  });
  root.querySelector('[data-pr-match-team]')?.addEventListener('change',event=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u))return;
    if(u.candidateContext?.phone&&phoneKey(u.candidateContext.phone)!==phoneKey(edit.draft.phone)){u.reviewError='현재 전화번호의 상담 후보를 다시 확인해 주세요.';paint();return;}
    const id=event.currentTarget.value,team=list(u.candidateContext?.teams).find(row=>row.id===id&&row.customerId===edit.draft.customerId);if(id&&!team)return;
    edit.draft.teamId=team?.id||'';if(team)edit.draft.teamName=text(team.name);invalidate(edit);paint();
  });
  root.querySelector('[data-pr-discard]')?.addEventListener('click',()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||!edit.dirty)return;
    if(edit.proposalAutoInitialized){u.proposalDismissed??={};u.proposalDismissed[edit.id]=edit.version;}
    const original=list(u.detail?.reviews).find(row=>row.id===edit.id);delete u.edits[u.activeKey];
    if(original){u.activeKey=keyFor(original);editOf(u,original);}else{const first=list(u.detail?.reviews)[0];u.activeKey=first?keyFor(first):'';if(first)editOf(u,first);}
    u.reviewError='';u.error='';u.candidates=[];u.comparisonOriginals={};u.comparisonLoading='';u.candidateContext=null;u.candidateContextLoading=false;u.contextRequest=(u.contextRequest||0)+1;u.candidateSearched=false;u.selectedCandidate=null;u.notice='저장하지 않은 입력을 취소했습니다.';paint();
  });
  const persistReview=async(value,key,uploadId)=>{
    if(!value.draft.customerName.trim())value.draft.customerName=value.payerName.trim();
    if(!value.draft.teamName.trim())value.draft.teamName=value.draft.customerName;
    const result=await onAction('review-save',{uploadId,rowKey:value.rowKey,...(value.id?{reviewId:value.id,expectedVersion:value.version}:{}),payerName:value.payerName.trim(),amount:value.amount,transactionDate:value.transactionDate,draft:normalizePaymentDraft(registrationOf(value.draft).intakeVersion===1?serializePaymentIntake(value.draft):value.draft),evidenceRefs:value.evidenceRefs,externalEvidence:value.externalEvidence,manualReason:value.manualReason.trim()});
    if(!current()||u.activeKey!==key||u.detail?.upload?.id!==uploadId)return null;
    if(!result?.review?.id||result.review.status!=='draft'||!Number.isSafeInteger(result.review.version)||value.id&&(result.review.id!==value.id||result.review.version<=value.version))throw Error('검토 저장 결과를 확인하지 못했습니다. 입력 내용을 유지했습니다. 다시 확인해 주세요.');
    delete u.edits[key];return putReview(u,result.review);
  };
  root.querySelector('[data-pr-save]')?.addEventListener('click',async()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||edit.status==='committed')return;
    if(captureForm(form,edit))invalidate(edit);const issue=paymentReviewIssue(edit);if(issue){showReviewIssue(issue);return;}
    const uploadId=u.detail?.upload?.id,key=u.activeKey;if(!uploadId)return;
    u.busy=true;u.reviewError='';paint();
    try{const saved=await persistReview(edit,key,uploadId);if(!saved)return;u.notice='검토 내용을 저장했습니다. 예약 또는 수강권 작성을 이어서 열 수 있습니다.';await refresh();}
    catch(error){if(current())u.reviewError=safeError(error,'검토 내용을 저장하지 못했습니다.');}
    finally{u.busy=false;paint();}
  });
  root.querySelector('[data-pr-approve]')?.addEventListener('click',async()=>{
    if(!current()||reviewBlocked()||!edit||edit!==activeEdit(u)||edit.status==='committed')return;
    const savedReview=list(u.detail?.reviews).find(row=>row.id===edit.id),progress=savedReview&&(list(savedReview.allocations).length||Number(savedReview.allocatedAmount)>0)?reconcilePaymentReviewProgress(savedReview,bookingContext):{kind:'none'},partial=progress.kind!=='none';
    if(partial&&progress.kind!=='partial'){u.reviewError=progress.error||'이미 저장된 예약입니다. 예약 목록에서 확인해 주세요.';paint();return;}
    if(!partial&&captureForm(form,edit))invalidate(edit);
    let approvedDraft=partial?null:cachedApprovedDraft(u,edit);
    if(!approvedDraft){const issue=paymentReviewIssue(partial?{...edit,draft:progress.draft,remainingAmount:progress.remainingAmount}:edit,{approve:true});if(issue){showReviewIssue(issue);return;}}
    const uploadId=u.detail?.upload?.id;if(!uploadId)return;
    let key=u.activeKey,value=edit,editorRendered=false;u.busy=true;u.handoffPending=true;u.reviewError='';paint();
    try{
      if(!approvedDraft){
        // Save the exact visible edit first, including inferred/default customer names.
        // A failed save or version conflict must never open stale reservation data.
        if(!partial&&(value.dirty||value.receiptPolicyChanged||value.notesPolicyChanged||!value.id)){value=await persistReview(value,key,uploadId);if(!value)return;key=u.activeKey;}
        const result=await onAction('review-approve',{reviewId:value.id,expectedVersion:value.version,entryMode:'direct'});
        if(!current()||u.activeKey!==key||u.detail?.upload?.id!==uploadId)return;
        if(result?.review?.id!==value.id||result.review.status!=='approved'||result.approvedDraft?.paymentReviewId!==value.id||result.approvedDraft?.paymentReviewVersion!==result.review.version)throw Error('작성 화면으로 넘길 내용을 확인하지 못했습니다. 다시 눌러 주세요.');
        putReview(u,result.review);approvedDraft=result.approvedDraft;
        if(partial){
          const latest=reconcilePaymentReviewProgress(result.review,bookingContext);
          if(latest.kind!=='partial')throw Error(latest.error||'저장 상태가 변경되었습니다. 최신 저장 내역을 확인해 주세요.');
          approvedDraft={...approvedDraft,...latest.draft,paymentReviewId:result.approvedDraft.paymentReviewId,paymentReviewVersion:result.approvedDraft.paymentReviewVersion,paymentAllocationAmount:paymentIntakeTotals(latest.draft).allocatedAmount};
        }
        u.approvedHandoff=approvedDraft;
      }
      u.notice='작성 화면에서 내용을 확인하고 저장하면 등록됩니다.';
      // Retry only the editor handoff after preparation; never repeat a successful approval.
      if(typeof onOpenBooking!=='function')throw Error('작성 화면을 열 수 없습니다. 준비한 내용은 보관되어 있습니다. 다시 열어 주세요.');
      u.busy=false;const opened=await onOpenBooking(approvedDraft);editorRendered=opened?.opened===true;
      if(opened?.opened===false)throw Error(opened.message||'작성 화면을 열지 못했습니다. 준비한 내용은 보관되어 있습니다. 다시 눌러 주세요.');
    }catch(error){if(current())u.reviewError=safeError(error,u.approvedHandoff?'작성 화면을 열지 못했습니다. 준비한 내용은 보관되어 있습니다. 다시 눌러 주세요.':'작성 내용을 저장하지 못했습니다. 다시 시도해 주세요.');}
    finally{u.busy=false;u.handoffPending=false;if(!editorRendered)paint();}
  });
}
