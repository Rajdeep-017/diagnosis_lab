import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.resolve(frontendDir, '..', 'docker-compose.yml');
const project = `isocode-real-e2e-${process.pid}`;
const composePrefix = ['compose', '-f', composeFile, '-p', project, '--profile', 'e2e'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function waitForBackend() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch('http://127.0.0.1:8001/readyz', { signal: controller.signal });
      if (response.ok) return;
    } catch {
      // The service can take a short time to complete migrations and bootstrap.
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('The isolated E2E backend did not become ready within 180 seconds.');
}

let failure;
try {
  run('docker', [...composePrefix, 'down', '--volumes', '--remove-orphans']);
  run('docker', [...composePrefix, 'up', '--detach', '--build', 'e2e-backend']);
  await waitForBackend();
  run(process.execPath, [
    path.join(frontendDir, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config=playwright.real.config.ts',
  ], {
    cwd: frontendDir,
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:8001',
      VITE_DEMO_MODE: 'true',
    },
  });
} catch (error) {
  failure = error;
} finally {
  try {
    run('docker', [...composePrefix, 'down', '--volumes', '--remove-orphans']);
  } catch (cleanupError) {
    if (!failure) failure = cleanupError;
  }
}

if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
