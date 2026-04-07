//! iroh ↔ samod bridge for automerge document sync.
//!
//! wraps a `samod::Repo` with an `iroh::Endpoint` to sync automerge documents
//! over the `iroh/automerge-repo/1` ALPN protocol. implements
//! `iroh::protocol::ProtocolHandler` for inbound connections and provides
//! `IrohDialer` for outbound sync.

use std::sync::Arc;

use futures::future::BoxFuture;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::{Endpoint, EndpointAddr};
use samod::{AcceptorHandle, BackoffConfig, DialerHandle, Repo, Stopped, Transport};
use url::Url;

/// ALPN protocol identifier for automerge-repo sync over iroh.
pub const AUTOMERGE_REPO_ALPN: &[u8] = b"iroh/automerge-repo/1";

/// bridges a `samod::Repo` with an `iroh::Endpoint` for P2P automerge sync.
///
/// implements `ProtocolHandler` to accept inbound connections from other iroh
/// peers and feeds them to the samod repo's acceptor. use `sync_with` to
/// initiate outbound sync with a remote peer.
#[derive(derive_more::Debug, Clone)]
pub struct IrohRepo {
    endpoint: Endpoint,
    #[debug(skip)]
    repo: Repo,
    #[debug(skip)]
    acceptor: AcceptorHandle,
}

impl IrohRepo {
    /// create a new iroh-backed automerge repo bridge.
    ///
    /// registers an acceptor with the samod repo using a URL derived from the
    /// endpoint's node ID.
    pub fn new(endpoint: Endpoint, repo: Repo) -> Result<Self, Stopped> {
        let url = Url::parse(&format!("iroh://{}", endpoint.id())).expect("valid url");
        let acceptor = repo.make_acceptor(url)?;
        Ok(Self {
            endpoint,
            repo,
            acceptor,
        })
    }

    /// access the underlying samod repo.
    pub fn repo(&self) -> &Repo {
        &self.repo
    }

    /// start syncing with a remote peer. returns the dialer handle for
    /// lifecycle management.
    pub fn sync_with(&self, addr: EndpointAddr) -> Result<DialerHandle, Stopped> {
        let dialer = IrohDialer {
            endpoint: self.endpoint.clone(),
            addr,
        };
        self.repo.dial(BackoffConfig::default(), Arc::new(dialer))
    }
}

impl ProtocolHandler for IrohRepo {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let peer_id = connection.remote_id();
        tracing::debug!(peer = %peer_id, "automerge-repo: accepted inbound connection");

        let (send, recv) = connection.accept_bi().await.map_err(|e| {
            tracing::warn!(
                peer = %peer_id,
                error = %e,
                "automerge-repo: failed to accept bi stream"
            );
            e
        })?;

        // combine into a single AsyncRead + AsyncWrite — join takes (reader, writer)
        let joined = tokio::io::join(recv, send);
        let transport = Transport::from_tokio_io(joined);

        if let Err(e) = self.acceptor.accept(transport) {
            tracing::warn!(peer = %peer_id, error = ?e, "automerge-repo: acceptor rejected transport");
        } else {
            tracing::debug!(peer = %peer_id, "automerge-repo: handed transport to acceptor");
        }

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::debug!("automerge-repo: shutting down");
        self.repo.stop().await;
    }
}

/// samod dialer implementation backed by an iroh endpoint.
///
/// connects to a remote iroh peer and opens a bidirectional stream for
/// automerge-repo sync.
pub struct IrohDialer {
    endpoint: Endpoint,
    addr: EndpointAddr,
}

impl samod::Dialer for IrohDialer {
    fn url(&self) -> Url {
        Url::parse(&format!("iroh://{}", self.addr.id)).expect("valid url")
    }

    fn connect(
        &self,
    ) -> BoxFuture<'static, Result<Transport, Box<dyn std::error::Error + Send + Sync>>> {
        let endpoint = self.endpoint.clone();
        let addr = self.addr.clone();

