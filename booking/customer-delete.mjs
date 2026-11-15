const list=value=>Array.isArray(value)?value:[];
const customerId=row=>String(row?.customerId??row?.customer_id??'');
const teamId=row=>String(row?.customerTeamId??row?.customer_team_id??'');
const stamp=row=>row?.updated_at||row?.updatedAt||null;

export const isDeletedCustomer=customer=>!!(customer?.deleted_at||customer?.deletedAt);
export const customerDeletionConfirmed=(result,id)=>result?.deleted===true&&result.id===id&&((result.archived===true&&result.customer?.id===id&&isDeletedCustomer(result.customer))||(result.alreadyDeleted===true&&!result.customer));

export const canDeleteCustomer=(state={},ui={})=>ui.booking?.demo!==false||(state.profile?.role==='admin'&&state.profile.active===true&&!state.profile.must_change_password);

/** Snapshot exact identities and revisions; names and telephone numbers are never delete keys. */
export function customerDeletionPayload(customer,context={}){
  if(!customer?.id||!stamp(customer))throw Error('최신 고객 정보를 다시 불러온 뒤 삭제해 주세요.');
  const teams=list(context.customerTeams).filter(row=>customerId(row)===String(customer.id));
  if(teams.some(row=>!row.id||!stamp(row)))throw Error('최신 팀 정보를 다시 불러온 뒤 삭제해 주세요.');
  return {id:customer.id,expectedUpdatedAt:stamp(customer),expectedTeams:teams.map(row=>({id:row.id,expectedUpdatedAt:stamp(row)})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
}

/** Explain retained records; linked history never blocks removal from the directory. */
export function customerDeletionUsage(id,context={}){
  const teamIds=new Set(list(context.customerTeams).filter(row=>customerId(row)===String(id)).map(row=>String(row.id)));
  const linked=row=>customerId(row)===String(id)||teamIds.has(teamId(row));
  return [['예약',context.reservations],['수강권',context.lessonPasses],['시즌권',context.seasonPackages],['고객 안내',context.customerNotices]]
    .map(([label,rows])=>({label,count:new Set(list(rows).filter(linked).map(row=>row.id)).size})).filter(row=>row.count>0);
}

export function deleteDemoCustomer(payload,demo={}){
  const customer=list(demo.customers).find(row=>row.id===payload.id);
  if(!customer)return {id:payload.id,deleted:true,deletedTeams:0,alreadyDeleted:true};
  const preservedTeams=list(demo.customerTeams).filter(row=>customerId(row)===String(payload.id)).length;
  if(isDeletedCustomer(customer))return {id:payload.id,deleted:true,archived:true,deletedAt:customer.deleted_at||customer.deletedAt,customer:{...customer},deletedTeams:0,preservedTeams,alreadyDeleted:true};
  const current=customerDeletionPayload(customer,demo);
  if(JSON.stringify(current)!==JSON.stringify(payload))throw Error('고객 또는 팀 정보가 변경되었습니다. 다시 확인한 뒤 삭제해 주세요.');
  const deletedAt=new Date().toISOString(),saved={...customer,deleted_at:deletedAt,deleted_by:null,updated_at:deletedAt};
  demo.customers=list(demo.customers).map(row=>row.id===payload.id?saved:row);
  return {id:payload.id,deleted:true,archived:true,deletedAt,customer:{...saved},deletedTeams:0,preservedTeams};
}
