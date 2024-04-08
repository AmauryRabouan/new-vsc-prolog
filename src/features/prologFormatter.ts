

import {
languages,
TextEdit,
DocumentFormattingEditProvider,
DocumentRangeFormattingEditProvider,
TextDocument,
FormattingOptions,
Range,
CancellationToken,
ProviderResult,
Position,
workspace,
WorkspaceConfiguration,
OutputChannel,
window
}
from 'vscode';

export class PrologFormatter implements 
DocumentRangeFormattingEditProvider,
DocumentFormattingEditProvider{
  private _section: WorkspaceConfiguration;
  private _tabSize: number;
  private _insertSpaces: boolean;
  private _tabDistance: number;
  private _executable: string;
  private _args: string[];
  private _outputChannel: OutputChannel;
  private _textEdits: TextEdit[] = [];
  private _startChars: number;

  // Constructor for the PrologFormatter class
  constructor() {
    this._section = workspace.getConfiguration("prolog");
    this._executable = this._section.get("executablePath", "swipl");
    this._args = [];
    this._outputChannel = window.createOutputChannel("PrologFormatter");
  }
  public provideDocumentRangeFormattingEdits(
    doc: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ):  ProviderResult<TextEdit[]> {
    let docContent = doc.getText(range); // Get the content of the document;
    const regexp = /^\s*([a-z][a-zA-Z0-9_]*)(\(?)(?=.*(:-|=>|-->).*)/gm;// Define a regular expression for identifying Prolog clauses
    const array = [...docContent.matchAll(regexp)];// Match all occurrences of Prolog clauses in the document

    var result = [] 
    // Iterate over each matched clause and format it
    array.forEach((clause)=>{
      var clauseArray = this.getClauseString(doc,clause.index+doc.offsetAt(range.start));
      clauseArray[0] = this.formatClause(clauseArray[0]);
      result = result.concat(TextEdit.replace(clauseArray[1],clauseArray[0]));
    })
    return result;// Return the formatted result
  }

  // Implementation of the provideDocumentFormattingEdits method required by DocumentFormattingEditProvider
  public provideDocumentFormattingEdits(document: TextDocument, _options: FormattingOptions,_token: CancellationToken): ProviderResult<TextEdit[]> {
    let docContent = document.getText(); // Get the content of the document
    const regexp = /^\s*([a-z][a-zA-Z0-9_]*)(\(?)(?=.*(:-|=>|-->).*)/gm;// Define a regular expression for identifying Prolog clauses
    const array = [...docContent.matchAll(regexp)];// Match all occurrences of Prolog clauses in the document
    var result = [] 
    // Iterate over each matched clause and format it
    array.forEach((clause)=>{
      var clauseArray = this.getClauseString(document,clause.index);
      clauseArray[0] = this.formatClause(clauseArray[0]);
      result = result.concat(TextEdit.replace(clauseArray[1],clauseArray[0]));
    })
    return result;// Return the formatted result
  }

  // Helper method to get the clause string and its range from the document
  private getClauseString(doc: TextDocument, start):[string,Range]{
    let docContent = doc.getText();
    const sub = docContent.substring(start,docContent.length); // Extract the substring from the starting position to the end of the document
    var regexp = /%.*/gm; // Define regular expression for matching comments
    var array =[...sub.matchAll(regexp)]; // Match all occurrences of comments in the substring
    // Replace comments with placeholder characters in the clause
    var clauseComment =sub;
    array.forEach(Comment =>{
      clauseComment = clauseComment.replace(Comment[0],new Array(Comment[0].length+1).join( "☻" ))
    });
    regexp = /\.\s*$/gm; // Define regular expression for matching the end of a clause
    const point = [...clauseComment.matchAll(regexp)][0];// Match the position of the end of the clause in the modified substring
    return [docContent.substring(start,start+point.index+1),new Range(doc.positionAt(start),doc.positionAt(start+point.index+1))];// Return the clause string and its range
  }

  // Helper method to format a Prolog clause
  private formatClause(clause : string):string{
    // COMMENT
    var regexp = /%.*/gm;
    var array =[...clause.matchAll(regexp)];
    var clauseComment =clause;
    // Replace comments with placeholder characters in the clause
    array.forEach(Comment =>{
      clauseComment = clauseComment.replace(Comment[0],new Array(Comment[0].length).join( "☻" )+"♥")
    });
    // STRING
    var regexp = /(\")((?:[^\"])*)(\")|(\')((?:[^\'])*)(\')/gm;
    var array =[...clauseComment.matchAll(regexp)];
    // Replace strings with placeholder characters in the clause
    array.forEach(String =>{
      clauseComment = clauseComment.replace(String[0],new Array(String[0].length+1).join( "☺" ))
    });
    //EXTRACT HEAD
    regexp = /^\s*(([a-z][a-zA-Z0-9_]*).*(:-|=>|-->))\s*/gm;
    array = [...clauseComment.matchAll(regexp)];
    var head = array[0][0];
    // Remove head from the clause and clauseComment
    clause = clause.replace(head,"")
    clauseComment = clauseComment.replace(head,"")
    head = array[0][1];
    //CONDENSATE
    regexp = /(?<!\sis|mod|div|rem|xor|rdiv)\s(?!is\s|:-|mod|div|rem|xor|rdiv)/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
    // Remove unnecessary spaces in the clause and clauseComment
    array.forEach(space=>{
      clause= [clause.slice(0, space.index+offset), clause.slice(space.index+space[0].length+offset)].join('');
      clauseComment= [clauseComment.slice(0, space.index+offset), clauseComment.slice(space.index+space[0].length+offset)].join('');
      offset-= space[0].length;
    });
    head =head.replace(regexp,"");
    //NESTED
    var result= this.formatNested(clause,clauseComment,["\\(","\\)"])
    clause= result[0];
    clauseComment = result[1]

    result= this.formatNested(clause,clauseComment,["{","}"])
    clause= result[0];
    clauseComment = result[1]

    //OPERATOR
    regexp = /(?<=[\]\)}])ins|(?<=[]\)}])in|[-*]?->|=>|\?-|:-|=?:=|\\\+|(?:<|=|@|@=||:|>:)<|(?:\\?)(?<![><#])=(?:\.\.|@=|=|\\=|)|@?>(?:=|>|)|:|\+|-|\\\/|\/\\|#=|#>|#\\=|#<==>|#</gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
    // Add spaces around operators in the clause and clauseComment
    array.forEach(operator=>{
      clause= [clause.slice(0, operator.index+offset)," "+operator[0]+" ", clause.slice(operator.index+operator[0].length+offset)].join('');
      clauseComment= [clauseComment.slice(0, operator.index+offset)," "+operator[0]+" ", clauseComment.slice(operator.index+operator[0].length+offset)].join('');
      offset+= 2;
    });
    // Special case for '->'
    regexp = /^(\s*).*->\s/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
    // Split lines with '->' and add indentation
    array.forEach(l=>{
      regexp = /->\s/gm;
      const array2 = [...l[0].matchAll(regexp)];
      array2.forEach(f=>{
        clause= [clause.slice(0, l.index+f.index+offset), "->\n"+new Array(l[1].length+2).join("\t"), clause.slice(l.index+f.index+f[0].length+offset)].join('');
        clauseComment= [clauseComment.slice(0, l.index+f.index+offset), "->\n"+new Array(l[1].length+2).join("\t"), clauseComment.slice(l.index+f.index+f[0].length+offset)].join('');
        offset+=l[1].length+1;
      });
    });
    // Special case for ';'
    regexp = /^(\s*).*;(?=\S)/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
    array.forEach(l=>{
      regexp = /;/gm;
      const array2 = [...l[0].matchAll(regexp)];
      array2.forEach(f=>{
        clause= [clause.slice(0, l.index+f.index+offset), ";\n"+new Array(l[1].length+1).join("\t"), clause.slice(l.index+f.index+f[0].length+offset)].join('');
        clauseComment= [clauseComment.slice(0, l.index+f.index+offset), ";\n"+new Array(l[1].length+1).join("\t"), clauseComment.slice(l.index+f.index+f[0].length+offset)].join('');
        offset+=l[1].length+1;
      });
    });
    //COMMAS
    regexp = /,/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0

    if  (this._section.format.addSpace){
       // Add space after commas in the clause and clauseComment
      array.forEach(comma=>{
        clause= [clause.slice(0, comma.index+offset),comma[0]+" ", clause.slice(comma.index+comma[0].length+offset)].join('');
        clauseComment= [clauseComment.slice(0, comma.index+offset),comma[0]+" ", clauseComment.slice(comma.index+comma[0].length+offset)].join('');
        offset+= 1;
      });
      head =head.replace(regexp,", ");
    }
   
    //REPLACE COMMENT
    regexp = /^(\s*).*(♥)/gm;
    array = [...clauseComment.matchAll(regexp)];
    var offset =0;
    array.forEach(Comment=>{
      regexp = /♥/gm;
      const array2 = [...Comment[0].matchAll(regexp)];
      // Add newline and indentation after comments in the clause
      array2.forEach(h=>{
        clause= [clause.slice(0, Comment.index+h.index+1+offset), "\n"+ new Array(Comment[1].length+1).join("\t"), clause.slice(Comment.index+h.index+1+offset)].join('');
        offset+=1+Comment[1].length;
      });
    });
    head = "\n"+head+"\n\t";
    return head+clause; // Return the formatted clause
  }

  // Helper method to format nested expressions within a Prolog clause
  private formatNested(clause : string, clauseComment: string,char:[string,string]):[string,string]{
    var regexp = new RegExp("[^,;"+char[0]+char[1]+"☻☺♥]*"+char[0],"gm");// Define regular expression to find the start of nested expressions
    var arrayStart = [...clauseComment.matchAll(regexp)];// Find all occurrences of the start of nested expressions in the clauseComment
    regexp = new RegExp(char[1],"gm");// Define regular expression to find the end of nested expressions
    var arrayEnd = [...clauseComment.matchAll(regexp)];// Find all occurrences of the end of nested expressions in the clauseComment
    // Check if the number of start and end occurrences is equal
    if(arrayStart.length != arrayEnd.length){
      // If not equal, return the original clause and clauseComment
      return [clause, clauseComment];
    }
    var offset =0;
    // Iterate over each start occurrence and adjust indentation in clause and clauseComment
    arrayStart.forEach(start => {
      if(start.index != 0){
        var deep =0;
        // Calculate the indentation depth based on the number of nested expressions
        for(let i= 0; i<arrayStart.length;i++){
          if(arrayStart[i].index<=start.index){
            deep++;
          }
          if(arrayEnd[i].index<=start.index){
            deep--;
          }
        }
        // Adjust indentation in clauseComment
        clauseComment = [clauseComment.slice(0, start.index+offset), "\n"+new Array(deep+1).join("\t"), clauseComment.slice(start.index+offset)].join('');
        // Adjust indentation in clause
        clause = [clause.slice(0, start.index+offset), "\n"+new Array(deep+1).join("\t"), clause.slice(start.index+offset)].join('');
        offset+= 1+deep;
      }
    });
    return [clause, clauseComment]// Return the formatted clause and clauseComment
  }
}


