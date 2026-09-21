import {
	postprocessEscapedDollars,
	preprocessEscapedDollars,
} from "../extensions/math/mathOptions";
import {
	EDITOR_TEXT_COLOR_BRIDGE_CLOSE_TOKEN,
	getEditorTextColorBridgeOpenToken,
	getEditorTextColorMarkdownOpenTag,
	isEditorTextColor,
} from "../textColors";
import {
	EDITOR_TEXT_HIGHLIGHT_BRIDGE_CLOSE_TOKEN,
	getEditorTextHighlightBridgeOpenToken,
	getEditorTextHighlightMarkdownOpenTag,
	isEditorTextHighlight,
} from "../textHighlights";
import { postprocessDetailsMarkdown, preprocessDetailsMarkdown } from "./detailsMarkdown";
import {
	type FootnoteDefinitionSpan,
	decodeFootnoteBridge,
	encodeFootnoteBridge,
	findFootnoteDefinitionSpans,
} from "./footnote";
import { postprocessHtmlEmbeds, preprocessHtmlEmbeds } from "./htmlEmbedMarkdown";
import { postprocessInlineTocMarkers, preprocessInlineTocMarkers } from "./inlineTocMarkdown";
import { transformMarkdownOutsideCode, transformMarkdownOutsideFences } from "./markdownFence";
import { findWikiLinkSpans, parseWikiLink, wikiLinkAttrsToMarkdown } from "./wikiLinkCodec";

const WHITESPACE_LINE_SENTINEL = "\u2060";
const WHITESPACE_SPACE_SENTINEL = "\u2061";
const WHITESPACE_TAB_SENTINEL = "\u2062";
const LEGACY_EXTRA_BLANK_LINE_SENTINEL = "\u200b";

function canonicalizeWikiLinksText(input: string): string {
	if (!input.includes("[[")) return input;
	const spans = findWikiLinkSpans(input);
	if (!spans.length) return input;

	let out = "";
	let cursor = 0;
	for (const span of spans) {
		out += input.slice(cursor, span.start);
		const parsed = parseWikiLink(span.raw);
		out += parsed ? wikiLinkAttrsToMarkdown(parsed) : span.raw;
		cursor = span.end;
	}
	out += input.slice(cursor);
	return out;
}

function canonicalizeWikiLinks(input: string): string {
	return transformMarkdownOutsideCode(input, canonicalizeWikiLinksText);
}

function restoreEscapedBracketSyntax(input: string): string {
	return transformMarkdownOutsideCode(input, (text) =>
		text
			.replace(/^(\s*>\s*)\\\[!([\w-]+)\\\]([+-]?)(?=\s|$)/, "$1[!$2]$3")
			.replace(/\\\[\\\[([^\n]*?)\\\]\\\]/g, "[[$1]]"),
	);
}

const FOOTNOTE_BRIDGE_TOKEN_RE = /\{\{glyph-footnote-(?:esc|def):[0-9a-f]*\}\}/g;
const ESCAPED_FOOTNOTE_LITERAL_RE = /\\\[\^[^\]\s]+\\\]/g;
const ESCAPED_FOOTNOTE_RE = /\\\[\^((?:\\[^\n\]]|[^\\\]\s])+)\\\]/g;

