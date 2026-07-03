import { describe, it } from "node:test"
import assert from "node:assert/strict"
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

	const languageId = "cpp"
	const begin      = new Position(0, 0)
	const end        = new Position(newLines.length - 2, newLines.at(-1))
	const selection  = new Range(begin, end)

	const ctx : Context = {
		tabSize    : override?.tabSize ?? 4,
		useSpaces  : override?.useSpaces ?? false,
		lineWidth  : override?.lineWidth ?? 60,
		languageId : override?.languageId ?? languageId,
		selections : override?.selections ?? [ selection ],
		getText    : () => s,
		getLine    : getLine,
		onError    : console.log,
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
}

describe("wrapping - line comments", () =>
{
	// Test indentation
	it("indent 1",  () => test("// asd",               "// asd"))
	it("indent 2",  () => test(" // asd",              "// asd"))
	it("indent 3",  () => test("   // asd",            "// asd"))
	it("indent 4",  () => test("    // asd",           "\t// asd"))
	it("indent 5",  () => test("     // asd",          "\t// asd"))
	it("indent 6",  () => test("\t// asd",             "\t// asd"))
	it("indent 7",  () => test("\t // asd",            "\t// asd"))
	it("indent 8",  () => test("\t   // asd",          "\t// asd"))
	it("indent 9",  () => test("\t    // asd",         "\t\t// asd"))
	it("indent 10", () => test("\t     // asd",        "\t\t// asd"))
	it("indent 11", () => test(" \t// asd",            "\t// asd"))
	it("indent 12", () => test("   \t// asd",          "\t// asd"))
	it("indent 13", () => test("    \t// asd",         "\t\t// asd"))
	it("indent 14", () => test("     \t// asd",        "\t\t// asd"))
	it("indent 15", () => test("  \t \t \t // asd",    "\t\t\t// asd"))
	it("indent 16", () => test("  \t \t \t    // asd", "\t\t\t\t// asd"))

	// Test whitespace at beginning of content (after prefix)
	it("head-space 1",      () => test("//asd",      "// asd"))
	it("head-space 2",      () => test("// asd",     "// asd"))
	it("head-space 3",      () => test("//   asd",   "// asd"))
	it("head-space 4",      () => test("//    asd",  "// asd"))
	it("head-space 5",      () => test("//     asd", "// asd"))
	it("head-space 6",      () => test("//\tasd",    "// asd"))
	it("head-space 7",      () => test("// \tasd",   "// asd"))
	it("head-space 8",      () => test("//\t asd",   "// asd"))
	it("head-space/indent", () => test("\t//asd",    "\t// asd"))

	// Test whitespace at end of content
	it("tail-space 1",          () => test("// asd ",    "// asd"))
	it("tail-space 2",          () => test("// asd\t",   "// asd"))
	it("tail-space 3",          () => test("// asd \t ", "// asd"))
	it("tail-space/indent",     () => test("\t// asd ",  "\t// asd"))
	it("tail-space/head-space", () => test("//asd ",     "// asd"))

	// Test custom prefix
	it("prefix 1",          () => test("/// asd",   "/// asd"))
	it("prefix 2",          () => test("//* asd",   "//* asd"))
	it("prefix 3",          () => test("//! asd",   "//! asd"))
	it("prefix 4",          () => test("//< asd",   "//< asd"))
	it("prefix 5",          () => test("//*!< asd", "//*!< asd"))
	it("prefix/indent",     () => test("\t/// asd", "\t/// asd"))
	it("prefix/head-space", () => test("///asd",    "/// asd"))
	it("prefix/tail-space", () => test("/// asd ",  "/// asd"))

	// Test trailing
	it("trailing 1",          () => test("0; // asd",         "// asd"))
	it("trailing 2",          () => test("0; // asd\n// asd", [ "// asd", "// asd" ]))
	it("trailing/indent",     () => test("0;// asd",          "// asd"))
	it("trailing/head-space", () => test("0; //asd",          "// asd"))
	it("trailing/tail-space", () => test("0; // asd ",        "// asd"))
	it("trailing/prefix",     () => test("0; /// asd",        "/// asd"))

	// Test multi line
	it("multiline 1",          () => test("// asd\n// asd",    "// asd asd"))
	it("multiline 2",          () => test("// asd\n// asd",    "// asd\n// asd",       { lineWidth: 6 }))
	it("multiline 3",          () => test("// asd\n\n// asd",  [ "// asd", "// asd" ]))
	it("multiline/indent",     () => test("\t// asd\n// asd",  "\t// asd\n\t// asd",   { lineWidth: 6 }))
	it("multiline/head-space", () => test("//asd\n// asd",     "// asd\n// asd",       { lineWidth: 6 }))
	it("multiline/tail-space", () => test("// asd \n// asd ",  "// asd\n// asd",       { lineWidth: 6 }))
	it("multiline/prefix",     () => test("/// asd\n// asd",   "/// asd\n/// asd",     { lineWidth: 6 }))
	it("multiline/trailing",   () => test("0; // asd\n// asd", [ "// asd", "// asd" ]))

	// Test narrow lines
	it("narrow 1",          () => test("// asd",                 "// asd",                         { lineWidth: 0 }))
	it("narrow 2",          () => test("// asd asd",             "// asd\n// asd",                 { lineWidth: 0 }))
	it("narrow/multiline",  () => test("// asd asd\n// asd asd", "// asd\n// asd\n// asd\n// asd", { lineWidth: 0 }))
	it("narrow/indent",     () => test("\t// asd asd",           "\t// asd\n\t// asd",             { lineWidth: 0 }))
	it("narrow/head-space", () => test("//asd asd",              "// asd\n// asd",                 { lineWidth: 0 }))
	it("narrow/tail-space", () => test("// asd asd ",            "// asd\n// asd",                 { lineWidth: 0 }))
	it("narrow/prefix",     () => test("/// asd asd",            "/// asd\n/// asd",               { lineWidth: 0 }))
	it("narrow/trailing",   () => test("0; // asd",              "// asd",                         { lineWidth: 0 }))

	// Test preserved newlines
	it("newline 1",          () => test("// asd\n//\n//\n// asd",     "// asd\n//\n// asd"))
	it("newline 2",          () => test("//\n// asd",                 "// asd"))
	it("newline 3",          () => test("// asd\n//",                 "// asd"))
	it("newline 4",          () => test("// asd\n// \n// asd",        "// asd\n//\n// asd"))
	it("newline 5",          () => test("// asd\n//    \n// asd",     "// asd\n//\n// asd"))
	it("newline 6",          () => test("// asd\n//\t\n// asd",       "// asd\n//\n// asd"))
	it("newline/multiline",  () => test("// asd\n// asd\n//\n// asd", "// asd asd\n//\n// asd"))
	it("newline/indent",     () => test("\t// asd\n\t//\n\t// asd",   "\t// asd\n\t//\n\t// asd"))
	it("newline/head-space", () => test("//asd\n//\n//asd",           "// asd\n//\n// asd"))
	it("newline/tail-space", () => test("// asd \n// \n// asd ",      "// asd\n//\n// asd"))
	it("newline/prefix",     () => test("/// asd\n///\n/// asd",      "/// asd\n///\n/// asd"))
	it("newline/trailing",   () => test("0; // asd\n//\n// asd",      [ "// asd", "// asd" ]))
	it("newline/narrow",     () => test("// asd asd\n//\n// asd asd", "// asd\n// asd\n//\n// asd\n// asd", { lineWidth: 0 }))

	// Test preserved bullets
	it("bullet 1",            () => test("// * asd",                  "// * asd"))
	it("bullet 2",            () => test("//  * asd",                 "//  * asd"))
	it("bullet 3",            () => test("//  - asd",                 "//  - asd"))
	it("bullet 4",            () => test("//  1. asd",                "//  1. asd"))
	it("bullet 5",            () => test("//  1) asd",                "//  1) asd"))
	it("bullet 6",            () => test("//   * asd",                "//   * asd"))
	it("bullet 7",            () => test("//    * asd",               "//    * asd"))
	it("bullet 8",            () => test("//     * asd",              "//     * asd"))
	it("bullet 9",            () => test("//\t* asd",                 "//  * asd"))
	it("bullet 10",           () => test("// \t* asd",                "//  * asd"))
	it("bullet 11",           () => test("//  * asd\n//  * asd",      "//  * asd\n//  * asd"))
	it("bullet 12",           () => test("//  * asd\n//    * asd",    "//  * asd\n//    * asd"))
	it("bullet/multiline",    () => test("// asd\n//  * asd\n// asd", "// asd\n//  * asd asd"))
	it("bullet/indent",       () => test("\t//  * asd",               "\t//  * asd"))
	it("bullet/head-space 1", () => test("//* asd",                   "//* asd"))
	it("bullet/head-space 2", () => test("//1. asd",                  "// 1. asd"))
	it("bullet/tail-space",   () => test("//  * asd ",                "//  * asd"))
	it("bullet/prefix",       () => test("///  * asd",                "///  * asd"))
	it("bullet/trailing",     () => test("0; //  * asd",              "//  * asd"))
	it("bullet/narrow 1",     () => test("//  * asd",                 "//  * asd",            { lineWidth: 0 }))
	it("bullet/narrow 2",     () => test("//  * asd asd",             "//  * asd\n//    asd", { lineWidth: 0 }))
	it("bullet/newline",      () => test("//  * asd\n//\n//  * asd",  "//  * asd\n//\n//  * asd"))

	// Test preserved doxygen
	it("doxygen 1",            () => test("// asd\n// @see asd",          "// asd\n// @see asd"))
	it("doxygen 2",            () => test("// asd\n// \\see asd",         "// asd\n// \\see asd"))
	it("doxygen 3",            () => test("// asd\n// @ref asd",          "// asd @ref asd"))
	it("doxygen 4",            () => test("// asd\n// @em asd",           "// asd @em asd"))
	it("doxygen 5",            () => test("// asd\n// @a asd",            "// asd @a asd"))
	it("doxygen 6",            () => test("// asd\n// @f$ asd",           "// asd @f$ asd"))
	it("doxygen 7",            () => test("// asd\n// @$ asd",            "// asd @$ asd"))
	it("doxygen 8",            () => test("// asd\n// @:: asd",           "// asd @:: asd"))
	it("doxygen/multiline 1",  () => test("// @see asd\n// @see asd",     "// @see asd\n// @see asd"))
	it("doxygen/multiline 2",  () => test("// @ref asd\n// @ref asd",     "// @ref asd @ref asd"))
	it("doxygen/indent",       () => test("\t// @see asd",                "\t// @see asd"))
	it("doxygen/head-space 1", () => test("//@ref asd",                   "// @ref asd"))
	it("doxygen/head-space 2", () => test("//@ref\n// asd",               "// @ref asd"))
	it("doxygen/tail-space",   () => test("// @ref asd ",                 "// @ref asd"))
	it("doxygen/prefix",       () => test("/// @ref asd",                 "/// @ref asd"))
	it("doxygen/trailing",     () => test("0; // @ref asd",               "// @ref asd"))
	it("doxygen/narrow",       () => test("// @param asd asd",            "// @param asd\n//        asd", { lineWidth: 0 }))
	it("doxygen/newline",      () => test("// @ref asd\n//\n// @ref asd", "// @ref asd\n//\n// @ref asd"))
	it("doxygen/bullet",       () => test("// * @see asd",                "// * @see asd"))

	// Test empty
	it("empty",            () => test("//",          ""))
	it("empty/multiline",  () => test("//\n//",      ""))
	it("empty/indent",     () => test("\t//\n\t//",  ""))
	it("empty/head-space", () => test("// ",         ""))
	it("empty/tail-space", () => test("// ",         ""))
	it("empty/prefix",     () => test("///",         ""))
	it("empty/trailing",   () => test("0; //",       ""))
	it("empty/narrow",     () => test("//",          "", { lineWidth: 0 }))
	it("empty/bullet 1",   () => test("// *",        ""))
	it("empty/bullet 2",   () => test("// * ",       ""))
	it("empty/bullet 3",   () => test("//\n// * ",   ""))
	it("empty/newline",    () => test("//\n//\n//",  ""))
	it("empty/doxygen",    () => test("// @endcode", "// @endcode"))
})



