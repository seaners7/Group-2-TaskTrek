/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Add this headers function
  async headers() {
    return [
      {
        // Apply this header to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups', // This is the fix
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;