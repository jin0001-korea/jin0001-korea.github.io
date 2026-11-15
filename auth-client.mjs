import { createClient } from './vendor/supabase.mjs';
import config from './config.mjs';
import {signInWithIdentifier} from './login-client.mjs?v=10';

/** The publishable key identifies this app; all access is enforced by RLS. */
export const supabase = createClient(config.url, config.publishableKey, {
  global: { fetch: (input, options) => fetch(input, { ...options, cache: 'no-store' }) },
  auth: {
    storageKey: 'slope-auth-ewiekbmjvgktwsbbxrzw',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const mountainIcon = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 26 16 6l13 20H3Zm7-11 6 4 5-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const shieldIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function authMessage(error, mode = 'login') {
  const code = String(error?.code || '');
  if (['invalid_credentials', 'invalid_grant'].includes(code)) return '아이디 또는 이메일과 비밀번호를 확인해 주세요.';
  if (code === 'email_not_confirmed') return '계정 인증이 완료되지 않았습니다. 관리자에게 문의해 주세요.';
  if (['over_request_rate_limit', 'over_email_send_rate_limit'].includes(code) || error?.status === 429) return '요청이 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.';
  if (['user_banned', 'user_not_found'].includes(code)) return '사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.';
  if (code === 'same_password') return '현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.';
  if (code === 'weak_password') return '더 안전한 비밀번호를 사용해 주세요. 12자 이상으로 설정해 주세요.';
  if (['session_not_found', 'refresh_token_not_found', 'otp_expired'].includes(code)) return '인증 시간이 만료되었습니다. 다시 로그인하거나 관리자에게 새 접속 링크를 요청해 주세요.';
  if (error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) return '로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  return mode === 'password' ? '비밀번호 설정을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '로그인하지 못했습니다. 계정 정보를 확인하거나 잠시 후 다시 시도해 주세요.';
}

/** Read stored session, then validate the user against Supabase Auth. */
export async function currentSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(authMessage(sessionError));
  const session = sessionData?.session;
  if (!session) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if ([401, 403].includes(error.status) || ['session_not_found', 'refresh_token_not_found', 'user_not_found', 'bad_jwt'].includes(error.code)) {
      await supabase.auth.signOut({ scope: 'local' });
      return null;
    }
    throw new Error(authMessage(error));
  }
  if (!data?.user) return null;
  return { session, user: data.user };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('로그아웃하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
}

/** Keep application work outside Supabase's synchronous auth callback. */
export function onSessionChange(callback) {
  let active = true;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (!active) return;
      Promise.resolve(callback(event, session)).catch(() => {
        // The application owns its loading/error screen; never log auth data.
      });
    }, 0);
  });
  return () => { active = false; data.subscription.unsubscribe(); };
}

/** Consume the one-time administrator setup link without an email redirect. */
export async function consumeSetupLink() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('setup_token');
  if (!token) return null;
  url.searchParams.delete('setup_token');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' });
  if (error || !data?.session) throw new Error('초기 접속 링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 접속 링크를 요청해 주세요.');
  return data.session;
}

function landscape() {
  return `<svg class="auth-landscape" viewBox="0 0 640 330" fill="none" aria-hidden="true"><circle cx="499" cy="73" r="39" fill="#d2eea4"/><path d="m-30 330 170-226 111 122 96-120 258 224" fill="#2e6268"/><path d="M74 330 291 35l249 295H74Z" fill="#d7e9e6"/><path d="m230 117 61-82 68 81-40-17-31 24-30-25-28 19Z" fill="#fff"/><path d="m291 35 249 295H262l29-295Z" fill="#91b8b6"/><path d="m-14 330 143-124 134 124M382 330l140-160 130 160" fill="#173f46"/><path d="M352 160c-83 34-70 60-8 72s79 62 27 98" stroke="#f1f7ed" stroke-width="4" stroke-linecap="round" stroke-dasharray="5 9"/><path d="m92 233 11-18 11 18m-11-10v64M527 152l11-18 11 18m-11-10v63" stroke="#d2eea4" stroke-width="2" stroke-linecap="round"/></svg>`;
}

