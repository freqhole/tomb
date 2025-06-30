import{d as ie,c as M,t as k,a as Be,b as E,e as de,s as R,o as ce,f as ue,g as be,h as V,i as _,j as at,u as dt,k as d,m as K,F as ge,S as F,l as se,n as pe,r as ct}from"./web-Bmt1sUg0.js";import{u as Le}from"./thumbnail-utils-MK6iuaLH.js";import{u as ut}from"./useThumbnail-BQwvSLyN.js";import"./websocket-client-DdAbsgHN.js";import"./websocket-types-jbyVc1Fl.js";import"./types-DDODKsJP.js";function Q(e){if(e.metadata&&typeof e.metadata=="object"){const t=e.metadata;if(t.originalName||t.filename||t.original_filename||t.file_name||t.name)return t.originalName||t.filename||t.original_filename||t.file_name||t.name}return e.local_path?.split("/").pop()||`${e.sha256?.slice(0,8)||e.id.slice(0,8)}...${e.sha256?.slice(-4)||e.id.slice(-4)}`}var ft=k(`<div title="Drag to resize • Drag far to close panel"><div class=resize-handle-indicator></div><div class=resize-handle-hint>Drag to resize • Drag far to close</div><style>
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
      `);function Oe(e){const[t,n]=M(!1);return(()=>{var i=ft(),c=i.firstChild,s=c.nextSibling;return i.addEventListener("mouseleave",()=>n(!1)),i.addEventListener("mouseenter",()=>n(!0)),Be(i,"mousedown",e.onMouseDown,!0),E(p=>{var l=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,f=`
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
        `,a=`
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
        `;return l!==p.e&&de(i,p.e=l),p.t=R(i,f,p.t),p.a=R(c,u,p.a),p.o=R(s,a,p.o),p},{e:void 0,t:void 0,a:void 0,o:void 0}),i})()}ie(["mousedown"]);function We(e){const[t,n]=M(e.initialWidth),[i,c]=M(!1),s=e.minWidth||250,p=e.maxWidth||600,l=e.closeThreshold||100;return{width:t,setWidth:n,isDragging:i,handleMouseDown:(u,a="right")=>{u.preventDefault(),c(!0),document.body.classList.add("resizing");const b=u.clientX,x=t(),o=y=>{const g=y.clientX-b,C=a==="right"?x-g:x+g;if(C<l){e.onClose?.();return}const r=Math.max(s,Math.min(p,C));n(r),e.onWidthChange?.(r)},h=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",o),document.removeEventListener("mouseup",h)};document.addEventListener("mousemove",o),document.addEventListener("mouseup",h)}}}const Ge="freqhole-demo-state",Re=300;function Fe(){try{const e=localStorage.getItem(Ge);return e?JSON.parse(e):{}}catch{return{}}}function G(e){try{const n={...Fe(),...e};localStorage.setItem(Ge,JSON.stringify(n))}catch{}}function gt(e){const t=Fe(),[n,i]=M({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...t.filterConfig||{}}),[c,s]=M({field:"created_at",direction:"desc",...t.sortConfig||{}}),[p,l]=M(t.viewMode||"default"),[f,u]=M({id:!1,thumbnail:!0,name:!0,mime:!0,blob_type:!0,size:!0,parent_blob_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...t.columnVisibility||{}}),[a,b]=M(t.isFilterPanelOpen??!0),[x,o]=M(t.filterPanelWidth||Re),[h,y]=M(t.isBrowsePanelOpen??!0),[g,C]=M(t.browsePanelWidth||Re),[r,$]=M(t.isSettingsPanelOpen??!1),[v,m]=M(t.settingsPanelWidth||Re),[w,z]=M(t.wsUrl||e.wsUrl),[U,J]=M(t.autoConnect??e.autoConnect),[ee,te]=M(t.autoRefresh??!0),[ne,oe]=M(t.debug??!1),[re,L]=M(null),[D,P]=M(null),[N,S]=M(null),[T,B]=M(null),[A,O]=M(null),[Z,q]=M([]),[fe,le]=M("Disconnected"),[he,ke]=M(!1),[xe,ye]=M(null);return{filterConfig:n,setFilterConfig:I=>{i(I),G({filterConfig:I})},updateFilter:(I,X)=>{i(ae=>{const Pe={...ae,[I]:X};return G({filterConfig:Pe}),Pe})},sortConfig:c,setSortConfig:I=>{s(I),G({sortConfig:I})},handleSort:(I,X)=>{const ae={field:I,direction:X};s(ae),G({sortConfig:ae})},viewMode:p,setViewMode:I=>{l(I),G({viewMode:I})},columnVisibility:f,setColumnVisibility:I=>{u(I),G({columnVisibility:I})},toggleColumn:I=>{u(X=>{const ae={...X,[I]:!X[I]};return G({columnVisibility:ae}),ae})},isFilterPanelOpen:a,setIsFilterPanelOpen:I=>{b(I),G({isFilterPanelOpen:I})},toggleFilterPanel:()=>{b(I=>{const X=!I;return G({isFilterPanelOpen:X}),X})},filterPanelWidth:x,setFilterPanelWidth:I=>{o(I),G({filterPanelWidth:I})},isBrowsePanelOpen:h,setIsBrowsePanelOpen:I=>{y(I),G({isBrowsePanelOpen:I})},toggleBrowsePanel:()=>{y(I=>{const X=!I;return G({isBrowsePanelOpen:X}),X})},browsePanelWidth:g,setBrowsePanelWidth:I=>{C(I),G({browsePanelWidth:I})},isSettingsPanelOpen:r,setIsSettingsPanelOpen:I=>{$(I),G({isSettingsPanelOpen:I})},toggleSettingsPanel:()=>{$(I=>{const X=!I;return G({isSettingsPanelOpen:X}),X})},settingsPanelWidth:v,setSettingsPanelWidth:I=>{m(I),G({settingsPanelWidth:I})},wsUrl:w,setWsUrl:z,autoConnect:U,setAutoConnect:J,autoRefresh:ee,setAutoRefresh:te,debug:ne,setDebug:oe,popupPreview:re,setPopupPreview:L,actionMenu:D,setActionMenu:P,bulkActionMenu:N,setBulkActionMenu:S,confirmDialog:T,setConfirmDialog:B,headerActionMenu:A,setHeaderActionMenu:O,logs:Z,setLogs:q,connectionStatus:fe,setConnectionStatus:le,hasPendingUpdates:he,setHasPendingUpdates:ke,lastUpdated:xe,setLastUpdated:ye,loadState:Fe,saveState:G}}function pt(e={}){const[t,n]=M(e.initialSelection||new Set),[i,c]=M(-1),[s,p]=M(!1),[l,f]=M(null),[u,a]=M(null),b=m=>{n(w=>{const z=new Set(w);return z.has(m)?z.delete(m):z.add(m),z})},x=(m,w,z)=>{const U=Math.min(m,w),J=Math.max(m,w),ee=z.slice(U,J+1);n(te=>{const ne=new Set(te);return ee.forEach(oe=>ne.add(oe.id)),ne})},o=()=>{n(new Set),c(-1)},h=m=>{const w=new Set(m.map(z=>z.id));n(w)},y=m=>t().has(m),g=(m,w,z)=>{const U=m.id;if(z.metaKey||z.ctrlKey)z.preventDefault(),b(U),c(w);else if(z.shiftKey&&i()>=0)z.preventDefault(),c(w);else{if(z.detail>1)return;n(new Set([U])),c(w)}},C=(m,w,z)=>{(z.shiftKey||z.ctrlKey||z.metaKey)&&z.preventDefault(),z.button===0&&!z.metaKey&&!z.ctrlKey&&!z.shiftKey&&(z.preventDefault(),f({x:z.clientX,y:z.clientY,startIndex:w}),p(!0))},r=m=>{const w=m.target,z=w&&(w.tagName==="INPUT"||w.tagName==="TEXTAREA"||w.isContentEditable||w.getAttribute("contenteditable")==="true");m.key==="Escape"?o():m.key==="a"&&(m.metaKey||m.ctrlKey)?z||m.preventDefault():(m.key==="Delete"||m.key==="Backspace")&&!z&&t().size>0&&e.onDelete?.(t())},$=m=>{s()&&l()&&a({x:m.clientX,y:m.clientY,endIndex:-1})},v=()=>{s()&&(p(!1),f(null),a(null))};return ce(()=>{document.addEventListener("mousemove",$),document.addEventListener("mouseup",v),document.addEventListener("keydown",r)}),ue(()=>{document.removeEventListener("mousemove",$),document.removeEventListener("mouseup",v),document.removeEventListener("keydown",r),document.body.classList.remove("drag-selecting")}),be(()=>{s()?(document.body.classList.add("drag-selecting"),document.body.style.userSelect="none",document.body.style.webkitUserSelect="none"):(document.body.classList.remove("drag-selecting"),document.body.style.userSelect="",document.body.style.webkitUserSelect="")}),be(()=>{const m=t();e.onSelectionChange?.(m),e.saveToStorage?.(m)}),{selectedItems:t,setSelectedItems:n,lastSelectedIndex:i,setLastSelectedIndex:c,isDragSelecting:s,setIsDragSelecting:p,dragStart:l,setDragStart:f,dragEnd:u,setDragEnd:a,toggleSelection:b,selectRange:x,clearSelection:o,selectAll:h,isSelected:y,handleRowClick:g,handleRowMouseDown:C,handleKeyDown:r}}function Te(e){const t=V(()=>{const l=e.filterConfig(),f=e.sortConfig(),u=e.items().filter(b=>{if(l.name&&!Q(b).toLowerCase().includes(l.name.toLowerCase()))return!1;if(l.mime){if(!b.mime)return!1;if(!l.mime.includes("/")){if(!b.mime.toLowerCase().startsWith(l.mime.toLowerCase()+"/"))return!1}else if(b.mime!==l.mime)return!1}return!(l.blobType&&b.blob_type!==l.blobType||b.size&&(b.size<l.minSize||b.size>l.maxSize)||l.hasParent==="yes"&&!b.parent_blob_id||l.hasParent==="no"&&b.parent_blob_id||l.hasLocalPath==="yes"&&!b.local_path||l.hasLocalPath==="no"&&b.local_path)});if(!f.field)return{filtered:u,sorted:u};const a=[...u].sort((b,x)=>{let o,h;if(f.field==="name"?(o=Q(b),h=Q(x)):(o=b[f.field],h=x[f.field]),o==null&&h==null)return 0;if(o==null)return f.direction==="desc"?-1:1;if(h==null)return f.direction==="desc"?1:-1;if(o instanceof Date&&h instanceof Date)o=o.getTime(),h=h.getTime();else if(f.field==="created_at"||f.field==="updated_at"){if(o&&typeof o=="string"){const g=new Date(o);o=isNaN(g.getTime())?0:g.getTime()}else o=0;if(h&&typeof h=="string"){const g=new Date(h);h=isNaN(g.getTime())?0:g.getTime()}else h=0}else typeof o=="string"&&typeof h=="string"?(o=o.toLowerCase(),h=h.toLowerCase()):typeof o=="number"&&typeof h=="number"||(o=String(o||"").toLowerCase(),h=String(h||"").toLowerCase());let y=0;return o<h?y=-1:o>h&&(y=1),f.direction==="desc"?-y:y});return{filtered:u,sorted:a}}),n=V(()=>t().filtered),i=V(()=>t().sorted),c=V(()=>[...new Set(e.items().map(l=>l.mime?.split("/")[0]).filter(Boolean))].sort()),s=V(()=>[...new Set(e.items().map(f=>f.blob_type))].filter(Boolean).sort()),p=V(()=>({totalCount:e.items().length,filteredCount:n().length,hiddenCount:e.items().length-n().length}));return{filteredData:n,sortedData:i,mimeCategories:c,blobTypes:s,stats:p}}const Qe=at(),mt=e=>{const t=gt({wsUrl:e.wsUrl,autoConnect:e.autoConnect}),n=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),i=Te({items:()=>n.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),c=f=>{const u=new Date().toLocaleTimeString(),a=t.logs();t.setLogs([`${u}: ${f}`,...a.slice(0,49)]),t.debug()&&console.log(`[FreqholeDemo] ${u}: ${f}`)},s=t.loadState(),p=pt({onSelectionChange:f=>{t.saveState({selectedItems:f})},onDelete:f=>{const u=i.sortedData().filter(a=>f.has(a.id));t.setConfirmDialog({isOpen:!0,title:"Delete Selected Files",message:`Delete ${u.length} selected file${u.length!==1?"s":""}?`,items:u,onConfirm:()=>{c(`🗑️ Deleted ${u.length} selected items`),p.clearSelection(),t.setConfirmDialog(null)}})},saveToStorage:f=>{},initialSelection:new Set(s.selectedItems?Array.from(s.selectedItems||[]):[])}),l=V(()=>({state:t,selection:p,addLog:c}));return _(Qe.Provider,{get value(){return l()},get children(){return e.children}})};function De(){const e=dt(Qe);if(!e)throw new Error("useFreqholeAppContext must be used within a FreqholeStateProvider");return e}function me(){return De().state}function ht(){return De().selection}var bt=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>📁 Browse</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),xt=k('<div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔍 Quick Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"><div style=margin-top:8px;font-size:12px;color:#666;><div style=margin-bottom:4px;>💡 Quick Tips:</div><div style=margin-left:8px;line-height:1.4;>• Type to search filenames<br>• Use * for wildcards<br>• Case insensitive search</div></div><div style="margin-top:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=font-size:12px;color:#888;>'),yt=k("<span style=color:#00ff00;>🔍 Searching for:"),vt=k('<span style=color:#ffffff;font-weight:600;>"<!>"'),$t=k("<span style=color:#888;>Type to start searching...");function wt(){const e=me(),t=(i,c)=>{e.updateFilter(i,c)},n=We({initialWidth:e.browsePanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:i=>e.setBrowsePanelWidth(i),onClose:()=>e.toggleBrowsePanel()});return(()=>{var i=bt(),c=i.firstChild,s=c.firstChild,p=s.nextSibling,l=c.nextSibling;return p.$$click=()=>e.toggleBrowsePanel(),d(i,(()=>{var f=K(()=>!!e.isBrowsePanelOpen());return()=>f()&&(()=>{var u=xt(),a=u.firstChild,b=a.nextSibling,x=b.nextSibling,o=x.nextSibling,h=o.firstChild;return b.$$input=y=>t("name",y.currentTarget.value),d(h,(()=>{var y=K(()=>!!e.filterConfig().name);return()=>y()?[yt()," ",(()=>{var g=vt(),C=g.firstChild,r=C.nextSibling;return r.nextSibling,d(g,()=>e.filterConfig().name,r),g})()]:$t()})()),E(()=>b.value=e.filterConfig().name),u})()})(),l),d(i,_(Oe,{position:"right",get isDragging(){return n.isDragging()},onMouseDown:f=>n.handleMouseDown(f,"left")}),l),E(f=>{var u=`browse-panel ${e.isBrowsePanelOpen()?"":"collapsed"} ${n.isDragging()?"resizing":""}`,a=`
        width: ${e.isBrowsePanelOpen()?n.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isBrowsePanelOpen()?"20px":"0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return u!==f.e&&de(i,f.e=u),f.t=R(i,a,f.t),f},{e:void 0,t:void 0}),i})()}ie(["click","input"]);var kt=k('<button style="margin-top:8px;padding:8px 12px;background:#333;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;width:100%;">Reset to Defaults'),_t=k("<div>"),St=k("<div style=margin-bottom:16px;min-width:0;><label style=display:flex;align-items:center;cursor:pointer;position:relative;><input type=checkbox style=margin-right:8px;accent-color:#ff00ff;><span>"),Ct=k('<span style="margin-left:8px;background:#ff9900;color:#000;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:3px;line-height:1;">📱');const zt=[{key:"id",title:"ID"},{key:"thumbnail",title:"📷 Thumbnail"},{key:"name",title:"📄 Name"},{key:"mime",title:"🎭 MIME Type"},{key:"blob_type",title:"🏷️ Type"},{key:"size",title:"📏 Size"},{key:"parent_blob_id",title:"🌳 Parent"},{key:"local_path",title:"📁 Path"},{key:"created_at",title:"📅 Created"},{key:"updated_at",title:"🔄 Updated"},{key:"actions",title:"⚙️ Actions"}];function Dt(e){return(()=>{var t=_t();return d(t,_(ge,{each:zt,children:n=>{const i=n.key,c=e.columnVisibility[i],s=e.hiddenColumns?.includes(n.key),p=e.responsiveColumnVisibility?.[i]??c;return(()=>{var l=St(),f=l.firstChild,u=f.firstChild,a=u.nextSibling;return u.addEventListener("change",()=>e.onColumnToggle(i)),u.checked=c,d(a,()=>n.title),d(f,s&&(()=>{var b=Ct();return E(()=>se(b,"title",`Hidden on mobile screens (${e.breakpointInfo?.name||"narrow"})`)),b})(),null),E(b=>R(a,`
                    font-size: 14px;
                    color: ${p?"#e0e0e0":"#888"};
                    ${!p&&c?"text-decoration: line-through;":""}
                  `,b)),l})()}}),null),d(t,_(F,{get when(){return e.onResetToDefaults},get children(){var n=kt();return Be(n,"click",e.onResetToDefaults,!0),n}}),null),E(()=>de(t,`column-manager ${e.className||""}`)),t})()}ie(["click"]);const Mt={thumbnail:{minWidth:0,priority:100},name:{minWidth:0,priority:99},actions:{minWidth:0,priority:98},size:{minWidth:480,priority:80},mime:{minWidth:420,priority:70},created_at:{minWidth:360,priority:60},blob_type:{minWidth:320,priority:50},updated_at:{minWidth:280,priority:40},local_path:{minWidth:240,priority:30},parent_blob_id:{minWidth:200,priority:20},id:{minWidth:160,priority:10}};function Je(e){const[t,n]=M(window.innerWidth),i=()=>({...Mt,...e.columnConfig}),c=()=>{const a=e.baseColumnVisibility(),b=i(),x=t(),o={...a};return Object.entries(b).forEach(([h,y])=>{const g=h;a[g]&&x<y.minWidth&&(o[g]=!1)}),o},s=a=>i()[a]?.priority||0,p=()=>{const a=e.baseColumnVisibility(),b=i(),x=t();return Object.entries(b).filter(([o,h])=>a[o]&&x<h.minWidth).map(([o])=>o).sort((o,h)=>s(o)-s(h))},l=()=>{const a=e.baseColumnVisibility(),b=i();return Math.max(...Object.entries(a).filter(([,x])=>x).map(([x])=>b[x]?.minWidth||0))},f=()=>{const a=t();return a<400?{name:"small mobile",size:"xs"}:a<768?{name:"mobile",size:"sm"}:a<1024?{name:"tablet",size:"md"}:a<1400?{name:"desktop",size:"lg"}:{name:"wide desktop",size:"xl"}},u=()=>{n(window.innerWidth)};return ce(()=>{window.addEventListener("resize",u)}),ue(()=>{window.removeEventListener("resize",u)}),{screenWidth:t,responsiveColumnVisibility:c,getColumnPriority:s,getHiddenColumns:p,getMinimumWidthForAllColumns:l,getBreakpointInfo:f,setScreenWidth:n}}var Pt=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>🔍 Filters & Columns</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),It=k('<div style=overflow-y:auto;min-width:0;><div class=filter-section style=margin-bottom:24px;overflow-y:auto;min-width:0;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📄 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;min-width:0;"></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🎭 Content Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🏷️ Blob Type</h3><select style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;box-sizing:border-box;"><option value>All Blob Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📏 File Size</h3><div style=display:flex;gap:8px;align-items:center;><input type=number placeholder=Min style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>to</span><input type=number placeholder=Max style="max-width:33%;padding:6px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:12px;box-sizing:border-box;"><span style=color:#888;font-size:12px;>bytes</span></div></div><div class=filter-section style=margin-bottom:24px;><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">Quick Size Filters</h4><div style=display:flex;flex-wrap:wrap;gap:6px;><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&lt; 1MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">1-10MB</button><button style="padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;transition:all 0.2s;">&gt; 10MB</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">👁️ Column Visibility</h3><button class=toggle-button style="width:100%;padding:8px 12px;background:#333333;border:1px solid #555555;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"><span>Manage Columns</span><span style=transform:rotate(90deg);font-size:12px;></span></button></div><div class=filter-section style="margin-bottom:24px;padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><h4 style="margin:0 0 8px 0;font-size:14px;color:#888;">📊 Results</h4><p style=margin:0;font-size:14px;color:#ffffff;>Showing <span style=color:#00ff00;font-weight:600;></span> of <span style=color:#888;></span> total files'),Ke=k("<option>"),Et=k("<div style=margin-top:12px;>"),Lt=k("<span style=color:#ff9900;> files filtered out");function Tt(){const e=me(),[t,n]=M(!1),i=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),c=Te({items:()=>i.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),s=Je({baseColumnVisibility:()=>e.columnVisibility()}),p=V(()=>c.mimeCategories()),l=V(()=>c.blobTypes()),f=(b,x)=>{e.updateFilter(b,x)},u=b=>{e.toggleColumn(b)},a=We({initialWidth:e.filterPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:b=>e.setFilterPanelWidth(b),onClose:()=>e.toggleFilterPanel()});return(()=>{var b=Pt(),x=b.firstChild,o=x.firstChild,h=o.nextSibling,y=x.nextSibling;return h.$$click=()=>e.toggleFilterPanel(),d(b,(()=>{var g=K(()=>!!e.isFilterPanelOpen());return()=>g()&&(()=>{var C=It(),r=C.firstChild,$=r.firstChild,v=$.nextSibling,m=r.nextSibling,w=m.firstChild,z=w.nextSibling;z.firstChild;var U=m.nextSibling,J=U.firstChild,ee=J.nextSibling;ee.firstChild;var te=U.nextSibling,ne=te.firstChild,oe=ne.nextSibling,re=oe.firstChild,L=re.nextSibling,D=L.nextSibling,P=te.nextSibling,N=P.firstChild,S=N.nextSibling,T=S.firstChild,B=T.nextSibling,A=B.nextSibling,O=P.nextSibling,Z=O.firstChild,q=Z.nextSibling,fe=q.firstChild,le=fe.nextSibling,he=O.nextSibling,ke=he.firstChild,xe=ke.nextSibling,ye=xe.firstChild,_e=ye.nextSibling,Me=_e.nextSibling,ve=Me.nextSibling;return ve.nextSibling,v.$$input=H=>f("name",H.currentTarget.value),z.addEventListener("change",H=>f("mime",H.currentTarget.value)),d(z,_(ge,{get each(){return p()},children:H=>(()=>{var Y=Ke();return Y.value=H,d(Y,H),Y})()}),null),ee.addEventListener("change",H=>f("blobType",H.currentTarget.value)),d(ee,_(ge,{get each(){return l()},children:H=>(()=>{var Y=Ke();return Y.value=H,d(Y,H),Y})()}),null),re.$$input=H=>f("minSize",parseInt(H.currentTarget.value)||0),D.$$input=H=>f("maxSize",parseInt(H.currentTarget.value)||0),T.$$click=()=>{f("minSize",0),f("maxSize",1024*1024)},B.$$click=()=>{f("minSize",1024*1024),f("maxSize",10*1024*1024)},A.$$click=()=>{f("minSize",10*1024*1024),f("maxSize",0)},q.$$click=()=>n(!t()),d(le,()=>t()?"▼":"▶"),d(O,(()=>{var H=K(()=>!!t());return()=>H()&&(()=>{var Y=Et();return d(Y,_(Dt,{get columnVisibility(){return e.columnVisibility()},onColumnToggle:u,get responsiveColumnVisibility(){return s.responsiveColumnVisibility()},get hiddenColumns(){return s.getHiddenColumns()},get breakpointInfo(){return s.getBreakpointInfo()}})),Y})()})(),null),d(_e,()=>c.filteredData().length),d(ve,()=>i.state().items.length),d(xe,(()=>{var H=K(()=>c.filteredData().length<i.state().items.length);return()=>H()&&(()=>{var Y=Lt(),Se=Y.firstChild;return d(Y,()=>i.state().items.length-c.filteredData().length,Se),Y})()})(),null),E(()=>v.value=e.filterConfig().name),E(()=>z.value=e.filterConfig().mime),E(()=>ee.value=e.filterConfig().blobType),E(()=>re.value=e.filterConfig().minSize||""),E(()=>D.value=e.filterConfig().maxSize||""),C})()})(),y),d(b,_(Oe,{position:"right",get isDragging(){return a.isDragging()},onMouseDown:g=>a.handleMouseDown(g,"left")}),y),E(g=>{var C=`filter-panel ${e.isFilterPanelOpen()?"":"collapsed"} ${a.isDragging()?"resizing":""}`,r=`
        width: ${e.isFilterPanelOpen()?a.width()+"px":"0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${e.isFilterPanelOpen()?"20px":"0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `;return C!==g.e&&de(b,g.e=C),g.t=R(b,r,g.t),g},{e:void 0,t:void 0}),b})()}ie(["click","input"]);var At=k(`<div><div style="position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:8px 16px;margin:-20px -20px 20px -20px;display:flex;justify-content:space-between;align-items:center;z-index:10;"><h3 style=margin:0;font-size:14px;color:#ffffff;font-weight:600;>⚙️ Settings & Debug</h3><button title="Close panel"style="background:transparent;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;transition:all 0.2s;line-height:1;">×</button></div><style>
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
      `),Rt=k("<div style=font-size:11px;color:#666;>Last update: "),Ft=k('<div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">⏳ Pending Updates</h3><div style="padding:12px;background:#2a1a00;border:1px solid #5a3400;border-radius:4px;margin-bottom:12px;"><p style="margin:0 0 8px 0;font-size:14px;color:#ffaa00;"> updates waiting</p><p style=margin:0;font-size:12px;color:#cc8800;>Click below to apply pending changes</p></div><button style="width:100%;padding:10px;background:#aa6600;border:1px solid #cc8800;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">✅ Apply Updates (<!>)'),Bt=k("<div style=color:#666;font-style:italic;>No activity yet..."),Ot=k('<button style="width:100%;padding:6px;background:#333;border:1px solid #555;border-radius:4px;color:#888;font-size:12px;cursor:pointer;margin-top:8px;transition:all 0.2s;">Clear Log'),Wt=k('<div style=overflow-y:auto;min-width:0;><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🔌 WebSocket Connection</h3><div style="margin-bottom:12px;padding:8px;background:#252525;border-radius:4px;border:1px solid #444;"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;><span style=font-size:12px;color:#888;>Status:</span><span></span></div></div><input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#000000;border:1px solid #3a3a3a;border-radius:4px;color:#ffffff;font-size:14px;margin-bottom:12px;box-sizing:border-box;"><div style=display:flex;gap:8px;margin-bottom:12px;><button>Connect</button><button>Disconnect</button></div><button style="width:100%;padding:8px;background:#0066cc;border:1px solid #0088ff;border-radius:4px;color:#ffffff;font-size:14px;cursor:pointer;transition:all 0.2s;">🔄 Refresh Data</button></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">🤖 Automatic Settings</h3><div style=display:flex;flex-direction:column;gap:8px;><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-connect on load</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Auto-refresh data</span></label><label style=display:flex;align-items:center;gap:8px;cursor:pointer;><input type=checkbox style=transform:scale(1.2);><span style=color:#ffffff;font-size:14px;>Enable debug mode</span></label></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📊 Data Statistics</h3><div style="padding:12px;background:#252525;border-radius:6px;border:1px solid #444;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;"><div><div style=color:#888;font-size:12px;>Total Files</div><div style=color:#ffffff;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Filtered</div><div style=color:#00ff00;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Hidden</div><div style=color:#ff9900;font-weight:600;></div></div><div><div style=color:#888;font-size:12px;>Memory</div><div style=color:#888;font-weight:600;font-size:12px;>~<!>KB</div></div></div></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ffffff;">📜 Activity Log</h3><div style="max-height:200px;overflow-y:auto;background:#0a0a0a;border:1px solid #333;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;line-height:1.3;"></div></div><div class=settings-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#ff4444;">⚠️ Danger Zone</h3><div style="padding:12px;background:#2a0000;border:1px solid #5a0000;border-radius:4px;margin-bottom:12px;"><p style=margin:0;font-size:12px;color:#ff8888;>This will clear all settings, filters, and cached data. The page will reload.</p></div><button style="width:100%;padding:10px;background:#aa0000;border:1px solid #dd0000;border-radius:4px;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Reset All Data'),Ut=k("<div style=color:#ccc;margin-bottom:2px;word-break:break-all;>");function Nt(){const{state:e,addLog:t}=De(),n=Le({wsUrl:e.wsUrl(),channels:["MediaBlobs"],debug:e.debug(),autoConnect:e.autoConnect(),autoRefresh:e.autoRefresh()??!0,pageSize:50}),i=Te({items:()=>n.state().items,filterConfig:e.filterConfig,sortConfig:e.sortConfig}),c=()=>n.state().connectionStatus,s=()=>n.state().hasPendingUpdates,p=()=>n.state().lastUpdated,l=()=>{n.actions.connect(),t("🔌 Connecting to WebSocket...")},f=()=>{n.actions.disconnect(),t("🔌 Disconnecting from WebSocket...")},u=()=>{t("🔄 Refreshing data..."),n.actions.refresh()},a=()=>{n.actions.applyPendingUpdates(),t("✅ Applied pending updates")},b=()=>{e.setAutoConnect(!e.autoConnect()),t(`🔧 Auto-connect: ${e.autoConnect()?"ON":"OFF"}`)},x=()=>{e.setAutoRefresh(!e.autoRefresh()),t(`🔧 Auto-refresh: ${e.autoRefresh()?"ON":"OFF"}`)},o=()=>{e.setDebug(!e.debug()),t(`🐛 Debug: ${e.debug()?"ON":"OFF"}`)},h=()=>{confirm("Reset all settings and data? This will clear all stored preferences.")&&(localStorage.removeItem("freqhole-demo-state"),location.reload())},y=We({initialWidth:e.settingsPanelWidth(),minWidth:250,maxWidth:600,closeThreshold:100,onWidthChange:g=>e.setSettingsPanelWidth(g),onClose:()=>e.toggleSettingsPanel()});return(()=>{var g=At(),C=g.firstChild,r=C.firstChild,$=r.nextSibling,v=C.nextSibling;return $.$$click=()=>e.toggleSettingsPanel(),d(g,(()=>{var m=K(()=>!!e.isSettingsPanelOpen());return()=>m()&&(()=>{var w=Wt(),z=w.firstChild,U=z.firstChild,J=U.nextSibling,ee=J.firstChild,te=ee.firstChild,ne=te.nextSibling,oe=J.nextSibling,re=oe.nextSibling,L=re.firstChild,D=L.nextSibling,P=re.nextSibling,N=z.nextSibling,S=N.firstChild,T=S.nextSibling,B=T.firstChild,A=B.firstChild,O=B.nextSibling,Z=O.firstChild,q=O.nextSibling,fe=q.firstChild,le=N.nextSibling,he=le.firstChild,ke=he.nextSibling,xe=ke.firstChild,ye=xe.firstChild,_e=ye.firstChild,Me=_e.nextSibling,ve=ye.nextSibling,H=ve.firstChild,Y=H.nextSibling,Se=ve.nextSibling,I=Se.firstChild,X=I.nextSibling,ae=Se.nextSibling,Pe=ae.firstChild,Ue=Pe.nextSibling,tt=Ue.firstChild,Ne=tt.nextSibling;Ne.nextSibling;var Ae=le.nextSibling,nt=Ae.firstChild,He=nt.nextSibling,it=Ae.nextSibling,ot=it.firstChild,rt=ot.nextSibling,st=rt.nextSibling;return d(ne,()=>c().toUpperCase()),d(J,_(F,{get when(){return p()},get children(){var W=Rt();return W.firstChild,d(W,()=>p()?.toLocaleTimeString(),null),W}}),null),oe.$$input=W=>e.setWsUrl(W.currentTarget.value),L.$$click=l,D.$$click=f,P.$$click=u,A.addEventListener("change",b),Z.addEventListener("change",x),fe.addEventListener("change",o),d(w,_(F,{get when(){return s()},get children(){var W=Ft(),$e=W.firstChild,Ce=$e.nextSibling,Ie=Ce.firstChild,Ee=Ie.firstChild,ze=Ce.nextSibling,lt=ze.firstChild,Ve=lt.nextSibling;return Ve.nextSibling,d(Ie,()=>n.state().pendingUpdates.length,Ee),ze.$$click=a,d(ze,()=>n.state().pendingUpdates.length,Ve),W}}),le),d(Me,()=>n.state().items.length),d(Y,()=>i.filteredData().length),d(X,()=>n.state().items.length-i.filteredData().length),d(Ue,()=>Math.round(n.state().items.length*.5),Ne),d(He,_(F,{get when(){return e.logs().length===0},get children(){return Bt()}}),null),d(He,_(ge,{get each(){return e.logs()},children:W=>(()=>{var $e=Ut();return d($e,W),$e})()}),null),d(Ae,_(F,{get when(){return e.logs().length>0},get children(){var W=Ot();return W.$$click=()=>e.setLogs([]),W}}),null),st.$$click=h,E(W=>{var $e=`
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
                `;return W.e=R(ne,$e,W.e),Ce!==W.t&&(L.disabled=W.t=Ce),W.a=R(L,Ie,W.a),Ee!==W.o&&(D.disabled=W.o=Ee),W.i=R(D,ze,W.i),W},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),E(()=>oe.value=e.wsUrl()),E(()=>A.checked=e.autoConnect()),E(()=>Z.checked=e.autoRefresh()),E(()=>fe.checked=e.debug()),w})()})(),v),d(g,_(Oe,{position:"left",get isDragging(){return y.isDragging()},onMouseDown:m=>y.handleMouseDown(m,"right")}),v),E(m=>{var w=`settings-panel ${e.isSettingsPanelOpen()?"":"collapsed"} ${y.isDragging()?"resizing":""}`,z=`
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
      `;return w!==m.e&&de(g,m.e=w),m.t=R(g,z,m.t),m},{e:void 0,t:void 0}),g})()}ie(["click","input"]);var Ht=k(`<div class="edge-toggle-button edge-toggle-left"title="Show Browse panel"style="position:fixed;top:50%;left:0;transform:translateY(-50%);width:24px;height:80px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:0 8px 8px 0;cursor:pointer;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.2s ease;color:#888;font-size:12px;font-weight:500;user-select:none;box-shadow:0 2px 8px rgba(0, 0, 0, 0.3);overflow:hidden;"><div class=arrow-container>→</div><div class=panel-name style=writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;text-transform:uppercase;letter-spacing:1px;line-height:1.2;>Browse</div><style>
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
        `);function Vt(){const e=me(),[t,n]=M(!1),i=()=>!e.isBrowsePanelOpen(),c=()=>e.toggleBrowsePanel();return _(F,{get when(){return i()},get children(){var s=Ht(),p=s.firstChild;return p.nextSibling,s.addEventListener("mouseleave",()=>n(!1)),s.addEventListener("mouseenter",()=>n(!0)),s.$$click=c,E(l=>R(p,`
            opacity: ${t()?"1":"0"};
            transform: translateY(${t()?"0":"8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `,l)),s}})}ie(["click"]);var Kt=k(`<div class=selection-toolbar style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:100;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3);font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;animation:slideUp 0.3s ease-out;"><span class=selection-count style=color:#ffffff;font-weight:500;font-size:14px;> item<!> selected</span><button class="toolbar-button primary"title="Download selected files"style="background:#ff00ff;color:#000000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s ease;user-select:none;">📥 Download</button><button class="toolbar-button secondary"title="More actions"style="background:#333333;color:#ffffff;border:1px solid #666666;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;user-select:none;">⋯ More</button><button class="toolbar-button clear"title="Clear selection"style="background:transparent;color:#888888;border:1px solid #555555;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;user-select:none;">×</button><style>
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
        `);function qt(){const{selection:e,state:t,addLog:n}=De(),i=()=>{const l=e.selectedItems().size;n(`📥 Downloading ${l} selected items`)},c=l=>{if(t.bulkActionMenu()?.isOpen)t.setBulkActionMenu(null);else{const u=l.target.getBoundingClientRect(),a={x:u.left+u.width/2-100,y:u.top-10};t.setBulkActionMenu({isOpen:!0,position:a});const b=e.selectedItems().size;n(`⋯ Bulk action menu opened for ${b} items`)}},s=()=>{const l=e.selectedItems().size;e.clearSelection(),n(`🗑️ Cleared selection of ${l} items`)},p=()=>e.selectedItems().size;return _(F,{get when(){return p()>1},get children(){var l=Kt(),f=l.firstChild,u=f.firstChild,a=u.nextSibling;a.nextSibling;var b=f.nextSibling,x=b.nextSibling,o=x.nextSibling;return d(f,p,u),d(f,()=>p()===1?"":"s",a),b.$$click=i,x.$$click=c,o.$$click=s,l}})}ie(["click"]);const j={colors:{background:"#000000",text:"#ffffff",border:"#3a3a3a",header:"#1a1a1a",hover:"#2a2a2a",selected:"#ff00ff"}},jt=(e,t,n)=>{if(e==null&&t==null)return 0;if(e==null)return 1;if(t==null)return-1;const i=e[n],c=t[n];if(i==null&&c==null)return 0;if(i==null)return 1;if(c==null)return-1;if(n==="name"){const u=Q(e),a=Q(t);return u.localeCompare(a,void 0,{numeric:!0,sensitivity:"base"})}if(n.includes("_at")||n.includes("date")||n.includes("time")){const u=new Date(i),a=new Date(c);if(!isNaN(u.getTime())&&!isNaN(a.getTime()))return u.getTime()-a.getTime()}const s=Number(i),p=Number(c);if(!isNaN(s)&&!isNaN(p)&&typeof i=="number"&&typeof c=="number")return s-p;if(n==="size"&&typeof i=="string"&&typeof c=="string"){const u=qe(i),a=qe(c);if(u!==null&&a!==null)return u-a}const l=String(i).toLowerCase(),f=String(c).toLowerCase();return n==="name"||n.includes("filename")?l.localeCompare(f,void 0,{numeric:!0,sensitivity:"base"}):l.localeCompare(f)},qe=e=>{const t=e.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);if(!t||!t[1])return null;const n=parseFloat(t[1]),i=(t[2]||"B").toUpperCase(),c={B:1,KB:1024,MB:1024*1024,GB:1024*1024*1024,TB:1024*1024*1024*1024};return n*(c[i]||1)};function Yt(e){const t=e.defaultSort||{field:"created_at",direction:"desc"},[n,i]=M(e.initialSort||t),[c,s]=M(new Set),[p,l]=M(!1),[f,u]=M(!1),a=e.getItemId||(r=>r.id||String(r)),b=V(()=>{const r=n(),$=[...e.data];return $.length>1e3&&(u(!0),setTimeout(()=>u(!1),100)),$.sort((v,m)=>{const w=jt(v,m,r.field);return r.direction==="desc"?w*-1:w})});return{sortConfig:n,selectedItems:c,isDragSelecting:p,isSorting:f,sortedData:b,handleSort:r=>{const $=n();if($.field===r)if(r===t.field){const v=$.direction==="asc"?"desc":"asc";i({field:r,direction:v})}else $.direction==="asc"?i({field:r,direction:"desc"}):$.direction==="desc"?i(t):i({field:r,direction:"asc"});else{const v=r.includes("_at")||r.includes("date")||r.includes("time")?"desc":"asc";i({field:r,direction:v})}},toggleSelection:r=>{const $=new Set(c());$.has(r)?$.delete(r):$.add(r),s($)},clearSelection:()=>{s(new Set)},selectAll:()=>{const r=new Set(e.data.map(a));s(r)},isSelected:r=>c().has(r),selectRange:(r,$)=>{const v=new Set(c()),m=Math.min(r,$),w=Math.max(r,$);for(let z=m;z<=w;z++)if(z<e.data.length&&e.data[z]!=null){const U=a(e.data[z]);v.add(U)}s(v)},setIsDragSelecting:l,getItemId:a}}var Ze=k("<div>"),Xt=k("<div class=grid-cell>"),je=k("<div class=grid-content>"),Gt=k("<span style=margin-left:8px;color:#ff00ff;>Loading..."),Qt=k("<div class=grid-stats>Showing rows <!>-<!> of "),Jt=k("<div><div class=grid-body style=flex:1;overflow-y:auto;overflow-x:auto;position:relative;><div class=grid-header></div></div><style>"),Zt=k('<div style="position:absolute;right:40px;top:50%;transform:translateY(-50%);color:#00ff88;font-size:12px;animation:spin 1s linear infinite;">⟳'),en=k('<div class=sort-indicator><div class="sort-arrow sort-arrow-up"></div><div class="sort-arrow sort-arrow-down">'),tn=k("<div><div style=font-weight:500;flex:1;>"),nn=k("<span>");function Ye(e){let t;ce(()=>{e.onRowMount&&e.onRowMount(e.item)});const n=()=>e.focusedIndex===e.index&&e.showFocusIndicator;return(()=>{var i=Ze();i.$$contextmenu=s=>e.onContextMenu?.(e.item,e.index,s),i.$$mousedown=s=>e.onRowMouseDown?.(e.item,e.index,s),i.$$dblclick=s=>e.onRowDoubleClick?.(e.item,e.index,s),i.$$click=s=>e.onRowClick?.(e.item,e.index,s);var c=t;return typeof c=="function"?pe(c,i):t=i,d(i,_(ge,{get each(){return e.columns},children:s=>(()=>{var p=Xt();return d(p,(()=>{var l=K(()=>!!s.render);return()=>l()?s.render(e.item,e.index):String(e.item[s.key]||"")})()),E(l=>R(p,`
              flex: ${s.width?"0 0 "+s.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${s.className==="sticky-actions-column"?"sticky":"relative"};
              right: ${s.className==="sticky-actions-column"?"0":"auto"};
              background: ${s.className==="sticky-actions-column"?e.isSelected?"#2a1a2a":j.colors.background:"transparent"};
              ${s.className==="sticky-actions-column"?"border-left: 1px solid "+j.colors.border+";":""}
              box-shadow: ${s.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.1)":"none"};
              z-index: ${s.className==="sticky-actions-column"?"5":"1"};
            `,l)),p})()})),E(s=>{var p=`grid-row ${e.isSelected?"selected":""} ${n()?"focused":""}`,l=`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${j.colors.border};
        background: ${e.isSelected?j.colors.selected:"transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${n()?"2px solid #0070f3":"none"};
        outline-offset: -2px;
        position: relative;
      `;return p!==s.e&&de(i,s.e=p),s.t=R(i,l,s.t),s},{e:void 0,t:void 0}),i})()}function on(e){const[t,n]=M(),[i,c]=M(0),[s,p]=M(0),l=e.rowHeight||50,f=e.headerHeight||60,u=e.virtualizeThreshold||100,[a,b]=M(!1),[x,o]=M(null),[,h]=M(null),y=V(()=>e.columns.reduce((L,D)=>L+(D.width||200),0)),g=Yt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0,defaultSort:e.defaultSort}),C=(L,D,P)=>{e.onRowClick?.(L,D,P)},r=(L,D,P)=>{e.onRowDoubleClick?.(L,D,P)},$=(L,D,P)=>{P.button===0&&!P.metaKey&&!P.ctrlKey&&!P.shiftKey&&(P.preventDefault(),o({x:P.clientX,y:P.clientY,startIndex:D})),e.onRowMouseDown?.(L,D,P)},v=V(()=>e.data.length>u),m=V(()=>{if(!v())return e.data.map((A,O)=>({item:A,index:O}));if(!t())return[];const D=l,P=i(),N=s(),S=Math.floor(P/D),T=Math.min(e.data.length-1,Math.ceil((P+N)/D)+5),B=[];for(let A=Math.max(0,S-5);A<=T;A++)A<e.data.length&&e.data[A]!=null&&B.push({item:e.data[A],index:A});return B}),w=V(()=>e.data.length===0?0:t()?Math.floor(i()/l)+1:1),z=V(()=>{if(e.data.length===0)return 0;if(!t())return Math.min(1,e.data.length);const D=s()-f,P=Math.floor(D/l),N=Math.floor(i()/l)+P;return Math.min(N,e.data.length)}),U=V(()=>e.data.length),J=V(()=>e.data.length*l),ee=(L,D)=>{const P=t();if(!P)return-1;const N=P.getBoundingClientRect(),T=D-N.top+P.scrollTop-f;if(T<0)return-1;const B=Math.floor(T/l);return Math.max(0,Math.min(e.data.length-1,B))},te=L=>{const D=x();if(D&&!a()&&Math.sqrt(Math.pow(L.clientX-D.x,2)+Math.pow(L.clientY-D.y,2))>5&&b(!0),a()&&D){const P=ee(L.clientX,L.clientY);if(h({x:L.clientX,y:L.clientY,endIndex:P}),P>=0&&e.getItemId&&e.onDragSelection){const N=Math.min(D.startIndex,P),S=Math.max(D.startIndex,P),T=e.data.slice(N,S+1),B=new Set(T.map(A=>e.getItemId(A)));e.onDragSelection(B)}}},ne=()=>{a()&&(b(!1),o(null),h(null))},oe=L=>{const D=L.target;if(c(D.scrollTop),e.onLoadMore&&e.hasMore&&!e.isLoadingMore){const P=D.scrollHeight,N=D.scrollTop,S=D.clientHeight;P-N-S<200&&e.onLoadMore()}},re=L=>{if(g.handleSort(L),e.onSort){const D=g.sortConfig();e.onSort(D.field,D.direction)}};return ce(()=>{document.addEventListener("mousemove",te),document.addEventListener("mouseup",ne),ue(()=>{document.removeEventListener("mousemove",te),document.removeEventListener("mouseup",ne)})}),ce(()=>{const L=t();if(!L)return;const D=new ResizeObserver(P=>{for(const N of P)p(N.contentRect.height)});D.observe(L),ue(()=>{D.disconnect()})}),(()=>{var L=Jt(),D=L.firstChild,P=D.firstChild,N=D.nextSibling;return D.addEventListener("scroll",oe),pe(n,D),d(P,_(ge,{get each(){return e.columns},children:S=>(()=>{var T=tn(),B=T.firstChild;return T.$$click=()=>S.sortable&&!g.isSorting()&&re(S.key),d(B,(()=>{var A=K(()=>typeof S.title=="string");return()=>A()?(()=>{var O=nn();return d(O,()=>S.title),O})():S.title})()),d(T,_(F,{get when(){return K(()=>!!g.isSorting())()&&g.sortConfig().field===S.key},get children(){return Zt()}}),null),d(T,_(F,{get when(){return S.sortable},get children(){var A=en(),O=A.firstChild,Z=O.nextSibling;return E(q=>{var fe=`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${g.sortConfig().field===S.key?"1":"0.4"};
                      transition: opacity 0.15s ease;
                    `,le=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${g.sortConfig().field===S.key&&g.sortConfig().direction==="asc"?"#ff00ff":"#666"};
                        transition: border-bottom-color 0.15s ease;
                      `,he=`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${g.sortConfig().field===S.key&&g.sortConfig().direction==="desc"?"#ff00ff":"#666"};
                        transition: border-top-color 0.15s ease;
                      `;return q.e=R(A,fe,q.e),q.t=R(O,le,q.t),q.a=R(Z,he,q.a),q},{e:void 0,t:void 0,a:void 0}),A}}),null),E(A=>{var O=`grid-header-cell ${S.sortable?"sortable":""} ${S.sortable&&g.sortConfig().field===S.key?"active-sort":""}`,Z=`
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
                  background: ${S.className==="sticky-actions-column"?j.colors.header:"transparent"};
                  ${S.className==="sticky-actions-column"?"border-left: 1px solid "+j.colors.border+";":""}
                  box-shadow: ${S.className==="sticky-actions-column"?"-2px 0 4px rgba(0, 0, 0, 0.2)":"none"};
                  z-index: ${S.className==="sticky-actions-column"?"5":"1"};
                  opacity: ${g.isSorting()&&g.sortConfig().field===S.key?"0.7":"1"};
                `;return O!==A.e&&de(T,A.e=O),A.t=R(T,Z,A.t),A},{e:void 0,t:void 0}),T})()})),d(D,_(F,{get when(){return v()},get fallback(){return(()=>{var S=je();return d(S,_(ge,{get each(){return e.data},children:(T,B)=>_(Ye,{item:T,get index(){return B()},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(T)||T.id)||!1},onRowClick:C,onRowDoubleClick:r,onRowMouseDown:$,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:l,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})})),E(T=>R(S,`min-width: ${y()}px;`,T)),S})()},get children(){var S=je();return d(S,_(ge,{get each(){return m()},children:T=>(()=>{var B=Ze();return d(B,_(Ye,{get item(){return T.item},get index(){return T.index},get columns(){return e.columns},get isSelected(){return e.selectedItems?.has(e.getItemId?.(T.item)||T.item.id)||!1},onRowClick:C,onRowDoubleClick:r,onRowMouseDown:$,get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},rowHeight:l,get focusedIndex(){return e.focusedIndex},get showFocusIndicator(){return e.showFocusIndicator}})),E(A=>R(B,`
                    position: absolute;
                    top: ${T.index*l}px;
                    left: 0;
                    right: 0;
                  `,A)),B})()})),E(T=>R(S,`height: ${J()}px; position: relative; min-width: ${y()}px;`,T)),S}}),null),d(L,_(F,{get when(){return e.showPaginationStatus!==!1},get children(){var S=Qt(),T=S.firstChild,B=T.nextSibling,A=B.nextSibling,O=A.nextSibling;return O.nextSibling,d(S,w,B),d(S,z,O),d(S,U,null),d(S,_(F,{get when(){return e.isLoadingMore},get children(){return Gt()}}),null),E(Z=>R(S,`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${j.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `,Z)),S}}),N),d(N,()=>`
        .grid-row:hover:not(.selected) {
          background: ${j.colors.hover};
        }

        .grid-row.selected {
          background: ${j.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${j.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${j.colors.selected};
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
      `),E(S=>{var T=`infinite-data-grid ${e.className||""} ${a()?"drag-selecting":""}`,B=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${j.colors.background};
        color: ${j.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,A=`
            height: ${f}px;
            display: flex;
            align-items: center;
            background: ${j.colors.header};
            border-bottom: 2px solid ${j.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${y()}px;
          `;return T!==S.e&&de(L,S.e=T),S.t=R(L,B,S.t),S.a=R(P,A,S.a),S},{e:void 0,t:void 0,a:void 0}),L})()}ie(["click","dblclick","mousedown","contextmenu"]);const rn={compact:{rowHeight:32,showThumbnails:!1,maxColumns:4,fontSize:"11px",padding:"4px 8px",thumbnailSize:24},default:{rowHeight:50,showThumbnails:!0,maxColumns:8,fontSize:"13px",padding:"8px 12px",thumbnailSize:32},detailed:{rowHeight:70,showThumbnails:!0,maxColumns:12,fontSize:"14px",padding:"12px 16px",thumbnailSize:50}};function sn(e="default"){const[t,n]=M(e),i=()=>rn[t()];return{viewMode:t,setViewMode:n,cycleViewMode:()=>{const p=["compact","default","detailed"],f=(p.indexOf(t())+1)%p.length,u=p[f];u&&n(u)},getViewModeConfig:i,getRowHeight:()=>i().rowHeight}}function ln(e){const[t,n]=M(-1),i=o=>{e.onLog&&e.onLog(o)},c=()=>{if(e.isTextInputFocused)return e.isTextInputFocused();const o=document.activeElement;return o&&(o.tagName==="INPUT"||o.tagName==="TEXTAREA"||o.isContentEditable||o.getAttribute("contenteditable")==="true")},s=()=>e.getAllItems?e.getAllItems():[],p=()=>e.getSelectedItems?e.getSelectedItems():new Set,l=()=>{const o=s(),h=t();return h>=0&&h<o.length&&o[h]||null},f=()=>{const o=s();if(o.length===0)return;const h=t(),y=h<o.length-1?h+1:0;n(y),i(`⌨️ Focused next item: ${y+1}/${o.length}`)},u=()=>{const o=s();if(o.length===0)return;const h=t(),y=h>0?h-1:o.length-1;n(y),i(`⌨️ Focused previous item: ${y+1}/${o.length}`)},a=()=>{s().length!==0&&(n(0),i("⌨️ Focused first item"))},b=()=>{const o=s();o.length!==0&&(n(o.length-1),i("⌨️ Focused last item"))},x=o=>{if(c())return;const h=s();if(h.length!==0)switch(o.key){case"ArrowDown":{o.preventDefault(),t()===-1?a():f();break}case"ArrowUp":{o.preventDefault(),t()===-1?b():u();break}case"Home":{(o.ctrlKey||o.metaKey)&&(o.preventDefault(),a());break}case"End":{(o.ctrlKey||o.metaKey)&&(o.preventDefault(),b());break}case"PageDown":{o.preventDefault();const y=t(),g=Math.min(y+10,h.length-1);n(g),i(`⌨️ Page down to item: ${g+1}/${h.length}`);break}case"PageUp":{o.preventDefault();const y=t(),g=Math.max(y-10,0);n(g),i(`⌨️ Page up to item: ${g+1}/${h.length}`);break}case"Enter":{o.preventDefault();const y=l();y&&e.onPreview&&(e.onPreview(y),i("⌨️ Opened preview via Enter key"));break}case" ":case"Spacebar":{o.preventDefault();const y=l();y&&e.onToggleSelection&&(e.onToggleSelection(y),i("⌨️ Toggled selection via Space key"));break}case"a":{(o.ctrlKey||o.metaKey)&&(o.preventDefault(),e.onSelectAll&&(e.onSelectAll(h),i("⌨️ Selected all items via Ctrl+A")));break}case"Escape":{o.preventDefault(),e.onEscape&&e.onEscape(),n(-1),i("⌨️ Cleared focus via Escape");break}case"Delete":case"Backspace":{const y=p();if(y.size>0){o.preventDefault();const C=s().filter(r=>y.has(r.id));e.onDelete&&(e.onDelete(C),i(`⌨️ Delete requested via ${o.key} key`))}break}case"Tab":{t()===-1&&h.length>0&&n(0);break}case"j":{!o.ctrlKey&&!o.metaKey&&!o.altKey&&(o.preventDefault(),t()===-1?a():f());break}case"k":{!o.ctrlKey&&!o.metaKey&&!o.altKey&&(o.preventDefault(),t()===-1?b():u());break}case"g":{o.shiftKey?(o.preventDefault(),b()):(o.preventDefault(),a());break}}};return be(()=>{s().length>0&&t()}),be(()=>{const o=s();t()>=o.length&&o.length>0?n(o.length-1):o.length===0&&n(-1)}),{focusedIndex:t,setFocusedIndex:n,handleKeyDown:x,focusNext:f,focusPrevious:u,focusFirst:a,focusLast:b,getFocusedItem:l}}var an=k(`<div><style>
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `),dn=k("<img style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),cn=k("<span style=color:#94a3b8;>"),un=k('<div title="Has thumbnails">'),fn=k('<div title="Generating thumbnails...">');function gn(e){const t=()=>e.size||40,n=()=>e.borderRadius||"4px",i=ut({item:e.item,onRequestThumbnails:e.onRequestThumbnails,requestedThumbnails:e.requestedThumbnails,autoRequest:!0});return(()=>{var c=an(),s=c.firstChild;return d(c,(()=>{var p=K(()=>!!i.url);return()=>p()?(()=>{var l=dn();return Be(l,"error",i.onImageError),E(f=>{var u=i.url,a=`Thumbnail for ${e.item.id.slice(0,8)}`;return u!==f.e&&se(l,"src",f.e=u),a!==f.t&&se(l,"alt",f.t=a),f},{e:void 0,t:void 0}),l})():(()=>{var l=cn();return d(l,()=>i.fallbackIcon),l})()})(),s),d(c,_(F,{get when(){return e.showIndicators!==!1},get children(){return K(()=>!!i.hasThumbnails)()?(()=>{var p=un();return E(l=>R(p,`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6,t()*.15)}px;
              height: ${Math.max(6,t()*.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `,l)),p})():K(()=>!!i.isRequested)()?(()=>{var p=fn();return E(l=>R(p,`
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
            `,l)),p})():null}}),s),E(p=>{var l=`thumbnail ${e.className||""}`,f=`
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
      `,u=`${e.item.mime||"unknown"} - ${e.item.id.slice(0,8)}`;return l!==p.e&&de(c,p.e=l),p.t=R(c,f,p.t),u!==p.a&&se(c,"title",p.a=u),p},{e:void 0,t:void 0,a:void 0}),c})()}function et(e){if(e===0)return"0 B";const t=1024,n=["B","KB","MB","GB","TB","PB"],i=Math.floor(Math.log(e)/Math.log(t));return parseFloat((e/Math.pow(t,i)).toFixed(2))+" "+n[i]}var pn=k("<span style=font-weight:500;>"),we=k("<span>"),mn=k("<span style=font-family:monospace;font-size:12px;>"),hn=k("<button title=Controls>⋯"),bn=k('<button style="background:transparent;border:1px solid #666;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s;"title="More actions">⋯');function xn(e){const{state:t,selection:n,addLog:i}=De(),c=t.loadState(),s=sn(c.viewMode||"default"),p=Je({baseColumnVisibility:()=>t.columnVisibility()}),l=Le({wsUrl:t.wsUrl(),channels:["MediaBlobs"],debug:t.debug(),autoConnect:t.autoConnect(),autoRefresh:t.autoRefresh()??!0,pageSize:50}),f=Te({items:()=>l.state().items,filterConfig:t.filterConfig,sortConfig:t.sortConfig}),u=ln({onPreview:r=>t.setPopupPreview({item:r,isOpen:!0}),onToggleSelection:r=>n.toggleSelection(r.id),onSelectAll:r=>n.selectAll(r),onClearSelection:()=>n.clearSelection(),onEscape:()=>{t.popupPreview()?.isOpen?t.setPopupPreview(null):t.actionMenu()?.isOpen?t.setActionMenu(null):t.bulkActionMenu()?.isOpen?t.setBulkActionMenu(null):n.clearSelection()},onDelete:r=>{t.setConfirmDialog({isOpen:!0,title:"Delete Files",message:`Delete ${r.length} selected file${r.length!==1?"s":""}?`,items:r,onConfirm:()=>{i(`🗑️ Deleted ${r.length} items via keyboard`),n.clearSelection(),t.setConfirmDialog(null)}})},isTextInputFocused:()=>{const r=document.activeElement;return r&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable||r.getAttribute("contenteditable")==="true")},getSelectedItems:()=>n.selectedItems(),getAllItems:()=>f.sortedData(),onLog:i}),[a,b]=M(new Set),x=r=>{a().has(r)||(b($=>new Set([...$,r])),l.actions.getThumbnails(r),i(`🖼️ Requesting thumbnails for ${r.slice(0,8)}`))},o=(r,$,v)=>{v.shiftKey&&n.lastSelectedIndex()>=0?(v.preventDefault(),n.selectRange(n.lastSelectedIndex(),$,f.sortedData())):n.handleRowClick(r,$,v)},h=r=>{t.setPopupPreview({item:r,isOpen:!0}),i(`🖼️ Opened preview for: ${Q(r)}`)},y=(r,$,v)=>{v.preventDefault(),v.stopPropagation();const m={x:v.clientX,y:v.clientY},w=n.selectedItems().size;w>1?(t.setBulkActionMenu({isOpen:!0,position:m}),i(`🖱️ Bulk context menu opened for ${w} items`)):(t.setActionMenu({item:r,isOpen:!0,position:m}),i(`🖱️ Context menu opened for: ${Q(r)}`))},g=(r,$)=>{t.handleSort(r,$)},C=V(()=>{const r=p.responsiveColumnVisibility(),$=[];return r.thumbnail&&$.push({key:"thumbnail",title:"",width:60,render:v=>_(gn,{item:v,size:40,get apiBaseUrl(){return e.apiBaseUrl},onRequestThumbnails:x,get requestedThumbnails(){return a()},showIndicators:!0})}),r.name&&$.push({key:"name",title:"Name",sortable:!0,render:v=>(()=>{var m=pn();return d(m,()=>Q(v)),E(()=>se(m,"title",Q(v))),m})()}),r.blob_type&&$.push({key:"blob_type",title:"Type",width:100,sortable:!0}),r.mime&&$.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:v=>(()=>{var m=we();return d(m,()=>v.mime||"unknown"),m})()}),r.id&&$.push({key:"id",title:"ID",width:200,sortable:!0,render:v=>(()=>{var m=mn();return d(m,()=>v.id),m})()}),r.size&&$.push({key:"size",title:"Size",width:100,sortable:!0,render:v=>(()=>{var m=we();return d(m,()=>et(v.size||0)),m})()}),r.parent_blob_id&&$.push({key:"parent_blob_id",title:"Parent",width:120,render:v=>(()=>{var m=we();return d(m,()=>v.parent_blob_id?"Yes":"No"),m})()}),r.local_path&&$.push({key:"local_path",title:"Local Path",width:200,render:v=>(()=>{var m=we();return d(m,()=>v.local_path||"None"),m})()}),r.created_at&&$.push({key:"created_at",title:"Created",width:140,sortable:!0,render:v=>(()=>{var m=we();return d(m,()=>new Date(v.created_at).toLocaleString()),m})()}),r.updated_at&&$.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:v=>(()=>{var m=we();return d(m,(()=>{var w=K(()=>!!v.updated_at);return()=>w()?new Date(v.updated_at).toLocaleString():"—"})()),m})()}),r.actions&&$.push({key:"actions",title:(()=>{var v=hn();return v.$$click=m=>{m.stopPropagation();const w=m.currentTarget.getBoundingClientRect();t.setHeaderActionMenu({isOpen:!t.headerActionMenu()?.isOpen,position:{x:w.left+w.width/2,y:w.bottom+5}})},E(m=>R(v,`
              background: ${t.headerActionMenu()?.isOpen?"#ff00ff":"#333"};
              border: 1px solid ${t.headerActionMenu()?.isOpen?"#ff00ff":"#555"};
              color: ${t.headerActionMenu()?.isOpen?"#000":"#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `,m)),v})(),width:60,render:v=>(()=>{var m=bn();return m.$$click=w=>{w.stopPropagation(),w.preventDefault();const z=t.actionMenu();if(z&&z.item.id===v.id)t.setActionMenu(null),i(`⋯ Action menu closed for: ${Q(v)}`);else{const U=w.target.getBoundingClientRect(),J={x:U.right-120,y:U.bottom+4};t.setActionMenu({item:v,isOpen:!0,position:J}),i(`⋯ Action menu opened for: ${Q(v)}`)}},m})()}),$});return _(on,{get data(){return f.sortedData()},get columns(){return C()},onSort:g,get sortField(){return t.sortConfig().field},get sortDirection(){return t.sortConfig().direction},defaultSort:{field:"created_at",direction:"desc"},get rowHeight(){return s.getRowHeight()},headerHeight:60,getItemId:r=>r.id,get selectedItems(){return n.selectedItems()},onRowClick:o,onRowDoubleClick:h,get onRowMouseDown(){return n.handleRowMouseDown},onContextMenu:(r,$,v)=>y(r,$,v),onDragSelection:r=>{n.setSelectedItems(r),i(`📦 Selected ${r.size} items via drag`)},showPaginationStatus:!0,onLoadMore:()=>l.actions.loadMore(),get hasMore(){return l.state().hasMore},get isLoadingMore(){return l.state().isLoadingMore},get focusedIndex(){return u.focusedIndex()},showFocusIndicator:!0})}ie(["click"]);var yn=k('<div class=popup-overlay style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.8);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);"><div class=popup-content style="background:#2a2a2a;border-radius:8px;padding:24px;position:relative;max-width:80vw;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0, 0, 0, 0.5);"><button class=popup-close style="position:absolute;top:12px;right:12px;background:#ef4444;border:none;color:#ffffff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;z-index:1001;transition:background 0.2s;">×'),vn=k("<img class=popup-image style=max-width:80vw;max-height:70vh;object-fit:contain;border-radius:4px;>"),$n=k("<video class=popup-video controls preload=metadata style=max-width:80vw;max-height:70vh;border-radius:4px;><source>Your browser does not support video playback."),wn=k("<div style=display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;><div style=font-size:4rem;>🎵</div><div style=font-size:18px;font-weight:600;color:#e0e0e0;></div><audio controls style=width:100%;max-width:400px;><source>Your browser does not support audio playback."),kn=k('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;font-weight:600;">Download File'),_n=k("<div style=text-align:center;margin-bottom:24px;>"),Sn=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Parent:</span><span style=font-family:monospace;font-size:11px;color:#888;>"),Cn=k("<div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Local Path:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;>"),zn=k('<div class=popup-meta style="border-top:1px solid #444444;padding-top:16px;font-size:14px;color:#e0e0e0;"><h3 style="margin:0 0 16px 0;font-size:16px;color:#ffffff;">File Information</h3><div class=popup-meta-grid style=display:grid;gap:8px;><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Name:</span><span style=word-break:break-all;text-align:right;max-width:60%;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>ID:</span><span style=font-family:monospace;font-size:12px;color:#888;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>SHA256:</span><span style=font-family:monospace;font-size:11px;color:#888;word-break:break-all;max-width:60%;text-align:right;></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Type:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>MIME:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Size:</span><span></span></div><div class=popup-meta-row style=display:flex;justify-content:space-between;><span style=font-weight:600;>Created:</span><span style=font-size:12px;>');function Dn(){const e=me();let t;const n=s=>{s.key==="Escape"&&(s.preventDefault(),e.setPopupPreview(null))},i=s=>{s.target===t&&(s.preventDefault(),s.stopPropagation(),e.setPopupPreview(null))};ce(()=>{e.popupPreview()?.isOpen&&(document.addEventListener("keydown",n),document.addEventListener("click",i),document.body.style.overflow="hidden")}),ue(()=>{document.removeEventListener("keydown",n,!0),document.body.style.overflow=""});const c=()=>{e.popupPreview()?.isOpen?(document.addEventListener("keydown",n,!0),document.addEventListener("click",i,!0),document.body.style.overflow="hidden"):(document.removeEventListener("keydown",n,!0),document.removeEventListener("click",i,!0),document.body.style.overflow="")};return ce(()=>{const s=()=>{c(),requestAnimationFrame(s)};s()}),_(F,{get when(){return K(()=>!!e.popupPreview()?.isOpen)()&&e.popupPreview()?.item},get children(){var s=yn(),p=s.firstChild,l=p.firstChild;s.$$click=i;var f=t;return typeof f=="function"?pe(f,s):t=s,p.$$click=u=>u.stopPropagation(),l.addEventListener("mouseleave",u=>{u.target.style.background="#ef4444"}),l.addEventListener("mouseenter",u=>{u.target.style.background="#dc2626"}),l.$$click=()=>e.setPopupPreview(null),d(p,_(F,{get when(){return e.popupPreview()?.item},children:u=>{const a=u().mime||"",b=a.startsWith("image/"),x=a.startsWith("video/"),o=a.startsWith("audio/"),h=Q(u());return[(()=>{var y=_n();return d(y,_(F,{when:b,get children(){var g=vn();return g.addEventListener("error",C=>{const r=C.target;r.style.display="none";const $=document.createElement("div");$.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${h}</div>
                            </div>
                          `,r.parentNode?.appendChild($)}),se(g,"alt",h),E(()=>se(g,"src",`/api/blobs/${u().id}`)),g}}),null),d(y,_(F,{when:x,get children(){var g=$n(),C=g.firstChild;return se(C,"type",a),E(()=>se(C,"src",`/api/blobs/${u().id}`)),g}}),null),d(y,_(F,{when:o,get children(){var g=wn(),C=g.firstChild,r=C.nextSibling,$=r.nextSibling,v=$.firstChild;return d(r,h),se(v,"type",a),E(()=>se(v,"src",`/api/blobs/${u().id}`)),g}}),null),d(y,_(F,{when:!b&&!x&&!o,get children(){var g=kn(),C=g.firstChild,r=C.nextSibling,$=r.nextSibling,v=$.firstChild;return E(()=>se(v,"href",`/api/blobs/${u().id}`)),g}}),null),y})(),(()=>{var y=zn(),g=y.firstChild,C=g.nextSibling,r=C.firstChild,$=r.firstChild,v=$.nextSibling,m=r.nextSibling,w=m.firstChild,z=w.nextSibling,U=m.nextSibling,J=U.firstChild,ee=J.nextSibling,te=U.nextSibling,ne=te.firstChild,oe=ne.nextSibling,re=te.nextSibling,L=re.firstChild,D=L.nextSibling,P=re.nextSibling,N=P.firstChild,S=N.nextSibling,T=P.nextSibling,B=T.firstChild,A=B.nextSibling;return d(v,h),d(z,()=>u().id),d(ee,()=>u().sha256),d(oe,()=>u().blob_type),d(D,a||"unknown"),d(S,()=>et(u().size||0)),d(A,()=>new Date(u().created_at).toLocaleString()),d(C,_(F,{get when(){return u().parent_blob_id},get children(){var O=Sn(),Z=O.firstChild,q=Z.nextSibling;return d(q,()=>u().parent_blob_id),O}}),null),d(C,_(F,{get when(){return u().local_path},get children(){var O=Cn(),Z=O.firstChild,q=Z.nextSibling;return d(q,()=>u().local_path),O}}),null),y})()]}}),null),s}})}ie(["click"]);var Mn=k(`<div><style>
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
        `),Pn=k('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;>'),In=k('<div style="padding:4px 0;"><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>👁️</span><span>Preview</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download</span></button><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔗</span><span>Copy URL</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button class=action-menu-item style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete');function En(){const e=me();let t;const[n,i]=M({x:0,y:0}),c=x=>{x.key==="Escape"&&(x.preventDefault(),x.stopPropagation(),e.setActionMenu(null))},s=x=>{t&&!t.contains(x.target)&&(x.preventDefault(),x.stopPropagation(),e.setActionMenu(null))},p=()=>{if(!t)return;const x=180,o=160,h=e.actionMenu()?.position;if(!h)return;const{x:y,y:g}=h;let C=y,r=g;const $=window.innerWidth,v=window.innerHeight;y+x>$&&(C=Math.max(10,$-x-10)),g+o>v&&(r=Math.max(10,g-o)),i({x:C,y:r})};be(()=>{e.actionMenu()?.isOpen?(document.addEventListener("keydown",c,!0),document.addEventListener("mousedown",s,!0),setTimeout(p,0)):(document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",s,!0))}),ue(()=>{document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",s,!0)});const l=async()=>{const x=e.actionMenu()?.item;if(x){try{const o=Q(x),h=document.createElement("a");h.href=`/api/blobs/${x.id}`,h.download=o,document.body.appendChild(h),h.click(),document.body.removeChild(h),console.log(`📥 Downloaded: ${o}`)}catch(o){console.error("Download failed:",o)}e.setActionMenu(null)}},f=()=>{const x=e.actionMenu()?.item;x&&(e.setPopupPreview({item:x,isOpen:!0}),e.setActionMenu(null))},u=()=>{const x=e.actionMenu()?.item;x&&(e.setConfirmDialog({isOpen:!0,title:"Delete File",message:"Are you sure you want to delete this file? This action cannot be undone.",items:[x],onConfirm:()=>{console.log(`🗑️ Deleted: ${Q(x)}`),e.setConfirmDialog(null)}}),e.setActionMenu(null))},a=async()=>{const x=e.actionMenu()?.item;if(x){try{const o=`${window.location.origin}/api/blobs/${x.id}`;await navigator.clipboard.writeText(o),console.log(`🔗 Copied URL for: ${Q(x)}`)}catch(o){console.error("Copy URL failed:",o)}e.setActionMenu(null)}},b=x=>{const o=x.mime||"";return o.startsWith("image/")?"🖼️":o.startsWith("video/")?"🎥":o.startsWith("audio/")?"🎵":o.includes("pdf")?"📄":o.includes("text")?"📝":"📄"};return _(F,{get when(){return K(()=>!!e.actionMenu()?.isOpen)()&&e.actionMenu()?.item},get children(){var x=Mn(),o=x.firstChild;x.$$click=y=>y.stopPropagation();var h=t;return typeof h=="function"?pe(h,x):t=x,d(x,_(F,{get when(){return e.actionMenu()?.item},children:y=>[(()=>{var g=Pn(),C=g.firstChild,r=C.nextSibling;return d(C,()=>b(y())),d(r,()=>Q(y())),g})(),(()=>{var g=In(),C=g.firstChild,r=C.nextSibling,$=r.nextSibling,v=$.nextSibling,m=v.nextSibling;return C.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),C.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),C.$$click=f,r.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),r.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),r.$$click=l,$.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),$.addEventListener("mouseenter",w=>{w.target.style.background="#3a3a3a"}),$.$$click=a,m.addEventListener("mouseleave",w=>{w.target.style.background="transparent"}),m.addEventListener("mouseenter",w=>{w.target.style.background="#2a1a1a"}),m.$$click=u,g})()]}),o),E(y=>R(x,`
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
        `,y)),x}})}ie(["click"]);var Ln=k(`<div><div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;background:#1a1a1a;display:flex;align-items:center;gap:6px;"><span>⚡</span><span>Bulk Actions (0 selected)</span></div><div style="padding:4px 0;"><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>📥</span><span>Download All</span></button><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🔄</span><span>Clear Selection</span></button><div style="height:1px;background:#444;margin:4px 0;"></div><button style="width:100%;padding:8px 12px;background:transparent;border:none;color:#ef4444;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;"><span>🗑️</span><span>Delete All</span></button></div><style>
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
        `);function Tn(){const e=me();let t;const[n,i]=M({x:0,y:0}),c=a=>{a.key==="Escape"&&(a.preventDefault(),a.stopPropagation(),e.setBulkActionMenu(null))},s=a=>{t&&!t.contains(a.target)&&(a.preventDefault(),a.stopPropagation(),e.setBulkActionMenu(null))},p=()=>{if(!t)return;const a=200,b=140,x=e.bulkActionMenu()?.position;if(!x)return;const{x:o,y:h}=x;let y=o,g=h;const C=window.innerWidth,r=window.innerHeight;o+a>C&&(y=Math.max(10,C-a-10)),h+b>r&&(g=Math.max(10,h-b)),i({x:y,y:g})};be(()=>{e.bulkActionMenu()?.isOpen?(document.addEventListener("keydown",c,!0),document.addEventListener("mousedown",s,!0),setTimeout(p,0)):(document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",s,!0))}),ue(()=>{document.removeEventListener("keydown",c,!0),document.removeEventListener("mousedown",s,!0)});const l=async()=>{console.log("🗑️ Bulk download requested"),e.setBulkActionMenu(null)},f=()=>{console.log("🗑️ Bulk delete requested"),e.setBulkActionMenu(null)},u=()=>{console.log("🔄 Clear selection requested"),e.setBulkActionMenu(null)};return _(F,{get when(){return e.bulkActionMenu()?.isOpen},get children(){var a=Ln(),b=a.firstChild,x=b.nextSibling,o=x.firstChild,h=o.nextSibling,y=h.nextSibling,g=y.nextSibling;a.$$click=r=>r.stopPropagation();var C=t;return typeof C=="function"?pe(C,a):t=a,o.addEventListener("mouseleave",r=>{r.target.style.background="transparent"}),o.addEventListener("mouseenter",r=>{r.target.style.background="#3a3a3a"}),o.$$click=l,h.addEventListener("mouseleave",r=>{r.target.style.background="transparent"}),h.addEventListener("mouseenter",r=>{r.target.style.background="#3a3a3a"}),h.$$click=u,g.addEventListener("mouseleave",r=>{r.target.style.background="transparent"}),g.addEventListener("mouseenter",r=>{r.target.style.background="#2a1a1a"}),g.$$click=f,E(r=>R(a,`
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
        `,r)),a}})}ie(["click"]);var An=k("<div class=drag-selection-overlay>"),Rn=k('<div class="drag-selection-corner drag-selection-corner-tl">'),Fn=k('<div class="drag-selection-corner drag-selection-corner-br">');function Bn(){const e=ht(),t=V(()=>{if(!e.isDragSelecting()||!e.dragStart()||!e.dragEnd())return null;const n=e.dragStart(),i=e.dragEnd(),c=Math.min(n.x,i.x),s=Math.min(n.y,i.y),p=Math.abs(i.x-n.x),l=Math.abs(i.y-n.y);return{left:c,top:s,width:p,height:l}});return _(F,{get when(){return K(()=>!!e.isDragSelecting())()&&t()},children:n=>[(()=>{var i=An();return E(c=>R(i,`
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
            `,c)),i})(),(()=>{var i=Rn();return E(c=>R(i,`
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
            `,c)),i})(),(()=>{var i=Fn();return E(c=>R(i,`
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
            `,c)),i})()]})}var On=k('<div style="margin-bottom:20px;max-height:200px;overflow-y:auto;border:1px solid #333;border-radius:4px;background:#0a0a0a;"><div style="padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #333;font-size:12px;color:#888;font-weight:500;">Files to be affected (<!>):'),Wn=k('<div style="margin-bottom:20px;padding:12px;background:rgba(239, 68, 68, 0.1);border:1px solid rgba(239, 68, 68, 0.3);border-radius:6px;color:#ef4444;font-size:13px;display:flex;align-items:center;gap:8px;"><span style=font-size:18px;>⚠️</span><span>This action cannot be undone. All <!> files will be permanently deleted.'),Un=k('<div class=confirm-dialog-backdrop style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0, 0, 0, 0.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease-out;"><div class=confirm-dialog style="background:#1a1a1a;border:1px solid #3a3a3a;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0, 0, 0, 0.5);animation:slideIn 0.2s ease-out;"><div style=margin-bottom:16px;><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;"><span style=font-size:24px;>⚠️</span></h2></div><div style=margin-bottom:20px;color:#e0e0e0;line-height:1.5;font-size:14px;></div><div style=display:flex;gap:12px;justify-content:flex-end;><button style="padding:10px 20px;background:#333;border:1px solid #555;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s ease;">Cancel</button><button style="padding:10px 20px;background:#ef4444;border:1px solid #dc2626;color:#ffffff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.15s ease;">Confirm'),Nn=k(`<style>
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
      `),Hn=k('<div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px;"><span style=font-size:16px;>📄</span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;></span><span style=font-size:11px;color:#666;>');function Vn(){const e=me();let t,n;ce(()=>{e.confirmDialog()?.isOpen&&n&&setTimeout(()=>n?.focus(),100)});const i=s=>{e.confirmDialog()?.isOpen&&(s.key==="Escape"?(s.preventDefault(),e.setConfirmDialog(null)):s.key==="Enter"&&s.ctrlKey&&(s.preventDefault(),e.confirmDialog()?.onConfirm?.()))};ce(()=>{document.addEventListener("keydown",i,!0)}),ue(()=>{document.removeEventListener("keydown",i,!0)});const c=s=>{s.target===t&&e.setConfirmDialog(null)};return _(F,{get when(){return e.confirmDialog()?.isOpen},get children(){return[(()=>{var s=Un(),p=s.firstChild,l=p.firstChild,f=l.firstChild;f.firstChild;var u=l.nextSibling,a=u.nextSibling,b=a.firstChild,x=b.nextSibling;s.$$click=c;var o=t;typeof o=="function"?pe(o,s):t=s,p.$$click=y=>y.stopPropagation(),d(f,()=>e.confirmDialog()?.title||"Confirm Action",null),d(u,()=>e.confirmDialog()?.message||"Are you sure?"),d(p,_(F,{get when(){return K(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>0},get children(){var y=On(),g=y.firstChild,C=g.firstChild,r=C.nextSibling;return r.nextSibling,d(g,()=>e.confirmDialog()?.items?.length||0,r),d(y,()=>e.confirmDialog()?.items?.map($=>(()=>{var v=Hn(),m=v.firstChild,w=m.nextSibling,z=w.nextSibling;return d(w,()=>Q($)),d(z,(()=>{var U=K(()=>!!$.size);return()=>U()?`${Math.round($.size/1024)}KB`:""})()),v})()),null),y}}),a),d(p,_(F,{get when(){return K(()=>!!e.confirmDialog()?.items)()&&(e.confirmDialog()?.items?.length||0)>1},get children(){var y=Wn(),g=y.firstChild,C=g.nextSibling,r=C.firstChild,$=r.nextSibling;return $.nextSibling,d(C,()=>e.confirmDialog()?.items?.length||0,$),y}}),a),b.$$click=()=>e.setConfirmDialog(null),x.$$click=()=>e.confirmDialog()?.onConfirm?.();var h=n;return typeof h=="function"?pe(h,x):n=x,s})(),Nn()]}})}ie(["click"]);var Xe=k("<span style=color:#ff00ff;font-size:12px;>●"),Kn=k('<div><div style="padding:8px 0;"><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Filters & Columns</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>View Mode</div><div style=font-size:11px;color:#888;margin-top:2px;>default</div></div></button><button class=header-action-menu-item style="width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e0e0;text-align:left;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;"><div style=flex:1;><div style=font-weight:500;>Settings'),qn=k(`<style>
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
      `);function jn(){const e=me();let t;const n=l=>{t&&!t.contains(l.target)&&(l.preventDefault(),l.stopPropagation(),e.setHeaderActionMenu(null))},i=l=>{l.key==="Escape"&&e.setHeaderActionMenu(null)};be(()=>{e.headerActionMenu()?.isOpen?(document.addEventListener("mousedown",n,!0),document.addEventListener("keydown",i)):(document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",i))}),ue(()=>{document.removeEventListener("mousedown",n,!0),document.removeEventListener("keydown",i)});const c=()=>{e.setIsFilterPanelOpen(!e.isFilterPanelOpen()),e.setHeaderActionMenu(null)},s=()=>{e.setIsSettingsPanelOpen(!e.isSettingsPanelOpen()),e.setHeaderActionMenu(null)},p=()=>{e.setHeaderActionMenu(null)};return _(F,{get when(){return e.headerActionMenu()?.isOpen},get children(){return[(()=>{var l=Kn(),f=l.firstChild,u=f.firstChild;u.firstChild;var a=u.nextSibling,b=a.nextSibling;b.firstChild;var x=t;return typeof x=="function"?pe(x,l):t=l,u.$$click=c,d(u,_(F,{get when(){return e.isFilterPanelOpen()},get children(){return Xe()}}),null),a.$$click=p,b.$$click=s,d(b,_(F,{get when(){return e.isSettingsPanelOpen()},get children(){return Xe()}}),null),E(o=>R(l,`
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
        `,o)),l})(),qn()]}})}ie(["click"]);var Yn=k(`<div style="display:flex;height:100vh;background:#000000;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;overflow:hidden;"><div style=flex:1;position:relative;overflow-y:hidden;overflow-x:auto;min-width:0;></div><style>
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
      `);function Xn(e){return _(mt,{get wsUrl(){return e.wsUrl},get autoConnect(){return e.autoConnect},get children(){return _(Gn,{get apiBaseUrl(){return e.apiBaseUrl}})}})}function Gn(e){return(()=>{var t=Yn(),n=t.firstChild,i=n.nextSibling;return d(t,_(wt,{}),n),d(t,_(qt,{}),n),d(n,_(xn,{get apiBaseUrl(){return e.apiBaseUrl}})),d(t,_(Vt,{}),i),d(t,_(Tt,{}),i),d(t,_(Nt,{}),i),d(t,_(Dn,{}),null),d(t,_(En,{}),null),d(t,_(Tn,{}),null),d(t,_(Vn,{}),null),d(t,_(jn,{}),null),d(t,_(Bn,{}),null),t})()}class Qn extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const t=this.getAttribute("ws-url")||"ws://localhost:8080/ws",n=this.getAttribute("api-base-url")||"http://localhost:8080",i=this.getAttribute("auto-connect")==="true";this.dispose=ct(()=>_(Xn,{wsUrl:t,apiBaseUrl:n,autoConnect:i}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Qn),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
