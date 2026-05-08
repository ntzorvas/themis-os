// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Αυστηρή λειτουργία React
  reactStrictMode: true,

  // Ρύθμιση εικόνων — μόνο εγκεκριμένοι hosts
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
        pathname: '/themisos-documents/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  // HTTP Security Headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              // unsafe-eval/inline μόνο development — αφαιρούνται σε production μέσω middleware
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.r2.dev",
              "font-src 'self'",
              "connect-src 'self' https://api.anthropic.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

  // Rewrites για API proxy στο Fastify (development)
  async rewrites() {
    const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4100';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },

  // Μεταβλητές περιβάλλοντος που εκτίθενται στο client
  env: {
    PRODUCT_NAME: process.env['PRODUCT_NAME'] ?? 'ΘΕΜΙΣ OS',
    PRODUCT_SLUG: process.env['PRODUCT_SLUG'] ?? 'themisos',
    PRODUCT_DOMAIN: process.env['PRODUCT_DOMAIN'] ?? 'themisos.gr',
  },
};

export default nextConfig;
