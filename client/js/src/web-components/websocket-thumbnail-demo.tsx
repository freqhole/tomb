/**
 * WebSocket Binary Data Demo
 *
 * A standalone demo component that shows how thumbnail binary data is fetched
 * through WebSocket and rendered as images. This demonstrates the exact
 * pattern used by the thumbnail system for small binary data transfer.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { WebSocketClient, ConnectionStatus } from "../lib/websocket-client.js";
import type { MediaBlob } from "../lib/websocket-types.js";
import { SyncStorageManager } from "../sync-legacy/sync-storage.js";

export interface WebSocketThumbnailDemoProps {
  /** WebSocket URL (default: ws://localhost:8080/ws) */
  wsUrl?: string;
  /** API base URL for fallback HTTP requests */
  apiBaseUrl?: string;
  /** Demo title */
  title?: string;
}

function WebSocketThumbnailDemoComponent(props: WebSocketThumbnailDemoProps) {
  const [client, setClient] = createSignal<WebSocketClient | null>(null);
  const [isConnected, setIsConnected] = createSignal(false);
  const [mediaBlobs, setMediaBlobs] = createSignal<MediaBlob[]>([]);
  const [binaryData, setBinaryData] = createSignal<Map<string, string>>(
    new Map()
  );
  const [logs, setLogs] = createSignal<string[]>([]);
  const [requestedThumbnails, setRequestedThumbnails] = createSignal<
    Set<string>
  >(new Set());
  const [thumbnailMapping, setThumbnailMapping] = createSignal<
    Map<string, string>
  >(new Map());
  const [isSearching, setIsSearching] = createSignal(false);
  const [totalFetched, setTotalFetched] = createSignal(0);
  const [showAllBlobs, setShowAllBlobs] = createSignal(false);
  const [cachedImages, setCachedImages] = createSignal<
    Array<{ id: string; url: string; mime: string; size: number }>
  >([]);

  const wsUrl = () => props.wsUrl || "ws://localhost:8080/ws";
  const title = () => props.title || "WebSocket Thumbnail Demo";

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-19), `[${timestamp}] ${message}`]);
  };

  // Load cached images from IndexedDB
  const loadCachedImages = async () => {
    try {
      const storage = new SyncStorageManager();
      await storage.initialize();

      // Get all binary data entries
      const binaryData = await storage.getAllBinaryData();

      const images = binaryData.map((item) => {
        const blob = new Blob([item.data], { type: item.mime });
        const url = URL.createObjectURL(blob);
        return {
          id: item.id,
          url,
          mime: item.mime,
          size: item.data.byteLength,
        };
      });

      setCachedImages(images);
      addLog(`Loaded ${images.length} cached images from IndexedDB`);
    } catch (error) {
      addLog(`Error accessing IndexedDB: ${error}`);
    }
  };

  // Helper function to create data URL from binary data array
  const createDataUrl = (data: number[], mimeType: string): string => {
    const uint8Array = new Uint8Array(data);
    const blob = new Blob([uint8Array], { type: mimeType });
    return URL.createObjectURL(blob);
  };

  const connectWebSocket = async () => {
    try {
      const wsClient = new WebSocketClient({
        url: wsUrl(),
        autoReconnect: true,
        reconnectDelay: 3000,
        maxReconnectAttempts: 5,
      });

      // Connection events
      wsClient.on("statusChange", (status) => {
        setIsConnected(status === ConnectionStatus.Connected);
        addLog(`WebSocket status: ${status}`);
      });

      // Media blobs list received
      wsClient.on("mediaBlobs", (data) => {
        const newBlobs = data.blobs;
        setMediaBlobs((prev) => [...prev, ...newBlobs]);
        setTotalFetched((prev) => prev + newBlobs.length);

        // Debug specific blob IDs you mentioned
        const targetBlobs = newBlobs.filter(
          (blob) =>
            blob.id.startsWith("f169f32") || blob.id.startsWith("b8b7060")
        );
        if (targetBlobs.length > 0) {
          targetBlobs.forEach((blob) => {
            addLog(`🔍 Found target blob ${blob.id}:`);
            addLog(`   metadata: ${JSON.stringify(blob.metadata)}`);
            addLog(`   mime: ${blob.mime}`);
            addLog(`   has_thumbnails: ${blob.metadata?.has_thumbnails}`);
            addLog(`   metadata.thumbnails: ${blob.metadata?.thumbnails}`);
            addLog(`   is image by mime: ${blob.mime?.startsWith("image/")}`);
            addLog(
              `   is image by filename: ${blob.metadata?.originalName?.includes(".jpg")}`
            );
          });
        }

        // Log some sample metadata to see the structure
        if (newBlobs.length > 0) {
          const sampleBlob = newBlobs[0];
          addLog(
            `📋 Sample metadata structure for ${sampleBlob.id.slice(0, 8)}:`
          );
          addLog(`   mime: ${sampleBlob.mime}`);
          addLog(`   ${JSON.stringify(sampleBlob.metadata, null, 2)}`);
        }

        // More flexible thumbnail detection - include audio files that might have album art
        const thumbnailBlobs = newBlobs.filter((blob) => {
          const hasFlag = blob.metadata?.has_thumbnails === true;
          const isImageMime = blob.mime?.startsWith("image/");
          const isAudioMime = blob.mime?.startsWith("audio/");
          const hasThumbsArray =
            blob.metadata?.thumbnails && blob.metadata.thumbnails.length > 0;
          const isImageFile = blob.metadata?.originalName?.match(
            /\.(jpg|jpeg|png|gif|webp)$/i
          );
          const isAudioFile =
            blob.metadata?.originalName?.match(
              /\.(mp3|flac|wav|m4a|aac|ogg)$/i
            ) ||
            blob.metadata?.filename?.match(/\.(mp3|flac|wav|m4a|aac|ogg)$/i);

          const result =
            hasFlag ||
            isImageMime ||
            isAudioMime ||
            hasThumbsArray ||
            isImageFile ||
            isAudioFile;

          if (result) {
            addLog(
              `   ✅ ${blob.id.slice(0, 8)} qualified: flag=${hasFlag}, imageMime=${isImageMime}, audioMime=${isAudioMime}, array=${hasThumbsArray}, imageFile=${isImageFile}, audioFile=${isAudioFile}`
            );
          }

          return result;
        });

        addLog(
          `Received ${newBlobs.length} media blobs (${thumbnailBlobs.length} with thumbnails)`
        );

        // Log which blobs are being filtered out
        newBlobs.forEach((blob) => {
          const hasFlag = blob.metadata?.has_thumbnails === true;
          const isImageMime = blob.mime?.startsWith("image/");
          const isAudioMime = blob.mime?.startsWith("audio/");
          const hasThumbsArray =
            blob.metadata?.thumbnails && blob.metadata.thumbnails.length > 0;
          const isImageFile = blob.metadata?.originalName?.match(
            /\.(jpg|jpeg|png|gif|webp)$/i
          );
          const isAudioFile =
            blob.metadata?.originalName?.match(
              /\.(mp3|flac|wav|m4a|aac|ogg)$/i
            ) ||
            blob.metadata?.filename?.match(/\.(mp3|flac|wav|m4a|aac|ogg)$/i);

          const qualified =
            hasFlag ||
            isImageMime ||
            isAudioMime ||
            hasThumbsArray ||
            isImageFile ||
            isAudioFile;

          if (!qualified) {
            addLog(
              `❌ ${blob.id.slice(0, 8)} filtered out: mime="${blob.mime}", filename="${blob.metadata?.originalName || blob.metadata?.filename}"`
            );
          }
        });

        // If we're searching and didn't find enough thumbnail blobs, keep searching
        if (
          isSearching() &&
          thumbnailBlobs.length < 5 &&
          data.blobs.length > 0
        ) {
          setTimeout(() => {
            const wsClient = client();
            if (wsClient && isConnected()) {
              wsClient.getMediaBlobs(50, totalFetched());
              addLog(
                `Searching for more thumbnails... (total fetched: ${totalFetched()})`
              );
            }
          }, 500); // Small delay to avoid overwhelming the server
        } else if (isSearching()) {
          setIsSearching(false);
          addLog(
            `Search complete! Found ${mediaBlobs().filter((blob) => blob.metadata?.has_thumbnails === true).length} blobs with thumbnails`
          );
        }
      });

      // Thumbnails received (this is the main focus of this demo!)
      wsClient.on("thumbnails", (data) => {
        addLog(`Received thumbnails for ${data.media_blob_id}`);

        // Process each thumbnail
        data.thumbnails.forEach((thumbnail) => {
          if (thumbnail.data && thumbnail.data.length > 0) {
            const mimeType = thumbnail.mime || "image/webp";
            const blobUrl = createDataUrl(thumbnail.data, mimeType);

            // Map the thumbnail to the original blob ID (this is the key fix!)
            setBinaryData((prev) =>
              new Map(prev).set(data.media_blob_id, blobUrl)
            );
            setThumbnailMapping((prev) =>
              new Map(prev).set(data.media_blob_id, thumbnail.id)
            );
            addLog(
              `Created thumbnail URL for ${data.media_blob_id}: ${thumbnail.id}`
            );
          }
        });
      });

      wsClient.on("error", (data) => {
        addLog(`WebSocket error: ${data.message}`);
      });

      await wsClient.connect();
      setClient(wsClient);
      addLog("WebSocket client initialized");
    } catch (error) {
      addLog(
        `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  };

  const disconnect = () => {
    const wsClient = client();
    if (wsClient) {
      wsClient.disconnect();
      setClient(null);
      setIsConnected(false);
      addLog("Disconnected");
    }
  };

  const loadMediaBlobs = () => {
    const wsClient = client();
    if (wsClient && isConnected()) {
      // Reset state for new search
      setMediaBlobs([]);
      setTotalFetched(0);
      setIsSearching(true);

      wsClient.getMediaBlobs(50, 0);
      addLog("Searching for media blobs with thumbnails...");
    } else {
      addLog("Not connected to WebSocket");
    }
  };

  const loadMoreBlobs = () => {
    const wsClient = client();
    if (wsClient && isConnected()) {
      wsClient.getMediaBlobs(50, totalFetched());
      addLog(`Loading more blobs... (offset: ${totalFetched()})`);
    } else {
      addLog("Not connected to WebSocket");
    }
  };

  const requestThumbnails = (blobId: string) => {
    const wsClient = client();
    if (wsClient && isConnected()) {
      wsClient.getThumbnails(blobId);
      setRequestedThumbnails((prev) => new Set([...prev, blobId]));
      addLog(`Requesting thumbnails for ${blobId}...`);
    } else {
      addLog("Not connected to WebSocket");
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const clearThumbnailData = () => {
    // Revoke all blob URLs to free memory
    binaryData().forEach((url) => URL.revokeObjectURL(url));
    setBinaryData(new Map());
    setThumbnailMapping(new Map());
    addLog("Cleared all thumbnail data");
  };

  onMount(() => {
    addLog("Demo initialized");
    loadCachedImages();
  });

  onCleanup(() => {
    disconnect();
    // Clean up blob URLs
    binaryData().forEach((url) => URL.revokeObjectURL(url));
  });

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: "20px",
        maxWidth: "1400px",
        margin: "0 auto",
        backgroundColor: "#0f172a",
        minHeight: "100vh",
        color: "#e2e8f0",
      }}
    >
      <h1
        style={{
          margin: "0 0 20px 0",
          fontSize: "24px",
          fontWeight: "700",
          color: "#f8fafc",
        }}
      >
        {title()}
      </h1>

      {/* Cached Images Display */}
      <div
        style={{
          backgroundColor: "#1e293b",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #334155",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <h3 style={{ margin: "0", fontSize: "16px", color: "#f1f5f9" }}>
            🖼️ Cached Images from IndexedDB
          </h3>
          <button
            onClick={loadCachedImages}
            style={{
              padding: "6px 12px",
              borderRadius: "4px",
              border: "1px solid #3b82f6",
              backgroundColor: "#3b82f6",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Refresh
          </button>
        </div>

        <Show when={cachedImages().length === 0}>
          <p style={{ color: "#94a3b8", margin: "0" }}>
            No cached images found. Click "Refresh" to load from IndexedDB.
          </p>
        </Show>

        <Show when={cachedImages().length > 0}>
          <p style={{ color: "#94a3b8", margin: "0 0 12px 0" }}>
            Found {cachedImages().length} cached images
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "12px",
            }}
          >
            <For each={cachedImages()}>
              {(image) => (
                <div
                  style={{
                    backgroundColor: "#334155",
                    padding: "8px",
                    borderRadius: "6px",
                    textAlign: "center",
                  }}
                >
                  <img
                    src={image.url}
                    alt={`Cached ${image.id}`}
                    style={{
                      width: "100%",
                      height: "80px",
                      objectFit: "cover",
                      borderRadius: "4px",
                      marginBottom: "6px",
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                    {image.id.slice(0, 8)}
                  </div>
                  <div style={{ fontSize: "9px", color: "#64748b" }}>
                    {Math.round(image.size / 1024)}KB
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        {/* Connection Controls */}
        <div
          style={{
            backgroundColor: "#1e293b",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #334155",
          }}
        >
          <h3
            style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#f1f5f9" }}
          >
            🔌 WebSocket Connection
          </h3>

          <div style={{ marginBottom: "12px" }}>
            <strong>URL:</strong> {wsUrl()}
          </div>

          <div style={{ marginBottom: "12px" }}>
            <strong>Status:</strong>
            <span
              style={{
                color: isConnected() ? "#10b981" : "#ef4444",
                marginLeft: "8px",
              }}
            >
              {isConnected() ? "🟢 Connected" : "🔴 Disconnected"}
            </span>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Show when={!client()}>
              <button
                onClick={connectWebSocket}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #3b82f6",
                  backgroundColor: "#3b82f6",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Connect
              </button>
            </Show>

            <Show when={client()}>
              <button
                onClick={disconnect}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #ef4444",
                  backgroundColor: "#ef4444",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Disconnect
              </button>
            </Show>
          </div>
        </div>

        {/* Data Controls */}
        <div
          style={{
            backgroundColor: "#1e293b",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #334155",
          }}
        >
          <h3
            style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#f1f5f9" }}
          >
            🖼️ Thumbnail Operations
          </h3>

          <div style={{ marginBottom: "12px" }}>
            <strong>Media Blobs:</strong> {mediaBlobs().length} total,{" "}
            {
              mediaBlobs().filter((blob) => {
                const hasFlag = blob.metadata?.has_thumbnails === true;
                const isImageMime = blob.mime?.startsWith("image/");
                const isAudioMime = blob.mime?.startsWith("audio/");
                const hasThumbsArray =
                  blob.metadata?.thumbnails &&
                  blob.metadata.thumbnails.length > 0;
                const isImageFile = blob.metadata?.originalName?.match(
                  /\.(jpg|jpeg|png|gif|webp)$/i
                );
                const isAudioFile =
                  blob.metadata?.originalName?.match(
                    /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                  ) ||
                  blob.metadata?.filename?.match(
                    /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                  );
                return (
                  hasFlag ||
                  isImageMime ||
                  isAudioMime ||
                  hasThumbsArray ||
                  isImageFile ||
                  isAudioFile
                );
              }).length
            }{" "}
            with potential thumbnails
          </div>

          <div style={{ marginBottom: "12px" }}>
            <strong>Thumbnail Data:</strong> {binaryData().size} items
          </div>

          <div style={{ marginBottom: "12px" }}>
            <strong>Search Status:</strong>{" "}
            {isSearching() ? "🔍 Searching..." : "✅ Ready"}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={loadMediaBlobs}
              disabled={!isConnected() || isSearching()}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #10b981",
                backgroundColor:
                  !isConnected() || isSearching() ? "#9ca3af" : "#10b981",
                color: "#ffffff",
                cursor:
                  !isConnected() || isSearching() ? "not-allowed" : "pointer",
                fontSize: "12px",
              }}
            >
              {isSearching() ? "Searching..." : "Find Thumbnails"}
            </button>

            <button
              onClick={loadMoreBlobs}
              disabled={
                !isConnected() || isSearching() || mediaBlobs().length === 0
              }
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #3b82f6",
                backgroundColor:
                  !isConnected() || isSearching() || mediaBlobs().length === 0
                    ? "#9ca3af"
                    : "#3b82f6",
                color: "#ffffff",
                cursor:
                  !isConnected() || isSearching() || mediaBlobs().length === 0
                    ? "not-allowed"
                    : "pointer",
                fontSize: "12px",
              }}
            >
              Load More
            </button>

            <button
              onClick={clearThumbnailData}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #f59e0b",
                backgroundColor: "#f59e0b",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Clear Thumbnails
            </button>

            <button
              onClick={() => setShowAllBlobs(!showAllBlobs())}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #8b5cf6",
                backgroundColor: showAllBlobs() ? "#8b5cf6" : "#334155",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {showAllBlobs() ? "Show Filtered" : "Show All"}
            </button>
          </div>
        </div>
      </div>

      {/* Media Blobs Grid */}
      <Show when={mediaBlobs().length > 0}>
        <div
          style={{
            backgroundColor: "#1e293b",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #334155",
            marginBottom: "20px",
          }}
        >
          <h3
            style={{ margin: "0 0 16px 0", fontSize: "16px", color: "#f1f5f9" }}
          >
            🎯 {showAllBlobs() ? "All" : "Filtered"} Media Blobs (
            {mediaBlobs().length} total,{" "}
            {
              mediaBlobs().filter((blob) => {
                const hasFlag = blob.metadata?.has_thumbnails === true;
                const isImageMime = blob.mime?.startsWith("image/");
                const isAudioMime = blob.mime?.startsWith("audio/");
                const hasThumbsArray =
                  blob.metadata?.thumbnails &&
                  blob.metadata.thumbnails.length > 0;
                const isImageFile = blob.metadata?.originalName?.match(
                  /\.(jpg|jpeg|png|gif|webp)$/i
                );
                const isAudioFile =
                  blob.metadata?.originalName?.match(
                    /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                  ) ||
                  blob.metadata?.filename?.match(
                    /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                  );
                return (
                  hasFlag ||
                  isImageMime ||
                  isAudioMime ||
                  hasThumbsArray ||
                  isImageFile ||
                  isAudioFile
                );
              }).length
            }{" "}
            with potential thumbnails)
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px",
              maxWidth: "100%",
            }}
          >
            <For
              each={(() => {
                if (showAllBlobs()) {
                  return mediaBlobs();
                }

                const filtered = mediaBlobs().filter((blob) => {
                  const hasFlag = blob.metadata?.has_thumbnails === true;
                  const isImageMime = blob.mime?.startsWith("image/");
                  const isAudioMime = blob.mime?.startsWith("audio/");
                  const hasThumbsArray =
                    blob.metadata?.thumbnails &&
                    blob.metadata.thumbnails.length > 0;
                  const isImageFile = blob.metadata?.originalName?.match(
                    /\.(jpg|jpeg|png|gif|webp)$/i
                  );
                  const isAudioFile =
                    blob.metadata?.originalName?.match(
                      /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                    ) ||
                    blob.metadata?.filename?.match(
                      /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                    );
                  return (
                    hasFlag ||
                    isImageMime ||
                    isAudioMime ||
                    hasThumbsArray ||
                    isImageFile ||
                    isAudioFile
                  );
                });

                return filtered;
              })()}
            >
              {(blob) => {
                const hasThumbnailData = () => binaryData().has(blob.id);
                const hasThumbnails = () => {
                  const hasFlag = blob.metadata?.has_thumbnails === true;
                  const isImageMime = blob.mime?.startsWith("image/");
                  const isAudioMime = blob.mime?.startsWith("audio/");
                  const hasThumbsArray =
                    blob.metadata?.thumbnails &&
                    blob.metadata.thumbnails.length > 0;
                  const isImageFile = blob.metadata?.originalName?.match(
                    /\.(jpg|jpeg|png|gif|webp)$/i
                  );
                  const isAudioFile =
                    blob.metadata?.originalName?.match(
                      /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                    ) ||
                    blob.metadata?.filename?.match(
                      /\.(mp3|flac|wav|m4a|aac|ogg)$/i
                    );
                  return (
                    hasFlag ||
                    isImageMime ||
                    isAudioMime ||
                    hasThumbsArray ||
                    isImageFile ||
                    isAudioFile
                  );
                };
                const isRequested = () => requestedThumbnails().has(blob.id);

                // Show all blobs for debugging, highlight the ones with thumbnails
                const isTargetBlob =
                  blob.id.startsWith("f169f32") ||
                  blob.id.startsWith("b8b7060");

                return (
                  <div
                    style={{
                      border: isTargetBlob
                        ? "2px solid #f59e0b"
                        : hasThumbnails()
                          ? "2px solid #10b981"
                          : "1px solid #475569",
                      borderRadius: "8px",
                      padding: "16px",
                      backgroundColor: isTargetBlob
                        ? "#451a03"
                        : hasThumbnails()
                          ? "#064e3b"
                          : "#334155",
                      maxWidth: "100%",
                      overflow: "hidden",
                    }}
                  >
                    {/* Preview */}
                    <div
                      style={{
                        width: "100%",
                        height: "160px",
                        backgroundColor: "#1e293b",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: "12px",
                        overflow: "hidden",
                        border: "1px solid #475569",
                      }}
                    >
                      <Show
                        when={hasThumbnailData()}
                        fallback={
                          <span style={{ fontSize: "32px", color: "#64748b" }}>
                            {blob.mime?.startsWith("image/")
                              ? "🖼️"
                              : blob.mime?.startsWith("audio/")
                                ? "🎵"
                                : blob.mime?.startsWith("video/")
                                  ? "🎬"
                                  : "📄"}
                          </span>
                        }
                      >
                        <img
                          src={binaryData().get(blob.id)}
                          alt={`Thumbnail for ${blob.id}`}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "cover",
                          }}
                          loading="lazy"
                        />
                      </Show>
                    </div>

                    {/* Info */}
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#94a3b8",
                        marginBottom: "12px",
                      }}
                    >
                      <div>
                        <strong>ID:</strong> {blob.id.slice(0, 8)}...
                        {isTargetBlob && (
                          <span
                            style={{ color: "#fbbf24", fontWeight: "bold" }}
                          >
                            {" "}
                            (TARGET)
                          </span>
                        )}
                      </div>
                      <div>
                        <strong>MIME:</strong> {blob.mime || "unknown"}
                      </div>
                      <div>
                        <strong>Size:</strong>{" "}
                        {blob.size
                          ? `${Math.round(blob.size / 1024)}KB`
                          : "unknown"}
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "#64748b",
                          wordBreak: "break-all",
                          maxHeight: "60px",
                          overflow: "hidden",
                        }}
                      >
                        <strong>Metadata:</strong>{" "}
                        {JSON.stringify(blob.metadata)}
                      </div>
                    </div>

                    {/* Status indicators */}
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        marginBottom: "8px",
                      }}
                    >
                      <Show when={hasThumbnails()}>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            backgroundColor: "#065f46",
                            color: "#a7f3d0",
                            borderRadius: "10px",
                          }}
                        >
                          {blob.metadata?.has_thumbnails === true
                            ? "Has Thumbnails"
                            : blob.mime?.startsWith("image/")
                              ? "Image File"
                              : blob.mime?.startsWith("audio/")
                                ? "Audio (album art)"
                                : "May have thumbnails"}
                        </span>
                      </Show>

                      <Show when={hasThumbnailData()}>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            backgroundColor: "#1e3a8a",
                            color: "#bfdbfe",
                            borderRadius: "10px",
                          }}
                        >
                          Thumbnail Loaded (
                          {thumbnailMapping().get(blob.id)?.slice(0, 7) ||
                            "unknown"}
                          )
                        </span>
                      </Show>

                      <Show when={isRequested() && !hasThumbnailData()}>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            backgroundColor: "#78350f",
                            color: "#fef3c7",
                            borderRadius: "10px",
                          }}
                        >
                          Loading...
                        </span>
                      </Show>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        onClick={() => requestThumbnails(blob.id)}
                        disabled={!isConnected() || isRequested()}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          fontSize: "12px",
                          borderRadius: "6px",
                          border: "1px solid #0891b2",
                          backgroundColor:
                            !isConnected() || isRequested()
                              ? "#475569"
                              : "#0891b2",
                          color:
                            !isConnected() || isRequested()
                              ? "#94a3b8"
                              : "#ffffff",
                          cursor:
                            !isConnected() || isRequested()
                              ? "not-allowed"
                              : "pointer",
                          fontWeight: "500",
                        }}
                      >
                        Get Thumbnails
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Activity Log */}
      <div
        style={{
          backgroundColor: "#1e293b",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #334155",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <h3 style={{ margin: "0", fontSize: "16px", color: "#f1f5f9" }}>
            📋 Activity Log
          </h3>
          <button
            onClick={clearLogs}
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              borderRadius: "4px",
              border: "1px solid #64748b",
              backgroundColor: "#334155",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>

        <div
          style={{
            maxHeight: "300px",
            overflowY: "auto",
            backgroundColor: "#0f172a",
            padding: "12px",
            borderRadius: "6px",
            border: "1px solid #475569",
            fontFamily: "Monaco, 'Cascadia Code', 'Roboto Mono', monospace",
            fontSize: "11px",
            lineHeight: "1.5",
            color: "#e2e8f0",
          }}
        >
          <Show
            when={logs().length > 0}
            fallback={
              <div style={{ color: "#64748b" }}>No activity yet...</div>
            }
          >
            <For each={logs()}>
              {(log) => <div style={{ marginBottom: "2px" }}>{log}</div>}
            </For>
          </Show>
        </div>
      </div>

      {/* Instructions */}
      <div
        style={{
          backgroundColor: "#1e293b",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #64748b",
          marginTop: "20px",
        }}
      >
        <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#cbd5e1" }}>
          💡 How to use this demo:
        </h4>
        <ol
          style={{
            margin: "0",
            paddingLeft: "20px",
            fontSize: "12px",
            color: "#94a3b8",
          }}
        >
          <li>Click "Connect" to establish WebSocket connection</li>
          <li>
            Click "Find Thumbnails" to automatically search for media blobs with
            thumbnails
          </li>
          <li>
            Use "Load More" if you need to fetch additional blobs manually
          </li>
          <li>
            Click "Get Thumbnails" to download thumbnail binary data via
            WebSocket
          </li>
          <li>Watch the Activity Log to see the WebSocket messages flow</li>
          <li>
            Thumbnail data (small binary) is converted to blob URLs and
            displayed
          </li>
          <li>This demonstrates the exact pattern used by the sync system</li>
        </ol>
      </div>
    </div>
  );
}

// Register the web component
customElement(
  "websocket-thumbnail-demo",
  {
    wsUrl: String,
    apiBaseUrl: String,
    title: String,
  },
  WebSocketThumbnailDemoComponent
);

export default WebSocketThumbnailDemoComponent;
