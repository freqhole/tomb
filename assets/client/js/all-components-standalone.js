import"./webauthn-auth.js";import"./websocket-components.js";import{F as pe,W as ue}from"./websocket-demo.js";import"./websocket-feed-demo.js";import{d as X,r as fe,c as S,a as _,t as v,i,b as be,e as me,o as ge,u as he,F as ve,S as P,f as W,g as F,s as ye}from"./types-Bv8JCg1W.js";import"./api-client-BsRePUpg.js";import"./websocket-types-Dt_hrJq4.js";import"./sync-demo.js";import"./websocket-client-CXdLnJCR.js";var $e=v("<div><h2>Simple Solid.js Test</h2><p>Count: </p><button>Increment");console.log("🚀 Script started loading");function xe(){console.log("📦 SimpleTest component created");const[a,h]=_(0);return(()=>{var p=$e(),E=p.firstChild,y=E.nextSibling;y.firstChild;var T=y.nextSibling;return p.style.setProperty("padding","20px"),p.style.setProperty("border","1px solid #ccc"),p.style.setProperty("margin","20px"),i(y,a,null),T.$$click=()=>h(a()+1),p})()}class Se extends HTMLElement{dispose;connectedCallback(){console.log("🔌 SimpleTestElement connected");try{this.dispose=fe(()=>S(xe,{}),this),console.log("✅ Render successful")}catch(h){console.error("❌ Render failed:",h)}}disconnectedCallback(){console.log("🔌 SimpleTestElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register custom element");try{customElements.define("simple-test",Se),console.log("✅ Custom element registered successfully")}catch(a){console.error("❌ Failed to register custom element:",a)}X(["click"]);var ke=v("<div class=upload-list>"),we=v("<div class=controls><button class=control-button>Clear Completed</button><span> total, <!> completed"),_e=v("<div class=threshold-info><strong>Upload Routing:</strong><br>• Files &lt; <!>: WebSocket (stored in database)<br>• Files ≥ <!>: HTTP API (stored on disk, admin only)"),Ce=v(`<div class=smart-file-upload><style>
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
      </style><div><div>📁</div><div>Drop files here or click to browse</div><div>Small files (&lt;<!>) use WebSocket, large files use HTTP API</div><button class=upload-button>Select Files</button></div><input type=file class=hidden>`),Ue=v('<button class="action-button retry">Retry'),ze=v('<div class=upload-progress><div class=progress-bar><div></div></div><div class=upload-status><span></span><div class=upload-actions><button class="action-button remove">Remove'),Pe=v("<div class=upload-item><div class=upload-header><div class=upload-info><div class=upload-filename></div><div class=upload-details><span></span><span></span><span>");const Fe=a=>{const[h,p]=_([]),[E,y]=_(!1),[T,Y]=_(null),[Z,ee]=_(null),$=()=>a.sizeThreshold||10*1024*1024,te=()=>a.baseUrl||window.location.origin;let C;me(()=>{const e=new pe({baseUrl:te(),minFileSize:$(),maxFileSize:1073741824});e.addEventListener("upload-progress",t=>{const{uploadId:r,stage:n,progress:d,error:I}=t.detail;u(r,d,n==="error"?"error":"uploading",I?.message)}),Y(e);const o=new ue({maxFileSize:$()});o.addEventListener("upload-processed",t=>{const{uploadId:r,blob:n}=t.detail;a.websocketConnection?a.websocketConnection.uploadMediaBlob(n)?u(r,100,"completed"):u(r,0,"error","Failed to send via WebSocket"):u(r,0,"error","WebSocket not connected")}),o.addEventListener("upload-error",t=>{const{uploadId:r,error:n}=t.detail;u(r,0,"error",n)}),ee(o),ge(()=>{e.cancelAllUploads(),o.destroy()})});const u=(e,o,t,r)=>{p(n=>n.map(d=>d.id===e?{...d,progress:o,status:t,error:r}:d))},A=async e=>{const o=Array.from(e),t=[];for(const r of o){const n=crypto.randomUUID(),d=r.size>=$()?"http":"websocket";t.push({id:n,file:r,method:d,status:"pending",progress:0})}p(r=>[...r,...t]);for(const r of t)r.method==="http"?M(r):B(r)},M=async e=>{const o=T();if(o){u(e.id,0,"uploading");try{const t=await o.uploadFile(e.file,{uploadedVia:"smart-file-upload",originalMethod:"http"});u(e.id,100,"completed"),p(r=>r.map(n=>n.id===e.id?{...n,result:t}:n))}catch(t){const r=t instanceof Error?t.message:String(t);u(e.id,0,"error",r)}}},B=async e=>{const o=Z();if(o){u(e.id,0,"uploading");try{await o.addFiles([e.file])}catch(t){const r=t instanceof Error?t.message:String(t);u(e.id,0,"error",r)}}},re=e=>{p(o=>o.filter(t=>t.id!==e))},oe=()=>{p(e=>e.filter(o=>o.status!=="completed"))},le=e=>{e.method==="http"?M(e):B(e)},se=e=>{const o=e.target;o.files&&o.files.length>0&&(A(o.files),o.value="")},ne=e=>{e.preventDefault(),y(!0)},ie=e=>{e.preventDefault(),y(!1)},ae=e=>{e.preventDefault(),y(!1),e.dataTransfer?.files&&A(e.dataTransfer.files)},U=e=>{if(!e)return"0 B";const o=["B","KB","MB","GB"];let t=e,r=0;for(;t>=1024&&r<o.length-1;)t/=1024,r++;return`${t.toFixed(1)} ${o[r]}`},de=e=>e==="websocket"?"WebSocket":"HTTP API";return(()=>{var e=Ce(),o=e.firstChild,t=o.nextSibling,r=t.firstChild,n=r.nextSibling,d=n.nextSibling,I=d.firstChild,R=I.nextSibling;R.nextSibling;var j=d.nextSibling,x=t.nextSibling;t.addEventListener("drop",ae),t.addEventListener("dragleave",ie),t.addEventListener("dragover",ne),t.$$click=()=>!a.disabled&&C?.click(),r.style.setProperty("margin-bottom","1rem"),r.style.setProperty("font-size","2rem"),n.style.setProperty("margin-bottom","0.5rem"),n.style.setProperty("font-weight","500"),n.style.setProperty("color","#374151"),d.style.setProperty("font-size","0.875rem"),d.style.setProperty("color","#6b7280"),d.style.setProperty("margin-bottom","1rem"),i(d,()=>U($()),R),j.$$click=s=>{s.stopPropagation(),C?.click()},x.addEventListener("change",se);var O=C;return typeof O=="function"?he(O,x):C=x,i(e,S(P,{get when(){return h().length>0},get children(){return[(()=>{var s=ke();return i(s,S(ve,{get each(){return h()},children:l=>(()=>{var c=Pe(),m=c.firstChild,f=m.firstChild,g=f.firstChild,D=g.nextSibling,z=D.firstChild,k=z.nextSibling,G=k.nextSibling;return i(g,()=>l.file.name),i(z,()=>U(l.file.size)),i(k,()=>l.file.type||"Unknown type"),i(G,()=>de(l.method)),i(c,S(P,{get when(){return l.status!=="pending"},get children(){var K=ze(),N=K.firstChild,L=N.firstChild,ce=N.nextSibling,w=ce.firstChild,V=w.nextSibling,q=V.firstChild;return i(w,()=>l.status==="uploading"&&`Uploading... ${l.progress}%`,null),i(w,()=>l.status==="completed"&&"✅ Upload completed",null),i(w,()=>l.status==="error"&&`❌ ${l.error||"Upload failed"}`,null),i(V,S(P,{get when(){return l.status==="error"},get children(){var b=Ue();return b.$$click=()=>le(l),b}}),q),q.$$click=()=>re(l.id),W(b=>{var J=`progress-fill ${l.status}`,H=`${l.progress}%`,Q=`status-text ${l.status}`;return J!==b.e&&F(L,b.e=J),H!==b.t&&((b.t=H)!=null?L.style.setProperty("width",H):L.style.removeProperty("width")),Q!==b.a&&F(w,b.a=Q),b},{e:void 0,t:void 0,a:void 0}),K}}),null),W(()=>F(G,`upload-method ${l.method}`)),c})()})),s})(),(()=>{var s=we(),l=s.firstChild,c=l.nextSibling,m=c.firstChild,f=m.nextSibling;return f.nextSibling,l.$$click=oe,c.style.setProperty("font-size","0.875rem"),c.style.setProperty("color","#6b7280"),c.style.setProperty("align-self","center"),i(c,()=>h().length,m),i(c,()=>h().filter(g=>g.status==="completed").length,f),s})()]}}),null),i(e,S(P,{get when(){return a.showDebug},get children(){var s=_e(),l=s.firstChild,c=l.nextSibling,m=c.nextSibling,f=m.nextSibling,g=f.nextSibling,D=g.nextSibling,z=D.nextSibling,k=z.nextSibling;return k.nextSibling,i(s,()=>U($()),f),i(s,()=>U($()),k),s}}),null),W(s=>{var l=`upload-zone ${E()?"drag-over":""} ${a.disabled?"disabled":""}`,c=a.disabled,m=a.multiple!==!1,f=a.accept,g=a.disabled;return l!==s.e&&F(t,s.e=l),c!==s.t&&(j.disabled=s.t=c),m!==s.a&&(x.multiple=s.a=m),f!==s.o&&ye(x,"accept",s.o=f),g!==s.i&&(x.disabled=s.i=g),s},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),e})()};be("smart-file-upload",{baseUrl:void 0,websocketConnection:void 0,sizeThreshold:10*1024*1024,showDebug:!1,multiple:!0,accept:void 0,disabled:!1},Fe);X(["click"]);console.log("🧩 Web Components Library loaded - Available components:",["webauthn-auth","websocket-handler","websocket-status","websocket-demo","websocket-feed-manager","websocket-feed-demo","media-blob-feed-item","media-blob-feed-list","simple-test","smart-file-upload","sync-status","sync-progress","sync-controls","sync-demo"]);
//# sourceMappingURL=all-components.js.map
