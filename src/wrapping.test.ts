import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { Position, Range, TextLine, Context, wrapText } from "./wrapping.js"

async function wrap(s: string, override?: Partial<Context>): Promise<string | string[]>
{
	const newLines : number[] = [ 0 ]
	for (var iChar = 0; iChar < s.length; ++iChar)
	{
		const c = s[iChar]
		if (c === '\n')
			newLines.push(iChar + 1)
	}
	newLines.push(s.length + 1)

	function getLine(iLine: number): TextLine
	{
		console.assert(iLine < newLines.length)

		const iBegin = newLines[iLine + 0]
		const iEnd   = newLines[iLine + 1]
		const text   = s.slice(iBegin, iEnd - 1)
		const begin  = new Position(iLine, 0)
		const end    = new Position(iLine, text.length)
		const range  = new Range(begin, end)

		const line : TextLine = { text, range }
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
	const begin      = new Position(0, 0)
	const end        = new Position(newLines.length - 2, newLines.at(-1))
	const selection  = new Range(begin, end)

	const ctx : Context = {
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

	const wrapped = await wrapText(ctx)
	return wrapped.length === 1 ? wrapped[0] : wrapped
}

async function test(original: string, expected: string | string[], override?: Partial<Context>)
{
	const actual = await wrap(original, override)

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

	// TODO: Try to put this in the reporter
	// Put it in the reporter if it works with the vscode test view
	// Otherwise put it in wrapping.test.ts

	// NOTE: We need to do something async so test results are flushed and can stream
	await new Promise(setImmediate)
}

describe("line comments", () =>
{
	// Test indentation
	describe("indent", () =>
	{
		it("1",  () => test("// asd",               "// asd"))
		it("2",  () => test(" // asd",              "// asd"))
		it("3",  () => test("   // asd",            "// asd"))
		it("4",  () => test("    // asd",           "\t// asd"))
		it("5",  () => test("     // asd",          "\t// asd"))
		it("6",  () => test("\t// asd",             "\t// asd"))
		it("7",  () => test("\t // asd",            "\t// asd"))
		it("8",  () => test("\t   // asd",          "\t// asd"))
		it("9",  () => test("\t    // asd",         "\t\t// asd"))
		it("10", () => test("\t     // asd",        "\t\t// asd"))
		it("11", () => test(" \t// asd",            "\t// asd"))
		it("12", () => test("   \t// asd",          "\t// asd"))
		it("13", () => test("    \t// asd",         "\t\t// asd"))
		it("14", () => test("     \t// asd",        "\t\t// asd"))
		it("15", () => test("  \t \t \t // asd",    "\t\t\t// asd"))
		it("16", () => test("  \t \t \t    // asd", "\t\t\t\t// asd"))
	})

	// Test whitespace at beginning of content (after prefix)
	describe("head-space", () =>
	{
		it("1",           () => test("//asd",      "// asd"))
		it("2",           () => test("// asd",     "// asd"))
		it("3",           () => test("//   asd",   "// asd"))
		it("4",           () => test("//    asd",  "// asd"))
		it("5",           () => test("//     asd", "// asd"))
		it("6",           () => test("//\tasd",    "// asd"))
		it("7",           () => test("// \tasd",   "// asd"))
		it("8",           () => test("//\t asd",   "// asd"))
		it("with/indent", () => test("\t//asd",    "\t// asd"))
	})

	// Test whitespace at end of content
	describe("tail-space", () =>
	{
		it("1",               () => test("// asd ",    "// asd"))
		it("2",               () => test("// asd\t",   "// asd"))
		it("3",               () => test("// asd \t ", "// asd"))
		it("with indent",     () => test("\t// asd ",  "\t// asd"))
		it("with head-space", () => test("//asd ",     "// asd"))
	})

	// Test custom prefix
	describe("prefix", () =>
	{
		it("1",               () => test("/// asd",   "/// asd"))
		it("2",               () => test("//* asd",   "//* asd"))
		it("3",               () => test("//! asd",   "//! asd"))
		it("4",               () => test("//< asd",   "//< asd"))
		it("5",               () => test("//*!< asd", "//*!< asd"))
		it("with indent",     () => test("\t/// asd", "\t/// asd"))
		it("with head-space", () => test("///asd",    "/// asd"))
		it("with tail-space", () => test("/// asd ",  "/// asd"))
	})

	// Test trailing
	describe("trailing", () =>
	{
		it("1",               () => test("0; // asd",         "// asd"))
		it("2",               () => test("0; // asd\n// asd", [ "// asd", "// asd" ]))
		it("with indent",     () => test("0;// asd",          "// asd"))
		it("with head-space", () => test("0; //asd",          "// asd"))
		it("with tail-space", () => test("0; // asd ",        "// asd"))
		it("with prefix",     () => test("0; /// asd",        "/// asd"))
	})

	// Test multi line
	describe("multiline", () =>
	{
		it("1",               () => test("// asd\n// asd",    "// asd asd"))
		it("2",               () => test("// asd\n// asd",    "// asd\n// asd",       { lineWidth: 6 }))
		it("3",               () => test("// asd\n\n// asd",  [ "// asd", "// asd" ]))
		it("with indent",     () => test("\t// asd\n// asd",  "\t// asd\n\t// asd",   { lineWidth: 6 }))
		it("with head-space", () => test("//asd\n// asd",     "// asd\n// asd",       { lineWidth: 6 }))
		it("with tail-space", () => test("// asd \n// asd ",  "// asd\n// asd",       { lineWidth: 6 }))
		it("with prefix",     () => test("/// asd\n// asd",   "/// asd\n/// asd",     { lineWidth: 6 }))
		it("with trailing",   () => test("0; // asd\n// asd", [ "// asd", "// asd" ]))
	})

	// Test narrow lines
	describe("narrow", () =>
	{
		it("1",               () => test("// asd",                 "// asd",                         { lineWidth: 0 }))
		it("2",               () => test("// asd asd",             "// asd\n// asd",                 { lineWidth: 0 }))
		it("with indent",     () => test("\t// asd asd",           "\t// asd\n\t// asd",             { lineWidth: 0 }))
		it("with head-space", () => test("//asd asd",              "// asd\n// asd",                 { lineWidth: 0 }))
		it("with tail-space", () => test("// asd asd ",            "// asd\n// asd",                 { lineWidth: 0 }))
		it("with prefix",     () => test("/// asd asd",            "/// asd\n/// asd",               { lineWidth: 0 }))
		it("with trailing",   () => test("0; // asd",              "// asd",                         { lineWidth: 0 }))
		it("with multiline",  () => test("// asd asd\n// asd asd", "// asd\n// asd\n// asd\n// asd", { lineWidth: 0 }))
	})

	// Test preserved newlines
	describe("newline", () =>
	{
		it("1",          () => test("// asd\n//\n//\n// asd",     "// asd\n//\n// asd"))
		it("2",          () => test("//\n// asd",                 "// asd"))
		it("3",          () => test("// asd\n//",                 "// asd"))
		it("4",          () => test("// asd\n// \n// asd",        "// asd\n//\n// asd"))
		it("5",          () => test("// asd\n//    \n// asd",     "// asd\n//\n// asd"))
		it("6",          () => test("// asd\n//\t\n// asd",       "// asd\n//\n// asd"))
		it("with indent",     () => test("\t// asd\n\t//\n\t// asd",   "\t// asd\n\t//\n\t// asd"))
		it("with head-space", () => test("//asd\n//\n//asd",           "// asd\n//\n// asd"))
		it("with tail-space", () => test("// asd \n// \n// asd ",      "// asd\n//\n// asd"))
		it("with prefix",     () => test("/// asd\n///\n/// asd",      "/// asd\n///\n/// asd"))
		it("with trailing",   () => test("0; // asd\n//\n// asd",      [ "// asd", "// asd" ]))
		it("with multiline",  () => test("// asd\n// asd\n//\n// asd", "// asd asd\n//\n// asd"))
		it("with narrow",     () => test("// asd asd\n//\n// asd asd", "// asd\n// asd\n//\n// asd\n// asd", { lineWidth: 0 }))
	})

	// Test preserved bullets
	describe("bullet", () =>
	{
		it("1",               () => test("// * asd",                  "// * asd"))
		it("2",               () => test("//  * asd",                 "//  * asd"))
		it("3",               () => test("//  - asd",                 "//  - asd"))
		it("4",               () => test("//  1. asd",                "//  1. asd"))
		it("5",               () => test("//  1) asd",                "//  1) asd"))
		it("6",               () => test("//   * asd",                "//   * asd"))
		it("7",               () => test("//    * asd",               "//    * asd"))
		it("8",               () => test("//     * asd",              "//     * asd"))
		it("9",               () => test("//\t* asd",                 "//  * asd", { tabWidth: 4 }))
		it("10",              () => test("// \t* asd",                "//  * asd", { tabWidth: 4 }))
		it("11",              () => test("//  * asd\n//  * asd",      "//  * asd\n//  * asd"))
		it("12",              () => test("//  * asd\n//    * asd",    "//  * asd\n//    * asd"))
		it("with indent",     () => test("\t//  * asd",               "\t//  * asd"))
		it("with head-space", () => test("//1. asd",                  "// 1. asd"))
		it("with tail-space", () => test("//  * asd ",                "//  * asd"))
		it("with prefix",     () => test("///  * asd",                "///  * asd"))
		it("with trailing",   () => test("0; //  * asd",              "//  * asd"))
		it("with multiline",  () => test("// asd\n//  * asd\n// asd", "// asd\n//  * asd asd"))
		it("with narrow 1",   () => test("//  * asd",                 "//  * asd",            { lineWidth: 0 }))
		it("with narrow 2",   () => test("//  * asd asd",             "//  * asd\n//    asd", { lineWidth: 0 }))
		it("with newline",    () => test("//  * asd\n//\n//  * asd",  "//  * asd\n//\n//  * asd"))
	})

	// Test preserved doxygen
	describe("doxygen", () =>
	{
		it("1",                 () => test("// asd\n// @see asd",          "// asd\n// @see asd"))
		it("2",                 () => test("// asd\n// \\see asd",         "// asd\n// \\see asd"))
		it("3",                 () => test("// asd\n// @ref asd",          "// asd @ref asd"))
		it("4",                 () => test("// asd\n// @em asd",           "// asd @em asd"))
		it("5",                 () => test("// asd\n// @a asd",            "// asd @a asd"))
		it("6",                 () => test("// asd\n// @f$ asd",           "// asd @f$ asd"))
		it("7",                 () => test("// asd\n// @$ asd",            "// asd @$ asd"))
		it("8",                 () => test("// asd\n// @:: asd",           "// asd @:: asd"))
		it("with indent",       () => test("\t// @see asd",                "\t// @see asd"))
		it("with head-space 1", () => test("//@ref asd",                   "// @ref asd"))
		it("with head-space 2", () => test("//@ref\n// asd",               "// @ref asd"))
		it("with tail-space",   () => test("// @ref asd ",                 "// @ref asd"))
		it("with prefix",       () => test("/// @ref asd",                 "/// @ref asd"))
		it("with trailing",     () => test("0; // @ref asd",               "// @ref asd"))
		it("with multiline 1",  () => test("// @see asd\n// @see asd",     "// @see asd\n// @see asd"))
		it("with multiline 2",  () => test("// @ref asd\n// @ref asd",     "// @ref asd @ref asd"))
		it("with narrow",       () => test("// @param asd asd",            "// @param asd\n//        asd", { lineWidth: 0 }))
		it("with newline",      () => test("// @ref asd\n//\n// @ref asd", "// @ref asd\n//\n// @ref asd"))
		it("with bullet",       () => test("// * @see asd",                "// * @see asd"))
	})

	// Test empty
	describe("empty", () =>
	{
		it("1",               () => test("//",          ""))
		it("with indent",     () => test("\t//\n\t//",  ""))
		it("with head-space", () => test("// ",         ""))
		it("with tail-space", () => test("// ",         ""))
		it("with prefix",     () => test("///",         ""))
		it("with trailing",   () => test("0; //",       ""))
		it("with multiline",  () => test("//\n//",      ""))
		it("with narrow",     () => test("//",          "", { lineWidth: 0 }))
		it("with bullet 1",   () => test("// *",        ""))
		it("with bullet 2",   () => test("// * ",       ""))
		it("with bullet 3",   () => test("//\n// * ",   ""))
		it("with newline",    () => test("//\n//\n//",  ""))
		it("with doxygen",    () => test("// @endcode", "// @endcode"))
	})
})



describe("block comments", () =>
{
	// Test indentation
	describe("indent", () =>
	{
		it("1", () => test("   /* asd */",      "/* asd */"))
		it("2", () => test("\t/* asd */",       "\t/* asd */"))
		it("3", () => test("    \t/* asd */",   "\t\t/* asd */"))
		it("4", () => test("/*\n\tasd\n\t\t*/", "/* asd */"))
	})

	// Test whitespace at beginning of content (after prefix)
	describe("head-space", () =>
	{
		it("1",      () => test("/*asd */",   "/* asd */"))
		it("2",      () => test("/*  asd */", "/* asd */"))
		it("3",      () => test("/*\tasd */", "/* asd */"))
		it("with indent", () => test("\t/*asd */", "\t/* asd */"))
	})

	// Test whitespace at end of content (before suffix)
	describe("tail-space", () =>
	{
		it("1",               () => test("/* asd*/",     "/* asd */"))
		it("2",               () => test("/* asd\t*/",   "/* asd */"))
		it("3",               () => test("/* asd \t */", "/* asd */"))
		it("with indent",     () => test("\t/* asd*/",   "\t/* asd */"))
		it("with head-space", () => test("/*asd*/",      "/* asd */"))
	})

	// Test custom prefix
	describe("prefix", () =>
	{
		it("1",               () => test("/** asd */",           "/** asd */"))
		it("2",               () => test("/*! asd */",           "/*! asd */"))
		it("3",               () => test("/*< asd */",           "/*< asd */"))
		it("4",               () => test("/**!< asd */",         "/**!< asd */"))
		it("5",               () => test("/* asd\nasd\n */",     "/*\n * asd\n * asd\n */",  { lineWidth: 0 }))
		it("6",               () => test("/** asd\n * asd\n */", "/**\n * asd\n * asd\n */", { lineWidth: 0 }))
		it("with indent",     () => test("\t/** asd */",         "\t/** asd */"))
		it("with head-space", () => test("/**asd */",            "/** asd */"))
		it("with tail-space", () => test("/** asd*/",            "/** asd */"))
	})

	// Test custom suffix
	describe("suffix", () =>
	{
		it("1",               () => test("/* asd **/",   "/* asd **/"))
		it("2",               () => test("/* asd !*/",   "/* asd !*/"))
		it("3",               () => test("/* asd <*/",   "/* asd <*/"))
		it("4",               () => test("/* asd *!<*/", "/* asd *!<*/"))
		it("with indent",     () => test("\t/* asd **/", "\t/* asd **/"))
		it("with head-space", () => test("/*asd **/",    "/* asd **/"))
		it("with tail-space", () => test("/* asd**/",    "/* asd **/"))
		it("with prefix",     () => test("/** asd **/",  "/** asd **/"))
	})

	// Test leading
	describe("leading", () =>
	{
		it("1",               () => test("/* asd */ int x;",   "/* asd */"))
		it("with indent",     () => test("\t/* asd */ int x;", "\t/* asd */"))
		it("with head-space", () => test("/*asd */ int x;",    "/* asd */"))
		it("with tail-space", () => test("/* asd*/ int x;",    "/* asd */"))
		it("with prefix",     () => test("/** asd */ int x;",  "/** asd */"))
		it("with suffix",     () => test("/* asd **/ int x;",  "/* asd **/"))
	})

	// Test trailing
	describe("trailing", () =>
	{
		it("1",               () => test("0; /* asd */",  "/* asd */"))
		it("with indent",     () => test("0;/* asd */",   "/* asd */"))
		it("with head-space", () => test("0; /*asd */",   "/* asd */"))
		it("with tail-space", () => test("0; /* asd*/",   "/* asd */"))
		it("with prefix",     () => test("0; /** asd */", "/** asd */"))
		it("with suffix",     () => test("0; /* asd **/", "/* asd **/"))
	})

	// Test embedded
	describe("embedded", () =>
	{
		it("1",               () => test("foo(/* asd */ x);",   "/* asd */"))
		it("with indent",     () => test("foo(\t/* asd */ x);", "/* asd */"))
		it("with head-space", () => test("foo(/*asd */ x);",    "/* asd */"))
		it("with tail-space", () => test("foo(/* asd*/ x);",    "/* asd */"))
		it("with prefix",     () => test("foo(/** asd */ x);",  "/** asd */"))
		it("with suffix",     () => test("foo(/* asd **/ x);",  "/* asd **/"))
	})

	// Test multi line
	describe("multiline", () =>
	{
		it("1",               () => test("/*\n * asd\n * asd\n */",         "/* asd asd */"))
		it("2",               () => test("/*\n * asd\n * asd\n */",         "/*\n * asd\n * asd\n */",         { lineWidth: 6 }))
		it("3",               () => test("/*\n * asd\n\n*/",                "/* asd */"))
		it("with indent",     () => test("\t/*\n\t * asd\n\t * asd\n\t */", "\t/*\n\t * asd\n\t * asd\n\t */", { lineWidth: 6 }))
		it("with head-space", () => test("/*\n*asd\n*asd\n*/",              "/*\n * asd\n * asd\n */",         { lineWidth: 6 }))
		it("with tail-space", () => test("/*\n * asd \n * asd*/",           "/*\n * asd\n * asd\n */",         { lineWidth: 6 }))
		it("with prefix",     () => test("/**\n ** asd\n ** asd */",        "/**\n ** asd\n ** asd\n */",      { lineWidth: 6 }))
		it("with suffix",     () => test("/*\n * asd\n **/",                "/*\n * asd\n **/",                { lineWidth: 6 }))
		//it("with leading",    () => test("/*\n * asd\n */ int x;",          "")) // TODO: What should we do here?
		//it("with trailing",   () => test("0; /*\n * asd\n */",              "")) // TODO: What should we do here?
		//it("with embedded",   () => test("foo(/*\n * asd\n */ x);",         "")) // TODO: What should we do here?
	})

	// Test narrow lines
	describe("narrow", () =>
	{
		it("1",               () => test("/* asd */",                 "/* asd */",                               { lineWidth: 9 }))
		it("2",               () => test("/* asd */",                 "/*\n * asd\n */",                         { lineWidth: 8 }))
		it("3",               () => test("/* asd asd */",             "/*\n * asd\n * asd\n */",                 { lineWidth: 0 }))
		it("with indent",     () => test("\t/* asd asd */",           "\t/*\n\t * asd\n\t * asd\n\t */",         { lineWidth: 0 }))
		it("with head-space", () => test("/*asd asd */",              "/*\n * asd\n * asd\n */",                 { lineWidth: 0 }))
		it("with tail-space", () => test("/* asd asd*/",              "/*\n * asd\n * asd\n */",                 { lineWidth: 0 }))
		it("with prefix",     () => test("/** asd asd */",            "/**\n * asd\n * asd\n */",                { lineWidth: 0 }))
		it("with suffix",     () => test("/* asd asd **/",            "/*\n * asd\n * asd\n **/",                { lineWidth: 0 }))
		it("with leading",    () => test("/* asd */ int x;",          "/* asd */",                               { lineWidth: 0 }))
		it("with trailing",   () => test("0; /* asd */",              "/* asd */",                               { lineWidth: 0 }))
		it("with embedded",   () => test("foo(/* asd */ x);",         "/* asd */",                               { lineWidth: 0 }))
		it("with multiline",  () => test("/* asd asd\n * asd asd */", "/*\n * asd\n * asd\n * asd\n * asd\n */", { lineWidth: 0 }))
	})

	// Test preserved newlines
	describe("newline", () =>
	{
		it("1",               () => test("/* asd\n *\n *\n * asd */",     "/*\n * asd\n *\n * asd\n */"))
		it("2",               () => test("/*\n *\n * asd */",             "/* asd */"))
		it("3",               () => test("/* asd\n *\n */",               "/* asd */"))
		it("4",               () => test("/* asd\n * \n * asd */",        "/*\n * asd\n *\n * asd\n */"))
		it("5",               () => test("/* asd\n *    \n * asd */",     "/*\n * asd\n *\n * asd\n */"))
		it("6",               () => test("/* asd\n *\t\n * asd */",       "/*\n * asd\n *\n * asd\n */"))
		it("with indent",     () => test("\t/* asd\n\t *\n\t * asd */",   "\t/*\n\t * asd\n\t *\n\t * asd\n\t */"))
		it("with head-space", () => test("/*asd\n *\n *asd*/",            "/*\n * asd\n *\n * asd\n */"))
		it("with tail-space", () => test("/* asd \n * \n * asd \n */ ",   "/*\n * asd\n *\n * asd\n */"))
		it("with prefix",     () => test("/** asd\n ** \n ** asd\n */",   "/**\n ** asd\n **\n ** asd\n */"))
		it("with suffix",     () => test("/* asd\n *\n * asd **/",        "/*\n * asd\n *\n * asd\n **/"))
		//it("with leading",    () => test("/* asd\n *\n * asd */ int x;",  "")) // TODO: What should we do here?
		//it("with trailing",   () => test("0; / asd\n *\n * asd */",       "")) // TODO: What should we do here?
		//it("with embedded",   () => test("foo(/* asd\n *\n * asd */ x)",  "")) // TODO: What should we do here?
		it("with multiline",  () => test("/*\n * asd\n *\n * asd\n */",   "/*\n * asd\n *\n * asd\n */"))
		it("with narrow",     () => test("/* asd asd\n *\n * asd asd */", "/*\n * asd\n * asd\n *\n * asd\n * asd\n */", { lineWidth: 0 }))
	})

	// Test preserved bullets
	describe("bullet", () =>
	{
		it("1",               () => test("/* * asd */",                  "/* * asd */"))
		it("2",               () => test("/* - asd */",                  "/* - asd */"))
		it("3",               () => test("/* 1. asd */",                 "/* 1. asd */"))
		it("4",               () => test("/* 1) asd */",                 "/* 1) asd */"))
		it("5",               () => test("/*  * asd */",                 "/*  * asd */"))
		it("6",               () => test("/*\t* asd */",                 "/*  * asd */", { tabWidth: 4 }))
		it("7",               () => test("/* \t* asd */",                "/*  * asd */", { tabWidth: 4 }))
		it("8",               () => test("/*  * asd\n *  * asd */",      "/*\n *  * asd\n *  * asd\n */"))
		it("9",               () => test("/*  * asd\n *    * asd */",    "/*\n *  * asd\n *    * asd\n */"))
		it("with indent",     () => test("\t/*  * asd */",               "\t/*  * asd */"))
		it("with head-space", () => test("/*1. asd */",                  "/* 1. asd */"))
		it("with tail-space", () => test("/*  * asd */ ",                "/*  * asd */"))
		it("with prefix",     () => test("/**  * asd */",                "/**  * asd */"))
		it("with leading",    () => test("/*  * asd */ int x;",          "/*  * asd */"))
		it("with trailing",   () => test("0; /*  * asd */",              "/*  * asd */"))
		it("with embedded",   () => test("foo(/*  * asd */ x)",          "/*  * asd */"))
		it("with multiline",  () => test("/*\n *  * asd\n */",           "/*  * asd */"))
		it("with narrow 1",   () => test("/*  * asd */",                 "/*\n *  * asd\n */",            { lineWidth: 0 }))
		it("with narrow 2",   () => test("/*  * asd asd */",             "/*\n *  * asd\n *    asd\n */", { lineWidth: 0 }))
		it("with newline",    () => test("/*  * asd\n *\n *  * asd */",  "/*\n *  * asd\n *\n *  * asd\n */"))
	})

	// TODO: If section commands aren't already on a new line I don't think they will get detected
	// and moved to one.

	// TODO: I don't think bullet + doxygen will be handled correctly
	// TODO: \emoji

	// Inline  - link/endlink, anchor, cite, ref, em, a, b, c, e, n, p, f$
	// Section - everything else

	// Test preserved doxygen
	describe("doxygen", () =>
	{
		it("1",                 () => test("/* asd\n * @see asd */",            "/*\n * asd\n * @see asd\n */"))
		it("2",                 () => test("/* asd\n * \\see asd */",           "/*\n * asd\n * \\see asd\n */"))
		it("3",                 () => test("/* asd\n * @ref asd */",            "/* asd @ref asd */"))
		it("4",                 () => test("/* asd\n * @em asd */",             "/* asd @em asd */"))
		it("5",                 () => test("/* asd\n * @a asd */",              "/* asd @a asd */"))
		it("6",                 () => test("/* asd\n * @f$ asd */",             "/* asd @f$ asd */"))
		it("7",                 () => test("/* asd\n * @$ asd */",              "/* asd @$ asd */"))
		it("8",                 () => test("/* asd\n * @:: asd */",             "/* asd @:: asd */"))
		it("with indent",       () => test("\t/* @see asd */",                  "\t/* @see asd */"))
		it("with head-space 1", () => test("/*@ref asd */",                     "/* @ref asd */"))
		it("with head-space 2", () => test("/*@ref\n* asd */",                  "/* @ref asd */"))
		it("with tail-space",   () => test("/* @ref asd*/",                     "/* @ref asd */"))
		it("with prefix",       () => test("/** @ref asd */",                   "/** @ref asd */"))
		it("with leading",      () => test("/* @ref asd */ int x;",             "/* @ref asd */"))
		it("with trailing",     () => test("0; /* @ref asd */",                 "/* @ref asd */"))
		it("with embedded",     () => test("foo(/* @ref asd */ x)",             "/* @ref asd */"))
		it("with multiline 1",  () => test("/* @see asd\n * @see asd */",       "/*\n * @see asd\n * @see asd\n */"))
		it("with multiline 2",  () => test("/*\n * @ref asd\n * @ref asd\n */", "/* @ref asd @ref asd */"))
		it("with narrow",       () => test("/* @param asd asd */",              "/*\n * @param asd\n *        asd\n */", { lineWidth: 0 }))
		it("with newline",      () => test("/* @ref asd\n *\n * @ref asd */",   "/*\n * @ref asd\n *\n * @ref asd\n */"))
		it("with bullet",       () => test("/* * @see asd */",                  "/* * @see asd */"))
	})

	// TODO: Prefix and suffix are tokenized incorrectly for several of these, even though it doesn't
	// end up mattering. Should we fix this?

	// Test empty
	describe("empty", () =>
	{
		it("1",               () => test("/* */",          ""))
		it("with indent",     () => test("\t/* */",        ""))
		it("with head-space", () => test("/**/",           ""))
		it("with tail-space", () => test("/**/",           ""))
		it("with prefix 1",   () => test("/** */",         ""))
		it("with prefix 2",   () => test("/***/",          ""))
		it("with suffix",     () => test("/* **/",         ""))
		it("with leading",    () => test("/* */ int x;",   ""))
		it("with trailing",   () => test("0; /* */",       ""))
		it("with embedded",   () => test("foo(/* */ x)",   ""))
		it("with multiline",  () => test("/*\n */",        ""))
		it("with narrow",     () => test("/* */",          "", { lineWidth: 0 }))
		it("with bullet 1",   () => test("/* * */",        ""))
		it("with bullet 2",   () => test("/*\n/* */",      ""))
		it("with newline",    () => test("/*\n *\n */",    ""))
		it("with doxygen",    () => test("/* @endcode */", "/* @endcode */"))
	})
})

// TODO: Enable more linting
// TODO: Delay error lens visuals
// TODO: Keybindings for tests
// test current line, file, project, solution
// test and debug current line, file, project, solution
// rerun failed tests
// TODO: Custom test reporter
