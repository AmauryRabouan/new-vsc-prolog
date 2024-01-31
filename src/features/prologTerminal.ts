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
  // Initialize the Prolog terminal
  public static init(): Disposable {
    return (<any>window).onDidCloseTerminal(terminal => {
      PrologTerminal._terminal = null;
      terminal.dispose();
    });
  }

  // Create a Prolog terminal instance
  private static createPrologTerm() {
    if (PrologTerminal._terminal) {
      return;
    }
    // Retrieve configuration settings for Prolog
    let section = workspace.getConfiguration("prolog");
    let title = "Prolog";
    // Check if the configuration section is available
    if (section) {
      let executable = section.get<string>("executablePath", "swipl");
      let args = section.get<string[]>("terminal.runtimeArgs");
      // Create a new terminal instance
      PrologTerminal._terminal = (<any>window).createTerminal(
        title,
        executable,
        args
      );
    } else {
      throw new Error("configuration settings error: prolog");
    }
  }
  // Send a string to the Prolog terminal
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
    PrologTerminal._document = window.activeTextEditor.document;// Get the active Prolog document
    PrologTerminal.createPrologTerm();// Create the Prolog terminal
    // Get the file name and escape it using jsesc
    let fname = jsesc(PrologTerminal._document.fileName, { quotes: "single" });
    let goals = `['${fname}']`;// Define the goals to load the Prolog file
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
    // Get the active text editor and document
    let editor: TextEditor = window.activeTextEditor;
    let doc: TextDocument = editor.document;
    let pred = Utils.getPredicateUnderCursor(doc, editor.selection.active);// Get the predicate under the cursor using utility function
    // if no predicate under cursor
    if (!pred) {
      return;
    }
    PrologTerminal.loadDocument();// Load the current Prolog document into the Prolog terminal
    let goal = pred.wholePred;// Extract the goal from the predicate
    // Separate the module if present
    if (goal.indexOf(":") > -1) {
      goal = goal.split(":")[1];
    }
    PrologTerminal.sendString(goal);
  }
}
