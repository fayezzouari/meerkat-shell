import * as keymap from "./keymap.js";

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Preferences overlay: lists every remappable shortcut (see keymap.js) and
// lets the user click "Change" then press a new combo to rebind it. Same
// plain DOM/CSS approach as jobsOverlay.js — opened from the native App
// menu's "Preferences…" item (main.js listens for the "preferences:open"
// Wails event) rather than a keyboard shortcut of its own, since Cmd+, is
// already claimed by macOS convention for exactly this and Wails routes it
// straight to the menu item.
export function createPreferencesOverlay() {
  const root = document.createElement("div");
  root.id = "prefs-overlay";
  root.classList.add("hidden");
  document.body.appendChild(root);

  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  let recordingId = null; // action id currently waiting for a keypress, else null.

  function renderRow(action) {
    const recording = action.id === recordingId;
    const comboLabel = recording ? "Press new shortcut… (Esc to cancel)" : escapeHtml(keymap.describeCombo(action.binding));
    return `
      <div class="prefs-row${recording ? " prefs-row-recording" : ""}" data-id="${action.id}">
        <div class="prefs-row-text">
          <div class="prefs-row-label">${escapeHtml(action.label)}</div>
          ${action.description ? `<div class="prefs-row-desc">${escapeHtml(action.description)}</div>` : ""}
        </div>
        <div class="prefs-row-combo">${comboLabel}</div>
        <button class="prefs-btn prefs-btn-change" data-action="change">${recording ? "Cancel" : "Change"}</button>
        <button class="prefs-btn prefs-btn-reset" data-action="reset">Reset</button>
      </div>
    `;
  }

  function render() {
    const rows = keymap.listActions().map(renderRow).join("");
    root.innerHTML = `
      <div class="overlay-panel prefs-panel">
        <div class="overlay-heading">Keyboard Shortcuts</div>
        ${rows}
        <div class="prefs-footer">
          <button class="prefs-btn prefs-btn-reset-all">Reset All to Defaults</button>
        </div>
      </div>
    `;

    root.querySelectorAll(".prefs-row").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-action="change"]').addEventListener("click", (event) => {
        event.stopPropagation();
        recordingId = recordingId === id ? null : id;
        render();
      });
      row.querySelector('[data-action="reset"]').addEventListener("click", (event) => {
        event.stopPropagation();
        keymap.resetBinding(id);
        render();
      });
    });
    root.querySelector(".prefs-btn-reset-all").addEventListener("click", (event) => {
      event.stopPropagation();
      keymap.resetAll();
      recordingId = null;
      render();
    });
  }

  // Captures the very next keydown anywhere while a row is in "recording"
  // mode — used=true swallows it so it never reaches xterm.js/the rest of
  // the app (there's no session focused behind the overlay anyway, but a
  // stray Enter/Escape shouldn't leak through regardless).
  document.addEventListener(
    "keydown",
    (event) => {
      if (!recordingId) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        recordingId = null;
        render();
        return;
      }
      // Modifier keys pressed alone aren't a usable combo — keep waiting.
      if (["Control", "Alt", "Meta", "Shift"].includes(event.key)) return;
      keymap.setBinding(recordingId, keymap.comboFromEvent(event));
      recordingId = null;
      render();
    },
    true, // capture — must win the race against session.js's own attachCustomKeyEventHandler
  );

  let visible = false;

  function open() {
    visible = true;
    recordingId = null;
    root.classList.remove("hidden");
    render();
  }

  function close() {
    visible = false;
    recordingId = null;
    root.classList.add("hidden");
  }

  function toggle() {
    if (visible) close();
    else open();
  }

  return { open, close, toggle };
}
