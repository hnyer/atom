'use strict'

const fs = require('fs')
const path = require('path')
const recast = require('recast')
const b = recast.types.builders
const CONFIG = require('../config')

module.exports = function () {
  // const filePath = path.join(CONFIG.intermediateAppPath, 'src', 'atom-environment.js')
  const filePath = path.join(CONFIG.intermediateAppPath, 'src', 'buffered-process.js')
  const fileContents = fs.readFileSync(filePath, 'utf8')
  const ast = recast.parse(fileContents)
  const programHasClosureWrapper =
    ast.program.body.length === 1 &&
    ast.program.body[0].type === 'ExpressionStatement' &&
    ast.program.body[0].expression.type === 'CallExpression' &&
    ast.program.body[0].expression.arguments[0].type === 'ThisExpression' &&
    ast.program.body[0].expression.callee.object.type === 'FunctionExpression'

  const variablesWithRequireAssignment = replaceRequireAssignmentsWithLazyFunctions(ast)


  // console.log(variablesWithRequireAssignment);
  console.log(recast.print(ast).code);
}

function replaceRequireAssignmentsWithLazyFunctions (ast) {
  const variablesWithRequireAssignment = new Set()
  recast.types.visit(ast, {
    visitCallExpression: function (path) {
      const node = path.node
      if (node.callee.name === 'require' && node.arguments.length === 1 && node.arguments[0].type === 'Literal' && this.isTopLevelPath(path)) {
        let parentPath = path.parent
        while (parentPath != null) {
          const parentNode = parentPath.node
          if (parentNode.type === 'AssignmentExpression') {
            variablesWithRequireAssignment.add(parentNode.left.name)
            parentPath.replace(b.functionDeclaration(b.identifier(`get_${parentNode.left.name}`), [], b.blockStatement([
              b.returnStatement(
                b.assignmentExpression('=', parentNode.left, b.logicalExpression('||', parentNode.left, parentNode.right))
              )
            ])))
            break
          } else if (parentNode.type === 'VariableDeclarator') {
            const variableDeclarationPath = parentPath.parent
            const variableDeclarationNode = variableDeclarationPath.node
            if (variableDeclarationNode.kind === 'const') {
              variableDeclarationNode.kind = 'let'
            }
            variablesWithRequireAssignment.add(parentNode.id.name)
            parentPath.replace(b.variableDeclarator(parentNode.id, null))
            variableDeclarationPath.insertAfter(b.functionDeclaration(b.identifier(`get_${parentNode.id.name}`), [], b.blockStatement([
              b.returnStatement(
                b.assignmentExpression('=', parentNode.id, b.logicalExpression('||', parentNode.id, parentNode.init))
              )
            ])))
            break
          }
          parentPath = parentPath.parent
        }
      }
      this.traverse(path);
    },
    isTopLevelPath: function (path) {
      return path.scope.isGlobal || (programHasClosureWrapper && path.scope.depth === 1)
    }
  })
  return variablesWithRequireAssignment
}
