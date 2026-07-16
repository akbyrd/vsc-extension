import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as wrap from "./wrapping.js"

async function doWrap(s: string, override?: Partial<wrap.Context>): Promise<string>
{
	const newLines : number[] = [ 0 ]
	for (var iChar = 0; iChar < s.length; ++iChar)
	{
		const c = s[iChar]
		if (c === '\n')
			newLines.push(iChar + 1)
	}
	newLines.push(s.length + 1)

	function getLine(iLine: number): wrap.TextLine
	{
		console.assert(iLine < newLines.length)

		const iBegin = newLines[iLine + 0]
		const iEnd   = newLines[iLine + 1]
		const text   = s.slice(iBegin, iEnd - 1)
		const begin  = new wrap.Position(iLine, 0)
		const end    = new wrap.Position(iLine, text.length)
		const range  = new wrap.Range(begin, end)

		const line : wrap.TextLine = { text, range }
		return line
	}

	async function readFile(key: string): Promise<Uint8Array | undefined>
	{
		try
		{
			const filePath = path.join("out", key)
			return await fs.readFile(filePath)
		}
		catch
		{
			return undefined
		}
	}

	async function writeFile(key: string, data: Uint8Array): Promise<void>
	{
		const filePath = path.join("out", key)
		await fs.mkdir("out", { recursive: true })
		await fs.writeFile(filePath, data)
	}

	const languageId = "cpp"
	const begin      = new wrap.Position(0, 0)
	const end        = new wrap.Position(newLines.length - 2, newLines.at(-1))
	const selection  = new wrap.Range(begin, end)

	const ctx : wrap.Context = {
		tabWidth   : override?.tabWidth ?? 4,
		useSpaces  : override?.useSpaces ?? false,
		lineWidth  : override?.lineWidth ?? 60,
		languageId : override?.languageId ?? languageId,
		selections : override?.selections ?? [ selection ],
		getText    : () => s,
		getLine    : getLine,
		onError    : console.log,
		storage    : {
			read  : readFile,
			write : writeFile,
		},
	}

	const results = await wrap.wrap(ctx)

	for (const result of results.reverse())
	{
		// TODO: Try to clean this up
		const start = result.range.start
		const end   = result.range.end
		const inf   = Number.POSITIVE_INFINITY

		const startChar = start.character === inf ? (newLines[start.line + 1] - 1 ?? s.length) - newLines[start.line] : start.character
		const endChar   = end  .character === inf ? (newLines[end  .line + 1] - 0 ?? s.length) - newLines[end  .line] : end  .character

		const iBegin = newLines[start.line] + startChar
		const iEnd   = newLines[end.line]   + endChar

		s = s.slice(0, iBegin) + result.text + s.slice(iEnd)
	}
	return s
}

async function test(original: string, expected: string, override?: Partial<wrap.Context>)
{
	const actual = await doWrap(original, override)

	try
	{
		assert.deepEqual(actual, expected)
	}
	catch (e)
	{
		assert(e instanceof Error)
		Error.captureStackTrace(e, test)
		throw e
	}

	// NOTE: We need to do something async so test results are flushed and can stream
	await new Promise(setImmediate)
}

