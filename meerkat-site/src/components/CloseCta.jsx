import { isLocalInstall } from "../data/install.js";
import { useReveal } from "../hooks/useReveal.js";
import InstallCommand from "./InstallCommand.jsx";

export default function CloseCta() {
  const local = isLocalInstall();
  const ref = useReveal();

  return (
    <section className="section close reveal" ref={ref}>
      <h2 className="h2 close-h">Put the engine outside the window.</h2>
      <InstallCommand
        tone="dark"
        note={
          local ? (
            <>
              macOS &middot; Linux &nbsp;|&nbsp; <span>serving a local build</span>
            </>
          ) : (
            <>
              macOS &middot; Linux &middot; Windows &nbsp;|&nbsp;{" "}
              <span>placeholder URL — build from source for now</span>
            </>
          )
        }
      />
    </section>
  );
}
