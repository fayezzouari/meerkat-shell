import { useRef } from "react";
import Architecture from "./components/Architecture.jsx";
import Branch from "./components/Branch.jsx";
import CloseCta from "./components/CloseCta.jsx";
import CrossingDemo from "./components/CrossingDemo.jsx";
import DaemonPanel from "./components/DaemonPanel.jsx";
import Features from "./components/Features.jsx";
import Footer from "./components/Footer.jsx";
import GroundLine from "./components/GroundLine.jsx";
import Hero from "./components/Hero.jsx";
import Limits from "./components/Limits.jsx";
import Nav from "./components/Nav.jsx";
import Stack from "./components/Stack.jsx";
import { useDaemonDemo } from "./hooks/useDaemonDemo.js";

// The page is a cross-section of ground: .surface is daylight, .burrow is
// below it, and GroundLine is the single crossing between them. The demo state
// spans that crossing on purpose — the window sits above it, the engine below.
//
// The branch joins the window to the engine's panel, so it cannot live inside
// either section. It is a page-level overlay, last in the DOM so it paints over
// both, positioned from the geometry it measures.
export default function App() {
  const demo = useDaemonDemo();

  const pageRef = useRef(null);
  const windowRef = useRef(null);
  const panelRef = useRef(null);
  const groundRef = useRef(null);

  return (
    <div className="page" ref={pageRef}>
      <a className="skip" href="#install">Skip to install</a>

      <div className="surface">
        <Nav />
        <Hero />
        <CrossingDemo demo={demo} windowRef={windowRef} />
      </div>

      <GroundLine groundRef={groundRef} />

      <div className="burrow">
        <div className="container">
          <DaemonPanel demo={demo} panelRef={panelRef} />
          <Architecture />
          <Features />
          <Stack />
          <Limits />
          <CloseCta />
          <Footer />
        </div>
      </div>

      <Branch
        pageRef={pageRef}
        windowRef={windowRef}
        panelRef={panelRef}
        groundRef={groundRef}
        live={Boolean(demo.job)}
        active={Boolean(demo.job) && demo.windowOpen}
      />
    </div>
  );
}
