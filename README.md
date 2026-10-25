# TurboWarp Plus

[**Dashboard → kubohiroya.github.io/turbowarp-plus-packages**](https://kubohiroya.github.io/turbowarp-plus-packages/)

An index of the TurboWarp Plus family: extensions, toolchains, applications and
documentation sites that add capabilities on top of
[TurboWarp](https://turbowarp.org/).

> **Unofficial.** Not affiliated with or endorsed by the TurboWarp project or the
> Scratch Foundation. These packages complement TurboWarp rather than replacing
> it.

English | [日本語](README.ja.md)

## What the dashboard shows

One row per package, grouped by category, with a column for each thing that is
easy to lose track of across sixty-odd repositories.

| Column | What it tells you |
| --- | --- |
| **Issues** / **PRs** | Open issues and pull requests on GitHub. |
| **Revision** | Whether the tip of the default branch is tagged. `released` means the newest tag is the tip; `N ahead` means that many commits have landed since the newest tag. |
| **GitHub Pages** | Whether a Pages site is configured, whether it answered when we asked, and a screenshot of its home page in the same colour scheme as the dashboard. |
| **npm** | The published version, how long ago it went out, and `⚠️ tag ≠ npm` when the newest git tag and the npm version disagree. |
| **Upstream dependencies** | Every dependency the package declares on another npm package, with the declared range. 💀 marks a range that points at a local path (`file:`, `link:`, `workspace:` …); ⚠️ marks a range that no longer covers the newest published version. |

Each package's summary follows the page language. English comes from the
GitHub repository description, falling back to the first paragraph of
`README.md`. Japanese comes from the first paragraph under the opening heading
of the repository's `README.ja.md` — badge rows and the `English | 日本語`
switcher above it are skipped, and a leading `@scope/name は、` is dropped
because the package name is already the row label. A repository with no
`README.ja.md` shows its English summary in both languages. The way to give a
package a Japanese summary is to write one in its own README, where it also
helps everyone reading the repository; `descriptionJa` in `catalog.yaml`
exists for the cases where that text does not suit a table cell.

The page is bilingual. It opens in Japanese for a browser that asks for
Japanese and in English otherwise, the switch in the top right changes it, and
the choice is remembered. Both languages are in the same HTML: switching sets
`<html lang>` and the stylesheet shows the matching phrases, so there is no
second page to keep in step and no reload. The Japanese strings for the
categories and the banner live in `catalog.yaml` beside the English ones.

Dependencies on packages in this family are always shown. Third-party
dependencies are hidden unless they are stale or local — turn on **show external
deps** to see the rest. Dev dependencies appear only when they are one of ours,
which is how the build tooling shows up as an upstream of every extension.

## Adding or moving a package

Everything hand-maintained lives in [`catalog.yaml`](catalog.yaml): the
categories and which repository belongs to which. Everything else is collected
from the APIs.

```yaml
categories:
  - id: sensing
    title: Sensing & Input
    packages:
      - turbowarp-your-new-package
```

The npm name defaults to `@kubohiroya/<repo>`. Override it with `npm:` when they
differ, or `npm: false` for a repository that is deliberately not an npm package
(a documentation site, a sample collection, a deployed application). A
repository left at the default shows as `unpublished` until it appears on npm,
which is intentional — that is a status worth seeing.

## Running it locally

Use Node.js 22 or later. The update scripts are written in TypeScript and run
through the `tsx` loader in the npm commands; no JavaScript compilation step is
needed.

```bash
npm install
npx playwright install chromium   # only needed for thumbnails and icon PNGs

npm run typecheck                 # strict type checking for scripts and tests
npm test                          # dependency range and summary extraction tests
npm run icons                     # brand assets  -> site/assets/
npm run collect                   # GitHub + npm  -> data/dashboard.json
npm run thumbnails                # screenshots   -> site/thumbs/
npm run render                    # dashboard     -> site/index.html
npm run serve                     # http://localhost:4180/
```

Each site is shot twice, under `prefers-color-scheme: light` and dark, because
the dashboard follows that preference itself: a light screenshot on a dark page
reads as a hole in the table. A site that does not implement dark mode produces
two identical images, so the dark copy is dropped and `<picture>` falls back to
the light one — only the sites that actually change get a second file.

`npm run build` does collect, thumbnails and render in order.
`npm run build:no-thumbnails` skips the slow part.

The collector needs a GitHub token: it reads `GITHUB_TOKEN`, and otherwise falls
back to `gh auth token`. Unauthenticated access is capped at 60 requests an
hour, which is not enough for a single package.

## Planning recursive releases

Preview the upstream processing order, dependency edits, version changes and publish
targets for one package using the existing analysis. The default input is
`data/dashboard.json`. If absent locally, use the JSON from the Pages workflow's
`dashboard-data` artifact, or select another snapshot with `--data`.

```bash
npm run bump -- @kubohiroya/turbowarp-title-menu
npm run bump -- turbowarp-title-menu --data /path/to/dashboard.json
npm run --silent bump -- turbowarp-title-menu --json > /tmp/release-plan.json
```

The command only prints a plan. It does not change the snapshot, repositories,
manifests or lockfiles, access the network, run Git, create tags/releases, or
publish to npm. There is no `--apply` option.

- Follow the snapshot's `family: true` prod, dev, peer and optional edges in DFS
  postorder. Visit shared upstreams once; reject cycles and missing upstreams.
- Propagate planned publications, falling back to recorded npm versions. Preserve
  exact, caret and tilde styles for ordinary dependencies, raising their minimum
  versions without downgrading. Preserve complex ranges that include the target;
  flag incompatible complex ranges and git/workspace references for review.
- Preserve compatible peer ranges. Report incompatible peers with a `null` edit
  target until compatibility is reviewed. Private and non-npm projects never
  enter the publish list.
- Propose one minor increment for commits ahead or dependency edits, starting
  from the higher of manifest and npm versions and avoiding occupied numbers.
  Reuse an already prepared unpublished version and use the current version for
  initial publication. Versioned private/non-npm projects can be `update-only`.
- Flag tag/npm mismatches, unknown ahead counts, prereleases and missing data.
  Block dependents of unresolved upstreams. `steps` includes tentative blocked
  changes; `publishTargets` includes only unblocked publication targets. Hold the
  entire plan when `ready` is false.

Plans include the analysis timestamp, SHA-256 of the reserialized JSON, and each
repository's recorded HEAD SHA. They describe the snapshot, without checking
current GitHub/npm state or compatibility. Exit codes: `0` for a completed plan,
`1` for argument/input errors, `2` for unresolved items. Future execution requires
fresh state checks, validation and approval.

## How it is published

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the whole
pipeline on every push to `main`, once a day on a schedule, and on demand, then
deploys `site/` to GitHub Pages. Nothing generated is committed: `data/`,
`site/index.html` and `site/thumbs/` are rebuilt from scratch each run.

## Brand assets

[`scripts/icons.ts`](scripts/icons.ts) is the single source for the mark, the
favicons and the social card. The mark is a hat block — the shape every
Scratch-family editor uses for the block that starts a script — carrying a plus.
It is drawn there, and takes no letterform, colour or artwork from the TurboWarp
logo or the Scratch Cat.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