function hasOddLeadingBackslashes(text: string, index: number): boolean {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

/** Keep definitions on consecutive lines in one block so serialization cannot split them. */
function mergeAdjacentDefinitionSpans(
	input: string,
	spans: FootnoteDefinitionSpan[],
): FootnoteDefinitionSpan[] {
	const merged: FootnoteDefinitionSpan[] = [];
	for (const span of spans) {
		const previous = merged[merged.length - 1];
		if (previous && input[previous.end] === "\n" && span.start === previous.end + 1) {
			merged[merged.length - 1] = {
				start: previous.start,
				end: span.end,
				raw: input.slice(previous.start, span.end),
			};
			continue;
		}
		merged.push(span);
	}
	return merged;
}

function protectFootnoteDefinitions(input: string): string {
	const spans = mergeAdjacentDefinitionSpans(input, findFootnoteDefinitionSpans(input));
	if (!spans.length) return input;

	let out = "";
	let cursor = 0;
	for (const span of spans) {
		out += input.slice(cursor, span.start);
		out += encodeFootnoteBridge("def", span.raw);
		cursor = span.end;
	}
	out += input.slice(cursor);
	return out;
}

/**
 * Deliberately escaped footnote-like text must survive as written, so it is
 * carried through the editor as an opaque token that the repair pass cannot see.
 */
function protectEscapedFootnoteLiterals(input: string): string {
	return transformMarkdownOutsideCode(input, (text) =>
		text.replace(ESCAPED_FOOTNOTE_LITERAL_RE, (match: string, offset: number) =>
			hasOddLeadingBackslashes(text, offset) ? match : encodeFootnoteBridge("esc", match),
		),
	);
}

/** Shield footnote syntax from Marked, which would otherwise consume definitions. */
function preprocessFootnotes(input: string): string {
	if (!input.includes("[^")) return input;
	return protectEscapedFootnoteLiterals(protectFootnoteDefinitions(input));
}

function unescapeFootnoteIdentifier(id: string): string {
	return id.replace(/\\([\\`*_[\]~])/g, "$1");
}

/**
 * The Tiptap text serializer escapes brackets and underscores in ordinary text,
 * which turns a footnote written in the rich editor into `\[^id\]` on disk.
 */
function repairEscapedFootnotes(input: string): string {
	if (!input.includes("\\[^")) return input;
	return transformMarkdownOutsideCode(input, (text) =>
		text.replace(ESCAPED_FOOTNOTE_RE, (match: string, id: string, offset: number) =>
			hasOddLeadingBackslashes(text, offset) ? match : `[^${unescapeFootnoteIdentifier(id)}]`,
		),
	);
}

function restoreProtectedFootnotes(input: string): string {
	if (!input.includes("{{glyph-footnote-")) return input;
	return transformMarkdownOutsideCode(input, (text) =>
		text.replace(
			FOOTNOTE_BRIDGE_TOKEN_RE,
			(match: string) => decodeFootnoteBridge(match)?.raw ?? match,
		),
	);
}

function postprocessFootnotes(input: string): string {
	return restoreProtectedFootnotes(repairEscapedFootnotes(input));
}

const MARKDOWN_IMAGE_WITHOUT_TITLE_RE = /!\[([^\]\n]*)\]\(([^)\n"]*\s[^)\n"]*)\)/g;

function encodeMarkdownImageDestinations(input: string): string {
	// Fence-aware only: alt text may contain inline code, so the full `![...](...)`
	// token must stay intact for the image regex.
	return transformMarkdownOutsideFences(input, (line) =>
		line.replace(MARKDOWN_IMAGE_WITHOUT_TITLE_RE, (match, alt: string, rawHref: string) => {
			const href = typeof rawHref === "string" ? rawHref.trim() : "";
			if (!href) return match;
			try {
				return `![${alt}](${encodeURI(decodeURI(href))})`;
			} catch {
				return `![${alt}](${encodeURI(href)})`;
			}
		}),
	);
}

const GLYPH_COLOR_HTML_RE =
	/<span\b(?=[^>]*\bdata-glyph-color=(?:"([^"]+)"|'([^']+)'))(?=[^>]*\bstyle=(?:"[^"]*"|'[^']*'))[^>]*>([\s\S]*?)<\/span>/gi;

const GLYPH_COLOR_BRIDGE_RE = /\{\{glyph-color:([a-z]+)\}\}([\s\S]*?)\{\{\/glyph-color\}\}/gi;
const GLYPH_HIGHLIGHT_HTML_RE =
	/<mark\b(?=[^>]*\bdata-glyph-highlight=(?:"([^"]+)"|'([^']+)'))(?=[^>]*\bstyle=(?:"[^"]*"|'[^']*'))[^>]*>([\s\S]*?)<\/mark>/gi;
const GLYPH_HIGHLIGHT_BRIDGE_RE =
	/\{\{glyph-highlight:([a-z]+)\}\}([\s\S]*?)\{\{\/glyph-highlight\}\}/gi;

function preprocessColoredText(input: string): string {
	return input.replace(
		GLYPH_COLOR_HTML_RE,
		(_match, dqColor: string | undefined, sqColor: string | undefined, text: string) => {
			const color = (dqColor ?? sqColor ?? "").trim().toLowerCase();
			if (!isEditorTextColor(color)) return text;
			return `${getEditorTextColorBridgeOpenToken(color)}${text}${EDITOR_TEXT_COLOR_BRIDGE_CLOSE_TOKEN}`;
		},
	);
}

function preprocessHighlightedText(input: string): string {
	return input.replace(
		GLYPH_HIGHLIGHT_HTML_RE,
		(_match, dqColor: string | undefined, sqColor: string | undefined, text: string) => {
			const color = (dqColor ?? sqColor ?? "").trim().toLowerCase();
			if (!isEditorTextHighlight(color)) return text;
			return `${getEditorTextHighlightBridgeOpenToken(color)}${text}${EDITOR_TEXT_HIGHLIGHT_BRIDGE_CLOSE_TOKEN}`;
		},
	);
}

function postprocessColoredText(input: string): string {
	return input.replace(GLYPH_COLOR_BRIDGE_RE, (_match, rawColor: string, text: string) => {
		if (!isEditorTextColor(rawColor)) return text;
		return `${getEditorTextColorMarkdownOpenTag(rawColor)}${text}</span>`;
	});
}

function postprocessHighlightedText(input: string): string {
	return input.replace(GLYPH_HIGHLIGHT_BRIDGE_RE, (_match, rawColor: string, text: string) => {
		if (!isEditorTextHighlight(rawColor)) return text;
		return `${getEditorTextHighlightMarkdownOpenTag(rawColor)}${text}</mark>`;
	});
}

function decodeWhitespaceLine(line: string): string | null {
	if (!line.startsWith(WHITESPACE_LINE_SENTINEL)) return null;
	const payload = line.slice(WHITESPACE_LINE_SENTINEL.length);
	if (!payload) return null;

	let decoded = "";
	for (const char of payload) {
		if (char === WHITESPACE_SPACE_SENTINEL) {
			decoded += " ";
			continue;
		}
		if (char === WHITESPACE_TAB_SENTINEL) {
			decoded += "\t";
			continue;
		}
		return null;
	}
	return decoded;
}

function postprocessWhitespaceLines(input: string): string {
	return input
		.split("\n")
		.map((line) => {
			if (line === LEGACY_EXTRA_BLANK_LINE_SENTINEL) return "";
			const decodedWhitespaceLine = decodeWhitespaceLine(line);
			if (decodedWhitespaceLine !== null) return decodedWhitespaceLine;
			return line;
		})
		.join("\n");
}

export function preprocessMarkdownForEditor(markdown: string): string {
	return preprocessEscapedDollars(
		preprocessColoredText(
			preprocessHighlightedText(
				encodeMarkdownImageDestinations(
					canonicalizeWikiLinks(
						preprocessDetailsMarkdown(
							preprocessHtmlEmbeds(preprocessInlineTocMarkers(preprocessFootnotes(markdown))),
						),
					),
				),
			),
		),
	);
}

export function postprocessMarkdownFromEditor(markdown: string): string {
	return postprocessEscapedDollars(
		postprocessInlineTocMarkers(
			postprocessWhitespaceLines(
				postprocessHighlightedText(
					postprocessColoredText(
						postprocessDetailsMarkdown(
							postprocessHtmlEmbeds(
								canonicalizeWikiLinks(restoreEscapedBracketSyntax(postprocessFootnotes(markdown))),
							),
						),
					),
				),
			),
		),
	);
}
