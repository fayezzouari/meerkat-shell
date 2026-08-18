import { LIMITS } from "../data/content.js";
import Rich from "./Rich.jsx";
import Section from "./Section.jsx";

export default function Limits() {
  return (
    <Section id="limits" label="Not there yet" title="Two things to know first" className="limits">
      <div className="limit-grid">
        {LIMITS.map((limit, i) => (
          <article key={limit.title} style={{ "--i": i }}>
            <h3>{limit.title}</h3>
            <p><Rich text={limit.body} /></p>
          </article>
        ))}
      </div>
    </Section>
  );
}
