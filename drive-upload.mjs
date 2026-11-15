/** Foreground, resumable uploads. File bytes and Google capability URLs stay in memory. */
export const DRIVE_UPLOAD_CHUNK_SIZE=8*1024*1024;
export const DRIVE_UPLOAD_MAX_FILE_SIZE=5*1024*1024*1024;
const SAMPLE_SIZE=1024*1024,STORAGE_VERSION=1,MAX_ATTEMPTS=4;
const controllersRunning=new Map();
const clean=value=>String(value??'').trim();
const identifier=value=>/^[A-Za-z0-9_-]{1,200}$/.test(clean(value))?clean(value):null;
const nonnegative=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const abortError=()=>Object.assign(new Error('업로드를 일시정지했습니다.'),{name:'AbortError'});
const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
const fault=(message,code,status)=>Object.assign(new Error(message),{code,status});
const mediaExtensions={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',avif:'image/avif',mov:'video/quicktime',mp4:'video/mp4',m4v:'video/x-m4v',webm:'video/webm',avi:'video/x-msvideo','3gp':'video/3gpp','3g2':'video/3gpp2'};
const mimeOf=file=>{
  const provided=clean(file?.type||file?.mimeType).toLowerCase();
  if(provided)return provided;
  const extension=/\.([a-z0-9]+)$/i.exec(clean(file?.name))?.[1]?.toLowerCase();
  return mediaExtensions[extension]||'';
};
const isMedia=mime=>/^(image|video)\/[a-z0-9.+_-]+$/i.test(mime);
const uuid=()=>globalThis.crypto.randomUUID();
const fileFacts=file=>({name:clean(file?.name),size:Number(file?.size),mimeType:mimeOf(file),lastModified:nonnegative(file?.lastModified)??0});

export function validateDriveFile(file){
  const facts=fileFacts(file);
  if(!facts.name||facts.name.length>240||/[\u0000-\u001f\u007f]/.test(String(file?.name||'')))return '파일 이름을 확인해 주세요.';
  if(!isMedia(facts.mimeType))return '사진 또는 동영상 파일만 선택해 주세요.';
  if(!Number.isSafeInteger(facts.size)||facts.size<=0)return '내용이 있는 사진·동영상 파일을 선택해 주세요.';
  if(facts.size>DRIVE_UPLOAD_MAX_FILE_SIZE)return '파일 하나의 크기는 5GB 이하로 선택해 주세요.';
  if(typeof file?.slice!=='function')return '이 파일을 읽을 수 없습니다. 원본 파일을 다시 선택해 주세요.';
  return null;
}

/** A bounded first/middle/last sample plus exact metadata identifies a reselected original. */
export async function fingerprintDriveFile(file,{cryptoImpl=globalThis.crypto}={}){
  const error=validateDriveFile(file);if(error)throw fault(error,'INVALID_FILE');
  const facts=fileFacts(file),offsets=[...new Set([0,Math.max(0,Math.floor((facts.size-SAMPLE_SIZE)/2)),Math.max(0,facts.size-SAMPLE_SIZE)])];
  const header=new TextEncoder().encode(JSON.stringify({version:'sample-sha256-v1',...facts,offsets})+'\n');
  const parts=await Promise.all(offsets.map(offset=>file.slice(offset,Math.min(facts.size,offset+SAMPLE_SIZE)).arrayBuffer()));
  const bytes=new Uint8Array(header.byteLength+parts.reduce((sum,part)=>sum+part.byteLength,0));bytes.set(header);let position=header.byteLength;
  for(const part of parts){bytes.set(new Uint8Array(part),position);position+=part.byteLength;}
  const digest=await cryptoImpl.subtle.digest('SHA-256',bytes);
  return `sample-sha256-v1:${[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}`;
}

function sessionURL(value){
  let url;try{url=new URL(value);}catch{throw fault('업로드 연결 주소를 확인하지 못했습니다.','INVALID_SESSION');}
  if(url.protocol!=='https:'||url.hostname!=='www.googleapis.com'||url.port||url.username||url.password||url.hash||!/^\/upload\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(url.pathname)||url.searchParams.get('uploadType')!=='resumable'||!url.searchParams.get('upload_id'))throw fault('허용되지 않은 업로드 연결 주소입니다.','INVALID_SESSION');
  return url.href;
}
function confirmedOffset(response,size){
  const value=response.headers?.get?.('Range');if(!value)return 0;
  const match=/^bytes=0-(\d+)$/i.exec(value.trim()),offset=match?Number(match[1])+1:NaN;
  if(!Number.isSafeInteger(offset)||offset<0||offset>size)throw fault('서버가 확인한 업로드 위치가 올바르지 않습니다.','INVALID_RANGE');
  return offset;
}
function isTransient(error){
  const status=Number(error?.status||error?.statusCode);
  return status===429||status>=500&&status<=599||error instanceof TypeError||error?.network===true||error?.code==='NETWORK_ERROR'||error?.code==='REQUEST_TIMEOUT'||!status&&error?.code==='drive_request_failed';
}
const networkFailure=error=>!Number(error?.status||error?.statusCode)&&(error instanceof TypeError||error?.network===true||['NETWORK_ERROR','drive_request_failed'].includes(error?.code));
function networkFault(stage){
  const messages={
    UPLOAD_PREPARE_NETWORK:'업로드 준비 서버에 연결하지 못했습니다. 다시 시도해 주세요.',
    DRIVE_STATUS_NETWORK:'Google Drive의 업로드 진행 상태를 확인하지 못했습니다. 다시 시도해 주세요. 계속 실패하면 관리자에게 알려 주세요.',
    DRIVE_TRANSFER_NETWORK:'Google Drive로 사진·영상을 전송하는 연결이 끊겼습니다. 다시 시도하면 저장된 부분부터 확인합니다.',
    UPLOAD_VERIFY_NETWORK:'파일 전송 후 저장 결과를 확인하지 못했습니다. 다시 시도를 눌러 완료 여부를 확인해 주세요.',
  };
  return Object.assign(fault(messages[stage],stage),{network:true});
}
function safeMessage(error){
  const message=clean(error?.message);
  if(!message||/https?:\/\/|upload_id|access_token|authorization|bearer/i.test(message))return '업로드 연결이 끊겼습니다. 다시 시도해 주세요.';
  return /[가-힣]/u.test(message)?message:'업로드를 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.';
}
function defaultSleep(milliseconds,signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(abortError());return;}
    const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(finish,milliseconds);
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(abortError());};
    signal?.addEventListener('abort',abort,{once:true});
  });
}
function defaultStorage(){try{return globalThis.localStorage;}catch{return null;}}
const persistable=item=>({id:item.id,uploadId:item.uploadId||null,fileId:item.fileId||null,name:item.name,size:item.size,mimeType:item.mimeType,lastModified:item.lastModified,fingerprint:item.fingerprint,status:item.status==='completed'?'completed':'paused',uploadedBytes:item.uploadedBytes||0});

