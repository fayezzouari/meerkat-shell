import { COMPONENTS } from "../data/content.js";
import Rich from "./Rich.jsx";
import Section from "./Section.jsx";

export default function Architecture() {
  return (
    <Section
      id="how"
      label="How it works"
      title="One engine, however many windows"
      lede="Most shells live and die inside a window. Meerkat puts the engine underneath, and lets windows come and go on top of it."
    >
      <div className="parts">
        {COMPONENTS.map((part) => (
          <article className="part" key={part.name}>
            <h3>{part.name}</h3>
            <p className="part-kind">{part.kind}</p>
            <p><Rich text={part.body} /></p>
          </article>
        ))}
      </div>
      <p className="aside">
        Because the engine holds the state, a window is only a view of it. Close one,
        open another, use a different one entirely — you are looking at the same shell.
      </p>
    </Section>
  );
}
