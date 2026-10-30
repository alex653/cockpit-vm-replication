import React, { useEffect, useState } from "react";
import {
    Alert, Button, Card, CardBody, CardHeader, CardTitle, Checkbox,
    Content, ContentVariants, Flex, FlexItem, Form, FormGroup, Grid,
    GridItem, HelperText, HelperTextItem, Label, Modal, ModalBody,
    ModalFooter, ModalHeader, Radio, Spinner, Switch, TextInput,
} from "@patternfly/react-core";
import { CheckCircleIcon, TimesCircleIcon } from "@patternfly/react-icons";
import { copyText, errorMessage, helper } from "../api.js";
import { t, tc } from "../i18n.js";
import { useStatus } from "../app.jsx";
import { runStatus, vmStateText, ActivitySwitch, runVM, RunMenu } from "./overview.jsx";

function toInt(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
}

/* ------------------------------------------------------------------ key --- */

function KeyBlock({ vm, keyInfo, setKeyInfo, disabled }) {
    const [busy, setBusy] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);

    const act = async action => {
        setBusy(action);
        setError(null);
        try {
            const r = await helper(action === "delete" ? "key-delete" : "key-generate", [vm]);
            setKeyInfo(r.key ?? r);
            setConfirm(null);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(null);
        }
    };

    if (!vm)
        return null;

    return (
        <Flex direction={{ default: "column" }} gap={{ default: "gapSm" }}>
            {keyInfo?.exists ? (
                <>
                    <Flex gap={{ default: "gapSm" }}>
                        <FlexItem grow={{ default: "grow" }}>
                            <TextInput isReadOnly id={`pubkey-${vm}`} value={keyInfo.public_key} className="mono-input" />
                        </FlexItem>
                        <FlexItem>
                            <Button variant="secondary" onClick={async () => {
                                if (keyInfo.public_key && await copyText(keyInfo.public_key)) {
                                    setCopied(true); setTimeout(() => setCopied(false), 2000);
                                }
                            }}>{copied ? t("Copied") : t("Copy")}</Button>
                        </FlexItem>
                    </Flex>
                    <HelperText><HelperTextItem>
                        {keyInfo.fingerprint || t("fingerprint unavailable")}
                    </HelperTextItem></HelperText>
                    <Flex gap={{ default: "gapSm" }}>
                        <FlexItem><Button variant="warning" isDisabled={!!busy || disabled} onClick={() => setConfirm("regenerate")}>{t("Regenerate")}</Button></FlexItem>
                        <FlexItem><Button variant="danger" isDisabled={!!busy || disabled} onClick={() => setConfirm("delete")}>{t("Delete")}</Button></FlexItem>
                        {busy && <FlexItem><Spinner size="md" /></FlexItem>}
                    </Flex>
                </>
            ) : (
                <Flex gap={{ default: "gapSm" }} alignItems={{ default: "alignItemsCenter" }}>
                    <FlexItem><Button variant="secondary" isDisabled={!!busy || disabled} onClick={() => act("generate")}>{t("Generate key")}</Button></FlexItem>
                    {busy && <FlexItem><Spinner size="md" /></FlexItem>}
                    <FlexItem><HelperText><HelperTextItem>{t("No dedicated key — ssh falls back to root's default keys.")}</HelperTextItem></HelperText></FlexItem>
                </Flex>
            )}
            {error && <Alert variant="danger" isInline title={error} />}

            <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} variant="small">
                <ModalHeader title={confirm === "delete" ? t("Delete this profile's SSH key?") : t("Regenerate this profile's SSH key?")} />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        {confirm === "delete"
                            ? t("The key pair is removed. ssh falls back to root's default keys; remote hosts that only had this key will reject connections.")
                            : t("A new key pair replaces the current one. The old key stops working immediately — install the new public key on the remote host before the next sync.")}
                    </Content>
                </ModalBody>
                <ModalFooter>
                    <Button variant={confirm === "delete" ? "danger" : "primary"} isDisabled={!!busy} onClick={() => act(confirm === "delete" ? "delete" : "generate")}>
                        {confirm === "delete" ? t("Delete") : t("Regenerate")}
                    </Button>
                    <Button variant="link" isDisabled={!!busy} onClick={() => setConfirm(null)}>{t("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </Flex>
    );
}

/* ---------------------------------------------------------------- check --- */

