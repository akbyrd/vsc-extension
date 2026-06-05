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
