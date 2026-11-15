import {supabase} from './auth-client.mjs?v=16';

export async function loadAdminGuide(profile,{signal}={}){
  if(profile?.role!=='admin'||profile.active!==true||profile.must_change_password!==false){
    throw Object.assign(new Error('관리자만 기능 안내를 확인할 수 있습니다.'),{code:'ADMIN_REQUIRED'});
  }
  const {data,error}=await supabase.functions.invoke('slope-admin-guide',{body:{},signal});
  if(error){
    let body;try{body=await error.context?.json();}catch{}
    throw Object.assign(new Error(body?.message||'기능 안내를 불러오지 못했습니다. 다시 시도해 주세요.'),{code:body?.error||'GUIDE_UNAVAILABLE'});
  }
  if(!data||typeof data.html!=='string'||!data.html||data.html.length>100000){
    throw new Error('기능 안내 응답을 확인하지 못했습니다.');
  }
  return {title:'기능 · 업무 안내',html:data.html};
}
