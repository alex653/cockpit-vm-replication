import React, { useEffect, useState } from "react";
import {
    Alert, Button, Card, CardBody, CardFooter, CardHeader, CardTitle,
    Checkbox, Content, ContentVariants, Flex, FlexItem, Form, FormGroup,
    Grid, GridItem, HelperText, HelperTextItem, Spinner, Switch,
    TextInput, NumberInput as PFNumberInput,
} from "@patternfly/react-core";
import { errorMessage, helper } from "../api.js";
import { useStatus } from "../app.jsx";

function toInt(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
}

export function ConfigView() {
    const { status, refresh } = useStatus();
    const [form, setForm] = useState(null);
    const [manualVm, setManualVm] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (status && !form) {
            const c = status.config;
            setForm({
                VMS: (c.VMS || "").split(/\s+/).filter(Boolean),
                REMOTE_TARGET: c.REMOTE_TARGET || "",
                REMOTE_SSH_OPTS: c.REMOTE_SSH_OPTS || "",
                STORAGE_ROOT: c.STORAGE_ROOT || "/mnt/dd/replication",
                FULL_EVERY_DAYS: toInt(c.FULL_EVERY_DAYS || 7),
                MAX_INCS: toInt(c.MAX_INCS || 48),
                KEEP_CHAINS: toInt(c.KEEP_CHAINS || 2),
                BACKUP_TIMEOUT: toInt(c.BACKUP_TIMEOUT || 14400),
                QEMU_IMG_CHECK: String(c.QEMU_IMG_CHECK ?? "1") !== "0",
                LIBVIRT_URI: c.LIBVIRT_URI || "qemu:///system",
            });
        }
    }, [status, form]);

    if (!status || !form)
        return <Spinner size="lg" />;

    const set = patch => { setForm(f => ({ ...f, ...patch })); setSaved(false); };

    const addVm = name => {
        const n = name.trim();
        if (!n || form.VMS.includes(n)) return;
        set({ VMS: [...form.VMS, n] });
        setManualVm("");
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await helper("config-set", [], JSON.stringify({
                VMS: form.VMS,
                REMOTE_TARGET: form.REMOTE_TARGET.trim(),
                REMOTE_SSH_OPTS: form.REMOTE_SSH_OPTS,
                STORAGE_ROOT: form.STORAGE_ROOT.trim(),
                FULL_EVERY_DAYS: form.FULL_EVERY_DAYS,
                MAX_INCS: form.MAX_INCS,
                KEEP_CHAINS: form.KEEP_CHAINS,
                BACKUP_TIMEOUT: form.BACKUP_TIMEOUT,
                QEMU_IMG_CHECK: form.QEMU_IMG_CHECK ? 1 : 0,
                LIBVIRT_URI: form.LIBVIRT_URI.trim(),
            }));
            setSaved(true);
            await refresh();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    const knownVms = [...new Set([...status.all_vms, ...form.VMS])].sort();

    return (
        <Grid hasGutter>
            <GridItem span={12} lg={{ span: 8 }}>
                <Card>
                    <CardHeader>
                        <CardTitle>Replication configuration</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <Content component={ContentVariants.p}>
                            Edits <code>/etc/vm-replication/vms.conf</code>. Comments and unknown
                            keys in the file are preserved. Changes apply from the next run on.
                        </Content>
                        <Form style={{ marginTop: "1rem" }}>
                            <FormGroup label="Replicated VMs" fieldId="vms"
                                helperText="Select from the VMs known to libvirt or type a name and press Add.">
                                <Flex direction={{ default: "column" }} gap={{ default: "gapSm" }}>
                                    <Flex wrap="wrap" gap={{ default: "gapSm" }}>
                                        {knownVms.map(vm => (
                                            <FlexItem key={vm}>
                                                <Checkbox
                                                    id={`vm-${vm}`}
                                                    label={vm}
                                                    isChecked={form.VMS.includes(vm)}
                                                    onChange={(_e, checked) => set({
                                                        VMS: checked
                                                            ? [...form.VMS, vm]
                                                            : form.VMS.filter(v => v !== vm),
                                                    })}
                                                />
                                            </FlexItem>
                                        ))}
                                    </Flex>
                                    <Flex gap={{ default: "gapSm" }}>
                                        <FlexItem>
                                            <TextInput
                                                id="add-vm"
                                                placeholder="Add VM by name…"
                                                value={manualVm}
                                                onChange={(_e, v) => setManualVm(v)}
                                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addVm(manualVm); } }}
                                            />
                                        </FlexItem>
                                        <FlexItem>
                                            <Button variant="secondary" onClick={() => addVm(manualVm)}>
                                                Add
                                            </Button>
                                        </FlexItem>
                                    </Flex>
                                </Flex>
                            </FormGroup>

                            <FormGroup label="Remote target" fieldId="remote"
                                helperText='Mirror copies over rsync/ssh, e.g. "backup@nas:/srv/vm-replication". Empty = keep local copies only.'>
                                <TextInput id="remote" value={form.REMOTE_TARGET}
                                    placeholder="user@remote-host:/srv/vm-replication"
                                    onChange={(_e, v) => set({ REMOTE_TARGET: v })} />
                            </FormGroup>

                            <FormGroup label="SSH options" fieldId="sshopts"
                                helperText='Extra options for ssh, e.g. "-p 2222 -i /root/key".'>
                                <TextInput id="sshopts" value={form.REMOTE_SSH_OPTS}
                                    onChange={(_e, v) => set({ REMOTE_SSH_OPTS: v })} />
                            </FormGroup>

                            <FormGroup label="Local storage root" fieldId="storage"
                                helperText="Directory for chains. Changing it does not move existing data — copy or clean up manually.">
                                <TextInput id="storage" value={form.STORAGE_ROOT}
                                    onChange={(_e, v) => set({ STORAGE_ROOT: v })} />
                            </FormGroup>

                            <Grid hasGutter md={3}>
                                <GridItem>
                                    <FormGroup label="Full copy every, days" fieldId="fulldays">
                                        <TextInput id="fulldays" type="number" min="1"
                                            value={form.FULL_EVERY_DAYS}
                                            onChange={(_e, v) => set({ FULL_EVERY_DAYS: toInt(v) })} />
                                    </FormGroup>
                                </GridItem>
                                <GridItem>
                                    <FormGroup label="Max increments per chain" fieldId="maxincs">
                                        <TextInput id="maxincs" type="number" min="1"
                                            value={form.MAX_INCS}
                                            onChange={(_e, v) => set({ MAX_INCS: toInt(v) })} />
                                    </FormGroup>
                                </GridItem>
                                <GridItem>
                                    <FormGroup label="Chains to keep" fieldId="keepchains">
                                        <TextInput id="keepchains" type="number" min="1"
                                            value={form.KEEP_CHAINS}
                                            onChange={(_e, v) => set({ KEEP_CHAINS: toInt(v) })} />
                                    </FormGroup>
                                </GridItem>
                                <GridItem>
                                    <FormGroup label="Backup timeout, seconds" fieldId="timeout">
                                        <TextInput id="timeout" type="number" min="60"
                                            value={form.BACKUP_TIMEOUT}
                                            onChange={(_e, v) => set({ BACKUP_TIMEOUT: toInt(v) })} />
                                    </FormGroup>
                                </GridItem>
                                <GridItem>
                                    <FormGroup label="libvirt URI" fieldId="uri">
                                        <TextInput id="uri" value={form.LIBVIRT_URI}
                                            onChange={(_e, v) => set({ LIBVIRT_URI: v })} />
                                    </FormGroup>
                                </GridItem>
                                <GridItem>
                                    <FormGroup label="Integrity check" fieldId="qcheck">
                                        <Switch id="qcheck"
                                            label="qemu-img check before sending"
                                            labelOff="Skip qemu-img check"
                                            isChecked={form.QEMU_IMG_CHECK}
                                            onChange={(_e, v) => set({ QEMU_IMG_CHECK: v })} />
                                    </FormGroup>
                                </GridItem>
                            </Grid>

                            <HelperText>
                                <HelperTextItem>
                                    A chain is rotated to a full copy when it is older than
                                    {" "}{form.FULL_EVERY_DAYS} days or has {form.MAX_INCS} increments;
                                    the {form.KEEP_CHAINS} newest chains are kept.
                                </HelperTextItem>
                            </HelperText>
                        </Form>
                    </CardBody>
                    <CardFooter>
                        <Flex gap={{ default: "gapSm" }} alignItems={{ default: "alignItemsCenter" }}>
                            <FlexItem>
                                <Button variant="primary" onClick={save} isDisabled={saving}>
                                    {saving ? "Saving…" : "Save configuration"}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                {saved && <Alert variant="success" isInline isPlain title="Saved" />}
                                {error && <Alert variant="danger" isInline isPlain title={error} />}
                            </FlexItem>
                        </Flex>
                    </CardFooter>
                </Card>
            </GridItem>
        </Grid>
    );
}
