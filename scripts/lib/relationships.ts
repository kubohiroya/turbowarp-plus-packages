import type { BuildDependency, DashboardPackage } from './types.ts';

export interface PackageEdge {
  source: string;
  target: string;
  kinds: string[];
  build?: BuildDependency;
}

/** Resolve only declared edges between known, current catalog packages. */
export function categoryRelationships(packages: DashboardPackage[], category: string, { includeDev = true } = {}) {
  const current = packages.filter((pkg) => !pkg.npm?.deprecated);
  const primary = current.filter((pkg) => pkg.category === category);
  const names = new Map<string, DashboardPackage>();
  for (const pkg of current) {
    for (const name of [pkg.manifest?.name, pkg.npm?.name]) {
      if (name) names.set(name, pkg);
    }
  }
  const pairs = new Map<string, PackageEdge>();
  for (const pkg of current) {
    for (const dependency of pkg.dependencies ?? []) {
      if (dependency.kind === 'dev' && !includeDev) continue;
      const target = names.get(dependency.name);
      if (!target || (pkg.category !== category && target.category !== category)) continue;
      const key = JSON.stringify([pkg.repo, target.repo]);
      const edge = pairs.get(key) ?? { source: pkg.repo, target: target.repo, kinds: [] };
      if (!edge.kinds.includes(dependency.kind)) edge.kinds.push(dependency.kind);
      pairs.set(key, edge);
    }
    for (const dependency of pkg.buildDependencies ?? []) {
      const target = current.find((candidate) => candidate.repo === dependency.repo);
      if (!target || (pkg.category !== category && target.category !== category)) continue;
      const key = JSON.stringify([pkg.repo, target.repo]);
      const edge = pairs.get(key) ?? { source: pkg.repo, target: target.repo, kinds: [] };
      if (!edge.kinds.includes('build')) edge.kinds.push('build');
      edge.build = dependency;
      pairs.set(key, edge);
    }
  }
  const byRepo = new Map(current.map((pkg) => [pkg.repo, pkg]));
  const edges = [...pairs.values()].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
  const internal = edges.filter((edge) =>
    byRepo.get(edge.source)?.category === category && byRepo.get(edge.target)?.category === category);
  const outside = new Map<string, { packages: Map<string, DashboardPackage>; edges: PackageEdge[] }>();
  for (const edge of edges) {
    const source = byRepo.get(edge.source)!;
    const target = byRepo.get(edge.target)!;
    if (source.category === target.category) continue;
    const external = source.category === category ? target : source;
    const group = outside.get(external.category) ?? { packages: new Map<string, DashboardPackage>(), edges: [] as PackageEdge[] };
    group.packages.set(external.repo, external);
    group.edges.push(edge);
    outside.set(external.category, group);
  }
  const external = [...outside].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, group]) => {
    // Highest number of distinct cross-boundary package pairs; repo name breaks ties.
    const candidates = [...group.packages.values()].sort((a, b) => {
      const score = (repo: string) => group.edges.filter((edge) => edge.source === repo || edge.target === repo).length;
      return score(b.repo) - score(a.repo) || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0);
    });
    return {
      category: id,
      representative: candidates[0]!,
      packages: candidates,
      incoming: group.edges.filter((edge) => byRepo.get(edge.source)?.category !== category),
      outgoing: group.edges.filter((edge) => byRepo.get(edge.source)?.category === category),
    };
  });
  return { primary, internal, external, edges };
}
