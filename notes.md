Tree Sitter
-----------
https://github.com/tree-sitter
https://github.com/tree-sitter-grammars
https://github.com/tree-sitter/tree-sitter/wiki/List-of-parsers



Language Configuration
----------------------
```ts
for (const ext of vscode.extensions.all)
{
	const lang = ext.packageJSON.contributes?.languages?.find((l: any) => l.id == languageId)
	if (lang && lang.configuration)
	{
		const path   : vscode.Uri                   = vscode.Uri.joinPath(ext.extensionUri, lang.configuration)
		const bytes  : Uint8Array                   = await vscode.workspace.fs.readFile(path)
		const text   : string                       = new TextDecoder().decode(bytes)
		const config : vscode.LanguageConfiguration = JSON.parse(text)
		console.log(config.comments)
		break
	}
}
```


Testing
-------
vscode testing
	All tests show up in a dedicated activity bar view
	Separate results panel is a waste of space
	Can run tests from gutter in test files
	Results panel doesn't show test output
	Inline error is really nice
	No way to disable tests in the UI
	No "re-run failed tests" button in the view, only the panel

connor4312.nodejs-testing
	Mostly "just works"
	Doesn't compile tests before running
	Doesn't support it.only and it.skip
	Doesn't support continuous running
	Doesn't support tests with the same name
	Doesn't support wrapper functions inside the same file
