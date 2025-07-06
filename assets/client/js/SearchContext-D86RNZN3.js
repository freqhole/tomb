import{c as y,k as w,a as N,f as ae,o as oe,t as V,u as ie,i as H,m as ce,d as Y,e as Z,s as ee,b as he,g as B,S as X,F as ne,n as fe,p as me}from"./web-D-xQcgi-.js";import"./api-client-DUH2cqEH.js";import{o as O,n as F,s as se,b as z}from"./types-CGPwAX3k.js";//! Music filter types for the client library
const W=O({value:se(),label:se(),count:F().int().min(0)}),Be=O({limit:F().int().min(1).max(1e3).optional().default(50),min_count:F().int().min(0).optional().default(0)}),ze=O({genres:z(W),total_count:F().int().min(0)}),We=O({artists:z(W),total_count:F().int().min(0)}),Ne=O({years:z(W),total_count:F().int().min(0)}),be=O({min:F().int().min(1).max(5),max:F().int().min(1).max(5),most_common:F().int().min(1).max(5).nullish()}),ye=O({total_songs:F().int().min(0),rated_songs:F().int().min(0),favorite_songs:F().int().min(0),unique_genres:F().int().min(0),unique_artists:F().int().min(0),unique_years:F().int().min(0)}),Ve=O({genres:z(W),artists:z(W),years:z(W),rating_range:be,summary:ye});function Ye(e){return{genres:e.genres.map(({value:s,label:i})=>({value:s,label:i})),artists:e.artists.map(({value:s,label:i})=>({value:s,label:i})),types:[{value:"song",label:"Song"},{value:"album",label:"Album"},{value:"artist",label:"Artist"}]}}function _e(e,s){let i;return(..._)=>{clearTimeout(i),i=setTimeout(()=>e(..._),s)}}function Se(e){const[s,i]=y(e.initialQuery||""),[_,m]=y(e.initialDomain||"music"),[v,x]=y(null),[R,S]=y(null),[E,k]=y(!1),[D,c]=y(null),l=w(()=>{const b=v(),q=R();return(b?.results?.length||0)>0||(q?.songs?.length||0)>0}),o=w(()=>{const b=v(),q=R();return(b?.results?.length||0)+(q?.songs?.length||0)}),r=w(()=>s().trim().length===0),h=w(()=>s().trim().length>0&&!E());N(()=>{s(),D()&&c(null)});const g=async b=>{const q=s().trim();if(!q){x(null);return}k(!0),c(null);try{const C=await e.apiClient.searchMusic(q,b);x(C),S(null)}catch(C){const L=C instanceof Error?C:new Error(String(C));c(L),x(null),e.onError&&e.onError(L)}finally{k(!1)}},a=async b=>{const q=s().trim();if(!q){S(null);return}k(!0),c(null);try{const C=await e.apiClient.searchSongs(q,b);S(C),x(null)}catch(C){const L=C instanceof Error?C:new Error(String(C));c(L),S(null),e.onError&&e.onError(L)}finally{k(!1)}},n=_e(g,e.debounceMs||300);return N(()=>{e.autoSearch!==!1&&(s().trim().length>0?n():(x(null),S(null)))}),{query:s,setQuery:i,domain:_,setDomain:m,results:v,songsResults:R,loading:E,error:D,clearError:()=>{c(null)},search:g,searchSongs:a,clearResults:()=>{x(null),S(null)},hasResults:l,resultsCount:o,isEmpty:r,canSearch:h}}function xe(e,s){let i;return(..._)=>{clearTimeout(i),i=setTimeout(()=>e(..._),s)}}function le(e){const[s,i]=y([]),[_,m]=y(!1),[v,x]=y(null),R=()=>e.minQueryLength??2,S=()=>e.maxSuggestions??10,E=()=>e.enabled??!0,k=w(()=>s().length>0),D=w(()=>s().length),c=w(()=>e.query().trim().length===0),l=async a=>{if(!E())return;const n=a.trim();if(n.length<R()){i([]);return}m(!0),x(null);try{const u={q:n,limit:S()},f=await e.apiClient.getMusicSuggestions(n,u);i(f.suggestions)}catch(u){const f=u instanceof Error?u:new Error(String(u));x(f),i([]),e.onError&&e.onError(f)}finally{m(!1)}},o=xe(l,e.debounceMs||300);return N(()=>{const a=e.query();E()?o(a):i([])}),N(()=>{e.query(),v()&&x(null)}),{suggestions:s,loading:_,error:v,hasSuggestions:k,suggestionsCount:D,isEmpty:c,refresh:async()=>{const a=e.query();await l(a)},clearSuggestions:()=>{i([])},clearError:()=>{x(null)}}}const re=300,ve=50,J={artist:"",album:"",genre:"",year:null,rating_min:null,rating_max:null,favorites_only:!1};function ue(e={}){const[s,i]=y(e.initialQuery||""),[_,m]=y(e.initialDomain||"music"),[v,x]=y({...J}),R=e.maxHistoryItems||ve,[S,E]=y([]),[k,D]=y(!1),[c,l]=y(re),[o,r]=y(!1),[h,g]=y(re),[a,n]=y(""),[u,f]=y("music"),[b,q]=y(1),[C,L]=y(20),[T,I]=y(""),[A,M]=y("");return{query:s,setQuery:i,domain:_,setDomain:m,filters:v,setFilters:x,updateFilter:(t,d)=>{const p=v();let P=d;(d===""||d===null||d===void 0)&&(t==="favorites_only"?P=!1:t==="year"||t==="rating_min"||t==="rating_max"?P=null:P="");const j={...p,[t]:P};x(j)},clearFilters:()=>{x({...J})},searchHistory:S,addToHistory:t=>{if(!e.enableHistory)return;const d=t.trim();if(!d)return;const P=S().filter(de=>de!==d),j=[d,...P].slice(0,R);E(j)},removeFromHistory:t=>{if(!e.enableHistory)return;const p=S().filter(P=>P!==t);E(p)},clearHistory:()=>{E([])},isSearchPanelOpen:k,setIsSearchPanelOpen:D,toggleSearchPanel:()=>{D(!k())},searchPanelWidth:c,setSearchPanelWidth:l,isFiltersPanelOpen:o,setIsFiltersPanelOpen:r,toggleFiltersPanel:()=>{r(!o())},filtersPanelWidth:h,setFiltersPanelWidth:g,lastSearchQuery:a,setLastSearchQuery:n,lastSearchDomain:u,setLastSearchDomain:f,currentPage:b,setCurrentPage:q,pageSize:C,setPageSize:L,sortBy:T,setSortBy:I,sortDirection:A,setSortDirection:M,toggleSortDirection:()=>{const t=A();M(t===""?"desc":t==="desc"?"asc":"desc")},getMusicSearchOptions:()=>{const t=v(),d={q:s(),page:b(),page_size:C(),sort_by:T()||"relevance",sort_direction:A()||"desc"};return t.artist&&t.artist.trim()&&(d.artist=t.artist),t.album&&t.album.trim()&&(d.album=t.album),t.genre&&t.genre.trim()&&(d.genre=t.genre),t.year!==null&&t.year!==void 0&&(d.year=t.year),t.rating_min!==null&&t.rating_min!==void 0&&(d.rating_min=t.rating_min),t.rating_max!==null&&t.rating_max!==void 0&&(d.rating_max=t.rating_max),t.favorites_only===!0&&(d.favorites_only=!0),d},getSongsSearchOptions:()=>{const t=v(),d={q:s(),page:b(),page_size:C(),sort_by:T()||"relevance",sort_direction:A()||"desc"};return t.artist&&t.artist.trim()&&(d.artist=t.artist),t.album&&t.album.trim()&&(d.album=t.album),t.genre&&t.genre.trim()&&(d.genre=t.genre),t.year!==null&&t.year!==void 0&&(d.year=t.year),t.rating_min!==null&&t.rating_min!==void 0&&(d.rating_min=t.rating_min),t.rating_max!==null&&t.rating_max!==void 0&&(d.rating_max=t.rating_max),t.favorites_only===!0&&(d.favorites_only=!0),d},reset:()=>{i(""),m("music"),x({...J}),q(1),I(""),M(""),n(""),f("music")},hasActiveFilters:()=>{const t=v();return t.artist&&t.artist.trim()!==""||t.album&&t.album.trim()!==""||t.genre&&t.genre.trim()!==""||t.year!==null&&t.year!==void 0||t.rating_min!==null&&t.rating_min!==void 0||t.rating_max!==null&&t.rating_max!==void 0||t.favorites_only===!0},getFilterCount:()=>{const t=v();let d=0;return t.artist&&t.artist.trim()!==""&&d++,t.album&&t.album.trim()!==""&&d++,t.genre&&t.genre.trim()!==""&&d++,t.year!==null&&t.year!==void 0&&d++,t.rating_min!==null&&t.rating_min!==void 0&&d++,t.rating_max!==null&&t.rating_max!==void 0&&d++,t.favorites_only===!0&&d++,d}}}function we(e){const s=w(()=>{const l=e.searchResults(),o=e.songsResults(),r=[];return l?.results&&r.push(...l.results),o?.songs&&r.push(...o.songs),r}),i=w(()=>{const l=s(),o=e.searchState.filters();return l.filter(r=>{const h="artist"in r;return!(o.artist&&h&&r.artist&&!r.artist.toLowerCase().includes(o.artist.toLowerCase())||o.album&&h&&r.album&&!r.album.toLowerCase().includes(o.album.toLowerCase())||o.genre&&h&&r.genre&&!r.genre.toLowerCase().includes(o.genre.toLowerCase())||o.year&&h&&r.year&&r.year!==o.year||o.rating_min&&h&&r.rating&&r.rating<o.rating_min||o.rating_max&&h&&r.rating&&r.rating>o.rating_max||o.favorites_only&&h&&!r.is_favorite)})}),_=w(()=>{const l=i(),o=e.searchState.sortBy(),r=e.searchState.sortDirection();return[...l].sort((g,a)=>{let n,u;switch(o){case"title":n=g.title?.toLowerCase()||"",u=a.title?.toLowerCase()||"";break;case"artist":n=("artist"in g?g.artist?.toLowerCase():"")||"",u=("artist"in a?a.artist?.toLowerCase():"")||"";break;case"album":n=("album"in g?g.album?.toLowerCase():"")||"",u=("album"in a?a.album?.toLowerCase():"")||"";break;case"created_at":n=g.created_at?new Date(g.created_at).getTime():0,u=a.created_at?new Date(a.created_at).getTime():0;break;case"rating":n=("rating"in g?g.rating:0)||0,u=("rating"in a?a.rating:0)||0;break;case"relevance":default:return 0}return n<u?r==="asc"?-1:1:n>u?r==="asc"?1:-1:0})}),m=w(()=>_()),v=w(()=>{const l=m(),o={},r={},h={},g={};return l.forEach(a=>{const n="artist"in a;n&&a.artist&&(o[a.artist]||(o[a.artist]=[]),o[a.artist].push(a)),n&&a.album&&(r[a.album]||(r[a.album]=[]),r[a.album].push(a)),n&&a.genre&&(h[a.genre]||(h[a.genre]=[]),h[a.genre].push(a)),n&&a.year&&(g[a.year]||(g[a.year]=[]),g[a.year].push(a))}),{byArtist:o,byAlbum:r,byGenre:h,byYear:g}}),x=w(()=>{const l=e.searchResults(),o=e.songsResults(),r=e.searchState.currentPage(),h=e.searchState.pageSize(),g=l?.total_count||o?.total_count||0,a=Math.ceil(g/h);return{totalResults:g,totalPages:a,currentPage:r,hasNextPage:r<a,hasPrevPage:r>1,resultsPerPage:h}}),R=w(()=>{if(e.integrationMode!=="freqhole-integrated"||!e.webSocketItems)return m();const l=m(),o=e.webSocketItems(),r=new Set(l.map(g=>g.id)),h=o.filter(g=>!r.has(g.id));return[...l,...h]}),S=w(()=>R()),E=w(()=>m().length===0),k=w(()=>m().length>0);return{processedResults:m,integratedResults:R,searchStats:x,groupedResults:v,filteredResults:i,sortedResults:_,mergedWithWebSocket:S,isEmpty:E,hasResults:k,getResultById:l=>m().find(o=>o.id===l),getResultsByType:l=>m().filter(o=>"result_type"in o?o.result_type===l:!1)}}function Ce(e){const s=ue({initialQuery:e.initialQuery,initialDomain:e.initialDomain,enableHistory:e.enableHistory}),i=Se({apiClient:e.apiClient,initialQuery:e.initialQuery,initialDomain:e.initialDomain,debounceMs:e.debounceMs,autoSearch:e.autoSearch,onError:e.onError}),_=le({apiClient:e.apiClient,query:i.query,debounceMs:e.debounceMs,enabled:e.enableSuggestions,onError:e.onError}),m=we({searchResults:i.results,songsResults:i.songsResults,searchState:s,integrationMode:e.integrationMode,webSocketItems:e.webSocketItems}),v=async()=>{const c=s.query(),l=s.getMusicSearchOptions();c.trim()&&(s.addToHistory(c),s.setLastSearchQuery(c),s.setLastSearchDomain(s.domain())),i.setQuery(c),await i.search(l)},x=async()=>{const c=s.query(),l=s.getSongsSearchOptions();c.trim()&&(s.addToHistory(c),s.setLastSearchQuery(c),s.setLastSearchDomain(s.domain())),i.setQuery(c),await i.searchSongs(l)},R=()=>{i.clearResults(),_.clearSuggestions(),s.setQuery(""),s.setCurrentPage(1)},S=w(()=>i.loading()||_.loading()||s.query().trim().length>0),E=w(()=>i.hasResults()||m.hasResults()),k=w(()=>m.searchStats().totalResults),D=w(()=>i.canSearch()&&!i.loading());return{state:s,search:i,suggestions:_,data:m,performSearch:v,performSongsSearch:x,clearAll:R,isActive:S,hasAnyResults:E,totalResultsCount:k,canPerformSearch:D}}var Re=V(`<div><div class=search-box__container><input type=text class=search-box__input autocomplete=off></div><style>
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
      `),ke=V("<button class=search-box__button type=button>");function Ue(e){const s=e.useInternalState!==!1,i=s?ue({}):null,[_,m]=y(),[v,x]=y(),R=()=>s&&i?i.query():e.query||"",S=c=>{if(s&&i?i.setQuery(c):e.onQueryChange?.(c),e.autoSearch&&c.trim()){const l=v();l&&clearTimeout(l);const o=setTimeout(()=>{e.onSearch?.(c.trim())},e.debounceMs||300);x(o)}},E=c=>{const l=c.currentTarget.value;S(l)},k=c=>{switch(c.key){case"Enter":c.preventDefault();const l=R().trim();l&&(e.onSearch?.(l),_()?.blur());break;case"Escape":_()?.blur();break}},D=()=>{const c=R().trim();c&&(e.onSearch?.(c),_()?.blur())};return oe(()=>()=>{const c=v();c&&clearTimeout(c)}),(()=>{var c=Re(),l=c.firstChild,o=l.firstChild;return o.$$keydown=k,o.$$input=E,ie(m,o),H(l,(()=>{var r=ce(()=>!!e.showSearchButton);return()=>r()&&(()=>{var h=ke();return h.$$click=D,H(h,()=>e.searchButtonText||"Search"),Y(()=>h.disabled=e.disabled||!R().trim()),h})()})(),null),Y(r=>{var h=`search-box ${e.class||""}`,g=e.placeholder||"Search...",a=e.disabled;return h!==r.e&&Z(c,r.e=h),g!==r.t&&ee(o,"placeholder",r.t=g),a!==r.a&&(o.disabled=r.a=a),r},{e:void 0,t:void 0,a:void 0}),Y(()=>o.value=R()),c})()}ae(["input","keydown","click"]);var qe=V("<div class=search-suggestions__loading>Loading suggestions..."),Ee=V(`<div role=listbox aria-label="Search suggestions"><style>
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
        `),De=V("<div class=search-suggestions__group><div class=search-suggestions__group-header>"),Le=V("<div role=option><span class=search-suggestions__text>");function pe(e){const s=e.useInternalSuggestions!==!1,i=s&&e.apiClient?le({apiClient:e.apiClient,query:()=>e.query,debounceMs:e.debounceMs||300,enabled:e.show!==!1}):null,[_,m]=y(-1),[v,x]=y(),[R,S]=y(!0),E=()=>s&&i?i.suggestions():e.suggestions||[],k=()=>s&&i?i.loading():e.loading||!1,D=()=>{const n=e.query.toLowerCase().trim();return n?E().filter(f=>{const b=typeof f=="string"?f:f.text;return b.toLowerCase().includes(n)&&b.toLowerCase()!==n}).slice(0,e.maxSuggestions||10):[]},c=()=>{const n=D(),u=new Map;n.forEach(b=>{const q=typeof b=="string"?"general":b.category||"general";u.has(q)||u.set(q,[]),u.get(q).push(b)});const f=["word","title","playlist","general"];return Array.from(u.entries()).sort(([b],[q])=>{const C=f.indexOf(b),L=f.indexOf(q),T=C===-1?f.length:C,I=L===-1?f.length:L;return T-I})},l=n=>({word:"Search suggestions",title:"Songs",playlist:"Playlists",general:"Suggestions"})[n]||n.charAt(0).toUpperCase()+n.slice(1),o=()=>e.show===!1||!e.query.trim()||!R()?!1:D().length>0||k()&&e.showLoading,r=()=>c().reduce((n,[u,f])=>n.concat(f),[]),h=n=>{e.onSuggestionSelect?.(n),m(-1),S(!1),e.onBlur?.()},g=n=>{const u=r();switch(n.key){case"ArrowDown":n.preventDefault(),u.length>0&&m(f=>f<u.length-1?f+1:0);break;case"ArrowUp":n.preventDefault(),u.length>0&&m(f=>f>0?f-1:u.length-1);break;case"Enter":if(n.preventDefault(),_()>=0&&_()<u.length){const f=u[_()];if(f){const b=typeof f=="string"?f:f.text;h(b)}}else S(!1),e.onBlur?.();break;case"Escape":m(-1),S(!1),e.onBlur?.();break}};N(()=>{const n=r();n.length===0?m(-1):_()>=n.length&&m(n.length-1)}),N(()=>{const n=e.query.trim();S(!!n)});const a=n=>{const u=v();u&&!u.contains(n.target)&&(S(!1),e.onBlur?.())};return oe(()=>{document.addEventListener("keydown",g),document.addEventListener("mousedown",a)}),he(()=>{document.removeEventListener("keydown",g),document.removeEventListener("mousedown",a)}),B(X,{get when(){return o()},get children(){var n=Ee(),u=n.firstChild;return ie(x,n),H(n,B(X,{get when(){return k()&&e.showLoading},get children(){return qe()}}),u),H(n,B(X,{get when(){return ce(()=>!k())()&&D().length>0},get children(){return B(ne,{get each(){return c()},children:([f,b])=>{const C=r().findIndex(L=>b.includes(L));return(()=>{var L=De(),T=L.firstChild;return H(T,()=>l(f)),H(L,B(ne,{each:b,children:(I,A)=>{const M=C+A(),U=typeof I=="string"?I:I.text;return(()=>{var $=Le(),te=$.firstChild;return $.$$click=()=>h(U),ee($,"data-suggestion",U),H(te,U),Y(Q=>{var G=`search-suggestions__item ${M===_()?"search-suggestions__item--selected":""}`,K=M===_();return G!==Q.e&&Z($,Q.e=G),K!==Q.t&&ee($,"aria-selected",Q.t=K),Q},{e:void 0,t:void 0}),$})()}}),null),L})()}})}}),u),Y(()=>Z(n,`search-suggestions ${e.class||""} search-suggestions--${e.position||"bottom"}`)),n}})}ae(["click"]);const ge=fe();function Ge(e){const i={...Ce({apiClient:e.apiClient,initialQuery:e.searchOptions?.initialQuery||"",initialDomain:e.searchOptions?.initialDomain||"music",enableHistory:e.searchOptions?.enableHistory??!0,enableSuggestions:e.searchOptions?.enableSuggestions??!0,debounceMs:e.searchOptions?.debounceMs||300,autoSearch:e.searchOptions?.autoSearch??!1,integrationMode:e.searchOptions?.integrationMode||"standalone",webSocketItems:e.searchOptions?.webSocketItems,onError:e.searchOptions?.onError}),apiClient:e.apiClient};return B(ge.Provider,{value:i,get children(){return e.children}})}function Ke(){const e=me(ge);if(!e)throw new Error("useSearchContext must be used within a SearchProvider");return e}export{We as A,Be as F,ze as G,Ge as S,Ne as Y,Ve as a,Ke as b,Ue as c,pe as d,Ye as t,ue as u};
//# sourceMappingURL=SearchContext-D86RNZN3.js.map
