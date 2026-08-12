export default function Section({ id, label, title, lede, className = "", children }) {
  return (
    <section id={id} className={`section ${className}`}>
      {label && <p className="label">{label}</p>}
      {title && <h2 className="h2">{title}</h2>}
      {lede && <p className="section-lede">{lede}</p>}
      {children}
    </section>
  );
}
