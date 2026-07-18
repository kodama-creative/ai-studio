import ts from "typescript";

import { DynamicToolSourceAnalyzer } from "./dynamic-tool-source-analyzer";

export const DYNAMIC_TOOL_STEPS_EXPORT = "__llmSpaceDynamicToolSteps";

interface DynamicToolTransform {
  readonly captures: readonly string[];
  readonly executeText: string;
  readonly insertAt: number;
  readonly prefix: string;
  readonly stepId: string;
}

export function transformDynamicToolSource(
  source: string,
  sourceId: string
): string {
  if (!source.includes("defineTool")) { return source; }
  const sourceFile = ts.createSourceFile(
    sourceId,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceId.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const transforms: DynamicToolTransform[] = [];
  let stepIndex = 0;
  const visit = (node: ts.Node): void => {
    const object = DynamicToolSourceAnalyzer.definitionObject(node);
    if (object) {
      const execute = object.properties.find(property =>
        DynamicToolSourceAnalyzer.propertyName(property) === "execute");
      const executeFunction = DynamicToolSourceAnalyzer.executeFunction(
        execute
      );
      if (execute && executeFunction) {
        const stepId = `dynamic-tool:${sourceId}:${stepIndex}`;
        stepIndex += 1;
        transforms.push({
          captures: _capturedNames(executeFunction),
          executeText: _functionText(execute, executeFunction, source),
          insertAt: object.getEnd() - 1,
          prefix: object.properties.length > 0 ? "," : "",
          stepId
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (transforms.length === 0) { return source; }

  let transformed = source;
  for (const item of [...transforms].sort((left, right) =>
    right.insertAt - left.insertAt)) {
    const closureVariables = item.captures.join(",");
    const metadata = `${item.prefix}__llmSpaceDynamicTool:{stepId:${JSON.stringify(
      item.stepId
    )},closureVariables:{${closureVariables}}}`;
    transformed = `${transformed.slice(0, item.insertAt)}${metadata}${
      transformed.slice(item.insertAt)
    }`;
  }

  const registrations = transforms.map(item => {
    const captureBinding = item.captures.length > 0
      ? `const {${item.captures.join(",")}}=__closureVariables;`
      : "";
    return `${DYNAMIC_TOOL_STEPS_EXPORT}[${JSON.stringify(item.stepId)}]=`
      + `(__closureVariables,...__args)=>{${captureBinding}`
      + `return (${item.executeText})(...__args);};`;
  }).join("\n");
  return `${transformed}\n`
    + `const ${DYNAMIC_TOOL_STEPS_EXPORT}=Object.create(null);\n`
    + `${registrations}\n`
    + `export {${DYNAMIC_TOOL_STEPS_EXPORT}};\n`;
}

function _capturedNames(execute: ts.FunctionLikeDeclaration): string[] {
  const available = new Set<string>();
  let ancestor = execute.parent;
  while (ancestor) {
    if (ts.isFunctionLike(ancestor)) {
      for (const parameter of ancestor.parameters) {
        _bindingNames(parameter.name, available);
      }
      if ("body" in ancestor && ancestor.body) {
        _collectFunctionLocals(ancestor.body, available);
      }
    }
    ancestor = ancestor.parent;
  }
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && available.has(node.text)) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  if (execute.body) { visit(execute.body); }
  return [...used].sort(_compareCodePoint);
}

function _collectFunctionLocals(node: ts.Node, target: Set<string>): void {
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionDeclaration(child)) {
      if (child.name) { target.add(child.name.text); }
      return;
    }
    if (ts.isFunctionLike(child)) { return; }
    if (ts.isClassDeclaration(child) && child.name) {
      target.add(child.name.text);
      return;
    }
    if (ts.isVariableDeclaration(child)) {
      _bindingNames(child.name, target);
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
}

function _bindingNames(name: ts.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      _bindingNames(element.name, target);
    }
  }
}

function _functionText(
  property: ts.ObjectLiteralElementLike,
  execute: ts.FunctionLikeDeclaration,
  source: string
): string {
  if (ts.isMethodDeclaration(property)) {
    const asyncPrefix = property.modifiers?.some(
      modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword
    ) ? "async " : "";
    const generator = property.asteriskToken ? "*" : "";
    const parameters = property.parameters.map(parameter =>
      source.slice(parameter.getStart(), parameter.getEnd())).join(",");
    const body = property.body
      ? source.slice(property.body.getStart(), property.body.getEnd())
      : "{}";
    return `${asyncPrefix}function${generator}(${parameters})${body}`;
  }
  return source.slice(execute.getStart(), execute.getEnd());
}

function _compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
