import { truncate, truncateSync } from "fs";
import  jsesc from "jsesc";
import { spawn } from "process-promises";
import {
  CancellationToken,
  CodeActionContext,
  CodeActionProvider,
  Command,
  commands,
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  Disposable,
  ExtensionContext,
  languages,
  OutputChannel,
  Position,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  window,
  workspace,
  WorkspaceEdit
} from "vscode";
import { Utils, IPredicate } from "../utils/utils";
// import { basename, extname, resolve } from "path";
import * as find from "find";
import * as path from "path";

// Enum for different triggers that can run the linter
export enum RunTrigger {
  onType,
  onSave,
  never
}
// Main class for the Prolog Linter, implementing CodeActionProvider
export default class PrologLinter implements CodeActionProvider {
  private commandAddDynamic: Disposable;
  private commandAddDynamicId: string;
  private commandAddUseModule: Disposable;
  private commandAddUseModuleId: string;
  private commandExportPredicate: Disposable;
  private commandExportPredicateId: string;

  private diagnosticCollection: DiagnosticCollection;
  private diagnostics: { [docName: string]: Diagnostic[] } = {};
  private filePathIds: { [id: string]: string } = {};
  private sortedDiagIndex: { [docName: string]: number[] } = {};
  // Regular expression to parse SWI-Prolog errors and warnings
  private swiRegex = /([^:]+?):\s*(.+?):(\d+):((\d+):)?((\d+):)?\s*([\s\S]*)/;
  // Configuration parameters
  private executable: string;
  private trigger: RunTrigger;
  private timer: NodeJS.Timer = null;
  private delay: number;
  private documentListener: Disposable;
  private openDocumentListener: Disposable;
  private outputChannel: OutputChannel = null;
  private enableOutput: boolean = false;

  constructor(private context: ExtensionContext) {
    this.executable = null;
    // dynamically declare a predicate as dynamic in Prolog code. Dynamic predicates are those whose clauses can be modified at runtime.
    this.commandAddDynamicId = "prolog.addDynamicDirective";
    this.commandAddDynamic = commands.registerCommand(
      this.commandAddDynamicId,
      this.addDynamicDirective,
      this
    );
    // include a Prolog module in the code
    this.commandAddUseModuleId = "prolog.addUseModule";
    this.commandAddUseModule = commands.registerCommand(
      this.commandAddUseModuleId,
      this.addUseModule,
      this
    );
    // facilitate the process of exporting a predicate, making it visible to other Prolog modules
    /*
    this.commandExportPredicateId = "prolog.exportPredicate";
    this.commandExportPredicate = commands.registerCommand(
      this.commandExportPredicateId,
      this.exportPredicateUnderCursor,
      this
    );*/
    // Get configuration settings from VS Code
    this.enableOutput = workspace.getConfiguration("prolog")
      .get<boolean>("linter.enableMsgInOutput");
  }
  // Method to get lines where a directive should be added based on predicate and range
  private getDirectiveLines(
    doc: TextDocument,
    declarativePredicate: string,
    range: Range
  ): number[] {
    let textlines: string[] = doc.getText().split("\n");// Split the document text into lines
    let re = new RegExp("^\\s*:-\\s+\\(?\\s*" + declarativePredicate + "\\b");// Regular expression to match the declarative predicate directive
    let lines: number[] = [];
    let line = 0;
    while (line < textlines.length) {// Iterate through each line in the document
      if (re.test(textlines[line])) {
        lines = lines.concat(line);
      }
      line++;
    }
    // If lines with the directive are found, return the array of line numbers
    if (lines.length > 0) {
      return lines;
    }

    line = -1;
    // Find the first line starting with ":-"
    textlines.filter((item, index) => {
      if (/^\s*:-/.test(item)) {
        line = index;
        return true;
      }
    });
    // Continue iterating to find the end of the directive or the end of the document
    while (line >= 0 && !/.+\.(\s*%.*)*/.test(textlines[line])) {
      line++;
    }
    // If the line is before the specified range, return an array with the next line
    if (line >= 0 && line < range.start.line) {
      return [++line];
    }

    line = 0;
    // Check for the presence of a comment block at the beginning of the document
    let inComment = /\s*\/\*/.test(textlines[0]);
    // Continue iterating until the end of the comment block is found
    while (inComment) {
      if (/\*\//.test(textlines[line])) {
        inComment = false;
        line++;
        break;
      }
      line++;
    }
    // Return an array with the line number after the comment block
    return [line];  
  }

