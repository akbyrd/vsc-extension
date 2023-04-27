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

	vscode.workspace.onDidChangeTextDocument(() => { symbolNav = undefined })
	vscode.window.onDidChangeActiveTextEditor(() => { symbolNav = undefined })
	vscode.window.onDidChangeTextEditorSelection(e => {
		e.textEditor.setDecorations(symbolHighlightBackground, [])
		e.textEditor.setDecorations(symbolHighlightBorderLR, [])
		e.textEditor.setDecorations(symbolHighlightBorderT, [])
		e.textEditor.setDecorations(symbolHighlightBorderB, [])
	})
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals

let symbolNav: SymbolNavigation | undefined
let taskArgs: object | undefined

const symbolHighlightBackground = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
})

const symbolHighlightBorderLR = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	borderWidth: "1px",
	borderStyle: "none solid",
	borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
})

const symbolHighlightBorderT = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	borderWidth: "1px",
	borderStyle: "solid none none",
	borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
})

const symbolHighlightBorderB = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	borderWidth: "1px",
	borderStyle: "none none solid",
	borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
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

type SymbolNavigation =
{
	rootSymbols: vscode.DocumentSymbol[]
	lastChild:   vscode.DocumentSymbol | undefined
}

type NearestSymbols =
{
	parent?:   vscode.DocumentSymbol
	current?:  vscode.DocumentSymbol
	child?:    vscode.DocumentSymbol
	previous?: vscode.DocumentSymbol
	next?:     vscode.DocumentSymbol
}

function symbolFilter(symbol: vscode.DocumentSymbol): boolean
{
	let skipSymbol = false
	switch (symbol.kind)
	{
		case vscode.SymbolKind.Class:
		case vscode.SymbolKind.Enum:
		case vscode.SymbolKind.Struct:
			skipSymbol ||= symbol.detail.includes("declaration")
			break
	}
	skipSymbol ||= symbol.detail.includes("typedef")
	return !skipSymbol
}

function findParentAndCurrent(symbols: vscode.DocumentSymbol[], position: vscode.Position, nearest: NearestSymbols)
{
	for (const symbol of symbols.filter(symbolFilter))
	{
		const containsCursor = symbol.range.contains(position)
		if (containsCursor)
		{
			const atCurrentStart = position.isBeforeOrEqual(symbol.selectionRange.end)
			if (atCurrentStart || !symbol.children.length)
			{
				nearest.current = symbol
			}
			else
			{
				nearest.parent  = symbol
				nearest.current = undefined
				findParentAndCurrent(symbol.children, position, nearest)
			}
		}
	}
}

function selectClosest(symbols: (vscode.DocumentSymbol | undefined)[], position: vscode.Position): vscode.DocumentSymbol | undefined
{
	let closest: vscode.DocumentSymbol | undefined

	for (const symbol of symbols)
	{
		if (!symbol)
			continue

		if (!closest)
		{
			closest = symbol
			continue
		}

		const lineDistAStart = Math.abs(position.line - symbol.range.start.line)
		const lineDistAEnd   = Math.abs(position.line - symbol.range.end.line)
		const lineDistA = Math.min(lineDistAStart, lineDistAEnd)

		const lineDistBStart = Math.abs(position.line - closest.range.start.line)
		const lineDistBEnd   = Math.abs(position.line - closest.range.end.line)
		const lineDistB = Math.min(lineDistBStart, lineDistBEnd)

		const charDistAStart = Math.abs(position.character - symbol.range.start.character)
		const charDistAEnd   = Math.abs(position.character - symbol.range.end.character)
		const charDistA = Math.min(charDistAStart, charDistAEnd)

		const charDistBStart = Math.abs(position.character - closest.range.start.character)
		const charDistBEnd   = Math.abs(position.character - closest.range.end.character)
		const charDistB = Math.min(charDistBStart, charDistBEnd)

		const aIsCloser = lineDistA < lineDistB || (lineDistA == lineDistB && charDistA < charDistB)
		closest = aIsCloser ? symbol : closest
	}

	return closest
}

