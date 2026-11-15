/** Web registrations are separate from the still-unlinked historical sheet metrics. */
const identity=value=>typeof value==='string'?value.trim():'';
const passId=row=>identity(row.lesson_pass_id||row.lessonPassId);
const seasonId=row=>identity(row.season_id||row.seasonId);
const rowId=row=>identity(row.id||row.schedule_id);
const active=row=>row&&rowId(row)&&!['cancelled','canceled'].includes(row.status);
const connect=(map,key,value)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(value);};

export function webReorderRows(state){
  const admin=state.profile?.role==='admin';
  const ownRegistrations=!admin&&Array.isArray(state.reorderRegistrations);
  const records=(admin?(state.reservations||[]):ownRegistrations?state.reorderRegistrations:(state.reservationFlags||[])).filter(active);
  const passes=new Map((state.lessonPasses||[]).map(row=>[identity(row.id),row]));
  const preferredFor=row=>row.preferred_instructor_user_id||passes.get(passId(row))?.fixed_instructor_user_id;
  const people=admin?(state.roster||[]).filter(p=>p.role==='instructor'):[state.profile].filter(Boolean);
  return people.map(person=>{
    const tiedRows=records.filter(row=>{
      if(ownRegistrations)return row.assigned_to_me===true||row.designated_to_me===true;
      const id=rowId(row);
      const schedule=(state.schedules||[]).find(s=>s.id===id);
      const assigned=schedule?.instructorUserIds||[];
      const preferred=row.preferred_instructor_user_id;
      return assigned.includes(person.user_id)||preferred===person.user_id||passes.get(passId(row))?.fixed_instructor_user_id===person.user_id;
    });
    const seasonPasses=new Map(),passSeasons=new Map();
    for(const row of tiedRows){
      const pass=passId(row),season=seasonId(row);
      if(pass&&season){connect(seasonPasses,season,pass);connect(passSeasons,pass,season);}
    }
    const registrations=new Map();let needsReview=false;
    for(const row of tiedRows){
      const pass=passId(row),season=seasonId(row);
      let linkedPass='';
      if(!pass&&season&&seasonPasses.has(season)){
        const linked=seasonPasses.get(season);
        const candidate=linked.size===1?[...linked][0]:'';
        // Merge old/new identifiers only when a stored booking explicitly
        // links them one-to-one. Names, phone numbers and dates never identify
        // a registration. An ambiguous legacy row needs review, not a guess.
        if(candidate&&passSeasons.get(candidate)?.size===1)linkedPass=candidate;
        else needsReview=true;
      }
      const key=pass||linkedPass?`pass:${pass||linkedPass}`:season?`season:${season}`:`reservation:${rowId(row)}`;
      const previous=registrations.get(key)||{reorder:false,season:false};
      previous.season ||= !!(pass||season);
      previous.reorder ||= ownRegistrations?row.reorder_for_me===true:
        (row.is_reorder===true||row.kind==='reorder')&&preferredFor(row)===person.user_id;
      registrations.set(key,previous);
    }
    if(needsReview)return {id:person.user_id,name:person.display_name,count:null,reorder:null,season:null,rate:null,needsReview:true};
    const values=[...registrations.values()],count=values.length,reorder=values.filter(v=>v.reorder).length;
    return {id:person.user_id,name:person.display_name,count,reorder,season:values.filter(v=>v.season).length,rate:count?reorder/count*100:null};
  });
}

export function renderWebReorders({state,escapeHTML:esc}){
  if(state.bookingUnavailable||state.webReordersUnavailable)return `<section class="panel" style="margin-top:24px"><div class="panel-body"><h2>웹 예약 리오더</h2><p class="field-help">예약 지표를 불러오지 못했습니다. 새로고침해 주세요.</p></div></section>`;
  const rows=webReorderRows(state);
  return `<section class="performance-page web-reorder-page"><div class="performance-section-head"><div><span class="performance-eyebrow">WEB REGISTRATIONS</span><h2>웹 예약 리오더</h2><p>같은 강사가 마음에 들어 다시 등록한 예약을 집계합니다. 시즌권·수강권 한 묶음은 등록 1건으로 셉니다.</p></div><span class="performance-period">웹 등록분 · 전체 기간</span></div><section class="panel performance-records"><div class="table-wrap"><table class="performance-table"><thead><tr><th>강사</th><th>배정·지정된 등록</th><th>리오더 등록</th><th>리오더 비율</th><th>시즌·수강권 등록</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${esc(row.name)}</th>${row.needsReview?'<td colspan="4">등록 연결 확인 필요</td>':`<td>${row.count}건</td><td class="performance-number">${row.reorder}건</td><td class="performance-number">${row.rate===null?'—':row.rate.toFixed(1)+'%'}</td><td>${row.season}건</td>`}</tr>`).join('')||'<tr><td colspan="5">등록된 강사 계정이 없습니다.</td></tr>'}</tbody></table></div></section><p class="performance-note">비율 = 해당 강사를 지정한 리오더 등록 ÷ 해당 강사에게 배정되거나 지정된 전체 등록. 기존 시트의 횟수(J열)와 구분하며, 과거 성과 집계는 포함하지 않습니다.</p></section>`;
}
