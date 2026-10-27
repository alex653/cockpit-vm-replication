import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import "@patternfly/react-core/dist/styles/base.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