  // Method to add a dynamic directive to the document
  private addDynamicDirective(
    doc: TextDocument,
    predicate: string, //the predicate for which the 'dynamic' directive is being added
    uri: Uri,
    range: Range
  ): Thenable<boolean> {
    let edit = new WorkspaceEdit();// Initialize a WorkspaceEdit for making changes to the document
    let line = this.getDirectiveLines(doc, "dynamic", range)[0];// Get the line number where the 'dynamic' directive should be added

    let text = doc.lineAt(line).text; // Extract the current line text
    let pos: Position;// Position to insert the 'dynamic' declaration
    // Check if an existing 'dynamic' declaration is present
    if (/:-\s+\(?dynamic/.test(text)) {
      // If present, find the start character of the list and position the cursor after it
      let startChar = text.indexOf("dynamic") + 7;
      pos = new Position(line, startChar);
      edit.insert(uri, pos, " " + predicate + ",");// Insert the predicate into the existing 'dynamic' declaration list
    } else {
      // If not present, insert a new 'dynamic' declaration with the specified predicate
      pos = new Position(line, 0);
      edit.insert(uri, pos, ":- dynamic " + predicate + ".\n");
    }
    // Apply the WorkspaceEdit to the document
    let result: Thenable<boolean> = null;
    try {
      result = workspace.applyEdit(edit);
    } catch (e) {
      console.log("Error in add dynamic declaration: " + e);
    }
    return result;
  }

  // Method to add a "use_module" directive to the document
  private addUseModule(
    doc: TextDocument,
    predicate: string,// The predicate for which the 'use_module' directive is being added
    module: string,// The module to be used in the 'use_module' directive
    uri: Uri,
    range: Range
  ): Thenable<boolean> {
    let edit = new WorkspaceEdit();// Initialize a WorkspaceEdit for making changes to the document
    let lines = this.getDirectiveLines(doc, "use_module", range); // Get the lines where the 'use_module' directive is defined
    let pred: string = predicate.match(/(.+)\/\d+/)[1];// Extract the base predicate without arity
    let re = new RegExp("^:-\\s+use_module\\s*\\(\\s*.+\\b" + module + "\\b");// Regular expression to match an existing 'use_module' directive with the specified module
    let directiveLine: number = -1;
    let pos: Position;
    // Iterate through the lines to find an existing 'use_module' directive with the specified module
    lines.forEach(line => {
      if (re.test(doc.lineAt(line).text)) {
        directiveLine = line;
      }
    });
    // If an existing directive is found, add the predicate to the existing list
    if (directiveLine >= 0) {
      let line = directiveLine;
      // Move down to find the position where the predicate should be added
      while (doc.lineAt(line).text.indexOf("[") < 0) line++;
      // Find the start character of the list and position the cursor after it
      let startChar = doc.lineAt(line).text.indexOf("[");
      pos = new Position(line, startChar + 1);
      edit.insert(uri, pos, predicate + ",");// Insert the predicate into the list
    } else { // If no existing directive is found, add a new 'use_module' directive
      pos = new Position(lines[lines.length - 1], 0);
      edit.insert(
        uri,
        pos,
        `:- use_module(library(${module}), [${predicate}]).\n`
      );
    }
    // Apply the WorkspaceEdit to the document
    let result: Thenable<boolean> = null;
    try {
      result = workspace.applyEdit(edit);
    } catch (e) {
      console.log("Error in add dynamic declaration: " + e);
    }
    return result;
  }

  // Implementation of CodeActionProvider interface method
  provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): Command[] | Thenable<Command[]> {
    let codeActions: Command[] = [];// Initialize an array to store the generated code actions
    // Iterate through each diagnostic in the context
    context.diagnostics.forEach(diagnostic => {
      let regex = /Predicate (.+) not defined/;
      let match = diagnostic.message.match(regex);
      // Check if a match is found in the diagnostic message
      if (match[1]) {
        let pred = match[1];
        // Get modules associated with the predicate using utility function
        let modules = Utils.getPredModules(pred);
        // Check if modules are found for the predicate
        if (modules.length > 0) {
          // Generate code actions for each module and add them to the array
          modules.forEach(module => {
            codeActions.push({
              title:
                "Add ':- use_module(library(" + module + "), [" + pred + "]).'",
              command: this.commandAddUseModuleId,
              arguments: [
                document,
                pred,
                module,
                document.uri,
                diagnostic.range
              ]
            });
          });
        }
        // Extract module information from the document
        match = document.getText().match(/:-\s*module\((\w+),/);
        let module: string = "";
        if (match) {
          module = match[1];
        }
        // Handle predicates with namespace (module)
        if (pred.indexOf(":") > -1) {
          let [mod, pred1] = pred.split(":");
          if (mod === module) {
            pred = pred1;
          }
        }
        // Generate code action for adding 'dynamic' directive and add it to the array
        codeActions.push({
          title: "Add ':- dynamic " + pred + ".'",
          command: this.commandAddDynamicId,
          arguments: [document, pred, document.uri, diagnostic.range]
        });
      }
    });
    return codeActions; //An array of CodeAction commands or a Thenable that resolves to an array of CodeAction commands
  }

  // Method to parse an issue string obtained from the linter output
  private parseIssue(issue: string) {
    // Use regular expression to match different components of the issue
    let match = issue.match(this.swiRegex);
  
    // Check if a match is found
    if (match == null) return null;
  
    // Extract relevant information from the match
    let fileName = this.filePathIds[match[2]] ? this.filePathIds[match[2]] : match[2];
    let severity: DiagnosticSeverity;
  
    // Determine severity based on the issue type
    if (match[1] == "ERROR") severity = DiagnosticSeverity.Error;
    else if (match[1] == "Warning") severity = DiagnosticSeverity.Warning;
  
    // Parse line, column, and error message information
    let line = parseInt(match[3]) - 1;
    let fromCol = match[5] ? parseInt(match[5]) : 0;
    fromCol = fromCol < 0 ? 0 : fromCol;
    let toCol = match[7] ? parseInt(match[7]) : 200;
    let fromPos = new Position(line, fromCol);
    let toPos = new Position(line, toCol);
    let range = new Range(fromPos, toPos);
    let errMsg = match[8];
  
    // Create a new Diagnostic object
    let diag = new Diagnostic(range, errMsg, severity);
  
    // Add the Diagnostic object to the diagnostics collection
    if (diag) {
      if (!this.diagnostics[fileName]) {
        this.diagnostics[fileName] = [diag];
      } else {
        this.diagnostics[fileName].push(diag);
      }
    }
  }

  // Method to perform linting of a Prolog file
  private doPlint(textDocument: TextDocument) {
    // Check if the language of the document is Prolog
    if (textDocument.languageId != "prolog") {
      return;
    }
  
    // Initialize diagnostic-related data structures
    this.diagnostics = {};
    this.sortedDiagIndex = {};
    this.diagnosticCollection.delete(textDocument.uri);
  
    // Configure options for executing Prolog
    let options = workspace.workspaceFolders[0].uri.fsPath ? { cwd: workspace.workspaceFolders[0].uri.fsPath } : undefined;
  
    // Initialize arguments, goals, and other variables
    let args: string[] = [];
    let goals: string = "";
    let lineErr: string = "";
    let docTxt = textDocument.getText();
    let docTxtEsced = jsesc(docTxt, { quotes: "double" });
    let fname = jsesc(path.resolve(textDocument.fileName));
  
    // Determine Prolog dialect and set arguments accordingly
    switch (Utils.DIALECT) {
      case "swi":
        if (this.trigger === RunTrigger.onSave) {
          args = ["-g", "halt", fname];
        }
        if (this.trigger === RunTrigger.onType) {
          args = ["-q"];
          goals = `
            open_string("${docTxtEsced}", S),
            load_files('${fname}', [stream(S),if(true)]).
            list_undefined.
          `;
        }
        break;
      case "ecl":
        let dir = jsesc(path.resolve(`${this.context.extensionPath}/out/src/features`));
        if (this.trigger === RunTrigger.onSave) {
          const fdir = path.dirname(fname);
          const file = path.basename(fname);
          goals = `(cd("${dir}"),
          use_module('load_modules'),
          cd("${fdir}"),
          load_modules_from_file('${file}'),
          compile('${file}', [debug:off]),halt)`;
          args = ["-e", goals];
        }
        if (this.trigger === RunTrigger.onType) {
          goals = `(cd("${dir}"),
          use_module(load_modules),
          load_modules_from_text("${docTxtEsced}"),
          open(string("${docTxtEsced}"), read, S),
          compile(stream(S), [debug:off]),
          close(S),halt)`;
        }
      default:
        break;
    }
  
    // Execute the Prolog process
    spawn(this.executable, args, options)
      .on("process", process => {
        // Handle the Prolog process
        if (process.pid) {
          if (this.trigger === RunTrigger.onType) {
            process.stdin.write(goals);
            process.stdin.end();
          }
          if (this.enableOutput) {
            this.outputChannel.clear();
          }
        }
      })
      .on("stdout", out => {
        // Handle standard output
        if (Utils.DIALECT === "ecl" && !/checking completed/.test(out)) {
          if (/^File\s*/.test(out)) {
            if (lineErr) {
              this.parseIssue(lineErr + "\n");
              lineErr = '';
            }
            let match = out.match(/File\s*([^,]+),.*line\s*(\d+):\s*(.*)/);
            let fullName: string;
            if (match[1] === "string") {
              fullName = textDocument.fileName;
            } else {
              fullName = find.fileSync(
                new RegExp(match[1]),
                workspace.workspaceFolders[0].uri.fsPath
              )[0];
            }
            lineErr = "Warning:" + fullName + ":" + match[2] + ":" + match[3];
          } else if (/^\|/.test(out)) {
            lineErr += out;
          } else if (/WARNING/.test(out) && this.enableOutput) {
            this.outputMsg(out);
          }
        }
      })
      .on("stderr", (errStr: string) => {
        // Handle standard error
        switch (Utils.DIALECT) {
          case "swi":
            if (/which is referenced by/.test(errStr)) {
              let regex = /Warning:\s*(.+),/;
              let match = errStr.match(regex);
              lineErr = " Predicate " + match[1] + " not defined";
            } else if (/clause of /.test(errStr)) {
              let regex = /^(Warning:\s*(.+?):)(\d+):(\d+)?/;
              let match = errStr.match(regex);
              let line = parseInt(match[3]);
              let char = match[4] ? parseInt(match[4]) : 0;
              let rangeStr = line + ":" + char + ":200: ";
              let lineMsg = match[1] + rangeStr + lineErr;
              this.parseIssue(lineMsg + "\n");
            } else if (/:\s*$/.test(errStr)) {
              lineErr = errStr;
            } else {
              if (errStr.startsWith("ERROR") || errStr.startsWith("Warning")) {
                lineErr = errStr;
              } else {
                lineErr = lineErr.concat(errStr);
              }
              this.parseIssue(lineErr + "\n");
              lineErr = '';
            }
            break;
          case "ecl":
            if (this.enableOutput) {
              this.outputChannel.clear();
            }
            if (/^[fF]ile|^string stream|^Stream/.test(errStr)) {
              if (lineErr !== '') {
                this.parseIssue(lineErr + "\n");
                if (this.enableOutput) {
                  this.outputMsg(lineErr);
                }
                lineErr = '';
              }
              let fullName: string, line: string, msg: string;
              let match = errStr.match(
                /[fF]ile\s*([^,]+),\s*line\s*(\d+):\s*(.*)/
              );

              if (match) {
                fullName = find.fileSync(
                  new RegExp(match[1]),
                  workspace.workspaceFolders[0].uri.fsPath
                )[0];
                line = match[2];
                msg = match[3];
              } else {
                fullName = textDocument.fileName;
                match = errStr.match(/line\s*(\d+):\s*(.*)/);
                if (!match) {
                  match = errStr.match(/:(\d+):\s*(.*)/);
                }
                line = match[1];
                msg = match[2];
              }
              const msgType = /error:|[sS]tream/.test(lineErr) ? "ERROR:" : "WARNING:";
              lineErr = msgType + fullName + ":" + line + ":" + msg;
            } else if (!/^\s*$/.test(errStr)) {
              lineErr += "\n" + errStr;
            }
          default:
            break;
        }
      })
      .then(result => {
        // Handle the completion of the Prolog process
        if (lineErr !== '') {
          this.parseIssue(lineErr + "\n");
          lineErr = '';
        }
        for (let doc in this.diagnostics) {
          let index = this.diagnostics[doc]
            .map((diag, i) => {
              return [diag.range.start.line, i];
            })
            .sort((a, b) => {
              return a[0] - b[0];
            });
          this.sortedDiagIndex[doc] = index.map(item => {
            return item[1];
          });
          this.diagnosticCollection.set(Uri.file(doc), this.diagnostics[doc]);
        }
        if (this.enableOutput) {
          this.outputChannel.clear();
        }
        for (let doc in this.sortedDiagIndex) {
          let si = this.sortedDiagIndex[doc];
          for (let i = 0; i < si.length; i++) {
            let diag = this.diagnostics[doc][si[i]];
            let severity =
              diag.severity === DiagnosticSeverity.Error ? "ERROR" : "Warning";
            let msg = `${path.basename(doc)}:${diag.range.start.line +
              1}:\t${severity}:\t${diag.message}\n`;
            if (this.enableOutput) {
              this.outputChannel.append(msg);
            }
          }
          if (si.length > 0 && this.enableOutput) {
            this.outputChannel.show(true);
          }
        }
      })
      .catch(error => {
        // Handle error event
        let message: string = null;
        if ((<any>error).code === "ENOENT") {
          message =
            "Cannot lint the prolog file. The Prolog executable was not found. Use the 'prolog.executablePath' setting to configure";
        } else {
          message = error.message
            ? error.message
            : `Failed to run prolog executable using path: ${this
              .executable}. Reason is unknown.`;
        }
        this.outputMsg(message);
      });

  }

  // Method to load configuration settings
  private loadConfiguration(): void {
     // Get the configuration section for the Prolog extension
    let section = workspace.getConfiguration("prolog");
    // Check if the configuration section is available
    if (section) {
      this.executable = path.resolve(section.get<string>("executablePath", "swipl"));// Resolve the path to the Prolog executable
      // Determine the trigger type for the linter (onSave, onType, never)
      if (Utils.LINTERTRIGGER === "onSave") {
        this.trigger = RunTrigger.onSave;
      } else if (Utils.LINTERTRIGGER === "onType") {
        this.trigger = RunTrigger.onType;
      } else {
        this.trigger = RunTrigger.never;
      }
      // Dispose existing document and open document listeners if they exist
      if (this.documentListener) {
        this.documentListener.dispose();
      }
      if (this.openDocumentListener) {
        this.openDocumentListener.dispose();
      }
    }
    // Set up a listener for changes in the open text documents
    this.openDocumentListener = workspace.onDidOpenTextDocument(e => {
      this.triggerLinter(e);
    });
     // If the linter is triggered on type, set up a listener for document changes
    if (this.trigger === RunTrigger.onType) {
      this.delay = section.get<number>("linter.delay");
      this.documentListener = workspace.onDidChangeTextDocument(e => {
        this.triggerLinter(e.document);
      });
    } else {
      // If the linter is triggered on save or never, set up a listener for document save
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.documentListener = workspace.onDidSaveTextDocument(
        this.doPlint,
        this
      );
    }
    // Trigger linting for existing text documents
    workspace.textDocuments.forEach(this.triggerLinter, this);
  }

  // Method to trigger linting based on various events
  private triggerLinter(textDocument: TextDocument) {
    // Check if the document is a Prolog source file
    if (textDocument.languageId !== "prolog") {
      return;
    }
    // If the linter is set to trigger on type and there's a delay configured,use a timer to wait for typing to settle before linting
    if (this.trigger === RunTrigger.onType) {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.doPlint(textDocument);
      }, this.delay);
    } else if (this.trigger !== RunTrigger.never) {
      // Trigger linting immediately for onSave or never-trigger scenarios
      this.doPlint(textDocument);
    }
  }

  // Activate method to initialize the extension
  public activate(): void {
    let subscriptions: Disposable[] = this.context.subscriptions;// Get the existing subscriptions or create an empty array
    this.diagnosticCollection = languages.createDiagnosticCollection(); // Create a diagnostic collection for handling linting results
    // Register a listener for configuration changes
    workspace.onDidChangeConfiguration(
      this.loadConfiguration,
      this,
      subscriptions
    );
    // Load the initial configuration
    this.loadConfiguration();
    // Initialize the output channel if not created already
    if (this.outputChannel === null) {
      this.outputChannel = window.createOutputChannel("PrologLinter");
      this.outputChannel.clear();
    }
    // Register listeners based on the specified trigger (e.g., onSave)
    if (this.trigger === RunTrigger.onSave) {
      workspace.onDidOpenTextDocument(this.doPlint, this, subscriptions);
    }
    // Register a listener for text document closure to clear diagnostics
    workspace.onDidCloseTextDocument(
      textDocument => {
        this.diagnosticCollection.delete(textDocument.uri);
      },
      null,
      subscriptions
    );
  }

  // Output message to the console
  private outputMsg(msg: string) {
    this.outputChannel.append(msg + "\n");
    this.outputChannel.show(true);
  }

  // Method to get information about a clause in a Prolog document
  private getClauseInfo(
    doc: TextDocument,
    pred: IPredicate
  ): [string, number] | null {
    let docTxt = jsesc(doc.getText(), { quotes: "double" });// Escape special characters in the document text and convert it to a Prolog-compatible string
    // Construct the Prolog query to retrieve clause location
    let input = `
    clause_location(Pred) :-
      open_string("${docTxt}", S),
      load_files('${jsesc(doc.fileName)}', [module(user), stream(S), if(true)]),
      close(S),
      (   functor(Pred, :, 2)
      ->  Pred1 = pred
      ;   context_module(Mod),
          Pred1 = Mod:Pred
      ),
      clause(Pred1, _, R),
      clause_property(R, file(File)),
      clause_property(R, line_count(Line)), !,
      format('File=~s;Line=~d~n', [File, Line]).
    `;
    // Execute the Prolog query synchronously using the Utils.execPrologSync method
    let clauseInfo = Utils.execPrologSync(
      ["-q"],
      input,
      `clause_location(${pred.wholePred.split(":")[1]})`,
      "true",
      /File=(.+);Line=(\d+)/
    );
    // Return the clause location as a tuple [file path, line number] or null if not found
    return clauseInfo ? [clauseInfo[1], parseInt(clauseInfo[2])] : null;
  }

  // Method to export a predicate under the cursor
  /*
  public exportPredicateUnderCursor() {
    // Check if the dialect is ECL, as the export helper only works for SWI-Prolog
    if (Utils.DIALECT === "ecl") {
      this.outputMsg("export helper only works for SWI-Prolog now.");
      return;
    }
    // Get the active text editor and document
    let editor = window.activeTextEditor;
    let doc = editor.document;
    let docTxt = jsesc(doc.getText(), { quotes: "double" });
    // Get the cursor position and the predicate information under the cursor
    let pos = editor.selection.active;
    let pred = Utils.getPredicateUnderCursor(doc, pos);
    // Check if the predicate is valid for export
    if (pred.arity < 0) {
      this.outputMsg(`${pred.functor} is not a valid predicate to export.`);
      return;
    }

    let clauseInfo = this.getClauseInfo(doc, pred);// Get the clause information for the predicate
    // Check if the clause information is available
    if (clauseInfo == null) {
      this.outputMsg(`${pred.wholePred} is not a valid predicate to export.`);
      return;
    }
    // Check if the predicate is defined in the active source file
    if (clauseInfo[0] !== doc.fileName) {
      this.outputMsg(`${pred.wholePred} is not defined in active source file.`);
      return;
    }
    // Construct the Prolog query for rewriting the module declaration
    let input = `
    rewrite_module_declaration(Module, PI) :-
        setup_call_cleanup(
            open_string("${docTxt}", S),
            (   read_term(S, Term, [term_position(Pos)]),
                stream_position_data(line_count, Pos, Line),
                stream_position_data(line_position, Pos, Start),
                (   Term=(:-module(Module1, Exports))
                ->  (   memberchk(PI, Exports)
                    ->  ReTerm=none,
                        Action=none
                    ;   NewExp=[PI|Exports],
                        ReTerm=(:-module(Module1, NewExp)),
                        Action=replace
                    )
                ;   ReTerm=(:-module(Module, [PI])),
                    Action=insert
                ),
                format('Action=~s;Mod=~w;Line=~d;Start=~d;~n',
                    [Action, ReTerm, Line, Start])
            ),
            close(S)
        ).
    `;
    let modname = path.basename(doc.fileName).split(".")[0];// Get the module name from the document file name
    // Execute the Prolog query synchronously to get the module declaration information
    let modDec = Utils.execPrologSync(
      ["-q"],
      input,
      `rewrite_module_declaration('${modname}', ${pred.pi.split(":")[1]})`,
      "true",
      /Action=(\w+);Mod=(.+);Line=(\d+);Start=(\d+)/
    );
    // Extract the action, modified module declaration string, and line/start positions
    let action = modDec[1];
    let edit = new WorkspaceEdit();
    let lines = doc.getText().split("\n");
    let newModStr = modDec[2].replace(":-", ":- ") + ".\n\n";
    let modStartLine = parseInt(modDec[3]);
    let modStartChar = parseInt(modDec[4]);
    // Apply the edit based on the action (insert or replace)
    if (action === "insert") {
      edit.insert(
        Uri.file(doc.fileName),
        new Position(modStartLine - 1, modStartChar),
        newModStr
      );
      workspace.applyEdit(edit);
    } else if (action === "replace") {
      // For replace, find the end of the existing module declaration
      let modEndLine = parseInt(modDec[3]);
      while (!/\.\s*$/.test(lines[modEndLine - 1])) modEndLine++;
      let modEndChar = lines[modEndLine - 1].indexOf(".");
      let modRange = new Range(
        modStartLine - 1,
        modStartChar,
        modEndLine,
        modEndChar + 1
      );
      // Replace the existing module declaration with the modified one
      edit.replace(Uri.file(doc.fileName), modRange, newModStr);
      workspace.applyEdit(edit);
    }
    // Ask the user if they want to add structured comments to the exported predicate
    window
      .showInformationMessage(
        `'${pred.pi}' exported. Add structured comments to it?`,
        "yes",
        "no"
      )
      .then(answer => {
        if (answer !== "yes") {
          return;
        }
        // Add structured comments
        let comm = "%!\t" + pred.functor + "\n%\n%\n";
        let newClauseInfo = this.getClauseInfo(doc, pred);
        edit = new WorkspaceEdit();
        edit.insert(
          Uri.file(doc.fileName),
          new Position(newClauseInfo[1] - 1, 0),
          comm
        );
        workspace.applyEdit(edit);
      });
  }*/

  // Cleanup method to dispose of resources when the extension is deactivated
  public dispose(): void {
    this.documentListener.dispose();
    this.openDocumentListener.dispose();
    this.diagnosticCollection.clear();
    this.diagnosticCollection.dispose();
    this.commandAddDynamic.dispose();
    this.commandAddUseModule.dispose();
    this.commandExportPredicate.dispose();
  }

  // Method to navigate to the next error or warning line
  public nextErrLine() {
    this.gotoErrLine(0);
  }
  // Method to navigate to the previous error or warning line
  public prevErrLine() {
    this.gotoErrLine(1);
  }

  // Method to navigate to the error or warning line based on direction
  private gotoErrLine(direction: number) { //direction: 0: next, 1: previous
    const editor = window.activeTextEditor; // Get the active text editor
    let diagnostics = this.diagnosticCollection.get(editor.document.uri);// Get the diagnostics for the active document
    // If there are no diagnostics, display a message and return
    if (!diagnostics || diagnostics.length == 0) {
      this.outputMsg("No errors or warnings :)");
      return;
    }
    this.outputChannel.clear();// Clear the output channel
    const activeLine = editor.selection.active.line; // Get the active line in the editor
    let position: Position, i: number;
    let si = this.sortedDiagIndex[editor.document.uri.fsPath];// Get the sorted diagnostic index for the active document
    // Determine the navigation direction (next or previous)
    if (direction === 0) {
      i = 0;
      // If the active line is greater than or equal to the last diagnostic's start line,navigate to the start of the first diagnostic; otherwise, find the next diagnostic
      if (activeLine >= diagnostics[si[si.length - 1]].range.start.line) {
        position = diagnostics[si[0]].range.start;
      } else {
        // Find the next diagnostic based on the active line
        while (diagnostics[si[i]].range.start.line <= activeLine) {
          i = i === si.length - 1 ? 0 : i + 1;
        }
        position = diagnostics[si[i]].range.start;
      }
    } else {
      // If the active line is less than or equal to the first diagnostic's start line, navigate to the start of the last diagnostic; otherwise, find the previous diagnostic
      i = si.length - 1;
      if (activeLine <= diagnostics[si[0]].range.start.line) {
        position = diagnostics[si[i]].range.start;
      } else {
        // Find the previous diagnostic based on the active line
        while (diagnostics[si[i]].range.start.line >= activeLine) {
          i = i === 0 ? si.length - 1 : i - 1;
        }
        position = diagnostics[si[i]].range.start;
      }
    }
    editor.revealRange(diagnostics[si[i]].range, TextEditorRevealType.InCenter);// Reveal the range of the diagnostic in the editor
    // Iterate through the diagnostics and display the one at the selected position
    diagnostics.forEach(item => {
      if (item.range.start.line === position.line) {
        let severity =
          item.severity === DiagnosticSeverity.Error
            ? "ERROR:\t\t"
            : "Warning:\t";
        this.outputChannel.append(severity + item.message + "\n");
      }
    });
    editor.selection = new Selection(position, position);// Set the editor selection to the diagnostic's start position
    this.outputChannel.show(true); // Show the output channel
  }
}
