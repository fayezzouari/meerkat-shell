import { isLocalInstall } from "../data/install.js";
import InstallCommand from "./InstallCommand.jsx";
import OsSupport from "./OsSupport.jsx";

export default function Hero() {
  const local = isLocalInstall();

  return (
    <main id="top" className="hero container">
      <div className="hero-main">
        <p className="eyebrow">A terminal that stays awake</p>
        <h1>
          Your shell keeps<br />
          <em>running</em> after you<br />
          close the window.
        </h1>
        <p className="lede">
          Meerkat keeps your shell alive outside of any window. Start something long,
          close the terminal, open a new one tomorrow — your work is still there,
          still running, waiting for you.
        </p>
        <InstallCommand
          id="install"
          note={
            local ? (
              <>
                Installs from this server into <span>~/.meerkat</span> — engine, terminal
                app, and command line.
              </>
            ) : (
              <>
                One command, then you have it.{" "}
                <span>Nothing is published yet — this link is a placeholder.</span>
              </>
            )
          }
        />
      </div>
      <OsSupport />
    </main>
  );
}
