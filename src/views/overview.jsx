import React, { useState } from "react";
import {
    ActionList, ActionListItem, Alert, Button, Card, CardBody, CardFooter,
    CardHeader, CardTitle, Content, ContentVariants, DescriptionList,
    DescriptionListDescription, DescriptionListGroup, DescriptionListTerm,
    Flex, FlexItem, Label, Modal, ModalBody, ModalFooter, ModalHeader,
    Progress, Spinner,
} from "@patternfly/react-core";
import {
    CheckCircleIcon, ExclamationCircleIcon, RedoIcon, SyncAltIcon,
} from "@patternfly/react-icons";
import { errorMessage, fmtBytes, fmtDateTime, helper, timeAgo } from "../api.js";
import { useStatus } from "../app.jsx";

function stateLabel(state) {
    if (state === "running") return <Label color="green">running</Label>;
    if (state === "shut off") return <Label color="grey">shut off</Label>;
    if (state === "missing") return <Label color="red">missing</Label>;
    return <Label color="orange">{state}</Label>;
}

function runIcon(run) {
    if (!run) return <span>—</span>;
    if (run.status === "running") return <Spinner size="md" aria-label="running" />;
    if (run.status === "error")
        return (
            <span className="pf-v6-u-text-color-danger">
                <ExclamationCircleIcon /> error
            </span>
        );
    if (run.status === "warning")
        return (
            <span className="pf-v6-u-text-color-warning">
                <ExclamationCircleIcon /> warning
            </span>
        );
    return (
        <span className="pf-v6-u-text-color-success">
            <CheckCircleIcon /> ok
        </span>
    );
}

export function Overview() {
    const { status, refresh, setActionError, goto } = useStatus();
    const [confirmRun, setConfirmRun] = useState(false);
    const [toggling, setToggling] = useState(false);

    if (!status)
        return <Spinner size="lg" />;

    const { timer, storage, remote, manual_run: manual } = status;
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
                    title={`Last replication of ${failedVm.name} failed (${timeAgo(failedVm.last_run.ts)})`}
                >
                    {failedVm.last_run.messages.slice(-2).join(" · ")}
                </Alert>
            )}
            {!timer.active && (
                <Alert variant="warning" isInline title="Hourly replication timer is not active">
                    Copies are only made on manual runs. Start the timer below or with
                    {" "}<code>systemctl start vm-replication.timer</code>.
                </Alert>
            )}
            {remote.configured === false && (
                <Alert variant="info" isInline title="No remote target configured — copies stay on this host">
                    Set <code>REMOTE_TARGET</code> on the Configuration tab to mirror chains
                    to a remote host over rsync/ssh.
                </Alert>
            )}

            <Flex direction={{ default: "column" }} gap={{ default: "gapLg" }}>
                <Flex>
                    <FlexItem flex={{ default: "flex_2" }}>
                        <Card isFullHeight>
                            <CardHeader>
                                <CardTitle>Replication job</CardTitle>
                            </CardHeader>
                            <CardBody>
                                <DescriptionList isCompact columnModifier={{ default: "2Col" }}>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Hourly timer</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {toggling
                                                ? <Spinner size="md" />
                                                : <Label color={timer.active ? "green" : "red"}
                                                    onClick={toggleTimer} isClickable>
                                                    {timer.active ? "active" : "inactive"}
                                                </Label>}
                                            {" "}({timer.unit_file_state || "unknown"})
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Next run</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {timer.next_elapse || "—"}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Last trigger</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {timer.last_trigger || "—"}
                                            {timer.service_result &&
                                                ` · result: ${timer.service_result}`}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Status now</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {status.busy
                                                ? <><SyncAltIcon className="pf-v6-u-rotate-90 pf-v6-u-mr-sm" /> replication is running</>
                                                : "idle"}
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
                                            Run now (all VMs)
                                        </Button>
                                    </ActionListItem>
                                    <ActionListItem>
                                        <Button
                                            variant="secondary"
                                            isDisabled={toggling}
                                            onClick={toggleTimer}
                                        >
                                            {timer.active ? "Pause timer" : "Start timer"}
                                        </Button>
                                    </ActionListItem>
                                    <ActionListItem>
                                        <Button variant="link" onClick={() => goto(null, "logs")}>
                                            Open journal
                                        </Button>
                                    </ActionListItem>
                                </ActionList>
                            </CardFooter>
                        </Card>
                    </FlexItem>
                    <FlexItem flex={{ default: "flex_1" }}>
                        <Card isFullHeight>
                            <CardHeader>
                                <CardTitle>Storage &amp; remote</CardTitle>
                            </CardHeader>
                            <CardBody>
                                <DescriptionList isCompact>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Local storage</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <code>{storage.root}</code>
                                            {!storage.exists && (
                                                <span className="pf-v6-u-text-color-danger"> (missing)</span>
                                            )}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Space</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {fmtBytes(storage.free_bytes)} free of{" "}
                                            {fmtBytes(storage.total_bytes)}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                                {usedPct !== null && (
                                    <Progress
                                        value={usedPct}
                                        title="Volume usage"
                                        variant={usedPct > 90 ? "danger" : usedPct > 75 ? "warning" : undefined}
                                        style={{ marginTop: "0.5rem" }}
                                    />
                                )}
                                <DescriptionList isCompact style={{ marginTop: "1rem" }}>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Remote mirror</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {remote.configured
                                                ? <Label color="blue">{remote.target}</Label>
                                                : <Label color="grey">local only</Label>}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                            </CardBody>
                        </Card>
                    </FlexItem>
                </Flex>

                <Card>
                    <CardHeader>
                        <CardTitle>Virtual machines</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <table className="vm-table">
                            <thead>
                                <tr>
                                    <th>VM</th>
                                    <th>State</th>
                                    <th>In config</th>
                                    <th>Active chain</th>
                                    <th>Increments</th>
                                    <th>Chain size</th>
                                    <th>Last backup</th>
                                    <th>Next run will do</th>
                                    <th>Last result</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {status.vms.length === 0 && (
                                    <tr><td colSpan={10}>No replicated VMs yet — add some on the Configuration tab.</td></tr>
                                )}
                                {status.vms.map(vm => {
                                    const active = vm.chains.find(c => c.name === vm.active_chain);
                                    return (
                                        <tr key={vm.name}>
                                            <td><strong>{vm.name}</strong></td>
                                            <td>{stateLabel(vm.state)}</td>
                                            <td>{vm.in_config
                                                ? <Label color="green">yes</Label>
                                                : <Label color="orange">no</Label>}</td>
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
                                                        {vm.next_action === "full" ? "full copy" : "increment"}
                                                    </Label>
                                                    : "—"}
                                            </td>
                                            <td>{runIcon(vm.last_run)}</td>
                                            <td>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    isDisabled={status.busy || vm.state !== "running"}
                                                    onClick={() => helper("run", ["--vm", vm.name])
                                                        .then(refresh)
                                                        .catch(e => setActionError(errorMessage(e)))}
                                                >
                                                    Run
                                                </Button>
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
                <ModalHeader title="Run replication now?" />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        <code>vm-replicate</code> will run for every VM in the configuration.
                        Running VMs get an incremental backup; stopped VMs get a cold copy.
                        The job can take a while and its output appears in the Journal tab.
                    </Content>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" onClick={runNow}>Run</Button>
                    <Button variant="link" onClick={() => setConfirmRun(false)}>Cancel</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
