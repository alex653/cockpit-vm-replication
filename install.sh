#!/usr/bin/env bash
# install.sh — universal installer for cockpit-vm-replication.
#
# Works on Debian/Ubuntu, RHEL/Fedora/Rocky/Alma, openSUSE and Arch.
# Installs the prebuilt UI (no Node.js/npm needed on the target host),
# the privileged helper, the replication scripts, systemd units, the
# sudoers rule and sane default configuration.
#
# Two modes:
#   * from an unpacked release tarball:  sudo ./install.sh
#   * straight from GitHub (fetches the latest release):
#         curl -fsSL https://github.com/alex653/cockpit-vm-replication/releases/latest/download/install.sh | sudo bash
#
# Options:
#   --uninstall     remove UI, helper and sudoers rule (keeps data)
#   --purge         also remove scripts, units and /etc/vm-replication
#   --no-timer      do not enable/start vm-replication.timer
#   --version TAG   install a specific release tag (download mode)
#   --repo OWNER/N  GitHub repository to download from (default alex653/cockpit-vm-replication)
#   --no-deps       do not try to install system packages
#   --help

set -euo pipefail

APP=vm-replication
REPO=${GITHUB_REPO:-alex653/cockpit-vm-replication}
BRANCH_TAG=""
WANT_TIMER=1
ACTION=install
INSTALL_DEPS=1
BINDIR=/usr/local/sbin
LIBEXECDIR=/usr/libexec
COCKPITDIR=/usr/share/cockpit/$APP
CONFDIR=/etc/$APP
UNITDIR=/etc/systemd/system

log()  { printf '\033[1;34m==\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m== ОШИБКА / ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --uninstall) ACTION=uninstall ;;
        --purge) ACTION=purge ;;
        --no-timer) WANT_TIMER=0 ;;
        --version) shift; BRANCH_TAG=${1:?--version needs a tag} ;;
        --repo) shift; REPO=${1:?--repo needs OWNER/NAME} ;;
        --no-deps) INSTALL_DEPS=0 ;;
        --help|-h) grep '^#' "$0" | sed -n '2,25p' | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
done

# ------------------------------------------------------------ privileges ---

[ "$(id -u)" -eq 0 ] || die "run as root:  sudo ./install.sh  (или через sudo bash)"

# ------------------------------------------------- download (curl|bash) ---

need_fetch=1
for f in dist/index.js dist/manifest.json helper/vm-replication-helper scripts/vm-replicate; do
    [ -f "$f" ] || { need_fetch=0; break; }
done

if [ "$ACTION" = install ] && [ "$need_fetch" != 1 ]; then
    log "файлы релиза не найдены в текущем каталоге — скачиваю с GitHub ($REPO)"
    dl() { # dl URL OUT
        if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
        elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
        else die "нужен curl или wget для скачивания релиза"; fi
    }
    if [ -n "$BRANCH_TAG" ]; then
        ver=${BRANCH_TAG#v}
    else
        api=https://api.github.com/repos/$REPO/releases/latest
        dl "$api" /tmp/.vmr-rel.json 2>/dev/null || die "не удалось получить список релизов (проверьте сеть)"
        ver=$(sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' /tmp/.vmr-rel.json | head -n1)
        [ -n "$ver" ] || die "не удалось определить последний релиз; укажите --version vX.Y.Z"
    fi
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    log "релиз v$ver — скачиваю tarball"
    dl "https://github.com/$REPO/releases/download/v$ver/cockpit-vm-replication-$ver.tar.gz" \
       "$tmp/app.tar.gz"
    mkdir -p "$tmp/app"
    tar -xzf "$tmp/app.tar.gz" -C "$tmp/app"
    cd "$tmp/app"/cockpit-vm-replication-*/ || die "битый tarball"
    ok "распаковано в $(pwd)"
fi

# ------------------------------------------------------- distro & deps ---

fam=""
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID}${ID_LIKE:+ $ID_LIKE}" in
        *debian*|*ubuntu*) fam=apt ;;
        *fedora*|*rhel*|*centos*|*rocky*|*almalinux*|*amzn*|*ol*) fam=rpm ;;
        *suse*) fam=suse ;;
        *arch*|*manjaro*) fam=arch ;;
    esac
fi
log "ОС: ${PRETTY_NAME:-unknown} (семейство пакетов: ${fam:-неизвестное})"