describe("line comments", () =>
{
	// Test whitespace between tokens
	describe("whitespace", () =>
	{
		it("1", () => test("// asd  asd", "// asd asd\n"))
		it("2", () => test("// asd\tasd", "// asd asd\n"))
	})

	// Test indentation
	describe("indent", () =>
	{
		it("1",  () => test("// asd",               "// asd\n"))
		it("2",  () => test(" // asd",              "// asd\n"))
		it("3",  () => test("   // asd",            "// asd\n"))
		it("4",  () => test("    // asd",           "\t// asd\n"))
		it("5",  () => test("     // asd",          "\t// asd\n"))
		it("6",  () => test("\t// asd",             "\t// asd\n"))
		it("7",  () => test("\t // asd",            "\t// asd\n"))
		it("8",  () => test("\t   // asd",          "\t// asd\n"))
		it("9",  () => test("\t    // asd",         "\t\t// asd\n"))
		it("10", () => test("\t     // asd",        "\t\t// asd\n"))
		it("11", () => test(" \t// asd",            "\t// asd\n"))
		it("12", () => test("   \t// asd",          "\t// asd\n"))
		it("13", () => test("    \t// asd",         "\t\t// asd\n"))
		it("14", () => test("     \t// asd",        "\t\t// asd\n"))
		it("15", () => test("  \t \t \t // asd",    "\t\t\t// asd\n"))
		it("16", () => test("  \t \t \t    // asd", "\t\t\t\t// asd\n"))
	})

	// Test whitespace at beginning of content (after prefix)
	describe("head-space", () =>
	{
		it("1",           () => test("//asd",      "// asd\n"))
		it("2",           () => test("// asd",     "// asd\n"))
		it("3",           () => test("//   asd",   "// asd\n"))
		it("4",           () => test("//    asd",  "// asd\n"))
		it("5",           () => test("//     asd", "// asd\n"))
		it("6",           () => test("//\tasd",    "// asd\n"))
		it("7",           () => test("// \tasd",   "// asd\n"))
		it("8",           () => test("//\t asd",   "// asd\n"))
		it("9",           () => test("//(asd)",    "// (asd)\n"))
		it("with/indent", () => test("\t//asd",    "\t// asd\n"))
	})

	// Test whitespace at end of content
	describe("tail-space", () =>
	{
		it("1",               () => test("// asd ",    "// asd\n"))
		it("2",               () => test("// asd\t",   "// asd\n"))
		it("3",               () => test("// asd \t ", "// asd\n"))
		it("with indent",     () => test("\t// asd ",  "\t// asd\n"))
		it("with head-space", () => test("//asd ",     "// asd\n"))
	})

	// Test custom prefix
	describe("prefix", () =>
	{
		it("1",               () => test("/// asd",   "/// asd\n"))
		it("2",               () => test("//* asd",   "//* asd\n"))
		it("3",               () => test("//! asd",   "//! asd\n"))
		it("4",               () => test("//< asd",   "//< asd\n"))
		it("with indent",     () => test("\t/// asd", "\t/// asd\n"))
		it("with head-space", () => test("///asd",    "/// asd\n"))
		it("with tail-space", () => test("/// asd ",  "/// asd\n"))
	})

	// Test trailing
	describe("trailing", () =>
	{
		it("1",                      () => test("0; // asd",                       "0; // asd\n"))
		it("2",                      () => test("0; // asd\n// asd",               "0; // asd\n// asd\n"))
		it("with indent",            () => test("0;// asd",                        "0;// asd\n"))
		it("with head-space",        () => test("0; //asd",                        "0; // asd\n"))
		it("with tail-space",        () => test("0; // asd ",                      "0; // asd\n"))
		it("with prefix",            () => test("0; /// asd",                      "0; /// asd\n"))
		it("with bullet, narrow 1",  () => test("0; // * asd asd",                 "0; // * asd asd\n",                                        { lineWidth: 0 }))
		it("with bullet, narrow 2",  () => test("0; // * asd asd\n// * asd asd ",  "0; // * asd asd\n// * asd\n//   asd\n",                    { lineWidth: 0 }))
		it("with doxygen, narrow 1", () => test("0; // @see asd asd",              "0; // @see asd asd\n",                                     { lineWidth: 0 }))
		it("with doxygen, narrow 2", () => test("0; // @see asd asd @see asd asd", "0;\n// @see asd\n//      asd\n// @see asd\n//      asd\n", { lineWidth: 0 }))
		it("with doxygen, narrow 3", () => test("0; // asd asd @see asd asd",      "0;\n// asd\n// asd\n// @see asd\n//      asd\n",           { lineWidth: 0 }))
	})

	// Test multi line
	describe("multiline", () =>
	{
		it("1",               () => test("// asd\n// asd",    "// asd asd\n"))
		it("2",               () => test("// asd\n// asd",    "// asd\n// asd\n",     { lineWidth: 6 }))
		it("3",               () => test("// asd\n\n// asd",  "// asd\n\n// asd\n"))
		it("4",               () => test("//\n// asd",        "// asd\n"))
		it("with indent",     () => test("\t// asd\n// asd",  "\t// asd\n\t// asd\n", { lineWidth: 6 }))
		it("with head-space", () => test("//asd\n// asd",     "// asd\n// asd\n",     { lineWidth: 6 }))
		it("with tail-space", () => test("// asd \n// asd ",  "// asd\n// asd\n",     { lineWidth: 6 }))
		it("with prefix",     () => test("/// asd\n// asd",   "/// asd\n/// asd\n",   { lineWidth: 6 }))
		it("with trailing",   () => test("0; // asd\n// asd", "0; // asd\n// asd\n"))
	})

	// Test narrow lines
	describe("narrow", () =>
	{
		it("1",               () => test("// asd",                 "// asd\n",                         { lineWidth: 0 }))
		it("2",               () => test("// asd asd",             "// asd\n// asd\n",                 { lineWidth: 0 }))
		it("with indent",     () => test("\t// asd asd",           "\t// asd\n\t// asd\n",             { lineWidth: 0 }))
		it("with head-space", () => test("//asd asd",              "// asd\n// asd\n",                 { lineWidth: 0 }))
		it("with tail-space", () => test("// asd asd ",            "// asd\n// asd\n",                 { lineWidth: 0 }))
		it("with prefix",     () => test("/// asd asd",            "/// asd\n/// asd\n",               { lineWidth: 0 }))
		it("with trailing 1", () => test("0; // asd",              "0; // asd\n",                      { lineWidth: 0 }))
		it("with trailing 2", () => test("0; // asd asd",          "0; // asd asd\n",                  { lineWidth: 0 }))
		it("with multiline",  () => test("// asd asd\n// asd asd", "// asd\n// asd\n// asd\n// asd\n", { lineWidth: 0 }))
	})

	// Test preserved newlines
	describe("newline", () =>
	{
		it("1",               () => test("// asd\n//\n//\n// asd",     "// asd\n//\n// asd\n"))
		it("2",               () => test("//\n// asd",                 "// asd\n"))
		it("3",               () => test("// asd\n//",                 "// asd\n"))
		it("4",               () => test("// asd\n// \n// asd",        "// asd\n//\n// asd\n"))
		it("5",               () => test("// asd\n//    \n// asd",     "// asd\n//\n// asd\n"))
		it("6",               () => test("// asd\n//\t\n// asd",       "// asd\n//\n// asd\n"))
		it("with indent",     () => test("\t// asd\n\t//\n\t// asd",   "\t// asd\n\t//\n\t// asd\n"))
		it("with head-space", () => test("//asd\n//\n//asd",           "// asd\n//\n// asd\n"))
		it("with tail-space", () => test("// asd \n// \n// asd ",      "// asd\n//\n// asd\n"))
		it("with prefix",     () => test("/// asd\n///\n/// asd",      "/// asd\n///\n/// asd\n"))
		it("with trailing",   () => test("0; // asd\n//\n// asd",      "0; // asd\n// asd\n"))
		it("with multiline",  () => test("// asd\n// asd\n//\n// asd", "// asd asd\n//\n// asd\n"))
		it("with narrow",     () => test("// asd asd\n//\n// asd asd", "// asd\n// asd\n//\n// asd\n// asd\n", { lineWidth: 0 }))
	})

	// Test preserved bullets
	describe("bullet", () =>
	{
		it("1",               () => test("// * asd",                  "// * asd\n"))
		it("2",               () => test("//  * asd",                 "//  * asd\n"))
		it("3",               () => test("//  - asd",                 "//  - asd\n"))
		it("4",               () => test("//  1. asd",                "//  1. asd\n"))
		it("5",               () => test("//  1) asd",                "//  1) asd\n"))
		it("6",               () => test("//   * asd",                "//   * asd\n"))
		it("7",               () => test("//    * asd",               "//    * asd\n"))
		it("8",               () => test("//     * asd",              "//     * asd\n"))
		it("9",               () => test("//\t* asd",                 "//  * asd\n",                 { tabWidth: 4 }))
		it("10",              () => test("// \t* asd",                "//  * asd\n",                 { tabWidth: 4 }))
		it("11",              () => test("//  * asd\n//  * asd",      "//  * asd\n//  * asd\n"))
		it("12",              () => test("//  * asd\n//    * asd",    "//  * asd\n//    * asd\n"))
		it("with indent",     () => test("\t//  * asd",               "\t//  * asd\n"))
		it("with head-space", () => test("//1. asd",                  "// 1. asd\n"))
		it("with tail-space", () => test("//  * asd ",                "//  * asd\n"))
		it("with prefix",     () => test("///  * asd",                "///  * asd\n"))
		it("with trailing",   () => test("0; //  * asd",              "0; //  * asd\n"))
		it("with multiline",  () => test("// asd\n//  * asd\n// asd", "// asd\n//  * asd asd\n"))
		it("with narrow 1",   () => test("//  * asd",                 "//  * asd\n",                 { lineWidth: 0 }))
		it("with narrow 2",   () => test("//  * asd asd",             "//  * asd\n//    asd\n",      { lineWidth: 0 }))
		it("with newline",    () => test("//  * asd\n//\n//  * asd",  "//  * asd\n//\n//  * asd\n"))
	})

	// Test preserved doxygen
	describe("doxygen", () =>
	{
		it("1",                 () => test("// asd\n// @see asd",          "// asd\n// @see asd\n"))
		it("2",                 () => test("// asd\n// \\see asd",         "// asd\n// \\see asd\n"))
		it("3",                 () => test("// asd @see asd",              "// asd\n// @see asd\n"))
		it("4",                 () => test("// @see @see",                 "// @see\n// @see\n"))
		it("5",                 () => test("// asd\n// @emoji asd",        "// asd @emoji asd\n"))
		it("6",                 () => test("// asd\n// @ref asd",          "// asd @ref asd\n"))
		it("7",                 () => test("// asd\n// @em asd",           "// asd @em asd\n"))
		it("8",                 () => test("// asd\n// @a asd",            "// asd @a asd\n"))
		it("9",                 () => test("// asd\n// @f$ asd",           "// asd @f$ asd\n"))
		it("10",                () => test("// asd\n// @$ asd",            "// asd @$ asd\n"))
		it("11",                () => test("// asd\n// @:: asd",           "// asd @:: asd\n"))
		it("12",                () => test("// asd @ref asd",              "// asd @ref asd\n"))
		it("13",                () => test("// @ref @ref",                 "// @ref @ref\n"))
		it("with indent",       () => test("\t// @ref asd",                "\t// @ref asd\n"))
		it("with head-space 1", () => test("//@ref asd",                   "// @ref asd\n"))
		it("with head-space 2", () => test("//@ref\n// asd",               "// @ref asd\n"))
		it("with head-space 3", () => test("//@f$",                        "// @f$\n"))
		it("with head-space 4", () => test("///@f$",                       "/// @f$\n"))
		it("with tail-space",   () => test("// @ref asd ",                 "// @ref asd\n"))
		it("with prefix",       () => test("/// @ref asd",                 "/// @ref asd\n"))
		it("with trailing",     () => test("0; // @ref asd",               "0; // @ref asd\n"))
		it("with multiline 1",  () => test("// @see asd\n// @see asd",     "// @see asd\n// @see asd\n"))
		it("with multiline 2",  () => test("// @ref asd\n// @ref asd",     "// @ref asd @ref asd\n"))
		it("with narrow 1",     () => test("// @param asd asd",            "// @param asd\n//        asd\n", { lineWidth: 13 }))
		it("with narrow 2",     () => test("// @param asd asd",            "// @param asd\n//        asd\n", { lineWidth: 12 }))
		it("with newline",      () => test("// @ref asd\n//\n// @ref asd", "// @ref asd\n//\n// @ref asd\n"))
		it("with bullet 1",     () => test("// * @see asd",                "// @see asd\n"))
		it("with bullet 2",     () => test("// * asd @see asd",            "// * asd\n// @see asd\n"))
		it("with bullet 3",     () => test("// * @ref asd",                "// * @ref asd\n"))
		it("with bullet 4",     () => test("// * asd @ref asd",            "// * asd @ref asd\n"))
	})

	// Test empty
	describe("empty", () =>
	{
		it("1",               () => test("//",          ""))
		it("2",               () => test("0;\n//",      "0;\n"))
		it("3",               () => test("//\n0;",      "0;"))
		it("4",               () => test("0;\n//\n1;",  "0;\n1;"))
		it("5",               () => test("//\n\t0;",    "\t0;"))
		it("6",               () => test("//\n\n0;",    "\n0;"))
		it("7",               () => test("0;\n\n//",    "0;\n\n"))
		it("with indent",     () => test("\t//\n\t//",  ""))
		it("with head-space", () => test("// ",         ""))
		it("with tail-space", () => test("// ",         ""))
		it("with prefix",     () => test("///",         ""))
		it("with trailing",   () => test("0; //",       "0;"))
		it("with multiline",  () => test("//\n//",      ""))
		it("with narrow",     () => test("//",          "", { lineWidth: 0 }))
		it("with bullet 1",   () => test("// *",        ""))
		it("with bullet 2",   () => test("// * ",       ""))
		it("with bullet 3",   () => test("//\n// * ",   ""))
		it("with newline",    () => test("//\n//\n//",  ""))
		it("with doxygen",    () => test("// @endcode", "// @endcode\n"))
	})
})



