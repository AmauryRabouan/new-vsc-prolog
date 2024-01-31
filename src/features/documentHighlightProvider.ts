import { CancellationToken, DocumentHighlightProvider, Position, TextDocument, DocumentHighlight, Range } from 'vscode';

export default class PrologDocumentHighlightProvider implements DocumentHighlightProvider {
  // Implement the provideDocumentHighlights method required by DocumentHighlightProvider interface
  public provideDocumentHighlights(doc: TextDocument, position: Position, token: CancellationToken): Thenable<DocumentHighlight[]> | DocumentHighlight[] {
    let docHilite: DocumentHighlight[] = [];// Array to store DocumentHighlight instances
    let wordRange = doc.getWordRangeAtPosition(position);// Get the word range at the given position
    // Return early if no word range is found
    if (!wordRange) {
      return;
    }

    let symbol = doc.getText(wordRange);// Extract the symbol from the document using the word range
    let symbolLen = symbol.length;
    let line = 0;
    let re = new RegExp("\\b" + symbol + "\\b", "g");// Create a regular expression to match the whole word occurrences
    // Loop through each line of the document
    while (line < doc.lineCount) {
      let lineTxt = doc.lineAt(line).text;// Get the text of the current line
      let match = re.exec(lineTxt);// Execute the regular expression on the line text
      // Iterate through all matches in the line
      while (match) {
        docHilite.push(new DocumentHighlight(new Range(line, match["index"], line, match["index"] + symbolLen)));// Create a DocumentHighlight instance and add it to the array
        match = re.exec(lineTxt);// Continue searching for the next match in the line
      }
      line++;
    }
    // Return the array of DocumentHighlight instances
    return docHilite;
  }
}