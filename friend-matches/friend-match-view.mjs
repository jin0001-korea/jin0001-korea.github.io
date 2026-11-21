const states = {
  awaiting_payment:'결제 대기', partially_paid:'상대 결제 대기', paid:'모두 결제 완료 · 입금 확인 대기',
  booked:'예약 접수 완료', cancelled:'매칭 취소', refund_review:'취소·환불 확인 필요'
};
const levelLabels={first:'첫 스키',stop:'A자 멈추기',turn:'S자 턴 가능',onefoot:'한 발 들기 가능',parallel:'11자 주행 가능'};
const goalLabels={first:'스키에 익숙해지기',stop:'안전하게 멈추기',turn:'S자 턴 연결하기',parallel:'11자 주행 배우기',confidence:'자신감 키우기',together:'친구와 함께 연습하기'};
const roleLabel = role => role === 'host' ? '모집자' : '참여자';
function scheduleLabel(slot) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):00$/.exec(slot ?? '');
  if (!match) return String(slot ?? '').replace('T',' ');
  const end = Number(match[2]) + 2;
  return `${match[1]} ${match[2]}:00–${end >= 24 ? '다음날 ' : ''}${String(end % 24).padStart(2,'0')}:00`;
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(label,action,id='',kind='secondary')=>`<button class="btn ${kind} small" type="button" data-fm="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
export function friendStudentNotes(rows=[]){
  return rows.map(p=>{
    const details=[p.birthYear!=null?String(p.birthYear)+'년생':null,p.age!=null?'강습일 기준 '+p.age+'세':null,
      p.experience!=null?'강습 경험 '+p.experience+'회':null,levelLabels[p.level],goalLabels[p.goal]?'강습 목표 · '+goalLabels[p.goal]:null].filter(Boolean);
    return roleLabel(p.role)+' '+p.name+' · '+p.phone+(details.length?'\n'+details.join(' · '):'');
  }).join('\n\n');
}
export function friendPanel(model={}) {
  const requests=model.rows??[];
  const cards=requests.map(row=>{
    const id=esc(row.id);
    const people=row.participants.map(p=>`<div class="fm-person"><strong>${roleLabel(p.role)} · ${esc(p.name)}</strong><span>${esc(p.phone)} · ${esc(p.birthYear)}년생 · 강습 ${esc(p.experience)}회</span><span>${row.paid?.[p.role]?'73,000원 결제 확인':'결제 미확인'}</span></div>`).join('');
    return `<article class="panel fm-card"><header><h3>${esc(scheduleLabel(row.slot))}</h3><strong>${esc(row.state==='paid'&&!row.canAccept?'결제 거래 대조 필요':states[row.state]??'상태 확인 필요')}</strong></header>${people}
      <details><summary>알림톡·결제 안내</summary><p>각자 73,000원 · 2명 합계 146,000원</p>${btn('결제 거래 확인','orders',id)} ${btn('발송 상태 확인','notices',id)} ${btn('현금영수증 요청 확인','receipts',id)}<div data-fm-result aria-live="polite"></div></details>
      ${row.bookingId?`<details><summary>접수된 2대1 팀</summary><p><strong>${esc('[친구찾기]'+row.participants.map(p=>p.name).join('+'))}</strong> · 강습생 2명 · 2시간 1회</p>${btn('두 강습생의 연락처·특이사항','notes',row.bookingId)}<div class="fm-notes" data-fm-result aria-live="polite"></div></details>`:''}</article>`;
  }).join('');
  return `<section class="fm-work" data-fm-page><header><h2>친구 매칭</h2><p>라이즌 2대1 팀의 강습 일정과 두 사람의 결제 상태를 조회합니다.</p></header>
    ${model.error?`<p role="alert">${esc(model.error)}</p>`:''}${model.loading?'<p role="status">매칭 신청을 불러오는 중입니다.</p>':cards||(!model.error?'<p class="panel">접수된 친구 매칭이 없습니다.</p>':'')}
    <div class="fm-nav">${model.offset?btn('이전','prev'):''}${btn('새로고침','refresh')}${requests.length===25?btn('다음','next'):''}</div></section>`;
}
export function bindFriendPanel(root,actions) {
  const panel=root.querySelector('[data-fm-page]');
  if(!panel)return;
  panel.onclick=async event=>{
    const b=event.target.closest('button[data-fm]');if(!b||b.disabled)return;
    const action=b.dataset.fm;
    if(action==='prev'||action==='next'||action==='refresh')return actions.page(action);
    const target=b.closest('details').querySelector('[data-fm-result]'); target.textContent='조회 중입니다.';b.disabled=true;
    try {
      const list=await actions.read(action,b.dataset.id);
      if(!actions.current()||!target.isConnected)return;
      if(action==='notes'){
        target.textContent=friendStudentNotes(list)||'조회된 특이사항이 없습니다.';
      }else if(action==='receipts'){
        target.textContent=(list??[]).map(x=>roleLabel(x.role)+' · '+(x.requested?'발급 요청 '+(x.number||'번호 확인 필요'):'신청 없음')).join(' / ')||'등록된 요청이 없습니다.';
      }else if(action==='orders'){
        const labels={open:'결제창 열림 · 결제 대기',paid:'결제 완료',refund_pending:'환불 처리 중',refund_review:'환불 확인 필요',cancelled:'취소'};
        target.textContent=(list??[]).map(x=>roleLabel(x.role)+' · '+(labels[x.status]||x.status)+' · '+x.orderNo).join(' / ')||'생성된 실결제 주문이 없습니다.';
      }else{
        const failure=(list??[]).filter(x=>['failed','unknown','uncertain','error','ambiguous','indeterminate','rejected','uncertain_delivery'].includes(x.status)).length;
        const names={matched:'매칭 프로필 안내',match:'매칭 프로필 안내',review:'매칭 프로필 안내',payment:'개별 결제 안내',pay:'개별 결제 안내',complete:'완료 안내',review_host:'매칭 프로필 안내',review_guest:'매칭 프로필 안내',confirmed:'확인 안내',cancelled:'취소 안내',cancel:'취소 안내'};
        const statuses={queued:'대기',pending:'대기',sending:'전달 중',sent:'발송 접수',accepted:'발송 접수',delivered:'전달 확인',failed:'실패',unknown:'상태 미확인',uncertain:'상태 미확인',superseded:'이전 안내 종료',suppressed:'중단'};
        const stamp=value=>{const time=new Date(value);return Number.isFinite(time.getTime())?time.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'시각 미확인';};
        target.innerHTML=(list??[]).length?`<p>확인 필요 ${failure}건</p><ul>${list.map(x=>`<li>${roleLabel(x.role)} · ${esc(names[x.kind]||x.kind)} · ${esc(statuses[x.status]||x.status)} · ${esc(stamp(x.updatedAt))}</li>`).join('')}</ul>`:'전송 기록이 없습니다.';
      }
    }catch(error){if(target.isConnected&&actions.current())target.textContent=error.message;}finally{b.disabled=false;}
  };
}
