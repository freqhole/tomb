import{d as le,c as $,t as p,a as B,b as z,e as q,s as D,i as r,m as ee,f as k,S as j,F as ne,g as he,o as ue,h as Ee,j as ce,k as V,u as et,r as kt}from"./web-xBr4R5eT.js";import{c as Ct,g as _t,u as zt}from"./thumbnail-utils-D2PtI6ih.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Le(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var Dt=p(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function tt(e){const[n,i]=$(!1);return(()=>{var d=Dt(),c=d.firstChild,b=c.nextSibling;return d.addEventListener("mouseleave",()=>i(!1)),d.addEventListener("mouseenter",()=>i(!0)),B(d,"mousedown",e.onMouseDown),z(a=>{var m=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,M=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,E=`
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
        `;return m!==a.e&&q(d,a.e=m),a.t=D(d,M,a.t),a.a=D(c,E,a.a),a.o=D(b,R,a.o),a},{e:void 0,t:void 0,a:void 0,o:void 0}),d})()}le(["mousedown"]);function nt(e){const[n,i]=$(e.initialWidth),[d,c]=$(!1),b=e.minWidth||250,a=e.maxWidth||600,m=e.closeThreshold||100;return{width:n,setWidth:i,isDragging:d,handleMouseDown:(E,R="right")=>{E.preventDefault(),c(!0),document.body.classList.add("resizing");const T=E.clientX,y=n(),I=h=>{const S=h.clientX-T,L=R==="right"?y-S:y+S;if(L<m){e.onClose?.();return}const U=Math.max(b,Math.min(a,L));i(U),e.onWidthChange?.(U)},C=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",I),document.removeEventListener("mouseup",C)};document.addEventListener("mousemove",I),document.addEventListener("mouseup",C)}}}var Mt=p(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Rt=p('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Tt(e){const n=nt({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var i=Mt(),d=i.firstChild,c=d.firstChild,b=c.nextSibling,a=d.nextSibling;return B(b,"click",e.onTogglePanel),r(i,(()=>{var m=ee(()=>!!e.isOpen);return()=>m()&&(()=>{var M=Rt(),E=M.firstChild,R=E.nextSibling;return R.$$input=T=>e.onFilterChange("name",T.currentTarget.value),z(()=>R.value=e.filterConfig.name),M})()})(),a),r(i,k(tt,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:m=>n.handleMouseDown(m,"left")}),a),z(m=>{var M=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,E=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return M!==m.e&&q(i,m.e=M),m.t=D(i,E,m.t),m},{e:void 0,t:void 0}),i})()}le(["click","input"]);var It=p(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Pt=p('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Lt=p('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Et=p('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),je=p("<option>"),Ft=p("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Wt=p("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Ut(e){const[n,i]=$(!1),d=nt({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),c=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"name",title:"Name"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_blob_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],b=a=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[a]||"color: #6b7280;";return(()=>{var a=It(),m=a.firstChild,M=m.firstChild,E=M.nextSibling,R=m.nextSibling;return B(E,"click",e.onTogglePanel),r(a,(()=>{var T=ee(()=>!!e.isOpen);return()=>T()&&(()=>{var y=Et(),I=y.firstChild,C=I.firstChild,h=C.nextSibling,S=h.nextSibling,L=S.firstChild,U=L.nextSibling,w=S.nextSibling,x=w.firstChild,s=x.nextSibling,F=w.nextSibling,u=F.firstChild,v=u.nextSibling,W=I.nextSibling,_=W.firstChild,G=_.nextSibling,K=G.firstChild,ge=K.nextSibling,be=W.nextSibling,De=be.firstChild,ie=De.nextSibling;ie.firstChild;var me=be.nextSibling,P=me.firstChild,re=P.nextSibling;re.firstChild;var xe=me.nextSibling,ve=xe.firstChild,we=ve.nextSibling,ae=we.firstChild,se=ae.nextSibling,$e=se.nextSibling,pe=xe.nextSibling,Me=pe.firstChild,ye=Me.nextSibling,fe=pe.nextSibling,Re=fe.firstChild,Se=Re.nextSibling,ke=fe.nextSibling,Ce=ke.firstChild,_e=Ce.nextSibling,A=_e.firstChild,t=A.nextSibling,l=t.nextSibling,g=ke.nextSibling,f=g.firstChild,N=f.nextSibling,J=N.firstChild,H=N.nextSibling,Te=g.nextSibling,Ie=Te.firstChild,Q=Ie.nextSibling,Pe=Q.firstChild,We=Pe.nextSibling,lt=We.nextSibling,rt=lt.nextSibling,at=rt.nextSibling,Ue=at.nextSibling,st=Ue.nextSibling,dt=st.nextSibling,ct=dt.nextSibling,Ae=ct.nextSibling,ut=Ae.nextSibling,Oe=ut.nextSibling,gt=Oe.nextSibling,ft=gt.nextSibling;ft.nextSibling;var qe=Q.nextSibling,ht=qe.firstChild,ze=ht.nextSibling,bt=qe.nextSibling;return h.$$input=o=>e.onWsUrlChange(o.currentTarget.value),r(U,()=>e.connectionStatus),B(x,"click",e.onConnect),B(s,"click",e.onDisconnect),B(v,"click",e.onToggleAutoConnect),r(v,()=>e.autoConnect?"ON":"OFF"),B(K,"click",e.onToggleAutoRefresh),r(K,()=>e.autoRefresh?"ON":"OFF"),B(ge,"click",e.onRefresh),r(W,k(j,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var o=Pt(),O=o.firstChild,te=O.firstChild,X=te.nextSibling;return X.nextSibling,B(O,"click",e.onApplyPendingUpdates),r(O,()=>e.pendingUpdatesCount,X),o}}),null),ie.addEventListener("change",o=>e.onFilterChange("mime",o.currentTarget.value)),r(ie,k(ne,{get each(){return e.mimeCategories},children:o=>(()=>{var O=je();return O.value=o,r(O,o),O})()}),null),re.addEventListener("change",o=>e.onFilterChange("blobType",o.currentTarget.value)),r(re,k(ne,{get each(){return e.blobTypes},children:o=>(()=>{var O=je();return O.value=o,r(O,o),O})()}),null),ae.$$input=o=>e.onFilterChange("minSize",parseInt(o.currentTarget.value)||0),$e.$$input=o=>e.onFilterChange("maxSize",parseInt(o.currentTarget.value)||1e8),ye.addEventListener("change",o=>e.onFilterChange("hasParent",o.currentTarget.value)),Se.addEventListener("change",o=>e.onFilterChange("hasLocalPath",o.currentTarget.value)),A.$$click=()=>e.onViewModeChange("compact"),t.$$click=()=>e.onViewModeChange("default"),l.$$click=()=>e.onViewModeChange("detailed"),N.$$click=()=>i(!n()),r(N,()=>n()?"Hide":"Show",J),r(H,k(ne,{each:c,children:o=>(()=>{var O=Ft(),te=O.firstChild,X=te.firstChild,oe=X.nextSibling;return X.addEventListener("change",()=>e.onColumnToggle(o.key)),r(oe,()=>o.title),z(()=>X.checked=e.columnVisibility[o.key]),O})()})),r(Q,()=>e.totalCount,We),r(Q,()=>e.filteredCount,Ue),r(Q,()=>e.sortConfig.field,Ae),r(Q,()=>e.sortConfig.direction,Oe),r(Q,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),B(ze,"click",e.onToggleDebug),r(ze,()=>e.debug?"ON":"OFF"),B(bt,"click",e.onReset),r(y,k(j,{get when(){return e.debug&&e.logs.length>0},get children(){var o=Lt(),O=o.firstChild,te=O.nextSibling;return r(te,k(ne,{get each(){return e.logs},children:X=>(()=>{var oe=Wt();return r(oe,X),oe})()})),o}}),null),z(o=>{var O=b(e.connectionStatus),te=e.connectionStatus==="Connected",X=e.connectionStatus==="Disconnected",oe=`toggle-button ${e.autoConnect?"active":""}`,mt=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Be=`toggle-button ${e.autoRefresh?"active":""}`,xt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Ne=`view-mode-button ${e.viewMode==="compact"?"active":""}`,vt=`
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
            `,Ve=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,$t=`
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
          `,Ye=`column-settings ${n()?"":"collapsed"}`,yt=`
            max-height: ${n()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,Xe=`toggle-button ${e.debug?"active":""}`,St=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return o.e=D(U,O,o.e),te!==o.t&&(x.disabled=o.t=te),X!==o.a&&(s.disabled=o.a=X),oe!==o.o&&q(v,o.o=oe),o.i=D(v,mt,o.i),Be!==o.n&&q(K,o.n=Be),o.s=D(K,xt,o.s),Ne!==o.h&&q(A,o.h=Ne),o.r=D(A,vt,o.r),He!==o.d&&q(t,o.d=He),o.l=D(t,wt,o.l),Ve!==o.u&&q(l,o.u=Ve),o.c=D(l,$t,o.c),Ke!==o.w&&q(N,o.w=Ke),o.m=D(N,pt,o.m),Ye!==o.f&&q(H,o.f=Ye),o.y=D(H,yt,o.y),Xe!==o.g&&q(ze,o.g=Xe),o.p=D(ze,St,o.p),o},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),z(()=>h.value=e.wsUrl),z(()=>ie.value=e.filterConfig.mime),z(()=>re.value=e.filterConfig.blobType),z(()=>ae.value=e.filterConfig.minSize),z(()=>$e.value=e.filterConfig.maxSize),z(()=>ye.value=e.filterConfig.hasParent),z(()=>Se.value=e.filterConfig.hasLocalPath),y})()})(),R),r(a,k(tt,{position:"left",get isDragging(){return d.isDragging()},onMouseDown:T=>d.handleMouseDown(T,"right")}),R),z(T=>{var y=`filter-panel ${e.isOpen?"":"collapsed"} ${d.isDragging()?"resizing":""}`,I=`
        width: ${e.isOpen?d.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return y!==T.e&&q(a,T.e=y),T.t=D(a,I,T.t),T},{e:void 0,t:void 0}),a})()}le(["click","input"]);var At=p(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function Ge(e){const[n,i]=$(!1);return k(j,{get when(){return e.isVisible},get children(){var d=At(),c=d.firstChild,b=c.nextSibling;return d.addEventListener("mouseleave",()=>i(!1)),d.addEventListener("mouseenter",()=>i(!0)),B(d,"click",e.onClick),r(c,()=>e.position==="left"?"→":"←"),r(b,()=>e.panelName),z(a=>{var m=`edge-toggle-button edge-toggle-${e.position}`,M=`Show ${e.panelName} panel`,E=`
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
          `;return m!==a.e&&q(d,a.e=m),M!==a.t&&he(d,"title",a.t=M),a.a=D(d,E,a.a),a.o=D(c,R,a.o),a},{e:void 0,t:void 0,a:void 0,o:void 0}),d}})}le(["click"]);var Ot=p('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),qt=p('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),Bt=p('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),Nt=p(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function Ht(e){return k(j,{get when(){return e.selectedCount>1},get children(){var n=Nt(),i=n.firstChild,d=i.firstChild,c=d.nextSibling;c.nextSibling;var b=i.nextSibling;return r(i,()=>e.selectedCount,d),r(i,()=>e.selectedCount===1?"":"s",c),r(n,k(j,{get when(){return e.onDownload},get children(){var a=Ot();return B(a,"click",e.onDownload),a}}),b),r(n,k(j,{get when(){return e.onMore},get children(){var a=qt();return B(a,"click",e.onMore),a}}),b),r(n,k(j,{get when(){return e.onClear},get children(){var a=Bt();return B(a,"click",e.onClear),a}}),b),z(()=>q(n,`selection-toolbar ${e.className||""}`)),n}})}le(["click"]);function Vt(e={}){const[n,i]=$(e.initialSelection||new Set),[d,c]=$(-1),[b,a]=$(!1),[m,M]=$(null),[E,R]=$(null),T=s=>{i(F=>{const u=new Set(F);return u.has(s)?u.delete(s):u.add(s),u})},y=(s,F,u)=>{const v=Math.min(s,F),W=Math.max(s,F),_=u.slice(v,W+1);i(G=>{const K=new Set(G);return _.forEach(ge=>K.add(ge.id)),K})},I=()=>{i(new Set),c(-1)},C=s=>{const F=new Set(s.map(u=>u.id));i(F)},h=s=>n().has(s),S=(s,F,u)=>{const v=s.id;u.metaKey||u.ctrlKey?(T(v),c(F)):u.shiftKey&&d()>=0?(u.preventDefault(),c(F)):(i(new Set([v])),c(F))},L=(s,F,u)=>{u.button===0&&!u.metaKey&&!u.ctrlKey&&!u.shiftKey&&(M({x:u.clientX,y:u.clientY,startIndex:F}),a(!0))},U=s=>{s.key==="Escape"?I():s.key==="a"&&(s.metaKey||s.ctrlKey)?s.preventDefault():(s.key==="Delete"||s.key==="Backspace")&&n().size>0&&e.onDelete?.(n())},w=s=>{b()&&m()&&R({x:s.clientX,y:s.clientY,endIndex:-1})},x=()=>{b()&&(a(!1),M(null),R(null))};return ue(()=>{document.addEventListener("mousemove",w),document.addEventListener("mouseup",x),document.addEventListener("keydown",U)}),Ee(()=>{document.removeEventListener("mousemove",w),document.removeEventListener("mouseup",x),document.removeEventListener("keydown",U),document.body.classList.remove("drag-selecting")}),ce(()=>{b()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")}),ce(()=>{const s=n();e.onSelectionChange?.(s),e.saveToStorage?.(s)}),{selectedItems:n,setSelectedItems:i,lastSelectedIndex:d,setLastSelectedIndex:c,isDragSelecting:b,setIsDragSelecting:a,dragStart:m,setDragStart:M,dragEnd:E,setDragEnd:R,toggleSelection:T,selectRange:y,clearSelection:I,selectAll:C,isSelected:h,handleRowClick:S,handleRowMouseDown:L,handleKeyDown:U}}const Y={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function Kt(e){const[n,i]=$(e.initialSort||{field:"id",direction:"asc"}),[d,c]=$(new Set),[b,a]=$(!1),m=e.getItemId||(h=>h.id||String(h)),M=V(()=>{const h=n();return[...e.data].sort((L,U)=>{const w=L[h.field],x=U[h.field];let s=0;return w<x?s=-1:w>x&&(s=1),h.direction==="desc"?s*-1:s})});return{sortConfig:n,selectedItems:d,isDragSelecting:b,sortedData:M,handleSort:h=>{const S=n(),L=S.field===h&&S.direction==="asc"?"desc":"asc";i({field:h,direction:L})},toggleSelection:h=>{const S=new Set(d());S.has(h)?S.delete(h):S.add(h),c(S)},clearSelection:()=>{c(new Set)},selectAll:()=>{const h=new Set(e.data.map(m));c(h)},isSelected:h=>d().has(h),selectRange:(h,S)=>{const L=new Set(d()),U=Math.min(h,S),w=Math.max(h,S);for(let x=U;x<=w;x++)if(x<e.data.length&&e.data[x]!=null){const s=m(e.data[x]);L.add(s)}c(L)},setIsDragSelecting:a,getItemId:m}}var it=p("<div>"),Yt=p("<div class=grid-cell>"),Je=p("<div class=grid-content>"),Xt=p("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),jt=p("<span style=font-size:12px;>"),Gt=p("<div><span>");function Qe(e){let n;return ue(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var i=it();i.$$contextmenu=c=>e.onContextMenu?.(e.item,e.index,c),i.$$mousedown=c=>e.onRowMouseDown?.(e.item,e.index,c),i.$$dblclick=c=>e.onRowDoubleClick?.(e.item,e.index,c),i.$$click=c=>e.onRowClick?.(e.item,e.index,c);var d=n;return typeof d=="function"?et(d,i):n=i,r(i,k(ne,{get each(){return e.columns},children:c=>(()=>{var b=Yt();return r(b,(()=>{var a=ee(()=>!!c.render);return()=>a()?c.render(e.item,e.index):String(e.item[c.key]||"")})()),z(a=>D(b,`
              flex: ${c.width?"0 0 "+c.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,a)),b})()})),z(c=>{var b=`grid-row ${e.isSelected?"selected":""}`,a=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${Y.colors.border};
        background: ${e.isSelected?Y.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease;
      `;return b!==c.e&&q(i,c.e=b),c.t=D(i,a,c.t),c},{e:void 0,t:void 0}),i})()}function Jt(e){const[n,i]=$(),[d,c]=$(0),[b,a]=$(0),m=e.rowHeight||50,M=e.headerHeight||60,E=e.virtualizeThreshold||100,R=Kt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),T=(w,x,s)=>{e.onRowClick?.(w,x,s)},y=(w,x,s)=>{e.onRowDoubleClick?.(w,x,s)},I=(w,x,s)=>{e.onRowMouseDown?.(w,x,s)},C=V(()=>e.data.length>E),h=V(()=>{if(!C())return e.data.map((_,G)=>({item:_,index:G}));if(!n())return[];const x=m,s=d(),F=b(),u=Math.floor(s/x),v=Math.min(e.data.length-1,Math.ceil((s+F)/x)+5),W=[];for(let _=Math.max(0,u-5);_<=v;_++)_<e.data.length&&e.data[_]!=null&&W.push({item:e.data[_],index:_});return W}),S=V(()=>e.data.length*m),L=w=>{const x=w.target;c(x.scrollTop)},U=w=>{if(R.handleSort(w),e.onSort){const x=R.sortConfig();e.onSort(x.field,x.direction)}};return ue(()=>{const w=n();if(!w)return;const x=new ResizeObserver(s=>{for(const F of s)a(F.contentRect.height)});x.observe(w),Ee(()=>{x.disconnect()})}),(()=>{var w=Xt(),x=w.firstChild,s=x.nextSibling,F=s.nextSibling;return r(x,k(ne,{get each(){return e.columns},children:u=>(()=>{var v=Gt(),W=v.firstChild;return v.$$click=()=>u.sortable&&U(u.key),r(W,()=>u.title),r(v,k(j,{get when(){return ee(()=>!!u.sortable)()&&R.sortConfig().field===u.key},get children(){var _=jt();return r(_,()=>R.sortConfig().direction==="asc"?"↑":"↓"),_}}),null),z(_=>{var G=`grid-header-cell ${u.sortable?"sortable":""}`,K=`
                flex: ${u.width?"0 0 "+u.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${u.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return G!==_.e&&q(v,_.e=G),_.t=D(v,K,_.t),_},{e:void 0,t:void 0}),v})()})),s.addEventListener("scroll",L),et(i,s),r(s,k(j,{get when(){return C()},get fallback(){return(()=>{var u=Je();return r(u,k(ne,{get each(){return e.data},children:(v,W)=>k(Qe,{item:v,get index(){return W()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(v)||v.id)||!1},onRowClick:T,onRowDoubleClick:y,onRowMouseDown:I,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:m})})),u})()},get children(){var u=Je();return r(u,k(ne,{get each(){return h()},children:v=>(()=>{var W=it();return r(W,k(Qe,{get item(){return v.item},get index(){return v.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(v.item)||v.item.id)||!1},onRowClick:T,onRowDoubleClick:y,onRowMouseDown:I,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:m})),z(_=>D(W,`
                    position: absolute;
                    top: ${v.index*m}px;
                    left: 0;
                    right: 0;
                  `,_)),W})()})),z(v=>D(u,`height: ${S()}px; position: relative;`,v)),u}})),r(F,()=>`
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
      `),z(u=>{var v=`infinite-data-grid ${e.className||""}`,W=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${Y.colors.background};
        color: ${Y.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,_=`
          height: ${M}px;
          display: flex;
          align-items: center;
          background: ${Y.colors.header};
          border-bottom: 2px solid ${Y.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return v!==u.e&&q(w,u.e=v),u.t=D(w,W,u.t),u.a=D(x,_,u.a),u},{e:void 0,t:void 0,a:void 0}),w})()}le(["click","dblclick","mousedown","contextmenu"]);var Qt=p(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),Zt=p("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),en=p("<span style=color:#94a3b8;>"),tn=p('<div title="Has thumbnails">'),nn=p('<div title="Generating thumbnails...">');function on(e){const[n,i]=$(!1),[d,c]=$(!1),b=()=>e.size||40,a=()=>e.borderRadius||"4px",m=V(()=>e.item.metadata?.thumbnails||[]),M=V(()=>e.item.metadata?.has_thumbnails===!0||m().length>0),E=V(()=>e.requestedThumbnails?.has(e.item.id)||e.item.metadata?.thumbnails_requested||d()),R=V(()=>{if(n())return null;const y=m();if(y.length>0&&y[0]){const I=y[0];if(I.data&&I.data.length>0){const C=I.mime||"image/webp";return Ct(I.data,C)}}return null});ue(()=>{const y=e.requestedThumbnails?.has(e.item.id)||e.item.metadata?.thumbnails_requested;!M()&&!y&&e.onRequestThumbnails&&(c(!0),e.onRequestThumbnails(e.item.id))});const T=()=>{i(!0)};return(()=>{var y=Qt(),I=y.firstChild;return r(y,(()=>{var C=ee(()=>!!(R()&&!n()));return()=>C()?(()=>{var h=Zt();return h.addEventListener("error",T),z(S=>{var L=R(),U=`Thumbnail for ${e.item.id.slice(0,8)}`;return L!==S.e&&he(h,"src",S.e=L),U!==S.t&&he(h,"alt",S.t=U),S},{e:void 0,t:void 0}),h})():(()=>{var h=en();return r(h,()=>_t(e.item.mime)),h})()})(),I),r(y,k(j,{get when(){return e.showIndicators!==!1},get children(){return ee(()=>!!M())()?(()=>{var C=tn();return z(h=>D(C,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,b()*.15)}px;
              height: ${Math.max(6,b()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,h)),C})():ee(()=>!!E())()?(()=>{var C=nn();return z(h=>D(C,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,b()*.15)}px;
              height: ${Math.max(6,b()*.15)}px;
              background: #f59e0b;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
              animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            `,h)),C})():null}}),I),z(C=>{var h=`thumbnail ${e.className||""}`,S=`
        width: ${b()}px;
        height: ${b()}px;
        border-radius: ${a()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12,b()*.3)}px;
        position: relative;
        flex-shrink: 0;
      `,L=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return h!==C.e&&q(y,C.e=h),C.t=D(y,S,C.t),L!==C.a&&he(y,"title",C.a=L),C},{e:void 0,t:void 0,a:void 0}),y})()}function ln(e){if(e===0)return"0 B";const n=1024,i=["B","KB","MB","GB","TB","PB"],d=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,d)).toFixed(2))+" "+i[d]}var rn=p("<span style=font-weight:500;>"),de=p("<span>"),an=p("<span style=font-family:monospace;font-size:12px;>"),sn=p('<button style="background:#ff00ff;border:none;color:#000000;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⋯'),dn=p("<div>"),cn=p(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
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
      `);const Fe="freqhole-demo-state",Ze=300;function ot(){try{const e=localStorage.getItem(Fe);return e?JSON.parse(e):{}}catch{return{}}}function Z(e){try{const i={...ot(),...e};localStorage.setItem(Fe,JSON.stringify(i))}catch{}}function un(e){const n=ot(),i=zt({wsUrl:e.wsUrl,channels:["MediaBlobs"],debug:n.debug??!1,autoConnect:e.autoConnect,autoRefresh:n.autoRefresh??!0}),[d,c]=$({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[b,a]=$({field:"created_at",direction:"desc",...n.sortConfig||{}}),[m,M]=$(n.viewMode||"default"),[E,R]=$({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[T,y]=$(n.isFilterPanelOpen??!0),[I,C]=$(n.filterPanelWidth||Ze),[h,S]=$(n.isBrowsePanelOpen??!0),[L,U]=$(n.browsePanelWidth||Ze),[w,x]=$(e.wsUrl),[s,F]=$(e.autoConnect),[u,v]=$(!0),[W,_]=$(!1),[G,K]=$([]),ge=()=>i.state().connectionStatus,be=()=>i.state().hasPendingUpdates,De=()=>i.state().lastUpdated,[ie,me]=$(new Set),P=Vt({onSelectionChange:t=>{Z({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),re=(t,l,g)=>{g.shiftKey&&P.lastSelectedIndex()>=0?(g.preventDefault(),P.selectRange(P.lastSelectedIndex(),l,se())):P.handleRowClick(t,l,g)},xe=t=>{console.log("Double-clicked:",t.id)},ve=t=>{t.key==="a"&&(t.metaKey||t.ctrlKey)?(t.preventDefault(),P.selectAll(se())):P.handleKeyDown(t)},we=t=>{if(P.isDragSelecting()&&P.dragStart()){P.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const l=P.dragStart(),g=Math.floor((t.clientY-l.y)/60);if(g!==l.startIndex){const f=Math.min(l.startIndex,l.startIndex+g),N=Math.max(l.startIndex,l.startIndex+g);P.selectRange(f,N,se())}}};ue(()=>{document.addEventListener("mousemove",we),document.addEventListener("keydown",ve)}),Ee(()=>{document.removeEventListener("mousemove",we),document.removeEventListener("keydown",ve)});const ae=V(()=>{const t=d();return i.state().items.filter(l=>{if(t.name&&!Le(l).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!l.mime?.startsWith(t.mime)||t.blobType&&l.blob_type!==t.blobType||(l.size||0)<t.minSize||(l.size||0)>t.maxSize)return!1;if(t.hasParent!=="all"){const g=!!l.parent_blob_id;if(t.hasParent==="yes"&&!g||t.hasParent==="no"&&g)return!1}if(t.hasLocalPath!=="all"){const g=!!l.local_path;if(t.hasLocalPath==="yes"&&!g||t.hasLocalPath==="no"&&g)return!1}return!0})}),se=V(()=>{const t=b();return[...ae()].sort((g,f)=>{const N=g[t.field],J=f[t.field];let H=0;return N<J?H=-1:N>J&&(H=1),t.direction==="desc"?H*-1:H})}),$e=t=>{ie().has(t)||(me(l=>new Set([...l,t])),i.actions.getThumbnails(t),A(`🖼️ Requesting thumbnails for ${t.slice(0,8)}`))},pe=V(()=>{const t=E(),l=[];return t.thumbnail&&l.push({key:"thumbnail",title:"📷",width:60,render:g=>k(on,{item:g,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:$e,get requestedThumbnails(){return ie()},showIndicators:!0})}),t.name&&l.push({key:"name",title:"Name",width:250,sortable:!0,render:g=>(()=>{var f=rn();return r(f,()=>Le(g)),z(()=>he(f,"title",Le(g))),f})()}),t.blob_type&&l.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.mime&&l.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:g=>(()=>{var f=de();return r(f,()=>g.mime||"unknown"),f})()}),t.id&&l.push({key:"id",title:"ID",width:200,sortable:!0,render:g=>(()=>{var f=an();return r(f,()=>g.id),f})()}),t.size&&l.push({key:"size",title:"Size",width:100,sortable:!0,render:g=>(()=>{var f=de();return r(f,()=>ln(g.size||0)),f})()}),t.parent_blob_id&&l.push({key:"parent_blob_id",title:"Parent",width:120,render:g=>(()=>{var f=de();return r(f,()=>g.parent_blob_id?"Yes":"No"),f})()}),t.local_path&&l.push({key:"local_path",title:"Local Path",width:200,render:g=>(()=>{var f=de();return r(f,()=>g.local_path||"None"),f})()}),t.created_at&&l.push({key:"created_at",title:"Created",width:140,sortable:!0,render:g=>(()=>{var f=de();return r(f,()=>new Date(g.created_at).toLocaleString()),f})()}),t.updated_at&&l.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:g=>(()=>{var f=de();return r(f,()=>new Date(g.updated_at).toLocaleString()),f})()}),t.actions&&l.push({key:"actions",title:"Actions",width:100,render:g=>(()=>{var f=sn();return f.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${g.id}`,"_blank"),f})()}),l}),Me=V(()=>[...new Set(i.state().items.map(t=>t.mime?.split("/")[0]).filter(Boolean))].sort()),ye=V(()=>[...new Set(i.state().items.map(l=>l.blob_type))].sort()),fe=(t,l)=>{c(g=>({...g,[t]:l})),Z({filterConfig:{...d(),[t]:l}})},Re=(t,l)=>{a({field:t,direction:l}),Z({sortConfig:{field:t,direction:l}})},Se=t=>{M(t),Z({viewMode:t})},ke=t=>{R(l=>{const g={...l,[t]:!l[t]};return Z({columnVisibility:g}),g})},Ce=()=>{S(t=>{const l=!t;return Z({isBrowsePanelOpen:l}),l})},_e=()=>{y(t=>{const l=!t;return Z({isFilterPanelOpen:l}),l})},A=t=>{const l=new Date().toLocaleTimeString();K(g=>[`${l}: ${t}`,...g.slice(0,49)])};return ce(()=>{const t=i.state().items;t.length>0&&A(`📊 Feed updated: ${t.length} items available`)}),ce(()=>{const t=i.state().requestedThumbnails;t.size>0&&A(`🖼️ Thumbnail requests: ${t.size} items`)}),ce(()=>{const t=i.state().connectionStatus;A(`🔌 Connection status: ${t}`)}),ce(()=>{i.state().hasPendingUpdates&&A(`📥 ${i.state().pendingUpdates.length} pending updates available`)}),ue(()=>{A("🚀 FreqholeDemo mounted"),A(`🔌 WebSocket URL: ${w()}`),s()&&A("🔌 Auto-connecting to WebSocket...")}),(()=>{var t=cn(),l=t.firstChild,g=l.nextSibling;return r(t,k(Tt,{get isOpen(){return h()},get filterConfig(){return d()},onTogglePanel:Ce,onFilterChange:fe,onWidthChange:f=>{U(f),Z({browsePanelWidth:f})},get initialWidth(){return L()}}),l),r(t,k(Ht,{get selectedCount(){return P.selectedItems().size},onDownload:()=>{console.log("Bulk download:",P.selectedItems().size,"items")},get onClear(){return P.clearSelection},onMore:()=>{console.log("Show bulk actions menu")}}),l),r(l,k(Jt,{get data(){return se()},get columns(){return pe()},onSort:Re,get sortField(){return b().field},get sortDirection(){return b().direction},get rowHeight(){return ee(()=>m()==="compact")()?40:m()==="detailed"?80:60},headerHeight:60,getItemId:f=>f.id,get selectedItems(){return P.selectedItems()},onRowClick:re,onRowDoubleClick:xe,get onRowMouseDown(){return P.handleRowMouseDown},get isDragSelecting(){return P.isDragSelecting()}})),r(t,k(Ge,{get isVisible(){return!h()},position:"left",panelName:"Browse",onClick:Ce}),g),r(t,k(Ge,{get isVisible(){return!T()},position:"right",panelName:"Controls",onClick:_e}),g),r(t,k(j,{get when(){return ee(()=>!!(P.isDragSelecting()&&P.dragStart()))()&&P.dragEnd()},get children(){var f=dn();return z(N=>D(f,(()=>{const J=P.dragStart(),H=P.dragEnd(),Te=Math.min(J.x,H.x),Ie=Math.min(J.y,H.y),Q=Math.abs(H.x-J.x),Pe=Math.abs(H.y-J.y);return`
              position: fixed;
              left: ${Te}px;
              top: ${Ie}px;
              width: ${Q}px;
              height: ${Pe}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),N)),f}}),g),r(t,k(Ut,{get isOpen(){return T()},get filterConfig(){return d()},get viewMode(){return m()},get columnVisibility(){return E()},get wsUrl(){return w()},get autoConnect(){return s()},get autoRefresh(){return u()},get debug(){return W()},get connectionStatus(){return ge()},get hasPendingUpdates(){return be()},get pendingUpdatesCount(){return i.state().pendingUpdates.length},get filteredCount(){return ae().length},get totalCount(){return i.state().items.length},get sortConfig(){return b()},get lastUpdated(){return De()},get mimeCategories(){return Me()},get blobTypes(){return ye()},get logs(){return G()},onTogglePanel:_e,onFilterChange:fe,onViewModeChange:Se,onColumnToggle:ke,onWsUrlChange:x,onConnect:()=>{i.actions.connect(),A("🔌 Connecting to WebSocket...")},onDisconnect:()=>{i.actions.disconnect(),A("🔌 Disconnecting from WebSocket...")},onRefresh:()=>{A("🔄 Refreshing data..."),i.actions.refresh()},onApplyPendingUpdates:()=>{i.actions.applyPendingUpdates(),A("✅ Applied pending updates")},onToggleAutoConnect:()=>{F(f=>!f),A(`🔧 Auto-connect: ${s()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{v(f=>!f),A(`🔧 Auto-refresh: ${u()?"OFF":"ON"}`)},onToggleDebug:()=>{_(f=>!f),A(`🐛 Debug: ${W()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Fe),window.location.reload())},onWidthChange:f=>{C(f),Z({filterPanelWidth:f})},get initialWidth(){return I()}}),g),t})()}le(["click"]);class gn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",i=this.getAttribute("api-base-url")||"http://localhost:8080",d=this.getAttribute("auto-connect")==="true";this.dispose=kt(()=>k(un,{wsUrl:n,apiBaseUrl:i,autoConnect:d}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",gn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
