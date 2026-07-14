import { useEffect, useMemo, useState } from "react";

const DISMISS_KEY = "rehaManagerPwaInstallDismissed";

function isStandaloneMode() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");

  const ios = useMemo(() => isIos(), []);

  useEffect(() => {
    if (dismissed || isStandaloneMode()) return;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
      setVisible(true);
    };

    const handleInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
      localStorage.setItem(DISMISS_KEY, "1");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if (ios) {
      const timer = window.setTimeout(() => setVisible(true), 1200);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.removeEventListener("appinstalled", handleInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [dismissed, ios]);

  const close = () => {
    setVisible(false);
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  const install = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  };

  if (!visible || isStandaloneMode()) return null;

  return (
    <div style={styles.backdrop} aria-live="polite">
      <div style={styles.card}>
        <div style={styles.textBox}>
          <strong style={styles.title}>REHA Managerをホーム画面に追加</strong>
          <span style={styles.text}>
            {ios
              ? "iPhoneはSafariの共有ボタンから「ホーム画面に追加」を選択してください。"
              : "アプリとしてインストールして、ホーム画面から起動できます。"}
          </span>
        </div>

        <div style={styles.actions}>
          {!ios && installEvent && (
            <button type="button" style={styles.primaryButton} onClick={install}>
              インストール
            </button>
          )}
          <button type="button" style={styles.closeButton} onClick={close}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "max(10px, env(safe-area-inset-bottom))",
    zIndex: 2147483000,
    display: "flex",
    justifyContent: "center",
    padding: "0 10px",
    pointerEvents: "none",
  },
  card: {
    width: "min(560px, 100%)",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    border: "1px solid #99f6e4",
    borderRadius: 16,
    background: "#ffffff",
    boxShadow: "0 16px 44px rgba(15, 23, 42, 0.22)",
    padding: "12px",
    pointerEvents: "auto",
    color: "#0f172a",
  },
  textBox: {
    display: "grid",
    gap: 3,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 950,
    color: "#0f766e",
  },
  text: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "#475569",
  },
  actions: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  primaryButton: {
    border: 0,
    borderRadius: 10,
    background: "#0f766e",
    color: "#ffffff",
    padding: "9px 12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  closeButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#f8fafc",
    color: "#334155",
    padding: "9px 10px",
    fontWeight: 900,
    cursor: "pointer",
  },
};
