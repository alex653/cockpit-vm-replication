VERSION := $(shell node -p "require('./package.json').version")
APPNAME := vm-replication
PREFIX ?= /usr
BINDIR ?= /usr/local/sbin
HELPERDIR ?= $(PREFIX)/libexec/cockpit-vm-replication
COCKPITDIR ?= $(PREFIX)/share/cockpit/$(APPNAME)
CONFDIR ?= /etc/vm-replication
UNITDIR ?= /etc/systemd/system

.DEFAULT_GOAL := build

.PHONY: build install install-app install-helper install-scripts install-config \
        uninstall purge check clean dist

build: dist/index.js

dist/index.js: $(wildcard src/*) $(wildcard src/views/*) package.json node_modules
	npm run build

node_modules: package.json
	npm install

# ---------------------------------------------------------------------------

install: check-root build install-app install-helper install-scripts install-config install-sudoers install-units
	@echo
	@echo "Installed. Open https://$(shell hostname -f 2>/dev/null || echo localhost):9090 and look for 'VM Replication' in the menu."

check-root:
	@[ "$$(id -u)" -eq 0 ] || { echo "Run 'sudo make install' as root."; exit 1; }

install-app: build
	install -d $(COCKPITDIR)
	cp -r dist/. $(COCKPITDIR)/

install-helper:
	install -D -m 0755 helper/vm-replication-helper $(HELPERDIR)/vm-replication-helper

install-scripts:
	install -D -m 0755 scripts/vm-replicate $(BINDIR)/vm-replicate
	install -D -m 0755 scripts/vm-restore $(BINDIR)/vm-restore

install-config:
	install -D -m 0644 scripts/vms.conf.example $(CONFDIR)/vms.conf.new
	@if [ ! -f $(CONFDIR)/vms.conf ]; then \
	    echo "Installing new config $(CONFDIR)/vms.conf"; \
	    install -m 0644 scripts/vms.conf.example $(CONFDIR)/vms.conf; \
	else \
	    echo "Keeping existing $(CONFDIR)/vms.conf (example saved as vms.conf.new)"; \
	fi

# Allow members of 'sudo'/'wheel' to run only the helper without a password.
install-sudoers:
	@if [ -d /etc/sudoers.d ]; then \
	    printf '%%sudo ALL=(root) NOPASSWD: %s/vm-replication-helper\n%%wheel ALL=(root) NOPASSWD: %s/vm-replication-helper\n' "$(HELPERDIR)" "$(HELPERDIR)" \
	      > /etc/sudoers.d/cockpit-vm-replication; \
	    chmod 0440 /etc/sudoers.d/cockpit-vm-replication; \
	    visudo -c -f /etc/sudoers.d/cockpit-vm-replication; \
	fi

install-units:
	install -D -m 0644 scripts/vm-replication.service $(UNITDIR)/vm-replication.service
	install -D -m 0644 scripts/vm-replication.timer $(UNITDIR)/vm-replication.timer
	systemctl daemon-reload
	systemctl enable --now vm-replication.timer 2>/dev/null || true
	@$(MAKE) --no-print-directory install-apparmor STORAGE_ROOT=$$(grep -E '^STORAGE_ROOT=' $(CONFDIR)/vms.conf 2>/dev/null | cut -d= -f2 | tr -d '"'); 

# libvirt's AppArmor profile only allows writing to default paths; teach it
# about the replication storage. No-op when AppArmor is not in use.
install-apparmor:
	@if [ -d /etc/apparmor.d/local ] && [ -n "$(STORAGE_ROOT)" ] && [ "$(STORAGE_ROOT)" != "/var/lib/libvirt/images" ]; then \
	    grep -q "$(STORAGE_ROOT)/\*\* rwk," /etc/apparmor.d/local/abstractions/libvirt-qemu 2>/dev/null || \
	      { printf '%s/ rw,\n%s/** rwk,\n' "$(STORAGE_ROOT)" "$(STORAGE_ROOT)" >> /etc/apparmor.d/local/abstractions/libvirt-qemu; \
	        printf '%s/ r,\n%s/** rk,\n' "$(STORAGE_ROOT)" "$(STORAGE_ROOT)" >> /etc/apparmor.d/local/usr.lib.libvirt.virt-aa-helper; \
	        apparmor_parser -r /etc/apparmor.d/abstractions/libvirt-qemu 2>/dev/null || true; \
	        echo "AppArmor: granted access to $(STORAGE_ROOT)"; }; \
	fi

uninstall: check-root
	rm -rf $(COCKPITDIR)
	rm -f $(HELPERDIR)/vm-replication-helper
	rmdir $(HELPERDIR) 2>/dev/null || true
	rm -f /etc/sudoers.d/cockpit-vm-replication
	@echo "UI, helper and sudoers rule removed."
	@echo "Replication scripts, $(CONFDIR) and stored copies were KEPT."
	@echo "To remove them too:  sudo make purge"

purge: uninstall
	systemctl disable --now vm-replication.timer 2>/dev/null || true
	rm -f $(UNITDIR)/vm-replication.service $(UNITDIR)/vm-replication.timer
	-systemctl daemon-reload
	rm -f $(BINDIR)/vm-replicate $(BINDIR)/vm-restore
	rm -rf $(CONFDIR)
	@echo "Purged. Replication data in STORAGE_ROOT was kept."

check: build
	node -e "const m=require('fs').readFileSync('dist/manifest.json'); JSON.parse(m); console.log('manifest OK')"

clean:
	rm -rf dist

dist: build
	tar --transform "s,^,cockpit-vm-replication-$(VERSION)/," \
	    -czf cockpit-vm-replication-$(VERSION).tar.gz \
	    dist helper scripts Makefile README.md README.ru.md LICENSE package.json
	@echo "Created cockpit-vm-replication-$(VERSION).tar.gz"
