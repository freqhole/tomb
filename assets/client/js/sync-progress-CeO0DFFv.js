import{c as x,g as $,t as B,k as c,i as k,S as N,b as O,m as q,e as X}from"./web-Bmt1sUg0.js";import{c as ae}from"./index-CuXI0cIU.js";import{M as Q,S as Y,P as Z,b as ee}from"./websocket-client-BIZ3xMI1.js";import{b as ne,C as R,c as K,d as W,S as d}from"./sync-constants-QglVsuEd.js";import{s,n as A,o as n,b as w,c as i,r as re,a as oe,e as E,u as se,d as j}from"./types-DDODKsJP.js";import"./api-client-oDSgDTkX.js";import"./blob-client-DCiVtQuT.js";//! Zod schemas for sync API types and validation
//!
//! This module provides comprehensive Zod schemas for all sync-related API types,
//! ensuring type safety and runtime validation for the sync engine.
//! These schemas mirror the Rust server-side types to maintain consistency.
const g=s().uuid(),te=s().min(7),p=s().datetime(),o=A().int().positive(),y=A().int().min(0),ke=n({last_sync_time:p.optional(),cursor:s().optional(),page_size:o.max(1e3).default(50),client_id:g,include_data:i().default(!1),mime_types:w(s()).optional()}),ie=n({batch_size:y,has_more:i(),next_cursor:s().nullable().optional(),progress:A().min(0).max(1).nullable().optional(),suggested_delay:o.optional()}),le=n({items:w(Q),pagination:ie,sync_timestamp:p,is_full_sync:i(),total_items:y.nullable().optional()});n({last_sync_time:p.optional(),cursor:s().optional(),page_size:o.max(1e3).default(50),client_id:g,artist:s().optional(),album:s().optional(),favorites_only:i().optional()});const ce=n({is_full_sync:i(),items:w(Y),pagination:n({has_more:i(),next_cursor:s().nullable()}),sync_timestamp:s(),total_items:y});n({last_sync_time:p.optional(),cursor:s().optional(),page_size:o.max(1e3).default(50),client_id:g,public_only:i().optional()});const me=n({is_full_sync:i(),items:w(Z),pagination:n({has_more:i(),next_cursor:s().nullable()}),sync_timestamp:s(),total_items:y});n({last_sync_time:p.optional(),cursor:s().optional(),page_size:o.max(1e3).default(50),client_id:g,playlist_id:g.optional()});const de=n({is_full_sync:i(),items:w(ee),playlist_id:g.optional(),pagination:n({has_more:i(),next_cursor:s().nullable()}),sync_timestamp:s(),total_items:y}),ye=n({client_id:g,last_sync_time:p,total_items_synced:y,status:ne,last_cursor:s().nullable().optional(),updated_at:p});n({client_id:g,sync_timestamp:p,items_synced:y,failed_items:w(te).default([]),client_sync_state:ye});const ue=n({max_batch_size:o,min_sync_interval:o,supported_mime_filters:w(s()),supports_incremental:i(),supports_cursors:i(),sync_history_retention_days:o}),pe=n({server_time:p,active_syncs:y,total_items:y,last_modification:p.nullable().optional(),capabilities:ue}),Ne=n({client_id:g,batch_size:o.max(1e3).default(100),start_cursor:s().optional(),include_data:i().default(!1),mime_types:w(s()).optional()});n({status:ne,items_synced:y,total_items:y.nullable().optional(),progress:A().min(0).max(100).nullable().optional(),current_cursor:s().nullable().optional(),estimated_remaining_seconds:o.optional(),current_batch:o.optional(),total_batches:o.optional()});n({type:s(),message:s().min(1),timestamp:p,context:re(oe()).optional(),recoverable:i().default(!0),retry_delay:o.optional()});n({id:g,item_id:te,item_type:E(["media_blob","song","playlist","playlist_song"]),type:E([K.Version,K.Deletion,K.Metadata]),local_version:se([Q,Y,Z,ee]),server_version:se([Q,Y,Z,ee]),detected_at:p,resolved:i().default(!1),resolution:E([R.LocalWins,R.RemoteWins,R.Merge,R.Skip]).optional()});const fe=n({should_sync:i(),recommended_batch_size:o,recommended_interval_seconds:o,estimated_batches:y,estimated_duration_seconds:y,priority:E([W.Low,W.Normal,W.High,W.Urgent]),items_to_sync:y});n({last_sync_time:s().optional(),cursor:s().optional(),page_size:j.number().int().positive().max(1e3).default(50),include_data:j.boolean().default(!1),mime_types:s().optional()});n({batch_size:j.number().int().positive().max(1e3).default(100),start_cursor:s().optional(),include_data:j.boolean().default(!1),mime_types:s().optional()});const Ee=n({sync_timestamp:p,items_synced:y,failed_items:w(te).default([])}),ge=n({apiBaseUrl:s().url(),authToken:s().min(1),clientId:g,batchSize:o.max(1e3).default(50),maxRetryAttempts:A().int().min(0).max(10).default(3),retryDelay:o.default(1e3),includeBinaryData:i().default(!1),conflictResolution:E([R.Manual,R.LocalWins,R.RemoteWins]).default(R.Manual),enableStorage:i().default(!0),maxStorageSize:o.default(100*1024*1024),maxCacheAge:o.default(30)}),Ae=e=>le.safeParse(e),Fe=e=>pe.safeParse(e),Le=e=>fe.safeParse(e),Ue=e=>ce.safeParse(e),De=e=>me.safeParse(e),We=e=>de.safeParse(e),qe=e=>ge.parse(e);var _e=B("<span>"),he=B("<div><div class=progress-bar><div class=progress-fill></div></div><span>/<!> (<!>%)"),Se=B("<div><style></style><span>");function ve(e){const[_,H]=x(e.status||d.Never),[F,V]=x(e.itemsSynced||0),[T,G]=x(e.totalItems||0);$(()=>{e.status!==void 0&&H(e.status)}),$(()=>{e.itemsSynced!==void 0&&V(e.itemsSynced)}),$(()=>{e.totalItems!==void 0&&G(e.totalItems)});const M=()=>{switch(_()){case d.Never:return"#94a3b8";case d.Complete:return"#10b981";case d.InProgress:return"#f59e0b";case d.Failed:return"#ef4444";default:return"#94a3b8"}},J=()=>{switch(_()){case d.Never:return"Not synced";case d.Complete:return"Up to date";case d.InProgress:return"Syncing...";case d.Failed:return"Sync failed";default:return"Unknown"}},L=()=>{switch(_()){case d.Never:return"○";case d.Complete:return"✓";case d.InProgress:return"⟳";case d.Failed:return"⚠";default:return"○"}},U=()=>T()===0?0:Math.round(F()/T()*100);return(()=>{var r=Se(),D=r.firstChild,b=D.nextSibling;return r.style.setProperty("display","inline-flex"),r.style.setProperty("align-items","center"),r.style.setProperty("border-radius","6px"),r.style.setProperty("background-color","#f8fafc"),r.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),c(D,()=>`
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
          background-color: ${M()};
          transition: width 0.3s ease;
          border-radius: 4px;
        }
      `),b.style.setProperty("font-weight","bold"),c(b,L),c(r,k(N,{get when(){return e.showText!==!1},get children(){var t=_e();return t.style.setProperty("color","#374151"),t.style.setProperty("font-weight","500"),c(t,J),t}}),null),c(r,k(N,{get when(){return q(()=>!!(e.showProgress&&_()===d.InProgress))()&&T()>0},get children(){var t=he(),a=t.firstChild,u=a.firstChild,l=a.nextSibling,h=l.firstChild,S=h.nextSibling,v=S.nextSibling,C=v.nextSibling;return C.nextSibling,t.style.setProperty("display","flex"),t.style.setProperty("flex-direction","column"),t.style.setProperty("gap","4px"),t.style.setProperty("min-width","80px"),a.style.setProperty("width","80px"),l.style.setProperty("font-size","11px"),l.style.setProperty("color","#6b7280"),l.style.setProperty("text-align","center"),c(l,F,h),c(l,T,S),c(l,U,C),O(P=>(P=`${U()}%`)!=null?u.style.setProperty("width",P):u.style.removeProperty("width")),t}}),null),O(t=>{var a=`sync-status ${e.compact?"compact":""} ${e.className||""}`,u=e.compact?"4px":"8px",l=e.compact?"4px 8px":"8px 12px",h=`1px solid ${M()}20`,S=e.compact?"12px":"14px",v=`status-icon ${_()===d.InProgress?"spinning":""}`,C=M(),P=e.compact?"14px":"16px";return a!==t.e&&X(r,t.e=a),u!==t.t&&((t.t=u)!=null?r.style.setProperty("gap",u):r.style.removeProperty("gap")),l!==t.a&&((t.a=l)!=null?r.style.setProperty("padding",l):r.style.removeProperty("padding")),h!==t.o&&((t.o=h)!=null?r.style.setProperty("border",h):r.style.removeProperty("border")),S!==t.i&&((t.i=S)!=null?r.style.setProperty("font-size",S):r.style.removeProperty("font-size")),v!==t.n&&X(b,t.n=v),C!==t.s&&((t.s=C)!=null?b.style.setProperty("color",C):b.style.removeProperty("color")),P!==t.h&&((t.h=P)!=null?b.style.setProperty("font-size",P):b.style.removeProperty("font-size")),t},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0}),r})()}ae("sync-status",{status:void 0,showText:!0,showProgress:!1,itemsSynced:0,totalItems:0,compact:!1,className:""},ve);var be=B("<div class=stat><span>ETA:</span><span class=stat-value>"),Pe=B("<div class=stat><span>Items:</span><span class=stat-value> / "),xe=B("<div class=stat><span>Batch:</span><span class=stat-value> / "),$e=B("<div><style></style><div class=progress-bar><div></div></div><div class=info-grid><div>%</div></div><div class=info-grid>");function we(e){const[_,H]=x(e.progress||0),[F,V]=x(e.itemsSynced||0),[T,G]=x(e.totalItems||0),[M,J]=x(e.currentBatch||0),[L,U]=x(e.totalBatches||0),[r,D]=x(e.estimatedRemainingSeconds||0);$(()=>{e.progress!==void 0&&H(Math.max(0,Math.min(100,e.progress)))}),$(()=>{e.itemsSynced!==void 0&&V(e.itemsSynced)}),$(()=>{e.totalItems!==void 0&&G(e.totalItems)}),$(()=>{e.currentBatch!==void 0&&J(e.currentBatch)}),$(()=>{e.totalBatches!==void 0&&U(e.totalBatches)}),$(()=>{e.estimatedRemainingSeconds!==void 0&&D(e.estimatedRemainingSeconds)});const b=()=>{const a=r();if(a<60)return`${Math.round(a)}s`;if(a<3600){const u=Math.floor(a/60),l=Math.round(a%60);return`${u}m ${l}s`}else{const u=Math.floor(a/3600),l=Math.floor(a%3600/60);return`${u}h ${l}m`}},t=()=>_()<30?"#ef4444":_()<70?"#f59e0b":"#10b981";return(()=>{var a=$e(),u=a.firstChild,l=u.nextSibling,h=l.firstChild,S=l.nextSibling,v=S.firstChild,C=v.firstChild,P=S.nextSibling;return a.style.setProperty("display","flex"),a.style.setProperty("flex-direction","column"),a.style.setProperty("gap","8px"),a.style.setProperty("padding","12px"),a.style.setProperty("border-radius","8px"),a.style.setProperty("background-color","#f8fafc"),a.style.setProperty("border","1px solid #e2e8f0"),a.style.setProperty("font-family","system-ui, -apple-system, sans-serif"),a.style.setProperty("font-size","14px"),a.style.setProperty("min-width","250px"),c(u,()=>`
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
          background-color: ${t()};
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
      `),v.style.setProperty("font-weight","600"),v.style.setProperty("color","#374151"),v.style.setProperty("font-size","16px"),c(v,()=>Math.round(_()),C),c(S,k(N,{get when(){return q(()=>!!e.showETA)()&&r()>0},get children(){var m=be(),I=m.firstChild,f=I.nextSibling;return c(f,b),m}}),null),c(P,k(N,{get when(){return q(()=>!!e.showItemCount)()&&T()>0},get children(){var m=Pe(),I=m.firstChild,f=I.nextSibling,z=f.firstChild;return c(f,()=>F().toLocaleString(),z),c(f,()=>T().toLocaleString(),null),m}}),null),c(P,k(N,{get when(){return q(()=>!!e.showBatchInfo)()&&L()>0},get children(){var m=xe(),I=m.firstChild,f=I.nextSibling,z=f.firstChild;return c(f,M,z),c(f,L,null),m}}),null),O(m=>{var I=`sync-progress ${e.className||""}`,f=`progress-fill ${e.animated?"animated":""}`,z=`${_()}%`;return I!==m.e&&X(a,m.e=I),f!==m.t&&X(h,m.t=f),z!==m.a&&((m.a=z)!=null?h.style.setProperty("width",z):h.style.removeProperty("width")),m},{e:void 0,t:void 0,a:void 0}),a})()}ae("sync-progress",{progress:0,itemsSynced:0,totalItems:0,currentBatch:0,totalBatches:0,estimatedRemainingSeconds:0,showBatchInfo:!0,showETA:!0,showItemCount:!0,animated:!0,className:""},we);export{Ne as F,Ee as S,Ae as a,Fe as b,Ue as c,De as d,We as e,ke as f,ve as g,we as h,Le as s,qe as v};
//# sourceMappingURL=sync-progress-CeO0DFFv.js.map
