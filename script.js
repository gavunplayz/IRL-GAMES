import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC_Ku2b5gdyzoSTKJWEhsHK_qYeRzDoiP0",
  authDomain: "rps-battle-royale.firebaseapp.com",
  databaseURL: "https://rps-battle-royale-default-rtdb.firebaseio.com",
  projectId: "rps-battle-royale",
  storageBucket: "rps-battle-royale.firebasestorage.app",
  messagingSenderId: "712485110727",
  appId: "1:712485110727:web:210b2dc5f3a4e795028fe2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const screens = document.querySelectorAll(".screen");
let currentMode = "host";
let currentLobbyCode = "";
let currentPlayerName = "";
let currentUser = null;
let pendingMode = "";
let players = [];
let selectedGame = "mm2";
let lobbyUnsubscribe = null;

function showScreen(id) {
  screens.forEach(s => s.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function generateLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getJoinLink(code) {
  const base = window.location.origin + window.location.pathname;
  return base.replace(/\/$/, "") + "?join=" + code;
}

function lobbyRef() {
  return ref(db, "lobbies/" + currentLobbyCode);
}


function canManagePlayers() {
  return currentMode === "host" || currentMode === "host-player";
}

async function removePlayer(uid, name) {
  if (!canManagePlayers() || !currentLobbyCode || !currentUser || uid === currentUser.uid) return;
  const player = players.find(item => item.uid === uid);
  if (!player) return;
  if (!confirm("Remove " + name + " from this lobby?")) return;

  try {
    await remove(ref(db, "lobbies/" + currentLobbyCode + "/players/" + uid));
  } catch (error) {
    console.error(error);
    alert("Could not remove that player. Please try again.");
  }
}

function buildPlayerRow(player, allowManagement) {
  const row = document.createElement("div");
  row.className = "player-row";

  const name = document.createElement("span");
  name.className = "player-name";
  name.textContent = player.name;

  const actions = document.createElement("span");
  actions.className = "player-row-actions";

  const badge = document.createElement("span");
  badge.className = "player-badge";
  if (player.host) {
    badge.textContent = "HOST";
  } else if (player.uid === currentUser?.uid) {
    badge.textContent = "YOU";
  } else {
    badge.textContent = "PLAYER";
  }
  actions.appendChild(badge);

  if (allowManagement && !player.host && player.uid !== currentUser?.uid) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-player-button";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", "Remove " + player.name);
    removeButton.addEventListener("click", () => removePlayer(player.uid, player.name));
    actions.appendChild(removeButton);
  }

  row.appendChild(name);
  row.appendChild(actions);
  return row;
}

function renderPlayers() {
  const lists = [document.getElementById("host-player-list"), document.getElementById("player-list")];

  lists.forEach(list => {
    if (!list) return;
    list.innerHTML = "";

    if (players.length === 0) {
      list.innerHTML = '<p class="empty-state">No players have joined yet.</p>';
      return;
    }

    players.forEach(player => {
      list.appendChild(buildPlayerRow(player, list.id === "host-player-list" && canManagePlayers()));
    });
  });

  document.getElementById("host-player-count").textContent = players.length;
  const setupStatus = document.getElementById("setup-player-management-status");
  if (setupStatus) setupStatus.textContent = players.length === 1 ? "1 player" : players.length + " players";
  document.getElementById("player-count").textContent = players.length;

  const setupCount = document.getElementById("setup-player-count");
  const setupCode = document.getElementById("setup-lobby-code");
  const setupList = document.getElementById("setup-player-list");

  if (setupCount) setupCount.textContent = players.length;
  if (setupCode) setupCode.textContent = currentLobbyCode || "------";

  if (setupList) {
    setupList.innerHTML = "";
    if (players.length === 0) {
      setupList.innerHTML = '<p class="empty-state">No players have joined yet.</p>';
    } else {
      players.forEach(player => {
        setupList.appendChild(buildPlayerRow(player, canManagePlayers()));
      });
    }
  }
}

function stopLobbyListener() {
  if (lobbyUnsubscribe) {
    lobbyUnsubscribe();
    lobbyUnsubscribe = null;
  }
}

