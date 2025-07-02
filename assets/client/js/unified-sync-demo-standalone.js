import{d as st,c as C,g as Ie,o as ot,f as at,t as D,k as b,i as x,S as R,b as X,F as me,e as ae,l as Te}from"./web-Bmt1sUg0.js";import{c as rt}from"./index-CuXI0cIU.js";import{A as ct}from"./api-client-oDSgDTkX.js";import{C as J,W as lt}from"./websocket-client-BIZ3xMI1.js";import{h as dt,g as ut}from"./sync-progress-CeO0DFFv.js";import{W as gt}from"./websocket-status-B6AILaLV.js";import"./types-DDODKsJP.js";import"./sync-constants-QglVsuEd.js";import"./blob-client-DCiVtQuT.js";//! Unified Sync System - Core Types
//!
//! This module defines the foundational types for the new unified sync system.
//! It supports multiple domains (music, photos, documents, etc.) with a single
//! consistent interface while maintaining extensibility for future domains.
var w=(s=>(s.Never="never",s.InProgress="in_progress",s.Complete="complete",s.Failed="failed",s.Paused="paused",s))(w||{}),y=(s=>(s.Started="started",s.Progress="progress",s.DomainCompleted="domain_completed",s.AllCompleted="all_completed",s.Failed="failed",s.Paused="paused",s.Resumed="resumed",s.BinaryProgress="binary_progress",s.AutoSyncTriggered="auto_sync_triggered",s.ConnectionChanged="connection_changed",s))(y||{});//! Domain Configurations
//!
//! This module defines the configuration for different sync domains (music, photos,
//! documents, videos). Each domain has its own API endpoints, data transforms,
//! and binary handling rules.
const ht={domain:"music",endpoints:{list:"/api/media/songs",item:"/api/media/songs/{id}",sync:"/api/sync/songs",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:50,includeBinaryData:!0,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["audio/","image/"],maxFileSize:50*1024*1024,batchSize:3},transforms:{fromApi:s=>({id:s.id,name:s.name,artist:s.artist,album:s.album,duration:s.duration,blob_id:s.blob_id,created_at:s.created_at,updated_at:s.updated_at,metadata:s.metadata||{}}),toStorage:s=>({...s,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:s=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:n,...o}=s;return o}}},yt={domain:"photos",endpoints:{list:"/api/photos",item:"/api/photos/{id}",sync:"/api/sync/photos",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:100,includeBinaryData:!0,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["image/jpeg","image/png","image/webp"],maxFileSize:20*1024*1024,batchSize:5},transforms:{fromApi:s=>({id:s.id,title:s.title,description:s.description,width:s.width,height:s.height,blob_id:s.blob_id,thumbnail_blob_id:s.thumbnail_blob_id,created_at:s.created_at,updated_at:s.updated_at,location:s.location,camera_info:s.camera_info,metadata:s.metadata||{}}),toStorage:s=>({...s,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:s=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:n,...o}=s;return o}}},mt={domain:"documents",endpoints:{list:"/api/documents",item:"/api/documents/{id}",sync:"/api/sync/documents",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:25,includeBinaryData:!1,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["application/pdf","text/","application/msword"],maxFileSize:100*1024*1024,batchSize:2},transforms:{fromApi:s=>({id:s.id,title:s.title,content:s.content,author:s.author,mime_type:s.mime_type,file_size:s.file_size,blob_id:s.blob_id,version:s.version,created_at:s.created_at,updated_at:s.updated_at,tags:s.tags||[],metadata:s.metadata||{}}),toStorage:s=>({...s,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:s=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:n,...o}=s;return o}}},ft={domain:"videos",endpoints:{list:"/api/videos",item:"/api/videos/{id}",sync:"/api/sync/videos",binary:"/api/blobs/{blob_id}"},defaultOptions:{pageSize:20,includeBinaryData:!1,forceFullSync:!1},binaryConfig:{priorityMimeTypes:["video/mp4","video/webm","image/"],maxFileSize:500*1024*1024,batchSize:1},transforms:{fromApi:s=>({id:s.id,title:s.title,description:s.description,duration:s.duration,width:s.width,height:s.height,blob_id:s.blob_id,thumbnail_blob_id:s.thumbnail_blob_id,preview_blob_id:s.preview_blob_id,created_at:s.created_at,updated_at:s.updated_at,quality:s.quality,codec:s.codec,metadata:s.metadata||{}}),toStorage:s=>({...s,_sync_version:1,_last_modified:new Date().toISOString()}),fromStorage:s=>{const{_sync_version:e,_last_modified:t,_domain:i,_stored_at:n,...o}=s;return o}}},pt={music:ht,photos:yt,documents:mt,videos:ft};function Ae(s){return{...pt}}//! Service Worker Sync Types
//!
//! This module defines types and interfaces for service worker background sync
//! integration with the unified sync system. It provides type-safe interfaces
//! for background sync registration, event handling, and coordination between
//! the main thread and service worker.
var z=(s=>(s.Pending="pending",s.Running="running",s.Completed="completed",s.Failed="failed",s.Cancelled="cancelled",s))(z||{}),A=(s=>(s.RegisterBackgroundSync="register-background-sync",s.CancelBackgroundSync="cancel-background-sync",s.GetSyncStatus="get-sync-status",s.UpdateConfig="update-config",s.SyncStarted="sync-started",s.SyncProgress="sync-progress",s.SyncCompleted="sync-completed",s.SyncFailed="sync-failed",s.SyncCancelled="sync-cancelled",s.StatusUpdate="status-update",s))(A||{});const bt={backgroundSyncEnabled:!0,periodicSyncEnabled:!0,periodicSyncInterval:30,maxBackgroundSyncDuration:5*60*1e3,maxConcurrentOperations:3,backgroundSyncDomains:["music","photos"],defaultRetryConfig:{maxRetries:3,baseDelay:1e3,backoffMultiplier:2,maxDelay:3e4,jitterFactor:.1},networkConfig:{wifiOnly:!1,allowCellular:!0,allowMetered:!1,pauseOnSlowConnection:!0},batteryConfig:{minBatteryLevel:.15,pauseOnLowBattery:!0,pauseWhenNotCharging:!1,reducedFrequencyOnBattery:!0}};//! Service Worker Sync Manager Implementation
//!
//! This module provides the main implementation for service worker background sync
//! integration. It handles background sync registration, coordination between main
//! thread and service worker, queue management, and resource-aware scheduling.
class St{config;syncManager;serviceWorkerRegistration=null;messageChannel=null;eventListeners=new Map;operationQueue=new Map;capabilities=null;constructor(e,t={}){this.syncManager=e,this.config={...bt,...t}}async initialize(){console.log("🔧 Initializing Service Worker Sync Manager...");try{if(this.capabilities=await this.getCapabilities(),!this.capabilities.serviceWorker){console.warn("⚠️ Service Workers not supported, background sync disabled");return}await this.registerServiceWorker({scriptURL:"/service-worker.js",scope:"/"}),await this.setupMessageChannel(),await this.updateConfig(this.config),this.capabilities.periodicBackgroundSync&&this.config.periodicSyncEnabled&&await this.setupPeriodicSync(),console.log("✅ Service Worker Sync Manager initialized")}catch(e){throw console.error("❌ Failed to initialize Service Worker Sync Manager:",e),e}}async registerBackgroundSync(e){if(!this.capabilities?.backgroundSync)throw new Error("Background sync not supported");if(!this.config.backgroundSyncDomains.includes(e.domain))throw new Error(`Domain ${e.domain} not enabled for background sync`);const t=this.generateOperationId(),i={...e,id:t,status:z.Pending,createdAt:new Date,retryCount:0,maxRetries:e.maxRetries||this.config.defaultRetryConfig.maxRetries,retryDelay:e.retryDelay||this.config.defaultRetryConfig.baseDelay};this.operationQueue.set(t,i);const n={type:A.RegisterBackgroundSync,id:this.generateMessageId(),timestamp:new Date,operation:e};return await this.sendMessageToServiceWorker(n),"sync"in this.serviceWorkerRegistration&&await this.serviceWorkerRegistration.sync.register(`unified-sync-${t}`),console.log(`📝 Registered background sync operation: ${t} (${e.domain})`),t}async cancelBackgroundSync(e){const t=this.operationQueue.get(e);if(!t)throw new Error(`Operation ${e} not found`);t.status=z.Cancelled,this.operationQueue.set(e,t);const i={type:A.CancelBackgroundSync,id:this.generateMessageId(),timestamp:new Date,operationId:e};await this.sendMessageToServiceWorker(i),console.log(`🚫 Cancelled background sync operation: ${e}`)}async getSyncStatus(e){const t={type:A.GetSyncStatus,id:this.generateMessageId(),timestamp:new Date,operationId:e};if(await this.sendMessageToServiceWorker(t),e){const i=this.operationQueue.get(e);return i?[i]:[]}return Array.from(this.operationQueue.values())}async updateConfig(e){this.config={...this.config,...e};const t={type:A.UpdateConfig,id:this.generateMessageId(),timestamp:new Date,config:e};await this.sendMessageToServiceWorker(t),console.log("⚙️ Service worker configuration updated")}async getCapabilities(){const e={serviceWorker:"serviceWorker"in navigator,backgroundSync:!1,periodicBackgroundSync:!1,pushAPI:"PushManager"in window,notifications:"Notification"in window};if(e.serviceWorker)try{const t=await navigator.serviceWorker.getRegistration();e.backgroundSync="sync"in(t||{}),e.periodicBackgroundSync="periodicSync"in(t||{})}catch(t){console.warn("Could not check background sync capabilities:",t)}return e}async getResourceStatus(){const e={network:{online:navigator.onLine,type:"unknown"}};if("connection"in navigator){const t=navigator.connection;e.network={online:navigator.onLine,type:t.type||"unknown",effectiveType:t.effectiveType,downlink:t.downlink,rtt:t.rtt,saveData:t.saveData}}if("getBattery"in navigator)try{const t=await navigator.getBattery();e.battery={level:t.level,charging:t.charging,chargingTime:t.chargingTime,dischargingTime:t.dischargingTime}}catch(t){console.warn("Could not get battery information:",t)}if("memory"in performance){const t=performance.memory;e.memory={usedJSHeapSize:t.usedJSHeapSize,totalJSHeapSize:t.totalJSHeapSize,jsHeapSizeLimit:t.jsHeapSizeLimit}}return e}async getQueueState(){const e=Array.from(this.operationQueue.values()),t=e.filter(S=>S.status===z.Running),i=e.filter(S=>S.status===z.Pending),n=e.filter(S=>S.status===z.Failed),o=e.filter(S=>S.status===z.Completed),r=e.length,a=o.length,c=n.length,u=o.length>0?o.reduce((S,h)=>h.startedAt&&h.completedAt?S+(h.completedAt.getTime()-h.startedAt.getTime()):S,0)/o.length:0,f=r>0?a/(a+c):0;return{operations:e,activeOperations:t,pendingOperations:i,failedOperations:n,stats:{totalOperations:r,completedOperations:a,failedOperations:c,averageCompletionTime:u,successRate:f}}}async registerPeriodicSync(e){if(!this.capabilities?.periodicBackgroundSync)throw new Error("Periodic background sync not supported");if(!("periodicSync"in this.serviceWorkerRegistration))throw new Error("Periodic sync not available on registration");await this.serviceWorkerRegistration.periodicSync.register(e.tag,{minInterval:e.minInterval}),console.log(`⏰ Registered periodic sync: ${e.tag} (${e.minInterval}ms)`)}async unregisterPeriodicSync(e){if(!("periodicSync"in this.serviceWorkerRegistration))throw new Error("Periodic sync not available");await this.serviceWorkerRegistration.periodicSync.unregister(e),console.log(`🚫 Unregistered periodic sync: ${e}`)}addEventListener(e,t){this.eventListeners.has(e)||this.eventListeners.set(e,new Set),this.eventListeners.get(e).add(t)}removeEventListener(e,t){const i=this.eventListeners.get(e);i&&i.delete(t)}async destroy(){console.log("🧹 Destroying Service Worker Sync Manager...");const e=Array.from(this.operationQueue.values()).filter(t=>t.status===z.Pending);for(const t of e)try{await this.cancelBackgroundSync(t.id)}catch(i){console.warn(`Failed to cancel operation ${t.id}:`,i)}this.eventListeners.clear(),this.messageChannel&&(this.messageChannel.port1.close(),this.messageChannel.port2.close(),this.messageChannel=null),console.log("✅ Service Worker Sync Manager destroyed")}async registerServiceWorker(e){if(!("serviceWorker"in navigator))throw new Error("Service Workers not supported");try{this.serviceWorkerRegistration=await navigator.serviceWorker.register(e.scriptURL,{scope:e.scope,updateViaCache:e.updateViaCache,type:e.type}),console.log("✅ Service Worker registered:",this.serviceWorkerRegistration.scope),await navigator.serviceWorker.ready}catch(t){throw console.error("❌ Service Worker registration failed:",t),t}}async setupMessageChannel(){if(!this.serviceWorkerRegistration)throw new Error("Service Worker not registered");this.messageChannel=new MessageChannel,this.messageChannel.port1.onmessage=t=>{this.handleServiceWorkerMessage(t.data)};const e=this.serviceWorkerRegistration.active;e&&e.postMessage({type:"INIT_PORT"},[this.messageChannel.port2]),console.log("📡 Message channel established with service worker")}async setupPeriodicSync(){try{await this.registerPeriodicSync({tag:"unified-sync-periodic",minInterval:this.config.periodicSyncInterval*60*1e3}),console.log("⏰ Periodic sync configured")}catch(e){console.warn("⚠️ Could not set up periodic sync:",e)}}async sendMessageToServiceWorker(e){if(!this.messageChannel)throw new Error("Message channel not established");this.messageChannel.port1.postMessage(e)}handleServiceWorkerMessage(e){console.log("📨 Received message from service worker:",e.type),this.updateOperationFromMessage(e);const t=this.eventListeners.get(e.type);t&&t.forEach(i=>{try{i(e)}catch(n){console.error("Error in service worker message listener:",n)}})}updateOperationFromMessage(e){let t;switch(e.type){case A.SyncStarted:t=e.operationId;break;case A.SyncProgress:t=e.operationId;break;case A.SyncCompleted:t=e.operationId;break;case A.SyncFailed:t=e.operationId;break;case A.SyncCancelled:t=e.operationId;break}if(t){const i=this.operationQueue.get(t);if(i){switch(e.type){case A.SyncStarted:i.status=z.Running,i.startedAt=new Date;break;case A.SyncCompleted:i.status=z.Completed,i.completedAt=new Date,i.result=e.result;break;case A.SyncFailed:i.status=z.Failed,i.error=e.error,i.retryCount=e.retryCount,i.lastAttempt=new Date;break;case A.SyncCancelled:i.status=z.Cancelled;break}this.operationQueue.set(t,i)}}}generateOperationId(){return`sw-sync-${Date.now()}-${Math.random().toString(36).substr(2,9)}`}generateMessageId(){return`msg-${Date.now()}-${Math.random().toString(36).substr(2,9)}`}}function wt(s,e){return new St(s,e)}function vt(){return"serviceWorker"in navigator&&"ServiceWorkerRegistration"in window&&"sync"in window.ServiceWorkerRegistration.prototype}//! Unified Sync Manager - Core Implementation
//!
//! This is the main implementation of the new unified sync system. It provides
//! a single, clean interface for synchronizing multiple domains (music, photos,
//! documents, etc.) with automatic WebSocket-based updates and service worker support.
class $t{storage;wsClient;apiClient;config;domainConfigs;currentStatus;currentProgress;activeSyncs=new Set;eventListeners=new Map;autoSyncEnabled=!1;autoSyncTimeouts=new Map;notificationQueue=[];debounceTimeout;serviceWorkerSyncManager=null;constructor(e,t,i,n){this.storage=e,this.wsClient=t,this.apiClient=i,this.config=n,this.domainConfigs=Ae(),this.currentStatus={music:w.Never,photos:w.Never,documents:w.Never,videos:w.Never},this.currentProgress={music:this.createEmptyProgress(),photos:this.createEmptyProgress(),documents:this.createEmptyProgress(),videos:this.createEmptyProgress()}}async initialize(){if(console.log("🚀 Initializing UnifiedSyncManager..."),await this.storage.initialize(),this.setupWebSocketListeners(),await this.loadSyncStates(),this.config.autoSync.enabled&&this.enableAutoSync(!0),this.config.serviceWorker?.enabled&&vt())try{this.serviceWorkerSyncManager=wt(this,this.config.serviceWorker),await this.serviceWorkerSyncManager.initialize(),console.log("✅ Service Worker sync initialized")}catch(e){console.warn("⚠️ Service Worker sync initialization failed:",e)}console.log("✅ UnifiedSyncManager initialized")}async syncAll(e={}){console.log("🔄 Starting sync all domains...");const t=Date.now(),i=e.domains||Object.keys(this.domainConfigs),o=(e.priorityOrder||i).filter(h=>i.includes(h));i.forEach(h=>{o.includes(h)||o.push(h)});const r=[];let a=0;const c=[];this.emitEvent({type:y.Started,timestamp:new Date,domain:o[0],isFullSync:e.forceFullSync||!1});for(const h of o)try{const m={forceFullSync:e.forceFullSync,includeBinaryData:e.includeBinaryData},$=await this.syncDomain(h,m);r.push($),a+=$.itemsSynced,$.errors.length>0&&c.push(...$.errors)}catch(m){console.error(`❌ Failed to sync domain ${h}:`,m);const $={code:"DOMAIN_SYNC_FAILED",message:`Failed to sync ${h}: ${m instanceof Error?m.message:String(m)}`,details:m};c.push($)}const u=Date.now()-t,S={domain:"music",status:c.length>0?w.Failed:w.Complete,itemsSynced:a,totalItems:r.reduce((h,m)=>h+m.totalItems,0),duration:u,errors:c,binaryStats:this.aggregateBinaryStats(r)};return this.emitEvent({type:y.AllCompleted,timestamp:new Date,result:S}),console.log(`✅ Sync all completed: ${a} items in ${u}ms`),S}async syncDomain(e,t={}){if(console.log(`🔄 Starting sync for domain: ${e}`),this.activeSyncs.has(e))throw new Error(`Sync already in progress for domain: ${e}`);this.activeSyncs.add(e),this.updateStatus(e,w.InProgress);const i=Date.now(),n=[];try{this.emitEvent({type:y.Started,timestamp:new Date,domain:e,isFullSync:t.forceFullSync||!1});const o=await this.syncStructuredData(e,t);let r;t.includeBinaryData&&e==="music"&&(console.log("🔄 Starting binary data sync..."),r=await this.syncBinaryData());const a=Date.now()-i,c={domain:e,status:w.Complete,itemsSynced:o.itemsSynced,totalItems:o.totalItems,duration:a,binaryStats:r,errors:n};return this.updateStatus(e,w.Complete),this.updateProgress(e,{status:w.Complete,progress:100,itemsProcessed:c.itemsSynced,totalItems:c.totalItems,currentBatch:1,totalBatches:1,currentOperation:"Complete"}),this.emitEvent({type:y.DomainCompleted,timestamp:new Date,domain:e,result:c}),console.log(`✅ Domain ${e} sync completed: ${c.itemsSynced} items`),c}catch(o){console.error(`❌ Domain ${e} sync failed:`,o);const r={code:"SYNC_FAILED",message:o instanceof Error?o.message:String(o),details:o};n.push(r),this.updateStatus(e,w.Failed),this.emitEvent({type:y.Failed,timestamp:new Date,domain:e,error:r});const a=Date.now()-i;return{domain:e,status:w.Failed,itemsSynced:0,totalItems:0,duration:a,errors:n}}finally{this.activeSyncs.delete(e)}}async getBlobUrl(e){try{const t=await this.storage.getBinaryData(e);if(t){const n=(await this.storage.getItems("documents")).find(o=>o.id===e);if(n){const o=new Blob([t],{type:n.mime||"application/octet-stream"});return URL.createObjectURL(o)}}return`${this.config.apiBaseUrl}/blobs/${e}`}catch(t){return console.error(`Failed to get blob URL for ${e}:`,t),null}}enableAutoSync(e){console.log(`${e?"🔄 Enabling":"⏸️ Disabling"} auto-sync...`),this.autoSyncEnabled=e,e?this.config.autoSync.periodicInterval&&this.setupPeriodicSync():(this.autoSyncTimeouts.forEach(t=>clearTimeout(t)),this.autoSyncTimeouts.clear(),this.debounceTimeout&&(clearTimeout(this.debounceTimeout),this.debounceTimeout=void 0))}getStatus(){return{...this.currentStatus}}getProgress(){return{music:{...this.currentProgress.music},photos:{...this.currentProgress.photos},documents:{...this.currentProgress.documents},videos:{...this.currentProgress.videos}}}async destroyAll(){console.log("💥 Starting complete system teardown...");try{this.enableAutoSync(!1),this.activeSyncs.clear(),this.currentStatus={music:w.Never,photos:w.Never,documents:w.Never,videos:w.Never},this.currentProgress={music:this.createEmptyProgress(),photos:this.createEmptyProgress(),documents:this.createEmptyProgress(),videos:this.createEmptyProgress()},await this.storage.destroyAll(),console.log("🗑️ Complete system teardown successful"),this.emitEvent({type:y.AllCompleted,timestamp:new Date,result:{domain:"music",status:w.Complete,itemsSynced:0,totalItems:0,duration:0,errors:[]}})}catch(e){throw console.error("❌ Failed to destroy system:",e),new Error(`System teardown failed: ${e}`)}}async getMediaBlobs(){try{return(await this.storage.getItems("documents")).filter(t=>t.mime&&t.mime.startsWith("image/"))}catch(e){return console.error("Failed to get media blobs:",e),[]}}on(e,t){this.eventListeners.has(e)||this.eventListeners.set(e,new Set),this.eventListeners.get(e).add(t)}off(e,t){const i=this.eventListeners.get(e);i&&i.delete(t)}async getServiceWorkerSyncManager(){return this.serviceWorkerSyncManager}async destroy(){console.log("🧹 Destroying UnifiedSyncManager..."),this.enableAutoSync(!1),this.serviceWorkerSyncManager&&(await this.serviceWorkerSyncManager.destroy(),this.serviceWorkerSyncManager=null),this.eventListeners.clear(),this.activeSyncs.clear(),console.log("✅ UnifiedSyncManager destroyed")}async syncStructuredData(e,t){const i=this.domainConfigs[e];if(e==="music")return this.syncMusicDomain(t);const n=t.pageSize||i.defaultOptions.pageSize||50;let o=null;t.forceFullSync||(o=null);let r=0,a=0,c=0,u=!0;for(;u&&(!t.maxItems||a<t.maxItems);){r++,console.log(`📄 Syncing ${e} page ${r}...`);const f=new URLSearchParams({page_size:n.toString(),...o&&{cursor:o}}),S=`${this.config.apiBaseUrl}${i.endpoints.sync}?${f}`,h=await fetch(S,{method:"GET",headers:{"Content-Type":"application/json",...this.config.authToken&&{Authorization:`Bearer ${this.config.authToken}`}}});if(!h.ok)throw new Error(`API request failed: ${h.status} ${h.statusText}`);const m=await h.json(),$=m.items||[];if(c=m.total_count||$.length,$.length===0){u=!1;break}const j=$.map(F=>i.transforms.toStorage(i.transforms.fromApi(F)));if(await this.storage.storeItems(e,j),a+=$.length,this.updateProgress(e,{status:w.InProgress,progress:Math.min(100,a/c*100),itemsProcessed:a,totalItems:c,currentBatch:r,totalBatches:Math.ceil(c/n),currentOperation:`Syncing ${e} data`}),this.emitEvent({type:y.Progress,timestamp:new Date,domain:e,progress:this.currentProgress[e]}),o=m.next_cursor,u=!!o&&$.length===n,t.maxItems&&a>=t.maxItems)break}return{itemsSynced:a,totalItems:c}}async syncMusicDomain(e){console.log("🎵 Starting unified music domain sync...");let t=0,i=0;console.log("🎵 Syncing songs...");const n=await this.syncMusicDataType("songs",e);t+=n.itemsSynced,i+=n.totalItems,console.log("📋 Syncing playlists...");const o=await this.syncMusicDataType("playlists",e);t+=o.itemsSynced,i+=o.totalItems,console.log("🔗 Syncing playlist songs...");const r=await this.syncMusicDataType("playlist-songs",e);t+=r.itemsSynced,i+=r.totalItems,console.log("📦 Syncing media blobs...");const a=await this.syncMediaBlobs(e);return t+=a.itemsSynced,i+=a.totalItems,console.log(`✅ Unified music sync complete: ${t} total items`),{itemsSynced:t,totalItems:i}}async syncMusicDataType(e,t){const i=Math.min(t.pageSize||50,100),n=e==="songs"?"/api/sync/songs":e==="playlists"?"/api/sync/playlists":"/api/sync/playlist-songs";let o=null,r=0,a=!0,c=0;const u=20;for(console.log(`🚀 Starting ${e} sync with pageSize: ${i}`);a&&c<u&&(!t.maxItems||r<t.maxItems);){c++;try{const f=new URLSearchParams({page_size:i.toString()});o!==null&&f.set("cursor",o);const S=`${this.config.apiBaseUrl}${n}?${f}`;console.log(`🔄 Syncing ${e} page ${c}/${u} from: ${S}`);const h=await fetch(S,{method:"GET",headers:{"Content-Type":"application/json",...this.config.authToken&&{Authorization:`Bearer ${this.config.authToken}`}}});if(!h.ok)throw new Error(`Failed to sync ${e}: ${h.status} ${h.statusText}`);const m=await h.json(),$=m.items||[],j=m.pagination||{};if(console.log(`📊 ${e} page ${c} response:`,{itemsCount:$.length,hasMore:j.has_more||!1,nextCursor:j.next_cursor||null}),$.length===0){console.log(`📭 No more ${e} items, stopping sync`);break}const F=JSON.stringify($).length;F>10*1024*1024&&console.warn(`⚠️ Large ${e} response: ${F} bytes`);const Z=this.domainConfigs.music,se=$.map(H=>{try{return Z.transforms.toStorage(Z.transforms.fromApi(H))}catch(re){return console.error(`❌ Transform error for ${e} item:`,H,re),null}}).filter(H=>H!==null);console.log(`🔄 Storing ${se.length} ${e} items to storage`),await this.storeToMusicTable(e,se),r+=$.length,a=j.has_more||!1,o=j.next_cursor||null,console.log(`✅ Synced ${e} page ${c}: ${$.length} items (total: ${r})`)}catch(f){console.error(`❌ Failed to sync ${e} page ${c}:`,f);break}}return console.log(`🎯 Completed ${e} sync: ${r} total items`),{itemsSynced:r,totalItems:r}}async syncMediaBlobs(e){const t=e.pageSize||50,i="/api/sync/media";let n=null,o=0,r=!0,a=0;for(;r&&(!e.maxItems||o<e.maxItems);){a++;const c=new URLSearchParams({page_size:t.toString(),include_data:"false"});n!==null&&c.set("cursor",n);const u=`${this.config.apiBaseUrl}${i}?${c}`;console.log(`🔄 Syncing media_blobs page ${a} from: ${u}`);const f=await fetch(u,{method:"GET",headers:{"Content-Type":"application/json",...this.config.authToken&&{Authorization:`Bearer ${this.config.authToken}`}}});if(!f.ok)throw new Error(`Failed to sync media_blobs: ${f.status} ${f.statusText}`);const S=await f.json(),h=S.items||[],m=S.pagination||{};if(console.log(`📊 media_blobs page ${a} response:`,{itemsCount:h.length,hasMore:m.has_more||!1,nextCursor:m.next_cursor||null}),h.length===0)break;console.log(`🔄 Storing ${h.length} media_blobs items to storage`),await this.storage.storeItemsToTable("media_blobs",h),o+=h.length,r=m.has_more||!1,n=m.next_cursor||null,console.log(`✅ Synced media_blobs page ${a}: ${h.length} items (total: ${o})`)}return console.log(`🎯 Completed media_blobs sync: ${o} total items`),{itemsSynced:o,totalItems:o}}async storeToMusicTable(e,t){const i=e==="songs"?"songs":e==="playlists"?"playlists":"playlist_songs";i==="songs"?await this.storage.storeItemsToTable("songs",t):i==="playlists"?await this.storage.storeItemsToTable("playlists",t):await this.storage.storeItemsToTable("playlist_songs",t)}async syncBinaryData(){const e=Date.now();let t=0,i=0,n=[];try{const o=await this.storage.getItems("documents");console.log(`📦 Found ${o.length} media blobs to check for binary data`);for(const c of o)try{if(await this.storage.getBinaryData(c.id)){console.log(`✅ Skipping ${c.id} - already cached`);continue}console.log(`🔄 Requesting binary data for blob ${c.id}...`);const f=await this.requestBinaryDataViaWebSocket(c.id);f&&(await this.storage.storeBinaryData(c.id,f),t++,i+=f.byteLength,console.log(`✅ Cached binary data for ${c.id} (${f.byteLength} bytes)`))}catch(u){const f=`Failed to sync binary data for ${c.id}: ${u}`;console.error(f),n.push(f)}const r=Date.now()-e,a=o.length-t-n.length;return console.log(`🎉 Binary sync complete: ${t} cached, ${a} skipped, ${n.length} failed, ${i} bytes in ${r}ms`),{cached:t,skipped:a,failed:n.length,bytesDownloaded:i}}catch(o){const r=`Binary sync failed: ${o}`;throw console.error(r),new Error(r)}}async requestBinaryDataViaWebSocket(e){return new Promise((t,i)=>{const n=setTimeout(()=>{i(new Error(`Timeout waiting for binary data for blob ${e}`))},1e4),o=this.config.websocketUrl||"ws://localhost:3000/ws",r=new WebSocket(o);r.onopen=()=>{console.log(`🔌 Binary WebSocket connected for blob ${e}`);const c=JSON.stringify({type:"GetMediaBlobData",data:{id:e}});console.log(`📤 Sending binary request for ${e}:`,c),r.send(c),console.log(`✅ Binary request sent for ${e}`)},r.onmessage=a=>{if(console.log(`🔍 Binary WebSocket message for ${e}:`,{dataType:typeof a.data,isArrayBuffer:a.data instanceof ArrayBuffer,isBlob:a.data instanceof Blob,size:a.data.byteLength||a.data.size||a.data.length,data:a.data instanceof ArrayBuffer?"ArrayBuffer":a.data instanceof Blob?"Blob":typeof a.data=="string"?a.data.substring(0,100):"Unknown"}),a.data instanceof ArrayBuffer)console.log(`📦 Received ArrayBuffer for ${e} (${a.data.byteLength} bytes)`),clearTimeout(n),r.close(),t(a.data);else if(a.data instanceof Blob)console.log(`📦 Received Blob for ${e} (${a.data.size} bytes), converting to ArrayBuffer...`),a.data.arrayBuffer().then(c=>{console.log(`✅ Converted Blob to ArrayBuffer for ${e} (${c.byteLength} bytes)`),clearTimeout(n),r.close(),t(c)}).catch(c=>{console.error(`❌ Failed to convert Blob to ArrayBuffer for ${e}:`,c),clearTimeout(n),r.close(),i(new Error(`Failed to convert Blob to ArrayBuffer: ${c}`))});else if(typeof a.data=="string")try{const c=JSON.parse(a.data);if(console.log(`📝 JSON response for ${e}:`,c),c.type==="Error"){clearTimeout(n),r.close(),i(new Error(`Server error: ${c.data.message}`));return}if(c.type==="Welcome"||c.type==="ConnectionStatus"){console.log(`ℹ️ Ignoring non-data response: ${c.type}`);return}}catch{console.log(`⚠️ Non-JSON string response for ${e}:`,a.data.substring(0,100))}},r.onerror=a=>{console.error(`❌ Binary WebSocket error for blob ${e}:`,a),console.log(`🔍 WebSocket state: readyState=${r.readyState}, url=${r.url}`),clearTimeout(n),i(new Error(`WebSocket error for blob ${e}`))},r.onclose=a=>{console.log(`🔌 Binary WebSocket closed for blob ${e}: code=${a.code}, reason='${a.reason}', wasClean=${a.wasClean}`),a.code!==1e3&&(console.warn(`⚠️ Binary WebSocket closed unexpectedly for blob ${e}: ${a.code} ${a.reason}`),clearTimeout(n),i(new Error(`WebSocket closed unexpectedly for blob ${e}: ${a.code} ${a.reason}`)))}})}setupWebSocketListeners(){console.log("📡 WebSocket listeners ready for sync notifications")}handleAutoSyncNotification(e){console.log("🔔 Auto-sync notification received:",e),this.notificationQueue.push(e),this.debounceTimeout&&clearTimeout(this.debounceTimeout),this.debounceTimeout=setTimeout(()=>{this.processNotificationQueue()},this.config.autoSync.debounceDelay)}async processNotificationQueue(){if(this.notificationQueue.length===0)return;console.log(`📥 Processing ${this.notificationQueue.length} sync notifications...`);const e=new Map;for(const t of this.notificationQueue)e.has(t.domain)||e.set(t.domain,[]),e.get(t.domain).push(t);this.notificationQueue=[];for(const[t,i]of e)if(this.config.autoSync.domains.includes(t)){this.emitEvent({type:y.AutoSyncTriggered,timestamp:new Date,domain:t,trigger:"new_content",itemCount:i.reduce((n,o)=>n+o.itemIds.length,0)});try{await this.syncDomain(t,{includeBinaryData:!0})}catch(n){console.error(`Auto-sync failed for domain ${t}:`,n)}}}setupPeriodicSync(){if(!this.config.autoSync.periodicInterval)return;const e=this.config.autoSync.periodicInterval*60*1e3;for(const t of this.config.autoSync.domains){const i=setInterval(async()=>{console.log(`⏰ Periodic sync triggered for ${t}`),this.emitEvent({type:y.AutoSyncTriggered,timestamp:new Date,domain:t,trigger:"periodic"});try{await this.syncDomain(t,{includeBinaryData:!0})}catch(n){console.error(`Periodic sync failed for domain ${t}:`,n)}},e);this.autoSyncTimeouts.set(t,i)}}async loadSyncStates(){const e=await this.storage.getStats();for(const t of Object.keys(this.currentStatus))e.lastSyncTimes[t]&&(this.currentStatus[t]=w.Complete)}updateStatus(e,t){this.currentStatus[e]=t}updateProgress(e,t){this.currentProgress[e]=t}createEmptyProgress(){return{status:w.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0}}emitEvent(e){const t=this.eventListeners.get(e.type);t&&t.forEach(i=>{try{i(e)}catch(n){console.error("Error in sync event listener:",n)}})}aggregateBinaryStats(e){const t=e.map(i=>i.binaryStats).filter(i=>!!i);if(t.length!==0)return{cached:t.reduce((i,n)=>i+n.cached,0),skipped:t.reduce((i,n)=>i+n.skipped,0),failed:t.reduce((i,n)=>i+n.failed,0),bytesDownloaded:t.reduce((i,n)=>i+n.bytesDownloaded,0)}}}function _t(s,e,t,i){return new $t(s,e,t,i)}//! Unified Storage Implementation
//!
//! This module provides a unified storage interface for the new sync system.
//! It uses IndexedDB for efficient storage of both structured data and binary content
//! across multiple domains (music, photos, documents, etc.).
class kt{config;db=null;dbName;dbVersion;DOMAIN_TABLES={songs:"songs",playlists:"playlists",playlist_songs:"playlist_songs",media_blobs:"media_blobs",media_blob_data:"media_blob_data"};METADATA_STORE="sync_metadata";getMusicTables(){return["songs","playlists","playlist_songs"]}getDomainTable(e){switch(e){case"music":return"songs";case"photos":case"documents":case"videos":return"media_blobs";default:return"media_blobs"}}constructor(e){this.config=e,this.dbName=e.databaseName,this.dbVersion=e.version}async initialize(){return console.log(`📦 Initializing unified storage: ${this.dbName} v${this.dbVersion}`),new Promise((e,t)=>{const i=indexedDB.open(this.dbName,this.dbVersion);i.onerror=()=>{t(new Error(`Failed to open database: ${i.error?.message}`))},i.onsuccess=()=>{this.db=i.result,console.log("✅ Unified storage initialized"),e()},i.onupgradeneeded=n=>{const o=n.target.result;this.setupDatabase(o)}})}async storeItems(e,t){if(!this.db)throw new Error("Storage not initialized");if(e==="music")return this.storeMusicItems(t);const i=this.getDomainTable(e),o=this.db.transaction([i],"readwrite").objectStore(i);for(const r of t)await this.promisifyRequest(o.put({...r,_domain:e,_stored_at:new Date().toISOString()}));await this.updateDomainMetadata(e,{last_sync:new Date().toISOString(),item_count:await this.countItems(e)}),console.log(`💾 Stored ${t.length} items for domain: ${e}`)}async storeItemsToTable(e,t){if(!this.db)throw new Error("Storage not initialized");const n=this.db.transaction([e],"readwrite").objectStore(e);for(const o of t)await this.promisifyRequest(n.put({...o,_stored_at:new Date().toISOString()}));console.log(`💾 Stored ${t.length} items to table: ${e}`)}async storeMusicItems(e){if(!this.db)throw new Error("Storage not initialized");const t=e.filter(a=>!a._data_type||a._data_type==="songs"),i=e.filter(a=>a._data_type==="playlists"),n=e.filter(a=>a._data_type==="playlist-songs"),o=this.getMusicTables(),r=this.db.transaction(o,"readwrite");if(t.length>0){const a=r.objectStore("songs");for(const c of t){const{_data_type:u,...f}=c;await this.promisifyRequest(a.put({...f,_stored_at:new Date().toISOString()}))}}if(i.length>0){const a=r.objectStore("playlists");for(const c of i){const{_data_type:u,...f}=c;await this.promisifyRequest(a.put({...f,_stored_at:new Date().toISOString()}))}}if(n.length>0){const a=r.objectStore("playlist_songs");for(const c of n){const{_data_type:u,...f}=c;await this.promisifyRequest(a.put({...f,_stored_at:new Date().toISOString()}))}}console.log(`🎵 Stored music: ${t.length} songs, ${i.length} playlists, ${n.length} playlist_songs`)}async getItems(e,t={}){if(!this.db)throw new Error("Storage not initialized");if(e==="music")return this.getMusicItems(t);const i=this.getDomainTable(e),r=this.db.transaction([i],"readonly").objectStore(i).getAll(),a=await this.promisifyRequest(r);return this.applyQueryOptions(a,t)}async getMusicItems(e={}){if(!this.db)throw new Error("Storage not initialized");const t=this.getMusicTables(),r=this.db.transaction(t,"readonly").objectStore("songs").getAll(),a=await this.promisifyRequest(r);return this.applyQueryOptions(a,e)}applyQueryOptions(e,t){let i=e;if(t.where&&(i=i.filter(n=>Object.entries(t.where).every(([o,r])=>n[o]===r))),t.sortBy){const n=t.sortBy,o=t.sortOrder||"asc";i.sort((r,a)=>{const c=r[n],u=a[n];return c<u?o==="asc"?-1:1:c>u?o==="asc"?1:-1:0})}if(t.offset||t.limit){const n=t.offset||0,o=t.limit?n+t.limit:void 0;i=i.slice(n,o)}return i}async getItem(e,t){if(!this.db)throw new Error("Storage not initialized");const i=this.getDomainTable(e),r=this.db.transaction([i],"readonly").objectStore(i).get(t);return await this.promisifyRequest(r)||null}async deleteItems(e,t){if(!this.db)throw new Error("Storage not initialized");const i=this.getDomainTable(e),o=this.db.transaction([i],"readwrite").objectStore(i);for(const r of t)await this.promisifyRequest(o.delete(r));await this.updateDomainMetadata(e,{item_count:await this.countItems(e)}),console.log(`🗑️ Deleted ${t.length} items from domain: ${e}`)}async clearDomain(e){if(!this.db)throw new Error("Storage not initialized");const t=this.getDomainTable(e),n=this.db.transaction([t],"readwrite").objectStore(t);await this.promisifyRequest(n.clear()),await this.updateDomainMetadata(e,{last_sync:null,item_count:0}),console.log(`🧹 Cleared all data for domain: ${e}`)}async storeBinaryData(e,t){if(!this.db)throw new Error("Storage not initialized");if(t.byteLength>this.config.maxSize)throw new Error(`Binary data too large: ${t.byteLength} > ${this.config.maxSize}`);const i=this.DOMAIN_TABLES.media_blob_data,o=this.db.transaction([i],"readwrite").objectStore(i);await this.promisifyRequest(o.put({id:e,data:t,stored_at:new Date().toISOString()})),console.log(`📦 Stored binary data: ${e} (${t.byteLength} bytes)`)}async getBinaryData(e){if(!this.db)throw new Error("Storage not initialized");const t=this.DOMAIN_TABLES.media_blob_data,o=this.db.transaction([t],"readonly").objectStore(t).get(e),r=await this.promisifyRequest(o);if(!r)return null;const a=new Date(r.stored_at);return Math.floor((Date.now()-a.getTime())/(1e3*60*60*24))>this.config.maxAge?(await this.deleteBinaryData(e),null):r.data}async deleteBinaryData(e){if(!this.db)throw new Error("Storage not initialized");const t=this.DOMAIN_TABLES.media_blob_data,n=this.db.transaction([t],"readwrite").objectStore(t);await this.promisifyRequest(n.delete(e)),console.log(`🗑️ Deleted binary data: ${e}`)}async getStats(){if(!this.db)throw new Error("Storage not initialized");const e={music:await this.countItems("music"),photos:await this.countItems("photos"),documents:await this.countItems("documents"),videos:await this.countItems("videos")},t=await this.calculateBinarySize(),i={music:await this.getLastSyncTime("music"),photos:await this.getLastSyncTime("photos"),documents:await this.getLastSyncTime("documents"),videos:await this.getLastSyncTime("videos")},n=t+Object.values(e).reduce((o,r)=>o+r,0)*1024;return{itemCounts:e,totalSize:n,binarySize:t,lastSyncTimes:i}}async cleanup(){console.log("🧹 Starting storage cleanup...");const e=this.config.maxAge*24*60*60*1e3,t=Date.now()-e;let i=0,n=0;if(!this.db)throw new Error("Storage not initialized");const o=this.DOMAIN_TABLES.media_blob_data,c=this.db.transaction([o],"readwrite").objectStore(o).openCursor();return new Promise((u,f)=>{c.onsuccess=S=>{const h=S.target.result;if(h){const m=h.value;new Date(m.stored_at).getTime()<t&&(n+=m.data.byteLength,i++,h.delete()),h.continue()}else console.log(`🧹 Cleanup completed: ${i} items, ${n} bytes freed`),u()},c.onerror=()=>{f(new Error(`Cleanup failed: ${c.error?.message}`))}})}setupDatabase(e){console.log("🔧 Setting up database schema..."),Object.entries(this.DOMAIN_TABLES).forEach(([t,i])=>{if(!e.objectStoreNames.contains(i)){const n=e.createObjectStore(i,{keyPath:"id"});switch(n.createIndex("_stored_at","_stored_at"),t){case"songs":n.createIndex("title","title"),n.createIndex("artist","artist"),n.createIndex("album","album"),n.createIndex("created_at","created_at");break;case"playlists":n.createIndex("title","title"),n.createIndex("created_at","created_at");break;case"playlist_songs":n.createIndex("playlist_id","playlist_id"),n.createIndex("song_id","song_id"),n.createIndex("position","position");break;case"media_blobs":n.createIndex("created_at","created_at"),n.createIndex("mime_type","mime_type"),n.createIndex("sha256","sha256");break}}}),e.objectStoreNames.contains(this.METADATA_STORE)||e.createObjectStore(this.METADATA_STORE,{keyPath:"domain"}),console.log("✅ Database schema setup complete")}async promisifyRequest(e){return new Promise((t,i)=>{e.onsuccess=()=>t(e.result),e.onerror=()=>i(e.error)})}async countItems(e){if(!this.db)return 0;if(e==="music"){const r=this.getMusicTables(),a=this.db.transaction(r,"readonly");let c=0;for(const u of r){const S=a.objectStore(u).count();c+=await this.promisifyRequest(S)}return c}const t=this.getDomainTable(e),o=this.db.transaction([t],"readonly").objectStore(t).count();return await this.promisifyRequest(o)}async calculateBinarySize(){if(!this.db)return 0;const e=this.DOMAIN_TABLES.media_blob_data,i=this.db.transaction([e],"readonly").objectStore(e);let n=0;const o=i.openCursor();return new Promise((r,a)=>{o.onsuccess=c=>{const u=c.target.result;u?(n+=u.value.data.byteLength,u.continue()):r(n)},o.onerror=()=>{a(new Error(`Failed to calculate binary size: ${o.error?.message}`))}})}async getLastSyncTime(e){const t=await this.getDomainMetadata(e);return t?.last_sync?new Date(t.last_sync):null}async updateDomainMetadata(e,t){if(!this.db)return;const n=this.db.transaction([this.METADATA_STORE],"readwrite").objectStore(this.METADATA_STORE),r={...await this.promisifyRequest(n.get(e))||{domain:e},...t};await this.promisifyRequest(n.put(r))}async getDomainMetadata(e){if(!this.db)return null;const n=this.db.transaction([this.METADATA_STORE],"readonly").objectStore(this.METADATA_STORE).get(e);return await this.promisifyRequest(n)}async destroyAll(){return console.log("💥 Starting complete database teardown..."),this.db&&(this.db.close(),this.db=null),new Promise((e,t)=>{const i=indexedDB.deleteDatabase(this.dbName);i.onsuccess=()=>{console.log("🗑️ Database completely destroyed:",this.dbName),e()},i.onerror=()=>{console.error("❌ Failed to destroy database:",i.error),t(new Error(`Failed to destroy database: ${i.error?.message}`))},i.onblocked=()=>{console.warn("⚠️ Database deletion blocked - close all tabs using this database")}})}}function Ct(s){return new kt(s)}//! Auto-Sync Notification Router - Phase 3
//!
//! This module handles routing WebSocket notifications to appropriate sync operations.
//! It provides intelligent notification filtering, domain mapping, and debounced sync
//! triggering for real-time auto-sync functionality.
class xt{syncManager;wsClient;config;isActive=!1;notificationQueue=[];domainDebounceState=new Map;stats={notificationsReceived:0,syncsTriggered:0,lastActivity:0,domainStats:new Map};constructor(e,t,i){this.syncManager=e,this.wsClient=t,this.config=i,this.initializeDomainStates()}async start(){if(this.isActive){console.log("📡 Auto-sync notification router already active");return}console.log("🚀 Starting auto-sync notification router..."),await this.subscribeToChannels(),this.setupWebSocketListeners(),this.isActive=!0,console.log("✅ Auto-sync notification router started")}async stop(){if(!this.isActive){console.log("📡 Auto-sync notification router already stopped");return}console.log("⏹️ Stopping auto-sync notification router..."),this.clearAllDebounceTimeouts(),await this.unsubscribeFromChannels(),this.clearWebSocketListeners(),this.isActive=!1,console.log("✅ Auto-sync notification router stopped")}async processNotification(e){if(!this.isActive||!this.config.enabled)return;this.stats.notificationsReceived++,this.stats.lastActivity=Date.now(),console.log("📬 Processing notification:",{channel:e.channel,eventType:e.eventType,priority:e.priority});const t=this.getTargetDomains(e);if(t.length===0){console.log("⏭️ No target domains for notification, skipping");return}for(const i of t){const n={notification:e,receivedAt:Date.now(),domain:i,priority:this.calculatePriority(e,i)};this.shouldTriggerImmediateSync(n)?await this.triggerImmediateSync(n):this.queueForBatchedSync(n)}}getStats(){return{...this.stats,isActive:this.isActive,queueSize:this.notificationQueue.length,domainStats:Object.fromEntries(this.stats.domainStats)}}updateConfig(e){this.config={...this.config,...e},console.log("⚙️ Auto-sync notification router config updated")}getPendingNotifications(e){return e?this.domainDebounceState.get(e)?.pendingNotifications||[]:this.notificationQueue}async forceSyncForDomain(e){console.log(`🔄 Force syncing domain: ${e}`),this.clearDomainDebounce(e),await this.triggerDomainSync(e,"manual",[])}initializeDomainStates(){const e=["music","photos","documents","videos"];for(const t of e)this.domainDebounceState.set(t,{timeout:null,pendingNotifications:[],lastTrigger:0}),this.stats.domainStats.set(t,{triggers:0,lastSync:0})}async subscribeToChannels(){for(const e of this.config.monitoredChannels)this.wsClient.subscribeToNotifications(e)?console.log(`📡 Subscribed to channel: ${e}`):console.warn(`⚠️ Failed to subscribe to channel: ${e}`)}async unsubscribeFromChannels(){for(const e of this.config.monitoredChannels)this.wsClient.unsubscribeFromNotifications(e)&&console.log(`📡 Unsubscribed from channel: ${e}`)}setupWebSocketListeners(){this.wsClient.on("notification",this.handleWebSocketNotification.bind(this)),this.wsClient.on("statusChange",this.handleConnectionStatusChange.bind(this))}clearWebSocketListeners(){this.wsClient.off("notification"),this.wsClient.off("statusChange")}async handleWebSocketNotification(e){const t={id:e.id,channel:e.channel,eventType:e.event_type,payload:e.payload,priority:e.priority,timestamp:e.timestamp};await this.processNotification(t)}handleConnectionStatusChange(e){console.log(`🔌 WebSocket connection status: ${e}`),e==="connected"&&this.subscribeToChannels()}getTargetDomains(e){const t=[];for(const n of this.config.syncRules)this.doesNotificationMatchRule(e,n)&&t.push(...n.targetDomains);const i=this.getDefaultChannelMapping(e.channel);return i.length>0&&t.length===0&&t.push(...i),[...new Set(t)]}doesNotificationMatchRule(e,t){if(t.channels&&!t.channels.includes(e.channel)||t.eventTypes&&!t.eventTypes.includes(e.eventType)||t.priorities&&!t.priorities.includes(e.priority))return!1;if(t.payloadConditions&&e.payload){for(const[i,n]of Object.entries(t.payloadConditions))if(e.payload[i]!==n)return!1}return!0}getDefaultChannelMapping(e){switch(e){case"MediaBlobs":return["music","photos","videos"];case"ThumbnailJobs":return["photos","videos"];case"UserAuth":return[];case"System":return["music","photos","documents","videos"];case"Analytics":return[];default:return[]}}calculatePriority(e,t){let i=0;switch(e.priority){case"critical":i+=100;break;case"high":i+=75;break;case"medium":i+=50;break;case"low":i+=25;break;default:i+=10}switch(e.channel){case"MediaBlobs":i+=20;break;case"ThumbnailJobs":i+=10;break;case"System":i+=30;break}const n=this.stats.domainStats.get(t);return n&&Date.now()-n.lastSync>3e5&&(i+=15),i}shouldTriggerImmediateSync(e){const{notification:t}=e;return!!(this.config.priorityThresholds.immediate.includes(t.priority)||this.notificationQueue.length>=this.config.maxQueueSize)}async triggerImmediateSync(e){const{domain:t}=e;console.log(`⚡ Triggering immediate sync for domain: ${t}`),this.clearDomainDebounce(t),await this.triggerDomainSync(t,"notification-immediate",[e])}queueForBatchedSync(e){const{domain:t}=e,i=this.domainDebounceState.get(t);if(!i){console.warn(`⚠️ No debounce state for domain: ${t}`);return}i.pendingNotifications.push(e),i.timeout&&clearTimeout(i.timeout),i.timeout=setTimeout(async()=>{await this.triggerBatchedSync(t)},this.config.debounceDelay),console.log(`📦 Queued notification for batched sync: ${t} (${i.pendingNotifications.length} pending)`)}async triggerBatchedSync(e){const t=this.domainDebounceState.get(e);if(!t||t.pendingNotifications.length===0)return;console.log(`📦 Triggering batched sync for domain: ${e} (${t.pendingNotifications.length} notifications)`);const i=[...t.pendingNotifications];t.pendingNotifications=[],t.timeout=null,await this.triggerDomainSync(e,"notification-batched",i)}async triggerDomainSync(e,t,i){const n=this.stats.domainStats.get(e);n&&(n.triggers++,n.lastSync=Date.now()),this.stats.syncsTriggered++;const o=this.domainDebounceState.get(e);o&&(o.lastTrigger=Date.now()),console.log(`🔄 Auto-sync triggered for ${e}:`,{trigger:t,notificationCount:i.length,notificationIds:i.map(r=>r.notification.id)});try{await this.syncManager.syncDomain(e,{includeBinaryData:!0}),console.log(`✅ Auto-sync completed for ${e}`)}catch(r){console.error(`❌ Auto-sync failed for ${e}:`,r)}}clearDomainDebounce(e){const t=this.domainDebounceState.get(e);t?.timeout&&(clearTimeout(t.timeout),t.timeout=null)}clearAllDebounceTimeouts(){for(const[e]of this.domainDebounceState)this.clearDomainDebounce(e)}}function Dt(s,e,t){const n={...{enabled:!0,debounceDelay:5e3,maxQueueSize:50,monitoredChannels:["MediaBlobs","ThumbnailJobs","System"],syncRules:[{id:"media-content-updates",channels:["MediaBlobs"],eventTypes:["content.created","content.updated","content.processed"],targetDomains:["music","photos","videos"],priorities:["high","medium"]},{id:"thumbnail-updates",channels:["ThumbnailJobs"],eventTypes:["thumbnail.completed","thumbnail.batch_completed"],targetDomains:["photos","videos"],priorities:["medium","low"]},{id:"system-updates",channels:["System"],eventTypes:["sync.force_refresh","content.bulk_update"],targetDomains:["music","photos","documents","videos"],priorities:["critical","high"]}],userNotifications:!0,priorityThresholds:{immediate:["critical","high"],batched:["medium","low"]}},...t};return new xt(s,e,n)}//! Enhanced Auto-Sync Manager - Phase 3
//!
//! This module provides advanced auto-sync capabilities with intelligent scheduling,
//! rule-based triggers, resource awareness, and integration with the service worker
//! background sync system.
class It{syncManager;serviceWorkerSyncManager;notificationRouter;config;isEnabled=!1;scheduledSyncs=new Map;activeRules=new Map;resourceMonitor=null;stats={totalSyncsTriggered:0,ruleBasedTriggers:0,scheduledTriggers:0,notificationTriggers:0,backgroundSyncs:0,failedSyncs:0,lastActivity:new Date,domainStats:new Map,resourceOptimizations:0};eventListeners=new Map;constructor(e,t,i,n){this.syncManager=e,this.config=t,this.serviceWorkerSyncManager=i||null,this.notificationRouter=n||null,this.config.resourceAwareness.enabled&&(this.resourceMonitor=new Tt),this.initializeDomainStats(),this.config.customRules.length===0&&(this.config.customRules=this.createDefaultRules())}async enable(){if(this.isEnabled){console.log("🔄 Enhanced auto-sync already enabled");return}console.log("🚀 Enabling enhanced auto-sync..."),this.resourceMonitor&&await this.resourceMonitor.start(),this.setupPeriodicSyncs(),this.installRules(),this.notificationRouter&&await this.setupNotificationIntegration(),this.serviceWorkerSyncManager&&this.config.backgroundSync.enabled&&await this.setupServiceWorkerIntegration(),this.isEnabled=!0,console.log("✅ Enhanced auto-sync enabled")}async disable(){if(!this.isEnabled){console.log("🔄 Enhanced auto-sync already disabled");return}console.log("⏹️ Disabling enhanced auto-sync..."),this.clearAllScheduledSyncs(),this.resourceMonitor&&await this.resourceMonitor.stop(),this.notificationRouter&&await this.notificationRouter.stop(),this.isEnabled=!1,console.log("✅ Enhanced auto-sync disabled")}addRule(e){this.activeRules.set(e.id,e),this.config.customRules.push(e),this.isEnabled&&this.installRule(e),console.log(`📋 Added auto-sync rule: ${e.id}`)}removeRule(e){this.activeRules.delete(e),this.config.customRules=this.config.customRules.filter(i=>i.id!==e);const t=`rule:${e}`;this.scheduledSyncs.has(t)&&(clearTimeout(this.scheduledSyncs.get(t)),this.scheduledSyncs.delete(t)),console.log(`🗑️ Removed auto-sync rule: ${e}`)}async triggerSync(e,t,i){if(!this.isEnabled){console.log("⚠️ Auto-sync disabled, ignoring trigger");return}if(this.resourceMonitor){const n=await this.resourceMonitor.getCurrentState();if(!this.shouldAllowSync(n)){console.log("⚡ Sync blocked by resource constraints"),this.stats.resourceOptimizations++,this.serviceWorkerSyncManager&&this.config.backgroundSync.enabled&&await this.scheduleBackgroundSync(e,t,i);return}}if(this.config.smartScheduling.enabled&&this.isInQuietHours()){console.log("🔕 Sync blocked by quiet hours"),await this.scheduleForLater(e,t,i);return}await this.executeSync(e,t,i)}getStats(){return{...this.stats,domainStats:new Map(this.stats.domainStats)}}updateConfig(e){this.config={...this.config,...e},this.isEnabled&&this.disable().then(()=>this.enable())}on(e,t){this.eventListeners.has(e)||this.eventListeners.set(e,new Set),this.eventListeners.get(e).add(t)}off(e,t){t?this.eventListeners.get(e)?.delete(t):this.eventListeners.delete(e)}getActiveRules(){return Array.from(this.activeRules.values())}async forceSync(e,t){console.log(`🔥 Force sync triggered for ${e}: ${t}`),await this.executeSync(e,"manual",{priority:100})}initializeDomainStats(){const e=["music","photos","documents","videos"];for(const t of e)this.stats.domainStats.set(t,{syncsTriggered:0,lastSync:null,averageInterval:0,failureCount:0})}createDefaultRules(){return[{id:"periodic-all-domains",name:"Periodic Full Sync",domains:["music","photos","documents","videos"],schedule:{type:"periodic",interval:this.config.periodicInterval*60*1e3},conditions:{minBatteryLevel:.3,allowedConnectionTypes:["wifi"],maxMemoryUsage:80},priority:50,enabled:!0},{id:"high-priority-notifications",name:"High Priority Content Updates",domains:["music","photos","videos"],trigger:"notification-immediate",conditions:{notificationPriorities:["critical","high"],minBatteryLevel:.2},priority:90,enabled:!0},{id:"background-low-priority",name:"Background Low Priority Sync",domains:["documents"],schedule:{type:"periodic",interval:36e5},conditions:{preferBackground:!0,minBatteryLevel:.5,allowedConnectionTypes:["wifi"]},priority:20,enabled:!0},{id:"connection-recovery",name:"Connection Recovery Sync",domains:["music","photos","documents","videos"],trigger:"connection-restored",conditions:{minBatteryLevel:.3},priority:70,enabled:!0}]}setupPeriodicSyncs(){for(const e of this.config.customRules)e.schedule&&e.enabled&&this.scheduleRuleExecution(e)}installRules(){for(const e of this.config.customRules)e.enabled&&this.installRule(e)}installRule(e){this.activeRules.set(e.id,e),e.schedule&&this.scheduleRuleExecution(e),console.log(`📋 Installed auto-sync rule: ${e.name}`)}scheduleRuleExecution(e){if(!e.schedule)return;const t=`rule:${e.id}`;this.scheduledSyncs.has(t)&&clearTimeout(this.scheduledSyncs.get(t));let i;switch(e.schedule.type){case"periodic":i=e.schedule.interval||36e5;break;case"daily":i=this.calculateDailyDelay(e.schedule.time||"00:00");break;case"weekly":i=this.calculateWeeklyDelay(e.schedule.dayOfWeek||0,e.schedule.time||"00:00");break;case"cron":i=36e5;break;default:return}const n=setTimeout(async()=>{await this.executeRule(e),e.schedule.type==="periodic"&&this.scheduleRuleExecution(e)},i);this.scheduledSyncs.set(t,n)}async executeRule(e){if(console.log(`📋 Executing auto-sync rule: ${e.name}`),!await this.checkRuleConditions(e)){console.log(`⏭️ Rule conditions not met: ${e.name}`);return}for(const t of e.domains)try{await this.triggerSync(t,"scheduled",{ruleId:e.id,priority:e.priority})}catch(i){console.error(`❌ Rule execution failed for ${t}:`,i)}}async checkRuleConditions(e){if(!e.conditions)return!0;if(this.resourceMonitor){const t=await this.resourceMonitor.getCurrentState();if(e.conditions.minBatteryLevel&&t.battery.level<e.conditions.minBatteryLevel||e.conditions.allowedConnectionTypes&&!e.conditions.allowedConnectionTypes.includes(t.connection.type)||e.conditions.maxMemoryUsage&&t.memory.available>0&&t.memory.used/t.memory.available*100>e.conditions.maxMemoryUsage)return!1}return!0}async setupNotificationIntegration(){this.notificationRouter&&await this.notificationRouter.start()}async setupServiceWorkerIntegration(){this.serviceWorkerSyncManager}async executeSync(e,t,i){try{this.updateSyncStats(e,t),this.emitEvent({type:y.AutoSyncTriggered,domain:e,trigger:t,timestamp:new Date}),this.shouldUseBackgroundSync(t,i)&&this.serviceWorkerSyncManager?(await this.serviceWorkerSyncManager.registerBackgroundSync({type:"background-sync",domain:e,options:{includeBinaryData:!0},priority:i?.priority||50,maxRetries:3,retryDelay:5e3}),this.stats.backgroundSyncs++,console.log(`🔄 Background sync scheduled for ${e}`)):(await this.syncManager.syncDomain(e,{includeBinaryData:!0}),console.log(`✅ Foreground sync completed for ${e}`))}catch(n){this.stats.failedSyncs++;const o=this.stats.domainStats.get(e);throw o&&o.failureCount++,console.error(`❌ Auto-sync failed for ${e}:`,n),n}}shouldUseBackgroundSync(e,t){return!this.config.backgroundSync.enabled||!this.serviceWorkerSyncManager||t?.priority&&t.priority>80?!1:e==="scheduled"?this.config.backgroundSync.prioritizeBackground:!1}updateSyncStats(e,t){switch(this.stats.totalSyncsTriggered++,this.stats.lastActivity=new Date,t){case"scheduled":this.stats.scheduledTriggers++;break;case"notification-immediate":case"notification-batched":this.stats.notificationTriggers++;break;case"manual":this.stats.ruleBasedTriggers++;break}const i=this.stats.domainStats.get(e);if(i){if(i.syncsTriggered++,i.lastSync){const n=Date.now()-i.lastSync.getTime();i.averageInterval=(i.averageInterval+n)/i.syncsTriggered}i.lastSync=new Date}}isInQuietHours(){if(!this.config.smartScheduling.enabled)return!1;const e=new Date,t=e.getHours()*60+e.getMinutes(),i=this.parseTimeString(this.config.smartScheduling.quietHours.start),n=this.parseTimeString(this.config.smartScheduling.quietHours.end);return i<=n?t>=i&&t<=n:t>=i||t<=n}parseTimeString(e){const t=e.split(":"),i=parseInt(t[0]||"0"),n=parseInt(t[1]||"0");return i*60+n}calculateDailyDelay(e){const t=new Date,i=e.split(":"),n=parseInt(i[0]||"0"),o=parseInt(i[1]||"0"),r=new Date(t);return r.setHours(n,o,0,0),r<=t&&r.setDate(r.getDate()+1),r.getTime()-t.getTime()}calculateWeeklyDelay(e,t){const i=new Date,n=t.split(":"),o=parseInt(n[0]||"0"),r=parseInt(n[1]||"0"),a=new Date(i),c=(e-i.getDay()+7)%7;return a.setDate(i.getDate()+c),a.setHours(o,r,0,0),a<=i&&a.setDate(a.getDate()+7),a.getTime()-i.getTime()}async scheduleForLater(e,t,i){const n=this.calculateNextAvailableSlot();setTimeout(async()=>{await this.triggerSync(e,t,i)},n),console.log(`⏰ Sync scheduled for later: ${e} (${n}ms)`)}async scheduleBackgroundSync(e,t,i){this.serviceWorkerSyncManager&&(await this.serviceWorkerSyncManager.registerBackgroundSync({type:"background-sync",domain:e,options:{includeBinaryData:!0},priority:i?.priority||30,maxRetries:3,retryDelay:5e3}),console.log(`🔄 Background sync scheduled for resource-constrained environment: ${e}`))}calculateNextAvailableSlot(){if(this.isInQuietHours()){const e=this.parseTimeString(this.config.smartScheduling.quietHours.end),t=new Date,i=t.getHours()*60+t.getMinutes();let n=e-i;return n<=0&&(n+=24*60),n*60*1e3}return 5*60*1e3}shouldAllowSync(e){const t=this.config.resourceAwareness;return!(e.battery.level<t.batteryThreshold&&!e.battery.charging||!t.connectionTypes.includes(e.connection.type)||e.memory.used/(1024*1024)>t.memoryThreshold)}clearAllScheduledSyncs(){for(const e of this.scheduledSyncs.values())clearTimeout(e);this.scheduledSyncs.clear()}emitEvent(e){const t=this.eventListeners.get(e.type);if(t)for(const i of t)try{i(e)}catch(n){console.error("Error in auto-sync event listener:",n)}}}class Tt{batteryManager=null;connectionInfo=null;memoryInfo=null;async start(){if("getBattery"in navigator)try{this.batteryManager=await navigator.getBattery()}catch(e){console.warn("Battery API not available:",e)}this.connectionInfo=navigator.connection||navigator.mozConnection||navigator.webkitConnection,this.memoryInfo=performance.memory}async stop(){}async getCurrentState(){return{battery:{level:this.batteryManager?.level||1,charging:this.batteryManager?.charging||!1},connection:{type:this.connectionInfo?.type||"unknown",effectiveType:this.connectionInfo?.effectiveType||"4g",downlink:this.connectionInfo?.downlink||10},memory:{used:this.memoryInfo?.usedJSHeapSize||0,available:this.memoryInfo?.totalJSHeapSize||100*1024*1024},performance:{cpuUsage:0,isLowPowerMode:!1}}}}function At(s,e,t,i){const o={...{enabled:!0,syncOnNewContent:!0,periodicInterval:30,domains:["music","photos"],debounceDelay:5e3,customRules:[],resourceAwareness:{enabled:!0,batteryThreshold:.2,connectionTypes:["wifi","ethernet"],memoryThreshold:100},smartScheduling:{enabled:!0,quietHours:{start:"22:00",end:"07:00"},adaptiveInterval:!0,minInterval:15,maxInterval:120},backgroundSync:{enabled:!0,prioritizeBackground:!0,fallbackToForeground:!0},userPreferences:{respectDataSaver:!0,respectLowPowerMode:!0,maxDailySync:48}},...e};return new It(s,o,t,i)}//! User Notification Manager - Phase 3
//!
//! This module handles user notifications for sync events, providing both
//! in-app notifications and system push notifications for sync status updates,
//! new content availability, and sync completion events.
class Mt{syncManager;serviceWorkerSyncManager;config;isEnabled=!1;inAppNotifications=new Map;debounceTimeouts=new Map;notificationContainer=null;activeNotificationElements=new Map;stats={totalSent:0,inAppSent:0,pushSent:0,byType:{},byDomain:{},interactions:{clicked:0,dismissed:0,actionsTriggered:0},permissions:{push:"default",requested:!1}};constructor(e,t,i){this.syncManager=e,this.config=t,this.serviceWorkerSyncManager=i||null,this.initializeDomainStats()}async initialize(){if(this.isEnabled){console.log("📢 User notification manager already initialized");return}console.log("🚀 Initializing user notification manager..."),this.config.push.enabled&&this.config.push.requestPermission&&await this.requestPushPermission(),this.config.inApp.enabled&&this.setupInAppNotifications(),this.setupSyncEventListeners(),this.serviceWorkerSyncManager&&this.setupServiceWorkerIntegration(),this.isEnabled=!0,console.log("✅ User notification manager initialized")}async shutdown(){this.isEnabled&&(console.log("⏹️ Shutting down user notification manager..."),this.clearAllDebounceTimeouts(),this.clearSyncEventListeners(),this.clearAllInAppNotifications(),this.notificationContainer&&(this.notificationContainer.remove(),this.notificationContainer=null),this.isEnabled=!1,console.log("✅ User notification manager shutdown complete"))}async sendInAppNotification(e){if(!this.config.inApp.enabled||!this.shouldShowNotification(e))return"";const t=this.generateNotificationId(),i={...e,id:t,timestamp:new Date};return this.inAppNotifications.set(t,i),this.displayInAppNotification(i),this.stats.inAppSent++,this.stats.totalSent++,this.updateTypeStats(e.type),e.domain&&this.updateDomainStats(e.domain),this.manageNotificationQueue(),this.playNotificationSound(e.type),this.triggerVibration(e.type),console.log(`📱 In-app notification sent: ${e.title}`),t}async sendPushNotification(e){if(!this.config.push.enabled||!this.hasPushPermission())return!1;if(this.isInQuietHours())return console.log("🔕 Push notification blocked by quiet hours"),!1;try{return this.serviceWorkerSyncManager&&"serviceWorker"in navigator?await(await navigator.serviceWorker.ready).showNotification(e.title,{body:e.body,icon:e.icon||"/icon-192.png",badge:e.badge||"/badge-72.png",tag:e.tag,requireInteraction:e.requireInteraction||!1,data:e.data}):new Notification(e.title,{body:e.body,icon:e.icon||"/icon-192.png",tag:e.tag,requireInteraction:e.requireInteraction||!1,data:e.data}),this.stats.pushSent++,this.stats.totalSent++,console.log(`🔔 Push notification sent: ${e.title}`),!0}catch(t){return console.error("❌ Failed to send push notification:",t),!1}}dismissInAppNotification(e){if(!this.inAppNotifications.get(e))return;const i=this.activeNotificationElements.get(e);i&&(i.remove(),this.activeNotificationElements.delete(e)),this.inAppNotifications.delete(e),this.stats.interactions.dismissed++,console.log(`📱 Dismissed notification: ${e}`)}clearAllInAppNotifications(){for(const e of this.inAppNotifications.keys())this.dismissInAppNotification(e)}getStats(){return{...this.stats,permissions:{push:Notification.permission,requested:this.stats.permissions.requested}}}updateConfig(e){this.config={...this.config,...e},e.inApp&&this.notificationContainer&&this.setupInAppNotifications(),console.log("⚙️ Notification configuration updated")}getActiveNotifications(){return Array.from(this.inAppNotifications.values())}async requestPushPermission(){if(!("Notification"in window))return console.warn("⚠️ Browser doesn't support notifications"),!1;if(Notification.permission==="granted")return!0;if(Notification.permission==="denied")return console.warn("⚠️ Notification permission denied by user"),!1;try{const e=await Notification.requestPermission();return this.stats.permissions.requested=!0,this.stats.permissions.push=e,e==="granted"?(console.log("✅ Push notification permission granted"),!0):(console.log("❌ Push notification permission denied"),!1)}catch(e){return console.error("❌ Error requesting notification permission:",e),!1}}hasPushPermission(){return"Notification"in window&&Notification.permission==="granted"}initializeDomainStats(){const e=["music","photos","documents","videos"];for(const t of e)this.stats.byDomain[t]=0}setupInAppNotifications(){this.notificationContainer&&this.notificationContainer.remove(),this.notificationContainer=document.createElement("div"),this.notificationContainer.id="unified-sync-notifications",this.notificationContainer.className=`notification-container ${this.config.inApp.position}`,this.addNotificationStyles(),document.body.appendChild(this.notificationContainer)}setupSyncEventListeners(){this.syncManager.on(y.AutoSyncTriggered,this.handleAutoSyncTriggered.bind(this)),this.syncManager.on(y.Progress,this.handleSyncProgress.bind(this)),this.syncManager.on(y.AllCompleted,this.handleSyncCompleted.bind(this)),this.syncManager.on(y.DomainCompleted,this.handleDomainCompleted.bind(this)),this.syncManager.on(y.Failed,this.handleSyncFailed.bind(this))}clearSyncEventListeners(){}setupServiceWorkerIntegration(){this.serviceWorkerSyncManager}async handleAutoSyncTriggered(e){if(e.type!==y.AutoSyncTriggered)return;const t=e;await this.sendInAppNotification({type:"info",title:"Auto-sync Started",message:`Syncing ${t.domain} content (${t.trigger})`,domain:t.domain,autoHide:!0,actions:[{id:"view-progress",label:"View Progress",handler:()=>this.showSyncProgress(t.domain)}]})}async handleSyncProgress(e){if(e.type!==y.Progress)return;const t=e,i=`progress-${t.domain}`,n=this.inAppNotifications.get(i);n?(n.progress=t.progress.progress,n.message=`Syncing ${t.domain}: ${t.progress.itemsProcessed}/${t.progress.totalItems} items`,this.updateProgressNotification(n)):this.config.inApp.showProgress&&await this.sendInAppNotification({type:"progress",title:`Syncing ${t.domain}`,message:`${t.progress.itemsProcessed}/${t.progress.totalItems} items`,domain:t.domain,progress:t.progress.progress,autoHide:!1})}async handleSyncCompleted(e){if(e.type!==y.AllCompleted)return;const t=e;await this.sendInAppNotification({type:"success",title:"Sync Complete",message:`Successfully synced ${t.result.itemsSynced} items`,autoHide:!0}),this.config.push.showSyncComplete&&await this.sendPushNotification({title:"Sync Complete",body:`Successfully synced ${t.result.itemsSynced} items`,tag:"sync-complete",requireInteraction:!1})}async handleDomainCompleted(e){const t=e,i=`progress-${t.result.domain}`;this.dismissInAppNotification(i),await this.sendInAppNotification({type:"success",title:`${t.result.domain} Sync Complete`,message:`Synced ${t.result.itemsSynced} items in ${t.result.duration}ms`,domain:t.result.domain,autoHide:!0})}async handleSyncFailed(e){if(e.type!==y.Failed)return;const t=e;await this.sendInAppNotification({type:"error",title:"Sync Failed",message:`Failed to sync ${t.domain}: ${t.error.message}`,domain:t.domain,autoHide:!1,actions:[{id:"retry",label:"Retry",style:"primary",handler:()=>this.retrySyncForDomain(t.domain)},{id:"details",label:"Details",handler:()=>this.showErrorDetails(t.error)}]}),this.config.push.showSyncFailed&&await this.sendPushNotification({title:"Sync Failed",body:`Failed to sync ${t.domain}`,tag:"sync-failed",requireInteraction:!0})}displayInAppNotification(e){if(!this.notificationContainer)return;const t=this.createNotificationElement(e);this.notificationContainer.appendChild(t),this.activeNotificationElements.set(e.id,t),e.autoHide&&this.config.inApp.autoHide&&setTimeout(()=>{this.dismissInAppNotification(e.id)},this.config.inApp.autoHideDelay),requestAnimationFrame(()=>{t.classList.add("show")})}createNotificationElement(e){const t=document.createElement("div");t.className=`notification notification-${e.type}`,t.dataset.id=e.id;const i=`
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
            ${e.actions.map(n=>`
              <button class="notification-action ${n.style||"secondary"}" data-action="${n.id}">
                ${this.escapeHtml(n.label)}
              </button>
            `).join("")}
          </div>
        `:""}
      </div>
    `;return t.innerHTML=i,t.addEventListener("click",n=>{const r=n.target.dataset.action;if(r==="close")this.dismissInAppNotification(e.id),this.stats.interactions.dismissed++;else if(r&&e.actions){const a=e.actions.find(c=>c.id===r);a&&(a.handler(),this.stats.interactions.actionsTriggered++)}else this.stats.interactions.clicked++}),t}updateProgressNotification(e){const t=this.activeNotificationElements.get(e.id);if(!t)return;const i=t.querySelector(".progress-fill"),n=t.querySelector(".progress-text"),o=t.querySelector(".notification-message");i&&e.progress!==void 0&&(i.style.width=`${e.progress}%`),n&&e.progress!==void 0&&(n.textContent=`${Math.round(e.progress)}%`),o&&(o.textContent=e.message)}addNotificationStyles(){if(document.getElementById("unified-sync-notification-styles"))return;const e=document.createElement("style");e.id="unified-sync-notification-styles",e.textContent=`
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
    `,document.head.appendChild(e)}manageNotificationQueue(){const e=Array.from(this.inAppNotifications.values()),t=this.config.inApp.maxNotifications;if(e.length>t){const n=e.sort((o,r)=>o.timestamp.getTime()-r.timestamp.getTime()).slice(0,e.length-t);for(const o of n)this.dismissInAppNotification(o.id)}}shouldShowNotification(e){return!(e.domain&&!this.config.filters.domains.includes(e.domain))}isInQuietHours(){const e=new Date,t=e.getHours()*60+e.getMinutes(),i=this.parseTimeString(this.config.push.quietHours.start),n=this.parseTimeString(this.config.push.quietHours.end);return i<=n?t>=i&&t<=n:t>=i||t<=n}parseTimeString(e){const t=e.split(":"),i=parseInt(t[0]||"0"),n=parseInt(t[1]||"0");return i*60+n}playNotificationSound(e){if(this.config.feedback.enableSounds)try{const t=this.config.feedback.customSounds[e]||this.getDefaultSoundUrl(e);if(t){const i=new Audio(t);i.volume=this.config.feedback.soundVolume,i.play().catch(n=>{console.warn("Failed to play notification sound:",n)})}}catch(t){console.warn("Error playing notification sound:",t)}}triggerVibration(e){if(!(!this.config.feedback.enableVibration||!("vibrate"in navigator)))try{let t;switch(e){case"success":t=[100];break;case"error":t=[100,50,100];break;case"warning":t=[150];break;default:t=[50]}navigator.vibrate(t)}catch(t){console.warn("Error triggering vibration:",t)}}getDefaultSoundUrl(e){return{success:"/sounds/success.mp3",error:"/sounds/error.mp3",warning:"/sounds/warning.mp3",info:"/sounds/info.mp3"}[e]||null}updateTypeStats(e){this.stats.byType[e]=(this.stats.byType[e]||0)+1}updateDomainStats(e){this.stats.byDomain[e]=(this.stats.byDomain[e]||0)+1}generateNotificationId(){return`notif-${Date.now()}-${Math.random().toString(36).substr(2,9)}`}escapeHtml(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}clearAllDebounceTimeouts(){for(const e of this.debounceTimeouts.values())clearTimeout(e);this.debounceTimeouts.clear()}showSyncProgress(e){console.log(`📊 Showing sync progress for ${e}`)}async retrySyncForDomain(e){console.log(`🔄 Retrying sync for ${e}`);try{await this.syncManager.syncDomain(e)}catch(t){console.error("Retry failed:",t)}}showErrorDetails(e){console.log("📋 Showing error details:",e)}}function Nt(s,e,t){const n={...{inApp:{enabled:!0,position:"top-right",autoHide:!0,autoHideDelay:5e3,showProgress:!0,maxNotifications:5},push:{enabled:!0,requestPermission:!0,showSyncComplete:!0,showSyncFailed:!0,showNewContent:!0,batchNotifications:!0,quietHours:{start:"22:00",end:"07:00"}},filters:{domains:["music","photos","documents","videos"],minPriority:"low",eventTypes:[y.AutoSyncTriggered,y.Progress,y.AllCompleted,y.DomainCompleted,y.Failed],debounceDelay:1e3},feedback:{enableSounds:!1,enableVibration:!0,soundVolume:.5,customSounds:{}}},...e};return new Mt(s,n,t)}//! Phase 3: Auto-Sync & Notifications Integration
//!
//! This module integrates all Phase 3 components to provide a complete
//! auto-sync and notification system. It combines notification routing,
//! enhanced auto-sync management, user notifications, and service worker
//! background sync into a cohesive system.
class Et{syncManager;wsClient;serviceWorkerSyncManager;config;autoSyncManager=null;notificationRouter=null;userNotificationManager=null;isInitialized=!1;isEnabled=!1;startTime=null;stats={totalSyncsTriggered:0,totalNotificationsProcessed:0,errorCount:0,lastActivity:new Date};constructor(e,t,i,n){this.syncManager=e,this.wsClient=t,this.config=i,this.serviceWorkerSyncManager=n||null}async initialize(){if(this.isInitialized){console.log("🚀 Phase 3 auto-sync system already initialized");return}console.log("🚀 Initializing Phase 3 auto-sync system..."),this.startTime=new Date;try{this.config.integration.enableNotificationRouter&&await this.initializeNotificationRouter(),await this.initializeAutoSyncManager(),this.config.integration.enableUserNotifications&&await this.initializeUserNotificationManager(),await this.setupComponentIntegration(),this.setupSystemMonitoring(),this.isInitialized=!0,this.config.integration.autoStart&&await this.enable(),console.log("✅ Phase 3 auto-sync system initialized successfully")}catch(e){throw console.error("❌ Failed to initialize Phase 3 auto-sync system:",e),e}}async enable(){if(!this.isInitialized)throw new Error("System must be initialized before enabling");if(this.isEnabled){console.log("🔄 Phase 3 auto-sync system already enabled");return}console.log("🔛 Enabling Phase 3 auto-sync system...");try{this.autoSyncManager&&await this.autoSyncManager.enable(),this.notificationRouter&&await this.notificationRouter.start(),this.userNotificationManager&&await this.userNotificationManager.initialize(),this.isEnabled=!0,this.logSystemEvent("system_enabled"),console.log("✅ Phase 3 auto-sync system enabled")}catch(e){throw console.error("❌ Failed to enable Phase 3 auto-sync system:",e),e}}async disable(){if(!this.isEnabled){console.log("⏹️ Phase 3 auto-sync system already disabled");return}console.log("⏹️ Disabling Phase 3 auto-sync system...");try{this.autoSyncManager&&await this.autoSyncManager.disable(),this.notificationRouter&&await this.notificationRouter.stop(),this.userNotificationManager&&await this.userNotificationManager.shutdown(),this.isEnabled=!1,this.logSystemEvent("system_disabled"),console.log("✅ Phase 3 auto-sync system disabled")}catch(e){throw console.error("❌ Failed to disable Phase 3 auto-sync system:",e),e}}getStatus(){const e=this.getCurrentResourceStatus();return{enabled:this.isEnabled,components:{autoSyncManager:!!this.autoSyncManager,notificationRouter:!!this.notificationRouter,userNotifications:!!this.userNotificationManager,serviceWorker:!!this.serviceWorkerSyncManager},resources:e,activeSyncs:this.getActiveSyncs()}}getStats(){return{autoSync:this.autoSyncManager?.getStats()||null,notificationRouter:this.notificationRouter?.getStats()||null,userNotifications:this.userNotificationManager?.getStats()||null,system:{totalSyncsTriggered:this.stats.totalSyncsTriggered,averageResponseTime:0,lastActivity:this.stats.lastActivity,uptime:this.startTime?Date.now()-this.startTime.getTime():0,errorRate:this.stats.errorCount/Math.max(this.stats.totalSyncsTriggered,1)}}}async updateConfig(e){this.config={...this.config,...e},this.autoSyncManager&&e.autoSync&&this.autoSyncManager.updateConfig(e.autoSync),this.notificationRouter&&e.notificationRouting&&this.notificationRouter.updateConfig(e.notificationRouting),this.userNotificationManager&&e.userNotifications&&this.userNotificationManager.updateConfig(e.userNotifications),this.logSystemEvent("config_updated"),console.log("⚙️ Phase 3 auto-sync system configuration updated")}async triggerManualSync(e,t){if(!this.isEnabled)throw new Error("Auto-sync system is disabled");console.log(`🔄 Manual sync triggered for ${e}`),this.autoSyncManager?await this.autoSyncManager.forceSync(e,t?.reason||"manual"):await this.syncManager.syncDomain(e,{includeBinaryData:t?.includeBinaryData??!0}),this.stats.totalSyncsTriggered++,this.stats.lastActivity=new Date}getPendingNotifications(e){return this.notificationRouter?this.notificationRouter.getPendingNotifications(e):[]}addSyncRule(e){if(!this.autoSyncManager)throw new Error("Auto-sync manager not initialized");this.autoSyncManager.addRule(e),this.logSystemEvent("rule_added",{ruleId:e.id})}removeSyncRule(e){if(!this.autoSyncManager)throw new Error("Auto-sync manager not initialized");this.autoSyncManager.removeRule(e),this.logSystemEvent("rule_removed",{ruleId:e})}async sendUserNotification(e){if(!this.userNotificationManager){console.warn("User notification manager not available");return}await this.userNotificationManager.sendInAppNotification(e)}getActiveSyncRules(){return this.autoSyncManager?this.autoSyncManager.getActiveRules():[]}async performHealthCheck(){const e=[],t=[];this.autoSyncManager||e.push("Auto-sync manager not initialized"),this.config.integration.enableNotificationRouter&&!this.notificationRouter&&e.push("Notification router not initialized"),this.config.integration.enableUserNotifications&&!this.userNotificationManager&&e.push("User notification manager not initialized"),this.wsClient.getStatus()!=="connected"&&(e.push("WebSocket connection not active"),t.push("Check network connectivity")),this.config.integration.enableUserNotifications&&(this.userNotificationManager?.hasPushPermission()||t.push("Grant notification permissions for better user experience"));const i=this.getCurrentResourceStatus();return i.battery.level<.2&&!i.battery.charging&&t.push("Low battery detected - auto-sync may be limited"),{healthy:e.length===0,issues:e,recommendations:t}}async initializeNotificationRouter(){console.log("📡 Initializing notification router..."),this.notificationRouter=Dt(this.syncManager,this.wsClient,this.config.notificationRouting),console.log("✅ Notification router initialized")}async initializeAutoSyncManager(){console.log("🔄 Initializing enhanced auto-sync manager..."),this.autoSyncManager=At(this.syncManager,this.config.autoSync,this.serviceWorkerSyncManager||void 0,this.notificationRouter||void 0),console.log("✅ Enhanced auto-sync manager initialized")}async initializeUserNotificationManager(){console.log("📢 Initializing user notification manager..."),this.userNotificationManager=Nt(this.syncManager,this.config.userNotifications,this.serviceWorkerSyncManager||void 0),console.log("✅ User notification manager initialized")}async setupComponentIntegration(){console.log("🔗 Setting up component integration..."),this.notificationRouter&&this.autoSyncManager,this.autoSyncManager&&this.userNotificationManager,console.log("✅ Component integration complete")}setupSystemMonitoring(){this.config.advanced.enableAnalytics&&(console.log("📊 Setting up system monitoring..."),this.syncManager.on(y.AutoSyncTriggered,e=>{this.stats.totalSyncsTriggered++,this.stats.lastActivity=new Date,this.logSystemEvent("auto_sync_triggered",{event:e})}),this.syncManager.on(y.Failed,e=>{this.stats.errorCount++,this.logSystemEvent("sync_failed",{event:e})}),this.notificationRouter,console.log("✅ System monitoring setup complete"))}getCurrentResourceStatus(){return{battery:{level:1,charging:!1},connection:{type:"wifi",quality:"good"},memory:{usage:50,available:100}}}getActiveSyncs(){return[]}logSystemEvent(e,t){this.config.integration.debug&&console.log(`📊 [Phase3] ${e}:`,t)}}function Rt(s,e,t,i){const o={...{autoSync:{enabled:!0,syncOnNewContent:!0,periodicInterval:30,domains:["music","photos","documents","videos"],debounceDelay:5e3,customRules:[],resourceAwareness:{enabled:!0,batteryThreshold:.2,connectionTypes:["wifi","ethernet"],memoryThreshold:100},smartScheduling:{enabled:!0,quietHours:{start:"22:00",end:"07:00"},adaptiveInterval:!0,minInterval:15,maxInterval:120},backgroundSync:{enabled:!0,prioritizeBackground:!0,fallbackToForeground:!0},userPreferences:{respectDataSaver:!0,respectLowPowerMode:!0,maxDailySync:48}},notificationRouting:{enabled:!0,debounceDelay:5e3,maxQueueSize:50,monitoredChannels:["MediaBlobs","ThumbnailJobs","System"],syncRules:[],userNotifications:!0,priorityThresholds:{immediate:["critical","high"],batched:["medium","low"]}},userNotifications:{inApp:{enabled:!0,position:"top-right",autoHide:!0,autoHideDelay:5e3,showProgress:!0,maxNotifications:5},push:{enabled:!0,requestPermission:!0,showSyncComplete:!0,showSyncFailed:!0,showNewContent:!0,batchNotifications:!0,quietHours:{start:"22:00",end:"07:00"}},filters:{domains:["music","photos","documents","videos"],minPriority:"low",eventTypes:[y.AutoSyncTriggered,y.Progress,y.AllCompleted,y.DomainCompleted,y.Failed],debounceDelay:1e3},feedback:{enableSounds:!1,enableVibration:!0,soundVolume:.5,customSounds:{}}},integration:{enableNotificationRouter:!0,enableUserNotifications:!0,enableServiceWorker:!1,autoStart:!0,debug:!1},advanced:{intelligentScheduling:!0,crossDomainOptimization:!0,predictivePreSync:!1,enableAnalytics:!0}},...t};return new Et(s,e,o,i)}async function Bt(s,e,t){const i={integration:{enableNotificationRouter:!0,enableUserNotifications:t?.enableUserNotifications??!0,enableServiceWorker:t?.enableBackgroundSync??!0,autoStart:t?.autoStart,debug:t?.enableDebugMode??!1}},n=Rt(s,e,i);return await n.initialize(),n}//! Unified Sync System - Main Exports
//!
//! This is the new, clean sync system that replaces the legacy implementation.
//! It provides a single, unified interface for synchronizing multiple domains
//! (music, photos, documents, videos) with automatic WebSocket updates,
//! service worker support, and efficient binary data caching.
const ne={storage:{databaseName:"unified_sync_storage",version:1,maxSize:100*1024*1024,maxAge:30},autoSync:{enabled:!0,syncOnNewContent:!0,periodicInterval:30,domains:["music","photos"],debounceDelay:5e3},defaultSyncOptions:{domains:["music","photos"],forceFullSync:!1,includeBinaryData:!0,priorityOrder:["music","photos","documents","videos"]}};async function Pt(s,e,t){const i={apiBaseUrl:t.apiBaseUrl,websocketUrl:t.websocketUrl,clientId:t.clientId,authToken:t.authToken,domains:Ae(),storage:{...ne.storage,...t.storageConfig},autoSync:{...ne.autoSync,domains:t.enabledDomains||ne.autoSync.domains,...t.autoSyncConfig},defaultSyncOptions:{...ne.defaultSyncOptions,domains:t.enabledDomains||ne.defaultSyncOptions.domains}},n=Ct(i.storage);await n.initialize();const o=_t(n,s,e,i);return await o.initialize(),o}async function zt(s,e,t){return Pt(s,e,{...t,websocketUrl:t.apiBaseUrl.replace("http","ws")+"/ws"})}const Wt="1.0.0",Ut={AUTO_SYNC:!0,BINARY_CACHING:!0,SERVICE_WORKER:!0,MULTI_DOMAIN:!0,REAL_TIME_UPDATES:!0,SERVICE_WORKER_SYNC:!0,NOTIFICATION_ROUTING:!0,ENHANCED_AUTO_SYNC:!0,USER_NOTIFICATIONS:!0,RESOURCE_AWARENESS:!0,SMART_SCHEDULING:!0},Ot={PHASE_0:"✅ Legacy system preserved",PHASE_1:"✅ Core unified sync infrastructure",PHASE_2:"✅ Service worker background sync",PHASE_3:"✅ Auto-sync & notifications",PHASE_4:"✅ Unified UI demo complete",PHASE_5:"🔄 Multi-domain foundation (next)"};console.log("🚀 Unified Sync System loaded:",Wt);console.log("📋 Phase 4 Complete: Unified UI demo with auto-sync & notifications");async function Ft(s,e,t){const i=await zt(s,e,{apiBaseUrl:t.apiBaseUrl,clientId:t.clientId,authToken:t.authToken}),n=await Bt(i,s,{enableUserNotifications:t.enableUserNotifications??!0,enableBackgroundSync:t.enableBackgroundSync??!0,autoStart:!0});return{syncManager:i,phase3System:n}}var Lt=D("<button class=connect-button>"),qt=D("<button class=disconnect-button>Disconnect"),Ht=D("<div class=connection-buttons>"),jt=D("<label class=toggle-control><input type=checkbox checked disabled><span>🔔 User Notifications"),Qt=D("<span>🔄 Syncing..."),Vt=D("<div class=last-sync>Last sync: "),Gt=D("<div class=stat-item><span class=stat-label>Batches:</span><span class=stat-value>"),Jt=D("<div class=stat-item><span class=stat-label>Speed:</span><span class=stat-value>"),Yt=D("<div class=progress-section><h3>📊 Sync Progress</h3><div class=progress-display><div class=progress-stats><div class=stat-item><span class=stat-label>Items:</span><span class=stat-value>"),Kt=D("<div class=domain-status><h3>🎵 Domain Status</h3><div class=domain-grid>"),Xt=D("<div class=image-grid-section><h3>🖼️ Binary Data Image Grid (<!> images)</h3><div class=image-grid>"),Zt=D("<div class=log-empty>No activity yet..."),ei=D(`<div><div class=demo-header><h2>🚀 Unified Sync System Demo</h2><div class=phase-info><span class=phase-badge>Phase 4: Unified UI Demo</span><span class=version-badge>v1.0.0</span></div></div><div class=connection-section><h3>🔗 Connection Status</h3><div class=connection-controls><div class=initialization-status><span></span></div></div></div><div class=feature-toggles><h3>⚙️ Feature Controls</h3><div class=toggle-controls><label class=toggle-control><input type=checkbox><span>🔧 Service Worker Background Sync</span></label><label class=toggle-control><input type=checkbox><span>🔄 Auto-Sync on Changes</span></label></div></div><div class=sync-controls><h3>🎯 Unified Sync Control</h3><div class=main-controls><button></button><button class=destroy-button title="Completely destroy all IndexedDB data (for testing)">💥 Destroy All Data</button></div></div><div class=activity-log><h3>📋 Activity Log</h3><div class=log-container></div></div><div class=system-info><h3>ℹ️ System Information</h3><div class=info-grid><div class=info-item><span class=info-label>Sync Features:</span><span class=info-value></span></div><div class=info-item><span class=info-label>Client ID:</span><span class=info-value>...</span></div><div class=info-item><span class=info-label>API URL:</span><span class=info-value></span></div></div></div><style jsx>
        .unified-sync-demo {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .demo-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e0e0e0;
        }

