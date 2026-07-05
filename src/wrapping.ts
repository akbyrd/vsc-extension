import * as ts from "web-tree-sitter"

class Cache
{
	db = {
		prefixes: new Set<PrefixSet>(),
		fetch:    new Map<string, Uint8Array>(),
	}

	async fetch(url: string, storage: Storage): Promise<Uint8Array>
	{

		// Check the memory cache first
		const memCached = this.db.fetch.get(url)
		if (memCached) return memCached

		// Check the disk cache second
		const url_ = new URL(url)
		const key = url_.pathname.slice(url_.pathname.lastIndexOf("/") + 1)
		const diskCached = await storage.read(key)
		if (diskCached)
		{
			this.db.fetch.set(url, diskCached)
			return diskCached
		}

		// TODO: Should this have a try/catch?

		// Download if not cached
		const response = await fetch(url)
		const bytes    = await response.bytes()

		// Cache the result in memory and on disk
		await storage.write(key, bytes)
		this.db.fetch.set(url, bytes)
		return bytes
	}
}

export type Storage = {
	read  : (key: string) => Promise<Uint8Array | undefined>,
	write : (key: string, data: Uint8Array) => Promise<void>,
}

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

export type Context = {
	tabWidth   : number,
	useSpaces  : boolean,
	lineWidth  : number,
	languageId : string,
	selections : readonly Range[],
	getText    : () => string,
	getLine    : (i: number) => TextLine,
	onError    : (s: string) => void,
	storage    : Storage,
}

type Prefix = {
	chars : string,
	align : number,
}

type PrefixSet = [Prefix, Prefix, Prefix]

function makePrefixSet(s0: string, s1?: string, s2?: string): PrefixSet
{
	return [
		{ chars: s0 ?? "", align: 0 },
		{ chars: s1 ?? s0, align: 0 },
		{ chars: s2 ?? "", align: 0 },
	]
}

type LanguageData = {
	grammar      : string,
	lineComment  : PrefixSet,
	blockComment : PrefixSet,
}

type Parse = {
	parser: ts.Parser,
	tree:   ts.Tree,
}

type Token = {
	begin: number,
	end:   number,
}

enum BlockType
{
	null,
	lineComment,
	blockComment,
	prose,
}

enum LineType
{
	null,
	normal,
	skip,
	blank,
	bullet,
}

type LineInfo = {
	text        : string,
	type        : LineType,
	tokenBegin  : number,
	tokenEnd    : number,
	indent      : Token,
	prefix      : Token,
	align       : Token,
	bullet      : Token,
	suffix      : Token,
	indentWidth : number, // TODO: Move to block
	alignWidth  : number,
	runLength   : number,
	isDoxygen   : boolean,
}

type Block = {
	type       : BlockType,
	range      : Range,
	languageId : string
	isLeading  : boolean,
	isTrailing : boolean,
	lineInfos  : LineInfo[],
	prefixes   : PrefixSet,
	tokens     : Token[],
}

