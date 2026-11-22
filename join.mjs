// 강사 셀프 가입(2026-11-22): 관리자가 전달한 설정 링크(?invite=토큰)에서
// ① 본인 이메일 입력 → ② Supabase 인증 메일의 링크 클릭(이메일 소유 확인) →
// ③ 비밀번호 직접 설정 → slope-accounts invite-claim 이 기존 계정에 이메일·비밀번호를 연결한다.
// 무료 플랜 제약: 인증 메일은 영문 기본 템플릿·시간당 발송 제한이 있다(화면 안내 포함).
import { supabase } from './auth-client.mjs?v=16';
import config from './config.mjs';

const root = document.getElementById('join');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const invite = new URL(location.href).searchParams.get('invite') || '';

function screen(body) {
  root.innerHTML = `<section class="join-card"><header><span class="join-brand">SLOPE</span><h1>강사 계정 설정</h1></header>${body}</section>`;
}
function fail(message) {
  screen(`<p class="join-error" role="alert">${esc(message)}</p><p class="join-help">관리자에게 새 설정 링크를 요청해 주세요.</p>`);
}
async function accounts(body, withSession = false) {
  const headers = { 'Content-Type': 'application/json', apikey: config.publishableKey };
  if (withSession) {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) throw new Error('이메일 인증이 만료되었습니다. 인증 메일을 다시 요청해 주세요.');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch('https://ewiekbmjvgktwsbbxrzw.supabase.co/functions/v1/slope-accounts', { method: 'POST', headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(typeof payload?.error === 'string' ? payload.error : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return payload;
}

/** 메일 링크 복귀: #access_token 해시를 세션으로 올린다(앱 전역은 detectSessionInUrl=false). */
async function adoptReturnSession() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('error_code')) {
    history.replaceState(null, '', location.pathname + location.search);
    throw new Error(params.get('error_code') === 'otp_expired' ? '인증 메일이 만료되었습니다. 이메일을 다시 입력해 인증 메일을 새로 받아 주세요.' : '이메일 인증에 실패했습니다. 다시 시도해 주세요.');
  }
  const accessToken = params.get('access_token'), refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw new Error('이메일 인증을 완료하지 못했습니다. 인증 메일을 다시 요청해 주세요.');
  return true;
}

function emailStep(info, noticeMessage = '') {
  screen(`<p class="join-help"><strong>${esc(info.name)}</strong> 님의 계정 설정입니다. 로그인에 사용할 본인 이메일을 입력하면 인증 메일을 보내 드립니다.</p>
  <form id="join-email-form"><label class="field"><span class="field-label">본인 이메일 *</span><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></label>
  <p class="join-error" data-join-error role="alert" ${noticeMessage ? '' : 'hidden'}>${esc(noticeMessage)}</p>
  <button class="btn primary" type="submit">인증 메일 받기</button></form>
  <p class="join-help">메일함에서 <strong>Sign in</strong> 링크(영문 메일)를 누르면 이 화면으로 돌아와 비밀번호를 설정합니다. 인증 메일은 발송량 제한이 있어 잠시 뒤 도착하거나 재시도가 필요할 수 있습니다.</p>`);
  const form = document.getElementById('join-email-form');
  form.onsubmit = async event => {
    event.preventDefault();
    const errorBox = form.querySelector('[data-join-error]'), button = form.querySelector('button');
    errorBox.hidden = true; button.disabled = true;
    try {
      const email = new FormData(form).get('email');
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/join.html?invite=${encodeURIComponent(invite)}` } });
      if (error) throw new Error(['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code) || error.status === 429 ? '인증 메일 발송량 제한에 걸렸습니다. 1시간쯤 뒤 다시 시도해 주세요.' : '인증 메일을 보내지 못했습니다. 이메일 주소를 확인해 주세요.');
      screen(`<p class="join-help"><strong>${esc(email)}</strong> 주소로 인증 메일을 보냈습니다.</p><p class="join-help">메일함(스팸함 포함)에서 <strong>Sign in</strong> 링크를 눌러 주세요. 누르면 이 화면으로 돌아와 비밀번호를 설정합니다.</p>`);
    } catch (issue) { errorBox.textContent = issue.message; errorBox.hidden = false; button.disabled = false; }
  };
}

function passwordStep(info, email) {
  screen(`<p class="join-help"><strong>${esc(email)}</strong> 인증이 완료되었습니다. <strong>${esc(info.name)}</strong> 님 계정에서 사용할 비밀번호를 정해 주세요.</p>
  <form id="join-password-form">
  <label class="field"><span class="field-label">새 비밀번호 (12자 이상) *</span><input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
  <label class="field"><span class="field-label">비밀번호 확인 *</span><input name="confirm" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
  <p class="join-error" data-join-error role="alert" hidden></p>
  <button class="btn primary" type="submit">비밀번호 설정하고 계정 연결</button></form>`);
  const form = document.getElementById('join-password-form');
  form.onsubmit = async event => {
    event.preventDefault();
    const errorBox = form.querySelector('[data-join-error]'), button = form.querySelector('button');
    const data = new FormData(form);
    if (data.get('password') !== data.get('confirm')) { errorBox.textContent = '두 비밀번호가 서로 다릅니다.'; errorBox.hidden = false; return; }
    errorBox.hidden = true; button.disabled = true;
    try {
      const result = await accounts({ action: 'invite-claim', invite, password: data.get('password') }, true);
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* 임시 인증 유저는 서버에서 이미 정리됨 */ }
      screen(`<p class="join-done">✔ 계정 설정이 끝났습니다.</p><p class="join-help"><strong>${esc(result.name)}</strong> 님은 이제 <strong>${esc(result.email)}</strong> 이메일과 방금 설정한 비밀번호로 로그인할 수 있습니다.</p><a class="btn primary" href="/">로그인 화면으로 이동</a>`);
    } catch (issue) { errorBox.textContent = issue.message; errorBox.hidden = false; button.disabled = false; }
  };
}

(async () => {
  if (!invite) { fail('설정 링크 주소가 올바르지 않습니다.'); return; }
  screen('<p class="join-help">설정 링크를 확인하고 있습니다…</p>');
  let returned = false, adoptNotice = '';
  try { returned = await adoptReturnSession(); } catch (issue) { adoptNotice = issue.message; }
  try {
    const info = await accounts({ action: 'invite-info', invite });
    if (returned) {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) { passwordStep(info, data.user.email); return; }
    }
    emailStep(info, adoptNotice);
  } catch (issue) { fail(issue.message || '설정 링크를 확인하지 못했습니다.'); }
})();
