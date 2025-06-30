import{d as xe,c as b,t as y,a as N,b as z,e as V,s as S,i as a,m as ne,f as $,S as ce,F as ie,g as $t,h as Q,o as Le,u as at,j as st,k as yt,r as St}from"./web-DgpntjfK.js";var Ct=y(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
        .resize-handle:hover,
        .resize-handle.dragging {
          background: rgba(255, 0, 255, 0.15);
        }

        .resize-handle:hover .resize-handle-indicator,
        .resize-handle.dragging .resize-handle-indicator {
          width: 3px !important;
          height: 60px !important;
          box-shadow: 0 0 4px rgba(255, 0, 255, 0.5);
        }
      `);function dt(e){const[r,c]=b(!1);return(()=>{var s=Ct(),f=s.firstChild,D=f.nextSibling;return s.addEventListener("mouseleave",()=>c(!1)),s.addEventListener("mouseenter",()=>c(!0)),N(s,"mousedown",e.onMouseDown),z(d=>{var h=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,_=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,L=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${r()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,M=`
          position: absolute;
          top: 50%;
          ${e.position==="left"?"left: 12px;":"right: 12px;"}
          transform: translateY(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: #e0e0e0;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          pointer-events: none;
          opacity: ${r()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return h!==d.e&&V(s,d.e=h),d.t=S(s,_,d.t),d.a=S(f,L,d.a),d.o=S(D,M,d.o),d},{e:void 0,t:void 0,a:void 0,o:void 0}),s})()}xe(["mousedown"]);function ct(e){const[r,c]=b(e.initialWidth),[s,f]=b(!1),D=e.minWidth||250,d=e.maxWidth||600,h=e.closeThreshold||100;return{width:r,setWidth:c,isDragging:s,handleMouseDown:(L,M="right")=>{L.preventDefault(),f(!0),document.body.classList.add("resizing");const I=L.clientX,W=r(),H=v=>{const k=v.clientX-I,O=M==="right"?W-k:W+k;if(O<h){e.onClose?.();return}const B=Math.max(D,Math.min(d,O));c(B),e.onWidthChange?.(B)},Y=()=>{f(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",H),document.removeEventListener("mouseup",Y)};document.addEventListener("mousemove",H),document.addEventListener("mouseup",Y)}}}var kt=y(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
        .filter-input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .browse-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        /* Global resizing behavior */
        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }

        body.resizing * {
          cursor: col-resize !important;
          user-select: none !important;
        }

        /* Prevent overflow in panel content */
        .browse-panel,
        .filter-panel {
          overflow-x: hidden;
        }

        .browse-panel *,
        .filter-panel * {
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Smooth transitions for panel operations */
        .browse-panel.resizing,
        .filter-panel.resizing {
          transition: none !important;
        }
      `),_t=y('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function zt(e){const r=ct({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var c=kt(),s=c.firstChild,f=s.firstChild,D=f.nextSibling,d=s.nextSibling;return N(D,"click",e.onTogglePanel),a(c,(()=>{var h=ne(()=>!!e.isOpen);return()=>h()&&(()=>{var _=_t(),L=_.firstChild,M=L.nextSibling;return M.$$input=I=>e.onFilterChange("name",I.currentTarget.value),z(()=>M.value=e.filterConfig.name),_})()})(),d),a(c,$(dt,{position:"right",get isDragging(){return r.isDragging()},onMouseDown:h=>r.handleMouseDown(h,"left")}),d),z(h=>{var _=`browse-panel ${e.isOpen?"":"collapsed"} ${r.isDragging()?"resizing":""}`,L=`
        width: ${e.isOpen?r.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return _!==h.e&&V(c,h.e=_),h.t=S(c,L,h.t),h},{e:void 0,t:void 0}),c})()}xe(["click","input"]);var Mt=y(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
        .filter-input:focus {
          outline: none;
          border-color: #0070f3;
        }

        .ws-button:hover {
          background: rgba(255, 0, 255, 0.8);
        }

        .ws-button.danger:hover {
          background: #555555;
        }

        .ws-button:disabled {
          background: #444444;
          border-color: #444444;
          color: #888888;
          cursor: not-allowed;
        }

        .reset-button:hover {
          background: #dc2626;
        }

        .filter-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }
      `),Dt=y('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),It=y('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Rt=y('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),tt=y("<option>"),Pt=y("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Tt=y("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Lt(e){const[r,c]=b(!1),s=ct({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),f=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],D=d=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[d]||"color: #6b7280;";return(()=>{var d=Mt(),h=d.firstChild,_=h.firstChild,L=_.nextSibling,M=h.nextSibling;return N(L,"click",e.onTogglePanel),a(d,(()=>{var I=ne(()=>!!e.isOpen);return()=>I()&&(()=>{var W=Rt(),H=W.firstChild,Y=H.firstChild,v=Y.nextSibling,k=v.nextSibling,O=k.firstChild,B=O.nextSibling,p=k.nextSibling,g=p.firstChild,x=g.nextSibling,q=p.nextSibling,m=q.firstChild,u=m.nextSibling,R=H.nextSibling,w=R.firstChild,G=w.nextSibling,X=G.firstChild,Ce=X.nextSibling,ke=R.nextSibling,Fe=ke.firstChild,oe=Fe.nextSibling;oe.firstChild;var _e=ke.nextSibling,ze=_e.firstChild,ge=ze.nextSibling;ge.firstChild;var me=_e.nextSibling,We=me.firstChild,Ee=We.nextSibling,ve=Ee.firstChild,Oe=ve.nextSibling,fe=Oe.nextSibling,Me=me.nextSibling,Ae=Me.firstChild,De=Ae.nextSibling,le=Me.nextSibling,Ue=le.firstChild,Ie=Ue.nextSibling,pe=le.nextSibling,Ve=pe.firstChild,He=Ve.nextSibling,re=He.firstChild,ae=re.nextSibling,ue=ae.nextSibling,we=pe.nextSibling,he=we.firstChild,Z=he.nextSibling,Be=Z.firstChild,$e=Z.nextSibling,Re=we.nextSibling,Ne=Re.firstChild,J=Ne.nextSibling,qe=J.firstChild,ye=qe.nextSibling,Pe=ye.nextSibling,E=Pe.nextSibling,t=E.nextSibling,i=t.nextSibling,l=i.nextSibling,o=l.nextSibling,P=o.nextSibling,F=P.nextSibling,C=F.nextSibling,A=C.nextSibling,se=A.nextSibling,Se=se.nextSibling;Se.nextSibling;var ee=J.nextSibling,Ke=ee.firstChild,Te=Ke.nextSibling,ft=ee.nextSibling;return v.$$input=n=>e.onWsUrlChange(n.currentTarget.value),a(B,()=>e.connectionStatus),N(g,"click",e.onConnect),N(x,"click",e.onDisconnect),N(u,"click",e.onToggleAutoConnect),a(u,()=>e.autoConnect?"ON":"OFF"),N(X,"click",e.onToggleAutoRefresh),a(X,()=>e.autoRefresh?"ON":"OFF"),N(Ce,"click",e.onRefresh),a(R,$(ce,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var n=Dt(),T=n.firstChild,te=T.firstChild,K=te.nextSibling;return K.nextSibling,N(T,"click",e.onApplyPendingUpdates),a(T,()=>e.pendingUpdatesCount,K),n}}),null),oe.addEventListener("change",n=>e.onFilterChange("mime",n.currentTarget.value)),a(oe,$(ie,{get each(){return e.mimeCategories},children:n=>(()=>{var T=tt();return T.value=n,a(T,n),T})()}),null),ge.addEventListener("change",n=>e.onFilterChange("blobType",n.currentTarget.value)),a(ge,$(ie,{get each(){return e.blobTypes},children:n=>(()=>{var T=tt();return T.value=n,a(T,n),T})()}),null),ve.$$input=n=>e.onFilterChange("minSize",parseInt(n.currentTarget.value)||0),fe.$$input=n=>e.onFilterChange("maxSize",parseInt(n.currentTarget.value)||1e8),De.addEventListener("change",n=>e.onFilterChange("hasParent",n.currentTarget.value)),Ie.addEventListener("change",n=>e.onFilterChange("hasLocalPath",n.currentTarget.value)),re.$$click=()=>e.onViewModeChange("compact"),ae.$$click=()=>e.onViewModeChange("default"),ue.$$click=()=>e.onViewModeChange("detailed"),Z.$$click=()=>c(!r()),a(Z,()=>r()?"Hide":"Show",Be),a($e,$(ie,{each:f,children:n=>(()=>{var T=Pt(),te=T.firstChild,K=te.firstChild,de=K.nextSibling;return K.addEventListener("change",()=>e.onColumnToggle(n.key)),a(de,()=>n.title),z(()=>K.checked=e.columnVisibility[n.key]),T})()})),a(J,()=>e.totalCount,ye),a(J,()=>e.filteredCount,i),a(J,()=>e.sortConfig.field,F),a(J,()=>e.sortConfig.direction,A),a(J,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),N(Te,"click",e.onToggleDebug),a(Te,()=>e.debug?"ON":"OFF"),N(ft,"click",e.onReset),a(W,$(ce,{get when(){return e.debug&&e.logs.length>0},get children(){var n=It(),T=n.firstChild,te=T.nextSibling;return a(te,$(ie,{get each(){return e.logs},children:K=>(()=>{var de=Tt();return a(de,K),de})()})),n}}),null),z(n=>{var T=D(e.connectionStatus),te=e.connectionStatus==="Connected",K=e.connectionStatus==="Disconnected",de=`toggle-button ${e.autoConnect?"active":""}`,ut=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Xe=`toggle-button ${e.autoRefresh?"active":""}`,ht=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,je=`view-mode-button ${e.viewMode==="compact"?"active":""}`,bt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="compact"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="compact"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="compact"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Ge=`view-mode-button ${e.viewMode==="default"?"active":""}`,xt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="default"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="default"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="default"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Je=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,mt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Qe=`toggle-button ${r()?"active":""}`,vt=`
            margin-bottom: 8px;
            width: 100%;
            padding: 8px;
            background: ${r()?"#ff00ff":"#333333"};
            box-sizing: border-box;
            min-width: 0;
            border: 1px solid ${r()?"#ff00ff":"#666666"};
            color: ${r()?"#000000":"#ffffff"};
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          `,Ze=`column-settings ${r()?"":"collapsed"}`,pt=`
            max-height: ${r()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,et=`toggle-button ${e.debug?"active":""}`,wt=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return n.e=S(B,T,n.e),te!==n.t&&(g.disabled=n.t=te),K!==n.a&&(x.disabled=n.a=K),de!==n.o&&V(u,n.o=de),n.i=S(u,ut,n.i),Xe!==n.n&&V(X,n.n=Xe),n.s=S(X,ht,n.s),je!==n.h&&V(re,n.h=je),n.r=S(re,bt,n.r),Ge!==n.d&&V(ae,n.d=Ge),n.l=S(ae,xt,n.l),Je!==n.u&&V(ue,n.u=Je),n.c=S(ue,mt,n.c),Qe!==n.w&&V(Z,n.w=Qe),n.m=S(Z,vt,n.m),Ze!==n.f&&V($e,n.f=Ze),n.y=S($e,pt,n.y),et!==n.g&&V(Te,n.g=et),n.p=S(Te,wt,n.p),n},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),z(()=>v.value=e.wsUrl),z(()=>oe.value=e.filterConfig.mime),z(()=>ge.value=e.filterConfig.blobType),z(()=>ve.value=e.filterConfig.minSize),z(()=>fe.value=e.filterConfig.maxSize),z(()=>De.value=e.filterConfig.hasParent),z(()=>Ie.value=e.filterConfig.hasLocalPath),W})()})(),M),a(d,$(dt,{position:"left",get isDragging(){return s.isDragging()},onMouseDown:I=>s.handleMouseDown(I,"right")}),M),z(I=>{var W=`filter-panel ${e.isOpen?"":"collapsed"} ${s.isDragging()?"resizing":""}`,H=`
        width: ${e.isOpen?s.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return W!==I.e&&V(d,I.e=W),I.t=S(d,H,I.t),I},{e:void 0,t:void 0}),d})()}xe(["click","input"]);var Ft=y(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
          .edge-toggle-button:hover {
            background: #3a3a3a !important;
            border-color: #4a4a4a !important;
            color: #e0e0e0 !important;
            width: 28px !important;
          }

          .edge-toggle-button:active {
            background: #ff00ff !important;
            border-color: #ff00ff !important;
            color: #000000 !important;
          }

          .edge-toggle-left:hover {
            transform: translateY(-50%) translateX(4px) !important;
          }

          .edge-toggle-right:hover {
            transform: translateY(-50%) translateX(-4px) !important;
          }
        `);function nt(e){const[r,c]=b(!1);return $(ce,{get when(){return e.isVisible},get children(){var s=Ft(),f=s.firstChild,D=f.nextSibling;return s.addEventListener("mouseleave",()=>c(!1)),s.addEventListener("mouseenter",()=>c(!0)),N(s,"click",e.onClick),a(f,()=>e.position==="left"?"→":"←"),a(D,()=>e.panelName),z(d=>{var h=`edge-toggle-button edge-toggle-${e.position}`,_=`Show ${e.panelName} panel`,L=`
          position: fixed;
          top: 50%;
          ${e.position}: 0;
          transform: translateY(-50%);
          width: 24px;
          height: 80px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          ${e.position==="left"?"border-left: none;":"border-right: none;"}
          border-radius: ${e.position==="left"?"0 8px 8px 0":"8px 0 0 8px"};
          cursor: pointer;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          color: #888;
          font-size: 12px;
          font-weight: 500;
          user-select: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          overflow: hidden;
        `,M=`
            opacity: ${r()?"1":"0"};
            transform: translateY(${r()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return h!==d.e&&V(s,d.e=h),_!==d.t&&$t(s,"title",d.t=_),d.a=S(s,L,d.a),d.o=S(f,M,d.o),d},{e:void 0,t:void 0,a:void 0,o:void 0}),s}})}xe(["click"]);const j={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function Wt(e){const[r,c]=b(e.initialSort||{field:"id",direction:"asc"}),[s,f]=b(new Set),[D,d]=b(!1),h=e.getItemId||(v=>v.id||String(v)),_=Q(()=>{const v=r();return[...e.data].sort((O,B)=>{const p=O[v.field],g=B[v.field];let x=0;return p<g?x=-1:p>g&&(x=1),v.direction==="desc"?x*-1:x})});return{sortConfig:r,selectedItems:s,isDragSelecting:D,sortedData:_,handleSort:v=>{const k=r(),O=k.field===v&&k.direction==="asc"?"desc":"asc";c({field:v,direction:O})},toggleSelection:v=>{const k=new Set(s());k.has(v)?k.delete(v):k.add(v),f(k)},clearSelection:()=>{f(new Set)},selectAll:()=>{const v=new Set(e.data.map(h));f(v)},isSelected:v=>s().has(v),selectRange:(v,k)=>{const O=new Set(s()),B=Math.min(v,k),p=Math.max(v,k);for(let g=B;g<=p;g++)if(g<e.data.length&&e.data[g]!=null){const x=h(e.data[g]);O.add(x)}f(O)},setIsDragSelecting:d,getItemId:h}}var Et=y("<div class=grid-row>"),Ot=y("<div class=grid-cell>"),it=y("<div class=grid-content>"),At=y("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),Ut=y("<span style=font-size:12px;>"),Vt=y("<div><span>"),Ht=y("<div>");function ot(e){let r;return Le(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var c=Et();c.$$contextmenu=f=>e.onContextMenu?.(e.item,e.index,f),c.$$mousedown=f=>e.onRowMouseDown?.(e.item,e.index,f),c.$$dblclick=f=>e.onRowDoubleClick?.(e.item,e.index,f),c.$$click=f=>e.onRowClick?.(e.item,e.index,f);var s=r;return typeof s=="function"?at(s,c):r=c,a(c,$(ie,{get each(){return e.columns},children:f=>(()=>{var D=Ot();return a(D,(()=>{var d=ne(()=>!!f.render);return()=>d()?f.render(e.item,e.index):String(e.item[f.key]||"")})()),z(d=>S(D,`
              flex: ${f.width?"0 0 "+f.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,d)),D})()})),z(f=>S(c,`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${j.colors.border};
        background: ${e.isSelected?j.colors.selected:"transparent"};
        transition: background-color 0.15s ease;
      `,f)),c})()}function Bt(e){const[r,c]=b(),[s,f]=b(0),[D,d]=b(0),h=e.rowHeight||50,_=e.headerHeight||60,L=e.virtualizeThreshold||100,M=Wt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),I=(p,g,x)=>{e.onRowClick?.(p,g,x)},W=(p,g,x)=>{e.onRowDoubleClick?.(p,g,x)},H=(p,g,x)=>{e.onRowMouseDown?.(p,g,x)},Y=Q(()=>e.data.length>L),v=Q(()=>{if(!Y())return e.data.map((w,G)=>({item:w,index:G}));if(!r())return[];const g=h,x=s(),q=D(),m=Math.floor(x/g),u=Math.min(e.data.length-1,Math.ceil((x+q)/g)+5),R=[];for(let w=Math.max(0,m-5);w<=u;w++)w<e.data.length&&e.data[w]!=null&&R.push({item:e.data[w],index:w});return R}),k=Q(()=>e.data.length*h),O=p=>{const g=p.target;f(g.scrollTop)},B=p=>{if(M.handleSort(p),e.onSort){const g=M.sortConfig();e.onSort(g.field,g.direction)}};return Le(()=>{const p=r();if(!p)return;const g=new ResizeObserver(x=>{for(const q of x)d(q.contentRect.height)});g.observe(p),st(()=>{g.disconnect()})}),(()=>{var p=At(),g=p.firstChild,x=g.nextSibling,q=x.nextSibling;return a(g,$(ie,{get each(){return e.columns},children:m=>(()=>{var u=Vt(),R=u.firstChild;return u.$$click=()=>m.sortable&&B(m.key),a(R,()=>m.title),a(u,$(ce,{get when(){return ne(()=>!!m.sortable)()&&M.sortConfig().field===m.key},get children(){var w=Ut();return a(w,()=>M.sortConfig().direction==="asc"?"↑":"↓"),w}}),null),z(w=>{var G=`grid-header-cell ${m.sortable?"sortable":""}`,X=`
                flex: ${m.width?"0 0 "+m.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${m.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return G!==w.e&&V(u,w.e=G),w.t=S(u,X,w.t),w},{e:void 0,t:void 0}),u})()})),x.addEventListener("scroll",O),at(c,x),a(x,$(ce,{get when(){return Y()},get fallback(){return(()=>{var m=it();return a(m,$(ie,{get each(){return e.data},children:(u,R)=>$(ot,{item:u,get index(){return R()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(u)||u.id)||!1},onRowClick:I,onRowDoubleClick:W,onRowMouseDown:H,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:h})})),m})()},get children(){var m=it();return a(m,$(ie,{get each(){return v()},children:u=>(()=>{var R=Ht();return a(R,$(ot,{get item(){return u.item},get index(){return u.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(u.item)||u.item.id)||!1},onRowClick:I,onRowDoubleClick:W,onRowMouseDown:H,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:h})),z(w=>S(R,`
                    position: absolute;
                    top: ${u.index*h}px;
                    left: 0;
                    right: 0;
                  `,w)),R})()})),z(u=>S(m,`height: ${k()}px; position: relative;`,u)),m}})),a(q,()=>`
        .grid-row:hover {
          background: ${j.colors.hover} !important;
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${j.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${j.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${j.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }
      `),z(m=>{var u=`infinite-data-grid ${e.className||""}`,R=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${j.colors.background};
        color: ${j.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,w=`
          height: ${_}px;
          display: flex;
          align-items: center;
          background: ${j.colors.header};
          border-bottom: 2px solid ${j.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return u!==m.e&&V(p,m.e=u),m.t=S(p,R,m.t),m.a=S(g,w,m.a),m},{e:void 0,t:void 0,a:void 0}),p})()}xe(["click","dblclick","mousedown","contextmenu"]);var Nt=y("<span style=font-family:monospace;font-size:12px;>"),qt=y("<div style=width:40px;height:40px;border-radius:4px;overflow:hidden;background:#333;display:flex;align-items:center;justify-content:center;font-size:12px;>"),be=y("<span>"),Kt=y('<button style="background:#0070f3;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;">View'),Yt=y('<div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);"><span style=color:#ffffff;font-weight:500;> item<!> selected</span><button style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">📥 Download</button><button style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Clear'),Xt=y("<div>"),jt=y(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }
      </style><style>
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
          cursor: crosshair;
        }
      `);const Ye="freqhole-demo-state",lt=300;function gt(){try{const e=localStorage.getItem(Ye);return e?JSON.parse(e):{}}catch{return{}}}function U(e){try{const c={...gt(),...e};localStorage.setItem(Ye,JSON.stringify(c))}catch{}}function Gt(e){const r=gt(),[c,s]=b([]),[f,D]=b({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...r.filterConfig||{}}),[d,h]=b({field:"created_at",direction:"desc",...r.sortConfig||{}}),[_,L]=b(r.viewMode||"default"),[M,I]=b({id:!0,thumbnail:!0,mime:!0,blob_type:!0,size:!0,parent_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...r.columnVisibility||{}}),[W,H]=b(r.isFilterPanelOpen??!0),[Y,v]=b(r.filterPanelWidth||lt),[k,O]=b(r.isBrowsePanelOpen??!0),[B,p]=b(r.browsePanelWidth||lt),[g,x]=b(new Set(r.selectedItems?Array.from(r.selectedItems):[])),[q,m]=b(-1),[u,R]=b(!1),[w,G]=b(null),[X,Ce]=b(null),[ke,Fe]=b(e.wsUrl),[oe,_e]=b(e.autoConnect),[ze,ge]=b(!0),[me,We]=b(!1),[Ee,ve]=b([]),[Oe,fe]=b("Disconnected"),[Me,Ae]=b(!1),[De,le]=b(null),Ue=(t,i,l)=>{const o=t.id,F=g().has(o);if(l.metaKey||l.ctrlKey)x(C=>{const A=new Set(C);return F?A.delete(o):A.add(o),U({selectedItems:A}),A}),m(i);else if(l.shiftKey&&q()>=0){const C=Math.min(q(),i),A=Math.max(q(),i),se=he().slice(C,A+1);x(Se=>{const ee=new Set(Se);return se.forEach(Ke=>ee.add(Ke.id)),U({selectedItems:ee}),ee})}else{const C=new Set([o]);x(C),m(i),U({selectedItems:C})}},Ie=t=>{console.log("Double-clicked:",t.id)},pe=()=>{x(new Set),m(-1),U({selectedItems:new Set})},Ve=()=>{const t=new Set(he().map(i=>i.id));x(t),U({selectedItems:t})},He=(t,i,l)=>{l.button===0&&!l.metaKey&&!l.ctrlKey&&!l.shiftKey&&(G({x:l.clientX,y:l.clientY,startIndex:i}),R(!0))},re=t=>{if(u()&&w()){Ce({x:t.clientX,y:t.clientY,endIndex:-1});const i=w(),l=Math.floor((t.clientY-i.y)/60);if(l!==i.startIndex){const o=Math.min(i.startIndex,i.startIndex+l),P=Math.max(i.startIndex,i.startIndex+l),F=he().slice(o,P+1);x(new Set(F.map(C=>C.id)))}}},ae=()=>{if(u()){const t=g();U({selectedItems:t}),R(!1),G(null),Ce(null)}},ue=t=>{t.key==="Escape"?pe():t.key==="a"&&(t.metaKey||t.ctrlKey)?(t.preventDefault(),Ve()):(t.key==="Delete"||t.key==="Backspace")&&g().size>0&&console.log("Delete requested for",g().size,"items")};Le(()=>{document.addEventListener("mousemove",re),document.addEventListener("mouseup",ae),document.addEventListener("keydown",ue),u()&&document.body.classList.add("drag-selecting")}),st(()=>{document.removeEventListener("mousemove",re),document.removeEventListener("mouseup",ae),document.removeEventListener("keydown",ue),document.body.classList.remove("drag-selecting")}),yt(()=>{u()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")});const we=Q(()=>{const t=f();return c().filter(i=>{if(t.name&&!Jt(i).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!i.mime?.startsWith(t.mime)||t.blobType&&i.blob_type!==t.blobType||i.size<t.minSize||i.size>t.maxSize)return!1;if(t.hasParent!=="all"){const l=!!i.parent_id;if(t.hasParent==="yes"&&!l||t.hasParent==="no"&&l)return!1}if(t.hasLocalPath!=="all"){const l=!!i.local_path;if(t.hasLocalPath==="yes"&&!l||t.hasLocalPath==="no"&&l)return!1}return!0})}),he=Q(()=>{const t=d();return[...we()].sort((l,o)=>{const P=l[t.field],F=o[t.field];let C=0;return P<F?C=-1:P>F&&(C=1),t.direction==="desc"?C*-1:C})}),Z=Q(()=>{const t=M(),i=[];return t.id&&i.push({key:"id",title:"ID",width:200,sortable:!0,render:l=>(()=>{var o=Nt();return a(o,()=>l.id),o})()}),t.thumbnail&&i.push({key:"thumbnail",title:"📷",width:60,render:l=>(()=>{var o=qt();return a(o,(()=>{var P=ne(()=>!!l.mime?.startsWith("image/"));return()=>P()?"🖼️":ne(()=>!!l.mime?.startsWith("video/"))()?"🎥":l.mime?.startsWith("audio/")?"🎵":"📄"})()),o})()}),t.mime&&i.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:l=>(()=>{var o=be();return a(o,()=>l.mime||"unknown"),o})()}),t.blob_type&&i.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.size&&i.push({key:"size",title:"Size",width:100,sortable:!0,render:l=>(()=>{var o=be();return a(o,()=>Qt(l.size)),o})()}),t.parent_id&&i.push({key:"parent_id",title:"Parent",width:120,render:l=>(()=>{var o=be();return a(o,()=>l.parent_id?"Yes":"No"),o})()}),t.local_path&&i.push({key:"local_path",title:"Local Path",width:200,render:l=>(()=>{var o=be();return a(o,()=>l.local_path||"None"),o})()}),t.created_at&&i.push({key:"created_at",title:"Created",width:140,sortable:!0,render:l=>(()=>{var o=be();return a(o,()=>new Date(l.created_at).toLocaleString()),o})()}),t.updated_at&&i.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:l=>(()=>{var o=be();return a(o,()=>new Date(l.updated_at).toLocaleString()),o})()}),t.actions&&i.push({key:"actions",title:"Actions",width:100,render:l=>(()=>{var o=Kt();return o.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${l.id}`,"_blank"),o})()}),i}),Be=Q(()=>[...new Set(c().map(i=>i.mime?.split("/")[0]).filter(Boolean))].sort()),$e=Q(()=>[...new Set(c().map(i=>i.blob_type))].sort()),Re=(t,i)=>{D(l=>({...l,[t]:i})),U({filterConfig:{...f(),[t]:i}})},Ne=(t,i)=>{h({field:t,direction:i}),U({sortConfig:{field:t,direction:i}})},J=t=>{L(t),U({viewMode:t})},qe=t=>{I(i=>{const l={...i,[t]:!i[t]};return U({columnVisibility:l}),l})},ye=()=>{O(t=>{const i=!t;return U({isBrowsePanelOpen:i}),i})},Pe=()=>{H(t=>{const i=!t;return U({isFilterPanelOpen:i}),i})},E=t=>{const i=new Date().toLocaleTimeString();ve(l=>[`${i}: ${t}`,...l.slice(0,49)])};return Le(async()=>{E("🚀 FreqholeDemo mounted");try{const t=await fetch(`${e.apiBaseUrl}/api/blobs`);if(t.ok){const i=await t.json();s(i),le(new Date),E(`📦 Loaded ${i.length} media blobs`)}else E("⚠️ Using mock data (server not available)"),s(rt()),le(new Date)}catch{E("⚠️ Using mock data (server error)"),s(rt()),le(new Date)}e.autoConnect&&(fe("Connected"),E("🔌 Auto-connected to WebSocket"))}),(()=>{var t=jt(),i=t.firstChild,l=i.nextSibling;return a(t,$(zt,{get isOpen(){return k()},get filterConfig(){return f()},onTogglePanel:ye,onFilterChange:Re,onWidthChange:o=>{p(o),U({browsePanelWidth:o})},get initialWidth(){return B()}}),i),a(t,$(ce,{get when(){return g().size>0},get children(){var o=Yt(),P=o.firstChild,F=P.firstChild,C=F.nextSibling;C.nextSibling;var A=P.nextSibling,se=A.nextSibling;return a(P,()=>g().size,F),a(P,()=>g().size===1?"":"s",C),A.$$click=()=>{console.log("Bulk download:",g().size,"items")},se.$$click=pe,o}}),i),a(i,$(Bt,{get data(){return he()},get columns(){return Z()},onSort:Ne,get sortField(){return d().field},get sortDirection(){return d().direction},get rowHeight(){return ne(()=>_()==="compact")()?40:_()==="detailed"?80:60},headerHeight:60,getItemId:o=>o.id,get selectedItems(){return g()},onRowClick:Ue,onRowDoubleClick:Ie,onRowMouseDown:He,get isDragSelecting(){return u()}})),a(t,$(nt,{get isVisible(){return!k()},position:"left",panelName:"Browse",onClick:ye}),l),a(t,$(nt,{get isVisible(){return!W()},position:"right",panelName:"Controls",onClick:Pe}),l),a(t,$(ce,{get when(){return ne(()=>!!(u()&&w()))()&&X()},get children(){var o=Xt();return z(P=>S(o,(()=>{const F=w(),C=X(),A=Math.min(F.x,C.x),se=Math.min(F.y,C.y),Se=Math.abs(C.x-F.x),ee=Math.abs(C.y-F.y);return`
              position: fixed;
              left: ${A}px;
              top: ${se}px;
              width: ${Se}px;
              height: ${ee}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),P)),o}}),l),a(t,$(Lt,{get isOpen(){return W()},get filterConfig(){return f()},get viewMode(){return _()},get columnVisibility(){return M()},get wsUrl(){return ke()},get autoConnect(){return oe()},get autoRefresh(){return ze()},get debug(){return me()},get connectionStatus(){return Oe()},get hasPendingUpdates(){return Me()},pendingUpdatesCount:0,get filteredCount(){return we().length},get totalCount(){return c().length},get sortConfig(){return d()},get lastUpdated(){return De()},get mimeCategories(){return Be()},get blobTypes(){return $e()},get logs(){return Ee()},onTogglePanel:Pe,onFilterChange:Re,onViewModeChange:J,onColumnToggle:qe,onWsUrlChange:Fe,onConnect:()=>{fe("Connected"),E("🔌 Connected to WebSocket")},onDisconnect:()=>{fe("Disconnected"),E("🔌 Disconnected from WebSocket")},onRefresh:async()=>{E("🔄 Refreshing data...");try{const o=await fetch(`${e.apiBaseUrl}/api/blobs`);if(o.ok){const P=await o.json();s(P),le(new Date),E(`📦 Refreshed ${P.length} media blobs`)}}catch{E("❌ Refresh failed")}},onApplyPendingUpdates:()=>{Ae(!1),E("📥 Applied pending updates")},onToggleAutoConnect:()=>{_e(o=>!o),E(`🔧 Auto-connect: ${oe()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{ge(o=>!o),E(`🔧 Auto-refresh: ${ze()?"OFF":"ON"}`)},onToggleDebug:()=>{We(o=>!o),E(`🐛 Debug: ${me()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Ye),window.location.reload())},onWidthChange:o=>{v(o),U({filterPanelWidth:o})},get initialWidth(){return Y()}}),l),t})()}function Jt(e){if(e.local_path){const r=e.local_path.split(/[/\\]/);return r[r.length-1]||e.id}return e.id}function Qt(e){if(e===0)return"0 B";const r=1024,c=["B","KB","MB","GB"],s=Math.floor(Math.log(e)/Math.log(r));return parseFloat((e/Math.pow(r,s)).toFixed(2))+" "+c[s]}function rt(){const e=["image/jpeg","image/png","video/mp4","audio/mp3","text/plain","application/pdf"],r=["upload","thumbnail","processed","backup"];return Array.from({length:1e3},(c,s)=>({id:`blob-${s+1}`,mime:e[Math.floor(Math.random()*e.length)],blob_type:r[Math.floor(Math.random()*r.length)],size:Math.floor(Math.random()*1e7),parent_id:Math.random()>.7?`blob-${Math.floor(Math.random()*s)+1}`:void 0,local_path:Math.random()>.5?`/path/to/file-${s+1}.ext`:void 0,created_at:new Date(Date.now()-Math.random()*864e5*30).toISOString(),updated_at:new Date(Date.now()-Math.random()*864e5*7).toISOString()}))}xe(["click"]);class Zt extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const r=this.getAttribute("ws-url")||"ws://localhost:8080/ws",c=this.getAttribute("api-base-url")||"http://localhost:8080",s=this.getAttribute("auto-connect")==="true";this.dispose=St(()=>$(Gt,{wsUrl:r,apiBaseUrl:c,autoConnect:s}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Zt),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
