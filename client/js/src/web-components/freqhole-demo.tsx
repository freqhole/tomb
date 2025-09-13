import { render } from "solid-js/web";
import Freqhole from "../views/freqhole/index";
import "../views/freqhole/styles.css";

class FreqholeDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("FreqholeDemoElement connected");

    // render the FreqholeDemo component
    this.dispose = render(() => <Freqhole />, this);

    console.log("FreqholeDemo render successful, connected!");
  }

  disconnectedCallback() {
    console.log("FreqholeDemoElement disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

// register the custom element
if (!customElements.get("freqhole-demo")) {
  customElements.define("freqhole-demo", FreqholeDemoElement);
}
