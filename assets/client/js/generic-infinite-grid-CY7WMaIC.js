import{f as Z,r as q,g as b,c as P,k as d,o as K,b as Q,t as f,i as a,S as X,d as $,F as E,e as D,j as R,u as ee}from"./web-DJKfNvYW.js";var te=f("<span>"),re=f("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing <!> of <!> rows"),ie=f("<span class=sort-icon>"),ne=f("<div><span class=header-title>"),oe=f("<div class=grid-row>"),se=f("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function le(t){console.log("📦 GenericInfiniteGrid component created");const o=()=>t.rowHeight||50,u=()=>t.headerHeight||60,x=5,[p,v]=P(0),[w,m]=P(window.innerHeight);let y;const H=d(()=>{const e=w()-u();return Math.ceil(e/o())}),k=d(()=>t.data.length),S=d(()=>{const e=Math.floor(p()/o());return Math.max(0,e-x)}),T=d(()=>{const e=S()+H()+x*2;return Math.min(k(),e)}),C=d(()=>Math.floor(p()/o())),N=d(()=>{const e=C(),s=Math.min(H(),k()-e);return e+s}),V=d(()=>Math.max(0,N()-C())),L=d(()=>t.data.slice(S(),T())),O=d(()=>k()*o()),j=e=>{const s=e.target;v(s.scrollTop)},B=e=>{if(!t.onSort)return;const g=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,g)},M=()=>{m(window.innerHeight)};K(()=>{window.addEventListener("resize",M)}),Q(()=>{window.removeEventListener("resize",M)});const J=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",U=(e,s)=>{const g=e.getValue?e.getValue(s):s[e.key];return e.render?e.render(s,g):(()=>{var c=te();return a(c,()=>String(g)),c})()};return(()=>{var e=re(),s=e.firstChild,g=s.nextSibling,c=g.nextSibling,G=c.firstChild,_=c.nextSibling,W=_.firstChild,z=W.nextSibling,Y=z.nextSibling,A=Y.nextSibling;A.nextSibling,a(s,()=>`
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
      `),a(g,b(E,{get each(){return t.columns},children:r=>(()=>{var l=ne(),n=l.firstChild;return l.$$click=()=>r.sortable&&B(r.key),a(n,()=>r.title),a(l,b(X,{get when(){return r.sortable},get children(){var i=ie();return a(i,()=>J(r.key)),i}}),null),$(i=>{var h=`header-cell ${r.sortable?"":"not-sortable"}`,I=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return h!==i.e&&D(l,i.e=h),i.t=R(l,I,i.t),i},{e:void 0,t:void 0}),l})()})),c.addEventListener("scroll",j);var F=y;return typeof F=="function"?ee(F,c):y=c,a(G,b(E,{get each(){return L()},children:(r,l)=>(()=>{var n=oe();return n.style.setProperty("position","absolute"),n.style.setProperty("top","0px"),n.style.setProperty("left","0px"),n.style.setProperty("right","0px"),a(n,b(E,{get each(){return t.columns},children:i=>(()=>{var h=se();return a(h,()=>U(i,r)),$(I=>R(h,i.width?{"flex-basis":`${i.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},I)),h})()})),$(i=>(i=`translateY(${(S()+l())*o()}px)`)!=null?n.style.setProperty("transform",i):n.style.removeProperty("transform")),n})()})),a(_,V,z),a(_,k,A),$(r=>{var l=`generic-infinite-grid ${t.className||""}`,n=`${O()}px`;return l!==r.e&&D(e,r.e=l),n!==r.t&&((r.t=n)!=null?G.style.setProperty("height",n):G.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class ae extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const o=this.getAttribute("data"),u=this.getAttribute("columns"),x=parseInt(this.getAttribute("row-height")||"50"),p=parseInt(this.getAttribute("header-height")||"60"),v=this.getAttribute("theme")||"dark";let w=[],m=[];try{w=o?JSON.parse(o):[],m=u?JSON.parse(u):[]}catch(y){console.error("Failed to parse data or columns attributes:",y)}this.dispose=q(()=>b(le,{data:w,columns:m,rowHeight:x,headerHeight:p,theme:v,className:v}),this),console.log("✅ Generic Infinite Grid render successful")}catch(o){console.error("❌ Generic Infinite Grid render failed:",o)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ae),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}Z(["click"]);export{le as G};
//# sourceMappingURL=generic-infinite-grid-CY7WMaIC.js.map
