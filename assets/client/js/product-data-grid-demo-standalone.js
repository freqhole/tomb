import{r as S,f as y,c as u,k as w,t as c,i as n,b as f,e as P,s as b}from"./web-2xXXrb5V.js";import{G as _}from"./generic-infinite-grid-CrWI89bp.js";var G=c('<code style="font-size:12px;background:#333;padding:2px 4px;border-radius:3px;">'),M=c("<span style=color:#10b981;font-weight:600;>$"),k=c("<span>"),C=c("<span><span style=margin-left:4px;font-size:12px;color:#888;>"),v=c(`<div class=product-data-grid-demo><style>
        .product-data-grid-demo {
          height: 100vh;
          background: #1a1a1a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          flex-direction: column;
        }

        .demo-header {
          background: #2a2a2a;
          padding: 20px;
          border-bottom: 1px solid #3a3a3a;
        }

        .demo-header h1 {
          margin: 0 0 8px 0;
          font-size: 24px;
          font-weight: 700;
          color: #0070f3;
        }

        .demo-header p {
          margin: 0;
          font-size: 14px;
          color: #b0b0b0;
        }

        .grid-container {
          flex: 1;
          overflow: hidden;
        }
      </style><div class=grid-container>`);console.log("🚀 Product Data Grid Demo script loading");function E(d){const s=["Electronics","Clothing","Books","Home & Garden","Sports","Toys","Beauty","Automotive"],l=["Premium","Deluxe","Essential","Professional","Classic","Modern","Vintage","Smart"],i=["Widget","Gadget","Tool","Device","Kit","Set","Pack","Bundle"];return Array.from({length:d},(g,o)=>({id:o+1,name:`${l[o%l.length]} ${i[o%i.length]} ${Math.floor(o/10)+1}`,category:s[o%s.length],price:Math.round((Math.random()*500+10)*100)/100,stock:Math.floor(Math.random()*100),sku:`SKU-${String(o+1).padStart(6,"0")}`,description:`High-quality ${i[o%i.length].toLowerCase()} with premium features and excellent performance.`,rating:Math.round((Math.random()*2+3)*10)/10,inStock:Math.random()>.2}))}function F(){console.log("📦 ProductDataGridDemo component created");const[d]=u(E(5e3)),[s,l]=u("id"),[i,g]=u("asc"),o=w(()=>{const r=s(),t=i();return[...d()].sort((a,$)=>{const p=a[r],h=$[r];let m=0;return p<h&&(m=-1),p>h&&(m=1),t==="desc"?-m:m})}),D=[{key:"id",title:"ID",width:80,sortable:!0},{key:"sku",title:"SKU",width:120,sortable:!0,render:(r,t)=>(()=>{var e=G();return n(e,t),e})()},{key:"name",title:"Product Name",sortable:!0},{key:"category",title:"Category",width:120,sortable:!0},{key:"price",title:"Price",width:100,sortable:!0,render:(r,t)=>(()=>{var e=M();return e.firstChild,n(e,()=>t.toFixed(2),null),e})()},{key:"stock",title:"Stock",width:80,sortable:!0,render:(r,t)=>(()=>{var e=k();return n(e,t),f(a=>b(e,`color: ${t>20?"#10b981":t>5?"#f59e0b":"#ef4444"}`,a)),e})()},{key:"rating",title:"Rating",width:100,sortable:!0,render:(r,t)=>(()=>{var e=C(),a=e.firstChild;return n(e,()=>"★".repeat(Math.floor(t)),a),n(e,()=>"☆".repeat(5-Math.floor(t)),a),n(a,t),e})()},{key:"inStock",title:"Status",width:100,sortable:!0,render:(r,t)=>(()=>{var e=k();return P(e,`status-badge ${t?"status-in-stock":"status-out-of-stock"}`),n(e,t?"In Stock":"Out of Stock"),f(a=>b(e,`
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            ${t?"background: #10b981; color: white;":"background: #ef4444; color: white;"}
          `,a)),e})()}],x=(r,t)=>{l(r),g(t)};return(()=>{var r=v(),t=r.firstChild,e=t.nextSibling;return n(e,y(_,{get data(){return o()},columns:D,onSort:x,get sortField(){return s()},get sortDirection(){return i()},rowHeight:50,headerHeight:60,theme:"dark"})),r})()}class z extends HTMLElement{dispose;connectedCallback(){console.log("🔌 ProductDataGridDemoElement connected");try{this.dispose=S(()=>y(F,{}),this),console.log("✅ Product Data Grid Demo render successful")}catch(s){console.error("❌ Product Data Grid Demo render failed:",s)}}disconnectedCallback(){console.log("🔌 ProductDataGridDemoElement disconnected"),this.dispose&&this.dispose()}}console.log("📝 About to register product-data-grid-demo custom element");try{customElements.define("product-data-grid-demo",z),console.log("✅ Product Data Grid Demo custom element registered successfully")}catch(d){console.error("❌ Failed to register product-data-grid-demo custom element:",d)}
//# sourceMappingURL=product-data-grid-demo.js.map
