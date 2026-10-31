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
  const outside = new Map<string, PackageEdge[]>();
  for (const edge of edges) {
    const source = byRepo.get(edge.source)!;
    const target = byRepo.get(edge.target)!;
    if (source.category === target.category) continue;
    const external = source.category === category ? target : source;
    const group = outside.get(external.category) ?? [];
    group.push(edge);
    outside.set(external.category, group);
  }
  const external = [...outside].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, group]) => {
    return {
      category: id,
      incoming: group.filter((edge) => byRepo.get(edge.source)?.category !== category),
      outgoing: group.filter((edge) => byRepo.get(edge.source)?.category === category),
    };
  });
  return { primary, internal, external, edges };
}

/**
 * Groups of categories that depend on one another, directly or through other
 * categories. Every dependency kind counts, so the result is empty only when
 * no relationship diagram, with or without development dependencies, needs an
 * arrow back to a category it already points to.
 */
export function categoryCycles(packages: DashboardPackage[]): string[][] {
  const categories = [...new Set(packages.filter((pkg) => !pkg.npm?.deprecated).map((pkg) => pkg.category))].sort();
  const uses = new Map(categories.map((category) => [category, categoryRelationships(packages, category).external
    .filter((group) => group.outgoing.length).map((group) => group.category)]));
  const reachable = new Map(categories.map((category) => {
    const seen = new Set<string>();
    const pending = [...uses.get(category)!];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (!seen.has(next)) { seen.add(next); pending.push(...uses.get(next)!); }
    }
    return [category, seen];
  }));
  const cycles: string[][] = [];
  for (const category of categories) {
    if (!reachable.get(category)!.has(category) || cycles.some((cycle) => cycle.includes(category))) continue;
    cycles.push(categories.filter((other) => reachable.get(category)!.has(other) && reachable.get(other)!.has(category)));
  }
  return cycles;
}
