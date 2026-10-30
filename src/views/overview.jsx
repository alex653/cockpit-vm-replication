import React, { useState } from "react";
import {
    ActionList, ActionListItem, Alert, Button, Card, CardBody, CardFooter,
    CardHeader, CardTitle, Content, ContentVariants, DescriptionList,
    DescriptionListDescription, DescriptionListGroup, DescriptionListTerm,
    Dropdown, DropdownItem, DropdownList, Flex, FlexItem, Label, MenuToggle,
    Modal, ModalBody, ModalFooter, ModalHeader,
    Progress, Spinner, Switch,
} from "@patternfly/react-core";
import {
    CheckCircleIcon, EllipsisVIcon, ExclamationCircleIcon, RedoIcon, SyncAltIcon,
} from "@patternfly/react-icons";
import { errorMessage, fmtBytes, fmtDateTime, helper, timeAgo } from "../api.js";
import { t, tc, tn } from "../i18n.js";
import { useStatus } from "../app.jsx";

export function vmStateText(state) {
    if (state === "running") return tc("vm-state", "running");
    if (state === "shut off") return tc("vm-state", "shut off");
    if (state === "missing") return tc("vm-state", "missing");
    return state;
}

export function vmStateLabel(state) {
    if (state === "running") return <Label color="green">{vmStateText(state)}</Label>;
    if (state === "shut off") return <Label color="grey">{vmStateText(state)}</Label>;
    if (state === "missing") return <Label color="red">{vmStateText(state)}</Label>;
    return <Label color="orange">{state}</Label>;
}

export function runStatus(status) {
    switch (status) {
    case "running": return tc("run-status", "running");
    case "error": return tc("run-status", "error");
    case "warning": return tc("run-status", "warning");
    case "ok": return tc("run-status", "ok");
    default: return status;
    }
}

function runIcon(run) {
    if (!run) return <span>—</span>;
    if (run.status === "running") return <Spinner size="md" aria-label={tc("run-status", "running")} />;
    if (run.status === "error")
        return (
            <span className="pf-v6-u-text-color-danger">
                <ExclamationCircleIcon /> {tc("run-status", "error")}
            </span>
        );
    if (run.status === "warning")
        return (
            <span className="pf-v6-u-text-color-warning">
                <ExclamationCircleIcon /> {tc("run-status", "warning")}
            </span>
        );
    return (
        <span className="pf-v6-u-text-color-success">
            <CheckCircleIcon /> {tc("run-status", "ok")}
        </span>
    );
}

/* start a manual replication run: kind = null (auto) | "full" | "incremental" */
export function runVM(vm, kind, { refresh, setActionError }) {
    const args = ["--vm", vm];
    if (kind) args.push(`--${kind}`);
    helper("run", args)
        .then(refresh)
        .catch(e => setActionError(errorMessage(e)));
}

/* Run button + a small menu to force a full copy or an increment */
export function RunMenu({ vm, label, isDisabled, onRun }) {
    const [open, setOpen] = useState(false);
    return (
        <Flex gap={{ default: "gapSm" }} alignItems={{ default: "alignItemsCenter" }}>
            <FlexItem>
                <Button variant="secondary" size="sm" isDisabled={isDisabled}
                    onClick={() => onRun(null)}>
                    {label}
                </Button>
            </FlexItem>
            <FlexItem>
                <Dropdown
                    isOpen={open}
                    onOpenChange={setOpen}
                    toggle={toggleRef => (
                        <MenuToggle ref={toggleRef} variant="plain" size="sm"
                            isDisabled={isDisabled}
                            aria-label={t("Copy type for {name}", { name: vm })}
                            onClick={() => setOpen(!open)}>
                            <EllipsisVIcon />
                        </MenuToggle>
                    )}
                >
                    <DropdownList>
                        <DropdownItem key="full" onClick={() => { setOpen(false); onRun("full"); }}>
                            {t("full copy")}
                        </DropdownItem>
                        <DropdownItem key="incremental" onClick={() => { setOpen(false); onRun("incremental"); }}>
                            {t("increment")}
                        </DropdownItem>
                    </DropdownList>
                </Dropdown>
            </FlexItem>
        </Flex>
    );
}

/* per-VM activity toggle (writes ACTIVE=0/1 into the profile) */
export function ActivitySwitch({ vm, active, isDisabled, onChange }) {
    return (
        <Switch
            id={`activity-${vm}`}
            aria-label={t("Toggle replication for {name}", { name: vm })}
            isChecked={active}
            isDisabled={isDisabled}
            onChange={(_e, v) => onChange(v)}
        />
    );
}

