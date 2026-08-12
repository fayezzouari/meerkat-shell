import { STACK } from "../data/content.js";
import Rich from "./Rich.jsx";
import Section from "./Section.jsx";

export default function Stack() {
  return (
    <Section id="stack" label="Built with" title="Four choices, one reason">
      <ul className="stack">
        {STACK.map((item, i) => (
          <li key={item.name} style={{ "--i": i }}>
            <b>{item.name}</b>
            <span><Rich text={item.body} /></span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
