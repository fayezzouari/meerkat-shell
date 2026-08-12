import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const INSTALLER = "public/install.sh";
const DEFAULT_LINE = /^DEFAULT_BASE_URL=.*$/m;

// A piped installer cannot see the URL it was fetched from, so the server bakes
// it in on the way out: whatever host answers for /install.sh becomes the host
// the script downloads the release from. That makes
//   curl -fsSL <host>/install.sh | sh
// correct from a dev server, a staging box, or production, with no environment
// variable to remember. MEERKAT_BASE_URL still overrides it.
function installerBaseUrl() {
  const source = () => readFileSync(resolve(__dirname, INSTALLER), "utf8");
  const withBase = (text, base) =>
    text.replace(DEFAULT_LINE, `DEFAULT_BASE_URL="${base}"`);

  return {
    name: "meerkat-installer-base-url",

    configureServer(server) {
      server.middlewares.use("/install.sh", (req, res) => {
        const host = req.headers.host ?? "localhost";
        // Dev is plain HTTP unless https is configured for the server.
        const scheme = server.config.server.https ? "https" : "http";
        const body = withBase(source(), `${scheme}://${host}`);
        res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },

    // A build has no request to read a host from, so it takes one from the
    // environment and otherwise leaves the script's own default alone.
    closeBundle() {
      const base = process.env.MEERKAT_SITE_URL;
      if (!base) return;
      const out = resolve(__dirname, "dist/install.sh");
      writeFileSync(out, withBase(readFileSync(out, "utf8"), base.replace(/\/$/, "")));
      this.info(`install.sh will download from ${base}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), installerBaseUrl()],
  server: { port: 5273 },
  // Relative base so a built page also opens straight off disk.
  base: "./",
});
