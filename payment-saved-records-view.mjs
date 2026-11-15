// Saved details come only from the exact ledger target and current persisted
// records. A frozen analysis draft is never a fallback for a saved reservation.
const list=value=>Array.isArray(value)?value:[];
const text=value=>value===null||value===undefined?'':String(value).trim();
const first=(row,...keys)=>{for(const key of keys)if(row?.[key]!==undefined&&row[key]!==null&&row[key]!=='')return row[key];return undefined;};
const rawOf=row=>row?.raw||row?.raw_data||{};
const idOf=row=>text(first(row,'id','scheduleId','schedule_id'));
const shown=value=>text(value)||'미확인';
const number=value=>{if(value===null||value===undefined||value==='')return null;const input=typeof value==='string'?value.trim():value;if(typeof input!=='number'&&(typeof input!=='string'||!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(input)))return null;const n=Number(typeof input==='string'?input.replaceAll(',',''):input);return Number.isSafeInteger(n)&&n>=0?n:null;};
const won=value=>{const n=number(value);return n===null?'미확인':`${n.toLocaleString('ko-KR')}원`;};
const unit=(value,suffix)=>number(value)===null?'미확인':`${number(value)}${suffix}`;
const boolean=(value,yes='예',no='아니요')=>value===true?yes:value===false?no:'미확인';
const sport=value=>({ski:'스키',board:'보드'})[value]||shown(value);
const escapeFallback=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function lifecycle(row,kind){
  const state=text(row?.status).toLowerCase(),name=kind==='pass'?'수강권':'예약';
  if(state==='deleted'||row.deletedAt||row.deleted_at)return {readOnly:true,label:`삭제된 ${name}`};
  if(state==='refunded'||row.refundedAt||row.refunded_at)return {readOnly:true,label:`환불된 ${name}`};
  if(['cancelled','canceled'].includes(state)||row.cancelledAt||row.cancelled_at)return {readOnly:true,label:`취소된 ${name}`};
  return {readOnly:kind==='pass',label:kind==='pass'?(state==='expired'?'만료된 수강권':'수강권 저장 완료'):'예약 저장 완료'};
}
function instructorName(id,context){
  const rows=list(context.roster).filter(row=>text(first(row,'user_id','userId','id'))===text(id));
  return rows.length===1?shown(first(rows[0],'display_name','displayName','name')):'미확인';
}
function instructors(row,context){
  const schedule=list(context.schedules).find(value=>idOf(value)===idOf(row)),ids=[];
  for(const source of [row,schedule]){
    for(const key of ['instructorIds','instructorUserIds','instructor_ids','instructor_user_ids'])for(const id of list(source?.[key]))if(text(id))ids.push(text(id));
    const single=first(source,'instructorUserId','instructor_user_id');if(text(single))ids.push(text(single));
  }
  const unique=[...new Set(ids)];return unique.length?unique.map(id=>instructorName(id,context)).join(', '):shown(first(rawOf(row),'F')||first(row,'instructorName','instructor_name'));
}
function participants(row){
  if(!Array.isArray(row.participants)||!row.participants.length)return '미확인';
  return row.participants.map((person,index)=>{
    const type=({adult:'성인',minor:'어린이'})[person?.type]||'구분 미확인',age=number(person?.age),name=text(person?.name);
    return `${name||`${index+1}번`} · ${type}${age===null?' · 나이 미확인':` ${age}세`}`;
  }).join('\n');
}
function fieldsFor(row,kind,allocationAmount,context){
  const raw=rawOf(row),field=(key,label,value)=>({key,label,value:shown(value)}),pass=kind==='pass';
  const separatePhone=first(row,'teamPhoneMode','team_phone_mode')==='separate',customerPhone=first(row,'customerContactPhone','customer_contact_phone')??(separatePhone?undefined:first(row,'phone')??first(raw,'L'));
  const rentalStatus=first(row,'rentalPaymentStatus','rental_payment_status'),rentalFee=rentalStatus==='free'?0:number(first(row,'rentalAmount','rental_amount'));
  const lessonFee=number(first(raw,'T')??first(row,'lessonFee','lesson_fee')),paid=number(first(raw,'Y')??first(row,'paidAmount','paid_amount'));
  const override=number(first(row,'currentAmountOverride','current_amount_override'));
  const calculated=lessonFee!==null&&rentalFee!==null&&['free','paid','onsite_unpaid'].includes(rentalStatus)?lessonFee+rentalFee:null;
  const requested=override??calculated??number(first(raw,'X')??first(row,'requestedAmount','requested_amount'));
  const balance=requested!==null&&paid!==null?Math.max(0,requested-paid):number(first(raw,'Z')??first(row,'balanceAmount','balance_amount'));
  const preferred=first(row,'preferredInstructorId','preferred_instructor_user_id','fixedInstructorId','fixed_instructor_user_id');
  const lessonMinutes=first(row,'lessonMinutes','lesson_minutes'),duration=number(lessonMinutes)!==null?unit(lessonMinutes,'분'):shown(first(raw,'N'));
  const receipt=first(row,'cashReceiptRequested','cash_receipt_requested'),receiptNumber=first(row,'cashReceiptNumber','cash_receipt_number');
  const values=[
    field('customerName','고객명',first(raw,'H')??first(row,'customerName','customer_name')),
    field('phone','고객 연락처',customerPhone),
    field('company','업체',first(raw,'E')??first(row,'company')),
    field('teamName',pass?'강습생·팀':'팀',first(raw,'I')??first(row,'teamName','team_name','learnerName','learner_name')),
    field('bookingKind','예약 구분',({single:'일반 강습',reorder:'재예약',season:'시즌권'})[row.kind]||shown(row.kind)),
    field('isReorder','재예약 여부',boolean(first(row,'isReorder','is_reorder'))),
    field('designated','강사 지정',boolean(first(row,'designated'),'지정','미지정')),
    field('teamPhone','팀 연락처',first(raw,'L')??first(row,'phone')),
    field('sport','종목',sport(first(raw,'D')??first(row,'sport'))),
    field('studentCount','강습 인원',unit(first(raw,'M')??first(row,'studentCount','student_count'),'명')),
    field('participants','강습생·나이',participants(row)),
    field('experienceCount','이전 강습 경험',unit(first(row,'experienceCount','experience_count'),'회')),
    field('ability','현재 수준',first(raw,'O')??first(row,'ability')),
    field('juniorPreparation','주니어 기술등급 준비',boolean(first(row,'juniorPreparation','junior_preparation'),'준비함','준비하지 않음')),
    field('parallelLongTurn','스키 패러렐 롱턴',boolean(first(row,'parallelLongTurn','parallel_long_turn'),'가능','불가')),
    field('snowboardNoviceTurn','보드 너비스턴',boolean(first(row,'snowboardNoviceTurn','snowboard_novice_turn'),'가능','불가')),
    field('assignedInstructor','배정 강사',instructors(row,context)),
    field('preferredInstructor',pass?'지정 강사':'희망 강사',preferred?instructorName(preferred,context):'미확인'),
    field('date','강습일',first(raw,'A')??first(row,'date')),
    field('startTime','시작 시간',first(raw,'B')??first(row,'startTime','start_time')),
    field('endTime','종료 시간',first(raw,'C')??first(row,'endTime','end_time')),
    field('lessonMinutes','강습시간',duration),
    field('breakMinutes','중간 휴식',unit(first(row,'breakMinutes','break_minutes'),'분')),
    field('rentalHours','장비 이용시간',unit(first(row,'rentalHours','rental_hours'),'시간')),
    field('rentalPaymentStatus','장비 결제',({free:'무료',paid:'결제 완료',onsite_unpaid:'미결제'})[rentalStatus]||'미확인'),
    field('rentalFee','장비금액',won(rentalFee)),
    field('lessonFee','강습료',won(lessonFee)),
    field('allocationAmount','이 입금에서 배분한 금액',won(allocationAmount)),
    field('paidAmount','현재 입금액',won(paid)),
    field('requestedAmount','현재 요청금액',won(requested)),
    field('balanceAmount','추가입금 필요액',won(balance)),
    field('cashReceiptRequested','현금영수증',boolean(receipt,'요청','미요청')),
    field('cashReceiptNumber','현금영수증 번호',receiptNumber??(first(row,'cashReceiptNumberSet','cash_receipt_number_set')===true?'등록됨':'미확인')),
    field('notes','특이사항',first(raw,'G')??first(row,'notes')),
    field('sessionNotes','회차별 메모',first(raw,'P')??first(row,'sessionNotes','session_notes')),
  ];
  if(pass)values.splice(6,0,field('totalSessions','발급 횟수',unit(first(row,'totalSessions','total_sessions'),'회')));
  return values;
}