        .demo-header h2 {
          margin: 0;
          color: #2c3e50;
        }

        .phase-info {
          display: flex;
          gap: 10px;
        }

        .phase-badge,
        .version-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .phase-badge {
          background: #3498db;
          color: white;
        }

        .version-badge {
          background: #2ecc71;
          color: white;
        }

        .connection-section,
        .feature-toggles,
        .sync-controls,
        .progress-section,
        .domain-status,
        .image-grid-section,
        .activity-log,
        .system-info {
          margin-bottom: 25px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 8px;
          background: #f9f9f9;
        }

        .connection-section h3,
        .feature-toggles h3,
        .sync-controls h3,
        .progress-section h3,
        .domain-status h3,
        .image-grid-section h3,
        .activity-log h3,
        .system-info h3 {
          margin: 0 0 15px 0;
          color: #34495e;
          font-size: 16px;
        }

        .connection-controls {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .connection-buttons {
          display: flex;
          gap: 10px;
        }

        .connect-button,
        .disconnect-button {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .connect-button {
          background: #3498db;
          color: white;
        }

        .connect-button:hover:not(:disabled) {
          background: #2980b9;
        }

        .connect-button:disabled {
          background: #95a5a6;
          cursor: not-allowed;
        }

        .disconnect-button {
          background: #e74c3c;
          color: white;
        }

        .disconnect-button:hover {
          background: #c0392b;
        }

        .status-indicator {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
        }

        .status-indicator.success {
          background: #d4edda;
          color: #155724;
        }

        .status-indicator.pending {
          background: #fff3cd;
          color: #856404;
        }

        .toggle-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
          color: black;
        }

        .toggle-control {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }

        .toggle-control input[type="checkbox"] {
          margin: 0;
        }

        .main-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        }

