# TurboWarp Plus

Release execution: [dry-run, dependency-ordered updates and publication](docs/release-executor.md).

Runnable samples: [distribution standard and demo plans for all extensions (Japanese)](docs/sample-projects/plan.ja.md).

Data & Documents: [projecting internal structure for iteration and document trees, a design proposal (Japanese)](docs/data-projection.ja.md).

Editor architecture: [structure, responsibilities and license split of TurboWarp-Plus-Editor (Japanese)](docs/editor-architecture.ja.md).

[**Dashboard → kubohiroya.github.io/turbowarp-plus-packages**](https://kubohiroya.github.io/turbowarp-plus-packages/)

An index of the TurboWarp Plus family: extensions, toolchains, applications and
documentation sites that add capabilities on top of
[TurboWarp](https://turbowarp.org/).

> **Unofficial.** Not affiliated with or endorsed by the TurboWarp project or the
> Scratch Foundation. These packages complement TurboWarp rather than replacing
> it.

English | [日本語](README.ja.md)

## What the dashboard shows

The dashboard displays the **Package list** only, with summary cards, search,
status filters and the third-party dependency toggle. There is no tab-style view
switch. A graph icon immediately to the right of each category heading opens that
category's package relationships in a modal dialog. List filters and scroll
position remain unchanged; the graph includes the entire category regardless of
list filters. Close with the visible button, Escape or a click on the backdrop to return to the invoking
icon. The dialog keeps keyboard focus inside it while open.

Arrows point from dependent to dependency. The diagram shows production, peer,
optional and verified fixed-GUI build relations as solid blue arrows, and development
dependencies as thin dashed arrows; clearing the checkbox hides the development
dependencies. The fixed-GUI adapter reads site/source.json,
checks the readPins/verifyHost/buildPages contract without executing source, and
verifies the pinned commit. Its pinned GUI SHA is kept separate from collected HEAD.
Missing or unsupported metadata is reported as an error and produces no guessed edge.
Arrows inside the category show actual internal edges. Translucent boxes on either side show only
the connected category names: categories that use central packages on the left and
categories they use on the right, so every arrow points left to right. Categories
must not depend on each other in a cycle; if collected data contains one anyway, the
categories involved appear on both sides and the list and their dialogs show a warning.
Arrows from and to these boxes connect each outside category to the
actual central package, with distinct-pair counts per category, central package and
direction, counting development-only pairs separately. Hovering a count lists the
package pairs it summarizes; hovering a box highlights it and its arrows in red.
In the Extension Contracts diagram, `turbowarp-extension-data-editor` is labelled
“Data editing contract / API” so extensions' contract dependencies are visible.
The dependencies between central packages are preserved.
Expand the details for every actual edge and kind.
The graph scrolls horizontally on narrow screens. Dependencies on family packages
missing from the catalog are listed explicitly in the details instead of assigning
them an invented category. The dialog puts its diagram first; exact relationships
and source information are optional sections below it. The acquisition time stays
visible, with a warning for old, incomplete or catalog-mismatched snapshots.

One row per package, grouped by category, with columns for the things that are
easy to lose track of across sixty-odd repositories.

| Column | What it tells you |
| --- | --- |
| **Package** | An extension's sandbox requirement appears below its name: 🔓 without sandbox required, ◐ optional, 🛡 not needed, ? unknown. |
| **Demo** | The compact **Demo** button with a play icon opens the package's published SB3 in a new tab. A dash means no downloadable demo was found. |
| **Issues** / **PRs** | Open issues and pull requests on GitHub. |
| **Revision** | Whether the tip of the default branch is tagged. `released` means the newest tag is the tip; `N ahead` means that many commits have landed since the newest tag. |
| **GitHub Pages** | Whether a Pages site is configured, whether it answered when we asked, and a screenshot of its home page in the same colour scheme as the dashboard. |
| **npm** | The published version, how long ago it went out, and `⚠️ tag ≠ npm` when the newest git tag and the npm version disagree. |
| **Upstream dependencies** | Every dependency the package declares on another npm package, with the declared range. 💀 marks a range that points at a local path (`file:`, `link:`, `workspace:` …); ⚠️ marks a range that no longer covers the newest published version. |

Sandbox requirements are collected from the default branch. An explicit
`unsandboxed` option in `vite.config.ts`'s `turboWarpExtension(...)` takes priority;
otherwise the collector reads `src/config.ts`'s `extensionConfig.unsandboxed`.
`required` / `true` means required, `optional` means optional, and
`not-needed` / `false` means not needed. Missing or dynamic declarations in an
identified extension are unknown. These are declarations, not runtime compatibility
test results. Applications and extensions show required if any direct or transitive
catalog dependency declares it, even if their own declaration is optional,
not needed or unknown. All family dependency kinds of apps, including development
dependencies, are traversed because apps can bundle those extensions into SB3s.
For intermediate packages outside the apps category, only production, peer and
optional dependencies are followed; their development dependencies are not shipped.
The declaring repositories appear in the badge's tooltip and the collected
`unsandboxedRequiredBy` field. The extension's own declaration stays unchanged;
absence of an inherited requirement does not imply that an app needs no permissions.
Packages without a declaration or inherited requirement and older JSON snapshots
without these fields have no badge. Changes appear on the next collection.
The collector parses TypeScript syntax without executing repository code.

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

The compact demo button shows a play icon and **Demo**, with **Open demo in TurboWarp-Plus-Editor**
as its hover tooltip; the label and tooltip follow the selected language.
This action opens a sample project demonstrating the package.
It follows the page palette, including hover and keyboard focus.
The default theme follows the OS (auto); set `<html data-theme="light">` or
`dark` to pin it, and use `auto` or remove the attribute to follow the OS again.

Demo discovery reads each repository's `samples/manifest.json` (`samples` entries
with a `name` and optional `title`) and checks `samples/<name>.sb3` on its GitHub
Pages site. Only downloadable ZIP files with public CORS access get a
**Demo** button with a play icon;
the first available sample is used. Changes appear on the next collection run.
The Editor URL is `site.demoEditorUrl` in `catalog.yaml`, and `project_url` points
to the published SB3. The default destination is
[TurboWarp-Plus-Editor](https://kubohiroya.github.io/turbowarp-plus-editor/).
Custom extension permission prompts still apply.

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

Categories must not depend on each other in a cycle, counting development
dependencies too: if any package in category A uses category B, no package in B
may use A, directly or through other categories. Move the lower-level package, or
split it into a category of its own, instead. The criteria in `catalog.yaml`
explain the current split, and the dashboard warns when collected data contains a
cycle.

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
npm run editor:catalog            # published npm -> site/extensions-v1.json
npm run thumbnails                # screenshots   -> site/thumbs/
npm run render                    # dashboard     -> site/index.html
npm run serve                     # http://localhost:4180/
```

Each site is shot twice, under `prefers-color-scheme: light` and dark, because
the dashboard follows that preference itself: a light screenshot on a dark page
reads as a hole in the table. A site that does not implement dark mode produces
two identical images, so the dark copy is dropped and `<picture>` falls back to
the light one — only the sites that actually change get a second file.

`npm run build` does collect, editor:catalog, thumbnails and render in order.
The Editor catalog contains version-pinned extension URLs and extension-ID dependencies;
see the [JSON contract and generation rules](docs/editor-extension-catalog.md).
`npm run build:no-thumbnails` skips the slow part.

Thumbnails reuse snapshots in `site/thumbs/` until package versions, Git tags, or npm dist-tags change.
Private packages, sites excluded from npm publication, and sites without version metadata also track HEAD,
so Docs changes are captured even without a version bump. New sites, changed URLs, or missing images are captured;
failed refreshes keep the previous image and retry next time. GitHub Actions caches the snapshots between runs.
A missing or legacy cache triggers a full capture.

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
  leave unsupported complex ranges, workspace references and aliases blocked.
- Preserve compatible peer ranges. For excluded versions, preserve exact/caret/tilde
  styles, or extend a complex peer range with `|| <target>`. These are proposals;
  peer compatibility remains unverified. A Git URL identifying the recorded family
  GitHub repository can be replaced with an exact npm version when that package
  is already published. Git/npm content equivalence remains unverified. Both
  proposals carry `requiresReview: true` warnings. Private and non-npm projects
  never enter the publish list.
- Propose one minor increment for commits ahead or dependency edits, starting
  from the higher of manifest and npm versions and avoiding occupied numbers.
  Reuse an already prepared unpublished version and use the current version for
  initial publication. RC/prerelease versions reuse a prepared version or increment
  within the same prerelease series, skipping occupied versions. They never
  implicitly become stable versions; the release channel needs review. Versioned
  private/non-npm projects can be `update-only`.
- Each step's `sourceChanges` is `none` (baseline tag equals HEAD), `ahead`
  (ahead of the tag matching the npm version), or `unknown`. Missing/mismatched
  tags and unknown ahead counts produce warnings without triggering a minor bump
  themselves. Recorded published versions remain usable for dependency edits;
  known edits and prepared versions can still justify publication plans.
  Unknown does not mean that source changes were ruled out.
- Missing data, collection errors, invalid versions, unsupported ranges and cycles
  still stop planning. `steps` includes tentative blocked changes; `publishTargets`
  includes unblocked publication proposals, including those needing review.
  `ready` means the plan has concrete decisions without blockers. `applyReady`
  additionally requires no `requiresReview` warnings. Peer, Git and prerelease
  proposals can complete planning while keeping local automatic apply disabled.
  A true `ready` value does not confirm compatibility or every repository's release
  needs: inspect warnings and `sourceChanges` as well.

Plans include the analysis timestamp, SHA-256 of the reserialized JSON, and each
repository's recorded HEAD SHA. They describe the snapshot, without checking
current GitHub/npm state or compatibility. Exit codes: `0` for a completed plan,
`1` for argument/input errors, `2` for unresolved items. Future execution requires
fresh state checks, validation and approval.

## Bumping downstream dependents

Select an upstream package to plan updates for all its direct and transitive
dependents in dependency order, including development dependencies used to build
extensions.

```bash
# Preview using the existing data/dashboard.json
npm run bump:downstream -- vite-plugin-turbowarp-extension
npm run --silent bump:downstream -- @kubohiroya/vite-plugin-turbowarp-extension --json

# Apply to independent checkouts at <parent>/<repo>
npm run bump:downstream -- vite-plugin-turbowarp-extension \
  --data /path/to/dashboard.json --apply --repos-dir /path/to/checkouts
```

- Include the selected package and its consumers; process each once, upstream
  first. All potential consumers must be present in the snapshot, with dependency
  lists. Repositories absent from the snapshot cannot be discovered.
- Use the root's published version or reuse a prepared unpublished version.
  Dependency edits and minor increments follow the same rules as `bump`.
  Already updated consumers do not get another bump; compatible peers and broad
  ranges remain unchanged.
- Other upstreams supply recorded publications and collection status only.
  Their unpublished changes, prepared versions and stale declarations outside
  the selected scope do not trigger bumps.
- `--apply` defaults to off and requires `--repos-dir`. Check every selected
  checkout's HEAD SHA, clean working tree, manifest name/version and dependency
  edit sources before writing. Stale SHAs, dirty/untracked files, missing checkouts
  and blocked or review-required plans prevent the entire application. Even an unchanged root needs
  a checkout.
- Only manifest dependency declarations and versions change. Update lockfiles,
  rebuild, validate, commit, push, tag and publish separately. An unpublished
  planned upstream version may need publishing before a downstream lockfile can
  be generated.
- A later write failure restores earlier writes when possible. Concurrent edits
  or recovery errors report the affected paths. To undo a successful application,
  inspect the reported files' diffs and restore those files from Git.

Plan JSON includes `direction: "downstream"`; successful application returns
`{ "mode": "apply", "plan": ..., "files": [...] }`. Exit codes are `0` for success,
`1` for argument/input/application errors and `2` for unresolved plan items or
review-required proposals when `--apply` is requested. Planning alone still
succeeds with exit code `0` when `ready: true` and `applyReady: false`.
Review snapshot warnings and actual compatibility before applying.

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
