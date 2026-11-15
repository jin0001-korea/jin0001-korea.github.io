const cancelled=row=>['cancelled','canceled'].includes(row?.status)||!!(row?.cancelled_at||row?.cancelledAt);

/** Scope actionable drafts to active reservations; queue and delivery audit objects remain unchanged. */
export function activeNoticeReservationIds(context={}){
 const archived=new Set((context.schedules||[]).filter(cancelled).map(row=>row.id));
 return new Set((context.reservations||[]).filter(row=>!cancelled(row)&&!archived.has(row.id)&&!archived.has(row.schedule_id||row.scheduleId)).map(row=>row.id));
}
export function selectActiveCustomerNotices(notices=[],context={}){
 const active=activeNoticeReservationIds(context);
 return (Array.isArray(notices)?notices:[]).flatMap(notice=>{
  if(!notice)return[];
  if(notice.kind==='pass')return[notice];
  const subjectIds=[...new Set(Array.isArray(notice.subjectIds)?notice.subjectIds:[])].filter(id=>active.has(id));
  return subjectIds.length?[{...notice,subjectIds}]:[];
 });
}
