import { INSTALL_CMD } from "../data/content.js";
import { useCopy } from "../hooks/useCopy.js";

export default function InstallCommand({ id, note, tone = "light" }) {
  const { copy, label, state } = useCopy(INSTALL_CMD);

  return (
    <div className={`install ${tone === "dark" ? "install-dark" : ""}`} id={id}>
      <div className="install-cmd">
        <code>{INSTALL_CMD}</code>
        <button
          type="button"
          onClick={copy}
          className={state === "copied" ? "done" : undefined}
          aria-label="Copy install command"
        >
          {label}
        </button>
      </div>
      {note && <p className="install-note">{note}</p>}
    </div>
  );
}
