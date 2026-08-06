// Bundles the small set of client-side scripts with esbuild. Each page only
// loads the entry file(s) it actually needs (see the `scripts` front-matter
// key on page templates) - most pages (Rules, static content) load none of these.
import { build } from "esbuild";
import { readdirSync } from "node:fs";

// .mjs (season-processor) is imported by these, not an entry point itself.
const entryPoints = readdirSync("src/scripts")
  .filter((f) => f.endsWith(".js"))
  .map((f) => `src/scripts/${f}`);

await build({
  entryPoints,
  bundle: true,
  minify: true,
  format: "esm",
  outdir: "_site/assets/js",
  target: "es2020",
});

console.log(`Bundled ${entryPoints.length} client script(s) to _site/assets/js/`);
