import{f as G,c as v,a as A,o as J,b as Q,g as h,t as x,u as T,i as f,S as C,F as z,s as B,d as M,m as W,e as N}from"./web.js";import{u as X}from"./useSearchSuggestions.js";import"./api-client.js";var Y=x("<div class=search-suggestions__loading>Loading suggestions..."),Z=x(`<div role=listbox aria-label="Search suggestions"><style>
          .search-suggestions {
            position: absolute;
            left: 0;
            right: 0;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
          }

          .search-suggestions--bottom {
            top: 100%;
            margin-top: 4px;
          }

          .search-suggestions--top {
            bottom: 100%;
            margin-bottom: 4px;
          }

          .search-suggestions__loading {
            padding: 12px 16px;
            text-align: center;
            color: #666;
            font-size: 14px;
          }

          .search-suggestions__item {
            padding: 8px 12px;
            cursor: pointer;
            transition: background-color 0.2s;
            border-bottom: 1px solid #f0f0f0;
          }

          .search-suggestions__item:last-child {
            border-bottom: none;
          }

          .search-suggestions__item:hover,
          .search-suggestions__item--selected {
            background-color: #f8f9fa;
          }

          .search-suggestions__item--selected {
            background-color: #007bff;
            color: white;
          }

          .search-suggestions__text {
            font-size: 14px;
            line-height: 1.2;
          }

          .search-suggestions__group {
            border-bottom: 1px solid #e9ecef;
          }

          .search-suggestions__group:last-child {
            border-bottom: none;
          }

          .search-suggestions__group-header {
            padding: 8px 12px 4px 12px;
            font-size: 12px;
            font-weight: 600;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background-color: #f8f9fa;
            border-bottom: 1px solid #f0f0f0;
          }

          .search-suggestions__group .search-suggestions__item {
            padding-left: 20px;
          }

          /* Scrollbar styling */
          .search-suggestions::-webkit-scrollbar {
            width: 4px;
          }

          .search-suggestions::-webkit-scrollbar-track {
            background: #f1f1f1;
          }

          .search-suggestions::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 2px;
          }

          .search-suggestions::-webkit-scrollbar-thumb:hover {
            background: #a8a8a8;
          }
        `),ee=x("<div class=search-suggestions__group><div class=search-suggestions__group-header>"),te=x("<div role=option><span class=search-suggestions__text>");function oe(s){const _=s.useInternalSuggestions!==!1,b=_&&s.apiClient?X({apiClient:s.apiClient,query:()=>s.query,debounceMs:s.debounceMs||300,enabled:s.show!==!1}):null,[a,i]=v(-1),[R,F]=v(),[U,c]=v(!0),V=()=>_&&b?b.suggestions():s.suggestions||[],w=()=>_&&b?b.loading():s.loading||!1,p=()=>{const e=s.query.toLowerCase().trim();return e?V().filter(t=>{const r=typeof t=="string"?t:t.text;return r.toLowerCase().includes(e)&&r.toLowerCase()!==e}).slice(0,s.maxSuggestions||10):[]},$=()=>{const e=p(),n=new Map;e.forEach(r=>{const g=typeof r=="string"?"general":r.category||"general";n.has(g)||n.set(g,[]),n.get(g).push(r)});const t=["word","title","playlist","general"];return Array.from(n.entries()).sort(([r],[g])=>{const m=t.indexOf(r),o=t.indexOf(g),S=m===-1?t.length:m,u=o===-1?t.length:o;return S-u})},H=e=>({word:"Search suggestions",title:"Songs",playlist:"Playlists",general:"Suggestions"})[e]||e.charAt(0).toUpperCase()+e.slice(1),K=()=>s.show===!1||!s.query.trim()||!U()?!1:p().length>0||w()&&s.showLoading,y=()=>$().reduce((e,[n,t])=>e.concat(t),[]),L=e=>{s.onSuggestionSelect?.(e),i(-1),c(!1),s.onBlur?.()},E=e=>{const n=y();switch(e.key){case"ArrowDown":e.preventDefault(),n.length>0&&i(t=>t<n.length-1?t+1:0);break;case"ArrowUp":e.preventDefault(),n.length>0&&i(t=>t>0?t-1:n.length-1);break;case"Enter":if(e.preventDefault(),a()>=0&&a()<n.length){const t=n[a()];if(t){const r=typeof t=="string"?t:t.text;L(r)}}else c(!1),s.onBlur?.();break;case"Escape":i(-1),c(!1),s.onBlur?.();break}};A(()=>{const e=y();e.length===0?i(-1):a()>=e.length&&i(e.length-1)}),A(()=>{const e=s.query.trim();c(!!e)});const I=e=>{const n=R();n&&!n.contains(e.target)&&(c(!1),s.onBlur?.())};return J(()=>{document.addEventListener("keydown",E),document.addEventListener("mousedown",I)}),Q(()=>{document.removeEventListener("keydown",E),document.removeEventListener("mousedown",I)}),h(C,{get when(){return K()},get children(){var e=Z(),n=e.firstChild;return T(F,e),f(e,h(C,{get when(){return w()&&s.showLoading},get children(){return Y()}}),n),f(e,h(C,{get when(){return W(()=>!w())()&&p().length>0},get children(){return h(z,{get each(){return $()},children:([t,r])=>{const m=y().findIndex(o=>r.includes(o));return(()=>{var o=ee(),S=o.firstChild;return f(S,()=>H(t)),f(o,h(z,{each:r,children:(u,P)=>{const D=m+P(),k=typeof u=="string"?u:u.text;return(()=>{var l=te(),j=l.firstChild;return l.$$click=()=>L(k),B(l,"data-suggestion",k),f(j,k),M(d=>{var q=`search-suggestions__item ${D===a()?"search-suggestions__item--selected":""}`,O=D===a();return q!==d.e&&N(l,d.e=q),O!==d.t&&B(l,"aria-selected",d.t=O),d},{e:void 0,t:void 0}),l})()}}),null),o})()}})}}),n),M(()=>N(e,`search-suggestions ${s.class||""} search-suggestions--${s.position||"bottom"}`)),e}})}G(["click"]);export{oe as S};
//# sourceMappingURL=SearchSuggestions.js.map
