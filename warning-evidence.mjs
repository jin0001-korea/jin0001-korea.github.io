/** Stored in the existing 1–5000 character evidence TEXT column. */
const PREFIX='slope-warning-v1:';
const snapshot=warning=>({
  category:String(warning?.category||''),title:String(warning?.title||''),detail:String(warning?.detail||''),
  severity:String(warning?.severity||'warning'),relatedScheduleId:warning?.relatedScheduleId||null,
  score:Number.isFinite(warning?.score)?warning.score:null,
});
const generation=warning=>{
  const value=warning?.generation;
  if(!Number.isSafeInteger(value)||value<1)return null;
  // A locally changed warning is ahead of the last server reconciliation.
  return warning.source==='local'?value+1:value;
};

export function warningEvidence(warning){
  const value=PREFIX+JSON.stringify({generation:generation(warning),warning:snapshot(warning)});
  if(!warning?.detail||value.length>5000)throw new Error('경고 확인 내용을 저장할 수 없습니다. 최신 알림을 다시 열어 주세요.');
  return value;
}

export function warningEvidenceMatches(warning,evidence){
  if(typeof evidence!=='string'||!evidence)return false;
  const currentGeneration=generation(warning);
  // Existing text-only responses are safe only before a warning has recurred.
  if(!evidence.startsWith(PREFIX))return evidence===warning?.detail&&(currentGeneration===null||currentGeneration===1);
  let saved;try{saved=JSON.parse(evidence.slice(PREFIX.length));}catch{return false;}
  if(!saved||JSON.stringify(saved.warning)!==JSON.stringify(snapshot(warning)))return false;
  if(saved.generation!==null&&(!Number.isSafeInteger(saved.generation)||saved.generation<1))return false;
  if(currentGeneration===null)return saved.generation===null;
  // A first local response remains current when the cron first records generation 1.
  return saved.generation===currentGeneration||(saved.generation===null&&currentGeneration===1);
}
