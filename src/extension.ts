import * as vscode from "vscode"

export function activate(context: vscode.ExtensionContext)
{
	context.subscriptions.push(
		vscode.commands.registerCommand("akbyrd.task.runWithArgs", task_runWithArgs),
		vscode.commands.registerCommand("akbyrd.task.getArgs",     task_getArgs),

		vscode.commands.registerTextEditorCommand("akbyrd.editor.scrollTo.cursor",                      scrollTo_cursor),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.prev.center",   t => cursorMoveTo_blankLine_center(t, Direction.Prev, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.blankLine.next.center",   t => cursorMoveTo_blankLine_center(t, Direction.Next, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.prev.center", t => cursorMoveTo_blankLine_center(t, Direction.Prev, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.blankLine.next.center", t => cursorMoveTo_blankLine_center(t, Direction.Next, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.prev",             t => cursorMoveTo_symbol(t, HierarchyDirection.Prev, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.next",             t => cursorMoveTo_symbol(t, HierarchyDirection.Next, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.prnt",             t => cursorMoveTo_symbol(t, HierarchyDirection.Parent, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorMoveTo.symbol.chld",             t => cursorMoveTo_symbol(t, HierarchyDirection.Child, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.symbol.prev",           t => cursorMoveTo_symbol(t, HierarchyDirection.Prev, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.symbol.next",           t => cursorMoveTo_symbol(t, HierarchyDirection.Next, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.symbol.prnt",           t => cursorMoveTo_symbol(t, HierarchyDirection.Parent, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.cursorSelectTo.symbol.chld",           t => cursorMoveTo_symbol(t, HierarchyDirection.Child, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteChunk.prev",                     t => deleteChunk(t, Direction.Prev)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteChunk.next",                     t => deleteChunk(t, Direction.Next)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLine.prev",                      deleteLine_prev),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.deleteLine.next",                      deleteLine_next),
	)

	vscode.window.onDidChangeTextEditorSelection(e => { e.textEditor.setDecorations(symbolHighlightDecoration, []) })
	vscode.window.onDidChangeActiveTextEditor(() => { symbols = undefined })
	vscode.workspace.onDidChangeTextDocument(() => { symbols = undefined })
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals

let symbols: vscode.DocumentSymbol[] | undefined
let taskArgs: object | undefined

const symbolHighlightDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
	isWholeLine: true,
})

// ---------------------------------------------------------------------------------------------------------------------
// Utilities

enum Direction
{
	Prev,
	Next,
}

enum HierarchyDirection
{
	Prev,
	Next,
	Parent,
	Child,
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function logRangePosition(start: vscode.Position, end: vscode.Position)
{
	console.log("%d/%d -> %d/%d", start.line, start.character, end.line, end.character)
}

function logRange(range: vscode.Range)
{
	console.log("%d/%d -> %d/%d", range.start.line, range.start.character, range.end.line, range.end.character)
}

// ---------------------------------------------------------------------------------------------------------------------
// Plain Commands

type RunTaskArgs =
{
	task: string
	type: string
}

type TaskWithArgs =
{
	task: RunTaskArgs | string
	taskArgs: object
}

async function task_runWithArgs(taskWithArgs: TaskWithArgs | string)
{
	if (!taskWithArgs) throw "Arguments missing"
	if (typeof taskWithArgs == "string") taskWithArgs = { task: taskWithArgs, taskArgs: {} }
	if (!taskWithArgs.task) throw "Task not specified"
	if (!taskWithArgs.taskArgs) throw "Task arguments not specified"
	if (typeof taskWithArgs.taskArgs != "object") throw "Task arguments must be an object"

	taskArgs = taskWithArgs.taskArgs
	await vscode.commands.executeCommand("workbench.action.tasks.runTask", taskWithArgs.task)
	//taskArgs = undefined
}

// TODO: Can we wait for runTask or use a task callback to clear the global?
// TODO: Contribute task definitions?
// TODO: Set a default for target or handle it being empty
// TODO: Can we make headers compilable?
// TODO: Unreal build tasks

function task_getArgs(argName: string)
{
	if (!taskArgs) throw "akbyrd.task.getArgs can only be used with akbyrd.task.runTaskWithArgs"

	let arg: any | undefined = taskArgs[argName as keyof object]
	if (arg == undefined) throw `Task arguments do not contain "${argName}"`
	return typeof arg == "string" ? arg : arg.toString()
}

// ---------------------------------------------------------------------------------------------------------------------
// Text Editor Commands

function scrollTo_cursor(textEditor: vscode.TextEditor)
{
	const cursorPos = textEditor.selection.active
	const destRange = new vscode.Range(cursorPos, cursorPos)
	textEditor.revealRange(destRange, vscode.TextEditorRevealType.InCenter)
}

async function cursorMoveTo_blankLine_center(textEditor: vscode.TextEditor, direction: Direction, select: boolean)
{
	const to = direction == Direction.Next ? "nextBlankLine" : "prevBlankLine"
	await vscode.commands.executeCommand("cursorMove", { "to": to, "by": "wrappedLine", "select": select })
	scrollTo_cursor(textEditor)
}

type NearestSymbols =
{
	current?:  vscode.DocumentSymbol
	parent?:   vscode.DocumentSymbol
	child?:    vscode.DocumentSymbol
	previous?: vscode.DocumentSymbol
	next?:     vscode.DocumentSymbol
}

function findNearestSymbols(symbols: vscode.DocumentSymbol[], position: vscode.Position, nearest: NearestSymbols)
{
	// NOTE: This functions makes several assumptions:
	// * Symbols are sorted by start position
	// * Symbols do not overlap
	// * Symbols fully enclose their children

	// NOTE: C++ - Friend functions inside classes are hoisted out of the class.

	const x = 0;
	for (let i = 0; i < symbols.length; i++)
	{
		const symbol = symbols[i];

		const containsCursor = symbol.range.start.isBefore(position) && symbol.range.start.isAfter(position)
		if (containsCursor)
		{
			nearest.parent   = nearest.current;
			nearest.current  = symbol
			nearest.previous = undefined
			nearest.next     = undefined

			findNearestSymbols(symbol.children, position, nearest)
			return
		}
		else
		{
			if (i > 0)
			{
				const prevSymbol = symbols[i - 1]

				const isBeforeCursor = prevSymbol.range.start.isBefore(position)
				const isAfterPrevSymbol = !nearest.previous || prevSymbol.range.start.isAfter(nearest.previous.range.start)

				if (isBeforeCursor && isAfterPrevSymbol)
					nearest.previous = prevSymbol
			}

			const isAfterCursor = symbol.range.start.isAfter(position)
			const isBeforeNextSymbol = symbol && (!nearest.next || symbol.range.start.isBefore(nearest.next.range.start))

			if (isAfterCursor && isBeforeNextSymbol)
			{
				nearest.next = symbol
				return
			}
		}
	}
}

function findCurrentAndParentSymbol(symbols: vscode.DocumentSymbol[], position: vscode.Position, nearest: NearestSymbols)
{
	for (const symbol of symbols)
	{
		const containsCursor = symbol.range.contains(position)
		const isAfterCurr = !nearest.current || symbol.range.start.isAfter(nearest.current.range.start)

		if (containsCursor && isAfterCurr)
		{
			nearest.parent = nearest.current;
			nearest.current = symbol
		}

		// TODO: It's probably reasonable to assume parent symbols fully contain their children. If we do then we can skip
		// more of the symbol tree by making sure the parent contains the cursor before recursing into its children.
		findCurrentAndParentSymbol(symbol.children, position, nearest)
	}
}

function findChildSymbol(symbols: vscode.DocumentSymbol[], position: vscode.Position, nearest: NearestSymbols)
{
	if (!nearest.current)
		return;

	for (const symbol of nearest.current.children)
	{
		const isBeforeChildSymbol = !nearest.child || symbol.range.start.isBefore(nearest.child.range.start)

		if (isBeforeChildSymbol)
			nearest.child = symbol
	}
}

function findNextAndPreviousSymbols(symbols: vscode.DocumentSymbol[], position: vscode.Position, nearest: NearestSymbols, depth: number)
{
	for (const symbol of symbols)
	{
		const isCurrSymbol = symbol == nearest.current
		const isTopLevel = depth == 0

		let skipUnlessTopLevel = false
		/*
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
				skipUnlessTopLevel = true
				break
		}
		*/

		let alwaysSkip = false
		switch (symbol.kind)
		{
			case vscode.SymbolKind.Class:
			case vscode.SymbolKind.Enum:
			case vscode.SymbolKind.Struct:
				alwaysSkip ||= symbol.detail.includes("declaration")
				break
		}
		alwaysSkip ||= symbol.detail.includes("typedef")

		let recurseSymbol = false
		switch (symbol.kind)
		{
			case vscode.SymbolKind.File:
			case vscode.SymbolKind.Module:
			case vscode.SymbolKind.Namespace:
			case vscode.SymbolKind.Package:
			case vscode.SymbolKind.Class:
			case vscode.SymbolKind.Interface:
			case vscode.SymbolKind.Struct:
				recurseSymbol = true
				break
		}

		if (!isCurrSymbol && (isTopLevel || !skipUnlessTopLevel) && !alwaysSkip)
		{
			const isSameRangeAsCurr = nearest.current && symbol.range.isEqual(nearest.current.range)
			if (!isSameRangeAsCurr)
			{
				const isBeforeCursor = symbol.range.start.isBeforeOrEqual(position)
				const isAfterPrevSymbol = !nearest.previous || symbol.range.start.isAfter(nearest.previous.range.start)

				const isAfterCursor = symbol.range.start.isAfterOrEqual(position)
				const isBeforeNextSymbol = !nearest.next || symbol.range.start.isBefore(nearest.next.range.start)

				if (isBeforeCursor && isAfterPrevSymbol)
					nearest.previous = symbol

				if (isAfterCursor && isBeforeNextSymbol)
					nearest.next = symbol
			}
		}

		if (recurseSymbol)
			findNextAndPreviousSymbols(symbol.children, position, nearest, depth + 1)
	}
}

async function cursorMoveTo_symbol(textEditor: vscode.TextEditor, direction: HierarchyDirection, select: boolean)
{
	if (!symbols)
	{
		// Use the DocumentSymbol variation so we can efficiently skip entire sections of the tree
		symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider", textEditor.document.uri)
	}

	if (!symbols || !symbols.length)
		return

	const symbolRanges: vscode.Range[] = []
	const symbolSelections: vscode.Selection[] = []
	for (const selection of textEditor.selections)
	{
		/*
		const nearest: NearestSymbols = {}
		findNearestSymbols(symbols, selection.active, nearest)

		switch (direction)
		{
			case HierarchyDirection.Prev:
			{
				findNextAndPreviousSymbols(symbols, selection.active, nearest, 0)

				if (nearest.previous)
				{
					symbolRanges.push(nearest.previous.range)
					const symbolSelection = select
					? new vscode.Selection(selection.anchor, nearest.previous.range.start)
					: new vscode.Selection(nearest.previous.range.start, nearest.previous.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}

			case HierarchyDirection.Next:
			{
				findNextAndPreviousSymbols(symbols, selection.active, nearest, 0)

				if (nearest.next)
				{
					symbolRanges.push(nearest.next.range)
					const symbolSelection = select
						? new vscode.Selection(selection.anchor, nearest.next.range.start)
						: new vscode.Selection(nearest.next.range.start, nearest.next.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}

			case HierarchyDirection.Parent:
			{
				if (nearest.parent)
				{
					symbolRanges.push(nearest.parent.range)
					const symbolSelection = select
						? new vscode.Selection(selection.anchor, nearest.parent.range.start)
						: new vscode.Selection(nearest.parent.range.start, nearest.parent.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}

			case HierarchyDirection.Child:
			{
				findChildSymbol(symbols, selection.active, nearest)

				if (nearest.child)
				{
					symbolRanges.push(nearest.child.range)
					const symbolSelection = select
						? new vscode.Selection(selection.anchor, nearest.child.range.start)
						: new vscode.Selection(nearest.child.range.start, nearest.child.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}
		}
		*/

		const nearest: NearestSymbols = {}
		findNearestSymbols(symbols, selection.active, nearest)
		switch (direction)
		{
			case HierarchyDirection.Prev:
			{
				if (nearest.previous)
				{
					symbolRanges.push(nearest.previous.range)
					const symbolSelection = select
					? new vscode.Selection(selection.anchor, nearest.previous.range.start)
					: new vscode.Selection(nearest.previous.range.start, nearest.previous.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}

			case HierarchyDirection.Next:
			{
				if (nearest.next)
				{
					symbolRanges.push(nearest.next.range)
					const symbolSelection = select
					? new vscode.Selection(selection.anchor, nearest.next.range.start)
					: new vscode.Selection(nearest.next.range.start, nearest.next.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}

			case HierarchyDirection.Parent:
			{
				if (nearest.parent)
				{
					symbolRanges.push(nearest.parent.range)
					const symbolSelection = select
					? new vscode.Selection(selection.anchor, nearest.parent.range.start)
					: new vscode.Selection(nearest.parent.range.start, nearest.parent.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}

			case HierarchyDirection.Child:
			{
				if (nearest.child)
				{
					symbolRanges.push(nearest.child.range)
					const symbolSelection = select
					? new vscode.Selection(selection.anchor, nearest.child.range.start)
					: new vscode.Selection(nearest.child.range.start, nearest.child.range.start)
					symbolSelections.push(symbolSelection)
				}
				break
			}
		}
	}

	if (symbolRanges.length)
	{
		textEditor.selections = symbolSelections
		textEditor.revealRange(symbolRanges[0])
		textEditor.revealRange(symbolRanges[0], vscode.TextEditorRevealType.InCenter)

		if (!select)
		{
			// HACK: This is a workaround for https://github.com/microsoft/vscode/issues/106209
			await sleep(4)
			textEditor.setDecorations(symbolHighlightDecoration, symbolRanges)
		}
	}
}

async function deleteChunk(textEditor: vscode.TextEditor, direction: Direction)
{
	switch (direction)
	{
		case Direction.Prev:
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "prevBlankLine", "by": "wrappedLine", "select": true })
			await vscode.commands.executeCommand("deleteLeft")
			break
		}

		case Direction.Next:
		{
			await vscode.commands.executeCommand("cursorMove", { "to": "nextBlankLine", "by": "wrappedLine", "select": true })
			await vscode.commands.executeCommand("deleteRight")
			break
		}
	}
}

function deleteLine_prev(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit)
{
	const deletedLines = new Set<number>
	for (const selection of textEditor.selections)
	{
		if (selection.start.line == 0)
			continue

		const selectedLine = selection.start.line
		const lineToDelete = Math.max(selectedLine - 1, 0)

		if (!deletedLines.has(lineToDelete))
		{
			deletedLines.add(lineToDelete)

			const prevLine = textEditor.document.lineAt(lineToDelete)
			const toDelete = prevLine.rangeIncludingLineBreak
			edit.delete(toDelete)
		}
	}
}

function deleteLine_next(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit)
{
	const deletedLines = new Set<number>
	for (const selection of textEditor.selections)
	{
		if (selection.end.line == textEditor.document.lineCount - 1)
			continue

		const selectedLine = selection.end.line
		const lineToDelete = Math.max(selectedLine + 1, 0)

		if (!deletedLines.has(lineToDelete))
		{
			deletedLines.add(lineToDelete)

			const currLine = textEditor.document.lineAt(selectedLine)
			const nextLine = textEditor.document.lineAt(lineToDelete)

			const newline = new vscode.Range(currLine.range.end, currLine.rangeIncludingLineBreak.end)
			const toDelete = newline.union(nextLine.range)
			edit.delete(toDelete)
		}
	}
}