export function savedPaymentRecords(review={},context={}){
  review=review&&typeof review==='object'&&!Array.isArray(review)?review:{};
  context=context&&typeof context==='object'&&!Array.isArray(context)?context:{};
  return list(review.allocations).map((allocation,index)=>{
    const reservationId=text(allocation?.reservationId),passId=text(allocation?.lessonPassId),kind=reservationId&&!passId?'reservation':passId&&!reservationId?'pass':'unknown',id=kind==='reservation'?reservationId:kind==='pass'?passId:'';
    const rows=kind==='reservation'?list(Array.isArray(context.paymentReservations)?context.paymentReservations:context.reservations):kind==='pass'?list(context.lessonPasses):[];
    const matches=id?rows.filter(row=>idOf(row)===id):[],record=matches.length===1?matches[0]:null,missing=!record,key=kind==='unknown'?`missing:${index}`:`${kind}:${id}`;
    if(missing)return {key,kind,id,allocationAmount:allocation?.amount,record:null,missing:true,canEdit:false,statusLabel:'저장 내역 미확인',summary:matches.length>1?'연결된 저장 기록을 하나로 확인하지 못했습니다.':'연결된 저장 기록을 현재 목록에서 찾지 못했습니다.',fields:[]};
    const state=lifecycle(record,kind),fields=fieldsFor(record,kind,allocation.amount,context),get=key=>fields.find(field=>field.key===key)?.value||'미확인';
    const summary=kind==='pass'?`${get('teamName')} · ${get('totalSessions')}`:`${get('teamName')} · ${get('date')} ${get('startTime')}`;
    return {key,kind,id,allocationAmount:allocation.amount,record,missing:false,canEdit:kind==='reservation'&&!state.readOnly,statusLabel:state.label,summary,fields};
  });
}

