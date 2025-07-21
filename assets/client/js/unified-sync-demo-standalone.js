import{f as $t,c as R,a as He,o as Dt,b as It,t as L,i as I,g as O,d as ne,e as he,S as ee,s as Ie,F as Re}from"./web.js";import{c as kt}from"./index.js";import{A as Ct}from"./api-client.js";import{C as le,W as xt}from"./websocket-client.js";import{W as Mt}from"./websocket-status.js";import"./types.js";//! Unified Sync System - Core Types
//!
//! This module defines the foundational types for the new unified sync system.
//! It supports multiple domains (music, photos, documents, etc.) with a single
//! consistent interface while maintaining extensibility for future domains.
var h=(n=>(n.Never="never",n.InProgress="in_progress",n.Complete="complete",n.Failed="failed",n.Paused="paused",n))(h||{}),D=(n=>(n.Started="started",n.Progress="progress",n.DomainCompleted="domain_completed",n.AllCompleted="all_completed",n.Failed="failed",n.Paused="paused",n.Resumed="resumed",n.BinaryProgress="binary_progress",n.AutoSyncTriggered="auto_sync_triggered",n.ConnectionChanged="connection_changed",n))(D||{});//! Debug Logging Utility
//!
//! Centralized debug logging for the unified sync system.
//! All console output should go through this utility.
const Tt={enabled:!1,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!1}};let Q={...Tt};function ke(n){Q={...Q,...n}}function Ee(){Q.enabled=!0}function Qe(){Q.enabled=!1}function ze(){return Q.timestamps?`[${new Date().toLocaleTimeString()}] `:""}function l(n,...e){Q.enabled&&Q.levels.info&&console.log(`${ze()}${n}`,...e)}function oe(n,...e){Q.enabled&&Q.levels.warn&&console.warn(`${ze()}${n}`,...e)}function P(n,...e){Q.enabled&&Q.levels.error&&console.error(`${ze()}${n}`,...e)}function Bt(){return{...Q}}function Ve(n){Q.enabled=n,console.log(`🐛 Sync debug logging ${n?"ENABLED":"DISABLED"}`)}typeof window<"u"&&(window.syncDebug={enable:()=>Ve(!0),disable:()=>Ve(!1),config:()=>Bt(),configure:ke});//! Service Worker Sync Types
//!
//! This module defines types and interfaces for service worker background sync
//! integration with the unified sync system. It provides type-safe interfaces
//! for background sync registration, event handling, and coordination between
//! the main thread and service worker.
var K=(n=>(n.Pending="pending",n.Running="running",n.Completed="completed",n.Failed="failed",n.Cancelled="cancelled",n))(K||{}),H=(n=>(n.RegisterBackgroundSync="register-background-sync",n.CancelBackgroundSync="cancel-background-sync",n.GetSyncStatus="get-sync-status",n.UpdateConfig="update-config",n.SyncStarted="sync-started",n.SyncProgress="sync-progress",n.SyncCompleted="sync-completed",n.SyncFailed="sync-failed",n.SyncCancelled="sync-cancelled",n.StatusUpdate="status-update",n))(H||{});const Pt={backgroundSyncEnabled:!0,periodicSyncEnabled:!0,periodicSyncInterval:30,maxBackgroundSyncDuration:5*60*1e3,maxConcurrentOperations:3,backgroundSyncDomains:["music","photos"],defaultRetryConfig:{maxRetries:3,baseDelay:1e3,backoffMultiplier:2,maxDelay:3e4,jitterFactor:.1},networkConfig:{wifiOnly:!1,allowCellular:!0,allowMetered:!1,pauseOnSlowConnection:!0},batteryConfig:{minBatteryLevel:.15,pauseOnLowBattery:!0,pauseWhenNotCharging:!1,reducedFrequencyOnBattery:!0}};//! Service Worker Sync Manager Implementation
//!
//! This module provides the main implementation for service worker background sync
//! integration. It handles background sync registration, coordination between main
//! thread and service worker, queue management, and resource-aware scheduling.
class At{config;syncManager;serviceWorkerRegistration=null;messageChannel=null;eventListeners=new Map;operationQueue=new Map;capabilities=null;constructor(e,t={}){this.syncManager=e,this.config={...Pt,...t}}async initialize(){console.log("🔧 Initializing Service Worker Sync Manager...");try{if(this.capabilities=await this.getCapabilities(),!this.capabilities.serviceWorker){console.warn("⚠️ Service Workers not supported, background sync disabled");return}await this.registerServiceWorker({scriptURL:"/service-worker.js",scope:"/"}),await this.setupMessageChannel(),await this.updateConfig(this.config),this.capabilities.periodicBackgroundSync&&this.config.periodicSyncEnabled&&await this.setupPeriodicSync(),console.log("✅ Service Worker Sync Manager initialized")}catch(e){throw console.error("❌ Failed to initialize Service Worker Sync Manager:",e),e}}async registerBackgroundSync(e){if(!this.capabilities?.backgroundSync)throw new Error("Background sync not supported");if(!this.config.backgroundSyncDomains.includes(e.domain))throw new Error(`Domain ${e.domain} not enabled for background sync`);const t=this.generateOperationId(),i={...e,id:t,status:K.Pending,createdAt:new Date,retryCount:0,maxRetries:e.maxRetries||this.config.defaultRetryConfig.maxRetries,retryDelay:e.retryDelay||this.config.defaultRetryConfig.baseDelay};this.operationQueue.set(t,i);const s={type:H.RegisterBackgroundSync,id:this.generateMessageId(),timestamp:new Date,operation:e};return await this.sendMessageToServiceWorker(s),"sync"in this.serviceWorkerRegistration&&await this.serviceWorkerRegistration.sync.register(`unified-sync-${t}`),console.log(`📝 Registered background sync operation: ${t} (${e.domain})`),t}async cancelBackgroundSync(e){const t=this.operationQueue.get(e);if(!t)throw new Error(`Operation ${e} not found`);t.status=K.Cancelled,this.operationQueue.set(e,t);const i={type:H.CancelBackgroundSync,id:this.generateMessageId(),timestamp:new Date,operationId:e};await this.sendMessageToServiceWorker(i),console.log(`🚫 Cancelled background sync operation: ${e}`)}async getSyncStatus(e){const t={type:H.GetSyncStatus,id:this.generateMessageId(),timestamp:new Date,operationId:e};if(await this.sendMessageToServiceWorker(t),e){const i=this.operationQueue.get(e);return i?[i]:[]}return Array.from(this.operationQueue.values())}async updateConfig(e){this.config={...this.config,...e};const t={type:H.UpdateConfig,id:this.generateMessageId(),timestamp:new Date,config:e};await this.sendMessageToServiceWorker(t),console.log("⚙️ Service worker configuration updated")}async getCapabilities(){const e={serviceWorker:"serviceWorker"in navigator,backgroundSync:!1,periodicBackgroundSync:!1,pushAPI:"PushManager"in window,notifications:"Notification"in window};if(e.serviceWorker)try{const t=await navigator.serviceWorker.getRegistration();e.backgroundSync="sync"in(t||{}),e.periodicBackgroundSync="periodicSync"in(t||{})}catch(t){console.warn("Could not check background sync capabilities:",t)}return e}async getResourceStatus(){const e={network:{online:navigator.onLine,type:"unknown"}};if("connection"in navigator){const t=navigator.connection;e.network={online:navigator.onLine,type:t.type||"unknown",effectiveType:t.effectiveType,downlink:t.downlink,rtt:t.rtt,saveData:t.saveData}}if("getBattery"in navigator)try{const t=await navigator.getBattery();e.battery={level:t.level,charging:t.charging,chargingTime:t.chargingTime,dischargingTime:t.dischargingTime}}catch(t){console.warn("Could not get battery information:",t)}if("memory"in performance){const t=performance.memory;e.memory={usedJSHeapSize:t.usedJSHeapSize,totalJSHeapSize:t.totalJSHeapSize,jsHeapSizeLimit:t.jsHeapSizeLimit}}return e}async getQueueState(){const e=Array.from(this.operationQueue.values()),t=e.filter(d=>d.status===K.Running),i=e.filter(d=>d.status===K.Pending),s=e.filter(d=>d.status===K.Failed),o=e.filter(d=>d.status===K.Completed),a=e.length,r=o.length,c=s.length,g=o.length>0?o.reduce((d,p)=>p.startedAt&&p.completedAt?d+(p.completedAt.getTime()-p.startedAt.getTime()):d,0)/o.length:0,f=a>0?r/(r+c):0;return{operations:e,activeOperations:t,pendingOperations:i,failedOperations:s,stats:{totalOperations:a,completedOperations:r,failedOperations:c,averageCompletionTime:g,successRate:f}}}async registerPeriodicSync(e){if(!this.capabilities?.periodicBackgroundSync)throw new Error("Periodic background sync not supported");if(!("periodicSync"in this.serviceWorkerRegistration))throw new Error("Periodic sync not available on registration");await this.serviceWorkerRegistration.periodicSync.register(e.tag,{minInterval:e.minInterval}),console.log(`⏰ Registered periodic sync: ${e.tag} (${e.minInterval}ms)`)}async unregisterPeriodicSync(e){if(!("periodicSync"in this.serviceWorkerRegistration))throw new Error("Periodic sync not available");await this.serviceWorkerRegistration.periodicSync.unregister(e),console.log(`🚫 Unregistered periodic sync: ${e}`)}addEventListener(e,t){this.eventListeners.has(e)||this.eventListeners.set(e,new Set),this.eventListeners.get(e).add(t)}removeEventListener(e,t){const i=this.eventListeners.get(e);i&&i.delete(t)}async destroy(){console.log("🧹 Destroying Service Worker Sync Manager...");const e=Array.from(this.operationQueue.values()).filter(t=>t.status===K.Pending);for(const t of e)try{await this.cancelBackgroundSync(t.id)}catch(i){console.warn(`Failed to cancel operation ${t.id}:`,i)}this.eventListeners.clear(),this.messageChannel&&(this.messageChannel.port1.close(),this.messageChannel.port2.close(),this.messageChannel=null),console.log("✅ Service Worker Sync Manager destroyed")}async registerServiceWorker(e){if(!("serviceWorker"in navigator))throw new Error("Service Workers not supported");try{this.serviceWorkerRegistration=await navigator.serviceWorker.register(e.scriptURL,{scope:e.scope,updateViaCache:e.updateViaCache,type:e.type}),console.log("✅ Service Worker registered:",this.serviceWorkerRegistration.scope),await navigator.serviceWorker.ready}catch(t){throw console.error("❌ Service Worker registration failed:",t),t}}async setupMessageChannel(){if(!this.serviceWorkerRegistration)throw new Error("Service Worker not registered");this.messageChannel=new MessageChannel,this.messageChannel.port1.onmessage=t=>{this.handleServiceWorkerMessage(t.data)};const e=this.serviceWorkerRegistration.active;e&&e.postMessage({type:"INIT_PORT"},[this.messageChannel.port2]),console.log("📡 Message channel established with service worker")}async setupPeriodicSync(){try{await this.registerPeriodicSync({tag:"unified-sync-periodic",minInterval:this.config.periodicSyncInterval*60*1e3}),console.log("⏰ Periodic sync configured")}catch(e){console.warn("⚠️ Could not set up periodic sync:",e)}}async sendMessageToServiceWorker(e){if(!this.messageChannel)throw new Error("Message channel not established");this.messageChannel.port1.postMessage(e)}handleServiceWorkerMessage(e){console.log("📨 Received message from service worker:",e.type),this.updateOperationFromMessage(e);const t=this.eventListeners.get(e.type);t&&t.forEach(i=>{try{i(e)}catch(s){console.error("Error in service worker message listener:",s)}})}updateOperationFromMessage(e){let t;switch(e.type){case H.SyncStarted:t=e.operationId;break;case H.SyncProgress:t=e.operationId;break;case H.SyncCompleted:t=e.operationId;break;case H.SyncFailed:t=e.operationId;break;case H.SyncCancelled:t=e.operationId;break}if(t){const i=this.operationQueue.get(t);if(i){switch(e.type){case H.SyncStarted:i.status=K.Running,i.startedAt=new Date;break;case H.SyncCompleted:i.status=K.Completed,i.completedAt=new Date,i.result=e.result;break;case H.SyncFailed:i.status=K.Failed,i.error=e.error,i.retryCount=e.retryCount,i.lastAttempt=new Date;break;case H.SyncCancelled:i.status=K.Cancelled;break}this.operationQueue.set(t,i)}}}generateOperationId(){return`sw-sync-${Date.now()}-${Math.random().toString(36).substr(2,9)}`}generateMessageId(){return`msg-${Date.now()}-${Math.random().toString(36).substr(2,9)}`}}function Nt(n,e){return new At(n,e)}function Rt(){return"serviceWorker"in navigator&&"ServiceWorkerRegistration"in window&&"sync"in window.ServiceWorkerRegistration.prototype}//! Unified Sync Manager - Core Implementation
//!
//! This is the main implementation of the new unified sync system. It provides
//! a single, clean interface for synchronizing multiple domains (music, photos,
//! documents, etc.) with automatic WebSocket-based updates and service worker support.
class Et{storage;wsClient;apiClient;config;domainConfigs;currentStatus;currentProgress;activeSyncs=new Set;eventListeners=new Map;autoSyncEnabled=!1;autoSyncTimeouts=new Map;serviceWorkerSyncManager=null;constructor(e,t,i,s){this.storage=e,this.wsClient=t,this.apiClient=i,this.config=s,this.domainConfigs=this.createMinimalDomainConfigs(),this.currentStatus={music:h.Never,photos:h.Never,documents:h.Never,videos:h.Never},this.currentProgress={music:this.createEmptyProgress(),photos:this.createEmptyProgress(),documents:this.createEmptyProgress(),videos:this.createEmptyProgress()}}async initialize(){if(l("🚀 Initializing UnifiedSyncManager..."),await this.storage.initialize(),this.setupWebSocketListeners(),await this.loadSyncStates(),this.config.autoSync.enabled&&this.enableAutoSync(!0),this.config.serviceWorker?.enabled&&Rt())try{this.serviceWorkerSyncManager=Nt(this,this.config.serviceWorker),await this.serviceWorkerSyncManager.initialize(),console.log("✅ Service Worker sync initialized")}catch(e){console.warn("⚠️ Service Worker sync initialization failed:",e)}l("✅ UnifiedSyncManager initialized")}async syncAll(e={}){l("🔄 Starting sync all domains...");const t=Date.now(),i=e.domains||Object.keys(this.domainConfigs),o=(e.priorityOrder||i).filter(p=>i.includes(p));i.forEach(p=>{o.includes(p)||o.push(p)});const a=[];let r=0;const c=[];this.emitEvent({type:D.Started,timestamp:new Date,domain:o[0],isFullSync:e.forceFullSync||!1});for(const p of o)try{const C={forceFullSync:e.forceFullSync,includeBinaryData:e.includeBinaryData,include_media_blobs:e.include_media_blobs},w=await this.syncDomain(p,C);a.push(w),r+=w.itemsSynced,w.errors.length>0&&c.push(...w.errors)}catch(C){console.error(`❌ Failed to sync domain ${p}:`,C);const w={code:"DOMAIN_SYNC_FAILED",message:`Failed to sync ${p}: ${C instanceof Error?C.message:String(C)}`,details:C};c.push(w)}const g=Date.now()-t,d={domain:"music",status:c.length>0?h.Failed:h.Complete,itemsSynced:r,totalItems:a.reduce((p,C)=>p+C.totalItems,0),duration:g,errors:c,binaryStats:this.aggregateBinaryStats(a)};return this.emitEvent({type:D.AllCompleted,timestamp:new Date,result:d}),console.log(`✅ Sync all completed: ${r} items in ${g}ms`),d}async syncDomain(e,t={}){if(l(`🔄 Starting sync for domain: ${e}`),this.activeSyncs.has(e))throw new Error(`Sync already in progress for domain: ${e}`);this.activeSyncs.add(e),this.updateStatus(e,h.InProgress);const i=Date.now(),s=[];try{this.emitEvent({type:D.Started,timestamp:new Date,domain:e,isFullSync:t.forceFullSync||!1});const o=await this.syncStructuredData(e,t);let a;t.includeBinaryData&&(e==="music"||e==="photos")&&(l("🔄 Starting binary data sync..."),a=await this.syncBinaryData(e));const r=Date.now()-i,c={domain:e,status:h.Complete,itemsSynced:o.itemsSynced,totalItems:o.totalItems,duration:r,binaryStats:a,errors:s};this.updateStatus(e,h.Complete),this.updateProgress(e,{status:h.Complete,progress:100,itemsProcessed:c.itemsSynced,totalItems:c.totalItems,currentBatch:1,totalBatches:1,currentOperation:"Complete"});const g=e==="music"&&c.breakdown?c.breakdown.songs.itemsSynced:c.itemsSynced;return await this.storage.saveSyncCompletion(e,g),this.emitEvent({type:D.DomainCompleted,timestamp:new Date,domain:e,result:c}),console.log(`✅ Domain ${e} sync completed: ${c.itemsSynced} items`),c}catch(o){P(`❌ Domain ${e} sync failed:`,o);const a={code:"SYNC_FAILED",message:o instanceof Error?o.message:String(o),details:o};s.push(a),this.updateStatus(e,h.Failed),this.emitEvent({type:D.Failed,timestamp:new Date,domain:e,error:a});const r=Date.now()-i;return{domain:e,status:h.Failed,itemsSynced:0,totalItems:0,duration:r,errors:s}}finally{this.activeSyncs.delete(e)}}async getBlobUrl(e){try{const t=await this.storage.getBinaryData(e);if(t){const s=(await this.storage.getItems("documents")).find(o=>o.id===e);if(s){const o=new Blob([t],{type:s.mime||"application/octet-stream"});return URL.createObjectURL(o)}}return`${this.config.apiBaseUrl}/blobs/${e}`}catch(t){return console.error(`Failed to get blob URL for ${e}:`,t),null}}enableAutoSync(e){l(`${e?"🔄 Enabling":"⏸️ Disabling"} auto-sync...`),this.autoSyncEnabled=e,e?this.config.autoSync.periodicInterval&&this.setupPeriodicSync():(this.autoSyncTimeouts.forEach(t=>clearTimeout(t)),this.autoSyncTimeouts.clear())}getStatus(){return{...this.currentStatus}}getProgress(){return{music:{...this.currentProgress.music},photos:{...this.currentProgress.photos},documents:{...this.currentProgress.documents},videos:{...this.currentProgress.videos}}}async destroyAll(){l("💥 Starting complete system teardown...");try{l("⏸️ Disabling auto-sync..."),this.enableAutoSync(!1),l("🛑 Clearing active syncs..."),this.activeSyncs.clear(),l("🔄 Resetting sync status..."),this.currentStatus={music:h.Never,photos:h.Never,documents:h.Never,videos:h.Never},this.currentProgress={music:this.createEmptyProgress(),photos:this.createEmptyProgress(),documents:this.createEmptyProgress(),videos:this.createEmptyProgress()},l("🗑️ Destroying storage database..."),await this.storage.destroyAll(),l("✅ Storage database destroyed"),l("🗑️ Complete system teardown successful"),this.emitEvent({type:D.AllCompleted,timestamp:new Date,result:{domain:"music",status:h.Complete,itemsSynced:0,totalItems:0,duration:0,errors:[]}})}catch(e){throw P("❌ Failed to destroy system:",e),new Error(`System teardown failed: ${e}`)}}async getMediaBlobs(){try{const e=[];try{const s=(await this.storage.getItems("documents")).filter(o=>o.mime&&o.mime.startsWith("image/"));e.push(...s)}catch(i){console.warn("Failed to get media blobs from documents:",i)}try{const i=await this.storage.getItems("photos");for(const s of i)s.thumbnail_blob_id?e.push({id:s.thumbnail_blob_id,mime:"image/jpeg",created_at:s.created_at,type:"thumbnail",photo_id:s.id,title:s.title}):s.media_blob_id&&e.push({id:s.media_blob_id,mime:"image/jpeg",created_at:s.created_at,type:"photo",photo_id:s.id,title:s.title})}catch(i){console.warn("Failed to get photos for image grid:",i)}const t=e.sort((i,s)=>{const o=new Date(i.created_at||0);return new Date(s.created_at||0).getTime()-o.getTime()});return l(`📸 Image grid: Found ${t.length} total images (${t.filter(i=>i.type==="thumbnail").length} thumbnails, ${t.filter(i=>i.type==="photo").length} photos) - sorted by most recent first`),t}catch(e){return console.error("Failed to get media blobs:",e),[]}}async hasBinaryData(e){try{return!!await this.storage.getBinaryData(e)}catch(t){return P(`Failed to check binary data for ${e}:`,t),!1}}async getVideosBreakdown(){try{return await this.storage.getVideosBreakdown()}catch(e){return P("Failed to get videos breakdown:",e),{videos:0,videoPlaylists:0,videoPlaylistItems:0}}}async getStorageStats(){try{return await this.storage.getStats()}catch(e){return P("Failed to get storage stats:",e),{itemCounts:{music:0,photos:0,documents:0,videos:0},totalSize:0,binarySize:0,lastSyncTimes:{music:null,photos:null,documents:null,videos:null}}}}async getMusicBreakdown(){try{return await this.storage.getMusicBreakdown()}catch(e){return P("Failed to get music breakdown:",e),{songs:0,playlists:0,playlistSongs:0}}}async getPhotosBreakdown(){try{return await this.storage.getPhotosBreakdown()}catch(e){return P("Failed to get photos breakdown:",e),{photos:0,galleries:0,photoGalleries:0}}}createMinimalDomainConfigs(){const e={defaultOptions:{pageSize:50,includeBinaryData:!0,forceFullSync:!1},transforms:{fromApi:t=>t,toStorage:t=>t,fromStorage:t=>t}};return{music:{...e,domain:"music",endpoints:{list:"/api/songs",item:"/api/songs/{id}",sync:"/api/sync/songs"}},photos:{...e,domain:"photos",endpoints:{list:"/api/photos",item:"/api/photos/{id}",sync:"/api/sync/photos"}},documents:{...e,domain:"documents",endpoints:{list:"/api/media_blobs",item:"/api/media_blobs/{id}",sync:"/api/sync/media_blobs"}},videos:{...e,domain:"videos",endpoints:{list:"/api/videos",item:"/api/videos/{id}",sync:"/api/sync/videos"}}}}on(e,t){this.eventListeners.has(e)||this.eventListeners.set(e,new Set),this.eventListeners.get(e).add(t)}off(e,t){const i=this.eventListeners.get(e);i&&i.delete(t)}async getServiceWorkerSyncManager(){return this.serviceWorkerSyncManager}async destroy(){console.log("🧹 Destroying UnifiedSyncManager..."),this.enableAutoSync(!1),this.serviceWorkerSyncManager&&(await this.serviceWorkerSyncManager.destroy(),this.serviceWorkerSyncManager=null),this.eventListeners.clear(),this.activeSyncs.clear(),console.log("✅ UnifiedSyncManager destroyed")}async syncStructuredData(e,t={}){const i=this.domainConfigs[e];if(e==="music")return this.syncMusicDomain(t);if(e==="photos")return this.syncPhotosDomain(t);if(e==="videos")return this.syncVideosDomain(t);const s=t.pageSize||i.defaultOptions.pageSize||50;let o=null;t.forceFullSync||(o=null);let a=0,r=0,c=0,g=!0;for(;g&&(!t.maxItems||r<t.maxItems);){a++,console.log(`📄 Syncing ${e} page ${a}...`);const f=new URLSearchParams({page_size:s.toString(),...o&&{cursor:o}}),d=`${this.config.apiBaseUrl}${i.endpoints.sync}?${f}`,p=await fetch(d,{method:"GET",headers:{"Content-Type":"application/json",...this.config.authToken&&{Authorization:`Bearer ${this.config.authToken}`}}});if(!p.ok)throw new Error(`API request failed: ${p.status} ${p.statusText}`);const C=await p.json(),w=C.items||[];if(c=C.total_count||w.length,w.length===0){g=!1;break}const N=w.map(te=>i.transforms.toStorage(i.transforms.fromApi(te)));if(await this.storage.storeItems(e,N),r+=w.length,this.updateProgress(e,{status:h.InProgress,progress:Math.min(100,r/c*100),itemsProcessed:r,totalItems:c,currentBatch:a,totalBatches:Math.ceil(c/s),currentOperation:`Syncing ${e} data`}),this.emitEvent({type:D.Progress,timestamp:new Date,domain:e,progress:this.currentProgress[e]}),o=C.next_cursor,g=!!o&&w.length===s,t.maxItems&&r>=t.maxItems)break}return{itemsSynced:r,totalItems:c}}async syncMusicDomain(e){l("🎵 Starting unified music domain sync...");let t=0,i=0;l("🎵 Syncing songs...");const s=await this.syncMusicDataType("songs",e);t+=s.itemsSynced,i+=s.totalItems,console.log("📋 Syncing playlists...");let o={itemsSynced:0,totalItems:0};try{o=await this.syncMusicDataType("playlists",e),console.log("✅ Playlists sync result:",o),t+=o.itemsSynced,i+=o.totalItems}catch(c){console.error("❌ Playlists sync failed:",c)}console.log("🔗 Syncing playlist songs...");let a={itemsSynced:0,totalItems:0};try{a=await this.syncMusicDataType("playlist-songs",e),console.log("✅ Playlist songs sync result:",a),t+=a.itemsSynced,i+=a.totalItems}catch(c){console.error("❌ Playlist songs sync failed:",c)}let r={itemsSynced:0,totalItems:0};return e.include_media_blobs!==!1?(console.log("📦 Syncing media blobs..."),r=await this.syncMediaBlobs(e),t+=r.itemsSynced,i+=r.totalItems):console.log("⏭️ Skipping media blobs sync (disabled)"),console.log(`✅ Unified music sync complete: ${t} total items`),{itemsSynced:s.itemsSynced,totalItems:s.totalItems,breakdown:{songs:s,playlists:o,playlistSongs:a,mediaBlobs:r}}}async syncPhotosDomain(e){l("🖼️ Starting unified photos domain sync...");let t=0,i=0;l("🖼️ Syncing photos...");const s=await this.syncPhotosDataType("photos",e);t+=s.itemsSynced,i+=s.totalItems,console.log("📁 Syncing galleries...");let o={itemsSynced:0,totalItems:0};try{o=await this.syncPhotosDataType("galleries",e),console.log("✅ Galleries sync result:",o),t+=o.itemsSynced,i+=o.totalItems}catch(r){console.error("❌ Galleries sync failed:",r)}console.log("🔗 Syncing photo galleries...");let a={itemsSynced:0,totalItems:0};try{a=await this.syncPhotosDataType("photo-galleries",e),console.log("✅ Photo galleries sync result:",a),t+=a.itemsSynced,i+=a.totalItems}catch(r){console.error("❌ Photo galleries sync failed:",r)}return console.log(`✅ Unified photos sync complete: ${t} total items`),{itemsSynced:s.itemsSynced,totalItems:s.totalItems,breakdown:{photos:s.itemsSynced,galleries:o.itemsSynced,photoGalleries:a.itemsSynced}}}async syncVideosDomain(e){l("🎬 Starting unified videos domain sync...");const t=await this.syncVideosDataType("videos",e),i=await this.syncVideosDataType("video-playlists",e),s=await this.syncVideosDataType("video-playlist-items",e);return l(`🎬 Videos domain sync completed: ${t.itemsSynced} videos, ${i.itemsSynced} playlists, ${s.itemsSynced} playlist items`),{itemsSynced:t.itemsSynced,totalItems:t.totalItems,breakdown:{videos:t.itemsSynced,videoPlaylists:i.itemsSynced,videoPlaylistItems:s.itemsSynced}}}async syncVideosDataType(e,t){const i=`/api/sync/${e}`,s=t.pageSize||20;let o=0,a=null,r=!0;for(;r;)try{const c=new URLSearchParams;c.append("page_size",s.toString()),a&&c.append("cursor",a),t.forceFullSync!==!0&&t.lastSyncTime&&c.append("last_sync_time",t.lastSyncTime);const g=`${this.config.apiBaseUrl}${i}?${c}`;l(`🔄 Fetching ${e} from: ${g}`);const f=await fetch(g,{headers:{"Content-Type":"application/json"}});if(!f.ok)throw new Error(`HTTP ${f.status}: ${f.statusText}`);const d=await f.json(),p=d.items||[];p.length>0&&(await this.storage.storeItems("videos",p),o+=p.length,l(`✅ Stored ${p.length} ${e} items`)),r=d.pagination?.has_more||!1,a=d.pagination?.next_cursor||null,l(`📄 ${e} page complete: ${p.length} items, hasMore: ${r}`)}catch(c){throw P(`❌ Failed to sync ${e}:`,c),c}return l(`🎬 ${e} sync complete: ${o} items total`),{itemsSynced:o,totalItems:o}}async syncPhotosDataType(e,t){const i=`/api/sync/${e}`,s=t.pageSize||50;let o=0,a=null,r=!0;for(;r;)try{const c=new URLSearchParams;c.append("page_size",s.toString()),a&&c.append("cursor",a),t.forceFullSync!==!0&&t.lastSyncTime&&c.append("last_sync_time",t.lastSyncTime);const g=`${this.config.apiBaseUrl}${i}?${c}`;l(`🔄 Fetching ${e} from: ${g}`);const f=await fetch(g,{headers:{"Content-Type":"application/json"}});if(!f.ok)throw new Error(`HTTP ${f.status}: ${f.statusText}`);const d=await f.json(),p=d.items||[];l(`📦 Received ${p.length} ${e} items`),p.length>0&&(await this.storage.storeItems("photos",p),o+=p.length),r=d.pagination?.has_more===!0,a=d.pagination?.next_cursor||null,l(`📄 Pagination: hasMore=${r}, cursor=${a}, synced=${o}`)}catch(c){throw P(`❌ Failed to sync ${e}:`,c),c}return{itemsSynced:o,totalItems:o}}async syncMusicDataType(e,t){const i=Math.min(t.pageSize||50,100),s=e==="songs"?"/api/sync/songs":e==="playlists"?"/api/sync/playlists":"/api/sync/playlist-songs";let o=null,a=0,r=!0,c=0;const g=20;for(l(`🚀 Starting ${e} sync with pageSize: ${i}`);r&&c<g&&(!t.maxItems||a<t.maxItems);){c++;try{const f=new URLSearchParams({page_size:i.toString()});o!==null&&f.set("cursor",o);const d=`${this.config.apiBaseUrl}${s}?${f}`;l(`🔄 Syncing ${e} page ${c}/${g} from: ${d}`);const p=await fetch(d,{method:"GET",headers:{"Content-Type":"application/json",...this.config.authToken&&{Authorization:`Bearer ${this.config.authToken}`}}});if(!p.ok)throw new Error(`Failed to sync ${e}: ${p.status} ${p.statusText}`);const C=await p.json(),w=C.items||[],N=C.pagination||{};if(l(`📊 ${e} page ${c} response:`,{itemsCount:w.length,hasMore:N.has_more||!1,nextCursor:N.next_cursor||null}),w.length===0){l(`📭 No more ${e} items, stopping sync`);break}const te=JSON.stringify(w).length;te>10*1024*1024&&oe(`⚠️ Large ${e} response: ${te} bytes`);const de=this.domainConfigs.music,ae=w.map(X=>{try{return de.transforms.toStorage(de.transforms.fromApi(X))}catch(T){return P(`❌ Transform error for ${e} item:`,X,T),null}}).filter(X=>X!==null);l(`🔄 Storing ${ae.length} ${e} items to storage`),await this.storeToMusicTable(e,ae),a+=w.length,r=N.has_more||!1,o=N.next_cursor||null,l(`✅ Synced ${e} page ${c}: ${w.length} items (total: ${a})`)}catch(f){P(`❌ Failed to sync ${e} page ${c}:`,f);break}}return l(`🎯 Completed ${e} sync: ${a} total items`),{itemsSynced:a,totalItems:a}}async syncMediaBlobs(e){const t=e.pageSize||50,i="/api/sync/media";let s=null,o=0,a=!0,r=0;for(;a&&(!e.maxItems||o<e.maxItems);){r++;const c=new URLSearchParams({page_size:t.toString(),include_data:"false"});s!==null&&c.set("cursor",s);const g=`${this.config.apiBaseUrl}${i}?${c}`;console.log(`🔄 Syncing media_blobs page ${r} from: ${g}`);const f=await fetch(g,{method:"GET",headers:{"Content-Type":"application/json",...this.config.authToken&&{Authorization:`Bearer ${this.config.authToken}`}}});if(!f.ok)throw new Error(`Failed to sync media_blobs: ${f.status} ${f.statusText}`);const d=await f.json(),p=d.items||[],C=d.pagination||{};if(console.log(`📊 media_blobs page ${r} response:`,{itemsCount:p.length,hasMore:C.has_more||!1,nextCursor:C.next_cursor||null}),p.length===0)break;console.log(`🔄 Storing ${p.length} media_blobs items to storage`),await this.storage.storeItemsToTable("media_blobs",p),o+=p.length,a=C.has_more||!1,s=C.next_cursor||null,console.log(`✅ Synced media_blobs page ${r}: ${p.length} items (total: ${o})`)}return console.log(`🎯 Completed media_blobs sync: ${o} total items`),{itemsSynced:o,totalItems:o}}async storeToMusicTable(e,t){const i=e==="songs"?"songs":e==="playlists"?"playlists":"playlist_songs";i==="songs"?await this.storage.storeItemsToTable("songs",t):i==="playlists"?await this.storage.storeItemsToTable("playlists",t):await this.storage.storeItemsToTable("playlist_songs",t)}async syncBinaryData(e="music"){const t=Date.now();let i=0,s=0,o=[];try{let a;if(e==="photos"){const w=await this.storage.getItems("photos");a=[];for(const N of w)N.media_blob_id&&a.push({id:N.media_blob_id,type:"photo",photo_id:N.id}),N.thumbnail_blob_id&&a.push({id:N.thumbnail_blob_id,type:"thumbnail",photo_id:N.id})}else a=await this.storage.getItems("documents");l(`📦 Found ${a.length} media blobs to check for binary data`);const r=[];for(const w of a)await this.storage.getBinaryData(w.id)||(w.has_binary_data===!0?r.push(w):l(`⏭️ Skipping blob ${w.id} - no database binary data (file-based)`));const c=r.length;l(`📦 Need to sync ${c} binary items`);const g=5;let f=0;const d=[];for(let w=0;w<r.length;w+=g)d.push(r.slice(w,w+g));l(`📦 Processing ${d.length} batches of ${g} items each`);for(let w=0;w<d.length;w++){const N=d[w];if(!N)continue;l(`🔄 Processing batch ${w+1}/${d.length} (${N.length} items)`),this.pendingBinaryRequests.size>20&&oe(`⚠️ High number of pending requests (${this.pendingBinaryRequests.size}) before batch ${w+1}`);const te=Date.now();l(`🚀 Starting batch ${w+1} with ${N.length} items at ${new Date().toLocaleTimeString()}`);const de=await Promise.allSettled(N.map(async(T,Z)=>{const G=f+Z+1,we=Date.now();l(`🔄 [${G}/${c}] Starting request for blob ${T.id} at ${new Date().toLocaleTimeString()}`),this.emitEvent({type:D.BinaryProgress,timestamp:new Date,domain:e,blobId:T.id,progress:c>0?Math.round(G/c*100):0,currentItem:G,totalItems:c});try{const F=await this.requestBinaryDataViaWebSocket(T.id),ue=Date.now()-we;return F?(await this.storage.storeBinaryData(T.id,F),l(`✅ [${G}/${c}] Completed ${T.id} in ${ue}ms (${F.byteLength} bytes)`),{success:!0,blobId:T.id,bytes:F.byteLength}):(oe(`⚠️ [${G}/${c}] No data received for ${T.id} after ${ue}ms`),{success:!1,blobId:T.id,error:"No data received"})}catch(F){const ue=Date.now()-we;return P(`❌ [${G}/${c}] Error for ${T.id} after ${ue}ms:`,F),{success:!1,blobId:T.id,error:F instanceof Error?F.message:String(F)}}}));for(const T of de)if(T.status==="fulfilled"){const Z=T.value;if(Z.success)i++,s+=Z.bytes||0;else{const G=`Failed to sync binary data for ${Z.blobId}: ${Z.error}`;P(G),o.push(G)}}else{const Z=`Batch processing error: ${T.reason}`;P(Z),o.push(Z)}f+=N.length;const ae=Date.now()-te;l(`✅ Completed batch ${w+1}/${d.length} in ${ae}ms - ${i} successful, ${o.length} failed`),l(`📊 Pending requests after batch: ${this.pendingBinaryRequests.size}`);const X=N.filter(T=>this.pendingBinaryRequests.has(T.id));if(X.length>0){oe(`🧹 Found ${X.length} stale pending requests: [${X.map(T=>T.id).join(", ")}]`);for(const T of X)oe(`🧹 Cleaning up stale pending request for ${T.id}`),this.removePendingBinaryRequest(T.id)}w<d.length-1&&(l("⏳ Brief pause before next batch..."),await new Promise(T=>setTimeout(T,100)))}const p=Date.now()-t,C=a.length-i-o.length;return l(`🎉 Binary sync complete: ${i} cached, ${C} skipped, ${o.length} failed, ${s} bytes in ${p}ms`),{cached:i,skipped:C,failed:o.length,bytesDownloaded:s}}catch(a){const r=`Binary sync failed: ${a}`;throw P(r),new Error(r)}}async requestBinaryDataViaWebSocket(e){return new Promise((t,i)=>{if(this.wsClient.getStatus()!==le.Connected){i(new Error(`WebSocket not connected for blob ${e}`));return}if(this.pendingBinaryRequests.size>100){i(new Error(`Too many pending requests (${this.pendingBinaryRequests.size}) - system may be stalled`));return}if(l(`📝 Setting up request for ${e}`),this.addPendingBinaryRequest(e,o=>{const a=new ArrayBuffer(o.data.length);new Uint8Array(a).set(o.data),l(`✅ Received and converted binary data for ${e} (${a.byteLength} bytes)`),t(a)},o=>{P(`❌ Error for ${e}:`,o),i(new Error(`Server error: ${o.message}`))}),!this.wsClient.getMediaBlobData(e)){P(`❌ Failed to send getMediaBlobData request for ${e}`),this.removePendingBinaryRequest(e),i(new Error(`Failed to send WebSocket request for blob ${e}`));return}l(`📤 Sent binary data request for ${e} via existing WebSocket connection (pending: ${this.pendingBinaryRequests.size})`),setTimeout(()=>{this.pendingBinaryRequests.has(e)?l(`⏱️ Request ${e} still pending after 100ms - this is normal`):l(`⚡ Request ${e} completed within 100ms - very fast response!`)},100)})}pendingBinaryRequests=new Map;binaryDataListenerSetup=!1;addPendingBinaryRequest(e,t,i){l(`📝 Adding pending request for ${e} (pending count: ${this.pendingBinaryRequests.size})`),this.pendingBinaryRequests.set(e,{resolve:t,reject:i}),l(`📊 Pending requests after add: ${this.pendingBinaryRequests.size}`),this.binaryDataListenerSetup?l(`📝 Adding request for ${e} to existing listener setup (total pending: ${this.pendingBinaryRequests.size})`):(this.binaryDataListenerSetup=!0,l("🔧 Setting up binary data listeners (ONCE)"),this.wsClient.on("mediaBlobData",s=>{l(`📨 Received mediaBlobData for ${s.id} (${s.data?.length||0} bytes)`),l(`📊 Current pending requests: [${Array.from(this.pendingBinaryRequests.keys()).join(", ")}]`);const o=this.pendingBinaryRequests.get(s.id);o?(l(`✅ Found pending request for ${s.id}, resolving and removing from pending`),this.pendingBinaryRequests.delete(s.id),l(`📊 Pending requests after removal: ${this.pendingBinaryRequests.size}`),o.resolve(s)):oe(`⚠️ No pending request found for ${s.id}! Available requests: [${Array.from(this.pendingBinaryRequests.keys()).join(", ")}]`)}),this.wsClient.on("error",s=>{P("❌ WebSocket error, notifying all pending requests:",s),P(`📊 Clearing ${this.pendingBinaryRequests.size} pending requests due to WebSocket error`),this.pendingBinaryRequests.forEach((o,a)=>{P(`❌ Rejecting pending request for ${a} due to WebSocket error`),o.reject(s)}),this.pendingBinaryRequests.clear()}))}removePendingBinaryRequest(e){const t=this.pendingBinaryRequests.has(e);this.pendingBinaryRequests.delete(e),l(`🗑️ ${t?"Removed":"Attempted to remove non-existent"} pending request for ${e} (remaining: ${this.pendingBinaryRequests.size})`)}setupWebSocketListeners(){}setupPeriodicSync(){if(!this.config.autoSync.periodicInterval)return;const e=this.config.autoSync.periodicInterval*60*1e3;for(const t of this.config.autoSync.domains){const i=setInterval(async()=>{console.log(`⏰ Periodic sync triggered for ${t}`),this.emitEvent({type:D.AutoSyncTriggered,timestamp:new Date,domain:t,trigger:"periodic"});try{await this.syncDomain(t,{includeBinaryData:!0})}catch(s){console.error(`Periodic sync failed for domain ${t}:`,s)}},e);this.autoSyncTimeouts.set(t,i)}}async loadSyncStates(){l("📋 Loading sync states from storage...");const e=await this.storage.getStats();for(const t of Object.keys(this.currentStatus)){const i=e.lastSyncTimes[t];i?(l(`✅ Restored ${t} sync state: ${i.toISOString()} (${e.itemCounts[t]} items)`),this.currentStatus[t]=h.Complete):l(`📝 No previous sync found for ${t}`)}l("📋 Sync state loading complete")}updateStatus(e,t){this.currentStatus[e]=t}updateProgress(e,t){this.currentProgress[e]=t}createEmptyProgress(){return{status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0}}emitEvent(e){const t=this.eventListeners.get(e.type);t&&t.forEach(i=>{try{i(e)}catch(s){P("Error in sync event listener:",s)}})}aggregateBinaryStats(e){const t=e.map(i=>i.binaryStats).filter(i=>!!i);if(t.length!==0)return{cached:t.reduce((i,s)=>i+s.cached,0),skipped:t.reduce((i,s)=>i+s.skipped,0),failed:t.reduce((i,s)=>i+s.failed,0),bytesDownloaded:t.reduce((i,s)=>i+s.bytesDownloaded,0)}}}function zt(n,e,t,i){return new Et(n,e,t,i)}//! Unified Storage Implementation
//!
//! This module provides a unified storage interface for the new sync system.
//! It uses IndexedDB for efficient storage of both structured data and binary content
//! across multiple domains (music, photos, documents, etc.).
class qt{config;db=null;dbName;dbVersion;DOMAIN_TABLES={songs:"songs",playlists:"playlists",playlist_songs:"playlist_songs",photos:"photos",galleries:"galleries",photo_galleries:"photo_galleries",videos:"videos",video_playlists:"video_playlists",video_playlist_items:"video_playlist_items",media_blobs:"media_blobs",media_blob_data:"media_blob_data"};METADATA_STORE="sync_metadata";getMusicTables(){return["songs","playlists","playlist_songs"]}getPhotosTables(){return["photos","galleries","photo_galleries"]}getVideosTables(){return["videos","video_playlists","video_playlist_items"]}getDomainTable(e){switch(e){case"music":return"songs";case"photos":return"photos";case"videos":return"videos";case"documents":return"media_blobs";default:return"media_blobs"}}constructor(e){this.config=e,this.dbName=e.databaseName,this.dbVersion=e.version}async initialize(){return l(`📦 Initializing unified storage: ${this.dbName} v${this.dbVersion}`),new Promise((e,t)=>{const i=indexedDB.open(this.dbName,this.dbVersion);i.onerror=()=>{t(new Error(`Failed to open database: ${i.error?.message}`))},i.onsuccess=()=>{this.db=i.result,l("✅ Unified storage initialized"),e()},i.onupgradeneeded=s=>{const o=s.target.result;this.setupDatabase(o)}})}async storeItems(e,t){if(!this.db)throw new Error("Storage not initialized");if(e==="music")return this.storeMusicItems(t);if(e==="photos")return this.storePhotosItems(t);if(e==="videos")return this.storeVideosItems(t);const i=this.getDomainTable(e),o=this.db.transaction([i],"readwrite").objectStore(i);for(const a of t)await this.promisifyRequest(o.put({...a,_domain:e,_stored_at:new Date().toISOString()}));await this.updateDomainMetadata(e,{last_sync:new Date().toISOString(),item_count:await this.countItems(e)}),l(`✅ Stored ${t.length} items in music domain`)}async storeVideosItems(e){if(!this.db)throw new Error("Storage not initialized");const t=e.filter(r=>r._data_type==="video"),i=e.filter(r=>r._data_type==="video_playlist"),s=e.filter(r=>r._data_type==="video_playlist_item"),o=this.getVideosTables(),a=this.db.transaction(o,"readwrite");if(t.length>0){const r=a.objectStore("videos");for(const c of t){const g={...c,_stored_at:new Date().toISOString()};delete g._data_type,r.put(g)}}if(i.length>0){const r=a.objectStore("video_playlists");for(const c of i){const g={...c,_stored_at:new Date().toISOString()};delete g._data_type,r.put(g)}}if(s.length>0){const r=a.objectStore("video_playlist_items");for(const c of s){const g={...c,_stored_at:new Date().toISOString()};delete g._data_type,r.put(g)}}return new Promise((r,c)=>{a.oncomplete=()=>{l(`📦 Stored videos items: ${t.length} videos, ${i.length} playlists, ${s.length} playlist items`),r()},a.onerror=()=>c(a.error)})}async storePhotosItems(e){if(!this.db)throw new Error("Storage not initialized");const t=this.getPhotosTables(),i=this.db.transaction(t,"readwrite"),s=e.filter(r=>r._data_type==="photo"),o=e.filter(r=>r._data_type==="gallery"),a=e.filter(r=>r._data_type==="photo_gallery");if(s.length>0){const r=i.objectStore("photos");for(const c of s){const{_data_type:g,...f}=c;await this.promisifyRequest(r.put({...f,_stored_at:new Date().toISOString()}))}}if(o.length>0){const r=i.objectStore("galleries");for(const c of o){const{_data_type:g,...f}=c;await this.promisifyRequest(r.put({...f,_stored_at:new Date().toISOString()}))}}if(a.length>0){const r=i.objectStore("photo_galleries");for(const c of a){const{_data_type:g,...f}=c;await this.promisifyRequest(r.put({...f,_stored_at:new Date().toISOString()}))}}l(`✅ Stored ${e.length} items in photos domain`)}async storeItemsToTable(e,t){if(!this.db)throw new Error("Storage not initialized");const s=this.db.transaction([e],"readwrite").objectStore(e);for(const o of t)await this.promisifyRequest(s.put({...o,_stored_at:new Date().toISOString()}));l(`💾 Stored ${t.length} items to table: ${e}`)}async storeMusicItems(e){if(!this.db)throw new Error("Storage not initialized");const t=e.filter(r=>!r._data_type||r._data_type==="songs"),i=e.filter(r=>r._data_type==="playlists"),s=e.filter(r=>r._data_type==="playlist-songs"),o=this.getMusicTables(),a=this.db.transaction(o,"readwrite");if(t.length>0){const r=a.objectStore("songs");for(const c of t){const{_data_type:g,...f}=c;await this.promisifyRequest(r.put({...f,_stored_at:new Date().toISOString()}))}}if(i.length>0){const r=a.objectStore("playlists");for(const c of i){const{_data_type:g,...f}=c;await this.promisifyRequest(r.put({...f,_stored_at:new Date().toISOString()}))}}if(s.length>0){const r=a.objectStore("playlist_songs");for(const c of s){const{_data_type:g,...f}=c;await this.promisifyRequest(r.put({...f,_stored_at:new Date().toISOString()}))}}l(`🎵 Stored music: ${t.length} songs, ${i.length} playlists, ${s.length} playlist_songs`)}async getItems(e,t={}){if(!this.db)throw new Error("Storage not initialized");if(e==="music")return this.getMusicItems(t);if(e==="photos")return this.getPhotosItems(t);if(e==="videos")return this.getVideosItems(t);const i=this.getDomainTable(e),a=this.db.transaction([i],"readonly").objectStore(i).getAll(),r=await this.promisifyRequest(a);return this.applyQueryOptions(r,t)}async getMusicItems(e={}){if(!this.db)throw new Error("Storage not initialized");const t=this.getMusicTables(),a=this.db.transaction(t,"readonly").objectStore("songs").getAll(),r=await this.promisifyRequest(a);return this.applyQueryOptions(r,e)}async getPhotosItems(e={}){if(!this.db)throw new Error("Storage not initialized");const t=this.getPhotosTables(),a=this.db.transaction(t,"readonly").objectStore("photos").getAll(),r=await this.promisifyRequest(a);return this.applyQueryOptions(r,e)}applyQueryOptions(e,t){let i=e;if(t.where&&(i=i.filter(s=>Object.entries(t.where).every(([o,a])=>s[o]===a))),t.sortBy){const s=t.sortBy,o=t.sortOrder||"asc";i.sort((a,r)=>{const c=a[s],g=r[s];return c<g?o==="asc"?-1:1:c>g?o==="asc"?1:-1:0})}if(t.offset||t.limit){const s=t.offset||0,o=t.limit?s+t.limit:void 0;i=i.slice(s,o)}return i}async getItem(e,t){if(!this.db)throw new Error("Storage not initialized");const i=this.getDomainTable(e),a=this.db.transaction([i],"readonly").objectStore(i).get(t);return await this.promisifyRequest(a)||null}async deleteItems(e,t){if(!this.db)throw new Error("Storage not initialized");const i=this.getDomainTable(e),o=this.db.transaction([i],"readwrite").objectStore(i);for(const a of t)await this.promisifyRequest(o.delete(a));await this.updateDomainMetadata(e,{item_count:await this.countItems(e)}),console.log(`🗑️ Deleted ${t.length} items from domain: ${e}`)}async clearDomain(e){if(!this.db)throw new Error("Storage not initialized");const t=this.getDomainTable(e),s=this.db.transaction([t],"readwrite").objectStore(t);await this.promisifyRequest(s.clear()),await this.updateDomainMetadata(e,{last_sync:null,item_count:0}),l(`🧹 Cleared all data for domain: ${e}`)}async storeBinaryData(e,t){if(!this.db)throw new Error("Storage not initialized");if(t.byteLength>this.config.maxSize)throw new Error(`Binary data too large: ${t.byteLength} > ${this.config.maxSize}`);const i=this.DOMAIN_TABLES.media_blob_data,o=this.db.transaction([i],"readwrite").objectStore(i);await this.promisifyRequest(o.put({id:e,data:t,stored_at:new Date().toISOString()})),l(`📦 Stored binary data: ${e} (${t.byteLength} bytes)`)}async getBinaryData(e){if(!this.db)throw new Error("Storage not initialized");const t=this.DOMAIN_TABLES.media_blob_data,o=this.db.transaction([t],"readonly").objectStore(t).get(e),a=await this.promisifyRequest(o);if(!a)return null;const r=new Date(a.stored_at);return Math.floor((Date.now()-r.getTime())/(1e3*60*60*24))>this.config.maxAge?(await this.deleteBinaryData(e),null):a.data}async deleteBinaryData(e){if(!this.db)throw new Error("Storage not initialized");const t=this.DOMAIN_TABLES.media_blob_data,s=this.db.transaction([t],"readwrite").objectStore(t);await this.promisifyRequest(s.delete(e)),l(`🗑️ Deleted binary data: ${e}`)}async getStats(){if(!this.db)throw new Error("Storage not initialized");const e={music:await this.countItems("music"),photos:await this.countItems("photos"),documents:await this.countItems("documents"),videos:await this.countItems("videos")},t=await this.calculateBinarySize(),i={music:await this.getLastSyncTime("music"),photos:await this.getLastSyncTime("photos"),documents:await this.getLastSyncTime("documents"),videos:await this.getLastSyncTime("videos")},s=t+Object.values(e).reduce((o,a)=>o+a,0)*1024;return{itemCounts:e,totalSize:s,binarySize:t,lastSyncTimes:i}}async getTableCount(e){if(!this.db)throw new Error("Storage not initialized");try{const s=this.db.transaction([e],"readonly").objectStore(e).count();return await this.promisifyRequest(s)}catch(t){return oe(`Failed to get count for table ${e}:`,t),0}}async getMusicBreakdown(){if(!this.db)throw new Error("Storage not initialized");const[e,t,i]=await Promise.all([this.getTableCount("songs"),this.getTableCount("playlists"),this.getTableCount("playlist_songs")]);return{songs:e,playlists:t,playlistSongs:i}}async getPhotosBreakdown(){if(!this.db)throw new Error("Storage not initialized");const[e,t,i]=await Promise.all([this.getTableCount("photos"),this.getTableCount("galleries"),this.getTableCount("photo_galleries")]);return{photos:e,galleries:t,photoGalleries:i}}async getVideosItems(e={}){if(!this.db)throw new Error("Storage not initialized");const t=this.getVideosTables(),i=this.db.transaction(t,"readonly");let s=[];for(const o of t){const r=i.objectStore(o).getAll(),g=(await this.promisifyRequest(r)).map(f=>({...f,_data_type:o==="videos"?"video":o==="video_playlists"?"video_playlist":"video_playlist_item"}));s=s.concat(g)}return e.limit&&(s=s.slice(0,e.limit)),s}async getVideosBreakdown(){if(!this.db)throw new Error("Storage not initialized");const[e,t,i]=await Promise.all([this.getTableCount("videos"),this.getTableCount("video_playlists"),this.getTableCount("video_playlist_items")]);return{videos:e,videoPlaylists:t,videoPlaylistItems:i}}async saveSyncCompletion(e,t){if(!this.db)throw new Error("Storage not initialized");l(`💾 Saving sync completion for ${e}: ${t} items`),await this.updateDomainMetadata(e,{last_sync:new Date().toISOString(),item_count:t,sync_status:"complete"}),l(`✅ Sync completion saved for ${e}`)}async cleanup(){console.log("🧹 Starting storage cleanup...");const e=this.config.maxAge*24*60*60*1e3,t=Date.now()-e;let i=0,s=0;if(!this.db)throw new Error("Storage not initialized");const o=this.DOMAIN_TABLES.media_blob_data,c=this.db.transaction([o],"readwrite").objectStore(o).openCursor();return new Promise((g,f)=>{c.onsuccess=d=>{const p=d.target.result;if(p){const C=p.value;new Date(C.stored_at).getTime()<t&&(s+=C.data.byteLength,i++,p.delete()),p.continue()}else console.log(`🧹 Cleanup completed: ${i} items, ${s} bytes freed`),g()},c.onerror=()=>{f(new Error(`Cleanup failed: ${c.error?.message}`))}})}setupDatabase(e){l("🔧 Setting up database schema..."),Object.entries(this.DOMAIN_TABLES).forEach(([t,i])=>{if(!e.objectStoreNames.contains(i)){const s=e.createObjectStore(i,{keyPath:"id"});switch(s.createIndex("_stored_at","_stored_at"),t){case"songs":s.createIndex("title","title"),s.createIndex("artist","artist"),s.createIndex("album","album"),s.createIndex("created_at","created_at");break;case"playlists":s.createIndex("title","title"),s.createIndex("created_at","created_at");break;case"playlist_songs":s.createIndex("playlist_id","playlist_id"),s.createIndex("song_id","song_id"),s.createIndex("position","position");break;case"photos":s.createIndex("title","title"),s.createIndex("created_at","created_at"),s.createIndex("width","width"),s.createIndex("height","height");break;case"galleries":s.createIndex("title","title"),s.createIndex("created_at","created_at");break;case"photo_galleries":s.createIndex("gallery_id","gallery_id"),s.createIndex("photo_id","photo_id"),s.createIndex("position","position");break;case"videos":s.createIndex("title","title"),s.createIndex("created_at","created_at"),s.createIndex("duration","duration"),s.createIndex("width_px","width_px"),s.createIndex("height_px","height_px");break;case"video_playlists":s.createIndex("title","title"),s.createIndex("created_at","created_at"),s.createIndex("client_id","client_id");break;case"video_playlist_items":s.createIndex("playlist_id","playlist_id"),s.createIndex("video_id","video_id"),s.createIndex("position","position");break;case"media_blobs":s.createIndex("created_at","created_at"),s.createIndex("mime_type","mime_type"),s.createIndex("sha256","sha256");break}}}),e.objectStoreNames.contains(this.METADATA_STORE)||e.createObjectStore(this.METADATA_STORE,{keyPath:"domain"}),l("✅ Database schema setup complete")}async promisifyRequest(e){return new Promise((t,i)=>{e.onsuccess=()=>t(e.result),e.onerror=()=>i(e.error)})}async countItems(e){if(!this.db)throw new Error("Storage not initialized");if(e==="music"){const a=this.getMusicTables(),r=this.db.transaction(a,"readonly");let c=0;for(const g of a){const d=r.objectStore(g).count();c+=await this.promisifyRequest(d)}return c}if(e==="photos"){const a=this.getPhotosTables(),r=this.db.transaction(a,"readonly");let c=0;for(const g of a){const d=r.objectStore(g).count();c+=await this.promisifyRequest(d)}return c}if(e==="videos"){const a=this.getVideosTables(),r=this.db.transaction(a,"readonly");let c=0;for(const g of a){const d=r.objectStore(g).count();c+=await this.promisifyRequest(d)}return c}const t=this.getDomainTable(e),o=this.db.transaction([t],"readonly").objectStore(t).count();return this.promisifyRequest(o)}async calculateBinarySize(){if(!this.db)return 0;const e=this.DOMAIN_TABLES.media_blob_data,i=this.db.transaction([e],"readonly").objectStore(e);let s=0;const o=i.openCursor();return new Promise((a,r)=>{o.onsuccess=c=>{const g=c.target.result;g?(s+=g.value.data.byteLength,g.continue()):a(s)},o.onerror=()=>{r(new Error(`Failed to calculate binary size: ${o.error?.message}`))}})}async getLastSyncTime(e){const t=await this.getDomainMetadata(e);return t?.last_sync?new Date(t.last_sync):null}async updateDomainMetadata(e,t){if(!this.db)return;const s=this.db.transaction([this.METADATA_STORE],"readwrite").objectStore(this.METADATA_STORE),a={...await this.promisifyRequest(s.get(e))||{domain:e},...t};await this.promisifyRequest(s.put(a))}async getDomainMetadata(e){if(!this.db)return null;const s=this.db.transaction([this.METADATA_STORE],"readonly").objectStore(this.METADATA_STORE).get(e);return await this.promisifyRequest(s)}async destroyAll(){return l("💥 Starting complete database teardown..."),this.db&&(this.db.close(),this.db=null),new Promise((e,t)=>{const i=indexedDB.deleteDatabase(this.dbName);i.onsuccess=()=>{l("🗑️ Database completely destroyed:",this.dbName),e()},i.onerror=()=>{P("❌ Failed to destroy database:",i.error),t(new Error(`Failed to destroy database: ${i.error?.message}`))},i.onblocked=()=>{oe("⚠️ Database deletion blocked - close all tabs using this database")}})}}function Ft(n){return new qt(n)}//! Domain Configurations
//!
//! This module defines the configuration for different sync domains (music, photos,
//! documents, videos). Each domain has its own API endpoints, data transforms,
//! and binary handling rules.
const Ot={domain:"music",endpoints:{list:"/api/media/songs",item:"/api/media/songs/{id}",sync:"/api/sync/songs",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:50,includeBinaryData:!0,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["audio/","image/"],maxFileSize:50*1024*1024,batchSize:3},transforms:{fromApi:n=>({id:n.id,name:n.name,artist:n.artist,album:n.album,duration:n.duration,blob_id:n.blob_id,created_at:n.created_at,updated_at:n.updated_at,metadata:n.metadata||{}}),toStorage:n=>({...n,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:n=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:s,...o}=n;return o}}},Lt={domain:"photos",endpoints:{list:"/api/photos",item:"/api/photos/{id}",sync:"/api/sync/photos",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:100,includeBinaryData:!0,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["image/jpeg","image/png","image/webp"],maxFileSize:20*1024*1024,batchSize:5},transforms:{fromApi:n=>n._data_type==="photo"?{id:n.id,title:n.title,description:n.description,width:n.width,height:n.height,blob_id:n.blob_id,thumbnail_blob_id:n.thumbnail_blob_id,created_at:n.created_at,updated_at:n.updated_at,location:n.location,camera_info:n.camera_info,metadata:n.metadata||{},_data_type:"photo"}:n._data_type==="gallery"?{id:n.id,title:n.title,description:n.description,created_at:n.created_at,updated_at:n.updated_at,metadata:n.metadata||{},_data_type:"gallery"}:n._data_type==="photo_gallery"?{id:n.id,gallery_id:n.gallery_id,photo_id:n.photo_id,position:n.position,created_at:n.created_at,_data_type:"photo_gallery"}:{id:n.id,title:n.title,description:n.description,width:n.width,height:n.height,blob_id:n.blob_id,thumbnail_blob_id:n.thumbnail_blob_id,created_at:n.created_at,updated_at:n.updated_at,location:n.location,camera_info:n.camera_info,metadata:n.metadata||{},_data_type:"photo"},toStorage:n=>({...n,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:n=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:s,...o}=n;return o}}},Wt={domain:"documents",endpoints:{list:"/api/documents",item:"/api/documents/{id}",sync:"/api/sync/documents",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:25,includeBinaryData:!1,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["application/pdf","text/","application/msword"],maxFileSize:100*1024*1024,batchSize:2},transforms:{fromApi:n=>({id:n.id,title:n.title,content:n.content,author:n.author,mime_type:n.mime_type,file_size:n.file_size,blob_id:n.blob_id,version:n.version,created_at:n.created_at,updated_at:n.updated_at,tags:n.tags||[],metadata:n.metadata||{}}),toStorage:n=>({...n,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:n=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:s,...o}=n;return o}}},Ut={domain:"videos",endpoints:{list:"/api/videos",item:"/api/videos/{id}",sync:"/api/sync/videos",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:20,includeBinaryData:!1,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["video/mp4","video/webm","image/"],maxFileSize:500*1024*1024,batchSize:1},transforms:{fromApi:n=>({id:n.id,title:n.title,description:n.description,duration:n.duration,width:n.width,height:n.height,blob_id:n.blob_id,thumbnail_blob_id:n.thumbnail_blob_id,preview_blob_id:n.preview_blob_id,created_at:n.created_at,updated_at:n.updated_at,quality:n.quality,codec:n.codec,metadata:n.metadata||{}}),toStorage:n=>({...n,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:n=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:s,...o}=n;return o}}},jt={music:Ot,photos:Lt,documents:Wt,videos:Ut};function Ht(n){return{...jt}}//! Auto-Sync Notification Router - Phase 3
//!
//! This module handles routing WebSocket notifications to appropriate sync operations.
//! It provides intelligent notification filtering, domain mapping, and debounced sync
//! triggering for real-time auto-sync functionality.
class Vt{syncManager;wsClient;config;isActive=!1;notificationQueue=[];domainDebounceState=new Map;stats={notificationsReceived:0,syncsTriggered:0,lastActivity:0,musicUpdates:0,domainStats:new Map};constructor(e,t,i){this.syncManager=e,this.wsClient=t,this.config=i,this.initializeDomainStates()}async start(){if(this.isActive){this.log("already active");return}this.log("starting auto-sync notification router",{enabled:this.config.enabled,syncRules:this.config.syncRules?.length||0,monitoredChannels:this.config.monitoredChannels}),await this.subscribeToChannels(),this.setupWebSocketListeners(),this.isActive=!0,this.log("auto-sync notification router started")}async stop(){if(!this.isActive){this.log("already stopped");return}this.log("stopping auto-sync notification router"),this.clearAllDebounceTimeouts(),await this.unsubscribeFromChannels(),this.clearWebSocketListeners(),this.isActive=!1,this.log("auto-sync notification router stopped")}async processNotification(e){if(this.log("processNotification called",{channel:e.channel,eventType:e.eventType,isActive:this.isActive,configEnabled:this.config.enabled}),!this.isActive||!this.config.enabled){this.log("router not active or disabled, skipping");return}this.stats.notificationsReceived++,this.stats.lastActivity=Date.now(),e.channel==="MediaBlobs"&&e.eventType==="music.library.updated"&&(this.log("music library update detected",e.payload),this.stats.musicUpdates++);const t=this.getTargetDomains(e);if(t.length===0){this.log("no target domains for notification, skipping");return}this.log("processing notification for domains",{targetDomains:t});for(const i of t){const s={notification:e,receivedAt:Date.now(),domain:i,priority:this.calculatePriority(e,i)};this.shouldTriggerImmediateSync(s)?await this.triggerImmediateSync(s):this.queueForBatchedSync(s)}}getStats(){return{...this.stats,isActive:this.isActive,queueSize:this.notificationQueue.length,domainStats:Object.fromEntries(this.stats.domainStats)}}updateConfig(e){this.config={...this.config,...e},console.log("⚙️ Auto-sync notification router config updated")}getPendingNotifications(e){return e?this.domainDebounceState.get(e)?.pendingNotifications||[]:this.notificationQueue}async forceSyncForDomain(e){console.log(`🔄 Force syncing domain: ${e}`),this.clearDomainDebounce(e),await this.triggerDomainSync(e,"manual",[])}initializeDomainStates(){const e=["music","photos","documents","videos"];for(const t of e)this.domainDebounceState.set(t,{timeout:null,pendingNotifications:[],lastTrigger:0}),this.stats.domainStats.set(t,{triggers:0,lastSync:0})}async subscribeToChannels(){for(const e of this.config.monitoredChannels)this.wsClient.subscribeToNotifications(e)?console.log(`📡 Subscribed to channel: ${e}`):console.warn(`⚠️ Failed to subscribe to channel: ${e}`)}async unsubscribeFromChannels(){for(const e of this.config.monitoredChannels)this.wsClient.unsubscribeFromNotifications(e)&&console.log(`📡 Unsubscribed from channel: ${e}`)}setupWebSocketListeners(){console.log("🔧 AutoSyncNotificationRouter setting up WebSocket listeners"),this.wsClient.on("notification",this.handleWebSocketNotification.bind(this)),this.wsClient.on("statusChange",this.handleConnectionStatusChange.bind(this)),console.log("✅ AutoSyncNotificationRouter WebSocket listeners set up")}clearWebSocketListeners(){this.wsClient.off("notification"),this.wsClient.off("statusChange")}async handleWebSocketNotification(e){this.log("received WebSocket notification",{id:e.id,channel:e.channel,event_type:e.event_type,priority:e.priority});const t={id:e.id,channel:e.channel,eventType:e.event_type,payload:e.payload,priority:e.priority,timestamp:e.timestamp};await this.processNotification(t)}handleConnectionStatusChange(e){console.log(`🔌 WebSocket connection status: ${e}`),e==="connected"&&this.subscribeToChannels()}getTargetDomains(e){const t=[];for(const s of this.config.syncRules)this.doesNotificationMatchRule(e,s)&&t.push(...s.targetDomains);const i=this.getDefaultChannelMapping(e.channel);return i.length>0&&t.length===0&&t.push(...i),[...new Set(t)]}doesNotificationMatchRule(e,t){if(t.channels&&!t.channels.includes(e.channel)||t.eventTypes&&!t.eventTypes.includes(e.eventType)||t.priorities&&!t.priorities.includes(e.priority))return!1;if(t.payloadConditions&&e.payload){for(const[i,s]of Object.entries(t.payloadConditions))if(e.payload[i]!==s)return!1}return!0}getDefaultChannelMapping(e){switch(e){case"MediaBlobs":return["music","photos","videos"];case"ThumbnailJobs":return["photos","videos"];case"UserAuth":return[];case"System":return["music","photos","documents","videos"];case"Analytics":return[];default:return[]}}calculatePriority(e,t){let i=0;switch(e.priority){case"critical":i+=100;break;case"high":i+=75;break;case"medium":i+=50;break;case"low":i+=25;break;default:i+=10}switch(e.channel){case"MediaBlobs":i+=20;break;case"ThumbnailJobs":i+=10;break;case"System":i+=30;break}const s=this.stats.domainStats.get(t);return s&&Date.now()-s.lastSync>3e5&&(i+=15),i}shouldTriggerImmediateSync(e){const{notification:t}=e;return this.config.priorityThresholds.immediate.includes(t.priority)||this.notificationQueue.length>=this.config.maxQueueSize?!0:(t.channel==="MediaBlobs"&&t.eventType==="music.library.updated"&&setTimeout(()=>{console.log("🎵 Music library updated from CLI scan, scheduling delayed sync"),this.triggerDomainSync(e.domain,"notification-immediate",[e])},5e3),!1)}async triggerImmediateSync(e){const{domain:t}=e;console.log(`⚡ Triggering immediate sync for domain: ${t}`),this.clearDomainDebounce(t),await this.triggerDomainSync(t,"notification-immediate",[e])}queueForBatchedSync(e){const{domain:t}=e,i=this.domainDebounceState.get(t);if(!i){console.warn(`No debounce state for domain: ${t}`);return}i.pendingNotifications.push(e),i.timeout&&clearTimeout(i.timeout),i.timeout=setTimeout(async()=>{await this.triggerBatchedSync(t)},this.config.debounceDelay),this.log(`queued notification for batched sync: ${t}`,{pendingCount:i.pendingNotifications.length})}async triggerBatchedSync(e){const t=this.domainDebounceState.get(e);if(!t||t.pendingNotifications.length===0)return;console.log(`📦 Triggering batched sync for domain: ${e} (${t.pendingNotifications.length} notifications)`);const i=[...t.pendingNotifications];t.pendingNotifications=[],t.timeout=null,await this.triggerDomainSync(e,"notification-batched",i)}async triggerDomainSync(e,t,i){const s=this.stats.domainStats.get(e);s&&(s.triggers++,s.lastSync=Date.now()),this.stats.syncsTriggered++;let o={includeBinaryData:!0};const a=i.some(c=>c.notification.channel==="MediaBlobs"&&c.notification.eventType==="music.library.updated");a&&(this.log("using special options for music library update sync"),o={...o,forceRefresh:!0,syncStrategy:"metadata-first"});const r=this.domainDebounceState.get(e);r&&(r.lastTrigger=Date.now()),this.log(`auto-sync triggered for ${e}`,{trigger:t,notificationCount:i.length,notificationIds:i.map(c=>c.notification.id)});try{await this.syncManager.syncDomain(e,o),this.log(`auto-sync completed for ${e}`,a?{musicLibraryUpdate:!0}:{})}catch(c){console.error(`Auto-sync failed for ${e}:`,c)}}clearDomainDebounce(e){const t=this.domainDebounceState.get(e);t?.timeout&&(clearTimeout(t.timeout),t.timeout=null)}clearAllDebounceTimeouts(){for(const[e]of this.domainDebounceState)this.clearDomainDebounce(e)}log(e,t){this.config.debug&&console.log(`[AutoSyncNotificationRouter] ${e}`,t||"")}}function Qt(n,e,t){const s={...{enabled:!0,debounceDelay:5e3,maxQueueSize:50,monitoredChannels:["MediaBlobs","ThumbnailJobs","System"],debug:!1,syncRules:[{id:"music-library-updates",channels:["MediaBlobs"],eventTypes:["music.library.updated"],targetDomains:["music"],priorities:["high"]},{id:"song-database-events",channels:["MediaBlobs"],eventTypes:["song.created","song.updated","song.deleted"],targetDomains:["music"],priorities:["high"]},{id:"media-content-updates",channels:["MediaBlobs"],eventTypes:["content.created","content.updated","content.processed"],targetDomains:["music","photos","videos"],priorities:["high","medium"]},{id:"thumbnail-updates",channels:["ThumbnailJobs"],eventTypes:["thumbnail.completed","thumbnail.batch_completed"],targetDomains:["photos","videos"],priorities:["medium","low"]},{id:"system-updates",channels:["System"],eventTypes:["sync.force_refresh","content.bulk_update"],targetDomains:["music","photos","documents","videos"],priorities:["critical","high"]}],userNotifications:!0,priorityThresholds:{immediate:["critical","high"],batched:["medium","low"]}},...t};return new Vt(n,e,s)}//! Enhanced Auto-Sync Manager - Phase 3
//!
//! This module provides advanced auto-sync capabilities with intelligent scheduling,
//! rule-based triggers, resource awareness, and integration with the service worker
//! background sync system.
class Gt{syncManager;serviceWorkerSyncManager;notificationRouter;config;isEnabled=!1;scheduledSyncs=new Map;activeRules=new Map;resourceMonitor=null;stats={totalSyncsTriggered:0,ruleBasedTriggers:0,scheduledTriggers:0,notificationTriggers:0,backgroundSyncs:0,failedSyncs:0,lastActivity:new Date,domainStats:new Map,resourceOptimizations:0};eventListeners=new Map;constructor(e,t,i,s){this.syncManager=e,this.config=t,this.serviceWorkerSyncManager=i||null,this.notificationRouter=s||null,this.config.resourceAwareness.enabled&&(this.resourceMonitor=new Jt),this.initializeDomainStats(),this.config.customRules.length===0&&(this.config.customRules=this.createDefaultRules())}async enable(){if(this.isEnabled){console.log("🔄 Enhanced auto-sync already enabled");return}console.log("🚀 Enabling enhanced auto-sync..."),this.resourceMonitor&&await this.resourceMonitor.start(),this.setupPeriodicSyncs(),this.installRules(),this.notificationRouter&&await this.setupNotificationIntegration(),this.serviceWorkerSyncManager&&this.config.backgroundSync.enabled&&await this.setupServiceWorkerIntegration(),this.isEnabled=!0,console.log("✅ Enhanced auto-sync enabled")}async disable(){if(!this.isEnabled){console.log("🔄 Enhanced auto-sync already disabled");return}console.log("⏹️ Disabling enhanced auto-sync..."),this.clearAllScheduledSyncs(),this.resourceMonitor&&await this.resourceMonitor.stop(),this.notificationRouter&&await this.notificationRouter.stop(),this.isEnabled=!1,console.log("✅ Enhanced auto-sync disabled")}addRule(e){this.activeRules.set(e.id,e),this.config.customRules.push(e),this.isEnabled&&this.installRule(e),console.log(`📋 Added auto-sync rule: ${e.id}`)}removeRule(e){this.activeRules.delete(e),this.config.customRules=this.config.customRules.filter(i=>i.id!==e);const t=`rule:${e}`;this.scheduledSyncs.has(t)&&(clearTimeout(this.scheduledSyncs.get(t)),this.scheduledSyncs.delete(t)),console.log(`🗑️ Removed auto-sync rule: ${e}`)}async triggerSync(e,t,i){if(!this.isEnabled){console.log("⚠️ Auto-sync disabled, ignoring trigger");return}if(this.resourceMonitor){const s=await this.resourceMonitor.getCurrentState();if(!this.shouldAllowSync(s)){console.log("⚡ Sync blocked by resource constraints"),this.stats.resourceOptimizations++,this.serviceWorkerSyncManager&&this.config.backgroundSync.enabled&&await this.scheduleBackgroundSync(e,t,i);return}}if(this.config.smartScheduling.enabled&&this.isInQuietHours()){console.log("🔕 Sync blocked by quiet hours"),await this.scheduleForLater(e,t,i);return}await this.executeSync(e,t,i)}getStats(){return{...this.stats,domainStats:new Map(this.stats.domainStats)}}updateConfig(e){this.config={...this.config,...e},this.isEnabled&&this.disable().then(()=>this.enable())}on(e,t){this.eventListeners.has(e)||this.eventListeners.set(e,new Set),this.eventListeners.get(e).add(t)}off(e,t){t?this.eventListeners.get(e)?.delete(t):this.eventListeners.delete(e)}getActiveRules(){return Array.from(this.activeRules.values())}async forceSync(e,t){console.log(`🔥 Force sync triggered for ${e}: ${t}`),await this.executeSync(e,"manual",{priority:100})}initializeDomainStats(){const e=["music","photos","documents","videos"];for(const t of e)this.stats.domainStats.set(t,{syncsTriggered:0,lastSync:null,averageInterval:0,failureCount:0})}createDefaultRules(){return[{id:"periodic-all-domains",name:"Periodic Full Sync",domains:["music","photos","documents","videos"],schedule:{type:"periodic",interval:this.config.periodicInterval*60*1e3},conditions:{minBatteryLevel:.3,allowedConnectionTypes:["wifi"],maxMemoryUsage:80},priority:50,enabled:!0},{id:"high-priority-notifications",name:"High Priority Content Updates",domains:["music","photos","videos"],trigger:"notification-immediate",conditions:{notificationPriorities:["critical","high"],minBatteryLevel:.2},priority:90,enabled:!0},{id:"background-low-priority",name:"Background Low Priority Sync",domains:["documents"],schedule:{type:"periodic",interval:36e5},conditions:{preferBackground:!0,minBatteryLevel:.5,allowedConnectionTypes:["wifi"]},priority:20,enabled:!0},{id:"connection-recovery",name:"Connection Recovery Sync",domains:["music","photos","documents","videos"],trigger:"connection-restored",conditions:{minBatteryLevel:.3},priority:70,enabled:!0}]}setupPeriodicSyncs(){for(const e of this.config.customRules)e.schedule&&e.enabled&&this.scheduleRuleExecution(e)}installRules(){for(const e of this.config.customRules)e.enabled&&this.installRule(e)}installRule(e){this.activeRules.set(e.id,e),e.schedule&&this.scheduleRuleExecution(e),console.log(`📋 Installed auto-sync rule: ${e.name}`)}scheduleRuleExecution(e){if(!e.schedule)return;const t=`rule:${e.id}`;this.scheduledSyncs.has(t)&&clearTimeout(this.scheduledSyncs.get(t));let i;switch(e.schedule.type){case"periodic":i=e.schedule.interval||36e5;break;case"daily":i=this.calculateDailyDelay(e.schedule.time||"00:00");break;case"weekly":i=this.calculateWeeklyDelay(e.schedule.dayOfWeek||0,e.schedule.time||"00:00");break;case"cron":i=36e5;break;default:return}const s=setTimeout(async()=>{await this.executeRule(e),e.schedule.type==="periodic"&&this.scheduleRuleExecution(e)},i);this.scheduledSyncs.set(t,s)}async executeRule(e){if(console.log(`📋 Executing auto-sync rule: ${e.name}`),!await this.checkRuleConditions(e)){console.log(`⏭️ Rule conditions not met: ${e.name}`);return}for(const t of e.domains)try{await this.triggerSync(t,"scheduled",{ruleId:e.id,priority:e.priority})}catch(i){console.error(`❌ Rule execution failed for ${t}:`,i)}}async checkRuleConditions(e){if(!e.conditions)return!0;if(this.resourceMonitor){const t=await this.resourceMonitor.getCurrentState();if(e.conditions.minBatteryLevel&&t.battery.level<e.conditions.minBatteryLevel||e.conditions.allowedConnectionTypes&&!e.conditions.allowedConnectionTypes.includes(t.connection.type)||e.conditions.maxMemoryUsage&&t.memory.available>0&&t.memory.used/t.memory.available*100>e.conditions.maxMemoryUsage)return!1}return!0}async setupNotificationIntegration(){this.notificationRouter&&await this.notificationRouter.start()}async setupServiceWorkerIntegration(){this.serviceWorkerSyncManager}async executeSync(e,t,i){try{this.updateSyncStats(e,t),this.emitEvent({type:D.AutoSyncTriggered,domain:e,trigger:t,timestamp:new Date}),this.shouldUseBackgroundSync(t,i)&&this.serviceWorkerSyncManager?(await this.serviceWorkerSyncManager.registerBackgroundSync({type:"background-sync",domain:e,options:{includeBinaryData:!0},priority:i?.priority||50,maxRetries:3,retryDelay:5e3}),this.stats.backgroundSyncs++,console.log(`🔄 Background sync scheduled for ${e}`)):(await this.syncManager.syncDomain(e,{includeBinaryData:!0}),console.log(`✅ Foreground sync completed for ${e}`))}catch(s){this.stats.failedSyncs++;const o=this.stats.domainStats.get(e);throw o&&o.failureCount++,console.error(`❌ Auto-sync failed for ${e}:`,s),s}}shouldUseBackgroundSync(e,t){return!this.config.backgroundSync.enabled||!this.serviceWorkerSyncManager||t?.priority&&t.priority>80?!1:e==="scheduled"?this.config.backgroundSync.prioritizeBackground:!1}updateSyncStats(e,t){switch(this.stats.totalSyncsTriggered++,this.stats.lastActivity=new Date,t){case"scheduled":this.stats.scheduledTriggers++;break;case"notification-immediate":case"notification-batched":this.stats.notificationTriggers++;break;case"manual":this.stats.ruleBasedTriggers++;break}const i=this.stats.domainStats.get(e);if(i){if(i.syncsTriggered++,i.lastSync){const s=Date.now()-i.lastSync.getTime();i.averageInterval=(i.averageInterval+s)/i.syncsTriggered}i.lastSync=new Date}}isInQuietHours(){if(!this.config.smartScheduling.enabled)return!1;const e=new Date,t=e.getHours()*60+e.getMinutes(),i=this.parseTimeString(this.config.smartScheduling.quietHours.start),s=this.parseTimeString(this.config.smartScheduling.quietHours.end);return i<=s?t>=i&&t<=s:t>=i||t<=s}parseTimeString(e){const t=e.split(":"),i=parseInt(t[0]||"0"),s=parseInt(t[1]||"0");return i*60+s}calculateDailyDelay(e){const t=new Date,i=e.split(":"),s=parseInt(i[0]||"0"),o=parseInt(i[1]||"0"),a=new Date(t);return a.setHours(s,o,0,0),a<=t&&a.setDate(a.getDate()+1),a.getTime()-t.getTime()}calculateWeeklyDelay(e,t){const i=new Date,s=t.split(":"),o=parseInt(s[0]||"0"),a=parseInt(s[1]||"0"),r=new Date(i),c=(e-i.getDay()+7)%7;return r.setDate(i.getDate()+c),r.setHours(o,a,0,0),r<=i&&r.setDate(r.getDate()+7),r.getTime()-i.getTime()}async scheduleForLater(e,t,i){const s=this.calculateNextAvailableSlot();setTimeout(async()=>{await this.triggerSync(e,t,i)},s),console.log(`⏰ Sync scheduled for later: ${e} (${s}ms)`)}async scheduleBackgroundSync(e,t,i){this.serviceWorkerSyncManager&&(await this.serviceWorkerSyncManager.registerBackgroundSync({type:"background-sync",domain:e,options:{includeBinaryData:!0},priority:i?.priority||30,maxRetries:3,retryDelay:5e3}),console.log(`🔄 Background sync scheduled for resource-constrained environment: ${e}`))}calculateNextAvailableSlot(){if(this.isInQuietHours()){const e=this.parseTimeString(this.config.smartScheduling.quietHours.end),t=new Date,i=t.getHours()*60+t.getMinutes();let s=e-i;return s<=0&&(s+=24*60),s*60*1e3}return 5*60*1e3}shouldAllowSync(e){const t=this.config.resourceAwareness;return!(e.battery.level<t.batteryThreshold&&!e.battery.charging||!t.connectionTypes.includes(e.connection.type)||e.memory.used/(1024*1024)>t.memoryThreshold)}clearAllScheduledSyncs(){for(const e of this.scheduledSyncs.values())clearTimeout(e);this.scheduledSyncs.clear()}emitEvent(e){const t=this.eventListeners.get(e.type);if(t)for(const i of t)try{i(e)}catch(s){console.error("Error in auto-sync event listener:",s)}}}class Jt{batteryManager=null;connectionInfo=null;memoryInfo=null;async start(){if("getBattery"in navigator)try{this.batteryManager=await navigator.getBattery()}catch(e){console.warn("Battery API not available:",e)}this.connectionInfo=navigator.connection||navigator.mozConnection||navigator.webkitConnection,this.memoryInfo=performance.memory}async stop(){}async getCurrentState(){return{battery:{level:this.batteryManager?.level||1,charging:this.batteryManager?.charging||!1},connection:{type:this.connectionInfo?.type||"unknown",effectiveType:this.connectionInfo?.effectiveType||"4g",downlink:this.connectionInfo?.downlink||10},memory:{used:this.memoryInfo?.usedJSHeapSize||0,available:this.memoryInfo?.totalJSHeapSize||100*1024*1024},performance:{cpuUsage:0,isLowPowerMode:!1}}}}function Yt(n,e,t,i){const o={...{enabled:!0,syncOnNewContent:!0,periodicInterval:30,domains:["music","photos"],debounceDelay:5e3,customRules:[],resourceAwareness:{enabled:!0,batteryThreshold:.2,connectionTypes:["wifi","ethernet"],memoryThreshold:100},smartScheduling:{enabled:!0,quietHours:{start:"22:00",end:"07:00"},adaptiveInterval:!0,minInterval:15,maxInterval:120},backgroundSync:{enabled:!0,prioritizeBackground:!0,fallbackToForeground:!0},userPreferences:{respectDataSaver:!0,respectLowPowerMode:!0,maxDailySync:48}},...e};return new Gt(n,o,t,i)}//! User Notification Manager - Phase 3
//!
//! This module handles user notifications for sync events, providing both
//! in-app notifications and system push notifications for sync status updates,
//! new content availability, and sync completion events.
class Kt{syncManager;serviceWorkerSyncManager;config;isEnabled=!1;inAppNotifications=new Map;debounceTimeouts=new Map;notificationContainer=null;activeNotificationElements=new Map;stats={totalSent:0,inAppSent:0,pushSent:0,byType:{},byDomain:{},interactions:{clicked:0,dismissed:0,actionsTriggered:0},permissions:{push:"default",requested:!1}};constructor(e,t,i){this.syncManager=e,this.config=t,this.serviceWorkerSyncManager=i||null,this.initializeDomainStats()}async initialize(){if(this.isEnabled){console.log("📢 User notification manager already initialized");return}console.log("🚀 Initializing user notification manager..."),this.config.push.enabled&&this.config.push.requestPermission&&await this.requestPushPermission(),this.config.inApp.enabled&&this.setupInAppNotifications(),this.setupSyncEventListeners(),this.serviceWorkerSyncManager&&this.setupServiceWorkerIntegration(),this.isEnabled=!0,console.log("✅ User notification manager initialized")}async shutdown(){this.isEnabled&&(console.log("⏹️ Shutting down user notification manager..."),this.clearAllDebounceTimeouts(),this.clearSyncEventListeners(),this.clearAllInAppNotifications(),this.notificationContainer&&(this.notificationContainer.remove(),this.notificationContainer=null),this.isEnabled=!1,console.log("✅ User notification manager shutdown complete"))}async sendInAppNotification(e){if(!this.config.inApp.enabled||!this.shouldShowNotification(e))return"";const t=this.generateNotificationId(),i={...e,id:t,timestamp:new Date};return this.inAppNotifications.set(t,i),this.displayInAppNotification(i),this.stats.inAppSent++,this.stats.totalSent++,this.updateTypeStats(e.type),e.domain&&this.updateDomainStats(e.domain),this.manageNotificationQueue(),this.playNotificationSound(e.type),this.triggerVibration(e.type),console.log(`📱 In-app notification sent: ${e.title}`),t}async sendPushNotification(e){if(!this.config.push.enabled||!this.hasPushPermission())return!1;if(this.isInQuietHours())return console.log("🔕 Push notification blocked by quiet hours"),!1;try{return this.serviceWorkerSyncManager&&"serviceWorker"in navigator?await(await navigator.serviceWorker.ready).showNotification(e.title,{body:e.body,icon:e.icon||"/icon-192.png",badge:e.badge||"/badge-72.png",tag:e.tag,requireInteraction:e.requireInteraction||!1,data:e.data}):new Notification(e.title,{body:e.body,icon:e.icon||"/icon-192.png",tag:e.tag,requireInteraction:e.requireInteraction||!1,data:e.data}),this.stats.pushSent++,this.stats.totalSent++,console.log(`🔔 Push notification sent: ${e.title}`),!0}catch(t){return console.error("❌ Failed to send push notification:",t),!1}}dismissInAppNotification(e){if(!this.inAppNotifications.get(e))return;const i=this.activeNotificationElements.get(e);i&&(i.remove(),this.activeNotificationElements.delete(e)),this.inAppNotifications.delete(e),this.stats.interactions.dismissed++,console.log(`📱 Dismissed notification: ${e}`)}clearAllInAppNotifications(){for(const e of this.inAppNotifications.keys())this.dismissInAppNotification(e)}getStats(){return{...this.stats,permissions:{push:Notification.permission,requested:this.stats.permissions.requested}}}updateConfig(e){this.config={...this.config,...e},e.inApp&&this.notificationContainer&&this.setupInAppNotifications(),console.log("⚙️ Notification configuration updated")}getActiveNotifications(){return Array.from(this.inAppNotifications.values())}async requestPushPermission(){if(!("Notification"in window))return console.warn("⚠️ Browser doesn't support notifications"),!1;if(Notification.permission==="granted")return!0;if(Notification.permission==="denied")return console.warn("⚠️ Notification permission denied by user"),!1;try{const e=await Notification.requestPermission();return this.stats.permissions.requested=!0,this.stats.permissions.push=e,e==="granted"?(console.log("✅ Push notification permission granted"),!0):(console.log("❌ Push notification permission denied"),!1)}catch(e){return console.error("❌ Error requesting notification permission:",e),!1}}hasPushPermission(){return"Notification"in window&&Notification.permission==="granted"}initializeDomainStats(){const e=["music","photos","documents","videos"];for(const t of e)this.stats.byDomain[t]=0}setupInAppNotifications(){this.notificationContainer&&this.notificationContainer.remove(),this.notificationContainer=document.createElement("div"),this.notificationContainer.id="unified-sync-notifications",this.notificationContainer.className=`notification-container ${this.config.inApp.position}`,this.addNotificationStyles(),document.body.appendChild(this.notificationContainer)}setupSyncEventListeners(){this.syncManager.on(D.AutoSyncTriggered,this.handleAutoSyncTriggered.bind(this)),this.syncManager.on(D.Progress,this.handleSyncProgress.bind(this)),this.syncManager.on(D.AllCompleted,this.handleSyncCompleted.bind(this)),this.syncManager.on(D.DomainCompleted,this.handleDomainCompleted.bind(this)),this.syncManager.on(D.Failed,this.handleSyncFailed.bind(this))}clearSyncEventListeners(){}setupServiceWorkerIntegration(){this.serviceWorkerSyncManager}async handleAutoSyncTriggered(e){if(e.type!==D.AutoSyncTriggered)return;const t=e;await this.sendInAppNotification({type:"info",title:"Auto-sync Started",message:`Syncing ${t.domain} content (${t.trigger})`,domain:t.domain,autoHide:!0,actions:[{id:"view-progress",label:"View Progress",handler:()=>this.showSyncProgress(t.domain)}]})}async handleSyncProgress(e){if(e.type!==D.Progress)return;const t=e,i=`progress-${t.domain}`,s=this.inAppNotifications.get(i);s?(s.progress=t.progress.progress,s.message=`Syncing ${t.domain}: ${t.progress.itemsProcessed}/${t.progress.totalItems} items`,this.updateProgressNotification(s)):this.config.inApp.showProgress&&await this.sendInAppNotification({type:"progress",title:`Syncing ${t.domain}`,message:`${t.progress.itemsProcessed}/${t.progress.totalItems} items`,domain:t.domain,progress:t.progress.progress,autoHide:!1})}async handleSyncCompleted(e){if(e.type!==D.AllCompleted)return;const t=e;await this.sendInAppNotification({type:"success",title:"Sync Complete",message:`Successfully synced ${t.result.itemsSynced} items`,autoHide:!0}),this.config.push.showSyncComplete&&await this.sendPushNotification({title:"Sync Complete",body:`Successfully synced ${t.result.itemsSynced} items`,tag:"sync-complete",requireInteraction:!1})}async handleDomainCompleted(e){const t=e,i=`progress-${t.result.domain}`;this.dismissInAppNotification(i),await this.sendInAppNotification({type:"success",title:`${t.result.domain} Sync Complete`,message:`Synced ${t.result.itemsSynced} items in ${t.result.duration}ms`,domain:t.result.domain,autoHide:!0})}async handleSyncFailed(e){if(e.type!==D.Failed)return;const t=e;await this.sendInAppNotification({type:"error",title:"Sync Failed",message:`Failed to sync ${t.domain}: ${t.error.message}`,domain:t.domain,autoHide:!1,actions:[{id:"retry",label:"Retry",style:"primary",handler:()=>this.retrySyncForDomain(t.domain)},{id:"details",label:"Details",handler:()=>this.showErrorDetails(t.error)}]}),this.config.push.showSyncFailed&&await this.sendPushNotification({title:"Sync Failed",body:`Failed to sync ${t.domain}`,tag:"sync-failed",requireInteraction:!0})}displayInAppNotification(e){if(!this.notificationContainer)return;const t=this.createNotificationElement(e);this.notificationContainer.appendChild(t),this.activeNotificationElements.set(e.id,t),e.autoHide&&this.config.inApp.autoHide&&setTimeout(()=>{this.dismissInAppNotification(e.id)},this.config.inApp.autoHideDelay),requestAnimationFrame(()=>{t.classList.add("show")})}createNotificationElement(e){const t=document.createElement("div");t.className=`notification notification-${e.type}`,t.dataset.id=e.id;const i=`
      <div class="notification-content">
        <div class="notification-header">
          <h4 class="notification-title">${this.escapeHtml(e.title)}</h4>
          <button class="notification-close" data-action="close">×</button>
        </div>
        <p class="notification-message">${this.escapeHtml(e.message)}</p>
        ${e.progress!==void 0?`
          <div class="notification-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${e.progress}%"></div>
            </div>
            <span class="progress-text">${Math.round(e.progress)}%</span>
          </div>
        `:""}
        ${e.actions?`
          <div class="notification-actions">
            ${e.actions.map(s=>`
              <button class="notification-action ${s.style||"secondary"}" data-action="${s.id}">
                ${this.escapeHtml(s.label)}
              </button>
            `).join("")}
          </div>
        `:""}
      </div>
    `;return t.innerHTML=i,t.addEventListener("click",s=>{const a=s.target.dataset.action;if(a==="close")this.dismissInAppNotification(e.id),this.stats.interactions.dismissed++;else if(a&&e.actions){const r=e.actions.find(c=>c.id===a);r&&(r.handler(),this.stats.interactions.actionsTriggered++)}else this.stats.interactions.clicked++}),t}updateProgressNotification(e){const t=this.activeNotificationElements.get(e.id);if(!t)return;const i=t.querySelector(".progress-fill"),s=t.querySelector(".progress-text"),o=t.querySelector(".notification-message");i&&e.progress!==void 0&&(i.style.width=`${e.progress}%`),s&&e.progress!==void 0&&(s.textContent=`${Math.round(e.progress)}%`),o&&(o.textContent=e.message)}addNotificationStyles(){if(document.getElementById("unified-sync-notification-styles"))return;const e=document.createElement("style");e.id="unified-sync-notification-styles",e.textContent=`
      .notification-container {
        position: fixed;
        z-index: 10000;
        max-width: 400px;
        pointer-events: none;
      }

      .notification-container.top-right {
        top: 20px;
        right: 20px;
      }

      .notification-container.top-left {
        top: 20px;
        left: 20px;
      }

      .notification-container.bottom-right {
        bottom: 20px;
        right: 20px;
      }

      .notification-container.bottom-left {
        bottom: 20px;
        left: 20px;
      }

      .notification {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        margin-bottom: 12px;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        pointer-events: auto;
        border-left: 4px solid;
      }

      .notification.show {
        opacity: 1;
        transform: translateX(0);
      }

      .notification-info { border-left-color: #3b82f6; }
      .notification-success { border-left-color: #10b981; }
      .notification-warning { border-left-color: #f59e0b; }
      .notification-error { border-left-color: #ef4444; }
      .notification-progress { border-left-color: #8b5cf6; }

      .notification-content {
        padding: 16px;
      }

      .notification-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .notification-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #111827;
      }

      .notification-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .notification-close:hover {
        color: #374151;
      }

      .notification-message {
        margin: 0 0 12px 0;
        color: #4b5563;
        font-size: 14px;
        line-height: 1.4;
      }

      .notification-progress {
        margin-bottom: 12px;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        background: #e5e7eb;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 4px;
      }

      .progress-fill {
        height: 100%;
        background: #8b5cf6;
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 12px;
        color: #6b7280;
      }

      .notification-actions {
        display: flex;
        gap: 8px;
      }

      .notification-action {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid;
        transition: all 0.2s ease;
      }

      .notification-action.primary {
        background: #3b82f6;
        color: white;
        border-color: #3b82f6;
      }

      .notification-action.primary:hover {
        background: #2563eb;
        border-color: #2563eb;
      }

      .notification-action.secondary {
        background: white;
        color: #374151;
        border-color: #d1d5db;
      }

      .notification-action.secondary:hover {
        background: #f9fafb;
        border-color: #9ca3af;
      }

      .notification-action.danger {
        background: #ef4444;
        color: white;
        border-color: #ef4444;
      }

      .notification-action.danger:hover {
        background: #dc2626;
        border-color: #dc2626;
      }
    `,document.head.appendChild(e)}manageNotificationQueue(){const e=Array.from(this.inAppNotifications.values()),t=this.config.inApp.maxNotifications;if(e.length>t){const s=e.sort((o,a)=>o.timestamp.getTime()-a.timestamp.getTime()).slice(0,e.length-t);for(const o of s)this.dismissInAppNotification(o.id)}}shouldShowNotification(e){return!(e.domain&&!this.config.filters.domains.includes(e.domain))}isInQuietHours(){const e=new Date,t=e.getHours()*60+e.getMinutes(),i=this.parseTimeString(this.config.push.quietHours.start),s=this.parseTimeString(this.config.push.quietHours.end);return i<=s?t>=i&&t<=s:t>=i||t<=s}parseTimeString(e){const t=e.split(":"),i=parseInt(t[0]||"0"),s=parseInt(t[1]||"0");return i*60+s}playNotificationSound(e){if(this.config.feedback.enableSounds)try{const t=this.config.feedback.customSounds[e]||this.getDefaultSoundUrl(e);if(t){const i=new Audio(t);i.volume=this.config.feedback.soundVolume,i.play().catch(s=>{console.warn("Failed to play notification sound:",s)})}}catch(t){console.warn("Error playing notification sound:",t)}}triggerVibration(e){if(!(!this.config.feedback.enableVibration||!("vibrate"in navigator)))try{let t;switch(e){case"success":t=[100];break;case"error":t=[100,50,100];break;case"warning":t=[150];break;default:t=[50]}navigator.vibrate(t)}catch(t){console.warn("Error triggering vibration:",t)}}getDefaultSoundUrl(e){return{success:"/sounds/success.mp3",error:"/sounds/error.mp3",warning:"/sounds/warning.mp3",info:"/sounds/info.mp3"}[e]||null}updateTypeStats(e){this.stats.byType[e]=(this.stats.byType[e]||0)+1}updateDomainStats(e){this.stats.byDomain[e]=(this.stats.byDomain[e]||0)+1}generateNotificationId(){return`notif-${Date.now()}-${Math.random().toString(36).substr(2,9)}`}escapeHtml(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}clearAllDebounceTimeouts(){for(const e of this.debounceTimeouts.values())clearTimeout(e);this.debounceTimeouts.clear()}showSyncProgress(e){console.log(`📊 Showing sync progress for ${e}`)}async retrySyncForDomain(e){console.log(`🔄 Retrying sync for ${e}`);try{await this.syncManager.syncDomain(e)}catch(t){console.error("Retry failed:",t)}}showErrorDetails(e){console.log("📋 Showing error details:",e)}}function Xt(n,e,t){const s={...{inApp:{enabled:!0,position:"top-right",autoHide:!0,autoHideDelay:5e3,showProgress:!0,maxNotifications:5},push:{enabled:!0,requestPermission:!0,showSyncComplete:!0,showSyncFailed:!0,showNewContent:!0,batchNotifications:!0,quietHours:{start:"22:00",end:"07:00"}},filters:{domains:["music","photos","documents","videos"],minPriority:"low",eventTypes:[D.AutoSyncTriggered,D.Progress,D.AllCompleted,D.DomainCompleted,D.Failed],debounceDelay:1e3},feedback:{enableSounds:!1,enableVibration:!0,soundVolume:.5,customSounds:{}}},...e};return new Kt(n,s,t)}//! Auto-Sync & Notifications Integration
