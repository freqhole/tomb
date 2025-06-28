/**
 * Blob Viewer Component
 *
 * Displays uploaded blobs/files fetched from the blob API.
 * Supports images, videos, audio, text, and provides download functionality.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, Show, onCleanup } from "solid-js";
import { BlobClient, type BlobViewerInfo, BlobError } from "../lib/index.js";

export interface BlobViewerProps {
  /** Blob ID to display */
  blobId?: string;
  /** Base URL for blob API (default: current origin) */
  baseUrl?: string;
  /** Maximum width for display (default: 100%) */
  maxWidth?: string;
  /** Maximum height for display (default: 400px) */
  maxHeight?: string;
  /** Show metadata information */
  showMetadata?: boolean;
  /** Enable download button */
  enableDownload?: boolean;
  /** Auto-load blob when blobId changes */
  autoLoad?: boolean;
}

const BlobViewer = (props: BlobViewerProps) => {
  const [blobInfo, setBlobInfo] = createSignal<BlobViewerInfo | null>(null);
  const [blobUrl, setBlobUrl] = createSignal<string | null>(null);
  const [textContent, setTextContent] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const blobClient = new BlobClient({
    baseUrl: props.baseUrl || window.location.origin,
  });

  const maxWidth = () => props.maxWidth || "100%";
  const maxHeight = () => props.maxHeight || "400px";

  // Load blob when blobId changes
  createEffect(() => {
    if (props.blobId && (props.autoLoad ?? true)) {
      loadBlob(props.blobId);
    }
  });

  // Cleanup blob URL when component unmounts
  onCleanup(() => {
    const url = blobUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  });

  const loadBlob = async (id: string) => {
    if (!id) return;

    setLoading(true);
    setError(null);
    setBlobInfo(null);
    setBlobUrl(null);
    setTextContent(null);

    try {
      // Get blob metadata first
      const info = await blobClient.getBlobInfo(id);
      setBlobInfo(info);

      // Create blob URL for media types
      if (info.is_image || info.is_video || info.is_audio) {
        const url = await blobClient.createBlobUrl(id);
        setBlobUrl(url);
      }
      // Load text content for text types
      else if (info.is_text && (info.size || 0) < 1024 * 1024) {
        // Only load text files under 1MB
        const text = await blobClient.getBlobText(id);
        setTextContent(text);
      }
    } catch (err) {
      if (err instanceof BlobError) {
        setError(`${err.type}: ${err.message}`);
      } else {
        setError(`Error loading blob: ${err}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const downloadBlob = async () => {
    const info = blobInfo();
    if (!info) return;

    try {
      await blobClient.downloadBlob(info.id, info.display_name);
    } catch (err) {
      setError(`Download failed: ${err}`);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const renderContent = () => {
    const info = blobInfo();
    const url = blobUrl();
    const text = textContent();

    if (!info) return null;

    // Image display
    if (info.is_image && url) {
      return (
        <img
          src={url}
          alt={info.display_name}
          style={{
            "max-width": maxWidth(),
            "max-height": maxHeight(),
            "object-fit": "contain",
            "border-radius": "4px",
          }}
          onError={() => setError("Failed to load image")}
        />
      );
    }

    // Video display
    if (info.is_video && url) {
      return (
        <video
          src={url}
          controls
          style={{
            "max-width": maxWidth(),
            "max-height": maxHeight(),
          }}
          onError={() => setError("Failed to load video")}
        >
          Your browser does not support video playback.
        </video>
      );
    }

    // Audio display
    if (info.is_audio && url) {
      return (
        <div>
          <audio
            src={url}
            controls
            style={{ width: "100%" }}
            onError={() => setError("Failed to load audio")}
          >
            Your browser does not support audio playback.
          </audio>
        </div>
      );
    }

    // Text display
    if (info.is_text && text) {
      return (
        <pre
          style={{
            "background-color": "#f5f5f5",
            padding: "1rem",
            "border-radius": "4px",
            "white-space": "pre-wrap",
            "word-wrap": "break-word",
            "max-height": maxHeight(),
            overflow: "auto",
            "font-family": "monospace",
            "font-size": "0.9rem",
            border: "1px solid #ddd",
          }}
        >
          {text}
        </pre>
      );
    }

    // Generic file display
    return (
      <div
        style={{
          padding: "2rem",
          "text-align": "center",
          border: "2px dashed #ccc",
          "border-radius": "8px",
          "background-color": "#f9f9f9",
        }}
      >
        <div style={{ "font-size": "3rem", "margin-bottom": "1rem" }}>📄</div>
        <div style={{ "font-weight": "bold", "margin-bottom": "0.5rem" }}>
          {info.display_name}
        </div>
        <div style={{ color: "#666", "font-size": "0.9rem" }}>
          {info.mime_type || "Unknown type"} • {info.formatted_size}
        </div>
      </div>
    );
  };

  return (
    <div style={{ width: "100%" }}>
      {/* Manual load button if autoLoad is false */}
      <Show when={!props.autoLoad && props.blobId}>
        <button
          onClick={() => loadBlob(props.blobId!)}
          disabled={loading()}
          style={{
            padding: "0.5rem 1rem",
            "margin-bottom": "1rem",
            "background-color": "#007bff",
            color: "white",
            border: "none",
            "border-radius": "4px",
            cursor: loading() ? "not-allowed" : "pointer",
          }}
        >
          {loading() ? "Loading..." : "Load Blob"}
        </button>
      </Show>

      {/* Loading state */}
      <Show when={loading()}>
        <div
          style={{
            padding: "2rem",
            "text-align": "center",
            color: "#666",
          }}
        >
          <div>Loading blob...</div>
        </div>
      </Show>

      {/* Error state */}
      <Show when={error()}>
        <div
          style={{
            padding: "1rem",
            "background-color": "#f8d7da",
            color: "#721c24",
            border: "1px solid #f5c6cb",
            "border-radius": "4px",
            "margin-bottom": "1rem",
          }}
        >
          <strong>Error:</strong> {error()}
        </div>
      </Show>

      {/* Blob content */}
      <Show when={blobInfo() && !loading() && !error()}>
        <div style={{ "margin-bottom": "1rem" }}>{renderContent()}</div>

        {/* Metadata section */}
        <Show when={props.showMetadata}>
          <div
            style={{
              "background-color": "#f8f9fa",
              padding: "1rem",
              "border-radius": "4px",
              border: "1px solid #dee2e6",
              "font-size": "0.9rem",
            }}
          >
            <h4 style={{ margin: "0 0 0.5rem 0" }}>Metadata</h4>
            <div>
              <strong>ID:</strong>{" "}
              <code style={{ "font-size": "0.8rem" }}>{blobInfo()?.id}</code>
            </div>
            <div>
              <strong>Size:</strong> {blobInfo()?.formatted_size}
            </div>
            <div>
              <strong>Type:</strong> {blobInfo()?.mime_type || "Unknown"}
            </div>
            <Show when={blobInfo()?.file_extension}>
              <div>
                <strong>Extension:</strong> .{blobInfo()?.file_extension}
              </div>
            </Show>
            <div>
              <strong>Created:</strong>{" "}
              {formatDate(blobInfo()?.created_at || "")}
            </div>
            <div>
              <strong>SHA256:</strong>{" "}
              <code
                style={{ "font-size": "0.8rem", "word-break": "break-all" }}
              >
                {blobInfo()?.sha256}
              </code>
            </div>
            <Show when={blobInfo()?.local_path}>
              <div>
                <strong>Local Path:</strong>{" "}
                <code style={{ "font-size": "0.8rem" }}>
                  {blobInfo()?.local_path}
                </code>
              </div>
            </Show>
          </div>
        </Show>

        {/* Download button */}
        <Show when={props.enableDownload}>
          <button
            onClick={downloadBlob}
            style={{
              padding: "0.5rem 1rem",
              "margin-top": "1rem",
              "background-color": "#28a745",
              color: "white",
              border: "none",
              "border-radius": "4px",
              cursor: "pointer",
            }}
          >
            📥 Download {blobInfo()?.display_name}
          </button>
        </Show>
      </Show>
    </div>
  );
};

// Custom element registration
customElement(
  "blob-viewer",
  {
    blobId: undefined,
    baseUrl: undefined,
    maxWidth: "100%",
    maxHeight: "400px",
    showMetadata: false,
    enableDownload: true,
    autoLoad: true,
  },
  BlobViewer
);

export default BlobViewer;

// TypeScript declaration for JSX
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "blob-viewer": BlobViewerProps & {
        children?: any;
      };
    }
  }
}
