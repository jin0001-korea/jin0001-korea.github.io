// In-memory editor state only. Nothing in this module writes reservations or browser storage.
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const idOf=value=>String(value?.id||value?.originalId||'').trim()||null;
let fallbackSequence=0;
const uuid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${(++fallbackSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;

export const TEAM_DRAFT_UI_FIELDS=Object.freeze(['teamDeck','teamStack','draftCardKey','cardKey','submissionId','sameCustomerNewTeam','commonGroupId','historyInstructorSelection','suggestion','rentalCustomAmount','patchEnabled','savedBatchRows','datePickerOpen','datePickerMonth','repeatDatesOpen','repeatStart','repeatWeeks','repeatCount','copyTeamConditions','copiedTeamConditions']);
const comparisonIgnored=new Set([...TEAM_DRAFT_UI_FIELDS,'financialVersion','financial_version','expectedUpdatedAt','updatedAt','updated_at','createdAt','created_at']);
function comparable(value,top=true){
  if(Array.isArray(value))return value.map(item=>comparable(item,false));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>!top||!comparisonIgnored.has(key)).map(key=>[key,comparable(value[key],false)]));
  return value;
}
const equalFacts=(a,b)=>JSON.stringify(comparable(a))===JSON.stringify(comparable(b));
const emptyDeck=()=>({cards:[],activeKey:null,collapsed:false,suspended:false});
const isBusy=deck=>deck.cards.some(card=>card.saveState==='saving');
const active=deck=>deck.cards.find(card=>card.key===deck.activeKey)||null;
const cardStatus=card=>card.baseline===null?'draft':equalFacts(card.draft,card.baseline)?'saved':'edited';

function normalized(deck){
  if(!deck||!Array.isArray(deck.cards))return emptyDeck();
  const result=copy(deck);result.collapsed=result.collapsed===true;result.suspended=result.suspended===true;
  result.cards=result.cards.filter(card=>card&&typeof card.key==='string'&&card.key&&card.draft&&typeof card.draft==='object');
  if(!result.cards.some(card=>card.key===result.activeKey))result.activeKey=result.cards[0]?.key||null;
  return result;
}
function fresh(factory,prefix,used){
  for(let attempt=0;attempt<20;attempt++){
    const value=String(typeof factory==='function'?factory():`${prefix}${uuid()}`);
    if(value&&!used.has(value))return value;
  }
  throw new Error('팀 초안의 고유 번호를 만들지 못했습니다.');
}
function makeCard(draft={},options={},cards=[]){
  const working=copy(draft)||{},serverId=String(options.originalId||idOf(working)||'').trim()||null;
  if(serverId)working.id=serverId;
  const suppliedSubmission=String(working.submissionId||options.submissionId||'').trim();
  const submissionId=serverId?(suppliedSubmission||null):suppliedSubmission||fresh(options.submissionIdFactory,'booking-',new Set(cards.map(card=>card.submissionId).filter(Boolean)));
  if(!serverId)working.submissionId=submissionId;
  const baseline=own(options,'baseline')?copy(options.baseline):serverId?copy(working):null;
  const card={key:fresh(options.keyFactory,'team-draft-',new Set(cards.map(card=>card.key))),draft:working,baseline:baseline??null,
    status:'draft',tab:String(options.tab||'intake'),submissionId,serverId,saveState:'idle',error:null};
  card.status=cardStatus(card);return card;
}

export function createDraftDeck(draft={},options={}){
  const card=makeCard(draft,options);
  return {...emptyDeck(),cards:[card],activeKey:card.key};
}
export function ensureDraftDeck(deck,draft={},options={}){
  const result=normalized(deck);return result.cards.length?result:createDraftDeck(draft,options);
}
export function activeDraftCard(deck){return copy(active(normalized(deck)));}

/** Preserve even an entirely empty form; siblings and baselines never share nested objects. */
export function preserveActiveDraft(deck,draft,tab){
  const result=normalized(deck),card=active(result);
  if(!card||isBusy(result)||draft===undefined)return result;
  const incoming=copy(draft)||{},incomingId=idOf(incoming);
  if(card.serverId&&incomingId&&incomingId!==card.serverId)throw new Error('이 팀 카드에 연결된 예약 번호가 다릅니다.');
  if(card.serverId){
    incoming.id=card.serverId;
    const version=card.baseline?.expectedUpdatedAt||card.baseline?.updated_at||card.baseline?.updatedAt;
    if(version)incoming.expectedUpdatedAt=version;
  }
  else{
    if(incomingId)throw new Error('저장 결과는 저장 완료 처리로 연결해 주세요.');
    if(incoming.submissionId&&incoming.submissionId!==card.submissionId)throw new Error('팀 초안의 저장 번호가 바뀌었습니다.');
    incoming.submissionId=card.submissionId;
  }
  card.draft=incoming;if(tab!==undefined)card.tab=String(tab||'intake');card.status=cardStatus(card);
  return result;
}
export const stashActiveDraft=preserveActiveDraft;

