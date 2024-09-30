
import {
  DebugSession,
  ErrorDestination,
  OutputEvent,
  InitializedEvent,
  StackFrame,
  Source,
  Scope,
  Thread
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import {
  ITraceCmds,
  LaunchRequestArguments,
  PrologDebugger
} from "./prologDebugger";
import * as path from "path";
import { spawn, SpawnOptions } from "process-promises";
import { ClientRequest } from "http";

// Extends the DebugSession class, providing the implementation for a Prolog debugger
export class PrologDebugSession extends DebugSession {
  private static SCOPEREF = 1;
  public static THREAD_ID = 100;
  private _prologDebugger: PrologDebugger;
  private _runtimeExecutable: string;
  // private _runtimeArgs: string[];
  private _startupQuery: string;
  private _startFile: string;
  private _cwd: string;
  private _stopOnEntry: boolean;
  private _traceCmds: ITraceCmds;
  private _currentVariables: DebugProtocol.Variable[] = [];
  private _stackFrames: DebugProtocol.StackFrame[] = [];
  private _debugging: boolean;

  public constructor() {
    super();
    this.setDebuggerColumnsStartAt1(true);
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerPathFormat("native");
  }
  // Implements the initialization logic for the debugger
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ): void {
    // Configure the response body with supported features and options
    response.body = {
      supportsConfigurationDoneRequest: true,
      supportTerminateDebuggee: true,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsExceptionOptions: true,
      supportsExceptionInfoRequest: true,
      // Define exception breakpoint filters with associated labels
      exceptionBreakpointFilters: [
        {
          filter: "Notice",
          label: "Notices"
        },
        {
          filter: "Warning",
          label: "Warnings"
        },
        {
          filter: "Error",
          label: "Errors"
        },
        {
          filter: "Exception",
          label: "Exceptions"
        },
        {
          filter: "*",
          label: "Everything",
          default: true
        }
      ]
    };
    // Send the initialized response back to the client
    this.sendResponse(response);
  }
  //Handles the 'attach' request from the debugger client
  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: DebugProtocol.AttachRequestArguments
  ) {
    // Send an error response indicating that attach requests are not supported
    this.sendErrorResponse(
      response,
      new Error("Attach requests are not supported")
    );
    // Shutdown the debugger session
    this.shutdown();
  }

  // Adds a stack frame to the list of stack frames during debugging
  public addStackFrame(frame: {
    id: number;
    level: number;
    name: string;
    file: string;
    line: number;
    column: number;
  }) {
    // Construct a new StackFrame object with information from the provided frame
    this._stackFrames.unshift(
      new StackFrame(
        frame.id,
        `(${frame.level})${frame.name}`,
        new Source(
          path.basename(frame.file),// Extract the base name of the file
          frame.file
        ),
        this.convertDebuggerLineToClient(frame.line),// Convert debugger line to client line
        this.convertDebuggerColumnToClient(frame.column)// Convert debugger column to client column
      )
    );
  }

  //Sets the current variables in the debugger session
  public setCurrentVariables(vars: DebugProtocol.Variable[]) {
    this._currentVariables = [];// Clear existing variables in _currentVariables array
    // Pop elements from the provided vars array and push them into _currentVariables
    while (vars.length > 0) {
      this._currentVariables.push({ ...vars.pop(), variablesReference: 0 });
    }
  }

  // Handles the 'launch' request from the debugger client
  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments,
    request?: DebugProtocol.Request
  ) {
    let richArgs = args as LaunchRequestArguments;// Cast arguments to LaunchRequestArguments for access to specific properties
    // Set various parameters from the launch arguments or use defaults
    this._startupQuery = richArgs.startupQuery || "start";
    this._startFile = path.resolve(richArgs.program);
    this._cwd = richArgs.cwd;
    this._runtimeExecutable = richArgs.runtimeExecutable || "swipl";
    // this._runtimeArgs = args.runtimeArgs || null;
    this._stopOnEntry = typeof richArgs.stopOnEntry ? richArgs.stopOnEntry : true;
    this._traceCmds = richArgs.traceCmds;
    this._prologDebugger = new PrologDebugger(richArgs, this);// Initialize the Prolog debugger
    // Add listeners for breakpoint responses
    this._prologDebugger.addListener(
      "responseBreakpoints",
      (bps: DebugProtocol.SetBreakpointsResponse) => {
        this.sendResponse(bps);
      }
    );
    this._prologDebugger.addListener(
      "responseFunctionBreakpoints",
      (fbps: DebugProtocol.SetFunctionBreakpointsResponse) => {
        this.sendResponse(fbps);
      }
    );
    this.sendResponse(response);// Send the launch response back to the client
    this.sendEvent(new InitializedEvent());// Send an 'Initialized' event to the client, indicating that the debugger is ready
  }

  // Handles the 'threads' request from the debugger client
  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // Configure the response body with information about the threads
    response.body = {
      threads: [new Thread(PrologDebugSession.THREAD_ID, "thread 1")]
    };
    this.sendResponse(response); // Send the threads response back to the client
  }

  // Handles the 'setBreakpoints' request from the debugger client
  protected setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ) {
    // Check if the debugger is currently in a debugging session
    if (this._debugging) {
      // Display a message indicating that breakpoints set during debugging will take effect in the next debugging process
      this.debugOutput(
        "Breakpoints set during debugging would take effect in next debugging process."
      );
      return;// Return without setting breakpoints during an active debugging session
    }
    this._prologDebugger.setBreakpoints(args, response);// Delegate the task of setting breakpoints to the Prolog debugger
  }

  // Handles the 'setExceptionBreakpoints' request from the debugger client
  protected setExceptionBreakPointsRequest(
    response: DebugProtocol.SetExceptionBreakpointsResponse,
    args: DebugProtocol.SetExceptionBreakpointsArguments
  ): void {
    // Send a response back to the client without modifying exception breakpoints
    this.sendResponse(response);
  }

  // Handles the 'setFunctionBreakpoints' request from the debugger client
  protected setFunctionBreakPointsRequest(
    response: DebugProtocol.SetFunctionBreakpointsResponse,
    args: DebugProtocol.SetFunctionBreakpointsArguments
  ): void {
    // Delegate the task of setting function breakpoints to the Prolog debugger
    this._prologDebugger.setFunctionBreakpoints(args, response);
  }

  // Handles the 'configurationDone' request from the debugger client
  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    this.sendResponse(response);// Send a response back to the client
    this._prologDebugger.startup(`${this._startupQuery}`);// Start the Prolog debugger and execute startup commands
    // If not stopping on entry, continue the execution
    if (!this._stopOnEntry) {
      this._prologDebugger.query(`cmd:${this._traceCmds.continue[1]}\n`);
    }
    this._prologDebugger.query(`cmd:${this._traceCmds.stepinto[1]}\n`);// Issue a step into command to initiate the debugging process
    this._debugging = true;// Set the debugging flag to true
  }

  // Evaluates the expression to retrieve the value of a variable
  private evaluateExpression(exp: string) {
    const vars = this._currentVariables;
    // Iterate through the current variables
    for (let i = 0; i < vars.length; i++) {
      // Check if the variable name matches the provided expression
      if (vars[i].name === exp) {
        return vars[i].value;// Return the value of the variable
      }
    }
    return null;// Return null if the variable is not found
  }

  // Handles the 'evaluate' request from the debugger client
  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    let val = this.evaluateExpression(args.expression);// Evaluate the expression to retrieve the value
    // If a value is found, send the result back to the client
    if (val) {
      response.body = {
        result: val,
        variablesReference: 0
      };
      this.sendResponse(response);
      return;
    } else {
      if (args.context === "repl") {
        const vars = this._currentVariables;
        let exp = args.expression.trim();
        if (exp.startsWith(":")) {
          // Workaround for input from stdin
          let input = "input" + args.expression;
          this._prologDebugger.query(input + "\n");
        } else {
          // Replace variable references in the expression with their values
          for (let i = 0; i < vars.length; i++) {
            let re = new RegExp("\\b" + vars[i].name + "\\b", "g");
            exp = exp.replace(re, vars[i].value);
          }
          this.debugOutput(args.expression);
          this.evaluate(exp);// Evaluate the modified expression
        }
        response.body = { result: "", variablesReference: 0 };
      }
      this.sendResponse(response); // Send the response back to the client
      return;
    }
  }

  // Handles the 'stackTrace' request from the debugger client
  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ): void {
    // Configure the response body with information about the stack frames
    response.body = {
      stackFrames: this._stackFrames
    };
    this.sendResponse(response);// Send the stack trace response back to the client
  }

  // Handles the 'variables' request from the debugger client
  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    const variables = new Array<DebugProtocol.Variable>();
    // Copy variables from _currentVariables to the response
    for (let i = 0; i < this._currentVariables.length; i++) {
      variables.push(this._currentVariables[i]);
    }
    // Configure the response body with information about the variables
    response.body = {
      variables: variables
    };
    this.sendResponse(response);// Send the variables response back to the client
  }

  //Handles the 'scopes' request from the debugger client
  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    const scopes = new Array<Scope>();
    scopes.push(new Scope("Local", PrologDebugSession.SCOPEREF++, false));// Add a Local scope to the response
    // Configure the response body with information about the scopes
    response.body = {
      scopes: scopes
    };
    this.sendResponse(response);// Send the scopes response back to the client
  }

  // Handles the 'continue' request from the debugger client
  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    args: DebugProtocol.ContinueArguments
  ): void {

    this._prologDebugger.query(`cmd:${this._traceCmds.continue[1]}\n`);// Send a continue command to the Prolog debugger
    this.sendResponse(response);// Send the continue response back to the client
  }

  // Handles the 'next' request from the debugger client
  protected nextRequest(
    response: DebugProtocol.NextResponse,
    args: DebugProtocol.NextArguments
  ): void {
    this._prologDebugger.query(`cmd:${this._traceCmds.stepover[1]}\n`);// Send a step-over command to the Prolog debugger
    this.sendResponse(response);// Send the next response back to the client
  }

  // Handles the 'stepIn' request from the debugger client
  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    args: DebugProtocol.StepInArguments
  ): void {
    this._prologDebugger.query(`cmd:${this._traceCmds.stepinto[1]}\n`);// Send a step-into command to the Prolog debugger
    this.sendResponse(response);// Send the step-in response back to the client
  }

  // Handles the 'stepOut' request from the debugger client
  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    args: DebugProtocol.StepOutArguments
  ): void {
    this._prologDebugger.query(`cmd:${this._traceCmds.stepout[1]}\n`);// Send a step-out command to the Prolog debugger
    this.sendResponse(response);// Send the step-out response back to the client
  }

  // Handles the 'disconnect' request from the debugger client
  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): void {
    this._debugging = false;// Mark the end of the debugging session
    this._prologDebugger.dispose();// Dispose of the Prolog debugger
    this.shutdown();// Shutdown the debugger
    this.sendResponse(response);// Send the disconnect response back to the client
  }

  // Handles the 'restart' request from the debugger client
  protected restartRequest(
    response: DebugProtocol.RestartResponse,
    args: DebugProtocol.RestartArguments
  ): void {
    this._debugging = false;// Mark the end of the debugging session
    this._prologDebugger.dispose();// Dispose of the Prolog debugger
    this.shutdown();// Shutdown the debugger
    this.sendResponse(response);// Send the restart response back to the client
  }
  // Sends an error response back to the debugger client
  protected sendErrorResponse(
    response: DebugProtocol.Response,
    error: Error,
    dest?: ErrorDestination
  ): void;

  // Sends an error response back to the debugger client
  protected sendErrorResponse(
    response: DebugProtocol.Response,
    codeOrMessage: number | DebugProtocol.Message,
    format?: string,
    variables?: any,
    dest?: ErrorDestination
  ): void;

  // Sends an error response back to the debugger client
  protected sendErrorResponse(response: DebugProtocol.Response) {
    // Check if the second argument is an instance of Error
    if (arguments[1] instanceof Error) {
      // Extract error information from the second and third arguments
      const error = arguments[1] as Error & {
        code?: number | string;
        errno?: number;
      };
      const dest = arguments[2] as ErrorDestination;
      // Determine the error code
      let code: number;
      if (typeof error.code === "number") {
        code = error.code as number;
      } else if (typeof error.errno === "number") {
        code = error.errno;
      } else {
        // Default to 0 if no valid code is found
        code = 0;
      }
      super.sendErrorResponse(response, code, error.message, dest);// Forward the error response to the superclass method
    } else {
      // If the second argument is not an instance of Error, forward the response as is
      super.sendErrorResponse(
        response,
        arguments[1],
        arguments[2],
        arguments[3],
        arguments[4]
      );
    }
  }

  // Sends a debug output event with the specified message to the debugger client
  public debugOutput(msg: string) {
    // Send a debug output event with the specified message
    this.sendEvent(new OutputEvent(msg));
  }

  // Evaluates the specified Prolog expression by spawning a new process
  private evaluate(expression: string) {
    // Get the runtime executable, program arguments, and input for the Prolog process
    let exec = this._runtimeExecutable;
    let args = ["-q", `${this._startFile}`];
    let input = `
    call((${expression})).
    halt.
    `;
    // Configure spawn options with the current working directory
    let spawnOptions: SpawnOptions = {
      cwd: this._cwd
    };
    // Spawn a new process for Prolog execution
    spawn(exec, args, spawnOptions)
    // If the process has a valid PID, write input to its stdin and end the input stream
      .on("process", proc => {
        if (proc.pid) {
          proc.stdin.write(input);
          proc.stdin.end();
        }
      })
      .on("stdout", data => {
        // Handle standard output by sending it as debug output
        this.debugOutput("\n" + data);
      })
      .on("stderr", err => {
        // Handle standard error by sending it as debug output
        this.debugOutput("\n" + err);
      })
      .catch(err => {
        // Handle any errors by sending the error message as debug output
        this.debugOutput(err.message);
      });
  }
}

DebugSession.run(PrologDebugSession);//start of the Prolog debug session
