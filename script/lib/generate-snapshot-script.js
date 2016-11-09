'use strict'

const fs = require('fs')
const path = require('path')
const recast = require('recast')
const b = recast.types.builders
const CONFIG = require('../config')

module.exports = function () {
  const modulesUnsupportedByMkSnapshot = new Set([
    'child_process',
    'crypto',
    'electron',
    'fs',
    'path'
  ])
  const filePath = path.join(CONFIG.intermediateAppPath, 'src', 'atom-environment.js')
  // const filePath = path.join(CONFIG.intermediateAppPath, 'src', 'buffered-process.js')
  const fileContents = fs.readFileSync(filePath, 'utf8')
  const ast = recast.parse(fileContents)
  const programHasClosureWrapper =
    ast.program.body.length === 1 &&
    ast.program.body[0].type === 'ExpressionStatement' &&
    ast.program.body[0].expression.type === 'CallExpression' &&
    ast.program.body[0].expression.arguments[0].type === 'ThisExpression' &&
    ast.program.body[0].expression.callee.object.type === 'FunctionExpression'
  const lazyRequireFunctionsByVariableName = new Map()

  function isTopLevelPath (path) {
    return path.scope.isGlobal || (programHasClosureWrapper && path.scope.depth === 1)
  }

  function isUnsupportedModuleRequire (path) {
    const node = path.node
    return (
      node.callee.name === 'require' &&
      node.arguments.length === 1 &&
      node.arguments[0].type === 'Literal' &&
      modulesUnsupportedByMkSnapshot.has(node.arguments[0].value)
    )
  }

  function isReferenceToLazyRequire (path) {
    const node = path.node
    const parent = path.parent.node
    const lazyRequireFunctionName = lazyRequireFunctionsByVariableName.get(node.name)
    return (
      lazyRequireFunctionName != null &&
      (path.scope.node.type !== 'FunctionDeclaration' || lazyRequireFunctionName !== path.scope.node.id.name) &&
      (parent.type !== 'VariableDeclarator' || parent.id !== node) &&
      (parent.type !== 'AssignmentExpression' || parent.left !== node)
    )
  }

  function replaceAssignmentOrDeclarationWithLazyFunction (path) {
    let parentPath = path.parent
    while (parentPath != null) {
      const parentNode = parentPath.node
      if (parentNode.type === 'AssignmentExpression') {
        const lazyRequireFunctionName = `get_${parentNode.left.name}`
        lazyRequireFunctionsByVariableName.set(parentNode.left.name, lazyRequireFunctionName)
        parentPath.replace(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
          b.returnStatement(
            b.assignmentExpression('=', parentNode.left, b.logicalExpression('||', parentNode.left, parentNode.right))
          )
        ])))
        break
      } else if (parentNode.type === 'VariableDeclarator') {
        const lazyRequireFunctionName = `get_${parentNode.id.name}`
        const variableDeclarationPath = parentPath.parent
        const variableDeclarationNode = variableDeclarationPath.node
        if (variableDeclarationNode.kind === 'const') {
          variableDeclarationNode.kind = 'let'
        }
        lazyRequireFunctionsByVariableName.set(parentNode.id.name, lazyRequireFunctionName)
        parentPath.replace(b.variableDeclarator(parentNode.id, null))
        variableDeclarationPath.insertAfter(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
          b.returnStatement(
            b.assignmentExpression('=', parentNode.id, b.logicalExpression('||', parentNode.id, parentNode.init))
          )
        ])))
        break
      }
      parentPath = parentPath.parent
    }

    if (parentPath == null) {
      throw new Error(`
        Using a blacklisted module for its side effects in this file's topmost scope.
        Consider moving it inside an initialization function to call at runtime.
      `)
    }
  }

  recast.types.visit(ast, {
    visitCallExpression: function (path) {
      if (isTopLevelPath(path) && isUnsupportedModuleRequire(path)) {
        replaceAssignmentOrDeclarationWithLazyFunction(path)
      }
      this.traverse(path);
    }
  })

  recast.types.visit(ast, {
    visitIdentifier: function (path) {
      if (isTopLevelPath(path) && isReferenceToLazyRequire(path)) {
        path.replace(b.callExpression(b.identifier(lazyRequireFunctionsByVariableName.get(path.node.name)), []))
        replaceAssignmentOrDeclarationWithLazyFunction(path)
      }
      this.traverse(path)
    }
  })

  recast.types.visit(ast, {
    visitIdentifier: function (path) {
      if (!isTopLevelPath(path) && isReferenceToLazyRequire(path)) {
        path.replace(b.callExpression(b.identifier(lazyRequireFunctionsByVariableName.get(path.node.name)), []))
      }
      this.traverse(path)
    }
  })

  // console.log(lazyRequireFunctionsByVariableName);
  console.log(recast.print(ast).code);
}
