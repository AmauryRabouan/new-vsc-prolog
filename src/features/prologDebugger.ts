import { EventEmitter } from "events";
import * as fs from "fs";
import { spawn } from "process-promises";
import { DebugProtocol } from "@vscode/debugprotocol";
import { PrologDebugSession } from "./prologDebugSession";
import {
  StoppedEvent,
  StackFrame,
  Source,
  OutputEvent,
  TerminatedEvent
} from "@vscode/debugadapter";
import { basename, resolve } from "path";
import jsesc from "jsesc";

export interface ITraceCmds {
  continue: string[2];
  stepover: string[2];
  stepinto: string[2];
  stepout: string[2];
}
export interface LaunchRequestArguments
  extends DebugProtocol.LaunchRequestArguments {
  program?: string;
  args?: string[];
  cwd: string;
  runtimeExecutable?: string;
  runtimeArgs?: string[];
  env?: { [key: string]: string };
  startupQuery?: string;
  stopOnEntry?: boolean;
  terminalDebuggerPort?: number;
  console?: string;
  traceCmds?: ITraceCmds;
}
export interface ITraceCmds {
  Run: string[];
  Stepin: string[];
  Stepover: string[];
  Stop: string[];
}

export interface IBreakPoint {
  sourceFile: string;
  line: number;
  id?: number;
}

interface ISourceLineLocations {
  [sourceFile: string]: number[];
}
// Define PrologDebugger class
export class PrologDebugger extends EventEmitter {
  private _prologProc = null;
  // private _traceCmds: ITraceCmds;
  private _breakpoints: IBreakPoint[] = [];
  private _launchRequestArguments: LaunchRequestArguments;
  private _debugSession: PrologDebugSession;
  private _bpResponse: DebugProtocol.SetBreakpointsResponse;
  private _fbpResponse: DebugProtocol.SetFunctionBreakpointsResponse;
  private _soureLineLocations: ISourceLineLocations;

  // private _client: Net.Socket = null;

  constructor(
    launchRequestArguments: LaunchRequestArguments,
    debugSession: PrologDebugSession
  ) {
    super();
    this._launchRequestArguments = launchRequestArguments;
    this._debugSession = debugSession;
    this._soureLineLocations = {};
    // this._client = client || null;
    this.createPrologProc();

    console.log("prolog debugger constructed");
  }

  // Helper function to retrieve source line locations
  private getSourceLineLocations(source: string) {
    // If line locations for this source file are already cached, return
    if (this._soureLineLocations[source]) {
      return;
    }
    // Read the content of the source file and split it into lines
    let lines = fs
      .readFileSync(source)
      .toString()
      .split("\n");
    // Calculate the length of each line (including the newline character)
    let lengths = lines.map(line => {
      return line.length + 1;
    });
    lengths.unshift(0);// Add a starting index of 0 to the lengths array
    // Accumulate the lengths to get the character position for each line
    for (let i = 1; i < lengths.length; i++) {
      lengths[i] += lengths[i - 1];
    }
    this._soureLineLocations[source] = lengths;// Cache the line locations for the source file
  }

