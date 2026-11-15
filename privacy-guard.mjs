let profile = null;
let identity = '';
let observer = null;
let timer = null;
let shield = null;
let listening = false;
let syncing = false;
const watermarks = new Set();
const stamp = () => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
const isEditable = target => target instanceof Element && !!target.closest('input,textarea,[contenteditable="true"],[contenteditable=""]');
// Only the intentionally shared lesson-folder link may be selected/copied by instructors.
const isShareLink = target => {
  if(!(target instanceof HTMLInputElement)||!target.readOnly||!target.hasAttribute('data-drive-copyable'))return false;
  try{const url=new URL(target.value);return url.protocol==='https:'&&url.hostname==='drive.google.com'&&url.pathname.startsWith('/drive/folders/');}catch{return false;}
};
const cancel = event => {if(profile?.role==='instructor'&&!(['copy','contextmenu'].includes(event.type)&&isShareLink(event.target)))event.preventDefault();};
const selection = event => {if(profile?.role==='instructor'&&!isEditable(event.target))event.preventDefault();};

function updateWatermarks() {
  if(!profile)return;
  const name=profile.display_name||'강사';
  const suffix=String(profile.user_id||'').slice(0,8);
  const text=`SLOPE · ${name}${suffix?' · '+suffix:''} · ${stamp()}`;
  for(const element of watermarks) {
    if(!element.isConnected){watermarks.delete(element);continue;}
    for(const item of element.children)item.textContent=text;
  }
}
function addWatermark(parent) {
  if([...parent.children].some(element=>element.classList.contains('slope-privacy-watermark')))return;
  const element=document.createElement('div');
  element.className='slope-privacy-watermark';element.setAttribute('aria-hidden','true');
  for(let index=0;index<18;index++)element.append(document.createElement('span'));
  parent.append(element);watermarks.add(element);
}
function synchronizeWatermarks() {
  if(!profile||syncing)return;
  syncing=true;
  addWatermark(document.body);
  for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog!==shield)addWatermark(dialog);
  updateWatermarks();syncing=false;
}
function coverScreen() {
  if(!profile||shield?.open)return;
  document.body.classList.add('instructor-screen-covered');
  if(!shield)return;
  try{shield.showModal();}catch{shield.setAttribute('open','');}
}
function hidden() {if(document.hidden)coverScreen();}
function keydown(event) {
  if(!profile)return;
  const key=String(event.key||'').toLowerCase();
  if((event.ctrlKey||event.metaKey)&&key==='c'&&isShareLink(event.target))return;
  if((event.ctrlKey||event.metaKey)&&['c','x','p','s'].includes(key)){event.preventDefault();if(key==='p')coverScreen();}
  if(key==='printscreen'){event.preventDefault();coverScreen();}
}
function printStart(){if(profile)document.body.classList.add('instructor-printing');}
function printEnd(){document.body.classList.remove('instructor-printing');}

function enable() {
  document.body.classList.add('instructor-privacy');
  shield=document.createElement('dialog');
  shield.id='slope-privacy-shield';shield.className='slope-privacy-shield';
  shield.setAttribute('aria-label','강사 화면 보호');
  const content=document.createElement('div');content.className='slope-privacy-shield-card';
  const mark=document.createElement('span');mark.className='slope-privacy-shield-mark';mark.textContent='S';
  const heading=document.createElement('h2');heading.textContent='화면을 가렸습니다';
  const description=document.createElement('p');description.textContent='계속 보려면 아래 버튼을 눌러 주세요.';
  const button=document.createElement('button');button.type='button';button.className='btn primary';button.textContent='계속 보기';
  button.addEventListener('click',()=>{if(document.hidden||!profile)return;shield.close();document.body.classList.remove('instructor-screen-covered');});
  content.append(mark,heading,description,button);shield.append(content);document.body.append(shield);
  shield.addEventListener('cancel',event=>event.preventDefault());
  observer=new MutationObserver(records=>{if(records.some(record=>record.type==='attributes'||[...record.addedNodes].some(node=>node.nodeType===1&&!node.classList?.contains('slope-privacy-watermark'))))synchronizeWatermarks();});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  synchronizeWatermarks();timer=setInterval(updateWatermarks,60000);
  for(const type of ['copy','cut','contextmenu','dragstart'])document.addEventListener(type,cancel,true);
  document.addEventListener('selectstart',selection,true);document.addEventListener('keydown',keydown,true);
  document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',coverScreen);
  window.addEventListener('beforeprint',printStart);window.addEventListener('afterprint',printEnd);listening=true;
  if(document.hidden)coverScreen();
}
function disable() {
  observer?.disconnect();observer=null;clearInterval(timer);timer=null;
  if(listening){for(const type of ['copy','cut','contextmenu','dragstart'])document.removeEventListener(type,cancel,true);document.removeEventListener('selectstart',selection,true);document.removeEventListener('keydown',keydown,true);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',coverScreen);window.removeEventListener('beforeprint',printStart);window.removeEventListener('afterprint',printEnd);}
  listening=false;
  if(shield?.open)shield.close();shield?.remove();shield=null;
  for(const element of watermarks)element.remove();watermarks.clear();
  document.body.classList.remove('instructor-privacy','instructor-screen-covered','instructor-printing');
}

/** Best-effort browser protections. This cannot prevent operating-system capture. */
export function setInstructorPrivacy(nextProfile) {
  const next=nextProfile?.role==='instructor'?nextProfile:null;
  const nextIdentity=next?String(next.user_id||next.email||next.display_name||'instructor'):'';
  if(next&&profile&&identity===nextIdentity){profile=next;updateWatermarks();return;}
  disable();profile=next;identity=nextIdentity;if(profile)enable();
}

export function getInstructorPrivacyState() {
  return {enabled:!!profile,covered:!!shield?.open,watermarks:[...watermarks].filter(element=>element.isConnected).length};
}
