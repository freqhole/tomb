import{f as xi,r as vi,g,c as m,k as ae,t as c,i as o,s as B,S as w,d as C,e as T,o as $i,b as Ht,m as Ue,F as we,j as se}from"./web-DJKfNvYW.js";import{G as wi}from"./generic-infinite-grid-Cf4UVf7C.js";import{u as _i}from"./useWebSocketFeed-DeZr3Ds9.js";import{C as de}from"./websocket-types-DZZ1YLNk.js";import"./websocket-client-NNVZjhvd.js";import"./types-DAeLdoVX.js";var yi=c("<img alt=Thumbnail style=width:100%;height:100%;object-fit:cover; loading=lazy>",!0,!1,!1),Si=c('<div style="position:absolute;bottom:2px;right:2px;width:8px;height:8px;background:#ff00ff;border-radius:50%;border:1px solid #ffffff;"title="Has thumbnails">'),Ut=c("<div>"),ki=c('<div style="width:12px;height:12px;border:2px solid #ff00ff;border-top:2px solid transparent;border-radius:50%;animation:spin 1s linear infinite;"title="Generating thumbnail...">'),Ci=c("<span style=font-size:16px;>"),zi=c('<code style="font-size:11px;background:#333;padding:2px 4px;border-radius:3px;color:#0ff;">...'),Di=c('<code style="font-size:11px;background:#333;padding:2px 4px;border-radius:3px;color:#f90;">...'),Mi=c("<span style=font-weight:500;color:#e0e0e0;>"),Ii=c("<span>"),Li=c("<span style=font-family:monospace;font-size:12px;>"),Pi=c("<span style=color:#ffffff;font-weight:600;font-size:12px;>"),Ti=c("<span style=color:#ff00ff;font-size:11px;>✓"),Gt=c("<span style=color:#666;>-"),Ai=c("<span style=color:#ff00ff;font-size:11px;>📁"),Nt=c("<span style=font-size:12px;color:#888;>"),Ei=c('<div style=position:relative;><button style="background:#3a3a3a;border:1px solid #4a4a4a;color:#e0e0e0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;"data-action-button>⋯'),Bi=c("<button class=panel-close-button>← Hide Browse"),Ri=c("<button class=panel-toggle-button>Show Browse →"),Wi=c("<div class=bulk-actions><span> item<!> selected</span><button class=bulk-action-button>📥 Download</button><div style=position:relative;><button class=bulk-action-button>⋯ More</button></div><button class=bulk-action-button style=background:#666666;border-color:#666666;>✕"),Fi=c("<button class=panel-close-button>Hide Controls →"),Vi=c("<div style=margin-bottom:8px;><button class=ws-button style=background:#f59e0b;border-color:#f59e0b;>Apply <!> Updates"),Hi=c("<div class=filter-section><h3>🐛 Debug Logs</h3><div class=debug-logs>"),Ui=c("<div class=popup-overlay><div class=popup-content><button class=popup-close>×"),Gi=c("<div class=drag-selection-box>"),Ni=c('<div class=mediablob-data-grid-container><style></style><div><div class=filter-section><h3>🔍 Name Search</h3><input class=filter-input type=text placeholder="Search by filename..."></div><div title="Drag to resize panel"></div></div><div class=toolbar-container><div class=controls-row><button class=panel-toggle-button></button></div></div><div></div><div><div class=filter-section><h3>🔌 WebSocket Connection</h3><input class=filter-input type=text placeholder="WebSocket URL"style=margin-bottom:8px;><div style=margin-bottom:8px;>Status: <span></span></div><div style=margin-bottom:8px;><button class=ws-button>Connect</button><button class="ws-button danger">Disconnect</button></div><div style=display:flex;gap:8px;align-items:center;font-size:12px;>Auto-connect:<button></button></div></div><div class=filter-section><h3>🔄 Auto-refresh</h3><div style=display:flex;gap:8px;align-items:center;margin-bottom:8px;><button></button><button class=ws-button>Refresh</button></div></div><div class=filter-section><h3>📄 Content Type</h3><select class=filter-select><option value>All Types</option></select></div><div class=filter-section><h3>🏷️ Blob Type</h3><select class=filter-select><option value>All Types</option></select></div><div class=filter-section><h3>📏 Size Range (bytes)</h3><div class=filter-range><input class=filter-input type=number placeholder=Min><span>-</span><input class=filter-input type=number placeholder=Max></div></div><div class=filter-section><h3>🔗 Has Parent</h3><select class=filter-select><option value=all>All</option><option value=yes>Has Parent</option><option value=no>No Parent</option></select></div><div class=filter-section><h3>📁 Has Local Path</h3><select class=filter-select><option value=all>All</option><option value=yes>Has Local Path</option><option value=no>No Local Path</option></select></div><div class=filter-section><h3>🎨 View Mode</h3><div class=view-mode-selector><button>Compact</button><button>Default</button><button>Detailed</button></div></div><div class=filter-section><h3>👁️ Column Visibility</h3><button style=margin-bottom:8px;width:100%;> Column Settings</button><div></div></div><div class=filter-section><h3>📊 Data Info</h3><p style="font-size:12px;color:#888;margin:0 0 10px 0;">Total: <!> blobs<br>Filtered: <!> results<br>Sort: <!> (<!>)<br>Last updated: </p><div style=margin-bottom:8px;>Debug:<button style=margin-left:8px;></button></div><button class=reset-button title="Reset all filters and settings">Reset All</button></div><div title="Drag to resize panel">'),Ot=c("<option>"),Oi=c("<div class=column-toggle><label style=display:flex;align-items:center;cursor:pointer;><input type=checkbox><span>"),Ki=c("<img class=popup-image>"),Xi=c("<video class=popup-video controls preload=metadata><source>Your browser does not support video playback."),ji=c('<audio controls style="width:100%;margin:20px 0;"preload=metadata><source>Your browser does not support audio playback.'),qi=c('<div style=padding:40px;text-align:center;color:#b0b0b0;><div style=font-size:3rem;margin-bottom:1rem;>📎</div><div>File preview not available</div><div style=margin-top:16px;><a target=_blank style="padding:8px 16px;background:#ff00ff;color:#000000;text-decoration:none;border-radius:4px;">Download File'),Yi=c("<div class=popup-meta-row><span class=popup-meta-label>Parent:</span><span style=font-family:monospace;font-size:12px;>"),Ji=c("<div class=popup-meta-row><span class=popup-meta-label>Local Path:</span><span style=font-family:monospace;font-size:12px;>"),Zi=c('<div><h3 style="margin:0 0 16px 0;color:#e0e0e0;"></h3><div class=popup-meta><div class=popup-meta-row><span class=popup-meta-label>ID:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>SHA256:</span><span style=font-family:monospace;font-size:12px;></span></div><div class=popup-meta-row><span class=popup-meta-label>Type:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>MIME:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>Size:</span><span></span></div><div class=popup-meta-row><span class=popup-meta-label>Created:</span><span>'),Qi=c("<button class=action-menu-item><span>👁️</span><span>Preview"),eo=c('<div style="padding:8px 12px;font-size:11px;color:#888;border-bottom:1px solid #444;"> items selected'),to=c("<div class=action-menu><button class=action-menu-item><span>📥</span><span>Download </span></button><button class=action-menu-item><span>🎵</span><span>Add to Playlist </span></button><button class=action-menu-item style=color:#ef4444;><span>🗑️</span><span>Delete ");console.log("🚀 MediaBlob Data Grid script loading");const Ge="mediablob-grid-state",Kt=350;function jt(){try{const s=localStorage.getItem(Ge);return s?JSON.parse(s):{}}catch(s){return console.warn("Failed to load grid state from localStorage:",s),{}}}function z(s){try{const ee={...jt(),...s};localStorage.setItem(Ge,JSON.stringify(ee))}catch(x){console.warn("Failed to save grid state to localStorage:",x)}}const no=(s,x)=>{const ee=new Uint8Array(s),U=new Blob([ee],{type:x});return URL.createObjectURL(U)};function R(s){if(s.metadata&&typeof s.metadata=="object"){const x=s.metadata;if(x.originalName||x.filename||x.original_filename||x.file_name||x.name)return x.originalName||x.filename||x.original_filename||x.file_name||x.name}return s.filename||s.local_path?.split("/").pop()||`${s.sha256.slice(0,8)}...${s.sha256.slice(-4)}`}function Xt(s){return s?s.split("/")[0]:"unknown"}function io(){console.log("📦 MediaBlobDataGrid component created");const s=jt(),[x,ee]=m(s.sortConfig||{field:"created_at",direction:"desc"}),[U,qt]=m(s.filterConfig||{name:"",mime:"",blobType:"",minSize:0,maxSize:1e8,hasParent:"all",hasLocalPath:"all"}),[_e,Yt]=m(s.isFilterPanelOpen??!0),[ce,Jt]=m(s.filterPanelWidth||Kt),[ye,Zt]=m(s.isBrowsePanelOpen??!0),[ue,Qt]=m(s.browsePanelWidth||Kt),[Se,Ne]=m(!1),[ke,Oe]=m(!1),[Ke,en]=m(s.wsUrl||"ws://localhost:8080/ws"),[Ce,tn]=m(s.autoConnect??!0),[te,nn]=m(s.autoRefresh??!1),[ne,on]=m(s.debug??!1),[Xe,ln]=m([]),[G,rn]=m(s.viewMode||"default"),[je,an]=m(s.columnVisibility||{thumbnail:!0,id:!1,sha256:!1,name:!0,blob_type:!0,mime:!0,size:!0,parent_blob_id:!0,local_path:!0,created_at:!0,updated_at:!0,actions:!0}),[pe,sn]=m(!1),[qe,ge]=m(null),[Ye,Je]=m(new Set),[Ze,ie]=m(null),[L,q]=m(new Set(s.selectedItems?Array.from(s.selectedItems):[])),[ze,fe]=m(-1),[oe,Qe]=m(!1),[De,et]=m(null),[tt,nt]=m(null),[Me,be]=m(null),y=_i({wsUrl:Ke(),channels:["MediaBlobs"],debug:ne(),autoConnect:Ce(),autoRefresh:te(),pageSize:50}),v=e=>{if(ne()){const n=new Date().toLocaleTimeString();ln(t=>[...t.slice(-19),`[${n}] ${e}`])}},Ie=ae(()=>{const e=U();return y.state().items.filter(n=>{const t=R(n),l=Xt(n.mime||"");return t.toLowerCase().includes(e.name.toLowerCase())&&(e.mime===""||l===e.mime)&&(e.blobType===""||n.blob_type===e.blobType)&&(n.size||0)>=e.minSize&&(n.size||0)<=e.maxSize&&(e.hasParent==="all"||e.hasParent==="yes"&&n.parent_blob_id||e.hasParent==="no"&&!n.parent_blob_id)&&(e.hasLocalPath==="all"||e.hasLocalPath==="yes"&&n.local_path||e.hasLocalPath==="no"&&!n.local_path)})}),N=ae(()=>{const e=x();return e.direction?[...Ie()].sort((t,l)=>{let u,f;const d=Pe.find(_=>_.key===e.field);d&&d.getValue?(u=d.getValue(t),f=d.getValue(l)):(u=t[e.field],f=l[e.field]);let $=0;return u<f&&($=-1),u>f&&($=1),e.direction==="desc"?-$:$}):Ie()}),it=e=>e.metadata?.thumbnails||[],ot=e=>e.metadata?.has_thumbnails===!0||it(e).length>0,dn=e=>{const n=it(e);if(n.length>0&&n[0]){const t=n[0];if(t.data&&t.data.length>0){const l=t.mime||"image/webp";return no(t.data,l)}return`/api/media-blobs/${t.id}/download`}return null},cn=e=>e?e.startsWith("image/")?"🖼️":e.startsWith("video/")?"🎥":e.startsWith("audio/")?"🎵":e.startsWith("text/")?"📝":e.includes("pdf")?"📄":"📎":"📎",Le=e=>{rn(e),z({viewMode:e}),v(`View mode changed to: ${e}`)},lt=()=>{switch(G()){case"compact":return 35;case"detailed":return 120;default:return 50}},rt=async e=>{try{const n=R(e),t=document.createElement("a");t.href=`/api/blobs/${e.id}`,t.download=n,document.body.appendChild(t),t.click(),document.body.removeChild(t),v(`📥 Downloaded: ${n}`)}catch(n){console.error("Download failed:",n),v(`❌ Download failed: ${n}`)}},un=(e,n)=>{console.log("toggleActionMenu called for:",e.id);const t=Ze();if(t&&t.item.id===e.id)ie(null),v(`⋯ Action menu closed for: ${R(e)}`);else{const l=n.target.getBoundingClientRect(),u=120,f=120;let d=l.right-u,$=l.bottom+4;d<0&&(d=l.left),d+u>window.innerWidth&&(d=window.innerWidth-u-8),$+f>window.innerHeight&&($=l.top-f-4),ie({item:e,x:d,y:$}),console.log("Action menu positioned at:",{x:d,y:$,rect:l}),v(`⋯ Action menu opened for: ${R(e)}`)}},Q=()=>{ie(null)},pn=(e,n,t)=>{const l=e.id,f=L().has(l),d=Me();d&&(clearTimeout(d),be(null));const $=window.setTimeout(()=>{if(t.metaKey||t.ctrlKey)q(_=>{const M=new Set(_);return f?M.delete(l):M.add(l),z({selectedItems:M}),M}),fe(n);else if(t.shiftKey&&ze()>=0){const _=Math.min(ze(),n),M=Math.max(ze(),n),F=N().slice(_,M+1);q(O=>{const X=new Set(O);return F.forEach(le=>X.add(le.id)),z({selectedItems:X}),X})}else{const _=new Set([l]);q(_),fe(n),z({selectedItems:_})}be(null)},200);be($),(t.metaKey||t.ctrlKey||t.shiftKey)&&t.preventDefault()},at=()=>{q(new Set),fe(-1),z({selectedItems:new Set})},gn=()=>{const e=new Set(N().map(n=>n.id));q(e),z({selectedItems:e})},st=async()=>{const e=Array.from(L()),n=N().filter(t=>e.includes(t.id));for(const t of n)await rt(t);v(`📥 Downloaded ${n.length} items`)},fn=e=>{v(`🎵 Added ${e.length} items to playlist (stub)`)},dt=e=>{v(`🗑️ Deleted ${e.length} items (stub)`)},bn=(e,n,t)=>{t.button===0&&!t.metaKey&&!t.ctrlKey&&!t.shiftKey&&!Me()&&(t.target.getBoundingClientRect(),et({x:t.clientX,y:t.clientY,startIndex:n}))},ct=e=>{const n=De();if(n&&!oe()&&Math.sqrt(Math.pow(e.clientX-n.x,2)+Math.pow(e.clientY-n.y,2))>5&&Qe(!0),oe()&&n){const t=document.querySelector(".grid-viewport");if(t){const l=t.getBoundingClientRect(),u=e.clientY-l.top+t.scrollTop,f=Math.floor(u/lt()),d=Math.max(0,Math.min(N().length-1,f));nt({x:e.clientX,y:e.clientY,endIndex:d});const $=Math.min(n.startIndex,d),_=Math.max(n.startIndex,d),M=N().slice($,_+1),F=new Set(M.map(O=>O.id));q(F)}}},ut=e=>{if(oe()){const n=L();z({selectedItems:n}),v(`Selected ${n.size} items via drag`)}Qe(!1),et(null),nt(null)},Pe=[{key:"thumbnail",title:"Thumbnail",width:G()==="compact"?0:G()==="detailed"?120:60,sortable:!1,render:(e,n)=>{if(G()==="compact")return null;const t=dn(e),u=G()==="detailed"?"100px":"40px";return(()=>{var f=Ut();return o(f,g(w,{when:t,get fallback(){return g(w,{get when(){return Ye().has(e.id)},get fallback(){return(()=>{var d=Ci();return o(d,()=>cn(e.mime)),d})()},get children(){return ki()}})},get children(){var d=yi();return d.addEventListener("error",$=>{const _=$.target;_.style.display="none"}),B(d,"src",t),d}}),null),o(f,g(w,{get when(){return ot(e)},get children(){return Si()}}),null),C(d=>se(f,`
              width: ${u};
              height: ${u};
              border-radius: 4px;
              overflow: hidden;
              background: #333;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
            `,d)),f})()}},{key:"id",title:"ID",width:100,sortable:!0,render:(e,n)=>(()=>{var t=zi(),l=t.firstChild;return B(t,"title",n),o(t,()=>n.slice(0,8),l),t})()},{key:"sha256",title:"SHA256",width:120,sortable:!0,render:(e,n)=>(()=>{var t=Di(),l=t.firstChild;return B(t,"title",n),o(t,()=>n.slice(0,12),l),t})()},{key:"name",title:"Name",sortable:!0,render:(e,n)=>(()=>{var t=Mi();return o(t,()=>R(e)),C(()=>B(t,"title",R(e))),t})(),getValue:e=>R(e)},{key:"blob_type",title:"Type",width:100,sortable:!0,render:(e,n)=>(()=>{var t=Ii();return T(t,`blob-type-badge blob-type-${n}`),o(t,n),C(l=>se(t,`
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            ${Dn(n)}
          `,l)),t})()},{key:"mime",title:"MIME Type",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Li();return o(t,n||"unknown"),t})()},{key:"size",title:"Size",width:100,sortable:!0,render:(e,n)=>(()=>{var t=Pi();return o(t,()=>bt(n||0)),t})()},{key:"parent_blob_id",title:"Parent",width:80,sortable:!0,render:(e,n)=>n?(()=>{var t=Ti();return B(t,"title",`Parent: ${n}`),t})():Gt()},{key:"local_path",title:"Local",width:80,sortable:!0,render:(e,n)=>n?(()=>{var t=Ai();return B(t,"title",n),t})():Gt()},{key:"created_at",title:"Created",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Nt();return o(t,()=>new Date(n).toLocaleString()),t})()},{key:"updated_at",title:"Updated",width:140,sortable:!0,render:(e,n)=>(()=>{var t=Nt();return o(t,()=>new Date(n).toLocaleString()),t})()},{key:"actions",title:"Actions",width:60,sortable:!1,render:(e,n)=>(()=>{var t=Ei(),l=t.firstChild;return l.$$click=u=>{u.stopPropagation(),u.preventDefault(),console.log("Action menu button clicked for:",e.id),v(`⋯ Action menu toggled for: ${R(e)}`),un(e,u)},t})()}],hn=e=>{const n=y.state().requestedThumbnails.has(e.id)||e.metadata?.thumbnails_requested||Ye().has(e.id);G()!=="compact"&&!ot(e)&&!n&&(Je(t=>new Set([...t,e.id])),y.actions.getThumbnails&&(y.actions.getThumbnails(e.id),setTimeout(()=>{Je(t=>{const l=new Set(t);return l.delete(e.id),l})},1e4)))},mn=ae(()=>{const e=je(),n=G();return Pe.filter(t=>t.key==="thumbnail"&&n==="compact"?!1:t.key==="actions"?!0:e[t.key]).map(t=>({...t,width:t.key==="thumbnail"?n==="detailed"?100:60:t.width}))}),xn=(e,n)=>{const t={field:e,direction:n};ee(t),z({sortConfig:t})},Y=(e,n)=>{qt(t=>{const l={...t,[e]:n};return z({filterConfig:l}),l})},vn=e=>{an(n=>{const t={...n,[e]:!n[e]};return z({columnVisibility:t}),t})},$n=e=>{const n=Me();n&&(clearTimeout(n),be(null)),ge({item:e,show:!0}),v(`🖱️ Double-clicked: ${R(e)}`)},wn=(e,n,t)=>{t.preventDefault();const l=e.id,u=L(),f=u.has(l);f||(q(new Set([l])),fe(n),z({selectedItems:new Set([l])})),t.target.getBoundingClientRect();const d=160,$=120;let _=t.clientX,M=t.clientY;_+d>window.innerWidth&&(_=window.innerWidth-d-8),M+$>window.innerHeight&&(M=window.innerHeight-$-8);const F=f?u:new Set([l]),O=F.size===1?e:Array.from(F).map(X=>N().find(le=>le.id===X)).filter(Boolean)[0]||e;ie({item:O,x:_,y:M}),v(`🖱️ Right-clicked: ${R(e)} (${F.size} selected)`)},pt=()=>{ge(null)},gt=()=>{Yt(e=>{const n=!e;return z({isFilterPanelOpen:n}),n})},ft=()=>{Zt(e=>{const n=!e;return z({isBrowsePanelOpen:n}),n})},_n=e=>{en(e),z({wsUrl:e})},yn=()=>{tn(e=>{const n=!e;return z({autoConnect:n}),n})},Sn=()=>{const e=!te();nn(e),z({autoRefresh:e}),y.actions.toggleAutoRefresh(),v(`Auto-refresh ${e?"enabled":"disabled"}`)},kn=()=>{on(e=>{const n=!e;return z({debug:n}),n})},Cn=e=>{e.preventDefault(),Ne(!0),document.body.classList.add("resizing");const n=e.clientX,t=ce(),l=f=>{const d=Math.max(300,Math.min(600,t-(f.clientX-n)));Jt(d)},u=()=>{Ne(!1),document.body.classList.remove("resizing"),z({filterPanelWidth:ce()}),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",u)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",u)},zn=e=>{e.preventDefault(),Oe(!0),document.body.classList.add("resizing");const n=e.clientX,t=ue(),l=f=>{const d=Math.max(300,Math.min(600,t+f.clientX-n));Qt(d)},u=()=>{Oe(!1),document.body.classList.remove("resizing"),z({browsePanelWidth:ue()}),document.removeEventListener("mousemove",l),document.removeEventListener("mouseup",u)};document.addEventListener("mousemove",l),document.addEventListener("mouseup",u)},Dn=e=>{switch(e){case"original":return"background: #ff00ff; color: #000000;";case"thumbnail":return"background: #666666; color: #ffffff;";case"waveform":return"background: #444444; color: #ffffff;";case"preview":return"background: #333333; color: #ffffff;";default:return"background: #222222; color: #ffffff;"}},bt=e=>{if(e===0)return"0 B";const n=1024,t=["B","KB","MB","GB"],l=Math.floor(Math.log(e)/Math.log(n));return parseFloat((e/Math.pow(n,l)).toFixed(1))+" "+t[l]},Mn=e=>{switch(e){case de.Connected:return"color: #ff00ff; font-weight: 600;";case de.Connecting:return"color: #ffffff; font-weight: 600;";case de.Disconnected:return"color: #666666; font-weight: 600;";default:return"color: #888888;"}},In=ae(()=>[...new Set(y.state().items.map(n=>Xt(n.mime||"")).filter(n=>n!=="unknown"))].sort()),Ln=ae(()=>[...new Set(y.state().items.map(n=>n.blob_type))].sort());return $i(()=>{v("🚀 MediaBlob Grid mounted");const e=t=>{const l=t.target;!l.closest(".action-menu")&&!l.closest("[data-action-button]")&&!l.closest(".bulk-action-button")&&Q()},n=t=>{if(t.key==="Escape")Q(),ge(null),at();else if(t.key==="a"&&(t.metaKey||t.ctrlKey))t.preventDefault(),gn();else if((t.key==="Backspace"||t.key==="Delete")&&L().size>0){const l=N().filter(u=>L().has(u.id));dt(l)}};document.addEventListener("click",e),document.addEventListener("keydown",n),document.addEventListener("mousemove",ct),document.addEventListener("mouseup",ut),Ht(()=>{document.removeEventListener("click",e),document.removeEventListener("keydown",n),document.removeEventListener("mousemove",ct),document.removeEventListener("mouseup",ut)})}),Ht(()=>{v("🧹 MediaBlob Grid cleanup")}),(()=>{var e=Ni(),n=e.firstChild,t=n.nextSibling,l=t.firstChild,u=l.firstChild,f=u.nextSibling,d=l.nextSibling,$=t.nextSibling,_=$.firstChild,M=_.firstChild,F=$.nextSibling,O=F.nextSibling,X=O.firstChild,le=X.firstChild,Te=le.nextSibling,ht=Te.nextSibling,Pn=ht.firstChild,mt=Pn.nextSibling,xt=ht.nextSibling,Ae=xt.firstChild,vt=Ae.nextSibling,Tn=xt.nextSibling,An=Tn.firstChild,Ee=An.nextSibling,Be=X.nextSibling,En=Be.firstChild,Bn=En.nextSibling,he=Bn.firstChild,Rn=he.nextSibling,$t=Be.nextSibling,Wn=$t.firstChild,me=Wn.nextSibling;me.firstChild;var wt=$t.nextSibling,Fn=wt.firstChild,xe=Fn.nextSibling;xe.firstChild;var _t=wt.nextSibling,Vn=_t.firstChild,Hn=Vn.nextSibling,Re=Hn.firstChild,Un=Re.nextSibling,yt=Un.nextSibling,St=_t.nextSibling,Gn=St.firstChild,kt=Gn.nextSibling,Ct=St.nextSibling,Nn=Ct.firstChild,zt=Nn.nextSibling,Dt=Ct.nextSibling,On=Dt.firstChild,Kn=On.nextSibling,We=Kn.firstChild,Fe=We.nextSibling,Mt=Fe.nextSibling,It=Dt.nextSibling,Xn=It.firstChild,re=Xn.nextSibling,jn=re.firstChild,Lt=re.nextSibling,Pt=It.nextSibling,qn=Pt.firstChild,J=qn.nextSibling,Yn=J.firstChild,Tt=Yn.nextSibling,Jn=Tt.nextSibling,Zn=Jn.nextSibling,Qn=Zn.nextSibling,At=Qn.nextSibling,ei=At.nextSibling,ti=ei.nextSibling,ni=ti.nextSibling,Et=ni.nextSibling,ii=Et.nextSibling,Bt=ii.nextSibling,oi=Bt.nextSibling,li=oi.nextSibling;li.nextSibling;var Rt=J.nextSibling,ri=Rt.firstChild,Ve=ri.nextSibling,ai=Rt.nextSibling,He=Pt.nextSibling;return o(n,()=>`
        .mediablob-data-grid-container {
          height: 100vh;
          background: #1a1a1a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          overflow: hidden;
        }


        .browse-panel {
          width: ${ue()}px;
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
          width: ${ce()}px;
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
      `),o(t,g(w,{get when(){return ye()},get children(){var i=Bi();return i.$$click=ft,i}}),l),f.$$input=i=>Y("name",i.currentTarget.value),d.$$mousedown=zn,o(_,g(w,{get when(){return!ye()},get children(){var i=Ri();return i.$$click=ft,i}}),M),M.$$click=gt,o(M,()=>_e()?"← Hide Controls":"Show Controls →"),o(_,g(w,{get when(){return L().size>1},get children(){var i=Wi(),a=i.firstChild,p=a.firstChild,r=p.nextSibling;r.nextSibling;var h=a.nextSibling,V=h.nextSibling,W=V.firstChild,A=V.nextSibling;return o(a,()=>L().size,p),o(a,()=>L().size===1?"":"s",r),h.$$click=st,W.$$click=I=>{I.stopPropagation(),I.preventDefault(),console.log("Bulk action More button clicked");const E=I.target.getBoundingClientRect(),D=N().filter(K=>L().has(K.id));if(console.log("Selected items for bulk action:",D.length),D.length>0){let b=E.left,P=E.top-120-8;b+160>window.innerWidth&&(b=E.right-160),P<0&&(P=E.bottom+4),ie({item:D[0],x:b,y:P}),v(`⋯ Bulk action menu opened for ${D.length} items`)}else console.log("No selected items for bulk action")},A.$$click=at,i}}),null),o(F,g(wi,{get data(){return N()},get columns(){return mn()},onSort:xn,get sortField(){return x().field},get sortDirection(){return x().direction},get rowHeight(){return lt()},headerHeight:60,theme:"dark",onRowDoubleClick:$n,onRowMount:i=>hn(i),onRowClick:(i,a,p)=>pn(i,a,p),onRowMouseDown:(i,a,p)=>bn(i,a,p),onContextMenu:(i,a,p)=>wn(i,a,p),get selectedItems(){return L()},get isDragSelecting(){return oe()}})),o(O,g(w,{get when(){return _e()},get children(){var i=Fi();return i.$$click=gt,i}}),X),Te.$$input=i=>_n(i.currentTarget.value),o(mt,()=>y.state().connectionStatus),Ae.$$click=()=>{y.actions.connect(),v("🔌 Connect clicked")},vt.$$click=()=>{y.actions.disconnect(),v("🔌 Disconnect clicked")},Ee.$$click=yn,o(Ee,()=>Ce()?"ON":"OFF"),he.$$click=Sn,o(he,()=>te()?"ON":"OFF"),Rn.$$click=()=>{y.actions.refresh(),v("🔄 Manual refresh")},o(Be,g(w,{get when(){return Ue(()=>!!y.state().hasPendingUpdates)()&&!te()},get children(){var i=Vi(),a=i.firstChild,p=a.firstChild,r=p.nextSibling;return r.nextSibling,a.$$click=()=>{y.actions.applyPendingUpdates(),v("📥 Applied pending updates")},o(a,()=>y.state().pendingUpdates.length,r),i}}),null),me.addEventListener("change",i=>Y("mime",i.currentTarget.value)),o(me,g(we,{get each(){return In()},children:i=>(()=>{var a=Ot();return a.value=i,o(a,i),a})()}),null),xe.addEventListener("change",i=>Y("blobType",i.currentTarget.value)),o(xe,g(we,{get each(){return Ln()},children:i=>(()=>{var a=Ot();return a.value=i,o(a,i),a})()}),null),Re.$$input=i=>Y("minSize",parseInt(i.currentTarget.value)||0),yt.$$input=i=>Y("maxSize",parseInt(i.currentTarget.value)||1e8),kt.addEventListener("change",i=>Y("hasParent",i.currentTarget.value)),zt.addEventListener("change",i=>Y("hasLocalPath",i.currentTarget.value)),We.$$click=()=>Le("compact"),Fe.$$click=()=>Le("default"),Mt.$$click=()=>Le("detailed"),re.$$click=()=>sn(!pe()),o(re,()=>pe()?"Hide":"Show",jn),o(Lt,g(we,{each:Pe,children:i=>(()=>{var a=Oi(),p=a.firstChild,r=p.firstChild,h=r.nextSibling;return r.addEventListener("change",()=>vn(i.key)),o(h,()=>i.title),C(()=>r.checked=je()[i.key]),a})()})),o(J,()=>y.state().items.length,Tt),o(J,()=>Ie().length,At),o(J,()=>x().field,Et),o(J,()=>x().direction,Bt),o(J,()=>y.state().lastUpdated?.toLocaleTimeString()||"Never",null),Ve.$$click=kn,o(Ve,()=>ne()?"ON":"OFF"),ai.$$click=()=>{confirm("Reset all filters, sort settings, and panel width? This will reload the page.")&&(localStorage.removeItem(Ge),window.location.reload())},o(O,g(w,{get when(){return Ue(()=>!!ne())()&&Xe().length>0},get children(){var i=Hi(),a=i.firstChild,p=a.nextSibling;return o(p,g(we,{get each(){return Xe()},children:r=>(()=>{var h=Ut();return o(h,r),h})()})),i}}),He),He.$$mousedown=Cn,o(e,g(w,{get when(){return qe()?.show},get children(){var i=Ui(),a=i.firstChild,p=a.firstChild;return i.$$click=r=>{r.target===r.currentTarget&&pt()},p.$$click=pt,o(a,g(w,{get when(){return qe()?.item},children:r=>{const h=r().mime||"",V=h.startsWith("image/"),W=h.startsWith("video/"),A=h.startsWith("audio/");return(()=>{var I=Zi(),E=I.firstChild,D=E.nextSibling,K=D.firstChild,j=K.firstChild,b=j.nextSibling,P=K.nextSibling,ve=P.firstChild,$e=ve.nextSibling,Wt=P.nextSibling,si=Wt.firstChild,di=si.nextSibling,Ft=Wt.nextSibling,ci=Ft.firstChild,ui=ci.nextSibling,Vt=Ft.nextSibling,pi=Vt.firstChild,gi=pi.nextSibling,fi=Vt.nextSibling,bi=fi.firstChild,hi=bi.nextSibling;return o(E,()=>R(r())),o(I,g(w,{when:V,get children(){var S=Ki();return S.addEventListener("error",k=>{const H=k.target;H.style.display="none";const Z=document.createElement("div");Z.innerHTML=`
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                            </div>
                          `,H.parentNode?.appendChild(Z)}),C(k=>{var H=`/api/blobs/${r().id}`,Z=R(r());return H!==k.e&&B(S,"src",k.e=H),Z!==k.t&&B(S,"alt",k.t=Z),k},{e:void 0,t:void 0}),S}}),D),o(I,g(w,{when:W,get children(){var S=Xi(),k=S.firstChild;return B(k,"type",h),C(()=>B(k,"src",`/api/blobs/${r().id}`)),S}}),D),o(I,g(w,{when:A,get children(){var S=ji(),k=S.firstChild;return B(k,"type",h),C(()=>B(k,"src",`/api/blobs/${r().id}`)),S}}),D),o(I,g(w,{when:!V&&!W&&!A,get children(){var S=qi(),k=S.firstChild,H=k.nextSibling,Z=H.nextSibling,mi=Z.firstChild;return C(()=>B(mi,"href",`/api/blobs/${r().id}`)),S}}),D),o(b,()=>r().id),o($e,()=>r().sha256),o(di,()=>r().blob_type),o(ui,h||"unknown"),o(gi,()=>bt(r().size||0)),o(hi,()=>new Date(r().created_at).toLocaleString()),o(D,g(w,{get when(){return r().parent_blob_id},get children(){var S=Yi(),k=S.firstChild,H=k.nextSibling;return o(H,()=>r().parent_blob_id),S}}),null),o(D,g(w,{get when(){return r().local_path},get children(){var S=Ji(),k=S.firstChild,H=k.nextSibling;return o(H,()=>r().local_path),S}}),null),I})()}}),null),i}}),null),o(e,g(w,{get when(){return Ze()},children:i=>{const a=L().size>1,p=a?N().filter(r=>L().has(r.id)):[i().item];return console.log("ACTION MENU RENDERING:",{isVisible:!0,position:{x:i().x,y:i().y},isMultiSelect:a,selectedCount:L().size,windowDimensions:{width:window.innerWidth,height:window.innerHeight}}),(()=>{var r=to(),h=r.firstChild,V=h.firstChild,W=V.nextSibling;W.firstChild;var A=h.nextSibling,I=A.firstChild,E=I.nextSibling;E.firstChild;var D=A.nextSibling,K=D.firstChild,j=K.nextSibling;return j.firstChild,o(r,g(w,{when:!a,get children(){var b=Qi();return b.$$click=P=>{P.stopPropagation(),P.preventDefault(),ge({item:i().item,show:!0}),Q(),v(`👁️ Preview opened for: ${R(i().item)}`)},b}}),h),o(r,g(w,{when:a,get children(){var b=eo(),P=b.firstChild;return o(b,()=>p.length,P),b}}),h),h.$$click=b=>{b.stopPropagation(),b.preventDefault(),a?st():rt(i().item),Q()},o(W,()=>a?`(${p.length})`:"",null),A.$$click=b=>{b.stopPropagation(),b.preventDefault(),fn(p),Q()},o(E,()=>a?`(${p.length})`:"",null),D.$$click=b=>{b.stopPropagation(),b.preventDefault(),dt(p),Q()},o(j,()=>a?`(${p.length})`:"",null),C(b=>se(r,`left: ${i().x}px; top: ${i().y}px;`,b)),r})()}}),null),o(e,g(w,{get when(){return Ue(()=>!!(oe()&&De()))()&&tt()},get children(){var i=Gi();return C(a=>se(i,(()=>{const p=De(),r=tt(),h=Math.min(p.x,r.x),V=Math.min(p.y,r.y),W=Math.abs(r.x-p.x),A=Math.abs(r.y-p.y);return`left: ${h}px; top: ${V}px; width: ${W}px; height: ${A}px;`})(),a)),i}}),null),C(i=>{var a=`browse-panel ${ye()?"":"collapsed"} ${ke()?"resizing":""}`,p=`browse-resize-handle ${ke()?"dragging":""}`,r=`main-content ${Se()?"resizing":""} ${ke()?"resizing-browse":""}`,h=`filter-panel ${_e()?"":"collapsed"} ${Se()?"resizing":""}`,V=Mn(y.state().connectionStatus),W=y.state().connectionStatus===de.Connected,A=y.state().connectionStatus===de.Disconnected,I=`toggle-button ${Ce()?"active":""}`,E=`toggle-button ${te()?"active":""}`,D=`view-mode-button ${G()==="compact"?"active":""}`,K=`view-mode-button ${G()==="default"?"active":""}`,j=`view-mode-button ${G()==="detailed"?"active":""}`,b=`toggle-button ${pe()?"active":""}`,P=`column-settings ${pe()?"":"collapsed"}`,ve=`toggle-button ${ne()?"active":""}`,$e=`filter-resize-handle ${Se()?"dragging":""}`;return a!==i.e&&T(t,i.e=a),p!==i.t&&T(d,i.t=p),r!==i.a&&T(F,i.a=r),h!==i.o&&T(O,i.o=h),i.i=se(mt,V,i.i),W!==i.n&&(Ae.disabled=i.n=W),A!==i.s&&(vt.disabled=i.s=A),I!==i.h&&T(Ee,i.h=I),E!==i.r&&T(he,i.r=E),D!==i.d&&T(We,i.d=D),K!==i.l&&T(Fe,i.l=K),j!==i.u&&T(Mt,i.u=j),b!==i.c&&T(re,i.c=b),P!==i.w&&T(Lt,i.w=P),ve!==i.m&&T(Ve,i.m=ve),$e!==i.f&&T(He,i.f=$e),i},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0}),C(()=>f.value=U().name),C(()=>Te.value=Ke()),C(()=>me.value=U().mime),C(()=>xe.value=U().blobType),C(()=>Re.value=U().minSize),C(()=>yt.value=U().maxSize),C(()=>kt.value=U().hasParent),C(()=>zt.value=U().hasLocalPath),e})()}class oo extends HTMLElement{dispose;connectedCallback(){console.log("🔌 InfiniteDataGridElement connected");try{this.dispose=vi(()=>g(io,{}),this),console.log("✅ MediaBlob Data Grid render successful")}catch(x){console.error("❌ MediaBlob Data Grid render failed:",x)}}disconnectedCallback(){console.log("🔌 InfiniteDataGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register infinite-data-grid custom element");try{customElements.define("infinite-data-grid",oo),console.log("✅ MediaBlob Data Grid custom element registered successfully")}catch(s){console.error("❌ Failed to register infinite-data-grid custom element:",s)}xi(["click","input","mousedown"]);
//# sourceMappingURL=infinite-data-grid.js.map
