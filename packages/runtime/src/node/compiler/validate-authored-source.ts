import path from "node:path";
import ts from "typescript";

export function assertInstructionSourceImports(
  source: string,
  filePath: string,
  options: { entryPaths: readonly string[]; stateRoot: string; }
): void {
  const role = options.entryPaths.includes(filePath)
    ? "entry"
    : _isWithin(options.stateRoot, filePath)
      ? "state"
      : null;
  if (!role) {
    throw new TypeError(_instructionImportError());
  }
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    _scriptKind(filePath)
  );
  _visit(sourceFile, node => {
    if (
      ts.isMetaProperty(node)
      && node.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      throw new TypeError(
        "Instruction code cannot access import.meta runtime loading"
      );
    }
    if (
      ts.isIdentifier(node)
      && FORBIDDEN_INSTRUCTION_GLOBALS.has(node.text)
      && !_isPropertyName(node)
    ) {
      throw new TypeError(
        `Instruction code cannot access Host authority through ${node.text}`
      );
    }
    if (
      ts.isCallExpression(node)
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
    ) {
      throw new TypeError(
        "Instruction entries cannot load modules dynamically at runtime"
      );
    }
    const specifier = ts.isImportDeclaration(node)
      || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        ? node.moduleReference.expression
        : undefined;
    if (!specifier || !ts.isStringLiteralLike(specifier)) { return; }
    if (
      role === "entry"
      && specifier.text === "@llm-space/runtime/instructions"
    ) {
      return;
    }
    if (
      role === "state"
      && (
        specifier.text === "@llm-space/runtime/state"
        || specifier.text === "typebox"
      )
    ) {
      return;
    }
    if (
      specifier.text.startsWith(".")
      && _isWithin(
        options.stateRoot,
        path.resolve(path.dirname(filePath), specifier.text)
      )
    ) {
      return;
    }
    throw new TypeError(_instructionImportError());
  });
}

const FORBIDDEN_INSTRUCTION_GLOBALS = new Set([
  "Bun",
  "Deno",
  "Function",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "eval",
  "fetch",
  "global",
  "globalThis",
  "module",
  "process",
  "require"
]);

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

function _isPropertyName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
    || (ts.isPropertyAssignment(parent) && parent.name === identifier)
    || (ts.isMethodDeclaration(parent) && parent.name === identifier)
    || (ts.isPropertyDeclaration(parent) && parent.name === identifier)
  );
}

function _instructionImportError(): string {
  return "Instruction entries may import only @llm-space/runtime/instructions and static files under agent/state; state files may import only relative state files, @llm-space/runtime/state, and typebox";
}

function _isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
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
