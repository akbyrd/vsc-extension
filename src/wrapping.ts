import * as ts from "web-tree-sitter"

export class Position
{
	constructor(
		public line      : number = 0,
		public character : number = 0,
	) {}

	isAfter(x: Position): boolean
	{
		return this.compareTo(x) > 0
	}

	compareTo(x: Position): number
	{
		const lineCompare = +(this.line > x.line) - +(this.line < x.line)
		const charCompare = +(this.character > x.character) - +(this.character < x.character)
		return lineCompare ? lineCompare : charCompare
	}
}

export class Range
{
	constructor(
		public start : Position = new Position(),
		public end   : Position = new Position(),
	) {}

	intersection(x: Range): Range | undefined
	{
		return new Range(
			this.start.isAfter(x.start) ? this.start : x.start,
			this.end  .isAfter(x.end)   ? x.end      : this.end,
		)
	}
}

export type TextLine = {
	range : Range,
	text  : string,
}

type StringView = {
	str   : string,
	begin : number,
	end   : number,
}

export type Context = {
	tabSize    : number,
	useSpaces  : boolean,
	lineWidth  : number,
	languageId : string,
	selections : readonly Range[],
	getText    : () => string,
	getLine    : (i: number) => TextLine,
	onError    : (s: string) => void,
}

type PrefixSet = [string, string, string]

type LanguageData = {
	grammar      : string,
	lineComment  : string,
	blockComment : PrefixSet,

	// TODO: Bad names
	lineCommentSet?      : PrefixSet,
	trimmedBlockComment? : PrefixSet,
}

type Parse = {
	parser: ts.Parser,
	tree:   ts.Tree,
}

enum BlockType
{
	null,
	lineComment,
	blockComment,
	prose,
}

type Block = {
	type            : BlockType,
	range           : Range,
	languageId      : string,
	prefixes        : PrefixSet,
	trimmedPrefixes : PrefixSet,
	customPrefixes  : PrefixSet,

	text            : string,
	indent          : number,
}

function toPosition(p: ts.Point): Position
{
	const line      = p.row
	const character = p.column
	return new Position(line, character)
}

function toRange(n: ts.Node): Range
{
	const start = toPosition(n.startPosition)
	const end   = toPosition(n.endPosition)
	return new Range(start, end)
}

function toPoint(p: Position): ts.Point
{
	return { row: p.line, column: p.character }
}

function consumeIndent(v: StringView, tabSize: number, maxSpaces: number): number
{
	assert(v.begin >= 0)
	assert(v.begin <= v.end)
	assert(v.end <= v.str.length)

	var spaces = 0

	for (; v.begin < v.end && spaces < maxSpaces; ++v.begin)
	{
		const char = v.str[v.begin]

		     if (char == ' ')  spaces += 1
		else if (char == '\t') spaces += tabSize
		else break
	}

	return spaces
}

