import{d as ae,c as x,t as S,a as U,b as I,e as B,s as D,i as a,m as ne,f as w,S as G,F as oe,g as yt,o as he,h as Pe,j as Ke,k as ee,u as Ze,r as St}from"./web-xBr4R5eT.js";var Ct=S(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function et(e){const[n,d]=x(!1);return(()=>{var s=Ct(),g=s.firstChild,$=g.nextSibling;return s.addEventListener("mouseleave",()=>d(!1)),s.addEventListener("mouseenter",()=>d(!0)),U(s,"mousedown",e.onMouseDown),I(l=>{var b=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,C=`
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
        `;return b!==l.e&&B(s,l.e=b),l.t=D(s,C,l.t),l.a=D(g,P,l.a),l.o=D($,_,l.o),l},{e:void 0,t:void 0,a:void 0,o:void 0}),s})()}ae(["mousedown"]);function tt(e){const[n,d]=x(e.initialWidth),[s,g]=x(!1),$=e.minWidth||250,l=e.maxWidth||600,b=e.closeThreshold||100;return{width:n,setWidth:d,isDragging:s,handleMouseDown:(P,_="right")=>{P.preventDefault(),g(!0),document.body.classList.add("resizing");const R=P.clientX,E=n(),O=v=>{const z=v.clientX-R,W=_==="right"?E-z:E+z;if(W<b){e.onClose?.();return}const A=Math.max($,Math.min(l,W));d(A),e.onWidthChange?.(A)},V=()=>{g(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",O),document.removeEventListener("mouseup",V)};document.addEventListener("mousemove",O),document.addEventListener("mouseup",V)}}}var kt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),_t=S('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function zt(e){const n=tt({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var d=kt(),s=d.firstChild,g=s.firstChild,$=g.nextSibling,l=s.nextSibling;return U($,"click",e.onTogglePanel),a(d,(()=>{var b=ne(()=>!!e.isOpen);return()=>b()&&(()=>{var C=_t(),P=C.firstChild,_=P.nextSibling;return _.$$input=R=>e.onFilterChange("name",R.currentTarget.value),I(()=>_.value=e.filterConfig.name),C})()})(),l),a(d,w(et,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:b=>n.handleMouseDown(b,"left")}),l),I(b=>{var C=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,P=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return C!==b.e&&B(d,b.e=C),b.t=D(d,P,b.t),b},{e:void 0,t:void 0}),d})()}ae(["click","input"]);var Dt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Mt=S('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Rt=S('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),It=S('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),Ye=S("<option>"),Tt=S("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Pt=S("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Lt(e){const[n,d]=x(!1),s=tt({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),g=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],$=l=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[l]||"color: #6b7280;";return(()=>{var l=Dt(),b=l.firstChild,C=b.firstChild,P=C.nextSibling,_=b.nextSibling;return U(P,"click",e.onTogglePanel),a(l,(()=>{var R=ne(()=>!!e.isOpen);return()=>R()&&(()=>{var E=It(),O=E.firstChild,V=O.firstChild,v=V.nextSibling,z=v.nextSibling,W=z.firstChild,A=W.nextSibling,p=z.nextSibling,h=p.firstChild,c=h.nextSibling,M=p.nextSibling,f=M.firstChild,m=f.nextSibling,T=O.nextSibling,y=T.firstChild,X=y.nextSibling,N=X.firstChild,ge=N.nextSibling,be=T.nextSibling,fe=be.firstChild,se=fe.nextSibling;se.firstChild;var me=be.nextSibling,_e=me.firstChild,J=_e.nextSibling;J.firstChild;var k=me.nextSibling,ze=k.firstChild,De=ze.nextSibling,de=De.firstChild,xe=de.nextSibling,ue=xe.nextSibling,ie=k.nextSibling,Me=ie.firstChild,ve=Me.nextSibling,pe=ie.nextSibling,we=pe.firstChild,$e=we.nextSibling,ye=pe.nextSibling,Re=ye.firstChild,Se=Re.nextSibling,le=Se.firstChild,L=le.nextSibling,t=L.nextSibling,i=ye.nextSibling,u=i.firstChild,r=u.nextSibling,H=r.firstChild,q=r.nextSibling,K=i.nextSibling,Ie=K.firstChild,Q=Ie.nextSibling,Te=Q.firstChild,Ce=Te.nextSibling,ot=Ce.nextSibling,it=ot.nextSibling,lt=it.nextSibling,Ee=lt.nextSibling,rt=Ee.nextSibling,at=rt.nextSibling,st=at.nextSibling,Fe=st.nextSibling,dt=Fe.nextSibling,We=dt.nextSibling,ct=We.nextSibling,gt=ct.nextSibling;gt.nextSibling;var Ae=Q.nextSibling,ft=Ae.firstChild,ke=ft.nextSibling,ut=Ae.nextSibling;return v.$$input=o=>e.onWsUrlChange(o.currentTarget.value),a(A,()=>e.connectionStatus),U(h,"click",e.onConnect),U(c,"click",e.onDisconnect),U(m,"click",e.onToggleAutoConnect),a(m,()=>e.autoConnect?"ON":"OFF"),U(N,"click",e.onToggleAutoRefresh),a(N,()=>e.autoRefresh?"ON":"OFF"),U(ge,"click",e.onRefresh),a(T,w(G,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var o=Mt(),F=o.firstChild,te=F.firstChild,Y=te.nextSibling;return Y.nextSibling,U(F,"click",e.onApplyPendingUpdates),a(F,()=>e.pendingUpdatesCount,Y),o}}),null),se.addEventListener("change",o=>e.onFilterChange("mime",o.currentTarget.value)),a(se,w(oe,{get each(){return e.mimeCategories},children:o=>(()=>{var F=Ye();return F.value=o,a(F,o),F})()}),null),J.addEventListener("change",o=>e.onFilterChange("blobType",o.currentTarget.value)),a(J,w(oe,{get each(){return e.blobTypes},children:o=>(()=>{var F=Ye();return F.value=o,a(F,o),F})()}),null),de.$$input=o=>e.onFilterChange("minSize",parseInt(o.currentTarget.value)||0),ue.$$input=o=>e.onFilterChange("maxSize",parseInt(o.currentTarget.value)||1e8),ve.addEventListener("change",o=>e.onFilterChange("hasParent",o.currentTarget.value)),$e.addEventListener("change",o=>e.onFilterChange("hasLocalPath",o.currentTarget.value)),le.$$click=()=>e.onViewModeChange("compact"),L.$$click=()=>e.onViewModeChange("default"),t.$$click=()=>e.onViewModeChange("detailed"),r.$$click=()=>d(!n()),a(r,()=>n()?"Hide":"Show",H),a(q,w(oe,{each:g,children:o=>(()=>{var F=Tt(),te=F.firstChild,Y=te.firstChild,re=Y.nextSibling;return Y.addEventListener("change",()=>e.onColumnToggle(o.key)),a(re,()=>o.title),I(()=>Y.checked=e.columnVisibility[o.key]),F})()})),a(Q,()=>e.totalCount,Ce),a(Q,()=>e.filteredCount,Ee),a(Q,()=>e.sortConfig.field,Fe),a(Q,()=>e.sortConfig.direction,We),a(Q,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),U(ke,"click",e.onToggleDebug),a(ke,()=>e.debug?"ON":"OFF"),U(ut,"click",e.onReset),a(E,w(G,{get when(){return e.debug&&e.logs.length>0},get children(){var o=Rt(),F=o.firstChild,te=F.nextSibling;return a(te,w(oe,{get each(){return e.logs},children:Y=>(()=>{var re=Pt();return a(re,Y),re})()})),o}}),null),I(o=>{var F=$(e.connectionStatus),te=e.connectionStatus==="Connected",Y=e.connectionStatus==="Disconnected",re=`toggle-button ${e.autoConnect?"active":""}`,ht=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Oe=`toggle-button ${e.autoRefresh?"active":""}`,bt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Ue=`view-mode-button ${e.viewMode==="compact"?"active":""}`,mt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="compact"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="compact"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="compact"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Be=`view-mode-button ${e.viewMode==="default"?"active":""}`,xt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="default"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="default"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="default"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,He=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,vt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Ve=`toggle-button ${n()?"active":""}`,pt=`
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
          `,Ne=`column-settings ${n()?"":"collapsed"}`,wt=`
            max-height: ${n()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,qe=`toggle-button ${e.debug?"active":""}`,$t=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return o.e=D(A,F,o.e),te!==o.t&&(h.disabled=o.t=te),Y!==o.a&&(c.disabled=o.a=Y),re!==o.o&&B(m,o.o=re),o.i=D(m,ht,o.i),Oe!==o.n&&B(N,o.n=Oe),o.s=D(N,bt,o.s),Ue!==o.h&&B(le,o.h=Ue),o.r=D(le,mt,o.r),Be!==o.d&&B(L,o.d=Be),o.l=D(L,xt,o.l),He!==o.u&&B(t,o.u=He),o.c=D(t,vt,o.c),Ve!==o.w&&B(r,o.w=Ve),o.m=D(r,pt,o.m),Ne!==o.f&&B(q,o.f=Ne),o.y=D(q,wt,o.y),qe!==o.g&&B(ke,o.g=qe),o.p=D(ke,$t,o.p),o},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),I(()=>v.value=e.wsUrl),I(()=>se.value=e.filterConfig.mime),I(()=>J.value=e.filterConfig.blobType),I(()=>de.value=e.filterConfig.minSize),I(()=>ue.value=e.filterConfig.maxSize),I(()=>ve.value=e.filterConfig.hasParent),I(()=>$e.value=e.filterConfig.hasLocalPath),E})()})(),_),a(l,w(et,{position:"left",get isDragging(){return s.isDragging()},onMouseDown:R=>s.handleMouseDown(R,"right")}),_),I(R=>{var E=`filter-panel ${e.isOpen?"":"collapsed"} ${s.isDragging()?"resizing":""}`,O=`
        width: ${e.isOpen?s.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return E!==R.e&&B(l,R.e=E),R.t=D(l,O,R.t),R},{e:void 0,t:void 0}),l})()}ae(["click","input"]);var Et=S(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function Xe(e){const[n,d]=x(!1);return w(G,{get when(){return e.isVisible},get children(){var s=Et(),g=s.firstChild,$=g.nextSibling;return s.addEventListener("mouseleave",()=>d(!1)),s.addEventListener("mouseenter",()=>d(!0)),U(s,"click",e.onClick),a(g,()=>e.position==="left"?"→":"←"),a($,()=>e.panelName),I(l=>{var b=`edge-toggle-button edge-toggle-${e.position}`,C=`Show ${e.panelName} panel`,P=`
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
          `;return b!==l.e&&B(s,l.e=b),C!==l.t&&yt(s,"title",l.t=C),l.a=D(s,P,l.a),l.o=D(g,_,l.o),l},{e:void 0,t:void 0,a:void 0,o:void 0}),s}})}ae(["click"]);var Ft=S('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;">📥 Download'),Wt=S('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;">⋯ More'),At=S('<button class="toolbar-button clear"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;">Clear'),Ot=S(`<div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function Ut(e){return w(G,{get when(){return e.selectedCount>0},get children(){var n=Ot(),d=n.firstChild,s=d.firstChild,g=s.nextSibling;g.nextSibling;var $=d.nextSibling;return a(d,()=>e.selectedCount,s),a(d,()=>e.selectedCount===1?"":"s",g),a(n,w(G,{get when(){return e.onDownload},get children(){var l=Ft();return U(l,"click",e.onDownload),l}}),$),a(n,w(G,{get when(){return e.onMore},get children(){var l=Wt();return U(l,"click",e.onMore),l}}),$),a(n,w(G,{get when(){return e.onClear},get children(){var l=At();return U(l,"click",e.onClear),l}}),$),I(()=>B(n,`selection-toolbar ${e.className||""}`)),n}})}ae(["click"]);function Bt(e={}){const[n,d]=x(e.initialSelection||new Set),[s,g]=x(-1),[$,l]=x(!1),[b,C]=x(null),[P,_]=x(null),R=c=>{d(M=>{const f=new Set(M);return f.has(c)?f.delete(c):f.add(c),f})},E=(c,M,f)=>{const m=Math.min(c,M),T=Math.max(c,M),y=f.slice(m,T+1);d(X=>{const N=new Set(X);return y.forEach(ge=>N.add(ge.id)),N})},O=()=>{d(new Set),g(-1)},V=c=>{const M=new Set(c.map(f=>f.id));d(M)},v=c=>n().has(c),z=(c,M,f)=>{const m=c.id;f.metaKey||f.ctrlKey?(R(m),g(M)):(f.shiftKey&&s()>=0||d(new Set([m])),g(M))},W=(c,M,f)=>{f.button===0&&!f.metaKey&&!f.ctrlKey&&!f.shiftKey&&(C({x:f.clientX,y:f.clientY,startIndex:M}),l(!0))},A=c=>{c.key==="Escape"?O():c.key==="a"&&(c.metaKey||c.ctrlKey)?c.preventDefault():(c.key==="Delete"||c.key==="Backspace")&&n().size>0&&e.onDelete?.(n())},p=c=>{$()&&b()&&_({x:c.clientX,y:c.clientY,endIndex:-1})},h=()=>{$()&&(l(!1),C(null),_(null))};return he(()=>{document.addEventListener("mousemove",p),document.addEventListener("mouseup",h),document.addEventListener("keydown",A)}),Pe(()=>{document.removeEventListener("mousemove",p),document.removeEventListener("mouseup",h),document.removeEventListener("keydown",A),document.body.classList.remove("drag-selecting")}),Ke(()=>{$()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")}),Ke(()=>{const c=n();e.onSelectionChange?.(c),e.saveToStorage?.(c)}),{selectedItems:n,setSelectedItems:d,lastSelectedIndex:s,setLastSelectedIndex:g,isDragSelecting:$,setIsDragSelecting:l,dragStart:b,setDragStart:C,dragEnd:P,setDragEnd:_,toggleSelection:R,selectRange:E,clearSelection:O,selectAll:V,isSelected:v,handleRowClick:z,handleRowMouseDown:W,handleKeyDown:A}}const j={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function Ht(e){const[n,d]=x(e.initialSort||{field:"id",direction:"asc"}),[s,g]=x(new Set),[$,l]=x(!1),b=e.getItemId||(v=>v.id||String(v)),C=ee(()=>{const v=n();return[...e.data].sort((W,A)=>{const p=W[v.field],h=A[v.field];let c=0;return p<h?c=-1:p>h&&(c=1),v.direction==="desc"?c*-1:c})});return{sortConfig:n,selectedItems:s,isDragSelecting:$,sortedData:C,handleSort:v=>{const z=n(),W=z.field===v&&z.direction==="asc"?"desc":"asc";d({field:v,direction:W})},toggleSelection:v=>{const z=new Set(s());z.has(v)?z.delete(v):z.add(v),g(z)},clearSelection:()=>{g(new Set)},selectAll:()=>{const v=new Set(e.data.map(b));g(v)},isSelected:v=>s().has(v),selectRange:(v,z)=>{const W=new Set(s()),A=Math.min(v,z),p=Math.max(v,z);for(let h=A;h<=p;h++)if(h<e.data.length&&e.data[h]!=null){const c=b(e.data[h]);W.add(c)}g(W)},setIsDragSelecting:l,getItemId:b}}var Vt=S("<div class=grid-row>"),Nt=S("<div class=grid-cell>"),je=S("<div class=grid-content>"),qt=S("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),Kt=S("<span style=font-size:12px;>"),Yt=S("<div><span>"),Xt=S("<div>");function Ge(e){let n;return he(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var d=Vt();d.$$contextmenu=g=>e.onContextMenu?.(e.item,e.index,g),d.$$mousedown=g=>e.onRowMouseDown?.(e.item,e.index,g),d.$$dblclick=g=>e.onRowDoubleClick?.(e.item,e.index,g),d.$$click=g=>e.onRowClick?.(e.item,e.index,g);var s=n;return typeof s=="function"?Ze(s,d):n=d,a(d,w(oe,{get each(){return e.columns},children:g=>(()=>{var $=Nt();return a($,(()=>{var l=ne(()=>!!g.render);return()=>l()?g.render(e.item,e.index):String(e.item[g.key]||"")})()),I(l=>D($,`
              flex: ${g.width?"0 0 "+g.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,l)),$})()})),I(g=>D(d,`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${j.colors.border};
        background: ${e.isSelected?j.colors.selected:"transparent"};
        transition: background-color 0.15s ease;
      `,g)),d})()}function jt(e){const[n,d]=x(),[s,g]=x(0),[$,l]=x(0),b=e.rowHeight||50,C=e.headerHeight||60,P=e.virtualizeThreshold||100,_=Ht({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),R=(p,h,c)=>{e.onRowClick?.(p,h,c)},E=(p,h,c)=>{e.onRowDoubleClick?.(p,h,c)},O=(p,h,c)=>{e.onRowMouseDown?.(p,h,c)},V=ee(()=>e.data.length>P),v=ee(()=>{if(!V())return e.data.map((y,X)=>({item:y,index:X}));if(!n())return[];const h=b,c=s(),M=$(),f=Math.floor(c/h),m=Math.min(e.data.length-1,Math.ceil((c+M)/h)+5),T=[];for(let y=Math.max(0,f-5);y<=m;y++)y<e.data.length&&e.data[y]!=null&&T.push({item:e.data[y],index:y});return T}),z=ee(()=>e.data.length*b),W=p=>{const h=p.target;g(h.scrollTop)},A=p=>{if(_.handleSort(p),e.onSort){const h=_.sortConfig();e.onSort(h.field,h.direction)}};return he(()=>{const p=n();if(!p)return;const h=new ResizeObserver(c=>{for(const M of c)l(M.contentRect.height)});h.observe(p),Pe(()=>{h.disconnect()})}),(()=>{var p=qt(),h=p.firstChild,c=h.nextSibling,M=c.nextSibling;return a(h,w(oe,{get each(){return e.columns},children:f=>(()=>{var m=Yt(),T=m.firstChild;return m.$$click=()=>f.sortable&&A(f.key),a(T,()=>f.title),a(m,w(G,{get when(){return ne(()=>!!f.sortable)()&&_.sortConfig().field===f.key},get children(){var y=Kt();return a(y,()=>_.sortConfig().direction==="asc"?"↑":"↓"),y}}),null),I(y=>{var X=`grid-header-cell ${f.sortable?"sortable":""}`,N=`
                flex: ${f.width?"0 0 "+f.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${f.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return X!==y.e&&B(m,y.e=X),y.t=D(m,N,y.t),y},{e:void 0,t:void 0}),m})()})),c.addEventListener("scroll",W),Ze(d,c),a(c,w(G,{get when(){return V()},get fallback(){return(()=>{var f=je();return a(f,w(oe,{get each(){return e.data},children:(m,T)=>w(Ge,{item:m,get index(){return T()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(m)||m.id)||!1},onRowClick:R,onRowDoubleClick:E,onRowMouseDown:O,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:b})})),f})()},get children(){var f=je();return a(f,w(oe,{get each(){return v()},children:m=>(()=>{var T=Xt();return a(T,w(Ge,{get item(){return m.item},get index(){return m.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(m.item)||m.item.id)||!1},onRowClick:R,onRowDoubleClick:E,onRowMouseDown:O,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:b})),I(y=>D(T,`
                    position: absolute;
                    top: ${m.index*b}px;
                    left: 0;
                    right: 0;
                  `,y)),T})()})),I(m=>D(f,`height: ${z()}px; position: relative;`,m)),f}})),a(M,()=>`
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
      `),I(f=>{var m=`infinite-data-grid ${e.className||""}`,T=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${j.colors.background};
        color: ${j.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,y=`
          height: ${C}px;
          display: flex;
          align-items: center;
          background: ${j.colors.header};
          border-bottom: 2px solid ${j.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return m!==f.e&&B(p,f.e=m),f.t=D(p,T,f.t),f.a=D(h,y,f.a),f},{e:void 0,t:void 0,a:void 0}),p})()}ae(["click","dblclick","mousedown","contextmenu"]);var Gt=S("<span style=font-family:monospace;font-size:12px;>"),Jt=S("<div style=width:40px;height:40px;border-radius:4px;overflow:hidden;background:#333;display:flex;align-items:center;justify-content:center;font-size:12px;>"),ce=S("<span>"),Qt=S('<button style="background:#ff00ff;border:none;color:#000000;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⋯'),Zt=S("<div>"),en=S(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
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
      `);const Le="freqhole-demo-state",Je=300;function nt(){try{const e=localStorage.getItem(Le);return e?JSON.parse(e):{}}catch{return{}}}function Z(e){try{const d={...nt(),...e};localStorage.setItem(Le,JSON.stringify(d))}catch{}}function tn(e){const n=nt(),[d,s]=x([]),[g,$]=x({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[l,b]=x({field:"created_at",direction:"desc",...n.sortConfig||{}}),[C,P]=x(n.viewMode||"default"),[_,R]=x({id:!0,thumbnail:!0,mime:!0,blob_type:!0,size:!0,parent_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[E,O]=x(n.isFilterPanelOpen??!0),[V,v]=x(n.filterPanelWidth||Je),[z,W]=x(n.isBrowsePanelOpen??!0),[A,p]=x(n.browsePanelWidth||Je),[h,c]=x(e.wsUrl),[M,f]=x(e.autoConnect),[m,T]=x(!0),[y,X]=x(!1),[N,ge]=x([]),[be,fe]=x("Disconnected"),[se,me]=x(!1),[_e,J]=x(null),k=Bt({onSelectionChange:t=>{Z({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),ze=(t,i,u)=>{u.shiftKey&&k.lastSelectedIndex()>=0?k.selectRange(k.lastSelectedIndex(),i,ie()):k.handleRowClick(t,i,u)},De=t=>{console.log("Double-clicked:",t.id)},de=t=>{t.key==="a"&&(t.metaKey||t.ctrlKey)?(t.preventDefault(),k.selectAll(ie())):k.handleKeyDown(t)},xe=t=>{if(k.isDragSelecting()&&k.dragStart()){k.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const i=k.dragStart(),u=Math.floor((t.clientY-i.y)/60);if(u!==i.startIndex){const r=Math.min(i.startIndex,i.startIndex+u),H=Math.max(i.startIndex,i.startIndex+u);k.selectRange(r,H,ie())}}};he(()=>{document.addEventListener("mousemove",xe),document.addEventListener("keydown",de)}),Pe(()=>{document.removeEventListener("mousemove",xe),document.removeEventListener("keydown",de)});const ue=ee(()=>{const t=g();return d().filter(i=>{if(t.name&&!nn(i).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!i.mime?.startsWith(t.mime)||t.blobType&&i.blob_type!==t.blobType||i.size<t.minSize||i.size>t.maxSize)return!1;if(t.hasParent!=="all"){const u=!!i.parent_id;if(t.hasParent==="yes"&&!u||t.hasParent==="no"&&u)return!1}if(t.hasLocalPath!=="all"){const u=!!i.local_path;if(t.hasLocalPath==="yes"&&!u||t.hasLocalPath==="no"&&u)return!1}return!0})}),ie=ee(()=>{const t=l();return[...ue()].sort((u,r)=>{const H=u[t.field],q=r[t.field];let K=0;return H<q?K=-1:H>q&&(K=1),t.direction==="desc"?K*-1:K})}),Me=ee(()=>{const t=_(),i=[];return t.id&&i.push({key:"id",title:"ID",width:200,sortable:!0,render:u=>(()=>{var r=Gt();return a(r,()=>u.id),r})()}),t.thumbnail&&i.push({key:"thumbnail",title:"📷",width:60,render:u=>(()=>{var r=Jt();return a(r,(()=>{var H=ne(()=>!!u.mime?.startsWith("image/"));return()=>H()?"🖼️":ne(()=>!!u.mime?.startsWith("video/"))()?"🎥":u.mime?.startsWith("audio/")?"🎵":"📄"})()),r})()}),t.mime&&i.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:u=>(()=>{var r=ce();return a(r,()=>u.mime||"unknown"),r})()}),t.blob_type&&i.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.size&&i.push({key:"size",title:"Size",width:100,sortable:!0,render:u=>(()=>{var r=ce();return a(r,()=>on(u.size)),r})()}),t.parent_id&&i.push({key:"parent_id",title:"Parent",width:120,render:u=>(()=>{var r=ce();return a(r,()=>u.parent_id?"Yes":"No"),r})()}),t.local_path&&i.push({key:"local_path",title:"Local Path",width:200,render:u=>(()=>{var r=ce();return a(r,()=>u.local_path||"None"),r})()}),t.created_at&&i.push({key:"created_at",title:"Created",width:140,sortable:!0,render:u=>(()=>{var r=ce();return a(r,()=>new Date(u.created_at).toLocaleString()),r})()}),t.updated_at&&i.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:u=>(()=>{var r=ce();return a(r,()=>new Date(u.updated_at).toLocaleString()),r})()}),t.actions&&i.push({key:"actions",title:"Actions",width:100,render:u=>(()=>{var r=Qt();return r.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${u.id}`,"_blank"),r})()}),i}),ve=ee(()=>[...new Set(d().map(i=>i.mime?.split("/")[0]).filter(Boolean))].sort()),pe=ee(()=>[...new Set(d().map(i=>i.blob_type))].sort()),we=(t,i)=>{$(u=>({...u,[t]:i})),Z({filterConfig:{...g(),[t]:i}})},$e=(t,i)=>{b({field:t,direction:i}),Z({sortConfig:{field:t,direction:i}})},ye=t=>{P(t),Z({viewMode:t})},Re=t=>{R(i=>{const u={...i,[t]:!i[t]};return Z({columnVisibility:u}),u})},Se=()=>{W(t=>{const i=!t;return Z({isBrowsePanelOpen:i}),i})},le=()=>{O(t=>{const i=!t;return Z({isFilterPanelOpen:i}),i})},L=t=>{const i=new Date().toLocaleTimeString();ge(u=>[`${i}: ${t}`,...u.slice(0,49)])};return he(async()=>{L("🚀 FreqholeDemo mounted");try{const t=await fetch(`${e.apiBaseUrl}/api/blobs`);if(t.ok){const i=await t.json();s(i),J(new Date),L(`📦 Loaded ${i.length} media blobs`)}else L("⚠️ Using mock data (server not available)"),s(Qe()),J(new Date)}catch{L("⚠️ Using mock data (server error)"),s(Qe()),J(new Date)}e.autoConnect&&(fe("Connected"),L("🔌 Auto-connected to WebSocket"))}),(()=>{var t=en(),i=t.firstChild,u=i.nextSibling;return a(t,w(zt,{get isOpen(){return z()},get filterConfig(){return g()},onTogglePanel:Se,onFilterChange:we,onWidthChange:r=>{p(r),Z({browsePanelWidth:r})},get initialWidth(){return A()}}),i),a(t,w(Ut,{get selectedCount(){return k.selectedItems().size},onDownload:()=>{console.log("Bulk download:",k.selectedItems().size,"items")},get onClear(){return k.clearSelection},onMore:()=>{console.log("Show bulk actions menu")}}),i),a(i,w(jt,{get data(){return ie()},get columns(){return Me()},onSort:$e,get sortField(){return l().field},get sortDirection(){return l().direction},get rowHeight(){return ne(()=>C()==="compact")()?40:C()==="detailed"?80:60},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return k.selectedItems()},onRowClick:ze,onRowDoubleClick:De,get onRowMouseDown(){return k.handleRowMouseDown},get isDragSelecting(){return k.isDragSelecting()}})),a(t,w(Xe,{get isVisible(){return!z()},position:"left",panelName:"Browse",onClick:Se}),u),a(t,w(Xe,{get isVisible(){return!E()},position:"right",panelName:"Controls",onClick:le}),u),a(t,w(G,{get when(){return ne(()=>!!(k.isDragSelecting()&&k.dragStart()))()&&k.dragEnd()},get children(){var r=Zt();return I(H=>D(r,(()=>{const q=k.dragStart(),K=k.dragEnd(),Ie=Math.min(q.x,K.x),Q=Math.min(q.y,K.y),Te=Math.abs(K.x-q.x),Ce=Math.abs(K.y-q.y);return`
              position: fixed;
              left: ${Ie}px;
              top: ${Q}px;
              width: ${Te}px;
              height: ${Ce}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),H)),r}}),u),a(t,w(Lt,{get isOpen(){return E()},get filterConfig(){return g()},get viewMode(){return C()},get columnVisibility(){return _()},get wsUrl(){return h()},get autoConnect(){return M()},get autoRefresh(){return m()},get debug(){return y()},get connectionStatus(){return be()},get hasPendingUpdates(){return se()},pendingUpdatesCount:0,get filteredCount(){return ue().length},get totalCount(){return d().length},get sortConfig(){return l()},get lastUpdated(){return _e()},get mimeCategories(){return ve()},get blobTypes(){return pe()},get logs(){return N()},onTogglePanel:le,onFilterChange:we,onViewModeChange:ye,onColumnToggle:Re,onWsUrlChange:c,onConnect:()=>{fe("Connected"),L("🔌 Connected to WebSocket")},onDisconnect:()=>{fe("Disconnected"),L("🔌 Disconnected from WebSocket")},onRefresh:async()=>{L("🔄 Refreshing data...");try{const r=await fetch(`${e.apiBaseUrl}/api/blobs`);if(r.ok){const H=await r.json();s(H),J(new Date),L(`📦 Refreshed ${H.length} media blobs`)}}catch{L("❌ Refresh failed")}},onApplyPendingUpdates:()=>{me(!1),L("📥 Applied pending updates")},onToggleAutoConnect:()=>{f(r=>!r),L(`🔧 Auto-connect: ${M()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{T(r=>!r),L(`🔧 Auto-refresh: ${m()?"OFF":"ON"}`)},onToggleDebug:()=>{X(r=>!r),L(`🐛 Debug: ${y()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Le),window.location.reload())},onWidthChange:r=>{v(r),Z({filterPanelWidth:r})},get initialWidth(){return V()}}),u),t})()}function nn(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.filename||e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}function on(e){if(e===0)return"0 B";const n=1024,d=["B","KB","MB","GB"],s=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,s)).toFixed(2))+" "+d[s]}function Qe(){const e=["image/jpeg","image/png","video/mp4","audio/mp3","text/plain","application/pdf"],n=["upload","thumbnail","processed","backup"];return Array.from({length:1e3},(d,s)=>({id:`blob-${s+1}`,mime:e[Math.floor(Math.random()*e.length)],blob_type:n[Math.floor(Math.random()*n.length)],size:Math.floor(Math.random()*1e7),parent_id:Math.random()>.7?`blob-${Math.floor(Math.random()*s)+1}`:void 0,local_path:Math.random()>.5?`/path/to/file-${s+1}.ext`:void 0,created_at:new Date(Date.now()-Math.random()*864e5*30).toISOString(),updated_at:new Date(Date.now()-Math.random()*864e5*7).toISOString()}))}ae(["click"]);class ln extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",d=this.getAttribute("api-base-url")||"http://localhost:8080",s=this.getAttribute("auto-connect")==="true";this.dispose=St(()=>w(tn,{wsUrl:n,apiBaseUrl:d,autoConnect:s}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",ln),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
