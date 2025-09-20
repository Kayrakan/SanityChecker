#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_RETRIES = Number.parseInt(process.env.PRISMA_MIGRATE_RETRIES ?? '3', 10);
const BASE_DELAY_MS = Number.parseInt(process.env.PRISMA_MIGRATE_RETRY_DELAY_MS ?? '2000', 10);

async function main() {
  await runCommand('npx', ['prisma', 'generate']);
  await retry(async (attempt) => {
    await runCommand('npx', ['prisma', 'migrate', 'deploy']);
  }, DEFAULT_RETRIES, BASE_DELAY_MS);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function retry(fn, retries, delayMs) {
  let attempt = 0;
  while (true) {
    try {
      attempt += 1;
      await fn(attempt);
      return;
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      const wait = delayMs * attempt;
      console.warn(`Prisma migrate failed (attempt ${attempt}/${retries}). Retrying in ${Math.round(wait / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
