/* Mounts the settings window. Injected into Folia's own page it mounts into a container it creates
 * (the page's DOM belongs to the visualizer), while `dev.html` mounts into the page's #root. */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { bridgeIsInjected } from './bridge';

let root: Root | null = null;

const resolveContainer = (injected: boolean): HTMLElement => {
    const existing = document.getElementById('spw-settings-ui-root');
    if (existing) return existing;
    const container = injected ? document.createElement('div') : (document.getElementById('root') ?? document.createElement('div'));
    if (injected) {
        container.id = 'spw-settings-ui-root';
        container.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
        document.body.appendChild(container);
    }
    return container;
};

export const mountSettingsUi = (): void => {
    if (root) return;
    const injected = bridgeIsInjected();
    root = createRoot(resolveContainer(injected), {
        // Keep crashes visible in the host log with a component stack: the injected page has no
        // dev-time overlay and the host's `js:` line only carries the JavaScript stack.
        onUncaughtError: (error: unknown, errorInfo: { componentStack?: string }) => {
            console.error(`[spw-folia] uncaught: ${String(error)}\n${errorInfo.componentStack ?? ''}`);
        },
        onCaughtError: (error: unknown, errorInfo: { componentStack?: string }) => {
            console.error(`[spw-folia] caught: ${String(error)}\n${errorInfo.componentStack ?? ''}`);
        },
    });
    root.render(<App injected={injected} />);
    (window as Window & { __SPW_FOLIA_SETTINGS_UI_READY__?: boolean }).__SPW_FOLIA_SETTINGS_UI_READY__ = true;
};

export const unmountSettingsUi = (): void => {
    root?.unmount();
    root = null;
};