/** service(action,payload,{signal}) handles the application's authenticated Edge calls. */
export function createDriveUploadController({userId,scheduleId,instructorId=null,service,fetchImpl=globalThis.fetch,storage=defaultStorage(),onChange,onError,sleep=defaultSleep,requestTimeoutMs=60000,cryptoImpl=globalThis.crypto}={}){
  if(!clean(userId)||!clean(scheduleId)||typeof service!=='function'||typeof fetchImpl!=='function')throw new Error('업로드 사용자·강습 일정·연결 설정을 확인해 주세요.');
  const scope={userId:clean(userId),scheduleId:clean(scheduleId),instructorId:clean(instructorId)||null};
  const key=`slope-drive-uploads:v${STORAGE_VERSION}:${encodeURIComponent(JSON.stringify(scope))}`;
  const items=[],files=new Map(),sessions=new Map(),listeners=new Set();
  let disposed=false,running=null,currentId=null,activeAbort=null,paused=false,selecting=Promise.resolve();
  if(typeof onChange==='function')listeners.add(onChange);
  try{
    const stored=JSON.parse(storage?.getItem(key)||'null');
    if(stored?.version===STORAGE_VERSION&&JSON.stringify(stored.scope)===JSON.stringify(scope)&&Array.isArray(stored.items)){
      const seen=new Set();
      for(const row of stored.items.slice(0,1000)){
        if(!/^[0-9a-f-]{36}$/i.test(row?.id||'')||seen.has(row.id)||!/^sample-sha256-v1:[0-9a-f]{64}$/.test(row?.fingerprint||''))continue;
        const size=nonnegative(row.size);if(size===null||size<=0||size>DRIVE_UPLOAD_MAX_FILE_SIZE||!isMedia(row.mimeType)||typeof row.name!=='string'||!row.name||row.name.length>240||/[\u0000-\u001f\u007f]/.test(row.name))continue;
        seen.add(row.id);const completed=row.status==='completed'&&!!identifier(row.uploadId)&&!!identifier(row.fileId);
        items.push({id:row.id,uploadId:identifier(row.uploadId),fileId:identifier(row.fileId),name:row.name,size,mimeType:row.mimeType,lastModified:nonnegative(row.lastModified)??0,fingerprint:row.fingerprint,status:completed?'completed':'needs-file',uploadedBytes:completed?size:Math.min(size,nonnegative(row.uploadedBytes)||0),error:null});
      }
    }
  }catch{/* Storage can be unavailable or contain an older invalid snapshot. */}
  const snapshot=()=>{
    const visible=items.map(item=>({...persistable(item),status:item.status,error:item.error||null,needsFile:item.status!=='completed'&&!files.has(item.id),progress:Math.min(100,Math.round((item.uploadedBytes||0)/item.size*10000)/100)}));
    return {...scope,items:visible,running:!!running,paused,count:visible.length,completed:visible.filter(item=>item.status==='completed').length,totalBytes:visible.reduce((sum,item)=>sum+item.size,0),uploadedBytes:visible.reduce((sum,item)=>sum+item.uploadedBytes,0)};
  };
  const persist=()=>{try{storage?.setItem(key,JSON.stringify({version:STORAGE_VERSION,scope,items:items.map(persistable)}));}catch{/* Uploads remain usable in this open page. */}};
  const emit=()=>{if(disposed)return;persist();const state=snapshot();for(const listener of listeners){try{listener(state);}catch{/* A view cannot interrupt an upload. */}}};
  const ensureLive=()=>{if(disposed)throw fault('업로드 창을 다시 열어 주세요.','DISPOSED');};
  const checkLive=signal=>{ensureLive();checkAbort(signal);};
  const wait=async(attempt,signal,response)=>{
    const after=response?.headers?.get?.('Retry-After'),seconds=after&&Number(after);
    const milliseconds=Number.isFinite(seconds)&&seconds>=0?Math.min(30000,seconds*1000):Math.min(8000,500*2**attempt);
    await sleep(milliseconds,signal);checkLive(signal);
  };
  const api=async(action,payload,signal)=>{
    for(let attempt=0;;attempt++){
      checkLive(signal);
      try{return await service(action,payload,{signal});}
      catch(error){checkLive(signal);if(!isTransient(error)||attempt>=MAX_ATTEMPTS-1)throw networkFailure(error)?networkFault(action==='upload-complete'?'UPLOAD_VERIFY_NETWORK':'UPLOAD_PREPARE_NETWORK'):error;await wait(attempt,signal);}
    }
  };
  const request=async(url,range,body,signal)=>{
    checkLive(signal);const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},requestTimeoutMs);
    // Some Fetch implementations reject 308 Resume Incomplete with redirect:error.
    // Its 308 has no Location header, so follow exposes the confirmation Range.
    try{const response=await fetchImpl(sessionURL(url),{method:'PUT',headers:{'Content-Type':body?.type||'application/octet-stream','Content-Range':range},body:body||new Blob([]),signal:controller.signal,credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer'});if(response.url)sessionURL(response.url);return response;}
    catch(error){checkLive(signal);if(timedOut)throw fault('업로드 연결 응답 시간이 초과되었습니다.','REQUEST_TIMEOUT');throw networkFailure(error)?networkFault(range.startsWith('bytes */')?'DRIVE_STATUS_NETWORK':'DRIVE_TRANSFER_NETWORK'):error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
  const applyCompletion=(item,result)=>{
    const completed=result?.alreadyComplete===true||result?.status==='completed'||result?.file?.status==='completed'||result?.file?.status==='complete';
    if(!completed)return false;
    const responseId=identifier(result.uploadId||result.file?.uploadId),fileId=identifier(result.driveFileId||result.fileId||result.file?.driveFileId||result.file?.fileId||item.fileId);
    if(responseId&&item.uploadId&&responseId!==item.uploadId)throw fault('업로드 완료 대상이 일치하지 않습니다.','COMPLETION_MISMATCH');
    if(item.fileId&&fileId&&fileId!==item.fileId)throw fault('완료 확인된 파일이 업로드 대상과 다릅니다.','COMPLETION_MISMATCH');
    if(!fileId)throw fault('파일 저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.','UNCONFIRMED');
    item.uploadId=responseId||item.uploadId;item.fileId=fileId;item.status='completed';item.uploadedBytes=item.size;item.error=null;sessions.delete(item.id);files.delete(item.id);emit();return true;
  };
  const acceptSession=(item,result)=>{
    if(!result||typeof result!=='object')throw fault('업로드 연결 응답을 확인하지 못했습니다.','INVALID_SESSION');
    const responseId=identifier(result.uploadId);if(!responseId||item.uploadId&&responseId!==item.uploadId)throw fault('업로드 연결 대상이 일치하지 않습니다.','INVALID_SESSION');
    const fileId=identifier(result.driveFileId||result.fileId||result.file?.fileId);
    if(item.fileId&&fileId&&item.fileId!==fileId)throw fault('다시 연결한 파일이 원래 업로드 대상과 다릅니다.','COMPLETION_MISMATCH');
    item.uploadId=responseId;item.fileId=fileId||item.fileId;
    if(applyCompletion(item,result))return true;
    sessions.set(item.id,sessionURL(result.sessionUrl));emit();return false;
  };
  const probe=async(item,signal)=>{
    for(let attempt=0;;attempt++){
      try{
        const response=await request(sessions.get(item.id),`bytes */${item.size}`,null,signal);checkLive(signal);
        if(response.status===308)return {offset:confirmedOffset(response,item.size),complete:false};
        if([200,201].includes(response.status))return {offset:item.size,complete:true};
        if([404,410].includes(response.status))return {expired:true};
        if(response.status===429||response.status>=500){if(attempt>=MAX_ATTEMPTS-1)throw fault('업로드 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.','RETRY_EXHAUSTED',response.status);await wait(attempt,signal,response);continue;}
        throw fault(`업로드 진행 상태를 확인하지 못했습니다. (${response.status})`,'GOOGLE_REJECTED',response.status);
      }catch(error){checkLive(signal);if(!isTransient(error)||error.code==='RETRY_EXHAUSTED'||attempt>=MAX_ATTEMPTS-1)throw error;await wait(attempt,signal);}
    }
  };
  const verify=async(item,signal)=>{
    item.status='verifying';item.uploadedBytes=item.size;emit();
    const result=await api('upload-complete',{uploadId:item.uploadId},signal);checkLive(signal);
    if(!applyCompletion(item,result))throw fault('파일 전송은 끝났지만 저장 확인을 받지 못했습니다. 다시 시도해 주세요.','UNCONFIRMED');
  };
  const upload=async(item,signal)=>{
    item.status='preparing';item.error=null;emit();
    const result=await api(item.uploadId?'upload-resume':'upload-start',item.uploadId?{uploadId:item.uploadId}:{scheduleId:scope.scheduleId,...(scope.instructorId?{instructorId:scope.instructorId}:{}),file:{id:item.id,name:item.name,size:item.size,mimeType:item.mimeType,lastModified:item.lastModified,fingerprint:item.fingerprint}},signal);
    checkLive(signal);if(acceptSession(item,result))return;
    let restarts=0,failures=0,position=await probe(item,signal);
    const restart=async()=>{
      if(restarts++>=1)throw fault('업로드 연결이 만료되었습니다. 다시 시도해 주세요.','SESSION_EXPIRED');
      const resumed=await api('upload-resume',{uploadId:item.uploadId,restart:true},signal);checkLive(signal);
      if(acceptSession(item,resumed))return {completed:true};return probe(item,signal);
    };
    for(;;){
      checkLive(signal);
      if(position.expired){position=await restart();continue;}
      if(position.completed)return;
      item.uploadedBytes=position.offset;emit();
      if(position.complete){await verify(item,signal);return;}
      const file=files.get(item.id);
      if(!file){item.status='needs-file';item.error=null;emit();return;}
      if(position.offset>=item.size){await verify(item,signal);return;}
      item.status='uploading';emit();const start=position.offset,end=Math.min(item.size,start+DRIVE_UPLOAD_CHUNK_SIZE),chunk=file.slice(start,end,item.mimeType);
      let response,requestError;
      try{
        response=await request(sessions.get(item.id),`bytes ${start}-${end-1}/${item.size}`,chunk,signal);checkLive(signal);
        // Final application verification has its own retry limit; its failure must
        // never fall into the chunk-transfer retry path and resend accepted bytes.
        if([200,201].includes(response.status)){position={offset:item.size,complete:true};continue;}
        if(response.status===308){
          const offset=confirmedOffset(response,item.size);
          if(offset<start||offset>end)throw fault('서버의 업로드 확인 위치가 예상 범위를 벗어났습니다.','INVALID_RANGE');
          if(offset>start){failures=0;position={offset,complete:false};continue;}
        }else if([404,410].includes(response.status)){position={expired:true};continue;}
        else if(response.status!==429&&response.status<500)throw fault(`파일을 전송하지 못했습니다. (${response.status})`,'GOOGLE_REJECTED',response.status);
      }catch(error){checkLive(signal);if(!isTransient(error))throw error;requestError=error;}
      if(failures++>=MAX_ATTEMPTS-1)throw requestError||fault('연결이 불안정해 업로드를 멈췄습니다. 다시 시도해 주세요.','RETRY_EXHAUSTED');
      await wait(failures-1,signal,response);
      // A lost response can follow accepted bytes. Query first, then resend only unconfirmed bytes.
      position=await probe(item,signal);
      if(position.offset>start)failures=0;
    }
  };
  const add=async(selected,reselectOnly)=>{
    ensureLive();const result={added:[],reselected:[],rejected:[]};
    for(const file of Array.from(selected||[])){
      try{
        const error=validateDriveFile(file);if(error)throw fault(error,'INVALID_FILE');
        const fingerprint=await fingerprintDriveFile(file,{cryptoImpl});ensureLive();
        const existing=items.find(item=>item.fingerprint===fingerprint);
        if(existing){
          if(existing.status!=='completed'){files.set(existing.id,file);existing.error=null;if(existing.id!==currentId)existing.status=paused?'paused':'queued';}
          result.reselected.push(existing.id);emit();continue;
        }
        if(reselectOnly)throw fault('기존 업로드와 일치하는 원본 파일이 아닙니다. 같은 이름·크기·수정 시각의 파일을 다시 선택해 주세요.','FILE_MISMATCH');
        const item={id:uuid(),uploadId:null,fileId:null,...fileFacts(file),fingerprint,status:paused?'paused':'queued',uploadedBytes:0,error:null};
        items.push(item);files.set(item.id,file);result.added.push(item.id);emit();
      }catch(error){result.rejected.push({name:String(file?.name||'파일'),error:safeMessage(error)});if(disposed)break;}
    }
    return result;
  };
  const select=(selected,reselectOnly=false)=>{const next=selecting.then(()=>add(selected,reselectOnly));selecting=next.catch(()=>{});return next;};
  const run=()=>{
    ensureLive();if(running)return running;paused=false;
    if(controllersRunning.has(key)&&controllersRunning.get(key)!==controller)throw fault('이 강습의 다른 업로드 창에서 전송 중입니다.','ALREADY_RUNNING');
    controllersRunning.set(key,controller);
    const work=async()=>{
      await selecting;ensureLive();
      for(;;){
        if(disposed||paused)break;
        const item=items.find(row=>row.status==='queued');if(!item)break;
        currentId=item.id;activeAbort=new AbortController();
        try{await upload(item,activeAbort.signal);}
        catch(error){
          if(disposed)break;
          if(activeAbort.signal.aborted||error?.name==='AbortError')item.status=files.has(item.id)?'paused':'needs-file';
          else{item.status='error';item.error=safeMessage(error);try{onError?.({id:item.id,error:item.error,code:error?.code||'UPLOAD_FAILED'});}catch{}}
          emit();
        }finally{activeAbort=null;currentId=null;}
      }
    };
    running=Promise.resolve().then(work).finally(()=>{running=null;currentId=null;activeAbort=null;if(controllersRunning.get(key)===controller)controllersRunning.delete(key);emit();});emit();return running;
  };
  const resume=()=>{
    ensureLive();
    // A quick pause/resume must let the aborted request settle before re-queueing it.
    if(running&&paused)return running.then(()=>resume());
    for(const item of items)if(['paused','error'].includes(item.status)&&files.has(item.id)){item.status='queued';item.error=null;}
    return run();
  };
  const controller={
    snapshot,
    subscribe(listener){ensureLive();if(typeof listener!=='function')return()=>{};listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    selectFiles:selected=>select(selected),addFiles:selected=>select(selected),reselectFiles:selected=>select(selected,true),
    start:resume,
    resume,
    retry(id){ensureLive();const item=items.find(row=>row.id===id);if(!item||item.status==='completed')return Promise.resolve(snapshot());if(item.id===currentId)return running;if(!files.has(id)&&!item.uploadId){item.status='needs-file';emit();return Promise.resolve(snapshot());}item.status='queued';item.error=null;return run();},
    pause(id){if(disposed)return;if(!id){paused=true;for(const item of items)if(['queued','preparing','uploading','verifying'].includes(item.status))item.status=files.has(item.id)?'paused':'needs-file';activeAbort?.abort();}else{const item=items.find(row=>row.id===id);if(item&&item.status!=='completed'){item.status=files.has(id)?'paused':'needs-file';if(currentId===id)activeAbort?.abort();}}emit();},
    clearCompleted(){ensureLive();for(let index=items.length-1;index>=0;index--)if(items[index].status==='completed')items.splice(index,1);emit();},
    dispose({clearMemory=true}={}){if(disposed)return;controller.pause();if(clearMemory)files.clear();sessions.clear();listeners.clear();disposed=true;if(controllersRunning.get(key)===controller)controllersRunning.delete(key);}
  };
  return controller;
}
