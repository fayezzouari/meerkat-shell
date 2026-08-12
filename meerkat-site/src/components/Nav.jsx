const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#stack", label: "Built with" },
];

export default function Nav() {
  return (
    <header className="nav container">
      <a className="brand" href="#top">
        <img src="/meerkat-logo.png" alt="" width="20" height="35" />
        <span>Meerkat</span>
      </a>
      <nav aria-label="Sections">
        {LINKS.map(({ href, label }) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </nav>
      <a className="nav-cta" href="#install">Install</a>
    </header>
  );
}