        .sync-all-button {
          padding: 15px 30px;
          font-size: 18px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #3498db, #2980b9);
          color: white;
          cursor: pointer;
          transition: all 0.3s ease;
          min-width: 200px;
        }

        .sync-all-button:hover:not(:disabled) {
          background: linear-gradient(135deg, #2980b9, #3498db);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
        }

        .sync-all-button:disabled {
          background: #95a5a6;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .sync-all-button.syncing {
          background: linear-gradient(135deg, #e67e22, #d35400);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.8;
          }
        }

        .last-sync {
          color: #7f8c8d;
          font-size: 14px;
        }

        .progress-display {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .progress-stats {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px 12px;
          background: white;
          border-radius: 4px;
          border: 1px solid #ddd;
        }

        .stat-label {
          font-size: 12px;
          color: #7f8c8d;
          font-weight: 600;
        }

        .stat-value {
          font-size: 14px;
          color: #2c3e50;
          font-weight: 500;
        }

        .domain-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 15px;
        }

        .domain-card {
          padding: 15px;
          border-radius: 8px;
          background: white;
          border: 2px solid #ecf0f1;
          text-align: center;
        }

        .domain-card.completed {
          border-color: #2ecc71;
          background: #d5f6e3;
        }

        .domain-card.inprogress {
          border-color: #f39c12;
          background: #fef9e7;
        }

        .domain-card.failed {
          border-color: #e74c3c;
          background: #fadbd8;
        }

        .domain-name {
          font-weight: 600;
          margin-bottom: 8px;
          color: #2c3e50;
        }

        .domain-progress {
          font-size: 12px;
          color: #7f8c8d;
          margin-top: 5px;
        }

        .log-container {
          max-height: 200px;
          overflow-y: auto;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 10px;
        }

        .log-entry {
          padding: 4px 0;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 12px;
          color: #2c3e50;
          border-bottom: 1px solid #f0f0f0;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-empty {
          color: #95a5a6;
          font-style: italic;
          text-align: center;
          padding: 20px;
        }

        .info-grid {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #e0e0e0;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          font-weight: 600;
          color: #34495e;
        }

        .info-value {
          color: #7f8c8d;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 12px;
        }

        .image-grid-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e9ecef;
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
          background: white;
          border-radius: 4px;
          overflow: hidden;
        }

