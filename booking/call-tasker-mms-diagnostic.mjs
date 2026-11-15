// One-off, read-only MMS address diagnostics. No enrollment token, network,
// message body, raw phone number, provider ID, or sync checkpoint is exported.
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function cutoff(value){
  if(value===undefined)return 0;
  const at=typeof value==='number'?value:Date.parse(value);
  if(!Number.isSafeInteger(at)||at<=0)throw Error('진단할 연결 시작 시간을 확인해 주세요.');
  return at;
}

export function buildMmsDiagnosticJavaCode({collectFrom}={}){
  const from=cutoff(collectFrom);
  return `// SLOPE MMS address diagnostic v1: manual, local, read-only.\nlong crmDiagCollectFrom = ${from}L;\n`+String.raw`
import android.content.ContentResolver;
import android.content.Context;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.database.Cursor;
import android.net.Uri;
import java.util.*;
import org.json.*;

String crmDiagString(Cursor row,String column){int index=row.getColumnIndex(column);return index<0||row.isNull(index)?"":row.getString(index);}
String crmDiagTrim(String raw){return raw==null?"":raw.replaceAll("^[\\s\\p{Z}]+|[\\s\\p{Z}]+$","");}
boolean crmDiagMissing(String raw){String text=crmDiagTrim(raw);return text.length()==0||text.equalsIgnoreCase("null")||text.equalsIgnoreCase("insert-address-token");}
String crmDiagCompact(String raw){return raw.replaceAll("[\\s\\p{Z}]","").replaceFirst("(?i)/TYPE=PLMN$","");}
String crmDiagPhone(String raw){
  if(raw==null||raw.length()>256)return "";
  String phone=crmDiagCompact(raw);
  if(!phone.matches("[+0-9().-]+"))return "";
  phone=phone.replaceAll("[().-]","");
  if(phone.startsWith("+82")||phone.startsWith("0082")||phone.matches("82[0-9]{8,11}")){
    phone=phone.replaceFirst("^(\\+82|0082|82)","");if(!phone.startsWith("0"))phone="0"+phone;
  }else if(phone.startsWith("00"))phone="+"+phone.substring(2);
  return phone.matches("([0-9]{3,15}|\\+[1-9][0-9]{7,14})")?phone:"";
}
String crmDiagClass(int point){
  if(point>=48&&point<=57)return "D";
  if(Character.isDigit(point))return "ND";
  if(Character.isLetter(point))return point<128?"L":"UL";
  if(Character.isWhitespace(point)||Character.isSpaceChar(point))return "W";
  int kind=Character.getType(point);
  if(kind==Character.FORMAT)return "F";
  if(kind==Character.CONTROL)return "C";
  if(point==43)return "PLUS";if(point==45)return "DASH";if(point==46)return "DOT";
  if(point==40||point==41)return "PAREN";if(point==47)return "SLASH";if(point==61)return "EQ";
  return "O";
}
String crmDiagShape(String raw){
  StringBuffer result=new StringBuffer();String previous="";int run=0,limit=Math.min(raw.length(),256),groups=0;
  for(int index=0;index<limit;){
    int point=Character.codePointAt(raw,index);index+=Character.charCount(point);String kind=crmDiagClass(point);
    if(kind.equals(previous)){run++;continue;}
    if(run>0){if(groups++>0)result.append(".");result.append(previous).append(run);if(groups>=12){result.append(".MORE");return result.toString();}}
    previous=kind;run=1;
  }
  if(run>0){if(groups>0)result.append(".");result.append(previous).append(run);}
  if(raw.length()>limit)result.append(".LONG");return result.length()==0?"EMPTY":result.toString();
}
String crmDiagFirstInvalid(String raw){
  if(crmDiagMissing(raw))return "NONE";
  String compact=crmDiagCompact(raw.substring(0,Math.min(raw.length(),256)));
  for(int index=0;index<compact.length();){
    int point=Character.codePointAt(compact,index);index+=Character.charCount(point);
    if(point>=48&&point<=57||point==43||point==45||point==46||point==40||point==41)continue;
    // Never emit the value or codepoint of a letter/digit from an address.
    if(Character.isDigit(point))return "NON_ASCII_DIGIT";
    if(Character.isLetter(point))return point<128?"ASCII_LETTER":"UNICODE_LETTER";
    String value=Integer.toHexString(point).toUpperCase(Locale.US);while(value.length()<4)value="0"+value;
    return crmDiagClass(point)+"_U+"+value;
  }
  return raw.length()>256?"TOO_LONG":"NONE";
}
void crmDiagAdd(Map buckets,JSONObject report,int box,String type,String typeFormat,String charset,String role,String raw,String reason){
  String length=raw.length()>256?"256+":String.valueOf(raw.length());
  int digits=0,nuls=0;for(int index=0;index<Math.min(raw.length(),256);index++){char point=raw.charAt(index);if(point>=48&&point<=57)digits++;if(point==0)nuls++;}
  JSONObject shape=new JSONObject().put("direction",box==1?"IN":"OUT").put("type",type).put("typeFormat",typeFormat).put("charset",charset).put("role",role).put("reason",reason).put("length",length).put("asciiDigits",digits).put("nulCount",nuls).put("shape",crmDiagShape(raw)).put("firstInvalid",crmDiagFirstInvalid(raw));
  String key=shape.toString();JSONObject existing=(JSONObject)buckets.get(key);
  if(existing!=null){existing.put("count",existing.getInt("count")+1);return;}
  if(buckets.size()>=30){report.put("shapeOverflow",report.getInt("shapeOverflow")+1);return;}
  shape.put("count",1);buckets.put(key,shape);
}
JSONObject crmDiagRun(ContentResolver resolver,long collectFrom){
  long now=System.currentTimeMillis(),floor=Math.max(collectFrom,now-604800000L),deadline=now+5000L;
  JSONObject report=new JSONObject().put("format","slope-mms-address-diagnostic-v1").put("status","ok").put("scope",collectFrom>0?"last7days-and-source":"last7days");
  String[] counts=new String[]{"messages","addressRows","completeMessages","peerOk","addressUnsupported","addressPending","groupUnsupported","otherRecords","providerErrors","shapeOverflow"};
  for(int i=0;i<counts.length;i++)report.put(counts[i],0);
  report.put("limited",false);Map buckets=new LinkedHashMap();Cursor messages=null;
  try{
    messages=resolver.query(Uri.parse("content://mms"),new String[]{"_id","msg_box","m_type"},"date >= ? AND date <= ? AND msg_box IN (1,2)",new String[]{String.valueOf(floor/1000L),String.valueOf(now/1000L)},"date DESC, _id DESC");
    if(messages==null){report.put("status","provider_unavailable");return report;}
    while(messages.moveToNext()){
      if(report.getInt("messages")>=50||report.getInt("addressRows")>=100||System.currentTimeMillis()>=deadline){report.put("limited",true);break;}
      report.put("messages",report.getInt("messages")+1);
      String id=crmDiagString(messages,"_id");int box=0,pdu=0;
      try{box=Integer.parseInt(crmDiagString(messages,"msg_box"));pdu=Integer.parseInt(crmDiagString(messages,"m_type"));}catch(Exception invalid){}
      if(!id.matches("[0-9]{1,20}")||box!=1&&box!=2||box==1&&pdu!=132||box==2&&pdu!=128){report.put("otherRecords",report.getInt("otherRecords")+1);continue;}
      Cursor addresses=null;Set from=new HashSet();Set to=new HashSet();Set peers=new HashSet();boolean unsupported=false,incomplete=false;int others=0;
      try{
        addresses=resolver.query(Uri.parse("content://mms/"+id+"/addr"),new String[]{"address","type","charset"},null,null,null);
        if(addresses==null){report.put("addressPending",report.getInt("addressPending")+1);continue;}
        while(addresses.moveToNext()){
          if(report.getInt("addressRows")>=100||System.currentTimeMillis()>=deadline){incomplete=true;report.put("limited",true);break;}
          report.put("addressRows",report.getInt("addressRows")+1);
          String raw=crmDiagTrim(crmDiagString(addresses,"address")),type=crmDiagString(addresses,"type"),kindLabel="INVALID";int kind=-1;
          try{if(type.matches("[0-9]{1,3}")){kind=Integer.parseInt(type);if(kind>255)kind=-1;}}catch(Exception ignored){}
          if(kind>=0)kindLabel=String.valueOf(kind);
          String typeFormat=type.length()==0?"MISSING":type.matches("[0-9]+")?"INTEGER":type.matches("[0-9]+\\.[0-9]+")?"DECIMAL":"OTHER";
          String charsetRaw=crmDiagString(addresses,"charset"),charset="MISSING";
          if(charsetRaw.length()>0){charset="INVALID";try{if(charsetRaw.matches("[0-9]{1,5}")&&Integer.parseInt(charsetRaw)<=65535)charset=String.valueOf(Integer.parseInt(charsetRaw));}catch(Exception ignored){}}
          boolean missing=crmDiagMissing(raw);String phone=missing?"":crmDiagPhone(raw);
          String role=kind==(box==1?137:151)?"PEER":kind==(box==1?151:137)?"SELF":kind==129||kind==130?"CC_BCC":"UNKNOWN";
          String reason=kind!=137&&kind!=151&&kind!=129&&kind!=130?"UNKNOWN_TYPE":missing?"MISSING":phone.length()>0?"PHONE":"NON_PHONE";
          crmDiagAdd(buckets,report,box,kindLabel,typeFormat,charset,role,raw,reason);
          if(kind==129||kind==130){others++;continue;}
          if(kind!=137&&kind!=151){unsupported=true;continue;}
          String identity=missing?"missing":phone.length()>0?"phone:"+phone:"raw:"+raw;
          if(kind==137)from.add(identity);else to.add(identity);
          if(role.equals("PEER")){if(phone.length()>0)peers.add(phone);else if(!missing)unsupported=true;}
        }
        if(incomplete)continue;
        report.put("completeMessages",report.getInt("completeMessages")+1);
        String outcome=others>0||from.size()>1||to.size()>1?"groupUnsupported":unsupported?"addressUnsupported":peers.size()!=1?"addressPending":"peerOk";
        report.put(outcome,report.getInt(outcome)+1);
      }catch(SecurityException denied){throw denied;}
      catch(Exception unreadable){report.put("providerErrors",report.getInt("providerErrors")+1);}
      finally{if(addresses!=null)addresses.close();}
    }
  }catch(SecurityException denied){report.put("status","permission_required");}
  catch(Exception unreadable){report.put("status","provider_error");}
  finally{if(messages!=null)messages.close();JSONArray shapes=new JSONArray();Iterator iterator=buckets.values().iterator();while(iterator.hasNext())shapes.put((JSONObject)iterator.next());report.put("shapes",shapes);}
  return report;
}
JSONObject crmDiagReport=crmDiagRun(context.getContentResolver(),crmDiagCollectFrom);
String crmDiagSummary=crmDiagReport.toString();boolean crmDiagCopied=false;
try{ClipboardManager clipboard=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);if(clipboard!=null){clipboard.setPrimaryClip(ClipData.newPlainText("SLOPE MMS 주소 진단",crmDiagSummary));crmDiagCopied=true;}}catch(Exception unavailable){}
tasker.log(crmDiagSummary);
tasker.showToast(crmDiagCopied?"진단 완료 · 번호와 내용을 제외한 결과를 복사했습니다. 채팅에 붙여넣어 주세요.":"진단 완료 · 복사하지 못했습니다. Tasker 실행 기록의 진단 결과를 확인해 주세요.");
return crmDiagSummary;
`;
}

export function buildMmsDiagnosticProject(options={}){
  const code=buildMmsDiagnosticJavaCode(options),timestamp=Date.now(),taskId=1998000001;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TaskerData sr="" dvi="1" tv="6.6.18">
<Project sr="proj0" ve="2"><cdate>${timestamp}</cdate><mdate>${timestamp}</mdate><name>SLOPE MMS 주소 진단</name><tids>${taskId}</tids><Img sr="icon" ve="2"><nme>mw_action_info_outline</nme></Img></Project>
<Task sr="task${taskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${taskId}</id><nme>MMS 주소 진단 · 실행 후 결과 복사</nme><pri>6</pri>
<Action sr="act0" ve="7"><code>474</code><se>false</se><Str sr="arg0" ve="3">${xml(code)}</Str><Str sr="arg1" ve="3">%crm_mms_address_diagnostic</Str><Int sr="arg2" val="1"/></Action>
</Task></TaskerData>`;
}
