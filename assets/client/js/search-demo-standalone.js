import{c as v,d as le,o as ie,t as $,l as fe,k as g,m as B,b as L,e as K,n as Y,h as I,g as H,f as ve,i as y,S as D,F as Z,j as xe,u as $e,r as we}from"./web-D0fRMFns.js";import{A as Ce}from"./api-client-Ciyqoh98.js";import"./types-CGPwAX3k.js";const me="search-state",ge=300,ke=50;function ne(){try{const e=localStorage.getItem(me);return e?JSON.parse(e):{}}catch{return{}}}function P(e){try{const l={...ne(),...e};localStorage.setItem(me,JSON.stringify(l))}catch{}}function oe(e){const i=ne(),[l,_]=v(e.initialQuery||i.query||""),[p,f]=v(e.initialDomain||i.domain||"music"),[m,x]=v(i.filters||{artist:"",album:"",genre:"",year:null,rating_min:null,rating_max:null,favorites_only:!1}),[w,b]=v(i.history||[]),[C,u]=v(i.isSearchPanelOpen||!1),[t,a]=v(i.searchPanelWidth||ge),[n,o]=v(i.isFiltersPanelOpen||!1),[c,h]=v(i.filtersPanelWidth||ge),[s,d]=v(i.currentPage||1),[S,q]=v(i.pageSize||20),[R,W]=v(i.sortBy||"relevance"),[O,M]=v(i.sortDirection||"desc"),[z,V]=v(i.lastSearchQuery||""),[ee,G]=v(i.lastSearchDomain||"music"),J=(r,k)=>{const j={...m(),[r]:k};x(j),P({filters:j})},X=()=>{const r={artist:"",album:"",genre:"",year:null,rating_min:null,rating_max:null,favorites_only:!1};x(r),P({filters:r})};return{query:l,setQuery:r=>{_(r),P({query:r})},domain:p,setDomain:r=>{f(r),P({domain:r})},filters:m,setFilters:r=>{x(r),P({filters:r})},updateFilter:J,clearFilters:X,searchHistory:w,addToHistory:r=>{if(!e.enableHistory)return;const k=r.trim();if(!k)return;const U=w(),j=e.maxHistoryItems||ke,ye=U.filter(pe=>pe!==k),de=[k,...ye].slice(0,j);b(de),P({history:de})},removeFromHistory:r=>{const U=w().filter(j=>j!==r);b(U),P({history:U})},clearHistory:()=>{b([]),P({history:[]})},isSearchPanelOpen:C,setIsSearchPanelOpen:r=>{u(r),P({isSearchPanelOpen:r})},toggleSearchPanel:()=>{const r=!C();u(r),P({isSearchPanelOpen:r})},searchPanelWidth:t,setSearchPanelWidth:r=>{a(r),P({searchPanelWidth:r})},isFiltersPanelOpen:n,setIsFiltersPanelOpen:r=>{o(r),P({isFiltersPanelOpen:r})},toggleFiltersPanel:()=>{const r=!n();o(r),P({isFiltersPanelOpen:r})},filtersPanelWidth:c,setFiltersPanelWidth:r=>{h(r),P({filtersPanelWidth:r})},currentPage:s,setCurrentPage:r=>{d(r),P({currentPage:r})},pageSize:S,setPageSize:r=>{q(r),P({pageSize:r})},nextPage:()=>{const r=s()+1;d(r),P({currentPage:r})},prevPage:()=>{const r=Math.max(1,s()-1);d(r),P({currentPage:r})},sortBy:R,setSortBy:r=>{W(r),P({sortBy:r})},sortDirection:O,setSortDirection:r=>{M(r),P({sortDirection:r})},handleSort:(r,k)=>{W(r),M(k),P({sortBy:r,sortDirection:k})},lastSearchQuery:z,setLastSearchQuery:r=>{V(r),P({lastSearchQuery:r})},lastSearchDomain:ee,setLastSearchDomain:r=>{G(r),P({lastSearchDomain:r})},loadState:ne,saveState:r=>{P(r)},resetState:()=>{_(""),f("music"),X(),d(1),W("relevance"),M("desc"),u(!1),o(!1),P({query:"",domain:"music",filters:{artist:"",album:"",genre:"",year:null,rating_min:null,rating_max:null,favorites_only:!1},currentPage:1,sortBy:"relevance",sortDirection:"desc",isSearchPanelOpen:!1,isFiltersPanelOpen:!1})},getMusicSearchOptions:()=>{const r=m(),k={q:l(),page:s(),page_size:S(),sort_by:R(),sort_direction:O()};return r.artist&&(k.artist=r.artist),r.album&&(k.album=r.album),r.genre&&(k.genre=r.genre),r.year&&(k.year=r.year),r.rating_min&&(k.rating_min=r.rating_min),r.rating_max&&(k.rating_max=r.rating_max),r.favorites_only&&(k.favorites_only=r.favorites_only),k},getSongsSearchOptions:()=>{const r=m(),k={q:l(),page:s(),page_size:S(),sort_by:R(),sort_direction:O()};return r.artist&&(k.artist=r.artist),r.album&&(k.album=r.album),r.genre&&(k.genre=r.genre),r.year&&(k.year=r.year),r.rating_min&&(k.rating_min=r.rating_min),r.rating_max&&(k.rating_max=r.rating_max),r.favorites_only&&(k.favorites_only=r.favorites_only),k}}}var Pe=$(`<div><div class=search-box__container><input type=text class=search-box__input autocomplete=off></div><style>
        .search-box {
          position: relative;
          width: 100%;
        }

        .search-box__container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .search-box__input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .search-box__input:focus {
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .search-box__input:disabled {
          background-color: #f5f5f5;
          cursor: not-allowed;
        }

        .search-box__button {
          padding: 8px 16px;
          border: 1px solid #007bff;
          background-color: #007bff;
          color: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .search-box__button:hover:not(:disabled) {
          background-color: #0056b3;
          border-color: #0056b3;
        }

        .search-box__button:disabled {
          background-color: #6c757d;
          border-color: #6c757d;
          cursor: not-allowed;
        }

        .search-box__button:active {
          transform: translateY(1px);
        }
      `),Fe=$("<button class=search-box__button type=button>");function De(e){const i=e.useInternalState!==!1,l=i?oe({}):null,[_,p]=v(),[f,m]=v(),x=()=>i&&l?l.query():e.query||"",w=t=>{if(i&&l?l.setQuery(t):e.onQueryChange?.(t),e.autoSearch&&t.trim()){const a=f();a&&clearTimeout(a);const n=setTimeout(()=>{e.onSearch?.(t.trim())},e.debounceMs||300);m(n)}},b=t=>{const a=t.currentTarget.value;w(a)},C=t=>{switch(t.key){case"Enter":t.preventDefault();const a=x().trim();a&&e.onSearch?.(a);break;case"Escape":_()?.blur();break}},u=()=>{const t=x().trim();t&&e.onSearch?.(t)};return ie(()=>()=>{const t=f();t&&clearTimeout(t)}),(()=>{var t=Pe(),a=t.firstChild,n=a.firstChild;return n.$$keydown=C,n.$$input=b,fe(p,n),g(a,(()=>{var o=B(()=>!!e.showSearchButton);return()=>o()&&(()=>{var c=Fe();return c.$$click=u,g(c,()=>e.searchButtonText||"Search"),L(()=>c.disabled=e.disabled||!x().trim()),c})()})(),null),L(o=>{var c=`search-box ${e.class||""}`,h=e.placeholder||"Search...",s=e.disabled;return c!==o.e&&K(t,o.e=c),h!==o.t&&Y(n,"placeholder",o.t=h),s!==o.a&&(n.disabled=o.a=s),o},{e:void 0,t:void 0,a:void 0}),L(()=>n.value=x()),t})()}le(["input","keydown","click"]);function Ee(e,i){let l;return(..._)=>{clearTimeout(l),l=setTimeout(()=>e(..._),i)}}function be(e){const[i,l]=v([]),[_,p]=v(!1),[f,m]=v(null),x=()=>e.minQueryLength??2,w=()=>e.maxSuggestions??10,b=()=>e.enabled??!0,C=I(()=>i().length>0),u=I(()=>i().length),t=I(()=>e.query().trim().length===0),a=async s=>{if(!b())return;const d=s.trim();if(d.length<x()){l([]);return}p(!0),m(null);try{const S={q:d,limit:w()},q=await e.apiClient.getMusicSuggestions(d,S);l(q.suggestions)}catch(S){const q=S instanceof Error?S:new Error(String(S));m(q),l([]),e.onError&&e.onError(q)}finally{p(!1)}},n=Ee(a,e.debounceMs||300);return H(()=>{const s=e.query();b()?n(s):l([])}),H(()=>{e.query(),f()&&m(null)}),{suggestions:i,loading:_,error:f,hasSuggestions:C,suggestionsCount:u,isEmpty:t,refresh:async()=>{const s=e.query();await a(s)},clearSuggestions:()=>{l([])},clearError:()=>{m(null)}}}var Re=$("<div class=search-suggestions__loading>Loading suggestions..."),Oe=$(`<div role=listbox aria-label="Search suggestions"><style>
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
        `),qe=$("<div role=option><span class=search-suggestions__text>");function Ie(e){const i=e.useInternalSuggestions!==!1,l=i&&e.apiClient?be({apiClient:e.apiClient,query:()=>e.query,debounceMs:e.debounceMs||300,enabled:e.show!==!1}):null,[_,p]=v(-1),[,f]=v(),m=()=>i&&l?l.suggestions():e.suggestions||[],x=()=>i&&l?l.loading():e.loading||!1,w=()=>{const t=e.query.toLowerCase().trim();return t?m().filter(n=>{const o=typeof n=="string"?n:n.text;return o.toLowerCase().includes(t)&&o.toLowerCase()!==t}).slice(0,e.maxSuggestions||10):[]},b=()=>e.show===!1||!e.query.trim()?!1:w().length>0||x()&&e.showLoading,C=t=>{e.onSuggestionSelect?.(t),p(-1)},u=t=>{const a=w();switch(t.key){case"ArrowDown":t.preventDefault(),a.length>0&&p(n=>n<a.length-1?n+1:0);break;case"ArrowUp":t.preventDefault(),a.length>0&&p(n=>n>0?n-1:a.length-1);break;case"Enter":if(t.preventDefault(),_()>=0&&_()<a.length){const n=a[_()];if(n){const o=typeof n=="string"?n:n.text;C(o)}}break;case"Escape":p(-1);break}};return H(()=>{const t=w();t.length===0?p(-1):_()>=t.length&&p(t.length-1)}),ie(()=>{document.addEventListener("keydown",u)}),ve(()=>{document.removeEventListener("keydown",u)}),y(D,{get when(){return b()},get children(){var t=Oe(),a=t.firstChild;return fe(f,t),g(t,y(D,{get when(){return x()&&e.showLoading},get children(){return Re()}}),a),g(t,y(D,{get when(){return B(()=>!x())()&&w().length>0},get children(){return y(Z,{get each(){return w()},children:(n,o)=>{const c=typeof n=="string"?n:n.text;return(()=>{var h=qe(),s=h.firstChild;return h.$$click=()=>C(c),Y(h,"data-suggestion",c),g(s,c),L(d=>{var S=`search-suggestions__item ${o()===_()?"search-suggestions__item--selected":""}`,q=o()===_();return S!==d.e&&K(h,d.e=S),q!==d.t&&Y(h,"aria-selected",d.t=q),d},{e:void 0,t:void 0}),h})()}})}}),a),L(()=>K(t,`search-suggestions ${e.class||""} search-suggestions--${e.position||"bottom"}`)),t}})}le(["click"]);var Le=$("<span class=search-filters__count>(<!>)"),We=$("<button class=search-filters__clear-button type=button>Clear All"),Ae=$("<button class=search-filters__toggle-button type=button>"),Te=$("<div class=search-filters__loading>Loading filters..."),Me=$('<div class=search-filters__group><label class=search-filters__label>Search Query<input type=text class=search-filters__input placeholder="Enter search terms...">'),ze=$("<div class=search-filters__group><label class=search-filters__label>Genre</label><select class=search-filters__select><option value>All Genres"),Qe=$("<div class=search-filters__group><label class=search-filters__label>Artist</label><select class=search-filters__select><option value>All Artists"),Be=$("<div class=search-filters__group><label class=search-filters__label>Type</label><div class=search-filters__checkboxes>"),He=$('<div class=search-filters__content><div class=search-filters__group><label class=search-filters__label>Year</label><div class=search-filters__range><input type=number class=search-filters__input placeholder=Year min=1900 max=2024></div></div><div class=search-filters__group><label class=search-filters__label>Rating</label><div class=search-filters__range><input type=number class="search-filters__input search-filters__input--small"placeholder=Min min=1 max=5><span class=search-filters__range-separator>to</span><input type=number class="search-filters__input search-filters__input--small"placeholder=Max min=1 max=5></div></div><div class=search-filters__group><label class=search-filters__checkbox-label><input type=checkbox class=search-filters__checkbox>Favorites Only</label></div><div class=search-filters__group><label class=search-filters__label>Sort By</label><select class=search-filters__select><option value=relevance>Relevance</option><option value=name>Name</option><option value=size>Size</option><option value=duration>Duration</option><option value=created>Date Created</option></select></div><div class=search-filters__group><label class=search-filters__label>Sort Order</label><select class=search-filters__select><option value=asc>Ascending</option><option value=desc>Descending'),Ne=$(`<div><div class=search-filters__header><h3 class=search-filters__title>Filters</h3><div class=search-filters__actions></div></div><style>
        .search-filters {
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          background: white;
        }

        .search-filters__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #e0e0e0;
          background-color: #f8f9fa;
        }

        .search-filters__title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #333;
        }

        .search-filters__count {
          color: #666;
          font-weight: normal;
          font-size: 14px;
        }

        .search-filters__actions {
          display: flex;
          gap: 8px;
        }

        .search-filters__clear-button,
        .search-filters__toggle-button {
          padding: 4px 8px;
          border: 1px solid #ccc;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .search-filters__clear-button:hover,
        .search-filters__toggle-button:hover {
          border-color: #007bff;
          background-color: #f8f9fa;
        }

        .search-filters__loading {
          padding: 16px;
          text-align: center;
          color: #666;
        }

        .search-filters__content {
          padding: 16px;
        }

        .search-filters__group {
          margin-bottom: 16px;
        }

        .search-filters__group:last-child {
          margin-bottom: 0;
        }

        .search-filters__label {
          display: block;
          margin-bottom: 4px;
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .search-filters__input,
        .search-filters__select {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-filters__input:focus,
        .search-filters__select:focus {
          border-color: #007bff;
        }

        .search-filters__input--small {
          width: auto;
          flex: 1;
        }

        .search-filters__range {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .search-filters__range-separator {
          color: #666;
          font-size: 14px;
        }

        .search-filters__checkboxes {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .search-filters__checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          cursor: pointer;
        }

        .search-filters__checkbox {
          margin: 0;
        }

        .search-filters__option-count {
          color: #666;
          font-size: 12px;
          margin-left: 4px;
        }
      `),_e=$("<option>"),je=$("<span class=search-filters__option-count>(<!>)"),Ue=$("<label class=search-filters__checkbox-label><input type=checkbox class=search-filters__checkbox>");function Ye(e){const i=e.useInternalState!==!1,l=i?oe({}):null,[_,p]=v(e.startExpanded!==!1),f=()=>{if(i&&l){const u=l.filters();return{query:l.query(),genre:u.genre,artist:u.artist,yearFrom:u.year,rating_min:u.rating_min,rating_max:u.rating_max,favorites_only:u.favorites_only,types:[],sortBy:l.sortBy(),sortOrder:l.sortDirection()}}return e.filters||{}},m=(u,t)=>{if(i&&l)switch(u){case"query":l.setQuery(t);break;case"genre":l.updateFilter("genre",t);break;case"artist":l.updateFilter("artist",t);break;case"yearFrom":l.updateFilter("year",t?parseInt(t):null);break;case"rating_min":l.updateFilter("rating_min",t?parseInt(t):null);break;case"rating_max":l.updateFilter("rating_max",t?parseInt(t):null);break;case"favorites_only":l.updateFilter("favorites_only",t);break;case"sortBy":l.setSortBy(t);break;case"sortOrder":l.setSortDirection(t);break;default:const a={...f()};t===""||t===null||t===void 0?delete a[u]:a[u]=t,e.onFiltersChange?.(a);break}else{const a={...f()};t===""||t===null||t===void 0?delete a[u]:a[u]=t,e.onFiltersChange?.(a)}},x=(u,t,a)=>{const n=f()[u]||[];let o;a?o=[...n,t]:o=n.filter(c=>c!==t),m(u,o.length>0?o:void 0)},w=()=>{i&&l?(l.setQuery(""),l.clearFilters(),l.setSortBy("relevance"),l.setSortDirection("desc")):e.onFiltersChange?.({})},b=()=>{const u=f();return Object.keys(u).some(t=>{const a=u[t];return a!=null&&a!==""&&(Array.isArray(a)?a.length>0:!0)})},C=()=>{const u=f();return Object.keys(u).filter(t=>{const a=u[t];return a!=null&&a!==""&&(Array.isArray(a)?a.length>0:!0)}).length};return(()=>{var u=Ne(),t=u.firstChild,a=t.firstChild;a.firstChild;var n=a.nextSibling,o=t.nextSibling;return g(a,y(D,{get when(){return C()>0},get children(){var c=Le(),h=c.firstChild,s=h.nextSibling;return s.nextSibling,g(c,C,s),c}}),null),g(n,y(D,{get when(){return b()},get children(){var c=We();return c.$$click=w,c}}),null),g(n,y(D,{get when(){return e.showToggle!==!1},get children(){var c=Ae();return c.$$click=()=>p(!_()),g(c,()=>_()?"Collapse":"Expand"),L(()=>Y(c,"aria-expanded",_())),c}}),null),g(u,y(D,{get when(){return e.loading},get children(){return Te()}}),o),g(u,y(D,{get when(){return B(()=>!e.loading)()&&(_()||b())},get children(){var c=He(),h=c.firstChild,s=h.firstChild,d=s.nextSibling,S=d.firstChild,q=h.nextSibling,R=q.firstChild,W=R.nextSibling,O=W.firstChild,M=O.nextSibling,z=M.nextSibling,V=q.nextSibling,ee=V.firstChild,G=ee.firstChild,J=V.nextSibling,X=J.firstChild,te=X.nextSibling,ce=J.nextSibling,ue=ce.firstChild,re=ue.nextSibling;return g(c,y(D,{get when(){return e.showQueryInput!==!1},get children(){var F=Me(),Q=F.firstChild,T=Q.firstChild,E=T.nextSibling;return E.$$input=A=>m("query",A.currentTarget.value),L(()=>E.value=f().query||""),F}}),h),g(c,y(D,{get when(){return e.filterOptions?.genres},get children(){var F=ze(),Q=F.firstChild,T=Q.nextSibling;return T.firstChild,T.addEventListener("change",E=>m("genre",E.currentTarget.value)),g(T,y(Z,{get each(){return e.filterOptions?.genres},children:E=>(()=>{var A=_e();return g(A,()=>E.label,null),g(A,y(D,{get when(){return e.showCounts&&E.count!==void 0},get children(){return["(",B(()=>E.count),")"]}}),null),L(()=>A.value=E.value),A})()}),null),L(()=>T.value=f().genre||""),F}}),h),g(c,y(D,{get when(){return e.filterOptions?.artists},get children(){var F=Qe(),Q=F.firstChild,T=Q.nextSibling;return T.firstChild,T.addEventListener("change",E=>m("artist",E.currentTarget.value)),g(T,y(Z,{get each(){return e.filterOptions?.artists},children:E=>(()=>{var A=_e();return g(A,()=>E.label,null),g(A,y(D,{get when(){return e.showCounts&&E.count!==void 0},get children(){return["(",B(()=>E.count),")"]}}),null),L(()=>A.value=E.value),A})()}),null),L(()=>T.value=f().artist||""),F}}),h),S.$$input=F=>m("yearFrom",F.currentTarget.value),g(c,y(D,{get when(){return e.filterOptions?.types},get children(){var F=Be(),Q=F.firstChild,T=Q.nextSibling;return g(T,y(Z,{get each(){return e.filterOptions?.types},children:E=>(()=>{var A=Ue(),se=A.firstChild;return se.addEventListener("change",N=>x("types",E.value,N.currentTarget.checked)),g(A,()=>E.label,null),g(A,y(D,{get when(){return e.showCounts&&E.count!==void 0},get children(){var N=je(),he=N.firstChild,ae=he.nextSibling;return ae.nextSibling,g(N,()=>E.count,ae),N}}),null),L(()=>se.checked=(f().types||[]).includes(E.value)),A})()})),F}}),q),O.$$input=F=>m("rating_min",F.currentTarget.value),z.$$input=F=>m("rating_max",F.currentTarget.value),G.addEventListener("change",F=>m("favorites_only",F.currentTarget.checked)),te.addEventListener("change",F=>m("sortBy",F.currentTarget.value)),re.addEventListener("change",F=>m("sortOrder",F.currentTarget.value)),L(()=>S.value=f().yearFrom||""),L(()=>O.value=f().rating_min||""),L(()=>z.value=f().rating_max||""),L(()=>G.checked=f().favorites_only||!1),L(()=>te.value=f().sortBy||"relevance"),L(()=>re.value=f().sortOrder||"desc"),c}}),o),L(()=>K(u,`search-filters ${e.class||""}`)),u})()}le(["click","input"]);function Ve(e,i){let l;return(..._)=>{clearTimeout(l),l=setTimeout(()=>e(..._),i)}}function Ge(e){const[i,l]=v(e.initialQuery||""),[_,p]=v(e.initialDomain||"music"),[f,m]=v(null),[x,w]=v(null),[b,C]=v(!1),[u,t]=v(null),a=I(()=>{const R=f(),W=x();return(R?.results?.length||0)>0||(W?.songs?.length||0)>0}),n=I(()=>{const R=f(),W=x();return(R?.results?.length||0)+(W?.songs?.length||0)}),o=I(()=>i().trim().length===0),c=I(()=>i().trim().length>0&&!b());H(()=>{i(),u()&&t(null)});const h=async R=>{const W=i().trim();if(!W){m(null);return}C(!0),t(null);try{const O=await e.apiClient.searchMusic(W,R);m(O),w(null)}catch(O){const M=O instanceof Error?O:new Error(String(O));t(M),m(null),e.onError&&e.onError(M)}finally{C(!1)}},s=async R=>{const W=i().trim();if(!W){w(null);return}C(!0),t(null);try{const O=await e.apiClient.searchSongs(W,R);w(O),m(null)}catch(O){const M=O instanceof Error?O:new Error(String(O));t(M),w(null),e.onError&&e.onError(M)}finally{C(!1)}},d=Ve(h,e.debounceMs||300);return H(()=>{e.autoSearch!==!1&&(i().trim().length>0?d():(m(null),w(null)))}),{query:i,setQuery:l,domain:_,setDomain:p,results:f,songsResults:x,loading:b,error:u,clearError:()=>{t(null)},search:h,searchSongs:s,clearResults:()=>{m(null),w(null)},hasResults:a,resultsCount:n,isEmpty:o,canSearch:c}}function Je(e){const i=I(()=>{const a=e.searchResults(),n=e.songsResults(),o=[];return a?.results&&o.push(...a.results),n?.songs&&o.push(...n.songs),o}),l=I(()=>{const a=i(),n=e.searchState.filters();return a.filter(o=>{const c="artist"in o;return!(n.artist&&c&&o.artist&&!o.artist.toLowerCase().includes(n.artist.toLowerCase())||n.album&&c&&o.album&&!o.album.toLowerCase().includes(n.album.toLowerCase())||n.genre&&c&&o.genre&&!o.genre.toLowerCase().includes(n.genre.toLowerCase())||n.year&&c&&o.year&&o.year!==n.year||n.rating_min&&c&&o.rating&&o.rating<n.rating_min||n.rating_max&&c&&o.rating&&o.rating>n.rating_max||n.favorites_only&&c&&!o.is_favorite)})}),_=I(()=>{const a=l(),n=e.searchState.sortBy(),o=e.searchState.sortDirection();return[...a].sort((h,s)=>{let d,S;switch(n){case"title":d=h.title?.toLowerCase()||"",S=s.title?.toLowerCase()||"";break;case"artist":d=("artist"in h?h.artist?.toLowerCase():"")||"",S=("artist"in s?s.artist?.toLowerCase():"")||"";break;case"album":d=("album"in h?h.album?.toLowerCase():"")||"",S=("album"in s?s.album?.toLowerCase():"")||"";break;case"created_at":d=h.created_at?new Date(h.created_at).getTime():0,S=s.created_at?new Date(s.created_at).getTime():0;break;case"rating":d=("rating"in h?h.rating:0)||0,S=("rating"in s?s.rating:0)||0;break;case"relevance":default:return 0}return d<S?o==="asc"?-1:1:d>S?o==="asc"?1:-1:0})}),p=I(()=>_()),f=I(()=>{const a=p(),n={},o={},c={},h={};return a.forEach(s=>{const d="artist"in s;d&&s.artist&&(n[s.artist]||(n[s.artist]=[]),n[s.artist].push(s)),d&&s.album&&(o[s.album]||(o[s.album]=[]),o[s.album].push(s)),d&&s.genre&&(c[s.genre]||(c[s.genre]=[]),c[s.genre].push(s)),d&&s.year&&(h[s.year]||(h[s.year]=[]),h[s.year].push(s))}),{byArtist:n,byAlbum:o,byGenre:c,byYear:h}}),m=I(()=>{const a=e.searchResults(),n=e.songsResults(),o=e.searchState.currentPage(),c=e.searchState.pageSize(),h=a?.total_count||n?.total_count||0,s=Math.ceil(h/c);return{totalResults:h,totalPages:s,currentPage:o,hasNextPage:o<s,hasPrevPage:o>1,resultsPerPage:c}}),x=I(()=>{if(e.integrationMode!=="freqhole-integrated"||!e.webSocketItems)return p();const a=p(),n=e.webSocketItems(),o=new Set(a.map(h=>h.id)),c=n.filter(h=>!o.has(h.id));return[...a,...c]}),w=I(()=>x()),b=I(()=>p().length===0),C=I(()=>p().length>0);return{processedResults:p,integratedResults:x,searchStats:m,groupedResults:f,filteredResults:l,sortedResults:_,mergedWithWebSocket:w,isEmpty:b,hasResults:C,getResultById:a=>p().find(n=>n.id===a),getResultsByType:a=>p().filter(n=>"result_type"in n?n.result_type===a:!1)}}function Xe(e){const i=oe({initialQuery:e.initialQuery,initialDomain:e.initialDomain,enableHistory:e.enableHistory}),l=Ge({apiClient:e.apiClient,initialQuery:e.initialQuery,initialDomain:e.initialDomain,debounceMs:e.debounceMs,autoSearch:e.autoSearch,onError:e.onError}),_=be({apiClient:e.apiClient,query:l.query,debounceMs:e.debounceMs,enabled:e.enableSuggestions,onError:e.onError}),p=Je({searchResults:l.results,songsResults:l.songsResults,searchState:i,integrationMode:e.integrationMode,webSocketItems:e.webSocketItems}),f=async()=>{const t=i.query(),a=i.getMusicSearchOptions();t.trim()&&(i.addToHistory(t),i.setLastSearchQuery(t),i.setLastSearchDomain(i.domain())),l.setQuery(t),await l.search(a)},m=async()=>{const t=i.query(),a=i.getSongsSearchOptions();t.trim()&&(i.addToHistory(t),i.setLastSearchQuery(t),i.setLastSearchDomain(i.domain())),l.setQuery(t),await l.searchSongs(a)},x=()=>{l.clearResults(),_.clearSuggestions(),i.setQuery(""),i.setCurrentPage(1)},w=I(()=>l.loading()||_.loading()||i.query().trim().length>0),b=I(()=>l.hasResults()||p.hasResults()),C=I(()=>p.searchStats().totalResults),u=I(()=>l.canSearch()&&!l.loading());return{state:i,search:l,suggestions:_,data:p,performSearch:f,performSongsSearch:m,clearAll:x,isActive:w,hasAnyResults:b,totalResultsCount:C,canPerformSearch:u}}const Se=xe();function Ze(e){const l={...Xe({apiClient:e.apiClient,initialQuery:e.searchOptions?.initialQuery||"",initialDomain:e.searchOptions?.initialDomain||"music",enableHistory:e.searchOptions?.enableHistory??!0,enableSuggestions:e.searchOptions?.enableSuggestions??!0,debounceMs:e.searchOptions?.debounceMs||300,autoSearch:e.searchOptions?.autoSearch??!1,integrationMode:e.searchOptions?.integrationMode||"standalone",webSocketItems:e.searchOptions?.webSocketItems,onError:e.searchOptions?.onError}),apiClient:e.apiClient};return y(Se.Provider,{value:l,get children(){return e.children}})}function Ke(){const e=$e(Se);if(!e)throw new Error("useSearchContext must be used within a SearchProvider");return e}var et=$("<div class=search-demo__stats-item><span class=search-demo__stats-label>Results:</span><span class=search-demo__stats-value>"),tt=$("<div class=search-demo__stats-item><span class=search-demo__stats-loading>🔄 Searching..."),rt=$("<div class=search-demo__results-header><h3>Search Results</h3><p>Found <!> results"),st=$("<div class=search-demo__results-grid>"),at=$("<p class=search-demo__error>Error: "),nt=$("<div class=search-demo__no-results><h3>No results found</h3><p>Try adjusting your search terms or filters"),lt=$("<div class=search-demo__welcome><h3>Welcome to Search Demo</h3><p>Enter a search query to get started</p><ul class=search-demo__features><li>🔍 Real-time search suggestions</li><li>🎛️ Advanced filtering options</li><li>📱 Responsive design</li><li>⚡ Fast and efficient"),it=$(`<div class=search-demo><div class=search-demo__header><h1 class=search-demo__title>🔍 Search Demo</h1><p class=search-demo__description>Modular search components with autocomplete, filtering, and real-time results</p></div><div class=search-demo__content><div class=search-demo__search-section><div class=search-demo__search-container></div><div class=search-demo__stats></div></div><div class=search-demo__main><div class=search-demo__filters></div><div class=search-demo__results></div></div></div><style>
        .search-demo {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        }

        .search-demo__header {
          text-align: center;
          padding: 2rem;
          background: rgba(0, 0, 0, 0.1);
        }

        .search-demo__title {
          font-size: 2.5rem;
          margin: 0 0 1rem 0;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .search-demo__description {
          font-size: 1.1rem;
          margin: 0;
          opacity: 0.9;
        }

        .search-demo__content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .search-demo__search-section {
          margin-bottom: 2rem;
        }

        .search-demo__search-container {
          position: relative;
          max-width: 600px;
          margin: 0 auto 1rem auto;
        }

        .search-demo__stats {
          display: flex;
          justify-content: center;
          gap: 2rem;
          margin-top: 1rem;
        }

        .search-demo__stats-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }

        .search-demo__stats-label {
          font-weight: 600;
        }

        .search-demo__stats-value {
          background: rgba(255, 255, 255, 0.2);
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-weight: bold;
        }

        .search-demo__stats-loading {
          font-weight: 600;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .search-demo__main {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 2rem;
          align-items: start;
        }

        .search-demo__filters {
          background: rgba(255, 255, 255, 0.1);
          color: black;
          border-radius: 12px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .search-demo__results {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          min-height: 400px;
        }

        .search-demo__results-header {
          margin-bottom: 1.5rem;
        }

        .search-demo__results-header h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
        }

        .search-demo__results-header p {
          margin: 0;
          opacity: 0.8;
        }

        .search-demo__results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1rem;
        }

        .search-demo__result-card {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .search-demo__result-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }

        .search-demo__result-title {
          margin: 0 0 0.5rem 0;
          font-size: 1.1rem;
          color: #fff;
        }

        .search-demo__result-description {
          margin: 0 0 1rem 0;
          opacity: 0.8;
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .search-demo__result-meta {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .search-demo__result-type,
        .search-demo__result-score {
          background: rgba(255, 255, 255, 0.2);
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.8rem;
        }

        .search-demo__result-artist {
          margin-top: 0.5rem;
          font-size: 0.85rem;
          opacity: 0.8;
          font-style: italic;
        }

        .search-demo__no-results,
        .search-demo__welcome {
          text-align: center;
          padding: 3rem 2rem;
        }

        .search-demo__welcome h3,
        .search-demo__no-results h3 {
          margin: 0 0 1rem 0;
          font-size: 1.5rem;
        }

        .search-demo__welcome p,
        .search-demo__no-results p {
          margin: 0 0 1.5rem 0;
          opacity: 0.8;
        }

        .search-demo__features {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .search-demo__features li {
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 6px;
        }

        .search-demo__error {
          color: #ff6b6b;
          background: rgba(255, 107, 107, 0.1);
          padding: 0.5rem;
          border-radius: 4px;
          margin-top: 0.5rem;
          font-size: 0.9rem;
        }



        @media (max-width: 768px) {
          .search-demo__main {
            grid-template-columns: 1fr;
          }

          .search-demo__content {
            padding: 1rem;
          }

          .search-demo__results-grid {
            grid-template-columns: 1fr;
          }
        }
      `),ot=$("<span class=search-demo__result-score>Score: "),ct=$("<div class=search-demo__result-artist>Artist: "),ut=$("<div class=search-demo__result-card><h4 class=search-demo__result-title></h4><p class=search-demo__result-description></p><div class=search-demo__result-meta><span class=search-demo__result-type>");console.log("🔍 Search Demo loading...");const ht=e=>new Ce(e),dt={genres:[{value:"rock",label:"Rock"},{value:"pop",label:"Pop"},{value:"jazz",label:"Jazz"},{value:"classical",label:"Classical"},{value:"electronic",label:"Electronic"},{value:"folk",label:"Folk"},{value:"hip-hop",label:"Hip-Hop"},{value:"country",label:"Country"}],artists:[{value:"",label:"All Artists"}],types:[{value:"song",label:"Song"},{value:"album",label:"Album"}]};function gt(){const e=Ke(),[i,l]=v(""),[_,p]=v([]),[f,m]=v(!1);ie(()=>{try{localStorage.removeItem("search-state"),console.log("🧹 Cleared search localStorage for demo")}catch(b){console.log("Could not clear localStorage:",b)}});const x=async b=>{const C=b||e.state.query();if(C.trim()){m(!0),console.log("🔍 Performing search:",C),console.log("🔍 API Client:",e.apiClient),console.log("🔍 Search context:",e.search);try{b&&e.state.setQuery(b),console.log("🔍 About to call performSearch..."),await e.performSearch(),console.log("🔍 performSearch completed");const u=e.search.results();console.log("🔍 Raw results:",u),console.log("🔍 Search error:",e.search.error()),p(u?.results||[]),console.log("✅ Search completed:",u),console.log("🔍 Results array length:",u?.results?.length),console.log("🔍 Total count from server:",u?.total_count),(!u||!u.results||u.results.length===0)&&console.log("No results found for query:",C)}catch(u){console.error("❌ Search failed:",u),console.error("❌ Search error details:",u),p([])}finally{m(!1)}}},w=b=>{e.state.setQuery(b),x(b)};return H(()=>{const b=e.state.query();l(b)}),H(()=>{const b=e.state.query();l(b)}),(()=>{var b=it(),C=b.firstChild,u=C.nextSibling,t=u.firstChild,a=t.firstChild,n=a.nextSibling,o=t.nextSibling,c=o.firstChild,h=c.nextSibling;return g(a,y(De,{onSearch:x,placeholder:"Search music, artists, albums...",showSearchButton:!0,searchButtonText:"Search",autoSearch:!1,useInternalState:!0}),null),g(a,y(Ie,{get query(){return e.state.query()},onSuggestionSelect:w,maxSuggestions:8,showLoading:!0,position:"bottom",useInternalSuggestions:!0,get apiClient(){return e.apiClient}}),null),g(n,y(D,{get when(){return e.hasAnyResults()},get children(){var s=et(),d=s.firstChild,S=d.nextSibling;return g(S,()=>e.totalResultsCount()),s}}),null),g(n,y(D,{get when(){return e.search.loading()||f()},get children(){return tt()}}),null),g(c,y(Ye,{filterOptions:dt,showCounts:!1,startExpanded:!0,showToggle:!0,showQueryInput:!1,useInternalState:!1,filters:{},onFiltersChange:s=>{console.log("Filters changed:",s),s.genre&&e.state.updateFilter("genre",s.genre),s.artist&&e.state.updateFilter("artist",s.artist),s.yearFrom&&e.state.updateFilter("year",parseInt(s.yearFrom)),s.rating_min&&e.state.updateFilter("rating_min",parseInt(s.rating_min)),s.rating_max&&e.state.updateFilter("rating_max",parseInt(s.rating_max)),s.favorites_only!==void 0&&e.state.updateFilter("favorites_only",s.favorites_only),e.state.query().trim()&&x()}})),g(h,y(D,{get when(){return B(()=>!e.search.loading())()&&!f()},get children(){return[y(D,{get when(){return _().length>0},get children(){return[(()=>{var s=rt(),d=s.firstChild,S=d.nextSibling,q=S.firstChild,R=q.nextSibling;return R.nextSibling,g(S,()=>_().length,R),s})(),(()=>{var s=st();return g(s,()=>_().map((d,S)=>(()=>{var q=ut(),R=q.firstChild,W=R.nextSibling,O=W.nextSibling,M=O.firstChild;return g(R,()=>d.title||`Result ${S+1}`),g(W,()=>d.subtitle||d.description||"No description"),g(M,()=>d.result_type||"Unknown"),g(O,y(D,{get when(){return d.relevance_score},get children(){var z=ot();return z.firstChild,g(z,()=>d.relevance_score?.toFixed(2),null),z}}),null),g(q,y(D,{get when(){return d.metadata?.artist},get children(){var z=ct();return z.firstChild,g(z,()=>d.metadata.artist,null),z}}),null),L(()=>Y(q,"key",d.id||S)),q})())),s})()]}}),y(D,{get when(){return B(()=>!!(_().length===0&&i()))()&&!f()},get children(){var s=nt(),d=s.firstChild;return d.nextSibling,g(s,y(D,{get when(){return e.search.error()},get children(){var S=at();return S.firstChild,g(S,()=>e.search.error()?.message,null),S}}),null),s}}),y(D,{get when(){return!i()},get children(){return lt()}})]}})),b})()}function _t(e){const i=ht(e.apiBaseUrl||"http://localhost:8080");return y(Ze,{apiClient:i,searchOptions:{enableSuggestions:!0,enableHistory:!1,autoSearch:!1,integrationMode:"standalone"},get children(){return y(gt,{})}})}class ft extends HTMLElement{dispose;connectedCallback(){console.log("🔍 SearchDemo element connected");const i=this.getAttribute("api-base-url")||"http://localhost:8080",l=this.getAttribute("auto-connect")==="true";try{this.dispose=we(()=>y(_t,{apiBaseUrl:i,autoConnect:l}),this),console.log("✅ SearchDemo render successful")}catch(_){console.error("❌ SearchDemo render failed:",_)}}disconnectedCallback(){console.log("🔍 SearchDemo element disconnected"),this.dispose&&this.dispose()}}try{customElements.define("search-demo",ft),console.log("✅ search-demo element registered successfully")}catch(e){console.error("❌ Failed to register search-demo element:",e)}
//# sourceMappingURL=search-demo.js.map
