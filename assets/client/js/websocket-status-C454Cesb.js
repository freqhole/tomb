import{c as E,g as T,t as l,k as o,i as m,b as p,e as b,m as f,S as x}from"./web-WRO-G0Y6.js";import{c as D}from"./index-CAM_Dine.js";import{C as s}from"./websocket-client-BuXzrKNy.js";var P=l("<span>"),U=l("<span class=user-count>(<!> user<!>)"),z=l(`<div><style>
        .status-indicator {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1px solid rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
          position: relative;
        }

        .status-indicator.disconnected {
          background-color: #ef4444;
          box-shadow: 0 0 4px rgba(239, 68, 68, 0.3);
        }

        .status-indicator.connecting {
          background-color: #f59e0b;
          box-shadow: 0 0 4px rgba(245, 158, 11, 0.3);
          animation: pulse 1.5s infinite;
        }

        .status-indicator.connected {
          background-color: #10b981;
          box-shadow: 0 0 4px rgba(16, 185, 129, 0.3);
        }

        .status-indicator.error {
          background-color: #dc2626;
          box-shadow: 0 0 4px rgba(220, 38, 38, 0.5);
          animation: blink 1s infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }

        @keyframes blink {
          0%, 50% {
            opacity: 1;
          }
          51%, 100% {
            opacity: 0.3;
          }
        }

        .status-text {
          color: #374151;
          font-weight: 500;
        }

        .status-text.disconnected {
          color: #dc2626;
        }

        .status-text.connecting {
          color: #d97706;
        }

        .status-text.connected {
          color: #059669;
        }

        .status-text.error {
          color: #dc2626;
        }

        .user-count {
          color: #6b7280;
          font-size: 12px;
          margin-left: 4px;
        }
      </style><div>`);const I=n=>{const[h,y]=E(Date.now()),a=()=>n.status??s.Disconnected,w=()=>n.showText??!0,c=()=>n.userCount??0,C=()=>n.showUserCount??!1,u=()=>n.compact??!1;T(()=>{const t=a();y(Date.now());const i=new CustomEvent("status-change",{detail:{status:t,timestamp:h()},bubbles:!0});setTimeout(()=>{const r=document.querySelector("websocket-status");r&&r.dispatchEvent(i)},0)});const S=()=>{switch(a()){case s.Disconnected:return"Offline";case s.Connecting:return"Connecting...";case s.Connected:return"Online";case s.Error:return"Connection Error";default:return"Unknown"}},k=()=>`status-indicator ${a()}`,$=()=>`status-text ${a()}`;return(()=>{var t=z(),i=t.firstChild,r=i.nextSibling;return t.style.setProperty("display","inline-flex"),t.style.setProperty("align-items","center"),t.style.setProperty("gap","8px"),t.style.setProperty("font-family",'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'),t.style.setProperty("font-size","14px"),o(t,m(x,{get when(){return f(()=>!!w())()&&!u()},get children(){var e=P();return o(e,S),p(()=>b(e,$())),e}}),null),o(t,m(x,{get when(){return f(()=>!!(C()&&c()>0))()&&!u()},get children(){var e=U(),_=e.firstChild,d=_.nextSibling,v=d.nextSibling,g=v.nextSibling;return g.nextSibling,o(e,c,d),o(e,()=>c()!==1?"s":"",g),e}}),null),p(()=>b(r,k())),t})()};D("websocket-status",{status:s.Disconnected,showText:!0,userCount:0,showUserCount:!1,compact:!1},I);export{I as W};
//# sourceMappingURL=websocket-status-C454Cesb.js.map
