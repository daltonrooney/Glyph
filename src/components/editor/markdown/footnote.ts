import {
	createMarkdownFenceTracker,
	isInsideMarkdownCodeFence,
	updateMarkdownFenceTracker,
} from "./markdownFence";

// Matches a footnote token such as `[^1]` or `[^note]`. The id may not contain
// whitespace or closing brackets.
export const FOOTNOTE_PATTERN = /\[\^([^\]\s]+)\]/g;

export type FootnoteKind = "ref" | "def";

export function isFootnoteDefinition(
	text: string,
	matchIndex: number,
	matchLength: number,
): boolean {
	const atLineStart = matchIndex === 0 || text[matchIndex - 1] === "\n";
	return atLineStart && text[matchIndex + matchLength] === ":";
}

export function footnoteKindAt(
	text: string,
	matchIndex: number,
	matchLength: number,
): FootnoteKind {
	return isFootnoteDefinition(text, matchIndex, matchLength) ? "def" : "ref";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the document offset of a footnote ref/def counterpart. Returns the
 * start offset of the matching token, or null when none exists.
 */
export function findFootnoteCounterpartOffset(
	markdown: string,
	id: string,
	fromKind: FootnoteKind,
): number | null {
	const escapedId = escapeRegExp(id);
	if (fromKind === "ref") {
		const definitionPattern = new RegExp(`^\\[\\^${escapedId}\\]:`, "m");
		const match = definitionPattern.exec(markdown);
		return match?.index ?? null;
	}

	const referencePattern = new RegExp(`\\[\\^${escapedId}\\]`, "g");
	for (const match of markdown.matchAll(referencePattern)) {
		const start = match.index ?? 0;
		if (!isFootnoteDefinition(markdown, start, match[0].length)) {
			return start;
		}
	}
	return null;
}

export type FootnoteBridgeKind = "ref" | "def";

export interface FootnoteDefinitionSpan {
	start: number;
	end: number;
	raw: string;
}

const FOOTNOTE_REFERENCE_RE = /^\[\^[^\]\s]+\]$/;
const FOOTNOTE_DEFINITION_START_RE = /^\[\^[^\]\s]+\]:/;
const FOOTNOTE_CONTINUATION_RE = /^( {4}|\t)/;
const FOOTNOTE_BRIDGE_RE = /^\{\{glyph-footnote-(ref|def):([0-9a-f]*)\}\}$/;

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

function hexToBytes(hex: string): Uint8Array | null {
	if (!hex.length || hex.length % 2 !== 0) return null;
	if (!/^[0-9a-f]+$/.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function isFootnoteBridgeSource(kind: FootnoteBridgeKind, raw: string): boolean {
	if (kind === "ref") return FOOTNOTE_REFERENCE_RE.test(raw);
	const spans = findFootnoteDefinitionSpans(raw);
	const span = spans[0];
	return spans.length === 1 && span !== undefined && span.start === 0 && span.end === raw.length;
}

export function encodeFootnoteBridge(kind: FootnoteBridgeKind, raw: string): string {
	return `{{glyph-footnote-${kind}:${bytesToHex(new TextEncoder().encode(raw))}}}`;
}

export function decodeFootnoteBridge(
	value: string,
): { kind: FootnoteBridgeKind; raw: string } | null {
	const match = value.match(FOOTNOTE_BRIDGE_RE);
	if (!match) return null;
	const kind: FootnoteBridgeKind = match[1] === "def" ? "def" : "ref";
	const bytes = hexToBytes(match[2] ?? "");
	if (!bytes) return null;

	let raw: string;
	try {
		raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}

	return isFootnoteBridgeSource(kind, raw) ? { kind, raw } : null;
}

/**
 * Locate complete footnote definition blocks, including indented continuation
 * lines, outside fenced code. Trailing block separators are excluded.
 */
export function findFootnoteDefinitionSpans(markdown: string): FootnoteDefinitionSpan[] {
	const lines = markdown.split("\n");
	const lineOffsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineOffsets.push(offset);
		offset += line.length + 1;
	}

	const spans: FootnoteDefinitionSpan[] = [];
	const tracker = createMarkdownFenceTracker();
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (!FOOTNOTE_CONTINUATION_RE.test(line) && updateMarkdownFenceTracker(line, tracker)) {
			index += 1;
			continue;
		}
		if (isInsideMarkdownCodeFence(tracker) || !FOOTNOTE_DEFINITION_START_RE.test(line)) {
			index += 1;
			continue;
		}

		let lastLine = index;
		for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
			const next = lines[lookahead] ?? "";
			if (!next.trim()) continue;
			if (!FOOTNOTE_CONTINUATION_RE.test(next)) break;
			lastLine = lookahead;
		}

		const start = lineOffsets[index] ?? 0;
		const end = (lineOffsets[lastLine] ?? 0) + (lines[lastLine] ?? "").length;
		spans.push({ start, end, raw: markdown.slice(start, end) });
		index = lastLine + 1;
	}

	return spans;
}
