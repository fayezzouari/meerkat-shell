import Architecture from "./components/Architecture.jsx";
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
export default function App() {
  const demo = useDaemonDemo();

  return (
    <>
      <a className="skip" href="#install">Skip to install</a>

      <div className="surface">
        <Nav />
        <Hero />
        <CrossingDemo demo={demo} />
      </div>

      <GroundLine demo={demo} />

      <div className="burrow">
        <div className="container">
          <DaemonPanel demo={demo} />
          <Architecture />
          <Features />
          <Stack />
          <Limits />
          <CloseCta />
          <Footer />
        </div>
      </div>
    </>
  );
}
