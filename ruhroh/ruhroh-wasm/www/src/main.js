import { RuhrohNode } from "ruhroh-wasm";

// wasm auto-initializes via #[wasm_bindgen(start)]

// state
let node = null;
let credentials = null; // { centralUrl, serverId, apiKey }
let selectedPeer = null; // { display_name, node_id, endpoint_addr }

// storage keys
const STORAGE_KEY = "ruhroh_credentials";

// ============================================================================
// logging
// ============================================================================
const logEl = document.getElementById("log");
function log(msg, type = "info") {
  const div = document.createElement("div");
  div.className = type;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

// ============================================================================
// ui elements
// ============================================================================
const centralUrlInput = document.getElementById("centralUrl");
const inviteCodeInput = document.getElementById("inviteCode");
const displayNameInput = document.getElementById("displayName");
const registerBtn = document.getElementById("registerBtn");
const startOnlyBtn = document.getElementById("startOnlyBtn");
const registerForm = document.getElementById("registerForm");
const registeredInfo = document.getElementById("registeredInfo");
const serverIdEl = document.getElementById("serverId");
const nodeIdEl = document.getElementById("nodeId");
const stopBtn = document.getElementById("stopBtn");
const logoutBtn = document.getElementById("logoutBtn");

const groupsSection = document.getElementById("groupsSection");
const groupListEl = document.getElementById("groupList");
const newGroupNameInput = document.getElementById("newGroupName");
const createGroupBtn = document.getElementById("createGroupBtn");

const peersSection = document.getElementById("peersSection");
const peerListEl = document.getElementById("peerList");

const manualPeerSection = document.getElementById("manualPeerSection");
const peerAddrInput = document.getElementById("peerAddr");

const actionsSection = document.getElementById("actionsSection");
const chatMsgInput = document.getElementById("chatMsg");
const sendChatBtn = document.getElementById("sendChatBtn");
const proxyMethodInput = document.getElementById("proxyMethod");
const proxyPathInput = document.getElementById("proxyPath");
const proxyBtn = document.getElementById("proxyBtn");
const blobIdInput = document.getElementById("blobId");
const fetchBlobBtn = document.getElementById("fetchBlobBtn");

// ============================================================================
// central server api
// ============================================================================
async function centralFetch(path, options = {}) {
  const url = `${credentials.centralUrl}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (credentials.apiKey) {
    headers["Authorization"] = `Bearer ${credentials.apiKey}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  // handle empty responses (e.g., join/leave group returns 200 with no body)
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function registerWithCentral(inviteCode, displayName, nodeId, endpointAddr) {
  const centralUrl = centralUrlInput.value.trim();
  const res = await fetch(`${centralUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invite_code: inviteCode,
      display_name: displayName,
      node_id: nodeId,
      endpoint_addr: endpointAddr,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`registration failed: ${text}`);
  }
  return res.json();
}

async function fetchGroups() {
  return centralFetch(`/api/groups`);
}

async function joinGroup(groupId) {
  return centralFetch(`/api/groups/${groupId}/join`, { method: "POST" });
}

async function createGroup(name) {
  return centralFetch(`/api/groups`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

async function fetchPeers() {
  return centralFetch(`/api/peers`);
}

// ============================================================================
// ui state
// ============================================================================
function showRegisteredUI() {
  registerForm.classList.add("hidden");
  registeredInfo.classList.remove("hidden");
  groupsSection.classList.remove("hidden");
  peersSection.classList.remove("hidden");
  actionsSection.classList.remove("hidden");
  manualPeerSection.classList.add("hidden");
}

function showRegisterUI() {
  registerForm.classList.remove("hidden");
  registeredInfo.classList.add("hidden");
  groupsSection.classList.add("hidden");
  peersSection.classList.add("hidden");
  actionsSection.classList.add("hidden");
  manualPeerSection.classList.add("hidden");
}

function showManualUI() {
  registerForm.classList.add("hidden");
  registeredInfo.classList.remove("hidden");
  groupsSection.classList.add("hidden");
  peersSection.classList.add("hidden");
  actionsSection.classList.remove("hidden");
  manualPeerSection.classList.remove("hidden");
}

function saveCredentials() {
  if (credentials) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  }
}

function loadCredentials() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    credentials = JSON.parse(stored);
    return true;
  }
  return false;
}

// save invite code separately (convenience for re-registration)
function saveInviteCode(code) {
  localStorage.setItem("ruhroh_invite", code);
}

function loadInviteCode() {
  return localStorage.getItem("ruhroh_invite") || "";
}

function clearCredentials() {
  credentials = null;
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// groups ui
// ============================================================================
let myGroups = new Set();

async function refreshGroups() {
  try {
    const groups = await fetchGroups();
    groupListEl.innerHTML = "";
    
    if (groups.length === 0) {
      groupListEl.innerHTML = '<span style="color: #666;">no groups yet</span>';
      return;
    }
    
    for (const g of groups) {
      const tag = document.createElement("span");
      tag.className = "group-tag" + (myGroups.has(g.group_id) ? " member" : "");
      tag.textContent = g.name;
      tag.onclick = async () => {
        if (myGroups.has(g.group_id)) {
          log(`already in group ${g.name}`);
          return;
        }
        try {
          await joinGroup(g.group_id);
          myGroups.add(g.group_id);
          log(`joined group ${g.name}`, "success");
          await refreshGroups();
          await refreshPeers();
        } catch (err) {
          // handle "already a member" gracefully
          if (err.message?.includes("already a member")) {
            myGroups.add(g.group_id);
            log(`already in group ${g.name}`, "info");
            await refreshGroups();
            await refreshPeers();
          } else {
            log(`failed to join: ${err}`, "error");
          }
        }
      };
      groupListEl.appendChild(tag);
    }
  } catch (err) {
    log(`failed to load groups: ${err}`, "error");
  }
}

createGroupBtn.onclick = async () => {
  const name = newGroupNameInput.value.trim();
  if (!name) return;
  
  try {
    const group = await createGroup(name);
    log(`created group ${name}`, "success");
    myGroups.add(group.group_id);
    newGroupNameInput.value = "";
    await refreshGroups();
  } catch (err) {
    log(`failed to create group: ${err}`, "error");
  }
};

// ============================================================================
// peers ui
// ============================================================================
async function refreshPeers() {
  try {
    const peers = await fetchPeers();
    peerListEl.innerHTML = "";
    
    if (peers.length === 0) {
      peerListEl.innerHTML = "<li>join a group to see peers</li>";
      return;
    }
    
    for (const p of peers) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="peer-name">${p.display_name}</div>
          <div class="peer-id">${p.node_id.substring(0, 24)}...</div>
        </div>
      `;
      li.onclick = () => selectPeer(p, li);
      peerListEl.appendChild(li);
    }
  } catch (err) {
    log(`failed to load peers: ${err}`, "error");
  }
}

function selectPeer(peer, li) {
  // deselect previous
  document.querySelectorAll(".peer-list li.selected").forEach(el => el.classList.remove("selected"));
  li.classList.add("selected");
  selectedPeer = peer;
  log(`selected peer: ${peer.display_name}`);
}

function getSelectedPeerAddr() {
  if (selectedPeer?.endpoint_addr) {
    return selectedPeer.endpoint_addr;
  }
  return peerAddrInput.value.trim();
}

// ============================================================================
// node lifecycle
// ============================================================================
async function startNode(displayName) {
  log(`starting node as "${displayName}"...`);
  node = await new RuhrohNode(displayName);
  const nodeId = node.endpoint_id();
  const nodeAddr = node.endpoint_addr();
  nodeIdEl.textContent = nodeId.substring(0, 32) + "...";
  log(`node started: ${nodeId.substring(0, 16)}...`, "success");
  return { nodeId, nodeAddr };
}

function stopNode() {
  if (node) {
    node.free();
    node = null;
  }
  nodeIdEl.textContent = "-";
  serverIdEl.textContent = "-";
  selectedPeer = null;
}

// ============================================================================
// actions
// ============================================================================
sendChatBtn.onclick = async () => {
  if (!node) return;
  const peerAddr = getSelectedPeerAddr();
  const msg = chatMsgInput.value.trim();
  
  if (!peerAddr) {
    log("select a peer first", "error");
    return;
  }
  if (!msg) {
    log("enter a message", "error");
    return;
  }
  
  try {
    log(`sending to ${selectedPeer?.display_name || "peer"}...`);
    await node.send_chat(peerAddr, msg);
    log(`sent: "${msg}"`, "success");
    chatMsgInput.value = "";
  } catch (err) {
    log(`send failed: ${err}`, "error");
  }
};

chatMsgInput.onkeydown = (e) => {
  if (e.key === "Enter") sendChatBtn.onclick();
};

proxyBtn.onclick = async () => {
  if (!node) return;
  const peerAddr = getSelectedPeerAddr();
  const method = proxyMethodInput.value.trim() || "GET";
  const path = proxyPathInput.value.trim() || "/api/health";
  
  if (!peerAddr) {
    log("select a peer first", "error");
    return;
  }
  
  try {
    log(`proxying ${method} ${path}...`);
    const result = await node.proxy_request(peerAddr, method, path, null);
    log(`response: ${JSON.stringify(result)}`, "success");
  } catch (err) {
    log(`proxy failed: ${err}`, "error");
  }
};

fetchBlobBtn.onclick = async () => {
  if (!node) return;
  const peerAddr = getSelectedPeerAddr();
  const blobId = blobIdInput.value.trim();
  
  if (!peerAddr) {
    log("select a peer first", "error");
    return;
  }
  if (!blobId) {
    log("enter blob id", "error");
    return;
  }
  
  try {
    log(`fetching blob ${blobId.substring(0, 16)}...`);
    const data = await node.request_blob(peerAddr, blobId);
    log(`received ${data.byteLength || data.length} bytes`, "success");
    
    if (data.byteLength) {
      // detect mime type from magic bytes
      const mimeType = detectMimeType(new Uint8Array(data));
      log(`detected mime type: ${mimeType}`);
      
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      // show player section
      const playerSection = document.getElementById("playerSection");
      const audioPlayer = document.getElementById("audioPlayer");
      const imagePreview = document.getElementById("imagePreview");
      const nowPlaying = document.getElementById("nowPlaying");
      
      playerSection.classList.remove("hidden");
      const sizeStr = data.byteLength < 1024 * 1024 
        ? `${(data.byteLength / 1024).toFixed(1)} KB`
        : `${(data.byteLength / 1024 / 1024).toFixed(2)} MB`;
      nowPlaying.textContent = `blob: ${blobId.substring(0, 24)}... (${sizeStr}) [${mimeType}]`;
      
      // show audio or image based on mime type
      if (mimeType.startsWith("audio/")) {
        audioPlayer.style.display = "block";
        imagePreview.style.display = "none";
        audioPlayer.src = url;
        audioPlayer.play();
        log(`playing audio!`, "success");
      } else if (mimeType.startsWith("image/")) {
        audioPlayer.style.display = "none";
        imagePreview.style.display = "block";
        imagePreview.src = url;
        log(`displaying image!`, "success");
      } else {
        // unknown type - try as audio
        audioPlayer.style.display = "block";
        imagePreview.style.display = "none";
        audioPlayer.src = url;
        log(`unknown type, trying as audio`, "info");
      }
    }
  } catch (err) {
    log(`fetch failed: ${err}`, "error");
  }
};

// detect mime type from magic bytes
function detectMimeType(bytes) {
  if (bytes.length < 4) return "application/octet-stream";
  
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return "image/jpeg";
  }
  
  // PNG: 89 50 4E 47 (‰PNG)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "image/png";
  }
  
  // GIF: 47 49 46 38 (GIF8)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  
  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  
  // MP3: ID3 tag (49 44 33) or frame sync (FF FB, FF FA, FF F3, FF F2)
  if ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
      (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) {
    return "audio/mpeg";
  }
  
  // FLAC: 66 4C 61 43 (fLaC)
  if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return "audio/flac";
  }
  
  // OGG: 4F 67 67 53 (OggS)
  if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return "audio/ogg";
  }
  
  // WAV: 52 49 46 46 ... 57 41 56 45 (RIFF...WAVE)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
    return "audio/wav";
  }
  
  // default to audio/mpeg for backwards compat
  return "audio/mpeg";
}

