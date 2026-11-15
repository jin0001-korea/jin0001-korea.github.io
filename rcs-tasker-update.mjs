import {buildRcsJavaCode,RCS_INGEST_ENDPOINT} from './call-tasker-rcs.mjs?v=2';

export const RCS_UPDATE_MAX_BYTES=1024*1024;
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const fail=message=>{throw Error(message);};
const children=(node,name)=>[...node.children].filter(child=>child.tagName===name);
function single(node,name){const found=children(node,name);if(found.length!==1)fail('연결파일 구조가 올바르지 않습니다. 기존 SLOPE 전체 프로젝트 파일을 선택하세요.');return found[0];}
const text=(node,name)=>single(node,name).textContent;
function argument(action,name){const found=children(action,'Str').filter(child=>child.getAttribute('sr')===name);if(found.length!==1)fail('수집 작업의 설정을 확인할 수 없습니다.');return found[0];}
function declaration(code,name,kind='String'){
  const pattern=kind==='long'?new RegExp(`^\\s*long ${name} = ([0-9]+)L;\\s*$`,'gm'):new RegExp(`^\\s*String ${name} = ("(?:[^"\\\\]|\\\\.)*");\\s*$`,'gm');
  const matches=[...code.matchAll(pattern)];if(matches.length!==1)fail('수집 작업의 기기 정보가 올바르지 않습니다.');
  try{return kind==='long'?Number(matches[0][1]):JSON.parse(matches[0][1]);}catch{fail('수집 작업의 기기 정보를 읽을 수 없습니다.');}
}
function uniqueNumbers(values){return values.length>0&&values.every(value=>/^[1-9][0-9]{0,9}$/.test(value))&&new Set(values).size===values.length;}
function sameSet(actual,expected){return actual.length===expected.length&&uniqueNumbers(actual)&&actual.every(value=>expected.includes(value));}
const list=value=>value.split(',').map(part=>part.trim()).filter(Boolean);

