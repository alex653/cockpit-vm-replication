import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { initI18n } from "./i18n.js";
import "@patternfly/react-core/dist/styles/base.css";
import "./styles.css";

/* po.js (loaded by index.html before this module) has already called
 * cockpit.locale() with the Cockpit session's language. */
initI18n();

createRoot(document.getElementById("root")).render(<App />);
