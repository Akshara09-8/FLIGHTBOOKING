import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This folder is the app root (another package-lock.json higher up confuses Next).
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // E-ticket uploads (up to 2 MB) go through a server action.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    // Signed-in pages must not be served from the browser cache after logout (test T1.7).
    const noStore = [{ key: "Cache-Control", value: "no-store, max-age=0" }];
    return ["/dashboard", "/profile", "/travellers/:path*", "/admin/:path*", "/pools/new", "/payments/:path*", "/pay/:path*"].map((source) => ({
      source,
      headers: noStore,
    }));
  },
};
export default nextConfig;
