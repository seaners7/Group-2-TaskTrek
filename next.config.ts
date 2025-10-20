import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ✅ Keep it simple, no serverActions
  async redirects() {
    return [
      {
        source: '/',
        destination: '/FrontEnd/index.html', // redirect root to index.html
        permanent: false, // 302 redirect
      },
    ];
  },
};

export default nextConfig;
