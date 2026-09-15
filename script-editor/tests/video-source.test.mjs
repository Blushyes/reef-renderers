import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { episodeNumber, loadVideoSource, associateSourceVideo } from '../video-source.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reef-video-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, '分集 视频');
  await mkdir(directory);
  await writeFile(path.join(directory, '01.mp4'), 'fixture');
  const project = { version: 4, title: '测试', actors: [], locations: [], props: [], custom: { retained: true }, episodes: [{ episode_id: 'ep1', scenes: [] }] };
  const filename = path.join(root, 'script.json');
  const source = JSON.stringify(project);
  await writeFile(filename, source);
  return { root, directory, project, filename, input: { source: { localFileAvailable: true, localPath: filename }, body: { kind: 'structuredData', source }, interaction: { action: 'associateSourceVideo', directory } } };
}

test('episode matching is explicit and ignores unrelated file numbers', () => {
  for (const filename of ['01.mp4', 'ep_001.mp4', 'Episode 1.mov', '标题 第1集.mp4']) assert.equal(episodeNumber(filename), 1);
  for (const filename of ['trailer2025.mp4', 'abc.mp4', '0.mp4']) assert.equal(episodeNumber(filename), null);
});

test('matches by episode number and reports missing episodes', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'ep_003.MP4'), 'fixture');
  const media = await loadVideoSource(f.directory, 3);
  assert.deepEqual(media.videos.map(v => v.episodeIdx), [0, 2]);
  assert.equal(media.warning, '缺少第 2 集视频');
  await writeFile(path.join(f.directory, '第1集.mov'), 'duplicate');
  await assert.rejects(loadVideoSource(f.directory, 3), /多个视频/);
});

test('association preserves all document fields and persists a directory', async t => {
  const f = await fixture(t);
  const result = await associateSourceVideo(f.input, f.project);
  const saved = JSON.parse(await readFile(f.filename, 'utf8'));
  assert.deepEqual(saved, { ...f.project, sourceVideo: result.media.directory });
  assert.equal(result.media.videos.length, 1);
});

test('a stale preview and an invalid directory cannot overwrite the document', async t => {
  const f = await fixture(t);
  await writeFile(f.filename, 'new revision');
  await assert.rejects(associateSourceVideo(f.input, f.project), /已被修改/);
  assert.equal(await readFile(f.filename, 'utf8'), 'new revision');
  f.input.interaction.directory = path.join(f.root, 'missing');
  await assert.rejects(associateSourceVideo(f.input, f.project), /ENOENT/);
  assert.equal(await readFile(f.filename, 'utf8'), 'new revision');
});

test('renderer reopens persisted videos and keeps unavailable source repairable', async t => {
  const f = await fixture(t);
  await associateSourceVideo(f.input, f.project);
  f.input.body.source = await readFile(f.filename, 'utf8');
  delete f.input.interaction;
  const run = () => {
    const result = spawnSync(process.execPath, ['renderer.mjs'], { input: JSON.stringify(f.input), encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..'), maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const ready = run();
  assert.equal(ready.kind, 'interactiveHtml');
  assert.equal(ready.resources.length, 1);
  assert.match(ready.html, /media-src reef-resource:/);
  await rm(f.directory, { recursive: true });
  const missing = run();
  assert.equal(missing.kind, 'interactiveHtml');
  assert.deepEqual(missing.resources, []);
});

test('changing source directories changes media URLs even for identical episode filenames', async t => {
  const f = await fixture(t);
  const other = path.join(f.root, 'other');
  await mkdir(other);
  await writeFile(path.join(other, '01.mp4'), 'other video');
  const first = await loadVideoSource(f.directory, 1);
  const second = await loadVideoSource(other, 1);
  assert.notEqual(first.videos[0].url, second.videos[0].url);
});

test('episode-named symlinks resolve to playable files outside the selected directory', async t => {
  const f = await fixture(t);
  const linked = path.join(f.root, 'linked');
  await mkdir(linked);
  await symlink(path.join(f.directory, '01.mp4'), path.join(linked, '第0001集.mp4'));
  const media = await loadVideoSource(linked, 1);
  assert.equal(media.videos[0].episodeIdx, 0);
  assert.equal(media.videos[0].name, '第0001集.mp4');
  assert.equal(media.resources[0].path, (await loadVideoSource(f.directory, 1)).resources[0].path);
  assert.equal(media.warning, null);
  await symlink(f.directory, path.join(linked, '第0002集.mp4'));
  assert.equal((await loadVideoSource(linked, 2)).videos.length, 1);
  await symlink(path.join(f.root, 'missing.mp4'), path.join(linked, '第0003集.mp4'));
  await assert.rejects(loadVideoSource(linked, 3), /ENOENT/);
});
