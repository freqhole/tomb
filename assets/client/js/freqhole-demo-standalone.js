import{d as re,c as N,t as k,a as J,b as L,e as G,s as F,i as a,m as se,f as S,F as xe,S as H,g as ie,o as oe,h as ze,j as me,k as ne,u as Ae,r as Ct}from"./web-2xXXrb5V.js";import{u as zt}from"./useThumbnail-BJBtHgwT.js";import{u as Dt}from"./thumbnail-utils-DME7itp9.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Z(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var Mt=k(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function ft(e){const[n,i]=N(!1);return(()=>{var o=Mt(),c=o.firstChild,r=c.nextSibling;return o.addEventListener("mouseleave",()=>i(!1)),o.addEventListener("mouseenter",()=>i(!0)),J(o,"mousedown",e.onMouseDown,!0),L(s=>{var g=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,D=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,v=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${n()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,m=`
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
        `;return g!==s.e&&G(o,s.e=g),s.t=F(o,D,s.t),s.a=F(c,v,s.a),s.o=F(r,m,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),o})()}re(["mousedown"]);function ht(e){const[n,i]=N(e.initialWidth),[o,c]=N(!1),r=e.minWidth||250,s=e.maxWidth||600,g=e.closeThreshold||100;return{width:n,setWidth:i,isDragging:o,handleMouseDown:(v,m="right")=>{v.preventDefault(),c(!0),document.body.classList.add("resizing");const C=v.clientX,U=n(),l=y=>{const _=y.clientX-C,I=m==="right"?U-_:U+_;if(I<g){e.onClose?.();return}const b=Math.max(r,Math.min(s,I));i(b),e.onWidthChange?.(b)},w=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",w)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",w)}}}var Et=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),It=k('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Tt(e){const n=ht({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var i=Et(),o=i.firstChild,c=o.firstChild,r=c.nextSibling,s=o.nextSibling;return J(r,"click",e.onTogglePanel,!0),a(i,(()=>{var g=se(()=>!!e.isOpen);return()=>g()&&(()=>{var D=It(),v=D.firstChild,m=v.nextSibling;return m.$$input=C=>e.onFilterChange("name",C.currentTarget.value),L(()=>m.value=e.filterConfig.name),D})()})(),s),a(i,S(ft,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:g=>n.handleMouseDown(g,"left")}),s),L(g=>{var D=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,v=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return D!==g.e&&G(i,g.e=D),g.t=F(i,v,g.t),g},{e:void 0,t:void 0}),i})()}re(["click","input"]);var Lt=k('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),Pt=k("<div>"),Rt=k("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span style=font-size:14px;color:#e0e0e0;>");const At=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function Ft(e){return(()=>{var n=Pt();return a(n,S(xe,{each:At,children:i=>(()=>{var o=Rt(),c=o.firstChild,r=c.firstChild,s=r.nextSibling;return r.addEventListener("change",()=>e.onColumnToggle(i.key)),a(s,()=>i.title),L(()=>r.checked=e.columnVisibility[i.key]),o})()}),null),a(n,S(H,{get when(){return e.onResetToDefaults},get children(){var i=Lt();return J(i,"click",e.onResetToDefaults,!0),i}}),null),L(()=>G(n,`column-manager ${e.className||""}`)),n})()}re(["click"]);var Nt=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Ot=k('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Wt=k('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),Ut=k('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button><span> Column Settings</span></button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),at=k("<option>"),Bt=k("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Ht(e){const[n,i]=N(!1),o=ht({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),c=r=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[r]||"color: #6b7280;";return(()=>{var r=Nt(),s=r.firstChild,g=s.firstChild,D=g.nextSibling,v=s.nextSibling;return J(D,"click",e.onTogglePanel,!0),a(r,(()=>{var m=se(()=>!!e.isOpen);return()=>m()&&(()=>{var C=Ut(),U=C.firstChild,l=U.firstChild,w=l.nextSibling,y=w.nextSibling,_=y.firstChild,I=_.nextSibling,b=y.nextSibling,E=b.firstChild,O=E.nextSibling,z=b.nextSibling,x=z.firstChild,f=x.nextSibling,A=U.nextSibling,V=A.firstChild,$=V.nextSibling,M=$.firstChild,W=M.nextSibling,P=A.nextSibling,j=P.firstChild,Y=j.nextSibling;Y.firstChild;var X=P.nextSibling,B=X.firstChild,R=B.nextSibling;R.firstChild;var de=X.nextSibling,De=de.firstChild,Me=De.nextSibling,pe=Me.firstChild,le=pe.nextSibling,fe=le.nextSibling,T=de.nextSibling,qe=T.firstChild,Fe=qe.nextSibling,Ne=T.nextSibling,Oe=Ne.firstChild,ye=Oe.nextSibling,$e=Ne.nextSibling,Ke=$e.firstChild,We=Ke.nextSibling,ke=We.firstChild,Se=ke.nextSibling,Ee=Se.nextSibling,Ue=$e.nextSibling,Ve=Ue.firstChild,he=Ve.nextSibling,Ie=he.firstChild,Be=Ie.firstChild,ae=he.nextSibling,je=Ue.nextSibling,Ye=je.firstChild,ce=Ye.nextSibling,Xe=ce.firstChild,Te=Xe.nextSibling,Ge=Te.nextSibling,Je=Ge.nextSibling,Ze=Je.nextSibling,Le=Ze.nextSibling,He=Le.nextSibling,t=He.nextSibling,d=t.nextSibling,u=d.nextSibling,p=u.nextSibling,q=p.nextSibling,Q=q.nextSibling,ue=Q.nextSibling;ue.nextSibling;var ve=ce.nextSibling,Pe=ve.firstChild,be=Pe.nextSibling,_e=ve.nextSibling;return w.$$input=h=>e.onWsUrlChange(h.currentTarget.value),a(I,()=>e.connectionStatus),J(E,"click",e.onConnect,!0),J(O,"click",e.onDisconnect,!0),J(f,"click",e.onToggleAutoConnect,!0),a(f,()=>e.autoConnect?"ON":"OFF"),J(M,"click",e.onToggleAutoRefresh,!0),a(M,()=>e.autoRefresh?"ON":"OFF"),J(W,"click",e.onRefresh,!0),a(A,S(H,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var h=Ot(),K=h.firstChild,ee=K.firstChild,we=ee.nextSibling;return we.nextSibling,J(K,"click",e.onApplyPendingUpdates,!0),a(K,()=>e.pendingUpdatesCount,we),h}}),null),Y.addEventListener("change",h=>e.onFilterChange("mime",h.currentTarget.value)),a(Y,S(xe,{get each(){return e.mimeCategories},children:h=>(()=>{var K=at();return K.value=h,a(K,h),K})()}),null),R.addEventListener("change",h=>e.onFilterChange("blobType",h.currentTarget.value)),a(R,S(xe,{get each(){return e.blobTypes},children:h=>(()=>{var K=at();return K.value=h,a(K,h),K})()}),null),pe.$$input=h=>e.onFilterChange("minSize",parseInt(h.currentTarget.value)||0),fe.$$input=h=>e.onFilterChange("maxSize",parseInt(h.currentTarget.value)||1e8),Fe.addEventListener("change",h=>e.onFilterChange("hasParent",h.currentTarget.value)),ye.addEventListener("change",h=>e.onFilterChange("hasLocalPath",h.currentTarget.value)),ke.$$click=()=>e.onViewModeChange("compact"),Se.$$click=()=>e.onViewModeChange("default"),Ee.$$click=()=>e.onViewModeChange("detailed"),he.$$click=()=>i(!n()),a(Ie,()=>n()?"Hide":"Show",Be),a(ae,S(Ft,{get columnVisibility(){return e.columnVisibility},get onColumnToggle(){return e.onColumnToggle},onResetToDefaults:()=>{Object.entries({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!1,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0}).forEach(([K,ee])=>{e.columnVisibility[K]!==ee&&e.onColumnToggle(K)})}})),a(ce,()=>e.totalCount,Te),a(ce,()=>e.filteredCount,Le),a(ce,()=>e.sortConfig.field,u),a(ce,()=>e.sortConfig.direction,q),a(ce,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),J(be,"click",e.onToggleDebug,!0),a(be,()=>e.debug?"ON":"OFF"),J(_e,"click",e.onReset,!0),a(C,S(H,{get when(){return e.debug&&e.logs.length>0},get children(){var h=Wt(),K=h.firstChild,ee=K.nextSibling;return a(ee,S(xe,{get each(){return e.logs},children:we=>(()=>{var Re=Bt();return a(Re,we),Re})()})),h}}),null),L(h=>{var K=c(e.connectionStatus),ee=e.connectionStatus==="Connected",we=e.connectionStatus==="Disconnected",Re=`toggle-button ${e.autoConnect?"active":""}`,pt=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,et=`toggle-button ${e.autoRefresh?"active":""}`,vt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,tt=`view-mode-button ${e.viewMode==="compact"?"active":""}`,wt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="compact"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="compact"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="compact"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,nt=`view-mode-button ${e.viewMode==="default"?"active":""}`,yt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="default"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="default"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="default"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,it=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,$t=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,ot=`toggle-button ${n()?"active":""}`,kt=`
            margin-bottom: 12px;
            width: 100%;
            padding: 10px;
            background: ${n()?"#ff00ff":"#333333"};
            box-sizing: border-box;
            min-width: 0;
            border: 1px solid ${n()?"#ff00ff":"#666666"};
            color: ${n()?"#000000":"#ffffff"};
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          `,rt=`column-settings ${n()?"":"collapsed"}`,St=`
            max-height: ${n()?"600px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
            margin-bottom: ${n()?"16px":"0"};
          `,lt=`toggle-button ${e.debug?"active":""}`,_t=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return h.e=F(I,K,h.e),ee!==h.t&&(E.disabled=h.t=ee),we!==h.a&&(O.disabled=h.a=we),Re!==h.o&&G(f,h.o=Re),h.i=F(f,pt,h.i),et!==h.n&&G(M,h.n=et),h.s=F(M,vt,h.s),tt!==h.h&&G(ke,h.h=tt),h.r=F(ke,wt,h.r),nt!==h.d&&G(Se,h.d=nt),h.l=F(Se,yt,h.l),it!==h.u&&G(Ee,h.u=it),h.c=F(Ee,$t,h.c),ot!==h.w&&G(he,h.w=ot),h.m=F(he,kt,h.m),rt!==h.f&&G(ae,h.f=rt),h.y=F(ae,St,h.y),lt!==h.g&&G(be,h.g=lt),h.p=F(be,_t,h.p),h},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),L(()=>w.value=e.wsUrl),L(()=>Y.value=e.filterConfig.mime),L(()=>R.value=e.filterConfig.blobType),L(()=>pe.value=e.filterConfig.minSize),L(()=>fe.value=e.filterConfig.maxSize),L(()=>Fe.value=e.filterConfig.hasParent),L(()=>ye.value=e.filterConfig.hasLocalPath),C})()})(),v),a(r,S(ft,{position:"left",get isDragging(){return o.isDragging()},onMouseDown:m=>o.handleMouseDown(m,"right")}),v),L(m=>{var C=`filter-panel ${e.isOpen?"":"collapsed"} ${o.isDragging()?"resizing":""}`,U=`
        width: ${e.isOpen?o.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return C!==m.e&&G(r,m.e=C),m.t=F(r,U,m.t),m},{e:void 0,t:void 0}),r})()}re(["click","input"]);var qt=k(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function st(e){const[n,i]=N(!1);return S(H,{get when(){return e.isVisible},get children(){var o=qt(),c=o.firstChild,r=c.nextSibling;return o.addEventListener("mouseleave",()=>i(!1)),o.addEventListener("mouseenter",()=>i(!0)),J(o,"click",e.onClick,!0),a(c,()=>e.position==="left"?"→":"←"),a(r,()=>e.panelName),L(s=>{var g=`edge-toggle-button edge-toggle-${e.position}`,D=`Show ${e.panelName} panel`,v=`
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
        `,m=`
            opacity: ${n()?"1":"0"};
            transform: translateY(${n()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return g!==s.e&&G(o,s.e=g),D!==s.t&&ie(o,"title",s.t=D),s.a=F(o,v,s.a),s.o=F(c,m,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),o}})}re(["click"]);var Kt=k('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),Vt=k('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),jt=k('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),Yt=k(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function Xt(e){return S(H,{get when(){return e.selectedCount>1},get children(){var n=Yt(),i=n.firstChild,o=i.firstChild,c=o.nextSibling;c.nextSibling;var r=i.nextSibling;return a(i,()=>e.selectedCount,o),a(i,()=>e.selectedCount===1?"":"s",c),a(n,S(H,{get when(){return e.onDownload},get children(){var s=Kt();return J(s,"click",e.onDownload,!0),s}}),r),a(n,S(H,{get when(){return e.onMore},get children(){var s=Vt();return s.$$click=g=>e.onMore?.(g),s}}),r),a(n,S(H,{get when(){return e.onClear},get children(){var s=jt();return J(s,"click",e.onClear,!0),s}}),r),L(()=>G(n,`selection-toolbar ${e.className||""}`)),n}})}re(["click"]);function Gt(e={}){const[n,i]=N(e.initialSelection||new Set),[o,c]=N(-1),[r,s]=N(!1),[g,D]=N(null),[v,m]=N(null),C=z=>{i(x=>{const f=new Set(x);return f.has(z)?f.delete(z):f.add(z),f})},U=(z,x,f)=>{const A=Math.min(z,x),V=Math.max(z,x),$=f.slice(A,V+1);i(M=>{const W=new Set(M);return $.forEach(P=>W.add(P.id)),W})},l=()=>{i(new Set),c(-1)},w=z=>{const x=new Set(z.map(f=>f.id));i(x)},y=z=>n().has(z),_=(z,x,f)=>{const A=z.id;if(f.metaKey||f.ctrlKey)f.preventDefault(),C(A),c(x);else if(f.shiftKey&&o()>=0)f.preventDefault(),c(x);else{if(f.detail>1)return;i(new Set([A])),c(x)}},I=(z,x,f)=>{(f.shiftKey||f.ctrlKey||f.metaKey)&&f.preventDefault(),f.button===0&&!f.metaKey&&!f.ctrlKey&&!f.shiftKey&&(f.preventDefault(),D({x:f.clientX,y:f.clientY,startIndex:x}),s(!0))},b=z=>{const x=z.target,f=x&&(x.tagName==="INPUT"||x.tagName==="TEXTAREA"||x.isContentEditable||x.getAttribute("contenteditable")==="true");z.key==="Escape"?l():z.key==="a"&&(z.metaKey||z.ctrlKey)?f||z.preventDefault():(z.key==="Delete"||z.key==="Backspace")&&!f&&n().size>0&&e.onDelete?.(n())},E=z=>{r()&&g()&&m({x:z.clientX,y:z.clientY,endIndex:-1})},O=()=>{r()&&(s(!1),D(null),m(null))};return oe(()=>{document.addEventListener("mousemove",E),document.addEventListener("mouseup",O),document.addEventListener("keydown",b)}),ze(()=>{document.removeEventListener("mousemove",E),document.removeEventListener("mouseup",O),document.removeEventListener("keydown",b),document.body.classList.remove("drag-selecting")}),me(()=>{r()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),me(()=>{const z=n();e.onSelectionChange?.(z),e.saveToStorage?.(z)}),{selectedItems:n,setSelectedItems:i,lastSelectedIndex:o,setLastSelectedIndex:c,isDragSelecting:r,setIsDragSelecting:s,dragStart:g,setDragStart:D,dragEnd:v,setDragEnd:m,toggleSelection:C,selectRange:U,clearSelection:l,selectAll:w,isSelected:y,handleRowClick:_,handleRowMouseDown:I,handleKeyDown:b}}const te={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},Jt=(e,n,i)=>{if(e==null&&n==null)return 0;if(e==null)return 1;if(n==null)return-1;const o=e[i],c=n[i];if(o==null&&c==null)return 0;if(o==null)return 1;if(c==null)return-1;if(i==="name"){const v=Z(e),m=Z(n);return v.localeCompare(m,void 0,{numeric:!0,sensitivity:"base"})}if(i.includes("_at")||i.includes("date")||i.includes("time")){const v=new Date(o),m=new Date(c);if(!isNaN(v.getTime())&&!isNaN(m.getTime()))return v.getTime()-m.getTime()}const r=Number(o),s=Number(c);if(!isNaN(r)&&!isNaN(s)&&typeof o=="number"&&typeof c=="number")return r-s;if(i==="size"&&typeof o=="string"&&typeof c=="string"){const v=dt(o),m=dt(c);if(v!==null&&m!==null)return v-m}const g=String(o).toLowerCase(),D=String(c).toLowerCase();return i==="name"||i.includes("filename")?g.localeCompare(D,void 0,{numeric:!0,sensitivity:"base"}):g.localeCompare(D)},dt=e=>{const n=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!n||!n[1])return null;const i=parseFloat(n[1]),o=(n[2]||"B").toUpperCase(),c={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return i*(c[o]||1)};function Zt(e){const n=e.defaultSort||{field:"created_at",direction:"desc"},[i,o]=N(e.initialSort||n),[c,r]=N(new Set),[s,g]=N(!1),[D,v]=N(!1),m=e.getItemId||(b=>b.id||String(b)),C=ne(()=>{const b=i(),E=[...e.data];return E.length>1e3&&(v(!0),setTimeout(()=>v(!1),100)),E.sort((O,z)=>{const x=Jt(O,z,b.field);return b.direction==="desc"?x*-1:x})});return{sortConfig:i,selectedItems:c,isDragSelecting:s,isSorting:D,sortedData:C,handleSort:b=>{const E=i();if(E.field===b)if(b===n.field){const O=E.direction==="asc"?"desc":"asc";o({field:b,direction:O})}else E.direction==="asc"?o({field:b,direction:"desc"}):E.direction==="desc"?o(n):o({field:b,direction:"asc"});else{const O=b.includes("_at")||b.includes("date")||b.includes("time")?"desc":"asc";o({field:b,direction:O})}},toggleSelection:b=>{const E=new Set(c());E.has(b)?E.delete(b):E.add(b),r(E)},clearSelection:()=>{r(new Set)},selectAll:()=>{const b=new Set(e.data.map(m));r(b)},isSelected:b=>c().has(b),selectRange:(b,E)=>{const O=new Set(c()),z=Math.min(b,E),x=Math.max(b,E);for(let f=z;f<=x;f++)if(f<e.data.length&&e.data[f]!=null){const A=m(e.data[f]);O.add(A)}r(O)},setIsDragSelecting:g,getItemId:m}}var bt=k("<div>"),Qt=k("<div class=grid-cell>"),ct=k("<div class=grid-content>"),en=k("<span style=margin-left:8px;color:#ff00ff;>Loading..."),tn=k("<div class=grid-stats>Showing rows <!>-<!> of "),nn=k("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),on=k('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),rn=k('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),ln=k("<div><span style=font-weight:500;>");function ut(e){let n;oe(()=>{e.onRowMount&&e.onRowMount(e.item)});const i=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var o=bt();o.$$contextmenu=r=>e.onContextMenu?.(e.item,e.index,r),o.$$mousedown=r=>e.onRowMouseDown?.(e.item,e.index,r),o.$$dblclick=r=>e.onRowDoubleClick?.(e.item,e.index,r),o.$$click=r=>e.onRowClick?.(e.item,e.index,r);var c=n;return typeof c=="function"?Ae(c,o):n=o,a(o,S(xe,{get each(){return e.columns},children:r=>(()=>{var s=Qt();return a(s,(()=>{var g=se(()=>!!r.render);return()=>g()?r.render(e.item,e.index):String(e.item[r.key]||"")})()),L(g=>F(s,`
              flex: ${r.width?"0 0 "+r.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,g)),s})()})),L(r=>{var s=`grid-row ${e.isSelected?"selected":""} ${i()?"focused":""}`,g=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${te.colors.border};
        background: ${e.isSelected?te.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${i()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return s!==r.e&&G(o,r.e=s),r.t=F(o,g,r.t),r},{e:void 0,t:void 0}),o})()}function an(e){const[n,i]=N(),[o,c]=N(0),[r,s]=N(0),g=e.rowHeight||50,D=e.headerHeight||60,v=e.virtualizeThreshold||100,m=Zt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),C=(x,f,A)=>{e.onRowClick?.(x,f,A)},U=(x,f,A)=>{e.onRowDoubleClick?.(x,f,A)},l=(x,f,A)=>{e.onRowMouseDown?.(x,f,A)},w=ne(()=>e.data.length>v),y=ne(()=>{if(!w())return e.data.map((P,j)=>({item:P,index:j}));if(!n())return[];const f=g,A=o(),V=r(),$=Math.floor(A/f),M=Math.min(e.data.length-1,Math.ceil((A+V)/f)+5),W=[];for(let P=Math.max(0,$-5);P<=M;P++)P<e.data.length&&e.data[P]!=null&&W.push({item:e.data[P],index:P});return W}),_=ne(()=>e.data.length===0?0:n()?Math.floor(o()/g)+1:1),I=ne(()=>{if(e.data.length===0)return 0;if(!n())return Math.min(1,e.data.length);const f=r()-D,A=Math.floor(f/g),V=Math.floor(o()/g)+A;return Math.min(V,e.data.length)}),b=ne(()=>e.data.length),E=ne(()=>e.data.length*g),O=x=>{const f=x.target;if(c(f.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const A=f.scrollHeight,V=f.scrollTop,$=f.clientHeight;A-V-$<200&&e.onLoadMore()}},z=x=>{if(m.handleSort(x),e.onSort){const f=m.sortConfig();e.onSort(f.field,f.direction)}};return oe(()=>{const x=n();if(!x)return;const f=new ResizeObserver(A=>{for(const V of A)s(V.contentRect.height)});f.observe(x),ze(()=>{f.disconnect()})}),(()=>{var x=nn(),f=x.firstChild,A=f.nextSibling,V=A.nextSibling;return a(f,S(xe,{get each(){return e.columns},children:$=>(()=>{var M=ln(),W=M.firstChild;return M.$$click=()=>$.sortable&&!m.isSorting()&&z($.key),a(W,()=>$.title),a(M,S(H,{get when(){return se(()=>!!m.isSorting())()&&m.sortConfig().field===$.key},get children(){return on()}}),null),a(M,S(H,{get when(){return $.sortable},get children(){var P=rn(),j=P.firstChild,Y=j.nextSibling;return L(X=>{var B=`
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1px;
                    opacity: ${m.sortConfig().field===$.key?"1":"0.4"};
                    transition: opacity 0.15s ease;
                  `,R=`
                      width: 0;
                      height: 0;
                      border-left: 4px solid transparent;
                      border-right: 4px solid transparent;
                      border-bottom: 5px solid ${m.sortConfig().field===$.key&&m.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                      transition: border-bottom-color 0.15s ease;
                    `,de=`
                      width: 0;
                      height: 0;
                      border-left: 4px solid transparent;
                      border-right: 4px solid transparent;
                      border-top: 5px solid ${m.sortConfig().field===$.key&&m.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                      transition: border-top-color 0.15s ease;
                    `;return X.e=F(P,B,X.e),X.t=F(j,R,X.t),X.a=F(Y,de,X.a),X},{e:void 0,t:void 0,a:void 0}),P}}),null),L(P=>{var j=`grid-header-cell ${$.sortable?"sortable":""} ${$.sortable&&m.sortConfig().field===$.key?"active-sort":""}`,Y=`
                flex: ${$.width?"0 0 "+$.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${$.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                justify-content: space-between;
                transition: all 0.15s ease;
                border-radius: 4px;
                margin: 4px 2px;
                position: relative;
                opacity: ${m.isSorting()&&m.sortConfig().field===$.key?"0.7":"1"};
              `;return j!==P.e&&G(M,P.e=j),P.t=F(M,Y,P.t),P},{e:void 0,t:void 0}),M})()})),A.addEventListener("scroll",O),Ae(i,A),a(A,S(H,{get when(){return w()},get fallback(){return(()=>{var $=ct();return a($,S(xe,{get each(){return e.data},children:(M,W)=>S(ut,{item:M,get index(){return W()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(M)||M.id)||!1},onRowClick:C,onRowDoubleClick:U,onRowMouseDown:l,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:g,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),$})()},get children(){var $=ct();return a($,S(xe,{get each(){return y()},children:M=>(()=>{var W=bt();return a(W,S(ut,{get item(){return M.item},get index(){return M.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(M.item)||M.item.id)||!1},onRowClick:C,onRowDoubleClick:U,onRowMouseDown:l,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:g,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),L(P=>F(W,`
                    position: absolute;
                    top: ${M.index*g}px;
                    left: 0;
                    right: 0;
                  `,P)),W})()})),L(M=>F($,`height: ${E()}px; position: relative;`,M)),$}})),a(x,S(H,{get when(){return e.showPaginationStatus!==!1},get children(){var $=tn(),M=$.firstChild,W=M.nextSibling,P=W.nextSibling,j=P.nextSibling;return j.nextSibling,a($,_,W),a($,I,j),a($,b,null),a($,S(H,{get when(){return e.isLoadingMore},get children(){return en()}}),null),L(Y=>F($,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${te.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,Y)),$}}),V),a(V,()=>`
        .grid-row:hover:not(.selected) {
          background: ${te.colors.hover};
        }

        .grid-row.selected {
          background: ${te.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${te.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${te.colors.selected};
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-1px);
        }

        .grid-header-cell.sortable:active {
          transform: translateY(0px);
          background: rgba(255, 255, 255, 0.12);
        }

        .grid-header-cell.active-sort {
          background: rgba(255, 0, 255, 0.1);
          border: 1px solid rgba(255, 0, 255, 0.3);
        }

        .grid-header-cell.sortable:hover .sort-indicator {
          opacity: 0.8 !important;
        }

        @keyframes spin {
          from { transform: translateY(-50%) rotate(0deg); }
          to { transform: translateY(-50%) rotate(360deg); }
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${te.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${te.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${te.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }

        .grid-stats {
          transition: opacity 0.2s ease;
        }

        .grid-stats:hover {
          opacity: 0.7;
        }
      `),L($=>{var M=`infinite-data-grid ${e.className||""}`,W=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${te.colors.background};
        color: ${te.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,P=`
          height: ${D}px;
          display: flex;
          align-items: center;
          background: ${te.colors.header};
          border-bottom: 2px solid ${te.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return M!==$.e&&G(x,$.e=M),$.t=F(x,W,$.t),$.a=F(f,P,$.a),$},{e:void 0,t:void 0,a:void 0}),x})()}re(["click","dblclick","mousedown","contextmenu"]);var sn=k(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),dn=k("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),cn=k("<span style=color:#94a3b8;>"),un=k('<div title="Has thumbnails">'),gn=k('<div title="Generating thumbnails...">');function fn(e){const n=()=>e.size||40,i=()=>e.borderRadius||"4px",o=zt({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var c=sn(),r=c.firstChild;return a(c,(()=>{var s=se(()=>!!o.url);return()=>s()?(()=>{var g=dn();return J(g,"error",o.onImageError),L(D=>{var v=o.url,m=`Thumbnail for ${e.item.id.slice(0,8)}`;return v!==D.e&&ie(g,"src",D.e=v),m!==D.t&&ie(g,"alt",D.t=m),D},{e:void 0,t:void 0}),g})():(()=>{var g=cn();return a(g,()=>o.fallbackIcon),g})()})(),r),a(c,S(H,{get when(){return e.showIndicators!==!1},get children(){return se(()=>!!o.hasThumbnails)()?(()=>{var s=un();return L(g=>F(s,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,n()*.15)}px;
              height: ${Math.max(6,n()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,g)),s})():se(()=>!!o.isRequested)()?(()=>{var s=gn();return L(g=>F(s,`
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
            `,g)),s})():null}}),r),L(s=>{var g=`thumbnail ${e.className||""}`,D=`
        width: ${n()}px;
        height: ${n()}px;
        border-radius: ${i()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12,n()*.3)}px;
        position: relative;
        flex-shrink: 0;
      `,v=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return g!==s.e&&G(c,s.e=g),s.t=F(c,D,s.t),v!==s.a&&ie(c,"title",s.a=v),s},{e:void 0,t:void 0,a:void 0}),c})()}function mt(e){if(e===0)return"0 B";const n=1024,i=["B","KB","MB","GB","TB","PB"],o=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,o)).toFixed(2))+" "+i[o]}var hn=k('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),bn=k("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),mn=k("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),xn=k("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:4rem;>🎵</div><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),pn=k('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),vn=k("<div style=text-align:center;margin-bottom:24px;>"),wn=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),yn=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),$n=k('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function kn(e){let n;const i=r=>{r.key==="Escape"&&e.onClose()},o=r=>{r.target===n&&e.onClose()};oe(()=>{e.isOpen&&(document.addEventListener("keydown",i),document.body.style.overflow="hidden")}),ze(()=>{document.removeEventListener("keydown",i),document.body.style.overflow=""});const c=()=>{e.isOpen?(document.addEventListener("keydown",i),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",i),document.body.style.overflow="")};return oe(()=>{const r=()=>{c(),requestAnimationFrame(r)};r()}),S(H,{get when(){return e.isOpen&&e.item},get children(){var r=hn(),s=r.firstChild,g=s.firstChild;r.$$click=o;var D=n;return typeof D=="function"?Ae(D,r):n=r,s.$$click=v=>v.stopPropagation(),g.addEventListener("mouseleave",v=>{v.target.style.background="#ef4444"}),g.addEventListener("mouseenter",v=>{v.target.style.background="#dc2626"}),J(g,"click",e.onClose,!0),a(s,S(H,{get when(){return e.item},children:v=>{const m=v().mime||"",C=m.startsWith("image/"),U=m.startsWith("video/"),l=m.startsWith("audio/"),w=Z(v());return[(()=>{var y=vn();return a(y,S(H,{when:C,get children(){var _=bn();return _.addEventListener("error",I=>{const b=I.target;b.style.display="none";const E=document.createElement("div");E.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${w}</div>
                            </div>
                          `,b.parentNode?.appendChild(E)}),ie(_,"alt",w),L(()=>ie(_,"src",`/api/blobs/${v().id}`)),_}}),null),a(y,S(H,{when:U,get children(){var _=mn(),I=_.firstChild;return ie(I,"type",m),L(()=>ie(I,"src",`/api/blobs/${v().id}`)),_}}),null),a(y,S(H,{when:l,get children(){var _=xn(),I=_.firstChild,b=I.nextSibling,E=b.nextSibling,O=E.firstChild;return a(b,w),ie(O,"type",m),L(()=>ie(O,"src",`/api/blobs/${v().id}`)),_}}),null),a(y,S(H,{when:!C&&!U&&!l,get children(){var _=pn(),I=_.firstChild,b=I.nextSibling,E=b.nextSibling,O=E.firstChild;return L(()=>ie(O,"href",`/api/blobs/${v().id}`)),_}}),null),y})(),(()=>{var y=$n(),_=y.firstChild,I=_.nextSibling,b=I.firstChild,E=b.firstChild,O=E.nextSibling,z=b.nextSibling,x=z.firstChild,f=x.nextSibling,A=z.nextSibling,V=A.firstChild,$=V.nextSibling,M=A.nextSibling,W=M.firstChild,P=W.nextSibling,j=M.nextSibling,Y=j.firstChild,X=Y.nextSibling,B=j.nextSibling,R=B.firstChild,de=R.nextSibling,De=B.nextSibling,Me=De.firstChild,pe=Me.nextSibling;return a(O,w),a(f,()=>v().id),a($,()=>v().sha256),a(P,()=>v().blob_type),a(X,m||"unknown"),a(de,()=>mt(v().size||0)),a(pe,()=>new Date(v().created_at).toLocaleString()),a(I,S(H,{get when(){return v().parent_blob_id},get children(){var le=wn(),fe=le.firstChild,T=fe.nextSibling;return a(T,()=>v().parent_blob_id),le}}),null),a(I,S(H,{get when(){return v().local_path},get children(){var le=yn(),fe=le.firstChild,T=fe.nextSibling;return a(T,()=>v().local_path),le}}),null),y})()]}}),null),r}})}re(["click"]);var Sn=k("<div class=action-menu>"),_n=k('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),Cn=k('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444444;margin:4px 8px;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function zn(e){let n;const[i,o]=N({x:0,y:0}),c=l=>{l.key==="Escape"&&e.onClose()},r=l=>{n&&!n.contains(l.target)&&e.onClose()},s=()=>{if(!n)return;const l=180,w=160,{x:y,y:_}=e.position;let I=y,b=_;y+l>window.innerWidth&&(I=window.innerWidth-l-8),I<8&&(I=8),_+w>window.innerHeight&&(b=_-w-4),b<8&&(b=8),o({x:I,y:b})};oe(()=>{e.isOpen&&(document.addEventListener("keydown",c),document.addEventListener("click",r),setTimeout(s,0))}),ze(()=>{document.removeEventListener("keydown",c),document.removeEventListener("click",r)});const g=()=>{e.isOpen?(document.addEventListener("keydown",c),document.addEventListener("click",r),s()):(document.removeEventListener("keydown",c),document.removeEventListener("click",r))};oe(()=>{const l=()=>{g(),requestAnimationFrame(l)};l()});const D=()=>{e.item&&e.onDownload&&e.onDownload(e.item),e.onClose()},v=()=>{e.item&&e.onPreview&&e.onPreview(e.item),e.onClose()},m=()=>{e.item&&e.onDelete&&e.onDelete(e.item),e.onClose()},C=()=>{e.item&&e.onCopyUrl&&e.onCopyUrl(e.item),e.onClose()},U=l=>{const w=l.mime||"";return w.startsWith("image/")?"🖼️":w.startsWith("video/")?"🎥":w.startsWith("audio/")?"🎵":w.includes("pdf")?"📄":w.includes("text")?"📝":"📎"};return S(H,{get when(){return e.isOpen&&e.item},get children(){var l=Sn();l.$$click=y=>y.stopPropagation();var w=n;return typeof w=="function"?Ae(w,l):n=l,a(l,S(H,{get when(){return e.item},children:y=>[(()=>{var _=_n(),I=_.firstChild,b=I.nextSibling;return a(I,()=>U(y())),a(b,()=>Z(y())),_})(),(()=>{var _=Cn(),I=_.firstChild,b=I.nextSibling,E=b.nextSibling,O=E.nextSibling,z=O.nextSibling;return I.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),I.addEventListener("mouseenter",x=>{x.target.style.background="#3a3a3a"}),I.$$click=v,b.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),b.addEventListener("mouseenter",x=>{x.target.style.background="#3a3a3a"}),b.$$click=D,E.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),E.addEventListener("mouseenter",x=>{x.target.style.background="#3a3a3a"}),E.$$click=C,z.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),z.addEventListener("mouseenter",x=>{x.target.style.background="rgba(239, 68, 68, 0.1)"}),z.$$click=m,_})()]})),L(y=>F(l,`
          position: fixed;
          top: ${i().y}px;
          left: ${i().x}px;
          background: #2a2a2a;
          border: 1px solid #444444;
          border-radius: 6px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 180px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        `,y)),l}})}re(["click"]);var Dn=k('<div class=bulk-action-menu><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>📦</span><span> item<!> selected</span></div><div style="padding:4px 0;"><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All (<!>)</span></button><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#888888;text-align:left;cursor:not-allowed;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗜️</span><span>Export as ZIP (Soon)</span></button><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#888888;text-align:left;cursor:not-allowed;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🎵</span><span>Add to Playlist (Soon)</span></button><div style="height:1px;background:#444444;margin:4px 8px;"></div><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>✖️</span><span>Clear Selection</span></button><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All (<!>)');function Mn(e){let n;const[i,o]=N({x:0,y:0}),c=C=>{C.key==="Escape"&&e.onClose()},r=C=>{n&&!n.contains(C.target)&&e.onClose()},s=()=>{if(!n)return;const C=200,U=180,{x:l,y:w}=e.position;let y=l,_=w;l+C>window.innerWidth&&(y=window.innerWidth-C-8),y<8&&(y=8),w+U>window.innerHeight&&(_=w-U-4),_<8&&(_=8),o({x:y,y:_})};oe(()=>{e.isOpen&&(document.addEventListener("keydown",c),document.addEventListener("click",r),setTimeout(s,0))}),ze(()=>{document.removeEventListener("keydown",c),document.removeEventListener("click",r)});const g=()=>{e.isOpen?(document.addEventListener("keydown",c),document.addEventListener("click",r),s()):(document.removeEventListener("keydown",c),document.removeEventListener("click",r))};oe(()=>{const C=()=>{g(),requestAnimationFrame(C)};C()});const D=()=>{e.onDownloadAll&&e.onDownloadAll(),e.onClose()},v=()=>{e.onDeleteAll&&e.onDeleteAll(),e.onClose()},m=()=>{e.onClearSelection&&e.onClearSelection(),e.onClose()};return S(H,{get when(){return e.isOpen&&e.selectedCount>0},get children(){var C=Dn(),U=C.firstChild,l=U.firstChild,w=l.nextSibling,y=w.firstChild,_=y.nextSibling;_.nextSibling;var I=U.nextSibling,b=I.firstChild,E=b.firstChild,O=E.nextSibling,z=O.firstChild,x=z.nextSibling;x.nextSibling;var f=b.nextSibling,A=f.nextSibling,V=A.nextSibling,$=V.nextSibling,M=$.nextSibling,W=M.firstChild,P=W.nextSibling,j=P.firstChild,Y=j.nextSibling;Y.nextSibling,C.$$click=B=>B.stopPropagation();var X=n;return typeof X=="function"?Ae(X,C):n=C,a(w,()=>e.selectedCount,y),a(w,()=>e.selectedCount===1?"":"s",_),b.addEventListener("mouseleave",B=>{B.target.style.background="transparent"}),b.addEventListener("mouseenter",B=>{B.target.style.background="#3a3a3a"}),b.$$click=D,a(O,()=>e.selectedCount,x),f.$$click=()=>{console.log("Export as ZIP not implemented yet"),e.onClose()},A.$$click=()=>{console.log("Add to playlist not implemented yet"),e.onClose()},$.addEventListener("mouseleave",B=>{B.target.style.background="transparent"}),$.addEventListener("mouseenter",B=>{B.target.style.background="#3a3a3a"}),$.$$click=m,M.addEventListener("mouseleave",B=>{B.target.style.background="transparent"}),M.addEventListener("mouseenter",B=>{B.target.style.background="rgba(239, 68, 68, 0.1)"}),M.$$click=v,a(P,()=>e.selectedCount,Y),L(B=>F(C,`
          position: fixed;
          top: ${i().y}px;
          left: ${i().x}px;
          background: #2a2a2a;
          border: 1px solid #444444;
          border-radius: 6px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        `,B)),C}})}re(["click"]);var En=k("<div class=drag-selection-overlay>"),In=k('<div class="drag-selection-corner drag-selection-corner-tl">'),Tn=k('<div class="drag-selection-corner drag-selection-corner-br">'),Ln=k("<div class=drag-selection-tooltip>Selecting...");function Pn(e){const n=ne(()=>{if(!e.isDragSelecting||!e.dragStart||!e.dragEnd)return null;const i=e.dragStart,o=e.dragEnd,c=Math.min(i.x,o.x),r=Math.min(i.y,o.y),s=Math.abs(o.x-i.x),g=Math.abs(o.y-i.y);return{left:c,top:r,width:s,height:g}});return S(H,{get when(){return se(()=>!!e.isDragSelecting)()&&n()},children:i=>[(()=>{var o=En();return L(c=>F(o,`
              position: fixed;
              left: ${i().left}px;
              top: ${i().top}px;
              width: ${i().width}px;
              height: ${i().height}px;
              background: rgba(0, 112, 243, 0.15);
              border: 2px solid #0070f3;
              border-radius: 3px;
              pointer-events: none;
              z-index: 999;
              transition: none;
            `,c)),o})(),(()=>{var o=In();return L(c=>F(o,`
              position: fixed;
              left: ${i().left-4}px;
              top: ${i().top-4}px;
              width: 8px;
              height: 8px;
              background: #0070f3;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,c)),o})(),(()=>{var o=Tn();return L(c=>F(o,`
              position: fixed;
              left: ${i().left+i().width-4}px;
              top: ${i().top+i().height-4}px;
              width: 8px;
              height: 8px;
              background: #0070f3;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,c)),o})(),S(H,{get when(){return se(()=>i().width>50)()&&i().height>20},get children(){var o=Ln();return L(c=>F(o,`
                position: fixed;
                left: ${i().left+i().width/2-40}px;
                top: ${i().top+i().height/2-12}px;
                background: rgba(0, 0, 0, 0.8);
                color: #ffffff;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                pointer-events: none;
                z-index: 1001;
                white-space: nowrap;
                backdrop-filter: blur(4px);
              `,c)),o}})]})}function Rn(e){const[n,i]=N(-1),o=l=>{e.onLog&&e.onLog(l)},c=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const l=document.activeElement;return l&&(l.tagName==="INPUT"||l.tagName==="TEXTAREA"||l.isContentEditable||l.getAttribute("contenteditable")==="true")},r=()=>e.getAllItems?e.getAllItems():[],s=()=>e.getSelectedItems?e.getSelectedItems():new Set,g=()=>{const l=r(),w=n();return w>=0&&w<l.length&&l[w]||null},D=()=>{const l=r();if(l.length===0)return;const w=n(),y=w<l.length-1?w+1:0;i(y),o(`⌨️ Focused next item: ${y+1}/${l.length}`)},v=()=>{const l=r();if(l.length===0)return;const w=n(),y=w>0?w-1:l.length-1;i(y),o(`⌨️ Focused previous item: ${y+1}/${l.length}`)},m=()=>{r().length!==0&&(i(0),o("⌨️ Focused first item"))},C=()=>{const l=r();l.length!==0&&(i(l.length-1),o("⌨️ Focused last item"))},U=l=>{if(c())return;const w=r();if(w.length!==0)switch(l.key){case"ArrowDown":{l.preventDefault(),n()===-1?m():D();break}case"ArrowUp":{l.preventDefault(),n()===-1?C():v();break}case"Home":{(l.ctrlKey||l.metaKey)&&(l.preventDefault(),m());break}case"End":{(l.ctrlKey||l.metaKey)&&(l.preventDefault(),C());break}case"PageDown":{l.preventDefault();const y=n(),_=Math.min(y+10,w.length-1);i(_),o(`⌨️ Page down to item: ${_+1}/${w.length}`);break}case"PageUp":{l.preventDefault();const y=n(),_=Math.max(y-10,0);i(_),o(`⌨️ Page up to item: ${_+1}/${w.length}`);break}case"Enter":{l.preventDefault();const y=g();y&&e.onPreview&&(e.onPreview(y),o("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{l.preventDefault();const y=g();y&&e.onToggleSelection&&(e.onToggleSelection(y),o("⌨️ Toggled selection via Space key"));break}case"a":{(l.ctrlKey||l.metaKey)&&(l.preventDefault(),e.onSelectAll&&(e.onSelectAll(w),o("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{l.preventDefault(),e.onEscape&&e.onEscape(),i(-1),o("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const y=s();if(y.size>0){l.preventDefault();const I=r().filter(b=>y.has(b.id));e.onDelete&&(e.onDelete(I),o(`⌨️ Delete requested via ${l.key} key`))}break}case"Tab":{n()===-1&&w.length>0&&i(0);break}case"j":{!l.ctrlKey&&!l.metaKey&&!l.altKey&&(l.preventDefault(),n()===-1?m():D());break}case"k":{!l.ctrlKey&&!l.metaKey&&!l.altKey&&(l.preventDefault(),n()===-1?C():v());break}case"g":{l.shiftKey?(l.preventDefault(),C()):(l.preventDefault(),m());break}}};return me(()=>{r().length>0&&n()}),me(()=>{const l=r();n()>=l.length&&l.length>0?i(l.length-1):l.length===0&&i(-1)}),{focusedIndex:n,setFocusedIndex:i,handleKeyDown:U,focusNext:D,focusPrevious:v,focusFirst:m,focusLast:C,getFocusedItem:g}}const An={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function Fn(e="default"){const[n,i]=N(e),o=()=>An[n()];return{viewMode:n,setViewMode:i,getViewModeConfig:o,getRowHeight:()=>o().rowHeight}}var Nn=k("<span style=font-weight:500;>"),Ce=k("<span>"),On=k("<span style=font-family:monospace;font-size:12px;>"),Wn=k("<button>⋯"),Un=k("<div>"),Bn=k(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
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
      `);const Qe="freqhole-demo-state",gt=300;function xt(){try{const e=localStorage.getItem(Qe);return e?JSON.parse(e):{}}catch{return{}}}function ge(e){try{const i={...xt(),...e};localStorage.setItem(Qe,JSON.stringify(i))}catch{}}function Hn(e){const n=xt(),i=Dt({wsUrl:e.wsUrl,channels:["MediaBlobs"],debug:n.debug??!1,autoConnect:e.autoConnect,autoRefresh:n.autoRefresh??!0,pageSize:50}),[o,c]=N({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[r,s]=N({field:"created_at",direction:"desc",...n.sortConfig||{}}),[g,D]=N({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[v,m]=N(n.isFilterPanelOpen??!0),[C,U]=N(n.filterPanelWidth||gt),[l,w]=N(n.isBrowsePanelOpen??!0),[y,_]=N(n.browsePanelWidth||gt),[I,b]=N(e.wsUrl),[E,O]=N(e.autoConnect),[z,x]=N(!0),[f,A]=N(!1),[V,$]=N([]),[M,W]=N(null),[P,j]=N(null),[Y,X]=N(null),B=Fn(n.viewMode||"default"),R=t=>{const d=new Date().toLocaleTimeString();$(u=>[`${d}: ${t}`,...u.slice(0,49)])},de=Rn({onPreview:t=>W({item:t,isOpen:!0}),onToggleSelection:t=>T.toggleSelection(t.id),onSelectAll:t=>T.selectAll(t),onClearSelection:()=>T.clearSelection(),onEscape:()=>{M()?.isOpen?Oe():P()?.isOpen?ye():Y()?.isOpen?$e():T.clearSelection()},onDelete:t=>{R(`🗑️ Delete requested for ${t.length} items via keyboard`),console.log("Delete requested via keyboard:",t.map(d=>d.id))},isTextInputFocused:()=>{const t=document.activeElement;return t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable||t.getAttribute("contenteditable")==="true")},getSelectedItems:()=>T.selectedItems(),getAllItems:()=>ae(),onLog:R}),De=()=>i.state().connectionStatus,Me=()=>i.state().hasPendingUpdates,pe=()=>i.state().lastUpdated,[le,fe]=N(new Set),T=Gt({onSelectionChange:t=>{ge({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),qe=(t,d,u)=>{u.shiftKey&&T.lastSelectedIndex()>=0?(u.preventDefault(),T.selectRange(T.lastSelectedIndex(),d,ae())):T.handleRowClick(t,d,u)},Fe=t=>{W({item:t,isOpen:!0}),R(`🖼️ Opened preview for: ${Z(t)}`)},Ne=(t,d,u)=>{u.preventDefault(),u.stopPropagation();const p={x:u.clientX,y:u.clientY},q=T.selectedItems().size;q>1?(X({isOpen:!0,position:p}),R(`🖱️ Bulk context menu opened for ${q} items`)):(j({item:t,isOpen:!0,position:p}),R(`🖱️ Context menu opened for: ${Z(t)}`))},Oe=()=>{W(null)},ye=()=>{j(null)},$e=()=>{X(null)},Ke=(t,d)=>{d.stopPropagation(),d.preventDefault();const u=P();if(u&&u.item.id===t.id)ye(),R(`⋯ Action menu closed for: ${Z(t)}`);else{const p=d.target.getBoundingClientRect(),q={x:p.right-120,y:p.bottom+4};j({item:t,isOpen:!0,position:q}),R(`⋯ Action menu opened for: ${Z(t)}`)}},We=async t=>{try{const d=Z(t),u=document.createElement("a");u.href=`/api/blobs/${t.id}`,u.download=d,document.body.appendChild(u),u.click(),document.body.removeChild(u),R(`📥 Downloaded: ${d}`)}catch(d){console.error("Download failed:",d),R(`❌ Download failed: ${d}`)}},ke=async t=>{try{const d=`${window.location.origin}/api/blobs/${t.id}`;await navigator.clipboard.writeText(d),R(`🔗 Copied URL for: ${Z(t)}`)}catch(d){console.error("Copy URL failed:",d),R(`❌ Copy URL failed: ${d}`)}},Se=t=>{R(`🗑️ Delete requested for: ${Z(t)}`),console.log("Delete requested for:",t.id)},Ee=t=>{if(Y()?.isOpen)$e();else{const u=t.target.getBoundingClientRect(),p={x:u.left+u.width/2-100,y:u.top-10};X({isOpen:!0,position:p})}},Ue=async()=>{const t=Array.from(T.selectedItems()),d=ae().filter(u=>t.includes(u.id));R(`📥 Starting bulk download of ${d.length} items...`);for(const u of d)await We(u),await new Promise(p=>setTimeout(p,100));R(`✅ Bulk download completed: ${d.length} items`)},Ve=()=>{const t=Array.from(T.selectedItems()),d=ae().filter(u=>t.includes(u.id));R(`🗑️ Bulk delete requested for ${d.length} items`),console.log("Bulk delete requested for:",t)},he=t=>{de.handleKeyDown(t),T.handleKeyDown(t)},Ie=t=>{if(T.isDragSelecting()&&T.dragStart()){T.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const d=T.dragStart(),u=Math.floor((t.clientY-d.y)/60);if(u!==d.startIndex){const p=Math.min(d.startIndex,d.startIndex+u),q=Math.max(d.startIndex,d.startIndex+u);T.selectRange(p,q,ae())}}};oe(()=>{document.addEventListener("mousemove",Ie),document.addEventListener("keydown",he)}),ze(()=>{document.removeEventListener("mousemove",Ie),document.removeEventListener("keydown",he)});const Be=ne(()=>{const t=o();return i.state().items.filter(d=>{if(t.name&&!Z(d).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!d.mime?.startsWith(t.mime)||t.blobType&&d.blob_type!==t.blobType||(d.size||0)<t.minSize||(d.size||0)>t.maxSize)return!1;if(t.hasParent!=="all"){const u=!!d.parent_blob_id;if(t.hasParent==="yes"&&!u||t.hasParent==="no"&&u)return!1}if(t.hasLocalPath!=="all"){const u=!!d.local_path;if(t.hasLocalPath==="yes"&&!u||t.hasLocalPath==="no"&&u)return!1}return!0})}),ae=ne(()=>{const t=r();return[...Be()].sort((u,p)=>{if(t.field==="name"){const h=Z(u),K=Z(p),ee=h.localeCompare(K,void 0,{numeric:!0,sensitivity:"base"});return t.direction==="desc"?ee*-1:ee}if(t.field.includes("_at")||t.field.includes("date")||t.field.includes("time")){const h=new Date(u[t.field]),K=new Date(p[t.field]);if(!isNaN(h.getTime())&&!isNaN(K.getTime())){const ee=h.getTime()-K.getTime();return t.direction==="desc"?ee*-1:ee}}const q=u[t.field],Q=p[t.field];if(q==null&&Q==null)return 0;if(q==null)return t.direction==="desc"?-1:1;if(Q==null)return t.direction==="desc"?1:-1;const ue=Number(q),ve=Number(Q);if(!isNaN(ue)&&!isNaN(ve)&&typeof q=="number"&&typeof Q=="number"){const h=ue-ve;return t.direction==="desc"?h*-1:h}const Pe=String(q).toLowerCase(),be=String(Q).toLowerCase(),_e=Pe.localeCompare(be);return t.direction==="desc"?_e*-1:_e})}),je=t=>{le().has(t)||(fe(d=>new Set([...d,t])),i.actions.getThumbnails(t),R(`🖼️ Requesting thumbnails for ${t.slice(0,8)}`))},Ye=ne(()=>{const t=g(),d=[];return t.thumbnail&&d.push({key:"thumbnail",title:"📷",width:60,render:u=>S(fn,{item:u,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:je,get requestedThumbnails(){return le()},showIndicators:!0})}),t.name&&d.push({key:"name",title:"Name",width:250,sortable:!0,render:u=>(()=>{var p=Nn();return a(p,()=>Z(u)),L(()=>ie(p,"title",Z(u))),p})()}),t.blob_type&&d.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.mime&&d.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:u=>(()=>{var p=Ce();return a(p,()=>u.mime||"unknown"),p})()}),t.id&&d.push({key:"id",title:"ID",width:200,sortable:!0,render:u=>(()=>{var p=On();return a(p,()=>u.id),p})()}),t.size&&d.push({key:"size",title:"Size",width:100,sortable:!0,render:u=>(()=>{var p=Ce();return a(p,()=>mt(u.size||0)),p})()}),t.parent_blob_id&&d.push({key:"parent_blob_id",title:"Parent",width:120,render:u=>(()=>{var p=Ce();return a(p,()=>u.parent_blob_id?"Yes":"No"),p})()}),t.local_path&&d.push({key:"local_path",title:"Local Path",width:200,render:u=>(()=>{var p=Ce();return a(p,()=>u.local_path||"None"),p})()}),t.created_at&&d.push({key:"created_at",title:"Created",width:140,sortable:!0,render:u=>(()=>{var p=Ce();return a(p,()=>new Date(u.created_at).toLocaleString()),p})()}),t.updated_at&&d.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:u=>(()=>{var p=Ce();return a(p,()=>new Date(u.updated_at).toLocaleString()),p})()}),t.actions&&d.push({key:"actions",title:"Actions",width:100,render:u=>(()=>{var p=Wn();return p.$$click=q=>Ke(u,q),p.addEventListener("mouseleave",q=>{q.target.style.background="#3a3a3a"}),p.addEventListener("mouseenter",q=>{q.target.style.background="#4a4a4a"}),L(q=>F(p,`
              background: #3a3a3a;
              border: 1px solid #4a4a4a;
              color: #e0e0e0;
              padding: ${B.viewMode()==="compact"?"2px 6px":"4px 8px"};
              border-radius: 4px;
              cursor: pointer;
              font-size: ${B.viewMode()==="compact"?"10px":"12px"};
              transition: all 0.2s;
            `,q)),p})()}),d}),ce=ne(()=>[...new Set(i.state().items.map(t=>t.mime?.split("/")[0]).filter(Boolean))].sort()),Xe=ne(()=>[...new Set(i.state().items.map(d=>d.blob_type))].sort()),Te=(t,d)=>{c(u=>({...u,[t]:d})),ge({filterConfig:{...o(),[t]:d}})},Ge=(t,d)=>{s({field:t,direction:d}),ge({sortConfig:{field:t,direction:d}})},Je=t=>{B.setViewMode(t),ge({viewMode:t})},Ze=t=>{D(d=>{const u={...d,[t]:!d[t]};return ge({columnVisibility:u}),u})},Le=()=>{w(t=>{const d=!t;return ge({isBrowsePanelOpen:d}),d})},He=()=>{m(t=>{const d=!t;return ge({isFilterPanelOpen:d}),d})};return me(()=>{const t=i.state().items;t.length>0&&R(`📊 Feed updated: ${t.length} items available`)}),me(()=>{const t=i.state().requestedThumbnails;t.size>0&&R(`🖼️ Thumbnail requests: ${t.size} items`)}),me(()=>{const t=i.state().connectionStatus;R(`🔌 Connection status: ${t}`)}),me(()=>{i.state().hasPendingUpdates&&R(`📥 ${i.state().pendingUpdates.length} pending updates available`)}),oe(()=>{R("🚀 FreqholeDemo mounted"),R(`🔌 WebSocket URL: ${I()}`),E()&&R("🔌 Auto-connecting to WebSocket...")}),(()=>{var t=Bn(),d=t.firstChild,u=d.nextSibling;return a(t,S(Tt,{get isOpen(){return l()},get filterConfig(){return o()},onTogglePanel:Le,onFilterChange:Te,onWidthChange:p=>{_(p),ge({browsePanelWidth:p})},get initialWidth(){return y()}}),d),a(t,S(Xt,{get selectedCount(){return T.selectedItems().size},onDownload:()=>{console.log("Bulk download:",T.selectedItems().size,"items")},get onClear(){return T.clearSelection},onMore:Ee}),d),a(d,S(an,{get data(){return ae()},get columns(){return Ye()},onSort:Ge,get sortField(){return r().field},get sortDirection(){return r().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return B.getRowHeight()},headerHeight:60,getItemId:p=>p.id,get selectedItems(){return T.selectedItems()},onRowClick:qe,onRowDoubleClick:Fe,get onRowMouseDown(){return T.handleRowMouseDown},onContextMenu:(p,q,Q)=>Ne(p,q,Q),get isDragSelecting(){return T.isDragSelecting()},showPaginationStatus:!0,onLoadMore:()=>i.actions.loadMore(),get hasMore(){return i.state().hasMore},get isLoadingMore(){return i.state().isLoadingMore},get focusedIndex(){return de.focusedIndex()},showFocusIndicator:!0})),a(t,S(st,{get isVisible(){return!l()},position:"left",panelName:"Browse",onClick:Le}),u),a(t,S(st,{get isVisible(){return!v()},position:"right",panelName:"Controls",onClick:He}),u),a(t,S(H,{get when(){return se(()=>!!(T.isDragSelecting()&&T.dragStart()))()&&T.dragEnd()},get children(){var p=Un();return L(q=>F(p,(()=>{const Q=T.dragStart(),ue=T.dragEnd(),ve=Math.min(Q.x,ue.x),Pe=Math.min(Q.y,ue.y),be=Math.abs(ue.x-Q.x),_e=Math.abs(ue.y-Q.y);return`
              position: fixed;
              left: ${ve}px;
              top: ${Pe}px;
              width: ${be}px;
              height: ${_e}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),q)),p}}),u),a(t,S(Ht,{get isOpen(){return v()},get filterConfig(){return o()},get viewMode(){return B.viewMode()},get columnVisibility(){return g()},get wsUrl(){return I()},get autoConnect(){return E()},get autoRefresh(){return z()},get debug(){return f()},get connectionStatus(){return De()},get hasPendingUpdates(){return Me()},get pendingUpdatesCount(){return i.state().pendingUpdates.length},get filteredCount(){return Be().length},get totalCount(){return i.state().items.length},get sortConfig(){return r()},get lastUpdated(){return pe()},get mimeCategories(){return ce()},get blobTypes(){return Xe()},get logs(){return V()},onTogglePanel:He,onFilterChange:Te,onViewModeChange:Je,onColumnToggle:Ze,onWsUrlChange:b,onConnect:()=>{i.actions.connect(),R("🔌 Connecting to WebSocket...")},onDisconnect:()=>{i.actions.disconnect(),R("🔌 Disconnecting from WebSocket...")},onRefresh:()=>{R("🔄 Refreshing data..."),i.actions.refresh()},onApplyPendingUpdates:()=>{i.actions.applyPendingUpdates(),R("✅ Applied pending updates")},onToggleAutoConnect:()=>{O(p=>!p),R(`🔧 Auto-connect: ${E()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{x(p=>!p),R(`🔧 Auto-refresh: ${z()?"OFF":"ON"}`)},onToggleDebug:()=>{A(p=>!p),R(`🐛 Debug: ${f()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Qe),window.location.reload())},onWidthChange:p=>{U(p),ge({filterPanelWidth:p})},get initialWidth(){return C()}}),u),a(t,S(kn,{get item(){return M()?.item||null},get isOpen(){return M()?.isOpen||!1},onClose:Oe}),null),a(t,S(zn,{get item(){return P()?.item||null},get isOpen(){return P()?.isOpen||!1},get position(){return P()?.position||{x:0,y:0}},onClose:ye,onDownload:We,onPreview:p=>W({item:p,isOpen:!0}),onDelete:Se,onCopyUrl:ke}),null),a(t,S(Mn,{get selectedCount(){return T.selectedItems().size},get isOpen(){return Y()?.isOpen||!1},get position(){return Y()?.position||{x:0,y:0}},onClose:$e,onDownloadAll:Ue,onDeleteAll:Ve,get onClearSelection(){return T.clearSelection}}),null),a(t,S(Pn,{get isDragSelecting(){return T.isDragSelecting()},get dragStart(){return T.dragStart()},get dragEnd(){return T.dragEnd()}}),null),t})()}re(["click"]);class qn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",i=this.getAttribute("api-base-url")||"http://localhost:8080",o=this.getAttribute("auto-connect")==="true";this.dispose=Ct(()=>S(Hn,{wsUrl:n,apiBaseUrl:i,autoConnect:o}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",qn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
