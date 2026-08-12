import * as keymap from "./keymap.js";
import { THEMES, getThemeId, applyTheme } from "./themes.js";
import * as appearance from "./appearance.js";

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Opened from the native App menu's "Preferences…" item (main.js listens for
// the "preferences:open" event) rather than a shortcut of its own, since
// macOS routes Cmd+, straight to the menu item.
export function createPreferencesOverlay() {
  const root = document.createElement("div");
  root.id = "prefs-overlay";
  root.classList.add("hidden");
  document.body.appendChild(root);

  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  let recordingId = null; // action id waiting for a keypress, else null

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

  function renderThemes() {
    const activeId = getThemeId();
    return THEMES.map(
      (t) => `
        <div class="theme-card${t.id === activeId ? " theme-card-active" : ""}" data-theme-id="${t.id}"
             style="background: ${t.chrome.bgRaised}; border-color: ${t.id === activeId ? t.chrome.accent : t.chrome.border};">
          <div class="theme-swatches">
            <span class="theme-dot" style="background: ${t.chrome.bg};"></span>
            <span class="theme-dot" style="background: ${t.chrome.accent};"></span>
            <span class="theme-dot" style="background: ${t.chrome.text};"></span>
          </div>
          <div class="theme-name" style="color: ${t.chrome.text};">${escapeHtml(t.name)}</div>
          <div class="theme-desc" style="color: ${t.chrome.textDim};">${escapeHtml(t.description)}</div>
        </div>`,
    ).join("");
  }

  // Applied live on input rather than behind an Apply button: the window
  // behind this panel is the preview.
  function renderAppearance() {
    const s = appearance.getSettings();
    const imgError = appearance.getBackgroundImageError();
    const isDefaultImg = s.backgroundImagePath === appearance.DEFAULT_BACKGROUND;
    const imgName = !s.backgroundImagePath || isDefaultImg ? "" : s.backgroundImagePath.split("/").pop();
    const families = appearance.FONT_FAMILIES.map(
      (f) => `<option value="${f.id}"${f.id === s.fontFamily ? " selected" : ""}>${escapeHtml(f.name)}</option>`,
    ).join("");

    return `
      <div class="prefs-row">
        <div class="prefs-row-text">
          <div class="prefs-row-label">Background opacity</div>
          <div class="prefs-row-desc">Lower values let your desktop — or the image below — show through.</div>
        </div>
        <input class="prefs-range" id="opacity-range" type="range"
               min="${appearance.OPACITY_MIN * 100}" max="100" step="1" value="${Math.round(s.opacity * 100)}" />
        <div class="prefs-row-combo" id="opacity-value">${Math.round(s.opacity * 100)}%</div>
      </div>

      <div class="prefs-row">
        <div class="prefs-row-text">
          <div class="prefs-row-label">Terminal font</div>
          <div class="prefs-row-desc">Monospace only — xterm renders into a fixed cell grid.</div>
        </div>
        <select class="prefs-select" id="font-family">${families}</select>
      </div>

      <div class="prefs-row">
        <div class="prefs-row-text">
          <div class="prefs-row-label">Font size</div>
        </div>
        <input class="prefs-number" id="font-size" type="number"
               min="${appearance.FONT_SIZE_MIN}" max="${appearance.FONT_SIZE_MAX}" step="1" value="${s.fontSize}" />
      </div>

      <div class="prefs-row">
        <div class="prefs-row-text">
          <div class="prefs-row-label">Background image</div>
          <div class="prefs-row-desc" id="bg-image-state">${
            imgError
              ? `<span class="prefs-error">${escapeHtml(imgError)}</span>`
              : imgName
                ? escapeHtml(imgName)
                : isDefaultImg
                  ? "Meerkat mark (default) — always painted faintly"
                  : "None"
          }</div>
        </div>
        <button class="prefs-btn" id="bg-image-choose">Choose…</button>
        <button class="prefs-btn" id="bg-image-default"${isDefaultImg ? " disabled" : ""}>Default</button>
        <button class="prefs-btn" id="bg-image-clear"${s.backgroundImagePath ? "" : " disabled"}>None</button>
      </div>
    `;
  }

  function wireAppearance() {
    const range = root.querySelector("#opacity-range");
    const value = root.querySelector("#opacity-value");
    range.addEventListener("input", () => {
      // Not a full render: rebuilding the slider mid-drag drops the
      // pointer capture.
      value.textContent = `${range.value}%`;
      appearance.update({ opacity: Number(range.value) / 100 });
    });

    root.querySelector("#font-family").addEventListener("change", (e) => {
      appearance.update({ fontFamily: e.target.value });
    });

    const size = root.querySelector("#font-size");
    size.addEventListener("change", () => {
      const n = Math.max(appearance.FONT_SIZE_MIN, Math.min(appearance.FONT_SIZE_MAX, Number(size.value) || 13));
      size.value = n;
      appearance.update({ fontSize: n });
    });

    root.querySelector("#bg-image-choose").addEventListener("click", async () => {
      if (await appearance.pickBackgroundImage()) render();
    });
    root.querySelector("#bg-image-default").addEventListener("click", () => {
      appearance.update({ backgroundImagePath: appearance.DEFAULT_BACKGROUND });
      render();
    });
    root.querySelector("#bg-image-clear").addEventListener("click", () => {
      appearance.update({ backgroundImagePath: "" });
      render();
    });
  }

  function render() {
    const rows = keymap.listActions().map(renderRow).join("");
    root.innerHTML = `
      <div class="overlay-panel prefs-panel">
        <div class="overlay-heading">Theme</div>
        <div class="theme-grid">${renderThemes()}</div>
        <div class="overlay-heading">Appearance</div>
        ${renderAppearance()}
        <div class="overlay-heading">Keyboard Shortcuts</div>
        ${rows}
        <div class="prefs-footer">
          <button class="prefs-btn prefs-btn-reset-all">Reset Shortcuts to Defaults</button>
        </div>
      </div>
    `;

    wireAppearance();

    root.querySelectorAll(".theme-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        applyTheme(card.dataset.themeId);
        render();
      });
    });

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

  // Captures the next keydown anywhere while a row is recording, and swallows
  // it so it never reaches xterm.js.
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
      // A bare modifier isn't a usable combo — keep waiting.
      if (["Control", "Alt", "Meta", "Shift"].includes(event.key)) return;
      keymap.setBinding(recordingId, keymap.comboFromEvent(event));
      recordingId = null;
      render();
    },
    true, // capture — must beat session.js's attachCustomKeyEventHandler
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
