import{d as gt,c as h,g as ke,o as ut,f as mt,t as $,k as c,i as S,b as M,e as L,S as z,l as se,F as ue}from"./web-Bmt1sUg0.js";import{c as pt}from"./index-CuXI0cIU.js";import{A as ht}from"./api-client-oDSgDTkX.js";import{C as W,W as bt}from"./websocket-client-4pWd6Jsd.js";import{S as i,e as Ie,c as Pe,s as ft,d as yt,a as q}from"./index-BV3EjJaR.js";import{W as vt}from"./websocket-status-CQMX0WJF.js";import{a as xt,b as St}from"./date-utils-CshQIybG.js";import"./types-DDODKsJP.js";var $t=$("<span> (Status: <!>)"),wt=$("<div class=error-message>❌ "),Ct=$("<div class=last-sync>Last sync: "),_t=$("<span class=progress-percentage>%"),Bt=$("<div class=progress-operation>"),kt=$("<span class=progress-initializing>"),It=$("<span class=progress-items>/<!> items"),Pt=$("<div class=horizontal-progress-container><div class=horizontal-progress-bar><div class=horizontal-progress-fill></div></div><div class=horizontal-progress-text>"),zt=$("<div class=progress-section><h3>📊 Sync Progress"),Dt=$("<div class=image-grid-section><h3>🖼️ Binary Data Image Grid (<!> images)</h3><div class=image-grid>"),Et=$("<div class=log-empty>No activity yet..."),Tt=$(`<div><div class=demo-header><h2>🚀 Unified Sync System Demo</h2><div class=status-badges><span></span><span> (<!>)</span></div></div><div class=connection-section><h3>🔗 Connection</h3><div class=connection-status></div></div><div class=autosync-section><h3>⚙️ Auto-Sync</h3><label class=toggle-control><input type=checkbox><span>Enable real-time auto-sync</span></label><label class=toggle-control><input type=checkbox><span>Enable debug logging</span></label></div><div class=sync-section><h3>🎯 Sync Control</h3><div class=sync-controls><button></button></div></div><div class=domains-section><h3>📁 Domain Status</h3><div class=domain-grid></div></div><div class=storage-stats><h3>💾 Storage Usage</h3><div class=storage-display><div class=storage-item><span class=storage-label>Total:</span><span class=storage-value></span></div><div class=storage-breakdown><div class=storage-item><span class=storage-label>Music:</span><span class=storage-value></span></div><div class=storage-item><span class=storage-label>Binary Data:</span><span class=storage-value></span></div></div></div></div><div class=log-section><h3>📋 Activity Log</h3><div class=log-container></div></div><style>
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
      `),Mt=$("<div><div class=domain-name></div><div class=domain-status></div><div class=domain-progress>"),Nt=$("<div class=image-item><img class=grid-image>"),Ut=$("<div class=log-entry>");const At=(B,D,N)=>{if(B==="music"&&N){const x=[];return N.songs>0&&x.push(`${N.songs} songs`),N.playlists>0&&x.push(`${N.playlists} playlists`),x.length>0?x.join(", "):"0 items"}else if(B==="music"){const x=D.itemsProcessed||0;return x>0?`${x} songs`:"0 items"}else{const x=D.itemsProcessed||0,F=D.totalItems||0;return`${x}/${F} items`}},Ot=(B={})=>{const[D,N]=h(!1),[x,F]=h(!1),[E,ne]=h(!1),[j,oe]=h(W.Disconnected),[me,H]=h(null),[b,R]=h({status:i.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"}),[ae,pe]=h([]),[ze,De]=h(0),[Ee,he]=h("Loading..."),[Te,be]=h("Loading..."),[Me,fe]=h("Loading..."),[Ne,G]=h({music:i.Never,photos:i.Never,videos:i.Never,documents:i.Never}),[Ue,J]=h({music:{status:i.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},photos:{status:i.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},videos:{status:i.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0},documents:{status:i.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0}}),[ie,ye]=h(B?.enableAutoSync??!0),[Y,Ae]=h(B?.debug??!1),[re,ce]=h(null),[ve,Oe]=h([]),[Le,xe]=h(null),[Z,We]=h(null),[X,Fe]=h(null),[je,Re]=h(null),r=(e,t)=>{B?.debug&&console.log(`[UnifiedSyncDemo] ${e}`,t||"")},u=e=>{const t=new Date().toLocaleTimeString();Oe(s=>[...s.slice(-19),`[${t}] ${e}`])},Ge=()=>{const e=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;return B?.clientId&&e.test(B.clientId)?B.clientId:crypto.randomUUID()},Xe=async()=>{try{r("initializing system"),u("🚀 Initializing Unified Sync System...");const e=B?.apiBaseUrl||"http://localhost:8080",t=Ge();r("created client",{baseUrl:e,clientId:t.slice(0,8)}),u(`📋 Client ID: ${t.slice(0,8)}...`);const s=new ht({baseUrl:e}),a=new bt({url:e.replace("http","ws")+"/ws",autoReconnect:!0,debug:Y()||B?.debug||!1});We(a);const l=o=>{r("handleStatusChange called",{status:o,previous:j()}),oe(o);const f=o===W.Connected;F(f),r("websocket status change",{status:o,connected:f}),u(`🔗 WebSocket: ${o}`),f?(H(null),u("✅ WebSocket connected successfully")):o===W.Error&&H("WebSocket connection error")};a.on("statusChange",l),a.on("error",o=>{r("websocket error",o),u(`❌ WebSocket error: ${o.message}`),H(o.message)}),a.on("notification",o=>{r("received notification",{channel:o.channel,event_type:o.event_type}),u(`📬 Notification: ${o.channel}/${o.event_type}`),o.channel==="MediaBlobs"&&(o.event_type==="song.created"||o.event_type==="song.updated"||o.event_type==="song.deleted"||o.event_type==="music.library.updated")&&(u(`🎵 Music event: ${o.event_type}`),ce(new Date))}),r("setting up unified sync system");const{syncManager:d,autoSyncSystem:y}=await ft(a,s,{apiBaseUrl:e,clientId:t,enableUserNotifications:!1,enableBackgroundSync:!1});if(!d)throw new Error("Failed to create sync manager");if(!y)throw new Error("Failed to create auto-sync system");Fe(d),Re(y),Ke(d),r("auto-connecting websocket"),a.connect();const U=1e4,A=Date.now();for(;a.getStatus()!==W.Connected;){if(Date.now()-A>U)throw new Error("WebSocket connection timeout");await new Promise(o=>setTimeout(o,100))}const T=a.getStatus();r("final websocket status after connect",T),oe(T),F(T===W.Connected),u(`🔗 WebSocket connection established: ${T}`);try{const o=await d.getStorageStats();r("storage stats from IDB",o);const f=d.getStatus(),g=d.getProgress(),p={music:f.music||i.Never,photos:f.photos||i.Never,documents:f.documents||i.Never,videos:f.videos||i.Never},K={music:{status:p.music,progress:p.music===i.Complete?100:g.music?.progress||0,itemsProcessed:p.music===i.Complete?o.itemCounts.music:g.music?.itemsProcessed||0,totalItems:p.music===i.Complete?o.itemCounts.music:g.music?.totalItems||0,currentBatch:g.music?.currentBatch||1,totalBatches:g.music?.totalBatches||1,eta:0},photos:{status:p.photos,progress:p.photos===i.Complete?100:g.photos?.progress||0,itemsProcessed:p.photos===i.Complete?o.itemCounts.photos:g.photos?.itemsProcessed||0,totalItems:p.photos===i.Complete?o.itemCounts.photos:g.photos?.totalItems||0,currentBatch:g.photos?.currentBatch||1,totalBatches:g.photos?.totalBatches||1,eta:0},documents:{status:p.documents,progress:p.documents===i.Complete?100:g.documents?.progress||0,itemsProcessed:p.documents===i.Complete?o.itemCounts.documents:g.documents?.itemsProcessed||0,totalItems:p.documents===i.Complete?o.itemCounts.documents:g.documents?.totalItems||0,currentBatch:g.documents?.currentBatch||1,totalBatches:g.documents?.totalBatches||1,eta:0},videos:{status:p.videos,progress:p.videos===i.Complete?100:g.videos?.progress||0,itemsProcessed:p.videos===i.Complete?o.itemCounts.videos:g.videos?.itemsProcessed||0,totalItems:p.videos===i.Complete?o.itemCounts.videos:g.videos?.totalItems||0,currentBatch:g.videos?.currentBatch||1,totalBatches:g.videos?.totalBatches||1,eta:0}};G(p),J(K);const te=Object.values(o.lastSyncTimes).filter(Boolean);if(te.length>0){const P=te.reduce((O,Q)=>Q&&(!O||Q>O)?Q:O,null);P&&(ce(P),r("initialized last sync time",P))}p.music===i.Complete&&d.getMusicBreakdown().then(P=>{xe(P),r("loaded music breakdown",P)}),r("initialized from IDB",{status:p,itemCounts:o.itemCounts}),u(`📊 Loaded from IDB: ${Object.values(p).filter(P=>P===i.Complete).length} domains with data`),setTimeout(()=>{$e()},2e3),setTimeout(()=>{ee()},1e3)}catch(o){r("failed to get initial status",o),G({music:i.Never,photos:i.Never,videos:i.Never,documents:i.Never})}N(!0),r("system initialized successfully"),u("✅ System initialized successfully")}catch(e){r("initialization failed",e),u(`❌ Initialization failed: ${e.message}`),H(e.message)}},Ke=e=>{e.on(q.Started,t=>{r("sync started",{domain:t.domain}),u(`🔄 Sync started: ${t.domain||"all domains"}`),ne(!0),R({status:i.InProgress,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Starting sync..."})}),e.on(q.Progress,t=>{const s=t,a=e.getStatus(),l=e.getProgress();G(a),J(l);const d=Object.values(l),y=d.reduce((f,g)=>f+g.totalItems,0),U=d.reduce((f,g)=>f+g.itemsProcessed,0),A=d.reduce((f,g)=>f+g.totalBatches,0),T=d.reduce((f,g)=>f+g.currentBatch,0),o=y>0?Math.round(U/y*100):0;R({status:i.InProgress,progress:o,itemsProcessed:U,totalItems:y,currentBatch:T,totalBatches:A,eta:s.progress?.eta||0,currentOperation:s.progress?.currentOperation||`Syncing ${s.domain}`}),s.domain&&s.progress&&u(`📊 ${s.domain}: ${s.progress.itemsProcessed}/${s.progress.totalItems} items (${s.progress.progress}%)`)}),e.on(q.AllCompleted,t=>{const s=t;r("sync completed",{domain:s.domain,itemsSynced:s.result.itemsSynced}),u(`✅ Sync completed: ${s.domain||"all domains"} - ${s.result.itemsSynced} items`),s.domain&&G(l=>({...l,[s.domain]:i.Complete})),ne(!1),ce(new Date);const a=X();a&&a.getMusicBreakdown().then(l=>{xe(l),r("updated music breakdown after sync",l)}),R({status:i.Complete,progress:100,itemsProcessed:b().itemsProcessed,totalItems:b().totalItems,currentBatch:b().totalBatches,totalBatches:b().totalBatches,eta:0,currentOperation:"Complete"}),setTimeout(()=>{G(a.getStatus()),J(a.getProgress())},100),De(l=>l+1),setTimeout(()=>{$e()},1500),s.result&&s.result.binaryStats&&s.result.binaryStats.cached>0&&(u("🖼️ Binary sync completed, checking for images..."),setTimeout(()=>{ee()},2e3)),setTimeout(()=>{E()||R({status:i.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"})},5e3)}),e.on(q.Failed,t=>{const s=t;r("sync failed",s),u(`❌ Sync failed: ${s.error?.message||"Unknown error"}`),ne(!1)}),e.on(q.BinaryProgress,t=>{const s=t,{currentItem:a,totalItems:l,domain:d}=s;d&&l>0&&(J(y=>({...y,[d]:{...y[d],itemsProcessed:a,totalItems:l,currentOperation:`Downloading binary data (${a}/${l})`}})),R({status:i.InProgress,progress:s.progress||0,itemsProcessed:a,totalItems:l,currentBatch:a,totalBatches:l,eta:0,currentOperation:`Downloading binary data (${a}/${l})`}))})},ee=async()=>{const e=X();if(!(!e||!D()))try{const t=(await e.getMediaBlobs()).slice(0,100);if(t.length===0){pe([]);return}u(`📷 Found ${t.length} image blobs, checking binary data...`);const s=[];let a=0;for(const l of t)try{if(await e.hasBinaryData(l.id)){a++;const y=await e.getBlobUrl(l.id);y&&s.push(y)}}catch{continue}s.length>0?(pe(s),u(`🎨 Image grid loaded: ${s.length} images (${a} with binary data)`)):a===0&&t.length>0&&u(`📷 Found ${t.length} image metadata but no binary data yet`)}catch(t){u(`❌ Failed to load image grid: ${t.message}`)}},Se=e=>{if(e===0)return"0 B";const t=1024,s=["B","KB","MB","GB"],a=Math.floor(Math.log(e)/Math.log(t));return Math.round(e/Math.pow(t,a)*100)/100+" "+s[a]},$e=async()=>{try{const e=X();if(!e){r("no sync manager available for storage stats");return}r("calculating storage usage");const t=await e.getStorageStats();r("storage stats received",t);const s={totalSize:t?.totalSize||0,itemCounts:t?.itemCounts||{music:0,photos:0,documents:0,videos:0},binarySize:t?.binarySize||0},a=Se(s.totalSize),l=s.itemCounts.music,d=l>0?`${l} items`:"No data",y=Se(s.binarySize);he(a),be(d),fe(y),r("updated storage stats",{total:a,music:d,binary:y})}catch(e){console.error("Could not calculate storage usage:",e),he("Error"),be("Error"),fe("Error")}};ke(()=>{const e=x(),t=D(),s=E(),a=j();r("button state reactive check",{connected:e,initialized:t,syncing:s,wsStatus:a,buttonEnabled:e&&!s});const l=Z();if(l){const d=l.getStatus();d!==a&&(r("status mismatch detected, correcting",{actualStatus:d,wsStatus:a}),oe(d),F(d===W.Connected))}}),ke(()=>{const e=X(),t=D();if(ze(),e&&t){ee();const s=setInterval(()=>{ee()},3e3);setTimeout(()=>{clearInterval(s)},3e4)}});const Qe=async()=>{const e=X();if(!(!e||E()))try{r("starting sync all"),u("🔄 Starting sync for all domains...");const t=await e.syncAll({domains:["music","photos"],includeBinaryData:!0,forceFullSync:!1});u(`✨ Sync completed! Domain: ${t.domain}, Items: ${t.itemsSynced}/${t.totalItems}`)}catch(t){r("sync all failed",t),u(`❌ Sync failed: ${t.message}`)}},Ve=async()=>{const e=je();if(!e){u("❌ Auto-sync system not available");return}try{const t=!ie();ye(t),t?(e.start?await e.start():e.enable&&await e.enable(),r("auto-sync enabled"),u("🔄 Auto-sync enabled")):(e.stop?await e.stop():e.disable&&await e.disable(),r("auto-sync disabled"),u("⏸️ Auto-sync disabled"))}catch(t){r("auto-sync toggle failed",t),u(`❌ Auto-sync toggle failed: ${t.message}`),ye(!ie())}},qe=()=>{const e=!Y();Ae(e),e?(Ie(),Pe({enabled:!0,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!0}})):yt();const t=Z();t&&t.setDebug(e),typeof window<"u"&&(window.debugEnabled=e),r(`Debug logging ${e?"enabled":"disabled"}`),u(`🔧 Debug logging ${e?"enabled":"disabled"}`)};return ut(()=>{r("component mounted"),Y()&&(Ie(),Pe({enabled:!0,timestamps:!0,levels:{info:!0,warn:!0,error:!0,debug:!0}}),typeof window<"u"&&(window.debugEnabled=!0)),Xe()}),mt(()=>{r("component unmounting");const e=Z();e&&e.disconnect()}),(()=>{var e=Tt(),t=e.firstChild,s=t.firstChild,a=s.nextSibling,l=a.firstChild,d=l.nextSibling,y=d.firstChild,U=y.nextSibling;U.nextSibling;var A=t.nextSibling,T=A.firstChild,o=T.nextSibling,f=A.nextSibling,g=f.firstChild,p=g.nextSibling,K=p.firstChild,te=p.nextSibling,P=te.firstChild,O=f.nextSibling,Q=O.firstChild,we=Q.nextSibling,V=we.firstChild,le=O.nextSibling,He=le.firstChild,Je=He.nextSibling,de=le.nextSibling,Ye=de.firstChild,Ze=Ye.nextSibling,Ce=Ze.firstChild,et=Ce.firstChild,tt=et.nextSibling,st=Ce.nextSibling,_e=st.firstChild,nt=_e.firstChild,ot=nt.nextSibling,at=_e.nextSibling,it=at.firstChild,rt=it.nextSibling,ct=de.nextSibling,lt=ct.firstChild,Be=lt.nextSibling;return c(l,()=>D()?"✅ Ready":"⏳ Initializing"),c(d,()=>x()?"🔗 Connected":"🔗 Disconnected",y),c(d,j,U),c(o,S(z,{get when(){return Z()},get children(){return[S(vt,{get status(){return j()},showText:!0,compact:!0}),(()=>{var n=$t(),v=n.firstChild,w=v.nextSibling;return w.nextSibling,c(n,()=>x()?"Connected":"Disconnected",v),c(n,j,w),M(()=>L(n,`connection-text ${x()?"connected":"disconnected"}`)),n})()]}})),c(A,S(z,{get when(){return me()},get children(){var n=wt();return n.firstChild,c(n,me,null),n}}),null),K.addEventListener("change",Ve),P.addEventListener("change",qe),V.$$click=Qe,c(V,()=>E()?"🔄 Syncing...":"🚀 Sync All"),c(we,S(z,{get when(){return re()},get children(){var n=Ct();return n.firstChild,c(n,()=>xt(re()),null),M(()=>se(n,"title",St(re()))),n}}),null),c(e,S(z,{get when(){return E()||b().totalItems>0},get children(){var n=zt();return n.firstChild,c(n,S(z,{get when(){return E()},get children(){var v=Pt(),w=v.firstChild,_=w.firstChild,k=w.nextSibling;return c(k,S(z,{get when(){return b().totalItems>0},get children(){var m=_t(),C=m.firstChild;return c(m,()=>b().progress,C),m}}),null),c(k,S(z,{get when(){return b().currentOperation},get children(){var m=Bt();return c(m,()=>b().currentOperation),m}}),null),c(k,S(z,{get when(){return b().totalItems===0},get children(){var m=kt();return c(m,()=>b().currentOperation||(b().itemsProcessed>0?`Processing... (${b().itemsProcessed} items)`:"Initializing sync...")),m}}),null),c(k,S(z,{get when(){return b().totalItems>0},get children(){var m=It(),C=m.firstChild,I=C.nextSibling;return I.nextSibling,c(m,()=>b().itemsProcessed,C),c(m,()=>b().totalItems,I),m}}),null),M(m=>{var C=`${b().totalItems>0?b().progress:Math.min(85,Math.max(10,b().itemsProcessed*.5))}%`,I=b().totalItems>0?"linear-gradient(90deg, magenta, #cc00cc)":"linear-gradient(90deg, #ff6600, #cc4400)";return C!==m.e&&((m.e=C)!=null?_.style.setProperty("width",C):_.style.removeProperty("width")),I!==m.t&&((m.t=I)!=null?_.style.setProperty("background",I):_.style.removeProperty("background")),m},{e:void 0,t:void 0}),v}}),null),n}}),le),c(Je,S(ue,{get each(){return Object.entries(Ne())},children:([n,v])=>(()=>{var w=Mt(),_=w.firstChild,k=_.nextSibling,m=k.nextSibling;return c(_,n),c(k,v),c(m,()=>At(n,Ue()[n],n==="music"?Le():void 0)),M(()=>L(w,`domain-card ${v.toLowerCase()}`)),w})()})),c(e,S(z,{get when(){return ae().length>0},get children(){var n=Dt(),v=n.firstChild,w=v.firstChild,_=w.nextSibling;_.nextSibling;var k=v.nextSibling;return c(v,()=>ae().length,_),c(k,S(ue,{get each(){return ae()},children:(m,C)=>(()=>{var I=Nt(),ge=I.firstChild;return ge.addEventListener("error",dt=>{r(`failed to load image ${C()+1}`,m),dt.target.style.display="none"}),se(ge,"src",m),M(()=>se(ge,"alt",`Image ${C()+1}`)),I})()})),n}}),de),c(tt,Ee),c(ot,Te),c(rt,Me),c(Be,S(ue,{get each(){return ve().slice().reverse()},children:n=>(()=>{var v=Ut();return c(v,n),v})()}),null),c(Be,S(z,{get when(){return ve().length===0},get children(){return Et()}}),null),M(n=>{var v=`unified-sync-demo ${B?.className||""}`,w=`status-badge ${D()?"success":"pending"}`,_=`status-badge ${x()?"success":"error"}`,k=!D(),m=`btn btn-sync ${E()?"syncing":""}`,C=!x()||E(),I=x()?E()?"Sync in progress...":"Sync all domains":"WebSocket must be connected to sync";return v!==n.e&&L(e,n.e=v),w!==n.t&&L(l,n.t=w),_!==n.a&&L(d,n.a=_),k!==n.o&&(K.disabled=n.o=k),m!==n.i&&L(V,n.i=m),C!==n.n&&(V.disabled=n.n=C),I!==n.s&&se(V,"title",n.s=I),n},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0}),M(()=>K.checked=ie()),M(()=>P.checked=Y()),e})()};pt("unified-sync-demo",{apiBaseUrl:"",clientId:"",enableAutoSync:!0,debug:!1,className:""},Ot);gt(["click"]);
//# sourceMappingURL=unified-sync-demo.js.map