        Box::pin(async move {
            let conn = endpoint.connect(addr, AUTOMERGE_REPO_ALPN).await.map_err(
                |e| -> Box<dyn std::error::Error + Send + Sync> {
                    tracing::warn!(error = %e, "automerge-repo: outbound connect failed");
                    Box::new(e)
                },
            )?;

            let (send, recv) =
                conn.open_bi()
                    .await
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                        tracing::warn!(error = %e, "automerge-repo: failed to open bi stream");
                        Box::new(e)
                    })?;

            // combine into a single AsyncRead + AsyncWrite — join takes (reader, writer)
            let joined = tokio::io::join(recv, send);
            let transport = Transport::from_tokio_io(joined);

            tracing::debug!(
                peer = %conn.remote_id(),
                "automerge-repo: outbound transport established"
            );

            Ok(transport)
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use automerge::{transaction::Transactable, Automerge, ReadDoc};
    use futures::StreamExt;
    use samod::transport::channel::ChannelDialer;
    use samod::{BackoffConfig, Repo};
    use tempfile::NamedTempFile;
    use tokio::time::timeout;

    use crate::storage::SqliteAutomergeStorage;

    /// helper to create a sqlite storage backed by a temporary file.
    /// returns both the storage and the temp file handle (must be held to
    /// prevent deletion).
    async fn temp_storage() -> (SqliteAutomergeStorage, NamedTempFile) {
        let tmp = NamedTempFile::new().expect("failed to create temp file");
        let storage = SqliteAutomergeStorage::new(tmp.path())
            .await
            .expect("failed to create sqlite automerge storage");
        (storage, tmp)
    }

    /// proves two samod repos can sync automerge documents through our
    /// SqliteAutomergeStorage. creates an empty document on one repo, finds it
    /// on the other, then makes changes on each side and verifies they
    /// propagate correctly. follows samod's own smoke test pattern: set up the
    /// changes listener *before* the mutation to avoid race conditions.
    #[tokio::test]
    async fn test_two_repo_sync_via_sqlite_storage() {
        let (storage_a, _tmp_a) = temp_storage().await;
        let (storage_b, _tmp_b) = temp_storage().await;

        // build two repos with sqlite-backed storage
        let repo_a = Repo::build_tokio().with_storage(storage_a).load().await;
        let repo_b = Repo::build_tokio().with_storage(storage_b).load().await;

        // connect repos via in-process channel dialer
        let acceptor = repo_b
            .make_acceptor(url::Url::parse("channel://sync-test").unwrap())
            .unwrap();
        let channel_dialer = ChannelDialer::new(acceptor);
        let dialer_handle = repo_a
            .dial(BackoffConfig::default(), Arc::new(channel_dialer))
            .unwrap();

        timeout(Duration::from_secs(10), dialer_handle.established())
            .await
            .expect("timed out waiting for dialer to establish")
            .expect("dialer failed to establish");

        // create an empty document on repo A so both sides discover it first
        let handle_a = timeout(Duration::from_secs(10), repo_a.create(Automerge::new()))
            .await
            .expect("timed out creating document")
            .expect("failed to create document on repo A");

        let doc_id = handle_a.document_id().clone();

        // find the document on repo B — this tells B to request the doc via sync
        let handle_b = timeout(Duration::from_secs(10), repo_b.find(doc_id.clone()))
            .await
            .expect("timed out finding document on repo B")
            .expect("failed to find document on repo B")
            .expect("document not found on repo B");

        // set up a changes listener on B *before* making the change on A,
        // so we don't miss the sync event
        let mut changes_b = handle_b.changes();

        // now write data on repo A
        handle_a.with_document(|doc| {
            doc.transact::<_, _, automerge::AutomergeError>(|tx| {
                tx.put(automerge::ROOT, "greeting", "hello from rust")?;
                Ok(())
            })
            .unwrap();
        });

        // wait for the change to arrive on B
        timeout(Duration::from_secs(10), changes_b.next())
            .await
            .expect("timed out waiting for greeting to sync to repo B");

        // verify repo B received the greeting from A
        handle_b.with_document(|doc| {
            let val = doc
                .get(automerge::ROOT, "greeting")
                .expect("failed to read greeting")
                .expect("greeting key missing on repo B");
            assert_eq!(
                val.0.to_str().unwrap(),
                "hello from rust",
                "greeting value mismatch on repo B"
            );
        });

        // set up a changes listener on A *before* making the change on B
        let mut changes_a = handle_a.changes();

        // make a change on repo B via with_document
        handle_b.with_document(|doc| {
            doc.transact::<_, _, automerge::AutomergeError>(|tx| {
                tx.put(automerge::ROOT, "reply", "hey back")?;
                Ok(())
            })
            .unwrap();
        });

        // wait for the change to propagate from B to A
        timeout(Duration::from_secs(10), changes_a.next())
            .await
            .expect("timed out waiting for reply to sync to repo A");

        // verify repo A now has both fields
        handle_a.with_document(|doc| {
            let greeting = doc
                .get(automerge::ROOT, "greeting")
                .expect("failed to read greeting on A")
                .expect("greeting key missing on repo A after sync");
            assert_eq!(
                greeting.0.to_str().unwrap(),
                "hello from rust",
                "greeting value mismatch on repo A"
            );

            let reply = doc
                .get(automerge::ROOT, "reply")
                .expect("failed to read reply on A")
                .expect("reply key missing on repo A after sync");
            assert_eq!(
                reply.0.to_str().unwrap(),
                "hey back",
                "reply value mismatch on repo A"
            );
        });

        // clean shutdown
        repo_a.stop().await;
        repo_b.stop().await;
    }

