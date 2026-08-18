import { REPO_URL, VERSION } from "../data/install.js";
import SessionBoard from "./SessionBoard.jsx";

// The claim on the left, the thing itself on the right.
//
// The right column used to be a download card: a disk image, an app icon walking
// into a folder. That is a picture of installing software, and every project has
// one. What Meerkat has that other shells do not is sessions that outlive the
// window they were started in — so the hero shows that instead.
//
// No install control here either: the nav carries one at every scroll position,
// and the end of the page carries the full pair of paths. A hero that both makes
// the claim and sells the file makes each of them smaller.
export default function Hero() {
  return (
    <main id="top" className="hero container">
      <div className="hero-main">
        <p className="label">persistent shell sessions</p>
        <h1>
          Your shell keeps<br />
          <em>running</em> after you<br />
          close the window.
        </h1>
        <p className="lede">
          Meerkat keeps your shell alive outside of any window. Start something long,
          close the terminal, open a new one tomorrow and your work is still there,
          still running, waiting for you.
        </p>

        <p className="proof">
          {VERSION && <span>v{VERSION}</span>}
          <span>macOS · Linux</span>
          <a href={REPO_URL}>Source on GitHub</a>
        </p>
      </div>

      <div className="hero-art">
        <SessionBoard />
      </div>
    </main>
  );
}
