import {isDeletedCustomer} from './customer-delete.mjs?v=2';
import {participantValidationError,participantSummary} from './booking-participants.mjs?v=32';
import {canonicalTelephone,formatTelephone,normalizeCustomerText} from './customer-teams.mjs?v=26';

const list=value=>Array.isArray(value)?value:[];
const text=value=>normalizeCustomerText(value);
const clone=value=>JSON.parse(JSON.stringify(value));
export const directoryCustomerId=row=>text(row?.customerId??row?.customer_id);
export const directoryTeamId=row=>text(row?.customerTeamId??row?.customer_team_id);
const teamOwner=row=>text(row?.customer_id??row?.customerId);
const rawOf=row=>row?.raw||row?.raw_data||{};
const cancelled=row=>['cancelled','canceled'].includes(row?.status);
const dateOf=row=>text(rawOf(row).A);
export const CUSTOMER_AGE_BANDS=Object.freeze(['20s','30s','40s','50s','60s']);
export function customerTeamAgeLabel(defaults={}){if(Array.isArray(defaults.participants))return participantSummary(defaults.participants)||'나이 미확인';const band=text(defaults.ageBand);return CUSTOMER_AGE_BANDS.includes(band)?`${band.slice(0,2)}대`:Number.isInteger(Number(defaults.age))&&Number(defaults.age)>0?`${Number(defaults.age)}세`:'나이 미확인';}

export function customerDirectoryTeams(customerId,context={}){
  return list(context.customerTeams).filter(team=>teamOwner(team)===String(customerId||'')).map(team=>({...team,name:text(team.name),label:text(team.name)||'기본 1팀'})).sort((a,b)=>Number(!!a.name)-Number(!!b.name)||a.name.localeCompare(b.name,'ko')||String(a.id).localeCompare(String(b.id)));
}

/** A phone is a contact option, never a customer identity or proof of ownership. */
export function customerContactChoices(customer={},teams=[]){
  const result=[];
  for(const contact of list(customer.contacts)){
    const phone=canonicalTelephone(contact?.phone);if(!phone)continue;
    if(!result.some(item=>item.phone===phone))result.push({phone,label:text(contact.label)||'고객 연락처',source:'customer',teamId:null,formatted:formatTelephone(phone)});
  }
  for(const team of list(teams)){
    const phone=canonicalTelephone(team.phone);if(!phone)continue;
    const existing=result.find(item=>item.phone===phone);
    if(existing){existing.teamIds=[...(existing.teamIds||[]),team.id];continue;}
    result.push({phone,label:`${text(team.name)||'기본 1팀'} 연락처`,source:'team',teamId:team.id,teamIds:[team.id],formatted:formatTelephone(phone)});
  }
  return result;
}

export function customerDirectoryReservations(customerId,context={},teamId){
  const ids=new Map();
  for(const row of list(context.reservations)){
    if(directoryCustomerId(row)!==String(customerId||'')||!customerId||cancelled(row)||(teamId&&directoryTeamId(row)!==String(teamId)))continue;
    const id=String(row.id||row.schedule_id||'');if(!id)continue;
    const previous=ids.get(id);
    if(!previous||(Date.parse(row.updated_at||row.updatedAt||'')||0)>(Date.parse(previous.updated_at||previous.updatedAt||'')||0))ids.set(id,row);
  }
  return [...ids.values()].sort((a,b)=>`${dateOf(b)} ${rawOf(b).B||''}`.localeCompare(`${dateOf(a)} ${rawOf(a).B||''}`)||String(a.id).localeCompare(String(b.id)));
}

function oneEditApart(a,b){
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
  return edits+(i<a.length||j<b.length?1:0)===1;
}
const phoneQuery=value=>{
  const source=String(value??'').normalize('NFKC').trim();
  if(!source||!/^[+0-9()\s.-]+$/u.test(source))return '';
  let digits=source.replace(/\D/gu,'');
  if(source.startsWith('+82')||source.startsWith('0082')){digits=digits.slice(source.startsWith('+82')?2:4);if(!digits.startsWith('0'))digits=`0${digits}`;}
  return digits;
};