        .image-item img {
          transition: transform 0.2s ease;
        }

        .image-item img:hover {
          transform: scale(1.05);
        }

        @media (max-width: 600px) {
          .unified-sync-demo {
            padding: 15px;
          }

          .demo-header {
            flex-direction: column;
            gap: 10px;
            text-align: center;
          }

          .connection-controls {
            flex-direction: column;
            align-items: stretch;
          }

          .progress-stats {
            justify-content: center;
          }

          .domain-grid {
            grid-template-columns: 1fr;
          }
        }
      `),ti=D("<span>🚀 Sync All Domains"),ii=D("<div class=domain-progress>/"),ni=D("<div><div class=domain-name> "),si=D("<div class=image-item><img>"),oi=D("<div class=log-entry>");function ai(s){const[e,t]=C(null),[i,n]=C(null),[o,r]=C(null),[a,c]=C(null),[u,f]=C(!1),[S,h]=C(J.Disconnected),[m,$]=C(!1),[j,F]=C(null),[Z,se]=C({}),[H,re]=C({}),[ri,ce]=C(w.Never),[Q,Me]=C({totalItems:0,completedItems:0,currentBatch:0,totalBatches:0,estimatedTimeRemaining:0,bytesTransferred:0,totalBytes:0,binaryStats:null}),[le,Ne]=C(s.enableServiceWorker??!0),[de,Ee]=C(s.enableAutoSync??!0),[fe,Re]=C([]),[M,ue]=C(!1),[pe,be]=C(null),[ge,Se]=C([]),[Be,Pe]=C(0),p=l=>{const d=new Date().toLocaleTimeString();Re(_=>[..._.slice(-9),`[${d}] ${l}`])},ze=()=>typeof crypto<"u"&&crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(l){const d=Math.random()*16|0;return(l=="x"?d:d&3|8).toString(16)}),we=()=>{const l=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;return s.clientId&&l.test(s.clientId)?s.clientId:ze()},ve=async()=>{try{p("🚀 Initializing Unified Sync System...");const l=s.apiBaseUrl||"http://localhost:8080",d=we();p(`📋 Client ID: ${d}`),p(`🌐 API Base URL: ${l}`);const _=new ct(l);c(_);const O=l.replace("http","ws").replace("3001","8080")+"/ws",B=new lt({url:O,autoReconnect:!0,reconnectDelay:3e3,debug:!0});r(B);const V=I=>{h(I),f(I===J.Connected),p(`🔗 WebSocket status: ${I}`),console.log("🐛 WebSocket status change:",{status:I,isConnected:I===J.Connected,isInitialized:m()}),I===J.Connected?(F(null),console.log("🔌 WebSocket connected - forcing UI update")):I===J.Error&&F("WebSocket connection error")};B.on("statusChange",V),B.on("error",I=>{F(I.message),p(`❌ WebSocket error: ${I.message}`)}),s.autoConnect!==!1&&(p("🔄 Auto-connecting WebSocket..."),B.connect()),p("⚙️ Setting up unified sync manager...");const{syncManager:K,phase3System:oe}=await Ft(B,_,{apiBaseUrl:l,clientId:d,enableUserNotifications:s.enableUserNotifications??!0,enableBackgroundSync:le()});t(K),n(oe),We(K),de()&&(p("🔄 Enabling auto-sync..."),K.enableAutoSync()),$(!0),p("✅ Unified Sync System initialized successfully"),console.log("🐛 State after initialization:",{isInitialized:!0,isConnected:u(),isSyncing:M()}),Ie(()=>{const I=u(),G=m(),ee=M();console.log("🔄 Button state check:",{connected:I,initialized:G,syncing:ee,buttonEnabled:G&&I&&!ee})}),Object.entries(Ot).forEach(([I,G])=>{p(`${I}: ${G}`)})}catch(l){p(`❌ Initialization failed: ${l.message}`),F(l.message)}},We=l=>{l.on(y.SyncStarted,d=>{p(`🔄 Sync started: ${d.domains?.join(", ")||"all domains"}`),ue(!0),ce(w.InProgress)}),l.on(y.SyncProgress,d=>{se(l.getStatus()),re(l.getProgress()),Me(d.overallProgress),d.domain&&p(`📊 ${d.domain}: ${d.progress.completedItems}/${d.progress.totalItems} items`)}),l.on(y.SyncCompleted,d=>{p(`✅ Sync completed: ${d.domains?.join(", ")||"all domains"}`),ue(!1),be(new Date),ce(w.Completed),d.stats&&p(`📈 Stats: ${d.stats.totalItems} items, ${Math.round(d.stats.totalTime/1e3)}s`),Pe(_=>_+1)}),l.on(y.SyncFailed,d=>{p(`❌ Sync failed: ${d.error.message}`),ue(!1),ce(w.Failed)}),l.on(y.AutoSyncTriggered,d=>{p(`🔔 Auto-sync triggered: ${d.reason} (${d.domains?.join(", ")||"all domains"})`)}),l.on(y.ConnectionChanged,d=>{p(`🔗 Connection ${d.connected?"established":"lost"}`)}),l.on(y.BinarySyncProgress,d=>{if(d.stats){const{completed:_,total:O,speed:B}=d.stats;p(`📁 Binary sync: ${_}/${O} files (${Math.round(B/1024)}KB/s)`)}})},Ue=async()=>{const l=e();if(!(!l||M()))try{p("🚀 Starting unified sync for all domains...");const d=await l.syncAll({domains:["music","photos"],includeBinaryData:!0,forceFullSync:!1});p(`✨ Sync completed! Synced domains: ${d.syncedDomains?.join(", ")||"none"}`)}catch(d){p(`❌ Sync failed: ${d.message}`)}},Oe=async()=>{const l=!le();if(Ne(l),p(`🔧 Service Worker ${l?"enabled":"disabled"}`),e()&&i()){const _=i();_.setBackgroundSyncEnabled&&await _.setBackgroundSyncEnabled(l)}},Fe=async()=>{const l=!de();Ee(l);const d=e();d&&(l?(p("🔄 Enabling auto-sync..."),d.enableAutoSync()):p("⏸️ Auto-sync disabled"))},Le=async()=>{const l=e();if(!(!l||M()))try{p("💥 Starting complete database teardown..."),await l.destroyAll(),p("🗑️ Database completely destroyed!"),p("🔄 Reinitializing system..."),$(!1),be(null),await ve(),p("✅ System reinitialized successfully!")}catch(d){p(`❌ Teardown failed: ${d.message}`)}};Ie(async()=>{const l=e(),d=m();if(Be(),!(!l||!d))try{const _=(await l.getMediaBlobs()).slice(0,100);if(_.length===0){Se([]);return}console.log(`📷 Found ${_.length} image blobs, creating URLs...`);const O=[];for(const B of _){const V=await l.getBlobUrl(B.id);V&&O.push(V)}O.length>0&&(Se(O),p(`🎨 Image grid loaded: ${O.length} images`))}catch(_){console.error("Failed to load image grid:",_)}});const qe=()=>{const l=o();l&&!u()&&(p("🔄 Connecting WebSocket..."),l.connect())},He=()=>{const l=o();l&&u()&&(p("🔌 Disconnecting WebSocket..."),l.disconnect())};ot(()=>{ve()}),at(()=>{const l=o(),d=e();l&&l.disconnect(),d&&d.destroy()});const Y=()=>{const l=Q();return{percentage:l.totalItems>0?Math.round(l.completedItems/l.totalItems*100):0,itemsText:`${l.completedItems}/${l.totalItems} items`,batchText:l.totalBatches>0?`Batch ${l.currentBatch}/${l.totalBatches}`:"",etaText:l.estimatedTimeRemaining>0?`ETA: ${Math.round(l.estimatedTimeRemaining/1e3)}s`:"",speedText:l.binaryStats?.speed?`${Math.round(l.binaryStats.speed/1024)}KB/s`:""}};return(()=>{var l=ei(),d=l.firstChild,_=d.nextSibling,O=_.firstChild,B=O.nextSibling,V=B.firstChild,K=V.firstChild,oe=_.nextSibling,I=oe.firstChild,G=I.nextSibling,ee=G.firstChild,he=ee.firstChild,je=ee.nextSibling,ye=je.firstChild,$e=oe.nextSibling,Qe=$e.firstChild,_e=Qe.nextSibling,te=_e.firstChild,P=te.nextSibling,ie=$e.nextSibling,Ve=ie.firstChild,ke=Ve.nextSibling,Ge=ie.nextSibling,Je=Ge.firstChild,Ye=Je.nextSibling,Ce=Ye.firstChild,Ke=Ce.firstChild,Xe=Ke.nextSibling,xe=Ce.nextSibling,Ze=xe.firstChild,De=Ze.nextSibling,et=De.firstChild,tt=xe.nextSibling,it=tt.firstChild,nt=it.nextSibling;return b(B,x(R,{get when(){return o()},get children(){return[x(gt,{get status(){return S()},showText:!0,compact:!0}),(()=>{var g=Ht();return b(g,x(R,{get when(){return!u()},get children(){var v=Lt();return v.$$click=qe,b(v,()=>S()===J.Connecting?"Connecting...":"Connect"),X(()=>v.disabled=S()===J.Connecting),v}}),null),b(g,x(R,{get when(){return u()},get children(){var v=qt();return v.$$click=He,v}}),null),g})()]}}),V),b(K,()=>m()?"✅ Initialized":"⏳ Initializing..."),he.addEventListener("change",Oe),ye.addEventListener("change",Fe),b(G,x(R,{get when(){return s.enableUserNotifications!==!1},get children(){return jt()}}),null),te.$$click=()=>{console.log("🐛 Button click - Debug state:",{isInitialized:m(),isConnected:u(),isSyncing:M(),buttonDisabled:!m()||!u()||M()}),Ue()},b(te,x(R,{get when(){return M()},get fallback(){return ti()},get children(){return Qt()}})),P.$$click=Le,P.style.setProperty("background-color","#dc3545"),P.style.setProperty("color","white"),P.style.setProperty("border","none"),P.style.setProperty("padding","10px 20px"),P.style.setProperty("border-radius","5px"),P.style.setProperty("margin-left","10px"),b(_e,x(R,{get when(){return pe()},get children(){var g=Vt();return g.firstChild,b(g,()=>pe()?.toLocaleTimeString(),null),g}}),null),b(l,x(R,{get when(){return M()||Q().totalItems>0},get children(){var g=Yt(),v=g.firstChild,L=v.nextSibling,T=L.firstChild,q=T.firstChild,N=q.firstChild,W=N.nextSibling;return b(L,x(dt,{get progress(){return Y().percentage},get itemsSynced(){return Q().completedItems},get totalItems(){return Q().totalItems},get currentBatch(){return Q().currentBatch},get totalBatches(){return Q().totalBatches},get eta(){return Q().estimatedTimeRemaining},showDetails:!0,className:"unified-progress"}),T),b(W,()=>Y().itemsText),b(T,x(R,{get when(){return Y().batchText},get children(){var E=Gt(),k=E.firstChild,U=k.nextSibling;return b(U,()=>Y().batchText),E}}),null),b(T,x(R,{get when(){return Y().speedText},get children(){var E=Jt(),k=E.firstChild,U=k.nextSibling;return b(U,()=>Y().speedText),E}}),null),g}}),ie),b(l,x(R,{get when(){return Object.keys(Z()).length>0},get children(){var g=Kt(),v=g.firstChild,L=v.nextSibling;return b(L,x(me,{get each(){return Object.entries(Z())},children:([T,q])=>(()=>{var N=ni(),W=N.firstChild,E=W.firstChild;return b(W,T==="music"?"🎵":T==="photos"?"📸":"📁",E),b(W,T,null),b(N,x(ut,{status:q,compact:!0}),null),b(N,x(R,{get when(){return H()[T]},get children(){var k=ii(),U=k.firstChild;return b(k,()=>H()[T].completedItems,U),b(k,()=>H()[T].totalItems,null),k}}),null),X(()=>ae(N,`domain-card ${q.toLowerCase()}`)),N})()})),g}}),ie),b(l,x(R,{get when(){return ge().length>0},get children(){var g=Xt(),v=g.firstChild,L=v.firstChild,T=L.nextSibling;T.nextSibling;var q=v.nextSibling;return b(v,()=>ge().length,T),b(q,x(me,{get each(){return ge()},children:(N,W)=>(()=>{var E=si(),k=E.firstChild;return k.addEventListener("error",U=>{console.log(`Failed to load image ${W()+1}:`,N),U.target.style.display="none"}),Te(k,"src",N),k.style.setProperty("width","100px"),k.style.setProperty("height","100px"),k.style.setProperty("object-fit","cover"),k.style.setProperty("border","1px solid #ddd"),k.style.setProperty("border-radius","4px"),X(()=>Te(k,"alt",`Image ${W()+1}`)),E})()})),g}}),ie),b(ke,x(me,{get each(){return fe().slice().reverse()},children:g=>(()=>{var v=oi();return b(v,g),v})()}),null),b(ke,x(R,{get when(){return fe().length===0},get children(){return Zt()}}),null),b(Xe,()=>Object.entries(Ut).filter(([g,v])=>v).map(([g,v])=>g).join(", ")),b(De,()=>we().slice(0,8),et),b(nt,()=>s.apiBaseUrl||"http://localhost:8080"),X(g=>{var v=`unified-sync-demo ${s.className||""}`,L=`status-indicator ${m()?"success":"pending"}`,T=!m(),q=!m(),N=`sync-all-button ${M()?"syncing":""}`,W=!m()||!u()||M(),E=!m()||M(),k=!m()||M()?"not-allowed":"pointer",U=!m()||M()?"0.5":"1";return v!==g.e&&ae(l,g.e=v),L!==g.t&&ae(K,g.t=L),T!==g.a&&(he.disabled=g.a=T),q!==g.o&&(ye.disabled=g.o=q),N!==g.i&&ae(te,g.i=N),W!==g.n&&(te.disabled=g.n=W),E!==g.s&&(P.disabled=g.s=E),k!==g.h&&((g.h=k)!=null?P.style.setProperty("cursor",k):P.style.removeProperty("cursor")),U!==g.r&&((g.r=U)!=null?P.style.setProperty("opacity",U):P.style.removeProperty("opacity")),g},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0}),X(()=>he.checked=le()),X(()=>ye.checked=de()),l})()}rt("unified-sync-demo",{apiBaseUrl:void 0,clientId:void 0,autoConnect:!0,enableServiceWorker:!0,enableAutoSync:!0,className:"",enableUserNotifications:!0},ai);st(["click"]);
//# sourceMappingURL=unified-sync-demo.js.map
