/* dev.html entry: no host page, so the bridge is the fake one and the window starts open for
 * screenshots and manual review (pnpm dev → http://localhost:18090/dev.html). */
import './app.css';
import './i18n';
import { mountSettingsUi } from './mount';

mountSettingsUi();
