import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import semver from 'semver';
import type { Command, ExecutionConfig, ExecutionEntry, ExecutionState, ReleaseDriver, ReleaseProfile } from './release-execution.ts';
import type { PackagePlan } from './release-plan.ts';
import { profileFromContract } from './release-contract.ts';

export class CommandFailure extends Error {
  constructor(readonly command: Command, readonly stdout: string, readonly stderr: string, readonly status: number | null) {
    super(`${command[0]} が失敗しました (${status}): ${stderr || stdout}`);
  }
}
export interface CommandOptions { cwd?: string; interactive?: boolean; env?: NodeJS.ProcessEnv }
export type Runner = (command: Command, options?: CommandOptions) => Promise<string>;

/** No shell interpolation; interactive npm authentication stays in the user's terminal. */
export const runCommand: Runner = (command, options = {}) => new Promise((resolveResult, reject) => {
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd, shell: false, env: { ...process.env, LC_ALL: 'C', ...options.env },
    stdio: options.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout?.on('data', chunk => { stdout += String(chunk); });
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.on('error', reject);
  child.on('close', status => status === 0 ? resolveResult(stdout.trim()) : reject(new CommandFailure(command, stdout, stderr, status)));
});

const absent = (error: unknown) => error instanceof CommandFailure &&
  (/HTTP 404|\(404\)|"status":\s*"404"/u.test(error.stderr) || /\bE404\b/u.test(error.stdout + error.stderr));
const hash = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');
const versionOf = (step: PackagePlan) => step.nextVersion ?? step.publishedVersion ?? step.currentVersion!;
const tagOf = (step: PackagePlan) => `v${versionOf(step)}`;
interface RegistryVersion { name: string; version: string; gitHead?: string; dist: { shasum: string; attestations?: { provenance?: { predicateType: string } } } }
interface PullRequest { number: number; html_url: string; state: string; merged: boolean; merge_commit_sha: string | null; head: { sha: string }; base: { ref: string } }
interface GithubRelease { id: number; tag_name: string; html_url: string; draft: boolean; assets: { name: string; size: number; browser_download_url: string; digest?: string }[] }

/** npm 11 returns an array; npm 12 returns a map keyed by package name. */
export function parsePackResult(source: string, name: string, version: string): { filename: string; shasum: string } {
  const result = JSON.parse(source);
  const pack = Array.isArray(result) ? (result.length === 1 ? result[0] : null) : result[name];
  assert(pack?.name === name && pack.version === version && typeof pack.filename === 'string' &&
    basename(pack.filename) === pack.filename && /^[a-f0-9]{40}$/u.test(pack.shasum), 'npm pack結果が計画と一致しません。');
  return pack;
}

export class GithubNpmReleaseDriver implements ReleaseDriver {
  private readonly root: string;
  constructor(
    workspace: string, private readonly config: ExecutionConfig, private readonly state: ExecutionState,
    private readonly save: () => Promise<void>, private readonly run: Runner = runCommand,
    private readonly sleep: (milliseconds: number) => Promise<void> = ms => setTimeout(ms),
  ) { this.root = resolve(workspace); }