  // Helper function to convert startChar to line and column
  private fromStartCharToLineChar(source: string, startChar: number) {
    this.getSourceLineLocations(source);// Ensure that line locations for the source file are available
    let i = 0;
    for (; this._soureLineLocations[source][i] < startChar; i++);// Find the line index where the given character position is located
    // Calculate the line number and column offset for the character position
    return {
      file: source,
      line: i + 1,
      startChar: startChar - this._soureLineLocations[source][i]
    };
  }
  //Handles the output received from the Prolog debugger, parsing and processing relevant information.
  private handleOutput(data: string) {
    let resObj;
    try {
      // Attempt to parse the output data as JSON
      resObj = JSON.parse(data);
      // Check if the parsed object has a "response" key
      if (Object.keys(resObj)[0] !== "response") {
        return;
      }
    } catch (error) {
      return;// Exit if there is an error during JSON parsing
    }
    // Determine the type of response based on the first key in the "response" object
    switch (Object.keys(resObj.response)[0]) {
      // Process breakpoints response
      case "breakpoints":
        this._bpResponse.body = {
          breakpoints: resObj.response.breakpoints.map(b => {
            b.source = { path: b.source };
            return b;
          })
        };
        this.emit("responseBreakpoints", this._bpResponse);
        return;
      // Process function breakpoints response
      case "functionbps":
        this._fbpResponse.body = {
          breakpoints: resObj.response.functionbps
        };
        this.emit("responseFunctionBreakpoints", this._fbpResponse);
        return;
      // Process frame response
      case "frame":
        let frame = resObj.response.frame;
        this._debugSession.addStackFrame(frame);
        this._debugSession.sendEvent(
          new StoppedEvent(frame.name, PrologDebugSession.THREAD_ID)
        );
        return;
      // Process variables response
      case "variables":
        this._debugSession.setCurrentVariables(resObj.response.variables);
        return;

      default:
        break;
    }
  }

  // Send a query to Prolog process
  public query(goal: string) {
    // Check if the goal is not an empty line
    if (!/^\n$/.test(goal)) {
      goal = goal.replace(/\n+/g, "\n");// Replace multiple consecutive newlines with a single newline
      let from = goal.indexOf(":");// Find the index of the colon in the goal
      // If no colon is found, exit the function
      if (from < 0) {
        return;
      }
      // Write the Prolog query (substring after the colon) to the Prolog process stdin
      this._prologProc.stdin.write(goal.substring(from + 1));
    }
  }

  // Kill the Prolog process
  private killPrologProc() {
    if (this._prologProc) {
      this._prologProc.kill();
    }
  }

  // Filter off unwanted output data
  private filterOffOutput(data: string): boolean {
    // Predefined regular expressions to filter off specific types of output
    const regs = [
      /^$/,                 // Empty line
      /^TermToBeEvaluated/, // Output indicating a term to be evaluated
      /^EvalTermAtom/,      // Output indicating evaluation of a term atom
      /^EvalVarNames/,      // Output indicating evaluation of variable names
      /^E =/,               // Output indicating an assignment
      /^true\./             // Output indicating truth value 'true'
    ];
    // Iterate through the predefined regular expressions
    for (let i = 0; i < regs.length; i++) {
      // Test if the data matches any of the regular expressions
      if (regs[i].test(data)) {
        return true;// Return true if a match is found (filter off)
      }
    }
    // Return false if no match is found (do not filter off)
    return false;
  }

  // get the pid of the prolog processus
  public get pid(): number {
    return this._prologProc.pid;
  }

  // Initialize Prolog debugger
  public initPrologDebugger() {
    // Obtain the directory path for the 'debugger' module and escape special characters
    let dbg = jsesc(resolve(`${__dirname}/debugger`));
    console.log(dbg);
    // Write Prolog commands to the process stdin for initialization
    this._prologProc.stdin.write(`
          use_module('${dbg}').\n
          prolog_debugger:load_source_file('${jsesc(
        this._launchRequestArguments.program
      )}').
            `);
  }

