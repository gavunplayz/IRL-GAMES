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
let players = [];
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
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = '<span class="player-name"></span><span class="player-badge"></span>';
      row.querySelector(".player-name").textContent = player.name;
      row.querySelector(".player-badge").textContent = player.host ? "HOST" : "PLAYER";
      list.appendChild(row);
    });
  });

  document.getElementById("host-player-count").textContent = players.length;
  document.getElementById("player-count").textContent = players.length;
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

async function createLobby(mode) {
  if (!currentUser) {
    alert("Firebase is still connecting. Please try again in a moment.");
    return;
  }

  currentMode = mode;
  currentPlayerName = mode === "host-player" ? "Host Player" : "";
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
      name: "Host Player",
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
  showScreen("lobby-screen");
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
    createLobby(button.dataset.mode).catch(error => {
      console.error(error);
      document.getElementById("host-status").textContent = "Could not create the lobby.";
    });
  });
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
