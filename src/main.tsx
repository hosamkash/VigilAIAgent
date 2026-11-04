import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { useThemeStore } from "./store/themeStore";

useThemeStore.getState().initTheme();

// StrictMode disabled: it double-mounts effects and can spawn two Touch ID prompts.
createRoot(document.getElementById("root")!).render(<App />);