async function cursorMoveTo_symbol(textEditor: vscode.TextEditor, direction: HierarchyDirection, select: boolean)
{
	// NOTE: This function makes several assumptions:
	// * Symbols are not necessarily sorted by start position
	// * Symbols fully enclose their children
	// * Root symbols might be physically located inside other symbols

	// NOTE: C++ symbols aren't always sorted by position (not sure of the cause, probably related to edits)
	// NOTE: C++ friend functions inside classes are hoisted to root level (declarations and definitions)
	// NOTE: C++ friend classes inside classes are hoisted to root level (only declarations are allowed)
	// NOTE: C++ friend symbols currently cannot be nested because symbols in functions are ignored

	// NOTE: Measured 0.4 ms to navigate in a file with 1006 symbols
	// NOTE: Measured 5.0 ms to gather symbols in a file with 1006 symbols

	if (!symbolNav)
	{
		// Use the DocumentSymbol variation so we can efficiently skip entire sections of the tree
		const rootSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider", textEditor.document.uri)

		if (rootSymbols)
		{
			function mapNestedSymbol(maybeNested: vscode.DocumentSymbol, maybeParents: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined
			{
				for (const maybeParent of maybeParents)
				{
					if (maybeNested != maybeParent && maybeParent.range.contains(maybeNested.range))
					{
						return mapNestedSymbol(maybeNested, maybeParent.children) ?? maybeParent
					}
				}
				return undefined
			}

			symbolNav = { rootSymbols, lastChild: undefined }

			const nestedSymbols: vscode.DocumentSymbol[] = []
			for (const maybeNested of rootSymbols)
			{
				const parent = mapNestedSymbol(maybeNested, rootSymbols)
				if (parent)
				{
					parent.children.push(maybeNested)
					nestedSymbols.push(maybeNested)
				}
			}
			for (const nested of nestedSymbols)
				rootSymbols.splice(rootSymbols.findIndex(s => s == nested), 1)
		}
	}

	if (!symbolNav?.rootSymbols.length)
		return

	const symbolRanges: vscode.Range[] = []
	const newSelections: vscode.Selection[] = []
	for (const selection of textEditor.selections)
	{
		const position = selection.active
		const rootSymbols = symbolNav.rootSymbols

		const nearest: NearestSymbols = {}
		findParentAndCurrent(rootSymbols, position, nearest)

		const children = (nearest.current ?? nearest.parent)?.children ?? []
		for (const child of children.filter(symbolFilter))
		{
			const isBeforeChild = !nearest.child || child.range.start.isBefore(nearest.child.range.start)
			if (isBeforeChild)
				nearest.child = child
		}

		const siblings = nearest.parent?.children ?? rootSymbols
		for (const sibling of siblings.filter(symbolFilter))
		{
			const isBeforeCursor = sibling.range.start.isBefore(position)
			const isAfterPrevSymbol = !nearest.previous || sibling.range.start.isAfter(nearest.previous.range.start)

			if (isBeforeCursor && isAfterPrevSymbol)
				nearest.previous = sibling

			const isAfterCursor = sibling.range.start.isAfter(position)
			const isBeforeNextSymbol = !nearest.next || sibling.range.start.isBefore(nearest.next.range.start)

			if (isAfterCursor && isBeforeNextSymbol)
				nearest.next = sibling
		}

		let newSymbol
		switch (direction)
		{
			case HierarchyDirection.Prev:
				newSymbol = nearest.previous
				break

			case HierarchyDirection.Next:
				newSymbol = nearest.next
				break

			case HierarchyDirection.Parent:
				newSymbol = nearest.parent
				break

			case HierarchyDirection.Child:
				newSymbol = symbolNav.lastChild ?? nearest.child
				break
		}

		if (newSymbol)
		{
			symbolNav.lastChild = undefined
			if (direction == HierarchyDirection.Parent)
				symbolNav.lastChild = nearest.current ?? selectClosest([nearest.previous, nearest.next], selection.active)

			symbolRanges.push(newSymbol.range)
			const symbolSelection = select
				? new vscode.Selection(selection.anchor, newSymbol.range.start)
				: new vscode.Selection(newSymbol.range.start, newSymbol.range.start)
			newSelections.push(symbolSelection)
		}
		else
		{
			if (nearest.current)
				symbolRanges.push(nearest.current.range)
			newSelections.push(selection)
		}
	}

	textEditor.selections = newSelections

	if (symbolRanges.length)
	{
		textEditor.revealRange(symbolRanges[0], vscode.TextEditorRevealType.InCenter)

		if (!select)
		{
			// HACK: This is a workaround for https://github.com/microsoft/vscode/issues/106209
			await sleep(4)
			textEditor.setDecorations(symbolHighlightBackground, symbolRanges)
			textEditor.setDecorations(symbolHighlightBorderLR, symbolRanges)
			textEditor.setDecorations(symbolHighlightBorderT, symbolRanges.map(r => new vscode.Range(r.start, r.start)))
			textEditor.setDecorations(symbolHighlightBorderB, symbolRanges.map(r => new vscode.Range(r.end, r.end)))
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