  private path(step: PackagePlan) { return join(this.root, 'checkouts', step.repo); }
  private artifacts(step: PackagePlan) { return join(this.root, 'artifacts', step.repo); }
  private git(step: PackagePlan, ...args: string[]) { return this.run(['git', ...args], { cwd: this.path(step) }); }
  private npm(profile: ReleaseProfile, args: string[], cwd?: string, interactive = false) {
    return this.run([...(profile.npm ?? ['npm']), ...args, '--registry=https://registry.npmjs.org'], { cwd, interactive });
  }
  private api<T>(path: string) { return this.run(['gh', 'api', '--method', 'GET', path]).then(output => JSON.parse(output) as T); }
  private async optional<T>(path: string): Promise<T | null> {
    try { return await this.api<T>(path); } catch (error) { if (absent(error)) return null; throw error; }
  }
  private async registry(step: PackagePlan, profile: ReleaseProfile, version: string): Promise<RegistryVersion | null> {
    try {
      const value = JSON.parse(await this.npm(profile, ['view', `${step.name}@${version}`, '--json', '--prefer-online', '--fetch-retries=0', '--fetch-timeout=15000'])) as RegistryVersion;
      assert(value.name === step.name && value.version === version && /^[a-f0-9]{40}$/u.test(value.dist?.shasum), 'npmの版・名前・ハッシュが不正です。');
      return value;
    } catch (error) { if (absent(error)) return null; throw error; }
  }
  private async sourceVersion(step: PackagePlan, sha: string): Promise<void> {
    const file = await this.api<{ content: string; encoding: string }>(`repos/${step.repository}/contents/package.json?ref=${sha}`);
    assert.equal(file.encoding, 'base64');
    const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    assert(manifest.name === step.name && manifest.version === versionOf(step) &&
      (step.action === 'update-only' || !manifest.private), `${step.repo}: GitHubソースのname/versionがnpmと一致しません。--reconcileで新しいリリースを計画してください。`);
  }
  private async tagSha(step: PackagePlan): Promise<string | null> {
    const ref = await this.optional<{ object: { type: string; sha: string } }>(`repos/${step.repository}/git/ref/tags/${tagOf(step)}`);
    if (!ref) return null;
    let target = ref.object;
    for (let depth = 0; target.type === 'tag'; depth++) {
      assert(depth < 10, 'タグの参照が深すぎます。');
      target = (await this.api<{ object: { type: string; sha: string } }>(`repos/${step.repository}/git/tags/${target.sha}`)).object;
    }
    assert(target.type === 'commit' && /^[a-f0-9]{40}$/u.test(target.sha), 'タグがcommitを指していません。');
    return target.sha;
  }

