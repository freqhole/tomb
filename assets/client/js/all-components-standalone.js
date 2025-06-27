import"./webauthn-auth.js";import"./websocket-components.js";import{F as $e,W as _e}from"./websocket-demo.js";import{c as Z,a as A,b as X,o as Se,d as he,t as h,u as pe,e as I,f as H,g as ee,i as a,h as x,S as C,s as K,m as q,j as ye,k as ke,F as ve,r as Ce}from"./types-wRdBRQEO.js";import{W as Pe}from"./websocket-client-BpSX01Hi.js";import{C as Q}from"./websocket-types-XBFnEd9_.js";import"./websocket-feed-demo.js";import"./api-client-q37DKoc9.js";import"./sync-demo.js";var ze=h("<div>");function Ue(o){const[f,y]=A(null),[_,v]=A({items:[],isLoading:!1,isConnected:!1,connectionStatus:Q.Disconnected,subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),F=()=>o.wsUrl||"ws://localhost:8080/ws",[T,S]=A(["MediaBlobs"]);X(()=>{const t=o.channels;if(!t||Array.isArray(t)&&t.length===0){S(["MediaBlobs"]);return}if(Array.isArray(t)){S(t);return}if(typeof t=="string")try{const e=JSON.parse(t);Array.isArray(e)?S(e):S(["MediaBlobs"])}catch(e){w("Failed to parse channels prop, using default:",e),S(["MediaBlobs"])}else S(["MediaBlobs"])});const E=()=>T(),M=()=>o.debug||!1,j=()=>o.pageSize||20,w=(...t)=>{M()&&console.log("[WebSocketFeedManager]",...t)},m=(...t)=>{M()},k=t=>{v(e=>({...e,...t}))},R=t=>{v(e=>({...e,items:[t,...e.items],totalCount:e.totalCount+1,lastUpdated:new Date})),m("Added new feed item:",t.id)},D=t=>{v(e=>({...e,items:e.items.map(i=>i.id===t.id?t:i),lastUpdated:new Date})),m("Updated feed item:",t.id)},O=t=>{v(e=>({...e,items:e.items.filter(i=>i.id!==t),totalCount:Math.max(0,e.totalCount-1),lastUpdated:new Date})),m("Removed feed item:",t)},c=()=>{const t=f();t&&(k({isLoading:!0,error:null}),m("Loading initial feed..."),t.getMediaBlobs(j(),0)||k({isLoading:!1,error:"Failed to request initial feed data"}))},P=()=>{const t=f();if(!t)return;const e=_();m("Unsubscribing from channels:",e.subscribedChannels),e.subscribedChannels.forEach(i=>{t.unsubscribeFromNotifications(i)||m("Failed to unsubscribe from channel:",i)})},$=()=>{const t=new Pe({url:F(),autoReconnect:!0,reconnectDelay:3e3,maxReconnectAttempts:0,debug:M()});return t.on("statusChange",e=>{if(w("Connection status changed:",e),k({connectionStatus:e,isConnected:e===Q.Connected}),e===Q.Connected){c();const i=_().subscribedChannels,s=E().filter(d=>!i.includes(d));s.length>0&&s.forEach(d=>{t.subscribeToNotifications(d)})}else e===Q.Disconnected&&k({subscribedChannels:[]})}),t.on("welcome",e=>{m("Connected to WebSocket:",e),k({error:null})}),t.on("mediaBlobs",e=>{w("Loaded",e.blobs.length,"media blobs"),k({items:e.blobs,totalCount:e.total_count,isLoading:!1,lastUpdated:new Date,error:null})}),t.on("mediaBlob",e=>{m("Received single media blob:",e.blob.id),D(e.blob)}),t.on("notification",e=>{if(m("Received notification:",e),e.channel==="MediaBlobs")switch(e.event_type){case"media_blob.created":e.payload&&e.payload.media_blob&&(w("📦 New media blob:",e.payload.media_blob.id.slice(0,8)),R(e.payload.media_blob));break;case"media_blob.updated":e.payload&&e.payload.media_blob&&(m("Updated media blob:",e.payload.media_blob.id),D(e.payload.media_blob));break;case"media_blob.deleted":e.payload&&e.payload.media_blob_id&&(w("🗑️ Deleted media blob:",e.payload.media_blob_id.slice(0,8)),O(e.payload.media_blob_id));break;default:m("Unknown media blob event:",e.event_type)}}),t.on("notificationSubscribed",e=>{m("Subscribed to channel:",e.channel),v(i=>({...i,subscribedChannels:i.subscribedChannels.includes(e.channel)?i.subscribedChannels:[...i.subscribedChannels,e.channel]}))}),t.on("notificationUnsubscribed",e=>{m("Unsubscribed from channel:",e.channel),v(i=>({...i,subscribedChannels:i.subscribedChannels.filter(s=>s!==e.channel)}))}),t.on("notificationStatus",e=>{m("Notification status:",e),k({subscribedChannels:e.subscribed_channels})}),t.on("error",e=>{w("❌ WebSocket error:",e.message),k({error:e.message})}),t.on("parseError",e=>{w("❌ Parse error:",e.message),k({error:`Parse error: ${e.message}`})}),y(t),t},b=()=>{const t=f();t&&t.connect()},n=()=>{const t=f();t&&(P(),t.disconnect())},r={connect:b,disconnect:n,refresh:()=>{f()&&_().isConnected&&c()},getFeedState:()=>_(),getClient:()=>f()};return Se(()=>{w("Initializing WebSocket feed manager");const t=$();o.autoConnect!==!1&&t.connect()}),he(()=>{w("Cleaning up WebSocket feed manager"),n()}),X(()=>{const t=E(),e=_().subscribedChannels,i=f();if(i&&_().isConnected){const s=e.filter(u=>!t.includes(u)),d=t.filter(u=>!e.includes(u));(s.length>0||d.length>0)&&(s.forEach(u=>{i.unsubscribeFromNotifications(u)}),d.forEach(u=>{i.subscribeToNotifications(u)}))}}),(()=>{var t=ze();return pe(e=>{const i=e.closest("websocket-feed-manager");i?(i.feedManager=r,m("Feed manager methods exposed on custom element")):m("Could not find custom element parent")},t),t.style.setProperty("display","none"),I(()=>H(t,`websocket-feed-manager ${o.className||""}`)),t})()}Z("websocket-feed-manager",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,pageSize:20,className:""},Ue);var Me=h("<img>"),Fe=h("<div class=thumbnail-container>"),Te=h("<div class=metadata-item><span>📏</span><span>"),Ie=h("<div class=metadata-item><span>📱</span><span>..."),Ee=h("<div class=metadata><div class=metadata-item><span></span><span>"),De=h("<span>Added <!> • Updated "),ge=h("<div>"),Le=h(`<div><style>
        .media-blob-feed-item.clickable:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transform: translateY(-1px);
        }

        .media-blob-feed-item .thumbnail-container {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          overflow: hidden;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .media-blob-feed-item .thumbnail-loading {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: .5;
          }
        }

        .media-blob-feed-item .metadata {
          font-size: 12px;
          color: #6b7280;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .media-blob-feed-item .metadata-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .media-blob-feed-item.compact .content {
          flex: 1;
          min-width: 0;
        }

        .media-blob-feed-item .title {
          font-weight: 500;
          color: #111827;
          margin: 0 0 4px 0;
          font-size: 14px;
          word-break: break-all;
        }

        .media-blob-feed-item.compact .title {
          font-size: 13px;
          margin: 0 0 2px 0;
        }
      </style><div class=content><h3 class=title>`),Be=h("<span>Added ");function we(o){const[f,y]=A({loading:!0,error:!1,url:null}),_=()=>o.showThumbnail!==!1,v=()=>o.showMetadata!==!1,F=()=>o.showTimestamps!==!1,T=()=>o.compact||!1,S=()=>o.clickable!==!1,E=()=>o.thumbnailSize||120,M=()=>o.showLoadingPlaceholder!==!1,j=c=>{if(!c)return"Unknown size";const P=["B","KB","MB","GB"];let $=0,b=c;for(;b>=1024&&$<P.length-1;)b/=1024,$++;return`${b.toFixed($>0?1:0)} ${P[$]}`},w=c=>{try{const P=new Date(c),b=new Date().getTime()-P.getTime(),n=Math.floor(b/(1e3*60)),l=Math.floor(n/60),r=Math.floor(l/24);return n<1?"Just now":n<60?`${n}m ago`:l<24?`${l}h ago`:r<7?`${r}d ago`:P.toLocaleDateString()}catch{return"Unknown time"}},m=c=>c?c.startsWith("image/")?"🖼️":c.startsWith("video/")?"🎬":c.startsWith("audio/")?"🎵":c.includes("pdf")?"📋":c.includes("text")?"📝":"📄":"📄",k=async()=>{if(_()){y({loading:!0,error:!1,url:null});try{const c=`/api/v1/media_blobs/${o.blob.id}/thumbnail`;(await fetch(c,{method:"HEAD",credentials:"include"})).ok?y({loading:!1,error:!1,url:c}):y({loading:!1,error:!1,url:null})}catch(c){console.warn("Failed to load thumbnail for",o.blob.id,c),y({loading:!1,error:!0,url:null})}}},R=()=>{if(!S())return;const c=new CustomEvent("media-blob-click",{detail:{blob:o.blob},bubbles:!0});document.querySelector(`[data-blob-id="${o.blob.id}"]`)?.dispatchEvent(c)},D=()=>{y(c=>({...c,loading:!1}))},O=()=>{y(c=>({...c,loading:!1,error:!0}))};return X(()=>{o.blob?.id&&k()}),(()=>{var c=Le(),P=c.firstChild,$=P.nextSibling,b=$.firstChild;return c.$$click=R,a(c,x(C,{get when(){return _()},get children(){var n=Fe();return a(n,x(C,{get when(){return q(()=>!f().loading)()&&f().url},get fallback(){return(()=>{var l=ge();return l.style.setProperty("width","100%"),l.style.setProperty("height","100%"),l.style.setProperty("display","flex"),l.style.setProperty("align-items","center"),l.style.setProperty("justify-content","center"),l.style.setProperty("color","#9ca3af"),a(l,(()=>{var r=q(()=>!!f().loading);return()=>r()?"⏳":m(o.blob.mime)})()),I(r=>{var t=`thumbnail-placeholder ${f().loading&&M()?"thumbnail-loading":""}`,e=T()?"24px":"32px";return t!==r.e&&H(l,r.e=t),e!==r.t&&((r.t=e)!=null?l.style.setProperty("font-size",e):l.style.removeProperty("font-size")),r},{e:void 0,t:void 0}),l})()},get children(){var l=Me();return l.addEventListener("error",O),l.addEventListener("load",D),l.style.setProperty("width","100%"),l.style.setProperty("height","100%"),l.style.setProperty("object-fit","cover"),I(r=>{var t=f().url,e=`Thumbnail for ${o.blob.sha256.slice(0,8)}`;return t!==r.e&&K(l,"src",r.e=t),e!==r.t&&K(l,"alt",r.t=e),r},{e:void 0,t:void 0}),l}})),I(l=>{var r=`${E()}px`,t=`${E()}px`,e=`${E()}px`,i=`${E()}px`;return r!==l.e&&((l.e=r)!=null?n.style.setProperty("width",r):n.style.removeProperty("width")),t!==l.t&&((l.t=t)!=null?n.style.setProperty("height",t):n.style.removeProperty("height")),e!==l.a&&((l.a=e)!=null?n.style.setProperty("min-width",e):n.style.removeProperty("min-width")),i!==l.o&&((l.o=i)!=null?n.style.setProperty("min-height",i):n.style.removeProperty("min-height")),l},{e:void 0,t:void 0,a:void 0,o:void 0}),n}}),$),$.style.setProperty("min-width","0"),a(b,()=>o.blob.local_path?.split("/").pop()||`${o.blob.sha256.slice(0,8)}...${o.blob.sha256.slice(-4)}`),a($,x(C,{get when(){return v()},get children(){var n=Ee(),l=n.firstChild,r=l.firstChild,t=r.nextSibling;return a(r,()=>m(o.blob.mime)),a(t,()=>o.blob.mime||"Unknown type"),a(n,x(C,{get when(){return o.blob.size},get children(){var e=Te(),i=e.firstChild,s=i.nextSibling;return a(s,()=>j(o.blob.size)),e}}),null),a(n,x(C,{get when(){return o.blob.source_client_id},get children(){var e=Ie(),i=e.firstChild,s=i.nextSibling,d=s.firstChild;return a(s,()=>o.blob.source_client_id?.slice(0,8),d),I(()=>K(s,"title",o.blob.source_client_id)),e}}),null),n}}),null),a($,x(C,{get when(){return F()},get children(){var n=ge();return n.style.setProperty("margin-top","4px"),n.style.setProperty("font-size","11px"),n.style.setProperty("color","#9ca3af"),a(n,x(C,{get when(){return o.blob.created_at!==o.blob.updated_at},get fallback(){return(()=>{var l=Be();return l.firstChild,a(l,()=>w(o.blob.created_at),null),l})()},get children(){var l=De(),r=l.firstChild,t=r.nextSibling;return t.nextSibling,a(l,()=>w(o.blob.created_at),t),a(l,()=>w(o.blob.updated_at),null),l}})),n}}),null),I(n=>{var l=`media-blob-feed-item ${T()?"compact":""} ${S()?"clickable":""} ${o.className||""}`,r=o.blob.id,t={display:"flex","flex-direction":T()?"row":"column",gap:T()?"12px":"8px",padding:T()?"8px":"12px",border:"1px solid #e2e8f0","border-radius":"8px","background-color":"#ffffff",cursor:S()?"pointer":"default",transition:"all 0.2s ease",...S()&&{":hover":{"box-shadow":"0 2px 8px rgba(0, 0, 0, 0.1)",transform:"translateY(-1px)"}}},e=T()?"1":"auto";return l!==n.e&&H(c,n.e=l),r!==n.t&&K(c,"data-blob-id",n.t=r),n.a=ye(c,t,n.a),e!==n.o&&((n.o=e)!=null?$.style.setProperty("flex",e):$.style.removeProperty("flex")),n},{e:void 0,t:void 0,a:void 0,o:void 0}),c})()}Z("media-blob-feed-item",{blob:{},showThumbnail:!0,showMetadata:!0,showTimestamps:!0,compact:!1,clickable:!0,className:"",thumbnailSize:120,showLoadingPlaceholder:!0},we);ee(["click"]);var Ae=h("<div class=header><div>Feed</div><div>"),We=h("<div class=loading-indicator><div class=loading-spinner>⏳</div><div>Loading feed..."),Ne=h("<div class=error-state><div>⚠️</div><div>Failed to load feed</div><div>"),He=h("<div class=empty-state><div class=empty-icon>📭</div><div></div><div>New items will appear here automatically"),Re=h("<div class=feed-container>"),je=h(`<div><style>
        @keyframes feed-item-appear {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .media-blob-feed-list .loading-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          color: #6b7280;
        }

        .media-blob-feed-list .loading-spinner {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          font-size: 24px;
          margin-right: 12px;
        }

        .media-blob-feed-list .error-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
          color: #ef4444;
        }

        .media-blob-feed-list .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          text-align: center;
          color: #6b7280;
        }

        .media-blob-feed-list .empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .media-blob-feed-list .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          background-color: #f9fafb;
          font-size: 14px;
          color: #374151;
        }

        .media-blob-feed-list .feed-container {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar {
          width: 8px;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar-track {
          background: #f1f5f9;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }

        .media-blob-feed-list .feed-item {
          margin-bottom: 8px;
          opacity: 0;
          animation: feed-item-appear 300ms ease-out forwards;
        }

        .media-blob-feed-list .feed-item:last-child {
          margin-bottom: 0;
        }

        .media-blob-feed-list .feed-item.selected {
          transform: scale(1.02);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
          border-color: #3b82f6;
        }
      `),Oe=h("<div>");function Ye(o){const[f,y]=A({selectedItemId:null,lastUpdated:null}),_=()=>o.items||[],v=()=>o.loading||!1,F=()=>o.error||null,T=()=>o.emptyMessage||"No items in feed",S=()=>o.maxHeight||"auto",E=()=>o.itemMode||"default",M=()=>o.showThumbnails!==!1,j=()=>o.showMetadata!==!1,w=()=>o.showTimestamps!==!1,m=()=>o.clickableItems!==!1,k=()=>o.thumbnailSize||120,R=()=>o.showItemCount!==!1,D=()=>o.animationDuration||300,O=ke(()=>[..._()].sort((b,n)=>{const l=new Date(b.created_at).getTime();return new Date(n.created_at).getTime()-l})),c=b=>{const{blob:n}=b.detail;y(r=>({...r,selectedItemId:n.id===r.selectedItemId?null:n.id}));const l=new CustomEvent("feed-item-selected",{detail:{blob:n,isSelected:n.id!==f().selectedItemId},bubbles:!0});b.target?.dispatchEvent(l)},P=b=>D()<=0?{}:{"animation-delay":`${b*50}ms`,"animation-duration":`${D()}ms`,"animation-fill-mode":"both","animation-name":"feed-item-appear"},$=b=>b===0?"No items":b===1?"1 item":`${b.toLocaleString()} items`;return(()=>{var b=je();return b.firstChild,b.$$click=n=>{const l=n;l.target.closest?.("[data-blob-id]")&&l.detail?.blob&&c(l)},b.style.setProperty("display","flex"),b.style.setProperty("flex-direction","column"),b.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),b.style.setProperty("height","100%"),a(b,x(C,{get when(){return q(()=>!!(R()&&!v()))()&&!F()},get children(){var n=Ae(),l=n.firstChild,r=l.nextSibling;return l.style.setProperty("font-weight","500"),r.style.setProperty("color","#6b7280"),a(r,()=>$(_().length)),n}}),null),a(b,x(C,{get when(){return v()},get children(){return We()}}),null),a(b,x(C,{get when(){return q(()=>!!F())()&&!v()},get children(){var n=Ne(),l=n.firstChild,r=l.nextSibling,t=r.nextSibling;return l.style.setProperty("font-size","48px"),l.style.setProperty("margin-bottom","16px"),r.style.setProperty("font-weight","500"),r.style.setProperty("margin-bottom","8px"),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),a(t,F),n}}),null),a(b,x(C,{get when(){return q(()=>!v()&&!F())()&&_().length===0},get children(){var n=He(),l=n.firstChild,r=l.nextSibling,t=r.nextSibling;return r.style.setProperty("font-weight","500"),r.style.setProperty("margin-bottom","8px"),a(r,T),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),n}}),null),a(b,x(C,{get when(){return q(()=>!v()&&!F())()&&_().length>0},get children(){var n=Re();return a(n,x(ve,{get each(){return O()},children:(l,r)=>(()=>{var t=Oe();return a(t,x(we,{blob:l,get compact(){return E()==="compact"},get showThumbnail(){return M()},get showMetadata(){return j()},get showTimestamps(){return w()},get clickable(){return m()},get thumbnailSize(){return k()}})),I(e=>{var i=`feed-item ${f().selectedItemId===l.id?"selected":""}`,s=P(r());return i!==e.e&&H(t,e.e=i),e.t=ye(t,s,e.t),e},{e:void 0,t:void 0}),t})()})),I(l=>{var r=S(),t=S()!=="auto"?"auto":"visible";return r!==l.e&&((l.e=r)!=null?n.style.setProperty("max-height",r):n.style.removeProperty("max-height")),t!==l.t&&((l.t=t)!=null?n.style.setProperty("overflow",t):n.style.removeProperty("overflow")),l},{e:void 0,t:void 0}),n}}),null),I(()=>H(b,`media-blob-feed-list ${o.className||""}`)),b})()}Z("media-blob-feed-list",{items:[],loading:!1,error:null,emptyMessage:"No items in feed",maxHeight:"auto",itemMode:"default",showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,className:"",thumbnailSize:120,showItemCount:!0,animationDuration:300},Ye);ee(["click"]);var qe=h("<div><h2>Simple Solid.js Test</h2><p>Count: </p><button>Increment");console.log("🚀 Script started loading");function Ge(){console.log("📦 SimpleTest component created");const[o,f]=A(0);return(()=>{var y=qe(),_=y.firstChild,v=_.nextSibling;v.firstChild;var F=v.nextSibling;return y.style.setProperty("padding","20px"),y.style.setProperty("border","1px solid #ccc"),y.style.setProperty("margin","20px"),a(v,o,null),F.$$click=()=>f(o()+1),y})()}class Je extends HTMLElement{dispose;connectedCallback(){console.log("🔌 SimpleTestElement connected");try{this.dispose=Ce(()=>x(Ge,{}),this),console.log("✅ Render successful")}catch(f){console.error("❌ Render failed:",f)}}disconnectedCallback(){console.log("🔌 SimpleTestElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register custom element");try{customElements.define("simple-test",Je),console.log("✅ Custom element registered successfully")}catch(o){console.error("❌ Failed to register custom element:",o)}ee(["click"]);var Ke=h("<div class=upload-list>"),Ve=h("<div class=controls><button class=control-button>Clear Completed</button><span> total, <!> completed"),Qe=h("<div class=threshold-info><strong>Upload Routing:</strong><br>• Files &lt; <!>: WebSocket (stored in database)<br>• Files ≥ <!>: HTTP API (stored on disk, admin only)"),Xe=h(`<div class=smart-file-upload><style>
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
      </style><div><div>📁</div><div>Drop files here or click to browse</div><div>Small files (&lt;<!>) use WebSocket, large files use HTTP API</div><button class=upload-button>Select Files</button></div><input type=file class=hidden>`),Ze=h('<button class="action-button retry">Retry'),et=h('<div class=upload-progress><div class=progress-bar><div></div></div><div class=upload-status><span></span><div class=upload-actions><button class="action-button remove">Remove'),tt=h("<div class=upload-item><div class=upload-header><div class=upload-info><div class=upload-filename></div><div class=upload-details><span></span><span></span><span>");const lt=o=>{const[f,y]=A([]),[_,v]=A(!1),[F,T]=A(null),[S,E]=A(null),M=()=>o.sizeThreshold||10*1024*1024,j=()=>o.baseUrl||window.location.origin;let w;X(()=>{const e=new $e({baseUrl:j(),minFileSize:M(),maxFileSize:1073741824});e.addEventListener("upload-progress",s=>{const{uploadId:d,stage:u,progress:z,error:te}=s.detail;m(d,z,u==="error"?"error":"uploading",te?.message)}),T(e);const i=new _e({maxFileSize:M()});i.addEventListener("upload-processed",s=>{const{uploadId:d,blob:u}=s.detail;o.websocketConnection?o.websocketConnection.uploadMediaBlob(u)?m(d,100,"completed"):m(d,0,"error","Failed to send via WebSocket"):m(d,0,"error","WebSocket not connected")}),i.addEventListener("upload-error",s=>{const{uploadId:d,error:u}=s.detail;m(d,0,"error",u)}),E(i),he(()=>{e.cancelAllUploads(),i.destroy()})});const m=(e,i,s,d)=>{y(u=>u.map(z=>z.id===e?{...z,progress:i,status:s,error:d}:z))},k=async e=>{const i=Array.from(e),s=[];for(const d of i){const u=crypto.randomUUID(),z=d.size>=M()?"http":"websocket";s.push({id:u,file:d,method:z,status:"pending",progress:0})}y(d=>[...d,...s]);for(const d of s)d.method==="http"?R(d):D(d)},R=async e=>{const i=F();if(i){m(e.id,0,"uploading");try{const s=await i.uploadFile(e.file,{uploadedVia:"smart-file-upload",originalMethod:"http"});m(e.id,100,"completed"),y(d=>d.map(u=>u.id===e.id?{...u,result:s}:u))}catch(s){const d=s instanceof Error?s.message:String(s);m(e.id,0,"error",d)}}},D=async e=>{const i=S();if(i){m(e.id,0,"uploading");try{await i.addFiles([e.file])}catch(s){const d=s instanceof Error?s.message:String(s);m(e.id,0,"error",d)}}},O=e=>{y(i=>i.filter(s=>s.id!==e))},c=()=>{y(e=>e.filter(i=>i.status!=="completed"))},P=e=>{e.method==="http"?R(e):D(e)},$=e=>{const i=e.target;i.files&&i.files.length>0&&(k(i.files),i.value="")},b=e=>{e.preventDefault(),v(!0)},n=e=>{e.preventDefault(),v(!1)},l=e=>{e.preventDefault(),v(!1),e.dataTransfer?.files&&k(e.dataTransfer.files)},r=e=>{if(!e)return"0 B";const i=["B","KB","MB","GB"];let s=e,d=0;for(;s>=1024&&d<i.length-1;)s/=1024,d++;return`${s.toFixed(1)} ${i[d]}`},t=e=>e==="websocket"?"WebSocket":"HTTP API";return(()=>{var e=Xe(),i=e.firstChild,s=i.nextSibling,d=s.firstChild,u=d.nextSibling,z=u.nextSibling,te=z.firstChild,ie=te.nextSibling;ie.nextSibling;var re=z.nextSibling,Y=s.nextSibling;s.addEventListener("drop",l),s.addEventListener("dragleave",n),s.addEventListener("dragover",b),s.$$click=()=>!o.disabled&&w?.click(),d.style.setProperty("margin-bottom","1rem"),d.style.setProperty("font-size","2rem"),u.style.setProperty("margin-bottom","0.5rem"),u.style.setProperty("font-weight","500"),u.style.setProperty("color","#374151"),z.style.setProperty("font-size","0.875rem"),z.style.setProperty("color","#6b7280"),z.style.setProperty("margin-bottom","1rem"),a(z,()=>r(M()),ie),re.$$click=p=>{p.stopPropagation(),w?.click()},Y.addEventListener("change",$);var se=w;return typeof se=="function"?pe(se,Y):w=Y,a(e,x(C,{get when(){return f().length>0},get children(){return[(()=>{var p=Ke();return a(p,x(ve,{get each(){return f()},children:g=>(()=>{var U=tt(),W=U.firstChild,L=W.firstChild,N=L.firstChild,le=N.nextSibling,V=le.firstChild,G=V.nextSibling,ae=G.nextSibling;return a(N,()=>g.file.name),a(V,()=>r(g.file.size)),a(G,()=>g.file.type||"Unknown type"),a(ae,()=>t(g.method)),a(U,x(C,{get when(){return g.status!=="pending"},get children(){var de=et(),ce=de.firstChild,oe=ce.firstChild,xe=ce.nextSibling,J=xe.firstChild,be=J.nextSibling,me=be.firstChild;return a(J,()=>g.status==="uploading"&&`Uploading... ${g.progress}%`,null),a(J,()=>g.status==="completed"&&"✅ Upload completed",null),a(J,()=>g.status==="error"&&`❌ ${g.error||"Upload failed"}`,null),a(be,x(C,{get when(){return g.status==="error"},get children(){var B=Ze();return B.$$click=()=>P(g),B}}),me),me.$$click=()=>O(g.id),I(B=>{var ue=`progress-fill ${g.status}`,ne=`${g.progress}%`,fe=`status-text ${g.status}`;return ue!==B.e&&H(oe,B.e=ue),ne!==B.t&&((B.t=ne)!=null?oe.style.setProperty("width",ne):oe.style.removeProperty("width")),fe!==B.a&&H(J,B.a=fe),B},{e:void 0,t:void 0,a:void 0}),de}}),null),I(()=>H(ae,`upload-method ${g.method}`)),U})()})),p})(),(()=>{var p=Ve(),g=p.firstChild,U=g.nextSibling,W=U.firstChild,L=W.nextSibling;return L.nextSibling,g.$$click=c,U.style.setProperty("font-size","0.875rem"),U.style.setProperty("color","#6b7280"),U.style.setProperty("align-self","center"),a(U,()=>f().length,W),a(U,()=>f().filter(N=>N.status==="completed").length,L),p})()]}}),null),a(e,x(C,{get when(){return o.showDebug},get children(){var p=Qe(),g=p.firstChild,U=g.nextSibling,W=U.nextSibling,L=W.nextSibling,N=L.nextSibling,le=N.nextSibling,V=le.nextSibling,G=V.nextSibling;return G.nextSibling,a(p,()=>r(M()),L),a(p,()=>r(M()),G),p}}),null),I(p=>{var g=`upload-zone ${_()?"drag-over":""} ${o.disabled?"disabled":""}`,U=o.disabled,W=o.multiple!==!1,L=o.accept,N=o.disabled;return g!==p.e&&H(s,p.e=g),U!==p.t&&(re.disabled=p.t=U),W!==p.a&&(Y.multiple=p.a=W),L!==p.o&&K(Y,"accept",p.o=L),N!==p.i&&(Y.disabled=p.i=N),p},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),e})()};Z("smart-file-upload",{baseUrl:void 0,websocketConnection:void 0,sizeThreshold:10*1024*1024,showDebug:!1,multiple:!0,accept:void 0,disabled:!1},lt);ee(["click"]);console.log("🧩 Web Components Library loaded - Available components:",["webauthn-auth","websocket-handler","websocket-status","websocket-demo","websocket-feed-manager","websocket-feed-demo","media-blob-feed-item","media-blob-feed-list","simple-test","smart-file-upload","sync-status","sync-progress","sync-controls","sync-demo"]);
//# sourceMappingURL=all-components.js.map
