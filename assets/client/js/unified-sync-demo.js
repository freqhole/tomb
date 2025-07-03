import{d as Nt,c as u,g as Re,o as Mt,f as Tt,t as b,k as r,i as f,S,b as T,e as J,m as At,F as Fe,l as je}from"./web-Bmt1sUg0.js";import{c as Lt}from"./index-CuXI0cIU.js";import{A as Wt}from"./api-client-oDSgDTkX.js";import{C as R,W as Ot}from"./websocket-client-BIZ3xMI1.js";import{a as l,S as Rt,b as Ft,s as jt,e as Gt,d as Vt,c as L}from"./sync-status-MeXiLf_p.js";import{W as Xt}from"./websocket-status-B6AILaLV.js";import"./types-DDODKsJP.js";var Yt=b("<button class=connect-button>"),Kt=b("<button class=disconnect-button>Disconnect"),Qt=b("<div class=connection-buttons>"),qt=b("<label class=toggle-control><input type=checkbox checked disabled><span>🔔 User Notifications"),Ht=b("<span>🔄 Syncing..."),Jt=b("<div class=last-sync>Last sync: "),Zt=b('<div class="last-sync music-update">🎵 Last music update: <button class=refresh-button>🔄 Refresh Now'),en=b("<span class=progress-percentage>%"),tn=b("<div class=progress-operation>"),nn=b("<span class=progress-initializing>"),sn=b("<span class=progress-items>"),on=b("<div class=horizontal-progress-container><div class=horizontal-progress-bar><div class=horizontal-progress-fill></div></div><div class=horizontal-progress-text>"),rn=b("<div class=progress-section><h3>📊 Sync Progress"),an=b("<div class=domain-status><h3>🎵 Music Domain Status</h3><div class=domain-grid><div><div class=domain-name>🎵 music</div><div class=domain-progress><div class=domain-progress-text>/<!> items</div><div class=domain-progress-bar><div class=domain-progress-fill></div></div><div class=domain-progress-percent>%"),ln=b("<div class=image-grid-section><h3>🖼️ Binary Data Image Grid (<!> images)</h3><div class=image-grid>"),cn=b("<div class=log-empty>No activity yet..."),dn=b(`<div><div class=demo-header><h2>🚀 Unified Sync System Demo</h2><div class=phase-info><span class=phase-badge>Phase 4: Unified UI Demo</span><span class=version-badge>v1.0.0</span></div></div><div class=connection-section><h3>🔗 Connection Status</h3><div class=connection-controls><div class=initialization-status><span></span></div></div></div><div class=feature-toggles><h3>⚙️ Feature Controls</h3><div class=toggle-controls><label class=toggle-control><input type=checkbox><span>🔧 Service Worker Background Sync</span></label><label class=toggle-control><input type=checkbox><span>🔄 Auto-Sync on Changes</span></label><label class=toggle-control><input type=checkbox><span>🐛 Debug Logging</span></label></div></div><div class=sync-controls><h3>🎯 Unified Sync Control</h3><div class=main-controls><button></button><button class=destroy-button title="Completely destroy all IndexedDB data (for testing)">💥 Destroy All Data</button></div></div><div class=storage-stats><h3>💾 Storage Usage</h3><div class=storage-display><div class=storage-item><span class=storage-label>Total:</span><span class=storage-value></span></div><div class=storage-breakdown><div class=storage-item><span class=storage-label>Music:</span><span class=storage-value></span></div><div class=storage-item><span class=storage-label>Binary Data:</span><span class=storage-value></span></div></div></div></div><div class=activity-log><h3>📋 Activity Log</h3><div class=log-container></div></div><div class=system-info><h3>ℹ️ System Information</h3><div class=info-grid><div class=info-item><span class=info-label>Sync Features:</span><span class=info-value></span></div><div class=info-item><span class=info-label>Client ID:</span><span class=info-value>...</span></div><div class=info-item><span class=info-label>API URL:</span><span class=info-value></span></div></div></div><style>
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

        .last-sync {
          color: #ccc;
          font-size: 13px;
          font-style: italic;
        }

        .music-update {
          color: #88c0ff;
          margin-top: 4px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .refresh-button {
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 2px 5px;
          font-size: 11px;
          cursor: pointer;
          margin-left: 8px;
        }

        .refresh-button:hover {
          background: #2563eb;
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
      `),gn=b("<span>🚀 Sync All Domains"),un=b("<div class=image-item><img class=grid-image>"),pn=b("<div class=log-entry>");function mn(D){const[k,me]=u(null),[fe,be]=u(null),[Y,Ge]=u(null),[fn,Ve]=u(null),[he,Xe]=u(null),[U,ye]=u(!1),[Z,xe]=u(R.Disconnected),[C,ve]=u(!1),[bn,F]=u(null),[j,G]=u({music:l.Never,photos:l.Never,documents:l.Never,videos:l.Never}),[W,V]=u({music:{status:l.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0},photos:{status:l.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0},documents:{status:l.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0},videos:{status:l.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0}}),[hn,ee]=u(l.Never),[y,K]=u({status:l.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"}),[te,Ye]=u(D.enableServiceWorker??!0),[Q,Ke]=u(D.enableAutoSync??!0),[Se,Qe]=u([]),[$,ne]=u(!1),[se,oe]=u(null),[ie,re]=u([]),[qe,$e]=u(0),[we,He]=u(!1),[Je,Ce]=u("Loading..."),[Ze,_e]=u("Loading..."),[et,ke]=u("Loading..."),o=e=>{const n=new Date().toLocaleTimeString();Qe(s=>[...s.slice(-9),`[${n}] ${e}`])},tt=()=>typeof crypto<"u"&&crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(e){const n=Math.random()*16|0;return(e=="x"?n:n&3|8).toString(16)}),Ie=()=>{const e=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;return D.clientId&&e.test(D.clientId)?D.clientId:tt()},Be=async()=>{try{o("🚀 Initializing Unified Sync System...");const e=D.apiBaseUrl||"http://localhost:8080",n=Ie();o(`📋 Client ID: ${n}`),o(`🌐 API Base URL: ${e}`);const s=new Wt({baseUrl:e});Ve(s);const p=e.replace("http","ws").replace("3001","8080")+"/ws",a=new Ot({url:p,autoReconnect:!0,reconnectDelay:3e3,debug:!0});Ge(a);const x=t=>{xe(t);const c=t===R.Connected;ye(c),o(`🔗 WebSocket status: ${t}`),console.log("🐛 WebSocket status change:",{status:t,isConnected:c,isInitialized:C()}),c?(F(null),console.log("🔌 WebSocket connected - forcing UI update")):t===R.Error&&F("WebSocket connection error")};a.on("statusChange",x),a.on("error",t=>{F(t.message),o(`❌ WebSocket error: ${t.message}`)}),a.on("rawMessage",t=>{console.log("🔍 Raw WebSocket message:",t),o(`📥 WS Raw: ${typeof t=="string"?t.substring(0,100):"[Binary data]"}...`),typeof t=="string"&&t.includes("Notification")&&o(`📥 WS Raw: ${t.substring(0,100)}...`)}),a.on("notification",t=>{if(console.log("📬 ALL WebSocket notifications received:",{channel:t.channel,event_type:t.event_type,payload:t.payload,priority:t.priority,timestamp:t.timestamp,fullData:t}),o(`📬 Notification: ${t.channel}/${t.event_type}`),t.channel==="MediaBlobs"&&(t.event_type==="song.created"||t.event_type==="song.updated"||t.event_type==="song.deleted")&&(console.log("🎵 SONG EVENT notification received:",t),o(`🎵 Song event: ${t.event_type}`)),t.channel==="MediaBlobs"&&t.event_type==="music.library.updated"||t.event_type==="scan_completed"||t.event_type==="song.created"){if(console.log("🎵 Music-related notification received:",t),Xe(new Date),t.event_type==="music.library.updated"||t.event_type==="scan_completed"){const c=t.payload?.songs_added??0,h=t.payload?.scan_name??"unknown";o(`🎵 Music library updated: ${c} songs added from scan "${h}"`)}else t.event_type==="song.created"&&o(`🎵 New song added: "${t.payload?.title??"Unknown"}" by ${t.payload?.artist??"Unknown"}`);Q()&&k()&&o("🔄 Auto-syncing music library after update...")}}),D.autoConnect!==!1&&(o("🔄 Auto-connecting WebSocket..."),a.connect()),o("⚙️ Setting up unified sync manager...");const{syncManager:m,autoSyncSystem:w}=await jt(a,s,{apiBaseUrl:e,clientId:n,enableUserNotifications:D.enableUserNotifications??!0,enableBackgroundSync:te()});me(m),be(w),console.log("🔍 Auto-sync system status:",{autoSyncSystem:w,status:w?.getStatus?.(),stats:w?.getStats?.(),pendingNotifications:w?.getPendingNotifications?.()}),nt(m),Q()&&(o("🔄 Enabling auto-sync..."),m.enableAutoSync(!0),w?.enable&&(console.log("🔄 Starting auto-sync system..."),await w.enable(),o("✅ Auto-sync system started")));try{const t=await m.getStorageStats();console.log("🐛 Initial storage stats:",t);const c={music:(t.itemCounts?.music||0)>0?l.Complete:l.Never,photos:(t.itemCounts?.photos||0)>0?l.Complete:l.Never,documents:(t.itemCounts?.documents||0)>0?l.Complete:l.Never,videos:(t.itemCounts?.videos||0)>0?l.Complete:l.Never},h={music:{status:c.music,progress:c.music===l.Complete?100:0,itemsProcessed:t.itemCounts?.music||0,totalItems:t.itemCounts?.music||0,currentBatch:1,totalBatches:1},photos:{status:c.photos,progress:c.photos===l.Complete?100:0,itemsProcessed:t.itemCounts?.photos||0,totalItems:t.itemCounts?.photos||0,currentBatch:1,totalBatches:1},documents:{status:c.documents,progress:c.documents===l.Complete?100:0,itemsProcessed:t.itemCounts?.documents||0,totalItems:t.itemCounts?.documents||0,currentBatch:1,totalBatches:1},videos:{status:c.videos,progress:c.videos===l.Complete?100:0,itemsProcessed:t.itemCounts?.videos||0,totalItems:t.itemCounts?.videos||0,currentBatch:1,totalBatches:1}};G(c),V(h),o(`📊 Initialized domain status: ${Object.values(c).filter(I=>I===l.Complete).length} domains with data`)}catch(t){console.warn("Could not initialize domain status:",t),G(m.getStatus()),V(m.getProgress()),o("📊 Using default domain status")}setTimeout(()=>{ze()},2e3),ve(!0),o("✅ Unified Sync System initialized successfully"),window.websocketClient=a,window.syncManager=m,window.autoSyncSystem=w,window.phase3System=w,window.isConnected=U(),window.syncStatus=j,window.syncProgress=W,window.lastSyncTime=se,window.refreshUIFromSyncManager=()=>{console.log("🔄 Refreshing UI from sync manager...");const t=m.getStatus(),c=m.getProgress();G(t),V(c),oe(new Date),console.log("✅ UI refreshed with:",{freshStatus:t,freshProgress:c})},o("🔧 Debug objects exposed to window");const O=a.getStatus();O===R.Connected&&!U()&&(ye(!0),F(null)),xe(O),console.log("🐛 State after initialization:",{isInitialized:!0,isConnected:U(),isSyncing:$()}),Re(()=>{const t=U(),c=C(),h=$();console.log("🔄 Button state check:",{connected:t,initialized:c,syncing:h,buttonEnabled:t&&c&&!h})}),o("✅ Unified Sync System initialized successfully")}catch(e){o(`❌ Initialization failed: ${e.message}`),F(e.message)}},nt=e=>{e.on(L.Started,n=>{o(`🔄 Sync started: ${n.domain||"all domains"}`),ne(!0),ee(l.InProgress)}),e.on(L.Progress,n=>{const s=n,p=e.getStatus(),a=e.getProgress();G(p),V(a),a[s.domain].totalItems>0&&console.log(`📊 ${s.domain}: ${a[s.domain].itemsProcessed}/${a[s.domain].totalItems} (${a[s.domain].progress}%)`);const x=Object.values(a),m=x.reduce((h,I)=>h+I.totalItems,0),w=x.reduce((h,I)=>h+I.itemsProcessed,0),O=x.reduce((h,I)=>h+I.totalBatches,0),t=x.reduce((h,I)=>h+I.currentBatch,0),c=m>0?Math.round(w/m*100):0;K({status:l.InProgress,progress:c,itemsProcessed:w,totalItems:m,currentBatch:t,totalBatches:O,eta:s.progress.eta,currentOperation:s.progress.currentOperation||`Syncing ${s.domain}`}),s.domain&&o(`📊 ${s.domain}: ${s.progress.itemsProcessed}/${s.progress.totalItems} items (${s.progress.progress}%)`)}),e.on(L.AllCompleted,n=>{const s=n;o(`✅ Sync completed: ${s.domain||"all domains"}`),ne(!1),oe(new Date),ee(l.Complete);const p=e.getStatus(),a=e.getProgress();G(p),V(a),console.log("🔄 UI updated after sync completion:",{finalStatus:p,finalProgressMap:a,lastSyncTime:new Date}),K({status:l.Complete,progress:100,itemsProcessed:y().itemsProcessed,totalItems:y().totalItems,currentBatch:y().totalBatches,totalBatches:y().totalBatches,eta:0,currentOperation:"Complete"}),s.result&&o(`📈 Stats: ${s.result.itemsSynced} items, ${Math.round(s.result.duration/1e3)}s`),$e(x=>x+1),setTimeout(()=>{ze()},1500),s.result&&s.result.binaryStats&&s.result.binaryStats.cached>0&&(o("🖼️ Binary sync completed, checking for images..."),setTimeout(()=>{ae()},2e3)),setTimeout(()=>{$()||K({status:l.Never,progress:0,itemsProcessed:0,totalItems:0,currentBatch:0,totalBatches:0,eta:0,currentOperation:"Ready"})},5e3)}),e.on(L.Failed,n=>{o(`❌ Sync failed: ${n.error.message}`),ne(!1),ee(l.Failed)}),e.on(L.AutoSyncTriggered,n=>{const s=n;o(`🔄 Auto-sync triggered for ${s.trigger}: ${s.domain}`)}),e.on(L.ConnectionChanged,n=>{o(`🔗 Connection ${n.isOnline?"established":"lost"}`)}),e.on(L.BinaryProgress,n=>{const s=n;if(s.currentItem&&s.totalItems){const p=s.currentItem,a=s.totalItems;o(`📁 Binary sync: ${p}/${a} files`),K({status:l.InProgress,progress:s.progress||0,itemsProcessed:p,totalItems:a,currentBatch:p,totalBatches:a,eta:0,currentOperation:`Downloading binary data (${p}/${a})`})}})},Pe=e=>{if(e===0)return"0 B";const n=1024,s=["B","KB","MB","GB"],p=Math.floor(Math.log(e)/Math.log(n));return Math.round(e/Math.pow(n,p)*100)/100+" "+s[p]},ze=async()=>{try{const e=k();if(!e){console.log("🐛 No sync manager available for storage stats");return}console.log("🐛 Calculating storage usage...");const n=await e.getStorageStats();console.log("🐛 Storage stats received:",n);const s={totalSize:n?.totalSize||0,itemCounts:n?.itemCounts||{music:0,photos:0,documents:0,videos:0},binarySize:n?.binarySize||0};console.log("🐛 Safe stats:",s);const p=Pe(s.totalSize),a=s.itemCounts.music,x=a>0?`${a} items`:"No data",m=Pe(s.binarySize);Ce(p),_e(x),ke(m),console.log("🐛 Updated storage stats:",{total:p,music:x,binary:m})}catch(e){console.error("Could not calculate storage usage:",e),Ce("Error"),_e("Error"),ke("Error")}},st=async()=>{const e=k();if(!(!e||$()))try{o("🚀 Starting unified sync for all domains...");const n=await e.syncAll({domains:["music","photos"],includeBinaryData:!0,forceFullSync:!1});o(`✨ Sync completed! Domain: ${n.domain}, Items: ${n.itemsSynced}/${n.totalItems}`)}catch(n){o(`❌ Sync failed: ${n.message}`)}},ot=async()=>{const e=!te();if(Ye(e),o(`🔧 Service Worker ${e?"enabled":"disabled"}`),k()&&fe()){const s=fe();s.setBackgroundSyncEnabled&&await s.setBackgroundSyncEnabled(e)}},it=async()=>{const e=!Q();Ke(e);const n=k();n&&(e?(o("🔄 Enabling auto-sync..."),n.enableAutoSync(!0)):(o("⏸️ Disabling auto-sync..."),n.enableAutoSync(!1)))},rt=async()=>{if(!(!k()||$()))try{o("💥 Starting complete database teardown..."),ve(!1),oe(null),re([]),$e(0),await k()?.destroy(),o("🗑️ Database completely destroyed!"),me(null),be(null),o("🔄 Reinitializing system..."),await Be(),o("✅ System reinitialized successfully!")}catch(n){o(`❌ Teardown failed: ${n.message}`),console.error("Destroy error:",n)}},ae=async()=>{const e=k();if(!(!e||!C()))try{const n=(await e.getMediaBlobs()).slice(0,100);if(n.length===0){re([]);return}o(`📷 Found ${n.length} image blobs, checking binary data...`);const s=[];let p=0;for(const a of n)try{if(await e.hasBinaryData(a.id)){p++;const m=await e.getBlobUrl(a.id);m&&s.push(m)}}catch{continue}s.length>0?(re(s),o(`🎨 Image grid loaded: ${s.length} images (${p} with binary data)`)):p===0&&n.length>0&&o(`📷 Found ${n.length} image metadata but no binary data yet`)}catch(n){o(`❌ Failed to load image grid: ${n.message}`)}};Re(()=>{const e=k(),n=C();if(qe(),e&&n){ae();const s=setInterval(()=>{ae()},3e3);setTimeout(()=>{clearInterval(s)},3e4)}});const at=()=>{const e=Y();e&&!U()&&(o("🔄 Connecting WebSocket..."),e.connect())},lt=()=>{const e=!we();He(e),e?(Gt(),o("🐛 Debug logging enabled")):(Vt(),o("🔇 Debug logging disabled"))},ct=()=>{const e=Y();e&&U()&&(o("🔌 Disconnecting WebSocket..."),e.disconnect())};Mt(()=>{Be()}),Tt(()=>{const e=Y(),n=k();e&&e.disconnect(),n&&n.destroy()});const le=()=>{const e=y();return{percentage:e.progress,itemsText:`${e.itemsProcessed}/${e.totalItems} items`,batchText:e.totalBatches>0?`Batch ${e.currentBatch}/${e.totalBatches}`:"",etaText:e.eta&&e.eta>0?`ETA: ${Math.round(e.eta)}s`:"",speedText:""}};return(()=>{var e=dn(),n=e.firstChild,s=n.nextSibling,p=s.firstChild,a=p.nextSibling,x=a.firstChild,m=x.firstChild,w=s.nextSibling,O=w.firstChild,t=O.nextSibling,c=t.firstChild,h=c.firstChild,I=c.nextSibling,ce=I.firstChild,dt=I.nextSibling,De=dt.firstChild,Ue=w.nextSibling,gt=Ue.firstChild,de=gt.nextSibling,X=de.firstChild,B=X.nextSibling,ge=Ue.nextSibling,ut=ge.firstChild,pt=ut.nextSibling,Ee=pt.firstChild,mt=Ee.firstChild,ft=mt.nextSibling,bt=Ee.nextSibling,Ne=bt.firstChild,ht=Ne.firstChild,yt=ht.nextSibling,xt=Ne.nextSibling,vt=xt.firstChild,St=vt.nextSibling,q=ge.nextSibling,$t=q.firstChild,Me=$t.nextSibling,wt=q.nextSibling,Ct=wt.firstChild,_t=Ct.nextSibling,Te=_t.firstChild,kt=Te.firstChild,It=kt.nextSibling,Ae=Te.nextSibling,Bt=Ae.firstChild,Le=Bt.nextSibling,Pt=Le.firstChild,zt=Ae.nextSibling,Dt=zt.firstChild,Ut=Dt.nextSibling;return r(a,f(S,{get when(){return Y()},get children(){return[f(Xt,{get status(){return Z()},showText:!0,compact:!0}),(()=>{var i=Qt();return r(i,f(S,{get when(){return!U()},get children(){var d=Yt();return d.$$click=at,r(d,()=>Z()===R.Connecting?"Connecting...":"Connect"),T(()=>d.disabled=Z()===R.Connecting),d}}),null),r(i,f(S,{get when(){return U()},get children(){var d=Kt();return d.$$click=ct,d}}),null),i})()]}}),x),r(m,()=>C()?"✅ Initialized":"⏳ Initializing..."),h.addEventListener("change",ot),ce.addEventListener("change",it),De.addEventListener("change",lt),r(t,f(S,{get when(){return D.enableUserNotifications!==!1},get children(){return qt()}}),null),X.$$click=()=>{console.log("🐛 Button click - Debug state:",{isInitialized:C(),isConnected:U(),isSyncing:$(),buttonDisabled:!C()||!U()||$()}),st()},r(X,f(S,{get when(){return $()},get fallback(){return gn()},get children(){return Ht()}})),B.$$click=rt,B.style.setProperty("background-color","#dc3545"),B.style.setProperty("color","white"),B.style.setProperty("border","none"),B.style.setProperty("padding","10px 20px"),B.style.setProperty("border-radius","5px"),B.style.setProperty("margin-left","10px"),r(de,f(S,{get when(){return se()},get children(){var i=Jt();return i.firstChild,r(i,()=>se()?.toLocaleTimeString(),null),i}}),null),r(de,f(S,{get when(){return he()},get children(){var i=Zt(),d=i.firstChild,P=d.nextSibling;return r(i,()=>he()?.toLocaleTimeString(),P),P.$$click=()=>{k()&&(o("🔄 Manually refreshing music after update"),k().syncDomain("music",{forceRefresh:!0}))},i}}),null),r(e,f(S,{get when(){return $()||y().totalItems>0},get children(){var i=rn();return i.firstChild,r(i,f(S,{get when(){return $()},get children(){var d=on(),P=d.firstChild,_=P.firstChild,E=P.nextSibling;return r(E,f(S,{get when(){return y().totalItems>0},get children(){var g=en(),v=g.firstChild;return r(g,()=>le().percentage,v),g}}),null),r(E,f(S,{get when(){return y().currentOperation},get children(){var g=tn();return r(g,()=>y().currentOperation),g}}),null),r(E,f(S,{get when(){return y().totalItems===0},get children(){var g=nn();return r(g,()=>y().currentOperation||(y().itemsProcessed>0?`Processing... (${y().itemsProcessed} items)`:"Initializing sync...")),g}}),null),r(E,f(S,{get when(){return y().totalItems>0},get children(){var g=sn();return r(g,()=>le().itemsText),g}}),null),T(g=>{var v=`${y().totalItems>0?le().percentage:Math.min(85,Math.max(10,y().itemsProcessed*.5))}%`,z=y().totalItems>0?"linear-gradient(90deg, #3b82f6, #1d4ed8)":"linear-gradient(90deg, #f59e0b, #d97706)";return v!==g.e&&((g.e=v)!=null?_.style.setProperty("width",v):_.style.removeProperty("width")),z!==g.t&&((g.t=z)!=null?_.style.setProperty("background",z):_.style.removeProperty("background")),g},{e:void 0,t:void 0}),d}}),null),i}}),ge),r(ft,Je),r(yt,Ze),r(St,et),r(e,f(S,{get when(){return At(()=>!!j().music)()&&W().music},get children(){var i=an(),d=i.firstChild,P=d.nextSibling,_=P.firstChild,E=_.firstChild,g=E.nextSibling,v=g.firstChild,z=v.firstChild,N=z.nextSibling;N.nextSibling;var M=v.nextSibling,H=M.firstChild,We=M.nextSibling,Et=We.firstChild;return r(_,f(Rt,{get status(){return j().music},compact:!0}),g),r(v,()=>W().music.itemsProcessed,z),r(v,()=>W().music.totalItems,N),r(We,()=>Math.round(W().music.progress),Et),T(A=>{var Oe=`domain-card ${j().music.toLowerCase()}`,ue=`${W().music.progress}%`,pe=j().music==="in_progress"?"#ff00ff":"#0f0";return Oe!==A.e&&J(_,A.e=Oe),ue!==A.t&&((A.t=ue)!=null?H.style.setProperty("width",ue):H.style.removeProperty("width")),pe!==A.a&&((A.a=pe)!=null?H.style.setProperty("background-color",pe):H.style.removeProperty("background-color")),A},{e:void 0,t:void 0,a:void 0}),i}}),q),r(e,f(S,{get when(){return ie().length>0},get children(){var i=ln(),d=i.firstChild,P=d.firstChild,_=P.nextSibling;_.nextSibling;var E=d.nextSibling;return r(d,()=>ie().length,_),r(E,f(Fe,{get each(){return ie()},children:(g,v)=>(()=>{var z=un(),N=z.firstChild;return N.addEventListener("error",M=>{console.log(`Failed to load image ${v()+1}:`,g),M.target.style.display="none"}),je(N,"src",g),T(()=>je(N,"alt",`Image ${v()+1}`)),z})()})),i}}),q),r(Me,f(Fe,{get each(){return Se().slice().reverse()},children:i=>(()=>{var d=pn();return r(d,i),d})()}),null),r(Me,f(S,{get when(){return Se().length===0},get children(){return cn()}}),null),r(It,()=>Object.entries(Ft).filter(([i,d])=>d).map(([i,d])=>i).join(", ")),r(Le,()=>Ie().slice(0,8),Pt),r(Ut,()=>D.apiBaseUrl||"http://localhost:8080"),T(i=>{var d=`unified-sync-demo ${D.className||""}`,P=`status-indicator ${C()?"success":"pending"}`,_=!C(),E=!C(),g=`sync-all-button ${$()?"syncing pulse":""}`,v=!C()||!U()||$(),z=!C()||$(),N=!C()||$()?"not-allowed":"pointer",M=!C()||$()?"0.5":"1";return d!==i.e&&J(e,i.e=d),P!==i.t&&J(m,i.t=P),_!==i.a&&(h.disabled=i.a=_),E!==i.o&&(ce.disabled=i.o=E),g!==i.i&&J(X,i.i=g),v!==i.n&&(X.disabled=i.n=v),z!==i.s&&(B.disabled=i.s=z),N!==i.h&&((i.h=N)!=null?B.style.setProperty("cursor",N):B.style.removeProperty("cursor")),M!==i.r&&((i.r=M)!=null?B.style.setProperty("opacity",M):B.style.removeProperty("opacity")),i},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0}),T(()=>h.checked=te()),T(()=>ce.checked=Q()),T(()=>De.checked=we()),e})()}Lt("unified-sync-demo",{apiBaseUrl:void 0,clientId:void 0,autoConnect:!0,enableServiceWorker:!0,enableAutoSync:!0,className:"",enableUserNotifications:!0},mn);Nt(["click"]);
//# sourceMappingURL=unified-sync-demo.js.map
