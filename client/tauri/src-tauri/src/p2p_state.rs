//! P2P endpoint state management
//!
//! tracks the status of the iroh P2P endpoint and provides controls:
//! - start/stop/restart the endpoint
//! - monitor online status via iroh's .online() and watch_addr()
//! - notify tray/menu of status changes

use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

/// P2P endpoint status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum P2pStatus {
    /// endpoint not initialized
    Stopped = 0,
    /// endpoint initializing (brief)
    Starting = 1,
    /// endpoint online (connected to relay, has local addrs)
    Online = 2,
    /// endpoint initialized but offline (no relay, no addrs)
    Offline = 3,
    /// endpoint initialized, waiting for online() check
    Connecting = 4,
}

impl P2pStatus {
    fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Stopped,
            1 => Self::Starting,
            2 => Self::Online,
            3 => Self::Offline,
            4 => Self::Connecting,
            _ => Self::Stopped,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Starting => "starting...",
            Self::Online => "online",
            Self::Offline => "offline",
            Self::Connecting => "connecting...",
        }
    }
}

/// shared P2P endpoint state
pub struct P2pState {
    status: AtomicU8,
    config_path: Mutex<Option<PathBuf>>,
    /// channel for status change notifications
    status_tx: watch::Sender<P2pStatus>,
    status_rx: watch::Receiver<P2pStatus>,
}

impl Default for P2pState {
    fn default() -> Self {
        Self::new()
    }
}

impl P2pState {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(P2pStatus::Stopped);
        Self {
            status: AtomicU8::new(P2pStatus::Stopped as u8),
            config_path: Mutex::new(None),
            status_tx: tx,
            status_rx: rx,
        }
    }

    /// get current status
    pub fn status(&self) -> P2pStatus {
        P2pStatus::from_u8(self.status.load(Ordering::SeqCst))
    }

    /// set status and notify watchers
    fn set_status(&self, status: P2pStatus) {
        self.status.store(status as u8, Ordering::SeqCst);
        let _ = self.status_tx.send(status);
    }

    /// subscribe to status changes
    pub fn subscribe(&self) -> watch::Receiver<P2pStatus> {
        self.status_rx.clone()
    }

    /// set config path for endpoint initialization
    pub fn set_config_path(&self, path: PathBuf) {
        *self.config_path.lock().unwrap() = Some(path);
    }

    /// get config path
    pub fn config_path(&self) -> Option<PathBuf> {
        self.config_path.lock().unwrap().clone()
    }

    /// start the P2P endpoint
    pub async fn start(&self) -> Result<(), String> {
        let current = self.status();
        if current == P2pStatus::Online || current == P2pStatus::Starting {
            return Ok(());
        }

        let config_path = self
            .config_path()
            .ok_or_else(|| "config path not set".to_string())?;

        self.set_status(P2pStatus::Starting);

        // initialize the endpoint via p2p_commands
        if let Err(e) = crate::p2p_commands::init_p2p_client(&config_path).await {
            self.set_status(P2pStatus::Stopped);
            return Err(e);
        }

        self.set_status(P2pStatus::Connecting);

        // check if endpoint came up - use online() with timeout
        match self
            .check_online_with_timeout(Duration::from_secs(10))
            .await
        {
            Ok(true) => {
                self.set_status(P2pStatus::Online);
                Ok(())
            }
            Ok(false) => {
                self.set_status(P2pStatus::Offline);
                Ok(())
            }
            Err(e) => {
                self.set_status(P2pStatus::Offline);
                Err(e)
            }
        }
    }

    /// stop the P2P endpoint
    pub async fn stop(&self) {
        grimoire::federation::p2p_client::clear_federation_endpoint();
        self.set_status(P2pStatus::Stopped);
    }

    /// restart the P2P endpoint
    pub async fn restart(&self) -> Result<(), String> {
        self.stop().await;
        // small delay to allow cleanup
        tokio::time::sleep(Duration::from_millis(100)).await;
        self.start().await
    }

    /// check if endpoint is online using iroh's .online() with timeout
    async fn check_online_with_timeout(&self, timeout: Duration) -> Result<bool, String> {
        let endpoint = match grimoire::federation::p2p_client::get_endpoint_arc() {
            Ok(ep) => ep,
            Err(_) => return Ok(false),
        };

        // use tokio::time::timeout to wrap the online() call
        match tokio::time::timeout(timeout, endpoint.online()).await {
            Ok(()) => Ok(true),
            Err(_) => {
                // timeout - endpoint exists but couldn't connect to relay in time
                Ok(grimoire::federation::p2p_client::is_endpoint_available())
            }
        }
    }

    /// start watching endpoint status and update state accordingly
    pub fn start_status_watcher(state: Arc<P2pState>) {
        tauri::async_runtime::spawn(async move {
            loop {
                // wait for endpoint to be available
                loop {
                    if grimoire::federation::p2p_client::is_endpoint_available() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }

                let endpoint = match grimoire::federation::p2p_client::get_endpoint_arc() {
                    Ok(ep) => ep,
                    Err(_) => {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                };

                // poll endpoint status periodically
                loop {
                    // check if endpoint still exists
                    if !grimoire::federation::p2p_client::is_endpoint_available() {
                        state.set_status(P2pStatus::Stopped);
                        break;
                    }

                    // check online status with a short timeout
                    let is_online =
                        match tokio::time::timeout(Duration::from_secs(2), endpoint.online()).await
                        {
                            Ok(()) => true,
                            Err(_) => false,
                        };

                    let current = state.status();
                    if current != P2pStatus::Stopped && current != P2pStatus::Starting {
                        let new_status = if is_online {
                            P2pStatus::Online
                        } else {
                            P2pStatus::Offline
                        };
                        if current != new_status {
                            state.set_status(new_status);
                        }
                    }

                    // poll every 5 seconds
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }

                // endpoint was closed, wait before trying again
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
    }
}

/// tauri command to get P2P status
#[tauri::command]
pub fn p2p_get_status(state: tauri::State<'_, Arc<P2pState>>) -> String {
    state.status().as_str().to_string()
}

/// tauri command to start P2P endpoint
#[tauri::command]
pub async fn p2p_start(state: tauri::State<'_, Arc<P2pState>>) -> Result<(), String> {
    state.start().await
}

/// tauri command to stop P2P endpoint
#[tauri::command]
pub async fn p2p_stop(state: tauri::State<'_, Arc<P2pState>>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

/// tauri command to restart P2P endpoint
#[tauri::command]
pub async fn p2p_restart(state: tauri::State<'_, Arc<P2pState>>) -> Result<(), String> {
    state.restart().await
}
