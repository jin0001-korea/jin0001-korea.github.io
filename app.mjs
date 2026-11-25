import {loadCashReceipts,issueCashReceipt} from './cash-receipt-client.mjs?v=33';
import {canManageCashReceipts,renderCashReceipts,renderCashReceiptNotice,renderCashReceiptIssue} from './cash-receipt-view.mjs?v=34';
import {loadAdminGuide} from './admin-guide-client.mjs?v=1';
import {renderSheetsSync} from './sheets-sync-view.mjs?v=1';
import { getWarnings, reportDeadline, parseScheduleCSV } from './rules.mjs';
import { warningEvidence, warningEvidenceMatches } from './warning-evidence.mjs?v=17';
import { renderScorePage } from './score-view.mjs';
import { renderOverview, bindOverview } from './overview-view.mjs?v=18';
import { renderPerformance } from './performance-view.mjs?v=2';
import { renderWebReorders } from './reorder-view.mjs?v=2';
import { renderChangeNotifications, bindChangeNotifications, unreadReservationChangeNotifications } from './change-notifications-view.mjs?v=7';
import { customerRequestNotifications, renderCustomerRequestNotifications } from './customer-request-notifications.mjs?v=2';
import { renderTimeOff, bindTimeOff } from './timeoff-view.mjs?v=3';
import { setInstructorPrivacy } from './privacy-guard.mjs?v=8';
import { driveMediaAction, ownerAuthorizationUrl, driveShareUrl } from './drive-media-api.mjs?v=10';
import { createDriveUploadController } from './drive-upload.mjs?v=20';
import { mountDriveMedia, mountDriveSettings } from './drive-media-view.mjs?v=21';
import {mountSolapiSettings} from './solapi-settings-view.mjs?v=36';
import {solapiAction} from './solapi-api.mjs?v=10';
import { enablePushNotifications, getPushStatus, disablePushNotifications } from './push-client.mjs?v=10';
import { currentSession, signOut, onSessionChange, consumeSetupLink, renderAuthScreen } from './auth-client.mjs?v=16';
import { fetchWorkspace, saveRemoteReport, saveRemoteProof, getRemotePhoto, saveRemoteResponse, saveRemoteReview, saveRemoteSettings, importRemoteSchedules, accountAction, setMemberStatus, surveyAction, reviewsAction, automationAction, markAlertRead, markReservationChangeNotificationRead } from './workspace-api.mjs?v=37';
import { requestTimeOff, reviewTimeOff, cancelTimeOff } from './workspace-api.mjs?v=37';
import {staffDirectoryGroups,canManageInstructor,instructorNameChange,instructorLinkedScheduleCount,renderInstructorDirectoryActions} from './staff-directory.mjs?v=1';
import {staffDestination, requestedBooking, bookingWorkspaceUrl, staffMenu, staffMenuGroups, staffRoleLabel, canUseAdminGuide} from './staff-routing.mjs?v=41';
import {renderScheduleRental} from './schedule-rental.mjs?v=1';
import {schedulePaymentNeedsAttention,renderSchedulePayment} from './schedule-payment.mjs?v=2';