export function Overview() {
    const { status, refresh, setActionError, goto } = useStatus();
    const [confirmRun, setConfirmRun] = useState(false);
    const [toggling, setToggling] = useState(false);

    if (!status)
        return <Spinner size="lg" />;

    const { timer, storage, manual_run: manual } = status;
    const configured = status.vms.filter(v => v.in_config);
    const localOnly = configured.filter(v => !v.config.REMOTE_TARGET);
    const usedPct = storage.total_bytes
        ? Math.round(((storage.total_bytes - storage.free_bytes) / storage.total_bytes) * 100)
        : null;
    const failedVm = status.vms.find(v => v.last_run && v.last_run.status === "error");

    const runNow = async () => {
        setConfirmRun(false);
        try {
            await helper("run");
            await refresh();
        } catch (e) {
            setActionError(errorMessage(e));
        }
    };

    const toggleTimer = async () => {
        setToggling(true);
        try {
            await helper("timer", [timer.active ? "stop" : "start"]);
            await refresh();
        } catch (e) {
            setActionError(errorMessage(e));
        } finally {
            setToggling(false);
        }
    };

    return (
        <>
            {failedVm && (
                <Alert
                    variant="danger"
                    isInline
                    title={t("Last replication of {name} failed ({time})",
                             { name: failedVm.name, time: timeAgo(failedVm.last_run.ts) })}
                >
                    {failedVm.last_run.messages.slice(-2).join(" · ")}
                </Alert>
            )}
            {!timer.active && (
                <Alert variant="warning" isInline title={t("Hourly replication timer is not active")}>
                    {t("Copies are only made on manual runs. Start the timer below or with")}
                    {" "}<code>systemctl start vm-replication.timer</code>.
                </Alert>
            )}
            {configured.length > 0 && localOnly.length > 0 && (
                <Alert variant="info" isInline
                    title={tn(localOnly.length,
                              "{n} configuration has no remote target — its copies stay on this host",
                              "{n} configurations have no remote target — their copies stay on this host",
                              { n: localOnly.length })}>
                    {localOnly.map(v => v.name).join(", ")} — {t(
                        "set a Remote target on the Configuration tab to mirror over rsync/ssh.")}
                </Alert>
            )}

            <Flex direction={{ default: "column" }} gap={{ default: "gapLg" }}>
                <Flex direction={{ default: "column", md: "row" }} gap={{ default: "gapMd", md: "gapLg" }}>
                    <FlexItem flex={{ md: "flex_2" }}>
                        <Card isFullHeight>
                            <CardHeader>
                                <CardTitle>{t("Replication job")}</CardTitle>
                            </CardHeader>
                            <CardBody>
                                <DescriptionList isCompact columnModifier={{ default: "2Col" }}>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Hourly timer")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {toggling
                                                ? <Spinner size="md" />
                                                : <Label color={timer.active ? "green" : "red"}
                                                    onClick={toggleTimer} isClickable>
                                                    {timer.active ? tc("timer", "active") : tc("timer", "inactive")}
                                                </Label>}
                                            {" "}({timer.unit_file_state || t("unknown")})
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Next run")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {timer.next_elapse || "—"}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Last trigger")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {timer.last_trigger || "—"}
                                            {timer.service_result &&
                                                ` · ${t("result: {result}", { result: timer.service_result })}`}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Status now")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {status.busy
                                                ? <><SyncAltIcon className="pf-v6-u-rotate-90 pf-v6-u-mr-sm" /> {t("replication is running")}</>
                                                : t("idle")}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                                {status.busy && manual?.log_tail?.length > 0 && (
                                    <pre className="log-tail">{manual.log_tail.slice(-8).join("\n")}</pre>
                                )}
                            </CardBody>
                            <CardFooter>
                                <ActionList>
                                    <ActionListItem>
                                        <Button
                                            variant="primary"
                                            icon={<RedoIcon />}
                                            isDisabled={status.busy}
                                            onClick={() => setConfirmRun(true)}
                                        >
                                            {t("Run now (all VMs)")}
                                        </Button>
                                    </ActionListItem>
                                    <ActionListItem>
                                        <Button
                                            variant="secondary"
                                            isDisabled={toggling}
                                            onClick={toggleTimer}
                                        >
                                            {timer.active ? t("Pause timer") : t("Start timer")}
                                        </Button>
                                    </ActionListItem>
                                    <ActionListItem>
                                        <Button variant="link" onClick={() => goto(null, "logs")}>
                                            {t("Open journal")}
                                        </Button>
                                    </ActionListItem>
                                </ActionList>
                            </CardFooter>
                        </Card>
                    </FlexItem>
                    <FlexItem flex={{ md: "flex_1" }}>
                        <Card isFullHeight>
                            <CardHeader>
                                <CardTitle>{t("Storage")}</CardTitle>
                            </CardHeader>
                            <CardBody>
                                <DescriptionList isCompact>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Local storage")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <code>{storage.root}</code>
                                            {!storage.exists && (
                                                <span className="pf-v6-u-text-color-danger"> {t("(missing)")}</span>
                                            )}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Space")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {t("{free} free of {total}",
                                               { free: fmtBytes(storage.free_bytes), total: fmtBytes(storage.total_bytes) })}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                                {usedPct !== null && (
                                    <Progress
                                        value={usedPct}
                                        title={t("Volume usage")}
                                        variant={usedPct > 90 ? "danger" : usedPct > 75 ? "warning" : undefined}
                                        style={{ marginTop: "0.5rem" }}
                                    />
                                )}
                                <DescriptionList isCompact style={{ marginTop: "1rem" }}>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{t("Configurations")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {configured.length}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                            </CardBody>
                        </Card>
                    </FlexItem>
                </Flex>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("Virtual machines")}</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <table className="vm-table">
                            <thead>
                                <tr>
                                    <th>{t("VM")}</th>
                                    <th>{t("State")}</th>
                                    <th>{t("In config")}</th>
                                    <th>{t("Active")}</th>
                                    <th>{t("Remote")}</th>
                                    <th>{t("Active chain")}</th>
                                    <th>{t("Increments")}</th>
                                    <th>{t("Chain size")}</th>
                                    <th>{t("Last backup")}</th>
                                    <th>{t("Next run will do")}</th>
                                    <th>{t("Last result")}</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {status.vms.length === 0 && (
                                    <tr><td colSpan={12}>{t("No replicated VMs yet — add some on the Configuration tab.")}</td></tr>
                                )}
                                {status.vms.map(vm => {
                                    const active = vm.chains.find(c => c.name === vm.active_chain);
                                    const isActive = vm.config?.ACTIVE !== "0";
                                    const toggleActivity = on =>
                                        helper("entry-save", [], JSON.stringify({ vm: vm.name, active: on ? 1 : 0 }))
                                            .then(refresh)
                                            .catch(e => setActionError(errorMessage(e)));
                                    return (
                                        <tr key={vm.name}>
                                            <td><strong>{vm.name}</strong></td>
                                            <td>{vmStateLabel(vm.state)}</td>
                                            <td>{vm.in_config
                                                ? <Label color="green">{t("yes")}</Label>
                                                : <Label color="orange">{t("no")}</Label>}</td>
                                            <td>
                                                <ActivitySwitch vm={vm.name} active={isActive}
                                                    isDisabled={status.busy}
                                                    onChange={toggleActivity} />
                                            </td>
                                            <td>
                                                {vm.config?.REMOTE_TARGET
                                                    ? <span title={vm.config.REMOTE_TARGET}>{vm.config.REMOTE_TARGET.split(":")[0]}</span>
                                                    : <Label color="grey">{t("local only")}</Label>}
                                            </td>
                                            <td>
                                                {active ? (
                                                    <Button variant="link" isInline
                                                        onClick={() => goto(null, "chains")}>
                                                        {active.name}
                                                    </Button>
                                                ) : "—"}
                                            </td>
                                            <td>{active ? active.inc_count : "—"}</td>
                                            <td>{active ? fmtBytes(active.total_bytes) : "—"}</td>
                                            <td title={active?.last_backup ? fmtDateTime(active.last_backup) : ""}>
                                                {active?.last_backup ? timeAgo(active.last_backup) : "—"}
                                            </td>
                                            <td>
                                                {vm.next_action
                                                    ? <Label color={vm.next_action === "full" ? "purple" : "cyan"}>
                                                        {vm.next_action === "full" ? t("full copy") : t("increment")}
                                                    </Label>
                                                    : "—"}
                                            </td>
                                            <td>{runIcon(vm.last_run)}</td>
                                            <td>
                                                <RunMenu vm={vm.name} label={t("Run")}
                                                    isDisabled={status.busy || vm.state !== "running" || !isActive}
                                                    onRun={kind => runVM(vm.name, kind, { refresh, setActionError })} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </CardBody>
                </Card>
            </Flex>

            <Modal
                isOpen={confirmRun}
                onClose={() => setConfirmRun(false)}
                variant="small"
            >
                <ModalHeader title={t("Run replication now?")} />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        <code>vm-replicate</code> {t("will run for every VM in the configuration. Running VMs get an incremental backup; stopped VMs get a cold copy. The job can take a while and its output appears in the Journal tab.")}
                    </Content>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" onClick={runNow}>{t("Run")}</Button>
                    <Button variant="link" onClick={() => setConfirmRun(false)}>{t("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
