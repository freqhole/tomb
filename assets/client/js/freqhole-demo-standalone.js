import{d as le,c as p,t as S,a as B,b as D,e as O,s as _,i as a,m as ee,f as k,S as j,F as ne,g as he,o as ue,h as Ee,j as ce,k as N,u as tt,r as Ct}from"./web-xBr4R5eT.js";import{c as je,g as _t,u as zt}from"./thumbnail-utils-C2xlJi9f.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Le(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var Dt=S(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function nt(e){const[n,i]=p(!1);return(()=>{var d=Dt(),u=d.firstChild,x=u.nextSibling;return d.addEventListener("mouseleave",()=>i(!1)),d.addEventListener("mouseenter",()=>i(!0)),B(d,"mousedown",e.onMouseDown),D(s=>{var m=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,M=`
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
          background: ${n()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,R=`
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
          opacity: ${n()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return m!==s.e&&O(d,s.e=m),s.t=_(d,M,s.t),s.a=_(u,L,s.a),s.o=_(x,R,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),d})()}le(["mousedown"]);function it(e){const[n,i]=p(e.initialWidth),[d,u]=p(!1),x=e.minWidth||250,s=e.maxWidth||600,m=e.closeThreshold||100;return{width:n,setWidth:i,isDragging:d,handleMouseDown:(L,R="right")=>{L.preventDefault(),u(!0),document.body.classList.add("resizing");const T=L.clientX,W=n(),U=$=>{const v=$.clientX-T,C=R==="right"?W-v:W+v;if(C<m){e.onClose?.();return}const w=Math.max(x,Math.min(s,C));i(w),e.onWidthChange?.(w)},q=()=>{u(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",U),document.removeEventListener("mouseup",q)};document.addEventListener("mousemove",U),document.addEventListener("mouseup",q)}}}var Mt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Rt=S('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Tt(e){const n=it({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var i=Mt(),d=i.firstChild,u=d.firstChild,x=u.nextSibling,s=d.nextSibling;return B(x,"click",e.onTogglePanel),a(i,(()=>{var m=ee(()=>!!e.isOpen);return()=>m()&&(()=>{var M=Rt(),L=M.firstChild,R=L.nextSibling;return R.$$input=T=>e.onFilterChange("name",T.currentTarget.value),D(()=>R.value=e.filterConfig.name),M})()})(),s),a(i,k(nt,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:m=>n.handleMouseDown(m,"left")}),s),D(m=>{var M=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,L=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return M!==m.e&&O(i,m.e=M),m.t=_(i,L,m.t),m},{e:void 0,t:void 0}),i})()}le(["click","input"]);var It=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Pt=S('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Lt=S('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Et=S('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),Ge=S("<option>"),Ft=S("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Wt=S("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Ut(e){const[n,i]=p(!1),d=it({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),u=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"name",title:"Name"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_blob_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],x=s=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[s]||"color: #6b7280;";return(()=>{var s=It(),m=s.firstChild,M=m.firstChild,L=M.nextSibling,R=m.nextSibling;return B(L,"click",e.onTogglePanel),a(s,(()=>{var T=ee(()=>!!e.isOpen);return()=>T()&&(()=>{var W=Et(),U=W.firstChild,q=U.firstChild,$=q.nextSibling,v=$.nextSibling,C=v.firstChild,w=C.nextSibling,h=v.nextSibling,b=h.firstChild,l=b.nextSibling,I=h.nextSibling,c=I.firstChild,y=c.nextSibling,E=U.nextSibling,z=E.firstChild,G=z.nextSibling,K=G.firstChild,ge=K.nextSibling,be=E.nextSibling,De=be.firstChild,ie=De.nextSibling;ie.firstChild;var me=be.nextSibling,P=me.firstChild,re=P.nextSibling;re.firstChild;var xe=me.nextSibling,ve=xe.firstChild,$e=ve.nextSibling,ae=$e.firstChild,se=ae.nextSibling,we=se.nextSibling,ye=xe.nextSibling,Me=ye.firstChild,pe=Me.nextSibling,fe=ye.nextSibling,Re=fe.firstChild,Se=Re.nextSibling,ke=fe.nextSibling,Ce=ke.firstChild,_e=Ce.nextSibling,F=_e.firstChild,t=F.nextSibling,r=t.nextSibling,g=ke.nextSibling,f=g.firstChild,H=f.nextSibling,J=H.firstChild,V=H.nextSibling,Te=g.nextSibling,Ie=Te.firstChild,Q=Ie.nextSibling,Pe=Q.firstChild,We=Pe.nextSibling,rt=We.nextSibling,at=rt.nextSibling,st=at.nextSibling,Ue=st.nextSibling,dt=Ue.nextSibling,ct=dt.nextSibling,ut=ct.nextSibling,Ae=ut.nextSibling,gt=Ae.nextSibling,Oe=gt.nextSibling,ft=Oe.nextSibling,ht=ft.nextSibling;ht.nextSibling;var Be=Q.nextSibling,bt=Be.firstChild,ze=bt.nextSibling,mt=Be.nextSibling;return $.$$input=o=>e.onWsUrlChange(o.currentTarget.value),a(w,()=>e.connectionStatus),B(b,"click",e.onConnect),B(l,"click",e.onDisconnect),B(y,"click",e.onToggleAutoConnect),a(y,()=>e.autoConnect?"ON":"OFF"),B(K,"click",e.onToggleAutoRefresh),a(K,()=>e.autoRefresh?"ON":"OFF"),B(ge,"click",e.onRefresh),a(E,k(j,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var o=Pt(),A=o.firstChild,te=A.firstChild,X=te.nextSibling;return X.nextSibling,B(A,"click",e.onApplyPendingUpdates),a(A,()=>e.pendingUpdatesCount,X),o}}),null),ie.addEventListener("change",o=>e.onFilterChange("mime",o.currentTarget.value)),a(ie,k(ne,{get each(){return e.mimeCategories},children:o=>(()=>{var A=Ge();return A.value=o,a(A,o),A})()}),null),re.addEventListener("change",o=>e.onFilterChange("blobType",o.currentTarget.value)),a(re,k(ne,{get each(){return e.blobTypes},children:o=>(()=>{var A=Ge();return A.value=o,a(A,o),A})()}),null),ae.$$input=o=>e.onFilterChange("minSize",parseInt(o.currentTarget.value)||0),we.$$input=o=>e.onFilterChange("maxSize",parseInt(o.currentTarget.value)||1e8),pe.addEventListener("change",o=>e.onFilterChange("hasParent",o.currentTarget.value)),Se.addEventListener("change",o=>e.onFilterChange("hasLocalPath",o.currentTarget.value)),F.$$click=()=>e.onViewModeChange("compact"),t.$$click=()=>e.onViewModeChange("default"),r.$$click=()=>e.onViewModeChange("detailed"),H.$$click=()=>i(!n()),a(H,()=>n()?"Hide":"Show",J),a(V,k(ne,{each:u,children:o=>(()=>{var A=Ft(),te=A.firstChild,X=te.firstChild,oe=X.nextSibling;return X.addEventListener("change",()=>e.onColumnToggle(o.key)),a(oe,()=>o.title),D(()=>X.checked=e.columnVisibility[o.key]),A})()})),a(Q,()=>e.totalCount,We),a(Q,()=>e.filteredCount,Ue),a(Q,()=>e.sortConfig.field,Ae),a(Q,()=>e.sortConfig.direction,Oe),a(Q,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),B(ze,"click",e.onToggleDebug),a(ze,()=>e.debug?"ON":"OFF"),B(mt,"click",e.onReset),a(W,k(j,{get when(){return e.debug&&e.logs.length>0},get children(){var o=Lt(),A=o.firstChild,te=A.nextSibling;return a(te,k(ne,{get each(){return e.logs},children:X=>(()=>{var oe=Wt();return a(oe,X),oe})()})),o}}),null),D(o=>{var A=x(e.connectionStatus),te=e.connectionStatus==="Connected",X=e.connectionStatus==="Disconnected",oe=`toggle-button ${e.autoConnect?"active":""}`,xt=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,qe=`toggle-button ${e.autoRefresh?"active":""}`,vt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Ne=`view-mode-button ${e.viewMode==="compact"?"active":""}`,$t=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="compact"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="compact"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="compact"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,He=`view-mode-button ${e.viewMode==="default"?"active":""}`,wt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="default"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="default"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="default"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Ve=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,yt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Ke=`toggle-button ${n()?"active":""}`,pt=`
            margin-bottom: 8px;
            width: 100%;
            padding: 8px;
            background: ${n()?"#ff00ff":"#333333"};
            box-sizing: border-box;
            min-width: 0;
            border: 1px solid ${n()?"#ff00ff":"#666666"};
            color: ${n()?"#000000":"#ffffff"};
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          `,Ye=`column-settings ${n()?"":"collapsed"}`,St=`
            max-height: ${n()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,Xe=`toggle-button ${e.debug?"active":""}`,kt=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return o.e=_(w,A,o.e),te!==o.t&&(b.disabled=o.t=te),X!==o.a&&(l.disabled=o.a=X),oe!==o.o&&O(y,o.o=oe),o.i=_(y,xt,o.i),qe!==o.n&&O(K,o.n=qe),o.s=_(K,vt,o.s),Ne!==o.h&&O(F,o.h=Ne),o.r=_(F,$t,o.r),He!==o.d&&O(t,o.d=He),o.l=_(t,wt,o.l),Ve!==o.u&&O(r,o.u=Ve),o.c=_(r,yt,o.c),Ke!==o.w&&O(H,o.w=Ke),o.m=_(H,pt,o.m),Ye!==o.f&&O(V,o.f=Ye),o.y=_(V,St,o.y),Xe!==o.g&&O(ze,o.g=Xe),o.p=_(ze,kt,o.p),o},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),D(()=>$.value=e.wsUrl),D(()=>ie.value=e.filterConfig.mime),D(()=>re.value=e.filterConfig.blobType),D(()=>ae.value=e.filterConfig.minSize),D(()=>we.value=e.filterConfig.maxSize),D(()=>pe.value=e.filterConfig.hasParent),D(()=>Se.value=e.filterConfig.hasLocalPath),W})()})(),R),a(s,k(nt,{position:"left",get isDragging(){return d.isDragging()},onMouseDown:T=>d.handleMouseDown(T,"right")}),R),D(T=>{var W=`filter-panel ${e.isOpen?"":"collapsed"} ${d.isDragging()?"resizing":""}`,U=`
        width: ${e.isOpen?d.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return W!==T.e&&O(s,T.e=W),T.t=_(s,U,T.t),T},{e:void 0,t:void 0}),s})()}le(["click","input"]);var At=S(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function Je(e){const[n,i]=p(!1);return k(j,{get when(){return e.isVisible},get children(){var d=At(),u=d.firstChild,x=u.nextSibling;return d.addEventListener("mouseleave",()=>i(!1)),d.addEventListener("mouseenter",()=>i(!0)),B(d,"click",e.onClick),a(u,()=>e.position==="left"?"→":"←"),a(x,()=>e.panelName),D(s=>{var m=`edge-toggle-button edge-toggle-${e.position}`,M=`Show ${e.panelName} panel`,L=`
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
        `,R=`
            opacity: ${n()?"1":"0"};
            transform: translateY(${n()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return m!==s.e&&O(d,s.e=m),M!==s.t&&he(d,"title",s.t=M),s.a=_(d,L,s.a),s.o=_(u,R,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),d}})}le(["click"]);var Ot=S('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),Bt=S('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),qt=S('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),Nt=S(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
          .toolbar-button:hover {
            transform: translateY(-1px);
          }

          .toolbar-button.primary:hover {
            background: #ff33ff !important;
            color: #000000 !important;
          }

          .toolbar-button.secondary:hover {
            background: #444444 !important;
            border-color: #777777 !important;
          }

          .toolbar-button.clear:hover {
            background: #333333 !important;
            color: #ffffff !important;
            border-color: #777777 !important;
          }
        `);function Ht(e){return k(j,{get when(){return e.selectedCount>1},get children(){var n=Nt(),i=n.firstChild,d=i.firstChild,u=d.nextSibling;u.nextSibling;var x=i.nextSibling;return a(i,()=>e.selectedCount,d),a(i,()=>e.selectedCount===1?"":"s",u),a(n,k(j,{get when(){return e.onDownload},get children(){var s=Ot();return B(s,"click",e.onDownload),s}}),x),a(n,k(j,{get when(){return e.onMore},get children(){var s=Bt();return B(s,"click",e.onMore),s}}),x),a(n,k(j,{get when(){return e.onClear},get children(){var s=qt();return B(s,"click",e.onClear),s}}),x),D(()=>O(n,`selection-toolbar ${e.className||""}`)),n}})}le(["click"]);function Vt(e={}){const[n,i]=p(e.initialSelection||new Set),[d,u]=p(-1),[x,s]=p(!1),[m,M]=p(null),[L,R]=p(null),T=l=>{i(I=>{const c=new Set(I);return c.has(l)?c.delete(l):c.add(l),c})},W=(l,I,c)=>{const y=Math.min(l,I),E=Math.max(l,I),z=c.slice(y,E+1);i(G=>{const K=new Set(G);return z.forEach(ge=>K.add(ge.id)),K})},U=()=>{i(new Set),u(-1)},q=l=>{const I=new Set(l.map(c=>c.id));i(I)},$=l=>n().has(l),v=(l,I,c)=>{const y=l.id;c.metaKey||c.ctrlKey?(T(y),u(I)):c.shiftKey&&d()>=0?(c.preventDefault(),u(I)):(i(new Set([y])),u(I))},C=(l,I,c)=>{c.button===0&&!c.metaKey&&!c.ctrlKey&&!c.shiftKey&&(M({x:c.clientX,y:c.clientY,startIndex:I}),s(!0))},w=l=>{l.key==="Escape"?U():l.key==="a"&&(l.metaKey||l.ctrlKey)?l.preventDefault():(l.key==="Delete"||l.key==="Backspace")&&n().size>0&&e.onDelete?.(n())},h=l=>{x()&&m()&&R({x:l.clientX,y:l.clientY,endIndex:-1})},b=()=>{x()&&(s(!1),M(null),R(null))};return ue(()=>{document.addEventListener("mousemove",h),document.addEventListener("mouseup",b),document.addEventListener("keydown",w)}),Ee(()=>{document.removeEventListener("mousemove",h),document.removeEventListener("mouseup",b),document.removeEventListener("keydown",w),document.body.classList.remove("drag-selecting")}),ce(()=>{x()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")}),ce(()=>{const l=n();e.onSelectionChange?.(l),e.saveToStorage?.(l)}),{selectedItems:n,setSelectedItems:i,lastSelectedIndex:d,setLastSelectedIndex:u,isDragSelecting:x,setIsDragSelecting:s,dragStart:m,setDragStart:M,dragEnd:L,setDragEnd:R,toggleSelection:T,selectRange:W,clearSelection:U,selectAll:q,isSelected:$,handleRowClick:v,handleRowMouseDown:C,handleKeyDown:w}}const Y={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function Kt(e){const[n,i]=p(e.initialSort||{field:"id",direction:"asc"}),[d,u]=p(new Set),[x,s]=p(!1),m=e.getItemId||($=>$.id||String($)),M=N(()=>{const $=n();return[...e.data].sort((C,w)=>{const h=C[$.field],b=w[$.field];let l=0;return h<b?l=-1:h>b&&(l=1),$.direction==="desc"?l*-1:l})});return{sortConfig:n,selectedItems:d,isDragSelecting:x,sortedData:M,handleSort:$=>{const v=n(),C=v.field===$&&v.direction==="asc"?"desc":"asc";i({field:$,direction:C})},toggleSelection:$=>{const v=new Set(d());v.has($)?v.delete($):v.add($),u(v)},clearSelection:()=>{u(new Set)},selectAll:()=>{const $=new Set(e.data.map(m));u($)},isSelected:$=>d().has($),selectRange:($,v)=>{const C=new Set(d()),w=Math.min($,v),h=Math.max($,v);for(let b=w;b<=h;b++)if(b<e.data.length&&e.data[b]!=null){const l=m(e.data[b]);C.add(l)}u(C)},setIsDragSelecting:s,getItemId:m}}var ot=S("<div>"),Yt=S("<div class=grid-cell>"),Qe=S("<div class=grid-content>"),Xt=S("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),jt=S("<span style=font-size:12px;>"),Gt=S("<div><span>");function Ze(e){let n;return ue(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var i=ot();i.$$contextmenu=u=>e.onContextMenu?.(e.item,e.index,u),i.$$mousedown=u=>e.onRowMouseDown?.(e.item,e.index,u),i.$$dblclick=u=>e.onRowDoubleClick?.(e.item,e.index,u),i.$$click=u=>e.onRowClick?.(e.item,e.index,u);var d=n;return typeof d=="function"?tt(d,i):n=i,a(i,k(ne,{get each(){return e.columns},children:u=>(()=>{var x=Yt();return a(x,(()=>{var s=ee(()=>!!u.render);return()=>s()?u.render(e.item,e.index):String(e.item[u.key]||"")})()),D(s=>_(x,`
              flex: ${u.width?"0 0 "+u.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,s)),x})()})),D(u=>{var x=`grid-row ${e.isSelected?"selected":""}`,s=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${Y.colors.border};
        background: ${e.isSelected?Y.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease;
      `;return x!==u.e&&O(i,u.e=x),u.t=_(i,s,u.t),u},{e:void 0,t:void 0}),i})()}function Jt(e){const[n,i]=p(),[d,u]=p(0),[x,s]=p(0),m=e.rowHeight||50,M=e.headerHeight||60,L=e.virtualizeThreshold||100,R=Kt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),T=(h,b,l)=>{e.onRowClick?.(h,b,l)},W=(h,b,l)=>{e.onRowDoubleClick?.(h,b,l)},U=(h,b,l)=>{e.onRowMouseDown?.(h,b,l)},q=N(()=>e.data.length>L),$=N(()=>{if(!q())return e.data.map((z,G)=>({item:z,index:G}));if(!n())return[];const b=m,l=d(),I=x(),c=Math.floor(l/b),y=Math.min(e.data.length-1,Math.ceil((l+I)/b)+5),E=[];for(let z=Math.max(0,c-5);z<=y;z++)z<e.data.length&&e.data[z]!=null&&E.push({item:e.data[z],index:z});return E}),v=N(()=>e.data.length*m),C=h=>{const b=h.target;u(b.scrollTop)},w=h=>{if(R.handleSort(h),e.onSort){const b=R.sortConfig();e.onSort(b.field,b.direction)}};return ue(()=>{const h=n();if(!h)return;const b=new ResizeObserver(l=>{for(const I of l)s(I.contentRect.height)});b.observe(h),Ee(()=>{b.disconnect()})}),(()=>{var h=Xt(),b=h.firstChild,l=b.nextSibling,I=l.nextSibling;return a(b,k(ne,{get each(){return e.columns},children:c=>(()=>{var y=Gt(),E=y.firstChild;return y.$$click=()=>c.sortable&&w(c.key),a(E,()=>c.title),a(y,k(j,{get when(){return ee(()=>!!c.sortable)()&&R.sortConfig().field===c.key},get children(){var z=jt();return a(z,()=>R.sortConfig().direction==="asc"?"↑":"↓"),z}}),null),D(z=>{var G=`grid-header-cell ${c.sortable?"sortable":""}`,K=`
                flex: ${c.width?"0 0 "+c.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${c.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return G!==z.e&&O(y,z.e=G),z.t=_(y,K,z.t),z},{e:void 0,t:void 0}),y})()})),l.addEventListener("scroll",C),tt(i,l),a(l,k(j,{get when(){return q()},get fallback(){return(()=>{var c=Qe();return a(c,k(ne,{get each(){return e.data},children:(y,E)=>k(Ze,{item:y,get index(){return E()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(y)||y.id)||!1},onRowClick:T,onRowDoubleClick:W,onRowMouseDown:U,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:m})})),c})()},get children(){var c=Qe();return a(c,k(ne,{get each(){return $()},children:y=>(()=>{var E=ot();return a(E,k(Ze,{get item(){return y.item},get index(){return y.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(y.item)||y.item.id)||!1},onRowClick:T,onRowDoubleClick:W,onRowMouseDown:U,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:m})),D(z=>_(E,`
                    position: absolute;
                    top: ${y.index*m}px;
                    left: 0;
                    right: 0;
                  `,z)),E})()})),D(y=>_(c,`height: ${v()}px; position: relative;`,y)),c}})),a(I,()=>`
        .grid-row:hover:not(.selected) {
          background: ${Y.colors.hover};
        }

        .grid-row.selected {
          background: ${Y.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${Y.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${Y.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${Y.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${Y.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }
      `),D(c=>{var y=`infinite-data-grid ${e.className||""}`,E=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${Y.colors.background};
        color: ${Y.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,z=`
          height: ${M}px;
          display: flex;
          align-items: center;
          background: ${Y.colors.header};
          border-bottom: 2px solid ${Y.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return y!==c.e&&O(h,c.e=y),c.t=_(h,E,c.t),c.a=_(b,z,c.a),c},{e:void 0,t:void 0,a:void 0}),h})()}le(["click","dblclick","mousedown","contextmenu"]);var Qt=S(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),Zt=S("<img loading=lazy>",!0,!1,!1),en=S("<span style=color:#ccc;>"),tn=S('<div title="Has thumbnails">'),nn=S('<div title="Generating thumbnails...">');function on(e){const[n,i]=p(!1),[d,u]=p(!1),x=()=>e.size||40,s=()=>e.borderRadius||"4px",m=N(()=>e.item.metadata?.thumbnails||[]),M=N(()=>e.item.metadata?.has_thumbnails===!0||m().length>0),L=N(()=>e.requestedThumbnails?.has(e.item.id)||e.item.metadata?.thumbnails_requested||d()),R=N(()=>{if(n())return null;const v=m();if(v.length>0&&v[0]){const C=v[0];if(C.data&&C.data.length>0){const w=C.mime||"image/webp";return je(C.data,w)}if(e.apiBaseUrl)return`${e.apiBaseUrl}/api/media-blobs/${C.id}/download`}if(e.item.mime?.startsWith("image/")){if(e.item.data&&e.item.data.length>0)return je(e.item.data,e.item.mime);if(e.apiBaseUrl)return`${e.apiBaseUrl}/api/media-blobs/${e.item.id}/download`}return null}),T=N(()=>!M()&&!L()&&e.onRequestThumbnails&&(e.item.mime?.startsWith("image/")||e.item.mime?.startsWith("video/")||e.item.mime?.includes("pdf")));ue(()=>{T()&&(u(!0),e.onRequestThumbnails?.(e.item.id))});const W=()=>{i(!0)},U=()=>`
    width: ${x()}px;
    height: ${x()}px;
    border-radius: ${s()};
    overflow: hidden;
    background: #333;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: ${Math.max(12,x()*.3)}px;
    position: relative;
    flex-shrink: 0;
  `,q=()=>`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,$=(v,C)=>`
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: ${Math.max(6,x()*.15)}px;
    height: ${Math.max(6,x()*.15)}px;
    background: ${v};
    border-radius: 50%;
    border: 1px solid #ffffff;
    box-shadow: 0 0 0 1px #000000;
    ${C?"animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;":""}
  `;return(()=>{var v=Qt(),C=v.firstChild;return a(v,(()=>{var w=ee(()=>!!(R()&&!n()));return()=>w()?(()=>{var h=Zt();return h.addEventListener("error",W),D(b=>{var l=R(),I=`Thumbnail for ${e.item.id.slice(0,8)}`,c=q();return l!==b.e&&he(h,"src",b.e=l),I!==b.t&&he(h,"alt",b.t=I),b.a=_(h,c,b.a),b},{e:void 0,t:void 0,a:void 0}),h})():(()=>{var h=en();return a(h,()=>_t(e.item.mime)),h})()})(),C),a(v,k(j,{get when(){return e.showIndicators!==!1},get children(){return ee(()=>!!M())()?(()=>{var w=tn();return D(h=>_(w,$("#00ff00"),h)),w})():ee(()=>!!L())()?(()=>{var w=nn();return D(h=>_(w,$("#fbbf24",!0),h)),w})():null}}),C),D(w=>{var h=`thumbnail ${e.className||""}`,b=U(),l=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return h!==w.e&&O(v,w.e=h),w.t=_(v,b,w.t),l!==w.a&&he(v,"title",w.a=l),w},{e:void 0,t:void 0,a:void 0}),v})()}function ln(e){if(e===0)return"0 B";const n=1024,i=["B","KB","MB","GB","TB","PB"],d=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,d)).toFixed(2))+" "+i[d]}var rn=S("<span style=font-weight:500;>"),de=S("<span>"),an=S("<span style=font-family:monospace;font-size:12px;>"),sn=S('<button style="background:#ff00ff;border:none;color:#000000;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⋯'),dn=S("<div>"),cn=S(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }

        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
          cursor: crosshair;
        }
      `);const Fe="freqhole-demo-state",et=300;function lt(){try{const e=localStorage.getItem(Fe);return e?JSON.parse(e):{}}catch{return{}}}function Z(e){try{const i={...lt(),...e};localStorage.setItem(Fe,JSON.stringify(i))}catch{}}function un(e){const n=lt(),i=zt({wsUrl:e.wsUrl,channels:["MediaBlobs"],debug:n.debug??!1,autoConnect:e.autoConnect,autoRefresh:n.autoRefresh??!0}),[d,u]=p({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[x,s]=p({field:"created_at",direction:"desc",...n.sortConfig||{}}),[m,M]=p(n.viewMode||"default"),[L,R]=p({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[T,W]=p(n.isFilterPanelOpen??!0),[U,q]=p(n.filterPanelWidth||et),[$,v]=p(n.isBrowsePanelOpen??!0),[C,w]=p(n.browsePanelWidth||et),[h,b]=p(e.wsUrl),[l,I]=p(e.autoConnect),[c,y]=p(!0),[E,z]=p(!1),[G,K]=p([]),ge=()=>i.state().connectionStatus,be=()=>i.state().hasPendingUpdates,De=()=>i.state().lastUpdated,[ie,me]=p(new Set),P=Vt({onSelectionChange:t=>{Z({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),re=(t,r,g)=>{g.shiftKey&&P.lastSelectedIndex()>=0?(g.preventDefault(),P.selectRange(P.lastSelectedIndex(),r,se())):P.handleRowClick(t,r,g)},xe=t=>{console.log("Double-clicked:",t.id)},ve=t=>{t.key==="a"&&(t.metaKey||t.ctrlKey)?(t.preventDefault(),P.selectAll(se())):P.handleKeyDown(t)},$e=t=>{if(P.isDragSelecting()&&P.dragStart()){P.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const r=P.dragStart(),g=Math.floor((t.clientY-r.y)/60);if(g!==r.startIndex){const f=Math.min(r.startIndex,r.startIndex+g),H=Math.max(r.startIndex,r.startIndex+g);P.selectRange(f,H,se())}}};ue(()=>{document.addEventListener("mousemove",$e),document.addEventListener("keydown",ve)}),Ee(()=>{document.removeEventListener("mousemove",$e),document.removeEventListener("keydown",ve)});const ae=N(()=>{const t=d();return i.state().items.filter(r=>{if(t.name&&!Le(r).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!r.mime?.startsWith(t.mime)||t.blobType&&r.blob_type!==t.blobType||(r.size||0)<t.minSize||(r.size||0)>t.maxSize)return!1;if(t.hasParent!=="all"){const g=!!r.parent_blob_id;if(t.hasParent==="yes"&&!g||t.hasParent==="no"&&g)return!1}if(t.hasLocalPath!=="all"){const g=!!r.local_path;if(t.hasLocalPath==="yes"&&!g||t.hasLocalPath==="no"&&g)return!1}return!0})}),se=N(()=>{const t=x();return[...ae()].sort((g,f)=>{const H=g[t.field],J=f[t.field];let V=0;return H<J?V=-1:H>J&&(V=1),t.direction==="desc"?V*-1:V})}),we=t=>{ie().has(t)||(me(r=>new Set([...r,t])),i.actions.getThumbnails(t),F(`🖼️ Requesting thumbnails for ${t.slice(0,8)}`))},ye=N(()=>{const t=L(),r=[];return t.thumbnail&&r.push({key:"thumbnail",title:"📷",width:60,render:g=>k(on,{item:g,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:we,get requestedThumbnails(){return ie()},showIndicators:!0})}),t.name&&r.push({key:"name",title:"Name",width:250,sortable:!0,render:g=>(()=>{var f=rn();return a(f,()=>Le(g)),D(()=>he(f,"title",Le(g))),f})()}),t.blob_type&&r.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.mime&&r.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:g=>(()=>{var f=de();return a(f,()=>g.mime||"unknown"),f})()}),t.id&&r.push({key:"id",title:"ID",width:200,sortable:!0,render:g=>(()=>{var f=an();return a(f,()=>g.id),f})()}),t.size&&r.push({key:"size",title:"Size",width:100,sortable:!0,render:g=>(()=>{var f=de();return a(f,()=>ln(g.size||0)),f})()}),t.parent_blob_id&&r.push({key:"parent_blob_id",title:"Parent",width:120,render:g=>(()=>{var f=de();return a(f,()=>g.parent_blob_id?"Yes":"No"),f})()}),t.local_path&&r.push({key:"local_path",title:"Local Path",width:200,render:g=>(()=>{var f=de();return a(f,()=>g.local_path||"None"),f})()}),t.created_at&&r.push({key:"created_at",title:"Created",width:140,sortable:!0,render:g=>(()=>{var f=de();return a(f,()=>new Date(g.created_at).toLocaleString()),f})()}),t.updated_at&&r.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:g=>(()=>{var f=de();return a(f,()=>new Date(g.updated_at).toLocaleString()),f})()}),t.actions&&r.push({key:"actions",title:"Actions",width:100,render:g=>(()=>{var f=sn();return f.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${g.id}`,"_blank"),f})()}),r}),Me=N(()=>[...new Set(i.state().items.map(t=>t.mime?.split("/")[0]).filter(Boolean))].sort()),pe=N(()=>[...new Set(i.state().items.map(r=>r.blob_type))].sort()),fe=(t,r)=>{u(g=>({...g,[t]:r})),Z({filterConfig:{...d(),[t]:r}})},Re=(t,r)=>{s({field:t,direction:r}),Z({sortConfig:{field:t,direction:r}})},Se=t=>{M(t),Z({viewMode:t})},ke=t=>{R(r=>{const g={...r,[t]:!r[t]};return Z({columnVisibility:g}),g})},Ce=()=>{v(t=>{const r=!t;return Z({isBrowsePanelOpen:r}),r})},_e=()=>{W(t=>{const r=!t;return Z({isFilterPanelOpen:r}),r})},F=t=>{const r=new Date().toLocaleTimeString();K(g=>[`${r}: ${t}`,...g.slice(0,49)])};return ce(()=>{const t=i.state().items;t.length>0&&F(`📊 Feed updated: ${t.length} items available`)}),ce(()=>{const t=i.state().requestedThumbnails;t.size>0&&F(`🖼️ Thumbnail requests: ${t.size} items`)}),ce(()=>{const t=i.state().connectionStatus;F(`🔌 Connection status: ${t}`)}),ce(()=>{i.state().hasPendingUpdates&&F(`📥 ${i.state().pendingUpdates.length} pending updates available`)}),ue(()=>{F("🚀 FreqholeDemo mounted"),F(`🔌 WebSocket URL: ${h()}`),l()&&F("🔌 Auto-connecting to WebSocket...")}),(()=>{var t=cn(),r=t.firstChild,g=r.nextSibling;return a(t,k(Tt,{get isOpen(){return $()},get filterConfig(){return d()},onTogglePanel:Ce,onFilterChange:fe,onWidthChange:f=>{w(f),Z({browsePanelWidth:f})},get initialWidth(){return C()}}),r),a(t,k(Ht,{get selectedCount(){return P.selectedItems().size},onDownload:()=>{console.log("Bulk download:",P.selectedItems().size,"items")},get onClear(){return P.clearSelection},onMore:()=>{console.log("Show bulk actions menu")}}),r),a(r,k(Jt,{get data(){return se()},get columns(){return ye()},onSort:Re,get sortField(){return x().field},get sortDirection(){return x().direction},get rowHeight(){return ee(()=>m()==="compact")()?40:m()==="detailed"?80:60},headerHeight:60,getItemId:f=>f.id,get selectedItems(){return P.selectedItems()},onRowClick:re,onRowDoubleClick:xe,get onRowMouseDown(){return P.handleRowMouseDown},get isDragSelecting(){return P.isDragSelecting()}})),a(t,k(Je,{get isVisible(){return!$()},position:"left",panelName:"Browse",onClick:Ce}),g),a(t,k(Je,{get isVisible(){return!T()},position:"right",panelName:"Controls",onClick:_e}),g),a(t,k(j,{get when(){return ee(()=>!!(P.isDragSelecting()&&P.dragStart()))()&&P.dragEnd()},get children(){var f=dn();return D(H=>_(f,(()=>{const J=P.dragStart(),V=P.dragEnd(),Te=Math.min(J.x,V.x),Ie=Math.min(J.y,V.y),Q=Math.abs(V.x-J.x),Pe=Math.abs(V.y-J.y);return`
              position: fixed;
              left: ${Te}px;
              top: ${Ie}px;
              width: ${Q}px;
              height: ${Pe}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),H)),f}}),g),a(t,k(Ut,{get isOpen(){return T()},get filterConfig(){return d()},get viewMode(){return m()},get columnVisibility(){return L()},get wsUrl(){return h()},get autoConnect(){return l()},get autoRefresh(){return c()},get debug(){return E()},get connectionStatus(){return ge()},get hasPendingUpdates(){return be()},get pendingUpdatesCount(){return i.state().pendingUpdates.length},get filteredCount(){return ae().length},get totalCount(){return i.state().items.length},get sortConfig(){return x()},get lastUpdated(){return De()},get mimeCategories(){return Me()},get blobTypes(){return pe()},get logs(){return G()},onTogglePanel:_e,onFilterChange:fe,onViewModeChange:Se,onColumnToggle:ke,onWsUrlChange:b,onConnect:()=>{i.actions.connect(),F("🔌 Connecting to WebSocket...")},onDisconnect:()=>{i.actions.disconnect(),F("🔌 Disconnecting from WebSocket...")},onRefresh:()=>{F("🔄 Refreshing data..."),i.actions.refresh()},onApplyPendingUpdates:()=>{i.actions.applyPendingUpdates(),F("✅ Applied pending updates")},onToggleAutoConnect:()=>{I(f=>!f),F(`🔧 Auto-connect: ${l()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{y(f=>!f),F(`🔧 Auto-refresh: ${c()?"OFF":"ON"}`)},onToggleDebug:()=>{z(f=>!f),F(`🐛 Debug: ${E()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Fe),window.location.reload())},onWidthChange:f=>{q(f),Z({filterPanelWidth:f})},get initialWidth(){return U()}}),g),t})()}le(["click"]);class gn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",i=this.getAttribute("api-base-url")||"http://localhost:8080",d=this.getAttribute("auto-connect")==="true";this.dispose=Ct(()=>k(un,{wsUrl:n,apiBaseUrl:i,autoConnect:d}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",gn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
