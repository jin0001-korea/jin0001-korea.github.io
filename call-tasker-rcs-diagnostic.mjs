// Manual provider visibility diagnostic. A readable provider is not proof of
// complete synchronization. No token, networking, media or message content output.
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
export function buildRcsDiagnosticJavaCode({collectFrom}={}){
  const from=collectFrom===undefined?0:typeof collectFrom==='number'?collectFrom:Date.parse(collectFrom);
  if(!Number.isSafeInteger(from)||from<0||collectFrom!==undefined&&from===0)throw Error('진단할 연결 시작 시간을 확인해 주세요.');
  return `// SLOPE RCS storage diagnostic v1: manual and read-only.\nlong crmRcsCollectFrom = ${from}L;\n`+String.raw`
import android.content.ContentResolver;
import android.content.Context;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.sqlite.SQLiteException;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.OperationCanceledException;
import android.os.Build;
import android.provider.Telephony;
import java.util.*;
import org.json.*;

String crmRcsIdentifier(String value){return value!=null&&value.length()<=200&&value.matches("[A-Za-z0-9_.]+")?value:"";}
JSONObject crmRcsMetadata(Context ctx,String authority){
  JSONObject result=new JSONObject().put("status","metadata_unavailable");
  try{
    ProviderInfo info=ctx.getPackageManager().resolveContentProvider(authority,0);
    if(info!=null){
      String permission=crmRcsIdentifier(info.readPermission);
      result.put("status","metadata_visible").put("package",crmRcsIdentifier(info.packageName)).put("exported",info.exported).put("declaredReadPermission",permission);
      if(permission.length()>0)result.put("declaredPermissionGranted",ctx.checkCallingOrSelfPermission(permission)==0);
    }
  }catch(Exception unavailable){}
  // Package visibility can hide metadata. Query results are reported separately.
  return result;
}
long crmRcsTimestamp(Cursor cursor,int index){
  if(index<0||cursor.isNull(index))return 0L;
  try{
    String raw=cursor.getString(index);if(raw==null||!raw.matches("[0-9]{1,16}"))return 0L;
    long value=Long.parseLong(raw);
    if(value>=1000000000000L&&value<=9999999999999L)return value;
    if(value>=1000000000L&&value<=9999999999L)return value*1000L;
  }catch(Exception invalid){}
  return 0L;
}
void crmRcsTypeCount(JSONObject report,Cursor cursor,String column){
  int index=cursor.getColumnIndex(column);if(index<0)return;
  JSONObject histogram=report.optJSONObject(column+"Values");
  if(histogram==null){histogram=new JSONObject();report.put(column+"Values",histogram);}
  String bucket="unknown";
  if(!cursor.isNull(index)){
    String raw=cursor.getString(index);
    if(raw!=null&&raw.matches("[0-9]{1,3}"))try{int value=Integer.parseInt(raw);if(value<=255)bucket=String.valueOf(value);}catch(Exception invalid){}
  }
  if(!histogram.has(bucket)&&histogram.length()>=16)bucket="other";
  histogram.put(bucket,histogram.optInt(bucket)+1);
}
JSONObject crmRcsProbe(ContentResolver resolver,String path,long floor,long now,long deadline){
  JSONObject report=new JSONObject().put("path",path).put("status","not_checked").put("scanned",0).put("inWindow",0).put("beforeWindow",0).put("afterNow",0).put("unknownDate",0).put("chatMarked",0).put("limited",false);
  long remaining=deadline-System.currentTimeMillis();
  if(remaining<=0)return report.put("status","time_limit").put("limited",true);
  final CancellationSignal signal=new CancellationSignal();
  Handler handler=new Handler(Looper.getMainLooper());
  Runnable cancel=new Runnable(){public void run(){signal.cancel();}};
  Cursor cursor=null;
  handler.postDelayed(cancel,Math.min(3000L,remaining));
  try{
    // These observed providers expose date. Inspect recent records first without
    // assuming a timestamp unit or trusting provider selection filtering.
    report.put("ordering","date_desc");
    try{cursor=resolver.query(Uri.parse(path),null,null,null,"date DESC",signal);}
    catch(IllegalArgumentException orderRejected){report.put("ordering","unspecified");cursor=resolver.query(Uri.parse(path),null,null,null,null,signal);}
    catch(SQLiteException orderRejected){report.put("ordering","unspecified");cursor=resolver.query(Uri.parse(path),null,null,null,null,signal);}
    if(cursor==null)report.put("status","provider_unavailable");
    else{
    String[] known=new String[]{"_id","thread_id","address","date","date_sent","type","msg_box","m_type","s_chat","body","sub_id","content_type","direction","message_type","file_size","file_path","file_uri","remote_uri","sender_address","status","is_filetransfer","content_uri"};
    JSONArray columns=new JSONArray();
    for(int index=0;index<known.length;index++)if(cursor.getColumnIndex(known[index])>=0)columns.put(known[index]);
    report.put("knownColumns",columns).put("chatFlagColumn",cursor.getColumnIndex("s_chat")>=0);
    int dateIndex=cursor.getColumnIndex("date"),sentIndex=cursor.getColumnIndex("date_sent"),chatIndex=cursor.getColumnIndex("s_chat");
    if(dateIndex<0&&sentIndex<0)report.put("status","schema_only");
    else{
    while(report.getInt("scanned")<500&&System.currentTimeMillis()<deadline&&!signal.isCanceled()&&cursor.moveToNext()){
      report.put("scanned",report.getInt("scanned")+1);
      long at=crmRcsTimestamp(cursor,dateIndex);if(at==0L)at=crmRcsTimestamp(cursor,sentIndex);
      if(at==0L){report.put("unknownDate",report.getInt("unknownDate")+1);continue;}
      if(at<floor){report.put("beforeWindow",report.getInt("beforeWindow")+1);continue;}
      if(at>now){report.put("afterNow",report.getInt("afterNow")+1);continue;}
      report.put("inWindow",report.getInt("inWindow")+1);
      if(chatIndex>=0&&!cursor.isNull(chatIndex)&&"1".equals(cursor.getString(chatIndex)))report.put("chatMarked",report.getInt("chatMarked")+1);
      crmRcsTypeCount(report,cursor,"type");crmRcsTypeCount(report,cursor,"direction");crmRcsTypeCount(report,cursor,"msg_box");crmRcsTypeCount(report,cursor,"m_type");
    }
    boolean limited=report.getInt("scanned")>=500||System.currentTimeMillis()>=deadline||signal.isCanceled();
    report.put("limited",limited).put("status",signal.isCanceled()?"query_timeout":report.getInt("scanned")==0?"readable_empty":"readable_sample");
    }
    }
  }catch(SecurityException denied){report.put("status","permission_required");}
  catch(OperationCanceledException cancelled){report.put("status","query_timeout").put("limited",true);}
  catch(IllegalArgumentException rejected){report.put("status","query_rejected");}
  catch(Exception unreadable){report.put("status","provider_error");}
  finally{handler.removeCallbacks(cancel);if(cursor!=null)try{cursor.close();}catch(Exception ignored){}}
  return report;
}
JSONObject crmRcsRun(Context ctx,long collectFrom){
  long now=System.currentTimeMillis(),floor=Math.max(collectFrom,now-604800000L),deadline=now+15000L;
  JSONObject report=new JSONObject().put("format","slope-rcs-storage-diagnostic-v1").put("status","diagnostic_only").put("scope","bounded_visible_sample_last7days").put("collectionVerified",false).put("androidSdk",Build.VERSION.SDK_INT);
  String defaultApp="";try{defaultApp=crmRcsIdentifier(Telephony.Sms.getDefaultSmsPackage(ctx));}catch(Exception unavailable){}
  report.put("defaultSmsPackage",defaultApp).put("callerPackage",crmRcsIdentifier(ctx.getPackageName()));
  JSONObject metadata=new JSONObject();String[] authorities=new String[]{"sms","mms","im"};
  for(int index=0;index<authorities.length;index++)metadata.put(authorities[index],crmRcsMetadata(ctx,authorities[index]));
  report.put("providerMetadata",metadata);
  String[] paths=new String[]{"content://sms","content://mms","content://im/chat","content://im/ft","content://im/rcs_read_im"};
  JSONArray probes=new JSONArray();ContentResolver resolver=ctx.getContentResolver();
  for(int index=0;index<paths.length;index++)probes.put(crmRcsProbe(resolver,paths[index],floor,now,deadline));
  return report.put("probes",probes);
}
JSONObject crmRcsReport=crmRcsRun(context,crmRcsCollectFrom);
String crmRcsSummary=crmRcsReport.toString();boolean crmRcsCopied=false;
try{ClipboardManager clipboard=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);if(clipboard!=null){clipboard.setPrimaryClip(ClipData.newPlainText("SLOPE 채팅+ 저장소 진단",crmRcsSummary));crmRcsCopied=true;}}catch(Exception unavailable){}
tasker.log(crmRcsSummary);
tasker.showToast(crmRcsCopied?"저장소 진단 완료 · 내용과 번호를 제외한 결과를 복사했습니다. 채팅에 붙여넣어 주세요.":"저장소 진단 완료 · Tasker 실행 기록에서 결과를 확인해 주세요.");
return crmRcsSummary;
`;
}
export function buildRcsDiagnosticProject(options={}){
  const code=buildRcsDiagnosticJavaCode(options),timestamp=Date.now(),taskId=1998000002;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TaskerData sr="" dvi="1" tv="6.6.18">
<Project sr="proj0" ve="2"><cdate>${timestamp}</cdate><mdate>${timestamp}</mdate><name>SLOPE 채팅+ 저장소 진단</name><tids>${taskId}</tids><Img sr="icon" ve="2"><nme>mw_action_info_outline</nme></Img></Project>
<Task sr="task${taskId}"><cdate>${timestamp}</cdate><edate>${timestamp}</edate><id>${taskId}</id><nme>채팅+ 저장소 진단 · 실행 후 결과 복사</nme><pri>6</pri>
<Action sr="act0" ve="7"><code>474</code><se>false</se><Str sr="arg0" ve="3">${xml(code)}</Str><Str sr="arg1" ve="3">%crm_rcs_storage_diagnostic</Str><Int sr="arg2" val="1"/></Action>
</Task></TaskerData>`;
}
