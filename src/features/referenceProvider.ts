import { PrologRefactor } from "./prologRefactor";
import { Utils } from "../utils/utils";
import {
  ReferenceProvider,
  TextDocument,
  Position,
  ReferenceContext,
  CancellationToken,
  Location,
  window,
  workspace,
  Uri
} from "vscode";
import * as fs from "fs";
import { spawn } from "process-promises";
export class PrologReferenceProvider implements ReferenceProvider {
  constructor() {}
  // Implement the provideReferences method required by ReferenceProvider interface
  public provideReferences(
    doc: TextDocument,
    position: Position,
    context: ReferenceContext,
    token: CancellationToken
  ): Location[] {
    let docContent = doc.getText(); // Get the content of the entire document as a string
    // Define a regular expression for finding occurrences of the predicate in the document
    let pred = Utils.getPredicateUnderCursor(doc, position);
    var regex= "\\((.|\\s)*?\\)"
    const regexp = new RegExp(pred.functor+regex,"gm");
    const regexpModule = /^\s*:-\s*use_module\(([a-z][a-zA-Z0-9_\/]*)\s*(,|\)\s*\.)/gm;// Define a regular expression for finding "use_module" declarations in the document
    const arrayModule = [...docContent.matchAll(regexpModule)]// Extract "use_module" declarations from the document
    const prolog = doc.fileName.split(".")[1]// Extract the Prolog dialect from the file extension
    const array = [...docContent.matchAll(regexp)]; // Extract occurrences of the predicate in the document
    var locations =array.map((elem)=>new Location(Uri.file(doc.fileName),doc.positionAt(elem.index)));// Create an array to store Location objects
    // Iterate through "use_module" declarations
    for(let i = 0 ; i < arrayModule.length;i++){
        var text=fs.readFileSync(workspace.workspaceFolders[0].uri.fsPath+"/"+arrayModule[i][1]+"."+prolog, 'utf8');// Read the content of the referenced module file
        const array = [...text.matchAll(regexp)];// Extract occurrences of the predicate in the referenced module file
        locations = locations.concat(array.map((elem)=>new Location(Uri.file(workspace.workspaceFolders[0].uri.fsPath+"/"+arrayModule[i][1]+"."+prolog),findLineColForByte(text,elem.index))));// Append the new occurrences to the locations array
    }
    // Return the array of Location objects
    return locations
  }
}
// Helper function to find line and column for a byte offset in the document
function findLineColForByte(doc, index) {
  const lines = doc.split("\n");
  let totalLength = 0
  let lineStartPos = 0
  // Iterate through lines to find the line and column for the byte offset
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    totalLength += lines[lineNo].length + 1 // Because we removed the '\n' during split.
    if (index < totalLength) {
      const colNo = index - lineStartPos
      return new Position(lineNo, colNo)
    }
    lineStartPos = totalLength
  }
}
