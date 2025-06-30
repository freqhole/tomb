import{d as hi,r as mi,f as g,c as x,k as se,t as d,i as o,g as A,S as w,b as C,e as T,o as xi,h as Vt,m as Ne,F as _e,s as Q}from"./web-xBr4R5eT.js";import{G as vi}from"./generic-infinite-grid-DtuMfZQv.js";import{u as $i}from"./useWebSocketFeed-B7jFQCBo.js";import{C as de}from"./websocket-types-jbyVc1Fl.js";import{g as wi,h as Ht,a as _i}from"./thumbnail-utils-C-GIDKg1.js";import"./websocket-client-DdAbsgHN.js";import"./types-DDODKsJP.js";var yi=d("<img alt=Thumbnail style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),Si=d('<div style="position:absolute;bottom:2px;right:2px;width:8px;height:8px;background:#ff00ff;border-radius:50%;border:1px solid #ffffff;"title="Has thumbnails">'),Ut=d("<div>"),ki=d('<div style="width:12px;height:12px;border:2px solid #ff00ff;border-top:2px solid transparent;border-radius:50%;animation:spin 1s linear infinite;"title="Generating thumbnail...">'),Ci=d("<span style=font-size:16px;>"),zi=d('<code style="font-size:11px;background:#333;padding:2px 4px;border-radius:3px;color:#0ff;">...'),Mi=d('<code style="font-size:11px;background:#333;padding:2px 4px;border-radius:3px;color:#f90;">...'),Di=d("<span style=font-weight:500;color:#e0e0e0;>"),Ii=d("<span>"),Pi=d("<span style=font-family:monospace;font-size:12px;>"),Li=d("<span style=color:#ffffff;font-weight:600;font-size:12px;>"),Ti=d("<span style=color:#ff00ff;font-size:11px;>✓"),Gt=d("<span style=color:#666;>-"),Ei=d("<span style=color:#ff00ff;font-size:11px;>📁"),Nt=d("<span style=font-size:12px;color:#888;>"),Ai=d('<div style=position:relative;><button style="background:#3a3a3a;border:1px solid #4a4a4a;color:#e0e0e0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;"data-action-button>⋯'),Bi=d("<button class=panel-close-button>← Hide Browse"),Fi=d("<button class=panel-toggle-button>Show Browse →"),Ri=d("<div class=bulk-actions><span> item<!> selected</span><button class=bulk-action-button>📥 Download</button><div style=position:relative;><button class=bulk-action-button>⋯ More</button></div><button class=bulk-action-button style=background:#666666;border-color:#666666;>✕"),Wi=d("<button class=panel-close-button>Hide Controls →"),Vi=d("<div style=margin-bottom:8px;><button class=ws-button style=background:#f59e0b;border-color:#f59e0b;>Apply <!> Updates"),Hi=d("<div class=filter-section><h3>🐛 Debug Logs</h3><div class=debug-logs>"),Ui=d("<div class=popup-overlay><div class=popup-content><button class=popup-close>×"),Gi=d("<div class=drag-selection-box>"),Ni=d('<div class=mediablob-data-grid-container><style></style><div><div class=filter-section><h3>🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."></div><div title="Drag to resize panel"></div></div><div class=toolbar-container><div class=controls-row><button class=panel-toggle-button></button></div></div><div></div><div><div class=filter-section><h3>🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style=margin-bottom:8px;><div style=margin-bottom:8px;>Status: <span></span></div><div style=margin-bottom:8px;><button class=ws-button>Connect</button><button class="ws-button danger">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section><h3>🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button>Refresh</button></div></div><div class=filter-section><h3>📄 Content Type</h3><select class=filter-select><option value>All Types</option></select></div><div class=filter-section><h3>🏷️ Blob Type</h3><select class=filter-select><option value>All Types</option></select></div><div class=filter-section><h3>📏 Size Range (bytes)</h3><div class=filter-range><input class=filter-input type=number placeholder=Min><span>-</span><input class=filter-input type=number placeholder=Max></div></div><div class=filter-section><h3>🔗 Has Parent</h3><select class=filter-select><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section><h3>📁 Has Local Path</h3><select class=filter-select><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section><h3>🎨 View Mode</h3><div class=view-mode-selector><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section><h3>👁️ Column Visibility</h3><button style=margin-bottom:8px;width:100%;> Column Settings</button><div></div></div><div class=filter-section><h3>📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:8px;>Debug:<button style=margin-left:8px;></button></div><button class=reset-button title="Reset all filters and settings">Reset All</button></div><div title="Drag to resize panel">'),Ot=d("<option>"),Oi=d("<div class=column-toggle><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox><span>"),Xi=d("<img class=popup-image>"),Ki=d("<video class=popup-video controls preload=metadata><source>Your browser does not support video playback."),qi=d('<audio controls style="width:100%;margin:20px 0;"preload=metadata><source>Your browser does not support audio playback.'),ji=d('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;">Download File'),Yi=d("<div class=popup-meta-row><span class=popup-meta-label>Parent:</span><span style=font-family:monospace;font-size:12px;>"),Ji=d("<div class=popup-meta-row><span class=popup-meta-label>Local Path:</span><span style=font-family:monospace;font-size:12px;>"),Zi=d('<div><h3 style="margin:0 0 16px 0;color:#e0e0e0;"></h3><div class=popup-meta><div class=popup-meta-row><span class=popup-meta-label>ID:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>SHA256:</span><span style=font-family:monospace;font-size:12px;></span></div><div class=popup-meta-row><span class=popup-meta-label>Type:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>MIME:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>Size:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>Created:</span><span>'),Qi=d("<button class=action-menu-item><span>👁️</span><span>Preview"),eo=d('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;"> items selected'),to=d("<div class=action-menu><button class=action-menu-item><span>📥</span><span>Download </span></button><button class=action-menu-item><span>🎵</span><span>Add to Playlist </span></button><button class=action-menu-item style=color:#ef4444;><span>🗑️</span><span>Delete ");console.log("🚀 MediaBlob Data Grid script loading");const Oe="mediablob-grid-state",Xt=400;function qt(){try{const c=localStorage.getItem(Oe);return c?JSON.parse(c):{}}catch(c){return console.warn("Failed to load grid state from localStorage:",c),{}}}function z(c){try{const ye={...qt(),...c};localStorage.setItem(Oe,JSON.stringify(ye))}catch(v){console.warn("Failed to save grid state to localStorage:",v)}}function B(c){if(c.metadata&&typeof c.metadata=="object"){const v=c.metadata;if(v.originalName||v.filename||v.original_filename||v.file_name||v.name)return v.originalName||v.filename||v.original_filename||v.file_name||v.name}return c.filename||c.local_path?.split("/").pop()||`${c.sha256.slice(0,8)}...${c.sha256.slice(-4)}`}function Kt(c){return c?c.split("/")[0]:"unknown"}function no(){console.log("📦 MediaBlobDataGrid component created");const c=qt(),[v,ye]=x(c.sortConfig||{field:"created_at",direction:"desc"}),[K,jt]=x(c.filterConfig||{name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all"}),[Se,Yt]=x(c.isFilterPanelOpen??!0),[ce,Jt]=x(c.filterPanelWidth||Xt),[ke,Zt]=x(c.isBrowsePanelOpen??!0),[ue,Qt]=x(c.browsePanelWidth||Xt),[Ce,Xe]=x(!1),[ze,Ke]=x(!1),[qe,en]=x(c.wsUrl||"ws://localhost:8080/ws"),[Me,tn]=x(c.autoConnect??!0),[te,nn]=x(c.autoRefresh??!1),[ne,on]=x(c.debug??!1),[je,ln]=x([]),[G,rn]=x(c.viewMode||"default"),[Ye,an]=x(c.columnVisibility||{thumbnail:!0,id:!1,sha256:!1,name:!0,blob_type:!0,mime:!0,size:!0,parent_blob_id:!0,local_path:!0,created_at:!0,updated_at:!0,actions:!0}),[pe,sn]=x(!1),[Je,ge]=x(null),[Ze,Qe]=x(new Set),[et,ie]=x(null),[P,j]=x(new Set(c.selectedItems?Array.from(c.selectedItems):[])),[De,fe]=x(-1),[oe,tt]=x(!1),[Ie,nt]=x(null),[it,ot]=x(null),[Pe,be]=x(null),y=$i({wsUrl:qe(),channels:["MediaBlobs"],debug:ne(),autoConnect:Me(),autoRefresh:te(),pageSize:50}),$=e=>{if(ne()){const n=new Date().toLocaleTimeString();ln(t=>[...t.slice(-19),`[${n}] ${e}`])}},Le=se(()=>{const e=K();return y.state().items.filter(n=>{const t=B(n),l=Kt(n.mime||"");return t.toLowerCase().includes(e.name.toLowerCase())&&(e.mime===""||l===e.mime)&&(e.blobType===""||n.blob_type===e.blobType)&&(n.size||0)>=e.minSize&&(n.size||0)<=e.maxSize&&(e.hasParent==="all"||e.hasParent==="yes"&&n.parent_blob_id||e.hasParent==="no"&&!n.parent_blob_id)&&(e.hasLocalPath==="all"||e.hasLocalPath==="yes"&&n.local_path||e.hasLocalPath==="no"&&!n.local_path)})}),N=se(()=>{const e=v();return e.direction?[...Le()].sort((t,l)=>{let u,f;const s=Ee.find(_=>_.key===e.field);s&&s.getValue?(u=s.getValue(t),f=s.getValue(l)):(u=t[e.field],f=l[e.field]);let h=0;return u<f&&(h=-1),u>f&&(h=1),e.direction==="desc"?-h:h}):Le()}),dn=e=>_i(e,""),Te=e=>{rn(e),z({viewMode:e}),$(`View mode changed to: ${e}`)},lt=()=>{switch(G()){case"compact":return 35;case"detailed":return 120;default:return 50}},rt=async e=>{try{const n=B(e),t=document.createElement("a");t.href=`/api/blobs/${e.id}`,t.download=n,document.body.appendChild(t),t.click(),document.body.removeChild(t),$(`📥 Downloaded: ${n}`)}catch(n){console.error("Download failed:",n),$(`❌ Download failed: ${n}`)}},cn=(e,n)=>{console.log("toggleActionMenu called for:",e.id);const t=et();if(t&&t.item.id===e.id)ie(null),$(`⋯ Action menu closed for: ${B(e)}`);else{const l=n.target.getBoundingClientRect(),u=120,f=120;let s=l.right-u,h=l.bottom+4;s<0&&(s=l.left),s+u>window.innerWidth&&(s=window.innerWidth-u-8),h+f>window.innerHeight&&(h=l.top-f-4),ie({item:e,x:s,y:h}),console.log("Action menu positioned at:",{x:s,y:h,rect:l}),$(`⋯ Action menu opened for: ${B(e)}`)}},ee=()=>{ie(null)},un=(e,n,t)=>{const l=e.id,f=P().has(l),s=Pe();s&&(clearTimeout(s),be(null));const h=window.setTimeout(()=>{if(t.metaKey||t.ctrlKey)j(_=>{const D=new Set(_);return f?D.delete(l):D.add(l),z({selectedItems:D}),D}),fe(n);else if(t.shiftKey&&De()>=0){const _=Math.min(De(),n),D=Math.max(De(),n),W=N().slice(_,D+1);j(V=>{const X=new Set(V);return W.forEach(le=>X.add(le.id)),z({selectedItems:X}),X})}else{const _=new Set([l]);j(_),fe(n),z({selectedItems:_})}be(null)},200);be(h),(t.metaKey||t.ctrlKey||t.shiftKey)&&t.preventDefault()},at=()=>{j(new Set),fe(-1),z({selectedItems:new Set})},pn=()=>{const e=new Set(N().map(n=>n.id));j(e),z({selectedItems:e})},st=async()=>{const e=Array.from(P()),n=N().filter(t=>e.includes(t.id));for(const t of n)await rt(t);$(`📥 Downloaded ${n.length} items`)},gn=e=>{$(`🎵 Added ${e.length} items to playlist (stub)`)},dt=e=>{$(`🗑️ Deleted ${e.length} items (stub)`)},fn=(e,n,t)=>{t.button===0&&!t.metaKey&&!t.ctrlKey&&!t.shiftKey&&!Pe()&&(t.target.getBoundingClientRect(),nt({x:t.clientX,y:t.clientY,startIndex:n}))},ct=e=>{const n=Ie();if(n&&!oe()&&Math.sqrt(Math.pow(e.clientX-n.x,2)+Math.pow(e.clientY-n.y,2))>5&&tt(!0),oe()&&n){const t=document.querySelector(".grid-viewport");if(t){const l=t.getBoundingClientRect(),u=e.clientY-l.top+t.scrollTop,f=Math.floor(u/lt()),s=Math.max(0,Math.min(N().length-1,f));ot({x:e.clientX,y:e.clientY,endIndex:s});const h=Math.min(n.startIndex,s),_=Math.max(n.startIndex,s),D=N().slice(h,_+1),W=new Set(D.map(V=>V.id));j(W)}}},ut=e=>{if(oe()){const n=P();z({selectedItems:n}),$(`Selected ${n.size} items via drag`)}tt(!1),nt(null),ot(null)},Ee=[{key:"thumbnail",title:"Thumbnail",width:G()==="compact"?0:G()==="detailed"?120:60,sortable:!1,render:(e,n)=>{if(G()==="compact")return null;const t=dn(e),u=G()==="detailed"?"100px":"40px";return(()=>{var f=Ut();return o(f,g(w,{when:t,get fallback(){return g(w,{get when(){return Ze().has(e.id)},get fallback(){return(()=>{var s=Ci();return o(s,()=>wi(e.mime)),s})()},get children(){return ki()}})},get children(){var s=yi();return s.addEventListener("error",h=>{const _=h.target;_.style.display="none"}),A(s,"src",t),s}}),null),o(f,g(w,{get when(){return Ht(e)},get children(){return Si()}}),null),C(s=>Q(f,`
              width: ${u};
              height: ${u};
              border-radius: 4px;
              overflow: hidden;
              background: #333;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
            `,s)),f})()}},{key:"id",title:"ID",width:100,sortable:!0,render:(e,n)=>(()=>{var t=zi(),l=t.firstChild;return A(t,"title",n),o(t,()=>n.slice(0,8),l),t})()},{key:"sha256",title:"SHA256",width:120,sortable:!0,render:(e,n)=>(()=>{var t=Mi(),l=t.firstChild;return A(t,"title",n),o(t,()=>n.slice(0,12),l),t})()},{key:"name",title:"Name",sortable:!0,render:(e,n)=>(()=>{var t=Di();return o(t,()=>B(e)),C(()=>A(t,"title",B(e))),t})(),getValue:e=>B(e)},{key:"blob_type",title:"Type",width:100,sortable:!0,render:(e,n)=>(()=>{var t=Ii();return T(t,`blob-type-badge blob-type-${n}`),o(t,n),C(l=>Q(t,`
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            ${zn(n)}
          `,l)),t})()},{key:"mime",title:"MIME Type",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Pi();return o(t,n||"unknown"),t})()},{key:"size",title:"Size",width:100,sortable:!0,render:(e,n)=>(()=>{var t=Li();return o(t,()=>bt(n||0)),t})()},{key:"parent_blob_id",title:"Parent",width:80,sortable:!0,render:(e,n)=>n?(()=>{var t=Ti();return A(t,"title",`Parent: ${n}`),t})():Gt()},{key:"local_path",title:"Local",width:80,sortable:!0,render:(e,n)=>n?(()=>{var t=Ei();return A(t,"title",n),t})():Gt()},{key:"created_at",title:"Created",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Nt();return o(t,()=>new Date(n).toLocaleString()),t})()},{key:"updated_at",title:"Updated",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Nt();return o(t,()=>new Date(n).toLocaleString()),t})()},{key:"actions",title:"Actions",width:60,sortable:!1,render:(e,n)=>(()=>{var t=Ai(),l=t.firstChild;return l.$$click=u=>{u.stopPropagation(),u.preventDefault(),console.log("Action menu button clicked for:",e.id),$(`⋯ Action menu toggled for: ${B(e)}`),cn(e,u)},t})()}],bn=e=>{const n=y.state().requestedThumbnails.has(e.id)||e.metadata?.thumbnails_requested||Ze().has(e.id);G()!=="compact"&&!Ht(e)&&!n&&(Qe(t=>new Set([...t,e.id])),y.actions.getThumbnails&&(y.actions.getThumbnails(e.id),setTimeout(()=>{Qe(t=>{const l=new Set(t);return l.delete(e.id),l})},1e4)))},hn=se(()=>{const e=Ye(),n=G();return Ee.filter(t=>t.key==="thumbnail"&&n==="compact"?!1:t.key==="actions"?!0:e[t.key]).map(t=>({...t,width:t.key==="thumbnail"?n==="detailed"?100:60:t.width}))}),mn=(e,n)=>{const t={field:e,direction:n};ye(t),z({sortConfig:t})},Y=(e,n)=>{jt(t=>{const l={...t,[e]:n};return z({filterConfig:l}),l})},xn=e=>{an(n=>{const t={...n,[e]:!n[e]};return z({columnVisibility:t}),t})},vn=e=>{const n=Pe();n&&(clearTimeout(n),be(null)),ge({item:e,show:!0}),$(`🖱️ Double-clicked: ${B(e)}`)},$n=(e,n,t)=>{t.preventDefault();const l=e.id,u=P(),f=u.has(l);f||(j(new Set([l])),fe(n),z({selectedItems:new Set([l])})),t.target.getBoundingClientRect();const s=160,h=120;let _=t.clientX,D=t.clientY;_+s>window.innerWidth&&(_=window.innerWidth-s-8),D+h>window.innerHeight&&(D=window.innerHeight-h-8);const W=f?u:new Set([l]),V=W.size===1?e:Array.from(W).map(X=>N().find(le=>le.id===X)).filter(Boolean)[0]||e;ie({item:V,x:_,y:D}),$(`🖱️ Right-clicked: ${B(e)} (${W.size} selected)`)},pt=()=>{ge(null)},gt=()=>{Yt(e=>{const n=!e;return z({isFilterPanelOpen:n}),n})},ft=()=>{Zt(e=>{const n=!e;return z({isBrowsePanelOpen:n}),n})},wn=e=>{en(e),z({wsUrl:e})},_n=()=>{tn(e=>{const n=!e;return z({autoConnect:n}),n})},yn=()=>{const e=!te();nn(e),z({autoRefresh:e}),y.actions.toggleAutoRefresh(),$(`Auto-refresh ${e?"enabled":"disabled"}`)},Sn=()=>{on(e=>{const n=!e;return z({debug:n}),n})},kn=e=>{e.preventDefault(),Xe(!0),document.body.classList.add("resizing");const n=e.clientX,t=ce(),l=f=>{const s=f.clientX-n,h=Math.max(300,Math.min(800,t-s));Jt(h)},u=()=>{Xe(!1),document.body.classList.remove("resizing"),z({filterPanelWidth:ce()}),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",u)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",u)},Cn=e=>{e.preventDefault(),Ke(!0),document.body.classList.add("resizing");const n=e.clientX,t=ue(),l=f=>{const s=f.clientX-n,h=Math.max(300,Math.min(800,t+s));Qt(h)},u=()=>{Ke(!1),document.body.classList.remove("resizing"),z({browsePanelWidth:ue()}),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",u)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",u)},zn=e=>{switch(e){case"original":return"background: #ff00ff; color: #000000;";case"thumbnail":return"background: #666666; color: #ffffff;";case"waveform":return"background: #444444; color: #ffffff;";case"preview":return"background: #333333; color: #ffffff;";default:return"background: #222222; color: #ffffff;"}},bt=e=>{if(e===0)return"0 B";const n=1024,t=["B","KB","MB","GB"],l=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,l)).toFixed(1))+" "+t[l]},Mn=e=>{switch(e){case de.Connected:return"color: #ff00ff; font-weight: 600;";case de.Connecting:return"color: #ffffff; font-weight: 600;";case de.Disconnected:return"color: #666666; font-weight: 600;";default:return"color: #888888;"}},Dn=se(()=>[...new Set(y.state().items.map(n=>Kt(n.mime||"")).filter(n=>n!=="unknown"))].sort()),In=se(()=>[...new Set(y.state().items.map(n=>n.blob_type))].sort());return xi(()=>{$("🚀 MediaBlob Grid mounted");const e=t=>{const l=t.target;!l.closest(".action-menu")&&!l.closest("[data-action-button]")&&!l.closest(".bulk-action-button")&&ee()},n=t=>{if(t.key==="Escape")ee(),ge(null),at();else if(t.key==="a"&&(t.metaKey||t.ctrlKey))t.preventDefault(),pn();else if((t.key==="Backspace"||t.key==="Delete")&&P().size>0){const l=N().filter(u=>P().has(u.id));dt(l)}};document.addEventListener("click",e),document.addEventListener("keydown",n),document.addEventListener("mousemove",ct),document.addEventListener("mouseup",ut),Vt(()=>{document.removeEventListener("click",e),document.removeEventListener("keydown",n),document.removeEventListener("mousemove",ct),document.removeEventListener("mouseup",ut)})}),Vt(()=>{$("🧹 MediaBlob Grid cleanup")}),(()=>{var e=Ni(),n=e.firstChild,t=n.nextSibling,l=t.firstChild,u=l.firstChild,f=u.nextSibling,s=l.nextSibling,h=t.nextSibling,_=h.firstChild,D=_.firstChild,W=h.nextSibling,V=W.nextSibling,X=V.firstChild,le=X.firstChild,Ae=le.nextSibling,ht=Ae.nextSibling,Pn=ht.firstChild,mt=Pn.nextSibling,xt=ht.nextSibling,Be=xt.firstChild,vt=Be.nextSibling,Ln=xt.nextSibling,Tn=Ln.firstChild,Fe=Tn.nextSibling,Re=X.nextSibling,En=Re.firstChild,An=En.nextSibling,he=An.firstChild,Bn=he.nextSibling,$t=Re.nextSibling,Fn=$t.firstChild,me=Fn.nextSibling;me.firstChild;var wt=$t.nextSibling,Rn=wt.firstChild,xe=Rn.nextSibling;xe.firstChild;var _t=wt.nextSibling,Wn=_t.firstChild,Vn=Wn.nextSibling,We=Vn.firstChild,Hn=We.nextSibling,yt=Hn.nextSibling,St=_t.nextSibling,Un=St.firstChild,kt=Un.nextSibling,Ct=St.nextSibling,Gn=Ct.firstChild,zt=Gn.nextSibling,Mt=Ct.nextSibling,Nn=Mt.firstChild,On=Nn.nextSibling,Ve=On.firstChild,He=Ve.nextSibling,Dt=He.nextSibling,It=Mt.nextSibling,Xn=It.firstChild,re=Xn.nextSibling,Kn=re.firstChild,Pt=re.nextSibling,Lt=It.nextSibling,qn=Lt.firstChild,J=qn.nextSibling,jn=J.firstChild,Tt=jn.nextSibling,Yn=Tt.nextSibling,Jn=Yn.nextSibling,Zn=Jn.nextSibling,Et=Zn.nextSibling,Qn=Et.nextSibling,ei=Qn.nextSibling,ti=ei.nextSibling,At=ti.nextSibling,ni=At.nextSibling,Bt=ni.nextSibling,ii=Bt.nextSibling,oi=ii.nextSibling;oi.nextSibling;var Ft=J.nextSibling,li=Ft.firstChild,Ue=li.nextSibling,ri=Ft.nextSibling,Ge=Lt.nextSibling;return o(n,()=>`
        .mediablob-data-grid-container {
          height: 100vh;
          background: #1a1a1a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          overflow: hidden;
        }


        .browse-panel {
          background: #2a2a2a;
          border-right: 1px solid #3a3a3a;
          padding: 20px;
          overflow-y: auto;
          transition: margin-left 0.3s ease;
          position: relative;
          flex-shrink: 0;
        }

        .browse-panel.resizing {
          transition: none;
          border-right-color: #ff00ff;
          box-shadow: 2px 0 8px rgba(255, 0, 255, 0.3);
        }

        .browse-panel.collapsed {
          margin-left: -${ue()}px;
        }

        .browse-resize-handle {
          position: absolute;
          top: 0;
          right: -4px;
          width: 8px;
          height: 100%;
          background: transparent;
          cursor: col-resize;
          z-index: 10;
          transition: background-color 0.2s;
          user-select: none;
        }

        .browse-resize-handle:hover,
        .browse-resize-handle.dragging {
          background: #ff00ff;
        }

        .browse-resize-handle::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: #4a4a4a;
          border-radius: 1px;
          transition: background-color 0.2s;
        }

        .browse-resize-handle:hover::after,
        .browse-resize-handle.dragging::after {
          background: #ffffff;
        }

        .filter-panel {
          background: #2a2a2a;
          border-left: 1px solid #3a3a3a;
          padding: 20px;
          overflow-y: auto;
          transition: margin-right 0.3s ease;
          position: relative;
          flex-shrink: 0;
        }

        .filter-panel.resizing {
          transition: none;
          border-left-color: #ff00ff;
          box-shadow: -2px 0 8px rgba(255, 0, 255, 0.3);
        }

        .filter-panel.collapsed {
          margin-right: -${ce()}px;
        }

        .filter-resize-handle {
          position: absolute;
          top: 0;
          left: -4px;
          width: 8px;
          height: 100%;
          background: transparent;
          cursor: col-resize;
          z-index: 10;
          transition: background-color 0.2s;
          user-select: none;
        }

        .filter-resize-handle:hover,
        .filter-resize-handle.dragging {
          background: #ff00ff;
        }

        .filter-resize-handle::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: #4a4a4a;
          border-radius: 1px;
          transition: background-color 0.2s;
        }

        .filter-resize-handle:hover::after,
        .filter-resize-handle.dragging::after {
          background: #ffffff;
        }

        .panel-toggle-button {
          background: #000000;
          border: 1px solid #ff00ff;
          color: #ffffff;
          padding: 8px 12px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 14px;
        }

        .panel-toggle-button:hover {
          background: rgba(255, 0, 255, 0.2);
        }

        .panel-close-button {
          background: #333333;
          border: 1px solid #666666;
          color: #ffffff;
          padding: 6px 10px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 12px;
          margin-bottom: 15px;
        }

        .panel-close-button:hover {
          background: rgba(255, 0, 255, 0.2);
        }

        .filter-section {
          margin-bottom: 20px;
        }

        .filter-section h3 {
          margin: 0 0 10px 0;
          font-size: 14px;
          font-weight: 600;
          color: #b0b0b0;
        }

        .filter-input {
          width: 100%;
          padding: 8px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #e0e0e0;
          font-size: 14px;
        }

        .filter-input:focus {
          outline: none;
          border-color: #0070f3;
        }

        .filter-select {
          width: 100%;
          padding: 8px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #e0e0e0;
          font-size: 14px;
        }

        .filter-range {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .filter-range input {
          flex: 1;
        }

        .main-content {
          flex: 1;
          position: relative;
        }

        .ws-button {
          background: #ff00ff;
          border: 1px solid #ff00ff;
          color: #000000;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.2s;
          margin-right: 8px;
        }

        .ws-button:hover {
          background: rgba(255, 0, 255, 0.8);
        }

        .ws-button.danger {
          background: #666666;
          border-color: #666666;
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

        .toggle-button {
          background: #333333;
          border: 1px solid #666666;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .toggle-button.active {
          background: #ff00ff;
          border-color: #ff00ff;
          color: #000000;
        }

        .reset-button {
          background: #666666;
          border: 1px solid #666666;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .reset-button:hover {
          background: #555555;
        }

        .filter-panel.collapsed .filter-resize-handle,
        .browse-panel.collapsed .browse-resize-handle {
          display: none;
        }

        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }

        .main-content.resizing,
        .main-content.resizing-browse {
          pointer-events: none;
        }

        .debug-logs {
          font-size: 11px;
          font-family: monospace;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          padding: 8px;
          max-height: 120px;
          overflow-y: auto;
          color: #888;
        }

        .view-mode-selector {
          display: flex;
          gap: 4px;
          margin-bottom: 12px;
        }

        .view-mode-button {
          flex: 1;
          padding: 6px 8px;
          background: #3a3a3a;
          border: 1px solid #4a4a4a;
          color: #e0e0e0;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          text-align: center;
          transition: all 0.2s;
        }

        .view-mode-button.active {
          background: #ff00ff;
          border-color: #ff00ff;
          color: #000000;
        }

        .view-mode-button:hover:not(.active) {
          background: rgba(255, 0, 255, 0.1);
        }

        .inline-media {
          max-height: 100px;
          border-radius: 4px;
          object-fit: cover;
          margin-top: 8px;
        }

        .detailed-row-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }

        .detailed-row-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .detailed-row-bottom {
          display: flex;
          gap: 8px;
          align-items: center;
          font-size: 12px;
          color: #888;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .column-settings {
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          padding: 12px;
          margin-top: 8px;
        }

        .column-settings.collapsed {
          display: none;
        }

        .column-toggle {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
          font-size: 12px;
        }

        .column-toggle input {
          margin-right: 8px;
        }

        .popup-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .popup-content {
          background: #2a2a2a;
          border-radius: 8px;
          padding: 20px;
          max-width: 90vw;
          max-height: 90vh;
          overflow: auto;
          position: relative;
          border: 1px solid #3a3a3a;
        }

        .popup-close {
          position: absolute;
          top: 12px;
          right: 12px;
          background: #ef4444;
          border: none;
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: bold;
        }

        .popup-close:hover {
          background: #dc2626;
        }

        .popup-image {
          max-width: 80vw;
          max-height: 70vh;
          object-fit: contain;
          border-radius: 4px;
        }

        .popup-video {
          max-width: 80vw;
          max-height: 70vh;
          border-radius: 4px;
        }

        .popup-meta {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid #3a3a3a;
          font-size: 14px;
          color: #b0b0b0;
        }

        .popup-meta-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .popup-meta-label {
          font-weight: 600;
          color: #e0e0e0;
        }

        .action-menu {
          position: fixed !important;
          background: #1a1a1a !important;
          border: 1px solid #ff00ff !important;
          border-radius: 4px !important;
          padding: 4px 0 !important;
          min-width: 120px !important;
          z-index: 999999 !important;
          box-shadow: 0 4px 12px rgba(255, 0, 255, 0.3) !important;
          max-height: 200px !important;
          overflow-y: auto !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          display: block !important;
          transform: translateZ(0) !important;
        }

        .action-menu-item {
          width: 100%;
          padding: 8px 12px;
          background: none;
          border: none;
          color: #ffffff;
          text-align: left;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .action-menu-item:hover {
          background: rgba(255, 0, 255, 0.2);
        }



        .bulk-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #ff00ff;
          color: #000000;
          border-radius: 4px;
          font-size: 12px;
          box-shadow: 0 2px 8px rgba(255, 0, 255, 0.3);
          animation: slideInFromLeft 0.3s ease-out;
        }

        @keyframes slideInFromLeft {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .bulk-action-button {
          background: #000000;
          border: 1px solid #ff00ff;
          color: #ffffff;
          padding: 4px 8px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
        }

        .bulk-action-button:hover {
          background: rgba(255, 0, 255, 0.2);
        }

        .drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        .drag-selection-box {
          position: fixed;
          border: 2px dashed #ff00ff;
          background: rgba(255, 0, 255, 0.1);
          pointer-events: none;
          z-index: 999;
        }

        .grid-row {
          cursor: pointer;
        }

        .grid-row:hover {
          cursor: pointer;
        }

        .toolbar-container {
          position: absolute;
          bottom: 20px;
          left: 20px;
          z-index: 10;
          display: flex;
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;
        }

        .controls-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
      `),o(t,g(w,{get when(){return ke()},get children(){var i=Bi();return i.$$click=ft,i}}),l),f.$$input=i=>Y("name",i.currentTarget.value),s.$$mousedown=Cn,o(_,g(w,{get when(){return!ke()},get children(){var i=Fi();return i.$$click=ft,i}}),D),D.$$click=gt,o(D,()=>Se()?"← Hide Controls":"Show Controls →"),o(_,g(w,{get when(){return P().size>1},get children(){var i=Ri(),a=i.firstChild,p=a.firstChild,r=p.nextSibling;r.nextSibling;var m=a.nextSibling,F=m.nextSibling,H=F.firstChild,R=F.nextSibling;return o(a,()=>P().size,p),o(a,()=>P().size===1?"":"s",r),m.$$click=st,H.$$click=I=>{I.stopPropagation(),I.preventDefault(),console.log("Bulk action More button clicked");const E=I.target.getBoundingClientRect(),M=N().filter(O=>P().has(O.id));if(console.log("Selected items for bulk action:",M.length),M.length>0){let b=E.left,L=E.top-120-8;b+160>window.innerWidth&&(b=E.right-160),L<0&&(L=E.bottom+4),ie({item:M[0],x:b,y:L}),$(`⋯ Bulk action menu opened for ${M.length} items`)}else console.log("No selected items for bulk action")},R.$$click=at,i}}),null),o(W,g(vi,{get data(){return N()},get columns(){return hn()},onSort:mn,get sortField(){return v().field},get sortDirection(){return v().direction},get rowHeight(){return lt()},headerHeight:60,theme:"dark",onRowDoubleClick:vn,onRowMount:i=>bn(i),onRowClick:(i,a,p)=>un(i,a,p),onRowMouseDown:(i,a,p)=>fn(i,a,p),onContextMenu:(i,a,p)=>$n(i,a,p),get selectedItems(){return P()},get isDragSelecting(){return oe()}})),o(V,g(w,{get when(){return Se()},get children(){var i=Wi();return i.$$click=gt,i}}),X),Ae.$$input=i=>wn(i.currentTarget.value),o(mt,()=>y.state().connectionStatus),Be.$$click=()=>{y.actions.connect(),$("🔌 Connect clicked")},vt.$$click=()=>{y.actions.disconnect(),$("🔌 Disconnect clicked")},Fe.$$click=_n,o(Fe,()=>Me()?"ON":"OFF"),he.$$click=yn,o(he,()=>te()?"ON":"OFF"),Bn.$$click=()=>{y.actions.refresh(),$("🔄 Manual refresh")},o(Re,g(w,{get when(){return Ne(()=>!!y.state().hasPendingUpdates)()&&!te()},get children(){var i=Vi(),a=i.firstChild,p=a.firstChild,r=p.nextSibling;return r.nextSibling,a.$$click=()=>{y.actions.applyPendingUpdates(),$("📥 Applied pending updates")},o(a,()=>y.state().pendingUpdates.length,r),i}}),null),me.addEventListener("change",i=>Y("mime",i.currentTarget.value)),o(me,g(_e,{get each(){return Dn()},children:i=>(()=>{var a=Ot();return a.value=i,o(a,i),a})()}),null),xe.addEventListener("change",i=>Y("blobType",i.currentTarget.value)),o(xe,g(_e,{get each(){return In()},children:i=>(()=>{var a=Ot();return a.value=i,o(a,i),a})()}),null),We.$$input=i=>Y("minSize",parseInt(i.currentTarget.value)||0),yt.$$input=i=>Y("maxSize",parseInt(i.currentTarget.value)||1e8),kt.addEventListener("change",i=>Y("hasParent",i.currentTarget.value)),zt.addEventListener("change",i=>Y("hasLocalPath",i.currentTarget.value)),Ve.$$click=()=>Te("compact"),He.$$click=()=>Te("default"),Dt.$$click=()=>Te("detailed"),re.$$click=()=>sn(!pe()),o(re,()=>pe()?"Hide":"Show",Kn),o(Pt,g(_e,{each:Ee,children:i=>(()=>{var a=Oi(),p=a.firstChild,r=p.firstChild,m=r.nextSibling;return r.addEventListener("change",()=>xn(i.key)),o(m,()=>i.title),C(()=>r.checked=Ye()[i.key]),a})()})),o(J,()=>y.state().items.length,Tt),o(J,()=>Le().length,Et),o(J,()=>v().field,At),o(J,()=>v().direction,Bt),o(J,()=>y.state().lastUpdated?.toLocaleTimeString()||"Never",null),Ue.$$click=Sn,o(Ue,()=>ne()?"ON":"OFF"),ri.$$click=()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Oe),window.location.reload())},o(V,g(w,{get when(){return Ne(()=>!!ne())()&&je().length>0},get children(){var i=Hi(),a=i.firstChild,p=a.nextSibling;return o(p,g(_e,{get each(){return je()},children:r=>(()=>{var m=Ut();return o(m,r),m})()})),i}}),Ge),Ge.$$mousedown=kn,o(e,g(w,{get when(){return Je()?.show},get children(){var i=Ui(),a=i.firstChild,p=a.firstChild;return i.$$click=r=>{r.target===r.currentTarget&&pt()},p.$$click=pt,o(a,g(w,{get when(){return Je()?.item},children:r=>{const m=r().mime||"",F=m.startsWith("image/"),H=m.startsWith("video/"),R=m.startsWith("audio/");return(()=>{var I=Zi(),E=I.firstChild,M=E.nextSibling,O=M.firstChild,q=O.firstChild,b=q.nextSibling,L=O.nextSibling,ve=L.firstChild,$e=ve.nextSibling,ae=L.nextSibling,we=ae.firstChild,ai=we.nextSibling,Rt=ae.nextSibling,si=Rt.firstChild,di=si.nextSibling,Wt=Rt.nextSibling,ci=Wt.firstChild,ui=ci.nextSibling,pi=Wt.nextSibling,gi=pi.firstChild,fi=gi.nextSibling;return o(E,()=>B(r())),o(I,g(w,{when:F,get children(){var S=Xi();return S.addEventListener("error",k=>{const U=k.target;U.style.display="none";const Z=document.createElement("div");Z.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                            </div>
                          `,U.parentNode?.appendChild(Z)}),C(k=>{var U=`/api/blobs/${r().id}`,Z=B(r());return U!==k.e&&A(S,"src",k.e=U),Z!==k.t&&A(S,"alt",k.t=Z),k},{e:void 0,t:void 0}),S}}),M),o(I,g(w,{when:H,get children(){var S=Ki(),k=S.firstChild;return A(k,"type",m),C(()=>A(k,"src",`/api/blobs/${r().id}`)),S}}),M),o(I,g(w,{when:R,get children(){var S=qi(),k=S.firstChild;return A(k,"type",m),C(()=>A(k,"src",`/api/blobs/${r().id}`)),S}}),M),o(I,g(w,{when:!F&&!H&&!R,get children(){var S=ji(),k=S.firstChild,U=k.nextSibling,Z=U.nextSibling,bi=Z.firstChild;return C(()=>A(bi,"href",`/api/blobs/${r().id}`)),S}}),M),o(b,()=>r().id),o($e,()=>r().sha256),o(ai,()=>r().blob_type),o(di,m||"unknown"),o(ui,()=>bt(r().size||0)),o(fi,()=>new Date(r().created_at).toLocaleString()),o(M,g(w,{get when(){return r().parent_blob_id},get children(){var S=Yi(),k=S.firstChild,U=k.nextSibling;return o(U,()=>r().parent_blob_id),S}}),null),o(M,g(w,{get when(){return r().local_path},get children(){var S=Ji(),k=S.firstChild,U=k.nextSibling;return o(U,()=>r().local_path),S}}),null),I})()}}),null),i}}),null),o(e,g(w,{get when(){return et()},children:i=>{const a=P().size>1,p=a?N().filter(r=>P().has(r.id)):[i().item];return console.log("ACTION MENU RENDERING:",{isVisible:!0,position:{x:i().x,y:i().y},isMultiSelect:a,selectedCount:P().size,windowDimensions:{width:window.innerWidth,height:window.innerHeight}}),(()=>{var r=to(),m=r.firstChild,F=m.firstChild,H=F.nextSibling;H.firstChild;var R=m.nextSibling,I=R.firstChild,E=I.nextSibling;E.firstChild;var M=R.nextSibling,O=M.firstChild,q=O.nextSibling;return q.firstChild,o(r,g(w,{when:!a,get children(){var b=Qi();return b.$$click=L=>{L.stopPropagation(),L.preventDefault(),ge({item:i().item,show:!0}),ee(),$(`👁️ Preview opened for: ${B(i().item)}`)},b}}),m),o(r,g(w,{when:a,get children(){var b=eo(),L=b.firstChild;return o(b,()=>p.length,L),b}}),m),m.$$click=b=>{b.stopPropagation(),b.preventDefault(),a?st():rt(i().item),ee()},o(H,()=>a?`(${p.length})`:"",null),R.$$click=b=>{b.stopPropagation(),b.preventDefault(),gn(p),ee()},o(E,()=>a?`(${p.length})`:"",null),M.$$click=b=>{b.stopPropagation(),b.preventDefault(),dt(p),ee()},o(q,()=>a?`(${p.length})`:"",null),C(b=>Q(r,`left: ${i().x}px; top: ${i().y}px;`,b)),r})()}}),null),o(e,g(w,{get when(){return Ne(()=>!!(oe()&&Ie()))()&&it()},get children(){var i=Gi();return C(a=>Q(i,(()=>{const p=Ie(),r=it(),m=Math.min(p.x,r.x),F=Math.min(p.y,r.y),H=Math.abs(r.x-p.x),R=Math.abs(r.y-p.y);return`left: ${m}px; top: ${F}px; width: ${H}px; height: ${R}px;`})(),a)),i}}),null),C(i=>{var a=`browse-panel ${ke()?"":"collapsed"} ${ze()?"resizing":""}`,p=`width: ${ue()}px;`,r=`browse-resize-handle ${ze()?"dragging":""}`,m=`main-content ${Ce()?"resizing":""} ${ze()?"resizing-browse":""}`,F=`filter-panel ${Se()?"":"collapsed"} ${Ce()?"resizing":""}`,H=`width: ${ce()}px;`,R=Mn(y.state().connectionStatus),I=y.state().connectionStatus===de.Connected,E=y.state().connectionStatus===de.Disconnected,M=`toggle-button ${Me()?"active":""}`,O=`toggle-button ${te()?"active":""}`,q=`view-mode-button ${G()==="compact"?"active":""}`,b=`view-mode-button ${G()==="default"?"active":""}`,L=`view-mode-button ${G()==="detailed"?"active":""}`,ve=`toggle-button ${pe()?"active":""}`,$e=`column-settings ${pe()?"":"collapsed"}`,ae=`toggle-button ${ne()?"active":""}`,we=`filter-resize-handle ${Ce()?"dragging":""}`;return a!==i.e&&T(t,i.e=a),i.t=Q(t,p,i.t),r!==i.a&&T(s,i.a=r),m!==i.o&&T(W,i.o=m),F!==i.i&&T(V,i.i=F),i.n=Q(V,H,i.n),i.s=Q(mt,R,i.s),I!==i.h&&(Be.disabled=i.h=I),E!==i.r&&(vt.disabled=i.r=E),M!==i.d&&T(Fe,i.d=M),O!==i.l&&T(he,i.l=O),q!==i.u&&T(Ve,i.u=q),b!==i.c&&T(He,i.c=b),L!==i.w&&T(Dt,i.w=L),ve!==i.m&&T(re,i.m=ve),$e!==i.f&&T(Pt,i.f=$e),ae!==i.y&&T(Ue,i.y=ae),we!==i.g&&T(Ge,i.g=we),i},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0}),C(()=>f.value=K().name),C(()=>Ae.value=qe()),C(()=>me.value=K().mime),C(()=>xe.value=K().blobType),C(()=>We.value=K().minSize),C(()=>yt.value=K().maxSize),C(()=>kt.value=K().hasParent),C(()=>zt.value=K().hasLocalPath),e})()}class io extends HTMLElement{dispose;connectedCallback(){console.log("🔌 InfiniteDataGridElement connected");try{this.dispose=mi(()=>g(no,{}),this),console.log("✅ MediaBlob Data Grid render successful")}catch(v){console.error("❌ MediaBlob Data Grid render failed:",v)}}disconnectedCallback(){console.log("🔌 InfiniteDataGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register infinite-data-grid custom element");try{customElements.define("infinite-data-grid",io),console.log("✅ MediaBlob Data Grid custom element registered successfully")}catch(c){console.error("❌ Failed to register infinite-data-grid custom element:",c)}hi(["click","input","mousedown"]);
//# sourceMappingURL=infinite-data-grid.js.map
