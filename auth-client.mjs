import { createClient } from './vendor/supabase.mjs';
import config from './config.mjs';
import {signInWithIdentifier} from './login-client.mjs?v=13';
import {bookingStorageKey} from './booking-access.mjs?v=27';

// The bundled booking section shares the root login; the legacy site keeps its session.
export const supabase = createClient(config.url, config.publishableKey, {
  global: { fetch: (input, options) => fetch(input, { ...options, cache: 'no-store' }) },
  auth: {
    storageKey: bookingStorageKey(),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const authIssue = error => {
  const issue = new Error(error?.name === 'AuthRetryableFetchError' || error instanceof TypeError
    ? '로그인 서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.'
    : '로그인 시간이 만료되었습니다. 운영 계정으로 다시 로그인해 주세요.');
  issue.code = error?.code || 'AUTH_REQUIRED';
  return issue;
};

/** Restore a session and validate its user with the server, never JWT metadata. */
export async function currentSession() {
  const stored = await supabase.auth.getSession();
  if (stored.error) throw authIssue(stored.error);
  if (!stored.data?.session) return null;
  const account = await supabase.auth.getUser();
  if (account.error) {
    if ([401, 403].includes(account.error.status)) {
      await supabase.auth.signOut({ scope: 'local' });
      return null;
    }
    throw authIssue(account.error);
  }
  return account.data?.user ? { session: stored.data.session, user: account.data.user } : null;
}

/** Clears this origin's session, including the root app when bundled. */
export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw authIssue(error);
}

/** Application requests run after the synchronous auth callback has returned. */
export function onSessionChange(callback) {
  let active = true;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (active) Promise.resolve(callback(event, session)).catch(() => {});
    }, 0);
  });
  return () => { active = false; data.subscription.unsubscribe(); };
}

/** Alias login preserves the same Auth identity and database permissions. */
export const signIn = (identifier,password) => signInWithIdentifier(supabase,identifier,password);
