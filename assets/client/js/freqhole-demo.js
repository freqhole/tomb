import{d as ie,c as z,t as _,a as Oe,b as I,e as fe,s as R,o as ge,f as pe,g as me,h as V,i as C,j as dt,u as ct,k as d,m as q,F as he,S as F,l as le,n as be,r as ut}from"./web-Bmt1sUg0.js";import{u as Le}from"./thumbnail-utils-MK6iuaLH.js";import{u as ft}from"./useThumbnail-BQwvSLyN.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Q(e){if(e.metadata&&typeof e.metadata=="object"){const t=e.metadata;if(t.originalName||t.filename||t.original_filename||t.file_name||t.name)return t.originalName||t.filename||t.original_filename||t.file_name||t.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var gt=_(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function Be(e){const[t,i]=z(!1);return(()=>{var o=gt(),c=o.firstChild,l=c.nextSibling;return o.addEventListener("mouseleave",()=>i(!1)),o.addEventListener("mouseenter",()=>i(!0)),Oe(o,"mousedown",e.onMouseDown,!0),I(p=>{var s=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,g=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `,u=`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${t()||e.isDragging?"#ff00ff":"#4a4a4a"};
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
          opacity: ${t()?"1":"0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `;return s!==p.e&&fe(o,p.e=s),p.t=R(o,g,p.t),p.a=R(c,u,p.a),p.o=R(l,h,p.o),p},{e:void 0,t:void 0,a:void 0,o:void 0}),o})()}ie(["mousedown"]);function We(e){const[t,i]=z(e.initialWidth),[o,c]=z(!1),l=e.minWidth||250,p=e.maxWidth||600,s=e.closeThreshold||100;return{width:t,setWidth:i,isDragging:o,handleMouseDown:(u,h="right")=>{u.preventDefault(),c(!0),document.body.classList.add("resizing");const f=u.clientX,b=t(),n=k=>{const y=k.clientX-f,D=h==="right"?b-y:b+y;if(D<s){e.onClose?.();return}const r=Math.max(l,Math.min(p,D));i(r),e.onWidthChange?.(r)},m=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",n),document.removeEventListener("mouseup",m)};document.addEventListener("mousemove",n),document.addEventListener("mouseup",m)}}}const Ge="freqhole-demo-state",Re=300;function Fe(){try{const e=localStorage.getItem(Ge);return e?JSON.parse(e):{}}catch{return{}}}function G(e){try{const i={...Fe(),...e};localStorage.setItem(Ge,JSON.stringify(i))}catch{}}function pt(e){const t=Fe(),[i,o]=z({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[c,l]=z({field:"created_at",direction:"desc",...t.sortConfig||{}}),[p,s]=z(t.viewMode||"default"),[g,u]=z({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[h,f]=z(t.isFilterPanelOpen??!0),[b,n]=z(t.filterPanelWidth||Re),[m,k]=z(t.isBrowsePanelOpen??!0),[y,D]=z(t.browsePanelWidth||Re),[r,v]=z(t.isSettingsPanelOpen??!1),[x,a]=z(t.settingsPanelWidth||Re),[$,w]=z(t.wsUrl||e.wsUrl),[N,j]=z(t.autoConnect??e.autoConnect),[ne,oe]=z(t.autoRefresh??!0),[ee,re]=z(t.debug??!1),[se,E]=z(null),[M,T]=z(null),[B,S]=z(null),[L,O]=z(null),[A,W]=z(null),[J,Z]=z([]),[de,te]=z("Disconnected"),[ae,ce]=z(!1),[ve,$e]=z(null);return{filterConfig:i,setFilterConfig:P=>{o(P),G({filterConfig:P})},updateFilter:(P,X)=>{o(ue=>{const Pe={...ue,[P]:X};return G({filterConfig:Pe}),Pe})},sortConfig:c,setSortConfig:P=>{l(P),G({sortConfig:P})},handleSort:(P,X)=>{const ue={field:P,direction:X};l(ue),G({sortConfig:ue})},viewMode:p,setViewMode:P=>{s(P),G({viewMode:P})},columnVisibility:g,setColumnVisibility:P=>{u(P),G({columnVisibility:P})},toggleColumn:P=>{u(X=>{const ue={...X,[P]:!X[P]};return G({columnVisibility:ue}),ue})},isFilterPanelOpen:h,setIsFilterPanelOpen:P=>{f(P),G({isFilterPanelOpen:P})},toggleFilterPanel:()=>{f(P=>{const X=!P;return G({isFilterPanelOpen:X}),X})},filterPanelWidth:b,setFilterPanelWidth:P=>{n(P),G({filterPanelWidth:P})},isBrowsePanelOpen:m,setIsBrowsePanelOpen:P=>{k(P),G({isBrowsePanelOpen:P})},toggleBrowsePanel:()=>{k(P=>{const X=!P;return G({isBrowsePanelOpen:X}),X})},browsePanelWidth:y,setBrowsePanelWidth:P=>{D(P),G({browsePanelWidth:P})},isSettingsPanelOpen:r,setIsSettingsPanelOpen:P=>{v(P),G({isSettingsPanelOpen:P})},toggleSettingsPanel:()=>{v(P=>{const X=!P;return G({isSettingsPanelOpen:X}),X})},settingsPanelWidth:x,setSettingsPanelWidth:P=>{a(P),G({settingsPanelWidth:P})},wsUrl:$,setWsUrl:w,autoConnect:N,setAutoConnect:j,autoRefresh:ne,setAutoRefresh:oe,debug:ee,setDebug:re,popupPreview:se,setPopupPreview:E,actionMenu:M,setActionMenu:T,bulkActionMenu:B,setBulkActionMenu:S,confirmDialog:L,setConfirmDialog:O,headerActionMenu:A,setHeaderActionMenu:W,logs:J,setLogs:Z,connectionStatus:de,setConnectionStatus:te,hasPendingUpdates:ae,setHasPendingUpdates:ce,lastUpdated:ve,setLastUpdated:$e,loadState:Fe,saveState:G}}function ht(e={}){const[t,i]=z(e.initialSelection||new Set),[o,c]=z(-1),[l,p]=z(!1),[s,g]=z(null),[u,h]=z(null),f=a=>{i($=>{const w=new Set($);return w.has(a)?w.delete(a):w.add(a),w})},b=(a,$,w)=>{const N=Math.min(a,$),j=Math.max(a,$),ne=w.slice(N,j+1);i(oe=>{const ee=new Set(oe);return ne.forEach(re=>ee.add(re.id)),ee})},n=()=>{i(new Set),c(-1)},m=a=>{const $=new Set(a.map(w=>w.id));i($)},k=a=>t().has(a),y=(a,$,w)=>{const N=a.id;if(w.metaKey||w.ctrlKey)w.preventDefault(),f(N),c($);else if(w.shiftKey&&o()>=0)w.preventDefault(),c($);else{if(w.detail>1)return;i(new Set([N])),c($)}},D=(a,$,w)=>{(w.shiftKey||w.ctrlKey||w.metaKey)&&w.preventDefault(),w.button===0&&!w.metaKey&&!w.ctrlKey&&!w.shiftKey&&(w.preventDefault(),g({x:w.clientX,y:w.clientY,startIndex:$}),p(!0))},r=a=>{const $=a.target,w=$&&($.tagName==="INPUT"||$.tagName==="TEXTAREA"||$.isContentEditable||$.getAttribute("contenteditable")==="true");a.key==="Escape"?n():a.key==="a"&&(a.metaKey||a.ctrlKey)?w||a.preventDefault():(a.key==="Delete"||a.key==="Backspace")&&!w&&t().size>0&&e.onDelete?.(t())},v=a=>{l()&&s()&&h({x:a.clientX,y:a.clientY,endIndex:-1})},x=()=>{l()&&(p(!1),g(null),h(null))};return ge(()=>{document.addEventListener("mousemove",v),document.addEventListener("mouseup",x),document.addEventListener("keydown",r)}),pe(()=>{document.removeEventListener("mousemove",v),document.removeEventListener("mouseup",x),document.removeEventListener("keydown",r),document.body.classList.remove("drag-selecting")}),me(()=>{l()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),me(()=>{const a=t();e.onSelectionChange?.(a),e.saveToStorage?.(a)}),{selectedItems:t,setSelectedItems:i,lastSelectedIndex:o,setLastSelectedIndex:c,isDragSelecting:l,setIsDragSelecting:p,dragStart:s,setDragStart:g,dragEnd:u,setDragEnd:h,toggleSelection:f,selectRange:b,clearSelection:n,selectAll:m,isSelected:k,handleRowClick:y,handleRowMouseDown:D,handleKeyDown:r}}function Te(e){const t=V(()=>{const s=e.filterConfig(),g=e.sortConfig(),u=e.items().filter(f=>{if(s.name&&!Q(f).toLowerCase().includes(s.name.toLowerCase()))return!1;if(s.mime){if(!f.mime)return!1;if(!s.mime.includes("/")){if(!f.mime.toLowerCase().startsWith(s.mime.toLowerCase()+"/"))return!1}else if(f.mime!==s.mime)return!1}return!(s.blobType&&f.blob_type!==s.blobType||f.size&&(f.size<s.minSize||f.size>s.maxSize)||s.hasParent==="yes"&&!f.parent_blob_id||s.hasParent==="no"&&f.parent_blob_id||s.hasLocalPath==="yes"&&!f.local_path||s.hasLocalPath==="no"&&f.local_path)});if(!g.field)return{filtered:u,sorted:u};const h=[...u].sort((f,b)=>{let n,m;if(g.field==="name"?(n=Q(f),m=Q(b)):(n=f[g.field],m=b[g.field]),n==null&&m==null)return 0;if(n==null)return g.direction==="desc"?-1:1;if(m==null)return g.direction==="desc"?1:-1;if(n instanceof Date&&m instanceof Date)n=n.getTime(),m=m.getTime();else if(g.field==="created_at"||g.field==="updated_at"){if(n&&typeof n=="string"){const y=new Date(n);n=isNaN(y.getTime())?0:y.getTime()}else n=0;if(m&&typeof m=="string"){const y=new Date(m);m=isNaN(y.getTime())?0:y.getTime()}else m=0}else typeof n=="string"&&typeof m=="string"?(n=n.toLowerCase(),m=m.toLowerCase()):typeof n=="number"&&typeof m=="number"||(n=String(n||"").toLowerCase(),m=String(m||"").toLowerCase());let k=0;return n<m?k=-1:n>m&&(k=1),g.direction==="desc"?-k:k});return{filtered:u,sorted:h}}),i=V(()=>t().filtered),o=V(()=>t().sorted),c=V(()=>[...new Set(e.items().map(s=>s.mime?.split("/")[0]).filter(Boolean))].sort()),l=V(()=>[...new Set(e.items().map(g=>g.blob_type))].filter(Boolean).sort()),p=V(()=>({totalCount:e.items().length,filteredCount:i().length,hiddenCount:e.items().length-i().length}));return{filteredData:i,sortedData:o,mimeCategories:c,blobTypes:l,stats:p}}const Qe=dt(),mt=e=>{const t=pt({wsUrl:e.wsUrl,autoConnect:e.autoConnect}),i=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>i.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),c=g=>{const u=new Date().toLocaleTimeString(),h=t.logs();t.setLogs([`${u}: ${g}`,...h.slice(0,49)]),t.debug()&&console.log(`[FreqholeDemo] ${u}: ${g}`)},l=t.loadState(),p=ht({onSelectionChange:g=>{t.saveState({selectedItems:g})},onDelete:g=>{const u=o.sortedData().filter(h=>g.has(h.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${u.length} selected file${u.length!==1?"s":""}?`,items:u,onConfirm:()=>{c(`🗑️ Deleted ${u.length} selected items`),p.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:g=>{},initialSelection:new Set(l.selectedItems?Array.from(l.selectedItems||[]):[])}),s=V(()=>({state:t,selection:p,addLog:c}));return C(Qe.Provider,{get value(){return s()},get children(){return e.children}})};function xe(){const e=ct(Qe);if(!e)throw new Error("useFreqholeAppContext must be used within a FreqholeStateProvider");return e}function ye(){return xe().state}function bt(){return xe().selection}var xt=_(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>📁 Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),yt=_('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Quick Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><div style=margin-top:8px;font-size:12px;color:#666;><div style=margin-bottom:4px;>💡 Quick Tips:</div><div style=margin-left:8px;line-height:1.4;>• Type to search filenames<br>• Use * for wildcards<br>• Case insensitive search</div></div><div style="margin-top:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=font-size:12px;color:#888;>'),vt=_("<span style=color:#00ff00;>🔍 Searching for:"),$t=_('<span style=color:#ffffff;font-weight:600;>"<!>"'),wt=_("<span style=color:#888;>Type to start searching...");function kt(){const e=ye(),t=(o,c)=>{e.updateFilter(o,c)},i=We({initialWidth:e.browsePanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:o=>e.setBrowsePanelWidth(o),onClose:()=>e.toggleBrowsePanel()});return(()=>{var o=xt(),c=o.firstChild,l=c.firstChild,p=l.nextSibling,s=c.nextSibling;return p.$$click=()=>e.toggleBrowsePanel(),d(o,(()=>{var g=q(()=>!!e.isBrowsePanelOpen());return()=>g()&&(()=>{var u=yt(),h=u.firstChild,f=h.nextSibling,b=f.nextSibling,n=b.nextSibling,m=n.firstChild;return f.$$input=k=>t("name",k.currentTarget.value),d(m,(()=>{var k=q(()=>!!e.filterConfig().name);return()=>k()?[vt()," ",(()=>{var y=$t(),D=y.firstChild,r=D.nextSibling;return r.nextSibling,d(y,()=>e.filterConfig().name,r),y})()]:wt()})()),I(()=>f.value=e.filterConfig().name),u})()})(),s),d(o,C(Be,{position:"right",get isDragging(){return i.isDragging()},onMouseDown:g=>i.handleMouseDown(g,"left")}),s),I(g=>{var u=`browse-panel ${e.isBrowsePanelOpen()?"":"collapsed"} ${i.isDragging()?"resizing":""}`,h=`
        width: ${e.isBrowsePanelOpen()?i.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isBrowsePanelOpen()?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return u!==g.e&&fe(o,g.e=u),g.t=R(o,h,g.t),g},{e:void 0,t:void 0}),o})()}ie(["click","input"]);var _t=_('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),St=_("<div>"),Ct=_("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),zt=_('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const Dt=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function Mt(e){return(()=>{var t=St();return d(t,C(he,{each:Dt,children:i=>{const o=i.key,c=e.columnVisibility[o],l=e.hiddenColumns?.includes(i.key),p=e.responsiveColumnVisibility?.[o]??c;return(()=>{var s=Ct(),g=s.firstChild,u=g.firstChild,h=u.nextSibling;return u.addEventListener("change",()=>e.onColumnToggle(o)),u.checked=c,d(h,()=>i.title),d(g,l&&(()=>{var f=zt();return I(()=>le(f,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),f})(),null),I(f=>R(h,`
                    font-size: 14px;
                    color: ${p?"#e0e0e0":"#888"};
                    ${!p&&c?"text-decoration: line-through;":""}
                  `,f)),s})()}}),null),d(t,C(F,{get when(){return e.onResetToDefaults},get children(){var i=_t();return Oe(i,"click",e.onResetToDefaults,!0),i}}),null),I(()=>fe(t,`column-manager ${e.className||""}`)),t})()}ie(["click"]);const Pt={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Je(e){const[t,i]=z(window.innerWidth),o=()=>({...Pt,...e.columnConfig}),c=()=>{const h=e.baseColumnVisibility(),f=o(),b=t(),n={...h};return Object.entries(f).forEach(([m,k])=>{const y=m;h[y]&&b<k.minWidth&&(n[y]=!1)}),n},l=h=>o()[h]?.priority||0,p=()=>{const h=e.baseColumnVisibility(),f=o(),b=t();return Object.entries(f).filter(([n,m])=>h[n]&&b<m.minWidth).map(([n])=>n).sort((n,m)=>l(n)-l(m))},s=()=>{const h=e.baseColumnVisibility(),f=o();return Math.max(...Object.entries(h).filter(([,b])=>b).map(([b])=>f[b]?.minWidth||0))},g=()=>{const h=t();return h<400?{name:"small mobile",size:"xs"}:h<768?{name:"mobile",size:"sm"}:h<1024?{name:"tablet",size:"md"}:h<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},u=()=>{i(window.innerWidth)};return ge(()=>{window.addEventListener("resize",u)}),pe(()=>{window.removeEventListener("resize",u)}),{screenWidth:t,responsiveColumnVisibility:c,getColumnPriority:l,getHiddenColumns:p,getMinimumWidthForAllColumns:s,getBreakpointInfo:g,setScreenWidth:i}}var It=_(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Et=_('<div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>bytes</span></div></div><div class=filter-section style=margin-bottom:24px;><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">Quick Size Filters</h4><div style=display:flex;flex-wrap:wrap;gap:6px;><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&lt; 1MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">1-10MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&gt; 10MB</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">👁️ Column Visibility</h3><button class=toggle-button style="width:100%;padding:8px 12px;background:#333333;border:1px solid #555555;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"><span>Manage Columns</span><span style=transform:rotate(90deg);font-size:12px;></span></button></div><div class=filter-section style="margin-bottom:24px;padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">📊 Results</h4><p style=margin:0;font-size:14px;color:#ffffff;>Showing <span style=color:#00ff00;font-weight:600;></span> of <span style=color:#888;></span> total files'),qe=_("<option>"),Lt=_("<div style=margin-top:12px;>"),Tt=_("<span style=color:#ff9900;> files filtered out");function At(){const e=ye(),[t,i]=z(!1),o=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),c=Te({items:()=>o.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),l=Je({baseColumnVisibility:()=>e.columnVisibility()}),p=V(()=>c.mimeCategories()),s=V(()=>c.blobTypes()),g=(f,b)=>{e.updateFilter(f,b)},u=f=>{e.toggleColumn(f)},h=We({initialWidth:e.filterPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:f=>e.setFilterPanelWidth(f),onClose:()=>e.toggleFilterPanel()});return(()=>{var f=It(),b=f.firstChild,n=b.firstChild,m=n.nextSibling,k=b.nextSibling;return m.$$click=()=>e.toggleFilterPanel(),d(f,(()=>{var y=q(()=>!!e.isFilterPanelOpen());return()=>y()&&(()=>{var D=Et(),r=D.firstChild,v=r.firstChild,x=v.nextSibling,a=r.nextSibling,$=a.firstChild,w=$.nextSibling;w.firstChild;var N=a.nextSibling,j=N.firstChild,ne=j.nextSibling;ne.firstChild;var oe=N.nextSibling,ee=oe.firstChild,re=ee.nextSibling,se=re.firstChild,E=se.nextSibling,M=E.nextSibling,T=oe.nextSibling,B=T.firstChild,S=B.nextSibling,L=S.firstChild,O=L.nextSibling,A=O.nextSibling,W=T.nextSibling,J=W.firstChild,Z=J.nextSibling,de=Z.firstChild,te=de.nextSibling,ae=W.nextSibling,ce=ae.firstChild,ve=ce.nextSibling,$e=ve.firstChild,Se=$e.nextSibling,Me=Se.nextSibling,we=Me.nextSibling;return we.nextSibling,x.$$input=H=>g("name",H.currentTarget.value),w.addEventListener("change",H=>g("mime",H.currentTarget.value)),d(w,C(he,{get each(){return p()},children:H=>(()=>{var Y=qe();return Y.value=H,d(Y,H),Y})()}),null),ne.addEventListener("change",H=>g("blobType",H.currentTarget.value)),d(ne,C(he,{get each(){return s()},children:H=>(()=>{var Y=qe();return Y.value=H,d(Y,H),Y})()}),null),se.$$input=H=>g("minSize",parseInt(H.currentTarget.value)||0),M.$$input=H=>g("maxSize",parseInt(H.currentTarget.value)||0),L.$$click=()=>{g("minSize",0),g("maxSize",1024*1024)},O.$$click=()=>{g("minSize",1024*1024),g("maxSize",10*1024*1024)},A.$$click=()=>{g("minSize",10*1024*1024),g("maxSize",0)},Z.$$click=()=>i(!t()),d(te,()=>t()?"▼":"▶"),d(W,(()=>{var H=q(()=>!!t());return()=>H()&&(()=>{var Y=Lt();return d(Y,C(Mt,{get columnVisibility(){return e.columnVisibility()},onColumnToggle:u,get responsiveColumnVisibility(){return l.responsiveColumnVisibility()},get hiddenColumns(){return l.getHiddenColumns()},get breakpointInfo(){return l.getBreakpointInfo()}})),Y})()})(),null),d(Se,()=>c.filteredData().length),d(we,()=>o.state().items.length),d(ve,(()=>{var H=q(()=>c.filteredData().length<o.state().items.length);return()=>H()&&(()=>{var Y=Tt(),Ce=Y.firstChild;return d(Y,()=>o.state().items.length-c.filteredData().length,Ce),Y})()})(),null),I(()=>x.value=e.filterConfig().name),I(()=>w.value=e.filterConfig().mime),I(()=>ne.value=e.filterConfig().blobType),I(()=>se.value=e.filterConfig().minSize||""),I(()=>M.value=e.filterConfig().maxSize||""),D})()})(),k),d(f,C(Be,{position:"right",get isDragging(){return h.isDragging()},onMouseDown:y=>h.handleMouseDown(y,"left")}),k),I(y=>{var D=`filter-panel ${e.isFilterPanelOpen()?"":"collapsed"} ${h.isDragging()?"resizing":""}`,r=`
        width: ${e.isFilterPanelOpen()?h.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isFilterPanelOpen()?"20px":"0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return D!==y.e&&fe(f,y.e=D),y.t=R(f,r,y.t),y},{e:void 0,t:void 0}),f})()}ie(["click","input"]);var Rt=_(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings & Debug</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Ft=_("<div style=font-size:11px;color:#666;>Last update: "),Ot=_('<div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">⏳ Pending Updates</h3><div style="padding:12px;background:#2a1a00;border:1px solid #5a3400;border-radius:4px;margin-bottom:12px;"><p style="margin:0 0 8px 0;font-size:14px;color:#ffaa00;"> updates waiting</p><p style=margin:0;font-size:12px;color:#cc8800;>Click below to apply pending changes</p></div><button style="width:100%;padding:10px;background:#aa6600;border:1px solid #cc8800;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">✅ Apply Updates (<!>)'),Bt=_("<div style=color:#666;font-style:italic;>No activity yet..."),Wt=_('<button style="width:100%;padding:6px;background:#333;border:1px solid #555;border-radius:4px;color:#888;font-size:12px;cursor:pointer;margin-top:8px;transition:all 0.2s;">Clear Log'),Ut=_('<div style=overflow-y:auto;min-width:0;><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔌 WebSocket Connection</h3><div style="margin-bottom:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;><span style=font-size:12px;color:#888;>Status:</span><span></span></div></div><input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:12px;box-sizing:border-box;"><div style=display:flex;gap:8px;margin-bottom:12px;><button>Connect</button><button>Disconnect</button></div><button style="width:100%;padding:8px;background:#0066cc;border:1px solid #0088ff;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;">🔄 Refresh Data</button></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🤖 Automatic Settings</h3><div style=display:flex;flex-direction:column;gap:8px;><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-connect on load</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-refresh data</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Enable debug mode</span></label></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📊 Data Statistics</h3><div style="padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;"><div><div style=color:#888;font-size:12px;>Total Files</div><div style=color:#ffffff;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Filtered</div><div style=color:#00ff00;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Hidden</div><div style=color:#ff9900;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Memory</div><div style=color:#888;font-weight:600;font-size:12px;>~<!>KB</div></div></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📜 Activity Log</h3><div style="max-height:200px;overflow-y:auto;background:#0a0a0a;border:1px solid #333;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;line-height:1.3;"></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ff4444;">⚠️ Danger Zone</h3><div style="padding:12px;background:#2a0000;border:1px solid #5a0000;border-radius:4px;margin-bottom:12px;"><p style=margin:0;font-size:12px;color:#ff8888;>This will clear all settings, filters, and cached data. The page will reload.</p></div><button style="width:100%;padding:10px;background:#aa0000;border:1px solid #dd0000;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Reset All Data'),Nt=_("<div style=color:#ccc;margin-bottom:2px;word-break:break-all;>");function Ht(){const{state:e,addLog:t}=xe(),i=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),o=Te({items:()=>i.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),c=()=>i.state().connectionStatus,l=()=>i.state().hasPendingUpdates,p=()=>i.state().lastUpdated,s=()=>{i.actions.connect(),t("🔌 Connecting to WebSocket...")},g=()=>{i.actions.disconnect(),t("🔌 Disconnecting from WebSocket...")},u=()=>{t("🔄 Refreshing data..."),i.actions.refresh()},h=()=>{i.actions.applyPendingUpdates(),t("✅ Applied pending updates")},f=()=>{e.setAutoConnect(!e.autoConnect()),t(`🔧 Auto-connect: ${e.autoConnect()?"ON":"OFF"}`)},b=()=>{e.setAutoRefresh(!e.autoRefresh()),t(`🔧 Auto-refresh: ${e.autoRefresh()?"ON":"OFF"}`)},n=()=>{e.setDebug(!e.debug()),t(`🐛 Debug: ${e.debug()?"ON":"OFF"}`)},m=()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},k=We({initialWidth:e.settingsPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:y=>e.setSettingsPanelWidth(y),onClose:()=>e.toggleSettingsPanel()});return(()=>{var y=Rt(),D=y.firstChild,r=D.firstChild,v=r.nextSibling,x=D.nextSibling;return v.$$click=()=>e.toggleSettingsPanel(),d(y,(()=>{var a=q(()=>!!e.isSettingsPanelOpen());return()=>a()&&(()=>{var $=Ut(),w=$.firstChild,N=w.firstChild,j=N.nextSibling,ne=j.firstChild,oe=ne.firstChild,ee=oe.nextSibling,re=j.nextSibling,se=re.nextSibling,E=se.firstChild,M=E.nextSibling,T=se.nextSibling,B=w.nextSibling,S=B.firstChild,L=S.nextSibling,O=L.firstChild,A=O.firstChild,W=O.nextSibling,J=W.firstChild,Z=W.nextSibling,de=Z.firstChild,te=B.nextSibling,ae=te.firstChild,ce=ae.nextSibling,ve=ce.firstChild,$e=ve.firstChild,Se=$e.firstChild,Me=Se.nextSibling,we=$e.nextSibling,H=we.firstChild,Y=H.nextSibling,Ce=we.nextSibling,P=Ce.firstChild,X=P.nextSibling,ue=Ce.nextSibling,Pe=ue.firstChild,Ue=Pe.nextSibling,nt=Ue.firstChild,Ne=nt.nextSibling;Ne.nextSibling;var Ae=te.nextSibling,it=Ae.firstChild,He=it.nextSibling,ot=Ae.nextSibling,rt=ot.firstChild,st=rt.nextSibling,lt=st.nextSibling;return d(ee,()=>c().toUpperCase()),d(j,C(F,{get when(){return p()},get children(){var U=Ft();return U.firstChild,d(U,()=>p()?.toLocaleTimeString(),null),U}}),null),re.$$input=U=>e.setWsUrl(U.currentTarget.value),E.$$click=s,M.$$click=g,T.$$click=u,A.addEventListener("change",f),J.addEventListener("change",b),de.addEventListener("change",n),d($,C(F,{get when(){return l()},get children(){var U=Ot(),ke=U.firstChild,ze=ke.nextSibling,Ie=ze.firstChild,Ee=Ie.firstChild,De=ze.nextSibling,at=De.firstChild,Ve=at.nextSibling;return Ve.nextSibling,d(Ie,()=>i.state().pendingUpdates.length,Ee),De.$$click=h,d(De,()=>i.state().pendingUpdates.length,Ve),U}}),te),d(Me,()=>i.state().items.length),d(Y,()=>o.filteredData().length),d(X,()=>i.state().items.length-o.filteredData().length),d(Ue,()=>Math.round(i.state().items.length*.5),Ne),d(He,C(F,{get when(){return e.logs().length===0},get children(){return Bt()}}),null),d(He,C(he,{get each(){return e.logs()},children:U=>(()=>{var ke=Nt();return d(ke,U),ke})()}),null),d(Ae,C(F,{get when(){return e.logs().length>0},get children(){var U=Wt();return U.$$click=()=>e.setLogs([]),U}}),null),lt.$$click=m,I(U=>{var ke=`
                  font-size: 12px;
                  font-weight: 600;
                  color: ${c()==="connected"?"#00ff00":c()==="connecting"?"#ffaa00":"#ff4444"};
                `,ze=c()==="connected",Ie=`
                  flex: 1;
                  padding: 8px;
                  background: ${c()==="connected"?"#333":"#00aa00"};
                  border: 1px solid ${c()==="connected"?"#555":"#00dd00"};
                  border-radius: 4px;
                  color: ${c()==="connected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${c()==="connected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `,Ee=c()==="disconnected",De=`
                  flex: 1;
                  padding: 8px;
                  background: ${c()==="disconnected"?"#333":"#aa0000"};
                  border: 1px solid ${c()==="disconnected"?"#555":"#dd0000"};
                  border-radius: 4px;
                  color: ${c()==="disconnected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${c()==="disconnected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `;return U.e=R(ee,ke,U.e),ze!==U.t&&(E.disabled=U.t=ze),U.a=R(E,Ie,U.a),Ee!==U.o&&(M.disabled=U.o=Ee),U.i=R(M,De,U.i),U},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),I(()=>re.value=e.wsUrl()),I(()=>A.checked=e.autoConnect()),I(()=>J.checked=e.autoRefresh()),I(()=>de.checked=e.debug()),$})()})(),x),d(y,C(Be,{position:"left",get isDragging(){return k.isDragging()},onMouseDown:a=>k.handleMouseDown(a,"right")}),x),I(a=>{var $=`settings-panel ${e.isSettingsPanelOpen()?"":"collapsed"} ${k.isDragging()?"resizing":""}`,w=`
        width: ${e.isSettingsPanelOpen()?k.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isSettingsPanelOpen()?"20px":"0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
        order: 3;
      `;return $!==a.e&&fe(y,a.e=$),a.t=R(y,w,a.t),a},{e:void 0,t:void 0}),y})()}ie(["click","input"]);var Vt=_(`<div class="edge-toggle-button edge-toggle-left"title="Show Browse panel"style="position:fixed;top:50%;left:0;transform:translateY(-50%);width:24px;height:80px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:0 8px 8px 0;cursor:pointer;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.2s ease;color:#888;font-size:12px;font-weight:500;user-select:none;box-shadow:0 2px 8px rgba(0, 0, 0, 0.3);overflow:hidden;"><div class=arrow-container>→</div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;>Browse</div><style>
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
        `);function qt(){const e=ye(),[t,i]=z(!1),o=()=>!e.isBrowsePanelOpen(),c=()=>e.toggleBrowsePanel();return C(F,{get when(){return o()},get children(){var l=Vt(),p=l.firstChild;return p.nextSibling,l.addEventListener("mouseleave",()=>i(!1)),l.addEventListener("mouseenter",()=>i(!0)),l.$$click=c,I(s=>R(p,`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `,s)),l}})}ie(["click"]);var Kt=_(`<div class=selection-toolbar style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;animation:slideUp 0.3s ease-out;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><button class="toolbar-button primary"title="Download selected files"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download</button><button class="toolbar-button secondary"title="More actions"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More</button><button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×</button><style>
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
        `);function jt(){const{selection:e,state:t,addLog:i}=xe(),o=()=>{const s=e.selectedItems().size;i(`📥 Downloading ${s} selected items`)},c=s=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const u=s.target.getBoundingClientRect(),h={x:u.left+u.width/2-100,y:u.top-10};t.setBulkActionMenu({isOpen:!0,position:h});const f=e.selectedItems().size;i(`⋯ Bulk action menu opened for ${f} items`)}},l=()=>{const s=e.selectedItems().size;e.clearSelection(),i(`🗑️ Cleared selection of ${s} items`)},p=()=>e.selectedItems().size;return C(F,{get when(){return p()>1},get children(){var s=Kt(),g=s.firstChild,u=g.firstChild,h=u.nextSibling;h.nextSibling;var f=g.nextSibling,b=f.nextSibling,n=b.nextSibling;return d(g,p,u),d(g,()=>p()===1?"":"s",h),f.$$click=o,b.$$click=c,n.$$click=l,s}})}ie(["click"]);const K={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},Yt=(e,t,i)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const o=e[i],c=t[i];if(o==null&&c==null)return 0;if(o==null)return 1;if(c==null)return-1;if(i==="name"){const u=Q(e),h=Q(t);return u.localeCompare(h,void 0,{numeric:!0,sensitivity:"base"})}if(i.includes("_at")||i.includes("date")||i.includes("time")){const u=new Date(o),h=new Date(c);if(!isNaN(u.getTime())&&!isNaN(h.getTime()))return u.getTime()-h.getTime()}const l=Number(o),p=Number(c);if(!isNaN(l)&&!isNaN(p)&&typeof o=="number"&&typeof c=="number")return l-p;if(i==="size"&&typeof o=="string"&&typeof c=="string"){const u=Ke(o),h=Ke(c);if(u!==null&&h!==null)return u-h}const s=String(o).toLowerCase(),g=String(c).toLowerCase();return i==="name"||i.includes("filename")?s.localeCompare(g,void 0,{numeric:!0,sensitivity:"base"}):s.localeCompare(g)},Ke=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const i=parseFloat(t[1]),o=(t[2]||"B").toUpperCase(),c={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return i*(c[o]||1)};function Xt(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[i,o]=z(e.initialSort||t),[c,l]=z(new Set),[p,s]=z(!1),[g,u]=z(!1),h=e.getItemId||(r=>r.id||String(r)),f=V(()=>{const r=i(),v=[...e.data];return v.length>1e3&&(u(!0),setTimeout(()=>u(!1),100)),v.sort((x,a)=>{const $=Yt(x,a,r.field);return r.direction==="desc"?$*-1:$})});return{sortConfig:i,selectedItems:c,isDragSelecting:p,isSorting:g,sortedData:f,handleSort:r=>{const v=i();if(v.field===r)if(r===t.field){const x=v.direction==="asc"?"desc":"asc";o({field:r,direction:x})}else v.direction==="asc"?o({field:r,direction:"desc"}):v.direction==="desc"?o(t):o({field:r,direction:"asc"});else{const x=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc";o({field:r,direction:x})}},toggleSelection:r=>{const v=new Set(c());v.has(r)?v.delete(r):v.add(r),l(v)},clearSelection:()=>{l(new Set)},selectAll:()=>{const r=new Set(e.data.map(h));l(r)},isSelected:r=>c().has(r),selectRange:(r,v)=>{const x=new Set(c()),a=Math.min(r,v),$=Math.max(r,v);for(let w=a;w<=$;w++)if(w<e.data.length&&e.data[w]!=null){const N=h(e.data[w]);x.add(N)}l(x)},setIsDragSelecting:s,getItemId:h}}var Ze=_("<div>"),Gt=_("<div class=grid-cell>"),je=_("<div class=grid-content>"),Qt=_("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Jt=_("<div class=grid-stats>Showing rows <!>-<!> of "),Zt=_("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),en=_('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),tn=_('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),nn=_("<div><div style=font-weight:500;flex:1;>"),on=_("<span>");function Ye(e){let t;ge(()=>{e.onRowMount&&e.onRowMount(e.item)});const i=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var o=Ze();o.$$contextmenu=l=>e.onContextMenu?.(e.item,e.index,l),o.$$mousedown=l=>e.onRowMouseDown?.(e.item,e.index,l),o.$$dblclick=l=>e.onRowDoubleClick?.(e.item,e.index,l),o.$$click=l=>e.onRowClick?.(e.item,e.index,l);var c=t;return typeof c=="function"?be(c,o):t=o,d(o,C(he,{get each(){return e.columns},children:l=>(()=>{var p=Gt();return d(p,(()=>{var s=q(()=>!!l.render);return()=>s()?l.render(e.item,e.index):String(e.item[l.key]||"")})()),I(s=>R(p,`
              flex: ${l.width?"0 0 "+l.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${l.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${l.className==="sticky-actions-column"?"0":"auto"};
              background: ${l.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":K.colors.background:"transparent"};
              ${l.className==="sticky-actions-column"?"border-left: 1px solid "+K.colors.border+";":""}
              box-shadow: ${l.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${l.className==="sticky-actions-column"?"5":"1"};
            `,s)),p})()})),I(l=>{var p=`grid-row ${e.isSelected?"selected":""} ${i()?"focused":""}`,s=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${K.colors.border};
        background: ${e.isSelected?K.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${i()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return p!==l.e&&fe(o,l.e=p),l.t=R(o,s,l.t),l},{e:void 0,t:void 0}),o})()}function rn(e){const[t,i]=z(),[o,c]=z(0),[l,p]=z(0),s=e.rowHeight||50,g=e.headerHeight||60,u=e.virtualizeThreshold||100,[h,f]=z(!1),[b,n]=z(null),[,m]=z(null),k=V(()=>e.columns.reduce((E,M)=>E+(M.width||200),0)),y=Xt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),D=(E,M,T)=>{e.onRowClick?.(E,M,T)},r=(E,M,T)=>{h()&&(f(!1),n(null),m(null)),e.onRowDoubleClick?.(E,M,T)},v=(E,M,T)=>{T.button===0&&!T.metaKey&&!T.ctrlKey&&!T.shiftKey&&(T.preventDefault(),n({x:T.clientX,y:T.clientY,startIndex:M})),e.onRowMouseDown?.(E,M,T)},x=V(()=>e.data.length>u),a=V(()=>{if(!x())return e.data.map((A,W)=>({item:A,index:W}));if(!t())return[];const M=s,T=o(),B=l(),S=Math.floor(T/M),L=Math.min(e.data.length-1,Math.ceil((T+B)/M)+5),O=[];for(let A=Math.max(0,S-5);A<=L;A++)A<e.data.length&&e.data[A]!=null&&O.push({item:e.data[A],index:A});return O}),$=V(()=>e.data.length===0?0:t()?Math.floor(o()/s)+1:1),w=V(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const M=l()-g,T=Math.floor(M/s),B=Math.floor(o()/s)+T;return Math.min(B,e.data.length)}),N=V(()=>e.data.length),j=V(()=>e.data.length*s),ne=(E,M)=>{const T=t();if(!T)return-1;const B=T.getBoundingClientRect(),L=M-B.top+T.scrollTop-g;if(L<0)return-1;const O=Math.floor(L/s);return Math.max(0,Math.min(e.data.length-1,O))},oe=E=>{const M=document.body.style.overflow==="hidden",T=document.body.classList.contains("modal-open");if(M||T){(h()||b())&&(f(!1),n(null),m(null));return}const B=b();if(B&&!h()&&Math.sqrt(Math.pow(E.clientX-B.x,2)+Math.pow(E.clientY-B.y,2))>5&&f(!0),h()&&B){const S=ne(E.clientX,E.clientY);if(m({x:E.clientX,y:E.clientY,endIndex:S}),S>=0&&e.getItemId&&e.onDragSelection){const L=Math.min(B.startIndex,S),O=Math.max(B.startIndex,S),A=e.data.slice(L,O+1),W=new Set(A.map(J=>e.getItemId(J)));e.onDragSelection(W)}}},ee=()=>{h()?(f(!1),n(null),m(null)):n(null)},re=E=>{const M=E.target;if(c(M.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const T=M.scrollHeight,B=M.scrollTop,S=M.clientHeight;T-B-S<200&&e.onLoadMore()}},se=E=>{if(y.handleSort(E),e.onSort){const M=y.sortConfig();e.onSort(M.field,M.direction)}};return ge(()=>{document.addEventListener("mousemove",oe),document.addEventListener("mouseup",ee),pe(()=>{document.removeEventListener("mousemove",oe),document.removeEventListener("mouseup",ee)})}),ge(()=>{const E=t();if(!E)return;const M=new ResizeObserver(T=>{for(const B of T)p(B.contentRect.height)});M.observe(E),pe(()=>{M.disconnect()})}),(()=>{var E=Zt(),M=E.firstChild,T=M.firstChild,B=M.nextSibling;return M.addEventListener("scroll",re),be(i,M),d(T,C(he,{get each(){return e.columns},children:S=>(()=>{var L=nn(),O=L.firstChild;return L.$$click=()=>S.sortable&&!y.isSorting()&&se(S.key),d(O,(()=>{var A=q(()=>typeof S.title=="string");return()=>A()?(()=>{var W=on();return d(W,()=>S.title),W})():S.title})()),d(L,C(F,{get when(){return q(()=>!!y.isSorting())()&&y.sortConfig().field===S.key},get children(){return en()}}),null),d(L,C(F,{get when(){return S.sortable},get children(){var A=tn(),W=A.firstChild,J=W.nextSibling;return I(Z=>{var de=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${y.sortConfig().field===S.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,te=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${y.sortConfig().field===S.key&&y.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,ae=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${y.sortConfig().field===S.key&&y.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return Z.e=R(A,de,Z.e),Z.t=R(W,te,Z.t),Z.a=R(J,ae,Z.a),Z},{e:void 0,t:void 0,a:void 0}),A}}),null),I(A=>{var W=`grid-header-cell ${S.sortable?"sortable":""} ${S.sortable&&y.sortConfig().field===S.key?"active-sort":""}`,J=`
                  flex: ${S.width?"0 0 "+S.width+"px":"1"};
                  padding: 8px 12px;
                  cursor: ${S.sortable?"pointer":"default"};
                  user-select: none;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  transition: all 0.15s ease;
                  border-radius: 4px;
                  margin: 4px 2px;
                  position: ${S.className==="sticky-actions-column"?"sticky":"relative"};
                  right: ${S.className==="sticky-actions-column"?"0":"auto"};
                  background: ${S.className==="sticky-actions-column"?K.colors.header:"transparent"};
                  ${S.className==="sticky-actions-column"?"border-left: 1px solid "+K.colors.border+";":""}
                  box-shadow: ${S.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.2)":"none"};
                  z-index: ${S.className==="sticky-actions-column"?"5":"1"};
                  opacity: ${y.isSorting()&&y.sortConfig().field===S.key?"0.7":"1"};
                `;return W!==A.e&&fe(L,A.e=W),A.t=R(L,J,A.t),A},{e:void 0,t:void 0}),L})()})),d(M,C(F,{get when(){return x()},get fallback(){return(()=>{var S=je();return d(S,C(he,{get each(){return e.data},children:(L,O)=>C(Ye,{item:L,get index(){return O()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(L)||L.id)||!1},onRowClick:D,onRowDoubleClick:r,onRowMouseDown:v,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:s,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),I(L=>R(S,`min-width: ${k()}px;`,L)),S})()},get children(){var S=je();return d(S,C(he,{get each(){return a()},children:L=>(()=>{var O=Ze();return d(O,C(Ye,{get item(){return L.item},get index(){return L.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(L.item)||L.item.id)||!1},onRowClick:D,onRowDoubleClick:r,onRowMouseDown:v,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:s,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),I(A=>R(O,`
                    position: absolute;
                    top: ${L.index*s}px;
                    left: 0;
                    right: 0;
                  `,A)),O})()})),I(L=>R(S,`height: ${j()}px; position: relative; min-width: ${k()}px;`,L)),S}}),null),d(E,C(F,{get when(){return e.showPaginationStatus!==!1},get children(){var S=Jt(),L=S.firstChild,O=L.nextSibling,A=O.nextSibling,W=A.nextSibling;return W.nextSibling,d(S,$,O),d(S,w,W),d(S,N,null),d(S,C(F,{get when(){return e.isLoadingMore},get children(){return Qt()}}),null),I(J=>R(S,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${K.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,J)),S}}),B),d(B,()=>`
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

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${K.colors.selected};
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
      `),I(S=>{var L=`infinite-data-grid ${e.className||""} ${h()?"drag-selecting":""}`,O=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${K.colors.background};
        color: ${K.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,A=`
            height: ${g}px;
            display: flex;
            align-items: center;
            background: ${K.colors.header};
            border-bottom: 2px solid ${K.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${k()}px;
          `;return L!==S.e&&fe(E,S.e=L),S.t=R(E,O,S.t),S.a=R(T,A,S.a),S},{e:void 0,t:void 0,a:void 0}),E})()}ie(["click","dblclick","mousedown","contextmenu"]);const sn={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function ln(e="default"){const[t,i]=z(e),o=()=>sn[t()];return{viewMode:t,setViewMode:i,cycleViewMode:()=>{const p=["compact","default","detailed"],g=(p.indexOf(t())+1)%p.length,u=p[g];u&&i(u)},getViewModeConfig:o,getRowHeight:()=>o().rowHeight}}function an(e){const[t,i]=z(-1),o=n=>{e.onLog&&e.onLog(n)},c=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const n=document.activeElement;return n&&(n.tagName==="INPUT"||n.tagName==="TEXTAREA"||n.isContentEditable||n.getAttribute("contenteditable")==="true")},l=()=>e.getAllItems?e.getAllItems():[],p=()=>e.getSelectedItems?e.getSelectedItems():new Set,s=()=>{const n=l(),m=t();return m>=0&&m<n.length&&n[m]||null},g=()=>{const n=l();if(n.length===0)return;const m=t(),k=m<n.length-1?m+1:0;i(k),o(`⌨️ Focused next item: ${k+1}/${n.length}`)},u=()=>{const n=l();if(n.length===0)return;const m=t(),k=m>0?m-1:n.length-1;i(k),o(`⌨️ Focused previous item: ${k+1}/${n.length}`)},h=()=>{l().length!==0&&(i(0),o("⌨️ Focused first item"))},f=()=>{const n=l();n.length!==0&&(i(n.length-1),o("⌨️ Focused last item"))},b=n=>{if(c())return;const m=l();if(m.length!==0)switch(n.key){case"ArrowDown":{n.preventDefault(),t()===-1?h():g();break}case"ArrowUp":{n.preventDefault(),t()===-1?f():u();break}case"Home":{(n.ctrlKey||n.metaKey)&&(n.preventDefault(),h());break}case"End":{(n.ctrlKey||n.metaKey)&&(n.preventDefault(),f());break}case"PageDown":{n.preventDefault();const k=t(),y=Math.min(k+10,m.length-1);i(y),o(`⌨️ Page down to item: ${y+1}/${m.length}`);break}case"PageUp":{n.preventDefault();const k=t(),y=Math.max(k-10,0);i(y),o(`⌨️ Page up to item: ${y+1}/${m.length}`);break}case"Enter":{n.preventDefault();const k=s();k&&e.onPreview&&(e.onPreview(k),o("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{n.preventDefault();const k=s();k&&e.onToggleSelection&&(e.onToggleSelection(k),o("⌨️ Toggled selection via Space key"));break}case"a":{(n.ctrlKey||n.metaKey)&&(n.preventDefault(),e.onSelectAll&&(e.onSelectAll(m),o("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{n.preventDefault(),e.onEscape&&e.onEscape(),i(-1),o("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const k=p();if(k.size>0){n.preventDefault();const D=l().filter(r=>k.has(r.id));e.onDelete&&(e.onDelete(D),o(`⌨️ Delete requested via ${n.key} key`))}break}case"Tab":{t()===-1&&m.length>0&&i(0);break}case"j":{!n.ctrlKey&&!n.metaKey&&!n.altKey&&(n.preventDefault(),t()===-1?h():g());break}case"k":{!n.ctrlKey&&!n.metaKey&&!n.altKey&&(n.preventDefault(),t()===-1?f():u());break}case"g":{n.shiftKey?(n.preventDefault(),f()):(n.preventDefault(),h());break}}};return me(()=>{l().length>0&&t()}),me(()=>{const n=l();t()>=n.length&&n.length>0?i(n.length-1):n.length===0&&i(-1)}),{focusedIndex:t,setFocusedIndex:i,handleKeyDown:b,focusNext:g,focusPrevious:u,focusFirst:h,focusLast:f,getFocusedItem:s}}var dn=_(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),cn=_("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),un=_("<span style=color:#94a3b8;>"),fn=_('<div title="Has thumbnails">'),gn=_('<div title="Generating thumbnails...">');function et(e){const t=()=>e.size||40,i=()=>e.borderRadius||"4px",o=ft({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var c=dn(),l=c.firstChild;return d(c,(()=>{var p=q(()=>!!o.url);return()=>p()?(()=>{var s=cn();return Oe(s,"error",o.onImageError),I(g=>{var u=o.url,h=`Thumbnail for ${e.item.id.slice(0,8)}`;return u!==g.e&&le(s,"src",g.e=u),h!==g.t&&le(s,"alt",g.t=h),g},{e:void 0,t:void 0}),s})():(()=>{var s=un();return d(s,()=>o.fallbackIcon),s})()})(),l),d(c,C(F,{get when(){return e.showIndicators!==!1},get children(){return q(()=>!!o.hasThumbnails)()?(()=>{var p=fn();return I(s=>R(p,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,s)),p})():q(()=>!!o.isRequested)()?(()=>{var p=gn();return I(s=>R(p,`
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
            `,s)),p})():null}}),l),I(p=>{var s=`thumbnail ${e.className||""}`,g=`
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
      `,u=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return s!==p.e&&fe(c,p.e=s),p.t=R(c,g,p.t),u!==p.a&&le(c,"title",p.a=u),p},{e:void 0,t:void 0,a:void 0}),c})()}function tt(e){if(e===0)return"0 B";const t=1024,i=["B","KB","MB","GB","TB","PB"],o=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,o)).toFixed(2))+" "+i[o]}var pn=_("<span style=font-weight:500;>"),_e=_("<span>"),hn=_("<span style=font-family:monospace;font-size:12px;>"),mn=_("<button title=Controls>⋯"),bn=_('<button style="background:transparent;border:1px solid #666;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;"title="More actions">⋯');function xn(e){const{state:t,selection:i,addLog:o}=xe(),c=t.loadState(),l=ln(c.viewMode||"default"),p=Je({baseColumnVisibility:()=>t.columnVisibility()}),s=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),g=Te({items:()=>s.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig});me(()=>{const r=t.popupPreview(),v=t.actionMenu(),x=t.bulkActionMenu(),a=t.headerActionMenu(),$=t.confirmDialog();(r?.isOpen||v?.isOpen||x?.isOpen||a?.isOpen||$?.isOpen)&&(i.isDragSelecting()||i.dragStart())&&(i.setIsDragSelecting(!1),i.setDragStart(null),i.setDragEnd(null),o("🚫 Cancelled drag selection due to modal/overlay"))});const u=an({onPreview:r=>t.setPopupPreview({item:r,isOpen:!0}),onToggleSelection:r=>i.toggleSelection(r.id),onSelectAll:r=>i.selectAll(r),onClearSelection:()=>i.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):i.clearSelection()},onDelete:r=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${r.length} selected file${r.length!==1?"s":""}?`,items:r,onConfirm:()=>{o(`🗑️ Deleted ${r.length} items via keyboard`),i.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const r=document.activeElement;return r&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable||r.getAttribute("contenteditable")==="true")},getSelectedItems:()=>i.selectedItems(),getAllItems:()=>g.sortedData(),onLog:o}),[h,f]=z(new Set),b=r=>{h().has(r)||(f(v=>new Set([...v,r])),s.actions.getThumbnails(r),o(`🖼️ Requesting thumbnails for ${r.slice(0,8)}`))},n=(r,v,x)=>{x.shiftKey&&i.lastSelectedIndex()>=0?(x.preventDefault(),i.selectRange(i.lastSelectedIndex(),v,g.sortedData())):i.handleRowClick(r,v,x)},m=r=>{t.setPopupPreview({item:r,isOpen:!0}),o(`🖼️ Opened preview for: ${Q(r)}`)},k=(r,v,x)=>{x.preventDefault(),x.stopPropagation();const a={x:x.clientX,y:x.clientY},$=i.selectedItems().size;$>1?(t.setBulkActionMenu({isOpen:!0,position:a}),o(`🖱️ Bulk context menu opened for ${$} items`)):(t.setActionMenu({item:r,isOpen:!0,position:a}),o(`🖱️ Context menu opened for: ${Q(r)}`))},y=(r,v)=>{t.handleSort(r,v)},D=V(()=>{const r=p.responsiveColumnVisibility(),v=[];return r.thumbnail&&v.push({key:"thumbnail",title:"",width:60,render:x=>C(et,{item:x,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:b,get requestedThumbnails(){return h()},showIndicators:!0})}),r.name&&v.push({key:"name",title:"Name",sortable:!0,render:x=>(()=>{var a=pn();return d(a,()=>Q(x)),I(()=>le(a,"title",Q(x))),a})()}),r.blob_type&&v.push({key:"blob_type",title:"Type",width:100,sortable:!0}),r.mime&&v.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:x=>(()=>{var a=_e();return d(a,()=>x.mime||"unknown"),a})()}),r.id&&v.push({key:"id",title:"ID",width:200,sortable:!0,render:x=>(()=>{var a=hn();return d(a,()=>x.id),a})()}),r.size&&v.push({key:"size",title:"Size",width:100,sortable:!0,render:x=>(()=>{var a=_e();return d(a,()=>tt(x.size||0)),a})()}),r.parent_blob_id&&v.push({key:"parent_blob_id",title:"Parent",width:120,render:x=>(()=>{var a=_e();return d(a,()=>x.parent_blob_id?"Yes":"No"),a})()}),r.local_path&&v.push({key:"local_path",title:"Local Path",width:200,render:x=>(()=>{var a=_e();return d(a,()=>x.local_path||"None"),a})()}),r.created_at&&v.push({key:"created_at",title:"Created",width:140,sortable:!0,render:x=>(()=>{var a=_e();return d(a,()=>new Date(x.created_at).toLocaleString()),a})()}),r.updated_at&&v.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:x=>(()=>{var a=_e();return d(a,(()=>{var $=q(()=>!!x.updated_at);return()=>$()?new Date(x.updated_at).toLocaleString():"—"})()),a})()}),r.actions&&v.push({key:"actions",title:(()=>{var x=mn();return x.$$click=a=>{a.stopPropagation();const $=a.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:$.left+$.width/2,y:$.bottom+5}})},I(a=>R(x,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,a)),x})(),width:60,render:x=>(()=>{var a=bn();return a.$$click=$=>{$.stopPropagation(),$.preventDefault();const w=t.actionMenu();if(w&&w.item.id===x.id)t.setActionMenu(null),o(`⋯ Action menu closed for: ${Q(x)}`);else{const N=$.target.getBoundingClientRect(),j={x:N.right-120,y:N.bottom+4};t.setActionMenu({item:x,isOpen:!0,position:j}),o(`⋯ Action menu opened for: ${Q(x)}`)}},a})()}),v});return C(rn,{get data(){return g.sortedData()},get columns(){return D()},onSort:y,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return l.getRowHeight()},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return i.selectedItems()},onRowClick:n,onRowDoubleClick:m,get onRowMouseDown(){return i.handleRowMouseDown},onContextMenu:(r,v,x)=>k(r,v,x),onDragSelection:r=>{i.setSelectedItems(r),o(`📦 Selected ${r.size} items via drag`)},showPaginationStatus:!0,onLoadMore:()=>s.actions.loadMore(),get hasMore(){return s.state().hasMore},get isLoadingMore(){return s.state().isLoadingMore},get focusedIndex(){return u.focusedIndex()},showFocusIndicator:!0})}ie(["click"]);var yn=_('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),vn=_("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),$n=_("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),wn=_("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),kn=_('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),_n=_("<div style=text-align:center;margin-bottom:24px;>"),Sn=_("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),Cn=_("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),zn=_('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function Dn(){const e=ye(),{addLog:t}=xe();let i;const[o,c]=z(new Set),l=u=>{o().has(u)||(c(h=>new Set([...h,u])),t(`🖼️ Requesting thumbnails for ${u.slice(0,8)}`))},p=u=>{u.key==="Escape"&&(u.preventDefault(),e.setPopupPreview(null))},s=u=>{u.target===i&&(u.preventDefault(),u.stopPropagation(),e.setPopupPreview(null))};ge(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",p),document.addEventListener("click",s),document.body.style.overflow="hidden")}),pe(()=>{document.removeEventListener("keydown",p,!0),document.body.style.overflow=""});const g=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",p,!0),document.addEventListener("click",s,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",p,!0),document.removeEventListener("click",s,!0),document.body.style.overflow="")};return ge(()=>{const u=()=>{g(),requestAnimationFrame(u)};u()}),C(F,{get when(){return q(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var u=yn(),h=u.firstChild,f=h.firstChild;u.$$click=s;var b=i;return typeof b=="function"?be(b,u):i=u,h.$$click=n=>n.stopPropagation(),f.addEventListener("mouseleave",n=>{n.target.style.background="#ef4444"}),f.addEventListener("mouseenter",n=>{n.target.style.background="#dc2626"}),f.$$click=()=>e.setPopupPreview(null),d(h,C(F,{get when(){return e.popupPreview()?.item},children:n=>{const m=n().mime||"",k=m.startsWith("image/"),y=m.startsWith("video/"),D=m.startsWith("audio/"),r=Q(n());return[(()=>{var v=_n();return d(v,C(F,{when:k,get children(){var x=vn();return x.addEventListener("error",a=>{const $=a.target;$.style.display="none";const w=document.createElement("div");w.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${r}</div>
                            </div>
                          `,$.parentNode?.appendChild(w)}),le(x,"alt",r),I(()=>le(x,"src",`/api/blobs/${n().id}`)),x}}),null),d(v,C(F,{when:y,get children(){var x=$n(),a=x.firstChild;return le(a,"type",m),I(()=>le(a,"src",`/api/blobs/${n().id}`)),x}}),null),d(v,C(F,{when:D,get children(){var x=wn(),a=x.firstChild,$=a.nextSibling,w=$.firstChild;return d(x,C(et,{get item(){return n()},size:200,apiBaseUrl:"/api",onRequestThumbnails:l,get requestedThumbnails(){return o()},showIndicators:!0,borderRadius:"8px"}),a),d(a,r),le(w,"type",m),I(()=>le(w,"src",`/api/blobs/${n().id}`)),x}}),null),d(v,C(F,{when:!k&&!y&&!D,get children(){var x=kn(),a=x.firstChild,$=a.nextSibling,w=$.nextSibling,N=w.firstChild;return I(()=>le(N,"href",`/api/blobs/${n().id}`)),x}}),null),v})(),(()=>{var v=zn(),x=v.firstChild,a=x.nextSibling,$=a.firstChild,w=$.firstChild,N=w.nextSibling,j=$.nextSibling,ne=j.firstChild,oe=ne.nextSibling,ee=j.nextSibling,re=ee.firstChild,se=re.nextSibling,E=ee.nextSibling,M=E.firstChild,T=M.nextSibling,B=E.nextSibling,S=B.firstChild,L=S.nextSibling,O=B.nextSibling,A=O.firstChild,W=A.nextSibling,J=O.nextSibling,Z=J.firstChild,de=Z.nextSibling;return d(N,r),d(oe,()=>n().id),d(se,()=>n().sha256),d(T,()=>n().blob_type),d(L,m||"unknown"),d(W,()=>tt(n().size||0)),d(de,()=>new Date(n().created_at).toLocaleString()),d(a,C(F,{get when(){return n().parent_blob_id},get children(){var te=Sn(),ae=te.firstChild,ce=ae.nextSibling;return d(ce,()=>n().parent_blob_id),te}}),null),d(a,C(F,{get when(){return n().local_path},get children(){var te=Cn(),ae=te.firstChild,ce=ae.nextSibling;return d(ce,()=>n().local_path),te}}),null),v})()]}}),null),u}})}ie(["click"]);var Mn=_(`<div><style>
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
        `),Pn=_('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),In=_('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function En(){const e=ye();let t;const[i,o]=z({x:0,y:0}),c=b=>{b.key==="Escape"&&(b.preventDefault(),b.stopPropagation(),e.setActionMenu(null))},l=b=>{t&&!t.contains(b.target)&&(b.preventDefault(),b.stopPropagation(),e.setActionMenu(null))},p=()=>{if(!t)return;const b=180,n=160,m=e.actionMenu()?.position;if(!m)return;const{x:k,y}=m;let D=k,r=y;const v=window.innerWidth,x=window.innerHeight;k+b>v&&(D=Math.max(10,v-b-10)),y+n>x&&(r=Math.max(10,y-n)),o({x:D,y:r})};me(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",c,!0),document.addEventListener("mousedown",l,!0),setTimeout(p,0)):(document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",l,!0))}),pe(()=>{document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",l,!0)});const s=async()=>{const b=e.actionMenu()?.item;if(b){try{const n=Q(b),m=document.createElement("a");m.href=`/api/blobs/${b.id}`,m.download=n,document.body.appendChild(m),m.click(),document.body.removeChild(m),console.log(`📥 Downloaded: ${n}`)}catch(n){console.error("Download failed:",n)}e.setActionMenu(null)}},g=()=>{const b=e.actionMenu()?.item;b&&(e.setPopupPreview({item:b,isOpen:!0}),e.setActionMenu(null))},u=()=>{const b=e.actionMenu()?.item;b&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[b],onConfirm:()=>{console.log(`🗑️ Deleted: ${Q(b)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},h=async()=>{const b=e.actionMenu()?.item;if(b){try{const n=`${window.location.origin}/api/blobs/${b.id}`;await navigator.clipboard.writeText(n),console.log(`🔗 Copied URL for: ${Q(b)}`)}catch(n){console.error("Copy URL failed:",n)}e.setActionMenu(null)}},f=b=>{const n=b.mime||"";return n.startsWith("image/")?"🖼️":n.startsWith("video/")?"🎥":n.startsWith("audio/")?"🎵":n.includes("pdf")?"📄":n.includes("text")?"📝":"📄"};return C(F,{get when(){return q(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var b=Mn(),n=b.firstChild;b.$$click=k=>k.stopPropagation();var m=t;return typeof m=="function"?be(m,b):t=b,d(b,C(F,{get when(){return e.actionMenu()?.item},children:k=>[(()=>{var y=Pn(),D=y.firstChild,r=D.nextSibling;return d(D,()=>f(k())),d(r,()=>Q(k())),y})(),(()=>{var y=In(),D=y.firstChild,r=D.nextSibling,v=r.nextSibling,x=v.nextSibling,a=x.nextSibling;return D.addEventListener("mouseleave",$=>{$.target.style.background="transparent"}),D.addEventListener("mouseenter",$=>{$.target.style.background="#3a3a3a"}),D.$$click=g,r.addEventListener("mouseleave",$=>{$.target.style.background="transparent"}),r.addEventListener("mouseenter",$=>{$.target.style.background="#3a3a3a"}),r.$$click=s,v.addEventListener("mouseleave",$=>{$.target.style.background="transparent"}),v.addEventListener("mouseenter",$=>{$.target.style.background="#3a3a3a"}),v.$$click=h,a.addEventListener("mouseleave",$=>{$.target.style.background="transparent"}),a.addEventListener("mouseenter",$=>{$.target.style.background="#2a1a1a"}),a.$$click=u,y})()]}),n),I(k=>R(b,`
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
        `,k)),b}})}ie(["click"]);var Ln=_(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (<!> selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
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
        `);function Tn(){const{state:e,selection:t}=xe();let i;const[o,c]=z({x:0,y:0}),l=f=>{f.key==="Escape"&&(f.preventDefault(),f.stopPropagation(),e.setBulkActionMenu(null))},p=f=>{i&&!i.contains(f.target)&&(f.preventDefault(),f.stopPropagation(),e.setBulkActionMenu(null))},s=()=>{if(!i)return;const f=200,b=140,n=e.bulkActionMenu()?.position;if(!n)return;const{x:m,y:k}=n;let y=m,D=k;const r=window.innerWidth,v=window.innerHeight;m+f>r&&(y=Math.max(10,r-f-10)),k+b>v&&(D=Math.max(10,k-b)),c({x:y,y:D})};me(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",l,!0),document.addEventListener("mousedown",p,!0),setTimeout(s,0)):(document.removeEventListener("keydown",l,!0),document.removeEventListener("mousedown",p,!0))}),pe(()=>{document.removeEventListener("keydown",l,!0),document.removeEventListener("mousedown",p,!0)});const g=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},u=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},h=()=>{t.clearSelection(),e.setBulkActionMenu(null)};return C(F,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var f=Ln(),b=f.firstChild,n=b.firstChild,m=n.nextSibling,k=m.firstChild,y=k.nextSibling;y.nextSibling;var D=b.nextSibling,r=D.firstChild,v=r.nextSibling,x=v.nextSibling,a=x.nextSibling;f.$$click=w=>w.stopPropagation();var $=i;return typeof $=="function"?be($,f):i=f,d(m,()=>t.selectedItems().size,y),r.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),r.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),r.$$click=g,v.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),v.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),v.$$click=h,a.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),a.addEventListener("mouseenter",w=>{w.target.style.background="#2a1a1a"}),a.$$click=u,I(w=>R(f,`
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
        `,w)),f}})}ie(["click"]);var An=_("<div class=drag-selection-overlay>"),Rn=_('<div class="drag-selection-corner drag-selection-corner-tl">'),Fn=_('<div class="drag-selection-corner drag-selection-corner-br">');function On(){const e=bt(),t=V(()=>{if(!e.isDragSelecting()||!e.dragStart()||!e.dragEnd())return null;const i=e.dragStart(),o=e.dragEnd(),c=Math.min(i.x,o.x),l=Math.min(i.y,o.y),p=Math.abs(o.x-i.x),s=Math.abs(o.y-i.y);return{left:c,top:l,width:p,height:s}});return C(F,{get when(){return q(()=>!!e.isDragSelecting())()&&t()},children:i=>[(()=>{var o=An();return I(c=>R(o,`
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
            `,c)),o})(),(()=>{var o=Rn();return I(c=>R(o,`
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
            `,c)),o})(),(()=>{var o=Fn();return I(c=>R(o,`
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
            `,c)),o})()]})}var Bn=_('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),Wn=_('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),Un=_('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),Nn=_(`<style>
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
      `),Hn=_('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function Vn(){const e=ye();let t,i;ge(()=>{e.confirmDialog()?.isOpen&&i&&setTimeout(()=>i?.focus(),100)});const o=l=>{e.confirmDialog()?.isOpen&&(l.key==="Escape"?(l.preventDefault(),e.setConfirmDialog(null)):l.key==="Enter"&&l.ctrlKey&&(l.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ge(()=>{document.addEventListener("keydown",o,!0)}),pe(()=>{document.removeEventListener("keydown",o,!0)});const c=l=>{l.target===t&&e.setConfirmDialog(null)};return C(F,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var l=Un(),p=l.firstChild,s=p.firstChild,g=s.firstChild;g.firstChild;var u=s.nextSibling,h=u.nextSibling,f=h.firstChild,b=f.nextSibling;l.$$click=c;var n=t;typeof n=="function"?be(n,l):t=l,p.$$click=k=>k.stopPropagation(),d(g,()=>e.confirmDialog()?.title||"Confirm Action",null),d(u,()=>e.confirmDialog()?.message||"Are you sure?"),d(p,C(F,{get when(){return q(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var k=Bn(),y=k.firstChild,D=y.firstChild,r=D.nextSibling;return r.nextSibling,d(y,()=>e.confirmDialog()?.items?.length||0,r),d(k,()=>e.confirmDialog()?.items?.map(v=>(()=>{var x=Hn(),a=x.firstChild,$=a.nextSibling,w=$.nextSibling;return d($,()=>Q(v)),d(w,(()=>{var N=q(()=>!!v.size);return()=>N()?`${Math.round(v.size/1024)}KB`:""})()),x})()),null),k}}),h),d(p,C(F,{get when(){return q(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var k=Wn(),y=k.firstChild,D=y.nextSibling,r=D.firstChild,v=r.nextSibling;return v.nextSibling,d(D,()=>e.confirmDialog()?.items?.length||0,v),k}}),h),f.$$click=()=>e.setConfirmDialog(null),b.$$click=()=>e.confirmDialog()?.onConfirm?.();var m=i;return typeof m=="function"?be(m,b):i=b,l})(),Nn()]}})}ie(["click"]);var Xe=_("<span style=color:#ff00ff;font-size:12px;>●"),qn=_('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;>default</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),Kn=_(`<style>
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
      `);function jn(){const e=ye();let t;const i=s=>{t&&!t.contains(s.target)&&(s.preventDefault(),s.stopPropagation(),e.setHeaderActionMenu(null))},o=s=>{s.key==="Escape"&&e.setHeaderActionMenu(null)};me(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",i,!0),document.addEventListener("keydown",o)):(document.removeEventListener("mousedown",i,!0),document.removeEventListener("keydown",o))}),pe(()=>{document.removeEventListener("mousedown",i,!0),document.removeEventListener("keydown",o)});const c=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},l=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},p=()=>{e.setHeaderActionMenu(null)};return C(F,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var s=qn(),g=s.firstChild,u=g.firstChild;u.firstChild;var h=u.nextSibling,f=h.nextSibling;f.firstChild;var b=t;return typeof b=="function"?be(b,s):t=s,u.$$click=c,d(u,C(F,{get when(){return e.isFilterPanelOpen()},get children(){return Xe()}}),null),h.$$click=p,f.$$click=l,d(f,C(F,{get when(){return e.isSettingsPanelOpen()},get children(){return Xe()}}),null),I(n=>R(s,`
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
        `,n)),s})(),Kn()]}})}ie(["click"]);var Yn=_(`<div style="display:flex;height:100vh;background:#000000;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function Xn(e){return C(mt,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return C(Gn,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function Gn(e){return(()=>{var t=Yn(),i=t.firstChild,o=i.nextSibling;return d(t,C(kt,{}),i),d(t,C(jt,{}),i),d(i,C(xn,{get apiBaseUrl(){return e.apiBaseUrl}})),d(t,C(qt,{}),o),d(t,C(At,{}),o),d(t,C(Ht,{}),o),d(t,C(Dn,{}),null),d(t,C(En,{}),null),d(t,C(Tn,{}),null),d(t,C(Vn,{}),null),d(t,C(jn,{}),null),d(t,C(On,{}),null),t})()}class Qn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",i=this.getAttribute("api-base-url")||"http://localhost:8080",o=this.getAttribute("auto-connect")==="true";this.dispose=ut(()=>C(Xn,{wsUrl:t,apiBaseUrl:i,autoConnect:o}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Qn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
