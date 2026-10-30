import ts from 'typescript';
import type { BuildDependency } from './types.ts';

const SHA = /^[a-f0-9]{40}$/;

/** Narrow, fail-closed adapter for the Editor's verified fixed-GUI contract.
 * Source text is parsed, never imported or executed. An arbitrary repository
 * name in JSON is insufficient evidence of a build dependency.
 */
export function fixedEditorBuildDependency(input: {
  sourceRevision: string | null;
  sourceJson: string | null | undefined;
  contract: string | null | undefined;
  build: string | null | undefined;
  owner: string;
  catalogRepos: readonly string[];
}): { dependencies: BuildDependency[]; error?: string } {
  const fail = (message: string) => ({ dependencies: [], error: `fixed-editor-gui: ${message}` });
  if (!input.sourceJson || !input.contract || !input.build) return fail('source metadata or build contract is missing');
  if (!input.sourceRevision || !SHA.test(input.sourceRevision)) return fail('source revision is unverified');
  let pins: { guiRepository?: unknown; guiRevision?: unknown };
  try { pins = JSON.parse(input.sourceJson); } catch { return fail('source metadata is not valid JSON'); }
  if (typeof pins?.guiRepository !== 'string' || typeof pins.guiRevision !== 'string' || !SHA.test(pins.guiRevision)) {
    return fail('GUI repository or fixed revision is invalid');
  }
  const [owner, repo, extra] = pins.guiRepository.split('/');
  if (owner !== input.owner || !repo || extra || !input.catalogRepos.includes(repo)) return fail('GUI repository is outside the known catalog');

  const contract = ts.createSourceFile('source.mjs', input.contract, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const build = ts.createSourceFile('build.mjs', input.build, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if ([input.contract, input.build].some((source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
  }).diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error))) {
    return fail('build contract has unsupported syntax');
  }
  const fn = (file: ts.SourceFile, name: string) => file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const calls = (root: ts.Node | undefined, predicate: (call: ts.CallExpression) => boolean) => {
    let found = false;
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && predicate(node)) found = true; ts.forEachChild(node, visit); };
    if (root) visit(root);
    return found;
  };
  const text = (node: ts.Node | undefined, file: ts.SourceFile) => node?.getText(file).replace(/\s+/g, '');
  const literal = (node: ts.Node | undefined, value: string) => Boolean(node && ts.isStringLiteral(node) && node.text === value);
  const validate = fn(contract, 'validatePins');
  const read = fn(contract, 'readPins');
  const verify = fn(contract, 'verifyHost');
  const buildPages = fn(build, 'buildPages');
  let revisionInitializer: ts.Expression | undefined;
  const findRevision = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'revision') revisionInitializer = node.initializer;
    ts.forEachChild(node, findRevision);
  };
  if (verify) findRevision(verify);
  const schemaVerified = calls(validate, (call) => text(call.expression, contract) === 'assert.equal'
    && text(call.arguments[0], contract) === 'pins.guiRepository' && literal(call.arguments[1], pins.guiRepository as string));
  const readsPins = calls(read, (call) => text(call.expression, contract) === 'validatePins')
    && calls(read, (call) => text(call.expression, contract) === 'path.join'
      && text(call.arguments[0], contract) === 'root' && literal(call.arguments[1], 'site/source.json'));
  const readsHead = calls(revisionInitializer, (call) => text(call.expression, contract) === 'execFileSync'
    && literal(call.arguments[0], 'git') && Boolean(call.arguments[1] && ts.isArrayLiteralExpression(call.arguments[1])
      && literal(call.arguments[1].elements[0], 'rev-parse') && literal(call.arguments[1].elements[1], 'HEAD'))
    && text(call.arguments[2], contract)?.includes('cwd:gui') === true);
  const verifiesHead = calls(verify, (call) => text(call.expression, contract) === 'assert.equal'
    && text(call.arguments[0], contract) === 'revision' && text(call.arguments[1], contract) === 'pins.guiRevision');
  const importsContract = build.statements.some((node) => ts.isImportDeclaration(node)
    && literal(node.moduleSpecifier, './source.mjs') && text(node.importClause, build)?.includes('readPins') && text(node.importClause, build)?.includes('verifyHost'));
  const callsContract = calls(buildPages, (call) => text(call.expression, build) === 'readPins')
    && calls(buildPages, (call) => text(call.expression, build) === 'verifyHost'
      && text(call.arguments[0], build) === 'gui' && text(call.arguments[1], build) === 'pins');
  const buildsGui = calls(buildPages, (call) => text(call.expression, build) === 'spawnSync'
    && text(call.arguments[2], build)?.includes('cwd:gui') === true)
    && calls(buildPages, (call) => text(call.expression, build) === 'path.join'
      && text(call.arguments[0], build) === 'gui' && literal(call.arguments[1], 'node_modules/webpack/bin/webpack.js'));
  if (![schemaVerified, readsPins, readsHead, verifiesHead, importsContract, callsContract, buildsGui].every(Boolean)) {
    return fail('unsupported build contract; no dependency was inferred');
  }
  return { dependencies: [{ repo, revision: pins.guiRevision, sourceRevision: input.sourceRevision,
    sourcePath: 'site/source.json', contractPaths: ['scripts/site/source.mjs', 'scripts/site/build.mjs'] }] };
}
