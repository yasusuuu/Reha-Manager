import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.jsx";
import PwaInstallPrompt from "./PwaInstallPrompt.jsx";
import { configurePwaUpdate, markPwaRefreshNeeded } from "./pwaUpdate.js";

// PWA更新通知
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markPwaRefreshNeeded();
  },
  onOfflineReady() {
    console.log("REHA Manager はオフラインでも起動できます。");
  },
  onRegisteredSW(_swUrl, registration) {
    // 起動時と1時間ごとに更新を確認する。
    registration?.update();
    window.setInterval(() => registration?.update(), 60 * 60 * 1000);
  },
  onRegisterError(error) {
    console.error("Service Worker registration failed", error);
  },
});

configurePwaUpdate(updateSW);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
    <PwaInstallPrompt />
  </StrictMode>
);
