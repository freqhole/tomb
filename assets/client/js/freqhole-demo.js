import{d as se,c as L,t as y,a as ee,b as T,e as te,s as O,i as a,m as Y,f as C,F as fe,S as U,g as ae,o as ce,h as ge,j as xe,k as J,u as pe,l as Be,n as Ne,r as Ue}from"./web-q5xKJNDT.js";import{u as He}from"./useThumbnail-B4blZjid.js";import{u as Ve}from"./thumbnail-utils-DlltoYEh.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function re(e){if(e.metadata&&typeof e.metadata=="object"){const t=e.metadata;if(t.originalName||t.filename||t.original_filename||t.file_name||t.name)return t.originalName||t.filename||t.original_filename||t.file_name||t.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var Ke=y(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function ze(e){const[t,i]=L(!1);return(()=>{var n=Ke(),u=n.firstChild,r=u.nextSibling;return n.addEventListener("mouseleave",()=>i(!1)),n.addEventListener("mouseenter",()=>i(!0)),ee(n,"mousedown",e.onMouseDown,!0),T(s=>{var o=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,v=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,c=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${t()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,g=`
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
          opacity: ${t()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return o!==s.e&&te(n,s.e=o),s.t=O(n,v,s.t),s.a=O(u,c,s.a),s.o=O(r,g,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),n})()}se(["mousedown"]);function De(e){const[t,i]=L(e.initialWidth),[n,u]=L(!1),r=e.minWidth||250,s=e.maxWidth||600,o=e.closeThreshold||100;return{width:t,setWidth:i,isDragging:n,handleMouseDown:(c,g="right")=>{c.preventDefault(),u(!0),document.body.classList.add("resizing");const m=c.clientX,d=t(),l=x=>{const _=x.clientX-m,D=g==="right"?d-_:d+_;if(D<o){e.onClose?.();return}const p=Math.max(r,Math.min(s,D));i(p),e.onWidthChange?.(p)},h=()=>{u(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",h)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",h)}}}var je=y(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),qe=y('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function Ye(e){const t=De({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var i=je(),n=i.firstChild,u=n.firstChild,r=u.nextSibling,s=n.nextSibling;return ee(r,"click",e.onTogglePanel,!0),a(i,(()=>{var o=Y(()=>!!e.isOpen);return()=>o()&&(()=>{var v=qe(),c=v.firstChild,g=c.nextSibling;return g.$$input=m=>e.onFilterChange("name",m.currentTarget.value),T(()=>g.value=e.filterConfig.name),v})()})(),s),a(i,C(ze,{position:"right",get isDragging(){return t.isDragging()},onMouseDown:o=>t.handleMouseDown(o,"left")}),s),T(o=>{var v=`browse-panel ${e.isOpen?"":"collapsed"} ${t.isDragging()?"resizing":""}`,c=`
        width: ${e.isOpen?t.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return v!==o.e&&te(i,o.e=v),o.t=O(i,c,o.t),o},{e:void 0,t:void 0}),i})()}se(["click","input"]);var Xe=y('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),Ge=y("<div>"),Je=y("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),Qe=y('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const Ze=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function et(e){return(()=>{var t=Ge();return a(t,C(fe,{each:Ze,children:i=>{const n=i.key,u=e.columnVisibility[n],r=e.hiddenColumns?.includes(i.key),s=e.responsiveColumnVisibility?.[n]??u;return(()=>{var o=Je(),v=o.firstChild,c=v.firstChild,g=c.nextSibling;return c.addEventListener("change",()=>e.onColumnToggle(n)),c.checked=u,a(g,()=>i.title),a(v,r&&(()=>{var m=Qe();return T(()=>ae(m,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),m})(),null),T(m=>O(g,`
                    font-size: 14px;
                    color: ${s?"#e0e0e0":"#888"};
                    ${!s&&u?"text-decoration: line-through;":""}
                  `,m)),o})()}}),null),a(t,C(U,{get when(){return e.onResetToDefaults},get children(){var i=Xe();return ee(i,"click",e.onResetToDefaults,!0),i}}),null),T(()=>te(t,`column-manager ${e.className||""}`)),t})()}se(["click"]);var tt=y(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
        .filter-input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .filter-panel select:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .filter-panel input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .filter-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        .toggle-button:hover {
          filter: brightness(1.1);
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
        .filter-panel {
          overflow-x: hidden;
        }

        .filter-panel * {
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Smooth transitions for panel operations */
        .filter-panel.resizing {
          transition: none !important;
        }
      `),nt=y('<div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;"></div><div style=font-size:11px;color:#666;margin-top:4px;>Size in bytes</div></div><div class=filter-section style=margin-bottom:24px;><button><span> Column Settings</span></button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">Filter Results</h3><p style=font-size:12px;color:#888;margin:0;line-height:1.4;>Showing: <!> of <!> files<br>'),Ie=y("<option>"),it=y('<div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">Responsive Layout</h3><div style=font-size:12px;color:#888;line-height:1.4;><div>Screen: <span style=color:#e0e0e0;>px (<!>)'),ot=y("<div style=margin-top:8px;><div style=color:#ff9900;margin-bottom:4px;>Hidden columns: </div><div style=font-size:11px;color:#666;></div><div style=font-size:11px;color:#666;margin-top:4px;>Hidden on mobile screens (tablet+ shows all columns)"),rt=y("<div style=color:#00ff00;margin-top:4px;font-size:11px;>All enabled columns visible"),lt=y("<span style=color:#ff9900;> files filtered out");function at(e){const[t,i]=L(!1),n=De({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var u=tt(),r=u.firstChild,s=r.firstChild,o=s.nextSibling,v=r.nextSibling;return ee(o,"click",e.onTogglePanel,!0),a(u,(()=>{var c=Y(()=>!!e.isOpen);return()=>c()&&(()=>{var g=nt(),m=g.firstChild,d=m.firstChild,l=d.nextSibling,h=m.nextSibling,x=h.firstChild,_=x.nextSibling;_.firstChild;var D=h.nextSibling,p=D.firstChild,z=p.nextSibling;z.firstChild;var W=D.nextSibling,P=W.firstChild,M=P.nextSibling,b=M.firstChild,I=b.nextSibling,H=I.nextSibling,j=W.nextSibling,w=j.firstChild,A=w.firstChild,K=A.firstChild,B=w.nextSibling,q=j.nextSibling,f=q.firstChild,k=f.nextSibling,S=k.firstChild,$=S.nextSibling,N=$.nextSibling,ne=N.nextSibling,ie=ne.nextSibling;return ie.nextSibling,l.$$input=R=>e.onFilterChange("name",R.currentTarget.value),_.addEventListener("change",R=>e.onFilterChange("mime",R.currentTarget.value)),a(_,C(fe,{get each(){return e.mimeCategories},children:R=>(()=>{var V=Ie();return V.value=R,a(V,R),V})()}),null),z.addEventListener("change",R=>e.onFilterChange("blobType",R.currentTarget.value)),a(z,C(fe,{get each(){return e.blobTypeCategories},children:R=>(()=>{var V=Ie();return V.value=R,a(V,R),V})()}),null),b.$$input=R=>e.onFilterChange("minSize",parseInt(R.currentTarget.value)||0),H.$$input=R=>e.onFilterChange("maxSize",parseInt(R.currentTarget.value)||1e8),w.$$click=()=>i(!t()),a(A,()=>t()?"Hide":"Show",K),a(B,C(et,{get columnVisibility(){return e.columnVisibility},get onColumnToggle(){return e.onColumnToggle},get responsiveColumnVisibility(){return e.responsiveColumnVisibility},get hiddenColumns(){return e.hiddenColumns},get breakpointInfo(){return e.breakpointInfo},onResetToDefaults:()=>{Object.entries({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!1,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0}).forEach(([V,Q])=>{e.columnVisibility[V]!==Q&&e.onColumnToggle(V)})}})),a(g,(()=>{var R=Y(()=>!!e.breakpointInfo);return()=>R()&&(()=>{var V=it(),Q=V.firstChild,E=Q.nextSibling,X=E.firstChild,le=X.firstChild,de=le.nextSibling,ue=de.firstChild,ve=ue.nextSibling;return ve.nextSibling,a(de,()=>e.screenWidth,ue),a(de,()=>e.breakpointInfo.name,ve),a(E,(()=>{var he=Y(()=>!!(e.hiddenColumns&&e.hiddenColumns.length>0));return()=>he()&&(()=>{var we=ot(),me=we.firstChild;me.firstChild;var ke=me.nextSibling;return a(me,()=>e.hiddenColumns.length,null),a(ke,()=>e.hiddenColumns.join(", ")),we})()})(),null),a(E,(()=>{var he=Y(()=>!e.hiddenColumns||e.hiddenColumns.length===0);return()=>he()&&rt()})(),null),V})()})(),q),a(k,()=>e.filteredCount,$),a(k,()=>e.totalCount,ne),a(k,(()=>{var R=Y(()=>e.filteredCount!==e.totalCount);return()=>R()&&(()=>{var V=lt(),Q=V.firstChild;return a(V,()=>e.totalCount-e.filteredCount,Q),V})()})(),null),T(R=>{var V=`toggle-button ${t()?"active":""}`,Q=`
                margin-bottom: 12px;
                width: 100%;
                padding: 10px;
                background: ${t()?"#ff00ff":"#333333"};
                box-sizing: border-box;
                min-width: 0;
                border: 1px solid ${t()?"#ff00ff":"#666666"};
                color: ${t()?"#000000":"#ffffff"};
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
              `,E=`column-settings ${t()?"":"collapsed"}`,X=`
                max-height: ${t()?"600px":"0"};
                overflow: hidden;
                transition: max-height 0.3s ease;
                margin-bottom: ${t()?"16px":"0"};
              `;return V!==R.e&&te(w,R.e=V),R.t=O(w,Q,R.t),E!==R.a&&te(B,R.a=E),R.o=O(B,X,R.o),R},{e:void 0,t:void 0,a:void 0,o:void 0}),T(()=>l.value=e.filterConfig.name),T(()=>_.value=e.filterConfig.mime),T(()=>z.value=e.filterConfig.blobType),T(()=>b.value=e.filterConfig.minSize||""),T(()=>H.value=e.filterConfig.maxSize||""),g})()})(),v),a(u,C(ze,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:c=>n.handleMouseDown(c,"left")}),v),T(c=>{var g=`filter-panel ${e.isOpen?"":"collapsed"} ${n.isDragging()?"resizing":""}`,m=`
        width: ${e.isOpen?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return g!==c.e&&te(u,c.e=g),c.t=O(u,m,c.t),c},{e:void 0,t:void 0}),u})()}se(["click","input"]);var st=y(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
        .settings-input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .settings-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        .toggle-button:hover {
          filter: brightness(1.1);
        }

        .connect-button:hover:not(:disabled) {
          background: #00cc00 !important;
          border-color: #00cc00 !important;
        }

        .disconnect-button:hover:not(:disabled) {
          background: #cc0000 !important;
          border-color: #cc0000 !important;
        }

        .refresh-button:hover {
          background: #0080ff !important;
          border-color: #0080ff !important;
        }

        .apply-updates-button:hover {
          background: #ffaa00 !important;
          border-color: #ffaa00 !important;
        }

        .reset-button:hover {
          background: #dc2626 !important;
          border-color: #dc2626 !important;
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
        .settings-panel {
          overflow-x: hidden;
        }

        .settings-panel * {
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Smooth transitions for panel operations */
        .settings-panel.resizing {
          transition: none !important;
        }

        /* Debug logs scrollbar styling */
        .debug-logs::-webkit-scrollbar {
          width: 6px;
        }

        .debug-logs::-webkit-scrollbar-track {
          background: #222;
        }

        .debug-logs::-webkit-scrollbar-thumb {
          background: #555;
          border-radius: 3px;
        }

        .debug-logs::-webkit-scrollbar-thumb:hover {
          background: #777;
        }
      `),dt=y('<div style=margin-top:12px;><button class=apply-updates-button style="width:100%;padding:8px;background:#ff9900;border:1px solid #ff9900;color:#000000;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;">Apply <!> Pending Updates'),ct=y("<div style=color:#ff9900;>Hidden: <!> items"),ut=y("<div style=margin-top:8px;>Last Updated: <span style=color:#e0e0e0;>"),gt=y('<div class=settings-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📋 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),ft=y('<div style="overflow-y:auto;height:calc(100vh - 120px);min-width:0;overflow-x:hidden;"><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=settings-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><div style=display:flex;gap:8px;margin-top:12px;><button class=connect-button>Connect</button><button class=disconnect-button>Disconnect</button></div><p style="font-size:12px;color:#888;margin:8px 0 0 0;">Status: <span></span></p><div style=margin-top:12px;font-size:12px;display:flex;align-items:center;gap:8px;>Auto-connect:<button></button></div><div style=margin-top:12px;font-size:12px;display:flex;align-items:center;gap:8px;>Auto-refresh:<button></button><button class=refresh-button style="background:#0066cc;border:1px solid #0066cc;color:#ffffff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;">Refresh Now</button></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Information</h3><div style=font-size:12px;color:#888;line-height:1.6;><div>Total Items: <span style=color:#e0e0e0;></span></div><div>Filtered Items: <span style=color:#e0e0e0;></span></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Settings</h3><div style=font-size:12px;display:flex;align-items:center;gap:8px;>Debug Mode:<button></button></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Reset Controls</h3><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:12px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.2s;">Reset All Settings</button><p style="font-size:11px;color:#666;margin:8px 0 0 0;text-align:center;">This will reset all filters, view modes, and panel settings'),pt=y("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;word-break:break-all;>");function ht(e){const t=De({initialWidth:e.initialWidth,minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:e.onWidthChange,onClose:e.onTogglePanel});return(()=>{var i=st(),n=i.firstChild,u=n.firstChild,r=u.nextSibling,s=n.nextSibling;return ee(r,"click",e.onTogglePanel,!0),a(i,(()=>{var o=Y(()=>!!e.isOpen);return()=>o()&&(()=>{var v=ft(),c=v.firstChild,g=c.firstChild,m=g.nextSibling,d=m.nextSibling,l=d.firstChild,h=l.nextSibling,x=d.nextSibling,_=x.firstChild,D=_.nextSibling,p=x.nextSibling,z=p.firstChild,W=z.nextSibling,P=p.nextSibling,M=P.firstChild,b=M.nextSibling,I=b.nextSibling,H=c.nextSibling,j=H.firstChild,w=j.nextSibling,A=w.firstChild,K=A.firstChild,B=K.nextSibling,q=A.nextSibling,f=q.firstChild,k=f.nextSibling,S=H.nextSibling,$=S.firstChild,N=$.nextSibling,ne=N.firstChild,ie=ne.nextSibling,R=S.nextSibling,V=R.firstChild,Q=V.nextSibling;return m.$$input=E=>e.onWsUrlChange(E.currentTarget.value),ee(l,"click",e.onConnect,!0),ee(h,"click",e.onDisconnect,!0),a(D,()=>e.connectionStatus),ee(W,"click",e.onToggleAutoConnect,!0),a(W,()=>e.autoConnect?"ON":"OFF"),ee(b,"click",e.onToggleAutoRefresh,!0),a(b,()=>e.autoRefresh?"ON":"OFF"),ee(I,"click",e.onRefresh,!0),a(c,C(U,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var E=dt(),X=E.firstChild,le=X.firstChild,de=le.nextSibling;return de.nextSibling,ee(X,"click",e.onApplyPendingUpdates,!0),a(X,()=>e.pendingUpdatesCount,de),E}}),null),a(B,()=>e.totalCount),a(k,()=>e.filteredCount),a(w,C(U,{get when(){return e.filteredCount!==e.totalCount},get children(){var E=ct(),X=E.firstChild,le=X.nextSibling;return le.nextSibling,a(E,()=>e.totalCount-e.filteredCount,le),E}}),null),a(w,C(U,{get when(){return e.lastUpdated},get children(){var E=ut(),X=E.firstChild,le=X.nextSibling;return a(le,()=>e.lastUpdated?.toLocaleTimeString()),E}}),null),ee(ie,"click",e.onToggleDebug,!0),a(ie,()=>e.debug?"ON":"OFF"),ee(Q,"click",e.onReset,!0),a(v,C(U,{get when(){return e.debug&&e.logs.length>0},get children(){var E=gt(),X=E.firstChild,le=X.nextSibling;return a(le,C(fe,{get each(){return e.logs},children:de=>(()=>{var ue=pt();return a(ue,de),ue})()})),E}}),null),T(E=>{var X=e.connectionStatus==="connected",le=`
                  flex: 1;
                  padding: 8px;
                  background: ${e.connectionStatus==="connected"?"#666666":"#00aa00"};
                  border: 1px solid ${e.connectionStatus==="connected"?"#666666":"#00aa00"};
                  color: #ffffff;
                  border-radius: 4px;
                  cursor: ${e.connectionStatus==="connected"?"not-allowed":"pointer"};
                  font-size: 12px;
                  transition: all 0.2s;
                `,de=e.connectionStatus!=="connected",ue=`
                  flex: 1;
                  padding: 8px;
                  background: ${e.connectionStatus!=="connected"?"#666666":"#aa0000"};
                  border: 1px solid ${e.connectionStatus!=="connected"?"#666666":"#aa0000"};
                  color: #ffffff;
                  border-radius: 4px;
                  cursor: ${e.connectionStatus!=="connected"?"not-allowed":"pointer"};
                  font-size: 12px;
                  transition: all 0.2s;
                `,ve=`color: ${e.connectionStatus==="connected"?"#00ff00":e.connectionStatus==="connecting"?"#ffff00":"#ff4444"}`,he=`toggle-button ${e.autoConnect?"active":""}`,we=`
                  background: ${e.autoConnect?"#ff00ff":"#333333"};
                  border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
                  color: ${e.autoConnect?"#000000":"#ffffff"};
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                `,me=`toggle-button ${e.autoRefresh?"active":""}`,ke=`
                  background: ${e.autoRefresh?"#ff00ff":"#333333"};
                  border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
                  color: ${e.autoRefresh?"#000000":"#ffffff"};
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                `,Ce=`toggle-button ${e.debug?"active":""}`,Me=`
                  padding: 4px 8px;
                  background: ${e.debug?"#ff00ff":"#333333"};
                  border: 1px solid ${e.debug?"#ff00ff":"#666666"};
                  color: ${e.debug?"#000000":"#ffffff"};
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 12px;
                  transition: all 0.2s;
                `;return X!==E.e&&(l.disabled=E.e=X),E.t=O(l,le,E.t),de!==E.a&&(h.disabled=E.a=de),E.o=O(h,ue,E.o),E.i=O(D,ve,E.i),he!==E.n&&te(W,E.n=he),E.s=O(W,we,E.s),me!==E.h&&te(b,E.h=me),E.r=O(b,ke,E.r),Ce!==E.d&&te(ie,E.d=Ce),E.l=O(ie,Me,E.l),E},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0}),T(()=>m.value=e.wsUrl),v})()})(),s),a(i,C(ze,{position:"right",get isDragging(){return t.isDragging()},onMouseDown:o=>t.handleMouseDown(o,"left")}),s),T(o=>{var v=`settings-panel ${e.isOpen?"":"collapsed"} ${t.isDragging()?"resizing":""}`,c=`
        width: ${e.isOpen?t.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isOpen?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return v!==o.e&&te(i,o.e=v),o.t=O(i,c,o.t),o},{e:void 0,t:void 0}),i})()}se(["click","input"]);var mt=y(`<div><div class=arrow-container></div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;></div><style>
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
        `);function bt(e){const[t,i]=L(!1);return C(U,{get when(){return e.isVisible},get children(){var n=mt(),u=n.firstChild,r=u.nextSibling;return n.addEventListener("mouseleave",()=>i(!1)),n.addEventListener("mouseenter",()=>i(!0)),ee(n,"click",e.onClick,!0),a(u,()=>e.position==="left"?"→":"←"),a(r,()=>e.panelName),T(s=>{var o=`edge-toggle-button edge-toggle-${e.position}`,v=`Show ${e.panelName} panel`,c=`
          position: fixed;
          top: 50%;
          ${e.position}: 0;
          transform: translateY(-50%);
          width: 24px;
          height: 80px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
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
        `,g=`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `;return o!==s.e&&te(n,s.e=o),v!==s.t&&ae(n,"title",s.t=v),s.a=O(n,c,s.a),s.o=O(u,g,s.o),s},{e:void 0,t:void 0,a:void 0,o:void 0}),n}})}se(["click"]);var xt=y('<button class="toolbar-button primary"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download'),vt=y('<button class="toolbar-button secondary"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More'),yt=y('<button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×'),$t=y(`<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><style>
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
        `);function wt(e){return C(U,{get when(){return e.selectedCount>1},get children(){var t=$t(),i=t.firstChild,n=i.firstChild,u=n.nextSibling;u.nextSibling;var r=i.nextSibling;return a(i,()=>e.selectedCount,n),a(i,()=>e.selectedCount===1?"":"s",u),a(t,C(U,{get when(){return e.onDownload},get children(){var s=xt();return ee(s,"click",e.onDownload,!0),s}}),r),a(t,C(U,{get when(){return e.onMore},get children(){var s=vt();return s.$$click=o=>e.onMore?.(o),s}}),r),a(t,C(U,{get when(){return e.onClear},get children(){var s=yt();return ee(s,"click",e.onClear,!0),s}}),r),T(()=>te(t,`selection-toolbar ${e.className||""}`)),t}})}se(["click"]);function kt(e={}){const[t,i]=L(e.initialSelection||new Set),[n,u]=L(-1),[r,s]=L(!1),[o,v]=L(null),[c,g]=L(null),m=P=>{i(M=>{const b=new Set(M);return b.has(P)?b.delete(P):b.add(P),b})},d=(P,M,b)=>{const I=Math.min(P,M),H=Math.max(P,M),j=b.slice(I,H+1);i(w=>{const A=new Set(w);return j.forEach(K=>A.add(K.id)),A})},l=()=>{i(new Set),u(-1)},h=P=>{const M=new Set(P.map(b=>b.id));i(M)},x=P=>t().has(P),_=(P,M,b)=>{const I=P.id;if(b.metaKey||b.ctrlKey)b.preventDefault(),m(I),u(M);else if(b.shiftKey&&n()>=0)b.preventDefault(),u(M);else{if(b.detail>1)return;i(new Set([I])),u(M)}},D=(P,M,b)=>{(b.shiftKey||b.ctrlKey||b.metaKey)&&b.preventDefault(),b.button===0&&!b.metaKey&&!b.ctrlKey&&!b.shiftKey&&(b.preventDefault(),v({x:b.clientX,y:b.clientY,startIndex:M}),s(!0))},p=P=>{const M=P.target,b=M&&(M.tagName==="INPUT"||M.tagName==="TEXTAREA"||M.isContentEditable||M.getAttribute("contenteditable")==="true");P.key==="Escape"?l():P.key==="a"&&(P.metaKey||P.ctrlKey)?b||P.preventDefault():(P.key==="Delete"||P.key==="Backspace")&&!b&&t().size>0&&e.onDelete?.(t())},z=P=>{r()&&o()&&g({x:P.clientX,y:P.clientY,endIndex:-1})},W=()=>{r()&&(s(!1),v(null),g(null))};return ce(()=>{document.addEventListener("mousemove",z),document.addEventListener("mouseup",W),document.addEventListener("keydown",p)}),ge(()=>{document.removeEventListener("mousemove",z),document.removeEventListener("mouseup",W),document.removeEventListener("keydown",p),document.body.classList.remove("drag-selecting")}),xe(()=>{r()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),xe(()=>{const P=t();e.onSelectionChange?.(P),e.saveToStorage?.(P)}),{selectedItems:t,setSelectedItems:i,lastSelectedIndex:n,setLastSelectedIndex:u,isDragSelecting:r,setIsDragSelecting:s,dragStart:o,setDragStart:v,dragEnd:c,setDragEnd:g,toggleSelection:m,selectRange:d,clearSelection:l,selectAll:h,isSelected:x,handleRowClick:_,handleRowMouseDown:D,handleKeyDown:p}}const G={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},Ct=(e,t,i)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const n=e[i],u=t[i];if(n==null&&u==null)return 0;if(n==null)return 1;if(u==null)return-1;if(i==="name"){const c=re(e),g=re(t);return c.localeCompare(g,void 0,{numeric:!0,sensitivity:"base"})}if(i.includes("_at")||i.includes("date")||i.includes("time")){const c=new Date(n),g=new Date(u);if(!isNaN(c.getTime())&&!isNaN(g.getTime()))return c.getTime()-g.getTime()}const r=Number(n),s=Number(u);if(!isNaN(r)&&!isNaN(s)&&typeof n=="number"&&typeof u=="number")return r-s;if(i==="size"&&typeof n=="string"&&typeof u=="string"){const c=Ee(n),g=Ee(u);if(c!==null&&g!==null)return c-g}const o=String(n).toLowerCase(),v=String(u).toLowerCase();return i==="name"||i.includes("filename")?o.localeCompare(v,void 0,{numeric:!0,sensitivity:"base"}):o.localeCompare(v)},Ee=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const i=parseFloat(t[1]),n=(t[2]||"B").toUpperCase(),u={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return i*(u[n]||1)};function _t(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[i,n]=L(e.initialSort||t),[u,r]=L(new Set),[s,o]=L(!1),[v,c]=L(!1),g=e.getItemId||(p=>p.id||String(p)),m=J(()=>{const p=i(),z=[...e.data];return z.length>1e3&&(c(!0),setTimeout(()=>c(!1),100)),z.sort((W,P)=>{const M=Ct(W,P,p.field);return p.direction==="desc"?M*-1:M})});return{sortConfig:i,selectedItems:u,isDragSelecting:s,isSorting:v,sortedData:m,handleSort:p=>{const z=i();if(z.field===p)if(p===t.field){const W=z.direction==="asc"?"desc":"asc";n({field:p,direction:W})}else z.direction==="asc"?n({field:p,direction:"desc"}):z.direction==="desc"?n(t):n({field:p,direction:"asc"});else{const W=p.includes("_at")||p.includes("date")||p.includes("time")?"desc":"asc";n({field:p,direction:W})}},toggleSelection:p=>{const z=new Set(u());z.has(p)?z.delete(p):z.add(p),r(z)},clearSelection:()=>{r(new Set)},selectAll:()=>{const p=new Set(e.data.map(g));r(p)},isSelected:p=>u().has(p),selectRange:(p,z)=>{const W=new Set(u()),P=Math.min(p,z),M=Math.max(p,z);for(let b=P;b<=M;b++)if(b<e.data.length&&e.data[b]!=null){const I=g(e.data[b]);W.add(I)}r(W)},setIsDragSelecting:o,getItemId:g}}var Re=y("<div>"),St=y("<div class=grid-cell>"),Te=y("<div class=grid-content>"),zt=y("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Dt=y("<div class=grid-stats>Showing rows <!>-<!> of "),Mt=y("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),Pt=y('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),It=y('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),Et=y("<div><div style=font-weight:500;flex:1;>"),Tt=y("<span>");function Le(e){let t;ce(()=>{e.onRowMount&&e.onRowMount(e.item)});const i=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var n=Re();n.$$contextmenu=r=>e.onContextMenu?.(e.item,e.index,r),n.$$mousedown=r=>e.onRowMouseDown?.(e.item,e.index,r),n.$$dblclick=r=>e.onRowDoubleClick?.(e.item,e.index,r),n.$$click=r=>e.onRowClick?.(e.item,e.index,r);var u=t;return typeof u=="function"?pe(u,n):t=n,a(n,C(fe,{get each(){return e.columns},children:r=>(()=>{var s=St();return a(s,(()=>{var o=Y(()=>!!r.render);return()=>o()?r.render(e.item,e.index):String(e.item[r.key]||"")})()),T(o=>O(s,`
              flex: ${r.width?"0 0 "+r.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${r.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${r.className==="sticky-actions-column"?"0":"auto"};
              background: ${r.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":G.colors.background:"transparent"};
              ${r.className==="sticky-actions-column"?"border-left: 1px solid "+G.colors.border+";":""}
              box-shadow: ${r.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${r.className==="sticky-actions-column"?"5":"1"};
            `,o)),s})()})),T(r=>{var s=`grid-row ${e.isSelected?"selected":""} ${i()?"focused":""}`,o=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${G.colors.border};
        background: ${e.isSelected?G.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${i()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return s!==r.e&&te(n,r.e=s),r.t=O(n,o,r.t),r},{e:void 0,t:void 0}),n})()}function Lt(e){const[t,i]=L(),[n,u]=L(0),[r,s]=L(0),o=e.rowHeight||50,v=e.headerHeight||60,c=e.virtualizeThreshold||100,g=J(()=>e.columns.reduce((b,I)=>b+(I.width||200),0)),m=_t({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),d=(b,I,H)=>{e.onRowClick?.(b,I,H)},l=(b,I,H)=>{e.onRowDoubleClick?.(b,I,H)},h=(b,I,H)=>{e.onRowMouseDown?.(b,I,H)},x=J(()=>e.data.length>c),_=J(()=>{if(!x())return e.data.map((B,q)=>({item:B,index:q}));if(!t())return[];const I=o,H=n(),j=r(),w=Math.floor(H/I),A=Math.min(e.data.length-1,Math.ceil((H+j)/I)+5),K=[];for(let B=Math.max(0,w-5);B<=A;B++)B<e.data.length&&e.data[B]!=null&&K.push({item:e.data[B],index:B});return K}),D=J(()=>e.data.length===0?0:t()?Math.floor(n()/o)+1:1),p=J(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const I=r()-v,H=Math.floor(I/o),j=Math.floor(n()/o)+H;return Math.min(j,e.data.length)}),z=J(()=>e.data.length),W=J(()=>e.data.length*o),P=b=>{const I=b.target;if(u(I.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const H=I.scrollHeight,j=I.scrollTop,w=I.clientHeight;H-j-w<200&&e.onLoadMore()}},M=b=>{if(m.handleSort(b),e.onSort){const I=m.sortConfig();e.onSort(I.field,I.direction)}};return ce(()=>{const b=t();if(!b)return;const I=new ResizeObserver(H=>{for(const j of H)s(j.contentRect.height)});I.observe(b),ge(()=>{I.disconnect()})}),(()=>{var b=Mt(),I=b.firstChild,H=I.firstChild,j=I.nextSibling;return I.addEventListener("scroll",P),pe(i,I),a(H,C(fe,{get each(){return e.columns},children:w=>(()=>{var A=Et(),K=A.firstChild;return A.$$click=()=>w.sortable&&!m.isSorting()&&M(w.key),a(K,(()=>{var B=Y(()=>typeof w.title=="string");return()=>B()?(()=>{var q=Tt();return a(q,()=>w.title),q})():w.title})()),a(A,C(U,{get when(){return Y(()=>!!m.isSorting())()&&m.sortConfig().field===w.key},get children(){return Pt()}}),null),a(A,C(U,{get when(){return w.sortable},get children(){var B=It(),q=B.firstChild,f=q.nextSibling;return T(k=>{var S=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${m.sortConfig().field===w.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,$=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${m.sortConfig().field===w.key&&m.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,N=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${m.sortConfig().field===w.key&&m.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return k.e=O(B,S,k.e),k.t=O(q,$,k.t),k.a=O(f,N,k.a),k},{e:void 0,t:void 0,a:void 0}),B}}),null),T(B=>{var q=`grid-header-cell ${w.sortable?"sortable":""} ${w.sortable&&m.sortConfig().field===w.key?"active-sort":""}`,f=`
                  flex: ${w.width?"0 0 "+w.width+"px":"1"};
                  padding: 8px 12px;
                  cursor: ${w.sortable?"pointer":"default"};
                  user-select: none;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  transition: all 0.15s ease;
                  border-radius: 4px;
                  margin: 4px 2px;
                  position: ${w.className==="sticky-actions-column"?"sticky":"relative"};
                  right: ${w.className==="sticky-actions-column"?"0":"auto"};
                  background: ${w.className==="sticky-actions-column"?G.colors.header:"transparent"};
                  ${w.className==="sticky-actions-column"?"border-left: 1px solid "+G.colors.border+";":""}
                  box-shadow: ${w.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.2)":"none"};
                  z-index: ${w.className==="sticky-actions-column"?"5":"1"};
                  opacity: ${m.isSorting()&&m.sortConfig().field===w.key?"0.7":"1"};
                `;return q!==B.e&&te(A,B.e=q),B.t=O(A,f,B.t),B},{e:void 0,t:void 0}),A})()})),a(I,C(U,{get when(){return x()},get fallback(){return(()=>{var w=Te();return a(w,C(fe,{get each(){return e.data},children:(A,K)=>C(Le,{item:A,get index(){return K()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(A)||A.id)||!1},onRowClick:d,onRowDoubleClick:l,onRowMouseDown:h,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:o,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),T(A=>O(w,`min-width: ${g()}px;`,A)),w})()},get children(){var w=Te();return a(w,C(fe,{get each(){return _()},children:A=>(()=>{var K=Re();return a(K,C(Le,{get item(){return A.item},get index(){return A.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(A.item)||A.item.id)||!1},onRowClick:d,onRowDoubleClick:l,onRowMouseDown:h,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:o,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),T(B=>O(K,`
                    position: absolute;
                    top: ${A.index*o}px;
                    left: 0;
                    right: 0;
                  `,B)),K})()})),T(A=>O(w,`height: ${W()}px; position: relative; min-width: ${g()}px;`,A)),w}}),null),a(b,C(U,{get when(){return e.showPaginationStatus!==!1},get children(){var w=Dt(),A=w.firstChild,K=A.nextSibling,B=K.nextSibling,q=B.nextSibling;return q.nextSibling,a(w,D,K),a(w,p,q),a(w,z,null),a(w,C(U,{get when(){return e.isLoadingMore},get children(){return zt()}}),null),T(f=>O(w,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${G.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,f)),w}}),j),a(j,()=>`
        .grid-row:hover:not(.selected) {
          background: ${G.colors.hover};
        }

        .grid-row.selected {
          background: ${G.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${G.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${G.colors.selected};
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
          background: ${G.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${G.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${G.colors.text};
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
      `),T(w=>{var A=`infinite-data-grid ${e.className||""}`,K=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${G.colors.background};
        color: ${G.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,B=`
            height: ${v}px;
            display: flex;
            align-items: center;
            background: ${G.colors.header};
            border-bottom: 2px solid ${G.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${g()}px;
          `;return A!==w.e&&te(b,w.e=A),w.t=O(b,K,w.t),w.a=O(H,B,w.a),w},{e:void 0,t:void 0,a:void 0}),b})()}se(["click","dblclick","mousedown","contextmenu"]);var At=y(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),Rt=y("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),Ft=y("<span style=color:#94a3b8;>"),Ot=y('<div title="Has thumbnails">'),Wt=y('<div title="Generating thumbnails...">');function Bt(e){const t=()=>e.size||40,i=()=>e.borderRadius||"4px",n=He({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var u=At(),r=u.firstChild;return a(u,(()=>{var s=Y(()=>!!n.url);return()=>s()?(()=>{var o=Rt();return ee(o,"error",n.onImageError),T(v=>{var c=n.url,g=`Thumbnail for ${e.item.id.slice(0,8)}`;return c!==v.e&&ae(o,"src",v.e=c),g!==v.t&&ae(o,"alt",v.t=g),v},{e:void 0,t:void 0}),o})():(()=>{var o=Ft();return a(o,()=>n.fallbackIcon),o})()})(),r),a(u,C(U,{get when(){return e.showIndicators!==!1},get children(){return Y(()=>!!n.hasThumbnails)()?(()=>{var s=Ot();return T(o=>O(s,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,o)),s})():Y(()=>!!n.isRequested)()?(()=>{var s=Wt();return T(o=>O(s,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #f59e0b;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
              animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            `,o)),s})():null}}),r),T(s=>{var o=`thumbnail ${e.className||""}`,v=`
        width: ${t()}px;
        height: ${t()}px;
        border-radius: ${i()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12,t()*.3)}px;
        position: relative;
        flex-shrink: 0;
      `,c=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return o!==s.e&&te(u,s.e=o),s.t=O(u,v,s.t),c!==s.a&&ae(u,"title",s.a=c),s},{e:void 0,t:void 0,a:void 0}),u})()}function Fe(e){if(e===0)return"0 B";const t=1024,i=["B","KB","MB","GB","TB","PB"],n=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,n)).toFixed(2))+" "+i[n]}const Oe="freqhole-demo-state",_e=300;function Se(){try{const e=localStorage.getItem(Oe);return e?JSON.parse(e):{}}catch{return{}}}function Z(e){try{const i={...Se(),...e};localStorage.setItem(Oe,JSON.stringify(i))}catch{}}function Nt(e){const t=Se(),[i,n]=L({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[u,r]=L({field:"created_at",direction:"desc",...t.sortConfig||{}}),[s,o]=L(t.viewMode||"default"),[v,c]=L({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[g,m]=L(t.isFilterPanelOpen??!0),[d,l]=L(t.filterPanelWidth||_e),[h,x]=L(t.isBrowsePanelOpen??!0),[_,D]=L(t.browsePanelWidth||_e),[p,z]=L(t.isSettingsPanelOpen??!1),[W,P]=L(t.settingsPanelWidth||_e),[M,b]=L(t.wsUrl||e.wsUrl),[I,H]=L(t.autoConnect??e.autoConnect),[j,w]=L(t.autoRefresh??!0),[A,K]=L(t.debug??!1),[B,q]=L(null),[f,k]=L(null),[S,$]=L(null),[N,ne]=L(null),[ie,R]=L(null),[V,Q]=L([]),[E,X]=L("Disconnected"),[le,de]=L(!1),[ue,ve]=L(null);return{filterConfig:i,setFilterConfig:F=>{n(F),Z({filterConfig:F})},updateFilter:(F,oe)=>{n(be=>{const Pe={...be,[F]:oe};return Z({filterConfig:Pe}),Pe})},sortConfig:u,setSortConfig:F=>{r(F),Z({sortConfig:F})},handleSort:(F,oe)=>{const be={field:F,direction:oe};r(be),Z({sortConfig:be})},viewMode:s,setViewMode:F=>{o(F),Z({viewMode:F})},columnVisibility:v,setColumnVisibility:F=>{c(F),Z({columnVisibility:F})},toggleColumn:F=>{c(oe=>{const be={...oe,[F]:!oe[F]};return Z({columnVisibility:be}),be})},isFilterPanelOpen:g,setIsFilterPanelOpen:F=>{m(F),Z({isFilterPanelOpen:F})},toggleFilterPanel:()=>{m(F=>{const oe=!F;return Z({isFilterPanelOpen:oe}),oe})},filterPanelWidth:d,setFilterPanelWidth:F=>{l(F),Z({filterPanelWidth:F})},isBrowsePanelOpen:h,setIsBrowsePanelOpen:F=>{x(F),Z({isBrowsePanelOpen:F})},toggleBrowsePanel:()=>{x(F=>{const oe=!F;return Z({isBrowsePanelOpen:oe}),oe})},browsePanelWidth:_,setBrowsePanelWidth:F=>{D(F),Z({browsePanelWidth:F})},isSettingsPanelOpen:p,setIsSettingsPanelOpen:F=>{z(F),Z({isSettingsPanelOpen:F})},toggleSettingsPanel:()=>{z(F=>{const oe=!F;return Z({isSettingsPanelOpen:oe}),oe})},settingsPanelWidth:W,setSettingsPanelWidth:F=>{P(F),Z({settingsPanelWidth:F})},wsUrl:M,setWsUrl:b,autoConnect:I,setAutoConnect:H,autoRefresh:j,setAutoRefresh:w,debug:A,setDebug:K,popupPreview:B,setPopupPreview:q,actionMenu:f,setActionMenu:k,bulkActionMenu:S,setBulkActionMenu:$,confirmDialog:N,setConfirmDialog:ne,headerActionMenu:ie,setHeaderActionMenu:R,logs:V,setLogs:Q,connectionStatus:E,setConnectionStatus:X,hasPendingUpdates:le,setHasPendingUpdates:de,lastUpdated:ue,setLastUpdated:ve,loadState:Se,saveState:Z}}const We=Be(),Ut=e=>{const t=Nt({wsUrl:e.wsUrl,autoConnect:e.autoConnect});return C(We.Provider,{value:t,get children(){return e.children}})};function $e(){const e=Ne(We);if(!e)throw new Error("useFreqholeStateContext must be used within a FreqholeStateProvider");return e}var Ht=y('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),Vt=y("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),Kt=y("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),jt=y("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:4rem;>🎵</div><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),qt=y('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),Yt=y("<div style=text-align:center;margin-bottom:24px;>"),Xt=y("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),Gt=y("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),Jt=y('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function Qt(){const e=$e();let t;const i=r=>{r.key==="Escape"&&(r.preventDefault(),e.setPopupPreview(null))},n=r=>{r.target===t&&(r.preventDefault(),r.stopPropagation(),e.setPopupPreview(null))};ce(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",i),document.addEventListener("click",n),document.body.style.overflow="hidden")}),ge(()=>{document.removeEventListener("keydown",i,!0),document.body.style.overflow=""});const u=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",i,!0),document.addEventListener("click",n,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",i,!0),document.removeEventListener("click",n,!0),document.body.style.overflow="")};return ce(()=>{const r=()=>{u(),requestAnimationFrame(r)};r()}),C(U,{get when(){return Y(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var r=Ht(),s=r.firstChild,o=s.firstChild;r.$$click=n;var v=t;return typeof v=="function"?pe(v,r):t=r,s.$$click=c=>c.stopPropagation(),o.addEventListener("mouseleave",c=>{c.target.style.background="#ef4444"}),o.addEventListener("mouseenter",c=>{c.target.style.background="#dc2626"}),o.$$click=()=>e.setPopupPreview(null),a(s,C(U,{get when(){return e.popupPreview()?.item},children:c=>{const g=c().mime||"",m=g.startsWith("image/"),d=g.startsWith("video/"),l=g.startsWith("audio/"),h=re(c());return[(()=>{var x=Yt();return a(x,C(U,{when:m,get children(){var _=Vt();return _.addEventListener("error",D=>{const p=D.target;p.style.display="none";const z=document.createElement("div");z.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${h}</div>
                            </div>
                          `,p.parentNode?.appendChild(z)}),ae(_,"alt",h),T(()=>ae(_,"src",`/api/blobs/${c().id}`)),_}}),null),a(x,C(U,{when:d,get children(){var _=Kt(),D=_.firstChild;return ae(D,"type",g),T(()=>ae(D,"src",`/api/blobs/${c().id}`)),_}}),null),a(x,C(U,{when:l,get children(){var _=jt(),D=_.firstChild,p=D.nextSibling,z=p.nextSibling,W=z.firstChild;return a(p,h),ae(W,"type",g),T(()=>ae(W,"src",`/api/blobs/${c().id}`)),_}}),null),a(x,C(U,{when:!m&&!d&&!l,get children(){var _=qt(),D=_.firstChild,p=D.nextSibling,z=p.nextSibling,W=z.firstChild;return T(()=>ae(W,"href",`/api/blobs/${c().id}`)),_}}),null),x})(),(()=>{var x=Jt(),_=x.firstChild,D=_.nextSibling,p=D.firstChild,z=p.firstChild,W=z.nextSibling,P=p.nextSibling,M=P.firstChild,b=M.nextSibling,I=P.nextSibling,H=I.firstChild,j=H.nextSibling,w=I.nextSibling,A=w.firstChild,K=A.nextSibling,B=w.nextSibling,q=B.firstChild,f=q.nextSibling,k=B.nextSibling,S=k.firstChild,$=S.nextSibling,N=k.nextSibling,ne=N.firstChild,ie=ne.nextSibling;return a(W,h),a(b,()=>c().id),a(j,()=>c().sha256),a(K,()=>c().blob_type),a(f,g||"unknown"),a($,()=>Fe(c().size||0)),a(ie,()=>new Date(c().created_at).toLocaleString()),a(D,C(U,{get when(){return c().parent_blob_id},get children(){var R=Xt(),V=R.firstChild,Q=V.nextSibling;return a(Q,()=>c().parent_blob_id),R}}),null),a(D,C(U,{get when(){return c().local_path},get children(){var R=Gt(),V=R.firstChild,Q=V.nextSibling;return a(Q,()=>c().local_path),R}}),null),x})()]}}),null),r}})}se(["click"]);var Zt=y(`<div><style>
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: scale(0.95) translateY(-8px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }

          .action-menu-item:hover {
            background: #3a3a3a !important;
          }

          .action-menu-item:active {
            background: #444 !important;
          }
        `),en=y('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),tn=y('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function nn(){const e=$e();let t;const[i,n]=L({x:0,y:0}),u=d=>{d.key==="Escape"&&(d.preventDefault(),d.stopPropagation(),e.setActionMenu(null))},r=d=>{t&&!t.contains(d.target)&&(d.preventDefault(),d.stopPropagation(),e.setActionMenu(null))},s=()=>{if(!t)return;const d=180,l=160,h=e.actionMenu()?.position;if(!h)return;const{x,y:_}=h;let D=x,p=_;const z=window.innerWidth,W=window.innerHeight;x+d>z&&(D=Math.max(10,z-d-10)),_+l>W&&(p=Math.max(10,_-l)),n({x:D,y:p})};xe(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",u,!0),document.addEventListener("mousedown",r,!0),setTimeout(s,0)):(document.removeEventListener("keydown",u,!0),document.removeEventListener("mousedown",r,!0))}),ge(()=>{document.removeEventListener("keydown",u,!0),document.removeEventListener("mousedown",r,!0)});const o=async()=>{const d=e.actionMenu()?.item;if(d){try{const l=re(d),h=document.createElement("a");h.href=`/api/blobs/${d.id}`,h.download=l,document.body.appendChild(h),h.click(),document.body.removeChild(h),console.log(`📥 Downloaded: ${l}`)}catch(l){console.error("Download failed:",l)}e.setActionMenu(null)}},v=()=>{const d=e.actionMenu()?.item;d&&(e.setPopupPreview({item:d,isOpen:!0}),e.setActionMenu(null))},c=()=>{const d=e.actionMenu()?.item;d&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[d],onConfirm:()=>{console.log(`🗑️ Deleted: ${re(d)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},g=async()=>{const d=e.actionMenu()?.item;if(d){try{const l=`${window.location.origin}/api/blobs/${d.id}`;await navigator.clipboard.writeText(l),console.log(`🔗 Copied URL for: ${re(d)}`)}catch(l){console.error("Copy URL failed:",l)}e.setActionMenu(null)}},m=d=>{const l=d.mime||"";return l.startsWith("image/")?"🖼️":l.startsWith("video/")?"🎥":l.startsWith("audio/")?"🎵":l.includes("pdf")?"📄":l.includes("text")?"📝":"📄"};return C(U,{get when(){return Y(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var d=Zt(),l=d.firstChild;d.$$click=x=>x.stopPropagation();var h=t;return typeof h=="function"?pe(h,d):t=d,a(d,C(U,{get when(){return e.actionMenu()?.item},children:x=>[(()=>{var _=en(),D=_.firstChild,p=D.nextSibling;return a(D,()=>m(x())),a(p,()=>re(x())),_})(),(()=>{var _=tn(),D=_.firstChild,p=D.nextSibling,z=p.nextSibling,W=z.nextSibling,P=W.nextSibling;return D.addEventListener("mouseleave",M=>{M.target.style.background="transparent"}),D.addEventListener("mouseenter",M=>{M.target.style.background="#3a3a3a"}),D.$$click=v,p.addEventListener("mouseleave",M=>{M.target.style.background="transparent"}),p.addEventListener("mouseenter",M=>{M.target.style.background="#3a3a3a"}),p.$$click=o,z.addEventListener("mouseleave",M=>{M.target.style.background="transparent"}),z.addEventListener("mouseenter",M=>{M.target.style.background="#3a3a3a"}),z.$$click=g,P.addEventListener("mouseleave",M=>{M.target.style.background="transparent"}),P.addEventListener("mouseenter",M=>{M.target.style.background="#2a1a1a"}),P.$$click=c,_})()]}),l),T(x=>O(d,`
          position: fixed;
          left: ${i().x}px;
          top: ${i().y}px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 180px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `,x)),d}})}se(["click"]);var on=y(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (0 selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: scale(0.95) translateY(-8px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
        `);function rn(){const e=$e();let t;const[i,n]=L({x:0,y:0}),u=g=>{g.key==="Escape"&&(g.preventDefault(),g.stopPropagation(),e.setBulkActionMenu(null))},r=g=>{t&&!t.contains(g.target)&&(g.preventDefault(),g.stopPropagation(),e.setBulkActionMenu(null))},s=()=>{if(!t)return;const g=200,m=140,d=e.bulkActionMenu()?.position;if(!d)return;const{x:l,y:h}=d;let x=l,_=h;const D=window.innerWidth,p=window.innerHeight;l+g>D&&(x=Math.max(10,D-g-10)),h+m>p&&(_=Math.max(10,h-m)),n({x,y:_})};xe(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",u,!0),document.addEventListener("mousedown",r,!0),setTimeout(s,0)):(document.removeEventListener("keydown",u,!0),document.removeEventListener("mousedown",r,!0))}),ge(()=>{document.removeEventListener("keydown",u,!0),document.removeEventListener("mousedown",r,!0)});const o=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},v=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},c=()=>{console.log("🔄 Clear selection requested"),e.setBulkActionMenu(null)};return C(U,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var g=on(),m=g.firstChild,d=m.nextSibling,l=d.firstChild,h=l.nextSibling,x=h.nextSibling,_=x.nextSibling;g.$$click=p=>p.stopPropagation();var D=t;return typeof D=="function"?pe(D,g):t=g,l.addEventListener("mouseleave",p=>{p.target.style.background="transparent"}),l.addEventListener("mouseenter",p=>{p.target.style.background="#3a3a3a"}),l.$$click=o,h.addEventListener("mouseleave",p=>{p.target.style.background="transparent"}),h.addEventListener("mouseenter",p=>{p.target.style.background="#3a3a3a"}),h.$$click=c,_.addEventListener("mouseleave",p=>{p.target.style.background="transparent"}),_.addEventListener("mouseenter",p=>{p.target.style.background="#2a1a1a"}),_.$$click=v,T(p=>O(g,`
          position: fixed;
          left: ${i().x}px;
          top: ${i().y}px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `,p)),g}})}se(["click"]);var ln=y("<div class=drag-selection-overlay>"),an=y('<div class="drag-selection-corner drag-selection-corner-tl">'),sn=y('<div class="drag-selection-corner drag-selection-corner-br">'),dn=y("<div class=drag-selection-tooltip>Selecting...");function cn(e){const t=J(()=>{if(!e.isDragSelecting||!e.dragStart||!e.dragEnd)return null;const i=e.dragStart,n=e.dragEnd,u=Math.min(i.x,n.x),r=Math.min(i.y,n.y),s=Math.abs(n.x-i.x),o=Math.abs(n.y-i.y);return{left:u,top:r,width:s,height:o}});return C(U,{get when(){return Y(()=>!!e.isDragSelecting)()&&t()},children:i=>[(()=>{var n=ln();return T(u=>O(n,`
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
            `,u)),n})(),(()=>{var n=an();return T(u=>O(n,`
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
            `,u)),n})(),(()=>{var n=sn();return T(u=>O(n,`
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
            `,u)),n})(),C(U,{get when(){return Y(()=>i().width>50)()&&i().height>20},get children(){var n=dn();return T(u=>O(n,`
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
              `,u)),n}})]})}var un=y('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),gn=y('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),fn=y('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),pn=y(`<style>
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .confirm-dialog-backdrop button:hover {
          transform: translateY(-1px);
          filter: brightness(1.1);
        }

        .confirm-dialog-backdrop button:active {
          transform: translateY(0);
        }

        .confirm-dialog-backdrop button:focus {
          outline: 2px solid #ff00ff;
          outline-offset: 2px;
        }

        /* Scrollbar styling for items list */
        .confirm-dialog div::-webkit-scrollbar {
          width: 6px;
        }

        .confirm-dialog div::-webkit-scrollbar-track {
          background: #1a1a1a;
        }

        .confirm-dialog div::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }

        .confirm-dialog div::-webkit-scrollbar-thumb:hover {
          background: #666;
        }
      `),hn=y('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function mn(){const e=$e();let t,i;ce(()=>{e.confirmDialog()?.isOpen&&i&&setTimeout(()=>i?.focus(),100)});const n=r=>{e.confirmDialog()?.isOpen&&(r.key==="Escape"?(r.preventDefault(),e.setConfirmDialog(null)):r.key==="Enter"&&r.ctrlKey&&(r.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ce(()=>{document.addEventListener("keydown",n,!0)}),ge(()=>{document.removeEventListener("keydown",n,!0)});const u=r=>{r.target===t&&e.setConfirmDialog(null)};return C(U,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var r=fn(),s=r.firstChild,o=s.firstChild,v=o.firstChild;v.firstChild;var c=o.nextSibling,g=c.nextSibling,m=g.firstChild,d=m.nextSibling;r.$$click=u;var l=t;typeof l=="function"?pe(l,r):t=r,s.$$click=x=>x.stopPropagation(),a(v,()=>e.confirmDialog()?.title||"Confirm Action",null),a(c,()=>e.confirmDialog()?.message||"Are you sure?"),a(s,C(U,{get when(){return Y(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var x=un(),_=x.firstChild,D=_.firstChild,p=D.nextSibling;return p.nextSibling,a(_,()=>e.confirmDialog()?.items?.length||0,p),a(x,()=>e.confirmDialog()?.items?.map(z=>(()=>{var W=hn(),P=W.firstChild,M=P.nextSibling,b=M.nextSibling;return a(M,()=>re(z)),a(b,(()=>{var I=Y(()=>!!z.size);return()=>I()?`${Math.round(z.size/1024)}KB`:""})()),W})()),null),x}}),g),a(s,C(U,{get when(){return Y(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var x=gn(),_=x.firstChild,D=_.nextSibling,p=D.firstChild,z=p.nextSibling;return z.nextSibling,a(D,()=>e.confirmDialog()?.items?.length||0,z),x}}),g),m.$$click=()=>e.setConfirmDialog(null),d.$$click=()=>e.confirmDialog()?.onConfirm?.();var h=i;return typeof h=="function"?pe(h,d):i=d,r})(),pn()]}})}se(["click"]);var Ae=y("<span style=color:#ff00ff;font-size:12px;>●"),bn=y('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;>default</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),xn=y(`<style>
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .header-action-menu-item:hover {
          background: rgba(255, 255, 255, 0.08) !important;
        }

        .header-action-menu-item:active {
          background: rgba(255, 255, 255, 0.12) !important;
        }
      `);function vn(){const e=$e();let t;const i=o=>{t&&!t.contains(o.target)&&(o.preventDefault(),o.stopPropagation(),e.setHeaderActionMenu(null))},n=o=>{o.key==="Escape"&&e.setHeaderActionMenu(null)};xe(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",i,!0),document.addEventListener("keydown",n)):(document.removeEventListener("mousedown",i,!0),document.removeEventListener("keydown",n))}),ge(()=>{document.removeEventListener("mousedown",i,!0),document.removeEventListener("keydown",n)});const u=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},r=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},s=()=>{e.setHeaderActionMenu(null)};return C(U,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var o=bn(),v=o.firstChild,c=v.firstChild;c.firstChild;var g=c.nextSibling,m=g.nextSibling;m.firstChild;var d=t;return typeof d=="function"?pe(d,o):t=o,c.$$click=u,a(c,C(U,{get when(){return e.isFilterPanelOpen()},get children(){return Ae()}}),null),g.$$click=s,m.$$click=r,a(m,C(U,{get when(){return e.isSettingsPanelOpen()},get children(){return Ae()}}),null),T(l=>O(o,`
          position: fixed;
          left: ${e.headerActionMenu()?.position.x||0}px;
          top: ${e.headerActionMenu()?.position.y||0}px;
          transform: translateX(-50%);
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          z-index: 10000;
          min-width: 200px;
          animation: slideIn 0.15s ease-out;
        `,l)),o})(),xn()]}})}se(["click"]);function yn(e){const[t,i]=L(-1),n=l=>{e.onLog&&e.onLog(l)},u=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const l=document.activeElement;return l&&(l.tagName==="INPUT"||l.tagName==="TEXTAREA"||l.isContentEditable||l.getAttribute("contenteditable")==="true")},r=()=>e.getAllItems?e.getAllItems():[],s=()=>e.getSelectedItems?e.getSelectedItems():new Set,o=()=>{const l=r(),h=t();return h>=0&&h<l.length&&l[h]||null},v=()=>{const l=r();if(l.length===0)return;const h=t(),x=h<l.length-1?h+1:0;i(x),n(`⌨️ Focused next item: ${x+1}/${l.length}`)},c=()=>{const l=r();if(l.length===0)return;const h=t(),x=h>0?h-1:l.length-1;i(x),n(`⌨️ Focused previous item: ${x+1}/${l.length}`)},g=()=>{r().length!==0&&(i(0),n("⌨️ Focused first item"))},m=()=>{const l=r();l.length!==0&&(i(l.length-1),n("⌨️ Focused last item"))},d=l=>{if(u())return;const h=r();if(h.length!==0)switch(l.key){case"ArrowDown":{l.preventDefault(),t()===-1?g():v();break}case"ArrowUp":{l.preventDefault(),t()===-1?m():c();break}case"Home":{(l.ctrlKey||l.metaKey)&&(l.preventDefault(),g());break}case"End":{(l.ctrlKey||l.metaKey)&&(l.preventDefault(),m());break}case"PageDown":{l.preventDefault();const x=t(),_=Math.min(x+10,h.length-1);i(_),n(`⌨️ Page down to item: ${_+1}/${h.length}`);break}case"PageUp":{l.preventDefault();const x=t(),_=Math.max(x-10,0);i(_),n(`⌨️ Page up to item: ${_+1}/${h.length}`);break}case"Enter":{l.preventDefault();const x=o();x&&e.onPreview&&(e.onPreview(x),n("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{l.preventDefault();const x=o();x&&e.onToggleSelection&&(e.onToggleSelection(x),n("⌨️ Toggled selection via Space key"));break}case"a":{(l.ctrlKey||l.metaKey)&&(l.preventDefault(),e.onSelectAll&&(e.onSelectAll(h),n("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{l.preventDefault(),e.onEscape&&e.onEscape(),i(-1),n("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const x=s();if(x.size>0){l.preventDefault();const D=r().filter(p=>x.has(p.id));e.onDelete&&(e.onDelete(D),n(`⌨️ Delete requested via ${l.key} key`))}break}case"Tab":{t()===-1&&h.length>0&&i(0);break}case"j":{!l.ctrlKey&&!l.metaKey&&!l.altKey&&(l.preventDefault(),t()===-1?g():v());break}case"k":{!l.ctrlKey&&!l.metaKey&&!l.altKey&&(l.preventDefault(),t()===-1?m():c());break}case"g":{l.shiftKey?(l.preventDefault(),m()):(l.preventDefault(),g());break}}};return xe(()=>{r().length>0&&t()}),xe(()=>{const l=r();t()>=l.length&&l.length>0?i(l.length-1):l.length===0&&i(-1)}),{focusedIndex:t,setFocusedIndex:i,handleKeyDown:d,focusNext:v,focusPrevious:c,focusFirst:g,focusLast:m,getFocusedItem:o}}const $n={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function wn(e="default"){const[t,i]=L(e),n=()=>$n[t()];return{viewMode:t,setViewMode:i,cycleViewMode:()=>{const s=["compact","default","detailed"],v=(s.indexOf(t())+1)%s.length,c=s[v];c&&i(c)},getViewModeConfig:n,getRowHeight:()=>n().rowHeight}}const kn={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Cn(e){const[t,i]=L(window.innerWidth),n=()=>({...kn,...e.columnConfig}),u=()=>{const g=e.baseColumnVisibility(),m=n(),d=t(),l={...g};return Object.entries(m).forEach(([h,x])=>{const _=h;g[_]&&d<x.minWidth&&(l[_]=!1)}),l},r=g=>n()[g]?.priority||0,s=()=>{const g=e.baseColumnVisibility(),m=n(),d=t();return Object.entries(m).filter(([l,h])=>g[l]&&d<h.minWidth).map(([l])=>l).sort((l,h)=>r(l)-r(h))},o=()=>{const g=e.baseColumnVisibility(),m=n();return Math.max(...Object.entries(g).filter(([,d])=>d).map(([d])=>m[d]?.minWidth||0))},v=()=>{const g=t();return g<400?{name:"small mobile",size:"xs"}:g<768?{name:"mobile",size:"sm"}:g<1024?{name:"tablet",size:"md"}:g<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},c=()=>{i(window.innerWidth)};return ce(()=>{window.addEventListener("resize",c)}),ge(()=>{window.removeEventListener("resize",c)}),{screenWidth:t,responsiveColumnVisibility:u,getColumnPriority:r,getHiddenColumns:s,getMinimumWidthForAllColumns:o,getBreakpointInfo:v,setScreenWidth:i}}function _n(e){const t=J(()=>{const o=e.filterConfig(),v=e.sortConfig(),c=e.items().filter(m=>!(o.name&&!re(m).toLowerCase().includes(o.name.toLowerCase())||o.mime&&m.mime!==o.mime||o.blobType&&m.blob_type!==o.blobType||m.size&&(m.size<o.minSize||m.size>o.maxSize)||o.hasParent==="yes"&&!m.parent_blob_id||o.hasParent==="no"&&m.parent_blob_id||o.hasLocalPath==="yes"&&!m.local_path||o.hasLocalPath==="no"&&m.local_path));if(!v.field)return{filtered:c,sorted:c};const g=[...c].sort((m,d)=>{let l=m[v.field],h=d[v.field];l instanceof Date&&h instanceof Date?(l=l.getTime(),h=h.getTime()):typeof l=="string"&&typeof h=="string"?(l=l.toLowerCase(),h=h.toLowerCase()):typeof l=="number"&&typeof h=="number"||(l=String(l||"").toLowerCase(),h=String(h||"").toLowerCase());let x=0;return l<h?x=-1:l>h&&(x=1),v.direction==="desc"?-x:x});return{filtered:c,sorted:g}}),i=J(()=>t().filtered),n=J(()=>t().sorted),u=J(()=>[...new Set(e.items().map(o=>o.mime?.split("/")[0]).filter(Boolean))].sort()),r=J(()=>[...new Set(e.items().map(v=>v.blob_type))].filter(Boolean).sort()),s=J(()=>({totalCount:e.items().length,filteredCount:i().length,hiddenCount:e.items().length-i().length}));return{filteredData:i,sortedData:n,mimeCategories:u,blobTypes:r,stats:s}}var Sn=y("<span style=font-weight:500;>"),ye=y("<span>"),zn=y("<span style=font-family:monospace;font-size:12px;>"),Dn=y("<button title=Controls>⋯"),Mn=y('<span style="position:absolute;top:-2px;right:-2px;background:#ff9900;color:#000;font-size:8px;font-weight:bold;padding:1px 3px;border-radius:50%;line-height:1;min-width:12px;text-align:center;">'),Pn=y("<button>⋯"),In=y("<div>"),En=y(`<div style="height:100vh;background:#000000;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function Tn(e){return C(Ut,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return C(Ln,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function Ln(e){const t=$e(),i=t.loadState(),n=wn(i.viewMode||"default"),u=Cn({baseColumnVisibility:()=>t.columnVisibility()}),r=Ve({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:i.debug??!1,autoConnect:t.autoConnect(),autoRefresh:i.autoRefresh??!0,pageSize:50}),s=_n({items:()=>r.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),o=f=>{const k=new Date().toLocaleTimeString(),S=t.logs();t.setLogs([`${k}: ${f}`,...S.slice(0,49)])},v=yn({onPreview:f=>t.setPopupPreview({item:f,isOpen:!0}),onToggleSelection:f=>d.toggleSelection(f.id),onSelectAll:f=>d.selectAll(f),onClearSelection:()=>d.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):d.clearSelection()},onDelete:f=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${f.length} selected file${f.length!==1?"s":""}?`,items:f,onConfirm:()=>{o(`🗑️ Deleted ${f.length} items via keyboard`),console.log("Deleted via keyboard:",f.map(k=>k.id)),d.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const f=document.activeElement;return f&&(f.tagName==="INPUT"||f.tagName==="TEXTAREA"||f.isContentEditable||f.getAttribute("contenteditable")==="true")},getSelectedItems:()=>d.selectedItems(),getAllItems:()=>s.sortedData(),onLog:o}),c=()=>r.state().connectionStatus,g=()=>r.state().hasPendingUpdates,m=()=>r.state().lastUpdated,d=kt({onSelectionChange:f=>{t.saveState({selectedItems:f})},onDelete:f=>{const k=s.sortedData().filter(S=>f.has(S.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${k.length} selected file${k.length!==1?"s":""}?`,items:k,onConfirm:()=>{o(`🗑️ Deleted ${k.length} selected items`),console.log("Deleted selected items:",Array.from(f)),d.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:f=>{},initialSelection:new Set(i.selectedItems?Array.from(i.selectedItems||[]):[])}),l=(f,k,S)=>{S.shiftKey&&d.lastSelectedIndex()>=0?(S.preventDefault(),d.selectRange(d.lastSelectedIndex(),k,s.sortedData())):d.handleRowClick(f,k,S)},h=f=>{t.setPopupPreview({item:f,isOpen:!0}),o(`🖼️ Opened preview for: ${re(f)}`)},x=(f,k,S)=>{S.preventDefault(),S.stopPropagation();const $={x:S.clientX,y:S.clientY},N=d.selectedItems().size;N>1?(t.setBulkActionMenu({isOpen:!0,position:$}),o(`🖱️ Bulk context menu opened for ${N} items`)):(t.setActionMenu({item:f,isOpen:!0,position:$}),o(`🖱️ Context menu opened for: ${re(f)}`))},_=(f,k)=>{k.stopPropagation(),k.preventDefault();const S=t.actionMenu();if(S&&S.item.id===f.id)t.setActionMenu(null),o(`⋯ Action menu closed for: ${re(f)}`);else{const $=k.target.getBoundingClientRect(),N={x:$.right-120,y:$.bottom+4};t.setActionMenu({item:f,isOpen:!0,position:N}),o(`⋯ Action menu opened for: ${re(f)}`)}},D=f=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const S=f.target.getBoundingClientRect(),$={x:S.left+S.width/2-100,y:S.top-10};t.setBulkActionMenu({isOpen:!0,position:$})}},p=f=>{v.handleKeyDown(f),d.handleKeyDown(f)},z=f=>{if(d.isDragSelecting()&&d.dragStart()){d.setDragEnd({x:f.clientX,y:f.clientY,endIndex:-1});const k=d.dragStart(),S=Math.floor((f.clientY-k.y)/60);if(S!==k.startIndex){const $=Math.min(k.startIndex,k.startIndex+S),N=Math.max(k.startIndex,k.startIndex+S);d.selectRange($,N,s.sortedData())}}};ce(()=>{document.addEventListener("mousemove",z),document.addEventListener("keydown",p)}),ge(()=>{document.removeEventListener("mousemove",z),document.removeEventListener("keydown",p)});const[W,P]=L(new Set),M=f=>{W().has(f)||(P(k=>new Set([...k,f])),r.actions.getThumbnails(f),o(`🖼️ Requesting thumbnails for ${f.slice(0,8)}`))},b=J(()=>s.mimeCategories()),I=J(()=>s.blobTypes()),H=J(()=>{const f=u.responsiveColumnVisibility(),k=[];return f.thumbnail&&k.push({key:"thumbnail",title:"",width:60,render:S=>C(Bt,{item:S,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:M,get requestedThumbnails(){return W()},showIndicators:!0})}),f.name&&k.push({key:"name",title:"Name",sortable:!0,render:S=>(()=>{var $=Sn();return a($,()=>re(S)),T(()=>ae($,"title",re(S))),$})()}),f.blob_type&&k.push({key:"blob_type",title:"Type",width:100,sortable:!0}),f.mime&&k.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:S=>(()=>{var $=ye();return a($,()=>S.mime||"unknown"),$})()}),f.id&&k.push({key:"id",title:"ID",width:200,sortable:!0,render:S=>(()=>{var $=zn();return a($,()=>S.id),$})()}),f.size&&k.push({key:"size",title:"Size",width:100,sortable:!0,render:S=>(()=>{var $=ye();return a($,()=>Fe(S.size||0)),$})()}),f.parent_blob_id&&k.push({key:"parent_blob_id",title:"Parent",width:120,render:S=>(()=>{var $=ye();return a($,()=>S.parent_blob_id?"Yes":"No"),$})()}),f.local_path&&k.push({key:"local_path",title:"Local Path",width:200,render:S=>(()=>{var $=ye();return a($,()=>S.local_path||"None"),$})()}),f.created_at&&k.push({key:"created_at",title:"Created",width:140,sortable:!0,render:S=>(()=>{var $=ye();return a($,()=>new Date(S.created_at).toLocaleString()),$})()}),f.updated_at&&k.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:S=>(()=>{var $=ye();return a($,()=>new Date(S.updated_at).toLocaleString()),$})()}),f.actions&&k.push({key:"actions",title:(()=>{var S=Dn();return S.firstChild,S.$$click=$=>{$.stopPropagation();const N=$.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:N.left+N.width/2,y:N.bottom+5}})},a(S,(()=>{var $=Y(()=>u.getHiddenColumns().length>0);return()=>$()&&(()=>{var N=Mn();return a(N,()=>u.getHiddenColumns().length),T(()=>ae(N,"title",`${u.getHiddenColumns().length} columns hidden on mobile screens`)),N})()})(),null),T($=>O(S,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,$)),S})(),sortable:!1,width:100,className:"sticky-actions-column",render:S=>(()=>{var $=Pn();return $.$$click=N=>_(S,N),$.addEventListener("mouseleave",N=>{N.target.style.background="#3a3a3a"}),$.addEventListener("mouseenter",N=>{N.target.style.background="#4a4a4a"}),T(N=>O($,`
              background: #3a3a3a;
              border: 1px solid #4a4a4a;
              color: #e0e0e0;
              padding: ${n.viewMode()==="compact"?"2px 6px":"4px 8px"};
              border-radius: 4px;
              cursor: pointer;
              font-size: ${n.viewMode()==="compact"?"10px":"12px"};
              transition: all 0.2s;
            `,N)),$})()}),k}),j=(f,k)=>{t.updateFilter(f,k)},w=(f,k)=>{t.handleSort(f,k)},A=f=>{t.toggleColumn(f)},K=()=>{t.toggleBrowsePanel()},B=()=>{t.toggleFilterPanel()},q=()=>{t.toggleSettingsPanel()};return ce(()=>{o("🚀 FreqholeDemo mounted"),o(`🔌 WebSocket URL: ${t.wsUrl()}`),t.autoConnect()&&o("🔌 Auto-connecting to WebSocket...")}),(()=>{var f=En(),k=f.firstChild,S=k.nextSibling;return a(f,C(Ye,{get isOpen(){return t.isBrowsePanelOpen()},get filterConfig(){return t.filterConfig()},onTogglePanel:K,onFilterChange:j,onWidthChange:$=>{t.setBrowsePanelWidth($)},get initialWidth(){return t.browsePanelWidth()}}),k),a(f,C(wt,{get selectedCount(){return d.selectedItems().size},onDownload:()=>{console.log("Bulk download:",d.selectedItems().size,"items")},get onClear(){return d.clearSelection},onMore:D}),k),a(k,C(Lt,{get data(){return s.sortedData()},get columns(){return H()},onSort:w,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return n.getRowHeight()},headerHeight:60,getItemId:$=>$.id,get selectedItems(){return d.selectedItems()},onRowClick:l,onRowDoubleClick:h,get onRowMouseDown(){return d.handleRowMouseDown},onContextMenu:($,N,ne)=>x($,N,ne),get isDragSelecting(){return d.isDragSelecting()},showPaginationStatus:!0,onLoadMore:()=>r.actions.loadMore(),get hasMore(){return r.state().hasMore},get isLoadingMore(){return r.state().isLoadingMore},get focusedIndex(){return v.focusedIndex()},showFocusIndicator:!0})),a(f,C(bt,{get isVisible(){return!t.isBrowsePanelOpen()},position:"left",panelName:"Browse",onClick:K}),S),a(f,C(U,{get when(){return Y(()=>!!(d.isDragSelecting()&&d.dragStart()))()&&d.dragEnd()},get children(){var $=In();return T(N=>O($,(()=>{const ne=d.dragStart(),ie=d.dragEnd(),R=Math.min(ne.x,ie.x),V=Math.min(ne.y,ie.y),Q=Math.abs(ie.x-ne.x),E=Math.abs(ie.y-ne.y);return`
              position: fixed;
              left: ${R}px;
              top: ${V}px;
              width: ${Q}px;
              height: ${E}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `})(),N)),$}}),S),a(f,C(at,{get isOpen(){return t.isFilterPanelOpen()},get filterConfig(){return t.filterConfig()},get columnVisibility(){return t.columnVisibility()},onTogglePanel:B,onFilterChange:j,onColumnToggle:A,onWidthChange:$=>{t.setFilterPanelWidth($)},get initialWidth(){return t.filterPanelWidth()},get mimeCategories(){return b()},get blobTypeCategories(){return I()},get totalCount(){return r.state().items.length},get filteredCount(){return s.filteredData().length},get responsiveColumnVisibility(){return u.responsiveColumnVisibility()},get hiddenColumns(){return u.getHiddenColumns()},get breakpointInfo(){return u.getBreakpointInfo()},get screenWidth(){return u.screenWidth()}}),S),a(f,C(ht,{get isOpen(){return t.isSettingsPanelOpen()},get wsUrl(){return t.wsUrl()},get autoConnect(){return t.autoConnect()},get autoRefresh(){return t.autoRefresh()},get debug(){return t.debug()},get connectionStatus(){return c()},get hasPendingUpdates(){return g()},get pendingUpdatesCount(){return r.state().pendingUpdates.length},get filteredCount(){return s.filteredData().length},get totalCount(){return r.state().items.length},get lastUpdated(){return m()},get logs(){return t.logs()},onTogglePanel:q,get onWsUrlChange(){return t.setWsUrl},onConnect:()=>{r.actions.connect(),o("🔌 Connecting to WebSocket...")},onDisconnect:()=>{r.actions.disconnect(),o("🔌 Disconnecting from WebSocket...")},onRefresh:()=>{o("🔄 Refreshing data..."),r.actions.refresh()},onApplyPendingUpdates:()=>{r.actions.applyPendingUpdates(),o("✅ Applied pending updates")},onToggleAutoConnect:()=>{t.setAutoConnect(!t.autoConnect()),o(`🔧 Auto-connect: ${t.autoConnect()?"ON":"OFF"}`)},onToggleAutoRefresh:()=>{t.setAutoRefresh(!t.autoRefresh()),o(`🔧 Auto-refresh: ${t.autoRefresh()?"ON":"OFF"}`)},onToggleDebug:()=>{t.setDebug(!t.debug()),o(`🐛 Debug: ${t.debug()?"ON":"OFF"}`)},onReset:()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},onWidthChange:$=>{t.setSettingsPanelWidth($)},get initialWidth(){return t.settingsPanelWidth()}}),S),a(f,C(Qt,{}),null),a(f,C(nn,{}),null),a(f,C(rn,{}),null),a(f,C(mn,{}),null),a(f,C(vn,{}),null),a(f,C(cn,{get isDragSelecting(){return d.isDragSelecting()},get dragStart(){return d.dragStart()},get dragEnd(){return d.dragEnd()}}),null),f})()}se(["click"]);class An extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",i=this.getAttribute("api-base-url")||"http://localhost:8080",n=this.getAttribute("auto-connect")==="true";this.dispose=Ue(()=>C(Tn,{wsUrl:t,apiBaseUrl:i,autoConnect:n}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",An),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