function stashOption(deck,options){return own(options,'currentDraft')?preserveActiveDraft(deck,options.currentDraft,options.currentTab):normalized(deck);}
export function addDraftCard(deck,draft={},options={}){
  let result=normalized(deck);if(isBusy(result))return result;
  result=stashOption(result,options);
  const serverId=idOf(draft),submission=String(draft?.submissionId||options.submissionId||'').trim();
  const existing=result.cards.find(card=>serverId?card.serverId===serverId:submission&&card.submissionId===submission);
  if(existing){result.activeKey=existing.key;result.suspended=false;return result;}
  const card=makeCard(draft,options,result.cards);result.cards.push(card);result.activeKey=card.key;result.suspended=false;
  return result;
}
export function selectDraftCard(deck,key,options={}){
  let result=normalized(deck);if(isBusy(result)||!result.cards.some(card=>card.key===key))return result;
  result=stashOption(result,options);result.activeKey=key;result.suspended=false;return result;
}
export function canSaveDraftCard(deck,key){const result=normalized(deck),card=result.cards.find(card=>card.key===(key||result.activeKey));return !!card&&!isBusy(result)&&card.status!=='saved';}
export function markDraftCardSaving(deck,key){
  const result=normalized(deck),card=result.cards.find(card=>card.key===(key||result.activeKey));
  if(!card||isBusy(result)||card.status==='saved')return result;
  card.saveState='saving';card.error=null;return result;
}

/** The committed server identity is pinned once; saving another card cannot replace it. */
export function markDraftCardSaved(deck,key,savedRow={}){
  const result=normalized(deck),card=result.cards.find(card=>card.key===key);if(!card)return result;
  const wrapper=copy(savedRow)||{},snapshot=wrapper.reservation&&typeof wrapper.reservation==='object'?wrapper.reservation:wrapper;
  const serverId=idOf(snapshot)||idOf(wrapper)||card.serverId;
  if(!serverId)throw new Error('저장된 예약 번호를 확인해 주세요.');
  if(card.serverId&&card.serverId!==serverId)throw new Error('저장된 팀 카드의 예약 번호는 바꿀 수 없습니다.');
  if(result.cards.some(other=>other.key!==card.key&&other.serverId===serverId))throw new Error('다른 팀 카드에 이미 연결된 예약 번호입니다.');
  const merged={...copy(card.draft),...copy(snapshot),id:serverId};
  if(snapshot.raw)merged.raw={...copy(card.draft.raw||{}),...copy(snapshot.raw)};
  const updated=wrapper.updatedAt||wrapper.updated_at||wrapper.expectedUpdatedAt||snapshot.updated_at||snapshot.updatedAt||snapshot.expectedUpdatedAt;
  if(updated){merged.expectedUpdatedAt=updated;merged.updated_at=updated;}
  if(wrapper.seasonId!==undefined&&snapshot.seasonId===undefined)merged.seasonId=wrapper.seasonId;
  delete merged.submissionId;delete merged.reservation;
  card.serverId=serverId;card.draft=copy(merged);card.baseline=copy(merged);card.status='saved';card.saveState='idle';card.error=null;
  return result;
}
export function markDraftCardFailed(deck,key,error){
  const result=normalized(deck),card=result.cards.find(card=>card.key===key);if(!card)return result;
  card.saveState='idle';card.error=String(error?.message||error||'저장하지 못했습니다. 다시 시도해 주세요.');return result;
}
export function suspendDraftDeck(deck,options={}){
  let result=normalized(deck);if(isBusy(result))return result;
  result=stashOption(result,options);result.suspended=result.cards.length>0;return result;
}
export function resumeDraftDeck(deck,key){
  const result=normalized(deck);if(key&&result.cards.some(card=>card.key===key)&&!isBusy(result))result.activeKey=key;
  result.suspended=false;return result;
}
export function setDraftDeckCollapsed(deck,collapsed){const result=normalized(deck);result.collapsed=collapsed===true;return result;}
export function discardDraftCard(deck,key){
  const result=normalized(deck);if(isBusy(result))return result;
  const index=result.cards.findIndex(card=>card.key===key);if(index<0)return result;
  result.cards.splice(index,1);
  if(result.activeKey===key)result.activeKey=result.cards[Math.min(index,result.cards.length-1)]?.key||null;
  if(!result.cards.length)return emptyDeck();return result;
}
export function discardDraftDeck(deck){const result=normalized(deck);return isBusy(result)?result:emptyDeck();}

export function draftDeckSummary(deck){
  const result=normalized(deck),summary={total:result.cards.length,draft:0,edited:0,saved:0,pending:0,saving:0,busy:false,suspended:result.suspended,collapsed:result.collapsed,activeKey:result.activeKey,activeStatus:active(result)?.status||null,hasUnsaved:false};
  for(const card of result.cards){if(own(summary,card.status))summary[card.status]++;if(card.saveState==='saving')summary.saving++;}
  summary.pending=summary.draft+summary.edited;summary.busy=summary.saving>0;summary.hasUnsaved=summary.pending>0||summary.busy;
  return summary;
}
export const hasUnsavedTeamDrafts=deck=>draftDeckSummary(deck).hasUnsaved;
