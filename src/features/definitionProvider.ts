import {
  CancellationToken,
  DefinitionProvider,
  Location,
  Position,
  Range,
  TextDocument,
  Uri,
  workspace
} from "vscode";
import * as cp from "child_process";
import { Utils } from "../utils/utils";
import * as path from "path";
import  jsesc from "jsesc";
export class PrologDefinitionProvider implements DefinitionProvider {
  // Implement the provideDefinition method required by DefinitionProvider interface
  public provideDefinition(
    doc: TextDocument,
    position: Position,
    token: CancellationToken
  ): Location | Thenable<Location> {
    let location: Location = null;
    let pred = Utils.getPredicateUnderCursor(doc, position);// Get the predicate under the cursor using utility function
    // Return early if no predicate is found
    if (!pred) {
      return null;
    }
    // Initialize variables for Prolog execution
    let exec = Utils.RUNTIMEPATH;
    let args: string[] = [],
      prologCode: string,
      result: string[],
      predToFind: string,
      runOptions: cp.SpawnSyncOptions;
    const fileLineRe = /File:(.+);Line:(\d+)/;
    // Switch based on the Prolog dialect (e.g., "swi" or "ecl")
    switch (Utils.DIALECT) {
      case "swi":
        // Construct a predicate with void arguments (e.g., pred_void = pred.functor(_,_,_,...,_) )
        var pred_void = pred.functor +"(";
        for(let i =0 ; i < pred.arity ;i++){
          pred_void = pred_void + "_";
          if( i< pred.arity-1){
            pred_void = pred_void + ",";
          }
        }
        pred_void = pred_void + ")";
        args = ["-q", doc.fileName];
        prologCode = `
        source_location:-
          predicate_property(${pred_void}, file(File)),
          predicate_property(${pred_void}, line_count(Line)),
          format("File:~s;Line:~d~n", [File, Line]).
          `;
        // Check if the document is dirty (unsaved) and save it if needed
        if (doc.isDirty) {
          doc.save().then(_ => {
            result = Utils.execPrologSync(
              args,
              prologCode,
              "source_location",
              "",
              fileLineRe
            );
          });
        } else {
          result = Utils.execPrologSync(
            args,
            prologCode,
            "source_location",
            "",
            fileLineRe
          );
        }
        break;

      case "ecl":
        args = [];
        let lc = path.resolve(`${__dirname}/locate_clause`);
        predToFind = pred.pi.split(":")[1];
        prologCode = `ensure_loaded(['${lc}']),
          source_location('${jsesc(doc.fileName)}', ${predToFind}).
          `;
        runOptions = {
          cwd: workspace.workspaceFolders[0].uri.fsPath,
          encoding: "utf8",
          input: prologCode
        };
        // Check if the document is dirty (unsaved) and save it if needed
        if (doc.isDirty) {
          doc.save().then(_ => {
            let syncPro = cp.spawnSync(Utils.RUNTIMEPATH, args, runOptions);
            if (syncPro.status === 0) {
              result = syncPro.stdout.toString().match(fileLineRe);
            }
          });
        } else {
          let syncPro = cp.spawnSync(Utils.RUNTIMEPATH, args, runOptions);
          if (syncPro.status === 0) {
            result = syncPro.stdout.toString().match(fileLineRe);
          }
        }
        break;

      default:
         // Handle other Prolog dialects if needed
        break;
    }
    // If result is obtained, create a Location object with file and line information
    if (result) {
      let fileName: string = result[1];
      let lineNum: number = parseInt(result[2]);
      location = new Location(Uri.file(fileName), new Position(lineNum - 1, 0));
    }

    return location;// Return the obtained location
  }
}
