import{d as ce,t as C,a as H,c as P,b as L,s as D,e as w,i as l,f as S,S as te,F as G,g as K,o as Ce,m as de,u as Ke,h as xt,r as mt}from"./web-BLoVs608.js";var vt=C(`<div title="Drag to resize panel"><div class=resize-handle-indicator style="content:'';position:absolute;top:50%;left:50%;transform:translate(-50%, -50%);width:2px;height:40px;background:#4a4a4a;border-radius:1px;transition:background-color 0.2s ease;"></div><style>
        .resize-handle:hover,
        .resize-handle.dragging {
          background: #ff00ff;
        }

        .resize-handle:hover .resize-handle-indicator,
        .resize-handle.dragging .resize-handle-indicator {
          background: #ffffff;
        }
      `);function je(e){return(()=>{var i=vt();return i.firstChild,H(i,"mousedown",e.onMouseDown),P(a=>{var s=`resize-handle resize-handle-${e.position} ${e.isDragging?"dragging":""} ${e.className||""}`,c=`
        position: absolute;
        top: 0;
        ${e.position==="left"?"left: -4px;":"right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: background-color 0.2s ease;
      `;return s!==a.e&&L(i,a.e=s),a.t=D(i,c,a.t),a},{e:void 0,t:void 0}),i})()}ce(["mousedown"]);function Ge(e){const[i,a]=w(e.initialWidth),[s,c]=w(!1),F=e.minWidth||250,m=e.maxWidth||600;return{width:i,setWidth:a,isDragging:s,handleMouseDown:(I,A="right")=>{I.preventDefault(),c(!0),document.body.classList.add("resizing");const y=I.clientX,R=i(),O=B=>{const f=B.clientX-y,_=A==="right"?Math.max(F,Math.min(m,R-f)):Math.max(F,Math.min(m,R+f));a(_),e.onWidthChange?.(_)},V=()=>{c(!1),document.body.classList.remove("resizing"),document.removeEventListener("mousemove",O),document.removeEventListener("mouseup",V)};document.addEventListener("mousemove",O),document.addEventListener("mouseup",V)}}}var $t=C('<button class=panel-close-button style="position:absolute;top:10px;right:10px;background:transparent;border:none;color:#888;cursor:pointer;font-size:14px;padding:4px 8px;border-radius:4px;transition:background-color 0.2s;">← Hide Browse'),pt=C(`<div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."style="width:100%;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div><style>
        .browse-panel.resizing {
          pointer-events: auto;
        }

        .filter-input:focus {
          outline: none;
          border-color: #0070f3;
        }

        .panel-close-button:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `);function wt(e){const i=Ge({initialWidth:e.initialWidth,minWidth:300,maxWidth:800,onWidthChange:e.onWidthChange});return(()=>{var a=pt(),s=a.firstChild,c=s.firstChild,F=c.nextSibling,m=s.nextSibling;return l(a,S(te,{get when(){return e.isOpen},get children(){var g=$t();return H(g,"click",e.onTogglePanel),g}}),s),F.$$input=g=>e.onFilterChange("name",g.currentTarget.value),l(a,S(je,{position:"right",get isDragging(){return i.isDragging()},onMouseDown:g=>i.handleMouseDown(g,"left")}),m),P(g=>{var I=`browse-panel ${e.isOpen?"":"collapsed"} ${i.isDragging()?"resizing":""}`,A=`
        width: ${i.width()}px;
        background: #2a2a2a;
        border-right: 1px solid #3a3a3a;
        padding: 20px;
        overflow-y: auto;
        transition: margin-left 0.3s ease;
        position: relative;
        flex-shrink: 0;
        ${e.isOpen?"":`margin-left: -${i.width()}px;`}
      `;return I!==g.e&&L(a,g.e=I),g.t=D(a,A,g.t),g},{e:void 0,t:void 0}),P(()=>F.value=e.filterConfig.name),a})()}ce(["click","input"]);var yt=C('<button class=panel-close-button style="position:absolute;top:10px;right:10px;background:transparent;border:none;color:#888;cursor:pointer;font-size:14px;padding:4px 8px;border-radius:4px;transition:background-color 0.2s;">Hide Controls →'),St=C('<div style=margin-bottom:8px;><button class=ws-button style="background:#f59e0b;border:1px solid #f59e0b;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Apply <!> Updates'),Ct=C('<div class=filter-section><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🐛 Debug Logs</h3><div class=debug-logs style="max-height:200px;overflow-y:auto;background:#111111;border:1px solid #333333;border-radius:4px;padding:8px;">'),_t=C(`<div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style="width:100%;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;margin-bottom:8px;"><div style=margin-bottom:8px;font-size:14px;>Status: <span></span></div><div style=margin-bottom:8px;><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:8px;transition:background-color 0.2s;">Connect</button><button class="ws-button danger"style="background:#666666;border:1px solid #666666;color:#ffffff;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background-color 0.2s;">Refresh</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📄 Content Type</h3><select class=filter-select style="width:100%;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🏷️ Blob Type</h3><select class=filter-select style="width:100%;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><option value>All Types</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📏 Size Range (bytes)</h3><div style=display:flex;gap:10px;align-items:center;><input class=filter-input type=number placeholder=Min style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><span style=color:#888;>-</span><input class=filter-input type=number placeholder=Max style="flex:1;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🔗 Has Parent</h3><select class=filter-select style="width:100%;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📁 Has Local Path</h3><select class=filter-select style="width:100%;padding:8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:14px;"><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">🎨 View Mode</h3><div style=display:flex;gap:4px;margin-bottom:12px;><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">👁️ Column Visibility</h3><button> Column Settings</button><div></div></div><div class=filter-section style=margin-bottom:24px;><h3 style="margin:0 0 12px 0;font-size:16px;color:#e0e0e0;">📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;line-height:1.4;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:8px;>Debug:<button></button></div><button class=reset-button title="Reset all filters and settings"style="width:100%;padding:8px;background:#ef4444;border:1px solid #ef4444;color:#ffffff;border-radius:4px;cursor:pointer;font-size:14px;transition:background-color 0.2s;">Reset All</button></div><style>
        .filter-panel.resizing {
          pointer-events: auto;
        }

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

        .panel-close-button:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .reset-button:hover {
          background: #dc2626;
        }
      `),He=C("<option>"),kt=C("<div style=margin-bottom:8px;><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox style=margin-right:8px;><span style=font-size:14px;color:#e0e0e0;>"),zt=C("<div style=font-size:11px;color:#888;margin-bottom:2px;font-family:monospace;>");function Mt(e){const[i,a]=w(!1),s=Ge({initialWidth:e.initialWidth,minWidth:300,maxWidth:800,onWidthChange:e.onWidthChange}),c=[{key:"id",title:"ID"},{key:"thumbnail",title:"Thumbnail"},{key:"mime",title:"MIME"},{key:"blob_type",title:"Type"},{key:"size",title:"Size"},{key:"parent_id",title:"Parent"},{key:"local_path",title:"Path"},{key:"created_at",title:"Created"},{key:"updated_at",title:"Updated"},{key:"actions",title:"Actions"}],F=m=>({Connected:"color: #10b981;",Connecting:"color: #f59e0b;",Disconnected:"color: #ef4444;",Error:"color: #ef4444;"})[m]||"color: #6b7280;";return(()=>{var m=_t(),g=m.firstChild,I=g.firstChild,A=I.nextSibling,y=A.nextSibling,R=y.firstChild,O=R.nextSibling,V=y.nextSibling,B=V.firstChild,f=B.nextSibling,_=V.nextSibling,W=_.firstChild,h=W.nextSibling,b=g.nextSibling,v=b.firstChild,z=v.nextSibling,d=z.firstChild,x=d.nextSibling,k=b.nextSibling,$=k.firstChild,U=$.nextSibling;U.firstChild;var ne=k.nextSibling,xe=ne.firstChild,ie=xe.nextSibling;ie.firstChild;var ue=ne.nextSibling,le=ue.firstChild,me=le.nextSibling,re=me.firstChild,ve=re.nextSibling,X=ve.nextSibling,ae=ue.nextSibling,$e=ae.firstChild,ge=$e.nextSibling,fe=ae.nextSibling,pe=fe.firstChild,se=pe.nextSibling,he=fe.nextSibling,we=he.firstChild,ye=we.nextSibling,J=ye.firstChild,Y=J.nextSibling,T=Y.nextSibling,n=he.nextSibling,o=n.firstChild,r=o.nextSibling,u=r.firstChild,E=r.nextSibling,Q=n.nextSibling,p=Q.firstChild,N=p.nextSibling,Je=N.firstChild,ke=Je.nextSibling,Ye=ke.nextSibling,Qe=Ye.nextSibling,Ze=Qe.nextSibling,ze=Ze.nextSibling,et=ze.nextSibling,tt=et.nextSibling,nt=tt.nextSibling,Me=nt.nextSibling,it=Me.nextSibling,De=it.nextSibling,ot=De.nextSibling,lt=ot.nextSibling;lt.nextSibling;var Re=N.nextSibling,rt=Re.firstChild,be=rt.nextSibling,at=Re.nextSibling,Te=Q.nextSibling;return l(m,S(te,{get when(){return e.isOpen},get children(){var t=yt();return H(t,"click",e.onTogglePanel),t}}),g),A.$$input=t=>e.onWsUrlChange(t.currentTarget.value),l(O,()=>e.connectionStatus),H(B,"click",e.onConnect),H(f,"click",e.onDisconnect),H(h,"click",e.onToggleAutoConnect),l(h,()=>e.autoConnect?"ON":"OFF"),H(d,"click",e.onToggleAutoRefresh),l(d,()=>e.autoRefresh?"ON":"OFF"),H(x,"click",e.onRefresh),l(b,S(te,{get when(){return e.hasPendingUpdates&&!e.autoRefresh},get children(){var t=St(),M=t.firstChild,Z=M.firstChild,q=Z.nextSibling;return q.nextSibling,H(M,"click",e.onApplyPendingUpdates),l(M,()=>e.pendingUpdatesCount,q),t}}),null),U.addEventListener("change",t=>e.onFilterChange("mime",t.currentTarget.value)),l(U,S(G,{get each(){return e.mimeCategories},children:t=>(()=>{var M=He();return M.value=t,l(M,t),M})()}),null),ie.addEventListener("change",t=>e.onFilterChange("blobType",t.currentTarget.value)),l(ie,S(G,{get each(){return e.blobTypes},children:t=>(()=>{var M=He();return M.value=t,l(M,t),M})()}),null),re.$$input=t=>e.onFilterChange("minSize",parseInt(t.currentTarget.value)||0),X.$$input=t=>e.onFilterChange("maxSize",parseInt(t.currentTarget.value)||1e8),ge.addEventListener("change",t=>e.onFilterChange("hasParent",t.currentTarget.value)),se.addEventListener("change",t=>e.onFilterChange("hasLocalPath",t.currentTarget.value)),J.$$click=()=>e.onViewModeChange("compact"),Y.$$click=()=>e.onViewModeChange("default"),T.$$click=()=>e.onViewModeChange("detailed"),r.$$click=()=>a(!i()),l(r,()=>i()?"Hide":"Show",u),l(E,S(G,{each:c,children:t=>(()=>{var M=kt(),Z=M.firstChild,q=Z.firstChild,ee=q.nextSibling;return q.addEventListener("change",()=>e.onColumnToggle(t.key)),l(ee,()=>t.title),P(()=>q.checked=e.columnVisibility[t.key]),M})()})),l(N,()=>e.totalCount,ke),l(N,()=>e.filteredCount,ze),l(N,()=>e.sortConfig.field,Me),l(N,()=>e.sortConfig.direction,De),l(N,()=>e.lastUpdated?.toLocaleTimeString()||"Never",null),H(be,"click",e.onToggleDebug),l(be,()=>e.debug?"ON":"OFF"),H(at,"click",e.onReset),l(m,S(te,{get when(){return e.debug&&e.logs.length>0},get children(){var t=Ct(),M=t.firstChild,Z=M.nextSibling;return l(Z,S(G,{get each(){return e.logs},children:q=>(()=>{var ee=zt();return l(ee,q),ee})()})),t}}),Te),l(m,S(je,{position:"left",get isDragging(){return s.isDragging()},onMouseDown:t=>s.handleMouseDown(t,"right")}),Te),P(t=>{var M=`filter-panel ${e.isOpen?"":"collapsed"} ${s.isDragging()?"resizing":""}`,Z=`
        width: ${s.width()}px;
        background: #2a2a2a;
        border-left: 1px solid #3a3a3a;
        padding: 20px;
        overflow-y: auto;
        transition: margin-right 0.3s ease;
        position: relative;
        flex-shrink: 0;
        ${e.isOpen?"":`margin-right: -${s.width()}px;`}
      `,q=F(e.connectionStatus),ee=e.connectionStatus==="Connected",Pe=e.connectionStatus==="Disconnected",Fe=`toggle-button ${e.autoConnect?"active":""}`,st=`
              background: ${e.autoConnect?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoConnect?"#ff00ff":"#666666"};
              color: ${e.autoConnect?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,Ie=`toggle-button ${e.autoRefresh?"active":""}`,dt=`
              background: ${e.autoRefresh?"#ff00ff":"#333333"};
              border: 1px solid ${e.autoRefresh?"#ff00ff":"#666666"};
              color: ${e.autoRefresh?"#000000":"#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `,We=`view-mode-button ${e.viewMode==="compact"?"active":""}`,ct=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="compact"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="compact"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="compact"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Le=`view-mode-button ${e.viewMode==="default"?"active":""}`,ut=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="default"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="default"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="default"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Ae=`view-mode-button ${e.viewMode==="detailed"?"active":""}`,gt=`
              flex: 1;
              padding: 6px 12px;
              background: ${e.viewMode==="detailed"?"#ff00ff":"#333333"};
              border: 1px solid ${e.viewMode==="detailed"?"#ff00ff":"#666666"};
              color: ${e.viewMode==="detailed"?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `,Oe=`toggle-button ${i()?"active":""}`,ft=`
            margin-bottom: 8px;
            width: 100%;
            padding: 8px;
            background: ${i()?"#ff00ff":"#333333"};
            border: 1px solid ${i()?"#ff00ff":"#666666"};
            color: ${i()?"#000000":"#ffffff"};
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          `,Ue=`column-settings ${i()?"":"collapsed"}`,ht=`
            max-height: ${i()?"400px":"0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
          `,Ee=`toggle-button ${e.debug?"active":""}`,bt=`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${e.debug?"#ff00ff":"#333333"};
              border: 1px solid ${e.debug?"#ff00ff":"#666666"};
              color: ${e.debug?"#000000":"#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `;return M!==t.e&&L(m,t.e=M),t.t=D(m,Z,t.t),t.a=D(O,q,t.a),ee!==t.o&&(B.disabled=t.o=ee),Pe!==t.i&&(f.disabled=t.i=Pe),Fe!==t.n&&L(h,t.n=Fe),t.s=D(h,st,t.s),Ie!==t.h&&L(d,t.h=Ie),t.r=D(d,dt,t.r),We!==t.d&&L(J,t.d=We),t.l=D(J,ct,t.l),Le!==t.u&&L(Y,t.u=Le),t.c=D(Y,ut,t.c),Ae!==t.w&&L(T,t.w=Ae),t.m=D(T,gt,t.m),Oe!==t.f&&L(r,t.f=Oe),t.y=D(r,ft,t.y),Ue!==t.g&&L(E,t.g=Ue),t.p=D(E,ht,t.p),Ee!==t.b&&L(be,t.b=Ee),t.T=D(be,bt,t.T),t},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0,b:void 0,T:void 0}),P(()=>A.value=e.wsUrl),P(()=>U.value=e.filterConfig.mime),P(()=>ie.value=e.filterConfig.blobType),P(()=>re.value=e.filterConfig.minSize),P(()=>X.value=e.filterConfig.maxSize),P(()=>ge.value=e.filterConfig.hasParent),P(()=>se.value=e.filterConfig.hasLocalPath),m})()}ce(["click","input"]);const Se={name:"dark",colors:{background:"#1a1a1a",text:"#e0e0e0",border:"#3a3a3a",header:"#2a2a2a",hover:"#2a2a2a",selected:"#0070f3"}},Dt={dark:Se,light:{name:"light",colors:{background:"#ffffff",text:"#333333",border:"#e0e0e0",header:"#f5f5f5",hover:"#f5f5f5",selected:"#0070f3"}}};function Rt(e){const[i,a]=w(e.initialSort||{field:"id",direction:"asc"}),[s,c]=w(new Set),[F,m]=w(!1),g=e.getItemId||(f=>f.id||String(f)),I=K(()=>{const f=i();return[...e.data].sort((W,h)=>{const b=W[f.field],v=h[f.field];let z=0;return b<v?z=-1:b>v&&(z=1),f.direction==="desc"?z*-1:z})});return{sortConfig:i,selectedItems:s,isDragSelecting:F,sortedData:I,handleSort:f=>{const _=i(),W=_.field===f&&_.direction==="asc"?"desc":"asc";a({field:f,direction:W})},toggleSelection:f=>{const _=new Set(s());_.has(f)?_.delete(f):_.add(f),c(_)},clearSelection:()=>{c(new Set)},selectAll:()=>{const f=new Set(e.data.map(g));c(f)},isSelected:f=>s().has(f),selectRange:(f,_)=>{const W=new Set(s()),h=Math.min(f,_),b=Math.max(f,_);for(let v=h;v<=b;v++)if(v<e.data.length&&e.data[v]!=null){const z=g(e.data[v]);W.add(z)}c(W)},setIsDragSelecting:m,getItemId:g}}var Tt=C("<div class=grid-row>"),Pt=C("<div class=grid-cell>"),Ve=C("<div class=grid-content>"),Ft=C("<div><div class=grid-header></div><div class=grid-body style=flex:1;overflow-y:auto;position:relative;></div><style>"),It=C("<span style=font-size:12px;>"),Wt=C("<div><span>"),Lt=C("<div>");function Be(e){let i;return Ce(()=>{e.onRowMount&&e.onRowMount(e.item)}),(()=>{var a=Tt();a.$$contextmenu=c=>e.onContextMenu?.(e.item,e.index,c),a.$$mousedown=c=>e.onRowMouseDown?.(e.item,e.index,c),a.$$dblclick=c=>e.onRowDoubleClick?.(e.item,e.index,c),a.$$click=c=>e.onRowClick?.(e.item,e.index,c);var s=i;return typeof s=="function"?Ke(s,a):i=a,l(a,S(G,{get each(){return e.columns},children:c=>(()=>{var F=Pt();return l(F,(()=>{var m=de(()=>!!c.render);return()=>m()?c.render(e.item,e.index):String(e.item[c.key]||"")})()),P(m=>D(F,`
              flex: ${c.width?"0 0 "+c.width+"px":"1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `,m)),F})()})),P(c=>D(a,`
        height: ${e.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${e.theme.colors.border};
        background: ${e.isSelected?e.theme.colors.selected:"transparent"};
        transition: background-color 0.15s ease;
      `,c)),a})()}function At(e){const[i,a]=w(),[s,c]=w(0),[F,m]=w(0),g=e.rowHeight||50,I=e.headerHeight||60,A=e.virtualizeThreshold||100,y=Rt({data:e.data,getItemId:e.getItemId,initialSort:e.sortField?{field:e.sortField,direction:e.sortDirection||"asc"}:void 0}),R=K(()=>{if(typeof e.theme=="string"){const h=Dt[e.theme];return h||Se}return e.theme?e.theme:Se}),O=K(()=>e.data.length>A),V=K(()=>{if(!O())return e.data.map(($,U)=>({item:$,index:U}));if(!i())return[];const b=g,v=s(),z=F(),d=Math.floor(v/b),x=Math.min(e.data.length-1,Math.ceil((v+z)/b)+5),k=[];for(let $=Math.max(0,d-5);$<=x;$++)$<e.data.length&&e.data[$]!=null&&k.push({item:e.data[$],index:$});return k}),B=K(()=>e.data.length*g),f=h=>{const b=h.target;c(b.scrollTop)},_=h=>{if(y.handleSort(h),e.onSort){const b=y.sortConfig();e.onSort(b.field,b.direction)}},W=(h,b,v)=>{const z=y.getItemId(h);if(v.ctrlKey||v.metaKey)y.toggleSelection(z);else if(v.shiftKey&&y.selectedItems().size>0){const d=e.data,x=Array.from(y.selectedItems()).pop();if(x){const k=d.findIndex($=>y.getItemId($)===x);k!==-1&&y.selectRange(k,b)}}else y.clearSelection(),y.toggleSelection(z);e.onRowClick?.(h,b,v)};return Ce(()=>{const h=i();if(!h)return;const b=new ResizeObserver(v=>{for(const z of v)m(z.contentRect.height)});b.observe(h),xt(()=>{b.disconnect()})}),(()=>{var h=Ft(),b=h.firstChild,v=b.nextSibling,z=v.nextSibling;return l(b,S(G,{get each(){return e.columns},children:d=>(()=>{var x=Wt(),k=x.firstChild;return x.$$click=()=>d.sortable&&_(d.key),l(k,()=>d.title),l(x,S(te,{get when(){return de(()=>!!d.sortable)()&&y.sortConfig().field===d.key},get children(){var $=It();return l($,()=>y.sortConfig().direction==="asc"?"↑":"↓"),$}}),null),P($=>{var U=`grid-header-cell ${d.sortable?"sortable":""}`,ne=`
                flex: ${d.width?"0 0 "+d.width+"px":"1"};
                padding: 8px 12px;
                cursor: ${d.sortable?"pointer":"default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `;return U!==$.e&&L(x,$.e=U),$.t=D(x,ne,$.t),$},{e:void 0,t:void 0}),x})()})),v.addEventListener("scroll",f),Ke(a,v),l(v,S(te,{get when(){return O()},get fallback(){return(()=>{var d=Ve();return l(d,S(G,{get each(){return e.data},children:(x,k)=>S(Be,{item:x,get index(){return k()},get columns(){return e.columns},get isSelected(){return y.isSelected(y.getItemId(x))},onRowClick:W,get onRowDoubleClick(){return e.onRowDoubleClick},get onRowMouseDown(){return e.onRowMouseDown},get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},get theme(){return R()},rowHeight:g})})),d})()},get children(){var d=Ve();return l(d,S(G,{get each(){return V()},children:x=>(()=>{var k=Lt();return l(k,S(Be,{get item(){return x.item},get index(){return x.index},get columns(){return e.columns},get isSelected(){return y.isSelected(y.getItemId(x.item))},onRowClick:W,get onRowDoubleClick(){return e.onRowDoubleClick},get onRowMouseDown(){return e.onRowMouseDown},get onRowMount(){return e.onRowMount},get onContextMenu(){return e.onContextMenu},get theme(){return R()},rowHeight:g})),P($=>D(k,`
                    position: absolute;
                    top: ${x.index*g}px;
                    left: 0;
                    right: 0;
                  `,$)),k})()})),P(x=>D(d,`height: ${B()}px; position: relative;`,x)),d}})),l(z,()=>`
        .grid-row:hover {
          background: ${R().colors.hover} !important;
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${R().colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${R().colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${R().colors.text};
        }
      `),P(d=>{var x=`infinite-data-grid ${e.className||""}`,k=`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${R().colors.background};
        color: ${R().colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `,$=`
          height: ${I}px;
          display: flex;
          align-items: center;
          background: ${R().colors.header};
          border-bottom: 2px solid ${R().colors.border};
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
        `;return x!==d.e&&L(h,d.e=x),d.t=D(h,k,d.t),d.a=D(b,$,d.a),d},{e:void 0,t:void 0,a:void 0}),h})()}ce(["click","dblclick","mousedown","contextmenu"]);var Ot=C("<span style=font-family:monospace;font-size:12px;>"),Ut=C("<div style=width:40px;height:40px;border-radius:4px;overflow:hidden;background:#333;display:flex;align-items:center;justify-content:center;font-size:12px;>"),oe=C("<span>"),Et=C('<button style="background:#0070f3;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;">View'),Ht=C('<button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:14px;">Show Browse →'),Vt=C(`<div style="height:100vh;width:100vw;background:#1a1a1a;color:#e0e0e0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;overflow:hidden;position:relative;max-width:100%;"><div style=flex:1;position:relative;overflow:hidden;min-width:200px;><div style=position:absolute;bottom:20px;left:20px;z-index:10;display:flex;flex-direction:column;gap:12px;><div style=display:flex;align-items:center;gap:12px;><button style="background:#ff00ff;border:1px solid #ff00ff;color:#000000;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:14px;"></button></div></div></div><style>
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }

        * {
          box-sizing: border-box;
        }
      `);const _e="freqhole-demo-state",Ne=300;function Xe(){try{const e=localStorage.getItem(_e);return e?JSON.parse(e):{}}catch{return{}}}function j(e){try{const a={...Xe(),...e};localStorage.setItem(_e,JSON.stringify(a))}catch{}}function Bt(e){const i=Xe(),[a,s]=w([]),[c,F]=w({name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all",...i.filterConfig||{}}),[m,g]=w({field:"created_at",direction:"desc",...i.sortConfig||{}}),[I,A]=w(i.viewMode||"default"),[y,R]=w({id:!0,thumbnail:!0,mime:!0,blob_type:!0,size:!0,parent_id:!1,local_path:!1,created_at:!0,updated_at:!1,actions:!0,...i.columnVisibility||{}}),[O,V]=w(i.isFilterPanelOpen??!0),[B,f]=w(i.filterPanelWidth||Ne),[_,W]=w(i.isBrowsePanelOpen??!0),[h,b]=w(i.browsePanelWidth||Ne),[v,z]=w(e.wsUrl),[d,x]=w(e.autoConnect),[k,$]=w(!0),[U,ne]=w(!1),[xe,ie]=w([]),[ue,le]=w("Disconnected"),[me,re]=w(!1),[ve,X]=w(null),ae=K(()=>{const n=c();return a().filter(o=>{if(n.name&&!Nt(o).toLowerCase().includes(n.name.toLowerCase())||n.mime&&!o.mime?.startsWith(n.mime)||n.blobType&&o.blob_type!==n.blobType||o.size<n.minSize||o.size>n.maxSize)return!1;if(n.hasParent!=="all"){const r=!!o.parent_id;if(n.hasParent==="yes"&&!r||n.hasParent==="no"&&r)return!1}if(n.hasLocalPath!=="all"){const r=!!o.local_path;if(n.hasLocalPath==="yes"&&!r||n.hasLocalPath==="no"&&r)return!1}return!0})}),$e=K(()=>{const n=m();return[...ae()].sort((r,u)=>{const E=r[n.field],Q=u[n.field];let p=0;return E<Q?p=-1:E>Q&&(p=1),n.direction==="desc"?p*-1:p})}),ge=K(()=>{const n=y(),o=[];return n.id&&o.push({key:"id",title:"ID",width:200,sortable:!0,render:r=>(()=>{var u=Ot();return l(u,()=>r.id),u})()}),n.thumbnail&&o.push({key:"thumbnail",title:"📷",width:60,render:r=>(()=>{var u=Ut();return l(u,(()=>{var E=de(()=>!!r.mime?.startsWith("image/"));return()=>E()?"🖼️":de(()=>!!r.mime?.startsWith("video/"))()?"🎥":r.mime?.startsWith("audio/")?"🎵":"📄"})()),u})()}),n.mime&&o.push({key:"mime",title:"MIME Type",width:150,sortable:!0,render:r=>(()=>{var u=oe();return l(u,()=>r.mime||"unknown"),u})()}),n.blob_type&&o.push({key:"blob_type",title:"Type",width:100,sortable:!0}),n.size&&o.push({key:"size",title:"Size",width:100,sortable:!0,render:r=>(()=>{var u=oe();return l(u,()=>qt(r.size)),u})()}),n.parent_id&&o.push({key:"parent_id",title:"Parent",width:120,render:r=>(()=>{var u=oe();return l(u,()=>r.parent_id?"Yes":"No"),u})()}),n.local_path&&o.push({key:"local_path",title:"Local Path",width:200,render:r=>(()=>{var u=oe();return l(u,()=>r.local_path||"None"),u})()}),n.created_at&&o.push({key:"created_at",title:"Created",width:140,sortable:!0,render:r=>(()=>{var u=oe();return l(u,()=>new Date(r.created_at).toLocaleString()),u})()}),n.updated_at&&o.push({key:"updated_at",title:"Updated",width:140,sortable:!0,render:r=>(()=>{var u=oe();return l(u,()=>new Date(r.updated_at).toLocaleString()),u})()}),n.actions&&o.push({key:"actions",title:"Actions",width:100,render:r=>(()=>{var u=Et();return u.$$click=()=>window.open(`${e.apiBaseUrl}/api/blobs/${r.id}`,"_blank"),u})()}),o}),fe=K(()=>[...new Set(a().map(o=>o.mime?.split("/")[0]).filter(Boolean))].sort()),pe=K(()=>[...new Set(a().map(o=>o.blob_type))].sort()),se=(n,o)=>{F(r=>({...r,[n]:o})),j({filterConfig:{...c(),[n]:o}})},he=(n,o)=>{g({field:n,direction:o}),j({sortConfig:{field:n,direction:o}})},we=n=>{A(n),j({viewMode:n})},ye=n=>{R(o=>{const r={...o,[n]:!o[n]};return j({columnVisibility:r}),r})},J=()=>{W(n=>{const o=!n;return j({isBrowsePanelOpen:o}),o})},Y=()=>{V(n=>{const o=!n;return j({isFilterPanelOpen:o}),o})},T=n=>{const o=new Date().toLocaleTimeString();ie(r=>[`${o}: ${n}`,...r.slice(0,49)])};return Ce(async()=>{T("🚀 FreqholeDemo mounted");try{const n=await fetch(`${e.apiBaseUrl}/api/blobs`);if(n.ok){const o=await n.json();s(o),X(new Date),T(`📦 Loaded ${o.length} media blobs`)}else T("⚠️ Using mock data (server not available)"),s(qe()),X(new Date)}catch{T("⚠️ Using mock data (server error)"),s(qe()),X(new Date)}e.autoConnect&&(le("Connected"),T("🔌 Auto-connected to WebSocket"))}),(()=>{var n=Vt(),o=n.firstChild,r=o.firstChild,u=r.firstChild,E=u.firstChild,Q=o.nextSibling;return l(n,S(wt,{get isOpen(){return _()},get filterConfig(){return c()},onTogglePanel:J,onFilterChange:se,onWidthChange:p=>{b(p),j({browsePanelWidth:p})},get initialWidth(){return h()}}),o),l(o,S(At,{get data(){return $e()},get columns(){return ge()},onSort:he,get sortField(){return m().field},get sortDirection(){return m().direction},get rowHeight(){return de(()=>I()==="compact")()?40:I()==="detailed"?80:60},headerHeight:60,theme:"dark",getItemId:p=>p.id}),r),l(u,S(te,{get when(){return!_()},get children(){var p=Ht();return p.$$click=J,p}}),E),E.$$click=Y,l(E,()=>O()?"← Hide Controls":"Show Controls →"),l(n,S(Mt,{get isOpen(){return O()},get filterConfig(){return c()},get viewMode(){return I()},get columnVisibility(){return y()},get wsUrl(){return v()},get autoConnect(){return d()},get autoRefresh(){return k()},get debug(){return U()},get connectionStatus(){return ue()},get hasPendingUpdates(){return me()},pendingUpdatesCount:0,get filteredCount(){return ae().length},get totalCount(){return a().length},get sortConfig(){return m()},get lastUpdated(){return ve()},get mimeCategories(){return fe()},get blobTypes(){return pe()},get logs(){return xe()},onTogglePanel:Y,onFilterChange:se,onViewModeChange:we,onColumnToggle:ye,onWsUrlChange:z,onConnect:()=>{le("Connected"),T("🔌 Connected to WebSocket")},onDisconnect:()=>{le("Disconnected"),T("🔌 Disconnected from WebSocket")},onRefresh:async()=>{T("🔄 Refreshing data...");try{const p=await fetch(`${e.apiBaseUrl}/api/blobs`);if(p.ok){const N=await p.json();s(N),X(new Date),T(`📦 Refreshed ${N.length} media blobs`)}}catch{T("❌ Refresh failed")}},onApplyPendingUpdates:()=>{re(!1),T("📥 Applied pending updates")},onToggleAutoConnect:()=>{x(p=>!p),T(`🔧 Auto-connect: ${d()?"OFF":"ON"}`)},onToggleAutoRefresh:()=>{$(p=>!p),T(`🔧 Auto-refresh: ${k()?"OFF":"ON"}`)},onToggleDebug:()=>{ne(p=>!p),T(`🐛 Debug: ${U()?"OFF":"ON"}`)},onReset:()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(_e),window.location.reload())},onWidthChange:p=>{f(p),j({filterPanelWidth:p})},get initialWidth(){return B()}}),Q),n})()}function Nt(e){if(e.local_path){const i=e.local_path.split(/[/\\]/);return i[i.length-1]||e.id}return e.id}function qt(e){if(e===0)return"0 B";const i=1024,a=["B","KB","MB","GB"],s=Math.floor(Math.log(e)/Math.log(i));return parseFloat((e/Math.pow(i,s)).toFixed(2))+" "+a[s]}function qe(){const e=["image/jpeg","image/png","video/mp4","audio/mp3","text/plain","application/pdf"],i=["upload","thumbnail","processed","backup"];return Array.from({length:1e3},(a,s)=>({id:`blob-${s+1}`,mime:e[Math.floor(Math.random()*e.length)],blob_type:i[Math.floor(Math.random()*i.length)],size:Math.floor(Math.random()*1e7),parent_id:Math.random()>.7?`blob-${Math.floor(Math.random()*s)+1}`:void 0,local_path:Math.random()>.5?`/path/to/file-${s+1}.ext`:void 0,created_at:new Date(Date.now()-Math.random()*864e5*30).toISOString(),updated_at:new Date(Date.now()-Math.random()*864e5*7).toISOString()}))}ce(["click"]);class Kt extends HTMLElement{dispose;connectedCallback(){console.log("🔌 FreqholeDemoElement connected");const i=this.getAttribute("ws-url")||"ws://localhost:8080/ws",a=this.getAttribute("api-base-url")||"http://localhost:8080",s=this.getAttribute("auto-connect")==="true";this.dispose=mt(()=>S(Bt,{wsUrl:i,apiBaseUrl:a,autoConnect:s}),this),console.log("✅ FreqholeDemo render successful")}disconnectedCallback(){console.log("🔌 FreqholeDemoElement disconnected"),this.dispose&&this.dispose()}}customElements.get("freqhole-demo")?console.log("⚠️ freqhole-demo custom element already registered"):(console.log("📝 About to register freqhole-demo custom element"),customElements.define("freqhole-demo",Kt),console.log("✅ freqhole-demo custom element registered successfully"));
//# sourceMappingURL=freqhole-demo.js.map
