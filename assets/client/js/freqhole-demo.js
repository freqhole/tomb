import{d as ae,c as R,t as w,a as G,b as I,e as Y,s as U,i,m as ue,f as $,S as N,F as xe,g as ee,o as re,h as ze,j as Se,k as te,u as Ae,r as Ct}from"./web-2xXXrb5V.js";import{u as St}from"./useThumbnail-BJBtHgwT.js";import{u as zt}from"./thumbnail-utils-DME7itp9.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Q(e){if(e.metadata&&typeof e.metadata=="object"){const n=e.metadata;if(n.originalName||n.filename||n.original_filename||n.file_name||n.name)return n.originalName||n.filename||n.original_filename||n.file_name||n.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var Dt=w(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function gt(e){const[n,l]=R(!1);return(()=>{var c=Dt(),s=c.firstChild,h=s.nextSibling;return c.addEventListener("mouseleave",()=>l(!1)),c.addEventListener("mouseenter",()=>l(!0)),G(c,"mousedown",e.onMouseDown,!0),I(r=>{var u=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,z=`
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
          opacity: ${n()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return u!==r.e&&Y(c,r.e=u),r.t=U(c,z,r.t),r.a=U(s,v,r.a),r.o=U(h,M,r.o),r},{e:void 0,t:void 0,a:void 0,o:void 0}),c})()}ae(["mousedown"]);function ft(e){const[n,l]=R(e.initialWidth),[c,s]=R(!1),h=e.minWidth||250,r=e.maxWidth||600,u=e.closeThreshold||100;return{width:n,setWidth:l,isDragging:c,handleMouseDown:(v,M="right")=>{v.preventDefault(),s(!0),document.body.classList.add("resizing");const _=v.clientX,B=n(),S=b=>{const m=b.clientX-_,C=M==="right"?B-m:B+m;if(C<u){e.onClose?.();return}const k=Math.max(h,Math.min(r,C));l(k),e.onWidthChange?.(k)},L=()=>{s(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",S),document.removeEventListener("mouseup",L)};document.addEventListener("mousemove",S),document.addEventListener("mouseup",L)}}}var Mt=w(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Lt=w('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Et(e){const n=ft({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var l=Mt(),c=l.firstChild,s=c.firstChild,h=s.nextSibling,r=c.nextSibling;return G(h,"click",e.onTogglePanel,!0),i(l,(()=>{var u=ue(()=>!!e.isOpen);return()=>u()&&(()=>{var z=Lt(),v=z.firstChild,M=v.nextSibling;return M.$$input=_=>e.onFilterChange("name",_.currentTarget.value),I(()=>M.value=e.filterConfig.name),z})()})(),r),i(l,$(gt,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:u=>n.handleMouseDown(u,"left")}),r),I(u=>{var z=`browse-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,v=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return z!==u.e&&Y(l,u.e=z),u.t=U(l,v,u.t),u},{e:void 0,t:void 0}),l})()}ae(["click","input"]);var Pt=w(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Controls</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Rt=w('<div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Tt=w('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),It=w('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:8px;box-sizing:border-box;min-width:0;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:24px;min-width:0;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:24px;min-width:0;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;box-sizing:border-box;min-width:0;">Reset All'),at=w("<option>"),At=w("<div style=margin-bottom:24px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),Ot=w("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Ft(e){const[n,l]=R(!1),c=ft({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel}),s=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"name",title:"Name"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_blob_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],h=r=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[r]||"color: #6b7280;";return(()=>{var r=Pt(),u=r.firstChild,z=u.firstChild,v=z.nextSibling,M=u.nextSibling;return G(v,"click",e.onTogglePanel,!0),i(r,(()=>{var _=ue(()=>!!e.isOpen);return()=>_()&&(()=>{var B=It(),S=B.firstChild,L=S.firstChild,b=L.nextSibling,m=b.nextSibling,C=m.firstChild,k=C.nextSibling,A=m.nextSibling,O=A.firstChild,p=O.nextSibling,f=A.nextSibling,x=f.firstChild,E=x.nextSibling,H=S.nextSibling,y=H.firstChild,D=y.nextSibling,F=D.firstChild,P=F.nextSibling,j=H.nextSibling,X=j.firstChild,J=X.nextSibling;J.firstChild;var q=j.nextSibling,me=q.firstChild,ge=me.nextSibling;ge.firstChild;var ve=q.nextSibling,De=ve.firstChild,ye=De.nextSibling,ne=ye.firstChild,T=ne.nextSibling,fe=T.nextSibling,Oe=ve.nextSibling,Ne=Oe.firstChild,Me=Ne.nextSibling,$e=Oe.nextSibling,Le=$e.firstChild,Fe=Le.nextSibling,Ee=$e.nextSibling,Ve=Ee.firstChild,je=Ve.nextSibling,we=je.firstChild,ke=we.nextSibling,Pe=ke.nextSibling,Re=Ee.nextSibling,We=Re.firstChild,se=We.nextSibling,he=se.firstChild,Te=se.nextSibling,Ke=Re.nextSibling,Ye=Ke.firstChild,de=Ye.nextSibling,Ue=de.firstChild,Be=Ue.nextSibling,Xe=Be.nextSibling,Ge=Xe.nextSibling,qe=Ge.nextSibling,Ie=qe.nextSibling,W=Ie.nextSibling,t=W.nextSibling,o=t.nextSibling,a=o.nextSibling,g=a.nextSibling,V=g.nextSibling,ie=V.nextSibling,oe=ie.nextSibling;oe.nextSibling;var He=de.nextSibling,Je=He.firstChild,_e=Je.nextSibling,Ze=He.nextSibling;return b.$$input=d=>e.onWsUrlChange(d.currentTarget.value),i(k,()=>e.connectionStatus),G(O,"click",e.onConnect,!0),G(p,"click",e.onDisconnect,!0),G(E,"click",e.onToggleAutoConnect,!0),i(E,()=>e.autoConnect?"ON":"OFF"),G(F,"click",e.onToggleAutoRefresh,!0),i(F,()=>e.autoRefresh?"ON":"OFF"),G(P,"click",e.onRefresh,!0),i(H,$(N,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var d=Rt(),K=d.firstChild,be=K.firstChild,le=be.nextSibling;return le.nextSibling,G(K,"click",e.onApplyPendingUpdates,!0),i(K,()=>e.pendingUpdatesCount,le),d}}),null),J.addEventListener("change",d=>e.onFilterChange("mime",d.currentTarget.value)),i(J,$(xe,{get each(){return e.mimeCategories},children:d=>(()=>{var K=at();return K.value=d,i(K,d),K})()}),null),ge.addEventListener("change",d=>e.onFilterChange("blobType",d.currentTarget.value)),i(ge,$(xe,{get each(){return e.blobTypes},children:d=>(()=>{var K=at();return K.value=d,i(K,d),K})()}),null),ne.$$input=d=>e.onFilterChange("minSize",parseInt(d.currentTarget.value)||0),fe.$$input=d=>e.onFilterChange("maxSize",parseInt(d.currentTarget.value)||1e8),Me.addEventListener("change",d=>e.onFilterChange("hasParent",d.currentTarget.value)),Fe.addEventListener("change",d=>e.onFilterChange("hasLocalPath",d.currentTarget.value)),we.$$click=()=>e.onViewModeChange("compact"),ke.$$click=()=>e.onViewModeChange("default"),Pe.$$click=()=>e.onViewModeChange("detailed"),se.$$click=()=>l(!n()),i(se,()=>n()?"Hide":"Show",he),i(Te,$(xe,{each:s,children:d=>(()=>{var K=At(),be=K.firstChild,le=be.firstChild,pe=le.nextSibling;return le.addEventListener("change",()=>e.onColumnToggle(d.key)),i(pe,()=>d.title),I(()=>le.checked=e.columnVisibility[d.key]),K})()})),i(de,()=>e.totalCount,Be),i(de,()=>e.filteredCount,Ie),i(de,()=>e.sortConfig.field,a),i(de,()=>e.sortConfig.direction,V),i(de,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),G(_e,"click",e.onToggleDebug,!0),i(_e,()=>e.debug?"ON":"OFF"),G(Ze,"click",e.onReset,!0),i(B,$(N,{get when(){return e.debug&&e.logs.length>0},get children(){var d=Tt(),K=d.firstChild,be=K.nextSibling;return i(be,$(xe,{get each(){return e.logs},children:le=>(()=>{var pe=Ot();return i(pe,le),pe})()})),d}}),null),I(d=>{var K=h(e.connectionStatus),be=e.connectionStatus==="Connected",le=e.connectionStatus==="Disconnected",pe=`toggle-button ${e.autoConnect?"active":""}`,mt=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,et=`toggle-button ${e.autoRefresh?"active":""}`,pt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,tt=`view-mode-button ${e.viewMode==="compact"?"active":""}`,vt=`
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
            `,ot=`toggle-button ${n()?"active":""}`,wt=`
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
          `,lt=`column-settings ${n()?"":"collapsed"}`,kt=`
            max-height: ${n()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,rt=`toggle-button ${e.debug?"active":""}`,_t=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return d.e=U(k,K,d.e),be!==d.t&&(O.disabled=d.t=be),le!==d.a&&(p.disabled=d.a=le),pe!==d.o&&Y(E,d.o=pe),d.i=U(E,mt,d.i),et!==d.n&&Y(F,d.n=et),d.s=U(F,pt,d.s),tt!==d.h&&Y(we,d.h=tt),d.r=U(we,vt,d.r),nt!==d.d&&Y(ke,d.d=nt),d.l=U(ke,yt,d.l),it!==d.u&&Y(Pe,d.u=it),d.c=U(Pe,$t,d.c),ot!==d.w&&Y(se,d.w=ot),d.m=U(se,wt,d.m),lt!==d.f&&Y(Te,d.f=lt),d.y=U(Te,kt,d.y),rt!==d.g&&Y(_e,d.g=rt),d.p=U(_e,_t,d.p),d},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0}),I(()=>b.value=e.wsUrl),I(()=>J.value=e.filterConfig.mime),I(()=>ge.value=e.filterConfig.blobType),I(()=>ne.value=e.filterConfig.minSize),I(()=>fe.value=e.filterConfig.maxSize),I(()=>Me.value=e.filterConfig.hasParent),I(()=>Fe.value=e.filterConfig.hasLocalPath),B})()})(),M),i(r,$(gt,{position:"left",get isDragging(){return c.isDragging()},onMouseDown:_=>c.handleMouseDown(_,"right")}),M),I(_=>{var B=`filter-panel ${e.isOpen?"":"collapsed"} ${c.isDragging()?"resizing":""}`,S=`
        width: ${e.isOpen?c.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return B!==_.e&&Y(r,_.e=B),_.t=U(r,S,_.t),_},{e:void 0,t:void 0}),r})()}ae(["click","input"]);var Wt=w(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function st(e){const[n,l]=R(!1);return $(N,{get when(){return e.isVisible},get children(){var c=Wt(),s=c.firstChild,h=s.nextSibling;return c.addEventListener("mouseleave",()=>l(!1)),c.addEventListener("mouseenter",()=>l(!0)),G(c,"click",e.onClick,!0),i(s,()=>e.position==="left"?"→":"←"),i(h,()=>e.panelName),I(r=>{var u=`edge-toggle-button edge-toggle-${e.position}`,z=`Show ${e.panelName} panel`,v=`
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
            opacity: ${n()?"1":"0"};
            transform: translateY(${n()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return u!==r.e&&Y(c,r.e=u),z!==r.t&&ee(c,"title",r.t=z),r.a=U(c,v,r.a),r.o=U(s,M,r.o),r},{e:void 0,t:void 0,a:void 0,o:void 0}),c}})}ae(["click"]);var Ut=w('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),Bt=w('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),qt=w('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),Ht=w(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function Nt(e){return $(N,{get when(){return e.selectedCount>1},get children(){var n=Ht(),l=n.firstChild,c=l.firstChild,s=c.nextSibling;s.nextSibling;var h=l.nextSibling;return i(l,()=>e.selectedCount,c),i(l,()=>e.selectedCount===1?"":"s",s),i(n,$(N,{get when(){return e.onDownload},get children(){var r=Ut();return G(r,"click",e.onDownload,!0),r}}),h),i(n,$(N,{get when(){return e.onMore},get children(){var r=Bt();return r.$$click=u=>e.onMore?.(u),r}}),h),i(n,$(N,{get when(){return e.onClear},get children(){var r=qt();return G(r,"click",e.onClear,!0),r}}),h),I(()=>Y(n,`selection-toolbar ${e.className||""}`)),n}})}ae(["click"]);function Vt(e={}){const[n,l]=R(e.initialSelection||new Set),[c,s]=R(-1),[h,r]=R(!1),[u,z]=R(null),[v,M]=R(null),_=p=>{l(f=>{const x=new Set(f);return x.has(p)?x.delete(p):x.add(p),x})},B=(p,f,x)=>{const E=Math.min(p,f),H=Math.max(p,f),y=x.slice(E,H+1);l(D=>{const F=new Set(D);return y.forEach(P=>F.add(P.id)),F})},S=()=>{l(new Set),s(-1)},L=p=>{const f=new Set(p.map(x=>x.id));l(f)},b=p=>n().has(p),m=(p,f,x)=>{const E=p.id;x.metaKey||x.ctrlKey?(_(E),s(f)):x.shiftKey&&c()>=0?(x.preventDefault(),s(f)):(l(new Set([E])),s(f))},C=(p,f,x)=>{x.button===0&&!x.metaKey&&!x.ctrlKey&&!x.shiftKey&&(z({x:x.clientX,y:x.clientY,startIndex:f}),r(!0))},k=p=>{const f=p.target,x=f&&(f.tagName==="INPUT"||f.tagName==="TEXTAREA"||f.isContentEditable||f.getAttribute("contenteditable")==="true");p.key==="Escape"?S():p.key==="a"&&(p.metaKey||p.ctrlKey)?x||p.preventDefault():(p.key==="Delete"||p.key==="Backspace")&&!x&&n().size>0&&e.onDelete?.(n())},A=p=>{h()&&u()&&M({x:p.clientX,y:p.clientY,endIndex:-1})},O=()=>{h()&&(r(!1),z(null),M(null))};return re(()=>{document.addEventListener("mousemove",A),document.addEventListener("mouseup",O),document.addEventListener("keydown",k)}),ze(()=>{document.removeEventListener("mousemove",A),document.removeEventListener("mouseup",O),document.removeEventListener("keydown",k),document.body.classList.remove("drag-selecting")}),Se(()=>{h()?document.body.classList.add("drag-selecting"):document.body.classList.remove("drag-selecting")}),Se(()=>{const p=n();e.onSelectionChange?.(p),e.saveToStorage?.(p)}),{selectedItems:n,setSelectedItems:l,lastSelectedIndex:c,setLastSelectedIndex:s,isDragSelecting:h,setIsDragSelecting:r,dragStart:u,setDragStart:z,dragEnd:v,setDragEnd:M,toggleSelection:_,selectRange:B,clearSelection:S,selectAll:L,isSelected:b,handleRowClick:m,handleRowMouseDown:C,handleKeyDown:k}}const Z={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}};function jt(e){const[n,l]=R(e.initialSort||{field:"id",direction:"asc"}),[c,s]=R(new Set),[h,r]=R(!1),u=e.getItemId||(b=>b.id||String(b)),z=te(()=>{const b=n();return[...e.data].sort((C,k)=>{const A=C[b.field],O=k[b.field];let p=0;return A<O?p=-1:A>O&&(p=1),b.direction==="desc"?p*-1:p})});return{sortConfig:n,selectedItems:c,isDragSelecting:h,sortedData:z,handleSort:b=>{const m=n(),C=m.field===b&&m.direction==="asc"?"desc":"asc";l({field:b,direction:C})},toggleSelection:b=>{const m=new Set(c());m.has(b)?m.delete(b):m.add(b),s(m)},clearSelection:()=>{s(new Set)},selectAll:()=>{const b=new Set(e.data.map(u));s(b)},isSelected:b=>c().has(b),selectRange:(b,m)=>{const C=new Set(c()),k=Math.min(b,m),A=Math.max(b,m);for(let O=k;O<=A;O++)if(O<e.data.length&&e.data[O]!=null){const p=u(e.data[O]);C.add(p)}s(C)},setIsDragSelecting:r,getItemId:u}}var ht=w("<div>"),Kt=w("<div class=grid-cell>"),dt=w("<div class=grid-content>"),Yt=w("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Xt=w("<div class=grid-stats>Showing rows <!>-<!> of "),Gt=w("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),Jt=w("<span style=font-size:12px;>"),Zt=w("<div><span>");function ct(e){let n;return re(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var l=ht();l.$$contextmenu=s=>e.onContextMenu?.(e.item,e.index,s),l.$$mousedown=s=>e.onRowMouseDown?.(e.item,e.index,s),l.$$dblclick=s=>e.onRowDoubleClick?.(e.item,e.index,s),l.$$click=s=>e.onRowClick?.(e.item,e.index,s);var c=n;return typeof c=="function"?Ae(c,l):n=l,i(l,$(xe,{get each(){return e.columns},children:s=>(()=>{var h=Kt();return i(h,(()=>{var r=ue(()=>!!s.render);return()=>r()?s.render(e.item,e.index):String(e.item[s.key]||"")})()),I(r=>U(h,`
              flex: ${s.width?"0 0 "+s.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,r)),h})()})),I(s=>{var h=`grid-row ${e.isSelected?"selected":""}`,r=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${Z.colors.border};
        background: ${e.isSelected?Z.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease;
      `;return h!==s.e&&Y(l,s.e=h),s.t=U(l,r,s.t),s},{e:void 0,t:void 0}),l})()}function Qt(e){const[n,l]=R(),[c,s]=R(0),[h,r]=R(0),u=e.rowHeight||50,z=e.headerHeight||60,v=e.virtualizeThreshold||100,M=jt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),_=(f,x,E)=>{e.onRowClick?.(f,x,E)},B=(f,x,E)=>{e.onRowDoubleClick?.(f,x,E)},S=(f,x,E)=>{e.onRowMouseDown?.(f,x,E)},L=te(()=>e.data.length>v),b=te(()=>{if(!L())return e.data.map((P,j)=>({item:P,index:j}));if(!n())return[];const x=u,E=c(),H=h(),y=Math.floor(E/x),D=Math.min(e.data.length-1,Math.ceil((E+H)/x)+5),F=[];for(let P=Math.max(0,y-5);P<=D;P++)P<e.data.length&&e.data[P]!=null&&F.push({item:e.data[P],index:P});return F}),m=te(()=>e.data.length===0?0:n()?Math.floor(c()/u)+1:1),C=te(()=>{if(e.data.length===0)return 0;if(!n())return Math.min(1,e.data.length);const x=h()-z,E=Math.floor(x/u),H=Math.floor(c()/u)+E;return Math.min(H,e.data.length)}),k=te(()=>e.data.length),A=te(()=>e.data.length*u),O=f=>{const x=f.target;if(s(x.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const E=x.scrollHeight,H=x.scrollTop,y=x.clientHeight;E-H-y<200&&e.onLoadMore()}},p=f=>{if(M.handleSort(f),e.onSort){const x=M.sortConfig();e.onSort(x.field,x.direction)}};return re(()=>{const f=n();if(!f)return;const x=new ResizeObserver(E=>{for(const H of E)r(H.contentRect.height)});x.observe(f),ze(()=>{x.disconnect()})}),(()=>{var f=Gt(),x=f.firstChild,E=x.nextSibling,H=E.nextSibling;return i(x,$(xe,{get each(){return e.columns},children:y=>(()=>{var D=Zt(),F=D.firstChild;return D.$$click=()=>y.sortable&&p(y.key),i(F,()=>y.title),i(D,$(N,{get when(){return ue(()=>!!y.sortable)()&&M.sortConfig().field===y.key},get children(){var P=Jt();return i(P,()=>M.sortConfig().direction==="asc"?"↑":"↓"),P}}),null),I(P=>{var j=`grid-header-cell ${y.sortable?"sortable":""}`,X=`
                flex: ${y.width?"0 0 "+y.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${y.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return j!==P.e&&Y(D,P.e=j),P.t=U(D,X,P.t),P},{e:void 0,t:void 0}),D})()})),E.addEventListener("scroll",O),Ae(l,E),i(E,$(N,{get when(){return L()},get fallback(){return(()=>{var y=dt();return i(y,$(xe,{get each(){return e.data},children:(D,F)=>$(ct,{item:D,get index(){return F()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(D)||D.id)||!1},onRowClick:_,onRowDoubleClick:B,onRowMouseDown:S,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:u})})),y})()},get children(){var y=dt();return i(y,$(xe,{get each(){return b()},children:D=>(()=>{var F=ht();return i(F,$(ct,{get item(){return D.item},get index(){return D.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(D.item)||D.item.id)||!1},onRowClick:_,onRowDoubleClick:B,onRowMouseDown:S,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:u})),I(P=>U(F,`
                    position: absolute;
                    top: ${D.index*u}px;
                    left: 0;
                    right: 0;
                  `,P)),F})()})),I(D=>U(y,`height: ${A()}px; position: relative;`,D)),y}})),i(f,$(N,{get when(){return e.showPaginationStatus!==!1},get children(){var y=Xt(),D=y.firstChild,F=D.nextSibling,P=F.nextSibling,j=P.nextSibling;return j.nextSibling,i(y,m,F),i(y,C,j),i(y,k,null),i(y,$(N,{get when(){return e.isLoadingMore},get children(){return Yt()}}),null),I(X=>U(y,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${Z.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,X)),y}}),H),i(H,()=>`
        .grid-row:hover:not(.selected) {
          background: ${Z.colors.hover};
        }

        .grid-row.selected {
          background: ${Z.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${Z.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${Z.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${Z.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${Z.colors.text};
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
      `),I(y=>{var D=`infinite-data-grid ${e.className||""}`,F=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${Z.colors.background};
        color: ${Z.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,P=`
          height: ${z}px;
          display: flex;
          align-items: center;
          background: ${Z.colors.header};
          border-bottom: 2px solid ${Z.colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return D!==y.e&&Y(f,y.e=D),y.t=U(f,F,y.t),y.a=U(x,P,y.a),y},{e:void 0,t:void 0,a:void 0}),f})()}ae(["click","dblclick","mousedown","contextmenu"]);var en=w(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),tn=w("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),nn=w("<span style=color:#94a3b8;>"),on=w('<div title="Has thumbnails">'),ln=w('<div title="Generating thumbnails...">');function rn(e){const n=()=>e.size||40,l=()=>e.borderRadius||"4px",c=St({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var s=en(),h=s.firstChild;return i(s,(()=>{var r=ue(()=>!!c.url);return()=>r()?(()=>{var u=tn();return G(u,"error",c.onImageError),I(z=>{var v=c.url,M=`Thumbnail for ${e.item.id.slice(0,8)}`;return v!==z.e&&ee(u,"src",z.e=v),M!==z.t&&ee(u,"alt",z.t=M),z},{e:void 0,t:void 0}),u})():(()=>{var u=nn();return i(u,()=>c.fallbackIcon),u})()})(),h),i(s,$(N,{get when(){return e.showIndicators!==!1},get children(){return ue(()=>!!c.hasThumbnails)()?(()=>{var r=on();return I(u=>U(r,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,n()*.15)}px;
              height: ${Math.max(6,n()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,u)),r})():ue(()=>!!c.isRequested)()?(()=>{var r=ln();return I(u=>U(r,`
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
            `,u)),r})():null}}),h),I(r=>{var u=`thumbnail ${e.className||""}`,z=`
        width: ${n()}px;
        height: ${n()}px;
        border-radius: ${l()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12,n()*.3)}px;
        position: relative;
        flex-shrink: 0;
      `,v=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return u!==r.e&&Y(s,r.e=u),r.t=U(s,z,r.t),v!==r.a&&ee(s,"title",r.a=v),r},{e:void 0,t:void 0,a:void 0}),s})()}function bt(e){if(e===0)return"0 B";const n=1024,l=["B","KB","MB","GB","TB","PB"],c=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,c)).toFixed(2))+" "+l[c]}var an=w('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),sn=w("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),dn=w("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),cn=w("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:4rem;>🎵</div><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),un=w('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),gn=w("<div style=text-align:center;margin-bottom:24px;>"),fn=w("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),hn=w("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),bn=w('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function xn(e){let n;const l=h=>{h.key==="Escape"&&e.onClose()},c=h=>{h.target===n&&e.onClose()};re(()=>{e.isOpen&&(document.addEventListener("keydown",l),document.body.style.overflow="hidden")}),ze(()=>{document.removeEventListener("keydown",l),document.body.style.overflow=""});const s=()=>{e.isOpen?(document.addEventListener("keydown",l),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",l),document.body.style.overflow="")};return re(()=>{const h=()=>{s(),requestAnimationFrame(h)};h()}),$(N,{get when(){return e.isOpen&&e.item},get children(){var h=an(),r=h.firstChild,u=r.firstChild;h.$$click=c;var z=n;return typeof z=="function"?Ae(z,h):n=h,r.$$click=v=>v.stopPropagation(),u.addEventListener("mouseleave",v=>{v.target.style.background="#ef4444"}),u.addEventListener("mouseenter",v=>{v.target.style.background="#dc2626"}),G(u,"click",e.onClose,!0),i(r,$(N,{get when(){return e.item},children:v=>{const M=v().mime||"",_=M.startsWith("image/"),B=M.startsWith("video/"),S=M.startsWith("audio/"),L=Q(v());return[(()=>{var b=gn();return i(b,$(N,{when:_,get children(){var m=sn();return m.addEventListener("error",C=>{const k=C.target;k.style.display="none";const A=document.createElement("div");A.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${L}</div>
                            </div>
                          `,k.parentNode?.appendChild(A)}),ee(m,"alt",L),I(()=>ee(m,"src",`/api/blobs/${v().id}`)),m}}),null),i(b,$(N,{when:B,get children(){var m=dn(),C=m.firstChild;return ee(C,"type",M),I(()=>ee(C,"src",`/api/blobs/${v().id}`)),m}}),null),i(b,$(N,{when:S,get children(){var m=cn(),C=m.firstChild,k=C.nextSibling,A=k.nextSibling,O=A.firstChild;return i(k,L),ee(O,"type",M),I(()=>ee(O,"src",`/api/blobs/${v().id}`)),m}}),null),i(b,$(N,{when:!_&&!B&&!S,get children(){var m=un(),C=m.firstChild,k=C.nextSibling,A=k.nextSibling,O=A.firstChild;return I(()=>ee(O,"href",`/api/blobs/${v().id}`)),m}}),null),b})(),(()=>{var b=bn(),m=b.firstChild,C=m.nextSibling,k=C.firstChild,A=k.firstChild,O=A.nextSibling,p=k.nextSibling,f=p.firstChild,x=f.nextSibling,E=p.nextSibling,H=E.firstChild,y=H.nextSibling,D=E.nextSibling,F=D.firstChild,P=F.nextSibling,j=D.nextSibling,X=j.firstChild,J=X.nextSibling,q=j.nextSibling,me=q.firstChild,ge=me.nextSibling,ve=q.nextSibling,De=ve.firstChild,ye=De.nextSibling;return i(O,L),i(x,()=>v().id),i(y,()=>v().sha256),i(P,()=>v().blob_type),i(J,M||"unknown"),i(ge,()=>bt(v().size||0)),i(ye,()=>new Date(v().created_at).toLocaleString()),i(C,$(N,{get when(){return v().parent_blob_id},get children(){var ne=fn(),T=ne.firstChild,fe=T.nextSibling;return i(fe,()=>v().parent_blob_id),ne}}),null),i(C,$(N,{get when(){return v().local_path},get children(){var ne=hn(),T=ne.firstChild,fe=T.nextSibling;return i(fe,()=>v().local_path),ne}}),null),b})()]}}),null),h}})}ae(["click"]);var mn=w("<div class=action-menu>"),pn=w('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),vn=w('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444444;margin:4px 8px;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function yn(e){let n;const[l,c]=R({x:0,y:0}),s=S=>{S.key==="Escape"&&e.onClose()},h=S=>{n&&!n.contains(S.target)&&e.onClose()},r=()=>{if(!n)return;const S=180,L=160,{x:b,y:m}=e.position;let C=b,k=m;b+S>window.innerWidth&&(C=window.innerWidth-S-8),C<8&&(C=8),m+L>window.innerHeight&&(k=m-L-4),k<8&&(k=8),c({x:C,y:k})};re(()=>{e.isOpen&&(document.addEventListener("keydown",s),document.addEventListener("click",h),setTimeout(r,0))}),ze(()=>{document.removeEventListener("keydown",s),document.removeEventListener("click",h)});const u=()=>{e.isOpen?(document.addEventListener("keydown",s),document.addEventListener("click",h),r()):(document.removeEventListener("keydown",s),document.removeEventListener("click",h))};re(()=>{const S=()=>{u(),requestAnimationFrame(S)};S()});const z=()=>{e.item&&e.onDownload&&e.onDownload(e.item),e.onClose()},v=()=>{e.item&&e.onPreview&&e.onPreview(e.item),e.onClose()},M=()=>{e.item&&e.onDelete&&e.onDelete(e.item),e.onClose()},_=()=>{e.item&&e.onCopyUrl&&e.onCopyUrl(e.item),e.onClose()},B=S=>{const L=S.mime||"";return L.startsWith("image/")?"🖼️":L.startsWith("video/")?"🎥":L.startsWith("audio/")?"🎵":L.includes("pdf")?"📄":L.includes("text")?"📝":"📎"};return $(N,{get when(){return e.isOpen&&e.item},get children(){var S=mn();S.$$click=b=>b.stopPropagation();var L=n;return typeof L=="function"?Ae(L,S):n=S,i(S,$(N,{get when(){return e.item},children:b=>[(()=>{var m=pn(),C=m.firstChild,k=C.nextSibling;return i(C,()=>B(b())),i(k,()=>Q(b())),m})(),(()=>{var m=vn(),C=m.firstChild,k=C.nextSibling,A=k.nextSibling,O=A.nextSibling,p=O.nextSibling;return C.addEventListener("mouseleave",f=>{f.target.style.background="transparent"}),C.addEventListener("mouseenter",f=>{f.target.style.background="#3a3a3a"}),C.$$click=v,k.addEventListener("mouseleave",f=>{f.target.style.background="transparent"}),k.addEventListener("mouseenter",f=>{f.target.style.background="#3a3a3a"}),k.$$click=z,A.addEventListener("mouseleave",f=>{f.target.style.background="transparent"}),A.addEventListener("mouseenter",f=>{f.target.style.background="#3a3a3a"}),A.$$click=_,p.addEventListener("mouseleave",f=>{f.target.style.background="transparent"}),p.addEventListener("mouseenter",f=>{f.target.style.background="rgba(239, 68, 68, 0.1)"}),p.$$click=M,m})()]})),I(b=>U(S,`
          position: fixed;
          top: ${l().y}px;
          left: ${l().x}px;
          background: #2a2a2a;
          border: 1px solid #444444;
          border-radius: 6px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 180px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        `,b)),S}})}ae(["click"]);var $n=w('<div class=bulk-action-menu><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>📦</span><span> item<!> selected</span></div><div style="padding:4px 0;"><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All (<!>)</span></button><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#888888;text-align:left;cursor:not-allowed;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗜️</span><span>Export as ZIP (Soon)</span></button><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#888888;text-align:left;cursor:not-allowed;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🎵</span><span>Add to Playlist (Soon)</span></button><div style="height:1px;background:#444444;margin:4px 8px;"></div><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>✖️</span><span>Clear Selection</span></button><button class=bulk-action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All (<!>)');function wn(e){let n;const[l,c]=R({x:0,y:0}),s=_=>{_.key==="Escape"&&e.onClose()},h=_=>{n&&!n.contains(_.target)&&e.onClose()},r=()=>{if(!n)return;const _=200,B=180,{x:S,y:L}=e.position;let b=S,m=L;S+_>window.innerWidth&&(b=window.innerWidth-_-8),b<8&&(b=8),L+B>window.innerHeight&&(m=L-B-4),m<8&&(m=8),c({x:b,y:m})};re(()=>{e.isOpen&&(document.addEventListener("keydown",s),document.addEventListener("click",h),setTimeout(r,0))}),ze(()=>{document.removeEventListener("keydown",s),document.removeEventListener("click",h)});const u=()=>{e.isOpen?(document.addEventListener("keydown",s),document.addEventListener("click",h),r()):(document.removeEventListener("keydown",s),document.removeEventListener("click",h))};re(()=>{const _=()=>{u(),requestAnimationFrame(_)};_()});const z=()=>{e.onDownloadAll&&e.onDownloadAll(),e.onClose()},v=()=>{e.onDeleteAll&&e.onDeleteAll(),e.onClose()},M=()=>{e.onClearSelection&&e.onClearSelection(),e.onClose()};return $(N,{get when(){return e.isOpen&&e.selectedCount>0},get children(){var _=$n(),B=_.firstChild,S=B.firstChild,L=S.nextSibling,b=L.firstChild,m=b.nextSibling;m.nextSibling;var C=B.nextSibling,k=C.firstChild,A=k.firstChild,O=A.nextSibling,p=O.firstChild,f=p.nextSibling;f.nextSibling;var x=k.nextSibling,E=x.nextSibling,H=E.nextSibling,y=H.nextSibling,D=y.nextSibling,F=D.firstChild,P=F.nextSibling,j=P.firstChild,X=j.nextSibling;X.nextSibling,_.$$click=q=>q.stopPropagation();var J=n;return typeof J=="function"?Ae(J,_):n=_,i(L,()=>e.selectedCount,b),i(L,()=>e.selectedCount===1?"":"s",m),k.addEventListener("mouseleave",q=>{q.target.style.background="transparent"}),k.addEventListener("mouseenter",q=>{q.target.style.background="#3a3a3a"}),k.$$click=z,i(O,()=>e.selectedCount,f),x.$$click=()=>{console.log("Export as ZIP not implemented yet"),e.onClose()},E.$$click=()=>{console.log("Add to playlist not implemented yet"),e.onClose()},y.addEventListener("mouseleave",q=>{q.target.style.background="transparent"}),y.addEventListener("mouseenter",q=>{q.target.style.background="#3a3a3a"}),y.$$click=M,D.addEventListener("mouseleave",q=>{q.target.style.background="transparent"}),D.addEventListener("mouseenter",q=>{q.target.style.background="rgba(239, 68, 68, 0.1)"}),D.$$click=v,i(P,()=>e.selectedCount,X),I(q=>U(_,`
          position: fixed;
          top: ${l().y}px;
          left: ${l().x}px;
          background: #2a2a2a;
          border: 1px solid #444444;
          border-radius: 6px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        `,q)),_}})}ae(["click"]);var kn=w("<span style=font-weight:500;>"),Ce=w("<span>"),_n=w("<span style=font-family:monospace;font-size:12px;>"),Cn=w('<button style="background:#3a3a3a;border:1px solid #4a4a4a;color:#e0e0e0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;">⋯'),Sn=w("<div>"),zn=w(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow:hidden;min-width:0;></div><style>
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
      `);const Qe="freqhole-demo-state",ut=300;function xt(){try{const e=localStorage.getItem(Qe);return e?JSON.parse(e):{}}catch{return{}}}function ce(e){try{const l={...xt(),...e};localStorage.setItem(Qe,JSON.stringify(l))}catch{}}function Dn(e){const n=xt(),l=zt({wsUrl:e.wsUrl,channels:["MediaBlobs"],debug:n.debug??!1,autoConnect:e.autoConnect,autoRefresh:n.autoRefresh??!0,pageSize:50}),[c,s]=R({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...n.filterConfig||{}}),[h,r]=R({field:"created_at",direction:"desc",...n.sortConfig||{}}),[u,z]=R(n.viewMode||"default"),[v,M]=R({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...n.columnVisibility||{}}),[_,B]=R(n.isFilterPanelOpen??!0),[S,L]=R(n.filterPanelWidth||ut),[b,m]=R(n.isBrowsePanelOpen??!0),[C,k]=R(n.browsePanelWidth||ut),[A,O]=R(e.wsUrl),[p,f]=R(e.autoConnect),[x,E]=R(!0),[H,y]=R(!1),[D,F]=R([]),[P,j]=R(null),[X,J]=R(null),[q,me]=R(null),ge=()=>l.state().connectionStatus,ve=()=>l.state().hasPendingUpdates,De=()=>l.state().lastUpdated,[ye,ne]=R(new Set),T=Vt({onSelectionChange:t=>{ce({selectedItems:t})},onDelete:t=>{console.log("Delete requested for",t.size,"items")},saveToStorage:t=>{},initialSelection:new Set(n.selectedItems?Array.from(n.selectedItems):[])}),fe=(t,o,a)=>{a.shiftKey&&T.lastSelectedIndex()>=0?(a.preventDefault(),T.selectRange(T.lastSelectedIndex(),o,he())):T.handleRowClick(t,o,a)},Oe=t=>{j({item:t,isOpen:!0}),W(`🖼️ Opened preview for: ${Q(t)}`)},Ne=(t,o,a)=>{a.preventDefault(),a.stopPropagation();const g={x:a.clientX,y:a.clientY},V=T.selectedItems().size;V>1?(me({isOpen:!0,position:g}),W(`🖱️ Bulk context menu opened for ${V} items`)):(J({item:t,isOpen:!0,position:g}),W(`🖱️ Context menu opened for: ${Q(t)}`))},Me=()=>{j(null)},$e=()=>{J(null)},Le=()=>{me(null)},Fe=(t,o)=>{o.stopPropagation(),o.preventDefault();const a=X();if(a&&a.item.id===t.id)$e(),W(`⋯ Action menu closed for: ${Q(t)}`);else{const g=o.target.getBoundingClientRect(),V={x:g.right-120,y:g.bottom+4};J({item:t,isOpen:!0,position:V}),W(`⋯ Action menu opened for: ${Q(t)}`)}},Ee=async t=>{try{const o=Q(t),a=document.createElement("a");a.href=`/api/blobs/${t.id}`,a.download=o,document.body.appendChild(a),a.click(),document.body.removeChild(a),W(`📥 Downloaded: ${o}`)}catch(o){console.error("Download failed:",o),W(`❌ Download failed: ${o}`)}},Ve=async t=>{try{const o=`${window.location.origin}/api/blobs/${t.id}`;await navigator.clipboard.writeText(o),W(`🔗 Copied URL for: ${Q(t)}`)}catch(o){console.error("Copy URL failed:",o),W(`❌ Copy URL failed: ${o}`)}},je=t=>{W(`🗑️ Delete requested for: ${Q(t)}`),console.log("Delete requested for:",t.id)},we=t=>{if(q()?.isOpen)Le();else{const a=t.target.getBoundingClientRect(),g={x:a.left+a.width/2-100,y:a.top-10};me({isOpen:!0,position:g})}},ke=async()=>{const t=Array.from(T.selectedItems()),o=he().filter(a=>t.includes(a.id));W(`📥 Starting bulk download of ${o.length} items...`);for(const a of o)await Ee(a),await new Promise(g=>setTimeout(g,100));W(`✅ Bulk download completed: ${o.length} items`)},Pe=()=>{const t=Array.from(T.selectedItems()),o=he().filter(a=>t.includes(a.id));W(`🗑️ Bulk delete requested for ${o.length} items`),console.log("Bulk delete requested for:",t)},Re=t=>{const o=t.target,a=o&&(o.tagName==="INPUT"||o.tagName==="TEXTAREA"||o.isContentEditable||o.getAttribute("contenteditable")==="true");t.key==="a"&&(t.metaKey||t.ctrlKey)?a||(t.preventDefault(),T.selectAll(he())):t.key==="Escape"?P()?.isOpen?Me():X()?.isOpen?$e():q()?.isOpen?Le():T.handleKeyDown(t):T.handleKeyDown(t)},We=t=>{if(T.isDragSelecting()&&T.dragStart()){T.setDragEnd({x:t.clientX,y:t.clientY,endIndex:-1});const o=T.dragStart(),a=Math.floor((t.clientY-o.y)/60);if(a!==o.startIndex){const g=Math.min(o.startIndex,o.startIndex+a),V=Math.max(o.startIndex,o.startIndex+a);T.selectRange(g,V,he())}}};re(()=>{document.addEventListener("mousemove",We),document.addEventListener("keydown",Re)}),ze(()=>{document.removeEventListener("mousemove",We),document.removeEventListener("keydown",Re)});const se=te(()=>{const t=c();return l.state().items.filter(o=>{if(t.name&&!Q(o).toLowerCase().includes(t.name.toLowerCase())||t.mime&&!o.mime?.startsWith(t.mime)||t.blobType&&o.blob_type!==t.blobType||(o.size||0)<t.minSize||(o.size||0)>t.maxSize)return!1;if(t.hasParent!=="all"){const a=!!o.parent_blob_id;if(t.hasParent==="yes"&&!a||t.hasParent==="no"&&a)return!1}if(t.hasLocalPath!=="all"){const a=!!o.local_path;if(t.hasLocalPath==="yes"&&!a||t.hasLocalPath==="no"&&a)return!1}return!0})}),he=te(()=>{const t=h();return[...se()].sort((a,g)=>{const V=a[t.field],ie=g[t.field];let oe=0;return V<ie?oe=-1:V>ie&&(oe=1),t.direction==="desc"?oe*-1:oe})}),Te=t=>{ye().has(t)||(ne(o=>new Set([...o,t])),l.actions.getThumbnails(t),W(`🖼️ Requesting thumbnails for ${t.slice(0,8)}`))},Ke=te(()=>{const t=v(),o=[];return t.thumbnail&&o.push({key:"thumbnail",title:"📷",width:60,render:a=>$(rn,{item:a,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:Te,get requestedThumbnails(){return ye()},showIndicators:!0})}),t.name&&o.push({key:"name",title:"Name",width:250,sortable:!0,render:a=>(()=>{var g=kn();return i(g,()=>Q(a)),I(()=>ee(g,"title",Q(a))),g})()}),t.blob_type&&o.push({key:"blob_type",title:"Type",width:100,sortable:!0}),t.mime&&o.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:a=>(()=>{var g=Ce();return i(g,()=>a.mime||"unknown"),g})()}),t.id&&o.push({key:"id",title:"ID",width:200,sortable:!0,render:a=>(()=>{var g=_n();return i(g,()=>a.id),g})()}),t.size&&o.push({key:"size",title:"Size",width:100,sortable:!0,render:a=>(()=>{var g=Ce();return i(g,()=>bt(a.size||0)),g})()}),t.parent_blob_id&&o.push({key:"parent_blob_id",title:"Parent",width:120,render:a=>(()=>{var g=Ce();return i(g,()=>a.parent_blob_id?"Yes":"No"),g})()}),t.local_path&&o.push({key:"local_path",title:"Local Path",width:200,render:a=>(()=>{var g=Ce();return i(g,()=>a.local_path||"None"),g})()}),t.created_at&&o.push({key:"created_at",title:"Created",width:140,sortable:!0,render:a=>(()=>{var g=Ce();return i(g,()=>new Date(a.created_at).toLocaleString()),g})()}),t.updated_at&&o.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:a=>(()=>{var g=Ce();return i(g,()=>new Date(a.updated_at).toLocaleString()),g})()}),t.actions&&o.push({key:"actions",title:"Actions",width:100,render:a=>(()=>{var g=Cn();return g.$$click=V=>Fe(a,V),g.addEventListener("mouseleave",V=>{V.target.style.background="#3a3a3a"}),g.addEventListener("mouseenter",V=>{V.target.style.background="#4a4a4a"}),g})()}),o}),Ye=te(()=>[...new Set(l.state().items.map(t=>t.mime?.split("/")[0]).filter(Boolean))].sort()),de=te(()=>[...new Set(l.state().items.map(o=>o.blob_type))].sort()),Ue=(t,o)=>{s(a=>({...a,[t]:o})),ce({filterConfig:{...c(),[t]:o}})},Be=(t,o)=>{r({field:t,direction:o}),ce({sortConfig:{field:t,direction:o}})},Xe=t=>{z(t),ce({viewMode:t})},Ge=t=>{M(o=>{const a={...o,[t]:!o[t]};return ce({columnVisibility:a}),a})},qe=()=>{m(t=>{const o=!t;return ce({isBrowsePanelOpen:o}),o})},Ie=()=>{B(t=>{const o=!t;return ce({isFilterPanelOpen:o}),o})},W=t=>{const o=new Date().toLocaleTimeString();F(a=>[`${o}: ${t}`,...a.slice(0,49)])};return Se(()=>{const t=l.state().items;t.length>0&&W(`📊 Feed updated: ${t.length} items available`)}),Se(()=>{const t=l.state().requestedThumbnails;t.size>0&&W(`🖼️ Thumbnail requests: ${t.size} items`)}),Se(()=>{const t=l.state().connectionStatus;W(`🔌 Connection status: ${t}`)}),Se(()=>{l.state().hasPendingUpdates&&W(`📥 ${l.state().pendingUpdates.length} pending updates available`)}),re(()=>{W("🚀 FreqholeDemo mounted"),W(`🔌 WebSocket URL: ${A()}`),p()&&W("🔌 Auto-connecting to WebSocket...")}),(()=>{var t=zn(),o=t.firstChild,a=o.nextSibling;return i(t,$(Et,{get isOpen(){return b()},get filterConfig(){return c()},onTogglePanel:qe,onFilterChange:Ue,onWidthChange:g=>{k(g),ce({browsePanelWidth:g})},get initialWidth(){return C()}}),o),i(t,$(Nt,{get selectedCount(){return T.selectedItems().size},onDownload:()=>{console.log("Bulk download:",T.selectedItems().size,"items")},get onClear(){return T.clearSelection},onMore:we}),o),i(o,$(Qt,{get data(){return he()},get columns(){return Ke()},onSort:Be,get sortField(){return h().field},get sortDirection(){return h().direction},get rowHeight(){return ue(()=>u()==="compact")()?40:u()==="detailed"?80:60},headerHeight:60,getItemId:g=>g.id,get selectedItems(){return T.selectedItems()},onRowClick:fe,onRowDoubleClick:Oe,get onRowMouseDown(){return T.handleRowMouseDown},onContextMenu:(g,V,ie)=>Ne(g,V,ie),get isDragSelecting(){return T.isDragSelecting()},showPaginationStatus:!0,onLoadMore:()=>l.actions.loadMore(),get hasMore(){return l.state().hasMore},get isLoadingMore(){return l.state().isLoadingMore}})),i(t,$(st,{get isVisible(){return!b()},position:"left",panelName:"Browse",onClick:qe}),a),i(t,$(st,{get isVisible(){return!_()},position:"right",panelName:"Controls",onClick:Ie}),a),i(t,$(N,{get when(){return ue(()=>!!(T.isDragSelecting()&&T.dragStart()))()&&T.dragEnd()},get children(){var g=Sn();return I(V=>U(g,(()=>{const ie=T.dragStart(),oe=T.dragEnd(),He=Math.min(ie.x,oe.x),Je=Math.min(ie.y,oe.y),_e=Math.abs(oe.x-ie.x),Ze=Math.abs(oe.y-ie.y);return`
              position: fixed;
              left: ${He}px;
              top: ${Je}px;
              width: ${_e}px;
              height: ${Ze}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),V)),g}}),a),i(t,$(Ft,{get isOpen(){return _()},get filterConfig(){return c()},get viewMode(){return u()},get columnVisibility(){return v()},get wsUrl(){return A()},get autoConnect(){return p()},get autoRefresh(){return x()},get debug(){return H()},get connectionStatus(){return ge()},get hasPendingUpdates(){return ve()},get pendingUpdatesCount(){return l.state().pendingUpdates.length},get filteredCount(){return se().length},get totalCount(){return l.state().items.length},get sortConfig(){return h()},get lastUpdated(){return De()},get mimeCategories(){return Ye()},get blobTypes(){return de()},get logs(){return D()},onTogglePanel:Ie,onFilterChange:Ue,onViewModeChange:Xe,onColumnToggle:Ge,onWsUrlChange:O,onConnect:()=>{l.actions.connect(),W("🔌 Connecting to WebSocket...")},onDisconnect:()=>{l.actions.disconnect(),W("🔌 Disconnecting from WebSocket...")},onRefresh:()=>{W("🔄 Refreshing data..."),l.actions.refresh()},onApplyPendingUpdates:()=>{l.actions.applyPendingUpdates(),W("✅ Applied pending updates")},onToggleAutoConnect:()=>{f(g=>!g),W(`🔧 Auto-connect: ${p()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{E(g=>!g),W(`🔧 Auto-refresh: ${x()?"OFF":"ON"}`)},onToggleDebug:()=>{y(g=>!g),W(`🐛 Debug: ${H()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Qe),window.location.reload())},onWidthChange:g=>{L(g),ce({filterPanelWidth:g})},get initialWidth(){return S()}}),a),i(t,$(xn,{get item(){return P()?.item||null},get isOpen(){return P()?.isOpen||!1},onClose:Me}),null),i(t,$(yn,{get item(){return X()?.item||null},get isOpen(){return X()?.isOpen||!1},get position(){return X()?.position||{x:0,y:0}},onClose:$e,onDownload:Ee,onPreview:g=>j({item:g,isOpen:!0}),onDelete:je,onCopyUrl:Ve}),null),i(t,$(wn,{get selectedCount(){return T.selectedItems().size},get isOpen(){return q()?.isOpen||!1},get position(){return q()?.position||{x:0,y:0}},onClose:Le,onDownloadAll:ke,onDeleteAll:Pe,get onClearSelection(){return T.clearSelection}}),null),t})()}ae(["click"]);class Mn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const n=this.getAttribute("ws-url")||"ws://localhost:8080/ws",l=this.getAttribute("api-base-url")||"http://localhost:8080",c=this.getAttribute("auto-connect")==="true";this.dispose=Ct(()=>$(Dn,{wsUrl:n,apiBaseUrl:l,autoConnect:c}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Mn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
