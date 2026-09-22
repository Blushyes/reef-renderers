import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('launcher finds terminal Node from a Finder PATH and preserves renderer stdin and stdout', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reef-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, '用户 Home');
  const bundle = path.join(home, 'Library', 'Application Support', 'Reef', 'renderers', 'script-editor');
  const nodeDirectory = path.join(home, '.nvm', 'versions', 'node', 'test-version', 'bin');
  await mkdir(bundle, { recursive: true });
  await mkdir(nodeDirectory, { recursive: true });
  await symlink(process.execPath, path.join(nodeDirectory, 'node'));
  const sourceDirectory = path.resolve(import.meta.dirname, '..');
  for (const file of ['renderer.json', 'launch.sh', 'renderer.mjs', 'video-source.mjs', 'script-editor.min.js', 'paper-fibers.png']) {
    await copyFile(path.join(sourceDirectory, file), path.join(bundle, file));
  }
  await writeFile(path.join(home, '.zprofile'), 'print "login startup output"\n');
  await writeFile(path.join(home, '.zshrc'), [
    'print "interactive startup output"',
    // An init script must not consume the preview JSON on the renderer's stdin.
    'read -r startup_input',
    'export PATH="$HOME/.nvm/versions/node/test-version/bin:$PATH"',
    '',
  ].join('\n'));
  const manifest = JSON.parse(await readFile(path.join(bundle, 'renderer.json'), 'utf8'));
  const [executable, ...args] = manifest.command.map(argument => argument.replaceAll('{rendererRoot}', bundle));
  const project = {
    version: 4, title: '登录环境验证', actors: [], locations: [], props: [],
    episodes: [{ episode_id: 'ep1', scenes: [] }], padding: 'x'.repeat(1024 * 1024),
  };
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    input: JSON.stringify({ body: { kind: 'structuredData', source: JSON.stringify(project) } }),
    encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.equal(JSON.parse(result.stdout).kind, 'interactiveHtml');
  assert.match(result.stderr, /login startup output/);
  assert.match(result.stderr, /interactive startup output/);
});
