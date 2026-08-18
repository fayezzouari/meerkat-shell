import { useReveal } from "../hooks/useReveal.js";
import InstallChoice from "./InstallChoice.jsx";
import OsSupport from "./OsSupport.jsx";

// The only install on the page now, at the end — the hero makes the claim and
// stops there. The nav's Install button and the skip link both land on the
// chooser below, which is why it carries the #install anchor.
//
// The compatibility card lives here too: what machines it runs on is a question
// you ask once you have decided you want it, not while you are still reading the
// first sentence.
export default function CloseCta() {
  const ref = useReveal();

  return (
    <section className="section close reveal" id="other" ref={ref}>
      <h2 className="h2 close-h">Put the engine outside the window.</h2>
      <div className="close-grid">
        <InstallChoice id="install" tone="dark" />
        <OsSupport />
      </div>
    </section>
  );
}