function toPosition(p: ts.Point): Position
{
	return new Position(p.row, p.column)
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

function consumeIndent(s: string, begin: number, width: number, tabSize: number): number
{
	const prevWidth = width

	for (; begin < s.length; ++begin)
	{
		const char = s[begin]

		     if (char === ' ')  width += 1
		else if (char === '\t') width = Math.floor((width + tabSize) / tabSize) * tabSize
		else break
	}

	const spaces = width - prevWidth
	return spaces
}

async function parseDocument(ctx: Context): Promise<Parse|undefined>
{
	const languageData = languages[ctx.languageId]
	if (languageData)
	{
		try
		{
			await ts.Parser.init()
			const wasm     : Uint8Array  = await cache.fetch(languageData.grammar, ctx.storage)
			const language : ts.Language = await ts.Language.load(wasm)
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

function cachePrefixes(p: PrefixSet)
{
	if (cache.db.prefixes.has(p)) return
	cache.db.prefixes.add(p)

	const space = " ".charCodeAt(0)
	while (p[1].align < p[1].chars.length && p[1].chars.charCodeAt(p[1].align) === space) p[1].align++
	while (p[2].align < p[2].chars.length && p[2].chars.charCodeAt(p[2].align) === space) p[2].align++
	p[1].chars = p[1].chars.slice(p[1].align, p[1].chars.length)
	p[2].chars = p[2].chars.slice(p[2].align, p[2].chars.length)
}

function gatherBlocks(ctx: Context, parse: Parse|undefined): Block[]
{
	const blocks : Block[] = []

	if (parse)
	{
		const languageData = languages[ctx.languageId]
		cachePrefixes(languageData.lineComment)
		cachePrefixes(languageData.blockComment)

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
				const lineComment : string  = languageData.lineComment[0].chars
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
						const isComment  = node?.type === "comment"
						const isLine     = node?.text.startsWith(lineComment)
						const isAdjacent = node?.startPosition.row === startNode.startPosition.row - 1
						const isTrailing = node?.startPosition.row === node?.previousSibling?.endPosition.row
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
						const isComment  = node?.type === "comment"
						const isLine     = node?.text.startsWith(lineComment)
						const isAdjacent = node?.startPosition.row === endNode.startPosition.row + 1
						const isTrailing = endNode.startPosition.row === endNode.previousSibling?.endPosition.row
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
					const isTrailing = prevEnd?.row === start.line
					start.character  = isTrailing ? prevEnd.column : 0

					blocks.push({
						type:       BlockType.lineComment,
						range:      new Range(start, end),
						languageId: ctx.languageId,
						isLeading:  false,
						isTrailing: isTrailing,
						lineInfos:  [],
						prefixes:   structuredClone(languageData.lineComment),
						tokens:     [],
					})
				}
				else
				{
					const node       = capture.node
					const isTrailing = node.startPosition.row === node.previousSibling?.endPosition.row
					const isLeading  = node.endPosition.row === node.nextSibling?.startPosition.row

					blocks.push({
						type:       BlockType.blockComment,
						range:      toRange(capture.node),
						languageId: ctx.languageId,
						isLeading:  isLeading,
						isTrailing: isTrailing,
						lineInfos:  [],
						prefixes:   structuredClone(languageData.blockComment),
						tokens:     [],
					})
				}
			}
		}
	}
	else if (ctx.languageId === "plaintext")
	{
		for (const selection of ctx.selections)
		{
			blocks.push({
				type:       BlockType.prose,
				range:      selection,
				languageId: ctx.languageId,
				isLeading:  false,
				isTrailing: false,
				lineInfos:  [],
				prefixes:   makePrefixSet(""),
				tokens:     [],
			})
		}
	}

	return blocks
}

function tokenizeBlock(ctx: Context, block: Block)
{
	const indentRe  = /\s*/y
	const prefixRe  = /[^\w\s@\\]+/g
	const doxygenRe = /(?!(?:endlink|anchor|link|cite|ref|em|[abcenp])\b|f\$|\W)\S+/y
	const bulletRe  = /[\*-]|\d+[\)\.]/y
	const tokenRe   = /\S+/g
	const suffixRe  = /[^\w\s]+/g
	const doxygenLeaders = [ "@".charCodeAt(0), "\\".charCodeAt(0) ]

	switch (block.type)
	{
		case BlockType.blockComment:
		case BlockType.lineComment:
		{
			// TODO: Refer to previous node when trailing line comment
			// OPTIMIZE: Could use char codes to avoid regex and temporary strings

			for (var iLine = block.range.start.line; iLine <= block.range.end.line; iLine++)
			{
				const line  : TextLine = ctx.getLine(iLine)
				const rLine : Range    = block.range.intersection(line.range)!

				block.lineInfos.push({
					text:        line.text,
					type:        LineType.normal,
					tokenBegin:  block.tokens.length,
					tokenEnd:    block.tokens.length,
					indent:      { begin: 0, end: 0 },
					prefix:      { begin: 0, end: 0 },
					align:       { begin: 0, end: 0 },
					bullet:      { begin: 0, end: 0 },
					suffix:      { begin: 0, end: 0 },
					indentWidth: 0,
					alignWidth:  0,
					runLength:   0,
					isDoxygen:   false,
				})
				const lineInfo = block.lineInfos.at(-1)!

				var match : RegExpExecArray | null
				var iChar = 0

				// Indentation
				indentRe.lastIndex = iChar
				match = indentRe.exec(line.text)
				{
					iChar = Math.max(indentRe.lastIndex, rLine.start.character)
					lineInfo.indent = {
						begin: match!.index,
						end:   indentRe.lastIndex,
					}
				}

				// TODO: This is wrong because it looks for non-word characters
				// Breaks for lines starting with: digit, period, any symbol not meant to be a prefix
				// We might want to get the first token, then analyze it
				// Only look for expected prefix + custom?

				// Prefix (split when attached to first token)
				prefixRe.lastIndex = iChar
				if ((match = prefixRe.exec(line.text)) && match.index < rLine.end.character)
				{
					iChar = prefixRe.lastIndex
					lineInfo.prefix = {
						begin: match.index,
						end:   prefixRe.lastIndex,
					}
				}

				// TODO: Split indentation and align when there's no prefix
				// TODO: Maybe this should be in analyzeBlock?

				// Align
				indentRe.lastIndex = iChar
				if ((match = indentRe.exec(line.text)) && match.index < rLine.end.character)
				{
					iChar = indentRe.lastIndex
					lineInfo.align = {
						begin: match.index,
						end:   indentRe.lastIndex,
					}
				}

				// Doxygen command (split when attached to first token)
				const nextChar = line.text.charCodeAt(iChar)
				if (doxygenLeaders.includes(nextChar))
				{
					doxygenRe.lastIndex = iChar + 1
					if ((match = doxygenRe.exec(line.text)) && match.index < rLine.end.character)
					{
						iChar = doxygenRe.lastIndex
						lineInfo.isDoxygen = true
						lineInfo.type = LineType.bullet
						lineInfo.bullet = {
							begin: match.index - 1,
							end:   doxygenRe.lastIndex,
						}
					}
				}

				// Bullet (split when attached to first token)
				if (lineInfo.type !== LineType.bullet)
				{
					bulletRe.lastIndex = iChar
					if ((match = bulletRe.exec(line.text)) && match.index < rLine.end.character)
					{
						iChar = bulletRe.lastIndex
						lineInfo.type = LineType.bullet
						lineInfo.bullet = {
							begin: match.index,
							end:   bulletRe.lastIndex,
						}
					}
				}

				// Regular token
				tokenRe.lastIndex = iChar
				while ((match = tokenRe.exec(line.text)) && match.index < rLine.end.character)
				{
					lineInfo.tokenEnd++
					block.tokens.push({
						begin: match.index,
						end:   tokenRe.lastIndex,
					})
				}
			}

			// Suffix (split when attached to last token)
			if (block.type === BlockType.blockComment)
			{
				// TODO: Attempt to simplify this
				const lineInfo = block.lineInfos.at(-1)!
				const useToken = lineInfo.tokenEnd > lineInfo.tokenBegin
				const token    = useToken ? block.tokens.at(-1)! : lineInfo.prefix

				// NOTE: This should always match
				suffixRe.lastIndex = token.begin
				const match = suffixRe.exec(lineInfo.text)
				if (match)
				{
					const suffixLen = match[0].length
					token.end -= suffixLen
					if (useToken && token.end === token.begin)
					{
						lineInfo.tokenEnd--
						block.tokens.pop()
					}

					lineInfo!.suffix = {
						begin: match.index,
						end:   match.index + suffixLen,
					}
				}
			}
			break
		}

		case BlockType.prose:
			break
	}
}

