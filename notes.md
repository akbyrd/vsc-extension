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
	Inline error is really nice
	Inline error points to wrapper function
	No way to disable tests in the UI
	Rerun failed tests button is only in the results panel
	Can run tests from gutter in test file

connor4312.nodejs-testing
	Doesn't support it.only, it.skip
	Doesn't support tests with the same name
	Doesn't support wrapper functions inside the same file
	Test output doesn't lead back to failed tests
	Doesn't compile tests before running
	Doesn't support continuous running
