import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { wrapText, type WrapConfig } from "./wrapping.ts"

const cpp: WrapConfig = {
	wrapCol:      80,
	tabSize:      4,
	useSpaces:    true,
	lineComment:  "//",
	blockComment: ["/*", " *", " */"],
}

describe("wrapText", () =>
{
	it("short comment is unchanged", () =>
	{
		assert.equal(wrapText("// hello", cpp), "// hello")
	})
})