function consumeStart(v: StringView, p: RegExp|string): StringView
{
	assert(v.begin >= 0)
	assert(v.begin <= v.end)
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
	assert(v.begin <= v.end)
	assert(v.end <= v.str.length)

	const end = v.end

	if (p instanceof RegExp)
	{
		for (; v.end > v.begin; v.end--)
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

function expandEnd(v: StringView, p: RegExp|string): StringView
{
	assert(v.begin >= 0)
	assert(v.begin <= v.end)
	assert(v.end <= v.str.length)

	const end = v.end

	if (p instanceof RegExp)
	{
		for (; v.end < v.str.length; v.end++)
		{
			if (!v.str[v.end].match(p))
				break
		}
	}
	else
	{
		if (v.end < v.str.length && v.str.endsWith(p, v.end))
			v.end += p.length
	}

	return { str: v.str, begin: end, end: v.end }
}

function assert(value: unknown): asserts value
{
	console.assert(value)
}

async function parseDocument(ctx: Context): Promise<Parse|undefined>
{
	const languageData = languages[ctx.languageId]
	if (languageData)
	{
		try
		{
			await ts.Parser.init()
			const response : Response    = await fetch(languageData.grammar)
			const wasm     : ArrayBuffer = await response.arrayBuffer()
			const language : ts.Language = await ts.Language.load(new Uint8Array(wasm))
			const parser   : ts.Parser   = new ts.Parser().setLanguage(language)
			const text     : string      = ctx.getText()
			const tree     : ts.Tree     = parser.parse(text)!
			console.assert(tree)

			return { parser, tree }
		}
		catch (e)
		{
			ctx.onError(`Failed to parse: ${String(e)}`)
		}
	}

	return undefined
}

function cachePrefixes(languageData: LanguageData)
{
	if (!languageData.trimmedBlockComment)
	{
		const bc = languageData.blockComment.map(s => s.trimStart()) as PrefixSet
		languageData.trimmedBlockComment = bc
	}

	if (!languageData.lineCommentSet)
	{
		const lc = languageData.lineComment
		languageData.lineCommentSet = [lc, lc, ""]
	}
}

function gatherBlocks(ctx: Context, parse: Parse|undefined): Block[]
{
	const blocks : Block[] = []

	if (parse)
	{
		const languageData = languages[ctx.languageId]

		cachePrefixes(languageData)
		assert(languageData.lineCommentSet)
		assert(languageData.trimmedBlockComment)

		const sortedSelections = ctx.selections.slice()
		sortedSelections.sort((a, b) => a.start.compareTo(b.start))

		for (const selection of sortedSelections)
		{
			// NOTE: tree sitter doesn't consider adjacent matches (they must physically overlap) so
			// we grow selections by 1 character in both directions, without flowing onto adjacent
			// lines. Neither vscode nor tree sitter appear to have a problem with column positions
			// that go past the end of the line. But vscode throws for positions before the
			// beginning of the line (i.e. negative values).

			const start : Position = new Position(selection.start.line, Math.max(selection.start.character - 1, 0))
			const end   : Position = new Position(selection.end.line,   selection.end.character + 1)

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
						const isTrailing = node?.startPosition.row == node?.previousSibling?.endPosition.row
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
						const isTrailing = endNode.startPosition.row == endNode.previousSibling?.endPosition.row
						if (isComment && isLine && isAdjacent && !isTrailing)
						{
							endNode = node
							continue
						}
						break
					}

					const start      = toPosition(startNode.startPosition)
					const end        = toPosition(endNode.endPosition)
					const prevEnd    = startNode.previousSibling?.endPosition
					const isTrailing = prevEnd?.row == start.line
					start.character  = isTrailing ? prevEnd.column : 0

					blocks.push({
						type:            BlockType.lineComment,
						range:           new Range(start, end),
						languageId:      ctx.languageId,
						prefixes:        languageData.lineCommentSet,
						trimmedPrefixes: languageData.lineCommentSet,
						customPrefixes:  languageData.lineCommentSet,
						text:            "",
						indent:          0,
					});
				}
				else
				{
					blocks.push({
						type:            BlockType.blockComment,
						range:           toRange(capture.node),
						languageId:      ctx.languageId,
						prefixes:        languageData.blockComment,
						trimmedPrefixes: languageData.trimmedBlockComment,
						customPrefixes:  languageData.blockComment,
						text:            "",
						indent:          0,
					});
				}
			}
		}
	}
	else if (ctx.languageId == "plaintext")
	{
		for (const selection of ctx.selections)
		{
			blocks.push({
				type:            BlockType.prose,
				range:           selection,
				languageId:      ctx.languageId,
				prefixes:        ["", "", ""],
				trimmedPrefixes: ["", "", ""],
				customPrefixes:  ["", "", ""],
				text:            "",
				indent:          0,
			});
		}
	}

	return blocks
}

function unwrapBlocks(ctx: Context, blocks: Block[])
{
	// NOTE: Indentation and line prefixes are normalized. This means:
	// * Converted to tabs or spaces based on editor settings
	// * Rounded down to the nearest tab stop based on editor settings
	// * Line prefixes updated to canonical form based on language settings

	// NOTE: Edits may not overlap. For example, you cannot remove a newline character and place a
	// new one at the same location. This means we can't use a naive approach that unwraps the
	// block and then re-wraps it.

	for (const block of blocks)
	{
		const languageData = languages[block.languageId]
		assert(languageData.trimmedBlockComment)
		assert(languageData.lineCommentSet)

		switch (block.type)
		{
			case BlockType.blockComment:
			case BlockType.lineComment:
			{
				var maxIndent = Number.POSITIVE_INFINITY

				const lines : string[] = []
				for (var iLine = block.range.start.line; iLine <= block.range.end.line; iLine++)
				{
					const line : TextLine = ctx.getLine(iLine)

					const isFirstLine   = iLine == block.range.start.line
					const isLastLine    = iLine == block.range.end.line
					const isSecondLine  = iLine == block.range.start.line + 1 && !isLastLine
					const iPrefix       = isFirstLine ? 0 : 1
					const trimmedPrefix = block.trimmedPrefixes[iPrefix]
					const trimmedSuffix = block.trimmedPrefixes[2]

					const rLine    = block.range.intersection(line.range)!
					const vContent = { str: line.text, begin: rLine.start.character, end: rLine.end.character }
					const indent   = consumeIndent(vContent, ctx.tabSize, maxIndent)
					const vPrefix  = consumeStart(vContent, trimmedPrefix) // Expected prefix
					const vCustom  = consumeStart(vContent, /[^\w\s]/)     // Custom prefix
					const vSpace   = consumeStart(vContent, /\s/)          // Whitespace

					if (isFirstLine)
						maxIndent = indent

					if (block.type == BlockType.lineComment)
					{
						if (isFirstLine)
						{
							const prefix = line.text.substring(vPrefix.begin, vCustom.end)
							block.customPrefixes[0] = prefix
							block.customPrefixes[1] = prefix
							block.customPrefixes[2] = prefix
						}
					}
					else if (block.type == BlockType.blockComment)
					{
						if (isFirstLine || isSecondLine)
						{
							const prefix = line.text.substring(vPrefix.begin, vCustom.end)
							block.customPrefixes[iPrefix] = prefix
						}
						else if (isLastLine)
						{
							const vSuffix = consumeEnd(vContent, trimmedSuffix) // Expected suffix
							const vCustom = consumeEnd(vContent, /[^\w\s]/)     // Custom suffix

							const suffix = line.text.substring(vCustom.begin, vSuffix.end)
							block.customPrefixes[2] = suffix
						}
					}

					if (vContent.end > vContent.begin)
					{
						const vSpace2 = consumeEnd(vContent, /\s/) // Whitespace

						const lineContent = line.text.substring(vContent.begin, vContent.end)
						lines.push(`${lineContent}`)
					}
				}

				block.text   = lines.join(' ')
				block.indent = maxIndent
				break
			}

			case BlockType.prose:
				break
		}
	}
}

