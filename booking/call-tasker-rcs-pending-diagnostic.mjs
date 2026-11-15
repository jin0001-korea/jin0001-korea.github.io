// Manual, local-only inspection of unacknowledged Samsung RCS records.
// No credentials, network operations, message edits or collector-state writes.
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));

export function buildRcsPendingDiagnosticJavaCode(){
  return String.raw`
import android.content.Context;
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import java.io.*;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
// Pure validation copied from collector v10; no transmission or checkpoint code.
String pdString(Cursor cursor, String key) {
  int at=cursor.getColumnIndex(key); return at<0||cursor.isNull(at)?"":cursor.getString(at);
}
String pdPhone(String raw) {
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

String pdMime(String raw) {
  String m=raw==null?"":raw.split(";",2)[0].trim().toLowerCase(Locale.US);
  if(m.equals("image/jpg")||m.equals("image/pjpeg"))return "image/jpeg";
  if(m.equals("image/x-ms-bmp"))return "image/bmp";
  if(m.equals("audio/x-wav")||m.equals("audio/wave"))return "audio/wav";
  if(m.equals("audio/mp3")||m.equals("audio/mpeg3"))return "audio/mpeg";
  if(m.equals("video/3gp"))return "video/3gpp";
  return m;
}
String pdAscii(byte[] b,int offset,int length) {
  if(offset+length>b.length)return "";
  return new String(b,offset,length,"US-ASCII");
}
String pdSniff(byte[] b) {
  int n=b.length;
  if(n>=4&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255)return "image/jpeg";
  if(n>=24&&(b[0]&255)==137&&pdAscii(b,1,3).equals("PNG")&&b[4]==13&&b[5]==10&&b[6]==26&&b[7]==10&&pdAscii(b,12,4).equals("IHDR"))return "image/png";
  if(n>=10&&(pdAscii(b,0,6).equals("GIF87a")||pdAscii(b,0,6).equals("GIF89a")))return "image/gif";
  if(n>=16&&pdAscii(b,0,4).equals("RIFF")&&pdAscii(b,8,4).equals("WEBP"))return "image/webp";
  if(n>=26&&pdAscii(b,0,2).equals("BM"))return "image/bmp";
  if(n>=12&&pdAscii(b,0,4).equals("RIFF")&&pdAscii(b,8,4).equals("WAVE"))return "audio/wav";
  if(n>=6&&pdAscii(b,0,6).equals("#!AMR\n")||n>=9&&pdAscii(b,0,9).equals("#!AMR-WB\n"))return "audio/amr";
  if(n>=10&&pdAscii(b,0,3).equals("ID3"))return "audio/mpeg";
  if(n>=4&&(b[0]&255)==255&&(b[1]&224)==224&&(b[1]&24)!=8&&(b[1]&6)!=0&&(b[2]&240)!=0&&(b[2]&240)!=240&&(b[2]&12)!=12)return "audio/mpeg";
  if(n>=16&&pdAscii(b,4,4).equals("ftyp")) {
    int size=ByteBuffer.wrap(b,0,4).getInt();
    if(size<16||size>n||size>4096)return "";
    String brands=pdAscii(b,8,4);
    for(int at=16;at+4<=size;at+=4)brands=brands+" "+pdAscii(b,at,4);
    if(brands.matches(".*(avif|avis).*"))return "";
    if(brands.matches(".*(heic|heix|hevc|hevx|heis|heim).*"))return "image/heic";
    if(brands.matches(".*(mif1|msf1).*"))return "image/heif";
    if(brands.matches(".*(3gp.|3g2.).*"))return "video/3gpp";
    if(brands.matches(".*(isom|iso2|mp41|mp42|avc1|M4V |MSNV).*"))return "video/mp4";
  }
  return "";
}

String pdPeerPhone(String raw) {
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
  String phone=pdPhone(value);
  return phone.replace("+","").length()>=8?phone:"";
}
long pdTimestamp(String raw) {
  if(raw==null||!raw.matches("[0-9]{10,13}"))return 0L;
  try{long value=Long.parseLong(raw);if(value>=1000000000000L&&value<=9999999999999L)return value;if(value>=1000000000L&&value<=9999999999L)return value*1000L;}catch(Exception invalid){}
  return 0L;
}
String pdTextBody(String body,String mime) {
  if(body==null||body.length()==0)throw new Exception("RCS_TEXT_PENDING");
  if(!"text/plain".equals(pdMime(mime)))throw new Exception("RCS_CONTENT_UNSUPPORTED");
  if(body.length()>20000)throw new Exception("RCS_TEXT_TOO_LARGE");
  for(int i=0;i<body.length();i++){char c=body.charAt(i);if(c<32&&c!='\t'&&c!='\r'&&c!='\n'||c==127)throw new Exception("RCS_CONTENT_UNSUPPORTED");}
  return body;
}
void pdPeerFail(JSONObject report,String reason,String code) {
  pdIncrement(report.getJSONObject("peerFailureReasons"),reason);throw new Exception(code);
}
String pdPeer(ContentResolver resolver,Cursor row,Map verifiedThreads,CancellationSignal signal,JSONObject report) {
  String[] flags=new String[]{"is_group_chat","is_group","group_chat"};
  for(int i=0;i<flags.length;i++){String flag=pdString(row,flags[i]);if(flag.length()>0&&!"0".equals(flag)&&!"false".equalsIgnoreCase(flag))pdPeerFail(report,"explicitGroupFlag","RCS_GROUP_UNSUPPORTED");}
  String phone=pdPeerPhone(pdString(row,"address"));
  if(phone.length()==0)pdPeerFail(report,"rowAddressInvalid","RCS_ADDRESS_UNSUPPORTED");
  String remote=pdString(row,"remote_uri"),remotePhone=pdPeerPhone(remote);
  if(remotePhone.length()>0&&!remotePhone.equals(phone))pdPeerFail(report,"remoteAddressMismatch","RCS_ADDRESS_CONFLICT");
  String thread=pdString(row,"thread_id");
  if(!thread.matches("[0-9]{1,20}"))pdPeerFail(report,"threadIdInvalid","RCS_THREAD_PENDING");
  String cached=(String)verifiedThreads.get(thread);
  if(cached!=null){if(!cached.equals(phone))pdPeerFail(report,"cachedPeerMismatch","RCS_GROUP_UNSUPPORTED");return phone;}
  Cursor conversation=null,canonical=null;
  try{
    // Same collector validation; each branch emits only a fixed reason label.
    conversation=resolver.query(Uri.parse("content://mms-sms/im-threads"),null,"normal_thread_id = ?",new String[]{thread},null,signal);
    if(conversation==null||!conversation.moveToNext())pdPeerFail(report,"threadMissing","RCS_THREAD_PENDING");
    if(!thread.equals(pdString(conversation,"normal_thread_id")))pdPeerFail(report,"threadIdMismatch","RCS_THREAD_PENDING");
    String conversationType=pdString(conversation,"conversation_type");
    pdIncrement(report.getJSONObject("threadTypes"),conversationType.length()==0?"MISSING":conversationType.matches("[0-6]")?"TYPE_"+conversationType:"OTHER");
    if(conversationType.length()==0)pdPeerFail(report,"threadTypeMissing","RCS_THREAD_PENDING");
    if(!"1".equals(conversationType))pdPeerFail(report,"threadTypeNotOneToOne","RCS_GROUP_UNSUPPORTED");
    String recipient=pdString(conversation,"recipient_ids").trim();
    if(!recipient.matches("[0-9]{1,20}"))pdPeerFail(report,recipient.matches("[0-9]{1,20}( +[0-9]{1,20})+")?"multipleRecipientIds":"recipientIdsInvalid","RCS_GROUP_UNSUPPORTED");
    if(conversation.moveToNext())pdPeerFail(report,"threadAmbiguous","RCS_THREAD_PENDING");
    canonical=resolver.query(Uri.parse("content://mms-sms/canonical-addresses/"),new String[]{"_id","address"},"_id = ?",new String[]{recipient},null,signal);
    if(canonical==null||!canonical.moveToNext())pdPeerFail(report,"canonicalMissing","RCS_THREAD_PENDING");
    if(!recipient.equals(pdString(canonical,"_id")))pdPeerFail(report,"canonicalIdMismatch","RCS_THREAD_PENDING");
    String other=pdPeerPhone(pdString(canonical,"address"));
    if(other.length()==0)pdPeerFail(report,"canonicalAddressInvalid","RCS_GROUP_UNSUPPORTED");
    if(!phone.equals(other))pdPeerFail(report,"canonicalPeerMismatch","RCS_GROUP_UNSUPPORTED");
    if(canonical.moveToNext())pdPeerFail(report,"canonicalAmbiguous","RCS_GROUP_UNSUPPORTED");
    verifiedThreads.put(thread,phone);
  }finally{if(conversation!=null)conversation.close();if(canonical!=null)canonical.close();}
  return phone;
}


void pdIncrement(JSONObject counts,String name) { counts.put(name,counts.optInt(name)+1); }
JSONObject pdZero(String[] names) { JSONObject value=new JSONObject();for(int i=0;i<names.length;i++)value.put(names[i],0);return value; }
String pdException(Throwable failure) {
  if(failure instanceof SecurityException)return "SECURITY";
  if(failure instanceof FileNotFoundException)return "FILE_NOT_FOUND";
  if(failure instanceof InterruptedIOException)return "INTERRUPTED_IO";
  if(failure instanceof IOException)return "IO";
  if("android.os.OperationCanceledException".equals(failure.getClass().getName()))return "CANCELLED";
  return "OTHER";
}
String pdFailure(Throwable failure) {
  String message=failure.getMessage();
  String[] known=new String[]{"RCS_TEXT_PENDING","RCS_TEXT_TOO_LARGE","RCS_CONTENT_UNSUPPORTED","RCS_GROUP_UNSUPPORTED","RCS_THREAD_PENDING","RCS_ADDRESS_UNSUPPORTED","RCS_ADDRESS_CONFLICT","RCS_MEDIA_PENDING","RCS_MEDIA_TOO_LARGE","RCS_MEDIA_UNSUPPORTED","RCS_PROVIDER_UNAVAILABLE","RCS_SCHEMA_UNSUPPORTED","DIAGNOSTIC_DEADLINE"};
  for(int i=0;i<known.length;i++)if(known[i].equals(message))return known[i];
  return pdException(failure);
}
String pdMimeLabel(String value) {
  String mime=pdMime(value);
  String[] known=new String[]{"text/plain","image/jpeg","image/png","image/gif","image/webp","image/bmp","image/heic","image/heif","video/mp4","video/3gpp","audio/mpeg","audio/wav","audio/amr","application/octet-stream"};
  for(int i=0;i<known.length;i++)if(known[i].equals(mime))return known[i];
  return mime.length()==0?"EMPTY":"OTHER";
}
void pdFailed(JSONObject report,String stage,Throwable failure) {
  pdIncrement(report.getJSONObject("stages"),stage);
  pdIncrement(report.getJSONObject("errors"),pdFailure(failure));
  pdIncrement(report.getJSONObject("exceptions"),pdException(failure));
}
void pdDeadline(long deadline) { if(System.currentTimeMillis()>=deadline)throw new Exception("DIAGNOSTIC_DEADLINE"); }

String pdLengthBucket(long actual,long expected) { return actual<0L?"unknown":actual==0L?"empty":actual<expected?"shorter":actual==expected?"equal":"longer"; }
long[] pdDescriptor(ContentResolver resolver,String id,long expected,long deadline,JSONObject report,CancellationSignal signal) {
  long[] sizes=new long[]{-1L,-1L};AssetFileDescriptor descriptor=null;
  JSONObject observation=report.getJSONObject("descriptor");pdIncrement(observation,"attempted");
  try{
    pdDeadline(deadline);descriptor=resolver.openAssetFileDescriptor(Uri.parse("content://im/ft_original/"+id),"r",signal);
    if(descriptor==null){pdIncrement(observation,"unavailable");return sizes;}
    pdIncrement(observation,"opened");
    sizes[0]=descriptor.getLength();sizes[1]=descriptor.getParcelFileDescriptor().getStatSize();
    pdIncrement(report.getJSONObject("descriptorDeclaredVsMetadata"),pdLengthBucket(descriptor.getDeclaredLength(),expected));
    pdIncrement(report.getJSONObject("descriptorLengthVsMetadata"),pdLengthBucket(sizes[0],expected));
    pdIncrement(report.getJSONObject("descriptorStatVsMetadata"),pdLengthBucket(sizes[1],expected));
    pdIncrement(observation,descriptor.getStartOffset()==0L?"zeroOffset":"nonzeroOffset");
  }catch(Exception failure){pdIncrement(observation,"unavailable");pdIncrement(report.getJSONObject("descriptorErrors"),pdException(failure));}
  finally{if(descriptor!=null)try{descriptor.close();}catch(Exception ignored){}}
  return sizes;
}

void pdInspect(ContentResolver resolver,String provider,String id,long floor,long deadline,JSONObject report,Map verifiedThreads,CancellationSignal signal,Handler handler) {
  JSONObject outcome=report.getJSONObject("results").getJSONObject(provider);pdIncrement(outcome,"inspected");
  String stage="query",direction="";Cursor row=null;InputStream input=null;Runnable closeStream=null;
  try{
    pdDeadline(deadline);
    row=resolver.query(Uri.parse("content://im/"+provider),null,"_id = ?",new String[]{id},null,signal);
    if(row==null)throw new Exception("RCS_PROVIDER_UNAVAILABLE");
    if(!row.moveToNext()){pdIncrement(outcome,"missing");return;}
    if(!id.equals(pdString(row,"_id")))throw new Exception("RCS_SCHEMA_UNSUPPORTED");
    String[] required=provider.equals("chat")?new String[]{"_id","thread_id","address","date","type","body","content_type"}:new String[]{"_id","thread_id","address","date","type","content_type","file_size"};
    for(int i=0;i<required.length;i++)if(row.getColumnIndex(required[i])<0)throw new Exception("RCS_SCHEMA_UNSUPPORTED");
    long occurredAt=pdTimestamp(pdString(row,"date"));direction=pdString(row,"type");
    if(occurredAt==0L||!"1".equals(direction)&&!"2".equals(direction))throw new Exception("RCS_SCHEMA_UNSUPPORTED");
    if(occurredAt<floor||occurredAt>System.currentTimeMillis()){pdIncrement(outcome,"stale");return;}
    pdIncrement(outcome,"1".equals(direction)?"incoming":"outgoing");
    stage="peer";pdDeadline(deadline);pdPeer(resolver,row,verifiedThreads,signal,report);
    String declared=pdMime(pdString(row,"content_type"));pdIncrement(report.getJSONObject("declaredMime"),pdMimeLabel(declared));
    if(provider.equals("chat")){
      stage="text";pdTextBody(pdString(row,"body"),declared);
    }else{
      stage="size";String rawSize=pdString(row,"file_size");
      if(!rawSize.matches("[0-9]{1,9}"))throw new Exception("RCS_MEDIA_PENDING");
      long expected=Long.parseLong(rawSize);if(expected<1L)throw new Exception("RCS_MEDIA_PENDING");if(expected>8388608L)throw new Exception("RCS_MEDIA_TOO_LARGE");
      stage="open";pdDeadline(deadline);input=resolver.openInputStream(Uri.parse("content://im/ft_original/"+id));
      if(input==null)throw new Exception("RCS_MEDIA_PENDING");
      final InputStream activeStream=input;closeStream=new Runnable(){public void run(){try{activeStream.close();}catch(Exception ignored){}}};handler.postDelayed(closeStream,Math.max(1L,deadline-System.currentTimeMillis()));
      stage="read";ByteArrayOutputStream header=new ByteArrayOutputStream();MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0L;byte[] buffer=new byte[32768];int read,lastByte=-1,penultimateByte=-1;
      while(true){pdDeadline(deadline);read=input.read(buffer);if(read<0)break;if(read==0)continue;if(size+read>8388608L)throw new Exception("RCS_MEDIA_TOO_LARGE");if(header.size()<4096)header.write(buffer,0,Math.min(read,4096-header.size()));digest.update(buffer,0,read);penultimateByte=read==1?lastByte:buffer[read-2]&255;lastByte=buffer[read-1]&255;size+=read;}
      byte[] sha256=digest.digest();if(sha256.length!=32)throw new Exception("RCS_MEDIA_PENDING");
      String detected=pdSniff(header.toByteArray());header.close();pdIncrement(report.getJSONObject("observedMime"),pdMimeLabel(detected));
      // Last two bytes only; neither presence nor absence proves JPEG integrity.
      if("image/jpeg".equals(declared)||"image/jpeg".equals(detected))pdIncrement(report.getJSONObject("jpegTailMarker"),size==0L?"empty":penultimateByte==255&&lastByte==217?"present":"missing");
      pdIncrement(report.getJSONObject("streamLengthVsMetadata"),pdLengthBucket(size,expected));
      pdIncrement(report.getJSONObject("streamLengthByDirection").getJSONObject("1".equals(direction)?"incoming":"outgoing"),pdLengthBucket(size,expected));
      // Observe the original stream fully before any optional second open.
      // Samsung openInputStream uses a vendor wrapper: do not substitute the
      // descriptor's generic createInputStream for the collector's actual path.
      long[] descriptorSizes=pdDescriptor(resolver,id,expected,deadline,report,signal);
      if(descriptorSizes[0]>=0L)pdIncrement(report.getJSONObject("streamLengthVsDescriptor"),pdLengthBucket(size,descriptorSizes[0]));
      else pdIncrement(report.getJSONObject("streamLengthVsDescriptor"),"unknownDescriptor");
      if(descriptorSizes[1]>=0L)pdIncrement(report.getJSONObject("streamLengthVsStat"),pdLengthBucket(size,descriptorSizes[1]));
      else pdIncrement(report.getJSONObject("streamLengthVsStat"),"unknownDescriptor");
      stage="length";if(size==0L||size!=expected)throw new Exception("RCS_MEDIA_PENDING");pdIncrement(report.getJSONObject("media"),"exactLength");
      stage="mime";
      boolean heif=(declared.equals("image/heic")||declared.equals("image/heif"))&&(detected.equals("image/heic")||detected.equals("image/heif"));
      if(detected.length()==0||!detected.equals(declared)&&!declared.equals("application/octet-stream")&&!heif)throw new Exception("RCS_MEDIA_UNSUPPORTED");
      pdIncrement(report.getJSONObject("media"),"validatedBytes");
    }
    stage="query";if(row.moveToNext())throw new Exception("RCS_SCHEMA_UNSUPPORTED");
    pdIncrement(outcome,"valid");
  }catch(Exception failure){pdIncrement(outcome,"failed");if("1".equals(direction))pdIncrement(outcome,"incomingFailed");if("2".equals(direction))pdIncrement(outcome,"outgoingFailed");pdFailed(report,stage,failure);}
  finally{if(closeStream!=null)handler.removeCallbacks(closeStream);if(input!=null)try{input.close();}catch(Exception ignored){}if(row!=null)try{row.close();}catch(Exception ignored){}}
}

JSONObject pdRun(Context ctx) {
  long now=System.currentTimeMillis(),deadline=now+25000L;
  JSONObject report=new JSONObject().put("format","slope-rcs-pending-diagnostic-v2").put("status","diagnostic_only").put("scope","known_unacked_v10_last7days").put("collectionVerified",false);
  report.put("states",pdZero(new String[]{"found","inspected","valid","invalid","oversize"}));
  report.put("pending",pdZero(new String[]{"known","inspected","chat","ft","expired","invalidKeys","duplicateKeys","deferredRetry"}));
  JSONObject results=new JSONObject();String[] providers=new String[]{"chat","ft"};for(int i=0;i<providers.length;i++)results.put(providers[i],pdZero(new String[]{"inspected","valid","failed","missing","stale","incoming","outgoing","incomingFailed","outgoingFailed"}));report.put("results",results);
  report.put("stages",pdZero(new String[]{"state","query","peer","text","size","open","read","length","mime"}));
  report.put("errors",new JSONObject()).put("exceptions",new JSONObject()).put("declaredMime",new JSONObject()).put("observedMime",new JSONObject()).put("media",pdZero(new String[]{"exactLength","validatedBytes"}));
  report.put("peerFailureReasons",new JSONObject()).put("threadTypes",new JSONObject());
  report.put("descriptor",pdZero(new String[]{"attempted","opened","unavailable","zeroOffset","nonzeroOffset"})).put("descriptorErrors",new JSONObject());
  report.put("descriptorDeclaredVsMetadata",new JSONObject()).put("jpegTailMarker",new JSONObject());
  report.put("descriptorLengthVsMetadata",new JSONObject()).put("descriptorStatVsMetadata",new JSONObject()).put("streamLengthVsMetadata",new JSONObject()).put("streamLengthVsDescriptor",new JSONObject()).put("streamLengthVsStat",new JSONObject());
  report.put("streamLengthByDirection",new JSONObject().put("incoming",new JSONObject()).put("outgoing",new JSONObject()));
  report.put("limits",new JSONObject().put("rowCap",64).put("timeBudgetMs",25000).put("rowCapReached",false).put("timeLimitReached",false).put("stateCapReached",false).put("entryCapReached",false));
  final CancellationSignal signal=new CancellationSignal();Handler handler=new Handler(Looper.getMainLooper());Runnable cancel=new Runnable(){public void run(){signal.cancel();}};handler.postDelayed(cancel,25000L);
  try{
    SharedPreferences prefs=ctx.getSharedPreferences("slope_rcs_v10",0);Map all=prefs.getAll();List candidates=new ArrayList();Set seen=new HashSet();int scanned=0,statesRead=0;Iterator states=all.keySet().iterator();
    while(states.hasNext()){
      Object keyObject=states.next();if(!(keyObject instanceof String)||!((String)keyObject).startsWith("state_"))continue;pdIncrement(report.getJSONObject("states"),"found");
      if(statesRead>=8){report.getJSONObject("limits").put("stateCapReached",true);continue;}pdDeadline(deadline);statesRead++;pdIncrement(report.getJSONObject("states"),"inspected");
      try{
        Object value=all.get(keyObject);if(!(value instanceof String))throw new Exception("RCS_SCHEMA_UNSUPPORTED");String raw=(String)value;
        if(raw.length()>4194304){pdIncrement(report.getJSONObject("states"),"oversize");continue;}
        JSONObject state=new JSONObject(raw);if(state.optInt("version")!=10||state.optLong("collectFrom")<=0L)throw new Exception("RCS_SCHEMA_UNSUPPORTED");
        JSONObject entries=state.optJSONObject("entries");if(entries==null)throw new Exception("RCS_SCHEMA_UNSUPPORTED");pdIncrement(report.getJSONObject("states"),"valid");
        long floor=Math.max(state.getLong("collectFrom"),now-604800000L);Iterator keys=entries.keys();
        while(keys.hasNext()){
          pdDeadline(deadline);if(scanned>=24000){report.getJSONObject("limits").put("entryCapReached",true);break;}scanned++;
          String key=(String)keys.next();JSONObject entry=entries.optJSONObject(key);if(entry==null){pdIncrement(report.getJSONObject("pending"),"invalidKeys");continue;}if(entry.optBoolean("acked"))continue;
          if(!key.matches("(chat|ft):[0-9]{1,20}")){pdIncrement(report.getJSONObject("pending"),"invalidKeys");continue;}
          long at=entry.optLong("at");if(at<floor||at>now){pdIncrement(report.getJSONObject("pending"),"expired");continue;}
          if(seen.contains(key)){pdIncrement(report.getJSONObject("pending"),"duplicateKeys");continue;}seen.add(key);
          String provider=key.substring(0,key.indexOf(':')),id=key.substring(key.indexOf(':')+1);pdIncrement(report.getJSONObject("pending"),"known");pdIncrement(report.getJSONObject("pending"),provider);if(entry.optLong("retryAt")>now)pdIncrement(report.getJSONObject("pending"),"deferredRetry");
          candidates.add(new JSONObject().put("provider",provider).put("id",id).put("at",at).put("floor",floor));
        }
      }catch(Exception failure){pdIncrement(report.getJSONObject("states"),"invalid");pdFailed(report,"state",failure);}
    }
    // Newest pending records first; candidate IDs never enter the report.
    Collections.sort(candidates,new Comparator(){public int compare(Object a,Object b){long x=((JSONObject)a).getLong("at"),y=((JSONObject)b).getLong("at");return x==y?0:x<y?1:-1;}});
    ContentResolver resolver=ctx.getContentResolver();Map verifiedThreads=new HashMap();
    for(int i=0;i<candidates.size();i++){
      if(i>=64){report.getJSONObject("limits").put("rowCapReached",true);break;}
      if(System.currentTimeMillis()>=deadline||signal.isCanceled()){report.getJSONObject("limits").put("timeLimitReached",true);break;}
      JSONObject candidate=(JSONObject)candidates.get(i);pdIncrement(report.getJSONObject("pending"),"inspected");
      pdInspect(resolver,candidate.getString("provider"),candidate.getString("id"),candidate.getLong("floor"),deadline,report,verifiedThreads,signal,handler);
    }
  }catch(Exception failure){pdFailed(report,"state",failure);}
  finally{handler.removeCallbacks(cancel);if(System.currentTimeMillis()>=deadline)report.getJSONObject("limits").put("timeLimitReached",true);}
  return report;
}
JSONObject pdReport=pdRun(context);String pdSummary=pdReport.toString();boolean pdCopied=false;
try{ClipboardManager clipboard=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);if(clipboard!=null){clipboard.setPrimaryClip(ClipData.newPlainText("SLOPE 채팅+ 상세 진단 v2",pdSummary));pdCopied=true;}}catch(Exception unavailable){}
tasker.log(pdSummary);
tasker.showToast(pdCopied?"미완료 진단 결과를 복사했습니다. 내용·번호·사진은 포함하지 않습니다.":"미완료 진단이 끝났습니다. Tasker 실행 기록에서 결과를 확인해 주세요.");
return pdSummary;
`;
}

export function buildRcsPendingDiagnosticProject(){
  const code=buildRcsPendingDiagnosticJavaCode(),timestamp=Date.now(),taskId=1998000004;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TaskerData sr="" dvi="1" tv="6.6.18">
<Project sr="proj0" ve="2"><cdate>${timestamp}</cdate><mdate>${timestamp}</mdate><name>SLOPE 채팅+ 상세 진단 v2</name><tids>${taskId}</tids><Img sr="icon" ve="2"><nme>mw_action_info_outline</nme></Img></Project>
<Task sr="task${taskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${taskId}</id><nme>채팅+ 상세 진단 v2 · 실행 후 결과 복사</nme><pri>6</pri>
<Action sr="act0" ve="7"><code>474</code><se>false</se><Str sr="arg0" ve="3">${xml(code)}</Str><Str sr="arg1" ve="3">%crm_rcs_pending_diagnostic_v2</Str><Int sr="arg2" val="1"/></Action>
</Task></TaskerData>`;
}
