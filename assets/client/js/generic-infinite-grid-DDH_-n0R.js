import{f as K,r as Q,g as m,c as M,k as h,o as X,b as ee,t as u,i as n,S as te,d as E,F as R,e as C,j as L,u as re}from"./web-DJKfNvYW.js";var ie=u("<span>"),oe=u("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),ne=u("<span class=sort-icon>"),ae=u("<div><span class=header-title>"),le=u("<div>"),se=u("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function de(t){console.log("📦 GenericInfiniteGrid component created");const o=()=>t.rowHeight||50,b=()=>t.headerHeight||60,v=5,[x,k]=M(0),[p,y]=M(window.innerHeight);M(0);let $;const V=h(()=>{const e=p()-b();return Math.ceil(e/o())}),S=h(()=>t.data.length),G=h(()=>{const e=Math.floor(x()/o());return Math.max(0,e-v)}),N=h(()=>{const e=G()+V()+v*2;return Math.min(S(),e)}),D=h(()=>Math.floor(x()/o())+1),z=h(()=>{const e=p()-b(),a=Math.floor(e/o()),c=Math.floor(x()/o())+a;return Math.min(c,S())});h(()=>Math.max(0,z()-D()+1));const O=h(()=>t.data.slice(G(),N())),B=h(()=>S()*o()),j=e=>{const a=e.target;k(a.scrollTop)},J=e=>{if(!t.onSort)return;const c=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,c)},A=()=>{y(window.innerHeight)};X(()=>{window.addEventListener("resize",A)}),ee(()=>{window.removeEventListener("resize",A)});const U=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",W=(e,a)=>{const c=e.getValue?e.getValue(a):a[e.key];return e.render?e.render(a,c):(()=>{var f=ie();return n(f,()=>String(c)),f})()};return(()=>{var e=oe(),a=e.firstChild,c=a.nextSibling,f=c.nextSibling,_=f.firstChild,I=f.nextSibling,Y=I.firstChild,F=Y.nextSibling,Z=F.nextSibling,P=Z.nextSibling;P.nextSibling,n(a,()=>`
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
          height: ${o()}px;
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
      `),n(c,m(R,{get each(){return t.columns},children:r=>(()=>{var l=ae(),g=l.firstChild;return l.$$click=()=>r.sortable&&J(r.key),n(g,()=>r.title),n(l,m(te,{get when(){return r.sortable},get children(){var s=ne();return n(s,()=>U(r.key)),s}}),null),E(s=>{var w=`header-cell ${r.sortable?"":"not-sortable"}`,i=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return w!==s.e&&C(l,s.e=w),s.t=L(l,i,s.t),s},{e:void 0,t:void 0}),l})()})),f.addEventListener("scroll",j);var T=$;return typeof T=="function"?re(T,f):$=f,n(_,m(R,{get each(){return O()},children:(r,l)=>{t.onRowMount&&t.onRowMount(r);const g=G()+l(),s=r.id,w=t.selectedItems?.has(s)||!1;return w&&console.log("✓ VISIBLE SELECTED ROW:",s),(()=>{var i=le();return i.$$mousedown=d=>t.onRowMouseDown?.(r,g,d),i.$$click=d=>t.onRowClick?.(r,g,d),i.$$dblclick=()=>t.onRowDoubleClick?.(r),C(i,`grid-row ${w?"selected":""}`),i.style.setProperty("position","absolute"),i.style.setProperty("top","0px"),i.style.setProperty("left","0px"),i.style.setProperty("right","0px"),n(i,m(R,{get each(){return t.columns},children:d=>(()=>{var H=se();return n(H,()=>W(d,r)),E(q=>L(H,d.width?{"flex-basis":`${d.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},q)),H})()})),E(d=>(d=`translateY(${g*o()}px)`)!=null?i.style.setProperty("transform",d):i.style.removeProperty("transform")),i})()}})),n(I,D,F),n(I,z,P),n(I,S,null),E(r=>{var l=`generic-infinite-grid ${t.className||""}`,g=`${B()}px`;return l!==r.e&&C(e,r.e=l),g!==r.t&&((r.t=g)!=null?_.style.setProperty("height",g):_.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class ce extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const o=this.getAttribute("data"),b=this.getAttribute("columns"),v=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),k=this.getAttribute("theme")||"dark";let p=[],y=[];try{p=o?JSON.parse(o):[],y=b?JSON.parse(b):[]}catch($){console.error("Failed to parse data or columns attributes:",$)}this.dispose=Q(()=>m(de,{data:p,columns:y,rowHeight:v,headerHeight:x,theme:k,className:k}),this),console.log("✅ Generic Infinite Grid render successful")}catch(o){console.error("❌ Generic Infinite Grid render failed:",o)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ce),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}K(["click","dblclick","mousedown"]);export{de as G};
//# sourceMappingURL=generic-infinite-grid-DDH_-n0R.js.map
