//! iroh protocol handler for automerge document sync.
//!
//! implements `iroh::protocol::ProtocolHandler` to accept inbound connections
//! on the `iroh/automerge-repo/1` ALPN and route them to `hub_repo` for
//! processing JS automerge-repo v2.x sync messages.

use std::pin::Pin;
use std::task::{Context, Poll};

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::Endpoint;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// ALPN protocol identifier for automerge-repo sync over iroh.
pub const AUTOMERGE_REPO_ALPN: &[u8] = b"iroh/automerge-repo/1";

// ---------------------------------------------------------------------------
// LoggingIo — transparent AsyncRead + AsyncWrite wrapper that logs all I/O
// ---------------------------------------------------------------------------

/// wraps any AsyncRead + AsyncWrite and logs every read/write at info level.
/// used to diagnose whether the peer is actually sending/receiving data.
struct LoggingIo<T> {
    inner: T,
    label: String,
    total_read: std::sync::atomic::AtomicUsize,
    total_written: std::sync::atomic::AtomicUsize,
}

impl<T> LoggingIo<T> {
    fn new(inner: T, label: String) -> Self {
        Self {
            inner,
            label,
            total_read: std::sync::atomic::AtomicUsize::new(0),
            total_written: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for LoggingIo<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        match &result {
            Poll::Ready(Ok(())) => {
                let bytes_read = buf.filled().len() - before;
                if bytes_read > 0 {
                    let total = self
                        .total_read
                        .fetch_add(bytes_read, std::sync::atomic::Ordering::Relaxed)
                        + bytes_read;
                    // log first 64 bytes as hex for debugging wire format
                    let filled = buf.filled();
                    let preview_start = if before < filled.len() { before } else { 0 };
                    let preview_end = std::cmp::min(preview_start + 64, filled.len());
                    let preview: String = filled[preview_start..preview_end]
                        .iter()
                        .map(|b| format!("{:02x}", b))
                        .collect();
                    tracing::trace!(
                        label = %self.label,
                        bytes_read,
                        total_read = total,
                        preview = %preview,
                        "transport READ"
                    );
                }
            }
            Poll::Ready(Err(e)) => {
                tracing::warn!(
                    label = %self.label,
                    error = %e,
                    "transport READ error"
                );
            }
            Poll::Pending => {}
        }
        result
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for LoggingIo<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let result = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(n)) = &result {
            let total = self
                .total_written
                .fetch_add(*n, std::sync::atomic::Ordering::Relaxed)
                + n;
            // log first 64 bytes as hex
            let preview_end = std::cmp::min(64, buf.len());
            let preview: String = buf[..preview_end]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            tracing::trace!(
                label = %self.label,
                bytes_written = n,
                total_written = total,
                preview = %preview,
                "transport WRITE"
            );
        }
        result
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        tracing::debug!(label = %self.label, "transport SHUTDOWN");
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

// ---------------------------------------------------------------------------
// IrohRepo
// ---------------------------------------------------------------------------

/// iroh protocol handler backed by a hub_repo sync handler.
///
/// implements `ProtocolHandler` to accept inbound connections from other iroh
/// peers and routes them to `hub_repo` for automerge-repo v2.x sync.
#[derive(derive_more::Debug, Clone)]
pub struct IrohRepo {
    /// kept for future outbound dialing (hub-to-hub sync).
    #[allow(dead_code)]
    endpoint: Endpoint,
    #[debug(skip)]
    hub_repo: crate::hub_repo::HubRepo,
}

impl IrohRepo {
    /// create an iroh protocol handler backed by a hub_repo sync handler.
    pub fn new(endpoint: Endpoint, hub_repo: crate::hub_repo::HubRepo) -> Self {
        Self { endpoint, hub_repo }
    }

    /// access the hub_repo.
    pub fn hub_repo(&self) -> &crate::hub_repo::HubRepo {
        &self.hub_repo
    }
}

impl ProtocolHandler for IrohRepo {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let peer_id = connection.remote_id();
        tracing::info!(peer = %peer_id, "automerge-repo: accepted inbound connection");

        let (send, recv) = connection.accept_bi().await.map_err(|e| {
            tracing::warn!(peer = %peer_id, error = %e, "automerge-repo: failed to accept bi stream");
            e
        })?;

        let joined = tokio::io::join(recv, send);
        let label = format!("accept:{}", &peer_id.to_string()[..16]);
        let logged = LoggingIo::new(joined, label);

        let peer_id_str = peer_id.to_string();
        let hub_repo = self.hub_repo.clone();
        tokio::spawn(async move {
            hub_repo.handle_connection(peer_id_str, logged).await;
        });

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::debug!("automerge-repo: shutting down");
    }
}
