/* @ts-self-types="./midden.d.ts" */

import * as wasm from "./midden_bg.wasm";
import { __wbg_set_wasm } from "./midden_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    BiStream, BlobResult, IntoUnderlyingByteSource, IntoUnderlyingSink, IntoUnderlyingSource, MiddenNode, UploadResult, start
} from "./midden_bg.js";
export { wasm as __wasm }
