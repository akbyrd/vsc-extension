export type WrapConfig = {
	wrapCol:      number
	tabSize:      number
	useSpaces:    boolean
	lineComment:  string
	blockComment: [string, string, string]
}

export function wrapText(text: string, config: WrapConfig): string
{
	return text
}
