/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Signed-in pages must not be served from the browser cache after logout (test T1.7).
    const noStore = [{ key: "Cache-Control", value: "no-store, max-age=0" }];
    return ["/dashboard", "/profile", "/travellers/:path*", "/admin/:path*", "/pools/new"].map((source) => ({
      source,
      headers: noStore,
    }));
  },
};
export default nextConfig;
