import{d as ne,c as D,t as S,a as Oe,b as P,e as ce,s as F,o as ue,f as fe,g as pe,h as V,i as z,j as ct,u as ut,k as u,m as G,F as ge,S as O,l as te,n as me,r as ft}from"./web-Bmt1sUg0.js";import{u as Le}from"./thumbnail-utils-MK6iuaLH.js";import{u as gt}from"./useThumbnail-BQwvSLyN.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function X(e){if(e.metadata&&typeof e.metadata=="object"){const t=e.metadata;if(t.originalName||t.filename||t.original_filename||t.file_name||t.name)return t.originalName||t.filename||t.original_filename||t.file_name||t.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var pt=S(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function Be(e){const[t,n]=D(!1);return(()=>{var o=pt(),d=o.firstChild,s=d.nextSibling;return o.addEventListener("mouseleave",()=>n(!1)),o.addEventListener("mouseenter",()=>n(!0)),Oe(o,"mousedown",e.onMouseDown,!0),P(p=>{var l=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,a=`
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
          opacity: ${t()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return l!==p.e&&ce(o,p.e=l),p.t=F(o,a,p.t),p.a=F(d,g,p.a),p.o=F(s,m,p.o),p},{e:void 0,t:void 0,a:void 0,o:void 0}),o})()}ne(["mousedown"]);function We(e){const[t,n]=D(e.initialWidth),[o,d]=D(!1),s=e.minWidth||250,p=e.maxWidth||600,l=e.closeThreshold||100;return{width:t,setWidth:n,isDragging:o,handleMouseDown:(g,m="right")=>{g.preventDefault(),d(!0),document.body.classList.add("resizing");const f=g.clientX,b=t(),i=w=>{const $=w.clientX-f,M=m==="right"?b-$:b+$;if(M<l){e.onClose?.();return}const r=Math.max(s,Math.min(p,M));n(r),e.onWidthChange?.(r)},h=()=>{d(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",i),document.removeEventListener("mouseup",h)};document.addEventListener("mousemove",i),document.addEventListener("mouseup",h)}}}const Qe="freqhole-demo-state",Fe=300;function Re(){try{const e=localStorage.getItem(Qe);return e?JSON.parse(e):{}}catch{return{}}}function j(e){try{const n={...Re(),...e};localStorage.setItem(Qe,JSON.stringify(n))}catch{}}function mt(e){const t=Re(),[n,o]=D({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[d,s]=D({field:"created_at",direction:"desc",...t.sortConfig||{}}),[p,l]=D(t.viewMode||"default"),[a,g]=D({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[m,f]=D(t.isFilterPanelOpen??!0),[b,i]=D(t.filterPanelWidth||Fe),[h,w]=D(t.isBrowsePanelOpen??!0),[$,M]=D(t.browsePanelWidth||Fe),[r,v]=D(t.isSettingsPanelOpen??!1),[y,c]=D(t.settingsPanelWidth||Fe),[x,k]=D(t.wsUrl||e.wsUrl),[N,q]=D(t.autoConnect??e.autoConnect),[oe,J]=D(t.autoRefresh??!0),[Q,ie]=D(t.debug??!1),[ae,I]=D(null),[E,T]=D(null),[B,C]=D(null),[L,W]=D(null),[A,H]=D(null),[K,Z]=D([]),[re,ee]=D("Disconnected"),[se,de]=D(!1),[he,ye]=D(null);return{filterConfig:n,setFilterConfig:_=>{o(_),j({filterConfig:_})},updateFilter:(_,R)=>{o(le=>{const Pe={...le,[_]:R};return j({filterConfig:Pe}),Pe})},sortConfig:d,setSortConfig:_=>{s(_),j({sortConfig:_})},handleSort:(_,R)=>{const le={field:_,direction:R};s(le),j({sortConfig:le})},viewMode:p,setViewMode:_=>{l(_),j({viewMode:_})},columnVisibility:a,setColumnVisibility:_=>{g(_),j({columnVisibility:_})},toggleColumn:_=>{g(R=>{const le={...R,[_]:!R[_]};return j({columnVisibility:le}),le})},isFilterPanelOpen:m,setIsFilterPanelOpen:_=>{f(_),j({isFilterPanelOpen:_})},toggleFilterPanel:()=>{f(_=>{const R=!_;return j({isFilterPanelOpen:R}),R})},filterPanelWidth:b,setFilterPanelWidth:_=>{i(_),j({filterPanelWidth:_})},isBrowsePanelOpen:h,setIsBrowsePanelOpen:_=>{w(_),j({isBrowsePanelOpen:_})},toggleBrowsePanel:()=>{w(_=>{const R=!_;return j({isBrowsePanelOpen:R}),R})},browsePanelWidth:$,setBrowsePanelWidth:_=>{M(_),j({browsePanelWidth:_})},isSettingsPanelOpen:r,setIsSettingsPanelOpen:_=>{v(_),j({isSettingsPanelOpen:_})},toggleSettingsPanel:()=>{v(_=>{const R=!_;return j({isSettingsPanelOpen:R}),R})},settingsPanelWidth:y,setSettingsPanelWidth:_=>{c(_),j({settingsPanelWidth:_})},wsUrl:x,setWsUrl:k,autoConnect:N,setAutoConnect:q,autoRefresh:oe,setAutoRefresh:J,debug:Q,setDebug:ie,popupPreview:ae,setPopupPreview:I,actionMenu:E,setActionMenu:T,bulkActionMenu:B,setBulkActionMenu:C,confirmDialog:L,setConfirmDialog:W,headerActionMenu:A,setHeaderActionMenu:H,logs:K,setLogs:Z,connectionStatus:re,setConnectionStatus:ee,hasPendingUpdates:se,setHasPendingUpdates:de,lastUpdated:he,setLastUpdated:ye,loadState:Re,saveState:j}}function ht(e={}){const[t,n]=D(e.initialSelection||new Set),[o,d]=D(-1),[s,p]=D(!1),[l,a]=D(null),[g,m]=D(null),f=c=>{n(x=>{const k=new Set(x);return k.has(c)?k.delete(c):k.add(c),k})},b=(c,x,k)=>{const N=Math.min(c,x),q=Math.max(c,x),oe=k.slice(N,q+1);n(J=>{const Q=new Set(J);return oe.forEach(ie=>Q.add(ie.id)),Q})},i=()=>{n(new Set),d(-1)},h=c=>{const x=new Set(c.map(k=>k.id));n(x)},w=c=>t().has(c),$=(c,x,k)=>{const N=c.id;if(k.metaKey||k.ctrlKey)k.preventDefault(),f(N),d(x);else if(k.shiftKey&&o()>=0)k.preventDefault(),d(x);else{if(k.detail>1)return;n(new Set([N])),d(x)}},M=(c,x,k)=>{(k.shiftKey||k.ctrlKey||k.metaKey)&&k.preventDefault(),k.button===0&&!k.metaKey&&!k.ctrlKey&&!k.shiftKey&&(k.preventDefault(),a({x:k.clientX,y:k.clientY,startIndex:x}),p(!0))},r=c=>{const x=c.target,k=x&&(x.tagName==="INPUT"||x.tagName==="TEXTAREA"||x.isContentEditable||x.getAttribute("contenteditable")==="true");c.key==="Escape"?i():c.key==="a"&&(c.metaKey||c.ctrlKey)?k||c.preventDefault():(c.key==="Delete"||c.key==="Backspace")&&!k&&t().size>0&&e.onDelete?.(t())},v=c=>{s()&&l()&&m({x:c.clientX,y:c.clientY,endIndex:-1})},y=()=>{s()&&(p(!1),a(null),m(null))};return ue(()=>{document.addEventListener("mousemove",v),document.addEventListener("mouseup",y),document.addEventListener("keydown",r)}),fe(()=>{document.removeEventListener("mousemove",v),document.removeEventListener("mouseup",y),document.removeEventListener("keydown",r),document.body.classList.remove("drag-selecting")}),pe(()=>{s()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),pe(()=>{const c=t();e.onSelectionChange?.(c),e.saveToStorage?.(c)}),{selectedItems:t,setSelectedItems:n,lastSelectedIndex:o,setLastSelectedIndex:d,isDragSelecting:s,setIsDragSelecting:p,dragStart:l,setDragStart:a,dragEnd:g,setDragEnd:m,toggleSelection:f,selectRange:b,clearSelection:i,selectAll:h,isSelected:w,handleRowClick:$,handleRowMouseDown:M,handleKeyDown:r}}function Te(e){const t=V(()=>{const l=e.filterConfig(),a=e.sortConfig(),g=e.items().filter(f=>{if(l.name&&!X(f).toLowerCase().includes(l.name.toLowerCase()))return!1;if(l.mime){if(!f.mime)return!1;if(!l.mime.includes("/")){if(!f.mime.toLowerCase().startsWith(l.mime.toLowerCase()+"/"))return!1}else if(f.mime!==l.mime)return!1}return!(l.blobType&&f.blob_type!==l.blobType||f.size&&(f.size<l.minSize||l.maxSize>0&&f.size>l.maxSize)||l.hasParent==="yes"&&!f.parent_blob_id||l.hasParent==="no"&&f.parent_blob_id||l.hasLocalPath==="yes"&&!f.local_path||l.hasLocalPath==="no"&&f.local_path)});if(!a.field)return{filtered:g,sorted:g};const m=[...g].sort((f,b)=>{let i,h;if(a.field==="name"?(i=X(f),h=X(b)):(i=f[a.field],h=b[a.field]),i==null&&h==null)return 0;if(i==null)return a.direction==="desc"?-1:1;if(h==null)return a.direction==="desc"?1:-1;if(i instanceof Date&&h instanceof Date)i=i.getTime(),h=h.getTime();else if(a.field==="created_at"||a.field==="updated_at"){if(i&&typeof i=="string"){const $=new Date(i);i=isNaN($.getTime())?0:$.getTime()}else i=0;if(h&&typeof h=="string"){const $=new Date(h);h=isNaN($.getTime())?0:$.getTime()}else h=0}else typeof i=="string"&&typeof h=="string"?(i=i.toLowerCase(),h=h.toLowerCase()):typeof i=="number"&&typeof h=="number"||(i=String(i||"").toLowerCase(),h=String(h||"").toLowerCase());let w=0;return i<h?w=-1:i>h&&(w=1),a.direction==="desc"?-w:w});return{filtered:g,sorted:m}}),n=V(()=>t().filtered),o=V(()=>t().sorted),d=V(()=>[...new Set(e.items().map(l=>l.mime?.split("/")[0]).filter(Boolean))].sort()),s=V(()=>[...new Set(e.items().map(a=>a.blob_type))].filter(Boolean).sort()),p=V(()=>({totalCount:e.items().length,filteredCount:n().length,hiddenCount:e.items().length-n().length}));return{filteredData:n,sortedData:o,mimeCategories:d,blobTypes:s,stats:p}}const Je=ct(),bt=e=>{const t=mt({wsUrl:e.wsUrl,autoConnect:e.autoConnect}),n=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>n.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),d=a=>{const g=new Date().toLocaleTimeString(),m=t.logs();t.setLogs([`${g}: ${a}`,...m.slice(0,49)]),t.debug()&&console.log(`[FreqholeDemo] ${g}: ${a}`)},s=t.loadState(),p=ht({onSelectionChange:a=>{t.saveState({selectedItems:a})},onDelete:a=>{const g=o.sortedData().filter(m=>a.has(m.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${g.length} selected file${g.length!==1?"s":""}?`,items:g,onConfirm:()=>{d(`🗑️ Deleted ${g.length} selected items`),p.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:a=>{},initialSelection:new Set(s.selectedItems?Array.from(s.selectedItems||[]):[])}),l=V(()=>({state:t,selection:p,addLog:d}));return z(Je.Provider,{get value(){return l()},get children(){return e.children}})};function be(){const e=ut(Je);if(!e)throw new Error("useFreqholeAppContext must be used within a FreqholeStateProvider");return e}function xe(){return be().state}function xt(){return be().selection}var yt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h2 style=margin:0;font-size:18px;color:#ffffff;font-weight:600;>📂 Browse</h2><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),vt=S('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Quick Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function $t(){const e=xe(),t=(o,d)=>{e.updateFilter(o,d)},n=We({initialWidth:e.browsePanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:o=>e.setBrowsePanelWidth(o),onClose:()=>e.toggleBrowsePanel()});return(()=>{var o=yt(),d=o.firstChild,s=d.firstChild,p=s.nextSibling,l=d.nextSibling;return p.$$click=()=>e.toggleBrowsePanel(),u(o,(()=>{var a=G(()=>!!e.isBrowsePanelOpen());return()=>a()&&(()=>{var g=vt(),m=g.firstChild,f=m.firstChild,b=f.nextSibling;return b.$$input=i=>t("name",i.currentTarget.value),P(()=>b.value=e.filterConfig().name),g})()})(),l),u(o,z(Be,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:a=>n.handleMouseDown(a,"left")}),l),P(a=>{var g=`browse-panel ${e.isBrowsePanelOpen()?"":"collapsed"} ${n.isDragging()?"resizing":""}`,m=`
        width: ${e.isBrowsePanelOpen()?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${e.isBrowsePanelOpen()?"flex":"none"};
        flex-direction: column;
        height: 100%;
      `;return g!==a.e&&ce(o,a.e=g),a.t=F(o,m,a.t),a},{e:void 0,t:void 0}),o})()}ne(["click","input"]);var wt=S('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),kt=S("<div>"),_t=S("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),St=S('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const Ct=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function zt(e){return(()=>{var t=kt();return u(t,z(ge,{each:Ct,children:n=>{const o=n.key,d=e.columnVisibility[o],s=e.hiddenColumns?.includes(n.key),p=e.responsiveColumnVisibility?.[o]??d;return(()=>{var l=_t(),a=l.firstChild,g=a.firstChild,m=g.nextSibling;return g.addEventListener("change",()=>e.onColumnToggle(o)),g.checked=d,u(m,()=>n.title),u(a,s&&(()=>{var f=St();return P(()=>te(f,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),f})(),null),P(f=>F(m,`
                    font-size: 14px;
                    color: ${p?"#e0e0e0":"#888"};
                    ${!p&&d?"text-decoration: line-through;":""}
                  `,f)),l})()}}),null),u(t,z(O,{get when(){return e.onResetToDefaults},get children(){var n=wt();return Oe(n,"click",e.onResetToDefaults,!0),n}}),null),P(()=>ce(t,`column-manager ${e.className||""}`)),t})()}ne(["click"]);const Dt={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Ze(e){const[t,n]=D(window.innerWidth),o=()=>({...Dt,...e.columnConfig}),d=()=>{const m=e.baseColumnVisibility(),f=o(),b=t(),i={...m};return Object.entries(f).forEach(([h,w])=>{const $=h;m[$]&&b<w.minWidth&&(i[$]=!1)}),i},s=m=>o()[m]?.priority||0,p=()=>{const m=e.baseColumnVisibility(),f=o(),b=t();return Object.entries(f).filter(([i,h])=>m[i]&&b<h.minWidth).map(([i])=>i).sort((i,h)=>s(i)-s(h))},l=()=>{const m=e.baseColumnVisibility(),f=o();return Math.max(...Object.entries(m).filter(([,b])=>b).map(([b])=>f[b]?.minWidth||0))},a=()=>{const m=t();return m<400?{name:"small mobile",size:"xs"}:m<768?{name:"mobile",size:"sm"}:m<1024?{name:"tablet",size:"md"}:m<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},g=()=>{n(window.innerWidth)};return ue(()=>{window.addEventListener("resize",g)}),fe(()=>{window.removeEventListener("resize",g)}),{screenWidth:t,responsiveColumnVisibility:d,getColumnPriority:s,getHiddenColumns:p,getMinimumWidthForAllColumns:l,getBreakpointInfo:a,setScreenWidth:n}}var Mt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h2 style=margin:0;font-size:18px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h2><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),Pt=S('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>bytes</span></div></div><div class=filter-section style=margin-bottom:24px;><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">Quick Size Filters</h4><div style=display:flex;flex-wrap:wrap;gap:6px;><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&lt; 1MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">1-10MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&gt; 10MB</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">👁️ Column Visibility</h3><button class=toggle-button style="width:100%;padding:8px 12px;background:#333333;border:1px solid #555555;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"><span>Manage Columns</span><span style=transform:rotate(90deg);font-size:12px;></span></button></div><div class=filter-section style=margin-bottom:24px;><button style="width:100%;padding:12px;background:#444444;border:1px solid #666666;border-radius:6px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;"><span>Reset All Filters</span></button></div><div class=filter-section style="margin-bottom:24px;padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">📊 Results</h4><p style=margin:0;font-size:14px;color:#ffffff;>Showing <span style=color:#00ff00;font-weight:600;></span> of <span style=color:#888;></span> total files'),qe=S("<option>"),It=S("<div style=margin-top:12px;>"),Et=S("<span style=color:#ff9900;> files filtered out");function Lt(){const e=xe(),[t,n]=D(!1),o=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),d=Te({items:()=>o.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),s=Ze({baseColumnVisibility:()=>e.columnVisibility()}),p=V(()=>d.mimeCategories()),l=V(()=>d.blobTypes()),a=(f,b)=>{e.updateFilter(f,b)},g=f=>{e.toggleColumn(f)},m=We({initialWidth:e.filterPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:f=>e.setFilterPanelWidth(f),onClose:()=>e.toggleFilterPanel()});return(()=>{var f=Mt(),b=f.firstChild,i=b.firstChild,h=i.nextSibling,w=b.nextSibling;return h.$$click=()=>e.toggleFilterPanel(),u(f,(()=>{var $=G(()=>!!e.isFilterPanelOpen());return()=>$()&&(()=>{var M=Pt(),r=M.firstChild,v=r.firstChild,y=v.firstChild,c=y.nextSibling,x=v.nextSibling,k=x.firstChild,N=k.nextSibling;N.firstChild;var q=x.nextSibling,oe=q.firstChild,J=oe.nextSibling;J.firstChild;var Q=q.nextSibling,ie=Q.firstChild,ae=ie.nextSibling,I=ae.firstChild,E=I.nextSibling,T=E.nextSibling,B=Q.nextSibling,C=B.firstChild,L=C.nextSibling,W=L.firstChild,A=W.nextSibling,H=A.nextSibling,K=B.nextSibling,Z=K.firstChild,re=Z.nextSibling,ee=re.firstChild,se=ee.nextSibling,de=K.nextSibling,he=de.firstChild,ye=de.nextSibling,De=ye.firstChild,ke=De.nextSibling,_e=ke.firstChild,Se=_e.nextSibling,Me=Se.nextSibling,ve=Me.nextSibling;return ve.nextSibling,c.$$input=_=>a("name",_.currentTarget.value),N.addEventListener("change",_=>a("mime",_.currentTarget.value)),u(N,z(ge,{get each(){return p()},children:_=>(()=>{var R=qe();return R.value=_,u(R,_),R})()}),null),J.addEventListener("change",_=>a("blobType",_.currentTarget.value)),u(J,z(ge,{get each(){return l()},children:_=>(()=>{var R=qe();return R.value=_,u(R,_),R})()}),null),I.$$input=_=>a("minSize",parseInt(_.currentTarget.value)||0),T.$$input=_=>a("maxSize",parseInt(_.currentTarget.value)||0),W.$$click=()=>{a("minSize",0),a("maxSize",1024*1024)},A.$$click=()=>{a("minSize",1024*1024),a("maxSize",10*1024*1024)},H.$$click=()=>{a("minSize",10*1024*1024),a("maxSize",0)},re.$$click=()=>n(!t()),u(se,()=>t()?"▼":"▶"),u(K,(()=>{var _=G(()=>!!t());return()=>_()&&(()=>{var R=It();return u(R,z(zt,{get columnVisibility(){return e.columnVisibility()},onColumnToggle:g,get responsiveColumnVisibility(){return s.responsiveColumnVisibility()},get hiddenColumns(){return s.getHiddenColumns()},get breakpointInfo(){return s.getBreakpointInfo()}})),R})()})(),null),he.addEventListener("mouseleave",_=>{_.target.style.background="#444444",_.target.style.borderColor="#666666"}),he.addEventListener("mouseenter",_=>{_.target.style.background="#555555",_.target.style.borderColor="#777777"}),he.$$click=()=>{a("name",""),a("mime",""),a("blobType",""),a("minSize",0),a("maxSize",1e8),a("hasParent","all"),a("hasLocalPath","all")},u(Se,()=>d.filteredData().length),u(ve,()=>o.state().items.length),u(ke,(()=>{var _=G(()=>d.filteredData().length<o.state().items.length);return()=>_()&&(()=>{var R=Et(),le=R.firstChild;return u(R,()=>o.state().items.length-d.filteredData().length,le),R})()})(),null),P(()=>c.value=e.filterConfig().name),P(()=>N.value=e.filterConfig().mime),P(()=>J.value=e.filterConfig().blobType),P(()=>I.value=e.filterConfig().minSize||""),P(()=>T.value=e.filterConfig().maxSize||""),M})()})(),w),u(f,z(Be,{position:"right",get isDragging(){return m.isDragging()},onMouseDown:$=>m.handleMouseDown($,"left")}),w),P($=>{var M=`filter-panel ${e.isFilterPanelOpen()?"":"collapsed"} ${m.isDragging()?"resizing":""}`,r=`
        width: ${e.isFilterPanelOpen()?m.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${e.isFilterPanelOpen()?"flex":"none"};
        flex-direction: column;
        height: 100%;
      `;return M!==$.e&&ce(f,$.e=M),$.t=F(f,r,$.t),$},{e:void 0,t:void 0}),f})()}ne(["click","input"]);var Tt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings & Debug</h3><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),At=S("<div style=font-size:11px;color:#666;>Last update: "),Ft=S('<div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">⏳ Pending Updates</h3><div style="padding:12px;background:#2a1a00;border:1px solid #5a3400;border-radius:4px;margin-bottom:12px;"><p style="margin:0 0 8px 0;font-size:14px;color:#ffaa00;"> updates waiting</p><p style=margin:0;font-size:12px;color:#cc8800;>Click below to apply pending changes</p></div><button style="width:100%;padding:10px;background:#aa6600;border:1px solid #cc8800;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">✅ Apply Updates (<!>)'),Rt=S("<div style=color:#666;font-style:italic;>No activity yet..."),Ot=S('<button style="width:100%;padding:6px;background:#333;border:1px solid #555;border-radius:4px;color:#888;font-size:12px;cursor:pointer;margin-top:8px;transition:all 0.2s;">Clear Log'),Bt=S('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔌 WebSocket Connection</h3><div style="margin-bottom:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;><span style=font-size:12px;color:#888;>Status:</span><span></span></div></div><input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:12px;box-sizing:border-box;"><div style=display:flex;gap:8px;margin-bottom:12px;><button>Connect</button><button>Disconnect</button></div><button style="width:100%;padding:8px;background:#0066cc;border:1px solid #0088ff;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;">🔄 Refresh Data</button></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🤖 Automatic Settings</h3><div style=display:flex;flex-direction:column;gap:8px;><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-connect on load</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-refresh data</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Enable debug mode</span></label></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📊 Data Statistics</h3><div style="padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;"><div><div style=color:#888;font-size:12px;>Total Files</div><div style=color:#ffffff;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Filtered</div><div style=color:#00ff00;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Hidden</div><div style=color:#ff9900;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Memory</div><div style=color:#888;font-weight:600;font-size:12px;>~<!>KB</div></div></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📜 Activity Log</h3><div style="max-height:200px;overflow-y:auto;background:#0a0a0a;border:1px solid #333;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;line-height:1.3;"></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ff4444;">⚠️ Danger Zone</h3><div style="padding:12px;background:#2a0000;border:1px solid #5a0000;border-radius:4px;margin-bottom:12px;"><p style=margin:0;font-size:12px;color:#ff8888;>This will clear all settings, filters, and cached data. The page will reload.</p></div><button style="width:100%;padding:10px;background:#aa0000;border:1px solid #dd0000;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Reset All Data'),Wt=S("<div style=color:#ccc;margin-bottom:2px;word-break:break-all;>");function Nt(){const{state:e,addLog:t}=be(),n=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>n.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),d=()=>n.state().connectionStatus,s=()=>n.state().hasPendingUpdates,p=()=>n.state().lastUpdated,l=()=>{n.actions.connect(),t("🔌 Connecting to WebSocket...")},a=()=>{n.actions.disconnect(),t("🔌 Disconnecting from WebSocket...")},g=()=>{t("🔄 Refreshing data..."),n.actions.refresh()},m=()=>{n.actions.applyPendingUpdates(),t("✅ Applied pending updates")},f=()=>{e.setAutoConnect(!e.autoConnect()),t(`🔧 Auto-connect: ${e.autoConnect()?"ON":"OFF"}`)},b=()=>{e.setAutoRefresh(!e.autoRefresh()),t(`🔧 Auto-refresh: ${e.autoRefresh()?"ON":"OFF"}`)},i=()=>{e.setDebug(!e.debug()),t(`🐛 Debug: ${e.debug()?"ON":"OFF"}`)},h=()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},w=We({initialWidth:e.settingsPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:$=>e.setSettingsPanelWidth($),onClose:()=>e.toggleSettingsPanel()});return(()=>{var $=Tt(),M=$.firstChild,r=M.firstChild,v=r.nextSibling,y=M.nextSibling;return v.$$click=()=>e.toggleSettingsPanel(),u($,(()=>{var c=G(()=>!!e.isSettingsPanelOpen());return()=>c()&&(()=>{var x=Bt(),k=x.firstChild,N=k.firstChild,q=N.nextSibling,oe=q.firstChild,J=oe.firstChild,Q=J.nextSibling,ie=q.nextSibling,ae=ie.nextSibling,I=ae.firstChild,E=I.nextSibling,T=ae.nextSibling,B=k.nextSibling,C=B.firstChild,L=C.nextSibling,W=L.firstChild,A=W.firstChild,H=W.nextSibling,K=H.firstChild,Z=H.nextSibling,re=Z.firstChild,ee=B.nextSibling,se=ee.firstChild,de=se.nextSibling,he=de.firstChild,ye=he.firstChild,De=ye.firstChild,ke=De.nextSibling,_e=ye.nextSibling,Se=_e.firstChild,Me=Se.nextSibling,ve=_e.nextSibling,_=ve.firstChild,R=_.nextSibling,le=ve.nextSibling,Pe=le.firstChild,Ne=Pe.nextSibling,it=Ne.firstChild,Ue=it.nextSibling;Ue.nextSibling;var Ae=ee.nextSibling,ot=Ae.firstChild,He=ot.nextSibling,rt=Ae.nextSibling,st=rt.firstChild,lt=st.nextSibling,at=lt.nextSibling;return u(Q,()=>d().toUpperCase()),u(q,z(O,{get when(){return p()},get children(){var U=At();return U.firstChild,u(U,()=>p()?.toLocaleTimeString(),null),U}}),null),ie.$$input=U=>e.setWsUrl(U.currentTarget.value),I.$$click=l,E.$$click=a,T.$$click=g,A.addEventListener("change",f),K.addEventListener("change",b),re.addEventListener("change",i),u(x,z(O,{get when(){return s()},get children(){var U=Ft(),$e=U.firstChild,Ce=$e.nextSibling,Ie=Ce.firstChild,Ee=Ie.firstChild,ze=Ce.nextSibling,dt=ze.firstChild,Ve=dt.nextSibling;return Ve.nextSibling,u(Ie,()=>n.state().pendingUpdates.length,Ee),ze.$$click=m,u(ze,()=>n.state().pendingUpdates.length,Ve),U}}),ee),u(ke,()=>n.state().items.length),u(Me,()=>o.filteredData().length),u(R,()=>n.state().items.length-o.filteredData().length),u(Ne,()=>Math.round(n.state().items.length*.5),Ue),u(He,z(O,{get when(){return e.logs().length===0},get children(){return Rt()}}),null),u(He,z(ge,{get each(){return e.logs()},children:U=>(()=>{var $e=Wt();return u($e,U),$e})()}),null),u(Ae,z(O,{get when(){return e.logs().length>0},get children(){var U=Ot();return U.$$click=()=>e.setLogs([]),U}}),null),at.$$click=h,P(U=>{var $e=`
                  font-size: 12px;
                  font-weight: 600;
                  color: ${d()==="connected"?"#00ff00":d()==="connecting"?"#ffaa00":"#ff4444"};
                `,Ce=d()==="connected",Ie=`
                  flex: 1;
                  padding: 8px;
                  background: ${d()==="connected"?"#333":"#00aa00"};
                  border: 1px solid ${d()==="connected"?"#555":"#00dd00"};
                  border-radius: 4px;
                  color: ${d()==="connected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${d()==="connected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `,Ee=d()==="disconnected",ze=`
                  flex: 1;
                  padding: 8px;
                  background: ${d()==="disconnected"?"#333":"#aa0000"};
                  border: 1px solid ${d()==="disconnected"?"#555":"#dd0000"};
                  border-radius: 4px;
                  color: ${d()==="disconnected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${d()==="disconnected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `;return U.e=F(Q,$e,U.e),Ce!==U.t&&(I.disabled=U.t=Ce),U.a=F(I,Ie,U.a),Ee!==U.o&&(E.disabled=U.o=Ee),U.i=F(E,ze,U.i),U},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),P(()=>ie.value=e.wsUrl()),P(()=>A.checked=e.autoConnect()),P(()=>K.checked=e.autoRefresh()),P(()=>re.checked=e.debug()),x})()})(),y),u($,z(Be,{position:"left",get isDragging(){return w.isDragging()},onMouseDown:c=>w.handleMouseDown(c,"right")}),y),P(c=>{var x=`settings-panel ${e.isSettingsPanelOpen()?"":"collapsed"} ${w.isDragging()?"resizing":""}`,k=`
        width: ${e.isSettingsPanelOpen()?w.width()+"px":"0"};
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
      `;return x!==c.e&&ce($,c.e=x),c.t=F($,k,c.t),c},{e:void 0,t:void 0}),$})()}ne(["click","input"]);var Ut=S(`<div class="edge-toggle-button edge-toggle-left"title="Show Browse panel"style="position:fixed;top:50%;left:0;transform:translateY(-50%);width:24px;height:80px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:0 8px 8px 0;cursor:pointer;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.2s ease;color:#888;font-size:12px;font-weight:500;user-select:none;box-shadow:0 2px 8px rgba(0, 0, 0, 0.3);overflow:hidden;"><div class=arrow-container>→</div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;>Browse</div><style>
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
        `);function Ht(){const e=xe(),[t,n]=D(!1),o=()=>!e.isBrowsePanelOpen(),d=()=>e.toggleBrowsePanel();return z(O,{get when(){return o()},get children(){var s=Ut(),p=s.firstChild;return p.nextSibling,s.addEventListener("mouseleave",()=>n(!1)),s.addEventListener("mouseenter",()=>n(!0)),s.$$click=d,P(l=>F(p,`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `,l)),s}})}ne(["click"]);var Vt=S(`<div class=selection-toolbar style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;animation:slideUp 0.3s ease-out;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><button class="toolbar-button primary"title="Download selected files"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download</button><button class="toolbar-button secondary"title="More actions"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More</button><button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×</button><style>
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
        `);function qt(){const{selection:e,state:t,addLog:n}=be(),o=()=>{const l=e.selectedItems().size;n(`📥 Downloading ${l} selected items`)},d=l=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const g=l.target.getBoundingClientRect(),m={x:g.left+g.width/2-100,y:g.top-10};t.setBulkActionMenu({isOpen:!0,position:m});const f=e.selectedItems().size;n(`⋯ Bulk action menu opened for ${f} items`)}},s=()=>{const l=e.selectedItems().size;e.clearSelection(),n(`🗑️ Cleared selection of ${l} items`)},p=()=>e.selectedItems().size;return z(O,{get when(){return p()>1},get children(){var l=Vt(),a=l.firstChild,g=a.firstChild,m=g.nextSibling;m.nextSibling;var f=a.nextSibling,b=f.nextSibling,i=b.nextSibling;return u(a,p,g),u(a,()=>p()===1?"":"s",m),f.$$click=o,b.$$click=d,i.$$click=s,l}})}ne(["click"]);const Y={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},Kt=(e,t,n)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const o=e[n],d=t[n];if(o==null&&d==null)return 0;if(o==null)return 1;if(d==null)return-1;if(n==="name"){const g=X(e),m=X(t);return g.localeCompare(m,void 0,{numeric:!0,sensitivity:"base"})}if(n.includes("_at")||n.includes("date")||n.includes("time")){const g=new Date(o),m=new Date(d);if(!isNaN(g.getTime())&&!isNaN(m.getTime()))return g.getTime()-m.getTime()}const s=Number(o),p=Number(d);if(!isNaN(s)&&!isNaN(p)&&typeof o=="number"&&typeof d=="number")return s-p;if(n==="size"&&typeof o=="string"&&typeof d=="string"){const g=Ke(o),m=Ke(d);if(g!==null&&m!==null)return g-m}const l=String(o).toLowerCase(),a=String(d).toLowerCase();return n==="name"||n.includes("filename")?l.localeCompare(a,void 0,{numeric:!0,sensitivity:"base"}):l.localeCompare(a)},Ke=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const n=parseFloat(t[1]),o=(t[2]||"B").toUpperCase(),d={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return n*(d[o]||1)};function Yt(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[n,o]=D(e.initialSort||t),[d,s]=D(new Set),[p,l]=D(!1),[a,g]=D(!1),m=e.getItemId||(r=>r.id||String(r)),f=V(()=>{const r=n(),v=[...e.data];return v.length>1e3&&(g(!0),setTimeout(()=>g(!1),100)),v.sort((y,c)=>{const x=Kt(y,c,r.field);return r.direction==="desc"?x*-1:x})});return{sortConfig:n,selectedItems:d,isDragSelecting:p,isSorting:a,sortedData:f,handleSort:r=>{const v=n();if(v.field===r)if(r===t.field){const y=v.direction==="asc"?"desc":"asc";o({field:r,direction:y})}else v.direction==="asc"?o({field:r,direction:"desc"}):v.direction==="desc"?o(t):o({field:r,direction:"asc"});else{const y=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc";o({field:r,direction:y})}},toggleSelection:r=>{const v=new Set(d());v.has(r)?v.delete(r):v.add(r),s(v)},clearSelection:()=>{s(new Set)},selectAll:()=>{const r=new Set(e.data.map(m));s(r)},isSelected:r=>d().has(r),selectRange:(r,v)=>{const y=new Set(d()),c=Math.min(r,v),x=Math.max(r,v);for(let k=c;k<=x;k++)if(k<e.data.length&&e.data[k]!=null){const N=m(e.data[k]);y.add(N)}s(y)},setIsDragSelecting:l,getItemId:m}}var et=S("<div>"),jt=S("<div class=grid-cell>"),Ye=S("<div class=grid-content>"),Xt=S("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Gt=S("<div class=grid-stats>Showing rows <!>-<!> of "),Qt=S("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),Jt=S('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),Zt=S('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),en=S("<div><div style=font-weight:500;flex:1;>"),tn=S("<span>");function je(e){let t;ue(()=>{e.onRowMount&&e.onRowMount(e.item)});const n=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var o=et();o.$$contextmenu=s=>e.onContextMenu?.(e.item,e.index,s),o.$$mousedown=s=>e.onRowMouseDown?.(e.item,e.index,s),o.$$dblclick=s=>e.onRowDoubleClick?.(e.item,e.index,s),o.$$click=s=>e.onRowClick?.(e.item,e.index,s);var d=t;return typeof d=="function"?me(d,o):t=o,u(o,z(ge,{get each(){return e.columns},children:s=>(()=>{var p=jt();return u(p,(()=>{var l=G(()=>!!s.render);return()=>l()?s.render(e.item,e.index):String(e.item[s.key]||"")})()),P(l=>F(p,`
              flex: ${s.width?"0 0 "+s.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${s.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${s.className==="sticky-actions-column"?"0":"auto"};
              background: ${s.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":Y.colors.background:"transparent"};
              ${s.className==="sticky-actions-column"?"border-left: 1px solid "+Y.colors.border+";":""}
              box-shadow: ${s.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${s.className==="sticky-actions-column"?"5":"1"};
            `,l)),p})()})),P(s=>{var p=`grid-row ${e.isSelected?"selected":""} ${n()?"focused":""}`,l=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${Y.colors.border};
        background: ${e.isSelected?Y.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${n()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return p!==s.e&&ce(o,s.e=p),s.t=F(o,l,s.t),s},{e:void 0,t:void 0}),o})()}function nn(e){const[t,n]=D(),[o,d]=D(0),[s,p]=D(0),l=e.rowHeight||50,a=e.headerHeight||60,g=e.virtualizeThreshold||100,[m,f]=D(!1),[b,i]=D(null),[,h]=D(null),w=V(()=>e.columns.reduce((I,E)=>I+(E.width||200),0)),$=Yt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),M=(I,E,T)=>{e.onRowClick?.(I,E,T)},r=(I,E,T)=>{m()&&(f(!1),i(null),h(null)),e.onRowDoubleClick?.(I,E,T)},v=(I,E,T)=>{T.button===0&&!T.metaKey&&!T.ctrlKey&&!T.shiftKey&&(T.preventDefault(),i({x:T.clientX,y:T.clientY,startIndex:E})),e.onRowMouseDown?.(I,E,T)},y=V(()=>e.data.length>g),c=V(()=>{if(!y())return e.data.map((A,H)=>({item:A,index:H}));if(!t())return[];const E=l,T=o(),B=s(),C=Math.floor(T/E),L=Math.min(e.data.length-1,Math.ceil((T+B)/E)+5),W=[];for(let A=Math.max(0,C-5);A<=L;A++)A<e.data.length&&e.data[A]!=null&&W.push({item:e.data[A],index:A});return W}),x=V(()=>e.data.length===0?0:t()?Math.floor(o()/l)+1:1),k=V(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const E=s()-a,T=Math.floor(E/l),B=Math.floor(o()/l)+T;return Math.min(B,e.data.length)}),N=V(()=>e.data.length),q=V(()=>e.data.length*l),oe=(I,E)=>{const T=t();if(!T)return-1;const B=T.getBoundingClientRect(),L=E-B.top+T.scrollTop-a;if(L<0)return-1;const W=Math.floor(L/l);return Math.max(0,Math.min(e.data.length-1,W))},J=I=>{const E=document.body.style.overflow==="hidden",T=document.body.classList.contains("modal-open");if(E||T){(m()||b())&&(f(!1),i(null),h(null));return}const B=b();if(B&&!m()&&Math.sqrt(Math.pow(I.clientX-B.x,2)+Math.pow(I.clientY-B.y,2))>5&&f(!0),m()&&B){const C=oe(I.clientX,I.clientY);if(h({x:I.clientX,y:I.clientY,endIndex:C}),C>=0&&e.getItemId&&e.onDragSelection){const L=Math.min(B.startIndex,C),W=Math.max(B.startIndex,C),A=e.data.slice(L,W+1),H=new Set(A.map(K=>e.getItemId(K)));e.onDragSelection(H)}}},Q=()=>{m()?(f(!1),i(null),h(null)):i(null)},ie=I=>{const E=I.target;if(d(E.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const T=E.scrollHeight,B=E.scrollTop,C=E.clientHeight;T-B-C<200&&e.onLoadMore()}},ae=I=>{if($.handleSort(I),e.onSort){const E=$.sortConfig();e.onSort(E.field,E.direction)}};return ue(()=>{document.addEventListener("mousemove",J),document.addEventListener("mouseup",Q),fe(()=>{document.removeEventListener("mousemove",J),document.removeEventListener("mouseup",Q)})}),ue(()=>{const I=t();if(!I)return;const E=new ResizeObserver(T=>{for(const B of T)p(B.contentRect.height)});E.observe(I),fe(()=>{E.disconnect()})}),(()=>{var I=Qt(),E=I.firstChild,T=E.firstChild,B=E.nextSibling;return E.addEventListener("scroll",ie),me(n,E),u(T,z(ge,{get each(){return e.columns},children:C=>(()=>{var L=en(),W=L.firstChild;return L.$$click=()=>C.sortable&&!$.isSorting()&&ae(C.key),u(W,(()=>{var A=G(()=>typeof C.title=="string");return()=>A()?(()=>{var H=tn();return u(H,()=>C.title),H})():C.title})()),u(L,z(O,{get when(){return G(()=>!!$.isSorting())()&&$.sortConfig().field===C.key},get children(){return Jt()}}),null),u(L,z(O,{get when(){return C.sortable},get children(){var A=Zt(),H=A.firstChild,K=H.nextSibling;return P(Z=>{var re=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${$.sortConfig().field===C.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,ee=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${$.sortConfig().field===C.key&&$.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,se=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${$.sortConfig().field===C.key&&$.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return Z.e=F(A,re,Z.e),Z.t=F(H,ee,Z.t),Z.a=F(K,se,Z.a),Z},{e:void 0,t:void 0,a:void 0}),A}}),null),P(A=>{var H=`grid-header-cell ${C.sortable?"sortable":""} ${C.sortable&&$.sortConfig().field===C.key?"active-sort":""}`,K=`
                  flex: ${C.width?"0 0 "+C.width+"px":"1"};
                  padding: 8px 12px;
                  cursor: ${C.sortable?"pointer":"default"};
                  user-select: none;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  transition: all 0.15s ease;
                  border-radius: 4px;
                  margin: 4px 2px;
                  position: ${C.className==="sticky-actions-column"?"sticky":"relative"};
                  right: ${C.className==="sticky-actions-column"?"0":"auto"};
                  background: ${C.className==="sticky-actions-column"?Y.colors.header:"transparent"};
                  ${C.className==="sticky-actions-column"?"border-left: 1px solid "+Y.colors.border+";":""}
                  box-shadow: ${C.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.2)":"none"};
                  z-index: ${C.className==="sticky-actions-column"?"5":"1"};
                  opacity: ${$.isSorting()&&$.sortConfig().field===C.key?"0.7":"1"};
                `;return H!==A.e&&ce(L,A.e=H),A.t=F(L,K,A.t),A},{e:void 0,t:void 0}),L})()})),u(E,z(O,{get when(){return y()},get fallback(){return(()=>{var C=Ye();return u(C,z(ge,{get each(){return e.data},children:(L,W)=>z(je,{item:L,get index(){return W()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(L)||L.id)||!1},onRowClick:M,onRowDoubleClick:r,onRowMouseDown:v,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:l,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),P(L=>F(C,`min-width: ${w()}px;`,L)),C})()},get children(){var C=Ye();return u(C,z(ge,{get each(){return c()},children:L=>(()=>{var W=et();return u(W,z(je,{get item(){return L.item},get index(){return L.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(L.item)||L.item.id)||!1},onRowClick:M,onRowDoubleClick:r,onRowMouseDown:v,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:l,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),P(A=>F(W,`
                    position: absolute;
                    top: ${L.index*l}px;
                    left: 0;
                    right: 0;
                  `,A)),W})()})),P(L=>F(C,`height: ${q()}px; position: relative; min-width: ${w()}px;`,L)),C}}),null),u(I,z(O,{get when(){return e.showPaginationStatus!==!1},get children(){var C=Gt(),L=C.firstChild,W=L.nextSibling,A=W.nextSibling,H=A.nextSibling;return H.nextSibling,u(C,x,W),u(C,k,H),u(C,N,null),u(C,z(O,{get when(){return e.isLoadingMore},get children(){return Xt()}}),null),P(K=>F(C,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${Y.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,K)),C}}),B),u(B,()=>`
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

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${Y.colors.selected};
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
      `),P(C=>{var L=`infinite-data-grid ${e.className||""} ${m()?"drag-selecting":""}`,W=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${Y.colors.background};
        color: ${Y.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,A=`
            height: ${a}px;
            display: flex;
            align-items: center;
            background: ${Y.colors.header};
            border-bottom: 2px solid ${Y.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${w()}px;
          `;return L!==C.e&&ce(I,C.e=L),C.t=F(I,W,C.t),C.a=F(T,A,C.a),C},{e:void 0,t:void 0,a:void 0}),I})()}ne(["click","dblclick","mousedown","contextmenu"]);const on={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function rn(e="default"){const[t,n]=D(e),o=()=>on[t()];return{viewMode:t,setViewMode:n,cycleViewMode:()=>{const p=["compact","default","detailed"],a=(p.indexOf(t())+1)%p.length,g=p[a];g&&n(g)},getViewModeConfig:o,getRowHeight:()=>o().rowHeight}}function sn(e){const[t,n]=D(-1),o=i=>{e.onLog&&e.onLog(i)},d=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const i=document.activeElement;return i&&(i.tagName==="INPUT"||i.tagName==="TEXTAREA"||i.isContentEditable||i.getAttribute("contenteditable")==="true")},s=()=>e.getAllItems?e.getAllItems():[],p=()=>e.getSelectedItems?e.getSelectedItems():new Set,l=()=>{const i=s(),h=t();return h>=0&&h<i.length&&i[h]||null},a=()=>{const i=s();if(i.length===0)return;const h=t(),w=h<i.length-1?h+1:0;n(w),o(`⌨️ Focused next item: ${w+1}/${i.length}`)},g=()=>{const i=s();if(i.length===0)return;const h=t(),w=h>0?h-1:i.length-1;n(w),o(`⌨️ Focused previous item: ${w+1}/${i.length}`)},m=()=>{s().length!==0&&(n(0),o("⌨️ Focused first item"))},f=()=>{const i=s();i.length!==0&&(n(i.length-1),o("⌨️ Focused last item"))},b=i=>{if(d())return;const h=s();if(h.length!==0)switch(i.key){case"ArrowDown":{i.preventDefault(),t()===-1?m():a();break}case"ArrowUp":{i.preventDefault(),t()===-1?f():g();break}case"Home":{(i.ctrlKey||i.metaKey)&&(i.preventDefault(),m());break}case"End":{(i.ctrlKey||i.metaKey)&&(i.preventDefault(),f());break}case"PageDown":{i.preventDefault();const w=t(),$=Math.min(w+10,h.length-1);n($),o(`⌨️ Page down to item: ${$+1}/${h.length}`);break}case"PageUp":{i.preventDefault();const w=t(),$=Math.max(w-10,0);n($),o(`⌨️ Page up to item: ${$+1}/${h.length}`);break}case"Enter":{i.preventDefault();const w=l();w&&e.onPreview&&(e.onPreview(w),o("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{i.preventDefault();const w=l();w&&e.onToggleSelection&&(e.onToggleSelection(w),o("⌨️ Toggled selection via Space key"));break}case"a":{(i.ctrlKey||i.metaKey)&&(i.preventDefault(),e.onSelectAll&&(e.onSelectAll(h),o("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{i.preventDefault(),e.onEscape&&e.onEscape(),n(-1),o("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const w=p();if(w.size>0){i.preventDefault();const M=s().filter(r=>w.has(r.id));e.onDelete&&(e.onDelete(M),o(`⌨️ Delete requested via ${i.key} key`))}break}case"Tab":{t()===-1&&h.length>0&&n(0);break}case"j":{!i.ctrlKey&&!i.metaKey&&!i.altKey&&(i.preventDefault(),t()===-1?m():a());break}case"k":{!i.ctrlKey&&!i.metaKey&&!i.altKey&&(i.preventDefault(),t()===-1?f():g());break}case"g":{i.shiftKey?(i.preventDefault(),f()):(i.preventDefault(),m());break}}};return pe(()=>{s().length>0&&t()}),pe(()=>{const i=s();t()>=i.length&&i.length>0?n(i.length-1):i.length===0&&n(-1)}),{focusedIndex:t,setFocusedIndex:n,handleKeyDown:b,focusNext:a,focusPrevious:g,focusFirst:m,focusLast:f,getFocusedItem:l}}var ln=S(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),an=S("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),dn=S("<span style=color:#94a3b8;>"),cn=S('<div title="Has thumbnails">'),un=S('<div title="Generating thumbnails...">');function tt(e){const t=()=>e.size||40,n=()=>e.borderRadius||"4px",o=gt({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var d=ln(),s=d.firstChild;return u(d,(()=>{var p=G(()=>!!o.url);return()=>p()?(()=>{var l=an();return Oe(l,"error",o.onImageError),P(a=>{var g=o.url,m=`Thumbnail for ${e.item.id.slice(0,8)}`;return g!==a.e&&te(l,"src",a.e=g),m!==a.t&&te(l,"alt",a.t=m),a},{e:void 0,t:void 0}),l})():(()=>{var l=dn();return u(l,()=>o.fallbackIcon),l})()})(),s),u(d,z(O,{get when(){return e.showIndicators!==!1},get children(){return G(()=>!!o.hasThumbnails)()?(()=>{var p=cn();return P(l=>F(p,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,l)),p})():G(()=>!!o.isRequested)()?(()=>{var p=un();return P(l=>F(p,`
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
            `,l)),p})():null}}),s),P(p=>{var l=`thumbnail ${e.className||""}`,a=`
        width: ${t()}px;
        height: ${t()}px;
        border-radius: ${n()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12,t()*.3)}px;
        position: relative;
        flex-shrink: 0;
      `,g=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return l!==p.e&&ce(d,p.e=l),p.t=F(d,a,p.t),g!==p.a&&te(d,"title",p.a=g),p},{e:void 0,t:void 0,a:void 0}),d})()}function nt(e){if(e===0)return"0 B";const t=1024,n=["B","KB","MB","GB","TB","PB"],o=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,o)).toFixed(2))+" "+n[o]}function fn(e){const t=new Date,n=typeof e=="string"?new Date(e):e;if(isNaN(n.getTime()))return"Invalid date";const o=t.getTime()-n.getTime(),d=Math.floor(o/1e3),s=Math.floor(d/60),p=Math.floor(s/60),l=Math.floor(p/24),a=Math.floor(l/7),g=Math.floor(l/30);if(Math.floor(l/365)>=1)return n.getFullYear().toString();const f=new Intl.RelativeTimeFormat("en",{numeric:"auto",style:"long"});return d<60?d<10?"a moment ago":f.format(-d,"second"):s<60?f.format(-s,"minute"):p<24?f.format(-p,"hour"):l<7?f.format(-l,"day"):a<4?f.format(-a,"week"):g<12?f.format(-g,"month"):n.getFullYear().toString()}function gn(e){const t=typeof e=="string"?new Date(e):e;return isNaN(t.getTime())?"Invalid date":new Intl.DateTimeFormat("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"}).format(t)}function Xe(e){return{relative:fn(e),full:gn(e)}}var pn=S("<span style=font-weight:500;>"),we=S("<span>"),mn=S("<span style=font-family:monospace;font-size:12px;>"),hn=S("<span>—"),bn=S("<button title=Controls>⋯"),xn=S('<button style="background:transparent;border:1px solid #666;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;"title="More actions">⋯');function yn(e){const{state:t,selection:n,addLog:o}=be(),d=t.loadState(),s=rn(d.viewMode||"default"),p=Ze({baseColumnVisibility:()=>t.columnVisibility()}),l=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),a=Te({items:()=>l.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig});pe(()=>{const r=t.popupPreview(),v=t.actionMenu(),y=t.bulkActionMenu(),c=t.headerActionMenu(),x=t.confirmDialog();(r?.isOpen||v?.isOpen||y?.isOpen||c?.isOpen||x?.isOpen)&&(n.isDragSelecting()||n.dragStart())&&(n.setIsDragSelecting(!1),n.setDragStart(null),n.setDragEnd(null),o("🚫 Cancelled drag selection due to modal/overlay"))});const g=sn({onPreview:r=>t.setPopupPreview({item:r,isOpen:!0}),onToggleSelection:r=>n.toggleSelection(r.id),onSelectAll:r=>n.selectAll(r),onClearSelection:()=>n.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):n.clearSelection()},onDelete:r=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${r.length} selected file${r.length!==1?"s":""}?`,items:r,onConfirm:()=>{o(`🗑️ Deleted ${r.length} items via keyboard`),n.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const r=document.activeElement;return r&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable||r.getAttribute("contenteditable")==="true")},getSelectedItems:()=>n.selectedItems(),getAllItems:()=>a.sortedData(),onLog:o}),[m,f]=D(new Set),b=r=>{m().has(r)||(f(v=>new Set([...v,r])),l.actions.getThumbnails(r),o(`🖼️ Requesting thumbnails for ${r.slice(0,8)}`))},i=(r,v,y)=>{y.shiftKey&&n.lastSelectedIndex()>=0?(y.preventDefault(),n.selectRange(n.lastSelectedIndex(),v,a.sortedData())):n.handleRowClick(r,v,y)},h=r=>{t.setPopupPreview({item:r,isOpen:!0}),o(`🖼️ Opened preview for: ${X(r)}`)},w=(r,v,y)=>{y.preventDefault(),y.stopPropagation();const c={x:y.clientX,y:y.clientY},x=n.selectedItems().size;x>1?(t.setBulkActionMenu({isOpen:!0,position:c}),o(`🖱️ Bulk context menu opened for ${x} items`)):(t.setActionMenu({item:r,isOpen:!0,position:c}),o(`🖱️ Context menu opened for: ${X(r)}`))},$=(r,v)=>{t.handleSort(r,v)},M=V(()=>{const r=p.responsiveColumnVisibility(),v=[];return r.thumbnail&&v.push({key:"thumbnail",title:"",width:60,render:y=>z(tt,{item:y,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:b,get requestedThumbnails(){return m()},showIndicators:!0})}),r.name&&v.push({key:"name",title:"Name",sortable:!0,render:y=>(()=>{var c=pn();return u(c,()=>X(y)),P(()=>te(c,"title",X(y))),c})()}),r.blob_type&&v.push({key:"blob_type",title:"Type",width:100,sortable:!0}),r.mime&&v.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:y=>(()=>{var c=we();return u(c,()=>y.mime||"unknown"),c})()}),r.id&&v.push({key:"id",title:"ID",width:200,sortable:!0,render:y=>(()=>{var c=mn();return u(c,()=>y.id),c})()}),r.size&&v.push({key:"size",title:"Size",width:100,sortable:!0,render:y=>(()=>{var c=we();return u(c,()=>nt(y.size||0)),c})()}),r.parent_blob_id&&v.push({key:"parent_blob_id",title:"Parent",width:120,render:y=>(()=>{var c=we();return u(c,()=>y.parent_blob_id?"Yes":"No"),c})()}),r.local_path&&v.push({key:"local_path",title:"Local Path",width:200,render:y=>(()=>{var c=we();return u(c,()=>y.local_path||"None"),c})()}),r.created_at&&v.push({key:"created_at",title:"Created",width:140,sortable:!0,render:y=>{const c=Xe(y.created_at);return(()=>{var x=we();return u(x,()=>c.relative),P(()=>te(x,"title",c.full)),x})()}}),r.updated_at&&v.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:y=>{if(!y.updated_at)return hn();const c=Xe(y.updated_at);return(()=>{var x=we();return u(x,()=>c.relative),P(()=>te(x,"title",c.full)),x})()}}),r.actions&&v.push({key:"actions",title:(()=>{var y=bn();return y.$$click=c=>{c.stopPropagation();const x=c.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:x.left+x.width/2,y:x.bottom+5}})},P(c=>F(y,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,c)),y})(),width:60,render:y=>(()=>{var c=xn();return c.$$click=x=>{x.stopPropagation(),x.preventDefault();const k=t.actionMenu();if(k&&k.item.id===y.id)t.setActionMenu(null),o(`⋯ Action menu closed for: ${X(y)}`);else{const N=x.target.getBoundingClientRect(),q={x:N.right-120,y:N.bottom+4};t.setActionMenu({item:y,isOpen:!0,position:q}),o(`⋯ Action menu opened for: ${X(y)}`)}},c})()}),v});return z(nn,{get data(){return a.sortedData()},get columns(){return M()},onSort:$,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return s.getRowHeight()},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return n.selectedItems()},onRowClick:i,onRowDoubleClick:h,get onRowMouseDown(){return n.handleRowMouseDown},onContextMenu:(r,v,y)=>w(r,v,y),onDragSelection:r=>{n.setSelectedItems(r),o(`📦 Selected ${r.size} items via drag`)},showPaginationStatus:!0,onLoadMore:()=>l.actions.loadMore(),get hasMore(){return l.state().hasMore},get isLoadingMore(){return l.state().isLoadingMore},get focusedIndex(){return g.focusedIndex()},showFocusIndicator:!0})}ne(["click"]);var vn=S('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),$n=S("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),wn=S("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),kn=S("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),_n=S('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),Sn=S("<div style=text-align:center;margin-bottom:24px;>"),Cn=S("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),zn=S("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),Dn=S('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function Mn(){const e=xe(),{addLog:t}=be();let n;const[o,d]=D(new Set),s=g=>{o().has(g)||(d(m=>new Set([...m,g])),t(`🖼️ Requesting thumbnails for ${g.slice(0,8)}`))},p=g=>{g.key==="Escape"&&(g.preventDefault(),e.setPopupPreview(null))},l=g=>{g.target===n&&(g.preventDefault(),g.stopPropagation(),e.setPopupPreview(null))};ue(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",p),document.addEventListener("click",l),document.body.style.overflow="hidden")}),fe(()=>{document.removeEventListener("keydown",p,!0),document.body.style.overflow=""});const a=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",p,!0),document.addEventListener("click",l,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",p,!0),document.removeEventListener("click",l,!0),document.body.style.overflow="")};return ue(()=>{const g=()=>{a(),requestAnimationFrame(g)};g()}),z(O,{get when(){return G(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var g=vn(),m=g.firstChild,f=m.firstChild;g.$$click=l;var b=n;return typeof b=="function"?me(b,g):n=g,m.$$click=i=>i.stopPropagation(),f.addEventListener("mouseleave",i=>{i.target.style.background="#ef4444"}),f.addEventListener("mouseenter",i=>{i.target.style.background="#dc2626"}),f.$$click=()=>e.setPopupPreview(null),u(m,z(O,{get when(){return e.popupPreview()?.item},children:i=>{const h=i().mime||"",w=h.startsWith("image/"),$=h.startsWith("video/"),M=h.startsWith("audio/"),r=X(i());return[(()=>{var v=Sn();return u(v,z(O,{when:w,get children(){var y=$n();return y.addEventListener("error",c=>{const x=c.target;x.style.display="none";const k=document.createElement("div");k.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${r}</div>
                            </div>
                          `,x.parentNode?.appendChild(k)}),te(y,"alt",r),P(()=>te(y,"src",`/api/blobs/${i().id}`)),y}}),null),u(v,z(O,{when:$,get children(){var y=wn(),c=y.firstChild;return te(c,"type",h),P(()=>te(c,"src",`/api/blobs/${i().id}`)),y}}),null),u(v,z(O,{when:M,get children(){var y=kn(),c=y.firstChild,x=c.nextSibling,k=x.firstChild;return u(y,z(tt,{get item(){return i()},size:200,apiBaseUrl:"/api",onRequestThumbnails:s,get requestedThumbnails(){return o()},showIndicators:!0,borderRadius:"8px"}),c),u(c,r),te(k,"type",h),P(()=>te(k,"src",`/api/blobs/${i().id}`)),y}}),null),u(v,z(O,{when:!w&&!$&&!M,get children(){var y=_n(),c=y.firstChild,x=c.nextSibling,k=x.nextSibling,N=k.firstChild;return P(()=>te(N,"href",`/api/blobs/${i().id}`)),y}}),null),v})(),(()=>{var v=Dn(),y=v.firstChild,c=y.nextSibling,x=c.firstChild,k=x.firstChild,N=k.nextSibling,q=x.nextSibling,oe=q.firstChild,J=oe.nextSibling,Q=q.nextSibling,ie=Q.firstChild,ae=ie.nextSibling,I=Q.nextSibling,E=I.firstChild,T=E.nextSibling,B=I.nextSibling,C=B.firstChild,L=C.nextSibling,W=B.nextSibling,A=W.firstChild,H=A.nextSibling,K=W.nextSibling,Z=K.firstChild,re=Z.nextSibling;return u(N,r),u(J,()=>i().id),u(ae,()=>i().sha256),u(T,()=>i().blob_type),u(L,h||"unknown"),u(H,()=>nt(i().size||0)),u(re,()=>new Date(i().created_at).toLocaleString()),u(c,z(O,{get when(){return i().parent_blob_id},get children(){var ee=Cn(),se=ee.firstChild,de=se.nextSibling;return u(de,()=>i().parent_blob_id),ee}}),null),u(c,z(O,{get when(){return i().local_path},get children(){var ee=zn(),se=ee.firstChild,de=se.nextSibling;return u(de,()=>i().local_path),ee}}),null),v})()]}}),null),g}})}ne(["click"]);var Pn=S(`<div><style>
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
        `),In=S('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),En=S('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function Ln(){const e=xe();let t;const[n,o]=D({x:0,y:0}),d=b=>{b.key==="Escape"&&(b.preventDefault(),b.stopPropagation(),e.setActionMenu(null))},s=b=>{t&&!t.contains(b.target)&&(b.preventDefault(),b.stopPropagation(),e.setActionMenu(null))},p=()=>{if(!t)return;const b=180,i=160,h=e.actionMenu()?.position;if(!h)return;const{x:w,y:$}=h;let M=w,r=$;const v=window.innerWidth,y=window.innerHeight;w+b>v&&(M=Math.max(10,v-b-10)),$+i>y&&(r=Math.max(10,$-i)),o({x:M,y:r})};pe(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",d,!0),document.addEventListener("mousedown",s,!0),setTimeout(p,0)):(document.removeEventListener("keydown",d,!0),document.removeEventListener("mousedown",s,!0))}),fe(()=>{document.removeEventListener("keydown",d,!0),document.removeEventListener("mousedown",s,!0)});const l=async()=>{const b=e.actionMenu()?.item;if(b){try{const i=X(b),h=document.createElement("a");h.href=`/api/blobs/${b.id}`,h.download=i,document.body.appendChild(h),h.click(),document.body.removeChild(h),console.log(`📥 Downloaded: ${i}`)}catch(i){console.error("Download failed:",i)}e.setActionMenu(null)}},a=()=>{const b=e.actionMenu()?.item;b&&(e.setPopupPreview({item:b,isOpen:!0}),e.setActionMenu(null))},g=()=>{const b=e.actionMenu()?.item;b&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[b],onConfirm:()=>{console.log(`🗑️ Deleted: ${X(b)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},m=async()=>{const b=e.actionMenu()?.item;if(b){try{const i=`${window.location.origin}/api/blobs/${b.id}`;await navigator.clipboard.writeText(i),console.log(`🔗 Copied URL for: ${X(b)}`)}catch(i){console.error("Copy URL failed:",i)}e.setActionMenu(null)}},f=b=>{const i=b.mime||"";return i.startsWith("image/")?"🖼️":i.startsWith("video/")?"🎥":i.startsWith("audio/")?"🎵":i.includes("pdf")?"📄":i.includes("text")?"📝":"📄"};return z(O,{get when(){return G(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var b=Pn(),i=b.firstChild;b.$$click=w=>w.stopPropagation();var h=t;return typeof h=="function"?me(h,b):t=b,u(b,z(O,{get when(){return e.actionMenu()?.item},children:w=>[(()=>{var $=In(),M=$.firstChild,r=M.nextSibling;return u(M,()=>f(w())),u(r,()=>X(w())),$})(),(()=>{var $=En(),M=$.firstChild,r=M.nextSibling,v=r.nextSibling,y=v.nextSibling,c=y.nextSibling;return M.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),M.addEventListener("mouseenter",x=>{x.target.style.background="#3a3a3a"}),M.$$click=a,r.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),r.addEventListener("mouseenter",x=>{x.target.style.background="#3a3a3a"}),r.$$click=l,v.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),v.addEventListener("mouseenter",x=>{x.target.style.background="#3a3a3a"}),v.$$click=m,c.addEventListener("mouseleave",x=>{x.target.style.background="transparent"}),c.addEventListener("mouseenter",x=>{x.target.style.background="#2a1a1a"}),c.$$click=g,$})()]}),i),P(w=>F(b,`
          position: fixed;
          left: ${n().x}px;
          top: ${n().y}px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 180px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `,w)),b}})}ne(["click"]);var Tn=S(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (<!> selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
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
        `);function An(){const{state:e,selection:t}=be();let n;const[o,d]=D({x:0,y:0}),s=f=>{f.key==="Escape"&&(f.preventDefault(),f.stopPropagation(),e.setBulkActionMenu(null))},p=f=>{n&&!n.contains(f.target)&&(f.preventDefault(),f.stopPropagation(),e.setBulkActionMenu(null))},l=()=>{if(!n)return;const f=200,b=140,i=e.bulkActionMenu()?.position;if(!i)return;const{x:h,y:w}=i;let $=h,M=w;const r=window.innerWidth,v=window.innerHeight;h+f>r&&($=Math.max(10,r-f-10)),w+b>v&&(M=Math.max(10,w-b)),d({x:$,y:M})};pe(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",s,!0),document.addEventListener("mousedown",p,!0),setTimeout(l,0)):(document.removeEventListener("keydown",s,!0),document.removeEventListener("mousedown",p,!0))}),fe(()=>{document.removeEventListener("keydown",s,!0),document.removeEventListener("mousedown",p,!0)});const a=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},g=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},m=()=>{t.clearSelection(),e.setBulkActionMenu(null)};return z(O,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var f=Tn(),b=f.firstChild,i=b.firstChild,h=i.nextSibling,w=h.firstChild,$=w.nextSibling;$.nextSibling;var M=b.nextSibling,r=M.firstChild,v=r.nextSibling,y=v.nextSibling,c=y.nextSibling;f.$$click=k=>k.stopPropagation();var x=n;return typeof x=="function"?me(x,f):n=f,u(h,()=>t.selectedItems().size,$),r.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),r.addEventListener("mouseenter",k=>{k.target.style.background="#3a3a3a"}),r.$$click=a,v.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),v.addEventListener("mouseenter",k=>{k.target.style.background="#3a3a3a"}),v.$$click=m,c.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),c.addEventListener("mouseenter",k=>{k.target.style.background="#2a1a1a"}),c.$$click=g,P(k=>F(f,`
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
        `,k)),f}})}ne(["click"]);var Fn=S("<div class=drag-selection-overlay>"),Rn=S('<div class="drag-selection-corner drag-selection-corner-tl">'),On=S('<div class="drag-selection-corner drag-selection-corner-br">');function Bn(){const e=xt(),t=V(()=>{if(!e.isDragSelecting()||!e.dragStart()||!e.dragEnd())return null;const n=e.dragStart(),o=e.dragEnd(),d=Math.min(n.x,o.x),s=Math.min(n.y,o.y),p=Math.abs(o.x-n.x),l=Math.abs(o.y-n.y);return{left:d,top:s,width:p,height:l}});return z(O,{get when(){return G(()=>!!e.isDragSelecting())()&&t()},children:n=>[(()=>{var o=Fn();return P(d=>F(o,`
              position: fixed;
              left: ${n().left}px;
              top: ${n().top}px;
              width: ${n().width}px;
              height: ${n().height}px;
              background: rgba(255, 0, 255, 0.1);
              border: 2px dashed chartreuse;
              border-radius: 3px;
              pointer-events: none;
              z-index: 999;
              transition: none;
            `,d)),o})(),(()=>{var o=Rn();return P(d=>F(o,`
              position: fixed;
              left: ${n().left-4}px;
              top: ${n().top-4}px;
              width: 8px;
              height: 8px;
              background: #ff00ff;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,d)),o})(),(()=>{var o=On();return P(d=>F(o,`
              position: fixed;
              left: ${n().left+n().width-4}px;
              top: ${n().top+n().height-4}px;
              width: 8px;
              height: 8px;
              background: chartreuse;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,d)),o})()]})}var Wn=S('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),Nn=S('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),Un=S('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),Hn=S(`<style>
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
      `),Vn=S('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function qn(){const e=xe();let t,n;ue(()=>{e.confirmDialog()?.isOpen&&n&&setTimeout(()=>n?.focus(),100)});const o=s=>{e.confirmDialog()?.isOpen&&(s.key==="Escape"?(s.preventDefault(),e.setConfirmDialog(null)):s.key==="Enter"&&s.ctrlKey&&(s.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ue(()=>{document.addEventListener("keydown",o,!0)}),fe(()=>{document.removeEventListener("keydown",o,!0)});const d=s=>{s.target===t&&e.setConfirmDialog(null)};return z(O,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var s=Un(),p=s.firstChild,l=p.firstChild,a=l.firstChild;a.firstChild;var g=l.nextSibling,m=g.nextSibling,f=m.firstChild,b=f.nextSibling;s.$$click=d;var i=t;typeof i=="function"?me(i,s):t=s,p.$$click=w=>w.stopPropagation(),u(a,()=>e.confirmDialog()?.title||"Confirm Action",null),u(g,()=>e.confirmDialog()?.message||"Are you sure?"),u(p,z(O,{get when(){return G(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var w=Wn(),$=w.firstChild,M=$.firstChild,r=M.nextSibling;return r.nextSibling,u($,()=>e.confirmDialog()?.items?.length||0,r),u(w,()=>e.confirmDialog()?.items?.map(v=>(()=>{var y=Vn(),c=y.firstChild,x=c.nextSibling,k=x.nextSibling;return u(x,()=>X(v)),u(k,(()=>{var N=G(()=>!!v.size);return()=>N()?`${Math.round(v.size/1024)}KB`:""})()),y})()),null),w}}),m),u(p,z(O,{get when(){return G(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var w=Nn(),$=w.firstChild,M=$.nextSibling,r=M.firstChild,v=r.nextSibling;return v.nextSibling,u(M,()=>e.confirmDialog()?.items?.length||0,v),w}}),m),f.$$click=()=>e.setConfirmDialog(null),b.$$click=()=>e.confirmDialog()?.onConfirm?.();var h=n;return typeof h=="function"?me(h,b):n=b,s})(),Hn()]}})}ne(["click"]);var Ge=S("<span style=color:#ff00ff;font-size:12px;>●"),Kn=S('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Reset Filters</div></div></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;>default</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),Yn=S(`<style>
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
      `);function jn(){const e=xe();let t;const n=a=>{t&&!t.contains(a.target)&&(a.preventDefault(),a.stopPropagation(),e.setHeaderActionMenu(null))},o=a=>{a.key==="Escape"&&e.setHeaderActionMenu(null)};pe(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",n,!0),document.addEventListener("keydown",o)):(document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",o))}),fe(()=>{document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",o)});const d=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},s=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},p=()=>{e.setHeaderActionMenu(null)},l=()=>{e.updateFilter("name",""),e.updateFilter("mime",""),e.updateFilter("blobType",""),e.updateFilter("minSize",0),e.updateFilter("maxSize",1e8),e.updateFilter("hasParent","all"),e.updateFilter("hasLocalPath","all"),e.setHeaderActionMenu(null)};return z(O,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var a=Kn(),g=a.firstChild,m=g.firstChild;m.firstChild;var f=m.nextSibling,b=f.nextSibling,i=b.nextSibling,h=i.nextSibling;h.firstChild;var w=t;return typeof w=="function"?me(w,a):t=a,m.$$click=d,u(m,z(O,{get when(){return e.isFilterPanelOpen()},get children(){return Ge()}}),null),f.$$click=l,i.$$click=p,h.$$click=s,u(h,z(O,{get when(){return e.isSettingsPanelOpen()},get children(){return Ge()}}),null),P($=>F(a,`
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
        `,$)),a})(),Yn()]}})}ne(["click"]);var Xn=S(`<div style="display:flex;height:100vh;background:#000000;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function Gn(e){return z(bt,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return z(Qn,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function Qn(e){return(()=>{var t=Xn(),n=t.firstChild,o=n.nextSibling;return u(t,z($t,{}),n),u(t,z(qt,{}),n),u(n,z(yn,{get apiBaseUrl(){return e.apiBaseUrl}})),u(t,z(Ht,{}),o),u(t,z(Lt,{}),o),u(t,z(Nt,{}),o),u(t,z(Mn,{}),null),u(t,z(Ln,{}),null),u(t,z(An,{}),null),u(t,z(qn,{}),null),u(t,z(jn,{}),null),u(t,z(Bn,{}),null),t})()}class Jn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",n=this.getAttribute("api-base-url")||"http://localhost:8080",o=this.getAttribute("auto-connect")==="true";this.dispose=ft(()=>z(Gn,{wsUrl:t,apiBaseUrl:n,autoConnect:o}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Jn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
