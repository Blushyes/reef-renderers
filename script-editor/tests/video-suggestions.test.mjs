import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { suggestVideoSources } from '../src/video-suggestions.ts';

test('nearby discovery distinguishes completeness, ambiguity and project provenance', async t => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'reef-suggestions-')));
  t.after(() => rm(temp, {recursive:true, force:true}));
  const root = path.join(temp, 'projects', 'show');
  const input = path.join(root, '0_input');
  const recorded = path.join(temp, 'recorded');
  const nearby = path.join(root, 'source');
  const duplicate = path.join(root, 'duplicates');
  const unrelated = path.join(temp, 'projects', 'unrelated');
  for (const dir of [input, recorded, nearby, duplicate, unrelated]) await mkdir(dir, {recursive:true});
  for (const [dir,names] of [[recorded,['01.mp4','02.mp4']], [nearby,['01.mp4','03.mp4']], [duplicate,['01.mp4','ep_001.mp4']], [unrelated,['01.mp4','02.mp4']]]) {
    for (const name of names) await writeFile(path.join(dir,name),'video fixture');
  }
  await symlink(recorded,path.join(root,'alias'));
  await writeFile(path.join(root,'project.json'),JSON.stringify({videoSource:{path:recorded}}));
  const result=await suggestVideoSources(path.join(input,'script.json'), {episodes:[{},{}]});
  assert.equal(result[0].directory, recorded);
  assert.equal(result.filter(x=>x.directory===recorded).length,1);
  assert.equal(result[0].matched,2);
  const partial=result.find(x=>x.directory===nearby);
  assert.equal(partial.matched,1);
  assert.equal(partial.extra,1);
  assert.match(partial.warning,/2/);
  assert.match(result.find(x=>x.directory===duplicate).problem,/多个视频/);
  assert.equal(result.some(x=>x.directory===unrelated),false);
  const atRoot=await suggestVideoSources(path.join(root,'script.json'), {episodes:[{},{}]});
  assert.equal(atRoot.some(x=>x.directory===unrelated),false);
  await mkdir(path.join(temp, 'empty', 'nested'), {recursive:true});
  assert.deepEqual(await suggestVideoSources(path.join(temp,'empty','nested','script.json'),{episodes:[{}]}),[]);
});
