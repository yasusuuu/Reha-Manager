import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png"
      ],

      manifest: {
        name: "REHA Manager",
        short_name: "REHA",
        description: "リハビリテーション科向け勤務・患者人数管理",

        theme_color: "#0f766e",
        background_color: "#ffffff",

        display: "standalone",
        orientation: "portrait",

        start_url: "/",
        scope: "/",

        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png"
          }
        ]
      }
    })
  ]
});