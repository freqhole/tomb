import{f as q,r as K,g as v,c as H,k as h,o as Q,b as X,t as b,i as l,S as ee,d as G,F as M,e as R,j as T,u as te}from"./web-DJKfNvYW.js";var re=b("<span>"),ie=b("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),ne=b("<span class=sort-icon>"),oe=b("<div><span class=header-title>"),le=b("<div>"),se=b("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function ae(t){console.log("📦 GenericInfiniteGrid component created");const n=()=>t.rowHeight||50,u=()=>t.headerHeight||60,p=5,[x,m]=H(0),[w,y]=H(window.innerHeight);H(0);let $;const N=h(()=>{const e=w()-u();return Math.ceil(e/n())}),k=h(()=>t.data.length),I=h(()=>{const e=Math.floor(x()/n());return Math.max(0,e-p)}),V=h(()=>{const e=I()+N()+p*2;return Math.min(k(),e)}),C=h(()=>Math.floor(x()/n())+1),z=h(()=>{const e=w()-u(),s=Math.floor(e/n()),d=Math.floor(x()/n())+s;return Math.min(d,k())});h(()=>Math.max(0,z()-C()+1));const L=h(()=>t.data.slice(I(),V())),O=h(()=>k()*n()),j=e=>{const s=e.target;m(s.scrollTop)},B=e=>{if(!t.onSort)return;const d=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,d)},A=()=>{y(window.innerHeight)};Q(()=>{window.addEventListener("resize",A)}),X(()=>{window.removeEventListener("resize",A)});const J=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",U=(e,s)=>{const d=e.getValue?e.getValue(s):s[e.key];return e.render?e.render(s,d):(()=>{var f=re();return l(f,()=>String(d)),f})()};return(()=>{var e=ie(),s=e.firstChild,d=s.nextSibling,f=d.nextSibling,_=f.firstChild,S=f.nextSibling,W=S.firstChild,D=W.nextSibling,Y=D.nextSibling,F=Y.nextSibling;F.nextSibling,l(s,()=>`
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
      `),l(d,v(M,{get each(){return t.columns},children:r=>(()=>{var a=oe(),g=a.firstChild;return a.$$click=()=>r.sortable&&B(r.key),l(g,()=>r.title),l(a,v(ee,{get when(){return r.sortable},get children(){var c=ne();return l(c,()=>J(r.key)),c}}),null),G(c=>{var i=`header-cell ${r.sortable?"":"not-sortable"}`,o=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return i!==c.e&&R(a,c.e=i),c.t=T(a,o,c.t),c},{e:void 0,t:void 0}),a})()})),f.addEventListener("scroll",j);var P=$;return typeof P=="function"?te(P,f):$=f,l(_,v(M,{get each(){return L()},children:(r,a)=>{t.onRowMount&&t.onRowMount(r);const g=I()+a(),c=t.selectedItems?.has(r.id)||!1;return(()=>{var i=le();return i.$$mousedown=o=>t.onRowMouseDown?.(r,g,o),i.$$click=o=>t.onRowClick?.(r,g,o),i.$$dblclick=()=>t.onRowDoubleClick?.(r),R(i,`grid-row ${c?"selected":""}`),i.style.setProperty("position","absolute"),i.style.setProperty("top","0px"),i.style.setProperty("left","0px"),i.style.setProperty("right","0px"),l(i,v(M,{get each(){return t.columns},children:o=>(()=>{var E=se();return l(E,()=>U(o,r)),G(Z=>T(E,o.width?{"flex-basis":`${o.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},Z)),E})()})),G(o=>(o=`translateY(${g*n()}px)`)!=null?i.style.setProperty("transform",o):i.style.removeProperty("transform")),i})()}})),l(S,C,D),l(S,z,F),l(S,k,null),G(r=>{var a=`generic-infinite-grid ${t.className||""}`,g=`${O()}px`;return a!==r.e&&R(e,r.e=a),g!==r.t&&((r.t=g)!=null?_.style.setProperty("height",g):_.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class ce extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const n=this.getAttribute("data"),u=this.getAttribute("columns"),p=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),m=this.getAttribute("theme")||"dark";let w=[],y=[];try{w=n?JSON.parse(n):[],y=u?JSON.parse(u):[]}catch($){console.error("Failed to parse data or columns attributes:",$)}this.dispose=K(()=>v(ae,{data:w,columns:y,rowHeight:p,headerHeight:x,theme:m,className:m}),this),console.log("✅ Generic Infinite Grid render successful")}catch(n){console.error("❌ Generic Infinite Grid render failed:",n)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ce),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}q(["click","dblclick","mousedown"]);export{ae as G};
//# sourceMappingURL=generic-infinite-grid-DuKWOY-O.js.map
