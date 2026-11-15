// New links use the verified custom domain; previously issued links remain valid.
export const CUSTOMER_LEGACY_DOMAIN='https://slope-customer-portal.aurorapuppy34.chatgpt.site';
export const CUSTOMER_CUSTOM_DOMAIN='https://my.gonjiamski.co.kr';
export const CUSTOMER_PORTAL=CUSTOMER_CUSTOM_DOMAIN;
const origins=new Set([CUSTOMER_LEGACY_DOMAIN,CUSTOMER_CUSTOM_DOMAIN]);

/** Only customer token pages on the two approved origins can be handed to a customer. */
export function customerTokenUrl(value,kind){
  if(typeof value!=='string'||value!==value.trim()||!['reservation','pass','survey'].includes(kind))return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!origins.has(url.origin)||url.username||url.password||url.port)return null;
    if(url.pathname!==(kind==='survey'?'/survey.html':'/'))return null;
    const query=[...url.searchParams],fragment=[...new URLSearchParams(url.hash.slice(1))];
    const entries=[...query,...fragment];
    if(entries.length!==1||entries[0][0]!=='token'||!/^[a-f0-9]{64}$/.test(entries[0][1]))return null;
    return url.href;
  }catch{return null;}
}
