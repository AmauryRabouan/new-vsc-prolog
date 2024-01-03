

import {
languages,
TextEdit,
DocumentFormattingEditProvider,
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
import { Utils} from "../utils/utils";
import { close } from 'fs';
import { off } from 'process';

interface IComment {
  location: number; // character location in the range
  comment: string;
}

interface ITermInfo {
  startLine: number;
  startChar: number;
  isValid: boolean;
  termStr: string;
  comments: IComment[];
  endLine?: number;
  endChar?: number;
  charsSofar?: number;
}

export class PrologFormatter implements DocumentFormattingEditProvider{
  private _section: WorkspaceConfiguration;
  private _tabSize: number;
  private _insertSpaces: boolean;
  private _tabDistance: number;
  private _executable: string;
  private _args: string[];
  private _outputChannel: OutputChannel;
  private _textEdits: TextEdit[] = [];
  private _currentTermInfo: ITermInfo = null;
  private _startChars: number;

  constructor() {
    this._section = workspace.getConfiguration("prolog");
    this._executable = this._section.get("executablePath", "swipl");
    this._args = [];
    this._outputChannel = window.createOutputChannel("PrologFormatter");
  }

  public provideDocumentFormattingEdits(document: TextDocument, _options: FormattingOptions,_token: CancellationToken): ProviderResult<TextEdit[]> {
    
    //console.log(new Range(this.getClauseHeadStart(document,13),this.getClauseEnd(document,13)))
    let docContent = document.getText(); 
    const regexp = /^\s*([a-z][a-zA-Z0-9_]*)(\(?)(?=.*(:-|=>|-->).*)/gm;
    const array = [...docContent.matchAll(regexp)];
    var result = [] 
    array.forEach((clause)=>{
      var clauseArray = this.getClauseString(document,clause.index);
      clauseArray[0] = this.formatClause(clauseArray[0]);
      result = result.concat(TextEdit.replace(clauseArray[1],clauseArray[0]));
    })
    return result;
  }

  private getClauseString(doc: TextDocument, start):[string,Range]{
    let docContent = doc.getText();
    const sub = docContent.substring(start,docContent.length);
    var regexp = /%.*/gm;
    var array =[...sub.matchAll(regexp)];
    var clauseComment =sub;
    array.forEach(Comment =>{
      clauseComment = clauseComment.replace(Comment[0],new Array(Comment[0].length+1).join( "☻" ))
    });
    regexp = /\.\s*$/gm;
    const point = [...clauseComment.matchAll(regexp)][0];
    return [docContent.substring(start,start+point.index+1),new Range(doc.positionAt(start),doc.positionAt(start+point.index+1))];
  }

  private formatClause(clause : string):string{
    // COMMENT
    var regexp = /%.*/gm;
    var array =[...clause.matchAll(regexp)];
    var clauseComment =clause;
    array.forEach(Comment =>{
      clauseComment = clauseComment.replace(Comment[0],new Array(Comment[0].length).join( "☻" )+"♥")
    });
    // STRING
    var regexp = /(\")((?:[^\"])*)(\")|(\')((?:[^\'])*)(\')/gm;
    var array =[...clauseComment.matchAll(regexp)];
    array.forEach(String =>{
      clauseComment = clauseComment.replace(String[0],new Array(String[0].length+1).join( "☺" ))
    });
    //EXTRACT HEAD
    regexp = /^\s*(([a-z][a-zA-Z0-9_]*).*(:-|=>|-->))\s*/gm;
    array = [...clauseComment.matchAll(regexp)];
    var head = array[0][0];
    clause = clause.replace(head,"")
    clauseComment = clauseComment.replace(head,"")
    head = array[0][1];
    //CONDENSATE
    regexp = /(?<!\sis)\s(?!is\s|:-)/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
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
    regexp = /(?<=[\]\)}])ins|(?<=[]\)}])in|=:=|=\.\.|(?<![<>])=?\\?=|\\\+|@?>(?!=)|@?=?<(?!=)|\+|\*|\-(?!>)|\#[=><]+|\#\\=|\->|>=|<=/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
    array.forEach(operator=>{
      clause= [clause.slice(0, operator.index+offset)," "+operator[0]+" ", clause.slice(operator.index+operator[0].length+offset)].join('');
      clauseComment= [clauseComment.slice(0, operator.index+offset)," "+operator[0]+" ", clauseComment.slice(operator.index+operator[0].length+offset)].join('');
      offset+= 2;
    });
    //->
    regexp = /^(\s*).*->\s/gm;
    array = [...clauseComment.matchAll(regexp)];
    offset =0
    array.forEach(l=>{
      regexp = /->\s/gm;
      const array2 = [...l[0].matchAll(regexp)];
      array2.forEach(f=>{
        clause= [clause.slice(0, l.index+f.index+offset), "->\n"+new Array(l[1].length+2).join("\t"), clause.slice(l.index+f.index+f[0].length+offset)].join('');
        clauseComment= [clauseComment.slice(0, l.index+f.index+offset), "->\n"+new Array(l[1].length+2).join("\t"), clauseComment.slice(l.index+f.index+f[0].length+offset)].join('');
        offset+=l[1].length+1;
      });
    });
    //;
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
    array.forEach(comma=>{
      clause= [clause.slice(0, comma.index+offset),comma[0]+" ", clause.slice(comma.index+comma[0].length+offset)].join('');
      clauseComment= [clauseComment.slice(0, comma.index+offset),comma[0]+" ", clauseComment.slice(comma.index+comma[0].length+offset)].join('');
      offset+= 1;
    });
    head =head.replace(regexp,", ");
    //REPLACE COMMENT
    regexp = /^(\s*).*(♥)/gm;
    array = [...clauseComment.matchAll(regexp)];
    var offset =0;
    array.forEach(Comment=>{
      regexp = /♥/gm;
      const array2 = [...Comment[0].matchAll(regexp)];
      array2.forEach(h=>{
        clause= [clause.slice(0, Comment.index+h.index+1+offset), "\n"+ new Array(Comment[1].length+1).join("\t"), clause.slice(Comment.index+h.index+1+offset)].join('');
        offset+=1+Comment[1].length;
      });
    });
    head = "\n"+head+"\n\t";
    return head+clause;
  }

  private formatNested(clause : string, clauseComment: string,char:[string,string]):[string,string]{
    var regexp = new RegExp("[^,;"+char[0]+char[1]+"☻☺♥]*"+char[0],"gm");
    //var regexp = /[^,;\(\)\s☻☺]*\(/gm;
    var arrayStart = [...clauseComment.matchAll(regexp)];
    regexp = new RegExp(char[1],"gm");
    //regexp = /\)/gm;
    var arrayEnd = [...clauseComment.matchAll(regexp)];
    if(arrayStart.length != arrayEnd.length){
      return [clause, clauseComment];
    }
    var offset =0;
    arrayStart.forEach(start => {
      if(start.index != 0){
        var deep =0;
        for(let i= 0; i<arrayStart.length;i++){
          if(arrayStart[i].index<=start.index){
            deep++;
          }
          if(arrayEnd[i].index<=start.index){
            deep--;
          }
        }
        clauseComment = [clauseComment.slice(0, start.index+offset), "\n"+new Array(deep+1).join("\t"), clauseComment.slice(start.index+offset)].join('');
        clause = [clause.slice(0, start.index+offset), "\n"+new Array(deep+1).join("\t"), clause.slice(start.index+offset)].join('');
        offset+= 1+deep;
      }
    });
    return [clause, clauseComment]
  }
}