  // Create Prolog process
  private async createPrologProc() {
    console.log("path:" + this._launchRequestArguments.runtimeExecutable);
    this.killPrologProc();// Kill the existing Prolog process, if any
    // Use 'spawn' to create a new Prolog process
    let pp = await spawn(
      jsesc(this._launchRequestArguments.runtimeExecutable),
      this._launchRequestArguments.runtimeArgs.concat("-q"),
      { cwd: this._launchRequestArguments.cwd }
    )
      .on("process", proc => {
        // If the process has a valid PID, set it to the _prologProc and initialize the debugger
        if (proc.pid) {
          this._prologProc = proc;
          this.initPrologDebugger();
        }
      })
      .on("stdout", data => {
        //this._debugSession.debugOutput("\n" + data);
        // Check if the data contains a "response" indicating debugger information
        if (/"response":/.test(data)) {
          this.handleOutput(data);
        } else if (!this.filterOffOutput(data)) {
          // If not a "response", output to the debug session (excluding filtered data)
          this._debugSession.debugOutput("\n" + data);
        }
      })
      .on("stderr", err => {
        // Output stderr data to the debug session
        this._debugSession.sendEvent(new OutputEvent(err + "\n", "stderr"));
      })
      .on("exit", () => {
        // Send termination event when the process exits
        this._debugSession.sendEvent(new TerminatedEvent());
      })
      .then(result => {
        // Log the exit code of the Prolog process
        this._debugSession.debugOutput(
          "\nProlog process exit with code:" + result.exitCode
        );
      })
      .catch(error => {
        // Handle errors during process creation or execution
        let message: string = null;
        if ((<any>error).code === "ENOENT") {
          message = `Cannot debug the prolog file. The Prolog executable '${
            this._launchRequestArguments.runtimeExecutable
            }' was not found. Correct 'runtimeExecutable' setting in launch.json file.`;
        } else {
          message = error.message
            ? error.message
            : `Failed to run swipl using path: ${
            this._launchRequestArguments.runtimeExecutable
            }. Reason is unknown.`;
        }
        // Output the error message to the debug session and throw an error
        this._debugSession.debugOutput("\n" + message);
        throw new Error(error);
      });
  }
  //Sends Prolog consult command to the Prolog process.
  private consult() {
    let fileName = this._launchRequestArguments.program;// Get the file name from launch request arguments
    let goals = "['" + fileName + "'].\n";// Prepare Prolog goals for consulting the specified file
    this._prologProc.stdin.write(goals);// Write the goals to the Prolog process stdin
  }

  //Sets breakpoints for the Prolog debugger based on the specified arguments
  public setBreakpoints(
    breakpoints: DebugProtocol.SetBreakpointsArguments,
    bpResponse: DebugProtocol.SetBreakpointsResponse
  ) {
    this._bpResponse = bpResponse;// Set the breakpoint response to be populated with results
    let path = jsesc(resolve(breakpoints.source.path));// Escape and resolve the path of the source file
    // Map breakpoints to a serialized format for Prolog debugger
    let bps = breakpoints.breakpoints.map(bp => {
      return JSON.stringify({
        line: bp.line,
        column: bp.column,
        condition: bp.condition,
        hitCondition: bp.hitCondition
      });
    });
    // Construct Prolog debugger command to set breakpoints
    let cmd = `cmd:prolog_debugger:set_breakpoints('${path}', ${JSON.stringify(
      bps.join(";")
    )}).\n`;
    // Send the command to the Prolog process
    this.query(cmd);
  }

  //Sets function breakpoints for the Prolog debugger based on the specified arguments
  public setFunctionBreakpoints(
    args: DebugProtocol.SetFunctionBreakpointsArguments,
    response: DebugProtocol.SetFunctionBreakpointsResponse
  ) {
    // Extract predicate names from the function breakpoint arguments
    let preds = args.breakpoints.map(bp => {
      return bp.name;
    });
    this._fbpResponse = response;// Set the function breakpoint response to be populated with results
    let cmd = `cmd:prolog_debugger:spy_predicates([${preds}]).\n`;// Construct Prolog debugger command to spy on predicates
    this.query(cmd);// Send the command to the Prolog process
  }

  //Initiates the Prolog debugger startup with the specified goal
  public startup(goal: string) {
    let cmd = `cmd:prolog_debugger:startup(${goal}).\n`;// Construct Prolog debugger command for startup with the specified goal
    this.query(cmd); // Send the command to the Prolog process
  }

  //Disposes of the Prolog debugger instance by killing the Prolog process
  public dispose(): void {
    this.killPrologProc();
  }
  
}
