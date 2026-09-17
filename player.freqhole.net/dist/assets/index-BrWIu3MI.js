(async ()=>{
    (function() {
        const t = document.createElement("link").relList;
        if (t && t.supports && t.supports("modulepreload")) return;
        for (const o of document.querySelectorAll('link[rel="modulepreload"]'))r(o);
        new MutationObserver((o)=>{
            for (const i of o)if (i.type === "childList") for (const s of i.addedNodes)s.tagName === "LINK" && s.rel === "modulepreload" && r(s);
        }).observe(document, {
            childList: !0,
            subtree: !0
        });
        function n(o) {
            const i = {};
            return o.integrity && (i.integrity = o.integrity), o.referrerPolicy && (i.referrerPolicy = o.referrerPolicy), o.crossOrigin === "use-credentials" ? i.credentials = "include" : o.crossOrigin === "anonymous" ? i.credentials = "omit" : i.credentials = "same-origin", i;
        }
        function r(o) {
            if (o.ep) return;
            o.ep = !0;
            const i = n(o);
            fetch(o.href, i);
        }
    })();
    const ya = !1, va = (e, t)=>e === t, ka = Symbol("solid-track"), Qt = {
        equals: va
    };
    let Ki = Qi;
    const Ae = 1, Xt = 2, Wi = {
        owned: null,
        cleanups: null,
        context: null,
        owner: null
    }, In = {};
    var K = null;
    let On = null, Ea = null, q = null, ae = null, Se = null, fn = 0;
    function Wt(e, t) {
        const n = q, r = K, o = e.length === 0, i = t === void 0 ? r : t, s = o ? Wi : {
            owned: null,
            cleanups: null,
            context: i ? i.context : null,
            owner: i
        }, a = o ? e : ()=>e(()=>$e(()=>St(s)));
        K = s, q = null;
        try {
            return xe(a, !0);
        } finally{
            q = n, K = r;
        }
    }
    function W(e, t) {
        t = t ? Object.assign({}, Qt, t) : Qt;
        const n = {
            value: e,
            observers: null,
            observerSlots: null,
            comparator: t.equals || void 0
        }, r = (o)=>(typeof o == "function" && (o = o(n.value)), Yi(n, o));
        return [
            Gi.bind(n),
            r
        ];
    }
    function Sa(e, t, n) {
        const r = dn(e, t, !0, Ae);
        ct(r);
    }
    function Pe(e, t, n) {
        const r = dn(e, t, !1, Ae);
        ct(r);
    }
    function $a(e, t, n) {
        Ki = Pa;
        const r = dn(e, t, !1, Ae);
        r.user = !0, Se ? Se.push(r) : ct(r);
    }
    function nt(e, t, n) {
        n = n ? Object.assign({}, Qt, n) : Qt;
        const r = dn(e, t, !0, 0);
        return r.observers = null, r.observerSlots = null, r.comparator = n.equals || void 0, ct(r), Gi.bind(r);
    }
    function Aa(e) {
        return e && typeof e == "object" && "then" in e;
    }
    function en(e, t, n) {
        let r, o, i;
        typeof t == "function" ? (r = e, o = t, i = {}) : (r = !0, o = e, i = t || {});
        let s = null, a = In, c = !1, u = "initialValue" in i, _ = typeof r == "function" && nt(r);
        const f = new Set, [d, g] = (i.storage || W)(i.initialValue), [b, y] = W(void 0), [z, k] = W(void 0, {
            equals: !1
        }), [O, I] = W(u ? "ready" : "unresolved");
        K && Hi(()=>{
            for (const v of f.keys())v.decrement();
            f.clear(), s = null;
        });
        function S(v, E, C, $) {
            return s === v && (s = null, $ !== void 0 && (u = !0), (v === a || E === a) && i.onHydrated && queueMicrotask(()=>i.onHydrated($, {
                    value: E
                })), a = In, M(E, C)), E;
        }
        function M(v, E) {
            xe(()=>{
                E === void 0 && g(()=>v), I(E !== void 0 ? "errored" : u ? "ready" : "unresolved"), y(E);
                for (const C of f.keys())C.decrement();
                f.clear();
            }, !1);
        }
        function w() {
            const v = Oa, E = d(), C = b();
            if (C !== void 0 && !s) throw C;
            return q && q.user, E;
        }
        function A(v = !0) {
            if (v !== !1 && c) return;
            c = !1;
            const E = _ ? _() : r;
            if (E == null || E === !1) {
                S(s, $e(d));
                return;
            }
            let C;
            const $ = a !== In ? a : $e(()=>{
                try {
                    return o(E, {
                        value: d(),
                        refetching: v
                    });
                } catch (P) {
                    C = P;
                }
            });
            if (C !== void 0) {
                S(s, void 0, Ht(C), E);
                return;
            } else if (!Aa($)) return S(s, $, void 0, E), $;
            return s = $, "v" in $ ? ($.s === 1 ? S(s, $.v, void 0, E) : S(s, void 0, Ht($.v), E), $) : (c = !0, queueMicrotask(()=>c = !1), xe(()=>{
                I(u ? "refreshing" : "pending"), k();
            }, !1), $.then((P)=>S($, P, void 0, E), (P)=>S($, void 0, Ht(P), E)));
        }
        Object.defineProperties(w, {
            state: {
                get: ()=>O()
            },
            error: {
                get: ()=>b()
            },
            loading: {
                get () {
                    const v = O();
                    return v === "pending" || v === "refreshing";
                }
            },
            latest: {
                get () {
                    if (!u) return w();
                    const v = b();
                    if (v && !s) throw v;
                    return d();
                }
            }
        });
        let N = K;
        return _ ? Sa(()=>(N = K, A(!1))) : A(!1), [
            w,
            {
                refetch: (v)=>Ia(N, ()=>A(v)),
                mutate: g
            }
        ];
    }
    function $e(e) {
        if (q === null) return e();
        const t = q;
        q = null;
        try {
            return e();
        } finally{
            q = t;
        }
    }
    function za(e) {
        $a(()=>$e(e));
    }
    function Hi(e) {
        return K === null || (K.cleanups === null ? K.cleanups = [
            e
        ] : K.cleanups.push(e)), e;
    }
    function Ia(e, t) {
        const n = K, r = q;
        K = e, q = null;
        try {
            return xe(t, !0);
        } catch (o) {
            Rr(o);
        } finally{
            K = n, q = r;
        }
    }
    const [Ry, Dy] = W(!1);
    let Oa;
    function Gi() {
        if (this.sources && this.state) if (this.state === Ae) ct(this);
        else {
            const e = ae;
            ae = null, xe(()=>nn(this), !1), ae = e;
        }
        if (q) {
            const e = this.observers;
            if (!e || e[e.length - 1] !== q) {
                const t = e ? e.length : 0;
                q.sources ? (q.sources.push(this), q.sourceSlots.push(t)) : (q.sources = [
                    this
                ], q.sourceSlots = [
                    t
                ]), e ? (e.push(q), this.observerSlots.push(q.sources.length - 1)) : (this.observers = [
                    q
                ], this.observerSlots = [
                    q.sources.length - 1
                ]);
            }
        }
        return this.value;
    }
    function Yi(e, t, n) {
        let r = e.value;
        return (!e.comparator || !e.comparator(r, t)) && (e.value = t, e.observers && e.observers.length && xe(()=>{
            for(let o = 0; o < e.observers.length; o += 1){
                const i = e.observers[o], s = On && On.running;
                s && On.disposed.has(i), (s ? !i.tState : !i.state) && (i.pure ? ae.push(i) : Se.push(i), i.observers && Xi(i)), s || (i.state = Ae);
            }
            if (ae.length > 1e6) throw ae = [], new Error;
        }, !1)), t;
    }
    function ct(e) {
        if (!e.fn) return;
        St(e);
        const t = fn;
        Ca(e, e.value, t);
    }
    function Ca(e, t, n) {
        let r;
        const o = K, i = q;
        q = K = e;
        try {
            r = e.fn(t);
        } catch (s) {
            return e.pure && (e.state = Ae, e.owned && e.owned.forEach(St), e.owned = null), e.updatedAt = n + 1, Rr(s);
        } finally{
            q = i, K = o;
        }
        (!e.updatedAt || e.updatedAt <= n) && (e.updatedAt != null && "observers" in e ? Yi(e, r) : e.value = r, e.updatedAt = n);
    }
    function dn(e, t, n, r = Ae, o) {
        const i = {
            fn: e,
            state: r,
            updatedAt: null,
            owned: null,
            sources: null,
            sourceSlots: null,
            cleanups: null,
            value: t,
            owner: K,
            context: K ? K.context : null,
            pure: n
        };
        return K === null || K !== Wi && (K.owned ? K.owned.push(i) : K.owned = [
            i
        ]), i;
    }
    function tn(e) {
        if (e.state === 0) return;
        if (e.state === Xt) return nn(e);
        if (e.suspense && $e(e.suspense.inFallback)) return e.suspense.effects.push(e);
        const t = [
            e
        ];
        for(; (e = e.owner) && (!e.updatedAt || e.updatedAt < fn);)e.state && t.push(e);
        for(let n = t.length - 1; n >= 0; n--)if (e = t[n], e.state === Ae) ct(e);
        else if (e.state === Xt) {
            const r = ae;
            ae = null, xe(()=>nn(e, t[0]), !1), ae = r;
        }
    }
    function xe(e, t) {
        if (ae) return e();
        let n = !1;
        t || (ae = []), Se ? n = !0 : Se = [], fn++;
        try {
            const r = e();
            return Ta(n), r;
        } catch (r) {
            n || (Se = null), ae = null, Rr(r);
        }
    }
    function Ta(e) {
        if (ae && (Qi(ae), ae = null), e) return;
        const t = Se;
        Se = null, t.length && xe(()=>Ki(t), !1);
    }
    function Qi(e) {
        for(let t = 0; t < e.length; t++)tn(e[t]);
    }
    function Pa(e) {
        let t, n = 0;
        for(t = 0; t < e.length; t++){
            const r = e[t];
            r.user ? e[n++] = r : tn(r);
        }
        for(t = 0; t < n; t++)tn(e[t]);
    }
    function nn(e, t) {
        e.state = 0;
        for(let n = 0; n < e.sources.length; n += 1){
            const r = e.sources[n];
            if (r.sources) {
                const o = r.state;
                o === Ae ? r !== t && (!r.updatedAt || r.updatedAt < fn) && tn(r) : o === Xt && nn(r, t);
            }
        }
    }
    function Xi(e) {
        for(let t = 0; t < e.observers.length; t += 1){
            const n = e.observers[t];
            n.state || (n.state = Xt, n.pure ? ae.push(n) : Se.push(n), n.observers && Xi(n));
        }
    }
    function St(e) {
        let t;
        if (e.sources) for(; e.sources.length;){
            const n = e.sources.pop(), r = e.sourceSlots.pop(), o = n.observers;
            if (o && o.length) {
                const i = o.pop(), s = n.observerSlots.pop();
                r < o.length && (i.sourceSlots[s] = r, o[r] = i, n.observerSlots[r] = s);
            }
        }
        if (e.tOwned) {
            for(t = e.tOwned.length - 1; t >= 0; t--)St(e.tOwned[t]);
            delete e.tOwned;
        }
        if (e.owned) {
            for(t = e.owned.length - 1; t >= 0; t--)St(e.owned[t]);
            e.owned = null;
        }
        if (e.cleanups) {
            for(t = e.cleanups.length - 1; t >= 0; t--)e.cleanups[t]();
            e.cleanups = null;
        }
        e.state = 0;
    }
    function Ht(e) {
        return e instanceof Error ? e : new Error(typeof e == "string" ? e : "Unknown error", {
            cause: e
        });
    }
    function Rr(e, t = K) {
        throw Ht(e);
    }
    const Na = Symbol("fallback");
    function so(e) {
        for(let t = 0; t < e.length; t++)e[t]();
    }
    function xa(e, t, n = {}) {
        let r = [], o = [], i = [], s = 0, a = t.length > 1 ? [] : null;
        return Hi(()=>so(i)), ()=>{
            let c = e() || [], u = c.length, _, f;
            return c[ka], $e(()=>{
                let g, b, y, z, k, O, I, S, M;
                if (u === 0) s !== 0 && (so(i), i = [], r = [], o = [], s = 0, a && (a = [])), n.fallback && (r = [
                    Na
                ], o[0] = Wt((w)=>(i[0] = w, n.fallback())), s = 1);
                else if (s === 0) {
                    for(o = new Array(u), f = 0; f < u; f++)r[f] = c[f], o[f] = Wt(d);
                    s = u;
                } else {
                    for(y = new Array(u), z = new Array(u), a && (k = new Array(u)), O = 0, I = Math.min(s, u); O < I && r[O] === c[O]; O++);
                    for(I = s - 1, S = u - 1; I >= O && S >= O && r[I] === c[S]; I--, S--)y[S] = o[I], z[S] = i[I], a && (k[S] = a[I]);
                    for(g = new Map, b = new Array(S + 1), f = S; f >= O; f--)M = c[f], _ = g.get(M), b[f] = _ === void 0 ? -1 : _, g.set(M, f);
                    for(_ = O; _ <= I; _++)M = r[_], f = g.get(M), f !== void 0 && f !== -1 ? (y[f] = o[_], z[f] = i[_], a && (k[f] = a[_]), f = b[f], g.set(M, f)) : i[_]();
                    for(f = O; f < u; f++)f in y ? (o[f] = y[f], i[f] = z[f], a && (a[f] = k[f], a[f](f))) : o[f] = Wt(d);
                    o = o.slice(0, s = u), r = c.slice(0);
                }
                return o;
            });
            function d(g) {
                if (i[f] = g, a) {
                    const [b, y] = W(f);
                    return a[f] = y, t(c[f], b);
                }
                return t(c[f]);
            }
        };
    }
    function L(e, t) {
        return $e(()=>e(t || {}));
    }
    const Ra = (e)=>`Stale read from <${e}>.`;
    function hr(e) {
        const t = "fallback" in e && {
            fallback: ()=>e.fallback
        };
        return nt(xa(()=>e.each, e.children, t || void 0));
    }
    function H(e) {
        const t = e.keyed, n = nt(()=>e.when, void 0, void 0), r = t ? n : nt(n, void 0, {
            equals: (o, i)=>!o == !i
        });
        return nt(()=>{
            const o = r();
            if (o) {
                const i = e.children;
                return typeof i == "function" && i.length > 0 ? $e(()=>i(t ? o : ()=>{
                        if (!$e(r)) throw Ra("Show");
                        return n();
                    })) : i;
            }
            return e.fallback;
        }, void 0, void 0);
    }
    const Gt = (e)=>nt(()=>e());
    function Da(e, t, n) {
        let r = n.length, o = t.length, i = r, s = 0, a = 0, c = t[o - 1].nextSibling, u = null;
        for(; s < o || a < i;){
            if (t[s] === n[a]) {
                s++, a++;
                continue;
            }
            for(; t[o - 1] === n[i - 1];)o--, i--;
            if (o === s) {
                const _ = i < r ? a ? n[a - 1].nextSibling : n[i - a] : c;
                for(; a < i;)e.insertBefore(n[a++], _);
            } else if (i === a) for(; s < o;)(!u || !u.has(t[s])) && t[s].remove(), s++;
            else if (t[s] === n[i - 1] && n[a] === t[o - 1]) {
                const _ = t[--o].nextSibling;
                e.insertBefore(n[a++], t[s++].nextSibling), e.insertBefore(n[--i], _), t[o] = n[i];
            } else {
                if (!u) {
                    u = new Map;
                    let f = a;
                    for(; f < i;)u.set(n[f], f++);
                }
                const _ = u.get(t[s]);
                if (_ != null) if (a < _ && _ < i) {
                    let f = s, d = 1, g;
                    for(; ++f < o && f < i && !((g = u.get(t[f])) == null || g !== _ + d);)d++;
                    if (d > _ - a) {
                        const b = t[s];
                        for(; a < _;)e.insertBefore(n[a++], b);
                    } else e.replaceChild(n[a++], t[s++]);
                } else s++;
                else t[s++].remove();
            }
        }
    }
    const ao = "_$DX_DELEGATE";
    function Ma(e, t, n, r = {}) {
        let o;
        return Wt((i)=>{
            o = i, t === document ? e() : Z(t, e(), t.firstChild ? null : void 0, n);
        }, r.owner), ()=>{
            o(), t.textContent = "";
        };
    }
    function J(e, t, n, r) {
        let o;
        const i = ()=>{
            const a = document.createElement("template");
            return a.innerHTML = e, a.content.firstChild;
        }, s = ()=>(o || (o = i())).cloneNode(!0);
        return s.cloneNode = s, s;
    }
    function es(e, t = window.document) {
        const n = t[ao] || (t[ao] = new Set);
        for(let r = 0, o = e.length; r < o; r++){
            const i = e[r];
            n.has(i) || (n.add(i), t.addEventListener(i, Za));
        }
    }
    function co(e, t, n) {
        n == null ? e.removeAttribute(t) : e.setAttribute(t, n);
    }
    function Z(e, t, n, r) {
        if (n !== void 0 && !r && (r = []), typeof t != "function") return rn(e, t, r, n);
        Pe((o)=>rn(e, t(), o, n), r);
    }
    function Za(e) {
        let t = e.target;
        const n = `$$${e.type}`, r = e.target, o = e.currentTarget, i = (c)=>Object.defineProperty(e, "target", {
                configurable: !0,
                value: c
            }), s = ()=>{
            const c = t[n];
            if (c && !t.disabled) {
                const u = t[`${n}Data`];
                if (u !== void 0 ? c.call(t, u, e) : c.call(t, e), e.cancelBubble) return;
            }
            return t.host && typeof t.host != "string" && !t.host._$host && t.contains(e.target) && i(t.host), !0;
        }, a = ()=>{
            for(; s() && (t = t._$host || t.parentNode || t.host););
        };
        if (Object.defineProperty(e, "currentTarget", {
            configurable: !0,
            get () {
                return t || document;
            }
        }), e.composedPath) {
            const c = e.composedPath();
            i(c[0]);
            for(let u = 0; u < c.length - 2 && (t = c[u], !!s()); u++){
                if (t._$host) {
                    t = t._$host, a();
                    break;
                }
                if (t.parentNode === o) break;
            }
        } else a();
        i(r);
    }
    function rn(e, t, n, r, o) {
        for(; typeof n == "function";)n = n();
        if (t === n) return n;
        const i = typeof t, s = r !== void 0;
        if (e = s && n[0] && n[0].parentNode || e, i === "string" || i === "number") {
            if (i === "number" && (t = t.toString(), t === n)) return n;
            if (s) {
                let a = n[0];
                a && a.nodeType === 3 ? a.data !== t && (a.data = t) : a = document.createTextNode(t), n = Qe(e, n, r, a);
            } else n !== "" && typeof n == "string" ? n = e.firstChild.data = t : n = e.textContent = t;
        } else if (t == null || i === "boolean") n = Qe(e, n, r);
        else {
            if (i === "function") return Pe(()=>{
                let a = t();
                for(; typeof a == "function";)a = a();
                n = rn(e, a, n, r);
            }), ()=>n;
            if (Array.isArray(t)) {
                const a = [], c = n && Array.isArray(n);
                if (br(a, t, n, o)) return Pe(()=>n = rn(e, a, n, r, !0)), ()=>n;
                if (a.length === 0) {
                    if (n = Qe(e, n, r), s) return n;
                } else c ? n.length === 0 ? uo(e, a, r) : Da(e, n, a) : (n && Qe(e), uo(e, a));
                n = a;
            } else if (t.nodeType) {
                if (Array.isArray(n)) {
                    if (s) return n = Qe(e, n, r, t);
                    Qe(e, n, null, t);
                } else n == null || n === "" || !e.firstChild ? e.appendChild(t) : e.replaceChild(t, e.firstChild);
                n = t;
            }
        }
        return n;
    }
    function br(e, t, n, r) {
        let o = !1;
        for(let i = 0, s = t.length; i < s; i++){
            let a = t[i], c = n && n[e.length], u;
            if (!(a == null || a === !0 || a === !1)) if ((u = typeof a) == "object" && a.nodeType) e.push(a);
            else if (Array.isArray(a)) o = br(e, a, c) || o;
            else if (u === "function") if (r) {
                for(; typeof a == "function";)a = a();
                o = br(e, Array.isArray(a) ? a : [
                    a
                ], Array.isArray(c) ? c : [
                    c
                ]) || o;
            } else e.push(a), o = !0;
            else {
                const _ = String(a);
                c && c.nodeType === 3 && c.data === _ ? e.push(c) : e.push(document.createTextNode(_));
            }
        }
        return o;
    }
    function uo(e, t, n = null) {
        for(let r = 0, o = t.length; r < o; r++)e.insertBefore(t[r], n);
    }
    function Qe(e, t, n, r) {
        if (n === void 0) return e.textContent = "";
        const o = r || document.createTextNode("");
        if (t.length) {
            let i = !1;
            for(let s = t.length - 1; s >= 0; s--){
                const a = t[s];
                if (o !== a) {
                    const c = a.parentNode === e;
                    !i && !s ? c ? e.replaceChild(o, a) : e.insertBefore(o, n) : c && a.remove();
                } else i = !0;
            }
        } else e.insertBefore(o, n);
        return [
            o
        ];
    }
    const Ba = "/assets/midden_bg-BKrGk6tl.wasm", ja = async (e = {}, t)=>{
        let n;
        if (t.startsWith("data:")) {
            const r = t.replace(/^data:.*?base64,/, "");
            let o;
            if (typeof Buffer == "function" && typeof Buffer.from == "function") o = Buffer.from(r, "base64");
            else if (typeof atob == "function") {
                const i = atob(r);
                o = new Uint8Array(i.length);
                for(let s = 0; s < i.length; s++)o[s] = i.charCodeAt(s);
            } else throw new Error("Cannot decode base64-encoded data URL");
            n = await WebAssembly.instantiate(o, e);
        } else {
            const r = await fetch(t), o = r.headers.get("Content-Type") || "";
            if ("instantiateStreaming" in WebAssembly && o.startsWith("application/wasm")) n = await WebAssembly.instantiateStreaming(r, e);
            else {
                const i = await r.arrayBuffer();
                n = await WebAssembly.instantiate(i, e);
            }
        }
        return n.instance.exports;
    };
    class $t {
        constructor(){
            throw new Error("cannot invoke `new` directly");
        }
        static __wrap(t) {
            const n = Object.create($t.prototype);
            return n.__wbg_ptr = t, _o.register(n, n.__wbg_ptr, n), n;
        }
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, _o.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_bistream_free(t, 0);
        }
        alpn() {
            let t, n;
            try {
                if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
                m(this.__wbg_ptr);
                const r = l.bistream_alpn(this.__wbg_ptr);
                return t = r[0], n = r[1], Y(r[0], r[1]);
            } finally{
                l.__wbindgen_free(t, n, 1);
            }
        }
        close() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), l.bistream_close(this.__wbg_ptr);
        }
        peer_node_id() {
            let t, n;
            try {
                if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
                m(this.__wbg_ptr);
                const r = l.bistream_peer_node_id(this.__wbg_ptr);
                return t = r[0], n = r[1], Y(r[0], r[1]);
            } finally{
                l.__wbindgen_free(t, n, 1);
            }
        }
        read_line() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.bistream_read_line(this.__wbg_ptr);
        }
        read_message() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.bistream_read_message(this.__wbg_ptr);
        }
        read_to_end(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), m(t), l.bistream_read_to_end(this.__wbg_ptr, t);
        }
        write_line(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T;
            return l.bistream_write_line(this.__wbg_ptr, n, r);
        }
        write_message(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = Oe(t, l.__wbindgen_malloc), r = T;
            return l.bistream_write_message(this.__wbg_ptr, n, r);
        }
        write_raw_and_finish(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = Oe(t, l.__wbindgen_malloc), r = T;
            return l.bistream_write_raw_and_finish(this.__wbg_ptr, n, r);
        }
    }
    Symbol.dispose && ($t.prototype[Symbol.dispose] = $t.prototype.free);
    class ke {
        static __wrap(t) {
            const n = Object.create(ke.prototype);
            return n.__wbg_ptr = t, Cn.register(n, n.__wbg_ptr, n), n;
        }
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, Cn.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_canceltoken_free(t, 0);
        }
        cancel() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), l.canceltoken_cancel(this.__wbg_ptr);
        }
        clone_token() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.canceltoken_clone_token(this.__wbg_ptr);
            return ke.__wrap(t);
        }
        is_cancelled() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.canceltoken_is_cancelled(this.__wbg_ptr) !== 0;
        }
        constructor(){
            const t = l.canceltoken_new();
            return this.__wbg_ptr = t, Cn.register(this, this.__wbg_ptr, this), this;
        }
    }
    Symbol.dispose && (ke.prototype[Symbol.dispose] = ke.prototype.free);
    class At {
        constructor(){
            throw new Error("cannot invoke `new` directly");
        }
        static __wrap(t) {
            const n = Object.create(At.prototype);
            return n.__wbg_ptr = t, lo.register(n, n.__wbg_ptr, n), n;
        }
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, lo.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_helloimageresult_free(t, 0);
        }
        get content_type() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.helloimageresult_content_type(this.__wbg_ptr);
            let n;
            return t[0] !== 0 && (n = Y(t[0], t[1]).slice(), l.__wbindgen_free(t[0], t[1] * 1, 1)), n;
        }
        get data() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.helloimageresult_data(this.__wbg_ptr);
        }
    }
    Symbol.dispose && (At.prototype[Symbol.dispose] = At.prototype.free);
    class zt {
        constructor(){
            throw new Error("cannot invoke `new` directly");
        }
        static __wrap(t) {
            const n = Object.create(zt.prototype);
            return n.__wbg_ptr = t, fo.register(n, n.__wbg_ptr, n), n;
        }
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, fo.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_importsession_free(t, 0);
        }
        abort() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), l.importsession_abort(this.__wbg_ptr);
        }
        finish() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.importsession_finish(this.__wbg_ptr);
        }
        push(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = Oe(t, l.__wbindgen_malloc), r = T;
            return l.importsession_push(this.__wbg_ptr, n, r);
        }
    }
    Symbol.dispose && (zt.prototype[Symbol.dispose] = zt.prototype.free);
    class qe {
        constructor(){
            throw new Error("cannot invoke `new` directly");
        }
        static __wrap(t) {
            const n = Object.create(qe.prototype);
            return n.__wbg_ptr = t, go.register(n, n.__wbg_ptr, n), n;
        }
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, go.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_middennode_free(t, 0);
        }
        accept() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.middennode_accept(this.__wbg_ptr);
        }
        active_blob_count() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.middennode_active_blob_count(this.__wbg_ptr) >>> 0;
        }
        api_request(t, n, r, o) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const i = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T, a = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), c = T, u = D(r, l.__wbindgen_malloc, l.__wbindgen_realloc), _ = T;
            var f = F(o) ? 0 : D(o, l.__wbindgen_malloc, l.__wbindgen_realloc), d = T;
            return l.middennode_api_request(this.__wbg_ptr, i, s, a, c, u, _, f, d);
        }
        clear_blob_restriction(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T, o = l.middennode_clear_blob_restriction(this.__wbg_ptr, n, r);
            if (o[1]) throw ye(o[0]);
        }
        compute_blake3(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T;
            return l.middennode_compute_blake3(this.__wbg_ptr, r, o, i, s);
        }
        static create(t) {
            return F(t) || m(t), l.middennode_create(F(t) ? Number.MAX_SAFE_INTEGER : t >>> 0);
        }
        static create_from_key(t, n) {
            const r = Oe(t, l.__wbindgen_malloc), o = T;
            return F(n) || m(n), l.middennode_create_from_key(r, o, F(n) ? Number.MAX_SAFE_INTEGER : n >>> 0);
        }
        static create_with_alpns(t, n, r) {
            const o = Oe(t, l.__wbindgen_malloc), i = T;
            return F(r) || m(r), l.middennode_create_with_alpns(o, i, n, F(r) ? Number.MAX_SAFE_INTEGER : r >>> 0);
        }
        static create_with_options(t) {
            if (dt(t, on), t.__wbg_ptr === 0) throw new Error("Attempt to use a moved value");
            var n = t.__destroy_into_raw();
            return l.middennode_create_with_options(n);
        }
        download_verified(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T;
            return l.middennode_download_verified(this.__wbg_ptr, r, o, i, s);
        }
        download_verified_by_id(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T;
            return l.middennode_download_verified_by_id(this.__wbg_ptr, r, o, i, s);
        }
        download_verified_by_id_progress(t, n, r, o) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const i = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T, a = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), c = T;
            return l.middennode_download_verified_by_id_progress(this.__wbg_ptr, i, s, a, c, r, o);
        }
        download_verified_streaming(t, n, r, o, i, s) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const a = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), c = T, u = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), _ = T;
            let f = 0;
            if (!F(s)) {
                if (dt(s, ke), s.__wbg_ptr === 0) throw new Error("Attempt to use a moved value");
                f = s.__destroy_into_raw();
            }
            return l.middennode_download_verified_streaming(this.__wbg_ptr, a, c, u, _, r, o, i, f);
        }
        download_verified_streaming_with_ensure(t, n, r, o, i, s) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const a = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), c = T, u = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), _ = T;
            let f = 0;
            if (!F(s)) {
                if (dt(s, ke), s.__wbg_ptr === 0) throw new Error("Attempt to use a moved value");
                f = s.__destroy_into_raw();
            }
            return l.middennode_download_verified_streaming_with_ensure(this.__wbg_ptr, a, c, u, _, r, o, i, f);
        }
        download_verified_with_ensure(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T;
            return l.middennode_download_verified_with_ensure(this.__wbg_ptr, r, o, i, s);
        }
        download_verified_with_ensure_progress(t, n, r, o, i) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const s = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), a = T, c = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), u = T;
            let _ = 0;
            if (!F(i)) {
                if (dt(i, ke), i.__wbg_ptr === 0) throw new Error("Attempt to use a moved value");
                _ = i.__destroy_into_raw();
            }
            return l.middennode_download_verified_with_ensure_progress(this.__wbg_ptr, s, a, c, u, r, o, _);
        }
        download_verified_with_progress(t, n, r, o, i) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const s = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), a = T, c = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), u = T;
            let _ = 0;
            if (!F(i)) {
                if (dt(i, ke), i.__wbg_ptr === 0) throw new Error("Attempt to use a moved value");
                _ = i.__destroy_into_raw();
            }
            return l.middennode_download_verified_with_progress(this.__wbg_ptr, s, a, c, u, r, o, _);
        }
        ensure_blob(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T;
            return l.middennode_ensure_blob(this.__wbg_ptr, r, o, i, s);
        }
        fetch_hello_image(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T;
            return l.middennode_fetch_hello_image(this.__wbg_ptr, n, r);
        }
        get_active_transfers() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.middennode_get_active_transfers(this.__wbg_ptr);
            if (t[2]) throw ye(t[1]);
            return ye(t[0]);
        }
        has_active_blob(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T;
            return l.middennode_has_active_blob(this.__wbg_ptr, n, r) !== 0;
        }
        has_complete_blob(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T;
            return l.middennode_has_complete_blob(this.__wbg_ptr, n, r);
        }
        import_bao(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = Oe(n, l.__wbindgen_malloc), s = T;
            return l.middennode_import_bao(this.__wbg_ptr, r, o, i, s);
        }
        import_blob(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = Oe(t, l.__wbindgen_malloc), r = T;
            return l.middennode_import_blob(this.__wbg_ptr, n, r);
        }
        import_blob_and_export_bao(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = Oe(t, l.__wbindgen_malloc), r = T;
            return l.middennode_import_blob_and_export_bao(this.__wbg_ptr, n, r);
        }
        node_addr() {
            let t, n;
            try {
                if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
                m(this.__wbg_ptr);
                const i = l.middennode_node_addr(this.__wbg_ptr);
                var r = i[0], o = i[1];
                if (i[3]) throw r = 0, o = 0, ye(i[2]);
                return t = r, n = o, Y(r, o);
            } finally{
                l.__wbindgen_free(t, n, 1);
            }
        }
        node_id() {
            let t, n;
            try {
                if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
                m(this.__wbg_ptr);
                const r = l.middennode_node_id(this.__wbg_ptr);
                return t = r[0], n = r[1], Y(r[0], r[1]);
            } finally{
                l.__wbindgen_free(t, n, 1);
            }
        }
        open_bi(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), s = T;
            return l.middennode_open_bi(this.__wbg_ptr, r, o, i, s);
        }
        protect_blob(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T, o = l.middennode_protect_blob(this.__wbg_ptr, n, r);
            if (o[1]) throw ye(o[0]);
        }
        proxy_admin(t, n, r) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const o = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), i = T, s = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), a = T, c = D(r, l.__wbindgen_malloc, l.__wbindgen_realloc), u = T;
            return l.middennode_proxy_admin(this.__wbg_ptr, o, i, s, a, c, u);
        }
        release_blob(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T, o = l.middennode_release_blob(this.__wbg_ptr, n, r);
            if (o[1]) throw ye(o[0]);
        }
        restrict_blob_to_peers(t, n) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const r = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T, i = l.middennode_restrict_blob_to_peers(this.__wbg_ptr, r, o, n);
            if (i[1]) throw ye(i[0]);
        }
        secret_key() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.middennode_secret_key(this.__wbg_ptr);
        }
        start_blob_server() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), l.middennode_start_blob_server(this.__wbg_ptr);
        }
        start_import() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.middennode_start_import(this.__wbg_ptr);
            return zt.__wrap(t);
        }
        tune_radio(t, n, r, o, i) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const s = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), a = T;
            var c = F(n) ? 0 : D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), u = T;
            return l.middennode_tune_radio(this.__wbg_ptr, s, a, c, u, r, o, i);
        }
        unprotect_blob(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const n = D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T, o = l.middennode_unprotect_blob(this.__wbg_ptr, n, r);
            if (o[1]) throw ye(o[0]);
        }
    }
    Symbol.dispose && (qe.prototype[Symbol.dispose] = qe.prototype.free);
    class on {
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, po.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_middennodeoptions_free(t, 0);
        }
        get connect_timeout_ms() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.middennodeoptions_get_connect_timeout_ms(this.__wbg_ptr);
            return t === Number.MAX_SAFE_INTEGER ? void 0 : t;
        }
        get extra_alpns() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.middennodeoptions_get_extra_alpns(this.__wbg_ptr);
            let n;
            return t[0] !== 0 && (n = Nt(t[0], t[1]).slice(), l.__wbindgen_free(t[0], t[1] * 4, 4)), n;
        }
        get opfs_store_dir() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            const t = l.middennodeoptions_get_opfs_store_dir(this.__wbg_ptr);
            let n;
            return t[0] !== 0 && (n = Y(t[0], t[1]).slice(), l.__wbindgen_free(t[0], t[1] * 1, 1)), n;
        }
        get secret_key() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            return m(this.__wbg_ptr), l.middennodeoptions_get_secret_key(this.__wbg_ptr);
        }
        constructor(){
            const t = l.middennodeoptions_new();
            return this.__wbg_ptr = t, po.register(this, this.__wbg_ptr, this), this;
        }
        set connect_timeout_ms(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), F(t) || m(t), l.middennodeoptions_set_connect_timeout_ms(this.__wbg_ptr, F(t) ? Number.MAX_SAFE_INTEGER : t >>> 0);
        }
        set extra_alpns(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            var n = F(t) ? 0 : yl(t, l.__wbindgen_malloc), r = T;
            l.middennodeoptions_set_extra_alpns(this.__wbg_ptr, n, r);
        }
        set opfs_store_dir(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr);
            var n = F(t) ? 0 : D(t, l.__wbindgen_malloc, l.__wbindgen_realloc), r = T;
            l.middennodeoptions_set_opfs_store_dir(this.__wbg_ptr, n, r);
        }
        set secret_key(t) {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), l.middennodeoptions_set_secret_key(this.__wbg_ptr, F(t) ? 0 : ge(t));
        }
    }
    Symbol.dispose && (on.prototype[Symbol.dispose] = on.prototype.free);
    class It {
        constructor(){
            throw new Error("cannot invoke `new` directly");
        }
        static __wrap(t) {
            const n = Object.create(It.prototype);
            return n.__wbg_ptr = t, ho.register(n, n.__wbg_ptr, n), n;
        }
        __destroy_into_raw() {
            const t = this.__wbg_ptr;
            return this.__wbg_ptr = 0, ho.unregister(this), t;
        }
        free() {
            const t = this.__destroy_into_raw();
            l.__wbg_radiohandle_free(t, 0);
        }
        leave() {
            if (this.__wbg_ptr == 0) throw new Error("Attempt to use a moved value");
            m(this.__wbg_ptr), l.radiohandle_leave(this.__wbg_ptr);
        }
    }
    Symbol.dispose && (It.prototype[Symbol.dispose] = It.prototype.free);
    function Fa() {
        return p(function(e, t) {
            return Error(Y(e, t));
        }, arguments);
    }
    function La() {
        return p(function(e, t) {
            const n = String(t), r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function Ua(e) {
        const t = e, n = typeof t == "boolean" ? t : void 0;
        return F(n) || re(n), F(n) ? 16777215 : n ? 1 : 0;
    }
    function qa(e, t) {
        const n = mr(t), r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
        ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
    }
    function Ja(e) {
        const t = typeof e == "function";
        return re(t), t;
    }
    function Va(e) {
        const t = e, n = typeof t == "object" && t !== null;
        return re(n), n;
    }
    function Ka(e) {
        const t = typeof e == "string";
        return re(t), t;
    }
    function Wa(e) {
        const t = e === void 0;
        return re(t), t;
    }
    function Ha(e, t) {
        const n = t, r = typeof n == "string" ? n : void 0;
        var o = F(r) ? 0 : D(r, l.__wbindgen_malloc, l.__wbindgen_realloc), i = T;
        ne().setInt32(e + 4, i, !0), ne().setInt32(e + 0, o, !0);
    }
    function Ga(e, t) {
        throw new Error(Y(e, t));
    }
    function Ya() {
        return p(function(e) {
            e._wbg_cb_unref();
        }, arguments);
    }
    function Qa() {
        return p(function(e) {
            e.abort();
        }, arguments);
    }
    function Xa() {
        return p(function(e, t) {
            e.abort(t);
        }, arguments);
    }
    function ec() {
        return j(function(e, t, n, r) {
            e.addEventListener(Y(t, n), r);
        }, arguments);
    }
    function tc() {
        return j(function(e, t, n, r, o) {
            e.append(Y(t, n), Y(r, o));
        }, arguments);
    }
    function nc() {
        return j(function(e) {
            return e.arrayBuffer();
        }, arguments);
    }
    function rc() {
        return p(function(e) {
            return $t.__wrap(e);
        }, arguments);
    }
    function oc() {
        return p(function(e) {
            const t = e.body;
            return F(t) ? 0 : ge(t);
        }, arguments);
    }
    function ic() {
        return p(function(e) {
            return e.buffer;
        }, arguments);
    }
    function sc() {
        return p(function(e) {
            const t = e.byobRequest;
            return F(t) ? 0 : ge(t);
        }, arguments);
    }
    function ac() {
        return p(function(e) {
            const t = e.byteLength;
            return m(t), t;
        }, arguments);
    }
    function cc() {
        return p(function(e) {
            const t = e.byteOffset;
            return m(t), t;
        }, arguments);
    }
    function uc() {
        return j(function(e, t, n, r, o) {
            return e.call(t, n, r, o);
        }, arguments);
    }
    function _c() {
        return j(function(e, t) {
            return e.call(t);
        }, arguments);
    }
    function lc() {
        return j(function(e, t, n) {
            return e.call(t, n);
        }, arguments);
    }
    function fc() {
        return j(function(e, t, n, r) {
            return e.call(t, n, r);
        }, arguments);
    }
    function dc() {
        return p(function(e) {
            return e.cancel();
        }, arguments);
    }
    function gc() {
        return p(function(e, t) {
            return e.catch(t);
        }, arguments);
    }
    function pc() {
        return p(function(e) {
            return clearTimeout(e);
        }, arguments);
    }
    function hc() {
        return j(function(e, t) {
            e.clearTimeout(t);
        }, arguments);
    }
    function bc() {
        return j(function(e) {
            e.close();
        }, arguments);
    }
    function mc() {
        return j(function(e) {
            e.close();
        }, arguments);
    }
    function wc() {
        return j(function(e) {
            e.close();
        }, arguments);
    }
    function yc() {
        return p(function(e) {
            e.close();
        }, arguments);
    }
    function vc() {
        return p(function(e) {
            const t = e.code;
            return m(t), t;
        }, arguments);
    }
    function kc() {
        return p(function(e) {
            const t = e.code;
            return m(t), t;
        }, arguments);
    }
    function Ec() {
        return p(function(e) {
            return e.createSyncAccessHandle();
        }, arguments);
    }
    function Sc() {
        return p(function(e) {
            return e.crypto;
        }, arguments);
    }
    function $c() {
        return p(function(e) {
            return e.data;
        }, arguments);
    }
    function Ac() {
        return p(function(e, t) {
            var n = Nt(e, t).slice();
            l.__wbindgen_free(e, t * 4, 4), console.debug(...n);
        }, arguments);
    }
    function zc() {
        return p(function(e) {
            const t = e.done;
            return re(t), t;
        }, arguments);
    }
    function Ic() {
        return j(function(e, t) {
            e.enqueue(t);
        }, arguments);
    }
    function Oc() {
        return p(function(e) {
            return e.entries();
        }, arguments);
    }
    function Cc() {
        return p(function(e, t) {
            var n = Nt(e, t).slice();
            l.__wbindgen_free(e, t * 4, 4), console.error(...n);
        }, arguments);
    }
    function Tc() {
        return p(function(e, t) {
            let n, r;
            try {
                n = e, r = t, console.error(Y(e, t));
            } finally{
                l.__wbindgen_free(n, r, 1);
            }
        }, arguments);
    }
    function Pc() {
        return p(function(e) {
            return fetch(e);
        }, arguments);
    }
    function Nc() {
        return p(function(e, t) {
            return e.fetch(t);
        }, arguments);
    }
    function xc() {
        return j(function(e) {
            e.flush();
        }, arguments);
    }
    function Rc() {
        return p(function(e, t, n, r) {
            return e.getDirectoryHandle(Y(t, n), r);
        }, arguments);
    }
    function Dc() {
        return p(function(e) {
            return e.getDirectory();
        }, arguments);
    }
    function Mc() {
        return p(function(e, t, n, r) {
            return e.getFileHandle(Y(t, n), r);
        }, arguments);
    }
    function Zc() {
        return j(function(e, t) {
            e.getRandomValues(t);
        }, arguments);
    }
    function Bc() {
        return j(function(e, t) {
            globalThis.crypto.getRandomValues(De(e, t));
        }, arguments);
    }
    function jc() {
        return j(function(e) {
            return e.getReader();
        }, arguments);
    }
    function Fc() {
        return j(function(e) {
            return e.getSize();
        }, arguments);
    }
    function Lc() {
        return p(function(e, t) {
            return e[t >>> 0];
        }, arguments);
    }
    function Uc() {
        return j(function(e, t) {
            return Reflect.get(e, t);
        }, arguments);
    }
    function qc() {
        return p(function(e) {
            const t = e.done;
            return F(t) || re(t), F(t) ? 16777215 : t ? 1 : 0;
        }, arguments);
    }
    function Jc() {
        return p(function(e) {
            return e.value;
        }, arguments);
    }
    function Vc() {
        return j(function(e, t) {
            const n = Reflect.has(e, t);
            return re(n), n;
        }, arguments);
    }
    function Kc() {
        return p(function(e) {
            return e.headers;
        }, arguments);
    }
    function Wc() {
        return p(function(e) {
            return At.__wrap(e);
        }, arguments);
    }
    function Hc() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof ArrayBuffer;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function Gc() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof Blob;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function Yc() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof FileSystemDirectoryHandle;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function Qc() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof FileSystemFileHandle;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function Xc() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof FileSystemSyncAccessHandle;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function eu() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof Response;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function tu() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof Window;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function nu() {
        return p(function(e) {
            let t;
            try {
                t = e instanceof WorkerGlobalScope;
            } catch  {
                t = !1;
            }
            const n = t;
            return re(n), n;
        }, arguments);
    }
    function ru() {
        return p(function(e) {
            const t = Array.isArray(e);
            return re(t), t;
        }, arguments);
    }
    function ou() {
        return p(function(e) {
            const t = e.length;
            return m(t), t;
        }, arguments);
    }
    function iu() {
        return p(function(e) {
            const t = e.length;
            return m(t), t;
        }, arguments);
    }
    function su() {
        return p(function(e, t) {
            var n = Nt(e, t).slice();
            l.__wbindgen_free(e, t * 4, 4), console.log(...n);
        }, arguments);
    }
    function au() {
        return p(function(e, t) {
            const n = t.message, r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function cu() {
        return p(function(e) {
            return qe.__wrap(e);
        }, arguments);
    }
    function uu() {
        return p(function(e) {
            return e.msCrypto;
        }, arguments);
    }
    function _u() {
        return p(function(e) {
            return e.navigator;
        }, arguments);
    }
    function lu() {
        return p(function(e) {
            return e.navigator;
        }, arguments);
    }
    function fu() {
        return j(function() {
            return new Headers;
        }, arguments);
    }
    function du() {
        return p(function() {
            return new Error;
        }, arguments);
    }
    function gu() {
        return p(function() {
            return new Array;
        }, arguments);
    }
    function pu() {
        return j(function() {
            return new AbortController;
        }, arguments);
    }
    function hu() {
        return p(function() {
            return new Map;
        }, arguments);
    }
    function bu() {
        return p(function(e, t) {
            return new Error(Y(e, t));
        }, arguments);
    }
    function mu() {
        return j(function(e, t) {
            return new WebSocket(Y(e, t));
        }, arguments);
    }
    function wu() {
        return p(function(e) {
            return new Uint8Array(e);
        }, arguments);
    }
    function yu() {
        return p(function() {
            return new Object;
        }, arguments);
    }
    function vu() {
        return p(function(e, t) {
            return new Uint8Array(De(e, t));
        }, arguments);
    }
    function ku() {
        return p(function(e, t) {
            try {
                var n = {
                    a: e,
                    b: t
                }, r = (i, s)=>{
                    const a = n.a;
                    n.a = 0;
                    try {
                        return gl(a, n.b, i, s);
                    } finally{
                        n.a = a;
                    }
                };
                return new Promise(r);
            } finally{
                n.a = 0;
            }
        }, arguments);
    }
    function Eu() {
        return p(function(e, t, n) {
            return new Uint8Array(e, t >>> 0, n >>> 0);
        }, arguments);
    }
    function Su() {
        return p(function(e) {
            return new Uint8Array(e >>> 0);
        }, arguments);
    }
    function $u() {
        return j(function(e, t, n) {
            return new Request(Y(e, t), n);
        }, arguments);
    }
    function Au() {
        return j(function(e, t, n) {
            return new WebSocket(Y(e, t), n);
        }, arguments);
    }
    function zu() {
        return j(function(e) {
            return e.next();
        }, arguments);
    }
    function Iu() {
        return p(function(e) {
            return e.node;
        }, arguments);
    }
    function Ou() {
        return p(function() {
            return Date.now();
        }, arguments);
    }
    function Cu() {
        return p(function(e) {
            return e.now();
        }, arguments);
    }
    function Tu() {
        return p(function(e) {
            return e.performance;
        }, arguments);
    }
    function Pu() {
        return p(function(e) {
            return e.process;
        }, arguments);
    }
    function Nu() {
        return p(function(e, t) {
            const n = t.protocol, r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function xu() {
        return p(function(e, t, n) {
            Uint8Array.prototype.set.call(De(e, t), n);
        }, arguments);
    }
    function Ru() {
        return p(function(e, t) {
            const n = e.push(t);
            return m(n), n;
        }, arguments);
    }
    function Du() {
        return p(function(e) {
            return e.queueMicrotask;
        }, arguments);
    }
    function Mu() {
        return p(function(e) {
            queueMicrotask(e);
        }, arguments);
    }
    function Zu() {
        return p(function(e) {
            return It.__wrap(e);
        }, arguments);
    }
    function Bu() {
        return j(function(e, t) {
            e.randomFillSync(t);
        }, arguments);
    }
    function ju() {
        return p(function() {
            return Math.random();
        }, arguments);
    }
    function Fu() {
        return j(function(e, t, n, r) {
            return e.read(De(t, n), r);
        }, arguments);
    }
    function Lu() {
        return p(function(e) {
            return e.read();
        }, arguments);
    }
    function Uu() {
        return p(function(e) {
            const t = e.readyState;
            return m(t), t;
        }, arguments);
    }
    function qu() {
        return p(function(e, t) {
            const n = t.reason, r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function Ju() {
        return p(function(e) {
            e.releaseLock();
        }, arguments);
    }
    function Vu() {
        return p(function(e, t, n) {
            return e.removeEntry(Y(t, n));
        }, arguments);
    }
    function Ku() {
        return j(function(e, t, n, r) {
            e.removeEventListener(Y(t, n), r);
        }, arguments);
    }
    function Wu() {
        return j(function() {
            return module.require;
        }, arguments);
    }
    function Hu() {
        return p(function(e) {
            return Promise.resolve(e);
        }, arguments);
    }
    function Gu() {
        return j(function(e, t) {
            e.respond(t >>> 0);
        }, arguments);
    }
    function Yu() {
        return p(function(e, t, n) {
            try {
                var r = {
                    a: t,
                    b: n
                }, o = ()=>{
                    const s = r.a;
                    r.a = 0;
                    try {
                        return ul(s, r.b);
                    } finally{
                        r.a = s;
                    }
                };
                const i = e.run(o);
                return re(i), i;
            } finally{
                r.a = 0;
            }
        }, arguments);
    }
    function Qu() {
        return j(function(e, t, n) {
            e.send(De(t, n));
        }, arguments);
    }
    function Xu() {
        return j(function(e, t, n) {
            e.send(Y(t, n));
        }, arguments);
    }
    function e_() {
        return p(function(e, t) {
            return setTimeout(e, t);
        }, arguments);
    }
    function t_() {
        return j(function(e, t, n) {
            return e.setTimeout(t, n);
        }, arguments);
    }
    function n_() {
        return p(function(e, t, n) {
            e.set(De(t, n));
        }, arguments);
    }
    function r_() {
        return p(function(e, t, n) {
            return e.set(t, n);
        }, arguments);
    }
    function o_() {
        return p(function(e, t, n) {
            e[t] = n;
        }, arguments);
    }
    function i_() {
        return j(function(e, t, n) {
            const r = Reflect.set(e, t, n);
            return re(r), r;
        }, arguments);
    }
    function s_() {
        return p(function(e, t, n) {
            e[t >>> 0] = n;
        }, arguments);
    }
    function a_() {
        return p(function(e, t) {
            e.at = t;
        }, arguments);
    }
    function c_() {
        return p(function(e, t) {
            e.binaryType = pl[t];
        }, arguments);
    }
    function u_() {
        return p(function(e, t) {
            e.body = t;
        }, arguments);
    }
    function __() {
        return p(function(e, t) {
            e.cache = hl[t];
        }, arguments);
    }
    function l_() {
        return p(function(e, t) {
            e.create = t !== 0;
        }, arguments);
    }
    function f_() {
        return p(function(e, t) {
            e.create = t !== 0;
        }, arguments);
    }
    function d_() {
        return p(function(e, t) {
            e.credentials = bl[t];
        }, arguments);
    }
    function g_() {
        return p(function(e, t) {
            e.handleEvent = t;
        }, arguments);
    }
    function p_() {
        return p(function(e, t) {
            e.headers = t;
        }, arguments);
    }
    function h_() {
        return p(function(e, t, n) {
            e.method = Y(t, n);
        }, arguments);
    }
    function b_() {
        return p(function(e, t) {
            e.mode = ml[t];
        }, arguments);
    }
    function m_() {
        return p(function(e, t) {
            e.onclose = t;
        }, arguments);
    }
    function w_() {
        return p(function(e, t) {
            e.onerror = t;
        }, arguments);
    }
    function y_() {
        return p(function(e, t) {
            e.onmessage = t;
        }, arguments);
    }
    function v_() {
        return p(function(e, t) {
            e.onopen = t;
        }, arguments);
    }
    function k_() {
        return p(function(e, t) {
            e.signal = t;
        }, arguments);
    }
    function E_() {
        return p(function(e) {
            return e.signal;
        }, arguments);
    }
    function S_() {
        return p(function(e, t) {
            const n = t.stack, r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function $_() {
        return p(function() {
            const e = typeof console > "u" ? null : console?.createTask;
            return F(e) ? 0 : ge(e);
        }, arguments);
    }
    function A_() {
        return p(function() {
            const e = typeof global > "u" ? null : global;
            return F(e) ? 0 : ge(e);
        }, arguments);
    }
    function z_() {
        return p(function() {
            const e = typeof globalThis > "u" ? null : globalThis;
            return F(e) ? 0 : ge(e);
        }, arguments);
    }
    function I_() {
        return p(function() {
            const e = typeof self > "u" ? null : self;
            return F(e) ? 0 : ge(e);
        }, arguments);
    }
    function O_() {
        return p(function() {
            const e = typeof window > "u" ? null : window;
            return F(e) ? 0 : ge(e);
        }, arguments);
    }
    function C_() {
        return p(function(e) {
            const t = e.status;
            return m(t), t;
        }, arguments);
    }
    function T_() {
        return p(function(e) {
            return e.storage;
        }, arguments);
    }
    function P_() {
        return p(function(e) {
            return e.storage;
        }, arguments);
    }
    function N_() {
        return p(function(e, t, n) {
            return e.subarray(t >>> 0, n >>> 0);
        }, arguments);
    }
    function x_() {
        return p(function(e, t, n) {
            return e.then(t, n);
        }, arguments);
    }
    function R_() {
        return p(function(e, t) {
            return e.then(t);
        }, arguments);
    }
    function D_() {
        return j(function(e, t) {
            e.truncate(t);
        }, arguments);
    }
    function M_() {
        return p(function(e, t) {
            const n = t.url, r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function Z_() {
        return p(function(e, t) {
            const n = t.url, r = D(n, l.__wbindgen_malloc, l.__wbindgen_realloc), o = T;
            ne().setInt32(e + 4, o, !0), ne().setInt32(e + 0, r, !0);
        }, arguments);
    }
    function B_() {
        return p(function(e) {
            return e.value;
        }, arguments);
    }
    function j_() {
        return p(function(e) {
            return e.versions;
        }, arguments);
    }
    function F_() {
        return p(function(e) {
            const t = e.view;
            return F(t) ? 0 : ge(t);
        }, arguments);
    }
    function L_() {
        return p(function(e, t) {
            var n = Nt(e, t).slice();
            l.__wbindgen_free(e, t * 4, 4), console.warn(...n);
        }, arguments);
    }
    function U_() {
        return p(function(e) {
            const t = e.wasClean;
            return re(t), t;
        }, arguments);
    }
    function q_() {
        return j(function(e, t, n, r) {
            return e.write(De(t, n), r);
        }, arguments);
    }
    function J_() {
        return p(function(e, t) {
            return Ke(e, t, _l);
        }, arguments);
    }
    function V_() {
        return p(function(e, t) {
            return Ke(e, t, dl);
        }, arguments);
    }
    function K_() {
        return p(function(e, t) {
            return Ke(e, t, ll);
        }, arguments);
    }
    function W_() {
        return p(function(e, t) {
            return Ke(e, t, fl);
        }, arguments);
    }
    function H_() {
        return p(function(e, t) {
            return Ke(e, t, il);
        }, arguments);
    }
    function G_() {
        return p(function(e, t) {
            return Ke(e, t, sl);
        }, arguments);
    }
    function Y_() {
        return p(function(e, t) {
            return wl(e, t, al);
        }, arguments);
    }
    function Q_() {
        return p(function(e, t) {
            return Ke(e, t, cl);
        }, arguments);
    }
    function X_() {
        return p(function(e) {
            return e;
        }, arguments);
    }
    function el() {
        return p(function(e) {
            return e;
        }, arguments);
    }
    function tl() {
        return p(function(e, t) {
            return De(e, t);
        }, arguments);
    }
    function nl() {
        return p(function(e, t) {
            return Y(e, t);
        }, arguments);
    }
    function rl() {
        return p(function(e) {
            return BigInt.asUintN(64, e);
        }, arguments);
    }
    function ol() {
        const e = l.__wbindgen_externrefs, t = e.grow(4);
        e.set(0, void 0), e.set(t + 0, void 0), e.set(t + 1, null), e.set(t + 2, !0), e.set(t + 3, !1);
    }
    function il(e, t) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__hc8728011322ac642(e, t);
    }
    function sl(e, t) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h664b7a54f532788b(e, t);
    }
    function al(e, t) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__hdf2e0feb328f9c9c(e, t);
    }
    function cl(e, t) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h53f0ac92999d4a51(e, t);
    }
    function ul(e, t) {
        return m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h72d513d189e25b7d(e, t) !== 0;
    }
    function _l(e, t, n) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h9bfafcd5df7f650f(e, t, n);
    }
    function ll(e, t, n) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h3cac54e009c37b19(e, t, n);
    }
    function fl(e, t, n) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h0b2903c49209e780(e, t, n);
    }
    function dl(e, t, n) {
        m(e), m(t);
        const r = l.wasm_bindgen__convert__closures_____invoke__h009da3dd3294e065(e, t, n);
        if (r[1]) throw ye(r[0]);
    }
    function gl(e, t, n, r) {
        m(e), m(t), l.wasm_bindgen__convert__closures_____invoke__h744df718fbe3badf(e, t, n, r);
    }
    const pl = [
        "blob",
        "arraybuffer"
    ], hl = [
        "default",
        "no-store",
        "reload",
        "no-cache",
        "force-cache",
        "only-if-cached"
    ], bl = [
        "omit",
        "same-origin",
        "include"
    ], ml = [
        "same-origin",
        "no-cors",
        "cors",
        "navigate"
    ], _o = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_bistream_free(e, 1));
    typeof FinalizationRegistry > "u" || new FinalizationRegistry((e)=>l.__wbg_blake3hasher_free(e, 1));
    const Cn = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_canceltoken_free(e, 1)), lo = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_helloimageresult_free(e, 1)), fo = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_importsession_free(e, 1));
    typeof FinalizationRegistry > "u" || new FinalizationRegistry((e)=>l.__wbg_intounderlyingbytesource_free(e, 1));
    typeof FinalizationRegistry > "u" || new FinalizationRegistry((e)=>l.__wbg_intounderlyingsink_free(e, 1));
    typeof FinalizationRegistry > "u" || new FinalizationRegistry((e)=>l.__wbg_intounderlyingsource_free(e, 1));
    const go = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_middennode_free(e, 1)), po = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_middennodeoptions_free(e, 1)), ho = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbg_radiohandle_free(e, 1));
    function ge(e) {
        const t = l.__externref_table_alloc();
        return l.__wbindgen_externrefs.set(t, e), t;
    }
    function re(e) {
        if (typeof e != "boolean") throw new Error(`expected a boolean argument, found ${typeof e}`);
    }
    function dt(e, t) {
        if (!(e instanceof t)) throw new Error(`expected instance of ${t.name}`);
    }
    function m(e) {
        if (typeof e != "number") throw new Error(`expected a number argument, found ${typeof e}`);
    }
    const sn = typeof FinalizationRegistry > "u" ? {
        register: ()=>{},
        unregister: ()=>{}
    } : new FinalizationRegistry((e)=>l.__wbindgen_destroy_closure(e.a, e.b));
    function mr(e) {
        const t = typeof e;
        if (t == "number" || t == "boolean" || e == null) return `${e}`;
        if (t == "string") return `"${e}"`;
        if (t == "symbol") {
            const o = e.description;
            return o == null ? "Symbol" : `Symbol(${o})`;
        }
        if (t == "function") {
            const o = e.name;
            return typeof o == "string" && o.length > 0 ? `Function(${o})` : "Function";
        }
        if (Array.isArray(e)) {
            const o = e.length;
            let i = "[";
            o > 0 && (i += mr(e[0]));
            for(let s = 1; s < o; s++)i += ", " + mr(e[s]);
            return i += "]", i;
        }
        const n = /\[object ([^\]]+)\]/.exec(toString.call(e));
        let r;
        if (n && n.length > 1) r = n[1];
        else return toString.call(e);
        if (r == "Object") try {
            return "Object(" + JSON.stringify(e) + ")";
        } catch  {
            return "Object";
        }
        return e instanceof Error ? `${e.name}: ${e.message}
${e.stack}` : r;
    }
    function Nt(e, t) {
        e = e >>> 0;
        const n = ne(), r = [];
        for(let o = e; o < e + 4 * t; o += 4)r.push(l.__wbindgen_externrefs.get(n.getUint32(o, !0)));
        return l.__externref_drop_slice(e, t), r;
    }
    function De(e, t) {
        return e = e >>> 0, rt().subarray(e / 1, e / 1 + t);
    }
    let Xe = null;
    function ne() {
        return (Xe === null || Xe.buffer.detached === !0 || Xe.buffer.detached === void 0 && Xe.buffer !== l.memory.buffer) && (Xe = new DataView(l.memory.buffer)), Xe;
    }
    function Y(e, t) {
        return kl(e >>> 0, t);
    }
    let Mt = null;
    function rt() {
        return (Mt === null || Mt.byteLength === 0) && (Mt = new Uint8Array(l.memory.buffer)), Mt;
    }
    function j(e, t) {
        try {
            return e.apply(this, t);
        } catch (n) {
            const r = ge(n);
            l.__wbindgen_exn_store(r);
        }
    }
    function F(e) {
        return e == null;
    }
    function p(e, t) {
        try {
            return e.apply(this, t);
        } catch (n) {
            let r = (function() {
                try {
                    return n instanceof Error ? `${n.message}

Stack:
${n.stack}` : n.toString();
                } catch  {
                    return "<failed to stringify thrown value>";
                }
            })();
            throw console.error("wasm-bindgen: imported JS function that was not marked as `catch` threw an error:", r), n;
        }
    }
    function wl(e, t, n) {
        const r = {
            a: e,
            b: t,
            cnt: 1
        }, o = (...i)=>{
            r.cnt++;
            try {
                return n(r.a, r.b, ...i);
            } finally{
                o._wbg_cb_unref();
            }
        };
        return o._wbg_cb_unref = ()=>{
            --r.cnt === 0 && (l.__wbindgen_destroy_closure(r.a, r.b), r.a = 0, sn.unregister(r));
        }, sn.register(o, r, r), o;
    }
    function Ke(e, t, n) {
        const r = {
            a: e,
            b: t,
            cnt: 1
        }, o = (...i)=>{
            r.cnt++;
            const s = r.a;
            r.a = 0;
            try {
                return n(s, r.b, ...i);
            } finally{
                r.a = s, o._wbg_cb_unref();
            }
        };
        return o._wbg_cb_unref = ()=>{
            --r.cnt === 0 && (l.__wbindgen_destroy_closure(r.a, r.b), r.a = 0, sn.unregister(r));
        }, sn.register(o, r, r), o;
    }
    function Oe(e, t) {
        const n = t(e.length * 1, 1) >>> 0;
        return rt().set(e, n / 1), T = e.length, n;
    }
    function yl(e, t) {
        const n = t(e.length * 4, 4) >>> 0;
        for(let r = 0; r < e.length; r++){
            const o = ge(e[r]);
            ne().setUint32(n + 4 * r, o, !0);
        }
        return T = e.length, n;
    }
    function D(e, t, n) {
        if (typeof e != "string") throw new Error(`expected a string argument, found ${typeof e}`);
        if (n === void 0) {
            const a = wt.encode(e), c = t(a.length, 1) >>> 0;
            return rt().subarray(c, c + a.length).set(a), T = a.length, c;
        }
        let r = e.length, o = t(r, 1) >>> 0;
        const i = rt();
        let s = 0;
        for(; s < r; s++){
            const a = e.charCodeAt(s);
            if (a > 127) break;
            i[o + s] = a;
        }
        if (s !== r) {
            s !== 0 && (e = e.slice(s)), o = n(o, r, r = s + e.length * 3, 1) >>> 0;
            const a = rt().subarray(o + s, o + r), c = wt.encodeInto(e, a);
            if (c.read !== e.length) throw new Error("failed to pass whole string");
            s += c.written, o = n(o, r, s, 1) >>> 0;
        }
        return T = s, o;
    }
    function ye(e) {
        const t = l.__wbindgen_externrefs.get(e);
        return l.__externref_table_dealloc(e), t;
    }
    let Yt = new TextDecoder("utf-8", {
        ignoreBOM: !0,
        fatal: !0
    });
    Yt.decode();
    const vl = 2146435072;
    let Tn = 0;
    function kl(e, t) {
        return Tn += t, Tn >= vl && (Yt = new TextDecoder("utf-8", {
            ignoreBOM: !0,
            fatal: !0
        }), Yt.decode(), Tn = t), Yt.decode(rt().subarray(e, e + t));
    }
    const wt = new TextEncoder;
    "encodeInto" in wt || (wt.encodeInto = function(e, t) {
        const n = wt.encode(e);
        return t.set(n), {
            read: e.length,
            written: n.length
        };
    });
    let T = 0, l;
    function El(e) {
        l = e;
    }
    URL = globalThis.URL;
    const Sl = await ja({
        "./midden_bg.js": {
            __wbg_helloimageresult_new: Wc,
            __wbg_radiohandle_new: Zu,
            __wbg_bistream_new: rc,
            __wbg_middennode_new: cu,
            __wbg_set_8a16b38e4805b298: s_,
            __wbg_set_575dd786d51585f8: r_,
            __wbg_call_e3b662382210db98: fc,
            __wbg_call_44b7209e1e252e6a: uc,
            __wbg_set_6be42768c690e380: o_,
            __wbg_get_507a50627bffa49b: Lc,
            __wbg_String_8564e559799eccda: La,
            __wbg_new_227d7c05414eb861: du,
            __wbg_stack_3b0d974bbf31e44f: S_,
            __wbg_error_a6fa202b58aa1cd3: Tc,
            __wbg_length_370319915dc99107: iu,
            __wbg_log_7a0760e115750083: su,
            __wbg_warn_3a37cdd7216f1479: L_,
            __wbg_debug_eaef3b49d572d680: Ac,
            __wbg_error_71b0e71161a5f3a0: Cc,
            __wbg_next_71f2aa1cb3d1e37e: zu,
            __wbg_done_89b2b13e91a60321: zc,
            __wbg_value_a5d5488a9589444a: B_,
            __wbg_push_d2ae3af0c1217ae6: Ru,
            __wbg_setTimeout_3a808dd861dd3c12: e_,
            __wbg_clearTimeout_333bba87532ab9d3: pc,
            __wbg_fetch_074561c3e313c86f: Pc,
            __wbg_then_16d107c451e9905d: x_,
            __wbg_catch_c1a60df4c30d76d3: gc,
            __wbg_call_a6e5c5dce5018821: lc,
            __wbg_new_typed_1824d93f294193e5: ku,
            __wbg_getReader_9facd4f899beac89: jc,
            __wbg_instanceof_Window_05ba1ee4f6781663: tu,
            __wbg_navigator_99621db14b3f1099: lu,
            __wbg_fetch_b5951fc96f52f786: Nc,
            __wbg_navigator_51379c10a84aeec9: _u,
            __wbg_instanceof_WorkerGlobalScope_8ec07b5e040a41c3: nu,
            __wbg_set_method_5532d59b92d76467: h_,
            __wbg_set_signal_c4ef8faddb4c1446: k_,
            __wbg_set_headers_9c61d123c3ee1f10: p_,
            __wbg_set_credentials_bb34a40189e3b43b: d_,
            __wbg_set_body_029f2d171e0a005f: u_,
            __wbg_set_mode_66c79886ad78fc05: b_,
            __wbg_set_cache_b4a740b195c051f4: __,
            __wbg_addEventListener_c33b246adf950d7c: ec,
            __wbg_removeEventListener_eb8291c80ca9056d: Ku,
            __wbg_set_at_674f6538cd77adef: a_,
            __wbg_set_create_fa1dfa475fac91e9: f_,
            __wbg_storage_756400487605531a: P_,
            __wbg_instanceof_FileSystemFileHandle_68e80b30532d5f04: Qc,
            __wbg_createSyncAccessHandle_0caafebe31e4f2d9: Ec,
            __wbg_respond_510e32df8aeb6817: Gu,
            __wbg_view_21f1d4a4f175dfa9: F_,
            __wbg_new_0d809930cd1354c6: fu,
            __wbg_append_01c74e5c6b58aa64: tc,
            __wbg_entries_900cefd6f70eb290: Oc,
            __wbg_code_1fc52b4142a112ac: vc,
            __wbg_reason_5dc8e429d537d6a9: qu,
            __wbg_wasClean_3c7aa2335da09e74: U_,
            __wbg_set_handle_event_dd6bc370a8cb4486: g_,
            __wbg_byobRequest_06b654bb15590436: sc,
            __wbg_close_72d318d9c16e83ef: mc,
            __wbg_storage_3c893ad40b9e831e: T_,
            __wbg_releaseLock_5b92874cad775644: Ju,
            __wbg_read_8afa15f12a160ef8: Lu,
            __wbg_cancel_3983a93e24cc66b3: dc,
            __wbg_new_with_str_and_init_d95cbe11ce28e65e: $u,
            __wbg_set_onopen_4f65470ae522a61a: v_,
            __wbg_readyState_50bc38c2a9e83db6: Uu,
            __wbg_set_onclose_f706475385ecce07: m_,
            __wbg_set_onerror_9f5773fd31512333: w_,
            __wbg_send_df98dd5ede9b3f4d: Xu,
            __wbg_set_onmessage_836d2f72130b4706: y_,
            __wbg_set_binaryType_a37b086c78ca7c29: c_,
            __wbg_send_a321b376d40ec867: Qu,
            __wbg_new_with_str_sequence_2de2f569c29910ad: Au,
            __wbg_new_bf8729ffe10e9ee7: mu,
            __wbg_url_a410c0bec2fb1b2c: M_,
            __wbg_close_c65ca0257e895318: wc,
            __wbg_protocol_14b3b1c4bf71cd4a: Nu,
            __wbg_getDirectory_389283588dfb8117: Dc,
            __wbg_set_create_a807a6e9ac628698: l_,
            __wbg_instanceof_FileSystemSyncAccessHandle_db0b7504516129c1: Xc,
            __wbg_truncate_98a6032d23095328: D_,
            __wbg_read_27d98fb08886b1fc: Fu,
            __wbg_write_e557b5312ec23477: q_,
            __wbg_close_d00f4cb641f9db10: yc,
            __wbg_flush_a4bd8d4e05ad23f6: xc,
            __wbg_getSize_29187e13478442fb: Fc,
            __wbg_data_328de4280640da92: $c,
            __wbg_abort_eee9248a6d680839: Xa,
            __wbg_new_4339b2a2675a03e3: pu,
            __wbg_abort_8bae0f33e7833997: Qa,
            __wbg_signal_dad7cb35193abd31: E_,
            __wbg_get_done_670108eb06ecbe46: qc,
            __wbg_get_value_f465f5be30aa0963: Jc,
            __wbg_instanceof_FileSystemDirectoryHandle_c9ab7c5cdb7a7c30: Yc,
            __wbg_removeEntry_e38219fa4a98cfb3: Vu,
            __wbg_getFileHandle_72de55ab3ca9ad57: Mc,
            __wbg_getDirectoryHandle_cf175faf1a75a384: Rc,
            __wbg_instanceof_Blob_c6523f92a32c8695: Gc,
            __wbg_instanceof_Response_c8b64b2256f01bec: eu,
            __wbg_arrayBuffer_3b637f0fa65c5351: nc,
            __wbg_url_abdb8fb08377f8c0: Z_,
            __wbg_body_18c9f2ac15ead4b2: oc,
            __wbg_status_c45b3b9b3033184a: C_,
            __wbg_headers_cf9c80f30e2a4eff: Kc,
            __wbg_code_cb4327cfc515673b: kc,
            __wbg_message_fb0e6e7854e6ea7a: au,
            __wbg_enqueue_6d83b4c6281bafd6: Ic,
            __wbg_close_249a23304523681b: bc,
            __wbg_randomFillSync_6c25eac9869eb53c: Bu,
            __wbg_crypto_38df2bab126b63dc: Sc,
            __wbg_process_44c7a14e11e9f69e: Pu,
            __wbg_msCrypto_bd5a034af96bcba6: uu,
            __wbg_require_b4edbdcf3e2a1ef0: Wu,
            __wbg_versions_276b2795b1c6a219: j_,
            __wbg_node_84ea875411254db1: Iu,
            __wbg_getRandomValues_c44a50d8cfdaebeb: Zc,
            __wbg_getRandomValues_cc7f052a444bb2ce: Bc,
            __wbg_clearTimeout_47a40e3be01ed7a3: hc,
            __wbg_setTimeout_6613a51400c1bf9f: t_,
            __wbg_now_e7c6795a7f81e10f: Cu,
            __wbg_performance_3fcf6e32a7e1ed0a: Tu,
            __wbg_byteLength_41862ca4020b9c43: ac,
            __wbg_byteOffset_d42e18c4441f628b: cc,
            __wbg_prototypesetcall_4770620bbe4688a0: xu,
            __wbg_new_from_slice_77cdfb7977362f3c: vu,
            __wbg_set_4d7dd76f3dae2926: n_,
            __wbg_new_with_length_e6785c33c8e4cce8: Su,
            __wbg_new_with_byte_offset_and_length_54c7724ee3ec7d82: Eu,
            __wbg_new_cd45aabdf6073e84: wu,
            __wbg_buffer_54b87055582c8a81: ic,
            __wbg_length_1f0964f4a5e2c6d8: ou,
            __wbg_subarray_3ed232c8a6baee09: N_,
            __wbg_then_6ec10ae38b3e92f7: R_,
            __wbg_call_8a2dd23819f8a60a: _c,
            __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: Hc,
            __wbg_new_7796ffc7ed656783: hu,
            __wbg_now_86c0d4ba3fa605b8: Ou,
            __wbg_new_32b398fb48b6d94a: gu,
            __wbg_isArray_0677c962b281d01a: ru,
            __wbg_new_b667d279fd5aa943: bu,
            __wbg_new_da52cf8fe3429cb2: yu,
            __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: z_,
            __wbg_static_accessor_SELF_146583524fe1469b: I_,
            __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: A_,
            __wbg_static_accessor_WINDOW_f2829a2234d7819e: O_,
            __wbg_resolve_2191a4dfe481c25b: Hu,
            __wbg_random_039a7d5d06e0d333: ju,
            __wbg_static_accessor_CREATE_TASK_7ee0dd8bc83df5b2: $_,
            __wbg_run_5aa314612b150933: Yu,
            __wbg_get_78f252d074a84d0b: Uc,
            __wbg_has_8374cf06984d8bfc: Vc,
            __wbg_set_8535240470bf2500: i_,
            __wbg_queueMicrotask_6a09b7bc46549209: Mu,
            __wbg_queueMicrotask_0ab5b2d2393e99b9: Du,
            __wbg__wbg_cb_unref_fffb441def202758: Ya,
            __wbg___wbindgen_throw_344f42d3211c4765: Ga,
            __wbg_Error_92b29b0548f8b746: Fa,
            __wbg___wbindgen_is_object_a27215656b807791: Va,
            __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: Ka,
            __wbg___wbindgen_string_get_b0ca35b86a603356: Ha,
            __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: Ua,
            __wbg___wbindgen_is_function_1ff95bcc5517c252: Ja,
            __wbg___wbindgen_debug_string_c25d447a39f5578f: qa,
            __wbg___wbindgen_is_undefined_c05833b95a3cf397: Wa,
            __wbindgen_init_externref_table: ol,
            __wbindgen_cast_0000000000000001: J_,
            __wbindgen_cast_0000000000000002: V_,
            __wbindgen_cast_0000000000000003: K_,
            __wbindgen_cast_0000000000000004: W_,
            __wbindgen_cast_0000000000000005: H_,
            __wbindgen_cast_0000000000000006: G_,
            __wbindgen_cast_0000000000000007: Y_,
            __wbindgen_cast_0000000000000008: Q_,
            __wbindgen_cast_0000000000000009: X_,
            __wbindgen_cast_000000000000000a: el,
            __wbindgen_cast_000000000000000b: tl,
            __wbindgen_cast_000000000000000c: nl,
            __wbindgen_cast_000000000000000d: rl
        }
    }, Ba), { memory: $l, __wbg_bistream_free: Al, __wbg_blake3hasher_free: zl, __wbg_canceltoken_free: Il, __wbg_helloimageresult_free: Ol, __wbg_importsession_free: Cl, __wbg_middennode_free: Tl, __wbg_middennodeoptions_free: Pl, bistream_alpn: Nl, bistream_close: xl, bistream_peer_node_id: Rl, bistream_read_line: Dl, bistream_read_message: Ml, bistream_read_to_end: Zl, bistream_write_line: Bl, bistream_write_message: jl, bistream_write_raw_and_finish: Fl, blake3hasher_finalize: Ll, blake3hasher_new: Ul, blake3hasher_update: ql, canceltoken_cancel: Jl, canceltoken_clone_token: Vl, canceltoken_is_cancelled: Kl, canceltoken_new: Wl, hash_blake3: Hl, helloimageresult_content_type: Gl, helloimageresult_data: Yl, importsession_abort: Ql, importsession_finish: Xl, importsession_push: ef, middennode_accept: tf, middennode_active_blob_count: nf, middennode_api_request: rf, middennode_clear_blob_restriction: of, middennode_compute_blake3: sf, middennode_create: af, middennode_create_from_key: cf, middennode_create_with_alpns: uf, middennode_create_with_options: _f, middennode_download_verified: lf, middennode_download_verified_by_id: ff, middennode_download_verified_by_id_progress: df, middennode_download_verified_streaming: gf, middennode_download_verified_streaming_with_ensure: pf, middennode_download_verified_with_ensure: hf, middennode_download_verified_with_ensure_progress: bf, middennode_download_verified_with_progress: mf, middennode_ensure_blob: wf, middennode_fetch_hello_image: yf, middennode_get_active_transfers: vf, middennode_has_active_blob: kf, middennode_has_complete_blob: Ef, middennode_import_bao: Sf, middennode_import_blob: $f, middennode_import_blob_and_export_bao: Af, middennode_node_addr: zf, middennode_node_id: If, middennode_open_bi: Of, middennode_protect_blob: Cf, middennode_proxy_admin: Tf, middennode_release_blob: Pf, middennode_restrict_blob_to_peers: Nf, middennode_secret_key: xf, middennode_start_blob_server: Rf, middennode_start_import: Df, middennode_unprotect_blob: Mf, middennodeoptions_get_connect_timeout_ms: Zf, middennodeoptions_get_extra_alpns: Bf, middennodeoptions_get_opfs_store_dir: jf, middennodeoptions_get_secret_key: Ff, middennodeoptions_new: Lf, middennodeoptions_set_connect_timeout_ms: Uf, middennodeoptions_set_extra_alpns: qf, middennodeoptions_set_opfs_store_dir: Jf, middennodeoptions_set_secret_key: Vf, opfs_store_selftest: Kf, opfs_store_selftest_persistence: Wf, start: Hf, __wbg_radiohandle_free: Gf, middennode_tune_radio: Yf, radiohandle_leave: Qf, __wbg_intounderlyingbytesource_free: Xf, intounderlyingbytesource_autoAllocateChunkSize: ed, intounderlyingbytesource_cancel: td, intounderlyingbytesource_pull: nd, intounderlyingbytesource_start: rd, intounderlyingbytesource_type: od, __wbg_intounderlyingsource_free: id, intounderlyingsource_cancel: sd, intounderlyingsource_pull: ad, __wbg_intounderlyingsink_free: cd, intounderlyingsink_abort: ud, intounderlyingsink_close: _d, intounderlyingsink_write: ld, ring_core_0_17_14__bn_mul_mont: fd, __abort_handler: dd, __instance_terminated: gd, wasm_bindgen__convert__closures_____invoke__h009da3dd3294e065: pd, wasm_bindgen__convert__closures_____invoke__h744df718fbe3badf: hd, wasm_bindgen__convert__closures_____invoke__h9bfafcd5df7f650f: bd, wasm_bindgen__convert__closures_____invoke__h3cac54e009c37b19: md, wasm_bindgen__convert__closures_____invoke__h0b2903c49209e780: wd, wasm_bindgen__convert__closures_____invoke__h72d513d189e25b7d: yd, wasm_bindgen__convert__closures_____invoke__hc8728011322ac642: vd, wasm_bindgen__convert__closures_____invoke__h664b7a54f532788b: kd, wasm_bindgen__convert__closures_____invoke__hdf2e0feb328f9c9c: Ed, wasm_bindgen__convert__closures_____invoke__h53f0ac92999d4a51: Sd, __wbindgen_malloc: $d, __wbindgen_realloc: Ad, __wbindgen_exn_store: zd, __externref_table_alloc: Id, __wbindgen_externrefs: Od, __externref_drop_slice: Cd, __wbindgen_free: Td, __wbindgen_destroy_closure: Pd, __externref_table_dealloc: Nd, __wbindgen_start: ts } = Sl, xd = Object.freeze(Object.defineProperty({
        __proto__: null,
        __abort_handler: dd,
        __externref_drop_slice: Cd,
        __externref_table_alloc: Id,
        __externref_table_dealloc: Nd,
        __instance_terminated: gd,
        __wbg_bistream_free: Al,
        __wbg_blake3hasher_free: zl,
        __wbg_canceltoken_free: Il,
        __wbg_helloimageresult_free: Ol,
        __wbg_importsession_free: Cl,
        __wbg_intounderlyingbytesource_free: Xf,
        __wbg_intounderlyingsink_free: cd,
        __wbg_intounderlyingsource_free: id,
        __wbg_middennode_free: Tl,
        __wbg_middennodeoptions_free: Pl,
        __wbg_radiohandle_free: Gf,
        __wbindgen_destroy_closure: Pd,
        __wbindgen_exn_store: zd,
        __wbindgen_externrefs: Od,
        __wbindgen_free: Td,
        __wbindgen_malloc: $d,
        __wbindgen_realloc: Ad,
        __wbindgen_start: ts,
        bistream_alpn: Nl,
        bistream_close: xl,
        bistream_peer_node_id: Rl,
        bistream_read_line: Dl,
        bistream_read_message: Ml,
        bistream_read_to_end: Zl,
        bistream_write_line: Bl,
        bistream_write_message: jl,
        bistream_write_raw_and_finish: Fl,
        blake3hasher_finalize: Ll,
        blake3hasher_new: Ul,
        blake3hasher_update: ql,
        canceltoken_cancel: Jl,
        canceltoken_clone_token: Vl,
        canceltoken_is_cancelled: Kl,
        canceltoken_new: Wl,
        hash_blake3: Hl,
        helloimageresult_content_type: Gl,
        helloimageresult_data: Yl,
        importsession_abort: Ql,
        importsession_finish: Xl,
        importsession_push: ef,
        intounderlyingbytesource_autoAllocateChunkSize: ed,
        intounderlyingbytesource_cancel: td,
        intounderlyingbytesource_pull: nd,
        intounderlyingbytesource_start: rd,
        intounderlyingbytesource_type: od,
        intounderlyingsink_abort: ud,
        intounderlyingsink_close: _d,
        intounderlyingsink_write: ld,
        intounderlyingsource_cancel: sd,
        intounderlyingsource_pull: ad,
        memory: $l,
        middennode_accept: tf,
        middennode_active_blob_count: nf,
        middennode_api_request: rf,
        middennode_clear_blob_restriction: of,
        middennode_compute_blake3: sf,
        middennode_create: af,
        middennode_create_from_key: cf,
        middennode_create_with_alpns: uf,
        middennode_create_with_options: _f,
        middennode_download_verified: lf,
        middennode_download_verified_by_id: ff,
        middennode_download_verified_by_id_progress: df,
        middennode_download_verified_streaming: gf,
        middennode_download_verified_streaming_with_ensure: pf,
        middennode_download_verified_with_ensure: hf,
        middennode_download_verified_with_ensure_progress: bf,
        middennode_download_verified_with_progress: mf,
        middennode_ensure_blob: wf,
        middennode_fetch_hello_image: yf,
        middennode_get_active_transfers: vf,
        middennode_has_active_blob: kf,
        middennode_has_complete_blob: Ef,
        middennode_import_bao: Sf,
        middennode_import_blob: $f,
        middennode_import_blob_and_export_bao: Af,
        middennode_node_addr: zf,
        middennode_node_id: If,
        middennode_open_bi: Of,
        middennode_protect_blob: Cf,
        middennode_proxy_admin: Tf,
        middennode_release_blob: Pf,
        middennode_restrict_blob_to_peers: Nf,
        middennode_secret_key: xf,
        middennode_start_blob_server: Rf,
        middennode_start_import: Df,
        middennode_tune_radio: Yf,
        middennode_unprotect_blob: Mf,
        middennodeoptions_get_connect_timeout_ms: Zf,
        middennodeoptions_get_extra_alpns: Bf,
        middennodeoptions_get_opfs_store_dir: jf,
        middennodeoptions_get_secret_key: Ff,
        middennodeoptions_new: Lf,
        middennodeoptions_set_connect_timeout_ms: Uf,
        middennodeoptions_set_extra_alpns: qf,
        middennodeoptions_set_opfs_store_dir: Jf,
        middennodeoptions_set_secret_key: Vf,
        opfs_store_selftest: Kf,
        opfs_store_selftest_persistence: Wf,
        radiohandle_leave: Qf,
        ring_core_0_17_14__bn_mul_mont: fd,
        start: Hf,
        wasm_bindgen__convert__closures_____invoke__h009da3dd3294e065: pd,
        wasm_bindgen__convert__closures_____invoke__h0b2903c49209e780: wd,
        wasm_bindgen__convert__closures_____invoke__h3cac54e009c37b19: md,
        wasm_bindgen__convert__closures_____invoke__h53f0ac92999d4a51: Sd,
        wasm_bindgen__convert__closures_____invoke__h664b7a54f532788b: kd,
        wasm_bindgen__convert__closures_____invoke__h72d513d189e25b7d: yd,
        wasm_bindgen__convert__closures_____invoke__h744df718fbe3badf: hd,
        wasm_bindgen__convert__closures_____invoke__h9bfafcd5df7f650f: bd,
        wasm_bindgen__convert__closures_____invoke__hc8728011322ac642: vd,
        wasm_bindgen__convert__closures_____invoke__hdf2e0feb328f9c9c: Ed
    }, Symbol.toStringTag, {
        value: "Module"
    }));
    El(xd);
    ts();
    const Dr = "p2p_identity";
    async function Rd(e) {
        if (typeof indexedDB.databases == "function") try {
            return (await indexedDB.databases()).some((n)=>n.name === e);
        } catch  {}
        return Dd(e);
    }
    function Dd(e) {
        return new Promise((t)=>{
            const n = indexedDB.open(e);
            let r = !0;
            n.onupgradeneeded = (o)=>{
                r = !1, o.target.transaction?.abort();
            }, n.onsuccess = ()=>{
                n.result.close(), r || indexedDB.deleteDatabase(e), t(r);
            }, n.onerror = ()=>{
                t(r);
            };
        });
    }
    async function Mr(e) {
        return await Rd(e) ? new Promise((t)=>{
            const n = indexedDB.open(e);
            n.onupgradeneeded = (r)=>{
                r.target.transaction?.abort(), t(null);
            }, n.onsuccess = ()=>t(n.result), n.onerror = ()=>t(null);
        }) : null;
    }
    async function ns(e) {
        const t = await Mr(e.databaseName);
        if (!t) return !1;
        const n = t.objectStoreNames.contains(e.storeName);
        return t.close(), n;
    }
    function rs(e, t, n) {
        return new Promise((r, o)=>{
            const s = e.transaction(t, "readonly").objectStore(t).get(n);
            s.onsuccess = ()=>r(s.result ?? null), s.onerror = ()=>o(s.error);
        });
    }
    function os(e, t, n, r) {
        return new Promise((o, i)=>{
            const a = e.transaction(t, "readwrite").objectStore(t).put(r, n);
            a.onsuccess = ()=>o(), a.onerror = ()=>i(a.error);
        });
    }
    async function Md(e) {
        const t = await Mr(e.databaseName);
        if (!t) return null;
        try {
            return t.objectStoreNames.contains(e.storeName) ? await rs(t, e.storeName, e.key ?? Dr) : null;
        } finally{
            t.close();
        }
    }
    async function Zd(e, t) {
        const n = await Mr(e.databaseName);
        if (!n || !n.objectStoreNames.contains(e.storeName)) throw n?.close(), new Error(`identity source "${e.databaseName}" (store "${e.storeName}") does not exist`);
        try {
            await os(n, e.storeName, e.key ?? Dr, t);
        } finally{
            n.close();
        }
    }
    async function Bd(e) {
        return new Promise((t, n)=>{
            const r = indexedDB.open(e);
            r.onsuccess = ()=>t(r.result), r.onerror = ()=>n(r.error);
        });
    }
    function jd(e, t, n) {
        return new Promise((r, o)=>{
            const i = indexedDB.open(e, t);
            i.onupgradeneeded = ()=>{
                const s = i.result;
                s.objectStoreNames.contains(n) || s.createObjectStore(n);
            }, i.onsuccess = ()=>r(i.result), i.onerror = ()=>o(i.error);
        });
    }
    async function bo(e, t) {
        const n = await Bd(e);
        if (n.objectStoreNames.contains(t)) return n;
        const r = n.version + 1;
        return n.close(), jd(e, r, t);
    }
    function Fd(e) {
        const t = e.key ?? Dr;
        return {
            async get () {
                const n = await bo(e.databaseName, e.storeName);
                try {
                    return await rs(n, e.storeName, t);
                } finally{
                    n.close();
                }
            },
            async set (n) {
                const r = await bo(e.databaseName, e.storeName);
                try {
                    await os(r, e.storeName, t, n);
                } finally{
                    r.close();
                }
            }
        };
    }
    async function Ld(e, t = {}) {
        for (const n of t.fallbackSources ?? []){
            if (!await ns(n)) continue;
            const r = await Md(n);
            if (r) return r;
        }
        return e.get();
    }
    async function Ud(e, t, n = {}) {
        for (const r of n.fallbackSources ?? [])if (await ns(r)) {
            await Zd(r, e);
            return;
        }
        await t.set(e);
    }
    const is = "freqhole-player/1", qd = "freqhole/1", Jd = "freqhole_player", Vd = "identity", mo = Fd({
        databaseName: Jd,
        storeName: Vd
    });
    let Pn = null, Zt = null;
    async function Kd() {
        return Pn || Zt || (Zt = (async ()=>{
            const e = await Ld(mo), t = new on;
            t.extra_alpns = [
                is
            ];
            let n;
            return e ? (t.secret_key = e.secret_key, n = await qe.create_with_options(t)) : (n = await qe.create_with_options(t), await Ud({
                secret_key: n.secret_key(),
                node_id: n.node_id(),
                created_at: Date.now()
            }, mo)), Pn = n, n;
        })(), Zt);
    }
    const Wd = 6, wo = "0123456789abcdef";
    function ss() {
        const e = new Uint8Array(Wd);
        crypto.getRandomValues(e);
        let t = "";
        for (const n of e)t += wo[n % wo.length];
        return t;
    }
    const [Hd, Gd] = W(ss()), Zr = Hd;
    function Yd() {
        const e = ss();
        return Gd(e), e;
    }
    const Qd = 5, Xd = 6e4, Ot = new Map;
    function eg(e) {
        const t = Ot.get(e);
        if (!t) return !1;
        const n = Date.now() - Xd, r = t.filter((o)=>o > n);
        return Ot.set(e, r), r.length >= Qd;
    }
    function yo(e) {
        const t = Ot.get(e) ?? [];
        t.push(Date.now()), Ot.set(e, t);
    }
    function tg(e) {
        Ot.delete(e);
    }
    const wr = (e, t)=>t.some((n)=>e instanceof n);
    let vo, ko;
    function ng() {
        return vo || (vo = [
            IDBDatabase,
            IDBObjectStore,
            IDBIndex,
            IDBCursor,
            IDBTransaction
        ]);
    }
    function rg() {
        return ko || (ko = [
            IDBCursor.prototype.advance,
            IDBCursor.prototype.continue,
            IDBCursor.prototype.continuePrimaryKey
        ]);
    }
    const yr = new WeakMap, Nn = new WeakMap, gn = new WeakMap;
    function og(e) {
        const t = new Promise((n, r)=>{
            const o = ()=>{
                e.removeEventListener("success", i), e.removeEventListener("error", s);
            }, i = ()=>{
                n(Fe(e.result)), o();
            }, s = ()=>{
                r(e.error), o();
            };
            e.addEventListener("success", i), e.addEventListener("error", s);
        });
        return gn.set(t, e), t;
    }
    function ig(e) {
        if (yr.has(e)) return;
        const t = new Promise((n, r)=>{
            const o = ()=>{
                e.removeEventListener("complete", i), e.removeEventListener("error", s), e.removeEventListener("abort", s);
            }, i = ()=>{
                n(), o();
            }, s = ()=>{
                r(e.error || new DOMException("AbortError", "AbortError")), o();
            };
            e.addEventListener("complete", i), e.addEventListener("error", s), e.addEventListener("abort", s);
        });
        yr.set(e, t);
    }
    let vr = {
        get (e, t, n) {
            if (e instanceof IDBTransaction) {
                if (t === "done") return yr.get(e);
                if (t === "store") return n.objectStoreNames[1] ? void 0 : n.objectStore(n.objectStoreNames[0]);
            }
            return Fe(e[t]);
        },
        set (e, t, n) {
            return e[t] = n, !0;
        },
        has (e, t) {
            return e instanceof IDBTransaction && (t === "done" || t === "store") ? !0 : t in e;
        }
    };
    function as(e) {
        vr = e(vr);
    }
    function sg(e) {
        return rg().includes(e) ? function(...t) {
            return e.apply(kr(this), t), Fe(this.request);
        } : function(...t) {
            return Fe(e.apply(kr(this), t));
        };
    }
    function ag(e) {
        return typeof e == "function" ? sg(e) : (e instanceof IDBTransaction && ig(e), wr(e, ng()) ? new Proxy(e, vr) : e);
    }
    function Fe(e) {
        if (e instanceof IDBRequest) return og(e);
        if (Nn.has(e)) return Nn.get(e);
        const t = ag(e);
        return t !== e && (Nn.set(e, t), gn.set(t, e)), t;
    }
    const kr = (e)=>gn.get(e);
    function cs(e, t, { blocked: n, upgrade: r, blocking: o, terminated: i } = {}) {
        const s = indexedDB.open(e, t), a = Fe(s);
        return r && s.addEventListener("upgradeneeded", (c)=>{
            r(Fe(s.result), c.oldVersion, c.newVersion, Fe(s.transaction), c);
        }), n && s.addEventListener("blocked", (c)=>n(c.oldVersion, c.newVersion, c)), a.then((c)=>{
            i && c.addEventListener("close", ()=>i()), o && c.addEventListener("versionchange", (u)=>o(u.oldVersion, u.newVersion, u));
        }).catch(()=>{}), a;
    }
    const cg = [
        "get",
        "getKey",
        "getAll",
        "getAllKeys",
        "count"
    ], ug = [
        "put",
        "add",
        "delete",
        "clear"
    ], xn = new Map;
    function Eo(e, t) {
        if (!(e instanceof IDBDatabase && !(t in e) && typeof t == "string")) return;
        if (xn.get(t)) return xn.get(t);
        const n = t.replace(/FromIndex$/, ""), r = t !== n, o = ug.includes(n);
        if (!(n in (r ? IDBIndex : IDBObjectStore).prototype) || !(o || cg.includes(n))) return;
        const i = async function(s, ...a) {
            const c = this.transaction(s, o ? "readwrite" : "readonly");
            let u = c.store;
            return r && (u = u.index(a.shift())), (await Promise.all([
                u[n](...a),
                o && c.done
            ]))[0];
        };
        return xn.set(t, i), i;
    }
    as((e)=>({
            ...e,
            get: (t, n, r)=>Eo(t, n) || e.get(t, n, r),
            has: (t, n)=>!!Eo(t, n) || e.has(t, n)
        }));
    const _g = [
        "continue",
        "continuePrimaryKey",
        "advance"
    ], So = {}, Er = new WeakMap, us = new WeakMap, lg = {
        get (e, t) {
            if (!_g.includes(t)) return e[t];
            let n = So[t];
            return n || (n = So[t] = function(...r) {
                Er.set(this, us.get(this)[t](...r));
            }), n;
        }
    };
    async function* fg(...e) {
        let t = this;
        if (t instanceof IDBCursor || (t = await t.openCursor(...e)), !t) return;
        t = t;
        const n = new Proxy(t, lg);
        for(us.set(n, t), gn.set(n, kr(t)); t;)yield n, t = await (Er.get(n) || t.continue()), Er.delete(n);
    }
    function $o(e, t) {
        return t === Symbol.asyncIterator && wr(e, [
            IDBIndex,
            IDBObjectStore,
            IDBCursor
        ]) || t === "iterate" && wr(e, [
            IDBIndex,
            IDBObjectStore
        ]);
    }
    as((e)=>({
            ...e,
            get (t, n, r) {
                return $o(t, n) ? fg : e.get(t, n, r);
            },
            has (t, n) {
                return $o(t, n) || e.has(t, n);
            }
        }));
    const dg = "freqhole_player_trust", gg = 1, Je = "trusted_controllers";
    let Rn = null;
    function xt() {
        return Rn || (Rn = cs(dg, gg, {
            upgrade (e) {
                e.objectStoreNames.contains(Je) || e.createObjectStore(Je, {
                    keyPath: "node_id"
                });
            }
        })), Rn;
    }
    async function pg(e) {
        return await (await xt()).get(Je, e) !== void 0;
    }
    async function hg(e) {
        return (await xt()).get(Je, e);
    }
    async function bg(e, t) {
        const n = await xt(), r = {
            node_id: e,
            display_name: t,
            paired_at: Date.now()
        };
        await n.put(Je, r);
    }
    async function mg(e) {
        await (await xt()).delete(Je, e);
    }
    async function wg() {
        return (await xt()).getAll(Je);
    }
    function _s(e) {
        const t = Object.values(e).filter((r)=>typeof r == "number");
        return Object.entries(e).filter(([r, o])=>t.indexOf(+r) === -1).map(([r, o])=>o);
    }
    function Ao(e, t = "|") {
        return e.map((n)=>ds(n)).join(t);
    }
    function Sr(e, t) {
        return typeof t == "bigint" ? t.toString() : t;
    }
    function pn(e) {
        return {
            get value () {
                {
                    const t = e();
                    return Object.defineProperty(this, "value", {
                        value: t
                    }), t;
                }
            }
        };
    }
    function yg(e) {
        return e == null;
    }
    function Br(e) {
        const t = e.startsWith("^") ? 1 : 0, n = e.endsWith("$") ? e.length - 1 : e.length;
        return e.slice(t, n);
    }
    function vg(e, t) {
        const n = e / t, r = Math.round(n), o = 4 * Number.EPSILON * Math.max(Math.abs(n), 1);
        return Math.abs(n - r) < o ? 0 : n - r;
    }
    function _e(e, t, n) {
        Object.defineProperty(e, t, {
            value: n,
            writable: !0,
            enumerable: !0,
            configurable: !0
        });
    }
    function Me(...e) {
        const t = {};
        for (const n of e){
            const r = Object.getOwnPropertyDescriptors(n);
            Object.assign(t, r);
        }
        return Object.defineProperties({}, t);
    }
    function kg(e) {
        return JSON.stringify(e);
    }
    function Eg(e) {
        return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
    }
    const ls = "captureStackTrace" in Error ? Error.captureStackTrace : (...e)=>{};
    function Ct(e) {
        return typeof e == "object" && e !== null && !Array.isArray(e);
    }
    const Sg = pn(()=>{
        if (be.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
        try {
            const e = Function;
            return new e(""), !0;
        } catch  {
            return !1;
        }
    });
    function Tt(e) {
        if (Ct(e) === !1) return !1;
        const t = e.constructor;
        if (t === void 0 || typeof t != "function") return !0;
        const n = t.prototype;
        return !(Ct(n) === !1 || Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") === !1);
    }
    function fs(e) {
        return Tt(e) ? {
            ...e
        } : Array.isArray(e) ? [
            ...e
        ] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
    }
    const $g = new Set([
        "string",
        "number",
        "symbol"
    ]);
    function at(e) {
        return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function Ze(e, t, n) {
        const r = new e._zod.constr(t ?? e._zod.def);
        return (!t || n?.parent) && (r._zod.parent = e), r;
    }
    function x(e) {
        const t = e;
        if (!t) return {};
        if (typeof t == "string") return {
            error: ()=>t
        };
        if (t?.message !== void 0) {
            if (t?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
            t.error = t.message;
        }
        return delete t.message, typeof t.error == "string" ? {
            ...t,
            error: ()=>t.error
        } : t;
    }
    function ds(e) {
        return typeof e == "bigint" ? e.toString() + "n" : typeof e == "string" ? `"${e}"` : `${e}`;
    }
    function Ag(e) {
        return Object.keys(e).filter((t)=>e[t]._zod.optin !== void 0 && e[t]._zod.optout === "optional");
    }
    const zg = {
        safeint: [
            Number.MIN_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER
        ],
        int32: [
            -2147483648,
            2147483647
        ],
        uint32: [
            0,
            4294967295
        ],
        float32: [
            -34028234663852886e22,
            34028234663852886e22
        ],
        float64: [
            -Number.MAX_VALUE,
            Number.MAX_VALUE
        ]
    };
    function Ig(e, t) {
        const n = e._zod.def, r = n.checks;
        if (r && r.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
        const i = Me(e._zod.def, {
            get shape () {
                const s = {};
                for (const a of Reflect.ownKeys(t)){
                    if (!Object.prototype.hasOwnProperty.call(n.shape, a)) throw new Error(`Unrecognized key: "${String(a)}"`);
                    t[a] && _e(s, a, n.shape[a]);
                }
                return _e(this, "shape", s), s;
            },
            checks: []
        });
        return Ze(e, i);
    }
    function Og(e, t) {
        const n = e._zod.def, r = n.checks;
        if (r && r.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
        const i = Me(e._zod.def, {
            get shape () {
                const s = {
                    ...e._zod.def.shape
                };
                for (const a of Reflect.ownKeys(t)){
                    if (!Object.prototype.hasOwnProperty.call(n.shape, a)) throw new Error(`Unrecognized key: "${String(a)}"`);
                    t[a] && delete s[a];
                }
                return _e(this, "shape", s), s;
            },
            checks: []
        });
        return Ze(e, i);
    }
    function Cg(e, t) {
        if (!Tt(t)) throw new Error("Invalid input to extend: expected a plain object");
        const n = e._zod.def.checks;
        if (n && n.length > 0) {
            const i = e._zod.def.shape;
            for (const s of Reflect.ownKeys(t))if (Object.getOwnPropertyDescriptor(i, s) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
        }
        const o = Me(e._zod.def, {
            get shape () {
                const i = {
                    ...e._zod.def.shape,
                    ...t
                };
                return _e(this, "shape", i), i;
            }
        });
        return Ze(e, o);
    }
    function Tg(e, t) {
        if (!Tt(t)) throw new Error("Invalid input to safeExtend: expected a plain object");
        const n = Me(e._zod.def, {
            get shape () {
                const r = {
                    ...e._zod.def.shape,
                    ...t
                };
                return _e(this, "shape", r), r;
            }
        });
        return Ze(e, n);
    }
    function Pg(e, t) {
        if (!t?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
        if (e._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
        const n = Me(e._zod.def, {
            get shape () {
                const r = {
                    ...e._zod.def.shape,
                    ...t._zod.def.shape
                };
                return _e(this, "shape", r), r;
            },
            get catchall () {
                return t._zod.def.catchall;
            },
            checks: t._zod.def.checks ?? []
        });
        return Ze(e, n);
    }
    function zo(e, t, n, r = "partial") {
        const i = t._zod.def.checks;
        if (i && i.length > 0) throw new Error(`.${r}() cannot be used on object schemas containing refinements`);
        const a = Me(t._zod.def, {
            get shape () {
                const c = t._zod.def.shape, u = {
                    ...c
                };
                if (n) for (const _ of Reflect.ownKeys(n)){
                    if (!Object.prototype.hasOwnProperty.call(c, _)) throw new Error(`Unrecognized key: "${String(_)}"`);
                    n[_] && (u[_] = e ? new e({
                        type: "optional",
                        innerType: c[_]
                    }) : c[_]);
                }
                else for (const _ of Reflect.ownKeys(c))u[_] = e ? new e({
                    type: "optional",
                    innerType: c[_]
                }) : c[_];
                return _e(this, "shape", u), u;
            },
            checks: []
        });
        return Ze(t, a);
    }
    function Ng(e, t, n) {
        const r = Me(t._zod.def, {
            get shape () {
                const o = t._zod.def.shape, i = {
                    ...o
                };
                if (n) for (const s of Reflect.ownKeys(n)){
                    if (!Object.prototype.hasOwnProperty.call(i, s)) throw new Error(`Unrecognized key: "${String(s)}"`);
                    n[s] && (i[s] = new e({
                        type: "nonoptional",
                        innerType: o[s]
                    }));
                }
                else for (const s of Reflect.ownKeys(o))i[s] = new e({
                    type: "nonoptional",
                    innerType: o[s]
                });
                return _e(this, "shape", i), i;
            }
        });
        return Ze(t, r);
    }
    function tt(e, t = 0) {
        if (e.aborted === !0) return !0;
        for(let n = t; n < e.issues.length; n++)if (e.issues[n]?.continue !== !0) return !0;
        return !1;
    }
    function xg(e, t = 0) {
        if (e.aborted === !0) return !0;
        for(let n = t; n < e.issues.length; n++)if (e.issues[n]?.continue === !1) return !0;
        return !1;
    }
    function gs(e, t) {
        return t.map((n)=>{
            var r;
            return (r = n).path ?? (r.path = []), n.path.unshift(e), n;
        });
    }
    function gt(e) {
        return typeof e == "string" ? e : e?.message;
    }
    function Io(e, t, n) {
        var r;
        for(let o = t; o < e.length; o++)(r = e[o]).schema ?? (r.schema = n);
    }
    function ut(e, t, n) {
        var r;
        const o = e.inst?._zod?.traits;
        o?.has("$ZodType") && (o.has("$ZodCheck") ? (r = e).schema ?? (r.schema = e.inst) : e.schema = e.inst);
        const i = e.schema !== e.inst ? e.schema?._zod.def?.error : void 0, s = e.message ? e.message : gt(e.inst?._zod.def?.error?.(e)) ?? gt(i?.(e)) ?? gt(t?.error?.(e)) ?? gt(n.customError?.(e)) ?? gt(n.localeError?.(e)) ?? "Invalid input", { inst: a, schema: c, continue: u, input: _, ...f } = e;
        return f.path ?? (f.path = []), f.message = s, t?.reportInput && (f.input = _), f;
    }
    const Rg = /[\uD800-\uDBFF]/;
    function jr(e) {
        const t = e.length;
        if (!Rg.test(e)) return t;
        let n = t;
        for(let r = 0; r < t - 1; r++)(e.charCodeAt(r) & 64512) === 55296 && (e.charCodeAt(r + 1) & 64512) === 56320 && (n--, r++);
        return n;
    }
    function Fr(e) {
        return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
    }
    function Dg(e) {
        const t = typeof e;
        switch(t){
            case "number":
                return Number.isNaN(e) ? "nan" : "number";
            case "object":
                {
                    if (e === null) return "null";
                    if (Array.isArray(e)) return "array";
                    const n = e;
                    if (n && Object.getPrototypeOf(n) !== Object.prototype && "constructor" in n && n.constructor) return n.constructor.name;
                }
        }
        return t;
    }
    function Pt(...e) {
        const [t, n, r] = e;
        return typeof t == "string" ? {
            message: t,
            code: "custom",
            input: n,
            inst: r
        } : {
            ...t
        };
    }
    function Mg(e, t) {
        for(const n in t){
            const r = Object.getOwnPropertyDescriptor(t, n);
            r.get ? Object.defineProperty(e, n, {
                ...r,
                enumerable: !1
            }) : Zg(e, n, r.value);
        }
    }
    function Ne(e, t, n, r = !0) {
        return Object.defineProperty(e, t, {
            configurable: !0,
            writable: !0,
            enumerable: r,
            value: n
        }), n;
    }
    function ps(e, t, n) {
        return Ne(e, t, n, !1);
    }
    function Zg(e, t, n) {
        Object.defineProperty(e, t, {
            configurable: !0,
            get () {
                return Ne(this, t, n.bind(this));
            },
            set (r) {
                Ne(this, t, r);
            }
        });
    }
    function Bg(e, t) {
        const n = Object.getPrototypeOf(e);
        return t in n ? void 0 : n;
    }
    let Dn, Ie = !1;
    const jg = {
        configurable: !0,
        get () {
            Ie = !0;
        }
    };
    function U(e, t, n) {
        const r = Object.getPrototypeOf(e._zod);
        if (t in r && Dn !== e._zod) {
            Dn = void 0;
            return;
        }
        Dn = e._zod, Object.defineProperty(r, t, {
            configurable: !0,
            get () {
                Object.defineProperty(this, t, jg);
                const o = Ie;
                Ie = !1;
                try {
                    const i = n(this);
                    return Ie ? delete this[t] : Object.defineProperty(this, t, {
                        configurable: !0,
                        writable: !0,
                        value: i
                    }), Ie = Ie || o, i;
                } catch (i) {
                    throw delete this[t], Ie = Ie || o, i;
                }
            },
            set (o) {
                Object.defineProperty(this, t, {
                    configurable: !0,
                    writable: !0,
                    value: o
                });
            }
        });
    }
    function Fg(e, t, n, r) {
        const o = Bg(e, t);
        o && Object.defineProperty(o, t, {
            configurable: !0,
            get () {
                const i = {
                    configurable: !0,
                    writable: !0,
                    enumerable: r,
                    value: void 0
                };
                return Object.defineProperty(this, t, i), i.value = n(this), Object.defineProperty(this, t, i), i.value;
            },
            set (i) {
                Object.defineProperty(this, t, {
                    configurable: !0,
                    writable: !0,
                    enumerable: r,
                    value: i
                });
            }
        });
    }
    const Lg = "~constantCatch";
    function Ug(e) {
        const t = ()=>e;
        return t[Lg] = !0, t;
    }
    var Oo;
    const Mn = {
        value: void 0,
        enumerable: !1
    };
    let Co = "captureStackTrace" in Error ? Error : null;
    function qg(e) {
        const t = Co;
        if (t) {
            const n = t.stackTraceLimit;
            if (typeof n == "number") {
                try {
                    t.stackTraceLimit = 0;
                } catch  {
                    return Co = null, new e;
                }
                try {
                    return new e;
                } finally{
                    t.stackTraceLimit = n;
                }
            }
        }
        return new e;
    }
    function h(e, t, n, r) {
        const o = {};
        function i(d) {
            this.def = d, this.constr = f, this.traits = new Set;
        }
        i.prototype = o;
        const s = n, a = s && new WeakSet;
        function c(d, g) {
            if (!d._zod) {
                Mn.value = new i(g);
                try {
                    Object.defineProperty(d, "_zod", Mn);
                } finally{
                    Mn.value = void 0;
                }
            }
            if (d._zod.traits.has(e)) return;
            if (d._zod.traits.add(e), t(d, g), a) {
                const y = Object.getPrototypeOf(d), z = d._zod.constr.prototype;
                let k = y;
                for(; k && k !== z;)k = Object.getPrototypeOf(k);
                const O = k ?? y;
                a.has(O) || (a.add(O), Mg(O, s));
            }
            const b = f.prototype;
            for(const y in b)Object.prototype.hasOwnProperty.call(b, y) && (y in d || (d[y] = b[y].bind(d)));
        }
        const u = r?.Parent ?? Object;
        class _ extends u {
        }
        Object.defineProperty(_, "name", {
            value: e
        });
        function f(d) {
            const g = r?.Parent ? qg(_) : this;
            c(g, d);
            const b = g._zod.deferred;
            if (b) {
                for (const z of b)z();
                g._zod.deferred = void 0;
            }
            const y = globalThis.__zod_globalConfig?.postProcessor;
            return y && y(g), g;
        }
        return Object.defineProperty(f, "init", {
            value: c
        }), Object.defineProperty(f, Symbol.hasInstance, {
            value: (d)=>r?.Parent && d instanceof r.Parent ? !0 : d?._zod?.traits?.has(e)
        }), Object.defineProperty(f, "name", {
            value: e
        }), f;
    }
    class ot extends Error {
        constructor(){
            super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
        }
    }
    class hs extends Error {
        constructor(t){
            super(`Encountered unidirectional transform during encode: ${t}`), this.name = "ZodEncodeError";
        }
    }
    (Oo = globalThis).__zod_globalConfig ?? (Oo.__zod_globalConfig = {});
    const be = globalThis.__zod_globalConfig;
    function Be(e) {
        return e && Object.assign(be, e), be;
    }
    function Jg() {
        const e = this._zod;
        return e.message ?? (e.message = JSON.stringify(e.def, Sr, 2)), e.message;
    }
    function Vg(e) {
        this._zod.message = e;
    }
    const Kg = {
        get: Jg,
        set: Vg,
        enumerable: !0,
        configurable: !0
    }, Zn = {
        value: void 0,
        enumerable: !1
    }, Bn = {
        value: void 0,
        enumerable: !1
    }, To = new WeakSet([
        Object.prototype,
        Error.prototype
    ]), bs = (e, t)=>{
        e.name = "$ZodError", Zn.value = e._zod, Object.defineProperty(e, "_zod", Zn), Bn.value = t, Object.defineProperty(e, "issues", Bn), Zn.value = void 0, Bn.value = void 0, Object.defineProperty(e, "message", Kg);
        const n = Object.getPrototypeOf(e);
        To.has(n) || (To.add(n), Object.defineProperty(n, "toString", {
            configurable: !0,
            enumerable: !1,
            get () {
                const r = ()=>this.message;
                return Object.defineProperty(this, "toString", {
                    value: r,
                    configurable: !0,
                    writable: !0
                }), r;
            },
            set (r) {
                Object.defineProperty(this, "toString", {
                    value: r,
                    configurable: !0,
                    writable: !0
                });
            }
        }));
    }, ms = h("$ZodError", bs), ws = h("$ZodError", bs, void 0, {
        Parent: Error
    });
    function Wg(e, t, n) {
        return Object.prototype.hasOwnProperty.call(e, t) || (t === "__proto__" ? Object.defineProperty(e, t, {
            value: n(),
            writable: !0,
            enumerable: !0,
            configurable: !0
        }) : e[t] = n()), e[t];
    }
    function Hg(e, t = (n)=>n.message) {
        const n = {}, r = [];
        for (const o of e.issues)o.path.length > 0 ? Wg(n, o.path[0], ()=>[]).push(t(o)) : r.push(t(o));
        return {
            formErrors: r,
            fieldErrors: n
        };
    }
    function Gg(e, t = (n)=>n.message) {
        const n = {
            _errors: []
        }, r = (o, i = [])=>{
            for (const s of o.issues)if (s.code === "invalid_union" && s.errors.length) s.errors.map((a)=>r({
                    issues: a
                }, [
                    ...i,
                    ...s.path
                ]));
            else if (s.code === "invalid_key") r({
                issues: s.issues
            }, [
                ...i,
                ...s.path
            ]);
            else if (s.code === "invalid_element") r({
                issues: s.issues
            }, [
                ...i,
                ...s.path
            ]);
            else {
                const a = [
                    ...i,
                    ...s.path
                ];
                if (a.length === 0) n._errors.push(t(s));
                else {
                    let c = n, u = 0;
                    for(; u < a.length;){
                        const _ = a[u], f = u === a.length - 1;
                        if (_ === "_errors") {
                            f && c._errors.push(t(s)), u++;
                            continue;
                        }
                        Object.prototype.hasOwnProperty.call(c, _) || Object.defineProperty(c, _, {
                            value: {
                                _errors: []
                            },
                            enumerable: !0,
                            writable: !0,
                            configurable: !0
                        });
                        const d = c[_];
                        f && d._errors.push(t(s)), c = d, u++;
                    }
                }
            }
        };
        return r(e), n;
    }
    function hn(e, t) {
        return {
            callee: t?.callee ?? e,
            Err: t?.Err
        };
    }
    const Lr = (e)=>{
        const t = (n, r, o, i)=>{
            const s = o ? {
                ...o,
                async: !1
            } : {
                async: !1
            }, a = n._zod.run({
                value: r,
                issues: []
            }, s);
            if (a instanceof Promise) throw new ot;
            if (a.issues.length) {
                const c = new (i?.Err ?? e)(a.issues.map((u)=>ut(u, s, Be())));
                throw ls(c, i?.callee ?? t), c;
            }
            return a.value;
        };
        return t;
    }, Ur = (e)=>{
        const t = async (n, r, o, i)=>{
            const s = o ? {
                ...o,
                async: !0
            } : {
                async: !0
            };
            let a = n._zod.run({
                value: r,
                issues: []
            }, s);
            if (a instanceof Promise && (a = await a), a.issues.length) {
                const c = new (i?.Err ?? e)(a.issues.map((u)=>ut(u, s, Be())));
                throw ls(c, i?.callee ?? t), c;
            }
            return a.value;
        };
        return t;
    }, bn = (e)=>(t, n, r)=>{
            const o = r ? {
                ...r,
                async: !1
            } : {
                async: !1
            }, i = t._zod.run({
                value: n,
                issues: []
            }, o);
            if (i instanceof Promise) throw new ot;
            return i.issues.length ? {
                success: !1,
                error: new (e ?? ms)(i.issues.map((s)=>ut(s, o, Be())))
            } : {
                success: !0,
                data: i.value
            };
        }, Yg = bn(ws), mn = (e)=>async (t, n, r)=>{
            const o = r ? {
                ...r,
                async: !0
            } : {
                async: !0
            };
            let i = t._zod.run({
                value: n,
                issues: []
            }, o);
            return i instanceof Promise && (i = await i), i.issues.length ? {
                success: !1,
                error: new e(i.issues.map((s)=>ut(s, o, Be())))
            } : {
                success: !0,
                data: i.value
            };
        }, Qg = mn(ws), Xg = (e)=>{
        const t = Lr(e), n = (r, o, i, s)=>{
            const a = i ? {
                ...i,
                direction: "backward"
            } : {
                direction: "backward"
            };
            return t(r, o, a, hn(n, s));
        };
        return n;
    }, ep = (e)=>{
        const t = Lr(e), n = (r, o, i, s)=>t(r, o, i, hn(n, s));
        return n;
    }, tp = (e)=>{
        const t = Ur(e), n = async (r, o, i, s)=>{
            const a = i ? {
                ...i,
                direction: "backward"
            } : {
                direction: "backward"
            };
            return await t(r, o, a, hn(n, s));
        };
        return n;
    }, np = (e)=>{
        const t = Ur(e), n = async (r, o, i, s)=>await t(r, o, i, hn(n, s));
        return n;
    }, rp = (e)=>(t, n, r)=>{
            const o = r ? {
                ...r,
                direction: "backward"
            } : {
                direction: "backward"
            };
            return bn(e)(t, n, o);
        }, op = (e)=>(t, n, r)=>bn(e)(t, n, r), ip = (e)=>async (t, n, r)=>{
            const o = r ? {
                ...r,
                direction: "backward"
            } : {
                direction: "backward"
            };
            return mn(e)(t, n, o);
        }, sp = (e)=>async (t, n, r)=>mn(e)(t, n, r), ap = /^[cC][0-9a-z]{6,}$/, cp = /^[0-9a-z]+$/, up = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, _p = /^[0-9a-vA-V]{20}$/, lp = /^[A-Za-z0-9]{27}$/, fp = /^[a-zA-Z0-9_-]{21}$/;
    function dp(e) {
        return new RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
    }
    const gp = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, pp = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, Po = (e)=>e ? new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, hp = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, bp = "^[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
    function mp() {
        return new RegExp(bp, "u");
    }
    const wp = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, yp = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, vp = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, kp = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, Ep = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, ys = /^[A-Za-z0-9_-]*$/, Sp = /^https?$/, $p = /^\+[1-9]\d{6,14}$/, vs = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
    function Ap(e) {
        return new RegExp(`^${e}$`);
    }
    const zp = Ap(vs);
    function $r(e) {
        const t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
        return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : e.seconds ? `${t}:[0-5]\\d(?:\\.\\d+)?` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
    }
    function Ip(e) {
        return new RegExp(`^${$r(e)}$`);
    }
    function Op(e) {
        const t = [
            "Z"
        ];
        e.offset && t.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
        const n = `${$r({
            precision: e.precision,
            seconds: !0
        })}(?:${t.join("|")})`, r = e.local ? `${n}|${$r({
            precision: e.precision
        })}` : n;
        return new RegExp(`^${vs}T(?:${r})$`);
    }
    const Cp = (e)=>{
        const t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
        return new RegExp(`^${t}$`);
    }, Tp = /^-?\d+$/, Pp = /^-?\d+(?:\.\d+)?$/, Np = /^(?:true|false)$/i, xp = /^[^A-Z]*$/, Rp = /^[^a-z]*$/, le = h("$ZodCheck", (e, t)=>{
        var n;
        e._zod ?? (e._zod = {}), e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
    }), qr = (e)=>{
        const t = e.value;
        return !yg(t) && t.length !== void 0;
    }, an = {
        number: "number",
        bigint: "bigint",
        object: "date"
    }, ks = h("$ZodCheckLessThan", (e, t)=>{
        le.init(e, t);
        const n = an[typeof t.value];
        e._zod.onattach.push((r)=>{
            const o = r._zod.bag, i = (t.inclusive ? o.maximum : o.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
            t.value < i && (t.inclusive ? o.maximum = t.value : o.exclusiveMaximum = t.value);
        }), e._zod.check = (r)=>{
            (t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
                origin: an[typeof r.value] ?? n,
                code: "too_big",
                maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
                input: r.value,
                inclusive: t.inclusive,
                inst: e,
                continue: !t.abort
            });
        };
    }), Es = h("$ZodCheckGreaterThan", (e, t)=>{
        le.init(e, t);
        const n = an[typeof t.value];
        e._zod.onattach.push((r)=>{
            const o = r._zod.bag, i = (t.inclusive ? o.minimum : o.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
            t.value > i && (t.inclusive ? o.minimum = t.value : o.exclusiveMinimum = t.value);
        }), e._zod.check = (r)=>{
            (t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
                origin: an[typeof r.value] ?? n,
                code: "too_small",
                minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
                input: r.value,
                inclusive: t.inclusive,
                inst: e,
                continue: !t.abort
            });
        };
    }), Dp = h("$ZodCheckMultipleOf", (e, t)=>{
        le.init(e, t), e._zod.onattach.push((n)=>{
            var r;
            (r = n._zod.bag).multipleOf ?? (r.multipleOf = t.value);
        }), e._zod.check = (n)=>{
            if (typeof n.value != typeof t.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
            (typeof n.value == "bigint" ? t.value !== BigInt(0) && n.value % t.value === BigInt(0) : vg(n.value, t.value) === 0) || n.issues.push({
                origin: typeof n.value,
                code: "not_multiple_of",
                divisor: t.value,
                input: n.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), Mp = h("$ZodCheckNumberFormat", (e, t)=>{
        le.init(e, t), t.format = t.format || "float64";
        const n = t.format?.includes("int"), r = n ? "int" : "number", [o, i] = zg[t.format];
        e._zod.onattach.push((s)=>{
            const a = s._zod.bag;
            a.format = t.format, a.minimum = o, a.maximum = i, n && (a.pattern = Tp);
        }), e._zod.check = (s)=>{
            const a = s.value;
            if (n) {
                if (!Number.isInteger(a)) {
                    s.issues.push({
                        expected: r,
                        format: t.format,
                        code: "invalid_type",
                        continue: !1,
                        input: a,
                        inst: e
                    });
                    return;
                }
                if (!Number.isSafeInteger(a)) {
                    a > 0 ? s.issues.push({
                        input: a,
                        code: "too_big",
                        maximum: Number.MAX_SAFE_INTEGER,
                        note: "Integers must be within the safe integer range.",
                        inst: e,
                        origin: r,
                        inclusive: !0,
                        continue: !t.abort
                    }) : s.issues.push({
                        input: a,
                        code: "too_small",
                        minimum: Number.MIN_SAFE_INTEGER,
                        note: "Integers must be within the safe integer range.",
                        inst: e,
                        origin: r,
                        inclusive: !0,
                        continue: !t.abort
                    });
                    return;
                }
            }
            a < o && s.issues.push({
                origin: "number",
                input: a,
                code: "too_small",
                minimum: o,
                inclusive: !0,
                inst: e,
                continue: !t.abort
            }), a > i && s.issues.push({
                origin: "number",
                input: a,
                code: "too_big",
                maximum: i,
                inclusive: !0,
                inst: e,
                continue: !t.abort
            });
        };
    }), Zp = h("$ZodCheckMaxLength", (e, t)=>{
        var n;
        le.init(e, t), (n = e._zod.def).when ?? (n.when = qr), e._zod.onattach.push((r)=>{
            const o = r._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
            t.maximum < o && (r._zod.bag.maximum = t.maximum);
        }), e._zod.check = (r)=>{
            const o = r.value, i = o.length;
            if ((typeof o == "string" && i > t.maximum ? jr(o) : i) <= t.maximum) return;
            const a = Fr(o);
            r.issues.push({
                origin: a,
                code: "too_big",
                maximum: t.maximum,
                inclusive: !0,
                input: o,
                inst: e,
                continue: !t.abort
            });
        };
    }), Bp = h("$ZodCheckMinLength", (e, t)=>{
        var n;
        le.init(e, t), (n = e._zod.def).when ?? (n.when = qr), e._zod.onattach.push((r)=>{
            const o = r._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
            t.minimum > o && (r._zod.bag.minimum = t.minimum);
        }), e._zod.check = (r)=>{
            const o = r.value, i = o.length;
            if ((typeof o == "string" && i >= t.minimum && i < t.minimum * 2 ? jr(o) : i) >= t.minimum) return;
            const a = Fr(o);
            r.issues.push({
                origin: a,
                code: "too_small",
                minimum: t.minimum,
                inclusive: !0,
                input: o,
                inst: e,
                continue: !t.abort
            });
        };
    }), jp = h("$ZodCheckLengthEquals", (e, t)=>{
        var n;
        le.init(e, t), (n = e._zod.def).when ?? (n.when = qr), e._zod.onattach.push((r)=>{
            const o = r._zod.bag;
            o.minimum = t.length, o.maximum = t.length, o.length = t.length;
        }), e._zod.check = (r)=>{
            const o = r.value, i = o.length, s = typeof o == "string" && i >= t.length && i <= t.length * 2 ? jr(o) : i;
            if (s === t.length) return;
            const a = Fr(o), c = s > t.length;
            r.issues.push({
                origin: a,
                ...c ? {
                    code: "too_big",
                    maximum: t.length
                } : {
                    code: "too_small",
                    minimum: t.length
                },
                inclusive: !0,
                exact: !0,
                input: r.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), wn = h("$ZodCheckStringFormat", (e, t)=>{
        var n, r;
        le.init(e, t), e._zod.onattach.push((o)=>{
            const i = o._zod.bag;
            i.format = t.format, t.pattern && (i.patterns ?? (i.patterns = new Set), i.patterns.add(t.pattern));
        }), t.pattern ? (n = e._zod).check ?? (n.check = (o)=>{
            t.pattern.lastIndex = 0, !t.pattern.test(o.value) && o.issues.push({
                origin: "string",
                code: "invalid_format",
                format: t.format,
                input: o.value,
                ...t.pattern ? {
                    pattern: t.pattern.toString()
                } : {},
                inst: e,
                continue: !t.abort
            });
        }) : (r = e._zod).check ?? (r.check = ()=>{});
    }), Fp = h("$ZodCheckRegex", (e, t)=>{
        wn.init(e, t), e._zod.check = (n)=>{
            t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
                origin: "string",
                code: "invalid_format",
                format: "regex",
                input: n.value,
                pattern: t.pattern.toString(),
                inst: e,
                continue: !t.abort
            });
        };
    }), Lp = h("$ZodCheckLowerCase", (e, t)=>{
        t.pattern ?? (t.pattern = xp), wn.init(e, t);
    }), Up = h("$ZodCheckUpperCase", (e, t)=>{
        t.pattern ?? (t.pattern = Rp), wn.init(e, t);
    }), qp = h("$ZodCheckIncludes", (e, t)=>{
        le.init(e, t);
        const n = at(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position},}${n}` : n);
        t.pattern = r, e._zod.onattach.push((o)=>{
            const i = o._zod.bag;
            i.patterns ?? (i.patterns = new Set), i.patterns.add(r);
        }), e._zod.check = (o)=>{
            o.value.includes(t.includes, t.position) || o.issues.push({
                origin: "string",
                code: "invalid_format",
                format: "includes",
                includes: t.includes,
                input: o.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), Jp = h("$ZodCheckStartsWith", (e, t)=>{
        le.init(e, t);
        const n = new RegExp(`^${at(t.prefix)}.*`);
        t.pattern ?? (t.pattern = n), e._zod.onattach.push((r)=>{
            const o = r._zod.bag;
            o.patterns ?? (o.patterns = new Set), o.patterns.add(n);
        }), e._zod.check = (r)=>{
            r.value.startsWith(t.prefix) || r.issues.push({
                origin: "string",
                code: "invalid_format",
                format: "starts_with",
                prefix: t.prefix,
                input: r.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), Vp = h("$ZodCheckEndsWith", (e, t)=>{
        le.init(e, t);
        const n = new RegExp(`.*${at(t.suffix)}$`);
        t.pattern ?? (t.pattern = n), e._zod.onattach.push((r)=>{
            const o = r._zod.bag;
            o.patterns ?? (o.patterns = new Set), o.patterns.add(n);
        }), e._zod.check = (r)=>{
            r.value.endsWith(t.suffix) || r.issues.push({
                origin: "string",
                code: "invalid_format",
                format: "ends_with",
                suffix: t.suffix,
                input: r.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), Kp = h("$ZodCheckOverwrite", (e, t)=>{
        le.init(e, t), e._zod.check = (n)=>{
            n.value = t.tx(n.value);
        };
    });
    class Wp {
        constructor(t = [], n = {}){
            this.content = [], this.indent = 0, this.args = t, this.closed = n;
        }
        indented(t) {
            this.indent += 1, t(this), this.indent -= 1;
        }
        write(t) {
            if (typeof t == "function") {
                t(this, {
                    execution: "sync"
                }), t(this, {
                    execution: "async"
                });
                return;
            }
            const r = t.split(`
`).filter((s)=>s), o = Math.min(...r.map((s)=>s.length - s.trimStart().length)), i = r.map((s)=>s.slice(o)).map((s)=>" ".repeat(this.indent * 2) + s);
            for (const s of i)this.content.push(s);
        }
        compile() {
            const t = Function, n = this?.content ?? [
                ""
            ];
            return new t(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${n.join(`
`)}
};`)(...Object.values(this.closed));
        }
    }
    const Hp = {
        major: 4,
        minor: 5,
        patch: 1
    }, X = h("$ZodType", (e, t)=>{
        var n;
        e ?? (e = {}), e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Hp;
        const r = e._zod.def.checks, o = e._zod.traits.has("$ZodCheck") ? [
            e,
            ...r ?? []
        ] : r?.length ? [
            ...r
        ] : [];
        for (const i of o)for (const s of i._zod.onattach)s(e);
        if (o.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(()=>{
            e._zod.run = e._zod.parse;
        });
        else {
            const i = (a, c, u)=>{
                if (a.memo) return a;
                let _ = tt(a), f;
                for (const d of c){
                    if (d._zod.def.when) {
                        if (xg(a) || !d._zod.def.when(a)) continue;
                    } else if (_) continue;
                    const g = a.issues.length, b = d._zod.check(a);
                    if (b instanceof Promise && u?.async === !1) throw new ot;
                    if (f || b instanceof Promise) f = (f ?? Promise.resolve()).then(async ()=>{
                        await b, a.issues.length !== g && (Io(a.issues, g, e), _ || (_ = tt(a, g)));
                    });
                    else {
                        if (a.issues.length === g) continue;
                        Io(a.issues, g, e), _ || (_ = tt(a, g));
                    }
                }
                return f ? f.then(()=>a) : a;
            }, s = (a, c, u)=>{
                if (tt(a)) return a.aborted = !0, a;
                const _ = i(c, o, u);
                if (_ instanceof Promise) {
                    if (u.async === !1) throw new ot;
                    return _.then((f)=>e._zod.parse(f, u));
                }
                return e._zod.parse(_, u);
            };
            e._zod.run = (a, c)=>{
                if (c.skipChecks) return e._zod.parse(a, c);
                if (c.direction === "backward") {
                    const _ = e._zod.parse({
                        value: a.value,
                        issues: []
                    }, {
                        ...c,
                        skipChecks: !0
                    });
                    return _ instanceof Promise ? _.then((f)=>s(f, a, c)) : s(_, a, c);
                }
                const u = e._zod.parse(a, c);
                if (u instanceof Promise) {
                    if (c.async === !1) throw new ot;
                    return u.then((_)=>i(_, o, c));
                }
                return i(u, o, c);
            };
        }
    }, {
        get "~standard" () {
            return ps(this, "~standard", Ss(this));
        },
        set "~standard" (e){
            Ne(this, "~standard", e);
        }
    }), No = (e)=>e.success ? {
            value: e.data
        } : {
            issues: e.error?.issues
        };
    function Ss(e) {
        return {
            validate: (t)=>{
                try {
                    return No(Yg(e, t));
                } catch  {
                    return Qg(e, t).then(No);
                }
            },
            vendor: "zod",
            version: 1
        };
    }
    const Jr = h("$ZodString", (e, t)=>{
        X.init(e, t), e._zod.pattern = [
            ...e?._zod.bag?.patterns ?? []
        ].pop() ?? Cp(e._zod.bag), e._zod.parse = (n, r)=>{
            if (t.coerce) try {
                n.value = String(n.value);
            } catch  {}
            return typeof n.value == "string" || n.issues.push({
                expected: "string",
                code: "invalid_type",
                input: n.value,
                inst: e
            }), n;
        };
    }), G = h("$ZodStringFormat", (e, t)=>{
        wn.init(e, t), Jr.init(e, t);
    }), Gp = h("$ZodGUID", (e, t)=>{
        t.pattern ?? (t.pattern = pp), G.init(e, t);
    }), Yp = h("$ZodUUID", (e, t)=>{
        if (t.version) {
            const r = {
                v1: 1,
                v2: 2,
                v3: 3,
                v4: 4,
                v5: 5,
                v6: 6,
                v7: 7,
                v8: 8
            }[t.version];
            if (r === void 0) throw new Error(`Invalid UUID version: "${t.version}"`);
            t.pattern ?? (t.pattern = Po(r));
        } else t.pattern ?? (t.pattern = Po());
        G.init(e, t);
    }), Qp = h("$ZodEmail", (e, t)=>{
        t.pattern ?? (t.pattern = hp), G.init(e, t);
    }), $s = 1, As = 2;
    function Xp(e, t) {
        if (!t.normalize && t.protocol?.source === Sp.source && !/^https?:\/\//i.test(e)) return $s;
        try {
            return new URL(e);
        } catch  {
            return As;
        }
    }
    const eh = /[\t\n\r]/g;
    function th(e) {
        return e.replace(eh, "");
    }
    function nh(e, t) {
        return t.lastIndex = 0, t.test(e.hostname);
    }
    function rh(e, t) {
        return t.lastIndex = 0, t.test(e.protocol.endsWith(":") ? e.protocol.slice(0, -1) : e.protocol);
    }
    const oh = h("$ZodURL", (e, t)=>{
        G.init(e, t), e._zod.check = (n)=>{
            try {
                const r = n.value.trim(), o = Xp(r, t);
                if (o === $s) {
                    n.issues.push({
                        code: "invalid_format",
                        format: "url",
                        note: "Invalid URL format",
                        input: n.value,
                        inst: e,
                        continue: !t.abort
                    });
                    return;
                }
                if (o === As) {
                    n.issues.push({
                        code: "invalid_format",
                        format: "url",
                        input: n.value,
                        inst: e,
                        continue: !t.abort
                    });
                    return;
                }
                t.hostname && !nh(o, t.hostname) && n.issues.push({
                    code: "invalid_format",
                    format: "url",
                    note: "Invalid hostname",
                    pattern: t.hostname.source,
                    input: n.value,
                    inst: e,
                    continue: !t.abort
                }), t.protocol && !rh(o, t.protocol) && n.issues.push({
                    code: "invalid_format",
                    format: "url",
                    note: "Invalid protocol",
                    pattern: t.protocol.source,
                    input: n.value,
                    inst: e,
                    continue: !t.abort
                }), n.value = t.normalize ? o.href : th(r);
                return;
            } catch  {
                n.issues.push({
                    code: "invalid_format",
                    format: "url",
                    input: n.value,
                    inst: e,
                    continue: !t.abort
                });
            }
        };
    }), ih = h("$ZodEmoji", (e, t)=>{
        t.pattern ?? (t.pattern = mp()), G.init(e, t);
    }), sh = h("$ZodNanoID", (e, t)=>{
        if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1)) throw new Error(`Invalid nanoid length: ${t.length}`);
        t.pattern ?? (t.pattern = t.length === void 0 ? fp : dp(t.length)), G.init(e, t);
    }), ah = h("$ZodCUID", (e, t)=>{
        t.pattern ?? (t.pattern = ap), G.init(e, t);
    }), ch = h("$ZodCUID2", (e, t)=>{
        t.pattern ?? (t.pattern = cp), G.init(e, t);
    }), uh = h("$ZodULID", (e, t)=>{
        t.pattern ?? (t.pattern = up), G.init(e, t);
    }), _h = h("$ZodXID", (e, t)=>{
        t.pattern ?? (t.pattern = _p), G.init(e, t);
    }), lh = h("$ZodKSUID", (e, t)=>{
        t.pattern ?? (t.pattern = lp), G.init(e, t);
    }), fh = h("$ZodISODateTime", (e, t)=>{
        t.pattern ?? (t.pattern = Op(t)), G.init(e, t), (t.local || t.precision === -1) && (e._zod.bag.laxFormat = !0, e._zod.onattach.push((n)=>{
            n._zod.bag.laxFormat = !0;
        }));
    }), dh = h("$ZodISODate", (e, t)=>{
        t.pattern ?? (t.pattern = zp), G.init(e, t);
    }), gh = h("$ZodISOTime", (e, t)=>{
        t.pattern ?? (t.pattern = Ip(t)), G.init(e, t);
    }), ph = h("$ZodISODuration", (e, t)=>{
        t.pattern ?? (t.pattern = gp), G.init(e, t);
    }), hh = h("$ZodIPv4", (e, t)=>{
        t.pattern ?? (t.pattern = wp), G.init(e, t), e._zod.bag.format = "ipv4";
    }), bh = /^[0-9a-fA-F:.]+$/;
    function zs(e) {
        if (!bh.test(e)) return !1;
        try {
            return new URL(`http://[${e}]`), !0;
        } catch  {
            return !1;
        }
    }
    const mh = h("$ZodIPv6", (e, t)=>{
        t.pattern ?? (t.pattern = yp), G.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n)=>{
            zs(n.value) || n.issues.push({
                code: "invalid_format",
                format: "ipv6",
                input: n.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), wh = h("$ZodCIDRv4", (e, t)=>{
        t.pattern ?? (t.pattern = vp), G.init(e, t);
    });
    function yh(e) {
        const t = e.split("/");
        if (t.length !== 2) return !1;
        const [n, r] = t;
        if (!r) return !1;
        const o = Number(r);
        return `${o}` !== r || o < 0 || o > 128 ? !1 : zs(n);
    }
    const vh = h("$ZodCIDRv6", (e, t)=>{
        t.pattern ?? (t.pattern = kp), G.init(e, t), e._zod.check = (n)=>{
            yh(n.value) || n.issues.push({
                code: "invalid_format",
                format: "cidrv6",
                input: n.value,
                inst: e,
                continue: !t.abort
            });
        };
    });
    function Is(e) {
        if (e === "") return !0;
        if (/\s/.test(e) || e.length % 4 !== 0) return !1;
        try {
            return atob(e), !0;
        } catch  {
            return !1;
        }
    }
    const kh = h("$ZodBase64", (e, t)=>{
        t.pattern ?? (t.pattern = Ep), G.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n)=>{
            Is(n.value) || n.issues.push({
                code: "invalid_format",
                format: "base64",
                input: n.value,
                inst: e,
                continue: !t.abort
            });
        };
    });
    function Eh(e) {
        if (!ys.test(e)) return !1;
        const t = e.replace(/[-_]/g, (r)=>r === "-" ? "+" : "/"), n = t.padEnd(Math.ceil(t.length / 4) * 4, "=");
        return Is(n);
    }
    const Sh = h("$ZodBase64URL", (e, t)=>{
        t.pattern ?? (t.pattern = ys), G.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n)=>{
            Eh(n.value) || n.issues.push({
                code: "invalid_format",
                format: "base64url",
                input: n.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), $h = h("$ZodE164", (e, t)=>{
        t.pattern ?? (t.pattern = $p), G.init(e, t);
    });
    function Ah(e, t = null) {
        try {
            const n = e.split(".");
            if (n.length !== 3) return !1;
            const [r] = n;
            if (!r) return !1;
            const o = JSON.parse(atob(r));
            return !("typ" in o && o?.typ !== "JWT" || !o.alg || t && (!("alg" in o) || o.alg !== t));
        } catch  {
            return !1;
        }
    }
    const zh = h("$ZodJWT", (e, t)=>{
        G.init(e, t), e._zod.check = (n)=>{
            Ah(n.value, t.alg) || n.issues.push({
                code: "invalid_format",
                format: "jwt",
                input: n.value,
                inst: e,
                continue: !t.abort
            });
        };
    }), Os = h("$ZodNumber", (e, t)=>{
        X.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? Pp, e._zod.parse = (n, r)=>{
            if (t.coerce) try {
                n.value = Number(n.value);
            } catch  {}
            const o = n.value;
            if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o)) return n;
            const i = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : String(o) : void 0;
            return n.issues.push({
                expected: "number",
                code: "invalid_type",
                input: o,
                inst: e,
                ...i ? {
                    received: i
                } : {}
            }), n;
        };
    }), Ih = h("$ZodNumberFormat", (e, t)=>{
        Mp.init(e, t), Os.init(e, t);
    }), Oh = h("$ZodBoolean", (e, t)=>{
        X.init(e, t), e._zod.pattern = Np, e._zod.parse = (n, r)=>{
            if (t.coerce) try {
                n.value = !!n.value;
            } catch  {}
            const o = n.value;
            return typeof o == "boolean" || n.issues.push({
                expected: "boolean",
                code: "invalid_type",
                input: o,
                inst: e
            }), n;
        };
    }), Ch = h("$ZodUnknown", (e, t)=>{
        X.init(e, t), e._zod.parse = (n)=>n;
    }), Th = h("$ZodNever", (e, t)=>{
        X.init(e, t), e._zod.parse = (n, r)=>(n.issues.push({
                expected: "never",
                code: "invalid_type",
                input: n.value,
                inst: e
            }), n);
    });
    function xo(e, t, n) {
        e.issues.length && t.issues.push(...gs(n, e.issues)), t.value[n] = e.value;
    }
    const Ph = h("$ZodArray", (e, t)=>{
        X.init(e, t);
        const n = be.memoizer;
        n?.attach(e), e._zod.parse = (r, o)=>{
            const i = r.value;
            if (!Array.isArray(i)) return r.issues.push({
                expected: "array",
                code: "invalid_type",
                input: i,
                inst: e
            }), r;
            r.value = n ? n.alloc(e, r, Array(i.length), o) : Array(i.length);
            const s = [];
            for(let a = 0; a < i.length; a++){
                const c = i[a], u = t.element._zod.run({
                    value: c,
                    issues: []
                }, o);
                u instanceof Promise ? s.push(u.then((_)=>xo(_, r, a))) : xo(u, r, a);
            }
            return s.length ? Promise.all(s).then(()=>r) : r;
        };
    });
    function cn(e, t, n, r, o, i) {
        const s = n in r, a = i === "optional";
        if (!(!s && a && o === "optional")) {
            if (e.issues.length) {
                if (o !== void 0 && a && !s) return;
                t.issues.push(...gs(n, e.issues));
            }
            if (!s && o === void 0) {
                e.issues.length || t.issues.push({
                    code: "invalid_type",
                    expected: "nonoptional",
                    input: void 0,
                    path: [
                        n
                    ]
                });
                return;
            }
            e.value === void 0 ? s && (t.value[n] = void 0) : t.value[n] = e.value;
        }
    }
    const Nh = [];
    function Cs(e) {
        const t = Object.keys(e.shape), n = Object.getOwnPropertySymbols(e.shape), r = n.length ? n : Nh, o = r.length ? [
            ...t,
            ...r
        ] : t;
        for (const s of o)if (!e.shape?.[s]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(s)}": expected a Zod schema`);
        const i = Ag(e.shape);
        return {
            ...e,
            allKeys: o,
            symbolKeys: r,
            keySet: new Set(t),
            numKeys: t.length,
            optionalKeys: new Set(i)
        };
    }
    function Ts(e, t, n, r, o, i) {
        const s = [], a = o.keySet, c = o.catchall._zod, u = c.def.type, _ = c.optin, f = c.optout;
        for(const d in t){
            if (a.has(d)) continue;
            if (d === "__proto__") {
                u === "never" && s.push(d);
                continue;
            }
            if (u === "never") {
                s.push(d);
                continue;
            }
            const g = c.run({
                value: t[d],
                issues: []
            }, r);
            g instanceof Promise ? e.push(g.then((b)=>cn(b, n, d, t, _, f))) : cn(g, n, d, t, _, f);
        }
        return s.length && n.issues.push({
            code: "unrecognized_keys",
            keys: s,
            input: t,
            inst: i,
            continue: !0
        }), e.length ? Promise.all(e).then(()=>n) : n;
    }
    const Ar = new WeakMap, xh = h("$ZodObject", (e, t)=>{
        if (X.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
            const c = t.shape;
            Ar.set(t, c), Object.defineProperty(t, "shape", {
                get: ()=>{
                    const u = {
                        ...c
                    };
                    return Object.defineProperty(t, "shape", {
                        value: u
                    }), Ar.set(t, u), u;
                }
            });
        }
        const r = pn(()=>Cs(t));
        U(e, "propValues", (c)=>{
            const u = c.def.shape, _ = {};
            for(const f in u){
                const d = u[f]._zod;
                if (d.values) {
                    Object.prototype.hasOwnProperty.call(_, f) || _e(_, f, new Set);
                    for (const g of d.values)_[f].add(g);
                    d.optin !== void 0 && _[f].add(void 0);
                }
            }
            return _;
        });
        const o = Ct, i = t.catchall;
        let s;
        const a = be.memoizer;
        a?.attach(e), e._zod.parse = (c, u)=>{
            s ?? (s = r.value);
            const _ = c.value;
            if (!o(_)) return c.issues.push({
                expected: "object",
                code: "invalid_type",
                input: _,
                inst: e
            }), c;
            c.value = a ? a.alloc(e, c, {}, u) : {};
            const f = [], d = s.shape;
            for (const g of s.allKeys){
                if (g === "__proto__") continue;
                const b = d[g], y = b._zod.optin, z = b._zod.optout, k = b._zod.run({
                    value: _[g],
                    issues: []
                }, u);
                k instanceof Promise ? f.push(k.then((O)=>cn(O, c, g, _, y, z))) : cn(k, c, g, _, y, z);
            }
            return i ? Ts(f, _, c, u, r.value, e) : f.length ? Promise.all(f).then(()=>c) : c;
        };
    }), Rh = h("$ZodObjectJIT", (e, t)=>{
        xh.init(e, t);
        const n = e._zod.parse, r = pn(()=>Cs(t)), o = be.memoizer, i = (g)=>{
            const b = r.value, y = b.symbolKeys, z = new Wp([
                "payload",
                "ctx"
            ], {
                shape: g,
                inst: e,
                memo: o,
                syms: y
            }), k = (M)=>`shape[${M}]._zod.run({ value: input[${M}], issues: [] }, ctx)`, O = (M, w)=>`
          for (let i = 0; i < ${M}.issues.length; i++) {
            const iss = ${M}.issues[i];
            iss.path = iss.path ? [${w}, ...iss.path] : [${w}];
            payload.issues.push(iss);
          }`;
            z.write("const input = payload.value;");
            const I = Object.create(null);
            let S = 0;
            for (const M of b.allKeys)I[M] = `key_${S++}`;
            z.write(o ? "const newResult = memo.alloc(inst, payload, {}, ctx);" : "const newResult = {};");
            for (const M of b.allKeys){
                if (M === "__proto__") continue;
                const w = I[M], A = typeof M == "symbol" ? `syms[${y.indexOf(M)}]` : kg(M), N = `${A} in input`, v = g[M], E = v?._zod?.optin, C = E !== void 0, $ = v?._zod?.optout === "optional";
                if (z.write(`const ${w} = ${k(A)};`), C && $) {
                    const P = E === "optional" ? `${w}_present` : `${w}.value !== undefined || ${w}_present`;
                    z.write(`
        const ${w}_present = ${N};
        if (!${w}.issues.length || ${w}_present) {
          if (${w}.issues.length) {${O(w, A)}
          }

          if (${P}) {
            newResult[${A}] = ${w}.value;
          }
        }

      `);
                } else C ? z.write(`
        if (${w}.issues.length) {${O(w, A)}
        }
        
        if (${w}.value === undefined) {
          if (${N}) {
            newResult[${A}] = undefined;
          }
        } else {
          newResult[${A}] = ${w}.value;
        }

      `) : z.write(`
        const ${w}_present = ${N};
        if (${w}.issues.length) {${O(w, A)}
        }
        if (!${w}_present && !${w}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${A}]
          });
        }

        if (${w}_present) {
          newResult[${A}] = ${w}.value;
        }

      `);
            }
            return z.write("payload.value = newResult;"), z.write("return payload;"), z.compile();
        };
        let s;
        const a = Ct, c = !be.jitless, _ = c && Sg.value, f = t.catchall;
        let d;
        e._zod.parse = (g, b)=>{
            d ?? (d = r.value);
            const y = g.value;
            return a(y) ? c && _ && b?.async === !1 && b.jitless !== !0 ? (s || (s = i(t.shape)), g = s(g, b), f ? Ts([], y, g, b, d, e) : g) : n(g, b) : (g.issues.push({
                expected: "object",
                code: "invalid_type",
                input: y,
                inst: e
            }), g);
        };
    });
    function Ro(e, t, n, r) {
        for (const i of e)if (i.issues.length === 0) return t.value = i.value, t;
        const o = e.filter((i)=>!tt(i));
        return o.length === 1 ? (t.value = o[0].value, o[0]) : (t.issues.push({
            code: "invalid_union",
            input: t.value,
            inst: n,
            errors: e.map((i)=>i.issues.map((s)=>ut(s, r, Be())))
        }), t);
    }
    const Ps = h("$ZodUnion", (e, t)=>{
        X.init(e, t), U(e, "optin", (r)=>r.def.options.some((o)=>o._zod.optin === "defaulted") ? "defaulted" : r.def.options.some((o)=>o._zod.optin !== void 0) ? "optional" : void 0), U(e, "optout", (r)=>r.def.options.some((o)=>o._zod.optout === "optional") ? "optional" : void 0), U(e, "values", (r)=>{
            if (r.def.options.every((o)=>o._zod.values)) return new Set(r.def.options.flatMap((o)=>Array.from(o._zod.values)));
        }), U(e, "pattern", (r)=>{
            if (r.def.options.every((o)=>o._zod.pattern)) {
                const o = r.def.options.map((i)=>i._zod.pattern);
                return new RegExp(`^(${o.map((i)=>Br(i.source)).join("|")})$`);
            }
        });
        const n = t.options.length === 1 ? t.options[0]._zod.run : null;
        e._zod.parse = (r, o)=>{
            if (n) return n(r, o);
            let i = !1;
            const s = [];
            for (const a of t.options){
                const c = a._zod.run({
                    value: r.value,
                    issues: []
                }, o);
                if (c instanceof Promise) s.push(c), i = !0;
                else {
                    if (c.issues.length === 0) return c;
                    s.push(c);
                }
            }
            return i ? Promise.all(s).then((a)=>Ro(a, r, e, o)) : Ro(s, r, e, o);
        };
    }), Dh = h("$ZodDiscriminatedUnion", (e, t)=>{
        t.inclusive = !1, Ps.init(e, t);
        const n = e._zod.parse;
        U(e, "propValues", (o)=>{
            const i = {};
            for (const s of o.def.options){
                const a = s._zod.propValues;
                if (!a || Object.keys(a).length === 0) throw new Error(`Invalid discriminated union option at index "${o.def.options.indexOf(s)}"`);
                for (const [c, u] of Object.entries(a)){
                    Object.prototype.hasOwnProperty.call(i, c) || _e(i, c, new Set);
                    for (const _ of u)i[c].add(_);
                }
            }
            return i;
        }), t.options.forEach((o, i)=>{
            const s = Ar.get(o._zod.def);
            if (s && !Object.prototype.hasOwnProperty.call(s, t.discriminator)) throw new Error(`Invalid discriminated union option at index "${i}"`);
        });
        const r = pn(()=>{
            const o = t.options, i = new Map;
            for (const s of o){
                const a = s._zod.propValues?.[t.discriminator];
                if (!a || a.size === 0) throw new Error(`Invalid discriminated union option at index "${t.options.indexOf(s)}"`);
                for (const c of a){
                    if (i.has(c)) throw new Error(`Duplicate discriminator value "${String(c)}"`);
                    i.set(c, s);
                }
            }
            return i;
        });
        e._zod.parse = (o, i)=>{
            const s = o.value;
            if (!Ct(s)) return o.issues.push({
                code: "invalid_type",
                expected: "object",
                input: s,
                inst: e
            }), o;
            const a = r.value.get(s?.[t.discriminator]);
            return a ? a._zod.run(o, i) : t.unionFallback || i.direction === "backward" ? n(o, i) : (o.issues.push({
                code: "invalid_union",
                errors: [],
                note: "No matching discriminator",
                discriminator: t.discriminator,
                options: Array.from(r.value.keys()),
                input: s,
                path: [
                    t.discriminator
                ],
                inst: e
            }), o);
        };
    }), Mh = h("$ZodIntersection", (e, t)=>{
        X.init(e, t), e._zod.parse = (n, r)=>{
            const o = n.value, i = t.left._zod.run({
                value: o,
                issues: []
            }, r), s = t.right._zod.run({
                value: o,
                issues: []
            }, r);
            return i instanceof Promise || s instanceof Promise ? Promise.all([
                i,
                s
            ]).then(([c, u])=>Do(n, c, u)) : Do(n, i, s);
        };
    });
    function zr(e, t) {
        if (e === t) return {
            valid: !0,
            data: e
        };
        if (e instanceof Date && t instanceof Date && +e == +t) return {
            valid: !0,
            data: e
        };
        if (Tt(e) && Tt(t)) {
            const n = Object.keys(t), r = Object.keys(e).filter((i)=>n.indexOf(i) !== -1), o = {
                ...e,
                ...t
            };
            Object.prototype.hasOwnProperty.call(o, "__proto__") && delete o.__proto__;
            for (const i of r){
                if (i === "__proto__") continue;
                const s = zr(e[i], t[i]);
                if (!s.valid) return {
                    valid: !1,
                    mergeErrorPath: [
                        i,
                        ...s.mergeErrorPath
                    ]
                };
                o[i] = s.data;
            }
            return {
                valid: !0,
                data: o
            };
        }
        if (Array.isArray(e) && Array.isArray(t)) {
            if (e.length !== t.length) return {
                valid: !1,
                mergeErrorPath: []
            };
            const n = [];
            for(let r = 0; r < e.length; r++){
                const o = e[r], i = t[r], s = zr(o, i);
                if (!s.valid) return {
                    valid: !1,
                    mergeErrorPath: [
                        r,
                        ...s.mergeErrorPath
                    ]
                };
                n.push(s.data);
            }
            return {
                valid: !0,
                data: n
            };
        }
        return {
            valid: !1,
            mergeErrorPath: []
        };
    }
    function Do(e, t, n) {
        const r = new Map;
        let o;
        const i = new Map, s = (u, _)=>{
            let f;
            if (u.code === "unrecognized_keys" && !u.path?.length) o ?? (o = u), f = u.keys;
            else if (u.code === "invalid_key" && u.origin === "record" && u.path?.length === 1) {
                const d = String(u.path[0]);
                i.has(d) || i.set(d, u), f = [
                    d
                ];
            } else return !1;
            for (const d of f)r.has(d) || r.set(d, {}), r.get(d)[_] = !0;
            return !0;
        };
        for (const u of t.issues)s(u, "l") || e.issues.push(u);
        for (const u of n.issues)s(u, "r") || e.issues.push(u);
        const a = [
            ...r
        ].filter(([, u])=>u.l && u.r).map(([u])=>u);
        if (a.length) {
            const u = o ? a.filter((_)=>o.keys.includes(_)) : [];
            u.length && e.issues.push({
                ...o,
                keys: u
            });
            for (const _ of a)!u.includes(_) && i.has(_) && e.issues.push(i.get(_));
        }
        const c = zr(t.value, n.value);
        if (!c.valid) {
            if (tt(e)) return e;
            throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
        }
        return e.value = c.data, e;
    }
    const Zh = h("$ZodEnum", (e, t)=>{
        X.init(e, t);
        const n = _s(t.entries), r = new Set(n);
        e._zod.values = r;
        const o = n.filter((i)=>$g.has(typeof i));
        e._zod.pattern = new RegExp(o.length ? `^(${o.map((i)=>at(i.toString())).join("|")})$` : "^[^\\s\\S]$"), e._zod.parse = (i, s)=>{
            const a = i.value;
            return r.has(a) || i.issues.push({
                code: "invalid_value",
                values: n,
                input: a,
                inst: e
            }), i;
        };
    }), Bh = h("$ZodLiteral", (e, t)=>{
        X.init(e, t);
        const n = new Set(t.values);
        e._zod.values = n, e._zod.pattern = new RegExp(t.values.length ? `^(${t.values.map((r)=>typeof r == "string" ? at(r) : r ? at(r.toString()) : String(r)).join("|")})$` : "^[^\\s\\S]$"), e._zod.parse = (r, o)=>{
            const i = r.value;
            return n.has(i) || r.issues.push({
                code: "invalid_value",
                values: t.values,
                input: i,
                inst: e
            }), r;
        };
    }), jh = h("$ZodTransform", (e, t)=>{
        X.init(e, t), e._zod.optin = "optional", be.memoizer?.guard(e), e._zod.parse = (n, r)=>{
            if (r.direction === "backward") throw new hs(e.constructor.name);
            const o = t.transform(n.value, n);
            if (r.async) return (o instanceof Promise ? o : Promise.resolve(o)).then((s)=>(n.value = s, n));
            if (o instanceof Promise) throw new ot;
            return n.value = o, n;
        };
    });
    function Mo(e, t) {
        return e.value = t.issues.length ? void 0 : t.value, e;
    }
    const Ns = h("$ZodOptional", (e, t)=>{
        X.init(e, t), U(e, "optin", (n)=>n.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), e._zod.optout = "optional", U(e, "values", (n)=>{
            const r = n.def.innerType._zod.values;
            return r ? new Set([
                ...r,
                void 0
            ]) : void 0;
        }), U(e, "pattern", (n)=>{
            const r = n.def.innerType._zod.pattern;
            return r ? new RegExp(`^(${Br(r.source)})?$`) : void 0;
        }), e._zod.parse = (n, r)=>{
            if (n.value === void 0) {
                if (t.innerType._zod.optin !== "defaulted") return n;
                const o = t.innerType._zod.run({
                    value: n.value,
                    issues: []
                }, r);
                return o instanceof Promise ? o.then((i)=>Mo(n, i)) : Mo(n, o);
            }
            return t.innerType._zod.run(n, r);
        };
    }), Fh = h("$ZodExactOptional", (e, t)=>{
        Ns.init(e, t), U(e, "values", (n)=>n.def.innerType._zod.values), U(e, "pattern", (n)=>n.def.innerType._zod.pattern), e._zod.parse = (n, r)=>t.innerType._zod.run(n, r);
    }), Lh = h("$ZodNullable", (e, t)=>{
        X.init(e, t), U(e, "optin", (n)=>n.def.innerType._zod.optin), U(e, "optout", (n)=>n.def.innerType._zod.optout), U(e, "pattern", (n)=>{
            const r = n.def.innerType._zod.pattern;
            return r ? new RegExp(`^(${Br(r.source)}|null)$`) : void 0;
        }), U(e, "values", (n)=>n.def.innerType._zod.values ? new Set([
                ...n.def.innerType._zod.values,
                null
            ]) : void 0), e._zod.parse = (n, r)=>n.value === null ? n : t.innerType._zod.run(n, r);
    }), Uh = h("$ZodDefault", (e, t)=>{
        X.init(e, t), e._zod.optin = "defaulted", U(e, "values", (n)=>n.def.innerType._zod.values), e._zod.parse = (n, r)=>{
            if (r.direction === "backward") return t.innerType._zod.run(n, r);
            if (n.value === void 0) return n.value = t.defaultValue, n;
            const o = t.innerType._zod.run(n, r);
            return o instanceof Promise ? o.then((i)=>Zo(i, t)) : Zo(o, t);
        };
    });
    function Zo(e, t) {
        return e.value === void 0 && (e.value = t.defaultValue), e;
    }
    const qh = h("$ZodPrefault", (e, t)=>{
        X.init(e, t), e._zod.optin = "defaulted", U(e, "values", (n)=>n.def.innerType._zod.values), e._zod.parse = (n, r)=>(r.direction === "backward" || n.value === void 0 && (n.value = t.defaultValue), t.innerType._zod.run(n, r));
    }), Jh = h("$ZodNonOptional", (e, t)=>{
        X.init(e, t), U(e, "values", (n)=>{
            const r = n.def.innerType._zod.values;
            return r ? new Set([
                ...r
            ].filter((o)=>o !== void 0)) : void 0;
        }), e._zod.parse = (n, r)=>{
            const o = t.innerType._zod.run(n, r);
            return o instanceof Promise ? o.then((i)=>Bo(i, e)) : Bo(o, e);
        };
    });
    function Bo(e, t) {
        return !e.issues.length && e.value === void 0 && e.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: e.value,
            inst: t
        }), e;
    }
    function jo(e, t, n, r) {
        return t.issues.length ? (e.value = n.catchValue({
            ...t,
            value: e.value,
            error: {
                issues: t.issues.map((o)=>ut(o, r, Be()))
            },
            input: e.value
        }), e) : (e.value = t.value, t.memo && (e.memo = !0), e);
    }
    const Vh = h("$ZodCatch", (e, t)=>{
        X.init(e, t), U(e, "optin", (n)=>n.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), U(e, "optout", (n)=>n.def.innerType._zod.optout), U(e, "values", (n)=>n.def.innerType._zod.values), e._zod.parse = (n, r)=>{
            if (r.direction === "backward") return t.innerType._zod.run(n, r);
            const o = t.innerType._zod.run({
                value: n.value,
                issues: []
            }, r);
            return o instanceof Promise ? o.then((i)=>jo(n, i, t, r)) : jo(n, o, t, r);
        };
    }), Kh = h("$ZodPipe", (e, t)=>{
        X.init(e, t), U(e, "values", (n)=>n.def.in._zod.values), U(e, "optin", (n)=>n.def.in._zod.optin), U(e, "optout", (n)=>n.def.out._zod.optout), U(e, "propValues", (n)=>n.def.in._zod.propValues), e._zod.parse = (n, r)=>{
            if (r.direction === "backward") {
                const i = t.out._zod.run(n, r);
                return i instanceof Promise ? i.then((s)=>Bt(s, t.in, r)) : Bt(i, t.in, r);
            }
            const o = t.in._zod.run(n, r);
            return o instanceof Promise ? o.then((i)=>Bt(i, t.out, r)) : Bt(o, t.out, r);
        };
    });
    function Bt(e, t, n) {
        return e.issues.some((r)=>r.code !== "unrecognized_keys") ? (e.aborted = !0, e) : t._zod.run({
            value: e.value,
            issues: e.issues
        }, n);
    }
    const Wh = h("$ZodReadonly", (e, t)=>{
        X.init(e, t), U(e, "propValues", (n)=>n.def.innerType._zod.propValues), U(e, "values", (n)=>n.def.innerType._zod.values), U(e, "optin", (n)=>n.def.innerType?._zod?.optin), U(e, "optout", (n)=>n.def.innerType?._zod?.optout), e._zod.parse = (n, r)=>{
            if (r.direction === "backward") return t.innerType._zod.run(n, r);
            const o = t.innerType._zod.run(n, r);
            return o instanceof Promise ? o.then(Fo) : Fo(o);
        };
    });
    function Fo(e) {
        return e.memo || (e.value = Object.freeze(e.value)), e;
    }
    const Hh = h("$ZodCustom", (e, t)=>{
        le.init(e, t), X.init(e, t), e._zod.parse = (n, r)=>n, e._zod.check = (n)=>{
            const r = n.value, o = t.fn(r);
            if (o instanceof Promise) return o.then((i)=>Lo(i, n, r, e));
            Lo(o, n, r, e);
        };
    });
    function Lo(e, t, n, r) {
        if (!e) {
            const o = {
                code: "custom",
                input: n,
                inst: r,
                path: [
                    ...r._zod.def.path ?? []
                ],
                continue: !r._zod.def.abort
            };
            r._zod.def.params && (o.params = r._zod.def.params), t.issues.push(Pt(o));
        }
    }
    class Gh extends Error {
        constructor(){
            super("Cannot parse a reference cycle that closes through a transform"), this.name = "ZodCyclicError";
        }
    }
    const Ir = "~memo", Uo = [];
    function jn(e) {
        return e.map((t)=>t.path ? {
                ...t,
                path: t.path.slice()
            } : {
                ...t
            });
    }
    const qo = new WeakMap;
    function xs(e, t) {
        const n = qo.get(e);
        if (n !== void 0) return n;
        if (t.has(e)) return !0;
        t.add(e);
        let r = !1;
        const o = (s)=>{
            !r && s?._zod && xs(s, t) && (r = !0);
        }, i = e._zod.def;
        if (i.type === "lazy") o(e._zod.innerType);
        else {
            const s = i.shape;
            if (s) for (const a of Reflect.ownKeys(s))o(s[a]);
            for(const a in i){
                const c = i[a];
                if (!(!c || typeof c != "object")) {
                    if (c._zod) o(c);
                    else if (Array.isArray(c)) for (const u of c)o(u);
                }
            }
        }
        return t.delete(e), qo.set(e, r), r;
    }
    function Yh(e, t) {
        let n = e.buckets.get(t);
        return n || (n = new Map, e.buckets.set(t, n)), n;
    }
    let jt;
    const Ft = [], Qh = {
        alloc (e, t, n) {
            const r = jt;
            if (!r) return n;
            jt = void 0;
            const o = {
                value: n,
                issues: null
            };
            return r.set(t.value, o), Ft.push(o), n;
        },
        guard (e) {
            var t;
            (t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(()=>{
                const n = e._zod.parse, r = (o, i)=>{
                    if (i.direction !== "backward" && eb(i, o.value)) throw new Gh;
                    return n(o, i);
                };
                e._zod.parse = r, e._zod.run === n && (e._zod.run = r);
            });
        },
        attach (e) {
            var t;
            let n, r, o;
            (t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(()=>{
                const i = e._zod.parse, s = (a, c)=>{
                    if (n === void 0 && (n = xs(e, new Set), !n)) return e._zod.parse = i, e._zod.run === s && (e._zod.run = i), i(a, c);
                    const u = a.value;
                    if (u === null || typeof u != "object") return i(a, c);
                    let _ = c[Ir];
                    _ || (_ = {
                        buckets: new Map,
                        backEdges: void 0
                    }, c[Ir] = _);
                    let f;
                    r === c ? f = o : (f = Yh(_, e), r = c, o = f);
                    const d = f.get(u);
                    if (d) return a.value = d.value, d.issues ? d.issues.length && a.issues.push(...jn(d.issues)) : (a.memo = !0, _.backEdges ?? (_.backEdges = new Set), _.backEdges.add(d.value)), a;
                    jt = f;
                    const g = Ft.length, b = i(a, c);
                    jt = void 0;
                    const y = Ft.length > g ? Ft.pop() : void 0;
                    return b instanceof Promise ? b.then((z)=>(y && (y.issues = z.issues.length ? jn(z.issues) : Uo), z)) : (y && (y.issues = b.issues.length ? jn(b.issues) : Uo), b);
                };
                e._zod.parse = s, e._zod.run === i && (e._zod.run = s);
            });
        }
    };
    function Xh() {
        return Qh;
    }
    function eb(e, t) {
        const n = e[Ir]?.backEdges;
        return n !== void 0 && t !== null && typeof t == "object" && n.has(t);
    }
    const tb = ()=>{
        const e = {
            string: {
                unit: "characters",
                verb: "to have"
            },
            file: {
                unit: "bytes",
                verb: "to have"
            },
            array: {
                unit: "items",
                verb: "to have"
            },
            set: {
                unit: "items",
                verb: "to have"
            },
            map: {
                unit: "entries",
                verb: "to have"
            }
        };
        function t(i) {
            return e[i] ?? null;
        }
        const n = {
            regex: "input",
            email: "email address",
            url: "URL",
            emoji: "emoji",
            uuid: "UUID",
            uuidv4: "UUIDv4",
            uuidv6: "UUIDv6",
            nanoid: "nanoid",
            guid: "GUID",
            cuid: "cuid",
            cuid2: "cuid2",
            ulid: "ULID",
            xid: "XID",
            ksuid: "KSUID",
            datetime: "ISO datetime",
            date: "ISO date",
            time: "ISO time",
            duration: "ISO duration",
            ipv4: "IPv4 address",
            ipv6: "IPv6 address",
            mac: "MAC address",
            cidrv4: "IPv4 range",
            cidrv6: "IPv6 range",
            base64: "base64-encoded string",
            base64url: "base64url-encoded string",
            json_string: "JSON string",
            e164: "E.164 number",
            credit_card: "credit card number",
            jwt: "JWT",
            template_literal: "input"
        }, r = {
            nan: "NaN"
        };
        function o(i, s) {
            return i === "number" && typeof s == "number" && !Number.isFinite(s) ? String(s) : r[i] ?? i;
        }
        return (i)=>{
            switch(i.code){
                case "invalid_type":
                    {
                        const s = o(i.expected), a = Dg(i.input), c = o(a, i.input);
                        return `Invalid input: expected ${s}, received ${c}`;
                    }
                case "invalid_value":
                    return i.values.length === 1 ? `Invalid input: expected ${ds(i.values[0])}` : `Invalid option: expected one of ${Ao(i.values, "|")}`;
                case "too_big":
                    {
                        const s = i.exact ? "exactly " : i.inclusive ? "<=" : "<", a = t(i.origin);
                        return a ? `Too big: expected ${i.origin ?? "value"} to have ${s}${i.maximum.toString()} ${a.unit ?? "elements"}` : `Too big: expected ${i.origin ?? "value"} to be ${s}${i.maximum.toString()}`;
                    }
                case "too_small":
                    {
                        const s = i.exact ? "exactly " : i.inclusive ? ">=" : ">", a = t(i.origin);
                        return a ? `Too small: expected ${i.origin} to have ${s}${i.minimum.toString()} ${a.unit}` : `Too small: expected ${i.origin} to be ${s}${i.minimum.toString()}`;
                    }
                case "invalid_format":
                    {
                        const s = i;
                        return s.format === "starts_with" ? `Invalid string: must start with "${s.prefix}"` : s.format === "ends_with" ? `Invalid string: must end with "${s.suffix}"` : s.format === "includes" ? `Invalid string: must include "${s.includes}"` : s.format === "regex" ? `Invalid string: must match pattern ${s.pattern}` : `Invalid ${n[s.format] ?? i.format}`;
                    }
                case "not_multiple_of":
                    return `Invalid number: must be a multiple of ${i.divisor}`;
                case "unrecognized_keys":
                    return `Unrecognized key${i.keys.length > 1 ? "s" : ""}: ${Ao(i.keys, ", ")}`;
                case "invalid_key":
                    return `Invalid key in ${i.origin}`;
                case "invalid_union":
                    return i.options && Array.isArray(i.options) && i.options.length > 0 ? `Invalid discriminator value. Expected ${i.options.map((a)=>`'${a}'`).join(" | ")}` : i.inclusive === !1 ? "Invalid input: more than one option matched" : "Invalid input";
                case "invalid_element":
                    return `Invalid value in ${i.origin}`;
                default:
                    return "Invalid input";
            }
        };
    };
    function nb() {
        return {
            localeError: tb()
        };
    }
    var Jo;
    class rb {
        constructor(){
            this._map = new WeakMap, this._idmap = new Map;
        }
        add(t, ...n) {
            const r = n[0];
            return this._map.set(t, r), r && typeof r == "object" && "id" in r && this._idmap.set(r.id, t), this;
        }
        clear() {
            return this._map = new WeakMap, this._idmap = new Map, this;
        }
        remove(t) {
            const n = this._map.get(t);
            return n && typeof n == "object" && "id" in n && this._idmap.delete(n.id), this._map.delete(t), this;
        }
        get(t) {
            const n = t._zod.parent;
            if (n) {
                const r = {
                    ...this.get(n) ?? {}
                };
                delete r.id;
                const o = {
                    ...r,
                    ...this._map.get(t)
                };
                return Object.keys(o).length ? o : void 0;
            }
            return this._map.get(t);
        }
        has(t) {
            return this._map.has(t);
        }
    }
    function ob() {
        return new rb;
    }
    (Jo = globalThis).__zod_globalRegistry ?? (Jo.__zod_globalRegistry = ob());
    const ht = globalThis.__zod_globalRegistry;
    function ib(e, t) {
        return new e({
            type: "string",
            ...x(t)
        });
    }
    function sb(e, t) {
        return new e({
            type: "string",
            format: "email",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function ab(e, t) {
        return new e({
            type: "string",
            format: "guid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function cb(e, t) {
        return new e({
            type: "string",
            format: "uuid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function ub(e, t) {
        return new e({
            type: "string",
            format: "uuid",
            check: "string_format",
            abort: !1,
            version: "v4",
            ...x(t)
        });
    }
    function _b(e, t) {
        return new e({
            type: "string",
            format: "uuid",
            check: "string_format",
            abort: !1,
            version: "v6",
            ...x(t)
        });
    }
    function lb(e, t) {
        return new e({
            type: "string",
            format: "uuid",
            check: "string_format",
            abort: !1,
            version: "v7",
            ...x(t)
        });
    }
    function fb(e, t) {
        return new e({
            type: "string",
            format: "url",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function db(e, t) {
        return new e({
            type: "string",
            format: "emoji",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function gb(e, t) {
        return new e({
            type: "string",
            format: "nanoid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function pb(e, t) {
        return new e({
            type: "string",
            format: "cuid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function hb(e, t) {
        return new e({
            type: "string",
            format: "cuid2",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function bb(e, t) {
        return new e({
            type: "string",
            format: "ulid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function mb(e, t) {
        return new e({
            type: "string",
            format: "xid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function wb(e, t) {
        return new e({
            type: "string",
            format: "ksuid",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function yb(e, t) {
        return new e({
            type: "string",
            format: "ipv4",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function vb(e, t) {
        return new e({
            type: "string",
            format: "ipv6",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function kb(e, t) {
        return new e({
            type: "string",
            format: "cidrv4",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function Eb(e, t) {
        return new e({
            type: "string",
            format: "cidrv6",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function Sb(e, t) {
        return new e({
            type: "string",
            format: "base64",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function $b(e, t) {
        return new e({
            type: "string",
            format: "base64url",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function Ab(e, t) {
        return new e({
            type: "string",
            format: "e164",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function zb(e, t) {
        return new e({
            type: "string",
            format: "jwt",
            check: "string_format",
            abort: !1,
            ...x(t)
        });
    }
    function Ib(e, t) {
        return new e({
            type: "string",
            format: "datetime",
            check: "string_format",
            offset: !1,
            local: !1,
            precision: null,
            ...x(t)
        });
    }
    function Ob(e, t) {
        return new e({
            type: "string",
            format: "date",
            check: "string_format",
            ...x(t)
        });
    }
    function Cb(e, t) {
        return new e({
            type: "string",
            format: "time",
            check: "string_format",
            precision: null,
            ...x(t)
        });
    }
    function Tb(e, t) {
        return new e({
            type: "string",
            format: "duration",
            check: "string_format",
            ...x(t)
        });
    }
    function Pb(e, t) {
        return new e({
            type: "number",
            checks: [],
            ...x(t)
        });
    }
    function Nb(e, t) {
        return new e({
            type: "number",
            check: "number_format",
            abort: !1,
            format: "safeint",
            ...x(t)
        });
    }
    function xb(e, t) {
        return new e({
            type: "boolean",
            ...x(t)
        });
    }
    function Rb(e) {
        return new e({
            type: "unknown"
        });
    }
    function Db(e, t) {
        return new e({
            type: "never",
            ...x(t)
        });
    }
    function Vo(e, t) {
        return new ks({
            check: "less_than",
            ...x(t),
            value: e,
            inclusive: !1
        });
    }
    function Fn(e, t) {
        return new ks({
            check: "less_than",
            ...x(t),
            value: e,
            inclusive: !0
        });
    }
    function Ko(e, t) {
        return new Es({
            check: "greater_than",
            ...x(t),
            value: e,
            inclusive: !1
        });
    }
    function Ln(e, t) {
        return new Es({
            check: "greater_than",
            ...x(t),
            value: e,
            inclusive: !0
        });
    }
    function Wo(e, t) {
        return new Dp({
            check: "multiple_of",
            ...x(t),
            value: e
        });
    }
    function Rs(e, t) {
        return new Zp({
            check: "max_length",
            ...x(t),
            maximum: e
        });
    }
    function un(e, t) {
        return new Bp({
            check: "min_length",
            ...x(t),
            minimum: e
        });
    }
    function Ds(e, t) {
        return new jp({
            check: "length_equals",
            ...x(t),
            length: e
        });
    }
    function Mb(e, t) {
        return new Fp({
            check: "string_format",
            format: "regex",
            ...x(t),
            pattern: e
        });
    }
    function Zb(e) {
        return new Lp({
            check: "string_format",
            format: "lowercase",
            ...x(e)
        });
    }
    function Bb(e) {
        return new Up({
            check: "string_format",
            format: "uppercase",
            ...x(e)
        });
    }
    function jb(e, t) {
        return new qp({
            check: "string_format",
            format: "includes",
            ...x(t),
            includes: e
        });
    }
    function Fb(e, t) {
        return new Jp({
            check: "string_format",
            format: "starts_with",
            ...x(t),
            prefix: e
        });
    }
    function Lb(e, t) {
        return new Vp({
            check: "string_format",
            format: "ends_with",
            ...x(t),
            suffix: e
        });
    }
    function _t(e) {
        return new Kp({
            check: "overwrite",
            tx: e
        });
    }
    function Ub(e) {
        return _t((t)=>t.normalize(e));
    }
    function qb() {
        return _t((e)=>e.trim());
    }
    function Jb() {
        return _t((e)=>e.toLowerCase());
    }
    function Vb() {
        return _t((e)=>e.toUpperCase());
    }
    function Kb() {
        return _t((e)=>Eg(e));
    }
    function Wb(e, t, n) {
        return new e({
            type: "array",
            element: t,
            ...x(n)
        });
    }
    function Hb(e, t, n) {
        return new e({
            type: "custom",
            check: "custom",
            fn: t,
            ...x(n)
        });
    }
    function Gb(e, t) {
        const n = Yb((r)=>(r.addIssue = (o)=>{
                if (typeof o == "string") r.issues.push(Pt(o, r.value, n._zod.def));
                else {
                    const i = o;
                    i.fatal && (i.continue = !1), i.code ?? (i.code = "custom"), "input" in i || (i.input = r.value), i.inst ?? (i.inst = n), i.continue ?? (i.continue = !n._zod.def.abort), r.issues.push(Pt(i));
                }
            }, e(r.value, r)), t);
        return n;
    }
    function Yb(e, t) {
        const n = new le({
            check: "custom",
            ...x(t)
        });
        return n._zod.check = e, n;
    }
    function yt(e, ...t) {
        for (const n of t)for (const r of Reflect.ownKeys(n))Object.prototype.propertyIsEnumerable.call(n, r) && _e(e, r, n[r]);
        return e;
    }
    function Ms(e) {
        let t = e?.target ?? "draft-2020-12";
        return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
            processors: e.processors ?? {},
            metadataRegistry: e?.metadata ?? ht,
            target: t,
            unrepresentable: e?.unrepresentable ?? "throw",
            override: e?.override ?? (()=>{}),
            io: e?.io ?? "output",
            counter: 0,
            seen: new Map,
            sharedDefsExtractedFor: void 0,
            sharedEmitDoneFor: void 0,
            cycles: e?.cycles ?? "ref",
            reused: e?.reused ?? "inline",
            intersections: [],
            external: e?.external ?? void 0
        };
    }
    function Re(e, t, n, r, o) {
        const i = typeof t.unrepresentable == "function" ? t.unrepresentable({
            zodSchema: e,
            path: r.path,
            message: o
        }) : t.unrepresentable;
        if (i === "any") return !1;
        if (i === void 0 || i === "throw") throw new Error(o);
        return Object.assign(n, i), !0;
    }
    function se(e, t, n = {
        path: [],
        schemaPath: []
    }) {
        var r;
        const o = e._zod.def, i = t.seen.get(e);
        if (i) return i.count++, n.schemaPath.includes(e) && (i.cycle = n.path), i.schema;
        const s = {
            schema: {},
            count: 1,
            cycle: void 0,
            path: n.path
        };
        t.seen.set(e, s), t.sharedDefsExtractedFor = void 0, t.sharedEmitDoneFor = void 0;
        const a = e._zod.toJSONSchema?.();
        if (a) s.schema = a;
        else {
            const _ = {
                ...n,
                schemaPath: [
                    ...n.schemaPath,
                    e
                ],
                path: n.path
            };
            if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, s.schema, _);
            else {
                const d = s.schema, g = t.processors[o.type];
                if (!g) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
                g(e, t, d, _);
            }
            const f = e._zod.parent;
            f && (s.ref || (s.ref = f), se(f, t, _), t.seen.get(f).isParent = !0);
        }
        const c = t.metadataRegistry.get(e);
        return c && yt(s.schema, c), t.io === "input" && ce(e) && (delete s.schema.examples, delete s.schema.default), t.io === "input" && "_prefault" in s.schema && ((r = s.schema).default ?? (r.default = s.schema._prefault)), delete s.schema._prefault, t.seen.get(e).schema;
    }
    function Ho(e) {
        return e.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    function Zs(e, t) {
        const n = e.seen.get(t);
        if (!n) throw new Error("Unprocessed schema. This is a bug in Zod.");
        if (e.external && e.sharedDefsExtractedFor === e.external) return;
        const r = new Map;
        for (const s of e.seen.entries()){
            const a = e.metadataRegistry.get(s[0])?.id;
            if (a) {
                const c = r.get(a);
                if (c && c !== s[0]) throw new Error(`Duplicate schema id "${a}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
                r.set(a, s[0]);
            }
        }
        const o = (s)=>{
            const a = e.target === "draft-2020-12" ? "$defs" : "definitions";
            if (e.external) {
                const f = e.external.registry.get(s[0])?.id, d = e.external.uri ?? ((b)=>b);
                if (f) return {
                    ref: d(f)
                };
                const g = s[1].defId ?? s[1].schema.id ?? `schema${e.counter++}`;
                return s[1].defId = g, {
                    defId: g,
                    ref: `${d("__shared")}#/${a}/${Ho(g)}`
                };
            }
            const c = "#", u = `${c}/${a}/`;
            if (s[1] === n && !s[1].schema.id) return {
                ref: c
            };
            const _ = s[1].schema.id ?? `__schema${e.counter++}`;
            return {
                defId: _,
                ref: u + Ho(_)
            };
        }, i = (s)=>{
            if (s[1].schema.$ref) return;
            const a = s[1], { ref: c, defId: u } = o(s);
            a.def = {
                ...a.schema
            }, u && (a.defId = u);
            const _ = a.schema;
            for(const f in _)delete _[f];
            _.$ref = c;
        };
        if (e.cycles === "throw") for (const s of e.seen.entries()){
            const a = s[1];
            if (a.cycle) throw new Error(`Cycle detected: #/${a.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
        }
        for (const s of e.seen.entries()){
            const a = s[1];
            if (t === s[0]) {
                i(s);
                continue;
            }
            if (e.external) {
                const u = e.external.registry.get(s[0])?.id;
                if (t !== s[0] && u) {
                    i(s);
                    continue;
                }
            }
            if (e.metadataRegistry.get(s[0])?.id) {
                i(s);
                continue;
            }
            if (a.cycle) {
                i(s);
                continue;
            }
            if (a.count > 1 && e.reused === "ref") {
                i(s);
                continue;
            }
        }
        e.external && (e.sharedDefsExtractedFor = e.external);
    }
    function Bs(e) {
        const t = e.anyOf;
        if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
        const n = [];
        for (const r of t){
            if (!r || typeof r != "object") return;
            Bs(r);
            const o = Object.keys(r);
            if (o.length !== 1 || o[0] !== "type") return;
            const i = r.type;
            for (const s of Array.isArray(i) ? i : [
                i
            ]){
                if (typeof s != "string") return;
                n.includes(s) || n.push(s);
            }
        }
        delete e.anyOf, e.type = n.length === 1 ? n[0] : n;
    }
    const js = new Set([
        "type",
        "properties",
        "required",
        "additionalProperties"
    ]), Go = [
        "oneOf",
        "anyOf"
    ];
    function Yo(e) {
        const t = e.additionalProperties;
        return t === void 0 || t === !1 || typeof t != "object" || t === null ? null : Object.keys(t).length ? t : null;
    }
    function Or(e) {
        const t = [];
        for (const i of e){
            if (typeof i != "object" || i.type !== "object") return null;
            for(const s in i)if (!js.has(s)) return null;
            t.push(i);
        }
        const n = {}, r = new Set;
        for (const i of t){
            for(const s in i.properties){
                if (Object.prototype.hasOwnProperty.call(n, s)) continue;
                const a = [];
                for (const u of t){
                    const _ = u.properties?.[s] ?? Yo(u);
                    _ != null && (a.some((f)=>JSON.stringify(f) === JSON.stringify(_)) || a.push(_));
                }
                const c = a.length === 1 ? a[0] : Or(a) ?? {
                    allOf: a
                };
                _e(n, s, c);
            }
            for (const s of i.required ?? [])r.add(s);
        }
        const o = {
            type: "object",
            properties: n
        };
        if (r.size && (o.required = [
            ...r
        ]), t.every((i)=>i.additionalProperties === !1)) o.additionalProperties = !1;
        else {
            const i = [];
            for (const s of t){
                const a = Yo(s);
                a && !i.some((c)=>JSON.stringify(c) === JSON.stringify(a)) && i.push(a);
            }
            i.length === 1 ? o.additionalProperties = i[0] : i.length > 1 && (o.additionalProperties = {
                allOf: i
            });
        }
        return o;
    }
    function Qb(e) {
        const t = e.allOf;
        if (!Array.isArray(t) || t.length < 2) return;
        for (const o of js)if (o in e) return;
        const n = t.filter((o)=>Go.some((i)=>Array.isArray(o[i])));
        let r = null;
        if (!n.length) r = Or(t);
        else {
            const o = n[0], i = Go.find((c)=>Array.isArray(o[c]));
            if (Object.keys(o).length !== 1) return;
            const s = t.filter((c)=>c !== o), a = o[i].map((c)=>Or([
                    ...s,
                    c
                ]));
            if (a.some((c)=>!c)) return;
            r = {
                [i]: a
            };
        }
        r && (delete e.allOf, yt(e, r));
    }
    function Fs(e, t) {
        const n = e.seen.get(t);
        if (!n) throw new Error("Unprocessed schema. This is a bug in Zod.");
        const r = (a)=>{
            const c = e.seen.get(a);
            if (c.ref === null) return;
            const u = c.def ?? c.schema, _ = {
                ...u
            }, f = c.ref;
            if (c.ref = null, f) {
                r(f);
                const g = e.seen.get(f), b = g.schema;
                if (b.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (u.allOf = u.allOf ?? [], u.allOf.push(b)) : yt(u, b), yt(u, _), a._zod.parent === f) for(const z in u)z === "$ref" || z === "allOf" || z in _ || delete u[z];
                if (b.$ref && g.def) for(const z in u)z === "$ref" || z === "allOf" || z in g.def && JSON.stringify(u[z]) === JSON.stringify(g.def[z]) && delete u[z];
            }
            const d = a._zod.parent;
            if (d && d !== f) {
                r(d);
                const g = e.seen.get(d);
                if (g?.schema.$ref && (u.$ref = g.schema.$ref, g.def)) for(const b in u)b === "$ref" || b === "allOf" || b in g.def && JSON.stringify(u[b]) === JSON.stringify(g.def[b]) && delete u[b];
            }
            e.override({
                zodSchema: a,
                jsonSchema: u,
                path: c.path ?? []
            });
        };
        if (!e.external || e.sharedEmitDoneFor !== e.external) {
            for (const a of [
                ...e.seen.entries()
            ].reverse())r(a[0]);
            if (e.target !== "openapi-3.0") for (const a of e.seen.entries())Bs(a[1].def ?? a[1].schema);
            if (e.intersections.length) {
                const a = new Map;
                for (const c of e.seen.values())for (const u of [
                    c.schema,
                    c.def
                ]){
                    const _ = u?.allOf;
                    if (!Array.isArray(_)) continue;
                    const f = a.get(_);
                    f ? f.push(u) : a.set(_, [
                        u
                    ]);
                }
                for (const c of e.intersections)for (const u of a.get(c) ?? [])Qb(u);
            }
        }
        const o = {};
        if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
            const a = e.external.registry.get(t)?.id;
            if (!a) throw new Error("Schema is missing an `id` property");
            o.$id = e.external.uri(a);
        }
        yt(o, n.defId ? n.schema : n.def ?? n.schema);
        const i = e.metadataRegistry.get(t)?.id;
        i !== void 0 && o.id === i && delete o.id;
        const s = e.external?.defs ?? {};
        if (!e.external || e.sharedEmitDoneFor !== e.external) for (const a of e.seen.entries()){
            const c = a[1];
            c.def && c.defId && (c.def.id === c.defId && delete c.def.id, _e(s, c.defId, c.def));
        }
        e.external && (e.sharedEmitDoneFor = e.external), e.external || Object.keys(s).length > 0 && (e.target === "draft-2020-12" ? o.$defs = s : o.definitions = s);
        try {
            const a = JSON.parse(JSON.stringify(o));
            return Object.defineProperty(a, "~standard", {
                value: {
                    ...t["~standard"],
                    jsonSchema: {
                        input: _n(t, "input", e.processors),
                        output: _n(t, "output", e.processors)
                    }
                },
                enumerable: !1,
                writable: !1
            }), a;
        } catch  {
            throw new Error("Error converting schema to JSON.");
        }
    }
    function ce(e, t) {
        const n = t ?? {
            seen: new Set
        };
        if (n.seen.has(e)) return !1;
        n.seen.add(e);
        const r = e._zod.def;
        if (r.type === "transform") return !0;
        if (r.type === "array") return ce(r.element, n);
        if (r.type === "set") return ce(r.valueType, n);
        if (r.type === "lazy") return ce(r.getter(), n);
        if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault" || r.type === "catch") return ce(r.innerType, n);
        if (r.type === "intersection") return ce(r.left, n) || ce(r.right, n);
        if (r.type === "record" || r.type === "map") return ce(r.keyType, n) || ce(r.valueType, n);
        if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : ce(r.in, n) || ce(r.out, n);
        if (r.type === "object") {
            for(const o in r.shape)if (ce(r.shape[o], n)) return !0;
            return !1;
        }
        if (r.type === "union") {
            for (const o of r.options)if (ce(o, n)) return !0;
            return !1;
        }
        if (r.type === "tuple") {
            for (const o of r.items)if (ce(o, n)) return !0;
            return !!(r.rest && ce(r.rest, n));
        }
        return !1;
    }
    const Xb = (e, t = {})=>(n)=>{
            const r = Ms({
                ...n,
                processors: t
            });
            return se(e, r), Zs(r, e), Fs(r, e);
        }, _n = (e, t, n = {})=>(r)=>{
            const { libraryOptions: o, target: i } = r ?? {}, s = Ms({
                ...o ?? {},
                target: i,
                io: t,
                processors: n
            });
            return se(e, s), Zs(s, e), Fs(s, e);
        }, em = {
        guid: "uuid",
        url: "uri",
        datetime: "date-time",
        json_string: "json-string",
        regex: ""
    }, tm = (e, t, n, r)=>{
        const o = n;
        o.type = "string";
        const { minimum: i, maximum: s, format: a, patterns: c, contentEncoding: u, laxFormat: _ } = e._zod.bag;
        if (typeof i == "number" && (o.minLength = i), typeof s == "number" && (o.maxLength = s), a && (o.format = em[a] ?? a, o.format === "" && delete o.format, (a === "time" || _) && delete o.format), u && (o.contentEncoding = u), c && c.size > 0) {
            const f = [
                ...c
            ];
            f.length === 1 ? o.pattern = f[0].source : f.length > 1 && (o.allOf = [
                ...f.map((d)=>({
                        ...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? {
                            type: "string"
                        } : {},
                        pattern: d.source
                    }))
            ]);
        }
    }, nm = (e, t, n, r)=>{
        const o = n, { minimum: i, maximum: s, format: a, multipleOf: c, exclusiveMaximum: u, exclusiveMinimum: _ } = e._zod.bag;
        typeof a == "string" && a.includes("int") ? o.type = "integer" : o.type = "number";
        const f = typeof _ == "number" && _ >= (i ?? Number.NEGATIVE_INFINITY), d = typeof u == "number" && u <= (s ?? Number.POSITIVE_INFINITY), g = t.target === "draft-04" || t.target === "openapi-3.0";
        f ? g ? (o.minimum = _, o.exclusiveMinimum = !0) : o.exclusiveMinimum = _ : typeof i == "number" && (o.minimum = i), d ? g ? (o.maximum = u, o.exclusiveMaximum = !0) : o.exclusiveMaximum = u : typeof s == "number" && (o.maximum = s), typeof c == "number" && (Number.isFinite(c) && c !== 0 ? o.multipleOf = Math.abs(c) : Re(e, t, o, r, `A multipleOf divisor of ${c} cannot be represented in JSON Schema`));
    }, rm = (e, t, n, r)=>{
        n.type = "boolean";
    }, om = (e, t, n, r)=>{
        n.not = {};
    }, im = (e, t, n, r)=>{}, sm = (e, t, n, r)=>{
        const o = e._zod.def, i = _s(o.entries);
        if (i.length === 0) {
            n.not = {};
            return;
        }
        i.every((s)=>typeof s == "number") && (n.type = "number"), i.every((s)=>typeof s == "string") && (n.type = "string"), n.enum = i;
    }, am = (e, t, n, r)=>{
        const o = e._zod.def;
        if (o.values.length === 0) {
            n.not = {};
            return;
        }
        const i = [];
        for (const s of o.values)if (s === void 0) {
            if (Re(e, t, n, r, "Literal `undefined` cannot be represented in JSON Schema")) return;
        } else if (typeof s == "bigint") {
            if (Re(e, t, n, r, "BigInt literals cannot be represented in JSON Schema")) return;
            i.push(Number(s));
        } else i.push(s);
        if (i.length !== 0) if (i.length === 1) {
            const s = i[0];
            n.type = s === null ? "null" : typeof s, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [
                s
            ] : n.const = s;
        } else i.every((s)=>typeof s == "number") && (n.type = "number"), i.every((s)=>typeof s == "string") && (n.type = "string"), i.every((s)=>typeof s == "boolean") && (n.type = "boolean"), i.every((s)=>s === null) && (n.type = "null"), n.enum = i;
    }, cm = (e, t, n, r)=>{
        Re(e, t, n, r, "Custom types cannot be represented in JSON Schema");
    }, um = (e, t, n, r)=>{
        Re(e, t, n, r, "Transforms cannot be represented in JSON Schema");
    }, _m = (e, t, n, r)=>{
        const o = n, i = e._zod.def, { minimum: s, maximum: a } = e._zod.bag;
        typeof s == "number" && (o.minItems = s), typeof a == "number" && (o.maxItems = a), o.type = "array", o.items = se(i.element, t, {
            ...r,
            path: [
                ...r.path,
                "items"
            ]
        });
    };
    function Cr(e) {
        const t = e._zod.def;
        return t.type === "pipe" && t.in._zod.traits.has("$ZodTransform") ? Cr(t.out) : t.type === "catch" ? Cr(t.innerType) : e._zod.optin;
    }
    const lm = (e, t, n, r)=>{
        const o = n, i = e._zod.def, s = i.shape;
        if (Object.getOwnPropertySymbols(s).length && Re(e, t, o, r, "Symbol keys cannot be represented in JSON Schema")) return;
        o.type = "object", o.properties = {};
        for(const _ in s)_e(o.properties, _, se(s[_], t, {
            ...r,
            path: [
                ...r.path,
                "properties",
                _
            ]
        }));
        const c = new Set(Object.keys(s)), u = new Set([
            ...c
        ].filter((_)=>{
            const f = i.shape[_];
            return t.io === "input" ? Cr(f) === void 0 : f._zod.optout === void 0;
        }));
        u.size > 0 && (o.required = Array.from(u)), i.catchall?._zod.def.type === "never" ? o.additionalProperties = !1 : i.catchall ? i.catchall && (o.additionalProperties = se(i.catchall, t, {
            ...r,
            path: [
                ...r.path,
                "additionalProperties"
            ]
        })) : t.io === "output" && (o.additionalProperties = !1);
    }, fm = (e, t, n, r)=>{
        const o = e._zod.def, i = o.inclusive === !1, s = o.options.map((a, c)=>se(a, t, {
                ...r,
                path: [
                    ...r.path,
                    i ? "oneOf" : "anyOf",
                    c
                ]
            }));
        i ? n.oneOf = s : n.anyOf = s;
    }, dm = (e, t, n, r)=>{
        const o = e._zod.def, i = se(o.left, t, {
            ...r,
            path: [
                ...r.path,
                "allOf",
                0
            ]
        }), s = se(o.right, t, {
            ...r,
            path: [
                ...r.path,
                "allOf",
                1
            ]
        }), a = (u)=>"allOf" in u && Object.keys(u).length === 1, c = [
            ...a(i) ? i.allOf : [
                i
            ],
            ...a(s) ? s.allOf : [
                s
            ]
        ];
        n.allOf = c, t.intersections.push(c);
    }, gm = (e, t, n, r)=>{
        const o = e._zod.def, i = se(o.innerType, t, r), s = t.seen.get(e);
        t.target === "openapi-3.0" ? (s.ref = o.innerType, n.nullable = !0) : n.anyOf = [
            i,
            {
                type: "null"
            }
        ];
    }, pm = (e, t, n, r)=>{
        const o = e._zod.def;
        se(o.innerType, t, r);
        const i = t.seen.get(e);
        i.ref = o.innerType;
    }, Vr = Symbol();
    function Ls(e, t, n, r, o) {
        let i = !1;
        const s = JSON.stringify(e, (a, c)=>typeof c != "bigint" ? c : (i = !0, null));
        return i ? (Re(t, n, r, o, "BigInt defaults cannot be represented in JSON Schema"), Vr) : JSON.parse(s);
    }
    const hm = (e, t, n, r)=>{
        const o = e._zod.def;
        se(o.innerType, t, r);
        const i = t.seen.get(e);
        i.ref = o.innerType;
        const s = Ls(o.defaultValue, e, t, n, r);
        s !== Vr && (n.default = s);
    }, bm = (e, t, n, r)=>{
        const o = e._zod.def;
        se(o.innerType, t, r);
        const i = t.seen.get(e);
        if (i.ref = o.innerType, t.io !== "input") return;
        const s = Ls(o.defaultValue, e, t, n, r);
        s !== Vr && (n._prefault = s);
    }, mm = (e, t, n, r)=>{
        const o = e._zod.def;
        se(o.innerType, t, r);
        const i = t.seen.get(e);
        i.ref = o.innerType;
        let s;
        try {
            s = o.catchValue(void 0);
        } catch  {
            Re(e, t, n, r, "Dynamic catch values are not supported in JSON Schema");
            return;
        }
        n.default = s;
    }, wm = (e, t, n, r)=>{
        const o = e._zod.def, i = o.in._zod.traits.has("$ZodTransform"), s = t.io === "input" ? i ? o.out : o.in : o.out;
        se(s, t, r);
        const a = t.seen.get(e);
        a.ref = s;
    }, ym = (e, t, n, r)=>{
        const o = e._zod.def;
        se(o.innerType, t, r);
        const i = t.seen.get(e);
        i.ref = o.innerType, n.readOnly = !0;
    }, Us = (e, t, n, r)=>{
        const o = e._zod.def;
        se(o.innerType, t, r);
        const i = t.seen.get(e);
        i.ref = o.innerType;
    }, Qo = new WeakSet([
        Object.prototype,
        Error.prototype
    ]);
    function Lt(e, t, n) {
        Object.defineProperty(e, t, {
            configurable: !0,
            enumerable: !1,
            get () {
                const r = n(this);
                return Object.defineProperty(this, t, {
                    value: r,
                    configurable: !0,
                    writable: !0
                }), r;
            },
            set (r) {
                Object.defineProperty(this, t, {
                    value: r,
                    configurable: !0,
                    writable: !0
                });
            }
        });
    }
    const vm = (e, t)=>{
        ms.init(e, t), e.name = "ZodError";
        const n = Object.getPrototypeOf(e);
        Qo.has(n) || (Qo.add(n), Lt(n, "format", (r)=>(o)=>Gg(r, o)), Lt(n, "flatten", (r)=>(o)=>Hg(r, o)), Lt(n, "addIssue", (r)=>(o)=>{
                r.issues.push(o), r.message = JSON.stringify(r.issues, Sr, 2);
            }), Lt(n, "addIssues", (r)=>(o)=>{
                r.issues.push(...o), r.message = JSON.stringify(r.issues, Sr, 2);
            }), Object.defineProperty(n, "isEmpty", {
            configurable: !0,
            enumerable: !1,
            get () {
                return this.issues.length === 0;
            }
        }));
    }, fe = h("ZodError", vm, void 0, {
        Parent: Error
    }), km = Lr(fe), Em = Ur(fe), Sm = bn(fe), $m = mn(fe), Am = Xg(fe), zm = ep(fe), Im = tp(fe), Om = np(fe), Cm = rp(fe), Tm = op(fe), Pm = ip(fe), Nm = sp(fe);
    function xm() {
        be.localeError || Be(nb());
    }
    function Kr() {
        be.memoizer || Be({
            memoizer: Xh()
        });
    }
    const ee = h("ZodType", (e, t)=>(xm(), X.init(e, t), e.def = t, e.type = t.type, e), {
        check (...e) {
            const t = this.def;
            return this.clone(Me(t, {
                checks: [
                    ...t.checks ?? [],
                    ...e.map((n)=>typeof n == "function" ? {
                            _zod: {
                                check: n,
                                def: {
                                    check: "custom"
                                },
                                onattach: []
                            }
                        } : n)
                ]
            }), {
                parent: !0
            });
        },
        with (...e) {
            return this.check(...e);
        },
        clone (e, t) {
            return Ze(this, e, t);
        },
        brand () {
            return this;
        },
        register (e, t) {
            return e.add(this, t), this;
        },
        refine (e, t) {
            return this.check(Tw(e, t));
        },
        superRefine (e, t) {
            return this.check(Pw(e, t));
        },
        overwrite (e) {
            return this.check(_t(e));
        },
        optional () {
            return ti(this);
        },
        exactOptional () {
            return mw(this);
        },
        nullable () {
            return ni(this);
        },
        nullish () {
            return ti(ni(this));
        },
        nonoptional (e) {
            return Sw(this, e);
        },
        array () {
            return Te(this);
        },
        or (e) {
            return lw([
                this,
                e
            ]);
        },
        and (e) {
            return gw(this, e);
        },
        transform (e) {
            return ri(this, bw(e));
        },
        default (e) {
            return vw(this, e);
        },
        prefault (e) {
            return Ew(this, e);
        },
        catch (e) {
            return Aw(this, e);
        },
        pipe (e) {
            return ri(this, e);
        },
        readonly () {
            return Ow(this);
        },
        describe (e) {
            const t = this.clone();
            return ht.add(t, {
                description: e
            }), t;
        },
        meta (...e) {
            if (e.length === 0) return ht.get(this);
            const t = this.clone();
            return ht.add(t, e[0]), t;
        },
        isOptional () {
            return this.safeParse(void 0).success;
        },
        isNullable () {
            return this.safeParse(null).success;
        },
        apply (e, ...t) {
            return t.length === 0 ? e(this) : e(this, ...t);
        },
        get "~standard" () {
            return ps(this, "~standard", {
                ...Ss(this),
                jsonSchema: {
                    input: _n(this, "input"),
                    output: _n(this, "output")
                }
            });
        },
        set "~standard" (e){
            Ne(this, "~standard", e);
        },
        parse: function e(t, n) {
            return km(this, t, n, {
                callee: e
            });
        },
        parseAsync: async function e(t, n) {
            return await Em(this, t, n, {
                callee: e
            });
        },
        safeParse (e, t) {
            return Sm(this, e, t);
        },
        async safeParseAsync (e, t) {
            return $m(this, e, t);
        },
        get spa () {
            return this.safeParseAsync;
        },
        set spa (e){
            Ne(this, "spa", e);
        },
        encode: function e(t, n) {
            return Am(this, t, n, {
                callee: e
            });
        },
        decode: function e(t, n) {
            return zm(this, t, n, {
                callee: e
            });
        },
        encodeAsync: async function e(t, n) {
            return await Im(this, t, n, {
                callee: e
            });
        },
        decodeAsync: async function e(t, n) {
            return await Om(this, t, n, {
                callee: e
            });
        },
        safeEncode (e, t) {
            return Cm(this, e, t);
        },
        safeDecode (e, t) {
            return Tm(this, e, t);
        },
        async safeEncodeAsync (e, t) {
            return Pm(this, e, t);
        },
        async safeDecodeAsync (e, t) {
            return Nm(this, e, t);
        },
        get toJSONSchema () {
            return Ne(this, "toJSONSchema", Xb(this, {}));
        },
        set toJSONSchema (e){
            Ne(this, "toJSONSchema", e);
        },
        get description () {
            return ht.get(this)?.description;
        },
        get _def () {
            return this._zod.def;
        }
    }), qs = h("_ZodString", (e, t)=>{
        Jr.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (r, o, i)=>tm(e, r, o);
        const n = e._zod.bag;
        e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null;
    }, {
        regex (...e) {
            return this.check(Mb(...e));
        },
        includes (...e) {
            return this.check(jb(...e));
        },
        startsWith (...e) {
            return this.check(Fb(...e));
        },
        endsWith (...e) {
            return this.check(Lb(...e));
        },
        min (...e) {
            return this.check(un(...e));
        },
        max (...e) {
            return this.check(Rs(...e));
        },
        length (...e) {
            return this.check(Ds(...e));
        },
        nonempty (...e) {
            return this.check(un(1, ...e));
        },
        lowercase (e) {
            return this.check(Zb(e));
        },
        uppercase (e) {
            return this.check(Bb(e));
        },
        trim () {
            return this.check(qb());
        },
        normalize (...e) {
            return this.check(Ub(...e));
        },
        toLowerCase () {
            return this.check(Jb());
        },
        toUpperCase () {
            return this.check(Vb());
        },
        slugify () {
            return this.check(Kb());
        }
    }), Rm = h("ZodString", (e, t)=>{
        Jr.init(e, t), qs.init(e, t);
    }, {
        email (e) {
            return this.check(sb(jm, e));
        },
        url (e) {
            return this.check(fb(Lm, e));
        },
        jwt (e) {
            return this.check(zb(rw, e));
        },
        emoji (e) {
            return this.check(db(Um, e));
        },
        guid (e) {
            return this.check(ab(Fm, e));
        },
        uuid (e) {
            return this.check(cb(Ut, e));
        },
        uuidv4 (e) {
            return this.check(ub(Ut, e));
        },
        uuidv6 (e) {
            return this.check(_b(Ut, e));
        },
        uuidv7 (e) {
            return this.check(lb(Ut, e));
        },
        nanoid (e) {
            return this.check(gb(qm, e));
        },
        cuid (e) {
            return this.check(pb(Jm, e));
        },
        cuid2 (e) {
            return this.check(hb(Vm, e));
        },
        ulid (e) {
            return this.check(bb(Km, e));
        },
        base64 (e) {
            return this.check(Sb(ew, e));
        },
        base64url (e) {
            return this.check($b(tw, e));
        },
        xid (e) {
            return this.check(mb(Wm, e));
        },
        ksuid (e) {
            return this.check(wb(Hm, e));
        },
        ipv4 (e) {
            return this.check(yb(Gm, e));
        },
        ipv6 (e) {
            return this.check(vb(Ym, e));
        },
        cidrv4 (e) {
            return this.check(kb(Qm, e));
        },
        cidrv6 (e) {
            return this.check(Eb(Xm, e));
        },
        e164 (e) {
            return this.check(Ab(nw, e));
        },
        datetime (e) {
            return this.check(Ib(Dm, e));
        },
        date (e) {
            return this.check(Ob(Mm, e));
        },
        time (e) {
            return this.check(Cb(Zm, e));
        },
        duration (e) {
            return this.check(Tb(Bm, e));
        }
    });
    function de(e) {
        return ib(Rm, e);
    }
    const Q = h("ZodStringFormat", (e, t)=>{
        G.init(e, t), qs.init(e, t);
    }), Dm = h("ZodISODateTime", (e, t)=>{
        fh.init(e, t), Q.init(e, t);
    }), Mm = h("ZodISODate", (e, t)=>{
        dh.init(e, t), Q.init(e, t);
    }), Zm = h("ZodISOTime", (e, t)=>{
        gh.init(e, t), Q.init(e, t);
    }), Bm = h("ZodISODuration", (e, t)=>{
        ph.init(e, t), Q.init(e, t);
    }), jm = h("ZodEmail", (e, t)=>{
        Qp.init(e, t), Q.init(e, t);
    }), Fm = h("ZodGUID", (e, t)=>{
        Gp.init(e, t), Q.init(e, t);
    }), Ut = h("ZodUUID", (e, t)=>{
        Yp.init(e, t), Q.init(e, t);
    }), Lm = h("ZodURL", (e, t)=>{
        oh.init(e, t), Q.init(e, t);
    }), Um = h("ZodEmoji", (e, t)=>{
        ih.init(e, t), Q.init(e, t);
    }), qm = h("ZodNanoID", (e, t)=>{
        sh.init(e, t), Q.init(e, t);
    }), Jm = h("ZodCUID", (e, t)=>{
        ah.init(e, t), Q.init(e, t);
    }), Vm = h("ZodCUID2", (e, t)=>{
        ch.init(e, t), Q.init(e, t);
    }), Km = h("ZodULID", (e, t)=>{
        uh.init(e, t), Q.init(e, t);
    }), Wm = h("ZodXID", (e, t)=>{
        _h.init(e, t), Q.init(e, t);
    }), Hm = h("ZodKSUID", (e, t)=>{
        lh.init(e, t), Q.init(e, t);
    }), Gm = h("ZodIPv4", (e, t)=>{
        hh.init(e, t), Q.init(e, t);
    }), Ym = h("ZodIPv6", (e, t)=>{
        mh.init(e, t), Q.init(e, t);
    }), Qm = h("ZodCIDRv4", (e, t)=>{
        wh.init(e, t), Q.init(e, t);
    }), Xm = h("ZodCIDRv6", (e, t)=>{
        vh.init(e, t), Q.init(e, t);
    }), ew = h("ZodBase64", (e, t)=>{
        kh.init(e, t), Q.init(e, t);
    }), tw = h("ZodBase64URL", (e, t)=>{
        Sh.init(e, t), Q.init(e, t);
    }), nw = h("ZodE164", (e, t)=>{
        $h.init(e, t), Q.init(e, t);
    }), rw = h("ZodJWT", (e, t)=>{
        zh.init(e, t), Q.init(e, t);
    }), Js = h("ZodNumber", (e, t)=>{
        Os.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (r, o, i)=>nm(e, r, o, i);
        const n = e._zod.bag;
        e.minValue = Math.max(n.minimum ?? Number.NEGATIVE_INFINITY, n.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, e.maxValue = Math.min(n.maximum ?? Number.POSITIVE_INFINITY, n.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? .5), e.isFinite = !0, e.format = n.format ?? null;
    }, {
        gt (e, t) {
            return this.check(Ko(e, t));
        },
        gte (e, t) {
            return this.check(Ln(e, t));
        },
        min (e, t) {
            return this.check(Ln(e, t));
        },
        lt (e, t) {
            return this.check(Vo(e, t));
        },
        lte (e, t) {
            return this.check(Fn(e, t));
        },
        max (e, t) {
            return this.check(Fn(e, t));
        },
        int (e) {
            return this.check(Xo(e));
        },
        safe (e) {
            return this.check(Xo(e));
        },
        positive (e) {
            return this.check(Ko(0, e));
        },
        nonnegative (e) {
            return this.check(Ln(0, e));
        },
        negative (e) {
            return this.check(Vo(0, e));
        },
        nonpositive (e) {
            return this.check(Fn(0, e));
        },
        multipleOf (e, t) {
            return this.check(Wo(e, t));
        },
        step (e, t) {
            return this.check(Wo(e, t));
        },
        finite () {
            return this;
        }
    });
    function ue(e) {
        return Pb(Js, e);
    }
    const ow = h("ZodNumberFormat", (e, t)=>{
        Ih.init(e, t), Js.init(e, t);
    });
    function Xo(e) {
        return Nb(ow, e);
    }
    const iw = h("ZodBoolean", (e, t)=>{
        Oh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>rm(e, n, r);
    });
    function Ce(e) {
        return xb(iw, e);
    }
    const sw = h("ZodUnknown", (e, t)=>{
        Ch.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>im();
    });
    function ei() {
        return Rb(sw);
    }
    const aw = h("ZodNever", (e, t)=>{
        Th.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>om(e, n, r);
    });
    function cw(e) {
        return Db(aw, e);
    }
    const uw = h("ZodArray", (e, t)=>{
        Kr(), Ph.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>_m(e, n, r, o), e.element = t.element;
    }, {
        min (e, t) {
            return this.check(un(e, t));
        },
        nonempty (e) {
            return this.check(un(1, e));
        },
        max (e, t) {
            return this.check(Rs(e, t));
        },
        length (e, t) {
            return this.check(Ds(e, t));
        },
        unwrap () {
            return this.element;
        }
    });
    function Te(e, t) {
        return Wb(uw, e, t);
    }
    const _w = h("ZodObject", (e, t)=>{
        Kr(), Rh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>lm(e, n, r, o), Fg(e, "shape", (n)=>n._zod.def.shape, !1);
    }, {
        keyof () {
            return yn(Object.keys(this._zod.def.shape));
        },
        catchall (e) {
            return this.clone({
                ...this._zod.def,
                catchall: e
            });
        },
        passthrough () {
            return this.clone({
                ...this._zod.def,
                catchall: ei()
            });
        },
        loose () {
            return this.clone({
                ...this._zod.def,
                catchall: ei()
            });
        },
        strict () {
            return this.clone({
                ...this._zod.def,
                catchall: cw()
            });
        },
        strip () {
            return this.clone({
                ...this._zod.def,
                catchall: void 0
            });
        },
        extend (e) {
            return Cg(this, e);
        },
        safeExtend (e) {
            return Tg(this, e);
        },
        merge (e) {
            return Pg(this, e);
        },
        pick (e) {
            return Ig(this, e);
        },
        omit (e) {
            return Og(this, e);
        },
        partial (...e) {
            return zo(Ws, this, e[0]);
        },
        exactPartial (...e) {
            return zo(Hs, this, e[0], "exactPartial");
        },
        required (...e) {
            return Ng(Gs, this, e[0]);
        }
    });
    function V(e, t) {
        const n = {
            type: "object",
            shape: e ?? {},
            ...x(t)
        };
        return new _w(n);
    }
    const Vs = h("ZodUnion", (e, t)=>{
        Ps.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>fm(e, n, r, o), e.options = t.options;
    });
    function lw(e, t) {
        return new Vs({
            type: "union",
            options: e,
            ...x(t)
        });
    }
    const fw = h("ZodDiscriminatedUnion", (e, t)=>{
        Vs.init(e, t), Dh.init(e, t);
    });
    function Ks(e, t, n) {
        return new fw({
            type: "union",
            options: t,
            discriminator: e,
            ...x(n)
        });
    }
    const dw = h("ZodIntersection", (e, t)=>{
        Mh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>dm(e, n, r, o);
    });
    function gw(e, t) {
        return new dw({
            type: "intersection",
            left: e,
            right: t
        });
    }
    const Tr = h("ZodEnum", (e, t)=>{
        Zh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (r, o, i)=>sm(e, r, o), e.enum = t.entries, e.options = Object.values(t.entries);
        const n = new Set(Object.keys(t.entries));
        e.extract = (r, o)=>{
            const i = {};
            for (const s of r)if (n.has(s)) i[s] = t.entries[s];
            else throw new Error(`Key ${s} not found in enum`);
            return new Tr({
                ...t,
                checks: [],
                ...x(o),
                entries: i
            });
        }, e.exclude = (r, o)=>{
            const i = {
                ...t.entries
            };
            for (const s of r)if (n.has(s)) delete i[s];
            else throw new Error(`Key ${s} not found in enum`);
            return new Tr({
                ...t,
                checks: [],
                ...x(o),
                entries: i
            });
        };
    });
    function yn(e, t) {
        const n = Array.isArray(e) ? Object.fromEntries(e.map((r)=>[
                r,
                r
            ])) : e;
        return new Tr({
            type: "enum",
            entries: n,
            ...x(t)
        });
    }
    const pw = h("ZodLiteral", (e, t)=>{
        Bh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>am(e, n, r, o), e.values = new Set(t.values), Object.defineProperty(e, "value", {
            get () {
                if (t.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
                return t.values[0];
            }
        });
    });
    function B(e, t) {
        return new pw({
            type: "literal",
            values: Array.isArray(e) ? e : [
                e
            ],
            ...x(t)
        });
    }
    const hw = h("ZodTransform", (e, t)=>{
        Kr(), jh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>um(e, n, r, o), e._zod.parse = (n, r)=>{
            if (r.direction === "backward") throw new hs(e.constructor.name);
            n.addIssue = (i)=>{
                if (typeof i == "string") n.issues.push(Pt(i, n.value, t));
                else {
                    const s = i;
                    s.fatal && (s.continue = !1), s.code ?? (s.code = "custom"), "input" in s || (s.input = n.value), s.inst ?? (s.inst = e), n.issues.push(Pt(s));
                }
            };
            const o = t.transform(n.value, n);
            return o instanceof Promise ? o.then((i)=>(n.value = i, n)) : (n.value = o, n);
        };
    });
    function bw(e) {
        return new hw({
            type: "transform",
            transform: e
        });
    }
    const Ws = h("ZodOptional", (e, t)=>{
        Ns.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>Us(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType;
    });
    function ti(e) {
        return new Ws({
            type: "optional",
            innerType: e
        });
    }
    const Hs = h("ZodExactOptional", (e, t)=>{
        Fh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>Us(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType;
    });
    function mw(e) {
        return new Hs({
            type: "optional",
            innerType: e
        });
    }
    const ww = h("ZodNullable", (e, t)=>{
        Lh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>gm(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType;
    });
    function ni(e) {
        return new ww({
            type: "nullable",
            innerType: e
        });
    }
    const yw = h("ZodDefault", (e, t)=>{
        Uh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>hm(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType, e.removeDefault = e.unwrap;
    });
    function vw(e, t) {
        return new yw({
            type: "default",
            innerType: e,
            get defaultValue () {
                return typeof t == "function" ? t() : fs(t);
            }
        });
    }
    const kw = h("ZodPrefault", (e, t)=>{
        qh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>bm(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType;
    });
    function Ew(e, t) {
        return new kw({
            type: "prefault",
            innerType: e,
            get defaultValue () {
                return typeof t == "function" ? t() : fs(t);
            }
        });
    }
    const Gs = h("ZodNonOptional", (e, t)=>{
        Jh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>pm(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType;
    });
    function Sw(e, t) {
        return new Gs({
            type: "nonoptional",
            innerType: e,
            ...x(t)
        });
    }
    const $w = h("ZodCatch", (e, t)=>{
        Vh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>mm(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType, e.removeCatch = e.unwrap;
    });
    function Aw(e, t) {
        return new $w({
            type: "catch",
            innerType: e,
            catchValue: typeof t == "function" ? t : Ug(t)
        });
    }
    const zw = h("ZodPipe", (e, t)=>{
        Kh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>wm(e, n, r, o), e.in = t.in, e.out = t.out;
    });
    function ri(e, t) {
        return new zw({
            type: "pipe",
            in: e,
            out: t
        });
    }
    const Iw = h("ZodReadonly", (e, t)=>{
        Wh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>ym(e, n, r, o), e.unwrap = ()=>e._zod.def.innerType;
    });
    function Ow(e) {
        return new Iw({
            type: "readonly",
            innerType: e
        });
    }
    const Cw = h("ZodCustom", (e, t)=>{
        Hh.init(e, t), ee.init(e, t), e._zod.processJSONSchema = (n, r, o)=>cm(e, n, r, o);
    });
    function Tw(e, t = {}) {
        return Hb(Cw, e, t);
    }
    function Pw(e, t) {
        return Gb(e, t);
    }
    const Nw = V({
        type: B("pair_request"),
        pin: de(),
        display_name: de().min(1).max(64)
    });
    V({
        type: B("pair_response"),
        ok: Ce(),
        reason: yn([
            "invalid_pin",
            "rate_limited"
        ]).optional()
    });
    async function xw(e, t) {
        if (eg(e)) return {
            type: "pair_response",
            ok: !1,
            reason: "rate_limited"
        };
        const n = Nw.safeParse(JSON.parse(t));
        if (!n.success) return yo(e), {
            type: "pair_response",
            ok: !1,
            reason: "invalid_pin"
        };
        const { pin: r, display_name: o } = n.data;
        return r !== Zr() ? (yo(e), {
            type: "pair_response",
            ok: !1,
            reason: "invalid_pin"
        }) : (tg(e), await bg(e, o), {
            type: "pair_response",
            ok: !0
        });
    }
    const ve = V({
        source_peer_addr: de(),
        blake3_hash: de(),
        size_bytes: ue().nonnegative().optional(),
        duration_ms: ue().nonnegative().optional(),
        mime_type: de().optional(),
        kind: yn([
            "audio",
            "video"
        ]).optional(),
        title: de().optional(),
        artist: de().optional(),
        artwork_url: de().optional()
    }), Rw = Ks("command", [
        V({
            type: B("control"),
            command: B("play"),
            item: ve
        }),
        V({
            type: B("control"),
            command: B("replace_queue"),
            items: Te(ve)
        }),
        V({
            type: B("control"),
            command: B("append_queue"),
            items: Te(ve)
        }),
        V({
            type: B("control"),
            command: B("pause")
        }),
        V({
            type: B("control"),
            command: B("resume")
        }),
        V({
            type: B("control"),
            command: B("seek"),
            position_ms: ue().nonnegative()
        }),
        V({
            type: B("control"),
            command: B("skip")
        }),
        V({
            type: B("control"),
            command: B("remove_from_queue"),
            index: ue().int().nonnegative()
        }),
        V({
            type: B("control"),
            command: B("reorder_queue"),
            from_index: ue().int().nonnegative(),
            to_index: ue().int().nonnegative()
        }),
        V({
            type: B("control"),
            command: B("set_volume"),
            volume: ue().min(0).max(1)
        }),
        V({
            type: B("control"),
            command: B("stop")
        }),
        V({
            type: B("control"),
            command: B("get_status")
        }),
        V({
            type: B("control"),
            command: B("set_auto_download_enabled"),
            enabled: Ce()
        }),
        V({
            type: B("control"),
            command: B("tune_radio"),
            peer_addr: de(),
            station_id: de().optional()
        }),
        V({
            type: B("control"),
            command: B("stop_radio")
        })
    ]), Dw = V({
        type: B("subscribe")
    }), Mw = Ks("state", [
        V({
            type: B("status"),
            state: B("now_playing"),
            item: ve,
            position_ms: ue().nonnegative(),
            server_time_ms: ue().nonnegative(),
            queue: Te(ve),
            auto_download_enabled: Ce(),
            volume: ue().min(0).max(1)
        }),
        V({
            type: B("status"),
            state: B("paused"),
            position_ms: ue().nonnegative(),
            queue: Te(ve),
            auto_download_enabled: Ce(),
            volume: ue().min(0).max(1)
        }),
        V({
            type: B("status"),
            state: B("buffering"),
            queue: Te(ve),
            auto_download_enabled: Ce(),
            volume: ue().min(0).max(1)
        }),
        V({
            type: B("status"),
            state: B("stopped"),
            queue: Te(ve),
            auto_download_enabled: Ce(),
            volume: ue().min(0).max(1)
        }),
        V({
            type: B("status"),
            state: B("error"),
            message: de(),
            queue: Te(ve),
            auto_download_enabled: Ce(),
            volume: ue().min(0).max(1)
        })
    ]);
    V({
        type: B("command_ack"),
        ok: Ce(),
        reason: yn([
            "untrusted",
            "invalid_command"
        ]).optional(),
        status: Mw.optional()
    });
    async function Ys(e, t, n) {
        const r = t.size_bytes && n ? await e.download_verified_with_ensure_progress(t.source_peer_addr, t.blake3_hash, t.size_bytes, n) : await e.download_verified_with_ensure(t.source_peer_addr, t.blake3_hash);
        return new Blob([
            r
        ], {
            type: t.mime_type ?? "audio/mpeg"
        });
    }
    const Le = new Map;
    function Zw(e, t) {
        let n = Le.get(e);
        n || (n = new Set, Le.set(e, n)), n.add(t);
    }
    function Bw(e, t) {
        const n = Le.get(e);
        n && (n.delete(t), n.size === 0 && Le.delete(e));
    }
    function Qs(e) {
        if (Le.size === 0) return;
        const t = JSON.stringify(e);
        for (const [n, r] of Le)for (const o of r)o.write_line(t).catch(()=>{
            Le.get(n)?.delete(o);
        });
    }
    const te = document.createElement("video");
    te.preload = "auto";
    te.playsInline = !0;
    const [Wr, Ee] = W("idle"), [Hr, Xs] = W(null), [jw, Pr] = W(null), [Fw, Lw] = W([]), [Uw, qt] = W(null), [qw, Jw] = W(0), [Vw, Kw] = W(0), [vn, ea] = W(new Map);
    let ie = [], vt = null, je = !1, Nr = null;
    const Ve = new Map;
    te.addEventListener("timeupdate", ()=>Jw(te.currentTime));
    te.addEventListener("durationchange", ()=>Kw(te.duration || 0));
    te.addEventListener("ended", ()=>{
        Nr && En(Nr).then(()=>Qs(sa()));
    });
    function We() {
        Lw([
            ...ie
        ]);
    }
    const Jt = Wr, Vt = Hr, oi = Fw, Ww = te, ii = ()=>Hr()?.kind ?? "audio", si = Uw, Hw = qw, Gw = Vw, Yw = vn;
    function it(e, t) {
        const n = new Map(vn());
        t ? n.set(e, t) : n.delete(e), ea(n);
    }
    function kn() {
        const e = new Set(ie.map((r)=>r.blake3_hash));
        for (const r of Ve.keys())e.has(r) || Ve.delete(r);
        let t = !1;
        const n = new Map(vn());
        for (const r of n.keys())e.has(r) || (n.delete(r), t = !0);
        t && ea(n);
    }
    async function Qw(e, t) {
        const n = Ve.get(t.blake3_hash);
        if (n) return n;
        it(t.blake3_hash, "loading");
        try {
            const r = await Ys(e, t);
            return Ve.set(t.blake3_hash, r), it(t.blake3_hash, "ready"), r;
        } catch (r) {
            throw it(t.blake3_hash, void 0), r;
        }
    }
    let Un = !1;
    const Xw = 1800 * 1e3, e0 = 240 * 1e3;
    async function Gr(e) {
        if (!Un) {
            Un = !0;
            try {
                let t = 0;
                for (const n of ie.slice(1)){
                    if (t >= Xw) break;
                    if (t += n.duration_ms ?? e0, !Ve.has(n.blake3_hash) && vn().get(n.blake3_hash) !== "loading") try {
                        await Qw(e, n);
                    } catch  {}
                }
            } finally{
                Un = !1;
            }
        }
    }
    function ta() {
        vt && (URL.revokeObjectURL(vt), vt = null);
    }
    function na(e) {
        return e instanceof DOMException && e.name === "NotAllowedError";
    }
    async function Yr(e, t) {
        Nr = e, Xs(t), Pr(null);
        const n = Ve.get(t.blake3_hash);
        Ee("buffering"), qt(n || !t.size_bytes ? null : 0);
        try {
            const r = n ?? await (async ()=>{
                it(t.blake3_hash, "loading");
                const o = await Ys(e, t, (i)=>qt(i));
                return Ve.set(t.blake3_hash, o), o;
            })();
            it(t.blake3_hash, "ready"), ta(), vt = URL.createObjectURL(r), te.src = vt, qt(null), await te.play(), Ee("playing"), Gr(e);
        } catch (r) {
            if (qt(null), it(t.blake3_hash, void 0), na(r)) {
                Ee("blocked");
                return;
            }
            Ee("error"), Pr(r instanceof Error ? r.message : String(r));
        }
    }
    async function t0() {
        if (Wr() === "blocked") try {
            await te.play(), Ee("playing");
        } catch (e) {
            if (na(e)) return;
            Ee("error"), Pr(e instanceof Error ? e.message : String(e));
        }
    }
    async function n0(e, t) {
        ie = [
            t
        ], We(), await Yr(e, t);
    }
    async function r0(e, t) {
        ie = [
            ...t
        ], We(), kn();
        const n = ie[0];
        n && await Yr(e, n), Gr(e);
    }
    function o0(e, t) {
        ie.push(...t), We(), Gr(e);
    }
    function ra() {
        te.pause(), Ee("paused");
    }
    function oa() {
        te.play(), Ee("playing");
    }
    function i0(e) {
        te.currentTime = e / 1e3;
    }
    function s0(e) {
        te.volume = e;
    }
    function ia() {
        te.pause(), te.removeAttribute("src"), te.load(), ta(), Xs(null), Ee("stopped"), ie = [], We(), kn();
    }
    async function En(e) {
        ie.shift(), We(), kn();
        const t = ie[0];
        t ? await Yr(e, t) : ia();
    }
    async function a0(e, t) {
        if (!(t < 0 || t >= ie.length)) {
            if (t === 0) {
                await En(e);
                return;
            }
            ie.splice(t, 1), We(), kn();
        }
    }
    function c0(e, t) {
        if (e <= 0 || t <= 0 || e >= ie.length || t >= ie.length || e === t) return;
        const [n] = ie.splice(e, 1);
        n && (ie.splice(t, 0, n), We());
    }
    function u0(e) {
        je = e;
    }
    function sa() {
        const e = Hr(), t = [
            ...ie
        ], n = te.volume;
        switch(Wr()){
            case "playing":
                return e ? {
                    type: "status",
                    state: "now_playing",
                    item: e,
                    position_ms: Math.round(te.currentTime * 1e3),
                    server_time_ms: Date.now(),
                    queue: t,
                    auto_download_enabled: je,
                    volume: n
                } : {
                    type: "status",
                    state: "buffering",
                    queue: t,
                    auto_download_enabled: je,
                    volume: n
                };
            case "buffering":
                return {
                    type: "status",
                    state: "buffering",
                    queue: t,
                    auto_download_enabled: je,
                    volume: n
                };
            case "paused":
            case "blocked":
                return {
                    type: "status",
                    state: "paused",
                    position_ms: Math.round(te.currentTime * 1e3),
                    queue: t,
                    auto_download_enabled: je,
                    volume: n
                };
            case "error":
                return {
                    type: "status",
                    state: "error",
                    message: jw() ?? "unknown error",
                    queue: t,
                    auto_download_enabled: je,
                    volume: n
                };
            default:
                return {
                    type: "status",
                    state: "stopped",
                    queue: t,
                    auto_download_enabled: je,
                    volume: n
                };
        }
    }
    const _0 = typeof window < "u" && typeof window.MediaSource == "function", l0 = 'audio/mp4; codecs="mp4a.40.2"', [aa, bt] = W("idle"), [f0, Qr] = W(null), [d0, Xr] = W(null), [g0, eo] = W(null), [My, qn] = W(null), ai = aa, p0 = f0, h0 = d0, ci = g0, st = new Audio;
    st.preload = "auto";
    let xr = null, mt = null, Ue = null, to = [], kt = !1;
    function b0(e) {
        if (!e || typeof e != "object") return null;
        const t = e;
        return {
            title: typeof t.title == "string" ? t.title : "(untitled)",
            artist: typeof t.artist == "string" ? t.artist : null,
            album: typeof t.album == "string" ? t.album : null,
            duration_ms: typeof t.duration_ms == "number" ? t.duration_ms : null
        };
    }
    function ui(e) {
        const t = e;
        if (t?.now_playing) {
            const n = t.now_playing;
            typeof n.station_id == "string" && n.station_id.trim() && Xr(n.station_id.trim());
            const r = b0(t.now_playing);
            r && Qr(r);
        }
        typeof t?.listener_count == "number" && eo(t.listener_count);
    }
    function _i() {
        if (kt || !Ue || Ue.updating) return;
        const e = to.shift();
        if (e) {
            kt = !0;
            try {
                Ue.appendBuffer(e);
            } catch (t) {
                console.error("[radio] appendBuffer failed:", t), kt = !1;
            }
        }
    }
    async function m0(e, t, n) {
        if (ca(), !_0) {
            bt("unsupported"), qn("this browser has no MediaSource support - no fallback playback path yet");
            return;
        }
        bt("connecting"), qn(null), Qr(null), eo(null), Xr(n ?? null), mt = new MediaSource, st.src = URL.createObjectURL(mt), await new Promise((s)=>{
            mt.addEventListener("sourceopen", ()=>{
                Ue = mt.addSourceBuffer(l0), Ue.mode = "sequence", Ue.addEventListener("updateend", ()=>{
                    kt = !1, _i();
                }), s();
            }, {
                once: !0
            });
        });
        const r = (s)=>{
            try {
                ui(JSON.parse(s));
            } catch (a) {
                console.warn("[radio] hello parse failed:", a);
            }
        }, o = (s)=>{
            try {
                ui(JSON.parse(s));
            } catch (a) {
                console.warn("[radio] meta parse failed:", a);
            }
        }, i = (s, a, c)=>{
            to.push(c), aa() === "connecting" && bt("live"), _i();
        };
        try {
            xr = await e.tune_radio(t, n ?? null, r, o, i), st.play().catch((s)=>console.warn("[radio] autoplay failed:", s));
        } catch (s) {
            bt("error"), qn(s instanceof Error ? s.message : String(s));
        }
    }
    function ca() {
        xr?.leave(), xr = null, to = [], kt = !1, Ue = null, mt = null, st.pause(), st.removeAttribute("src"), st.load(), bt("idle"), Qr(null), Xr(null), eo(null);
    }
    async function w0(e, t) {
        const n = Rw.safeParse(JSON.parse(t));
        if (!n.success) return {
            type: "command_ack",
            ok: !1,
            reason: "invalid_command"
        };
        const r = n.data;
        switch(r.command){
            case "play":
                await n0(e, r.item);
                break;
            case "replace_queue":
                await r0(e, r.items);
                break;
            case "append_queue":
                o0(e, r.items);
                break;
            case "pause":
                ra();
                break;
            case "resume":
                oa();
                break;
            case "seek":
                i0(r.position_ms);
                break;
            case "skip":
                await En(e);
                break;
            case "remove_from_queue":
                await a0(e, r.index);
                break;
            case "reorder_queue":
                c0(r.from_index, r.to_index);
                break;
            case "set_volume":
                s0(r.volume);
                break;
            case "stop":
                ia();
                break;
            case "tune_radio":
                await m0(e, r.peer_addr, r.station_id);
                break;
            case "stop_radio":
                ca();
                break;
            case "set_auto_download_enabled":
                u0(r.enabled);
                break;
        }
        const o = sa();
        return Qs(o), {
            type: "command_ack",
            ok: !0,
            status: o
        };
    }
    const y0 = "freqhole_player_settings", v0 = 1, ln = "settings", ua = "display_name", _a = "freqhole player";
    let Jn = null;
    function la() {
        return Jn || (Jn = cs(y0, v0, {
            upgrade (e) {
                e.objectStoreNames.contains(ln) || e.createObjectStore(ln);
            }
        })), Jn;
    }
    const [k0, fa] = W(_a), no = k0;
    async function E0() {
        const t = await (await la()).get(ln, ua);
        typeof t == "string" && t.trim() && fa(t);
    }
    async function S0(e) {
        const t = e.trim() || _a;
        await (await la()).put(ln, t, ua), fa(t);
    }
    function $0(e) {
        return !!e && typeof e == "object" && e.type === "api_request";
    }
    async function li(e, t, n, r) {
        const o = {
            type: "api_response",
            id: t,
            status: n,
            body: JSON.stringify(r)
        };
        await e.write_raw_and_finish(new TextEncoder().encode(JSON.stringify(o)));
    }
    async function A0(e) {
        try {
            const t = await e.read_to_end(65536);
            if (t === null) return;
            const n = JSON.parse(new TextDecoder().decode(t));
            if (!$0(n)) return;
            if (n.method === "GET" && n.path === "/api/hello") {
                await li(e, n.id, 200, {
                    name: no(),
                    description: "freqhole player device",
                    version: "0.0.1",
                    image_url: null,
                    image_blob_id: null,
                    knocking_enabled: !1,
                    player_device: !0
                });
                return;
            }
            await li(e, n.id, 404, {
                error: "not found"
            });
        } catch (t) {
            console.error("[player] api request handling failed:", t);
        } finally{
            e.close();
        }
    }
    const z0 = 6e4, [I0, da] = W([]), fi = I0, Et = new Map;
    function di(e) {
        const t = Et.get(e.node_id);
        t && (clearTimeout(t), Et.delete(e.node_id)), da((n)=>n.some((r)=>r.node_id === e.node_id) ? n : [
                ...n,
                e
            ]);
    }
    function gi(e) {
        const t = Et.get(e);
        t && clearTimeout(t);
        const n = setTimeout(()=>{
            Et.delete(e), da((r)=>r.filter((o)=>o.node_id !== e));
        }, z0);
        Et.set(e, n);
    }
    let pi = !1;
    function O0(e) {
        pi || (pi = !0, (async ()=>{
            for(;;){
                const t = await e.accept();
                if (t === null) break;
                t.alpn() === is ? C0(e, t) : t.alpn() === qd ? A0(t) : (console.log("[player] ignoring connection on unhandled alpn", t.alpn()), t.close());
            }
        })());
    }
    async function C0(e, t) {
        try {
            const n = t.peer_node_id();
            if (await pg(n)) {
                const s = await t.read_line();
                if (s === null) return;
                const a = await hg(n), c = {
                    node_id: n,
                    display_name: a?.display_name ?? n.slice(0, 8)
                };
                if (T0(s)) {
                    Zw(n, t), di(c);
                    try {
                        for(; await t.read_line() !== null;);
                    } finally{
                        Bw(n, t), gi(n);
                    }
                    return;
                }
                di(c);
                try {
                    let u = s;
                    for(; u !== null;){
                        const _ = await w0(e, u);
                        await t.write_line(JSON.stringify(_)), u = await t.read_line();
                    }
                } finally{
                    gi(n);
                }
                return;
            }
            const o = await t.read_line();
            if (o === null) return;
            const i = await xw(n, o);
            await t.write_line(JSON.stringify(i)), await t.read_line();
        } catch (n) {
            console.error("[player] connection handling failed:", n);
        } finally{
            t.close();
        }
    }
    function T0(e) {
        try {
            return Dw.safeParse(JSON.parse(e)).success;
        } catch  {
            return !1;
        }
    }
    function P0(e) {
        return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
    }
    var et = {}, Vn, hi;
    function N0() {
        return hi || (hi = 1, Vn = function() {
            return typeof Promise == "function" && Promise.prototype && Promise.prototype.then;
        }), Vn;
    }
    var Kn = {}, ze = {}, bi;
    function He() {
        if (bi) return ze;
        bi = 1;
        let e;
        const t = [
            0,
            26,
            44,
            70,
            100,
            134,
            172,
            196,
            242,
            292,
            346,
            404,
            466,
            532,
            581,
            655,
            733,
            815,
            901,
            991,
            1085,
            1156,
            1258,
            1364,
            1474,
            1588,
            1706,
            1828,
            1921,
            2051,
            2185,
            2323,
            2465,
            2611,
            2761,
            2876,
            3034,
            3196,
            3362,
            3532,
            3706
        ];
        return ze.getSymbolSize = function(r) {
            if (!r) throw new Error('"version" cannot be null or undefined');
            if (r < 1 || r > 40) throw new Error('"version" should be in range from 1 to 40');
            return r * 4 + 17;
        }, ze.getSymbolTotalCodewords = function(r) {
            return t[r];
        }, ze.getBCHDigit = function(n) {
            let r = 0;
            for(; n !== 0;)r++, n >>>= 1;
            return r;
        }, ze.setToSJISFunction = function(r) {
            if (typeof r != "function") throw new Error('"toSJISFunc" is not a valid function.');
            e = r;
        }, ze.isKanjiModeEnabled = function() {
            return typeof e < "u";
        }, ze.toSJIS = function(r) {
            return e(r);
        }, ze;
    }
    var Wn = {}, mi;
    function ro() {
        return mi || (mi = 1, (function(e) {
            e.L = {
                bit: 1
            }, e.M = {
                bit: 0
            }, e.Q = {
                bit: 3
            }, e.H = {
                bit: 2
            };
            function t(n) {
                if (typeof n != "string") throw new Error("Param is not a string");
                switch(n.toLowerCase()){
                    case "l":
                    case "low":
                        return e.L;
                    case "m":
                    case "medium":
                        return e.M;
                    case "q":
                    case "quartile":
                        return e.Q;
                    case "h":
                    case "high":
                        return e.H;
                    default:
                        throw new Error("Unknown EC Level: " + n);
                }
            }
            e.isValid = function(r) {
                return r && typeof r.bit < "u" && r.bit >= 0 && r.bit < 4;
            }, e.from = function(r, o) {
                if (e.isValid(r)) return r;
                try {
                    return t(r);
                } catch  {
                    return o;
                }
            };
        })(Wn)), Wn;
    }
    var Hn, wi;
    function x0() {
        if (wi) return Hn;
        wi = 1;
        function e() {
            this.buffer = [], this.length = 0;
        }
        return e.prototype = {
            get: function(t) {
                const n = Math.floor(t / 8);
                return (this.buffer[n] >>> 7 - t % 8 & 1) === 1;
            },
            put: function(t, n) {
                for(let r = 0; r < n; r++)this.putBit((t >>> n - r - 1 & 1) === 1);
            },
            getLengthInBits: function() {
                return this.length;
            },
            putBit: function(t) {
                const n = Math.floor(this.length / 8);
                this.buffer.length <= n && this.buffer.push(0), t && (this.buffer[n] |= 128 >>> this.length % 8), this.length++;
            }
        }, Hn = e, Hn;
    }
    var Gn, yi;
    function R0() {
        if (yi) return Gn;
        yi = 1;
        function e(t) {
            if (!t || t < 1) throw new Error("BitMatrix size must be defined and greater than 0");
            this.size = t, this.data = new Uint8Array(t * t), this.reservedBit = new Uint8Array(t * t);
        }
        return e.prototype.set = function(t, n, r, o) {
            const i = t * this.size + n;
            this.data[i] = r, o && (this.reservedBit[i] = !0);
        }, e.prototype.get = function(t, n) {
            return this.data[t * this.size + n];
        }, e.prototype.xor = function(t, n, r) {
            this.data[t * this.size + n] ^= r;
        }, e.prototype.isReserved = function(t, n) {
            return this.reservedBit[t * this.size + n];
        }, Gn = e, Gn;
    }
    var Yn = {}, vi;
    function D0() {
        return vi || (vi = 1, (function(e) {
            const t = He().getSymbolSize;
            e.getRowColCoords = function(r) {
                if (r === 1) return [];
                const o = Math.floor(r / 7) + 2, i = t(r), s = i === 145 ? 26 : Math.ceil((i - 13) / (2 * o - 2)) * 2, a = [
                    i - 7
                ];
                for(let c = 1; c < o - 1; c++)a[c] = a[c - 1] - s;
                return a.push(6), a.reverse();
            }, e.getPositions = function(r) {
                const o = [], i = e.getRowColCoords(r), s = i.length;
                for(let a = 0; a < s; a++)for(let c = 0; c < s; c++)a === 0 && c === 0 || a === 0 && c === s - 1 || a === s - 1 && c === 0 || o.push([
                    i[a],
                    i[c]
                ]);
                return o;
            };
        })(Yn)), Yn;
    }
    var Qn = {}, ki;
    function M0() {
        if (ki) return Qn;
        ki = 1;
        const e = He().getSymbolSize, t = 7;
        return Qn.getPositions = function(r) {
            const o = e(r);
            return [
                [
                    0,
                    0
                ],
                [
                    o - t,
                    0
                ],
                [
                    0,
                    o - t
                ]
            ];
        }, Qn;
    }
    var Xn = {}, Ei;
    function Z0() {
        return Ei || (Ei = 1, (function(e) {
            e.Patterns = {
                PATTERN000: 0,
                PATTERN001: 1,
                PATTERN010: 2,
                PATTERN011: 3,
                PATTERN100: 4,
                PATTERN101: 5,
                PATTERN110: 6,
                PATTERN111: 7
            };
            const t = {
                N1: 3,
                N2: 3,
                N3: 40,
                N4: 10
            };
            e.isValid = function(o) {
                return o != null && o !== "" && !isNaN(o) && o >= 0 && o <= 7;
            }, e.from = function(o) {
                return e.isValid(o) ? parseInt(o, 10) : void 0;
            }, e.getPenaltyN1 = function(o) {
                const i = o.size;
                let s = 0, a = 0, c = 0, u = null, _ = null;
                for(let f = 0; f < i; f++){
                    a = c = 0, u = _ = null;
                    for(let d = 0; d < i; d++){
                        let g = o.get(f, d);
                        g === u ? a++ : (a >= 5 && (s += t.N1 + (a - 5)), u = g, a = 1), g = o.get(d, f), g === _ ? c++ : (c >= 5 && (s += t.N1 + (c - 5)), _ = g, c = 1);
                    }
                    a >= 5 && (s += t.N1 + (a - 5)), c >= 5 && (s += t.N1 + (c - 5));
                }
                return s;
            }, e.getPenaltyN2 = function(o) {
                const i = o.size;
                let s = 0;
                for(let a = 0; a < i - 1; a++)for(let c = 0; c < i - 1; c++){
                    const u = o.get(a, c) + o.get(a, c + 1) + o.get(a + 1, c) + o.get(a + 1, c + 1);
                    (u === 4 || u === 0) && s++;
                }
                return s * t.N2;
            }, e.getPenaltyN3 = function(o) {
                const i = o.size;
                let s = 0, a = 0, c = 0;
                for(let u = 0; u < i; u++){
                    a = c = 0;
                    for(let _ = 0; _ < i; _++)a = a << 1 & 2047 | o.get(u, _), _ >= 10 && (a === 1488 || a === 93) && s++, c = c << 1 & 2047 | o.get(_, u), _ >= 10 && (c === 1488 || c === 93) && s++;
                }
                return s * t.N3;
            }, e.getPenaltyN4 = function(o) {
                let i = 0;
                const s = o.data.length;
                for(let c = 0; c < s; c++)i += o.data[c];
                return Math.abs(Math.ceil(i * 100 / s / 5) - 10) * t.N4;
            };
            function n(r, o, i) {
                switch(r){
                    case e.Patterns.PATTERN000:
                        return (o + i) % 2 === 0;
                    case e.Patterns.PATTERN001:
                        return o % 2 === 0;
                    case e.Patterns.PATTERN010:
                        return i % 3 === 0;
                    case e.Patterns.PATTERN011:
                        return (o + i) % 3 === 0;
                    case e.Patterns.PATTERN100:
                        return (Math.floor(o / 2) + Math.floor(i / 3)) % 2 === 0;
                    case e.Patterns.PATTERN101:
                        return o * i % 2 + o * i % 3 === 0;
                    case e.Patterns.PATTERN110:
                        return (o * i % 2 + o * i % 3) % 2 === 0;
                    case e.Patterns.PATTERN111:
                        return (o * i % 3 + (o + i) % 2) % 2 === 0;
                    default:
                        throw new Error("bad maskPattern:" + r);
                }
            }
            e.applyMask = function(o, i) {
                const s = i.size;
                for(let a = 0; a < s; a++)for(let c = 0; c < s; c++)i.isReserved(c, a) || i.xor(c, a, n(o, c, a));
            }, e.getBestMask = function(o, i) {
                const s = Object.keys(e.Patterns).length;
                let a = 0, c = 1 / 0;
                for(let u = 0; u < s; u++){
                    i(u), e.applyMask(u, o);
                    const _ = e.getPenaltyN1(o) + e.getPenaltyN2(o) + e.getPenaltyN3(o) + e.getPenaltyN4(o);
                    e.applyMask(u, o), _ < c && (c = _, a = u);
                }
                return a;
            };
        })(Xn)), Xn;
    }
    var Kt = {}, Si;
    function ga() {
        if (Si) return Kt;
        Si = 1;
        const e = ro(), t = [
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            2,
            2,
            1,
            2,
            2,
            4,
            1,
            2,
            4,
            4,
            2,
            4,
            4,
            4,
            2,
            4,
            6,
            5,
            2,
            4,
            6,
            6,
            2,
            5,
            8,
            8,
            4,
            5,
            8,
            8,
            4,
            5,
            8,
            11,
            4,
            8,
            10,
            11,
            4,
            9,
            12,
            16,
            4,
            9,
            16,
            16,
            6,
            10,
            12,
            18,
            6,
            10,
            17,
            16,
            6,
            11,
            16,
            19,
            6,
            13,
            18,
            21,
            7,
            14,
            21,
            25,
            8,
            16,
            20,
            25,
            8,
            17,
            23,
            25,
            9,
            17,
            23,
            34,
            9,
            18,
            25,
            30,
            10,
            20,
            27,
            32,
            12,
            21,
            29,
            35,
            12,
            23,
            34,
            37,
            12,
            25,
            34,
            40,
            13,
            26,
            35,
            42,
            14,
            28,
            38,
            45,
            15,
            29,
            40,
            48,
            16,
            31,
            43,
            51,
            17,
            33,
            45,
            54,
            18,
            35,
            48,
            57,
            19,
            37,
            51,
            60,
            19,
            38,
            53,
            63,
            20,
            40,
            56,
            66,
            21,
            43,
            59,
            70,
            22,
            45,
            62,
            74,
            24,
            47,
            65,
            77,
            25,
            49,
            68,
            81
        ], n = [
            7,
            10,
            13,
            17,
            10,
            16,
            22,
            28,
            15,
            26,
            36,
            44,
            20,
            36,
            52,
            64,
            26,
            48,
            72,
            88,
            36,
            64,
            96,
            112,
            40,
            72,
            108,
            130,
            48,
            88,
            132,
            156,
            60,
            110,
            160,
            192,
            72,
            130,
            192,
            224,
            80,
            150,
            224,
            264,
            96,
            176,
            260,
            308,
            104,
            198,
            288,
            352,
            120,
            216,
            320,
            384,
            132,
            240,
            360,
            432,
            144,
            280,
            408,
            480,
            168,
            308,
            448,
            532,
            180,
            338,
            504,
            588,
            196,
            364,
            546,
            650,
            224,
            416,
            600,
            700,
            224,
            442,
            644,
            750,
            252,
            476,
            690,
            816,
            270,
            504,
            750,
            900,
            300,
            560,
            810,
            960,
            312,
            588,
            870,
            1050,
            336,
            644,
            952,
            1110,
            360,
            700,
            1020,
            1200,
            390,
            728,
            1050,
            1260,
            420,
            784,
            1140,
            1350,
            450,
            812,
            1200,
            1440,
            480,
            868,
            1290,
            1530,
            510,
            924,
            1350,
            1620,
            540,
            980,
            1440,
            1710,
            570,
            1036,
            1530,
            1800,
            570,
            1064,
            1590,
            1890,
            600,
            1120,
            1680,
            1980,
            630,
            1204,
            1770,
            2100,
            660,
            1260,
            1860,
            2220,
            720,
            1316,
            1950,
            2310,
            750,
            1372,
            2040,
            2430
        ];
        return Kt.getBlocksCount = function(o, i) {
            switch(i){
                case e.L:
                    return t[(o - 1) * 4 + 0];
                case e.M:
                    return t[(o - 1) * 4 + 1];
                case e.Q:
                    return t[(o - 1) * 4 + 2];
                case e.H:
                    return t[(o - 1) * 4 + 3];
                default:
                    return;
            }
        }, Kt.getTotalCodewordsCount = function(o, i) {
            switch(i){
                case e.L:
                    return n[(o - 1) * 4 + 0];
                case e.M:
                    return n[(o - 1) * 4 + 1];
                case e.Q:
                    return n[(o - 1) * 4 + 2];
                case e.H:
                    return n[(o - 1) * 4 + 3];
                default:
                    return;
            }
        }, Kt;
    }
    var er = {}, pt = {}, $i;
    function B0() {
        if ($i) return pt;
        $i = 1;
        const e = new Uint8Array(512), t = new Uint8Array(256);
        return (function() {
            let r = 1;
            for(let o = 0; o < 255; o++)e[o] = r, t[r] = o, r <<= 1, r & 256 && (r ^= 285);
            for(let o = 255; o < 512; o++)e[o] = e[o - 255];
        })(), pt.log = function(r) {
            if (r < 1) throw new Error("log(" + r + ")");
            return t[r];
        }, pt.exp = function(r) {
            return e[r];
        }, pt.mul = function(r, o) {
            return r === 0 || o === 0 ? 0 : e[t[r] + t[o]];
        }, pt;
    }
    var Ai;
    function j0() {
        return Ai || (Ai = 1, (function(e) {
            const t = B0();
            e.mul = function(r, o) {
                const i = new Uint8Array(r.length + o.length - 1);
                for(let s = 0; s < r.length; s++)for(let a = 0; a < o.length; a++)i[s + a] ^= t.mul(r[s], o[a]);
                return i;
            }, e.mod = function(r, o) {
                let i = new Uint8Array(r);
                for(; i.length - o.length >= 0;){
                    const s = i[0];
                    for(let c = 0; c < o.length; c++)i[c] ^= t.mul(o[c], s);
                    let a = 0;
                    for(; a < i.length && i[a] === 0;)a++;
                    i = i.slice(a);
                }
                return i;
            }, e.generateECPolynomial = function(r) {
                let o = new Uint8Array([
                    1
                ]);
                for(let i = 0; i < r; i++)o = e.mul(o, new Uint8Array([
                    1,
                    t.exp(i)
                ]));
                return o;
            };
        })(er)), er;
    }
    var tr, zi;
    function F0() {
        if (zi) return tr;
        zi = 1;
        const e = j0();
        function t(n) {
            this.genPoly = void 0, this.degree = n, this.degree && this.initialize(this.degree);
        }
        return t.prototype.initialize = function(r) {
            this.degree = r, this.genPoly = e.generateECPolynomial(this.degree);
        }, t.prototype.encode = function(r) {
            if (!this.genPoly) throw new Error("Encoder not initialized");
            const o = new Uint8Array(r.length + this.degree);
            o.set(r);
            const i = e.mod(o, this.genPoly), s = this.degree - i.length;
            if (s > 0) {
                const a = new Uint8Array(this.degree);
                return a.set(i, s), a;
            }
            return i;
        }, tr = t, tr;
    }
    var nr = {}, rr = {}, or = {}, Ii;
    function pa() {
        return Ii || (Ii = 1, or.isValid = function(t) {
            return !isNaN(t) && t >= 1 && t <= 40;
        }), or;
    }
    var he = {}, Oi;
    function ha() {
        if (Oi) return he;
        Oi = 1;
        const e = "[0-9]+", t = "[A-Z $%*+\\-./:]+";
        let n = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
        n = n.replace(/u/g, "\\u");
        const r = "(?:(?![A-Z0-9 $%*+\\-./:]|" + n + `)(?:.|[\r
]))+`;
        he.KANJI = new RegExp(n, "g"), he.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g"), he.BYTE = new RegExp(r, "g"), he.NUMERIC = new RegExp(e, "g"), he.ALPHANUMERIC = new RegExp(t, "g");
        const o = new RegExp("^" + n + "$"), i = new RegExp("^" + e + "$"), s = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
        return he.testKanji = function(c) {
            return o.test(c);
        }, he.testNumeric = function(c) {
            return i.test(c);
        }, he.testAlphanumeric = function(c) {
            return s.test(c);
        }, he;
    }
    var Ci;
    function Ge() {
        return Ci || (Ci = 1, (function(e) {
            const t = pa(), n = ha();
            e.NUMERIC = {
                id: "Numeric",
                bit: 1,
                ccBits: [
                    10,
                    12,
                    14
                ]
            }, e.ALPHANUMERIC = {
                id: "Alphanumeric",
                bit: 2,
                ccBits: [
                    9,
                    11,
                    13
                ]
            }, e.BYTE = {
                id: "Byte",
                bit: 4,
                ccBits: [
                    8,
                    16,
                    16
                ]
            }, e.KANJI = {
                id: "Kanji",
                bit: 8,
                ccBits: [
                    8,
                    10,
                    12
                ]
            }, e.MIXED = {
                bit: -1
            }, e.getCharCountIndicator = function(i, s) {
                if (!i.ccBits) throw new Error("Invalid mode: " + i);
                if (!t.isValid(s)) throw new Error("Invalid version: " + s);
                return s >= 1 && s < 10 ? i.ccBits[0] : s < 27 ? i.ccBits[1] : i.ccBits[2];
            }, e.getBestModeForData = function(i) {
                return n.testNumeric(i) ? e.NUMERIC : n.testAlphanumeric(i) ? e.ALPHANUMERIC : n.testKanji(i) ? e.KANJI : e.BYTE;
            }, e.toString = function(i) {
                if (i && i.id) return i.id;
                throw new Error("Invalid mode");
            }, e.isValid = function(i) {
                return i && i.bit && i.ccBits;
            };
            function r(o) {
                if (typeof o != "string") throw new Error("Param is not a string");
                switch(o.toLowerCase()){
                    case "numeric":
                        return e.NUMERIC;
                    case "alphanumeric":
                        return e.ALPHANUMERIC;
                    case "kanji":
                        return e.KANJI;
                    case "byte":
                        return e.BYTE;
                    default:
                        throw new Error("Unknown mode: " + o);
                }
            }
            e.from = function(i, s) {
                if (e.isValid(i)) return i;
                try {
                    return r(i);
                } catch  {
                    return s;
                }
            };
        })(rr)), rr;
    }
    var Ti;
    function L0() {
        return Ti || (Ti = 1, (function(e) {
            const t = He(), n = ga(), r = ro(), o = Ge(), i = pa(), s = 7973, a = t.getBCHDigit(s);
            function c(d, g, b) {
                for(let y = 1; y <= 40; y++)if (g <= e.getCapacity(y, b, d)) return y;
            }
            function u(d, g) {
                return o.getCharCountIndicator(d, g) + 4;
            }
            function _(d, g) {
                let b = 0;
                return d.forEach(function(y) {
                    const z = u(y.mode, g);
                    b += z + y.getBitsLength();
                }), b;
            }
            function f(d, g) {
                for(let b = 1; b <= 40; b++)if (_(d, b) <= e.getCapacity(b, g, o.MIXED)) return b;
            }
            e.from = function(g, b) {
                return i.isValid(g) ? parseInt(g, 10) : b;
            }, e.getCapacity = function(g, b, y) {
                if (!i.isValid(g)) throw new Error("Invalid QR Code version");
                typeof y > "u" && (y = o.BYTE);
                const z = t.getSymbolTotalCodewords(g), k = n.getTotalCodewordsCount(g, b), O = (z - k) * 8;
                if (y === o.MIXED) return O;
                const I = O - u(y, g);
                switch(y){
                    case o.NUMERIC:
                        return Math.floor(I / 10 * 3);
                    case o.ALPHANUMERIC:
                        return Math.floor(I / 11 * 2);
                    case o.KANJI:
                        return Math.floor(I / 13);
                    case o.BYTE:
                    default:
                        return Math.floor(I / 8);
                }
            }, e.getBestVersionForData = function(g, b) {
                let y;
                const z = r.from(b, r.M);
                if (Array.isArray(g)) {
                    if (g.length > 1) return f(g, z);
                    if (g.length === 0) return 1;
                    y = g[0];
                } else y = g;
                return c(y.mode, y.getLength(), z);
            }, e.getEncodedBits = function(g) {
                if (!i.isValid(g) || g < 7) throw new Error("Invalid QR Code version");
                let b = g << 12;
                for(; t.getBCHDigit(b) - a >= 0;)b ^= s << t.getBCHDigit(b) - a;
                return g << 12 | b;
            };
        })(nr)), nr;
    }
    var ir = {}, Pi;
    function U0() {
        if (Pi) return ir;
        Pi = 1;
        const e = He(), t = 1335, n = 21522, r = e.getBCHDigit(t);
        return ir.getEncodedBits = function(i, s) {
            const a = i.bit << 3 | s;
            let c = a << 10;
            for(; e.getBCHDigit(c) - r >= 0;)c ^= t << e.getBCHDigit(c) - r;
            return (a << 10 | c) ^ n;
        }, ir;
    }
    var sr = {}, ar, Ni;
    function q0() {
        if (Ni) return ar;
        Ni = 1;
        const e = Ge();
        function t(n) {
            this.mode = e.NUMERIC, this.data = n.toString();
        }
        return t.getBitsLength = function(r) {
            return 10 * Math.floor(r / 3) + (r % 3 ? r % 3 * 3 + 1 : 0);
        }, t.prototype.getLength = function() {
            return this.data.length;
        }, t.prototype.getBitsLength = function() {
            return t.getBitsLength(this.data.length);
        }, t.prototype.write = function(r) {
            let o, i, s;
            for(o = 0; o + 3 <= this.data.length; o += 3)i = this.data.substr(o, 3), s = parseInt(i, 10), r.put(s, 10);
            const a = this.data.length - o;
            a > 0 && (i = this.data.substr(o), s = parseInt(i, 10), r.put(s, a * 3 + 1));
        }, ar = t, ar;
    }
    var cr, xi;
    function J0() {
        if (xi) return cr;
        xi = 1;
        const e = Ge(), t = [
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "A",
            "B",
            "C",
            "D",
            "E",
            "F",
            "G",
            "H",
            "I",
            "J",
            "K",
            "L",
            "M",
            "N",
            "O",
            "P",
            "Q",
            "R",
            "S",
            "T",
            "U",
            "V",
            "W",
            "X",
            "Y",
            "Z",
            " ",
            "$",
            "%",
            "*",
            "+",
            "-",
            ".",
            "/",
            ":"
        ];
        function n(r) {
            this.mode = e.ALPHANUMERIC, this.data = r;
        }
        return n.getBitsLength = function(o) {
            return 11 * Math.floor(o / 2) + 6 * (o % 2);
        }, n.prototype.getLength = function() {
            return this.data.length;
        }, n.prototype.getBitsLength = function() {
            return n.getBitsLength(this.data.length);
        }, n.prototype.write = function(o) {
            let i;
            for(i = 0; i + 2 <= this.data.length; i += 2){
                let s = t.indexOf(this.data[i]) * 45;
                s += t.indexOf(this.data[i + 1]), o.put(s, 11);
            }
            this.data.length % 2 && o.put(t.indexOf(this.data[i]), 6);
        }, cr = n, cr;
    }
    var ur, Ri;
    function V0() {
        if (Ri) return ur;
        Ri = 1;
        const e = Ge();
        function t(n) {
            this.mode = e.BYTE, typeof n == "string" ? this.data = new TextEncoder().encode(n) : this.data = new Uint8Array(n);
        }
        return t.getBitsLength = function(r) {
            return r * 8;
        }, t.prototype.getLength = function() {
            return this.data.length;
        }, t.prototype.getBitsLength = function() {
            return t.getBitsLength(this.data.length);
        }, t.prototype.write = function(n) {
            for(let r = 0, o = this.data.length; r < o; r++)n.put(this.data[r], 8);
        }, ur = t, ur;
    }
    var _r, Di;
    function K0() {
        if (Di) return _r;
        Di = 1;
        const e = Ge(), t = He();
        function n(r) {
            this.mode = e.KANJI, this.data = r;
        }
        return n.getBitsLength = function(o) {
            return o * 13;
        }, n.prototype.getLength = function() {
            return this.data.length;
        }, n.prototype.getBitsLength = function() {
            return n.getBitsLength(this.data.length);
        }, n.prototype.write = function(r) {
            let o;
            for(o = 0; o < this.data.length; o++){
                let i = t.toSJIS(this.data[o]);
                if (i >= 33088 && i <= 40956) i -= 33088;
                else if (i >= 57408 && i <= 60351) i -= 49472;
                else throw new Error("Invalid SJIS character: " + this.data[o] + `
Make sure your charset is UTF-8`);
                i = (i >>> 8 & 255) * 192 + (i & 255), r.put(i, 13);
            }
        }, _r = n, _r;
    }
    var lr = {
        exports: {}
    }, Mi;
    function W0() {
        return Mi || (Mi = 1, (function(e) {
            var t = {
                single_source_shortest_paths: function(n, r, o) {
                    var i = {}, s = {};
                    s[r] = 0;
                    var a = t.PriorityQueue.make();
                    a.push(r, 0);
                    for(var c, u, _, f, d, g, b, y, z; !a.empty();){
                        c = a.pop(), u = c.value, f = c.cost, d = n[u] || {};
                        for(_ in d)d.hasOwnProperty(_) && (g = d[_], b = f + g, y = s[_], z = typeof s[_] > "u", (z || y > b) && (s[_] = b, a.push(_, b), i[_] = u));
                    }
                    if (typeof o < "u" && typeof s[o] > "u") {
                        var k = [
                            "Could not find a path from ",
                            r,
                            " to ",
                            o,
                            "."
                        ].join("");
                        throw new Error(k);
                    }
                    return i;
                },
                extract_shortest_path_from_predecessor_list: function(n, r) {
                    for(var o = [], i = r; i;)o.push(i), n[i], i = n[i];
                    return o.reverse(), o;
                },
                find_path: function(n, r, o) {
                    var i = t.single_source_shortest_paths(n, r, o);
                    return t.extract_shortest_path_from_predecessor_list(i, o);
                },
                PriorityQueue: {
                    make: function(n) {
                        var r = t.PriorityQueue, o = {}, i;
                        n = n || {};
                        for(i in r)r.hasOwnProperty(i) && (o[i] = r[i]);
                        return o.queue = [], o.sorter = n.sorter || r.default_sorter, o;
                    },
                    default_sorter: function(n, r) {
                        return n.cost - r.cost;
                    },
                    push: function(n, r) {
                        var o = {
                            value: n,
                            cost: r
                        };
                        this.queue.push(o), this.queue.sort(this.sorter);
                    },
                    pop: function() {
                        return this.queue.shift();
                    },
                    empty: function() {
                        return this.queue.length === 0;
                    }
                }
            };
            e.exports = t;
        })(lr)), lr.exports;
    }
    var Zi;
    function H0() {
        return Zi || (Zi = 1, (function(e) {
            const t = Ge(), n = q0(), r = J0(), o = V0(), i = K0(), s = ha(), a = He(), c = W0();
            function u(k) {
                return unescape(encodeURIComponent(k)).length;
            }
            function _(k, O, I) {
                const S = [];
                let M;
                for(; (M = k.exec(I)) !== null;)S.push({
                    data: M[0],
                    index: M.index,
                    mode: O,
                    length: M[0].length
                });
                return S;
            }
            function f(k) {
                const O = _(s.NUMERIC, t.NUMERIC, k), I = _(s.ALPHANUMERIC, t.ALPHANUMERIC, k);
                let S, M;
                return a.isKanjiModeEnabled() ? (S = _(s.BYTE, t.BYTE, k), M = _(s.KANJI, t.KANJI, k)) : (S = _(s.BYTE_KANJI, t.BYTE, k), M = []), O.concat(I, S, M).sort(function(A, N) {
                    return A.index - N.index;
                }).map(function(A) {
                    return {
                        data: A.data,
                        mode: A.mode,
                        length: A.length
                    };
                });
            }
            function d(k, O) {
                switch(O){
                    case t.NUMERIC:
                        return n.getBitsLength(k);
                    case t.ALPHANUMERIC:
                        return r.getBitsLength(k);
                    case t.KANJI:
                        return i.getBitsLength(k);
                    case t.BYTE:
                        return o.getBitsLength(k);
                }
            }
            function g(k) {
                return k.reduce(function(O, I) {
                    const S = O.length - 1 >= 0 ? O[O.length - 1] : null;
                    return S && S.mode === I.mode ? (O[O.length - 1].data += I.data, O) : (O.push(I), O);
                }, []);
            }
            function b(k) {
                const O = [];
                for(let I = 0; I < k.length; I++){
                    const S = k[I];
                    switch(S.mode){
                        case t.NUMERIC:
                            O.push([
                                S,
                                {
                                    data: S.data,
                                    mode: t.ALPHANUMERIC,
                                    length: S.length
                                },
                                {
                                    data: S.data,
                                    mode: t.BYTE,
                                    length: S.length
                                }
                            ]);
                            break;
                        case t.ALPHANUMERIC:
                            O.push([
                                S,
                                {
                                    data: S.data,
                                    mode: t.BYTE,
                                    length: S.length
                                }
                            ]);
                            break;
                        case t.KANJI:
                            O.push([
                                S,
                                {
                                    data: S.data,
                                    mode: t.BYTE,
                                    length: u(S.data)
                                }
                            ]);
                            break;
                        case t.BYTE:
                            O.push([
                                {
                                    data: S.data,
                                    mode: t.BYTE,
                                    length: u(S.data)
                                }
                            ]);
                    }
                }
                return O;
            }
            function y(k, O) {
                const I = {}, S = {
                    start: {}
                };
                let M = [
                    "start"
                ];
                for(let w = 0; w < k.length; w++){
                    const A = k[w], N = [];
                    for(let v = 0; v < A.length; v++){
                        const E = A[v], C = "" + w + v;
                        N.push(C), I[C] = {
                            node: E,
                            lastCount: 0
                        }, S[C] = {};
                        for(let $ = 0; $ < M.length; $++){
                            const P = M[$];
                            I[P] && I[P].node.mode === E.mode ? (S[P][C] = d(I[P].lastCount + E.length, E.mode) - d(I[P].lastCount, E.mode), I[P].lastCount += E.length) : (I[P] && (I[P].lastCount = E.length), S[P][C] = d(E.length, E.mode) + 4 + t.getCharCountIndicator(E.mode, O));
                        }
                    }
                    M = N;
                }
                for(let w = 0; w < M.length; w++)S[M[w]].end = 0;
                return {
                    map: S,
                    table: I
                };
            }
            function z(k, O) {
                let I;
                const S = t.getBestModeForData(k);
                if (I = t.from(O, S), I !== t.BYTE && I.bit < S.bit) throw new Error('"' + k + '" cannot be encoded with mode ' + t.toString(I) + `.
 Suggested mode is: ` + t.toString(S));
                switch(I === t.KANJI && !a.isKanjiModeEnabled() && (I = t.BYTE), I){
                    case t.NUMERIC:
                        return new n(k);
                    case t.ALPHANUMERIC:
                        return new r(k);
                    case t.KANJI:
                        return new i(k);
                    case t.BYTE:
                        return new o(k);
                }
            }
            e.fromArray = function(O) {
                return O.reduce(function(I, S) {
                    return typeof S == "string" ? I.push(z(S, null)) : S.data && I.push(z(S.data, S.mode)), I;
                }, []);
            }, e.fromString = function(O, I) {
                const S = f(O, a.isKanjiModeEnabled()), M = b(S), w = y(M, I), A = c.find_path(w.map, "start", "end"), N = [];
                for(let v = 1; v < A.length - 1; v++)N.push(w.table[A[v]].node);
                return e.fromArray(g(N));
            }, e.rawSplit = function(O) {
                return e.fromArray(f(O, a.isKanjiModeEnabled()));
            };
        })(sr)), sr;
    }
    var Bi;
    function G0() {
        if (Bi) return Kn;
        Bi = 1;
        const e = He(), t = ro(), n = x0(), r = R0(), o = D0(), i = M0(), s = Z0(), a = ga(), c = F0(), u = L0(), _ = U0(), f = Ge(), d = H0();
        function g(w, A) {
            const N = w.size, v = i.getPositions(A);
            for(let E = 0; E < v.length; E++){
                const C = v[E][0], $ = v[E][1];
                for(let P = -1; P <= 7; P++)if (!(C + P <= -1 || N <= C + P)) for(let R = -1; R <= 7; R++)$ + R <= -1 || N <= $ + R || (P >= 0 && P <= 6 && (R === 0 || R === 6) || R >= 0 && R <= 6 && (P === 0 || P === 6) || P >= 2 && P <= 4 && R >= 2 && R <= 4 ? w.set(C + P, $ + R, !0, !0) : w.set(C + P, $ + R, !1, !0));
            }
        }
        function b(w) {
            const A = w.size;
            for(let N = 8; N < A - 8; N++){
                const v = N % 2 === 0;
                w.set(N, 6, v, !0), w.set(6, N, v, !0);
            }
        }
        function y(w, A) {
            const N = o.getPositions(A);
            for(let v = 0; v < N.length; v++){
                const E = N[v][0], C = N[v][1];
                for(let $ = -2; $ <= 2; $++)for(let P = -2; P <= 2; P++)$ === -2 || $ === 2 || P === -2 || P === 2 || $ === 0 && P === 0 ? w.set(E + $, C + P, !0, !0) : w.set(E + $, C + P, !1, !0);
            }
        }
        function z(w, A) {
            const N = w.size, v = u.getEncodedBits(A);
            let E, C, $;
            for(let P = 0; P < 18; P++)E = Math.floor(P / 3), C = P % 3 + N - 8 - 3, $ = (v >> P & 1) === 1, w.set(E, C, $, !0), w.set(C, E, $, !0);
        }
        function k(w, A, N) {
            const v = w.size, E = _.getEncodedBits(A, N);
            let C, $;
            for(C = 0; C < 15; C++)$ = (E >> C & 1) === 1, C < 6 ? w.set(C, 8, $, !0) : C < 8 ? w.set(C + 1, 8, $, !0) : w.set(v - 15 + C, 8, $, !0), C < 8 ? w.set(8, v - C - 1, $, !0) : C < 9 ? w.set(8, 15 - C - 1 + 1, $, !0) : w.set(8, 15 - C - 1, $, !0);
            w.set(v - 8, 8, 1, !0);
        }
        function O(w, A) {
            const N = w.size;
            let v = -1, E = N - 1, C = 7, $ = 0;
            for(let P = N - 1; P > 0; P -= 2)for(P === 6 && P--;;){
                for(let R = 0; R < 2; R++)if (!w.isReserved(E, P - R)) {
                    let oe = !1;
                    $ < A.length && (oe = (A[$] >>> C & 1) === 1), w.set(E, P - R, oe), C--, C === -1 && ($++, C = 7);
                }
                if (E += v, E < 0 || N <= E) {
                    E -= v, v = -v;
                    break;
                }
            }
        }
        function I(w, A, N) {
            const v = new n;
            N.forEach(function(R) {
                v.put(R.mode.bit, 4), v.put(R.getLength(), f.getCharCountIndicator(R.mode, w)), R.write(v);
            });
            const E = e.getSymbolTotalCodewords(w), C = a.getTotalCodewordsCount(w, A), $ = (E - C) * 8;
            for(v.getLengthInBits() + 4 <= $ && v.put(0, 4); v.getLengthInBits() % 8 !== 0;)v.putBit(0);
            const P = ($ - v.getLengthInBits()) / 8;
            for(let R = 0; R < P; R++)v.put(R % 2 ? 17 : 236, 8);
            return S(v, w, A);
        }
        function S(w, A, N) {
            const v = e.getSymbolTotalCodewords(A), E = a.getTotalCodewordsCount(A, N), C = v - E, $ = a.getBlocksCount(A, N), P = v % $, R = $ - P, oe = Math.floor(v / $), pe = Math.floor(C / $), lt = pe + 1, ft = oe - pe, Rt = new c(ft);
            let Sn = 0;
            const Dt = new Array($), oo = new Array($);
            let $n = 0;
            const wa = new Uint8Array(w.buffer);
            for(let Ye = 0; Ye < $; Ye++){
                const zn = Ye < R ? pe : lt;
                Dt[Ye] = wa.slice(Sn, Sn + zn), oo[Ye] = Rt.encode(Dt[Ye]), Sn += zn, $n = Math.max($n, zn);
            }
            const An = new Uint8Array(v);
            let io = 0, me, we;
            for(me = 0; me < $n; me++)for(we = 0; we < $; we++)me < Dt[we].length && (An[io++] = Dt[we][me]);
            for(me = 0; me < ft; me++)for(we = 0; we < $; we++)An[io++] = oo[we][me];
            return An;
        }
        function M(w, A, N, v) {
            let E;
            if (Array.isArray(w)) E = d.fromArray(w);
            else if (typeof w == "string") {
                let oe = A;
                if (!oe) {
                    const pe = d.rawSplit(w);
                    oe = u.getBestVersionForData(pe, N);
                }
                E = d.fromString(w, oe || 40);
            } else throw new Error("Invalid data");
            const C = u.getBestVersionForData(E, N);
            if (!C) throw new Error("The amount of data is too big to be stored in a QR Code");
            if (!A) A = C;
            else if (A < C) throw new Error(`
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: ` + C + `.
`);
            const $ = I(A, N, E), P = e.getSymbolSize(A), R = new r(P);
            return g(R, A), b(R), y(R, A), k(R, N, 0), A >= 7 && z(R, A), O(R, $), isNaN(v) && (v = s.getBestMask(R, k.bind(null, R, N))), s.applyMask(v, R), k(R, N, v), {
                modules: R,
                version: A,
                errorCorrectionLevel: N,
                maskPattern: v,
                segments: E
            };
        }
        return Kn.create = function(A, N) {
            if (typeof A > "u" || A === "") throw new Error("No input text");
            let v = t.M, E, C;
            return typeof N < "u" && (v = t.from(N.errorCorrectionLevel, t.M), E = u.from(N.version), C = s.from(N.maskPattern), N.toSJISFunc && e.setToSJISFunction(N.toSJISFunc)), M(A, E, v, C);
        }, Kn;
    }
    var fr = {}, dr = {}, ji;
    function ba() {
        return ji || (ji = 1, (function(e) {
            function t(n) {
                if (typeof n == "number" && (n = n.toString()), typeof n != "string") throw new Error("Color should be defined as hex string");
                let r = n.slice().replace("#", "").split("");
                if (r.length < 3 || r.length === 5 || r.length > 8) throw new Error("Invalid hex color: " + n);
                (r.length === 3 || r.length === 4) && (r = Array.prototype.concat.apply([], r.map(function(i) {
                    return [
                        i,
                        i
                    ];
                }))), r.length === 6 && r.push("F", "F");
                const o = parseInt(r.join(""), 16);
                return {
                    r: o >> 24 & 255,
                    g: o >> 16 & 255,
                    b: o >> 8 & 255,
                    a: o & 255,
                    hex: "#" + r.slice(0, 6).join("")
                };
            }
            e.getOptions = function(r) {
                r || (r = {}), r.color || (r.color = {});
                const o = typeof r.margin > "u" || r.margin === null || r.margin < 0 ? 4 : r.margin, i = r.width && r.width >= 21 ? r.width : void 0, s = r.scale || 4;
                return {
                    width: i,
                    scale: i ? 4 : s,
                    margin: o,
                    color: {
                        dark: t(r.color.dark || "#000000ff"),
                        light: t(r.color.light || "#ffffffff")
                    },
                    type: r.type,
                    rendererOpts: r.rendererOpts || {}
                };
            }, e.getScale = function(r, o) {
                return o.width && o.width >= r + o.margin * 2 ? o.width / (r + o.margin * 2) : o.scale;
            }, e.getImageWidth = function(r, o) {
                const i = e.getScale(r, o);
                return Math.floor((r + o.margin * 2) * i);
            }, e.qrToImageData = function(r, o, i) {
                const s = o.modules.size, a = o.modules.data, c = e.getScale(s, i), u = Math.floor((s + i.margin * 2) * c), _ = i.margin * c, f = [
                    i.color.light,
                    i.color.dark
                ];
                for(let d = 0; d < u; d++)for(let g = 0; g < u; g++){
                    let b = (d * u + g) * 4, y = i.color.light;
                    if (d >= _ && g >= _ && d < u - _ && g < u - _) {
                        const z = Math.floor((d - _) / c), k = Math.floor((g - _) / c);
                        y = f[a[z * s + k] ? 1 : 0];
                    }
                    r[b++] = y.r, r[b++] = y.g, r[b++] = y.b, r[b] = y.a;
                }
            };
        })(dr)), dr;
    }
    var Fi;
    function Y0() {
        return Fi || (Fi = 1, (function(e) {
            const t = ba();
            function n(o, i, s) {
                o.clearRect(0, 0, i.width, i.height), i.style || (i.style = {}), i.height = s, i.width = s, i.style.height = s + "px", i.style.width = s + "px";
            }
            function r() {
                try {
                    return document.createElement("canvas");
                } catch  {
                    throw new Error("You need to specify a canvas element");
                }
            }
            e.render = function(i, s, a) {
                let c = a, u = s;
                typeof c > "u" && (!s || !s.getContext) && (c = s, s = void 0), s || (u = r()), c = t.getOptions(c);
                const _ = t.getImageWidth(i.modules.size, c), f = u.getContext("2d"), d = f.createImageData(_, _);
                return t.qrToImageData(d.data, i, c), n(f, u, _), f.putImageData(d, 0, 0), u;
            }, e.renderToDataURL = function(i, s, a) {
                let c = a;
                typeof c > "u" && (!s || !s.getContext) && (c = s, s = void 0), c || (c = {});
                const u = e.render(i, s, c), _ = c.type || "image/png", f = c.rendererOpts || {};
                return u.toDataURL(_, f.quality);
            };
        })(fr)), fr;
    }
    var gr = {}, Li;
    function Q0() {
        if (Li) return gr;
        Li = 1;
        const e = ba();
        function t(o, i) {
            const s = o.a / 255, a = i + '="' + o.hex + '"';
            return s < 1 ? a + " " + i + '-opacity="' + s.toFixed(2).slice(1) + '"' : a;
        }
        function n(o, i, s) {
            let a = o + i;
            return typeof s < "u" && (a += " " + s), a;
        }
        function r(o, i, s) {
            let a = "", c = 0, u = !1, _ = 0;
            for(let f = 0; f < o.length; f++){
                const d = Math.floor(f % i), g = Math.floor(f / i);
                !d && !u && (u = !0), o[f] ? (_++, f > 0 && d > 0 && o[f - 1] || (a += u ? n("M", d + s, .5 + g + s) : n("m", c, 0), c = 0, u = !1), d + 1 < i && o[f + 1] || (a += n("h", _), _ = 0)) : c++;
            }
            return a;
        }
        return gr.render = function(i, s, a) {
            const c = e.getOptions(s), u = i.modules.size, _ = i.modules.data, f = u + c.margin * 2, d = c.color.light.a ? "<path " + t(c.color.light, "fill") + ' d="M0 0h' + f + "v" + f + 'H0z"/>' : "", g = "<path " + t(c.color.dark, "stroke") + ' d="' + r(_, u, c.margin) + '"/>', b = 'viewBox="0 0 ' + f + " " + f + '"', z = '<svg xmlns="http://www.w3.org/2000/svg" ' + (c.width ? 'width="' + c.width + '" height="' + c.width + '" ' : "") + b + ' shape-rendering="crispEdges">' + d + g + `</svg>
`;
            return typeof a == "function" && a(null, z), z;
        }, gr;
    }
    var Ui;
    function X0() {
        if (Ui) return et;
        Ui = 1;
        const e = N0(), t = G0(), n = Y0(), r = Q0();
        function o(i, s, a, c, u) {
            const _ = [].slice.call(arguments, 1), f = _.length, d = typeof _[f - 1] == "function";
            if (!d && !e()) throw new Error("Callback required as last argument");
            if (d) {
                if (f < 2) throw new Error("Too few arguments provided");
                f === 2 ? (u = a, a = s, s = c = void 0) : f === 3 && (s.getContext && typeof u > "u" ? (u = c, c = void 0) : (u = c, c = a, a = s, s = void 0));
            } else {
                if (f < 1) throw new Error("Too few arguments provided");
                return f === 1 ? (a = s, s = c = void 0) : f === 2 && !s.getContext && (c = a, a = s, s = void 0), new Promise(function(g, b) {
                    try {
                        const y = t.create(a, c);
                        g(i(y, s, c));
                    } catch (y) {
                        b(y);
                    }
                });
            }
            try {
                const g = t.create(a, c);
                u(null, i(g, s, c));
            } catch (g) {
                u(g);
            }
        }
        return et.create = t.create, et.toCanvas = o.bind(null, n.render), et.toDataURL = o.bind(null, n.renderToDataURL), et.toString = o.bind(null, function(i, s, a) {
            return r.render(i, a);
        }), et;
    }
    var ey = X0();
    const ty = P0(ey);
    function ny(e) {
        let t = "";
        for(let n = 0; n < e.length; n++)t += String.fromCharCode(e[n]);
        return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function ry(e) {
        const t = JSON.stringify(e);
        return `https://spume.freqhole.net/?p=${ny(new TextEncoder().encode(t))}`;
    }
    const oy = "#ff00c8", qi = "#000000";
    async function iy(e, t = "/freqhole.svg") {
        const n = document.createElement("canvas");
        await ty.toCanvas(n, ry(e), {
            width: 960,
            margin: 2,
            errorCorrectionLevel: "H",
            color: {
                dark: oy,
                light: qi
            }
        });
        const r = await sy(t), o = n.getContext("2d");
        if (o && r) {
            const i = n.width * .22, s = (n.width - i) / 2, a = (n.height - i) / 2, c = i * .15;
            o.fillStyle = qi, o.fillRect(s - c, a - c, i + c * 2, i + c * 2), o.drawImage(r, s, a, i, i);
        }
        return n.toDataURL("image/png");
    }
    function sy(e) {
        return new Promise((t)=>{
            const n = new Image;
            n.onload = ()=>t(n), n.onerror = ()=>t(null), n.src = e;
        });
    }
    async function ay() {
        if (typeof navigator > "u" || !navigator.storage?.estimate) return {
            usageBytes: 0,
            quotaBytes: null
        };
        const e = await navigator.storage.estimate();
        return {
            usageBytes: e.usage ?? 0,
            quotaBytes: e.quota ?? null
        };
    }
    function Ji(e) {
        if (e < 1024) return `${e} B`;
        const t = [
            "KB",
            "MB",
            "GB",
            "TB"
        ];
        let n = e / 1024, r = 0;
        for(; n >= 1024 && r < t.length - 1;)n /= 1024, r += 1;
        return `${n.toFixed(1)} ${t[r]}`;
    }
    var cy = J('<li class="text-sm text-neutral-500">no paired controllers'), uy = J('<div class="fixed inset-0 z-40 bg-black/90 flex items-center justify-center p-6"data-testid=settings-panel><div class="w-full max-w-md flex flex-col gap-6 text-left"><div class="flex items-center justify-between"><h2 class="text-lg font-semibold">player settings</h2><button type=button class="text-sm text-neutral-400"data-testid=settings-close>close</button></div><div class="flex flex-col gap-2"><label class="text-xs uppercase tracking-widest text-neutral-500">device name</label><div class="flex gap-2"><input class="flex-1 bg-neutral-800 rounded px-2 py-1 text-sm"data-testid=device-name-input><button type=button class="text-sm bg-neutral-700 rounded px-3 py-1"data-testid=device-name-save>save</button></div></div><div class="flex flex-col gap-2"><label class="text-xs uppercase tracking-widest text-neutral-500">pairing pin</label><div class="flex items-center gap-2"><p class="text-2xl font-mono tracking-widest"data-testid=settings-pin></p><button type=button class="text-sm bg-neutral-700 rounded px-3 py-1"data-testid=rotate-pin-button>rotate pin</button></div></div><div class="flex flex-col gap-2"><label class="text-xs uppercase tracking-widest text-neutral-500">trusted controllers</label><ul class="flex flex-col gap-1"data-testid=trusted-controller-list></ul></div><div class="flex flex-col gap-1"><label class="text-xs uppercase tracking-widest text-neutral-500">local storage'), _y = J('<div class="flex flex-col gap-2"><label class="text-xs uppercase tracking-widest text-neutral-500">device id</label><div class="flex items-center gap-2"><p class="flex-1 truncate text-xs font-mono text-neutral-400"data-testid=settings-node-id></p><button type=button class="text-sm bg-neutral-700 rounded px-3 py-1"data-testid=copy-node-id-button>'), ly = J('<li class="flex items-center justify-between text-sm bg-neutral-800 rounded px-2 py-1"data-testid=trusted-controller-row><span class=truncate></span><button type=button class=text-neutral-400 data-testid=forget-controller-button>forget'), fy = J('<p class="text-sm text-neutral-400"data-testid=storage-usage>');
    function dy(e) {
        const [t, n] = W(no()), [r, { refetch: o }] = en(wg), [i] = en(ay), [s, a] = W(!1), c = async ()=>{
            await S0(t());
        }, u = async ()=>{
            e.nodeId && (await navigator.clipboard.writeText(e.nodeId), a(!0), setTimeout(()=>a(!1), 1500));
        }, _ = async (f)=>{
            await mg(f.node_id), await o();
        };
        return (()=>{
            var f = uy(), d = f.firstChild, g = d.firstChild, b = g.firstChild, y = b.nextSibling, z = g.nextSibling, k = z.firstChild, O = k.nextSibling, I = O.firstChild, S = I.nextSibling, M = z.nextSibling, w = M.firstChild, A = w.nextSibling, N = A.firstChild, v = N.nextSibling, E = M.nextSibling, C = E.firstChild, $ = C.nextSibling, P = E.nextSibling;
            return P.firstChild, y.$$click = ()=>e.onClose(), I.$$input = (R)=>n(R.currentTarget.value), S.$$click = c, Z(d, L(H, {
                get when () {
                    return e.nodeId;
                },
                children: (R)=>(()=>{
                        var oe = _y(), pe = oe.firstChild, lt = pe.nextSibling, ft = lt.firstChild, Rt = ft.nextSibling;
                        return Z(ft, R), Rt.$$click = u, Z(Rt, ()=>s() ? "copied!" : "copy"), oe;
                    })()
            }), M), Z(N, Zr), v.$$click = ()=>Yd(), Z($, L(hr, {
                get each () {
                    return r() ?? [];
                },
                children: (R)=>(()=>{
                        var oe = ly(), pe = oe.firstChild, lt = pe.nextSibling;
                        return Z(pe, ()=>R.display_name), lt.$$click = ()=>_(R), oe;
                    })()
            }), null), Z($, L(H, {
                get when () {
                    return r()?.length === 0;
                },
                get children () {
                    return cy();
                }
            }), null), Z(P, L(H, {
                get when () {
                    return i();
                },
                children: (R)=>(()=>{
                        var oe = fy();
                        return Z(oe, ()=>Ji(R().usageBytes), null), Z(oe, L(H, {
                            get when () {
                                return R().quotaBytes !== null;
                            },
                            get children () {
                                return [
                                    " / ",
                                    Gt(()=>Ji(R().quotaBytes))
                                ];
                            }
                        }), null), oe;
                    })()
            }), null), Pe(()=>I.value = t()), f;
        })();
    }
    es([
        "click",
        "input"
    ]);
    var gy = J('<div class="fixed top-10 right-4 z-30 text-xs text-neutral-500 text-right max-w-[40vw]"data-testid=connected-controllers>connected: '), py = J('<div class="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center gap-4 p-6 text-center"><p class=text-lg>playback is ready, but the browser blocked it from starting on its own</p><button type=button class="px-6 py-3 rounded-lg bg-white text-black text-lg font-semibold"data-testid=resume-playback>tap to start playback'), hy = J("<p>downloading... <!>%"), by = J('<div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-black/80 rounded-lg px-4 py-2 text-sm"data-testid=buffering-indicator>'), my = J('<p class="text-sm text-neutral-400">initializing p2p node...'), wy = J('<p class="font-mono tracking-widest shrink-0 text-[clamp(2rem,9vmin,6rem)]"data-testid=pairing-pin>'), yy = J('<p class="text-xs text-neutral-500"> listening'), vy = J('<div class="flex flex-col items-center gap-2"data-testid=radio-panel><p class="text-xs uppercase tracking-widest text-neutral-500"data-testid=radio-state>radio - '), ky = J('<div class="h-screen flex flex-col items-center justify-center gap-6 p-6 text-center overflow-y-auto"><div class="fixed inset-0 z-50 bg-black"data-testid=video-overlay></div><button type=button class="fixed top-4 right-4 z-30 text-neutral-500 text-xs"data-testid=settings-toggle>settings'), Ey = J("<span>"), Sy = J("<p>buffering..."), $y = J('<img alt="pairing qr code"class="w-[min(70vmin,900px)] h-[min(70vmin,900px)] shrink-0"data-testid=pairing-qr>'), Ay = J('<ul class="mt-4 w-full max-w-md text-left text-sm text-neutral-400"data-testid=queue-list>'), zy = J('<div class="flex flex-col items-center gap-4 w-full max-w-md"data-testid=now-playing><p class="text-xl font-semibold"data-testid=now-playing-title></p><p class="text-sm text-neutral-400"data-testid=now-playing-artist></p><p class="text-xs text-neutral-500 font-mono"data-testid=now-playing-time> / </p><div class="flex items-center gap-8"data-testid=playback-controls><button type=button class="text-3xl leading-none"data-testid=play-pause-button></button><button type=button class="text-3xl leading-none"data-testid=skip-button>⏭'), Iy = J('<div class="w-64 h-64 rounded-lg bg-neutral-800 flex items-center justify-center"data-testid=artwork-fallback><svg viewBox="0 0 24 24"class="w-20 h-20 text-neutral-600"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M9 18V5l12-2v13"></path><circle cx=6 cy=18 r=3></circle><circle cx=18 cy=16 r=3>'), Oy = J('<img alt class="w-64 h-64 rounded-lg object-cover shadow-lg">'), Cy = J('<li class="flex items-center justify-between gap-2 truncate py-1 border-b border-neutral-800"><span class=truncate>'), Ty = J('<span class="w-8 h-0.5 overflow-hidden rounded-full bg-neutral-700"><span class="block w-full h-full bg-neutral-400 animate-[bounce-bar_2s_ease-in-out_infinite]">'), Py = J('<span class="shrink-0 flex flex-col items-end gap-0.5"><span class="font-mono text-xs">'), Vi = J('<p class="text-sm text-neutral-400">'), Ny = J('<p class="text-xl font-semibold"data-testid=radio-title>');
    function pr(e) {
        (!Number.isFinite(e) || e < 0) && (e = 0);
        const t = Math.floor(e / 60), n = Math.floor(e % 60);
        return `${t}:${n.toString().padStart(2, "0")}`;
    }
    function xy() {
        const [e, t] = W(!1);
        za(()=>{
            E0();
        });
        const [n] = en(async ()=>{
            const o = await Kd();
            return O0(o), o;
        }), [r] = en(()=>n() ? {
                playerNode: n(),
                name: no()
            } : void 0, async ({ playerNode: o, name: i })=>iy({
                node_id: o.node_id(),
                name: i,
                role: "player_remote"
            }));
        return (()=>{
            var o = ky(), i = o.firstChild, s = i.nextSibling;
            return Z(i, Ww), s.$$click = ()=>t(!0), Z(o, L(H, {
                get when () {
                    return fi().length > 0;
                },
                get children () {
                    var a = gy();
                    return a.firstChild, Z(a, L(hr, {
                        get each () {
                            return fi();
                        },
                        children: (c, u)=>(()=>{
                                var _ = Ey();
                                return Z(_, ()=>u() > 0 ? ", " : "", null), Z(_, ()=>c.display_name, null), _;
                            })()
                    }), null), a;
                }
            }), null), Z(o, L(H, {
                get when () {
                    return Jt() === "blocked";
                },
                get children () {
                    var a = py(), c = a.firstChild, u = c.nextSibling;
                    return u.$$click = ()=>{
                        t0();
                    }, a;
                }
            }), null), Z(o, L(H, {
                get when () {
                    return Jt() === "buffering";
                },
                get children () {
                    var a = by();
                    return Z(a, L(H, {
                        get when () {
                            return si() !== null;
                        },
                        get fallback () {
                            return Sy();
                        },
                        get children () {
                            var c = hy(), u = c.firstChild, _ = u.nextSibling;
                            return _.nextSibling, Z(c, ()=>Math.round((si() ?? 0) * 100), _), c;
                        }
                    })), a;
                }
            }), null), Z(o, L(H, {
                get when () {
                    return e();
                },
                get children () {
                    return L(dy, {
                        onClose: ()=>t(!1),
                        get nodeId () {
                            return n()?.node_id();
                        }
                    });
                }
            }), null), Z(o, L(H, {
                get when () {
                    return !Vt();
                },
                get children () {
                    return [
                        L(H, {
                            get when () {
                                return n.loading;
                            },
                            get children () {
                                return my();
                            }
                        }),
                        L(H, {
                            get when () {
                                return n();
                            },
                            get children () {
                                return [
                                    L(H, {
                                        get when () {
                                            return r();
                                        },
                                        children: (a)=>(()=>{
                                                var c = $y();
                                                return Pe(()=>co(c, "src", a())), c;
                                            })()
                                    }),
                                    (()=>{
                                        var a = wy();
                                        return Z(a, Zr), a;
                                    })()
                                ];
                            }
                        })
                    ];
                }
            }), null), Z(o, L(H, {
                get when () {
                    return Gt(()=>ii() === "audio")() ? Vt() : null;
                },
                children: (a)=>(()=>{
                        var c = zy(), u = c.firstChild, _ = u.nextSibling, f = _.nextSibling, d = f.firstChild, g = f.nextSibling, b = g.firstChild, y = b.nextSibling;
                        return Z(c, L(H, {
                            get when () {
                                return a().artwork_url;
                            },
                            get fallback () {
                                return Iy();
                            },
                            children: (z)=>(()=>{
                                    var k = Oy();
                                    return Pe(()=>co(k, "src", z())), k;
                                })()
                        }), u), Z(u, ()=>a().title ?? "unknown title"), Z(_, ()=>a().artist ?? ""), Z(f, ()=>pr(Hw()), d), Z(f, ()=>pr(a().duration_ms ? a().duration_ms / 1e3 : Gw()), null), b.$$click = ()=>Jt() === "playing" ? ra() : oa(), Z(b, ()=>Jt() === "playing" ? "⏸" : "▶"), y.$$click = ()=>n() && void En(n()), Z(c, L(H, {
                            get when () {
                                return oi().length > 1;
                            },
                            get children () {
                                var z = Ay();
                                return Z(z, L(hr, {
                                    get each () {
                                        return oi().slice(1);
                                    },
                                    children: (k)=>(()=>{
                                            var O = Cy(), I = O.firstChild;
                                            return Z(I, ()=>k.title ?? k.blake3_hash.slice(0, 12), null), Z(I, L(H, {
                                                get when () {
                                                    return k.artist;
                                                },
                                                get children () {
                                                    return [
                                                        " — ",
                                                        Gt(()=>k.artist)
                                                    ];
                                                }
                                            }), null), Z(O, L(H, {
                                                get when () {
                                                    return k.duration_ms;
                                                },
                                                children: (S)=>{
                                                    const M = ()=>Yw().get(k.blake3_hash);
                                                    return (()=>{
                                                        var w = Py(), A = w.firstChild;
                                                        return Z(A, ()=>pr(S() / 1e3)), Z(w, L(H, {
                                                            get when () {
                                                                return M() === "loading";
                                                            },
                                                            get children () {
                                                                return Ty();
                                                            }
                                                        }), null), Pe(()=>A.classList.toggle("underline", M() === "ready")), w;
                                                    })();
                                                }
                                            }), null), O;
                                        })()
                                })), z;
                            }
                        }), null), c;
                    })()
            }), null), Z(o, L(H, {
                get when () {
                    return Gt(()=>!Vt())() && ai() !== "idle";
                },
                get children () {
                    var a = vy(), c = a.firstChild;
                    return c.firstChild, Z(c, ai, null), Z(a, L(H, {
                        get when () {
                            return h0();
                        },
                        children: (u)=>(()=>{
                                var _ = Vi();
                                return Z(_, u), _;
                            })()
                    }), null), Z(a, L(H, {
                        get when () {
                            return p0();
                        },
                        children: (u)=>[
                                (()=>{
                                    var _ = Ny();
                                    return Z(_, ()=>u().title), _;
                                })(),
                                L(H, {
                                    get when () {
                                        return u().artist;
                                    },
                                    get children () {
                                        var _ = Vi();
                                        return Z(_, ()=>u().artist), _;
                                    }
                                })
                            ]
                    }), null), Z(a, L(H, {
                        get when () {
                            return ci() !== null;
                        },
                        get children () {
                            var u = yy(), _ = u.firstChild;
                            return Z(u, ci, _), u;
                        }
                    }), null), a;
                }
            }), null), Pe(()=>i.classList.toggle("hidden", !(Vt() && ii() === "video"))), o;
        })();
    }
    es([
        "click"
    ]);
    const ma = document.getElementById("root");
    if (!ma) throw new Error("missing #root element");
    Ma(()=>L(xy, {}), ma);
})();
