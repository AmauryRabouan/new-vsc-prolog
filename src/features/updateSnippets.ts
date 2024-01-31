import { Variable } from "@vscode/debugadapter";
import {
  TextDocument,
  window,
  Disposable,
  Position,
  CancellationToken,
  CompletionContext,
  CompletionItem,
  SnippetString,
  MarkdownString,
  Uri,
  workspace,
  CompletionItemKind,

} from "vscode";
import * as fs from "fs";
import { Utils} from "../utils/utils";



// Class responsible for updating snippets based on prolog files
export class SnippetUpdater {

  // Update snippets based on new predicates create by the user in the document
  public updateSnippet() {
      // Get the currently active text editor
      let editor = window.activeTextEditor; 
      if (!editor) { 
          return; 
      } 

      let doc = editor.document; 
      // Update only if the document is a prolog file
      if (doc.languageId === "prolog") { 
        // Retrieve predicates from the document and check against existing snippets
        var predicats = this._getPredicat(doc); 
        var already = [];
        // Extract existing snippets' names for comparison
        Object.keys(Utils.snippets).forEach((elem)=>{
          if(elem.includes(":")){
            if(elem.includes(":-")){
              already.push(elem.replace(":- ",""));
            }else{
              already.push(elem.split(":")[1]);
            }
          }else{
            already.push(elem);
          }
        });
        // Update snippets based on new predicates in the document
        predicats.forEach((elem)=>{
          let num = elem[1].split(",").length
          if(!already.includes(elem[0]+"/"+num.toString())){
            Utils.snippets[elem[0]+"/"+num.toString()] = {prefix : elem[0], body:[""],
            description:elem[0].toString()+"("+elem[1].toString()+")\ncustom predicate\n\n"
          };
            Utils.newsnippets.push(elem);
          }
        });
        // Generate predicate modules based on the updated context
        Utils.genPredicateModules(Utils.CONTEXT);
      }
  } 

  // Extracts predicates from the given TextDocument
  public _getPredicat(doc: TextDocument)  { 
      let docContent = doc.getText(); // Get the content of the document
      const regexp = /^\s*([a-z][a-zA-Z0-9_]*)\(([a-zA-Z0-9_\-, ]*)\)(?=.*(:-|=>|-->).*)/gm;// Regular expression for matching Prolog predicates
      const regexpModule = /^\s*:-\s*use_module\(([a-z][a-zA-Z0-9_\/]*)\s*(,|\)\s*\.)/gm;// Regular expression for matching Prolog use_module directives
      const arrayModule = [...docContent.matchAll(regexpModule)]// Extract all use_module directives from the document
      const prolog = doc.fileName.split(".")[1]// Get the Prolog extension from the document's file name
      var predicats = [];
      // Loop through each use_module directive
      for(let i = 0 ; i < arrayModule.length;i++){
        // Read the content of the referenced module
          var text=fs.readFileSync(workspace.workspaceFolders[0].uri.fsPath+"/"+arrayModule[i][1]+"."+prolog, 'utf8');
           // Extract predicates from the referenced module's content
          const array2 = [...text.matchAll(regexp)]
          predicats = predicats.concat(array2.map(function(value) { return [value[1],value[2]]; }));
      }
      // Extract predicates from the current document
      const array = [...docContent.matchAll(regexp)]
      predicats = predicats.concat(array.map(function(value) { return [value[1],value[2]]; }));
      // Filter out a specific predicate named "test"
      predicats = predicats.filter(function (predicat) {return predicat[0]!= "test"});
      return predicats; 
  } 
  dispose() {
  }
}

// Class responsible for managing the SnippetUpdater and subscribing to relevant events
export class SnippetUpdaterController {

  private snippetUpdater: SnippetUpdater;
  private _disposable: Disposable;

  constructor(snippetUpdater: SnippetUpdater) {
      this.snippetUpdater = snippetUpdater;
      this.snippetUpdater.updateSnippet(); // Update snippets initially

      // subscribe to selection change and editor activation events
      let subscriptions: Disposable[] = [];
      workspace.onDidSaveTextDocument(this._onEvent, this, subscriptions);
      window.onDidChangeActiveTextEditor(this._onEvent, this, subscriptions);

      // update the counter for the current file
      this.snippetUpdater.updateSnippet();

      // create a combined disposable from both event subscriptions
      this._disposable = Disposable.from(...subscriptions);
  }

  dispose() {
      this._disposable.dispose();
  }

  private _onEvent() {
      this.snippetUpdater.updateSnippet();
  }
}


export  class PrologCompletionProvider {

  // Provides completion items for Prolog code (auto completion)
  public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext) {
    // Array to store completion items
    var snippetCompletion = [];
    // Iterate through new snippets and create completion items
    Utils.newsnippets.forEach((elem)=>{
      const params= elem[1].split(","); // Split parameters of the snippet
      const completionItem = new CompletionItem(elem[0]+"/"+params.length,CompletionItemKind.Function);// Create a new CompletionItem for each snippet
      // Construct the snippet text with placeholders for parameters
      let str = elem[0].toString()+"(";
      let str2 =""
      for(let i =0 ; i<params.length ;i++){
        str = str +"${"+(i+2).toString()+":"+params[i]+"}";
        str2 = str2 + '<span style="color:#ff7878;">'+params[i]+'</span>'
        if (i != params.length - 1){
          str = str +",";
          str2 = str2 +",";
        }
      }
      str = str+")$0";
      // Set the insert text for the completion item as a SnippetString
      completionItem.insertText = new SnippetString(str);
      // Set documentation for the completion item
      const docs: any = new MarkdownString();
      docs.supportHtml = true;
      docs.appendMarkdown('<span style="color:#8da9fc;">'+elem[0].toString()+'</span>('+str2+')</br>Custom predicate');
      completionItem.documentation = docs;
      completionItem.detail = elem[0]+"/"+params.length;// Set additional details for the completion item
      snippetCompletion.push(completionItem);// Add the completion item to the array
    });
    return snippetCompletion ;// Return the array of completion items
  }
}