/** Render/bind the email-password login or first-password setup screen. */
export function renderAuthScreen(root, options = {}) {
  const mode = options.mode === 'password' ? 'password' : 'login';
  const settingPassword = mode === 'password';
  root.innerHTML = `<main class="auth-page"><aside class="auth-story"><div class="auth-brand"><span>${mountainIcon}</span><div>SLOPE<small>통합 운영관리</small></div></div><div class="auth-story-copy"><span class="auth-eyebrow">EVERY LESSON MATTERS</span><h1>좋은 강습을 만드는<br>모든 순간을 연결합니다.</h1><p>예약 접수부터 강사 배정, 강습 기록까지.<br>한곳에서 확인하고 기록하세요.</p><div class="auth-story-points"><span>${shieldIcon}계정별로 안전하게 관리</span><span>관리자 · 상담사 · 강사별 업무 화면</span></div></div>${landscape()}<div class="auth-story-footer"><span>26 / 27 WINTER SEASON</span><span>SLOPE © 2026</span></div></aside><section class="auth-main"><div class="auth-mobile-brand">${mountainIcon}<strong>SLOPE</strong><span>통합 운영관리</span></div><div class="auth-card"><div class="auth-heading-mark">${shieldIcon}</div><span class="auth-eyebrow">${settingPassword ? 'SET YOUR PASSWORD' : 'WELCOME TO SLOPE'}</span><h2>${settingPassword ? '비밀번호를 설정해 주세요.' : '로그인'}</h2><p class="auth-description">${settingPassword ? '본인만 아는 새 비밀번호를 설정하면<br>담당 업무를 시작할 수 있습니다.' : '발급받은 계정으로 로그인해 주세요.<br>담당 업무에 맞는 화면으로 연결됩니다.'}</p><form class="auth-form" novalidate><div class="auth-error" role="alert" aria-live="assertive" ${options.error ? '' : 'hidden'}>${escapeHTML(options.error || '')}</div>${settingPassword ? '' : '<label class="auth-field"><span>아이디 또는 이메일</span><input name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" placeholder="아이디 또는 이메일을 입력해 주세요" required></label>'}<label class="auth-field"><span>${settingPassword ? '새 비밀번호' : '비밀번호'}</span><div class="auth-password-wrap"><input name="password" type="password" autocomplete="${settingPassword ? 'new-password' : 'current-password'}" ${settingPassword ? 'minlength="12"' : ''} maxlength="128" placeholder="${settingPassword ? '12자 이상의 새 비밀번호' : '비밀번호를 입력해 주세요'}" required><button class="auth-reveal" type="button" aria-label="비밀번호 표시" aria-pressed="false">보기</button></div></label>${settingPassword ? '<label class="auth-field"><span>새 비밀번호 확인</span><input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" placeholder="새 비밀번호를 한 번 더 입력해 주세요" required></label><p class="auth-password-help">다른 서비스에서 사용하지 않는 12자 이상의 비밀번호를 사용해 주세요.</p>' : ''}<button class="auth-submit" type="submit"><span>${settingPassword ? '비밀번호 설정하고 시작하기' : '로그인하기'}</span>${arrowIcon}</button></form>${settingPassword ? '<button type="button" class="auth-logout">다른 계정으로 로그인</button>' : '<div class="auth-account-help"><strong>계정은 관리자에게 발급받아 주세요.</strong><p>계정 발급·비밀번호 초기화는 관리자에게 문의해 주세요.</p></div>'}<div class="auth-security-note">${shieldIcon}<span>관리자는 전체 운영, 상담사는 예약 업무, 강사는 본인 강습을 확인합니다.</span></div></div><p class="auth-main-footer">모든 강습의 시작과 끝, SLOPE</p></section></main>`;

  const form = root.querySelector('.auth-form');
  const errorBox = form.querySelector('.auth-error');
  const submit = form.querySelector('[type="submit"]');
  const password = form.elements.namedItem('password');
  let inFlight = false;

  const showError = message => {
    if (!form.isConnected) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  };
  const busy = value => {
    inFlight = value;
    submit.disabled = value;
    form.setAttribute('aria-busy', String(value));
    submit.querySelector('span').textContent = value ? (settingPassword ? '비밀번호 설정 중…' : '로그인 중…') : (settingPassword ? '비밀번호 설정하고 시작하기' : '로그인하기');
    for (const control of form.elements) {
      if (control !== submit) control.disabled = value;
    }
  };

  form.querySelector('.auth-reveal').addEventListener('click', event => {
    const showing = password.type === 'password';
    password.type = showing ? 'text' : 'password';
    event.currentTarget.textContent = showing ? '숨기기' : '보기';
    event.currentTarget.setAttribute('aria-label', showing ? '비밀번호 숨기기' : '비밀번호 표시');
    event.currentTarget.setAttribute('aria-pressed', String(showing));
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (inFlight) return;
    errorBox.hidden = true;
    const secret = password.value;
    const email = settingPassword ? '' : form.elements.namedItem('email').value.trim();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (settingPassword && secret.length < 12) { showError('비밀번호를 12자 이상으로 입력해 주세요.'); password.focus(); return; }
    if (settingPassword && secret !== form.elements.namedItem('confirmation').value) { showError('입력한 두 비밀번호가 일치하지 않습니다.'); form.elements.namedItem('confirmation').focus(); return; }
    busy(true);
    let passwordUpdated = false;
    try {
      if (settingPassword) {
        const { data: account } = await supabase.auth.getUser();
        const { data: stored } = await supabase.auth.getSession();
        const accountEmail = account?.user?.email || stored?.session?.user?.email;
        if (!accountEmail) throw new Error('Missing authenticated account');
        const { error } = await supabase.functions.invoke('slope-accounts', {
          body: { action: 'set-password', password: secret },
        });
        if (error) throw error;
        passwordUpdated = true;
        const { data: fresh, error: loginError } = await supabase.auth.signInWithPassword({ email: accountEmail, password: secret });
        if (loginError) throw loginError;
        if (!fresh?.session) throw new Error('Missing authenticated session');
        password.value = '';
        form.elements.namedItem('confirmation').value = '';
        await options.onPasswordChanged?.(fresh.session);
      } else {
        const { data, error } = await signInWithIdentifier(supabase, email, secret);
        password.value = '';
        if (error) throw error;
        if (!data?.session) throw new Error('Missing authenticated session');
        await options.onAuthenticated?.(data.session);
      }
    } catch (error) {
      password.value = '';
      if (settingPassword) form.elements.namedItem('confirmation').value = '';
      showError(settingPassword && passwordUpdated ? '비밀번호는 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.' : authMessage(error, mode));
      if (form.isConnected) password.focus();
    } finally {
      busy(false);
    }
  });

  root.querySelector('.auth-logout')?.addEventListener('click', async event => {
    if (inFlight) return;
    event.currentTarget.disabled = true;
    try {
      await signOut();
      await options.onAuthenticated?.(null);
      if (form.isConnected) renderAuthScreen(root, { ...options, mode: 'login', error: undefined });
    } catch (error) {
      showError(error.message);
      event.currentTarget.disabled = false;
    }
  });

  queueMicrotask(() => {
    if (!form.isConnected) return;
    (settingPassword ? password : form.elements.namedItem('email')).focus({ preventScroll: true });
  });
}
