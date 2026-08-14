import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const INSTALLER = "public/install.sh";
const DOWNLOAD_LINE = /^DEFAULT_DOWNLOAD_URL=.*$/m;

const stripSlash = (url) => url.replace(/\/+$/, "");
const withScheme = (host) => (/^https?:\/\//.test(host) ? host : `https://${host}`);

function siteUrl() {
  const configured =
    process.env.MEERKAT_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;
  return configured ? stripSlash(withScheme(configured)) : "";
}

function installerDownloadUrl() {
  const source = () => readFileSync(resolve(__dirname, INSTALLER), "utf8");
  const withDownloads = (text, url) =>
    text.replace(DOWNLOAD_LINE, `DEFAULT_DOWNLOAD_URL="${url}"`);

  return {
    name: "meerkat-installer-download-url",

    configureServer(server) {
      server.middlewares.use("/install.sh", (req, res) => {
        const host = req.headers.host ?? "localhost";
        const scheme = server.config.server.https ? "https" : "http";
        const body = withDownloads(source(), `${scheme}://${host}/downloads/latest`);
        res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },

    closeBundle() {
      const url = process.env.MEERKAT_DOWNLOAD_URL;
      if (!url) return;
      const out = resolve(__dirname, "dist/install.sh");
      writeFileSync(out, withDownloads(readFileSync(out, "utf8"), stripSlash(url)));
      this.info(`install.sh will download from ${url}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), installerDownloadUrl()],
  server: { port: 5273 },
  define: { __MEERKAT_SITE_URL__: JSON.stringify(siteUrl()) },
  base: "./",
});
