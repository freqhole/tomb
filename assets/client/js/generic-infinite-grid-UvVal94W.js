import{f as Y,r as Z,g as p,c as E,k as c,o as q,b as K,t as u,i as l,S as Q,d as S,F as H,e as P,j as D,u as X}from"./web-DJKfNvYW.js";var ee=u("<span>"),te=u("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),re=u("<span class=sort-icon>"),ie=u("<div><span class=header-title>"),ne=u("<div class=grid-row>"),oe=u("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function le(t){console.log("📦 GenericInfiniteGrid component created");const o=()=>t.rowHeight||50,h=()=>t.headerHeight||60,v=5,[b,w]=E(0),[x,m]=E(window.innerHeight);E(0);let y;const T=c(()=>{const e=x()-h();return Math.ceil(e/o())}),k=c(()=>t.data.length),G=c(()=>{const e=Math.floor(b()/o());return Math.max(0,e-v)}),N=c(()=>{const e=G()+T()+v*2;return Math.min(k(),e)}),M=c(()=>Math.floor(b()/o())+1),C=c(()=>{const e=x()-h(),s=Math.floor(e/o()),d=Math.floor(b()/o())+s;return Math.min(d,k())});c(()=>Math.max(0,C()-M()+1));const V=c(()=>t.data.slice(G(),N())),L=c(()=>k()*o()),O=e=>{const s=e.target;w(s.scrollTop)},j=e=>{if(!t.onSort)return;const d=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,d)},R=()=>{m(window.innerHeight)};q(()=>{window.addEventListener("resize",R)}),K(()=>{window.removeEventListener("resize",R)});const B=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",J=(e,s)=>{const d=e.getValue?e.getValue(s):s[e.key];return e.render?e.render(s,d):(()=>{var g=ee();return l(g,()=>String(d)),g})()};return(()=>{var e=te(),s=e.firstChild,d=s.nextSibling,g=d.nextSibling,_=g.firstChild,$=g.nextSibling,U=$.firstChild,z=U.nextSibling,W=z.nextSibling,A=W.nextSibling;A.nextSibling,l(s,()=>`
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
          height: ${h()}px;
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
      `),l(d,p(H,{get each(){return t.columns},children:r=>(()=>{var a=ie(),n=a.firstChild;return a.$$click=()=>r.sortable&&j(r.key),l(n,()=>r.title),l(a,p(Q,{get when(){return r.sortable},get children(){var i=re();return l(i,()=>B(r.key)),i}}),null),S(i=>{var f=`header-cell ${r.sortable?"":"not-sortable"}`,I=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return f!==i.e&&P(a,i.e=f),i.t=D(a,I,i.t),i},{e:void 0,t:void 0}),a})()})),g.addEventListener("scroll",O);var F=y;return typeof F=="function"?X(F,g):y=g,l(_,p(H,{get each(){return V()},children:(r,a)=>(()=>{var n=ne();return n.style.setProperty("position","absolute"),n.style.setProperty("top","0px"),n.style.setProperty("left","0px"),n.style.setProperty("right","0px"),l(n,p(H,{get each(){return t.columns},children:i=>(()=>{var f=oe();return l(f,()=>J(i,r)),S(I=>D(f,i.width?{"flex-basis":`${i.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},I)),f})()})),S(i=>(i=`translateY(${(G()+a())*o()}px)`)!=null?n.style.setProperty("transform",i):n.style.removeProperty("transform")),n})()})),l($,M,z),l($,C,A),l($,k,null),S(r=>{var a=`generic-infinite-grid ${t.className||""}`,n=`${L()}px`;return a!==r.e&&P(e,r.e=a),n!==r.t&&((r.t=n)!=null?_.style.setProperty("height",n):_.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class se extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const o=this.getAttribute("data"),h=this.getAttribute("columns"),v=parseInt(this.getAttribute("row-height")||"50"),b=parseInt(this.getAttribute("header-height")||"60"),w=this.getAttribute("theme")||"dark";let x=[],m=[];try{x=o?JSON.parse(o):[],m=h?JSON.parse(h):[]}catch(y){console.error("Failed to parse data or columns attributes:",y)}this.dispose=Z(()=>p(le,{data:x,columns:m,rowHeight:v,headerHeight:b,theme:w,className:w}),this),console.log("✅ Generic Infinite Grid render successful")}catch(o){console.error("❌ Generic Infinite Grid render failed:",o)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",se),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}Y(["click"]);export{le as G};
//# sourceMappingURL=generic-infinite-grid-UvVal94W.js.map
