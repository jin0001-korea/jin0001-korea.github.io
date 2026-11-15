// Explicit in-memory intake groups. A matching name or telephone never links cards.
import {canonicalTelephone} from './customer-teams.mjs?v=26';
import {preserveActiveDraft} from './team-drafts.mjs?v=36';
import {bookingLocation} from './booking-rules.mjs?v=34';

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const text=value=>String(value??'');
const groupOf=draft=>text(draft?.commonGroupId).trim();
const customerId=draft=>text(draft?.customerId??draft?.customer_id).trim();
const stored=draft=>Boolean(draft?.id||draft?.originalId);
const editable=card=>Boolean(card?.draft)&&!stored(card.draft)&&!card.serverId&&card.baseline==null&&!['saved','edited'].includes(card.status);
const phoneOf=draft=>text(draft?.customerContactPhone??draft?.customer_contact_phone??(draft?.teamPhoneMode==='separate'?'':draft?.raw?.L));
let sequence=0;
const uuid=()=>globalThis.crypto?.randomUUID?.()||`common-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;

function contactDraft(customer,source){
  const next=clone(customer),phone=canonicalTelephone(phoneOf(source));
  next.name=text(source.raw?.H);
  const contacts=Array.isArray(next.contacts)?next.contacts:[];
  const primary=contacts.findIndex(item=>item?.label==='고객 연락처');
  // Preserve genuine secondary contacts; update only the intake's primary value.
  const other=contacts.filter((item,index)=>index!==primary&&canonicalTelephone(item?.phone)!==phone);
  next.contacts=phone?[{label:'고객 연락처',phone},...other]:other;
  return next;
}

function sharedValues(source,target){
  const next=clone(target),raw=source.raw||{},phone=phoneOf(source);
  next.raw={...next.raw,H:text(raw.H),E:text(raw.E),Q:text(raw.Q)};
  // Candidate checks prefer an explicit location. Always derive that cached
  // value from the shared company, including a newly copied team's first render.
  next.location=bookingLocation({raw:next.raw});
  next.customerContactPhone=phone;
  if(next.teamPhoneMode!=='separate'){next.teamPhoneMode='same';next.raw.L=phone;}
  next.cashReceiptRequested=typeof source.cashReceiptRequested==='boolean'?source.cashReceiptRequested:null;
  next.cashReceiptNumberMode=source.cashReceiptNumberMode==='manual'?'manual':'team_phone';
  next.cashReceiptNumber=source.cashReceiptRequested===true&&next.cashReceiptNumberMode==='manual'?text(source.cashReceiptNumber):'';
  // A server-only masked issuance number is never usable for a new team's request.
  next.cashReceiptNumberSet=false;
  if(source.customerDraft){
    next.customerDraft=contactDraft(source.customerDraft,source);
    next.customerDraft.id=customerId(next)||next.customerDraft.id;
  }
  if(next.teamDraft)next.teamDraft={...next.teamDraft,customerId:customerId(next),phone:next.teamPhoneMode==='separate'?text(next.raw.L):''};
  if(Array.isArray(next.dateBatch?.rows))next.dateBatch.rows=next.dateBatch.rows.map(row=>({...row,company:text(raw.E)}));
  return next;
}

/** Call only for the deliberate "same customer, another team" action. */
export function linkCommonCustomerDraft(source={},newDraft={},options={}){
  if(stored(newDraft))throw new Error('새 팀 초안만 고객 공통정보에 연결할 수 있습니다.');
  // A saved reservation seeds a fresh intake rather than editing an older group.
  const groupId=(!stored(source)&&groupOf(source))||text((options.groupIdFactory||uuid)()).trim();
  if(!groupId)throw new Error('고객 공통정보의 초안 번호를 만들지 못했습니다.');
  const parent={...clone(source),commonGroupId:groupId};
  let child={...clone(newDraft),commonGroupId:groupId};
  if(customerId(source))child.customerId=customerId(source);
  if(!source.customerDraft)delete child.customerDraft;
  child=sharedValues(source,child);
  return {source:parent,draft:child,groupId};
}

/** Preserve the current card, then share only within this explicit unsaved group. */
export function syncCommonCustomerDrafts(deck,activeDraft){
  const source=clone(activeDraft),groupId=groupOf(source);
  let result=preserveActiveDraft(deck,source);
  const activeKey=result.activeKey,active=result.cards.find(card=>card.key===activeKey);
  if(!groupId||!editable(active)||result.cards.some(card=>card.saveState==='saving'))return result;
  for(const card of result.cards){
    if(!editable(card)||groupOf(card.draft)!==groupId)continue;
    // A changed explicit directory identity must be detached by the caller;
    // this guard prevents accidental reassignment even if that UI step is missed.
    if(customerId(source)&&customerId(card.draft)&&customerId(source)!==customerId(card.draft))continue;
    result=preserveActiveDraft({...result,activeKey:card.key},sharedValues(source,card.draft));
  }
  result.activeKey=activeKey;
  return result;
}

export function commonCustomerDraftCount(deck,draft){
  const groupId=groupOf(draft);
  if(!groupId)return 0;
  return (deck?.cards||[]).filter(card=>editable(card)&&groupOf(card.draft)===groupId&&
    (!customerId(draft)||!customerId(card.draft)||customerId(draft)===customerId(card.draft))).length;
}
