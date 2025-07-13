import { render } from "solid-js/web";
import Freqhole from "../views/freqhole/index";

class FreqholeDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("🔌 FreqholeDemoElement connected");

    // Render the FreqholeDemo component
    this.dispose = render(() => <Freqhole />, this);

    console.log("✅ FreqholeDemo render successful");
  }

  disconnectedCallback() {
    console.log("🔌 FreqholeDemoElement disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

// Register the custom element
if (!customElements.get("freqhole-demo")) {
  console.log("📝 About to register freqhole-demo custom element");
  customElements.define("freqhole-demo", FreqholeDemoElement);
  console.log("✅ freqhole-demo custom element registered successfully");
} else {
  console.log("⚠️ freqhole-demo custom element already registered");
}