describe("block comments", () =>
{
	// Test whitespace between tokens
	describe("whitespace", () =>
	{
		it("1", () => test("/* asd  asd */", "/* asd asd */\n"))
		it("2", () => test("/* asd\tasd */", "/* asd asd */\n"))
	})

	// Test indentation
	describe("indent", () =>
	{
		it("1", () => test("   /* asd */",      "/* asd */\n"))
		it("2", () => test("\t/* asd */",       "\t/* asd */\n"))
		it("3", () => test("    \t/* asd */",   "\t\t/* asd */\n"))
		it("4", () => test("/*\n\tasd\n\t\t*/", "/* asd */\n"))
	})

	// Test whitespace at beginning of content (after prefix)
	describe("head-space", () =>
	{
		it("1",           () => test("/*asd */",   "/* asd */\n"))
		it("2",           () => test("/*  asd */", "/* asd */\n"))
		it("3",           () => test("/*\tasd */", "/* asd */\n"))
		it("4",           () => test("/*(asd) */", "/* (asd) */\n"))
		it("with indent", () => test("\t/*asd */", "\t/* asd */\n"))
	})

	// Test whitespace at end of content (before suffix)
	describe("tail-space", () =>
	{
		it("1",               () => test("/* asd*/",     "/* asd */\n"))
		it("2",               () => test("/* asd\t*/",   "/* asd */\n"))
		it("3",               () => test("/* asd \t */", "/* asd */\n"))
		it("4",               () => test("/* asd()*/",   "/* asd() */\n"))
		it("with indent",     () => test("\t/* asd*/",   "\t/* asd */\n"))
		it("with head-space", () => test("/*asd*/",      "/* asd */\n"))
	})

	// Test custom prefix
	describe("prefix", () =>
	{
		it("1",               () => test("/** asd */",           "/** asd */\n"))
		it("2",               () => test("/*! asd */",           "/*! asd */\n"))
		it("3",               () => test("/*< asd */",           "/*< asd */\n"))
		it("5",               () => test("/* asd\nasd\n */",     "/*\n * asd\n * asd\n */\n",  { lineWidth: 0 }))
		it("6",               () => test("/** asd\n * asd\n */", "/**\n * asd\n * asd\n */\n", { lineWidth: 0 }))
		it("with indent",     () => test("\t/** asd */",         "\t/** asd */\n"))
		it("with head-space", () => test("/**asd */",            "/** asd */\n"))
		it("with tail-space", () => test("/** asd*/",            "/** asd */\n"))
	})

	// Test custom suffix
	describe("suffix", () =>
	{
		it("1",               () => test("/* asd **/",   "/* asd **/\n"))
		it("2",               () => test("/* asd !*/",   "/* asd !*/\n"))
		it("3",               () => test("/* asd <*/",   "/* asd <*/\n"))
		it("with indent",     () => test("\t/* asd **/", "\t/* asd **/\n"))
		it("with head-space", () => test("/*asd **/",    "/* asd **/\n"))
		it("with tail-space", () => test("/* asd**/",    "/* asd **/\n"))
		it("with prefix 1",   () => test("/** asd **/",  "/** asd **/\n"))
		it("with prefix 2",   () => test("/**a**/",      "/** a **/\n"))
	})

	// Test leading
	describe("leading", () =>
	{
		it("1",                       () => test("/* asd */ int x;",                       "/* asd */ int x;"))
		it("2",                       () => test("/* asd *//* asd */",                     "/* asd *//* asd */\n"))
		it("with indent",             () => test("\t/* asd */ int x;",                     "\t/* asd */ int x;"))
		it("with head-space",         () => test("/*asd */ int x;",                        "/* asd */ int x;"))
		it("with tail-space",         () => test("/* asd*/ int x;",                        "/* asd */ int x;"))
		it("with prefix",             () => test("/** asd */ int x;",                      "/** asd */ int x;"))
		it("with suffix",             () => test("/* asd **/ int x;",                      "/* asd **/ int x;"))
		it("with bullet, narrow 1",   () => test("/* * asd asd */ int x;",                 "/* * asd asd */ int x;",                                              { lineWidth: 0 }))
		it("with bullet, narrow 2",   () => test("/* * asd asd\n * * asd asd */ int x;",   "/*\n * * asd\n *   asd\n * * asd\n *   asd\n */\nint x;",             { lineWidth: 0 }))
		it("with doxygen, narrow 1",  () => test("/* @see asd asd */ int x;",              "/* @see asd asd */ int x;",                                           { lineWidth: 0 }))
		it("with doxygen, narrow 2",  () => test("/* @see asd asd @see asd asd */ int x;", "/*\n * @see asd\n *      asd\n * @see asd\n *      asd\n */\nint x;", { lineWidth: 0 }))
		it("with doxygen, narrow 3",  () => test("/* asd asd @see asd asd */ int x;",      "/*\n * asd\n * asd\n * @see asd\n *      asd\n */\nint x;",           { lineWidth: 0 }))
	})

	// Test trailing
	describe("trailing", () =>
	{
		it("1",                      () => test("0; /* asd */",                       "0; /* asd */\n"))
		it("with indent",            () => test("0;/* asd */",                        "0;/* asd */\n"))
		it("with head-space",        () => test("0; /*asd */",                        "0; /* asd */\n"))
		it("with tail-space",        () => test("0; /* asd*/",                        "0; /* asd */\n"))
		it("with prefix",            () => test("0; /** asd */",                      "0; /** asd */\n"))
		it("with suffix",            () => test("0; /* asd **/",                      "0; /* asd **/\n"))
		it("with bullet, narrow 1",  () => test("0; /* * asd asd */",                 "0; /* * asd asd */\n",                                              { lineWidth: 0 }))
		it("with bullet, narrow 2",  () => test("0; /* * asd asd\n * * asd asd */",   "0;\n/*\n * * asd\n *   asd\n * * asd\n *   asd\n */\n",             { lineWidth: 0 }))
		it("with doxygen, narrow 1", () => test("0; /* @see asd asd */",              "0; /* @see asd asd */\n",                                           { lineWidth: 0 }))
		it("with doxygen, narrow 2", () => test("0; /* @see asd asd @see asd asd */", "0;\n/*\n * @see asd\n *      asd\n * @see asd\n *      asd\n */\n", { lineWidth: 0 }))
		it("with doxygen, narrow 3", () => test("0; /* asd asd @see asd asd */",      "0;\n/*\n * asd\n * asd\n * @see asd\n *      asd\n */\n",           { lineWidth: 0 }))
	})

	// Test embedded
	describe("embedded", () =>
	{
		it("1",                      () => test("foo(/* asd */ x);",                       "foo(/* asd */ x);"))
		it("with indent",            () => test("foo(\t/* asd */ x);",                     "foo(\t/* asd */ x);"))
		it("with head-space",        () => test("foo(/*asd */ x);",                        "foo(/* asd */ x);"))
		it("with tail-space",        () => test("foo(/* asd*/ x);",                        "foo(/* asd */ x);"))
		it("with prefix",            () => test("foo(/** asd */ x);",                      "foo(/** asd */ x);"))
		it("with suffix",            () => test("foo(/* asd **/ x);",                      "foo(/* asd **/ x);"))
		it("with bullet, narrow 1",  () => test("foo(/* * asd asd */ x);",                 "foo(/* * asd asd */ x);",                                                { lineWidth: 0 }))
		it("with bullet, narrow 2",  () => test("foo(/* * asd asd\n * * asd asd */ x);",   "foo(\n/*\n * * asd\n *   asd\n * * asd\n *   asd\n */\nx);",             { lineWidth: 0 }))
		it("with doxygen, narrow 1", () => test("foo(/* @see asd asd */ x);",              "foo(/* @see asd asd */ x);",                                             { lineWidth: 0 }))
		it("with doxygen, narrow 2", () => test("foo(/* @see asd asd @see asd asd */ x);", "foo(\n/*\n * @see asd\n *      asd\n * @see asd\n *      asd\n */\nx);", { lineWidth: 0 }))
		it("with doxygen, narrow 3", () => test("foo(/* asd asd @see asd asd */ x);",      "foo(\n/*\n * asd\n * asd\n * @see asd\n *      asd\n */\nx);",           { lineWidth: 0 }))
	})

	// Test multi line
	describe("multiline", () =>
	{
		it("1",               () => test("/*\n * asd\n * asd\n */",         "/* asd asd */\n"))
		it("2",               () => test("/*\n * asd\n * asd\n */",         "/*\n * asd\n * asd\n */\n",         { lineWidth: 6 }))
		it("3",               () => test("/*\n * asd\n\n*/",                "/* asd */\n"))
		it("4",               () => test("/*\nasd */",                      "/* asd */\n"))
		it("with indent",     () => test("\t/*\n\t * asd\n\t * asd\n\t */", "\t/*\n\t * asd\n\t * asd\n\t */\n", { lineWidth: 6 }))
		it("with head-space", () => test("/*\n*asd\n*asd\n*/",              "/*\n * asd\n * asd\n */\n",         { lineWidth: 6 }))
		it("with tail-space", () => test("/*\n * asd \n * asd*/",           "/*\n * asd\n * asd\n */\n",         { lineWidth: 6 }))
		it("with prefix",     () => test("/**\n ** asd\n ** asd */",        "/**\n ** asd\n ** asd\n */\n",      { lineWidth: 6 }))
		it("with suffix",     () => test("/*\n * asd\n **/",                "/*\n * asd\n **/\n",                { lineWidth: 6 }))
		it("with leading",    () => test("/*\n * asd\n */ int x;",          "/* asd */ int x;"))
		it("with trailing",   () => test("0; /*\n * asd\n */",              "0; /* asd */\n"))
		it("with embedded",   () => test("foo(/*\n * asd\n */ x);",         "foo(/* asd */ x);"))
	})

	// Test narrow lines
	describe("narrow", () =>
	{
		it("1",               () => test("/* asd */",                 "/* asd */\n",                               { lineWidth: 9 }))
		it("2",               () => test("/* asd */",                 "/*\n * asd\n */\n",                         { lineWidth: 8 }))
		it("3",               () => test("/* asd asd */",             "/*\n * asd\n * asd\n */\n",                 { lineWidth: 0 }))
		it("with indent",     () => test("\t/* asd asd */",           "\t/*\n\t * asd\n\t * asd\n\t */\n",         { lineWidth: 0 }))
		it("with head-space", () => test("/*asd asd */",              "/*\n * asd\n * asd\n */\n",                 { lineWidth: 0 }))
		it("with tail-space", () => test("/* asd asd*/",              "/*\n * asd\n * asd\n */\n",                 { lineWidth: 0 }))
		it("with prefix",     () => test("/** asd asd */",            "/**\n * asd\n * asd\n */\n",                { lineWidth: 0 }))
		it("with suffix",     () => test("/* asd asd **/",            "/*\n * asd\n * asd\n **/\n",                { lineWidth: 0 }))
		it("with leading",    () => test("/* asd */ int x;",          "/* asd */ int x;"  ,                        { lineWidth: 0 }))
		it("with trailing",   () => test("0; /* asd */",              "0; /* asd */\n",                            { lineWidth: 0 }))
		it("with embedded",   () => test("foo(/* asd */ x);",         "foo(/* asd */ x);",                         { lineWidth: 0 }))
		it("with multiline",  () => test("/* asd asd\n * asd asd */", "/*\n * asd\n * asd\n * asd\n * asd\n */\n", { lineWidth: 0 }))
	})

	// Test preserved newlines
	describe("newline", () =>
	{
		it("1",               () => test("/* asd\n *\n *\n * asd */",     "/*\n * asd\n *\n * asd\n */\n"))
		it("2",               () => test("/*\n *\n * asd */",             "/* asd */\n"))
		it("3",               () => test("/* asd\n *\n */",               "/* asd */\n"))
		it("4",               () => test("/* asd\n * \n * asd */",        "/*\n * asd\n *\n * asd\n */\n"))
		it("5",               () => test("/* asd\n *    \n * asd */",     "/*\n * asd\n *\n * asd\n */\n"))
		it("6",               () => test("/* asd\n *\t\n * asd */",       "/*\n * asd\n *\n * asd\n */\n"))
		it("with indent",     () => test("\t/* asd\n\t *\n\t * asd */",   "\t/*\n\t * asd\n\t *\n\t * asd\n\t */\n"))
		it("with head-space", () => test("/*asd\n *\n *asd*/",            "/*\n * asd\n *\n * asd\n */\n"))
		it("with tail-space", () => test("/* asd \n * \n * asd \n */ ",   "/*\n * asd\n *\n * asd\n */\n"))
		it("with prefix",     () => test("/** asd\n ** \n ** asd\n */",   "/**\n ** asd\n **\n ** asd\n */\n"))
		it("with suffix",     () => test("/* asd\n *\n * asd **/",        "/*\n * asd\n *\n * asd\n **/\n"))
		it("with leading",    () => test("/* asd\n *\n * asd */ int x;",  "/*\n * asd\n *\n * asd\n */\nint x;"))
		it("with trailing",   () => test("0; /* asd\n *\n * asd */",      "0;\n/*\n * asd\n *\n * asd\n */\n"))
		it("with embedded",   () => test("foo(/* asd\n *\n * asd */ x)",  "foo(\n/*\n * asd\n *\n * asd\n */\nx)"))
		it("with multiline",  () => test("/*\n * asd\n *\n * asd\n */",   "/*\n * asd\n *\n * asd\n */\n"))
		it("with narrow",     () => test("/* asd asd\n *\n * asd asd */", "/*\n * asd\n * asd\n *\n * asd\n * asd\n */\n", { lineWidth: 0 }))
	})

	// Test preserved bullets
	describe("bullet", () =>
	{
		it("1",               () => test("/* * asd */",                   "/* * asd */\n"))
		it("2",               () => test("/* - asd */",                   "/* - asd */\n"))
		it("3",               () => test("/* 1. asd */",                  "/* 1. asd */\n"))
		it("4",               () => test("/* 1) asd */",                  "/* 1) asd */\n"))
		it("5",               () => test("/*  * asd */",                  "/*  * asd */\n"))
		it("6",               () => test("/*\t* asd */",                  "/*  * asd */\n", { tabWidth: 4 }))
		it("7",               () => test("/* \t* asd */",                 "/*  * asd */\n", { tabWidth: 4 }))
		it("8",               () => test("/*  * asd\n *  * asd */",       "/*\n *  * asd\n *  * asd\n */\n"))
		it("9",               () => test("/*  * asd\n *    * asd */",     "/*\n *  * asd\n *    * asd\n */\n"))
		it("10",              () => test("/*  * asd\n  * asd\n */",       "/*  * asd asd */\n"))
		it("11",              () => test("/*  * asd\n  *  * asd */",      "/*\n *  * asd\n *  * asd\n */\n"))
		it("12",              () => test("\t/*  * asd\n\t  - asd\n\t */", "\t/*\n\t *  * asd\n\t * - asd\n\t */\n"))
		it("with indent",     () => test("\t/*  * asd */",                "\t/*  * asd */\n"))
		it("with head-space", () => test("/*1. asd */",                   "/* 1. asd */\n"))
		it("with tail-space", () => test("/*  * asd */ ",                 "/*  * asd */\n"))
		it("with prefix",     () => test("/**  * asd */",                 "/**  * asd */\n"))
		it("with leading",    () => test("/*  * asd */ int x;",           "/*  * asd */ int x;"))
		it("with trailing",   () => test("0; /*  * asd */",               "0; /*  * asd */\n"))
		it("with embedded",   () => test("foo(/*  * asd */ x)",           "foo(/*  * asd */ x)"))
		it("with multiline",  () => test("/*\n *  * asd\n */",            "/*  * asd */\n"))
		it("with narrow 1",   () => test("/*  * asd */",                  "/*\n *  * asd\n */\n",            { lineWidth: 0 }))
		it("with narrow 2",   () => test("/*  * asd asd */",              "/*\n *  * asd\n *    asd\n */\n", { lineWidth: 0 }))
		it("with newline",    () => test("/*  * asd\n *\n *  * asd */",   "/*\n *  * asd\n *\n *  * asd\n */\n"))
	})

	// Test preserved doxygen
	describe("doxygen", () =>
	{
		it("1",                 () => test("/* asd\n * @see asd */",            "/*\n * asd\n * @see asd\n */\n"))
		it("2",                 () => test("/* asd\n * * see asd */",           "/*\n * asd\n * * see asd\n */\n"))
		it("3",                 () => test("/* asd @see asd */",                "/*\n * asd\n * @see asd\n */\n"))
		it("4",                 () => test("/* @see @see */",                   "/*\n * @see\n * @see\n */\n"))
		it("5",                 () => test("/* asd\n * @emoji asd */",          "/* asd @emoji asd */\n"))
		it("6",                 () => test("/* asd\n * @ref asd */",            "/* asd @ref asd */\n"))
		it("7",                 () => test("/* asd\n * @em asd */",             "/* asd @em asd */\n"))
		it("8",                 () => test("/* asd\n * @a asd */",              "/* asd @a asd */\n"))
		it("9",                 () => test("/* asd\n * @f$ asd */",             "/* asd @f$ asd */\n"))
		it("10",                () => test("/* asd\n * @$ asd */",              "/* asd @$ asd */\n"))
		it("11",                () => test("/* asd\n * @:: asd */",             "/* asd @:: asd */\n"))
		it("12",                () => test("/* asd @ref asd */",                "/* asd @ref asd */\n"))
		it("13",                () => test("/* @ref @ref */",                   "/* @ref @ref */\n"))
		it("with indent",       () => test("\t/* @see asd */",                  "\t/* @see asd */\n"))
		it("with head-space 1", () => test("/*@ref asd */",                     "/* @ref asd */\n"))
		it("with head-space 2", () => test("/*@ref\n* asd */",                  "/* @ref asd */\n"))
		it("with head-space 3", () => test("/*@f$ */",                          "/* @f$ */\n"))
		it("with head-space 4", () => test("/**@f$ */",                         "/** @f$ */\n"))
		it("with tail-space 1", () => test("/* @ref asd*/",                     "/* @ref asd */\n"))
		it("with tail-space 2", () => test("/* @f$*/",                          "/* @f$ */\n"))
		it("with tail-space 3", () => test("/* @f$**/",                         "/* @f$ **/\n"))
		it("with prefix",       () => test("/** @ref asd */",                   "/** @ref asd */\n"))
		it("with suffix",       () => test("/* @ref asd **/",                   "/* @ref asd **/\n"))
		it("with leading",      () => test("/* @ref asd */ int x;",             "/* @ref asd */ int x;"))
		it("with trailing",     () => test("0; /* @ref asd */",                 "0; /* @ref asd */\n"))
		it("with embedded",     () => test("foo(/* @ref asd */ x)",             "foo(/* @ref asd */ x)"))
		it("with multiline 1",  () => test("/* @see asd\n * @see asd */",       "/*\n * @see asd\n * @see asd\n */\n"))
		it("with multiline 2",  () => test("/*\n * @ref asd\n * @ref asd\n */", "/* @ref asd @ref asd */\n"))
		it("with narrow 1",     () => test("/* @param asd asd */",              "/*\n * @param asd\n *        asd\n */\n", { lineWidth: 13 }))
		it("with narrow 2",     () => test("/* @param asd asd */",              "/*\n * @param asd\n *        asd\n */\n", { lineWidth: 12 }))
		it("with newline",      () => test("/* @ref asd\n *\n * @ref asd */",   "/*\n * @ref asd\n *\n * @ref asd\n */\n"))
		it("with bullet 1",     () => test("/* * @see asd */",                  "/* @see asd */\n"))
		it("with bullet 2",     () => test("/* * asd @see asd */",              "/*\n * * asd\n * @see asd\n */\n"))
		it("with bullet 3",     () => test("/* * @ref asd */",                  "/* * @ref asd */\n"))
		it("with bullet 4",     () => test("/* * asd @ref asd */",              "/* * asd @ref asd */\n"))
	})

	// Test empty
	describe("empty", () =>
	{
		it("1",               () => test("/* */",          ""))
		it("2",               () => test("/*\n*/",         ""))
		it("3",               () => test("0;\n/* */",      "0;\n"))
		it("4",               () => test("/* */\n0;",      "0;"))
		it("5",               () => test("0;\n/* */\n1;",  "0;\n1;"))
		it("6",               () => test("0;\n/*\n*/\n1;", "0;\n1;"))
		it("7",               () => test("/* */\n\t0;",    "\t0;"))
		it("8",               () => test("/* */\n\n0;",    "\n0;"))
		it("9",               () => test("0;\n\n/* */",    "0;\n\n"))
		it("with indent",     () => test("\t/* */",        ""))
		it("with head-space", () => test("/**/",           ""))
		it("with tail-space", () => test("/**/",           ""))
		it("with prefix 1",   () => test("/** */",         ""))
		it("with prefix 2",   () => test("/***/",          ""))
		it("with prefix 3",   () => test("/****/",         ""))
		it("with suffix 1",   () => test("/* **/",         ""))
		it("with suffix 2",   () => test("/*\n**/",        ""))
		it("with leading 1",  () => test("/**//**/",       ""))
		it("with leading 2",  () => test("/* */ int x;",   "int x;"))
		it("with trailing",   () => test("0; /* */",       "0;"))
		it("with embedded",   () => test("foo(/* */ x)",   "foo(x)"))
		it("with multiline",  () => test("/*\n */",        ""))
		it("with narrow",     () => test("/* */",          "", { lineWidth: 0 }))
		it("with bullet 1",   () => test("/* * */",        ""))
		it("with bullet 2",   () => test("/*\n * */",      ""))
		it("with newline",    () => test("/*\n *\n */",    ""))
		it("with doxygen",    () => test("/* @endcode */", "/* @endcode */\n"))
	})
})
