/* Injected entry: the host loads this module (settings-ui.js from the mapped virtual host) after
 * Shim.js on Folia's own OBS page; it mounts the settings window hidden until the host opens it. */
import './app.css';
import './i18n';
import { mountSettingsUi } from './mount';

mountSettingsUi();
