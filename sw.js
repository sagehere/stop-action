const CACHE='stop-action-v20';
const ASSETS=['./','./index.html','./db.js','./training-core.js','./content.js','./plans.js','./backup.js','./plan-ui.js','./app.js','./manifest.webmanifest','./icon.svg'];
const allowed=new Set(ASSETS.map(asset=>new URL(asset,self.location).href));
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('message',e=>{if(e.data?.type==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('stop-action-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
  if(!allowed.has(url.href)&&e.request.mode!=='navigate')return;
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(e.request);
    if(cached)return cached;
    try{const response=await fetch(e.request);if(response.ok&&allowed.has(url.href))await cache.put(e.request,response.clone());return response;}
    catch{if(e.request.mode==='navigate')return await cache.match('./index.html')||Response.error();return Response.error();}
  })());
});
