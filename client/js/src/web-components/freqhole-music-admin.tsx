/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import FreqHoleMusicAdmin from "../views/freqhole-music-admin/index";

class FreqHoleMusicAdminElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("freqhole music admin element connected");

    // Get props from attributes
    const apiBaseUrl = this.getAttribute("api-base-url") || undefined;
    const theme = (this.getAttribute("theme") as "light" | "dark") || "dark";
    const authToken = this.getAttribute("auth-token") || undefined;
    const debug = this.getAttribute("debug") === "true";

    // Render the FreqHoleMusicAdmin component
    this.dispose = render(
      () => (
        <FreqHoleMusicAdmin
          apiBaseUrl={apiBaseUrl}
          theme={theme}
          authToken={authToken}
          debug={debug}
        />
      ),
      this
    );

    console.log("freqhole music admin render successful");
  }

  disconnectedCallback() {
    console.log("freqhole music admin element disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

// Register the custom element
if (!customElements.get("freqhole-music-admin")) {
  console.log("about to register freqhole-music-admin custom element");
  customElements.define("freqhole-music-admin", FreqHoleMusicAdminElement);
  console.log("freqhole-music-admin custom element registered successfully");
} else {
  console.log("freqhole-music-admin custom element already registered");
}