function listenToLobby() {
  stopLobbyListener();

  lobbyUnsubscribe = onValue(lobbyRef(), snapshot => {
    const lobby = snapshot.val();

    if (!lobby) {
      players = [];
      renderPlayers();

      if (currentMode === "player") {
        document.getElementById("join-error").textContent = "This lobby has ended or no longer exists.";
        showScreen("join-screen");
      } else {
        document.getElementById("host-status").textContent = "This lobby is no longer active.";
      }
      return;
    }

    players = Object.entries(lobby.players || {}).map(([uid, player]) => ({ uid, ...player }));

    if (currentMode === "player" && currentUser && !lobby.players[currentUser.uid]) {
      document.getElementById("join-error").textContent = "The host removed you from this lobby.";
      stopLobbyListener();
      currentLobbyCode = "";
      currentPlayerName = "";
      players = [];
      renderPlayers();
      showScreen("join-screen");
      return;
    }

    players.sort((a, b) => {
      if (a.host && !b.host) return -1;
      if (!a.host && b.host) return 1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });

    document.getElementById("lobby-display-code").textContent = currentLobbyCode;
    document.getElementById("lobby-mode-text").textContent =
      currentMode === "host-player" ? "Host + Player mode" :
      currentMode === "host" ? "Host mode" : "Player mode";

    document.getElementById("host-status").textContent =
      players.length === 0 ? "Waiting for players..." :
      players.length === 1 ? "1 player is connected." :
      players.length + " players are connected.";

    renderPlayers();
  }, error => {
    console.error(error);
    document.getElementById("host-status").textContent = "Firebase permission error. Check your database rules.";
  });
}

async function createLobby(mode, playerName = "") {
  if (!currentUser) {
    alert("Firebase is still connecting. Please try again in a moment.");
    return;
  }

  currentMode = mode;
  currentPlayerName = mode === "host-player" ? playerName : "";
  currentLobbyCode = generateLobbyCode();

  const existing = await get(lobbyRef());
  if (existing.exists()) return createLobby(mode);

  const createdAt = Date.now();
  const lobby = {
    hostUid: currentUser.uid,
    hostName: currentPlayerName || "Host",
    mode,
    status: "waiting",
    createdAt,
    players: {}
  };

  if (mode === "host-player") {
    lobby.players[currentUser.uid] = {
      name: playerName,
      host: true,
      joinedAt: createdAt
    };
  }

  await set(lobbyRef(), lobby);
  await onDisconnect(lobbyRef()).remove();

  document.getElementById("lobby-code").textContent = currentLobbyCode;
  document.getElementById("join-link").value = getJoinLink(currentLobbyCode);
  document.getElementById("host-status").textContent = "Lobby is live. Waiting for players...";

  const qr = document.getElementById("qr-code");
  qr.innerHTML = "";

  if (typeof QRCode !== "undefined") {
    new QRCode(qr, {
      text: getJoinLink(currentLobbyCode),
      width: 170,
      height: 170,
      colorDark: "#111111",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    qr.innerHTML = "<span>QR</span>";
  }

  listenToLobby();
  showScreen("host-screen");
}

async function joinLobby(code, name) {
  if (!currentUser) throw new Error("Firebase is still connecting. Please try again in a moment.");

  currentLobbyCode = code;
  currentPlayerName = name;
  currentMode = "player";

  const snapshot = await get(lobbyRef());

  if (!snapshot.exists()) throw new Error("That lobby does not exist or has already ended.");

  const lobby = snapshot.val();
  if (lobby.status !== "waiting") throw new Error("That lobby is no longer accepting players.");

  const playerRef = ref(db, "lobbies/" + currentLobbyCode + "/players/" + currentUser.uid);

  await set(playerRef, {
    name,
    host: false,
    joinedAt: Date.now()
  });

  await onDisconnect(playerRef).remove();

  document.getElementById("lobby-display-code").textContent = code;
  document.getElementById("lobby-mode-text").textContent = "Player mode";

  listenToLobby();
  showScreen("lobby-screen");
}

async function leaveLobby() {
  stopLobbyListener();

  if (!currentLobbyCode || !currentUser) {
    showScreen("home-screen");
    return;
  }

  try {
    const lobbySnapshot = await get(lobbyRef());

    if (lobbySnapshot.exists()) {
      const lobby = lobbySnapshot.val();

      if (lobby.hostUid === currentUser.uid) {
        await remove(lobbyRef());
      } else {
        await remove(ref(db, "lobbies/" + currentLobbyCode + "/players/" + currentUser.uid));
      }
    }
  } catch (error) {
    console.error(error);
  }

  currentLobbyCode = "";
  currentPlayerName = "";
  players = [];
  showScreen("home-screen");
}

function enterLobby() {
  document.getElementById("lobby-display-code").textContent = currentLobbyCode;
  document.getElementById("lobby-mode-text").textContent =
    currentMode === "host-player" ? "Host + Player mode" :
    currentMode === "host" ? "Host mode" : "Player mode";
  renderPlayers();
  showScreen("game-selection-screen");
}

document.getElementById("create-lobby-btn").addEventListener("click", () => showScreen("mode-screen"));

document.getElementById("join-lobby-btn").addEventListener("click", () => {
  document.getElementById("lobby-code-input").value = "";
  document.getElementById("player-name-input").value = "";
  document.getElementById("join-error").textContent = "";
  showScreen("join-screen");
});

document.querySelectorAll(".mode-card").forEach(button => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;

    if (mode === "host-player") {
      pendingMode = mode;
      document.getElementById("host-player-name-input").value = "";
      document.getElementById("host-player-name-error").textContent = "";
      showScreen("host-player-name-screen");
      setTimeout(() => document.getElementById("host-player-name-input").focus(), 0);
      return;
    }

    createLobby(mode).catch(error => {
      console.error(error);
      document.getElementById("host-status").textContent = "Could not create the lobby.";
    });
  });
});

