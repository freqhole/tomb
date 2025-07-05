import{d as X,r as ee,i as p,c as E,h,o as te,f as re,t as b,k as c,S as ie,b as G,F as M,e as R,s as N,l as ne}from"./web-D0fRMFns.js";var oe=b("<span>"),le=b("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),se=b("<span class=sort-icon>"),ae=b("<div><span class=header-title>"),de=b("<div>"),ce=b("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function ge(t){console.log("📦 GenericInfiniteGrid component created");const s=()=>t.rowHeight||50,u=()=>t.headerHeight||60,v=5,[x,k]=E(0),[w,y]=E(window.innerHeight),[C,fe]=E(0);let D;const L=h(()=>{const e=w()-u();return Math.ceil(e/s())}),$=h(()=>t.data.length),_=h(()=>{const e=Math.floor(x()/s());return Math.max(0,e-v)}),O=h(()=>{const e=_()+L()+v*2;return Math.min($(),e)}),F=h(()=>Math.floor(x()/s())+1),z=h(()=>{const e=w()-u(),l=Math.floor(e/s()),a=Math.floor(x()/s())+l;return Math.min(a,$())});h(()=>Math.max(0,z()-F()+1));const B=h(()=>t.data.slice(_(),O())),J=h(()=>B().map((e,l)=>{const a=_()+l,r=e.id,m=t.selectedItems?.has(r)||!1;return{item:e,actualIndex:a,itemId:r,isSelected:m}})),U=h(()=>$()*s()),W=e=>{const l=e.target;k(l.scrollTop)},j=e=>{if(!t.onSort)return;const l=t.sortField,a=t.sortDirection;let r;l!==e?r="asc":a==="asc"?r="desc":a==="desc"?r=null:r="asc",t.onSort(e,r)},A=()=>{y(window.innerHeight)};te(()=>{window.addEventListener("resize",A)}),re(()=>{window.removeEventListener("resize",A)});const Y=e=>t.sortField!==e||!t.sortDirection?"↕":t.sortDirection==="asc"?"↑":"↓",Z=(e,l)=>{const a=e.getValue?e.getValue(l):l[e.key];return e.render?e.render(l,a):(()=>{var r=oe();return c(r,()=>String(a)),r})()};return(()=>{var e=le(),l=e.firstChild,a=l.nextSibling,r=a.nextSibling,m=r.firstChild,S=r.nextSibling,q=S.firstChild,P=q.nextSibling,K=P.nextSibling,T=K.nextSibling;T.nextSibling,c(l,()=>`
        .generic-infinite-grid {
          height: 100vh;
          background: #1a1a1a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .generic-infinite-grid.light {
          background: #ffffff;
          color: #1a1a1a;
        }

        .grid-header {
          height: ${u()}px;
          background: #2a2a2a;
          border-bottom: 2px solid #3a3a3a;
          display: flex;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 5;
        }

        .light .grid-header {
          background: #f8f9fa;
          border-bottom-color: #dee2e6;
        }

        .header-cell {
          flex: 1;
          padding: 0 12px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          user-select: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-right: 1px solid #3a3a3a;
          transition: background-color 0.2s;
          min-width: 0;
          height: 100%;
        }

        .light .header-cell {
          border-right-color: #dee2e6;
        }

        .header-cell:hover {
          background: #3a3a3a;
        }

        .light .header-cell:hover {
          background: #e9ecef;
        }

        .header-cell:last-child {
          border-right: none;
        }

        .header-cell.not-sortable {
          cursor: default;
        }

        .header-cell.not-sortable:hover {
          background: transparent;
        }

        .header-title {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sort-icon {
          margin-left: 8px;
          opacity: 0.6;
          font-size: 12px;
          flex-shrink: 0;
        }

        .grid-viewport {
          flex: 1;
          overflow: auto;
          position: relative;
        }

        .grid-content {
          position: relative;
        }

        .grid-row {
          height: ${s()}px;
          display: flex;
          align-items: center;
          border-bottom: 1px solid #2a2a2a;
          background: #1a1a1a;
          will-change: transform;
        }

        .light .grid-row {
          border-bottom-color: #dee2e6;
          background: #ffffff;
        }

        .grid-row:hover {
          background: #252525;
        }

        .light .grid-row:hover {
          background: #f8f9fa;
        }

        .grid-row.selected {
          background: rgba(255, 0, 255, 0.15) !important;
          box-shadow: inset 0 0 0 2px rgba(255, 0, 255, 0.4) !important;
          transition: all 0.15s ease !important;
        }

        .grid-row.selected:hover {
          background: rgba(255, 0, 255, 0.25) !important;
          box-shadow: inset 0 0 0 2px rgba(255, 0, 255, 0.6) !important;
        }

        .light .grid-row.selected {
          background: rgba(255, 0, 255, 0.1) !important;
          box-shadow: inset 0 0 0 2px rgba(255, 0, 255, 0.3) !important;
        }

        .light .grid-row.selected:hover {
          background: rgba(255, 0, 255, 0.2) !important;
          box-shadow: inset 0 0 0 2px rgba(255, 0, 255, 0.4) !important;
        }

        .grid-cell {
          flex: 1;
          padding: 0 12px;
          font-size: 14px;
          border-right: 1px solid #2a2a2a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .light .grid-cell {
          border-right-color: #dee2e6;
        }

        .grid-cell:last-child {
          border-right: none;
        }

        .grid-stats {
          position: absolute;
          bottom: 20px;
          right: 20px;
          background: #2a2a2a;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          color: #b0b0b0;
          border: 1px solid #3a3a3a;
          z-index: 10;
        }

        .light .grid-stats {
          background: #f8f9fa;
          color: #6c757d;
          border-color: #dee2e6;
        }
      `),c(a,p(M,{get each(){return t.columns},children:i=>(()=>{var n=ae(),g=n.firstChild;return n.$$click=()=>i.sortable&&j(i.key),c(g,()=>i.title),c(n,p(ie,{get when(){return i.sortable},get children(){var f=se();return c(f,()=>Y(i.key)),f}}),null),G(f=>{var I=`header-cell ${i.sortable?"":"not-sortable"}`,o=i.width?{"flex-basis":`${i.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return I!==f.e&&R(n,f.e=I),f.t=N(n,o,f.t),f},{e:void 0,t:void 0}),n})()})),r.addEventListener("scroll",W);var V=D;return typeof V=="function"?ne(V,r):D=r,c(m,p(M,{get each(){return J()},children:i=>{const{item:n,actualIndex:g,itemId:f,isSelected:I}=i;return t.onRowMount&&t.onRowMount(n),(()=>{var o=de();return o.$$contextmenu=d=>t.onContextMenu?.(n,g,d),o.$$mousedown=d=>t.onRowMouseDown?.(n,g,d),o.$$click=d=>t.onRowClick?.(n,g,d),o.$$dblclick=()=>t.onRowDoubleClick?.(n),R(o,`grid-row ${I?"selected":""}`),o.style.setProperty("position","absolute"),o.style.setProperty("top","0px"),o.style.setProperty("left","0px"),o.style.setProperty("right","0px"),c(o,p(M,{get each(){return t.columns},children:d=>(()=>{var H=ce();return c(H,()=>Z(d,n)),G(Q=>N(H,d.width?{"flex-basis":`${d.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},Q)),H})()})),G(d=>(d=`translateY(${g*s()}px)`)!=null?o.style.setProperty("transform",d):o.style.removeProperty("transform")),o})()}})),c(S,F,P),c(S,z,T),c(S,$,null),G(i=>{var n=`generic-infinite-grid ${t.className||""}`,g=`${U()}px`;return n!==i.e&&R(e,i.e=n),g!==i.t&&((i.t=g)!=null?m.style.setProperty("height",g):m.style.removeProperty("height")),i},{e:void 0,t:void 0}),e})()}class he extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const s=this.getAttribute("data"),u=this.getAttribute("columns"),v=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),k=this.getAttribute("theme")||"dark";let w=[],y=[];try{w=s?JSON.parse(s):[],y=u?JSON.parse(u):[]}catch(C){console.error("Failed to parse data or columns attributes:",C)}this.dispose=ee(()=>p(ge,{data:w,columns:y,rowHeight:v,headerHeight:x,theme:k,className:k}),this),console.log("✅ Generic Infinite Grid render successful")}catch(s){console.error("❌ Generic Infinite Grid render failed:",s)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",he),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}X(["click","dblclick","mousedown","contextmenu"]);export{ge as G};
//# sourceMappingURL=generic-infinite-grid-Bxa11vs7.js.map
