import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, onDisconnect, remove, push } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

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
let gameDeathParentUnsubscribe = null;
let gameDeathOwnUnsubscribe = null;
let gameActionUnsubscribe = null;
let gameDeaths = {};
let myGameDeath = null;
let myGameRole = null;
let gameActionRoleLabel = "";
const processedGameActions = new Set();

const DEFAULT_DEATH_VISIBILITY = "none";

const DEFAULT_MM2_ROLES = [
  { id: "murderer", name: "Murderer", description: "Eliminate the other players.", defaultAmount: "1" },
  { id: "sheriff", name: "Sheriff", description: "Work to identify and stop the Murderer.", defaultAmount: "1" },
  { id: "civilian", name: "Civilian", description: "Complete the game without a special role.", defaultAmount: "auto" }
];

function getDefaultRoleConfiguration() {
  return DEFAULT_MM2_ROLES.map(role => ({
    id: role.id,
    name: role.name,
    amount: role.defaultAmount
  }));
}

function normalizeRoleConfiguration(roles) {
  const source = Array.isArray(roles) ? roles : [];
  const normalized = DEFAULT_MM2_ROLES.map(defaultRole => {
    const saved = source.find(role => role && role.id === defaultRole.id);
    let amount = saved?.amount ?? defaultRole.defaultAmount;

    if (amount !== "auto") {
      const number = Number(amount);
      amount = Number.isFinite(number) && number >= 0 ? String(Math.floor(number)) : defaultRole.defaultAmount;
    }

    return {
      id: defaultRole.id,
      name: defaultRole.name,
      amount
    };
  });

  return normalized;
}

function getRoleConfigurationSummary(roles) {
  const fixedCount = roles
    .filter(role => role.amount !== "auto")
    .reduce((sum, role) => sum + Number(role.amount || 0), 0);
  const hasAuto = roles.some(role => role.amount === "auto");
  const playerCount = players.length;

  if (fixedCount > playerCount) {
    const extra = fixedCount - playerCount;
    return "Too many fixed roles by " + extra + " player" + (extra === 1 ? "" : "s") + ".";
  }

  if (hasAuto) {
    const remaining = playerCount - fixedCount;
    return "AUTO will fill the remaining " + remaining + " player" + (remaining === 1 ? "" : "s") + ".";
  }

  if (fixedCount === playerCount) {
    return "All " + playerCount + " player" + (playerCount === 1 ? "" : "s") + " have a fixed role.";
  }

  const unassigned = playerCount - fixedCount;
  return unassigned + " player" + (unassigned === 1 ? " does" : "s do") + " not have a role yet.";
}


function getRoleConfigurationValidation(roles = getDefaultRoleConfiguration()) {
  const normalized = normalizeRoleConfiguration(roles);
  const playerCount = players.length;
  const fixedRoles = normalized.filter(role => role.amount !== "auto");
  const fixedCount = fixedRoles.reduce((sum, role) => sum + Number(role.amount || 0), 0);
  const autoRoles = normalized.filter(role => role.amount === "auto");

  if (playerCount < 1) {
    return { valid: false, message: "Waiting for players." };
  }

  if (fixedCount > playerCount) {
    return { valid: false, message: "You have assigned " + fixedCount + " fixed roles, but there are only " + playerCount + " players." };
  }

  if (autoRoles.length > 1) {
    return { valid: false, message: "Only one role can use AUTO." };
  }

  if (autoRoles.length === 1 && playerCount - fixedCount < 0) {
    return { valid: false, message: "AUTO cannot fill a negative number of players." };
  }

  if (autoRoles.length === 0 && fixedCount !== playerCount) {
    return { valid: false, message: "Assign exactly " + playerCount + " players before starting, or set one role to AUTO." };
  }

  const murderer = normalized.find(role => role.id === "murderer");
  if (!murderer || Number(murderer.amount || 0) < 1) {
    return { valid: false, message: "MM2 needs at least 1 Murderer." };
  }

  return {
    valid: true,
    message: autoRoles.length === 1
      ? "Ready to start. AUTO will fill " + (playerCount - fixedCount) + " remaining player" + (playerCount - fixedCount === 1 ? "" : "s") + "."
      : "Ready to start. Every player has a fixed role."
  };
}

