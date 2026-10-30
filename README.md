# cockpit-vm-replication

A [Cockpit](https://cockpit-project.org) application that manages incremental
replication of libvirt/KVM virtual machines — the "push backup with
checkpoints" technique built on `virsh backup-begin`, with rsync mirroring to
a remote host.

![Overview](screenshots/overview.png)

## What it does

The heavy lifting is done by two root scripts that ship with this project:

- **`vm-replicate`** — for a *running* VM it takes a `virsh backup-begin`
  (push mode) copy with a *checkpoint*: the first copy of a chain is full,
  subsequent hourly copies are **incrementals containing only changed blocks**,
  while the VM keeps running. For a *stopped* VM it makes a cold `rsync`
  copy. The chain directory (`full-*.qcow2` + `inc-*.qcow2` + `domain.xml` +
  `vm-restore`) is mirrored to a remote host with `rsync --delete` over SSH,
  old chains and stale checkpoints are pruned automatically.
- **`vm-restore`** — flattens a chain (full + increments) back into a single
  qcow2 image (rebase + convert), without touching the chain files.

A systemd timer runs the job hourly. Each **replication configuration is
independent per VM**: its own remote target, ssh options, storage root,
rotation policy and SSH key. The Cockpit UI gives you:

| Tab | What you get |
|---|---|
| **Overview** | timer state and next run, storage usage, per-VM health (state, active chain, increment count, size, last backup, last result), run-now for all VMs or one VM |
| **VMs & Chains** | every stored chain with full/increment sizes and times; delete a chain; jump to restore |
| **Configuration** | a table of per-VM replication configurations with **Add / Edit / Delete**; each row expands inline into a form for that VM — an **activity toggle** (`ACTIVE`, a disabled VM is skipped by scheduled *and* manual runs), the **run mode** (by the hourly schedule, or manual-only), remote target, ssh options, storage root, rotation policy, and a **dedicated SSH key** (generate / copy / regenerate / delete) used automatically for that configuration; a **Check access** button probes the entered target before saving (SSH key auth, remote rsync, path writability), and **Accept host key** trusts an unknown server in one click. A separate **Global defaults** card edits `LIBVIRT_URI` and the seed values for new configurations |
| **Restore** | flatten a chain into one qcow2 on this host, with size/free-space checks, plus copy-ready instructions for restoring on the remote side |
| **Journal** | live `journalctl -t vm-replication` view with filter and auto-refresh |

## Screenshots

| | |
|---|---|
| ![Configurations](screenshots/configurations.png) | ![Run now](screenshots/run-now.png) |
| ![Editor](screenshots/config-editor.png) | ![Restore](screenshots/restore.png) |

## Requirements

- Debian 12+/Ubuntu 22.04+ or RHEL-family, with **Cockpit ≥ 265** (`cockpit` package)
- `libvirt` + KVM VMs stored as qcow2 files
- `python3`, `rsync`, `openssh-client` (all preinstalled on typical servers)
- A Cockpit login that may run **one fixed command via sudo** (see below)

## Install

One line, any distro with Cockpit support (Debian/Ubuntu, RHEL/Fedora/Rocky/Alma,
openSUSE, Arch) — downloads the latest release with the **prebuilt UI**, so no
Node.js/npm is needed on the target host:

```bash
curl -fsSL https://github.com/alex653/cockpit-vm-replication/releases/latest/download/install.sh | sudo bash
```

The installer detects the distribution, installs missing packages
(`cockpit`, `python3`, `rsync`, `openssh`, …) through the native package
manager, then drops in the UI, the privileged helper, the scripts, the
sudoers rule and the systemd timer. From an unpacked release tarball it
works offline too: just run `sudo ./install.sh` inside.

Developer path (build from source):

```bash
git clone https://github.com/alex653/cockpit-vm-replication.git
cd cockpit-vm-replication
npm install          # build tooling (nodejs ≥ 18 required)
sudo make install
```

`make install` performs:

1. UI → `/usr/share/cockpit/vm-replication/`
2. privileged helper → `/usr/libexec/cockpit-vm-replication/vm-replication-helper`
3. `vm-replicate` / `vm-restore` → `/usr/local/sbin/`
4. config dir → `/etc/vm-replication/`: `defaults.conf` (global + seed values)
   and empty `vms.d/` (one `<vm>.conf` per configuration) and `keys/`; a
   pre-2.0 single `vms.conf` is migrated automatically into `vms.d/` (old file
   kept as `vms.conf.pre-vmsd.bak`)
5. systemd service + hourly timer (`vm-replication.timer`, enabled)
6. a sudoers drop-in allowing members of `sudo`/`wheel` to run **only** the
   helper without a password:
   ```
   %sudo  ALL=(root) NOPASSWD: /usr/libexec/cockpit-vm-replication/vm-replication-helper
   %wheel ALL=(root) NOPASSWD: /usr/libexec/cockpit-vm-replication/vm-replication-helper
   ```
7. an AppArmor rule for libvirt, for every storage root outside
   `/var/lib/libvirt/images`

Then open `https://your-server:9090` → **VM Replication** in the menu.
If the menu entry does not appear right away, reload the page (and give the
Cockpit service a minute if it was running during install).

### Initial configuration

1. Open **Configuration** → **Add configuration**, pick a VM, set its remote
   target (`user@backup-host:/srv/vm-replication`), ssh options (non-standard
   ports go here as `-p 2222`), storage root and rotation policy. Press
   **Check access** to probe the target with the values as entered — no need
   to save first. Repeat per VM; each configuration is independent.
2. For remote mirroring prepare passwordless SSH. Either **Generate key** in
   the configuration's form (→ **Copy** → append to `~/.ssh/authorized_keys`
   of the target user on the remote host — that per-configuration key is then
   used automatically), or use root's default key:
   `sudo ssh-copy-id -p 2222 user@backup-host`. If **Check access** reports
   `Host key verification failed`, press **Accept host key** to review the
   fingerprints and trust the server in one click — no terminal needed.