describe("wrapping - block comments", () =>
{
	// Test indentation
	it("indent 1", () => test("   /* asd */",      "/* asd */"))
	it("indent 2", () => test("\t/* asd */",       "\t/* asd */"))
	it("indent 3", () => test("    \t/* asd */",   "\t\t/* asd */"))
	it("indent 4", () => test("/*\n\tasd\n\t\t*/", "/* asd */"))

	// Test whitespace at beginning of content (after prefix)
	it("head-space 1",      () => test("/*asd */",   "/* asd */"))
	it("head-space 2",      () => test("/*  asd */", "/* asd */"))
	it("head-space 3",      () => test("/*\tasd */", "/* asd */"))
	it("head-space/indent", () => test("\t/*asd */", "\t/* asd */"))

	// Test whitespace at end of content (before suffix)
	it("tail-space 1",          () => test("/* asd*/",     "/* asd */"))
	it("tail-space 2",          () => test("/* asd\t*/",   "/* asd */"))
	it("tail-space 3",          () => test("/* asd \t */", "/* asd */"))
	it("tail-space/indent",     () => test("\t/* asd*/",   "\t/* asd */"))
	it("tail-space/head-space", () => test("/*asd*/",      "/* asd */"))

	// Test custom prefix
	it("prefix 1",          () => test("/** asd */",           "/** asd */"))
	it("prefix 2",          () => test("/*! asd */",           "/*! asd */"))
	it("prefix 3",          () => test("/*< asd */",           "/*< asd */"))
	it("prefix 4",          () => test("/**!< asd */",         "/**!< asd */"))
	it("prefix 5",          () => test("/* asd\nasd\n */",     "/*\n * asd\n * asd\n */",  { lineWidth: 0 }))
	it("prefix 6",          () => test("/** asd\n * asd\n */", "/**\n * asd\n * asd\n */", { lineWidth: 0 }))
	it("prefix/indent",     () => test("\t/** asd */",         "\t/** asd */"))
	it("prefix/head-space", () => test("/**asd */",            "/** asd */"))
	it("prefix/tail-space", () => test("/** asd*/",            "/** asd */"))

	// Test custom suffix
	it("suffix 1",          () => test("/* asd **/",   "/* asd **/"))
	it("suffix 2",          () => test("/* asd !*/",   "/* asd !*/"))
	it("suffix 3",          () => test("/* asd <*/",   "/* asd <*/"))
	it("suffix 4",          () => test("/* asd *!<*/", "/* asd *!<*/"))
	it("suffix/indent",     () => test("\t/* asd **/", "\t/* asd **/"))
	it("suffix/head-space", () => test("/*asd **/",    "/* asd **/"))
	it("suffix/tail-space", () => test("/* asd**/",    "/* asd **/"))
	it("suffix/prefix",     () => test("/** asd **/",  "/** asd **/"))

	// Test leading
	// TODO: Add tests

	// Test trailing
	it("trailing",            () => test("0; /* asd */",  "/* asd */"))
	it("trailing/indent",     () => test("0;/* asd */",   "/* asd */"))
	it("trailing/head-space", () => test("0; /*asd */",   "/* asd */"))
	it("trailing/tail-space", () => test("0; /* asd*/",   "/* asd */"))
	it("trailing/prefix",     () => test("0; /** asd */", "/** asd */"))
	it("trailing/suffix",     () => test("0; /* asd **/", "/* asd **/"))
	// TODO: Multi-line?

	// Test embedded
	it("embedded",            () => test("foo(/* asd */ x);",   "/* asd */"))
	it("embedded/indent",     () => test("foo(\t/* asd */ x);", "/* asd */"))
	it("embedded/head-space", () => test("foo(/*asd */ x);",    "/* asd */"))
	it("embedded/tail-space", () => test("foo(/* asd*/ x);",    "/* asd */"))
	it("embedded/prefix",     () => test("foo(/** asd */ x);",  "/** asd */"))
	it("embedded/suffix",     () => test("foo(/* asd **/ x);",  "/* asd **/"))
	it("embedded/trailing",   () => test("foo(/* asd */ x);",   "/* asd */"))
	// TODO: Multi-line?

	// Test multi line
	it("multiline 1",          () => test("/* asd\n * asd\n */",     "/* asd asd */"))
	it("multiline 2",          () => test("/* asd\n * asd\n */",     "/*\n * asd\n * asd\n */",         { lineWidth: 6 }))
	it("multiline 3",          () => test("/* asd\n\n*/",            "/* asd */"))
	it("multiline/indent",     () => test("\t/* asd\n* asd\n*/",     "\t/*\n\t * asd\n\t * asd\n\t */", { lineWidth: 6 }))
	it("multiline/head-space", () => test("/*asd\n *asd\n*/",        "/*\n * asd\n * asd\n */",         { lineWidth: 6 }))
	it("multiline/tail-space", () => test("/* asd \n * asd \n*/",    "/*\n * asd\n * asd\n */",         { lineWidth: 6 }))
	it("multiline/prefix",     () => test("/** asd\n ** asd */",     "/**\n ** asd\n ** asd\n */",      { lineWidth: 6 }))
	it("multiline/suffix",     () => test("/* asd\n * asd **/",      "/*\n * asd\n * asd\n **/",        { lineWidth: 6 }))
	it("multiline/trailing",   () => test("0; /* asd */\n/* asd */", [ "/* asd */", "/* asd */" ]))

	// Test narrow lines
	it("narrow 1",          () => test("/* asd */",                 "/* asd */",                               { lineWidth: 0 }))
	it("narrow 2",          () => test("/* asd asd */",             "/*\n * asd\n * asd\n */",                 { lineWidth: 0 }))
	it("narrow/multiline",  () => test("/* asd asd\n * asd asd */", "/*\n * asd\n * asd\n * asd\n * asd\n */", { lineWidth: 0 }))
	it("narrow/indent",     () => test("\t/* asd asd */",           "\t/*\n\t * asd\n\t * asd\n\t */",         { lineWidth: 0 }))
	it("narrow/head-space", () => test("/*asd asd */",              "/*\n * asd\n * asd\n */",                 { lineWidth: 0 }))
	it("narrow/tail-space", () => test("/* asd asd*/",              "/*\n * asd\n * asd\n */",                 { lineWidth: 0 }))
	it("narrow/prefix",     () => test("/** asd asd */",            "/**\n * asd\n * asd\n */",                { lineWidth: 0 }))
	it("narrow/suffix",     () => test("/* asd asd **/",            "/*\n * asd\n * asd\n **/",                { lineWidth: 0 }))
	it("narrow/trailing",   () => test("0; /* asd */",              "/* asd */",                               { lineWidth: 0 }))

	// Test preserved newlines
	// Test preserved bullets
	// Test preserved doxygen

	// Test empty
	it("empty",            () => test("/* */",          ""))
	it("empty/indent",     () => test("\t/* */",        ""))
	it("empty/head-space", () => test("/**/",           ""))
	it("empty/tail-space", () => test("/**/",           ""))
	it("empty/prefix 1",   () => test("/** */",         ""))
	it("empty/prefix 2",   () => test("/***/",          ""))
	it("empty/suffix",     () => test("/* **/",         ""))
	it("empty/trailing",   () => test("0; /* */",       ""))
	it("empty/narrow",     () => test("/* */",          "", { lineWidth: 0 }))
	it("empty/bullet 1",   () => test("/* * */",        ""))
	it("empty/bullet 2",   () => test("/*\n/* */",      ""))
	it("empty/newline 1",  () => test("/*\n */",        ""))
	it("empty/newline 2",  () => test("/*\n *\n */",    ""))
	it("empty/doxygen",    () => test("/* @endcode */", "/*\n * @endcode\n */"))
})

// TODO: Compile before running tests (currently leaning on the watch script)
// TODO: Delay error lens visuals
// TODO: Keybindings for tests
// test current line, file, project, solution
// test and debug current line, file, project, solution
// rerun failed tests
// TODO: Show line numbers for .ts file instead of .js
// TODO: Custom test reporter