//!
//! This module integrates auto-sync components to provide a complete
//! auto-sync and notification system. It combines notification routing,
//! enhanced auto-sync management, user notifications, and service worker
//! background sync into a cohesive system.
class Zt{syncManager;wsClient;serviceWorkerSyncManager;config;autoSyncManager=null;notificationRouter=null;userNotificationManager=null;isInitialized=!1;isEnabled=!1;startTime=null;stats={totalSyncsTriggered:0,totalNotificationsProcessed:0,errorCount:0,lastActivity:new Date};constructor(e,t,i,s){this.syncManager=e,this.wsClient=t,this.config=i,this.serviceWorkerSyncManager=s||null}async initialize(){if(this.isInitialized){console.log("🚀 Phase 3 auto-sync system already initialized");return}console.log("🚀 Initializing Phase 3 auto-sync system..."),this.startTime=new Date;try{this.config.integration.enableNotificationRouter&&await this.initializeNotificationRouter(),await this.initializeAutoSyncManager(),this.config.integration.enableUserNotifications&&await this.initializeUserNotificationManager(),await this.setupComponentIntegration(),this.setupSystemMonitoring(),this.isInitialized=!0,this.config.integration.autoStart&&await this.enable(),l("✅ Auto-sync system initialized successfully")}catch(e){throw P("❌ Failed to initialize auto-sync system:",e),e}}async enable(){if(!this.isInitialized)throw new Error("System must be initialized before enabling");if(this.isEnabled){console.log("🔄 Phase 3 auto-sync system already enabled");return}l("🔛 Enabling auto-sync system...");try{this.autoSyncManager&&await this.autoSyncManager.enable(),this.notificationRouter&&await this.notificationRouter.start(),this.userNotificationManager&&await this.userNotificationManager.initialize(),this.isEnabled=!0,this.logSystemEvent("system_enabled"),l("✅ Auto-sync system enabled")}catch(e){throw P("❌ Failed to enable auto-sync system:",e),e}}async disable(){if(!this.isEnabled){console.log("⏹️ Phase 3 auto-sync system already disabled");return}l("⏹️ Disabling auto-sync system...");try{this.autoSyncManager&&await this.autoSyncManager.disable(),this.notificationRouter&&await this.notificationRouter.stop(),this.userNotificationManager&&await this.userNotificationManager.shutdown(),this.isEnabled=!1,this.logSystemEvent("system_disabled"),l("✅ Auto-sync system disabled")}catch(e){throw P("❌ Failed to disable auto-sync system:",e),e}}getStatus(){const e=this.getCurrentResourceStatus();return{enabled:this.isEnabled,components:{autoSyncManager:!!this.autoSyncManager,notificationRouter:!!this.notificationRouter,userNotifications:!!this.userNotificationManager,serviceWorker:!!this.serviceWorkerSyncManager},resources:e,activeSyncs:this.getActiveSyncs()}}getStats(){return{autoSync:this.autoSyncManager?.getStats()||null,notificationRouter:this.notificationRouter?.getStats()||null,userNotifications:this.userNotificationManager?.getStats()||null,system:{totalSyncsTriggered:this.stats.totalSyncsTriggered,averageResponseTime:0,lastActivity:this.stats.lastActivity,uptime:this.startTime?Date.now()-this.startTime.getTime():0,errorRate:this.stats.errorCount/Math.max(this.stats.totalSyncsTriggered,1)}}}async updateConfig(e){this.config={...this.config,...e},this.autoSyncManager&&e.autoSync&&this.autoSyncManager.updateConfig(e.autoSync),this.notificationRouter&&e.notificationRouting&&this.notificationRouter.updateConfig(e.notificationRouting),this.userNotificationManager&&e.userNotifications&&this.userNotificationManager.updateConfig(e.userNotifications),this.logSystemEvent("config_updated"),console.log("⚙️ Phase 3 auto-sync system configuration updated")}async triggerManualSync(e,t){if(!this.isEnabled)throw new Error("Auto-sync system is disabled");console.log(`🔄 Manual sync triggered for ${e}`),this.autoSyncManager?await this.autoSyncManager.forceSync(e,t?.reason||"manual"):await this.syncManager.syncDomain(e,{includeBinaryData:t?.includeBinaryData??!0}),this.stats.totalSyncsTriggered++,this.stats.lastActivity=new Date}getPendingNotifications(e){return this.notificationRouter?this.notificationRouter.getPendingNotifications(e):[]}addSyncRule(e){if(!this.autoSyncManager)throw new Error("Auto-sync manager not initialized");this.autoSyncManager.addRule(e),this.logSystemEvent("rule_added",{ruleId:e.id})}removeSyncRule(e){if(!this.autoSyncManager)throw new Error("Auto-sync manager not initialized");this.autoSyncManager.removeRule(e),this.logSystemEvent("rule_removed",{ruleId:e})}async sendUserNotification(e){if(!this.userNotificationManager){console.warn("User notification manager not available");return}await this.userNotificationManager.sendInAppNotification(e)}getActiveSyncRules(){return this.autoSyncManager?this.autoSyncManager.getActiveRules():[]}async performHealthCheck(){const e=[],t=[];this.autoSyncManager||e.push("Auto-sync manager not initialized"),this.config.integration.enableNotificationRouter&&!this.notificationRouter&&e.push("Notification router not initialized"),this.config.integration.enableUserNotifications&&!this.userNotificationManager&&e.push("User notification manager not initialized"),this.wsClient.getStatus()!=="connected"&&(e.push("WebSocket connection not active"),t.push("Check network connectivity")),this.config.integration.enableUserNotifications&&(this.userNotificationManager?.hasPushPermission()||t.push("Grant notification permissions for better user experience"));const i=this.getCurrentResourceStatus();return i.battery.level<.2&&!i.battery.charging&&t.push("Low battery detected - auto-sync may be limited"),{healthy:e.length===0,issues:e,recommendations:t}}async initializeNotificationRouter(){l("📡 Initializing notification router..."),this.notificationRouter=Qt(this.syncManager,this.wsClient,this.config.notificationRouting),l("✅ Notification router initialized")}async initializeAutoSyncManager(){l("🔄 Initializing enhanced auto-sync manager..."),this.autoSyncManager=Yt(this.syncManager,this.config.autoSync,this.serviceWorkerSyncManager||void 0,this.notificationRouter||void 0),l("✅ Enhanced auto-sync manager initialized")}async initializeUserNotificationManager(){l("📢 Initializing user notification manager..."),this.userNotificationManager=Xt(this.syncManager,this.config.userNotifications,this.serviceWorkerSyncManager||void 0),l("✅ User notification manager initialized")}async setupComponentIntegration(){l("🔗 Setting up component integration..."),this.notificationRouter&&this.autoSyncManager,this.autoSyncManager&&this.userNotificationManager,l("✅ Component integration complete")}setupSystemMonitoring(){this.config.advanced.enableAnalytics&&(l("📊 Setting up system monitoring..."),this.syncManager.on(D.AutoSyncTriggered,e=>{this.stats.totalSyncsTriggered++,this.stats.lastActivity=new Date,this.logSystemEvent("auto_sync_triggered",{event:e})}),this.syncManager.on(D.Failed,e=>{this.stats.errorCount++,this.logSystemEvent("sync_failed",{event:e})}),this.notificationRouter,l("✅ System monitoring setup complete"))}getCurrentResourceStatus(){return{battery:{level:1,charging:!1},connection:{type:"wifi",quality:"good"},memory:{usage:50,available:100}}}getActiveSyncs(){return[]}logSystemEvent(e,t){this.config.integration.debug&&console.log(`📊 [AutoSync] ${e}:`,t)}}function ei(n,e,t,i){const o={...{autoSync:{enabled:!0,syncOnNewContent:!0,periodicInterval:30,domains:["music","photos","documents","videos"],debounceDelay:5e3,customRules:[],resourceAwareness:{enabled:!0,batteryThreshold:.2,connectionTypes:["wifi","ethernet"],memoryThreshold:100},smartScheduling:{enabled:!0,quietHours:{start:"22:00",end:"07:00"},adaptiveInterval:!0,minInterval:15,maxInterval:120},backgroundSync:{enabled:!0,prioritizeBackground:!0,fallbackToForeground:!0},userPreferences:{respectDataSaver:!0,respectLowPowerMode:!0,maxDailySync:48}},notificationRouting:{enabled:!0,debounceDelay:5e3,maxQueueSize:50,monitoredChannels:["MediaBlobs","ThumbnailJobs","System"],syncRules:[],userNotifications:!0,priorityThresholds:{immediate:["critical","high"],batched:["medium","low"]}},userNotifications:{inApp:{enabled:!0,position:"top-right",autoHide:!0,autoHideDelay:5e3,showProgress:!0,maxNotifications:5},push:{enabled:!0,requestPermission:!0,showSyncComplete:!0,showSyncFailed:!0,showNewContent:!0,batchNotifications:!0,quietHours:{start:"22:00",end:"07:00"}},filters:{domains:["music","photos","documents","videos"],minPriority:"low",eventTypes:[D.AutoSyncTriggered,D.Progress,D.AllCompleted,D.DomainCompleted,D.Failed],debounceDelay:1e3},feedback:{enableSounds:!1,enableVibration:!0,soundVolume:.5,customSounds:{}}},integration:{enableNotificationRouter:!0,enableUserNotifications:!0,enableServiceWorker:!1,autoStart:!0,debug:!1},advanced:{intelligentScheduling:!0,crossDomainOptimization:!0,predictivePreSync:!1,enableAnalytics:!0}},...t};return new Zt(n,e,o,i)}async function ti(n,e,t){const i={integration:{enableNotificationRouter:!0,enableUserNotifications:t?.enableUserNotifications,enableServiceWorker:t?.enableBackgroundSync,autoStart:t?.autoStart,debug:t?.enableDebugMode??!1}},s=ei(n,e,i);return await s.initialize(),s}//! Unified Sync System - Main Exports
//!
//! This is the new, clean sync system that replaces the legacy implementation.
//! It provides a single, unified interface for synchronizing multiple domains
//! (music, photos, documents, videos) with automatic WebSocket updates,
//! service worker support, and efficient binary data caching.
const Se={storage:{databaseName:"unified_sync_storage",version:2,maxSize:100*1024*1024,maxAge:30},autoSync:{enabled:!0,syncOnNewContent:!0,periodicInterval:30,domains:["music","photos"],debounceDelay:5e3},defaultSyncOptions:{domains:["music","photos"],forceFullSync:!1,includeBinaryData:!0,priorityOrder:["music","photos","documents","videos"]}};async function ii(n,e,t){const i={apiBaseUrl:t.apiBaseUrl,websocketUrl:t.websocketUrl,clientId:t.clientId,authToken:t.authToken,domains:Ht(),storage:{...Se.storage,...t.storageConfig},autoSync:{...Se.autoSync,domains:t.enabledDomains||Se.autoSync.domains,...t.autoSyncConfig},defaultSyncOptions:{...Se.defaultSyncOptions,domains:t.enabledDomains||Se.defaultSyncOptions.domains}},s=Ft(i.storage);await s.initialize();const o=zt(s,n,e,i);return await o.initialize(),o}async function si(n,e,t){return ii(n,e,{...t,websocketUrl:t.apiBaseUrl.replace("http","ws")+"/ws"})}const ni="1.0.0";async function oi(n,e,t){const i=await si(n,e,{apiBaseUrl:t.apiBaseUrl,clientId:t.clientId,authToken:t.authToken}),s=await ti(i,n,{enableUserNotifications:t.enableUserNotifications,enableBackgroundSync:t.enableBackgroundSync,autoStart:!0});return{syncManager:i,autoSyncSystem:s}}typeof window<"u"&&(window.unifiedSyncDebug={enable:Ee,disable:Qe,configure:ke});console.log("🚀 Unified Sync System loaded:",ni);console.log("💡 Use window.unifiedSyncDebug.enable() to enable debug logging");function ai(n){const e=new Date,t=typeof n=="string"?new Date(n):n;if(isNaN(t.getTime()))return"Invalid date";const i=e.getTime()-t.getTime(),s=Math.floor(i/1e3),o=Math.floor(s/60),a=Math.floor(o/60),r=Math.floor(a/24),c=Math.floor(r/7),g=Math.floor(r/30);if(Math.floor(r/365)>=1)return t.getFullYear().toString();const d=new Intl.RelativeTimeFormat("en",{numeric:"auto",style:"long"});return s<60?s<10?"a moment ago":d.format(-s,"second"):o<60?d.format(-o,"minute"):a<24?d.format(-a,"hour"):r<7?d.format(-r,"day"):c<4?d.format(-c,"week"):g<12?d.format(-g,"month"):t.getFullYear().toString()}function ri(n){const e=typeof n=="string"?new Date(n):n;return isNaN(e.getTime())?"Invalid date":new Intl.DateTimeFormat("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"}).format(e)}var ci=L("<span> (Status: <!>)"),li=L("<div class=error-message>❌ "),di=L("<div class=last-sync>Last sync: "),ui=L("<span class=progress-percentage>%"),gi=L("<div class=progress-operation>"),hi=L("<span class=progress-initializing>"),mi=L("<span class=progress-items>/<!> items"),yi=L("<div class=horizontal-progress-container><div class=horizontal-progress-bar><div class=horizontal-progress-fill></div></div><div class=horizontal-progress-text>"),pi=L("<div class=progress-section><h3>📊 Sync Progress"),fi=L("<div class=image-grid-section><h3>🖼️ Binary Data Image Grid (<!> images) - Updated: </h3><div class=image-grid>"),bi=L("<div class=log-empty>No activity yet..."),Si=L(`<div><div class=demo-header><h2>🚀 Unified Sync System Demo</h2><div class=status-badges><span></span><span> (<!>)</span></div></div><div class=connection-section><h3>🔗 Connection</h3><div class=connection-status></div></div><div class=autosync-section><h3>⚙️ Auto-Sync</h3><label class=toggle-control><input type=checkbox><span>Enable real-time auto-sync</span></label><label class=toggle-control><input type=checkbox><span>Enable debug logging</span></label></div><div class=sync-section><h3>🎯 Sync Control</h3><div class=sync-controls><button></button></div></div><div class=domains-section><h3>📁 Domain Status</h3><div class=domain-grid></div></div><div class=storage-stats><h3>💾 Storage Usage</h3><div class=storage-display><div class=storage-item><span class=storage-label>Total:</span><span class=storage-value></span></div><div class=storage-breakdown><div class=storage-item><span class=storage-label>Music:</span><span class=storage-value></span></div><div class=storage-item><span class=storage-label>Binary Data:</span><span class=storage-value></span></div></div></div></div><div class=log-section><h3>📋 Activity Log</h3><div class=log-container></div></div><style>
        .unified-sync-demo {
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background: black;
          color: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }

        .demo-header {
          text-align: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 1px solid #333;
        }

        .demo-header h2 {
          margin: 0 0 10px 0;
          color: white;
        }

        .status-badges {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 10px;
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-badge.success {
          background: #0f5132;
          color: #d1e7dd;
        }

        .status-badge.pending {
          background: #664d03;
          color: #fff3cd;
        }

        .status-badge.error {
          background: #842029;
          color: #f8d7da;
        }

        .connection-section,
        .autosync-section,
        .sync-section,
        .progress-section,
        .domains-section,
        .log-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .connection-section h3,
        .autosync-section h3,
        .sync-section h3,
        .progress-section h3,
        .domains-section h3,
        .log-section h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .connection-buttons {
          display: flex;
          gap: 10px;
        }

        .toggle-control {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: white;
        }

        .sync-controls {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #0056b3;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #545b62;
        }

        .btn-sync {
          background: magenta;
          color: black;
          position: relative;
          font-weight: 600;
        }

        .btn-sync:hover:not(:disabled) {
          background: #ff40ff;
        }

        .btn-sync.syncing {
          background: #cc00cc;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
          100% {
            opacity: 1;
          }
        }

        .last-sync {
          font-size: 12px;
          color: #ccc;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #333;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 10px;
        }

        .progress-fill {
          height: 100%;
          background: magenta;
          transition: width 0.3s ease;
        }

        .progress-text {
          text-align: center;
          font-size: 14px;
          color: white;
        }

        .domain-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 15px;
        }

        .domain-card {
          padding: 15px;
          border-radius: 6px;
          border: 1px solid #333;
          background: #222;
        }

        .domain-card.complete {
          border-color: #0f0;
          background: #003300;
        }

        .domain-card.in_progress {
          border-color: magenta;
          background: #330033;
        }

        .domain-card.never {
          border-color: #666;
          background: #1a1a1a;
        }

        .domain-name {
          font-weight: 600;
          margin-bottom: 5px;
          text-transform: capitalize;
          color: white;
        }

        .domain-status {
          font-size: 12px;
          color: #ccc;
          margin-bottom: 5px;
        }

        .domain-progress {
          font-size: 11px;
          color: #aaa;
        }

        .log-container {
          max-height: 200px;
          overflow-y: auto;
          background: #000;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 10px;
        }

        .log-entry {
          font-family: "Monaco", "Consolas", monospace;
          font-size: 12px;
          padding: 2px 0;
          border-bottom: 1px solid #333;
          color: #ccc;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-empty {
          text-align: center;
          color: #666;
          font-style: italic;
          padding: 20px;
        }

        .error-message {
          margin-top: 10px;
          padding: 10px;
          background: #330000;
          border: 1px solid #660000;
          border-radius: 4px;
          color: #ff6666;
          font-size: 14px;
        }

        .horizontal-progress-container {
          margin-bottom: 20px;
          padding: 16px;
          background: #111;
          border: 1px solid #333;
          border-radius: 8px;
        }

        .horizontal-progress-bar {
          width: 100%;
          height: 12px;
          background: #333;
          border-radius: 6px;
          overflow: hidden;
          position: relative;
          margin-bottom: 8px;
        }

        .horizontal-progress-fill {
          height: 100%;
          border-radius: 6px;
          transition: width 0.5s ease;
          position: relative;
        }

        .horizontal-progress-fill::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.3),
            transparent
          );
          animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .horizontal-progress-text {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 14px;
          color: white;
        }

        .progress-percentage {
          font-weight: 600;
          color: magenta;
          font-size: 16px;
        }

        .progress-items {
          color: #ccc;
        }

        .progress-initializing {
          color: magenta;
          font-weight: 500;
        }

        .progress-operation {
          color: #ccc;
          font-size: 13px;
          font-style: italic;
        }

        .image-grid-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .image-grid-section h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 10px;
          margin-top: 15px;
        }

        .image-item {
          display: flex;
          justify-content: center;
          align-items: center;
          background: black;
          color: white;
          border-radius: 4px;
          overflow: hidden;
        }

        .grid-image {
          width: 100px;
          height: 100px;
          object-fit: cover;
          border: 2px solid #333;
          border-radius: 6px;
          transition: all 0.3s ease;
          background: #222;
        }

        .grid-image:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 15px rgba(255, 0, 255, 0.3);
        }

        .storage-stats {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .storage-stats h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .storage-display {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .storage-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #222;
          border-radius: 6px;
          border: 1px solid #444;
        }

        .storage-label {
          font-weight: 500;
          color: white;
        }

        .storage-value {
          font-weight: 600;
          color: magenta;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 13px;
        }

        .storage-breakdown {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 8px;
        }

        .storage-breakdown .storage-item {
          background: #1a1a1a;
          border-color: #333;
        }

        .connection-text {
          margin-left: 10px;
          font-weight: 500;
          font-size: 14px;
        }

        .connection-text.connected {
          color: #0f0;
        }

        .connection-text.disconnected {
          color: #f00;
        }
      `),wi=L("<div><div class=domain-name></div><div class=domain-status></div><div class=domain-progress>"),vi=L("<div class=image-item><img class=grid-image>"),_i=L("<div class=log-entry>");const $i=(n,e,t)=>{if(n==="music"&&t){const i=[];return t.songs>0&&i.push(`${t.songs} songs`),t.playlists>0&&i.push(`${t.playlists} playlists`),i.length>0?i.join(", "):"0 items"}else if(n==="photos"&&t){const i=[];return t.photos>0&&i.push(`${t.photos} photos`),t.galleries>0&&i.push(`${t.galleries} galleries`),i.length>0?i.join(", "):"0 items"}else if(n==="music"){const i=e.itemsProcessed||0;return i>0?`${i} songs`:"0 items"}else if(n==="photos"){const i=e.itemsProcessed||0;return i>0?`${i} photos`:"0 items"}else{const i=e.itemsProcessed||0,s=e.totalItems||0;return`${i}/${s} items`}},Di=(n={})=>{const[e,t]=R(!1),[i,s]=R(!1),[o,a]=R(!1),[r,c]=R(le.Disconnected),[g,f]=R(null),[d,p]=R({status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"}),[C,w]=R([]),[N,te]=R(0),[de,ae]=R("Loading..."),[X,T]=R("Loading..."),[Z,G]=R("Loading..."),[we,F]=R({music:h.Never,photos:h.Never,videos:h.Never,documents:h.Never}),[ue,me]=R({music:{status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},photos:{status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},videos:{status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},documents:{status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0}}),[Ce,qe]=R(n?.enableAutoSync??!0),[ve,Ge]=R(n?.debug??!1),[xe,_e]=R(null),[Fe,Je]=R([]),[Ye,Me]=R(null),[Ke,Te]=R(null),[$e,Xe]=R(null),[ie,Ze]=R(null),[et,tt]=R(null),$=(u,m)=>{n?.debug&&console.log(`[UnifiedSyncDemo] ${u}`,m||"")},M=u=>{const m=new Date().toLocaleTimeString();Je(y=>[...y.slice(-19),`[${m}] ${u}`])},it=()=>{const u=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;return n?.clientId&&u.test(n.clientId)?n.clientId:crypto.randomUUID()},st=async()=>{try{$("initializing system"),M("🚀 Initializing Unified Sync System...");const u=n?.apiBaseUrl||"http://localhost:8080",m=it();$("created client",{baseUrl:u,clientId:m.slice(0,8)}),M(`📋 Client ID: ${m.slice(0,8)}...`);const y=new Ct({baseUrl:u}),v=new xt({url:u.replace("http","ws")+"/ws",autoReconnect:!0,debug:ve()||n?.debug||!1});Xe(v);const b=_=>{$("handleStatusChange called",{status:_,previous:r()}),c(_);const E=_===le.Connected;s(E),$("websocket status change",{status:_,connected:E}),M(`🔗 WebSocket: ${_}`),E?(f(null),M("✅ WebSocket connected successfully")):_===le.Error&&f("WebSocket connection error")};v.on("statusChange",b),v.on("error",_=>{$("websocket error",_),M(`❌ WebSocket error: ${_.message}`),f(_.message)}),v.on("notification",_=>{$("received notification",{channel:_.channel,event_type:_.event_type}),M(`📬 Notification: ${_.channel}/${_.event_type}`),_.channel==="MediaBlobs"&&(_.event_type==="song.created"||_.event_type==="song.updated"||_.event_type==="song.deleted"||_.event_type==="music.library.updated")&&(M(`🎵 Music event: ${_.event_type}`),_e(new Date))}),$("setting up unified sync system");const{syncManager:k,autoSyncSystem:q}=await oi(v,y,{apiBaseUrl:u,clientId:m,enableUserNotifications:!1,enableBackgroundSync:!1});if(!k)throw new Error("Failed to create sync manager");if(!q)throw new Error("Failed to create auto-sync system");Ze(k),tt(q),nt(k),$("auto-connecting websocket"),v.connect();const re=1e4,ce=Date.now();for(;v.getStatus()!==le.Connected;){if(Date.now()-ce>re)throw new Error("WebSocket connection timeout");await new Promise(_=>setTimeout(_,100))}const se=v.getStatus();$("final websocket status after connect",se),c(se),s(se===le.Connected),M(`🔗 WebSocket connection established: ${se}`);try{const _=await k.getStorageStats();$("storage stats from IDB",_);const E=k.getStatus(),x=k.getProgress(),A={music:E.music||h.Never,photos:E.photos||h.Never,documents:E.documents||h.Never,videos:E.videos||h.Never},pe={music:{status:A.music,progress:A.music===h.Complete?100:x.music?.progress||0,itemsProcessed:A.music===h.Complete?_.itemCounts.music:x.music?.itemsProcessed||0,totalItems:A.music===h.Complete?_.itemCounts.music:x.music?.totalItems||0,currentBatch:x.music?.currentBatch||1,totalBatches:x.music?.totalBatches||1,eta:0},photos:{status:A.photos,progress:A.photos===h.Complete?100:x.photos?.progress||0,itemsProcessed:A.photos===h.Complete?_.itemCounts.photos:x.photos?.itemsProcessed||0,totalItems:A.photos===h.Complete?_.itemCounts.photos:x.photos?.totalItems||0,currentBatch:x.photos?.currentBatch||1,totalBatches:x.photos?.totalBatches||1,eta:0},documents:{status:A.documents,progress:A.documents===h.Complete?100:x.documents?.progress||0,itemsProcessed:A.documents===h.Complete?_.itemCounts.documents:x.documents?.itemsProcessed||0,totalItems:A.documents===h.Complete?_.itemCounts.documents:x.documents?.totalItems||0,currentBatch:x.documents?.currentBatch||1,totalBatches:x.documents?.totalBatches||1,eta:0},videos:{status:A.videos,progress:A.videos===h.Complete?100:x.videos?.progress||0,itemsProcessed:A.videos===h.Complete?_.itemCounts.videos:x.videos?.itemsProcessed||0,totalItems:A.videos===h.Complete?_.itemCounts.videos:x.videos?.totalItems||0,currentBatch:x.videos?.currentBatch||1,totalBatches:x.videos?.totalBatches||1,eta:0}};F(A),me(pe);const De=Object.values(_.lastSyncTimes).filter(Boolean);if(De.length>0){const W=De.reduce((ge,fe)=>fe&&(!ge||fe>ge)?fe:ge,null);W&&(_e(W),$("initialized last sync time",W))}A.music===h.Complete&&k.getMusicBreakdown().then(W=>{Me(W),$("loaded music breakdown",W)}),A.photos===h.Complete&&k.getPhotosBreakdown().then(W=>{Te(W),$("loaded photos breakdown",W)}),$("initialized from IDB",{status:A,itemCounts:_.itemCounts}),M(`📊 Loaded from IDB: ${Object.values(A).filter(W=>W===h.Complete).length} domains with data`),setTimeout(()=>{Be()},2e3),setTimeout(()=>{ye()},1e3)}catch(_){$("failed to get initial status",_),F({music:h.Never,photos:h.Never,videos:h.Never,documents:h.Never})}t(!0),$("system initialized successfully"),M("✅ System initialized successfully")}catch(u){$("initialization failed",u),M(`❌ Initialization failed: ${u.message}`),f(u.message)}},nt=u=>{u.on(D.Started,m=>{$("sync started",{domain:m.domain}),M(`🔄 Sync started: ${m.domain||"all domains"}`),a(!0),p({status:h.InProgress,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Starting sync..."})}),u.on(D.Progress,m=>{const y=m,v=u.getStatus(),b=u.getProgress();F(v),me(b);const k=Object.values(b),q=k.reduce((E,x)=>E+x.totalItems,0),re=k.reduce((E,x)=>E+x.itemsProcessed,0),ce=k.reduce((E,x)=>E+x.totalBatches,0),se=k.reduce((E,x)=>E+x.currentBatch,0),_=q>0?Math.round(re/q*100):0;p({status:h.InProgress,progress:_,itemsProcessed:re,totalItems:q,currentBatch:se,totalBatches:ce,eta:y.progress?.eta||0,currentOperation:y.progress?.currentOperation||`Syncing ${y.domain}`}),y.domain&&y.progress&&M(`📊 ${y.domain}: ${y.progress.itemsProcessed}/${y.progress.totalItems} items (${y.progress.progress}%)`)}),u.on(D.DomainCompleted,m=>{const y=m;$("domain sync completed",{domain:y.domain,itemsSynced:y.result.itemsSynced}),M(`✅ Domain sync completed: ${y.domain} - ${y.result.itemsSynced} items`),y.domain&&F(b=>({...b,[y.domain]:h.Complete})),_e(new Date);const v=ie();v&&y.domain==="music"&&v.getMusicBreakdown().then(b=>{Me(b),$("updated music breakdown after domain sync",b)}),v&&y.domain==="photos"&&v.getPhotosBreakdown().then(b=>{Te(b),$("updated photos breakdown after domain sync",b)}),setTimeout(()=>{const b=ie();b&&(F(b.getStatus()),me(b.getProgress()))},100),setTimeout(()=>{Be()},1500),y.domain==="music"&&setTimeout(()=>{ye()},2e3)}),u.on(D.AllCompleted,m=>{const y=m;$("sync completed",{domain:y.domain,itemsSynced:y.result.itemsSynced}),M(`✅ Sync completed: ${y.domain||"all domains"} - ${y.result.itemsSynced} items`),y.domain&&F(b=>({...b,[y.domain]:h.Complete})),a(!1),_e(new Date);const v=ie();v&&(v.getMusicBreakdown().then(b=>{Me(b),$("updated music breakdown after sync",b)}),v&&v.getPhotosBreakdown().then(b=>{Te(b),$("updated photos breakdown after sync",b)})),p({status:h.Complete,progress:100,itemsProcessed:d().itemsProcessed,totalItems:d().totalItems,currentBatch:d().totalBatches,totalBatches:d().totalBatches,eta:0,currentOperation:"Complete"}),setTimeout(()=>{const b=ie();b&&(F(b.getStatus()),me(b.getProgress()))},100),te(b=>b+1),setTimeout(()=>{Be()},1500),y.result&&y.result.binaryStats&&y.result.binaryStats.cached>0&&(M("🖼️ Binary sync completed, checking for images..."),setTimeout(()=>{ye()},2e3)),setTimeout(()=>{o()||p({status:h.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"})},5e3)}),u.on(D.Failed,m=>{const y=m;$("sync failed",y),M(`❌ Sync failed: ${y.error?.message||"Unknown error"}`),a(!1)}),u.on(D.BinaryProgress,m=>{const y=m,{currentItem:v,totalItems:b,domain:k}=y;k&&b>0&&(me(q=>({...q,[k]:{...q[k],itemsProcessed:v,totalItems:b,currentOperation:`Downloading binary data (${v}/${b})`}})),p({status:h.InProgress,progress:y.progress||0,itemsProcessed:v,totalItems:b,currentBatch:v,totalBatches:b,eta:0,currentOperation:`Downloading binary data (${v}/${b})`}))})},ye=async()=>{const u=ie();if(!(!u||!e()))try{const m=(await u.getMediaBlobs()).slice(0,100);if(m.length===0){w([]);return}M(`📷 Found ${m.length} image blobs, checking binary data...`);const y=[];let v=0;for(const b of m)try{if(await u.hasBinaryData(b.id)){v++;const q=await u.getBlobUrl(b.id);q&&y.push(q)}}catch{continue}y.length>0?(w(y),M(`🎨 Image grid loaded: ${y.length} images (${v} with binary data)`)):v===0&&m.length>0&&M(`📷 Found ${m.length} image metadata but no binary data yet`)}catch(m){M(`❌ Failed to load image grid: ${m.message}`)}},Oe=u=>{if(u===0)return"0 B";const m=1024,y=["B","KB","MB","GB"],v=Math.floor(Math.log(u)/Math.log(m));return Math.round(u/Math.pow(m,v)*100)/100+" "+y[v]},Be=async()=>{try{const u=ie();if(!u){$("no sync manager available for storage stats");return}$("calculating storage usage");const m=await u.getStorageStats();$("storage stats received",m);const y={totalSize:m?.totalSize||0,itemCounts:m?.itemCounts||{music:0,photos:0,documents:0,videos:0},binarySize:m?.binarySize||0},v=Oe(y.totalSize),b=y.itemCounts.music,k=b>0?`${b} items`:"No data",q=Oe(y.binarySize);ae(v),T(k),G(q),$("updated storage stats",{total:v,music:k,binary:q})}catch(u){console.error("Could not calculate storage usage:",u),ae("Error"),T("Error"),G("Error")}};He(()=>{const u=i(),m=e(),y=o(),v=r();$("button state reactive check",{connected:u,initialized:m,syncing:y,wsStatus:v,buttonEnabled:u&&!y});const b=$e();if(b){const k=b.getStatus();k!==v&&($("status mismatch detected, correcting",{actualStatus:k,wsStatus:v}),c(k),s(k===le.Connected))}}),He(()=>{const u=ie(),m=e();if(N(),u&&m){ye();const y=setInterval(()=>{ye()},3e3);setTimeout(()=>{clearInterval(y)},3e4)}});const ot=async()=>{const u=ie();if(!(!u||o()))try{$("starting sync all"),M("🔄 Starting sync for all domains...");const m=await u.syncAll({domains:["music","photos","videos"],includeBinaryData:!0,forceFullSync:!1});M(`✨ Sync completed! Domain: ${m.domain}, Items: ${m.itemsSynced}/${m.totalItems}`)}catch(m){$("sync all failed",m),M(`❌ Sync failed: ${m.message}`)}},at=async()=>{const u=et();if(!u){M("❌ Auto-sync system not available");return}try{const m=!Ce();qe(m),m?(u.start?await u.start():u.enable&&await u.enable(),$("auto-sync enabled"),M("🔄 Auto-sync enabled")):(u.stop?await u.stop():u.disable&&await u.disable(),$("auto-sync disabled"),M("⏸️ Auto-sync disabled"))}catch(m){$("auto-sync toggle failed",m),M(`❌ Auto-sync toggle failed: ${m.message}`),qe(!Ce())}},rt=()=>{const u=!ve();Ge(u),u?(Ee(),ke({enabled:!0,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!0}})):Qe();const m=$e();m&&m.setDebug(u),typeof window<"u"&&(window.debugEnabled=u),$(`Debug logging ${u?"enabled":"disabled"}`),M(`🔧 Debug logging ${u?"enabled":"disabled"}`)};return Dt(()=>{$("component mounted"),ve()&&(Ee(),ke({enabled:!0,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!0}}),typeof window<"u"&&(window.debugEnabled=!0)),st()}),It(()=>{$("component unmounting");const u=$e();u&&u.disconnect()}),(()=>{var u=Si(),m=u.firstChild,y=m.firstChild,v=y.nextSibling,b=v.firstChild,k=b.nextSibling,q=k.firstChild,re=q.nextSibling;re.nextSibling;var ce=m.nextSibling,se=ce.firstChild,_=se.nextSibling,E=ce.nextSibling,x=E.firstChild,A=x.nextSibling,pe=A.firstChild,De=A.nextSibling,W=De.firstChild,ge=E.nextSibling,fe=ge.firstChild,Le=fe.nextSibling,be=Le.firstChild,Pe=ge.nextSibling,ct=Pe.firstChild,lt=ct.nextSibling,Ae=Pe.nextSibling,dt=Ae.firstChild,ut=dt.nextSibling,We=ut.firstChild,gt=We.firstChild,ht=gt.nextSibling,mt=We.nextSibling,Ue=mt.firstChild,yt=Ue.firstChild,pt=yt.nextSibling,ft=Ue.nextSibling,bt=ft.firstChild,St=bt.nextSibling,wt=Ae.nextSibling,vt=wt.firstChild,je=vt.nextSibling;return I(b,()=>e()?"✅ Ready":"⏳ Initializing"),I(k,()=>i()?"🔗 Connected":"🔗 Disconnected",q),I(k,r,re),I(_,O(ee,{get when(){return $e()},get children(){return[O(Mt,{get status(){return r()},showText:!0,compact:!0}),(()=>{var S=ci(),z=S.firstChild,U=z.nextSibling;return U.nextSibling,I(S,()=>i()?"Connected":"Disconnected",z),I(S,r,U),ne(()=>he(S,`connection-text ${i()?"connected":"disconnected"}`)),S})()]}})),I(ce,O(ee,{get when(){return g()},get children(){var S=li();return S.firstChild,I(S,g,null),S}}),null),pe.addEventListener("change",at),W.addEventListener("change",rt),be.$$click=ot,I(be,()=>o()?"🔄 Syncing...":"🚀 Sync All"),I(Le,O(ee,{get when(){return xe()},get children(){var S=di();return S.firstChild,I(S,()=>ai(xe()),null),ne(()=>Ie(S,"title",ri(xe()))),S}}),null),I(u,O(ee,{get when(){return o()||d().totalItems>0},get children(){var S=pi();return S.firstChild,I(S,O(ee,{get when(){return o()},get children(){var z=yi(),U=z.firstChild,V=U.firstChild,J=U.nextSibling;return I(J,O(ee,{get when(){return d().totalItems>0},get children(){var B=ui(),j=B.firstChild;return I(B,()=>d().progress,j),B}}),null),I(J,O(ee,{get when(){return d().currentOperation},get children(){var B=gi();return I(B,()=>d().currentOperation),B}}),null),I(J,O(ee,{get when(){return d().totalItems===0},get children(){var B=hi();return I(B,()=>d().currentOperation||(d().itemsProcessed>0?`Processing... (${d().itemsProcessed} items)`:"Initializing sync...")),B}}),null),I(J,O(ee,{get when(){return d().totalItems>0},get children(){var B=mi(),j=B.firstChild,Y=j.nextSibling;return Y.nextSibling,I(B,()=>d().itemsProcessed,j),I(B,()=>d().totalItems,Y),B}}),null),ne(B=>{var j=`${d().totalItems>0?d().progress:Math.min(85,Math.max(10,d().itemsProcessed*.5))}%`,Y=d().totalItems>0?"linear-gradient(90deg, magenta, #cc00cc)":"linear-gradient(90deg, #ff6600, #cc4400)";return j!==B.e&&((B.e=j)!=null?V.style.setProperty("width",j):V.style.removeProperty("width")),Y!==B.t&&((B.t=Y)!=null?V.style.setProperty("background",Y):V.style.removeProperty("background")),B},{e:void 0,t:void 0}),z}}),null),S}}),Pe),I(lt,O(Re,{get each(){return Object.entries(we())},children:([S,z])=>(()=>{var U=wi(),V=U.firstChild,J=V.nextSibling,B=J.nextSibling;return I(V,S),I(J,z),I(B,()=>$i(S,ue()[S],S==="music"?Ye():S==="photos"?Ke():void 0)),ne(()=>he(U,`domain-card ${z.toLowerCase()}`)),U})()})),I(u,O(ee,{get when(){return C().length>0},get children(){var S=fi(),z=S.firstChild,U=z.firstChild,V=U.nextSibling;V.nextSibling;var J=z.nextSibling;return I(z,()=>C().length,V),I(z,()=>new Date().toLocaleTimeString(),null),I(J,O(Re,{get each(){return C()},children:(B,j)=>(()=>{var Y=vi(),Ne=Y.firstChild;return Ne.addEventListener("error",_t=>{$(`failed to load image ${j()+1}`,B),_t.target.style.display="none"}),Ie(Ne,"src",B),ne(()=>Ie(Ne,"alt",`Recent image ${j()+1}`)),Y})()})),S}}),Ae),I(ht,de),I(pt,X),I(St,Z),I(je,O(Re,{get each(){return Fe().slice().reverse()},children:S=>(()=>{var z=_i();return I(z,S),z})()}),null),I(je,O(ee,{get when(){return Fe().length===0},get children(){return bi()}}),null),ne(S=>{var z=`unified-sync-demo ${n?.className||""}`,U=`status-badge ${e()?"success":"pending"}`,V=`status-badge ${i()?"success":"error"}`,J=!e(),B=`btn btn-sync ${o()?"syncing":""}`,j=!i()||o(),Y=i()?o()?"Sync in progress...":"Sync all domains":"WebSocket must be connected to sync";return z!==S.e&&he(u,S.e=z),U!==S.t&&he(b,S.t=U),V!==S.a&&he(k,S.a=V),J!==S.o&&(pe.disabled=S.o=J),B!==S.i&&he(be,S.i=B),j!==S.n&&(be.disabled=S.n=j),Y!==S.s&&Ie(be,"title",S.s=Y),S},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0}),ne(()=>pe.checked=Ce()),ne(()=>W.checked=ve()),u})()};kt("unified-sync-demo",{apiBaseUrl:"",clientId:"",enableAutoSync:!0,debug:!1,className:""},Di);$t(["click"]);export{h as S};
//# sourceMappingURL=unified-sync-demo.js.map
