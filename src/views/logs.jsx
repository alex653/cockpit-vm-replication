import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Button, Card, CardBody, CardHeader, CardTitle, Flex, FlexItem, Spinner,
    Switch, TextInput,
} from "@patternfly/react-core";
import { errorMessage, helper } from "../api.js";
import { t, tn } from "../i18n.js";

const LINE_CHOICES = [200, 500, 1000, 3000];

export function Logs() {
    const [lines, setLines] = useState([]);
    const [count, setCount] = useState(500);
    const [auto, setAuto] = useState(true);
    const [filter, setFilter] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const preRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const r = await helper("logs", [String(count)]);
            setLines(r.lines || []);
            setError(null);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [count]);

    useEffect(() => {
        load();
        if (!auto) return;
        const iv = setInterval(load, 10000);
        return () => clearInterval(iv);
    }, [load, auto]);

    useEffect(() => {
        if (preRef.current)
            preRef.current.scrollTop = preRef.current.scrollHeight;
    }, [lines, filter]);

    const shown = filter
        ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
        : lines;

    return (
        <Card>
            <CardHeader actions={{
                actions: (
                    <Flex gap={{ default: "gapSm" }}>
                        <FlexItem>
                            <Switch id="auto-refresh" label={t("Auto-refresh")}
                                isChecked={auto} onChange={(_e, v) => setAuto(v)} />
                        </FlexItem>
                        <FlexItem>
                            <select
                                className="pf-v6-c-form-control"
                                value={count}
                                onChange={e => setCount(Number(e.target.value))}
                                aria-label={t("Number of lines")}
                            >
                                {LINE_CHOICES.map(n => (
                                    <option key={n} value={n}>{tn(n, "{n} line", "{n} lines", { n })}</option>
                                ))}
                            </select>
                        </FlexItem>
                        <FlexItem>
                            <Button variant="secondary" onClick={load}>{t("Refresh")}</Button>
                        </FlexItem>
                    </Flex>
                ),
            }}>
                <CardTitle>{t("vm-replication journal")}</CardTitle>
            </CardHeader>
            <CardBody>
                <TextInput
                    id="log-filter"
                    placeholder={t("Filter…")}
                    value={filter}
                    onChange={(_e, v) => setFilter(v)}
                    style={{ marginBottom: "0.75rem", maxWidth: "24rem" }}
                />
                {error && <div className="pf-v6-u-text-color-danger">{error}</div>}
                {loading && <Spinner size="md" />}
                <pre ref={preRef} className="log-tail" style={{ maxHeight: "32rem" }}>
                    {shown.length
                        ? shown.map((l, i) => (
                            <span key={i}
                                className={/ОШИБКА|error|failed|не удал/i.test(l) ? "log-error" : ""}>
                                {l}
                                {"\n"}
                            </span>
                        ))
                        : !loading && t("— no entries —")}
                </pre>
            </CardBody>
        </Card>
    );
}
