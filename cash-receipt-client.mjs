import {supabase} from './auth-client.mjs?v=16';
import {canManageCashReceipts} from './cash-receipt-view.mjs?v=33';

function requireAdmin(profile){if(!canManageCashReceipts(profile))throw new Error('관리자만 현금영수증 발급 내역을 확인할 수 있습니다.');}
function fail(error,fallback){if(error)throw Object.assign(new Error(error.code==='42501'?'현금영수증을 관리할 권한이 없습니다.':error.code==='40001'?'예약 금액이나 요청번호가 변경되었습니다. 최신 내역을 확인한 뒤 다시 처리해 주세요.':error.message||fallback),{code:error.code});}
function validAmount(value){return Number.isSafeInteger(value)&&value>=0;}
export function validateCashReceiptPage(data){
  if(!data||!Array.isArray(data.items)||!data.summary||!['pendingCount','pendingAmount','issuedAmount','requestedAmount'].every(key=>validAmount(data.summary[key]))||!validAmount(data.total))throw new Error('현금영수증 내역을 확인하지 못했습니다.');
  for(const row of data.items)if(!row||typeof row.reservationId!=='string'||typeof row.version!=='string'||!['requestedAmount','issuedAmount','outstandingAmount'].every(key=>validAmount(row[key]))||!Array.isArray(row.entries))throw new Error('현금영수증 금액 응답을 확인하지 못했습니다.');
  return data;
}
export async function loadCashReceipts(profile,{client=supabase}={}){
  requireAdmin(profile);let offset=0,summary,total,items=[];const seen=new Set();
  for(let page=0;page<100;page++){
    const {data,error}=await client.rpc('slope_cash_receipt_list',{p_status:'all',p_limit:200,p_offset:offset});
    fail(error,'현금영수증 요청을 불러오지 못했습니다.');validateCashReceiptPage(data);
    summary=data.summary;total=data.total;
    for(const row of data.items){if(seen.has(row.reservationId))throw new Error('조회 중 내역이 변경되었습니다. 다시 불러와 주세요.');seen.add(row.reservationId);items.push(row);}
    if(data.nextOffset===null||data.nextOffset===undefined)return {items,summary,total};
    if(!Number.isSafeInteger(data.nextOffset)||data.nextOffset<=offset)throw new Error('현금영수증 목록을 이어서 불러오지 못했습니다.');
    offset=data.nextOffset;
  }
  throw new Error('조회할 현금영수증 내역이 많습니다. 조회 범위를 확인해 주세요.');
}
export async function issueCashReceipt(profile,row,{requestId,note='',client=supabase}={}){
  requireAdmin(profile);
  if(!row?.reservationId||!row.version||!validAmount(row.outstandingAmount)||row.outstandingAmount===0||!requestId)throw new Error('발급할 강습과 금액을 다시 확인해 주세요.');
  const {data,error}=await client.rpc('slope_issue_cash_receipt',{p_reservation_id:row.reservationId,p_request_id:requestId,p_expected_version:row.version,p_expected_outstanding_amount:row.outstandingAmount,p_amount:null,p_note:note.trim()});
  fail(error,'발급 완료 기록을 저장하지 못했습니다.');
  if(!data?.item||data.item.reservationId!==row.reservationId||!validAmount(data.item.issuedAmount))throw new Error('발급 처리 결과를 확인하지 못했습니다. 같은 화면에서 다시 시도해 주세요.');
  return data;
}
