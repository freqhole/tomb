import"./webauthn-auth.js";import"./websocket-components.js";import{F as ge,W as me}from"./websocket-demo.js";import"./websocket-feed-demo.js";import{c as fe,d as ce,a as y,o as he,b as ue,t as v,i as o,e as P,f as j,S as M,m as be,g as G,r as ve,h as ye,u as xe,F as $e,s as we}from"./types-DHjY8jnN.js";import{C as T}from"./websocket-types-BKbG2VtF.js";import"./api-client-B8dKKbm7.js";import"./sync-demo.js";import"./websocket-client-CdmpF5ya.js";var ke=v("<div class=section-header><h3 class=section-title>Connection</h3><div>"),Se=v('<div class=controls><button class="control-button primary">Connect</button><button class="control-button danger">Disconnect</button><button class=control-button>Refresh</button><div>Subscribed: '),_e=v("<div><h3 class=section-title>Feed Statistics</h3><div class=stats-grid><div class=stat-card><div class=stat-value></div><div class=stat-label>Items Loaded</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Total Available</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Last Updated</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Subscriptions"),Ce=v("<div><h3 class=section-title>Selected Item</h3><div class=selected-item><div class=selected-item-title></div><div class=selected-item-details>ID: <!> • Type: <!> • Size: "),Pe=v("<div>⚠️ "),Ue=v("<div class=logs-container>"),ze=v(`<div><style>
        .websocket-feed-demo-v2 .controls {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .websocket-feed-demo-v2 .control-button {
          padding: 8px 16px;
          border-radius: 6px;
          border: 1px solid #d1d5db;
          background-color: #ffffff;
          color: #374151;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .websocket-feed-demo-v2 .control-button:hover {
          background-color: #f9fafb;
          border-color: #9ca3af;
        }

        .websocket-feed-demo-v2 .control-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .websocket-feed-demo-v2 .control-button.primary {
          background-color: #3b82f6;
          color: #ffffff;
          border-color: #3b82f6;
        }

        .websocket-feed-demo-v2 .control-button.primary:hover {
          background-color: #2563eb;
          border-color: #2563eb;
        }

        .websocket-feed-demo-v2 .control-button.danger {
          background-color: #ef4444;
          color: #ffffff;
          border-color: #ef4444;
        }

        .websocket-feed-demo-v2 .control-button.danger:hover {
          background-color: #dc2626;
          border-color: #dc2626;
        }

        .websocket-feed-demo-v2 .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
        }

        .websocket-feed-demo-v2 .stat-card {
          padding: 12px;
          border-radius: 8px;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          text-align: center;
        }

        .websocket-feed-demo-v2 .stat-value {
          font-size: 20px;
          font-weight: 600;
          color: #111827;
          margin-bottom: 4px;
        }

        .websocket-feed-demo-v2 .stat-label {
          font-size: 12px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .websocket-feed-demo-v2 .logs-container {
          max-height: 200px;
          overflow-y: auto;
          background-color: #1f2937;
          color: #f9fafb;
          padding: 12px;
          border-radius: 6px;
          font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
          font-size: 12px;
          line-height: 1.4;
        }

        .websocket-feed-demo-v2 .logs-container::-webkit-scrollbar {
          width: 6px;
        }

        .websocket-feed-demo-v2 .logs-container::-webkit-scrollbar-track {
          background: #374151;
        }

        .websocket-feed-demo-v2 .logs-container::-webkit-scrollbar-thumb {
          background: #6b7280;
          border-radius: 3px;
        }

        .websocket-feed-demo-v2 .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 0 0 8px 0;
        }

        .websocket-feed-demo-v2 .section-title {
          font-size: 16px;
          font-weight: 600;
          color: #111827;
          margin: 0;
        }

        .websocket-feed-demo-v2 .toggle-button {
          background: none;
          border: none;
          color: #3b82f6;
          cursor: pointer;
          font-size: 12px;
          text-decoration: underline;
        }

        .websocket-feed-demo-v2 .selected-item {
          padding: 12px;
          border-radius: 8px;
          background-color: #eff6ff;
          border: 1px solid #bfdbfe;
        }

        .websocket-feed-demo-v2 .selected-item-title {
          font-weight: 500;
          color: #1e40af;
          margin: 0 0 4px 0;
        }

        .websocket-feed-demo-v2 .selected-item-details {
          font-size: 12px;
          color: #3730a3;
        }
      </style><div><h2>🔄 WebSocket Feed Demo V2</h2><p>Real-time media blob feed powered by reusable hooks and components</p></div><div><h3 class=section-title>Live Feed</h3><div><p>Feed component will be integrated once TypeScript issues are resolved.</p><p>Items: <!> | Connected: </p><p>Selected: </p></div></div><div><div class=section-header><h3 class=section-title>Activity Log</h3><div><button class=toggle-button></button><button class=toggle-button>Clear`),Fe=v("<div>No activity yet..."),De=v("<div>");function Le(b){const[U,$]=y([]),[k]=y(null),[z,O]=y(!1),ee=()=>b.showControls!==!1,te=()=>b.showStats!==!1,[oe]=y([]),[R]=y(!1),[re]=y(T.Disconnected),[N]=y([]),[_]=y(0),[Y]=y(null),[q]=y(null),[J]=y(!1),d={state:()=>({items:oe(),isConnected:R(),connectionStatus:re(),subscribedChannels:N(),totalCount:_(),lastUpdated:Y(),error:q(),isLoading:J()}),actions:{connect:()=>x("Connect not implemented yet"),disconnect:()=>x("Disconnect not implemented yet"),refresh:()=>x("Refresh not implemented yet")}},x=e=>{const s=new Date().toLocaleTimeString();$(t=>[...t.slice(-19),`[${s}] ${e}`])},se=()=>{x("🔌 Connecting..."),d.actions.connect()},le=()=>{x("🔌 Disconnecting..."),d.actions.disconnect()},ne=()=>{x("🔄 Refreshing..."),d.actions.refresh()},ie=()=>{$([])},ae=e=>{switch(e){case T.Connected:return"🟢 Connected";case T.Connecting:return"🟡 Connecting";case T.Disconnected:return"🔴 Disconnected";case T.Error:return"❌ Error";default:return"⚪ Unknown"}},W=e=>{switch(e){case T.Connected:return"#10b981";case T.Connecting:return"#f59e0b";case T.Disconnected:return"#6b7280";case T.Error:return"#ef4444";default:return"#9ca3af"}},de=()=>{const e=d.state();e.isConnected?x("🔌 Connected"):e.connectionStatus===T.Connecting?x("🔌 Connecting..."):e.connectionStatus===T.Disconnected&&x("🔌 Disconnected"),e.items.length>0&&e.lastUpdated&&Date.now()-e.lastUpdated.getTime()<1e3&&x(`📦 Feed updated: ${e.items.length} items`),e.error&&x(`❌ Error: ${e.error}`)};return he(()=>{x("🚀 Feed demo v2 initialized"),setInterval(de,1e3)}),ue(()=>{x("🧹 Feed demo v2 cleanup")}),(()=>{var e=ze(),s=e.firstChild,t=s.nextSibling,r=t.firstChild,c=r.nextSibling,p=t.nextSibling,V=p.firstChild,H=V.nextSibling,Q=H.firstChild,F=Q.nextSibling,X=F.firstChild,i=X.nextSibling;i.nextSibling;var n=F.nextSibling;n.firstChild;var u=p.nextSibling,D=u.firstChild,C=D.firstChild,L=C.nextSibling,A=L.firstChild,B=A.nextSibling;return e.style.setProperty("display","flex"),e.style.setProperty("flex-direction","column"),e.style.setProperty("gap","16px"),e.style.setProperty("padding","20px"),e.style.setProperty("border-radius","12px"),e.style.setProperty("background-color","#ffffff"),e.style.setProperty("border","1px solid #e2e8f0"),e.style.setProperty("box-shadow","0 1px 3px rgba(0, 0, 0, 0.1)"),e.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),e.style.setProperty("max-width","800px"),e.style.setProperty("margin","0 auto"),t.style.setProperty("text-align","center"),r.style.setProperty("margin","0 0 8px 0"),r.style.setProperty("color","#111827"),r.style.setProperty("font-size","24px"),c.style.setProperty("margin","0"),c.style.setProperty("color","#6b7280"),c.style.setProperty("font-size","14px"),o(e,P(M,{get when(){return ee()},get children(){return[(()=>{var l=ke(),g=l.firstChild,a=g.nextSibling;return a.style.setProperty("display","flex"),a.style.setProperty("align-items","center"),a.style.setProperty("gap","12px"),a.style.setProperty("padding","6px 12px"),a.style.setProperty("border-radius","20px"),a.style.setProperty("font-size","12px"),a.style.setProperty("font-weight","500"),o(a,()=>ae(d.state().connectionStatus)),j(m=>{var f=W(d.state().connectionStatus)+"20",h=W(d.state().connectionStatus);return f!==m.e&&((m.e=f)!=null?a.style.setProperty("background-color",f):a.style.removeProperty("background-color")),h!==m.t&&((m.t=h)!=null?a.style.setProperty("color",h):a.style.removeProperty("color")),m},{e:void 0,t:void 0}),l})(),(()=>{var l=Se(),g=l.firstChild,a=g.nextSibling,m=a.nextSibling,f=m.nextSibling;return f.firstChild,g.$$click=se,a.$$click=le,m.$$click=ne,f.style.setProperty("margin-left","auto"),f.style.setProperty("font-size","12px"),f.style.setProperty("color","#6b7280"),o(f,()=>d.state().subscribedChannels.join(", ")||"None",null),j(h=>{var S=d.state().isConnected,E=!d.state().isConnected,I=!d.state().isConnected;return S!==h.e&&(g.disabled=h.e=S),E!==h.t&&(a.disabled=h.t=E),I!==h.a&&(m.disabled=h.a=I),h},{e:void 0,t:void 0,a:void 0}),l})()]}}),p),o(e,P(M,{get when(){return te()},get children(){var l=_e(),g=l.firstChild,a=g.nextSibling,m=a.firstChild,f=m.firstChild,h=m.nextSibling,S=h.firstChild,E=h.nextSibling,I=E.firstChild,w=E.nextSibling,Z=w.firstChild;return o(f,()=>d.state().items.length),o(S,()=>d.state().totalCount),o(I,(()=>{var K=be(()=>!!d.state().lastUpdated);return()=>K()?d.state().lastUpdated.toLocaleTimeString():"Never"})()),o(Z,()=>d.state().subscribedChannels.length),l}}),p),o(e,P(M,{get when(){return k()},get children(){var l=Ce(),g=l.firstChild,a=g.nextSibling,m=a.firstChild,f=m.nextSibling,h=f.firstChild,S=h.nextSibling,E=S.nextSibling,I=E.nextSibling;return I.nextSibling,o(m,()=>k().local_path?.split("/").pop()||`${k().sha256.slice(0,8)}...${k().sha256.slice(-4)}`),o(f,()=>k().id,S),o(f,()=>k().mime||"Unknown",I),o(f,(()=>{var w=be(()=>!!k().size);return()=>w()?`${(k().size/1024).toFixed(1)} KB`:"Unknown"})(),null),l}}),p),o(e,P(M,{get when(){return d.state().error},get children(){var l=Pe();return l.firstChild,l.style.setProperty("padding","12px"),l.style.setProperty("border-radius","6px"),l.style.setProperty("background-color","#fee2e2"),l.style.setProperty("color","#991b1b"),l.style.setProperty("border","1px solid #fecaca"),l.style.setProperty("font-size","14px"),o(l,()=>d.state().error,null),l}}),p),H.style.setProperty("padding","20px"),H.style.setProperty("border","1px solid #e2e8f0"),H.style.setProperty("border-radius","8px"),H.style.setProperty("text-align","center"),H.style.setProperty("color","#6b7280"),o(F,()=>d.state().items.length,i),o(F,()=>d.state().isConnected?"Yes":"No",null),o(n,()=>k()?.id.slice(0,8)||"None",null),A.$$click=()=>O(!z()),o(A,()=>z()?"Hide":"Show"),B.$$click=ie,B.style.setProperty("margin-left","8px"),o(u,P(M,{get when(){return z()},get children(){var l=Ue();return o(l,P(M,{get when(){return U().length>0},get fallback(){return(()=>{var g=Fe();return g.style.setProperty("color","#9ca3af"),g.style.setProperty("font-style","italic"),g})()},get children(){return U().map(g=>(()=>{var a=De();return a.style.setProperty("margin-bottom","2px"),o(a,g),a})())}})),l}}),null),j(()=>G(e,`websocket-feed-demo-v2 ${b.className||""}`)),e})()}fe("websocket-feed-demo-v2",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,itemMode:"default",maxHeight:"400px",showControls:!0,showStats:!0,className:""},Le);ce(["click"]);var Te=v("<div><h2>Simple Solid.js Test</h2><p>Count: </p><button>Increment");console.log("🚀 Script started loading");function Ee(){console.log("📦 SimpleTest component created");const[b,U]=y(0);return(()=>{var $=Te(),k=$.firstChild,z=k.nextSibling;z.firstChild;var O=z.nextSibling;return $.style.setProperty("padding","20px"),$.style.setProperty("border","1px solid #ccc"),$.style.setProperty("margin","20px"),o(z,b,null),O.$$click=()=>U(b()+1),$})()}class Ie extends HTMLElement{dispose;connectedCallback(){console.log("🔌 SimpleTestElement connected");try{this.dispose=ve(()=>P(Ee,{}),this),console.log("✅ Render successful")}catch(U){console.error("❌ Render failed:",U)}}disconnectedCallback(){console.log("🔌 SimpleTestElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register custom element");try{customElements.define("simple-test",Ie),console.log("✅ Custom element registered successfully")}catch(b){console.error("❌ Failed to register custom element:",b)}ce(["click"]);var Me=v("<div class=upload-list>"),He=v("<div class=controls><button class=control-button>Clear Completed</button><span> total, <!> completed"),Re=v("<div class=threshold-info><strong>Upload Routing:</strong><br>• Files &lt; <!>: WebSocket (stored in database)<br>• Files ≥ <!>: HTTP API (stored on disk, admin only)"),We=v(`<div class=smart-file-upload><style>
        .smart-file-upload {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-width: 600px;
        }

        .upload-zone {
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #fafafa;
        }

        .upload-zone:hover,
        .upload-zone.drag-over {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .upload-zone.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }

        .upload-button {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .upload-button:hover:not(:disabled) {
          background: #2563eb;
        }

        .upload-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .upload-list {
          margin-top: 1.5rem;
        }

        .upload-item {
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 1rem;
          margin-bottom: 0.75rem;
          background: white;
        }

        .upload-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }

        .upload-info {
          flex: 1;
        }

        .upload-filename {
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.25rem;
        }

        .upload-details {
          font-size: 0.875rem;
          color: #6b7280;
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .upload-method {
          background: #f3f4f6;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .upload-method.websocket {
          background: #dbeafe;
          color: #1e40af;
        }

        .upload-method.http {
          background: #d1fae5;
          color: #065f46;
        }

        .upload-progress {
          margin-top: 0.75rem;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: #f3f4f6;
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: #3b82f6;
          transition: width 0.3s ease;
        }

        .progress-fill.completed {
          background: #10b981;
        }

        .progress-fill.error {
          background: #ef4444;
        }

        .upload-status {
          margin-top: 0.5rem;
          font-size: 0.875rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .status-text {
          font-weight: 500;
        }

        .status-text.completed {
          color: #059669;
        }

        .status-text.error {
          color: #dc2626;
        }

        .status-text.uploading {
          color: #2563eb;
        }

        .upload-actions {
          display: flex;
          gap: 0.5rem;
        }

        .action-button {
          background: none;
          border: 1px solid #d1d5db;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .action-button:hover {
          background: #f9fafb;
        }

        .action-button.retry {
          border-color: #3b82f6;
          color: #3b82f6;
        }

        .action-button.remove {
          border-color: #ef4444;
          color: #ef4444;
        }

        .controls {
          margin-top: 1rem;
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .control-button {
          background: #f9fafb;
          border: 1px solid #d1d5db;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .control-button:hover {
          background: #f3f4f6;
        }

        .threshold-info {
          margin-top: 1rem;
          padding: 0.75rem;
          background: #f8fafc;
          border-radius: 6px;
          font-size: 0.875rem;
          color: #64748b;
        }

        .hidden {
          display: none;
        }
      </style><div><div>📁</div><div>Drop files here or click to browse</div><div>Small files (&lt;<!>) use WebSocket, large files use HTTP API</div><button class=upload-button>Select Files</button></div><input type=file class=hidden>`),Ae=v('<button class="action-button retry">Retry'),Be=v('<div class=upload-progress><div class=progress-bar><div></div></div><div class=upload-status><span></span><div class=upload-actions><button class="action-button remove">Remove'),Ne=v("<div class=upload-item><div class=upload-header><div class=upload-info><div class=upload-filename></div><div class=upload-details><span></span><span></span><span>");const je=b=>{const[U,$]=y([]),[k,z]=y(!1),[O,ee]=y(null),[te,oe]=y(null),R=()=>b.sizeThreshold||10*1024*1024,re=()=>b.baseUrl||window.location.origin;let N;ye(()=>{const e=new ge({baseUrl:re(),minFileSize:R(),maxFileSize:1073741824});e.addEventListener("upload-progress",t=>{const{uploadId:r,stage:c,progress:p,error:V}=t.detail;_(r,p,c==="error"?"error":"uploading",V?.message)}),ee(e);const s=new me({maxFileSize:R()});s.addEventListener("upload-processed",t=>{const{uploadId:r,blob:c}=t.detail;b.websocketConnection?b.websocketConnection.uploadMediaBlob(c)?_(r,100,"completed"):_(r,0,"error","Failed to send via WebSocket"):_(r,0,"error","WebSocket not connected")}),s.addEventListener("upload-error",t=>{const{uploadId:r,error:c}=t.detail;_(r,0,"error",c)}),oe(s),ue(()=>{e.cancelAllUploads(),s.destroy()})});const _=(e,s,t,r)=>{$(c=>c.map(p=>p.id===e?{...p,progress:s,status:t,error:r}:p))},Y=async e=>{const s=Array.from(e),t=[];for(const r of s){const c=crypto.randomUUID(),p=r.size>=R()?"http":"websocket";t.push({id:c,file:r,method:p,status:"pending",progress:0})}$(r=>[...r,...t]);for(const r of t)r.method==="http"?q(r):J(r)},q=async e=>{const s=O();if(s){_(e.id,0,"uploading");try{const t=await s.uploadFile(e.file,{uploadedVia:"smart-file-upload",originalMethod:"http"});_(e.id,100,"completed"),$(r=>r.map(c=>c.id===e.id?{...c,result:t}:c))}catch(t){const r=t instanceof Error?t.message:String(t);_(e.id,0,"error",r)}}},J=async e=>{const s=te();if(s){_(e.id,0,"uploading");try{await s.addFiles([e.file])}catch(t){const r=t instanceof Error?t.message:String(t);_(e.id,0,"error",r)}}},d=e=>{$(s=>s.filter(t=>t.id!==e))},x=()=>{$(e=>e.filter(s=>s.status!=="completed"))},se=e=>{e.method==="http"?q(e):J(e)},le=e=>{const s=e.target;s.files&&s.files.length>0&&(Y(s.files),s.value="")},ne=e=>{e.preventDefault(),z(!0)},ie=e=>{e.preventDefault(),z(!1)},ae=e=>{e.preventDefault(),z(!1),e.dataTransfer?.files&&Y(e.dataTransfer.files)},W=e=>{if(!e)return"0 B";const s=["B","KB","MB","GB"];let t=e,r=0;for(;t>=1024&&r<s.length-1;)t/=1024,r++;return`${t.toFixed(1)} ${s[r]}`},de=e=>e==="websocket"?"WebSocket":"HTTP API";return(()=>{var e=We(),s=e.firstChild,t=s.nextSibling,r=t.firstChild,c=r.nextSibling,p=c.nextSibling,V=p.firstChild,H=V.nextSibling;H.nextSibling;var Q=p.nextSibling,F=t.nextSibling;t.addEventListener("drop",ae),t.addEventListener("dragleave",ie),t.addEventListener("dragover",ne),t.$$click=()=>!b.disabled&&N?.click(),r.style.setProperty("margin-bottom","1rem"),r.style.setProperty("font-size","2rem"),c.style.setProperty("margin-bottom","0.5rem"),c.style.setProperty("font-weight","500"),c.style.setProperty("color","#374151"),p.style.setProperty("font-size","0.875rem"),p.style.setProperty("color","#6b7280"),p.style.setProperty("margin-bottom","1rem"),o(p,()=>W(R()),H),Q.$$click=i=>{i.stopPropagation(),N?.click()},F.addEventListener("change",le);var X=N;return typeof X=="function"?xe(X,F):N=F,o(e,P(M,{get when(){return U().length>0},get children(){return[(()=>{var i=Me();return o(i,P($e,{get each(){return U()},children:n=>(()=>{var u=Ne(),D=u.firstChild,C=D.firstChild,L=C.firstChild,A=L.nextSibling,B=A.firstChild,l=B.nextSibling,g=l.nextSibling;return o(L,()=>n.file.name),o(B,()=>W(n.file.size)),o(l,()=>n.file.type||"Unknown type"),o(g,()=>de(n.method)),o(u,P(M,{get when(){return n.status!=="pending"},get children(){var a=Be(),m=a.firstChild,f=m.firstChild,h=m.nextSibling,S=h.firstChild,E=S.nextSibling,I=E.firstChild;return o(S,()=>n.status==="uploading"&&`Uploading... ${n.progress}%`,null),o(S,()=>n.status==="completed"&&"✅ Upload completed",null),o(S,()=>n.status==="error"&&`❌ ${n.error||"Upload failed"}`,null),o(E,P(M,{get when(){return n.status==="error"},get children(){var w=Ae();return w.$$click=()=>se(n),w}}),I),I.$$click=()=>d(n.id),j(w=>{var Z=`progress-fill ${n.status}`,K=`${n.progress}%`,pe=`status-text ${n.status}`;return Z!==w.e&&G(f,w.e=Z),K!==w.t&&((w.t=K)!=null?f.style.setProperty("width",K):f.style.removeProperty("width")),pe!==w.a&&G(S,w.a=pe),w},{e:void 0,t:void 0,a:void 0}),a}}),null),j(()=>G(g,`upload-method ${n.method}`)),u})()})),i})(),(()=>{var i=He(),n=i.firstChild,u=n.nextSibling,D=u.firstChild,C=D.nextSibling;return C.nextSibling,n.$$click=x,u.style.setProperty("font-size","0.875rem"),u.style.setProperty("color","#6b7280"),u.style.setProperty("align-self","center"),o(u,()=>U().length,D),o(u,()=>U().filter(L=>L.status==="completed").length,C),i})()]}}),null),o(e,P(M,{get when(){return b.showDebug},get children(){var i=Re(),n=i.firstChild,u=n.nextSibling,D=u.nextSibling,C=D.nextSibling,L=C.nextSibling,A=L.nextSibling,B=A.nextSibling,l=B.nextSibling;return l.nextSibling,o(i,()=>W(R()),C),o(i,()=>W(R()),l),i}}),null),j(i=>{var n=`upload-zone ${k()?"drag-over":""} ${b.disabled?"disabled":""}`,u=b.disabled,D=b.multiple!==!1,C=b.accept,L=b.disabled;return n!==i.e&&G(t,i.e=n),u!==i.t&&(Q.disabled=i.t=u),D!==i.a&&(F.multiple=i.a=D),C!==i.o&&we(F,"accept",i.o=C),L!==i.i&&(F.disabled=i.i=L),i},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),e})()};fe("smart-file-upload",{baseUrl:void 0,websocketConnection:void 0,sizeThreshold:10*1024*1024,showDebug:!1,multiple:!0,accept:void 0,disabled:!1},je);ce(["click"]);console.log("🧩 Web Components Library loaded - Available components:",["webauthn-auth","websocket-handler","websocket-status","websocket-demo","websocket-feed-manager","websocket-feed-demo","websocket-feed-demo-v2","media-blob-feed-item","media-blob-feed-list","simple-test","smart-file-upload","sync-status","sync-progress","sync-controls","sync-demo"]);
//# sourceMappingURL=all-components.js.map
