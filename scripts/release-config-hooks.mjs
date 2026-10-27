import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const cwd = process.cwd();
const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
const run = (command, directory = cwd) => execFileSync(command[0], command.slice(1), {cwd: directory, stdio: 'inherit'});
const read = async file => {
  try { return await readFile(join(cwd, file), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

// These hooks only operate inside an executor-owned checkout.
const marker = JSON.parse(await readFile(join(cwd, '.git/family-execution.json'), 'utf8'));
assert(marker.digest === process.env.RELEASE_PLAN_SHA && marker.repository, 'Executor ownership does not match.');
const manifest = JSON.parse(await read('package.json'));
assert.equal(manifest.version, process.env.RELEASE_VERSION);
const [mode, argument] = process.argv.slice(2);

if (mode === 'guard') {
  assert(manifest.private || manifest.name.startsWith('@kubohiroya/'), 'Unscoped third-party package publication requires a separate policy.');
  assert(marker.repository !== 'kubohiroya/turbowarp-3d-scene-dsl', 'Retired package: use turbowarp-scene-graph.');
} else if (mode === 'metadata') {
  const previous = JSON.parse(git('show', 'HEAD:package.json'));
  const replacements = [[previous.name, previous.version, manifest.version]];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      const old = previous[field]?.[name];
      if (old && old !== value) replacements.push([name, old.replace(/^[~^]/u, ''), value.replace(/^[~^]/u, '')]);
    }
  }
  for (const file of ['README.md', 'README.ja.md', 'docs/index.html', 'docs/ja/index.html']) {
    const before = await read(file);
    if (before === null) continue;
    let after = before;
    for (const [name, old, next] of replacements) {
      if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(old)) after = after.replaceAll(`${name}@${old}`, `${name}@${next}`);
    }
    if (after !== before) await writeFile(join(cwd, file), after);
  }
  // Only update known version declarations; do not rewrite arbitrary tests or historical releases.
  const repo = marker.repository.split('/')[1];
  if (repo === 'turbowarp-kamishibai-app') {
    const path = 'test/fixtures/dsl4/release-pins.json';
    const pins = JSON.parse(await read(path));
    pins.release.version = manifest.version;
    for (const field of ['extensions', 'devDependencies', 'supportDependencies']) {
      for (const name of Object.keys(pins[field])) {
        const installed = JSON.parse(await readFile(join(cwd, 'node_modules', name, 'package.json'), 'utf8'));
        pins[field][name] = installed.version;
      }
    }
    await writeFile(join(cwd, path), JSON.stringify(pins, null, 2) + '\n');
    const policyPath = 'scripts/sb3/dsl4-release-policy.ts';
    const policy = await read(policyPath);
    const match = /^(.*-rc\.)(\d+)$/u.exec(manifest.version);
    assert(match, 'The checked Kamishibai policy only supports the existing RC series.');
    await writeFile(join(cwd, policyPath), policy
      .replace(/dsl4NextReleaseVersion = '[^']+'/u, `dsl4NextReleaseVersion = '${match[1]}${Number(match[2]) + 1}'`)
      .replace(/dsl4ReleaseBuildDate = '[^']+'/u, `dsl4ReleaseBuildDate = '${new Date().toISOString().slice(0, 10)}'`));
    const matrixPath = 'test/fixtures/dsl4/artifact-fingerprint-matrix.json';
    const matrix = JSON.parse(await read(matrixPath));
    matrix.input.builder.version = manifest.version;
    matrix.input.appShell.templateVersion = manifest.version;
    await writeFile(join(cwd, matrixPath), JSON.stringify(matrix, null, 2) + '\n');
  }
  if (['sb3-toolchain', 'turbowarp-camera-source', 'turbowarp-jsqr', 'turbowarp-qr-display'].includes(repo)) {
    const file = 'scripts/check-repo.ts';
    const before = await read(file);
    assert(before, `Missing ${file}`);
    let after = before.replaceAll(`'${previous.version}'`, `'${manifest.version}'`)
      .replaceAll(`"${previous.version}"`, `"${manifest.version}"`)
      .replaceAll(`version must be ${previous.version}`, `version must be ${manifest.version}`);
    if (repo === 'sb3-toolchain') {
      const date = new Date().toISOString().slice(0, 10);
      after = after.replace(/## \$\{version\} - \d{4}-\d{2}-\d{2}/gu, `## ${'${version}'} - ${date}`);
      const changelog = await read('CHANGELOG.md');
      if (changelog && !changelog.includes(`## ${manifest.version} - `)) {
        const entry = `## ${manifest.version} - ${date}\n\n- Refresh family dependencies and release registration.\n\n`;
        await writeFile(join(cwd, 'CHANGELOG.md'), changelog.replace(/^## /mu, `${entry}## `));
      }
    }
    if (after !== before) await writeFile(join(cwd, file), after);
  }
} else if (mode === 'fingerprint') {
  assert.equal(marker.repository, 'kubohiroya/turbowarp-kamishibai-app');
  const {createDsl4ArtifactFingerprint} = await import(pathToFileURL(join(cwd, 'dist/builder/index.js')).href);
  const matrix = JSON.parse(await read('test/fixtures/dsl4/artifact-fingerprint-matrix.json'));
  const pins = JSON.parse(await read('test/fixtures/dsl4/release-pins.json'));
  pins.artifactFingerprint.expected = (await createDsl4ArtifactFingerprint(matrix.input)).integrity;
  await writeFile(join(cwd, 'test/fixtures/dsl4/release-pins.json'), JSON.stringify(pins, null, 2) + '\n');
} else if (mode === 'cut') {
  const file = `release-metadata/${manifest.version}.json`;
  const snapshot = await read(file);
  // Frozen candidates are verified rather than regenerated on resume.
  if (snapshot) {
    assert.equal(JSON.parse(snapshot).version, manifest.version);
    run(['corepack', 'pnpm', 'run', 'release:dsl4:check']);
  } else run(['corepack', 'pnpm', 'run', 'release:dsl4:cut']);
} else if (mode === 'verify') {
  const {install, commands, files = [], npm = ['npm']} = JSON.parse(argument);
  assert(Array.isArray(install) && Array.isArray(commands) && commands.length);
  const temporary = await mkdtemp(join(tmpdir(), 'family-release-verify-'));
  const checkout = join(temporary, 'checkout');
  try {
    // The original HEAD/index remain untouched, including when verification fails.
    execFileSync('git', ['clone', '--shared', '--quiet', '--no-hardlinks', cwd, checkout], {stdio: 'inherit'});
    const patch = execFileSync('git', ['diff', '--binary', 'HEAD'], {cwd, maxBuffer: 128 * 1024 * 1024});
    if (patch.length) execFileSync('git', ['apply', '--binary', '-'], {cwd: checkout, input: patch});
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {cwd, encoding: 'utf8'});
    for (const file of untracked.split('\0').filter(Boolean)) {
      const destination = resolve(checkout, file);
      assert(destination.startsWith(checkout + '/'));
      await mkdir(dirname(destination), {recursive: true});
      await copyFile(join(cwd, file), destination);
    }
    // Frozen SB3 candidates are ignored by Git but required by release checks.
    for (const template of files) {
      const file = template.replaceAll('{version}', manifest.version);
      const destination = resolve(checkout, file);
      assert(destination.startsWith(checkout + '/'));
      await mkdir(dirname(destination), {recursive: true});
      await copyFile(join(cwd, file), destination);
    }
    execFileSync('git', ['add', '--all'], {cwd: checkout});
    execFileSync('git', ['-c', 'user.name=Release verification', '-c', 'user.email=release-verification@localhost', 'commit', '--quiet', '--allow-empty', '-m', 'Local release verification snapshot'], {cwd: checkout});
    for (const command of [...install, ...commands]) run(command, checkout);
    const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd: checkout, encoding: 'utf8'});
    assert.equal(changes, '', 'Verification changed candidate sources or tracked generated files.');
    if (!manifest.private) {
      const packs = [];
      for (const directory of [cwd, checkout]) {
        const destination = await mkdtemp(join(temporary, 'pack-'));
        const result = JSON.parse(execFileSync(npm[0], [...npm.slice(1), 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], {cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}));
        packs.push(Array.isArray(result) ? result[0] : Object.values(result)[0]);
      }
      assert(packs.every(pack => pack.name === manifest.name && pack.version === manifest.version));
      assert.equal(packs[0].shasum, packs[1].shasum, 'Verified and prepared npm tarballs differ.');
    }
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
} else {
  throw new Error(`Unknown release config hook: ${mode}`);
}
