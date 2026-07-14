import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.jsx";
import PwaInstallPrompt from "./PwaInstallPrompt.jsx";

// PWA更新通知
registerSW({
  onNeedRefresh() {
    if (window.confirm("新しいバージョンがあります。\n更新しますか？")) {
      window.location.reload();
    }
  },
  onOfflineReady() {
    console.log("REHA Manager はオフラインでも起動できます。");
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
    <PwaInstallPrompt />
  </StrictMode>
);