function analyzeBlock(ctx: Context, block: Block)
{
	// Detect indentation
	{
		if (!block.isTrailing)
		{
			const lineInfo = block.lineInfos[0]
			lineInfo.indentWidth = consumeIndent(lineInfo.text, 0, 0, ctx.tabWidth)
			lineInfo.indentWidth = Math.floor(lineInfo.indentWidth / ctx.tabWidth) * ctx.tabWidth
		}
	}

	// Detect blank lines
	{
		// NOTE: If a line is both a bullet and blank, blank wins
		// NOTE: Doxygen lines are never considered blank

		for (const lineInfo of block.lineInfos)
		{
			if (lineInfo.isDoxygen)
				continue

			const isBlank = lineInfo.tokenBegin === lineInfo.tokenEnd
			lineInfo.type = isBlank ? LineType.blank : lineInfo.type
		}

		for (var i = 0; i < block.lineInfos.length; i++)
		{
			const lineInfo = block.lineInfos[i]
			if (lineInfo.type !== LineType.blank) break
			lineInfo.type = LineType.skip
		}

		for (var i = block.lineInfos.length - 1; i >= 0; i--)
		{
			const lineInfo = block.lineInfos[i]
			if (lineInfo.type !== LineType.blank) break
			lineInfo.type = LineType.skip
		}
	}

	// Detect alignment and bullet continuation
	{
		for (var i = 0; i < block.lineInfos.length; i++)
		{
			const lineInfo = block.lineInfos[i]

			if (lineInfo.type !== LineType.bullet)
				continue

			const token     = lineInfo.prefix
			const hasPrefix = token.end > token.begin

			if (hasPrefix)
			{
				const width = lineInfo.indentWidth + (lineInfo.prefix.end - lineInfo.prefix.begin)
				const begin = lineInfo.prefix.end
				const align = consumeIndent(lineInfo.text, begin, width, ctx.tabWidth)
				lineInfo.alignWidth = Math.max(1, align)
			}
			else
			{
				const offset = lineInfo.indentWidth
				const align  = consumeIndent(lineInfo.text, 0, 0, ctx.tabWidth)
				lineInfo.alignWidth = Math.max(1, align - offset)
			}

			for (; i < block.lineInfos.length - 1; i++)
			{
				const lineInfo = block.lineInfos[i + 1]

				if (lineInfo .type === LineType.blank || lineInfo.type === LineType.bullet)
					break

				lineInfo.type = LineType.bullet
			}
		}
	}

	// Detect custom prefix/suffix
	switch (block.type)
	{
		case BlockType.lineComment:
		{
			const lineInfo = block.lineInfos[0]
			const token    = lineInfo.prefix
			const prefix   = lineInfo.text.slice(token.begin, token.end)
			block.prefixes[0].chars = prefix
			block.prefixes[1].chars = prefix
			break
		}

		case BlockType.blockComment:
		{
			// First line
			{
				const lineInfo = block.lineInfos[0]
				const token    = lineInfo.prefix
				const prefix   = lineInfo.text.slice(token.begin, token.end)
				block.prefixes[0].chars = prefix
			}

			// Second line
			if (block.lineInfos.length > 1)
			{
				const lineInfo = block.lineInfos[1]
				const token    = lineInfo.prefix
				if (token.end > token.begin)
				{
					const prefix = lineInfo.text.slice(token.begin, token.end)
					block.prefixes[1].chars = prefix
				}
			}

			// Last line
			{
				const lineInfo = block.lineInfos.at(-1)!
				const token    = lineInfo.suffix
				const suffix   = lineInfo.text.slice(token.begin, token.end)
				block.prefixes[2].chars = suffix
			}
			break
		}
	}

	// Calculate run length
	{
		var runLength = 0
		var lastType = LineType.null
		for (const lineInfo of block.lineInfos)
		{
			const isBulletContinuation = lineInfo.bullet.end > lineInfo.bullet.begin
			if (lineInfo.type !== lastType || isBulletContinuation)
			{
				runLength = 0
				lastType = lineInfo.type
			}
			lineInfo.runLength = runLength++
		}
	}
}

