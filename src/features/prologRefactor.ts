import {
  Location,
  TextDocument,
  Position,
  workspace,
  Uri,
  Range,
  OutputChannel,
  WorkspaceEdit,
  window
} from "vscode";
import { IPredicate, Utils } from "../utils/utils";
import { spawn } from "process-promises";
import * as fif from "find-in-files";
import * as fs from "fs";
import  jsesc from "jsesc";
import { resolve } from "path";
import * as path from "path";

interface IClauseRefs {
  [file: string]: { [clauseLine: number]: number };
}

export class PrologRefactor {
  private _executable: string;
  private _locations: Location[] = [];
  private _clauseRefs: IClauseRefs = null;
  private _outputChannel: OutputChannel;
  private _isBuiltin: boolean = false;
  private _defLocFound: boolean = false;

  // pick predicate at pos in doc
  constructor() {
    this._executable = Utils.RUNTIMEPATH;
    this._outputChannel = window.createOutputChannel("PrologFormatter");
    this._locations = [];
    this._clauseRefs = {};
  }

  // Initiates the refactoring process for the predicate currently under the cursor
  public refactorPredUnderCursor() {
    // Get the current document and cursor position
    let doc: TextDocument = window.activeTextEditor.document;
    let pos: Position = window.activeTextEditor.selection.active;

    let pred: IPredicate = Utils.getPredicateUnderCursor(doc, pos);// Get the predicate information under the cursor using utility function
    // Find all references to the predicate
    this.findFilesAndRefs(pred, true,doc).then(refLocs => {
      // Check if the predicate is a built-in predicate
      if (this._isBuiltin) {
        // If built-in, ask for confirmation before refactoring references
        window
          .showInformationMessage(
            `'${pred.pi}' is a builtin predicate, so its definition cannot be refactored. Are you still SURE to refactor its all references?`,
            "yes",
            "no"
          )
          .then(answer => {
            // If the user confirms, apply the refactoring
            if (answer !== "yes") {
              return;
            }
            this.applyRefactoring(pred, refLocs);
          });
      } else {
        // If not built-in, ask for confirmation to refactor both definition and references
        window
          .showInformationMessage(
            `'Are you SURE to refactor '${pred.pi}' in all its references and definition? You'd better to commit current stage of the VCS to rollback refactoring if necessary.`,
            "yes",
            "no"
          )
          .then(answer => {
            // If the user confirms, apply the refactoring
            if (answer !== "yes") {
              return;
            }
            this.applyRefactoring(pred, refLocs);
          });
      }
    });
  }

