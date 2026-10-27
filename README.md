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

A systemd timer runs the job hourly. The Cockpit UI gives you:

| Tab | What you get |
|---|---|
| **Overview** | timer state and next run, storage usage, per-VM health (state, active chain, increment count, size, last backup, last result), run-now for all VMs or one VM |
| **VMs & Chains** | every stored chain with full/increment sizes and times; delete a chain; jump to restore |
| **Configuration** | edit `/etc/vm-replication/vms.conf` (VM list, remote target, ssh options, storage root, rotation policy) — comments in the file are preserved |
| **Restore** | flatten a chain into one qcow2 on this host, with size/free-space checks, plus copy-ready instructions for restoring on the remote side |
| **Journal** | live `journalctl -t vm-replication` view with filter and auto-refresh |

## Screenshots

| | |
|---|---|
| ![Chains](screenshots/chains.png) | ![Run now](screenshots/run-now.png) |
| ![Configuration](screenshots/configuration.png) | ![Restore](screenshots/restore.png) |

## Requirements

- Debian 12+/Ubuntu 22.04+ or RHEL-family, with **Cockpit ≥ 265** (`cockpit` package)
- `libvirt` + KVM VMs stored as qcow2 files
- `python3`, `rsync`, `openssh-client` (all preinstalled on typical servers)
- A Cockpit login that may run **one fixed command via sudo** (see below)

## Install

```bash
git clone https://github.com/yourname/cockpit-vm-replication.git
cd cockpit-vm-replication
npm install          # build tooling (nodejs ≥ 18 required)
sudo make install
```

`make install` performs:

1. UI → `/usr/share/cockpit/vm-replication/`
2. privileged helper → `/usr/libexec/cockpit-vm-replication/vm-replication-helper`
3. `vm-replicate` / `vm-restore` → `/usr/local/sbin/`
4. config → `/etc/vm-replication/vms.conf` (existing config is never overwritten)
5. systemd service + hourly timer (`vm-replication.timer`, enabled)
6. a sudoers drop-in allowing members of `sudo`/`wheel` to run **only** the
   helper without a password:
   ```
   %sudo  ALL=(root) NOPASSWD: /usr/libexec/cockpit-vm-replication/vm-replication-helper
   %wheel ALL=(root) NOPASSWD: /usr/libexec/cockpit-vm-replication/vm-replication-helper
   ```
7. an AppArmor rule for libvirt, if the storage root is outside
   `/var/lib/libvirt/images`

Then open `https://your-server:9090` → **VM Replication** in the menu.
If the menu entry does not appear right away, reload the page (and give the
Cockpit service a minute if it was running during install).

### Initial configuration

1. Open **Configuration**, pick the VMs to replicate, optionally set
   `REMOTE_TARGET` (`user@backup-host:/srv/vm-replication`) and adjust the
   rotation policy.
2. For remote mirroring prepare passwordless SSH as root:
   `sudo ssh-copy-id user@backup-host`.
3. Press **Run now** and watch the Journal tab.

## How the replication works

```
VM (running) ──virsh backup-begin (push)──▶ /mnt/.../vm/chain/
   │                                          full-20261026-190808/*.qcow2
   └── checkpoint c-<chain>-<ts>              inc-<ts>-vda.qcow2  (hourly)
                                              domain.xml, vm-restore
                    rsync --delete over ssh ─▶ user@remote:/srv/vm-replication/vm/chain/
```

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
fixed subcommand set (`status`, `run`, `config-set`, `restore-start`, …).
The helper is the only thing the sudoers rule allows; it validates every
argument, confines chain operations to `STORAGE_ROOT`, refuses path escapes,
and never spawns a shell with user input. Editing the config is a whitelisted,
per-key merge that preserves comments. Alternative without sudo: the UI falls
back to `pkexec` (polkit) if passwordless sudo for the helper is absent.

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

## License

MIT — see [LICENSE](LICENSE).
