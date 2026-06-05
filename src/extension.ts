import * as vscode from "vscode"
import * as path   from "path"
import * as ts     from "web-tree-sitter"

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
		vscode.commands.registerTextEditorCommand("akbyrd.editor.fold.functions",                       t => fold_definitions(t, false, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.fold.definitions",                     t => fold_definitions(t, true, true)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.fold.definitions.exceptSelected",      t => fold_definitions(t, true, false)),
		vscode.commands.registerTextEditorCommand("akbyrd.editor.wrap.lines",                           wrap_lines),
	)

	vscode.workspace.onDidCloseTextDocument(removeDocumentSymbols)
	vscode.workspace.onDidChangeTextDocument(e => removeDocumentSymbols(e.document))
	vscode.window.onDidChangeTextEditorSelection(e => updateSymbolHighlights(e.textEditor))
}

// ---------------------------------------------------------------------------------------------------------------------
// Plain Commands

let taskArgs: object | undefined

type TaskWithArgs =
{
	task: string
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

enum Direction
{
	Prev,
	Next,
}

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

async function fold_definitions(textEditor: vscode.TextEditor, foldTypes: boolean, foldCurrent: boolean)
{
	// NOTE: Multiple folding ranges can end on the same line.
	// NOTE: I assume multiple folding ranges cannot start on the same line.

	const isMarkdown = textEditor.document.languageId == 'markdown'
	const foldStrings = isMarkdown

	const documentSymbols = await cacheDocumentSymbols(textEditor)
	if (!documentSymbols?.rootSymbols.length)
		return

	const symbolsToFold: vscode.DocumentSymbol[] = []
	function gatherFoldRanges(symbols: vscode.DocumentSymbol[])
	{
		for (const symbol of symbols.filter(symbolFilter))
		{
			let fold = true
			switch (symbol.kind)
			{
				case vscode.SymbolKind.Class:
				case vscode.SymbolKind.Enum:
				case vscode.SymbolKind.Interface:
				case vscode.SymbolKind.Object:
				case vscode.SymbolKind.Struct:
					fold = foldTypes
					break

				case vscode.SymbolKind.Method:
				case vscode.SymbolKind.Property:
				case vscode.SymbolKind.Constructor:
				case vscode.SymbolKind.Function:
				case vscode.SymbolKind.Null:
				case vscode.SymbolKind.Event:
				case vscode.SymbolKind.Operator:
					fold = true
					break

				case vscode.SymbolKind.Variable:
					fold = symbol.range.end.line - symbol.range.start.line > 3
					break

				case vscode.SymbolKind.String:
					fold = foldStrings
					break

				case vscode.SymbolKind.File:
				case vscode.SymbolKind.Module:
				case vscode.SymbolKind.Namespace:
				case vscode.SymbolKind.Package:
				case vscode.SymbolKind.Field:
				case vscode.SymbolKind.Constant:
				case vscode.SymbolKind.Number:
				case vscode.SymbolKind.Boolean:
				case vscode.SymbolKind.Array:
				case vscode.SymbolKind.Key:
				case vscode.SymbolKind.EnumMember:
				case vscode.SymbolKind.TypeParameter:
					fold = false
					break
			}

			fold &&= !symbol.range.isSingleLine
			fold &&= foldCurrent || !textEditor.selections.some(selection => symbol.range.intersection(selection))

			// NOTE: Use range.end because templates and functions can span multiple lines before the foldable range
			if (fold)
				symbolsToFold.push(symbol)

			gatherFoldRanges(symbol.children)
		}
	}

	gatherFoldRanges(documentSymbols.rootSymbols)

	const toFold: number[] = []
	const foldingRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", textEditor.document.uri)

	// HACK: Skip folding for any symbols that don't have a corresponding folding range. This happens when a symbol is
	// inside a disabled processor block in C++. https://github.com/microsoft/vscode-cpptools/issues/10963
	for (const symbol of symbolsToFold)
	{
		for (const foldingRange of foldingRanges)
		{
			const range = new vscode.Range(foldingRange.start, Infinity, foldingRange.end, 0)
			if (symbol.range.contains(range))
				toFold.push(foldingRange.start)
		}
	}

	for (const foldingRange of foldingRanges)
	{
		let fold = false
		switch (foldingRange.kind)
		{
			case vscode.FoldingRangeKind.Comment:
				fold = (foldingRange.end - foldingRange.start) >= 2
				break
		}

		const range = new vscode.Range(foldingRange.start, 0, foldingRange.end - 1, Infinity)
		fold &&= foldCurrent || !textEditor.selections.some(selection => range.intersection(selection))

		if (fold)
			toFold.push(foldingRange.start)
	}

	await vscode.commands.executeCommand("editor.fold", { levels: 1, selectionLines: toFold })
}

// Spec
//
// Requirements
// * Only wrap comments and plain text
// * Break at: whitespace
// * Preserve lines beginning with: { *, -, <number>., <number>), <whitespace>, <empty>, \tag, @tag }
// * Recognize line prefixes: { <language-comment-sequences>, <Doxygen-sequence> }
// * For block comments, respect line prefix
// * Preserve indentation
// * Very high performance. Eliminate string formatting/concatenation whenever possible.
// * Handle escaped newlines ('\' at the end of a C++ single line comment that causes it to include the next line)
// * Respect tabs vs spaces
// * Respect tab width
// * Normalize indentation
// * Normalize line prefixes
// * Preserve code blocks in comments (``` markdown style and \code \endcode doxygen style)
// * Don't handle comments inside strings or other constructs that make them invalid comments
//
// Edge Cases
// * Line comment at end of line
// * Block comment at beginning of line
// * Block comment in middle of line
// * Block comment at end of line
// * Line comment after block comment
// * Block comment after block comment
//
// Questions
// * What happens to existing selections if we split them and make document modifications? Maybe we just replace them?
async function wrap_lines_pattern(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit)
{
	// NOTE: Unfortunately, vscode doesn't expose full token information about documents. Symbols
	// don't include comments, folding ranges don't include 1-2 line comments, semantic tokens
	// generally don't include comments, syntax tokens are not exposed through the API, and direct
	// LSP server access isn't exposed. The only option we have is manual parsing. We could do that
	// with pattern matching (regex or simple string matching) or with an external tool. Bundling an
	// external tool is a pain, so we use pattern matching here.

	const prefixes = [ "//", " *", "///", "/*", "*" ]
	const prefixPatterns = [ "@\w+", "\\\w+" ]

	// If comment symbol replace selection with full symbol
	// Else find beginning and end by looking for blank lines
	// Determine if multiple comments / symbols, split
	// Determine comment type from first line
	// Determine prefix from second line (skip for now)

	const document  = textEditor.document
	const config    = vscode.workspace.getConfiguration("editor", document.uri)
	type  rulerType = number | { column: number };
	const rulers    = config.get<rulerType[]>("rulers")

	if (!rulers || rulers.length == 0) return
	const wrapCol = typeof rulers[0] === "number" ? rulers[0] : rulers[0].column

	enum BlockType { LineComment, BlockComment, Prose }
	type Block = { type: BlockType, startLine: number, endLine: number }

	function classifyLine(text: string): BlockType | undefined
	{
		if (/^\s*(\/\/|#|--|;)/.test(text)) return BlockType.LineComment
		if (/\/\*/.test(text))             return BlockType.BlockComment
		if (/^\s*\*/.test(text))           return BlockType.BlockComment
		if (/\S/.test(text))               return BlockType.Prose
		return undefined
	}

	const blocks: Block[] = []
	for (const selection of textEditor.selections)
	{
		let lineNum = selection.start.line
		const selEnd = selection.end.line

		while (lineNum <= selEnd)
		{
			const line = document.lineAt(lineNum)

			if (line.isEmptyOrWhitespace) { lineNum++; continue }

			const type = classifyLine(line.text)
			if (type === undefined)         { lineNum++; continue }

			let startLine = lineNum
			let endLine   = lineNum

			if (type === BlockType.BlockComment)
			{
				// Walk backwards to find /*
				while (startLine > 0 && !/\/\*/.test(document.lineAt(startLine).text))
					startLine--

				// Walk forwards to find */
				while (endLine < document.lineCount - 1 && !/\*\//.test(document.lineAt(endLine).text))
					endLine++
			}
			else
			{
				// Walk backwards to find start of run
				while (startLine > 0)
				{
					const prev = document.lineAt(startLine - 1)
					if (prev.isEmptyOrWhitespace)                                            break
					if (type === BlockType.LineComment && classifyLine(prev.text) !== type)  break
					startLine--
				}

				// Walk forwards to find end of run
				while (endLine < document.lineCount - 1)
				{
					const next = document.lineAt(endLine + 1)
					if (next.isEmptyOrWhitespace)                                            break
					if (type === BlockType.LineComment && classifyLine(next.text) !== type)  break
					endLine++
				}
			}

			blocks.push({ type, startLine, endLine })
			lineNum = endLine + 1
		}
	}

	textEditor.selections = blocks.map(b =>
	{
		const endLineLen = document.lineAt(b.endLine).text.length
		return new vscode.Selection(b.endLine, endLineLen, b.startLine, 0)
	})
}

async function wrap_lines(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit)
{
	// TODO: Cache parser
	// TODO: Cache fetch results
	// TODO: Cache language results
	// TODO: Cache parse results
	// TODO: Cache query results
	// TODO: Share statusBarMessage

	// TODO: Remove this
	console.clear()

	function toPosition(p: ts.Point): vscode.Position
	{
		return new vscode.Position(p.row, p.column)
	}

	function toRange(n: ts.Node): vscode.Range
	{
		const start = toPosition(n.startPosition)
		const end   = toPosition(n.endPosition)
		return new vscode.Range(start, end)
	}

	function toPoint(p: vscode.Position): ts.Point
	{
		return { row: p.line, column: p.character }
	}

	function toString(r: vscode.Range | ts.Node): string
	{
		if (r instanceof vscode.Range)
		{
			return `[${r.start.line + 1}, ${r.start.character + 1}] -> [${r.end.line + 1}, ${r.end.character + 1}]`
		}
		else
		{
			return `[${r.startPosition.row + 1}, ${r.startPosition.column + 1}] -> [${r.endPosition.row + 1}, ${r.endPosition.column + 1}]`
		}
	}

	function consume(s: string, offset: number, p: RegExp|string): number
	{
		if (p instanceof RegExp)
		{
			for (; offset < s.length; offset++)
			{
				if (!s[offset].match(p))
					break
			}
			return offset
		}
		else
		{
			if (s.startsWith(p, offset))
				offset += p.length
			return offset
		}
	}

	function assert(value: unknown): asserts value
	{
		console.assert(value)
	}


	const tabSize      : number   = textEditor.options.tabSize as number
	const useSpaces    : boolean  = textEditor.options.insertSpaces as boolean
	const languageId   : string   = textEditor.document.languageId
	const languageData : Language = languages[languageId]

	// Gather blocks
	enum BlockType
	{
		null,
		lineComment,
		blockComment,
		prose,
	}
	const blocks : {
		type     : BlockType,
		range    : vscode.Range,
		endNode? : ts.Node,
		indent?  : {
			spaces : number,
			string : string,
		},
		prefix?  : [string, string, string],
	}[] = []

	{
		var parse : {
			parser: ts.Parser,
			tree:   ts.Tree,
		} | undefined
		if (languageData)
		{
			try
			{
				await ts.Parser.init()
				const response : Response    = await fetch(languageData.grammar)
				const wasm     : ArrayBuffer = await response.arrayBuffer()
				const language : ts.Language = await ts.Language.load(new Uint8Array(wasm))
				const parser   : ts.Parser   = new ts.Parser().setLanguage(language)
				const text     : string      = textEditor.document.getText()
				const tree     : ts.Tree     = parser.parse(text)!
				console.assert(tree)

				parse = { parser, tree }
			}
			catch (e)
			{
				console.log(e)
				symbolNav.statusBarMessage?.dispose()
				symbolNav.statusBarMessage = vscode.window.setStatusBarMessage(`Failed to parse: ${String(e)}`, 3000)
			}
		}

		if (parse)
		{
			// TODO: Handle overlapping queries (due to character expand)

			const sortedSelections = textEditor.selections.slice()
			sortedSelections.sort((a, b) => a.start.compareTo(b.start))

			for (const selection of sortedSelections)
			{
				// NOTE: tree sitter doesn't consider adjacent matches (they must physically overlap) so
				// we grow selections by 1 character in both directions, without flowing onto adjacent
				// lines. Neither vscode nor tree sitter appear to have a problem with column positions
				// that go past the end of the line. But vscode throws for positions before the
				// beginning of the line (i.e. negative values).
				const start : vscode.Position = selection.start.with(undefined, Math.max(selection.start.character - 1, 0))
				const end   : vscode.Position = selection.end  .with(undefined, selection.end.character + 1)

				const query    : ts.Query          = new ts.Query(parse.parser.language!, "(comment) @c")
				const options  : ts.QueryOptions   = { startPosition: toPoint(start), endPosition: toPoint(end) }
				const captures : ts.QueryCapture[] = query.captures(parse.tree.rootNode, options)

				for (const capture of captures)
				{
					const text        : string  = capture.node.text
					const lineComment : string  = languageData.lineComment
					const isLine      : boolean = !!lineComment && text.startsWith(lineComment)

					if (isLine)
					{
						// NOTE: tree sitter treats adjacent line comments as separate comments. So we
						// expand to include immediately adjacent line comments above and below (while
						// being careful not to end up with overlapping blocks).

						var startNode : ts.Node = capture.node
						var endNode   : ts.Node = capture.node

						// TODO: Skip if already part of previous block
						// Can't check single node, because previous may have walked multiple trailing nodes

						// TODO: Should we naively fill blocks, then prune duplicates/overlaps?
						// Con: Will check block types that can't actually overlap

						// NOTE: The previous block (if it was a line comment) may have extended downward
						// to include this one.
						const startPos  = toPosition(startNode.startPosition)
						const isHandled = blocks.at(-1)?.range.end.isAfter(startPos)
						if (isHandled) continue

						while (true)
						{
							const node       = startNode.previousSibling
							const isComment  = node?.type == "comment"
							const isLine     = node?.text.startsWith(languageData.lineComment)
							const isAdjacent = node?.startPosition.row == startNode.startPosition.row - 1
							const isTrailing = node?.startPosition.row == node?.previousSibling?.startPosition.row
							if (isComment && isLine && isAdjacent && !isTrailing)
							{
								startNode = node
								continue
							}
							break
						}

						while (true)
						{
							const node       = endNode.nextSibling
							const isComment  = node?.type == "comment"
							const isLine     = node?.text.startsWith(languageData.lineComment)
							const isAdjacent = node?.startPosition.row == endNode.startPosition.row + 1
							if (isComment && isLine && isAdjacent)
							{
								endNode = node
								continue
							}
							break
						}

						blocks.push({
							type:    BlockType.lineComment,
							range:   new vscode.Range(toPosition(startNode.startPosition), toPosition(endNode.endPosition)),
							endNode: endNode,
						});
					}
					else
					{
						blocks.push({
							type:  BlockType.blockComment,
							range: toRange(capture.node),
						});
					}
				}
			}
		}
		else if (languageId == "plaintext")
		{
			for (const selection of textEditor.selections)
			{
				blocks.push({
					type:  BlockType.prose,
					range: selection,
				});
			}
		}
	}

	// TODO: Remove
	{
		for (const block of blocks)
			console.log(BlockType[block.type], toString(block.range))
	}

	// Analyze and split blocks
	{
		for (const block of blocks)
		{
			const text : string = textEditor.document.lineAt(block.range.start).text

			// TODO: Only handle indentation if at the beginning of a line

			// Detect indentation
			block.indent = {
				spaces: 0,
				string: ""
			}
			var stop = false
			for (let i = 0; i < text.length && !stop; i++)
			{
				// NOTE: For tabs, we have to ensure tabs stops are handled correctly when indentation
				// is a mix of tabs and spaces. e.g. a space before a tab doesn't change the indentation
				// (assuming the tab size is >1).
				switch (text[i])
				{
					default: stop = true; break
					case ' ':  block.indent.spaces += 1; break
					// TODO: Handle mixed indentation
					case '\t': block.indent.spaces += tabSize; break
				}
			}
			const tabs = Math.floor(block.indent.spaces / tabSize)
			block.indent.string = useSpaces ? " ".repeat(tabs * tabSize) : "\t".repeat(tabs)

			// Detect prefix
			switch (block.type)
			{
				case BlockType.blockComment:
					block.prefix = languageData.blockComment
					break

				case BlockType.lineComment:
					const lc = languageData.lineComment
					block.prefix = [lc, lc, lc]
					break

				case BlockType.prose:
					block.prefix = ["", "", ""]
					break
			}

			assert(block.prefix)
			assert(block.indent)
		}
	}

	// TODO: Compare: incremental vs monolithic
	// TODO: Actually split blocks
	// TODO: Figure out how to handle code in markdown / other embedded languages
	// TODO: Ignore embedded single line comments
	// TODO: Make it unit testable
	// TODO: Convert block comment style (block or line)

	// Wrap blocks
	{
		// NOTE: Indentation and line prefixes are normalized. This means:
		// * Converted to tabs or spaces based on editor settings
		// * Rounded down to the nearest tab stop based on editor settings
		// * Line prefixes updated to canonical form based on language settings

		// NOTE: Edits may not overlap. For example, you cannot remove a newline character and place a
		// new one at the same location. This means we can't use a naive approach that unwraps the
		// block and then re-wraps it.

		const trimmedPrefixes = []
		for (const prefix of languageData.blockComment)
			trimmedPrefixes.push(prefix.trimStart())

		for (const block of blocks)
		{
			assert(block.prefix)
			assert(block.indent)

			switch (block.type)
			{
				case BlockType.blockComment:
				case BlockType.lineComment:
				{
					const incremental = false
					if (incremental)
					{

					}
					else
					{
						// TODO: Implement
						// * for each line (including dummy before first)
						// *     replace newline, indent, sequence

						// first line, trailing - if single line, ignore
						// first line, embedded - prune before this
						// all lines            - normalize indentation
						//    * count indentation (handle mixed tabs and spaces)
						//    * if has expected prefix
						//        if within 1 tab stop of expected, assume prefix, else content
						// all lines            - normalize prefix

						// TODO: Handle non-standard prefixes
						// /**
						// /*!
						// ///
						// //!
						//
						// /*!<
						// /**<
						// //!<
						// ///<
						//
						// check for prefix
						// consume until space or alphanumeric
						// consume space
						// line comment - use prefix from first line
						// block comment - use prefix from second line

						// TODO: This needs to be position based, not line based

						const lines :string[] = []
						for (var iLine = block.range.start.line; iLine <= block.range.end.line; iLine++)
						{
							const lineText : string = textEditor.document.lineAt(iLine).text

							var iChar = 0
							var spaces = 0
							var stop = false
							for (; iChar < lineText.length && !stop; iChar++)
							{
								const char = lineText[iChar]
								switch (char)
								{
									default: stop = true; break
									case ' ': spaces += 1; break
									// TODO: Handle mixed indentation
									case '\t': spaces += tabSize; break
								}
							}
							iChar = Math.max(0, iChar - 1)

							const begin   = iLine == block.range.start.line
							const cont    = iLine < block.range.end.line
							const iPrefix = begin ? 0 : cont ? 1 : 2
							const prefix  = block.prefix[iPrefix]
							const trimmed = block.type == BlockType.blockComment ? trimmedPrefixes[iPrefix] : block.prefix[iPrefix]

							const iEndPrefix    = iChar = consume(lineText, iChar, trimmed)   // Expected prefix
							const iEndCustom    = iChar = consume(lineText, iChar, /[^\w\s]/) // Custom prefix
							const iBeginContent = iChar = consume(lineText, iChar, /\s/)      // Whitespace

							const customPrefix = lineText.substring(iEndPrefix, iEndCustom)
							const lineContent  = lineText.substring(iBeginContent)
							lines.push(`${block.indent.string}${prefix}${customPrefix} ${lineContent}`)
						}

						const blockText = lines.join('\n')
						console.log(`block text: "${blockText}"`)
					}
					break
				}

				case BlockType.prose:
					break
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

type Language = {
	grammar      : string,
	lineComment  : string,
	blockComment : [string, string, string],
}

// TODO: lua, powershell, toml, yaml, xml, markdown
const languages: Record<string, Language> = {
	c: {
		grammar: "https://github.com/tree-sitter/tree-sitter-c/releases/latest/download/tree-sitter-c.wasm",
		lineComment: "//",
		blockComment: [ "/*", " *", " */" ],
	},
	cpp: {
		grammar: "https://github.com/tree-sitter/tree-sitter-cpp/releases/latest/download/tree-sitter-cpp.wasm",
		lineComment: "//",
		blockComment: [ "/*", " *", " */" ],
	},
	csharp: {
		grammar: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/latest/download/tree-sitter-c_sharp.wasm",
		lineComment: "//",
		blockComment: [ "/*", " *", " */" ],
	},
	css: {
		grammar: "https://github.com/tree-sitter/tree-sitter-css/releases/latest/download/tree-sitter-css.wasm",
		lineComment: "",
		blockComment: [ "/*", " *", " */" ],
	},
	go: {
		grammar: "https://github.com/tree-sitter/tree-sitter-go/releases/latest/download/tree-sitter-go.wasm",
		lineComment: "//",
		blockComment: [ "/*", " *", " */" ],
	},
	html: {
		grammar: "https://github.com/tree-sitter/tree-sitter-html/releases/latest/download/tree-sitter-html.wasm",
		lineComment: "",
		blockComment: [ "<!--", "", "-->" ],
	},
	javascript: {
		grammar: "https://github.com/tree-sitter/tree-sitter-javascript/releases/latest/download/tree-sitter-javascript.wasm",
		lineComment: "//",
		blockComment: [ "/*", " *", " */" ],
	},
	json: {
		grammar: "https://github.com/tree-sitter/tree-sitter-json/releases/latest/download/tree-sitter-json.wasm",
		lineComment: "",
		blockComment: [ "", "", "" ],
	},
	python: {
		grammar: "https://github.com/tree-sitter/tree-sitter-python/releases/latest/download/tree-sitter-python.wasm",
		lineComment: "#",
		blockComment: [ "", "", "" ],
	},
	shellscript: {
		grammar: "https://github.com/tree-sitter/tree-sitter-bash/releases/latest/download/tree-sitter-bash.wasm",
		lineComment: "#",
		blockComment: [ "", "", "" ],
	},
	typescript: {
		grammar: "https://github.com/tree-sitter/tree-sitter-typescript/releases/latest/download/tree-sitter-typescript.wasm",
		lineComment: "//",
		blockComment: [ "/*", " *", " */" ],
	},
}

// ---------------------------------------------------------------------------------------------------------------------
// Symbol Cache

const symbolNav: SymbolNavigation = {
	textDocumentSymbols: new Map<vscode.TextDocument, DocumentSymbols>,

	highlightBackground: vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
	}),

	highlightBorderLR: vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: "1px",
		borderStyle: "none solid",
		borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
	}),

	highlightBorderT: vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: "1px",
		borderStyle: "solid none none",
		borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
	}),

	highlightBorderB: vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: "1px",
		borderStyle: "none none solid",
		borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
	}),
}