function wrapBlock(ctx: Context, block: Block): string
{
	// NOTE: Whitespace and line prefixes are normalized. This means:
	// * Converted to tabs or spaces based on editor settings
	// * Rounded down to a multiple of stab size based on editor settings
	// * Line prefixes normalized to match the first prefix
	// * Line prefixes added to continuation lines of block comments
	// * Whitespace between content tokens is replaced with a single space

	// NOTE: Line layout
	// First line    - <indent><prefixAlign><prefix><contentAlign><bullet><content>
	// Continue line - <indent><prefixAlign><prefix><contentAlign><bulletAlign><content>

	const lines : string[] = []

	const lineWidth   = block.isLeading || block.isTrailing ? Number.POSITIVE_INFINITY : ctx.lineWidth
	const indentWidth = block.lineInfos[0].indentWidth
	const indent      = ctx.useSpaces ? " ".repeat(indentWidth) : "\t".repeat(indentWidth / ctx.tabWidth)
	const p1          = block.prefixes[1]
	const prefix      = " ".repeat(p1.align) + p1.chars
	const leader      = `${indent}${prefix}`

	var flushCount = 0
	var bullet     = ""
	var content    = ""

	function flush()
	{
		if (flushCount++ !== 0)
		{
			lines.push(`${leader}${bullet}${content}`)
			content = ""
		}
	}

	for (const lineInfo of block.lineInfos)
	{
		if (lineInfo.type === LineType.skip)
			continue

		if (lineInfo.runLength === 0)
		{
			flush()
			const contentAlign = " ".repeat(lineInfo.alignWidth)
			const bulletToken  = lineInfo.text.slice(lineInfo.bullet.begin, lineInfo.bullet.end)
			bullet = `${contentAlign}${bulletToken}`
		}

		for (var i = lineInfo.tokenBegin; i < lineInfo.tokenEnd; i++)
		{
			const token    = block.tokens[i]
			const tokenLen = token.end - token.begin
			const doesFit  = leader.length + content.length + tokenLen + 1 <= lineWidth
			const overflow = content.length && !doesFit

			if (overflow)
			{
				flush()
				bullet = " ".repeat(bullet.length)
			}

			const tokenStr = lineInfo.text.slice(token.begin, token.end)
			content += ` ${tokenStr}`
		}
	}
	flush()

	if (block.type === BlockType.blockComment)
	{
		const p0 = block.prefixes[0]
		const p2 = block.prefixes[2]

		switch (lines.length)
		{
			case 0:
				break

			case 1:
			{
				const prefix     = p0.chars
				const suffix     = p2.chars
				const contentLen = lines[0].length - leader.length
				const extraLen   = indent.length + prefix.length + suffix.length + 1
				const doesFit    = contentLen + extraLen <= lineWidth

				if (doesFit)
				{
					const content = lines[0].substring(leader.length)
					const line    = `${indent}${prefix}${content} ${suffix}`
					lines[0] = line
					break
				}
				// Fallthrough
			}

			default:
			{
				const prefix = " ".repeat(p0.align) + p0.chars
				const line0   = `${indent}${prefix}`
				lines.splice(0, 0, line0)

				const suffix = " ".repeat(p2.align) + p2.chars
				const lineN   = `${indent}${suffix}`
				lines.push(lineN)
				break
			}
		}
	}

	const result = lines.join('\n')
	return result
}

