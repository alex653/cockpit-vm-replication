/* Bridge to the privileged helper + shared formatting utilities.
 * cockpit.js is loaded globally by index.html from Cockpit's base1. */

import { t, tn } from "./i18n.js";

const cockpit = window.cockpit;

const HELPER = "/usr/libexec/cockpit-vm-replication/vm-replication-helper";

function spawn(cmd, stdin) {
    const proc = cockpit.spawn(cmd, { err: "message" });
    if (stdin !== undefined && stdin !== null)
        proc.input(stdin);
    return proc;
}

/* Run the helper, preferring passwordless sudo (narrow sudoers rule that
 * `make install` drops in) and falling back to pkexec/polkit. */
export async function helper(sub, args = [], stdin) {
    const attempts = [
        ["sudo", "-n", HELPER, sub, ...args],
        ["pkexec", HELPER, sub, ...args],
    ];
    let lastError = null;
    for (const cmd of attempts) {
        try {
            const out = await spawn(cmd, stdin);
            return JSON.parse(out);
        } catch (e) {
            lastError = e;
            const msg = String(e?.message || e || "");
            // sudo without NOPASSWD / missing binary — try the next mechanism
            if (cmd[0] === "sudo" && /sudo: a password is required|no tty|not found/i.test(msg))
                continue;
            throw new Error(msg || t("unknown error"));
        }
    }
    throw lastError;
}

export function errorMessage(e) {
    return String(e?.message || e?.toString() || e || t("unknown error"));
}

/* clipboard that also works inside the cockpit iframe without permissions */
export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
        return ok;
    }
}

/* ------------------------------------------------------------- format --- */

export function fmtBytes(n, digits = 1) {
    if (n === null || n === undefined || isNaN(n))
        return "—";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let v = Number(n), u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${v.toFixed(u === 0 ? 0 : digits)} ${units[u]}`;
}

export function timeAgo(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 0) return fmtDateTime(isoString);
    if (sec < 60) return tn(sec, "{n} sec ago", "{n} secs ago", { n: sec });
    if (sec < 3600) return tn(Math.floor(sec / 60), "{n} min ago", "{n} mins ago", { n: Math.floor(sec / 60) });
    if (sec < 86400) return tn(Math.floor(sec / 3600), "{n} h ago", "{n} hs ago", { n: Math.floor(sec / 3600) });
    return tn(Math.floor(sec / 86400), "{n} d ago", "{n} ds ago", { n: Math.floor(sec / 86400) });
}

export function fmtDateTime(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    return d.toLocaleString(window.cockpit?.language || undefined);
}
