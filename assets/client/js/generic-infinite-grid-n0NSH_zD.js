import{f as V,r as W,g as b,c as M,k as h,o as Y,b as Z,t as f,i as l,S as q,d as y,F as E,e as P,j as D,u as K}from"./web-DJKfNvYW.js";var Q=f("<span>"),X=f("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing <!> of <!> rows"),ee=f("<span class=sort-icon>"),te=f("<div><span class=header-title>"),re=f("<div class=grid-row>"),ie=f("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function ne(t){console.log("📦 GenericInfiniteGrid component created");const s=()=>t.rowHeight||50,u=()=>t.headerHeight||60,x=5,[k,p]=M(0),[v,w]=M(window.innerHeight);let m;const R=h(()=>{const e=v()-u();return Math.ceil(e/s())}),$=h(()=>t.data.length),S=h(()=>{const e=Math.floor(k()/s());return Math.max(0,e-x)}),T=h(()=>{const e=S()+R()+x*2;return Math.min($(),e)}),H=h(()=>t.data.slice(S(),T())),N=h(()=>$()*s()),L=e=>{const a=e.target;p(a.scrollTop)},O=e=>{if(!t.onSort)return;const c=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,c)},C=()=>{w(window.innerHeight)};Y(()=>{window.addEventListener("resize",C)}),Z(()=>{window.removeEventListener("resize",C)});const j=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",B=(e,a)=>{const c=e.getValue?e.getValue(a):a[e.key];return e.render?e.render(a,c):(()=>{var d=Q();return l(d,()=>String(c)),d})()};return(()=>{var e=X(),a=e.firstChild,c=a.nextSibling,d=c.nextSibling,G=d.firstChild,_=d.nextSibling,J=_.firstChild,z=J.nextSibling,U=z.nextSibling,A=U.nextSibling;A.nextSibling,l(a,()=>`
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
      `),l(c,b(E,{get each(){return t.columns},children:r=>(()=>{var o=te(),n=o.firstChild;return o.$$click=()=>r.sortable&&O(r.key),l(n,()=>r.title),l(o,b(q,{get when(){return r.sortable},get children(){var i=ee();return l(i,()=>j(r.key)),i}}),null),y(i=>{var g=`header-cell ${r.sortable?"":"not-sortable"}`,I=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return g!==i.e&&P(o,i.e=g),i.t=D(o,I,i.t),i},{e:void 0,t:void 0}),o})()})),d.addEventListener("scroll",L);var F=m;return typeof F=="function"?K(F,d):m=d,l(G,b(E,{get each(){return H()},children:(r,o)=>(()=>{var n=re();return n.style.setProperty("position","absolute"),n.style.setProperty("top","0px"),n.style.setProperty("left","0px"),n.style.setProperty("right","0px"),l(n,b(E,{get each(){return t.columns},children:i=>(()=>{var g=ie();return l(g,()=>B(i,r)),y(I=>D(g,i.width?{"flex-basis":`${i.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},I)),g})()})),y(i=>(i=`translateY(${(S()+o())*s()}px)`)!=null?n.style.setProperty("transform",i):n.style.removeProperty("transform")),n})()})),l(_,()=>H().length,z),l(_,$,A),y(r=>{var o=`generic-infinite-grid ${t.className||""}`,n=`${N()}px`;return o!==r.e&&P(e,r.e=o),n!==r.t&&((r.t=n)!=null?G.style.setProperty("height",n):G.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class oe extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const s=this.getAttribute("data"),u=this.getAttribute("columns"),x=parseInt(this.getAttribute("row-height")||"50"),k=parseInt(this.getAttribute("header-height")||"60"),p=this.getAttribute("theme")||"dark";let v=[],w=[];try{v=s?JSON.parse(s):[],w=u?JSON.parse(u):[]}catch(m){console.error("Failed to parse data or columns attributes:",m)}this.dispose=W(()=>b(ne,{data:v,columns:w,rowHeight:x,headerHeight:k,theme:p,className:p}),this),console.log("✅ Generic Infinite Grid render successful")}catch(s){console.error("❌ Generic Infinite Grid render failed:",s)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",oe),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}V(["click"]);export{ne as G};
//# sourceMappingURL=generic-infinite-grid-n0NSH_zD.js.map
