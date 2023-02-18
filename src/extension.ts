import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext)
{
	let disposable: vscode.Disposable;

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.scrollTo.cursor",
		(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.prev.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand(
				"cursorMove", { "to": "prevBlankLine", "by": "wrappedLine" });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.next.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand(
				"cursorMove", { "to": "nextBlankLine", "by": "wrappedLine" });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.prev.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand(
				"cursorMove", { "to": "prevBlankLine", "by": "wrappedLine", "select": true });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.next.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand(
				"cursorMove", { "to": "nextBlankLine", "by": "wrappedLine", "select": true });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	// TODO: Use SymbolInformation. No need for hierarchy
	// TODO: Requests stack up
	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.prev",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await cursorMoveToSymbol(textEditor, Direction.Previous, false);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.next",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await cursorMoveToSymbol(textEditor, Direction.Next, false);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLine.prev",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			const deletedLines = new Set<number>;
			for (const selection of textEditor.selections)
			{
				const selectedLine = selection.start.line;
				const lineToDelete = Math.max(selectedLine - 1, 0)

				if (!deletedLines.has(lineToDelete))
				{
					deletedLines.add(lineToDelete);
					const textLine = textEditor.document.lineAt(lineToDelete);
					edit.delete(textLine.rangeIncludingLineBreak);
				}
			}
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLine.next",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			const deletedLines = new Set<number>;
			for (const selection of textEditor.selections)
			{
				const selectedLine = selection.end.line;
				const lineToDelete = Math.min(selectedLine + 1, textEditor.document.lineCount - 1);

				if (!deletedLines.has(lineToDelete))
				{
					deletedLines.add(lineToDelete);
					const textLine = textEditor.document.lineAt(lineToDelete);
					edit.delete(textLine.rangeIncludingLineBreak);
				}
			}
		});
	context.subscriptions.push(disposable);

	vscode.window.onDidChangeTextEditorSelection(
		(e: vscode.TextEditorSelectionChangeEvent) =>
		{
			e.textEditor.setDecorations(symbolHighlightDecoration, []);
		});

	vscode.window.onDidChangeActiveTextEditor(
		(textEditor: vscode.TextEditor | undefined) =>
		{
			symbols = undefined;
		});
	vscode.workspace.onDidChangeTextDocument(
		(e: vscode.TextDocumentChangeEvent) =>
		{
			symbols = undefined;
		});
}

function centerCursor(textEditor: vscode.TextEditor)
{
	const cursorPos = textEditor.selection.active;
	const destRange = new vscode.Range(cursorPos, cursorPos);
	textEditor.revealRange(destRange, vscode.TextEditorRevealType.InCenter);
}

enum Direction
{
	Previous,
	Next
};

let symbols: vscode.DocumentSymbol[] | undefined;

const symbolHighlightDecoration: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
	isWholeLine: true,
});

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function cursorMoveToSymbol(textEditor: vscode.TextEditor, direction: Direction, select: boolean)
{
	if (!symbols)
	{
		symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider", textEditor.document.uri);
	}

	if (!symbols || !symbols.length)
		return;

	const symbolRanges: vscode.Range[] = [];
	for (const selection of textEditor.selections)
	{
		function findCurrentSymbol(symbols: vscode.DocumentSymbol[])
		{
			for (const symbol of symbols)
			{
				const containsCursor = symbol.range.contains(selection.active);
				const isAfterCurr = !currSymbol || symbol.range.start.isAfter(currSymbol.range.start);

				if (containsCursor && isAfterCurr)
					currSymbol = symbol;

				findCurrentSymbol(symbol.children);
			}
		}

		function findClosestSymbols(symbols: vscode.DocumentSymbol[])
		{
			for (const symbol of symbols)
			{
				const isCurrSymbol = symbol == currSymbol;

				const isAfterCursor = symbol.range.start.isAfterOrEqual(selection.active);
				const isBeforeNextSymbol = !nextSymbol || symbol.range.start.isBefore(nextSymbol.range.start);

				const isBeforeCursor = symbol.range.start.isBeforeOrEqual(selection.active);
				const isAfterPrevSymbol = !prevSymbol || symbol.range.start.isAfter(prevSymbol.range.start);

				if (!isCurrSymbol && isAfterCursor && isBeforeNextSymbol)
					nextSymbol = symbol;

				if (!isCurrSymbol && isBeforeCursor && isAfterPrevSymbol)
					prevSymbol = symbol;

				findClosestSymbols(symbol.children);
			}
		}

		let currSymbol: vscode.DocumentSymbol | undefined;
		let prevSymbol: vscode.DocumentSymbol | undefined;
		let nextSymbol: vscode.DocumentSymbol | undefined;
		findCurrentSymbol(symbols);
		findClosestSymbols(symbols);

		if (direction == Direction.Previous && prevSymbol)
			symbolRanges.push(prevSymbol.range);

		if (direction == Direction.Next && nextSymbol)
			symbolRanges.push(nextSymbol.range);
	}

	if (symbolRanges.length)
	{
		textEditor.selections = symbolRanges.map(sr => new vscode.Selection(sr.start, sr.start));
		await sleep(1);
		textEditor.setDecorations(symbolHighlightDecoration, symbolRanges);
		textEditor.revealRange(textEditor.selection);
	}
}

// TODO: Show friendly name for commands in keybindings GUI
