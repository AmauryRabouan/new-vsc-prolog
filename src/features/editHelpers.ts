"use strict";
import {
  CommentRule,
  Disposable,
  IndentAction,
  languages,
  OnEnterRule,
  Position,
  Range,
  Selection,
  TextDocument,
  window,
  workspace
} from "vscode";
// automatic indentation on change
export function loadEditHelpers(subscriptions: Disposable[]) {
  subscriptions.push(
    languages.setLanguageConfiguration("prolog", {
      indentationRules: {
        decreaseIndentPattern: /(\s*\)|\s*\])$/,
        increaseIndentPattern: /(.*:-\s*|.*-->\s*|.*:->\s*|.*:<-\s*|.+\[|.+\()$/
      },
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
      onEnterRules: [
        // {
        //   beforeText: /.+:-|:- begin_tests.+\.$/,
        //   action: { indentAction: IndentAction.Indent }
        // },
        {
          beforeText: /(^\s*|.*%.+)$/,
          action: { indentAction: IndentAction.None }
        },
        {
          beforeText: /.+\.$/,
          action: { indentAction: IndentAction.Outdent }
        },
        {
          beforeText: /.+\([^\)]*$/,
          action: { indentAction: IndentAction.Indent }
        },
        // {
        //   beforeText: /.+\[[^\]]*$/,
        //   action: { indentAction: IndentAction.Indent }
        // },
        {
          // e.g. /** | */
          beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
          afterText: /^\s*\*\/$/,
          action: {
            indentAction: IndentAction.IndentOutdent,
            appendText: " * "
          }
        },
        {
          // e.g. /** ...|
          beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
          action: { indentAction: IndentAction.None, appendText: " * " }
        },
        {
          // e.g.  * ...|
          beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
          action: { indentAction: IndentAction.None, appendText: "* " }
        },
        {
          // e.g.  */|
          beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
          action: { indentAction: IndentAction.None, removeText: 1 }
        },
        {
          // e.g.  *-----*/|
          beforeText: /^(\t|(\ \ ))*\ \*[^/]*\*\/\s*$/,
          action: { indentAction: IndentAction.None, removeText: 1 }
        }
      ]
    })
  );


}
