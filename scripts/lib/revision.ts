import type { RepositoryNode, RevisionStatus, TagNode } from './types.ts';
import { rest } from './github.ts';
import { errorMessage } from './errors.ts';

type Comparison = { ahead_by?: number; behind_by?: number };
type Compare = (path: string) => Promise<Comparison | null>;

/** A fork's upstream delta is independent of the upstream's historical release tags. */
async function forkRevision(owner: string, repo: string, node: RepositoryNode,
  base: Pick<RevisionStatus, 'head' | 'tag' | 'release'>, compare: Compare): Promise<RevisionStatus> {
  const parent = node.parent;
  const branch = parent?.defaultBranchRef;
  const head = branch?.target?.oid;
  const result: RevisionStatus = { ...base, state: 'fork', aheadBy: null };
  if (!parent || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parent.nameWithOwner) ||
      !branch || !head || !/^[a-f0-9]{40}$/.test(head) || !base.head) return result;
  const upstream = { repository: parent.nameWithOwner, branch: branch.name, head,
    aheadBy: null as number | null, behindBy: null as number | null };
  result.upstream = upstream;
  if (head === base.head.oid) {
    upstream.aheadBy = 0; upstream.behindBy = 0;
    return result;
  }
  try {
    const comparison = await compare(`/repos/${owner}/${repo}/compare/${head}...${base.head.oid}`);
    if (comparison && Number.isSafeInteger(comparison.ahead_by) && Number.isSafeInteger(comparison.behind_by) &&
        comparison.ahead_by! >= 0 && comparison.behind_by! >= 0) {
      upstream.aheadBy = comparison.ahead_by!; upstream.behindBy = comparison.behind_by!;
    }
  } catch {
    // An unavailable comparison must not fall back to an unrelated release tag.
  }
  return result;
}

/** The tag's commit, following annotated tags through to their target. */
function tagCommit(tagNode: TagNode | null) {
  if (!tagNode) return null;
  const target = tagNode.target ?? {};
  const commit = target.target ?? target;
  return {
    name: tagNode.name,
    oid: commit.oid ?? target.oid ?? null,
    committedDate: commit.committedDate ?? null,
  };
}

export async function revisionStatus(owner: string, repo: string, node: RepositoryNode, compare: Compare = rest): Promise<RevisionStatus> {
  const head = node.defaultBranchRef?.target ?? null;
  const tag = tagCommit(node.tags?.nodes?.[0] ?? null);

  if (!head) return { state: 'empty', head: null, tag: null, release: null, aheadBy: null };

  const release = node.latestRelease
    ? {
        tagName: node.latestRelease.tagName,
        publishedAt: node.latestRelease.publishedAt,
        url: node.latestRelease.url,
        isPrerelease: node.latestRelease.isPrerelease,
      }
    : null;

  const base = {
    head: { oid: head.oid, committedDate: head.committedDate },
    tag,
    release,
  };

  if (node.isFork) return forkRevision(owner, repo, node, base, compare);

  if (!tag?.oid) return { ...base, state: 'untagged', aheadBy: null };
  if (tag.oid === head.oid) return { ...base, state: 'released', aheadBy: 0 };

  // Only ask how far ahead the branch is once we know it is ahead at all.
  let aheadBy = null;
  try {
    const comparison = await compare(
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(tag.name)}...${head.oid}`,
    );
    aheadBy = comparison?.ahead_by ?? null;
  } catch (error) {
    console.warn(`compare failed for ${repo}: ${errorMessage(error)}`);
  }

  return { ...base, state: 'unreleased', aheadBy };
}

