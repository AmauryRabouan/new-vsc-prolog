"use strict";
import {
  HoverProvider,
  MarkdownString,
  Position,
  TextDocument,
  CancellationToken,
  Hover,
  Range,
  workspace,
  languages
} from "vscode";
import * as cp from "child_process";
import { Utils } from "../utils/utils";

export default class PrologHoverProvider implements HoverProvider {
  // escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
  // Helper function to escape markdown syntax tokens
  private textToMarkedString(text: string): MarkdownString["value"]{
    return text.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
  }
  
  // Implement the provideHover method required by HoverProvider interface
  public provideHover(
    doc: TextDocument,
    position: Position,
    token: CancellationToken
  ): Hover {
    let wordRange: Range = doc.getWordRangeAtPosition(position);// Get the range of the word at the given position
    // Return early if no word range is found
    if (!wordRange) {
      return;
    }
    let pred = Utils.getPredicateUnderCursor(doc, position);// Get the predicate under the cursor using utility function
    // Return early if no predicate is found
    if (!pred) {
      return;
    }
    // Return early if the predicate arity is less than or equal to 0
    if (pred.arity <= 0) {
      return;
    }
    let contents= new MarkdownString("",true);// Create a MarkdownString to hold the hover contents
    // Switch based on the Prolog dialect (e.g., "swi" or "ecl")
    switch (Utils.DIALECT) {
      case "swi":
        // Extract module and predicate information for SWI-Prolog
        let pi = pred.pi.indexOf(":") > -1 ? pred.pi.split(":")[1] : pred.pi;
        let modules: string[] = Utils.getPredModules(pi);
        // Check if there are no modules associated with the predicate
        if (modules.length === 0) {
          let desc = Utils.getPredDescriptions(pi);
          // Append code block with either the description or the predicate itself
          if (desc == ""){
            contents.appendCodeblock(pi,"prolog") ;
          }else{
            contents.appendCodeblock(desc,"prolog") ;
          }
         
        } else {
          // Iterate through modules and append information to contents
          if (modules.length > 0) {
            modules.forEach(module => {
              contents.appendText(module + ":" + pi + "\n")
              let desc = Utils.getPredDescriptions(module + ":" + pi);
              contents.appendCodeblock(desc,"prolog")
  
            });
          }
        }
        break;
      case "ecl":
        // Execute a help command for ECLiPSe Prolog and append result to contents
        let pro = cp.spawnSync(Utils.RUNTIMEPATH, ["-e", `help(${pred.pi})`]);
        // Check if the command execution was successful
        if (pro.status === 0) {
          contents.appendCodeblock(pro.output
            .toString()
            .trim()
            .replace(/^\W*\n/, "")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/  +/g, "  "),"prolog")
        } else {
          return;
        }
      default:
        // Handle other Prolog dialects if needed
        break;
    }
    // Return a new Hover instance with the contents and word range
    return new Hover(contents, wordRange);
  }
}
