import{c as S,h as L,g as N,d as X,o as ae,t as w,l as de,k as h,m as j,b as A,e as J,n as Y,f as fe,i as b,S as k,F as G,j as be,u as ye,r as pe}from"./web-D0fRMFns.js";import{A as ve}from"./api-client-Ciyqoh98.js";import"./types-CGPwAX3k.js";function xe(e,o){let n;return(..._)=>{clearTimeout(n),n=setTimeout(()=>e(..._),o)}}function Se(e){const[o,n]=S(e.initialQuery||""),[_,p]=S(e.initialDomain||"music"),[g,f]=S(null),[F,C]=S(null),[I,E]=S(!1),[i,s]=S(null),t=L(()=>{const y=g(),v=F();return(y?.results?.length||0)>0||(v?.songs?.length||0)>0}),c=L(()=>{const y=g(),v=F();return(y?.results?.length||0)+(v?.songs?.length||0)}),l=L(()=>o().trim().length===0),r=L(()=>o().trim().length>0&&!I());N(()=>{o(),i()&&s(null)});const u=async y=>{const v=o().trim();if(!v){f(null);return}E(!0),s(null);try{const $=await e.apiClient.searchMusic(v,y);f($),C(null)}catch($){const T=$ instanceof Error?$:new Error(String($));s(T),f(null),e.onError&&e.onError(T)}finally{E(!1)}},a=async y=>{const v=o().trim();if(!v){C(null);return}E(!0),s(null);try{const $=await e.apiClient.searchSongs(v,y);C($),f(null)}catch($){const T=$ instanceof Error?$:new Error(String($));s(T),C(null),e.onError&&e.onError(T)}finally{E(!1)}},x=xe(u,e.debounceMs||300);return N(()=>{e.autoSearch!==!1&&(o().trim().length>0?x():(f(null),C(null)))}),{query:o,setQuery:n,domain:_,setDomain:p,results:g,songsResults:F,loading:I,error:i,clearError:()=>{s(null)},search:u,searchSongs:a,clearResults:()=>{f(null),C(null)},hasResults:t,resultsCount:c,isEmpty:l,canSearch:r}}function $e(e,o){let n;return(..._)=>{clearTimeout(n),n=setTimeout(()=>e(..._),o)}}function he(e){const[o,n]=S([]),[_,p]=S(!1),[g,f]=S(null),F=()=>e.minQueryLength??2,C=()=>e.maxSuggestions??10,I=()=>e.enabled??!0,E=L(()=>o().length>0),i=L(()=>o().length),s=L(()=>e.query().trim().length===0),t=async a=>{if(!I())return;const x=a.trim();if(x.length<F()){n([]);return}p(!0),f(null);try{const R={q:x,limit:C()},d=await e.apiClient.getMusicSuggestions(x,R);n(d.suggestions)}catch(R){const d=R instanceof Error?R:new Error(String(R));f(d),n([]),e.onError&&e.onError(d)}finally{p(!1)}},c=$e(t,e.debounceMs||300);return N(()=>{const a=e.query();I()?c(a):n([])}),N(()=>{e.query(),g()&&f(null)}),{suggestions:o,loading:_,error:g,hasSuggestions:E,suggestionsCount:i,isEmpty:s,refresh:async()=>{const a=e.query();await t(a)},clearSuggestions:()=>{n([])},clearError:()=>{f(null)}}}const ce=300,we=50,se={artist:"",album:"",genre:"",year:null,rating_min:null,rating_max:null,favorites_only:!1};function ne(e={}){const[o,n]=S(e.initialQuery||""),[_,p]=S(e.initialDomain||"music"),[g,f]=S({...se}),F=e.maxHistoryItems||we,[C,I]=S([]),[E,i]=S(!1),[s,t]=S(ce),[c,l]=S(!1),[r,u]=S(ce),[a,x]=S(""),[R,d]=S("music"),[y,v]=S(1),[$,T]=S(20),[Q,P]=S("relevance"),[H,z]=S("desc");return{query:o,setQuery:n,domain:_,setDomain:p,filters:g,setFilters:f,updateFilter:(m,M)=>{const V={...g(),[m]:M};f(V)},clearFilters:()=>{f({...se})},searchHistory:C,addToHistory:m=>{if(!e.enableHistory)return;const M=m.trim();if(!M)return;const V=C().filter(me=>me!==M),_e=[M,...V].slice(0,F);I(_e)},removeFromHistory:m=>{if(!e.enableHistory)return;const re=C().filter(V=>V!==m);I(re)},clearHistory:()=>{I([])},isSearchPanelOpen:E,setIsSearchPanelOpen:i,toggleSearchPanel:()=>{i(!E())},searchPanelWidth:s,setSearchPanelWidth:t,isFiltersPanelOpen:c,setIsFiltersPanelOpen:l,toggleFiltersPanel:()=>{l(!c())},filtersPanelWidth:r,setFiltersPanelWidth:u,lastSearchQuery:a,setLastSearchQuery:x,lastSearchDomain:R,setLastSearchDomain:d,currentPage:y,setCurrentPage:v,pageSize:$,setPageSize:T,sortBy:Q,setSortBy:P,sortDirection:H,setSortDirection:z,toggleSortDirection:()=>{z(H()==="asc"?"desc":"asc")},getMusicSearchOptions:()=>{const m=g();return{q:o(),artist:m.artist||void 0,album:m.album||void 0,genre:m.genre||void 0,year:m.year||void 0,rating_min:m.rating_min||void 0,rating_max:m.rating_max||void 0,favorites_only:m.favorites_only||void 0,page:y(),page_size:$(),sort_by:Q(),sort_direction:H()}},getSongsSearchOptions:()=>{const m=g();return{q:o(),artist:m.artist||void 0,album:m.album||void 0,genre:m.genre||void 0,year:m.year||void 0,rating_min:m.rating_min||void 0,rating_max:m.rating_max||void 0,favorites_only:m.favorites_only||void 0,page:y(),page_size:$(),sort_by:Q(),sort_direction:H()}},reset:()=>{n(""),p("music"),f({...se}),v(1),P("relevance"),z("desc"),x(""),d("music")},hasActiveFilters:()=>{const m=g();return m.artist!==""||m.album!==""||m.genre!==""||m.year!==null||m.rating_min!==null||m.rating_max!==null||m.favorites_only!==!1},getFilterCount:()=>{const m=g();let M=0;return m.artist&&M++,m.album&&M++,m.genre&&M++,m.year!==null&&M++,m.rating_min!==null&&M++,m.rating_max!==null&&M++,m.favorites_only&&M++,M}}}function Ce(e){const o=L(()=>{const t=e.searchResults(),c=e.songsResults(),l=[];return t?.results&&l.push(...t.results),c?.songs&&l.push(...c.songs),l}),n=L(()=>{const t=o(),c=e.searchState.filters();return t.filter(l=>{const r="artist"in l;return!(c.artist&&r&&l.artist&&!l.artist.toLowerCase().includes(c.artist.toLowerCase())||c.album&&r&&l.album&&!l.album.toLowerCase().includes(c.album.toLowerCase())||c.genre&&r&&l.genre&&!l.genre.toLowerCase().includes(c.genre.toLowerCase())||c.year&&r&&l.year&&l.year!==c.year||c.rating_min&&r&&l.rating&&l.rating<c.rating_min||c.rating_max&&r&&l.rating&&l.rating>c.rating_max||c.favorites_only&&r&&!l.is_favorite)})}),_=L(()=>{const t=n(),c=e.searchState.sortBy(),l=e.searchState.sortDirection();return[...t].sort((u,a)=>{let x,R;switch(c){case"title":x=u.title?.toLowerCase()||"",R=a.title?.toLowerCase()||"";break;case"artist":x=("artist"in u?u.artist?.toLowerCase():"")||"",R=("artist"in a?a.artist?.toLowerCase():"")||"";break;case"album":x=("album"in u?u.album?.toLowerCase():"")||"",R=("album"in a?a.album?.toLowerCase():"")||"";break;case"created_at":x=u.created_at?new Date(u.created_at).getTime():0,R=a.created_at?new Date(a.created_at).getTime():0;break;case"rating":x=("rating"in u?u.rating:0)||0,R=("rating"in a?a.rating:0)||0;break;case"relevance":default:return 0}return x<R?l==="asc"?-1:1:x>R?l==="asc"?1:-1:0})}),p=L(()=>_()),g=L(()=>{const t=p(),c={},l={},r={},u={};return t.forEach(a=>{const x="artist"in a;x&&a.artist&&(c[a.artist]||(c[a.artist]=[]),c[a.artist].push(a)),x&&a.album&&(l[a.album]||(l[a.album]=[]),l[a.album].push(a)),x&&a.genre&&(r[a.genre]||(r[a.genre]=[]),r[a.genre].push(a)),x&&a.year&&(u[a.year]||(u[a.year]=[]),u[a.year].push(a))}),{byArtist:c,byAlbum:l,byGenre:r,byYear:u}}),f=L(()=>{const t=e.searchResults(),c=e.songsResults(),l=e.searchState.currentPage(),r=e.searchState.pageSize(),u=t?.total_count||c?.total_count||0,a=Math.ceil(u/r);return{totalResults:u,totalPages:a,currentPage:l,hasNextPage:l<a,hasPrevPage:l>1,resultsPerPage:r}}),F=L(()=>{if(e.integrationMode!=="freqhole-integrated"||!e.webSocketItems)return p();const t=p(),c=e.webSocketItems(),l=new Set(t.map(u=>u.id)),r=c.filter(u=>!l.has(u.id));return[...t,...r]}),C=L(()=>F()),I=L(()=>p().length===0),E=L(()=>p().length>0);return{processedResults:p,integratedResults:F,searchStats:f,groupedResults:g,filteredResults:n,sortedResults:_,mergedWithWebSocket:C,isEmpty:I,hasResults:E,getResultById:t=>p().find(c=>c.id===t),getResultsByType:t=>p().filter(c=>"result_type"in c?c.result_type===t:!1)}}function ke(e){const o=ne({initialQuery:e.initialQuery,initialDomain:e.initialDomain,enableHistory:e.enableHistory}),n=Se({apiClient:e.apiClient,initialQuery:e.initialQuery,initialDomain:e.initialDomain,debounceMs:e.debounceMs,autoSearch:e.autoSearch,onError:e.onError}),_=he({apiClient:e.apiClient,query:n.query,debounceMs:e.debounceMs,enabled:e.enableSuggestions,onError:e.onError}),p=Ce({searchResults:n.results,songsResults:n.songsResults,searchState:o,integrationMode:e.integrationMode,webSocketItems:e.webSocketItems}),g=async()=>{const s=o.query(),t=o.getMusicSearchOptions();s.trim()&&(o.addToHistory(s),o.setLastSearchQuery(s),o.setLastSearchDomain(o.domain())),n.setQuery(s),await n.search(t)},f=async()=>{const s=o.query(),t=o.getSongsSearchOptions();s.trim()&&(o.addToHistory(s),o.setLastSearchQuery(s),o.setLastSearchDomain(o.domain())),n.setQuery(s),await n.searchSongs(t)},F=()=>{n.clearResults(),_.clearSuggestions(),o.setQuery(""),o.setCurrentPage(1)},C=L(()=>n.loading()||_.loading()||o.query().trim().length>0),I=L(()=>n.hasResults()||p.hasResults()),E=L(()=>p.searchStats().totalResults),i=L(()=>n.canSearch()&&!n.loading());return{state:o,search:n,suggestions:_,data:p,performSearch:g,performSongsSearch:f,clearAll:F,isActive:C,hasAnyResults:I,totalResultsCount:E,canPerformSearch:i}}var Fe=w(`<div><div class=search-box__container><input type=text class=search-box__input autocomplete=off></div><style>
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
      `),Re=w("<button class=search-box__button type=button>");function Ee(e){const o=e.useInternalState!==!1,n=o?ne({}):null,[_,p]=S(),[g,f]=S(),F=()=>o&&n?n.query():e.query||"",C=s=>{if(o&&n?n.setQuery(s):e.onQueryChange?.(s),e.autoSearch&&s.trim()){const t=g();t&&clearTimeout(t);const c=setTimeout(()=>{e.onSearch?.(s.trim())},e.debounceMs||300);f(c)}},I=s=>{const t=s.currentTarget.value;C(t)},E=s=>{switch(s.key){case"Enter":s.preventDefault();const t=F().trim();t&&(e.onSearch?.(t),_()?.blur());break;case"Escape":_()?.blur();break}},i=()=>{const s=F().trim();s&&(e.onSearch?.(s),_()?.blur())};return ae(()=>()=>{const s=g();s&&clearTimeout(s)}),(()=>{var s=Fe(),t=s.firstChild,c=t.firstChild;return c.$$keydown=E,c.$$input=I,de(p,c),h(t,(()=>{var l=j(()=>!!e.showSearchButton);return()=>l()&&(()=>{var r=Re();return r.$$click=i,h(r,()=>e.searchButtonText||"Search"),A(()=>r.disabled=e.disabled||!F().trim()),r})()})(),null),A(l=>{var r=`search-box ${e.class||""}`,u=e.placeholder||"Search...",a=e.disabled;return r!==l.e&&J(s,l.e=r),u!==l.t&&Y(c,"placeholder",l.t=u),a!==l.a&&(c.disabled=l.a=a),l},{e:void 0,t:void 0,a:void 0}),A(()=>c.value=F()),s})()}X(["input","keydown","click"]);var qe=w("<div class=search-suggestions__loading>Loading suggestions..."),De=w(`<div role=listbox aria-label="Search suggestions"><style>
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
        `),Ie=w("<div role=option><span class=search-suggestions__text>");function Le(e){const o=e.useInternalSuggestions!==!1,n=o&&e.apiClient?he({apiClient:e.apiClient,query:()=>e.query,debounceMs:e.debounceMs||300,enabled:e.show!==!1}):null,[_,p]=S(-1),[g,f]=S(),[F,C]=S(!0),I=()=>o&&n?n.suggestions():e.suggestions||[],E=()=>o&&n?n.loading():e.loading||!1,i=()=>{const r=e.query.toLowerCase().trim();return r?I().filter(a=>{const x=typeof a=="string"?a:a.text;return x.toLowerCase().includes(r)&&x.toLowerCase()!==r}).slice(0,e.maxSuggestions||10):[]},s=()=>e.show===!1||!e.query.trim()||!F()?!1:i().length>0||E()&&e.showLoading,t=r=>{e.onSuggestionSelect?.(r),p(-1),C(!1),e.onBlur?.()},c=r=>{const u=i();switch(r.key){case"ArrowDown":r.preventDefault(),u.length>0&&p(a=>a<u.length-1?a+1:0);break;case"ArrowUp":r.preventDefault(),u.length>0&&p(a=>a>0?a-1:u.length-1);break;case"Enter":if(r.preventDefault(),_()>=0&&_()<u.length){const a=u[_()];if(a){const x=typeof a=="string"?a:a.text;t(x)}}else C(!1),e.onBlur?.();break;case"Escape":p(-1),C(!1),e.onBlur?.();break}};N(()=>{const r=i();r.length===0?p(-1):_()>=r.length&&p(r.length-1)}),N(()=>{const r=e.query.trim();C(!!r)});const l=r=>{const u=g();u&&!u.contains(r.target)&&(C(!1),e.onBlur?.())};return ae(()=>{document.addEventListener("keydown",c),document.addEventListener("mousedown",l)}),fe(()=>{document.removeEventListener("keydown",c),document.removeEventListener("mousedown",l)}),b(k,{get when(){return s()},get children(){var r=De(),u=r.firstChild;return de(f,r),h(r,b(k,{get when(){return E()&&e.showLoading},get children(){return qe()}}),u),h(r,b(k,{get when(){return j(()=>!E())()&&i().length>0},get children(){return b(G,{get each(){return i()},children:(a,x)=>{const R=typeof a=="string"?a:a.text;return(()=>{var d=Ie(),y=d.firstChild;return d.$$click=()=>t(R),Y(d,"data-suggestion",R),h(y,R),A(v=>{var $=`search-suggestions__item ${x()===_()?"search-suggestions__item--selected":""}`,T=x()===_();return $!==v.e&&J(d,v.e=$),T!==v.t&&Y(d,"aria-selected",v.t=T),v},{e:void 0,t:void 0}),d})()}})}}),u),A(()=>J(r,`search-suggestions ${e.class||""} search-suggestions--${e.position||"bottom"}`)),r}})}X(["click"]);var Ae=w("<span class=search-filters__count>(<!>)"),Te=w("<button class=search-filters__clear-button type=button>Clear All"),Me=w("<button class=search-filters__toggle-button type=button>"),Oe=w("<div class=search-filters__loading>Loading filters..."),ze=w('<div class=search-filters__group><label class=search-filters__label>Search Query<input type=text class=search-filters__input placeholder="Enter search terms...">'),Be=w("<div class=search-filters__group><label class=search-filters__label>Genre</label><select class=search-filters__select><option value>All Genres"),Qe=w("<div class=search-filters__group><label class=search-filters__label>Artist</label><select class=search-filters__select><option value>All Artists"),Pe=w("<div class=search-filters__group><label class=search-filters__label>Type</label><div class=search-filters__checkboxes>"),He=w('<div class=search-filters__content><div class=search-filters__group><label class=search-filters__label>Year</label><div class=search-filters__range><input type=number class=search-filters__input placeholder=Year min=1900 max=2024></div></div><div class=search-filters__group><label class=search-filters__label>Rating</label><div class=search-filters__range><input type=number class="search-filters__input search-filters__input--small"placeholder=Min min=1 max=5><span class=search-filters__range-separator>to</span><input type=number class="search-filters__input search-filters__input--small"placeholder=Max min=1 max=5></div></div><div class=search-filters__group><label class=search-filters__checkbox-label><input type=checkbox class=search-filters__checkbox>Favorites Only</label></div><div class=search-filters__group><label class=search-filters__label>Sort By</label><select class=search-filters__select><option value=relevance>Relevance</option><option value=name>Name</option><option value=size>Size</option><option value=duration>Duration</option><option value=created>Date Created</option></select></div><div class=search-filters__group><label class=search-filters__label>Sort Order</label><select class=search-filters__select><option value=asc>Ascending</option><option value=desc>Descending'),We=w(`<div><div class=search-filters__header><h3 class=search-filters__title>Filters</h3><div class=search-filters__actions></div></div><style>
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
      `),ue=w("<option>"),je=w("<span class=search-filters__option-count>(<!>)"),Ne=w("<label class=search-filters__checkbox-label><input type=checkbox class=search-filters__checkbox>");function Ue(e){const o=e.useInternalState!==!1,n=o?ne({}):null,[_,p]=S(e.startExpanded!==!1),g=()=>{if(o&&n){const i=n.filters();return{query:n.query(),genre:i.genre,artist:i.artist,yearFrom:i.year,rating_min:i.rating_min,rating_max:i.rating_max,favorites_only:i.favorites_only,types:[],sortBy:n.sortBy(),sortOrder:n.sortDirection()}}return e.filters||{}},f=(i,s)=>{if(o&&n)switch(i){case"query":n.setQuery(s);break;case"genre":n.updateFilter("genre",s);break;case"artist":n.updateFilter("artist",s);break;case"yearFrom":n.updateFilter("year",s?parseInt(s):null);break;case"rating_min":n.updateFilter("rating_min",s?parseInt(s):null);break;case"rating_max":n.updateFilter("rating_max",s?parseInt(s):null);break;case"favorites_only":n.updateFilter("favorites_only",s);break;case"sortBy":n.setSortBy(s);break;case"sortOrder":n.setSortDirection(s);break;default:const t={...g()};s===""||s===null||s===void 0?delete t[i]:t[i]=s,e.onFiltersChange?.(t);break}else{const t={...g()};s===""||s===null||s===void 0?delete t[i]:t[i]=s,e.onFiltersChange?.(t)}},F=(i,s,t)=>{const c=g()[i]||[];let l;t?l=[...c,s]:l=c.filter(r=>r!==s),f(i,l.length>0?l:void 0)},C=()=>{o&&n?(n.setQuery(""),n.clearFilters(),n.setSortBy("relevance"),n.setSortDirection("desc")):e.onFiltersChange?.({})},I=()=>{const i=g();return Object.keys(i).some(s=>{const t=i[s];return t!=null&&t!==""&&(Array.isArray(t)?t.length>0:!0)})},E=()=>{const i=g();return Object.keys(i).filter(s=>{const t=i[s];return t!=null&&t!==""&&(Array.isArray(t)?t.length>0:!0)}).length};return(()=>{var i=We(),s=i.firstChild,t=s.firstChild;t.firstChild;var c=t.nextSibling,l=s.nextSibling;return h(t,b(k,{get when(){return E()>0},get children(){var r=Ae(),u=r.firstChild,a=u.nextSibling;return a.nextSibling,h(r,E,a),r}}),null),h(c,b(k,{get when(){return I()},get children(){var r=Te();return r.$$click=C,r}}),null),h(c,b(k,{get when(){return e.showToggle!==!1},get children(){var r=Me();return r.$$click=()=>p(!_()),h(r,()=>_()?"Collapse":"Expand"),A(()=>Y(r,"aria-expanded",_())),r}}),null),h(i,b(k,{get when(){return e.loading},get children(){return Oe()}}),l),h(i,b(k,{get when(){return j(()=>!e.loading)()&&(_()||I())},get children(){var r=He(),u=r.firstChild,a=u.firstChild,x=a.nextSibling,R=x.firstChild,d=u.nextSibling,y=d.firstChild,v=y.nextSibling,$=v.firstChild,T=$.nextSibling,Q=T.nextSibling,P=d.nextSibling,H=P.firstChild,z=H.firstChild,Z=P.nextSibling,le=Z.firstChild,K=le.nextSibling,ie=Z.nextSibling,oe=ie.firstChild,ee=oe.nextSibling;return h(r,b(k,{get when(){return e.showQueryInput!==!1},get children(){var q=ze(),W=q.firstChild,B=W.firstChild,D=B.nextSibling;return D.$$input=O=>f("query",O.currentTarget.value),A(()=>D.value=g().query||""),q}}),u),h(r,b(k,{get when(){return e.filterOptions?.genres},get children(){var q=Be(),W=q.firstChild,B=W.nextSibling;return B.firstChild,B.addEventListener("change",D=>f("genre",D.currentTarget.value)),h(B,b(G,{get each(){return e.filterOptions?.genres},children:D=>(()=>{var O=ue();return h(O,()=>D.label,null),h(O,b(k,{get when(){return e.showCounts&&D.count!==void 0},get children(){return["(",j(()=>D.count),")"]}}),null),A(()=>O.value=D.value),O})()}),null),A(()=>B.value=g().genre||""),q}}),u),h(r,b(k,{get when(){return e.filterOptions?.artists},get children(){var q=Qe(),W=q.firstChild,B=W.nextSibling;return B.firstChild,B.addEventListener("change",D=>f("artist",D.currentTarget.value)),h(B,b(G,{get each(){return e.filterOptions?.artists},children:D=>(()=>{var O=ue();return h(O,()=>D.label,null),h(O,b(k,{get when(){return e.showCounts&&D.count!==void 0},get children(){return["(",j(()=>D.count),")"]}}),null),A(()=>O.value=D.value),O})()}),null),A(()=>B.value=g().artist||""),q}}),u),R.$$input=q=>f("yearFrom",q.currentTarget.value),h(r,b(k,{get when(){return e.filterOptions?.types},get children(){var q=Pe(),W=q.firstChild,B=W.nextSibling;return h(B,b(G,{get each(){return e.filterOptions?.types},children:D=>(()=>{var O=Ne(),te=O.firstChild;return te.addEventListener("change",U=>F("types",D.value,U.currentTarget.checked)),h(O,()=>D.label,null),h(O,b(k,{get when(){return e.showCounts&&D.count!==void 0},get children(){var U=je(),m=U.firstChild,M=m.nextSibling;return M.nextSibling,h(U,()=>D.count,M),U}}),null),A(()=>te.checked=(g().types||[]).includes(D.value)),O})()})),q}}),d),$.$$input=q=>f("rating_min",q.currentTarget.value),Q.$$input=q=>f("rating_max",q.currentTarget.value),z.addEventListener("change",q=>f("favorites_only",q.currentTarget.checked)),K.addEventListener("change",q=>f("sortBy",q.currentTarget.value)),ee.addEventListener("change",q=>f("sortOrder",q.currentTarget.value)),A(()=>R.value=g().yearFrom||""),A(()=>$.value=g().rating_min||""),A(()=>Q.value=g().rating_max||""),A(()=>z.checked=g().favorites_only||!1),A(()=>K.value=g().sortBy||"relevance"),A(()=>ee.value=g().sortOrder||"desc"),r}}),l),A(()=>J(i,`search-filters ${e.class||""}`)),i})()}X(["click","input"]);const ge=be();function Ve(e){const n={...ke({apiClient:e.apiClient,initialQuery:e.searchOptions?.initialQuery||"",initialDomain:e.searchOptions?.initialDomain||"music",enableHistory:e.searchOptions?.enableHistory??!0,enableSuggestions:e.searchOptions?.enableSuggestions??!0,debounceMs:e.searchOptions?.debounceMs||300,autoSearch:e.searchOptions?.autoSearch??!1,integrationMode:e.searchOptions?.integrationMode||"standalone",webSocketItems:e.searchOptions?.webSocketItems,onError:e.searchOptions?.onError}),apiClient:e.apiClient};return b(ge.Provider,{value:n,get children(){return e.children}})}function Ye(){const e=ye(ge);if(!e)throw new Error("useSearchContext must be used within a SearchProvider");return e}var Ge=w('<button class=search-demo__clear-button type=button title="Clear search">✕'),Je=w("<div class=search-demo__stats-item><span class=search-demo__stats-label>Results:</span><span class=search-demo__stats-value>"),Xe=w("<div class=search-demo__stats-item><span class=search-demo__stats-label>🎛️ Filters:</span><span class=search-demo__stats-value> active"),Ze=w("<div class=search-demo__stats-item><span class=search-demo__stats-loading>🔄 Searching..."),Ke=w("<div class=search-demo__results-header><h3>Search Results</h3><p>Found <!> results"),et=w("<div class=search-demo__results-grid>"),tt=w("<p class=search-demo__error>Error: "),rt=w("<div class=search-demo__no-results><h3>No results found</h3><p>Try adjusting your search terms or filters"),st=w("<div class=search-demo__welcome><h3>Welcome to Search Demo</h3><p>Enter a search query to get started</p><ul class=search-demo__features><li>🔍 Real-time search suggestions</li><li>🎛️ Advanced filtering options</li><li>📱 Responsive design</li><li>⚡ Fast and efficient"),at=w(`<div class=search-demo><div class=search-demo__header><h1 class=search-demo__title>🔍 Search Demo</h1><p class=search-demo__description>Modular search components with autocomplete, filtering, and real-time results</p></div><div class=search-demo__content><div class=search-demo__search-section><div class=search-demo__search-container><div class=search-demo__input-group></div></div><div class=search-demo__stats></div></div><div class=search-demo__main><div class=search-demo__filters></div><div class=search-demo__results></div></div></div><style>
        /* Fix text colors for demo */
        .search-demo {
          color: #333;
        }

        .search-demo h1,
        .search-demo h2,
        .search-demo h3,
        .search-demo p,
        .search-demo span,
        .search-demo div {
          color: #333;
        }

        .search-demo__results-item {
          color: #333;
        }

        .search-demo__results-item h3 {
          color: #2c3e50;
        }

        .search-demo__results-item p {
          color: #666;
        }

        .search-demo__stats-value {
          color: #007bff;
        }

        .search-demo__stats-loading {
          color: #28a745;
        }

        /* Ensure search suggestions are visible */
        .search-suggestions {
          background: white;
          color: #333;
          border: 1px solid #ddd;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .search-suggestions__item {
          color: #333;
        }

        .search-suggestions__item:hover {
          background-color: #f8f9fa;
          color: #333;
        }

        .search-suggestions__item--selected {
          background-color: #007bff;
          color: white;
        }

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

        .search-demo__input-group {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .search-demo__clear-button {
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          transition: all 0.2s;
          backdrop-filter: blur(10px);
        }

        .search-demo__clear-button:hover {
          background: rgba(255, 255, 255, 0.3);
          border-color: rgba(255, 255, 255, 0.5);
          transform: scale(1.05);
        }

        .search-demo__clear-button:active {
          transform: scale(0.95);
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
      `),nt=w("<span class=search-demo__result-score>Score: "),lt=w("<div class=search-demo__result-artist>Artist: "),it=w("<div class=search-demo__result-card><h4 class=search-demo__result-title></h4><p class=search-demo__result-description></p><div class=search-demo__result-meta><span class=search-demo__result-type>");console.log("🔍 Search Demo loading...");const ot=e=>new ve(e),ct={genres:[{value:"rock",label:"Rock"},{value:"pop",label:"Pop"},{value:"jazz",label:"Jazz"},{value:"classical",label:"Classical"},{value:"electronic",label:"Electronic"},{value:"folk",label:"Folk"},{value:"hip-hop",label:"Hip-Hop"},{value:"country",label:"Country"},{value:"blues",label:"Blues"},{value:"r&b",label:"R&B"}],artists:[{value:"",label:"All Artists"},{value:"beatles",label:"The Beatles"},{value:"dylan",label:"Bob Dylan"},{value:"stones",label:"Rolling Stones"},{value:"bowie",label:"David Bowie"}],types:[{value:"song",label:"Song"},{value:"album",label:"Album"},{value:"artist",label:"Artist"}]};function ut(){const e=Ye(),[o,n]=S(""),[_,p]=S([]),[g,f]=S(!1);ae(()=>{try{localStorage.removeItem("search-state"),localStorage.removeItem("freqhole-state"),localStorage.removeItem("grid-state"),localStorage.clear(),console.log("🧹 Cleared all localStorage for demo")}catch(i){console.log("Could not clear localStorage:",i)}});const F=async i=>{const s=i||e.state.query();if(s.trim()){f(!0),console.log("🔍 Performing search:",s),console.log("🔍 API Client:",e.apiClient),console.log("🔍 Search context:",e.search);try{i&&e.state.setQuery(i),console.log("🔍 About to call performSearch..."),await e.performSearch(),console.log("🔍 performSearch completed");const t=e.search.results();console.log("🔍 Raw results:",t),console.log("🔍 Search error:",e.search.error()),p(t?.results||[]),console.log("✅ Search completed:",t),console.log("🔍 Results array length:",t?.results?.length),console.log("🔍 Total count from server:",t?.total_count),(!t||!t.results||t.results.length===0)&&console.log("No results found for query:",s)}catch(t){console.error("❌ Search failed:",t),console.error("❌ Search error details:",t),p([])}finally{f(!1)}}},C=i=>{console.log("🔍 Suggestion selected:",i),e.state.setQuery(i),F(i)},I=()=>{e.state.setQuery(""),e.state.clearFilters(),p([]),n(""),console.log("🧹 Search cleared")},E=()=>{};return N(()=>{const i=e.state.query();console.log("🔍 Context query changed:",i),n(i)}),(()=>{var i=at(),s=i.firstChild,t=s.nextSibling,c=t.firstChild,l=c.firstChild,r=l.firstChild,u=l.nextSibling,a=c.nextSibling,x=a.firstChild,R=x.nextSibling;return h(r,b(Ee,{onSearch:F,placeholder:"Search music, artists, albums...",showSearchButton:!0,searchButtonText:"Search",autoSearch:!1,useInternalState:!1,get query(){return e.state.query()},onQueryChange:d=>e.state.setQuery(d)}),null),h(r,b(k,{get when(){return e.state.query().trim()||_().length>0},get children(){var d=Ge();return d.$$click=I,d}}),null),h(l,b(Le,{get query(){return e.state.query()},onSuggestionSelect:C,onBlur:E,maxSuggestions:8,showLoading:!0,position:"bottom",useInternalSuggestions:!0,get apiClient(){return e.apiClient},show:!0}),null),h(u,b(k,{get when(){return e.hasAnyResults()},get children(){var d=Je(),y=d.firstChild,v=y.nextSibling;return h(v,()=>e.totalResultsCount()),d}}),null),h(u,b(k,{get when(){return e.state.hasActiveFilters()},get children(){var d=Xe(),y=d.firstChild,v=y.nextSibling,$=v.firstChild;return h(v,()=>e.state.getFilterCount(),$),d}}),null),h(u,b(k,{get when(){return e.search.loading()||g()},get children(){return Ze()}}),null),h(x,b(Ue,{filterOptions:ct,showCounts:!1,startExpanded:!0,showToggle:!0,showQueryInput:!1,useInternalState:!1,get filters(){return{genre:e.state.filters().genre,artist:e.state.filters().artist,yearFrom:e.state.filters().year?.toString()||"",rating_min:e.state.filters().rating_min?.toString()||"",rating_max:e.state.filters().rating_max?.toString()||"",favorites_only:e.state.filters().favorites_only}},onFiltersChange:d=>{console.log("Filters changed:",d),d.genre!==void 0&&e.state.updateFilter("genre",d.genre||""),d.artist!==void 0&&e.state.updateFilter("artist",d.artist||""),d.yearFrom!==void 0&&e.state.updateFilter("year",d.yearFrom?parseInt(d.yearFrom):null),d.rating_min!==void 0&&e.state.updateFilter("rating_min",d.rating_min?parseInt(d.rating_min):null),d.rating_max!==void 0&&e.state.updateFilter("rating_max",d.rating_max?parseInt(d.rating_max):null),d.favorites_only!==void 0&&e.state.updateFilter("favorites_only",d.favorites_only),e.state.query().trim()?(console.log("🎛️ Filters changed, re-running search with filters:",d),F()):console.log("🎛️ Filters applied, but no search query to execute. Current filters:",d)}})),h(R,b(k,{get when(){return j(()=>!e.search.loading())()&&!g()},get children(){return[b(k,{get when(){return _().length>0},get children(){return[(()=>{var d=Ke(),y=d.firstChild,v=y.nextSibling,$=v.firstChild,T=$.nextSibling;return T.nextSibling,h(v,()=>_().length,T),d})(),(()=>{var d=et();return h(d,()=>_().map((y,v)=>(()=>{var $=it(),T=$.firstChild,Q=T.nextSibling,P=Q.nextSibling,H=P.firstChild;return h(T,()=>y.title||`Result ${v+1}`),h(Q,()=>y.subtitle||y.description||"No description"),h(H,()=>y.result_type||"Unknown"),h(P,b(k,{get when(){return y.relevance_score},get children(){var z=nt();return z.firstChild,h(z,()=>y.relevance_score?.toFixed(2),null),z}}),null),h($,b(k,{get when(){return y.metadata?.artist},get children(){var z=lt();return z.firstChild,h(z,()=>y.metadata.artist,null),z}}),null),A(()=>Y($,"key",y.id||v)),$})())),d})()]}}),b(k,{get when(){return j(()=>!!(_().length===0&&o()))()&&!g()},get children(){var d=rt(),y=d.firstChild;return y.nextSibling,h(d,b(k,{get when(){return e.search.error()},get children(){var v=tt();return v.firstChild,h(v,()=>e.search.error()?.message,null),v}}),null),d}}),b(k,{get when(){return j(()=>!o())()&&_().length===0},get children(){return st()}})]}})),i})()}function dt(e){const o=ot(e.apiBaseUrl||"http://localhost:8080");return b(Ve,{apiClient:o,searchOptions:{enableSuggestions:!0,enableHistory:!1,autoSearch:!1,integrationMode:"standalone"},get children(){return b(ut,{})}})}class ht extends HTMLElement{dispose;connectedCallback(){console.log("🔍 SearchDemo element connected");const o=this.getAttribute("api-base-url")||"http://localhost:8080",n=this.getAttribute("auto-connect")==="true";try{this.dispose=pe(()=>b(dt,{apiBaseUrl:o,autoConnect:n}),this),console.log("✅ SearchDemo render successful")}catch(_){console.error("❌ SearchDemo render failed:",_)}}disconnectedCallback(){console.log("🔍 SearchDemo element disconnected"),this.dispose&&this.dispose()}}try{customElements.define("search-demo",ht),console.log("✅ search-demo element registered successfully")}catch(e){console.error("❌ Failed to register search-demo element:",e)}X(["click"]);
//# sourceMappingURL=search-demo.js.map