// This function only parses and rewrites an inert XML document. It never runs
// imported actions, uploads input, rotates credentials, or changes phone state.
export function updateRcsTaskerProject(input,{Parser=globalThis.DOMParser,Serializer=globalThis.XMLSerializer}={}){
  if(typeof input!=='string'||!input.trim())fail('기존 SLOPE 연결파일을 선택하세요.');
  if(new TextEncoder().encode(input).byteLength>RCS_UPDATE_MAX_BYTES)fail('파일이 너무 큽니다. 1 MiB 이하의 SLOPE 전체 프로젝트 파일을 선택하세요.');
  if(/<!DOCTYPE|<!ENTITY|<script(?:\s|>)/i.test(input))fail('지원하지 않는 XML 구성이 포함되어 있습니다. 원래 연결파일을 선택하세요.');
  if(typeof Parser!=='function'||typeof Serializer!=='function')fail('이 브라우저에서 연결파일을 열 수 없습니다. Chrome에서 다시 시도하세요.');
  const document=new Parser().parseFromString(input,'application/xml');
  if(document.querySelector('parsererror')||document.documentElement?.tagName!=='TaskerData'||document.querySelectorAll('*').length>5000)fail('Tasker 프로젝트 XML이 아닙니다. .prj.xml 파일을 선택하세요.');
  const root=document.documentElement,project=single(root,'Project'),tasks=children(root,'Task'),profiles=children(root,'Profile');
  if(tasks.length!==3||profiles.length!==4||root.querySelectorAll('Task').length!==3||root.querySelectorAll('Profile').length!==4||root.querySelectorAll('Project').length!==1)fail('통화·문자, 장문·사진, 채팅+가 함께 있는 SLOPE 전체 프로젝트가 필요합니다.');
  const projectName=text(project,'name');
  const identity=projectName.match(new RegExp(`^SLOPE 수신 · .+ \\[(${UUID})\\]$`));
  if(!identity||projectName.length>500)fail('SLOPE 수신 프로젝트의 기기를 확인할 수 없습니다.');
  const sourceId=identity[1];
  const taskIds=tasks.map(task=>text(task,'id')),profileIds=profiles.map(profile=>text(profile,'id'));
  if(!uniqueNumbers(taskIds)||!uniqueNumbers(profileIds)||!sameSet(list(text(project,'tids')),taskIds)||!sameSet(list(text(project,'pids')),profileIds))fail('프로젝트의 작업·자동 실행 연결이 일치하지 않습니다.');
  const named=prefix=>tasks.filter(task=>text(task,'nme').startsWith(prefix));
  const calls=named('통화·문자 동기화 v9 · '),mms=named('장문·사진 동기화 v9 · '),rcs=tasks.filter(task=>/^채팅\+ 동기화 v(?:10|11) · /.test(text(task,'nme')));
  if(calls.length!==1||mms.length!==1||rcs.length!==1)fail('지원하는 SLOPE v10 또는 v11 전체 연결파일이 아닙니다.');
  if(tasks.some(task=>!text(task,'nme').endsWith(`[${sourceId}]`)))fail('서로 다른 휴대폰의 작업이 섞여 있습니다. 해당 휴대폰의 원래 연결파일을 선택하세요.');
  const references=profiles.map(profile=>text(profile,'mid0'));
  if(references.some(id=>!taskIds.includes(id))||references.filter(id=>id===text(calls[0],'id')).length!==2||references.filter(id=>id===text(mms[0],'id')).length!==1||references.filter(id=>id===text(rcs[0],'id')).length!==1)fail('자동 실행과 수집 작업의 연결이 일치하지 않습니다.');
  const javaAction=task=>{
    const actions=children(task,'Action').filter(action=>text(action,'code')==='474');
    if(actions.length!==1)fail('수정할 채팅+ 작업을 하나로 확인할 수 없습니다.');return actions[0];
  };
  const rcsAction=javaAction(rcs[0]),rcsCode=argument(rcsAction,'arg0').textContent;
  if(!/^\/\/ SLOPE RCS v(?:10|11):/.test(rcsCode))fail('SLOPE 채팅+ 수집 코드를 확인할 수 없습니다.');
  const token=declaration(rcsCode,'rcsToken'),endpoint=declaration(rcsCode,'rcsEndpoint'),collectFrom=declaration(rcsCode,'rcsCollectFrom','long');
  if(declaration(rcsCode,'rcsSourceId')!==sourceId||!new RegExp(`^scall_${sourceId}_[0-9a-f]{64}$`).test(token)||endpoint!==RCS_INGEST_ENDPOINT||!Number.isSafeInteger(collectFrom)||collectFrom<=0)fail('기기·연결키·연결 시작 정보가 일치하지 않습니다.');
  const mmsCode=argument(javaAction(mms[0]),'arg0').textContent;
  if(!/^\/\/ SLOPE MMS v9:/.test(mmsCode)||declaration(mmsCode,'crmSourceId')!==sourceId||declaration(mmsCode,'crmToken')!==token||declaration(mmsCode,'crmEndpoint')!==endpoint||declaration(mmsCode,'crmCollectFrom','long')!==collectFrom)fail('문자·사진·채팅+의 연결 정보가 서로 다릅니다. 원래 전체 연결파일을 선택하세요.');
  const httpActions=children(calls[0],'Action').filter(action=>text(action,'code')==='339');
  if(httpActions.length!==2||httpActions.some(action=>argument(action,'arg2').textContent!==endpoint||argument(action,'arg3').textContent.replace(/\r/g,'')!==`Content-Type:application/json\nAuthorization:Bearer ${token}`))fail('통화·문자 전송 주소나 연결키가 다른 파일입니다.');
  const allTokens=[...root.textContent.matchAll(/scall_[0-9a-f-]{36}_[0-9a-f]{64}/g)].map(match=>match[0]);
  if(allTokens.length!==4||allTokens.some(value=>value!==token))fail('서로 다른 연결키가 포함된 파일은 수정할 수 없습니다.');
  const callCode=children(calls[0],'Action').filter(action=>text(action,'code')==='129').map(action=>argument(action,'arg0').textContent).join('\n');
  const identifier=sourceId.replace(/-/g,'_');
  if(!callCode.includes(`Math.max(${collectFrom}, capturedNow - 604800000)`)
    ||!callCode.includes(`collectFrom: ${collectFrom}, now:`)
    ||!callCode.includes(`taskerSmsSnapshot(global('CRM_${identifier}_SmsState'), ${collectFrom}, Date.now())`))fail('통화·문자와 채팅+의 연결 시작 시각이 일치하지 않습니다.');
  const updatedCode=buildRcsJavaCode({source:{id:sourceId,collectFrom},token,endpoint});
  if(!updatedCode.startsWith('// SLOPE RCS v11:'))fail('수정판을 불러오지 못했습니다. 페이지를 새로고침하세요.');
  argument(rcsAction,'arg0').textContent=updatedCode;
  argument(rcsAction,'arg1').textContent='%crm_rcs_result';
  const oldName=text(rcs[0],'nme');single(rcs[0],'nme').textContent=oldName.replace(/^채팅\+ 동기화 v(?:10|11)/,'채팅+ 동기화 v11');
  return {xml:new Serializer().serializeToString(document),projectName,taskName:text(rcs[0],'nme'),filename:`SLOPE-RCS-v11-${sourceId.slice(0,8)}.prj.xml`};
}

export function mountRcsTaskerUpdater(document=globalThis.document){
  const input=document.querySelector('[data-rcs-file]'),status=document.querySelector('[data-rcs-status]'),result=document.querySelector('[data-rcs-result]'),button=document.querySelector('[data-rcs-download]');
  if(!input||!status||!result||!button)return;
  let prepared=null,sequence=0;
  input.addEventListener('change',async()=>{
    const current=++sequence;prepared=null;button.disabled=true;result.hidden=true;status.textContent='';
    const file=input.files?.[0];if(!file)return;
    try{
      if(file.size>RCS_UPDATE_MAX_BYTES)fail('파일이 너무 큽니다. SLOPE 전체 프로젝트 파일을 선택하세요.');
      status.textContent='연결파일을 확인하고 있습니다.';
      const updated=updateRcsTaskerProject(await file.text());if(current!==sequence)return;
      prepared=updated;document.querySelector('[data-rcs-project-name]').textContent=updated.projectName;
      document.querySelector('[data-rcs-task-name]').textContent=updated.taskName;
      result.hidden=false;button.disabled=false;status.textContent='수정 파일을 만들었습니다. 아래 기기 이름을 확인하고 내려받으세요.';
    }catch(error){if(current!==sequence)return;status.textContent=error instanceof Error?error.message:'파일을 확인하지 못했습니다. 다시 선택하세요.';}
  });
  button.addEventListener('click',()=>{
    if(!prepared)return;
    const url=URL.createObjectURL(new Blob([prepared.xml],{type:'application/xml;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download=prepared.filename;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='수정 파일을 내려받았습니다. 아래 순서대로 해당 휴대폰의 프로젝트를 교체하세요.';
  });
}
if(typeof document!=='undefined'&&document.querySelector('[data-rcs-updater]'))mountRcsTaskerUpdater(document);
