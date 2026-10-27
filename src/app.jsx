import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
    Alert, AlertGroup, Button, Masthead, MastheadBrand, MastheadContent,
    MastheadMain, MastheadToggle, Nav, NavItem, NavList, Page, PageSection,
    PageSidebar, PageSidebarBody, SkipToContent, Spinner, Toolbar,
    ToolbarContent, ToolbarItem,
} from "@patternfly/react-core";
import { BarsIcon } from "@patternfly/react-icons";
import { errorMessage, helper } from "./api.js";
import { Overview } from "./views/overview.jsx";
import { Chains } from "./views/chains.jsx";
import { ConfigView } from "./views/config.jsx";
import { Restore } from "./views/restore.jsx";
import { Logs } from "./views/logs.jsx";

export const StatusContext = createContext({ status: null, refresh: () => {} });

export function useStatus() {
    return useContext(StatusContext);
}

const TABS = [
    { id: "overview", title: "Overview" },
    { id: "chains", title: "VMs & Chains" },
    { id: "config", title: "Configuration" },
    { id: "restore", title: "Restore" },
    { id: "logs", title: "Journal" },
];

export function App() {
    const [status, setStatus] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [tab, setTab] = useState(() => {
        const h = window.location.hash.replace(/^#\/?/, "");
        return TABS.some(t => t.id === h) ? h : "overview";
    });
    const [sidebarOpen, setSidebarOpen] = useState(true);
    /* when embedded in the Cockpit shell it provides header and navigation */
    const standalone = window.parent === window;

    const refresh = useCallback(async () => {
        try {
            const s = await helper("status");
            setStatus(s);
            setLoadError(null);
        } catch (e) {
            setLoadError(errorMessage(e));
        }
    }, []);

    const busy = !!(status && (status.busy || status.restore.running));

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const ms = busy ? 2000 : 5000;
        const t = setInterval(refresh, ms);
        return () => clearInterval(t);
    }, [busy, refresh]);

    useEffect(() => {
        const onHash = () => {
            const h = window.location.hash.replace(/^#\/?/, "");
            if (TABS.some(t => t.id === h)) setTab(h);
        };
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);

    const switchTab = (_e, id) => {
        setTab(id);
        window.location.hash = `#/${id}`;
    };

    const ctx = {
        status,
        refresh,
        setActionError,
        goto: switchTab,
    };

    const views = {
        overview: <Overview />,
        chains: <Chains />,
        config: <ConfigView />,
        restore: <Restore />,
        logs: <Logs />,
    };

    return (
        <StatusContext.Provider value={ctx}>
            <Page
                masthead={standalone ? (
                    <Masthead>
                        <MastheadMain>
                            <MastheadToggle>
                                <Button
                                    variant="plain"
                                    onClick={() => setSidebarOpen(!sidebarOpen)}
                                    aria-label="Toggle navigation"
                                >
                                    <BarsIcon />
                                </Button>
                            </MastheadToggle>
                            <MastheadBrand component="a" href="#/overview">
                                VM Replication
                            </MastheadBrand>
                        </MastheadMain>
                        <MastheadContent>
                            <Toolbar id="toolbar">
                                <ToolbarContent>
                                    <ToolbarItem>
                                        {status
                                            ? <span className="pf-v6-u-color-200">{status.hostname}</span>
                                            : <Spinner size="md" />}
                                    </ToolbarItem>
                                </ToolbarContent>
                            </Toolbar>
                        </MastheadContent>
                    </Masthead>
                ) : undefined}
                sidebar={standalone ? (
                    <PageSidebar>
                        <PageSidebarBody>
                            <Nav aria-label="Sections">
                                <NavList>
                                    {TABS.map(t => (
                                        <NavItem
                                            key={t.id}
                                            isActive={tab === t.id}
                                            onClick={e => { e.preventDefault(); switchTab(e, t.id); }}
                                            href={`#/${t.id}`}
                                        >
                                            {t.title}
                                        </NavItem>
                                    ))}
                                </NavList>
                            </Nav>
                        </PageSidebarBody>
                    </PageSidebar>
                ) : undefined}
                isManagedSidebar
                skipToContent={<SkipToContent>Skip to content</SkipToContent>}
            >
                <AlertGroup isToast isLiveRegion>
                    {loadError && (
                        <Alert
                            variant="danger"
                            title="Cannot talk to the replication helper"
                            actionClose
                            onTimeout={() => setLoadError(null)}
                        >
                            {loadError}
                            <br />
                            Make sure the helper is installed: <code>sudo make install</code>, and
                            that your user may run it via sudo (see the README).
                        </Alert>
                    )}
                    {actionError && (
                        <Alert
                            variant="danger"
                            title="Operation failed"
                            actionClose
                            onTimeout={() => setActionError(null)}
                        >
                            {actionError}
                        </Alert>
                    )}
                </AlertGroup>
                {status && !status.scripts["vm-replicate"] && (
                    <PageSection>
                        <Alert variant="warning" title="Replication scripts are not installed">
                            <code>vm-replicate</code> / <code>vm-restore</code> were not found.
                            Install them with <code>sudo make install</code> from this project.
                        </Alert>
                    </PageSection>
                )}
                <PageSection hasOverflowScroll isFilled>
                    {views[tab]}
                </PageSection>
            </Page>
        </StatusContext.Provider>
    );
}
