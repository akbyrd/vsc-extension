import * as vscode from "vscode"
import * as ts from "web-tree-sitter"

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
		if (/\/\*/.test(text))              return BlockType.BlockComment
		if (/^\s*\*/.test(text))            return BlockType.BlockComment
		if (/\S/.test(text))                return BlockType.Prose
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
			if (type === undefined)       { lineNum++; continue }

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
					if (prev.isEmptyOrWhitespace)                                           break
					if (type === BlockType.LineComment && classifyLine(prev.text) !== type) break
					startLine--
				}

				// Walk forwards to find end of run
				while (endLine < document.lineCount - 1)
				{
					const next = document.lineAt(endLine + 1)
					if (next.isEmptyOrWhitespace)                                           break
					if (type === BlockType.LineComment && classifyLine(next.text) !== type) break
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

	type StringView = {
		str   : string,
		begin : number,
		end   : number,
	}

	function consumeStart(v: StringView, p: RegExp|string): StringView
	{
		assert(v.begin >= 0)
		assert(v.end <= v.str.length)

		const begin = v.begin

		if (p instanceof RegExp)
		{
			for (; v.begin < v.end; v.begin++)
			{
				if (!v.str[v.begin].match(p))
					break
			}
		}
		else
		{
			if (v.str.startsWith(p, v.begin))
				v.begin += p.length
		}

		return { str: v.str, begin, end: v.begin }
	}

	function consumeEnd(v: StringView, p: RegExp|string): StringView
	{
		assert(v.begin >= 0)
		assert(v.end <= v.str.length)

		const end = v.end

		if (p instanceof RegExp)
		{
			for (; v.end > 0; v.end--)
			{
				if (!v.str[v.end - 1].match(p))
					break
			}
		}
		else
		{
			if (v.end > 0 && v.str.endsWith(p, v.end - 1))
				v.end -= p.length
		}

		return { str: v.str, begin: v.end, end }
	}

	// TODO: Round to a multiple of tebWidth
	// TODO: Handle mixed indentation
	function consumeIndent(v: StringView, maxSpaces: number) : number
	{
		assert(v.begin >= 0)
		assert(v.end <= v.str.length)

		var spaces = 0
		var stop   = false

		for (; v.begin < v.end && !stop; v.begin++)
		{
			const char = v.str[v.begin]
			switch (char)
			{
				default: stop = true; break
				case ' ': spaces += 1; break
				case '\t': spaces += tabSize; break
			}

			stop ||= spaces >= maxSpaces
		}

		return spaces
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
				//symbolNav.statusBarMessage?.dispose()
				//symbolNav.statusBarMessage = vscode.window.setStatusBarMessage(`Failed to parse: ${String(e)}`, 3000)
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

	// TODO: Actually split blocks
	// TODO: Figure out how to handle code in markdown / other embedded languages
	// TODO: Ignore embedded single line comments
	// TODO: Make it unit testable
	// TODO: Convert block comment style (block or line)
	// TODO: first line, trailing - if single line, ignore
	// TODO: first line, embedded - prune before this

	// Wrap blocks
	{
		// NOTE: Indentation and line prefixes are normalized. This means:
		// * Converted to tabs or spaces based on editor settings
		// * Rounded down to the nearest tab stop based on editor settings
		// * Line prefixes updated to canonical form based on language settings

		// NOTE: Edits may not overlap. For example, you cannot remove a newline character and place a
		// new one at the same location. This means we can't use a naive approach that unwraps the
		// block and then re-wraps it.

		const trimmedBlockPrefixes = []
		for (const prefix of languageData.blockComment)
			trimmedBlockPrefixes.push(prefix.trimStart())

		for (const block of blocks)
		{
			assert(block.prefix)
			assert(block.indent)

			switch (block.type)
			{
				case BlockType.blockComment:
				case BlockType.lineComment:
				{
					const trimmedPrefixes = block.type == BlockType.blockComment ? trimmedBlockPrefixes : block.prefix
					var maxSpaces = Number.POSITIVE_INFINITY

					const lines : string[] = []
					for (var iLine = block.range.start.line; iLine <= block.range.end.line; iLine++)
					{
						const line : vscode.TextLine = textEditor.document.lineAt(iLine)

						const isFirstLine   = iLine == block.range.start.line
						const isLastLine    = iLine == block.range.end.line
						const isContLine    = !isFirstLine && !isLastLine
						const trimmedPrefix = trimmedPrefixes[isFirstLine ? 0 : 1]

						const rLine    = block.range.intersection(line.range)!
						const vIndent  = { str: line.text, begin: 0, end: line.firstNonWhitespaceCharacterIndex }
						const spaces   = consumeIndent(vIndent, maxSpaces)
						const vContent = { str: line.text, begin: Math.max(vIndent.end, rLine.start.character), end: rLine.end.character }
						const vPrefix  = consumeStart(vContent, trimmedPrefix) // Expected prefix
						const vCustom  = consumeStart(vContent, /[^\w\s]/)     // Custom prefix
						const vSpace   = consumeStart(vContent, /\s/)          // Whitespace

						if (isFirstLine)
						{
							maxSpaces       = spaces
							block.prefix[0] = line.text.substring(vPrefix.begin, vCustom.end)
						}
						else if (isContLine)
						{
							block.prefix[1] = line.text.substring(vPrefix.begin, vCustom.end)
						}

						if (isLastLine && block.type == BlockType.blockComment)
						{
							const vSuffix = consumeEnd(vContent, trimmedPrefixes[2]) // Expected suffix
							const vCustom = consumeEnd(vContent, /[^\w\s]/)          // Custom suffix
							const vSpace  = consumeEnd(vContent, /\s/)               // Whitespace

							block.prefix[2] = line.text.substring(vCustom.begin, vSuffix.end)
						}

						if (vContent.end > vContent.begin)
						{
							const lineContent = line.text.substring(vContent.begin, vContent.end)
							lines.push(`${lineContent}`)
						}
					}

					const blockText = lines.join(' ')
					console.log(`block text: "${blockText}"`)
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
