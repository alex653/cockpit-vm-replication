import React, { useEffect, useRef, useState } from "react";
import {
    Alert, Button, Card, CardBody, CardFooter, CardHeader, CardTitle, Content,
    ContentVariants, Form, FormGroup, Grid, GridItem, Modal, ModalBody,
    ModalFooter, ModalHeader, Spinner, TextInput,
} from "@patternfly/react-core";
import { errorMessage, fmtBytes, fmtDateTime, helper } from "../api.js";
import { useStatus } from "../app.jsx";

const defaultTarget = vm => `/var/lib/libvirt/images/${vm}-restored.qcow2`;

export function Restore() {
    const { status, setActionError } = useStatus();
    const [vm, setVm] = useState(null);
    const [chain, setChain] = useState(null);
    const [target, setTarget] = useState("");
    const [confirming, setConfirming] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState(null);
    const [log, setLog] = useState([]);
    const [done, setDone] = useState(false);
    const preRef = useRef(null);
    const pollRef = useRef(null);

    const vmObj = status?.vms.find(v => v.name === vm);
    const chainObj = vmObj?.chains.find(c => c.name === chain);

    /* pick first sensible vm/chain, or preselect from the Chains tab */
    useEffect(() => {
        if (!status) return;
        const stored = window.sessionStorage.getItem("vm-replication.restore");
        if (stored) {
            window.sessionStorage.removeItem("vm-replication.restore");
            try {
                const { vm: svm, chain: sch } = JSON.parse(stored);
                if (status.vms.some(v => v.name === svm)) {
                    setVm(svm);
                    setChain(sch);
                    setTarget(defaultTarget(svm));
                    return;
                }
            } catch { /* ignore */ }
        }
        if (!vm) {
            const first = status.vms.find(v => v.chains.some(c => c.kind !== "cold"));
            if (first) {
                setVm(first.name);
                setChain(first.chains.find(c => c.kind !== "cold").name);
                setTarget(defaultTarget(first.name));
            }
        }
    }, [status, vm]);

    useEffect(() => {
        if (confirming) return;
        pollRef.current = setInterval(async () => {
            try {
                const st = await helper("restore-status");
                setLog(st.log_tail || []);
                if (!st.running && st.log_tail?.length && !working) setDone(true);
            } catch { /* helper busy errors are fine here */ }
        }, 3000);
        return () => clearInterval(pollRef.current);
    }, [confirming, working]);

    useEffect(() => {
        if (preRef.current)
            preRef.current.scrollTop = preRef.current.scrollHeight;
    }, [log]);

    if (!status)
        return <Spinner size="lg" />;

    const restorable = status.vms.filter(v => v.chains.length > 0);

    const start = async () => {
        setConfirming(false);
        setWorking(true);
        setError(null);
        setDone(false);
        try {
            await helper("restore-start", [vm, chain, target.trim()]);
            setLog([]);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setWorking(false);
        }
    };

    return (
        <Grid hasGutter>
            <GridItem span={12} lg={{ span: 7 }}>
                <Card>
                    <CardHeader>
                        <CardTitle>Restore a chain into one qcow2 image</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <Content component={ContentVariants.p}>
                            Runs <code>vm-restore &lt;chain&gt; &lt;target&gt;</code>: rebases the
                            increments onto the full copy and flattens the result into a single
                            image. The chain files themselves are not modified. Typical next
                            steps afterwards: <code>virsh define domain.xml</code> (adjust the
                            disk path) or import the image into another host.
                        </Content>
                        <Form style={{ marginTop: "1rem" }}>
                            <FormGroup label="Virtual machine" fieldId="rvm">
                                <select
                                    id="rvm"
                                    className="pf-v6-c-form-control"
                                    value={vm || ""}
                                    onChange={e => {
                                        const name = e.target.value;
                                        setVm(name);
                                        const v = status.vms.find(x => x.name === name);
                                        const c = v?.chains.find(x => x.kind !== "cold") || v?.chains[0];
                                        setChain(c?.name || "");
                                        setTarget(defaultTarget(name));
                                        setDone(false);
                                    }}
                                >
                                    {restorable.map(v => (
                                        <option key={v.name} value={v.name}>{v.name}</option>
                                    ))}
                                </select>
                            </FormGroup>
                            <FormGroup label="Chain" fieldId="rchain">
                                <select
                                    id="rchain"
                                    className="pf-v6-c-form-control"
                                    value={chain || ""}
                                    onChange={e => { setChain(e.target.value); setDone(false); }}
                                >
                                    {(vmObj?.chains || []).map(c => (
                                        <option key={c.name} value={c.name}>
                                            {c.name} ({c.kind}, {c.inc_count} incr., {fmtBytes(c.total_bytes)})
                                        </option>
                                    ))}
                                </select>
                            </FormGroup>
                            {chainObj && (
                                <Content component={ContentVariants.small}>
                                    Created {fmtDateTime(chainObj.created)} · last backup{" "}
                                    {fmtDateTime(chainObj.last_backup)} · needs about{" "}
                                    <strong>{fmtBytes(chainObj.full_bytes)}</strong> of target space
                                </Content>
                            )}
                            <FormGroup label="Target image path" fieldId="rtarget"
                                helperText="Must not exist yet; the directory has to exist.">
                                <TextInput id="rtarget" value={target}
                                    onChange={(_e, v) => setTarget(v)} />
                            </FormGroup>
                        </Form>
                        {error && <Alert variant="danger" isInline title={error} />}
                        {done && (
                            <Alert variant="success" isInline title="Restore finished">
                                Check the log below, then define the VM or attach the image.
                            </Alert>
                        )}
                    </CardBody>
                    <CardFooter>
                        <Button
                            variant="primary"
                            isDisabled={!vm || !chain || !target.trim() || working || status.restore.running}
                            onClick={() => { setError(null); setConfirming(true); }}
                        >
                            Restore…
                        </Button>
                        {status.restore.running && (
                            <span style={{ marginLeft: "1rem" }}>
                                <Spinner size="md" /> restore is running
                            </span>
                        )}
                    </CardFooter>
                </Card>
            </GridItem>
            <GridItem span={12} lg={{ span: 5 }}>
                <Card>
                    <CardHeader>
                        <CardTitle>Restore on the remote host</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <Content component={ContentVariants.p}>
                            Chains are mirrored to the remote target as-is (full + increments +
                            <code> domain.xml</code> + a copy of <code>vm-restore</code>), so a
                            disaster recovery usually happens there:
                        </Content>
                        <pre className="log-tail">{`# on the remote host
./vm-restore <chain-dir> /var/lib/libvirt/images/${vm || "vm"}.qcow2
virsh define <chain-dir>/domain.xml
# adjust the disk path if needed, then:
virsh start ${vm || "vm"}`}</pre>
                    </CardBody>
                </Card>
                <Card style={{ marginTop: "1rem" }}>
                    <CardHeader>
                        <CardTitle>Restore log</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <pre ref={preRef} className="log-tail" style={{ maxHeight: "18rem" }}>
                            {log.length ? log.join("\n") : "— no restore jobs yet —"}
                        </pre>
                    </CardBody>
                </Card>
            </GridItem>

            <Modal
                isOpen={confirming}
                onClose={() => setConfirming(false)}
                variant="small"
            >
                <ModalHeader title="Start restore?" />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        {chainObj
                            ? `Flatten "${chain}" of ${vm} (${fmtBytes(chainObj.total_bytes)} stored, about ${fmtBytes(chainObj.full_bytes)} result) into:`
                            : "Flatten chain into:"}
                        <br />
                        <code>{target}</code>
                    </Content>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" onClick={start}>Restore</Button>
                    <Button variant="link" onClick={() => setConfirming(false)}>Cancel</Button>
                </ModalFooter>
            </Modal>
        </Grid>
    );
}