type SymbolNavigation =
{
	textDocumentSymbols: Map<vscode.TextDocument, DocumentSymbols>
	highlightBackground: vscode.TextEditorDecorationType
	highlightBorderLR:   vscode.TextEditorDecorationType
	highlightBorderT:    vscode.TextEditorDecorationType
	highlightBorderB:    vscode.TextEditorDecorationType
	statusBarMessage?:   vscode.Disposable
}

type DocumentSymbols =
{
	rootSymbols:     vscode.DocumentSymbol[]
	highlightRanges: vscode.Range[]
	lastChildren:    vscode.DocumentSymbol[]
	lastSelections?: readonly vscode.Selection[]
}

async function cacheDocumentSymbols(textEditor: vscode.TextEditor): Promise<DocumentSymbols | undefined>
{
	let documentSymbols = symbolNav.textDocumentSymbols.get(textEditor.document)
	if (!documentSymbols)
	{
		// Use the DocumentSymbol variation (instead of SymbolInformation) so we can efficiently skip
		// entire sections of the tree. This returns a mostly-flat array of all symbols that we'll
		// convert into a better tree
		const rootSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider", textEditor.document.uri)

		if (rootSymbols)
		{
			// Find the direct parent / nearest ancestor of the symbol
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

			documentSymbols = { rootSymbols, highlightRanges: [], lastChildren: [], lastSelections: textEditor.selections }
			symbolNav.textDocumentSymbols.set(textEditor.document, documentSymbols)
			symbolNav.statusBarMessage?.dispose()

			// Restructure the array into proper tree
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
		else
		{
			symbolNav.statusBarMessage?.dispose()
			symbolNav.statusBarMessage = vscode.window.setStatusBarMessage("No symbols found in this file", 3000)
		}
	}

	return documentSymbols
}

function removeDocumentSymbols(textDocument: vscode.TextDocument)
{
	const toRemove: vscode.TextDocument[] = []
	for (const pair of symbolNav.textDocumentSymbols)
	{
		const cachedTextDocument = pair[0]
		if (cachedTextDocument == textDocument)
			toRemove.push(cachedTextDocument)
	}

	for (const textDocument of toRemove)
		symbolNav.textDocumentSymbols.delete(textDocument)
}

// ---------------------------------------------------------------------------------------------------------------------
// Text Editor Commands - Symbol Navigation

type NearestSymbols =
{
	parent?:   vscode.DocumentSymbol
	current?:  vscode.DocumentSymbol
	child?:    vscode.DocumentSymbol
	previous?: vscode.DocumentSymbol
	next?:     vscode.DocumentSymbol
}

enum HierarchyDirection
{
	Prev,
	Next,
	Parent,
	Child,
}

function updateSymbolHighlights(textEditor: vscode.TextEditor)
{
	const documentSymbols = symbolNav.textDocumentSymbols.get(textEditor.document)

	// HACK: This is a workaround for https://github.com/microsoft/vscode/issues/181233
	let isSelectionSame = true
	isSelectionSame &&= documentSymbols != undefined
	isSelectionSame &&= textEditor.selections.length == documentSymbols!.lastSelections?.length
	isSelectionSame &&= textEditor.selections.every((selection, i) => selection.isEqual(documentSymbols!.lastSelections![i]))

	if (isSelectionSame)
	{
		textEditor.setDecorations(symbolNav.highlightBackground, documentSymbols!.highlightRanges)
		textEditor.setDecorations(symbolNav.highlightBorderLR, documentSymbols!.highlightRanges)
		textEditor.setDecorations(symbolNav.highlightBorderT, documentSymbols!.highlightRanges.map(r => new vscode.Range(r.start, r.start)))
		textEditor.setDecorations(symbolNav.highlightBorderB, documentSymbols!.highlightRanges.map(r => new vscode.Range(r.end, r.end)))
	}
	else
	{
		if (documentSymbols)
		{
			documentSymbols.highlightRanges.length = 0
			documentSymbols.lastChildren.length = 0
			documentSymbols.lastSelections = undefined
		}

		textEditor.setDecorations(symbolNav.highlightBackground, [])
		textEditor.setDecorations(symbolNav.highlightBorderLR, [])
		textEditor.setDecorations(symbolNav.highlightBorderT, [])
		textEditor.setDecorations(symbolNav.highlightBorderB, [])
	}
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

	// BUG: Statements include semicolon, structs do not

	const documentSymbols = await cacheDocumentSymbols(textEditor)
	if (!documentSymbols?.rootSymbols.length)
		return

	documentSymbols.highlightRanges.length = 0

	const newSelections: vscode.Selection[] = []
	for (const selection of textEditor.selections)
	{
		const position = selection.start
		const rootSymbols = documentSymbols.rootSymbols

		const nearest: NearestSymbols = {}
		findParentAndCurrent(rootSymbols, position, nearest)

		const children = nearest.current?.children ?? []
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

		let newSymbol: vscode.DocumentSymbol | undefined
		switch (direction)
		{
			case HierarchyDirection.Prev:
				newSymbol = nearest.previous
				documentSymbols.lastChildren.length = 0
				break

			case HierarchyDirection.Next:
				newSymbol = nearest.next
				documentSymbols.lastChildren.length = 0
				break

			case HierarchyDirection.Parent:
				newSymbol = nearest.parent
				const lastChild = nearest.current ?? nearest.next ?? nearest.previous
				if (nearest.parent && lastChild)
					documentSymbols.lastChildren.push(lastChild)
				break

			case HierarchyDirection.Child:
				newSymbol = documentSymbols.lastChildren.pop() ?? nearest.child
				break
		}

		newSymbol = newSymbol ?? nearest.current
		if (newSymbol)
		{
			const newSelection = select
				? new vscode.Selection(newSymbol.range.end, newSymbol.range.start)
				: new vscode.Selection(newSymbol.range.start, newSymbol.range.start)

			documentSymbols.highlightRanges.push(newSymbol.range)
			newSelections.push(newSelection)
		}
		else
		{
			newSelections.push(selection)
		}
	}

	documentSymbols.lastSelections = newSelections
	textEditor.selections = newSelections
	textEditor.revealRange(newSelections[0], vscode.TextEditorRevealType.InCenter)

	// NOTE: It's possible for selection to not actually change, but want still want to trigger
	// highlighting. This happens when navigating to the previous symbol while at the beginning of
	// the first symbol already, for example. Since our event is tied to a selection change event and
	// the event won't trigger and we need to apply the highlighting directly. Highlights always
	// overwrite previous instances so applying twice isn't an issue.
	updateSymbolHighlights(textEditor)
}
