/* Build script: bundles src/index.js into dist/ and generates po.<lang>.js
 * translation files from po/*.po (see tools/cockpit-po-plugin.js).
 * cockpit-ws then serves `po.js` to the browser in the language of the
 * Cockpit session, which is how the UI follows Cockpit's language setting. */
import esbuild from "esbuild";
import { cockpitPoEsbuildPlugin } from "./tools/cockpit-po-plugin.js";

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: ["src/index.js"],
    outdir: "dist",
    bundle: true,
    format: "esm",
    jsx: "automatic",
    loader: {
        ".js": "jsx",
        ".css": "css",
        ".woff2": "file",
        ".woff": "file",
        ".ttf": "file",
        ".svg": "dataurl",
        ".png": "dataurl",
        ".jpg": "dataurl",
    },
    external: ["cockpit"],
    minify: !watch,
    sourcemap: true,
    plugins: [cockpitPoEsbuildPlugin({ outdir: "dist" })],
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}
