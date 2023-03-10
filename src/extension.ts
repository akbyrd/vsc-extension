import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext)
{
	context.subscriptions.push(
		vscode.commands.registerTextEditorCommand("akbyrd.editor.scrollTo.cursor",                      scrollTo_cursor),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.prev.center",   t => cursorMoveTo_blankLine_center(t, Direction.Prev, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.next.center",   t => cursorMoveTo_blankLine_center(t, Direction.Next, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.prev.center", t => cursorMoveTo_blankLine_center(t, Direction.Prev, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.next.center", t => cursorMoveTo_blankLine_center(t, Direction.Next, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.prev",             t => cursorMoveTo_symbol(t, Direction.Prev, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.next",             t => cursorMoveTo_symbol(t, Direction.Next, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.symbol.prev",           t => cursorMoveTo_symbol(t, Direction.Prev, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.symbol.next",           t => cursorMoveTo_symbol(t, Direction.Next, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteChunk.prev",                     t => deleteChunk(t, Direction.Prev)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteChunk.next",                     t => deleteChunk(t, Direction.Next)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLine.prev",                      deleteLine_prev),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLine.next",                      deleteLine_next),
	);

	vscode.window.onDidChangeTextEditorSelection(e => { e.textEditor.setDecorations(symbolHighlightDecoration, []); });
	vscode.window.onDidChangeActiveTextEditor(() => { symbols = undefined; });
	vscode.workspace.onDidChangeTextDocument(() => { symbols = undefined; });
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals

let symbols: vscode.DocumentSymbol[] | undefined;

const symbolHighlightDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
	isWholeLine: true,
});

// ---------------------------------------------------------------------------------------------------------------------
// Utilities

enum Direction
{
	Prev,
	Next
};

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function logRangePosition(start: vscode.Position, end: vscode.Position)
{
	console.log("%d/%d -> %d/%d", start.line, start.character, end.line, end.character);
}

function logRange(range: vscode.Range)
{
	console.log("%d/%d -> %d/%d", range.start.line, range.start.character, range.end.line, range.end.character);
}

// ---------------------------------------------------------------------------------------------------------------------
// Commands

function scrollTo_cursor(textEditor: vscode.TextEditor)
{
	const cursorPos = textEditor.selection.active;
	const destRange = new vscode.Range(cursorPos, cursorPos);
	textEditor.revealRange(destRange, vscode.TextEditorRevealType.InCenter);
}

async function cursorMoveTo_blankLine_center(textEditor: vscode.TextEditor, direction: Direction, select: boolean)
{
	const to = direction == Direction.Next ? "nextBlankLine" : "prevBlankLine";
	await vscode.commands.executeCommand("cursorMove", { "to": to, "by": "wrappedLine", "select": select });
	scrollTo_cursor(textEditor);
}

async function cursorMoveTo_symbol(textEditor: vscode.TextEditor, direction: Direction, select: boolean)
{
	if (!symbols)
	{
		symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider", textEditor.document.uri);
	}

	if (!symbols || !symbols.length)
		return;

	const symbolRanges: vscode.Range[] = [];
	const symbolSelections: vscode.Selection[] = [];
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

		function findNearestSymbols(symbols: vscode.DocumentSymbol[], depth: number)
		{
			for (const symbol of symbols)
			{
				const isCurrSymbol = symbol == currSymbol;
				const isTopLevel = depth == 0;

				let skipSymbol = false
				switch (symbol.kind)
				{
					case vscode.SymbolKind.Property:
					case vscode.SymbolKind.Field:
					case vscode.SymbolKind.Constructor:
					case vscode.SymbolKind.Variable:
					case vscode.SymbolKind.String:
					case vscode.SymbolKind.Number:
					case vscode.SymbolKind.Boolean:
					case vscode.SymbolKind.Array:
					case vscode.SymbolKind.Object:
					case vscode.SymbolKind.Key:
					case vscode.SymbolKind.EnumMember:
					case vscode.SymbolKind.Event:
					case vscode.SymbolKind.TypeParameter:
						skipSymbol = true;
						break;
				}

				let recurseSymbol = false;
				switch (symbol.kind)
				{
					case vscode.SymbolKind.File:
					case vscode.SymbolKind.Module:
					case vscode.SymbolKind.Namespace:
					case vscode.SymbolKind.Package:
					case vscode.SymbolKind.Class:
					case vscode.SymbolKind.Interface:
					case vscode.SymbolKind.Struct:
						recurseSymbol = true;
						break;
				}

				if (!isCurrSymbol && (isTopLevel || !skipSymbol))
				{
					const isAfterCursor = symbol.range.start.isAfterOrEqual(selection.active);
					const isBeforeNextSymbol = !nextSymbol || symbol.range.start.isBefore(nextSymbol.range.start);

					const isBeforeCursor = symbol.range.start.isBeforeOrEqual(selection.active);
					const isAfterPrevSymbol = !prevSymbol || symbol.range.start.isAfter(prevSymbol.range.start);

					if (isAfterCursor && isBeforeNextSymbol)
						nextSymbol = symbol;

					if (isBeforeCursor && isAfterPrevSymbol)
						prevSymbol = symbol;
				}

				if (recurseSymbol)
					findNearestSymbols(symbol.children, depth++);
			}
		}

		let currSymbol: vscode.DocumentSymbol | undefined;
		findCurrentSymbol(symbols);

		let prevSymbol: vscode.DocumentSymbol | undefined;
		let nextSymbol: vscode.DocumentSymbol | undefined;
		findNearestSymbols(symbols, 0);

		if (direction == Direction.Prev && prevSymbol)
		{
			symbolRanges.push(prevSymbol.range);
			const symbolSelection = select
				? new vscode.Selection(selection.anchor, prevSymbol.range.start)
				: new vscode.Selection(prevSymbol.range.start, prevSymbol.range.start);
			symbolSelections.push(symbolSelection);
		}

		if (direction == Direction.Next && nextSymbol)
		{
			symbolRanges.push(nextSymbol.range);
			const symbolSelection = select
				? new vscode.Selection(selection.anchor, nextSymbol.range.start)
				: new vscode.Selection(nextSymbol.range.start, nextSymbol.range.start);
			symbolSelections.push(symbolSelection);
		}
	}

	if (symbolRanges.length)
	{
		textEditor.selections = symbolSelections;
		textEditor.revealRange(symbolRanges[0]);

		if (!select)
		{
			// HACK: This is a workaround for https://github.com/microsoft/vscode/issues/106209
			await sleep(4);
			textEditor.setDecorations(symbolHighlightDecoration, symbolRanges);
		}
	}
}

async function deleteChunk(textEditor: vscode.TextEditor, direction: Direction)
{
	switch (direction)
	{
		case Direction.Prev:
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "prevBlankLine", "by": "wrappedLine", "select": false });
			await vscode.commands.executeCommand("cursorMove", { "to": "nextBlankLine", "by": "wrappedLine", "select": true });
			await vscode.commands.executeCommand("deleteLeft");
			break;
		}

		case Direction.Next:
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "nextBlankLine", "by": "wrappedLine", "select": false });
			await vscode.commands.executeCommand("cursorMove", { "to": "prevBlankLine", "by": "wrappedLine", "select": true });
			await vscode.commands.executeCommand("deleteRight");
			break;
		}
	}
}

