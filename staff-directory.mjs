const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function staffDirectoryGroups(roster){
  const managed=list(roster).filter(member=>member&&['instructor','counselor'].includes(member.role));
  return {visible:managed.filter(member=>member.role!=='instructor'||member.active!==false),removed:managed.filter(member=>member.role==='instructor'&&member.active===false)};
}
export function canManageInstructor(profile,member){
  return profile?.role==='admin'&&profile.active===true&&profile.must_change_password===false&&member?.role==='instructor'&&!!member.user_id&&member.user_id!==profile.user_id;
}
export function instructorNameChange(profile,member,value){
  if(!canManageInstructor(profile,member))throw Error('관리자만 강사 이름을 수정할 수 있습니다.');
  if(typeof value!=='string'||/[\u0000-\u001f\u007f]/u.test(value))throw Error('이름은 줄바꿈 없이 2~60자로 입력해 주세요.');
  const name=value.trim().replace(/ +/g,' ');
  if(name.length<2||name.length>60)throw Error('이름은 2~60자로 입력해 주세요.');
  return {display_name:name};
}
export function instructorLinkedScheduleCount(member,schedules){
  return new Set(list(schedules).filter(row=>row&&(row.instructorUserId===member?.user_id||list(row.instructorUserIds).includes(member?.user_id))).map(row=>row.id).filter(Boolean)).size;
}
export function renderInstructorDirectoryActions(member){
  if(member?.role!=='instructor')return '';
  const id=esc(member.user_id);
  return `<button class="btn secondary small" data-member-edit="${id}">이름 수정</button>${member.active?`<button class="btn danger small" data-member-remove="${id}">목록에서 삭제</button>`:`<button class="btn secondary small" data-member-toggle="${id}" data-active="true">목록에 복원</button>`}`;
}
/** Read-time label only: retain the stored name and all IDs in the database. */
export function currentScheduleInstructorName(row,assignments,roster){
  const ids=[...new Set([row?.instructor_user_id,...list(assignments).filter(link=>link?.schedule_id===row?.id).map(link=>link.instructor_user_id)].filter(Boolean))];
  const people=new Map(list(roster).filter(member=>member?.role==='instructor'&&member.user_id).map(member=>[member.user_id,member.display_name]));
  if(!ids.length||ids.some(id=>typeof people.get(id)!=='string'||!people.get(id).trim()))return row?.instructor_name||'';
  return ids.map(id=>people.get(id)).join(', ');
}
