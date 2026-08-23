import { useEffect, useId, useState } from "react";
import {
  DOWNLOAD_FILES,
  DOWNLOAD_PLATFORMS,
  detectOs,
  downloadUrl,
  isLocalInstall,
} from "../data/install.js";
import InstallCommand from "./InstallCommand.jsx";
import { useCopy } from "../hooks/useCopy.js";

const OS_LABEL = { macos: "macOS", linux: "Linux" };

// The two commands that install a downloaded file, with the visitor's own
// filename already in them. Both are needed and neither is obvious: the tarball
// is flat — install.sh, engine/ and the app sit at its top level — so it wants a
// directory of its own, and `tar` will not create one for you.
function DownloadSteps({ file }) {
  const script = `mkdir -p meerkat && tar -xzf ~/Downloads/${file} -C meerkat\n./meerkat/install.sh`;
  const { copy, label, state } = useCopy(script);

  return (
    <div className="dl-steps">
      <div className="dl-steps-lines">
        {script.split("\n").map((line) => (
          <code key={line}>{line}</code>
        ))}
      </div>
      <button
        type="button"
        onClick={copy}
        className={state === "copied" ? "done" : undefined}
        aria-label="Copy the install commands"
      >
        {label}
      </button>
    </div>
  );
}

// Two ways in, and the page does not decide which is right for you.
//
// They install the same thing: engine, terminal app, command line, all under
// ~/.meerkat. The command is faster if a terminal is already open, which for
// this audience it usually is — so it leads. The file is for people who would
// rather see what they are running before they run it, which is a fair thing to
// want from a shell.
export default function InstallChoice({ id, tone = "light" }) {
  const [mode, setMode] = useState("command");
  const [os, setOs] = useState("unknown");
  const local = isLocalInstall();
  const tabId = useId();

  useEffect(() => setOs(detectOs()), []);

  // The detected platform's files first; the others stay reachable underneath,
  // since people download for machines they are not sitting at.
  const mine = DOWNLOAD_FILES[os] ?? [];
  const others = DOWNLOAD_PLATFORMS.filter((p) => p !== os).flatMap((p) =>
    (DOWNLOAD_FILES[p] ?? []).map((asset) => ({ ...asset, platform: p })),
  );

  return (
    <div className={`choice ${tone === "dark" ? "choice-dark" : ""}`} id={id}>
      <div className="choice-tabs" role="tablist" aria-label="How to install">
        {[
          ["command", "Command line"],
          ["download", "Download a file"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${tabId}-${value}`}
            aria-selected={mode === value}
            aria-controls={`${tabId}-${value}-panel`}
            className="choice-tab"
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "command" ? (
        <div
          role="tabpanel"
          id={`${tabId}-command-panel`}
          aria-labelledby={`${tabId}-command`}
          className="choice-panel"
        >
          <InstallCommand
            tone={tone}
            note={
              local ? (
                <>
                  Installs from this server into <span>~/.meerkat</span> — engine,
                  terminal app, and command line.
                </>
              ) : (
                <>
                  One command, then you have it.{" "}
                  <span>Installs the latest release into ~/.meerkat.</span>
                </>
              )
            }
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${tabId}-download-panel`}
          aria-labelledby={`${tabId}-download`}
          className="choice-panel"
        >
          {mine.length > 0 && (
            <div className="dl-primary">
              {mine.map((asset, i) => (
                <a
                  key={asset.id}
                  className={`btn ${i === 0 ? "primary" : "ghost"} dl-btn`}
                  href={downloadUrl(asset.file)}
                >
                  {asset.label}
                  <span className="dl-detail">{asset.detail}</span>
                </a>
              ))}
            </div>
          )}

          {os === "windows" && (
            <p className="dl-none">
              There is no native Windows build — the engine's job control is POSIX to the
              core. Run Meerkat inside WSL2 with the Linux file below.
            </p>
          )}
          {(os === "ios" || os === "android" || os === "unknown") && (
            <p className="dl-none">
              Pick the file for the machine you want it on:
            </p>
          )}

          {others.length > 0 && (
            <p className="dl-others">
              {os !== "windows" && os !== "unknown" && os !== "ios" && os !== "android"
                ? "Or: "
                : null}
              {others.map((asset, i) => (
                <span key={asset.id}>
                  {i > 0 && " · "}
                  <a href={downloadUrl(asset.file)}>
                    {OS_LABEL[asset.platform] ?? asset.platform} ({asset.detail})
                  </a>
                </span>
              ))}
            </p>
          )}

          {mine.length > 0 && <DownloadSteps file={mine[0].file} />}

          <p className="install-note dl-note">
            {os === "macos" ? (
              <>
                Run them in Terminal, not the Finder — the Finder flags what it
                unpacks and macOS then refuses to open the app.
              </>
            ) : (
              <>Same install as the command above.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
