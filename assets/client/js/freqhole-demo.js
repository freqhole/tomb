import{d as re,c as x,t as S,a as B,b as R,e as U,s as D,i as a,m as ce,f as $,S as G,F as ne,g as et,o as he,h as Le,j as Ye,k as ee,u as tt,r as Ct}from"./web-xBr4R5eT.js";import{g as _t}from"./thumbnail-utils-C-GIDKg1.js";function Pe(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.filename||e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var zt=S(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function nt(e){const[n,s]=x(!1);return(()=>{var d=zt(),g=d.firstChild,p=g.nextSibling;return d.addEventListener("mouseleave",()=>s(!1)),d.addEventListener("mouseenter",()=>s(!0)),B(d,"mousedown",e.onMouseDown),R(r=>{var b=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,k=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,P=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${n()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,_=`
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
        `;return b!==r.e&&U(d,r.e=b),r.t=D(d,k,r.t),r.a=D(g,P,r.a),r.o=D(p,_,r.o),r},{e:void 0,t:void 0,a:void 0,o:void 0}),d})()}re(["mousedown"]);function ot(e){const[n,s]=x(e.initialWidth),[d,g]=x(!1),p=e.minWidth||250,r=e.maxWidth||600,b=e.closeThreshold||100;return{width:n,setWidth:s,isDragging:d,handleMouseDown:(P,_="right")=>{P.preventDefault(),g(!0),document.body.classList.add("resizing");const I=P.clientX,E=n(),O=v=>{const z=v.clientX-I,W=_==="right"?E-z:E+z;if(W<b){e.onClose?.();return}const A=Math.max(p,Math.min(r,W));s(A),e.onWidthChange?.(A)},H=()=>{g(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",O),document.removeEventListener("mouseup",H)};document.addEventListener("mousemove",O),document.addEventListener("mouseup",H)}}}var Dt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Mt=S('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Rt(e){const n=ot({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var s=Dt(),d=s.firstChild,g=d.firstChild,p=g.nextSibling,r=d.nextSibling;return B(p,"click",e.onTogglePanel),a(s,(()=>{var b=ce(()=>!!e.isOpen);return()=>b()&&(()=>{var k=Mt(),P=k.firstChild,_=P.nextSibling;return _.$$input=I=>e.onFilterChange("name",I.currentTarget.value),R(()=>_.value=e.filterConfig.name),k})()})(),r),a(s,$(nt,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:b=>n.handleMouseDown(b,"left")}),r),R(b=>{var k=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,P=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return k!==b.e&&U(s,b.e=k),b.t=D(s,P,b.t),b},{e:void 0,t:void 0}),s})()}re(["click","input"]);var It=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Tt=S('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Pt=S('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Lt=S('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),je=S("<option>"),Et=S("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Ft=S("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Wt(e){const[n,s]=x(!1),d=ot({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),g=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],p=r=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[r]||"color: #6b7280;";return(()=>{var r=It(),b=r.firstChild,k=b.firstChild,P=k.nextSibling,_=b.nextSibling;return B(P,"click",e.onTogglePanel),a(r,(()=>{var I=ce(()=>!!e.isOpen);return()=>I()&&(()=>{var E=Lt(),O=E.firstChild,H=O.firstChild,v=H.nextSibling,z=v.nextSibling,W=z.firstChild,A=W.nextSibling,w=z.nextSibling,h=w.firstChild,c=h.nextSibling,M=w.nextSibling,u=M.firstChild,m=u.nextSibling,T=O.nextSibling,y=T.firstChild,X=y.nextSibling,N=X.firstChild,ge=N.nextSibling,be=T.nextSibling,ue=be.firstChild,ae=ue.nextSibling;ae.firstChild;var me=be.nextSibling,_e=me.firstChild,J=_e.nextSibling;J.firstChild;var C=me.nextSibling,ze=C.firstChild,De=ze.nextSibling,se=De.firstChild,xe=se.nextSibling,fe=xe.nextSibling,oe=C.nextSibling,Me=oe.firstChild,ve=Me.nextSibling,pe=oe.nextSibling,we=pe.firstChild,$e=we.nextSibling,ye=pe.nextSibling,Re=ye.firstChild,Se=Re.nextSibling,ie=Se.firstChild,L=ie.nextSibling,t=L.nextSibling,i=ye.nextSibling,f=i.firstChild,l=f.nextSibling,q=l.firstChild,K=l.nextSibling,Y=i.nextSibling,Ie=Y.firstChild,Q=Ie.nextSibling,Te=Q.firstChild,ke=Te.nextSibling,rt=ke.nextSibling,at=rt.nextSibling,st=at.nextSibling,Fe=st.nextSibling,dt=Fe.nextSibling,ct=dt.nextSibling,gt=ct.nextSibling,We=gt.nextSibling,ut=We.nextSibling,Ae=ut.nextSibling,ft=Ae.nextSibling,ht=ft.nextSibling;ht.nextSibling;var Oe=Q.nextSibling,bt=Oe.firstChild,Ce=bt.nextSibling,mt=Oe.nextSibling;return v.$$input=o=>e.onWsUrlChange(o.currentTarget.value),a(A,()=>e.connectionStatus),B(h,"click",e.onConnect),B(c,"click",e.onDisconnect),B(m,"click",e.onToggleAutoConnect),a(m,()=>e.autoConnect?"ON":"OFF"),B(N,"click",e.onToggleAutoRefresh),a(N,()=>e.autoRefresh?"ON":"OFF"),B(ge,"click",e.onRefresh),a(T,$(G,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var o=Tt(),F=o.firstChild,te=F.firstChild,j=te.nextSibling;return j.nextSibling,B(F,"click",e.onApplyPendingUpdates),a(F,()=>e.pendingUpdatesCount,j),o}}),null),ae.addEventListener("change",o=>e.onFilterChange("mime",o.currentTarget.value)),a(ae,$(ne,{get each(){return e.mimeCategories},children:o=>(()=>{var F=je();return F.value=o,a(F,o),F})()}),null),J.addEventListener("change",o=>e.onFilterChange("blobType",o.currentTarget.value)),a(J,$(ne,{get each(){return e.blobTypes},children:o=>(()=>{var F=je();return F.value=o,a(F,o),F})()}),null),se.$$input=o=>e.onFilterChange("minSize",parseInt(o.currentTarget.value)||0),fe.$$input=o=>e.onFilterChange("maxSize",parseInt(o.currentTarget.value)||1e8),ve.addEventListener("change",o=>e.onFilterChange("hasParent",o.currentTarget.value)),$e.addEventListener("change",o=>e.onFilterChange("hasLocalPath",o.currentTarget.value)),ie.$$click=()=>e.onViewModeChange("compact"),L.$$click=()=>e.onViewModeChange("default"),t.$$click=()=>e.onViewModeChange("detailed"),l.$$click=()=>s(!n()),a(l,()=>n()?"Hide":"Show",q),a(K,$(ne,{each:g,children:o=>(()=>{var F=Et(),te=F.firstChild,j=te.firstChild,le=j.nextSibling;return j.addEventListener("change",()=>e.onColumnToggle(o.key)),a(le,()=>o.title),R(()=>j.checked=e.columnVisibility[o.key]),F})()})),a(Q,()=>e.totalCount,ke),a(Q,()=>e.filteredCount,Fe),a(Q,()=>e.sortConfig.field,We),a(Q,()=>e.sortConfig.direction,Ae),a(Q,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),B(Ce,"click",e.onToggleDebug),a(Ce,()=>e.debug?"ON":"OFF"),B(mt,"click",e.onReset),a(E,$(G,{get when(){return e.debug&&e.logs.length>0},get children(){var o=Pt(),F=o.firstChild,te=F.nextSibling;return a(te,$(ne,{get each(){return e.logs},children:j=>(()=>{var le=Ft();return a(le,j),le})()})),o}}),null),R(o=>{var F=p(e.connectionStatus),te=e.connectionStatus==="Connected",j=e.connectionStatus==="Disconnected",le=`toggle-button ${e.autoConnect?"active":""}`,xt=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Ue=`toggle-button ${e.autoRefresh?"active":""}`,vt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Be=`view-mode-button ${e.viewMode==="compact"?"active":""}`,pt=`
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
            `,Ne=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,$t=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Ve=`toggle-button ${n()?"active":""}`,yt=`
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
          `,qe=`column-settings ${n()?"":"collapsed"}`,St=`
            max-height: ${n()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,Ke=`toggle-button ${e.debug?"active":""}`,kt=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return o.e=D(A,F,o.e),te!==o.t&&(h.disabled=o.t=te),j!==o.a&&(c.disabled=o.a=j),le!==o.o&&U(m,o.o=le),o.i=D(m,xt,o.i),Ue!==o.n&&U(N,o.n=Ue),o.s=D(N,vt,o.s),Be!==o.h&&U(ie,o.h=Be),o.r=D(ie,pt,o.r),He!==o.d&&U(L,o.d=He),o.l=D(L,wt,o.l),Ne!==o.u&&U(t,o.u=Ne),o.c=D(t,$t,o.c),Ve!==o.w&&U(l,o.w=Ve),o.m=D(l,yt,o.m),qe!==o.f&&U(K,o.f=qe),o.y=D(K,St,o.y),Ke!==o.g&&U(Ce,o.g=Ke),o.p=D(Ce,kt,o.p),o},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),R(()=>v.value=e.wsUrl),R(()=>ae.value=e.filterConfig.mime),R(()=>J.value=e.filterConfig.blobType),R(()=>se.value=e.filterConfig.minSize),R(()=>fe.value=e.filterConfig.maxSize),R(()=>ve.value=e.filterConfig.hasParent),R(()=>$e.value=e.filterConfig.hasLocalPath),E})()})(),_),a(r,$(nt,{position:"left",get isDragging(){return d.isDragging()},onMouseDown:I=>d.handleMouseDown(I,"right")}),_),R(I=>{var E=`filter-panel ${e.isOpen?"":"collapsed"} ${d.isDragging()?"resizing":""}`,O=`
        width: ${e.isOpen?d.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return E!==I.e&&U(r,I.e=E),I.t=D(r,O,I.t),I},{e:void 0,t:void 0}),r})()}re(["click","input"]);var At=S(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function Xe(e){const[n,s]=x(!1);return $(G,{get when(){return e.isVisible},get children(){var d=At(),g=d.firstChild,p=g.nextSibling;return d.addEventListener("mouseleave",()=>s(!1)),d.addEventListener("mouseenter",()=>s(!0)),B(d,"click",e.onClick),a(g,()=>e.position==="left"?"→":"←"),a(p,()=>e.panelName),R(r=>{var b=`edge-toggle-button edge-toggle-${e.position}`,k=`Show ${e.panelName} panel`,P=`
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
        `,_=`
            opacity: ${n()?"1":"0"};
            transform: translateY(${n()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return b!==r.e&&U(d,r.e=b),k!==r.t&&et(d,"title",r.t=k),r.a=D(d,P,r.a),r.o=D(g,_,r.o),r},{e:void 0,t:void 0,a:void 0,o:void 0}),d}})}re(["click"]);var Ot=S('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),Ut=S('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),Bt=S('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),Ht=S(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function Nt(e){return $(G,{get when(){return e.selectedCount>1},get children(){var n=Ht(),s=n.firstChild,d=s.firstChild,g=d.nextSibling;g.nextSibling;var p=s.nextSibling;return a(s,()=>e.selectedCount,d),a(s,()=>e.selectedCount===1?"":"s",g),a(n,$(G,{get when(){return e.onDownload},get children(){var r=Ot();return B(r,"click",e.onDownload),r}}),p),a(n,$(G,{get when(){return e.onMore},get children(){var r=Ut();return B(r,"click",e.onMore),r}}),p),a(n,$(G,{get when(){return e.onClear},get children(){var r=Bt();return B(r,"click",e.onClear),r}}),p),R(()=>U(n,`selection-toolbar ${e.className||""}`)),n}})}re(["click"]);function Vt(e={}){const[n,s]=x(e.initialSelection||new Set),[d,g]=x(-1),[p,r]=x(!1),[b,k]=x(null),[P,_]=x(null),I=c=>{s(M=>{const u=new Set(M);return u.has(c)?u.delete(c):u.add(c),u})},E=(c,M,u)=>{const m=Math.min(c,M),T=Math.max(c,M),y=u.slice(m,T+1);s(X=>{const N=new Set(X);return y.forEach(ge=>N.add(ge.id)),N})},O=()=>{s(new Set),g(-1)},H=c=>{const M=new Set(c.map(u=>u.id));s(M)},v=c=>n().has(c),z=(c,M,u)=>{const m=c.id;u.metaKey||u.ctrlKey?(I(m),g(M)):u.shiftKey&&d()>=0?(u.preventDefault(),g(M)):(s(new Set([m])),g(M))},W=(c,M,u)=>{u.button===0&&!u.metaKey&&!u.ctrlKey&&!u.shiftKey&&(k({x:u.clientX,y:u.clientY,startIndex:M}),r(!0))},A=c=>{c.key==="Escape"?O():c.key==="a"&&(c.metaKey||c.ctrlKey)?c.preventDefault():(c.key==="Delete"||c.key==="Backspace")&&n().size>0&&e.onDelete?.(n())},w=c=>{p()&&b()&&_({x:c.clientX,y:c.clientY,endIndex:-1})},h=()=>{p()&&(r(!1),k(null),_(null))};return he(()=>{document.addEventListener("mousemove",w),document.addEventListener("mouseup",h),document.addEventListener("keydown",A)}),Le(()=>{document.removeEventListener("mousemove",w),document.removeEventListener("mouseup",h),document.removeEventListener("keydown",A),document.body.classList.remove("drag-selecting")}),Ye(()=>{p()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")}),Ye(()=>{const c=n();e.onSelectionChange?.(c),e.saveToStorage?.(c)}),{selectedItems:n,setSelectedItems:s,lastSelectedIndex:d,setLastSelectedIndex:g,isDragSelecting:p,setIsDragSelecting:r,dragStart:b,setDragStart:k,dragEnd:P,setDragEnd:_,toggleSelection:I,selectRange:E,clearSelection:O,selectAll:H,isSelected:v,handleRowClick:z,handleRowMouseDown:W,handleKeyDown:A}}const V={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function qt(e){const[n,s]=x(e.initialSort||{field:"id",direction:"asc"}),[d,g]=x(new Set),[p,r]=x(!1),b=e.getItemId||(v=>v.id||String(v)),k=ee(()=>{const v=n();return[...e.data].sort((W,A)=>{const w=W[v.field],h=A[v.field];let c=0;return w<h?c=-1:w>h&&(c=1),v.direction==="desc"?c*-1:c})});return{sortConfig:n,selectedItems:d,isDragSelecting:p,sortedData:k,handleSort:v=>{const z=n(),W=z.field===v&&z.direction==="asc"?"desc":"asc";s({field:v,direction:W})},toggleSelection:v=>{const z=new Set(d());z.has(v)?z.delete(v):z.add(v),g(z)},clearSelection:()=>{g(new Set)},selectAll:()=>{const v=new Set(e.data.map(b));g(v)},isSelected:v=>d().has(v),selectRange:(v,z)=>{const W=new Set(d()),A=Math.min(v,z),w=Math.max(v,z);for(let h=A;h<=w;h++)if(h<e.data.length&&e.data[h]!=null){const c=b(e.data[h]);W.add(c)}g(W)},setIsDragSelecting:r,getItemId:b}}var it=S("<div>"),Kt=S("<div class=grid-cell>"),Ge=S("<div class=grid-content>"),Yt=S("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),jt=S("<span style=font-size:12px;>"),Xt=S("<div><span>");function Je(e){let n;return he(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var s=it();s.$$contextmenu=g=>e.onContextMenu?.(e.item,e.index,g),s.$$mousedown=g=>e.onRowMouseDown?.(e.item,e.index,g),s.$$dblclick=g=>e.onRowDoubleClick?.(e.item,e.index,g),s.$$click=g=>e.onRowClick?.(e.item,e.index,g);var d=n;return typeof d=="function"?tt(d,s):n=s,a(s,$(ne,{get each(){return e.columns},children:g=>(()=>{var p=Kt();return a(p,(()=>{var r=ce(()=>!!g.render);return()=>r()?g.render(e.item,e.index):String(e.item[g.key]||"")})()),R(r=>D(p,`
              flex: ${g.width?"0 0 "+g.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,r)),p})()})),R(g=>{var p=`grid-row ${e.isSelected?"selected":""}`,r=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${V.colors.border};
        background: ${e.isSelected?V.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease;
      `;return p!==g.e&&U(s,g.e=p),g.t=D(s,r,g.t),g},{e:void 0,t:void 0}),s})()}function Gt(e){const[n,s]=x(),[d,g]=x(0),[p,r]=x(0),b=e.rowHeight||50,k=e.headerHeight||60,P=e.virtualizeThreshold||100,_=qt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),I=(w,h,c)=>{e.onRowClick?.(w,h,c)},E=(w,h,c)=>{e.onRowDoubleClick?.(w,h,c)},O=(w,h,c)=>{e.onRowMouseDown?.(w,h,c)},H=ee(()=>e.data.length>P),v=ee(()=>{if(!H())return e.data.map((y,X)=>({item:y,index:X}));if(!n())return[];const h=b,c=d(),M=p(),u=Math.floor(c/h),m=Math.min(e.data.length-1,Math.ceil((c+M)/h)+5),T=[];for(let y=Math.max(0,u-5);y<=m;y++)y<e.data.length&&e.data[y]!=null&&T.push({item:e.data[y],index:y});return T}),z=ee(()=>e.data.length*b),W=w=>{const h=w.target;g(h.scrollTop)},A=w=>{if(_.handleSort(w),e.onSort){const h=_.sortConfig();e.onSort(h.field,h.direction)}};return he(()=>{const w=n();if(!w)return;const h=new ResizeObserver(c=>{for(const M of c)r(M.contentRect.height)});h.observe(w),Le(()=>{h.disconnect()})}),(()=>{var w=Yt(),h=w.firstChild,c=h.nextSibling,M=c.nextSibling;return a(h,$(ne,{get each(){return e.columns},children:u=>(()=>{var m=Xt(),T=m.firstChild;return m.$$click=()=>u.sortable&&A(u.key),a(T,()=>u.title),a(m,$(G,{get when(){return ce(()=>!!u.sortable)()&&_.sortConfig().field===u.key},get children(){var y=jt();return a(y,()=>_.sortConfig().direction==="asc"?"↑":"↓"),y}}),null),R(y=>{var X=`grid-header-cell ${u.sortable?"sortable":""}`,N=`
                flex: ${u.width?"0 0 "+u.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${u.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return X!==y.e&&U(m,y.e=X),y.t=D(m,N,y.t),y},{e:void 0,t:void 0}),m})()})),c.addEventListener("scroll",W),tt(s,c),a(c,$(G,{get when(){return H()},get fallback(){return(()=>{var u=Ge();return a(u,$(ne,{get each(){return e.data},children:(m,T)=>$(Je,{item:m,get index(){return T()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(m)||m.id)||!1},onRowClick:I,onRowDoubleClick:E,onRowMouseDown:O,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:b})})),u})()},get children(){var u=Ge();return a(u,$(ne,{get each(){return v()},children:m=>(()=>{var T=it();return a(T,$(Je,{get item(){return m.item},get index(){return m.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(m.item)||m.item.id)||!1},onRowClick:I,onRowDoubleClick:E,onRowMouseDown:O,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:b})),R(y=>D(T,`
                    position: absolute;
                    top: ${m.index*b}px;
                    left: 0;
                    right: 0;
                  `,y)),T})()})),R(m=>D(u,`height: ${z()}px; position: relative;`,m)),u}})),a(M,()=>`
        .grid-row:hover:not(.selected) {
          background: ${V.colors.hover};
        }

        .grid-row.selected {
          background: ${V.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${V.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${V.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${V.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${V.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }
      `),R(u=>{var m=`infinite-data-grid ${e.className||""}`,T=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${V.colors.background};
        color: ${V.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,y=`
          height: ${k}px;
          display: flex;
          align-items: center;
          background: ${V.colors.header};
          border-bottom: 2px solid ${V.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return m!==u.e&&U(w,u.e=m),u.t=D(w,T,u.t),u.a=D(h,y,u.a),u},{e:void 0,t:void 0,a:void 0}),w})()}re(["click","dblclick","mousedown","contextmenu"]);function Jt(e){if(e===0)return"0 B";const n=1024,s=["B","KB","MB","GB","TB","PB"],d=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,d)).toFixed(2))+" "+s[d]}var Qt=S("<div style=width:40px;height:40px;border-radius:4px;overflow:hidden;background:#333;display:flex;align-items:center;justify-content:center;font-size:12px;>"),Zt=S("<span style=font-weight:500;>"),de=S("<span>"),en=S("<span style=font-family:monospace;font-size:12px;>"),tn=S('<button style="background:#ff00ff;border:none;color:#000000;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⋯'),nn=S("<div>"),on=S(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
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
      `);const Ee="freqhole-demo-state",Qe=300;function lt(){try{const e=localStorage.getItem(Ee);return e?JSON.parse(e):{}}catch{return{}}}function Z(e){try{const s={...lt(),...e};localStorage.setItem(Ee,JSON.stringify(s))}catch{}}function ln(e){const n=lt(),[s,d]=x([]),[g,p]=x({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[r,b]=x({field:"created_at",direction:"desc",...n.sortConfig||{}}),[k,P]=x(n.viewMode||"default"),[_,I]=x({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[E,O]=x(n.isFilterPanelOpen??!0),[H,v]=x(n.filterPanelWidth||Qe),[z,W]=x(n.isBrowsePanelOpen??!0),[A,w]=x(n.browsePanelWidth||Qe),[h,c]=x(e.wsUrl),[M,u]=x(e.autoConnect),[m,T]=x(!0),[y,X]=x(!1),[N,ge]=x([]),[be,ue]=x("Disconnected"),[ae,me]=x(!1),[_e,J]=x(null),C=Vt({onSelectionChange:t=>{Z({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),ze=(t,i,f)=>{f.shiftKey&&C.lastSelectedIndex()>=0?(f.preventDefault(),C.selectRange(C.lastSelectedIndex(),i,oe())):C.handleRowClick(t,i,f)},De=t=>{console.log("Double-clicked:",t.id)},se=t=>{t.key==="a"&&(t.metaKey||t.ctrlKey)?(t.preventDefault(),C.selectAll(oe())):C.handleKeyDown(t)},xe=t=>{if(C.isDragSelecting()&&C.dragStart()){C.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const i=C.dragStart(),f=Math.floor((t.clientY-i.y)/60);if(f!==i.startIndex){const l=Math.min(i.startIndex,i.startIndex+f),q=Math.max(i.startIndex,i.startIndex+f);C.selectRange(l,q,oe())}}};he(()=>{document.addEventListener("mousemove",xe),document.addEventListener("keydown",se)}),Le(()=>{document.removeEventListener("mousemove",xe),document.removeEventListener("keydown",se)});const fe=ee(()=>{const t=g();return s().filter(i=>{if(t.name&&!Pe(i).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!i.mime?.startsWith(t.mime)||t.blobType&&i.blob_type!==t.blobType||i.size<t.minSize||i.size>t.maxSize)return!1;if(t.hasParent!=="all"){const f=!!i.parent_id;if(t.hasParent==="yes"&&!f||t.hasParent==="no"&&f)return!1}if(t.hasLocalPath!=="all"){const f=!!i.local_path;if(t.hasLocalPath==="yes"&&!f||t.hasLocalPath==="no"&&f)return!1}return!0})}),oe=ee(()=>{const t=r();return[...fe()].sort((f,l)=>{const q=f[t.field],K=l[t.field];let Y=0;return q<K?Y=-1:q>K&&(Y=1),t.direction==="desc"?Y*-1:Y})}),Me=ee(()=>{const t=_(),i=[];return t.thumbnail&&i.push({key:"thumbnail",title:"📷",width:60,render:f=>(()=>{var l=Qt();return a(l,()=>_t(f.mime)),l})()}),t.name&&i.push({key:"name",title:"Name",width:250,sortable:!0,render:f=>(()=>{var l=Zt();return a(l,()=>Pe(f)),R(()=>et(l,"title",Pe(f))),l})()}),t.blob_type&&i.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.mime&&i.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:f=>(()=>{var l=de();return a(l,()=>f.mime||"unknown"),l})()}),t.id&&i.push({key:"id",title:"ID",width:200,sortable:!0,render:f=>(()=>{var l=en();return a(l,()=>f.id),l})()}),t.size&&i.push({key:"size",title:"Size",width:100,sortable:!0,render:f=>(()=>{var l=de();return a(l,()=>Jt(f.size)),l})()}),t.parent_id&&i.push({key:"parent_id",title:"Parent",width:120,render:f=>(()=>{var l=de();return a(l,()=>f.parent_id?"Yes":"No"),l})()}),t.local_path&&i.push({key:"local_path",title:"Local Path",width:200,render:f=>(()=>{var l=de();return a(l,()=>f.local_path||"None"),l})()}),t.created_at&&i.push({key:"created_at",title:"Created",width:140,sortable:!0,render:f=>(()=>{var l=de();return a(l,()=>new Date(f.created_at).toLocaleString()),l})()}),t.updated_at&&i.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:f=>(()=>{var l=de();return a(l,()=>new Date(f.updated_at).toLocaleString()),l})()}),t.actions&&i.push({key:"actions",title:"Actions",width:100,render:f=>(()=>{var l=tn();return l.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${f.id}`,"_blank"),l})()}),i}),ve=ee(()=>[...new Set(s().map(i=>i.mime?.split("/")[0]).filter(Boolean))].sort()),pe=ee(()=>[...new Set(s().map(i=>i.blob_type))].sort()),we=(t,i)=>{p(f=>({...f,[t]:i})),Z({filterConfig:{...g(),[t]:i}})},$e=(t,i)=>{b({field:t,direction:i}),Z({sortConfig:{field:t,direction:i}})},ye=t=>{P(t),Z({viewMode:t})},Re=t=>{I(i=>{const f={...i,[t]:!i[t]};return Z({columnVisibility:f}),f})},Se=()=>{W(t=>{const i=!t;return Z({isBrowsePanelOpen:i}),i})},ie=()=>{O(t=>{const i=!t;return Z({isFilterPanelOpen:i}),i})},L=t=>{const i=new Date().toLocaleTimeString();ge(f=>[`${i}: ${t}`,...f.slice(0,49)])};return he(async()=>{L("🚀 FreqholeDemo mounted");try{const t=await fetch(`${e.apiBaseUrl}/api/blobs`);if(t.ok){const i=await t.json();d(i),J(new Date),L(`📦 Loaded ${i.length} media blobs`)}else L("⚠️ Using mock data (server not available)"),d(Ze()),J(new Date)}catch{L("⚠️ Using mock data (server error)"),d(Ze()),J(new Date)}e.autoConnect&&(ue("Connected"),L("🔌 Auto-connected to WebSocket"))}),(()=>{var t=on(),i=t.firstChild,f=i.nextSibling;return a(t,$(Rt,{get isOpen(){return z()},get filterConfig(){return g()},onTogglePanel:Se,onFilterChange:we,onWidthChange:l=>{w(l),Z({browsePanelWidth:l})},get initialWidth(){return A()}}),i),a(t,$(Nt,{get selectedCount(){return C.selectedItems().size},onDownload:()=>{console.log("Bulk download:",C.selectedItems().size,"items")},get onClear(){return C.clearSelection},onMore:()=>{console.log("Show bulk actions menu")}}),i),a(i,$(Gt,{get data(){return oe()},get columns(){return Me()},onSort:$e,get sortField(){return r().field},get sortDirection(){return r().direction},get rowHeight(){return ce(()=>k()==="compact")()?40:k()==="detailed"?80:60},headerHeight:60,getItemId:l=>l.id,get selectedItems(){return C.selectedItems()},onRowClick:ze,onRowDoubleClick:De,get onRowMouseDown(){return C.handleRowMouseDown},get isDragSelecting(){return C.isDragSelecting()}})),a(t,$(Xe,{get isVisible(){return!z()},position:"left",panelName:"Browse",onClick:Se}),f),a(t,$(Xe,{get isVisible(){return!E()},position:"right",panelName:"Controls",onClick:ie}),f),a(t,$(G,{get when(){return ce(()=>!!(C.isDragSelecting()&&C.dragStart()))()&&C.dragEnd()},get children(){var l=nn();return R(q=>D(l,(()=>{const K=C.dragStart(),Y=C.dragEnd(),Ie=Math.min(K.x,Y.x),Q=Math.min(K.y,Y.y),Te=Math.abs(Y.x-K.x),ke=Math.abs(Y.y-K.y);return`
              position: fixed;
              left: ${Ie}px;
              top: ${Q}px;
              width: ${Te}px;
              height: ${ke}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),q)),l}}),f),a(t,$(Wt,{get isOpen(){return E()},get filterConfig(){return g()},get viewMode(){return k()},get columnVisibility(){return _()},get wsUrl(){return h()},get autoConnect(){return M()},get autoRefresh(){return m()},get debug(){return y()},get connectionStatus(){return be()},get hasPendingUpdates(){return ae()},pendingUpdatesCount:0,get filteredCount(){return fe().length},get totalCount(){return s().length},get sortConfig(){return r()},get lastUpdated(){return _e()},get mimeCategories(){return ve()},get blobTypes(){return pe()},get logs(){return N()},onTogglePanel:ie,onFilterChange:we,onViewModeChange:ye,onColumnToggle:Re,onWsUrlChange:c,onConnect:()=>{ue("Connected"),L("🔌 Connected to WebSocket")},onDisconnect:()=>{ue("Disconnected"),L("🔌 Disconnected from WebSocket")},onRefresh:async()=>{L("🔄 Refreshing data...");try{const l=await fetch(`${e.apiBaseUrl}/api/blobs`);if(l.ok){const q=await l.json();d(q),J(new Date),L(`📦 Refreshed ${q.length} media blobs`)}}catch{L("❌ Refresh failed")}},onApplyPendingUpdates:()=>{me(!1),L("📥 Applied pending updates")},onToggleAutoConnect:()=>{u(l=>!l),L(`🔧 Auto-connect: ${M()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{T(l=>!l),L(`🔧 Auto-refresh: ${m()?"OFF":"ON"}`)},onToggleDebug:()=>{X(l=>!l),L(`🐛 Debug: ${y()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Ee),window.location.reload())},onWidthChange:l=>{v(l),Z({filterPanelWidth:l})},get initialWidth(){return H()}}),f),t})()}function Ze(){const e=["image/jpeg","image/png","video/mp4","audio/mp3","text/plain","application/pdf"],n=["upload","thumbnail","processed","backup"];return Array.from({length:1e3},(s,d)=>({id:`blob-${d+1}`,mime:e[Math.floor(Math.random()*e.length)],blob_type:n[Math.floor(Math.random()*n.length)],size:Math.floor(Math.random()*1e7),parent_id:Math.random()>.7?`blob-${Math.floor(Math.random()*d)+1}`:void 0,local_path:Math.random()>.5?`/path/to/file-${d+1}.ext`:void 0,created_at:new Date(Date.now()-Math.random()*864e5*30).toISOString(),updated_at:new Date(Date.now()-Math.random()*864e5*7).toISOString()}))}re(["click"]);class rn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",s=this.getAttribute("api-base-url")||"http://localhost:8080",d=this.getAttribute("auto-connect")==="true";this.dispose=Ct(()=>$(ln,{wsUrl:n,apiBaseUrl:s,autoConnect:d}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",rn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
