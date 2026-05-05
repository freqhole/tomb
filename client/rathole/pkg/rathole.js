//#region exports

/**
 * Debug API exposed to browser console for terminal inspection.
 */
export class TerminalDebugApi {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TerminalDebugApi.prototype);
        obj.__wbg_ptr = ptr;
        TerminalDebugApiFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TerminalDebugApiFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_terminaldebugapi_free(ptr, 0);
    }
    /**
     * Returns the full atlas glyph-to-symbol mapping as a JavaScript array.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript objects fails.
     * @returns {Array<any>}
     */
    getAtlasLookup() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getAtlasLookup(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the base glyph ID for a given symbol, or null if not found.
     * @param {string} symbol
     * @returns {number | undefined}
     */
    getBaseGlyphId(symbol) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(symbol, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.terminaldebugapi_getBaseGlyphId(this.__wbg_ptr, ptr0, len0);
        return ret === 0xFFFFFF ? undefined : ret;
    }
    /**
     * Returns the canvas size in pixels as an object with `width` and `height` fields.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript object fails.
     * @returns {any}
     */
    getCanvasSize() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getCanvasSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the cell size in pixels as an object with `width` and `height` fields.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript object fails.
     * @returns {any}
     */
    getCellSize() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getCellSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the number of glyphs available in the font atlas.
     * @returns {number}
     */
    getGlyphCount() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getGlyphCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Returns an array of glyphs that were requested but not found in the font atlas.
     * @returns {Array<any>}
     */
    getMissingGlyphs() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getMissingGlyphs(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the symbol for a given glyph ID, or null if not found.
     * @param {number} glyph_id
     * @returns {string | undefined}
     */
    getSymbol(glyph_id) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(glyph_id);
        const ret = wasm.terminaldebugapi_getSymbol(this.__wbg_ptr, glyph_id);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Returns the terminal size in cells as an object with `cols` and `rows` fields.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript object fails.
     * @returns {any}
     */
    getTerminalSize() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getTerminalSize(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) TerminalDebugApi.prototype[Symbol.dispose] = TerminalDebugApi.prototype.free;

/**
 * wasm entry. invoked from js after the module loads.
 */
export function start() {
    const ret = wasm.start();
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

//#endregion

//#region wasm imports
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_boolean_get_6ea149f0a8dcc5ff: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            if (!isLikeNone(ret)) {
                _assertBoolean(ret);
            }
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_ab4b34d23d6778bd: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_3baa9db1a987f47d: function(arg0) {
            const ret = typeof(arg0) === 'function';
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_is_undefined_29a43b4d42920abd: function(arg0) {
            const ret = arg0 === undefined;
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_number_get_c7f42aed0525c451: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            if (!isLikeNone(ret)) {
                _assertNum(ret);
            }
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_7ed5322991caaec5: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_b46c9b5a9f08ec37: function() { return logError(function (arg0) {
            arg0._wbg_cb_unref();
        }, arguments); },
        __wbg_activeTexture_3df5a43f55a69a6c: function() { return logError(function (arg0, arg1) {
            arg0.activeTexture(arg1 >>> 0);
        }, arguments); },
        __wbg_activeTexture_546afc38eb98df71: function() { return logError(function (arg0, arg1) {
            arg0.activeTexture(arg1 >>> 0);
        }, arguments); },
        __wbg_addEventListener_8176dab41b09531c: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_altKey_3116112ec764f316: function() { return logError(function (arg0) {
            const ret = arg0.altKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_altKey_c4f26b40f1b826b4: function() { return logError(function (arg0) {
            const ret = arg0.altKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_appendChild_e95c8b3b936d250a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.appendChild(arg1);
            return ret;
        }, arguments); },
        __wbg_attachShader_1eec3a0d2bfe6f83: function() { return logError(function (arg0, arg1, arg2) {
            arg0.attachShader(arg1, arg2);
        }, arguments); },
        __wbg_attachShader_e1c4cb1f00f167df: function() { return logError(function (arg0, arg1, arg2) {
            arg0.attachShader(arg1, arg2);
        }, arguments); },
        __wbg_beginPath_b4ec56dc6dbd28c7: function() { return logError(function (arg0) {
            arg0.beginPath();
        }, arguments); },
        __wbg_bindBufferBase_a0b97da288b2e5bc: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bindBufferBase(arg1 >>> 0, arg2 >>> 0, arg3);
        }, arguments); },
        __wbg_bindBuffer_710a611286e86fe9: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindBuffer(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindBuffer_b193f35215c88d5d: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindBuffer(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindTexture_a87fb41b3319bcb9: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindTexture(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindTexture_c3fcb7dc0c448083: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindTexture(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindVertexArrayOES_b0e8a5a6c8a88c84: function() { return logError(function (arg0, arg1) {
            arg0.bindVertexArrayOES(arg1);
        }, arguments); },
        __wbg_bindVertexArray_ea785b5f2238eb93: function() { return logError(function (arg0, arg1) {
            arg0.bindVertexArray(arg1);
        }, arguments); },
        __wbg_body_c7b35a55457167ba: function() { return logError(function (arg0) {
            const ret = arg0.body;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_bufferData_f267cdc80efbd6a0: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferData(arg1 >>> 0, arg2, arg3 >>> 0);
        }, arguments); },
        __wbg_bufferData_f401229c915b8028: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferData(arg1 >>> 0, arg2, arg3 >>> 0);
        }, arguments); },
        __wbg_bufferSubData_3708c0445a03981a: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferSubData(arg1 >>> 0, arg2, arg3);
        }, arguments); },
        __wbg_bufferSubData_ade66d88865db9fc: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferSubData(arg1 >>> 0, arg2, arg3);
        }, arguments); },
        __wbg_button_c794bf4b1dcd7c4c: function() { return logError(function (arg0) {
            const ret = arg0.button;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_call_a24592a6f349a97e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_clearColor_2b334a2a4b9f1124: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.clearColor(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_clearColor_6e92030afcf0f68f: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.clearColor(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_clearRect_b5a1c34799cc9fcf: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.clearRect(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_clear_d82c0c485d1af30e: function() { return logError(function (arg0, arg1) {
            arg0.clear(arg1 >>> 0);
        }, arguments); },
        __wbg_clear_e39cde04b063e709: function() { return logError(function (arg0, arg1) {
            arg0.clear(arg1 >>> 0);
        }, arguments); },
        __wbg_clientHeight_01b31bebacb195f0: function() { return logError(function (arg0) {
            const ret = arg0.clientHeight;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_clientWidth_188be30d8e061ee5: function() { return logError(function (arg0) {
            const ret = arg0.clientWidth;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_clip_4681bd12b584a12f: function() { return logError(function (arg0) {
            arg0.clip();
        }, arguments); },
        __wbg_clipboard_a08ffae077ba7949: function() { return logError(function (arg0) {
            const ret = arg0.clipboard;
            return ret;
        }, arguments); },
        __wbg_compileShader_b39b7d5caca97c9d: function() { return logError(function (arg0, arg1) {
            arg0.compileShader(arg1);
        }, arguments); },
        __wbg_compileShader_fc084de511370bc0: function() { return logError(function (arg0, arg1) {
            arg0.compileShader(arg1);
        }, arguments); },
        __wbg_createBuffer_6ad9886c8fed1a21: function() { return logError(function (arg0) {
            const ret = arg0.createBuffer();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createBuffer_f68202a47c36c3d6: function() { return logError(function (arg0) {
            const ret = arg0.createBuffer();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createElement_bbd4c90086fe6f7b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.createElement(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_createProgram_635f6f85c5f3c83d: function() { return logError(function (arg0) {
            const ret = arg0.createProgram();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createProgram_bedc70c0d16e41df: function() { return logError(function (arg0) {
            const ret = arg0.createProgram();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createShader_2c8d8c9f17967efe: function() { return logError(function (arg0, arg1) {
            const ret = arg0.createShader(arg1 >>> 0);
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createShader_5484e429d7514a9d: function() { return logError(function (arg0, arg1) {
            const ret = arg0.createShader(arg1 >>> 0);
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createTexture_caeb4349ae5c7a83: function() { return logError(function (arg0) {
            const ret = arg0.createTexture();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createTexture_f9850d55f04c7883: function() { return logError(function (arg0) {
            const ret = arg0.createTexture();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createVertexArrayOES_25823ca742b59551: function() { return logError(function (arg0) {
            const ret = arg0.createVertexArrayOES();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createVertexArray_a8c3e6799bdb5af8: function() { return logError(function (arg0) {
            const ret = arg0.createVertexArray();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_ctrlKey_31968cccd46bdef6: function() { return logError(function (arg0) {
            const ret = arg0.ctrlKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_ctrlKey_a49693667722b909: function() { return logError(function (arg0) {
            const ret = arg0.ctrlKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_data_b5233fd85361a418: function() { return logError(function (arg0, arg1) {
            const ret = arg1.data;
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_deleteBuffer_521c77539f9941c1: function() { return logError(function (arg0, arg1) {
            arg0.deleteBuffer(arg1);
        }, arguments); },
        __wbg_deleteBuffer_558c85bd550b15df: function() { return logError(function (arg0, arg1) {
            arg0.deleteBuffer(arg1);
        }, arguments); },
        __wbg_deleteProgram_6d3a2bdf7fc6d658: function() { return logError(function (arg0, arg1) {
            arg0.deleteProgram(arg1);
        }, arguments); },
        __wbg_deleteProgram_8175823e816f19ed: function() { return logError(function (arg0, arg1) {
            arg0.deleteProgram(arg1);
        }, arguments); },
        __wbg_deleteShader_379785984071d8af: function() { return logError(function (arg0, arg1) {
            arg0.deleteShader(arg1);
        }, arguments); },
        __wbg_deleteShader_460e3d0b80ea3790: function() { return logError(function (arg0, arg1) {
            arg0.deleteShader(arg1);
        }, arguments); },
        __wbg_deleteTexture_6de16581bf7e5e00: function() { return logError(function (arg0, arg1) {
            arg0.deleteTexture(arg1);
        }, arguments); },
        __wbg_deleteTexture_8714aac647598458: function() { return logError(function (arg0, arg1) {
            arg0.deleteTexture(arg1);
        }, arguments); },
        __wbg_devicePixelRatio_18e6533e6d7f4088: function() { return logError(function (arg0) {
            const ret = arg0.devicePixelRatio;
            return ret;
        }, arguments); },
        __wbg_document_7a41071f2f439323: function() { return logError(function (arg0) {
            const ret = arg0.document;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_drawElementsInstancedANGLE_01b7fe3dcfda1f57: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.drawElementsInstancedANGLE(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5);
        }, arguments); },
        __wbg_drawElementsInstanced_9cdd75777f6fe52e: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.drawElementsInstanced(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5);
        }, arguments); },
        __wbg_enableVertexAttribArray_44d2f9d5bd7d4773: function() { return logError(function (arg0, arg1) {
            arg0.enableVertexAttribArray(arg1 >>> 0);
        }, arguments); },
        __wbg_enableVertexAttribArray_a6fb4500c619f67f: function() { return logError(function (arg0, arg1) {
            arg0.enableVertexAttribArray(arg1 >>> 0);
        }, arguments); },
        __wbg_error_2001591ad2463697: function() { return logError(function (arg0) {
            console.error(arg0);
        }, arguments); },
        __wbg_error_a6fa202b58aa1cd3: function() { return logError(function (arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        }, arguments); },
        __wbg_fillText_8aaa9fc0088bfe5b: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.fillText(getStringFromWasm0(arg1, arg2), arg3, arg4);
        }, arguments); },
        __wbg_getAttribute_8627dea35cdb7b06: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.getAttribute(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getContext_69ddc504535a2e7b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getContext_fc146f8ec021d074: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getElementById_0b5a508c91194690: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getElementById(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getExtension_5228364a0715c7db: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getExtension(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getImageData_1b529eb619aaa4b1: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.getImageData(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_getParameter_594f21b1d26abeed: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getParameter(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getParameter_e1c6e394a2959d43: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getParameter(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getProgramInfoLog_00af0d3e29c73293: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getProgramInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getProgramInfoLog_612d2724e854e752: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getProgramInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getProgramParameter_6aa39c38709e0d9d: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getProgramParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getProgramParameter_d18275e84d037799: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getProgramParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getShaderInfoLog_57fd85336a768aa9: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getShaderInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getShaderInfoLog_ef603aa10b52d639: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getShaderInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getShaderParameter_4676ea57a8db83ec: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getShaderParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getShaderParameter_f1ed538581985875: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getShaderParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getSupportedExtensions_a6b7a4d43810c644: function() { return logError(function (arg0) {
            const ret = arg0.getSupportedExtensions();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getUniformBlockIndex_79370b4799b9dd60: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.getUniformBlockIndex(arg1, getStringFromWasm0(arg2, arg3));
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_getUniformLocation_084155a4348002df: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.getUniformLocation(arg1, getStringFromWasm0(arg2, arg3));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getUniformLocation_91e9e13f695e50c5: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.getUniformLocation(arg1, getStringFromWasm0(arg2, arg3));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_get_unchecked_17f53dad852b9588: function() { return logError(function (arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        }, arguments); },
        __wbg_height_528848d067cc2221: function() { return logError(function (arg0) {
            const ret = arg0.height;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_height_fc2f1def9f6e7730: function() { return logError(function (arg0) {
            const ret = arg0.height;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_innerHeight_72e7bb88c4b9ede8: function() { return handleError(function (arg0) {
            const ret = arg0.innerHeight;
            return ret;
        }, arguments); },
        __wbg_innerWidth_c7446907ab672e41: function() { return handleError(function (arg0) {
            const ret = arg0.innerWidth;
            return ret;
        }, arguments); },
        __wbg_instanceof_Element_56c8d987654f359e: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Element;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_HtmlCanvasElement_ea4dfc3bb77c734b: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLCanvasElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_OffscreenCanvasRenderingContext2d_285a274020b4f230: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof OffscreenCanvasRenderingContext2D;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_WebGl2RenderingContext_23f2da2f294d4c8e: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof WebGL2RenderingContext;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_Window_cc64c86c8ef9e02b: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_isContextLost_08db9c8003a26317: function() { return logError(function (arg0) {
            const ret = arg0.isContextLost();
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_key_2cbc38fa83cdb336: function() { return logError(function (arg0, arg1) {
            const ret = arg1.key;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_length_3d4ecd04bd8d22f1: function() { return logError(function (arg0) {
            const ret = arg0.length;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_linkProgram_0f095b446d393a30: function() { return logError(function (arg0, arg1) {
            arg0.linkProgram(arg1);
        }, arguments); },
        __wbg_linkProgram_aa5b01ff0fcf3a80: function() { return logError(function (arg0, arg1) {
            arg0.linkProgram(arg1);
        }, arguments); },
        __wbg_log_7e1aa9064a1dbdbd: function() { return logError(function (arg0) {
            console.log(arg0);
        }, arguments); },
        __wbg_mark_ab30dfc6cf11130f: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.mark(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_measure_6eb97f50378785c5: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.measure(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_metaKey_f8f3c1d2a5b88850: function() { return logError(function (arg0) {
            const ret = arg0.metaKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_navigator_bc077756492232c5: function() { return logError(function (arg0) {
            const ret = arg0.navigator;
            return ret;
        }, arguments); },
        __wbg_new_227d7c05414eb861: function() { return logError(function () {
            const ret = new Error();
            return ret;
        }, arguments); },
        __wbg_new_682678e2f47e32bc: function() { return logError(function () {
            const ret = new Array();
            return ret;
        }, arguments); },
        __wbg_new_aa8d0fa9762c29bd: function() { return logError(function () {
            const ret = new Object();
            return ret;
        }, arguments); },
        __wbg_new_af890c4e1a2d9b0a: function() { return handleError(function (arg0, arg1) {
            const ret = new OffscreenCanvas(arg0 >>> 0, arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_offsetX_a88ab66c480b77a3: function() { return logError(function (arg0) {
            const ret = arg0.offsetX;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_offsetY_679a899b0b60c036: function() { return logError(function (arg0) {
            const ret = arg0.offsetY;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_performance_e0409977f06d6f6b: function() { return logError(function (arg0) {
            const ret = arg0.performance;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_preventDefault_f55c01cb5fd2bcc0: function() { return logError(function (arg0) {
            arg0.preventDefault();
        }, arguments); },
        __wbg_push_471a5b068a5295f6: function() { return logError(function (arg0, arg1) {
            const ret = arg0.push(arg1);
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_querySelector_8d395ebd237ebd46: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.querySelector(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_queueMicrotask_5d15a957e6aa920e: function() { return logError(function (arg0) {
            queueMicrotask(arg0);
        }, arguments); },
        __wbg_queueMicrotask_f8819e5ffc402f36: function() { return logError(function (arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        }, arguments); },
        __wbg_rect_23ab6daae0a2a799: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.rect(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_removeEventListener_7bdf07404d9b24bd: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_requestAnimationFrame_6f039d778639cc28: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.requestAnimationFrame(arg1);
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_resolve_e6c466bc1052f16c: function() { return logError(function (arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        }, arguments); },
        __wbg_restore_42cdb8bfdf76deac: function() { return logError(function (arg0) {
            arg0.restore();
        }, arguments); },
        __wbg_run_0b0a622deae25fda: function() { return logError(function (arg0, arg1, arg2) {
            try {
                var state0 = {a: arg1, b: arg2};
                var cb0 = () => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h7db44ed1d636d6ee(a, state0.b, );
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = arg0.run(cb0);
                _assertBoolean(ret);
                return ret;
            } finally {
                state0.a = 0;
            }
        }, arguments); },
        __wbg_save_ba600b0595ba2d8c: function() { return logError(function (arg0) {
            arg0.save();
        }, arguments); },
        __wbg_setAttribute_6fde4098d274155c: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setAttribute(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setProperty_0d903d23a71dfe70: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setProperty(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_set_022bee52d0b05b19: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_set_fillStyle_0576080e32ad721b: function() { return logError(function (arg0, arg1, arg2) {
            arg0.fillStyle = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_font_a19f1499878e7211: function() { return logError(function (arg0, arg1, arg2) {
            arg0.font = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_height_24d07d982f176ac6: function() { return logError(function (arg0, arg1) {
            arg0.height = arg1 >>> 0;
        }, arguments); },
        __wbg_set_height_be9b2b920bd68401: function() { return logError(function (arg0, arg1) {
            arg0.height = arg1 >>> 0;
        }, arguments); },
        __wbg_set_textAlign_01d9d4dc03a75858: function() { return logError(function (arg0, arg1, arg2) {
            arg0.textAlign = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_textBaseline_2b18db1816710f31: function() { return logError(function (arg0, arg1, arg2) {
            arg0.textBaseline = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_width_5cda41d4d06a14dd: function() { return logError(function (arg0, arg1) {
            arg0.width = arg1 >>> 0;
        }, arguments); },
        __wbg_shaderSource_084cd6ed337b36be: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.shaderSource(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_shaderSource_9b5906e1f027a314: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.shaderSource(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_shiftKey_dcf8ee699c273ed2: function() { return logError(function (arg0) {
            const ret = arg0.shiftKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_shiftKey_e483c13c966878f6: function() { return logError(function (arg0) {
            const ret = arg0.shiftKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_stack_3b0d974bbf31e44f: function() { return logError(function (arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_static_accessor_CREATE_TASK_f3ab6a6954bda493: function() { return logError(function () {
            const ret = typeof console === 'undefined' ? null : console?.createTask;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_GLOBAL_8cfadc87a297ca02: function() { return logError(function () {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_GLOBAL_THIS_602256ae5c8f42cf: function() { return logError(function () {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_SELF_e445c1c7484aecc3: function() { return logError(function () {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_WINDOW_f20e8576ef1e0f17: function() { return logError(function () {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_style_c331a9f6564f8f62: function() { return logError(function (arg0) {
            const ret = arg0.style;
            return ret;
        }, arguments); },
        __wbg_terminaldebugapi_new: function() { return logError(function (arg0) {
            const ret = TerminalDebugApi.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbg_texParameteri_83c7801427720baa: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.texParameteri(arg1 >>> 0, arg2 >>> 0, arg3);
        }, arguments); },
        __wbg_texParameteri_bc24667dff936ebd: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.texParameteri(arg1 >>> 0, arg2 >>> 0, arg3);
        }, arguments); },
        __wbg_texStorage3D_645d2a06d38f0291: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.texStorage3D(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5, arg6);
        }, arguments); },
        __wbg_texSubImage3D_5e37ae4a691b540a: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
            arg0.texSubImage3D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9 >>> 0, arg10 >>> 0, arg11);
        }, arguments); },
        __wbg_texSubImage3D_c572dcb916b31c0d: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
            arg0.texSubImage3D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9 >>> 0, arg10 >>> 0, arg11);
        }, arguments); },
        __wbg_then_792e0c862b060889: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_then_8e16ee11f05e4827: function() { return logError(function (arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        }, arguments); },
        __wbg_type_37ad6e505f20fc7e: function() { return logError(function (arg0, arg1) {
            const ret = arg1.type;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_uniform1i_bde3c7d92bc444b2: function() { return logError(function (arg0, arg1, arg2) {
            arg0.uniform1i(arg1, arg2);
        }, arguments); },
        __wbg_uniform1i_cfd4726efd9d58b4: function() { return logError(function (arg0, arg1, arg2) {
            arg0.uniform1i(arg1, arg2);
        }, arguments); },
        __wbg_uniformBlockBinding_937f5d284b5d4fca: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.uniformBlockBinding(arg1, arg2 >>> 0, arg3 >>> 0);
        }, arguments); },
        __wbg_useProgram_6403314e6307ff8f: function() { return logError(function (arg0, arg1) {
            arg0.useProgram(arg1);
        }, arguments); },
        __wbg_useProgram_b0607e62e147410b: function() { return logError(function (arg0, arg1) {
            arg0.useProgram(arg1);
        }, arguments); },
        __wbg_vertexAttribDivisorANGLE_49500429f99e1d27: function() { return logError(function (arg0, arg1, arg2) {
            arg0.vertexAttribDivisorANGLE(arg1 >>> 0, arg2 >>> 0);
        }, arguments); },
        __wbg_vertexAttribDivisor_406c4f2dab66050b: function() { return logError(function (arg0, arg1, arg2) {
            arg0.vertexAttribDivisor(arg1 >>> 0, arg2 >>> 0);
        }, arguments); },
        __wbg_vertexAttribIPointer_a64fdd378b987c16: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.vertexAttribIPointer(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5);
        }, arguments); },
        __wbg_vertexAttribPointer_89754c61239e5837: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.vertexAttribPointer(arg1 >>> 0, arg2, arg3 >>> 0, arg4 !== 0, arg5, arg6);
        }, arguments); },
        __wbg_vertexAttribPointer_dfec25e05e323ba4: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.vertexAttribPointer(arg1 >>> 0, arg2, arg3 >>> 0, arg4 !== 0, arg5, arg6);
        }, arguments); },
        __wbg_viewport_325ef6f6b074c24f: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.viewport(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_viewport_b1858453ab05f289: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.viewport(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_width_3aacf063073c2757: function() { return logError(function (arg0) {
            const ret = arg0.width;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_width_5adcb07d04d08bdf: function() { return logError(function (arg0) {
            const ret = arg0.width;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_writeText_41e0b9b209591a06: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.writeText(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000001: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 244, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h377d7e57b67ae0fe);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000002: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("KeyboardEvent")], shim_idx: 6, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hd2babd936d9c42bc);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000003: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MouseEvent")], shim_idx: 49, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc77a8aae5fb40541);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000004: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("WebGLContextEvent")], shim_idx: 48, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc71028cbf62df56c);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000005: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 5, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h2d699dbd6e0eab40);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000006: function() { return logError(function (arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000007: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(F32)) -> NamedExternref("Float32Array")`.
            const ret = getArrayF32FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000008: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I16)) -> NamedExternref("Int16Array")`.
            const ret = getArrayI16FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000009: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I32)) -> NamedExternref("Int32Array")`.
            const ret = getArrayI32FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000a: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I8)) -> NamedExternref("Int8Array")`.
            const ret = getArrayI8FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000b: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U16)) -> NamedExternref("Uint16Array")`.
            const ret = getArrayU16FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000c: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U32)) -> NamedExternref("Uint32Array")`.
            const ret = getArrayU32FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000d: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000e: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rathole_bg.js": import0,
    };
}


//#endregion
function wasm_bindgen__convert__closures_____invoke__h2d699dbd6e0eab40(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h2d699dbd6e0eab40(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h7db44ed1d636d6ee(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h7db44ed1d636d6ee(arg0, arg1);
    return ret !== 0;
}

function wasm_bindgen__convert__closures_____invoke__hd2babd936d9c42bc(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hd2babd936d9c42bc(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hc77a8aae5fb40541(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hc77a8aae5fb40541(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hc71028cbf62df56c(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hc71028cbf62df56c(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h377d7e57b67ae0fe(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h377d7e57b67ae0fe(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

const TerminalDebugApiFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_terminaldebugapi_free(ptr >>> 0, 1));


//#region intrinsics
function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertBoolean(n) {
    if (typeof(n) !== 'boolean') {
        throw new Error(`expected a boolean argument, found ${typeof(n)}`);
    }
}

function _assertNum(n) {
    if (typeof(n) !== 'number') throw new Error(`expected a number argument, found ${typeof(n)}`);
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedInt16ArrayMemory0 = null;
function getInt16ArrayMemory0() {
    if (cachedInt16ArrayMemory0 === null || cachedInt16ArrayMemory0.byteLength === 0) {
        cachedInt16ArrayMemory0 = new Int16Array(wasm.memory.buffer);
    }
    return cachedInt16ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

let cachedInt8ArrayMemory0 = null;
function getInt8ArrayMemory0() {
    if (cachedInt8ArrayMemory0 === null || cachedInt8ArrayMemory0.byteLength === 0) {
        cachedInt8ArrayMemory0 = new Int8Array(wasm.memory.buffer);
    }
    return cachedInt8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function logError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        let error = (function () {
            try {
                return e instanceof Error ? `${e.message}\n\nStack:\n${e.stack}` : e.toString();
            } catch(_) {
                return "<failed to stringify thrown value>";
            }
        }());
        console.error("wasm-bindgen: imported JS function that was not marked as `catch` threw an error:", error);
        throw e;
    }
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (typeof(arg) !== 'string') throw new Error(`expected a string argument, found ${typeof(arg)}`);
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);
        if (ret.read !== arg.length) throw new Error('failed to pass whole string');
        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


//#endregion

//#region wasm loading
let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedInt16ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedInt8ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rathole_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
//#endregion
export { wasm as __wasm }
