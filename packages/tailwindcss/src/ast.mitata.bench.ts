import { bench, boxplot, do_not_optimize, run, summary } from 'mitata'
import fs from 'node:fs'
import path from 'node:path'
import { cloneAstNode, decl, toCss, type AstNode } from './ast'
import { parse } from './css-parser'
import { walk as transformDFS, WalkAction as WalkAction2 } from './walk'

let css = String.raw
let ast = parse(
  fs.readFileSync(path.join(__dirname, './huge.css'), 'utf-8').repeat(100) +
    '\n' +
    css`
      a {
        b {
          c {
            d {
              e {
                f {
                  g {
                    @stop-the-walk {
                      color: red;
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
)

const implementations = new Map([
  [
    'current',
    (ast: AstNode[]) => {
      walk(ast, (node, { replaceWith }) => {
        // A replacement with multiple nodes
        if (node.kind === 'declaration' && node.property === 'margin') {
          replaceWith([
            decl('margin-top', node.value),
            decl('margin-right', node.value),
            decl('margin-bottom', node.value),
            decl('margin-left', node.value),
          ])
        }

        // A mutation
        else if (node.kind === 'declaration') {
          node.property = node.property.toUpperCase()
        }

        // A deletion
        else if (node.kind === 'comment') {
          replaceWith([])
        }

        // A skip
        else if (node.kind === 'at-rule' && node.name === '@supports') {
          return WalkAction.Skip
        }

        // A stop
        else if (node.kind === 'at-rule' && node.name === '@stop-the-walk') {
          return WalkAction.Stop
        }

        // Continue by default
        return WalkAction.Continue
      })

      return ast
    },
  ],
  [
    'iterative',
    (ast: AstNode[]) => {
      transformDFS<AstNode>(ast, {
        enter(node) {
          // A replacement with multiple nodes
          if (node.kind === 'declaration' && node.property === 'margin') {
            return WalkAction2.Replace([
              decl('margin-top', node.value),
              decl('margin-right', node.value),
              decl('margin-bottom', node.value),
              decl('margin-left', node.value),
            ])
          }

          // A mutation
          else if (node.kind === 'declaration') {
            node.property = node.property.toUpperCase()
            return WalkAction2.Continue
          }

          // A deletion
          else if (node.kind === 'comment') {
            return WalkAction2.Replace([])
          }

          // A skip
          else if (node.kind === 'at-rule' && node.name === '@supports') {
            return WalkAction2.Skip
          }

          // A stop
          else if (node.kind === 'at-rule' && node.name === '@stop-the-walk') {
            return WalkAction2.Stop
          }

          // Continue by default
          return WalkAction2.Continue
        },
        exit() {},
      })

      return ast
    },
  ],
])

// Verify that the implementations are correct
let check: string | null = null
for (let [name, fn] of implementations) {
  let ast1 = structuredClone(ast)
  console.time(`check ${name}`)
  fn(ast1)
  console.timeEnd(`check ${name}`)
  if (check === null) check = toCss(ast1)
  else if (check !== toCss(ast1)) {
    fs.writeFileSync(`out-base.css`, check)
    fs.writeFileSync(`out-${name}.css`, toCss(ast1))
    throw new Error(`Implementation ${name} does not match`)
  }
}

summary(() => {
  boxplot(() => {
    for (let [name, transform] of implementations) {
      bench(name, function* () {
        yield {
          [0]() {
            return ast.map(cloneAstNode)
          },
          bench(ast: AstNode[]) {
            do_not_optimize(transform(ast))
          },
        }
      })
    }
  })
})

await run()

/// OLD IMPLEMENTATION

const enum WalkAction {
  /** Continue walking, which is the default */
  Continue,

  /** Skip visiting the children of this node */
  Skip,

  /** Stop the walk entirely */
  Stop,
}

function walk(
  ast: AstNode[],
  visit: (
    node: AstNode,
    utils: {
      parent: AstNode | null
      replaceWith(newNode: AstNode | AstNode[]): void
      context: Record<string, string | boolean>
      path: AstNode[]
    },
  ) => void | WalkAction,
  path: AstNode[] = [],
  context: Record<string, string | boolean> = {},
) {
  for (let i = 0; i < ast.length; i++) {
    let node = ast[i]
    let parent = path[path.length - 1] ?? null

    // We want context nodes to be transparent in walks. This means that
    // whenever we encounter one, we immediately walk through its children and
    // furthermore we also don't update the parent.
    if (node.kind === 'context') {
      if (walk(node.nodes, visit, path, { ...context, ...node.context }) === WalkAction.Stop) {
        return WalkAction.Stop
      }
      continue
    }

    path.push(node)
    let replacedNode = false
    let replacedNodeOffset = 0
    let status =
      visit(node, {
        parent,
        context,
        path,
        replaceWith(newNode) {
          if (replacedNode) return
          replacedNode = true

          if (Array.isArray(newNode)) {
            if (newNode.length === 0) {
              ast.splice(i, 1)
              replacedNodeOffset = 0
            } else if (newNode.length === 1) {
              ast[i] = newNode[0]
              replacedNodeOffset = 1
            } else {
              ast.splice(i, 1, ...newNode)
              replacedNodeOffset = newNode.length
            }
          } else {
            ast[i] = newNode
            replacedNodeOffset = 1
          }
        },
      }) ?? WalkAction.Continue
    path.pop()

    // We want to visit or skip the newly replaced node(s), which start at the
    // current index (i). By decrementing the index here, the next loop will
    // process this position (containing the replaced node) again.
    if (replacedNode) {
      if (status === WalkAction.Continue) {
        i--
      } else {
        i += replacedNodeOffset - 1
      }
      continue
    }

    // Stop the walk entirely
    if (status === WalkAction.Stop) return WalkAction.Stop

    // Skip visiting the children of this node
    if (status === WalkAction.Skip) continue

    if ('nodes' in node) {
      path.push(node)
      let result = walk(node.nodes, visit, path, context)
      path.pop()

      if (result === WalkAction.Stop) {
        return WalkAction.Stop
      }
    }
  }
}
