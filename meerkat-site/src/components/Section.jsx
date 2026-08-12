import { useReveal } from "../hooks/useReveal.js";

export default function Section({ id, label, title, lede, className = "", children }) {
  const ref = useReveal();

  return (
    <section id={id} className={`section reveal ${className}`} ref={ref}>
      {label && <p className="label">{label}</p>}
      {title && <h2 className="h2">{title}</h2>}
      {lede && <p className="section-lede">{lede}</p>}
      {children}
    </section>
  );
}