/** Ranked suggestions only. Even an exact phone can belong to multiple customers. */
export function searchCustomerCandidates(query,context={},options={}){
  const digits=phoneQuery(query);if(digits.length<4||digits.length>15)return [];
  const result=[];
  for(const customer of list(context.customers)){
    if(!customer?.id||isDeletedCustomer(customer))continue;
    const teams=customerDirectoryTeams(customer.id,context),contacts=customerContactChoices(customer,teams);
    const reservations=customerDirectoryReservations(customer.id,context);
    for(const reservation of reservations){
      for(const [value,label] of [[rawOf(reservation).L,'이전 예약 연락처'],[reservation.customerContactPhone??reservation.customer_contact_phone,'이전 예약 고객 연락처']]){
        const phone=canonicalTelephone(value);
        if(phone&&!contacts.some(contact=>contact.phone===phone))contacts.push({phone,label,source:'history',teamId:directoryTeamId(reservation)||null,formatted:formatTelephone(phone)});
      }
    }
    let best=null;
    for(const contact of contacts){
      const phone=contact.phone;
      const match=phone===digits?{rank:100,matchKind:'exact',matchLabel:'번호 일치'}
        :phone.startsWith(digits)?{rank:80,matchKind:'prefix',matchLabel:'앞번호 일치'}
        :phone.endsWith(digits)?{rank:75,matchKind:'suffix',matchLabel:'뒷번호 일치'}
        :phone.includes(digits)?{rank:70,matchKind:'substring',matchLabel:'일부 번호 일치'}
        :digits.length>=8&&oneEditApart(phone,digits)?{rank:40,matchKind:'similar',matchLabel:'유사 번호 · 확인 필요'}:null;
      if(match&&(!best||match.rank>best.rank))best={...match,matchedPhone:phone,matchedContact:contact};
    }
    if(!best)continue;
    result.push({...best,customerId:customer.id,customer,name:text(customer.name),contacts,teams,bookingCount:reservations.length,lastBookingDate:dateOf(reservations[0])});
  }
  return result.sort((a,b)=>b.rank-a.rank||b.lastBookingDate.localeCompare(a.lastBookingDate)||a.name.localeCompare(b.name,'ko')||String(a.customerId).localeCompare(String(b.customerId))).slice(0,Math.min(50,Math.max(1,Number(options.limit)||8)));
}

/** Selecting a customer never chooses a similarly named team implicitly. */
export function customerDirectorySelection(customerId,teamId,context={},options={}){
  const customer=list(context.customers).find(item=>String(item.id)===String(customerId));if(!customer||(options.activeOnly&&isDeletedCustomer(customer)))return null;
  const teams=customerDirectoryTeams(customer.id,context);
  const team=teamId?teams.find(item=>String(item.id)===String(teamId)):null;if(teamId&&!team)return null;
  const contacts=customerContactChoices(customer,teams);
  const customerPhone=customerContactChoices(customer,[])[0]?.phone||'',teamPhone=canonicalTelephone(team?.phone)||'';
  const phone=teamPhone||customerPhone,teamPhoneMode=teamPhone&&teamPhone!==customerPhone?'separate':'same';
  const defaults=clone(team?.defaults||{});
  defaults.ageBand=CUSTOMER_AGE_BANDS.includes(defaults.ageBand)?defaults.ageBand:null;
  if(defaults.ageBand)defaults.age=null;
  defaults.juniorPreparation=defaults.juniorPreparation===true;
  return {customerId:customer.id,customerTeamId:team?.id||null,customer:clone(customer),team:team?clone(team):null,contacts:clone(contacts),defaults,
    customerName:text(customer.name),phone,customerContactPhone:formatTelephone(customerPhone),teamPhoneMode,raw:{H:text(customer.name),I:text(team?.name),L:formatTelephone(phone)}};
}

export function createCustomerDirectoryDraft(){return {id:globalThis.crypto.randomUUID(),name:'',contacts:[{label:'대표 연락처',phone:''}],notes:'',expectedUpdatedAt:null};}
export function createCustomerTeamDraft(customerId){return {id:globalThis.crypto.randomUUID(),customerId,name:'',phone:'',teamPhoneMode:'same',defaults:{sport:'스키',raw:{D:'스키',M:'1',N:'2시간'},participants:[{type:'',age:null}],age:null,ageBand:null,juniorPreparation:false,experienceCount:null,parallelLongTurn:null,snowboardNoviceTurn:null},expectedUpdatedAt:null};}

