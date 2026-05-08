#!/usr/bin/env node
// MindAR doesn't ship a Node-side compiler. The official path is the browser
// tool at https://hiukim.github.io/mind-ar-js-doc/tools/compile — drop the
// reference PNG/JPEG in, download the .mind file, drop it next to targets.mind.
//
// This script just lists candidate inputs and prints the steps so the demo
// pipeline has a single command to run.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = path.join(ROOT, 'Assets');

function isCandidate(name) {
  if (name.endsWith('.auto.png')) return false;
  return /\.(png|jpe?g)$/i.test(name);
}

async function main() {
  let entries = [];
  try {
    entries = (await fs.readdir(ASSETS_DIR)).filter(isCandidate);
  } catch {
    /* missing dir */
  }

  console.log('MindAR target compilation');
  console.log('-------------------------');
  console.log('Open https://hiukim.github.io/mind-ar-js-doc/tools/compile');
  console.log('');
  console.log('1. Click "Upload" and select the reference photo(s):');

  if (entries.length === 0) {
    console.log('     (no candidate images in Assets/ — drop your PNG/JPEG there)');
  } else {
    for (const e of entries) {
      console.log(`     • ${path.join('Assets', e)}`);
    }
  }

  console.log('');
  console.log('2. Wait for the compile to finish.');
  console.log('3. Click "Download" — you get a single targets.mind file.');
  console.log('4. Move it to ./targets.mind (overwrite the existing file).');
  console.log('   The Empire State target stays at index 0; new images get');
  console.log('   the next sequential targetIndex (1, 2, …) in upload order.');
  console.log('');
  console.log('Then update the targetIndex in script.js or index.html for the new entity.');
}

main();
