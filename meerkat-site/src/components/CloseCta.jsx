import { useReveal } from "../hooks/useReveal.js";
import { isLocalInstall } from "../data/install.js";
import InstallCommand from "./InstallCommand.jsx";
import OsSupport from "./OsSupport.jsx";

// The only install on the page now, at the end — the hero makes the claim and
// stops there. The nav's Install button and the skip link both land on the
// command below, which is why it carries the #install anchor.
//
// The compatibility card lives here too: what machines it runs on is a question
// you ask once you have decided you want it, not while you are still reading the
// first sentence.
export default function CloseCta() {
  const ref = useReveal();
  const local = isLocalInstall();

  return (
    <section className="section close reveal" id="other" ref={ref}>
      <h2 className="h2 close-h">Put the engine outside the window.</h2>
      <div className="close-grid">
        <InstallCommand
          id="install"
          tone="dark"
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
        <OsSupport />
      </div>
    </section>
  );
}