pkgs_for() {
    case $fam in
        apt)  echo "cockpit python3 rsync openssh-client qemu-utils libvirt-clients util-linux" ;;
        rpm)  echo "cockpit python3 rsync openssh-clients qemu-img libvirt-client util-linux" ;;
        suse) echo "cockpit python3 rsync openssh qemu-tools libvirt-client util-linux" ;;
        arch) echo "cockpit python3 rsync openssh qemu-img libvirt util-linux" ;;
        *)    echo "" ;;
    esac
}

if [ "$ACTION" = install ] && [ "$INSTALL_DEPS" = 1 ]; then
    missing=""
    for c in python3 rsync ssh; do
        command -v "$c" >/dev/null 2>&1 || missing="$missing $c"
    done
    if ! [ -d /usr/share/cockpit ] && ! command -v cockpit-launch >/dev/null 2>&1; then
        missing="$missing cockpit"
    fi
    if [ -n "$missing" ]; then
        # $missing is intentionally a word list for the package managers below
        # shellcheck disable=SC2086
        case $fam in
            apt)  log "ставлю недостающие пакеты:${missing}"; apt-get update -qq || true
                  # polkit name differs across releases — try both spellings
                  apt-get install -y -qq ${missing} 2>/dev/null || \
                      apt-get install -y -qq ${missing} policykit-1 polkitd 2>/dev/null || true ;;
            rpm)  log "ставлю недостающие пакеты:${missing}"
                  if command -v dnf >/dev/null 2>&1; then dnf install -y -q ${missing} polkit || true
                  else yum install -y -q ${missing} polkit || true; fi ;;
            suse) log "ставлю недостающие пакеты:${missing}"
                  zypper --non-interactive install ${missing} polkit >/dev/null || true ;;
            arch) log "ставлю недостающие пакеты:${missing}"
                  pacman -S --needed --noconfirm ${missing} polkit >/dev/null || true ;;
            *)    warn "неизвестный дистрибутив — установите вручную:${missing} (и polkit, qemu-img, virsh)" ;;
        esac
    fi
fi

if [ "$ACTION" = install ]; then
    err=""
    for c in python3 rsync ssh virsh; do
        command -v "$c" >/dev/null 2>&1 || { warn "не найдена команда: $c"; err=1; }
    done
    command -v virsh >/dev/null 2>&1 || \
        warn "virsh отсутствует — установите libvirt (на Debian/Ubuntu: apt install libvirt-clients libvirt-daemon-system)"
    [ -z "$err" ] || die "не хватает обязательных зависимостей (python3, rsync, ssh); повторите после их установки"
    command -v qemu-img >/dev/null 2>&1 || warn "qemu-img нет — проверка целостности образов будет пропускаться"
    command -v pkexec >/dev/null 2>&1 || true   # необязательно: достаточно sudo
fi

# ------------------------------------------------------------- uninstall ---

if [ "$ACTION" != install ]; then
    log "удаляю UI, хелпер и sudoers-правило"
    rm -rf "$COCKPITDIR"
    rm -f "$LIBEXECDIR/cockpit-$APP/vm-replication-helper"
    rmdir "$LIBEXECDIR/cockpit-$APP" 2>/dev/null || true
    rm -f /etc/sudoers.d/cockpit-$APP
    ok "готово — копии в STORAGE_ROOT и /etc/$APP не тронуты"
    if [ "$ACTION" = purge ]; then
        systemctl disable --now vm-replication.timer 2>/dev/null || true
        rm -f "$UNITDIR/vm-replication.service" "$UNITDIR/vm-replication.timer"
        systemctl daemon-reload 2>/dev/null || true
        rm -f "$BINDIR/vm-replicate" "$BINDIR/vm-restore"
        rm -rf "$CONFDIR"
        ok "purge: скрипты, юниты и /etc/$APP удалены; данные в STORAGE_ROOT сохранены"
    fi
    exit 0
fi

# --------------------------------------------------------------- install ---

[ -f dist/manifest.json ] || die "dist/manifest.json не найден — запускайте из распакованного релиза или каталога репозитория после сборки"

log "копирую UI → $COCKPITDIR"
install -d "$COCKPITDIR"
cp -r dist/. "$COCKPITDIR/"

log "копирую хелпер → $LIBEXECDIR/cockpit-$APP/"
install -D -m 0755 helper/vm-replication-helper "$LIBEXECDIR/cockpit-$APP/vm-replication-helper"