    /// proves that data written through SqliteAutomergeStorage persists across
    /// repo restarts. creates a doc, stops the repo, creates a fresh repo with
    /// the same storage file, and verifies the doc is still there.
    #[tokio::test]
    async fn test_storage_persists_across_repo_restarts() {
        let tmp = NamedTempFile::new().expect("failed to create temp file");
        let db_path = tmp.path().to_path_buf();

        let doc_id;

        // phase 1: create a repo, insert a document, then stop
        {
            let storage = SqliteAutomergeStorage::new(&db_path)
                .await
                .expect("failed to create storage (phase 1)");

            let repo = Repo::build_tokio().with_storage(storage).load().await;

            let mut initial = Automerge::new();
            initial
                .transact::<_, _, automerge::AutomergeError>(|tx| {
                    tx.put(automerge::ROOT, "name", "persistence test")?;
                    tx.put(automerge::ROOT, "version", "1")?;
                    Ok(())
                })
                .unwrap();

            let handle = timeout(Duration::from_secs(10), repo.create(initial))
                .await
                .expect("timed out creating document")
                .expect("failed to create document");

            doc_id = handle.document_id().clone();

            // verify the document is readable before stopping
            handle.with_document(|doc| {
                let name = doc
                    .get(automerge::ROOT, "name")
                    .expect("failed to read name")
                    .expect("name key missing");
                assert_eq!(name.0.to_str().unwrap(), "persistence test");
            });

            repo.stop().await;
        }

        // phase 2: create a new storage + repo from the same file, find the doc
        {
            let storage = SqliteAutomergeStorage::new(&db_path)
                .await
                .expect("failed to create storage (phase 2)");

            let repo = Repo::build_tokio().with_storage(storage).load().await;

            let handle = timeout(Duration::from_secs(10), repo.find(doc_id.clone()))
                .await
                .expect("timed out finding document after restart")
                .expect("failed to find document after restart")
                .expect("document not found after restart — storage did not persist");

            // verify the data matches what was written in phase 1
            handle.with_document(|doc| {
                let name = doc
                    .get(automerge::ROOT, "name")
                    .expect("failed to read name after restart")
                    .expect("name key missing after restart");
                assert_eq!(
                    name.0.to_str().unwrap(),
                    "persistence test",
                    "name value mismatch after restart"
                );

                let version = doc
                    .get(automerge::ROOT, "version")
                    .expect("failed to read version after restart")
                    .expect("version key missing after restart");
                assert_eq!(
                    version.0.to_str().unwrap(),
                    "1",
                    "version value mismatch after restart"
                );
            });

            repo.stop().await;
        }

        // keep tmp alive until the end so the file isn't deleted
        drop(tmp);
    }
}
