import * as ts from "web-tree-sitter"

class Cache
{
	db = {
		prefixes: new Set<PrefixSet>(),
		fetch:    new Map<string, Uint8Array>(),
		parser:   new Map<string, Parser>(),
	}

	async fetch(url: string, storage: Storage): Promise<Uint8Array>
	{
		// NOTE: We can have multiple fetch requests to the same URL in progress at the same time.
		// This is wasteful, but the caching remains correct. It's an uncommon edge case that I'm not
		// worried about at the moment to leaving the behavior as-is.

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

		// Download if not cached
		const response = await fetch(url)
		const bytes    = await response.bytes()
		if (!response.ok)
			throw new Error(`fetch failed: ${response.status} - ${response.statusText}`)

		// Cache the result on disk (it's ok if this fails)
		try { await storage.write(key, bytes) } catch {}

		// Cache the result in memory
		this.db.fetch.set(url, bytes)
		return bytes
	}

	async parser(url: string, storage: Storage): Promise<Parser>
	{
		// Check the memory cache first
		const memCached = this.db.parser.get(url)
		if (memCached) return memCached

		// Construct parser if not cached
		await ts.Parser.init()
		const wasm     = await cache.fetch(url, storage)
		const language = await ts.Language.load(wasm)
		const tsParser = new ts.Parser().setLanguage(language)
		const query    = new ts.Query(tsParser.language!, "(comment) @c")
		const parser   = { ts: tsParser, query }

		// Cache the result in memory
		this.db.parser.set(url, parser)
		return parser
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
	onError    : (e: Error) => void,
	storage    : Storage,
}

export type Result = {
	range : Range,
	text  : string,
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

export type LanguageData = {
	grammar      : string,
	lineComment  : PrefixSet,
	blockComment : PrefixSet,
}

type Parser = {
	ts:    ts.Parser,
	query: ts.Query,
}

type Parse = {
	parser: ts.Parser,
	query:  ts.Query,
	tree:   ts.Tree,
}

type Token = {
	begin:    number,
	end:      number,
	doxygen?: boolean,
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
	prefix      : Token,
	bullet      : Token,
	bulletAlign : number,
	runLength   : number,
}

type Block = {
	type        : BlockType,
	range       : Range
	minChar     : number
	maxChar     : number
	languageId  : string
	lineInfos   : LineInfo[],
	prefixes    : PrefixSet,
	tokens      : Token[],
	indentWidth : number,
	runCount    : number,
	isContinued : boolean,
}

function toPosition(p: ts.Point): Position
{
	return new Position(p.row, p.column)
}

function consumeIndent(s: string, begin: number, width: number, tabSize: number)
{
	const space = ' '.charCodeAt(0)
	const tab   = '\t'.charCodeAt(0)
	const prevWidth = width

	for (; begin < s.length; ++begin)
	{
		const char = s.charCodeAt(begin)

		     if (char === tab)   width = Math.floor((width + tabSize) / tabSize) * tabSize
		else if (char === space) width += 1
		else break
	}

	return width - prevWidth
}

function visualColumn(s: string, end: number, tabSize: number): number
{
	const tab = '\t'.charCodeAt(0)

	var width = 0
	for (var i = 0; i < end; ++i)
	{
		const char = s.charCodeAt(i)

		if (char === tab) width = Math.floor((width + tabSize) / tabSize) * tabSize
		else              width += 1
	}

	return width
}

async function parseDocument(ctx: Context): Promise<Parse|undefined>
{
	const languageData = languages[ctx.languageId]
	if (languageData)
	{
		const parser = await cache.parser(languageData.grammar, ctx.storage)
		const text   = ctx.getText()
		const tree   = parser.ts.parse(text)
		if (!tree) throw new Error("failed to parse")

		return { parser: parser.ts, query: parser.query, tree }
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
		const allowLineContinue = ctx.languageId === "c" || ctx.languageId === "cpp"
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

			const start    : ts.Point          = { row: selection.start.line, column: Math.max(selection.start.character - 1, 0) }
			const end      : ts.Point          = { row: selection.end.line,   column: selection.end.character + 1 }
			const options  : ts.QueryOptions   = { startPosition: start, endPosition: end }
			const captures : ts.QueryCapture[] = parse.query.captures(parse.tree.rootNode, options)

			for (const capture of captures)
			{
				const text        = capture.node.text
				const lineComment = languageData.lineComment[0].chars
				const isLine      = !!lineComment && text.startsWith(lineComment)
				const isMultiline = capture.node.startPosition.row !== capture.node.endPosition.row
				const isContinued = allowLineContinue && isMultiline

				// NOTE: A few cases where this can happen:
				// * Multiple selections may exist in the same comment.
				// * The character expand may create the above scenario.
				// * The previous block (if it was a line comment) may have extended downward to include this one.
				const startPos  = toPosition(capture.node.startPosition)
				const isHandled = blocks.at(-1)?.range.end.isAfter(startPos)
				if (isHandled) continue

				if (isLine)
				{
					// NOTE: tree sitter treats adjacent line comments as separate comments. So we
					// expand to include immediately adjacent line comments above and below (while
					// being careful not to end up with overlapping blocks).

					// NOTE: Multi-line line comments (i.e. those that have a trailing '\') are not
					// merged: the sibling walks assume single-row nodes and merging buys nothing. The
					// continuations themselves are dropped when wrapping. They are semantically inert
					// (comments become a single space before the preprocessor runs, so a continuation
					// inside a comment never affects a macro body) and normalizing them away also
					// defuses the comment-swallows-code trap (-Wcomment).

					var startNode : ts.Node = capture.node
					var endNode   : ts.Node = capture.node

					if (!isContinued)
					{
						while (true)
						{
							const node        = startNode.previousSibling
							const isComment   = node?.type === "comment"
							const isLine      = node?.text.startsWith(lineComment)
							const isSingleRow = node?.startPosition.row === node?.endPosition.row
							const isAdjacent  = node?.startPosition.row === startNode.startPosition.row - 1
							const isTrailing  = node?.startPosition.row === node?.previousSibling?.endPosition.row
							if (isComment && isLine && isSingleRow && isAdjacent && !isTrailing)
							{
								startNode = node
								continue
							}
							break
						}

						while (true)
						{
							const node        = endNode.nextSibling
							const isComment   = node?.type === "comment"
							const isLine      = node?.text.startsWith(lineComment)
							const isSingleRow = node?.startPosition.row === node?.endPosition.row
							const isAdjacent  = node?.startPosition.row === endNode.startPosition.row + 1
							const isTrailing  = endNode.startPosition.row === endNode.previousSibling?.endPosition.row
							if (isComment && isLine && isSingleRow && isAdjacent && !isTrailing)
							{
								endNode = node
								continue
							}
							break
						}
					}

					const isTrailing = startNode.previousSibling?.endPosition.row === startNode.startPosition.row
					const minChar    = isTrailing ? startNode.previousSibling!.endPosition.column : 0
					const maxChar    = Number.POSITIVE_INFINITY

					blocks.push({
						type:        BlockType.lineComment,
						range:       new Range(toPosition(startNode.startPosition), toPosition(endNode.endPosition)),
						minChar:     minChar,
						maxChar:     maxChar,
						languageId:  ctx.languageId,
						lineInfos:   [],
						prefixes:    structuredClone(languageData.lineComment),
						tokens:      [],
						indentWidth: 0,
						runCount:    0,
						isContinued: isContinued,
					})
				}
				else
				{
					const node       = capture.node
					const isLeading  = node.nextSibling?.startPosition?.row === node.endPosition.row
					const isTrailing = node.previousSibling?.endPosition?.row === node.startPosition.row
					const minChar    = isTrailing ? node.previousSibling.endPosition.column : 0
					const maxChar    = isLeading  ? node.nextSibling.startPosition.column   : Number.POSITIVE_INFINITY

					blocks.push({
						type:        BlockType.blockComment,
						range:       new Range(toPosition(node.startPosition), toPosition(node.endPosition)),
						minChar:     minChar,
						maxChar:     maxChar,
						languageId:  ctx.languageId,
						lineInfos:   [],
						prefixes:    structuredClone(languageData.blockComment),
						tokens:      [],
						indentWidth: 0,
						runCount:    0,
						isContinued: false,
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
				type:        BlockType.prose,
				range:       selection,
				minChar:     0,
				maxChar:     Number.POSITIVE_INFINITY,
				languageId:  ctx.languageId,
				lineInfos:   [],
				prefixes:    makePrefixSet(""),
				tokens:      [],
				indentWidth: 0,
				runCount:    0,
				isContinued: false,
			})
		}
	}

	return blocks
}

function tokenizeBlock(ctx: Context, block: Block)
{
	// NOTE: Can't use y because we want to skip whitespace
	const tokenRe   = /\S+/g
	const backslash = "\\".charCodeAt(0)

	switch (block.type)
	{
		case BlockType.blockComment:
		case BlockType.lineComment:
		{
			for (var iLine = block.range.start.line; iLine <= block.range.end.line; iLine++)
			{
				const line  : TextLine = ctx.getLine(iLine)
				const rLine : Range    = block.range.intersection(line.range)!

				block.lineInfos.push({
					text:        line.text,
					type:        LineType.normal,
					tokenBegin:  block.tokens.length,
					tokenEnd:    block.tokens.length,
					prefix:      { begin: 0, end: 0 },
					bullet:      { begin: 0, end: 0 },
					bulletAlign: 0,
					runLength:   0,
				})
				const lineInfo = block.lineInfos.at(-1)!

				var match : RegExpExecArray | null
				tokenRe.lastIndex = rLine.start.character
				while ((match = tokenRe.exec(line.text)) && match.index < rLine.end.character)
				{
					lineInfo.tokenEnd++
					block.tokens.push({
						begin: match.index,
						end:   Math.min(tokenRe.lastIndex, rLine.end.character),
					})
				}

				// Trim line comment continuations ('\')
				if (block.type === BlockType.lineComment)
				{
					if (block.isContinued && lineInfo.tokenEnd > lineInfo.tokenBegin)
					{
						const token   = block.tokens.at(-1)!
						const isSlash = line.text.charCodeAt(token.end - 1) === backslash
						const atEnd   = token.end === line.text.length
						if (isSlash && atEnd)
						{
							token.end--
							if (token.begin === token.end) lineInfo.tokenEnd--
						}
					}
				}

				// Preserve block comment continuations ('\')
				if (block.type === BlockType.blockComment)
				{
					if (iLine === block.range.end.line)
					{
						const token             = block.tokens.at(-1)!
						const isSlash           = line.text.charCodeAt(line.text.length - 1) === backslash
						const isLeading         = block.maxChar !== Number.POSITIVE_INFINITY
						const allowLineContinue = ctx.languageId === "c" || ctx.languageId === "cpp"
						if (isSlash && !isLeading && allowLineContinue)
						{
							block.isContinued = true
							block.maxChar = Math.min(block.maxChar, token.end)
						}
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
	// TODO: This is per-language
	// TODO: Move to cachePrefixes?
	const prefixChars  = ["/".charCodeAt(0), "*".charCodeAt(0), "!".charCodeAt(0), "<".charCodeAt(0)]
	const langPrefixes = [ block.prefixes[0].chars, block.prefixes[1].chars, block.prefixes[2].chars ]

	// Detect indentation
	{
		const lineInfo = block.lineInfos[0]
		block.indentWidth = consumeIndent(lineInfo.text, 0, 0, ctx.tabWidth)
		block.indentWidth = Math.floor(block.indentWidth / ctx.tabWidth) * ctx.tabWidth
	}

	// Detect suffix
	{
		if (block.type === BlockType.blockComment)
		{
			const lineInfo = block.lineInfos.at(-1)!

			if (lineInfo.tokenEnd > lineInfo.tokenBegin)
			{
				const langSuffix = langPrefixes[2]
				const suffix     = block.prefixes[2]
				const token      = block.tokens[lineInfo.tokenEnd - 1]

				if (lineInfo.text.endsWith(langSuffix, token.end))
				{
					const requiredLen = langPrefixes[0].length + langPrefixes[2].length
					const canExtend   = block.tokens.length > 1 || (token.end - token.begin) > requiredLen
					const prevChar    = lineInfo.text.charCodeAt(token.end - langSuffix.length - 1)
					const hasExtra    = canExtend && prefixChars.includes(prevChar)
					const suffixEnd   = token.end

					token.end -= langSuffix.length + (hasExtra ? 1 : 0)
					suffix.chars = lineInfo.text.slice(token.end, suffixEnd)
					if (token.begin === token.end) lineInfo.tokenEnd--
				}
			}
		}
	}

	// Detect prefix
	{
		for (var i = 0; i < block.lineInfos.length; i++)
		{
			const lineInfo = block.lineInfos[i]

			if (lineInfo.tokenEnd > lineInfo.tokenBegin)
			{
				const iPrefix     = i === 0 ? 0 : 1
				const langPrefix  = langPrefixes[iPrefix]
				const prefix      = block.prefixes[iPrefix]
				const token       = block.tokens[lineInfo.tokenBegin]
				const prefixBegin = token.begin

				if (lineInfo.text.startsWith(langPrefix, token.begin))
				{
					const requiredLen = langPrefixes[0].length
					const canExtend   = block.tokens.length > 1 || (token.end - token.begin) > requiredLen
					const nextChar    = lineInfo.text.charCodeAt(token.begin + langPrefix.length)
					const hasExtra    = canExtend && prefixChars.includes(nextChar)

					token.begin += langPrefix.length + (hasExtra ? 1 : 0)
					if (i < 2) prefix.chars = lineInfo.text.slice(prefixBegin, token.begin)
					if (token.begin === token.end) lineInfo.tokenBegin++
				}

				lineInfo.prefix = { begin: prefixBegin, end: token.begin }
			}
		}

		if (block.type === BlockType.lineComment)
			block.prefixes[1] = block.prefixes[0]
	}

	// Detect bullet
	{
		const bulletRe = /[\*-]|\d+[\)\.]/y

		for (const lineInfo of block.lineInfos)
		{
			if (lineInfo.tokenEnd > lineInfo.tokenBegin)
			{
				const token = block.tokens[lineInfo.tokenBegin]

				bulletRe.lastIndex = token.begin
				if (bulletRe.exec(lineInfo.text))
				{
					const bulletBegin = token.begin

					token.begin = bulletRe.lastIndex
					if (token.begin === token.end) lineInfo.tokenBegin++

					lineInfo.type   = LineType.bullet
					lineInfo.bullet = { begin: bulletBegin, end: token.begin }

					const prefixVEnd   = visualColumn(lineInfo.text, lineInfo.prefix.end,   ctx.tabWidth)
					const bulletVBegin = visualColumn(lineInfo.text, lineInfo.bullet.begin, ctx.tabWidth)
					lineInfo.bulletAlign = Math.max(1, bulletVBegin - prefixVEnd)
				}
			}
		}
	}

	// Detect Doxygen commands
	{
		// Inline  - link/endlink, anchor, emoji, cite, ref, em, a, b, c, e, n, p, f$, f(, f)
		//           any non-word chars followed by optional word chars (e.g. @$, @---, and @~lang)
		// Section - everything else

		const doxygenRe = /(?:endlink|anchor|emoji|link|cite|ref|em|[abcenp])\b|f[\$\(\)]|[^\w\s]\w*/y
		const doxygenLeaders = [ "@".charCodeAt(0), "\\".charCodeAt(0) ]

		for (const lineInfo of block.lineInfos)
		{
			for (var i = lineInfo.tokenBegin; i < lineInfo.tokenEnd; i++)
			{
				const token = block.tokens[i]
				const len = token.end - token.begin

				const firstChar = lineInfo.text.charCodeAt(token.begin)
				if (doxygenLeaders.includes(firstChar) && len > 1)
				{
					doxygenRe.lastIndex = token.begin + 1
					if (!doxygenRe.exec(lineInfo.text))
					{
						token.doxygen = true
						block.runCount += i > lineInfo.tokenBegin ? 1 : 0
					}
				}
			}
		}
	}

	// Detect blank lines
	{
		// NOTE: If a line is both a bullet and blank, blank wins

		for (const lineInfo of block.lineInfos)
		{
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

	// Detect bullet continuation
	{
		for (var i = 0; i < block.lineInfos.length; i++)
		{
			const lineInfo = block.lineInfos[i]

			if (lineInfo.type !== LineType.bullet)
				continue

			for (; i < block.lineInfos.length - 1; i++)
			{
				const lineInfo = block.lineInfos[i + 1]

				if (lineInfo.type === LineType.blank || lineInfo.type === LineType.bullet)
					break

				lineInfo.type = LineType.bullet
			}
		}
	}

	// Calculate run length
	{
		var runLength = 0
		var lastType = LineType.null
		for (const lineInfo of block.lineInfos)
		{
			const isNewBullet = lineInfo.bullet.end > lineInfo.bullet.begin
			if (lineInfo.type !== lastType || isNewBullet)
			{
				runLength = 0
				lastType = lineInfo.type
				block.runCount += lineInfo.type === LineType.skip ? 0 : 1
			}
			lineInfo.runLength = runLength++
		}
	}
}

function wrapBlock(ctx: Context, block: Block): Result
{
	// NOTE: Whitespace and line prefixes are normalized. This means:
	// * Converted to tabs or spaces based on editor settings
	// * Rounded down to a multiple of stab size based on editor settings
	// * Line prefixes normalized to match the first prefix
	// * Line prefixes added to continuation lines of block comments
	// * Whitespace between content tokens is replaced with a single space

	// NOTE: Line layout
	// First line    - <indent><prefixAlign><prefix><bullet><content>
	// Continue line - <indent><prefixAlign><prefix><bulletAlign><content>

	const lines : string[] = []

	const isTrailing   = block.minChar > 0
	const isLeading    = block.maxChar < Number.POSITIVE_INFINITY
	const isSingleLine = (isLeading || isTrailing) && block.runCount === 1
	const isContinued  = block.type === BlockType.blockComment && block.isContinued
	const lineWidth    = isSingleLine ? Number.POSITIVE_INFINITY : ctx.lineWidth
	const indent       = ctx.useSpaces ? " ".repeat(block.indentWidth) : "\t".repeat(block.indentWidth / ctx.tabWidth)
	const p1           = block.prefixes[1]
	const prefix       = " ".repeat(p1.align) + p1.chars
	const leader       = `${indent}${prefix}`

	var flushCount = 0
	var bullet     = ""
	var content    = ""
	var isDoxygen  = false

	function flush()
	{
		if (flushCount++ !== 0)
		{
			lines.push(`${leader}${bullet}${content}`)
			content   = ""
			isDoxygen = false
		}
	}

	for (const lineInfo of block.lineInfos)
	{
		if (lineInfo.type === LineType.skip)
			continue

		if (lineInfo.runLength === 0)
		{
			flush()
			const bulletAlign = " ".repeat(lineInfo.bulletAlign)
			const bulletToken = lineInfo.text.slice(lineInfo.bullet.begin, lineInfo.bullet.end)
			bullet = `${bulletAlign}${bulletToken}`
		}

		for (var i = lineInfo.tokenBegin; i < lineInfo.tokenEnd; i++)
		{
			const token    = block.tokens[i]
			const tokenStr = lineInfo.text.slice(token.begin, token.end)

			if (token.doxygen)
			{
				if (content.length || isDoxygen)
					flush()

				isDoxygen = true
				bullet    = ` ${tokenStr}`
				continue
			}

			const totalLen = leader.length + bullet.length + content.length + 1 + tokenStr.length
			const doesFit  = totalLen <= lineWidth
			const overflow = content.length && !doesFit

			if (overflow)
			{
				flush()
				bullet = " ".repeat(bullet.length)
			}

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
				const totalLen   = indent.length + prefix.length + contentLen + 1 + suffix.length
				const doesFit    = totalLen <= lineWidth

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

	// TODO: If we always go to adjacent code:
	// * Pro: The start and end position logic becomes simpler
	// * Pro: We could normalize whitespace
	// * Con: We have to do more work to deal with whitespace

	// Extend the range to normalize adjacent whitespace
	if (!isTrailing || lines.length !== 1) block.range.start.character = block.minChar
	if (!isLeading  || lines.length !== 1) block.range.end.character   = block.maxChar

	// Push multi-line comments onto separate lines
	if (isTrailing && lines.length > 1 && !isContinued) lines.splice(0, 0, "")
	if (isLeading  && lines.length > 1 && !isContinued) lines.push(indent)

	// Always emit a final newline
	if (!isLeading) lines.push("")

	const text = lines.join('\n')
	return { text, range: block.range }
}

export async function wrap(ctx: Context): Promise<Result[]>
{
	console.assert(ctx.tabWidth > 0)
	console.assert(ctx.lineWidth >= 0)

	try
	{
		const results: Result[] = []
		const parse  = await parseDocument(ctx)
		const blocks = gatherBlocks(ctx, parse)

		for (const block of blocks)
		{
			tokenizeBlock(ctx, block)
			analyzeBlock(ctx, block)
			const result = wrapBlock(ctx, block)
			results.push(result)
		}
		return results
	}
	catch (e)
	{
		ctx.onError(e as Error)
	}

	return []
}

const cache = new Cache()

// TODO: lua, powershell, toml, yaml, xml, markdown
// NOTE: File names (last path segment) are expected to be unique. Used for the local file cache.
export const languages: Record<string, LanguageData> = {
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
// TODO: Implement plaintext support
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
