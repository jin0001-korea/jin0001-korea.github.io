// 후기 관리 — 알림톡 설문으로 고객이 남긴 강사 후기를 승인해 캐치스키·라이즌 사이트
// 위젯에 공개하고, 카톡으로 따로 받은 후기는 직접 입력한다. 데이터는 slope-reviews Edge.
// 규약: renderReviewsAdmin(문자열) + bindReviewsAdmin + clearReviewsAdmin (app.mjs 뷰 패턴).
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BRANDS=[['catchski','캐치스키스쿨'],['risenski','라이즌스키스쿨']];
const brandLabel=value=>BRANDS.find(([key])=>key===value)?.[1]||value;
const stars=count=>'★'.repeat(Math.min(5,Math.max(1,Math.round(Number(count)||0))));
const day=value=>String(value||'').slice(0,10);
const todayKst=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());

export function reviewsAdminState(ui){
  ui.reviewsAdmin??={brand:'catchski',queue:[],list:null,loading:false,error:'',notice:'',busy:false,form:{instructorName:'',rating:5,body:'',reviewDate:''}};
  return ui.reviewsAdmin;
}
export function clearReviewsAdmin(ui){delete ui.reviewsAdmin;ui.reviewsAdminLoading=false;ui.reviewsAdminError='';}

const CSS=`<style>
.rv-wrap{display:grid;gap:14px}
.rv-wrap .panel{background:#fff;border:1px solid #e3e6eb;border-radius:14px;padding:16px}
.rv-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.rv-head h2{font-size:17px;margin:0}
.rv-note{font-size:12px;color:#6b7280;margin:2px 0 10px}
.rv-item{border-top:1px solid #eef0f3;padding:10px 0;font-size:13px}
.rv-item b{font-size:14px}
.rv-item .rv-meta{color:#6b7280;margin:2px 0 4px;font-size:12px}
.rv-item .rv-body{white-space:pre-wrap;word-break:break-word}
.rv-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.rv-actions input{max-width:150px;padding:6px 8px;border:1px solid #e3e6eb;border-radius:8px;font:inherit}
.rv-msg{font-size:13px;margin:6px 0}.rv-msg.ok{color:#059669}.rv-msg.err{color:#dc2626}
.rv-form{display:grid;gap:8px;max-width:640px}
.rv-form label{font-size:12px;color:#6b7280}
.rv-form input,.rv-form textarea{width:100%;padding:9px;border:1px solid #e3e6eb;border-radius:8px;font:inherit}
.rv-form textarea{min-height:110px;resize:vertical}
.rv-row{display:flex;gap:10px;flex-wrap:wrap}.rv-row>div{flex:1;min-width:160px}
.rv-stars{font-size:24px;cursor:pointer;user-select:none;letter-spacing:2px}
.rv-stars span{color:#d1d5db}.rv-stars span.on{color:#f59e0b}
.rv-brand-toggle{display:flex;gap:8px}
.rv-brand-toggle button{flex:0 0 auto}
.rv-star-badge{color:#f59e0b;font-weight:700}
.rv-empty{color:#6b7280;font-size:13px;padding:10px 0}
</style>`;

