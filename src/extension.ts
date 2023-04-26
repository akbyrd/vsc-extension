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
	vscode.window.onDidChangeActiveTextEditor(() => { rootSymbol = undefined })
	vscode.workspace.onDidChangeTextDocument(() => { rootSymbol = undefined })
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals

let rootSymbol: vscode.DocumentSymbol | undefined
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
	root?:     vscode.DocumentSymbol
	parent?:   vscode.DocumentSymbol
	current?:  vscode.DocumentSymbol
	child?:    vscode.DocumentSymbol
	previous?: vscode.DocumentSymbol
	next?:     vscode.DocumentSymbol
}

function findNearestSymbols(root: vscode.DocumentSymbol, position: vscode.Position): NearestSymbols
{
	// NOTE: This function makes several assumptions:
	// * Symbols are not necessarily sorted by start position
	// * Symbols fully enclose their children
	// * Root symbols might be physically located inside other symbols

	// NOTE: C++ symbols aren't always sorted by position (not sure of the cause, probably related to edits)
	// NOTE: C++ friend functions inside classes are hoisted to root level (declarations and definitions)
	// NOTE: C++ friend classes inside classes are hoisted to root level (only declarations are allowed)
	// NOTE: C++ friend symbols currently cannot be nested because symbols in functions are ignored

	// [x] iterate roots
	// [x] recurse to find parent, current, child
	// [x] current is null unless at start
	// [x] collect all results
	// [x] pick the deepest one
	// [x] iterate roots to find nested
	// [x] reject nested under anything other than parent
	// [x] iterate parent nested to find parent, current
	// [x] iterate current children & current nested to find child
	// [x] iterate parent children & parent nested to find previous and next

	// TODO: Try out the selectionRange of the symbol
	// TODO: There's a nice scrollbar overlay when using built-in symbol navigation
	// TODO: Test with nested symbols before current

	function shouldSkipSymbol(symbol: vscode.DocumentSymbol)
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
		return skipSymbol
	}

	function findParentAndCurrent(symbol: vscode.DocumentSymbol, position: vscode.Position, nearest: NearestSymbols)
	{
		const containsCursor = symbol.range.contains(position)
		if (containsCursor)
		{
			const atCurrentStart = symbol.range.start.isEqual(position)
			if (atCurrentStart)
			{
				nearest.parent  = nearest.current
				nearest.current = symbol
			}
			else
			{
				nearest.parent  = symbol
				nearest.current = undefined

				for (const childSymbol of symbol.children)
				{
					if (shouldSkipSymbol(childSymbol))
						continue

					findParentAndCurrent(childSymbol, position, nearest)
				}
			}
		}
	}

	function gatherNestedSymbols(symbols: vscode.DocumentSymbol[], parent?: vscode.DocumentSymbol) : vscode.DocumentSymbol[]
	{
		const nested: vscode.DocumentSymbol[] = []
		if (!parent)
			return nested

		for (const symbol of symbols)
		{
			if (shouldSkipSymbol(symbol))
				continue

			if (symbol == parent)
				continue

			const inSymbol = parent?.range.contains(symbol.range)
			const inChildSymbol = symbol.children.some(child => child.range.contains(symbol.range))
			if (inSymbol && !inChildSymbol)
				nested.push(symbol)
		}

		return nested
	}

	function selectSmallerSymbol(A: vscode.DocumentSymbol, B: vscode.DocumentSymbol): vscode.DocumentSymbol
	{
		const lineDiffA = A.range.end.line - A.range.start.line
		const charDiffA = A.range.end.character - A.range.start.character

		const lineDiffB = B.range.end.line - B.range.start.line
		const charDiffB = B.range.end.character - B.range.start.character

		const isASmaller = lineDiffA < lineDiffB || charDiffA < charDiffB
		return isASmaller ? A : B
	}

	let nearest: NearestSymbols = {}

	const nearestMap = new Map<vscode.DocumentSymbol, NearestSymbols>
	for (const symbol of root.children)
	{
		if (shouldSkipSymbol(symbol))
			continue

		const maybeNearest: NearestSymbols = { root: root }
		findParentAndCurrent(symbol, position, maybeNearest)

		if (maybeNearest.parent || maybeNearest.current)
		{
			nearestMap.set(symbol, maybeNearest)

			const nearestSymbol = nearest.current ?? nearest.parent
			const maybeNearestSymbol = maybeNearest.current ?? maybeNearest.parent
			if (!nearestSymbol)
			{
				nearest = maybeNearest
			}
			else
			{
				nearest = selectSmallerSymbol(nearestSymbol, maybeNearestSymbol!) == nearestSymbol
					? nearest
					: maybeNearest
			}
		}
	}

	const nestedInParent = gatherNestedSymbols(root.children, nearest.parent)
	const nestedInCurrent = gatherNestedSymbols(root.children, nearest.current)

	for (const nested of nestedInParent)
	{
		const nestedNearest = nearestMap.get(nested)
		if (nestedNearest)
		{
			nestedNearest.parent = nearest.parent
			nearest = nestedNearest
		}
	}

	if (nearest.current)
	{
		for (const child of nearest.current.children.concat(nestedInCurrent))
		{
			const isBeforeChild = !nearest.child || child.range.start.isBefore(nearest.child.range.start)
			if (isBeforeChild)
				nearest.child = child
		}
	}

	if (nearest.parent)
	{
		for (const sibling of nearest.parent.children.concat(nestedInParent))
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
	}
	else
	{
		for (const sibling of nearest.root!.children)
		{
			if (nestedInCurrent.includes(sibling))
				continue

			const isBeforeCursor = sibling.range.start.isBefore(position)
			const isAfterPrevSymbol = !nearest.previous || sibling.range.start.isAfter(nearest.previous.range.start)

			if (isBeforeCursor && isAfterPrevSymbol)
				nearest.previous = sibling

			const isAfterCursor = sibling.range.start.isAfter(position)
			const isBeforeNextSymbol = !nearest.next || sibling.range.start.isBefore(nearest.next.range.start)

			if (isAfterCursor && isBeforeNextSymbol)
				nearest.next = sibling
		}
	}

	return nearest
}

async function cursorMoveTo_symbol(textEditor: vscode.TextEditor, direction: HierarchyDirection, select: boolean)
{
	if (!rootSymbol)
	{
		// Use the DocumentSymbol variation so we can efficiently skip entire sections of the tree
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider", textEditor.document.uri)

		if (symbols)
		{
			const firstLine = textEditor.document.lineAt(0)
			const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1)
			const documentRange = new vscode.Range(firstLine.range.start, lastLine.range.end)
			rootSymbol = new vscode.DocumentSymbol("root", "", vscode.SymbolKind.Null, documentRange, documentRange)
			rootSymbol.children = symbols
		}
	}

	if (!rootSymbol?.children.length)
		return

	const symbolRanges: vscode.Range[] = []
	const newSelections: vscode.Selection[] = []
	for (const selection of textEditor.selections)
	{
		const nearest = findNearestSymbols(rootSymbol, selection.active)

		let newSymbol
		switch (direction)
		{
			case HierarchyDirection.Prev:
				//newSymbol = nearest.previous ?? nearest.current
				newSymbol = nearest.previous
				break

			case HierarchyDirection.Next:
				newSymbol = nearest.next
				break

			case HierarchyDirection.Parent:
				//newSymbol = nearest.parent ?? nearest.current
				newSymbol = nearest.parent
				break

			case HierarchyDirection.Child:
				newSymbol = nearest.child
				break
		}

		if (newSymbol)
		{
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
