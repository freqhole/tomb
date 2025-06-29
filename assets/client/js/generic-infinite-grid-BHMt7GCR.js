import{f as q,r as K,g as w,c as H,k as h,o as Q,b as X,t as u,i as n,S as ee,d as I,F as M,e as R,j as C,u as te}from"./web-DJKfNvYW.js";var re=u("<span>"),ie=u("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),oe=u("<span class=sort-icon>"),ne=u("<div><span class=header-title>"),ae=u("<div>"),le=u("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function se(e){console.log("📦 GenericInfiniteGrid component created");const i=()=>e.rowHeight||50,b=()=>e.headerHeight||60,m=5,[x,v]=H(0),[p,k]=H(window.innerHeight);H(0);let $;const L=h(()=>{const t=p()-b();return Math.ceil(t/i())}),S=h(()=>e.data.length),G=h(()=>{const t=Math.floor(x()/i());return Math.max(0,t-m)}),V=h(()=>{const t=G()+L()+m*2;return Math.min(S(),t)}),z=h(()=>Math.floor(x()/i())+1),A=h(()=>{const t=p()-b(),a=Math.floor(t/i()),c=Math.floor(x()/i())+a;return Math.min(c,S())});h(()=>Math.max(0,A()-z()+1));const O=h(()=>e.data.slice(G(),V())),j=h(()=>S()*i()),B=t=>{const a=t.target;v(a.scrollTop)},J=t=>{if(!e.onSort)return;const c=(e.sortField===t?e.sortDirection:"asc")==="asc"?"desc":"asc";e.onSort(t,c)},D=()=>{k(window.innerHeight)};Q(()=>{window.addEventListener("resize",D)}),X(()=>{window.removeEventListener("resize",D)});const P=t=>e.sortField!==t?"⇅":e.sortDirection==="asc"?"↑":"↓",U=(t,a)=>{const c=t.getValue?t.getValue(a):a[t.key];return t.render?t.render(a,c):(()=>{var f=re();return n(f,()=>String(c)),f})()};return(()=>{var t=ie(),a=t.firstChild,c=a.nextSibling,f=c.nextSibling,_=f.firstChild,y=f.nextSibling,W=y.firstChild,F=W.nextSibling,Y=F.nextSibling,N=Y.nextSibling;N.nextSibling,n(a,()=>`
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
          height: ${i()}px;
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
      `),n(c,w(M,{get each(){return e.columns},children:r=>(()=>{var l=ne(),g=l.firstChild;return l.$$click=()=>r.sortable&&J(r.key),n(g,()=>r.title),n(l,w(ee,{get when(){return r.sortable},get children(){var o=oe();return n(o,()=>P(r.key)),o}}),null),I(o=>{var d=`header-cell ${r.sortable?"":"not-sortable"}`,s=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return d!==o.e&&R(l,o.e=d),o.t=C(l,s,o.t),o},{e:void 0,t:void 0}),l})()})),f.addEventListener("scroll",B);var T=$;return typeof T=="function"?te(T,f):$=f,n(_,w(M,{get each(){return O()},children:(r,l)=>{e.onRowMount&&e.onRowMount(r);const g=G()+l(),o=e.selectedItems?.has(r.id)||!1;return console.log("Generic grid row render:",{itemId:r.id,isSelected:o,hasSelectedItems:!!e.selectedItems,selectedItemsSize:e.selectedItems?.size||0,className:`grid-row ${o?"selected":""}`}),(()=>{var d=ae();return d.$$mousedown=s=>e.onRowMouseDown?.(r,g,s),d.$$click=s=>e.onRowClick?.(r,g,s),d.$$dblclick=()=>e.onRowDoubleClick?.(r),R(d,`grid-row ${o?"selected":""}`),n(d,w(M,{get each(){return e.columns},children:s=>(()=>{var E=le();return n(E,()=>U(s,r)),I(Z=>C(E,s.width?{"flex-basis":`${s.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},Z)),E})()})),I(s=>C(d,{transform:`translateY(${g*i()}px)`,position:"absolute",top:"0px",left:"0px",right:"0px",...o?{background:"red !important",borderLeft:"10px solid yellow !important",borderRight:"10px solid yellow !important",outline:"5px solid magenta !important",boxShadow:"0 0 20px red !important"}:{}},s)),d})()}})),n(y,z,F),n(y,A,N),n(y,S,null),I(r=>{var l=`generic-infinite-grid ${e.className||""}`,g=`${j()}px`;return l!==r.e&&R(t,r.e=l),g!==r.t&&((r.t=g)!=null?_.style.setProperty("height",g):_.style.removeProperty("height")),r},{e:void 0,t:void 0}),t})()}class de extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const i=this.getAttribute("data"),b=this.getAttribute("columns"),m=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),v=this.getAttribute("theme")||"dark";let p=[],k=[];try{p=i?JSON.parse(i):[],k=b?JSON.parse(b):[]}catch($){console.error("Failed to parse data or columns attributes:",$)}this.dispose=K(()=>w(se,{data:p,columns:k,rowHeight:m,headerHeight:x,theme:v,className:v}),this),console.log("✅ Generic Infinite Grid render successful")}catch(i){console.error("❌ Generic Infinite Grid render failed:",i)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",de),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(e){console.error("❌ Failed to register generic-infinite-grid custom element:",e)}q(["click","dblclick","mousedown"]);export{se as G};
//# sourceMappingURL=generic-infinite-grid-BHMt7GCR.js.map