log "копирую скрипты → $BINDIR/"
install -D -m 0755 scripts/vm-replicate "$BINDIR/vm-replicate"
install -D -m 0755 scripts/vm-restore "$BINDIR/vm-restore"

log "конфигурация → $CONFDIR"
install -d -m 0755 "$CONFDIR/vms.d" "$CONFDIR/keys"
if [ ! -f "$CONFDIR/defaults.conf" ]; then
    install -m 0644 scripts/defaults.conf.example "$CONFDIR/defaults.conf"
    ok "создан $CONFDIR/defaults.conf"
else
    ok "существующий $CONFDIR/defaults.conf сохранён"
fi

# legacy single-file migration (pre-2.0)
if [ -f "$CONFDIR/vms.conf" ] && ! ls "$CONFDIR"/vms.d/*.conf >/dev/null 2>&1; then
    if "$BINDIR/vm-replicate" __migrate_only__ >/dev/null 2>&1; then
        ok "vms.conf перенесён в $CONFDIR/vms.d/"
    fi
fi

log "sudoers-правило (запуск хелпера без пароля)"
if command -v sudo >/dev/null 2>&1 && [ -d /etc/sudoers.d ]; then
    printf '%%sudo ALL=(root) NOPASSWD: %s/cockpit-%s/vm-replication-helper\n%%wheel ALL=(root) NOPASSWD: %s/cockpit-%s/vm-replication-helper\n' \
        "$LIBEXECDIR" "$APP" "$LIBEXECDIR" "$APP" > /etc/sudoers.d/cockpit-$APP
    chmod 0440 /etc/sudoers.d/cockpit-$APP
    if command -v visudo >/dev/null 2>&1; then
        visudo -c -f /etc/sudoers.d/cockpit-$APP >/dev/null || die "visudo отклонил правило — удалите /etc/sudoers.d/cockpit-$APP"
    fi
    ok "разрешено группам sudo и wheel"
else
    warn "sudo не найден — UI будет спрашивать пароль через pkexec (polkit)"
fi

log "systemd-юниты"
install -D -m 0644 scripts/vm-replication.service "$UNITDIR/vm-replication.service"
install -D -m 0644 scripts/vm-replication.timer "$UNITDIR/vm-replication.timer"
systemctl daemon-reload 2>/dev/null || true

# AppArmor: разрешаем libvirt писать в корень хранилища по умолчанию
if [ -d /etc/apparmor.d/local ]; then
    sroot=$(sed -n 's/^STORAGE_ROOT="\(.*\)"/\1/p' "$CONFDIR/defaults.conf" 2>/dev/null | head -n1)
    sroot=${sroot:-/var/lib/libvirt/replication}
    if [ -n "$sroot" ] && [ "$sroot" != "/var/lib/libvirt/images" ] \
       && [ -f /etc/apparmor.d/local/abstractions/libvirt-qemu ]; then
        if ! grep -q "$sroot/\*\* rwk," /etc/apparmor.d/local/abstractions/libvirt-qemu 2>/dev/null; then
            printf '%s/ rw,\n%s/** rwk,\n' "$sroot" "$sroot" >> /etc/apparmor.d/local/abstractions/libvirt-qemu
            printf '%s/ r,\n%s/** rk,\n' "$sroot" "$sroot" >> /etc/apparmor.d/local/usr.lib.libvirt.virt-aa-helper 2>/dev/null || true
            if command -v apparmor_parser >/dev/null 2>&1; then
                apparmor_parser -r /etc/apparmor.d/abstractions/libvirt-qemu 2>/dev/null || true
            fi
            ok "AppArmor: доступ для $sroot"
        fi
    fi
fi

if [ "$WANT_TIMER" = 1 ]; then
    systemctl enable --now vm-replication.timer 2>/dev/null || warn "не удалось включить vm-replication.timer"
    ok "почасовой таймер включён"
else
    ok "таймер не включался (--no-timer)"
fi

echo
host=$(hostname -f 2>/dev/null || hostname)
log "Установка завершена. Откройте https://$host:9090 → VM Replication"
echo "   Добавьте конфигурации на вкладке «Настройка / Configuration»,"
echo "   затем «Запустить сейчас» — или дождитесь почасового таймера."
echo "   Удаление:  sudo $(basename "$0") --uninstall   (данные остаются)"
