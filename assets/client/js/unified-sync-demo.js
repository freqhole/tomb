import{d as gt,c as h,g as ke,o as mt,f as ut,t as $,k as l,i as S,b as M,e as F,S as z,l as ne,F as pe}from"./web-WRO-G0Y6.js";import{c as pt}from"./index-CAM_Dine.js";import{A as ht}from"./api-client-oDSgDTkX.js";import{C as j,W as bt}from"./websocket-client-1nrUQNsM.js";import{S as r,e as Ie,c as Pe,s as ft,d as yt,a as R}from"./index-BR4qIUMb.js";import{W as vt}from"./websocket-status-2TaUZkUV.js";import{a as xt,b as St}from"./date-utils-CshQIybG.js";import"./types-DDODKsJP.js";var $t=$("<span> (Status: <!>)"),wt=$("<div class=error-message>❌ "),Ct=$("<div class=last-sync>Last sync: "),_t=$("<span class=progress-percentage>%"),Bt=$("<div class=progress-operation>"),kt=$("<span class=progress-initializing>"),It=$("<span class=progress-items>/<!> items"),Pt=$("<div class=horizontal-progress-container><div class=horizontal-progress-bar><div class=horizontal-progress-fill></div></div><div class=horizontal-progress-text>"),zt=$("<div class=progress-section><h3>📊 Sync Progress"),Dt=$("<div class=image-grid-section><h3>🖼️ Binary Data Image Grid (<!> images)</h3><div class=image-grid>"),Et=$("<div class=log-empty>No activity yet..."),Tt=$(`<div><div class=demo-header><h2>🚀 Unified Sync System Demo</h2><div class=status-badges><span></span><span> (<!>)</span></div></div><div class=connection-section><h3>🔗 Connection</h3><div class=connection-status></div></div><div class=autosync-section><h3>⚙️ Auto-Sync</h3><label class=toggle-control><input type=checkbox><span>Enable real-time auto-sync</span></label><label class=toggle-control><input type=checkbox><span>Enable debug logging</span></label></div><div class=sync-section><h3>🎯 Sync Control</h3><div class=sync-controls><button></button></div></div><div class=domains-section><h3>📁 Domain Status</h3><div class=domain-grid></div></div><div class=storage-stats><h3>💾 Storage Usage</h3><div class=storage-display><div class=storage-item><span class=storage-label>Total:</span><span class=storage-value></span></div><div class=storage-breakdown><div class=storage-item><span class=storage-label>Music:</span><span class=storage-value></span></div><div class=storage-item><span class=storage-label>Binary Data:</span><span class=storage-value></span></div></div></div></div><div class=log-section><h3>📋 Activity Log</h3><div class=log-container></div></div><style>
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
      `),Mt=$("<div><div class=domain-name></div><div class=domain-status></div><div class=domain-progress>"),Nt=$("<div class=image-item><img class=grid-image>"),Ut=$("<div class=log-entry>");const At=(B,D,N)=>{if(B==="music"&&N){const x=[];return N.songs>0&&x.push(`${N.songs} songs`),N.playlists>0&&x.push(`${N.playlists} playlists`),x.length>0?x.join(", "):"0 items"}else if(B==="music"){const x=D.itemsProcessed||0;return x>0?`${x} songs`:"0 items"}else{const x=D.itemsProcessed||0,G=D.totalItems||0;return`${x}/${G} items`}},Ot=(B={})=>{const[D,N]=h(!1),[x,G]=h(!1),[E,oe]=h(!1),[X,ie]=h(j.Disconnected),[he,Y]=h(null),[b,K]=h({status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"}),[ae,be]=h([]),[ze,De]=h(0),[Ee,fe]=h("Loading..."),[Te,ye]=h("Loading..."),[Me,ve]=h("Loading..."),[Ne,U]=h({music:r.Never,photos:r.Never,videos:r.Never,documents:r.Never}),[Ue,Q]=h({music:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},photos:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},videos:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},documents:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0}}),[re,xe]=h(B?.enableAutoSync??!0),[Z,Ae]=h(B?.debug??!1),[ce,ee]=h(null),[Se,Oe]=h([]),[Le,le]=h(null),[te,We]=h(null),[A,Fe]=h(null),[je,Re]=h(null),c=(e,t)=>{B?.debug&&console.log(`[UnifiedSyncDemo] ${e}`,t||"")},m=e=>{const t=new Date().toLocaleTimeString();Oe(s=>[...s.slice(-19),`[${t}] ${e}`])},Ge=()=>{const e=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;return B?.clientId&&e.test(B.clientId)?B.clientId:crypto.randomUUID()},Xe=async()=>{try{c("initializing system"),m("🚀 Initializing Unified Sync System...");const e=B?.apiBaseUrl||"http://localhost:8080",t=Ge();c("created client",{baseUrl:e,clientId:t.slice(0,8)}),m(`📋 Client ID: ${t.slice(0,8)}...`);const s=new ht({baseUrl:e}),i=new bt({url:e.replace("http","ws")+"/ws",autoReconnect:!0,debug:Z()||B?.debug||!1});We(i);const a=o=>{c("handleStatusChange called",{status:o,previous:X()}),ie(o);const f=o===j.Connected;G(f),c("websocket status change",{status:o,connected:f}),m(`🔗 WebSocket: ${o}`),f?(Y(null),m("✅ WebSocket connected successfully")):o===j.Error&&Y("WebSocket connection error")};i.on("statusChange",a),i.on("error",o=>{c("websocket error",o),m(`❌ WebSocket error: ${o.message}`),Y(o.message)}),i.on("notification",o=>{c("received notification",{channel:o.channel,event_type:o.event_type}),m(`📬 Notification: ${o.channel}/${o.event_type}`),o.channel==="MediaBlobs"&&(o.event_type==="song.created"||o.event_type==="song.updated"||o.event_type==="song.deleted"||o.event_type==="music.library.updated")&&(m(`🎵 Music event: ${o.event_type}`),ee(new Date))}),c("setting up unified sync system");const{syncManager:d,autoSyncSystem:y}=await ft(i,s,{apiBaseUrl:e,clientId:t,enableUserNotifications:!1,enableBackgroundSync:!1});if(!d)throw new Error("Failed to create sync manager");if(!y)throw new Error("Failed to create auto-sync system");Fe(d),Re(y),Ke(d),c("auto-connecting websocket"),i.connect();const O=1e4,L=Date.now();for(;i.getStatus()!==j.Connected;){if(Date.now()-L>O)throw new Error("WebSocket connection timeout");await new Promise(o=>setTimeout(o,100))}const T=i.getStatus();c("final websocket status after connect",T),ie(T),G(T===j.Connected),m(`🔗 WebSocket connection established: ${T}`);try{const o=await d.getStorageStats();c("storage stats from IDB",o);const f=d.getStatus(),g=d.getProgress(),p={music:f.music||r.Never,photos:f.photos||r.Never,documents:f.documents||r.Never,videos:f.videos||r.Never},q={music:{status:p.music,progress:p.music===r.Complete?100:g.music?.progress||0,itemsProcessed:p.music===r.Complete?o.itemCounts.music:g.music?.itemsProcessed||0,totalItems:p.music===r.Complete?o.itemCounts.music:g.music?.totalItems||0,currentBatch:g.music?.currentBatch||1,totalBatches:g.music?.totalBatches||1,eta:0},photos:{status:p.photos,progress:p.photos===r.Complete?100:g.photos?.progress||0,itemsProcessed:p.photos===r.Complete?o.itemCounts.photos:g.photos?.itemsProcessed||0,totalItems:p.photos===r.Complete?o.itemCounts.photos:g.photos?.totalItems||0,currentBatch:g.photos?.currentBatch||1,totalBatches:g.photos?.totalBatches||1,eta:0},documents:{status:p.documents,progress:p.documents===r.Complete?100:g.documents?.progress||0,itemsProcessed:p.documents===r.Complete?o.itemCounts.documents:g.documents?.itemsProcessed||0,totalItems:p.documents===r.Complete?o.itemCounts.documents:g.documents?.totalItems||0,currentBatch:g.documents?.currentBatch||1,totalBatches:g.documents?.totalBatches||1,eta:0},videos:{status:p.videos,progress:p.videos===r.Complete?100:g.videos?.progress||0,itemsProcessed:p.videos===r.Complete?o.itemCounts.videos:g.videos?.itemsProcessed||0,totalItems:p.videos===r.Complete?o.itemCounts.videos:g.videos?.totalItems||0,currentBatch:g.videos?.currentBatch||1,totalBatches:g.videos?.totalBatches||1,eta:0}};U(p),Q(q);const se=Object.values(o.lastSyncTimes).filter(Boolean);if(se.length>0){const P=se.reduce((W,H)=>H&&(!W||H>W)?H:W,null);P&&(ee(P),c("initialized last sync time",P))}p.music===r.Complete&&d.getMusicBreakdown().then(P=>{le(P),c("loaded music breakdown",P)}),c("initialized from IDB",{status:p,itemCounts:o.itemCounts}),m(`📊 Loaded from IDB: ${Object.values(p).filter(P=>P===r.Complete).length} domains with data`),setTimeout(()=>{de()},2e3),setTimeout(()=>{V()},1e3)}catch(o){c("failed to get initial status",o),U({music:r.Never,photos:r.Never,videos:r.Never,documents:r.Never})}N(!0),c("system initialized successfully"),m("✅ System initialized successfully")}catch(e){c("initialization failed",e),m(`❌ Initialization failed: ${e.message}`),Y(e.message)}},Ke=e=>{e.on(R.Started,t=>{c("sync started",{domain:t.domain}),m(`🔄 Sync started: ${t.domain||"all domains"}`),oe(!0),K({status:r.InProgress,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Starting sync..."})}),e.on(R.Progress,t=>{const s=t,i=e.getStatus(),a=e.getProgress();U(i),Q(a);const d=Object.values(a),y=d.reduce((f,g)=>f+g.totalItems,0),O=d.reduce((f,g)=>f+g.itemsProcessed,0),L=d.reduce((f,g)=>f+g.totalBatches,0),T=d.reduce((f,g)=>f+g.currentBatch,0),o=y>0?Math.round(O/y*100):0;K({status:r.InProgress,progress:o,itemsProcessed:O,totalItems:y,currentBatch:T,totalBatches:L,eta:s.progress?.eta||0,currentOperation:s.progress?.currentOperation||`Syncing ${s.domain}`}),s.domain&&s.progress&&m(`📊 ${s.domain}: ${s.progress.itemsProcessed}/${s.progress.totalItems} items (${s.progress.progress}%)`)}),e.on(R.DomainCompleted,t=>{const s=t;c("domain sync completed",{domain:s.domain,itemsSynced:s.result.itemsSynced}),m(`✅ Domain sync completed: ${s.domain} - ${s.result.itemsSynced} items`),s.domain&&U(a=>({...a,[s.domain]:r.Complete})),ee(new Date);const i=A();i&&s.domain==="music"&&i.getMusicBreakdown().then(a=>{le(a),c("updated music breakdown after domain sync",a)}),setTimeout(()=>{const a=A();a&&(U(a.getStatus()),Q(a.getProgress()))},100),setTimeout(()=>{de()},1500),s.domain==="music"&&setTimeout(()=>{V()},2e3)}),e.on(R.AllCompleted,t=>{const s=t;c("sync completed",{domain:s.domain,itemsSynced:s.result.itemsSynced}),m(`✅ Sync completed: ${s.domain||"all domains"} - ${s.result.itemsSynced} items`),s.domain&&U(a=>({...a,[s.domain]:r.Complete})),oe(!1),ee(new Date);const i=A();i&&i.getMusicBreakdown().then(a=>{le(a),c("updated music breakdown after sync",a)}),K({status:r.Complete,progress:100,itemsProcessed:b().itemsProcessed,totalItems:b().totalItems,currentBatch:b().totalBatches,totalBatches:b().totalBatches,eta:0,currentOperation:"Complete"}),setTimeout(()=>{U(i.getStatus()),Q(i.getProgress())},100),De(a=>a+1),setTimeout(()=>{de()},1500),s.result&&s.result.binaryStats&&s.result.binaryStats.cached>0&&(m("🖼️ Binary sync completed, checking for images..."),setTimeout(()=>{V()},2e3)),setTimeout(()=>{E()||K({status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"})},5e3)}),e.on(R.Failed,t=>{const s=t;c("sync failed",s),m(`❌ Sync failed: ${s.error?.message||"Unknown error"}`),oe(!1)}),e.on(R.BinaryProgress,t=>{const s=t,{currentItem:i,totalItems:a,domain:d}=s;d&&a>0&&(Q(y=>({...y,[d]:{...y[d],itemsProcessed:i,totalItems:a,currentOperation:`Downloading binary data (${i}/${a})`}})),K({status:r.InProgress,progress:s.progress||0,itemsProcessed:i,totalItems:a,currentBatch:i,totalBatches:a,eta:0,currentOperation:`Downloading binary data (${i}/${a})`}))})},V=async()=>{const e=A();if(!(!e||!D()))try{const t=(await e.getMediaBlobs()).slice(0,100);if(t.length===0){be([]);return}m(`📷 Found ${t.length} image blobs, checking binary data...`);const s=[];let i=0;for(const a of t)try{if(await e.hasBinaryData(a.id)){i++;const y=await e.getBlobUrl(a.id);y&&s.push(y)}}catch{continue}s.length>0?(be(s),m(`🎨 Image grid loaded: ${s.length} images (${i} with binary data)`)):i===0&&t.length>0&&m(`📷 Found ${t.length} image metadata but no binary data yet`)}catch(t){m(`❌ Failed to load image grid: ${t.message}`)}},$e=e=>{if(e===0)return"0 B";const t=1024,s=["B","KB","MB","GB"],i=Math.floor(Math.log(e)/Math.log(t));return Math.round(e/Math.pow(t,i)*100)/100+" "+s[i]},de=async()=>{try{const e=A();if(!e){c("no sync manager available for storage stats");return}c("calculating storage usage");const t=await e.getStorageStats();c("storage stats received",t);const s={totalSize:t?.totalSize||0,itemCounts:t?.itemCounts||{music:0,photos:0,documents:0,videos:0},binarySize:t?.binarySize||0},i=$e(s.totalSize),a=s.itemCounts.music,d=a>0?`${a} items`:"No data",y=$e(s.binarySize);fe(i),ye(d),ve(y),c("updated storage stats",{total:i,music:d,binary:y})}catch(e){console.error("Could not calculate storage usage:",e),fe("Error"),ye("Error"),ve("Error")}};ke(()=>{const e=x(),t=D(),s=E(),i=X();c("button state reactive check",{connected:e,initialized:t,syncing:s,wsStatus:i,buttonEnabled:e&&!s});const a=te();if(a){const d=a.getStatus();d!==i&&(c("status mismatch detected, correcting",{actualStatus:d,wsStatus:i}),ie(d),G(d===j.Connected))}}),ke(()=>{const e=A(),t=D();if(ze(),e&&t){V();const s=setInterval(()=>{V()},3e3);setTimeout(()=>{clearInterval(s)},3e4)}});const Qe=async()=>{const e=A();if(!(!e||E()))try{c("starting sync all"),m("🔄 Starting sync for all domains...");const t=await e.syncAll({domains:["music","photos"],includeBinaryData:!0,forceFullSync:!1});m(`✨ Sync completed! Domain: ${t.domain}, Items: ${t.itemsSynced}/${t.totalItems}`)}catch(t){c("sync all failed",t),m(`❌ Sync failed: ${t.message}`)}},Ve=async()=>{const e=je();if(!e){m("❌ Auto-sync system not available");return}try{const t=!re();xe(t),t?(e.start?await e.start():e.enable&&await e.enable(),c("auto-sync enabled"),m("🔄 Auto-sync enabled")):(e.stop?await e.stop():e.disable&&await e.disable(),c("auto-sync disabled"),m("⏸️ Auto-sync disabled"))}catch(t){c("auto-sync toggle failed",t),m(`❌ Auto-sync toggle failed: ${t.message}`),xe(!re())}},qe=()=>{const e=!Z();Ae(e),e?(Ie(),Pe({enabled:!0,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!0}})):yt();const t=te();t&&t.setDebug(e),typeof window<"u"&&(window.debugEnabled=e),c(`Debug logging ${e?"enabled":"disabled"}`),m(`🔧 Debug logging ${e?"enabled":"disabled"}`)};return mt(()=>{c("component mounted"),Z()&&(Ie(),Pe({enabled:!0,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!0}}),typeof window<"u"&&(window.debugEnabled=!0)),Xe()}),ut(()=>{c("component unmounting");const e=te();e&&e.disconnect()}),(()=>{var e=Tt(),t=e.firstChild,s=t.firstChild,i=s.nextSibling,a=i.firstChild,d=a.nextSibling,y=d.firstChild,O=y.nextSibling;O.nextSibling;var L=t.nextSibling,T=L.firstChild,o=T.nextSibling,f=L.nextSibling,g=f.firstChild,p=g.nextSibling,q=p.firstChild,se=p.nextSibling,P=se.firstChild,W=f.nextSibling,H=W.firstChild,we=H.nextSibling,J=we.firstChild,ge=W.nextSibling,He=ge.firstChild,Je=He.nextSibling,me=ge.nextSibling,Ye=me.firstChild,Ze=Ye.nextSibling,Ce=Ze.firstChild,et=Ce.firstChild,tt=et.nextSibling,st=Ce.nextSibling,_e=st.firstChild,nt=_e.firstChild,ot=nt.nextSibling,it=_e.nextSibling,at=it.firstChild,rt=at.nextSibling,ct=me.nextSibling,lt=ct.firstChild,Be=lt.nextSibling;return l(a,()=>D()?"✅ Ready":"⏳ Initializing"),l(d,()=>x()?"🔗 Connected":"🔗 Disconnected",y),l(d,X,O),l(o,S(z,{get when(){return te()},get children(){return[S(vt,{get status(){return X()},showText:!0,compact:!0}),(()=>{var n=$t(),v=n.firstChild,w=v.nextSibling;return w.nextSibling,l(n,()=>x()?"Connected":"Disconnected",v),l(n,X,w),M(()=>F(n,`connection-text ${x()?"connected":"disconnected"}`)),n})()]}})),l(L,S(z,{get when(){return he()},get children(){var n=wt();return n.firstChild,l(n,he,null),n}}),null),q.addEventListener("change",Ve),P.addEventListener("change",qe),J.$$click=Qe,l(J,()=>E()?"🔄 Syncing...":"🚀 Sync All"),l(we,S(z,{get when(){return ce()},get children(){var n=Ct();return n.firstChild,l(n,()=>xt(ce()),null),M(()=>ne(n,"title",St(ce()))),n}}),null),l(e,S(z,{get when(){return E()||b().totalItems>0},get children(){var n=zt();return n.firstChild,l(n,S(z,{get when(){return E()},get children(){var v=Pt(),w=v.firstChild,_=w.firstChild,k=w.nextSibling;return l(k,S(z,{get when(){return b().totalItems>0},get children(){var u=_t(),C=u.firstChild;return l(u,()=>b().progress,C),u}}),null),l(k,S(z,{get when(){return b().currentOperation},get children(){var u=Bt();return l(u,()=>b().currentOperation),u}}),null),l(k,S(z,{get when(){return b().totalItems===0},get children(){var u=kt();return l(u,()=>b().currentOperation||(b().itemsProcessed>0?`Processing... (${b().itemsProcessed} items)`:"Initializing sync...")),u}}),null),l(k,S(z,{get when(){return b().totalItems>0},get children(){var u=It(),C=u.firstChild,I=C.nextSibling;return I.nextSibling,l(u,()=>b().itemsProcessed,C),l(u,()=>b().totalItems,I),u}}),null),M(u=>{var C=`${b().totalItems>0?b().progress:Math.min(85,Math.max(10,b().itemsProcessed*.5))}%`,I=b().totalItems>0?"linear-gradient(90deg, magenta, #cc00cc)":"linear-gradient(90deg, #ff6600, #cc4400)";return C!==u.e&&((u.e=C)!=null?_.style.setProperty("width",C):_.style.removeProperty("width")),I!==u.t&&((u.t=I)!=null?_.style.setProperty("background",I):_.style.removeProperty("background")),u},{e:void 0,t:void 0}),v}}),null),n}}),ge),l(Je,S(pe,{get each(){return Object.entries(Ne())},children:([n,v])=>(()=>{var w=Mt(),_=w.firstChild,k=_.nextSibling,u=k.nextSibling;return l(_,n),l(k,v),l(u,()=>At(n,Ue()[n],n==="music"?Le():void 0)),M(()=>F(w,`domain-card ${v.toLowerCase()}`)),w})()})),l(e,S(z,{get when(){return ae().length>0},get children(){var n=Dt(),v=n.firstChild,w=v.firstChild,_=w.nextSibling;_.nextSibling;var k=v.nextSibling;return l(v,()=>ae().length,_),l(k,S(pe,{get each(){return ae()},children:(u,C)=>(()=>{var I=Nt(),ue=I.firstChild;return ue.addEventListener("error",dt=>{c(`failed to load image ${C()+1}`,u),dt.target.style.display="none"}),ne(ue,"src",u),M(()=>ne(ue,"alt",`Image ${C()+1}`)),I})()})),n}}),me),l(tt,Ee),l(ot,Te),l(rt,Me),l(Be,S(pe,{get each(){return Se().slice().reverse()},children:n=>(()=>{var v=Ut();return l(v,n),v})()}),null),l(Be,S(z,{get when(){return Se().length===0},get children(){return Et()}}),null),M(n=>{var v=`unified-sync-demo ${B?.className||""}`,w=`status-badge ${D()?"success":"pending"}`,_=`status-badge ${x()?"success":"error"}`,k=!D(),u=`btn btn-sync ${E()?"syncing":""}`,C=!x()||E(),I=x()?E()?"Sync in progress...":"Sync all domains":"WebSocket must be connected to sync";return v!==n.e&&F(e,n.e=v),w!==n.t&&F(a,n.t=w),_!==n.a&&F(d,n.a=_),k!==n.o&&(q.disabled=n.o=k),u!==n.i&&F(J,n.i=u),C!==n.n&&(J.disabled=n.n=C),I!==n.s&&ne(J,"title",n.s=I),n},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0}),M(()=>q.checked=re()),M(()=>P.checked=Z()),e})()};pt("unified-sync-demo",{apiBaseUrl:"",clientId:"",enableAutoSync:!0,debug:!1,className:""},Ot);gt(["click"]);
//# sourceMappingURL=unified-sync-demo.js.map
