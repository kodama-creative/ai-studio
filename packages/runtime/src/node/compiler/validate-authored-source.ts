import ts from "typescript";

export function assertNoDuplicateObjectLiteralKeys(
  source: string,
  filePath: string
): void {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    _scriptKind(filePath)
  );
  _visit(sourceFile, node => {
    if (!ts.isObjectLiteralExpression(node)) { return; }
    const names = new Set<string>();
    for (const property of node.properties) {
      const name = _propertyName(property.name);
      if (!name) { continue; }
      if (names.has(name)) {
        throw new TypeError(`Duplicate authored object key: ${name}`);
      }
      names.add(name);
    }
  });
}

export function assertNoNonLiteralRuntimeImports(
  source: string,
  filePath: string
): void {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    _scriptKind(filePath)
  );
  _visit(sourceFile, node => {
    if (!ts.isCallExpression(node)) { return; }
    const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const dynamicRequire = ts.isIdentifier(node.expression)
      && node.expression.text === "require";
    if (!dynamicImport && !dynamicRequire) { return; }
    const specifier = node.arguments[0];
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      throw new TypeError(
        `Agent deployment source uses a non-literal runtime import: ${filePath}`
      );
    }
  });
}

function _propertyName(
  name: ts.PropertyName | undefined
): string | undefined {
  if (!name || ts.isComputedPropertyName(name) || ts.isPrivateIdentifier(name)) {
    return undefined;
  }
  return name.text;
}

function _scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) { return ts.ScriptKind.TSX; }
  if (filePath.endsWith(".jsx")) { return ts.ScriptKind.JSX; }
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function _visit(root: ts.Node, visit: (node: ts.Node) => void): void {
  const walk = (node: ts.Node) => {
    visit(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}