export async function wrapText(ctx: Context): Promise<string[]>
{
	console.assert(ctx.tabWidth > 0)
	console.assert(ctx.lineWidth >= 0)

	const parse  = await parseDocument(ctx)
	const blocks = gatherBlocks(ctx, parse)

	const results = []
	for (const block of blocks)
	{
		const _1      = tokenizeBlock(ctx, block)
		const _2      = analyzeBlock(ctx, block)
		const wrapped = wrapBlock(ctx, block)
		results.push(wrapped)
	}
	return results
}

const cache = new Cache()

// TODO: lua, powershell, toml, yaml, xml, markdown
// NOTE: File names (last path segment) are expected to be unique. Used for the local file cache.
const languages: Record<string, LanguageData> = {
	c: {
		grammar: "https://github.com/tree-sitter/tree-sitter-c/releases/latest/download/tree-sitter-c.wasm",
		lineComment: makePrefixSet("//"),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
	cpp: {
		grammar: "https://github.com/tree-sitter/tree-sitter-cpp/releases/latest/download/tree-sitter-cpp.wasm",
		lineComment: makePrefixSet("//"),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
	csharp: {
		grammar: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/latest/download/tree-sitter-c_sharp.wasm",
		lineComment: makePrefixSet("//"),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
	css: {
		grammar: "https://github.com/tree-sitter/tree-sitter-css/releases/latest/download/tree-sitter-css.wasm",
		lineComment: makePrefixSet(""),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
	go: {
		grammar: "https://github.com/tree-sitter/tree-sitter-go/releases/latest/download/tree-sitter-go.wasm",
		lineComment: makePrefixSet("//"),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
	html: {
		grammar: "https://github.com/tree-sitter/tree-sitter-html/releases/latest/download/tree-sitter-html.wasm",
		lineComment: makePrefixSet(""),
		blockComment: makePrefixSet("<!--", "", "-->"),
	},
	javascript: {
		grammar: "https://github.com/tree-sitter/tree-sitter-javascript/releases/latest/download/tree-sitter-javascript.wasm",
		lineComment: makePrefixSet("//"),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
	json: {
		grammar: "https://github.com/tree-sitter/tree-sitter-json/releases/latest/download/tree-sitter-json.wasm",
		lineComment: makePrefixSet(""),
		blockComment: makePrefixSet("", "", ""),
	},
	python: {
		grammar: "https://github.com/tree-sitter/tree-sitter-python/releases/latest/download/tree-sitter-python.wasm",
		lineComment: makePrefixSet("#"),
		blockComment: makePrefixSet("", "", ""),
	},
	shellscript: {
		grammar: "https://github.com/tree-sitter/tree-sitter-bash/releases/latest/download/tree-sitter-bash.wasm",
		lineComment: makePrefixSet("#"),
		blockComment: makePrefixSet("", "", ""),
	},
	typescript: {
		grammar: "https://github.com/tree-sitter/tree-sitter-typescript/releases/latest/download/tree-sitter-typescript.wasm",
		lineComment: makePrefixSet("//"),
		blockComment: makePrefixSet("/*", " *", " */"),
	},
}

// TODO: Check for newer tree sitter module version
// TODO: Handle multiple fetches at the same time
// TODO: Multi-thread tests (and synchronize tests around disk access)
// TODO: Add a test to ensure file names are unique for grammars

// TODO: Try to split "prefix custom" out of prefix
// TODO: Change tokenEnd to tokenCount
// TODO: Split indentation and custom whitespace
// TODO: Change customPrefix slice to a lazy resolve
// TODO: Cache parser
// TODO: Cache language results
// TODO: Cache parse results
// TODO: Cache query results
// TODO: Move prefixes into the cache
// TODO: Apply edits in vscode
// TODO: Better exporting from this file
// TODO: Have AI implement from scratch and compare
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