document.getElementById("host-player-name-form").addEventListener("submit", async event => {
  event.preventDefault();

  const input = document.getElementById("host-player-name-input");
  const error = document.getElementById("host-player-name-error");
  const name = input.value.trim();

  if (pendingMode !== "host-player") return;

  if (!name) {
    error.textContent = "Enter a player name.";
    input.focus();
    return;
  }

  if (name.length > 20) {
    error.textContent = "Player names can be up to 20 characters.";
    input.focus();
    return;
  }

  error.textContent = "Creating lobby...";

  try {
    await createLobby("host-player", name);
    error.textContent = "";
    pendingMode = "";
  } catch (createError) {
    console.error(createError);
    error.textContent = createError.message || "Could not create the lobby.";
  }
});

document.querySelectorAll("[data-back]").forEach(button => {
  button.addEventListener("click", () => showScreen(button.dataset.back));
});

document.getElementById("copy-link-btn").addEventListener("click", async () => {
  const input = document.getElementById("join-link");
  try {
    await navigator.clipboard.writeText(input.value);
    document.getElementById("copy-link-btn").textContent = "Copied!";
    setTimeout(() => document.getElementById("copy-link-btn").textContent = "Copy", 1400);
  } catch {
    input.select();
    document.execCommand("copy");
  }
});

document.getElementById("enter-host-lobby-btn").addEventListener("click", enterLobby);

document.querySelectorAll(".game-card:not(.disabled)").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".game-card").forEach(card => card.classList.remove("selected"));
    button.classList.add("selected");
    selectedGame = button.dataset.game;
    const name = button.querySelector("strong")?.textContent || "Selected game";
    const description = button.querySelector("small")?.textContent || "";
    document.getElementById("selected-game-name").textContent = name;
    document.getElementById("selected-game-description").textContent = description;
  });
});

document.getElementById("continue-game-setup-btn").addEventListener("click", async () => {
  if (!currentUser || !currentLobbyCode || selectedGame !== "mm2") return;

  try {
    await set(ref(db, "lobbies/" + currentLobbyCode + "/settings/gameType"), selectedGame);
    await set(ref(db, "lobbies/" + currentLobbyCode + "/settings/gameName"), "Murder Mystery 2");
    document.getElementById("setup-player-count").textContent = players.length;
    document.getElementById("setup-lobby-code").textContent = currentLobbyCode;
    renderPlayers();
    showScreen("game-setup-screen");
  } catch (error) {
    console.error(error);
    alert("Could not save the game selection. Please try again.");
  }
});

document.getElementById("join-form").addEventListener("submit", async event => {
  event.preventDefault();

  const code = document.getElementById("lobby-code-input").value.trim().toUpperCase();
  const name = document.getElementById("player-name-input").value.trim();
  const error = document.getElementById("join-error");

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    error.textContent = "Enter a valid 6-character lobby code.";
    return;
  }

  if (!name) {
    error.textContent = "Enter a player name.";
    return;
  }

  if (name.length > 20) {
    error.textContent = "Player names can be up to 20 characters.";
    return;
  }

  error.textContent = "Joining...";

  try {
    await joinLobby(code, name);
    error.textContent = "";
  } catch (joinError) {
    console.error(joinError);
    error.textContent = joinError.message || "Could not join that lobby.";
  }
});

const params = new URLSearchParams(window.location.search);
const joinCode = params.get("join");

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) console.log("Firebase anonymous auth ready:", user.uid);
});

signInAnonymously(auth).catch(error => {
  console.error("Firebase anonymous sign-in failed:", error);
  document.getElementById("host-status").textContent = "Firebase authentication is not enabled yet.";
});

document.querySelector('#lobby-screen .back-button').addEventListener("click", leaveLobby);

if (joinCode) {
  document.getElementById("lobby-code-input").value = joinCode.toUpperCase();
  showScreen("join-screen");
}
