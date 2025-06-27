import{b as ee,a as W,e as Z,j as ae,o as de,t as g,u as $e,f as U,g as K,d as re,i as s,c as p,S as w,s as V,m as j,w as ce,h as Ce,F as ke,x as _e}from"./types-Bv8JCg1W.js";import{W as Se}from"./websocket-client-CXdLnJCR.js";import{C as X}from"./websocket-types-Dt_hrJq4.js";var Pe=g("<div>");function be(r){const[c,I]=W(null),[_,x]=W({items:[],isLoading:!1,isConnected:!1,connectionStatus:X.Disconnected,subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),v=()=>r.wsUrl||"ws://localhost:8080/ws",[T,$]=W(["MediaBlobs"]);Z(()=>{const t=r.channels;if(!t||t===""||t==="undefined"){$(["MediaBlobs"]);return}if(Array.isArray(t)){$(t);return}try{const e=JSON.parse(t);Array.isArray(e)?$(e):$(["MediaBlobs"])}catch(e){u("Failed to parse channels prop, using default:",e),$(["MediaBlobs"])}});const D=()=>T(),L=()=>r.debug||!1,E=()=>r.pageSize||20,u=(...t)=>{L()&&console.log("[WebSocketFeedManager]",...t)},S=t=>{x(e=>({...e,...t}))},H=t=>{x(e=>({...e,items:[t,...e.items],totalCount:e.totalCount+1,lastUpdated:new Date})),u("Added new feed item:",t.id)},N=t=>{x(e=>({...e,items:e.items.map(f=>f.id===t.id?t:f),lastUpdated:new Date})),u("Updated feed item:",t.id)},R=t=>{x(e=>({...e,items:e.items.filter(f=>f.id!==t),totalCount:Math.max(0,e.totalCount-1),lastUpdated:new Date})),u("Removed feed item:",t)},A=()=>{const t=c();t&&(S({isLoading:!0,error:null}),u("Loading initial feed..."),t.getMediaBlobs(E(),0)||S({isLoading:!1,error:"Failed to request initial feed data"}))},b=()=>{const t=c();if(!t)return;const e=D();u("Subscribing to channels:",e),e.forEach(f=>{t.subscribeToNotifications(f)||u("Failed to subscribe to channel:",f)})},P=()=>{const t=c();if(!t)return;const e=_();u("Unsubscribing from channels:",e.subscribedChannels),e.subscribedChannels.forEach(f=>{t.unsubscribeFromNotifications(f)||u("Failed to unsubscribe from channel:",f)})},a=()=>{const t=new Se({url:v(),autoReconnect:!0,reconnectDelay:3e3,maxReconnectAttempts:0,debug:L()});return t.on("statusChange",e=>{u("Connection status changed:",e),S({connectionStatus:e,isConnected:e===X.Connected}),e===X.Connected?(A(),b()):e===X.Disconnected&&S({subscribedChannels:[]})}),t.on("welcome",e=>{u("Connected to WebSocket:",e),S({error:null})}),t.on("mediaBlobs",e=>{u("Received initial media blobs:",e.blobs.length),S({items:e.blobs,totalCount:e.total_count,isLoading:!1,lastUpdated:new Date,error:null})}),t.on("mediaBlob",e=>{u("Received single media blob:",e.blob.id),N(e.blob)}),t.on("notification",e=>{if(u("Received notification:",e),e.channel==="MediaBlobs")switch(e.event_type){case"media_blob.created":e.payload&&e.payload.media_blob&&H(e.payload.media_blob);break;case"media_blob.updated":e.payload&&e.payload.media_blob&&N(e.payload.media_blob);break;case"media_blob.deleted":e.payload&&e.payload.media_blob_id&&R(e.payload.media_blob_id);break;default:u("Unknown media blob event:",e.event_type)}}),t.on("notificationSubscribed",e=>{u("Subscribed to channel:",e.channel),x(f=>({...f,subscribedChannels:[...f.subscribedChannels,e.channel]}))}),t.on("notificationUnsubscribed",e=>{u("Unsubscribed from channel:",e.channel),x(f=>({...f,subscribedChannels:f.subscribedChannels.filter(C=>C!==e.channel)}))}),t.on("notificationStatus",e=>{u("Notification status:",e),S({subscribedChannels:e.subscribed_channels})}),t.on("error",e=>{u("WebSocket error:",e),S({error:e.message})}),t.on("parseError",(e,f)=>{u("Parse error:",e,f),S({error:`Parse error: ${e.message}`})}),I(t),t},d=()=>{const t=c();t&&t.connect()},o=()=>{const t=c();t&&(P(),t.disconnect())},i={connect:d,disconnect:o,refresh:()=>{c()&&_().isConnected&&A()},getFeedState:()=>_(),getClient:()=>c()};return ae(()=>{u("Initializing WebSocket feed manager");const t=a();r.autoConnect!==!1&&t.connect()}),de(()=>{u("Cleaning up WebSocket feed manager"),o()}),Z(()=>{const t=D(),e=_().subscribedChannels;if(JSON.stringify(t)!==JSON.stringify(e)){const f=c();f&&_().isConnected&&(e.forEach(C=>{t.includes(C)||f.unsubscribeFromNotifications(C)}),t.forEach(C=>{e.includes(C)||f.subscribeToNotifications(C)}))}}),(()=>{var t=Pe();return $e(e=>{e.feedManager=i},t),t.style.setProperty("display","none"),U(()=>K(t,`websocket-feed-manager ${r.className||""}`)),t})()}ee("websocket-feed-manager",{wsUrl:"ws://localhost:8080/ws",channels:'["MediaBlobs"]',debug:!1,autoConnect:!0,pageSize:20,className:""},be);var Me=g("<img>"),ze=g("<div class=thumbnail-container>"),Fe=g("<div class=metadata-item><span>📏</span><span>"),Ie=g("<div class=metadata-item><span>📱</span><span>..."),Te=g("<div class=metadata><div class=metadata-item><span></span><span>"),Ue=g("<span>Added <!> • Updated "),se=g("<div>"),De=g(`<div><style>
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
      </style><div class=content><h3 class=title>`),Le=g("<span>Added ");function fe(r){const[c,I]=W({loading:!0,error:!1,url:null}),_=()=>r.showThumbnail!==!1,x=()=>r.showMetadata!==!1,v=()=>r.showTimestamps!==!1,T=()=>r.compact||!1,$=()=>r.clickable!==!1,D=()=>r.thumbnailSize||120,L=()=>r.showLoadingPlaceholder!==!1,E=b=>{if(!b)return"Unknown size";const P=["B","KB","MB","GB"];let a=0,d=b;for(;d>=1024&&a<P.length-1;)d/=1024,a++;return`${d.toFixed(a>0?1:0)} ${P[a]}`},u=b=>{try{const P=new Date(b),d=new Date().getTime()-P.getTime(),o=Math.floor(d/(1e3*60)),n=Math.floor(o/60),i=Math.floor(n/24);return o<1?"Just now":o<60?`${o}m ago`:n<24?`${n}h ago`:i<7?`${i}d ago`:P.toLocaleDateString()}catch{return"Unknown time"}},S=b=>b?b.startsWith("image/")?"🖼️":b.startsWith("video/")?"🎬":b.startsWith("audio/")?"🎵":b.includes("pdf")?"📋":b.includes("text")?"📝":"📄":"📄",H=async()=>{if(_()){I({loading:!0,error:!1,url:null});try{const b=`/api/v1/media_blobs/${r.blob.id}/thumbnail`;(await fetch(b,{method:"HEAD",credentials:"include"})).ok?I({loading:!1,error:!1,url:b}):I({loading:!1,error:!1,url:null})}catch(b){console.warn("Failed to load thumbnail for",r.blob.id,b),I({loading:!1,error:!0,url:null})}}},N=()=>{if(!$())return;const b=new CustomEvent("media-blob-click",{detail:{blob:r.blob},bubbles:!0});document.querySelector(`[data-blob-id="${r.blob.id}"]`)?.dispatchEvent(b)},R=()=>{I(b=>({...b,loading:!1}))},A=()=>{I(b=>({...b,loading:!1,error:!0}))};return Z(()=>{r.blob?.id&&H()}),(()=>{var b=De(),P=b.firstChild,a=P.nextSibling,d=a.firstChild;return b.$$click=N,s(b,p(w,{get when(){return _()},get children(){var o=ze();return s(o,p(w,{get when(){return j(()=>!c().loading)()&&c().url},get fallback(){return(()=>{var n=se();return n.style.setProperty("width","100%"),n.style.setProperty("height","100%"),n.style.setProperty("display","flex"),n.style.setProperty("align-items","center"),n.style.setProperty("justify-content","center"),n.style.setProperty("color","#9ca3af"),s(n,(()=>{var i=j(()=>!!c().loading);return()=>i()?"⏳":S(r.blob.mime)})()),U(i=>{var t=`thumbnail-placeholder ${c().loading&&L()?"thumbnail-loading":""}`,e=T()?"24px":"32px";return t!==i.e&&K(n,i.e=t),e!==i.t&&((i.t=e)!=null?n.style.setProperty("font-size",e):n.style.removeProperty("font-size")),i},{e:void 0,t:void 0}),n})()},get children(){var n=Me();return n.addEventListener("error",A),n.addEventListener("load",R),n.style.setProperty("width","100%"),n.style.setProperty("height","100%"),n.style.setProperty("object-fit","cover"),U(i=>{var t=c().url,e=`Thumbnail for ${r.blob.sha256.slice(0,8)}`;return t!==i.e&&V(n,"src",i.e=t),e!==i.t&&V(n,"alt",i.t=e),i},{e:void 0,t:void 0}),n}})),U(n=>{var i=`${D()}px`,t=`${D()}px`,e=`${D()}px`,f=`${D()}px`;return i!==n.e&&((n.e=i)!=null?o.style.setProperty("width",i):o.style.removeProperty("width")),t!==n.t&&((n.t=t)!=null?o.style.setProperty("height",t):o.style.removeProperty("height")),e!==n.a&&((n.a=e)!=null?o.style.setProperty("min-width",e):o.style.removeProperty("min-width")),f!==n.o&&((n.o=f)!=null?o.style.setProperty("min-height",f):o.style.removeProperty("min-height")),n},{e:void 0,t:void 0,a:void 0,o:void 0}),o}}),a),a.style.setProperty("min-width","0"),s(d,()=>r.blob.local_path?.split("/").pop()||`${r.blob.sha256.slice(0,8)}...${r.blob.sha256.slice(-4)}`),s(a,p(w,{get when(){return x()},get children(){var o=Te(),n=o.firstChild,i=n.firstChild,t=i.nextSibling;return s(i,()=>S(r.blob.mime)),s(t,()=>r.blob.mime||"Unknown type"),s(o,p(w,{get when(){return r.blob.size},get children(){var e=Fe(),f=e.firstChild,C=f.nextSibling;return s(C,()=>E(r.blob.size)),e}}),null),s(o,p(w,{get when(){return r.blob.source_client_id},get children(){var e=Ie(),f=e.firstChild,C=f.nextSibling,G=C.firstChild;return s(C,()=>r.blob.source_client_id?.slice(0,8),G),U(()=>V(C,"title",r.blob.source_client_id)),e}}),null),o}}),null),s(a,p(w,{get when(){return v()},get children(){var o=se();return o.style.setProperty("margin-top","4px"),o.style.setProperty("font-size","11px"),o.style.setProperty("color","#9ca3af"),s(o,p(w,{get when(){return r.blob.created_at!==r.blob.updated_at},get fallback(){return(()=>{var n=Le();return n.firstChild,s(n,()=>u(r.blob.created_at),null),n})()},get children(){var n=Ue(),i=n.firstChild,t=i.nextSibling;return t.nextSibling,s(n,()=>u(r.blob.created_at),t),s(n,()=>u(r.blob.updated_at),null),n}})),o}}),null),U(o=>{var n=`media-blob-feed-item ${T()?"compact":""} ${$()?"clickable":""} ${r.className||""}`,i=r.blob.id,t={display:"flex","flex-direction":T()?"row":"column",gap:T()?"12px":"8px",padding:T()?"8px":"12px",border:"1px solid #e2e8f0","border-radius":"8px","background-color":"#ffffff",cursor:$()?"pointer":"default",transition:"all 0.2s ease",...$()&&{":hover":{"box-shadow":"0 2px 8px rgba(0, 0, 0, 0.1)",transform:"translateY(-1px)"}}},e=T()?"1":"auto";return n!==o.e&&K(b,o.e=n),i!==o.t&&V(b,"data-blob-id",o.t=i),o.a=ce(b,t,o.a),e!==o.o&&((o.o=e)!=null?a.style.setProperty("flex",e):a.style.removeProperty("flex")),o},{e:void 0,t:void 0,a:void 0,o:void 0}),b})()}ee("media-blob-feed-item",{blob:{},showThumbnail:!0,showMetadata:!0,showTimestamps:!0,compact:!1,clickable:!0,className:"",thumbnailSize:120,showLoadingPlaceholder:!0},fe);re(["click"]);var Ee=g("<div class=header><div>Feed</div><div>"),Ne=g("<div class=loading-indicator><div class=loading-spinner>⏳</div><div>Loading feed..."),Be=g("<div class=error-state><div>⚠️</div><div>Failed to load feed</div><div>"),We=g("<div class=empty-state><div class=empty-icon>📭</div><div></div><div>New items will appear here automatically"),Re=g("<div class=feed-container>"),Ae=g(`<div><style>
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
      `),je=g("<div>");function ue(r){const[c,I]=W({selectedItemId:null,lastUpdated:null}),_=()=>r.items||[],x=()=>r.loading||!1,v=()=>r.error||null,T=()=>r.emptyMessage||"No items in feed",$=()=>r.maxHeight||"auto",D=()=>r.itemMode||"default",L=()=>r.showThumbnails!==!1,E=()=>r.showMetadata!==!1,u=()=>r.showTimestamps!==!1,S=()=>r.clickableItems!==!1,H=()=>r.thumbnailSize||120,N=()=>r.showItemCount!==!1,R=()=>r.animationDuration||300,A=Ce(()=>[..._()].sort((d,o)=>{const n=new Date(d.created_at).getTime();return new Date(o.created_at).getTime()-n})),b=d=>{const{blob:o}=d.detail;I(i=>({...i,selectedItemId:o.id===i.selectedItemId?null:o.id}));const n=new CustomEvent("feed-item-selected",{detail:{blob:o,isSelected:o.id!==c().selectedItemId},bubbles:!0});d.target?.dispatchEvent(n)},P=d=>R()<=0?{}:{"animation-delay":`${d*50}ms`,"animation-duration":`${R()}ms`,"animation-fill-mode":"both","animation-name":"feed-item-appear"},a=d=>d===0?"No items":d===1?"1 item":`${d.toLocaleString()} items`;return(()=>{var d=Ae();return d.firstChild,d.$$click=o=>{const n=o;n.target.closest?.("[data-blob-id]")&&n.detail?.blob&&b(n)},d.style.setProperty("display","flex"),d.style.setProperty("flex-direction","column"),d.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),d.style.setProperty("height","100%"),s(d,p(w,{get when(){return j(()=>!!(N()&&!x()))()&&!v()},get children(){var o=Ee(),n=o.firstChild,i=n.nextSibling;return n.style.setProperty("font-weight","500"),i.style.setProperty("color","#6b7280"),s(i,()=>a(_().length)),o}}),null),s(d,p(w,{get when(){return x()},get children(){return Ne()}}),null),s(d,p(w,{get when(){return j(()=>!!v())()&&!x()},get children(){var o=Be(),n=o.firstChild,i=n.nextSibling,t=i.nextSibling;return n.style.setProperty("font-size","48px"),n.style.setProperty("margin-bottom","16px"),i.style.setProperty("font-weight","500"),i.style.setProperty("margin-bottom","8px"),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),s(t,v),o}}),null),s(d,p(w,{get when(){return j(()=>!x()&&!v())()&&_().length===0},get children(){var o=We(),n=o.firstChild,i=n.nextSibling,t=i.nextSibling;return i.style.setProperty("font-weight","500"),i.style.setProperty("margin-bottom","8px"),s(i,T),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),o}}),null),s(d,p(w,{get when(){return j(()=>!x()&&!v())()&&_().length>0},get children(){var o=Re();return s(o,p(ke,{get each(){return A()},children:(n,i)=>(()=>{var t=je();return s(t,p(fe,{blob:n,get compact(){return D()==="compact"},get showThumbnail(){return L()},get showMetadata(){return E()},get showTimestamps(){return u()},get clickable(){return S()},get thumbnailSize(){return H()}})),U(e=>{var f=`feed-item ${c().selectedItemId===n.id?"selected":""}`,C=P(i());return f!==e.e&&K(t,e.e=f),e.t=ce(t,C,e.t),e},{e:void 0,t:void 0}),t})()})),U(n=>{var i=$(),t=$()!=="auto"?"auto":"visible";return i!==n.e&&((n.e=i)!=null?o.style.setProperty("max-height",i):o.style.removeProperty("max-height")),t!==n.t&&((n.t=t)!=null?o.style.setProperty("overflow",t):o.style.removeProperty("overflow")),n},{e:void 0,t:void 0}),o}}),null),U(()=>K(d,`media-blob-feed-list ${r.className||""}`)),d})()}ee("media-blob-feed-list",{items:[],loading:!1,error:null,emptyMessage:"No items in feed",maxHeight:"auto",itemMode:"default",showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,className:"",thumbnailSize:120,showItemCount:!0,animationDuration:300},ue);re(["click"]);var He=g("<div class=section-header><h3 class=section-title>Connection</h3><div>"),Je=g('<div class=controls><button class="control-button primary">Connect</button><button class="control-button danger">Disconnect</button><button class=control-button>Refresh</button><div>Subscribed: '),Ye=g("<div><h3 class=section-title>Feed Statistics</h3><div class=stats-grid><div class=stat-card><div class=stat-value></div><div class=stat-label>Items Loaded</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Total Available</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Last Updated</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Subscriptions"),Oe=g("<div><h3 class=section-title>Selected Item</h3><div class=selected-item><div class=selected-item-title></div><div class=selected-item-details>ID: <!> • Type: <!> • Size: "),qe=g("<div>⚠️ "),Ke=g("<div class=logs-container>"),Ge=g(`<div><style>
        .websocket-feed-demo .controls {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .websocket-feed-demo .control-button {
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

        .websocket-feed-demo .control-button:hover {
          background-color: #f9fafb;
          border-color: #9ca3af;
        }

        .websocket-feed-demo .control-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .websocket-feed-demo .control-button.primary {
          background-color: #3b82f6;
          color: #ffffff;
          border-color: #3b82f6;
        }

        .websocket-feed-demo .control-button.primary:hover {
          background-color: #2563eb;
          border-color: #2563eb;
        }

        .websocket-feed-demo .control-button.danger {
          background-color: #ef4444;
          color: #ffffff;
          border-color: #ef4444;
        }

        .websocket-feed-demo .control-button.danger:hover {
          background-color: #dc2626;
          border-color: #dc2626;
        }

        .websocket-feed-demo .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
        }

        .websocket-feed-demo .stat-card {
          padding: 12px;
          border-radius: 8px;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          text-align: center;
        }

        .websocket-feed-demo .stat-value {
          font-size: 20px;
          font-weight: 600;
          color: #111827;
          margin: 0;
        }

        .websocket-feed-demo .stat-label {
          font-size: 12px;
          color: #6b7280;
          margin: 4px 0 0 0;
        }

        .websocket-feed-demo .logs-container {
          background-color: #1f2937;
          color: #f3f4f6;
          padding: 12px;
          border-radius: 6px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          line-height: 1.4;
          max-height: 200px;
          overflow-y: auto;
        }

        .websocket-feed-demo .logs-container::-webkit-scrollbar {
          width: 6px;
        }

        .websocket-feed-demo .logs-container::-webkit-scrollbar-track {
          background: #374151;
        }

        .websocket-feed-demo .logs-container::-webkit-scrollbar-thumb {
          background: #6b7280;
          border-radius: 3px;
        }

        .websocket-feed-demo .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 0 0 8px 0;
        }

        .websocket-feed-demo .section-title {
          font-size: 16px;
          font-weight: 600;
          color: #111827;
          margin: 0;
        }

        .websocket-feed-demo .toggle-button {
          background: none;
          border: none;
          color: #3b82f6;
          cursor: pointer;
          font-size: 12px;
          text-decoration: underline;
        }

        .websocket-feed-demo .selected-item {
          padding: 12px;
          border-radius: 8px;
          background-color: #eff6ff;
          border: 1px solid #bfdbfe;
        }

        .websocket-feed-demo .selected-item-title {
          font-weight: 500;
          color: #1e40af;
          margin: 0 0 4px 0;
        }

        .websocket-feed-demo .selected-item-details {
          font-size: 12px;
          color: #3730a3;
        }
      </style><div><h2>🔄 WebSocket Feed Demo</h2><p>Real-time media blob feed powered by WebSocket notifications</p></div><div><h3 class=section-title>Live Feed</h3></div><div><div class=section-header><h3 class=section-title>Activity Log</h3><div><button class=toggle-button></button><button class=toggle-button>Clear`),Qe=g("<div>No activity yet..."),Ve=g("<div>");function Xe(r){const[c,I]=W({items:[],isLoading:!1,isConnected:!1,connectionStatus:"disconnected",subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),[_,x]=W([]),[v,T]=W(null),[$,D]=W(!1);let L=null,E;const u=()=>r.wsUrl||"ws://localhost:8080/ws",S=()=>r.channels||["MediaBlobs"],H=()=>r.debug||!1,N=()=>r.itemMode||"default",R=()=>r.maxHeight||"400px",A=()=>r.showControls!==!1,b=()=>r.showStats!==!1,P=()=>r.refreshInterval||0,a=l=>{const h=new Date().toLocaleTimeString();x(B=>[...B.slice(-19),`[${h}] ${l}`])},d=()=>{if(!L)return a("❌ Feed manager ref is null"),null;const l=L?.feedManager;return l||a("❌ Feed manager object not found on ref"),l},o=()=>{const l=d();if(l)try{const h=l.getFeedState();h&&(h.items.length!==c().items.length&&a(`📦 Feed state updated: ${h.items.length} items`),h.isConnected!==c().isConnected&&a(`🔌 Connection state: ${h.isConnected?"Connected":"Disconnected"}`),I(h))}catch(h){a(`Error getting feed state: ${h instanceof Error?h.message:"Unknown error"}`)}else a(L?"⚠️ Feed manager ref exists but no manager object found":"⚠️ Feed manager ref is null")},n=()=>{const l=d();if(l){a("Connecting to WebSocket...");try{l.connect()}catch(h){a(`Connect failed: ${h instanceof Error?h.message:"Unknown error"}`)}}else a("Feed manager not available")},i=()=>{const l=d();if(l){a("Disconnecting from WebSocket...");try{l.disconnect()}catch(h){a(`Disconnect failed: ${h instanceof Error?h.message:"Unknown error"}`)}}else a("Feed manager not available")},t=()=>{const l=d();if(l){a("Refreshing feed...");try{l.refresh()}catch(h){a(`Refresh failed: ${h instanceof Error?h.message:"Unknown error"}`)}}else a("Feed manager not available")},e=l=>{const{blob:h,isSelected:B}=l.detail;T(B?h:null),a(`${B?"Selected":"Deselected"} item: ${h.id.slice(0,8)}`)},f=()=>{x([])},C=l=>{switch(l){case"connected":return"🟢 Connected";case"connecting":return"🟡 Connecting";case"disconnected":return"🔴 Disconnected";case"error":return"❌ Error";default:return"⚪ Unknown"}},G=l=>{switch(l){case"connected":return"#10b981";case"connecting":return"#f59e0b";case"disconnected":return"#6b7280";case"error":return"#ef4444";default:return"#9ca3af"}},me=()=>{P()>0&&(E=window.setInterval(()=>{c().isConnected&&t()},P()*1e3))},ge=()=>{E&&(clearInterval(E),E=void 0)},he=setInterval(()=>{try{o()}catch(l){console.warn("Error polling feed manager state:",l),a(`Polling error: ${l instanceof Error?l.message:"Unknown error"}`)}},500);return Z(()=>{const l=c();a(`🔍 State update: ${l.items.length} items, connected: ${l.isConnected}, status: ${l.connectionStatus}`)}),ae(()=>{a("WebSocket Feed Demo initialized"),setTimeout(()=>{a("🔍 Checking initial feed manager state..."),o()},1e3),me()}),de(()=>{a("WebSocket Feed Demo cleanup"),clearInterval(he),ge()}),(()=>{var l=Ge(),h=l.firstChild,B=h.nextSibling,Q=B.firstChild,te=Q.nextSibling,J=B.nextSibling;J.firstChild;var ie=J.nextSibling,ye=ie.firstChild,pe=ye.firstChild,ve=pe.nextSibling,ne=ve.firstChild,le=ne.nextSibling;return _e(l,"feed-item-selected",e),l.style.setProperty("display","flex"),l.style.setProperty("flex-direction","column"),l.style.setProperty("gap","16px"),l.style.setProperty("padding","20px"),l.style.setProperty("border-radius","12px"),l.style.setProperty("background-color","#ffffff"),l.style.setProperty("border","1px solid #e2e8f0"),l.style.setProperty("box-shadow","0 1px 3px rgba(0, 0, 0, 0.1)"),l.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),l.style.setProperty("max-width","800px"),l.style.setProperty("margin","0 auto"),s(l,p(be,{ref:m=>{L=m,a("📋 Feed manager ref set"),setTimeout(()=>{const k=d();a(k?"✅ Feed manager is accessible":"❌ Feed manager is not accessible after ref set")},100)},get wsUrl(){return u()},get channels(){return S()},get debug(){return H()},get autoConnect(){return r.autoConnect},pageSize:20}),B),B.style.setProperty("text-align","center"),Q.style.setProperty("margin","0 0 8px 0"),Q.style.setProperty("color","#111827"),Q.style.setProperty("font-size","24px"),te.style.setProperty("margin","0"),te.style.setProperty("color","#6b7280"),te.style.setProperty("font-size","14px"),s(l,p(w,{get when(){return A()},get children(){return[(()=>{var m=He(),k=m.firstChild,y=k.nextSibling;return y.style.setProperty("display","flex"),y.style.setProperty("align-items","center"),y.style.setProperty("gap","12px"),y.style.setProperty("padding","6px 12px"),y.style.setProperty("border-radius","20px"),y.style.setProperty("font-size","12px"),y.style.setProperty("font-weight","500"),s(y,()=>C(c().connectionStatus)),U(F=>{var M=G(c().connectionStatus)+"20",z=G(c().connectionStatus);return M!==F.e&&((F.e=M)!=null?y.style.setProperty("background-color",M):y.style.removeProperty("background-color")),z!==F.t&&((F.t=z)!=null?y.style.setProperty("color",z):y.style.removeProperty("color")),F},{e:void 0,t:void 0}),m})(),(()=>{var m=Je(),k=m.firstChild,y=k.nextSibling,F=y.nextSibling,M=F.nextSibling;return M.firstChild,k.$$click=n,y.$$click=i,F.$$click=t,M.style.setProperty("margin-left","auto"),M.style.setProperty("font-size","12px"),M.style.setProperty("color","#6b7280"),s(M,()=>c().subscribedChannels.join(", ")||"None",null),U(z=>{var Y=c().isConnected,O=!c().isConnected,q=!c().isConnected;return Y!==z.e&&(k.disabled=z.e=Y),O!==z.t&&(y.disabled=z.t=O),q!==z.a&&(F.disabled=z.a=q),z},{e:void 0,t:void 0,a:void 0}),m})()]}}),J),s(l,p(w,{get when(){return b()},get children(){var m=Ye(),k=m.firstChild,y=k.nextSibling,F=y.firstChild,M=F.firstChild,z=F.nextSibling,Y=z.firstChild,O=z.nextSibling,q=O.firstChild,oe=O.nextSibling,we=oe.firstChild;return s(M,()=>c().items.length),s(Y,()=>c().totalCount),s(q,(()=>{var xe=j(()=>!!c().lastUpdated);return()=>xe()?c().lastUpdated.toLocaleTimeString():"Never"})()),s(we,()=>c().subscribedChannels.length),m}}),J),s(l,p(w,{get when(){return v()},get children(){var m=Oe(),k=m.firstChild,y=k.nextSibling,F=y.firstChild,M=F.nextSibling,z=M.firstChild,Y=z.nextSibling,O=Y.nextSibling,q=O.nextSibling;return q.nextSibling,s(F,()=>v().local_path?.split("/").pop()||`${v().sha256.slice(0,8)}...${v().sha256.slice(-4)}`),s(M,()=>v().id,Y),s(M,()=>v().mime||"Unknown",q),s(M,(()=>{var oe=j(()=>!!v().size);return()=>oe()?`${(v().size/1024).toFixed(1)} KB`:"Unknown"})(),null),m}}),J),s(l,p(w,{get when(){return c().error},get children(){var m=qe();return m.firstChild,m.style.setProperty("padding","12px"),m.style.setProperty("border-radius","6px"),m.style.setProperty("background-color","#fee2e2"),m.style.setProperty("color","#991b1b"),m.style.setProperty("border","1px solid #fecaca"),m.style.setProperty("font-size","14px"),s(m,()=>c().error,null),m}}),J),s(J,p(ue,{get items(){return c().items},get loading(){return c().isLoading},get error(){return c().error},emptyMessage:"No media blobs in feed yet",get maxHeight(){return R()},get itemMode(){return N()},showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,get thumbnailSize(){return N()==="compact"?60:100},showItemCount:!0,animationDuration:300}),null),ne.$$click=()=>D(!$()),s(ne,()=>$()?"Hide":"Show"),le.$$click=f,le.style.setProperty("margin-left","8px"),s(ie,p(w,{get when(){return $()},get children(){var m=Ke();return s(m,p(w,{get when(){return _().length>0},get fallback(){return(()=>{var k=Qe();return k.style.setProperty("color","#9ca3af"),k.style.setProperty("font-style","italic"),k})()},get children(){return _().map(k=>(()=>{var y=Ve();return y.style.setProperty("margin-bottom","2px"),s(y,k),y})())}})),m}}),null),U(()=>K(l,`websocket-feed-demo ${r.className||""}`)),l})()}ee("websocket-feed-demo",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,itemMode:"default",maxHeight:"400px",showControls:!0,showStats:!0,className:"",refreshInterval:0},Xe);re(["click"]);
//# sourceMappingURL=websocket-feed-demo.js.map