  async preflight(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    const contract = this.config.contracts?.find(item => item.repository === step.repository);
    if (contract) {
      assert.equal(contract.sha, step.headSha, 'リリース契約の入力SHAが計画と異なります。');
      for (const [file, expected] of Object.entries(contract.files)) {
        assert(['package.json', '.github/workflows/release.yml'].includes(file));
        const source: { encoding: string; content: string } = await this.api(`repos/${step.repository}/contents/${file}?ref=${contract.sha}`);
        assert.equal(source.encoding, 'base64');
        assert.equal(createHash('sha256').update(Buffer.from(source.content, 'base64')).digest('hex'), expected, 'リリース契約が承認時と異なります。再計画が必要です。');
      }
    }
    const repository = await this.api<{ default_branch: string; archived: boolean; permissions: { push: boolean } }>(`repos/${step.repository}`);
    assert(!repository.archived && repository.permissions?.push, `${step.repo}: push可能な非archive repoが必要です。`);
    entry.base ??= repository.default_branch;
    assert.equal(entry.base, repository.default_branch, 'default branchが変わりました。');
    if (step.action === 'publish' && profile.publish.mode !== 'cli') {
      const workflow = await this.api<{ state: string }>(`repos/${step.repository}/actions/workflows/${profile.publish.workflow}`);
      assert.equal(workflow.state, 'active', '指定した公開workflowが無効です。');
      if (this.config.trustedPublisherOnly) {
        const getText = async (file: string) => {
          const source = await this.api<{ encoding: string; content: string }>(`repos/${step.repository}/contents/${file}?ref=${step.headSha}`);
          assert.equal(source.encoding, 'base64');
          return Buffer.from(source.content, 'base64').toString('utf8');
        };
        const declared = profileFromContract(await getText('package.json'), await getText('.github/workflows/release.yml'), profile);
        assert.deepEqual(profile.publish, declared.publish, '明示configとrepoの公開契約が不一致です。');
      }
    }
    if (step.action === 'publish' && profile.publish.mode === 'cli' && profile.publish.provenance) {
      assert(process.env.GITHUB_ACTIONS === 'true' || process.env.GITLAB_CI === 'true', 'CLI provenance公開は対応CI環境内で実行してください。ローカルではworkflow方式を設定してください。');
    }
    const head = await this.api<{ object: { sha: string } }>(`repos/${step.repository}/git/ref/heads/${encodeURIComponent(entry.base)}`);
    if (entry.phase === 'pending' && !entry.pr) assert.equal(head.object.sha, step.headSha, `${step.repo}: mainが解析時から変わりました。再計画が必要です。`);
    const published = step.action === 'update-only' ? null : await this.registry(step, profile, versionOf(step));
    if (step.action === 'publish' && published) {
      assert(entry.shasum && entry.shasum === published.dist.shasum, `${step.repo}: 予定版はすでに公開済みです。上書きせず再計画してください。`);
    }
    if (step.action === 'none') {
      assert(published, `${step.repo}: 公開済み版を取得できません。`);
      const sha = await this.tagSha(step);
      assert(sha, `${step.repo}: npm公開版のタグがありません。--reconcileで新しい版と下流更新を計画してください。`);
      await this.sourceVersion(step, sha);
      assert(!entry.mergeCommit || entry.mergeCommit === sha, '再開記録のタグSHAと異なります。');
      assert(!entry.shasum || entry.shasum === published.dist.shasum, '再開記録のnpmハッシュと異なります。');
      entry.mergeCommit = sha;
      entry.shasum = published.dist.shasum;
    }
    if (entry.phase === 'pending' && step.action !== 'update-only') {
      let latest: string | null = null;
      try { latest = JSON.parse(await this.npm(profile, ['view', step.name!, 'dist-tags', '--json', '--prefer-online'])).latest ?? null; }
      catch (error) { if (!absent(error)) throw error; }
      assert.equal(latest, step.publishedVersion, `${step.repo}: npm latestが解析時から変わりました。`);
    }
    for (const update of step.dependencyUpdates) {
      if (update.source === 'published') {
        const latest = JSON.parse(await this.npm(profile, ['view', update.name, 'dist-tags', '--json', '--prefer-online'])).latest;
        assert.equal(latest, update.targetVersion, `${update.name}: 上流が解析時より進みました。再計画してください。`);
      }
    }
    if (step.action !== 'none') {
      const branch = `codex/release/${step.repo}-${versionOf(step)}-${this.state.digest.slice(0, 8)}`;
      assert(!entry.branch || entry.branch === branch, '作業ブランチが実行記録と一致しません。');
      entry.branch = branch;
      await mkdir(dirname(this.path(step)), { recursive: true });
      const marker = join(this.path(step), '.git', 'family-execution.json');
      let owned = false;
      try {
        const owner = JSON.parse(await readFile(marker, 'utf8'));
        assert(owner.digest === this.state.digest && owner.repository === step.repository, '別の実行が所有するcheckoutです。');
        owned = true;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!owned) {
        await this.run(['git', 'clone', '--no-checkout', `https://github.com/${step.repository}.git`, this.path(step)]);
        await writeFile(marker, JSON.stringify({ digest: this.state.digest, repository: step.repository }));
        await this.git(step, 'checkout', '-b', entry.branch, step.headSha!);
      }
      assert.equal(await this.git(step, 'remote', 'get-url', 'origin'), `https://github.com/${step.repository}.git`);
      const manifest = JSON.parse(await readFile(join(this.path(step), 'package.json'), 'utf8'));
      assert.equal(manifest.name, step.name);
      if (step.action === 'publish') assert(!manifest.private, 'private packageはnpm公開しません。');
      assert([step.currentVersion, versionOf(step)].includes(manifest.version), 'ローカル版が計画と一致しません。');
      if (manifest.engines?.node) assert(semver.satisfies(process.version, manifest.engines.node), `${step.repo}: Node ${manifest.engines.node}が必要です。`);
      if (entry.commit && entry.phase !== 'complete') assert.equal(await this.git(step, 'rev-parse', 'HEAD'), entry.commit, 'checkoutに未記録のcommitがあります。');
      else if (entry.phase === 'pending') assert.equal(await this.git(step, 'rev-parse', 'HEAD'), step.headSha, 'checkoutのHEADが変わりました。');
      if (entry.phase !== 'pending') assert.equal(await this.git(step, 'status', '--porcelain'), '', '再開checkoutに未コミット変更があります。');
      if (entry.artifact) {
        assert.equal(dirname(await realpath(entry.artifact)), await realpath(this.artifacts(step)), '実行記録のtarballが成果物dir外を参照しています。');
        assert.equal(hash(await readFile(entry.artifact)), entry.shasum, '実行記録のtarballが変わりました。');
      }
    }
  }

