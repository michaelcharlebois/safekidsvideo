import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Brightframe",
    short_name: "Brightframe",
    description: "Know exactly what's in it before your kid watches it.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#FFF9F1",
    theme_color: "#FFF9F1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