function deleteLine_prev(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit)
{
	const deletedLines = new Set<number>;
	for (const selection of textEditor.selections)
	{
		if (selection.start.line == 0)
			continue;

		const selectedLine = selection.start.line;
		const lineToDelete = Math.max(selectedLine - 1, 0)

		if (!deletedLines.has(lineToDelete))
		{
			deletedLines.add(lineToDelete);

			const prevLine = textEditor.document.lineAt(lineToDelete);
			const toDelete = prevLine.rangeIncludingLineBreak
			edit.delete(toDelete);
		}
	}
}

function deleteLine_next(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit)
{
	const deletedLines = new Set<number>;
	for (const selection of textEditor.selections)
	{
		if (selection.end.line == textEditor.document.lineCount - 1)
			continue;

		const selectedLine = selection.end.line;
		const lineToDelete = Math.max(selectedLine + 1, 0)

		if (!deletedLines.has(lineToDelete))
		{
			deletedLines.add(lineToDelete);

			const currLine = textEditor.document.lineAt(selectedLine);
			const nextLine = textEditor.document.lineAt(lineToDelete);

			const newline = new vscode.Range(currLine.range.end, currLine.rangeIncludingLineBreak.end);
			const toDelete = newline.union(nextLine.range);
			edit.delete(toDelete);
		}
	}
}
