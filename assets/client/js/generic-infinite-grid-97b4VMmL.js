import{f as Q,r as X,g as v,c as M,k as h,o as ee,b as te,t as u,i as l,S as re,d as G,F as R,e as C,j as L,u as ie}from"./web-DJKfNvYW.js";var oe=u("<span>"),ne=u("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),ae=u("<span class=sort-icon>"),le=u("<div><span class=header-title>"),se=u("<div>"),de=u("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function ce(t){console.log("📦 GenericInfiniteGrid component created");const n=()=>t.rowHeight||50,b=()=>t.headerHeight||60,k=5,[x,y]=M(0),[p,$]=M(window.innerHeight);M(0);let S;const V=h(()=>{const e=p()-b();return Math.ceil(e/n())}),I=h(()=>t.data.length),_=h(()=>{const e=Math.floor(x()/n());return Math.max(0,e-k)}),N=h(()=>{const e=_()+V()+k*2;return Math.min(I(),e)}),D=h(()=>Math.floor(x()/n())+1),z=h(()=>{const e=p()-b(),a=Math.floor(e/n()),s=Math.floor(x()/n())+a;return Math.min(s,I())});h(()=>Math.max(0,z()-D()+1));const O=h(()=>t.data.slice(_(),N())),B=h(()=>O().map((e,a)=>{const s=_()+a,d=e.id,m=t.selectedItems?.has(d)||!1;return{item:e,actualIndex:s,itemId:d,isSelected:m}})),W=h(()=>I()*n()),j=e=>{const a=e.target;y(a.scrollTop)},J=e=>{if(!t.onSort)return;const s=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,s)},A=()=>{$(window.innerHeight)};ee(()=>{window.addEventListener("resize",A)}),te(()=>{window.removeEventListener("resize",A)});const U=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",Y=(e,a)=>{const s=e.getValue?e.getValue(a):a[e.key];return e.render?e.render(a,s):(()=>{var d=oe();return l(d,()=>String(s)),d})()};return(()=>{var e=ne(),a=e.firstChild,s=a.nextSibling,d=s.nextSibling,m=d.firstChild,E=d.nextSibling,Z=E.firstChild,F=Z.nextSibling,q=F.nextSibling,P=q.nextSibling;P.nextSibling,l(a,()=>`
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
          height: ${b()}px;
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
          height: ${n()}px;
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
          background: rgba(59, 130, 246, 0.4) !important;
          border-left: 6px solid #3b82f6 !important;
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.5) !important;
          transition: all 0.15s ease !important;
          border-right: 2px solid #3b82f6 !important;
        }

        .grid-row.selected:hover {
          background: rgba(59, 130, 246, 0.5) !important;
          border-left: 6px solid #60a5fa !important;
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.6) !important;
          border-right: 2px solid #60a5fa !important;
        }

        .light .grid-row.selected {
          background: rgba(59, 130, 246, 0.3) !important;
          border-left: 6px solid #3b82f6 !important;
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.4) !important;
          border-right: 2px solid #3b82f6 !important;
        }

        .light .grid-row.selected:hover {
          background: rgba(59, 130, 246, 0.4) !important;
          border-left: 6px solid #60a5fa !important;
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.5) !important;
          border-right: 2px solid #60a5fa !important;
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
      `),l(s,v(R,{get each(){return t.columns},children:r=>(()=>{var i=le(),f=i.firstChild;return i.$$click=()=>r.sortable&&J(r.key),l(f,()=>r.title),l(i,v(re,{get when(){return r.sortable},get children(){var c=ae();return l(c,()=>U(r.key)),c}}),null),G(c=>{var w=`header-cell ${r.sortable?"":"not-sortable"}`,o=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return w!==c.e&&C(i,c.e=w),c.t=L(i,o,c.t),c},{e:void 0,t:void 0}),i})()})),d.addEventListener("scroll",j);var T=S;return typeof T=="function"?ie(T,d):S=d,l(m,v(R,{get each(){return B()},children:r=>{const{item:i,actualIndex:f,itemId:c,isSelected:w}=r;return t.onRowMount&&t.onRowMount(i),w&&console.log("✓ VISIBLE SELECTED ROW:",c),(()=>{var o=se();return o.$$mousedown=g=>t.onRowMouseDown?.(i,f,g),o.$$click=g=>t.onRowClick?.(i,f,g),o.$$dblclick=()=>t.onRowDoubleClick?.(i),C(o,`grid-row ${w?"selected":""}`),o.style.setProperty("position","absolute"),o.style.setProperty("top","0px"),o.style.setProperty("left","0px"),o.style.setProperty("right","0px"),l(o,v(R,{get each(){return t.columns},children:g=>(()=>{var H=de();return l(H,()=>Y(g,i)),G(K=>L(H,g.width?{"flex-basis":`${g.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},K)),H})()})),G(g=>(g=`translateY(${f*n()}px)`)!=null?o.style.setProperty("transform",g):o.style.removeProperty("transform")),o})()}})),l(E,D,F),l(E,z,P),l(E,I,null),G(r=>{var i=`generic-infinite-grid ${t.className||""}`,f=`${W()}px`;return i!==r.e&&C(e,r.e=i),f!==r.t&&((r.t=f)!=null?m.style.setProperty("height",f):m.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class ge extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const n=this.getAttribute("data"),b=this.getAttribute("columns"),k=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),y=this.getAttribute("theme")||"dark";let p=[],$=[];try{p=n?JSON.parse(n):[],$=b?JSON.parse(b):[]}catch(S){console.error("Failed to parse data or columns attributes:",S)}this.dispose=X(()=>v(ce,{data:p,columns:$,rowHeight:k,headerHeight:x,theme:y,className:y}),this),console.log("✅ Generic Infinite Grid render successful")}catch(n){console.error("❌ Generic Infinite Grid render failed:",n)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ge),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}Q(["click","dblclick","mousedown"]);export{ce as G};
//# sourceMappingURL=generic-infinite-grid-97b4VMmL.js.map
