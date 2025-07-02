import{d as Et,c as g,g as Oe,o as Ut,f as Mt,t as h,k as i,i as f,S,b as T,e as q,m as Tt,F as Fe,l as je}from"./web-Bmt1sUg0.js";import{c as Nt}from"./index-CuXI0cIU.js";import{A as At}from"./api-client-oDSgDTkX.js";import{C as O,W as Wt}from"./websocket-client-BIZ3xMI1.js";import{a as r,S as Lt,b as Ot,s as Ft,e as jt,d as Rt,c as W}from"./sync-status-DMeMG7fP.js";import{W as Gt}from"./websocket-status-B6AILaLV.js";import"./types-DDODKsJP.js";var Vt=h("<button class=connect-button>"),Xt=h("<button class=disconnect-button>Disconnect"),Yt=h("<div class=connection-buttons>"),Kt=h("<label class=toggle-control><input type=checkbox checked disabled><span>🔔 User Notifications"),Qt=h("<span>🔄 Syncing..."),qt=h("<div class=last-sync>Last sync: "),Ht=h("<span class=progress-percentage>%"),Jt=h("<div class=progress-operation>"),Zt=h("<span class=progress-initializing>"),es=h("<span class=progress-items>"),ts=h("<div class=horizontal-progress-container><div class=horizontal-progress-bar><div class=horizontal-progress-fill></div></div><div class=horizontal-progress-text>"),ss=h("<div class=progress-section><h3>📊 Sync Progress"),ns=h("<div class=domain-status><h3>🎵 Music Domain Status</h3><div class=domain-grid><div><div class=domain-name>🎵 music</div><div class=domain-progress><div class=domain-progress-text>/<!> items</div><div class=domain-progress-bar><div class=domain-progress-fill></div></div><div class=domain-progress-percent>%"),os=h("<div class=image-grid-section><h3>🖼️ Binary Data Image Grid (<!> images)</h3><div class=image-grid>"),is=h("<div class=log-empty>No activity yet..."),as=h(`<div><div class=demo-header><h2>🚀 Unified Sync System Demo</h2><div class=phase-info><span class=phase-badge>Phase 4: Unified UI Demo</span><span class=version-badge>v1.0.0</span></div></div><div class=connection-section><h3>🔗 Connection Status</h3><div class=connection-controls><div class=initialization-status><span></span></div></div></div><div class=feature-toggles><h3>⚙️ Feature Controls</h3><div class=toggle-controls><label class=toggle-control><input type=checkbox><span>🔧 Service Worker Background Sync</span></label><label class=toggle-control><input type=checkbox><span>🔄 Auto-Sync on Changes</span></label><label class=toggle-control><input type=checkbox><span>🐛 Debug Logging</span></label></div></div><div class=sync-controls><h3>🎯 Unified Sync Control</h3><div class=main-controls><button></button><button class=destroy-button title="Completely destroy all IndexedDB data (for testing)">💥 Destroy All Data</button></div></div><div class=storage-stats><h3>💾 Storage Usage</h3><div class=storage-display><div class=storage-item><span class=storage-label>Total:</span><span class=storage-value></span></div><div class=storage-breakdown><div class=storage-item><span class=storage-label>Music:</span><span class=storage-value></span></div><div class=storage-item><span class=storage-label>Binary Data:</span><span class=storage-value></span></div></div></div></div><div class=activity-log><h3>📋 Activity Log</h3><div class=log-container></div></div><div class=system-info><h3>ℹ️ System Information</h3><div class=info-grid><div class=info-item><span class=info-label>Sync Features:</span><span class=info-value></span></div><div class=info-item><span class=info-label>Client ID:</span><span class=info-value>...</span></div><div class=info-item><span class=info-label>API URL:</span><span class=info-value></span></div></div></div><style>
        .unified-sync-demo {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: black;
          color: white;
          border-radius: 12px;
        }

        .demo-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          padding-bottom: 15px;
          border-bottom: 2px solid #333;
        }

        .demo-header h2 {
          margin: 0;
          color: white;
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
        .system-info,
        .storage-stats {
          margin-bottom: 25px;
          padding: 15px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #111;
        }

        .connection-section h3,
        .feature-toggles h3,
        .sync-controls h3,
        .progress-section h3,
        .domain-status h3,
        .image-grid-section h3,
        .activity-log h3,
        .system-info h3,
        .storage-stats h3 {
          margin: 0 0 15px 0;
          color: white;
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
        }

        .toggle-control {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
          color: white;
        }

        .toggle-control input[type="checkbox"] {
          cursor: pointer;
        }

        .toggle-control input[type="checkbox"]:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .main-controls {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 15px;
        }

        .sync-all-button {
          padding: 15px 30px;
          font-size: 18px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          background: #ff00ff;
          color: black;
          min-width: 200px;
        }

        .sync-all-button:hover:not(:disabled) {
          background: #ff00ff;
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(255, 0, 255, 0.3);
        }

        .sync-all-button:disabled {
          background: #333;
          color: #666;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .sync-all-button.syncing {
          background: linear-gradient(135deg, #ff00ff, #cc00cc);
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
          color: #ccc;
          font-size: 14px;
        }

        .loading-indicator {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 8px;
          font-size: 14px;
          color: #6c757d;
        }

        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid #e9ecef;
          border-top: 2px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
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
          color: #ff00ff;
          font-size: 16px;
        }

        .progress-items {
          color: #ccc;
        }

        .progress-initializing {
          color: #ff00ff;
          font-weight: 500;
        }

        .progress-operation {
          color: #ccc;
          font-size: 13px;
          font-style: italic;
        }

        .progress-display {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .domain-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
        }

        .domain-card {
          padding: 15px;
          border: 2px solid #333;
          border-radius: 8px;
          background: #222;
          transition: all 0.2s ease;
        }

        .domain-card.complete {
          border-color: #0f0;
          background: #001100;
        }

        .domain-card.in_progress {
          border-color: #ff00ff;
          background: #330033;
        }

        .domain-card.failed {
          border-color: #e74c3c;
          background: #fadbd8;
        }

        .domain-name {
          font-weight: 600;
          margin-bottom: 10px;
          color: white;
        }

        .domain-progress {
          margin-top: 8px;
          font-size: 12px;
        }

        .domain-progress-text {
          color: #ccc;
          margin-bottom: 4px;
        }

        .domain-progress-bar {
          width: 100%;
          height: 4px;
          background-color: #444;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 4px;
        }

        .domain-progress-fill {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 2px;
        }

        .domain-progress-percent {
          color: white;
          font-weight: 500;
          text-align: center;
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
          color: #ff00ff;
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

        .log-container {
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid #333;
          border-radius: 4px;
          background: #111;
          padding: 10px;
        }

        .log-entry {
          padding: 4px 0;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 12px;
          color: #ccc;
          border-bottom: 1px solid #333;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-empty {
          color: #666;
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
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #333;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          font-weight: 600;
          color: #34495e;
        }

        .info-value {
          font-family: "Monaco", "Menlo", monospace;
          color: white;
          font-size: 13px;
        }

        .image-grid-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 8px;
          border: 1px solid #333;
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

        .grid-image:error {
          border-color: #f00;
          background: #330000;
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
      `),rs=h("<span>🚀 Sync All Domains"),ls=h("<div class=image-item><img class=grid-image>"),cs=h("<div class=log-entry>");function ds(B){const[E,ge]=g(null),[ue,me]=g(null),[G,Re]=g(null),[gs,Ge]=g(null),[z,pe]=g(!1),[H,fe]=g(O.Disconnected),[$,he]=g(!1),[us,F]=g(null),[V,J]=g({music:r.Never,photos:r.Never,documents:r.Never,videos:r.Never}),[j,X]=g({music:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0},photos:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0},documents:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0},videos:{status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0}}),[ms,Z]=g(r.Never),[b,Y]=g({status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"}),[ee,Ve]=g(B.enableServiceWorker??!0),[te,Xe]=g(B.enableAutoSync??!0),[be,Ye]=g([]),[v,se]=g(!1),[ye,xe]=g(null),[ne,oe]=g([]),[Ke,ve]=g(0),[Se,Qe]=g(!1),[qe,$e]=g("Loading..."),[He,Ce]=g("Loading..."),[Je,we]=g("Loading..."),o=e=>{const t=new Date().toLocaleTimeString();Ye(s=>[...s.slice(-9),`[${t}] ${e}`])},Ze=()=>typeof crypto<"u"&&crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(e){const t=Math.random()*16|0;return(e=="x"?t:t&3|8).toString(16)}),_e=()=>{const e=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;return B.clientId&&e.test(B.clientId)?B.clientId:Ze()},ke=async()=>{try{o("🚀 Initializing Unified Sync System...");const e=B.apiBaseUrl||"http://localhost:8080",t=_e();o(`📋 Client ID: ${t}`),o(`🌐 API Base URL: ${e}`);const s=new At({baseUrl:e});Ge(s);const u=e.replace("http","ws").replace("3001","8080")+"/ws",l=new Wt({url:u,autoReconnect:!0,reconnectDelay:3e3,debug:!0});Re(l);const C=a=>{fe(a);const m=a===O.Connected;pe(m),o(`🔗 WebSocket status: ${a}`),console.log("🐛 WebSocket status change:",{status:a,isConnected:m,isInitialized:$()}),m?(F(null),console.log("🔌 WebSocket connected - forcing UI update")):a===O.Error&&F("WebSocket connection error")};l.on("statusChange",C),l.on("error",a=>{F(a.message),o(`❌ WebSocket error: ${a.message}`)}),B.autoConnect!==!1&&(o("🔄 Auto-connecting WebSocket..."),l.connect()),o("⚙️ Setting up unified sync manager...");const{syncManager:p,autoSyncSystem:N}=await Ft(l,s,{apiBaseUrl:e,clientId:t,enableUserNotifications:B.enableUserNotifications??!0,enableBackgroundSync:ee()});ge(p),me(N),et(p),te()&&(o("🔄 Enabling auto-sync..."),p.enableAutoSync(!0));try{const a=await p.getStorageStats();console.log("🐛 Initial storage stats:",a);const m={music:(a.itemCounts?.music||0)>0?r.Complete:r.Never,photos:(a.itemCounts?.photos||0)>0?r.Complete:r.Never,documents:(a.itemCounts?.documents||0)>0?r.Complete:r.Never,videos:(a.itemCounts?.videos||0)>0?r.Complete:r.Never},y={music:{status:m.music,progress:m.music===r.Complete?100:0,itemsProcessed:a.itemCounts?.music||0,totalItems:a.itemCounts?.music||0,currentBatch:1,totalBatches:1},photos:{status:m.photos,progress:m.photos===r.Complete?100:0,itemsProcessed:a.itemCounts?.photos||0,totalItems:a.itemCounts?.photos||0,currentBatch:1,totalBatches:1},documents:{status:m.documents,progress:m.documents===r.Complete?100:0,itemsProcessed:a.itemCounts?.documents||0,totalItems:a.itemCounts?.documents||0,currentBatch:1,totalBatches:1},videos:{status:m.videos,progress:m.videos===r.Complete?100:0,itemsProcessed:a.itemCounts?.videos||0,totalItems:a.itemCounts?.videos||0,currentBatch:1,totalBatches:1}};J(m),X(y),o(`📊 Initialized domain status: ${Object.values(m).filter(_=>_===r.Complete).length} domains with data`)}catch(a){console.warn("Could not initialize domain status:",a),J(p.getStatus()),X(p.getProgress()),o("📊 Using default domain status")}setTimeout(()=>{Be()},2e3),he(!0),o("✅ Unified Sync System initialized successfully");const L=l.getStatus();L===O.Connected&&!z()&&(pe(!0),F(null)),fe(L),console.log("🐛 State after initialization:",{isInitialized:!0,isConnected:z(),isSyncing:v()}),Oe(()=>{const a=z(),m=$(),y=v();console.log("🔄 Button state check:",{connected:a,initialized:m,syncing:y,buttonEnabled:a&&m&&!y})}),o("✅ Unified Sync System initialized successfully")}catch(e){o(`❌ Initialization failed: ${e.message}`),F(e.message)}},et=e=>{e.on(W.Started,t=>{o(`🔄 Sync started: ${t.domain||"all domains"}`),se(!0),Z(r.InProgress)}),e.on(W.Progress,t=>{const s=t,u=e.getStatus(),l=e.getProgress();J(u),X(l),l[s.domain].totalItems>0&&console.log(`📊 ${s.domain}: ${l[s.domain].itemsProcessed}/${l[s.domain].totalItems} (${l[s.domain].progress}%)`);const C=Object.values(l),p=C.reduce((y,_)=>y+_.totalItems,0),N=C.reduce((y,_)=>y+_.itemsProcessed,0),L=C.reduce((y,_)=>y+_.totalBatches,0),a=C.reduce((y,_)=>y+_.currentBatch,0),m=p>0?Math.round(N/p*100):0;Y({status:r.InProgress,progress:m,itemsProcessed:N,totalItems:p,currentBatch:a,totalBatches:L,eta:s.progress.eta,currentOperation:s.progress.currentOperation||`Syncing ${s.domain}`}),s.domain&&o(`📊 ${s.domain}: ${s.progress.itemsProcessed}/${s.progress.totalItems} items (${s.progress.progress}%)`)}),e.on(W.AllCompleted,t=>{const s=t;o(`✅ Sync completed: ${s.domain||"all domains"}`),se(!1),xe(new Date),Z(r.Complete);const u=e.getProgress();X(u),Y({status:r.Complete,progress:100,itemsProcessed:b().itemsProcessed,totalItems:b().totalItems,currentBatch:b().totalBatches,totalBatches:b().totalBatches,eta:0,currentOperation:"Complete"}),s.result&&o(`📈 Stats: ${s.result.itemsSynced} items, ${Math.round(s.result.duration/1e3)}s`),ve(l=>l+1),setTimeout(()=>{Be()},1500),s.result&&s.result.binaryStats&&s.result.binaryStats.cached>0&&(o("🖼️ Binary sync completed, checking for images..."),setTimeout(()=>{ie()},2e3)),setTimeout(()=>{v()||Y({status:r.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"})},5e3)}),e.on(W.Failed,t=>{o(`❌ Sync failed: ${t.error.message}`),se(!1),Z(r.Failed)}),e.on(W.AutoSyncTriggered,t=>{const s=t;o(`🔄 Auto-sync triggered for ${s.trigger}: ${s.domain}`)}),e.on(W.ConnectionChanged,t=>{o(`🔗 Connection ${t.isOnline?"established":"lost"}`)}),e.on(W.BinaryProgress,t=>{const s=t;if(s.currentItem&&s.totalItems){const u=s.currentItem,l=s.totalItems;o(`📁 Binary sync: ${u}/${l} files`),Y({status:r.InProgress,progress:s.progress||0,itemsProcessed:u,totalItems:l,currentBatch:u,totalBatches:l,eta:0,currentOperation:`Downloading binary data (${u}/${l})`})}})},Ie=e=>{if(e===0)return"0 B";const t=1024,s=["B","KB","MB","GB"],u=Math.floor(Math.log(e)/Math.log(t));return Math.round(e/Math.pow(t,u)*100)/100+" "+s[u]},Be=async()=>{try{const e=E();if(!e){console.log("🐛 No sync manager available for storage stats");return}console.log("🐛 Calculating storage usage...");const t=await e.getStorageStats();console.log("🐛 Storage stats received:",t);const s={totalSize:t?.totalSize||0,itemCounts:t?.itemCounts||{music:0,photos:0,documents:0,videos:0},binarySize:t?.binarySize||0};console.log("🐛 Safe stats:",s);const u=Ie(s.totalSize),l=s.itemCounts.music,C=l>0?`${l} items`:"No data",p=Ie(s.binarySize);$e(u),Ce(C),we(p),console.log("🐛 Updated storage stats:",{total:u,music:C,binary:p})}catch(e){console.error("Could not calculate storage usage:",e),$e("Error"),Ce("Error"),we("Error")}},tt=async()=>{const e=E();if(!(!e||v()))try{o("🚀 Starting unified sync for all domains...");const t=await e.syncAll({domains:["music","photos"],includeBinaryData:!0,forceFullSync:!1});o(`✨ Sync completed! Domain: ${t.domain}, Items: ${t.itemsSynced}/${t.totalItems}`)}catch(t){o(`❌ Sync failed: ${t.message}`)}},st=async()=>{const e=!ee();if(Ve(e),o(`🔧 Service Worker ${e?"enabled":"disabled"}`),E()&&ue()){const s=ue();s.setBackgroundSyncEnabled&&await s.setBackgroundSyncEnabled(e)}},nt=async()=>{const e=!te();Xe(e);const t=E();t&&(e?(o("🔄 Enabling auto-sync..."),t.enableAutoSync(!0)):(o("⏸️ Disabling auto-sync..."),t.enableAutoSync(!1)))},ot=async()=>{if(!(!E()||v()))try{o("💥 Starting complete database teardown..."),he(!1),xe(null),oe([]),ve(0),await E()?.destroy(),o("🗑️ Database completely destroyed!"),ge(null),me(null),o("🔄 Reinitializing system..."),await ke(),o("✅ System reinitialized successfully!")}catch(t){o(`❌ Teardown failed: ${t.message}`),console.error("Destroy error:",t)}},ie=async()=>{const e=E();if(!(!e||!$()))try{const t=(await e.getMediaBlobs()).slice(0,100);if(t.length===0){oe([]);return}o(`📷 Found ${t.length} image blobs, checking binary data...`);const s=[];let u=0;for(const l of t)try{if(await e.hasBinaryData(l.id)){u++;const p=await e.getBlobUrl(l.id);p&&s.push(p)}}catch{continue}s.length>0?(oe(s),o(`🎨 Image grid loaded: ${s.length} images (${u} with binary data)`)):u===0&&t.length>0&&o(`📷 Found ${t.length} image metadata but no binary data yet`)}catch(t){o(`❌ Failed to load image grid: ${t.message}`)}};Oe(()=>{const e=E(),t=$();if(Ke(),e&&t){ie();const s=setInterval(()=>{ie()},3e3);setTimeout(()=>{clearInterval(s)},3e4)}});const it=()=>{const e=G();e&&!z()&&(o("🔄 Connecting WebSocket..."),e.connect())},at=()=>{const e=!Se();Qe(e),e?(jt(),o("🐛 Debug logging enabled")):(Rt(),o("🔇 Debug logging disabled"))},rt=()=>{const e=G();e&&z()&&(o("🔌 Disconnecting WebSocket..."),e.disconnect())};Ut(()=>{ke()}),Mt(()=>{const e=G(),t=E();e&&e.disconnect(),t&&t.destroy()});const ae=()=>{const e=b();return{percentage:e.progress,itemsText:`${e.itemsProcessed}/${e.totalItems} items`,batchText:e.totalBatches>0?`Batch ${e.currentBatch}/${e.totalBatches}`:"",etaText:e.eta&&e.eta>0?`ETA: ${Math.round(e.eta)}s`:"",speedText:""}};return(()=>{var e=as(),t=e.firstChild,s=t.nextSibling,u=s.firstChild,l=u.nextSibling,C=l.firstChild,p=C.firstChild,N=s.nextSibling,L=N.firstChild,a=L.nextSibling,m=a.firstChild,y=m.firstChild,_=m.nextSibling,re=_.firstChild,lt=_.nextSibling,Pe=lt.firstChild,ze=N.nextSibling,ct=ze.firstChild,De=ct.nextSibling,R=De.firstChild,k=R.nextSibling,le=ze.nextSibling,dt=le.firstChild,gt=dt.nextSibling,Ee=gt.firstChild,ut=Ee.firstChild,mt=ut.nextSibling,pt=Ee.nextSibling,Ue=pt.firstChild,ft=Ue.firstChild,ht=ft.nextSibling,bt=Ue.nextSibling,yt=bt.firstChild,xt=yt.nextSibling,K=le.nextSibling,vt=K.firstChild,Me=vt.nextSibling,St=K.nextSibling,$t=St.firstChild,Ct=$t.nextSibling,Te=Ct.firstChild,wt=Te.firstChild,_t=wt.nextSibling,Ne=Te.nextSibling,kt=Ne.firstChild,Ae=kt.nextSibling,It=Ae.firstChild,Bt=Ne.nextSibling,Pt=Bt.firstChild,zt=Pt.nextSibling;return i(l,f(S,{get when(){return G()},get children(){return[f(Gt,{get status(){return H()},showText:!0,compact:!0}),(()=>{var n=Yt();return i(n,f(S,{get when(){return!z()},get children(){var d=Vt();return d.$$click=it,i(d,()=>H()===O.Connecting?"Connecting...":"Connect"),T(()=>d.disabled=H()===O.Connecting),d}}),null),i(n,f(S,{get when(){return z()},get children(){var d=Xt();return d.$$click=rt,d}}),null),n})()]}}),C),i(p,()=>$()?"✅ Initialized":"⏳ Initializing..."),y.addEventListener("change",st),re.addEventListener("change",nt),Pe.addEventListener("change",at),i(a,f(S,{get when(){return B.enableUserNotifications!==!1},get children(){return Kt()}}),null),R.$$click=()=>{console.log("🐛 Button click - Debug state:",{isInitialized:$(),isConnected:z(),isSyncing:v(),buttonDisabled:!$()||!z()||v()}),tt()},i(R,f(S,{get when(){return v()},get fallback(){return rs()},get children(){return Qt()}})),k.$$click=ot,k.style.setProperty("background-color","#dc3545"),k.style.setProperty("color","white"),k.style.setProperty("border","none"),k.style.setProperty("padding","10px 20px"),k.style.setProperty("border-radius","5px"),k.style.setProperty("margin-left","10px"),i(De,f(S,{get when(){return ye()},get children(){var n=qt();return n.firstChild,i(n,()=>ye()?.toLocaleTimeString(),null),n}}),null),i(e,f(S,{get when(){return v()||b().totalItems>0},get children(){var n=ss();return n.firstChild,i(n,f(S,{get when(){return v()},get children(){var d=ts(),U=d.firstChild,w=U.firstChild,P=U.nextSibling;return i(P,f(S,{get when(){return b().totalItems>0},get children(){var c=Ht(),x=c.firstChild;return i(c,()=>ae().percentage,x),c}}),null),i(P,f(S,{get when(){return b().currentOperation},get children(){var c=Jt();return i(c,()=>b().currentOperation),c}}),null),i(P,f(S,{get when(){return b().totalItems===0},get children(){var c=Zt();return i(c,()=>b().currentOperation||(b().itemsProcessed>0?`Processing... (${b().itemsProcessed} items)`:"Initializing sync...")),c}}),null),i(P,f(S,{get when(){return b().totalItems>0},get children(){var c=es();return i(c,()=>ae().itemsText),c}}),null),T(c=>{var x=`${b().totalItems>0?ae().percentage:Math.min(85,Math.max(10,b().itemsProcessed*.5))}%`,I=b().totalItems>0?"linear-gradient(90deg, #3b82f6, #1d4ed8)":"linear-gradient(90deg, #f59e0b, #d97706)";return x!==c.e&&((c.e=x)!=null?w.style.setProperty("width",x):w.style.removeProperty("width")),I!==c.t&&((c.t=I)!=null?w.style.setProperty("background",I):w.style.removeProperty("background")),c},{e:void 0,t:void 0}),d}}),null),n}}),le),i(mt,qe),i(ht,He),i(xt,Je),i(e,f(S,{get when(){return Tt(()=>!!V().music)()&&j().music},get children(){var n=ns(),d=n.firstChild,U=d.nextSibling,w=U.firstChild,P=w.firstChild,c=P.nextSibling,x=c.firstChild,I=x.firstChild,D=I.nextSibling;D.nextSibling;var M=x.nextSibling,Q=M.firstChild,We=M.nextSibling,Dt=We.firstChild;return i(w,f(Lt,{get status(){return V().music},compact:!0}),c),i(x,()=>j().music.itemsProcessed,I),i(x,()=>j().music.totalItems,D),i(We,()=>Math.round(j().music.progress),Dt),T(A=>{var Le=`domain-card ${V().music.toLowerCase()}`,ce=`${j().music.progress}%`,de=V().music==="in_progress"?"#ff00ff":"#0f0";return Le!==A.e&&q(w,A.e=Le),ce!==A.t&&((A.t=ce)!=null?Q.style.setProperty("width",ce):Q.style.removeProperty("width")),de!==A.a&&((A.a=de)!=null?Q.style.setProperty("background-color",de):Q.style.removeProperty("background-color")),A},{e:void 0,t:void 0,a:void 0}),n}}),K),i(e,f(S,{get when(){return ne().length>0},get children(){var n=os(),d=n.firstChild,U=d.firstChild,w=U.nextSibling;w.nextSibling;var P=d.nextSibling;return i(d,()=>ne().length,w),i(P,f(Fe,{get each(){return ne()},children:(c,x)=>(()=>{var I=ls(),D=I.firstChild;return D.addEventListener("error",M=>{console.log(`Failed to load image ${x()+1}:`,c),M.target.style.display="none"}),je(D,"src",c),T(()=>je(D,"alt",`Image ${x()+1}`)),I})()})),n}}),K),i(Me,f(Fe,{get each(){return be().slice().reverse()},children:n=>(()=>{var d=cs();return i(d,n),d})()}),null),i(Me,f(S,{get when(){return be().length===0},get children(){return is()}}),null),i(_t,()=>Object.entries(Ot).filter(([n,d])=>d).map(([n,d])=>n).join(", ")),i(Ae,()=>_e().slice(0,8),It),i(zt,()=>B.apiBaseUrl||"http://localhost:8080"),T(n=>{var d=`unified-sync-demo ${B.className||""}`,U=`status-indicator ${$()?"success":"pending"}`,w=!$(),P=!$(),c=`sync-all-button ${v()?"syncing pulse":""}`,x=!$()||!z()||v(),I=!$()||v(),D=!$()||v()?"not-allowed":"pointer",M=!$()||v()?"0.5":"1";return d!==n.e&&q(e,n.e=d),U!==n.t&&q(p,n.t=U),w!==n.a&&(y.disabled=n.a=w),P!==n.o&&(re.disabled=n.o=P),c!==n.i&&q(R,n.i=c),x!==n.n&&(R.disabled=n.n=x),I!==n.s&&(k.disabled=n.s=I),D!==n.h&&((n.h=D)!=null?k.style.setProperty("cursor",D):k.style.removeProperty("cursor")),M!==n.r&&((n.r=M)!=null?k.style.setProperty("opacity",M):k.style.removeProperty("opacity")),n},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0}),T(()=>y.checked=ee()),T(()=>re.checked=te()),T(()=>Pe.checked=Se()),e})()}Nt("unified-sync-demo",{apiBaseUrl:void 0,clientId:void 0,autoConnect:!0,enableServiceWorker:!0,enableAutoSync:!0,className:"",enableUserNotifications:!0},ds);Et(["click"]);
//# sourceMappingURL=unified-sync-demo.js.map