const RESERVATION_SITE_URL = bookingWorkspaceUrl(location.href);
let bookingRequested=requestedBooking(location.search)||location.hash==='#bookings';
let authEpoch=0,routingToBooking=false;
const $ = (s, root = document) => root.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  mountain:'m3 19 9-14 9 14H3Zm5-8 4 3 3-4', grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z', report:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M7 12h8m-8 4h8', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4', users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 0a4 4 0 0 1 0 8', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3-1 2 3-2 3 2 3-2 4-3-1-1 3h-4l-1-3-3 1-2-4 2-3-2-3 2-3 3 1 1-3Z', arrow:'m9 5 7 7-7 7', check:'m5 12 4 4L19 6', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2', camera:'M14 4h-4L8 7H3v14h18V7h-5l-2-3ZM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', plus:'M12 5v14M5 12h14', upload:'m7 8 5-5 5 5m-5-5v12M3 14v6h18v-6', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6', download:'m7 11 5 5 5-5m-5 5V3M3 17v4h18v-4', warning:'m12 3 10 18H2L12 3Zm0 6v5m0 3v1', link:'m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0', mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7', close:'m6 6 12 12M6 18 18 6', external:'M14 3h7v7m0-7L10 14M9 3H3v18h18v-6', star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z', snow:'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7m-12-3L12 6l3.3-2M8.7 20l3.3-2 3.3 2', refresh:'M20 11a8 8 0 1 0-2 7M20 4v7h-7', shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6', sheet:'M5 2h14v20H5V2Zm0 7h14M5 14h14M10 9v13', video:'M3 5h12v14H3V5Zm12 4 6-3v12l-6-3', help:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-3 6a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v1'
};
const icon = (name, extra='') => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const kstDate = (value = new Date()) => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const time = value => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const dateLabel = (value, long=false) => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:long?'long':'numeric',day:'numeric',...(long?{weekday:'long'}:{})}).format(new Date(value));
const now = () => new Date();
const initials = name => esc(String(name).slice(-2));
const today = kstDate();
const defaultSettings = {lateMinutes:10,minDuration:110,photoMinimum:12,videoMinimum:2,similarityThreshold:.8,timeRuleMode:'either',sheetUrl:'',smsTemplate:'[SLOPE] {고객명}님, 오늘의 강습 사진·영상과 보고서가 등록되었습니다.\n{링크}'};
let state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};
let ui={role:'instructor',instructor:'',page:'dashboard',date:today,filter:'all',query:'',alertFilter:'pending',reportFilter:'all',detailTab:'proof',overview:{}};
let cashReceiptFilter='pending',cashReceiptQuery='';
let adminGuide={userId:null,html:'',error:'',loading:false,request:0};
const app=$('#app'); const modal=$('#modal'); let activeLessonId=null;let loadingWorkspace=0;let loadingUserId=null;let passwordMode=false;
let modalDirty=false;let mainDirty=false;let syncPromise=null;let lastSyncAt=0;let checksRunning=false;let pushBusy=false;
let pushState={supported:null,enabled:false,permission:'default',message:''};let warningCache={state:null,minute:null,value:[]};
const driveUploads=new Map();
const driveInstructorSelections=new Map();
let driveMediaView=null,driveSettingsView=null;
let solapiSettingsView=null;
function cleanupSolapiSettings(){solapiSettingsView?.cleanup();solapiSettingsView=null;}
function cleanupDriveMedia(){driveMediaView?.cleanup();driveMediaView=null;}
function cleanupDriveSettings(){driveSettingsView?.cleanup();driveSettingsView=null;}
function stopDriveUploads(){
  cleanupDriveMedia();cleanupDriveSettings();cleanupSolapiSettings();
  for(const entry of driveUploads.values())entry.manager.dispose({clearMemory:true});
  driveUploads.clear();driveInstructorSelections.clear();
}
function reconcileDriveAccess(){
  for(const [key,entry] of driveUploads){
    const schedule=find(entry.scheduleId),profile=state.profile;
    const ownAdminFolder=profile?.role==='admin'&&entry.instructorId===profile.user_id;
    if(!profile||profile.user_id!==entry.userId||profile.role!==entry.role||profile.active===false||profile.must_change_password||!schedule||!ownAdminFolder&&!schedule.instructorUserIds?.includes(entry.instructorId)||profile.role!=='admin'&&entry.instructorId!==profile.user_id){
      entry.manager.dispose({clearMemory:true});driveUploads.delete(key);
      if(activeLessonId===entry.scheduleId)cleanupDriveMedia();
    }
  }
}
function mediaManager(schedule,instructorId){
  const userId=state.profile.user_id,role=state.profile.role,key=`${userId}:${schedule.id}:${instructorId}`;
  if(!driveUploads.has(key)){
    const service=async(action,payload,options)=>{
      if(state.profile?.user_id!==userId||state.profile?.role!==role)throw new Error('다시 로그인해 주세요.');
      return driveMediaAction(action,payload,options);
    };
    driveUploads.set(key,{userId,role,scheduleId:schedule.id,instructorId,manager:createDriveUploadController({userId,scheduleId:schedule.id,instructorId,service})});
  }
  return driveUploads.get(key).manager;
}
async function copyDriveLink(value){
  const url=driveShareUrl(value);
  try{await navigator.clipboard.writeText(url);toast('Drive 공유 링크를 복사했습니다.');}
  catch{
    const input=modal.querySelector('input[data-drive-copyable]');
    if(input){input.value=url;input.focus();input.select();if(document.execCommand('copy')){toast('Drive 공유 링크를 복사했습니다.');return;}}
    throw new Error('공유 링크를 선택했습니다. 길게 누르거나 복사 단축키로 복사해 주세요.');
  }
}
function mountLessonMedia(schedule,instructorId){
  cleanupDriveMedia();const host=$('#drive-media-host',modal);if(!host)return;
  const assigned=schedule.instructorUserIds||[];
  const owners=ui.role==='admin'?[...new Set([...assigned,state.profile.user_id])]:assigned;
  const selected=ui.role==='instructor'?(assigned.includes(state.profile.user_id)?state.profile.user_id:null):owners.includes(instructorId)?instructorId:owners.includes(driveInstructorSelections.get(schedule.id))?driveInstructorSelections.get(schedule.id):owners[0];
  if(selected)driveInstructorSelections.set(schedule.id,selected);
  driveMediaView=mountDriveMedia(host,{schedule,profile:state.profile,roster:state.roster,instructorId:selected,api:driveMediaAction,manager:selected?mediaManager(schedule,selected):null,onCopy:copyDriveLink,onReport:()=>{if(mayLeaveEdits({dialog:true,uploads:true}))openLesson(schedule.id,'report');},onInstructorChange:id=>{if(mayLeaveEdits({dialog:true,uploads:true}))mountLessonMedia(schedule,id);else mountLessonMedia(schedule,instructorId||selected);}});
}
window.addEventListener('beforeunload',event=>{
  if(mainDirty||modal.open&&modalDirty||hasIncompleteUploads()||app.querySelector('form[data-saving], [data-timeoff-saving]')||modal.open&&modal.querySelector('form[data-saving], [data-timeoff-saving]')){event.preventDefault();event.returnValue='';}
});
function toast(message) {const t=$('#toast');t.textContent=message;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,4000);}
const allWarnings=()=>{
  const current=now(),minute=Math.floor(current.getTime()/60000);
  if(warningCache.state===state&&warningCache.minute===minute)return warningCache.value;
  const local=getWarnings(state.schedules,state.settings,current,{includeSimilarity:false});
  const merged=new Map(local.map(w=>[w.id,{...w,source:'local'}]));
  for(const server of state.alerts||[]){
    if(server.category==='customer-request'||server.active===false||server.resolvedAt)continue;
    const lesson=state.schedules.find(s=>s.id===server.scheduleId);if(!lesson)continue;
    const immediate=merged.get(server.id);
    if(immediate){merged.set(server.id,{...server,...immediate,source:immediate.detail===server.detail?'server':'local'});continue;}
    const changedAt=Math.max(...[lesson.updatedAt,lesson.report?.updatedAt,lesson.report?.submittedAt,lesson.checkIn?.uploadedAt,lesson.checkOut?.uploadedAt,state.settingsUpdatedAt].filter(Boolean).map(v=>new Date(v).getTime()),0);
    if(changedAt<=new Date(server.lastDetectedAt||0).getTime())merged.set(server.id,server);
  }
  const value=[...merged.values()];warningCache={state,minute,value};return value;
};
const find=id=>state.schedules.find(s=>s.id===id);
const visible=()=>state.schedules.filter(s=>ui.role==='admin'||s.instructorUserIds?.includes(state.profile?.user_id));
const warnings=()=>allWarnings().filter(w=>visible().some(s=>s.id===w.scheduleId));
const recipientFor=id=>(state.notifications||[]).find(n=>n.alert_id===id);
const unreadNotifications=()=>{const ids=new Set(warnings().map(w=>w.id));return(state.notifications||[]).filter(n=>!n.read_at&&ids.has(n.alert_id));};
const activeResponse=w=>{const r=find(w.scheduleId)?.responses?.[w.id];return warningEvidenceMatches(w,r?.evidence)?r:null;};
const activeReview=w=>{const r=find(w.scheduleId)?.reviews?.[w.id],response=activeResponse(w);return warningEvidenceMatches(w,r?.evidence)&&(!response||new Date(response.at)<=new Date(r.at))?r:null;};
const isFinalReview=w=>['confirmed','dismissed'].includes(activeReview(w)?.result);
const isPending=w=>!isFinalReview(w)&&(ui.role==='admin'||!activeResponse(w)||(activeReview(w)?.result==='followup'&&new Date(activeResponse(w).at)<new Date(activeReview(w).at)));
const badge=(label,type='neutral')=>`<span class="status-badge ${type}">${esc(label)}</span>`;
const avatar=(name,small=true)=>`<span class="avatar ${small?'small':''}" style="background:${['#e3eef0','#ece9f6','#f9eddf'][[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%3]}">${initials(name)}</span>`;
function status(s) {
  if(s.report) return badge('보고서 등록','success');
  if(now()>reportDeadline(s)) return badge('기한 초과','danger');
  if(new Date(s.end)<now()) return badge('보고서 미등록','warning');
  if(s.checkOut) return badge('보고서 대기','warning');
  if(s.checkIn) return badge('강습 중','info');
  return badge('강습 예정');
}
const steps=s=>`<div class="progress-steps">${[['만남',s.checkIn],['헤어짐',s.checkOut],['보고서',s.report]].map(([t,v])=>`<span class="step"><i class="dot ${v?'done':'pending'}">${v?icon('check'):''}</i>${t}</span>`).join('')}</div>`;
const empty=(title,sub='')=>`<div class="empty-state"><div class="empty-illustration">${icon('check')}</div><strong>${esc(title)}</strong><p>${esc(sub)}</p></div>`;
const pageTitles={payments:'입금 검토','cash-receipts':'현금영수증 관리',guide:'기능 · 업무 안내',bookings:'예약 · 강사 배정',changes:'고객 일정 요청',calls:'상담 · 전화',timeoff:'휴무 신청',dashboard:'운영 현황',overview:'통합 현황표',schedules:'강습 일정',reports:'보고서 관리',alerts:'확인 · 알림',instructors:'계정 · 권한 관리',scores:'만족도 · 리오더',settings:'운영 설정'};
const mountainArt=`<svg class="hero-art" viewBox="0 0 360 160" fill="none" aria-hidden="true"><circle cx="279" cy="36" r="24" fill="#d5edaa"/><path d="m0 160 96-128 68 80 58-72 138 120" fill="#70b4b5" opacity=".32"/><path d="m70 160 108-144 126 144" fill="#e7f1eb"/><path d="m149 55 29-39 36 41-21-10-17 13-13-12-14 7Z" fill="white"/><path d="m178 16 126 144H163l15-144Z" fill="#a8d0cb"/><path d="m96 160 57-67 53 67M244 160l54-70 62 70" fill="#234d50" opacity=".65"/><path d="m290 87 8-12 8 12m-8-5v44M37 131l9-14 9 14m-9-8v29" stroke="#d5edaa" stroke-width="2"/><path d="M208 83c-38 16-33 29 3 33s33 23 8 44" stroke="white" stroke-width="3" stroke-dasharray="4 5"/></svg>`;
function render() {
  if(!state.profile||passwordMode){clearAdminGuide();return;}
  if(!canManageCashReceipts(state.profile)&&modal.querySelector('#cash-receipt-issue-form')){modal.close();modal.innerHTML='';}
  if(adminGuide.userId&&(!canUseAdminGuide(state.profile)||adminGuide.userId!==state.profile.user_id))clearAdminGuide();
  if(staffDestination(state.profile)==='booking'){routeToBooking();return;}
  if(staffDestination(state.profile)!=='workspace'){showLogin('계정 권한을 다시 확인해 주세요.');return;}
  if(['bookings','changes','calls','payments'].includes(ui.page)&&state.profile.role==='admin'){routeToBooking(ui.page==='bookings'?'reservations':ui.page);return;}
  cleanupDriveSettings();cleanupSolapiSettings();
  mainDirty=false;
  const unreadChanges=unreadReservationChangeNotifications(state).length;
  const unreadRequests=customerRequestNotifications(state,{unreadOnly:true}).length;
  const pendingReceipts=canManageCashReceipts(state.profile)?state.cashReceipts?.summary?.pendingCount||0:0;
  const pending=warnings().filter(isPending).length+unreadChanges+unreadRequests+pendingReceipts;const unread=unreadNotifications().length+unreadChanges+unreadRequests+pendingReceipts;
  const nav=staffMenu(ui.role);
  app.innerHTML=`<div class="app"><aside class="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark">${icon('mountain')}</span><span class="brand-name">SLOPE<small>통합 운영관리</small></span></a><div class="workspace-badge"><span class="workspace-logo">S</span><span>스노우파크 스키스쿨<small>2026 / 27 SEASON</small></span></div><div class="nav-label">업무 메뉴</div><nav class="staff-navigation" aria-label="업무 메뉴">${groupedStaffNavigation({pending})}</nav><div class="sidebar-bottom"><div class="season-card">${icon('snow')}<strong>좋은 강습의 시작,<br>꼼꼼한 기록에서.</strong><p>오늘의 모든 순간을 연결하세요.</p><span>26 / 27 WINTER SEASON</span></div><div class="sidebar-foot">SLOPE © 2026</div></div></aside><main class="main"><header class="topbar"><div class="breadcrumbs">워크스페이스 <span>/</span> <strong>${ui.role==='instructor'?'강사 업무':'관리자 업무'}</strong></div><div class="topbar-right"><button class="btn ghost small workspace-refresh" data-action="refresh" aria-label="서버의 최신 강습 기록 새로고침" title="서버의 최신 기록 새로고침">${icon('refresh')}<span>새로고침</span></button><span class="status-badge ${ui.role==='admin'?'info':'success'}">${ui.role==='admin'?'관리자':'강사'} 계정</span><button class="btn ghost small account-button" data-action="account">${esc(state.profile.display_name)}</button><button class="btn ghost small" data-action="logout">로그아웃</button><button class="icon-btn notification-button" data-action="alerts" aria-label="읽지 않은 알림 ${unread}건" title="읽지 않은 알림 ${unread}건">${icon('bell')}${unread?'<i></i>':''}</button>${avatar(state.profile.display_name)}</div></header><div class="content">${!['alerts','cash-receipts'].includes(ui.page)?renderCashReceiptNotice({profile:state.profile,data:state.cashReceipts,error:state.cashReceiptsError,compact:true}):''}${unreadRequests&&ui.page!=='alerts'?`<a class="btn secondary" href="/booking/#changes" style="width:100%;justify-content:space-between;white-space:normal;text-align:left;margin-bottom:22px">${icon('bell')}<span>읽지 않은 고객 일정 요청 알림 <strong>${unreadRequests}건</strong>이 있습니다.</span><span>요청 검토하기 ${icon('arrow')}</span></a>`:''}${unreadChanges?`<button type="button" class="btn secondary" data-action="alerts" style="width:100%;justify-content:space-between;white-space:normal;text-align:left;margin-bottom:22px">${icon('bell')}<span>새 예약 변경 알림 <strong>${unreadChanges}건</strong>이 있습니다.</span><span>확인하기 ${icon('arrow')}</span></button>`:''}${ui.page==='cash-receipts'?cashReceiptPage():ui.page==='bookings'&&ui.role==='admin'?bookingPage():ui.page==='guide'?adminGuidePage():ui.page==='timeoff'?timeOffPage():ui.page==='dashboard'?dashboard():ui.page==='overview'?head('통합 현황표','시트처럼 전체 현황을 보고, 필요한 행의 상세 기록을 확인하세요.')+renderOverview({state,ui,escapeHTML:esc,icon,now:now()}):ui.page==='schedules'?schedulePage():ui.page==='reports'?reportPage():ui.page==='alerts'?alertPage():ui.page==='instructors'?instructorPage():ui.page==='scores'?head('만족도 · 리오더','고객 평가와 강사별 지표를 함께 확인합니다. 자유 의견은 공개하지 않습니다.')+renderScorePage({role:ui.role,profile:state.profile,scores:state.scores||[],roster:state.roster,schedules:[...state.schedules,...(state.archivedSchedules||[])],reviewPublish:ui.role==='admin'?reviewPublish:null,escapeHTML:esc})+renderWebReorders({state,escapeHTML:esc})+renderPerformance({role:ui.role,profile:state.profile,metrics:state.metrics||[],roster:state.roster,escapeHTML:esc}):settingsPage()}<footer class="content-footer"><span>작은 기록이 더 좋은 강습을 만듭니다.</span><span>모든 시간은 한국 시간(KST) 기준</span></footer></div></main><nav class="mobile-nav">${nav.filter(([id])=>['dashboard','schedules','alerts','timeoff'].includes(id)).map(([id,i,t])=>`<a href="#${id}" class="${ui.page===id?'active':''}">${icon(i)}<span>${t}</span></a>`).join('')}<button type="button" data-action="more">${icon('grid')}<span>전체 메뉴</span></button></nav></div>`;
  bind();
  const driveHost=$('#drive-settings-host');
  if(driveHost&&ui.role==='admin')driveSettingsView=mountDriveSettings(driveHost,{profile:state.profile,api:driveMediaAction,onConnectionOpen:url=>{location.assign(ownerAuthorizationUrl(url));},onSaved:()=>{mainDirty=false;}});
  const solapiHost=$('#solapi-settings-host');
  if(solapiHost&&ui.role==='admin')solapiSettingsView=mountSolapiSettings(solapiHost,{profile:state.profile,api:solapiAction,onSaved:()=>{mainDirty=false;},onDirty:value=>{mainDirty=value!==false;}});
}
function head(title,subtitle,actions='') {return `<div class="page-head"><div><div class="eyebrow">${ui.role==='admin'?'INSTRUCTOR OPERATIONS':'MY LESSON WORKSPACE'}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;}
function bookingLoadError(){return `<section class="panel"><div class="panel-body"><div class="warning-box">${icon('warning')}<span><strong>운영 기록을 불러오지 못했습니다.</strong><br>목록과 변경 권한을 다시 확인한 뒤 이용해 주세요.</span></div><button type="button" class="btn primary" data-action="refresh">${icon('refresh')}다시 불러오기</button></div></section>`;}
function bookingPage(){return head('예약 · 강사 배정','예약 접수와 담당 강사 배정을 관리합니다.')+`<section class="panel"><div class="panel-body"><div class="info-box">${icon('external')}<span>예약 접수와 강사 배정 메뉴로 이동합니다.</span></div><a class="btn primary" href="${RESERVATION_SITE_URL}">${icon('external')}예약 · 배정 관리</a></div></section>`;}
function timeOffPage(){return state.bookingUnavailable?head(ui.role==='admin'?'휴무 관리':'휴무 신청','강습 배정과 신청 내역을 확인하세요.')+bookingLoadError():renderTimeOff({state,ui,escapeHTML:esc,icon,now:now()});}
function stat(label,value,foot,ico,type='') {return `<div class="stat-card ${type}"><div class="stat-label">${label}<span class="stat-icon">${icon(ico)}</span></div><div class="stat-number">${value}</div><div class="stat-foot">${foot}</div></div>`;}
function dashboard() {
  const list=visible(), todays=list.filter(s=>kstDate(s.start)===today), warn=warnings().filter(isPending), due=list.filter(s=>!s.report&&new Date(s.end)<now()), reports=list.filter(s=>s.report);
  const headline=ui.role==='admin'?'오늘의 강습을 한눈에.':`${esc(ui.instructor)} 강사님, 안녕하세요.`;
  return `${head(headline,ui.role==='admin'?'현장 인증부터 보고서까지, 놓치는 순간 없이 관리하세요.':'오늘의 만남을 기록하고, 강습의 마지막까지 함께해 주세요.',`<span class="today-label">${icon('calendar')}${dateLabel(now(),true)}</span>${ui.role==='admin'?`<a class="btn primary" href="${RESERVATION_SITE_URL}">${icon('external')}예약 · 배정 관리</a>`:`<button class="btn primary" data-action="schedules">${icon('calendar')}내 일정 보기</button>`}`)}<div class="stats-grid">${stat('오늘의 강습',`${todays.length}<small>건</small>`,`${new Set(todays.map(s=>s.instructor)).size}명의 강사와 함께합니다`,'calendar')}${stat('보고서 등록',`${reports.length}<small>/ ${list.filter(s=>new Date(s.end)<now()).length}건</small>`,'전체 종료 일정 기준','report')}${stat('확인이 필요한 알림',`${warn.length}<small>건</small>`,warn.length?'강사 응답과 관리자 검토를 기다려요':'모든 알림을 확인했습니다','bell','accent')}${stat('보고서 미등록',`${due.length}<small>건</small>`,`48시간 초과 ${due.filter(s=>now()>reportDeadline(s)).length}건 · 기한 내 등록해 주세요`,'clock')}</div><div class="instructor-hero"><div class="hero-copy"><span class="pill">EVERY LESSON MATTERS</span><h2>좋은 강습은,<br>좋은 기록으로 완성됩니다.</h2><p>만남 인증 → 강습 → 헤어짐 인증 → 48시간 내 보고서 등록</p><button class="btn" data-action="schedules">${ui.role==='admin'?'오늘의 일정 확인하기':'사진 인증하러 가기'} ${icon('arrow')}</button></div>${mountainArt}</div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">오늘의 강습 일정 <span class="count-sub">${todays.length}</span></h2><p class="muted">${dateLabel(now(),true)} · 인증 진행 상태를 확인하세요</p></div><a href="#schedules" class="text-link">전체 보기 ${icon('arrow')}</a></div>${ui.role==='admin'?scheduleTable(todays):`<div class="card-grid">${todays.map(lessonCard).join('')||empty('오늘 등록된 강습이 없어요')}</div>`}</section><aside><section class="panel attention-panel"><div class="panel-head"><h2 class="panel-title">지금 확인해 주세요 <span class="tiny-dot"></span></h2></div><div class="attention-list">${warn.slice(0,3).map(w=>attention(w)).join('')||empty('확인할 알림이 없어요')}</div><a class="panel-bottom-link" href="#alerts">모든 알림 보기 ${icon('arrow')}</a></section><section class="panel guide-panel"><div class="panel-head"><h2 class="panel-title">강습 기록 가이드</h2>${icon('shield')}</div><div class="guide-metrics"><div>${icon('camera')}<strong>${state.settings.photoMinimum}<small>장 이상</small></strong><span>기본 사진</span></div><div>${icon('video')}<strong>${state.settings.videoMinimum}<small>개 이상</small></strong><span>동영상</span></div><div>${icon('clock')}<strong>48<small>시간 이내</small></strong><span>보고서 등록</span></div></div><p class="guide-note">연속 사진 2장 이상 촬영 금지<br>패찰과 스키복 상·하의가 보이게 촬영해 주세요.</p></section></aside></div>`;
}
function attention(w) {const s=find(w.scheduleId);return `<button class="attention-item" data-detail="${esc(s.id)}" data-tab="alerts"><span class="attention-icon ${w.severity}">${icon(w.category==='similarity'?'report':w.category==='report-overdue'?'clock':'warning')}</span><span class="attention-copy"><span class="attention-title">${esc(w.title)}</span><span class="attention-detail">${esc(s.instructor)} · ${esc(s.customer)}<br>${dateLabel(s.start)} ${time(s.start)}</span></span>${icon('arrow')}</button>`;}
function scheduleTable(list) {return list.length?`<div class="table-wrap"><table><thead><tr><th>시간 / 고객</th><th>담당 강사</th><th>장비 · 예약기록</th><th>기록 진행</th><th>상태</th><th></th></tr></thead><tbody>${[...list].sort((a,b)=>new Date(a.start)-new Date(b.start)).map(s=>`<tr class="${schedulePaymentNeedsAttention(s)?'schedule-payment-due':''}"><td><div class="time-cell">${time(s.start)} <span>— ${time(s.end)}</span></div><div class="customer-cell">${esc(s.customer)} <span class="muted">${esc(s.level||'스키 강습')}</span></div>${renderSchedulePayment(s,{compact:true,escapeHTML:esc})}</td><td><span class="person-cell">${avatar(s.instructor)}<span>${esc(s.instructor)}<small class="muted">담당 강사</small></span></span></td><td>${renderScheduleRental(s,{compact:true,escapeHTML:esc})}</td><td>${steps(s)}</td><td>${status(s)}</td><td><button class="icon-btn" data-detail="${esc(s.id)}" aria-label="${esc(s.customer)} 강습 상세">${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`:empty('이 날짜에 등록된 강습이 없어요','다른 날짜를 선택하거나 담당 관리자에게 일정을 확인해 주세요.');}
function schedulePage() {
  let list=visible().filter(s=>ui.date==='all'||kstDate(s.start)===ui.date).filter(s=>`${s.customer} ${s.instructor}`.includes(ui.query));
  if(ui.filter==='pending')list=list.filter(s=>!s.report); if(ui.filter==='complete')list=list.filter(s=>s.report); if(ui.filter==='alert')list=list.filter(s=>warnings().some(w=>w.scheduleId===s.id));
  return `${head(ui.role==='admin'?'강습 일정':'나의 강습 일정','고객별 일정에 만남·헤어짐 사진과 보고서를 차례로 등록하세요.',`<button class="btn secondary" data-action="overview">${icon('sheet')}통합 현황표</button>`+(ui.role==='admin'?`<button class="btn secondary" data-action="export">${icon('download')}내보내기</button><button class="btn primary" data-action="import">${icon('upload')}일정 가져오기</button>`:''))}<div class="panel"><div class="toolbar"><div class="date-nav"><button class="icon-btn" data-day="-1" aria-label="이전 날짜"><span style="transform:rotate(180deg);display:flex">${icon('arrow')}</span></button><input type="date" id="schedule-date" value="${ui.date==='all'?'':ui.date}" aria-label="강습 날짜"><button class="icon-btn" data-day="1" aria-label="다음 날짜">${icon('arrow')}</button><button class="btn ghost small" data-action="today">오늘</button><button class="btn ghost small" data-action="all-dates">전체 기간</button></div><label class="search-input">${icon('search')}<input id="schedule-search" placeholder="고객명, 강사명 검색" value="${esc(ui.query)}"></label></div><div class="list-heading"><div class="filter-tabs">${[['all','전체'],['pending','보고서 미등록'],['complete','등록 완료'],['alert','확인 필요']].map(([id,t])=>`<button class="${ui.filter===id?'active':''}" data-filter="${id}">${t}</button>`).join('')}</div><span class="muted">총 ${list.length}건</span></div>${ui.role==='admin'?scheduleTable(list):`${PHONE_PRIVACY_NOTICE}<div class="card-grid">${list.map(lessonCard).join('')||empty('등록된 강습이 없어요')}</div>`}</div>`;
}
// 고객 연락처 보호 고지(2026-11-27 사용자 지시): 번호는 서버가 강습 당일(종료 1시간 후까지)에만 제공.
const PHONE_PRIVACY_NOTICE=`<details class="panel" style="margin:0 0 14px;padding:12px 16px;background:#fff8ef;border:1px solid #f0dcc0;border-radius:12px;font-size:12.5px;color:#6b5b43;"><summary style="cursor:pointer;font-weight:700;color:#8a6a3b;">고객 연락처는 <u>강습 당일(종료 1시간 후까지)</u>에만 표시됩니다 · 개인 기기 저장/사적 연락/외부 영업 금지 <span style="font-weight:500;">— 전체 고지 보기</span></summary><div style="margin-top:9px;line-height:1.6;"><b>[공지] 고객 개인정보 무단 저장 및 사적 연락·영업 금지</b><br>수업·상담 목적으로 전달되는 고객 연락처는 자사의 핵심 영업 자산이자 법적으로 보호받는 개인정보이며, 해당 고객의 모든 개인정보는 자사가 관리합니다.<br>업무 외 개인 기기 저장, 사적 연락, 외부 영업(타 업체 유인, 개인 강습 제안 등) 활용은 「개인정보 보호법」 위반(5년 이하 징역 또는 5천만 원 이하 벌금), 「정보통신망법」 위반(3천만 원 이하 과태료) 및 업무상 배임(영업비밀 침해)에 해당하는 중대한 불법 행위입니다.<br>1. 업무상 전달받은 고객 연락처의 개인 기기 저장을 일절 금지하며, 기존 저장 내역은 즉시 삭제하시기 바랍니다.<br>2. 사적 연락·영업 행위 적발 시 선처 없이 계약 해지 및 민·형사상 책임(형사 고발과 자사 DB 침해에 대한 민사 손해배상 포함)을 물을 것임을 고지합니다.</div></details>`;
function lessonPhoneLive(s){try{return !!s.phone&&kstDate(s.start)===kstDate(now())&&Date.now()<=new Date(s.end).getTime()+3600000;}catch{return false;}}
function lessonCard(s) {return `<article class="lesson-card${schedulePaymentNeedsAttention(s)?' schedule-payment-due':''}"><div class="lesson-card-head"><span class="lesson-time">${time(s.start)} — ${time(s.end)}</span>${status(s)}</div><h2 class="lesson-customer">${esc(s.customer)} <small>고객님</small></h2><div class="lesson-meta">${dateLabel(s.start,true)} · ${esc(s.level||'스키 강습')}<br>${esc(s.location||'장소 미지정')}</div>${lessonPhoneLive(s)?`<a href="tel:${esc(String(s.phone).replace(/\D/g,''))}" class="btn secondary small" style="align-self:flex-start;margin-top:6px;">📞 고객 연락 ${esc(s.phone)}</a>`:''}${renderSchedulePayment(s,{escapeHTML:esc})}${renderScheduleRental(s,{escapeHTML:esc})}${steps(s)}<div class="lesson-footer"><span class="muted">보고서 기한 ${dateLabel(reportDeadline(s))} ${time(reportDeadline(s))}</span><button class="btn primary small" data-detail="${esc(s.id)}">${s.report?'기록 보기':!s.checkIn?'만남 인증':!s.checkOut?'헤어짐 인증':'보고서 등록'} ${icon('arrow')}</button></div></article>`;}
function reportPage() {
  const list=visible().filter(s=>ui.reportFilter==='registered'?s.report:ui.reportFilter==='pending'?!s.report&&new Date(s.end)<now():true);
  const reportOrder=s=>s.report?2:new Date(s.end)<now()?0:1;
  const ordered=[...list].sort((a,b)=>reportOrder(a)-reportOrder(b)||(reportOrder(a)===2?new Date(b.report.submittedAt||b.start)-new Date(a.report.submittedAt||a.start):reportDeadline(a)-reportDeadline(b)));
  return `${head('보고서 관리','카페 링크와 강습 내용을 한곳에 기록하고, 제출 기한과 유사도를 확인하세요.')}<div class="info-box">${icon('clock')}<span>강습 종료 후 <strong>48시간 이내</strong> 등록해 주세요. 미등록·기한 초과 시 패널티 검토 대상이며, 강사에게 확인 알림이 표시됩니다.</span></div><div class="list-heading"><div class="filter-tabs">${[['all','전체 일정'],['pending','미등록'],['registered','등록 완료']].map(([id,t])=>`<button class="${ui.reportFilter===id?'active':''}" data-report-filter="${id}">${t}</button>`).join('')}</div><span class="muted">${ui.reportFilter==='registered'?'최근 등록순':'미등록 기한순'} · ${list.length}건</span></div><div class="report-list">${ordered.map(s=>{const similar=warnings().filter(w=>w.scheduleId===s.id&&w.category==='similarity');return `<article class="panel report-card"><div class="report-card-head"><div class="person-cell">${avatar(s.instructor)}<div><strong>${esc(s.customer)} 고객님</strong><div class="muted">${esc(s.instructor)} 강사 · ${dateLabel(s.start)} ${time(s.start)} — ${time(s.end)}</div></div></div>${status(s)}</div>${s.report?`<p class="report-text">${esc(s.report.text)}</p><div class="report-meta"><span>${icon('camera')}사진 ${s.report.photoCount}장</span><span>${icon('video')}영상 ${s.report.videoCount}개</span><span>${icon('clock')}${dateLabel(s.report.submittedAt)} 등록</span>${similar.length?badge('보고서 유사도 확인','warning'):badge('유사도 경고 없음','success')}</div>`:`<div class="report-placeholder">${icon('report')}<span>아직 보고서가 등록되지 않았습니다.<br><small>등록 기한 ${dateLabel(reportDeadline(s))} ${time(reportDeadline(s))}</small></span></div>`}<div class="report-actions">${s.report?`<a class="btn ghost small" href="${esc(s.report.link)}" target="_blank" rel="noopener noreferrer">${icon('external')}카페 링크 열기</a>`:'<span class="muted">사진 수와 가이드라인은 강사 응답으로 확인합니다.</span>'}<button class="btn ${s.report?'secondary':'primary'} small" data-detail="${esc(s.id)}" data-tab="report">${s.report?'보고서 상세':'보고서 등록'} ${icon('arrow')}</button></div></article>`;}).join('')||empty('해당하는 보고서가 없어요')}</div>`;
}
function automationPanel(){
  const status=state.automation;const unread=unreadNotifications().length;
  const latest=status?.lastRunAt?`${dateLabel(status.lastRunAt)} ${time(status.lastRunAt)}`:'아직 실행 기록 없음';
  const service=status?status.enabled?`서버에서 ${status.intervalMinutes||5}분마다 점검`:'서버 자동 점검 일시 중지':'서버 자동 점검 상태 확인 중';
  const stateText=status&&status.enabled===false?'일시 중지':status?.status==='failed'?'최근 점검 실패':status?.status==='running'?'점검 중':status?.status==='succeeded'?'자동 점검 정상':'상태 확인 중';
  const pushLabel=pushState.enabled?'이 기기 알림 끄기':pushState.supported===false?'이 브라우저는 알림 미지원':'브라우저 알림 켜기';
  return `<section class="panel" id="automation-status" style="margin-bottom:20px"><div class="panel-head"><div><h2 class="panel-title">자동 점검 · 알림 ${badge(stateText,status?.status==='failed'?'warning':status?.status==='succeeded'?'success':'neutral')}</h2><p class="muted">${service} · 마지막 완료 ${latest}</p></div>${ui.role==='admin'?`<button class="btn secondary small" data-action="run-checks" ${checksRunning?'disabled':''}>${icon('refresh')}${checksRunning?'서버 점검 중…':'지금 점검'}</button>`:''}</div><div class="panel-body"><div class="toolbar" style="padding:0;gap:12px;flex-wrap:wrap"><span class="status-badge ${unread?'warning':'success'}">읽지 않은 자동 알림 ${unread}건</span>${ui.role==='instructor'?`<button class="btn ${pushState.enabled?'secondary':'primary'} small" data-action="${pushState.enabled?'disable-push':'enable-push'}" ${pushBusy||pushState.supported===false?'disabled':''}>${icon('bell')}${pushBusy?'알림 설정 중…':pushLabel}</button>`:''}</div><p class="field-help">${ui.role==='admin'?'기기 알림은 위 고객 일정 요청 영역에서 설정합니다. 고객 일정 요청과 강습 확인 알림을 함께 받습니다.':esc(pushState.message||'브라우저 알림을 켜면 지원되는 기기에서 웹을 닫은 뒤에도 새 확인 요청을 받을 수 있습니다. 동일한 내용은 반복 발송하지 않습니다.')}</p><p class="field-help">${ui.role==='admin'?'고객 일정 요청도 이 기기로 알려드립니다. 고객 알림톡 발송 상태는 운영 설정에서 확인하세요.':'알림 읽음과 강사의 사실 여부 응답은 별도로 기록됩니다.'}</p>${status?.status==='failed'?'<div class="warning-box">최근 서버 점검을 완료하지 못했습니다. 관리자는 지금 점검으로 다시 확인해 주세요.</div>':''}</div></section>`;
}
function guidelineEmptyState(filter,role){
  const pending=role==='admin'?'검토 대기':'응답 대기';
  const labels={pending:`${pending} 중인 가이드라인 알림이 없어요`,unread:'읽지 않은 가이드라인 알림이 없어요',answered:'강사가 응답한 가이드라인 알림이 없어요',reviewed:'관리자 검토를 완료한 가이드라인 알림이 없어요',all:'가이드라인 알림이 없어요'};
  return empty(labels[filter]||'이 조건에 맞는 알림이 없어요',filter==='all'?'새로운 가이드라인 확인 요청이 생기면 이곳에 표시됩니다.':'다른 상태의 기록은 전체 탭에서 확인할 수 있습니다.');
}
function alertPage() {
  const unread=new Set(unreadNotifications().map(n=>n.alert_id));
  const list=warnings().filter(w=>ui.alertFilter==='all'||ui.alertFilter==='pending'&&isPending(w)||ui.alertFilter==='unread'&&unread.has(w.id)||ui.alertFilter==='answered'&&!!activeResponse(w)||ui.alertFilter==='reviewed'&&isFinalReview(w));
  return `${head('확인 · 알림','예약 변경 안내를 확인하고, 가이드라인 경고에는 사실 여부와 사유를 남겨 주세요.')}${renderCashReceiptNotice({profile:state.profile,data:state.cashReceipts,error:state.cashReceiptsError})}${renderCustomerRequestNotifications({state,icon,pushState,pushBusy})}${renderChangeNotifications({state,ui,escapeHTML:esc,icon})}${automationPanel()}<div class="panel-head" style="padding-left:0;padding-right:0"><h2 class="panel-title">강습 가이드라인 확인</h2></div><div class="list-heading"><div class="filter-tabs">${[['pending',ui.role==='admin'?'검토 대기':'응답 대기'],['unread','읽지 않은 알림'],['answered','강사 응답 완료'],['reviewed','관리자 검토 완료'],['all','전체']].map(([id,t])=>`<button class="${ui.alertFilter===id?'active':''}" data-alert-filter="${id}">${t}</button>`).join('')}</div><span class="muted">${list.length}건</span></div>${list.map(w=>alertCard(w)).join('')||`<div class="panel">${guidelineEmptyState(ui.alertFilter,ui.role)}</div>`}`;
}
function alertCard(w,detail=false) {
  const s=find(w.scheduleId);if(!s)return'';const response=activeResponse(w),review=activeReview(w),recipient=recipientFor(w.id);
  return `<article class="alert-card ${w.severity}" data-alert-id="${esc(w.id)}"><div class="alert-top"><span class="attention-icon ${w.severity}">${icon(w.category==='similarity'?'report':'warning')}</span><div style="flex:1"><div class="alert-title">${esc(w.title)}</div><div class="muted">${esc(s.instructor)} · ${esc(s.customer)} · ${dateLabel(s.start)} ${time(s.start)}</div></div>${isFinalReview(w)?badge('검토 완료','success'):review?.result==='followup'?badge('추가 확인 요청','warning'):response?badge('강사 응답 완료','info'):badge('응답 대기','warning')}</div><p class="alert-detail">${esc(w.detail)}</p><p class="field-help">${w.source==='server'?`서버 자동 점검 · ${dateLabel(w.lastDetectedAt)} ${time(w.lastDetectedAt)}`:'현재 기록으로 즉시 확인 · 서버 점검 시 알림으로 저장됩니다.'}${recipient?.read_at?' · 알림 읽음':''}</p>${w.category==='similarity'?'<p class="field-help">문자 패턴 비교 결과입니다. 실제 학습 내용이 같은지 관리자가 검토해 주세요.</p>':''}${w.relatedScheduleId&&(ui.role==='admin'||find(w.relatedScheduleId)?.instructorUserIds?.includes(state.profile.user_id))?`<button class="btn ghost small" data-detail="${esc(w.relatedScheduleId)}" data-tab="report">비교 보고서 열기 ${icon('external')}</button>`:''}${response?`<div class="alert-response"><strong>강사 응답 · ${response.answer==='confirm'?'맞습니다':'이의 있습니다'}</strong>${response.note?`<p>${esc(response.note)}</p>`:''}</div>`:''}${review?`<div class="alert-response"><strong>관리자 검토 · ${review.result==='confirmed'?'미준수 확인':review.result==='dismissed'?'소명 인정':'추가 확인 필요'}</strong>${review.note?`<p>${esc(review.note)}</p>`:''}</div>`:''}<div class="alert-actions">${recipient&&!recipient.read_at?`<button class="btn ghost small" data-alert-read="${esc(w.id)}">알림 읽음 처리</button>`:''}${ui.role==='instructor'?`<button class="btn secondary small" data-respond="${esc(w.id)}">${response?'응답 수정':'사실 여부 확인하기'}</button>`:!isFinalReview(w)?`<button class="btn secondary small" data-review="${esc(w.id)}">관리자 검토</button>`:''}${!detail?`<button class="btn ghost small" data-detail="${esc(s.id)}" data-tab="alerts">강습 기록 ${icon('arrow')}</button>`:''}</div></article>`;
}
function settingsPage() {const s=state.settings;return `${head('운영 설정','강습 기준을 조정하고, 일정과 고객 안내 연동을 준비하세요.')}<div id="solapi-settings-host"></div><div id="drive-settings-host"></div><div class="settings-grid"><form id="policy-form" class="panel form-section"><div class="panel-head"><div><h2 class="panel-title">가이드라인 · 시간 기준</h2><p class="muted">설정 변경 시 현재 일정의 경고를 다시 계산합니다.</p></div>${icon('shield')}</div><div class="panel-body"><div class="form-grid">${[['lateMinutes','시작·업로드 지연 기준 (분)',s.lateMinutes,1,120],['minDuration','최소 강습시간 (분)',s.minDuration,1,1440],['photoMinimum','기본 사진 최소 수 (장)',s.photoMinimum,1,100],['videoMinimum','동영상 최소 수 (개)',s.videoMinimum,1,100]].map(([n,l,v,min,max])=>`<label class="field"><span class="field-label">${l}</span><input name="${n}" type="number" required min="${min}" max="${max}" value="${v}"></label>`).join('')}</div><label class="field"><span class="field-label">시간 경고 적용 방식</span><select name="timeRuleMode"><option value="either" ${s.timeRuleMode==='either'?'selected':''}>지연 / 강습시간 미달 각각 경고</option><option value="both" ${s.timeRuleMode==='both'?'selected':''}>지연과 강습시간 미달이 함께 발생할 때 경고</option></select></label><label class="field"><span class="field-label">보고서 유사도 경고 기준 (%)</span><input name="similarityThreshold" type="number" min="40" max="100" value="${Math.round(s.similarityThreshold*100)}" required><span class="field-help">다른 고객·다른 시간대의 보고서에 문자 패턴 비교를 적용합니다.</span></label><div class="info-box">${icon('clock')}<span>보고서 기한: 예정 강습 종료 후 48시간<br>연속 사진: 2장 이상 촬영 시 확인 경고</span></div><button class="btn primary" type="submit">기준 저장하기</button></div></form><div><section class="panel form-section"><div class="panel-head"><h2 class="panel-title">연동 관리</h2>${icon('link')}</div><div class="panel-body">${renderSheetsSync(state.sheetsSync,{error:state.sheetsSyncError})}<p class="field-help">기존 일정은 CSV로 가져올 수 있습니다. 일정 ID를 유지하면 사진·보고서를 보존하며 일정을 업데이트합니다.</p><button class="btn secondary" data-action="import">${icon('upload')}CSV로 일정 가져오기</button><div class="divider"></div><div class="integration-card"><span class="integration-logo">${icon('mail')}</span><div class="integration-copy"><strong>고객 안내</strong><p>상단 솔라피 · 카카오 알림톡에서 연결 상태 확인</p></div></div><p class="field-help">보고서 등록 후 자료·만족도 링크를 안내합니다. 알림톡은 상단 연동 설정과 템플릿 승인 상태에 따라 발송하며, 아래 초안은 직접 전달할 때 사용합니다.</p></div></section><form class="panel form-section" id="sms-form"><div class="panel-head"><h2 class="panel-title">고객 안내문</h2></div><div class="panel-body"><label class="field"><span class="field-label">등록 완료 안내 템플릿</span><textarea name="smsTemplate" rows="4" required>${esc(s.smsTemplate)}</textarea><span class="field-help">사용 가능: {고객명}, {강사명}, {링크}, {만족도링크}</span></label><button class="btn secondary small" type="submit">안내문 저장</button></div></form></div></div><section class="panel"><div class="panel-head"><h2 class="panel-title">문자 안내 초안 <span class="count-sub">${state.outbox.length}</span></h2>${badge('실제 발송 안 됨','warning')}</div>${state.outbox.length?`<div class="outbox-list">${state.outbox.map(o=>`<div class="outbox-row"><div><strong>${esc(o.customer)}</strong><span class="muted"> · ${esc(o.phone)}</span><p>${esc(o.message)}</p><small class="muted">${dateLabel(o.createdAt)} ${time(o.createdAt)} 생성</small></div>${badge('연동 후 발송 가능')}</div>`).join('')}</div>`:empty('생성된 안내 초안이 없어요','보고서를 등록하면 고객별 안내문이 이곳에 표시됩니다.')}</section>`;}

// 후기 사이트 공개(2026-11-20 사용자 확정): 만족도 화면의 '최근 고객 평가' 표 안에서
// 설문 칭찬 글을 캐치/라이즌 후기 위젯으로 게시·내림. 데이터는 slope-reviews Edge.
let reviewPublish={loaded:false,loading:false,byScoreId:{},error:'',notice:''};
async function loadReviewPublish(){
  if(reviewPublish.loading)return;
  reviewPublish={...reviewPublish,loading:true,error:''};
  try{
    const data=await reviewsAction('queue',{});
    const byScoreId={};
    for(const item of data.queue||[])byScoreId[item.scoreId]={praise:item.praise,publishedBrands:item.publishedBrands||[]};
    reviewPublish={...reviewPublish,loaded:true,byScoreId};
  }catch(error){reviewPublish={...reviewPublish,loaded:true,error:String(error?.message||error)};}
  finally{reviewPublish.loading=false;if(ui.page==='scores'&&ui.role==='admin')render();}
}
function bindReviewPublish(){
  if(!reviewPublish.loaded&&!reviewPublish.loading)void loadReviewPublish();
  const act=async(button,work,notice)=>{
    button.disabled=true;reviewPublish.notice='';reviewPublish.error='';
    try{await work();reviewPublish.notice=notice;await loadReviewPublish();}
    catch(error){reviewPublish.error=String(error?.message||error);if(ui.page==='scores')render();}
  };
  app.querySelectorAll('[data-review-publish]').forEach(button=>button.onclick=()=>{
    const [scoreId,brand]=button.dataset.reviewPublish.split(':');
    void act(button,()=>reviewsAction('publish',{publishScoreId:scoreId,brand}),'사이트에 공개했습니다. 위젯에는 최대 5분 안에 반영됩니다.');
  });
  app.querySelectorAll('[data-review-unpublish]').forEach(button=>button.onclick=()=>{
    if(!confirm('이 후기를 사이트에서 내릴까요?'))return;
    const [scoreId,brand]=button.dataset.reviewUnpublish.split(':');
    void act(button,()=>reviewsAction('remove',{scoreId,brand}),'사이트에서 내렸습니다.');
  });
  app.querySelectorAll('[data-praise-view]').forEach(button=>button.onclick=()=>{
    const scoreId=button.dataset.praiseView;
    const info=reviewPublish.byScoreId?.[scoreId];if(!info?.praise)return;
    const row=(state.scores||[]).find(item=>item.id===scoreId)||{};
    const names=new Map((state.roster||[]).map(person=>[person.user_id,person.display_name]));
    let node=document.querySelector('#review-praise-dialog');
    if(!node){node=document.createElement('dialog');node.id='review-praise-dialog';node.className='score-praise-dialog';document.body.append(node);}
    node.textContent='';
    const box=document.createElement('div');box.className='score-praise-dialog-box';
    const title=document.createElement('h3');title.textContent=`${names.get(row.instructor_user_id)||'강사'} · ${'★'.repeat(Math.min(5,Math.max(1,Number(row.overall)||5)))}`;
    const meta=document.createElement('p');meta.className='score-praise-dialog-meta';meta.textContent=`응답일 ${String(row.submitted_at||'').slice(0,10)}`;
    const body=document.createElement('p');body.className='score-praise-dialog-body';body.textContent=info.praise;
    const close=document.createElement('button');close.type='button';close.className='btn-ghost';close.textContent='닫기';close.onclick=()=>node.close();
    box.append(title,meta,body,close);node.append(box);node.showModal();
  });
  app.querySelectorAll('[data-review-jsonld]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try{
      const brand=button.dataset.reviewJsonld;
      const data=await reviewsAction('list',{brand});
      if(!data.summary?.count)throw new Error('게시된 후기가 없습니다. 먼저 공개해 주세요.');
      const payload={'@context':'https://schema.org','@type':'Service',name:`${data.brandName} 스키·보드 강습`,
        provider:{'@type':'LocalBusiness',name:data.brandName},
        aggregateRating:{'@type':'AggregateRating',ratingValue:data.summary.average,reviewCount:data.summary.count,bestRating:5,worstRating:1},
        review:data.reviews.slice(0,10).map(review=>({'@type':'Review',author:{'@type':'Person',name:'수강생'},datePublished:review.reviewDate,reviewBody:review.body.slice(0,500),name:`${review.instructorName} 강사 강습 후기`,reviewRating:{'@type':'Rating',ratingValue:review.rating,bestRating:5,worstRating:1}}))};
      await navigator.clipboard.writeText('<script type="application/ld+json">'+JSON.stringify(payload,null,1).replace(/</g,'\\u003c')+'<'+'/script>');
      toast('JSON-LD를 복사했습니다. 아임웹 [환경설정→헤더 코드]에 붙여넣어 주세요.');
    }catch(error){toast(String(error?.message||error));}
    finally{button.disabled=false;}
  });
}
function bind() {
  bindCashReceipts();
  if(ui.page==='guide')bindAdminGuide();
  if(ui.page==='scores'&&ui.role==='admin')bindReviewPublish();
  app.querySelectorAll('a[href^="#"]').forEach(a=>a.onclick=e=>{e.preventDefault();const page=a.getAttribute('href').slice(1);if(pageTitles[page]&&(ui.role==='admin'||!['settings','instructors','bookings','changes','calls','payments','guide','cash-receipts'].includes(page)))go(page);});
  app.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{ui.filter=b.dataset.filter;render();});
  app.querySelectorAll('[data-alert-filter]').forEach(b=>b.onclick=()=>{ui.alertFilter=b.dataset.alertFilter;render();});
  app.querySelectorAll('[data-report-filter]').forEach(b=>b.onclick=()=>{ui.reportFilter=b.dataset.reportFilter;render();});
  app.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{ui.date=kstDate(new Date(new Date(`${ui.date==='all'?today:ui.date}T12:00:00+09:00`).getTime()+Number(b.dataset.day)*86400000));render();});
  $('#schedule-date')?.addEventListener('change',e=>{if(e.target.value){ui.date=e.target.value;render();}});
  $('#schedule-search')?.addEventListener('input',e=>{const pos=e.target.selectionStart;ui.query=e.target.value;render();const el=$('#schedule-search');el?.focus();el?.setSelectionRange(pos,pos);});
  $('#policy-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const settings={...state.settings};for(const k of ['lateMinutes','minDuration','photoMinimum','videoMinimum'])settings[k]=Number(f.get(k));settings.timeRuleMode=f.get('timeRuleMode');settings.similarityThreshold=Number(f.get('similarityThreshold'))/100;await performSave(e.target,async()=>{await saveRemoteSettings(settings);await refreshWorkspace();toast('운영 기준을 저장했습니다.');});});
  $('#sms-form')?.addEventListener('submit',async e=>{e.preventDefault();const settings={...state.settings,smsTemplate:new FormData(e.target).get('smsTemplate')};await performSave(e.target,async()=>{await saveRemoteSettings(settings);await refreshWorkspace();toast('고객 안내문을 저장했습니다.');});});
  app.querySelectorAll('[data-member-toggle]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await setMemberStatus(b.dataset.memberToggle,{active:b.dataset.active==='true'});await refreshWorkspace();toast('계정 상태를 변경했습니다.');}catch(error){toast(error.message);b.disabled=false;}});
  app.querySelectorAll('[data-member-reset]').forEach(b=>b.onclick=()=>resetAccount(b.dataset.memberReset));
  app.querySelectorAll('[data-member-invite]').forEach(b=>b.onclick=()=>createInviteLink(b.dataset.memberInvite));
  app.querySelectorAll('[data-member-edit]').forEach(b=>b.onclick=()=>editInstructorName(b.dataset.memberEdit));
  app.querySelectorAll('[data-member-remove]').forEach(b=>b.onclick=()=>removeInstructorFromDirectory(b.dataset.memberRemove));
  if(ui.page==='alerts')bindChangeNotifications(app,{state,ui,onChange:()=>render(),onRead:readReservationChangeNotification,onOpenLesson:id=>{if(mayLeaveEdits({dialog:true,uploads:true}))openLesson(id);},onError:toast});
  if(ui.page==='overview')bindOverview(app,{state,ui,onOpenLesson:id=>{if(mayLeaveEdits({dialog:true,uploads:true}))openLesson(id);},onChange:()=>render()});
  if(ui.page==='timeoff')bindTimeOff(app,{state,ui,onBeforeChange:()=>ui.role!=='admin'||mayLeaveEdits({main:true}),onChange:()=>{render();mainDirty=ui.role==='instructor'&&!!(ui.timeOff?.note||ui.timeOff?.date);},onOpenLesson:id=>{if(mayLeaveEdits({dialog:true,uploads:true}))openLesson(id);},
    onRequest:async value=>{await requestTimeOff(value);mainDirty=false;await refreshWorkspace();toast('휴무 신청을 접수했습니다.');},
    onReview:async value=>{await reviewTimeOff(value);mainDirty=false;await refreshWorkspace();toast(value.status==='approved'?'휴무를 승인했습니다.':'휴무 신청을 반려했습니다.');},
    onCancel:async id=>{await cancelTimeOff(id);mainDirty=false;await refreshWorkspace();toast('휴무 신청을 취소했습니다.');},
  });
  bindCommon(app);
}
function hasIncompleteUploads(){return [...driveUploads.values()].some(entry=>{const queue=entry.manager.snapshot();return queue.running||queue.items?.some(item=>item.status!=='completed');});}
function mayLeaveEdits({main=false,dialog=false,uploads=false,leavingPage=false}={}){
  const inDialog=dialog&&modal.open;
  if(main&&app.querySelector('form[data-saving], [data-timeoff-saving]')||inDialog&&modal.querySelector('form[data-saving], [data-timeoff-saving]')){
    toast('저장 중입니다. 완료된 뒤 이동해 주세요.');return false;
  }
  const dirty=main&&mainDirty||inDialog&&modalDirty,pending=uploads&&hasIncompleteUploads();
  if(dirty||pending){
    const message=[pending?'사진·영상 업로드가 아직 완료되지 않았습니다.':'',dirty?'저장하지 않은 입력 내용이 있습니다. 이동하면 입력 내용이 사라집니다.':'',pending?(leavingPage?'브라우저를 벗어나면 업로드가 중단될 수 있습니다.':'이 웹 안에서는 업로드가 계속됩니다. 다른 앱으로 전환하거나 브라우저를 닫으면 중단될 수 있습니다.'):'',pending?'이동하시겠습니까?':'계속 이동할까요?'].filter(Boolean).join('\n');
    if(!window.confirm(message))return false;
  }
  if(main)mainDirty=false;if(inDialog)modalDirty=false;
  return true;
}
// New tabs and phone/Drive app handoffs do not fire beforeunload on this page.
function guardUploadLink(event){
  if(event.defaultPrevented||!hasIncompleteUploads()||event.type==='auxclick'&&event.button!==1)return;
  const link=event.target.closest?.('a[href]');if(!link||link.hasAttribute('download'))return;
  let destination;try{destination=new URL(link.href,location.href);}catch{return;}
  if(!['http:','https:','tel:','mailto:'].includes(destination.protocol))return;
  const newContext=link.target&&link.target!=='_self'||event.ctrlKey||event.metaKey||event.shiftKey||event.button===1;
  const appHandoff=['tel:','mailto:'].includes(destination.protocol);
  if((newContext||appHandoff)&&!mayLeaveEdits({uploads:true,leavingPage:true})){event.preventDefault();event.stopImmediatePropagation?.();}
}
function closeDialog(){if(!mayLeaveEdits({dialog:true,uploads:true}))return false;modal.close();return true;}
function go(page) {
  if(!state.profile||ui.role!=='admin'&&['settings','instructors','bookings','changes','calls','payments','guide','cash-receipts'].includes(page))return false;
  if(page===ui.page)return true;
  const booking=['bookings','changes','calls','payments'].includes(page);
  if(!mayLeaveEdits({main:true,dialog:true,uploads:true,leavingPage:booking}))return false;
  if(booking){routeToBooking(page==='bookings'?'reservations':page);return true;}
  if(modal.open)modal.close();
  if(ui.page==='guide'&&page!=='guide')clearAdminGuide();
  ui.page=page;ui.filter='all';if(location.hash!=='#'+page)history.pushState(null,'','#'+page);render();window.scrollTo(0,0);return true;
}
function bindCommon(root) {
  root.querySelectorAll('[data-alert-read]').forEach(b=>b.onclick=()=>readAlert(b.dataset.alertRead,b));
  root.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{if(mayLeaveEdits({dialog:true,uploads:true}))openLesson(b.dataset.detail,b.dataset.tab||'proof');});
  root.querySelectorAll('[data-respond]').forEach(b=>b.onclick=()=>{if(mayLeaveEdits({dialog:true,uploads:true}))responseDialog(b.dataset.respond,false);});
  root.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>{if(mayLeaveEdits({dialog:true,uploads:true}))responseDialog(b.dataset.review,true);});
  root.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.action;if(['schedules','alerts','overview','timeoff'].includes(a))go(a);else if(a==='more')navigationDialog();else if(a==='import')importDialog();else if(a==='today'){ui.date=today;render();}else if(a==='all-dates'){ui.date='all';render();}else if(a==='export')exportCSV();else if(a==='refresh')syncWorkspace({explicit:true});else if(a==='refresh-detail')syncWorkspace({explicit:true,detail:true});else if(a==='close')closeDialog();else if(a==='logout')logout();else if(a==='account')changePassword();else if(a==='add-instructor')createAccountDialog();else if(a==='run-checks')runServerChecks();else if(a==='enable-push')changePush(true);else if(a==='disable-push')changePush(false);});
}
function showDialog(title,content,wide=false) {
  cleanupDriveMedia();
  for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();
  modalDirty=false;
  modal.setAttribute('aria-labelledby','workspace-modal-title');
  modal.innerHTML=`<div class="modal-shell ${wide?'modal-wide':''}"><div class="modal-head"><h2 id="workspace-modal-title">${title}</h2><button class="icon-btn" data-action="close" aria-label="닫기">${icon('close')}</button></div><div class="modal-body">${content}</div></div>`;
  if(!modal.open)modal.showModal(); bindCommon(modal);
}
function groupedStaffNavigation({mobile=false,pending=0}={}){
  const item=([id,symbol,label])=>{
    const current=ui.page===id,content=`${icon(symbol)}<span>${esc(label)}</span>${id==='alerts'&&pending?`<span class="count">${pending}</span>`:''}`;
    if(id==='friend-matches')return `<a class="nav-item" href="/friend-matches/">${content}</a>`;
    return mobile?`<button type="button" class="nav-item ${current?'active':''}" data-nav-page="${id}" ${current?'aria-current="page"':''}>${content}</button>`:`<a href="#${id}" class="nav-item ${current?'active':''}" ${current?'aria-current="page"':''}>${content}</a>`;
  };
  const home=staffMenu(ui.role).find(([id])=>id==='dashboard');
  return (home?item(home):'')+staffMenuGroups(ui.role,ui.page).map(group=>`<details class="staff-nav-group ${group.active?'has-current':''}" data-nav-group="${group.id}" ${group.active?'open':''}><summary>${icon(group.icon)}<span>${esc(group.label)}</span>${group.items.some(([id])=>id==='alerts')&&pending?`<span class="count">${pending}</span>`:''}<span class="nav-group-chevron" aria-hidden="true">›</span></summary><div class="staff-nav-children">${group.items.map(item).join('')}</div></details>`).join('');
}
function navigationDialog(){
  if(!['admin','instructor'].includes(ui.role))return;
  if(modal.open&&!mayLeaveEdits({dialog:true,uploads:true}))return;
  showDialog('전체 메뉴',`<nav class="staff-navigation staff-navigation-mobile" aria-label="전체 업무 메뉴">${groupedStaffNavigation({mobile:true})}</nav>`);
  modal.querySelectorAll('[data-nav-page]').forEach(button=>button.onclick=()=>{const page=button.dataset.navPage;if(go(page)&&modal.open)modal.close();});
}
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
modal.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
function openLesson(id,tab='proof') {
  const s=find(id);if(!s||ui.role==='instructor'&&!s.instructorUserIds?.includes(state.profile.user_id)){toast('다른 강사의 강습은 강사 화면에서 열 수 없습니다.');return;}
  activeLessonId=id;ui.detailTab=tab;
  const w=warnings().filter(w=>w.scheduleId===id);
  showDialog(`${esc(s.customer)} 고객님의 강습`, `<div class="detail-sync-toolbar"><span class="detail-sync-status">${syncLabel()}</span><button class="btn secondary small" data-action="refresh-detail" type="button">${icon('refresh')}최신 기록 새로고침</button></div><div id="detail-sync-notice" class="sync-notice" role="status" hidden></div><div class="detail-summary"><div><span class="eyebrow">${esc(s.id)}</span><h3>${dateLabel(s.start,true)} · ${time(s.start)} — ${time(s.end)}</h3><p>${esc(s.instructor)} 강사 · ${esc(s.level||'스키 강습')} · ${esc(s.location||'장소 미지정')}</p></div>${status(s)}</div>${renderSchedulePayment(s,{escapeHTML:esc})}${renderScheduleRental(s,{escapeHTML:esc})}${ui.role==='admin'?assignmentControl(s):''}<div class="tabs">${[['proof','현장 사진 인증'],['media','사진·영상'],['report','강습 보고서'],['alerts',`확인 알림 ${w.length}`]].map(([id,t])=>`<button class="tab ${tab===id?'active':''}" data-detail-tab="${id}">${t}</button>`).join('')}</div>${tab==='proof'?proofContent(s):tab==='media'?'<div id="drive-media-host"></div>':tab==='report'?reportContent(s):w.map(w=>alertCard(w,true)).join('')||empty('이 강습의 확인 알림이 없어요')}`,true);
  modal.querySelectorAll('[data-detail-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.detailTab===ui.detailTab||!mayLeaveEdits({dialog:true,uploads:true}))return;openLesson(s.id,b.dataset.detailTab);});
  modal.querySelectorAll('[data-capture]').forEach(b=>b.onclick=()=>captureDialog(s.id,b.dataset.capture));
  $('#report-form',modal)?.addEventListener('submit',e=>saveReport(e,s.id));
  if(tab==='proof')loadPhotos(s);
  if(tab==='media')mountLessonMedia(s);
  $('#copy-survey',modal)?.addEventListener('click',()=>shareSurvey(s.id));
  $('#retry-survey',modal)?.addEventListener('click',e=>retryReportSurvey(s.id,e.currentTarget));
}
function proofContent(s) {
  const minutes=s.checkIn&&s.checkOut?Math.round((new Date(s.checkOut.eventAt)-new Date(s.checkIn.eventAt))/60000):null;
  return `<div class="info-box">${icon('camera')}<span>만났을 때와 헤어질 때, <strong>패찰과 스키복 상·하의 색깔</strong>이 모두 보이게 촬영해 주세요.</span></div><div class="photo-grid">${[['checkIn','만남 인증','강습생을 만나면 바로 촬영'],['checkOut','헤어짐 인증','강습 종료 후 헤어지기 전에 촬영']].map(([key,title,sub],i)=>{const p=s[key];return `<section class="photo-slot"><div class="section-title"><span class="step-number">0${i+1}</span><div><strong>${title}</strong><p class="muted">${sub}</p></div>${p?badge('등록 완료','success'):badge('미등록')}</div><div class="photo-preview" id="photo-${key}">${p?.photoId==='sample'?`<div class="sample-photo">${icon('camera')}<span>예시 인증 기록</span><small>체험용 일정의 샘플 데이터입니다.</small></div>`:p?`<span class="muted">사진 불러오는 중…</span>`:`${icon('camera')}<span>패찰 · 상의 · 하의가 보이는 사진</span>`}</div>${p?`<div class="photo-caption"><span>${title==='만남 인증'?'만난':'헤어진'} 시각 <strong>${dateLabel(p.eventAt)} ${time(p.eventAt)}</strong></span><span>업로드 시각 <strong>${dateLabel(p.uploadedAt)} ${time(p.uploadedAt)}</strong></span></div>`:''}<button class="btn ${p?'secondary':'primary'}" data-capture="${key}" ${key==='checkOut'&&!s.checkIn?'disabled':''}>${icon('camera')}${p?'인증 정보 다시 등록':title+'하기'}</button></section>`;}).join('')}</div><div class="kpi-strip proof-kpis"><div class="kpi"><strong>${minutes===null?'—':minutes}<small> 분</small></strong><span>만남부터 헤어짐까지</span></div><div class="kpi"><strong>${state.settings.minDuration}<small> 분 이상</small></strong><span>최소 강습시간 기준</span></div><div class="kpi"><strong>${state.settings.lateMinutes}<small> 분</small></strong><span>지연 확인 기준</span></div></div><p class="field-help">만남·헤어짐 시각은 강사가 입력하고, 업로드 시각은 서버에서 자동 기록합니다. 인증 사진은 담당 강사와 관리자만 확인할 수 있습니다.</p>`;
}
function canManageSurveyLinks(){return state.profile?.role==='admin'&&ui.role==='admin';}
function reportContent(s) {
  const retry=canManageSurveyLinks()&&s.report&&!state.surveyLinks?.[s.id]?`<div class="warning-box" data-survey-retry role="status"><span>보고서는 저장되어 있습니다. 만족도 조사 링크를 확인하거나 다시 연결해 주세요.<br><button class="btn secondary small" type="button" id="retry-survey">${icon('refresh')}만족도 링크 다시 연결</button></span></div>`:'';
  return retry+reportFormContent(s);
}
function reportFormContent(s) {
  const r=s.report;return `<div class="info-box">${icon('clock')}<span>등록 기한 <strong>${dateLabel(reportDeadline(s),true)} ${time(reportDeadline(s))}</strong> · 강습 종료 후 48시간 이내 미등록 시 패널티 검토 대상입니다.</span></div>${canManageSurveyLinks()?`<div class="survey-share-row"><span>고객에게 강습 자료와 만족도 조사 링크를 함께 안내하세요.</span><button class="btn secondary small" type="button" id="copy-survey">${icon('link')}만족도 링크 복사</button></div>`:''}<form id="report-form"><label class="field"><span class="field-label">사진·영상·보고서가 게시된 카페 링크 <b>*</b></span><input name="link" type="url" required placeholder="https://cafe.naver.com/…" value="${esc(r?.link||'')}"><span class="field-help">고객에게 안내할 게시물 주소를 입력해 주세요.</span></label><label class="field"><span class="field-label">강습 보고서 내용 <b>*</b></span><textarea name="text" rows="7" required minlength="30" maxlength="15000" placeholder="카페에 작성한 강습 보고서를 복사해서 붙여넣어 주세요. 고객의 학습 내용과 개선점을 구체적으로 작성해 주세요.">${esc(r?.text||'')}</textarea><span class="field-help">30자 이상 · 다른 고객·다른 시간대의 보고서와 문자 패턴을 비교합니다.</span></label><div class="form-grid"><label class="field"><span class="field-label">기본 사진 수 (장) <b>*</b></span><input name="photoCount" type="number" min="0" max="999" required placeholder="${state.settings.photoMinimum}장 이상" value="${r?.photoCount??''}"></label><label class="field"><span class="field-label">동영상 수 (개) <b>*</b></span><input name="videoCount" type="number" min="0" max="999" required placeholder="${state.settings.videoMinimum}개 이상" value="${r?.videoCount??''}"></label><label class="field"><span class="field-label">연속 사진 2장 이상 촬영했나요? <b>*</b></span><select name="consecutive" required><option value="">선택해 주세요</option><option value="false" ${r?.consecutive===false?'selected':''}>아니요 · 연속 촬영 없음</option><option value="true" ${r?.consecutive===true?'selected':''}>네 · 연속 촬영 있음</option></select></label><label class="field"><span class="field-label">전체 가이드라인을 준수했나요? <b>*</b></span><select name="guideline" required><option value="">선택해 주세요</option><option value="true" ${r?.guideline===true?'selected':''}>네 · 준수했습니다</option><option value="false" ${r?.guideline===false?'selected':''}>아니요 · 확인이 필요합니다</option></select></label></div><div class="warning-box">${icon('shield')}<span>사진·영상 탭에서 발급한 공유 링크를 카페 글에 넣고, 그 게시물 주소를 등록해 주세요. 촬영 수·연속 촬영 여부는 직접 응답합니다.<br><strong>강습 가이드라인 미준수 시 용역비용에 반영됩니다.</strong></span></div><label class="check-field fee-notice-check"><input type="checkbox" name="feeNoticeAck" required ${r?.feeNoticeAck?'checked':''}> 강습 가이드라인 미준수 시 용역비용에 반영됨을 확인했습니다.</label><div class="modal-footer"><span class="muted">등록 시 고객 안내문 초안이 생성됩니다. 알림톡은 운영 설정에 따릅니다.</span><button class="btn primary" type="submit">${icon('check')}${r?'보고서 수정 저장':'보고서 등록하기'}</button></div></form>`;
}
async function saveReport(e,id) {
  e.preventDefault();const f=new FormData(e.target);const form=e.target;
  const report={link:f.get('link'),text:String(f.get('text')).trim(),photoCount:Number(f.get('photoCount')),videoCount:Number(f.get('videoCount')),consecutive:f.get('consecutive')==='true',guideline:f.get('guideline')==='true',feeNoticeAck:f.get('feeNoticeAck')==='on'};
  await performSave(form,async()=>{await saveRemoteReport(id,report);let surveyReady=true;if(canManageSurveyLinks()){try{await surveyAction('create-link',{scheduleId:id});}catch{surveyReady=false;}}await refreshWorkspace();openLesson(id,'report');toast(surveyReady||!canManageSurveyLinks()?'보고서를 서버에 저장했습니다.':'보고서는 저장했습니다. 만족도 링크 연결에 실패했습니다. 보고서 상단에서 다시 연결해 주세요.');});
}
async function retryReportSurvey(scheduleId,button){
  const lesson=find(scheduleId),userId=state.profile?.user_id;
  if(!canManageSurveyLinks()||!lesson?.report||!userId){toast('관리자만 고객 설문 안내를 관리할 수 있습니다.');return;}
  if(button.disabled)return;button.disabled=true;
  try{
    const data=await surveyAction('create-link',{scheduleId});
    if(state.profile?.user_id!==userId||!canManageSurveyLinks())return;
    if(!data?.surveyUrl)throw new Error('만족도 링크를 확인하지 못했습니다. 다시 시도해 주세요.');
    state.surveyLinks={...state.surveyLinks,[scheduleId]:data.surveyUrl};
    const notice=button.closest('[data-survey-retry]');if(notice)notice.hidden=true;
    toast('만족도 조사 링크를 연결했습니다.');
  }catch(error){if(state.profile?.user_id===userId&&canManageSurveyLinks())toast(error.message||'만족도 링크 연결에 실패했습니다. 다시 시도해 주세요.');}
  finally{button.disabled=false;}
}
const objectURLs=new Set();
async function loadPhotos(s) {await Promise.all(['checkIn','checkOut'].map(key=>loadProofPhoto(s,key)));}
async function loadProofPhoto(s,key) {
  const p=s[key],el=$(`#photo-${key}`,modal);if(!p||p.photoId==='sample'||!el)return;
  const current=()=>modal.open&&activeLessonId===s.id&&$(`#photo-${key}`,modal)===el&&find(s.id)?.[key]?.photoId===p.photoId;
  el.innerHTML='<span class="muted">사진 불러오는 중…</span>';
  try{
    const blob=await getRemotePhoto(p.photoId);if(!current())return;
    if(!blob)throw new Error('PHOTO_UNAVAILABLE');
    const url=URL.createObjectURL(blob);objectURLs.add(url);
    el.innerHTML=`<img src="${url}" alt="${key==='checkIn'?'만남':'헤어짐'} 패찰 인증 사진">`;
  }catch{
    if(!current())return;
    el.innerHTML=`<div class="photo-load-error" role="status"><span>인증 사진을 불러오지 못했습니다.</span><button type="button" class="btn secondary small" data-photo-retry="${key}">다시 불러오기</button></div>`;
    el.querySelector('[data-photo-retry]').onclick=()=>loadProofPhoto(s,key);
  }
}
modal.addEventListener('close',()=>{if(modal.querySelector('#cash-receipt-issue-form'))modal.innerHTML='';modalDirty=false;cleanupDriveMedia();for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();});
function localDateTime(value=new Date()) {return `${kstDate(value)}T${time(value)}`;}
function captureDialog(id,key) {
  const s=find(id);const label=key==='checkIn'?'만남':'헤어짐';
  showDialog(`${label} 사진 인증`, `<form id="capture-form"><p class="subtitle">${esc(s.customer)} 고객님 · ${dateLabel(s.start)} ${time(s.start)}</p><div class="info-box">${icon('camera')}<span>패찰과 스키복 상의·하의 색깔이 보이도록 지금 촬영해 주세요.</span></div><label class="field"><span class="field-label">인증 사진 <b>*</b></span><input id="proof-file" type="file" accept="image/*" capture="environment" required><span class="field-help">사진 1장 · 최대 15MB · JPG·PNG·WebP·HEIC</span></label><div class="photo-preview" id="capture-preview" hidden></div><label class="field"><span class="field-label">실제 ${label==='만남'?'만난':'헤어진'} 시각 (한국 시간) <b>*</b></span><input name="eventAt" type="datetime-local" value="${localDateTime()}" required><span class="field-help">업로드 시각은 저장할 때 서버 시각으로 별도 기록합니다.</span></label><label class="check-field"><input type="checkbox" name="visible" required> 패찰과 스키복 상·하의가 사진에 모두 보입니다.</label><div class="modal-footer"><button type="button" class="btn secondary" id="capture-back">이전으로</button><button class="btn primary" type="submit">${icon('upload')}${label} 인증 등록</button></div></form>`);
  $('#capture-back').onclick=()=>{if(mayLeaveEdits({dialog:true,uploads:true}))openLesson(id,'proof');};
  $('#proof-file').onchange=e=>{const file=e.target.files[0];if(!file)return;const el=$('#capture-preview');el.hidden=false;const url=URL.createObjectURL(file);objectURLs.add(url);el.innerHTML=`<img src="${url}" alt="선택한 인증 사진 미리보기">`;};
  $('#capture-form').onsubmit=async e=>{
    e.preventDefault();const form=e.target;const file=$('#proof-file').files[0];if(!file||!((/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))||(!file.type&&/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)))){toast('JPG, PNG, WebP 또는 HEIC 사진을 선택해 주세요.');return;}if(file.size>15*1024*1024){toast('15MB 이하의 사진을 선택해 주세요.');return;}
    const upload=now(),event=new Date(`${new FormData(form).get('eventAt')}:00+09:00`);if(!Number.isFinite(event.getTime())||event>upload){toast('실제 만남·헤어짐 시각은 현재보다 미래일 수 없습니다.');return;}
    if(key==='checkOut'&&(!s.checkIn||event<new Date(s.checkIn.eventAt))){toast('헤어진 시각은 만난 시각 이후여야 합니다.');return;}
    if(key==='checkIn'&&s.checkOut&&event>new Date(s.checkOut.eventAt)){toast('만난 시각은 헤어진 시각 이전이어야 합니다.');return;}
    await performSave(form,async()=>{await saveRemoteProof(id,key,file,event.toISOString());await refreshWorkspace();openLesson(id,'proof');toast(`${label} 사진 인증을 서버에 저장했습니다.`);});
  };
}
function responseDialog(warningId,admin) {
  const w=allWarnings().find(w=>w.id===warningId);if(!w)return;const s=find(w.scheduleId);const prev=admin?activeReview(w):activeResponse(w);
  showDialog(admin?'관리자 검토':'경고 내용 확인', `<form id="response-form"><div class="warning-box">${icon('warning')}<span><strong>${esc(w.title)}</strong><br>${esc(w.detail)}</span></div><p class="muted">${esc(s.instructor)} · ${esc(s.customer)} · ${dateLabel(s.start)} ${time(s.start)}</p><label class="field"><span class="field-label">${admin?'검토 결과':'이 경고 내용이 맞나요?'} <b>*</b></span><select name="answer" required><option value="">선택해 주세요</option>${(admin?[['confirmed','미준수 확인'],['dismissed','소명 인정'],['followup','추가 확인 필요']]:[['confirm','네, 맞습니다'],['dispute','아니요, 이의 있습니다']]).map(([v,t])=>`<option value="${v}" ${prev?.[admin?'result':'answer']===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="field"><span class="field-label">사유 · 확인 내용</span><textarea name="note" rows="4" maxlength="2000" placeholder="상황과 사유를 구체적으로 남겨 주세요.">${esc(prev?.note||'')}</textarea><span class="field-help">이의 제기 또는 추가 확인 요청 시 사유를 입력해 주세요.</span></label><div class="modal-footer"><button class="btn primary" type="submit">${admin?'검토 결과 저장':'확인 응답 저장'}</button></div></form>`);
  $('#response-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),answer=f.get('answer'),note=String(f.get('note')).trim();if(['dispute','followup'].includes(answer)&&!note){toast('사유를 입력해 주세요.');return;}await performSave(e.target,async()=>{const evidence=warningEvidence(w);if(admin)await saveRemoteReview(s.id,warningId,{result:answer,note,evidence});else await saveRemoteResponse(s.id,warningId,{answer,note,evidence});modal.close();await refreshWorkspace();toast(admin?'관리자 검토를 저장했습니다.':'경고 확인 응답을 저장했습니다.');});};
}
function importDialog() {
  if(ui.role!=='admin')return;
  showDialog('강습 일정 가져오기', `<form id="import-form"><div class="integration-card"><span class="integration-logo google">${icon('sheet')}</span><div class="integration-copy"><strong>일정표 형식은 나중에 확정해도 괜찮아요.</strong><p>지금은 CSV 파일로 일정을 가져올 수 있습니다.</p></div></div><div class="info-box">${icon('link')}<span>이 기능은 CSV를 웹으로 가져옵니다. 시트의 수동 변경은 웹 예약에 자동 반영되지 않습니다. 기존 시트에서 <strong>파일 → 다운로드 → CSV</strong>로 저장한 뒤 아래에서 가져오세요.</span></div><p class="field-help">필수 열: 강사명, 고객명, 날짜, 시작시간, 종료시간<br>선택 열: 일정ID, 전화번호 · 날짜 YYYY-MM-DD / 시간 HH:mm<br>기존 일정 ID는 정보를 업데이트하고 인증 사진·보고서를 보존합니다. 다른 고객이나 강사로 변경되는 일정은 가져오기를 차단합니다.</p><a class="btn secondary small" href="./schedule-template.csv" download>${icon('download')}CSV 양식 다운로드</a><label class="field" style="margin-top:20px"><span class="field-label">CSV 파일 선택 <b>*</b></span><input id="csv-file" type="file" accept=".csv,text/csv" required></label><div id="import-preview"></div><div class="modal-footer"><button class="btn primary" id="import-submit" type="submit" disabled>일정 가져오기</button></div></form>`);
  let pending=[];
  $('#csv-file').onchange=async e=>{pending=[];$('#import-submit').disabled=true;$('#import-preview').innerHTML='';const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024){toast('2MB 이하의 CSV 파일을 선택해 주세요.');return;}const result=parseScheduleCSV(await file.text());pending=result.rows;const conflicts=pending.filter(row=>{const old=find(row.id);return old&&(old.instructor!==row.instructor||old.customer!==row.customer);});const errors=[...result.errors,...conflicts.map(row=>`${row.id}: 기존 강사 또는 고객과 다릅니다. 새 일정 ID를 사용해 주세요.`),...pending.filter(row=>state.reservations?.some(r=>r.id===row.id)).map(row=>`${row.id}: 예약·강사 배정 화면에서 수정해 주세요.`)];$('#import-preview').innerHTML=errors.length?`<div class="warning-box"><div><strong>가져오기 전에 확인해 주세요</strong><ul>${errors.slice(0,10).map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div></div>`:`<div class="info-box">${icon('check')}<span>${pending.length}건의 일정을 확인했습니다. 새 일정 ${pending.filter(r=>!find(r.id)).length}건 · 기존 일정 업데이트 ${pending.filter(r=>find(r.id)).length}건</span></div>`;$('#import-submit').disabled=!!errors.length||!pending.length;};
  $('#import-form').onsubmit=async e=>{e.preventDefault();await performSave(e.target,async()=>{await importRemoteSchedules(pending,state.roster);modal.close();ui.date='all';await refreshWorkspace();go('schedules');toast(`${pending.length}건의 일정을 서버에 가져왔습니다.`);});};
}
function exportCSV() {
  if(ui.role!=='admin')return;
  const cell=v=>{let text=String(v??'');if(/^(?:\s*[=+@-]|[\t\r])/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const lines=[['일정ID','강사명','고객명','전화번호','날짜','시작시간','종료시간','보고서링크','보고서내용','보고서등록시각'],...visible().map(s=>[s.id,s.instructor,s.customer,s.phone,kstDate(s.start),time(s.start),time(s.end),s.report?.link,s.report?.text,s.report?.submittedAt])];
  const blob=new Blob(['\uFEFF'+lines.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`SLOPE-강습기록-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('강습 기록을 내보냈습니다.');
}
function cashReceiptPage(){
  if(!canManageCashReceipts(state.profile))return '';
  return head('현금영수증 관리','요청된 강습료와 발급번호를 확인하고, 실제 발급한 회차만 완료 처리하세요.')+renderCashReceipts({profile:state.profile,data:state.cashReceipts,error:state.cashReceiptsError,filter:cashReceiptFilter,query:cashReceiptQuery});
}
function bindCashReceipts(){
  if(!canManageCashReceipts(state.profile))return;
  app.querySelectorAll('[data-cash-retry]').forEach(button=>button.onclick=()=>syncWorkspace({explicit:true}));
  app.querySelectorAll('[data-cash-filter]').forEach(button=>button.onclick=()=>{cashReceiptFilter=button.dataset.cashFilter;render();});
  app.querySelector('[data-cash-query]')?.addEventListener('input',event=>{cashReceiptQuery=event.target.value;render();const input=app.querySelector('[data-cash-query]');input?.focus();});
  app.querySelectorAll('[data-cash-issue]').forEach(button=>button.onclick=()=>openCashReceiptIssue(button.dataset.cashIssue));
}
function openCashReceiptIssue(id){
  if(!canManageCashReceipts(state.profile))return;
  const row=state.cashReceipts?.items?.find(item=>item.reservationId===id);if(!row||row.outstandingAmount<=0)return;
  const userId=state.profile.user_id,epoch=authEpoch,requestId=crypto.randomUUID();
  showDialog('현금영수증 발급 완료 기록',renderCashReceiptIssue(row));
  const form=modal.querySelector('#cash-receipt-issue-form');
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(form.dataset.saving||!form.reportValidity()||!canManageCashReceipts(state.profile)||state.profile.user_id!==userId||epoch!==authEpoch)return;
    const note=String(new FormData(form).get('note')||'');form.dataset.saving='true';const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    const errorNode=form.querySelector('[data-cash-issue-error]');errorNode.hidden=true;
    try{
      await issueCashReceipt(state.profile,row,{requestId,note});
      if(epoch!==authEpoch||state.profile?.user_id!==userId||!canManageCashReceipts(state.profile))return;
      modalDirty=false;modal.close();await refreshWorkspace();toast('현금영수증 발급 완료 금액을 기록했습니다.');
    }catch(error){if(epoch!==authEpoch||state.profile?.user_id!==userId||!canManageCashReceipts(state.profile))return;errorNode.textContent=error.message;errorNode.hidden=false;}
    finally{delete form.dataset.saving;buttons.forEach(button=>button.disabled=false);}
  });
}
function clearAdminGuide(){adminGuide={userId:null,html:'',error:'',loading:false,request:adminGuide.request+1};}
function adminGuidePage(){
  if(!canUseAdminGuide(state.profile))return '';
  const body=adminGuide.html|| (adminGuide.error?`<p class="field-help" role="alert">${esc(adminGuide.error)}</p><button type="button" class="btn secondary" data-guide-retry>다시 불러오기</button>`:'<p class="field-help" role="status">안내를 불러오고 있습니다…</p>');
  return head('기능 · 업무 안내','예약 접수부터 강습 기록과 운영 확인까지 업무 흐름을 확인하세요.')+`<section class="panel"><div class="panel-body" data-admin-guide>${body}</div></section>`;
}
function bindAdminGuide(){
  if(!canUseAdminGuide(state.profile))return;
  app.querySelector('[data-guide-retry]')?.addEventListener('click',()=>fetchAdminGuide(true));
  if(!adminGuide.html&&!adminGuide.error&&!adminGuide.loading)void fetchAdminGuide();
}
async function fetchAdminGuide(force=false){
  if(!canUseAdminGuide(state.profile)||ui.page!=='guide'||adminGuide.loading&&!force)return;
  const userId=state.profile.user_id,epoch=authEpoch,request=adminGuide.request+1;
  adminGuide={userId,html:'',error:'',loading:true,request};
  if(force)render();
  try{
    const result=await loadAdminGuide(state.profile);
    if(epoch!==authEpoch||adminGuide.request!==request||!canUseAdminGuide(state.profile)||state.profile.user_id!==userId)return;
    adminGuide.html=result.html;
  }catch(error){
    if(epoch!==authEpoch||adminGuide.request!==request||!canUseAdminGuide(state.profile)||state.profile.user_id!==userId)return;
    adminGuide.error=error.message||'기능 안내를 불러오지 못했습니다. 다시 시도해 주세요.';
  }finally{
    if(epoch===authEpoch&&adminGuide.request===request&&canUseAdminGuide(state.profile)&&state.profile.user_id===userId){adminGuide.loading=false;if(ui.page==='guide')render();}
  }
}
window.addEventListener('hashchange',()=>{const p=location.hash.slice(1);if(!pageTitles[p])return;if(ui.role!=='admin'&&['settings','instructors','bookings','changes','calls','payments','guide','cash-receipts'].includes(p)){history.replaceState(history.state,'','#'+ui.page);return;}if(!go(p))history.replaceState(history.state,'','#'+ui.page);});
function instructorPage() {
  const {visible,removed}=staffDirectoryGroups(state.roster);
  const card=m=>{
    const teacher=m.role==='instructor',list=teacher?state.schedules.filter(s=>s.instructorUserIds?.includes(m.user_id)):[];
    const w=teacher?allWarnings().filter(w=>list.some(s=>s.id===w.scheduleId)&&isPending(w)):[];
    return `<article class="panel instructor-card" data-staff-id="${esc(m.user_id)}"><div class="person-cell">${avatar(m.display_name,false)}<div><h2>${esc(m.display_name)} <span class="muted">${staffRoleLabel(m.role)}</span></h2><span class="muted">${m.email?.endsWith('@pending.gonjiamski.co.kr')?'이메일 미설정 · 설정 링크를 전달해 주세요':esc(m.email)}</span>${m.phone?`<span class="muted">${esc(m.phone)}</span>`:''}</div>${m.freelancer?badge('프리랜서','warning'):''}${badge(m.active?'사용 중':'사용 중지',m.active?'success':'neutral')}</div>${teacher?`<div class="kpi-strip"><div class="kpi"><strong>${list.length}</strong><span>배정 일정</span></div><div class="kpi"><strong>${list.filter(s=>s.report).length}</strong><span>보고서 등록</span></div><div class="kpi"><strong>${w.length}</strong><span>확인 필요</span></div></div>`:'<p class="field-help">예약 접수 · 고객과 팀 관리 · 시간표 · 강사 배정 · 수강권과 결제 관리</p>'}<p class="field-help">${m.must_change_password?'첫 로그인 후 비밀번호 설정 대기':'비밀번호 설정 완료'}</p><div class="account-actions">${teacher?renderInstructorDirectoryActions(m):''}<button class="btn secondary small" data-member-invite="${esc(m.user_id)}" ${m.active?'':'disabled'}>이메일·비번 설정 링크</button><button class="btn secondary small" data-member-reset="${esc(m.user_id)}" ${m.active?'':'disabled'}>접속 링크 재발급</button>${teacher?'':`<button class="btn ghost small" data-member-toggle="${esc(m.user_id)}" data-active="${!m.active}">${m.active?'사용 중지':'다시 활성화'}</button>`}</div></article>`;
  };
  return `${head('계정 · 권한 관리','강사 이름을 수정하고 사용하지 않는 강사 계정을 목록에서 정리할 수 있습니다.',`<button class="btn primary" data-action="add-instructor">${icon('plus')}계정 발급</button>`)}<div class="info-box">${icon('shield')}<span>강사 계정을 목록에서 삭제하면 로그인과 새 배정이 중지됩니다. 기존 예약·사진·보고서는 유지되며 아래에서 복원할 수 있습니다. 상담사 계정과 관리자 권한은 별도로 유지합니다.</span></div><div class="card-grid instructor-grid" data-staff-active>${visible.map(card).join('')||`<section class="panel">${empty('사용 중인 운영 계정이 없습니다','강사 또는 상담사 계정을 발급하거나 아래에서 강사 계정을 복원하세요.')}</section>`}</div>${removed.length?`<details class="instructor-archive"><summary>삭제·사용 중지 강사 <span class="count-sub">${removed.length}명</span></summary><p class="field-help">기존 기록을 보존한 계정입니다. 목록에 복원하면 로그인과 새 강사 배정을 다시 사용할 수 있습니다.</p><div class="card-grid instructor-grid" data-staff-removed>${removed.map(card).join('')}</div></details>`:''}<section class="panel"><div class="panel-head"><h2 class="panel-title">계정 미배정 일정 <span class="count-sub">${state.schedules.filter(s=>!s.instructorUserId).length}</span></h2></div>${scheduleTable(state.schedules.filter(s=>!s.instructorUserId))}</section>`;
}
function editInstructorName(userId){
  const member=state.roster.find(person=>person.user_id===userId);
  if(!canManageInstructor(state.profile,member))return;
  const epoch=authEpoch,actor=state.profile.user_id;
  showDialog('강사 이름 · 연락처 수정',`<form id="edit-instructor-form"><p class="field-help">${esc(member.email)} · 로그인 이메일과 기존 강습 기록의 연결은 유지됩니다.</p><label class="field"><span class="field-label">강사 이름 *</span><input name="name" required minlength="2" maxlength="60" autocomplete="off" value="${esc(member.display_name)}"></label><label class="field"><span class="field-label">전화번호</span><input name="phone" type="tel" maxlength="20" autocomplete="off" value="${esc(member.phone||'')}" placeholder="010-0000-0000"></label><p class="field-help staff-edit-error" data-staff-error role="alert" hidden></p><div class="modal-footer"><button class="btn secondary" type="button" data-action="close">취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
  $('#edit-instructor-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,formData=new FormData(form),name=formData.get('name'),phone=String(formData.get('phone')||'').trim(),errorBox=$('[data-staff-error]',form);
    if(epoch!==authEpoch||state.profile?.user_id!==actor||!canManageInstructor(state.profile,member))return;
    errorBox.hidden=true;
    await performSave(form,async()=>{
      try{const changes=instructorNameChange(state.profile,member,name);if(phone!==String(member.phone||''))changes.phone=phone;await setMemberStatus(userId,changes);}
      catch(error){errorBox.textContent=error.message||'이름을 저장하지 못했습니다.';errorBox.hidden=false;throw error;}
      if(epoch!==authEpoch||state.profile?.user_id!==actor)return;
      modalDirty=false;modal.close();await refreshWorkspace();if(epoch===authEpoch&&state.profile?.user_id===actor)toast('강사 이름을 수정했습니다.');
    });
  };
}
function removeInstructorFromDirectory(userId){
  const member=state.roster.find(person=>person.user_id===userId);
  if(!canManageInstructor(state.profile,member)||!member.active)return;
  const epoch=authEpoch,actor=state.profile.user_id,count=instructorLinkedScheduleCount(member,[...state.schedules,...(state.archivedSchedules||[])]);
  showDialog('강사 계정을 목록에서 삭제할까요?',`<form id="remove-instructor-form"><p><strong>${esc(member.display_name)}</strong> · ${esc(member.email)}</p><p>로그인과 새 강사 배정을 중지하고 사용 중인 목록에서 제외합니다.</p><div class="info-box">${icon('shield')}<span>연결 일정 ${count}건과 기존 예약·사진·보고서를 보존합니다. 다른 강사나 상담사 계정은 변경하지 않습니다.</span></div><p class="field-help">삭제·사용 중지 강사 목록에서 복원할 수 있습니다.</p><p class="field-help staff-edit-error" data-staff-error role="alert" hidden></p><div class="modal-footer"><button class="btn secondary" type="button" data-action="close">취소</button><button class="btn danger" type="submit">목록에서 삭제</button></div></form>`);
  $('#remove-instructor-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,errorBox=$('[data-staff-error]',form);
    if(epoch!==authEpoch||state.profile?.user_id!==actor||!canManageInstructor(state.profile,member))return;
    errorBox.hidden=true;
    await performSave(form,async()=>{
      try{await setMemberStatus(userId,{active:false});}
      catch(error){errorBox.textContent=error.message||'목록에서 삭제하지 못했습니다.';errorBox.hidden=false;throw error;}
      if(epoch!==authEpoch||state.profile?.user_id!==actor)return;
      modalDirty=false;modal.close();await refreshWorkspace();if(epoch===authEpoch&&state.profile?.user_id===actor)toast('강사 계정을 목록에서 삭제했습니다. 기존 기록은 보존했습니다.');
    });
  };
}
function assignmentControl() {
 return `<div class="info-box">${icon('external')}<span>담당 강사 배정은 예약 · 강사 배정 메뉴에서 관리합니다.<br><a class="text-link" href="${RESERVATION_SITE_URL}">예약 · 배정 관리 ${icon('arrow')}</a></span></div>`;
}
async function shareSurvey(scheduleId){
 if(!canManageSurveyLinks()){toast('관리자만 고객 설문 안내를 관리할 수 있습니다.');return;}
 const userId=state.profile.user_id;
 try{const data=await surveyAction('create-link',{scheduleId});if(state.profile?.user_id!==userId||!canManageSurveyLinks())return;await navigator.clipboard.writeText(data.surveyUrl);toast('고객 만족도 조사 링크를 복사했습니다.');}catch(error){if(state.profile?.user_id===userId&&canManageSurveyLinks())toast(error.message||'설문 링크를 복사하지 못했습니다.');}
}
async function performSave(form,operation) {
  if(form.dataset.saving)return;
  form.dataset.saving='1';
  const controls=[...form.querySelectorAll('button, input, textarea, select')];
  const disabledBefore=controls.map(control=>control.disabled);
  controls.forEach(control=>control.disabled=true);
  try{await operation();if(app.contains(form))mainDirty=false;}
  catch(error){toast(error.message||'저장하지 못했습니다. 다시 시도해 주세요.');}
  finally{delete form.dataset.saving;controls.forEach((control,index)=>control.disabled=disabledBefore[index]);}
}
function syncLabel() {return lastSyncAt?'최근 동기화 '+new Date(lastSyncAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'서버의 최신 강습 기록';}
function lessonFingerprint(id) {const lesson=find(id);return lesson?JSON.stringify([lesson.checkIn,lesson.checkOut,lesson.report,lesson.responses,lesson.reviews,lesson.instructorUserIds,lesson.rental,lesson.paymentCorrection,(state.alerts||[]).filter(a=>a.scheduleId===id).map(a=>[a.id,a.evidenceHash,a.generation])]):'';}
function showRemoteNotice(message) {const notice=$('#detail-sync-notice',modal);if(notice){notice.textContent=message;notice.hidden=false;}}
async function optionalRequest(promise,milliseconds){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('요청이 지연되고 있습니다.')),milliseconds);})]);}finally{clearTimeout(timer);}}
async function refreshPushState(){const userId=state.profile?.user_id;if(!userId)return;try{const value=await optionalRequest(getPushStatus(),4000);if(state.profile?.user_id!==userId)return;pushState=value;if(ui.page==='alerts'&&!modal.open&&!mainDirty)render();}catch{if(state.profile?.user_id===userId)pushState={...pushState,message:'기기 알림 상태를 확인하지 못했습니다. 다시 시도해 주세요.'};}}
async function changePush(enabled){if(pushBusy||!state.profile)return;pushBusy=true;render();try{pushState=await(enabled?enablePushNotifications():disablePushNotifications());toast(pushState.message||(pushState.enabled?'브라우저 알림을 켰습니다.':'브라우저 알림을 껐습니다.'));}catch(error){toast(error.message||'알림 설정을 변경하지 못했습니다.');}finally{pushBusy=false;if(state.profile)render();}}
async function runServerChecks(){if(ui.role!=='admin'||checksRunning)return;checksRunning=true;render();try{const result=await automationAction('run');await refreshWorkspace();toast(result.status==='busy'?'이미 서버 점검이 진행 중입니다.':`서버 점검 완료 · 활성 확인 요청 ${result.activeAlerts??warnings().length}건`);}catch(error){toast(error.message);}finally{checksRunning=false;if(state.profile)render();}}
async function readAlert(id,button){button.disabled=true;try{await markAlertRead(id);await refreshWorkspace();if(modal.open&&ui.detailTab==='alerts'&&!modalDirty)openLesson(activeLessonId,'alerts');toast((state.alerts||[]).some(row=>row.id===id&&row.category==='customer-request')?'알림을 읽음으로 표시했습니다. 승인·반려는 요청 검토 화면에서 진행해 주세요.':'알림을 읽음으로 표시했습니다. 사실 여부 응답은 별도로 확인해 주세요.');}catch(error){toast(error.message);button.disabled=false;}}
async function readReservationChangeNotification(id){
  const userId=state.profile?.user_id;
  const notice=(state.reservationChangeNotifications||[]).find(row=>row.id===id&&row.recipient_user_id===userId);
  if(!userId||!notice||notice.read_at)return;
  await markReservationChangeNotificationRead(id);
  if(state.profile?.user_id!==userId)return;
  await refreshWorkspace();
  if(state.profile?.user_id===userId)toast('예약 변경 알림을 읽음으로 표시했습니다.');
}
async function refreshWorkspace(existing=null,{background=false}={}) {
  const epoch=authEpoch,userAtStart=state.profile?.user_id;
  const previousLinks=state.surveyLinks||{};const previousAutomation=state.automation;
  const data=existing||await fetchWorkspace(defaultSettings);
  if(epoch!==authEpoch||userAtStart&&state.profile?.user_id!==userAtStart)return state;
  if(data.profile.must_change_password){state=data;if(modal.open)modal.close();showPassword();return data;}
  if(staffDestination(data.profile,{bookingIntent:bookingRequested})==='booking'){routeToBooking();return data;}
  clearBookingIntent();
  state=data;reconcileDriveAccess();ui.role=data.profile.role;ui.instructor=data.profile.display_name;setInstructorPrivacy(data.profile);
  if(ui.role!=='admin'&&['settings','instructors','bookings','changes','calls','payments','guide','cash-receipts'].includes(ui.page)){ui.page='dashboard';if(['#guide','#cash-receipts'].includes(location.hash))history.replaceState(history.state,'','#dashboard');}
  state.surveyLinks=canManageSurveyLinks()&&userAtStart===data.profile.user_id?previousLinks:{};
  state.outbox=[];
  state.automation=userAtStart===data.profile.user_id?previousAutomation:null;
  const auxiliary=await Promise.allSettled([canManageSurveyLinks()?optionalRequest(surveyAction('list-links'),4000):Promise.resolve(null),optionalRequest(automationAction('status'),3500),canManageCashReceipts(data.profile)?optionalRequest(loadCashReceipts(data.profile),8000):Promise.resolve(null)]);
  if(epoch!==authEpoch||state.profile?.user_id!==data.profile.user_id)return state;
  if(!canManageSurveyLinks()){state.surveyLinks={};state.surveyLinksUnavailable=false;}
  else if(auxiliary[0].status==='fulfilled'){state.surveyLinks=Object.fromEntries((auxiliary[0].value.links||[]).map(l=>[l.scheduleId,l.surveyUrl]));state.surveyLinksUnavailable=false;}else state.surveyLinksUnavailable=true;
  if(auxiliary[1].status==='fulfilled'){state.automation=auxiliary[1].value;state.automationUnavailable=false;}else state.automationUnavailable=true;
  if(canManageCashReceipts(state.profile)){if(auxiliary[2].status==='fulfilled'){state.cashReceipts=auxiliary[2].value;state.cashReceiptsError='';}else{state.cashReceipts=null;state.cashReceiptsError=auxiliary[2].reason?.message||'현금영수증 요청을 불러오지 못했습니다.';}}else{state.cashReceipts=null;state.cashReceiptsError='';}
  if(canManageSurveyLinks())state.outbox=state.schedules.filter(s=>s.report).map(s=>{const surveyUrl=state.surveyLinks[s.id]||'만족도 링크 생성 필요';let message=state.settings.smsTemplate.replaceAll('{고객명}',s.customer).replaceAll('{강사명}',s.instructor).replaceAll('{링크}',s.report.link).replaceAll('{만족도링크}',surveyUrl);if(!state.settings.smsTemplate.includes('{만족도링크}'))message+='\n만족도 조사: '+surveyUrl;return{scheduleId:s.id,customer:s.customer,phone:s.phone||'전화번호 미등록',message,createdAt:s.report.updatedAt||s.report.submittedAt,status:'draft'};});
  lastSyncAt=Date.now();
  const focusedEditor=app.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select');
  if(!mainDirty&&!(background&&focusedEditor))render();
  return data;
}
function refreshTimeOffDraft() {
  if(ui.page!=='timeoff'||!mainDirty||app.querySelector('[data-timeoff-saving]'))return;
  const root=app.querySelector('.timeoff-page');if(!root)return;
  const focused=document.activeElement;
  const drafts=[...root.querySelectorAll('.to-request-form [name="note"], [data-timeoff-review] [name="note"]')].map(input=>({
    reviewId:input.closest('[data-timeoff-review]')?.dataset.timeoffReview||null,
    value:input.value,focused:input===focused,start:input.selectionStart,end:input.selectionEnd,
  }));
  const dirty=mainDirty;
  render();
  for(const draft of drafts){
    const form=draft.reviewId?[...app.querySelectorAll('[data-timeoff-review]')].find(item=>item.dataset.timeoffReview===draft.reviewId):app.querySelector('.to-request-form');
    const input=form?.querySelector('[name="note"]');if(!input)continue;
    input.value=draft.value;
    if(draft.focused){input.focus({preventScroll:true});if(draft.start!==null)input.setSelectionRange(draft.start,draft.end);}
  }
  mainDirty=dirty;
}
async function syncWorkspace({explicit=false,detail=false}={}) {
  if(!state.profile||document.hidden&&!explicit)return;
  if(syncPromise)return syncPromise;
  const epoch=authEpoch,userId=state.profile.user_id;
  const lessonId=activeLessonId,oldFingerprint=lessonFingerprint(lessonId);
  const wasDetail=modal.open&&!!$('.detail-summary',modal);
  syncPromise=(async()=>{
    try{
      await refreshWorkspace(null,{background:!explicit});
      if(epoch!==authEpoch||state.profile?.user_id!==userId||passwordMode)return;
      if(explicit)refreshTimeOffDraft();
      if(wasDetail&&modal.open&&activeLessonId===lessonId&&$('.detail-summary',modal)){
        const changed=oldFingerprint!==lessonFingerprint(lessonId);
        if(!find(lessonId)) {modal.close();toast('담당 일정 접근 권한이 변경되었습니다.');return;}
        const saving=!!modal.querySelector('[data-saving]');
        const autoProof=ui.detailTab==='proof'&&!!$('#photo-checkIn',modal)&&!modalDirty&&!saving;
        const canExplicit=detail&&!modalDirty&&!saving;
        if((changed&&autoProof)||canExplicit)openLesson(lessonId,ui.detailTab);
        else if(changed)showRemoteNotice('다른 기기의 새 기록을 불러왔습니다. 작성 중인 내용은 유지했습니다. 입력을 마친 뒤 최신 기록을 확인해 주세요.');
        else if(detail&&modalDirty)showRemoteNotice('작성 중인 내용은 유지했습니다. 서버의 최신 기록은 준비되어 있습니다. 입력을 마친 뒤 다시 확인해 주세요.');
        const label=$('.detail-sync-status',modal);if(label)label.textContent=syncLabel();
      }
      if(explicit)toast(mainDirty||modalDirty?'최신 기록을 불러왔습니다. 작성 중인 내용은 유지했습니다.':'서버의 최신 기록을 불러왔습니다.');
    }catch(error){if(epoch!==authEpoch||state.profile?.user_id!==userId)return;if(error.code==='ACCOUNT_UNAVAILABLE'){if(modal.open)modal.close();showLogin(error.message);return;}if(explicit)toast(error.message||'기록을 새로 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}
    finally{syncPromise=null;}
  })();
  return syncPromise;
}
function clearBookingIntent(){
  bookingRequested=false;
  const url=new URL(location.href);
  if(url.searchParams.has('next')){url.searchParams.delete('next');history.replaceState(history.state,'',`${url.pathname}${url.search}${url.hash}`);}
}
function routeToBooking(view='reservations'){
  clearAdminGuide();
  if(routingToBooking)return;
  const destination=bookingWorkspaceUrl(RESERVATION_SITE_URL,['changes','calls','payments'].includes(view)&&state.profile?.role==='admin'?view:'reservations');
  routingToBooking=true;authEpoch++;
  stopDriveUploads();setInstructorPrivacy(null);
  state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};
  if(modal.open)modal.close();
  app.innerHTML=`<div class="app-loading" role="status"><strong>SLOPE</strong><span>예약 업무 화면으로 연결하고 있습니다…</span><a href="${destination}">예약 업무로 이동</a></div>`;
  location.replace(destination);
}
function showLogin(error='') {
  clearAdminGuide();
  authEpoch++;routingToBooking=false;
  state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};
  stopDriveUploads();setInstructorPrivacy(null);mainDirty=false;modalDirty=false;passwordMode=false;
  renderAuthScreen(app,{mode:'login',error,onAuthenticated:async session=>{if(session)await startSession();}});
}
function showPassword() {
  clearAdminGuide();
  authEpoch++;stopDriveUploads();setInstructorPrivacy(null);mainDirty=false;modalDirty=false;passwordMode=true;
  state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};
  if(modal.open)modal.close();
  renderAuthScreen(app,{mode:'password',onAuthenticated:async session=>{if(!session){state.profile=null;showLogin();}},onPasswordChanged:async()=>{passwordMode=false;await startSession();}});
}
async function startSession(forcePassword=false) {
  if(loadingWorkspace&&loadingWorkspace===authEpoch)return;
  const epoch=++authEpoch;loadingWorkspace=epoch;
  try{
    const current=await currentSession();if(epoch!==authEpoch)return;
    if(!current){showLogin();return;}
    loadingUserId=current.user.id;
    const data=await fetchWorkspace(defaultSettings,{profileOnly:forcePassword,booking:bookingRequested});
    if(epoch!==authEpoch)return;
    const destination=staffDestination(data.profile,{forcePassword,bookingIntent:bookingRequested});
    if(destination==='password'){showPassword();return;}
    if(destination==='booking'){routeToBooking();return;}
    if(destination!=='workspace'){showLogin('허용되지 않은 계정 권한입니다. 관리자에게 문의해 주세요.');return;}
    await refreshWorkspace(data);
    if(epoch===authEpoch&&state.profile)refreshPushState();
  }
  catch(error){if(epoch===authEpoch)showLogin(error.message||'계정 정보를 확인하지 못했습니다.');}
  finally{if(loadingWorkspace===epoch){loadingWorkspace=0;loadingUserId=null;}}
}
async function logout() {
  if(!mayLeaveEdits({main:true,dialog:true,uploads:true,leavingPage:true}))return;
  authEpoch++;
  stopDriveUploads();
  try{await optionalRequest(disablePushNotifications(),2500);}catch{}
  pushState={supported:null,enabled:false,permission:'default',message:''};
  try{await signOut();}catch(error){toast(error.message);return;}
  state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};if(modal.open)modal.close();showLogin();
}
function changePassword() {if(!mayLeaveEdits({main:true,dialog:true,uploads:true,leavingPage:true}))return;if(modal.open)modal.close();state.profile=null;showPassword();}
async function boot() {
  const setup=new URL(location.href).searchParams.has('setup_token');passwordMode=setup;
  app.innerHTML='<div class="app-loading" role="status"><strong>SLOPE</strong><span>로그인 정보를 확인하고 있습니다…</span></div>';
  try{if(setup)await consumeSetupLink();await startSession(setup);}catch(error){showLogin(error.message||'초기 접속 링크가 만료되었습니다. 새 링크를 요청해 주세요.');}
}
function createAccountDialog() {
  if(ui.role!=='admin')return;
  showDialog('운영 계정 발급',`<form id="create-account-form"><div class="info-box">${icon('users')}<span>선택한 역할에 맞춰 로그인 후 첫 화면과 메뉴가 자동으로 적용됩니다.</span></div><label class="field"><span class="field-label">담당 역할 *</span><select name="role" required><option value="instructor">강사 · 본인 강습과 보고서 관리</option><option value="counselor">상담사 · 예약 접수와 강사 배정</option></select></label><label class="check-field"><input type="checkbox" name="freelancer"> 프리랜서 강사 <small>전화번호로만 등록 · 로그인/설정 링크 없음 · 자동배정 제외 (체크 시 역할·발급방식 무시, 전화번호 필수)</small></label><label class="field"><span class="field-label">이름 *</span><input name="name" required minlength="2" maxlength="60" autocomplete="off" placeholder="강사 또는 상담사 이름 (예: 강사A)"></label><label class="field"><span class="field-label">전화번호 (선택)</span><input name="phone" type="tel" maxlength="20" autocomplete="off" placeholder="010-0000-0000"><span class="field-help">비워 두면 강사가 설정 링크에서 직접 입력하거나, 나중에 이름 수정에서 넣을 수 있습니다.</span></label><label class="field"><span class="field-label">발급 방식 *</span><select name="method" required><option value="invite">강사가 직접 설정 · 이름만 만들고 설정 링크 전달</option><option value="direct">지금 이메일·임시 비밀번호 입력</option></select><span class="field-help">강사가 직접 설정: 이름만으로 계정을 먼저 만들고, 설정 링크를 전달하면 강사가 본인 이메일 인증 후 비밀번호를 정합니다. 이름은 나중에 실제 강사 이름으로 바꿔도 배정·기록이 유지됩니다.</span></label><div data-direct-fields hidden><label class="field"><span class="field-label">로그인 이메일 *</span><input name="email" type="email" maxlength="254" autocomplete="off" placeholder="staff@example.com"></label><label class="field"><span class="field-label">임시 비밀번호 (선택)</span><input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="비워 두면 안전한 임시 비밀번호를 생성합니다"><span class="field-help">발급받은 사용자는 첫 로그인 때 본인 비밀번호를 설정합니다. 이메일이나 문자는 자동 발송하지 않습니다.</span></label></div><div class="modal-footer"><button class="btn primary" type="submit">계정 발급하기</button></div></form>`);
  const accountForm=$('#create-account-form'),directFields=$('[data-direct-fields]',accountForm),emailInput=accountForm.elements.email;
  const syncMethod=()=>{const direct=accountForm.elements.method.value==='direct';directFields.hidden=!direct;emailInput.required=direct;};
  accountForm.elements.method.onchange=syncMethod;syncMethod();
  accountForm.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await performSave(e.target,async()=>{
    if(f.get('freelancer')){
      // 프리랜서: 로그인 없이 전화번호로만 등록(자동배정 제외). 설정 링크를 만들지 않는다.
      await accountAction('create-placeholder',{name:f.get('name'),role:'instructor',phone:f.get('phone'),freelancer:true});
      await refreshWorkspace();closeDialog();toast('프리랜서 강사를 등록했습니다. 강사지정에서 프리랜서로 선택할 수 있습니다.');
      return;
    }
    if(f.get('method')==='invite'){
      const created=await accountAction('create-placeholder',{name:f.get('name'),role:f.get('role'),phone:f.get('phone')});
      const link=await accountAction('invite-create',{userId:created.userId});
      await refreshWorkspace();showInviteLinkDialog(link);
    }else{
      const result=await accountAction('create',{name:f.get('name'),email:f.get('email'),password:f.get('password'),role:f.get('role'),phone:f.get('phone')});
      await refreshWorkspace();showAccountIssued(result);
    }
  });};
}
function showInviteLinkDialog(result){
  showDialog('이메일·비밀번호 설정 링크',`<div class="info-box">${icon('link')}<span><strong>${esc(result.name)}</strong> 님에게 아래 링크를 전달해 주세요.<br>강사가 링크에서 본인 이메일을 인증하고 비밀번호를 설정하면 바로 로그인할 수 있습니다. 링크는 14일 동안 1회만 사용할 수 있고, 다시 만들면 이전 링크는 무효가 됩니다.</span></div><label class="field"><span class="field-label">설정 링크</span><input id="invite-url" readonly value="${esc(result.joinUrl)}"></label><div class="modal-footer"><button class="btn primary" id="copy-invite" type="button">링크 복사</button></div>`);
  $('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(result.joinUrl);toast('설정 링크를 복사했습니다.');}catch{$('#invite-url').select();toast('링크를 선택했습니다. 직접 복사해 주세요.');}};
}
async function createInviteLink(userId){
  if(ui.role!=='admin')return;
  try{const result=await accountAction('invite-create',{userId});showInviteLinkDialog(result);}catch(error){toast(error.message);}
}
function showAccountIssued(result) {
  showDialog(`${staffRoleLabel(result.role||'instructor')} 계정을 발급했습니다`,`<div class="info-box">${icon('check')}<span>접속 정보를 해당 사용자에게 직접 전달해 주세요. 이메일·문자는 발송하지 않았습니다.</span></div><label class="field"><span class="field-label">로그인 이메일</span><input readonly value="${esc(result.email)}"></label><label class="field"><span class="field-label">임시 비밀번호</span><input readonly id="issued-password" type="password" value="${esc(result.temporaryPassword)}"><span class="field-help">이 화면을 닫으면 다시 표시하지 않습니다. 비밀번호를 잊으면 접속 링크를 재발급할 수 있습니다.</span></label><div class="modal-footer"><button class="btn secondary" id="reveal-issued" type="button">비밀번호 보기</button><button class="btn primary" id="copy-issued" type="button">접속 정보 복사</button></div>`);
  $('#reveal-issued').onclick=e=>{const input=$('#issued-password');input.type=input.type==='password'?'text':'password';e.target.textContent=input.type==='password'?'비밀번호 보기':'비밀번호 숨기기';};
  $('#copy-issued').onclick=async()=>{try{await navigator.clipboard.writeText(`SLOPE 통합 운영관리\n${location.origin}/\n담당 역할: ${staffRoleLabel(result.role||'instructor')}\n이메일: ${result.email}\n임시 비밀번호: ${result.temporaryPassword}\n첫 로그인 후 새 비밀번호를 설정해 주세요.`);toast('접속 정보를 복사했습니다.');}catch{toast('복사 권한을 확인하거나 내용을 직접 선택해 주세요.');}};
}
async function resetAccount(userId) {
  if(ui.role!=='admin')return;
  try{const result=await accountAction('setup-link',{userId});await refreshWorkspace();showDialog('초기 접속 링크',`<div class="warning-box">${icon('link')}<span><strong>${esc(result.email)}</strong><br>한 번만 사용할 수 있는 비밀번호 설정 링크입니다. 해당 사용자에게 직접 전달해 주세요.</span></div><label class="field"><span class="field-label">초기 접속 링크</span><input id="setup-url" readonly value="${esc(result.setupUrl)}"></label><button class="btn primary" id="copy-setup">링크 복사</button>`);$('#copy-setup').onclick=async()=>{try{await navigator.clipboard.writeText(result.setupUrl);toast('초기 접속 링크를 복사했습니다.');}catch{$('#setup-url').select();toast('링크를 선택했습니다. 직접 복사해 주세요.');}};}catch(error){toast(error.message);}
}

onSessionChange(async(event,session)=>{
  if(event==='SIGNED_OUT'){state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};if(modal.open)modal.close();showLogin();}
  else if(event==='PASSWORD_RECOVERY'){passwordMode=true;showPassword();}
  else if(event==='SIGNED_IN'&&!passwordMode&&session?.user?.id&&state.profile?.user_id!==session.user.id){
    if(loadingWorkspace===authEpoch&&loadingUserId===session.user.id)return;
    authEpoch++;stopDriveUploads();setInstructorPrivacy(null);mainDirty=false;modalDirty=false;
    state={profile:null,roster:[],schedules:[],reservationChangeNotifications:[],settings:{...defaultSettings},outbox:[]};
    if(modal.open)modal.close();app.innerHTML='<div class="app-loading" role="status"><strong>SLOPE</strong><span>로그인 정보를 확인하고 있습니다…</span></div>';await startSession();
  }
});
setInterval(()=>{if(state.profile&&!document.hidden)syncWorkspace();},15000);
window.addEventListener('focus',()=>syncWorkspace());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncWorkspace();});
for(const event of ['click','auxclick'])document.addEventListener(event,guardUploadLink,true);
for(const event of ['input','change']){
  modal.addEventListener(event,e=>{if(e.target.closest('form'))modalDirty=true;});
  app.addEventListener(event,e=>{if(state.profile&&e.target.closest('form'))mainDirty=true;});
}
if(pageTitles[location.hash.slice(1)])ui.page=location.hash.slice(1);
boot();
