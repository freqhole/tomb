import{f as K,r as Q,g as w,c as H,k as h,o as X,b as ee,t as x,i as n,S as te,d as G,F as R,e as C,j as A,u as re}from"./web-DJKfNvYW.js";var ie=x("<span>"),oe=x("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),ne=x("<span class=sort-icon>"),ae=x("<div><span class=header-title>"),le=x("<div>"),se=x("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function de(e){console.log("📦 GenericInfiniteGrid component created");const i=()=>e.rowHeight||50,u=()=>e.headerHeight||60,v=5,[m,k]=H(0),[p,$]=H(window.innerHeight);H(0);let y;const V=h(()=>{const t=p()-u();return Math.ceil(t/i())}),I=h(()=>e.data.length),_=h(()=>{const t=Math.floor(m()/i());return Math.max(0,t-v)}),O=h(()=>{const t=_()+V()+v*2;return Math.min(I(),t)}),z=h(()=>Math.floor(m()/i())+1),D=h(()=>{const t=p()-u(),a=Math.floor(t/i()),d=Math.floor(m()/i())+a;return Math.min(d,I())});h(()=>Math.max(0,D()-z()+1));const j=h(()=>e.data.slice(_(),O())),B=h(()=>I()*i()),J=t=>{const a=t.target;k(a.scrollTop)},P=t=>{if(!e.onSort)return;const d=(e.sortField===t?e.sortDirection:"asc")==="asc"?"desc":"asc";e.onSort(t,d)},F=()=>{$(window.innerHeight)};X(()=>{window.addEventListener("resize",F)}),ee(()=>{window.removeEventListener("resize",F)});const U=t=>e.sortField!==t?"⇅":e.sortDirection==="asc"?"↑":"↓",W=(t,a)=>{const d=t.getValue?t.getValue(a):a[t.key];return t.render?t.render(a,d):(()=>{var f=ie();return n(f,()=>String(d)),f})()};return(()=>{var t=oe(),a=t.firstChild,d=a.nextSibling,f=d.nextSibling,E=f.firstChild,S=f.nextSibling,Y=S.firstChild,T=Y.nextSibling,Z=T.nextSibling,N=Z.nextSibling;N.nextSibling,n(a,()=>`
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
      `),n(d,w(R,{get each(){return e.columns},children:r=>(()=>{var l=ae(),c=l.firstChild;return l.$$click=()=>r.sortable&&P(r.key),n(c,()=>r.title),n(l,w(te,{get when(){return r.sortable},get children(){var o=ne();return n(o,()=>U(r.key)),o}}),null),G(o=>{var b=`header-cell ${r.sortable?"":"not-sortable"}`,s=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return b!==o.e&&C(l,o.e=b),o.t=A(l,s,o.t),o},{e:void 0,t:void 0}),l})()})),f.addEventListener("scroll",J);var L=y;return typeof L=="function"?re(L,f):y=f,n(E,w(R,{get each(){return j()},children:(r,l)=>{e.onRowMount&&e.onRowMount(r);const c=_()+l(),o=r.id,b=e.selectedItems?.has(o)||!1;return e.selectedItems&&e.selectedItems.size>0&&console.log("Generic grid row render with selection:",{itemId:o,isSelected:b,selectedItemsArray:Array.from(e.selectedItems),hasMatch:e.selectedItems.has(o),className:`grid-row ${b?"selected":""}`,itemIdType:typeof o,selectedItemTypes:Array.from(e.selectedItems).map(s=>typeof s)}),(()=>{var s=le();return s.$$mousedown=g=>e.onRowMouseDown?.(r,c,g),s.$$click=g=>e.onRowClick?.(r,c,g),s.$$dblclick=()=>e.onRowDoubleClick?.(r),C(s,`grid-row ${b?"selected":""}`),n(s,w(R,{get each(){return e.columns},children:g=>(()=>{var M=se();return n(M,()=>W(g,r)),G(q=>A(M,g.width?{"flex-basis":`${g.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},q)),M})()})),G(g=>A(s,{transform:`translateY(${c*i()}px)`,position:"absolute",top:"0px",left:"0px",right:"0px",...b?{background:"red !important",borderLeft:"10px solid yellow !important",borderRight:"10px solid yellow !important",outline:"5px solid magenta !important",boxShadow:"0 0 20px red !important"}:{}},g)),s})()}})),n(S,z,T),n(S,D,N),n(S,I,null),G(r=>{var l=`generic-infinite-grid ${e.className||""}`,c=`${B()}px`;return l!==r.e&&C(t,r.e=l),c!==r.t&&((r.t=c)!=null?E.style.setProperty("height",c):E.style.removeProperty("height")),r},{e:void 0,t:void 0}),t})()}class ce extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const i=this.getAttribute("data"),u=this.getAttribute("columns"),v=parseInt(this.getAttribute("row-height")||"50"),m=parseInt(this.getAttribute("header-height")||"60"),k=this.getAttribute("theme")||"dark";let p=[],$=[];try{p=i?JSON.parse(i):[],$=u?JSON.parse(u):[]}catch(y){console.error("Failed to parse data or columns attributes:",y)}this.dispose=Q(()=>w(de,{data:p,columns:$,rowHeight:v,headerHeight:m,theme:k,className:k}),this),console.log("✅ Generic Infinite Grid render successful")}catch(i){console.error("❌ Generic Infinite Grid render failed:",i)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ce),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(e){console.error("❌ Failed to register generic-infinite-grid custom element:",e)}K(["click","dblclick","mousedown"]);export{de as G};
//# sourceMappingURL=generic-infinite-grid-Rba8rfhw.js.map