function updateStartGameState() {
  const status = document.getElementById("start-game-status");
  const button = document.getElementById("start-game-btn");
  if (!status || !button) return;

  const validation = getRoleConfigurationValidation(
    window.currentRoleConfiguration || getDefaultRoleConfiguration()
  );

  if (!canManagePlayers()) {
    button.disabled = true;
    status.className = "start-game-status";
    status.textContent = "Only the host can start the game.";
    return;
  }

  button.disabled = !validation.valid;
  status.className = "start-game-status " + (validation.valid ? "ready" : "invalid");
  status.textContent = validation.message;
}

function buildAssignedRoles() {
  const roles = normalizeRoleConfiguration(
    window.currentRoleConfiguration || getDefaultRoleConfiguration()
  );
  const validation = getRoleConfigurationValidation(roles);
  if (!validation.valid) throw new Error(validation.message);

  const pool = [];
  roles.forEach(role => {
    if (role.amount === "auto") return;
    for (let i = 0; i < Number(role.amount); i++) {
      pool.push({ id: role.id, name: role.name });
    }
  });

  const fixedCount = pool.length;
  const autoRole = roles.find(role => role.amount === "auto");
  if (autoRole) {
    for (let i = fixedCount; i < players.length; i++) {
      pool.push({ id: autoRole.id, name: autoRole.name });
    }
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
}

async function startGame() {
  if (!canManagePlayers() || !currentUser || !currentLobbyCode) return;

  const validation = getRoleConfigurationValidation(
    window.currentRoleConfiguration || getDefaultRoleConfiguration()
  );

  if (!validation.valid) {
    alert(validation.message);
    return;
  }

  const startButton = document.getElementById("start-game-btn");
  const status = document.getElementById("start-game-status");
  if (startButton) startButton.disabled = true;
  if (status) status.textContent = "Assigning private roles...";

  try {
    const assigned = buildAssignedRoles();
    const privateRoles = {};

    players.forEach((player, index) => {
      const assignedRole = assigned[index];
      privateRoles[player.uid] = {
        roleId: assignedRole.id,
        roleName: assignedRole.name,
        assignedAt: Date.now()
      };
    });

    await set(ref(db, "gamePrivate/" + currentLobbyCode), privateRoles);
    await set(ref(db, "lobbies/" + currentLobbyCode + "/publicGame"), {
      startedAt: Date.now(),
      playerCount: players.length
    });
    await set(ref(db, "lobbies/" + currentLobbyCode + "/status"), "in_progress");

    if (status) status.textContent = "Game started. Private roles have been assigned.";
  } catch (error) {
    console.error(error);
    if (status) status.textContent = error.message || "Could not start the game.";
    if (startButton) startButton.disabled = false;
  }
}

async function loadMyRole() {
  if (!currentUser || !currentLobbyCode) return null;
  const snapshot = await get(ref(db, "gamePrivate/" + currentLobbyCode + "/" + currentUser.uid));
  return snapshot.exists() ? snapshot.val() : null;
}

function stopGameDeathListeners() {
  if (gameDeathParentUnsubscribe) {
    gameDeathParentUnsubscribe();
    gameDeathParentUnsubscribe = null;
  }
  if (gameDeathOwnUnsubscribe) {
    gameDeathOwnUnsubscribe();
    gameDeathOwnUnsubscribe = null;
  }
}

function renderGamePlayerList() {
  const list = document.getElementById("game-player-list");
  if (!list) return;

  list.innerHTML = "";

  if (players.length === 0) {
    list.innerHTML = '<p class="empty-state">No players are currently connected.</p>';
    return;
  }

  players.forEach(player => {
    const row = document.createElement("div");
    row.className = "game-player-row";

    const death = gameDeaths[player.uid] || (player.uid === currentUser?.uid ? myGameDeath : null);
    const isDead = Boolean(death);

    if (isDead) row.classList.add("dead");

    const main = document.createElement("div");
    main.className = "player-main";

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name + (player.uid === currentUser?.uid ? " " : "");

    if (player.uid === currentUser?.uid) {
      const you = document.createElement("span");
      you.className = "you-label";
      you.textContent = "YOU";
      name.appendChild(you);
    }

    const state = document.createElement("span");
    state.className = "player-state";
    state.textContent = isDead ? "DEAD" : "Alive";

    main.appendChild(name);
    main.appendChild(state);

    row.appendChild(main);
    list.appendChild(row);
  });

  const statusLabel = document.getElementById("game-player-status-label");
  if (statusLabel) {
    statusLabel.textContent = Object.keys(gameDeaths).length > 0 || myGameDeath ? "STATUS" : "LIVE";
  }

  renderGameActionPanel();
}

function renderGameActionPanel() {
  const card = document.getElementById("game-action-card");
  const label = document.getElementById("game-action-role-label");
  const description = document.getElementById("game-action-description");
  const select = document.getElementById("game-target-select");
  const button = document.getElementById("game-action-btn");
  const status = document.getElementById("game-action-status");

  if (!card || !select || !button || !description || !label) return;

  const isActionRole = myGameRole?.roleId === "murderer" || myGameRole?.roleId === "sheriff";
  if (!isActionRole || !currentUser || currentMode === "host") {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  label.textContent = myGameRole.roleName.toUpperCase();
  description.textContent = myGameRole.roleId === "sheriff"
    ? "Choose a player to mark as dead. If the Sheriff chooses someone who is not the Murderer, the Sheriff is also marked dead."
    : "Choose a player to mark as dead.";

  select.innerHTML = "";

  const available = players.filter(player =>
    player.uid !== currentUser.uid &&
    !gameDeaths[player.uid]
  );

  if (myGameDeath) {
    card.classList.add("disabled-action");
    select.disabled = true;
    button.disabled = true;
    status.textContent = "You are dead and cannot use your role action.";
    return;
  }

  card.classList.remove("disabled-action");
  select.disabled = available.length === 0;
  button.disabled = available.length === 0;

  if (available.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No available players";
    select.appendChild(option);
    status.textContent = "There are no living players to choose.";
    return;
  }

  available.forEach(player => {
    const option = document.createElement("option");
    option.value = player.uid;
    option.textContent = player.name;
    select.appendChild(option);
  });

  status.textContent = "";
}

async function submitGameAction() {
  if (!currentUser || !currentLobbyCode || !myGameRole) return;
  if (myGameRole.roleId !== "murderer" && myGameRole.roleId !== "sheriff") return;
  if (myGameDeath) return;

  const select = document.getElementById("game-target-select");
  const button = document.getElementById("game-action-btn");
  const status = document.getElementById("game-action-status");
  const targetUid = select?.value;

  if (!targetUid || targetUid === currentUser.uid) return;

  const target = players.find(player => player.uid === targetUid);
  if (!target || gameDeaths[targetUid]) {
    if (status) status.textContent = "That player is no longer available.";
    return;
  }

  if (button) button.disabled = true;
  if (status) status.textContent = "Submitting action...";

  try {
    await push(ref(db, "gameActions/" + currentLobbyCode + "/" + currentUser.uid), {
      targetUid,
      createdAt: Date.now()
    });
    if (status) status.textContent = "Action submitted.";
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "Could not submit the action. Please try again.";
    renderGameActionPanel();
  }
}

function startGameDeathListeners(deathVisibility) {
  stopGameDeathListeners();

  gameDeaths = {};
  myGameDeath = null;

  if (!currentUser || !currentLobbyCode) return;

  const ownDeathRef = ref(db, "gameState/" + currentLobbyCode + "/deaths/" + currentUser.uid);
  gameDeathOwnUnsubscribe = onValue(ownDeathRef, snapshot => {
    myGameDeath = snapshot.exists() ? snapshot.val() : null;
    if (myGameDeath) {
      gameDeaths[currentUser.uid] = myGameDeath;
    } else if (gameDeaths[currentUser.uid]) {
      delete gameDeaths[currentUser.uid];
    }
    renderGamePlayerList();
  }, error => {
    console.error(error);
  });

  const canReadAllDeaths = currentMode === "host" || deathVisibility === "all";
  if (canReadAllDeaths) {
    const deathsRef = ref(db, "gameState/" + currentLobbyCode + "/deaths");
    gameDeathParentUnsubscribe = onValue(deathsRef, snapshot => {
      gameDeaths = snapshot.val() || {};
      myGameDeath = currentUser && gameDeaths[currentUser.uid] ? gameDeaths[currentUser.uid] : myGameDeath;
      renderGamePlayerList();
    }, error => {
      console.error(error);
    });
  }
}

async function processGameAction(actorUid, actionId, action) {
  if (!currentUser || currentUser.uid !== (await get(ref(db, "lobbies/" + currentLobbyCode + "/hostUid"))).val()) return;
  if (!action || !action.targetUid || processedGameActions.has(actorUid + ":" + actionId)) return;

  processedGameActions.add(actorUid + ":" + actionId);

  try {
    const assignmentsSnapshot = await get(ref(db, "gamePrivate/" + currentLobbyCode));
    const assignments = assignmentsSnapshot.val() || {};
    const actorRole = assignments[actorUid]?.roleId;
    const targetRole = assignments[action.targetUid]?.roleId;

    if (actorRole !== "murderer" && actorRole !== "sheriff") return;
    if (!players.some(player => player.uid === action.targetUid)) return;
    if (gameDeaths[action.targetUid]) return;

    const death = {
      deadAt: Date.now(),
      killedBy: actorUid,
      cause: actorRole === "sheriff" && targetRole !== "murderer" ? "sheriff_wrong_target" : "role_action"
    };

    const updates = {};
    updates["gameState/" + currentLobbyCode + "/deaths/" + action.targetUid] = death;

    if (actorRole === "sheriff" && targetRole !== "murderer") {
      updates["gameState/" + currentLobbyCode + "/deaths/" + actorUid] = {
        deadAt: Date.now(),
        killedBy: actorUid,
        cause: "sheriff_wrong_target"
      };
    }

    await update(ref(db), updates);
  } catch (error) {
    console.error("Could not process game action:", error);
  }
}

function startGameActionListener() {
  if (gameActionUnsubscribe) {
    gameActionUnsubscribe();
    gameActionUnsubscribe = null;
  }

  processedGameActions.clear();

  if (currentMode !== "host" && currentMode !== "host-player") return;
  if (!currentUser || !currentLobbyCode) return;

  const actionsRef = ref(db, "gameActions/" + currentLobbyCode);
  gameActionUnsubscribe = onValue(actionsRef, snapshot => {
    const actions = snapshot.val() || {};
    Object.entries(actions).forEach(([actorUid, actorActions]) => {
      Object.entries(actorActions || {}).forEach(([actionId, action]) => {
        processGameAction(actorUid, actionId, action);
      });
    });
  }, error => {
    console.error("Game action listener error:", error);
  });
}

async function renderGameScreen(lobby) {
  const roleName = document.getElementById("game-role-name");
  const roleDescription = document.getElementById("game-role-description");
  const gameStatus = document.getElementById("game-status-text");
  const hostBoard = document.getElementById("host-role-board");
  const hostList = document.getElementById("host-role-list");

  if (!roleName || !roleDescription || !gameStatus) return;

  gameStatus.textContent = "Game is live. Your private role is only shown on this device.";
  hostBoard.style.display = "none";
  hostList.innerHTML = "";

  try {
    const mine = await loadMyRole();
    myGameRole = mine;

    if (mine) {
      roleName.textContent = mine.roleName;
      roleDescription.textContent =
        mine.roleId === "murderer" ? "Your objective is to eliminate the other players." :
        mine.roleId === "sheriff" ? "Your objective is to identify and stop the Murderer." :
        "Your objective is to survive the game and complete the future task system.";
    } else if (currentMode === "host") {
      roleName.textContent = "Host";
      roleDescription.textContent = "You are hosting this game and are not assigned a player role.";
    } else {
      roleName.textContent = "Role unavailable";
      roleDescription.textContent = "Your private role could not be loaded.";
    }

    const deathVisibility = lobby.settings?.mm2?.deathVisibility || DEFAULT_DEATH_VISIBILITY;
    startGameDeathListeners(deathVisibility);

    if (currentMode === "host" && currentUser) {
      const allRoles = await get(ref(db, "gamePrivate/" + currentLobbyCode));
      const assignments = allRoles.val() || {};
      hostBoard.style.display = "block";

      players.forEach(player => {
        const assignment = assignments[player.uid];
        const row = document.createElement("div");
        row.className = "player-row";

        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = player.name;

        const role = document.createElement("span");
        role.className = "player-badge";
        role.textContent = assignment?.roleName || "Unknown";

        row.appendChild(name);
        row.appendChild(role);
        hostList.appendChild(row);
      });
    }

    if (currentMode === "host" || currentMode === "host-player") {
      startGameActionListener();
    }
  } catch (error) {
    console.error(error);
    gameStatus.textContent = "Game is live, but the private role could not be loaded.";
  }
}

function renderRoleConfiguration(roles = getDefaultRoleConfiguration()) {
  const list = document.getElementById("role-list");
  const status = document.getElementById("role-configuration-status");
  if (!list) return;

  const normalized = normalizeRoleConfiguration(roles);
  list.innerHTML = "";

  normalized.forEach(role => {
    const row = document.createElement("div");
    row.className = "role-row";

    const info = document.createElement("div");
    info.className = "role-info";

    const name = document.createElement("span");
    name.className = "role-name";
    name.textContent = role.name;

    const description = document.createElement("span");
    description.className = "role-description";
    description.textContent = DEFAULT_MM2_ROLES.find(item => item.id === role.id)?.description || "";

    info.appendChild(name);
    info.appendChild(description);

    const amount = document.createElement("select");
    amount.className = "role-amount";
    amount.setAttribute("aria-label", role.name + " player count");

    for (let i = 0; i <= Math.max(12, players.length); i++) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = String(i);
      amount.appendChild(option);
    }

    const autoOption = document.createElement("option");
    autoOption.value = "auto";
    autoOption.textContent = "AUTO";
    amount.appendChild(autoOption);

    amount.value = role.amount;
    amount.addEventListener("change", () => updateRoleAmount(role.id, amount.value));

    row.appendChild(info);
    row.appendChild(amount);
    list.appendChild(row);
  });

  if (status) status.textContent = getRoleConfigurationSummary(normalized);
  updateStartGameState();
}

async function updateRoleAmount(roleId, amount) {
  if (!canManagePlayers() || !currentUser || !currentLobbyCode) return;

  const currentRoles = normalizeRoleConfiguration(
    window.currentRoleConfiguration || getDefaultRoleConfiguration()
  );

  const updated = currentRoles.map(role =>
    role.id === roleId ? { ...role, amount } : role
  );

  window.currentRoleConfiguration = updated;
  renderRoleConfiguration(updated);

  const status = document.getElementById("role-configuration-status");
  if (status) status.textContent = "Saving role configuration...";

  try {
    await set(ref(db, "lobbies/" + currentLobbyCode + "/settings/mm2/roles"), updated);
    if (status) status.textContent = getRoleConfigurationSummary(updated);
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "Could not save role configuration. Please try again.";
  }
}

window.currentRoleConfiguration = getDefaultRoleConfiguration();

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


function getDeathVisibilityLabel(value) {
  if (value === "host") return "deaths are shown on the host screen";
  if (value === "all") return "deaths are shown on all screens";
  return "deaths are hidden";
}

function getDeathVisibilitySliderValue(value) {
  if (value === "host") return 1;
  if (value === "all") return 2;
  return 0;
}

function getDeathVisibilityFromSliderValue(value) {
  if (Number(value) === 1) return "host";
  if (Number(value) === 2) return "all";
  return "none";
}

function getDeathVisibilityCurrentLabel(value) {
  if (value === "host") return "Host only";
  if (value === "all") return "Everyone";
  return "Nothing";
}

function renderDeathVisibility(value = DEFAULT_DEATH_VISIBILITY) {
  const selected = value === "host" || value === "all" ? value : DEFAULT_DEATH_VISIBILITY;
  const slider = document.getElementById("death-visibility-slider");
  if (slider) slider.value = getDeathVisibilitySliderValue(selected);

  const currentLabel = document.getElementById("death-visibility-current-label");
  if (currentLabel) currentLabel.textContent = getDeathVisibilityCurrentLabel(selected);

  const status = document.getElementById("death-visibility-status");
  if (status) status.textContent = "Saved setting: " + getDeathVisibilityLabel(selected) + ".";
}

async function saveDeathVisibility(value) {
  if (!canManagePlayers() || !currentUser || !currentLobbyCode) return;

  const allowed = ["none", "host", "all"];
  if (!allowed.includes(value)) return;

  const status = document.getElementById("death-visibility-status");
  if (status) status.textContent = "Saving...";

  try {
    await set(ref(db, "lobbies/" + currentLobbyCode + "/settings/mm2/deathVisibility"), value);
    if (status) status.textContent = "Saved setting: " + getDeathVisibilityLabel(value) + ".";
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "Could not save this setting. Please try again.";
  }
}


function updateManagementSummary() {
  const count = players.length;
  const text = count === 0 ? "No players connected" : count === 1 ? "1 player connected" : count + " players connected";
  const hostStatus = document.getElementById("host-status");
  if (hostStatus && currentLobbyCode) hostStatus.textContent = text + ".";
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
  if (player.host && player.uid === currentUser?.uid) {
    badge.textContent = "HOST • YOU";
  } else if (player.host) {
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
  updateManagementSummary();
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

    renderDeathVisibility(lobby.settings?.mm2?.deathVisibility || DEFAULT_DEATH_VISIBILITY);
    window.currentRoleConfiguration = normalizeRoleConfiguration(lobby.settings?.mm2?.roles);
    renderRoleConfiguration(window.currentRoleConfiguration);

    if (lobby.status === "in_progress") {
      renderGameScreen(lobby);
      showScreen("game-screen");
    }

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

  const existingNames = Object.values(lobby.players || {}).map(player => String(player.name || "").trim().toLowerCase());
  if (existingNames.includes(name.toLowerCase())) {
    throw new Error("That player name is already in this lobby. Choose another name.");
  }

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
        await remove(ref(db, "gamePrivate/" + currentLobbyCode));
        await remove(ref(db, "gameState/" + currentLobbyCode));
        await remove(ref(db, "gameActions/" + currentLobbyCode));
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


const deathVisibilitySlider = document.getElementById("death-visibility-slider");
if (deathVisibilitySlider) {
  deathVisibilitySlider.addEventListener("input", () => {
    const value = getDeathVisibilityFromSliderValue(deathVisibilitySlider.value);
    const currentLabel = document.getElementById("death-visibility-current-label");
    if (currentLabel) currentLabel.textContent = getDeathVisibilityCurrentLabel(value);
  });

  deathVisibilitySlider.addEventListener("change", () => {
    if (!canManagePlayers()) return;
    saveDeathVisibility(getDeathVisibilityFromSliderValue(deathVisibilitySlider.value));
  });
}

document.getElementById("continue-game-setup-btn").addEventListener("click", async () => {
  if (!currentUser || !currentLobbyCode || selectedGame !== "mm2") return;

  try {
    await set(ref(db, "lobbies/" + currentLobbyCode + "/settings/gameType"), selectedGame);
    await set(ref(db, "lobbies/" + currentLobbyCode + "/settings/gameName"), "Murder Mystery 2");
    document.getElementById("setup-player-count").textContent = players.length;
    document.getElementById("setup-lobby-code").textContent = currentLobbyCode;
    renderPlayers();
    updateStartGameState();
    showScreen("game-setup-screen");
  } catch (error) {
    console.error(error);
    alert("Could not save the game selection. Please try again.");
  }
});


document.getElementById("start-game-btn").addEventListener("click", startGame);

document.getElementById("game-leave-btn").addEventListener("click", async () => {
  await leaveLobby();
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