  async prepared(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action === 'none') return;
    const cwd = this.path(step);
    if (!entry.commit) {
      const path = join(cwd, 'package.json');
      const before = await readFile(path, 'utf8');
      const manifest = JSON.parse(before);
      for (const change of step.dependencyUpdates) {
        assert([change.from, change.to].includes(manifest[change.field]?.[change.name]), '依存指定が解析時から変わっています。');
        manifest[change.field][change.name] = change.to;
      }
      manifest.version = versionOf(step);
      const newline = before.includes('\r\n') ? '\r\n' : '\n';
      await writeFile(path, JSON.stringify(manifest, null, /\n([\t ]+)\S/u.exec(before)?.[1] ?? 2).replace(/\n/gu, newline) + newline);
      for (const command of [...profile.install, ...(profile.prepare ?? []), ...profile.verify]) {
        await this.run(command, { cwd, interactive: true, env: { RELEASE_VERSION: versionOf(step), RELEASE_PLAN_SHA: this.state.digest } });
      }
    }
    if (step.action === 'publish') {
      await mkdir(this.artifacts(step), { recursive: true });
      const result = parsePackResult(await this.npm(profile, ['pack', '--ignore-scripts', '--json', '--pack-destination', this.artifacts(step)], cwd), step.name!, versionOf(step));
      entry.artifact = join(this.artifacts(step), result.filename);
      entry.shasum = hash(await readFile(entry.artifact));
      assert.equal(entry.shasum, result.shasum);
      if (!entry.extraArtifacts) {
        const extraArtifacts: NonNullable<ExecutionEntry['extraArtifacts']> = [];
        for (const file of profile.artifacts ?? []) {
          const filename = file.replaceAll('{version}', versionOf(step));
          const source = await realpath(join(cwd, filename));
          const rel = relative(await realpath(cwd), source);
          assert(rel && !rel.startsWith('..') && !rel.startsWith('/'), '成果物がcheckout外を参照しています。');
          const destination = join(this.artifacts(step), basename(filename));
          assert(destination !== entry.artifact && !extraArtifacts.some(asset => asset.path === destination), '添付物の名前が重複しています。');
          const bytes = await readFile(source);
          await writeFile(destination, bytes);
          extraArtifacts.push({ path: destination, sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        entry.extraArtifacts = extraArtifacts;
      }
    }
    const after = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    assert(after.name === step.name && after.version === versionOf(step), '検証コマンドがname/versionを変更しました。');
    for (const change of step.dependencyUpdates) assert.equal(after[change.field]?.[change.name], change.to);
    if (!entry.commit) {
      await this.git(step, 'add', '--all');
      await this.git(step, 'commit', '-m', `chore(release): prepare ${step.name} ${versionOf(step)}`);
      entry.commit = await this.git(step, 'rev-parse', 'HEAD');
      await this.save();
    }
    assert.equal(await this.git(step, 'status', '--porcelain'), '', '検証後に未コミット変更があります。');
  }

  async pushed(step: PackagePlan, _profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action === 'none') return;
    assert(entry.branch?.startsWith('codex/release/') && entry.commit);
    assert.equal(await this.git(step, 'rev-parse', 'HEAD'), entry.commit);
    assert.equal(await this.git(step, 'status', '--porcelain'), '');
    const remote = await this.git(step, 'ls-remote', '--heads', 'origin', entry.branch!);
    assert(!remote || remote.split(/\s/u)[0] === entry.commit, 'remote作業ブランチが別のcommitを指しています。');
    if (!remote) await this.git(step, 'push', '--set-upstream', 'origin', `${entry.commit}:refs/heads/${entry.branch}`);
    if (!entry.pr) {
      const list = await this.api<PullRequest[]>(`repos/${step.repository}/pulls?state=all&head=${encodeURIComponent(step.repository.split('/')[0] + ':' + entry.branch!)}`);
      if (list.length) {
        assert.equal(list.length, 1, '作業ブランチのPRが一意ではありません。');
        assert.equal(list[0].head.sha, entry.commit);
        entry.pr = list[0].number; entry.prUrl = list[0].html_url;
      } else {
        const notes = join(this.root, 'notes', step.repo, 'pr-body.md');
        await mkdir(dirname(notes), { recursive: true });
        await writeFile(notes, `${step.name}を${versionOf(step)}へ更新する。\n\n依存更新:\n${step.dependencyUpdates.map(update => `- ${update.name}: ${update.from} → ${update.to}`).join('\n') || '- なし'}\n\n検証: 設定されたinstall/prepare/verifyを実行済み。\n計画SHA: ${this.state.digest}\n\nロールバック: 未公開差分はrevert。公開済み版は上書きせず別番号で修正する。\n`);
        entry.prUrl = await this.run(['gh', 'pr', 'create', '--repo', step.repository, '--base', entry.base!, '--head', entry.branch!, '--title', `chore(release): prepare ${step.name} ${versionOf(step)}`, '--body-file', notes]);
        assert.match(entry.prUrl, new RegExp(`^https://github.com/${step.repository}/pull/\\d+$`, 'u'));
        entry.pr = Number(entry.prUrl.split('/').at(-1));
      }
      await this.save();
    }
  }

  private async wait<T>(read: () => Promise<T | null>, description: string): Promise<T> {
    const attempts = Math.max(1, Math.ceil((this.config.workflowTimeoutSeconds ?? 3600) / 10));
    for (let attempt = 0; attempt < attempts; attempt++) {
      const value = await read();
      if (value !== null) return value;
      if (attempt + 1 < attempts) await this.sleep(10000);
    }
    throw new Error(`${description}: timeout。再開時も公開済み版は再公開しません。`);
  }

  async merged(step: PackagePlan, _profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action === 'none') return;
    const get = () => this.api<PullRequest>(`repos/${step.repository}/pulls/${entry.pr}`);
    let pr = await get();
    assert.equal(pr.head.sha, entry.commit, 'PR headが変わりました。');
    assert.equal(pr.base.ref, entry.base);
    if (!pr.merged) {
      assert.equal(pr.state, 'open', 'PRがmergeされずcloseされています。');
      await this.wait(async () => {
        const checks = await this.api<{ check_runs: { status: string; conclusion: string | null }[]; total_count: number }>(`repos/${step.repository}/commits/${entry.commit}/check-runs?per_page=100`);
        assert(checks.total_count <= 100, 'CI checksが100件を超えるため自動判定できません。');
        const status = await this.api<{ statuses: { state: string }[] }>(`repos/${step.repository}/commits/${entry.commit}/status`);
        if (!checks.check_runs.length && !status.statuses.length) return null;
        for (const check of checks.check_runs) if (check.status === 'completed') assert(['success', 'neutral', 'skipped'].includes(check.conclusion ?? ''), 'CIが失敗しました。');
        for (const item of status.statuses) assert(!['failure', 'error'].includes(item.state), 'commit statusが失敗しました。');
        return checks.check_runs.every(check => check.status === 'completed') && status.statuses.every(item => item.state === 'success') ? true : null;
      }, 'PR CI');
      const base = await this.api<{ object: { sha: string } }>(`repos/${step.repository}/git/ref/heads/${encodeURIComponent(entry.base!)}`);
      assert.equal(base.object.sha, step.headSha, '検証中にbaseが変わりました。mergeせず再計画してください。');
      await this.run(['gh', 'pr', 'merge', String(entry.pr), '--repo', step.repository, '--squash', '--match-head-commit', entry.commit!]);
      pr = await get();
    }
    assert(pr.merged && pr.merge_commit_sha, 'PR mergeを確認できません。');
    entry.mergeCommit = pr.merge_commit_sha;
    await this.save();
    await this.git(step, 'fetch', 'origin', entry.base!);
    await this.git(step, 'diff', '--exit-code', entry.commit!, entry.mergeCommit);
    await this.sourceVersion(step, entry.mergeCommit);
  }

