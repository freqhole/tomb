/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { Playlistz } from "../views/playlistz/components/index.js";
import "../views/playlistz/styles.css";

interface PlaylistzWebComponentProps {
  // No props needed for this standalone component
}

function PlaylistzWebComponent(_props: PlaylistzWebComponentProps) {
  return <Playlistz />;
}

// Web component registration
customElements.define(
  "playlistz-app",
  class extends HTMLElement {
    connectedCallback() {
      render(() => <PlaylistzWebComponent />, this);
    }
  }
);
