import{c as ne,a as j,h as te,o as ce,b as be,t as g,u as $e,f as N,g as V,d as ie,i,e as v,S as C,s as ee,m as H,w as fe,j as Ce,F as _e,x as ke}from"./types-DHjY8jnN.js";import{C as T}from"./websocket-types-BKbG2VtF.js";import{W as Se}from"./websocket-client-CdmpF5ya.js";var Pe=g("<div>");function Me(r){const[d,D]=j(null),[_,k]=j({items:[],isLoading:!1,isConnected:!1,connectionStatus:T.Disconnected,subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),w=()=>r.wsUrl||"ws://localhost:8080/ws",[U,x]=j(["MediaBlobs"]);te(()=>{const t=r.channels;if(!t||Array.isArray(t)&&t.length===0){x(["MediaBlobs"]);return}if(Array.isArray(t)){x(t);return}if(typeof t=="string")try{const e=JSON.parse(t);Array.isArray(e)?x(e):x(["MediaBlobs"])}catch(e){S("Failed to parse channels prop, using default:",e),x(["MediaBlobs"])}else x(["MediaBlobs"])});const B=()=>U(),E=()=>r.debug||!1,L=()=>r.pageSize||20,S=(...t)=>{E()&&console.log("[WebSocketFeedManager]",...t)},u=(...t)=>{E()},P=t=>{k(e=>({...e,...t}))},Y=t=>{k(e=>({...e,items:[t,...e.items],totalCount:e.totalCount+1,lastUpdated:new Date})),u("Added new feed item:",t.id)},W=t=>{k(e=>({...e,items:e.items.map(b=>b.id===t.id?t:b),lastUpdated:new Date})),u("Updated feed item:",t.id)},q=t=>{k(e=>({...e,items:e.items.filter(b=>b.id!==t),totalCount:Math.max(0,e.totalCount-1),lastUpdated:new Date})),u("Removed feed item:",t)},c=()=>{const t=d();t&&(P({isLoading:!0,error:null}),u("Loading initial feed..."),t.getMediaBlobs(L(),0)||P({isLoading:!1,error:"Failed to request initial feed data"}))},f=()=>{const t=d();if(!t)return;const e=_();u("Unsubscribing from channels:",e.subscribedChannels),e.subscribedChannels.forEach(b=>{t.unsubscribeFromNotifications(b)||u("Failed to unsubscribe from channel:",b)})},p=()=>{const t=new Se({url:w(),autoReconnect:!0,reconnectDelay:3e3,maxReconnectAttempts:0,debug:E()});return t.on("statusChange",e=>{if(S("Connection status changed:",e),P({connectionStatus:e,isConnected:e===T.Connected}),e===T.Connected){c();const b=_().subscribedChannels,$=B().filter(A=>!b.includes(A));$.length>0&&$.forEach(A=>{t.subscribeToNotifications(A)})}else e===T.Disconnected&&P({subscribedChannels:[]})}),t.on("welcome",e=>{u("Connected to WebSocket:",e),P({error:null})}),t.on("mediaBlobs",e=>{S("Loaded",e.blobs.length,"media blobs"),P({items:e.blobs,totalCount:e.total_count,isLoading:!1,lastUpdated:new Date,error:null})}),t.on("mediaBlob",e=>{u("Received single media blob:",e.blob.id),W(e.blob)}),t.on("notification",e=>{if(u("Received notification:",e),e.channel==="MediaBlobs")switch(e.event_type){case"media_blob.created":e.payload&&e.payload.media_blob&&(S("📦 New media blob:",e.payload.media_blob.id.slice(0,8)),Y(e.payload.media_blob));break;case"media_blob.updated":e.payload&&e.payload.media_blob&&(u("Updated media blob:",e.payload.media_blob.id),W(e.payload.media_blob));break;case"media_blob.deleted":e.payload&&e.payload.media_blob_id&&(S("🗑️ Deleted media blob:",e.payload.media_blob_id.slice(0,8)),q(e.payload.media_blob_id));break;default:u("Unknown media blob event:",e.event_type)}}),t.on("notificationSubscribed",e=>{u("Subscribed to channel:",e.channel),k(b=>({...b,subscribedChannels:b.subscribedChannels.includes(e.channel)?b.subscribedChannels:[...b.subscribedChannels,e.channel]}))}),t.on("notificationUnsubscribed",e=>{u("Unsubscribed from channel:",e.channel),k(b=>({...b,subscribedChannels:b.subscribedChannels.filter($=>$!==e.channel)}))}),t.on("notificationStatus",e=>{u("Notification status:",e),P({subscribedChannels:e.subscribed_channels})}),t.on("error",e=>{S("❌ WebSocket error:",e.message),P({error:e.message})}),t.on("parseError",e=>{S("❌ Parse error:",e.message),P({error:`Parse error: ${e.message}`})}),D(t),t},a=()=>{const t=d();t&&t.connect()},o=()=>{const t=d();t&&(f(),t.disconnect())},l={connect:a,disconnect:o,refresh:()=>{d()&&_().isConnected&&c()},getFeedState:()=>_(),getClient:()=>d()};return ce(()=>{S("Initializing WebSocket feed manager");const t=p();r.autoConnect!==!1&&t.connect()}),be(()=>{S("Cleaning up WebSocket feed manager"),o()}),te(()=>{const t=B(),e=_().subscribedChannels,b=d();if(b&&_().isConnected){const $=e.filter(R=>!t.includes(R)),A=t.filter(R=>!e.includes(R));($.length>0||A.length>0)&&($.forEach(R=>{b.unsubscribeFromNotifications(R)}),A.forEach(R=>{b.subscribeToNotifications(R)}))}}),(()=>{var t=Pe();return $e(e=>{const b=e.closest("websocket-feed-manager");b?(b.feedManager=l,u("Feed manager methods exposed on custom element")):u("Could not find custom element parent")},t),t.style.setProperty("display","none"),N(()=>V(t,`websocket-feed-manager ${r.className||""}`)),t})()}ne("websocket-feed-manager",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,pageSize:20,className:""},Me);var ze=g("<img>"),Fe=g("<div class=thumbnail-container>"),Ie=g("<div class=metadata-item><span>📏</span><span>"),Te=g("<div class=metadata-item><span>📱</span><span>..."),De=g("<div class=metadata><div class=metadata-item><span></span><span>"),Ue=g("<span>Added <!> • Updated "),de=g("<div>"),Ee=g(`<div><style>
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
      </style><div class=content><h3 class=title>`),Le=g("<span>Added ");function me(r){const[d,D]=j({loading:!0,error:!1,url:null}),_=()=>r.showThumbnail!==!1,k=()=>r.showMetadata!==!1,w=()=>r.showTimestamps!==!1,U=()=>r.compact||!1,x=()=>r.clickable!==!1,B=()=>r.thumbnailSize||120,E=()=>r.showLoadingPlaceholder!==!1,L=c=>{if(!c)return"Unknown size";const f=["B","KB","MB","GB"];let p=0,a=c;for(;a>=1024&&p<f.length-1;)a/=1024,p++;return`${a.toFixed(p>0?1:0)} ${f[p]}`},S=c=>{try{const f=new Date(c),a=new Date().getTime()-f.getTime(),o=Math.floor(a/(1e3*60)),n=Math.floor(o/60),l=Math.floor(n/24);return o<1?"Just now":o<60?`${o}m ago`:n<24?`${n}h ago`:l<7?`${l}d ago`:f.toLocaleDateString()}catch{return"Unknown time"}},u=c=>c?c.startsWith("image/")?"🖼️":c.startsWith("video/")?"🎬":c.startsWith("audio/")?"🎵":c.includes("pdf")?"📋":c.includes("text")?"📝":"📄":"📄",P=async()=>{if(_()){D({loading:!0,error:!1,url:null});try{const c=`/api/v1/media_blobs/${r.blob.id}/thumbnail`;(await fetch(c,{method:"HEAD",credentials:"include"})).ok?D({loading:!1,error:!1,url:c}):D({loading:!1,error:!1,url:null})}catch(c){console.warn("Failed to load thumbnail for",r.blob.id,c),D({loading:!1,error:!0,url:null})}}},Y=()=>{if(!x())return;const c=new CustomEvent("media-blob-click",{detail:{blob:r.blob},bubbles:!0});document.querySelector(`[data-blob-id="${r.blob.id}"]`)?.dispatchEvent(c)},W=()=>{D(c=>({...c,loading:!1}))},q=()=>{D(c=>({...c,loading:!1,error:!0}))};return te(()=>{r.blob?.id&&P()}),(()=>{var c=Ee(),f=c.firstChild,p=f.nextSibling,a=p.firstChild;return c.$$click=Y,i(c,v(C,{get when(){return _()},get children(){var o=Fe();return i(o,v(C,{get when(){return H(()=>!d().loading)()&&d().url},get fallback(){return(()=>{var n=de();return n.style.setProperty("width","100%"),n.style.setProperty("height","100%"),n.style.setProperty("display","flex"),n.style.setProperty("align-items","center"),n.style.setProperty("justify-content","center"),n.style.setProperty("color","#9ca3af"),i(n,(()=>{var l=H(()=>!!d().loading);return()=>l()?"⏳":u(r.blob.mime)})()),N(l=>{var t=`thumbnail-placeholder ${d().loading&&E()?"thumbnail-loading":""}`,e=U()?"24px":"32px";return t!==l.e&&V(n,l.e=t),e!==l.t&&((l.t=e)!=null?n.style.setProperty("font-size",e):n.style.removeProperty("font-size")),l},{e:void 0,t:void 0}),n})()},get children(){var n=ze();return n.addEventListener("error",q),n.addEventListener("load",W),n.style.setProperty("width","100%"),n.style.setProperty("height","100%"),n.style.setProperty("object-fit","cover"),N(l=>{var t=d().url,e=`Thumbnail for ${r.blob.sha256.slice(0,8)}`;return t!==l.e&&ee(n,"src",l.e=t),e!==l.t&&ee(n,"alt",l.t=e),l},{e:void 0,t:void 0}),n}})),N(n=>{var l=`${B()}px`,t=`${B()}px`,e=`${B()}px`,b=`${B()}px`;return l!==n.e&&((n.e=l)!=null?o.style.setProperty("width",l):o.style.removeProperty("width")),t!==n.t&&((n.t=t)!=null?o.style.setProperty("height",t):o.style.removeProperty("height")),e!==n.a&&((n.a=e)!=null?o.style.setProperty("min-width",e):o.style.removeProperty("min-width")),b!==n.o&&((n.o=b)!=null?o.style.setProperty("min-height",b):o.style.removeProperty("min-height")),n},{e:void 0,t:void 0,a:void 0,o:void 0}),o}}),p),p.style.setProperty("min-width","0"),i(a,()=>r.blob.local_path?.split("/").pop()||`${r.blob.sha256.slice(0,8)}...${r.blob.sha256.slice(-4)}`),i(p,v(C,{get when(){return k()},get children(){var o=De(),n=o.firstChild,l=n.firstChild,t=l.nextSibling;return i(l,()=>u(r.blob.mime)),i(t,()=>r.blob.mime||"Unknown type"),i(o,v(C,{get when(){return r.blob.size},get children(){var e=Ie(),b=e.firstChild,$=b.nextSibling;return i($,()=>L(r.blob.size)),e}}),null),i(o,v(C,{get when(){return r.blob.source_client_id},get children(){var e=Te(),b=e.firstChild,$=b.nextSibling,A=$.firstChild;return i($,()=>r.blob.source_client_id?.slice(0,8),A),N(()=>ee($,"title",r.blob.source_client_id)),e}}),null),o}}),null),i(p,v(C,{get when(){return w()},get children(){var o=de();return o.style.setProperty("margin-top","4px"),o.style.setProperty("font-size","11px"),o.style.setProperty("color","#9ca3af"),i(o,v(C,{get when(){return r.blob.created_at!==r.blob.updated_at},get fallback(){return(()=>{var n=Le();return n.firstChild,i(n,()=>S(r.blob.created_at),null),n})()},get children(){var n=Ue(),l=n.firstChild,t=l.nextSibling;return t.nextSibling,i(n,()=>S(r.blob.created_at),t),i(n,()=>S(r.blob.updated_at),null),n}})),o}}),null),N(o=>{var n=`media-blob-feed-item ${U()?"compact":""} ${x()?"clickable":""} ${r.className||""}`,l=r.blob.id,t={display:"flex","flex-direction":U()?"row":"column",gap:U()?"12px":"8px",padding:U()?"8px":"12px",border:"1px solid #e2e8f0","border-radius":"8px","background-color":"#ffffff",cursor:x()?"pointer":"default",transition:"all 0.2s ease",...x()&&{":hover":{"box-shadow":"0 2px 8px rgba(0, 0, 0, 0.1)",transform:"translateY(-1px)"}}},e=U()?"1":"auto";return n!==o.e&&V(c,o.e=n),l!==o.t&&ee(c,"data-blob-id",o.t=l),o.a=fe(c,t,o.a),e!==o.o&&((o.o=e)!=null?p.style.setProperty("flex",e):p.style.removeProperty("flex")),o},{e:void 0,t:void 0,a:void 0,o:void 0}),c})()}ne("media-blob-feed-item",{blob:{},showThumbnail:!0,showMetadata:!0,showTimestamps:!0,compact:!1,clickable:!0,className:"",thumbnailSize:120,showLoadingPlaceholder:!0},me);ie(["click"]);var Ne=g("<div class=header><div>Feed</div><div>"),Be=g("<div class=loading-indicator><div class=loading-spinner>⏳</div><div>Loading feed..."),Ae=g("<div class=error-state><div>⚠️</div><div>Failed to load feed</div><div>"),We=g("<div class=empty-state><div class=empty-icon>📭</div><div></div><div>New items will appear here automatically"),Re=g("<div class=feed-container>"),je=g(`<div><style>
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
      `),He=g("<div>");function ue(r){const[d,D]=j({selectedItemId:null,lastUpdated:null}),_=()=>r.items||[],k=()=>r.loading||!1,w=()=>r.error||null,U=()=>r.emptyMessage||"No items in feed",x=()=>r.maxHeight||"auto",B=()=>r.itemMode||"default",E=()=>r.showThumbnails!==!1,L=()=>r.showMetadata!==!1,S=()=>r.showTimestamps!==!1,u=()=>r.clickableItems!==!1,P=()=>r.thumbnailSize||120,Y=()=>r.showItemCount!==!1,W=()=>r.animationDuration||300,q=Ce(()=>[..._()].sort((a,o)=>{const n=new Date(a.created_at).getTime();return new Date(o.created_at).getTime()-n})),c=a=>{const{blob:o}=a.detail;D(l=>({...l,selectedItemId:o.id===l.selectedItemId?null:o.id}));const n=new CustomEvent("feed-item-selected",{detail:{blob:o,isSelected:o.id!==d().selectedItemId},bubbles:!0});a.target?.dispatchEvent(n)},f=a=>W()<=0?{}:{"animation-delay":`${a*50}ms`,"animation-duration":`${W()}ms`,"animation-fill-mode":"both","animation-name":"feed-item-appear"},p=a=>a===0?"No items":a===1?"1 item":`${a.toLocaleString()} items`;return(()=>{var a=je();return a.firstChild,a.$$click=o=>{const n=o;n.target.closest?.("[data-blob-id]")&&n.detail?.blob&&c(n)},a.style.setProperty("display","flex"),a.style.setProperty("flex-direction","column"),a.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),a.style.setProperty("height","100%"),i(a,v(C,{get when(){return H(()=>!!(Y()&&!k()))()&&!w()},get children(){var o=Ne(),n=o.firstChild,l=n.nextSibling;return n.style.setProperty("font-weight","500"),l.style.setProperty("color","#6b7280"),i(l,()=>p(_().length)),o}}),null),i(a,v(C,{get when(){return k()},get children(){return Be()}}),null),i(a,v(C,{get when(){return H(()=>!!w())()&&!k()},get children(){var o=Ae(),n=o.firstChild,l=n.nextSibling,t=l.nextSibling;return n.style.setProperty("font-size","48px"),n.style.setProperty("margin-bottom","16px"),l.style.setProperty("font-weight","500"),l.style.setProperty("margin-bottom","8px"),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),i(t,w),o}}),null),i(a,v(C,{get when(){return H(()=>!k()&&!w())()&&_().length===0},get children(){var o=We(),n=o.firstChild,l=n.nextSibling,t=l.nextSibling;return l.style.setProperty("font-weight","500"),l.style.setProperty("margin-bottom","8px"),i(l,U),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),o}}),null),i(a,v(C,{get when(){return H(()=>!k()&&!w())()&&_().length>0},get children(){var o=Re();return i(o,v(_e,{get each(){return q()},children:(n,l)=>(()=>{var t=He();return i(t,v(me,{blob:n,get compact(){return B()==="compact"},get showThumbnail(){return E()},get showMetadata(){return L()},get showTimestamps(){return S()},get clickable(){return u()},get thumbnailSize(){return P()}})),N(e=>{var b=`feed-item ${d().selectedItemId===n.id?"selected":""}`,$=f(l());return b!==e.e&&V(t,e.e=b),e.t=fe(t,$,e.t),e},{e:void 0,t:void 0}),t})()})),N(n=>{var l=x(),t=x()!=="auto"?"auto":"visible";return l!==n.e&&((n.e=l)!=null?o.style.setProperty("max-height",l):o.style.removeProperty("max-height")),t!==n.t&&((n.t=t)!=null?o.style.setProperty("overflow",t):o.style.removeProperty("overflow")),n},{e:void 0,t:void 0}),o}}),null),N(()=>V(a,`media-blob-feed-list ${r.className||""}`)),a})()}ne("media-blob-feed-list",{items:[],loading:!1,error:null,emptyMessage:"No items in feed",maxHeight:"auto",itemMode:"default",showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,className:"",thumbnailSize:120,showItemCount:!0,animationDuration:300},ue);ie(["click"]);var Ye=g("<div class=section-header><h3 class=section-title>Connection</h3><div>"),qe=g('<div class=controls><button class="control-button primary">Connect</button><button class="control-button danger">Disconnect</button><button class=control-button>Refresh</button><div>Subscribed: '),Je=g("<div><h3 class=section-title>Feed Statistics</h3><div class=stats-grid><div class=stat-card><div class=stat-value></div><div class=stat-label>Items Loaded</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Total Available</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Last Updated</div></div><div class=stat-card><div class=stat-value></div><div class=stat-label>Subscriptions"),Ke=g("<div><h3 class=section-title>Selected Item</h3><div class=selected-item><div class=selected-item-title></div><div class=selected-item-details>ID: <!> • Type: <!> • Size: "),Ge=g("<div>⚠️ "),Oe=g("<div class=logs-container>"),Qe=g(`<div><style>
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
      </style><div>Feed manager component temporarily disabled for type checking</div><div><h2>🔄 WebSocket Feed Demo</h2><p>Real-time media blob feed powered by WebSocket notifications</p></div><div><h3 class=section-title>Live Feed</h3></div><div><div class=section-header><h3 class=section-title>Activity Log</h3><div><button class=toggle-button></button><button class=toggle-button>Clear`),Ve=g("<div>No activity yet..."),Xe=g("<div>");function Ze(r){const[d,D]=j({items:[],isLoading:!1,isConnected:!1,connectionStatus:T.Disconnected,subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),[_,k]=j([]),[w,U]=j(null),[x,B]=j(!1);let E,L;const S=()=>r.debug||!1,u=()=>S()&&!1,P=()=>r.itemMode||"default",Y=()=>r.maxHeight||"400px",W=()=>r.showControls!==!1,q=()=>r.showStats!==!1,c=()=>r.refreshInterval||0,f=(s,m=!1)=>{if(m&&!u())return;const J=new Date().toLocaleTimeString();k(X=>[...X.slice(-19),`[${J}] ${s}`])},p=()=>(f("❌ Feed manager ref is null",!0),null),a=()=>{const s=p();if(s)try{const m=s.getFeedState();m?(m.items.length!==d().items.length&&f(`📦 Feed updated: ${m.items.length} items`),m.isConnected!==d().isConnected&&f(`🔌 ${m.isConnected?"Connected":"Disconnected"}`),m.error&&m.error!==d().error&&f(`❌ Error: ${m.error}`),u()&&Math.random()<.1,D(m)):f("⚠️ Manager returned null state",!0)}catch(m){f(`❌ Error getting feed state: ${m instanceof Error?m.message:"Unknown error"}`),console.error("Feed state error:",m)}else u()},o=()=>{const s=p();if(s){f("🔌 Connecting...");try{s.connect(),setTimeout(a,100)}catch(m){f(`❌ Connect failed: ${m instanceof Error?m.message:"Unknown error"}`),console.error("Connect error:",m)}}else f("❌ Feed manager not available")},n=()=>{const s=p();if(s){f("🔌 Disconnecting...");try{s.disconnect(),setTimeout(a,100)}catch(m){f(`❌ Disconnect failed: ${m instanceof Error?m.message:"Unknown error"}`),console.error("Disconnect error:",m)}}else f("❌ Feed manager not available")},l=()=>{const s=p();if(s){f("🔄 Refreshing...");try{s.refresh()}catch(m){f(`❌ Refresh failed: ${m instanceof Error?m.message:"Unknown error"}`)}}else f("❌ Feed manager not available")},t=s=>{const{blob:m,isSelected:J}=s.detail;U(J?m:null),f(`${J?"Selected":"Deselected"} item: ${m.id.slice(0,8)}`)},e=()=>{k([])},b=s=>{switch(s){case T.Connected:return"🟢 Connected";case T.Connecting:return"🟡 Connecting";case T.Disconnected:return"🔴 Disconnected";case T.Error:return"❌ Error";default:return"⚪ Unknown"}},$=s=>{switch(s){case T.Connected:return"#10b981";case T.Connecting:return"#f59e0b";case T.Disconnected:return"#6b7280";case T.Error:return"#ef4444";default:return"#9ca3af"}},A=()=>{c()>0&&(E=window.setInterval(()=>{d().isConnected&&l()},c()*1e3))},R=()=>{E&&(clearInterval(E),E=void 0)},ge=()=>{L&&clearInterval(L),L=setInterval(()=>{try{a()}catch(s){console.warn("Error polling feed manager state:",s),f(`Polling error: ${s instanceof Error?s.message:"Unknown error"}`)}},1e3)},he=()=>{L&&(clearInterval(L),L=void 0)};return te(()=>{u()}),ce(()=>{f("🚀 Feed demo initialized"),setTimeout(()=>{f("🔍 Starting state polling...",!0),ge(),a()},1e3),A()}),be(()=>{f("🧹 Feed demo cleanup",!0),he(),R()}),(()=>{var s=Qe(),m=s.firstChild,J=m.nextSibling,X=J.nextSibling,Z=X.firstChild,oe=Z.nextSibling,K=X.nextSibling;K.firstChild;var se=K.nextSibling,ye=se.firstChild,pe=ye.firstChild,ve=pe.nextSibling,re=ve.firstChild,ae=re.nextSibling;return ke(s,"feed-item-selected",t),s.style.setProperty("display","flex"),s.style.setProperty("flex-direction","column"),s.style.setProperty("gap","16px"),s.style.setProperty("padding","20px"),s.style.setProperty("border-radius","12px"),s.style.setProperty("background-color","#ffffff"),s.style.setProperty("border","1px solid #e2e8f0"),s.style.setProperty("box-shadow","0 1px 3px rgba(0, 0, 0, 0.1)"),s.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),s.style.setProperty("max-width","800px"),s.style.setProperty("margin","0 auto"),J.style.setProperty("display","none"),X.style.setProperty("text-align","center"),Z.style.setProperty("margin","0 0 8px 0"),Z.style.setProperty("color","#111827"),Z.style.setProperty("font-size","24px"),oe.style.setProperty("margin","0"),oe.style.setProperty("color","#6b7280"),oe.style.setProperty("font-size","14px"),i(s,v(C,{get when(){return W()},get children(){return[(()=>{var h=Ye(),F=h.firstChild,y=F.nextSibling;return y.style.setProperty("display","flex"),y.style.setProperty("align-items","center"),y.style.setProperty("gap","12px"),y.style.setProperty("padding","6px 12px"),y.style.setProperty("border-radius","20px"),y.style.setProperty("font-size","12px"),y.style.setProperty("font-weight","500"),i(y,()=>b(d().connectionStatus)),N(I=>{var M=$(d().connectionStatus)+"20",z=$(d().connectionStatus);return M!==I.e&&((I.e=M)!=null?y.style.setProperty("background-color",M):y.style.removeProperty("background-color")),z!==I.t&&((I.t=z)!=null?y.style.setProperty("color",z):y.style.removeProperty("color")),I},{e:void 0,t:void 0}),h})(),(()=>{var h=qe(),F=h.firstChild,y=F.nextSibling,I=y.nextSibling,M=I.nextSibling;return M.firstChild,F.$$click=o,y.$$click=n,I.$$click=l,M.style.setProperty("margin-left","auto"),M.style.setProperty("font-size","12px"),M.style.setProperty("color","#6b7280"),i(M,()=>d().subscribedChannels.join(", ")||"None",null),N(z=>{var G=d().isConnected,O=!d().isConnected,Q=!d().isConnected;return G!==z.e&&(F.disabled=z.e=G),O!==z.t&&(y.disabled=z.t=O),Q!==z.a&&(I.disabled=z.a=Q),z},{e:void 0,t:void 0,a:void 0}),h})()]}}),K),i(s,v(C,{get when(){return q()},get children(){var h=Je(),F=h.firstChild,y=F.nextSibling,I=y.firstChild,M=I.firstChild,z=I.nextSibling,G=z.firstChild,O=z.nextSibling,Q=O.firstChild,le=O.nextSibling,we=le.firstChild;return i(M,()=>d().items.length),i(G,()=>d().totalCount),i(Q,(()=>{var xe=H(()=>!!d().lastUpdated);return()=>xe()?d().lastUpdated.toLocaleTimeString():"Never"})()),i(we,()=>d().subscribedChannels.length),h}}),K),i(s,v(C,{get when(){return w()},get children(){var h=Ke(),F=h.firstChild,y=F.nextSibling,I=y.firstChild,M=I.nextSibling,z=M.firstChild,G=z.nextSibling,O=G.nextSibling,Q=O.nextSibling;return Q.nextSibling,i(I,()=>w().local_path?.split("/").pop()||`${w().sha256.slice(0,8)}...${w().sha256.slice(-4)}`),i(M,()=>w().id,G),i(M,()=>w().mime||"Unknown",Q),i(M,(()=>{var le=H(()=>!!w().size);return()=>le()?`${(w().size/1024).toFixed(1)} KB`:"Unknown"})(),null),h}}),K),i(s,v(C,{get when(){return d().error},get children(){var h=Ge();return h.firstChild,h.style.setProperty("padding","12px"),h.style.setProperty("border-radius","6px"),h.style.setProperty("background-color","#fee2e2"),h.style.setProperty("color","#991b1b"),h.style.setProperty("border","1px solid #fecaca"),h.style.setProperty("font-size","14px"),i(h,()=>d().error,null),h}}),K),i(K,v(ue,{get items(){return d().items},get loading(){return d().isLoading},get error(){return d().error},emptyMessage:"No media blobs in feed yet",get maxHeight(){return Y()},get itemMode(){return P()},showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,get thumbnailSize(){return P()==="compact"?60:100},showItemCount:!0,animationDuration:300}),null),re.$$click=()=>B(!x()),i(re,()=>x()?"Hide":"Show"),ae.$$click=e,ae.style.setProperty("margin-left","8px"),i(se,v(C,{get when(){return x()},get children(){var h=Oe();return i(h,v(C,{get when(){return _().length>0},get fallback(){return(()=>{var F=Ve();return F.style.setProperty("color","#9ca3af"),F.style.setProperty("font-style","italic"),F})()},get children(){return _().map(F=>(()=>{var y=Xe();return y.style.setProperty("margin-bottom","2px"),i(y,F),y})())}})),h}}),null),N(()=>V(s,`websocket-feed-demo ${r.className||""}`)),s})()}ne("websocket-feed-demo",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,itemMode:"default",maxHeight:"400px",showControls:!0,showStats:!0,className:"",refreshInterval:0},Ze);ie(["click"]);
//# sourceMappingURL=websocket-feed-demo.js.map
