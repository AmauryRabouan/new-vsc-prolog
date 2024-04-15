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
import { verify } from "crypto";



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
        var description = [];
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
          if (Utils.snippets[elem].description.includes("\ncustom predicate\n")){
            description.push(false);
          }else{
            description.push(true);
          }
        });
        // Update snippets based on new predicates in the document
        predicats.forEach((elem)=>{
          let num = elem[1].split(",").length
          if(!already.includes(elem[0]+"/"+num.toString())){
            if(elem[2]==null){
              Utils.snippets[elem[0]+"/"+num.toString()] = {prefix : elem[0], body:[""],
              description:elem[0].toString()+"("+elem[1].toString()+")\ncustom predicate\n\n"};
            }else{
              Utils.snippets[elem[0]+"/"+num.toString()] = {prefix : elem[0], body:[""],
              description:elem[0].toString()+"("+elem[1].toString()+")\n"+elem[2]+"\n"};
            }
            Utils.newsnippets.push(elem);
          }else if(elem[2]!= null){
            delete Utils.snippets[Object.keys(Utils.snippets)[already.indexOf(elem[0]+"/"+num.toString())]]
            Utils.snippets[elem[0]+"/"+num.toString()] = {prefix : elem[0], body:[""],
            description:elem[0].toString()+"("+elem[1].toString()+")\n"+elem[2]+"\n"};
            for(let i = 0; i<Utils.newsnippets.length; i++){
              if(Utils.newsnippets[i][0]==elem[0] && Utils.newsnippets[i][1]==elem[1]){
                Utils.newsnippets.splice(i,1);
                Utils.newsnippets.push(elem);
                break;
              }
            }
          }
        });
        // Generate predicate modules based on the updated context
        Utils.genPredicateModules(Utils.CONTEXT);
      }
  } 

  // Extracts predicates from the given TextDocument
  public _getPredicat(doc: TextDocument)  { 
      let docContent = doc.getText(); // Get the content of the document
      const regexp = /(^\s*)([a-z][a-zA-Z0-9_]*)\(([a-zA-Z0-9_\-, ]*)\)(?=.*(:-|=>|-->).*)/gm;// Regular expression for matching Prolog predicates
      const regexpModule = /^\s*:-\s*use_module\(([a-z][a-zA-Z0-9_\/]*)\s*(,|\)\s*\.)/gm;// Regular expression for matching Prolog use_module directives
      const regexpComment = /^\s*(%(?!!)|%!|\*(?!\/)|\*\/|\/\*\*)(\s*)(.*)/gm// Regular expression for matching Prolog comments
      const arrayModule = [...docContent.matchAll(regexpModule)]// Extract all use_module directives from the document
      const prolog = doc.fileName.split(".")[1]// Get the Prolog extension from the document's file name
      var predicats = [];
 
      // Loop through each use_module directive
      for(let i = 0 ; i < arrayModule.length;i++){
        // Read the content of the referenced module
        let text ="";
        try {
           text = fs.readFileSync(workspace.workspaceFolders[0].uri.fsPath+"\/"+arrayModule[i][1]+"."+prolog,"utf8")
        } catch (error) {
            console.error("Error reading file:", error);
        }
        
          // Extract predicates from the referenced module's content
        const array2 = [...text.matchAll(regexp)]
        array2.forEach((elem)=>{
          var nbline = Utils.findLineColForByte(text,elem.index+elem[1].length).line-1;
          var lines = text.split(/\n|\r/);
          var verif = true;
          var comment = "";
          while(verif && nbline >-1){
            var res = lines[nbline].matchAll(regexpComment).next();
            if(res.value){
              if(res.value[1]!="*/" ||res.value[1]!="/**"){
                if(comment==""){
                  comment = res.value[3];
                }else if(res.value[3]!=""){
                  comment = res.value[3]+"\n"+comment;
                }
              }
              if(res.value[1]=="%!" ||res.value[1]=="/**"){
                verif = false;
              }
              nbline = nbline-1;
            }else{
              comment = null;
              verif = false;
            }
            
          }
          predicats.push([elem[2],elem[3],comment]);
        });
      }
      // Extract predicates from the current document
      const array = [...docContent.matchAll(regexp)]
      // Search for definition comments
      array.forEach((elem)=>{
        var nbline = Utils.findLineColForByte(docContent,elem.index+elem[1].length).line-1;
        var lines = docContent.split("\n");
        var verif = true;
        var comment = "";
        while(verif && nbline >-1){
          var res = lines[nbline].matchAll(regexpComment).next();
          if(res.value){
            if(res.value[1]!="*/" ||res.value[1]!="/**"){
              if(comment==""){
                comment = res.value[3]
              }else if(res.value[3]!=""){
                comment = res.value[3]+"\n"+comment;
              }
            }
            if(res.value[1]=="%!" ||res.value[1]=="/**"){
              verif = false;
            }
            nbline = nbline-1;
          }else{
            comment = null;
            verif = false;
          }
          
        }
       predicats.push([elem[2],elem[3],comment])
      });
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
      if(elem[2]==null){
        docs.appendMarkdown('<span style="color:#8da9fc;">'+elem[0].toString()+'</span>('+str2+')</br>Custom predicate');
      }else{
        docs.appendMarkdown('<span style="color:#8da9fc;">'+elem[0].toString()+'</span>('+str2+')</br>'+elem[2].replace("\n","</br>"));
      }
      completionItem.documentation = docs;
      completionItem.detail = elem[0]+"/"+params.length;// Set additional details for the completion item
      snippetCompletion.push(completionItem);// Add the completion item to the array
    });
    return snippetCompletion ;// Return the array of completion items
  }
}