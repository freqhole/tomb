import{f as Q,r as X,g as m,c as M,k as g,o as ee,b as te,t as b,i as l,S as re,d as _,F as R,e as C,j as N,u as ie}from"./web-DJKfNvYW.js";var ne=b("<span>"),oe=b("<div><style></style><div class=grid-header></div><div class=grid-viewport><div class=grid-content></div></div><div class=grid-stats>Showing rows <!>-<!> of "),ae=b("<span class=sort-icon>"),le=b("<div><span class=header-title>"),se=b("<div>"),de=b("<div class=grid-cell>");console.log("🚀 Generic Infinite Grid script loading");function ce(t){console.log("📦 GenericInfiniteGrid component created");const o=()=>t.rowHeight||50,u=()=>t.headerHeight||60,v=5,[x,k]=M(0),[w,y]=M(window.innerHeight);M(0);let $;const V=g(()=>{const e=w()-u();return Math.ceil(e/o())}),S=g(()=>t.data.length),E=g(()=>{const e=Math.floor(x()/o());return Math.max(0,e-v)}),L=g(()=>{const e=E()+V()+v*2;return Math.min(S(),e)}),D=g(()=>Math.floor(x()/o())+1),z=g(()=>{const e=w()-u(),a=Math.floor(e/o()),s=Math.floor(x()/o())+a;return Math.min(s,S())});g(()=>Math.max(0,z()-D()+1));const O=g(()=>t.data.slice(E(),L())),j=g(()=>O().map((e,a)=>{const s=E()+a,d=e.id,p=t.selectedItems?.has(d)||!1;return{item:e,actualIndex:s,itemId:d,isSelected:p}})),B=g(()=>S()*o()),J=e=>{const a=e.target;k(a.scrollTop)},U=e=>{if(!t.onSort)return;const s=(t.sortField===e?t.sortDirection:"asc")==="asc"?"desc":"asc";t.onSort(e,s)},A=()=>{y(window.innerHeight)};ee(()=>{window.addEventListener("resize",A)}),te(()=>{window.removeEventListener("resize",A)});const W=e=>t.sortField!==e?"⇅":t.sortDirection==="asc"?"↑":"↓",Y=(e,a)=>{const s=e.getValue?e.getValue(a):a[e.key];return e.render?e.render(a,s):(()=>{var d=ne();return l(d,()=>String(s)),d})()};return(()=>{var e=oe(),a=e.firstChild,s=a.nextSibling,d=s.nextSibling,p=d.firstChild,I=d.nextSibling,Z=I.firstChild,F=Z.nextSibling,q=F.nextSibling,P=q.nextSibling;P.nextSibling,l(a,()=>`
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
      `),l(s,m(R,{get each(){return t.columns},children:r=>(()=>{var i=le(),h=i.firstChild;return i.$$click=()=>r.sortable&&U(r.key),l(h,()=>r.title),l(i,m(re,{get when(){return r.sortable},get children(){var f=ae();return l(f,()=>W(r.key)),f}}),null),_(f=>{var G=`header-cell ${r.sortable?"":"not-sortable"}`,n=r.width?{"flex-basis":`${r.width}px`,"flex-grow":"0","flex-shrink":"0"}:{};return G!==f.e&&C(i,f.e=G),f.t=N(i,n,f.t),f},{e:void 0,t:void 0}),i})()})),d.addEventListener("scroll",J);var T=$;return typeof T=="function"?ie(T,d):$=d,l(p,m(R,{get each(){return j()},children:r=>{const{item:i,actualIndex:h,itemId:f,isSelected:G}=r;return t.onRowMount&&t.onRowMount(i),(()=>{var n=se();return n.$$mousedown=c=>t.onRowMouseDown?.(i,h,c),n.$$click=c=>t.onRowClick?.(i,h,c),n.$$dblclick=()=>t.onRowDoubleClick?.(i),C(n,`grid-row ${G?"selected":""}`),n.style.setProperty("position","absolute"),n.style.setProperty("top","0px"),n.style.setProperty("left","0px"),n.style.setProperty("right","0px"),l(n,m(R,{get each(){return t.columns},children:c=>(()=>{var H=de();return l(H,()=>Y(c,i)),_(K=>N(H,c.width?{"flex-basis":`${c.width}px`,"flex-grow":"0","flex-shrink":"0"}:{},K)),H})()})),_(c=>(c=`translateY(${h*o()}px)`)!=null?n.style.setProperty("transform",c):n.style.removeProperty("transform")),n})()}})),l(I,D,F),l(I,z,P),l(I,S,null),_(r=>{var i=`generic-infinite-grid ${t.className||""}`,h=`${B()}px`;return i!==r.e&&C(e,r.e=i),h!==r.t&&((r.t=h)!=null?p.style.setProperty("height",h):p.style.removeProperty("height")),r},{e:void 0,t:void 0}),e})()}class ge extends HTMLElement{dispose;connectedCallback(){console.log("🔌 GenericInfiniteGridElement connected");try{const o=this.getAttribute("data"),u=this.getAttribute("columns"),v=parseInt(this.getAttribute("row-height")||"50"),x=parseInt(this.getAttribute("header-height")||"60"),k=this.getAttribute("theme")||"dark";let w=[],y=[];try{w=o?JSON.parse(o):[],y=u?JSON.parse(u):[]}catch($){console.error("Failed to parse data or columns attributes:",$)}this.dispose=X(()=>m(ce,{data:w,columns:y,rowHeight:v,headerHeight:x,theme:k,className:k}),this),console.log("✅ Generic Infinite Grid render successful")}catch(o){console.error("❌ Generic Infinite Grid render failed:",o)}}disconnectedCallback(){console.log("🔌 GenericInfiniteGridElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register generic-infinite-grid custom element");try{customElements.define("generic-infinite-grid",ge),console.log("✅ Generic Infinite Grid custom element registered successfully")}catch(t){console.error("❌ Failed to register generic-infinite-grid custom element:",t)}Q(["click","dblclick","mousedown"]);export{ce as G};
//# sourceMappingURL=generic-infinite-grid-Dki5kNp6.js.map
