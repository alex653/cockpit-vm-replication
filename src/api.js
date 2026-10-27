/* Bridge to the privileged helper + shared formatting utilities.
 * cockpit.js is loaded globally by index.html from Cockpit's base1. */

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
            throw new Error(msg || "helper failed");
        }
    }
    throw lastError;
}

export function errorMessage(e) {
    return String(e?.message || e?.toString() || e || "unknown error");
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
    if (sec < 0) return d.toLocaleString();
    if (sec < 60) return `${sec} sec ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
    return `${Math.floor(sec / 86400)} d ago`;
}

export function fmtDateTime(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    return d.toLocaleString();
}
