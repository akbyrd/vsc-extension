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
	test("indent - 0s",             "// asd",            "// asd")
	test("indent - 1s",             " // asd",           "// asd")
	test("indent - 3s",             "   // asd",         "// asd")
	test("indent - 4s",             "    // asd",        "\t// asd")
	test("indent - 5s",             "     // asd",       "\t// asd")
	test("indent - 1t",             "\t// asd",          "\t// asd")
	test("indent - 1t 1s",          "\t // asd",         "\t// asd")
	test("indent - 1t 3s",          "\t   // asd",       "\t// asd")
	test("indent - 1t 4s",          "\t    // asd",      "\t\t// asd")
	test("indent - 1t 5s",          "\t     // asd",     "\t\t// asd")
	test("indent - 1s 1t",          " \t// asd",         "\t// asd")
	test("indent - 3s 1t",          "   \t// asd",       "\t// asd")
	test("indent - 4s 1t",          "    \t// asd",      "\t\t// asd")
	test("indent - 5s 1t",          "     \t// asd",     "\t\t// asd")
	test("indent - 2s 1t 1s 1t 1s", "  \t \t \t // asd", "\t\t\t\t// asd")

	// Test whitespace at beginning of content (after prefix)
	test("head-space - 0s",             "//asd",      "// asd")
	test("head-space - 1s",             "// asd",     "// asd")
	test("head-space - 3s",             "//   asd",   "// asd")
	test("head-space - 4s",             "//    asd",  "// asd")
	test("head-space - 5s",             "//     asd", "// asd")
	test("head-space - 1t",             "//\tasd",    "// asd")
	test("head-space - 1s 1t",          "// \tasd",   "// asd")
	test("head-space - 1t 1s",          "//\t asd",   "// asd")
	test("head-space/indent - 0s / 1t", "\t//asd",    "\t// asd")

	// Test whitespace at end of content
	test("tail-space - 1s",                 "// asd ",    "// asd")
	test("tail-space - 1t",                 "// asd\t",   "// asd")
	test("tail-space - 1s 1t 1s",           "// asd \t ", "// asd")
	test("tail-space/indent - 1s / 1t",     "\t// asd ",  "\t// asd")
	test("tail-space/head-space - 1s / 0s", "//asd ",     "// asd")

	// Test custom prefix
	test("prefix - 2s",                 "// asd",    "// asd")
	test("prefix - 3s",                 "/// asd",   "/// asd")
	test("prefix - 2s 1a",              "//* asd",   "//* asd")
	test("prefix - 2s 1e",              "//! asd",   "//! asd")
	test("prefix - 2s 1l",              "//< asd",   "//< asd")
	test("prefix - 2s 1a 1e 1l",        "//*!< asd", "//*!< asd")
	test("prefix/indent - 3s / 1t",     "\t/// asd", "\t/// asd")
	test("prefix/head-space - 3s / 0s", "///asd",    "/// asd")
	test("prefix/tail-space - 3s / 0s", "/// asd ",  "/// asd")

	// Test trailing
	test("trailing - 1l",                 "0; // asd",         " // asd")
	test("trailing - 2l",                 "0; // asd\n// asd", [" // asd", "// asd"])
	test("trailing/indent - 1l / 0s",     "0;// asd",          " // asd")
	test("trailing/head-space - 1l / 0s", "0; //asd",          " // asd")
	test("trailing/tail-space - 1l / 1s", "0; // asd ",        " // asd")
	test("trailing/prefix - 1l / 3s",     "0; /// asd",        " /// asd")

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
	test("narrow - 1l",                 "// asd",                  "// asd", { lineWidth: 0 })
	test("narrow - 2l",                 "// asd asd",              "// asd\n// asd", { lineWidth: 0 })
	test("narrow/multiline - 4l / 2l",  "// asd asd\n// asd asd ", "// asd\n// asd\n// asd\n// asd", { lineWidth: 0 })
	test("narrow/indent - 2l / 1t",     "\t// asd asd",            "\t// asd\n\t// asd", { lineWidth: 0 })
	test("narrow/head-space - 2l / 0s", "//asd asd",               "// asd\n// asd", { lineWidth: 0 })
	test("narrow/tail-space - 2l / 1s", "// asd asd ",             "// asd\n// asd", { lineWidth: 0 })
	test("narrow/prefix - 2l / 2s",     "/// asd asd",             "/// asd\n/// asd", { lineWidth: 0 })
	test("narrow/trailing - 2l / 1l",   "0; // asd",               " // asd", { lineWidth: 0 })
//*/

	// Test preserved newlines
	test("newline - 1e 0s",                   "//",                         "//") // TODO: What do we want for this case?
	test("newline - 1e 1s",                   "// ",                        "//") // TODO: What do we want for this case?
	test("newline - 2e",                      "//\n//",                     "//") // TODO: What do we want for this case?
	test("newline - 1l 2e 1l",                "// asd\n//\n//\n// asd",     "// asd\n//\n// asd")
	test("newline - 1e 1l",                   "//\n// asd",                 "// asd")
	test("newline - 1l 1e",                   "// asd\n//",                 "// asd")
	test("newline - 1l 1e 1s 1l",             "// asd\n// \n// asd",        "// asd\n//\n// asd")
	test("newline - 1l 1e 4s 1l",             "// asd\n//    \n// asd",     "// asd\n//\n// asd")
	test("newline - 1l 1e 1t 1l",             "// asd\n//\t\n// asd",       "// asd\n//\n// asd")
	test("newline/multiline - 2l 1e 1l / 2l", "// asd\n// asd\n//\n// asd", "// asd asd\n//\n// asd")
	test("newline/indent - 1l 1e 1l / 1t",    "\t// asd\n\t//\n\t// asd",   "\t// asd\n\t//\n\t// asd")
	test("newline/head-space - 1l 1e 1l / 0s", "//asd\n//\n//asd",           "// asd\n//\n// asd")
	test("newline/tail-space - 1l 1e 1l / 1s", "// asd \n// \n// asd ",      "// asd\n//\n// asd")
	test("newline/prefix - 1l 1e 1l / 3s",     "/// asd\n///\n/// asd",      "/// asd\n///\n/// asd")
	test("newline/trailing - 1l 1e 1l / 1l",   "0; // asd\n//\n// asd",      [ " // asd", "// asd" ])
	test("newline/narrow - 1l 1e 1l / 2l",     "// asd asd\n//\n// asd asd", "// asd\n// asd\n//\n// asd\n// asd", { lineWidth: 0 })

	// Test preserved bullets
	// Test preserved doxygen
	// Test indented bullets



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

// TODO: Can we generate tests?
// indent   - [0, 3] indents, [-1, 1] space error, combinatoric space or tab
// space    - [0, 4] spaces, [0, 1] tabs, combinatoric space or tab
// type     - line, block
// prefix   - { //, ///, //*, //<, //!, }, { /*, /**, /*<, /*! }, { *, **, *<, *! }
// suffix   - { */, **/, <*/, !*/}
// lines    - [1, 3]
// newlines - { \n \n\t \n  }
// bullets  - { * - 1. 1) }
// doxygen  - { @\w }

