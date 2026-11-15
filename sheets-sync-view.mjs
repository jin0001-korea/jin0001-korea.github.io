const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SHEET_URL='https://docs.google.com/spreadsheets/d/163Yu9NKvikRpOiMV85ZH-SrY3BnoQ-e82_DRYgrITQQ/edit';
const reasons={API_NOT_ENABLED:'Google Sheets API 사용 설정이 필요합니다.',OAUTH_RECONNECT:'Google 계정을 다시 연결해 주세요.',GOOGLE_CONFIG_REQUIRED:'Google 연동 설정을 확인해 주세요.',GOOGLE_CLIENT_REJECTED:'Google 연동의 클라이언트 설정을 확인해 주세요.',SPREADSHEET_FORBIDDEN:'연결한 Google 계정의 시트 편집 권한을 확인해 주세요.',HEADER_MISMATCH:'시트의 열 제목이 변경되어 자동 기록을 멈췄습니다.',DUPLICATE_ID:'시트의 중복 예약 ID를 확인해 주세요.',COMPANY_MISSING:'강습업체가 없는 일정이 있습니다.',COMPANY_UNRESOLVED:'강습업체의 지점을 확인해야 합니다.',COMPANY_LOCATION_CONFLICT:'강습업체와 스키장 정보가 서로 다릅니다.'};
const date=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';
export function renderSheetsSync(status,{error='',compact=false}={}){
 let label='상태 확인 필요',detail=error?'기록 상태를 불러오지 못했습니다. 새로고침해 주세요.':'연결 상태를 확인하고 있습니다.',tone='warning';
 if(status){
  const failed=Number(status.failedCount)||0,pending=Number(status.pendingCount)||0;
  if(!status.enabled){label='연결 준비 중';detail='Google Sheets 연결을 준비하고 있습니다.';}
  else if(status.lastError){label='기록 재시도 대기';detail=reasons[status.lastError]||'자동 기록이 완료되지 않았습니다. 다음 주기에 다시 시도합니다.';}
  else if(failed){label=`확인 필요 ${failed}건`;detail='업체·스키장 등 예약 정보를 확인해야 하는 일정이 있습니다.';}
  else if(!status.lastSuccessAt){label='첫 기록 대기';detail='2분마다 예약관리의 최신 정보를 기록합니다.';}
  else{label=pending?`기록 대기 ${pending}건`:'자동 기록 중';detail=`마지막 확인 ${date(status.lastSuccessAt)} · 2분마다 갱신`;tone='success';}
 }
 const inner=`<div class="integration-copy"><strong>Google Sheets</strong><p>${escape(detail)}</p></div><span class="status-badge ${tone}">${escape(label)}</span>`;
 return compact?`<div class="sheet-sync-status" role="status">${inner}<a class="btn secondary small" href="${SHEET_URL}" target="_blank" rel="noopener noreferrer">기록 시트 열기</a></div>`:`<div class="integration-card">${inner}</div><p class="field-help">곤지암 / 비발디·지산 탭에 나누어 기록합니다. 예약 변경은 웹에서 처리하며 시트의 정산금·정산일은 보존합니다.</p><a class="btn secondary small" href="${SHEET_URL}" target="_blank" rel="noopener noreferrer">기록 시트 열기</a>`;
}