3. Press **Run now** (all configurations) or the per-row **Run** and watch the
   Journal tab. The small ⋮ menu next to a per-VM **Run** / **Replicate now**
   button forces the copy type: a **full copy** or an **increment** — otherwise
   the usual policy (`FULL_EVERY_DAYS` / `MAX_INCS`) decides. A VM whose run
   mode is **manual only** is skipped by the hourly timer and replicates only
   when you press the button; the **Active** toggle in both tables turns a VM's
   replication on/off without deleting its configuration.

## How the replication works

```
VM (running) ──virsh backup-begin (push)──▶ <STORAGE_ROOT>/<vm>/<chain>/
   │                                          full-<chain>/*.qcow2
   └── checkpoint c-<chain>-<ts>              inc-<ts>-vda.qcow2  (hourly)
                                              domain.xml, vm-restore
        rsync --delete over ssh, per-config key (<keys>/<vm>) ─▶ user@remote:<path>/<vm>/<chain>/
```

- Configuration files: `defaults.conf` (global) + one `vms.d/<vm>.conf` per VM
  + `keys/<vm>` per-VM SSH key, all under `/etc/vm-replication/`.
- A chain rotates to a new full copy after `FULL_EVERY_DAYS` days or
  `MAX_INCS` increments; the newest `KEEP_CHAINS` chains are kept.
- Crash-consistent by default; install `qemu-guest-agent` in the guest for
  fsfreeze-consistent copies.
- Restoring on the remote host: every chain carries a copy of `vm-restore`
  and `domain.xml`:
  ```bash
  ./vm-restore <chain-dir> /var/lib/libvirt/images/vm.qcow2
  virsh define <chain-dir>/domain.xml   # adjust disk path if needed
  virsh start vm
  ```

## Security model

The browser never gets a root shell. The UI talks to one Python helper with a
fixed subcommand set (`status`, `entry-save`, `key-generate`, `remote-check`,
`run`, `restore-start`, …). The helper is the only thing the sudoers rule
allows; it validates every argument, confines chain operations to each
configuration's `STORAGE_ROOT`, refuses path escapes, and never spawns a shell
with user input. Configuration files are written from a whitelisted key set.
Alternative without sudo: the UI falls back to `pkexec` (polkit) if
passwordless sudo for the helper is absent.

## Uninstall

```bash
sudo make uninstall   # UI + helper + sudoers; keeps scripts, config, data
sudo make purge       # also removes scripts, units and /etc/vm-replication
```

Stored copies in `STORAGE_ROOT` are never removed by uninstall.

## Development

```bash
npm install
npm run watch        # esbuild in watch mode
sudo make install-app   # push dist/ to /usr/share/cockpit/vm-replication
```

Stack: React 18 + PatternFly 6, bundled with esbuild, `cockpit.js` from
base1 (no framework glue). Privileged side: Python 3 stdlib only.

## Localization

The UI language follows the Cockpit session language automatically — the
same language the user picks in Cockpit (or on the login screen). There is
no in-app switcher: change the language in Cockpit and reload, and this
app follows.

Shipped languages: **English** (source strings), **Russian, German, French,
Spanish, Italian, Portuguese, Polish, Ukrainian, Simplified Chinese,
Japanese**.

Mechanism: user-visible strings in the code go through `t()` / `tc()` /
`tn()` from `src/i18n.js` — thin wrappers over Cockpit's gettext.
Translations live in `po/<lang>.po` and are compiled by the build into
`dist/po.<lang>.js`; `index.html` loads `po.js`, which cockpit-ws serves
in the session language by looking for `po.<lang>.js` in the package
directory. If no file matches, English msgids are shown.

The Russian file `po/ru.po` is the hand-maintained reference; the other
languages are generated by `tools/gen-po.mjs` from the dictionaries in
`tools/po-data/<lang>.json` (plain `msgid → translation` entries, with
`"ctx\x04msgid"` keys for contextual entries and arrays for plurals).
After editing a JSON, run `node tools/gen-po.mjs` and rebuild.

To add another language `<xx>`:

1. Copy `tools/po-data/ru.json`-style entries into
   `tools/po-data/<xx>.json`, translate the values, and register the
   language (with its `Plural-Forms` formula) in the `LANGS` table of
   `tools/gen-po.mjs`.
2. `node tools/gen-po.mjs && npm run build` — `dist/po.<xx>.js` appears
   and cockpit-ws picks it up automatically.

`node tools/check-po.mjs` (also run by `make check` and CI) verifies that
`.po` files and the strings used in `src/` stay in sync.

## License

MIT — see [LICENSE](LICENSE).