// ============================================================================
// main button handlers
// ============================================================================

// register with central + start node (or reconnect with saved credentials)
registerBtn.onclick = async () => {
  const centralUrl = centralUrlInput.value.trim();
  const inviteCode = inviteCodeInput.value.trim();
  const displayName = displayNameInput.value.trim() || "browser-user";
  
  if (!centralUrl) {
    log("enter central server url", "error");
    return;
  }
  
  // if we have saved credentials, just reconnect
  if (credentials?.apiKey && credentials?.serverId) {
    try {
      const { nodeId, nodeAddr } = await startNode(displayName);
      serverIdEl.textContent = credentials.serverId.substring(0, 16) + "...";
      log(`reconnected as ${credentials.serverId.substring(0, 8)}...`, "success");
      showRegisteredUI();
      await refreshGroups();
      await refreshPeers();
      return;
    } catch (err) {
      log(`reconnect failed: ${err}`, "error");
      stopNode();
      return;
    }
  }
  
  // otherwise, need invite code for fresh registration
  if (!inviteCode) {
    log("enter invite code", "error");
    return;
  }
  
  try {
    // save invite code for convenience
    saveInviteCode(inviteCode);
    
    // start node first to get address
    const { nodeId, nodeAddr } = await startNode(displayName);
    
    // register with central
    log("registering with central server...");
    const reg = await registerWithCentral(inviteCode, displayName, nodeId, nodeAddr);
    
    credentials = {
      centralUrl,
      serverId: reg.server_id,
      apiKey: reg.api_key,
    };
    saveCredentials();
    
    serverIdEl.textContent = reg.server_id.substring(0, 16) + "...";
    log(`registered as ${reg.server_id.substring(0, 8)}...`, "success");
    
    showRegisteredUI();
    await refreshGroups();
    await refreshPeers();
  } catch (err) {
    log(`failed: ${err}`, "error");
    stopNode();
  }
};

// start node without central (manual peer entry)
startOnlyBtn.onclick = async () => {
  const displayName = displayNameInput.value.trim() || "browser-user";
  
  try {
    await startNode(displayName);
    serverIdEl.textContent = "(not registered)";
    showManualUI();
  } catch (err) {
    log(`failed: ${err}`, "error");
  }
};

// stop node
stopBtn.onclick = () => {
  stopNode();
  showRegisterUI();
  log("node stopped");
};

// logout (clear credentials + stop)
logoutBtn.onclick = () => {
  stopNode();
  clearCredentials();
  showRegisterUI();
  log("logged out");
};

// ============================================================================
// init
// ============================================================================
log("wasm initialized");

// load saved invite code
inviteCodeInput.value = loadInviteCode();

// check for saved credentials
if (loadCredentials()) {
  centralUrlInput.value = credentials.centralUrl;
  log(`found saved credentials for ${credentials.serverId?.substring(0, 8) || "unknown"}...`);
  log(`click "reconnect" to use saved credentials, or register with new invite`);
  // change button text to indicate reconnect is available
  registerBtn.textContent = "reconnect";
}
