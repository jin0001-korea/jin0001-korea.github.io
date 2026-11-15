// Samsung RCS collector for the provider paths confirmed by the phone diagnostic.
// Generated Java reads messages; only verified server completion advances ACKs.
export const RCS_TASKER_MIN_VERSION='6.6.18';
export const RCS_INGEST_ENDPOINT='https://ewiekbmjvgktwsbbxrzw.supabase.co/functions/v1/slope-call-inbox';
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function inputs({source,token,endpoint=RCS_INGEST_ENDPOINT}={}){
  if(!source||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.id||''))throw Error('채팅+ 기기 식별자를 확인해 주세요.');
  const id=source.id.toLowerCase(),credential=String(token||'');
  if(!new RegExp(`^scall_${id}_[0-9a-f]{64}$`).test(credential))throw Error('해당 휴대폰의 전송용 인증키가 필요합니다.');
  const start=typeof source.collectFrom==='number'?source.collectFrom:Date.parse(source.collectFrom);
  if(!Number.isSafeInteger(start)||start<=0)throw Error('채팅+ 연결 시작 시간을 확인해 주세요.');
  if(endpoint!==RCS_INGEST_ENDPOINT)throw Error('등록된 채팅+ 전송 주소가 필요합니다.');
  return {id,token:credential,endpoint,start};
}
export function buildRcsTaskerAction({index=0,...options}={}){
  if(!Number.isSafeInteger(index)||index<0||index>999)throw Error('채팅+ 작업 번호를 확인해 주세요.');
  return `<Action sr="act${index}" ve="7"><code>474</code><se>false</se><Str sr="arg0" ve="3">${xml(buildRcsJavaCode(options))}</Str><Str sr="arg1" ve="3">%crm_rcs_result</Str><Int sr="arg2" val="1"/></Action>`;
}
export function buildRcsJavaCode(options={}){
 const v=inputs(options);
 return `// SLOPE RCS v11: separate SMS/MMS and RCS identities; no content logging.\nString rcsEndpoint = ${JSON.stringify(v.endpoint)};\nString rcsToken = ${JSON.stringify(v.token)};\nString rcsSourceId = ${JSON.stringify(v.id)};\nlong rcsCollectFrom = ${v.start}L;\n`+String.raw`
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import java.io.*;
import java.net.URI;
import java.nio.channels.FileLock;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.*;
import okhttp3.*;
String rcsHex(byte[] value) {
  String alphabet = "0123456789abcdef";
  StringBuffer out = new StringBuffer();
  for (int n=0; n<value.length; n++) { int b=value[n]&255; out.append(alphabet.charAt(b/16)); out.append(alphabet.charAt(b%16)); }
  return out.toString();
}
String rcsHash(String value) { return rcsHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"))); }
String rcsString(Cursor cursor, String key) {
  int at=cursor.getColumnIndex(key); return at<0||cursor.isNull(at)?"":cursor.getString(at);
}
String rcsPhone(String raw) {
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
String rcsCharset(String code) {
  if("3".equals(code))return "US-ASCII";
  if("4".equals(code))return "ISO-8859-1";
  if("38".equals(code))return "EUC-KR";
  if("1015".equals(code))return "UTF-16";
  if("2026".equals(code))return "Big5";
  return "UTF-8";
}
String rcsSubject(String raw,String code) {
  if(raw==null||raw.equals("null"))return "";
  if(raw.length()==0||"4".equals(code))return raw;
  for(int i=0;i<raw.length();i++)if(raw.charAt(i)>255)return raw;
  try {
    return Charset.forName(rcsCharset(code)).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw.getBytes("ISO-8859-1"))).toString();
  } catch(Exception ignored) { return raw; }
}
String rcsMime(String raw) {
  String m=raw==null?"":raw.split(";",2)[0].trim().toLowerCase(Locale.US);
  if(m.equals("image/jpg")||m.equals("image/pjpeg"))return "image/jpeg";
  if(m.equals("image/x-ms-bmp"))return "image/bmp";
  if(m.equals("audio/x-wav")||m.equals("audio/wave"))return "audio/wav";
  if(m.equals("audio/mp3")||m.equals("audio/mpeg3"))return "audio/mpeg";
  if(m.equals("video/3gp"))return "video/3gpp";
  return m;
}
String rcsAscii(byte[] b,int offset,int length) {
  if(offset+length>b.length)return "";
  return new String(b,offset,length,"US-ASCII");
}
String rcsSniff(byte[] b) {
  int n=b.length;
  if(n>=4&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255)return "image/jpeg";
  if(n>=24&&(b[0]&255)==137&&rcsAscii(b,1,3).equals("PNG")&&b[4]==13&&b[5]==10&&b[6]==26&&b[7]==10&&rcsAscii(b,12,4).equals("IHDR"))return "image/png";
  if(n>=10&&(rcsAscii(b,0,6).equals("GIF87a")||rcsAscii(b,0,6).equals("GIF89a")))return "image/gif";
  if(n>=16&&rcsAscii(b,0,4).equals("RIFF")&&rcsAscii(b,8,4).equals("WEBP"))return "image/webp";
  if(n>=26&&rcsAscii(b,0,2).equals("BM"))return "image/bmp";
  if(n>=12&&rcsAscii(b,0,4).equals("RIFF")&&rcsAscii(b,8,4).equals("WAVE"))return "audio/wav";
  if(n>=6&&rcsAscii(b,0,6).equals("#!AMR\n")||n>=9&&rcsAscii(b,0,9).equals("#!AMR-WB\n"))return "audio/amr";
  if(n>=10&&rcsAscii(b,0,3).equals("ID3"))return "audio/mpeg";
  if(n>=4&&(b[0]&255)==255&&(b[1]&224)==224&&(b[1]&24)!=8&&(b[1]&6)!=0&&(b[2]&240)!=0&&(b[2]&240)!=240&&(b[2]&12)!=12)return "audio/mpeg";
  if(n>=16&&rcsAscii(b,4,4).equals("ftyp")) {
    int size=ByteBuffer.wrap(b,0,4).getInt();
    if(size<16||size>n||size>4096)return "";
    String brands=rcsAscii(b,8,4);
    for(int at=16;at+4<=size;at+=4)brands=brands+" "+rcsAscii(b,at,4);
    if(brands.matches(".*(avif|avis).*"))return "";
    if(brands.matches(".*(heic|heix|hevc|hevx|heis|heim).*"))return "image/heic";
    if(brands.matches(".*(mif1|msf1).*"))return "image/heif";
    if(brands.matches(".*(3gp.|3g2.).*"))return "video/3gpp";
    if(brands.matches(".*(isom|iso2|mp41|mp42|avc1|M4V |MSNV).*"))return "video/mp4";
  }
  return "";
}
JSONObject rcsPost(OkHttpClient client,String endpoint,String token,JSONObject payload) {
  String body=payload.toString();
  if(body.getBytes("UTF-8").length>62000)throw new Exception("RCS_METADATA_TOO_LARGE");
  Request request=new Request.Builder().url(endpoint).header("Authorization","Bearer "+token).post(RequestBody.create(MediaType.parse("application/json; charset=utf-8"),body)).build();
  Response response=null;JSONObject result=null;
  try {
    response=client.newCall(request).execute();
    if(!response.isSuccessful())throw new Exception("RCS_SERVER_REQUEST_FAILED");
    String raw=response.body().string();
    if(raw.length()>65536)throw new Exception("RCS_SERVER_RESPONSE_INVALID");
    result=new JSONObject(raw);
  } finally { if(response!=null)response.close(); }
  return result;
}
void rcsPut(OkHttpClient client,String url,File file,String mime) {
  URI target=new URI(url);
  String path=target.getRawPath();
  if(!"https".equals(target.getScheme())||!"ewiekbmjvgktwsbbxrzw.supabase.co".equals(target.getHost())||target.getPort()!=-1||target.getUserInfo()!=null||target.getFragment()!=null||path==null||!path.startsWith("/storage/v1/object/upload/sign/slope-message-media/")||path.endsWith("/")||path.toLowerCase(Locale.US).contains("%2f")||path.toLowerCase(Locale.US).contains("%5c")||path.contains("..")||Uri.parse(url).getQueryParameter("token")==null)throw new Exception("RCS_UPLOAD_URL_INVALID");
  Request request=new Request.Builder().url(url).put(RequestBody.create(MediaType.parse(mime),file)).build();
  Response response=null;
  try { response=client.newCall(request).execute(); if(!response.isSuccessful())throw new Exception("RCS_UPLOAD_RETRY"); }
  finally { if(response!=null)response.close(); }
}
String rcsPeerPhone(String raw) {
  if(raw==null||raw.length()>256)return "";
  String value=raw.trim();
  if(value.regionMatches(true,0,"tel:",0,4))value=value.substring(4);
  else if(value.regionMatches(true,0,"sip:",0,4)) {
    value=value.substring(4);
    int at=value.indexOf('@');
    if(at>=0){
      String host=value.substring(at+1);
      if(!host.matches("(?i)[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?;user=phone"))return "";
      value=value.substring(0,at);
    }
  }
  if(value.indexOf(';')>=0||value.indexOf('@')>=0||value.indexOf(':')>=0||value.indexOf(',')>=0)return "";
  String phone=rcsPhone(value);
  return phone.replace("+","").length()>=8?phone:"";
}
long rcsTimestamp(String raw) {
  if(raw==null||!raw.matches("[0-9]{10,13}"))return 0L;
  try{long value=Long.parseLong(raw);if(value>=1000000000000L&&value<=9999999999999L)return value;if(value>=1000000000L&&value<=9999999999L)return value*1000L;}catch(Exception invalid){}
  return 0L;
}
String rcsTextBody(String body,String mime) {
  if(body==null||body.length()==0)throw new Exception("RCS_TEXT_PENDING");
  if(!"text/plain".equals(rcsMime(mime)))throw new Exception("RCS_CONTENT_UNSUPPORTED");
  if(body.length()>20000)throw new Exception("RCS_TEXT_TOO_LARGE");
  for(int i=0;i<body.length();i++){char c=body.charAt(i);if(c<32&&c!='\t'&&c!='\r'&&c!='\n'||c==127)throw new Exception("RCS_CONTENT_UNSUPPORTED");}
  return body;
}
String rcsPeer(ContentResolver resolver,Cursor row,Map verifiedThreads) {
  String[] flags=new String[]{"is_group_chat","is_group","group_chat"};
  for(int i=0;i<flags.length;i++){String flag=rcsString(row,flags[i]);if(flag.length()>0&&!"0".equals(flag)&&!"false".equalsIgnoreCase(flag))throw new Exception("RCS_GROUP_UNSUPPORTED");}
  String phone=rcsPeerPhone(rcsString(row,"address"));
  if(phone.length()==0)throw new Exception("RCS_ADDRESS_UNSUPPORTED");
  String remote=rcsString(row,"remote_uri"),remotePhone=rcsPeerPhone(remote);
  if(remotePhone.length()>0&&!remotePhone.equals(phone))throw new Exception("RCS_ADDRESS_CONFLICT");
  String thread=rcsString(row,"thread_id");
  if(!thread.matches("[0-9]{1,20}"))throw new Exception("RCS_THREAD_PENDING");
  JSONObject cached=(JSONObject)verifiedThreads.get(thread);
  if(cached!=null){
    if(!cached.getString("phone").equals(phone))throw new Exception("RCS_GROUP_UNSUPPORTED");
    if("0".equals(cached.getString("type"))&&remote.trim().length()>0&&remotePhone.length()==0)throw new Exception("RCS_ADDRESS_UNSUPPORTED");
    return phone;
  }
  Cursor conversation=null,canonical=null;
  try{
    // Samsung im/threads has a separate _id. Message thread_id is linked
    // through normal_thread_id, not that private row ID.
    conversation=resolver.query(Uri.parse("content://mms-sms/im-threads"),null,"normal_thread_id = ?",new String[]{thread},null);
    if(conversation==null||!conversation.moveToNext())throw new Exception("RCS_THREAD_PENDING");
    if(!thread.equals(rcsString(conversation,"normal_thread_id")))throw new Exception("RCS_THREAD_PENDING");
    String conversationType=rcsString(conversation,"conversation_type");
    if(conversationType.length()==0)throw new Exception("RCS_THREAD_PENDING");
    // Type 0 is an unspecified Samsung thread, not proof of a group. It must
    // still resolve to exactly one canonical recipient matching this message.
    if(!"1".equals(conversationType)&&!"0".equals(conversationType))throw new Exception("RCS_GROUP_UNSUPPORTED");
    if("0".equals(conversationType)&&remote.trim().length()>0&&remotePhone.length()==0)throw new Exception("RCS_ADDRESS_UNSUPPORTED");
    String recipient=rcsString(conversation,"recipient_ids").trim();
    if(!recipient.matches("[0-9]{1,20}"))throw new Exception("RCS_GROUP_UNSUPPORTED");
    if(conversation.moveToNext())throw new Exception("RCS_THREAD_PENDING");
    canonical=resolver.query(Uri.parse("content://mms-sms/canonical-addresses/"),new String[]{"_id","address"},"_id = ?",new String[]{recipient},null);
    if(canonical==null||!canonical.moveToNext())throw new Exception("RCS_THREAD_PENDING");
    if(!recipient.equals(rcsString(canonical,"_id")))throw new Exception("RCS_THREAD_PENDING");
    String other=rcsPeerPhone(rcsString(canonical,"address"));
    if(!phone.equals(other)||canonical.moveToNext())throw new Exception("RCS_GROUP_UNSUPPORTED");
    verifiedThreads.put(thread,new JSONObject().put("phone",phone).put("type",conversationType));
  }finally{if(conversation!=null)conversation.close();if(canonical!=null)canonical.close();}
  return phone;
}
JSONObject rcsReadVerifiedStream(InputStream input,String declared,long expected,boolean jpegTailRequired,File directory,List cacheFiles) {
  if(input==null)throw new Exception("RCS_MEDIA_PENDING");
  File file=null;
  OutputStream output=null;ByteArrayOutputStream header=new ByteArrayOutputStream();MessageDigest digest=MessageDigest.getInstance("SHA-256");int size=0;JSONObject result=null;
  try{
    file=File.createTempFile("slope-rcs-",".bin",directory);cacheFiles.add(file);
    output=new FileOutputStream(file);byte[] buffer=new byte[32768];int count,lastByte=-1,penultimateByte=-1;
    while((count=input.read(buffer))!=-1){if(count==0)continue;if(size+count>8388608)throw new Exception("RCS_MEDIA_TOO_LARGE");if(header.size()<4096)header.write(buffer,0,Math.min(count,4096-header.size()));output.write(buffer,0,count);digest.update(buffer,0,count);penultimateByte=count==1?lastByte:buffer[count-2]&255;lastByte=buffer[count-1]&255;size+=count;}
    if(size==0||expected<1||size!=expected)throw new Exception("RCS_MEDIA_PENDING");
    String detected=rcsSniff(header.toByteArray()),mime=rcsMime(declared);
    boolean heif=(mime.equals("image/heic")||mime.equals("image/heif"))&&(detected.equals("image/heic")||detected.equals("image/heif"));
    if(detected.length()==0||!detected.equals(mime)&&!mime.equals("application/octet-stream")&&!heif)throw new Exception("RCS_MEDIA_UNSUPPORTED");
    // This is an additional conservative condition for the smaller outgoing
    // JPEG case, not a general claim that a tail marker proves image integrity.
    if(jpegTailRequired&&(!detected.equals("image/jpeg")||penultimateByte!=255||lastByte!=217))throw new Exception("RCS_MEDIA_PENDING");
    String extension=detected.equals("image/jpeg")?"jpg":detected.equals("image/png")?"png":detected.equals("image/gif")?"gif":detected.equals("image/webp")?"webp":detected.equals("image/bmp")?"bmp":detected.equals("image/heic")?"heic":detected.equals("image/heif")?"heif":detected.equals("video/mp4")?"mp4":detected.equals("video/3gpp")?"3gp":detected.equals("audio/mpeg")?"mp3":detected.equals("audio/wav")?"wav":detected.equals("audio/amr")?"amr":"bin";
    result=new JSONObject().put("name","rcs-attachment."+extension).put("mime",detected).put("size",size).put("sha256",rcsHex(digest.digest()));
  }finally{try{input.close();}finally{if(output!=null)output.close();header.close();}}
  return result;
}
JSONObject rcsReadStream(InputStream input,String declared,long expected,File directory,List cacheFiles) {
  return rcsReadVerifiedStream(input,declared,expected,false,directory,cacheFiles);
}
long rcsOriginalSize(ContentResolver resolver,String id) {
  AssetFileDescriptor descriptor=null;long verified=-1L;
  try{
    descriptor=resolver.openAssetFileDescriptor(Uri.parse("content://im/ft_original/"+id),"r");
    if(descriptor!=null&&descriptor.getStartOffset()==0L){
      long length=descriptor.getLength(),stat=descriptor.getParcelFileDescriptor().getStatSize();
      if(length>0L&&length==stat)verified=length;
    }
  }catch(Exception unavailable){verified=-1L;}
  finally{if(descriptor!=null)try{descriptor.close();}catch(Exception ignored){}}
  return verified;
}
JSONObject rcsReadMedia(ContentResolver resolver,String id,Cursor row,File directory,List cacheFiles) {
  String rawSize=rcsString(row,"file_size"),mime=rcsMime(rcsString(row,"content_type"));
  if(!rawSize.matches("[0-9]{1,9}"))throw new Exception("RCS_MEDIA_PENDING");
  long metadataSize=Long.parseLong(rawSize);if(metadataSize<1)throw new Exception("RCS_MEDIA_PENDING");
  long originalSize=rcsOriginalSize(resolver,id);
  boolean smallerOutgoingJpeg="2".equals(rcsString(row,"type"))&&"image/jpeg".equals(mime)&&originalSize>0L&&originalSize<metadataSize;
  long expected=smallerOutgoingJpeg?originalSize:metadataSize;
  if(expected>8388608L)throw new Exception("RCS_MEDIA_TOO_LARGE");
  // Samsung's own file-transfer reader opens this original-content URI.
  // Never fall back to arbitrary paths from message metadata or network URLs.
  InputStream input=resolver.openInputStream(Uri.parse("content://im/ft_original/"+id));
  JSONObject media=rcsReadVerifiedStream(input,mime,expected,smallerOutgoingJpeg,directory,cacheFiles);
  if(smallerOutgoingJpeg&&rcsOriginalSize(resolver,id)!=originalSize)throw new Exception("RCS_MEDIA_PENDING");
  return media;
}
boolean rcsPreparedReady(JSONObject prepared,JSONArray attachments) {
  String id=prepared.optString("messageId");
  if(!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")||!Boolean.class.isInstance(prepared.opt("ready")))throw new Exception("RCS_SERVER_RESPONSE_INVALID");
  if(prepared.getBoolean("ready"))return true;
  JSONArray parts=prepared.optJSONArray("parts");
  if(parts==null||parts.length()!=attachments.length())throw new Exception("RCS_SERVER_RESPONSE_INVALID");
  for(int i=0;i<parts.length();i++){
    JSONObject remote=parts.getJSONObject(i),local=attachments.getJSONObject(i);
    if(!local.getString("sha256").equals(remote.optString("sha256"))||!local.getString("mime").equals(remote.optString("mime"))||local.getInt("size")!=remote.optInt("size"))throw new Exception("RCS_SERVER_RESPONSE_INVALID");
  }
  return false;
}
boolean rcsNumberEquals(Object value,int expected) {return value instanceof Number&&((Number)value).doubleValue()==expected;}
boolean rcsCompletionReady(JSONObject completed,String id) {
  if((!Boolean.class.isInstance(completed.opt("ready"))||!completed.getBoolean("ready"))||!rcsNumberEquals(completed.opt("accepted"),1)||!id.equals(completed.opt("messageId")))throw new Exception("RCS_COMPLETION_UNCONFIRMED");
  return true;
}
boolean rcsCheckpoint(SharedPreferences prefs,String key,JSONObject state) {
  JSONObject entries=state.getJSONObject("entries");
  if(entries.length()>10000)throw new Exception("RCS_STATE_LIMIT");
  return prefs.edit().putString(key,state.toString()).commit();
}
void rcsRepairPending(JSONObject state) {
  // The storage schema stays v10. Runtime upgrades must preserve all ACKs,
  // source boundaries and cursors, while letting old failures retry once.
  if(state.optInt("repairRevision")>=11)return;
  JSONObject entries=state.getJSONObject("entries");Iterator keys=entries.keys();
  while(keys.hasNext()){
    JSONObject item=entries.optJSONObject((String)keys.next());
    if(item!=null&&!item.optBoolean("acked")){item.remove("retryAt");item.remove("failures");item.remove("unsupported");}
  }
  state.put("repairRevision",11);
}
String rcsFailure(String message) {
  String[] allowed=new String[]{"RCS_TEXT_PENDING","RCS_TEXT_TOO_LARGE","RCS_CONTENT_UNSUPPORTED","RCS_GROUP_UNSUPPORTED","RCS_THREAD_PENDING","RCS_ADDRESS_UNSUPPORTED","RCS_ADDRESS_CONFLICT","RCS_MEDIA_PATH_UNSUPPORTED","RCS_MEDIA_PENDING","RCS_MEDIA_TOO_LARGE","RCS_MEDIA_UNSUPPORTED","RCS_SERVER_REQUEST_FAILED","RCS_SERVER_RESPONSE_INVALID","RCS_COMPLETION_UNCONFIRMED","RCS_UPLOAD_RETRY","RCS_UPLOAD_URL_INVALID","RCS_CHECKPOINT_FAILED","RCS_STATE_LIMIT","RCS_PERMISSION_REQUIRED","RCS_PROVIDER_UNAVAILABLE","RCS_SCHEMA_UNSUPPORTED"};
  for(int i=0;i<allowed.length;i++)if(allowed[i].equals(message))return message;
  return "RCS_RETRY_UNCLASSIFIED";
}
JSONObject rcsRun(String endpoint,String token,String source,long collectFrom) {
  long now=System.currentTimeMillis(),floor=Math.max(collectFrom,now-604800000L),deadline=now+50000L;
  JSONObject diagnostic=new JSONObject().put("collectorVersion",11);String[] names=new String[]{"queried","parsed","eligible","submitted","malformed","beforeStart","afterNow","unsupported"};for(int i=0;i<names.length;i++)diagnostic.put(names[i],0);
  int accepted=0,ignored=0,pending=0,failed=0;String lastError="",status="ok";boolean reported=false;
  FileOutputStream lockStream=null;FileLock lock=null;OkHttpClient client=null;
  try{
    File directory=new File(context.getCacheDir(),"slope-rcs-v10");if(!directory.exists()&&!directory.mkdirs())throw new Exception("RCS_CACHE_UNAVAILABLE");
    lockStream=new FileOutputStream(new File(directory,"lock-"+source));try{lock=lockStream.getChannel().tryLock();}catch(Exception busy){}
    if(lock==null)throw new Exception("RCS_ALREADY_RUNNING");
    File[] stale=directory.listFiles();if(stale!=null)for(int i=0;i<stale.length;i++)if(stale[i].getName().startsWith("slope-rcs-")&&stale[i].getName().endsWith(".bin")&&now-stale[i].lastModified()>3600000L)stale[i].delete();
    SharedPreferences prefs=context.getSharedPreferences("slope_rcs_v10",0);String stateKey="state_"+source;JSONObject state=null;
    try{state=new JSONObject(prefs.getString(stateKey,"{}"));}catch(Exception invalid){state=new JSONObject();}
    if(state.optInt("version")!=10||state.optLong("collectFrom")!=collectFrom)state=new JSONObject().put("version",10).put("collectFrom",collectFrom).put("entries",new JSONObject()).put("cursors",new JSONObject()).put("nextProvider",0);
    rcsRepairPending(state);
    JSONObject entries=state.getJSONObject("entries"),cursors=state.getJSONObject("cursors");List remove=new ArrayList();Iterator keys=entries.keys();
    while(keys.hasNext()){String key=(String)keys.next();JSONObject item=entries.optJSONObject(key);if(item==null||item.optLong("at")<floor)remove.add(key);}for(int i=0;i<remove.size();i++)entries.remove((String)remove.get(i));
    if(!rcsCheckpoint(prefs,stateKey,state))throw new Exception("RCS_CHECKPOINT_FAILED");
    client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(10,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).writeTimeout(40,TimeUnit.SECONDS).build();
    ContentResolver resolver=context.getContentResolver();Map verifiedThreads=new HashMap();String[] providers=new String[]{"chat","ft"};int first=state.optInt("nextProvider")%2;state.put("nextProvider",1-first);
    for(int turn=0;turn<2&&System.currentTimeMillis()<deadline;turn++){
      String provider=providers[(first+turn)%2];Cursor rows=null;final CancellationSignal signal=new CancellationSignal();Handler handler=new Handler(Looper.getMainLooper());Runnable cancel=new Runnable(){public void run(){signal.cancel();}};handler.postDelayed(cancel,Math.max(1L,deadline-System.currentTimeMillis()));
      int worked=0,scanned=0;JSONObject position=cursors.optJSONObject(provider);long savedAt=position==null?0L:position.optLong("at"),freshAt=0L;String savedId=position==null?"0":position.optString("id","0"),freshId="0";boolean ended=false;
      if(!savedId.matches("[0-9]{1,20}")){savedAt=0L;savedId="0";}
      try{
        // Every invocation checks the newest rows before its historical cursor.
        // A growing backfill cannot make a newly received chat wait for the tail.
        for(int round=0;round<2&&worked<(provider.equals("chat")?18:4)&&System.currentTimeMillis()<deadline;round++){
        long cursorAt=round==0?0L:savedAt>0L?savedAt:freshAt;String cursorId=round==0?"0":savedAt>0L?savedId:freshId;
        int roundScanned=0;
        String selection="((date >= ? AND date <= ?) OR (date >= ? AND date <= ?))";
        List args=new ArrayList();args.add(String.valueOf(floor));args.add(String.valueOf(now));args.add(String.valueOf(floor/1000L));args.add(String.valueOf(now/1000L));
        if(cursorAt>0L){selection+=" AND (date < ? OR (date = ? AND _id < ?))";args.add(String.valueOf(cursorAt));args.add(String.valueOf(cursorAt));args.add(cursorId);}
        rows=resolver.query(Uri.parse("content://im/"+provider),null,selection,(String[])args.toArray(new String[args.size()]),"date DESC, _id DESC",signal);
        if(rows==null)throw new Exception("RCS_PROVIDER_UNAVAILABLE");
        String[] required=provider.equals("chat")?new String[]{"_id","thread_id","address","date","type","body","content_type"}:new String[]{"_id","thread_id","address","date","type","content_type","file_size"};
        for(int i=0;i<required.length;i++)if(rows.getColumnIndex(required[i])<0)throw new Exception("RCS_SCHEMA_UNSUPPORTED");
        while(scanned<4000&&roundScanned<(round==0?200:4000)&&worked<(provider.equals("chat")?18:4)&&System.currentTimeMillis()<deadline&&!signal.isCanceled()){
          if(!rows.moveToNext()){ended=true;break;}scanned++;roundScanned++;diagnostic.put("queried",diagnostic.getInt("queried")+1);
          String id=rcsString(rows,"_id"),rawDate=rcsString(rows,"date");long at=rcsTimestamp(rawDate),rawAt=0L;int direction=0;
          try{rawAt=Long.parseLong(rawDate);direction=Integer.parseInt(rcsString(rows,"type"));}catch(Exception malformed){}
          if(!id.matches("[0-9]{1,20}")||at==0L){diagnostic.put("malformed",diagnostic.getInt("malformed")+1);pending++;lastError="RCS_SCHEMA_UNSUPPORTED";continue;}
          if(cursorAt>0L&&(rawAt>cursorAt||rawAt==cursorAt&&new BigInteger(id).compareTo(new BigInteger(cursorId))>=0))continue;
          if(round==0){freshAt=rawAt;freshId=id;}
          if(round==1||savedAt==0L)cursors.put(provider,new JSONObject().put("at",rawAt).put("id",id));
          if(at<floor){diagnostic.put("beforeStart",diagnostic.getInt("beforeStart")+1);continue;}if(at>now){diagnostic.put("afterNow",diagnostic.getInt("afterNow")+1);continue;}
          diagnostic.put("parsed",diagnostic.getInt("parsed")+1);
          if(direction!=1&&direction!=2){diagnostic.put("unsupported",diagnostic.getInt("unsupported")+1);pending++;continue;}
          String key=provider+":"+id;JSONObject previous=entries.optJSONObject(key);List files=new ArrayList();
          String header=rcsHash(new JSONArray().put(rawDate).put(direction).put(rcsString(rows,"address")).put(rcsString(rows,"remote_uri")).put(rcsString(rows,"thread_id")).put(rcsString(rows,"content_type")).put(rcsString(rows,"body")).put(rcsString(rows,"file_size")).put(rcsString(rows,"file_path")).toString());
          if(previous!=null&&header.equals(previous.optString("signature"))){if(previous.optBoolean("acked")&&now-previous.optLong("verifiedAt")<86400000L)continue;if(previous.optLong("retryAt")>now){pending++;if(previous.optBoolean("unsupported"))diagnostic.put("unsupported",diagnostic.getInt("unsupported")+1);continue;}}
          worked++;
          try{
            String peer=rcsPeer(resolver,rows,verifiedThreads),body="";JSONArray attachments=new JSONArray();
            if(provider.equals("chat"))body=rcsTextBody(rcsString(rows,"body"),rcsString(rows,"content_type"));
            else{
              if(previous==null||!header.equals(previous.optString("signature"))||now-previous.optLong("seenAt")<30000L){entries.put(key,new JSONObject().put("at",at).put("signature",header).put("seenAt",now).put("acked",false));pending++;continue;}
              JSONObject media=rcsReadMedia(resolver,id,rows,directory,files);
              if(media.getInt("size")!=Long.parseLong(rcsString(rows,"file_size"))){
                String mediaSignature=rcsHash(new JSONArray().put(media.getInt("size")).put(media.getString("mime")).put(media.getString("sha256")).toString());
                if(!mediaSignature.equals(previous.optString("mediaSignature"))||now-previous.optLong("mediaSeenAt")<30000L){
                  long mediaSeenAt=mediaSignature.equals(previous.optString("mediaSignature"))?previous.optLong("mediaSeenAt",now):now;
                  entries.put(key,new JSONObject().put("at",at).put("signature",header).put("seenAt",previous.optLong("seenAt",now)).put("acked",false).put("mediaSignature",mediaSignature).put("mediaSeenAt",mediaSeenAt));pending++;continue;
                }
              }
              attachments.put(media);
            }
            JSONObject record=new JSONObject().put("transport",provider.equals("chat")?"sms":"mms").put("phone",peer).put("occurredAt",at).put("type",direction).put("body",body).put("subject","").put("attachments",attachments);
            diagnostic.put("eligible",diagnostic.getInt("eligible")+1);diagnostic.put("submitted",diagnostic.getInt("submitted")+1);
            JSONObject prepared=rcsPost(client,endpoint,token,new JSONObject().put("action","rcs-prepare").put("provider",provider).put("externalId",id).put("record",record));
            if(rcsNumberEquals(prepared.opt("ignored"),1)&&rcsNumberEquals(prepared.opt("accepted"),0)&&"recruitment".equals(prepared.opt("reason"))){ignored++;}
            else{
              if(!rcsPreparedReady(prepared,attachments)){
                JSONArray parts=prepared.getJSONArray("parts");for(int i=0;i<parts.length();i++){String url=parts.getJSONObject(i).optString("uploadUrl");if(url.length()>0)rcsPut(client,url,(File)files.get(i),attachments.getJSONObject(i).getString("mime"));}
                String messageId=prepared.getString("messageId");rcsCompletionReady(rcsPost(client,endpoint,token,new JSONObject().put("action","rcs-complete").put("messageId",messageId)),messageId);
              }
              accepted++;
            }
            entries.put(key,new JSONObject().put("at",at).put("signature",header).put("seenAt",now).put("acked",true).put("verifiedAt",now));
            if(!rcsCheckpoint(prefs,stateKey,state))throw new Exception("RCS_CHECKPOINT_FAILED");
          }catch(Exception failure){
            failed++;pending++;String reason=failure instanceof SecurityException?"RCS_PERMISSION_REQUIRED":rcsFailure(failure.getMessage());lastError=reason;boolean unsupported=reason.endsWith("UNSUPPORTED")||reason.endsWith("TOO_LARGE");if(unsupported)diagnostic.put("unsupported",diagnostic.getInt("unsupported")+1);
            int attempts=previous!=null&&header.equals(previous.optString("signature"))?Math.min(20,previous.optInt("failures")+1):1;
            long retryDelay=unsupported?21600000L:Math.min(21600000L,60000L*(1L<<Math.min(8,attempts-1)));
            JSONObject retryEntry=new JSONObject().put("at",at).put("signature",header).put("seenAt",previous==null?now:previous.optLong("seenAt",now)).put("acked",false).put("retryAt",now+retryDelay).put("failures",attempts).put("unsupported",unsupported);
            if(previous!=null&&header.equals(previous.optString("signature"))&&previous.has("mediaSignature")){retryEntry.put("mediaSignature",previous.getString("mediaSignature")).put("mediaSeenAt",previous.optLong("mediaSeenAt"));}
            entries.put(key,retryEntry);
          }finally{for(int i=0;i<files.size();i++)((File)files.get(i)).delete();}
        }
        rows.close();rows=null;
        if(ended){cursors.remove(provider);break;}
        }
        if(!ended)pending++;
      }catch(Exception problem){failed++;pending++;lastError=problem instanceof SecurityException?"RCS_PERMISSION_REQUIRED":rcsFailure(problem.getMessage());}
      finally{handler.removeCallbacks(cancel);if(rows!=null)rows.close();}
    }
    if(!rcsCheckpoint(prefs,stateKey,state))throw new Exception("RCS_CHECKPOINT_FAILED");
    int knownPending=0;Iterator pendingKeys=entries.keys();while(pendingKeys.hasNext()){JSONObject item=entries.getJSONObject((String)pendingKeys.next());if(!item.optBoolean("acked"))knownPending++;}
    pending=Math.max(pending,knownPending);
    diagnostic.put("pending",pending).put("failed",failed);
    JSONObject statusResponse=rcsPost(client,endpoint,token,new JSONObject().put("action","rcs-sync-status").put("diagnostic",diagnostic).put("counts",new JSONObject().put("accepted",accepted).put("inserted",0).put("updated",0).put("ignored",ignored)));
    if((!Boolean.class.isInstance(statusResponse.opt("ok"))||!statusResponse.getBoolean("ok")))throw new Exception("RCS_SERVER_RESPONSE_INVALID");reported=true;
    if(pending>0||failed>0)status="retry_pending";
  }catch(Exception failure){if("RCS_ALREADY_RUNNING".equals(failure.getMessage()))status="already_running";else{status="retry_pending";failed++;lastError=failure instanceof SecurityException?"RCS_PERMISSION_REQUIRED":rcsFailure(failure.getMessage());}}
  finally{if(lock!=null)try{lock.release();}catch(Exception ignored){}if(lockStream!=null)try{lockStream.close();}catch(Exception ignored){}if(client!=null){client.connectionPool().evictAll();client.dispatcher().executorService().shutdown();}}
  return new JSONObject().put("status",status).put("statusSent",reported).put("accepted",accepted).put("pending",pending).put("failed",failed).put("lastErrorCode",lastError).put("diagnostic",diagnostic);
}
JSONObject rcsResult=rcsRun(rcsEndpoint,rcsToken,rcsSourceId,rcsCollectFrom);
if(!"already_running".equals(rcsResult.optString("status"))&&!rcsResult.optBoolean("statusSent"))throw new Exception("RCS_SYNC_UNCONFIRMED");
return rcsResult.toString();
`;
}
