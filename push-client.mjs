import {supabase} from './auth-client.mjs?v=16';
const unsupportedMessage=()=>typeof navigator!=='undefined'&&/iPad|iPhone|iPod/.test(navigator.userAgent)?'iPhone·iPad에서는 Safari에서 홈 화면에 추가한 웹앱으로 열어 알림을 켜 주세요.':'이 브라우저는 웹 푸시를 지원하지 않습니다. 지원하는 휴대폰·PC 브라우저에서 알림을 켜 주세요.';
const supported=()=>typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
function status(enabled=false,message=''){return{supported:supported(),enabled,permission:typeof Notification==='undefined'?'unsupported':Notification.permission,message};}
async function api(action,values={}){const{data,error}=await supabase.functions.invoke('slope-push',{body:{...values,action}});if(error||data?.error)throw new Error('브라우저 알림 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');return data;}
function serverKey(value){const bytes=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(bytes,c=>c.charCodeAt(0));}
async function registration(){await navigator.serviceWorker.register('/sw.js',{scope:'/'});return navigator.serviceWorker.ready;}
export async function getPushStatus(){
 if(!supported())return status(false,unsupportedMessage());
 if(Notification.permission==='denied')return status(false,'브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.');
 const worker=await navigator.serviceWorker.getRegistration('/');const sub=await worker?.pushManager.getSubscription();
 if(!sub)return status(false,'알림 받기를 켜면 웹을 닫아도 새 확인 요청을 받을 수 있습니다.');
 try{const result=await api('status',{endpoint:sub.endpoint});return status(result.enabled===true,result.enabled?'이 기기에서 새 강습 확인 알림을 받습니다.':'이 계정으로 알림 받기를 켜 주세요.');}
 catch{return status(false,'알림 연결 상태를 확인하지 못했습니다.');}
}
export async function enablePushNotifications(){
 if(!supported())return getPushStatus();
 const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
 if(permission!=='granted')return status(false,permission==='denied'?'브라우저 설정에서 알림을 허용해 주세요.':'알림 권한을 허용하면 이 기기로 알려드립니다.');
 let subscription;
 try{const{publicKey}=await api('public-key');if(!publicKey)throw new Error('Missing VAPID key');const worker=await registration();subscription=await worker.pushManager.getSubscription();if(!subscription)subscription=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:serverKey(publicKey)});await api('subscribe',{subscription:subscription.toJSON()});return status(true,'이 기기에서 새 강습 확인 알림을 받습니다.');}
 catch{return status(false,'알림 등록을 완료하지 못했습니다. 지원하는 브라우저와 알림 권한을 확인한 뒤 다시 시도해 주세요.');}
}
export async function disablePushNotifications(){
 if(!supported())return status(false,'이 브라우저는 웹 푸시를 지원하지 않습니다.');
 const worker=await navigator.serviceWorker.getRegistration('/'),sub=await worker?.pushManager.getSubscription();
 if(sub){let timer;try{await Promise.race([api('unsubscribe',{endpoint:sub.endpoint}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timeout')),4000);})]);}catch{/* Provider receives local unsubscribe even if app server is temporarily unavailable. */}finally{clearTimeout(timer);await sub.unsubscribe();}}
 return status(false,'이 기기의 알림을 껐습니다.');
}
