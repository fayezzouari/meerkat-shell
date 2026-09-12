import { REPO_URL } from "../data/install.js";

const AUTHOR_URL = "https://github.com/fayezzouari";

export default function Footer() {
  return (
    <footer className="foot">
      <span>Meerkat — a shell with its engine on the outside.</span>
      <span className="foot-dim">
        Developed by{" "}
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
          Fayez Zouari
        </a>{" "}
        &middot;{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </span>
    </footer>
  );
}
