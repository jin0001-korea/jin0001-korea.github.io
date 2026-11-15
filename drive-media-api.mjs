import { supabase } from './auth-client.mjs?v=16';

/** Owner Drive credentials stay in the Edge Function; this sends the signed-in user's JWT only. */
export async function driveMediaAction(action, payload = {}, options = {}) {
  const { data, error } = await supabase.functions.invoke('slope-drive-media', {
    body: { ...payload, action },
    signal: options.signal,
  });
  if (error) {
    let body;
    try { body = await error.context?.json(); } catch {}
    const issue = new Error(body?.message || body?.error || 'Drive 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    issue.code = body?.code || body?.error || 'drive_request_failed';
    issue.status = error.context?.status;
    throw issue;
  }
  if (!data || data.error) throw new Error(data?.error || 'Drive 응답을 확인하지 못했습니다.');
  return data;
}

export function ownerAuthorizationUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.username || url.password) {
    throw new Error('Google 계정 연결 주소를 확인하지 못했습니다.');
  }
  return url.href;
}

export function driveShareUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || !url.pathname.startsWith('/drive/folders/') || url.username || url.password) {
    throw new Error('Drive 폴더 주소를 확인하지 못했습니다.');
  }
  return url.href;
}
