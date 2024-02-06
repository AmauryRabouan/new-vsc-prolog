"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
  commands,
  DocumentFilter,
  ExtensionContext,
  Terminal,
  TextDocument,
  window,
  languages,
  DocumentHighlightProvider,
  Location,
  Disposable,
  TextEdit,
  workspace
} from "vscode";
import * as path from "path";
import PrologTerminal from "./features/prologTerminal";
import { loadEditHelpers } from "./features/editHelpers";
import { Utils } from "./utils/utils";
import PrologHoverProvider from "./features/hoverProvider";
import PrologDocumentHighlightProvider from "./features/documentHighlightProvider";
import { SnippetUpdater ,SnippetUpdaterController, PrologCompletionProvider} from "./features/updateSnippets";
import {PrologFormatter} from "./features/prologFormatter";
import {PrologDebugger} from "./features/prologDebugger";
import { PrologDefinitionProvider } from "./features/definitionProvider";
import { PrologReferenceProvider } from "./features/referenceProvider";
import PrologLinter from "./features/prologLinter";
import { PrologRefactor } from "./features/prologRefactor";
import { ensureSymlink, remove } from "fs-extra-plus";
import jsesc from "jsesc";
import * as fs from "fs";

// initialisation of workspace
async function initForDialect(context: ExtensionContext) {
  // get the user preferences for the extention
  const section = workspace.getConfiguration("prolog");
  const dialect = section.get<string>("dialect");
  const exec = section.get<string>("executablePath", "swipl");
  Utils.LINTERTRIGGER = section.get<string>("linter.run");
  Utils.FORMATENABLED = section.get<boolean>("format.enabled");
  Utils.DIALECT = dialect;
  Utils.RUNTIMEPATH = jsesc(exec);
  const exPath = jsesc(context.extensionPath);
  Utils.EXPATH = exPath;
  // check if the dialect links have already been done
  const diaFile = path.resolve(`${exPath}/.vscode`) + "/dialect.json";
  const lastDialect = JSON.parse(fs.readFileSync(diaFile).toString()).dialect;
  if (lastDialect === dialect) {
    return;
  }

  // creating links for the right dialect 
  const symLinks = [
    {
      path: path.resolve(`${exPath}/syntaxes`),
      srcFile: `prolog.${dialect}.tmLanguage.json`,
      targetFile: "prolog.tmLanguage.json"
    },
    {
      path: path.resolve(`${exPath}/snippets`),
      srcFile: `prolog.${dialect}.json`,
      targetFile: "prolog.json"
    }
  ];
  await Promise.all(
    symLinks.map(async link => {
      // remove old link
      await remove(path.resolve(`${link.path}/${link.targetFile}`));
      // make link
      try {
        return await ensureSymlink(
          path.resolve(`${link.path}/${link.srcFile}`),
          path.resolve(`${link.path}/${link.targetFile}`)
        );
      // if not succed you shoud try to run vsc in administator role
      } catch (err) {
        window.showErrorMessage("VSC-Prolog failed in initialization. Try to run vscode in administrator role.");
        throw (err);
      }
    })
  );
  // write the dialect to the json for later initialisation
  fs.writeFileSync(diaFile, JSON.stringify({ dialect: dialect }));
}
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {
  console.log('Congratulations, your extension "vsc-prolog" is now active! :)');

  // initialisation of workspace
  await initForDialect(context);

  // filter the files to process
  const PROLOG_MODE: DocumentFilter = { language: "prolog", scheme: "file" };

  // initialisation of utils class and load snippets file with it's predicates
  Utils.init(context);
  // automatic indent on change
  loadEditHelpers(context.subscriptions);
  // extention special commands
  let myCommands = [
    {
      command: "prolog.load.document",
      callback: () => {
        PrologTerminal.loadDocument();
      }
    },
    {
      command: "prolog.query.goal",
      callback: () => {
        PrologTerminal.queryGoalUnderCursor();
      }
    },
    {
      command: "prolog.refactorPredicate",
      callback: () => {
        new PrologRefactor().refactorPredUnderCursor();
      }
    }
  ];
  // error detection and possible patch
  let linter: PrologLinter;
  if (Utils.LINTERTRIGGER !== "never") {
    linter = new PrologLinter(context);
    linter.activate();
    // extention special commands for linter
    myCommands = myCommands.concat([
      {
        command: "prolog.linter.nextErrLine",
        callback: () => {
          linter.nextErrLine();
        }
      },
      {
        command: "prolog.linter.prevErrLine",
        callback: () => {
          linter.prevErrLine();
        }
      }
    ]);
  }
  // register commands
  myCommands.map(command => {
    context.subscriptions.push(
      commands.registerCommand(command.command, command.callback)
    );
  });
  // if linter is not prohibited by the user
  if (Utils.LINTERTRIGGER !== "never") {
    context.subscriptions.push(
      languages.registerCodeActionsProvider(PROLOG_MODE, linter)
    );
  }
  // Hover provider
  context.subscriptions.push(
    languages.registerHoverProvider(PROLOG_MODE, new PrologHoverProvider())
  );
  //Highlight provider
  context.subscriptions.push(
    languages.registerDocumentHighlightProvider(
      PROLOG_MODE,
      new PrologDocumentHighlightProvider()
    )
  );
  // Definition provider (go to definition command)
  context.subscriptions.push(
    languages.registerDefinitionProvider(
      PROLOG_MODE,
      new PrologDefinitionProvider()
    )
  );
  // Reference provider (find all references command)
  context.subscriptions.push(
    languages.registerReferenceProvider(
      PROLOG_MODE,
      new PrologReferenceProvider()
    )
  );
  // create prolog terminal (load file command)
  context.subscriptions.push(PrologTerminal.init());
  //PrologDebugger;

  // add created predicate to the snippet
  let snippetUpdater = new SnippetUpdater();
  context.subscriptions.push(new SnippetUpdaterController(snippetUpdater));
  context.subscriptions.push(snippetUpdater);

  // auto completion provider
  context.subscriptions.push(
    languages.registerCompletionItemProvider(PROLOG_MODE,new PrologCompletionProvider())
  );
  
  // file formating provider
  context.subscriptions.push(
    languages.registerDocumentRangeFormattingEditProvider(
      PROLOG_MODE,
      new PrologFormatter()
    )
  );
  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider(PROLOG_MODE, new PrologFormatter())
  );

}


// this method is called when your extension is deactivated
export function deactivate() { }


