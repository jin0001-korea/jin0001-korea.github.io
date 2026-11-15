/* Push-only worker: no cache of private lesson records, photos, or auth tokens. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function notificationPath(value){
 try{const url=new URL(value,self.location.origin);if(url.origin===self.location.origin&&!url.search&&url.pathname==='/booking/'&&url.hash==='#changes')return '/booking/#changes';}catch{}
 return '/#alerts';
}
self.addEventListener('push',event=>{
 // The remote message is generic text and an allowlisted app route. Never expose
 // customer names, lesson identifiers, teacher IDs, report text, or comments.
 let path='/#alerts';try{path=notificationPath(event.data?.json()?.url);}catch{}
 event.waitUntil(self.registration.showNotification('SLOPE',{
  body:'새 강습 확인 알림이 있습니다.',
  tag:path==='/booking/#changes'?'slope-customer-request':'slope-new-confirmation',renotify:false,
  data:{url:path},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const target=new URL(notificationPath(event.notification.data?.url),self.location.origin).href;
 event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate(target);await client.focus();return;}}await self.clients.openWindow(target);})());
});
