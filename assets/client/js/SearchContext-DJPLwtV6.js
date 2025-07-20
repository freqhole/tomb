import{c as g,k as v,a as X,f as ne,o as ae,t as Y,u as oe,i as $,m as J,d as W,g as G,F as ie,S as ce,e as Z,s as le,v as ue,p as ge}from"./web-CJacnRtE.js";import{u as he}from"./useSearchSuggestions-BgAe6Tec.js";import{b as de}from"./api-client-C-EpDo6z.js";function fe(e,o){let c;return(...x)=>{clearTimeout(c),c=setTimeout(()=>e(...x),o)}}function me(e){const[o,c]=g(e.initialQuery||""),[x,_]=g(e.initialDomain||"music"),[w,R]=g(null),[D,S]=g(null),[E,y]=g(!1),[M,f]=g(null),h=v(()=>{const k=w(),T=D();return(k?.results?.length||0)>0||(T?.songs?.length||0)>0}),a=v(()=>{const k=w(),T=D();return(k?.results?.length||0)+(T?.songs?.length||0)}),n=v(()=>o().trim().length===0),d=v(()=>o().trim().length>0&&!E());X(()=>{o(),M()&&f(null)});const l=async k=>{const T=o().trim();if(!T){R(null);return}y(!0),f(null);try{const C=await e.apiClient.searchMusic(T,k);R(C),S(null)}catch(C){const L=C instanceof Error?C:new Error(String(C));f(L),R(null),e.onError&&e.onError(L)}finally{y(!1)}},r=async k=>{const T=o().trim();if(!T){S(null);return}y(!0),f(null);try{const C=await e.apiClient.searchSongs(T,k);S(C),R(null)}catch(C){const L=C instanceof Error?C:new Error(String(C));f(L),S(null),e.onError&&e.onError(L)}finally{y(!1)}},m=fe(l,e.debounceMs||300);return X(()=>{e.autoSearch!==!1&&(o().trim().length>0?m():(R(null),S(null)))}),{query:o,setQuery:c,domain:x,setDomain:_,results:w,songsResults:D,loading:E,error:M,clearError:()=>{f(null)},search:l,searchSongs:r,clearResults:()=>{R(null),S(null)},hasResults:h,resultsCount:a,isEmpty:n,canSearch:d}}const ee=300,be=50,j={artist:"",album:"",genre:"",year:null,rating_min:null,rating_max:null,favorites_only:!1};function te(e={}){const[o,c]=g(e.initialQuery||""),[x,_]=g(e.initialDomain||"music"),[w,R]=g({...j}),D=e.maxHistoryItems||be,[S,E]=g([]),[y,M]=g(!1),[f,h]=g(ee),[a,n]=g(!1),[d,l]=g(ee),[r,m]=g(""),[P,Q]=g("music"),[k,T]=g(1),[C,L]=g(20),[q,z]=g(""),[O,s]=g("");return{query:o,setQuery:c,domain:x,setDomain:_,filters:w,setFilters:R,updateFilter:(t,i)=>{const V=w();let I=i;(i===""||i===null||i===void 0)&&(t==="favorites_only"?I=!1:t==="year"||t==="rating_min"||t==="rating_max"?I=null:I="");const U={...V,[t]:I};R(U)},clearFilters:()=>{R({...j})},searchHistory:S,addToHistory:t=>{if(!e.enableHistory)return;const i=t.trim();if(!i)return;const I=S().filter(se=>se!==i),U=[i,...I].slice(0,D);E(U)},removeFromHistory:t=>{if(!e.enableHistory)return;const V=S().filter(I=>I!==t);E(V)},clearHistory:()=>{E([])},isSearchPanelOpen:y,setIsSearchPanelOpen:M,toggleSearchPanel:()=>{M(!y())},searchPanelWidth:f,setSearchPanelWidth:h,isFiltersPanelOpen:a,setIsFiltersPanelOpen:n,toggleFiltersPanel:()=>{n(!a())},filtersPanelWidth:d,setFiltersPanelWidth:l,lastSearchQuery:r,setLastSearchQuery:m,lastSearchDomain:P,setLastSearchDomain:Q,currentPage:k,setCurrentPage:T,pageSize:C,setPageSize:L,sortBy:q,setSortBy:z,sortDirection:O,setSortDirection:s,toggleSortDirection:()=>{const t=O();s(t===""?"desc":t==="desc"?"asc":"desc")},getMusicSearchOptions:()=>{const t=w(),i={q:o(),page:k(),page_size:C(),sort_by:q()||"relevance",sort_direction:O()||"desc"};return t.artist&&t.artist.trim()&&(i.artist=t.artist),t.album&&t.album.trim()&&(i.album=t.album),t.genre&&t.genre.trim()&&(i.genre=t.genre),t.year!==null&&t.year!==void 0&&(i.year=t.year),t.rating_min!==null&&t.rating_min!==void 0&&(i.rating_min=t.rating_min),t.rating_max!==null&&t.rating_max!==void 0&&(i.rating_max=t.rating_max),t.favorites_only===!0&&(i.favorites_only=!0),i},getSongsSearchOptions:()=>{const t=w(),i={q:o(),page:k(),page_size:C(),sort_by:q()||"relevance",sort_direction:O()||"desc"};return t.artist&&t.artist.trim()&&(i.artist=t.artist),t.album&&t.album.trim()&&(i.album=t.album),t.genre&&t.genre.trim()&&(i.genre=t.genre),t.year!==null&&t.year!==void 0&&(i.year=t.year),t.rating_min!==null&&t.rating_min!==void 0&&(i.rating_min=t.rating_min),t.rating_max!==null&&t.rating_max!==void 0&&(i.rating_max=t.rating_max),t.favorites_only===!0&&(i.favorites_only=!0),i},reset:()=>{c(""),_("music"),R({...j}),T(1),z(""),s(""),m(""),Q("music")},hasActiveFilters:()=>{const t=w();return t.artist&&t.artist.trim()!==""||t.album&&t.album.trim()!==""||t.genre&&t.genre.trim()!==""||t.year!==null&&t.year!==void 0||t.rating_min!==null&&t.rating_min!==void 0||t.rating_max!==null&&t.rating_max!==void 0||t.favorites_only===!0},getFilterCount:()=>{const t=w();let i=0;return t.artist&&t.artist.trim()!==""&&i++,t.album&&t.album.trim()!==""&&i++,t.genre&&t.genre.trim()!==""&&i++,t.year!==null&&t.year!==void 0&&i++,t.rating_min!==null&&t.rating_min!==void 0&&i++,t.rating_max!==null&&t.rating_max!==void 0&&i++,t.favorites_only===!0&&i++,i}}}function ye(e){const o=v(()=>{const h=e.searchResults(),a=e.songsResults(),n=[];return h?.results&&n.push(...h.results),a?.songs&&n.push(...a.songs),n}),c=v(()=>{const h=o(),a=e.searchState.filters();return h.filter(n=>{const d="artist"in n;return!(a.artist&&d&&n.artist&&!n.artist.toLowerCase().includes(a.artist.toLowerCase())||a.album&&d&&n.album&&!n.album.toLowerCase().includes(a.album.toLowerCase())||a.genre&&d&&n.genre&&!n.genre.toLowerCase().includes(a.genre.toLowerCase())||a.year&&d&&n.year&&n.year!==a.year||a.rating_min&&d&&n.rating&&n.rating<a.rating_min||a.rating_max&&d&&n.rating&&n.rating>a.rating_max||a.favorites_only&&d&&!n.is_favorite)})}),x=v(()=>{const h=c(),a=e.searchState.sortBy(),n=e.searchState.sortDirection();return[...h].sort((l,r)=>{let m,P;switch(a){case"title":m=l.title?.toLowerCase()||"",P=r.title?.toLowerCase()||"";break;case"artist":m=("artist"in l?l.artist?.toLowerCase():"")||"",P=("artist"in r?r.artist?.toLowerCase():"")||"";break;case"album":m=("album"in l?l.album?.toLowerCase():"")||"",P=("album"in r?r.album?.toLowerCase():"")||"";break;case"created_at":m=l.created_at?new Date(l.created_at).getTime():0,P=r.created_at?new Date(r.created_at).getTime():0;break;case"rating":m=("rating"in l?l.rating:0)||0,P=("rating"in r?r.rating:0)||0;break;case"relevance":default:return 0}return m<P?n==="asc"?-1:1:m>P?n==="asc"?1:-1:0})}),_=v(()=>x()),w=v(()=>{const h=_(),a={},n={},d={},l={};return h.forEach(r=>{const m="artist"in r;m&&r.artist&&(a[r.artist]||(a[r.artist]=[]),a[r.artist].push(r)),m&&r.album&&(n[r.album]||(n[r.album]=[]),n[r.album].push(r)),m&&r.genre&&(d[r.genre]||(d[r.genre]=[]),d[r.genre].push(r)),m&&r.year&&(l[r.year]||(l[r.year]=[]),l[r.year].push(r))}),{byArtist:a,byAlbum:n,byGenre:d,byYear:l}}),R=v(()=>{const h=e.searchResults(),a=e.songsResults(),n=e.searchState.currentPage(),d=e.searchState.pageSize(),l=h?.total_count||a?.total_count||0,r=Math.ceil(l/d);return{totalResults:l,totalPages:r,currentPage:n,hasNextPage:n<r,hasPrevPage:n>1,resultsPerPage:d}}),D=v(()=>{if(e.integrationMode!=="freqhole-integrated"||!e.webSocketItems)return _();const h=_(),a=e.webSocketItems(),n=new Set(h.map(l=>l.id)),d=a.filter(l=>!n.has(l.id));return[...h,...d]}),S=v(()=>D()),E=v(()=>_().length===0),y=v(()=>_().length>0);return{processedResults:_,integratedResults:D,searchStats:R,groupedResults:w,filteredResults:c,sortedResults:x,mergedWithWebSocket:S,isEmpty:E,hasResults:y,getResultById:h=>_().find(a=>a.id===h),getResultsByType:h=>_().filter(a=>"result_type"in a?a.result_type===h:!1)}}function Se(e){const o=te({initialQuery:e.initialQuery,initialDomain:e.initialDomain,enableHistory:e.enableHistory}),c=me({apiClient:e.apiClient,initialQuery:e.initialQuery,initialDomain:e.initialDomain,debounceMs:e.debounceMs,autoSearch:e.autoSearch,onError:e.onError}),x=he({apiClient:e.apiClient,query:c.query,debounceMs:e.debounceMs,enabled:e.enableSuggestions,onError:e.onError}),_=ye({searchResults:c.results,songsResults:c.songsResults,searchState:o,integrationMode:e.integrationMode,webSocketItems:e.webSocketItems}),w=async()=>{const f=o.query(),h=o.getMusicSearchOptions();f.trim()&&(o.addToHistory(f),o.setLastSearchQuery(f),o.setLastSearchDomain(o.domain())),c.setQuery(f),await c.search(h)},R=async()=>{const f=o.query(),h=o.getSongsSearchOptions();f.trim()&&(o.addToHistory(f),o.setLastSearchQuery(f),o.setLastSearchDomain(o.domain())),c.setQuery(f),await c.searchSongs(h)},D=()=>{c.clearResults(),x.clearSuggestions(),o.setQuery(""),o.setCurrentPage(1)},S=v(()=>c.loading()||x.loading()||o.query().trim().length>0),E=v(()=>c.hasResults()||_.hasResults()),y=v(()=>_.searchStats().totalResults),M=v(()=>c.canSearch()&&!c.loading());return{state:o,search:c,suggestions:x,data:_,performSearch:w,performSongsSearch:R,clearAll:D,isActive:S,hasAnyResults:E,totalResultsCount:y,canPerformSearch:M}}var _e=Y("<div class=search-suggestions>"),xe=Y(`<div><div class=search-box__container><input type=text class=search-box__input autocomplete=off></div><style>
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
          border: 1px solid transparent;
          border-radius: 8px;
          font-size: 14px;
          outline: none;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: all 0.3s ease;
        }

        .search-box__input::placeholder {
          color: rgba(255, 255, 255, 0.6);
        }

        .search-box__input:focus {
          border-color: #d946ef;
          box-shadow: 0 0 0 2px rgba(217, 70, 239, 0.25);
          background: rgba(255, 255, 255, 0.15);
        }

        .search-box__input:disabled {
          background-color: rgba(255, 255, 255, 0.05);
          cursor: not-allowed;
          color: rgba(255, 255, 255, 0.4);
        }

        .search-box__button {
          padding: 8px 16px;
          border: 1px solid #d946ef;
          background-color: #d946ef;
          color: white;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.3s ease;
        }

        .search-box__button:hover:not(:disabled) {
          background-color: #c026d3;
          border-color: #c026d3;
          transform: translateY(-1px);
        }

        .search-box__button:disabled {
          background-color: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.1);
          cursor: not-allowed;
          color: rgba(255, 255, 255, 0.4);
        }

        .search-box__button:active {
          transform: translateY(0px);
        }

        /* Suggestions Dropdown */
        .search-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.95);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          margin-top: 4px;
          max-height: 240px;
          overflow-y: auto;
          z-index: 1000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .search-suggestion {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .search-suggestion:last-child {
          border-bottom: none;
        }

        .search-suggestion:hover,
        .search-suggestion--selected {
          background: rgba(217, 70, 239, 0.2);
          border-color: rgba(217, 70, 239, 0.3);
        }

        .search-suggestion__text {
          color: white;
          font-size: 14px;
          font-weight: 400;
        }

        .search-suggestion__category {
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 8px;
          border-radius: 12px;
        }

        /* Scrollbar styling for suggestions */
        .search-suggestions::-webkit-scrollbar {
          width: 4px;
        }

        .search-suggestions::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }

        .search-suggestions::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }

        .search-suggestions::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `),ve=Y("<button class=search-box__button type=button>"),we=Y("<div><span class=search-suggestion__text></span><span class=search-suggestion__category>");function Me(e){const o=e.useInternalState!==!1,c=o?te({}):null,[x,_]=g(),[w,R]=g(),[D,S]=g([]),[E,y]=g(!1),[M,f]=g(-1),[h,a]=g(),[n,d]=g(!1),[l,r]=g(""),m=()=>o&&c?c.query():e.query||"",P=s=>{if(o&&c?c.setQuery(s):e.onQueryChange?.(s),s.trim()||(S([]),y(!1),f(-1)),e.autoSearch&&s.trim()){const u=w();u&&clearTimeout(u);const b=setTimeout(()=>{e.onSearch?.(s.trim())},e.debounceMs||300);R(b)}e.showSuggestions&&!n()&&T(s)},Q=s=>{const u=s.currentTarget.value;P(u)},k=async s=>{if(!s.trim()||!e.showSuggestions||n()){S([]),y(!1);return}try{const u=await de.getMusicSuggestions(s,{limit:e.maxSuggestions||8});S(u.suggestions||[]),y(u.suggestions.length>0)}catch(u){console.error("Failed to fetch suggestions:",u),S([]),y(!1)}},T=s=>{const u=h();if(u&&clearTimeout(u),s.trim()&&s!==l()){const b=setTimeout(()=>{r(s),k(s)},150);a(b)}else s.trim()||(S([]),y(!1),r(""))},C=s=>{const u=D();switch(s.key){case"ArrowDown":E()&&u.length>0&&(s.preventDefault(),f(b=>b<u.length-1?b+1:0));break;case"ArrowUp":E()&&u.length>0&&(s.preventDefault(),f(b=>b>0?b-1:u.length-1));break;case"Enter":if(s.preventDefault(),E()&&M()>=0&&M()<u.length){const b=u[M()];b&&q(b.text)}else{const A=x()?.value?.trim()||""||m().trim();A&&(P(A),L())}break;case"Escape":y(!1),f(-1),x()?.blur();break}},L=()=>{const u=x()?.value?.trim()||""||m().trim();u&&(P(u),y(!1),d(!0),r(u),e.onSearch?.(u),x()?.blur(),setTimeout(()=>{d(!1),r("")},1e3))},q=s=>{P(s),y(!1),f(-1),d(!0),r(s),e.onSuggestionSelect?.(s),x()?.blur(),setTimeout(()=>{d(!1),r("")},1e3)},z=()=>{m().trim()&&D().length>0&&!n()&&y(!0)},O=()=>{setTimeout(()=>{y(!1),f(-1)},150)};return ae(()=>()=>{const s=w();s&&clearTimeout(s)}),(()=>{var s=xe(),u=s.firstChild,b=u.firstChild,A=u.nextSibling;return b.addEventListener("blur",O),b.addEventListener("focus",z),b.$$keydown=C,b.$$input=Q,oe(_,b),$(u,(()=>{var F=J(()=>!!e.showSearchButton);return()=>F()&&(()=>{var p=ve();return p.$$click=L,$(p,()=>e.searchButtonText||"Search"),W(()=>p.disabled=e.disabled||!m().trim()),p})()})(),null),$(s,G(ce,{get when(){return J(()=>!!E())()&&D().length>0},get children(){var F=_e();return $(F,G(ie,{get each(){return D()},children:(p,B)=>(()=>{var H=we(),N=H.firstChild,K=N.nextSibling;return H.$$click=()=>q(p.text),$(N,()=>p.text),$(K,()=>p.category),W(()=>Z(H,`search-suggestion ${B()===M()?"search-suggestion--selected":""}`)),H})()})),F}}),A),W(F=>{var p=`search-box ${e.class||""}`,B=e.placeholder||"Search...",H=e.disabled;return p!==F.e&&Z(s,F.e=p),B!==F.t&&le(b,"placeholder",F.t=B),H!==F.a&&(b.disabled=F.a=H),F},{e:void 0,t:void 0,a:void 0}),W(()=>b.value=m()),s})()}ne(["input","keydown","click"]);const re=ue();function Fe(e){const c={...Se({apiClient:e.apiClient,initialQuery:e.searchOptions?.initialQuery||"",initialDomain:e.searchOptions?.initialDomain||"music",enableHistory:e.searchOptions?.enableHistory??!0,enableSuggestions:e.searchOptions?.enableSuggestions??!0,debounceMs:e.searchOptions?.debounceMs||300,autoSearch:e.searchOptions?.autoSearch??!1,integrationMode:e.searchOptions?.integrationMode||"standalone",webSocketItems:e.searchOptions?.webSocketItems,onError:e.searchOptions?.onError}),apiClient:e.apiClient};return G(re.Provider,{value:c,get children(){return e.children}})}function pe(){const e=ge(re);if(!e)throw new Error("useSearchContext must be used within a SearchProvider");return e}export{Fe as S,pe as a,Me as b,te as u};
//# sourceMappingURL=SearchContext-DJPLwtV6.js.map