export function renderSavedPaymentRecords(panel,escape=escapeFallback){
  if(!panel)return '';
  const rows=savedPaymentRecords(panel.review,panel.bookingContext),selected=rows.find(row=>row.key===panel.selectedKey)||rows[0],busy=!!(panel.loading||panel.editing),error=text(panel.error)||(selected?.missing?selected.summary:'');
  return `<div class="pr-saved-detail-layer"><section class="pr-saved-detail-dialog" data-pr-saved-details role="dialog" aria-modal="true" aria-labelledby="pr-saved-detail-title" aria-busy="${busy}"><header><div><h2 id="pr-saved-detail-title">저장된 예약·수강권</h2><p>현재 저장된 내용을 확인합니다.</p></div><button type="button" class="icon-btn" data-pr-saved-close aria-label="저장 내역 닫기" ${panel.editing?'disabled':''}>×</button></header><div class="pr-saved-detail-body"><nav class="pr-saved-detail-list" aria-label="이 입금으로 저장한 내역">${rows.map(row=>`<button type="button" class="${row.key===selected?.key?'selected':''}" data-pr-saved-select="${escape(row.key)}" value="${escape(row.key)}" aria-pressed="${row.key===selected?.key}" ${busy?'disabled':''}><strong>${escape(row.summary)}</strong><span>${escape(row.statusLabel)} · ${escape(won(row.allocationAmount))}</span></button>`).join('')}</nav><div data-pr-saved-error role="alert" ${error?'':'hidden'}>${escape(error)}</div>${panel.loading?'<p role="status">저장된 내역을 불러오는 중…</p>':selected&&!selected.missing?`<section class="pr-saved-detail-record"><h3>${escape(selected.summary)}</h3><p class="pr-saved-detail-status">${escape(selected.statusLabel)}${selected.canEdit?'':' · 조회만 가능'}</p><dl class="pr-saved-detail-grid">${selected.fields.map(field=>`<div class="${['notes','sessionNotes','participants'].includes(field.key)?'pr-saved-detail-wide':''}"><dt>${escape(field.label)}</dt><dd data-pr-saved-field="${escape(field.key)}">${escape(field.value)}</dd></div>`).join('')}</dl></section>`:!selected?'<p class="pr-saved-detail-empty">이 입금에 연결된 저장 내역이 없습니다.</p>':''}</div><footer><button type="button" class="btn secondary" data-pr-saved-reload ${busy?'disabled':''}>새로고침</button>${selected?.canEdit?`<button type="button" class="btn primary" data-pr-saved-edit="${escape(selected.id)}" value="${escape(selected.id)}" ${busy?'disabled':''}>수정 작성하기</button>`:''}</footer></section></div>`;
}
