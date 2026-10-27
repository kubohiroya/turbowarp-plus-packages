import ts from 'typescript';
import type { UnsandboxedRequirement } from './types.ts';

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return node;
}

function property(object: ts.ObjectLiteralExpression, name: string): { value?: ts.Expression } | undefined {
  for (const member of [...object.properties].reverse()) {
    // A later spread may override an earlier declaration; do not guess its value.
    if (ts.isSpreadAssignment(member) || (member.name && ts.isComputedPropertyName(member.name))) return {};
    if (!member.name || (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) ||
        member.name.text !== name) continue;
    return ts.isPropertyAssignment(member) ? { value: member.initializer } : {};
  }
  return undefined;
}

function requirement(expression?: ts.Expression): UnsandboxedRequirement {
  if (!expression) return 'unknown';
  const value = unwrap(expression);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return 'required';
  if (value.kind === ts.SyntaxKind.FalseKeyword) return 'not-needed';
  if (ts.isStringLiteral(value) && ['required', 'optional', 'not-needed'].includes(value.text)) {
    return value.text as UnsandboxedRequirement;
  }
  return 'unknown';
}

/** Read declarations without executing repository code; absence never means permission is unnecessary. */
export function extensionUnsandboxed(
  configText: string | null | undefined,
  viteText: string | null | undefined,
): UnsandboxedRequirement | undefined {
  let config: ts.ObjectLiteralExpression | undefined;
  let options: ts.ObjectLiteralExpression | undefined;
  const parse = (text: string) => ts.createSourceFile('config.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (configText) {
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'extensionConfig' && node.initializer) {
        const value = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(value)) config = value;
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(configText));
  }
  if (viteText) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'turboWarpExtension' && node.arguments[0]) {
        const value = unwrap(node.arguments[0]);
        if (ts.isObjectLiteralExpression(value)) options = value;
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(viteText));
  }
  if (!config && !options) return undefined;
  const override = options && property(options, 'unsandboxed');
  if (override) {
    if (!override.value) return 'unknown';
    const value = unwrap(override.value);
    if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) &&
        value.expression.text === 'extensionConfig' && value.name.text === 'unsandboxed') {
      const declared = config && property(config, 'unsandboxed');
      return requirement(declared?.value);
    }
    return requirement(value);
  }
  const declared = config && property(config, 'unsandboxed');
  return requirement(declared?.value);
}