  // Applies the refactoring by replacing all occurrences of the predicate with a new name in the given reference locations
  private async applyRefactoring(pred: IPredicate, refLocs: Location[]) {
    // Prompt the user to input a new predicate name
    let newPredName = await window.showInputBox({
      prompt: `Input new predicate name to replace ${pred.functor}`,
      placeHolder: pred.functor,
      ignoreFocusOut: true,
      validateInput: value => {
        // Validate the input for the new predicate name
        if (/\s/.test(value) && !/^'[^\']+'$/.test(value)) {
          return "Predicate name must not contain any spaces, tab and new line.";
        }
        if (
          /^[^a-z']/.test(value) ||
          (/^'[^a-z]/.test(value) && !/'$/.test(value))
        ) {
          return "Illegal starting letter in predicate name.";
        }
        return null;// Input is valid
      }
    });
    // Replace occurrences of the old predicate with the new name in each reference location
    await Promise.all(
      refLocs.map(async refLoc => {
        let edit = new WorkspaceEdit();
        edit.replace(refLoc.uri, refLoc.range, newPredName);
        return await workspace.applyEdit(edit);
      })
    );
    // Save all open documents after refactoring
    await Promise.all(
      workspace.textDocuments.map(async doc => {
        return await doc.save();
      })
    );

    return;
  }

  // Finds all references to the predicate currently under the cursor
  public findAllRefs(): Promise<Location[]> {
    // Get the current document and cursor position
    let doc: TextDocument = window.activeTextEditor.document;
    let pos: Position = window.activeTextEditor.selection.active;

    let pred: IPredicate = Utils.getPredicateUnderCursor(doc, pos);// Get the predicate information under the cursor using utility function
    return this.findFilesAndRefs(pred,false,doc); // Call the findFilesAndRefs method to find references and return the result
  }

  // Finds references to the given predicate in multiple files
  public async findFilesAndRefs(
    pred: IPredicate,
    includingDefLoc = false,
    doc:TextDocument
  ): Promise<Location[]> {
    // Call the findFilesAndRefs1 method to perform the actual search
    return await this.findFilesAndRefs1(pred, includingDefLoc, doc);
  }

  // Performs the search for references to the given predicate in multiple files
  public async findFilesAndRefs1(
    pred: IPredicate,
    includingDefLoc = false,
    doc : TextDocument
  ): Promise<Location[]> {
    // Save all open documents before searching
    await Promise.all(
      workspace.textDocuments.map(async doc => {
        return await doc.save();
      })
    );
    // Use find-in-files to locate files containing references to the predicate
    let files = await fif.find(
      pred.functor,
      jsesc(workspace.workspaceFolders[0].uri.fsPath),
      "\\.pl$|\\.ecl$"
    );
    // Iterate through the found files and load each file to find references
    for (let file in files) {
      file = jsesc(file);
      let defLoc = includingDefLoc && !this._defLocFound;
      await this.loadFileAndFindRefs(pred, file, defLoc,doc);// Load the file and find references, updating the _locations array
    }
    return this._locations;// Return the array of reference locations
  }

  // Loads the Prolog file and finds references based on the Prolog dialect
  private async loadFileAndFindRefs(
    pred: IPredicate,
    file: string,
    includingDefLoc = false,
    doc : TextDocument
  ) {
    let input: string,
      args: string[] = [];
      // Construct the appropriate input and arguments based on the Prolog dialect
    switch (Utils.DIALECT) {
      case "swi":
        let pfile = jsesc(path.resolve(`${__dirname}/features/findallrefs_swi`));
        input = `
          use_module('${pfile}').
          load_files('${file}').
          findrefs:findrefs(${pred.pi}, ${includingDefLoc}).
          halt.
        `;
        args = ["-q"];
        break;
      case "ecl":
        let efile = jsesc(path.resolve(`${__dirname}/features/findallrefs`));
        args = ["-f", efile];
        input = `digout_predicate('${file}', ${pred.pi}). `;
        break;
      default:
        break;
    }

    try {
      // Spawn a child process to execute Prolog queries
      await spawn(this._executable, args, { cwd: workspace.workspaceFolders[0].uri.fsPath })
        .on("process", proc => {
          if (proc.pid) {
            // Write the input to the stdin of the spawned process
            proc.stdin.write(input);
            proc.stdin.end();
          }
        })
        .on("stdout", output => {
          // Parse the output based on the Prolog dialect
          switch (Utils.DIALECT) {
            case "swi":
              this.findRefsFromOutputSwi(pred, output, doc);
              break;
            case "ecl":
              this.findRefsFromOutputEcl(file, pred.pi, output);
            default:
              break;
          }
        })
        .on("stderr", err => {
          // Handle any errors or display them in the output channel
          this._outputChannel.append(err + "\n");
          this._outputChannel.show(true);
        });
    } catch (error) {
      // Handle specific error cases (e.g., executable not found) and display error messages
      let message: string = null;
      if ((<any>error).code === "ENOENT") {
        message = `Cannot debug the prolog file. The Prolog executable was not found. Correct the 'prolog.executablePath' configure please.`;
      } else {
        message = error.message
          ? error.message
          : `Failed to run swipl using path: ${this._executable}. Reason is unknown.`;
      }
    }
  }

  // Parses the output from SWI-Prolog and extracts reference information
  private findRefsFromOutputSwi(pred: IPredicate, output: string, doc:TextDocument) {
    // Check if the predicate is a built-in or foreign predicate
    const docContent = doc.getText();
    if (/{"reference":"built_in or foreign"}/.test(output)) {
      this._isBuiltin = true;
    }
    // Check if a definition location is found in the output
    if (/{"reference":"definition location found"}/.test(output)) {
      this._defLocFound = true;
    }
    
    var pred_void = (pred.functor) +"(?=\\(";
    for(let i =0 ; i < pred.arity ;i++){
      pred_void = pred_void + "[a-zA-Z0-9_,$&+,:;=?@#|'<>\\.^*()%!-:\\[\\]\\s]*";
      if( i< pred.arity-1){
        pred_void = pred_void + ",";
      }
    }
    pred_void = pred_void + "\\))|"+pred.functor+"(?=\\/"+pred.arity+")";
    const regexp = new RegExp(pred_void,"gm");
    const array = [...docContent.matchAll(regexp)]; // Extract occurrences of the predicate in the document
    var locations =array.map((elem)=>new Location(Uri.file(doc.fileName),new Range(doc.positionAt(elem.index),doc.positionAt(elem.index+elem[0].length))));// Create an array to store Location objects
    
    const regexpModule = /^\s*:-\s*use_module\(([a-zA-Z0-9_\/]*|(\"|\')[a-zA-Z0-9_\/\.]*(\"|\'))\s*((,\s*[\/a-zA-Z0-9\[\]]*\s*\)|\))\s*\.)/gm;// Define a regular expression for finding "use_module" declarations in the document
    const arrayModule = [...docContent.matchAll(regexpModule)]// Extract "use_module" declarations from the document
    const prolog = doc.fileName.split(".")[1]// Extract the Prolog dialect from the file extension
    // Iterate through "use_module" declarations
    for(let i = 0 ; i < arrayModule.length;i++){
      var modpath = arrayModule[i][1].replace(new RegExp("\\'","gm"),"")
      modpath = modpath.replace(new RegExp('\\"',"gm"),"")
      var text=fs.readFileSync(workspace.workspaceFolders[0].uri.fsPath+"/"+modpath+"."+prolog, 'utf8');// Read the content of the referenced module file
      
      const array = [...text.matchAll(regexp)];// Extract occurrences of the predicate in the referenced module file
      locations = locations.concat(array.map((elem)=>new Location(Uri.file(workspace.workspaceFolders[0].uri.fsPath+"/"+modpath+"."+prolog),new Range(Utils.findLineColForByte(text,elem.index),Utils.findLineColForByte(text,elem.index+elem[0].length)))));// Append the new occurrences to the locations array
  }
    
    this._locations = locations;
    /*let refReg = /\{"reference":\s*(\{.+?\})\}/g;// Regular expression to match reference information in the output
    // Attempt to match and parse each reference in the output
    let match: RegExpExecArray = refReg.exec(output);
    while (match) {
      // Parse the reference information from the matched JSON
      let ref: { file: string; line: number; char: number } = JSON.parse(
        match[1]
      );
      // Relocate if the reference points to the start of the clause
      let lines = fs
        .readFileSync(ref.file)
        .toString()
        .split("\n");
      let predName = pi.split("/")[0];
      // Extract the predicate name in case of a module
      if (predName.indexOf(":") > -1) {
        predName = predName.split(":")[1];
      }
      // Check if the reference is not at the beginning of the clause
      if (!new RegExp("^" + predName).test(lines[ref.line].slice(ref.char))) {
        let clauseStart = ref.line;
        let start = ref.line;
        // Adjust the start based on previous clause references
        if (
          this._clauseRefs[ref.file] &&
          this._clauseRefs[ref.file][clauseStart]
        ) {
          start = this._clauseRefs[ref.file][clauseStart] + 1;
        }
        let str = lines.slice(start).join("\n");
        let index = str.indexOf(predName);
        // If the predicate name is found, adjust the reference location
        if (index > -1) {
          str = str.slice(0, index);
          let strLines = str.split("\n");
          ref.line = start + strLines.length - 1;
          ref.char = strLines[strLines.length - 1].length;
          // Update the clause references with the adjusted location
          if (this._clauseRefs[ref.file]) {
            this._clauseRefs[ref.file][clauseStart] = ref.line;
          } else {
            this._clauseRefs[ref.file] = {};
            this._clauseRefs[ref.file][clauseStart] = ref.line;
          }
        }
      }
      // Add the adjusted reference location to the _locations array
      this._locations.push(
        new Location(
          Uri.file(jsesc(path.resolve(ref.file))),
          new Range(ref.line, ref.char, ref.line, ref.char + predName.length)
        )
      );
      match = refReg.exec(output);// Attempt to find the next reference in the output
    }*/
  }

  //Parses the output from ECLiPSe Prolog and extracts reference information
  private findRefsFromOutputEcl(file: string, pi: string, output: string) {
    
    let match = output.match(/references:\[(.*)\]/);// Extract references information from the output using a regular expression
    // Return if no matches are found or the references array is empty
    if (!match || match[1] === "") {
      return;
    }
    let predLen = pi.split(":")[1].split("/")[0].length;// Extract the length of the predicate name
    let locs = match[1].split(",");// Split the references string into an array of location strings
    workspace.openTextDocument(Uri.file(file)).then(doc => {// Open the Prolog document to map character positions to positions in the file
      // Iterate through each location string and create Location objects
      locs.forEach(fromS => {
        const from = parseInt(fromS);
        this._locations.push(
          new Location(
            Uri.file(file),
            new Range(doc.positionAt(from), doc.positionAt(from + predLen))
          )
        );
      });
    });
  }
}