function wrapBlocks(ctx: Context, blocks: Block[]): string[]
{
	// NOTE: This intentionally does not handle tabs aside from indentation. It's not worth the
	// complexity to scan for them.

	const results : string[] = []
	for (const block of blocks)
	{
		const tabs   = Math.floor(block.indent / ctx.tabSize)
		const spaces = tabs * ctx.tabSize
		const indent = ctx.useSpaces ? " ".repeat(spaces) : "\t".repeat(tabs)

		const lines : string[] = []

		// TODO: Unify implementations once all are complete
		// TODO: lineWidth does not respect indentation

		function wrap_line_trailing()
		{
			const doesFit       = block.text.length - block.range.start.character < ctx.lineWidth
			const isSingleToken = !block.text.match(/^\s*[^\s]+\s+[^\s]/)

			if (doesFit || isSingleToken)
			{
				var prefix = block.customPrefixes[0]
				const content = block.text
				const line = ` ${prefix} ${content}`
				lines.push(line)
			}
			else
			{
				lines.push("")
				wrap_isolated()
			}
		}

		function wrap_isolated()
		{
			var prefix = block.customPrefixes[0]

			const v = { str: block.text, begin: 0, end: block.text.length }
			for (; v.begin < v.end; v.begin = v.end, v.end = block.text.length)
			{
				v.end = v.begin + ctx.lineWidth - prefix.length + 1
				v.end = Math.max(v.end, v.begin)
				v.end = Math.min(v.end, block.text.length)

				consumeStart(v, /\s/)      // Whitespace
				if (v.end != block.text.length)
					consumeEnd(v, /[^\s]/) // Partial word
				consumeEnd(v, /\s/)       // Whitespace

				// Force progress - at least one word, even if it doesn't fit
				if (v.begin == v.end)
				{
					expandEnd(v, /\s/)    // Whitespace
					v.begin = v.end
					expandEnd(v, /[^\s]/) // Word
				}

				const content = block.text.slice(v.begin, v.end)
				const line = `${indent}${prefix} ${content}`
				lines.push(line)

				prefix = block.customPrefixes[1]
			}

			if (block.type == BlockType.blockComment)
			{
				const suffix = block.customPrefixes[2]
				const line = `${indent}${suffix}`
				lines.push(line)
			}
		}

		const isTrailing = block.range.start.character != 0
		isTrailing
			? wrap_line_trailing()
			: wrap_isolated()

		const result = lines.join('\n')
		results.push(result)
	}
	return results
}

export async function wrap_text(ctx: Context): Promise<string[]>
{
	console.assert(ctx.tabSize > 0)
	console.assert(ctx.lineWidth >= 0)

	const parse   = await parseDocument(ctx)
	const blocks  = gatherBlocks(ctx, parse)
	const _       = unwrapBlocks(ctx, blocks)
	const wrapped = wrapBlocks(ctx, blocks)
	return wrapped
}

// TODO: lua, powershell, toml, yaml, xml, markdown
const languages: Record<string, LanguageData> = {
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

// TODO: Consider tokenizing
// Pro: Probably a lot simpler
// Pro: Don't need to unwrap
// Pro: Will normalize more whitespace
// Con: We'll tokenize more than necessary (compared to doing it lazy at the end of each line)
// Con: We'll probably do a lot more string concatenation (maybe we handle consecutive tokens without splitting and concatenating?)
//
// Can we get tokens from tree sitter? (looks like no)
// Per-line regex

// TODO: Cache parser
// TODO: Cache fetch results
// TODO: Cache language results
// TODO: Cache parse results
// TODO: Cache query results
// TODO: Share statusBarMessage
// TODO: Handle mixed indentation
// TODO: Actually split blocks
// TODO: Ignore embedded single line comments
// TODO: Apply edits in vscode
// TODO: Better exporting from this file
// ----
// TODO: Handle overlapping queries (due to character expand)
// TODO: Improve plaintext support
// TODO: Figure out how to handle code in markdown / other embedded languages

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
