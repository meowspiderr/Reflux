import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/sora";
import { App } from "./App";
import { isNative } from "./lib/backend";
import "./styles.css";

if (isNative) {
  document.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  });
  window.addEventListener("keydown", (event) => {
    const reload =
      event.key === "F5" ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
    if (reload) event.preventDefault();
  });
}

const container = document.getElementById("root");
if (!container) throw new Error("Root container is missing");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
