import { OPERATING_SYSTEMS } from "../data/content.js";

export default function OsSupport() {
  return (
    <aside className="runs-on" aria-labelledby="runs-on-h">
      <h2 className="runs-on-h" id="runs-on-h">Runs on</h2>
      <ul>
        {OPERATING_SYSTEMS.map((os) => (
          <li key={os.id}>
            <span className="os-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d={os.path} /></svg>
            </span>
            <strong>{os.name}</strong>
            <span className="os-detail">{os.detail}</span>
          </li>
        ))}
      </ul>
      <p className="runs-on-foot">The installer picks the right build for your machine.</p>
    </aside>
  );
}
