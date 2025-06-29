import{f as Y,r as Z,g as v,c as E,k as d,o as q,b as K,t as u,i as l,S as Q,d as S,F as H,e as D,j as P,u as X}from"./web-DJKfNvYW.js";var ee=u("<span>"),te=u("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),re=u("<span class=sort-icon>"),ie=u("<div><span class=header-title>"),ne=u("<div class=grid-row>"),oe=u("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function le(t){console.log("📦 GenericInfiniteGrid component created");const o=()=>t.rowHeight||50,h=()=>t.headerHeight||60,w=5,[b,p]=E(0),[x,m]=E(window.innerHeight);E(0);let y;const T=d(()=>{const e=x()-h();return Math.ceil(e/o())}),k=d(()=>t.data.length),G=d(()=>{const e=Math.floor(b()/o());return Math.max(0,e-w)}),N=d(()=>{const e=G()+T()+w*2;return Math.min(k(),e)}),M=d(()=>Math.floor(b()/o())+1),R=d(()=>{const e=x()-h(),s=Math.floor(e/o()),c=Math.floor(b()/o())+s;return Math.min(c,k())});d(()=>Math.max(0,R()-M()+1));const V=d(()=>t.data.slice(G(),N())),L=d(()=>k()*o()),O=e=>{const s=e.target;p(s.scrollTop)},j=e=>{if(!t.onSort)return;const c=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,c)},C=()=>{m(window.innerHeight)};q(()=>{window.addEventListener("resize",C)}),K(()=>{window.removeEventListener("resize",C)});const B=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",J=(e,s)=>{const c=e.getValue?e.getValue(s):s[e.key];return e.render?e.render(s,c):(()=>{var g=ee();return l(g,()=>String(c)),g})()};return(()=>{var e=te(),s=e.firstChild,c=s.nextSibling,g=c.nextSibling,_=g.firstChild,$=g.nextSibling,U=$.firstChild,z=U.nextSibling,W=z.nextSibling,A=W.nextSibling;A.nextSibling,l(s,()=>`
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
      `),l(c,v(H,{get each(){return t.columns},children:r=>(()=>{var a=ie(),i=a.firstChild;return a.$$click=()=>r.sortable&&j(r.key),l(i,()=>r.title),l(a,v(Q,{get when(){return r.sortable},get children(){var n=re();return l(n,()=>B(r.key)),n}}),null),S(n=>{var f=`header-cell ${r.sortable?"":"not-sortable"}`,I=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return f!==n.e&&D(a,n.e=f),n.t=P(a,I,n.t),n},{e:void 0,t:void 0}),a})()})),g.addEventListener("scroll",O);var F=y;return typeof F=="function"?X(F,g):y=g,l(_,v(H,{get each(){return V()},children:(r,a)=>(t.onRowMount&&t.onRowMount(r),(()=>{var i=ne();return i.$$dblclick=()=>t.onRowDoubleClick?.(r),i.style.setProperty("position","absolute"),i.style.setProperty("top","0px"),i.style.setProperty("left","0px"),i.style.setProperty("right","0px"),l(i,v(H,{get each(){return t.columns},children:n=>(()=>{var f=oe();return l(f,()=>J(n,r)),S(I=>P(f,n.width?{"flex-basis":`${n.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},I)),f})()})),S(n=>(n=`translateY(${(G()+a())*o()}px)`)!=null?i.style.setProperty("transform",n):i.style.removeProperty("transform")),i})())})),l($,M,z),l($,R,A),l($,k,null),S(r=>{var a=`generic-infinite-grid ${t.className||""}`,i=`${L()}px`;return a!==r.e&&D(e,r.e=a),i!==r.t&&((r.t=i)!=null?_.style.setProperty("height",i):_.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class se extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const o=this.getAttribute("data"),h=this.getAttribute("columns"),w=parseInt(this.getAttribute("row-height")||"50"),b=parseInt(this.getAttribute("header-height")||"60"),p=this.getAttribute("theme")||"dark";let x=[],m=[];try{x=o?JSON.parse(o):[],m=h?JSON.parse(h):[]}catch(y){console.error("Failed to parse data or columns attributes:",y)}this.dispose=Z(()=>v(le,{data:x,columns:m,rowHeight:w,headerHeight:b,theme:p,className:p}),this),console.log("✅ Generic Infinite Grid render successful")}catch(o){console.error("❌ Generic Infinite Grid render failed:",o)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",se),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}Y(["click","dblclick"]);export{le as G};
//# sourceMappingURL=generic-infinite-grid-uOnZ3KW0.js.map