function CheckBlock({ vm, target, opts }) {
    const [state, setState] = useState(null); // {checking}|{result}|{error}
    const [hostkey, setHostkey] = useState(null);

    useEffect(() => setState(null), [target, opts]);

    const run = async () => {
        setState({ checking: true });
        try {
            const result = await helper("remote-check", [vm], JSON.stringify({
                remote_target: target, ssh_opts: opts,
            }));
            setState({ result });
        } catch (e) {
            setState({ error: errorMessage(e) });
        }
    };

    const hostKeyProblem = state?.result?.checks?.some(
        c => !c.ok && /host key verification failed/i.test(c.detail || ""));

    const scan = async () => {
        setHostkey({ scanning: true });
        try {
            const scan = await helper("hostkey-scan", [vm], JSON.stringify({ remote_target: target, ssh_opts: opts }));
            setHostkey({ scan });
        } catch (e) { setHostkey({ error: errorMessage(e) }); }
    };
    const accept = async () => {
        setHostkey(h => ({ ...h, accepting: true }));
        try {
            await helper("hostkey-accept", [vm], JSON.stringify({ remote_target: target, ssh_opts: opts }));
            setHostkey(null);
            await run();
        } catch (e) { setHostkey(h => ({ ...h, accepting: false, error: errorMessage(e) })); }
    };

    return (
        <>
            <Button variant="secondary" onClick={run} isDisabled={!target.trim() || !!state?.checking}
                icon={state?.checking ? <Spinner size="sm" /> : undefined}>
                {state?.checking ? t("Checking…") : t("Check access")}
            </Button>
            {state?.error && <Alert variant="danger" isInline title={state.error} />}
            {state?.result && (
                <Alert variant={state.result.ok ? "success" : "warning"} isInline
                    title={state.result.ok
                        ? t("Access OK — {target}", { target: state.result.target }) + (state.result.port ? t(" (port {port})", { port: state.result.port }) : "")
                        : t("Access check failed")}>
                    <ul className="check-list">
                        {state.result.checks.map((c, i) => (
                            <li key={i} className={c.ok ? "ok" : "fail"}>
                                {c.ok ? <CheckCircleIcon className="ok-icon" /> : <TimesCircleIcon className="fail-icon" />}
                                {" "}<strong>{c.name}:</strong> {c.detail}
                            </li>
                        ))}
                    </ul>
                    {state.result.hint && <Content component={ContentVariants.small}>{state.result.hint}</Content>}
                    {hostKeyProblem && (
                        <div style={{ marginTop: "0.5rem" }}>
                            <Button variant="secondary" isDisabled={!!hostkey?.scanning}
                                icon={hostkey?.scanning ? <Spinner size="sm" /> : undefined} onClick={scan}>
                                {hostkey?.scanning ? t("Scanning…") : t("Accept host key")}
                            </Button>
                            {hostkey?.error && <Content component={ContentVariants.small}>{hostkey.error}</Content>}
                        </div>
                    )}
                </Alert>
            )}
            <Modal isOpen={!!hostkey?.scan} onClose={() => setHostkey(null)} variant="medium">
                <ModalHeader title={hostkey?.scan ? t("Trust {host}?", { host: hostkey.scan.host + (hostkey.scan.port ? ":" + hostkey.scan.port : "") }) : ""} />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        {t("These are the host keys the remote server presents. Verify them out-of-band if you can; accepting trusts this server on first use.")}
                    </Content>
                    <pre className="log-tail mono-input" style={{ maxHeight: "14rem" }}>
                        {hostkey?.scan?.keys?.map(k =>
                            `${k.already_known ? t("[known]") : t("[new]")}  ${k.fingerprint}`).join("\n") || ""}
                    </pre>
                    {hostkey?.error && <Alert variant="danger" isInline title={hostkey.error} />}
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" isDisabled={!!hostkey?.accepting} onClick={accept}>{hostkey?.accepting ? t("Adding…") : t("Accept and re-check")}</Button>
                    <Button variant="link" isDisabled={!!hostkey?.accepting} onClick={() => setHostkey(null)}>{t("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}

/* ------------------------------------------------------------ entry form --- */

function EntryForm({ vm, isNew, initial, defaults, unconfigured, onCancel, onSaved }) {
    const [chosenVm, setChosenVm] = useState(vm || "");
    const [form, setForm] = useState(() => ({
        ACTIVE: String(initial?.ACTIVE ?? "1") !== "0",
        MODE: initial?.MODE === "manual" ? "manual" : "schedule",
        REMOTE_TARGET: initial?.REMOTE_TARGET || "",
        REMOTE_SSH_OPTS: initial?.REMOTE_SSH_OPTS ?? (defaults?.REMOTE_SSH_OPTS || "-o BatchMode=yes -o ConnectTimeout=30"),
        STORAGE_ROOT: initial?.STORAGE_ROOT || defaults?.STORAGE_ROOT || "/mnt/dd/replication",
        FULL_EVERY_DAYS: toInt(initial?.FULL_EVERY_DAYS || defaults?.FULL_EVERY_DAYS || 7),
        MAX_INCS: toInt(initial?.MAX_INCS || defaults?.MAX_INCS || 48),
        KEEP_CHAINS: toInt(initial?.KEEP_CHAINS || defaults?.KEEP_CHAINS || 2),
        BACKUP_TIMEOUT: toInt(initial?.BACKUP_TIMEOUT || defaults?.BACKUP_TIMEOUT || 14400),
        QEMU_IMG_CHECK: String(initial?.QEMU_IMG_CHECK ?? defaults?.QEMU_IMG_CHECK ?? "1") !== "0",
    }));
    const [keyInfo, setKeyInfo] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!chosenVm) { setKeyInfo(null); return; }
        helper("key-get", [chosenVm]).then(setKeyInfo).catch(() => setKeyInfo({ exists: false }));
    }, [chosenVm]);

    const set = patch => setForm(f => ({ ...f, ...patch }));

    const save = async () => {
        if (!chosenVm) { setError(t("Choose a VM first")); return; }
        setSaving(true);
        setError(null);
        try {
            await helper("entry-save", [], JSON.stringify({
                vm: chosenVm,
                active: form.ACTIVE ? 1 : 0,
                mode: form.MODE,
                remote_target: form.REMOTE_TARGET.trim(),
                ssh_opts: form.REMOTE_SSH_OPTS,
                storage_root: form.STORAGE_ROOT.trim(),
                full_every_days: form.FULL_EVERY_DAYS,
                max_incs: form.MAX_INCS,
                keep_chains: form.KEEP_CHAINS,
                backup_timeout: form.BACKUP_TIMEOUT,
                qemu_img_check: form.QEMU_IMG_CHECK ? 1 : 0,
            }));
            onSaved();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    const showForm = !isNew || chosenVm;

    return (
        <div className="entry-editor">
            <Form>
                {isNew && (
                    <FormGroup label={t("Virtual machine")} fieldId="ef-vm">
                        <select id="ef-vm" className="pf-v6-c-form-control" value={chosenVm}
                            onChange={e => setChosenVm(e.target.value)}>
                            <option value="">{t("— select a VM —")}</option>
                            {unconfigured.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        {unconfigured.length === 0 && (
                            <HelperText><HelperTextItem variant="warning">
                                {t("Every running VM already has a configuration.")}
                            </HelperTextItem></HelperText>
                        )}
                    </FormGroup>
                )}
                {!isNew && <Content component={ContentVariants.h4}>{chosenVm}</Content>}

                {showForm && (
                    <>
                        <FormGroup fieldId="ef-active">
                            <Switch id="ef-active"
                                label={t("Replication active")}
                                isChecked={form.ACTIVE}
                                onChange={(_e, v) => set({ ACTIVE: v })}
                                hasCheckIcon />
                            <HelperText><HelperTextItem>
                                {t("When off, this VM is skipped by both scheduled and manual runs.")}
                            </HelperTextItem></HelperText>
                        </FormGroup>
                        <FormGroup label={t("Run mode")} fieldId="ef-mode" role="radiogroup">
                            <Radio id="ef-mode-schedule" name="ef-mode"
                                label={t("By schedule (hourly timer)")}
                                isChecked={form.MODE === "schedule"}
                                onChange={() => set({ MODE: "schedule" })} />
                            <Radio id="ef-mode-manual" name="ef-mode"
                                label={t("Manual only — run with the button, as a full copy or an increment")}
                                isChecked={form.MODE === "manual"}
                                onChange={() => set({ MODE: "manual" })} />
                            <HelperText><HelperTextItem>
                                {t("Manual-only VMs are skipped by the hourly timer; use the Run button or its menu to choose the copy type.")}
                            </HelperTextItem></HelperText>
                        </FormGroup>
                        <FormGroup label={t("Remote target")} fieldId="ef-remote"
                            helperText={t("Empty = keep local copies only. Port goes into SSH options (-p <port>).")}>
                            <TextInput id={`ef-remote-${chosenVm}`} value={form.REMOTE_TARGET}
                                placeholder="user@remote-host:/srv/vm-replication"
                                onChange={(_e, v) => set({ REMOTE_TARGET: v })} />
                        </FormGroup>
                        <FormGroup label={t("SSH options")} fieldId="ef-sshopts">
                            <TextInput id={`ef-sshopts-${chosenVm}`} value={form.REMOTE_SSH_OPTS}
                                onChange={(_e, v) => set({ REMOTE_SSH_OPTS: v })} />
                        </FormGroup>
                        {chosenVm && (
                            <FormGroup label={t("Access check")}>
                                <CheckBlock vm={chosenVm} target={form.REMOTE_TARGET} opts={form.REMOTE_SSH_OPTS} />
                            </FormGroup>
                        )}
                        <FormGroup label={t("Dedicated SSH key")} fieldId="ef-key"
                            helperText={t("Used automatically for this configuration while it exists.")}>
                            {chosenVm && <KeyBlock vm={chosenVm} keyInfo={keyInfo} setKeyInfo={setKeyInfo} disabled={false} />}
                        </FormGroup>

                        <FormGroup label={t("Local storage root")} fieldId="ef-root">
                            <TextInput id={`ef-root-${chosenVm}`} value={form.STORAGE_ROOT}
                                onChange={(_e, v) => set({ STORAGE_ROOT: v })} />
                        </FormGroup>

                        <Grid hasGutter md={4}>
                            <GridItem><FormGroup label={t("Full copy every, days")} fieldId="ef-full">
                                <TextInput id="ef-full" type="number" min="1" value={form.FULL_EVERY_DAYS}
                                    onChange={(_e, v) => set({ FULL_EVERY_DAYS: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem><FormGroup label={t("Max increments")} fieldId="ef-max">
                                <TextInput id="ef-max" type="number" min="1" value={form.MAX_INCS}
                                    onChange={(_e, v) => set({ MAX_INCS: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem><FormGroup label={t("Chains to keep")} fieldId="ef-keep">
                                <TextInput id="ef-keep" type="number" min="1" value={form.KEEP_CHAINS}
                                    onChange={(_e, v) => set({ KEEP_CHAINS: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem><FormGroup label={t("Backup timeout, s")} fieldId="ef-timeout">
                                <TextInput id="ef-timeout" type="number" min="60" value={form.BACKUP_TIMEOUT}
                                    onChange={(_e, v) => set({ BACKUP_TIMEOUT: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem span={2}><FormGroup label={t("Integrity check")} fieldId="ef-qcheck">
                                <Switch id="ef-qcheck" label={t("qemu-img check before sending")}
                                    isChecked={form.QEMU_IMG_CHECK}
                                    onChange={(_e, v) => set({ QEMU_IMG_CHECK: v })} /></FormGroup></GridItem>
                        </Grid>
                    </>
                )}

                {error && <Alert variant="danger" isInline title={error} />}
                <Flex gap={{ default: "gapSm" }}>
                    <FlexItem><Button variant="primary" onClick={save} isDisabled={saving || !chosenVm}>
                        {saving ? t("Saving…") : (isNew ? t("Add configuration") : t("Save changes"))}</Button></FlexItem>
                    <FlexItem><Button variant="link" onClick={onCancel} isDisabled={saving}>{t("Cancel")}</Button></FlexItem>
                </Flex>
            </Form>
        </div>
    );
}

/* ----------------------------------------------------------- defaults --- */

function DefaultsCard() {
    const { status, refresh, setActionError } = useStatus();
    const [open, setOpen] = useState(false);
    const [d, setD] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (status && !d)
            setD({
                LIBVIRT_URI: status.defaults?.LIBVIRT_URI || "qemu:///system",
                STORAGE_ROOT: status.defaults?.STORAGE_ROOT || "/mnt/dd/replication",
                FULL_EVERY_DAYS: toInt(status.defaults?.FULL_EVERY_DAYS || 7),
                MAX_INCS: toInt(status.defaults?.MAX_INCS || 48),
                KEEP_CHAINS: toInt(status.defaults?.KEEP_CHAINS || 2),
                BACKUP_TIMEOUT: toInt(status.defaults?.BACKUP_TIMEOUT || 14400),
                QEMU_IMG_CHECK: String(status.defaults?.QEMU_IMG_CHECK ?? "1") !== "0",
            });
    }, [status, d]);

    if (!d) return null;
    const set = patch => setD(x => ({ ...x, ...patch }));
    const save = async () => {
        setSaving(true);
        try {
            await helper("defaults-set", [], JSON.stringify({
                LIBVIRT_URI: d.LIBVIRT_URI.trim(),
                STORAGE_ROOT: d.STORAGE_ROOT.trim(),
                FULL_EVERY_DAYS: d.FULL_EVERY_DAYS, MAX_INCS: d.MAX_INCS,
                KEEP_CHAINS: d.KEEP_CHAINS, BACKUP_TIMEOUT: d.BACKUP_TIMEOUT,
                QEMU_IMG_CHECK: d.QEMU_IMG_CHECK ? 1 : 0,
            }));
            await refresh();
            setOpen(false);
        } catch (e) {
            setActionError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader actions={{ actions: (
                <Button variant="link" onClick={() => setOpen(o => !o)}>{open ? t("Hide") : t("Edit")}</Button>) }}>
                <CardTitle>{t("Global defaults")}</CardTitle>
            </CardHeader>
            <CardBody>
                <Content component={ContentVariants.small}>
                    {t("libvirt URI")} <code>{d.LIBVIRT_URI}</code> {t("· default storage")} <code>{d.STORAGE_ROOT}</code>{" "}
                    {t("· full every {days}d / max {incs} incr. / keep {chains} — used to seed new configurations.",
                       { days: d.FULL_EVERY_DAYS, incs: d.MAX_INCS, chains: d.KEEP_CHAINS })}
                </Content>
                {open && (
                    <Form style={{ marginTop: "1rem" }}>
                        <FormGroup label={t("libvirt URI")} fieldId="d-uri">
                            <TextInput id="d-uri" value={d.LIBVIRT_URI} onChange={(_e, v) => set({ LIBVIRT_URI: v })} /></FormGroup>
                        <FormGroup label={t("Default storage root")} fieldId="d-root">
                            <TextInput id="d-root" value={d.STORAGE_ROOT} onChange={(_e, v) => set({ STORAGE_ROOT: v })} /></FormGroup>
                        <Grid hasGutter md={4}>
                            <GridItem><FormGroup label={t("Full every, days")}><TextInput type="number" min="1" value={d.FULL_EVERY_DAYS} onChange={(_e, v) => set({ FULL_EVERY_DAYS: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem><FormGroup label={t("Max increments")}><TextInput type="number" min="1" value={d.MAX_INCS} onChange={(_e, v) => set({ MAX_INCS: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem><FormGroup label={t("Chains to keep")}><TextInput type="number" min="1" value={d.KEEP_CHAINS} onChange={(_e, v) => set({ KEEP_CHAINS: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem><FormGroup label={t("Backup timeout, s")}><TextInput type="number" min="60" value={d.BACKUP_TIMEOUT} onChange={(_e, v) => set({ BACKUP_TIMEOUT: toInt(v) })} /></FormGroup></GridItem>
                            <GridItem span={2}><FormGroup label={t("Integrity check")}><Switch id="d-qc" label={t("qemu-img check")} isChecked={d.QEMU_IMG_CHECK} onChange={(_e, v) => set({ QEMU_IMG_CHECK: v })} /></FormGroup></GridItem>
                        </Grid>
                        <Button variant="primary" onClick={save} isDisabled={saving}>{saving ? t("Saving…") : t("Save defaults")}</Button>
                    </Form>
                )}
            </CardBody>
        </Card>
    );
}

/* ---------------------------------------------------------- configurations --- */

export function ConfigView() {
    const { status, refresh, setActionError } = useStatus();
    const [editing, setEditing] = useState(null); // vm name or "new"
    const [deleteVm, setDeleteVm] = useState(null);
    const [deleting, setDeleting] = useState(false);

    if (!status) return <Spinner size="lg" />;

    const entries = status.entries || [];
    const configuredVms = entries.filter(e => e.in_config).map(e => e.vm);
    const unconfigured = status.all_vms.filter(v => !configuredVms.includes(v));

    const doDelete = async () => {
        setDeleting(true);
        try {
            await helper("entry-delete", [deleteVm]);
            setDeleteVm(null);
            await refresh();
        } catch (e) {
            setActionError(errorMessage(e));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Flex direction={{ default: "column" }} gap={{ default: "gapMd" }}>
            <Card>
                <CardHeader actions={{ actions: (
                    <Button variant="primary" isDisabled={!!editing} onClick={() => setEditing("new")}>
                        {t("Add configuration")}
                    </Button>) }}>
                    <CardTitle>{t("Replication configurations")}</CardTitle>
                </CardHeader>
                <CardBody>
                    {entries.filter(e => e.in_config).length === 0 && !editing && (
                        <Content component={ContentVariants.p}>
                            {t("No configurations yet — add one to replicate a VM with its own remote target and SSH key.")}
                        </Content>
                    )}
                    <table className="vm-table">
                        <thead>
                            <tr>
                                <th>{t("VM")}</th><th>{t("State")}</th><th>{t("Active")}</th><th>{t("Remote")}</th><th>{t("Key")}</th>
                                <th>{t("Next run")}</th><th>{t("Last result")}</th><th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {editing === "new" && (
                                <tr className="edit-row"><td colSpan={8}>
                                    <EntryForm vm="" isNew unconfigured={unconfigured}
                                        defaults={status.defaults}
                                        onCancel={() => setEditing(null)}
                                        onSaved={() => { setEditing(null); refresh(); }} />
                                </td></tr>
                            )}
                            {entries.map(e => (
                                <React.Fragment key={e.vm}>
                                    <tr>
                                        <td>
                                            <strong>{e.vm}</strong>
                                            {!e.in_config && <Label color="orange" style={{ marginLeft: "0.5rem" }}>{t("no config")}</Label>}
                                            {e.in_config && e.config.MODE === "manual"
                                                && <Label color="blue" style={{ marginLeft: "0.5rem" }}>{tc("mode", "manual")}</Label>}
                                        </td>
                                        <td>{vmStateText(e.state)}</td>
                                        <td>
                                            <ActivitySwitch vm={e.vm}
                                                active={e.config.ACTIVE !== "0"}
                                                isDisabled={!!editing}
                                                onChange={on =>
                                                    helper("entry-save", [], JSON.stringify({ vm: e.vm, active: on ? 1 : 0 }))
                                                        .then(refresh)
                                                        .catch(err => setActionError(errorMessage(err)))} />
                                        </td>
                                        <td>{e.config.REMOTE_TARGET
                                            ? <span title={e.config.REMOTE_TARGET}>{e.config.REMOTE_TARGET.split(":")[0]}</span>
                                            : <Label color="grey">{t("local only")}</Label>}</td>
                                        <td>{e.key.exists
                                            ? <Label color="green">{t("dedicated")}</Label>
                                            : <Label color="grey">{t("default")}</Label>}</td>
                                        <td>{e.next_action
                                            ? (e.next_action === "full" ? t("full copy") : t("increment"))
                                            : "—"}</td>
                                        <td>{e.last_run ? runStatus(e.last_run.status) : "—"}</td>
                                        <td>
                                            <Flex gap={{ default: "gapSm" }}>
                                                <FlexItem>
                                                    <Button variant="secondary" size="sm" isDisabled={!!editing}
                                                        onClick={() => setEditing(e.vm)}>{t("Edit")}</Button>
                                                </FlexItem>
                                                {e.in_config && (
                                                    <FlexItem>
                                                        <Button variant="plain" size="sm" isDanger aria-label={t("Delete {vm}", { vm: e.vm })}
                                                            isDisabled={!!editing} onClick={() => setDeleteVm(e.vm)}>{t("Delete")}</Button>
                                                    </FlexItem>
                                                )}
                                            </Flex>
                                        </td>
                                    </tr>
                                    {editing === e.vm && (
                                        <tr className="edit-row"><td colSpan={8}>
                                            <EntryForm vm={e.vm} isNew={false} initial={e.config}
                                                defaults={status.defaults}
                                                onCancel={() => setEditing(null)}
                                                onSaved={() => { setEditing(null); refresh(); }} />
                                        </td></tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </CardBody>
            </Card>

            <DefaultsCard />

            <Modal isOpen={!!deleteVm} onClose={() => setDeleteVm(null)} variant="small">
                <ModalHeader title={t("Delete configuration {vm}?", { vm: deleteVm || "" })} />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        {t("Removes this VM's replication configuration file. Existing chains on disk and the SSH key are kept.")}
                    </Content>
                </ModalBody>
                <ModalFooter>
                    <Button variant="danger" isDisabled={deleting} onClick={doDelete}>{t("Delete")}</Button>
                    <Button variant="link" isDisabled={deleting} onClick={() => setDeleteVm(null)}>{t("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </Flex>
    );
}
