/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageService, TokenType } from 'vscode-html-languageservice';

export interface HTMLDocumentRegions {
	getEmbeddedRegions(): EmbeddedRegion[];
}

export const CSS_STYLE_RULE = '__';

export interface EmbeddedRegion {
	languageId: string | undefined;
	content: string;
	start: number;
	generatedStart: number;
	length: number;
	attributeValue?: boolean;
	moduleScript?: boolean;
}


export function getDocumentRegions(languageService: LanguageService, text: string): HTMLDocumentRegions {
	const regions: EmbeddedRegion[] = [];
	const scanner = languageService.createScanner(text);
	let lastTagName: string = '';
	let lastAttributeName: string | null = null;
	let languageIdFromType: string | undefined = undefined;
	let isModuleScript = false;

	let token = scanner.scan();
	while (token !== TokenType.EOS) {
		switch (token) {
			case TokenType.StartTag:
				lastTagName = scanner.getTokenText();
				lastAttributeName = null;
				isModuleScript = false;
				languageIdFromType = lastTagName === 'style' ? 'css' : 'javascript';
				break;
			case TokenType.Styles:
				regions.push(createEmbeddedRegion(languageIdFromType, scanner.getTokenOffset(), scanner.getTokenEnd()));
				break;
			case TokenType.Script:
				const region = createEmbeddedRegion(languageIdFromType, scanner.getTokenOffset(), scanner.getTokenEnd());
				region.moduleScript = isModuleScript;
				regions.push(region);
				break;
			case TokenType.AttributeName:
				lastAttributeName = scanner.getTokenText();
				break;
			case TokenType.AttributeValue:
				if (lastAttributeName === 'src' && lastTagName.toLowerCase() === 'script') {
					let value = scanner.getTokenText();
					if (value[0] === '\'' || value[0] === '"') {
						value = value.substr(1, value.length - 1);
					}
				} else if (lastAttributeName === 'type' && lastTagName.toLowerCase() === 'script') {
					if (/["'](module|(text|application)\/(java|ecma)script|text\/babel)["']/.test(scanner.getTokenText())) {
						languageIdFromType = 'javascript';
						isModuleScript = true;
					} else if (/["']text\/typescript["']/.test(scanner.getTokenText())) {
						languageIdFromType = 'typescript';
						isModuleScript = true;
					} else if (/["']application\/json["']/.test(scanner.getTokenText())) {
						languageIdFromType = 'json';
					} else {
						languageIdFromType = undefined;
					}
				} else if (lastAttributeName === 'type' && lastTagName.toLowerCase() === 'style') {
					if (/["']text\/scss["']/.test(scanner.getTokenText())) {
						languageIdFromType = 'scss';
					} else if (/["']text\/less["']/.test(scanner.getTokenText())) {
						languageIdFromType = 'less';
					}
				} else {
					const attributeLanguageId = getAttributeLanguage(lastAttributeName!);
					if (attributeLanguageId) {
						let start = scanner.getTokenOffset();
						let end = scanner.getTokenEnd();
						const firstChar = text[start];
						if (firstChar === '\'' || firstChar === '"') {
							start++;
							end--;
						}
						regions.push(createEmbeddedRegion(attributeLanguageId, start, end, true));
					}
				}
				lastAttributeName = null;
				break;
		}
		token = scanner.scan();
	}
	return {
		getEmbeddedRegions: () => regions,
	};

	function createEmbeddedRegion(languageId: string | undefined, start: number, end: number, attributeValue?: boolean) {
		const c: EmbeddedRegion = {
			languageId,
			start,
			generatedStart: 0,
			length: end - start,
			attributeValue,
			content: '',
		};
		c.content += getPrefix(c);
		c.generatedStart += c.content.length;
		c.content += updateContent(c, text.substring(start, end));
		c.content += getSuffix(c);
		return c;
	}
}

function getPrefix(c: EmbeddedRegion) {
	if (c.attributeValue) {
		switch (c.languageId) {
			case 'css': return CSS_STYLE_RULE + '{';
		}
	}
	return '';
}
function getSuffix(c: EmbeddedRegion) {
	if (c.attributeValue) {
		switch (c.languageId) {
			case 'css': return '}';
			case 'javascript': return ';';
		}
	}
	return '';
}
function updateContent(c: EmbeddedRegion, content: string): string {
	if (!c.attributeValue && c.languageId === 'javascript') {
		return content.replace(`<!--`, `/* `).replace(`-->`, ` */`);
	}
	return content;
}

function getAttributeLanguage(attributeName: string): string | null {
	const match = attributeName.match(/^(style)$|^(on\w+)$/i);
	if (!match) {
		return null;
	}
	return match[1] ? 'css' : 'javascript';
}
