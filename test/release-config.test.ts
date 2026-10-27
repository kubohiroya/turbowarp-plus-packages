import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

const hook = resolve('scripts/release-config-hooks.mjs');
const digest = 'a'.repeat(64);
async function fixture(name = '@kubohiroya/example') {
  const root = await mkdtemp(join(tmpdir(), 'release-config-test-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@localhost');
  await writeFile(join(root, 'package.json'), JSON.stringify({name, version: '0.17.0', private: true}) + '\n');
  await writeFile(join(root, 'README.md'), `${name}@0.17.0\n`);
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/output.txt'), 'old');
  git('add', '.'); git('commit', '--quiet', '-m', 'fixture');
  await writeFile(join(root, '.git/family-execution.json'), JSON.stringify({digest, repository: `kubohiroya/${name.split('/')[1]}`}));
  await writeFile(join(root, 'package.json'), JSON.stringify({name, version: '0.18.0', private: true}) + '\n');
  const run = (mode: string, options?: unknown, env = {}) => spawnSync(process.execPath, [hook, mode, ...(options ? [JSON.stringify(options)] : [])], {
    cwd: root, encoding: 'utf8', env: {...process.env, RELEASE_PLAN_SHA: digest, RELEASE_VERSION: '0.18.0', ...env},
  });
  return {root, git, run};
}

test('candidate verification checks a clean snapshot while preserving the original HEAD and changes', async () => {
  const {root, git, run} = await fixture();
  try {
    await writeFile(join(root, 'dist/output.txt'), 'new');
    const head = git('rev-parse', 'HEAD');
    const status = git('status', '--porcelain');
    const result = run('verify', {install: [], commands: [[process.execPath, '-e',
      `const {execFileSync}=require('node:child_process');const fs=require('node:fs');if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('dirty');if(fs.readFileSync('dist/output.txt','utf8')!=='new')throw Error('old artifact');`]]});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('status', '--porcelain'), status);
    const failed = run('verify', {install: [], commands: [[process.execPath, '-e', `require('node:fs').writeFileSync('README.md','unexpected change')`]]});
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Verification changed/);
    assert.equal(git('status', '--porcelain'), status);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('metadata refresh preserves historical changelog entries and rejects ownership mismatch', async () => {
  const {root, git, run} = await fixture('@kubohiroya/sb3-toolchain');
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/check-repo.ts'), "assert(packageJson.version === '0.17.0', 'package version must be 0.17.0.');\nconst header = `## ${version} - 2026-10-25`;\n");
    await writeFile(join(root, 'CHANGELOG.md'), '# Changes\n\n## 0.17.0 - 2026-10-25\n\n- Historical entry.\n');
    const before = git('status', '--porcelain');
    const denied = run('metadata', undefined, {RELEASE_PLAN_SHA: 'b'.repeat(64)});
    assert.notEqual(denied.status, 0);
    assert.equal(git('status', '--porcelain'), before);
    const result = run('metadata');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(join(root, 'README.md'), 'utf8'), /sb3-toolchain@0\.18\.0/);
    const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## 0\.18\.0 - /);
    assert.match(changelog, /## 0\.17\.0 - 2026-10-25\n\n- Historical entry\./);
    assert.match(await readFile(join(root, 'scripts/check-repo.ts'), 'utf8'), /version === '0\.18\.0'/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
