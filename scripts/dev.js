#!/usr/bin/env node
// Starts the backend (NestJS, --watch) and frontend (Angular CLI dev
// server) together, so `npm run dev` from the repo root is the one call
// needed for local development instead of two terminals.
//
// Deliberately dependency-free (plain `child_process`, no `concurrently`
// or similar): this project's dev tooling has repeatedly hit
// environment-specific breakage from third-party build/dev tools in this
// codebase's history (sharp, lightningcss — see
// frontend-implementation-status.md / discogs-import-implementation-status.md),
// and a two-line orchestration script isn't worth adding another one for.

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RESET = '\x1b[0m';

const PROCESSES = [
  {
    name: 'backend',
    color: '\x1b[34m', // blue
    cwd: path.join(ROOT, 'backend'),
    args: ['run', 'start:dev'],
  },
  {
    name: 'frontend',
    color: '\x1b[35m', // magenta
    cwd: path.join(ROOT, 'frontend'),
    args: ['start'],
  },
];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nameWidth = Math.max(...PROCESSES.map((p) => p.name.length));

function prefixedWrite(stream, proc, chunk) {
  const label = `${proc.color}[${proc.name.padEnd(nameWidth)}]${RESET}`;
  const lines = chunk.toString().split(/\r?\n/);
  // Drop the trailing empty "line" produced by a final newline, so this
  // doesn't print a bare prefix with nothing after it.
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    stream.write(`${label} ${line}\n`);
  }
}

let shuttingDown = false;
const children = [];

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  }
  // Give children a moment to exit cleanly before this process itself
  // exits (which would otherwise orphan them on some platforms).
  setTimeout(() => process.exit(exitCode ?? 0), 200);
}

console.log('Starting backend (http://localhost:3000) and frontend (http://localhost:4200)…');
console.log('Press Ctrl+C to stop both.\n');

for (const proc of PROCESSES) {
  const child = spawn(npmCmd, proc.args, { cwd: proc.cwd, shell: true });
  children.push(child);

  child.stdout.on('data', (chunk) => prefixedWrite(process.stdout, proc, chunk));
  child.stderr.on('data', (chunk) => prefixedWrite(process.stderr, proc, chunk));

  child.on('error', (err) => {
    console.error(`${proc.color}[${proc.name}]${RESET} failed to start: ${err.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.log(
        `${proc.color}[${proc.name}]${RESET} exited${code !== null ? ` with code ${code}` : ` (${signal})`} — stopping the other process too.`,
      );
    }
    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
