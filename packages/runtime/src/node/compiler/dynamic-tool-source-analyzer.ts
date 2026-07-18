import ts from "typescript";

export class DynamicToolSourceAnalyzer {
  private constructor() {}

  static definitionObject(node: ts.Node): ts.ObjectLiteralExpression | undefined {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "defineTool"
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      return node.arguments[0];
    }
    return undefined;
  }

  static executeFunction(
    property: ts.ObjectLiteralElementLike | undefined
  ): ts.FunctionLikeDeclaration | undefined {
    if (property && ts.isMethodDeclaration(property)) { return property; }
    if (
      property
      && ts.isPropertyAssignment(property)
      && (
        ts.isArrowFunction(property.initializer)
        || ts.isFunctionExpression(property.initializer)
      )
    ) {
      return property.initializer;
    }
    return undefined;
  }

  static propertyName(
    property: ts.ObjectLiteralElementLike
  ): string | null {
    if (!("name" in property) || !property.name) { return null; }
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      return property.name.text;
    }
    return null;
  }
}
