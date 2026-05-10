'use strict';

const { defineConfig } = require('vite');

/**
 * Cloudflare quick tunnel uses http://127.0.0.1:5173 (IPv4).
 * Vite’s default `localhost` can bind only to ::1 on some systems, so the tunnel
 * never reaches the dev server. Listening on all interfaces fixes that.
 *
 * Quick tunnels use a random *.trycloudflare.com Host header; Vite 6+ blocks that
 * unless the suffix is allowed here.
 */
module.exports = defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
  },
});
