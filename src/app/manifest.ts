import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sift",
    short_name: "Sift",
    description: "Know exactly what's in it before your kid watches it.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f3ec",
    theme_color: "#f5f3ec",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
