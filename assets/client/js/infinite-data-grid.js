import{d as xi,r as vi,f as g,c as x,k as de,t as c,i as o,g as E,S as w,b as C,e as T,o as $i,h as Ut,m as Ne,F as ye,s as Q}from"./web-xBr4R5eT.js";import{G as wi}from"./generic-infinite-grid-DtuMfZQv.js";import{u as _i}from"./useWebSocketFeed-iHjhKRbV.js";import{C as ce}from"./websocket-types-DZZ1YLNk.js";import"./websocket-client-NNVZjhvd.js";import"./types-DAeLdoVX.js";var yi=c("<img alt=Thumbnail style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),Si=c('<div style="position:absolute;bottom:2px;right:2px;width:8px;height:8px;background:#ff00ff;border-radius:50%;border:1px solid #ffffff;"title="Has thumbnails">'),Gt=c("<div>"),ki=c('<div style="width:12px;height:12px;border:2px solid #ff00ff;border-top:2px solid transparent;border-radius:50%;animation:spin 1s linear infinite;"title="Generating thumbnail...">'),Ci=c("<span style=font-size:16px;>"),zi=c('<code style="font-size:11px;background:#333;padding:2px 4px;border-radius:3px;color:#0ff;">...'),Di=c('<code style="font-size:11px;background:#333;padding:2px 4px;border-radius:3px;color:#f90;">...'),Mi=c("<span style=font-weight:500;color:#e0e0e0;>"),Ii=c("<span>"),Li=c("<span style=font-family:monospace;font-size:12px;>"),Pi=c("<span style=color:#ffffff;font-weight:600;font-size:12px;>"),Ti=c("<span style=color:#ff00ff;font-size:11px;>✓"),Nt=c("<span style=color:#666;>-"),Ai=c("<span style=color:#ff00ff;font-size:11px;>📁"),Ot=c("<span style=font-size:12px;color:#888;>"),Ei=c('<div style=position:relative;><button style="background:#3a3a3a;border:1px solid #4a4a4a;color:#e0e0e0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;"data-action-button>⋯'),Bi=c("<button class=panel-close-button>← Hide Browse"),Ri=c("<button class=panel-toggle-button>Show Browse →"),Wi=c("<div class=bulk-actions><span> item<!> selected</span><button class=bulk-action-button>📥 Download</button><div style=position:relative;><button class=bulk-action-button>⋯ More</button></div><button class=bulk-action-button style=background:#666666;border-color:#666666;>✕"),Fi=c("<button class=panel-close-button>Hide Controls →"),Vi=c("<div style=margin-bottom:8px;><button class=ws-button style=background:#f59e0b;border-color:#f59e0b;>Apply <!> Updates"),Hi=c("<div class=filter-section><h3>🐛 Debug Logs</h3><div class=debug-logs>"),Ui=c("<div class=popup-overlay><div class=popup-content><button class=popup-close>×"),Gi=c("<div class=drag-selection-box>"),Ni=c('<div class=mediablob-data-grid-container><style></style><div><div class=filter-section><h3>🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."></div><div title="Drag to resize panel"></div></div><div class=toolbar-container><div class=controls-row><button class=panel-toggle-button></button></div></div><div></div><div><div class=filter-section><h3>🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style=margin-bottom:8px;><div style=margin-bottom:8px;>Status: <span></span></div><div style=margin-bottom:8px;><button class=ws-button>Connect</button><button class="ws-button danger">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section><h3>🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button>Refresh</button></div></div><div class=filter-section><h3>📄 Content Type</h3><select class=filter-select><option value>All Types</option></select></div><div class=filter-section><h3>🏷️ Blob Type</h3><select class=filter-select><option value>All Types</option></select></div><div class=filter-section><h3>📏 Size Range (bytes)</h3><div class=filter-range><input class=filter-input type=number placeholder=Min><span>-</span><input class=filter-input type=number placeholder=Max></div></div><div class=filter-section><h3>🔗 Has Parent</h3><select class=filter-select><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section><h3>📁 Has Local Path</h3><select class=filter-select><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section><h3>🎨 View Mode</h3><div class=view-mode-selector><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section><h3>👁️ Column Visibility</h3><button style=margin-bottom:8px;width:100%;> Column Settings</button><div></div></div><div class=filter-section><h3>📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:8px;>Debug:<button style=margin-left:8px;></button></div><button class=reset-button title="Reset all filters and settings">Reset All</button></div><div title="Drag to resize panel">'),Xt=c("<option>"),Oi=c("<div class=column-toggle><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox><span>"),Xi=c("<img class=popup-image>"),Ki=c("<video class=popup-video controls preload=metadata><source>Your browser does not support video playback."),ji=c('<audio controls style="width:100%;margin:20px 0;"preload=metadata><source>Your browser does not support audio playback.'),qi=c('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;">Download File'),Yi=c("<div class=popup-meta-row><span class=popup-meta-label>Parent:</span><span style=font-family:monospace;font-size:12px;>"),Ji=c("<div class=popup-meta-row><span class=popup-meta-label>Local Path:</span><span style=font-family:monospace;font-size:12px;>"),Zi=c('<div><h3 style="margin:0 0 16px 0;color:#e0e0e0;"></h3><div class=popup-meta><div class=popup-meta-row><span class=popup-meta-label>ID:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>SHA256:</span><span style=font-family:monospace;font-size:12px;></span></div><div class=popup-meta-row><span class=popup-meta-label>Type:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>MIME:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>Size:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>Created:</span><span>'),Qi=c("<button class=action-menu-item><span>👁️</span><span>Preview"),eo=c('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;"> items selected'),to=c("<div class=action-menu><button class=action-menu-item><span>📥</span><span>Download </span></button><button class=action-menu-item><span>🎵</span><span>Add to Playlist </span></button><button class=action-menu-item style=color:#ef4444;><span>🗑️</span><span>Delete ");console.log("🚀 MediaBlob Data Grid script loading");const Oe="mediablob-grid-state",Kt=400;function qt(){try{const s=localStorage.getItem(Oe);return s?JSON.parse(s):{}}catch(s){return console.warn("Failed to load grid state from localStorage:",s),{}}}function z(s){try{const te={...qt(),...s};localStorage.setItem(Oe,JSON.stringify(te))}catch(v){console.warn("Failed to save grid state to localStorage:",v)}}const no=(s,v)=>{const te=new Uint8Array(s),G=new Blob([te],{type:v});return URL.createObjectURL(G)};function B(s){if(s.metadata&&typeof s.metadata=="object"){const v=s.metadata;if(v.originalName||v.filename||v.original_filename||v.file_name||v.name)return v.originalName||v.filename||v.original_filename||v.file_name||v.name}return s.filename||s.local_path?.split("/").pop()||`${s.sha256.slice(0,8)}...${s.sha256.slice(-4)}`}function jt(s){return s?s.split("/")[0]:"unknown"}function io(){console.log("📦 MediaBlobDataGrid component created");const s=qt(),[v,te]=x(s.sortConfig||{field:"created_at",direction:"desc"}),[G,Yt]=x(s.filterConfig||{name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all"}),[Se,Jt]=x(s.isFilterPanelOpen??!0),[ue,Zt]=x(s.filterPanelWidth||Kt),[ke,Qt]=x(s.isBrowsePanelOpen??!0),[pe,en]=x(s.browsePanelWidth||Kt),[Ce,Xe]=x(!1),[ze,Ke]=x(!1),[je,tn]=x(s.wsUrl||"ws://localhost:8080/ws"),[De,nn]=x(s.autoConnect??!0),[ne,on]=x(s.autoRefresh??!1),[ie,ln]=x(s.debug??!1),[qe,rn]=x([]),[N,an]=x(s.viewMode||"default"),[Ye,sn]=x(s.columnVisibility||{thumbnail:!0,id:!1,sha256:!1,name:!0,blob_type:!0,mime:!0,size:!0,parent_blob_id:!0,local_path:!0,created_at:!0,updated_at:!0,actions:!0}),[ge,dn]=x(!1),[Je,fe]=x(null),[Ze,Qe]=x(new Set),[et,oe]=x(null),[L,q]=x(new Set(s.selectedItems?Array.from(s.selectedItems):[])),[Me,be]=x(-1),[le,tt]=x(!1),[Ie,nt]=x(null),[it,ot]=x(null),[Le,he]=x(null),y=_i({wsUrl:je(),channels:["MediaBlobs"],debug:ie(),autoConnect:De(),autoRefresh:ne(),pageSize:50}),$=e=>{if(ie()){const n=new Date().toLocaleTimeString();rn(t=>[...t.slice(-19),`[${n}] ${e}`])}},Pe=de(()=>{const e=G();return y.state().items.filter(n=>{const t=B(n),l=jt(n.mime||"");return t.toLowerCase().includes(e.name.toLowerCase())&&(e.mime===""||l===e.mime)&&(e.blobType===""||n.blob_type===e.blobType)&&(n.size||0)>=e.minSize&&(n.size||0)<=e.maxSize&&(e.hasParent==="all"||e.hasParent==="yes"&&n.parent_blob_id||e.hasParent==="no"&&!n.parent_blob_id)&&(e.hasLocalPath==="all"||e.hasLocalPath==="yes"&&n.local_path||e.hasLocalPath==="no"&&!n.local_path)})}),O=de(()=>{const e=v();return e.direction?[...Pe()].sort((t,l)=>{let u,f;const d=Ae.find(_=>_.key===e.field);d&&d.getValue?(u=d.getValue(t),f=d.getValue(l)):(u=t[e.field],f=l[e.field]);let h=0;return u<f&&(h=-1),u>f&&(h=1),e.direction==="desc"?-h:h}):Pe()}),lt=e=>e.metadata?.thumbnails||[],rt=e=>e.metadata?.has_thumbnails===!0||lt(e).length>0,cn=e=>{const n=lt(e);if(n.length>0&&n[0]){const t=n[0];if(t.data&&t.data.length>0){const l=t.mime||"image/webp";return no(t.data,l)}return`/api/media-blobs/${t.id}/download`}return null},un=e=>e?e.startsWith("image/")?"🖼️":e.startsWith("video/")?"🎥":e.startsWith("audio/")?"🎵":e.startsWith("text/")?"📝":e.includes("pdf")?"📄":"📎":"📎",Te=e=>{an(e),z({viewMode:e}),$(`View mode changed to: ${e}`)},at=()=>{switch(N()){case"compact":return 35;case"detailed":return 120;default:return 50}},st=async e=>{try{const n=B(e),t=document.createElement("a");t.href=`/api/blobs/${e.id}`,t.download=n,document.body.appendChild(t),t.click(),document.body.removeChild(t),$(`📥 Downloaded: ${n}`)}catch(n){console.error("Download failed:",n),$(`❌ Download failed: ${n}`)}},pn=(e,n)=>{console.log("toggleActionMenu called for:",e.id);const t=et();if(t&&t.item.id===e.id)oe(null),$(`⋯ Action menu closed for: ${B(e)}`);else{const l=n.target.getBoundingClientRect(),u=120,f=120;let d=l.right-u,h=l.bottom+4;d<0&&(d=l.left),d+u>window.innerWidth&&(d=window.innerWidth-u-8),h+f>window.innerHeight&&(h=l.top-f-4),oe({item:e,x:d,y:h}),console.log("Action menu positioned at:",{x:d,y:h,rect:l}),$(`⋯ Action menu opened for: ${B(e)}`)}},ee=()=>{oe(null)},gn=(e,n,t)=>{const l=e.id,f=L().has(l),d=Le();d&&(clearTimeout(d),he(null));const h=window.setTimeout(()=>{if(t.metaKey||t.ctrlKey)q(_=>{const M=new Set(_);return f?M.delete(l):M.add(l),z({selectedItems:M}),M}),be(n);else if(t.shiftKey&&Me()>=0){const _=Math.min(Me(),n),M=Math.max(Me(),n),F=O().slice(_,M+1);q(V=>{const K=new Set(V);return F.forEach(re=>K.add(re.id)),z({selectedItems:K}),K})}else{const _=new Set([l]);q(_),be(n),z({selectedItems:_})}he(null)},200);he(h),(t.metaKey||t.ctrlKey||t.shiftKey)&&t.preventDefault()},dt=()=>{q(new Set),be(-1),z({selectedItems:new Set})},fn=()=>{const e=new Set(O().map(n=>n.id));q(e),z({selectedItems:e})},ct=async()=>{const e=Array.from(L()),n=O().filter(t=>e.includes(t.id));for(const t of n)await st(t);$(`📥 Downloaded ${n.length} items`)},bn=e=>{$(`🎵 Added ${e.length} items to playlist (stub)`)},ut=e=>{$(`🗑️ Deleted ${e.length} items (stub)`)},hn=(e,n,t)=>{t.button===0&&!t.metaKey&&!t.ctrlKey&&!t.shiftKey&&!Le()&&(t.target.getBoundingClientRect(),nt({x:t.clientX,y:t.clientY,startIndex:n}))},pt=e=>{const n=Ie();if(n&&!le()&&Math.sqrt(Math.pow(e.clientX-n.x,2)+Math.pow(e.clientY-n.y,2))>5&&tt(!0),le()&&n){const t=document.querySelector(".grid-viewport");if(t){const l=t.getBoundingClientRect(),u=e.clientY-l.top+t.scrollTop,f=Math.floor(u/at()),d=Math.max(0,Math.min(O().length-1,f));ot({x:e.clientX,y:e.clientY,endIndex:d});const h=Math.min(n.startIndex,d),_=Math.max(n.startIndex,d),M=O().slice(h,_+1),F=new Set(M.map(V=>V.id));q(F)}}},gt=e=>{if(le()){const n=L();z({selectedItems:n}),$(`Selected ${n.size} items via drag`)}tt(!1),nt(null),ot(null)},Ae=[{key:"thumbnail",title:"Thumbnail",width:N()==="compact"?0:N()==="detailed"?120:60,sortable:!1,render:(e,n)=>{if(N()==="compact")return null;const t=cn(e),u=N()==="detailed"?"100px":"40px";return(()=>{var f=Gt();return o(f,g(w,{when:t,get fallback(){return g(w,{get when(){return Ze().has(e.id)},get fallback(){return(()=>{var d=Ci();return o(d,()=>un(e.mime)),d})()},get children(){return ki()}})},get children(){var d=yi();return d.addEventListener("error",h=>{const _=h.target;_.style.display="none"}),E(d,"src",t),d}}),null),o(f,g(w,{get when(){return rt(e)},get children(){return Si()}}),null),C(d=>Q(f,`
              width: ${u};
              height: ${u};
              border-radius: 4px;
              overflow: hidden;
              background: #333;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
            `,d)),f})()}},{key:"id",title:"ID",width:100,sortable:!0,render:(e,n)=>(()=>{var t=zi(),l=t.firstChild;return E(t,"title",n),o(t,()=>n.slice(0,8),l),t})()},{key:"sha256",title:"SHA256",width:120,sortable:!0,render:(e,n)=>(()=>{var t=Di(),l=t.firstChild;return E(t,"title",n),o(t,()=>n.slice(0,12),l),t})()},{key:"name",title:"Name",sortable:!0,render:(e,n)=>(()=>{var t=Mi();return o(t,()=>B(e)),C(()=>E(t,"title",B(e))),t})(),getValue:e=>B(e)},{key:"blob_type",title:"Type",width:100,sortable:!0,render:(e,n)=>(()=>{var t=Ii();return T(t,`blob-type-badge blob-type-${n}`),o(t,n),C(l=>Q(t,`
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            ${Mn(n)}
          `,l)),t})()},{key:"mime",title:"MIME Type",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Li();return o(t,n||"unknown"),t})()},{key:"size",title:"Size",width:100,sortable:!0,render:(e,n)=>(()=>{var t=Pi();return o(t,()=>mt(n||0)),t})()},{key:"parent_blob_id",title:"Parent",width:80,sortable:!0,render:(e,n)=>n?(()=>{var t=Ti();return E(t,"title",`Parent: ${n}`),t})():Nt()},{key:"local_path",title:"Local",width:80,sortable:!0,render:(e,n)=>n?(()=>{var t=Ai();return E(t,"title",n),t})():Nt()},{key:"created_at",title:"Created",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Ot();return o(t,()=>new Date(n).toLocaleString()),t})()},{key:"updated_at",title:"Updated",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Ot();return o(t,()=>new Date(n).toLocaleString()),t})()},{key:"actions",title:"Actions",width:60,sortable:!1,render:(e,n)=>(()=>{var t=Ei(),l=t.firstChild;return l.$$click=u=>{u.stopPropagation(),u.preventDefault(),console.log("Action menu button clicked for:",e.id),$(`⋯ Action menu toggled for: ${B(e)}`),pn(e,u)},t})()}],mn=e=>{const n=y.state().requestedThumbnails.has(e.id)||e.metadata?.thumbnails_requested||Ze().has(e.id);N()!=="compact"&&!rt(e)&&!n&&(Qe(t=>new Set([...t,e.id])),y.actions.getThumbnails&&(y.actions.getThumbnails(e.id),setTimeout(()=>{Qe(t=>{const l=new Set(t);return l.delete(e.id),l})},1e4)))},xn=de(()=>{const e=Ye(),n=N();return Ae.filter(t=>t.key==="thumbnail"&&n==="compact"?!1:t.key==="actions"?!0:e[t.key]).map(t=>({...t,width:t.key==="thumbnail"?n==="detailed"?100:60:t.width}))}),vn=(e,n)=>{const t={field:e,direction:n};te(t),z({sortConfig:t})},Y=(e,n)=>{Yt(t=>{const l={...t,[e]:n};return z({filterConfig:l}),l})},$n=e=>{sn(n=>{const t={...n,[e]:!n[e]};return z({columnVisibility:t}),t})},wn=e=>{const n=Le();n&&(clearTimeout(n),he(null)),fe({item:e,show:!0}),$(`🖱️ Double-clicked: ${B(e)}`)},_n=(e,n,t)=>{t.preventDefault();const l=e.id,u=L(),f=u.has(l);f||(q(new Set([l])),be(n),z({selectedItems:new Set([l])})),t.target.getBoundingClientRect();const d=160,h=120;let _=t.clientX,M=t.clientY;_+d>window.innerWidth&&(_=window.innerWidth-d-8),M+h>window.innerHeight&&(M=window.innerHeight-h-8);const F=f?u:new Set([l]),V=F.size===1?e:Array.from(F).map(K=>O().find(re=>re.id===K)).filter(Boolean)[0]||e;oe({item:V,x:_,y:M}),$(`🖱️ Right-clicked: ${B(e)} (${F.size} selected)`)},ft=()=>{fe(null)},bt=()=>{Jt(e=>{const n=!e;return z({isFilterPanelOpen:n}),n})},ht=()=>{Qt(e=>{const n=!e;return z({isBrowsePanelOpen:n}),n})},yn=e=>{tn(e),z({wsUrl:e})},Sn=()=>{nn(e=>{const n=!e;return z({autoConnect:n}),n})},kn=()=>{const e=!ne();on(e),z({autoRefresh:e}),y.actions.toggleAutoRefresh(),$(`Auto-refresh ${e?"enabled":"disabled"}`)},Cn=()=>{ln(e=>{const n=!e;return z({debug:n}),n})},zn=e=>{e.preventDefault(),Xe(!0),document.body.classList.add("resizing");const n=e.clientX,t=ue(),l=f=>{const d=f.clientX-n,h=Math.max(300,Math.min(800,t-d));Zt(h)},u=()=>{Xe(!1),document.body.classList.remove("resizing"),z({filterPanelWidth:ue()}),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",u)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",u)},Dn=e=>{e.preventDefault(),Ke(!0),document.body.classList.add("resizing");const n=e.clientX,t=pe(),l=f=>{const d=f.clientX-n,h=Math.max(300,Math.min(800,t+d));en(h)},u=()=>{Ke(!1),document.body.classList.remove("resizing"),z({browsePanelWidth:pe()}),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",u)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",u)},Mn=e=>{switch(e){case"original":return"background: #ff00ff; color: #000000;";case"thumbnail":return"background: #666666; color: #ffffff;";case"waveform":return"background: #444444; color: #ffffff;";case"preview":return"background: #333333; color: #ffffff;";default:return"background: #222222; color: #ffffff;"}},mt=e=>{if(e===0)return"0 B";const n=1024,t=["B","KB","MB","GB"],l=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,l)).toFixed(1))+" "+t[l]},In=e=>{switch(e){case ce.Connected:return"color: #ff00ff; font-weight: 600;";case ce.Connecting:return"color: #ffffff; font-weight: 600;";case ce.Disconnected:return"color: #666666; font-weight: 600;";default:return"color: #888888;"}},Ln=de(()=>[...new Set(y.state().items.map(n=>jt(n.mime||"")).filter(n=>n!=="unknown"))].sort()),Pn=de(()=>[...new Set(y.state().items.map(n=>n.blob_type))].sort());return $i(()=>{$("🚀 MediaBlob Grid mounted");const e=t=>{const l=t.target;!l.closest(".action-menu")&&!l.closest("[data-action-button]")&&!l.closest(".bulk-action-button")&&ee()},n=t=>{if(t.key==="Escape")ee(),fe(null),dt();else if(t.key==="a"&&(t.metaKey||t.ctrlKey))t.preventDefault(),fn();else if((t.key==="Backspace"||t.key==="Delete")&&L().size>0){const l=O().filter(u=>L().has(u.id));ut(l)}};document.addEventListener("click",e),document.addEventListener("keydown",n),document.addEventListener("mousemove",pt),document.addEventListener("mouseup",gt),Ut(()=>{document.removeEventListener("click",e),document.removeEventListener("keydown",n),document.removeEventListener("mousemove",pt),document.removeEventListener("mouseup",gt)})}),Ut(()=>{$("🧹 MediaBlob Grid cleanup")}),(()=>{var e=Ni(),n=e.firstChild,t=n.nextSibling,l=t.firstChild,u=l.firstChild,f=u.nextSibling,d=l.nextSibling,h=t.nextSibling,_=h.firstChild,M=_.firstChild,F=h.nextSibling,V=F.nextSibling,K=V.firstChild,re=K.firstChild,Ee=re.nextSibling,xt=Ee.nextSibling,Tn=xt.firstChild,vt=Tn.nextSibling,$t=xt.nextSibling,Be=$t.firstChild,wt=Be.nextSibling,An=$t.nextSibling,En=An.firstChild,Re=En.nextSibling,We=K.nextSibling,Bn=We.firstChild,Rn=Bn.nextSibling,me=Rn.firstChild,Wn=me.nextSibling,_t=We.nextSibling,Fn=_t.firstChild,xe=Fn.nextSibling;xe.firstChild;var yt=_t.nextSibling,Vn=yt.firstChild,ve=Vn.nextSibling;ve.firstChild;var St=yt.nextSibling,Hn=St.firstChild,Un=Hn.nextSibling,Fe=Un.firstChild,Gn=Fe.nextSibling,kt=Gn.nextSibling,Ct=St.nextSibling,Nn=Ct.firstChild,zt=Nn.nextSibling,Dt=Ct.nextSibling,On=Dt.firstChild,Mt=On.nextSibling,It=Dt.nextSibling,Xn=It.firstChild,Kn=Xn.nextSibling,Ve=Kn.firstChild,He=Ve.nextSibling,Lt=He.nextSibling,Pt=It.nextSibling,jn=Pt.firstChild,ae=jn.nextSibling,qn=ae.firstChild,Tt=ae.nextSibling,At=Pt.nextSibling,Yn=At.firstChild,J=Yn.nextSibling,Jn=J.firstChild,Et=Jn.nextSibling,Zn=Et.nextSibling,Qn=Zn.nextSibling,ei=Qn.nextSibling,Bt=ei.nextSibling,ti=Bt.nextSibling,ni=ti.nextSibling,ii=ni.nextSibling,Rt=ii.nextSibling,oi=Rt.nextSibling,Wt=oi.nextSibling,li=Wt.nextSibling,ri=li.nextSibling;ri.nextSibling;var Ft=J.nextSibling,ai=Ft.firstChild,Ue=ai.nextSibling,si=Ft.nextSibling,Ge=At.nextSibling;return o(n,()=>`
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
          margin-left: -${pe()}px;
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
          margin-right: -${ue()}px;
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
      `),o(t,g(w,{get when(){return ke()},get children(){var i=Bi();return i.$$click=ht,i}}),l),f.$$input=i=>Y("name",i.currentTarget.value),d.$$mousedown=Dn,o(_,g(w,{get when(){return!ke()},get children(){var i=Ri();return i.$$click=ht,i}}),M),M.$$click=bt,o(M,()=>Se()?"← Hide Controls":"Show Controls →"),o(_,g(w,{get when(){return L().size>1},get children(){var i=Wi(),a=i.firstChild,p=a.firstChild,r=p.nextSibling;r.nextSibling;var m=a.nextSibling,R=m.nextSibling,H=R.firstChild,W=R.nextSibling;return o(a,()=>L().size,p),o(a,()=>L().size===1?"":"s",r),m.$$click=ct,H.$$click=I=>{I.stopPropagation(),I.preventDefault(),console.log("Bulk action More button clicked");const A=I.target.getBoundingClientRect(),D=O().filter(X=>L().has(X.id));if(console.log("Selected items for bulk action:",D.length),D.length>0){let b=A.left,P=A.top-120-8;b+160>window.innerWidth&&(b=A.right-160),P<0&&(P=A.bottom+4),oe({item:D[0],x:b,y:P}),$(`⋯ Bulk action menu opened for ${D.length} items`)}else console.log("No selected items for bulk action")},W.$$click=dt,i}}),null),o(F,g(wi,{get data(){return O()},get columns(){return xn()},onSort:vn,get sortField(){return v().field},get sortDirection(){return v().direction},get rowHeight(){return at()},headerHeight:60,theme:"dark",onRowDoubleClick:wn,onRowMount:i=>mn(i),onRowClick:(i,a,p)=>gn(i,a,p),onRowMouseDown:(i,a,p)=>hn(i,a,p),onContextMenu:(i,a,p)=>_n(i,a,p),get selectedItems(){return L()},get isDragSelecting(){return le()}})),o(V,g(w,{get when(){return Se()},get children(){var i=Fi();return i.$$click=bt,i}}),K),Ee.$$input=i=>yn(i.currentTarget.value),o(vt,()=>y.state().connectionStatus),Be.$$click=()=>{y.actions.connect(),$("🔌 Connect clicked")},wt.$$click=()=>{y.actions.disconnect(),$("🔌 Disconnect clicked")},Re.$$click=Sn,o(Re,()=>De()?"ON":"OFF"),me.$$click=kn,o(me,()=>ne()?"ON":"OFF"),Wn.$$click=()=>{y.actions.refresh(),$("🔄 Manual refresh")},o(We,g(w,{get when(){return Ne(()=>!!y.state().hasPendingUpdates)()&&!ne()},get children(){var i=Vi(),a=i.firstChild,p=a.firstChild,r=p.nextSibling;return r.nextSibling,a.$$click=()=>{y.actions.applyPendingUpdates(),$("📥 Applied pending updates")},o(a,()=>y.state().pendingUpdates.length,r),i}}),null),xe.addEventListener("change",i=>Y("mime",i.currentTarget.value)),o(xe,g(ye,{get each(){return Ln()},children:i=>(()=>{var a=Xt();return a.value=i,o(a,i),a})()}),null),ve.addEventListener("change",i=>Y("blobType",i.currentTarget.value)),o(ve,g(ye,{get each(){return Pn()},children:i=>(()=>{var a=Xt();return a.value=i,o(a,i),a})()}),null),Fe.$$input=i=>Y("minSize",parseInt(i.currentTarget.value)||0),kt.$$input=i=>Y("maxSize",parseInt(i.currentTarget.value)||1e8),zt.addEventListener("change",i=>Y("hasParent",i.currentTarget.value)),Mt.addEventListener("change",i=>Y("hasLocalPath",i.currentTarget.value)),Ve.$$click=()=>Te("compact"),He.$$click=()=>Te("default"),Lt.$$click=()=>Te("detailed"),ae.$$click=()=>dn(!ge()),o(ae,()=>ge()?"Hide":"Show",qn),o(Tt,g(ye,{each:Ae,children:i=>(()=>{var a=Oi(),p=a.firstChild,r=p.firstChild,m=r.nextSibling;return r.addEventListener("change",()=>$n(i.key)),o(m,()=>i.title),C(()=>r.checked=Ye()[i.key]),a})()})),o(J,()=>y.state().items.length,Et),o(J,()=>Pe().length,Bt),o(J,()=>v().field,Rt),o(J,()=>v().direction,Wt),o(J,()=>y.state().lastUpdated?.toLocaleTimeString()||"Never",null),Ue.$$click=Cn,o(Ue,()=>ie()?"ON":"OFF"),si.$$click=()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Oe),window.location.reload())},o(V,g(w,{get when(){return Ne(()=>!!ie())()&&qe().length>0},get children(){var i=Hi(),a=i.firstChild,p=a.nextSibling;return o(p,g(ye,{get each(){return qe()},children:r=>(()=>{var m=Gt();return o(m,r),m})()})),i}}),Ge),Ge.$$mousedown=zn,o(e,g(w,{get when(){return Je()?.show},get children(){var i=Ui(),a=i.firstChild,p=a.firstChild;return i.$$click=r=>{r.target===r.currentTarget&&ft()},p.$$click=ft,o(a,g(w,{get when(){return Je()?.item},children:r=>{const m=r().mime||"",R=m.startsWith("image/"),H=m.startsWith("video/"),W=m.startsWith("audio/");return(()=>{var I=Zi(),A=I.firstChild,D=A.nextSibling,X=D.firstChild,j=X.firstChild,b=j.nextSibling,P=X.nextSibling,$e=P.firstChild,we=$e.nextSibling,se=P.nextSibling,_e=se.firstChild,di=_e.nextSibling,Vt=se.nextSibling,ci=Vt.firstChild,ui=ci.nextSibling,Ht=Vt.nextSibling,pi=Ht.firstChild,gi=pi.nextSibling,fi=Ht.nextSibling,bi=fi.firstChild,hi=bi.nextSibling;return o(A,()=>B(r())),o(I,g(w,{when:R,get children(){var S=Xi();return S.addEventListener("error",k=>{const U=k.target;U.style.display="none";const Z=document.createElement("div");Z.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                            </div>
                          `,U.parentNode?.appendChild(Z)}),C(k=>{var U=`/api/blobs/${r().id}`,Z=B(r());return U!==k.e&&E(S,"src",k.e=U),Z!==k.t&&E(S,"alt",k.t=Z),k},{e:void 0,t:void 0}),S}}),D),o(I,g(w,{when:H,get children(){var S=Ki(),k=S.firstChild;return E(k,"type",m),C(()=>E(k,"src",`/api/blobs/${r().id}`)),S}}),D),o(I,g(w,{when:W,get children(){var S=ji(),k=S.firstChild;return E(k,"type",m),C(()=>E(k,"src",`/api/blobs/${r().id}`)),S}}),D),o(I,g(w,{when:!R&&!H&&!W,get children(){var S=qi(),k=S.firstChild,U=k.nextSibling,Z=U.nextSibling,mi=Z.firstChild;return C(()=>E(mi,"href",`/api/blobs/${r().id}`)),S}}),D),o(b,()=>r().id),o(we,()=>r().sha256),o(di,()=>r().blob_type),o(ui,m||"unknown"),o(gi,()=>mt(r().size||0)),o(hi,()=>new Date(r().created_at).toLocaleString()),o(D,g(w,{get when(){return r().parent_blob_id},get children(){var S=Yi(),k=S.firstChild,U=k.nextSibling;return o(U,()=>r().parent_blob_id),S}}),null),o(D,g(w,{get when(){return r().local_path},get children(){var S=Ji(),k=S.firstChild,U=k.nextSibling;return o(U,()=>r().local_path),S}}),null),I})()}}),null),i}}),null),o(e,g(w,{get when(){return et()},children:i=>{const a=L().size>1,p=a?O().filter(r=>L().has(r.id)):[i().item];return console.log("ACTION MENU RENDERING:",{isVisible:!0,position:{x:i().x,y:i().y},isMultiSelect:a,selectedCount:L().size,windowDimensions:{width:window.innerWidth,height:window.innerHeight}}),(()=>{var r=to(),m=r.firstChild,R=m.firstChild,H=R.nextSibling;H.firstChild;var W=m.nextSibling,I=W.firstChild,A=I.nextSibling;A.firstChild;var D=W.nextSibling,X=D.firstChild,j=X.nextSibling;return j.firstChild,o(r,g(w,{when:!a,get children(){var b=Qi();return b.$$click=P=>{P.stopPropagation(),P.preventDefault(),fe({item:i().item,show:!0}),ee(),$(`👁️ Preview opened for: ${B(i().item)}`)},b}}),m),o(r,g(w,{when:a,get children(){var b=eo(),P=b.firstChild;return o(b,()=>p.length,P),b}}),m),m.$$click=b=>{b.stopPropagation(),b.preventDefault(),a?ct():st(i().item),ee()},o(H,()=>a?`(${p.length})`:"",null),W.$$click=b=>{b.stopPropagation(),b.preventDefault(),bn(p),ee()},o(A,()=>a?`(${p.length})`:"",null),D.$$click=b=>{b.stopPropagation(),b.preventDefault(),ut(p),ee()},o(j,()=>a?`(${p.length})`:"",null),C(b=>Q(r,`left: ${i().x}px; top: ${i().y}px;`,b)),r})()}}),null),o(e,g(w,{get when(){return Ne(()=>!!(le()&&Ie()))()&&it()},get children(){var i=Gi();return C(a=>Q(i,(()=>{const p=Ie(),r=it(),m=Math.min(p.x,r.x),R=Math.min(p.y,r.y),H=Math.abs(r.x-p.x),W=Math.abs(r.y-p.y);return`left: ${m}px; top: ${R}px; width: ${H}px; height: ${W}px;`})(),a)),i}}),null),C(i=>{var a=`browse-panel ${ke()?"":"collapsed"} ${ze()?"resizing":""}`,p=`width: ${pe()}px;`,r=`browse-resize-handle ${ze()?"dragging":""}`,m=`main-content ${Ce()?"resizing":""} ${ze()?"resizing-browse":""}`,R=`filter-panel ${Se()?"":"collapsed"} ${Ce()?"resizing":""}`,H=`width: ${ue()}px;`,W=In(y.state().connectionStatus),I=y.state().connectionStatus===ce.Connected,A=y.state().connectionStatus===ce.Disconnected,D=`toggle-button ${De()?"active":""}`,X=`toggle-button ${ne()?"active":""}`,j=`view-mode-button ${N()==="compact"?"active":""}`,b=`view-mode-button ${N()==="default"?"active":""}`,P=`view-mode-button ${N()==="detailed"?"active":""}`,$e=`toggle-button ${ge()?"active":""}`,we=`column-settings ${ge()?"":"collapsed"}`,se=`toggle-button ${ie()?"active":""}`,_e=`filter-resize-handle ${Ce()?"dragging":""}`;return a!==i.e&&T(t,i.e=a),i.t=Q(t,p,i.t),r!==i.a&&T(d,i.a=r),m!==i.o&&T(F,i.o=m),R!==i.i&&T(V,i.i=R),i.n=Q(V,H,i.n),i.s=Q(vt,W,i.s),I!==i.h&&(Be.disabled=i.h=I),A!==i.r&&(wt.disabled=i.r=A),D!==i.d&&T(Re,i.d=D),X!==i.l&&T(me,i.l=X),j!==i.u&&T(Ve,i.u=j),b!==i.c&&T(He,i.c=b),P!==i.w&&T(Lt,i.w=P),$e!==i.m&&T(ae,i.m=$e),we!==i.f&&T(Tt,i.f=we),se!==i.y&&T(Ue,i.y=se),_e!==i.g&&T(Ge,i.g=_e),i},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0}),C(()=>f.value=G().name),C(()=>Ee.value=je()),C(()=>xe.value=G().mime),C(()=>ve.value=G().blobType),C(()=>Fe.value=G().minSize),C(()=>kt.value=G().maxSize),C(()=>zt.value=G().hasParent),C(()=>Mt.value=G().hasLocalPath),e})()}class oo extends HTMLElement{dispose;connectedCallback(){console.log("🔌 InfiniteDataGridElement connected");try{this.dispose=vi(()=>g(io,{}),this),console.log("✅ MediaBlob Data Grid render successful")}catch(v){console.error("❌ MediaBlob Data Grid render failed:",v)}}disconnectedCallback(){console.log("🔌 InfiniteDataGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register infinite-data-grid custom element");try{customElements.define("infinite-data-grid",oo),console.log("✅ MediaBlob Data Grid custom element registered successfully")}catch(s){console.error("❌ Failed to register infinite-data-grid custom element:",s)}xi(["click","input","mousedown"]);
//# sourceMappingURL=infinite-data-grid.js.map
