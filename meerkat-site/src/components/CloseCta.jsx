import InstallCommand from "./InstallCommand.jsx";

export default function CloseCta() {
  return (
    <section className="section close">
      <h2 className="h2 close-h">Put the engine outside the window.</h2>
      <InstallCommand
        tone="dark"
        note={
          <>
            macOS &middot; Linux &middot; Windows &nbsp;|&nbsp;{" "}
            <span>placeholder URL — build from source for now</span>
          </>
        }
      />
    </section>
  );
}
