import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext)
{
	let disposable : vscode.Disposable;

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.scrollTo.cursor",
		(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.prev.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "prevBlankLine", "by": "wrappedLine" });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.next.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "nextBlankLine", "by": "wrappedLine" });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.prev.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "prevBlankLine", "by": "wrappedLine", "select": true });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.next.center",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "nextBlankLine", "by": "wrappedLine", "select": true });
			centerCursor(textEditor);
		});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLines.up",
		async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) =>
		{
			let deletedLines = new Set<number>;
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
}

function arraysEqual(a1 : readonly any[], a2 : readonly any[]) : boolean
{
	let equal = true;
	equal = equal && a1.length === a2.length;
	equal = equal && a1.every((element, index) => element === a2[index]);
	return equal;
}

function centerCursor(textEditor: vscode.TextEditor)
{
	const cursorPos = textEditor.selection.active;
	const destRange = new vscode.Range(cursorPos, cursorPos);
	textEditor.revealRange(destRange, vscode.TextEditorRevealType.InCenter);
}

// TODO: Show friendly name for commands in keybindings GUI
