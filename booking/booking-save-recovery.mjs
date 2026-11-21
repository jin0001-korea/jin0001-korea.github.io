import {normalizeBookingRow,bookingChangeItems} from './booking-view.mjs?v=106';

/** Recover only a verified, identical create after a lost response, never by ID alone. */
export function recoverSavedBooking(payload,state={}){
  if(!payload?.id||payload.expectedUpdatedAt)return null;
  const source=(state.reservations||[]).find(row=>row.id===payload.id);
  if(!source)return null;
  const saved=normalizeBookingRow(source,state),submitted=normalizeBookingRow(payload,state);
  if(!saved.expectedUpdatedAt)return null;
  for(const [camel,snake] of [['customerId','customer_id'],['customerTeamId','customer_team_id']]){
    const requested=payload[camel]??payload[snake];
    if(requested&&(saved[camel]??saved[snake])!==requested)return null;
  }
  submitted.isReorder=submitted.kind==='reorder'||submitted.isReorder;
  if(submitted.lessonPassId){
    const pass=(state.lessonPasses||[]).find(item=>item.id===submitted.lessonPassId);
    const fixed=pass?.fixed_instructor_user_id||pass?.fixedInstructorId;
    if(fixed){
      if(submitted.preferredInstructorId&&submitted.preferredInstructorId!==fixed)return null;
      submitted.preferredInstructorId=fixed;submitted.designated=true;
    }
  }
  if(submitted.kind==='season'&&!submitted.seasonId){
    const pack=(state.seasonPackages||[]).find(item=>item.id===saved.seasonId);
    if(!pack||Number(pack.total_sessions??pack.totalSessions)!==Number(submitted.seasonTotal)
      ||(pack.instructor_user_id||pack.instructorUserId)!==submitted.preferredInstructorId)return null;
    submitted.seasonId=saved.seasonId;
  }
  if(!submitted.designated&&!submitted.isReorder&&submitted.kind!=='season')submitted.preferredInstructorId=null;
  return bookingChangeItems(saved,submitted,state).length?null:saved;
}
