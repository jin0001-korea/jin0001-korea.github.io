// Native MMS collector for Tasker 6.6.18+ Java Code. This generates code; it does
// not establish Android permissions or prove compatibility with a physical phone.
export const MMS_TASKER_MIN_VERSION='6.6.18';
export const MMS_INGEST_ENDPOINT='https://ewiekbmjvgktwsbbxrzw.supabase.co/functions/v1/slope-call-inbox';
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function inputs({source,token,endpoint=MMS_INGEST_ENDPOINT}={}){
  if(!source||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.id||''))throw Error('MMS 기기 식별자를 확인해 주세요.');
  const id=source.id.toLowerCase(),credential=String(token||'');
  if(!new RegExp(`^scall_${id}_[0-9a-f]{64}$`).test(credential))throw Error('해당 휴대폰의 전송용 인증키가 필요합니다.');
  const start=typeof source.collectFrom==='number'?source.collectFrom:Date.parse(source.collectFrom);
  if(!Number.isSafeInteger(start)||start<=0)throw Error('MMS 연결 시작 시간을 확인해 주세요.');
  if(endpoint!==MMS_INGEST_ENDPOINT)throw Error('등록된 MMS 전송 주소가 필요합니다.');
  return {id,token:credential,endpoint,start};
}

export function buildMmsTaskerAction({index=0,...options}={}){
  if(!Number.isSafeInteger(index)||index<0||index>999)throw Error('MMS 작업 번호를 확인해 주세요.');
  const code=buildMmsJavaCode(options);
  return `<Action sr="act${index}" ve="7"><code>474</code><se>false</se><Str sr="arg0" ve="3">${xml(code)}</Str><Str sr="arg1" ve="3">%crm_mms_result</Str><Int sr="arg2" val="1"/></Action>`;
}

