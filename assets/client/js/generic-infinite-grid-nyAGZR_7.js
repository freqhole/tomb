import{d as Q,r as X,f as v,c as H,k as h,o as ee,h as te,t as b,i as c,S as re,b as _,F as R,e as C,s as N,u as ie}from"./web-q5xKJNDT.js";var ne=b("<span>"),oe=b("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),le=b("<span class=sort-icon>"),ae=b("<div><span class=header-title>"),se=b("<div>"),de=b("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function ce(t){console.log("📦 GenericInfiniteGrid component created");const a=()=>t.rowHeight||50,u=()=>t.headerHeight||60,p=5,[x,k]=H(0),[w,y]=H(window.innerHeight);H(0);let $;const V=h(()=>{const e=w()-u();return Math.ceil(e/a())}),S=h(()=>t.data.length),E=h(()=>{const e=Math.floor(x()/a());return Math.max(0,e-p)}),L=h(()=>{const e=E()+V()+p*2;return Math.min(S(),e)}),D=h(()=>Math.floor(x()/a())+1),F=h(()=>{const e=w()-u(),l=Math.floor(e/a()),s=Math.floor(x()/a())+l;return Math.min(s,S())});h(()=>Math.max(0,F()-D()+1));const O=h(()=>t.data.slice(E(),L())),B=h(()=>O().map((e,l)=>{const s=E()+l,r=e.id,m=t.selectedItems?.has(r)||!1;return{item:e,actualIndex:s,itemId:r,isSelected:m}})),J=h(()=>S()*a()),U=e=>{const l=e.target;k(l.scrollTop)},W=e=>{if(!t.onSort)return;const l=t.sortField,s=t.sortDirection;let r;l!==e?r="asc":s==="asc"?r="desc":s==="desc"?r=null:r="asc",t.onSort(e,r)},z=()=>{y(window.innerHeight)};ee(()=>{window.addEventListener("resize",z)}),te(()=>{window.removeEventListener("resize",z)});const j=e=>t.sortField!==e||!t.sortDirection?"↕":t.sortDirection==="asc"?"↑":"↓",Y=(e,l)=>{const s=e.getValue?e.getValue(l):l[e.key];return e.render?e.render(l,s):(()=>{var r=ne();return c(r,()=>String(s)),r})()};return(()=>{var e=oe(),l=e.firstChild,s=l.nextSibling,r=s.nextSibling,m=r.firstChild,I=r.nextSibling,Z=I.firstChild,A=Z.nextSibling,q=A.nextSibling,P=q.nextSibling;P.nextSibling,c(l,()=>`
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
          height: ${a()}px;
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
      `),c(s,v(R,{get each(){return t.columns},children:i=>(()=>{var n=ae(),g=n.firstChild;return n.$$click=()=>i.sortable&&W(i.key),c(g,()=>i.title),c(n,v(re,{get when(){return i.sortable},get children(){var f=le();return c(f,()=>j(i.key)),f}}),null),_(f=>{var G=`header-cell ${i.sortable?"":"not-sortable"}`,o=i.width?{"flex-basis":`${i.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return G!==f.e&&C(n,f.e=G),f.t=N(n,o,f.t),f},{e:void 0,t:void 0}),n})()})),r.addEventListener("scroll",U);var T=$;return typeof T=="function"?ie(T,r):$=r,c(m,v(R,{get each(){return B()},children:i=>{const{item:n,actualIndex:g,itemId:f,isSelected:G}=i;return t.onRowMount&&t.onRowMount(n),(()=>{var o=se();return o.$$contextmenu=d=>t.onContextMenu?.(n,g,d),o.$$mousedown=d=>t.onRowMouseDown?.(n,g,d),o.$$click=d=>t.onRowClick?.(n,g,d),o.$$dblclick=()=>t.onRowDoubleClick?.(n),C(o,`grid-row ${G?"selected":""}`),o.style.setProperty("position","absolute"),o.style.setProperty("top","0px"),o.style.setProperty("left","0px"),o.style.setProperty("right","0px"),c(o,v(R,{get each(){return t.columns},children:d=>(()=>{var M=de();return c(M,()=>Y(d,n)),_(K=>N(M,d.width?{"flex-basis":`${d.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},K)),M})()})),_(d=>(d=`translateY(${g*a()}px)`)!=null?o.style.setProperty("transform",d):o.style.removeProperty("transform")),o})()}})),c(I,D,A),c(I,F,P),c(I,S,null),_(i=>{var n=`generic-infinite-grid ${t.className||""}`,g=`${J()}px`;return n!==i.e&&C(e,i.e=n),g!==i.t&&((i.t=g)!=null?m.style.setProperty("height",g):m.style.removeProperty("height")),i},{e:void 0,t:void 0}),e})()}class ge extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const a=this.getAttribute("data"),u=this.getAttribute("columns"),p=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),k=this.getAttribute("theme")||"dark";let w=[],y=[];try{w=a?JSON.parse(a):[],y=u?JSON.parse(u):[]}catch($){console.error("Failed to parse data or columns attributes:",$)}this.dispose=X(()=>v(ce,{data:w,columns:y,rowHeight:p,headerHeight:x,theme:k,className:k}),this),console.log("✅ Generic Infinite Grid render successful")}catch(a){console.error("❌ Generic Infinite Grid render failed:",a)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ge),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}Q(["click","dblclick","mousedown","contextmenu"]);export{ce as G};
//# sourceMappingURL=generic-infinite-grid-nyAGZR_7.js.map
