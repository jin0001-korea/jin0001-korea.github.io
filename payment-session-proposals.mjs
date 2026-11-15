const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const pad=value=>String(value).padStart(2,'0');

/** Recover legacy paired dates from their exact invoice line, never bank dates. */
export function recoverPaymentSourceSession(row,source,{lessonMinutes=null}={}){
 const quote=String(row?.quote||'');if(!quote.trim()||typeof source?.text!=='string'||!source.text.includes(quote))return null;
 const match=/^\s*[-•·]?\s*(?:(?:강습|예약|일정)(?:일시|일자|날짜|시간)?\s*[:：]?\s*)?(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*((오전|오후)?\s*(\d{1,2})\s*[-~–]\s*(\d{1,2})\s*시)\s*$/u.exec(quote);
 if(!match)return null;
 let start=Number(match[6]),end=Number(match[7]);if(match[5]&&(start>12||end>12))return null;if(match[5]==='오후'){if(start<12)start+=12;if(end<12)end+=12;}else if(match[5]==='오전'){if(start===12)start=0;if(end===12)end=0;}
 if(start<0||start>23||end<=start||end>24)return null;
 const startTime=`${pad(start)}:00`;if(row.startTime&&row.startTime!==startTime)return null;
 let year=Number(match[1])||null,anchor='',inferred=!year;
 if(!year){const epoch=typeof source.occurredAt==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(source.occurredAt)?Date.parse(source.occurredAt):NaN;if(!Number.isFinite(epoch))return null;anchor=new Date(epoch+9*3600000).toISOString().slice(0,10);year=Number(anchor.slice(0,4));}
 let date=`${year}-${pad(match[2])}-${pad(match[3])}`;if(!validDate(date))return null;
 if(inferred&&date<anchor){const next=`${year+1}-${pad(match[2])}-${pad(match[3])}`;if(!validDate(next)||(Date.parse(next)-Date.parse(anchor))/86400000>180)return null;year++;date=next;}
 if(row.date&&row.date!==date)return null;
 const minutes=[120,240].includes(row.lessonMinutes)?row.lessonMinutes:lessonMinutes,rest=Number.isSafeInteger(minutes)?(end-start)*60-minutes:null;
 return {...row,date,startTime,lessonMinutes:minutes,breakMinutes:[0,60,120].includes(rest)?rest:null,yearConfirmed:!inferred,inferred,reason:inferred?`원문 전송일 ${anchor}(한국 시간)을 기준으로 ${year}년으로 추정했습니다. 예약 연도를 확인해 주세요.`:'원문에 명시된 회차 날짜와 시간입니다.',messageId:source.messageId||source.id,occurredAt:source.occurredAt||null};
}
