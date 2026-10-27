#!/usr/bin/env node
/* Cross-checks translatable strings used via t()/tc()/tn() in src/ against
 * the entries in po/*.po.  Exits non-zero when a msgid is missing from a
 * po file or when a po entry is not referenced by the code. */

import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const PODIR = path.resolve(import.meta.dirname, "..", "po");

/* --- collect (context, msgid) pairs and plural pairs from the source --- */

const used = new Map();        // "ctx\x04msgid" -> { ctx, msgid, refs: [] }
const usedPlural = new Map();  // msgid (singular) -> { plural, refs: [] }
const dynCtx = new Set();      // contexts passed to tc() dynamically

const unescape = s => {
    try { return JSON.parse(`"${s}"`); } catch { return s; }
};

function addUse(ctx, msgid, ref) {
    const key = (ctx ? ctx + "\u0004" : "") + msgid;
    if (!used.has(key))
        used.set(key, { ctx, msgid, refs: [] });
    used.get(key).refs.push(ref);
}

function scan(file) {
    const rel = path.relative(path.resolve(import.meta.dirname, ".."), file);
    const text = fs.readFileSync(file, "utf8");
    // strip comments so t( inside them is not picked up
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    for (const m of code.matchAll(/\btc\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,/g))
        dynCtx.add(unescape(m[2]));

    for (const m of code.matchAll(/\btc\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,\s*(["'])((?:\\.|(?!\3).)*)\3/gs))
        addUse(unescape(m[2]), unescape(m[4]), rel);

    for (const m of code.matchAll(/\btn\(\s*[^,]+,\s*(["'])((?:\\.|(?!\1).)*)\1\s*,\s*(["'])((?:\\.|(?!\3).)*)\3/gs)) {
        const sing = unescape(m[2]);
        usedPlural.set(sing, { plural: unescape(m[4]), refs: [...(usedPlural.get(sing)?.refs || []), rel] });
    }

    for (const m of code.matchAll(/\bt\(\s*(["'])((?:\\.|(?!\1).)*)\1/gs)) {
        const msgid = unescape(m[2]);
        if (msgid === "") continue;
        addUse(null, msgid, rel);
    }
}

function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|tsx?)$/.test(e.name)) scan(p);
    }
}
walk(SRC);

/* --- parse po files (simple state machine) --- */

function parsePo(file) {
    const entries = { plain: new Map(), plural: new Map() };
    let block = [];
    const blocks = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (line.startsWith("#") || line.trim() === "") {
            if (block.length) { blocks.push(block); block = []; }
            continue;
        }
        block.push(line);
    }
    if (block.length) blocks.push(block);

    for (const b of blocks) {
        const text = b.join("\n");
        if (!/^\s*msgid /m.test(text) || /msgid ""/.test(text))
            continue; // header
        const ctxM = text.match(/msgctxt\s+"((?:[^"\\]|\\.)*)"/);
        const idM = text.match(/msgid\s+"((?:[^"\\]|\\.)*)"/);
        const idpM = text.match(/msgid_plural\s+"((?:[^"\\]|\\.)*)"/);
        if (!idM) continue;
        const ctx = ctxM ? JSON.parse(`"${ctxM[1]}"`) : null;
        const msgid = JSON.parse(`"${idM[1]}"`);
        if (idpM) {
            entries.plural.set(msgid, JSON.parse(`"${idpM[1]}"`));
            // plural entries are looked up without context in cockpit.ngettext
            entries.plural.set("\u0000" + msgid, ctx);
        } else {
            const key = (ctx ? ctx + "\u0004" : "") + msgid;
            entries.plain.set(key, { ctx, msgid });
        }
    }
    return entries;
}

/* --- compare --- */

let missing = 0, unused = 0;

const poFiles = fs.readdirSync(PODIR).filter(f => f.endsWith(".po"));
if (poFiles.length === 0) {
    console.error("no .po files found in po/");
    process.exit(1);
}

for (const poFile of poFiles) {
    const entries = parsePo(path.join(PODIR, poFile));

    for (const { ctx, msgid, refs } of used.values()) {
        const key = (ctx ? ctx + "\u0004" : "") + msgid;
        if (!entries.plain.has(key)) {
            console.error(`${poFile}: missing msgid ${ctx ? `[${ctx}] ` : ""}${JSON.stringify(msgid)}  (used at ${refs.join(", ")})`);
            missing++;
        }
    }
    for (const [msgid, { plural, refs }] of usedPlural) {
        if (!entries.plural.has(msgid)) {
            console.error(`${poFile}: missing plural msgid ${JSON.stringify(msgid)} / ${JSON.stringify(plural)}  (used at ${refs.join(", ")})`);
            missing++;
        }
    }
    for (const [key, { ctx }] of entries.plain) {
        /* entries whose msgid is chosen dynamically (e.g. tc("kind", c.kind))
         * count as used when their context appears in a tc() call at all */
        if (!used.has(key) && !(ctx && dynCtx.has(ctx))) {
            console.error(`${poFile}: unused entry ${JSON.stringify(key)}`);
            unused++;
        }
    }
    for (const [msgid, ctx] of entries.plural) {
        if (msgid.startsWith("\u0000")) continue;
        if (!usedPlural.has(msgid))
            console.error(`${poFile}: unused plural entry ${JSON.stringify(msgid)}${ctx ? ` [${ctx}]` : ""}`);
    }
}

console.log(`checked ${used.size} strings + ${usedPlural.size} plural pairs against ${poFiles.length} po file(s)`);
if (missing || unused) {
    console.error(`PROBLEMS: ${missing} missing, ${unused} unused`);
    process.exit(1);
}
console.log("po files are in sync with the source");
