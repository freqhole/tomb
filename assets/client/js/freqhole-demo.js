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
      `);function Be(e){const[t,n]=D(!1);return(()=>{var o=pt(),c=o.firstChild,l=c.nextSibling;return o.addEventListener("mouseleave",()=>n(!1)),o.addEventListener("mouseenter",()=>n(!0)),Oe(o,"mousedown",e.onMouseDown,!0),P(p=>{var s=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,a=`
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
        `;return s!==p.e&&ce(o,p.e=s),p.t=F(o,a,p.t),p.a=F(c,g,p.a),p.o=F(l,m,p.o),p},{e:void 0,t:void 0,a:void 0,o:void 0}),o})()}ne(["mousedown"]);function We(e){const[t,n]=D(e.initialWidth),[o,c]=D(!1),l=e.minWidth||250,p=e.maxWidth||600,s=e.closeThreshold||100;return{width:t,setWidth:n,isDragging:o,handleMouseDown:(g,m="right")=>{g.preventDefault(),c(!0),document.body.classList.add("resizing");const f=g.clientX,x=t(),i=$=>{const k=$.clientX-f,M=m==="right"?x-k:x+k;if(M<s){e.onClose?.();return}const r=Math.max(l,Math.min(p,M));n(r),e.onWidthChange?.(r)},h=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",i),document.removeEventListener("mouseup",h)};document.addEventListener("mousemove",i),document.addEventListener("mouseup",h)}}}const Qe="freqhole-demo-state",Fe=300;function Re(){try{const e=localStorage.getItem(Qe);return e?JSON.parse(e):{}}catch{return{}}}function j(e){try{const n={...Re(),...e};localStorage.setItem(Qe,JSON.stringify(n))}catch{}}function mt(e){const t=Re(),[n,o]=D({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[c,l]=D({field:"created_at",direction:"desc",...t.sortConfig||{}}),[p,s]=D(t.viewMode||"default"),[a,g]=D({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[m,f]=D(t.isFilterPanelOpen??!0),[x,i]=D(t.filterPanelWidth||Fe),[h,$]=D(t.isBrowsePanelOpen??!0),[k,M]=D(t.browsePanelWidth||Fe),[r,v]=D(t.isSettingsPanelOpen??!1),[b,d]=D(t.settingsPanelWidth||Fe),[y,w]=D(t.wsUrl||e.wsUrl),[U,q]=D(t.autoConnect??e.autoConnect),[oe,J]=D(t.autoRefresh??!0),[Q,ie]=D(t.debug??!1),[ae,I]=D(null),[E,T]=D(null),[B,C]=D(null),[L,W]=D(null),[A,H]=D(null),[K,Z]=D([]),[re,ee]=D("Disconnected"),[le,de]=D(!1),[he,ye]=D(null);return{filterConfig:n,setFilterConfig:_=>{o(_),j({filterConfig:_})},updateFilter:(_,R)=>{o(se=>{const Pe={...se,[_]:R};return j({filterConfig:Pe}),Pe})},sortConfig:c,setSortConfig:_=>{l(_),j({sortConfig:_})},handleSort:(_,R)=>{const se={field:_,direction:R};l(se),j({sortConfig:se})},viewMode:p,setViewMode:_=>{s(_),j({viewMode:_})},columnVisibility:a,setColumnVisibility:_=>{g(_),j({columnVisibility:_})},toggleColumn:_=>{g(R=>{const se={...R,[_]:!R[_]};return j({columnVisibility:se}),se})},isFilterPanelOpen:m,setIsFilterPanelOpen:_=>{f(_),j({isFilterPanelOpen:_})},toggleFilterPanel:()=>{f(_=>{const R=!_;return j({isFilterPanelOpen:R}),R})},filterPanelWidth:x,setFilterPanelWidth:_=>{i(_),j({filterPanelWidth:_})},isBrowsePanelOpen:h,setIsBrowsePanelOpen:_=>{$(_),j({isBrowsePanelOpen:_})},toggleBrowsePanel:()=>{$(_=>{const R=!_;return j({isBrowsePanelOpen:R}),R})},browsePanelWidth:k,setBrowsePanelWidth:_=>{M(_),j({browsePanelWidth:_})},isSettingsPanelOpen:r,setIsSettingsPanelOpen:_=>{v(_),j({isSettingsPanelOpen:_})},toggleSettingsPanel:()=>{v(_=>{const R=!_;return j({isSettingsPanelOpen:R}),R})},settingsPanelWidth:b,setSettingsPanelWidth:_=>{d(_),j({settingsPanelWidth:_})},wsUrl:y,setWsUrl:w,autoConnect:U,setAutoConnect:q,autoRefresh:oe,setAutoRefresh:J,debug:Q,setDebug:ie,popupPreview:ae,setPopupPreview:I,actionMenu:E,setActionMenu:T,bulkActionMenu:B,setBulkActionMenu:C,confirmDialog:L,setConfirmDialog:W,headerActionMenu:A,setHeaderActionMenu:H,logs:K,setLogs:Z,connectionStatus:re,setConnectionStatus:ee,hasPendingUpdates:le,setHasPendingUpdates:de,lastUpdated:he,setLastUpdated:ye,loadState:Re,saveState:j}}function ht(e={}){const[t,n]=D(e.initialSelection||new Set),[o,c]=D(-1),[l,p]=D(!1),[s,a]=D(null),[g,m]=D(null),f=d=>{n(y=>{const w=new Set(y);return w.has(d)?w.delete(d):w.add(d),w})},x=(d,y,w)=>{const U=Math.min(d,y),q=Math.max(d,y),oe=w.slice(U,q+1);n(J=>{const Q=new Set(J);return oe.forEach(ie=>Q.add(ie.id)),Q})},i=()=>{n(new Set),c(-1)},h=d=>{const y=new Set(d.map(w=>w.id));n(y)},$=d=>t().has(d),k=(d,y,w)=>{const U=d.id;if(w.metaKey||w.ctrlKey)w.preventDefault(),f(U),c(y);else if(w.shiftKey&&o()>=0)w.preventDefault(),c(y);else{if(w.detail>1)return;n(new Set([U])),c(y)}},M=(d,y,w)=>{(w.shiftKey||w.ctrlKey||w.metaKey)&&w.preventDefault(),w.button===0&&!w.metaKey&&!w.ctrlKey&&!w.shiftKey&&(w.preventDefault(),a({x:w.clientX,y:w.clientY,startIndex:y}),p(!0))},r=d=>{const y=d.target,w=y&&(y.tagName==="INPUT"||y.tagName==="TEXTAREA"||y.isContentEditable||y.getAttribute("contenteditable")==="true");d.key==="Escape"?i():d.key==="a"&&(d.metaKey||d.ctrlKey)?w||d.preventDefault():(d.key==="Delete"||d.key==="Backspace")&&!w&&t().size>0&&e.onDelete?.(t())},v=d=>{l()&&s()&&m({x:d.clientX,y:d.clientY,endIndex:-1})},b=()=>{l()&&(p(!1),a(null),m(null))};return ue(()=>{document.addEventListener("mousemove",v),document.addEventListener("mouseup",b),document.addEventListener("keydown",r)}),fe(()=>{document.removeEventListener("mousemove",v),document.removeEventListener("mouseup",b),document.removeEventListener("keydown",r),document.body.classList.remove("drag-selecting")}),pe(()=>{l()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),pe(()=>{const d=t();e.onSelectionChange?.(d),e.saveToStorage?.(d)}),{selectedItems:t,setSelectedItems:n,lastSelectedIndex:o,setLastSelectedIndex:c,isDragSelecting:l,setIsDragSelecting:p,dragStart:s,setDragStart:a,dragEnd:g,setDragEnd:m,toggleSelection:f,selectRange:x,clearSelection:i,selectAll:h,isSelected:$,handleRowClick:k,handleRowMouseDown:M,handleKeyDown:r}}function Te(e){const t=V(()=>{const s=e.filterConfig(),a=e.sortConfig(),g=e.items().filter(f=>{if(s.name&&!X(f).toLowerCase().includes(s.name.toLowerCase()))return!1;if(s.mime){if(!f.mime)return!1;if(!s.mime.includes("/")){if(!f.mime.toLowerCase().startsWith(s.mime.toLowerCase()+"/"))return!1}else if(f.mime!==s.mime)return!1}return!(s.blobType&&f.blob_type!==s.blobType||f.size&&(f.size<s.minSize||s.maxSize>0&&f.size>s.maxSize)||s.hasParent==="yes"&&!f.parent_blob_id||s.hasParent==="no"&&f.parent_blob_id||s.hasLocalPath==="yes"&&!f.local_path||s.hasLocalPath==="no"&&f.local_path)});if(!a.field)return{filtered:g,sorted:g};const m=[...g].sort((f,x)=>{let i,h;if(a.field==="name"?(i=X(f),h=X(x)):(i=f[a.field],h=x[a.field]),i==null&&h==null)return 0;if(i==null)return a.direction==="desc"?-1:1;if(h==null)return a.direction==="desc"?1:-1;i instanceof Date&&h instanceof Date?(i=i.getTime(),h=h.getTime()):a.field==="created_at"||a.field==="updated_at"?(i=i?new Date(i).getTime():0,h=h?new Date(h).getTime():0):typeof i=="string"&&typeof h=="string"?(i=i.toLowerCase(),h=h.toLowerCase()):typeof i=="number"&&typeof h=="number"||(i=String(i||"").toLowerCase(),h=String(h||"").toLowerCase());let $=0;return i<h?$=-1:i>h&&($=1),a.direction==="desc"?-$:$});return{filtered:g,sorted:m}}),n=V(()=>t().filtered),o=V(()=>t().sorted),c=V(()=>[...new Set(e.items().map(s=>s.mime?.split("/")[0]).filter(Boolean))].sort()),l=V(()=>[...new Set(e.items().map(a=>a.blob_type))].filter(Boolean).sort()),p=V(()=>({totalCount:e.items().length,filteredCount:n().length,hiddenCount:e.items().length-n().length}));return{filteredData:n,sortedData:o,mimeCategories:c,blobTypes:l,stats:p}}const Je=ct(),bt=e=>{const t=mt({wsUrl:e.wsUrl,autoConnect:e.autoConnect}),n=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>n.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),c=a=>{const g=new Date().toLocaleTimeString(),m=t.logs();t.setLogs([`${g}: ${a}`,...m.slice(0,49)]),t.debug()&&console.log(`[FreqholeDemo] ${g}: ${a}`)},l=t.loadState(),p=ht({onSelectionChange:a=>{t.saveState({selectedItems:a})},onDelete:a=>{const g=o.sortedData().filter(m=>a.has(m.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${g.length} selected file${g.length!==1?"s":""}?`,items:g,onConfirm:()=>{c(`🗑️ Deleted ${g.length} selected items`),p.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:a=>{},initialSelection:new Set(l.selectedItems?Array.from(l.selectedItems||[]):[])}),s=V(()=>({state:t,selection:p,addLog:c}));return z(Je.Provider,{get value(){return s()},get children(){return e.children}})};function be(){const e=ut(Je);if(!e)throw new Error("useFreqholeAppContext must be used within a FreqholeStateProvider");return e}function xe(){return be().state}function xt(){return be().selection}var yt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h2 style=margin:0;font-size:18px;color:#ffffff;font-weight:600;>📂 Browse</h2><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),vt=S('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Quick Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;">');function $t(){const e=xe(),t=(o,c)=>{e.updateFilter(o,c)},n=We({initialWidth:e.browsePanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:o=>e.setBrowsePanelWidth(o),onClose:()=>e.toggleBrowsePanel()});return(()=>{var o=yt(),c=o.firstChild,l=c.firstChild,p=l.nextSibling,s=c.nextSibling;return p.$$click=()=>e.toggleBrowsePanel(),u(o,(()=>{var a=G(()=>!!e.isBrowsePanelOpen());return()=>a()&&(()=>{var g=vt(),m=g.firstChild,f=m.firstChild,x=f.nextSibling;return x.$$input=i=>t("name",i.currentTarget.value),P(()=>x.value=e.filterConfig().name),g})()})(),s),u(o,z(Be,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:a=>n.handleMouseDown(a,"left")}),s),P(a=>{var g=`browse-panel ${e.isBrowsePanelOpen()?"":"collapsed"} ${n.isDragging()?"resizing":""}`,m=`
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
      `;return g!==a.e&&ce(o,a.e=g),a.t=F(o,m,a.t),a},{e:void 0,t:void 0}),o})()}ne(["click","input"]);var wt=S('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),kt=S("<div>"),_t=S("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),St=S('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const Ct=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function zt(e){return(()=>{var t=kt();return u(t,z(ge,{each:Ct,children:n=>{const o=n.key,c=e.columnVisibility[o],l=e.hiddenColumns?.includes(n.key),p=e.responsiveColumnVisibility?.[o]??c;return(()=>{var s=_t(),a=s.firstChild,g=a.firstChild,m=g.nextSibling;return g.addEventListener("change",()=>e.onColumnToggle(o)),g.checked=c,u(m,()=>n.title),u(a,l&&(()=>{var f=St();return P(()=>te(f,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),f})(),null),P(f=>F(m,`
                    font-size: 14px;
                    color: ${p?"#e0e0e0":"#888"};
                    ${!p&&c?"text-decoration: line-through;":""}
                  `,f)),s})()}}),null),u(t,z(O,{get when(){return e.onResetToDefaults},get children(){var n=wt();return Oe(n,"click",e.onResetToDefaults,!0),n}}),null),P(()=>ce(t,`column-manager ${e.className||""}`)),t})()}ne(["click"]);const Dt={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Ze(e){const[t,n]=D(window.innerWidth),o=()=>({...Dt,...e.columnConfig}),c=()=>{const m=e.baseColumnVisibility(),f=o(),x=t(),i={...m};return Object.entries(f).forEach(([h,$])=>{const k=h;m[k]&&x<$.minWidth&&(i[k]=!1)}),i},l=m=>o()[m]?.priority||0,p=()=>{const m=e.baseColumnVisibility(),f=o(),x=t();return Object.entries(f).filter(([i,h])=>m[i]&&x<h.minWidth).map(([i])=>i).sort((i,h)=>l(i)-l(h))},s=()=>{const m=e.baseColumnVisibility(),f=o();return Math.max(...Object.entries(m).filter(([,x])=>x).map(([x])=>f[x]?.minWidth||0))},a=()=>{const m=t();return m<400?{name:"small mobile",size:"xs"}:m<768?{name:"mobile",size:"sm"}:m<1024?{name:"tablet",size:"md"}:m<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},g=()=>{n(window.innerWidth)};return ue(()=>{window.addEventListener("resize",g)}),fe(()=>{window.removeEventListener("resize",g)}),{screenWidth:t,responsiveColumnVisibility:c,getColumnPriority:l,getHiddenColumns:p,getMinimumWidthForAllColumns:s,getBreakpointInfo:a,setScreenWidth:n}}var Mt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h2 style=margin:0;font-size:18px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h2><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),Pt=S('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>bytes</span></div></div><div class=filter-section style=margin-bottom:24px;><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">Quick Size Filters</h4><div style=display:flex;flex-wrap:wrap;gap:6px;><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&lt; 1MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">1-10MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&gt; 10MB</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">👁️ Column Visibility</h3><button class=toggle-button style="width:100%;padding:8px 12px;background:#333333;border:1px solid #555555;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"><span>Manage Columns</span><span style=transform:rotate(90deg);font-size:12px;></span></button></div><div class=filter-section style=margin-bottom:24px;><button style="width:100%;padding:12px;background:#444444;border:1px solid #666666;border-radius:6px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;"><span>Reset All Filters</span></button></div><div class=filter-section style="margin-bottom:24px;padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">📊 Results</h4><p style=margin:0;font-size:14px;color:#ffffff;>Showing <span style=color:#00ff00;font-weight:600;></span> of <span style=color:#888;></span> total files'),qe=S("<option>"),It=S("<div style=margin-top:12px;>"),Et=S("<span style=color:#ff9900;> files filtered out");function Lt(){const e=xe(),[t,n]=D(!1),o=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),c=Te({items:()=>o.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),l=Ze({baseColumnVisibility:()=>e.columnVisibility()}),p=V(()=>c.mimeCategories()),s=V(()=>c.blobTypes()),a=(f,x)=>{e.updateFilter(f,x)},g=f=>{e.toggleColumn(f)},m=We({initialWidth:e.filterPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:f=>e.setFilterPanelWidth(f),onClose:()=>e.toggleFilterPanel()});return(()=>{var f=Mt(),x=f.firstChild,i=x.firstChild,h=i.nextSibling,$=x.nextSibling;return h.$$click=()=>e.toggleFilterPanel(),u(f,(()=>{var k=G(()=>!!e.isFilterPanelOpen());return()=>k()&&(()=>{var M=Pt(),r=M.firstChild,v=r.firstChild,b=v.firstChild,d=b.nextSibling,y=v.nextSibling,w=y.firstChild,U=w.nextSibling;U.firstChild;var q=y.nextSibling,oe=q.firstChild,J=oe.nextSibling;J.firstChild;var Q=q.nextSibling,ie=Q.firstChild,ae=ie.nextSibling,I=ae.firstChild,E=I.nextSibling,T=E.nextSibling,B=Q.nextSibling,C=B.firstChild,L=C.nextSibling,W=L.firstChild,A=W.nextSibling,H=A.nextSibling,K=B.nextSibling,Z=K.firstChild,re=Z.nextSibling,ee=re.firstChild,le=ee.nextSibling,de=K.nextSibling,he=de.firstChild,ye=de.nextSibling,De=ye.firstChild,ke=De.nextSibling,_e=ke.firstChild,Se=_e.nextSibling,Me=Se.nextSibling,ve=Me.nextSibling;return ve.nextSibling,d.$$input=_=>a("name",_.currentTarget.value),U.addEventListener("change",_=>a("mime",_.currentTarget.value)),u(U,z(ge,{get each(){return p()},children:_=>(()=>{var R=qe();return R.value=_,u(R,_),R})()}),null),J.addEventListener("change",_=>a("blobType",_.currentTarget.value)),u(J,z(ge,{get each(){return s()},children:_=>(()=>{var R=qe();return R.value=_,u(R,_),R})()}),null),I.$$input=_=>a("minSize",parseInt(_.currentTarget.value)||0),T.$$input=_=>a("maxSize",parseInt(_.currentTarget.value)||0),W.$$click=()=>{a("minSize",0),a("maxSize",1024*1024)},A.$$click=()=>{a("minSize",1024*1024),a("maxSize",10*1024*1024)},H.$$click=()=>{a("minSize",10*1024*1024),a("maxSize",0)},re.$$click=()=>n(!t()),u(le,()=>t()?"▼":"▶"),u(K,(()=>{var _=G(()=>!!t());return()=>_()&&(()=>{var R=It();return u(R,z(zt,{get columnVisibility(){return e.columnVisibility()},onColumnToggle:g,get responsiveColumnVisibility(){return l.responsiveColumnVisibility()},get hiddenColumns(){return l.getHiddenColumns()},get breakpointInfo(){return l.getBreakpointInfo()}})),R})()})(),null),he.addEventListener("mouseleave",_=>{_.target.style.background="#444444",_.target.style.borderColor="#666666"}),he.addEventListener("mouseenter",_=>{_.target.style.background="#555555",_.target.style.borderColor="#777777"}),he.$$click=()=>{a("name",""),a("mime",""),a("blobType",""),a("minSize",0),a("maxSize",1e8),a("hasParent","all"),a("hasLocalPath","all")},u(Se,()=>c.filteredData().length),u(ve,()=>o.state().items.length),u(ke,(()=>{var _=G(()=>c.filteredData().length<o.state().items.length);return()=>_()&&(()=>{var R=Et(),se=R.firstChild;return u(R,()=>o.state().items.length-c.filteredData().length,se),R})()})(),null),P(()=>d.value=e.filterConfig().name),P(()=>U.value=e.filterConfig().mime),P(()=>J.value=e.filterConfig().blobType),P(()=>I.value=e.filterConfig().minSize||""),P(()=>T.value=e.filterConfig().maxSize||""),M})()})(),$),u(f,z(Be,{position:"right",get isDragging(){return m.isDragging()},onMouseDown:k=>m.handleMouseDown(k,"left")}),$),P(k=>{var M=`filter-panel ${e.isFilterPanelOpen()?"":"collapsed"} ${m.isDragging()?"resizing":""}`,r=`
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
      `;return M!==k.e&&ce(f,k.e=M),k.t=F(f,r,k.t),k},{e:void 0,t:void 0}),f})()}ne(["click","input"]);var Tt=S(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;height:60px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;z-index:10;flex-shrink:0;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings & Debug</h3><button title="Close panel"style="background:transparent;border:none;color:#888888;font-size:18px;cursor:pointer;padding:4px;border-radius:3px;transition:all 0.2s;">✕</button></div><style>
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
      `),At=S("<div style=font-size:11px;color:#666;>Last update: "),Ft=S('<div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">⏳ Pending Updates</h3><div style="padding:12px;background:#2a1a00;border:1px solid #5a3400;border-radius:4px;margin-bottom:12px;"><p style="margin:0 0 8px 0;font-size:14px;color:#ffaa00;"> updates waiting</p><p style=margin:0;font-size:12px;color:#cc8800;>Click below to apply pending changes</p></div><button style="width:100%;padding:10px;background:#aa6600;border:1px solid #cc8800;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">✅ Apply Updates (<!>)'),Rt=S("<div style=color:#666;font-style:italic;>No activity yet..."),Ot=S('<button style="width:100%;padding:6px;background:#333;border:1px solid #555;border-radius:4px;color:#888;font-size:12px;cursor:pointer;margin-top:8px;transition:all 0.2s;">Clear Log'),Bt=S('<div style=height:100%;overflow-y:auto;flex:1;padding:20px;><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔌 WebSocket Connection</h3><div style="margin-bottom:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;><span style=font-size:12px;color:#888;>Status:</span><span></span></div></div><input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:12px;box-sizing:border-box;"><div style=display:flex;gap:8px;margin-bottom:12px;><button>Connect</button><button>Disconnect</button></div><button style="width:100%;padding:8px;background:#0066cc;border:1px solid #0088ff;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;">🔄 Refresh Data</button></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🤖 Automatic Settings</h3><div style=display:flex;flex-direction:column;gap:8px;><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-connect on load</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-refresh data</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Enable debug mode</span></label></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📊 Data Statistics</h3><div style="padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;"><div><div style=color:#888;font-size:12px;>Total Files</div><div style=color:#ffffff;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Filtered</div><div style=color:#00ff00;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Hidden</div><div style=color:#ff9900;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Memory</div><div style=color:#888;font-weight:600;font-size:12px;>~<!>KB</div></div></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📜 Activity Log</h3><div style="max-height:200px;overflow-y:auto;background:#0a0a0a;border:1px solid #333;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;line-height:1.3;"></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ff4444;">⚠️ Danger Zone</h3><div style="padding:12px;background:#2a0000;border:1px solid #5a0000;border-radius:4px;margin-bottom:12px;"><p style=margin:0;font-size:12px;color:#ff8888;>This will clear all settings, filters, and cached data. The page will reload.</p></div><button style="width:100%;padding:10px;background:#aa0000;border:1px solid #dd0000;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Reset All Data'),Wt=S("<div style=color:#ccc;margin-bottom:2px;word-break:break-all;>");function Ut(){const{state:e,addLog:t}=be(),n=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>n.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),c=()=>n.state().connectionStatus,l=()=>n.state().hasPendingUpdates,p=()=>n.state().lastUpdated,s=()=>{n.actions.connect(),t("🔌 Connecting to WebSocket...")},a=()=>{n.actions.disconnect(),t("🔌 Disconnecting from WebSocket...")},g=()=>{t("🔄 Refreshing data..."),n.actions.refresh()},m=()=>{n.actions.applyPendingUpdates(),t("✅ Applied pending updates")},f=()=>{e.setAutoConnect(!e.autoConnect()),t(`🔧 Auto-connect: ${e.autoConnect()?"ON":"OFF"}`)},x=()=>{e.setAutoRefresh(!e.autoRefresh()),t(`🔧 Auto-refresh: ${e.autoRefresh()?"ON":"OFF"}`)},i=()=>{e.setDebug(!e.debug()),t(`🐛 Debug: ${e.debug()?"ON":"OFF"}`)},h=()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},$=We({initialWidth:e.settingsPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:k=>e.setSettingsPanelWidth(k),onClose:()=>e.toggleSettingsPanel()});return(()=>{var k=Tt(),M=k.firstChild,r=M.firstChild,v=r.nextSibling,b=M.nextSibling;return v.$$click=()=>e.toggleSettingsPanel(),u(k,(()=>{var d=G(()=>!!e.isSettingsPanelOpen());return()=>d()&&(()=>{var y=Bt(),w=y.firstChild,U=w.firstChild,q=U.nextSibling,oe=q.firstChild,J=oe.firstChild,Q=J.nextSibling,ie=q.nextSibling,ae=ie.nextSibling,I=ae.firstChild,E=I.nextSibling,T=ae.nextSibling,B=w.nextSibling,C=B.firstChild,L=C.nextSibling,W=L.firstChild,A=W.firstChild,H=W.nextSibling,K=H.firstChild,Z=H.nextSibling,re=Z.firstChild,ee=B.nextSibling,le=ee.firstChild,de=le.nextSibling,he=de.firstChild,ye=he.firstChild,De=ye.firstChild,ke=De.nextSibling,_e=ye.nextSibling,Se=_e.firstChild,Me=Se.nextSibling,ve=_e.nextSibling,_=ve.firstChild,R=_.nextSibling,se=ve.nextSibling,Pe=se.firstChild,Ue=Pe.nextSibling,it=Ue.firstChild,Ne=it.nextSibling;Ne.nextSibling;var Ae=ee.nextSibling,ot=Ae.firstChild,He=ot.nextSibling,rt=Ae.nextSibling,lt=rt.firstChild,st=lt.nextSibling,at=st.nextSibling;return u(Q,()=>c().toUpperCase()),u(q,z(O,{get when(){return p()},get children(){var N=At();return N.firstChild,u(N,()=>p()?.toLocaleTimeString(),null),N}}),null),ie.$$input=N=>e.setWsUrl(N.currentTarget.value),I.$$click=s,E.$$click=a,T.$$click=g,A.addEventListener("change",f),K.addEventListener("change",x),re.addEventListener("change",i),u(y,z(O,{get when(){return l()},get children(){var N=Ft(),$e=N.firstChild,Ce=$e.nextSibling,Ie=Ce.firstChild,Ee=Ie.firstChild,ze=Ce.nextSibling,dt=ze.firstChild,Ve=dt.nextSibling;return Ve.nextSibling,u(Ie,()=>n.state().pendingUpdates.length,Ee),ze.$$click=m,u(ze,()=>n.state().pendingUpdates.length,Ve),N}}),ee),u(ke,()=>n.state().items.length),u(Me,()=>o.filteredData().length),u(R,()=>n.state().items.length-o.filteredData().length),u(Ue,()=>Math.round(n.state().items.length*.5),Ne),u(He,z(O,{get when(){return e.logs().length===0},get children(){return Rt()}}),null),u(He,z(ge,{get each(){return e.logs()},children:N=>(()=>{var $e=Wt();return u($e,N),$e})()}),null),u(Ae,z(O,{get when(){return e.logs().length>0},get children(){var N=Ot();return N.$$click=()=>e.setLogs([]),N}}),null),at.$$click=h,P(N=>{var $e=`
                  font-size: 12px;
                  font-weight: 600;
                  color: ${c()==="connected"?"#00ff00":c()==="connecting"?"#ffaa00":"#ff4444"};
                `,Ce=c()==="connected",Ie=`
                  flex: 1;
                  padding: 8px;
                  background: ${c()==="connected"?"#333":"#00aa00"};
                  border: 1px solid ${c()==="connected"?"#555":"#00dd00"};
                  border-radius: 4px;
                  color: ${c()==="connected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${c()==="connected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `,Ee=c()==="disconnected",ze=`
                  flex: 1;
                  padding: 8px;
                  background: ${c()==="disconnected"?"#333":"#aa0000"};
                  border: 1px solid ${c()==="disconnected"?"#555":"#dd0000"};
                  border-radius: 4px;
                  color: ${c()==="disconnected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${c()==="disconnected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `;return N.e=F(Q,$e,N.e),Ce!==N.t&&(I.disabled=N.t=Ce),N.a=F(I,Ie,N.a),Ee!==N.o&&(E.disabled=N.o=Ee),N.i=F(E,ze,N.i),N},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),P(()=>ie.value=e.wsUrl()),P(()=>A.checked=e.autoConnect()),P(()=>K.checked=e.autoRefresh()),P(()=>re.checked=e.debug()),y})()})(),b),u(k,z(Be,{position:"left",get isDragging(){return $.isDragging()},onMouseDown:d=>$.handleMouseDown(d,"right")}),b),P(d=>{var y=`settings-panel ${e.isSettingsPanelOpen()?"":"collapsed"} ${$.isDragging()?"resizing":""}`,w=`
        width: ${e.isSettingsPanelOpen()?$.width()+"px":"0"};
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
      `;return y!==d.e&&ce(k,d.e=y),d.t=F(k,w,d.t),d},{e:void 0,t:void 0}),k})()}ne(["click","input"]);var Nt=S(`<div class="edge-toggle-button edge-toggle-left"title="Show Browse panel"style="position:fixed;top:50%;left:0;transform:translateY(-50%);width:24px;height:80px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:0 8px 8px 0;cursor:pointer;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.2s ease;color:#888;font-size:12px;font-weight:500;user-select:none;box-shadow:0 2px 8px rgba(0, 0, 0, 0.3);overflow:hidden;"><div class=arrow-container>→</div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;>Browse</div><style>
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
        `);function Ht(){const e=xe(),[t,n]=D(!1),o=()=>!e.isBrowsePanelOpen(),c=()=>e.toggleBrowsePanel();return z(O,{get when(){return o()},get children(){var l=Nt(),p=l.firstChild;return p.nextSibling,l.addEventListener("mouseleave",()=>n(!1)),l.addEventListener("mouseenter",()=>n(!0)),l.$$click=c,P(s=>F(p,`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `,s)),l}})}ne(["click"]);var Vt=S(`<div class=selection-toolbar style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;animation:slideUp 0.3s ease-out;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><button class="toolbar-button primary"title="Download selected files"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download</button><button class="toolbar-button secondary"title="More actions"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More</button><button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×</button><style>
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
        `);function qt(){const{selection:e,state:t,addLog:n}=be(),o=()=>{const s=e.selectedItems().size;n(`📥 Downloading ${s} selected items`)},c=s=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const g=s.target.getBoundingClientRect(),m={x:g.left+g.width/2-100,y:g.top-10};t.setBulkActionMenu({isOpen:!0,position:m});const f=e.selectedItems().size;n(`⋯ Bulk action menu opened for ${f} items`)}},l=()=>{const s=e.selectedItems().size;e.clearSelection(),n(`🗑️ Cleared selection of ${s} items`)},p=()=>e.selectedItems().size;return z(O,{get when(){return p()>1},get children(){var s=Vt(),a=s.firstChild,g=a.firstChild,m=g.nextSibling;m.nextSibling;var f=a.nextSibling,x=f.nextSibling,i=x.nextSibling;return u(a,p,g),u(a,()=>p()===1?"":"s",m),f.$$click=o,x.$$click=c,i.$$click=l,s}})}ne(["click"]);const Y={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},Kt=(e,t,n)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const o=e[n],c=t[n];if(o==null&&c==null)return 0;if(o==null)return 1;if(c==null)return-1;if(n==="name"){const g=X(e),m=X(t);return g.localeCompare(m,void 0,{numeric:!0,sensitivity:"base"})}if(n.includes("_at")||n.includes("date")||n.includes("time")){const g=new Date(o),m=new Date(c);if(!isNaN(g.getTime())&&!isNaN(m.getTime()))return g.getTime()-m.getTime()}const l=Number(o),p=Number(c);if(!isNaN(l)&&!isNaN(p)&&typeof o=="number"&&typeof c=="number")return l-p;if(n==="size"&&typeof o=="string"&&typeof c=="string"){const g=Ke(o),m=Ke(c);if(g!==null&&m!==null)return g-m}const s=String(o).toLowerCase(),a=String(c).toLowerCase();return n==="name"||n.includes("filename")?s.localeCompare(a,void 0,{numeric:!0,sensitivity:"base"}):s.localeCompare(a)},Ke=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const n=parseFloat(t[1]),o=(t[2]||"B").toUpperCase(),c={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return n*(c[o]||1)};function Yt(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[n,o]=D(e.initialSort||t),[c,l]=D(new Set),[p,s]=D(!1),[a,g]=D(!1),m=e.getItemId||(r=>r.id||String(r)),f=V(()=>{const r=n(),v=[...e.data];return v.length>1e3&&(g(!0),setTimeout(()=>g(!1),100)),v.sort((b,d)=>{const y=Kt(b,d,r.field);return r.direction==="desc"?y*-1:y})});return{sortConfig:n,selectedItems:c,isDragSelecting:p,isSorting:a,sortedData:f,handleSort:r=>{const v=n();if(v.field===r){const b=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc",d=b==="desc"?"asc":"desc";v.direction===b?o({field:r,direction:d}):v.direction===d?o(t):o({field:r,direction:b})}else{const b=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc";o({field:r,direction:b})}},toggleSelection:r=>{const v=new Set(c());v.has(r)?v.delete(r):v.add(r),l(v)},clearSelection:()=>{l(new Set)},selectAll:()=>{const r=new Set(e.data.map(m));l(r)},isSelected:r=>c().has(r),selectRange:(r,v)=>{const b=new Set(c()),d=Math.min(r,v),y=Math.max(r,v);for(let w=d;w<=y;w++)if(w<e.data.length&&e.data[w]!=null){const U=m(e.data[w]);b.add(U)}l(b)},setIsDragSelecting:s,getItemId:m}}var et=S("<div>"),jt=S("<div class=grid-cell>"),Ye=S("<div class=grid-content>"),Xt=S("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Gt=S("<div class=grid-stats>Showing rows <!>-<!> of "),Qt=S("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),Jt=S('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),Zt=S('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),en=S("<div><div style=font-weight:500;flex:1;>"),tn=S("<span>");function je(e){let t;ue(()=>{e.onRowMount&&e.onRowMount(e.item)});const n=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var o=et();o.$$contextmenu=l=>e.onContextMenu?.(e.item,e.index,l),o.$$mousedown=l=>e.onRowMouseDown?.(e.item,e.index,l),o.$$dblclick=l=>e.onRowDoubleClick?.(e.item,e.index,l),o.$$click=l=>e.onRowClick?.(e.item,e.index,l);var c=t;return typeof c=="function"?me(c,o):t=o,u(o,z(ge,{get each(){return e.columns},children:l=>(()=>{var p=jt();return u(p,(()=>{var s=G(()=>!!l.render);return()=>s()?l.render(e.item,e.index):String(e.item[l.key]||"")})()),P(s=>F(p,`
              flex: ${l.width?"0 0 "+l.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${l.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${l.className==="sticky-actions-column"?"0":"auto"};
              background: ${l.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":Y.colors.background:"transparent"};
              ${l.className==="sticky-actions-column"?"border-left: 1px solid "+Y.colors.border+";":""}
              box-shadow: ${l.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${l.className==="sticky-actions-column"?"5":"1"};
            `,s)),p})()})),P(l=>{var p=`grid-row ${e.isSelected?"selected":""} ${n()?"focused":""}`,s=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${Y.colors.border};
        background: ${e.isSelected?Y.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${n()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return p!==l.e&&ce(o,l.e=p),l.t=F(o,s,l.t),l},{e:void 0,t:void 0}),o})()}function nn(e){const[t,n]=D(),[o,c]=D(0),[l,p]=D(0),s=e.rowHeight||50,a=e.headerHeight||60,g=e.virtualizeThreshold||100,[m,f]=D(!1),[x,i]=D(null),[,h]=D(null),$=V(()=>e.columns.reduce((I,E)=>I+(E.width||200),0)),k=Yt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),M=(I,E,T)=>{e.onRowClick?.(I,E,T)},r=(I,E,T)=>{m()&&(f(!1),i(null),h(null)),e.onRowDoubleClick?.(I,E,T)},v=(I,E,T)=>{T.button===0&&!T.metaKey&&!T.ctrlKey&&!T.shiftKey&&(T.preventDefault(),i({x:T.clientX,y:T.clientY,startIndex:E})),e.onRowMouseDown?.(I,E,T)},b=V(()=>e.data.length>g),d=V(()=>{if(!b())return e.data.map((A,H)=>({item:A,index:H}));if(!t())return[];const E=s,T=o(),B=l(),C=Math.floor(T/E),L=Math.min(e.data.length-1,Math.ceil((T+B)/E)+5),W=[];for(let A=Math.max(0,C-5);A<=L;A++)A<e.data.length&&e.data[A]!=null&&W.push({item:e.data[A],index:A});return W}),y=V(()=>e.data.length===0?0:t()?Math.floor(o()/s)+1:1),w=V(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const E=l()-a,T=Math.floor(E/s),B=Math.floor(o()/s)+T;return Math.min(B,e.data.length)}),U=V(()=>e.data.length),q=V(()=>e.data.length*s),oe=(I,E)=>{const T=t();if(!T)return-1;const B=T.getBoundingClientRect(),L=E-B.top+T.scrollTop-a;if(L<0)return-1;const W=Math.floor(L/s);return Math.max(0,Math.min(e.data.length-1,W))},J=I=>{const E=document.body.style.overflow==="hidden",T=document.body.classList.contains("modal-open");if(E||T){(m()||x())&&(f(!1),i(null),h(null));return}const B=x();if(B&&!m()&&Math.sqrt(Math.pow(I.clientX-B.x,2)+Math.pow(I.clientY-B.y,2))>5&&f(!0),m()&&B){const C=oe(I.clientX,I.clientY);if(h({x:I.clientX,y:I.clientY,endIndex:C}),C>=0&&e.getItemId&&e.onDragSelection){const L=Math.min(B.startIndex,C),W=Math.max(B.startIndex,C),A=e.data.slice(L,W+1),H=new Set(A.map(K=>e.getItemId(K)));e.onDragSelection(H)}}},Q=()=>{m()?(f(!1),i(null),h(null)):i(null)},ie=I=>{const E=I.target;if(c(E.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const T=E.scrollHeight,B=E.scrollTop,C=E.clientHeight;T-B-C<200&&e.onLoadMore()}},ae=I=>{if(k.handleSort(I),e.onSort){const E=k.sortConfig();e.onSort(E.field,E.direction)}};return ue(()=>{document.addEventListener("mousemove",J),document.addEventListener("mouseup",Q),fe(()=>{document.removeEventListener("mousemove",J),document.removeEventListener("mouseup",Q)})}),ue(()=>{const I=t();if(!I)return;const E=new ResizeObserver(T=>{for(const B of T)p(B.contentRect.height)});E.observe(I),fe(()=>{E.disconnect()})}),(()=>{var I=Qt(),E=I.firstChild,T=E.firstChild,B=E.nextSibling;return E.addEventListener("scroll",ie),me(n,E),u(T,z(ge,{get each(){return e.columns},children:C=>(()=>{var L=en(),W=L.firstChild;return L.$$click=()=>C.sortable&&!k.isSorting()&&ae(C.key),u(W,(()=>{var A=G(()=>typeof C.title=="string");return()=>A()?(()=>{var H=tn();return u(H,()=>C.title),H})():C.title})()),u(L,z(O,{get when(){return G(()=>!!k.isSorting())()&&k.sortConfig().field===C.key},get children(){return Jt()}}),null),u(L,z(O,{get when(){return C.sortable},get children(){var A=Zt(),H=A.firstChild,K=H.nextSibling;return P(Z=>{var re=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${k.sortConfig().field===C.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,ee=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${k.sortConfig().field===C.key&&k.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,le=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${k.sortConfig().field===C.key&&k.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return Z.e=F(A,re,Z.e),Z.t=F(H,ee,Z.t),Z.a=F(K,le,Z.a),Z},{e:void 0,t:void 0,a:void 0}),A}}),null),P(A=>{var H=`grid-header-cell ${C.sortable?"sortable":""} ${C.sortable&&k.sortConfig().field===C.key?"active-sort":""}`,K=`
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
                  opacity: ${k.isSorting()&&k.sortConfig().field===C.key?"0.7":"1"};
                `;return H!==A.e&&ce(L,A.e=H),A.t=F(L,K,A.t),A},{e:void 0,t:void 0}),L})()})),u(E,z(O,{get when(){return b()},get fallback(){return(()=>{var C=Ye();return u(C,z(ge,{get each(){return e.data},children:(L,W)=>z(je,{item:L,get index(){return W()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(L)||L.id)||!1},onRowClick:M,onRowDoubleClick:r,onRowMouseDown:v,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:s,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),P(L=>F(C,`min-width: ${$()}px;`,L)),C})()},get children(){var C=Ye();return u(C,z(ge,{get each(){return d()},children:L=>(()=>{var W=et();return u(W,z(je,{get item(){return L.item},get index(){return L.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(L.item)||L.item.id)||!1},onRowClick:M,onRowDoubleClick:r,onRowMouseDown:v,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:s,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),P(A=>F(W,`
                    position: absolute;
                    top: ${L.index*s}px;
                    left: 0;
                    right: 0;
                  `,A)),W})()})),P(L=>F(C,`height: ${q()}px; position: relative; min-width: ${$()}px;`,L)),C}}),null),u(I,z(O,{get when(){return e.showPaginationStatus!==!1},get children(){var C=Gt(),L=C.firstChild,W=L.nextSibling,A=W.nextSibling,H=A.nextSibling;return H.nextSibling,u(C,y,W),u(C,w,H),u(C,U,null),u(C,z(O,{get when(){return e.isLoadingMore},get children(){return Xt()}}),null),P(K=>F(C,`
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
            min-width: ${$()}px;
          `;return L!==C.e&&ce(I,C.e=L),C.t=F(I,W,C.t),C.a=F(T,A,C.a),C},{e:void 0,t:void 0,a:void 0}),I})()}ne(["click","dblclick","mousedown","contextmenu"]);const on={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function rn(e="default"){const[t,n]=D(e),o=()=>on[t()];return{viewMode:t,setViewMode:n,cycleViewMode:()=>{const p=["compact","default","detailed"],a=(p.indexOf(t())+1)%p.length,g=p[a];g&&n(g)},getViewModeConfig:o,getRowHeight:()=>o().rowHeight}}function ln(e){const[t,n]=D(-1),o=i=>{e.onLog&&e.onLog(i)},c=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const i=document.activeElement;return i&&(i.tagName==="INPUT"||i.tagName==="TEXTAREA"||i.isContentEditable||i.getAttribute("contenteditable")==="true")},l=()=>e.getAllItems?e.getAllItems():[],p=()=>e.getSelectedItems?e.getSelectedItems():new Set,s=()=>{const i=l(),h=t();return h>=0&&h<i.length&&i[h]||null},a=()=>{const i=l();if(i.length===0)return;const h=t(),$=h<i.length-1?h+1:0;n($),o(`⌨️ Focused next item: ${$+1}/${i.length}`)},g=()=>{const i=l();if(i.length===0)return;const h=t(),$=h>0?h-1:i.length-1;n($),o(`⌨️ Focused previous item: ${$+1}/${i.length}`)},m=()=>{l().length!==0&&(n(0),o("⌨️ Focused first item"))},f=()=>{const i=l();i.length!==0&&(n(i.length-1),o("⌨️ Focused last item"))},x=i=>{if(c())return;const h=l();if(h.length!==0)switch(i.key){case"ArrowDown":{i.preventDefault(),t()===-1?m():a();break}case"ArrowUp":{i.preventDefault(),t()===-1?f():g();break}case"Home":{(i.ctrlKey||i.metaKey)&&(i.preventDefault(),m());break}case"End":{(i.ctrlKey||i.metaKey)&&(i.preventDefault(),f());break}case"PageDown":{i.preventDefault();const $=t(),k=Math.min($+10,h.length-1);n(k),o(`⌨️ Page down to item: ${k+1}/${h.length}`);break}case"PageUp":{i.preventDefault();const $=t(),k=Math.max($-10,0);n(k),o(`⌨️ Page up to item: ${k+1}/${h.length}`);break}case"Enter":{i.preventDefault();const $=s();$&&e.onPreview&&(e.onPreview($),o("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{i.preventDefault();const $=s();$&&e.onToggleSelection&&(e.onToggleSelection($),o("⌨️ Toggled selection via Space key"));break}case"a":{(i.ctrlKey||i.metaKey)&&(i.preventDefault(),e.onSelectAll&&(e.onSelectAll(h),o("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{i.preventDefault(),e.onEscape&&e.onEscape(),n(-1),o("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const $=p();if($.size>0){i.preventDefault();const M=l().filter(r=>$.has(r.id));e.onDelete&&(e.onDelete(M),o(`⌨️ Delete requested via ${i.key} key`))}break}case"Tab":{t()===-1&&h.length>0&&n(0);break}case"j":{!i.ctrlKey&&!i.metaKey&&!i.altKey&&(i.preventDefault(),t()===-1?m():a());break}case"k":{!i.ctrlKey&&!i.metaKey&&!i.altKey&&(i.preventDefault(),t()===-1?f():g());break}case"g":{i.shiftKey?(i.preventDefault(),f()):(i.preventDefault(),m());break}}};return pe(()=>{l().length>0&&t()}),pe(()=>{const i=l();t()>=i.length&&i.length>0?n(i.length-1):i.length===0&&n(-1)}),{focusedIndex:t,setFocusedIndex:n,handleKeyDown:x,focusNext:a,focusPrevious:g,focusFirst:m,focusLast:f,getFocusedItem:s}}var sn=S(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),an=S("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),dn=S("<span style=color:#94a3b8;>"),cn=S('<div title="Has thumbnails">'),un=S('<div title="Generating thumbnails...">');function tt(e){const t=()=>e.size||40,n=()=>e.borderRadius||"4px",o=gt({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var c=sn(),l=c.firstChild;return u(c,(()=>{var p=G(()=>!!o.url);return()=>p()?(()=>{var s=an();return Oe(s,"error",o.onImageError),P(a=>{var g=o.url,m=`Thumbnail for ${e.item.id.slice(0,8)}`;return g!==a.e&&te(s,"src",a.e=g),m!==a.t&&te(s,"alt",a.t=m),a},{e:void 0,t:void 0}),s})():(()=>{var s=dn();return u(s,()=>o.fallbackIcon),s})()})(),l),u(c,z(O,{get when(){return e.showIndicators!==!1},get children(){return G(()=>!!o.hasThumbnails)()?(()=>{var p=cn();return P(s=>F(p,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,s)),p})():G(()=>!!o.isRequested)()?(()=>{var p=un();return P(s=>F(p,`
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
            `,s)),p})():null}}),l),P(p=>{var s=`thumbnail ${e.className||""}`,a=`
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
      `,g=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return s!==p.e&&ce(c,p.e=s),p.t=F(c,a,p.t),g!==p.a&&te(c,"title",p.a=g),p},{e:void 0,t:void 0,a:void 0}),c})()}function nt(e){if(e===0)return"0 B";const t=1024,n=["B","KB","MB","GB","TB","PB"],o=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,o)).toFixed(2))+" "+n[o]}function fn(e){const t=new Date,n=typeof e=="string"?new Date(e):e;if(isNaN(n.getTime()))return"Invalid date";const o=t.getTime()-n.getTime(),c=Math.floor(o/1e3),l=Math.floor(c/60),p=Math.floor(l/60),s=Math.floor(p/24),a=Math.floor(s/7),g=Math.floor(s/30);if(Math.floor(s/365)>=1)return n.getFullYear().toString();const f=new Intl.RelativeTimeFormat("en",{numeric:"auto",style:"long"});return c<60?c<10?"a moment ago":f.format(-c,"second"):l<60?f.format(-l,"minute"):p<24?f.format(-p,"hour"):s<7?f.format(-s,"day"):a<4?f.format(-a,"week"):g<12?f.format(-g,"month"):n.getFullYear().toString()}function gn(e){const t=typeof e=="string"?new Date(e):e;return isNaN(t.getTime())?"Invalid date":new Intl.DateTimeFormat("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"}).format(t)}function Xe(e){return{relative:fn(e),full:gn(e)}}var pn=S("<span style=font-weight:500;>"),we=S("<span>"),mn=S("<span style=font-family:monospace;font-size:12px;>"),hn=S("<span>—"),bn=S("<button title=Controls>⋯"),xn=S('<button style="background:transparent;border:1px solid #666;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;"title="More actions">⋯');function yn(e){const{state:t,selection:n,addLog:o}=be(),c=t.loadState(),l=rn(c.viewMode||"default"),p=Ze({baseColumnVisibility:()=>t.columnVisibility()}),s=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),a=Te({items:()=>s.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig});pe(()=>{const r=t.popupPreview(),v=t.actionMenu(),b=t.bulkActionMenu(),d=t.headerActionMenu(),y=t.confirmDialog();(r?.isOpen||v?.isOpen||b?.isOpen||d?.isOpen||y?.isOpen)&&(n.isDragSelecting()||n.dragStart())&&(n.setIsDragSelecting(!1),n.setDragStart(null),n.setDragEnd(null),o("🚫 Cancelled drag selection due to modal/overlay"))});const g=ln({onPreview:r=>t.setPopupPreview({item:r,isOpen:!0}),onToggleSelection:r=>n.toggleSelection(r.id),onSelectAll:r=>n.selectAll(r),onClearSelection:()=>n.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):n.clearSelection()},onDelete:r=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${r.length} selected file${r.length!==1?"s":""}?`,items:r,onConfirm:()=>{o(`🗑️ Deleted ${r.length} items via keyboard`),n.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const r=document.activeElement;return r&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable||r.getAttribute("contenteditable")==="true")},getSelectedItems:()=>n.selectedItems(),getAllItems:()=>a.sortedData(),onLog:o}),[m,f]=D(new Set),x=r=>{m().has(r)||(f(v=>new Set([...v,r])),s.actions.getThumbnails(r),o(`🖼️ Requesting thumbnails for ${r.slice(0,8)}`))},i=(r,v,b)=>{b.shiftKey&&n.lastSelectedIndex()>=0?(b.preventDefault(),n.selectRange(n.lastSelectedIndex(),v,a.sortedData())):n.handleRowClick(r,v,b)},h=r=>{t.setPopupPreview({item:r,isOpen:!0}),o(`🖼️ Opened preview for: ${X(r)}`)},$=(r,v,b)=>{b.preventDefault(),b.stopPropagation();const d={x:b.clientX,y:b.clientY},y=n.selectedItems().size;y>1?(t.setBulkActionMenu({isOpen:!0,position:d}),o(`🖱️ Bulk context menu opened for ${y} items`)):(t.setActionMenu({item:r,isOpen:!0,position:d}),o(`🖱️ Context menu opened for: ${X(r)}`))},k=(r,v)=>{t.handleSort(r,v)},M=V(()=>{const r=p.responsiveColumnVisibility(),v=[];return r.thumbnail&&v.push({key:"thumbnail",title:"",width:60,render:b=>z(tt,{item:b,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:x,get requestedThumbnails(){return m()},showIndicators:!0})}),r.name&&v.push({key:"name",title:"Name",sortable:!0,render:b=>(()=>{var d=pn();return u(d,()=>X(b)),P(()=>te(d,"title",X(b))),d})()}),r.blob_type&&v.push({key:"blob_type",title:"Type",width:100,sortable:!0}),r.mime&&v.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:b=>(()=>{var d=we();return u(d,()=>b.mime||"unknown"),d})()}),r.id&&v.push({key:"id",title:"ID",width:200,sortable:!0,render:b=>(()=>{var d=mn();return u(d,()=>b.id),d})()}),r.size&&v.push({key:"size",title:"Size",width:100,sortable:!0,render:b=>(()=>{var d=we();return u(d,()=>nt(b.size||0)),d})()}),r.parent_blob_id&&v.push({key:"parent_blob_id",title:"Parent",width:120,render:b=>(()=>{var d=we();return u(d,()=>b.parent_blob_id?"Yes":"No"),d})()}),r.local_path&&v.push({key:"local_path",title:"Local Path",width:200,render:b=>(()=>{var d=we();return u(d,()=>b.local_path||"None"),d})()}),r.created_at&&v.push({key:"created_at",title:"Created",width:140,sortable:!0,render:b=>{const d=Xe(b.created_at);return(()=>{var y=we();return u(y,()=>d.relative),P(()=>te(y,"title",d.full)),y})()}}),r.updated_at&&v.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:b=>{if(!b.updated_at)return hn();const d=Xe(b.updated_at);return(()=>{var y=we();return u(y,()=>d.relative),P(()=>te(y,"title",d.full)),y})()}}),r.actions&&v.push({key:"actions",title:(()=>{var b=bn();return b.$$click=d=>{d.stopPropagation();const y=d.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:y.left+y.width/2,y:y.bottom+5}})},P(d=>F(b,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,d)),b})(),width:60,render:b=>(()=>{var d=xn();return d.$$click=y=>{y.stopPropagation(),y.preventDefault();const w=t.actionMenu();if(w&&w.item.id===b.id)t.setActionMenu(null),o(`⋯ Action menu closed for: ${X(b)}`);else{const U=y.target.getBoundingClientRect(),q={x:U.right-120,y:U.bottom+4};t.setActionMenu({item:b,isOpen:!0,position:q}),o(`⋯ Action menu opened for: ${X(b)}`)}},d})()}),v});return z(nn,{get data(){return a.sortedData()},get columns(){return M()},onSort:k,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return l.getRowHeight()},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return n.selectedItems()},onRowClick:i,onRowDoubleClick:h,get onRowMouseDown(){return n.handleRowMouseDown},onContextMenu:(r,v,b)=>$(r,v,b),onDragSelection:r=>{n.setSelectedItems(r),o(`📦 Selected ${r.size} items via drag`)},showPaginationStatus:!0,onLoadMore:()=>s.actions.loadMore(),get hasMore(){return s.state().hasMore},get isLoadingMore(){return s.state().isLoadingMore},get focusedIndex(){return g.focusedIndex()},showFocusIndicator:!0})}ne(["click"]);var vn=S('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),$n=S("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),wn=S("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),kn=S("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),_n=S('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),Sn=S("<div style=text-align:center;margin-bottom:24px;>"),Cn=S("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),zn=S("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),Dn=S('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function Mn(){const e=xe(),{addLog:t}=be();let n;const[o,c]=D(new Set),l=g=>{o().has(g)||(c(m=>new Set([...m,g])),t(`🖼️ Requesting thumbnails for ${g.slice(0,8)}`))},p=g=>{g.key==="Escape"&&(g.preventDefault(),e.setPopupPreview(null))},s=g=>{g.target===n&&(g.preventDefault(),g.stopPropagation(),e.setPopupPreview(null))};ue(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",p),document.addEventListener("click",s),document.body.style.overflow="hidden")}),fe(()=>{document.removeEventListener("keydown",p,!0),document.body.style.overflow=""});const a=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",p,!0),document.addEventListener("click",s,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",p,!0),document.removeEventListener("click",s,!0),document.body.style.overflow="")};return ue(()=>{const g=()=>{a(),requestAnimationFrame(g)};g()}),z(O,{get when(){return G(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var g=vn(),m=g.firstChild,f=m.firstChild;g.$$click=s;var x=n;return typeof x=="function"?me(x,g):n=g,m.$$click=i=>i.stopPropagation(),f.addEventListener("mouseleave",i=>{i.target.style.background="#ef4444"}),f.addEventListener("mouseenter",i=>{i.target.style.background="#dc2626"}),f.$$click=()=>e.setPopupPreview(null),u(m,z(O,{get when(){return e.popupPreview()?.item},children:i=>{const h=i().mime||"",$=h.startsWith("image/"),k=h.startsWith("video/"),M=h.startsWith("audio/"),r=X(i());return[(()=>{var v=Sn();return u(v,z(O,{when:$,get children(){var b=$n();return b.addEventListener("error",d=>{const y=d.target;y.style.display="none";const w=document.createElement("div");w.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${r}</div>
                            </div>
                          `,y.parentNode?.appendChild(w)}),te(b,"alt",r),P(()=>te(b,"src",`/api/blobs/${i().id}`)),b}}),null),u(v,z(O,{when:k,get children(){var b=wn(),d=b.firstChild;return te(d,"type",h),P(()=>te(d,"src",`/api/blobs/${i().id}`)),b}}),null),u(v,z(O,{when:M,get children(){var b=kn(),d=b.firstChild,y=d.nextSibling,w=y.firstChild;return u(b,z(tt,{get item(){return i()},size:200,apiBaseUrl:"/api",onRequestThumbnails:l,get requestedThumbnails(){return o()},showIndicators:!0,borderRadius:"8px"}),d),u(d,r),te(w,"type",h),P(()=>te(w,"src",`/api/blobs/${i().id}`)),b}}),null),u(v,z(O,{when:!$&&!k&&!M,get children(){var b=_n(),d=b.firstChild,y=d.nextSibling,w=y.nextSibling,U=w.firstChild;return P(()=>te(U,"href",`/api/blobs/${i().id}`)),b}}),null),v})(),(()=>{var v=Dn(),b=v.firstChild,d=b.nextSibling,y=d.firstChild,w=y.firstChild,U=w.nextSibling,q=y.nextSibling,oe=q.firstChild,J=oe.nextSibling,Q=q.nextSibling,ie=Q.firstChild,ae=ie.nextSibling,I=Q.nextSibling,E=I.firstChild,T=E.nextSibling,B=I.nextSibling,C=B.firstChild,L=C.nextSibling,W=B.nextSibling,A=W.firstChild,H=A.nextSibling,K=W.nextSibling,Z=K.firstChild,re=Z.nextSibling;return u(U,r),u(J,()=>i().id),u(ae,()=>i().sha256),u(T,()=>i().blob_type),u(L,h||"unknown"),u(H,()=>nt(i().size||0)),u(re,()=>new Date(i().created_at).toLocaleString()),u(d,z(O,{get when(){return i().parent_blob_id},get children(){var ee=Cn(),le=ee.firstChild,de=le.nextSibling;return u(de,()=>i().parent_blob_id),ee}}),null),u(d,z(O,{get when(){return i().local_path},get children(){var ee=zn(),le=ee.firstChild,de=le.nextSibling;return u(de,()=>i().local_path),ee}}),null),v})()]}}),null),g}})}ne(["click"]);var Pn=S(`<div><style>
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
        `),In=S('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),En=S('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function Ln(){const e=xe();let t;const[n,o]=D({x:0,y:0}),c=x=>{x.key==="Escape"&&(x.preventDefault(),x.stopPropagation(),e.setActionMenu(null))},l=x=>{t&&!t.contains(x.target)&&(x.preventDefault(),x.stopPropagation(),e.setActionMenu(null))},p=()=>{if(!t)return;const x=180,i=160,h=e.actionMenu()?.position;if(!h)return;const{x:$,y:k}=h;let M=$,r=k;const v=window.innerWidth,b=window.innerHeight;$+x>v&&(M=Math.max(10,v-x-10)),k+i>b&&(r=Math.max(10,k-i)),o({x:M,y:r})};pe(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",c,!0),document.addEventListener("mousedown",l,!0),setTimeout(p,0)):(document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",l,!0))}),fe(()=>{document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",l,!0)});const s=async()=>{const x=e.actionMenu()?.item;if(x){try{const i=X(x),h=document.createElement("a");h.href=`/api/blobs/${x.id}`,h.download=i,document.body.appendChild(h),h.click(),document.body.removeChild(h),console.log(`📥 Downloaded: ${i}`)}catch(i){console.error("Download failed:",i)}e.setActionMenu(null)}},a=()=>{const x=e.actionMenu()?.item;x&&(e.setPopupPreview({item:x,isOpen:!0}),e.setActionMenu(null))},g=()=>{const x=e.actionMenu()?.item;x&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[x],onConfirm:()=>{console.log(`🗑️ Deleted: ${X(x)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},m=async()=>{const x=e.actionMenu()?.item;if(x){try{const i=`${window.location.origin}/api/blobs/${x.id}`;await navigator.clipboard.writeText(i),console.log(`🔗 Copied URL for: ${X(x)}`)}catch(i){console.error("Copy URL failed:",i)}e.setActionMenu(null)}},f=x=>{const i=x.mime||"";return i.startsWith("image/")?"🖼️":i.startsWith("video/")?"🎥":i.startsWith("audio/")?"🎵":i.includes("pdf")?"📄":i.includes("text")?"📝":"📄"};return z(O,{get when(){return G(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var x=Pn(),i=x.firstChild;x.$$click=$=>$.stopPropagation();var h=t;return typeof h=="function"?me(h,x):t=x,u(x,z(O,{get when(){return e.actionMenu()?.item},children:$=>[(()=>{var k=In(),M=k.firstChild,r=M.nextSibling;return u(M,()=>f($())),u(r,()=>X($())),k})(),(()=>{var k=En(),M=k.firstChild,r=M.nextSibling,v=r.nextSibling,b=v.nextSibling,d=b.nextSibling;return M.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),M.addEventListener("mouseenter",y=>{y.target.style.background="#3a3a3a"}),M.$$click=a,r.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),r.addEventListener("mouseenter",y=>{y.target.style.background="#3a3a3a"}),r.$$click=s,v.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),v.addEventListener("mouseenter",y=>{y.target.style.background="#3a3a3a"}),v.$$click=m,d.addEventListener("mouseleave",y=>{y.target.style.background="transparent"}),d.addEventListener("mouseenter",y=>{y.target.style.background="#2a1a1a"}),d.$$click=g,k})()]}),i),P($=>F(x,`
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
        `,$)),x}})}ne(["click"]);var Tn=S(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (<!> selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
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
        `);function An(){const{state:e,selection:t}=be();let n;const[o,c]=D({x:0,y:0}),l=f=>{f.key==="Escape"&&(f.preventDefault(),f.stopPropagation(),e.setBulkActionMenu(null))},p=f=>{n&&!n.contains(f.target)&&(f.preventDefault(),f.stopPropagation(),e.setBulkActionMenu(null))},s=()=>{if(!n)return;const f=200,x=140,i=e.bulkActionMenu()?.position;if(!i)return;const{x:h,y:$}=i;let k=h,M=$;const r=window.innerWidth,v=window.innerHeight;h+f>r&&(k=Math.max(10,r-f-10)),$+x>v&&(M=Math.max(10,$-x)),c({x:k,y:M})};pe(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",l,!0),document.addEventListener("mousedown",p,!0),setTimeout(s,0)):(document.removeEventListener("keydown",l,!0),document.removeEventListener("mousedown",p,!0))}),fe(()=>{document.removeEventListener("keydown",l,!0),document.removeEventListener("mousedown",p,!0)});const a=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},g=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},m=()=>{t.clearSelection(),e.setBulkActionMenu(null)};return z(O,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var f=Tn(),x=f.firstChild,i=x.firstChild,h=i.nextSibling,$=h.firstChild,k=$.nextSibling;k.nextSibling;var M=x.nextSibling,r=M.firstChild,v=r.nextSibling,b=v.nextSibling,d=b.nextSibling;f.$$click=w=>w.stopPropagation();var y=n;return typeof y=="function"?me(y,f):n=f,u(h,()=>t.selectedItems().size,k),r.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),r.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),r.$$click=a,v.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),v.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),v.$$click=m,d.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),d.addEventListener("mouseenter",w=>{w.target.style.background="#2a1a1a"}),d.$$click=g,P(w=>F(f,`
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
        `,w)),f}})}ne(["click"]);var Fn=S("<div class=drag-selection-overlay>"),Rn=S('<div class="drag-selection-corner drag-selection-corner-tl">'),On=S('<div class="drag-selection-corner drag-selection-corner-br">');function Bn(){const e=xt(),t=V(()=>{if(!e.isDragSelecting()||!e.dragStart()||!e.dragEnd())return null;const n=e.dragStart(),o=e.dragEnd(),c=Math.min(n.x,o.x),l=Math.min(n.y,o.y),p=Math.abs(o.x-n.x),s=Math.abs(o.y-n.y);return{left:c,top:l,width:p,height:s}});return z(O,{get when(){return G(()=>!!e.isDragSelecting())()&&t()},children:n=>[(()=>{var o=Fn();return P(c=>F(o,`
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
            `,c)),o})(),(()=>{var o=Rn();return P(c=>F(o,`
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
            `,c)),o})(),(()=>{var o=On();return P(c=>F(o,`
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
            `,c)),o})()]})}var Wn=S('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),Un=S('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),Nn=S('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),Hn=S(`<style>
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
      `),Vn=S('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function qn(){const e=xe();let t,n;ue(()=>{e.confirmDialog()?.isOpen&&n&&setTimeout(()=>n?.focus(),100)});const o=l=>{e.confirmDialog()?.isOpen&&(l.key==="Escape"?(l.preventDefault(),e.setConfirmDialog(null)):l.key==="Enter"&&l.ctrlKey&&(l.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ue(()=>{document.addEventListener("keydown",o,!0)}),fe(()=>{document.removeEventListener("keydown",o,!0)});const c=l=>{l.target===t&&e.setConfirmDialog(null)};return z(O,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var l=Nn(),p=l.firstChild,s=p.firstChild,a=s.firstChild;a.firstChild;var g=s.nextSibling,m=g.nextSibling,f=m.firstChild,x=f.nextSibling;l.$$click=c;var i=t;typeof i=="function"?me(i,l):t=l,p.$$click=$=>$.stopPropagation(),u(a,()=>e.confirmDialog()?.title||"Confirm Action",null),u(g,()=>e.confirmDialog()?.message||"Are you sure?"),u(p,z(O,{get when(){return G(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var $=Wn(),k=$.firstChild,M=k.firstChild,r=M.nextSibling;return r.nextSibling,u(k,()=>e.confirmDialog()?.items?.length||0,r),u($,()=>e.confirmDialog()?.items?.map(v=>(()=>{var b=Vn(),d=b.firstChild,y=d.nextSibling,w=y.nextSibling;return u(y,()=>X(v)),u(w,(()=>{var U=G(()=>!!v.size);return()=>U()?`${Math.round(v.size/1024)}KB`:""})()),b})()),null),$}}),m),u(p,z(O,{get when(){return G(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var $=Un(),k=$.firstChild,M=k.nextSibling,r=M.firstChild,v=r.nextSibling;return v.nextSibling,u(M,()=>e.confirmDialog()?.items?.length||0,v),$}}),m),f.$$click=()=>e.setConfirmDialog(null),x.$$click=()=>e.confirmDialog()?.onConfirm?.();var h=n;return typeof h=="function"?me(h,x):n=x,l})(),Hn()]}})}ne(["click"]);var Ge=S("<span style=color:#ff00ff;font-size:12px;>●"),Kn=S('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Reset Filters</div></div></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;>default</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),Yn=S(`<style>
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
      `);function jn(){const e=xe();let t;const n=a=>{t&&!t.contains(a.target)&&(a.preventDefault(),a.stopPropagation(),e.setHeaderActionMenu(null))},o=a=>{a.key==="Escape"&&e.setHeaderActionMenu(null)};pe(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",n,!0),document.addEventListener("keydown",o)):(document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",o))}),fe(()=>{document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",o)});const c=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},l=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},p=()=>{e.setHeaderActionMenu(null)},s=()=>{e.updateFilter("name",""),e.updateFilter("mime",""),e.updateFilter("blobType",""),e.updateFilter("minSize",0),e.updateFilter("maxSize",1e8),e.updateFilter("hasParent","all"),e.updateFilter("hasLocalPath","all"),e.setHeaderActionMenu(null)};return z(O,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var a=Kn(),g=a.firstChild,m=g.firstChild;m.firstChild;var f=m.nextSibling,x=f.nextSibling,i=x.nextSibling,h=i.nextSibling;h.firstChild;var $=t;return typeof $=="function"?me($,a):t=a,m.$$click=c,u(m,z(O,{get when(){return e.isFilterPanelOpen()},get children(){return Ge()}}),null),f.$$click=s,i.$$click=p,h.$$click=l,u(h,z(O,{get when(){return e.isSettingsPanelOpen()},get children(){return Ge()}}),null),P(k=>F(a,`
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
        `,k)),a})(),Yn()]}})}ne(["click"]);var Xn=S(`<div style="display:flex;height:100vh;background:#000000;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function Gn(e){return z(bt,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return z(Qn,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function Qn(e){return(()=>{var t=Xn(),n=t.firstChild,o=n.nextSibling;return u(t,z($t,{}),n),u(t,z(qt,{}),n),u(n,z(yn,{get apiBaseUrl(){return e.apiBaseUrl}})),u(t,z(Ht,{}),o),u(t,z(Lt,{}),o),u(t,z(Ut,{}),o),u(t,z(Mn,{}),null),u(t,z(Ln,{}),null),u(t,z(An,{}),null),u(t,z(qn,{}),null),u(t,z(jn,{}),null),u(t,z(Bn,{}),null),t})()}class Jn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",n=this.getAttribute("api-base-url")||"http://localhost:8080",o=this.getAttribute("auto-connect")==="true";this.dispose=ft(()=>z(Gn,{wsUrl:t,apiBaseUrl:n,autoConnect:o}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Jn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
