import{d as re,c as S,t as $,a as q,b as C,e as A,s as _,i as a,m as ee,f as y,S as X,F as ne,g as fe,o as he,h as Ee,j as ce,k as Z,u as et,r as kt}from"./web-2xXXrb5V.js";import{u as Ct}from"./useThumbnail-BJBtHgwT.js";import{u as _t}from"./thumbnail-utils-DME7itp9.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Le(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var zt=$(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function tt(e){const[n,o]=S(!1);return(()=>{var s=zt(),d=s.firstChild,m=d.nextSibling;return s.addEventListener("mouseleave",()=>o(!1)),s.addEventListener("mouseenter",()=>o(!0)),q(s,"mousedown",e.onMouseDown,!0),C(i=>{var u=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,w=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,z=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${n()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,D=`
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
        `;return u!==i.e&&A(s,i.e=u),i.t=_(s,w,i.t),i.a=_(d,z,i.a),i.o=_(m,D,i.o),i},{e:void 0,t:void 0,a:void 0,o:void 0}),s})()}re(["mousedown"]);function nt(e){const[n,o]=S(e.initialWidth),[s,d]=S(!1),m=e.minWidth||250,i=e.maxWidth||600,u=e.closeThreshold||100;return{width:n,setWidth:o,isDragging:s,handleMouseDown:(z,D="right")=>{z.preventDefault(),d(!0),document.body.classList.add("resizing");const R=z.clientX,F=n(),O=v=>{const T=v.clientX-R,W=D==="right"?F-T:F+T;if(W<u){e.onClose?.();return}const U=Math.max(m,Math.min(i,W));o(U),e.onWidthChange?.(U)},H=()=>{d(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",O),document.removeEventListener("mouseup",H)};document.addEventListener("mousemove",O),document.addEventListener("mouseup",H)}}}var Dt=$(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Mt=$('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Rt(e){const n=nt({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var o=Dt(),s=o.firstChild,d=s.firstChild,m=d.nextSibling,i=s.nextSibling;return q(m,"click",e.onTogglePanel,!0),a(o,(()=>{var u=ee(()=>!!e.isOpen);return()=>u()&&(()=>{var w=Mt(),z=w.firstChild,D=z.nextSibling;return D.$$input=R=>e.onFilterChange("name",R.currentTarget.value),C(()=>D.value=e.filterConfig.name),w})()})(),i),a(o,y(tt,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:u=>n.handleMouseDown(u,"left")}),i),C(u=>{var w=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,z=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return w!==u.e&&A(o,u.e=w),u.t=_(o,z,u.t),u},{e:void 0,t:void 0}),o})()}re(["click","input"]);var Tt=$(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),It=$('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Pt=$('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Lt=$('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),je=$("<option>"),Et=$("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Ft=$("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Wt(e){const[n,o]=S(!1),s=nt({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),d=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"name",title:"Name"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_blob_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],m=i=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[i]||"color: #6b7280;";return(()=>{var i=Tt(),u=i.firstChild,w=u.firstChild,z=w.nextSibling,D=u.nextSibling;return q(z,"click",e.onTogglePanel,!0),a(i,(()=>{var R=ee(()=>!!e.isOpen);return()=>R()&&(()=>{var F=Lt(),O=F.firstChild,H=O.firstChild,v=H.nextSibling,T=v.nextSibling,W=T.firstChild,U=W.nextSibling,p=T.nextSibling,b=p.firstChild,c=b.nextSibling,I=p.nextSibling,g=I.firstChild,x=g.nextSibling,P=O.nextSibling,k=P.firstChild,j=k.nextSibling,V=j.firstChild,ue=V.nextSibling,be=P.nextSibling,De=be.firstChild,ie=De.nextSibling;ie.firstChild;var me=be.nextSibling,M=me.firstChild,le=M.nextSibling;le.firstChild;var xe=me.nextSibling,ve=xe.firstChild,pe=ve.nextSibling,ae=pe.firstChild,se=ae.nextSibling,$e=se.nextSibling,we=xe.nextSibling,Me=we.firstChild,ye=Me.nextSibling,ge=we.nextSibling,Re=ge.firstChild,Se=Re.nextSibling,ke=ge.nextSibling,Ce=ke.firstChild,_e=Ce.nextSibling,L=_e.firstChild,t=L.nextSibling,l=t.nextSibling,f=ke.nextSibling,h=f.firstChild,B=h.nextSibling,G=B.firstChild,N=B.nextSibling,Te=f.nextSibling,Ie=Te.firstChild,J=Ie.nextSibling,Pe=J.firstChild,We=Pe.nextSibling,rt=We.nextSibling,lt=rt.nextSibling,at=lt.nextSibling,Ue=at.nextSibling,st=Ue.nextSibling,dt=st.nextSibling,ct=dt.nextSibling,Ae=ct.nextSibling,ut=Ae.nextSibling,Oe=ut.nextSibling,gt=Oe.nextSibling,ft=gt.nextSibling;ft.nextSibling;var qe=J.nextSibling,ht=qe.firstChild,ze=ht.nextSibling,bt=qe.nextSibling;return v.$$input=r=>e.onWsUrlChange(r.currentTarget.value),a(U,()=>e.connectionStatus),q(b,"click",e.onConnect,!0),q(c,"click",e.onDisconnect,!0),q(x,"click",e.onToggleAutoConnect,!0),a(x,()=>e.autoConnect?"ON":"OFF"),q(V,"click",e.onToggleAutoRefresh,!0),a(V,()=>e.autoRefresh?"ON":"OFF"),q(ue,"click",e.onRefresh,!0),a(P,y(X,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var r=It(),E=r.firstChild,te=E.firstChild,Y=te.nextSibling;return Y.nextSibling,q(E,"click",e.onApplyPendingUpdates,!0),a(E,()=>e.pendingUpdatesCount,Y),r}}),null),ie.addEventListener("change",r=>e.onFilterChange("mime",r.currentTarget.value)),a(ie,y(ne,{get each(){return e.mimeCategories},children:r=>(()=>{var E=je();return E.value=r,a(E,r),E})()}),null),le.addEventListener("change",r=>e.onFilterChange("blobType",r.currentTarget.value)),a(le,y(ne,{get each(){return e.blobTypes},children:r=>(()=>{var E=je();return E.value=r,a(E,r),E})()}),null),ae.$$input=r=>e.onFilterChange("minSize",parseInt(r.currentTarget.value)||0),$e.$$input=r=>e.onFilterChange("maxSize",parseInt(r.currentTarget.value)||1e8),ye.addEventListener("change",r=>e.onFilterChange("hasParent",r.currentTarget.value)),Se.addEventListener("change",r=>e.onFilterChange("hasLocalPath",r.currentTarget.value)),L.$$click=()=>e.onViewModeChange("compact"),t.$$click=()=>e.onViewModeChange("default"),l.$$click=()=>e.onViewModeChange("detailed"),B.$$click=()=>o(!n()),a(B,()=>n()?"Hide":"Show",G),a(N,y(ne,{each:d,children:r=>(()=>{var E=Et(),te=E.firstChild,Y=te.firstChild,oe=Y.nextSibling;return Y.addEventListener("change",()=>e.onColumnToggle(r.key)),a(oe,()=>r.title),C(()=>Y.checked=e.columnVisibility[r.key]),E})()})),a(J,()=>e.totalCount,We),a(J,()=>e.filteredCount,Ue),a(J,()=>e.sortConfig.field,Ae),a(J,()=>e.sortConfig.direction,Oe),a(J,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),q(ze,"click",e.onToggleDebug,!0),a(ze,()=>e.debug?"ON":"OFF"),q(bt,"click",e.onReset,!0),a(F,y(X,{get when(){return e.debug&&e.logs.length>0},get children(){var r=Pt(),E=r.firstChild,te=E.nextSibling;return a(te,y(ne,{get each(){return e.logs},children:Y=>(()=>{var oe=Ft();return a(oe,Y),oe})()})),r}}),null),C(r=>{var E=m(e.connectionStatus),te=e.connectionStatus==="Connected",Y=e.connectionStatus==="Disconnected",oe=`toggle-button ${e.autoConnect?"active":""}`,mt=`
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
            `,He=`view-mode-button ${e.viewMode==="default"?"active":""}`,pt=`
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
            `,Ke=`toggle-button ${n()?"active":""}`,wt=`
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
            `;return r.e=_(U,E,r.e),te!==r.t&&(b.disabled=r.t=te),Y!==r.a&&(c.disabled=r.a=Y),oe!==r.o&&A(x,r.o=oe),r.i=_(x,mt,r.i),Be!==r.n&&A(V,r.n=Be),r.s=_(V,xt,r.s),Ne!==r.h&&A(L,r.h=Ne),r.r=_(L,vt,r.r),He!==r.d&&A(t,r.d=He),r.l=_(t,pt,r.l),Ve!==r.u&&A(l,r.u=Ve),r.c=_(l,$t,r.c),Ke!==r.w&&A(B,r.w=Ke),r.m=_(B,wt,r.m),Ye!==r.f&&A(N,r.f=Ye),r.y=_(N,yt,r.y),Xe!==r.g&&A(ze,r.g=Xe),r.p=_(ze,St,r.p),r},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),C(()=>v.value=e.wsUrl),C(()=>ie.value=e.filterConfig.mime),C(()=>le.value=e.filterConfig.blobType),C(()=>ae.value=e.filterConfig.minSize),C(()=>$e.value=e.filterConfig.maxSize),C(()=>ye.value=e.filterConfig.hasParent),C(()=>Se.value=e.filterConfig.hasLocalPath),F})()})(),D),a(i,y(tt,{position:"left",get isDragging(){return s.isDragging()},onMouseDown:R=>s.handleMouseDown(R,"right")}),D),C(R=>{var F=`filter-panel ${e.isOpen?"":"collapsed"} ${s.isDragging()?"resizing":""}`,O=`
        width: ${e.isOpen?s.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return F!==R.e&&A(i,R.e=F),R.t=_(i,O,R.t),R},{e:void 0,t:void 0}),i})()}re(["click","input"]);var Ut=$(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function Ge(e){const[n,o]=S(!1);return y(X,{get when(){return e.isVisible},get children(){var s=Ut(),d=s.firstChild,m=d.nextSibling;return s.addEventListener("mouseleave",()=>o(!1)),s.addEventListener("mouseenter",()=>o(!0)),q(s,"click",e.onClick,!0),a(d,()=>e.position==="left"?"→":"←"),a(m,()=>e.panelName),C(i=>{var u=`edge-toggle-button edge-toggle-${e.position}`,w=`Show ${e.panelName} panel`,z=`
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
        `,D=`
            opacity: ${n()?"1":"0"};
            transform: translateY(${n()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return u!==i.e&&A(s,i.e=u),w!==i.t&&fe(s,"title",i.t=w),i.a=_(s,z,i.a),i.o=_(d,D,i.o),i},{e:void 0,t:void 0,a:void 0,o:void 0}),s}})}re(["click"]);var At=$('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),Ot=$('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),qt=$('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),Bt=$(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function Nt(e){return y(X,{get when(){return e.selectedCount>1},get children(){var n=Bt(),o=n.firstChild,s=o.firstChild,d=s.nextSibling;d.nextSibling;var m=o.nextSibling;return a(o,()=>e.selectedCount,s),a(o,()=>e.selectedCount===1?"":"s",d),a(n,y(X,{get when(){return e.onDownload},get children(){var i=At();return q(i,"click",e.onDownload,!0),i}}),m),a(n,y(X,{get when(){return e.onMore},get children(){var i=Ot();return q(i,"click",e.onMore,!0),i}}),m),a(n,y(X,{get when(){return e.onClear},get children(){var i=qt();return q(i,"click",e.onClear,!0),i}}),m),C(()=>A(n,`selection-toolbar ${e.className||""}`)),n}})}re(["click"]);function Ht(e={}){const[n,o]=S(e.initialSelection||new Set),[s,d]=S(-1),[m,i]=S(!1),[u,w]=S(null),[z,D]=S(null),R=c=>{o(I=>{const g=new Set(I);return g.has(c)?g.delete(c):g.add(c),g})},F=(c,I,g)=>{const x=Math.min(c,I),P=Math.max(c,I),k=g.slice(x,P+1);o(j=>{const V=new Set(j);return k.forEach(ue=>V.add(ue.id)),V})},O=()=>{o(new Set),d(-1)},H=c=>{const I=new Set(c.map(g=>g.id));o(I)},v=c=>n().has(c),T=(c,I,g)=>{const x=c.id;g.metaKey||g.ctrlKey?(R(x),d(I)):g.shiftKey&&s()>=0?(g.preventDefault(),d(I)):(o(new Set([x])),d(I))},W=(c,I,g)=>{g.button===0&&!g.metaKey&&!g.ctrlKey&&!g.shiftKey&&(w({x:g.clientX,y:g.clientY,startIndex:I}),i(!0))},U=c=>{c.key==="Escape"?O():c.key==="a"&&(c.metaKey||c.ctrlKey)?c.preventDefault():(c.key==="Delete"||c.key==="Backspace")&&n().size>0&&e.onDelete?.(n())},p=c=>{m()&&u()&&D({x:c.clientX,y:c.clientY,endIndex:-1})},b=()=>{m()&&(i(!1),w(null),D(null))};return he(()=>{document.addEventListener("mousemove",p),document.addEventListener("mouseup",b),document.addEventListener("keydown",U)}),Ee(()=>{document.removeEventListener("mousemove",p),document.removeEventListener("mouseup",b),document.removeEventListener("keydown",U),document.body.classList.remove("drag-selecting")}),ce(()=>{m()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")}),ce(()=>{const c=n();e.onSelectionChange?.(c),e.saveToStorage?.(c)}),{selectedItems:n,setSelectedItems:o,lastSelectedIndex:s,setLastSelectedIndex:d,isDragSelecting:m,setIsDragSelecting:i,dragStart:u,setDragStart:w,dragEnd:z,setDragEnd:D,toggleSelection:R,selectRange:F,clearSelection:O,selectAll:H,isSelected:v,handleRowClick:T,handleRowMouseDown:W,handleKeyDown:U}}const K={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function Vt(e){const[n,o]=S(e.initialSort||{field:"id",direction:"asc"}),[s,d]=S(new Set),[m,i]=S(!1),u=e.getItemId||(v=>v.id||String(v)),w=Z(()=>{const v=n();return[...e.data].sort((W,U)=>{const p=W[v.field],b=U[v.field];let c=0;return p<b?c=-1:p>b&&(c=1),v.direction==="desc"?c*-1:c})});return{sortConfig:n,selectedItems:s,isDragSelecting:m,sortedData:w,handleSort:v=>{const T=n(),W=T.field===v&&T.direction==="asc"?"desc":"asc";o({field:v,direction:W})},toggleSelection:v=>{const T=new Set(s());T.has(v)?T.delete(v):T.add(v),d(T)},clearSelection:()=>{d(new Set)},selectAll:()=>{const v=new Set(e.data.map(u));d(v)},isSelected:v=>s().has(v),selectRange:(v,T)=>{const W=new Set(s()),U=Math.min(v,T),p=Math.max(v,T);for(let b=U;b<=p;b++)if(b<e.data.length&&e.data[b]!=null){const c=u(e.data[b]);W.add(c)}d(W)},setIsDragSelecting:i,getItemId:u}}var it=$("<div>"),Kt=$("<div class=grid-cell>"),Je=$("<div class=grid-content>"),Yt=$("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),Xt=$("<span style=font-size:12px;>"),jt=$("<div><span>");function Qe(e){let n;return he(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var o=it();o.$$contextmenu=d=>e.onContextMenu?.(e.item,e.index,d),o.$$mousedown=d=>e.onRowMouseDown?.(e.item,e.index,d),o.$$dblclick=d=>e.onRowDoubleClick?.(e.item,e.index,d),o.$$click=d=>e.onRowClick?.(e.item,e.index,d);var s=n;return typeof s=="function"?et(s,o):n=o,a(o,y(ne,{get each(){return e.columns},children:d=>(()=>{var m=Kt();return a(m,(()=>{var i=ee(()=>!!d.render);return()=>i()?d.render(e.item,e.index):String(e.item[d.key]||"")})()),C(i=>_(m,`
              flex: ${d.width?"0 0 "+d.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,i)),m})()})),C(d=>{var m=`grid-row ${e.isSelected?"selected":""}`,i=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${K.colors.border};
        background: ${e.isSelected?K.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease;
      `;return m!==d.e&&A(o,d.e=m),d.t=_(o,i,d.t),d},{e:void 0,t:void 0}),o})()}function Gt(e){const[n,o]=S(),[s,d]=S(0),[m,i]=S(0),u=e.rowHeight||50,w=e.headerHeight||60,z=e.virtualizeThreshold||100,D=Vt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),R=(p,b,c)=>{e.onRowClick?.(p,b,c)},F=(p,b,c)=>{e.onRowDoubleClick?.(p,b,c)},O=(p,b,c)=>{e.onRowMouseDown?.(p,b,c)},H=Z(()=>e.data.length>z),v=Z(()=>{if(!H())return e.data.map((k,j)=>({item:k,index:j}));if(!n())return[];const b=u,c=s(),I=m(),g=Math.floor(c/b),x=Math.min(e.data.length-1,Math.ceil((c+I)/b)+5),P=[];for(let k=Math.max(0,g-5);k<=x;k++)k<e.data.length&&e.data[k]!=null&&P.push({item:e.data[k],index:k});return P}),T=Z(()=>e.data.length*u),W=p=>{const b=p.target;d(b.scrollTop)},U=p=>{if(D.handleSort(p),e.onSort){const b=D.sortConfig();e.onSort(b.field,b.direction)}};return he(()=>{const p=n();if(!p)return;const b=new ResizeObserver(c=>{for(const I of c)i(I.contentRect.height)});b.observe(p),Ee(()=>{b.disconnect()})}),(()=>{var p=Yt(),b=p.firstChild,c=b.nextSibling,I=c.nextSibling;return a(b,y(ne,{get each(){return e.columns},children:g=>(()=>{var x=jt(),P=x.firstChild;return x.$$click=()=>g.sortable&&U(g.key),a(P,()=>g.title),a(x,y(X,{get when(){return ee(()=>!!g.sortable)()&&D.sortConfig().field===g.key},get children(){var k=Xt();return a(k,()=>D.sortConfig().direction==="asc"?"↑":"↓"),k}}),null),C(k=>{var j=`grid-header-cell ${g.sortable?"sortable":""}`,V=`
                flex: ${g.width?"0 0 "+g.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${g.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return j!==k.e&&A(x,k.e=j),k.t=_(x,V,k.t),k},{e:void 0,t:void 0}),x})()})),c.addEventListener("scroll",W),et(o,c),a(c,y(X,{get when(){return H()},get fallback(){return(()=>{var g=Je();return a(g,y(ne,{get each(){return e.data},children:(x,P)=>y(Qe,{item:x,get index(){return P()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(x)||x.id)||!1},onRowClick:R,onRowDoubleClick:F,onRowMouseDown:O,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:u})})),g})()},get children(){var g=Je();return a(g,y(ne,{get each(){return v()},children:x=>(()=>{var P=it();return a(P,y(Qe,{get item(){return x.item},get index(){return x.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(x.item)||x.item.id)||!1},onRowClick:R,onRowDoubleClick:F,onRowMouseDown:O,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:u})),C(k=>_(P,`
                    position: absolute;
                    top: ${x.index*u}px;
                    left: 0;
                    right: 0;
                  `,k)),P})()})),C(x=>_(g,`height: ${T()}px; position: relative;`,x)),g}})),a(I,()=>`
        .grid-row:hover:not(.selected) {
          background: ${K.colors.hover};
        }

        .grid-row.selected {
          background: ${K.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${K.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${K.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${K.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${K.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }
      `),C(g=>{var x=`infinite-data-grid ${e.className||""}`,P=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${K.colors.background};
        color: ${K.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,k=`
          height: ${w}px;
          display: flex;
          align-items: center;
          background: ${K.colors.header};
          border-bottom: 2px solid ${K.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return x!==g.e&&A(p,g.e=x),g.t=_(p,P,g.t),g.a=_(b,k,g.a),g},{e:void 0,t:void 0,a:void 0}),p})()}re(["click","dblclick","mousedown","contextmenu"]);var Jt=$(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),Qt=$("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),Zt=$("<span style=color:#94a3b8;>"),en=$('<div title="Has thumbnails">'),tn=$('<div title="Generating thumbnails...">');function nn(e){const n=()=>e.size||40,o=()=>e.borderRadius||"4px",s=Ct({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var d=Jt(),m=d.firstChild;return a(d,(()=>{var i=ee(()=>!!s.url);return()=>i()?(()=>{var u=Qt();return q(u,"error",s.onImageError),C(w=>{var z=s.url,D=`Thumbnail for ${e.item.id.slice(0,8)}`;return z!==w.e&&fe(u,"src",w.e=z),D!==w.t&&fe(u,"alt",w.t=D),w},{e:void 0,t:void 0}),u})():(()=>{var u=Zt();return a(u,()=>s.fallbackIcon),u})()})(),m),a(d,y(X,{get when(){return e.showIndicators!==!1},get children(){return ee(()=>!!s.hasThumbnails)()?(()=>{var i=en();return C(u=>_(i,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,n()*.15)}px;
              height: ${Math.max(6,n()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,u)),i})():ee(()=>!!s.isRequested)()?(()=>{var i=tn();return C(u=>_(i,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,n()*.15)}px;
              height: ${Math.max(6,n()*.15)}px;
              background: #f59e0b;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
              animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            `,u)),i})():null}}),m),C(i=>{var u=`thumbnail ${e.className||""}`,w=`
        width: ${n()}px;
        height: ${n()}px;
        border-radius: ${o()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12,n()*.3)}px;
        position: relative;
        flex-shrink: 0;
      `,z=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return u!==i.e&&A(d,i.e=u),i.t=_(d,w,i.t),z!==i.a&&fe(d,"title",i.a=z),i},{e:void 0,t:void 0,a:void 0}),d})()}function on(e){if(e===0)return"0 B";const n=1024,o=["B","KB","MB","GB","TB","PB"],s=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,s)).toFixed(2))+" "+o[s]}var rn=$("<span style=font-weight:500;>"),de=$("<span>"),ln=$("<span style=font-family:monospace;font-size:12px;>"),an=$('<button style="background:#ff00ff;border:none;color:#000000;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⋯'),sn=$("<div>"),dn=$(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
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
      `);const Fe="freqhole-demo-state",Ze=300;function ot(){try{const e=localStorage.getItem(Fe);return e?JSON.parse(e):{}}catch{return{}}}function Q(e){try{const o={...ot(),...e};localStorage.setItem(Fe,JSON.stringify(o))}catch{}}function cn(e){const n=ot(),o=_t({wsUrl:e.wsUrl,channels:["MediaBlobs"],debug:n.debug??!1,autoConnect:e.autoConnect,autoRefresh:n.autoRefresh??!0}),[s,d]=S({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[m,i]=S({field:"created_at",direction:"desc",...n.sortConfig||{}}),[u,w]=S(n.viewMode||"default"),[z,D]=S({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[R,F]=S(n.isFilterPanelOpen??!0),[O,H]=S(n.filterPanelWidth||Ze),[v,T]=S(n.isBrowsePanelOpen??!0),[W,U]=S(n.browsePanelWidth||Ze),[p,b]=S(e.wsUrl),[c,I]=S(e.autoConnect),[g,x]=S(!0),[P,k]=S(!1),[j,V]=S([]),ue=()=>o.state().connectionStatus,be=()=>o.state().hasPendingUpdates,De=()=>o.state().lastUpdated,[ie,me]=S(new Set),M=Ht({onSelectionChange:t=>{Q({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),le=(t,l,f)=>{f.shiftKey&&M.lastSelectedIndex()>=0?(f.preventDefault(),M.selectRange(M.lastSelectedIndex(),l,se())):M.handleRowClick(t,l,f)},xe=t=>{console.log("Double-clicked:",t.id)},ve=t=>{t.key==="a"&&(t.metaKey||t.ctrlKey)?(t.preventDefault(),M.selectAll(se())):M.handleKeyDown(t)},pe=t=>{if(M.isDragSelecting()&&M.dragStart()){M.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const l=M.dragStart(),f=Math.floor((t.clientY-l.y)/60);if(f!==l.startIndex){const h=Math.min(l.startIndex,l.startIndex+f),B=Math.max(l.startIndex,l.startIndex+f);M.selectRange(h,B,se())}}};he(()=>{document.addEventListener("mousemove",pe),document.addEventListener("keydown",ve)}),Ee(()=>{document.removeEventListener("mousemove",pe),document.removeEventListener("keydown",ve)});const ae=Z(()=>{const t=s();return o.state().items.filter(l=>{if(t.name&&!Le(l).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!l.mime?.startsWith(t.mime)||t.blobType&&l.blob_type!==t.blobType||(l.size||0)<t.minSize||(l.size||0)>t.maxSize)return!1;if(t.hasParent!=="all"){const f=!!l.parent_blob_id;if(t.hasParent==="yes"&&!f||t.hasParent==="no"&&f)return!1}if(t.hasLocalPath!=="all"){const f=!!l.local_path;if(t.hasLocalPath==="yes"&&!f||t.hasLocalPath==="no"&&f)return!1}return!0})}),se=Z(()=>{const t=m();return[...ae()].sort((f,h)=>{const B=f[t.field],G=h[t.field];let N=0;return B<G?N=-1:B>G&&(N=1),t.direction==="desc"?N*-1:N})}),$e=t=>{ie().has(t)||(me(l=>new Set([...l,t])),o.actions.getThumbnails(t),L(`🖼️ Requesting thumbnails for ${t.slice(0,8)}`))},we=Z(()=>{const t=z(),l=[];return t.thumbnail&&l.push({key:"thumbnail",title:"📷",width:60,render:f=>y(nn,{item:f,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:$e,get requestedThumbnails(){return ie()},showIndicators:!0})}),t.name&&l.push({key:"name",title:"Name",width:250,sortable:!0,render:f=>(()=>{var h=rn();return a(h,()=>Le(f)),C(()=>fe(h,"title",Le(f))),h})()}),t.blob_type&&l.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.mime&&l.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:f=>(()=>{var h=de();return a(h,()=>f.mime||"unknown"),h})()}),t.id&&l.push({key:"id",title:"ID",width:200,sortable:!0,render:f=>(()=>{var h=ln();return a(h,()=>f.id),h})()}),t.size&&l.push({key:"size",title:"Size",width:100,sortable:!0,render:f=>(()=>{var h=de();return a(h,()=>on(f.size||0)),h})()}),t.parent_blob_id&&l.push({key:"parent_blob_id",title:"Parent",width:120,render:f=>(()=>{var h=de();return a(h,()=>f.parent_blob_id?"Yes":"No"),h})()}),t.local_path&&l.push({key:"local_path",title:"Local Path",width:200,render:f=>(()=>{var h=de();return a(h,()=>f.local_path||"None"),h})()}),t.created_at&&l.push({key:"created_at",title:"Created",width:140,sortable:!0,render:f=>(()=>{var h=de();return a(h,()=>new Date(f.created_at).toLocaleString()),h})()}),t.updated_at&&l.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:f=>(()=>{var h=de();return a(h,()=>new Date(f.updated_at).toLocaleString()),h})()}),t.actions&&l.push({key:"actions",title:"Actions",width:100,render:f=>(()=>{var h=an();return h.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${f.id}`,"_blank"),h})()}),l}),Me=Z(()=>[...new Set(o.state().items.map(t=>t.mime?.split("/")[0]).filter(Boolean))].sort()),ye=Z(()=>[...new Set(o.state().items.map(l=>l.blob_type))].sort()),ge=(t,l)=>{d(f=>({...f,[t]:l})),Q({filterConfig:{...s(),[t]:l}})},Re=(t,l)=>{i({field:t,direction:l}),Q({sortConfig:{field:t,direction:l}})},Se=t=>{w(t),Q({viewMode:t})},ke=t=>{D(l=>{const f={...l,[t]:!l[t]};return Q({columnVisibility:f}),f})},Ce=()=>{T(t=>{const l=!t;return Q({isBrowsePanelOpen:l}),l})},_e=()=>{F(t=>{const l=!t;return Q({isFilterPanelOpen:l}),l})},L=t=>{const l=new Date().toLocaleTimeString();V(f=>[`${l}: ${t}`,...f.slice(0,49)])};return ce(()=>{const t=o.state().items;t.length>0&&L(`📊 Feed updated: ${t.length} items available`)}),ce(()=>{const t=o.state().requestedThumbnails;t.size>0&&L(`🖼️ Thumbnail requests: ${t.size} items`)}),ce(()=>{const t=o.state().connectionStatus;L(`🔌 Connection status: ${t}`)}),ce(()=>{o.state().hasPendingUpdates&&L(`📥 ${o.state().pendingUpdates.length} pending updates available`)}),he(()=>{L("🚀 FreqholeDemo mounted"),L(`🔌 WebSocket URL: ${p()}`),c()&&L("🔌 Auto-connecting to WebSocket...")}),(()=>{var t=dn(),l=t.firstChild,f=l.nextSibling;return a(t,y(Rt,{get isOpen(){return v()},get filterConfig(){return s()},onTogglePanel:Ce,onFilterChange:ge,onWidthChange:h=>{U(h),Q({browsePanelWidth:h})},get initialWidth(){return W()}}),l),a(t,y(Nt,{get selectedCount(){return M.selectedItems().size},onDownload:()=>{console.log("Bulk download:",M.selectedItems().size,"items")},get onClear(){return M.clearSelection},onMore:()=>{console.log("Show bulk actions menu")}}),l),a(l,y(Gt,{get data(){return se()},get columns(){return we()},onSort:Re,get sortField(){return m().field},get sortDirection(){return m().direction},get rowHeight(){return ee(()=>u()==="compact")()?40:u()==="detailed"?80:60},headerHeight:60,getItemId:h=>h.id,get selectedItems(){return M.selectedItems()},onRowClick:le,onRowDoubleClick:xe,get onRowMouseDown(){return M.handleRowMouseDown},get isDragSelecting(){return M.isDragSelecting()}})),a(t,y(Ge,{get isVisible(){return!v()},position:"left",panelName:"Browse",onClick:Ce}),f),a(t,y(Ge,{get isVisible(){return!R()},position:"right",panelName:"Controls",onClick:_e}),f),a(t,y(X,{get when(){return ee(()=>!!(M.isDragSelecting()&&M.dragStart()))()&&M.dragEnd()},get children(){var h=sn();return C(B=>_(h,(()=>{const G=M.dragStart(),N=M.dragEnd(),Te=Math.min(G.x,N.x),Ie=Math.min(G.y,N.y),J=Math.abs(N.x-G.x),Pe=Math.abs(N.y-G.y);return`
              position: fixed;
              left: ${Te}px;
              top: ${Ie}px;
              width: ${J}px;
              height: ${Pe}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),B)),h}}),f),a(t,y(Wt,{get isOpen(){return R()},get filterConfig(){return s()},get viewMode(){return u()},get columnVisibility(){return z()},get wsUrl(){return p()},get autoConnect(){return c()},get autoRefresh(){return g()},get debug(){return P()},get connectionStatus(){return ue()},get hasPendingUpdates(){return be()},get pendingUpdatesCount(){return o.state().pendingUpdates.length},get filteredCount(){return ae().length},get totalCount(){return o.state().items.length},get sortConfig(){return m()},get lastUpdated(){return De()},get mimeCategories(){return Me()},get blobTypes(){return ye()},get logs(){return j()},onTogglePanel:_e,onFilterChange:ge,onViewModeChange:Se,onColumnToggle:ke,onWsUrlChange:b,onConnect:()=>{o.actions.connect(),L("🔌 Connecting to WebSocket...")},onDisconnect:()=>{o.actions.disconnect(),L("🔌 Disconnecting from WebSocket...")},onRefresh:()=>{L("🔄 Refreshing data..."),o.actions.refresh()},onApplyPendingUpdates:()=>{o.actions.applyPendingUpdates(),L("✅ Applied pending updates")},onToggleAutoConnect:()=>{I(h=>!h),L(`🔧 Auto-connect: ${c()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{x(h=>!h),L(`🔧 Auto-refresh: ${g()?"OFF":"ON"}`)},onToggleDebug:()=>{k(h=>!h),L(`🐛 Debug: ${P()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Fe),window.location.reload())},onWidthChange:h=>{H(h),Q({filterPanelWidth:h})},get initialWidth(){return O()}}),f),t})()}re(["click"]);class un extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",o=this.getAttribute("api-base-url")||"http://localhost:8080",s=this.getAttribute("auto-connect")==="true";this.dispose=kt(()=>y(cn,{wsUrl:n,apiBaseUrl:o,autoConnect:s}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",un),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
