'use strict';

/**
 * Runs cloudflared quick tunnel → http://127.0.0.1:5173
 * Surfaces the public https://….trycloudflare.com URL (banner + tunnel-url.txt).
 *
 * Flags:
 *   --wait-for-vite   Poll until port 5173 is open, then start cloudflared (for `npm run dev:share`).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ORIGIN_PORT = 5173;
const ORIGIN_HOST = '127.0.0.1';
const WAIT_FOR_VITE = process.argv.includes('--wait-for-vite');

const root = path.join(__dirname, '..');
const urlFile = path.join(root, 'tunnel-url.txt');
const urlRe = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

function portIsOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForViteReady(maxMs = 120000) {
  process.stderr.write(
    `Waiting for Vite on http://${ORIGIN_HOST}:${ORIGIN_PORT} (start it with: npm run dev) …\n`,
  );
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await portIsOpen(ORIGIN_PORT, ORIGIN_HOST)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function startCloudflared() {
  const args = [
    '--yes',
    'cloudflared@latest',
    'tunnel',
    '--url',
    `http://${ORIGIN_HOST}:${ORIGIN_PORT}`,
  ];
  const child = spawn('npx', args, {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  let bannerPrinted = false;

  function maybeCaptureUrl(chunk) {
    if (bannerPrinted) return;
    const text = chunk.toString();
    const m = text.match(urlRe);
    if (!m) return;
    bannerPrinted = true;
    const url = m[0];
    try {
      fs.writeFileSync(urlFile, `${url}\n`, 'utf8');
    } catch (err) {
      process.stderr.write(`\nCould not write ${path.basename(urlFile)}: ${err.message}\n`);
    }
    const rule = '='.repeat(72);
    const msg =
      `\n${rule}\n` +
      `  Phone URL (HTTPS). Also saved next to package.json as: tunnel-url.txt\n` +
      `  ${url}\n` +
      `${rule}\n\n`;
    process.stderr.write(msg);
  }

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    maybeCaptureUrl(chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    maybeCaptureUrl(chunk);
  });

  child.on('error', (err) => {
    process.stderr.write(`\nFailed to start tunnel: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code === null ? 1 : code);
  });
}

async function main() {
  const origin = `http://${ORIGIN_HOST}:${ORIGIN_PORT}`;

  if (WAIT_FOR_VITE) {
    const up = await waitForViteReady();
    if (!up) {
      process.stderr.write(
        '\nTimed out waiting for Vite. Run `npm run dev` in this project (port 5173), then try again.\n',
      );
      process.exit(1);
    }
    process.stderr.write('Vite is reachable. Starting Cloudflare tunnel …\n\n');
  } else {
    process.stderr.write(`\nStarting Cloudflare quick tunnel → ${origin}\n`);
    const ok = await portIsOpen(ORIGIN_PORT, ORIGIN_HOST);
    if (!ok) {
      const bang = '!'.repeat(72);
      process.stderr.write(
        `\n${bang}\n` +
          `  WARNING: nothing is listening on ${origin}\n` +
        '  A **502 Bad Gateway** on your phone usually means either:\n' +
        '    • Vite is not running yet — run `npm run dev` first, then refresh the tunnel URL.\n' +
        '    • Vite was only on IPv6 (::1) — this repo uses vite.config.js so IPv4 127.0.0.1 works; restart `npm run dev`.\n' +
        '\n  Or use one command:  npm run dev:share\n' +
          `${bang}\n\n`,
      );
    } else {
      process.stderr.write(
        'Origin looks reachable. The public HTTPS URL will print below in a few seconds.\n\n',
      );
    }
  }

  startCloudflared();
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