export function renderReviewsAdmin({profile,ui,busy=false}={}){
  const u=reviewsAdminState(ui);
  const locked=busy||u.busy||ui?.booking?.demo;
  const queue=(u.queue||[]).filter(item=>(item.publishedBrands||[]).length<BRANDS.length);
  const queueItems=queue.map((item,index)=>{
    const published=item.publishedBrands||[];
    return `<div class="rv-item" data-rv-queue-item="${index}">
      <b>${esc(item.instructorName||'강사 미확인')} · <span class="rv-star-badge">${stars(item.overall)}</span></b>
      <div class="rv-meta">제출 ${esc(day(item.submittedAt))}${item.lessonDate?` · 강습일 ${esc(day(item.lessonDate))}`:''}${published.length?` · 공개됨: ${published.map(brandLabel).map(esc).join(', ')}`:''}</div>
      <div class="rv-body">${esc(item.praise||'')}</div>
      <div class="rv-actions">
        ${item.instructorName?'':`<input data-rv-queue-name="${index}" placeholder="강사 이름 입력" ${locked?'disabled':''}>`}
        ${BRANDS.map(([key,label])=>published.includes(key)
          ?`<button type="button" class="btn secondary small" disabled>${esc(label)} 공개됨</button>`
          :`<button type="button" class="btn primary small" data-rv-publish="${index}:${key}" ${locked?'disabled':''}>${esc(label)}에 공개</button>`).join('')}
      </div>
    </div>`;
  }).join('');
  const list=u.list;
  const listItems=(list?.reviews||[]).slice(0,30).map(review=>`<div class="rv-item">
      <b>${esc(review.instructorName)} · <span class="rv-star-badge">${stars(review.rating)}</span></b>
      <div class="rv-meta">${esc(day(review.reviewDate))}${review.photos?.length?` · 사진 ${review.photos.length}장`:''}</div>
      <div class="rv-body">${esc(review.body.length>160?review.body.slice(0,160)+'…':review.body)}</div>
      <div class="rv-actions"><button type="button" class="btn ghost small" data-rv-delete="${esc(review.id)}" ${locked?'disabled':''}>사이트에서 내리기</button></div>
    </div>`).join('');
  const form=u.form;
  return `${CSS}<section class="rv-wrap" data-reviews-admin aria-label="후기 관리">
    <section class="panel" data-rv-section="queue">
      <div class="rv-head"><h2>고객 설문 후기 대기열</h2><button type="button" class="btn secondary small" data-rv-refresh ${locked?'disabled':''}>새로고침</button></div>
      <p class="rv-note">강습 후 알림톡 설문으로 고객이 남긴 후기입니다. 버튼을 누르면 해당 사이트 후기 위젯에 <b>고객이 쓴 그대로</b> 게시됩니다.</p>
      ${u.error?`<p class="rv-msg err" role="alert">${esc(u.error)}</p>`:''}
      ${u.notice?`<p class="rv-msg ok" role="status">${esc(u.notice)}</p>`:''}
      ${u.loading?'<p class="rv-empty">불러오는 중…</p>':queueItems||'<p class="rv-empty">공개 대기 중인 설문 후기가 없습니다. 고객이 제출하면 여기에 나타납니다.</p>'}
    </section>
    <section class="panel" data-rv-section="manual">
      <div class="rv-head"><h2>후기 직접 입력</h2></div>
      <p class="rv-note">카카오톡 등으로 따로 받은 후기를 그대로 옮겨 게시할 때 사용합니다.</p>
      <div class="rv-form">
        <div class="rv-brand-toggle">${BRANDS.map(([key,label])=>`<button type="button" class="btn ${u.brand===key?'primary':'secondary'} small" data-rv-brand="${key}" ${locked?'disabled':''}>${esc(label)}</button>`).join('')}</div>
        <div class="rv-row">
          <div><label>강사 이름</label><input data-rv-form="instructorName" list="rv-instructors" value="${esc(form.instructorName)}" ${locked?'disabled':''}><datalist id="rv-instructors">${(list?.summary?.instructors||[]).map(item=>`<option value="${esc(item.name)}"></option>`).join('')}</datalist></div>
          <div><label>후기 받은 날짜</label><input type="date" data-rv-form="reviewDate" value="${esc(form.reviewDate||todayKst())}" ${locked?'disabled':''}></div>
        </div>
        <div><label>별점</label><div class="rv-stars" data-rv-stars>${[1,2,3,4,5].map(n=>`<span class="${n<=form.rating?'on':''}" data-rv-star="${n}">★</span>`).join('')}</div></div>
        <div><label>후기 내용</label><textarea data-rv-form="body" ${locked?'disabled':''}>${esc(form.body)}</textarea></div>
        <button type="button" class="btn primary" data-rv-create ${locked?'disabled':''}>${esc(brandLabel(u.brand))}에 게시</button>
      </div>
    </section>
    <section class="panel" data-rv-section="list">
      <div class="rv-head"><h2>게시된 후기 · ${esc(brandLabel(u.brand))}${list?.summary?.count?` ${list.summary.count}건 · 평균 <span class="rv-star-badge">★${esc(String(list.summary.average))}</span>`:''}</h2>
        <button type="button" class="btn secondary small" data-rv-copy-ld ${locked||!list?.summary?.count?'disabled':''}>아임웹 헤더용 JSON-LD 복사</button></div>
      <p class="rv-note">위젯에 노출 중인 후기입니다. JSON-LD는 아임웹 [환경설정→헤더 코드]에 붙여넣으면 AI 검색엔진도 후기·별점을 읽습니다(후기 갱신 시 재복사).</p>
      ${listItems||'<p class="rv-empty">아직 게시된 후기가 없습니다.</p>'}
    </section>
  </section>`;
}

