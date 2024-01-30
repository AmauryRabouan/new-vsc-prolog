"use strict";

import { Utils } from "../utils/utils";
import {
  Terminal,
  window,
  workspace,
  TextDocument,
  Disposable,
  OutputChannel,
  TextEditor
} from "vscode";
import jsesc from "jsesc";

export default class PrologTerminal {
  private static _terminal: Terminal;
  private static _document: TextDocument;

  constructor() {}

  public static init(): Disposable {
    return (<any>window).onDidCloseTerminal(terminal => {
      PrologTerminal._terminal = null;
      terminal.dispose();
    });
  }

  // run swipl on a visual terminal
  private static createPrologTerm() {
    if (PrologTerminal._terminal) {
      return;
    }

    let section = workspace.getConfiguration("prolog");
    let title = "Prolog";
    if (section) {
      let executable = section.get<string>("executablePath", "swipl");
      let args = section.get<string[]>("terminal.runtimeArgs");
      PrologTerminal._terminal = (<any>window).createTerminal(
        title,
        executable,
        args
      );
    } else {
      throw new Error("configuration settings error: prolog");
    }
  }
  // send text to the terminal
  public static sendString(text: string) {
    PrologTerminal.createPrologTerm();
    // finish goal by .
    if (!text.endsWith(".")) {
      text += ".";
    }
    PrologTerminal._terminal.sendText(text);
    PrologTerminal._terminal.show(false);
  }
  // load the prolog file
  public static loadDocument() {
    PrologTerminal._document = window.activeTextEditor.document;
    PrologTerminal.createPrologTerm();
    // get the file name
    let fname = jsesc(PrologTerminal._document.fileName, { quotes: "single" });
    let goals = `['${fname}']`;
    // load the file into swipl with a goal
    if (PrologTerminal._document.isDirty) {
      PrologTerminal._document.save().then(_ => {
        PrologTerminal.sendString(goals);
      });
    } else {
      PrologTerminal.sendString(goals);
    }
  }
  // query the goal under the cursor command
  public static queryGoalUnderCursor() {
    let editor: TextEditor = window.activeTextEditor;
    let doc: TextDocument = editor.document;
    let pred = Utils.getPredicateUnderCursor(doc, editor.selection.active);
    // if no predicate under cursor
    if (!pred) {
      return;
    }
    PrologTerminal.loadDocument();
    let goal = pred.wholePred;
    // separate the module
    if (goal.indexOf(":") > -1) {
      goal = goal.split(":")[1];
    }
    PrologTerminal.sendString(goal);
  }
}
