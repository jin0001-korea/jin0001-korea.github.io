import {renderPaymentReview,bindPaymentReview,hasPaymentReviewWork,hasPaymentReviewInFlight,suspendPaymentReview,clearPaymentReview,adoptPaymentReviewSave} from './payment-review-view.mjs?v=102';
import {createPaymentBookingDrafts,createPaymentPassDraft,paymentReviewBookingType} from './payment-review-booking.mjs?v=86';
import {renderCallInbox,bindCallInbox,hasUnsavedCallDraft,matchingCallCustomers} from './call-inbox-view.mjs?v=28';
import {renderSmsInbox,renderFormInbox,bindSmsInbox,refreshSmsThread,refreshSmsSyncStatuses,rememberSmsReadPosition,hasSmsFilterDraft,clearSmsMediaViews} from './sms-inbox-view.mjs?v=29';
import {renderKakaoInbox,bindKakaoInbox} from './kakao-inbox-view.mjs?v=1';
import {hasSmsHistoryWork,isSmsHistoryOpen,clearSmsHistory} from './sms-history-view.mjs?v=12';
import {buildCallTaskerProject,CALL_INGEST_ENDPOINT} from './call-tasker-setup.mjs?v=16';
import {canonicalTelephone,formatTelephone} from './customer-teams.mjs?v=28';
import {selectActiveCustomerNotices} from './customer-notice-filter.mjs?v=1';
import {renderSheetsSync} from './sheets-sync-view.mjs?v=1';
import {renderCustomerChanges,bindCustomerChanges,canReviewCustomerChanges,customerRequestKey} from './customer-change-view.mjs?v=23';
import {bindRentalBridgePanels} from './rental-bridge-view.mjs?v=31';
import {renderBookingPage,bindBookingPage,getBookingContext,createBookingDraft,renderBookingEditor,normalizeBookingRow,selectBookingRows,openBookingDraft,suspendBookingDrafts,applyReservationCancellation,buildQuickAmountChange,preparePaymentDirectCommit,applyPassCarryDraft} from './booking-view.mjs?v=121';
import {hasUnsavedTeamDrafts} from './team-drafts.mjs?v=36';
import {recoverSavedBooking} from './booking-save-recovery.mjs?v=81';
import {ASSIGNMENT_REASON_LABELS,parseKstDate,parseLessonInterval,lessonIntervalsOverlap,applyLessonPlan,parseLessonTime} from './booking-rules.mjs?v=36';
import {buildAssignmentPlan} from './assignment-plan.mjs?v=29';
import {renderAssignmentPlan,bindAssignmentPlan,assignmentSaveMessage} from './assignment-view.mjs?v=28';
import {renderTimetable,bindTimetable} from './timetable-view.mjs?v=29';
import {renderPasses,renderPaymentPassIssue,renderPassDialogs,bindPasses,selectPassBalances} from './pass-view.mjs?v=56';
import {renderCustomers,bindCustomers,hasUnsavedCustomerDraft,suspendCustomerEditor} from './customer-view.mjs?v=44';
import {deleteDemoCustomer,customerDeletionConfirmed} from './customer-delete.mjs?v=2';
import {renderCustomerNotices,bindCustomerNotices,customerNoticeMessage,CUSTOMER_PORTAL} from './customer-notice-view.mjs?v=40';
import {customerDirectorySelection,customerDirectoryPayload,customerTeamPayload} from './customer-directory.mjs?v=36';
import {canUseBooking,bookingRoleLabel,isUnifiedBookingLocation,bookingStaffLinks,bookingAdminNavigation} from './booking-access.mjs?v=27';
import {renderReviewsAdmin,bindReviewsAdmin,clearReviewsAdmin,reviewsAdminState} from './reviews-admin-view.mjs?v=1';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const kstDay=(value=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const paths={plus:'M12 5v14M5 12h14',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3-1 2 3-2 3 2 3-2 4-3-1-1 3h-4l-1-3-3 1-2-4 2-3-2-3 2-3 3 1 1-3Z',close:'m6 6 12 12M6 18 18 6',arrow:'m9 5 7 7-7 7'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.arrow}"/></svg>`;
const emptyState=()=>({profile:null,roster:[],schedules:[],reservations:[],seasonPackages:[],lessonPasses:[],reservationChanges:[],customers:[],customerTeams:[],capabilities:[],timeOffRequests:[],settings:{},bookingUnavailable:null});
// 수강권 탭 폐지(2026-11-20 사용자 지시): 수강권 블록은 예약표의 전체 예약·배정표 아래에 함께 렌더된다. 옛 #passes 링크는 예약표로 보낸다.
import {friendPanel,bindFriendPanel,friendStudentNotes} from './friend-match-view.mjs?v=2';
const viewFromHash=()=>['timetable','customers','notices','changes','calls','payments','friends'].includes(location.hash.slice(1))?location.hash.slice(1):'reservations';
const initialUi=()=>({role:null,view:viewFromHash(),communicationTab:'calls',booking:{demo:true},timetable:{},passes:{},customers:{},customerChanges:{status:'pending',notes:{},requests:[],loading:false,error:''}});
let state=emptyState(),ui=initialUi();
let api=null,apiPromise=null,operational=false,checkingSession=true,signingIn=false,dirty=false,refreshError='',accessError=null,authVersion=0,writeVersion=0,readPromise=null,activeWrite=null,activePlan=null;
const app=$('#app'),dialog=$('#desk-login-dialog'),form=$('#desk-login-form');
const isAuthError=error=>['AUTH_REQUIRED','ADMIN_REQUIRED','BOOKING_ACCESS_REQUIRED','ACCOUNT_DISABLED','PASSWORD_SETUP_REQUIRED'].includes(error?.code);
function toast(message){const node=$('#toast');node.textContent=message;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,4500);}
function hasOperator(){return operational&&canUseBooking(state.profile);}
function mustBeOperator(){if(!hasOperator())throw Object.assign(new Error('실제 예약은 운영 로그인 후 이용해 주세요.'),{code:'AUTH_REQUIRED'});}
function context(){
  let value=getBookingContext(state,ui,new Date());
  if(ui.booking.demo&&!ui.booking.demoData.rentalDemoSeeded){
    const demo=ui.booking.demoData;
    const examples=[['paid',4,13000],['paid',6,18000],['free',null,0],['onsite_unpaid',4,13000],['paid',6,16000]];
    demo.rows.slice(0,examples.length).forEach((row,index)=>{
      const [rentalPaymentStatus,rentalHours,rentalAmount]=examples[index];
      Object.assign(row,{rentalPaymentStatus,rentalHours,rentalAmount});
    });
    demo.rentalDemoSeeded=true;value=getBookingContext(state,ui,new Date());
  }
  if(ui.booking.demo&&!ui.booking.demoData.passDemoSeeded){
    const demo=ui.booking.demoData;
    demo.lessonPasses??=[];
    if(!demo.lessonPasses.length)demo.lessonPasses.push(
      {id:'DEMO-PASS-10',customer_name:'체험 보호자 · 스키',learner_name:'체험 수강생 · 스키',phone:'',sport:'스키',total_sessions:10,fixed_instructor_user_id:null,notes:'일정을 정하기 전 보유한 10회 수강권',created_at:new Date().toISOString()},
      {id:'DEMO-PASS-20',customer_name:'체험 보호자 · 보드',learner_name:'체험 수강생 · 보드',phone:'',sport:'보드',total_sessions:20,fixed_instructor_user_id:demo.roster[0]?.user_id||null,notes:'담당 강사를 지정한 20회 수강권',created_at:new Date().toISOString()}
    );
    demo.passDemoSeeded=true;value=getBookingContext(state,ui,new Date());
  }
  if(ui.booking.demo&&!ui.booking.demoData.customerDemoSeeded){
    const demo=ui.booking.demoData,stamp=new Date().toISOString();
    const customerId='d0000000-0000-4000-8000-000000000001',otherId='d0000000-0000-4000-8000-000000000002';
    demo.customers=[{id:customerId,name:'체험 가족(가상)',contacts:[{label:'엄마',phone:'01000000001'},{label:'아빠',phone:'01000000002'}],notes:'서로 다른 연락처로 예약하는 가족 예시',updated_at:stamp},
      {id:otherId,name:'체험 가족(가상)',contacts:[{label:'대표 연락처',phone:'01000000009'}],notes:'이름은 같지만 별도 고객인 예시',updated_at:stamp}];
    demo.customerTeams=[{id:'d1000000-0000-4000-8000-000000000001',customer_id:customerId,name:'첫째',phone:'01000000001',defaults:{sport:'스키',age:10,experienceCount:3,parallelLongTurn:false,raw:{D:'스키',M:'1',N:'2시간'}},updated_at:stamp},
      {id:'d1000000-0000-4000-8000-000000000002',customer_id:customerId,name:'막내',phone:'01000000002',defaults:{sport:'스키',age:9,experienceCount:5,parallelLongTurn:true,raw:{D:'스키',M:'1',N:'2시간'}},updated_at:stamp}];
    for(const row of demo.rows){if(row.raw?.H!=='체험 가족(가상)'||row.raw?.L!=='010-0000-0001')continue;const team=demo.customerTeams.find(item=>item.name===row.raw.I);if(team){row.customerId=customerId;row.customerTeamId=team.id;}}
    for(const pack of demo.seasonPackages){const row=demo.rows.find(item=>(item.seasonId||item.season_id)===pack.id);if(row?.customerId){pack.customer_id=row.customerId;pack.customer_team_id=row.customerTeamId;}}
    demo.customerDemoSeeded=true;value=getBookingContext(state,ui,new Date());
  }
  return {...value,paymentReservations:ui.booking.demo?value.reservations:state.paymentReservations||value.reservations};
}
function loginError(message){const node=$('#desk-login-error');node.textContent=message;node.hidden=!message;}
function getApi(){return apiPromise??=(import('./desk-api.mjs?v=106').then(module=>{api=module;module.onSessionChange((event,session)=>{
  if(signingIn)return;
  if(event==='SIGNED_OUT'&&(operational||checkingSession)){const wasOperational=operational;checkingSession=false;clearOperations();if(wasOperational)toast('운영 로그인이 종료되었습니다. 다시 로그인해 주세요.');return;}
  if((event==='SIGNED_IN'&&session?.user?.id&&session.user.id!==state.profile?.user_id&&(operational||checkingSession))||(event==='USER_UPDATED'&&operational)){clearOperations();checkingSession=true;void bootDesk();}
});return module;}));}
function planDialog(){let node=$('#desk-plan-dialog');if(!node){node=document.createElement('dialog');node.id='desk-plan-dialog';node.className='desk-plan-dialog';node.addEventListener('cancel',event=>{if(activeWrite)event.preventDefault();else{activePlan=null;node.innerHTML='';}});document.body.append(node);}return node;}
function closePlan(){activePlan=null;const node=$('#desk-plan-dialog');if(node){if(node.open)node.close();node.innerHTML='';}}
function clearOperationalDialogs(){closePlan();closeCustomerLink();const node=$('#desk-assignment-dialog');if(node){if(node.open)node.close();node.innerHTML='';}if(dialog.open)dialog.close();form.elements.password.value='';loginError('');}
function clearOperations(){clearPaymentReview(ui);clearReviewsAdmin(ui);clearSmsMediaViews(ui);clearSmsHistory(ui);authVersion++;writeVersion++;activeWrite=null;readPromise=null;operational=false;state=emptyState();const view=ui.view;ui=initialUi();ui.view=view;dirty=false;refreshError='';accessError=null;clearOperationalDialogs();render();}
const pendingBookingDrafts=()=>ui.booking?.teamDeck?.cards?.length?hasUnsavedTeamDrafts(ui.booking.teamDeck):(dirty&&!!ui.booking?.drawer&&!!ui.booking?.draft);
function canLeaveBookingMode(){if(hasPaymentReviewInFlight(ui)){toast('사진 전송·저장을 마친 뒤 이동해 주세요.');return false;}if(hasSmsHistoryWork(ui)){toast('과거 문자 가져오기를 마치거나 가져오기 화면을 닫은 뒤 이동해 주세요.');return false;}if(activeWrite||ui.booking?.deckSaving||ui.customers?.saving){toast('현재 저장이 끝난 뒤 이용해 주세요.');return false;}if(hasUnsavedCallDraft(ui)){toast('작성 중인 상담 기록이나 휴대폰 설정을 먼저 저장해 주세요.');return false;}if(pendingBookingDrafts()||hasUnsavedCustomerDraft(ui)){toast('작성 중인 고객·팀 정보를 저장하거나 비운 뒤 전환해 주세요.');return false;}return true;}
async function exitOperations(){if(!canLeaveBookingMode())return false;clearOperations();if(api)await api.logout().catch(()=>{});return true;}
function setupDate(ctx){if(!parseKstDate(ui.timetable?.date)){const first=ui.booking.demo?ctx.reservations.map(row=>parseKstDate(row.raw?.A)).filter(Boolean).sort()[0]:null;ui.timetable={...(ui.timetable||{}),date:first||kstDay()};}}
function modeChanged(){delete ui.friendMatches;clearPaymentReview(ui);clearReviewsAdmin(ui);delete ui.paymentReview;ui.paymentReviewData=null;ui.paymentReviewLoading=false;ui.paymentReviewError='';ui.paymentReviewLinkStatus=null;clearSmsMediaViews(ui);clearSmsHistory(ui);closePlan();closeCustomerLink();const legacy=$('#desk-assignment-dialog');if(legacy){if(legacy.open)legacy.close();legacy.innerHTML='';}ui.timetable={};ui.customers={};delete ui.callInbox;ui.callInboxData=null;ui.callInboxLoading=false;ui.callInboxError='';ui.communicationTab='calls';delete ui.smsInbox;ui.smsInboxData=null;ui.smsInboxLoading=false;ui.smsInboxError='';delete ui.kakaoInbox;dirty=false;}
const isImwebSource=source=>/imweb/i.test(String(source?.deviceModel||''))||/imweb/i.test(String(source?.slug||''))||/상담폼/.test(String(source?.label||''));
// 상담(문자)=업장 폰 수신함, 상담문의=아임웹 상담폼 수신함. 같은 smsInboxData를 수신함 종류로 나눠 보여준다.
function smsDataForTab(tab){const data=ui.smsInboxData;if(!data)return data;const all=Array.isArray(data.sources)?data.sources:[];return {...data,sources:all.filter(source=>tab==='forms'?isImwebSource(source):!isImwebSource(source))};}
function renderCommunications(customers,customerTeams){
  const tab=['calls','sms','kakao','forms'].includes(ui.communicationTab)?ui.communicationTab:'calls';
  const tabs=`<nav class="communications-tabs" aria-label="상담 기록 종류"><button type="button" data-communication-tab="sms" aria-pressed="${tab==='sms'}">상담</button><button type="button" data-communication-tab="calls" aria-pressed="${tab==='calls'}">전화</button><button type="button" data-communication-tab="kakao" aria-pressed="${tab==='kakao'}">카카오</button><button type="button" data-communication-tab="forms" aria-pressed="${tab==='forms'}">상담문의</button></nav>`;
  if(tab==='kakao')return tabs+renderKakaoInbox({ui});
  if(tab==='forms')return tabs+renderFormInbox({profile:state.profile,data:smsDataForTab('forms'),ui,customers,customerTeams,loading:ui.smsInboxLoading,error:ui.smsInboxError,busy:!!activeWrite});
  if(tab==='sms')return tabs+renderSmsInbox({profile:state.profile,data:smsDataForTab('sms'),ui,customers,customerTeams,loading:ui.smsInboxLoading,error:ui.smsInboxError,busy:!!activeWrite});
  return tabs+renderCallInbox({profile:state.profile,data:ui.callInboxData,ui,customers,customerTeams,loading:ui.callInboxLoading,error:ui.callInboxError,busy:!!activeWrite});
}
// IME 안전 재렌더(2026-11-20, payment-review-view v119 패턴의 app 전역판):
// 백그라운드 완료는 renderSoon()으로 — 텍스트 입력·한글 조합 중이면 보류했다가
// focusout/compositionend 에서 flushRender()가 소화한다. '이선화→이선' 이름 잘림의 원인인
// 전체 innerHTML 재렌더가 입력칸을 파괴하던 문제의 수정. 사용자 조작 렌더는 기존 render() 직행 유지.
let renderPending=false,composingInApp=false;
const typingInApp=()=>composingInApp||!!(document.activeElement&&app.contains(document.activeElement)&&document.activeElement.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]),textarea'));
const renderSoon=()=>{if(typingInApp()){renderPending=true;return;}render();};
const flushRender=()=>{if(renderPending&&!typingInApp()){renderPending=false;render();}};
app.addEventListener('compositionstart',()=>{composingInApp=true;});
app.addEventListener('compositionend',()=>{composingInApp=false;setTimeout(flushRender,0);});
app.addEventListener('focusout',()=>{composingInApp=false;setTimeout(flushRender,0);});
function render(){
  // 조합 중 하드가드: renderSoon을 못 거친 경로(뷰 내부 update 등)도 조합 파괴만은 막는다.
  if(composingInApp){renderPending=true;return;}
  renderPending=false;
  invalidateCustomerLink();
  const active=hasOperator(),demo=ui.booking.demo!==false;
  ui.role=active?state.profile.role:null;
  if(active&&demo&&['changes','calls','payments','reviews','friends'].includes(ui.view))ui.view='reservations';
  const friendTab=$('[data-desk-view="friends"]');if(friendTab)friendTab.hidden=!active||demo;
  const paymentsTab=$('[data-desk-view="payments"]');if(paymentsTab)paymentsTab.hidden=!active||demo;
  const callsTab=$('[data-desk-view="calls"]');if(callsTab)callsTab.hidden=!active||demo;
  const reviewsTab=$('[data-desk-view="reviews"]');if(reviewsTab)reviewsTab.hidden=!active||demo;
  if(active&&ui.view==='changes'&&!canReviewCustomerChanges(state.profile)){ui.view='reservations';history.replaceState(null,'',`${location.pathname}${location.search}#reservations`);}
  const changesTab=$('[data-desk-view="changes"]');if(changesTab){changesTab.hidden=!active||demo||!canReviewCustomerChanges(state.profile);const count=(state.customerChangeRequests||[]).length;changesTab.innerHTML=`고객 요청${count?` <span class="ccr-count">${count}${count>=100?'+':''}</span>`:''}`;}
  const adminNavigation=$('#desk-admin-navigation');if(adminNavigation){adminNavigation.hidden=!active||state.profile.role!=='admin';adminNavigation.innerHTML=active?`<details class="desk-other-work"><summary>다른 관리 업무</summary><div>${bookingAdminNavigation(state.profile).map(item=>`<a href="${esc(item.href)}">${esc(item.label)}</a>`).join('')}</div></details>`:'';}
  const home=$('#desk-admin-home');if(home){home.hidden=!active||state.profile.role!=='admin';home.href=bookingStaffLinks().home;home.textContent='전체 관리';}
  $('.desk-viewbar').hidden=checkingSession||!active;
  $('#desk-notice').hidden=checkingSession||!active;
  $('#desk-notice').dataset.routine=String(active&&!demo&&!refreshError);
  $('#desk-login').disabled=checkingSession;
  if(checkingSession||!active){
    $('#desk-status').textContent=checkingSession?'계정 확인 중':'로그인 필요';
    $('#desk-status').classList.remove('operational');
    $('#desk-login').hidden=false;$('#desk-logout').hidden=true;$('#desk-refresh').hidden=true;
    const denied=['BOOKING_ACCESS_REQUIRED','PASSWORD_SETUP_REQUIRED'].includes(accessError?.code);
    app.innerHTML=`<section class="desk-login-landing" aria-labelledby="desk-welcome-title"><span class="desk-login-eyebrow">RESERVATION OPERATIONS</span><h1 id="desk-welcome-title">예약 접수부터 강사 배정까지.</h1><p>${checkingSession?'로그인 상태를 확인하고 있습니다.':esc(accessError?.message||'관리자·상담사 계정으로 로그인해 주세요.')}</p>${checkingSession?'<div class="desk-login-loading" role="status">계정 확인 중…</div>':`<button type="button" class="btn primary" data-open-login>${denied?'내 화면으로 이동':'로그인하기'}</button><small>계정 발급은 관리자에게 문의해 주세요.</small>`}</section>`;
    app.querySelector('[data-open-login]')?.addEventListener('click',openLogin);
    return;
  }
  $('#desk-status').textContent=demo?`체험 모드 · ${bookingRoleLabel(state.profile.role)}`:`${state.profile.display_name||bookingRoleLabel(state.profile.role)} · ${bookingRoleLabel(state.profile.role)}`;
  $('#desk-status').classList.toggle('operational',active&&!demo);
  $('#desk-login').hidden=active;$('#desk-logout').hidden=!active;$('#desk-refresh').hidden=!active;
  $('[data-desk-autoassign]').hidden=['passes','customers','notices','changes','calls','payments','reviews','friends','reservations'].includes(ui.view);
  document.querySelectorAll('[data-desk-view]').forEach(button=>{const selected=button.dataset.deskView===ui.view;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  $('#desk-notice').innerHTML=demo?'<span class="desk-notice-dot"></span><div><strong>예약표와 강사 시간표를 체험해 보세요.</strong><span>가상 데이터입니다. 자동배정으로 배정안을 만들고, 확정하면 체험 화면에만 반영됩니다.</span></div>':`<span class="desk-notice-dot"></span><div><strong>${state.profile.role==='counselor'?'상담·예약 관리':'예약·배정 관리'}</strong><span>고객 접수, 예약 변경, 수강권과 강사 배정을 관리합니다.</span></div>`;
  if(active&&refreshError&&!demo&&!['calls','payments','friends'].includes(ui.view)&&!ui.booking.drawer&&!hasUnsavedTeamDrafts(ui.booking.teamDeck)){app.innerHTML=`<section class="panel desk-unavailable"><h2>예약 기록을 다시 확인해 주세요.</h2><p>${esc(refreshError)}</p><button type="button" class="btn primary" data-retry>다시 불러오기</button><button type="button" class="btn secondary" data-preview>체험 예약표 보기</button></section>`;app.querySelector('[data-retry]').onclick=()=>refreshDesk({force:true});app.querySelector('[data-preview]').onclick=()=>{modeChanged();ui.booking={...ui.booking,demo:true,drawer:null,draft:null,teamDeck:null,deckMode:'demo'};render();};return;}
  if(active&&refreshError&&!demo)$('#desk-notice').innerHTML=`<span class="desk-notice-dot"></span><div><strong>작성 중인 팀 카드는 보관되어 있습니다.</strong><span>최신 목록을 불러오지 못했습니다. 저장 결과를 확인하거나 다시 시도해 주세요. ${esc(refreshError)}</span></div>`;
  const ctx=context();setupDate(ctx);const previousDemo=ui.booking.demo;
  const changes=ui.customerChanges,changeRows=changes.status==='pending'?(state.customerChangeRequests||[]):changes.requests;
  const oldReview=ui.view==='payments'?app.querySelector('[data-pr-review-key]'):null;
  const reviewScroll=oldReview?{key:oldReview.dataset.prReviewKey,panes:['.pr-evidence-pane','.pr-proposals-pane','.pr-form-pane'].map(selector=>({selector,top:oldReview.querySelector(selector)?.scrollTop||0})),name:oldReview.contains(document.activeElement)?document.activeElement?.getAttribute('name'):null,check:oldReview.contains(document.activeElement)?document.activeElement?.dataset?.prCheck:null}:null;
  app.innerHTML=ui.view==='friends'?friendPanel(ui.friendMatches):ui.view==='reviews'?renderReviewsAdmin({profile:state.profile,ui,busy:!!activeWrite}):ui.view==='payments'?renderPaymentReview({profile:state.profile,ui,data:ui.paymentReviewData,bookingContext:ctx,loading:ui.paymentReviewLoading,error:ui.paymentReviewError,busy:!!activeWrite})+renderPaymentPassIssue({state:ctx,ui,escapeHTML:esc})+renderBookingEditor({state,ui,escapeHTML:esc,now:new Date()}):ui.view==='calls'?renderCommunications(ctx.customers,ctx.customerTeams)+renderBookingEditor({state,ui,escapeHTML:esc,now:new Date()}):ui.view==='changes'?renderCustomerChanges({profile:state.profile,requests:changeRows,status:changes.status,notes:changes.notes,bulk:changes.bulk||(changes.bulk={selected:[],note:''}),loading:changes.loading,error:changes.error||(changes.status==='pending'?state.customerChangeRequestsError:''),busy:!!activeWrite})+renderBookingEditor({state,ui,escapeHTML:esc,now:new Date()}):ui.view==='notices'?renderCustomerNotices({state:ctx,demo,profile:state.profile,settingsHref:bookingStaffLinks().settings})+renderBookingEditor({state,ui,escapeHTML:esc,now:new Date()}):ui.view==='customers'?renderCustomers({state:ctx,ui,escapeHTML:esc,now:new Date()})+renderBookingEditor({state,ui,escapeHTML:esc,now:new Date()})+renderPassDialogs({state:ctx,ui,escapeHTML:esc}):ui.view==='timetable'?renderTimetable({state:ctx,ui,escapeHTML:esc,icon,now:new Date()})+renderBookingEditor({state,ui,escapeHTML:esc,now:new Date()}):renderBookingPage({state,ui,escapeHTML:esc,icon,now:new Date()})+renderPaymentPassIssue({state:ctx,ui,escapeHTML:esc})+renderPasses({state:ctx,ui,escapeHTML:esc,icon,now:new Date()});
  const requestBooking=ui.booking?.draft?.id;
  if(active&&!demo&&/^friend-match-[a-f0-9-]{36}$/.test(requestBooking||'')){
    const body=app.querySelector('.bk-drawer-body');
    if(body){
      const details=document.createElement('details');details.className='panel fm-booking-contacts';
      details.innerHTML='<summary>친구찾기 특이사항 · 두 강습생 연락처·나이·목표</summary><div aria-live="polite"></div>';
      body.prepend(details);
      const identity=authVersion;
      details.ontoggle=async()=>{
        if(!details.open||details.dataset.loaded)return;
        details.dataset.loaded='1';
        const result=details.querySelector('div');result.textContent='조회 중입니다.';
        try{
          const module=await getApi(),rows=await module.friendMatchBookingContacts(requestBooking);
          if(identity===authVersion&&hasOperator()&&details.isConnected)result.textContent=friendStudentNotes(rows)||'연결된 신청이 없습니다.';
        }catch(error){if(identity===authVersion&&details.isConnected){result.textContent=error.message;delete details.dataset.loaded;}}
      };
    }
  }
  const freshReview=reviewScroll?app.querySelector('[data-pr-review-key]'):null;
  if(freshReview&&freshReview.dataset.prReviewKey===reviewScroll.key){for(const {selector,top}of reviewScroll.panes){const pane=freshReview.querySelector(selector);if(pane)pane.scrollTop=top;}const form=freshReview.querySelector('[data-pr-review-form]'),focus=reviewScroll.name?form?.elements?.namedItem(reviewScroll.name):['bank','customer','details'].includes(reviewScroll.check)?freshReview.querySelector(`[data-pr-check="${reviewScroll.check}"]`):null;if(focus&&!focus.disabled)focus.focus?.({preventScroll:true});}
  if(active&&!demo&&ui.view==='reservations')app.insertAdjacentHTML('afterbegin',renderSheetsSync(state.sheetsSync,{error:state.sheetsSyncError,compact:true}));
  bindBookingPage(app,{state,ui,now:new Date(),onChange:()=>{dirty=false;if(ui.booking.demo!==previousDemo){if(hasUnsavedCustomerDraft(ui)){ui.booking.demo=previousDemo;toast('작성 중인 고객·팀 정보를 저장하거나 비운 뒤 전환해 주세요.');render();return;}modeChanged();}if(!hasOperator()&&!ui.booking.demo){ui.booking.demo=true;render();openLogin();return;}render();},
    // 백그라운드 완료 전용: 입력·조합 중이면 재렌더 보류(IME 이름 잘림 방지).
    onChangeSoon:()=>{dirty=false;renderSoon();},
    onSave:saveBookingReservation,
    onSaveBatch:saveBookingBatch,
    onInlineNote:saveBookingNotes,
    onChangeReservation:changeReservation,
    onLoadPaymentRequestCorrections:id=>api.fetchPaymentRequestCorrections(id),
    onDeleteReservation:deleteReservation,
    onCandidates:async payload=>{mustBeOperator();const identity=authVersion,candidates=await api.getCandidates(payload);if(identity!==authVersion||!hasOperator()||ui.booking.demo)return {discarded:true};return {candidates:(candidates||[]).map(row=>({instructorId:row.userId||row.instructorId,name:row.name,eligible:row.eligible,reasonCodes:row.reasonCodes,blockedReasons:(row.reasonCodes||[]).map(code=>ASSIGNMENT_REASON_LABELS[code]||code),reasons:row.requiresExperienced?['경력강사 조건 확인']:[]}))};},
    onSaveCapabilities:value=>writeOperation(()=>api.saveCapabilities(value),'강사 배정 조건을 저장했습니다.'),
    onSavePolicy:value=>writeOperation(()=>api.savePolicy(value),'배정 기준을 저장했습니다.'),
    onAutoAssign:id=>openAutoAssign(id),onOpenLesson:openReservation,onIssuePass:issuePassFromBooking,
    onCreatePass:async payload=>{mustBeOperator();const saved=await writeOperation(()=>api.createLessonPass(payload),'수강권을 발급했습니다.');return saved;},
    onUpdatePass:updatePass,
    onSaveCustomerPerson:value=>writeOperation(()=>api.saveCustomerPerson(value),'개인 명부를 저장했습니다.'),
    // 그룹 수정(2026-11-17 사용자 확정): 선택 행들에 장비렌탈·받은 금액을 건별 검증으로 적용.
    // 요청액·미수금은 buildQuickAmountChange → FINANCIAL v3 payload가 자동 재계산한다.
    onBulkAmounts:async(ids,values)=>{
      mustBeOperator();
      if(ui.booking.demo)throw new Error('운영 예약표에서 사용해 주세요.');
      const ctxNow=getBookingContext(state,ui,new Date());
      const outcome={ok:0,failed:[],failedIds:[]};
      const result=await writeOperation(async()=>{
        for(const id of ids){
          const row=state.reservations.find(item=>item.id===id);
          const label=row?`${String(row.raw?.H||row.raw?.I||id).trim()} · ${row.raw?.A||'날짜 미정'}`:String(id);
          try{
            if(!row)throw new Error('예약을 찾지 못했습니다. 목록을 새로고침해 주세요.');
            const status=values.rentalStatus!=='keep'?values.rentalStatus:undefined;
            const baseStatus=status??row.rentalPaymentStatus??row.rental_payment_status??null;
            const touchRental=status!==undefined||values.rentalHours!=='keep'||values.rentalAmount!==null;
            const changes={};
            if(touchRental){
              if(!baseStatus)throw new Error('장비렌탈 상태가 없는 예약입니다. 결제상태를 함께 선택해 주세요.');
              changes.rentalPaymentStatus=baseStatus;
              changes.rentalHours=values.rentalHours!=='keep'?Number(values.rentalHours):(row.rentalHours??row.rental_hours??null);
              if(values.rentalAmount!==null)changes.rentalAmount=values.rentalAmount;
            }
            if(values.paidAmount!==null)changes.paidAmount=values.paidAmount;
            if(values.sport&&values.sport!=='keep')changes.sport=values.sport;
            const payload=buildQuickAmountChange(row,ctxNow,changes);
            const saved=await api.changeReservation(payload,'예약표 그룹 수정',{});
            if(saved?.discarded)throw new Error('세션이 바뀌어 중단했습니다.');
            outcome.ok++;
          }catch(error){outcome.failed.push({label,message:error?.message||'저장하지 못했습니다.'});outcome.failedIds.push(id);}
        }
        return outcome;
      },`그룹 수정 적용 · 성공 ${ids.length}건 중 일부는 결과 패널에서 확인`);
      if(result?.discarded)return result;
      toast(`그룹 수정: 성공 ${outcome.ok}건 · 실패 ${outcome.failed.length}건`);
      return outcome;
    },
    // 일괄 하드 삭제(2026-11-24 사용자 지시): 선택 건을 자식 레코드까지 영구 삭제(복구 불가·관리자 전용, slope_purge_reservations).
    onBulkDelete:async ids=>{
      mustBeOperator();
      if(ui.booking.demo)throw new Error('운영 예약표에서 사용해 주세요.');
      const labelOf=id=>{const row=(state.reservations||[]).find(r=>r.id===id);return row?`${String(row.raw?.H||row.raw?.I||id).trim()} · ${row.raw?.A||'날짜 미정'}`:String(id);};
      const result=await writeOperation(()=>api.purgeReservations(ids),`선택 ${ids.length}건 영구 삭제`);
      if(result?.discarded)return result;
      const deleted=new Set(result?.deletedIds||[]);
      const failedIds=ids.filter(id=>!deleted.has(id));
      const failed=failedIds.map(id=>({label:labelOf(id),message:'삭제되지 않았습니다(이미 삭제됐거나 권한을 확인해 주세요).'}));
      state={...state,reservations:(state.reservations||[]).filter(row=>!deleted.has(row.id))};
      state.customerNotices=selectActiveCustomerNotices(state.customerNotices||[],state);invalidateCustomerLink();
      toast(`영구 삭제: ${deleted.size}건 완료${failedIds.length?` · ${failedIds.length}건 미삭제`:''}`);
      return {ok:deleted.size,failed,failedIds};
    },
    // 그룹선택 강사 일괄배정(2026-11-25 사용자 지시): 선택 강사를 선택 예약들에 건별 배정.
    // 검증은 기존 writer가 수행 — 겹침·자격·종목·고정강사 안 맞는 건은 건너뛰고 사유를 반환한다.
    onBulkAssign:async(ids,instructorId)=>{
      mustBeOperator();
      if(ui.booking.demo)throw new Error('운영 예약표에서 사용해 주세요.');
      const labelOf=id=>{const row=(state.reservations||[]).find(r=>r.id===id);return row?`${String(row.raw?.H||row.raw?.I||id).trim()} · ${row.raw?.A||'날짜 미정'}`:String(id);};
      const translate=m=>{const s=String(m||'');if(/INPUT_REVIEW/.test(s))return '강사 조건 확인 필요(종목·자격·시간겹침 등) — 예약을 열어 확인하세요.';if(/40001|처리하고|lock/i.test(s))return '다른 기기에서 처리 중 — 다시 시도해 주세요.';if(/종료된/.test(s))return '이미 종료된 강습입니다.';return s||'배정하지 못했습니다.';};
      const result=await writeOperation(()=>api.bulkAssignInstructor(ids,instructorId),`선택 ${ids.length}건 강사 일괄 배정`);
      if(result?.discarded)return result;
      const failedIds=Array.isArray(result?.failedIds)?result.failedIds:[];
      const failed=(result?.failed||[]).map(item=>({label:labelOf(item.id),message:translate(item.message)}));
      toast(`강사 배정: 성공 ${result?.ok||0}건${failed.length?` · 실패 ${failed.length}건`:''}`);
      return {ok:result?.ok||0,failed,failedIds};
    },
    onDeleteCustomerPerson:id=>writeOperation(()=>api.deleteCustomerPerson(id),'개인을 명부에서 삭제했습니다.')});
  if(ui.view==='timetable')bindTimetable(app,{state:ctx,ui,now:new Date(),onChange:()=>{dirty=false;render();},onOpenReservation:openReservation,onCreateReservation:createReservation,onMoveReservation:moveReservation});
  if(ui.view==='reservations'||ui.passes?.issuing||ui.passes?.editRequest||ui.passes?.deleteRequest)bindPasses(app,{state:ctx,ui,onChange:()=>{dirty=false;render();},onCreate:createPass,onIssueInline:issuePassInline,onSchedule:schedulePass,onCustomerLink:id=>showCustomerLink('pass',[id]),onDelete:deletePass,onUpdate:updatePass,onEdit:editPassInline});
  if(ui.view==='notices')bindCustomerNotices(app,{state:ctx,demo,onCreateLink:showCustomerLink});
  if(ui.view==='changes'){const identity=authVersion;bindCustomerChanges(app,{profile:state.profile,requests:changeRows,notes:changes.notes,bulk:changes.bulk||(changes.bulk={selected:[],note:''}),onFilter:status=>loadCustomerChanges(status),onRefresh:()=>loadCustomerChanges(),onReview:reviewCustomerRequest,onReviewBatch:reviewCustomerRequestBatch,onBulkChange:()=>{dirty=false;render();},isCurrent:()=>identity===authVersion&&hasOperator()&&canReviewCustomerChanges(state.profile)&&!ui.booking.demo});}
  if(ui.view==='friends')bindFriendOperations();
  if(ui.view==='reviews'){const identity=authVersion,viewUi=ui;bindReviewsAdmin(app,{ui,onChange:()=>{dirty=false;render();},onAction:reviewsAdminAction,onError:toast,isCurrent:()=>identity===authVersion&&viewUi===ui&&hasOperator()&&!ui.booking.demo&&ui.view==='reviews'});}
  if(ui.view==='payments'){const identity=authVersion,viewUi=ui;bindPaymentReview(app,{profile:state.profile,ui,data:ui.paymentReviewData,bookingContext:ctx,busy:!!activeWrite,onChange:()=>{dirty=false;render();},onRefresh:()=>loadPaymentReviews(),onAction:paymentReviewAction,onOpenBooking:createPaymentReservation,onLoadSavedReservations:loadSavedPaymentReservations,onEditSavedReservation:editSavedPaymentReservation,onError:toast,onSaveCustomerPerson:value=>writeOperation(()=>api.saveCustomerPerson(value),'개인 명부를 저장했습니다.'),onDeleteCustomerPerson:id=>writeOperation(()=>api.deleteCustomerPerson(id),'개인을 명부에서 삭제했습니다.'),isCurrent:()=>identity===authVersion&&viewUi===ui&&hasOperator()&&!ui.booking.demo&&ui.view==='payments'});}
  if(ui.view==='calls'){
    const identity=authVersion,viewUi=ui,tab=ui.communicationTab,version=ui.communicationVersion;
    const isCurrent=()=>identity===authVersion&&viewUi===ui&&version===ui.communicationVersion&&hasOperator()&&!ui.booking.demo&&ui.view==='calls'&&ui.communicationTab===tab;
    app.querySelectorAll('[data-communication-tab]').forEach(button=>button.addEventListener('click',()=>{
      if(!isCurrent()||activeWrite||ui.booking.deckSaving)return;
      if(hasUnsavedCallDraft(ui)){toast('작성 중인 상담 기록이나 휴대폰 설정을 먼저 저장해 주세요.');return;}
      const next=button.dataset.communicationTab;if(!['calls','sms','kakao','forms'].includes(next)||next===ui.communicationTab)return;
      if(hasSmsHistoryWork(ui)){toast('과거 문자 가져오기를 마치거나 가져오기 화면을 닫은 뒤 이동해 주세요.');return;}clearSmsMediaViews(ui);clearSmsHistory(ui);
      // 상담↔상담문의는 같은 sms 상태를 공유하므로 수신함 선택을 초기화해 서로 섞이지 않게 한다.
      if(ui.smsInbox){ui.smsInbox.sourceId='';ui.smsInbox.selected=null;ui.smsInbox.detail=null;}
      ui.communicationTab=next;ui.communicationVersion=(ui.communicationVersion||0)+1;
      ui.callInboxRequest=null;ui.smsInboxRequest=null;ui.callInboxLoading=false;ui.smsInboxLoading=false;
      dirty=false;render();void loadCommunications();
    }));
    if(tab==='sms'||tab==='forms')bindSmsInbox(app,{profile:state.profile,data:smsDataForTab(tab),ui,customers:ctx.customers,customerTeams:ctx.customerTeams,
      onChange:()=>{dirty=false;render();},onRefresh:()=>loadSmsInbox(),onAction:callInboxAction,
      onCreateBooking:createCallReservation,onError:toast,isCurrent,busy:!!activeWrite,
      onOpenPhoneSetup:()=>{
        if(!isCurrent()||state.profile.role!=='admin')return;
        app.querySelector('.communications-tabs [data-communication-tab="calls"]')?.click();
        if(ui.communicationTab==='calls'){ui.callInbox??={};ui.callInbox.settingsOpen=true;render();}
      }});
    else if(tab==='kakao')bindKakaoInbox(app,{ui,onChange:()=>{dirty=false;render();},onAction:(action,payload)=>{mustBeOperator();return api.paymentReviewAction(action,payload);},isCurrent});
    else bindCallInbox(app,{profile:state.profile,data:ui.callInboxData,ui,customers:ctx.customers,customerTeams:ctx.customerTeams,
      onChange:()=>{dirty=false;render();},onRefresh:()=>loadCallInbox(),onAction:callInboxAction,
      onCreateBooking:createCallReservation,onError:toast,onSetupDownload:downloadCallSetup,isCurrent});
  }
  if(ui.view==='customers')bindCustomers(app,{state:ctx,ui,onChange:()=>{dirty=false;render();},onSaveCustomer:saveCustomer,onSaveTeam:saveCustomerTeam,onDeleteCustomer:deleteCustomer,onDeleteTeam:deleteCustomerTeamRow,onNewReservation:createCustomerReservation,onOpenReservation:openReservation,onQuickAmounts:async(id,changes)=>{mustBeOperator();const row=state.reservations.find(item=>item.id===id);if(!row)throw new Error('예약을 찾지 못했습니다. 목록을 새로고침해 주세요.');const payload=buildQuickAmountChange(row,getBookingContext(state,ui,new Date()),changes);await writeOperation(()=>api.changeReservation(payload,'고객관리 금액 빠른 수정',{}),'금액을 저장했습니다.');}});
  const rentalReadIdentity=authVersion;
  bindRentalBridgePanels(app,{demo,lookup:async id=>{mustBeOperator();const value=await api.lookupRentalStatus(id);return rentalReadIdentity===authVersion&&hasOperator()&&!ui.booking.demo?value:{discarded:true};},isCurrent:()=>rentalReadIdentity===authVersion&&hasOperator()&&!ui.booking.demo});
}

// 후기 관리: 설문 대기열 + 게시 목록을 한 번에 불러온다(loadPaymentReviews 패턴).
async function loadReviewsAdmin(){
  if(!hasOperator()||ui.booking.demo||ui.view!=='reviews')return {discarded:true};
  const u=reviewsAdminState(ui);
  const identity=authVersion,viewUi=ui,token={};u.request=token;u.loading=true;u.error='';
  const current=()=>identity===authVersion&&viewUi===ui&&reviewsAdminState(ui).request===token&&hasOperator()&&!ui.booking.demo&&ui.view==='reviews';
  render();
  try{
    const [queue,list]=await Promise.all([api.reviewsAction('queue',{}),api.reviewsAction('list',{brand:u.brand})]);
    if(!current())return {discarded:true};
    u.queue=queue.queue||[];u.list=list;return {ok:true};
  }catch(error){
    if(!current())return {discarded:true};
    if(isAuthError(error)){clearOperations();toast(error.message);return {discarded:true};}
    u.error=error.message;return {error};
  }finally{if(current()){u.loading=false;renderSoon();}}
}
async function reviewsAdminAction(kind,payload={}){
  mustBeOperator();if(ui.booking.demo)throw new Error('운영 계정으로 이용해 주세요.');const identity=authVersion;
  const result=await api.reviewsAction(kind,payload);
  if(identity!==authVersion||!hasOperator())throw new Error('로그인이 바뀌었습니다. 다시 열어 주세요.');return result;
}

let friendReadVersion=0;
async function loadFriendMatches(offset=ui.friendMatches?.offset||0){
  if(!hasOperator()||ui.booking.demo||ui.view!=='friends')return;
  const identity=authVersion,viewUi=ui,token=++friendReadVersion;
  const current=()=>identity===authVersion&&viewUi===ui&&token===friendReadVersion&&ui.view==='friends'&&hasOperator()&&!ui.booking.demo;
  ui.friendMatches={offset,loading:true};render();
  try{
    const module=await getApi(),rows=await module.friendMatchList(offset);
    if(current())ui.friendMatches={offset,rows};
  }catch(error){
    if(current())ui.friendMatches={offset,error:error.message||'매칭 목록을 불러오지 못했습니다.'};
  }finally{if(current())render();}
}
function bindFriendOperations(){
  const identity=authVersion,viewUi=ui;
  const current=()=>identity===authVersion&&viewUi===ui&&ui.view==='friends'&&hasOperator()&&!ui.booking.demo;
  bindFriendPanel(app,{
    current,error:toast,
    page:action=>{if(current())return loadFriendMatches(Math.max(0,(ui.friendMatches?.offset||0)+(action==='next'?25:action==='prev'?-25:0)));},
    async read(action,id){if(!current())return [];const module=await getApi();return current()?module.friendMatchDetails(action,id):[];},
    async accept(id){
      if(!current())return;
      const result=await writeOperation(()=>api.friendMatchAccept(id),'친구 매칭을 예약표에 접수했습니다.');
      if(current()&&!result?.discarded)await loadFriendMatches();
    },
    async guardian(phone){
      if(!current())return;
      const result=await writeOperation(()=>api.friendMatchGuardian(phone),'보호자 확인을 등록했습니다. 같은 번호로 24시간 동안 신청할 수 있습니다.');
      if(current()&&!result?.discarded)app.querySelector('[data-fm-guardian]')?.reset();
    }
  });
}
async function loadPaymentReviews(){
  if(!hasOperator()||ui.booking.demo||ui.view!=='payments')return {discarded:true};
  const identity=authVersion,viewUi=ui,token={};ui.paymentReviewRequest=token;ui.paymentReviewLoading=true;ui.paymentReviewError='';
  const current=()=>identity===authVersion&&viewUi===ui&&ui.paymentReviewRequest===token&&hasOperator()&&!ui.booking.demo&&ui.view==='payments';
  renderSoon();
  void api.paymentReviewAction('link-status',{}).then(status=>{if(current()){ui.paymentReviewLinkStatus=status;if(!ui.paymentReviewLoading&&!hasPaymentReviewWork(ui)&&!app.querySelector('[data-pr-review-form]')?.contains(document.activeElement))renderSoon();}}).catch(()=>{});
  try{const result=await api.paymentReviewAction('upload-list',{offset:ui.paymentReview?.offset||0,limit:30,filter:ui.paymentReview?.filter||'pending'});if(!current())return {discarded:true};ui.paymentReviewData=result;return {ok:true};}
  catch(error){if(!current())return {discarded:true};if(isAuthError(error)){clearOperations();toast(error.message);return {discarded:true};}ui.paymentReviewError=error.message;return {error};}
  finally{if(current()){ui.paymentReviewLoading=false;renderSoon();}}
}
async function paymentReviewAction(action,payload={}){
  mustBeOperator();if(ui.booking.demo)throw new Error('운영 계정으로 이용해 주세요.');const identity=authVersion;
  const result=await api.paymentReviewAction(action,payload);
  if(identity!==authVersion||!hasOperator())throw new Error('로그인이 바뀌었습니다. 다시 열어 주세요.');return result;
}
async function loadSavedPaymentReservations({reviewId}={}){
  mustBeOperator();
  if(ui.booking.demo||ui.view!=='payments'||activeWrite||ui.booking.deckSaving)throw new Error('현재 작업을 마친 뒤 저장 내역을 다시 열어 주세요.');
  const identity=authVersion,viewUi=ui,uploadId=ui.paymentReview?.detail?.upload?.id;
  if(!uploadId||!ui.paymentReview.detail.reviews?.some(row=>row.id===reviewId))throw new Error('선택한 입금의 저장 내역을 다시 확인해 주세요.');
  const [detail,refreshed]=await Promise.all([
    paymentReviewAction('upload-detail',{uploadId}),
    refreshDesk({force:true,renderView:false})
  ]);
  if(identity!==authVersion||viewUi!==ui||!hasOperator()||ui.booking.demo||ui.view!=='payments'||ui.paymentReview?.detail?.upload?.id!==uploadId)throw new Error('화면이 변경되었습니다. 저장 내역을 다시 열어 주세요.');
  if(!refreshed?.ok)throw new Error('최신 예약을 불러오지 못했습니다. 다시 시도해 주세요.');
  const review=detail?.upload?.id===uploadId&&detail.reviews?.find(row=>row.id===reviewId);
  if(!review||!Array.isArray(review.allocations)||!review.allocations.length)throw new Error('이 입금에 연결된 저장 내역을 확인하지 못했습니다.');
  return {review:clone(review),bookingContext:context()};
}
async function editSavedPaymentReservation({reviewId,reservationId}={}){
  if(pendingBookingDrafts()||ui.passes?.issuing)throw new Error('작성 중인 내용을 저장하거나 창을 닫은 뒤 수정해 주세요.');
  const {review,bookingContext}=await loadSavedPaymentReservations({reviewId});
  if(!review.allocations.some(row=>row.reservationId===reservationId&&!row.lessonPassId))throw new Error('선택한 입금에 연결된 예약이 아닙니다.');
  const rows=bookingContext.paymentReservations||bookingContext.reservations||[],row=rows.find(item=>item.id===reservationId);
  if(!row||['cancelled','canceled','deleted','refunded'].includes(String(row.status).toLowerCase())||row.cancelledAt||row.cancelled_at||row.deletedAt||row.deleted_at||row.refundedAt||row.refunded_at)throw new Error('취소·삭제·환불된 예약은 저장 내역만 확인할 수 있습니다.');
  if(activeWrite||ui.booking.deckSaving||pendingBookingDrafts()||ui.passes?.issuing)throw new Error('현재 작성 작업을 마친 뒤 다시 눌러 주세요.');
  const draft=normalizeBookingRow(clone(row),bookingContext);
  if(draft.id!==reservationId||!draft.expectedUpdatedAt)throw new Error('예약의 최신 저장 정보를 확인하지 못했습니다. 다시 열어 주세요.');
  // This is an edit of the persisted reservation. Never attach an old intake's
  // one-time bank commit or create a replacement customer/team from its proposal.
  for(const key of ['paymentReviewId','paymentReviewVersion','paymentDepositId','paymentCommitRequestId','paymentAllocationAmount','paymentNeedsBreakConfirmation','paymentReviewedRentalFee','paymentRequestCorrection','customerDraft','teamDraft'])delete draft[key];
  closePlan();suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();
  return {opened:true};
}
function adoptSavedPaymentReview(review){
  if(!adoptPaymentReviewSave(ui,review))return;
  // Refresh the queue counts; the selected capture and other local edits stay open.
  // Let the booking callback mark its saved cards before rendering the queue.
  const identity=authVersion,viewUi=ui;
  setTimeout(()=>{if(identity===authVersion&&viewUi===ui)void loadPaymentReviews();},0);
}
async function createPaymentReservation(approvedDraft){
  mustBeOperator();
  if(ui.booking.demo)throw new Error('운영 계정으로 이용해 주세요.');
  if(activeWrite||ui.booking.deckSaving)throw new Error('다른 저장 작업을 마친 뒤 다시 눌러 주세요. 검토 승인은 보관되어 있습니다.');
  if(paymentReviewBookingType(approvedDraft)==='pass'){
    if(pendingBookingDrafts())throw new Error('기존 작성 중인 예약 카드를 먼저 저장하거나 비워 주세요. 검토 승인은 보관되어 있어 다시 열 수 있습니다.');
    if(ui.passes?.issuing)throw new Error('작성 중인 수강권을 먼저 저장하거나 닫아 주세요. 검토 승인은 보관되어 있습니다.');
    const draft=createPaymentPassDraft(approvedDraft);
    ui.passes={...(ui.passes||{}),issuing:true,draft,error:''};dirty=false;render();
    toast('날짜 미정 수강권입니다. 총 횟수와 고객 정보를 확인한 뒤 발급해 주세요.');
    return {opened:true,type:'pass'};
  }
  // 2026-11-17(사용자 확정): 검토양식이 곧 예약접수 양식 — 예약 드로어를 다시 열지 않고
  // 승인한 내용 그대로 즉시 저장한다. 빠진 항목은 검토양식에서 고치고 다시 누르면 된다.
  const ctx=context();
  const drafts=createPaymentBookingDrafts(approvedDraft,ctx);
  const prepared=preparePaymentDirectCommit(drafts,ctx);
  if(prepared.errors.length){
    const teamOf=key=>{const index=Number(String(key).replace('direct-',''));const name=String(drafts[index]?.raw?.I||'').trim();return name?`[${name}] `:'';};
    const first=prepared.errors[0];
    return {opened:false,message:`${teamOf(first.cardKey)}${first.message} — 검토 양식에서 수정한 뒤 다시 눌러 주세요.`};
  }
  const result=await saveBookingBatch(prepared.payloads,prepared.requestId);
  if(result?.discarded)return {opened:false,message:'다른 저장 작업이 진행 중입니다. 잠시 후 다시 눌러 주세요.'};
  // adoptSavedPaymentReview(saveBookingBatch 내부)가 검토 상태 반영과 목록 갱신을 예약한다.
  return {opened:true,type:'saved',count:prepared.payloads.length,teams:drafts.length};
}

function loadCommunications(options={}){if(ui.communicationTab==='kakao')return Promise.resolve({ok:true});return (ui.communicationTab==='sms'||ui.communicationTab==='forms')?loadSmsInbox(options):loadCallInbox(options);}
async function loadSmsInbox({quiet=false}={}){
  if(!hasOperator()||ui.booking.demo||ui.view!=='calls'||(ui.communicationTab!=='sms'&&ui.communicationTab!=='forms'))return {discarded:true};
  const identity=authVersion,viewUi=ui,token={},version=ui.communicationVersion;
  let filters=ui.smsInbox||{};
  // 상담문의(forms)는 아임웹 수신함으로 서버 범위를 좁혀야 과거 상담이 최신 폰 문자에 밀리지 않는다.
  if(ui.communicationTab==='forms'&&!filters.sourceId){const im=(ui.smsInboxData?.sources||ui.callInboxData?.sources||[]).find(isImwebSource);if(im){(ui.smsInbox??={}).sourceId=im.id;filters=ui.smsInbox;}}
  const payload=Object.fromEntries(['sourceId','query','offset','limit'].filter(key=>filters[key]!==undefined&&filters[key]!=='').map(key=>[key,filters[key]]));
  ui.smsInboxRequest=token;ui.smsInboxLoading=true;ui.smsInboxError='';
  const current=()=>identity===authVersion&&viewUi===ui&&version===ui.communicationVersion&&token===ui.smsInboxRequest&&hasOperator()&&!ui.booking.demo&&ui.view==='calls'&&(ui.communicationTab==='sms'||ui.communicationTab==='forms');
  if(!quiet)render();
  // Start independently: status failure or delay must never block the message list.
  void refreshSmsSyncStatuses({ui,onAction:(action,args)=>api.callInboxAction(action,args),sourceId:filters.sourceId||'',isCurrent:current,
    onChange:()=>{if(current()&&!ui.smsInboxLoading&&(!quiet||(!editingCommunicationInput()&&!hasSmsFilterDraft(ui)))){rememberSmsReadPosition(app,ui);renderSoon();}}});
  try{
    const result=await api.callInboxAction('sms-thread-list',payload);
    if(!current())return {discarded:true};
    ui.smsInboxData=result;
    await refreshSmsThread({root:app,profile:state.profile,data:result,ui,onAction:callInboxAction,isCurrent:current});
    return current()?{ok:true}:{discarded:true};
  }catch(error){
    if(!current())return {discarded:true};
    if(isAuthError(error)){clearOperations();toast(error.message);return {discarded:true};}
    ui.smsInboxError=error.message||'문자 대화를 불러오지 못했습니다. 다시 시도해 주세요.';
    return {error};
  }finally{if(current()){ui.smsInboxLoading=false;if(!quiet||(!editingCommunicationInput()&&!hasSmsFilterDraft(ui))){rememberSmsReadPosition(app,ui);renderSoon();}}}
}
async function loadCallInbox({quiet=false}={}){
  if(!hasOperator()||ui.booking.demo||ui.view!=='calls'||ui.communicationTab!=='calls')return {discarded:true};
  const identity=authVersion,viewUi=ui,token={},version=ui.communicationVersion;
  const filters=ui.callInbox||{};
  const payload=Object.fromEntries(['sourceId','workflowStatus','query','from','to','offset','limit'].filter(key=>filters[key]!==undefined&&filters[key]!=='').map(key=>[key,filters[key]]));
  ui.callInboxRequest=token;ui.callInboxLoading=true;ui.callInboxError='';
  const current=()=>identity===authVersion&&viewUi===ui&&version===ui.communicationVersion&&token===ui.callInboxRequest&&hasOperator()&&!ui.booking.demo&&ui.view==='calls'&&ui.communicationTab==='calls';
  if(!quiet)render();
  try{
    const result=await api.callInboxAction(filters.mode==='callback'?'callback-list':'inbox-list',payload);
    if(!current())return {discarded:true};
    ui.callInboxData=result;
    return {ok:true};
  }catch(error){
    if(!current())return {discarded:true};
    if(isAuthError(error)){clearOperations();toast(error.message);return {discarded:true};}
    ui.callInboxError=error.message||'전화 상담 기록을 불러오지 못했습니다. 다시 시도해 주세요.';
    return {error};
  }finally{
    if(current()){ui.callInboxLoading=false;if(!quiet||!hasUnsavedCallDraft(ui))renderSoon();}
  }
}
async function callInboxAction(action,payload){
  mustBeOperator();if(ui.booking.demo)throw Error('운영 모드에서 상담 기록을 관리해 주세요.');
  const identity=authVersion,viewUi=ui,version=ui.communicationVersion;
  try{
    const result=await api.callInboxAction(action,payload);
    if(identity!==authVersion||viewUi!==ui||version!==ui.communicationVersion||!hasOperator()||ui.booking.demo||ui.view!=='calls')return {discarded:true};
    return result;
  }catch(error){if(identity===authVersion&&isAuthError(error)){clearOperations();toast(error.message);}throw error;}
}
function downloadCallSetup({source,token}){
  mustBeOperator();if(state.profile.role!=='admin'||ui.booking.demo)throw Error('관리자 계정에서 휴대폰을 연결해 주세요.');
  const xml=buildCallTaskerProject({source,token,endpoint:CALL_INGEST_ENDPOINT});
  const url=URL.createObjectURL(new Blob([xml],{type:'application/xml;charset=utf-8'}));
  const anchor=document.createElement('a');
  try{
    anchor.href=url;anchor.download=`SLOPE-${String(source.label||'phone').replace(/[^가-힣a-zA-Z0-9_-]/g,'_')}-v11.prj.xml`;
    document.body.append(anchor);anchor.click();
  }finally{anchor.remove();URL.revokeObjectURL(url);}
  toast('v11 연결파일을 내려받았습니다. 기존 해당 SLOPE 수신 프로젝트를 프로필·작업까지 삭제한 뒤, 하단 Import Project로 새 파일을 가져와 세 작업을 실행해 주세요. 문자 원문은 유지됩니다.');
}
function createCallReservation(call,{matchedCustomer=null}={}){
  if(!hasOperator()||ui.booking.demo||activeWrite||ui.booking.deckSaving||hasUnsavedCallDraft(ui))return;
  const phone=canonicalTelephone(call?.phone);if(!phone)return toast('발신번호를 확인한 뒤 예약을 접수해 주세요.');
  const ctx=context(),matches=matchingCallCustomers(phone,ctx.customers,ctx.customerTeams);
  // A shared phone never proves customer identity. Accept only an exact selected match.
  const customer=matchedCustomer&&matches.find(row=>row.id===matchedCustomer.id);
  if(matches.length>1&&!customer)return toast('같은 번호의 고객을 먼저 확인하고 선택해 주세요.');
  const draft=createBookingDraft(ctx,new Date());
  draft.raw.L=formatTelephone(phone);draft.customerContactPhone=formatTelephone(phone);draft.teamPhoneMode='same';
  if(customer){
    draft.raw.H=customer.name||'';draft.customerId=customer.id;draft.customerTeamId=null;
    delete draft.customerDraft;delete draft.teamDraft;
  }
  // openBookingDraft preserves and resumes an existing unfinished card instead of adding another.
  suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();
}

async function loadCustomerChanges(status=ui.customerChanges.status){
  if(!hasOperator()||!canReviewCustomerChanges(state.profile)||ui.booking.demo)return {discarded:true};
  if(!['pending','all'].includes(status))return {discarded:true};
  const identity=authVersion,settings=ui.customerChanges,token={};
  settings.status=status;settings.loading=true;settings.error='';settings.requestToken=token;
  if(ui.view==='changes')renderSoon();
  const current=()=>identity===authVersion&&settings===ui.customerChanges&&settings.requestToken===token&&hasOperator()&&canReviewCustomerChanges(state.profile)&&!ui.booking.demo;
  try{
    const result=await api.fetchCustomerChangeRequests({status});
    if(!current())return {discarded:true};
    if(status==='pending'){state.customerChangeRequests=result.requests;state.customerChangeRequestsError=result.error||'';}
    else settings.requests=result.requests;
    settings.error=result.error||'';
    return result;
  }catch(error){
    if(!current())return {discarded:true};
    if(isAuthError(error)){clearOperations();toast(error.message);return {discarded:true};}
    settings.error=error.message||'변경 요청을 불러오지 못했습니다. 다시 확인해 주세요.';
    return {error};
  }finally{if(current()){settings.loading=false;if(ui.view==='changes')renderSoon();}}
}
async function reviewCustomerRequest(request,decision,note){
  mustBeOperator();
  if(!canReviewCustomerChanges(state.profile)||ui.booking.demo)throw Object.assign(new Error('관리자 계정으로 변경 요청을 검토해 주세요.'),{code:'ADMIN_REQUIRED'});
  if(activeWrite)throw new Error('다른 저장 작업을 마친 뒤 다시 시도해 주세요.');
  const token={identity:authVersion};let processed=false;activeWrite=token;writeVersion++;
  const current=()=>token.identity===authVersion&&hasOperator()&&canReviewCustomerChanges(state.profile)&&!ui.booking.demo;
  try{
    const result=await api.reviewCustomerChange(request.id,decision,note,request.updatedAt,request.requestKind||'reservation_change');
    if(!current())return {discarded:true};
    processed=true;
    delete ui.customerChanges.notes[customerRequestKey(request)];dirty=false;
    // 체감 개선(2026-11-23): 처리 결과는 즉시 알리고, 예약표·요청목록 재적재는 그 뒤에.
    toast(result.ok===false?result.message||'예약이 변경되어 이 요청을 승인할 수 없습니다. 최신 요청을 확인해 주세요.':decision==='approved'?(request.requestKind==='pass_schedule'?'수강권 일정 신청을 승인하고 예약을 등록했습니다.':'변경 요청을 승인하고 강습 일정을 변경했습니다.'):'고객 요청을 반려했습니다.');
    await refreshDesk({force:true,renderView:false});
    if(!current())return result;
    await loadCustomerChanges();
    return result;
  }catch(error){if(current()&&isAuthError(error))clearOperations();throw error;}
  finally{if(activeWrite===token)activeWrite=null;if(processed&&current()&&ui.view==='changes')renderSoon();}
}
// 그룹 승인·반려(2026-11-23): 선택 묶음을 순차 처리하고 재적재는 마지막에 한 번만.
async function reviewCustomerRequestBatch(requestsToReview,decision,note){
  mustBeOperator();
  if(!canReviewCustomerChanges(state.profile)||ui.booking.demo)throw Object.assign(new Error('관리자 계정으로 변경 요청을 검토해 주세요.'),{code:'ADMIN_REQUIRED'});
  if(activeWrite)throw new Error('다른 저장 작업을 마친 뒤 다시 시도해 주세요.');
  const token={identity:authVersion};let processed=false;activeWrite=token;writeVersion++;
  const current=()=>token.identity===authVersion&&hasOperator()&&canReviewCustomerChanges(state.profile)&&!ui.booking.demo;
  const failures=[];let done=0;
  try{
    for(const request of requestsToReview){
      try{
        const result=await api.reviewCustomerChange(request.id,decision,note,request.updatedAt,request.requestKind||'reservation_change');
        if(!current())return {discarded:true};
        processed=true;
        if(result?.ok===false)failures.push({key:customerRequestKey(request),message:result.message||'요청이 변경되었습니다.'});
        else{done++;delete ui.customerChanges.notes[customerRequestKey(request)];}
      }catch(issue){
        if(current()&&isAuthError(issue)){clearOperations();throw issue;}
        if(!current())return {discarded:true};
        failures.push({key:customerRequestKey(request),message:issue.message||'처리하지 못했습니다.'});
      }
    }
    dirty=false;
    // 실패 건은 선택을 유지해 재시도하기 쉽게 한다. 결과는 재적재 전에 즉시 알린다.
    ui.customerChanges.bulk={selected:failures.map(item=>item.key),note:failures.length?String(note||''):''};
    toast(`${decision==='approved'?'승인':'반려'} ${done}건 완료${failures.length?` · 실패 ${failures.length}건 — ${failures[0].message}`:''}`);
    await refreshDesk({force:true,renderView:false});
    if(!current())return {discarded:true};
    await loadCustomerChanges();
    return {ok:failures.length===0,failures};
  }catch(error){if(current()&&isAuthError(error))clearOperations();throw error;}
  finally{if(activeWrite===token)activeWrite=null;if(processed&&current()&&ui.view==='changes')renderSoon();}
}

function noticeScopeIsActive(kind,subjectIds){if(kind==='pass')return true;const scoped=selectActiveCustomerNotices([{kind,subjectIds}],context())[0];return !!scoped&&Array.isArray(subjectIds)&&scoped.subjectIds.length===subjectIds.length;}
function invalidateCustomerLink(){const node=$('#customer-link-dialog'),scope=node?._customerNoticeScope;if(scope&&!noticeScopeIsActive(scope.kind,scope.subjectIds))closeCustomerLink();}
function closeCustomerLink(){const node=$('#customer-link-dialog');if(node){if(node.open)node.close();node.remove();}}
async function showCustomerLink(kind,subjectIds,notice=null){
  if(activeWrite||ui.booking.deckSaving)throw new Error('저장을 마친 뒤 고객 링크를 만들어 주세요.');
  const identity=authVersion,demo=ui.booking.demo!==false;
  if(!noticeScopeIsActive(kind,subjectIds))throw new Error('삭제되었거나 변경된 예약입니다. 최신 고객 안내 목록을 확인해 주세요.');
  const result=demo?{url:`${CUSTOMER_PORTAL}/?demo=${kind}`}:(mustBeOperator(),await api.createCustomerLink(kind,subjectIds));
  if(identity!==authVersion||demo!==(ui.booking.demo!==false))return;
  if(!noticeScopeIsActive(kind,subjectIds))throw new Error('삭제되었거나 변경된 예약입니다. 최신 고객 안내 목록을 확인해 주세요.');
  const ctx=context(),scopedNotice=selectActiveCustomerNotices([notice||{kind,subjectIds}],ctx)[0]||{kind,subjectIds};
  closeCustomerLink();const node=document.createElement('dialog');node._customerNoticeScope={kind,subjectIds:[...subjectIds]};node.id='customer-link-dialog';node.className='cn-link-dialog';
  const message=customerNoticeMessage(scopedNotice,ctx,result.url);
  node.innerHTML=`<button type="button" class="cn-close" aria-label="고객 링크 닫기">×</button><h2>${kind==='pass'?'수강권 상태 확인':'예약 내용 확인'}</h2><p>${demo?'가상 고객용 예시 화면입니다. 실제 고객 기록과 연결되지 않습니다.':`고객 전용 확인 링크입니다.${result.expiresAt?` ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long'}).format(new Date(result.expiresAt))}까지 사용할 수 있습니다.`:''}`}<br>이 화면에서는 확인 링크와 안내문을 만듭니다. 자동 발송 상태는 고객 안내 목록에서 확인해 주세요.</p><label class="field"><span class="field-label">고객 확인 링크</span><input readonly value="${esc(result.url)}" aria-label="고객 확인 링크"></label><pre>${esc(message)}</pre><div class="cn-link-actions"><button type="button" class="btn primary" data-cn-copy-message>안내문 복사</button><button type="button" class="btn secondary" data-cn-copy-link>링크만 복사</button><a class="btn secondary" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">고객 화면 열기 ↗</a></div><p class="cn-link-status" role="status"></p>`;
  document.body.append(node);node.querySelector('.cn-close').onclick=closeCustomerLink;node.addEventListener('close',()=>node.remove());
  node.querySelector('a')?.addEventListener('click',event=>{if(!noticeScopeIsActive(kind,subjectIds)){event.preventDefault();closeCustomerLink();toast('삭제된 예약의 안내는 사용할 수 없습니다.');}});
  const copy=async value=>{if(!noticeScopeIsActive(kind,subjectIds)){closeCustomerLink();toast('삭제된 예약의 안내는 사용할 수 없습니다.');return;}try{await navigator.clipboard.writeText(value);node.querySelector('.cn-link-status').textContent='복사했습니다.';}catch{node.querySelector('.cn-link-status').textContent='자동 복사를 사용할 수 없습니다. 위의 링크나 안내문을 선택해 복사해 주세요.';}};
  node.querySelector('[data-cn-copy-link]').onclick=()=>copy(result.url);node.querySelector('[data-cn-copy-message]').onclick=()=>copy(message);node.showModal();
}

async function createPass(payload){
  if(ui.booking.demo){
    context();
    ui.booking.demoData.lessonPasses.push({id:`DEMO-PASS-${payload.id||crypto.randomUUID()}`,customer_name:payload.customerName,learner_name:payload.learnerName,phone:payload.phone||'',company:payload.company||'',sport:payload.sport,total_sessions:payload.totalSessions,fixed_instructor_user_id:payload.fixedInstructorId||null,notes:payload.notes||'',created_at:new Date().toISOString()});
    toast('체험 수강권을 발급했습니다.');return;
  }
  const result=await writeOperation(()=>api.createLessonPass(payload),'수강권을 발급했습니다.');
  if(result?.discarded)throw new Error('로그인이 바뀌었습니다. 수강권 목록에서 처리 결과를 확인해 주세요.');
  if(payload.paymentReviewId)adoptSavedPaymentReview(result?.review);
  return result;
}
async function deletePass(payload){
  if(ui.booking.demo){
    context();const demo=ui.booking.demoData;
    demo.lessonPasses=(demo.lessonPasses||[]).filter(row=>row.id!==payload.id);
    toast('체험 수강권을 삭제했습니다.');return {id:payload.id,deleted:true};
  }
  const result=await writeOperation(()=>api.deleteLessonPass(payload),'수강권을 삭제했습니다.');
  if(result?.discarded)throw new Error('로그인이 바뀌었습니다. 수강권 목록에서 처리 결과를 확인해 주세요.');
  return result;
}
// 발급 수강권의 시간권(2시간/4시간)만 그 자리에서 수정한다(2026-11-20 사용자 지시).
async function updatePass(payload){
  if(ui.booking.demo){
    context();const row=(ui.booking.demoData.lessonPasses||[]).find(item=>item.id===payload.id);
    if(!row)throw new Error('수강권을 찾지 못했습니다. 목록을 새로고침해 주세요.');
    if([120,240].includes(payload.lessonMinutes))row.lesson_minutes=payload.lessonMinutes;
    if(['스키','보드'].includes(payload.sport))row.sport=payload.sport;
    if(typeof payload.notes==='string')row.notes=payload.notes.slice(0,2000);
    row.updated_at=new Date().toISOString();
    toast('체험 수강권을 수정했습니다.');return {id:payload.id,lessonMinutes:row.lesson_minutes,sport:row.sport};
  }
  mustBeOperator();
  const result=await writeOperation(()=>api.updateLessonPass(payload),'수강권을 수정했습니다.');
  if(result?.discarded)throw new Error('로그인이 바뀌었습니다. 수강권 목록에서 처리 결과를 확인해 주세요.');
  return result;
}
async function saveCustomer(payload){
  if(!ui.booking.demo)return writeOperation(()=>api.saveCustomer(payload),'고객 정보를 저장했습니다.');
  context();const value=customerDirectoryPayload(payload),demo=ui.booking.demoData;
  const rows=demo.customers??=[],old=rows.find(row=>row.id===value.id);
  if(old&&value.expectedUpdatedAt!==old.updated_at)throw new Error('고객 정보가 변경되었습니다. 다시 열어 확인해 주세요.');
  const customer={...old,...value,updated_at:new Date().toISOString()};delete customer.expectedUpdatedAt;
  demo.customers=old?rows.map(row=>row.id===customer.id?customer:row):[...rows,customer];
  toast('체험 고객 정보를 저장했습니다.');return {customer};
}
async function saveCustomerTeam(payload){
  if(!ui.booking.demo)return writeOperation(()=>api.saveCustomerTeam(payload),'팀 정보를 저장했습니다.');
  context();const value=customerTeamPayload(payload),demo=ui.booking.demoData,rows=demo.customerTeams??=[];
  if(!(demo.customers||[]).some(row=>row.id===value.customerId))throw new Error('팀의 고객을 먼저 저장해 주세요.');
  const old=rows.find(row=>row.id===value.id);
  if(old&&value.expectedUpdatedAt!==old.updated_at)throw new Error('팀 정보가 변경되었습니다. 다시 열어 확인해 주세요.');
  if(rows.some(row=>row.id!==value.id&&row.customer_id===value.customerId&&row.name===value.name))throw new Error('이 고객에 같은 이름의 팀이 있습니다. 기존 팀을 선택해 주세요.');
  const team={...old,...value,customer_id:value.customerId,updated_at:new Date().toISOString()};delete team.expectedUpdatedAt;delete team.customerId;
  demo.customerTeams=old?rows.map(row=>row.id===team.id?team:row):[...rows,team];
  toast('체험 팀 정보를 저장했습니다.');return {team};
}
// 예약·수강권이 없는 팀만 삭제(2026-11-20 사용자 지시). 서버가 연결 건수를 재검증한다.
async function deleteCustomerTeamRow(id){
  if(ui.booking.demo){
    context();const demo=ui.booking.demoData;
    if((demo.lessonPasses||[]).some(row=>(row.customer_team_id||row.customerTeamId)===id))throw new Error('수강권이 연결된 팀은 삭제할 수 없습니다.');
    if((demo.rows||[]).some(row=>(row.customerTeamId||row.customer_team_id)===id))throw new Error('예약이 연결된 팀은 삭제할 수 없습니다.');
    demo.customerTeams=(demo.customerTeams||[]).filter(row=>row.id!==id);
    toast('체험 팀을 삭제했습니다.');return {id,deleted:true};
  }
  mustBeOperator();
  const result=await writeOperation(()=>api.deleteCustomerTeam({id}),'팀을 삭제했습니다.');
  if(result?.discarded)throw new Error('로그인이 바뀌었습니다. 고객·팀 목록에서 처리 결과를 확인해 주세요.');
  return result;
}
async function deleteCustomer(payload){
  if(pendingBookingDrafts())throw new Error('작성 중인 예약을 저장하거나 비운 뒤 고객을 삭제해 주세요.');
  if(ui.booking.demo){context();const result=deleteDemoCustomer(payload,ui.booking.demoData);toast('체험 고객을 목록에서 삭제했습니다. 기존 기록은 유지됩니다.');return result;}
  const result=await writeOperation(async()=>{const saved=await api.deleteCustomer(payload);if(!customerDeletionConfirmed(saved,payload.id))throw new Error('고객 삭제 완료를 확인하지 못했습니다. 다시 시도해 주세요.');return saved;},'고객을 목록에서 삭제했습니다. 기존 기록은 유지됩니다.');
  if(result?.discarded)return result;
  if(result.customer){
    state.customers=state.customers.map(row=>row.id===payload.id?{...row,...result.customer}:row);
  }else if(result.alreadyDeleted){
    state.customers=state.customers.filter(row=>row.id!==payload.id);
    state.customerTeams=state.customerTeams.filter(row=>(row.customer_id||row.customerId)!==payload.id);
  }
  return result;
}
function createCustomerReservation({customerId,customerTeamId}){
  if(activeWrite||ui.booking.deckSaving||ui.customers?.saving)return;
  const ctx=context(),selected=customerDirectorySelection(customerId,customerTeamId,ctx,{activeOnly:true});if(!selected)return toast('고객과 팀 정보를 다시 확인해 주세요.');
  let draft=createBookingDraft(ctx,new Date());const defaults=selected.defaults||{};
  Object.assign(draft.raw,defaults.raw||{},selected.raw);
  if(defaults.sport)draft.raw.D=defaults.sport;
  draft=applyLessonPlan(draft,{lessonMinutes:defaults.raw?.N==='4시간'?240:120,breakMinutes:0});
  for(const key of ['participants','age','ageBand','juniorPreparation','experienceCount','parallelLongTurn','snowboardNoviceTurn'])if(defaults[key]!==undefined)draft[key]=defaults[key];
  draft.customerContactPhone=selected.customerContactPhone??selected.raw.L;
  draft.teamPhoneMode=selected.teamPhoneMode||'same';
  draft.customerId=customerId;draft.customerTeamId=customerTeamId||null;
  delete draft.customerDraft;delete draft.teamDraft;
  suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();
}
async function saveBookingBatch(payloads,batchId){
  if(!ui.booking.demo){
    const result=await writeOperation(()=>api.saveReservationBatch(payloads,batchId),`${payloads.length}회 예약을 함께 저장했습니다.`);
    if(result?.discarded)return result;
    adoptSavedPaymentReview(result?.review||result?.paymentReview);
    return {...result,reservations:(result?.reservations||[]).map(row=>normalizeBookingRow(row,state))};
  }
  // The preview stages the complete group before publishing it to page state.
  const ctx=context(),demo=ui.booking.demoData,signature=JSON.stringify(payloads),saved=demo.savedDateBatches?.[batchId];
  if(saved){if(saved.signature!==signature)throw new Error('이미 저장한 일정 묶음의 내용이 바뀌었습니다. 저장 기록을 확인해 주세요.');return clone(saved.result);}
  if(!Array.isArray(payloads)||!payloads.length||payloads.length>100)throw new Error('함께 저장할 일정을 확인해 주세요.');
  const rows=clone(demo.rows),customers=clone(demo.customers||[]),teams=clone(demo.customerTeams||[]),seasons=clone(demo.seasonPackages||[]),resultRows=[];
  const stamp=new Date().toISOString();let newSeason=null;
  for(const source of payloads){
    const row=normalizeBookingRow(clone(source),ctx);
    if(!row.id||rows.some(item=>item.id===row.id))throw new Error('이미 등록된 일정입니다. 예약표를 확인해 주세요.');
    if(row.customerDraft&&!customers.some(item=>item.id===row.customerId))customers.push({...clone(row.customerDraft),updated_at:stamp});
    if(row.teamDraft&&!teams.some(item=>item.id===row.customerTeamId)){
      if(teams.some(item=>item.customer_id===row.customerId&&item.name===row.teamDraft.name))throw new Error('같은 이름의 팀이 있습니다. 기존 팀을 선택해 주세요.');
      teams.push({...clone(row.teamDraft),customer_id:row.customerId,updated_at:stamp});
    }
    if(row.kind==='season'&&!row.seasonId){
      newSeason??=crypto.randomUUID();row.seasonId=newSeason;
      if(!seasons.some(item=>item.id===newSeason))seasons.push({id:newSeason,customer_name:row.raw.H,total_sessions:row.seasonTotal,instructor_user_id:row.preferredInstructorId,customer_id:row.customerId,customer_team_id:row.customerTeamId});
    }
    const interval=parseLessonInterval(row);
    if(interval.error)throw new Error('날짜와 시간을 확인해 주세요.');
    if(row.customerTeamId&&rows.some(other=>other.customerTeamId===row.customerTeamId&&other.status!=='cancelled'&&lessonIntervalsOverlap(parseLessonInterval(other),interval)))throw new Error('같은 팀의 강습 시간이 겹칩니다.');
    const pass=(demo.lessonPasses||[]).find(item=>item.id===row.lessonPassId);
    if(pass&&rows.filter(item=>(item.lessonPassId||item.lesson_pass_id)===pass.id&&!['cancelled','canceled'].includes(item.status)).length>=pass.total_sessions)throw new Error('수강권 잔여 횟수를 초과했습니다.');
    if(row.kind==='season'&&rows.some(item=>(item.seasonId||item.season_id)===row.seasonId&&Number(item.sessionNumber??item.session_number)===Number(row.sessionNumber)))throw new Error('같은 시즌 회차가 이미 등록됐습니다.');
    row.updated_at=stamp;row.expectedUpdatedAt=stamp;delete row.customerDraft;delete row.teamDraft;
    rows.push(row);resultRows.push(row);
  }
  const passes=demoPassPins(rows),result={batchId,reservations:resultRows,replayed:false};
  Object.assign(demo,{rows,customers,customerTeams:teams,seasonPackages:seasons,lessonPasses:passes});
  (demo.savedDateBatches??={})[batchId]={signature,result:clone(result)};
  toast(`체험 예약 ${payloads.length}회를 함께 저장했습니다.`);return result;
}
async function changeReservation(payload,reason,selection={}){
  if(!ui.booking.demo){const result=await writeOperation(()=>api.changeReservation(payload,reason,selection),'예약 변경과 이력을 저장했습니다.');return bookingWriteResult(payload,result);}
  const ctx=context(),before=ctx.reservations.find(row=>row.id===payload.id);
  if(!before)throw new Error('변경할 예약을 다시 확인해 주세요.');
  const stamp=new Date().toISOString(),after={...clone(payload),expectedUpdatedAt:stamp,updated_at:stamp};
  const next=ui.booking.demoData.rows.map(row=>row.id===payload.id?after:row);
  const passes=demoPassPins(next);
  const change={id:crypto.randomUUID(),reservation_id:payload.id,actor_name:'체험 상담사',changed_at:stamp,change_reason:reason,before_snapshot:clone(before),after_snapshot:clone(after),notify_instructor_ids:selection.instructorIds||[],notification_status:'demo'};
  ui.booking.demoData.rows=next;ui.booking.demoData.lessonPasses=passes;
  (ui.booking.demoData.reservationChanges??=[]).unshift(change);
  toast('체험 예약 변경과 이력을 저장했습니다.');return {id:payload.id,updatedAt:stamp,reservation:after,changed:true,changeId:change.id,notificationStatus:'demo'};
}
async function deleteReservation(request){
  const id=request.reservationId;
  if(ui.booking.demo){
    const demo=ui.booking.demoData,row=demo.rows.find(item=>item.id===id);if(!row)throw new Error('삭제할 예약을 다시 확인해 주세요.');
    demo.deletedRequests??={};if(demo.deletedRequests[request.requestId])return clone(demo.deletedRequests[request.requestId]);
    const stamp=new Date().toISOString(),result={id,deleted:true,status:'cancelled',cancelledAt:stamp,updatedAt:stamp,replayed:false};
    demo.rows=demo.rows.map(item=>item.id===id?{...item,status:'cancelled',cancelled_at:stamp,updated_at:stamp,expectedUpdatedAt:stamp}:item);
    demo.deletedRequests[request.requestId]=clone(result);toast('체험 예약 한 건을 삭제했습니다.');return result;
  }
  const result=await writeOperation(()=>api.cancelReservation(request),'예약 한 건을 삭제했습니다.');
  if(result?.discarded)return result;
  if(result?.id!==id||result.status!=='cancelled')throw new Error('삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
  state=applyReservationCancellation(state,id,result);state.customerNotices=selectActiveCustomerNotices(state.customerNotices||[],state);invalidateCustomerLink();return result;
}

function schedulePass(id){
  if(activeWrite||ui.booking.deckSaving)return;
  const ctx=context(),pass=selectPassBalances(ctx).find(row=>row.id===id);
  if(!pass||pass.available<1){toast('일정을 등록할 수강권 잔여 횟수를 확인해 주세요.');return;}
  const draft=createBookingDraft(ctx,new Date());
  Object.assign(draft.raw,{H:pass.customer_name,I:pass.learner_name,L:pass.phone||'',D:pass.sport,E:pass.company||''});
  draft.customerContactPhone=pass.phone||'';draft.teamPhoneMode='same';
  const customerId=pass.customer_id||pass.customerId,teamId=pass.customer_team_id||pass.customerTeamId;
  if(customerId&&teamId){
    const selected=customerDirectorySelection(customerId,teamId,ctx);
    if(!selected){toast('수강권에 연결된 고객·팀 정보를 다시 확인해 주세요.');return;}
    Object.assign(draft.raw,selected.raw);draft.customerId=customerId;draft.customerTeamId=teamId;delete draft.customerDraft;delete draft.teamDraft;
    draft.customerContactPhone=selected.customerContactPhone??selected.raw.L;draft.teamPhoneMode=selected.teamPhoneMode||'same';
    for(const key of ['participants','age','ageBand','juniorPreparation','experienceCount','parallelLongTurn','snowboardNoviceTurn'])if(selected.defaults?.[key]!==undefined)draft[key]=selected.defaults[key];
  }
  draft.raw.E=pass.company||'';
  draft.lessonPassId=id;draft.instructorIds=pass.fixedInstructorId?[pass.fixedInstructorId]:[];
  // 수강권 발급 때 넣은 시간권·비율·강습료·장비·수납액 프리필(2026-11-17 사용자 확정) —
  // 이미 받은 값을 일정 등록에서 다시 묻지 않는다.
  const source=(ctx.lessonPasses||[]).find(row=>row.id===id);
  if(source)draft=applyPassCarryDraft(draft,source);
  suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();
}
// 수강권 신규 발급(2026-11-17 사용자 확정): 별도 발급 모달 대신 예약접수의
// [날짜 미정 · 수강권으로 발급] 모드를 바로 연다 — 입력 양식을 하나로 유지.
function issuePassInline(){
  if(activeWrite||ui.booking.deckSaving){toast('저장 작업을 마친 뒤 발급해 주세요.');return;}
  const draft=createBookingDraft(context(),new Date());
  draft.passIssueMode=true;
  // 멱등 키 시드(2026-11-20): 이 진입은 [data-bk-issue-pass] 클릭을 안 거치므로 시드가 없으면
  // 렌더 폴백의 issueId:'seed' 리터럴이 발급 payload까지 새어 나가 uuid 캐스팅으로 하드 실패했다.
  draft.passConfigs=[{issueId:crypto.randomUUID(),minutes:'',sessions:'',fee:'',done:null}];
  ui.view='booking';
  suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();
}
// 발급 수강권 변경(2026-11-24 사용자 지시): 예약접수 폼을 날짜만 빼고 그대로 열어
// 모든 항목(주니어기술등급제·현금영수증·장비·금액·메모 등)을 수정한다. schedulePass 와
// 동일한 seeding + 저장된 booking(날짜 미정 예약 draft) 병합. 저장은 updateLessonPass.
function editPassInline(id){
  if(activeWrite||ui.booking.deckSaving){toast('저장 작업을 마친 뒤 변경해 주세요.');return;}
  const ctx=context(),pass=selectPassBalances(ctx).find(row=>row.id===id);
  if(!pass){toast('수강권을 찾지 못했습니다. 목록을 새로고침해 주세요.');return;}
  let draft=createBookingDraft(ctx,new Date());
  Object.assign(draft.raw,{H:pass.customer_name,I:pass.learner_name,L:pass.phone||'',D:pass.sport,E:pass.company||''});
  draft.customerContactPhone=pass.phone||'';draft.teamPhoneMode='same';
  const customerId=pass.customer_id||pass.customerId,teamId=pass.customer_team_id||pass.customerTeamId;
  if(customerId&&teamId){
    const selected=customerDirectorySelection(customerId,teamId,ctx);
    if(selected){Object.assign(draft.raw,selected.raw);draft.customerId=customerId;draft.customerTeamId=teamId;delete draft.customerDraft;delete draft.teamDraft;
      draft.customerContactPhone=selected.customerContactPhone??selected.raw.L;draft.teamPhoneMode=selected.teamPhoneMode||'same';
      for(const key of ['participants','age','ageBand','juniorPreparation','experienceCount','parallelLongTurn','snowboardNoviceTurn'])if(selected.defaults?.[key]!==undefined)draft[key]=selected.defaults[key];}
  }
  const source=(ctx.lessonPasses||[]).find(row=>row.id===id);
  const booking=source&&source.booking&&typeof source.booking==='object'&&!Array.isArray(source.booking)?source.booking:null;
  if(booking){
    if(booking.raw)draft.raw={...draft.raw,...booking.raw};
    for(const key of ['lessonMinutes','breakMinutes','age','ageBand','experienceCount','parallelLongTurn','snowboardNoviceTurn','location','participants','cashReceiptRequested','cashReceiptNumberMode','cashReceiptNumber','cashReceiptNumberSet','cashReceiptExtraRequest','rentalPaymentStatus','rentalHours','rentalAmount','rentalCustomAmount','juniorPreparation','teamPhoneMode','customerContactPhone'])
      if(booking[key]!==undefined)draft[key]=booking[key];
  }else if(source){draft=applyPassCarryDraft(draft,source);}
  // 열(column) 권위값으로 동결 필드·식별자를 다시 덮는다(booking.raw 복사본 위에).
  Object.assign(draft.raw,{H:pass.customer_name,I:pass.learner_name,L:pass.phone||draft.raw.L,D:pass.sport||draft.raw.D,E:pass.company||draft.raw.E});
  draft.instructorIds=pass.fixedInstructorId?[pass.fixedInstructorId]:[];
  draft.preferredInstructorId=pass.fixedInstructorId||draft.preferredInstructorId||null;
  draft.id='';draft.passEditMode=true;draft.passId=id;
  draft.passExpectedUpdatedAt=pass.updatedAt||pass.updated_at||source?.updated_at;
  draft.passTotalSessions=String(pass.total_sessions??pass.total??'');
  ui.view='booking';
  suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();
}
function demoPassPins(rows){
  const fixed=new Map((ui.booking.demoData.lessonPasses||[]).map(pass=>[pass.id,pass.fixed_instructor_user_id||null]));
  const identities=new Map((ui.booking.demoData.lessonPasses||[]).filter(pass=>pass.customer_id).map(pass=>[pass.id,{customer_id:pass.customer_id,customer_team_id:pass.customer_team_id}]));
  for(const row of rows){
    if(['cancelled','canceled'].includes(row.status))continue;
    const passId=row.lessonPassId||row.lesson_pass_id,teacher=row.instructorIds?.[0];if(!passId)continue;
    const customerId=row.customerId||row.customer_id,teamId=row.customerTeamId||row.customer_team_id,identity=identities.get(passId);
    if(identity&&(identity.customer_id!==customerId||identity.customer_team_id!==teamId))throw new Error('다른 고객·팀에 연결된 수강권입니다.');
    if(!identity&&customerId&&teamId)identities.set(passId,{customer_id:customerId,customer_team_id:teamId});
    if(!teacher)continue;if(fixed.get(passId)&&fixed.get(passId)!==teacher)throw new Error('수강권 담당 강사가 바뀌었습니다. 배정안을 다시 확인해 주세요.');fixed.set(passId,teacher);
  }
  return (ui.booking.demoData.lessonPasses||[]).map(pass=>({...pass,...identities.get(pass.id),fixed_instructor_user_id:fixed.get(pass.id)||null}));
}
async function refreshDesk({force=false,renderView=true}={}){
  if(!hasOperator())return;
  const identity=authVersion;
  if(readPromise){const previous=readPromise;if(!force)return previous;await previous;if(identity!==authVersion||!hasOperator())return;if(readPromise)return refreshDesk({force:true,renderView});}
  const revision=writeVersion;
  const operation=(async()=>{try{const value=await api.fetchDesk();if(identity!==authVersion||revision!==writeVersion)return {discarded:true};state=value;invalidateCustomerLink();refreshError='';if(renderView&&!dirty&&!ui.booking.drawer&&!activePlan&&!hasUnsavedCallDraft(ui))renderSoon();return {ok:true};}
    catch(error){if(identity!==authVersion||revision!==writeVersion)return {discarded:true};refreshError=error.message||'서버 기록을 불러오지 못했습니다.';if(isAuthError(error)){const message=refreshError;clearOperations();toast(message);}else if(renderView&&!dirty&&!ui.booking.drawer&&!activePlan&&!hasUnsavedCallDraft(ui))renderSoon();return {error};}})();
  readPromise=operation;try{return await operation;}finally{if(readPromise===operation)readPromise=null;}
}
async function writeOperation(work,label){
  mustBeOperator();if(activeWrite)throw new Error('다른 저장 작업을 마친 뒤 다시 시도해 주세요.');
  const token={identity:authVersion};activeWrite=token;writeVersion++;
  try{const result=await work();if(token.identity!==authVersion||!hasOperator())return {discarded:true};dirty=false;await refreshDesk({force:true,renderView:false});if(token.identity!==authVersion||!hasOperator())return {discarded:true};const message=typeof label==='function'?label(result):label;toast(refreshError?`${message} 최신 목록을 다시 불러와 주세요.`:message);return result;}
  catch(error){if(token.identity===authVersion&&isAuthError(error))clearOperations();throw error;}
  finally{if(activeWrite===token)activeWrite=null;}
}
function bookingWriteResult(payload,result){
  if(result?.discarded)return result;
  const id=result?.id||payload.id,row=(state.reservations||[]).find(item=>item.id===id);
  // A refresh can fail after the write succeeded. Never let the cached row hide
  // the just-confirmed correction or replace its new revision with an old one.
  const written=result?.reservation||result||{},hasRaw=!!(written.raw||written.raw_data);
  const base=hasRaw?written:row||payload;
  const receipt=written.paymentRequestCorrectionResult||result?.paymentRequestCorrectionResult;
  const refreshedCorrection=row&&receipt&&(row.currentAmountCorrectionId??row.current_amount_correction_id)===receipt.id&&(row.amountCorrectionVersion??row.amount_correction_version)===receipt.version;
  const authoritative=payload.paymentRequestCorrection?{...payload,...written,raw:written.raw||written.raw_data||(refreshedCorrection?(row.raw||row.raw_data):null)||payload.raw,
    currentAmountOverride:written.currentAmountOverride??written.current_amount_override,
    currentAmountCorrectionId:written.currentAmountCorrectionId??written.current_amount_correction_id,
    amountCorrectionVersion:written.amountCorrectionVersion??written.amount_correction_version,
    paymentRequestCorrectionResult:receipt}:{};
  const reservation=normalizeBookingRow({...base,...authoritative,id,
    expectedUpdatedAt:written.updatedAt||written.updated_at||base.expectedUpdatedAt||payload.expectedUpdatedAt,
    updated_at:written.updatedAt||written.updated_at||base.updated_at||payload.expectedUpdatedAt,
    seasonId:written.seasonId??base.seasonId??payload.seasonId},state);
  return {...result,id,reservation};
}
// 전체 예약·배정표 특이사항(G) 인라인 저장(2026-11-24): 다른 필드 불변, 전용 RPC.
async function saveBookingNotes(id,notes,expectedUpdatedAt){
  const clean=String(notes??'').trim();
  if(ui.booking.demo){
    const row=(state.reservations||[]).find(item=>item.id===id);
    if(row)row.raw={...row.raw,G:clean};
    return {id,updatedAt:row?.updated_at,notes:clean};
  }
  return await writeOperation(()=>api.updateReservationNotes(id,clean,expectedUpdatedAt),'특이사항을 저장했습니다.');
}
async function saveBookingReservation(payload){
  if(ui.booking.demo){
    const existing=recoverSavedBooking(payload,context());
    if(existing)return {id:existing.id,updatedAt:existing.updated_at,reservation:existing};
    const result=await saveBookingBatch([payload],crypto.randomUUID()),reservation=result.reservations[0];
    return {id:reservation.id,updatedAt:reservation.updated_at,reservation};
  }
  const result=await writeOperation(async()=>{
    const identity=authVersion;
    try{return await api.saveReservation(payload);}
    catch(error){
      // A committed save may lose its response. Read back the stable ID before
      // allowing a retry to create ambiguity; never infer success from ID alone.
      if(payload.paymentRequestCorrection)throw error;
      if(identity!==authVersion||!hasOperator()||!payload.id)throw error;
      const check=await refreshDesk({force:true,renderView:false});
      if(identity!==authVersion||!hasOperator())return {discarded:true};
      const row=check?.ok&&recoverSavedBooking(payload,state);
      if(!row)throw error;
      return {id:row.id,updatedAt:row.updated_at||row.updatedAt,seasonId:row.season_id??row.seasonId,recovered:true};
    }
  },'예약과 배정을 서버에 저장했습니다.');
  if(!result?.discarded)adoptSavedPaymentReview(result?.paymentReview||result?.review);
  return bookingWriteResult(payload,result);
}
function issuePassFromBooking(draft){
  // 예약 작성 중 '날짜 미정 수강권' 발급 — 수강권 페이지 왕복 없이 바로 발급 드로어.
  if(activeWrite||ui.booking.deckSaving){toast('저장 작업을 마친 뒤 발급해 주세요.');return;}
  if(ui.passes?.issuing){toast('작성 중인 수강권을 먼저 저장하거나 닫아 주세요.');return;}
  const raw=draft?.raw||{};
  ui.passes={...(ui.passes||{}),issuing:true,error:'',draft:{id:null,bookingIssue:true,...(draft?.customerId&&draft?.customerTeamId?{customerId:draft.customerId,teamId:draft.customerTeamId,...(draft.customerDraft?{customerDraft:draft.customerDraft}:{}),...(draft.teamDraft?{teamDraft:draft.teamDraft}:{})}:{}),customerName:String(raw.H||'').trim(),learnerName:String(raw.I||raw.H||'').trim(),phone:String(raw.L||draft?.customerContactPhone||'').trim(),company:String(raw.E||'').trim(),sport:['스키','보드'].includes(String(raw.D||'').trim())?String(raw.D).trim():'스키',totalSessions:'',lessonRatio:/^[1-9]\d?$/.test(String(raw.M||'').trim())?`1:${String(raw.M).trim()}`:'',participants:Array.isArray(draft?.participants)?draft.participants.map(person=>({type:person?.type==='minor'?'minor':'adult',age:person?.type==='minor'&&Number.isInteger(person?.age)?person.age:null})):[],fixedInstructorId:draft?.preferredInstructorId||'',notes:String(raw.G||'').trim()}};
  dirty=false;render();
}
function openReservation(id){if(activeWrite||ui.booking.deckSaving)return;const ctx=context(),row=ctx.reservations.find(item=>item.id===id&&!['cancelled','canceled'].includes(item.status));if(!row){if(hasOperator()&&!ui.booking.demo&&state.schedules.some(item=>item.id===id)){toast('기존 시트에서 가져온 일정입니다. 웹 예약으로 등록된 강습만 수정할 수 있습니다.');return;}toast('최신 예약 정보를 다시 확인해 주세요.');return;}closePlan();suspendBookingDrafts(app,ui);
  // 같은 팀의 다른 회차도 카드로 함께 열어 한 화면에서 조회·변경한다 (2026-11-15).
  const norm=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').toLocaleLowerCase('en-US');
  const teamKeyOf=item=>item.customerTeamId?`team:${item.customerTeamId}`:`raw:${norm(item.raw?.H)}|${norm(item.raw?.I)}|${norm(item.raw?.L)}`;
  const base=normalizeBookingRow(clone(row),ctx),key=teamKeyOf(base);
  const siblings=ctx.reservations
    .filter(item=>item.id!==id&&!['cancelled','canceled'].includes(item.status))
    .map(item=>normalizeBookingRow(clone(item),ctx))
    .filter(item=>teamKeyOf(item)===key&&norm(item.raw?.H))
    .sort((a,b)=>String(a.raw?.A||'').localeCompare(String(b.raw?.A||'')));
  for(const sibling of siblings.slice(0,11))openBookingDraft(ui,sibling,{tab:'intake'});
  openBookingDraft(ui,base,{tab:'intake'});dirty=false;render();}
function createReservation(value){if(activeWrite||ui.booking.deckSaving)return;const ctx=context();let draft=createBookingDraft(ctx,new Date());Object.assign(draft.raw,{A:value.date,B:value.startTime});const start=parseLessonTime(value.startTime),end=parseLessonTime(value.endTime),minutes=start&&end?(end.hour-start.hour)*60+end.minute-start.minute:120;draft=applyLessonPlan(draft,{lessonMinutes:minutes===240?240:120,breakMinutes:0});draft.instructorIds=value.instructorId?[value.instructorId]:[];suspendBookingDrafts(app,ui);openBookingDraft(ui,draft,{tab:'intake'});dirty=false;render();}
function moveReservation(value){
  if(activeWrite||ui.booking.deckSaving)return;
  const ctx=context(),row=ctx.reservations.find(item=>item.id===value.id);
  if(!row){toast('변경할 예약을 다시 확인해 주세요.');return;}
  suspendBookingDrafts(app,ui);
  const pending=ui.booking.teamDeck?.cards?.find(card=>card.draft?.id===value.id&&card.status==='edited');
  const draft=normalizeBookingRow(clone(pending?.draft||row),ctx);
  Object.assign(draft.raw,{A:value.date,B:value.startTime,C:value.endTime});
  if(draft.lessonMinutes!=null)Object.assign(draft,applyLessonPlan(draft,{startTime:value.startTime}));
  if(value.instructorId&&!draft.instructorIds.includes(value.instructorId))draft.instructorIds=[value.instructorId,...draft.instructorIds.slice(1)];
  closePlan();openBookingDraft(ui,draft,{tab:'intake',replaceCurrent:true,baseline:row});dirty=true;render();
  toast('이동할 일정을 불러왔습니다. 변경 내용을 확인하고 확정해 주세요.');
}
function currentPlanRows(ctx,id){if(id)return ctx.reservations.filter(row=>row.id===id);if(ui.view==='timetable')return selectBookingRows(ctx,{date:ui.timetable.date,company:ui.timetable.company||'all',sport:ui.timetable.sport||'all'});return selectBookingRows(ctx,ui.booking);}
const planSignature=plan=>JSON.stringify(plan.items.map(item=>({id:item.id,instructorId:item.instructorId,eligible:item.eligible,start:item.start,end:item.end,lessonMinutes:item.lessonMinutes,breakMinutes:item.breakMinutes,busySegments:item.busySegments,expectedUpdatedAt:item.expectedUpdatedAt,reasonCodes:item.reasonCodes,seasonId:item.seasonId,seasonReservationIds:item.seasonReservationIds})).sort((a,b)=>a.id.localeCompare(b.id)));
function openAutoAssign(id){
  if(activeWrite||ui.booking.deckSaving)return toast('저장을 마친 뒤 자동배정을 실행해 주세요.');
  suspendBookingDrafts(app,ui);
  render();
  const ctx=context(),rows=currentPlanRows(ctx,id),plan=buildAssignmentPlan(rows,ctx,{now:new Date()});
  activePlan={plan,ids:rows.map(row=>row.id),mode:ui.booking.demo?'preview':'operational',identity:authVersion,signature:planSignature(plan)};
  const node=planDialog();
  const renderPlan=()=>{
    node.innerHTML=renderAssignmentPlan({plan,escapeHTML:esc,icon,mode:activePlan.mode,sort:activePlan.sort||{}});
    bindAssignmentPlan(node,{plan,onClose:closePlan,onOpenReservation:rid=>{closePlan();openReservation(rid);},onApply:applyPlan,onSort:key=>{
      const cur=activePlan.sort||{};
      activePlan.sort=cur.key===key?{key,dir:cur.dir==='asc'?'desc':'asc'}:{key,dir:'asc'};
      renderPlan();
    }});
  };
  renderPlan();if(!node.open)node.showModal();
}
async function applyPlan(items){
  const pending=activePlan;if(!pending)throw new Error('자동배정안을 다시 만들어 주세요.');
  if(pending.mode==='preview'){
    if(!ui.booking.demo)throw new Error('운영 모드가 바뀌었습니다. 배정안을 다시 만들어 주세요.');
    const ctx=context(),freshRows=ctx.reservations.filter(row=>pending.ids.includes(row.id)),fresh=buildAssignmentPlan(freshRows,ctx,{now:new Date()});
    if(pending.signature!==planSignature(fresh))throw new Error('예약 조건이 바뀌었습니다. 자동배정안을 다시 만들어 주세요.');
    const selected=new Map(fresh.assignable.map(item=>[item.id,item]));
    for(const item of fresh.assignable)for(const id of item.seasonReservationIds||[])if(!selected.has(id))selected.set(id,{...item,id});
    const next=ui.booking.demoData.rows.map(row=>{const item=selected.get(row.id);return item?{...row,instructorIds:[item.instructorId],raw:{...row.raw,F:item.instructorName},status:'confirmed'}:row;});
    ui.booking.demoData.seasonPackages=(ui.booking.demoData.seasonPackages||[]).map(pack=>{const item=fresh.assignable.find(row=>row.seasonId===pack.id);return item?{...pack,instructor_user_id:item.instructorId}:pack;});
    const passes=demoPassPins(next);ui.booking.demoData.rows=next;ui.booking.demoData.lessonPasses=passes;closePlan();render();toast(`체험 예약 ${selected.size}건에 자동배정을 적용했습니다.`);return;
  }
  mustBeOperator();if(pending.identity!==authVersion||ui.booking.demo)throw new Error('운영 계정이 바뀌었습니다. 배정안을 다시 만들어 주세요.');
  const result=await writeOperation(async()=>{const saved=await api.applyAssignments(items);assignmentSaveMessage(saved,items);return saved;},saved=>assignmentSaveMessage(saved,items));
  if(result?.discarded)return;closePlan();render();
}
async function openLogin(){if(checkingSession||!canLeaveBookingMode())return;if(isUnifiedBookingLocation()||['BOOKING_ACCESS_REQUIRED','PASSWORD_SETUP_REQUIRED'].includes(accessError?.code)){location.assign(accessError?.code==='BOOKING_ACCESS_REQUIRED'?bookingStaffLinks().home:bookingStaffLinks().login);return;}if(hasOperator()){modeChanged();ui.booking={...ui.booking,demo:false,drawer:null,draft:null,teamDeck:null,deckMode:'operational'};render();return;}loginError('');form.elements.password.value='';if(!dialog.open)dialog.showModal();form.elements.email.focus();}
function closeLogin(){if(signingIn)return;dialog.close();form.elements.password.value='';loginError('');}
form.addEventListener('submit',async event=>{event.preventDefault();if(signingIn)return;if(!form.checkValidity()){form.reportValidity();return;}const values=new FormData(form),submit=form.querySelector('[type=submit]'),identity=authVersion;signingIn=true;submit.disabled=true;submit.textContent='운영 계정 확인 중…';loginError('');try{const module=await getApi();await module.login({email:String(values.get('email')).trim(),password:String(values.get('password'))});const value=await module.fetchDesk();if(identity!==authVersion)return;authVersion++;writeVersion++;state=value;operational=true;accessError=null;modeChanged();ui.booking={demo:false,drawer:null,draft:null};refreshError='';dirty=false;form.elements.password.value='';dialog.close();render();if(ui.view==='calls')void loadCommunications();if(ui.view==='payments')void loadPaymentReviews();if(ui.view==='friends')void loadFriendMatches();if(ui.view==='reviews')void loadReviewsAdmin();toast('운영 예약표를 열었습니다.');}catch(error){loginError(error.message||'로그인하지 못했습니다.');}finally{signingIn=false;submit.disabled=false;submit.textContent='운영 예약표 열기';}});
$('#desk-login').onclick=openLogin;$('#desk-logout').onclick=async()=>{if(await exitOperations())toast('예약 운영에서 로그아웃했습니다.');};$('#desk-refresh').onclick=async()=>{if(ui.view==='friends'){await loadFriendMatches();return;}if(ui.view==='payments'){const refresh=app.querySelector('[data-pr-refresh]');if(refresh){if(!refresh.disabled)refresh.click();}else await loadPaymentReviews();return;}if(ui.view==='calls'){await loadCommunications();return;}if(ui.view==='reviews'){await loadReviewsAdmin();return;}await refreshDesk({force:true});if(ui.view==='changes')await loadCustomerChanges();};
document.querySelectorAll('[data-login-cancel]').forEach(button=>button.onclick=closeLogin);dialog.addEventListener('cancel',event=>{if(signingIn)event.preventDefault();else{form.elements.password.value='';loginError('');}});
function changeDeskView(view){if(view!==ui.view&&ui.passes?.issuing){toast('작성 중인 수강권을 저장하거나 닫은 뒤 이동해 주세요.');history.replaceState(null,'',`${location.pathname}${location.search}#${ui.view}`);return;}if(view!==ui.view&&hasPaymentReviewInFlight(ui)){toast('사진 전송·저장을 마친 뒤 이동해 주세요.');history.replaceState(null,'',`${location.pathname}${location.search}#${ui.view}`);return;}if(view!==ui.view&&hasSmsHistoryWork(ui)){toast('과거 문자 가져오기를 마치거나 가져오기 화면을 닫은 뒤 이동해 주세요.');history.replaceState(null,'',`${location.pathname}${location.search}#${ui.view}`);return;}if(ui.view==='calls'&&view!==ui.view&&hasUnsavedCallDraft(ui)){toast('작성 중인 상담 기록이나 휴대폰 설정을 먼저 저장해 주세요.');history.replaceState(null,'',`${location.pathname}${location.search}#${ui.view}`);return;}if(['calls','payments','reviews','friends'].includes(view)&&(!hasOperator()||ui.booking.demo))view='reservations';if(view==='changes'&&!canReviewCustomerChanges(state.profile)){toast('고객 일정 요청은 관리자가 검토합니다.');view='reservations';}if(activeWrite||ui.booking.deckSaving||ui.customers?.saving){history.replaceState(null,'',`${location.pathname}${location.search}#${ui.view}`);return;}closePlan();if(ui.view==='payments'&&view!==ui.view)suspendPaymentReview(app,ui);suspendBookingDrafts(app,ui);suspendCustomerEditor(ui);if(view!==ui.view){delete ui.friendMatches;clearSmsMediaViews(ui);clearSmsHistory(ui);}ui.view=view;dirty=false;history.replaceState(null,'',`${location.pathname}${location.search}#${ui.view}`);render();if(view==='changes')void loadCustomerChanges();if(view==='calls')void loadCommunications();if(view==='payments')void loadPaymentReviews();if(view==='friends')void loadFriendMatches();if(view==='reviews')void loadReviewsAdmin();}
document.querySelectorAll('[data-desk-view]').forEach(button=>button.onclick=()=>changeDeskView(button.dataset.deskView));
$('[data-desk-autoassign]').onclick=()=>openAutoAssign();window.addEventListener('hashchange',()=>changeDeskView(viewFromHash()));
window.addEventListener('beforeunload',event=>{if(ui.passes?.issuing||hasPaymentReviewWork(ui)||activeWrite||pendingBookingDrafts()||hasUnsavedCustomerDraft(ui)||hasUnsavedCallDraft(ui)||hasSmsHistoryWork(ui)){event.preventDefault();event.returnValue='';}});
app.addEventListener('input',event=>{if(event.target.closest('form')&&!event.target.closest('[data-call-inbox]')&&!event.target.closest('[data-sms-inbox]')&&!event.target.closest('[data-payment-review]'))dirty=true;});app.addEventListener('change',event=>{if(event.target.closest('form')&&!event.target.closest('[data-call-inbox]')&&!event.target.closest('[data-sms-inbox]')&&!event.target.closest('[data-payment-review]'))dirty=true;});
const editingCommunicationInput=()=>!!document.activeElement?.matches?.('input,textarea,select')&&!!document.activeElement?.closest?.('[data-call-inbox],[data-sms-inbox],[data-kakao-inbox]');
const canPoll=()=>ui.view!=='friends'&&ui.view!=='payments'&&!hasPaymentReviewWork(ui)&&!isSmsHistoryOpen(ui)&&hasOperator()&&!ui.booking.demo&&!document.hidden&&!dirty&&!editingCommunicationInput()&&!(ui.view==='calls'&&(ui.communicationTab==='sms'||ui.communicationTab==='forms')&&hasSmsFilterDraft(ui))&&!ui.booking.drawer&&!ui.passes?.issuing&&!(ui.customers?.editor&&!ui.customers?.suspended)&&!hasUnsavedCustomerDraft(ui)&&!hasUnsavedCallDraft(ui)&&!activePlan&&!activeWrite&&!$('#desk-assignment-dialog')?.open;
const pollDesk=()=>{if(canPoll()){if(ui.view==='calls'){if(!ui.callInboxLoading&&!ui.smsInboxLoading)void loadCommunications({quiet:true});}else void refreshDesk();}};
window.addEventListener('focus',pollDesk);document.addEventListener('visibilitychange',pollDesk);setInterval(pollDesk,30000);
async function bootDesk(){
  render();
  const identity=authVersion;
  let bootError='';
  try{
    const module=await getApi(),value=await module.fetchDesk();
    if(identity!==authVersion)return;
    state=value;operational=true;accessError=null;modeChanged();ui.booking={demo:false,drawer:null,draft:null};refreshError='';
  }catch(error){
    if(identity!==authVersion)return;
    state=emptyState();operational=false;accessError=isAuthError(error)?error:null;
    if(!isAuthError(error))bootError='로그인 상태를 확인하지 못했습니다. 연결을 확인하고 다시 로그인해 주세요.';
  }finally{
    if(identity!==authVersion)return;
    checkingSession=false;render();
    if(hasOperator()&&ui.view==='calls')void loadCommunications();
    if(hasOperator()&&ui.view==='payments')void loadPaymentReviews();
    if(hasOperator()&&ui.view==='friends')void loadFriendMatches();
    if(hasOperator()&&ui.view==='reviews')void loadReviewsAdmin();
    if(!hasOperator()){
      await openLogin();
      if(bootError)loginError(bootError);
    }
  }
}
bootDesk();
