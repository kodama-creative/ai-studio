import ts from "typescript";

import { DynamicToolSourceAnalyzer } from "./dynamic-tool-source-analyzer";

export function assertDynamicToolSource(
  source: string,
  sourceId: string
): void {
  const sourceFile = ts.createSourceFile(
    sourceId,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceId.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  let toolCount = 0;
  const visit = (node: ts.Node): void => {
    const definition = DynamicToolSourceAnalyzer.definitionObject(node);
    if (definition) {
      toolCount += 1;
      const execute = definition.properties.find(property =>
        DynamicToolSourceAnalyzer.propertyName(property) === "execute");
      if (!DynamicToolSourceAnalyzer.executeFunction(execute)) {
        throw new TypeError(
          `${sourceId}: dynamic tool execute must be an inline function`
        );
      }
      if (definition.properties.some(property =>
        DynamicToolSourceAnalyzer.propertyName(property) === "approval")) {
        throw new TypeError(
          `${sourceId}: dynamic tool approval belongs to roadmap item 19`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (toolCount === 0) {
    throw new TypeError(
      `${sourceId}: dynamic tool source must contain defineTool(...)`
    );
  }
}
