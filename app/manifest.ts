import type { MetadataRoute } from "next";

// Web app manifest (Next auto-serves at /manifest.webmanifest and links it).
// Makes the dialer installable to a phone home screen for an app-like, full-
// screen "lead copilot" experience.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mayday AI Dialer",
    short_name: "Mayday AI",
    description: "Cold-call CRM + browser dialer",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait-primary",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
