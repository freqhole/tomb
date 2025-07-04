import{d as se,c as I,t as k,a as Oe,b as L,e as me,s as U,o as ge,f as xe,g as ve,h as G,i as S,j as ct,u as ut,k as l,m as Z,F as pe,S as A,l as le,n as $e,p as ft,r as gt}from"./web-WRO-G0Y6.js";import{u as Le}from"./thumbnail-utils-B_hAexIh.js";import{u as pt}from"./useThumbnail-BaQo7hHA.js";import{f as qe}from"./date-utils-CshQIybG.js";import"./websocket-client-CkrDZ6RE.js";import"./types-DDODKsJP.js";function ne(e){if(e.metadata&&typeof e.metadata=="object"){const t=e.metadata;if(t.originalName||t.filename||t.original_filename||t.file_name||t.name)return t.originalName||t.filename||t.original_filename||t.file_name||t.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var ht=k(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function Be(e){const[t,i]=I(!1);return(()=>{var o=ht(),c=o.firstChild,a=c.nextSibling;return o.addEventListener("mouseleave",()=>i(!1)),o.addEventListener("mouseenter",()=>i(!0)),Oe(o,"mousedown",e.onMouseDown,!0),L(b=>{var d=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,s=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,g=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${t()||e.isDragging?"#ff00ff":"#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `,p=`
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
        `;return d!==b.e&&me(o,b.e=d),b.t=U(o,s,b.t),b.a=U(c,g,b.a),b.o=U(a,p,b.o),b},{e:void 0,t:void 0,a:void 0,o:void 0}),o})()}se(["mousedown"]);function We(e){const[t,i]=I(e.initialWidth),[o,c]=I(!1),a=e.minWidth||250,b=e.maxWidth||600,d=e.closeThreshold||100;return{width:t,setWidth:i,isDragging:o,handleMouseDown:(g,p="right")=>{g.preventDefault(),c(!0),document.body.classList.add("resizing");const u=g.clientX,m=t(),n=v=>{const x=v.clientX-u,C=p==="right"?m-x:m+x;if(C<d){e.onClose?.();return}const r=Math.max(a,Math.min(b,C));i(r),e.onWidthChange?.(r)},h=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",n),document.removeEventListener("mouseup",h)};document.addEventListener("mousemove",n),document.addEventListener("mouseup",h)}}}const Je="freqhole-demo-state",Fe=300;function Re(){try{const e=localStorage.getItem(Je);return e?JSON.parse(e):{}}catch{return{}}}function te(e){try{const i={...Re(),...e};localStorage.setItem(Je,JSON.stringify(i))}catch{}}function bt(e){const t=Re(),[i,o]=I({name:"",mime:"",blobType:"",minSize:0,maxSize:0,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[c,a]=I({field:"created_at",direction:"desc",...t.sortConfig||{}}),[b,d]=I(t.viewMode||"default"),[s,g]=I({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[p,u]=I(t.isFilterPanelOpen??!0),[m,n]=I(t.filterPanelWidth||Fe),[h,v]=I(t.isBrowsePanelOpen??!0),[x,C]=I(t.browsePanelWidth||Fe),[r,$]=I(t.isSettingsPanelOpen??!1),[_,f]=I(t.settingsPanelWidth||Fe),[y,w]=I(t.wsUrl||e.wsUrl),[F,N]=I(t.autoConnect??e.autoConnect),[Y,j]=I(t.autoRefresh??!0),[B,ie]=I(t.debug??!1),[O,M]=I(null),[P,E]=I(null),[W,D]=I(null),[T,V]=I(null),[R,K]=I(null),[J,oe]=I([]),[ce,ue]=I("Disconnected"),[he,ye]=I(!1),[be,ee]=I(null);return{filterConfig:i,setFilterConfig:z=>{o(z),te({filterConfig:z})},updateFilter:(z,H)=>{o(fe=>{const Pe={...fe,[z]:H};return te({filterConfig:Pe}),Pe})},sortConfig:c,setSortConfig:z=>{a(z),te({sortConfig:z})},handleSort:(z,H)=>{const fe={field:z,direction:H};a(fe),te({sortConfig:fe})},viewMode:b,setViewMode:z=>{d(z),te({viewMode:z})},columnVisibility:s,setColumnVisibility:z=>{g(z),te({columnVisibility:z})},toggleColumn:z=>{g(H=>{const fe={...H,[z]:!H[z]};return te({columnVisibility:fe}),fe})},isFilterPanelOpen:p,setIsFilterPanelOpen:z=>{u(z),te({isFilterPanelOpen:z})},toggleFilterPanel:()=>{u(z=>{const H=!z;return te({isFilterPanelOpen:H}),H})},filterPanelWidth:m,setFilterPanelWidth:z=>{n(z),te({filterPanelWidth:z})},isBrowsePanelOpen:h,setIsBrowsePanelOpen:z=>{v(z),te({isBrowsePanelOpen:z})},toggleBrowsePanel:()=>{v(z=>{const H=!z;return te({isBrowsePanelOpen:H}),H})},browsePanelWidth:x,setBrowsePanelWidth:z=>{C(z),te({browsePanelWidth:z})},isSettingsPanelOpen:r,setIsSettingsPanelOpen:z=>{$(z),te({isSettingsPanelOpen:z})},toggleSettingsPanel:()=>{$(z=>{const H=!z;return te({isSettingsPanelOpen:H}),H})},settingsPanelWidth:_,setSettingsPanelWidth:z=>{f(z),te({settingsPanelWidth:z})},wsUrl:y,setWsUrl:w,autoConnect:F,setAutoConnect:N,autoRefresh:Y,setAutoRefresh:j,debug:B,setDebug:ie,popupPreview:O,setPopupPreview:M,actionMenu:P,setActionMenu:E,bulkActionMenu:W,setBulkActionMenu:D,confirmDialog:T,setConfirmDialog:V,headerActionMenu:R,setHeaderActionMenu:K,logs:J,setLogs:oe,connectionStatus:ce,setConnectionStatus:ue,hasPendingUpdates:he,setHasPendingUpdates:ye,lastUpdated:be,setLastUpdated:ee,loadState:Re,saveState:te}}function mt(e={}){const[t,i]=I(e.initialSelection||new Set),[o,c]=I(-1),[a,b]=I(!1),[d,s]=I(null),[g,p]=I(null),u=f=>{i(y=>{const w=new Set(y);return w.has(f)?w.delete(f):w.add(f),w})},m=(f,y,w)=>{const F=Math.min(f,y),N=Math.max(f,y),Y=w.slice(F,N+1);i(j=>{const B=new Set(j);return Y.forEach(ie=>B.add(ie.id)),B})},n=()=>{i(new Set),c(-1)},h=f=>{const y=new Set(f.map(w=>w.id));i(y)},v=f=>t().has(f),x=(f,y,w)=>{const F=f.id;if(w.metaKey||w.ctrlKey)w.preventDefault(),u(F),c(y);else if(w.shiftKey&&o()>=0)w.preventDefault(),c(y);else{if(w.detail>1)return;i(new Set([F])),c(y)}},C=(f,y,w)=>{(w.shiftKey||w.ctrlKey||w.metaKey)&&w.preventDefault(),w.button===0&&!w.metaKey&&!w.ctrlKey&&!w.shiftKey&&(w.preventDefault(),s({x:w.clientX,y:w.clientY,startIndex:y}),b(!0))},r=f=>{const y=f.target,w=y&&(y.tagName==="INPUT"||y.tagName==="TEXTAREA"||y.isContentEditable||y.getAttribute("contenteditable")==="true");f.key==="Escape"?n():f.key==="a"&&(f.metaKey||f.ctrlKey)?w||f.preventDefault():(f.key==="Delete"||f.key==="Backspace")&&!w&&t().size>0&&e.onDelete?.(t())},$=f=>{a()&&d()&&p({x:f.clientX,y:f.clientY,endIndex:-1})},_=()=>{a()&&(b(!1),s(null),p(null))};return ge(()=>{document.addEventListener("mousemove",$),document.addEventListener("mouseup",_),document.addEventListener("keydown",r)}),xe(()=>{document.removeEventListener("mousemove",$),document.removeEventListener("mouseup",_),document.removeEventListener("keydown",r),document.body.classList.remove("drag-selecting")}),ve(()=>{a()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),ve(()=>{const f=t();e.onSelectionChange?.(f),e.saveToStorage?.(f)}),{selectedItems:t,setSelectedItems:i,lastSelectedIndex:o,setLastSelectedIndex:c,isDragSelecting:a,setIsDragSelecting:b,dragStart:d,setDragStart:s,dragEnd:g,setDragEnd:p,toggleSelection:u,selectRange:m,clearSelection:n,selectAll:h,isSelected:v,handleRowClick:x,handleRowMouseDown:C,handleKeyDown:r}}function Te(e){const t=G(()=>{const d=e.filterConfig(),s=e.sortConfig(),g=e.items().filter(u=>{if(d.name&&!ne(u).toLowerCase().includes(d.name.toLowerCase()))return!1;if(d.mime){if(!u.mime)return!1;if(!d.mime.includes("/")){if(!u.mime.toLowerCase().startsWith(d.mime.toLowerCase()+"/"))return!1}else if(u.mime!==d.mime)return!1}return!(d.blobType&&u.blob_type!==d.blobType||u.size&&(u.size<d.minSize||d.maxSize>0&&u.size>d.maxSize)||d.hasParent==="yes"&&!u.parent_blob_id||d.hasParent==="no"&&u.parent_blob_id||d.hasLocalPath==="yes"&&!u.local_path||d.hasLocalPath==="no"&&u.local_path)});if(!s.field)return{filtered:g,sorted:g};const p=[...g].sort((u,m)=>{let n,h;if(s.field==="name"?(n=ne(u),h=ne(m)):(n=u[s.field],h=m[s.field]),n==null&&h==null)return 0;if(n==null)return s.direction==="desc"?-1:1;if(h==null)return s.direction==="desc"?1:-1;n instanceof Date&&h instanceof Date?(n=n.getTime(),h=h.getTime()):s.field==="created_at"||s.field==="updated_at"?(n=n?new Date(n).getTime():0,h=h?new Date(h).getTime():0):typeof n=="string"&&typeof h=="string"?(n=n.toLowerCase(),h=h.toLowerCase()):typeof n=="number"&&typeof h=="number"||(n=String(n||"").toLowerCase(),h=String(h||"").toLowerCase());let v=0;return n<h?v=-1:n>h&&(v=1),s.direction==="desc"?-v:v});return{filtered:g,sorted:p}}),i=G(()=>t().filtered),o=G(()=>t().sorted),c=G(()=>[...new Set(e.items().map(d=>d.mime?.split("/")[0]).filter(Boolean))].sort()),a=G(()=>[...new Set(e.items().map(s=>s.blob_type))].filter(Boolean).sort()),b=G(()=>({totalCount:e.items().length,filteredCount:i().length,hiddenCount:e.items().length-i().length}));return{filteredData:i,sortedData:o,mimeCategories:c,blobTypes:a,stats:b}}const Qe=ct(),xt=e=>{const t=bt({wsUrl:e.wsUrl,autoConnect:e.autoConnect}),i=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>i.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),c=s=>{const g=new Date().toLocaleTimeString(),p=t.logs();t.setLogs([`${g}: ${s}`,...p.slice(0,49)]),t.debug()&&console.log(`[FreqholeDemo] ${g}: ${s}`)},a=t.loadState(),b=mt({onSelectionChange:s=>{t.saveState({selectedItems:s})},onDelete:s=>{const g=o.sortedData().filter(p=>s.has(p.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${g.length} selected file${g.length!==1?"s":""}?`,items:g,onConfirm:()=>{c(`🗑️ Deleted ${g.length} selected items`),b.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:s=>{},initialSelection:new Set(a.selectedItems?Array.from(a.selectedItems||[]):[])}),d=G(()=>({state:t,selection:b,addLog:c}));return S(Qe.Provider,{get value(){return d()},get children(){return e.children}})};function we(){const e=ut(Qe);if(!e)throw new Error("useFreqholeAppContext must be used within a FreqholeStateProvider");return e}function ze(){return we().state}function yt(){return we().selection}var vt=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h2 style=margin:0;font-size:18px;color:#ffffff;font-weight:600;>📂 Browse</h2><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),$t=k('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Quick Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function wt(){const e=ze(),t=(o,c)=>{e.updateFilter(o,c)},i=We({initialWidth:e.browsePanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:o=>e.setBrowsePanelWidth(o),onClose:()=>e.toggleBrowsePanel()});return(()=>{var o=vt(),c=o.firstChild,a=c.firstChild,b=a.nextSibling,d=c.nextSibling;return b.$$click=()=>e.toggleBrowsePanel(),l(o,(()=>{var s=Z(()=>!!e.isBrowsePanelOpen());return()=>s()&&(()=>{var g=$t(),p=g.firstChild,u=p.firstChild,m=u.nextSibling;return m.$$input=n=>t("name",n.currentTarget.value),L(()=>m.value=e.filterConfig().name),g})()})(),d),l(o,S(Be,{position:"right",get isDragging(){return i.isDragging()},onMouseDown:s=>i.handleMouseDown(s,"left")}),d),L(s=>{var g=`browse-panel ${e.isBrowsePanelOpen()?"":"collapsed"} ${i.isDragging()?"resizing":""}`,p=`
        width: ${e.isBrowsePanelOpen()?i.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${e.isBrowsePanelOpen()?"flex":"none"};
        flex-direction: column;
        height: 100%;
      `;return g!==s.e&&me(o,s.e=g),s.t=U(o,p,s.t),s},{e:void 0,t:void 0}),o})()}se(["click","input"]);var _t=k('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),kt=k("<div>"),St=k("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),Ct=k('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const zt=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function Dt(e){return(()=>{var t=kt();return l(t,S(pe,{each:zt,children:i=>{const o=i.key,c=e.columnVisibility[o],a=e.hiddenColumns?.includes(i.key),b=e.responsiveColumnVisibility?.[o]??c;return(()=>{var d=St(),s=d.firstChild,g=s.firstChild,p=g.nextSibling;return g.addEventListener("change",()=>e.onColumnToggle(o)),g.checked=c,l(p,()=>i.title),l(s,a&&(()=>{var u=Ct();return L(()=>le(u,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),u})(),null),L(u=>U(p,`
                    font-size: 14px;
                    color: ${b?"#e0e0e0":"#888"};
                    ${!b&&c?"text-decoration: line-through;":""}
                  `,u)),d})()}}),null),l(t,S(A,{get when(){return e.onResetToDefaults},get children(){var i=_t();return Oe(i,"click",e.onResetToDefaults,!0),i}}),null),L(()=>me(t,`column-manager ${e.className||""}`)),t})()}se(["click"]);const Mt={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Ze(e){const[t,i]=I(window.innerWidth),o=()=>({...Mt,...e.columnConfig}),c=()=>{const p=e.baseColumnVisibility(),u=o(),m=t(),n={...p};return Object.entries(u).forEach(([h,v])=>{const x=h;p[x]&&m<v.minWidth&&(n[x]=!1)}),n},a=p=>o()[p]?.priority||0,b=()=>{const p=e.baseColumnVisibility(),u=o(),m=t();return Object.entries(u).filter(([n,h])=>p[n]&&m<h.minWidth).map(([n])=>n).sort((n,h)=>a(n)-a(h))},d=()=>{const p=e.baseColumnVisibility(),u=o();return Math.max(...Object.entries(p).filter(([,m])=>m).map(([m])=>u[m]?.minWidth||0))},s=()=>{const p=t();return p<400?{name:"small mobile",size:"xs"}:p<768?{name:"mobile",size:"sm"}:p<1024?{name:"tablet",size:"md"}:p<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},g=()=>{i(window.innerWidth)};return ge(()=>{window.addEventListener("resize",g)}),xe(()=>{window.removeEventListener("resize",g)}),{screenWidth:t,responsiveColumnVisibility:c,getColumnPriority:a,getHiddenColumns:b,getMinimumWidthForAllColumns:d,getBreakpointInfo:s,setScreenWidth:i}}var Pt=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h2 style=margin:0;font-size:18px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h2><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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

        /* Quick filter buttons hover effects */
        .filter-section button:hover {
          background: #444 !important;
          border-color: #666 !important;
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
      `),It=k('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>bytes</span></div></div><div class=filter-section style=margin-bottom:24px;><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">Quick Size Filters</h4><div style=display:flex;flex-wrap:wrap;gap:6px;><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&lt; 1MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">1-10MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&gt; 10MB</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">👁️ Column Visibility</h3><button class=toggle-button style="width:100%;padding:8px 12px;background:#333333;border:1px solid #555555;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"><span>Manage Columns</span><span style=transform:rotate(90deg);font-size:12px;></span></button></div><div class=filter-section style=margin-bottom:24px;><button style="width:100%;padding:12px;background:#444444;border:1px solid #666666;border-radius:6px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;"><span>Reset All Filters</span></button></div><div class=filter-section style="margin-bottom:24px;padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">📊 Results</h4><p style=margin:0;font-size:14px;color:#ffffff;>Showing <span style=color:#00ff00;font-weight:600;></span> of <span style=color:#888;></span> total files'),Ke=k("<option>"),Et=k("<div style=margin-top:12px;>"),Lt=k("<span style=color:#ff9900;> files filtered out");function Tt(){const e=ze(),[t,i]=I(!1),o=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),c=Te({items:()=>o.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),a=Ze({baseColumnVisibility:()=>e.columnVisibility()}),b=G(()=>c.mimeCategories()),d=G(()=>c.blobTypes()),s=(u,m)=>{e.updateFilter(u,m)},g=u=>{e.toggleColumn(u)},p=We({initialWidth:e.filterPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:u=>e.setFilterPanelWidth(u),onClose:()=>e.toggleFilterPanel()});return(()=>{var u=Pt(),m=u.firstChild,n=m.firstChild,h=n.nextSibling,v=m.nextSibling;return h.$$click=()=>e.toggleFilterPanel(),l(u,(()=>{var x=Z(()=>!!e.isFilterPanelOpen());return()=>x()&&(()=>{var C=It(),r=C.firstChild,$=r.firstChild,_=$.firstChild,f=_.nextSibling,y=$.nextSibling,w=y.firstChild,F=w.nextSibling;F.firstChild;var N=y.nextSibling,Y=N.firstChild,j=Y.nextSibling;j.firstChild;var B=N.nextSibling,ie=B.firstChild,O=ie.nextSibling,M=O.firstChild,P=M.nextSibling,E=P.nextSibling,W=B.nextSibling,D=W.firstChild,T=D.nextSibling,V=T.firstChild,R=V.nextSibling,K=R.nextSibling,J=W.nextSibling,oe=J.firstChild,ce=oe.nextSibling,ue=ce.firstChild,he=ue.nextSibling,ye=J.nextSibling,be=ye.firstChild,ee=ye.nextSibling,ae=ee.firstChild,re=ae.nextSibling,de=re.firstChild,X=de.nextSibling,_e=X.nextSibling,ke=_e.nextSibling;return ke.nextSibling,f.$$input=z=>s("name",z.currentTarget.value),F.addEventListener("change",z=>s("mime",z.currentTarget.value)),l(F,S(pe,{get each(){return b()},children:z=>(()=>{var H=Ke();return H.value=z,l(H,z),H})()}),null),j.addEventListener("change",z=>s("blobType",z.currentTarget.value)),l(j,S(pe,{get each(){return d()},children:z=>(()=>{var H=Ke();return H.value=z,l(H,z),H})()}),null),M.$$input=z=>s("minSize",parseInt(z.currentTarget.value)||0),E.$$input=z=>s("maxSize",parseInt(z.currentTarget.value)||0),V.$$click=()=>{s("minSize",0),s("maxSize",1024*1024)},R.$$click=()=>{s("minSize",1024*1024),s("maxSize",10*1024*1024)},K.$$click=()=>{s("minSize",10*1024*1024),s("maxSize",0)},ce.$$click=()=>i(!t()),l(he,()=>t()?"▼":"▶"),l(J,(()=>{var z=Z(()=>!!t());return()=>z()&&(()=>{var H=Et();return l(H,S(Dt,{get columnVisibility(){return e.columnVisibility()},onColumnToggle:g,get responsiveColumnVisibility(){return a.responsiveColumnVisibility()},get hiddenColumns(){return a.getHiddenColumns()},get breakpointInfo(){return a.getBreakpointInfo()}})),H})()})(),null),be.addEventListener("mouseleave",z=>{z.target.style.background="#444444",z.target.style.borderColor="#666666"}),be.addEventListener("mouseenter",z=>{z.target.style.background="#555555",z.target.style.borderColor="#777777"}),be.$$click=()=>{s("name",""),s("mime",""),s("blobType",""),s("minSize",0),s("maxSize",0),s("hasParent","all"),s("hasLocalPath","all")},l(X,()=>c.filteredData().length),l(ke,()=>o.state().items.length),l(re,(()=>{var z=Z(()=>c.filteredData().length<o.state().items.length);return()=>z()&&(()=>{var H=Lt(),fe=H.firstChild;return l(H,()=>o.state().items.length-c.filteredData().length,fe),H})()})(),null),L(()=>f.value=e.filterConfig().name),L(()=>F.value=e.filterConfig().mime),L(()=>j.value=e.filterConfig().blobType),L(()=>M.value=e.filterConfig().minSize||""),L(()=>E.value=e.filterConfig().maxSize||""),C})()})(),v),l(u,S(Be,{position:"right",get isDragging(){return p.isDragging()},onMouseDown:x=>p.handleMouseDown(x,"left")}),v),L(x=>{var C=`filter-panel ${e.isFilterPanelOpen()?"":"collapsed"} ${p.isDragging()?"resizing":""}`,r=`
        width: ${e.isFilterPanelOpen()?p.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${e.isFilterPanelOpen()?"flex":"none"};
        flex-direction: column;
        height: 100%;
      `;return C!==x.e&&me(u,x.e=C),x.t=U(u,r,x.t),x},{e:void 0,t:void 0}),u})()}se(["click","input"]);var At=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings & Debug</h3><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
        .settings-panel input:focus {
          outline: none;
          border-color: #ff00ff !important;
        }

        .settings-panel button:hover:not(:disabled) {
          filter: brightness(1.1) !important;
        }

        .settings-panel button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .settings-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        /* Custom scrollbar for activity log */
        .settings-section div::-webkit-scrollbar {
          width: 6px;
        }

        .settings-section div::-webkit-scrollbar-track {
          background: #1a1a1a;
        }

        .settings-section div::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }

        .settings-section div::-webkit-scrollbar-thumb:hover {
          background: #555;
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
      `),Ft=k("<div style=font-size:11px;color:#666;>Last update: "),Rt=k('<div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">⏳ Pending Updates</h3><div style="padding:12px;background:#2a1a00;border:1px solid #5a3400;border-radius:4px;margin-bottom:12px;"><p style="margin:0 0 8px 0;font-size:14px;color:#ffaa00;"> updates waiting</p><p style=margin:0;font-size:12px;color:#cc8800;>Click below to apply pending changes</p></div><button style="width:100%;padding:10px;background:#aa6600;border:1px solid #cc8800;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">✅ Apply Updates (<!>)'),Ot=k("<div style=color:#666;font-style:italic;>No activity yet..."),Bt=k('<button style="width:100%;padding:6px;background:#333;border:1px solid #555;border-radius:4px;color:#888;font-size:12px;cursor:pointer;margin-top:8px;transition:all 0.2s;">Clear Log'),Wt=k('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔌 WebSocket Connection</h3><div style="margin-bottom:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;><span style=font-size:12px;color:#888;>Status:</span><span></span></div></div><input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:12px;box-sizing:border-box;"><div style=display:flex;gap:8px;margin-bottom:12px;><button>Connect</button><button>Disconnect</button></div><button style="width:100%;padding:8px;background:#0066cc;border:1px solid #0088ff;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;">🔄 Refresh Data</button></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🤖 Automatic Settings</h3><div style=display:flex;flex-direction:column;gap:8px;><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-connect on load</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-refresh data</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Enable debug mode</span></label></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📊 Data Statistics</h3><div style="padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;"><div><div style=color:#888;font-size:12px;>Total Files</div><div style=color:#ffffff;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Filtered</div><div style=color:#00ff00;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Hidden</div><div style=color:#ff9900;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Memory</div><div style=color:#888;font-weight:600;font-size:12px;>~<!>KB</div></div></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📜 Activity Log</h3><div style="max-height:200px;overflow-y:auto;background:#0a0a0a;border:1px solid #333;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;line-height:1.3;"></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ff4444;">⚠️ Danger Zone</h3><div style="padding:12px;background:#2a0000;border:1px solid #5a0000;border-radius:4px;margin-bottom:12px;"><p style=margin:0;font-size:12px;color:#ff8888;>This will clear all settings, filters, and cached data. The page will reload.</p></div><button style="width:100%;padding:10px;background:#aa0000;border:1px solid #dd0000;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Reset All Data'),Ut=k("<div style=color:#ccc;margin-bottom:2px;word-break:break-all;>");function Nt(){const{state:e,addLog:t}=we(),i=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>i.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),c=()=>i.state().connectionStatus,a=()=>i.state().hasPendingUpdates,b=()=>i.state().lastUpdated,d=()=>{i.actions.connect(),t("🔌 Connecting to WebSocket...")},s=()=>{i.actions.disconnect(),t("🔌 Disconnecting from WebSocket...")},g=()=>{t("🔄 Refreshing data..."),i.actions.refresh()},p=()=>{i.actions.applyPendingUpdates(),t("✅ Applied pending updates")},u=()=>{e.setAutoConnect(!e.autoConnect()),t(`🔧 Auto-connect: ${e.autoConnect()?"ON":"OFF"}`)},m=()=>{e.setAutoRefresh(!e.autoRefresh()),t(`🔧 Auto-refresh: ${e.autoRefresh()?"ON":"OFF"}`)},n=()=>{e.setDebug(!e.debug()),t(`🐛 Debug: ${e.debug()?"ON":"OFF"}`)},h=()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},v=We({initialWidth:e.settingsPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:x=>e.setSettingsPanelWidth(x),onClose:()=>e.toggleSettingsPanel()});return(()=>{var x=At(),C=x.firstChild,r=C.firstChild,$=r.nextSibling,_=C.nextSibling;return $.$$click=()=>e.toggleSettingsPanel(),l(x,(()=>{var f=Z(()=>!!e.isSettingsPanelOpen());return()=>f()&&(()=>{var y=Wt(),w=y.firstChild,F=w.firstChild,N=F.nextSibling,Y=N.firstChild,j=Y.firstChild,B=j.nextSibling,ie=N.nextSibling,O=ie.nextSibling,M=O.firstChild,P=M.nextSibling,E=O.nextSibling,W=w.nextSibling,D=W.firstChild,T=D.nextSibling,V=T.firstChild,R=V.firstChild,K=V.nextSibling,J=K.firstChild,oe=K.nextSibling,ce=oe.firstChild,ue=W.nextSibling,he=ue.firstChild,ye=he.nextSibling,be=ye.firstChild,ee=be.firstChild,ae=ee.firstChild,re=ae.nextSibling,de=ee.nextSibling,X=de.firstChild,_e=X.nextSibling,ke=de.nextSibling,z=ke.firstChild,H=z.nextSibling,fe=ke.nextSibling,Pe=fe.firstChild,Ue=Pe.nextSibling,it=Ue.firstChild,Ne=it.nextSibling;Ne.nextSibling;var Ae=ue.nextSibling,ot=Ae.firstChild,He=ot.nextSibling,rt=Ae.nextSibling,lt=rt.firstChild,st=lt.nextSibling,at=st.nextSibling;return l(B,()=>c().toUpperCase()),l(N,S(A,{get when(){return b()},get children(){var q=Ft();return q.firstChild,l(q,()=>b()?.toLocaleTimeString(),null),q}}),null),ie.$$input=q=>e.setWsUrl(q.currentTarget.value),M.$$click=d,P.$$click=s,E.$$click=g,R.addEventListener("change",u),J.addEventListener("change",m),ce.addEventListener("change",n),l(y,S(A,{get when(){return a()},get children(){var q=Rt(),Se=q.firstChild,De=Se.nextSibling,Ie=De.firstChild,Ee=Ie.firstChild,Me=De.nextSibling,dt=Me.firstChild,Ve=dt.nextSibling;return Ve.nextSibling,l(Ie,()=>i.state().pendingUpdates.length,Ee),Me.$$click=p,l(Me,()=>i.state().pendingUpdates.length,Ve),q}}),ue),l(re,()=>i.state().items.length),l(_e,()=>o.filteredData().length),l(H,()=>i.state().items.length-o.filteredData().length),l(Ue,()=>Math.round(i.state().items.length*.5),Ne),l(He,S(A,{get when(){return e.logs().length===0},get children(){return Ot()}}),null),l(He,S(pe,{get each(){return e.logs()},children:q=>(()=>{var Se=Ut();return l(Se,q),Se})()}),null),l(Ae,S(A,{get when(){return e.logs().length>0},get children(){var q=Bt();return q.$$click=()=>e.setLogs([]),q}}),null),at.$$click=h,L(q=>{var Se=`
                  font-size: 12px;
                  font-weight: 600;
                  color: ${c()==="connected"?"#00ff00":c()==="connecting"?"#ffaa00":"#ff4444"};
                `,De=c()==="connected",Ie=`
                  flex: 1;
                  padding: 8px;
                  background: ${c()==="connected"?"#333":"#00aa00"};
                  border: 1px solid ${c()==="connected"?"#555":"#00dd00"};
                  border-radius: 4px;
                  color: ${c()==="connected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${c()==="connected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `,Ee=c()==="disconnected",Me=`
                  flex: 1;
                  padding: 8px;
                  background: ${c()==="disconnected"?"#333":"#aa0000"};
                  border: 1px solid ${c()==="disconnected"?"#555":"#dd0000"};
                  border-radius: 4px;
                  color: ${c()==="disconnected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${c()==="disconnected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `;return q.e=U(B,Se,q.e),De!==q.t&&(M.disabled=q.t=De),q.a=U(M,Ie,q.a),Ee!==q.o&&(P.disabled=q.o=Ee),q.i=U(P,Me,q.i),q},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),L(()=>ie.value=e.wsUrl()),L(()=>R.checked=e.autoConnect()),L(()=>J.checked=e.autoRefresh()),L(()=>ce.checked=e.debug()),y})()})(),_),l(x,S(Be,{position:"left",get isDragging(){return v.isDragging()},onMouseDown:f=>v.handleMouseDown(f,"right")}),_),L(f=>{var y=`settings-panel ${e.isSettingsPanelOpen()?"":"collapsed"} ${v.isDragging()?"resizing":""}`,w=`
        width: ${e.isSettingsPanelOpen()?v.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${e.isSettingsPanelOpen()?"flex":"none"};
        flex-direction: column;
        height: 100%;
        order: 3;
      `;return y!==f.e&&me(x,f.e=y),f.t=U(x,w,f.t),f},{e:void 0,t:void 0}),x})()}se(["click","input"]);var Ht=k(`<div class="edge-toggle-button edge-toggle-left"title="Show Browse panel"style="position:fixed;top:50%;left:0;transform:translateY(-50%);width:24px;height:80px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:0 8px 8px 0;cursor:pointer;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.2s ease;color:#888;font-size:12px;font-weight:500;user-select:none;box-shadow:0 2px 8px rgba(0, 0, 0, 0.3);overflow:hidden;"><div class=arrow-container>→</div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;>Browse</div><style>
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
        `);function Vt(){const e=ze(),[t,i]=I(!1),o=()=>!e.isBrowsePanelOpen(),c=()=>e.toggleBrowsePanel();return S(A,{get when(){return o()},get children(){var a=Ht(),b=a.firstChild;return b.nextSibling,a.addEventListener("mouseleave",()=>i(!1)),a.addEventListener("mouseenter",()=>i(!0)),a.$$click=c,L(d=>U(b,`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `,d)),a}})}se(["click"]);var qt=k(`<div class=selection-toolbar style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;animation:slideUp 0.3s ease-out;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><button class="toolbar-button primary"title="Download selected files"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download</button><button class="toolbar-button secondary"title="More actions"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More</button><button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×</button><style>
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateX(-50%) translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          }

          .toolbar-button:hover {
            transform: translateY(-1px);
          }

          .toolbar-button.primary:hover {
            background: #ff33ff !important;
            color: #000000 !important;
            box-shadow: 0 2px 8px rgba(255, 0, 255, 0.3);
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

          .selection-toolbar:hover {
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
          }
        `);function Kt(){const{selection:e,state:t,addLog:i}=we(),o=()=>{const d=e.selectedItems().size;i(`📥 Downloading ${d} selected items`)},c=d=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const g=d.target.getBoundingClientRect(),p={x:g.left+g.width/2-100,y:g.top-10};t.setBulkActionMenu({isOpen:!0,position:p});const u=e.selectedItems().size;i(`⋯ Bulk action menu opened for ${u} items`)}},a=()=>{const d=e.selectedItems().size;e.clearSelection(),i(`🗑️ Cleared selection of ${d} items`)},b=()=>e.selectedItems().size;return S(A,{get when(){return b()>1},get children(){var d=qt(),s=d.firstChild,g=s.firstChild,p=g.nextSibling;p.nextSibling;var u=s.nextSibling,m=u.nextSibling,n=m.nextSibling;return l(s,b,g),l(s,()=>b()===1?"":"s",p),u.$$click=o,m.$$click=c,n.$$click=a,d}})}se(["click"]);const Q={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},jt=(e,t,i)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const o=e[i],c=t[i];if(o==null&&c==null)return 0;if(o==null)return 1;if(c==null)return-1;if(i==="name"){const g=ne(e),p=ne(t);return g.localeCompare(p,void 0,{numeric:!0,sensitivity:"base"})}if(i.includes("_at")||i.includes("date")||i.includes("time")){const g=new Date(o),p=new Date(c);if(!isNaN(g.getTime())&&!isNaN(p.getTime()))return g.getTime()-p.getTime()}const a=Number(o),b=Number(c);if(!isNaN(a)&&!isNaN(b)&&typeof o=="number"&&typeof c=="number")return a-b;if(i==="size"&&typeof o=="string"&&typeof c=="string"){const g=je(o),p=je(c);if(g!==null&&p!==null)return g-p}const d=String(o).toLowerCase(),s=String(c).toLowerCase();return i==="name"||i.includes("filename")?d.localeCompare(s,void 0,{numeric:!0,sensitivity:"base"}):d.localeCompare(s)},je=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const i=parseFloat(t[1]),o=(t[2]||"B").toUpperCase(),c={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return i*(c[o]||1)};function Yt(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[i,o]=I(e.initialSort||t),[c,a]=I(new Set),[b,d]=I(!1),[s,g]=I(!1),p=e.getItemId||(r=>r.id||String(r)),u=G(()=>{const r=i(),$=[...e.data];return $.length>1e3&&(g(!0),setTimeout(()=>g(!1),100)),$.sort((_,f)=>{const y=jt(_,f,r.field);return r.direction==="desc"?y*-1:y})});return{sortConfig:i,selectedItems:c,isDragSelecting:b,isSorting:s,sortedData:u,handleSort:r=>{const $=i();if($.field===r){const _=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc",f=_==="desc"?"asc":"desc";$.direction===_?o({field:r,direction:f}):$.direction===f?o(t):o({field:r,direction:_})}else{const _=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc";o({field:r,direction:_})}},toggleSelection:r=>{const $=new Set(c());$.has(r)?$.delete(r):$.add(r),a($)},clearSelection:()=>{a(new Set)},selectAll:()=>{const r=new Set(e.data.map(p));a(r)},isSelected:r=>c().has(r),selectRange:(r,$)=>{const _=new Set(c()),f=Math.min(r,$),y=Math.max(r,$);for(let w=f;w<=y;w++)if(w<e.data.length&&e.data[w]!=null){const F=p(e.data[w]);_.add(F)}a(_)},setIsDragSelecting:d,getItemId:p}}var et=k("<div>"),Xt=k("<div class=grid-cell>"),Ye=k("<div class=grid-content>"),Gt=k("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Jt=k("<div class=grid-stats>Showing rows <!>-<!> of "),Qt=k("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),Zt=k('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),en=k('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),tn=k("<div><div style=font-weight:500;flex:1;>"),nn=k("<span>");function Xe(e){let t;ge(()=>{e.onRowMount&&e.onRowMount(e.item)});const i=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var o=et();o.$$contextmenu=a=>e.onContextMenu?.(e.item,e.index,a),o.$$mousedown=a=>e.onRowMouseDown?.(e.item,e.index,a),o.$$dblclick=a=>e.onRowDoubleClick?.(e.item,e.index,a),o.$$click=a=>e.onRowClick?.(e.item,e.index,a);var c=t;return typeof c=="function"?$e(c,o):t=o,l(o,S(pe,{get each(){return e.columns},children:a=>(()=>{var b=Xt();return l(b,(()=>{var d=Z(()=>!!a.render);return()=>d()?a.render(e.item,e.index):String(e.item[a.key]||"")})()),L(d=>U(b,`
              flex: ${a.width?"0 0 "+a.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${a.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${a.className==="sticky-actions-column"?"0":"auto"};
              background: ${a.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":Q.colors.background:"transparent"};
              ${a.className==="sticky-actions-column"?"border-left: 1px solid "+Q.colors.border+";":""}
              box-shadow: ${a.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${a.className==="sticky-actions-column"?"5":"1"};
            `,d)),b})()})),L(a=>{var b=`grid-row ${e.isSelected?"selected":""} ${i()?"focused":""}`,d=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${Q.colors.border};
        background: ${e.isSelected?Q.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${i()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return b!==a.e&&me(o,a.e=b),a.t=U(o,d,a.t),a},{e:void 0,t:void 0}),o})()}function on(e){const[t,i]=I(),[o,c]=I(0),[a,b]=I(0),d=e.rowHeight||50,s=e.headerHeight||60,g=e.virtualizeThreshold||100,[p,u]=I(!1),[m,n]=I(null),[,h]=I(null),v=G(()=>e.columns.reduce((M,P)=>M+(P.width||200),0)),x=Yt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),C=(M,P,E)=>{e.onRowClick?.(M,P,E)},r=(M,P,E)=>{p()&&(u(!1),n(null),h(null)),e.onRowDoubleClick?.(M,P,E)},$=(M,P,E)=>{E.button===0&&!E.metaKey&&!E.ctrlKey&&!E.shiftKey&&(E.preventDefault(),n({x:E.clientX,y:E.clientY,startIndex:P})),e.onRowMouseDown?.(M,P,E)},_=G(()=>e.data.length>g),f=G(()=>{if(!_())return e.data.map((R,K)=>({item:R,index:K}));if(!t())return[];const P=d,E=o(),W=a(),D=Math.floor(E/P),T=Math.min(e.data.length-1,Math.ceil((E+W)/P)+5),V=[];for(let R=Math.max(0,D-5);R<=T;R++)R<e.data.length&&e.data[R]!=null&&V.push({item:e.data[R],index:R});return V}),y=G(()=>e.data.length===0?0:t()?Math.floor(o()/d)+1:1),w=G(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const P=a()-s,E=Math.floor(P/d),W=Math.floor(o()/d)+E;return Math.min(W,e.data.length)}),F=G(()=>e.data.length),N=G(()=>e.data.length*d),Y=(M,P)=>{const E=t();if(!E)return-1;const W=E.getBoundingClientRect(),T=P-W.top+E.scrollTop-s;if(T<0)return-1;const V=Math.floor(T/d);return Math.max(0,Math.min(e.data.length-1,V))},j=M=>{const P=document.body.style.overflow==="hidden",E=document.body.classList.contains("modal-open");if(P||E){(p()||m())&&(u(!1),n(null),h(null));return}const W=m();if(W&&!p()&&Math.sqrt(Math.pow(M.clientX-W.x,2)+Math.pow(M.clientY-W.y,2))>5&&u(!0),p()&&W){const D=Y(M.clientX,M.clientY);if(h({x:M.clientX,y:M.clientY,endIndex:D}),D>=0&&e.getItemId&&e.onDragSelection){const T=Math.min(W.startIndex,D),V=Math.max(W.startIndex,D),R=e.data.slice(T,V+1),K=new Set(R.map(J=>e.getItemId(J)));e.onDragSelection(K)}}},B=()=>{p()?(u(!1),n(null),h(null)):n(null)},ie=M=>{const P=M.target;if(c(P.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const E=P.scrollHeight,W=P.scrollTop,D=P.clientHeight;E-W-D<200&&e.onLoadMore()}},O=M=>{if(x.handleSort(M),e.onSort){const P=x.sortConfig();e.onSort(P.field,P.direction)}};return ge(()=>{document.addEventListener("mousemove",j),document.addEventListener("mouseup",B),xe(()=>{document.removeEventListener("mousemove",j),document.removeEventListener("mouseup",B)})}),ge(()=>{const M=t();if(!M)return;const P=new ResizeObserver(E=>{for(const W of E)b(W.contentRect.height)});P.observe(M),xe(()=>{P.disconnect()})}),(()=>{var M=Qt(),P=M.firstChild,E=P.firstChild,W=P.nextSibling;return P.addEventListener("scroll",ie),$e(i,P),l(E,S(pe,{get each(){return e.columns},children:D=>(()=>{var T=tn(),V=T.firstChild;return T.$$click=()=>D.sortable&&!x.isSorting()&&O(D.key),l(V,(()=>{var R=Z(()=>typeof D.title=="string");return()=>R()?(()=>{var K=nn();return l(K,()=>D.title),K})():D.title})()),l(T,S(A,{get when(){return Z(()=>!!x.isSorting())()&&x.sortConfig().field===D.key},get children(){return Zt()}}),null),l(T,S(A,{get when(){return D.sortable},get children(){var R=en(),K=R.firstChild,J=K.nextSibling;return L(oe=>{var ce=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${x.sortConfig().field===D.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,ue=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${x.sortConfig().field===D.key&&x.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,he=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${x.sortConfig().field===D.key&&x.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return oe.e=U(R,ce,oe.e),oe.t=U(K,ue,oe.t),oe.a=U(J,he,oe.a),oe},{e:void 0,t:void 0,a:void 0}),R}}),null),L(R=>{var K=`grid-header-cell ${D.sortable?"sortable":""} ${D.sortable&&x.sortConfig().field===D.key?"active-sort":""}`,J=`
                  flex: ${D.width?"0 0 "+D.width+"px":"1"};
                  padding: 8px 12px;
                  cursor: ${D.sortable?"pointer":"default"};
                  user-select: none;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  transition: all 0.15s ease;
                  border-radius: 4px;
                  margin: 4px 2px;
                  position: ${D.className==="sticky-actions-column"?"sticky":"relative"};
                  right: ${D.className==="sticky-actions-column"?"0":"auto"};
                  background: ${D.className==="sticky-actions-column"?Q.colors.header:"transparent"};
                  ${D.className==="sticky-actions-column"?"border-left: 1px solid "+Q.colors.border+";":""}
                  box-shadow: ${D.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.2)":"none"};
                  z-index: ${D.className==="sticky-actions-column"?"5":"1"};
                  opacity: ${x.isSorting()&&x.sortConfig().field===D.key?"0.7":"1"};
                `;return K!==R.e&&me(T,R.e=K),R.t=U(T,J,R.t),R},{e:void 0,t:void 0}),T})()})),l(P,S(A,{get when(){return _()},get fallback(){return(()=>{var D=Ye();return l(D,S(pe,{get each(){return e.data},children:(T,V)=>S(Xe,{item:T,get index(){return V()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(T)||T.id)||!1},onRowClick:C,onRowDoubleClick:r,onRowMouseDown:$,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:d,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),L(T=>U(D,`min-width: ${v()}px;`,T)),D})()},get children(){var D=Ye();return l(D,S(pe,{get each(){return f()},children:T=>(()=>{var V=et();return l(V,S(Xe,{get item(){return T.item},get index(){return T.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(T.item)||T.item.id)||!1},onRowClick:C,onRowDoubleClick:r,onRowMouseDown:$,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:d,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),L(R=>U(V,`
                    position: absolute;
                    top: ${T.index*d}px;
                    left: 0;
                    right: 0;
                  `,R)),V})()})),L(T=>U(D,`height: ${N()}px; position: relative; min-width: ${v()}px;`,T)),D}}),null),l(M,S(A,{get when(){return e.showPaginationStatus!==!1},get children(){var D=Jt(),T=D.firstChild,V=T.nextSibling,R=V.nextSibling,K=R.nextSibling;return K.nextSibling,l(D,y,V),l(D,w,K),l(D,F,null),l(D,S(A,{get when(){return e.isLoadingMore},get children(){return Gt()}}),null),L(J=>U(D,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${Q.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,J)),D}}),W),l(W,()=>`
        .grid-row:hover:not(.selected) {
          background: ${Q.colors.hover};
        }

        .grid-row.selected {
          background: ${Q.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${Q.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${Q.colors.selected};
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
          background: ${Q.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${Q.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${Q.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }

        .infinite-data-grid.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        .infinite-data-grid.drag-selecting * {
          user-select: none;
        }

        .grid-stats {
          transition: opacity 0.2s ease;
        }

        .grid-stats:hover {
          opacity: 0.7;
        }
      `),L(D=>{var T=`infinite-data-grid ${e.className||""} ${p()?"drag-selecting":""}`,V=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${Q.colors.background};
        color: ${Q.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,R=`
            height: ${s}px;
            display: flex;
            align-items: center;
            background: ${Q.colors.header};
            border-bottom: 2px solid ${Q.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${v()}px;
          `;return T!==D.e&&me(M,D.e=T),D.t=U(M,V,D.t),D.a=U(E,R,D.a),D},{e:void 0,t:void 0,a:void 0}),M})()}se(["click","dblclick","mousedown","contextmenu"]);const rn={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function ln(e="default"){const[t,i]=I(e),o=()=>rn[t()];return{viewMode:t,setViewMode:i,cycleViewMode:()=>{const b=["compact","default","detailed"],s=(b.indexOf(t())+1)%b.length,g=b[s];g&&i(g)},getViewModeConfig:o,getRowHeight:()=>o().rowHeight}}function sn(e){const[t,i]=I(-1),o=n=>{e.onLog&&e.onLog(n)},c=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const n=document.activeElement;return n&&(n.tagName==="INPUT"||n.tagName==="TEXTAREA"||n.isContentEditable||n.getAttribute("contenteditable")==="true")},a=()=>e.getAllItems?e.getAllItems():[],b=()=>e.getSelectedItems?e.getSelectedItems():new Set,d=()=>{const n=a(),h=t();return h>=0&&h<n.length&&n[h]||null},s=()=>{const n=a();if(n.length===0)return;const h=t(),v=h<n.length-1?h+1:0;i(v),o(`⌨️ Focused next item: ${v+1}/${n.length}`)},g=()=>{const n=a();if(n.length===0)return;const h=t(),v=h>0?h-1:n.length-1;i(v),o(`⌨️ Focused previous item: ${v+1}/${n.length}`)},p=()=>{a().length!==0&&(i(0),o("⌨️ Focused first item"))},u=()=>{const n=a();n.length!==0&&(i(n.length-1),o("⌨️ Focused last item"))},m=n=>{if(c())return;const h=a();if(h.length!==0)switch(n.key){case"ArrowDown":{n.preventDefault(),t()===-1?p():s();break}case"ArrowUp":{n.preventDefault(),t()===-1?u():g();break}case"Home":{(n.ctrlKey||n.metaKey)&&(n.preventDefault(),p());break}case"End":{(n.ctrlKey||n.metaKey)&&(n.preventDefault(),u());break}case"PageDown":{n.preventDefault();const v=t(),x=Math.min(v+10,h.length-1);i(x),o(`⌨️ Page down to item: ${x+1}/${h.length}`);break}case"PageUp":{n.preventDefault();const v=t(),x=Math.max(v-10,0);i(x),o(`⌨️ Page up to item: ${x+1}/${h.length}`);break}case"Enter":{n.preventDefault();const v=d();v&&e.onPreview&&(e.onPreview(v),o("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{n.preventDefault();const v=d();v&&e.onToggleSelection&&(e.onToggleSelection(v),o("⌨️ Toggled selection via Space key"));break}case"a":{(n.ctrlKey||n.metaKey)&&(n.preventDefault(),e.onSelectAll&&(e.onSelectAll(h),o("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{n.preventDefault(),e.onEscape&&e.onEscape(),i(-1),o("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const v=b();if(v.size>0){n.preventDefault();const C=a().filter(r=>v.has(r.id));e.onDelete&&(e.onDelete(C),o(`⌨️ Delete requested via ${n.key} key`))}break}case"Tab":{t()===-1&&h.length>0&&i(0);break}case"j":{!n.ctrlKey&&!n.metaKey&&!n.altKey&&(n.preventDefault(),t()===-1?p():s());break}case"k":{!n.ctrlKey&&!n.metaKey&&!n.altKey&&(n.preventDefault(),t()===-1?u():g());break}case"g":{n.shiftKey?(n.preventDefault(),u()):(n.preventDefault(),p());break}}};return ve(()=>{a().length>0&&t()}),ve(()=>{const n=a();t()>=n.length&&n.length>0?i(n.length-1):n.length===0&&i(-1)}),{focusedIndex:t,setFocusedIndex:i,handleKeyDown:m,focusNext:s,focusPrevious:g,focusFirst:p,focusLast:u,getFocusedItem:d}}var an=k(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),dn=k("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),cn=k("<span style=color:#94a3b8;>"),un=k('<div title="Has thumbnails">'),fn=k('<div title="Generating thumbnails...">');function tt(e){const t=()=>e.size||40,i=()=>e.borderRadius||"4px",o=pt({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var c=an(),a=c.firstChild;return l(c,(()=>{var b=Z(()=>!!o.url);return()=>b()?(()=>{var d=dn();return Oe(d,"error",o.onImageError),L(s=>{var g=o.url,p=`Thumbnail for ${e.item.id.slice(0,8)}`;return g!==s.e&&le(d,"src",s.e=g),p!==s.t&&le(d,"alt",s.t=p),s},{e:void 0,t:void 0}),d})():(()=>{var d=cn();return l(d,()=>o.fallbackIcon),d})()})(),a),l(c,S(A,{get when(){return e.showIndicators!==!1},get children(){return Z(()=>!!o.hasThumbnails)()?(()=>{var b=un();return L(d=>U(b,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,d)),b})():Z(()=>!!o.isRequested)()?(()=>{var b=fn();return L(d=>U(b,`
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
            `,d)),b})():null}}),a),L(b=>{var d=`thumbnail ${e.className||""}`,s=`
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
      `,g=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return d!==b.e&&me(c,b.e=d),b.t=U(c,s,b.t),g!==b.a&&le(c,"title",b.a=g),b},{e:void 0,t:void 0,a:void 0}),c})()}function nt(e){if(e===0)return"0 B";const t=1024,i=["B","KB","MB","GB","TB","PB"],o=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,o)).toFixed(2))+" "+i[o]}var gn=k("<span style=font-weight:500;>"),Ce=k("<span>"),pn=k("<span style=font-family:monospace;font-size:12px;>"),hn=k("<span>—"),bn=k("<button title=Controls>⋯"),mn=k('<button style="background:transparent;border:1px solid #666;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;"title="More actions">⋯');function xn(e){const{state:t,selection:i,addLog:o}=we(),c=t.loadState(),a=ln(c.viewMode||"default"),b=Ze({baseColumnVisibility:()=>t.columnVisibility()}),d=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),s=Te({items:()=>d.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig});ve(()=>{const r=t.popupPreview(),$=t.actionMenu(),_=t.bulkActionMenu(),f=t.headerActionMenu(),y=t.confirmDialog();(r?.isOpen||$?.isOpen||_?.isOpen||f?.isOpen||y?.isOpen)&&(i.isDragSelecting()||i.dragStart())&&(i.setIsDragSelecting(!1),i.setDragStart(null),i.setDragEnd(null),o("🚫 Cancelled drag selection due to modal/overlay"))});const g=sn({onPreview:r=>t.setPopupPreview({item:r,isOpen:!0}),onToggleSelection:r=>i.toggleSelection(r.id),onSelectAll:r=>i.selectAll(r),onClearSelection:()=>i.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):i.clearSelection()},onDelete:r=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${r.length} selected file${r.length!==1?"s":""}?`,items:r,onConfirm:()=>{o(`🗑️ Deleted ${r.length} items via keyboard`),i.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const r=document.activeElement;return r&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable||r.getAttribute("contenteditable")==="true")},getSelectedItems:()=>i.selectedItems(),getAllItems:()=>s.sortedData(),onLog:o}),[p,u]=I(new Set),m=r=>{p().has(r)||(u($=>new Set([...$,r])),d.actions.getThumbnails(r),o(`🖼️ Requesting thumbnails for ${r.slice(0,8)}`))},n=(r,$,_)=>{_.shiftKey&&i.lastSelectedIndex()>=0?(_.preventDefault(),i.selectRange(i.lastSelectedIndex(),$,s.sortedData())):i.handleRowClick(r,$,_)},h=r=>{t.setPopupPreview({item:r,isOpen:!0}),o(`🖼️ Opened preview for: ${ne(r)}`)},v=(r,$,_)=>{_.preventDefault(),_.stopPropagation();const f={x:_.clientX,y:_.clientY},y=i.selectedItems().size;y>1?(t.setBulkActionMenu({isOpen:!0,position:f}),o(`🖱️ Bulk context menu opened for ${y} items`)):(t.setActionMenu({item:r,isOpen:!0,position:f}),o(`🖱️ Context menu opened for: ${ne(r)}`))},x=(r,$)=>{t.handleSort(r,$)},C=G(()=>{const r=b.responsiveColumnVisibility(),$=[];return r.thumbnail&&$.push({key:"thumbnail",title:"",width:60,render:_=>S(tt,{item:_,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:m,get requestedThumbnails(){return p()},showIndicators:!0})}),r.name&&$.push({key:"name",title:"Name",sortable:!0,render:_=>(()=>{var f=gn();return l(f,()=>ne(_)),L(()=>le(f,"title",ne(_))),f})()}),r.blob_type&&$.push({key:"blob_type",title:"Type",width:100,sortable:!0}),r.mime&&$.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:_=>(()=>{var f=Ce();return l(f,()=>_.mime||"unknown"),f})()}),r.id&&$.push({key:"id",title:"ID",width:200,sortable:!0,render:_=>(()=>{var f=pn();return l(f,()=>_.id),f})()}),r.size&&$.push({key:"size",title:"Size",width:100,sortable:!0,render:_=>(()=>{var f=Ce();return l(f,()=>nt(_.size||0)),f})()}),r.parent_blob_id&&$.push({key:"parent_blob_id",title:"Parent",width:120,render:_=>(()=>{var f=Ce();return l(f,()=>_.parent_blob_id?"Yes":"No"),f})()}),r.local_path&&$.push({key:"local_path",title:"Local Path",width:200,render:_=>(()=>{var f=Ce();return l(f,()=>_.local_path||"None"),f})()}),r.created_at&&$.push({key:"created_at",title:"Created",width:140,sortable:!0,render:_=>{const f=qe(_.created_at);return(()=>{var y=Ce();return l(y,()=>f.relative),L(()=>le(y,"title",f.full)),y})()}}),r.updated_at&&$.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:_=>{if(!_.updated_at)return hn();const f=qe(_.updated_at);return(()=>{var y=Ce();return l(y,()=>f.relative),L(()=>le(y,"title",f.full)),y})()}}),r.actions&&$.push({key:"actions",title:(()=>{var _=bn();return _.$$click=f=>{f.stopPropagation();const y=f.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:y.left+y.width/2,y:y.bottom+5}})},L(f=>U(_,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,f)),_})(),width:60,render:_=>(()=>{var f=mn();return f.$$click=y=>{y.stopPropagation(),y.preventDefault();const w=t.actionMenu();if(w&&w.item.id===_.id)t.setActionMenu(null),o(`⋯ Action menu closed for: ${ne(_)}`);else{const F=y.target.getBoundingClientRect(),N={x:F.right-120,y:F.bottom+4};t.setActionMenu({item:_,isOpen:!0,position:N}),o(`⋯ Action menu opened for: ${ne(_)}`)}},f})()}),$});return S(on,{get data(){return s.sortedData()},get columns(){return C()},onSort:x,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return a.getRowHeight()},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return i.selectedItems()},onRowClick:n,onRowDoubleClick:h,get onRowMouseDown(){return i.handleRowMouseDown},onContextMenu:(r,$,_)=>v(r,$,_),onDragSelection:r=>{i.setSelectedItems(r),o(`📦 Selected ${r.size} items via drag`)},showPaginationStatus:!0,onLoadMore:()=>d.actions.loadMore(),get hasMore(){return d.state().hasMore},get isLoadingMore(){return d.state().isLoadingMore},get focusedIndex(){return g.focusedIndex()},showFocusIndicator:!0})}se(["click"]);var yn=k('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),vn=k("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),$n=k("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),wn=k("<div style=display:flex;gap:8px;align-items:center;>"),_n=k("<div style=font-size:12px;color:#888;> of "),kn=k("<div style=position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;><div style=position:relative;>"),Sn=k("<div style=font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;>"),Cn=k("<div style=font-size:14px;color:#b0b0b0;margin-bottom:4px;>by "),zn=k("<div style=font-size:14px;color:#888;>from "),Dn=k("<div style=font-size:18px;font-weight:600;color:#e0e0e0;>"),Mn=k("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=text-align:center;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),Pn=k('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),In=k("<div style=text-align:center;margin-bottom:24px;>"),En=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),Ln=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),Tn=k('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>'),An=k('<img alt="Album Art"style="width:200px;height:200px;object-fit:cover;border-radius:8px;border:2px solid #444;">'),Fn=k("<button>"),Rn=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;></span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>");function On(){const e=ze(),{addLog:t}=we();let i;const[o,c]=I(new Set),a=n=>{o().has(n)||(c(h=>new Set([...h,n])),t(`🖼️ Requesting thumbnails for ${n.slice(0,8)}`))},b=async n=>{if(!n.mime?.startsWith("audio/"))return null;console.log("🔍 Fetching song data for MediaBlob:",{id:n.id,mime:n.mime,blob_type:n.blob_type,has_thumbnails:n.metadata?.has_thumbnails,thumbnails_count:n.metadata?.thumbnails?.length||0});try{const h=await fetch(`/api/media/songs?media_blob_id=${n.id}`);if(!h.ok)return console.warn("❌ Song fetch failed:",h.status,h.statusText),null;const x=(await h.json()).songs?.[0]||null;return console.log("📀 Song data received:",{found:!!x,thumbnail_blob_id:x?.thumbnail_blob_id,thumbnail_blob_ids:x?.thumbnail_blob_ids,waveform_blob_id:x?.waveform_blob_id,title:x?.title}),x}catch(h){return console.error("Failed to fetch song data:",h),null}},[d,s]=I(0),[g]=ft(()=>e.popupPreview()?.item,b);ge(()=>{let n=null;const h=()=>{const x=e.popupPreview()?.item?.id||null;x!==n&&(n=x,x&&s(0)),requestAnimationFrame(h)};h()});const p=n=>{n.key==="Escape"&&(n.preventDefault(),e.setPopupPreview(null))},u=n=>{n.target===i&&(n.preventDefault(),n.stopPropagation(),e.setPopupPreview(null))};ge(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",p),document.addEventListener("click",u),document.body.style.overflow="hidden")}),xe(()=>{document.removeEventListener("keydown",p,!0),document.body.style.overflow=""});const m=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",p,!0),document.addEventListener("click",u,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",p,!0),document.removeEventListener("click",u,!0),document.body.style.overflow="")};return ge(()=>{const n=()=>{m(),requestAnimationFrame(n)};n()}),S(A,{get when(){return Z(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var n=yn(),h=n.firstChild,v=h.firstChild;n.$$click=u;var x=i;return typeof x=="function"?$e(x,n):i=n,h.$$click=C=>C.stopPropagation(),v.addEventListener("mouseleave",C=>{C.target.style.background="#ef4444"}),v.addEventListener("mouseenter",C=>{C.target.style.background="#dc2626"}),v.$$click=()=>e.setPopupPreview(null),l(h,S(A,{get when(){return e.popupPreview()?.item},children:C=>{const r=C().mime||"",$=r.startsWith("image/"),_=r.startsWith("video/"),f=r.startsWith("audio/"),y=ne(C());return[(()=>{var w=In();return l(w,S(A,{when:$,get children(){var F=vn();return F.addEventListener("error",N=>{const Y=N.target;Y.style.display="none";const j=document.createElement("div");j.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${y}</div>
                            </div>
                          `,Y.parentNode?.appendChild(j)}),le(F,"alt",y),L(()=>le(F,"src",`/api/blobs/${C().id}`)),F}}),null),l(w,S(A,{when:_,get children(){var F=$n(),N=F.firstChild;return le(N,"type",r),L(()=>le(N,"src",`/api/blobs/${C().id}`)),F}}),null),l(w,S(A,{when:f,get children(){var F=Mn(),N=F.firstChild,Y=N.nextSibling,j=Y.firstChild;return l(F,S(A,{get when(){return Z(()=>!!g())()&&(g().thumbnail_blob_id||g().thumbnail_blob_ids.length>0)},get fallback(){return S(tt,{get item(){return C()},size:200,apiBaseUrl:"/api",onRequestThumbnails:a,get requestedThumbnails(){return o()},showIndicators:!0,borderRadius:"8px"})},get children(){var B=kn(),ie=B.firstChild;return l(ie,S(A,{get when(){const O=g();return[...O.thumbnail_blob_id?[O.thumbnail_blob_id]:[],...O.thumbnail_blob_ids,...O.waveform_blob_id?[O.waveform_blob_id]:[]][d()]},children:O=>(()=>{var M=An();return M.addEventListener("error",P=>{const E=document.createElement("div");E.innerHTML=`
                                        <div style="width: 200px; height: 200px; background: #333; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 48px;">
                                          🎵
                                        </div>
                                      `,P.target.parentNode?.replaceChild(E,P.target)}),L(()=>le(M,"src",`/api/blobs/${O()}`)),M})()})),l(B,S(A,{get when(){const O=g();return[...O.thumbnail_blob_id?[O.thumbnail_blob_id]:[],...O.thumbnail_blob_ids,...O.waveform_blob_id?[O.waveform_blob_id]:[]].length>1},get children(){var O=wn();return l(O,S(pe,{get each(){const M=g();return[...M.thumbnail_blob_id?[M.thumbnail_blob_id]:[],...M.thumbnail_blob_ids,...M.waveform_blob_id?[M.waveform_blob_id]:[]]},children:(M,P)=>(()=>{var E=Fn();return E.addEventListener("mouseleave",W=>{d()!==P()&&(W.target.style.background="#666")}),E.addEventListener("mouseenter",W=>{d()!==P()&&(W.target.style.background="#888")}),E.$$click=()=>s(P()),L(W=>U(E,`
                                        width: 12px;
                                        height: 12px;
                                        border-radius: 50%;
                                        border: none;
                                        cursor: pointer;
                                        transition: background 0.2s;
                                        background: ${d()===P()?"#ff00ff":"#666"};
                                      `,W)),E})()})),O}}),null),l(B,S(A,{get when(){const O=g();return[...O.thumbnail_blob_id?[O.thumbnail_blob_id]:[],...O.thumbnail_blob_ids,...O.waveform_blob_id?[O.waveform_blob_id]:[]].length>1},get children(){var O=_n(),M=O.firstChild;return l(O,()=>d()+1,M),l(O,()=>{const P=g();return(P.thumbnail_blob_id?1:0)+P.thumbnail_blob_ids.length+(P.waveform_blob_id?1:0)},null),O}}),null),B}}),N),l(N,S(A,{get when(){return g()},get children(){return[(()=>{var B=Sn();return l(B,()=>g().title),B})(),S(A,{get when(){return g().artist},get children(){var B=Cn();return B.firstChild,l(B,()=>g().artist,null),B}}),S(A,{get when(){return g().album},get children(){var B=zn();return B.firstChild,l(B,()=>g().album,null),B}})]}}),null),l(N,S(A,{get when(){return!g()},get children(){var B=Dn();return l(B,y),B}}),null),le(j,"type",r),L(()=>le(j,"src",`/api/blobs/${C().id}`)),F}}),null),l(w,S(A,{when:!$&&!_&&!f,get children(){var F=Pn(),N=F.firstChild,Y=N.nextSibling,j=Y.nextSibling,B=j.firstChild;return L(()=>le(B,"href",`/api/blobs/${C().id}`)),F}}),null),w})(),(()=>{var w=Tn(),F=w.firstChild,N=F.nextSibling,Y=N.firstChild,j=Y.firstChild,B=j.nextSibling,ie=Y.nextSibling,O=ie.firstChild,M=O.nextSibling,P=ie.nextSibling,E=P.firstChild,W=E.nextSibling,D=P.nextSibling,T=D.firstChild,V=T.nextSibling,R=D.nextSibling,K=R.firstChild,J=K.nextSibling,oe=R.nextSibling,ce=oe.firstChild,ue=ce.nextSibling,he=oe.nextSibling,ye=he.firstChild,be=ye.nextSibling;return l(B,y),l(M,()=>C().id),l(W,()=>C().sha256),l(V,()=>C().blob_type),l(J,r||"unknown"),l(ue,()=>nt(C().size||0)),l(be,()=>new Date(C().created_at).toLocaleString()),l(N,S(A,{get when(){return C().parent_blob_id},get children(){var ee=En(),ae=ee.firstChild,re=ae.nextSibling;return l(re,()=>C().parent_blob_id),ee}}),null),l(N,S(A,{get when(){return C().local_path},get children(){var ee=Ln(),ae=ee.firstChild,re=ae.nextSibling;return l(re,()=>C().local_path),ee}}),null),l(N,S(A,{get when(){return C().metadata},get children(){return S(pe,{get each(){const ee=(ae,re="")=>Object.entries(ae).flatMap(([de,X])=>{const _e=re?`${re}.${de}`:de;return de==="thumbnails"||typeof X=="string"&&X.length>500||typeof X=="string"&&X.startsWith("data:image/")?[]:typeof X=="object"&&X!==null&&!Array.isArray(X)?ee(X,_e):[[_e,Array.isArray(X)?JSON.stringify(X):String(X)]]});return ee(C().metadata)},children:([ee,ae])=>(()=>{var re=Rn(),de=re.firstChild,X=de.nextSibling;return l(de,ee),l(X,ae),re})()})}}),null),w})()]}}),null),n}})}se(["click"]);var Bn=k(`<div><style>
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
        `),Wn=k('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),Un=k('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function Nn(){const e=ze();let t;const[i,o]=I({x:0,y:0}),c=m=>{m.key==="Escape"&&(m.preventDefault(),m.stopPropagation(),e.setActionMenu(null))},a=m=>{t&&!t.contains(m.target)&&(m.preventDefault(),m.stopPropagation(),e.setActionMenu(null))},b=()=>{if(!t)return;const m=180,n=160,h=e.actionMenu()?.position;if(!h)return;const{x:v,y:x}=h;let C=v,r=x;const $=window.innerWidth,_=window.innerHeight;v+m>$&&(C=Math.max(10,$-m-10)),x+n>_&&(r=Math.max(10,x-n)),o({x:C,y:r})};ve(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",c,!0),document.addEventListener("mousedown",a,!0),setTimeout(b,0)):(document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",a,!0))}),xe(()=>{document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",a,!0)});const d=async()=>{const m=e.actionMenu()?.item;if(m){try{const n=ne(m),h=document.createElement("a");h.href=`/api/blobs/${m.id}`,h.download=n,document.body.appendChild(h),h.click(),document.body.removeChild(h),console.log(`📥 Downloaded: ${n}`)}catch(n){console.error("Download failed:",n)}e.setActionMenu(null)}},s=()=>{const m=e.actionMenu()?.item;m&&(e.setPopupPreview({item:m,isOpen:!0}),e.setActionMenu(null))},g=()=>{const m=e.actionMenu()?.item;m&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[m],onConfirm:()=>{console.log(`🗑️ Deleted: ${ne(m)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},p=async()=>{const m=e.actionMenu()?.item;if(m){try{const n=`${window.location.origin}/api/blobs/${m.id}`;await navigator.clipboard.writeText(n),console.log(`🔗 Copied URL for: ${ne(m)}`)}catch(n){console.error("Copy URL failed:",n)}e.setActionMenu(null)}},u=m=>{const n=m.mime||"";return n.startsWith("image/")?"🖼️":n.startsWith("video/")?"🎥":n.startsWith("audio/")?"🎵":n.includes("pdf")?"📄":n.includes("text")?"📝":"📄"};return S(A,{get when(){return Z(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var m=Bn(),n=m.firstChild;m.$$click=v=>v.stopPropagation();var h=t;return typeof h=="function"?$e(h,m):t=m,l(m,S(A,{get when(){return e.actionMenu()?.item},children:v=>[(()=>{var x=Wn(),C=x.firstChild,r=C.nextSibling;return l(C,()=>u(v())),l(r,()=>ne(v())),x})(),(()=>{var x=Un(),C=x.firstChild,r=C.nextSibling,$=r.nextSibling,_=$.nextSibling,f=_.nextSibling;return C.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),C.addEventListener("mouseenter",y=>{y.target.style.background="#3a3a3a"}),C.$$click=s,r.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),r.addEventListener("mouseenter",y=>{y.target.style.background="#3a3a3a"}),r.$$click=d,$.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),$.addEventListener("mouseenter",y=>{y.target.style.background="#3a3a3a"}),$.$$click=p,f.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),f.addEventListener("mouseenter",y=>{y.target.style.background="#2a1a1a"}),f.$$click=g,x})()]}),n),L(v=>U(m,`
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
        `,v)),m}})}se(["click"]);var Hn=k(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (<!> selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
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
        `);function Vn(){const{state:e,selection:t}=we();let i;const[o,c]=I({x:0,y:0}),a=u=>{u.key==="Escape"&&(u.preventDefault(),u.stopPropagation(),e.setBulkActionMenu(null))},b=u=>{i&&!i.contains(u.target)&&(u.preventDefault(),u.stopPropagation(),e.setBulkActionMenu(null))},d=()=>{if(!i)return;const u=200,m=140,n=e.bulkActionMenu()?.position;if(!n)return;const{x:h,y:v}=n;let x=h,C=v;const r=window.innerWidth,$=window.innerHeight;h+u>r&&(x=Math.max(10,r-u-10)),v+m>$&&(C=Math.max(10,v-m)),c({x,y:C})};ve(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",a,!0),document.addEventListener("mousedown",b,!0),setTimeout(d,0)):(document.removeEventListener("keydown",a,!0),document.removeEventListener("mousedown",b,!0))}),xe(()=>{document.removeEventListener("keydown",a,!0),document.removeEventListener("mousedown",b,!0)});const s=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},g=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},p=()=>{t.clearSelection(),e.setBulkActionMenu(null)};return S(A,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var u=Hn(),m=u.firstChild,n=m.firstChild,h=n.nextSibling,v=h.firstChild,x=v.nextSibling;x.nextSibling;var C=m.nextSibling,r=C.firstChild,$=r.nextSibling,_=$.nextSibling,f=_.nextSibling;u.$$click=w=>w.stopPropagation();var y=i;return typeof y=="function"?$e(y,u):i=u,l(h,()=>t.selectedItems().size,x),r.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),r.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),r.$$click=s,$.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),$.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),$.$$click=p,f.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),f.addEventListener("mouseenter",w=>{w.target.style.background="#2a1a1a"}),f.$$click=g,L(w=>U(u,`
          position: fixed;
          left: ${o().x}px;
          top: ${o().y}px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `,w)),u}})}se(["click"]);var qn=k("<div class=drag-selection-overlay>"),Kn=k('<div class="drag-selection-corner drag-selection-corner-tl">'),jn=k('<div class="drag-selection-corner drag-selection-corner-br">');function Yn(){const e=yt(),t=G(()=>{if(!e.isDragSelecting()||!e.dragStart()||!e.dragEnd())return null;const i=e.dragStart(),o=e.dragEnd(),c=Math.min(i.x,o.x),a=Math.min(i.y,o.y),b=Math.abs(o.x-i.x),d=Math.abs(o.y-i.y);return{left:c,top:a,width:b,height:d}});return S(A,{get when(){return Z(()=>!!e.isDragSelecting())()&&t()},children:i=>[(()=>{var o=qn();return L(c=>U(o,`
              position: fixed;
              left: ${i().left}px;
              top: ${i().top}px;
              width: ${i().width}px;
              height: ${i().height}px;
              background: rgba(255, 0, 255, 0.1);
              border: 2px dashed chartreuse;
              border-radius: 3px;
              pointer-events: none;
              z-index: 999;
              transition: none;
            `,c)),o})(),(()=>{var o=Kn();return L(c=>U(o,`
              position: fixed;
              left: ${i().left-4}px;
              top: ${i().top-4}px;
              width: 8px;
              height: 8px;
              background: #ff00ff;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,c)),o})(),(()=>{var o=jn();return L(c=>U(o,`
              position: fixed;
              left: ${i().left+i().width-4}px;
              top: ${i().top+i().height-4}px;
              width: 8px;
              height: 8px;
              background: chartreuse;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,c)),o})()]})}var Xn=k('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),Gn=k('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),Jn=k('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),Qn=k(`<style>
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
      `),Zn=k('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function ei(){const e=ze();let t,i;ge(()=>{e.confirmDialog()?.isOpen&&i&&setTimeout(()=>i?.focus(),100)});const o=a=>{e.confirmDialog()?.isOpen&&(a.key==="Escape"?(a.preventDefault(),e.setConfirmDialog(null)):a.key==="Enter"&&a.ctrlKey&&(a.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ge(()=>{document.addEventListener("keydown",o,!0)}),xe(()=>{document.removeEventListener("keydown",o,!0)});const c=a=>{a.target===t&&e.setConfirmDialog(null)};return S(A,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var a=Jn(),b=a.firstChild,d=b.firstChild,s=d.firstChild;s.firstChild;var g=d.nextSibling,p=g.nextSibling,u=p.firstChild,m=u.nextSibling;a.$$click=c;var n=t;typeof n=="function"?$e(n,a):t=a,b.$$click=v=>v.stopPropagation(),l(s,()=>e.confirmDialog()?.title||"Confirm Action",null),l(g,()=>e.confirmDialog()?.message||"Are you sure?"),l(b,S(A,{get when(){return Z(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var v=Xn(),x=v.firstChild,C=x.firstChild,r=C.nextSibling;return r.nextSibling,l(x,()=>e.confirmDialog()?.items?.length||0,r),l(v,()=>e.confirmDialog()?.items?.map($=>(()=>{var _=Zn(),f=_.firstChild,y=f.nextSibling,w=y.nextSibling;return l(y,()=>ne($)),l(w,(()=>{var F=Z(()=>!!$.size);return()=>F()?`${Math.round($.size/1024)}KB`:""})()),_})()),null),v}}),p),l(b,S(A,{get when(){return Z(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var v=Gn(),x=v.firstChild,C=x.nextSibling,r=C.firstChild,$=r.nextSibling;return $.nextSibling,l(C,()=>e.confirmDialog()?.items?.length||0,$),v}}),p),u.$$click=()=>e.setConfirmDialog(null),m.$$click=()=>e.confirmDialog()?.onConfirm?.();var h=i;return typeof h=="function"?$e(h,m):i=m,a})(),Qn()]}})}se(["click"]);var Ge=k("<span style=color:#ff00ff;font-size:12px;>●"),ti=k('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Reset Filters</div></div></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;></div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),ni=k(`<style>
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
      `);function ii(){const{state:e}=we();let t;const i=s=>{t&&!t.contains(s.target)&&(s.preventDefault(),s.stopPropagation(),e.setHeaderActionMenu(null))},o=s=>{s.key==="Escape"&&e.setHeaderActionMenu(null)};ve(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",i,!0),document.addEventListener("keydown",o)):(document.removeEventListener("mousedown",i,!0),document.removeEventListener("keydown",o))}),xe(()=>{document.removeEventListener("mousedown",i,!0),document.removeEventListener("keydown",o)});const c=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},a=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},b=s=>{s.preventDefault(),s.stopPropagation();const g=e.viewMode(),p=["compact","default","detailed"],m=(p.indexOf(g)+1)%p.length,n=p[m];e.setViewMode(n)},d=()=>{e.updateFilter("name",""),e.updateFilter("mime",""),e.updateFilter("blobType",""),e.updateFilter("minSize",0),e.updateFilter("maxSize",0),e.updateFilter("hasParent","all"),e.updateFilter("hasLocalPath","all"),e.setHeaderActionMenu(null)};return S(A,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var s=ti(),g=s.firstChild,p=g.firstChild;p.firstChild;var u=p.nextSibling,m=u.nextSibling,n=m.nextSibling,h=n.firstChild,v=h.firstChild,x=v.nextSibling,C=n.nextSibling;C.firstChild;var r=t;return typeof r=="function"?$e(r,s):t=s,p.$$click=c,l(p,S(A,{get when(){return e.isFilterPanelOpen()},get children(){return Ge()}}),null),u.$$click=d,n.$$click=b,l(x,()=>e.viewMode()),C.$$click=a,l(C,S(A,{get when(){return e.isSettingsPanelOpen()},get children(){return Ge()}}),null),L($=>U(s,`
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
        `,$)),s})(),ni()]}})}se(["click"]);var oi=k(`<div style="display:flex;height:100vh;background:#000000;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function ri(e){return S(xt,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return S(li,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function li(e){return(()=>{var t=oi(),i=t.firstChild,o=i.nextSibling;return l(t,S(wt,{}),i),l(t,S(Kt,{}),i),l(i,S(xn,{get apiBaseUrl(){return e.apiBaseUrl}})),l(t,S(Vt,{}),o),l(t,S(Tt,{}),o),l(t,S(Nt,{}),o),l(t,S(On,{}),null),l(t,S(Nn,{}),null),l(t,S(Vn,{}),null),l(t,S(ei,{}),null),l(t,S(ii,{}),null),l(t,S(Yn,{}),null),t})()}class si extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",i=this.getAttribute("api-base-url")||"http://localhost:8080",o=this.getAttribute("auto-connect")==="true";this.dispose=gt(()=>S(ri,{wsUrl:t,apiBaseUrl:i,autoConnect:o}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",si),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
