import"./webauthn-auth.js";import"./websocket-status-BDvgr80x.js";import"./websocket-components.js";import{W as Se}from"./websocket-demo.js";import{c as L,a as X,o as Ce,b as ue,t as p,u as ve,d as j,e as Z,f as ie,i as s,g as S,S as I,s as re,m as ee,h as ke,j as xe,k as Ie,F as $e,r as ze}from"./web-D3Zmtprl.js";import{c as oe}from"./index-8dGGsLgz.js";import{C as de,W as Ue}from"./websocket-client-Ch-EMSjw.js";import{B as we,a as Be}from"./websocket-feed-demo.js";import"./api-client-C-EpDo6z.js";import{F as Me}from"./file-upload-BM7XYU3d.js";import{S as V}from"./unified-sync-demo.js";import"./infinite-data-grid.js";import"./generic-infinite-grid-BPc8o6gU.js";import"./product-data-grid-demo.js";import"./search-demo.js";import"./freqhole-demo.js";import"./zune-demo.js";import"./types-wppsXtfs.js";import"./thumbnail-utils-DhBM51J3.js";import"./SearchContext-CTqRL0oK.js";import"./useSearchSuggestions-D_OmOi-S.js";import"./SearchSuggestions-ajMRCuIq.js";var Te=p("<div>");function Fe(t){const[f,B]=L(null),[T,z]=L({items:[],isLoading:!1,isConnected:!1,connectionStatus:de.Disconnected,subscribedChannels:[],totalCount:0,lastUpdated:null,error:null}),D=()=>t.wsUrl||"ws://localhost:8080/ws",[K,E]=L(["MediaBlobs"]);X(()=>{const r=t.channels;if(!r||Array.isArray(r)&&r.length===0){E(["MediaBlobs"]);return}if(Array.isArray(r)){E(r);return}if(typeof r=="string")try{const e=JSON.parse(r);Array.isArray(e)?E(e):E(["MediaBlobs"])}catch(e){v("Failed to parse channels prop, using default:",e),E(["MediaBlobs"])}else E(["MediaBlobs"])});const O=()=>K(),N=()=>t.debug||!1,H=()=>t.pageSize||20,v=(...r)=>{N()&&console.log("[WebSocketFeedManager]",...r)},P=(...r)=>{N()},C=r=>{z(e=>({...e,...r}))},h=r=>{z(e=>({...e,items:[r,...e.items],totalCount:e.totalCount+1,lastUpdated:new Date})),P("Added new feed item:",r.id)},x=r=>{z(e=>({...e,items:e.items.map(i=>i.id===r.id?r:i),lastUpdated:new Date})),P("Updated feed item:",r.id)},A=r=>{z(e=>({...e,items:e.items.filter(i=>i.id!==r),totalCount:Math.max(0,e.totalCount-1),lastUpdated:new Date})),P("Removed feed item:",r)},U=()=>{const r=f();r&&(C({isLoading:!0,error:null}),P("Loading initial feed..."),r.getMediaBlobs(H(),0)||C({isLoading:!1,error:"Failed to request initial feed data"}))},y=()=>{const r=f();if(!r)return;const e=T();P("Unsubscribing from channels:",e.subscribedChannels),e.subscribedChannels.forEach(i=>{r.unsubscribeFromNotifications(i)||P("Failed to unsubscribe from channel:",i)})},l=()=>{const r=new Ue({url:D(),autoReconnect:!0,reconnectDelay:3e3,maxReconnectAttempts:0,debug:N()});return r.on("statusChange",e=>{if(v("Connection status changed:",e),C({connectionStatus:e,isConnected:e===de.Connected}),e===de.Connected){U();const i=T().subscribedChannels,m=O().filter($=>!i.includes($));m.length>0&&m.forEach($=>{r.subscribeToNotifications($)})}else e===de.Disconnected&&C({subscribedChannels:[]})}),r.on("welcome",e=>{P("Connected to WebSocket:",e),C({error:null})}),r.on("mediaBlobs",e=>{v("Loaded",e.blobs.length,"media blobs"),C({items:e.blobs,totalCount:e.total_count,isLoading:!1,lastUpdated:new Date,error:null})}),r.on("mediaBlob",e=>{P("Received single media blob:",e.blob.id),x(e.blob)}),r.on("notification",e=>{if(P("Received notification:",e),e.channel==="MediaBlobs")switch(e.event_type){case"media_blob.created":e.payload&&e.payload.media_blob&&(v("📦 New media blob:",e.payload.media_blob.id.slice(0,8)),h(e.payload.media_blob));break;case"media_blob.updated":e.payload&&e.payload.media_blob&&(P("Updated media blob:",e.payload.media_blob.id),x(e.payload.media_blob));break;case"media_blob.deleted":e.payload&&e.payload.media_blob_id&&(v("🗑️ Deleted media blob:",e.payload.media_blob_id.slice(0,8)),A(e.payload.media_blob_id));break;default:P("Unknown media blob event:",e.event_type)}}),r.on("notificationSubscribed",e=>{P("Subscribed to channel:",e.channel),z(i=>({...i,subscribedChannels:i.subscribedChannels.includes(e.channel)?i.subscribedChannels:[...i.subscribedChannels,e.channel]}))}),r.on("notificationUnsubscribed",e=>{P("Unsubscribed from channel:",e.channel),z(i=>({...i,subscribedChannels:i.subscribedChannels.filter(m=>m!==e.channel)}))}),r.on("notificationStatus",e=>{P("Notification status:",e),C({subscribedChannels:e.subscribed_channels})}),r.on("error",e=>{v("❌ WebSocket error:",e.message),C({error:e.message})}),r.on("parseError",e=>{v("❌ Parse error:",e.message),C({error:`Parse error: ${e.message}`})}),B(r),r},b=()=>{const r=f();r&&r.connect()},o=()=>{const r=f();r&&(y(),r.disconnect())},c={connect:b,disconnect:o,refresh:()=>{f()&&T().isConnected&&U()},getFeedState:()=>T(),getClient:()=>f()};return Ce(()=>{v("Initializing WebSocket feed manager");const r=l();t.autoConnect!==!1&&r.connect()}),ue(()=>{v("Cleaning up WebSocket feed manager"),o()}),X(()=>{const r=O(),e=T().subscribedChannels,i=f();if(i&&T().isConnected){const m=e.filter(a=>!r.includes(a)),$=r.filter(a=>!e.includes(a));(m.length>0||$.length>0)&&(m.forEach(a=>{i.unsubscribeFromNotifications(a)}),$.forEach(a=>{i.subscribeToNotifications(a)}))}}),(()=>{var r=Te();return ve(e=>{const i=e.closest("websocket-feed-manager");i?(i.feedManager=c,P("Feed manager methods exposed on custom element")):P("Could not find custom element parent")},r),r.style.setProperty("display","none"),j(()=>Z(r,`websocket-feed-manager ${t.className||""}`)),r})()}oe("websocket-feed-manager",{wsUrl:"ws://localhost:8080/ws",channels:["MediaBlobs"],debug:!1,autoConnect:!0,pageSize:20,className:""},Fe);var Ee=p("<img>"),Le=p("<div class=thumbnail-container>"),De=p("<div class=metadata-item><span>📏</span><span>"),Ne=p("<div class=metadata-item><span>📱</span><span>..."),Ae=p("<div class=metadata><div class=metadata-item><span></span><span>"),We=p("<span>Added <!> • Updated "),ne=p("<div>"),He=p("<blob-viewer maxwidth=100% maxheight=300px>",!0,!1,!1),Re=p(`<div><style>
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
      </style><div class=content><div><div><h3 class=title></h3></div><div><button title="View blob content">👁️ </button><button title="Download blob">📥</button><button title="Copy blob ID">📋`),je=p("<span>Added "),Ve=p("<div>Loading blob content...");function Pe(t){const[f,B]=L({loading:!0,error:!1,url:null}),[T,z]=L(!1),[D,K]=L(!1),[E,O]=L(null),N=new we({baseUrl:t.baseUrl||window.location.origin}),H=()=>t.showThumbnail!==!1,v=()=>t.showMetadata!==!1,P=()=>t.showTimestamps!==!1,C=()=>t.compact||!1,h=()=>t.clickable!==!1,x=()=>t.thumbnailSize||120,A=()=>t.showLoadingPlaceholder!==!1,U=()=>t.enableInlineViewer!==!1,y=a=>{if(!a)return"Unknown size";const k=["B","KB","MB","GB"];let R=0,q=a;for(;q>=1024&&R<k.length-1;)q/=1024,R++;return`${q.toFixed(R>0?1:0)} ${k[R]}`},l=a=>{try{const k=new Date(a),q=new Date().getTime()-k.getTime(),G=Math.floor(q/(1e3*60)),J=Math.floor(G/60),Y=Math.floor(J/24);return G<1?"Just now":G<60?`${G}m ago`:J<24?`${J}h ago`:Y<7?`${Y}d ago`:k.toLocaleDateString()}catch{return"Unknown time"}},b=a=>a?a.startsWith("image/")?"🖼️":a.startsWith("video/")?"🎬":a.startsWith("audio/")?"🎵":a.includes("pdf")?"📋":a.includes("text")?"📝":"📄":"📄",o=async()=>{if(H()){B({loading:!0,error:!1,url:null});try{const a=`/api/v1/media_blobs/${t.blob.id}/thumbnail`;(await fetch(a,{method:"HEAD",credentials:"include"})).ok?B({loading:!1,error:!1,url:a}):B({loading:!1,error:!1,url:null})}catch(a){console.warn("Failed to load thumbnail for",t.blob.id,a),B({loading:!1,error:!0,url:null})}}},n=()=>{if(h())if(U())c();else{const a=new CustomEvent("media-blob-click",{detail:{blob:t.blob},bubbles:!0});document.querySelector(`[data-blob-id="${t.blob.id}"]`)?.dispatchEvent(a)}},c=()=>{z(!T()),T()||O(null)},r=async a=>{if(a.stopPropagation(),!U()){window.open(`/api/blobs/${t.blob.id}`,"_blank");return}K(!0),O(null),z(!0);try{await N.getBlobMetadata(t.blob.id)}catch(k){O(`Failed to load blob: ${k}`)}finally{K(!1)}},e=async a=>{a.stopPropagation();try{const k=t.blob.metadata?.filename||`blob-${t.blob.id}`;await N.downloadBlob(t.blob.id,k)}catch(k){console.error("Download failed:",k)}},i=async a=>{a.stopPropagation();try{await navigator.clipboard.writeText(t.blob.id)}catch(R){console.error("Failed to copy blob ID:",R)}const k=document.querySelector(`[data-blob-id="${t.blob.id}"]`);event&&k?.dispatchEvent(event)},m=()=>{B(a=>({...a,loading:!1}))},$=()=>{B(a=>({...a,loading:!1,error:!0}))};return X(()=>{t.blob?.id&&o()}),(()=>{var a=Re(),k=a.firstChild,R=k.nextSibling,q=R.firstChild,G=q.firstChild,J=G.firstChild,Y=G.nextSibling,w=Y.firstChild;w.firstChild;var _=w.nextSibling,M=_.nextSibling;return a.$$click=n,s(a,S(I,{get when(){return H()},get children(){var g=Le();return s(g,S(I,{get when(){return ee(()=>!f().loading)()&&f().url},get fallback(){return(()=>{var d=ne();return d.style.setProperty("width","100%"),d.style.setProperty("height","100%"),d.style.setProperty("display","flex"),d.style.setProperty("align-items","center"),d.style.setProperty("justify-content","center"),d.style.setProperty("color","#9ca3af"),s(d,(()=>{var u=ee(()=>!!f().loading);return()=>u()?"⏳":b(t.blob.mime)})()),j(u=>{var W=`thumbnail-placeholder ${f().loading&&A()?"thumbnail-loading":""}`,F=C()?"24px":"32px";return W!==u.e&&Z(d,u.e=W),F!==u.t&&((u.t=F)!=null?d.style.setProperty("font-size",F):d.style.removeProperty("font-size")),u},{e:void 0,t:void 0}),d})()},get children(){var d=Ee();return d.addEventListener("error",$),d.addEventListener("load",m),d.style.setProperty("width","100%"),d.style.setProperty("height","100%"),d.style.setProperty("object-fit","cover"),j(u=>{var W=f().url,F=`Thumbnail for ${t.blob.sha256.slice(0,8)}`;return W!==u.e&&re(d,"src",u.e=W),F!==u.t&&re(d,"alt",u.t=F),u},{e:void 0,t:void 0}),d}})),j(d=>{var u=`${x()}px`,W=`${x()}px`,F=`${x()}px`,Q=`${x()}px`;return u!==d.e&&((d.e=u)!=null?g.style.setProperty("width",u):g.style.removeProperty("width")),W!==d.t&&((d.t=W)!=null?g.style.setProperty("height",W):g.style.removeProperty("height")),F!==d.a&&((d.a=F)!=null?g.style.setProperty("min-width",F):g.style.removeProperty("min-width")),Q!==d.o&&((d.o=Q)!=null?g.style.setProperty("min-height",Q):g.style.removeProperty("min-height")),d},{e:void 0,t:void 0,a:void 0,o:void 0}),g}}),R),R.style.setProperty("min-width","0"),q.style.setProperty("display","flex"),q.style.setProperty("justify-content","space-between"),q.style.setProperty("align-items","flex-start"),q.style.setProperty("gap","8px"),G.style.setProperty("flex","1"),G.style.setProperty("min-width","0"),s(J,()=>t.blob.local_path?.split("/").pop()||`${t.blob.sha256.slice(0,8)}...${t.blob.sha256.slice(-4)}`),s(G,S(I,{get when(){return v()},get children(){var g=Ae(),d=g.firstChild,u=d.firstChild,W=u.nextSibling;return s(u,()=>b(t.blob.mime)),s(W,()=>t.blob.mime||"Unknown type"),s(g,S(I,{get when(){return t.blob.size},get children(){var F=De(),Q=F.firstChild,le=Q.nextSibling;return s(le,()=>y(t.blob.size)),F}}),null),s(g,S(I,{get when(){return t.blob.source_client_id},get children(){var F=Ne(),Q=F.firstChild,le=Q.nextSibling,ae=le.firstChild;return s(le,()=>t.blob.source_client_id?.slice(0,8),ae),j(()=>re(le,"title",t.blob.source_client_id)),F}}),null),g}}),null),s(G,S(I,{get when(){return P()},get children(){var g=ne();return g.style.setProperty("margin-top","4px"),g.style.setProperty("font-size","11px"),g.style.setProperty("color","#9ca3af"),s(g,S(I,{get when(){return t.blob.created_at!==t.blob.updated_at},get fallback(){return(()=>{var d=je();return d.firstChild,s(d,()=>l(t.blob.created_at),null),d})()},get children(){var d=We(),u=d.firstChild,W=u.nextSibling;return W.nextSibling,s(d,()=>l(t.blob.created_at),W),s(d,()=>l(t.blob.updated_at),null),d}})),g}}),null),Y.style.setProperty("display","flex"),Y.style.setProperty("gap","4px"),Y.style.setProperty("flex-shrink","0"),w.$$click=r,w.style.setProperty("padding","4px 8px"),w.style.setProperty("font-size","12px"),w.style.setProperty("border","1px solid #d1d5db"),w.style.setProperty("border-radius","4px"),w.style.setProperty("background-color","#f9fafb"),w.style.setProperty("cursor","pointer"),w.style.setProperty("display","flex"),w.style.setProperty("align-items","center"),w.style.setProperty("gap","4px"),s(w,()=>T()?"Hide":"View",null),_.$$click=e,_.style.setProperty("padding","4px 8px"),_.style.setProperty("font-size","12px"),_.style.setProperty("border","1px solid #d1d5db"),_.style.setProperty("border-radius","4px"),_.style.setProperty("background-color","#f9fafb"),_.style.setProperty("cursor","pointer"),_.style.setProperty("display","flex"),_.style.setProperty("align-items","center"),_.style.setProperty("gap","4px"),M.$$click=i,M.style.setProperty("padding","4px 8px"),M.style.setProperty("font-size","12px"),M.style.setProperty("border","1px solid #d1d5db"),M.style.setProperty("border-radius","4px"),M.style.setProperty("background-color","#f9fafb"),M.style.setProperty("cursor","pointer"),M.style.setProperty("display","flex"),M.style.setProperty("align-items","center"),M.style.setProperty("gap","4px"),s(R,S(I,{get when(){return T()},get children(){var g=ne();return g.style.setProperty("margin-top","12px"),g.style.setProperty("padding","12px"),g.style.setProperty("border","1px solid #e5e7eb"),g.style.setProperty("border-radius","6px"),g.style.setProperty("background-color","#f9fafb"),s(g,S(I,{get when(){return ee(()=>!D())()&&!E()},get fallback(){return(()=>{var d=ne();return s(d,S(I,{get when(){return D()},get children(){var u=Ve();return u.style.setProperty("text-align","center"),u.style.setProperty("padding","20px"),u.style.setProperty("color","#6b7280"),u}}),null),s(d,S(I,{get when(){return E()},get children(){var u=ne();return u.style.setProperty("padding","12px"),u.style.setProperty("background-color","#fef2f2"),u.style.setProperty("color","#dc2626"),u.style.setProperty("border-radius","4px"),u.style.setProperty("border","1px solid #fecaca"),s(u,E),u}}),null),d})()},get children(){var d=He();return d.showmetadata=!1,d.enabledownload=!1,d.autoload=!0,d._$owner=ke(),j(u=>{var W=t.blob.id,F=t.baseUrl;return W!==u.e&&(d.blobid=u.e=W),F!==u.t&&(d.baseurl=u.t=F),u},{e:void 0,t:void 0}),d}})),g}}),null),j(g=>{var d=`media-blob-feed-item ${C()?"compact":""} ${h()?"clickable":""} ${t.className||""}`,u=t.blob.id,W={display:"flex","flex-direction":C()?"row":"column",gap:C()?"12px":"8px",padding:C()?"8px":"12px",border:"1px solid #e2e8f0","border-radius":"8px","background-color":"#ffffff",cursor:h()?"pointer":"default",transition:"all 0.2s ease",...h()&&{":hover":{"box-shadow":"0 2px 8px rgba(0, 0, 0, 0.1)",transform:"translateY(-1px)"}}},F=C()?"1":"auto";return d!==g.e&&Z(a,g.e=d),u!==g.t&&re(a,"data-blob-id",g.t=u),g.a=xe(a,W,g.a),F!==g.o&&((g.o=F)!=null?R.style.setProperty("flex",F):R.style.removeProperty("flex")),g},{e:void 0,t:void 0,a:void 0,o:void 0}),a})()}oe("media-blob-feed-item",{blob:{},showThumbnail:!0,showMetadata:!0,showTimestamps:!0,compact:!1,clickable:!0,className:"",thumbnailSize:120,showLoadingPlaceholder:!0,baseUrl:void 0,enableInlineViewer:!0},Pe);ie(["click"]);var Oe=p("<div class=header><div>Feed</div><div>"),Ye=p("<div class=loading-indicator><div class=loading-spinner>⏳</div><div>Loading feed..."),qe=p("<div class=error-state><div>⚠️</div><div>Failed to load feed</div><div>"),Ge=p("<div class=empty-state><div class=empty-icon>📭</div><div></div><div>New items will appear here automatically"),Je=p("<div class=feed-container>"),Ke=p(`<div><style>
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
      `),Xe=p("<div>");function Qe(t){const[f,B]=L({selectedItemId:null,lastUpdated:null}),T=()=>t.items||[],z=()=>t.loading||!1,D=()=>t.error||null,K=()=>t.emptyMessage||"No items in feed",E=()=>t.maxHeight||"auto",O=()=>t.itemMode||"default",N=()=>t.showThumbnails!==!1,H=()=>t.showMetadata!==!1,v=()=>t.showTimestamps!==!1,P=()=>t.clickableItems!==!1,C=()=>t.thumbnailSize||120,h=()=>t.showItemCount!==!1,x=()=>t.animationDuration||300,A=Ie(()=>[...T()].sort((b,o)=>{const n=new Date(b.created_at).getTime();return new Date(o.created_at).getTime()-n})),U=b=>{const{blob:o}=b.detail;B(c=>({...c,selectedItemId:o.id===c.selectedItemId?null:o.id}));const n=new CustomEvent("feed-item-selected",{detail:{blob:o,isSelected:o.id!==f().selectedItemId},bubbles:!0});b.target?.dispatchEvent(n)},y=b=>x()<=0?{}:{"animation-delay":`${b*50}ms`,"animation-duration":`${x()}ms`,"animation-fill-mode":"both","animation-name":"feed-item-appear"},l=b=>b===0?"No items":b===1?"1 item":`${b.toLocaleString()} items`;return(()=>{var b=Ke();return b.firstChild,b.$$click=o=>{const n=o;n.target.closest?.("[data-blob-id]")&&n.detail?.blob&&U(n)},b.style.setProperty("display","flex"),b.style.setProperty("flex-direction","column"),b.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),b.style.setProperty("height","100%"),s(b,S(I,{get when(){return ee(()=>!!(h()&&!z()))()&&!D()},get children(){var o=Oe(),n=o.firstChild,c=n.nextSibling;return n.style.setProperty("font-weight","500"),c.style.setProperty("color","#6b7280"),s(c,()=>l(T().length)),o}}),null),s(b,S(I,{get when(){return z()},get children(){return Ye()}}),null),s(b,S(I,{get when(){return ee(()=>!!D())()&&!z()},get children(){var o=qe(),n=o.firstChild,c=n.nextSibling,r=c.nextSibling;return n.style.setProperty("font-size","48px"),n.style.setProperty("margin-bottom","16px"),c.style.setProperty("font-weight","500"),c.style.setProperty("margin-bottom","8px"),r.style.setProperty("font-size","14px"),r.style.setProperty("opacity","0.8"),s(r,D),o}}),null),s(b,S(I,{get when(){return ee(()=>!z()&&!D())()&&T().length===0},get children(){var o=Ge(),n=o.firstChild,c=n.nextSibling,r=c.nextSibling;return c.style.setProperty("font-weight","500"),c.style.setProperty("margin-bottom","8px"),s(c,K),r.style.setProperty("font-size","14px"),r.style.setProperty("opacity","0.8"),o}}),null),s(b,S(I,{get when(){return ee(()=>!z()&&!D())()&&T().length>0},get children(){var o=Je();return s(o,S($e,{get each(){return A()},children:(n,c)=>(()=>{var r=Xe();return s(r,S(Pe,{blob:n,get compact(){return O()==="compact"},get showThumbnail(){return N()},get showMetadata(){return H()},get showTimestamps(){return v()},get clickable(){return P()},get thumbnailSize(){return C()}})),j(e=>{var i=`feed-item ${f().selectedItemId===n.id?"selected":""}`,m=y(c());return i!==e.e&&Z(r,e.e=i),e.t=xe(r,m,e.t),e},{e:void 0,t:void 0}),r})()})),j(n=>{var c=E(),r=E()!=="auto"?"auto":"visible";return c!==n.e&&((n.e=c)!=null?o.style.setProperty("max-height",c):o.style.removeProperty("max-height")),r!==n.t&&((n.t=r)!=null?o.style.setProperty("overflow",r):o.style.removeProperty("overflow")),n},{e:void 0,t:void 0}),o}}),null),j(()=>Z(b,`media-blob-feed-list ${t.className||""}`)),b})()}oe("media-blob-feed-list",{items:[],loading:!1,error:null,emptyMessage:"No items in feed",maxHeight:"auto",itemMode:"default",showThumbnails:!0,showMetadata:!0,showTimestamps:!0,clickableItems:!0,className:"",thumbnailSize:120,showItemCount:!0,animationDuration:300},Qe);ie(["click"]);var Ze=p("<div><h2>Simple Solid.js Test</h2><p>Count: </p><button>Increment");console.log("🚀 Script started loading");function et(){console.log("📦 SimpleTest component created");const[t,f]=L(0);return(()=>{var B=Ze(),T=B.firstChild,z=T.nextSibling;z.firstChild;var D=z.nextSibling;return B.style.setProperty("padding","20px"),B.style.setProperty("border","1px solid #ccc"),B.style.setProperty("margin","20px"),s(z,t,null),D.$$click=()=>f(t()+1),B})()}class tt extends HTMLElement{dispose;connectedCallback(){console.log("🔌 SimpleTestElement connected");try{this.dispose=ze(()=>S(et,{}),this),console.log("✅ Render successful")}catch(f){console.error("❌ Render failed:",f)}}disconnectedCallback(){console.log("🔌 SimpleTestElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register custom element");try{customElements.define("simple-test",tt),console.log("✅ Custom element registered successfully")}catch(t){console.error("❌ Failed to register custom element:",t)}ie(["click"]);var rt=p("<div class=upload-list>"),lt=p("<div class=controls><button class=control-button>Clear Completed</button><span> total, <!> completed"),ot=p("<div class=threshold-info><strong>Upload Routing:</strong><br>• Files &lt; <!>: WebSocket (stored in database)<br>• Files ≥ <!>: HTTP API (stored on disk, admin only)"),st=p(`<div class=smart-file-upload><style>
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
      </style><div><div>📁</div><div>Drop files here or click to browse</div><div>Small files (&lt;<!>) use WebSocket, large files use HTTP API</div><button class=upload-button>Select Files</button></div><input type=file class=hidden>`),nt=p('<button class="action-button retry">Retry'),it=p('<div class=upload-progress><div class=progress-bar><div></div></div><div class=upload-status><span></span><div class=upload-actions><button class="action-button remove">Remove'),at=p("<div class=upload-item><div class=upload-header><div class=upload-info><div class=upload-filename></div><div class=upload-details><span></span><span></span><span>");const dt=t=>{const[f,B]=L([]),[T,z]=L(!1),[D,K]=L(null),[E,O]=L(null),N=()=>t.sizeThreshold||10*1024*1024,H=()=>t.baseUrl||window.location.origin;let v;X(()=>{const e=new Me({baseUrl:H(),minFileSize:N(),maxFileSize:1073741824});e.addEventListener("upload-progress",m=>{const{uploadId:$,stage:a,progress:k,error:R}=m.detail;P($,k,a==="error"?"error":"uploading",R?.message)}),K(e);const i=new Se({maxFileSize:N()});i.addEventListener("upload-processed",m=>{const{uploadId:$,blob:a}=m.detail;t.websocketConnection?t.websocketConnection.uploadMediaBlob(a)?P($,100,"completed"):P($,0,"error","Failed to send via WebSocket"):P($,0,"error","WebSocket not connected")}),i.addEventListener("upload-error",m=>{const{uploadId:$,error:a}=m.detail;P($,0,"error",a)}),O(i),ue(()=>{e.cancelAllUploads(),i.destroy()})});const P=(e,i,m,$)=>{B(a=>a.map(k=>k.id===e?{...k,progress:i,status:m,error:$}:k))},C=async e=>{const i=Array.from(e),m=[];for(const $ of i){const a=crypto.randomUUID(),k=$.size>=N()?"http":"websocket";m.push({id:a,file:$,method:k,status:"pending",progress:0})}B($=>[...$,...m]);for(const $ of m)$.method==="http"?h($):x($)},h=async e=>{const i=D();if(i){P(e.id,0,"uploading");try{const m=await i.uploadFile(e.file,{uploadedVia:"smart-file-upload",originalMethod:"http",originalName:e.file.name});P(e.id,100,"completed"),B($=>$.map(a=>a.id===e.id?{...a,result:m}:a))}catch(m){const $=m instanceof Error?m.message:String(m);P(e.id,0,"error",$)}}},x=async e=>{const i=E();if(i){P(e.id,0,"uploading");try{await i.addFiles([e.file])}catch(m){const $=m instanceof Error?m.message:String(m);P(e.id,0,"error",$)}}},A=e=>{B(i=>i.filter(m=>m.id!==e))},U=()=>{B(e=>e.filter(i=>i.status!=="completed"))},y=e=>{e.method==="http"?h(e):x(e)},l=e=>{const i=e.target;i.files&&i.files.length>0&&(C(i.files),i.value="")},b=e=>{e.preventDefault(),z(!0)},o=e=>{e.preventDefault(),z(!1)},n=e=>{e.preventDefault(),z(!1),e.dataTransfer?.files&&C(e.dataTransfer.files)},c=e=>{if(!e)return"0 B";const i=["B","KB","MB","GB"];let m=e,$=0;for(;m>=1024&&$<i.length-1;)m/=1024,$++;return`${m.toFixed(1)} ${i[$]}`},r=e=>e==="websocket"?"WebSocket":"HTTP API";return(()=>{var e=st(),i=e.firstChild,m=i.nextSibling,$=m.firstChild,a=$.nextSibling,k=a.nextSibling,R=k.firstChild,q=R.nextSibling;q.nextSibling;var G=k.nextSibling,J=m.nextSibling;m.addEventListener("drop",n),m.addEventListener("dragleave",o),m.addEventListener("dragover",b),m.$$click=()=>!t.disabled&&v?.click(),$.style.setProperty("margin-bottom","1rem"),$.style.setProperty("font-size","2rem"),a.style.setProperty("margin-bottom","0.5rem"),a.style.setProperty("font-weight","500"),a.style.setProperty("color","#374151"),k.style.setProperty("font-size","0.875rem"),k.style.setProperty("color","#6b7280"),k.style.setProperty("margin-bottom","1rem"),s(k,()=>c(N()),q),G.$$click=w=>{w.stopPropagation(),v?.click()},J.addEventListener("change",l);var Y=v;return typeof Y=="function"?ve(Y,J):v=J,s(e,S(I,{get when(){return f().length>0},get children(){return[(()=>{var w=rt();return s(w,S($e,{get each(){return f()},children:_=>(()=>{var M=at(),g=M.firstChild,d=g.firstChild,u=d.firstChild,W=u.nextSibling,F=W.firstChild,Q=F.nextSibling,le=Q.nextSibling;return s(u,()=>_.file.name),s(F,()=>c(_.file.size)),s(Q,()=>_.file.type||"Unknown type"),s(le,()=>r(_.method)),s(M,S(I,{get when(){return _.status!=="pending"},get children(){var ae=it(),me=ae.firstChild,ce=me.firstChild,_e=me.nextSibling,se=_e.firstChild,fe=se.nextSibling,ye=fe.firstChild;return s(se,()=>_.status==="uploading"&&`Uploading... ${_.progress}%`,null),s(se,()=>_.status==="completed"&&"✅ Upload completed",null),s(se,()=>_.status==="error"&&`❌ ${_.error||"Upload failed"}`,null),s(fe,S(I,{get when(){return _.status==="error"},get children(){var te=nt();return te.$$click=()=>y(_),te}}),ye),ye.$$click=()=>A(_.id),j(te=>{var ge=`progress-fill ${_.status}`,be=`${_.progress}%`,pe=`status-text ${_.status}`;return ge!==te.e&&Z(ce,te.e=ge),be!==te.t&&((te.t=be)!=null?ce.style.setProperty("width",be):ce.style.removeProperty("width")),pe!==te.a&&Z(se,te.a=pe),te},{e:void 0,t:void 0,a:void 0}),ae}}),null),j(()=>Z(le,`upload-method ${_.method}`)),M})()})),w})(),(()=>{var w=lt(),_=w.firstChild,M=_.nextSibling,g=M.firstChild,d=g.nextSibling;return d.nextSibling,_.$$click=U,M.style.setProperty("font-size","0.875rem"),M.style.setProperty("color","#6b7280"),M.style.setProperty("align-self","center"),s(M,()=>f().length,g),s(M,()=>f().filter(u=>u.status==="completed").length,d),w})()]}}),null),s(e,S(I,{get when(){return t.showDebug},get children(){var w=ot(),_=w.firstChild,M=_.nextSibling,g=M.nextSibling,d=g.nextSibling,u=d.nextSibling,W=u.nextSibling,F=W.nextSibling,Q=F.nextSibling;return Q.nextSibling,s(w,()=>c(N()),d),s(w,()=>c(N()),Q),w}}),null),j(w=>{var _=`upload-zone ${T()?"drag-over":""} ${t.disabled?"disabled":""}`,M=t.disabled,g=t.multiple!==!1,d=t.accept,u=t.disabled;return _!==w.e&&Z(m,w.e=_),M!==w.t&&(G.disabled=w.t=M),g!==w.a&&(J.multiple=w.a=g),d!==w.o&&re(J,"accept",w.o=d),u!==w.i&&(J.disabled=w.i=u),w},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),e})()};oe("smart-file-upload",{baseUrl:void 0,websocketConnection:void 0,sizeThreshold:10*1024*1024,showDebug:!1,multiple:!0,accept:void 0,disabled:!1},dt);ie(["click"]);var ct=p("<span>"),bt=p("<div><div class=progress-bar><div class=progress-fill></div></div><span>/<!> (<!>%)"),ut=p("<div><style></style><span>");function mt(t){const[f,B]=L(t.status||V.Never),[T,z]=L(t.itemsSynced||0),[D,K]=L(t.totalItems||0);X(()=>{t.status!==void 0&&B(t.status)}),X(()=>{t.itemsSynced!==void 0&&z(t.itemsSynced)}),X(()=>{t.totalItems!==void 0&&K(t.totalItems)});const E=()=>{switch(f()){case V.Never:return"#94a3b8";case V.Complete:return"#10b981";case V.InProgress:return"#f59e0b";case V.Failed:return"#ef4444";case V.Paused:return"#8b5cf6";default:return"#94a3b8"}},O=()=>{switch(f()){case V.Never:return"Not synced";case V.Complete:return"Up to date";case V.InProgress:return"Syncing...";case V.Failed:return"Sync failed";case V.Paused:return"Paused";default:return"Unknown"}},N=()=>{switch(f()){case V.Never:return"○";case V.Complete:return"✓";case V.InProgress:return"⟳";case V.Failed:return"⚠";case V.Paused:return"⏸";default:return"○"}},H=()=>D()===0?0:Math.round(T()/D()*100);return(()=>{var v=ut(),P=v.firstChild,C=P.nextSibling;return v.style.setProperty("display","inline-flex"),v.style.setProperty("align-items","center"),v.style.setProperty("border-radius","6px"),v.style.setProperty("background-color","#f8fafc"),v.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),s(P,()=>`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .sync-status .status-icon.spinning {
          animation: spin 1s linear infinite;
        }
        .sync-status .progress-bar {
          background-color: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
          height: 4px;
        }
        .sync-status .progress-fill {
          height: 100%;
          background-color: ${E()};
          transition: width 0.3s ease;
          border-radius: 4px;
        }
      `),C.style.setProperty("font-weight","bold"),s(C,N),s(v,S(I,{get when(){return t.showText!==!1},get children(){var h=ct();return h.style.setProperty("color","#374151"),h.style.setProperty("font-weight","500"),s(h,O),h}}),null),s(v,S(I,{get when(){return ee(()=>!!(t.showProgress&&f()===V.InProgress))()&&D()>0},get children(){var h=bt(),x=h.firstChild,A=x.firstChild,U=x.nextSibling,y=U.firstChild,l=y.nextSibling,b=l.nextSibling,o=b.nextSibling;return o.nextSibling,h.style.setProperty("display","flex"),h.style.setProperty("flex-direction","column"),h.style.setProperty("gap","4px"),h.style.setProperty("min-width","80px"),x.style.setProperty("width","80px"),U.style.setProperty("font-size","11px"),U.style.setProperty("color","#6b7280"),U.style.setProperty("text-align","center"),s(U,T,y),s(U,D,l),s(U,H,o),j(n=>(n=`${H()}%`)!=null?A.style.setProperty("width",n):A.style.removeProperty("width")),h}}),null),j(h=>{var x=`sync-status ${t.compact?"compact":""} ${t.className||""}`,A=t.compact?"4px":"8px",U=t.compact?"4px 8px":"8px 12px",y=`1px solid ${E()}20`,l=t.compact?"12px":"14px",b=`status-icon ${f()===V.InProgress?"spinning":""}`,o=E(),n=t.compact?"14px":"16px";return x!==h.e&&Z(v,h.e=x),A!==h.t&&((h.t=A)!=null?v.style.setProperty("gap",A):v.style.removeProperty("gap")),U!==h.a&&((h.a=U)!=null?v.style.setProperty("padding",U):v.style.removeProperty("padding")),y!==h.o&&((h.o=y)!=null?v.style.setProperty("border",y):v.style.removeProperty("border")),l!==h.i&&((h.i=l)!=null?v.style.setProperty("font-size",l):v.style.removeProperty("font-size")),b!==h.n&&Z(C,h.n=b),o!==h.s&&((h.s=o)!=null?C.style.setProperty("color",o):C.style.removeProperty("color")),n!==h.h&&((h.h=n)!=null?C.style.setProperty("font-size",n):C.style.removeProperty("font-size")),h},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0}),v})()}oe("sync-status",{status:void 0,showText:!0,showProgress:!1,itemsSynced:0,totalItems:0,compact:!1,className:""},mt);var ft=p("<div class=stat><span>ETA:</span><span class=stat-value>"),yt=p("<div class=stat><span>Items:</span><span class=stat-value> / "),gt=p("<div class=stat><span>Batch:</span><span class=stat-value> / "),pt=p("<div><style></style><div class=progress-bar><div></div></div><div class=info-grid><div>%</div></div><div class=info-grid>");function ht(t){const[f,B]=L(t.progress||0),[T,z]=L(t.itemsSynced||0),[D,K]=L(t.totalItems||0),[E,O]=L(t.currentBatch||0),[N,H]=L(t.totalBatches||0),[v,P]=L(t.estimatedRemainingSeconds||0);X(()=>{t.progress!==void 0&&B(Math.max(0,Math.min(100,t.progress)))}),X(()=>{t.itemsSynced!==void 0&&z(t.itemsSynced)}),X(()=>{t.totalItems!==void 0&&K(t.totalItems)}),X(()=>{t.currentBatch!==void 0&&O(t.currentBatch)}),X(()=>{t.totalBatches!==void 0&&H(t.totalBatches)}),X(()=>{t.estimatedRemainingSeconds!==void 0&&P(t.estimatedRemainingSeconds)});const C=()=>{const x=v();if(x<60)return`${Math.round(x)}s`;if(x<3600){const A=Math.floor(x/60),U=Math.round(x%60);return`${A}m ${U}s`}else{const A=Math.floor(x/3600),U=Math.floor(x%3600/60);return`${A}h ${U}m`}},h=()=>f()<30?"#ef4444":f()<70?"#f59e0b":"#10b981";return(()=>{var x=pt(),A=x.firstChild,U=A.nextSibling,y=U.firstChild,l=U.nextSibling,b=l.firstChild,o=b.firstChild,n=l.nextSibling;return x.style.setProperty("display","flex"),x.style.setProperty("flex-direction","column"),x.style.setProperty("gap","8px"),x.style.setProperty("padding","12px"),x.style.setProperty("border-radius","8px"),x.style.setProperty("background-color","#f8fafc"),x.style.setProperty("border","1px solid #e2e8f0"),x.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),x.style.setProperty("font-size","14px"),x.style.setProperty("min-width","250px"),s(A,()=>`
        .sync-progress .progress-bar {
          width: 100%;
          height: 8px;
          background-color: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }
        .sync-progress .progress-fill {
          height: 100%;
          background-color: ${h()};
          border-radius: 4px;
          transition: width 0.3s ease;
          position: relative;
        }
        .sync-progress .progress-fill.animated::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.4),
            transparent
          );
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .sync-progress .info-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }
        .sync-progress .stat {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #6b7280;
          font-size: 12px;
        }
        .sync-progress .stat-value {
          font-weight: 600;
          color: #374151;
        }
      `),b.style.setProperty("font-weight","600"),b.style.setProperty("color","#374151"),b.style.setProperty("font-size","16px"),s(b,()=>Math.round(f()),o),s(l,S(I,{get when(){return ee(()=>!!t.showETA)()&&v()>0},get children(){var c=ft(),r=c.firstChild,e=r.nextSibling;return s(e,C),c}}),null),s(n,S(I,{get when(){return ee(()=>!!t.showItemCount)()&&D()>0},get children(){var c=yt(),r=c.firstChild,e=r.nextSibling,i=e.firstChild;return s(e,()=>T().toLocaleString(),i),s(e,()=>D().toLocaleString(),null),c}}),null),s(n,S(I,{get when(){return ee(()=>!!t.showBatchInfo)()&&N()>0},get children(){var c=gt(),r=c.firstChild,e=r.nextSibling,i=e.firstChild;return s(e,E,i),s(e,N,null),c}}),null),j(c=>{var r=`sync-progress ${t.className||""}`,e=`progress-fill ${t.animated?"animated":""}`,i=`${f()}%`;return r!==c.e&&Z(x,c.e=r),e!==c.t&&Z(y,c.t=e),i!==c.a&&((c.a=i)!=null?y.style.setProperty("width",i):y.style.removeProperty("width")),c},{e:void 0,t:void 0,a:void 0}),x})()}oe("sync-progress",{progress:0,itemsSynced:0,totalItems:0,currentBatch:0,totalBatches:0,estimatedRemainingSeconds:0,showBatchInfo:!0,showETA:!0,showItemCount:!0,animated:!0,className:""},ht);var vt=p("<img>"),xt=p("<video controls>Your browser does not support video playback."),$t=p("<div><audio controls>Your browser does not support audio playback."),wt=p("<pre>"),Pt=p("<div><div>📄</div><div></div><div> • "),_t=p("<button>"),St=p("<div><div>Loading blob..."),Ct=p("<div><strong>Error:</strong> "),he=p("<div>"),kt=p("<div><strong>Extension:</strong> ."),It=p("<div><strong>Local Path:</strong> <code>"),zt=p("<div><h4>Metadata</h4><div><strong>ID:</strong> <code></code></div><div><strong>Size:</strong> </div><div><strong>Type:</strong> </div><div><strong>Created:</strong> </div><div><strong>SHA256:</strong> <code>"),Ut=p("<button>📥 Download ");const Bt=t=>{const[f,B]=L(null),[T,z]=L(null),[D,K]=L(null),[E,O]=L(!1),[N,H]=L(null),v=new we({baseUrl:t.baseUrl||window.location.origin}),P=()=>t.maxWidth||"100%",C=()=>t.maxHeight||"400px";X(()=>{t.blobId&&(t.autoLoad??!0)&&h(t.blobId)}),ue(()=>{const y=T();y&&URL.revokeObjectURL(y)});const h=async y=>{if(y){O(!0),H(null),B(null),z(null),K(null);try{const l=await v.getBlobInfo(y);if(B(l),l.is_image||l.is_video||l.is_audio){const b=await v.createBlobUrl(y);z(b)}else if(l.is_text&&(l.size||0)<1024*1024){const b=await v.getBlobText(y);K(b)}}catch(l){l instanceof Be?H(`${l.type}: ${l.message}`):H(`Error loading blob: ${l}`)}finally{O(!1)}}},x=async()=>{const y=f();if(y)try{await v.downloadBlob(y.id,y.display_name)}catch(l){H(`Download failed: ${l}`)}},A=y=>new Date(y).toLocaleString(),U=()=>{const y=f(),l=T(),b=D();return y?y.is_image&&l?(()=>{var o=vt();return o.addEventListener("error",()=>H("Failed to load image")),re(o,"src",l),o.style.setProperty("object-fit","contain"),o.style.setProperty("border-radius","4px"),j(n=>{var c=y.display_name,r=P(),e=C();return c!==n.e&&re(o,"alt",n.e=c),r!==n.t&&((n.t=r)!=null?o.style.setProperty("max-width",r):o.style.removeProperty("max-width")),e!==n.a&&((n.a=e)!=null?o.style.setProperty("max-height",e):o.style.removeProperty("max-height")),n},{e:void 0,t:void 0,a:void 0}),o})():y.is_video&&l?(()=>{var o=xt();return o.addEventListener("error",()=>H("Failed to load video")),re(o,"src",l),j(n=>{var c=P(),r=C();return c!==n.e&&((n.e=c)!=null?o.style.setProperty("max-width",c):o.style.removeProperty("max-width")),r!==n.t&&((n.t=r)!=null?o.style.setProperty("max-height",r):o.style.removeProperty("max-height")),n},{e:void 0,t:void 0}),o})():y.is_audio&&l?(()=>{var o=$t(),n=o.firstChild;return n.addEventListener("error",()=>H("Failed to load audio")),re(n,"src",l),n.style.setProperty("width","100%"),o})():y.is_text&&b?(()=>{var o=wt();return o.style.setProperty("background-color","#f5f5f5"),o.style.setProperty("padding","1rem"),o.style.setProperty("border-radius","4px"),o.style.setProperty("white-space","pre-wrap"),o.style.setProperty("word-wrap","break-word"),o.style.setProperty("overflow","auto"),o.style.setProperty("font-family","monospace"),o.style.setProperty("font-size","0.9rem"),o.style.setProperty("border","1px solid #ddd"),s(o,b),j(n=>(n=C())!=null?o.style.setProperty("max-height",n):o.style.removeProperty("max-height")),o})():(()=>{var o=Pt(),n=o.firstChild,c=n.nextSibling,r=c.nextSibling,e=r.firstChild;return o.style.setProperty("padding","2rem"),o.style.setProperty("text-align","center"),o.style.setProperty("border","2px dashed #ccc"),o.style.setProperty("border-radius","8px"),o.style.setProperty("background-color","#f9f9f9"),n.style.setProperty("font-size","3rem"),n.style.setProperty("margin-bottom","1rem"),c.style.setProperty("font-weight","bold"),c.style.setProperty("margin-bottom","0.5rem"),s(c,()=>y.display_name),r.style.setProperty("color","#666"),r.style.setProperty("font-size","0.9rem"),s(r,()=>y.mime_type||"Unknown type",e),s(r,()=>y.formatted_size,null),o})():null};return(()=>{var y=he();return y.style.setProperty("width","100%"),s(y,S(I,{get when(){return!t.autoLoad&&t.blobId},get children(){var l=_t();return l.$$click=()=>h(t.blobId),l.style.setProperty("padding","0.5rem 1rem"),l.style.setProperty("margin-bottom","1rem"),l.style.setProperty("background-color","#007bff"),l.style.setProperty("color","white"),l.style.setProperty("border","none"),l.style.setProperty("border-radius","4px"),s(l,()=>E()?"Loading...":"Load Blob"),j(b=>{var o=E(),n=E()?"not-allowed":"pointer";return o!==b.e&&(l.disabled=b.e=o),n!==b.t&&((b.t=n)!=null?l.style.setProperty("cursor",n):l.style.removeProperty("cursor")),b},{e:void 0,t:void 0}),l}}),null),s(y,S(I,{get when(){return E()},get children(){var l=St();return l.style.setProperty("padding","2rem"),l.style.setProperty("text-align","center"),l.style.setProperty("color","#666"),l}}),null),s(y,S(I,{get when(){return N()},get children(){var l=Ct(),b=l.firstChild;return b.nextSibling,l.style.setProperty("padding","1rem"),l.style.setProperty("background-color","#f8d7da"),l.style.setProperty("color","#721c24"),l.style.setProperty("border","1px solid #f5c6cb"),l.style.setProperty("border-radius","4px"),l.style.setProperty("margin-bottom","1rem"),s(l,N,null),l}}),null),s(y,S(I,{get when(){return ee(()=>!!(f()&&!E()))()&&!N()},get children(){return[(()=>{var l=he();return l.style.setProperty("margin-bottom","1rem"),s(l,U),l})(),S(I,{get when(){return t.showMetadata},get children(){var l=zt(),b=l.firstChild,o=b.nextSibling,n=o.firstChild,c=n.nextSibling,r=c.nextSibling,e=o.nextSibling,i=e.firstChild;i.nextSibling;var m=e.nextSibling,$=m.firstChild;$.nextSibling;var a=m.nextSibling,k=a.firstChild;k.nextSibling;var R=a.nextSibling,q=R.firstChild,G=q.nextSibling,J=G.nextSibling;return l.style.setProperty("background-color","#f8f9fa"),l.style.setProperty("padding","1rem"),l.style.setProperty("border-radius","4px"),l.style.setProperty("border","1px solid #dee2e6"),l.style.setProperty("font-size","0.9rem"),b.style.setProperty("margin","0 0 0.5rem 0"),r.style.setProperty("font-size","0.8rem"),s(r,()=>f()?.id),s(e,()=>f()?.formatted_size,null),s(m,()=>f()?.mime_type||"Unknown",null),s(l,S(I,{get when(){return f()?.file_extension},get children(){var Y=kt(),w=Y.firstChild;return w.nextSibling,s(Y,()=>f()?.file_extension,null),Y}}),a),s(a,()=>A(f()?.created_at||""),null),J.style.setProperty("font-size","0.8rem"),J.style.setProperty("word-break","break-all"),s(J,()=>f()?.sha256),s(l,S(I,{get when(){return f()?.local_path},get children(){var Y=It(),w=Y.firstChild,_=w.nextSibling,M=_.nextSibling;return M.style.setProperty("font-size","0.8rem"),s(M,()=>f()?.local_path),Y}}),null),l}}),S(I,{get when(){return t.enableDownload},get children(){var l=Ut();return l.firstChild,l.$$click=x,l.style.setProperty("padding","0.5rem 1rem"),l.style.setProperty("margin-top","1rem"),l.style.setProperty("background-color","#28a745"),l.style.setProperty("color","white"),l.style.setProperty("border","none"),l.style.setProperty("border-radius","4px"),l.style.setProperty("cursor","pointer"),s(l,()=>f()?.display_name,null),l}})]}}),null),y})()};oe("blob-viewer",{blobId:void 0,baseUrl:void 0,maxWidth:"100%",maxHeight:"400px",showMetadata:!1,enableDownload:!0,autoLoad:!0},Bt);ie(["click"]);console.log("🧩 Web Components Library loaded - Available components:",["webauthn-auth","websocket-handler","websocket-status","websocket-demo","websocket-feed-manager","websocket-feed-demo","media-blob-feed-item","media-blob-feed-list","simple-test","smart-file-upload","sync-status","sync-progress","unified-sync-demo","blob-viewer","infinite-data-grid","generic-infinite-grid","product-data-grid-demo","search-demo","freqhole-demo","zune-demo"]);
//# sourceMappingURL=all-components.js.map
