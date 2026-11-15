import {rentalConfirmationPolicy} from './rental-fields.mjs?v=32';
// Live rental facts are read separately from reservation-owned payment inputs.
const esc=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('ko-KR').format(value);
const stamp=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const bad=()=>Object.assign(new Error('렌탈 현장 확인 결과를 읽지 못했습니다. 다시 조회해 주세요.'),{code:'RENTAL_BRIDGE_INVALID_RESPONSE'});
export function rentalBridgeReservationId(value){
 if(typeof value!=='string'||value.trim()!==value||!value||value.length>160||/[\u0000-\u001f/\\]/u.test(value))throw bad();
 return value;
}
export function validateRentalBridgeStatus(value,sourceReservationId){
 const id=rentalBridgeReservationId(sourceReservationId),row=value?.reservation;
 if(value?.schema_version!==1||value?.source!=='snowdesk'||typeof value.checked_at!=='string'||!Number.isFinite(Date.parse(value.checked_at))||!row||row.source_reservation_id!==id||typeof row.matched!=='boolean')throw bad();
 const out={source_reservation_id:id,matched:row.matched};
 for(const key of ['groups','students','paid_students','returned_students','additional_due_amount','paid_amount']){
  if(!Number.isSafeInteger(row[key])||row[key]<0)throw bad();out[key]=row[key];
 }
 if(out.groups>1000||out.students>1000000||out.paid_students>out.students||out.returned_students>out.students||(!out.matched&&Object.entries(out).some(([key,number])=>!['source_reservation_id','matched'].includes(key)&&number!==0)))throw bad();
 return {schema_version:1,source:'snowdesk',checked_at:value.checked_at,reservation:out};
}
export function renderRentalBridgePanel(draft={},escape=esc){
 if(!draft.id)return '';
 const confirmation=rentalConfirmationPolicy(draft);
 let id;try{id=rentalBridgeReservationId(draft.id);}catch{return '';}
 return `<section class="bk-rental-fields bk-rental-bridge" data-rental-bridge="${escape(id)}" aria-label="렌탈 현장 확인"><h4>렌탈 현장 확인</h4>${confirmation.confirmationRequired?'<p class="bk-field-note" data-rental-confirmation-required><strong>장비 결제 상태 미확인</strong> · 렌탈 접수에서 고객 응답과 직원 확인이 모두 필요합니다. 미확인만으로 무료·결제완료를 적용하지 않습니다.</p>':''}<p class="bk-field-note">저장된 이 예약과 연결된 실제 렌탈 접수·수납·반납을 조회합니다. 위의 강습 접수기록은 자동으로 바뀌지 않습니다.</p><button type="button" class="btn secondary small" data-rental-bridge-load>렌탈 현장 조회</button><div data-rental-bridge-result role="status" aria-live="polite"><p class="bk-field-note">조회 전 · 아직 현장 기록을 확인하지 않았습니다.</p></div></section>`;
}
export function renderRentalBridgeResult(value,id){
 const {reservation:row,checked_at}=validateRentalBridgeStatus(value,id);
 if(!row.matched)return `<p class="bk-field-note"><strong>연결된 렌탈 접수가 없습니다.</strong> 미결제 또는 무료라는 뜻은 아닙니다. 렌탈에서 강습 예약을 대조·연결한 뒤 다시 조회해 주세요.</p><small>${esc(stamp(checked_at))} 조회</small>`;
 return `<dl class="bk-form-grid"><div><dt>연결된 렌탈 팀</dt><dd>${row.groups}팀</dd></div><div><dt>지정 강습생</dt><dd>${row.students}명</dd></div><div><dt>최초 결제 확정 인원</dt><dd>${row.paid_students}명</dd></div><div><dt>개별 반납 완료</dt><dd>${row.returned_students}명</dd></div><div><dt>최초 결제 확정금액</dt><dd>${money(row.paid_amount)}원</dd></div><div><dt>이용시간 추가 결제 필요</dt><dd><strong>${money(row.additional_due_amount)}원</strong></dd></div></dl><p class="bk-field-note">연결된 강습생의 대여·판매 기록이며 실제 수납액과 다를 수 있습니다. 동행인·실제 수납·환불·별도 파손 정산은 렌탈 정산에서 확인하세요. 반납과 추가금 정산은 별개입니다.</p><small>${esc(stamp(checked_at))} 조회 · 최신 현장 상태는 다시 조회해 주세요.</small>`;
}
export function rentalBridgeErrorMessage(error){
 if(error?.code==='RENTAL_BRIDGE_NOT_CONFIGURED'||/렌탈 매장 연결 설정/.test(error?.message||''))return '렌탈 매장 연결 준비 중입니다. 렌탈 사장 계정·매장을 등록하고 연동 설정을 완료한 뒤 조회할 수 있습니다.';
 return /[가-힣]/u.test(error?.message||'')?String(error.message).slice(0,240):'렌탈 현장에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.';
}
export function bindRentalBridgePanels(root,{demo=false,lookup,isCurrent=()=>true}={}){
 for(const section of root.querySelectorAll('[data-rental-bridge]')){
  const button=section.querySelector('[data-rental-bridge-load]'),result=section.querySelector('[data-rental-bridge-result]');
  if(!button||!result)continue;
  if(demo){button.disabled=true;result.textContent='체험 화면에서는 실제 렌탈 기록을 조회하지 않습니다.';continue;}
  let pending=false;
  button.addEventListener('click',async()=>{
   if(pending||!section.isConnected||!isCurrent()||typeof lookup!=='function')return;
   pending=true;button.disabled=true;button.textContent='현장 확인 중…';result.textContent='렌탈 현장 기록을 확인하고 있습니다.';
   try{
    const value=await lookup(section.dataset.rentalBridge);
    if(!section.isConnected||!isCurrent()||value?.discarded)return;
    result.innerHTML=renderRentalBridgeResult(value,section.dataset.rentalBridge);
   }catch(error){if(section.isConnected&&isCurrent())result.textContent=rentalBridgeErrorMessage(error);}
   finally{pending=false;if(section.isConnected&&isCurrent()){button.disabled=false;button.textContent='렌탈 현장 다시 조회';}}
  });
 }
}
