import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Test-only TypeScript-AST helpers for the static P3.9 audits (catalogue literals, accessibility props, touch targets,
 * layout rules). They parse source; they never execute React Native code.
 */
export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

export const relToSrc = (file: string): string => relative(SRC, file).split(sep).join('/');

function productionFiles(extension: RegExp, dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(join(SRC, dir), { recursive: true, encoding: 'utf8' })
      .filter((f) => extension.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => join(SRC, dir, f)),
  );
}

/** Production `.tsx` component files under the given `src/` sub-directories (tests excluded). */
export function componentFiles(...dirs: readonly string[]): string[] {
  return productionFiles(/\.tsx$/, dirs);
}

/** Production `.ts` modules under the given `src/` sub-directories (tests excluded). */
export function moduleFiles(...dirs: readonly string[]): string[] {
  return productionFiles(/\.ts$/, dirs);
}

export function parseTsx(fileName: string, code: string = readFileSync(fileName, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

const tagName = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string => node.tagName.getText();

export function jsxAttribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}

/** All opening/self-closing JSX elements with the given tag name. */
export function elementsNamed(source: ts.SourceFile, name: string): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  walk(source, (n) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && tagName(n) === name) found.push(n);
  });
  return found;
}

/** The `StyleSheet.create({...})` entries of a file: style name → its object literal. */
export function styleSheet(source: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const styles = new Map<string, ts.ObjectLiteralExpression>();
  walk(source, (n) => {
    if (!ts.isCallExpression(n) || n.expression.getText() !== 'StyleSheet.create') return;
    const arg = n.arguments[0];
    if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return;
    for (const p of arg.properties) if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) styles.set(p.name.getText(), p.initializer);
  });
  return styles;
}

export function styleProperty(style: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of style.properties) if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
  return undefined;
}

/** `styles.x` names referenced anywhere inside a node (a style attribute expression). */
export function referencedStyles(node: ts.Node): string[] {
  const names: string[] = [];
  walk(node, (n) => {
    if (ts.isPropertyAccessExpression(n) && n.expression.getText() === 'styles') names.push(n.name.getText());
  });
  return names;
}
