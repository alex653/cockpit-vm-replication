import React, { useState } from "react";
import {
    Alert, Button, Card, CardBody, CardHeader, CardTitle, Content,
    ContentVariants, Flex, FlexItem, Label, Modal, ModalBody, ModalFooter,
    ModalHeader, Spinner,
} from "@patternfly/react-core";
import { TrashIcon } from "@patternfly/react-icons";
import { errorMessage, fmtBytes, fmtDateTime, helper, timeAgo } from "../api.js";
import { t, tc } from "../i18n.js";
import { useStatus } from "../app.jsx";
import { vmStateText, RunMenu, runVM } from "./overview.jsx";

export function Chains() {
    const { status, refresh, setActionError, goto } = useStatus();
    const [expanded, setExpanded] = useState({});
    const [deleting, setDeleting] = useState(null); // {vm, chain, kind}
    const [deleteError, setDeleteError] = useState(null);
    const [working, setWorking] = useState(false);

    if (!status)
        return <Spinner size="lg" />;

    const toggle = name => setExpanded(e => ({ ...e, [name]: !e[name] }));

    const doDelete = async () => {
        setWorking(true);
        setDeleteError(null);
        try {
            await helper("chain-delete", [deleting.vm, deleting.chain]);
            setDeleting(null);
            await refresh();
        } catch (e) {
            setDeleteError(errorMessage(e));
        } finally {
            setWorking(false);
        }
    };

    return (
        <>
            {status.vms.filter(v => !v.in_config).map(v => (
                <Alert key={v.name} variant="info" isInline
                    title={t("{name} exists on this host but is not in the replication config", { name: v.name })}>
                    {t("Add it on the")} <Button variant="link" isInline
                        onClick={() => goto(null, "config")}>{t("Configuration")}</Button> {t("tab.")}
                </Alert>
            ))}
            {status.vms.length === 0 && (
                <Alert variant="info" isInline title={t("Nothing replicated yet")}>
                    {t("Add VMs on the Configuration tab first.")}
                </Alert>
            )}

            <Flex direction={{ default: "column" }} gap={{ default: "gapMd" }}>
                {status.vms.map(vm => {
                    const isOpen = !!expanded[vm.name];
                    return (
                        <Card key={vm.name}>
                            <CardHeader
                                onExpand={() => toggle(vm.name)}
                                expandable={{ isExpandable: true, isExpanded: isOpen }}
                                actions={{
                                    actions: (
                                        <RunMenu
                                            vm={vm.name} label={t("Replicate now")}
                                            isDisabled={status.busy || vm.state !== "running"}
                                            onRun={kind => runVM(vm.name, kind, { refresh, setActionError })} />
                                    ),
                                }}
                            >
                                <CardTitle>
                                    {vm.name}{" "}
                                    <Label color={vm.state === "running" ? "green" : "grey"}
                                        style={{ marginLeft: "0.5rem" }}>
                                        {vmStateText(vm.state)}
                                    </Label>
                                    {vm.checkpoints.length > 0 && (
                                        <span className="pf-v6-u-color-200" style={{ marginLeft: "1rem" }}>
                                            {t("checkpoint: {name}", { name: vm.checkpoints[vm.checkpoints.length - 1] })}
                                        </span>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            {isOpen && (
                                <CardBody>
                                    {vm.chains.length === 0 && (
                                        <Content component={ContentVariants.p}>
                                            {t("No copies yet — run replication to create the first chain.")}
                                        </Content>
                                    )}
                                    {vm.chains.length > 0 && (
                                        <table className="vm-table">
                                            <thead>
                                                <tr>
                                                    <th>{t("Chain")}</th>
                                                    <th>{t("Kind")}</th>
                                                    <th>{t("Created")}</th>
                                                    <th>{t("Full copy")}</th>
                                                    <th>{t("Increments")}</th>
                                                    <th>{t("Increment data")}</th>
                                                    <th>{t("Total")}</th>
                                                    <th>{t("Last backup")}</th>
                                                    <th>domain.xml</th>
                                                    <th></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {vm.chains.map(c => (
                                                    <tr key={c.name}
                                                        className={c.name === vm.active_chain ? "active-chain" : ""}>
                                                        <td>
                                                            <strong>{c.name}</strong>
                                                            {c.name === vm.active_chain && (
                                                                <>&nbsp;<Label color="blue">{tc("chain", "active")}</Label></>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <Label color={c.kind === "cold" ? "orange" : "cyan"}>
                                                                {tc("kind", c.kind)}
                                                            </Label>
                                                        </td>
                                                        <td>{fmtDateTime(c.created)}</td>
                                                        <td>
                                                            {c.full_files.map(f => (
                                                                <div key={f.file} title={f.file}>
                                                                    {fmtBytes(f.size)}
                                                                </div>
                                                            ))}
                                                        </td>
                                                        <td>{c.inc_count}</td>
                                                        <td>{fmtBytes(c.inc_bytes)}</td>
                                                        <td><strong>{fmtBytes(c.total_bytes)}</strong></td>
                                                        <td title={c.last_backup ? fmtDateTime(c.last_backup) : ""}>
                                                            {c.last_backup ? timeAgo(c.last_backup) : "—"}
                                                        </td>
                                                        <td>{c.has_domain_xml ? t("yes") : "—"}</td>
                                                        <td>
                                                            <Flex gap={{ default: "gapSm" }}>
                                                                <FlexItem>
                                                                    <Button variant="link" size="sm"
                                                                        onClick={() => {
                                                                            goto(null, "restore");
                                                                            // preselect via hash param handled by Restore tab
                                                                            window.sessionStorage.setItem(
                                                                                "vm-replication.restore",
                                                                                JSON.stringify({ vm: vm.name, chain: c.name }));
                                                                        }}>
                                                                        {tc("verb", "Restore")}
                                                                    </Button>
                                                                </FlexItem>
                                                                <FlexItem>
                                                                    <Button variant="plain" size="sm" isDanger
                                                                        aria-label={t("Delete chain {name}", { name: c.name })}
                                                                        onClick={() => { setDeleteError(null); setDeleting({ vm: vm.name, chain: c.name, kind: c.kind }); }}>
                                                                        <TrashIcon />
                                                                    </Button>
                                                                </FlexItem>
                                                            </Flex>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </CardBody>
                            )}
                        </Card>
                    );
                })}
            </Flex>

            <Modal
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                variant="small"
            >
                <ModalHeader title={deleting ? t("Delete chain {name}?", { name: deleting.chain }) : ""} />
                <ModalBody>
                    {deleting && (
                        <>
                            {deleting.kind !== "cold" && deleting.chain === status.vms.find(v => v.name === deleting.vm)?.active_chain && (
                                <Alert variant="warning" isInline title={t("This is the active chain")}>
                                    {t("After deleting it the next replication run will make a new full copy, and stale checkpoints will be pruned.")}
                                </Alert>
                            )}
                            <Content component={ContentVariants.p}>
                                {t("All files of this chain (full copy, increments, metadata) will be permanently deleted from local storage. If a remote mirror is configured, it will be cleaned on the next successful run.")}
                            </Content>
                            {deleteError && <Alert variant="danger" isInline title={deleteError} />}
                            {working && <Spinner size="md" />}
                        </>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="danger" onClick={doDelete} isDisabled={working}>{t("Delete")}</Button>
                    <Button variant="link" onClick={() => setDeleting(null)} isDisabled={working}>{t("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
