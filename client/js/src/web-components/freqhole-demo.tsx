import { render } from "solid-js/web";
import { FreqholeDemo } from "../views/freqhole-demo";

class FreqholeDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("🔌 FreqholeDemoElement connected");

    // Get attributes
    const wsUrl = this.getAttribute("ws-url") || "ws://localhost:8080/ws";
    const apiBaseUrl = this.getAttribute("api-base-url") || "http://localhost:8080";
    const autoConnect = this.getAttribute("auto-connect") === "true";

    // Render the FreqholeDemo component
    this.dispose = render(
      () => (
        <FreqholeDemo
          wsUrl={wsUrl}
          apiBaseUrl={apiBaseUrl}
          autoConnect={autoConnect}
        />
      ),
      this
    );

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
