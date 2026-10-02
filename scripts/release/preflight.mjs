import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this command with npm run release:preflight.');

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npmRun(...args) {
  run(process.execPath, [npm, ...args]);
}

// Check tools and dependency policy before spending time compiling the app.
for (const tool of ['audit', 'deny', 'cyclonedx']) run('cargo', [tool, '--version']);
npmRun('ci');
npmRun('audit', '--omit=dev');
run('cargo', ['audit', '--file', 'src-tauri/Cargo.lock']);
run(process.execPath, ['scripts/check-js-licenses.mjs']);
run('cargo', ['deny', '--manifest-path', 'src-tauri/Cargo.toml', 'check', 'licenses', 'bans', 'sources']);

for (const task of ['type-check', 'lint', 'format:check']) npmRun('run', task);
npmRun('test', '--', '--run');
npmRun('run', 'test:release');
npmRun('run', 'build');
run('cargo', ['fmt', '--all', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--check']);
run('cargo', ['clippy', '--locked', '--all-targets', '--all-features', '--manifest-path', 'src-tauri/Cargo.toml', '--', '-D', 'warnings']);
for (const binary of ['clipsx', 'clipsx-extension-tool', 'clipsx-release-verify']) {
  run('cargo', ['test', '--locked', '--all-features', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', binary]);
}
run('cargo', ['cyclonedx', '--manifest-path', 'src-tauri/Cargo.toml', '--format', 'json']);
console.log('\nApplication release preflight passed.');
