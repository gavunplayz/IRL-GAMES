const screens = document.querySelectorAll(".screen");
let currentMode = "host";
let currentLobbyCode = "";

function showScreen(id) {
  screens.forEach((screen) => screen.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function generateLobbyCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += characters[Math.floor(Math.random() * characters.length)];
  }

  return code;
}

function getJoinLink(code) {
  const base = window.location.origin + window.location.pathname;
  return base.replace(/\/$/, "") + "?join=" + code;
}

function createLobby(mode) {
  currentMode = mode;
  currentLobbyCode = generateLobbyCode();

  document.getElementById("lobby-code").textContent = currentLobbyCode;
  document.getElementById("join-link").value = getJoinLink(currentLobbyCode);

  document.getElementById("host-status").textContent =
    mode === "host-player"
      ? "Host + Player device is ready."
      : "Waiting for players...";

  showScreen("host-screen");
}

document.getElementById("create-lobby-btn").addEventListener("click", () => {
  showScreen("mode-screen");
});

document.getElementById("join-lobby-btn").addEventListener("click", () => {
  showScreen("join-screen");
});

document.querySelectorAll(".mode-card").forEach((button) => {
  button.addEventListener("click", () => {
    createLobby(button.dataset.mode);
  });
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => {
    showScreen(button.dataset.back);
  });
});

document.getElementById("copy-link-btn").addEventListener("click", async () => {
  const input = document.getElementById("join-link");

  try {
    await navigator.clipboard.writeText(input.value);
    document.getElementById("copy-link-btn").textContent = "Copied!";
    setTimeout(() => {
      document.getElementById("copy-link-btn").textContent = "Copy";
    }, 1400);
  } catch {
    input.select();
    document.execCommand("copy");
  }
});

document.getElementById("enter-host-lobby-btn").addEventListener("click", () => {
  document.getElementById("lobby-display-code").textContent = currentLobbyCode;
  document.getElementById("lobby-mode-text").textContent =
    currentMode === "host-player" ? "Host + Player mode" : "Host mode";
  document.getElementById("player-count").textContent =
    currentMode === "host-player" ? "1" : "0";
  showScreen("lobby-screen");
});

document.getElementById("join-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const input = document.getElementById("lobby-code-input");
  const error = document.getElementById("join-error");
  const code = input.value.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    error.textContent = "Enter a valid 6-character lobby code.";
    return;
  }

  error.textContent = "";
  currentLobbyCode = code;

  document.getElementById("lobby-display-code").textContent = code;
  document.getElementById("lobby-mode-text").textContent = "Player mode";
  document.getElementById("player-count").textContent = "1";
  showScreen("lobby-screen");
});

const params = new URLSearchParams(window.location.search);
const joinCode = params.get("join");

if (joinCode) {
  document.getElementById("lobby-code-input").value = joinCode.toUpperCase();
  showScreen("join-screen");
}