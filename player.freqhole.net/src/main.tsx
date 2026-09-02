/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { registerTestBridge } from "./dev/testBridge";
import "./index.css";

registerTestBridge();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

render(() => <App />, root);