export function buildMmsJavaCode(options={}){
  const v=inputs(options);
  return `// SLOPE MMS v9: bounded, write-only device synchronization; no message logging.\n`+
`String crmEndpoint = ${JSON.stringify(v.endpoint)};\nString crmToken = ${JSON.stringify(v.token)};\nString crmSourceId = ${JSON.stringify(v.id)};\nlong crmCollectFrom = ${v.start}L;\n`+String.raw`
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.util.Xml;
import org.xmlpull.v1.XmlPullParser;
import java.io.*;
import java.net.URI;
import java.nio.channels.FileLock;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.*;
import okhttp3.*;

String crmHex(byte[] value) {
  String alphabet = "0123456789abcdef";
  StringBuffer out = new StringBuffer();
  for (int n=0; n<value.length; n++) { int b=value[n]&255; out.append(alphabet.charAt(b/16)); out.append(alphabet.charAt(b%16)); }
  return out.toString();
}
String crmHash(String value) { return crmHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"))); }
String crmString(Cursor cursor, String key) {
  int at=cursor.getColumnIndex(key); return at<0||cursor.isNull(at)?"":cursor.getString(at);
}
String crmPhone(String raw) {
  if(raw==null)return "";
  // Spaces and Unicode space separators are visual formatting, not address
  // content. Keep other characters (including hidden format characters) invalid.
  String p=raw.replaceAll("[\\s\\p{Z}]", "").replaceFirst("(?i)/TYPE=PLMN$", "");
  // The enrolled dual-number phone stores a terminal ASCII # on customer
  // addresses. Only one suffix on an otherwise valid full number is supported.
  boolean dualSuffix=p.endsWith("#");if(dualSuffix)p=p.substring(0,p.length()-1);
  if(!p.matches("[+0-9().-]+"))return "";
  p=p.replaceAll("[().-]", "");
  if(p.startsWith("+82")||p.startsWith("0082")||p.matches("82[0-9]{8,11}")) {
    p=p.replaceFirst("^(\\+82|0082|82)", ""); if(!p.startsWith("0"))p="0"+p;
  } else if(p.startsWith("00"))p="+"+p.substring(2);
  if(dualSuffix&&p.replace("+", "").length()<8)return "";
  return p.matches("([0-9]{3,15}|\\+[1-9][0-9]{7,14})")?p:"";
}
String crmCharset(String code) {
  if("3".equals(code))return "US-ASCII";
  if("4".equals(code))return "ISO-8859-1";
  if("38".equals(code))return "EUC-KR";
  if("1015".equals(code))return "UTF-16";
  if("2026".equals(code))return "Big5";
  return "UTF-8";
}
String crmSubject(String raw,String code) {
  if(raw==null||raw.equals("null"))return "";
  if(raw.length()==0||"4".equals(code))return raw;
  for(int i=0;i<raw.length();i++)if(raw.charAt(i)>255)return raw;
  try {
    return Charset.forName(crmCharset(code)).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw.getBytes("ISO-8859-1"))).toString();
  } catch(Exception ignored) { return raw; }
}
String crmMime(String raw) {
  String m=raw==null?"":raw.split(";",2)[0].trim().toLowerCase(Locale.US);
  if(m.equals("image/jpg")||m.equals("image/pjpeg"))return "image/jpeg";
  if(m.equals("image/x-ms-bmp"))return "image/bmp";
  if(m.equals("audio/x-wav")||m.equals("audio/wave"))return "audio/wav";
  if(m.equals("audio/mp3")||m.equals("audio/mpeg3"))return "audio/mpeg";
  if(m.equals("video/3gp"))return "video/3gpp";
  return m;
}
String crmAscii(byte[] b,int offset,int length) {
  if(offset+length>b.length)return "";
  return new String(b,offset,length,"US-ASCII");
}
String crmSniff(byte[] b) {
  int n=b.length;
  if(n>=4&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255)return "image/jpeg";
  if(n>=24&&(b[0]&255)==137&&crmAscii(b,1,3).equals("PNG")&&b[4]==13&&b[5]==10&&b[6]==26&&b[7]==10&&crmAscii(b,12,4).equals("IHDR"))return "image/png";
  if(n>=10&&(crmAscii(b,0,6).equals("GIF87a")||crmAscii(b,0,6).equals("GIF89a")))return "image/gif";
  if(n>=16&&crmAscii(b,0,4).equals("RIFF")&&crmAscii(b,8,4).equals("WEBP"))return "image/webp";
  if(n>=26&&crmAscii(b,0,2).equals("BM"))return "image/bmp";
  if(n>=12&&crmAscii(b,0,4).equals("RIFF")&&crmAscii(b,8,4).equals("WAVE"))return "audio/wav";
  if(n>=6&&crmAscii(b,0,6).equals("#!AMR\n")||n>=9&&crmAscii(b,0,9).equals("#!AMR-WB\n"))return "audio/amr";
  if(n>=10&&crmAscii(b,0,3).equals("ID3"))return "audio/mpeg";
  if(n>=4&&(b[0]&255)==255&&(b[1]&224)==224&&(b[1]&24)!=8&&(b[1]&6)!=0&&(b[2]&240)!=0&&(b[2]&240)!=240&&(b[2]&12)!=12)return "audio/mpeg";
  if(n>=16&&crmAscii(b,4,4).equals("ftyp")) {
    int size=ByteBuffer.wrap(b,0,4).getInt();
    if(size<16||size>n||size>4096)return "";
    String brands=crmAscii(b,8,4);
    for(int at=16;at+4<=size;at+=4)brands=brands+" "+crmAscii(b,at,4);
    if(brands.matches(".*(avif|avis).*"))return "";
    if(brands.matches(".*(heic|heix|hevc|hevx|heis|heim).*"))return "image/heic";
    if(brands.matches(".*(mif1|msf1).*"))return "image/heif";
    if(brands.matches(".*(3gp.|3g2.).*"))return "video/3gpp";
    if(brands.matches(".*(isom|iso2|mp41|mp42|avc1|M4V |MSNV).*"))return "video/mp4";
  }
  return "";
}
JSONObject crmPost(OkHttpClient client,String endpoint,String token,JSONObject payload) {
  String body=payload.toString();
  if(body.getBytes("UTF-8").length>62000)throw new Exception("MMS_METADATA_TOO_LARGE");
  Request request=new Request.Builder().url(endpoint).header("Authorization","Bearer "+token).post(RequestBody.create(MediaType.parse("application/json; charset=utf-8"),body)).build();
  Response response=null;JSONObject result=null;
  try {
    response=client.newCall(request).execute();
    if(!response.isSuccessful())throw new Exception("MMS_SERVER_REQUEST_FAILED");
    String raw=response.body().string();
    if(raw.length()>65536)throw new Exception("MMS_SERVER_RESPONSE_INVALID");
    result=new JSONObject(raw);
  } finally { if(response!=null)response.close(); }
  return result;
}
void crmPut(OkHttpClient client,String url,File file,String mime) {
  URI target=new URI(url);
  String path=target.getRawPath();
  if(!"https".equals(target.getScheme())||!"ewiekbmjvgktwsbbxrzw.supabase.co".equals(target.getHost())||target.getPort()!=-1||target.getUserInfo()!=null||target.getFragment()!=null||path==null||!path.startsWith("/storage/v1/object/upload/sign/slope-message-media/")||path.endsWith("/")||path.toLowerCase(Locale.US).contains("%2f")||path.toLowerCase(Locale.US).contains("%5c")||path.contains("..")||Uri.parse(url).getQueryParameter("token")==null)throw new Exception("MMS_UPLOAD_URL_INVALID");
  Request request=new Request.Builder().url(url).put(RequestBody.create(MediaType.parse(mime),file)).build();
  Response response=null;
  try { response=client.newCall(request).execute(); if(!response.isSuccessful())throw new Exception("MMS_UPLOAD_RETRY"); }
  finally { if(response!=null)response.close(); }
}
String crmPeer(ContentResolver resolver,String id,int box) {
  Cursor addresses=null;Set from=new HashSet();Set to=new HashSet();Set allFrom=new HashSet();Set allTo=new HashSet();int other=0;boolean unsupportedPeer=false;String result="";
  if(box!=1&&box!=2)throw new Exception("MMS_ADDRESS_UNSUPPORTED");
  try {
    addresses=resolver.query(Uri.parse("content://mms/"+id+"/addr"),new String[]{"address","type"},null,null,null);
    if(addresses==null)throw new Exception("MMS_ADDRESS_PENDING");
    while(addresses.moveToNext()) {
      String raw=crmString(addresses,"address").replaceAll("^[\\s\\p{Z}]+|[\\s\\p{Z}]+$", "");
      int kind=0;try{kind=Integer.parseInt(crmString(addresses,"type"));}catch(Exception invalid){throw new Exception("MMS_ADDRESS_UNSUPPORTED");}
      if(kind==129||kind==130){other++;continue;}
      if(kind!=137&&kind!=151)throw new Exception("MMS_ADDRESS_UNSUPPORTED");
      boolean missing=raw.length()==0||raw.equalsIgnoreCase("null")||raw.equalsIgnoreCase("insert-address-token");
      String phone=missing?"":crmPhone(raw);
      // Count every recognized participant, including unresolved rows. A valid
      // peer beside an invalid/missing one must never become a single-person chat.
      String identity=missing?"missing":phone.length()>0?"phone:"+phone:"raw:"+raw;
      if(kind==137){allFrom.add(identity);if(phone.length()>0)from.add(phone);}
      else{allTo.add(identity);if(phone.length()>0)to.add(phone);}
      // Samsung/carriers may store an opaque local/self address. Only the
      // opposite party is a customer: FROM for inbox, TO for sent messages.
      if(kind==(box==1?137:151)&&!missing&&phone.length()==0)unsupportedPeer=true;
    }
    if(other>0||allTo.size()>1||allFrom.size()>1)throw new Exception("MMS_GROUP_UNSUPPORTED");
    if(unsupportedPeer)throw new Exception("MMS_ADDRESS_UNSUPPORTED");
    Set peers=box==1?from:to;
    if(peers.size()!=1)throw new Exception("MMS_ADDRESS_PENDING");
    result=(String)peers.iterator().next();
  } finally { if(addresses!=null)addresses.close(); }
  return result;
}
JSONArray crmParts(ContentResolver resolver,String id) {
  Cursor parts=null;JSONArray result=new JSONArray();
  try {
    parts=resolver.query(Uri.parse("content://mms/"+id+"/part"),new String[]{"_id","seq","ct","name","fn","cl","cid","chset","text","_data"},null,null,"seq ASC, _id ASC");
    if(parts==null)throw new Exception("MMS_PARTS_PENDING");
    while(parts.moveToNext()) {
      String pid=crmString(parts,"_id");if(!pid.matches("[0-9]{1,20}"))throw new Exception("MMS_PART_ID_INVALID");
      String mime=crmMime(crmString(parts,"ct"));
      String name=crmString(parts,"fn");if(name.length()==0)name=crmString(parts,"name");if(name.length()==0)name=crmString(parts,"cl");
      name=name.replaceAll("^.*[/\\\\]", "").replaceAll("[\\x00-\\x1f\\x7f]", "");
      if(name.length()>160)name=name.substring(0,160);if(name.length()==0||name.equals("null"))name="attachment-"+pid;
      JSONObject part=new JSONObject();part.put("id",pid);part.put("mime",mime);part.put("name",name);part.put("charset",crmString(parts,"chset"));
      part.put("references",new JSONArray().put(crmString(parts,"fn")).put(crmString(parts,"name")).put(crmString(parts,"cl")).put(crmString(parts,"cid")));
      part.put("text",crmString(parts,"text"));part.put("hasData",crmString(parts,"_data").length()>0);result.put(part);
      if(result.length()>100)throw new Exception("MMS_PART_COUNT_INVALID");
    }
    if(result.length()==0)throw new Exception("MMS_PARTS_PENDING");
  } finally { if(parts!=null)parts.close(); }
  return result;
}
String crmPartReference(String value) {
  if(value==null)return "";
  String text=value.trim();if(text.startsWith("cid:"))text=text.substring(4);
  if(text.startsWith("<")&&text.endsWith(">"))text=text.substring(1,text.length()-1);
  try{text=Uri.decode(text);}catch(Exception ignored){}
  return text;
}
boolean crmVerifySmil(ContentResolver resolver,JSONArray parts) {
  boolean hasSmil=false;
  for(int n=0;n<parts.length();n++) {
    JSONObject part=parts.getJSONObject(n);if(!part.getString("mime").equals("application/smil"))continue;
    String smil=crmTextPart(resolver,part);if(smil.length()==0)throw new Exception("MMS_SMIL_PENDING");
    // Standard carrier SMIL headers are metadata only. Strip exact W3C public
    // declarations locally; never retrieve a DTD or allow an internal subset.
    smil=smil.replaceAll("(?is)<!DOCTYPE\\s+smil\\s+PUBLIC\\s+([\"'])-//W3C//DTD SMIL (?:1\\.0|2\\.0|2\\.1)//EN\\1\\s+([\"'])https?://www\\.w3\\.org/(?:TR/REC-smil/SMIL10\\.dtd|2001/SMIL20/SMIL20\\.dtd|2005/SMIL21/SMIL21\\.dtd)\\2\\s*>","");
    // All remaining declarations/entities stay forbidden.
    if(smil.toUpperCase(Locale.US).contains("<!DOCTYPE")||smil.toUpperCase(Locale.US).contains("<!ENTITY"))throw new Exception("MMS_SMIL_UNSUPPORTED");
    XmlPullParser parser=Xml.newPullParser();parser.setInput(new StringReader(smil));
    int event=parser.getEventType();boolean root=false;
    while(event!=XmlPullParser.END_DOCUMENT) {
      if(event==XmlPullParser.START_TAG) {
        String tag=parser.getName().toLowerCase(Locale.US);if(tag.equals("smil"))root=true;
        if(tag.equals("img")||tag.equals("video")||tag.equals("audio")||tag.equals("ref")) {
          String reference=crmPartReference(parser.getAttributeValue(null,"src"));boolean found=false;
          if(reference.length()==0)throw new Exception("MMS_MEDIA_PENDING");
          for(int i=0;i<parts.length();i++) {
            JSONObject media=parts.getJSONObject(i);String mime=media.getString("mime");
            if(mime.equals("application/smil")||!tag.equals("ref")&&mime.startsWith("text/"))continue;
            JSONArray refs=media.getJSONArray("references");
            for(int j=0;j<refs.length();j++)if(reference.equals(crmPartReference(refs.getString(j))))found=true;
          }
          if(!found)throw new Exception("MMS_MEDIA_PENDING");
        }
      }
      event=parser.next();
    }
    if(!root)throw new Exception("MMS_SMIL_PENDING");hasSmil=true;
  }
  return hasSmil;
}
String crmTextPart(ContentResolver resolver,JSONObject part) {
  String text=part.getString("text");
  if(text.length()>0||!part.getBoolean("hasData"))return text;
  InputStream stream=null;ByteArrayOutputStream output=new ByteArrayOutputStream();String result="";
  try {
    stream=resolver.openInputStream(Uri.parse("content://mms/part/"+part.getString("id")));
    if(stream==null)throw new Exception("MMS_TEXT_PENDING");
    byte[] buffer=new byte[4096];int count;
    while((count=stream.read(buffer))!=-1) { if(output.size()+count>80000)throw new Exception("MMS_TEXT_TOO_LARGE");output.write(buffer,0,count); }
    result=Charset.forName(crmCharset(part.optString("charset"))).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
  } finally { if(stream!=null)stream.close();output.close(); }
  return result;
}
JSONObject crmReadMedia(ContentResolver resolver,JSONObject part,File directory,List cacheFiles) {
  File file=File.createTempFile("slope-mms-", ".bin",directory);cacheFiles.add(file);
  InputStream input=null;OutputStream output=null;ByteArrayOutputStream header=new ByteArrayOutputStream();MessageDigest digest=MessageDigest.getInstance("SHA-256");int size=0;JSONObject result=null;
  try {
    input=resolver.openInputStream(Uri.parse("content://mms/part/"+part.getString("id")));
    if(input==null)throw new Exception("MMS_MEDIA_PENDING");output=new FileOutputStream(file);
    byte[] buffer=new byte[32768];int count;
    while((count=input.read(buffer))!=-1) {
      if(size+count>8388608)throw new Exception("MMS_MEDIA_TOO_LARGE");
      if(header.size()<4096)header.write(buffer,0,Math.min(count,4096-header.size()));
      output.write(buffer,0,count);digest.update(buffer,0,count);size+=count;
    }
    if(size<1)throw new Exception("MMS_MEDIA_PENDING");
    String detected=crmSniff(header.toByteArray()),declared=part.getString("mime");
    boolean heif=(declared.equals("image/heic")||declared.equals("image/heif"))&&(detected.equals("image/heic")||detected.equals("image/heif"));
    if(detected.length()==0||!declared.equals(detected)&&!declared.equals("application/octet-stream")&&!heif)throw new Exception("MMS_MEDIA_UNSUPPORTED");
    result=new JSONObject();result.put("name",part.getString("name"));result.put("mime",detected);result.put("size",size);result.put("sha256",crmHex(digest.digest()));
  } finally { if(input!=null)input.close();if(output!=null)output.close();header.close(); }
  return result;
}
boolean crmAck(SharedPreferences prefs,String key,JSONObject state) {
  JSONObject entries=state.getJSONObject("entries");
  while(entries.length()>4000) {
    String victim=null;long oldest=Long.MAX_VALUE;boolean preferAck=false;Iterator ids=entries.keys();
    while(ids.hasNext()) {
      String id=(String)ids.next();JSONObject item=entries.getJSONObject(id);boolean acked=item.optBoolean("acked");
      if((acked&&!preferAck)||(acked==preferAck&&item.optLong("at")<oldest)) {victim=id;oldest=item.optLong("at");preferAck=acked;}
    }
    if(victim==null)throw new Exception("MMS_STATE_LIMIT");entries.remove(victim);
  }
  return prefs.edit().putString(key,state.toString()).commit();
}

String crmSafeFailureCode(String reason) {
  String[] allowed=new String[]{"MMS_ADDRESS_PENDING","MMS_ADDRESS_UNSUPPORTED","MMS_GROUP_UNSUPPORTED","MMS_MEDIA_PENDING","MMS_MEDIA_TOO_LARGE","MMS_MEDIA_UNSUPPORTED","MMS_METADATA_TOO_LARGE","MMS_PARTS_PENDING","MMS_PART_COUNT_INVALID","MMS_PART_ID_INVALID","MMS_SERVER_REQUEST_FAILED","MMS_SERVER_RESPONSE_INVALID","MMS_SMIL_PENDING","MMS_SMIL_UNSUPPORTED","MMS_TEXT_PENDING","MMS_TEXT_TOO_LARGE","MMS_UPLOAD_RETRY","MMS_UPLOAD_URL_INVALID","MMS_CHECKPOINT_FAILED","MMS_COMPLETION_UNCONFIRMED"};
  for(int n=0;n<allowed.length;n++)if(allowed[n].equals(reason))return reason;
  return "MMS_RETRY_UNCLASSIFIED";
}
JSONObject crmRun(String endpoint,String token,String source,long collectFrom) {
  long now=System.currentTimeMillis(),floor=Math.max(collectFrom,now-604800000L),deadline=now+50000L;
  JSONObject diagnostic=new JSONObject();String[] keys=new String[]{"queried","parsed","eligible","submitted","malformed","beforeStart","afterNow","unsupported"};
  diagnostic.put("collectorVersion",9);for(int k=0;k<keys.length;k++)diagnostic.put(keys[k],0);
  int accepted=0,ignoredCount=0,pending=0,failed=0,worked=0;boolean statusSent=false;
  JSONObject output=new JSONObject();String status="ok",lastErrorCode="";
  FileOutputStream lockStream=null;FileLock lock=null;Cursor cursor=null;OkHttpClient client=null;
  try {
    File directory=new File(context.getCacheDir(),"slope-mms-v6");if(!directory.exists()&&!directory.mkdirs())throw new Exception("MMS_CACHE_UNAVAILABLE");
    lockStream=new FileOutputStream(new File(directory,"lock-"+source));
    try{lock=lockStream.getChannel().tryLock();}catch(Exception unavailable){throw new Exception("MMS_ALREADY_RUNNING");}
    if(lock==null)throw new Exception("MMS_ALREADY_RUNNING");
    // Delete only collector-owned temporary files left by a killed process.
    File[] stale=directory.listFiles();if(stale!=null)for(int k=0;k<stale.length;k++)if(stale[k].getName().startsWith("slope-mms-")&&stale[k].getName().endsWith(".bin")&&now-stale[k].lastModified()>3600000L)stale[k].delete();
    SharedPreferences prefs=context.getSharedPreferences("slope_mms_v6",0);String stateKey="state_"+source;
    JSONObject state=null;
    try{state=new JSONObject(prefs.getString(stateKey,"{}"));}catch(Exception invalid){state=new JSONObject();}
    if((state.optInt("version")!=6&&state.optInt("version")!=7&&state.optInt("version")!=8&&state.optInt("version")!=9)||state.optLong("collectFrom")!=collectFrom)state=new JSONObject().put("version",9).put("collectFrom",collectFrom).put("entries",new JSONObject());
    JSONObject entries=state.optJSONObject("entries");if(entries==null){entries=new JSONObject();state.put("entries",entries);}
    if(state.optInt("version")!=9){Iterator upgrade=entries.keys();while(upgrade.hasNext()){JSONObject item=entries.optJSONObject((String)upgrade.next());if(item!=null&&!item.optBoolean("acked"))item.put("retryAt",0);}state.put("version",9);}
    List remove=new ArrayList();Iterator iter=entries.keys();
    while(iter.hasNext()){String id=(String)iter.next();JSONObject item=entries.optJSONObject(id);if(item==null||item.optLong("at")<floor)remove.add(id);}
    for(int k=0;k<remove.size();k++)entries.remove((String)remove.get(k));
    // Bounded metadata; no customer names, numbers, message bodies, or keys in state.
    if(!crmAck(prefs,stateKey,state))throw new Exception("MMS_CHECKPOINT_FAILED");
    ContentResolver resolver=context.getContentResolver();
    client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(20,TimeUnit.SECONDS).readTimeout(40,TimeUnit.SECONDS).writeTimeout(60,TimeUnit.SECONDS).build();
    String selection="date >= ? AND date <= ? AND msg_box IN (1,2)";
    String[] columns=new String[]{"_id","date","msg_box","m_type","sub","sub_cs","text_only","m_size"};
    long scanAt=state.optLong("scanAt",floor/1000L-1L);String scanId=state.optString("scanId","0");
    if(scanAt<floor/1000L||scanAt>now/1000L||!scanId.matches("[0-9]{1,20}")){scanAt=floor/1000L-1L;scanId="0";}
    boolean wrapped=scanAt<floor/1000L;
    cursor=resolver.query(Uri.parse("content://mms"),columns,selection+" AND (date > ? OR (date = ? AND _id > ?))",new String[]{String.valueOf(floor/1000L),String.valueOf(now/1000L),String.valueOf(scanAt),String.valueOf(scanAt),scanId},"date ASC, _id ASC");
    if(cursor==null)throw new Exception("MMS_PROVIDER_UNAVAILABLE");
    while(diagnostic.getInt("queried")<4000&&worked<10&&System.currentTimeMillis()<deadline) {
      if(!cursor.moveToNext()) {
        state.put("scanAt",floor/1000L-1L).put("scanId","0");
        if(wrapped)break;
        cursor.close();wrapped=true;
        cursor=resolver.query(Uri.parse("content://mms"),columns,selection,new String[]{String.valueOf(floor/1000L),String.valueOf(now/1000L)},"date ASC, _id ASC");
        if(cursor==null)throw new Exception("MMS_PROVIDER_UNAVAILABLE");continue;
      }
      diagnostic.put("queried",diagnostic.getInt("queried")+1);
      String id=crmString(cursor,"_id");long at=0;int box=0,pdu=0;
      try{at=Long.parseLong(crmString(cursor,"date"))*1000L;box=Integer.parseInt(crmString(cursor,"msg_box"));pdu=Integer.parseInt(crmString(cursor,"m_type"));}
      catch(Exception malformed){diagnostic.put("malformed",diagnostic.getInt("malformed")+1);continue;}
      if(!id.matches("[0-9]{1,20}")){diagnostic.put("malformed",diagnostic.getInt("malformed")+1);continue;}
      // Scan progress is not an ACK: it makes retries fair when older MMS stay pending.
      state.put("scanAt",at/1000L).put("scanId",id);
      if(at<floor){diagnostic.put("beforeStart",diagnostic.getInt("beforeStart")+1);continue;}
      if(at>now){diagnostic.put("afterNow",diagnostic.getInt("afterNow")+1);continue;}
      if(box==1&&pdu!=132||box==2&&pdu!=128){pending++;continue;}
      diagnostic.put("parsed",diagnostic.getInt("parsed")+1);
      String rawSubject=crmString(cursor,"sub"),charset=crmString(cursor,"sub_cs");
      String header=crmHash(new JSONArray().put(id).put(at).put(box).put(pdu).put(rawSubject).put(charset).put(crmString(cursor,"text_only")).put(crmString(cursor,"m_size")).toString());
      JSONObject previous=entries.optJSONObject(id);
      if(previous!=null&&header.equals(previous.optString("header"))) {
        if(previous.optBoolean("acked")&&now-previous.optLong("verifiedAt")<86400000L)continue;
        if(previous.optLong("retryAt")>now){pending++;if(previous.optBoolean("unsupported")){diagnostic.put("unsupported",diagnostic.getInt("unsupported")+1);lastErrorCode=crmSafeFailureCode(previous.optString("errorCode"));}continue;}
      }
      worked++;List cacheFiles=new ArrayList();
      try {
        String peer=crmPeer(resolver,id,box);JSONArray parts=crmParts(resolver,id);
        String signature=crmHash(header+"\n"+peer+"\n"+parts.toString());
        JSONObject current=new JSONObject().put("at",at).put("header",header).put("signature",signature).put("seenAt",now).put("acked",false);
        boolean same=previous!=null&&signature.equals(previous.optString("signature"));
        if(same)current.put("seenAt",previous.optLong("seenAt"));
        if(!same||now-previous.optLong("seenAt")<30000L){entries.put(id,current);pending++;continue;}
        if(previous.optBoolean("acked")){previous.put("verifiedAt",now);continue;}
        boolean hasSmil=crmVerifySmil(resolver,parts);
        StringBuffer body=new StringBuffer();JSONArray attachments=new JSONArray();
        int textParts=0,total=0;
        for(int partIndex=0;partIndex<parts.length();partIndex++) {
          JSONObject part=parts.getJSONObject(partIndex);String mime=part.getString("mime");
          if(mime.equals("application/smil"))continue;
          if(mime.equals("text/plain")||mime.equals("text/html")) {
            if(textParts++>0)body.append("\n");body.append(crmTextPart(resolver,part));
            if(body.length()>20000)throw new Exception("MMS_TEXT_TOO_LARGE");
          } else {
            if(attachments.length()>=20)throw new Exception("MMS_MEDIA_TOO_LARGE");
            JSONObject media=crmReadMedia(resolver,part,directory,cacheFiles);total+=media.getInt("size");
            if(total>25165824)throw new Exception("MMS_MEDIA_TOO_LARGE");attachments.put(media);
          }
        }
        String subject=crmSubject(rawSubject,charset);
        if(subject.length()>1000)throw new Exception("MMS_TEXT_TOO_LARGE");
        if(body.length()==0&&subject.length()==0&&attachments.length()==0)throw new Exception("MMS_PARTS_PENDING");
        // An incoming media message must not be acknowledged while its media is absent.
        if(box==1&&"0".equals(crmString(cursor,"text_only"))&&attachments.length()==0&&!hasSmil)throw new Exception("MMS_MEDIA_PENDING");
        JSONObject record=new JSONObject().put("externalId",id).put("transport","mms").put("phone",peer).put("occurredAt",at).put("type",box).put("body",body.toString()).put("subject",subject).put("attachments",attachments);
        diagnostic.put("eligible",diagnostic.getInt("eligible")+1);diagnostic.put("submitted",diagnostic.getInt("submitted")+1);
        JSONObject prepared=crmPost(client,endpoint,token,new JSONObject().put("action","mms-prepare").put("record",record));
        if(prepared.optInt("ignored")==1&&prepared.optInt("accepted")==0&&"recruitment".equals(prepared.optString("reason"))) {
          ignoredCount++;current.put("acked",true).put("ignored",true).put("verifiedAt",now);entries.put(id,current);
          if(!crmAck(prefs,stateKey,state))throw new Exception("MMS_CHECKPOINT_FAILED");continue;
        }
        String messageId=prepared.optString("messageId");
        if(!messageId.matches("[0-9a-fA-F-]{36}")||!Boolean.class.isInstance(prepared.opt("ready")))throw new Exception("MMS_SERVER_RESPONSE_INVALID");
        if(!prepared.getBoolean("ready")) {
          JSONArray serverParts=prepared.optJSONArray("parts");
          if(serverParts==null||serverParts.length()!=attachments.length())throw new Exception("MMS_SERVER_RESPONSE_INVALID");
          boolean[] used=new boolean[attachments.length()];
          for(int index=0;index<serverParts.length();index++) {
            JSONObject remote=serverParts.getJSONObject(index);int match=-1;
            for(int candidate=0;candidate<attachments.length();candidate++) {
              JSONObject local=attachments.getJSONObject(candidate);
              if(!used[candidate]&&local.getString("sha256").equals(remote.optString("sha256"))&&local.getString("mime").equals(remote.optString("mime"))&&local.getInt("size")==remote.optInt("size")){match=candidate;break;}
            }
            if(match<0)throw new Exception("MMS_SERVER_RESPONSE_INVALID");used[match]=true;
            String signed=remote.optString("uploadUrl");
            if(signed.length()>0)crmPut(client,signed,(File)cacheFiles.get(match),attachments.getJSONObject(match).getString("mime"));
          }
          JSONObject complete=crmPost(client,endpoint,token,new JSONObject().put("action","mms-complete").put("messageId",messageId));
          if(!complete.optBoolean("ready")||complete.optInt("accepted")!=1||!messageId.equals(complete.optString("messageId")))throw new Exception("MMS_COMPLETION_UNCONFIRMED");
        }
        accepted++;current.put("acked",true).put("verifiedAt",now);entries.put(id,current);
        if(!crmAck(prefs,stateKey,state))throw new Exception("MMS_CHECKPOINT_FAILED");
      } catch(Exception failure) {
        if(failure instanceof SecurityException)throw new SecurityException("MMS_PERMISSION_REQUIRED");
        failed++;pending++;
        String reason=crmSafeFailureCode(failure.getMessage());lastErrorCode=reason;boolean unsupported=reason.endsWith("UNSUPPORTED")||reason.endsWith("TOO_LARGE");
        if(unsupported)diagnostic.put("unsupported",diagnostic.getInt("unsupported")+1);
        JSONObject retry=entries.optJSONObject(id);if(retry==null)retry=new JSONObject();
        retry.put("at",at).put("header",header).put("acked",false).put("retryAt",now+(unsupported?21600000L:60000L)).put("unsupported",unsupported).put("errorCode",reason);
        entries.put(id,retry);
      } finally { for(int k=0;k<cacheFiles.size();k++)((File)cacheFiles.get(k)).delete(); }
    }
    if(!crmAck(prefs,stateKey,state))throw new Exception("MMS_CHECKPOINT_FAILED");
    diagnostic.put("pending",pending).put("failed",failed);
    JSONObject counts=new JSONObject().put("accepted",accepted).put("inserted",0).put("updated",0).put("ignored",ignoredCount);
    crmPost(client,endpoint,token,new JSONObject().put("action","mms-sync-status").put("diagnostic",diagnostic).put("counts",counts));statusSent=true;
    if(pending>0||failed>0)status="retry_pending";
  } catch(SecurityException denied) { status="permission_required"; }
  catch(Exception failure) {if("MMS_ALREADY_RUNNING".equals(failure.getMessage()))status="already_running";else{status="retry_pending";failed++;}}
  finally {
    if(cursor!=null)cursor.close();
    if(lock!=null)try{lock.release();}catch(Exception ignored){}
    if(lockStream!=null)try{lockStream.close();}catch(Exception ignored){}
    if(client!=null){client.connectionPool().evictAll();client.dispatcher().executorService().shutdown();}
  }
  output.put("status",status).put("statusSent",statusSent).put("accepted",accepted).put("ignored",ignoredCount).put("pending",pending).put("failed",failed).put("lastErrorCode",lastErrorCode).put("diagnostic",diagnostic);
  return output;
}
JSONObject crmResult=crmRun(crmEndpoint,crmToken,crmSourceId,crmCollectFrom);
if(!"already_running".equals(crmResult.optString("status"))&&!crmResult.optBoolean("statusSent"))throw new Exception("permission_required".equals(crmResult.optString("status"))?"MMS_PERMISSION_REQUIRED":"MMS_SYNC_UNCONFIRMED");
if(crmResult.getJSONObject("diagnostic").optInt("unsupported")>0)throw new Exception("MMS_UNSUPPORTED_RECORDS: "+crmResult.getJSONObject("diagnostic").getInt("unsupported")+" / "+crmResult.optString("lastErrorCode"));
return crmResult.toString();
`;
}