export function bindReviewsAdmin(root,{ui,onChange,onAction,onError,isCurrent=()=>true}={}){
  const u=reviewsAdminState(ui);
  const section=root.querySelector('[data-reviews-admin]');if(!section)return;
  const guard=()=>isCurrent()&&!u.busy;
  const run=async(work,successNotice)=>{
    if(!guard())return;
    u.busy=true;u.error='';u.notice='';onChange?.();
    try{await work();if(!isCurrent())return;if(successNotice)u.notice=successNotice;}
    catch(error){if(!isCurrent())return;u.error=String(error?.message||error);onError?.(u.error);}
    finally{if(isCurrent()){u.busy=false;onChange?.();}}
  };
  section.querySelector('[data-rv-refresh]')?.addEventListener('click',()=>run(async()=>{
    const queue=await onAction('queue',{});u.queue=queue.queue||[];
    const list=await onAction('list',{brand:u.brand});u.list=list;
  }));
  section.querySelectorAll('[data-rv-brand]').forEach(button=>button.addEventListener('click',()=>{
    if(!guard()||u.brand===button.dataset.rvBrand)return;
    u.brand=button.dataset.rvBrand;u.list=null;onChange?.();
    run(async()=>{u.list=await onAction('list',{brand:u.brand});});
  }));
  section.querySelectorAll('[data-rv-publish]').forEach(button=>button.addEventListener('click',()=>{
    const [indexText,brand]=button.dataset.rvPublish.split(':');
    const item=(u.queue||[]).filter(entry=>(entry.publishedBrands||[]).length<BRANDS.length)[Number(indexText)];
    if(!item)return;
    const nameInput=section.querySelector(`[data-rv-queue-name="${indexText}"]`);
    return run(async()=>{
      await onAction('publish',{publishScoreId:item.scoreId,brand,instructorName:nameInput?nameInput.value.trim():''});
      const queue=await onAction('queue',{});u.queue=queue.queue||[];
      if(brand===u.brand)u.list=await onAction('list',{brand:u.brand});
    },`${brandLabel(brand)} 사이트에 공개했습니다.`);
  }));
  section.querySelector('[data-rv-stars]')?.addEventListener('click',event=>{
    const star=Number(event.target?.dataset?.rvStar);if(!star||!guard())return;
    u.form.rating=star;onChange?.();
  });
  section.querySelectorAll('[data-rv-form]').forEach(input=>input.addEventListener('input',()=>{u.form[input.dataset.rvForm]=input.value;}));
  section.querySelector('[data-rv-create]')?.addEventListener('click',()=>{
    const form=u.form;
    if(!form.instructorName.trim()){u.error='강사 이름을 입력해 주세요.';onChange?.();return;}
    if(!form.body.trim()){u.error='후기 내용을 입력해 주세요.';onChange?.();return;}
    return run(async()=>{
      await onAction('create',{brand:u.brand,instructorName:form.instructorName.trim(),rating:form.rating,body:form.body.trim(),reviewDate:form.reviewDate||todayKst(),photos:[]});
      u.form={instructorName:'',rating:5,body:'',reviewDate:''};
      u.list=await onAction('list',{brand:u.brand});
    },'게시했습니다. 사이트 위젯에 바로 반영됩니다(최대 5분 캐시).');
  });
  section.querySelectorAll('[data-rv-delete]').forEach(button=>button.addEventListener('click',()=>{
    if(!confirm('이 후기를 사이트에서 내릴까요? 설문 후기라면 대기열로 돌아갑니다.'))return;
    return run(async()=>{
      await onAction('remove',{id:button.dataset.rvDelete});
      u.list=await onAction('list',{brand:u.brand});
      const queue=await onAction('queue',{});u.queue=queue.queue||[];
    },'사이트에서 내렸습니다.');
  }));
  section.querySelector('[data-rv-copy-ld]')?.addEventListener('click',()=>run(async()=>{
    const data=u.list;if(!data?.summary?.count)throw new Error('복사할 후기가 없습니다.');
    const payload={'@context':'https://schema.org','@type':'Service',name:`${data.brandName} 스키·보드 강습`,
      provider:{'@type':'LocalBusiness',name:data.brandName},
      aggregateRating:{'@type':'AggregateRating',ratingValue:data.summary.average,reviewCount:data.summary.count,bestRating:5,worstRating:1},
      review:data.reviews.slice(0,10).map(review=>({'@type':'Review',author:{'@type':'Person',name:'수강생'},datePublished:review.reviewDate,reviewBody:review.body.slice(0,500),name:`${review.instructorName} 강사 강습 후기`,reviewRating:{'@type':'Rating',ratingValue:review.rating,bestRating:5,worstRating:1}}))};
    const html='<script type="application/ld+json">'+JSON.stringify(payload,null,1).replace(/</g,'\\u003c')+'<'+'/script>';
    await navigator.clipboard.writeText(html);
  },'JSON-LD를 복사했습니다. 아임웹 헤더 코드에 붙여넣어 주세요.'));
}
