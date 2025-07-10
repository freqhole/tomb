import { render } from "solid-js/web";
import { Freqhole } from "./index";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

// Clear loading spinner
root.innerHTML = "";

// Render the app
render(() => <Freqhole />, root);
