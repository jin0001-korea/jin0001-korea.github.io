import { currentSession, onSessionChange, renderAuthScreen, signOut, supabase } from '/auth-client.mjs';
import config from '/config.mjs';
import { bindFriendPanel, friendPanel } from './friend-match-view.mjs';

const root = document.getElementById('root');
const privateDetails = {
  orders: ['slope_friend_match_orders', 'p_request_id'],
  notices: ['slope_friend_match_delivery_status', 'p_request_id'],
  receipts: ['slope_friend_match_cash_receipts', 'p_request_id'],
  notes: ['slope_friend_match_booking_contacts', 'p_booking_id']
};
let generation = 0;
let operatorId = null;
let offset = 0;

function message(text) {
  root.replaceChildren();
  const main = document.createElement('main');
  main.className = 'fm-shell';
  const p = document.createElement('p');
  p.setAttribute('role', 'status'); p.textContent = text;
  const go = document.createElement('a');
  go.href = '/'; go.textContent = '통합 운영관리로 이동';
  main.append(p, go); root.append(main);
}
function login(mode = 'login') {
  renderAuthScreen(root, { mode, onAuthenticated: () => load(), onPasswordChanged: () => load() });
}
async function readAuthorization() {
  const auth = await currentSession();
  if (!auth) return { mode: 'login' };
  const { data, error } = await supabase.from('slope_members')
    .select('user_id,role,active,must_change_password').eq('user_id', auth.user.id).maybeSingle();
  if (error) throw new Error('직원 권한을 확인할 수 없습니다. 잠시 후 새로고침해 주세요.');
  if (!data || data.active !== true || !['admin','counselor'].includes(data.role)) return { mode: 'denied' };
  if (data.must_change_password !== false) return { mode: 'password' };
  return { mode: 'operator', id: auth.user.id };
}
async function readiness() {
  try {
    const res = await fetch(config.url + '/functions/v1/slope-friend-match', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      body: JSON.stringify({ action:'config' }), signal: AbortSignal.timeout(6000)
    });
    const data = await res.json();
    return res.ok && typeof data.enabled === 'boolean' ? data.enabled : null;
  } catch { return null; }
}
async function api(name, payload) {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) {
    if (['42501','PGRST301','PGRST303'].includes(error.code) || error.status === 401) {
      operatorId = null; ++generation; message('직원 권한 확인이 필요합니다. 통합 운영관리에서 로그인한 후 다시 열어 주세요.');
      throw new Error('직원 권한을 다시 확인해 주세요.');
    }
    throw new Error(/^[가-힣]/.test(error.message) ? error.message : '처리 결과를 확인하지 못했습니다. 다시 조회해 주세요.');
  }
  return data;
}
async function load() {
  const version=++generation;
  operatorId=null;
  message('직원 계정을 확인하고 있습니다.');
  try {
    const auth=await readAuthorization();
    if(version!==generation) return;
    if(auth.mode==='denied') return message('활성 관리자·상담사 계정으로 이용할 수 있습니다.');
    if(auth.mode!=='operator') return login(auth.mode);
    operatorId=auth.id;
    const current=()=>version===generation && operatorId===auth.id;
    const [rows,open]=await Promise.all([api('slope_friend_match_list',{p_offset:offset,p_limit:25}), readiness()]);
    if(!current()) return;
    root.innerHTML='<main class="fm-shell"><header class="fm-bar"><h1>Slope Desk</h1><nav class="fm-navlinks" aria-label="직원 메뉴"><a href="/">전체 관리</a><a href="/booking/#reservations">예약표</a><button type="button" class="btn secondary small" data-logout>로그아웃</button></nav></header><p class="fm-status" role="status"></p><div data-panel></div></main>';
    root.querySelector('.fm-status').textContent=open===true?'친구찾기 고객 신청이 열려 있습니다.':open===false?'친구찾기 신청·실결제 준비 중 · 토스페이와 알림톡 연결 후 열립니다.':'고객 신청 상태를 확인할 수 없습니다. 잠시 후 다시 조회해 주세요.';
    root.querySelector('[data-logout]').onclick=async()=>{ ++generation; operatorId=null; message('로그아웃 중입니다.'); try{await signOut();}finally{void load();} };
    const panel=root.querySelector('[data-panel]');
    panel.innerHTML=friendPanel({rows,offset});
    const ensure=async()=>{
      if(!current()) throw new Error('화면을 새로 열어 주세요.');
      const now=await readAuthorization();
      if(!current() || now.mode!=='operator' || now.id!==auth.id) { void load(); throw new Error('직원 권한을 다시 확인해 주세요.'); }
    };
    bindFriendPanel(panel,{
      current,
      page: async(key)=>{if(key==='prev')offset=Math.max(0,offset-25);if(key==='next')offset+=25;await load();},
      read: async(kind,id)=>{
        if(!Object.hasOwn(privateDetails,kind))throw new Error('조회 항목을 확인해 주세요.');
        await ensure();
        const [name,arg]=privateDetails[kind];
        return api(name,{[arg]:id});
      }
    });
  }catch(error){ if(version===generation){operatorId=null;message(error.message||'연결을 확인해 주세요.');} }
}
onSessionChange((event,session)=>{
  if(event==='SIGNED_OUT' || (operatorId && session?.user?.id!==operatorId)) {offset=0;void load();}
  else if(event==='SIGNED_IN' && !operatorId) void load();
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){++generation;operatorId=null;message('직원 계정을 확인하고 있습니다.');}
  else void load();
});
window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
void load();
