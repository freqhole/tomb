import{c as p,a as j,t as d,i as r,g as f,d as H,e as W,m as Y,S as m,f as ke,F as De}from"./web-DJKfNvYW.js";import{c as be}from"./index-DcpD9Y8U.js";import{C as l}from"./websocket-types-DZZ1YLNk.js";import{W as Me}from"./websocket-client-NNVZjhvd.js";import"./types-DAeLdoVX.js";var Ee=d("<span>"),Ue=d("<span class=user-count>(<!> user<!>)"),Be=d(`<div><style>
        .status-indicator {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1px solid rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
          position: relative;
        }

        .status-indicator.disconnected {
          background-color: #ef4444;
          box-shadow: 0 0 4px rgba(239, 68, 68, 0.3);
        }

        .status-indicator.connecting {
          background-color: #f59e0b;
          box-shadow: 0 0 4px rgba(245, 158, 11, 0.3);
          animation: pulse 1.5s infinite;
        }

        .status-indicator.connected {
          background-color: #10b981;
          box-shadow: 0 0 4px rgba(16, 185, 129, 0.3);
        }

        .status-indicator.error {
          background-color: #dc2626;
          box-shadow: 0 0 4px rgba(220, 38, 38, 0.5);
          animation: blink 1s infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }

        @keyframes blink {
          0%, 50% {
            opacity: 1;
          }
          51%, 100% {
            opacity: 0.3;
          }
        }

        .status-text {
          color: #374151;
          font-weight: 500;
        }

        .status-text.disconnected {
          color: #dc2626;
        }

        .status-text.connecting {
          color: #d97706;
        }

        .status-text.connected {
          color: #059669;
        }

        .status-text.error {
          color: #dc2626;
        }

        .user-count {
          color: #6b7280;
          font-size: 12px;
          margin-left: 4px;
        }
      </style><div>`);const ge=b=>{const[k,q]=p(Date.now()),y=()=>b.status??l.Disconnected,h=()=>b.showText??!0,D=()=>b.userCount??0,x=()=>b.showUserCount??!1,T=()=>b.compact??!1;j(()=>{const c=y();q(Date.now());const M=new CustomEvent("status-change",{detail:{status:c,timestamp:k()},bubbles:!0});setTimeout(()=>{const w=document.querySelector("websocket-status");w&&w.dispatchEvent(M)},0)});const N=()=>{switch(y()){case l.Disconnected:return"Offline";case l.Connecting:return"Connecting...";case l.Connected:return"Online";case l.Error:return"Connection Error";default:return"Unknown"}},R=()=>`status-indicator ${y()}`,U=()=>`status-text ${y()}`;return(()=>{var c=Be(),M=c.firstChild,w=M.nextSibling;return c.style.setProperty("display","inline-flex"),c.style.setProperty("align-items","center"),c.style.setProperty("gap","8px"),c.style.setProperty("font-family",'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'),c.style.setProperty("font-size","14px"),r(c,f(m,{get when(){return Y(()=>!!h())()&&!T()},get children(){var g=Ee();return r(g,N),H(()=>W(g,U())),g}}),null),r(c,f(m,{get when(){return Y(()=>!!(x()&&D()>0))()&&!T()},get children(){var g=Ue(),G=g.firstChild,B=G.nextSibling,z=B.nextSibling,_=z.nextSibling;return _.nextSibling,r(g,D,B),r(g,()=>D()!==1?"s":"",_),g}}),null),H(()=>W(w,R())),c})()};be("websocket-status",{status:l.Disconnected,showText:!0,userCount:0,showUserCount:!1,compact:!1},ge);var ze=d("<button>Disconnect"),Ae=d("<div class=error-message>"),Le=d("<div class=debug-log>"),Fe=d("<div class=upload-progress>"),Te=d('<div><div class=upload-controls><div class=file-input-wrapper><input type=file id=file-input class=file-input multiple><label for=file-input><svg class=upload-icon fill=none stroke=currentColor viewBox="0 0 24 24"><path stroke-linecap=round stroke-linejoin=round stroke-width=2 d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg></label></div><div class=upload-hint>'),Pe=d(`<div><style>
        .container {
          padding: 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #f9fafb;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .title {
          font-size: 18px;
          font-weight: 600;
          color: #111827;
        }

        .controls {
          display: flex;
          gap: 8px;
        }

        button {
          padding: 6px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: white;
          color: #374151;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        button:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        button.primary {
          background: #3b82f6;
          color: white;
          border-color: #3b82f6;
        }

        button.primary:hover {
          background: #2563eb;
          border-color: #2563eb;
        }

        .status-section {
          margin-bottom: 16px;
        }

        .debug-log {
          background: #1f2937;
          color: #f3f4f6;
          padding: 12px;
          border-radius: 6px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          max-height: 300px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .media-blobs {
          margin-top: 16px;
        }

        .media-blob {
          padding: 12px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          margin-bottom: 8px;
          background: white;
        }

        .media-blob-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .media-blob-id {
          font-family: monospace;
          font-size: 12px;
          color: #6b7280;
        }

        .media-blob-info {
          font-size: 14px;
          color: #374151;
        }

        .media-blob-meta {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        }

        .empty-state {
          text-align: center;
          color: #6b7280;
          font-style: italic;
          padding: 32px;
        }

        .error-message {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 16px;
        }

        .file-upload-section {
          margin-top: 16px;
          padding: 16px;
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          background: #f9fafb;
          transition: all 0.2s;
        }

        .file-upload-section.drag-over {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .file-upload-section.uploading {
          border-color: #10b981;
          background: #ecfdf5;
        }

        .upload-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .file-input-wrapper {
          position: relative;
          overflow: hidden;
          display: inline-block;
        }

        .file-input {
          position: absolute;
          left: -9999px;
          opacity: 0;
        }

        .file-input-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: #3b82f6;
          color: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.2s;
        }

        .file-input-label:hover {
          background: #2563eb;
        }

        .file-input-label:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }

        .upload-hint {
          color: #6b7280;
          font-size: 14px;
          text-align: center;
          margin: 8px 0;
        }

        .upload-progress {
          color: #374151;
          font-size: 14px;
          font-weight: 500;
          text-align: center;
          padding: 8px;
          background: #f3f4f6;
          border-radius: 4px;
          margin-top: 8px;
        }

        .upload-icon {
          display: inline-block;
          width: 16px;
          height: 16px;
        }
      </style><div class=container><div class=header><h2 class=title>WebSocket Handler</h2><div class=controls><button>Ping</button><button>Get Media Blobs</button></div></div><div class=status-section></div><div class=media-blobs><h3>Media Blobs (<!>)`),Oe=d("<button class=primary>Connect"),Ie=d('<div class=empty-state>No media blobs received yet. Click "Get Media Blobs" to fetch from server.'),je=d("<br>"),He=d("<div class=media-blob><div class=media-blob-header><div class=media-blob-id></div><div class=media-blob-info> • </div></div><div class=media-blob-meta>SHA256: <br>Client: <br>Path: <br>Created: ");const We=b=>{const k=()=>b.websocketUrl||"ws://localhost:3000/ws",q=()=>b.autoConnect!==!1,y=()=>b.showDebugLog||!1,[h,D]=p(null),[x,T]=p(l.Disconnected),[N,R]=p([]),[U,c]=p([]),[M,w]=p(""),[g,G]=p(0),[B,z]=p(!1),[_,Z]=p(!1),[ee,C]=p("");j(()=>{const e=q(),t=k();e&&t&&J()});const s=(e,...t)=>{const n=new Date().toLocaleTimeString(),a=t.length>0?`[${n}] ${e}: ${JSON.stringify(t,null,2)}`:`[${n}] ${e}`;R(A=>[...A.slice(-99),a]),console.log("[WebSocketHandler]",e,...t)},P=e=>{if(x()!==e){T(e),s(`Status changed to: ${e}`);const t=new CustomEvent("status-change",{detail:{status:e},bubbles:!0});setTimeout(()=>{const n=document.querySelector("websocket-handler");n&&n.dispatchEvent(t)},0)}},u=e=>{w(e),s(`Error: ${e}`)},te=()=>{w("")},J=()=>{k();const e=h();if(e&&e.getStatus()===l.Connected){s("Already connected");return}te(),P(l.Connecting),s(`Connecting to ${k()}`);try{const t=new Me({url:k(),autoReconnect:!0,debug:b.showDebugLog||!1});D(t),pe(t),t.connect()}catch(t){u(`Connection failed: ${t}`),P(l.Error)}},K=()=>{s("Disconnecting...");const e=h();e&&(e.disconnect(),D(null)),P(l.Disconnected)},pe=e=>{e.on("statusChange",t=>{s("Status changed to:",t),P(t),t===l.Connected&&te()}),e.on("welcome",t=>{s("Welcome received",t)}),e.on("mediaBlobs",t=>{s("Media blobs received:",{count:t.blobs.length,total_count:t.total_count}),c(t.blobs);const n=new CustomEvent("media-blobs-received",{detail:{blobs:t.blobs,totalCount:t.total_count},bubbles:!0});setTimeout(()=>{const a=document.querySelector("websocket-handler");a&&a.dispatchEvent(n)},0)}),e.on("mediaBlob",t=>{s("Single media blob received:",t.blob.id)}),e.on("error",t=>{s("Server error:",t.message),u(`Server error: ${t.message}`)}),e.on("connectionStatus",t=>{s("Connection status update:",t),G(t.user_count)}),e.on("parseError",t=>{s("Parse error:",t.message),u(`Message parse error: ${t.message}`)}),e.on("rawMessage",()=>{y()&&s("Raw message received")})},ne=()=>{const e=h();if(e){const t=e.ping();return t||u("Failed to send ping"),t}return u("Cannot ping: not connected"),!1},oe=(e,t)=>{const n=h();if(n){const a=n.getMediaBlobs(e,t);return a||u("Failed to request media blobs"),a}return u("Cannot get media blobs: not connected"),!1},fe=e=>{const t=h();if(t){const n=t.getMediaBlob(e);return n||u("Failed to request media blob"),n}return u("Cannot get media blob: not connected"),!1},re=e=>{const t=h();if(t){const n=t.uploadMediaBlob(e);return n?s("Sent UploadMediaBlob message",{blob_id:e.id,blob_size:e.size,blob_mime:e.mime,blob_sha256:e.sha256.substring(0,8)+"..."}):u("Failed to upload media blob"),n}return u("Cannot upload media blob: not connected"),!1},me=async e=>{const t=await e.arrayBuffer(),n=await crypto.subtle.digest("SHA-256",t);return Array.from(new Uint8Array(n)).map(A=>A.toString(16).padStart(2,"0")).join("")},he=async e=>{const t=await me(e),n=await e.arrayBuffer(),a=Array.from(new Uint8Array(n));return{id:crypto.randomUUID(),data:a,sha256:t,size:e.size,mime:e.type||"application/octet-stream",source_client_id:"web-component",local_path:e.name,blob_type:"original",metadata:{originalName:e.name,lastModified:e.lastModified,uploadedAt:new Date().toISOString()},created_at:new Date().toISOString(),updated_at:new Date().toISOString()}},Q=async e=>{if(e){Z(!0),C(`Preparing ${e.name}...`);try{s(`Starting upload for file: ${e.name} (${e.size} bytes)`),C("Calculating SHA256...");const t=await he(e);if(C("Uploading to server..."),s("Uploading blob:",{id:t.id,size:t.size,mime:t.mime,sha256:t.sha256.substring(0,8)+"..."}),re(t))C(`✅ ${e.name} uploaded successfully!`),s(`File upload successful: ${e.name}`),setTimeout(()=>C(""),3e3);else throw new Error("Failed to send upload message")}catch(t){const n=`Upload failed: ${t instanceof Error?t.message:String(t)}`;C(`❌ ${n}`),u(n),s("Upload error",t),setTimeout(()=>C(""),5e3)}finally{Z(!1)}}},xe=e=>{const t=e.target,n=t.files;n&&n.length>0&&Array.from(n).forEach(Q),t.value=""},ve=e=>{e.preventDefault(),z(!0)},$e=e=>{e.preventDefault(),z(!1)},ye=e=>{e.preventDefault(),z(!1);const t=e.dataTransfer?.files;t&&t.length>0&&Array.from(t).forEach(Q)},we=()=>{const e=document.querySelector("websocket-handler");e&&Object.assign(e,{ping:ne,getMediaBlobs:oe,getMediaBlob:fe,uploadMediaBlob:re,uploadFile:Q,connect:J,disconnect:K})};j(()=>{setTimeout(we,0)});const _e=e=>{if(!e)return"Unknown size";const t=["B","KB","MB","GB"];let n=e,a=0;for(;n>=1024&&a<t.length-1;)n/=1024,a++;return`${n.toFixed(1)} ${t[a]}`};return j(()=>K),(()=>{var e=Pe(),t=e.firstChild,n=t.nextSibling,a=n.firstChild,A=a.firstChild,se=A.nextSibling,V=se.firstChild,ae=V.nextSibling,ie=a.nextSibling,L=ie.nextSibling,le=L.firstChild,Ce=le.firstChild,ce=Ce.nextSibling;return ce.nextSibling,e.style.setProperty("display","block"),e.style.setProperty("font-family",'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'),V.$$click=ne,ae.$$click=()=>oe(),r(se,f(m,{get when(){return x()===l.Connected},get fallback(){return(()=>{var o=Oe();return o.$$click=J,o})()},get children(){var o=ze();return o.$$click=K,o}}),null),r(ie,()=>ge({status:x(),userCount:g(),showUserCount:!0,showText:!0,compact:!1})),r(n,f(m,{get when(){return M()},get children(){var o=Ae();return r(o,M),o}}),L),r(n,f(m,{get when(){return y()},get children(){var o=Le();return r(o,()=>N().join(`
`)),o}}),L),r(n,f(m,{get when(){return x()===l.Connected},get children(){var o=Te(),v=o.firstChild,$=v.firstChild,E=$.firstChild,S=E.nextSibling;S.firstChild;var X=$.nextSibling;return o.addEventListener("drop",ye),o.addEventListener("dragleave",$e),o.addEventListener("dragover",ve),E.addEventListener("change",xe),r(S,()=>_()?"Uploading...":"Choose Files",null),r(X,()=>B()?"Drop files here to upload":"Drag & drop files here or click to select"),r(v,f(m,{get when(){return ee()},get children(){var i=Fe();return r(i,ee),i}}),null),H(i=>{var O=`file-upload-section ${B()?"drag-over":""} ${_()?"uploading":""}`,F=_(),I=`file-input-label ${_()?"disabled":""}`;return O!==i.e&&W(o,i.e=O),F!==i.t&&(E.disabled=i.t=F),I!==i.a&&W(S,i.a=I),i},{e:void 0,t:void 0,a:void 0}),o}}),L),r(le,()=>U().length,ce),r(L,f(m,{get when(){return U().length>0},get fallback(){return Ie()},get children(){return f(De,{get each(){return U()},children:o=>(()=>{var v=He(),$=v.firstChild,E=$.firstChild,S=E.nextSibling,X=S.firstChild,i=$.nextSibling,O=i.firstChild,F=O.nextSibling,I=F.nextSibling,de=I.nextSibling,Se=de.nextSibling,ue=Se.nextSibling;return ue.nextSibling,r(E,()=>o.id),r(S,()=>o.mime||"Unknown type",X),r(S,()=>_e(o.size),null),r(i,()=>o.sha256,F),r(i,()=>o.source_client_id||"Unknown",de),r(i,()=>o.local_path||"None",ue),r(i,()=>new Date(o.created_at).toLocaleString(),null),r(i,f(m,{get when(){return Object.keys(o.metadata).length>0},get children(){return[je(),"Metadata: ",Y(()=>JSON.stringify(o.metadata))]}}),null),v})()})}}),null),H(o=>{var v=x()!==l.Connected,$=x()!==l.Connected;return v!==o.e&&(V.disabled=o.e=v),$!==o.t&&(ae.disabled=o.t=$),o},{e:void 0,t:void 0}),e})()};be("websocket-handler",{websocketUrl:"",autoConnect:!0,showDebugLog:!0},We);ke(["click"]);
//# sourceMappingURL=websocket-components.js.map
