#!/usr/bin/env node
// Keep Docker on the NAS. This command only inspects FFTS containers and opens SSH forwards.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const destination = 'admin@192.168.0.14';
const project = 'ffts-development';
const networkName = 'ffts-development-internal';
const forwards = [
  { name: '/ffts-api-gw', label: 'Supabase API', ip: '172.22.0.6', local: 55321, remote: 8000 },
  { name: '/ffts-db', label: 'PostgreSQL', ip: '172.22.0.4', local: 55322, remote: 5432 },
  { name: '/ffts-studio', label: 'Studio', ip: '172.22.0.3', local: 55323, remote: 3000 },
  { name: '/ffts-mailpit', label: 'Mailpit', ip: '172.22.0.5', local: 55324, remote: 8025 },
];
const expectedNames = new Set([
  ...forwards.map((entry) => entry.name), '/ffts-auth', '/ffts-rest',
  '/realtime-dev.ffts-realtime', '/ffts-storage', '/ffts-imgproxy', '/ffts-meta',
]);
let child;
let policyDenied = false;
let childExited = false;

function remote(command) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', destination, command], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Cannot inspect the FFTS NAS project. Check SSH key access and admin Docker-group access.');
  }
  return result.stdout;
}

function verifyNas() {
  const ids = remote('docker ps -aq --filter label=com.docker.compose.project=ffts-development').trim().split(/\s+/u);
  if (ids.length !== expectedNames.size || ids.some((id) => !/^[a-f0-9]{12,64}$/u.test(id))) {
    throw new Error('Expected exactly the ten FFTS development containers. Check the dedicated Compose project.');
  }
  // Inspect results contain environment secrets; never log or save the raw result.
  const containers = JSON.parse(remote(`docker inspect ${ids.join(' ')}`));
  const [network] = JSON.parse(remote('docker network inspect ffts-development-internal'));
  if (!network?.Internal || network.Labels?.['com.docker.compose.project'] !== project) {
    throw new Error('The FFTS network must remain an internal network owned by its Compose project.');
  }
  for (const container of containers) {
    const networks = Object.keys(container.NetworkSettings.Networks ?? {});
    if (!expectedNames.has(container.Name)
      || container.Config.Labels?.['com.docker.compose.project'] !== project
      || container.State.Status !== 'running' || container.State.Health?.Status !== 'healthy'
      || networks.length !== 1 || networks[0] !== networkName
      || Object.keys(container.HostConfig.PortBindings ?? {}).length !== 0
      || container.HostConfig.Privileged
      || container.Mounts.some((mount) => mount.Destination.endsWith('/docker.sock'))) {
      throw new Error('FFTS container health or private-network configuration is unexpected; no tunnel was opened.');
    }
  }
  for (const entry of forwards) {
    const container = containers.find((item) => item.Name === entry.name);
    if (container?.NetworkSettings.Networks[networkName]?.IPAddress !== entry.ip) {
      throw new Error(`Unexpected private address for ${entry.label}; check the tracked Compose IPAM configuration.`);
    }
  }
}

async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Local port ${port} is already in use. Keep the existing tunnel, or stop its owner yourself.`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}

function probeDatabase() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 55322 });
    let done = false;
    function finish(error) {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    }
    socket.setTimeout(1500, () => finish(new Error('Database forward timed out.')));
    socket.once('error', finish);
    socket.once('end', () => finish(new Error('Database forward was closed.')));
    socket.once('connect', () => {
      const request = Buffer.alloc(8);
      request.writeInt32BE(8, 0);
      request.writeInt32BE(80877103, 4); // PostgreSQL SSLRequest, without credentials.
      socket.write(request);
    });
    socket.once('data', (data) => finish(data[0] === 78 || data[0] === 83
      ? undefined : new Error('The forwarded service did not answer as PostgreSQL.')));
  });
}

async function probeHttp(port, path, accepted) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual', signal: AbortSignal.timeout(1500),
  });
  await response.body?.cancel();
  if (!accepted.includes(response.status)) throw new Error('A forwarded HTTP service is not ready.');
}

async function waitUntilReachable() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (policyDenied) throw new Error('NAS SSH policy rejected forwarding. Enable admin local forwarding and the four documented PermitOpen destinations.');
    if (childExited) throw new Error('SSH stopped before the development services became reachable.');
    try {
      await Promise.all([
        probeDatabase(), probeHttp(55321, '/auth/v1/health', [200, 401]),
        probeHttp(55323, '/api/platform/profile', [200]), probeHttp(55324, '/api/v1/info', [200]),
      ]);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error('The four development forwards did not become reachable. Check NAS SSH forwarding permissions and container health.');
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: npm run dev:nas:tunnel (no options).');
  for (const entry of forwards) await assertFree(entry.local);
  verifyNas();
  const args = ['-NT', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3'];
  for (const entry of forwards) args.push('-L', `127.0.0.1:${entry.local}:${entry.ip}:${entry.remote}`);
  args.push(destination);
  child = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => {
    child.once('error', () => { childExited = true; resolve(1); });
    child.once('exit', (code) => { childExited = true; resolve(code ?? 1); });
  });
  child.stderr.on('data', (data) => {
    if (data.toString().includes('administratively prohibited')) policyDenied = true;
    process.stderr.write(data);
  });
  const stop = () => { if (child && !childExited) child.kill(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  await waitUntilReachable();
  console.log('FFTS NAS development tunnel is ready. Keep this terminal open.');
  for (const entry of forwards) console.log(`${entry.label}: 127.0.0.1:${entry.local}`);
  console.log('Start the FFTS app in another terminal with npm run dev. Ctrl+C closes only this SSH tunnel.');
  process.exitCode = await exited;
}

main().catch((error) => {
  if (child && !childExited) child.kill();
  console.error(error.message);
  process.exitCode = 1;
});
