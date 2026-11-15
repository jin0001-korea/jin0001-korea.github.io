import {supabase} from './auth-client.mjs?v=16';

/** API secrets go only to the authenticated Edge handler; never retain them here. */
export async function solapiAction(action, payload = {}, {signal} = {}) {
  const delivery = action.startsWith('delivery-');
  const name = delivery ? 'slope-solapi-delivery' : 'slope-solapi';
  const actualAction = delivery ? action.slice('delivery-'.length) : action;
  const {data,error} = await supabase.functions.invoke(name, {body:{...payload,action:actualAction},signal});
  if (error) {
    let body;
    try {body=await error.context?.json();} catch {}
    const issue = new Error(body?.message || '알림톡 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    issue.code=body?.code || body?.error || 'SOLAPI_REQUEST_FAILED';
    issue.status=error.context?.status;
    throw issue;
  }
  if(!data || data.error)throw new Error(data?.message || '알림톡 서버 응답을 확인하지 못했습니다.');
  return data;
}
