/** Keep email login intact; aliases are resolved privately by the login server. */
export async function signInWithIdentifier(client,identifier,password){
 const value=String(identifier||'').trim();
 if(value.includes('@'))return client.auth.signInWithPassword({email:value,password});
 const {data,error}=await client.functions.invoke('slope-login',{body:{username:value,password}});
 if(error){
  let detail;try{detail=await error.context?.json();}catch{}
  const code=['invalid_credentials','over_request_rate_limit','login_unavailable'].includes(detail?.code)?detail.code:'login_unavailable';
  return {data:null,error:{code,status:error.context?.status||503}};
 }
 if(typeof data?.access_token!=='string'||typeof data?.refresh_token!=='string')return {data:null,error:{code:'login_unavailable',status:503}};
 return client.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
}
