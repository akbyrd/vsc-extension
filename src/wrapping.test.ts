import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Position, Range, TextLine, Context, wrap_text } from "./wrapping.js"

async function wrap(s: string, override?: Partial<Context>): Promise<string | string[]>
{
	const newLines : number[] = [ 0 ]
	for (var iChar = 0; iChar < s.length; ++iChar)
	{
		const c = s[iChar]
		if (c == '\n')
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

	const wrapped = await wrap_text(ctx)
	return wrapped.length == 1 ? wrapped[0] : wrapped
}

function test(name: string, original: string, expected: string | string[], override?: Partial<Context>)
{
	it(name, async () => {
		const actual = await wrap(original, override)
		assert.deepEqual(actual, expected)
	})
}

describe("wrap_text", () =>
{
//*
	// Line Comments

	// Test indentation
	test("indent", "// asd",               "// asd")
	test("indent", " // asd",              "// asd")
	test("indent", "   // asd",            "// asd")
	test("indent", "    // asd",           "\t// asd")
	test("indent", "     // asd",          "\t// asd")
	test("indent", "\t// asd",             "\t// asd")
	test("indent", "\t // asd",            "\t// asd")
	test("indent", "\t   // asd",          "\t// asd")
	test("indent", "\t    // asd",         "\t\t// asd")
	test("indent", "\t     // asd",        "\t\t// asd")
	test("indent", " \t// asd",            "\t// asd")
	test("indent", "   \t// asd",          "\t// asd")
	test("indent", "    \t// asd",         "\t\t// asd")
	test("indent", "     \t// asd",        "\t\t// asd")
	test("indent", "  \t \t \t // asd",    "\t\t\t// asd")
	test("indent", "  \t \t \t    // asd", "\t\t\t\t// asd")

	// Test whitespace at beginning of content (after prefix)
	test("head-space",        "//asd",      "// asd")
	test("head-space",        "// asd",     "// asd")
	test("head-space",        "//   asd",   "// asd")
	test("head-space",        "//    asd",  "// asd")
	test("head-space",        "//     asd", "// asd")
	test("head-space",        "//\tasd",    "// asd")
	test("head-space",        "// \tasd",   "// asd")
	test("head-space",        "//\t asd",   "// asd")
	test("head-space/indent", "\t//asd",    "\t// asd")

	// Test whitespace at end of content
	test("tail-space",            "// asd ",    "// asd")
	test("tail-space",            "// asd\t",   "// asd")
	test("tail-space",            "// asd \t ", "// asd")
	test("tail-space/indent",     "\t// asd ",  "\t// asd")
	test("tail-space/head-space", "//asd ",     "// asd")

	// Test custom prefix
	test("prefix",            "// asd",    "// asd")
	test("prefix",            "/// asd",   "/// asd")
	test("prefix",            "//* asd",   "//* asd")
	test("prefix",            "//! asd",   "//! asd")
	test("prefix",            "//< asd",   "//< asd")
	test("prefix",            "//*!< asd", "//*!< asd")
	test("prefix/indent",     "\t/// asd", "\t/// asd")
	test("prefix/head-space", "///asd",    "/// asd")
	test("prefix/tail-space", "/// asd ",  "/// asd")

	// Test trailing
	test("trailing",            "0; // asd",         " // asd")
	test("trailing",            "0; // asd\n// asd", [" // asd", "// asd"])
	test("trailing/indent",     "0;// asd",          " // asd")
	test("trailing/head-space", "0; //asd",          " // asd")
	test("trailing/tail-space", "0; // asd ",        " // asd")
	test("trailing/prefix",     "0; /// asd",        " /// asd")

	// Test multi line
	test("multiline - 1l",                 "// asd\n// asd",   "// asd asd")
	test("multiline - 2l",                 "// asd\n// asd",   "// asd\n// asd", { lineWidth: 6 })
	test("multiline - 1l 1l",              "// asd\n\n// asd", ["// asd", "// asd"])
	test("multiline/indent - 2l / 1t",     "\t// asd\n// asd", "\t// asd\n\t// asd", { lineWidth: 6 })
	test("multiline/head-space - 2l / 0s", "//asd\n// asd",    "// asd\n// asd", { lineWidth: 6 })
	test("multiline/tail-space - 2l / 1s", "// asd \n// asd ", "// asd\n// asd", { lineWidth: 6 })
	test("multiline/prefix - 2l / 2s",     "/// asd\n// asd",  "/// asd\n/// asd", { lineWidth: 6 })
	test("multiline/trailing - 2l / 2l",     "0; // asd\n// asd",  [ " // asd", "// asd" ])

	// Test narrow lines
	test("narrow",            "// asd",                  "// asd", { lineWidth: 0 })
	test("narrow",            "// asd asd",              "// asd\n// asd", { lineWidth: 0 })
	test("narrow/multiline",  "// asd asd\n// asd asd ", "// asd\n// asd\n// asd\n// asd", { lineWidth: 0 })
	test("narrow/indent",     "\t// asd asd",            "\t// asd\n\t// asd", { lineWidth: 0 })
	test("narrow/head-space", "//asd asd",               "// asd\n// asd", { lineWidth: 0 })
	test("narrow/tail-space", "// asd asd ",             "// asd\n// asd", { lineWidth: 0 })
	test("narrow/prefix",     "/// asd asd",             "/// asd\n/// asd", { lineWidth: 0 })
	test("narrow/trailing",   "0; // asd",               " // asd", { lineWidth: 0 })

	// Test preserved newlines
	test("newline",           "// asd\n//\n//\n// asd",     "// asd\n//\n// asd")
	test("newline",           "//\n// asd",                 "// asd")
	test("newline",           "// asd\n//",                 "// asd")
	test("newline",           "// asd\n// \n// asd",        "// asd\n//\n// asd")
	test("newline",           "// asd\n//    \n// asd",     "// asd\n//\n// asd")
	test("newline",           "// asd\n//\t\n// asd",       "// asd\n//\n// asd")
	test("newline/multiline", "// asd\n// asd\n//\n// asd", "// asd asd\n//\n// asd")
	test("newline/indent",    "\t// asd\n\t//\n\t// asd",   "\t// asd\n\t//\n\t// asd")
	test("newline/head-space", "//asd\n//\n//asd",           "// asd\n//\n// asd")
	test("newline/tail-space", "// asd \n// \n// asd ",      "// asd\n//\n// asd")
	test("newline/prefix",     "/// asd\n///\n/// asd",      "/// asd\n///\n/// asd")
	test("newline/trailing",   "0; // asd\n//\n// asd",      [ " // asd", "// asd" ])
	test("newline/narrow",     "// asd asd\n//\n// asd asd", "// asd\n// asd\n//\n// asd\n// asd", { lineWidth: 0 })

	// Test preserved bullets
	test("bullet",            "// * asd",                     "// * asd")
	test("bullet",            "//  * asd",                    "//  * asd")
	test("bullet",            "//  - asd",                    "//  - asd")
	test("bullet",            "//  1. asd",                   "//  1. asd")
	test("bullet",            "//  1) asd",                   "//  1) asd")
	test("bullet",            "//   * asd",                   "//   * asd")
	test("bullet",            "//    * asd",                  "//    * asd")
	test("bullet",            "//     * asd",                 "//     * asd")
	test("bullet",            "//\t* asd",                    "//  * asd")
	test("bullet",            "// \t* asd",                   "//  * asd")
	test("bullet",            "//  * asd\n//  * asd",         "//  * asd\n//  * asd")
	test("bullet",            "//  * asd\n//    * asd",       "//  * asd\n//    * asd")
	test("bullet/multiline",  "// asd\n//  * asd\n// asd",    "// asd\n//  * asd asd")
	test("bullet/indent",     "\t//  * asd",                  "\t//  * asd")
	test("bullet/head-space", "//* asd",                      "//* asd")
	test("bullet/head-space", "//1. asd",                     "// 1. asd")
	test("bullet/tail-space", "//  * asd ",                   "//  * asd")
	test("bullet/prefix",     "///  * asd",                   "///  * asd")
	test("bullet/trailing",   "0; //  * asd",                 " //  * asd")
	test("bullet/narrow",     "//  * asd",                    "//  * asd", { lineWidth: 0 })
	test("bullet/narrow",     "//  * asd asd",                "//  * asd\n//    asd", { lineWidth: 0 })
	test("bullet/newline",    "//  * asd\n//\n//  * asd",     "//  * asd\n//\n//  * asd")

	// Test preserved doxygen
	test("doxygen",            "// asd\n// @see asd",          "// asd\n// @see asd")
	test("doxygen",            "// asd\n// \\see asd",         "// asd\n// \\see asd")
	test("doxygen",            "// asd\n// @ref asd",          "// asd @ref asd")
	test("doxygen",            "// asd\n// @em asd",           "// asd @em asd")
	test("doxygen",            "// asd\n// @a asd",            "// asd @a asd")
	test("doxygen",            "// asd\n// @f$ asd",           "// asd @f$ asd")
	test("doxygen",            "// asd\n// @$ asd",            "// asd @$ asd")
	test("doxygen",            "// asd\n// @:: asd",           "// asd @:: asd")
	test("doxygen/multiline",  "// @see asd\n// @see asd",     "// @see asd\n// @see asd")
	test("doxygen/multiline",  "// @ref asd\n// @ref asd",     "// @ref asd @ref asd")
	test("doxygen/indent",     "\t// @see asd",                "\t// @see asd")
	test("doxygen/head-space", "//@ref asd",                   "// @ref asd")
	test("doxygen/head-space", "//@ref\n// asd",               "// @ref asd")
	test("doxygen/tail-space", "// @ref asd ",                 "// @ref asd")
	test("doxygen/prefix",     "/// @ref asd",                 "/// @ref asd")
	test("doxygen/trailing",   "0; // @ref asd",               " // @ref asd")
	test("doxygen/narrow",     "// @param asd asd",            "// @param asd\n//        asd", { lineWidth: 0 })
	test("doxygen/newline",    "// @ref asd\n//\n// @ref asd", "// @ref asd\n//\n// @ref asd")
	test("doxygen/bullet",     "// * @see asd",                "// * @see asd")

	// Test empty
	test("empty",            "//",          "")
	test("empty/multiline",  "//\n//",      "")
	test("empty/indent",     "\t//\n\t//",  "")
	test("empty/head-space", "// ",         "")
	test("empty/tail-space", "// ",         "")
	test("empty/prefix",     "///",         "")
	test("empty/trailing",   "0; //",       "")
	test("empty/narrow",     "//",          "", { lineWidth: 0 })
	test("empty/bullet",     "// *",        "")
	test("empty/bullet",     "// * ",       "")
	test("empty/bullet",     "//\n// * ",   "")
	test("empty/newline",    "//\n//\n//",  "")
	test("empty/doxygen",    "// @endcode", "// @endcode")
//*/



	// Block Comments

	// Test indentation
	// Test whitespace at beginning of content (after prefix)
	// Test whitespace at end of content (before suffix)
	// Test custom prefix
	// Test custom suffix
	// Test trailing
	// Test embedded
	// Test single line
	// Test multi line
	// Test narrow lines
	// Test preserved newlines
	// Test preserved bullets
	// Test preserved doxygen
})