  async tagged(step: PackagePlan, _profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action === 'update-only') return;
    assert(entry.mergeCommit);
    const existing = await this.tagSha(step);
    if (existing) assert.equal(existing, entry.mergeCommit, '既存タグは別のSHAです。移動・上書きしません。');
    else {
      assert.equal(step.action, 'publish', '既存公開版のsourceを推測してタグを作成しません。--reconcileで再計画してください。');
      const local = await this.git(step, 'tag', '--list', tagOf(step));
      if (local) assert.equal(await this.git(step, 'rev-parse', `${tagOf(step)}^{commit}`), entry.mergeCommit, 'ローカル同名タグが異なります。');
      else await this.git(step, 'tag', '-a', tagOf(step), entry.mergeCommit, '-m', `Release ${step.name} ${versionOf(step)}`);
      await this.git(step, 'push', 'origin', `refs/tags/${tagOf(step)}`);
    }
    assert.equal(await this.tagSha(step), entry.mergeCommit);
  }

  async released(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action === 'update-only') return;
    let release = await this.optional<GithubRelease>(`repos/${step.repository}/releases/tags/${tagOf(step)}`);
    if (!release) {
      await mkdir(this.artifacts(step), { recursive: true });
      const notes = join(this.root, 'notes', step.repo, 'release-notes.md');
      await mkdir(dirname(notes), { recursive: true });
      await writeFile(notes, `${step.name} ${versionOf(step)}\n\nSource: ${entry.mergeCommit}\nPlan: ${this.state.digest}\nnpm archive SHA1: ${entry.shasum}\n\n公開後の修正は別番号で発行し、この版・タグは上書きしません。\n`);
      const args = ['gh', 'release', 'create', tagOf(step), '--repo', step.repository, '--verify-tag', '--title', `${step.name} ${versionOf(step)}`, '--notes-file', notes];
      if (semver.prerelease(versionOf(step))) args.push('--prerelease');
      try { await this.run(args); }
      catch (error) {
        if (!await this.optional<GithubRelease>(`repos/${step.repository}/releases/tags/${tagOf(step)}`)) throw error;
      }
      release = await this.api<GithubRelease>(`repos/${step.repository}/releases/tags/${tagOf(step)}`);
    }
    assert(!release.draft && release.tag_name === tagOf(step), '公開Releaseを確認できません。');
    entry.releaseUrl = release.html_url;
    if (step.action === 'publish') {
      assert(entry.artifact && entry.shasum && hash(await readFile(entry.artifact)) === entry.shasum, '検証済みtarballが変わりました。');
      const assets = [entry.artifact];
      for (const asset of entry.extraArtifacts ?? []) {
        assert.equal(dirname(await realpath(asset.path)), await realpath(this.artifacts(step)), '保存済み成果物がdir外を参照しています。');
        assert.equal(createHash('sha256').update(await readFile(asset.path)).digest('hex'), asset.sha256, '保存済み成果物が変更されました。');
        assets.push(asset.path);
      }
      assert.equal(new Set(assets.map(file => basename(file))).size, assets.length, '添付物のファイル名が重複しています。');
      for (const file of assets) {
        const old: GithubRelease['assets'][number] | undefined = release.assets.find(asset => asset.name === basename(file));
        if (old) {
          const existing: string | undefined = old.digest;
          const expected = `sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`;
          assert.equal(existing, expected, '同名の公開成果物が異なります。上書きしません。');
        } else await this.run(['gh', 'release', 'upload', tagOf(step), file, '--repo', step.repository]);
      }
    }
  }

  async published(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action !== 'publish') return;
    const old = await this.registry(step, profile, versionOf(step));
    if (old) assert.equal(old.dist.shasum, entry.shasum, '公開済み版の内容が異なります。');
    if (profile.publish.mode === 'cli') {
      if (!old && !entry.publishStartedAt) {
        entry.publishStartedAt = new Date().toISOString();
        await this.save();
        const args = ['publish', entry.artifact!, '--access=public', '--tag=next'];
        if (profile.publish.provenance) args.push('--provenance');
        await this.npm(profile, args, undefined, true);
        entry.publishAccepted = true;
        await this.save();
      }
      // An interrupted publish has an unknown outcome. Never submit the version twice.
      if (!old && entry.publishStartedAt && !entry.publishAccepted) {
        const visible = await this.wait(() => this.registry(step, profile, versionOf(step)), '中断されたnpm公開の結果確認');
        assert.equal(visible.dist.shasum, entry.shasum);
      }
    } else {
      const path = `repos/${step.repository}/actions/workflows/${profile.publish.workflow}/runs?per_page=100`;
      if (profile.publish.mode === 'dispatch-workflow' && !entry.dispatchStartedAt) {
        assert(!old, '別の公開処理が版を公開済みです。workflowを再起動せず、実行記録を確認してください。');
        const head = await this.api<{ object: { sha: string } }>(`repos/${step.repository}/git/ref/heads/${encodeURIComponent(entry.base!)}`);
        assert.equal(head.object.sha, entry.mergeCommit, '公開前にdefault branchが進みました。別ソースでworkflowを起動しません。');
        entry.dispatchHeadSha = head.object.sha;
        entry.dispatchStartedAt = new Date().toISOString();
        await this.save();
        const args = ['gh', 'workflow', 'run', profile.publish.workflow, '--repo', step.repository, '--ref', entry.base!];
        for (const [key, value] of Object.entries(profile.publish.inputs ?? {})) args.push('-f', `${key}=${value.replaceAll('{version}', versionOf(step)).replaceAll('{tag}', tagOf(step)).replaceAll('{shasum}', entry.shasum!)}`);
        await this.run(args);
      }
      const run = await this.wait(async () => {
        const runs = (await this.api<{ workflow_runs: { id: number; event: string; head_sha: string; head_branch: string; created_at: string; status: string; conclusion: string }[] }>(path)).workflow_runs;
        const matches = runs.filter(run => entry.workflowRun ? run.id === entry.workflowRun :
          profile.publish.mode === 'tag-workflow' ? run.event === 'push' && run.head_sha === entry.mergeCommit && run.head_branch === tagOf(step) :
            run.event === 'workflow_dispatch' && run.created_at >= entry.dispatchStartedAt! && run.head_branch === entry.base && run.head_sha === entry.dispatchHeadSha);
        assert(matches.length <= 1, '公開workflowが一意ではありません。自動選択を停止します。');
        if (!matches.length) return null;
        entry.workflowRun = matches[0].id;
        await this.save();
        if (matches[0].status !== 'completed') return null;
        assert.equal(matches[0].conclusion, 'success', `公開workflow失敗: ${matches[0].id}。修正・再実行後にresumeしてください。`);
        return matches[0];
      }, '公開workflow');
      entry.workflowRun = run.id;
    }
    const published = await this.wait(() => this.registry(step, profile, versionOf(step)), 'npm反映');
    assert.equal(published.dist.shasum, entry.shasum, '公開tarballが検証済み成果物と異なります。下流は実行しません。');
  }

  async complete(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void> {
    if (step.action !== 'update-only') {
      const published = await this.registry(step, profile, versionOf(step));
      assert(published && published.dist.shasum === entry.shasum, 'npm公開版のハッシュが不一致です。');
      if (profile.publish.mode !== 'cli' || profile.publish.provenance) {
        assert.equal(published.dist.attestations?.provenance?.predicateType, 'https://slsa.dev/provenance/v1', 'provenanceを確認できません。');
      }
      assert.equal(await this.tagSha(step), entry.mergeCommit, 'GitHubタグSHAが不一致です。');
      await this.sourceVersion(step, entry.mergeCommit!);
      const release = await this.api<GithubRelease>(`repos/${step.repository}/releases/tags/${tagOf(step)}`);
      assert(!release.draft && release.tag_name === tagOf(step));
      if (step.action === 'publish') {
        for (const file of [entry.artifact!, ...(entry.extraArtifacts ?? []).map(asset => asset.path)]) {
          const asset = release.assets.find(asset => asset.name === basename(file));
          assert.equal(asset?.digest, `sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`, 'GitHub Release成果物のハッシュが不一致です。');
        }
      }
      const tags = () => this.npm(profile, ['view', step.name!, 'dist-tags', '--json', '--prefer-online']).then(output => JSON.parse(output) as Record<string, string>);
      const before = await tags();
      assert([step.publishedVersion, versionOf(step)].includes(before.latest), '別のリリースがlatestを更新しました。上書きせず停止します。');
      assert(!semver.valid(before.next) || !semver.gt(before.next, versionOf(step)), 'nextが予定版より進んでいます。下げずに停止します。');
      for (const tag of ['latest', 'next']) if (before[tag] !== versionOf(step)) {
        assert(!this.config.trustedPublisherOnly, 'release.ymlでlatest/nextを同期してください。ローカルnpm dist-tagへフォールバックしません。');
        await this.npm(profile, ['dist-tag', 'add', `${step.name}@${versionOf(step)}`, tag], undefined, true);
      }
      await this.wait(async () => { const current = await tags(); return current.latest === versionOf(step) && current.next === versionOf(step) ? true : null; }, 'latest/next同期');
    }
    if (step.action !== 'none') {
      const pr = await this.api<PullRequest>(`repos/${step.repository}/pulls/${entry.pr}`);
      assert(pr.merged && pr.merge_commit_sha === entry.mergeCommit && pr.head.sha === entry.commit, 'PRのmerge/headが変わっています。');
      assert.equal(await this.git(step, 'status', '--porcelain'), '', '未コミット変更があるためcheckout/branchを保持します。');
      await this.git(step, 'fetch', 'origin', entry.base!);
      await this.git(step, 'merge-base', '--is-ancestor', entry.mergeCommit!, `origin/${entry.base}`);
      await this.git(step, 'diff', '--exit-code', entry.commit!, entry.mergeCommit!);
      await this.git(step, 'checkout', '--detach', entry.mergeCommit!);
      const local = await this.git(step, 'branch', '--list', entry.branch!);
      if (local) {
        assert.equal(await this.git(step, 'rev-parse', entry.branch!), entry.commit);
        assert(!(await this.git(step, 'worktree', 'list', '--porcelain')).includes(`branch refs/heads/${entry.branch}\n`), '別worktreeで使用中です。');
        try { await this.git(step, 'branch', '-d', entry.branch!); }
        catch (error) {
          if (!(error instanceof CommandFailure) || !error.stderr.includes('not fully merged')) throw error;
          await this.git(step, 'branch', '-D', entry.branch!);
        }
      }
      const remote = await this.git(step, 'ls-remote', '--heads', 'origin', entry.branch!);
      if (remote) {
        assert.equal(remote.split(/\s/u)[0], entry.commit, 'remote branchに未確認のcommitがあり保持します。');
        await this.git(step, 'push', 'origin', '--delete', entry.branch!);
      }
    }
  }
}
