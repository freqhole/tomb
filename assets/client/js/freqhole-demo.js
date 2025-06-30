import{d as le,c as $,t as k,a as U,b as M,e as L,s as S,i as l,m as Z,f as _,S as ge,F as K,g as $t,h as q,o as ke,u as je,j as wt,r as yt}from"./web-DgpntjfK.js";var Ct=k(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function Ye(e){const[i,d]=$(!1);return(()=>{var r=Ct(),c=r.firstChild,D=c.nextSibling;return r.addEventListener("mouseleave",()=>d(!1)),r.addEventListener("mouseenter",()=>d(!0)),U(r,"mousedown",e.onMouseDown),M(s=>{var u=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,z=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,F=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${i()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,h=`
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
          opacity: ${i()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return u!==s.e&&L(r,s.e=u),s.t=S(r,z,s.t),s.a=S(c,F,s.a),s.o=S(D,h,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),r})()}le(["mousedown"]);function Ke(e){const[i,d]=$(e.initialWidth),[r,c]=$(!1),D=e.minWidth||250,s=e.maxWidth||600,u=e.closeThreshold||100;return{width:i,setWidth:d,isDragging:r,handleMouseDown:(F,h="right")=>{F.preventDefault(),c(!0),document.body.classList.add("resizing");const P=F.clientX,W=i(),O=x=>{const y=x.clientX-P,m=h==="right"?W-y:W+y;if(m<u){e.onClose?.();return}const v=Math.max(D,Math.min(s,m));d(v),e.onWidthChange?.(v)},B=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",O),document.removeEventListener("mouseup",B)};document.addEventListener("mousemove",O),document.addEventListener("mouseup",B)}}}var St=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),_t=k('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function kt(e){const i=Ke({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var d=St(),r=d.firstChild,c=r.firstChild,D=c.nextSibling,s=r.nextSibling;return U(D,"click",e.onTogglePanel),l(d,(()=>{var u=Z(()=>!!e.isOpen);return()=>u()&&(()=>{var z=_t(),F=z.firstChild,h=F.nextSibling;return h.$$input=P=>e.onFilterChange("name",P.currentTarget.value),M(()=>h.value=e.filterConfig.name),z})()})(),s),l(d,_(Ye,{position:"right",get isDragging(){return i.isDragging()},onMouseDown:u=>i.handleMouseDown(u,"left")}),s),M(u=>{var z=`browse-panel ${e.isOpen?"":"collapsed"} ${i.isDragging()?"resizing":""}`,F=`
        width: ${e.isOpen?i.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return z!==u.e&&L(d,u.e=z),u.t=S(d,F,u.t),u},{e:void 0,t:void 0}),d})()}le(["click","input"]);var zt=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Mt=k('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Dt=k('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Pt=k('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),Ee=k("<option>"),Rt=k("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Tt=k("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Ft(e){const[i,d]=$(!1),r=Ke({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),c=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],D=s=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[s]||"color: #6b7280;";return(()=>{var s=zt(),u=s.firstChild,z=u.firstChild,F=z.nextSibling,h=u.nextSibling;return U(F,"click",e.onTogglePanel),l(s,(()=>{var P=Z(()=>!!e.isOpen);return()=>P()&&(()=>{var W=Pt(),O=W.firstChild,B=O.firstChild,x=B.nextSibling,y=x.nextSibling,m=y.firstChild,v=m.nextSibling,w=y.nextSibling,C=w.firstChild,g=C.nextSibling,p=w.nextSibling,R=p.firstChild,b=R.nextSibling,V=O.nextSibling,ee=V.firstChild,ve=ee.nextSibling,X=ve.firstChild,pe=X.nextSibling,fe=V.nextSibling,re=fe.firstChild,te=re.nextSibling;te.firstChild;var ue=fe.nextSibling,$e=ue.firstChild,N=$e.nextSibling;N.firstChild;var ae=ue.nextSibling,we=ae.firstChild,ye=we.nextSibling,se=ye.firstChild,Ce=se.nextSibling,de=Ce.nextSibling,he=ae.nextSibling,Se=he.firstChild,be=Se.nextSibling,ce=he.nextSibling,xe=ce.firstChild,I=xe.nextSibling,n=ce.nextSibling,a=n.firstChild,f=a.nextSibling,o=f.firstChild,A=o.nextSibling,ne=A.nextSibling,G=n.nextSibling,Ge=G.firstChild,ie=Ge.nextSibling,Je=ie.firstChild,_e=ie.nextSibling,Qe=G.nextSibling,Ze=Qe.firstChild,J=Ze.nextSibling,et=J.firstChild,Me=et.nextSibling,tt=Me.nextSibling,nt=tt.nextSibling,it=nt.nextSibling,De=it.nextSibling,ot=De.nextSibling,lt=ot.nextSibling,rt=lt.nextSibling,Pe=rt.nextSibling,at=Pe.nextSibling,Re=at.nextSibling,st=Re.nextSibling,dt=st.nextSibling;dt.nextSibling;var Te=J.nextSibling,ct=Te.firstChild,me=ct.nextSibling,gt=Te.nextSibling;return x.$$input=t=>e.onWsUrlChange(t.currentTarget.value),l(v,()=>e.connectionStatus),U(C,"click",e.onConnect),U(g,"click",e.onDisconnect),U(b,"click",e.onToggleAutoConnect),l(b,()=>e.autoConnect?"ON":"OFF"),U(X,"click",e.onToggleAutoRefresh),l(X,()=>e.autoRefresh?"ON":"OFF"),U(pe,"click",e.onRefresh),l(V,_(ge,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var t=Mt(),T=t.firstChild,j=T.firstChild,E=j.nextSibling;return E.nextSibling,U(T,"click",e.onApplyPendingUpdates),l(T,()=>e.pendingUpdatesCount,E),t}}),null),te.addEventListener("change",t=>e.onFilterChange("mime",t.currentTarget.value)),l(te,_(K,{get each(){return e.mimeCategories},children:t=>(()=>{var T=Ee();return T.value=t,l(T,t),T})()}),null),N.addEventListener("change",t=>e.onFilterChange("blobType",t.currentTarget.value)),l(N,_(K,{get each(){return e.blobTypes},children:t=>(()=>{var T=Ee();return T.value=t,l(T,t),T})()}),null),se.$$input=t=>e.onFilterChange("minSize",parseInt(t.currentTarget.value)||0),de.$$input=t=>e.onFilterChange("maxSize",parseInt(t.currentTarget.value)||1e8),be.addEventListener("change",t=>e.onFilterChange("hasParent",t.currentTarget.value)),I.addEventListener("change",t=>e.onFilterChange("hasLocalPath",t.currentTarget.value)),o.$$click=()=>e.onViewModeChange("compact"),A.$$click=()=>e.onViewModeChange("default"),ne.$$click=()=>e.onViewModeChange("detailed"),ie.$$click=()=>d(!i()),l(ie,()=>i()?"Hide":"Show",Je),l(_e,_(K,{each:c,children:t=>(()=>{var T=Rt(),j=T.firstChild,E=j.firstChild,Q=E.nextSibling;return E.addEventListener("change",()=>e.onColumnToggle(t.key)),l(Q,()=>t.title),M(()=>E.checked=e.columnVisibility[t.key]),T})()})),l(J,()=>e.totalCount,Me),l(J,()=>e.filteredCount,De),l(J,()=>e.sortConfig.field,Pe),l(J,()=>e.sortConfig.direction,Re),l(J,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),U(me,"click",e.onToggleDebug),l(me,()=>e.debug?"ON":"OFF"),U(gt,"click",e.onReset),l(W,_(ge,{get when(){return e.debug&&e.logs.length>0},get children(){var t=Dt(),T=t.firstChild,j=T.nextSibling;return l(j,_(K,{get each(){return e.logs},children:E=>(()=>{var Q=Tt();return l(Q,E),Q})()})),t}}),null),M(t=>{var T=D(e.connectionStatus),j=e.connectionStatus==="Connected",E=e.connectionStatus==="Disconnected",Q=`toggle-button ${e.autoConnect?"active":""}`,ft=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Fe=`toggle-button ${e.autoRefresh?"active":""}`,ut=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Ie=`view-mode-button ${e.viewMode==="compact"?"active":""}`,ht=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="compact"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="compact"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="compact"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,We=`view-mode-button ${e.viewMode==="default"?"active":""}`,bt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="default"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="default"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="default"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Le=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,xt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Oe=`toggle-button ${i()?"active":""}`,mt=`
            margin-bottom: 8px;
            width: 100%;
            padding: 8px;
            background: ${i()?"#ff00ff":"#333333"};
            box-sizing: border-box;
            min-width: 0;
            border: 1px solid ${i()?"#ff00ff":"#666666"};
            color: ${i()?"#000000":"#ffffff"};
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          `,Ae=`column-settings ${i()?"":"collapsed"}`,vt=`
            max-height: ${i()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,Ue=`toggle-button ${e.debug?"active":""}`,pt=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return t.e=S(v,T,t.e),j!==t.t&&(C.disabled=t.t=j),E!==t.a&&(g.disabled=t.a=E),Q!==t.o&&L(b,t.o=Q),t.i=S(b,ft,t.i),Fe!==t.n&&L(X,t.n=Fe),t.s=S(X,ut,t.s),Ie!==t.h&&L(o,t.h=Ie),t.r=S(o,ht,t.r),We!==t.d&&L(A,t.d=We),t.l=S(A,bt,t.l),Le!==t.u&&L(ne,t.u=Le),t.c=S(ne,xt,t.c),Oe!==t.w&&L(ie,t.w=Oe),t.m=S(ie,mt,t.m),Ae!==t.f&&L(_e,t.f=Ae),t.y=S(_e,vt,t.y),Ue!==t.g&&L(me,t.g=Ue),t.p=S(me,pt,t.p),t},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),M(()=>x.value=e.wsUrl),M(()=>te.value=e.filterConfig.mime),M(()=>N.value=e.filterConfig.blobType),M(()=>se.value=e.filterConfig.minSize),M(()=>de.value=e.filterConfig.maxSize),M(()=>be.value=e.filterConfig.hasParent),M(()=>I.value=e.filterConfig.hasLocalPath),W})()})(),h),l(s,_(Ye,{position:"left",get isDragging(){return r.isDragging()},onMouseDown:P=>r.handleMouseDown(P,"right")}),h),M(P=>{var W=`filter-panel ${e.isOpen?"":"collapsed"} ${r.isDragging()?"resizing":""}`,O=`
        width: ${e.isOpen?r.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return W!==P.e&&L(s,P.e=W),P.t=S(s,O,P.t),P},{e:void 0,t:void 0}),s})()}le(["click","input"]);var It=k(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function Ve(e){const[i,d]=$(!1);return _(ge,{get when(){return e.isVisible},get children(){var r=It(),c=r.firstChild,D=c.nextSibling;return r.addEventListener("mouseleave",()=>d(!1)),r.addEventListener("mouseenter",()=>d(!0)),U(r,"click",e.onClick),l(c,()=>e.position==="left"?"→":"←"),l(D,()=>e.panelName),M(s=>{var u=`edge-toggle-button edge-toggle-${e.position}`,z=`Show ${e.panelName} panel`,F=`
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
        `,h=`
            opacity: ${i()?"1":"0"};
            transform: translateY(${i()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return u!==s.e&&L(r,s.e=u),z!==s.t&&$t(r,"title",s.t=z),s.a=S(r,F,s.a),s.o=S(c,h,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),r}})}le(["click"]);const H={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function Wt(e){const[i,d]=$(e.initialSort||{field:"id",direction:"asc"}),[r,c]=$(new Set),[D,s]=$(!1),u=e.getItemId||(x=>x.id||String(x)),z=q(()=>{const x=i();return[...e.data].sort((m,v)=>{const w=m[x.field],C=v[x.field];let g=0;return w<C?g=-1:w>C&&(g=1),x.direction==="desc"?g*-1:g})});return{sortConfig:i,selectedItems:r,isDragSelecting:D,sortedData:z,handleSort:x=>{const y=i(),m=y.field===x&&y.direction==="asc"?"desc":"asc";d({field:x,direction:m})},toggleSelection:x=>{const y=new Set(r());y.has(x)?y.delete(x):y.add(x),c(y)},clearSelection:()=>{c(new Set)},selectAll:()=>{const x=new Set(e.data.map(u));c(x)},isSelected:x=>r().has(x),selectRange:(x,y)=>{const m=new Set(r()),v=Math.min(x,y),w=Math.max(x,y);for(let C=v;C<=w;C++)if(C<e.data.length&&e.data[C]!=null){const g=u(e.data[C]);m.add(g)}c(m)},setIsDragSelecting:s,getItemId:u}}var Lt=k("<div class=grid-row>"),Ot=k("<div class=grid-cell>"),He=k("<div class=grid-content>"),At=k("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),Ut=k("<span style=font-size:12px;>"),Et=k("<div><span>"),Vt=k("<div>");function Be(e){let i;return ke(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var d=Lt();d.$$contextmenu=c=>e.onContextMenu?.(e.item,e.index,c),d.$$mousedown=c=>e.onRowMouseDown?.(e.item,e.index,c),d.$$dblclick=c=>e.onRowDoubleClick?.(e.item,e.index,c),d.$$click=c=>e.onRowClick?.(e.item,e.index,c);var r=i;return typeof r=="function"?je(r,d):i=d,l(d,_(K,{get each(){return e.columns},children:c=>(()=>{var D=Ot();return l(D,(()=>{var s=Z(()=>!!c.render);return()=>s()?c.render(e.item,e.index):String(e.item[c.key]||"")})()),M(s=>S(D,`
              flex: ${c.width?"0 0 "+c.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,s)),D})()})),M(c=>S(d,`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${H.colors.border};
        background: ${e.isSelected?H.colors.selected:"transparent"};
        transition: background-color 0.15s ease;
      `,c)),d})()}function Ht(e){const[i,d]=$(),[r,c]=$(0),[D,s]=$(0),u=e.rowHeight||50,z=e.headerHeight||60,F=e.virtualizeThreshold||100,h=Wt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),P=q(()=>e.data.length>F),W=q(()=>{if(!P())return e.data.map((b,V)=>({item:b,index:V}));if(!i())return[];const v=u,w=r(),C=D(),g=Math.floor(w/v),p=Math.min(e.data.length-1,Math.ceil((w+C)/v)+5),R=[];for(let b=Math.max(0,g-5);b<=p;b++)b<e.data.length&&e.data[b]!=null&&R.push({item:e.data[b],index:b});return R}),O=q(()=>e.data.length*u),B=m=>{const v=m.target;c(v.scrollTop)},x=m=>{if(h.handleSort(m),e.onSort){const v=h.sortConfig();e.onSort(v.field,v.direction)}},y=(m,v,w)=>{const C=h.getItemId(m);if(w.ctrlKey||w.metaKey)h.toggleSelection(C);else if(w.shiftKey&&h.selectedItems().size>0){const g=e.data,p=Array.from(h.selectedItems()).pop();if(p){const R=g.findIndex(b=>h.getItemId(b)===p);R!==-1&&h.selectRange(R,v)}}else h.clearSelection(),h.toggleSelection(C);e.onRowClick?.(m,v,w)};return ke(()=>{const m=i();if(!m)return;const v=new ResizeObserver(w=>{for(const C of w)s(C.contentRect.height)});v.observe(m),wt(()=>{v.disconnect()})}),(()=>{var m=At(),v=m.firstChild,w=v.nextSibling,C=w.nextSibling;return l(v,_(K,{get each(){return e.columns},children:g=>(()=>{var p=Et(),R=p.firstChild;return p.$$click=()=>g.sortable&&x(g.key),l(R,()=>g.title),l(p,_(ge,{get when(){return Z(()=>!!g.sortable)()&&h.sortConfig().field===g.key},get children(){var b=Ut();return l(b,()=>h.sortConfig().direction==="asc"?"↑":"↓"),b}}),null),M(b=>{var V=`grid-header-cell ${g.sortable?"sortable":""}`,ee=`
                flex: ${g.width?"0 0 "+g.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${g.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return V!==b.e&&L(p,b.e=V),b.t=S(p,ee,b.t),b},{e:void 0,t:void 0}),p})()})),w.addEventListener("scroll",B),je(d,w),l(w,_(ge,{get when(){return P()},get fallback(){return(()=>{var g=He();return l(g,_(K,{get each(){return e.data},children:(p,R)=>_(Be,{item:p,get index(){return R()},get columns(){return e.columns},get isSelected(){return h.isSelected(h.getItemId(p))},onRowClick:y,get onRowDoubleClick(){return e.onRowDoubleClick},get onRowMouseDown(){return e.onRowMouseDown},get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:u})})),g})()},get children(){var g=He();return l(g,_(K,{get each(){return W()},children:p=>(()=>{var R=Vt();return l(R,_(Be,{get item(){return p.item},get index(){return p.index},get columns(){return e.columns},get isSelected(){return h.isSelected(h.getItemId(p.item))},onRowClick:y,get onRowDoubleClick(){return e.onRowDoubleClick},get onRowMouseDown(){return e.onRowMouseDown},get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:u})),M(b=>S(R,`
                    position: absolute;
                    top: ${p.index*u}px;
                    left: 0;
                    right: 0;
                  `,b)),R})()})),M(p=>S(g,`height: ${O()}px; position: relative;`,p)),g}})),l(C,()=>`
        .grid-row:hover {
          background: ${H.colors.hover} !important;
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${H.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${H.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${H.colors.text};
        }
      `),M(g=>{var p=`infinite-data-grid ${e.className||""}`,R=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${H.colors.background};
        color: ${H.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,b=`
          height: ${z}px;
          display: flex;
          align-items: center;
          background: ${H.colors.header};
          border-bottom: 2px solid ${H.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return p!==g.e&&L(m,g.e=p),g.t=S(m,R,g.t),g.a=S(v,b,g.a),g},{e:void 0,t:void 0,a:void 0}),m})()}le(["click","dblclick","mousedown","contextmenu"]);var Bt=k("<span style=font-family:monospace;font-size:12px;>"),Nt=k("<div style=width:40px;height:40px;border-radius:4px;overflow:hidden;background:#333;display:flex;align-items:center;justify-content:center;font-size:12px;>"),oe=k("<span>"),qt=k('<button style="background:#0070f3;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;">View'),jt=k(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }
      `);const ze="freqhole-demo-state",Ne=300;function Xe(){try{const e=localStorage.getItem(ze);return e?JSON.parse(e):{}}catch{return{}}}function Y(e){try{const d={...Xe(),...e};localStorage.setItem(ze,JSON.stringify(d))}catch{}}function Yt(e){const i=Xe(),[d,r]=$([]),[c,D]=$({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...i.filterConfig||{}}),[s,u]=$({field:"created_at",direction:"desc",...i.sortConfig||{}}),[z,F]=$(i.viewMode||"default"),[h,P]=$({id:!0,thumbnail:!0,mime:!0,blob_type:!0,size:!0,parent_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...i.columnVisibility||{}}),[W,O]=$(i.isFilterPanelOpen??!0),[B,x]=$(i.filterPanelWidth||Ne),[y,m]=$(i.isBrowsePanelOpen??!0),[v,w]=$(i.browsePanelWidth||Ne),[C,g]=$(e.wsUrl),[p,R]=$(e.autoConnect),[b,V]=$(!0),[ee,ve]=$(!1),[X,pe]=$([]),[fe,re]=$("Disconnected"),[te,ue]=$(!1),[$e,N]=$(null),ae=q(()=>{const n=c();return d().filter(a=>{if(n.name&&!Kt(a).toLowerCase().includes(n.name.toLowerCase())||n.mime&&!a.mime?.startsWith(n.mime)||n.blobType&&a.blob_type!==n.blobType||a.size<n.minSize||a.size>n.maxSize)return!1;if(n.hasParent!=="all"){const f=!!a.parent_id;if(n.hasParent==="yes"&&!f||n.hasParent==="no"&&f)return!1}if(n.hasLocalPath!=="all"){const f=!!a.local_path;if(n.hasLocalPath==="yes"&&!f||n.hasLocalPath==="no"&&f)return!1}return!0})}),we=q(()=>{const n=s();return[...ae()].sort((f,o)=>{const A=f[n.field],ne=o[n.field];let G=0;return A<ne?G=-1:A>ne&&(G=1),n.direction==="desc"?G*-1:G})}),ye=q(()=>{const n=h(),a=[];return n.id&&a.push({key:"id",title:"ID",width:200,sortable:!0,render:f=>(()=>{var o=Bt();return l(o,()=>f.id),o})()}),n.thumbnail&&a.push({key:"thumbnail",title:"📷",width:60,render:f=>(()=>{var o=Nt();return l(o,(()=>{var A=Z(()=>!!f.mime?.startsWith("image/"));return()=>A()?"🖼️":Z(()=>!!f.mime?.startsWith("video/"))()?"🎥":f.mime?.startsWith("audio/")?"🎵":"📄"})()),o})()}),n.mime&&a.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:f=>(()=>{var o=oe();return l(o,()=>f.mime||"unknown"),o})()}),n.blob_type&&a.push({key:"blob_type",title:"Type",width:100,sortable:!0}),n.size&&a.push({key:"size",title:"Size",width:100,sortable:!0,render:f=>(()=>{var o=oe();return l(o,()=>Xt(f.size)),o})()}),n.parent_id&&a.push({key:"parent_id",title:"Parent",width:120,render:f=>(()=>{var o=oe();return l(o,()=>f.parent_id?"Yes":"No"),o})()}),n.local_path&&a.push({key:"local_path",title:"Local Path",width:200,render:f=>(()=>{var o=oe();return l(o,()=>f.local_path||"None"),o})()}),n.created_at&&a.push({key:"created_at",title:"Created",width:140,sortable:!0,render:f=>(()=>{var o=oe();return l(o,()=>new Date(f.created_at).toLocaleString()),o})()}),n.updated_at&&a.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:f=>(()=>{var o=oe();return l(o,()=>new Date(f.updated_at).toLocaleString()),o})()}),n.actions&&a.push({key:"actions",title:"Actions",width:100,render:f=>(()=>{var o=qt();return o.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${f.id}`,"_blank"),o})()}),a}),se=q(()=>[...new Set(d().map(a=>a.mime?.split("/")[0]).filter(Boolean))].sort()),Ce=q(()=>[...new Set(d().map(a=>a.blob_type))].sort()),de=(n,a)=>{D(f=>({...f,[n]:a})),Y({filterConfig:{...c(),[n]:a}})},he=(n,a)=>{u({field:n,direction:a}),Y({sortConfig:{field:n,direction:a}})},Se=n=>{F(n),Y({viewMode:n})},be=n=>{P(a=>{const f={...a,[n]:!a[n]};return Y({columnVisibility:f}),f})},ce=()=>{m(n=>{const a=!n;return Y({isBrowsePanelOpen:a}),a})},xe=()=>{O(n=>{const a=!n;return Y({isFilterPanelOpen:a}),a})},I=n=>{const a=new Date().toLocaleTimeString();pe(f=>[`${a}: ${n}`,...f.slice(0,49)])};return ke(async()=>{I("🚀 FreqholeDemo mounted");try{const n=await fetch(`${e.apiBaseUrl}/api/blobs`);if(n.ok){const a=await n.json();r(a),N(new Date),I(`📦 Loaded ${a.length} media blobs`)}else I("⚠️ Using mock data (server not available)"),r(qe()),N(new Date)}catch{I("⚠️ Using mock data (server error)"),r(qe()),N(new Date)}e.autoConnect&&(re("Connected"),I("🔌 Auto-connected to WebSocket"))}),(()=>{var n=jt(),a=n.firstChild,f=a.nextSibling;return l(n,_(kt,{get isOpen(){return y()},get filterConfig(){return c()},onTogglePanel:ce,onFilterChange:de,onWidthChange:o=>{w(o),Y({browsePanelWidth:o})},get initialWidth(){return v()}}),a),l(a,_(Ht,{get data(){return we()},get columns(){return ye()},onSort:he,get sortField(){return s().field},get sortDirection(){return s().direction},get rowHeight(){return Z(()=>z()==="compact")()?40:z()==="detailed"?80:60},headerHeight:60,getItemId:o=>o.id})),l(n,_(Ve,{get isVisible(){return!y()},position:"left",panelName:"Browse",onClick:ce}),f),l(n,_(Ve,{get isVisible(){return!W()},position:"right",panelName:"Controls",onClick:xe}),f),l(n,_(Ft,{get isOpen(){return W()},get filterConfig(){return c()},get viewMode(){return z()},get columnVisibility(){return h()},get wsUrl(){return C()},get autoConnect(){return p()},get autoRefresh(){return b()},get debug(){return ee()},get connectionStatus(){return fe()},get hasPendingUpdates(){return te()},pendingUpdatesCount:0,get filteredCount(){return ae().length},get totalCount(){return d().length},get sortConfig(){return s()},get lastUpdated(){return $e()},get mimeCategories(){return se()},get blobTypes(){return Ce()},get logs(){return X()},onTogglePanel:xe,onFilterChange:de,onViewModeChange:Se,onColumnToggle:be,onWsUrlChange:g,onConnect:()=>{re("Connected"),I("🔌 Connected to WebSocket")},onDisconnect:()=>{re("Disconnected"),I("🔌 Disconnected from WebSocket")},onRefresh:async()=>{I("🔄 Refreshing data...");try{const o=await fetch(`${e.apiBaseUrl}/api/blobs`);if(o.ok){const A=await o.json();r(A),N(new Date),I(`📦 Refreshed ${A.length} media blobs`)}}catch{I("❌ Refresh failed")}},onApplyPendingUpdates:()=>{ue(!1),I("📥 Applied pending updates")},onToggleAutoConnect:()=>{R(o=>!o),I(`🔧 Auto-connect: ${p()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{V(o=>!o),I(`🔧 Auto-refresh: ${b()?"OFF":"ON"}`)},onToggleDebug:()=>{ve(o=>!o),I(`🐛 Debug: ${ee()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(ze),window.location.reload())},onWidthChange:o=>{x(o),Y({filterPanelWidth:o})},get initialWidth(){return B()}}),f),n})()}function Kt(e){if(e.local_path){const i=e.local_path.split(/[/\\]/);return i[i.length-1]||e.id}return e.id}function Xt(e){if(e===0)return"0 B";const i=1024,d=["B","KB","MB","GB"],r=Math.floor(Math.log(e)/Math.log(i));return parseFloat((e/Math.pow(i,r)).toFixed(2))+" "+d[r]}function qe(){const e=["image/jpeg","image/png","video/mp4","audio/mp3","text/plain","application/pdf"],i=["upload","thumbnail","processed","backup"];return Array.from({length:1e3},(d,r)=>({id:`blob-${r+1}`,mime:e[Math.floor(Math.random()*e.length)],blob_type:i[Math.floor(Math.random()*i.length)],size:Math.floor(Math.random()*1e7),parent_id:Math.random()>.7?`blob-${Math.floor(Math.random()*r)+1}`:void 0,local_path:Math.random()>.5?`/path/to/file-${r+1}.ext`:void 0,created_at:new Date(Date.now()-Math.random()*864e5*30).toISOString(),updated_at:new Date(Date.now()-Math.random()*864e5*7).toISOString()}))}le(["click"]);class Gt extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const i=this.getAttribute("ws-url")||"ws://localhost:8080/ws",d=this.getAttribute("api-base-url")||"http://localhost:8080",r=this.getAttribute("auto-connect")==="true";this.dispose=yt(()=>_(Yt,{wsUrl:i,apiBaseUrl:d,autoConnect:r}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Gt),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
