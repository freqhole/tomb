import{d as J,c as M,t as _,a as Be,b as P,e as le,s as T,o as ce,f as fe,g as he,h as H,i as S,j as at,u as dt,k as c,m as N,F as de,S as R,l as Z,n as ue,r as ct}from"./web-Bmt1sUg0.js";import{u as Le}from"./thumbnail-utils-MK6iuaLH.js";import{u as ut}from"./useThumbnail-BQwvSLyN.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function X(e){if(e.metadata&&typeof e.metadata=="object"){const t=e.metadata;if(t.originalName||t.filename||t.original_filename||t.file_name||t.name)return t.originalName||t.filename||t.original_filename||t.file_name||t.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var ft=_(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function Oe(e){const[t,n]=M(!1);return(()=>{var i=ft(),a=i.firstChild,s=a.nextSibling;return i.addEventListener("mouseleave",()=>n(!1)),i.addEventListener("mouseenter",()=>n(!0)),Be(i,"mousedown",e.onMouseDown,!0),P(g=>{var l=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,f=`
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
        `,d=`
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
        `;return l!==g.e&&le(i,g.e=l),g.t=T(i,f,g.t),g.a=T(a,u,g.a),g.o=T(s,d,g.o),g},{e:void 0,t:void 0,a:void 0,o:void 0}),i})()}J(["mousedown"]);function We(e){const[t,n]=M(e.initialWidth),[i,a]=M(!1),s=e.minWidth||250,g=e.maxWidth||600,l=e.closeThreshold||100;return{width:t,setWidth:n,isDragging:i,handleMouseDown:(u,d="right")=>{u.preventDefault(),a(!0),document.body.classList.add("resizing");const p=u.clientX,b=t(),o=y=>{const x=y.clientX-p,z=d==="right"?b-x:b+x;if(z<l){e.onClose?.();return}const r=Math.max(s,Math.min(g,z));n(r),e.onWidthChange?.(r)},m=()=>{a(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",o),document.removeEventListener("mouseup",m)};document.addEventListener("mousemove",o),document.addEventListener("mouseup",m)}}}const Ge="freqhole-demo-state",Re=300;function Fe(){try{const e=localStorage.getItem(Ge);return e?JSON.parse(e):{}}catch{return{}}}function Y(e){try{const n={...Fe(),...e};localStorage.setItem(Ge,JSON.stringify(n))}catch{}}function pt(e){const t=Fe(),[n,i]=M({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[a,s]=M({field:"created_at",direction:"desc",...t.sortConfig||{}}),[g,l]=M(t.viewMode||"default"),[f,u]=M({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[d,p]=M(t.isFilterPanelOpen??!0),[b,o]=M(t.filterPanelWidth||Re),[m,y]=M(t.isBrowsePanelOpen??!0),[x,z]=M(t.browsePanelWidth||Re),[r,w]=M(t.isSettingsPanelOpen??!1),[$,h]=M(t.settingsPanelWidth||Re),[k,v]=M(t.wsUrl||e.wsUrl),[D,A]=M(t.autoConnect??e.autoConnect),[W,C]=M(t.autoRefresh??!0),[E,F]=M(t.debug??!1),[L,O]=M(null),[G,K]=M(null),[ee,oe]=M(null),[te,re]=M(null),[ae,Q]=M(null),[ne,ie]=M([]),[me,ge]=M("Disconnected"),[we,ke]=M(!1),[be,xe]=M(null);return{filterConfig:n,setFilterConfig:I=>{i(I),Y({filterConfig:I})},updateFilter:(I,j)=>{i(se=>{const Pe={...se,[I]:j};return Y({filterConfig:Pe}),Pe})},sortConfig:a,setSortConfig:I=>{s(I),Y({sortConfig:I})},handleSort:(I,j)=>{const se={field:I,direction:j};s(se),Y({sortConfig:se})},viewMode:g,setViewMode:I=>{l(I),Y({viewMode:I})},columnVisibility:f,setColumnVisibility:I=>{u(I),Y({columnVisibility:I})},toggleColumn:I=>{u(j=>{const se={...j,[I]:!j[I]};return Y({columnVisibility:se}),se})},isFilterPanelOpen:d,setIsFilterPanelOpen:I=>{p(I),Y({isFilterPanelOpen:I})},toggleFilterPanel:()=>{p(I=>{const j=!I;return Y({isFilterPanelOpen:j}),j})},filterPanelWidth:b,setFilterPanelWidth:I=>{o(I),Y({filterPanelWidth:I})},isBrowsePanelOpen:m,setIsBrowsePanelOpen:I=>{y(I),Y({isBrowsePanelOpen:I})},toggleBrowsePanel:()=>{y(I=>{const j=!I;return Y({isBrowsePanelOpen:j}),j})},browsePanelWidth:x,setBrowsePanelWidth:I=>{z(I),Y({browsePanelWidth:I})},isSettingsPanelOpen:r,setIsSettingsPanelOpen:I=>{w(I),Y({isSettingsPanelOpen:I})},toggleSettingsPanel:()=>{w(I=>{const j=!I;return Y({isSettingsPanelOpen:j}),j})},settingsPanelWidth:$,setSettingsPanelWidth:I=>{h(I),Y({settingsPanelWidth:I})},wsUrl:k,setWsUrl:v,autoConnect:D,setAutoConnect:A,autoRefresh:W,setAutoRefresh:C,debug:E,setDebug:F,popupPreview:L,setPopupPreview:O,actionMenu:G,setActionMenu:K,bulkActionMenu:ee,setBulkActionMenu:oe,confirmDialog:te,setConfirmDialog:re,headerActionMenu:ae,setHeaderActionMenu:Q,logs:ne,setLogs:ie,connectionStatus:me,setConnectionStatus:ge,hasPendingUpdates:we,setHasPendingUpdates:ke,lastUpdated:be,setLastUpdated:xe,loadState:Fe,saveState:Y}}function gt(e={}){const[t,n]=M(e.initialSelection||new Set),[i,a]=M(-1),[s,g]=M(!1),[l,f]=M(null),[u,d]=M(null),p=h=>{n(k=>{const v=new Set(k);return v.has(h)?v.delete(h):v.add(h),v})},b=(h,k,v)=>{const D=Math.min(h,k),A=Math.max(h,k),W=v.slice(D,A+1);n(C=>{const E=new Set(C);return W.forEach(F=>E.add(F.id)),E})},o=()=>{n(new Set),a(-1)},m=h=>{const k=new Set(h.map(v=>v.id));n(k)},y=h=>t().has(h),x=(h,k,v)=>{const D=h.id;if(v.metaKey||v.ctrlKey)v.preventDefault(),p(D),a(k);else if(v.shiftKey&&i()>=0)v.preventDefault(),a(k);else{if(v.detail>1)return;n(new Set([D])),a(k)}},z=(h,k,v)=>{(v.shiftKey||v.ctrlKey||v.metaKey)&&v.preventDefault(),v.button===0&&!v.metaKey&&!v.ctrlKey&&!v.shiftKey&&(v.preventDefault(),f({x:v.clientX,y:v.clientY,startIndex:k}),g(!0))},r=h=>{const k=h.target,v=k&&(k.tagName==="INPUT"||k.tagName==="TEXTAREA"||k.isContentEditable||k.getAttribute("contenteditable")==="true");h.key==="Escape"?o():h.key==="a"&&(h.metaKey||h.ctrlKey)?v||h.preventDefault():(h.key==="Delete"||h.key==="Backspace")&&!v&&t().size>0&&e.onDelete?.(t())},w=h=>{s()&&l()&&d({x:h.clientX,y:h.clientY,endIndex:-1})},$=()=>{s()&&(g(!1),f(null),d(null))};return ce(()=>{document.addEventListener("mousemove",w),document.addEventListener("mouseup",$),document.addEventListener("keydown",r)}),fe(()=>{document.removeEventListener("mousemove",w),document.removeEventListener("mouseup",$),document.removeEventListener("keydown",r),document.body.classList.remove("drag-selecting")}),he(()=>{s()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),he(()=>{const h=t();e.onSelectionChange?.(h),e.saveToStorage?.(h)}),{selectedItems:t,setSelectedItems:n,lastSelectedIndex:i,setLastSelectedIndex:a,isDragSelecting:s,setIsDragSelecting:g,dragStart:l,setDragStart:f,dragEnd:u,setDragEnd:d,toggleSelection:p,selectRange:b,clearSelection:o,selectAll:m,isSelected:y,handleRowClick:x,handleRowMouseDown:z,handleKeyDown:r}}function Te(e){const t=H(()=>{const l=e.filterConfig(),f=e.sortConfig(),u=e.items().filter(p=>{if(l.name&&!X(p).toLowerCase().includes(l.name.toLowerCase()))return!1;if(l.mime){if(!p.mime)return!1;if(!l.mime.includes("/")){if(!p.mime.toLowerCase().startsWith(l.mime.toLowerCase()+"/"))return!1}else if(p.mime!==l.mime)return!1}return!(l.blobType&&p.blob_type!==l.blobType||p.size&&(p.size<l.minSize||p.size>l.maxSize)||l.hasParent==="yes"&&!p.parent_blob_id||l.hasParent==="no"&&p.parent_blob_id||l.hasLocalPath==="yes"&&!p.local_path||l.hasLocalPath==="no"&&p.local_path)});if(!f.field)return{filtered:u,sorted:u};const d=[...u].sort((p,b)=>{let o,m;if(f.field==="name"?(o=X(p),m=X(b)):(o=p[f.field],m=b[f.field]),o==null&&m==null)return 0;if(o==null)return f.direction==="desc"?-1:1;if(m==null)return f.direction==="desc"?1:-1;if(o instanceof Date&&m instanceof Date)o=o.getTime(),m=m.getTime();else if(f.field==="created_at"||f.field==="updated_at"){if(o&&typeof o=="string"){const x=new Date(o);o=isNaN(x.getTime())?0:x.getTime()}else o=0;if(m&&typeof m=="string"){const x=new Date(m);m=isNaN(x.getTime())?0:x.getTime()}else m=0}else typeof o=="string"&&typeof m=="string"?(o=o.toLowerCase(),m=m.toLowerCase()):typeof o=="number"&&typeof m=="number"||(o=String(o||"").toLowerCase(),m=String(m||"").toLowerCase());let y=0;return o<m?y=-1:o>m&&(y=1),f.direction==="desc"?-y:y});return{filtered:u,sorted:d}}),n=H(()=>t().filtered),i=H(()=>t().sorted),a=H(()=>[...new Set(e.items().map(l=>l.mime?.split("/")[0]).filter(Boolean))].sort()),s=H(()=>[...new Set(e.items().map(f=>f.blob_type))].filter(Boolean).sort()),g=H(()=>({totalCount:e.items().length,filteredCount:n().length,hiddenCount:e.items().length-n().length}));return{filteredData:n,sortedData:i,mimeCategories:a,blobTypes:s,stats:g}}const Qe=at(),ht=e=>{const t=pt({wsUrl:e.wsUrl,autoConnect:e.autoConnect}),n=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),i=Te({items:()=>n.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),a=f=>{const u=new Date().toLocaleTimeString(),d=t.logs();t.setLogs([`${u}: ${f}`,...d.slice(0,49)]),t.debug()&&console.log(`[FreqholeDemo] ${u}: ${f}`)},s=t.loadState(),g=gt({onSelectionChange:f=>{t.saveState({selectedItems:f})},onDelete:f=>{const u=i.sortedData().filter(d=>f.has(d.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${u.length} selected file${u.length!==1?"s":""}?`,items:u,onConfirm:()=>{a(`🗑️ Deleted ${u.length} selected items`),g.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:f=>{},initialSelection:new Set(s.selectedItems?Array.from(s.selectedItems||[]):[])}),l=H(()=>({state:t,selection:g,addLog:a}));return S(Qe.Provider,{get value(){return l()},get children(){return e.children}})};function De(){const e=dt(Qe);if(!e)throw new Error("useFreqholeAppContext must be used within a FreqholeStateProvider");return e}function pe(){return De().state}function mt(){return De().selection}var bt=_(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>📁 Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),xt=_('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Quick Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><div style=margin-top:8px;font-size:12px;color:#666;><div style=margin-bottom:4px;>💡 Quick Tips:</div><div style=margin-left:8px;line-height:1.4;>• Type to search filenames<br>• Use * for wildcards<br>• Case insensitive search</div></div><div style="margin-top:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=font-size:12px;color:#888;>'),yt=_("<span style=color:#00ff00;>🔍 Searching for:"),vt=_('<span style=color:#ffffff;font-weight:600;>"<!>"'),$t=_("<span style=color:#888;>Type to start searching...");function wt(){const e=pe(),t=(i,a)=>{e.updateFilter(i,a)},n=We({initialWidth:e.browsePanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:i=>e.setBrowsePanelWidth(i),onClose:()=>e.toggleBrowsePanel()});return(()=>{var i=bt(),a=i.firstChild,s=a.firstChild,g=s.nextSibling,l=a.nextSibling;return g.$$click=()=>e.toggleBrowsePanel(),c(i,(()=>{var f=N(()=>!!e.isBrowsePanelOpen());return()=>f()&&(()=>{var u=xt(),d=u.firstChild,p=d.nextSibling,b=p.nextSibling,o=b.nextSibling,m=o.firstChild;return p.$$input=y=>t("name",y.currentTarget.value),c(m,(()=>{var y=N(()=>!!e.filterConfig().name);return()=>y()?[yt()," ",(()=>{var x=vt(),z=x.firstChild,r=z.nextSibling;return r.nextSibling,c(x,()=>e.filterConfig().name,r),x})()]:$t()})()),P(()=>p.value=e.filterConfig().name),u})()})(),l),c(i,S(Oe,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:f=>n.handleMouseDown(f,"left")}),l),P(f=>{var u=`browse-panel ${e.isBrowsePanelOpen()?"":"collapsed"} ${n.isDragging()?"resizing":""}`,d=`
        width: ${e.isBrowsePanelOpen()?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isBrowsePanelOpen()?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return u!==f.e&&le(i,f.e=u),f.t=T(i,d,f.t),f},{e:void 0,t:void 0}),i})()}J(["click","input"]);var kt=_('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),_t=_("<div>"),St=_("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),Ct=_('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const zt=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function Dt(e){return(()=>{var t=_t();return c(t,S(de,{each:zt,children:n=>{const i=n.key,a=e.columnVisibility[i],s=e.hiddenColumns?.includes(n.key),g=e.responsiveColumnVisibility?.[i]??a;return(()=>{var l=St(),f=l.firstChild,u=f.firstChild,d=u.nextSibling;return u.addEventListener("change",()=>e.onColumnToggle(i)),u.checked=a,c(d,()=>n.title),c(f,s&&(()=>{var p=Ct();return P(()=>Z(p,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),p})(),null),P(p=>T(d,`
                    font-size: 14px;
                    color: ${g?"#e0e0e0":"#888"};
                    ${!g&&a?"text-decoration: line-through;":""}
                  `,p)),l})()}}),null),c(t,S(R,{get when(){return e.onResetToDefaults},get children(){var n=kt();return Be(n,"click",e.onResetToDefaults,!0),n}}),null),P(()=>le(t,`column-manager ${e.className||""}`)),t})()}J(["click"]);const Mt={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Je(e){const[t,n]=M(window.innerWidth),i=()=>({...Mt,...e.columnConfig}),a=()=>{const d=e.baseColumnVisibility(),p=i(),b=t(),o={...d};return Object.entries(p).forEach(([m,y])=>{const x=m;d[x]&&b<y.minWidth&&(o[x]=!1)}),o},s=d=>i()[d]?.priority||0,g=()=>{const d=e.baseColumnVisibility(),p=i(),b=t();return Object.entries(p).filter(([o,m])=>d[o]&&b<m.minWidth).map(([o])=>o).sort((o,m)=>s(o)-s(m))},l=()=>{const d=e.baseColumnVisibility(),p=i();return Math.max(...Object.entries(d).filter(([,b])=>b).map(([b])=>p[b]?.minWidth||0))},f=()=>{const d=t();return d<400?{name:"small mobile",size:"xs"}:d<768?{name:"mobile",size:"sm"}:d<1024?{name:"tablet",size:"md"}:d<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},u=()=>{n(window.innerWidth)};return ce(()=>{window.addEventListener("resize",u)}),fe(()=>{window.removeEventListener("resize",u)}),{screenWidth:t,responsiveColumnVisibility:a,getColumnPriority:s,getHiddenColumns:g,getMinimumWidthForAllColumns:l,getBreakpointInfo:f,setScreenWidth:n}}var Pt=_(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),It=_('<div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>bytes</span></div></div><div class=filter-section style=margin-bottom:24px;><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">Quick Size Filters</h4><div style=display:flex;flex-wrap:wrap;gap:6px;><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&lt; 1MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">1-10MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&gt; 10MB</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">👁️ Column Visibility</h3><button class=toggle-button style="width:100%;padding:8px 12px;background:#333333;border:1px solid #555555;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"><span>Manage Columns</span><span style=transform:rotate(90deg);font-size:12px;></span></button></div><div class=filter-section style="margin-bottom:24px;padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">📊 Results</h4><p style=margin:0;font-size:14px;color:#ffffff;>Showing <span style=color:#00ff00;font-weight:600;></span> of <span style=color:#888;></span> total files'),Ke=_("<option>"),Et=_("<div style=margin-top:12px;>"),Lt=_("<span style=color:#ff9900;> files filtered out");function Tt(){const e=pe(),[t,n]=M(!1),i=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),a=Te({items:()=>i.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),s=Je({baseColumnVisibility:()=>e.columnVisibility()}),g=H(()=>a.mimeCategories()),l=H(()=>a.blobTypes()),f=(p,b)=>{e.updateFilter(p,b)},u=p=>{e.toggleColumn(p)},d=We({initialWidth:e.filterPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:p=>e.setFilterPanelWidth(p),onClose:()=>e.toggleFilterPanel()});return(()=>{var p=Pt(),b=p.firstChild,o=b.firstChild,m=o.nextSibling,y=b.nextSibling;return m.$$click=()=>e.toggleFilterPanel(),c(p,(()=>{var x=N(()=>!!e.isFilterPanelOpen());return()=>x()&&(()=>{var z=It(),r=z.firstChild,w=r.firstChild,$=w.nextSibling,h=r.nextSibling,k=h.firstChild,v=k.nextSibling;v.firstChild;var D=h.nextSibling,A=D.firstChild,W=A.nextSibling;W.firstChild;var C=D.nextSibling,E=C.firstChild,F=E.nextSibling,L=F.firstChild,O=L.nextSibling,G=O.nextSibling,K=C.nextSibling,ee=K.firstChild,oe=ee.nextSibling,te=oe.firstChild,re=te.nextSibling,ae=re.nextSibling,Q=K.nextSibling,ne=Q.firstChild,ie=ne.nextSibling,me=ie.firstChild,ge=me.nextSibling,we=Q.nextSibling,ke=we.firstChild,be=ke.nextSibling,xe=be.firstChild,_e=xe.nextSibling,Me=_e.nextSibling,ye=Me.nextSibling;return ye.nextSibling,$.$$input=U=>f("name",U.currentTarget.value),v.addEventListener("change",U=>f("mime",U.currentTarget.value)),c(v,S(de,{get each(){return g()},children:U=>(()=>{var q=Ke();return q.value=U,c(q,U),q})()}),null),W.addEventListener("change",U=>f("blobType",U.currentTarget.value)),c(W,S(de,{get each(){return l()},children:U=>(()=>{var q=Ke();return q.value=U,c(q,U),q})()}),null),L.$$input=U=>f("minSize",parseInt(U.currentTarget.value)||0),G.$$input=U=>f("maxSize",parseInt(U.currentTarget.value)||0),te.$$click=()=>{f("minSize",0),f("maxSize",1024*1024)},re.$$click=()=>{f("minSize",1024*1024),f("maxSize",10*1024*1024)},ae.$$click=()=>{f("minSize",10*1024*1024),f("maxSize",0)},ie.$$click=()=>n(!t()),c(ge,()=>t()?"▼":"▶"),c(Q,(()=>{var U=N(()=>!!t());return()=>U()&&(()=>{var q=Et();return c(q,S(Dt,{get columnVisibility(){return e.columnVisibility()},onColumnToggle:u,get responsiveColumnVisibility(){return s.responsiveColumnVisibility()},get hiddenColumns(){return s.getHiddenColumns()},get breakpointInfo(){return s.getBreakpointInfo()}})),q})()})(),null),c(_e,()=>a.filteredData().length),c(ye,()=>i.state().items.length),c(be,(()=>{var U=N(()=>a.filteredData().length<i.state().items.length);return()=>U()&&(()=>{var q=Lt(),Se=q.firstChild;return c(q,()=>i.state().items.length-a.filteredData().length,Se),q})()})(),null),P(()=>$.value=e.filterConfig().name),P(()=>v.value=e.filterConfig().mime),P(()=>W.value=e.filterConfig().blobType),P(()=>L.value=e.filterConfig().minSize||""),P(()=>G.value=e.filterConfig().maxSize||""),z})()})(),y),c(p,S(Oe,{position:"right",get isDragging(){return d.isDragging()},onMouseDown:x=>d.handleMouseDown(x,"left")}),y),P(x=>{var z=`filter-panel ${e.isFilterPanelOpen()?"":"collapsed"} ${d.isDragging()?"resizing":""}`,r=`
        width: ${e.isFilterPanelOpen()?d.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isFilterPanelOpen()?"20px":"0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return z!==x.e&&le(p,x.e=z),x.t=T(p,r,x.t),x},{e:void 0,t:void 0}),p})()}J(["click","input"]);var At=_(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings & Debug</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Rt=_("<div style=font-size:11px;color:#666;>Last update: "),Ft=_('<div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">⏳ Pending Updates</h3><div style="padding:12px;background:#2a1a00;border:1px solid #5a3400;border-radius:4px;margin-bottom:12px;"><p style="margin:0 0 8px 0;font-size:14px;color:#ffaa00;"> updates waiting</p><p style=margin:0;font-size:12px;color:#cc8800;>Click below to apply pending changes</p></div><button style="width:100%;padding:10px;background:#aa6600;border:1px solid #cc8800;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">✅ Apply Updates (<!>)'),Bt=_("<div style=color:#666;font-style:italic;>No activity yet..."),Ot=_('<button style="width:100%;padding:6px;background:#333;border:1px solid #555;border-radius:4px;color:#888;font-size:12px;cursor:pointer;margin-top:8px;transition:all 0.2s;">Clear Log'),Wt=_('<div style=overflow-y:auto;min-width:0;><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔌 WebSocket Connection</h3><div style="margin-bottom:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;><span style=font-size:12px;color:#888;>Status:</span><span></span></div></div><input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:12px;box-sizing:border-box;"><div style=display:flex;gap:8px;margin-bottom:12px;><button>Connect</button><button>Disconnect</button></div><button style="width:100%;padding:8px;background:#0066cc;border:1px solid #0088ff;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;">🔄 Refresh Data</button></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🤖 Automatic Settings</h3><div style=display:flex;flex-direction:column;gap:8px;><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-connect on load</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-refresh data</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Enable debug mode</span></label></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📊 Data Statistics</h3><div style="padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;"><div><div style=color:#888;font-size:12px;>Total Files</div><div style=color:#ffffff;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Filtered</div><div style=color:#00ff00;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Hidden</div><div style=color:#ff9900;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Memory</div><div style=color:#888;font-weight:600;font-size:12px;>~<!>KB</div></div></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📜 Activity Log</h3><div style="max-height:200px;overflow-y:auto;background:#0a0a0a;border:1px solid #333;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;line-height:1.3;"></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ff4444;">⚠️ Danger Zone</h3><div style="padding:12px;background:#2a0000;border:1px solid #5a0000;border-radius:4px;margin-bottom:12px;"><p style=margin:0;font-size:12px;color:#ff8888;>This will clear all settings, filters, and cached data. The page will reload.</p></div><button style="width:100%;padding:10px;background:#aa0000;border:1px solid #dd0000;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Reset All Data'),Ut=_("<div style=color:#ccc;margin-bottom:2px;word-break:break-all;>");function Nt(){const{state:e,addLog:t}=De(),n=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),i=Te({items:()=>n.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),a=()=>n.state().connectionStatus,s=()=>n.state().hasPendingUpdates,g=()=>n.state().lastUpdated,l=()=>{n.actions.connect(),t("🔌 Connecting to WebSocket...")},f=()=>{n.actions.disconnect(),t("🔌 Disconnecting from WebSocket...")},u=()=>{t("🔄 Refreshing data..."),n.actions.refresh()},d=()=>{n.actions.applyPendingUpdates(),t("✅ Applied pending updates")},p=()=>{e.setAutoConnect(!e.autoConnect()),t(`🔧 Auto-connect: ${e.autoConnect()?"ON":"OFF"}`)},b=()=>{e.setAutoRefresh(!e.autoRefresh()),t(`🔧 Auto-refresh: ${e.autoRefresh()?"ON":"OFF"}`)},o=()=>{e.setDebug(!e.debug()),t(`🐛 Debug: ${e.debug()?"ON":"OFF"}`)},m=()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},y=We({initialWidth:e.settingsPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:x=>e.setSettingsPanelWidth(x),onClose:()=>e.toggleSettingsPanel()});return(()=>{var x=At(),z=x.firstChild,r=z.firstChild,w=r.nextSibling,$=z.nextSibling;return w.$$click=()=>e.toggleSettingsPanel(),c(x,(()=>{var h=N(()=>!!e.isSettingsPanelOpen());return()=>h()&&(()=>{var k=Wt(),v=k.firstChild,D=v.firstChild,A=D.nextSibling,W=A.firstChild,C=W.firstChild,E=C.nextSibling,F=A.nextSibling,L=F.nextSibling,O=L.firstChild,G=O.nextSibling,K=L.nextSibling,ee=v.nextSibling,oe=ee.firstChild,te=oe.nextSibling,re=te.firstChild,ae=re.firstChild,Q=re.nextSibling,ne=Q.firstChild,ie=Q.nextSibling,me=ie.firstChild,ge=ee.nextSibling,we=ge.firstChild,ke=we.nextSibling,be=ke.firstChild,xe=be.firstChild,_e=xe.firstChild,Me=_e.nextSibling,ye=xe.nextSibling,U=ye.firstChild,q=U.nextSibling,Se=ye.nextSibling,I=Se.firstChild,j=I.nextSibling,se=Se.nextSibling,Pe=se.firstChild,Ue=Pe.nextSibling,tt=Ue.firstChild,Ne=tt.nextSibling;Ne.nextSibling;var Ae=ge.nextSibling,nt=Ae.firstChild,He=nt.nextSibling,it=Ae.nextSibling,ot=it.firstChild,rt=ot.nextSibling,st=rt.nextSibling;return c(E,()=>a().toUpperCase()),c(A,S(R,{get when(){return g()},get children(){var B=Rt();return B.firstChild,c(B,()=>g()?.toLocaleTimeString(),null),B}}),null),F.$$input=B=>e.setWsUrl(B.currentTarget.value),O.$$click=l,G.$$click=f,K.$$click=u,ae.addEventListener("change",p),ne.addEventListener("change",b),me.addEventListener("change",o),c(k,S(R,{get when(){return s()},get children(){var B=Ft(),ve=B.firstChild,Ce=ve.nextSibling,Ie=Ce.firstChild,Ee=Ie.firstChild,ze=Ce.nextSibling,lt=ze.firstChild,Ve=lt.nextSibling;return Ve.nextSibling,c(Ie,()=>n.state().pendingUpdates.length,Ee),ze.$$click=d,c(ze,()=>n.state().pendingUpdates.length,Ve),B}}),ge),c(Me,()=>n.state().items.length),c(q,()=>i.filteredData().length),c(j,()=>n.state().items.length-i.filteredData().length),c(Ue,()=>Math.round(n.state().items.length*.5),Ne),c(He,S(R,{get when(){return e.logs().length===0},get children(){return Bt()}}),null),c(He,S(de,{get each(){return e.logs()},children:B=>(()=>{var ve=Ut();return c(ve,B),ve})()}),null),c(Ae,S(R,{get when(){return e.logs().length>0},get children(){var B=Ot();return B.$$click=()=>e.setLogs([]),B}}),null),st.$$click=m,P(B=>{var ve=`
                  font-size: 12px;
                  font-weight: 600;
                  color: ${a()==="connected"?"#00ff00":a()==="connecting"?"#ffaa00":"#ff4444"};
                `,Ce=a()==="connected",Ie=`
                  flex: 1;
                  padding: 8px;
                  background: ${a()==="connected"?"#333":"#00aa00"};
                  border: 1px solid ${a()==="connected"?"#555":"#00dd00"};
                  border-radius: 4px;
                  color: ${a()==="connected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${a()==="connected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `,Ee=a()==="disconnected",ze=`
                  flex: 1;
                  padding: 8px;
                  background: ${a()==="disconnected"?"#333":"#aa0000"};
                  border: 1px solid ${a()==="disconnected"?"#555":"#dd0000"};
                  border-radius: 4px;
                  color: ${a()==="disconnected"?"#888":"#ffffff"};
                  font-size: 14px;
                  cursor: ${a()==="disconnected"?"not-allowed":"pointer"};
                  transition: all 0.2s;
                `;return B.e=T(E,ve,B.e),Ce!==B.t&&(O.disabled=B.t=Ce),B.a=T(O,Ie,B.a),Ee!==B.o&&(G.disabled=B.o=Ee),B.i=T(G,ze,B.i),B},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),P(()=>F.value=e.wsUrl()),P(()=>ae.checked=e.autoConnect()),P(()=>ne.checked=e.autoRefresh()),P(()=>me.checked=e.debug()),k})()})(),$),c(x,S(Oe,{position:"left",get isDragging(){return y.isDragging()},onMouseDown:h=>y.handleMouseDown(h,"right")}),$),P(h=>{var k=`settings-panel ${e.isSettingsPanelOpen()?"":"collapsed"} ${y.isDragging()?"resizing":""}`,v=`
        width: ${e.isSettingsPanelOpen()?y.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${e.isSettingsPanelOpen()?"20px":"0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
        order: 3;
      `;return k!==h.e&&le(x,h.e=k),h.t=T(x,v,h.t),h},{e:void 0,t:void 0}),x})()}J(["click","input"]);var Ht=_(`<div class="edge-toggle-button edge-toggle-left"title="Show Browse panel"style="position:fixed;top:50%;left:0;transform:translateY(-50%);width:24px;height:80px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:0 8px 8px 0;cursor:pointer;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.2s ease;color:#888;font-size:12px;font-weight:500;user-select:none;box-shadow:0 2px 8px rgba(0, 0, 0, 0.3);overflow:hidden;"><div class=arrow-container>→</div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;>Browse</div><style>
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
        `);function Vt(){const e=pe(),[t,n]=M(!1),i=()=>!e.isBrowsePanelOpen(),a=()=>e.toggleBrowsePanel();return S(R,{get when(){return i()},get children(){var s=Ht(),g=s.firstChild;return g.nextSibling,s.addEventListener("mouseleave",()=>n(!1)),s.addEventListener("mouseenter",()=>n(!0)),s.$$click=a,P(l=>T(g,`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `,l)),s}})}J(["click"]);var Kt=_(`<div class=selection-toolbar style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;animation:slideUp 0.3s ease-out;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><button class="toolbar-button primary"title="Download selected files"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download</button><button class="toolbar-button secondary"title="More actions"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More</button><button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×</button><style>
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
        `);function qt(){const{selection:e,state:t,addLog:n}=De(),i=()=>{const l=e.selectedItems().size;n(`📥 Downloading ${l} selected items`)},a=l=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const u=l.target.getBoundingClientRect(),d={x:u.left+u.width/2-100,y:u.top-10};t.setBulkActionMenu({isOpen:!0,position:d});const p=e.selectedItems().size;n(`⋯ Bulk action menu opened for ${p} items`)}},s=()=>{const l=e.selectedItems().size;e.clearSelection(),n(`🗑️ Cleared selection of ${l} items`)},g=()=>e.selectedItems().size;return S(R,{get when(){return g()>1},get children(){var l=Kt(),f=l.firstChild,u=f.firstChild,d=u.nextSibling;d.nextSibling;var p=f.nextSibling,b=p.nextSibling,o=b.nextSibling;return c(f,g,u),c(f,()=>g()===1?"":"s",d),p.$$click=i,b.$$click=a,o.$$click=s,l}})}J(["click"]);const V={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},jt=(e,t,n)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const i=e[n],a=t[n];if(i==null&&a==null)return 0;if(i==null)return 1;if(a==null)return-1;if(n==="name"){const u=X(e),d=X(t);return u.localeCompare(d,void 0,{numeric:!0,sensitivity:"base"})}if(n.includes("_at")||n.includes("date")||n.includes("time")){const u=new Date(i),d=new Date(a);if(!isNaN(u.getTime())&&!isNaN(d.getTime()))return u.getTime()-d.getTime()}const s=Number(i),g=Number(a);if(!isNaN(s)&&!isNaN(g)&&typeof i=="number"&&typeof a=="number")return s-g;if(n==="size"&&typeof i=="string"&&typeof a=="string"){const u=qe(i),d=qe(a);if(u!==null&&d!==null)return u-d}const l=String(i).toLowerCase(),f=String(a).toLowerCase();return n==="name"||n.includes("filename")?l.localeCompare(f,void 0,{numeric:!0,sensitivity:"base"}):l.localeCompare(f)},qe=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const n=parseFloat(t[1]),i=(t[2]||"B").toUpperCase(),a={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return n*(a[i]||1)};function Yt(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[n,i]=M(e.initialSort||t),[a,s]=M(new Set),[g,l]=M(!1),[f,u]=M(!1),d=e.getItemId||(r=>r.id||String(r)),p=H(()=>{const r=n(),w=[...e.data];return w.length>1e3&&(u(!0),setTimeout(()=>u(!1),100)),w.sort(($,h)=>{const k=jt($,h,r.field);return r.direction==="desc"?k*-1:k})});return{sortConfig:n,selectedItems:a,isDragSelecting:g,isSorting:f,sortedData:p,handleSort:r=>{const w=n();if(w.field===r)if(r===t.field){const $=w.direction==="asc"?"desc":"asc";i({field:r,direction:$})}else w.direction==="asc"?i({field:r,direction:"desc"}):w.direction==="desc"?i(t):i({field:r,direction:"asc"});else{const $=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc";i({field:r,direction:$})}},toggleSelection:r=>{const w=new Set(a());w.has(r)?w.delete(r):w.add(r),s(w)},clearSelection:()=>{s(new Set)},selectAll:()=>{const r=new Set(e.data.map(d));s(r)},isSelected:r=>a().has(r),selectRange:(r,w)=>{const $=new Set(a()),h=Math.min(r,w),k=Math.max(r,w);for(let v=h;v<=k;v++)if(v<e.data.length&&e.data[v]!=null){const D=d(e.data[v]);$.add(D)}s($)},setIsDragSelecting:l,getItemId:d}}var Ze=_("<div>"),Xt=_("<div class=grid-cell>"),je=_("<div class=grid-content>"),Gt=_("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Qt=_("<div class=grid-stats>Showing rows <!>-<!> of "),Jt=_("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),Zt=_('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),en=_('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),tn=_("<div><div style=font-weight:500;flex:1;>"),nn=_("<span>");function Ye(e){let t;ce(()=>{e.onRowMount&&e.onRowMount(e.item)});const n=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var i=Ze();i.$$contextmenu=s=>e.onContextMenu?.(e.item,e.index,s),i.$$mousedown=s=>e.onRowMouseDown?.(e.item,e.index,s),i.$$dblclick=s=>e.onRowDoubleClick?.(e.item,e.index,s),i.$$click=s=>e.onRowClick?.(e.item,e.index,s);var a=t;return typeof a=="function"?ue(a,i):t=i,c(i,S(de,{get each(){return e.columns},children:s=>(()=>{var g=Xt();return c(g,(()=>{var l=N(()=>!!s.render);return()=>l()?s.render(e.item,e.index):String(e.item[s.key]||"")})()),P(l=>T(g,`
              flex: ${s.width?"0 0 "+s.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${s.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${s.className==="sticky-actions-column"?"0":"auto"};
              background: ${s.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":V.colors.background:"transparent"};
              ${s.className==="sticky-actions-column"?"border-left: 1px solid "+V.colors.border+";":""}
              box-shadow: ${s.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${s.className==="sticky-actions-column"?"5":"1"};
            `,l)),g})()})),P(s=>{var g=`grid-row ${e.isSelected?"selected":""} ${n()?"focused":""}`,l=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${V.colors.border};
        background: ${e.isSelected?V.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${n()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return g!==s.e&&le(i,s.e=g),s.t=T(i,l,s.t),s},{e:void 0,t:void 0}),i})()}function on(e){const[t,n]=M(),[i,a]=M(0),[s,g]=M(0),l=e.rowHeight||50,f=e.headerHeight||60,u=e.virtualizeThreshold||100,d=H(()=>e.columns.reduce((v,D)=>v+(D.width||200),0)),p=Yt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),b=(v,D,A)=>{e.onRowClick?.(v,D,A)},o=(v,D,A)=>{e.onRowDoubleClick?.(v,D,A)},m=(v,D,A)=>{e.onRowMouseDown?.(v,D,A)},y=H(()=>e.data.length>u),x=H(()=>{if(!y())return e.data.map((L,O)=>({item:L,index:O}));if(!t())return[];const D=l,A=i(),W=s(),C=Math.floor(A/D),E=Math.min(e.data.length-1,Math.ceil((A+W)/D)+5),F=[];for(let L=Math.max(0,C-5);L<=E;L++)L<e.data.length&&e.data[L]!=null&&F.push({item:e.data[L],index:L});return F}),z=H(()=>e.data.length===0?0:t()?Math.floor(i()/l)+1:1),r=H(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const D=s()-f,A=Math.floor(D/l),W=Math.floor(i()/l)+A;return Math.min(W,e.data.length)}),w=H(()=>e.data.length),$=H(()=>e.data.length*l),h=v=>{const D=v.target;if(a(D.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const A=D.scrollHeight,W=D.scrollTop,C=D.clientHeight;A-W-C<200&&e.onLoadMore()}},k=v=>{if(p.handleSort(v),e.onSort){const D=p.sortConfig();e.onSort(D.field,D.direction)}};return ce(()=>{const v=t();if(!v)return;const D=new ResizeObserver(A=>{for(const W of A)g(W.contentRect.height)});D.observe(v),fe(()=>{D.disconnect()})}),(()=>{var v=Jt(),D=v.firstChild,A=D.firstChild,W=D.nextSibling;return D.addEventListener("scroll",h),ue(n,D),c(A,S(de,{get each(){return e.columns},children:C=>(()=>{var E=tn(),F=E.firstChild;return E.$$click=()=>C.sortable&&!p.isSorting()&&k(C.key),c(F,(()=>{var L=N(()=>typeof C.title=="string");return()=>L()?(()=>{var O=nn();return c(O,()=>C.title),O})():C.title})()),c(E,S(R,{get when(){return N(()=>!!p.isSorting())()&&p.sortConfig().field===C.key},get children(){return Zt()}}),null),c(E,S(R,{get when(){return C.sortable},get children(){var L=en(),O=L.firstChild,G=O.nextSibling;return P(K=>{var ee=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${p.sortConfig().field===C.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,oe=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${p.sortConfig().field===C.key&&p.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,te=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${p.sortConfig().field===C.key&&p.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return K.e=T(L,ee,K.e),K.t=T(O,oe,K.t),K.a=T(G,te,K.a),K},{e:void 0,t:void 0,a:void 0}),L}}),null),P(L=>{var O=`grid-header-cell ${C.sortable?"sortable":""} ${C.sortable&&p.sortConfig().field===C.key?"active-sort":""}`,G=`
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
                  background: ${C.className==="sticky-actions-column"?V.colors.header:"transparent"};
                  ${C.className==="sticky-actions-column"?"border-left: 1px solid "+V.colors.border+";":""}
                  box-shadow: ${C.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.2)":"none"};
                  z-index: ${C.className==="sticky-actions-column"?"5":"1"};
                  opacity: ${p.isSorting()&&p.sortConfig().field===C.key?"0.7":"1"};
                `;return O!==L.e&&le(E,L.e=O),L.t=T(E,G,L.t),L},{e:void 0,t:void 0}),E})()})),c(D,S(R,{get when(){return y()},get fallback(){return(()=>{var C=je();return c(C,S(de,{get each(){return e.data},children:(E,F)=>S(Ye,{item:E,get index(){return F()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(E)||E.id)||!1},onRowClick:b,onRowDoubleClick:o,onRowMouseDown:m,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:l,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),P(E=>T(C,`min-width: ${d()}px;`,E)),C})()},get children(){var C=je();return c(C,S(de,{get each(){return x()},children:E=>(()=>{var F=Ze();return c(F,S(Ye,{get item(){return E.item},get index(){return E.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(E.item)||E.item.id)||!1},onRowClick:b,onRowDoubleClick:o,onRowMouseDown:m,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:l,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),P(L=>T(F,`
                    position: absolute;
                    top: ${E.index*l}px;
                    left: 0;
                    right: 0;
                  `,L)),F})()})),P(E=>T(C,`height: ${$()}px; position: relative; min-width: ${d()}px;`,E)),C}}),null),c(v,S(R,{get when(){return e.showPaginationStatus!==!1},get children(){var C=Qt(),E=C.firstChild,F=E.nextSibling,L=F.nextSibling,O=L.nextSibling;return O.nextSibling,c(C,z,F),c(C,r,O),c(C,w,null),c(C,S(R,{get when(){return e.isLoadingMore},get children(){return Gt()}}),null),P(G=>T(C,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${V.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,G)),C}}),W),c(W,()=>`
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

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${V.colors.selected};
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

        .grid-stats {
          transition: opacity 0.2s ease;
        }

        .grid-stats:hover {
          opacity: 0.7;
        }
      `),P(C=>{var E=`infinite-data-grid ${e.className||""}`,F=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${V.colors.background};
        color: ${V.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,L=`
            height: ${f}px;
            display: flex;
            align-items: center;
            background: ${V.colors.header};
            border-bottom: 2px solid ${V.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${d()}px;
          `;return E!==C.e&&le(v,C.e=E),C.t=T(v,F,C.t),C.a=T(A,L,C.a),C},{e:void 0,t:void 0,a:void 0}),v})()}J(["click","dblclick","mousedown","contextmenu"]);const rn={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function sn(e="default"){const[t,n]=M(e),i=()=>rn[t()];return{viewMode:t,setViewMode:n,cycleViewMode:()=>{const g=["compact","default","detailed"],f=(g.indexOf(t())+1)%g.length,u=g[f];u&&n(u)},getViewModeConfig:i,getRowHeight:()=>i().rowHeight}}function ln(e){const[t,n]=M(-1),i=o=>{e.onLog&&e.onLog(o)},a=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const o=document.activeElement;return o&&(o.tagName==="INPUT"||o.tagName==="TEXTAREA"||o.isContentEditable||o.getAttribute("contenteditable")==="true")},s=()=>e.getAllItems?e.getAllItems():[],g=()=>e.getSelectedItems?e.getSelectedItems():new Set,l=()=>{const o=s(),m=t();return m>=0&&m<o.length&&o[m]||null},f=()=>{const o=s();if(o.length===0)return;const m=t(),y=m<o.length-1?m+1:0;n(y),i(`⌨️ Focused next item: ${y+1}/${o.length}`)},u=()=>{const o=s();if(o.length===0)return;const m=t(),y=m>0?m-1:o.length-1;n(y),i(`⌨️ Focused previous item: ${y+1}/${o.length}`)},d=()=>{s().length!==0&&(n(0),i("⌨️ Focused first item"))},p=()=>{const o=s();o.length!==0&&(n(o.length-1),i("⌨️ Focused last item"))},b=o=>{if(a())return;const m=s();if(m.length!==0)switch(o.key){case"ArrowDown":{o.preventDefault(),t()===-1?d():f();break}case"ArrowUp":{o.preventDefault(),t()===-1?p():u();break}case"Home":{(o.ctrlKey||o.metaKey)&&(o.preventDefault(),d());break}case"End":{(o.ctrlKey||o.metaKey)&&(o.preventDefault(),p());break}case"PageDown":{o.preventDefault();const y=t(),x=Math.min(y+10,m.length-1);n(x),i(`⌨️ Page down to item: ${x+1}/${m.length}`);break}case"PageUp":{o.preventDefault();const y=t(),x=Math.max(y-10,0);n(x),i(`⌨️ Page up to item: ${x+1}/${m.length}`);break}case"Enter":{o.preventDefault();const y=l();y&&e.onPreview&&(e.onPreview(y),i("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{o.preventDefault();const y=l();y&&e.onToggleSelection&&(e.onToggleSelection(y),i("⌨️ Toggled selection via Space key"));break}case"a":{(o.ctrlKey||o.metaKey)&&(o.preventDefault(),e.onSelectAll&&(e.onSelectAll(m),i("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{o.preventDefault(),e.onEscape&&e.onEscape(),n(-1),i("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const y=g();if(y.size>0){o.preventDefault();const z=s().filter(r=>y.has(r.id));e.onDelete&&(e.onDelete(z),i(`⌨️ Delete requested via ${o.key} key`))}break}case"Tab":{t()===-1&&m.length>0&&n(0);break}case"j":{!o.ctrlKey&&!o.metaKey&&!o.altKey&&(o.preventDefault(),t()===-1?d():f());break}case"k":{!o.ctrlKey&&!o.metaKey&&!o.altKey&&(o.preventDefault(),t()===-1?p():u());break}case"g":{o.shiftKey?(o.preventDefault(),p()):(o.preventDefault(),d());break}}};return he(()=>{s().length>0&&t()}),he(()=>{const o=s();t()>=o.length&&o.length>0?n(o.length-1):o.length===0&&n(-1)}),{focusedIndex:t,setFocusedIndex:n,handleKeyDown:b,focusNext:f,focusPrevious:u,focusFirst:d,focusLast:p,getFocusedItem:l}}var an=_(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),dn=_("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),cn=_("<span style=color:#94a3b8;>"),un=_('<div title="Has thumbnails">'),fn=_('<div title="Generating thumbnails...">');function pn(e){const t=()=>e.size||40,n=()=>e.borderRadius||"4px",i=ut({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var a=an(),s=a.firstChild;return c(a,(()=>{var g=N(()=>!!i.url);return()=>g()?(()=>{var l=dn();return Be(l,"error",i.onImageError),P(f=>{var u=i.url,d=`Thumbnail for ${e.item.id.slice(0,8)}`;return u!==f.e&&Z(l,"src",f.e=u),d!==f.t&&Z(l,"alt",f.t=d),f},{e:void 0,t:void 0}),l})():(()=>{var l=cn();return c(l,()=>i.fallbackIcon),l})()})(),s),c(a,S(R,{get when(){return e.showIndicators!==!1},get children(){return N(()=>!!i.hasThumbnails)()?(()=>{var g=un();return P(l=>T(g,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,l)),g})():N(()=>!!i.isRequested)()?(()=>{var g=fn();return P(l=>T(g,`
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
            `,l)),g})():null}}),s),P(g=>{var l=`thumbnail ${e.className||""}`,f=`
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
      `,u=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return l!==g.e&&le(a,g.e=l),g.t=T(a,f,g.t),u!==g.a&&Z(a,"title",g.a=u),g},{e:void 0,t:void 0,a:void 0}),a})()}function et(e){if(e===0)return"0 B";const t=1024,n=["B","KB","MB","GB","TB","PB"],i=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,i)).toFixed(2))+" "+n[i]}var gn=_("<span style=font-weight:500;>"),$e=_("<span>"),hn=_("<span style=font-family:monospace;font-size:12px;>"),mn=_("<button title=Controls>⋯"),bn=_('<button style="background:transparent;border:1px solid #666;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;"title="More actions">⋯');function xn(e){const{state:t,selection:n,addLog:i}=De(),a=t.loadState(),s=sn(a.viewMode||"default"),g=Je({baseColumnVisibility:()=>t.columnVisibility()}),l=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),f=Te({items:()=>l.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),u=ln({onPreview:r=>t.setPopupPreview({item:r,isOpen:!0}),onToggleSelection:r=>n.toggleSelection(r.id),onSelectAll:r=>n.selectAll(r),onClearSelection:()=>n.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):n.clearSelection()},onDelete:r=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${r.length} selected file${r.length!==1?"s":""}?`,items:r,onConfirm:()=>{i(`🗑️ Deleted ${r.length} items via keyboard`),n.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const r=document.activeElement;return r&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable||r.getAttribute("contenteditable")==="true")},getSelectedItems:()=>n.selectedItems(),getAllItems:()=>f.sortedData(),onLog:i}),[d,p]=M(new Set),b=r=>{d().has(r)||(p(w=>new Set([...w,r])),l.actions.getThumbnails(r),i(`🖼️ Requesting thumbnails for ${r.slice(0,8)}`))},o=(r,w,$)=>{$.shiftKey&&n.lastSelectedIndex()>=0?($.preventDefault(),n.selectRange(n.lastSelectedIndex(),w,f.sortedData())):n.handleRowClick(r,w,$)},m=r=>{t.setPopupPreview({item:r,isOpen:!0}),i(`🖼️ Opened preview for: ${X(r)}`)},y=(r,w,$)=>{$.preventDefault(),$.stopPropagation();const h={x:$.clientX,y:$.clientY},k=n.selectedItems().size;k>1?(t.setBulkActionMenu({isOpen:!0,position:h}),i(`🖱️ Bulk context menu opened for ${k} items`)):(t.setActionMenu({item:r,isOpen:!0,position:h}),i(`🖱️ Context menu opened for: ${X(r)}`))},x=(r,w)=>{t.handleSort(r,w)},z=H(()=>{const r=g.responsiveColumnVisibility(),w=[];return r.thumbnail&&w.push({key:"thumbnail",title:"",width:60,render:$=>S(pn,{item:$,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:b,get requestedThumbnails(){return d()},showIndicators:!0})}),r.name&&w.push({key:"name",title:"Name",sortable:!0,render:$=>(()=>{var h=gn();return c(h,()=>X($)),P(()=>Z(h,"title",X($))),h})()}),r.blob_type&&w.push({key:"blob_type",title:"Type",width:100,sortable:!0}),r.mime&&w.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:$=>(()=>{var h=$e();return c(h,()=>$.mime||"unknown"),h})()}),r.id&&w.push({key:"id",title:"ID",width:200,sortable:!0,render:$=>(()=>{var h=hn();return c(h,()=>$.id),h})()}),r.size&&w.push({key:"size",title:"Size",width:100,sortable:!0,render:$=>(()=>{var h=$e();return c(h,()=>et($.size||0)),h})()}),r.parent_blob_id&&w.push({key:"parent_blob_id",title:"Parent",width:120,render:$=>(()=>{var h=$e();return c(h,()=>$.parent_blob_id?"Yes":"No"),h})()}),r.local_path&&w.push({key:"local_path",title:"Local Path",width:200,render:$=>(()=>{var h=$e();return c(h,()=>$.local_path||"None"),h})()}),r.created_at&&w.push({key:"created_at",title:"Created",width:140,sortable:!0,render:$=>(()=>{var h=$e();return c(h,()=>new Date($.created_at).toLocaleString()),h})()}),r.updated_at&&w.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:$=>(()=>{var h=$e();return c(h,(()=>{var k=N(()=>!!$.updated_at);return()=>k()?new Date($.updated_at).toLocaleString():"—"})()),h})()}),r.actions&&w.push({key:"actions",title:(()=>{var $=mn();return $.$$click=h=>{h.stopPropagation();const k=h.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:k.left+k.width/2,y:k.bottom+5}})},P(h=>T($,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,h)),$})(),width:60,render:$=>(()=>{var h=bn();return h.$$click=k=>{k.stopPropagation(),k.preventDefault();const v=t.actionMenu();if(v&&v.item.id===$.id)t.setActionMenu(null),i(`⋯ Action menu closed for: ${X($)}`);else{const D=k.target.getBoundingClientRect(),A={x:D.right-120,y:D.bottom+4};t.setActionMenu({item:$,isOpen:!0,position:A}),i(`⋯ Action menu opened for: ${X($)}`)}},h})()}),w});return S(on,{get data(){return f.sortedData()},get columns(){return z()},onSort:x,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return s.getRowHeight()},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return n.selectedItems()},onRowClick:o,onRowDoubleClick:m,get onRowMouseDown(){return n.handleRowMouseDown},onContextMenu:(r,w,$)=>y(r,w,$),get isDragSelecting(){return n.isDragSelecting()},showPaginationStatus:!0,onLoadMore:()=>l.actions.loadMore(),get hasMore(){return l.state().hasMore},get isLoadingMore(){return l.state().isLoadingMore},get focusedIndex(){return u.focusedIndex()},showFocusIndicator:!0})}J(["click"]);var yn=_('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),vn=_("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),$n=_("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),wn=_("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:4rem;>🎵</div><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),kn=_('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),_n=_("<div style=text-align:center;margin-bottom:24px;>"),Sn=_("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),Cn=_("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),zn=_('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function Dn(){const e=pe();let t;const n=s=>{s.key==="Escape"&&(s.preventDefault(),e.setPopupPreview(null))},i=s=>{s.target===t&&(s.preventDefault(),s.stopPropagation(),e.setPopupPreview(null))};ce(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",n),document.addEventListener("click",i),document.body.style.overflow="hidden")}),fe(()=>{document.removeEventListener("keydown",n,!0),document.body.style.overflow=""});const a=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",n,!0),document.addEventListener("click",i,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",n,!0),document.removeEventListener("click",i,!0),document.body.style.overflow="")};return ce(()=>{const s=()=>{a(),requestAnimationFrame(s)};s()}),S(R,{get when(){return N(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var s=yn(),g=s.firstChild,l=g.firstChild;s.$$click=i;var f=t;return typeof f=="function"?ue(f,s):t=s,g.$$click=u=>u.stopPropagation(),l.addEventListener("mouseleave",u=>{u.target.style.background="#ef4444"}),l.addEventListener("mouseenter",u=>{u.target.style.background="#dc2626"}),l.$$click=()=>e.setPopupPreview(null),c(g,S(R,{get when(){return e.popupPreview()?.item},children:u=>{const d=u().mime||"",p=d.startsWith("image/"),b=d.startsWith("video/"),o=d.startsWith("audio/"),m=X(u());return[(()=>{var y=_n();return c(y,S(R,{when:p,get children(){var x=vn();return x.addEventListener("error",z=>{const r=z.target;r.style.display="none";const w=document.createElement("div");w.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${m}</div>
                            </div>
                          `,r.parentNode?.appendChild(w)}),Z(x,"alt",m),P(()=>Z(x,"src",`/api/blobs/${u().id}`)),x}}),null),c(y,S(R,{when:b,get children(){var x=$n(),z=x.firstChild;return Z(z,"type",d),P(()=>Z(z,"src",`/api/blobs/${u().id}`)),x}}),null),c(y,S(R,{when:o,get children(){var x=wn(),z=x.firstChild,r=z.nextSibling,w=r.nextSibling,$=w.firstChild;return c(r,m),Z($,"type",d),P(()=>Z($,"src",`/api/blobs/${u().id}`)),x}}),null),c(y,S(R,{when:!p&&!b&&!o,get children(){var x=kn(),z=x.firstChild,r=z.nextSibling,w=r.nextSibling,$=w.firstChild;return P(()=>Z($,"href",`/api/blobs/${u().id}`)),x}}),null),y})(),(()=>{var y=zn(),x=y.firstChild,z=x.nextSibling,r=z.firstChild,w=r.firstChild,$=w.nextSibling,h=r.nextSibling,k=h.firstChild,v=k.nextSibling,D=h.nextSibling,A=D.firstChild,W=A.nextSibling,C=D.nextSibling,E=C.firstChild,F=E.nextSibling,L=C.nextSibling,O=L.firstChild,G=O.nextSibling,K=L.nextSibling,ee=K.firstChild,oe=ee.nextSibling,te=K.nextSibling,re=te.firstChild,ae=re.nextSibling;return c($,m),c(v,()=>u().id),c(W,()=>u().sha256),c(F,()=>u().blob_type),c(G,d||"unknown"),c(oe,()=>et(u().size||0)),c(ae,()=>new Date(u().created_at).toLocaleString()),c(z,S(R,{get when(){return u().parent_blob_id},get children(){var Q=Sn(),ne=Q.firstChild,ie=ne.nextSibling;return c(ie,()=>u().parent_blob_id),Q}}),null),c(z,S(R,{get when(){return u().local_path},get children(){var Q=Cn(),ne=Q.firstChild,ie=ne.nextSibling;return c(ie,()=>u().local_path),Q}}),null),y})()]}}),null),s}})}J(["click"]);var Mn=_(`<div><style>
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
        `),Pn=_('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),In=_('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function En(){const e=pe();let t;const[n,i]=M({x:0,y:0}),a=b=>{b.key==="Escape"&&(b.preventDefault(),b.stopPropagation(),e.setActionMenu(null))},s=b=>{t&&!t.contains(b.target)&&(b.preventDefault(),b.stopPropagation(),e.setActionMenu(null))},g=()=>{if(!t)return;const b=180,o=160,m=e.actionMenu()?.position;if(!m)return;const{x:y,y:x}=m;let z=y,r=x;const w=window.innerWidth,$=window.innerHeight;y+b>w&&(z=Math.max(10,w-b-10)),x+o>$&&(r=Math.max(10,x-o)),i({x:z,y:r})};he(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",a,!0),document.addEventListener("mousedown",s,!0),setTimeout(g,0)):(document.removeEventListener("keydown",a,!0),document.removeEventListener("mousedown",s,!0))}),fe(()=>{document.removeEventListener("keydown",a,!0),document.removeEventListener("mousedown",s,!0)});const l=async()=>{const b=e.actionMenu()?.item;if(b){try{const o=X(b),m=document.createElement("a");m.href=`/api/blobs/${b.id}`,m.download=o,document.body.appendChild(m),m.click(),document.body.removeChild(m),console.log(`📥 Downloaded: ${o}`)}catch(o){console.error("Download failed:",o)}e.setActionMenu(null)}},f=()=>{const b=e.actionMenu()?.item;b&&(e.setPopupPreview({item:b,isOpen:!0}),e.setActionMenu(null))},u=()=>{const b=e.actionMenu()?.item;b&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[b],onConfirm:()=>{console.log(`🗑️ Deleted: ${X(b)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},d=async()=>{const b=e.actionMenu()?.item;if(b){try{const o=`${window.location.origin}/api/blobs/${b.id}`;await navigator.clipboard.writeText(o),console.log(`🔗 Copied URL for: ${X(b)}`)}catch(o){console.error("Copy URL failed:",o)}e.setActionMenu(null)}},p=b=>{const o=b.mime||"";return o.startsWith("image/")?"🖼️":o.startsWith("video/")?"🎥":o.startsWith("audio/")?"🎵":o.includes("pdf")?"📄":o.includes("text")?"📝":"📄"};return S(R,{get when(){return N(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var b=Mn(),o=b.firstChild;b.$$click=y=>y.stopPropagation();var m=t;return typeof m=="function"?ue(m,b):t=b,c(b,S(R,{get when(){return e.actionMenu()?.item},children:y=>[(()=>{var x=Pn(),z=x.firstChild,r=z.nextSibling;return c(z,()=>p(y())),c(r,()=>X(y())),x})(),(()=>{var x=In(),z=x.firstChild,r=z.nextSibling,w=r.nextSibling,$=w.nextSibling,h=$.nextSibling;return z.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),z.addEventListener("mouseenter",k=>{k.target.style.background="#3a3a3a"}),z.$$click=f,r.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),r.addEventListener("mouseenter",k=>{k.target.style.background="#3a3a3a"}),r.$$click=l,w.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),w.addEventListener("mouseenter",k=>{k.target.style.background="#3a3a3a"}),w.$$click=d,h.addEventListener("mouseleave",k=>{k.target.style.background="transparent"}),h.addEventListener("mouseenter",k=>{k.target.style.background="#2a1a1a"}),h.$$click=u,x})()]}),o),P(y=>T(b,`
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
        `,y)),b}})}J(["click"]);var Ln=_(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (0 selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
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
        `);function Tn(){const e=pe();let t;const[n,i]=M({x:0,y:0}),a=d=>{d.key==="Escape"&&(d.preventDefault(),d.stopPropagation(),e.setBulkActionMenu(null))},s=d=>{t&&!t.contains(d.target)&&(d.preventDefault(),d.stopPropagation(),e.setBulkActionMenu(null))},g=()=>{if(!t)return;const d=200,p=140,b=e.bulkActionMenu()?.position;if(!b)return;const{x:o,y:m}=b;let y=o,x=m;const z=window.innerWidth,r=window.innerHeight;o+d>z&&(y=Math.max(10,z-d-10)),m+p>r&&(x=Math.max(10,m-p)),i({x:y,y:x})};he(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",a,!0),document.addEventListener("mousedown",s,!0),setTimeout(g,0)):(document.removeEventListener("keydown",a,!0),document.removeEventListener("mousedown",s,!0))}),fe(()=>{document.removeEventListener("keydown",a,!0),document.removeEventListener("mousedown",s,!0)});const l=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},f=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},u=()=>{console.log("🔄 Clear selection requested"),e.setBulkActionMenu(null)};return S(R,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var d=Ln(),p=d.firstChild,b=p.nextSibling,o=b.firstChild,m=o.nextSibling,y=m.nextSibling,x=y.nextSibling;d.$$click=r=>r.stopPropagation();var z=t;return typeof z=="function"?ue(z,d):t=d,o.addEventListener("mouseleave",r=>{r.target.style.background="transparent"}),o.addEventListener("mouseenter",r=>{r.target.style.background="#3a3a3a"}),o.$$click=l,m.addEventListener("mouseleave",r=>{r.target.style.background="transparent"}),m.addEventListener("mouseenter",r=>{r.target.style.background="#3a3a3a"}),m.$$click=u,x.addEventListener("mouseleave",r=>{r.target.style.background="transparent"}),x.addEventListener("mouseenter",r=>{r.target.style.background="#2a1a1a"}),x.$$click=f,P(r=>T(d,`
          position: fixed;
          left: ${n().x}px;
          top: ${n().y}px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `,r)),d}})}J(["click"]);var An=_("<div class=drag-selection-overlay>"),Rn=_('<div class="drag-selection-corner drag-selection-corner-tl">'),Fn=_('<div class="drag-selection-corner drag-selection-corner-br">'),Bn=_("<div class=drag-selection-tooltip>Selecting...");function On(){const e=mt(),t=H(()=>{if(!e.isDragSelecting()||!e.dragStart()||!e.dragEnd())return null;const n=e.dragStart(),i=e.dragEnd(),a=Math.min(n.x,i.x),s=Math.min(n.y,i.y),g=Math.abs(i.x-n.x),l=Math.abs(i.y-n.y);return{left:a,top:s,width:g,height:l}});return S(R,{get when(){return N(()=>!!e.isDragSelecting())()&&t()},children:n=>[(()=>{var i=An();return P(a=>T(i,`
              position: fixed;
              left: ${n().left}px;
              top: ${n().top}px;
              width: ${n().width}px;
              height: ${n().height}px;
              background: rgba(0, 112, 243, 0.15);
              border: 2px solid #0070f3;
              border-radius: 3px;
              pointer-events: none;
              z-index: 999;
              transition: none;
            `,a)),i})(),(()=>{var i=Rn();return P(a=>T(i,`
              position: fixed;
              left: ${n().left-4}px;
              top: ${n().top-4}px;
              width: 8px;
              height: 8px;
              background: #0070f3;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,a)),i})(),(()=>{var i=Fn();return P(a=>T(i,`
              position: fixed;
              left: ${n().left+n().width-4}px;
              top: ${n().top+n().height-4}px;
              width: 8px;
              height: 8px;
              background: #0070f3;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `,a)),i})(),S(R,{get when(){return N(()=>n().width>50)()&&n().height>20},get children(){var i=Bn();return P(a=>T(i,`
                position: fixed;
                left: ${n().left+n().width/2-40}px;
                top: ${n().top+n().height/2-12}px;
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
              `,a)),i}})]})}var Wn=_('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),Un=_('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),Nn=_('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),Hn=_(`<style>
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
      `),Vn=_('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function Kn(){const e=pe();let t,n;ce(()=>{e.confirmDialog()?.isOpen&&n&&setTimeout(()=>n?.focus(),100)});const i=s=>{e.confirmDialog()?.isOpen&&(s.key==="Escape"?(s.preventDefault(),e.setConfirmDialog(null)):s.key==="Enter"&&s.ctrlKey&&(s.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ce(()=>{document.addEventListener("keydown",i,!0)}),fe(()=>{document.removeEventListener("keydown",i,!0)});const a=s=>{s.target===t&&e.setConfirmDialog(null)};return S(R,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var s=Nn(),g=s.firstChild,l=g.firstChild,f=l.firstChild;f.firstChild;var u=l.nextSibling,d=u.nextSibling,p=d.firstChild,b=p.nextSibling;s.$$click=a;var o=t;typeof o=="function"?ue(o,s):t=s,g.$$click=y=>y.stopPropagation(),c(f,()=>e.confirmDialog()?.title||"Confirm Action",null),c(u,()=>e.confirmDialog()?.message||"Are you sure?"),c(g,S(R,{get when(){return N(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var y=Wn(),x=y.firstChild,z=x.firstChild,r=z.nextSibling;return r.nextSibling,c(x,()=>e.confirmDialog()?.items?.length||0,r),c(y,()=>e.confirmDialog()?.items?.map(w=>(()=>{var $=Vn(),h=$.firstChild,k=h.nextSibling,v=k.nextSibling;return c(k,()=>X(w)),c(v,(()=>{var D=N(()=>!!w.size);return()=>D()?`${Math.round(w.size/1024)}KB`:""})()),$})()),null),y}}),d),c(g,S(R,{get when(){return N(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var y=Un(),x=y.firstChild,z=x.nextSibling,r=z.firstChild,w=r.nextSibling;return w.nextSibling,c(z,()=>e.confirmDialog()?.items?.length||0,w),y}}),d),p.$$click=()=>e.setConfirmDialog(null),b.$$click=()=>e.confirmDialog()?.onConfirm?.();var m=n;return typeof m=="function"?ue(m,b):n=b,s})(),Hn()]}})}J(["click"]);var Xe=_("<span style=color:#ff00ff;font-size:12px;>●"),qn=_('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;>default</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),jn=_(`<style>
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
      `);function Yn(){const e=pe();let t;const n=l=>{t&&!t.contains(l.target)&&(l.preventDefault(),l.stopPropagation(),e.setHeaderActionMenu(null))},i=l=>{l.key==="Escape"&&e.setHeaderActionMenu(null)};he(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",n,!0),document.addEventListener("keydown",i)):(document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",i))}),fe(()=>{document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",i)});const a=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},s=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},g=()=>{e.setHeaderActionMenu(null)};return S(R,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var l=qn(),f=l.firstChild,u=f.firstChild;u.firstChild;var d=u.nextSibling,p=d.nextSibling;p.firstChild;var b=t;return typeof b=="function"?ue(b,l):t=l,u.$$click=a,c(u,S(R,{get when(){return e.isFilterPanelOpen()},get children(){return Xe()}}),null),d.$$click=g,p.$$click=s,c(p,S(R,{get when(){return e.isSettingsPanelOpen()},get children(){return Xe()}}),null),P(o=>T(l,`
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
        `,o)),l})(),jn()]}})}J(["click"]);var Xn=_(`<div style="display:flex;height:100vh;background:#000000;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function Gn(e){return S(ht,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return S(Qn,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function Qn(e){return(()=>{var t=Xn(),n=t.firstChild,i=n.nextSibling;return c(t,S(wt,{}),n),c(t,S(qt,{}),n),c(n,S(xn,{get apiBaseUrl(){return e.apiBaseUrl}})),c(t,S(Vt,{}),i),c(t,S(Tt,{}),i),c(t,S(Nt,{}),i),c(t,S(Dn,{}),null),c(t,S(En,{}),null),c(t,S(Tn,{}),null),c(t,S(Kn,{}),null),c(t,S(Yn,{}),null),c(t,S(On,{}),null),t})()}class Jn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",n=this.getAttribute("api-base-url")||"http://localhost:8080",i=this.getAttribute("auto-connect")==="true";this.dispose=ct(()=>S(Gn,{wsUrl:t,apiBaseUrl:n,autoConnect:i}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Jn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