export function validateCustomerDirectoryDraft(draft={}){
  if(!text(draft.name)||text(draft.name).length>120)return '고객명을 1~120자로 입력해 주세요.';
  if(!Array.isArray(draft.contacts)||draft.contacts.length>20)return '연락처는 최대 20개까지 등록할 수 있습니다.';
  const phones=new Set();
  for(const contact of draft.contacts){
    if(text(contact?.label).length>80)return '연락처 구분은 80자 이내로 입력해 주세요.';
    if(!text(contact?.phone))continue;
    const phone=canonicalTelephone(contact.phone);if(!phone)return '전화번호 형식을 확인해 주세요. 예: 010-1234-5678';
    if(phones.has(phone))return '같은 고객 안에 동일한 전화번호가 두 번 있습니다.';phones.add(phone);
  }
  if(String(draft.notes||'').length>2000)return '상담 메모는 2,000자 이내로 입력해 주세요.';
  return '';
}
export function customerDirectoryPayload(draft={}){
  const error=validateCustomerDirectoryDraft(draft);if(error)throw new Error(error);
  return {id:draft.id,name:text(draft.name),contacts:list(draft.contacts).filter(contact=>text(contact.phone)).map(contact=>({label:text(contact.label),phone:canonicalTelephone(contact.phone)})),notes:String(draft.notes||'').trim(),...(draft.expectedUpdatedAt?{expectedUpdatedAt:draft.expectedUpdatedAt}:{})};
}

export function validateCustomerTeamDraft(draft={}){
  if(!draft.customerId)return '팀을 등록할 고객을 먼저 선택해 주세요.';
  if(text(draft.name).length>120)return '팀 이름은 120자 이내로 입력해 주세요.';
  if(draft.teamPhoneMode!==undefined&&!['same','separate'].includes(draft.teamPhoneMode))return '팀 연락처 사용 방식을 확인해 주세요.';
  if(draft.teamPhoneMode==='separate'&&!text(draft.phone))return '팀의 별도 연락처를 입력해 주세요.';
  if(draft.teamPhoneMode!=='same'&&text(draft.phone)&&!canonicalTelephone(draft.phone))return '팀 전화번호 형식을 확인해 주세요.';
  const defaults=draft.defaults||{};
  if(Array.isArray(defaults.participants)){const error=participantValidationError(defaults.participants,defaults.raw?.M??defaults.participants.length);if(error)return error;}
  if(defaults.sport&&!['스키','보드'].includes(defaults.sport))return '강습 종목을 확인해 주세요.';
  if(text(defaults.ageBand)&&!CUSTOMER_AGE_BANDS.includes(defaults.ageBand))return '나이대를 20대부터 60대 중 선택해 주세요.';
  if(defaults.juniorPreparation!==undefined&&typeof defaults.juniorPreparation!=='boolean')return '주니어 준비 여부를 확인해 주세요.';
  for(const [key,max,label] of [['age',120,'나이'],['experienceCount',999,'강습 경험']])if(!(key==='age'&&defaults.ageBand)&&defaults[key]!==null&&defaults[key]!==undefined&&defaults[key]!==''&&(!Number.isInteger(Number(defaults[key]))||Number(defaults[key])<(key==='age'?1:0)||Number(defaults[key])>max))return `${label} 입력을 확인해 주세요.`;
  return '';
}
export function customerTeamPayload(draft={}){
  const error=validateCustomerTeamDraft(draft);if(error)throw new Error(error);
  const defaults=clone(draft.defaults||{});
  for(const key of ['age','experienceCount'])defaults[key]=defaults[key]===''||defaults[key]===undefined?null:defaults[key]===null?null:Number(defaults[key]);
  defaults.ageBand=CUSTOMER_AGE_BANDS.includes(defaults.ageBand)?defaults.ageBand:null;
  if(defaults.ageBand)defaults.age=null;
  defaults.juniorPreparation=defaults.juniorPreparation===true;
  return {id:draft.id,customerId:draft.customerId,name:text(draft.name),phone:draft.teamPhoneMode==='same'?'':canonicalTelephone(draft.phone)||'',defaults,...(draft.expectedUpdatedAt?{expectedUpdatedAt:draft.expectedUpdatedAt}:{})};
}
