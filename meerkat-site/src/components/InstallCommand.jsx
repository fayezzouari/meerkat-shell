import { useMemo } from "react";
import { installCommand } from "../data/install.js";
import { useCopy } from "../hooks/useCopy.js";

export default function InstallCommand({ id, note, tone = "light" }) {
  const command = useMemo(() => installCommand(), []);
  const { copy, label, state } = useCopy(command);

  return (
    <div className={`install ${tone === "dark" ? "install-dark" : ""}`} id={id}>
      <div className="install-cmd">
        <code>{command}</code>
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
