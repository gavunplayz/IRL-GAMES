// IRL Games UI fallback navigation.
// This file is intentionally separate from the Firebase/game module so basic
// screen navigation still works if the multiplayer module has a startup error.

(function () {
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (screen) {
      screen.classList.toggle("active", screen.id === id);
    });
  }

  var create = document.getElementById("create-lobby-btn");
  var join = document.getElementById("join-lobby-btn");

  if (create) create.addEventListener("click", function () {
    show("mode-screen");
  });

  if (join) join.addEventListener("click", function () {
    var code = document.getElementById("lobby-code-input");
    var name = document.getElementById("player-name-input");
    var error = document.getElementById("join-error");
    if (code) code.value = "";
    if (name) name.value = "";
    if (error) error.textContent = "";
    show("join-screen");
  });

  document.querySelectorAll("[data-back]").forEach(function (button) {
    button.addEventListener("click", function () {
      show(button.dataset.back);
    });
  });

  // If the Firebase module fails, show the error on-screen instead of silently
  // making the app appear unresponsive.
  window.addEventListener("error", function (event) {
    var message = event && event.error && event.error.message
      ? event.error.message
      : (event && event.message ? event.message : "Unknown startup error");

    var banner = document.getElementById("startup-error");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "startup-error";
      banner.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;padding:12px 14px;border-radius:10px;background:#3a1020;color:#fff;border:1px solid #f87171;font:600 13px/1.4 system-ui,sans-serif;";
      document.body.appendChild(banner);
    }
    banner.textContent = "App startup error: " + message;
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : String(reason || "Unknown promise error");
    var banner = document.getElementById("startup-error");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "startup-error";
      banner.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;padding:12px 14px;border-radius:10px;background:#3a1020;color:#fff;border:1px solid #f87171;font:600 13px/1.4 system-ui,sans-serif;";
      document.body.appendChild(banner);
    }
    banner.textContent = "App error: " + message;
  });
})();
