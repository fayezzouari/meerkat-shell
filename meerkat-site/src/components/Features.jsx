import { FEATURES } from "../data/content.js";
import Rich from "./Rich.jsx";
import Section from "./Section.jsx";

export default function Features() {
  return (
    <Section id="features" label="Features" title="What you get">
      <div className="features">
        {FEATURES.map((feature, i) => (
          <article className="feature" key={feature.title} style={{ "--i": i }}>
            <h3>{feature.title}</h3>
            <p><Rich text={feature.body} /></p>
          </article>
        ))}
      </div>
    </Section>
  );
}
