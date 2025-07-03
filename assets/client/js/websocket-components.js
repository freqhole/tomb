import{d as we,c as u,g as T,t as d,k as r,i as g,S as h,b as oe,e as ne,F as Se,m as Ce}from"./web-WRO-G0Y6.js";import{c as ke}from"./index-CAM_Dine.js";import{W as Me}from"./websocket-status-CS8RKAia.js";import{C as c,W as Be}from"./websocket-client-CzcG2k5P.js";import"./types-DDODKsJP.js";var De=d("<button>Disconnect"),Ee=d("<div class=error-message>"),Ue=d("<div class=debug-log>"),ze=d("<div class=upload-progress>"),Ae=d('<div><div class=upload-controls><div class=file-input-wrapper><input type=file id=file-input class=file-input multiple><label for=file-input><svg class=upload-icon fill=none stroke=currentColor viewBox="0 0 24 24"><path stroke-linecap=round stroke-linejoin=round stroke-width=2 d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg></label></div><div class=upload-hint>'),Le=d(`<div><style>
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
      </style><div class=container><div class=header><h2 class=title>WebSocket Handler</h2><div class=controls><button>Ping</button><button>Get Media Blobs</button></div></div><div class=status-section></div><div class=media-blobs><h3>Media Blobs (<!>)`),Fe=d("<button class=primary>Connect"),Oe=d('<div class=empty-state>No media blobs received yet. Click "Get Media Blobs" to fetch from server.'),Te=d("<br>"),Ie=d("<div class=media-blob><div class=media-blob-header><div class=media-blob-id></div><div class=media-blob-info> • </div></div><div class=media-blob-meta>SHA256: <br>Client: <br>Path: <br>Created: ");const Pe=S=>{const C=()=>S.websocketUrl||"ws://localhost:3000/ws",re=()=>S.autoConnect!==!1,I=()=>S.showDebugLog||!1,[v,P]=u(null),[x,ie]=u(c.Disconnected),[ae,se]=u([]),[E,le]=u([]),[W,j]=u(""),[ce,de]=u(0),[H,U]=u(!1),[k,N]=u(!1),[q,f]=u("");T(()=>{const e=re(),t=C();e&&t&&z()});const i=(e,...t)=>{const o=new Date().toLocaleTimeString(),a=t.length>0?`[${o}] ${e}: ${JSON.stringify(t,null,2)}`:`[${o}] ${e}`;se(y=>[...y.slice(-99),a]),console.log("[WebSocketHandler]",e,...t)},M=e=>{if(x()!==e){ie(e),i(`Status changed to: ${e}`);const t=new CustomEvent("status-change",{detail:{status:e},bubbles:!0});setTimeout(()=>{const o=document.querySelector("websocket-handler");o&&o.dispatchEvent(t)},0)}},l=e=>{j(e),i(`Error: ${e}`)},R=()=>{j("")},z=()=>{C();const e=v();if(e&&e.getStatus()===c.Connected){i("Already connected");return}R(),M(c.Connecting),i(`Connecting to ${C()}`);try{const t=new Be({url:C(),autoReconnect:!0,debug:S.showDebugLog||!1});P(t),ue(t),t.connect()}catch(t){l(`Connection failed: ${t}`),M(c.Error)}},A=()=>{i("Disconnecting...");const e=v();e&&(e.disconnect(),P(null)),M(c.Disconnected)},ue=e=>{e.on("statusChange",t=>{i("Status changed to:",t),M(t),t===c.Connected&&R()}),e.on("welcome",t=>{i("Welcome received",t)}),e.on("mediaBlobs",t=>{i("Media blobs received:",{count:t.blobs.length,total_count:t.total_count}),le(t.blobs);const o=new CustomEvent("media-blobs-received",{detail:{blobs:t.blobs,totalCount:t.total_count},bubbles:!0});setTimeout(()=>{const a=document.querySelector("websocket-handler");a&&a.dispatchEvent(o)},0)}),e.on("mediaBlob",t=>{i("Single media blob received:",t.blob.id)}),e.on("error",t=>{i("Server error:",t.message),l(`Server error: ${t.message}`)}),e.on("connectionStatus",t=>{i("Connection status update:",t),de(t.user_count)}),e.on("parseError",t=>{i("Parse error:",t.message),l(`Message parse error: ${t.message}`)}),e.on("rawMessage",()=>{I()&&i("Raw message received")})},G=()=>{const e=v();if(e){const t=e.ping();return t||l("Failed to send ping"),t}return l("Cannot ping: not connected"),!1},J=(e,t)=>{const o=v();if(o){const a=o.getMediaBlobs(e,t);return a||l("Failed to request media blobs"),a}return l("Cannot get media blobs: not connected"),!1},be=e=>{const t=v();if(t){const o=t.getMediaBlob(e);return o||l("Failed to request media blob"),o}return l("Cannot get media blob: not connected"),!1},K=e=>{const t=v();if(t){const o=t.uploadMediaBlob(e);return o?i("Sent UploadMediaBlob message",{blob_id:e.id,blob_size:e.size,blob_mime:e.mime,blob_sha256:e.sha256.substring(0,8)+"..."}):l("Failed to upload media blob"),o}return l("Cannot upload media blob: not connected"),!1},pe=async e=>{const t=await e.arrayBuffer(),o=await crypto.subtle.digest("SHA-256",t);return Array.from(new Uint8Array(o)).map(y=>y.toString(16).padStart(2,"0")).join("")},ge=async e=>{const t=await pe(e),o=await e.arrayBuffer(),a=Array.from(new Uint8Array(o));return{id:crypto.randomUUID(),data:a,sha256:t,size:e.size,mime:e.type||"application/octet-stream",source_client_id:"web-component",local_path:e.name,blob_type:"original",metadata:{originalName:e.name,lastModified:e.lastModified,uploadedAt:new Date().toISOString()},created_at:new Date().toISOString(),updated_at:new Date().toISOString()}},L=async e=>{if(e){N(!0),f(`Preparing ${e.name}...`);try{i(`Starting upload for file: ${e.name} (${e.size} bytes)`),f("Calculating SHA256...");const t=await ge(e);if(f("Uploading to server..."),i("Uploading blob:",{id:t.id,size:t.size,mime:t.mime,sha256:t.sha256.substring(0,8)+"..."}),K(t))f(`✅ ${e.name} uploaded successfully!`),i(`File upload successful: ${e.name}`),setTimeout(()=>f(""),3e3);else throw new Error("Failed to send upload message")}catch(t){const o=`Upload failed: ${t instanceof Error?t.message:String(t)}`;f(`❌ ${o}`),l(o),i("Upload error",t),setTimeout(()=>f(""),5e3)}finally{N(!1)}}},fe=e=>{const t=e.target,o=t.files;o&&o.length>0&&Array.from(o).forEach(L),t.value=""},me=e=>{e.preventDefault(),U(!0)},he=e=>{e.preventDefault(),U(!1)},ve=e=>{e.preventDefault(),U(!1);const t=e.dataTransfer?.files;t&&t.length>0&&Array.from(t).forEach(L)},xe=()=>{const e=document.querySelector("websocket-handler");e&&Object.assign(e,{ping:G,getMediaBlobs:J,getMediaBlob:be,uploadMediaBlob:K,uploadFile:L,connect:z,disconnect:A})};T(()=>{setTimeout(xe,0)});const $e=e=>{if(!e)return"Unknown size";const t=["B","KB","MB","GB"];let o=e,a=0;for(;o>=1024&&a<t.length-1;)o/=1024,a++;return`${o.toFixed(1)} ${t[a]}`};return T(()=>A),(()=>{var e=Le(),t=e.firstChild,o=t.nextSibling,a=o.firstChild,y=a.firstChild,Q=y.nextSibling,F=Q.firstChild,V=F.nextSibling,X=a.nextSibling,_=X.nextSibling,Y=_.firstChild,ye=Y.firstChild,Z=ye.nextSibling;return Z.nextSibling,e.style.setProperty("display","block"),e.style.setProperty("font-family",'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'),F.$$click=G,V.$$click=()=>J(),r(Q,g(h,{get when(){return x()===c.Connected},get fallback(){return(()=>{var n=Fe();return n.$$click=z,n})()},get children(){var n=De();return n.$$click=A,n}}),null),r(X,()=>Me({status:x(),userCount:ce(),showUserCount:!0,showText:!0,compact:!1})),r(o,g(h,{get when(){return W()},get children(){var n=Ee();return r(n,W),n}}),_),r(o,g(h,{get when(){return I()},get children(){var n=Ue();return r(n,()=>ae().join(`
`)),n}}),_),r(o,g(h,{get when(){return x()===c.Connected},get children(){var n=Ae(),b=n.firstChild,p=b.firstChild,$=p.firstChild,m=$.nextSibling;m.firstChild;var O=p.nextSibling;return n.addEventListener("drop",ve),n.addEventListener("dragleave",he),n.addEventListener("dragover",me),$.addEventListener("change",fe),r(m,()=>k()?"Uploading...":"Choose Files",null),r(O,()=>H()?"Drop files here to upload":"Drag & drop files here or click to select"),r(b,g(h,{get when(){return q()},get children(){var s=ze();return r(s,q),s}}),null),oe(s=>{var B=`file-upload-section ${H()?"drag-over":""} ${k()?"uploading":""}`,w=k(),D=`file-input-label ${k()?"disabled":""}`;return B!==s.e&&ne(n,s.e=B),w!==s.t&&($.disabled=s.t=w),D!==s.a&&ne(m,s.a=D),s},{e:void 0,t:void 0,a:void 0}),n}}),_),r(Y,()=>E().length,Z),r(_,g(h,{get when(){return E().length>0},get fallback(){return Oe()},get children(){return g(Se,{get each(){return E()},children:n=>(()=>{var b=Ie(),p=b.firstChild,$=p.firstChild,m=$.nextSibling,O=m.firstChild,s=p.nextSibling,B=s.firstChild,w=B.nextSibling,D=w.nextSibling,ee=D.nextSibling,_e=ee.nextSibling,te=_e.nextSibling;return te.nextSibling,r($,()=>n.id),r(m,()=>n.mime||"Unknown type",O),r(m,()=>$e(n.size),null),r(s,()=>n.sha256,w),r(s,()=>n.source_client_id||"Unknown",ee),r(s,()=>n.local_path||"None",te),r(s,()=>new Date(n.created_at).toLocaleString(),null),r(s,g(h,{get when(){return Object.keys(n.metadata).length>0},get children(){return[Te(),"Metadata: ",Ce(()=>JSON.stringify(n.metadata))]}}),null),b})()})}}),null),oe(n=>{var b=x()!==c.Connected,p=x()!==c.Connected;return b!==n.e&&(F.disabled=n.e=b),p!==n.t&&(V.disabled=n.t=p),n},{e:void 0,t:void 0}),e})()};ke("websocket-handler",{websocketUrl:"",autoConnect:!0,showDebugLog:!0},Pe);we(["click"]);
//# sourceMappingURL=websocket-components.js.map
