import"./webauthn-auth.js";import"./websocket-status-BrBvaJs0.js";import"./websocket-components.js";import{F as _e,W as ke}from"./websocket-demo.js";import{c as T,g as oe,o as Se,f as be,t as g,l as he,b as W,e as X,d as ne,k as n,i as P,S,n as Z,m as te,q as Ce,s as ve,h as ze,F as xe,r as Ue}from"./web-D0fRMFns.js";import{c as ie}from"./index-BR1eXDF4.js";import{C as ae,W as Ie}from"./websocket-client-Dbi0hGVw.js";import"./websocket-feed-demo.js";import"./websocket-thumbnail-demo.js";import{B as we,a as Fe}from"./blob-client-D03S6GRu.js";import"./api-client-Ciyqoh98.js";import"./sync-demo.js";import"./sync-storage-R5N8-t1a.js";import"./unified-sync-demo.js";import"./infinite-data-grid.js";import"./generic-infinite-grid-Bxa11vs7.js";import"./product-data-grid-demo.js";import"./event-utils-DIzmYpNO.js";import"./types-CGPwAX3k.js";import"./thumbnail-utils-DSXFRRv-.js";import"./useThumbnail-CL5PYp8y.js";import"./index-BOxccIN9.js";import"./date-utils-CshQIybG.js";var Me=g("<div>");function Ee(r){const[h,z]=T(null),[I,C]=T({items:[],isLoading:!1,isConnected:!1,connectionStatus:ae.Disconnected,subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),A=()=>r.wsUrl||"ws://localhost:8080/ws",[G,E]=T(["MediaBlobs"]);oe(()=>{const t=r.channels;if(!t||Array.isArray(t)&&t.length===0){E(["MediaBlobs"]);return}if(Array.isArray(t)){E(t);return}if(typeof t=="string")try{const e=JSON.parse(t);Array.isArray(e)?E(e):E(["MediaBlobs"])}catch(e){F("Failed to parse channels prop, using default:",e),E(["MediaBlobs"])}else E(["MediaBlobs"])});const Y=()=>G(),L=()=>r.debug||!1,H=()=>r.pageSize||20,F=(...t)=>{L()&&console.log("[WebSocketFeedManager]",...t)},$=(...t)=>{L()},U=t=>{C(e=>({...e,...t}))},O=t=>{C(e=>({...e,items:[t,...e.items],totalCount:e.totalCount+1,lastUpdated:new Date})),$("Added new feed item:",t.id)},V=t=>{C(e=>({...e,items:e.items.map(d=>d.id===t.id?t:d),lastUpdated:new Date})),$("Updated feed item:",t.id)},Q=t=>{C(e=>({...e,items:e.items.filter(d=>d.id!==t),totalCount:Math.max(0,e.totalCount-1),lastUpdated:new Date})),$("Removed feed item:",t)},J=()=>{const t=h();t&&(U({isLoading:!0,error:null}),$("Loading initial feed..."),t.getMediaBlobs(H(),0)||U({isLoading:!1,error:"Failed to request initial feed data"}))},x=()=>{const t=h();if(!t)return;const e=I();$("Unsubscribing from channels:",e.subscribedChannels),e.subscribedChannels.forEach(d=>{t.unsubscribeFromNotifications(d)||$("Failed to unsubscribe from channel:",d)})},l=()=>{const t=new Ie({url:A(),autoReconnect:!0,reconnectDelay:3e3,maxReconnectAttempts:0,debug:L()});return t.on("statusChange",e=>{if(F("Connection status changed:",e),U({connectionStatus:e,isConnected:e===ae.Connected}),e===ae.Connected){J();const d=I().subscribedChannels,b=Y().filter(p=>!d.includes(p));b.length>0&&b.forEach(p=>{t.subscribeToNotifications(p)})}else e===ae.Disconnected&&U({subscribedChannels:[]})}),t.on("welcome",e=>{$("Connected to WebSocket:",e),U({error:null})}),t.on("mediaBlobs",e=>{F("Loaded",e.blobs.length,"media blobs"),U({items:e.blobs,totalCount:e.total_count,isLoading:!1,lastUpdated:new Date,error:null})}),t.on("mediaBlob",e=>{$("Received single media blob:",e.blob.id),V(e.blob)}),t.on("notification",e=>{if($("Received notification:",e),e.channel==="MediaBlobs")switch(e.event_type){case"media_blob.created":e.payload&&e.payload.media_blob&&(F("📦 New media blob:",e.payload.media_blob.id.slice(0,8)),O(e.payload.media_blob));break;case"media_blob.updated":e.payload&&e.payload.media_blob&&($("Updated media blob:",e.payload.media_blob.id),V(e.payload.media_blob));break;case"media_blob.deleted":e.payload&&e.payload.media_blob_id&&(F("🗑️ Deleted media blob:",e.payload.media_blob_id.slice(0,8)),Q(e.payload.media_blob_id));break;default:$("Unknown media blob event:",e.event_type)}}),t.on("notificationSubscribed",e=>{$("Subscribed to channel:",e.channel),C(d=>({...d,subscribedChannels:d.subscribedChannels.includes(e.channel)?d.subscribedChannels:[...d.subscribedChannels,e.channel]}))}),t.on("notificationUnsubscribed",e=>{$("Unsubscribed from channel:",e.channel),C(d=>({...d,subscribedChannels:d.subscribedChannels.filter(b=>b!==e.channel)}))}),t.on("notificationStatus",e=>{$("Notification status:",e),U({subscribedChannels:e.subscribed_channels})}),t.on("error",e=>{F("❌ WebSocket error:",e.message),U({error:e.message})}),t.on("parseError",e=>{F("❌ Parse error:",e.message),U({error:`Parse error: ${e.message}`})}),z(t),t},u=()=>{const t=h();t&&t.connect()},o=()=>{const t=h();t&&(x(),t.disconnect())},f={connect:u,disconnect:o,refresh:()=>{h()&&I().isConnected&&J()},getFeedState:()=>I(),getClient:()=>h()};return Se(()=>{F("Initializing WebSocket feed manager");const t=l();r.autoConnect!==!1&&t.connect()}),be(()=>{F("Cleaning up WebSocket feed manager"),o()}),oe(()=>{const t=Y(),e=I().subscribedChannels,d=h();if(d&&I().isConnected){const b=e.filter(i=>!t.includes(i)),p=t.filter(i=>!e.includes(i));(b.length>0||p.length>0)&&(b.forEach(i=>{d.unsubscribeFromNotifications(i)}),p.forEach(i=>{d.subscribeToNotifications(i)}))}}),(()=>{var t=Me();return he(e=>{const d=e.closest("websocket-feed-manager");d?(d.feedManager=f,$("Feed manager methods exposed on custom element")):$("Could not find custom element parent")},t),t.style.setProperty("display","none"),W(()=>X(t,`websocket-feed-manager ${r.className||""}`)),t})()}ie("websocket-feed-manager",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,pageSize:20,className:""},Ee);var Be=g("<img>"),Le=g("<div class=thumbnail-container>"),Te=g("<div class=metadata-item><span>📏</span><span>"),De=g("<div class=metadata-item><span>📱</span><span>..."),We=g("<div class=metadata><div class=metadata-item><span></span><span>"),Ae=g("<span>Added <!> • Updated "),le=g("<div>"),He=g("<blob-viewer maxwidth=100% maxheight=300px>",!0,!1,!1),Ne=g(`<div><style>
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
      </style><div class=content><div><div><h3 class=title></h3></div><div><button title="View blob content">👁️ </button><button title="Download blob">📥</button><button title="Copy blob ID">📋`),Re=g("<span>Added "),je=g("<div>Loading blob content...");function $e(r){const[h,z]=T({loading:!0,error:!1,url:null}),[I,C]=T(!1),[A,G]=T(!1),[E,Y]=T(null),L=new we({baseUrl:r.baseUrl||window.location.origin}),H=()=>r.showThumbnail!==!1,F=()=>r.showMetadata!==!1,$=()=>r.showTimestamps!==!1,U=()=>r.compact||!1,O=()=>r.clickable!==!1,V=()=>r.thumbnailSize||120,Q=()=>r.showLoadingPlaceholder!==!1,J=()=>r.enableInlineViewer!==!1,x=i=>{if(!i)return"Unknown size";const w=["B","KB","MB","GB"];let B=0,N=i;for(;N>=1024&&B<w.length-1;)N/=1024,B++;return`${N.toFixed(B>0?1:0)} ${w[B]}`},l=i=>{try{const w=new Date(i),N=new Date().getTime()-w.getTime(),R=Math.floor(N/(1e3*60)),j=Math.floor(R/60),D=Math.floor(j/24);return R<1?"Just now":R<60?`${R}m ago`:j<24?`${j}h ago`:D<7?`${D}d ago`:w.toLocaleDateString()}catch{return"Unknown time"}},u=i=>i?i.startsWith("image/")?"🖼️":i.startsWith("video/")?"🎬":i.startsWith("audio/")?"🎵":i.includes("pdf")?"📋":i.includes("text")?"📝":"📄":"📄",o=async()=>{if(H()){z({loading:!0,error:!1,url:null});try{const i=`/api/v1/media_blobs/${r.blob.id}/thumbnail`;(await fetch(i,{method:"HEAD",credentials:"include"})).ok?z({loading:!1,error:!1,url:i}):z({loading:!1,error:!1,url:null})}catch(i){console.warn("Failed to load thumbnail for",r.blob.id,i),z({loading:!1,error:!0,url:null})}}},a=()=>{if(O())if(J())f();else{const i=new CustomEvent("media-blob-click",{detail:{blob:r.blob},bubbles:!0});document.querySelector(`[data-blob-id="${r.blob.id}"]`)?.dispatchEvent(i)}},f=()=>{C(!I()),I()||Y(null)},t=async i=>{if(i.stopPropagation(),!J()){window.open(`/api/blobs/${r.blob.id}`,"_blank");return}G(!0),Y(null),C(!0);try{await L.getBlobMetadata(r.blob.id)}catch(w){Y(`Failed to load blob: ${w}`)}finally{G(!1)}},e=async i=>{i.stopPropagation();try{const w=r.blob.metadata?.filename||`blob-${r.blob.id}`;await L.downloadBlob(r.blob.id,w)}catch(w){console.error("Download failed:",w)}},d=async i=>{i.stopPropagation();try{await navigator.clipboard.writeText(r.blob.id)}catch(B){console.error("Failed to copy blob ID:",B)}const w=document.querySelector(`[data-blob-id="${r.blob.id}"]`);event&&w?.dispatchEvent(event)},b=()=>{z(i=>({...i,loading:!1}))},p=()=>{z(i=>({...i,loading:!1,error:!0}))};return oe(()=>{r.blob?.id&&o()}),(()=>{var i=Ne(),w=i.firstChild,B=w.nextSibling,N=B.firstChild,R=N.firstChild,j=R.firstChild,D=R.nextSibling,y=D.firstChild;y.firstChild;var v=y.nextSibling,_=v.nextSibling;return i.$$click=a,n(i,P(S,{get when(){return H()},get children(){var m=Le();return n(m,P(S,{get when(){return te(()=>!h().loading)()&&h().url},get fallback(){return(()=>{var s=le();return s.style.setProperty("width","100%"),s.style.setProperty("height","100%"),s.style.setProperty("display","flex"),s.style.setProperty("align-items","center"),s.style.setProperty("justify-content","center"),s.style.setProperty("color","#9ca3af"),n(s,(()=>{var c=te(()=>!!h().loading);return()=>c()?"⏳":u(r.blob.mime)})()),W(c=>{var M=`thumbnail-placeholder ${h().loading&&Q()?"thumbnail-loading":""}`,k=U()?"24px":"32px";return M!==c.e&&X(s,c.e=M),k!==c.t&&((c.t=k)!=null?s.style.setProperty("font-size",k):s.style.removeProperty("font-size")),c},{e:void 0,t:void 0}),s})()},get children(){var s=Be();return s.addEventListener("error",p),s.addEventListener("load",b),s.style.setProperty("width","100%"),s.style.setProperty("height","100%"),s.style.setProperty("object-fit","cover"),W(c=>{var M=h().url,k=`Thumbnail for ${r.blob.sha256.slice(0,8)}`;return M!==c.e&&Z(s,"src",c.e=M),k!==c.t&&Z(s,"alt",c.t=k),c},{e:void 0,t:void 0}),s}})),W(s=>{var c=`${V()}px`,M=`${V()}px`,k=`${V()}px`,q=`${V()}px`;return c!==s.e&&((s.e=c)!=null?m.style.setProperty("width",c):m.style.removeProperty("width")),M!==s.t&&((s.t=M)!=null?m.style.setProperty("height",M):m.style.removeProperty("height")),k!==s.a&&((s.a=k)!=null?m.style.setProperty("min-width",k):m.style.removeProperty("min-width")),q!==s.o&&((s.o=q)!=null?m.style.setProperty("min-height",q):m.style.removeProperty("min-height")),s},{e:void 0,t:void 0,a:void 0,o:void 0}),m}}),B),B.style.setProperty("min-width","0"),N.style.setProperty("display","flex"),N.style.setProperty("justify-content","space-between"),N.style.setProperty("align-items","flex-start"),N.style.setProperty("gap","8px"),R.style.setProperty("flex","1"),R.style.setProperty("min-width","0"),n(j,()=>r.blob.local_path?.split("/").pop()||`${r.blob.sha256.slice(0,8)}...${r.blob.sha256.slice(-4)}`),n(R,P(S,{get when(){return F()},get children(){var m=We(),s=m.firstChild,c=s.firstChild,M=c.nextSibling;return n(c,()=>u(r.blob.mime)),n(M,()=>r.blob.mime||"Unknown type"),n(m,P(S,{get when(){return r.blob.size},get children(){var k=Te(),q=k.firstChild,ee=q.nextSibling;return n(ee,()=>x(r.blob.size)),k}}),null),n(m,P(S,{get when(){return r.blob.source_client_id},get children(){var k=De(),q=k.firstChild,ee=q.nextSibling,se=ee.firstChild;return n(ee,()=>r.blob.source_client_id?.slice(0,8),se),W(()=>Z(ee,"title",r.blob.source_client_id)),k}}),null),m}}),null),n(R,P(S,{get when(){return $()},get children(){var m=le();return m.style.setProperty("margin-top","4px"),m.style.setProperty("font-size","11px"),m.style.setProperty("color","#9ca3af"),n(m,P(S,{get when(){return r.blob.created_at!==r.blob.updated_at},get fallback(){return(()=>{var s=Re();return s.firstChild,n(s,()=>l(r.blob.created_at),null),s})()},get children(){var s=Ae(),c=s.firstChild,M=c.nextSibling;return M.nextSibling,n(s,()=>l(r.blob.created_at),M),n(s,()=>l(r.blob.updated_at),null),s}})),m}}),null),D.style.setProperty("display","flex"),D.style.setProperty("gap","4px"),D.style.setProperty("flex-shrink","0"),y.$$click=t,y.style.setProperty("padding","4px 8px"),y.style.setProperty("font-size","12px"),y.style.setProperty("border","1px solid #d1d5db"),y.style.setProperty("border-radius","4px"),y.style.setProperty("background-color","#f9fafb"),y.style.setProperty("cursor","pointer"),y.style.setProperty("display","flex"),y.style.setProperty("align-items","center"),y.style.setProperty("gap","4px"),n(y,()=>I()?"Hide":"View",null),v.$$click=e,v.style.setProperty("padding","4px 8px"),v.style.setProperty("font-size","12px"),v.style.setProperty("border","1px solid #d1d5db"),v.style.setProperty("border-radius","4px"),v.style.setProperty("background-color","#f9fafb"),v.style.setProperty("cursor","pointer"),v.style.setProperty("display","flex"),v.style.setProperty("align-items","center"),v.style.setProperty("gap","4px"),_.$$click=d,_.style.setProperty("padding","4px 8px"),_.style.setProperty("font-size","12px"),_.style.setProperty("border","1px solid #d1d5db"),_.style.setProperty("border-radius","4px"),_.style.setProperty("background-color","#f9fafb"),_.style.setProperty("cursor","pointer"),_.style.setProperty("display","flex"),_.style.setProperty("align-items","center"),_.style.setProperty("gap","4px"),n(B,P(S,{get when(){return I()},get children(){var m=le();return m.style.setProperty("margin-top","12px"),m.style.setProperty("padding","12px"),m.style.setProperty("border","1px solid #e5e7eb"),m.style.setProperty("border-radius","6px"),m.style.setProperty("background-color","#f9fafb"),n(m,P(S,{get when(){return te(()=>!A())()&&!E()},get fallback(){return(()=>{var s=le();return n(s,P(S,{get when(){return A()},get children(){var c=je();return c.style.setProperty("text-align","center"),c.style.setProperty("padding","20px"),c.style.setProperty("color","#6b7280"),c}}),null),n(s,P(S,{get when(){return E()},get children(){var c=le();return c.style.setProperty("padding","12px"),c.style.setProperty("background-color","#fef2f2"),c.style.setProperty("color","#dc2626"),c.style.setProperty("border-radius","4px"),c.style.setProperty("border","1px solid #fecaca"),n(c,E),c}}),null),s})()},get children(){var s=He();return s.showmetadata=!1,s.enabledownload=!1,s.autoload=!0,s._$owner=Ce(),W(c=>{var M=r.blob.id,k=r.baseUrl;return M!==c.e&&(s.blobid=c.e=M),k!==c.t&&(s.baseurl=c.t=k),c},{e:void 0,t:void 0}),s}})),m}}),null),W(m=>{var s=`media-blob-feed-item ${U()?"compact":""} ${O()?"clickable":""} ${r.className||""}`,c=r.blob.id,M={display:"flex","flex-direction":U()?"row":"column",gap:U()?"12px":"8px",padding:U()?"8px":"12px",border:"1px solid #e2e8f0","border-radius":"8px","background-color":"#ffffff",cursor:O()?"pointer":"default",transition:"all 0.2s ease",...O()&&{":hover":{"box-shadow":"0 2px 8px rgba(0, 0, 0, 0.1)",transform:"translateY(-1px)"}}},k=U()?"1":"auto";return s!==m.e&&X(i,m.e=s),c!==m.t&&Z(i,"data-blob-id",m.t=c),m.a=ve(i,M,m.a),k!==m.o&&((m.o=k)!=null?B.style.setProperty("flex",k):B.style.removeProperty("flex")),m},{e:void 0,t:void 0,a:void 0,o:void 0}),i})()}ie("media-blob-feed-item",{blob:{},showThumbnail:!0,showMetadata:!0,showTimestamps:!0,compact:!1,clickable:!0,className:"",thumbnailSize:120,showLoadingPlaceholder:!0,baseUrl:void 0,enableInlineViewer:!0},$e);ne(["click"]);var Ve=g("<div class=header><div>Feed</div><div>"),Oe=g("<div class=loading-indicator><div class=loading-spinner>⏳</div><div>Loading feed..."),Ye=g("<div class=error-state><div>⚠️</div><div>Failed to load feed</div><div>"),qe=g("<div class=empty-state><div class=empty-icon>📭</div><div></div><div>New items will appear here automatically"),Ge=g("<div class=feed-container>"),Je=g(`<div><style>
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
      `),Ke=g("<div>");function Qe(r){const[h,z]=T({selectedItemId:null,lastUpdated:null}),I=()=>r.items||[],C=()=>r.loading||!1,A=()=>r.error||null,G=()=>r.emptyMessage||"No items in feed",E=()=>r.maxHeight||"auto",Y=()=>r.itemMode||"default",L=()=>r.showThumbnails!==!1,H=()=>r.showMetadata!==!1,F=()=>r.showTimestamps!==!1,$=()=>r.clickableItems!==!1,U=()=>r.thumbnailSize||120,O=()=>r.showItemCount!==!1,V=()=>r.animationDuration||300,Q=ze(()=>[...I()].sort((u,o)=>{const a=new Date(u.created_at).getTime();return new Date(o.created_at).getTime()-a})),J=u=>{const{blob:o}=u.detail;z(f=>({...f,selectedItemId:o.id===f.selectedItemId?null:o.id}));const a=new CustomEvent("feed-item-selected",{detail:{blob:o,isSelected:o.id!==h().selectedItemId},bubbles:!0});u.target?.dispatchEvent(a)},x=u=>V()<=0?{}:{"animation-delay":`${u*50}ms`,"animation-duration":`${V()}ms`,"animation-fill-mode":"both","animation-name":"feed-item-appear"},l=u=>u===0?"No items":u===1?"1 item":`${u.toLocaleString()} items`;return(()=>{var u=Je();return u.firstChild,u.$$click=o=>{const a=o;a.target.closest?.("[data-blob-id]")&&a.detail?.blob&&J(a)},u.style.setProperty("display","flex"),u.style.setProperty("flex-direction","column"),u.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),u.style.setProperty("height","100%"),n(u,P(S,{get when(){return te(()=>!!(O()&&!C()))()&&!A()},get children(){var o=Ve(),a=o.firstChild,f=a.nextSibling;return a.style.setProperty("font-weight","500"),f.style.setProperty("color","#6b7280"),n(f,()=>l(I().length)),o}}),null),n(u,P(S,{get when(){return C()},get children(){return Oe()}}),null),n(u,P(S,{get when(){return te(()=>!!A())()&&!C()},get children(){var o=Ye(),a=o.firstChild,f=a.nextSibling,t=f.nextSibling;return a.style.setProperty("font-size","48px"),a.style.setProperty("margin-bottom","16px"),f.style.setProperty("font-weight","500"),f.style.setProperty("margin-bottom","8px"),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),n(t,A),o}}),null),n(u,P(S,{get when(){return te(()=>!C()&&!A())()&&I().length===0},get children(){var o=qe(),a=o.firstChild,f=a.nextSibling,t=f.nextSibling;return f.style.setProperty("font-weight","500"),f.style.setProperty("margin-bottom","8px"),n(f,G),t.style.setProperty("font-size","14px"),t.style.setProperty("opacity","0.8"),o}}),null),n(u,P(S,{get when(){return te(()=>!C()&&!A())()&&I().length>0},get children(){var o=Ge();return n(o,P(xe,{get each(){return Q()},children:(a,f)=>(()=>{var t=Ke();return n(t,P($e,{blob:a,get compact(){return Y()==="compact"},get showThumbnail(){return L()},get showMetadata(){return H()},get showTimestamps(){return F()},get clickable(){return $()},get thumbnailSize(){return U()}})),W(e=>{var d=`feed-item ${h().selectedItemId===a.id?"selected":""}`,b=x(f());return d!==e.e&&X(t,e.e=d),e.t=ve(t,b,e.t),e},{e:void 0,t:void 0}),t})()})),W(a=>{var f=E(),t=E()!=="auto"?"auto":"visible";return f!==a.e&&((a.e=f)!=null?o.style.setProperty("max-height",f):o.style.removeProperty("max-height")),t!==a.t&&((a.t=t)!=null?o.style.setProperty("overflow",t):o.style.removeProperty("overflow")),a},{e:void 0,t:void 0}),o}}),null),W(()=>X(u,`media-blob-feed-list ${r.className||""}`)),u})()}ie("media-blob-feed-list",{items:[],loading:!1,error:null,emptyMessage:"No items in feed",maxHeight:"auto",itemMode:"default",showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,className:"",thumbnailSize:120,showItemCount:!0,animationDuration:300},Qe);ne(["click"]);var Xe=g("<div><h2>Simple Solid.js Test</h2><p>Count: </p><button>Increment");console.log("🚀 Script started loading");function Ze(){console.log("📦 SimpleTest component created");const[r,h]=T(0);return(()=>{var z=Xe(),I=z.firstChild,C=I.nextSibling;C.firstChild;var A=C.nextSibling;return z.style.setProperty("padding","20px"),z.style.setProperty("border","1px solid #ccc"),z.style.setProperty("margin","20px"),n(C,r,null),A.$$click=()=>h(r()+1),z})()}class et extends HTMLElement{dispose;connectedCallback(){console.log("🔌 SimpleTestElement connected");try{this.dispose=Ue(()=>P(Ze,{}),this),console.log("✅ Render successful")}catch(h){console.error("❌ Render failed:",h)}}disconnectedCallback(){console.log("🔌 SimpleTestElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register custom element");try{customElements.define("simple-test",et),console.log("✅ Custom element registered successfully")}catch(r){console.error("❌ Failed to register custom element:",r)}ne(["click"]);var tt=g("<div class=upload-list>"),rt=g("<div class=controls><button class=control-button>Clear Completed</button><span> total, <!> completed"),lt=g("<div class=threshold-info><strong>Upload Routing:</strong><br>• Files &lt; <!>: WebSocket (stored in database)<br>• Files ≥ <!>: HTTP API (stored on disk, admin only)"),ot=g(`<div class=smart-file-upload><style>
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
      </style><div><div>📁</div><div>Drop files here or click to browse</div><div>Small files (&lt;<!>) use WebSocket, large files use HTTP API</div><button class=upload-button>Select Files</button></div><input type=file class=hidden>`),nt=g('<button class="action-button retry">Retry'),it=g('<div class=upload-progress><div class=progress-bar><div></div></div><div class=upload-status><span></span><div class=upload-actions><button class="action-button remove">Remove'),st=g("<div class=upload-item><div class=upload-header><div class=upload-info><div class=upload-filename></div><div class=upload-details><span></span><span></span><span>");const at=r=>{const[h,z]=T([]),[I,C]=T(!1),[A,G]=T(null),[E,Y]=T(null),L=()=>r.sizeThreshold||10*1024*1024,H=()=>r.baseUrl||window.location.origin;let F;oe(()=>{const e=new _e({baseUrl:H(),minFileSize:L(),maxFileSize:1073741824});e.addEventListener("upload-progress",b=>{const{uploadId:p,stage:i,progress:w,error:B}=b.detail;$(p,w,i==="error"?"error":"uploading",B?.message)}),G(e);const d=new ke({maxFileSize:L()});d.addEventListener("upload-processed",b=>{const{uploadId:p,blob:i}=b.detail;r.websocketConnection?r.websocketConnection.uploadMediaBlob(i)?$(p,100,"completed"):$(p,0,"error","Failed to send via WebSocket"):$(p,0,"error","WebSocket not connected")}),d.addEventListener("upload-error",b=>{const{uploadId:p,error:i}=b.detail;$(p,0,"error",i)}),Y(d),be(()=>{e.cancelAllUploads(),d.destroy()})});const $=(e,d,b,p)=>{z(i=>i.map(w=>w.id===e?{...w,progress:d,status:b,error:p}:w))},U=async e=>{const d=Array.from(e),b=[];for(const p of d){const i=crypto.randomUUID(),w=p.size>=L()?"http":"websocket";b.push({id:i,file:p,method:w,status:"pending",progress:0})}z(p=>[...p,...b]);for(const p of b)p.method==="http"?O(p):V(p)},O=async e=>{const d=A();if(d){$(e.id,0,"uploading");try{const b=await d.uploadFile(e.file,{uploadedVia:"smart-file-upload",originalMethod:"http",originalName:e.file.name});$(e.id,100,"completed"),z(p=>p.map(i=>i.id===e.id?{...i,result:b}:i))}catch(b){const p=b instanceof Error?b.message:String(b);$(e.id,0,"error",p)}}},V=async e=>{const d=E();if(d){$(e.id,0,"uploading");try{await d.addFiles([e.file])}catch(b){const p=b instanceof Error?b.message:String(b);$(e.id,0,"error",p)}}},Q=e=>{z(d=>d.filter(b=>b.id!==e))},J=()=>{z(e=>e.filter(d=>d.status!=="completed"))},x=e=>{e.method==="http"?O(e):V(e)},l=e=>{const d=e.target;d.files&&d.files.length>0&&(U(d.files),d.value="")},u=e=>{e.preventDefault(),C(!0)},o=e=>{e.preventDefault(),C(!1)},a=e=>{e.preventDefault(),C(!1),e.dataTransfer?.files&&U(e.dataTransfer.files)},f=e=>{if(!e)return"0 B";const d=["B","KB","MB","GB"];let b=e,p=0;for(;b>=1024&&p<d.length-1;)b/=1024,p++;return`${b.toFixed(1)} ${d[p]}`},t=e=>e==="websocket"?"WebSocket":"HTTP API";return(()=>{var e=ot(),d=e.firstChild,b=d.nextSibling,p=b.firstChild,i=p.nextSibling,w=i.nextSibling,B=w.firstChild,N=B.nextSibling;N.nextSibling;var R=w.nextSibling,j=b.nextSibling;b.addEventListener("drop",a),b.addEventListener("dragleave",o),b.addEventListener("dragover",u),b.$$click=()=>!r.disabled&&F?.click(),p.style.setProperty("margin-bottom","1rem"),p.style.setProperty("font-size","2rem"),i.style.setProperty("margin-bottom","0.5rem"),i.style.setProperty("font-weight","500"),i.style.setProperty("color","#374151"),w.style.setProperty("font-size","0.875rem"),w.style.setProperty("color","#6b7280"),w.style.setProperty("margin-bottom","1rem"),n(w,()=>f(L()),N),R.$$click=y=>{y.stopPropagation(),F?.click()},j.addEventListener("change",l);var D=F;return typeof D=="function"?he(D,j):F=j,n(e,P(S,{get when(){return h().length>0},get children(){return[(()=>{var y=tt();return n(y,P(xe,{get each(){return h()},children:v=>(()=>{var _=st(),m=_.firstChild,s=m.firstChild,c=s.firstChild,M=c.nextSibling,k=M.firstChild,q=k.nextSibling,ee=q.nextSibling;return n(c,()=>v.file.name),n(k,()=>f(v.file.size)),n(q,()=>v.file.type||"Unknown type"),n(ee,()=>t(v.method)),n(_,P(S,{get when(){return v.status!=="pending"},get children(){var se=it(),ue=se.firstChild,de=ue.firstChild,Pe=ue.nextSibling,re=Pe.firstChild,me=re.nextSibling,fe=me.firstChild;return n(re,()=>v.status==="uploading"&&`Uploading... ${v.progress}%`,null),n(re,()=>v.status==="completed"&&"✅ Upload completed",null),n(re,()=>v.status==="error"&&`❌ ${v.error||"Upload failed"}`,null),n(me,P(S,{get when(){return v.status==="error"},get children(){var K=nt();return K.$$click=()=>x(v),K}}),fe),fe.$$click=()=>Q(v.id),W(K=>{var pe=`progress-fill ${v.status}`,ce=`${v.progress}%`,ye=`status-text ${v.status}`;return pe!==K.e&&X(de,K.e=pe),ce!==K.t&&((K.t=ce)!=null?de.style.setProperty("width",ce):de.style.removeProperty("width")),ye!==K.a&&X(re,K.a=ye),K},{e:void 0,t:void 0,a:void 0}),se}}),null),W(()=>X(ee,`upload-method ${v.method}`)),_})()})),y})(),(()=>{var y=rt(),v=y.firstChild,_=v.nextSibling,m=_.firstChild,s=m.nextSibling;return s.nextSibling,v.$$click=J,_.style.setProperty("font-size","0.875rem"),_.style.setProperty("color","#6b7280"),_.style.setProperty("align-self","center"),n(_,()=>h().length,m),n(_,()=>h().filter(c=>c.status==="completed").length,s),y})()]}}),null),n(e,P(S,{get when(){return r.showDebug},get children(){var y=lt(),v=y.firstChild,_=v.nextSibling,m=_.nextSibling,s=m.nextSibling,c=s.nextSibling,M=c.nextSibling,k=M.nextSibling,q=k.nextSibling;return q.nextSibling,n(y,()=>f(L()),s),n(y,()=>f(L()),q),y}}),null),W(y=>{var v=`upload-zone ${I()?"drag-over":""} ${r.disabled?"disabled":""}`,_=r.disabled,m=r.multiple!==!1,s=r.accept,c=r.disabled;return v!==y.e&&X(b,y.e=v),_!==y.t&&(R.disabled=y.t=_),m!==y.a&&(j.multiple=y.a=m),s!==y.o&&Z(j,"accept",y.o=s),c!==y.i&&(j.disabled=y.i=c),y},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),e})()};ie("smart-file-upload",{baseUrl:void 0,websocketConnection:void 0,sizeThreshold:10*1024*1024,showDebug:!1,multiple:!0,accept:void 0,disabled:!1},at);ne(["click"]);var dt=g("<img>"),ct=g("<video controls>Your browser does not support video playback."),bt=g("<div><audio controls>Your browser does not support audio playback."),ut=g("<pre>"),mt=g("<div><div>📄</div><div></div><div> • "),ft=g("<button>"),pt=g("<div><div>Loading blob..."),yt=g("<div><strong>Error:</strong> "),ge=g("<div>"),gt=g("<div><strong>Extension:</strong> ."),ht=g("<div><strong>Local Path:</strong> <code>"),vt=g("<div><h4>Metadata</h4><div><strong>ID:</strong> <code></code></div><div><strong>Size:</strong> </div><div><strong>Type:</strong> </div><div><strong>Created:</strong> </div><div><strong>SHA256:</strong> <code>"),xt=g("<button>📥 Download ");const wt=r=>{const[h,z]=T(null),[I,C]=T(null),[A,G]=T(null),[E,Y]=T(!1),[L,H]=T(null),F=new we({baseUrl:r.baseUrl||window.location.origin}),$=()=>r.maxWidth||"100%",U=()=>r.maxHeight||"400px";oe(()=>{r.blobId&&(r.autoLoad??!0)&&O(r.blobId)}),be(()=>{const x=I();x&&URL.revokeObjectURL(x)});const O=async x=>{if(x){Y(!0),H(null),z(null),C(null),G(null);try{const l=await F.getBlobInfo(x);if(z(l),l.is_image||l.is_video||l.is_audio){const u=await F.createBlobUrl(x);C(u)}else if(l.is_text&&(l.size||0)<1024*1024){const u=await F.getBlobText(x);G(u)}}catch(l){l instanceof Fe?H(`${l.type}: ${l.message}`):H(`Error loading blob: ${l}`)}finally{Y(!1)}}},V=async()=>{const x=h();if(x)try{await F.downloadBlob(x.id,x.display_name)}catch(l){H(`Download failed: ${l}`)}},Q=x=>new Date(x).toLocaleString(),J=()=>{const x=h(),l=I(),u=A();return x?x.is_image&&l?(()=>{var o=dt();return o.addEventListener("error",()=>H("Failed to load image")),Z(o,"src",l),o.style.setProperty("object-fit","contain"),o.style.setProperty("border-radius","4px"),W(a=>{var f=x.display_name,t=$(),e=U();return f!==a.e&&Z(o,"alt",a.e=f),t!==a.t&&((a.t=t)!=null?o.style.setProperty("max-width",t):o.style.removeProperty("max-width")),e!==a.a&&((a.a=e)!=null?o.style.setProperty("max-height",e):o.style.removeProperty("max-height")),a},{e:void 0,t:void 0,a:void 0}),o})():x.is_video&&l?(()=>{var o=ct();return o.addEventListener("error",()=>H("Failed to load video")),Z(o,"src",l),W(a=>{var f=$(),t=U();return f!==a.e&&((a.e=f)!=null?o.style.setProperty("max-width",f):o.style.removeProperty("max-width")),t!==a.t&&((a.t=t)!=null?o.style.setProperty("max-height",t):o.style.removeProperty("max-height")),a},{e:void 0,t:void 0}),o})():x.is_audio&&l?(()=>{var o=bt(),a=o.firstChild;return a.addEventListener("error",()=>H("Failed to load audio")),Z(a,"src",l),a.style.setProperty("width","100%"),o})():x.is_text&&u?(()=>{var o=ut();return o.style.setProperty("background-color","#f5f5f5"),o.style.setProperty("padding","1rem"),o.style.setProperty("border-radius","4px"),o.style.setProperty("white-space","pre-wrap"),o.style.setProperty("word-wrap","break-word"),o.style.setProperty("overflow","auto"),o.style.setProperty("font-family","monospace"),o.style.setProperty("font-size","0.9rem"),o.style.setProperty("border","1px solid #ddd"),n(o,u),W(a=>(a=U())!=null?o.style.setProperty("max-height",a):o.style.removeProperty("max-height")),o})():(()=>{var o=mt(),a=o.firstChild,f=a.nextSibling,t=f.nextSibling,e=t.firstChild;return o.style.setProperty("padding","2rem"),o.style.setProperty("text-align","center"),o.style.setProperty("border","2px dashed #ccc"),o.style.setProperty("border-radius","8px"),o.style.setProperty("background-color","#f9f9f9"),a.style.setProperty("font-size","3rem"),a.style.setProperty("margin-bottom","1rem"),f.style.setProperty("font-weight","bold"),f.style.setProperty("margin-bottom","0.5rem"),n(f,()=>x.display_name),t.style.setProperty("color","#666"),t.style.setProperty("font-size","0.9rem"),n(t,()=>x.mime_type||"Unknown type",e),n(t,()=>x.formatted_size,null),o})():null};return(()=>{var x=ge();return x.style.setProperty("width","100%"),n(x,P(S,{get when(){return!r.autoLoad&&r.blobId},get children(){var l=ft();return l.$$click=()=>O(r.blobId),l.style.setProperty("padding","0.5rem 1rem"),l.style.setProperty("margin-bottom","1rem"),l.style.setProperty("background-color","#007bff"),l.style.setProperty("color","white"),l.style.setProperty("border","none"),l.style.setProperty("border-radius","4px"),n(l,()=>E()?"Loading...":"Load Blob"),W(u=>{var o=E(),a=E()?"not-allowed":"pointer";return o!==u.e&&(l.disabled=u.e=o),a!==u.t&&((u.t=a)!=null?l.style.setProperty("cursor",a):l.style.removeProperty("cursor")),u},{e:void 0,t:void 0}),l}}),null),n(x,P(S,{get when(){return E()},get children(){var l=pt();return l.style.setProperty("padding","2rem"),l.style.setProperty("text-align","center"),l.style.setProperty("color","#666"),l}}),null),n(x,P(S,{get when(){return L()},get children(){var l=yt(),u=l.firstChild;return u.nextSibling,l.style.setProperty("padding","1rem"),l.style.setProperty("background-color","#f8d7da"),l.style.setProperty("color","#721c24"),l.style.setProperty("border","1px solid #f5c6cb"),l.style.setProperty("border-radius","4px"),l.style.setProperty("margin-bottom","1rem"),n(l,L,null),l}}),null),n(x,P(S,{get when(){return te(()=>!!(h()&&!E()))()&&!L()},get children(){return[(()=>{var l=ge();return l.style.setProperty("margin-bottom","1rem"),n(l,J),l})(),P(S,{get when(){return r.showMetadata},get children(){var l=vt(),u=l.firstChild,o=u.nextSibling,a=o.firstChild,f=a.nextSibling,t=f.nextSibling,e=o.nextSibling,d=e.firstChild;d.nextSibling;var b=e.nextSibling,p=b.firstChild;p.nextSibling;var i=b.nextSibling,w=i.firstChild;w.nextSibling;var B=i.nextSibling,N=B.firstChild,R=N.nextSibling,j=R.nextSibling;return l.style.setProperty("background-color","#f8f9fa"),l.style.setProperty("padding","1rem"),l.style.setProperty("border-radius","4px"),l.style.setProperty("border","1px solid #dee2e6"),l.style.setProperty("font-size","0.9rem"),u.style.setProperty("margin","0 0 0.5rem 0"),t.style.setProperty("font-size","0.8rem"),n(t,()=>h()?.id),n(e,()=>h()?.formatted_size,null),n(b,()=>h()?.mime_type||"Unknown",null),n(l,P(S,{get when(){return h()?.file_extension},get children(){var D=gt(),y=D.firstChild;return y.nextSibling,n(D,()=>h()?.file_extension,null),D}}),i),n(i,()=>Q(h()?.created_at||""),null),j.style.setProperty("font-size","0.8rem"),j.style.setProperty("word-break","break-all"),n(j,()=>h()?.sha256),n(l,P(S,{get when(){return h()?.local_path},get children(){var D=ht(),y=D.firstChild,v=y.nextSibling,_=v.nextSibling;return _.style.setProperty("font-size","0.8rem"),n(_,()=>h()?.local_path),D}}),null),l}}),P(S,{get when(){return r.enableDownload},get children(){var l=xt();return l.firstChild,l.$$click=V,l.style.setProperty("padding","0.5rem 1rem"),l.style.setProperty("margin-top","1rem"),l.style.setProperty("background-color","#28a745"),l.style.setProperty("color","white"),l.style.setProperty("border","none"),l.style.setProperty("border-radius","4px"),l.style.setProperty("cursor","pointer"),n(l,()=>h()?.display_name,null),l}})]}}),null),x})()};ie("blob-viewer",{blobId:void 0,baseUrl:void 0,maxWidth:"100%",maxHeight:"400px",showMetadata:!1,enableDownload:!0,autoLoad:!0},wt);ne(["click"]);console.log("🧩 Web Components Library loaded - Available components:",["webauthn-auth","websocket-handler","websocket-status","websocket-demo","websocket-feed-manager","websocket-feed-demo","websocket-thumbnail-demo","media-blob-feed-item","media-blob-feed-list","simple-test","smart-file-upload","sync-status","sync-progress","sync-controls","sync-demo","unified-sync-demo","blob-viewer","infinite-data-grid","generic-infinite-grid","product-data-grid-demo"]);
//# sourceMappingURL=all-components.js.map
