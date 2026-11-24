const upstream = process.env.RENDER_API_ORIGIN?.trim();
let parsed;
try {
  parsed = new URL(upstream);
} catch {
  throw new Error('Set RENDER_API_ORIGIN to the Render service HTTPS origin.');
}
if (parsed.protocol !== 'https:' || parsed.origin !== upstream) {
  throw new Error('RENDER_API_ORIGIN must be an HTTPS origin without credentials or a path.');
}

export const config = {
  framework: 'vite',
  installCommand: 'cd ../.. && MONGOMS_DISABLE_POSTINSTALL=1 npm ci --include=dev',
  buildCommand: 'cd ../.. && npm run build -w @renuka/shared && npm run build -w @renuka/admin',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: upstream + '/api/:path*' },
    { source: '/((?!api(?:/|$)|assets(?:/|$)).*)', destination: '/index.html' },
  ],
  headers: [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy',
          value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
        },
      ],
    },
    {
      source: '/api/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
      ],
    },
  ],
};
