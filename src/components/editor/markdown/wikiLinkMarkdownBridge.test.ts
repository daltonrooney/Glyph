// @vitest-environment jsdom

import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vite-plus/test";
import { createEditorExtensions } from "../extensions";
import {
	decodeFootnoteBridge,
	encodeFootnoteBridge,
	findFootnoteDefinitionSpans,
} from "./footnote";
import {
	postprocessMarkdownFromEditor,
	preprocessMarkdownForEditor,
} from "./wikiLinkMarkdownBridge";

function createMarkdownManager() {
	return new MarkdownManager({
		extensions: createEditorExtensions({
			enableSlashCommand: false,
			enableWikiLinks: false,
			enableMarkdownLinkAutocomplete: false,
		}),
		markedOptions: {
			gfm: true,
			breaks: false,
		},
	});
}

function roundTripThroughEditor(input: string): string {
	const manager = createMarkdownManager();
	return postprocessMarkdownFromEditor(
		manager.serialize(manager.parse(preprocessMarkdownForEditor(input))),
	);
}

describe("wikiLinkMarkdownBridge", () => {
	it("keeps non-wikilink markdown unchanged", () => {
		const md = "# Title\n\nRegular [link](https://example.com)";
		expect(preprocessMarkdownForEditor(md)).toBe(md);
		expect(postprocessMarkdownFromEditor(md)).toBe(md);
	});

	it("canonicalizes valid wikilinks", () => {
		const md = "Jump to [[ Note#^abc | Alias ]] now";
		expect(preprocessMarkdownForEditor(md)).toBe("Jump to [[Note#^abc|Alias]] now");
	});

	it("bridges supported colored spans to internal editor tokens and back", () => {
		const md =
			'Use <span data-glyph-color="blue" style="color: var(--glyph-inline-color-blue)">**focus**</span> here';
		const preprocessed = preprocessMarkdownForEditor(md);
		expect(preprocessed).toBe("Use {{glyph-color:blue}}**focus**{{/glyph-color}} here");
		expect(postprocessMarkdownFromEditor(preprocessed)).toBe(md);
	});

	it("bridges supported highlighted marks to internal editor tokens and back", () => {
		const md =
			'Use <mark data-glyph-highlight="yellow" style="background-color: var(--glyph-inline-highlight-yellow, rgba(240, 180, 41, 0.26))">**focus**</mark> here';
		const preprocessed = preprocessMarkdownForEditor(md);
		expect(preprocessed).toBe("Use {{glyph-highlight:yellow}}**focus**{{/glyph-highlight}} here");
		expect(postprocessMarkdownFromEditor(preprocessed)).toBe(md);
	});

	it("preserves malformed wikilink-like text", () => {
		const md = "Bad [[#Heading]] input";
		expect(postprocessMarkdownFromEditor(md)).toBe(md);
	});

	it("restores escaped callout markers with numeric kinds and folds", () => {
		const serialized = [String.raw`> \[!NOTE2\]-`, String.raw`> \[!TIP\]+`].join("\n");

		expect(postprocessMarkdownFromEditor(serialized)).toBe("> [!NOTE2]-\n> [!TIP]+");
	});

	it("leaves extra blank lines as normal markdown input", () => {
		const md = "alpha\n\n\nbeta";
		const preprocessed = preprocessMarkdownForEditor(md);
		expect(preprocessed).toBe(md);
		expect(postprocessMarkdownFromEditor(preprocessed)).toBe(md);
	});

	it("leaves whitespace-only separator lines as normal markdown input", () => {
		const md = "alpha\n \n\t\nbeta";
		const preprocessed = preprocessMarkdownForEditor(md);
		expect(preprocessed).toBe(md);
		expect(postprocessMarkdownFromEditor(preprocessed)).toBe(md);
	});

	it("preserves mixed whitespace-only lines through editor bridge round-trip", () => {
		const md = "alpha\n  \t \n\t\t\nbeta";
		const preprocessed = preprocessMarkdownForEditor(md);
		expect(postprocessMarkdownFromEditor(preprocessed)).toBe(md);
	});

	it("decodes legacy whitespace sentinels emitted by older editor sessions", () => {
		expect(postprocessMarkdownFromEditor("alpha\n\n\u200b\nbeta")).toBe("alpha\n\n\nbeta");
		expect(postprocessMarkdownFromEditor("alpha\n\u2060\u2061\nbeta")).toBe("alpha\n \nbeta");
	});

	it("preserves escaped dollar signs through editor bridge round-trip", () => {
		const md = String.raw`Price is \$5 and math is $x^2$.`;
		expect(postprocessMarkdownFromEditor(preprocessMarkdownForEditor(md))).toBe(md);
	});

	it("preserves literal placeholder sentinels through editor bridge round-trip", () => {
		const md = "Marker \uE000 and escape \uE001 here";
		expect(postprocessMarkdownFromEditor(preprocessMarkdownForEditor(md))).toBe(md);
	});
});

describe("footnote preservation round trips", () => {
	const cases: Array<[string, string]> = [
		["basic reference", "Text[^note]."],
		["numeric reference", "Text[^1]."],
		["identifier punctuation", "Text[^my_note.v2-1]."],
		["single-line definition", "[^note]: Definition text."],
		["url definition", "[^source]: https://example.org/path?q=1"],
		["multiline definition", "[^long]: First line.\n    Continued with **Markdown**."],
		["repeated reference", "One[^same] and two[^same]."],
		["reference plus definition", "Text[^note].\n\n[^note]: Definition."],
		["inline code", "`[^not-a-footnote]`"],
		["fenced code", "```md\n[^not-a-footnote]: literal\n```"],
		["deliberately escaped literal", String.raw`\[^literal\]`],
	];

	for (const [name, input] of cases) {
		it(`preserves ${name} byte-for-byte`, () => {
			expect(roundTripThroughEditor(input)).toBe(input);
		});
	}

	it("is idempotent across two editor round trips", () => {
		const input = "Text[^note].\n\n[^note]: Definition.";
		const first = roundTripThroughEditor(input);
		const second = roundTripThroughEditor(first);
		expect(first).toBe(input);
		expect(second).toBe(first);
	});
});

describe("footnote bridge codec", () => {
	it("round-trips ascii references and definitions", () => {
		expect(decodeFootnoteBridge(encodeFootnoteBridge("ref", "[^note]"))).toEqual({
			kind: "ref",
			raw: "[^note]",
		});
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", "[^note]: Definition."))).toEqual({
			kind: "def",
			raw: "[^note]: Definition.",
		});
	});

	it("round-trips non-ascii identifiers", () => {
		const raw = "[^café-über-日本]";
		const token = encodeFootnoteBridge("ref", raw);
		expect(token).toMatch(/^\{\{glyph-footnote-ref:[0-9a-f]+\}\}$/);
		expect(decodeFootnoteBridge(token)?.raw).toBe(raw);
	});

	it("round-trips multiline definitions", () => {
		const raw = "[^long]: First line.\n    Continued with **Markdown**.";
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", raw))).toEqual({
			kind: "def",
			raw,
		});
	});

	it("rejects malformed, odd-length, and unknown-kind tokens", () => {
		expect(decodeFootnoteBridge("{{glyph-footnote-ref:zzzz}}")).toBeNull();
		expect(decodeFootnoteBridge("{{glyph-footnote-ref:abc}}")).toBeNull();
		expect(decodeFootnoteBridge("{{glyph-footnote-ref:}}")).toBeNull();
		expect(decodeFootnoteBridge("{{glyph-footnote-note:5b5e615d}}")).toBeNull();
		expect(decodeFootnoteBridge("not a token")).toBeNull();
		expect(decodeFootnoteBridge(` ${encodeFootnoteBridge("ref", "[^note]")}`)).toBeNull();
	});

	it("rejects payloads that do not match their claimed kind", () => {
		expect(decodeFootnoteBridge(encodeFootnoteBridge("ref", "[^note]: Definition."))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", "[^note]"))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("ref", "text [^note] text"))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", "  [^note]: Indented."))).toBeNull();
	});
});

describe("findFootnoteDefinitionSpans", () => {
	it("captures a single-line definition without its block separator", () => {
		const markdown = "Intro.\n\n[^note]: Definition.\n\nOutro.";
		const spans = findFootnoteDefinitionSpans(markdown);
		expect(spans).toHaveLength(1);
		expect(spans[0]?.raw).toBe("[^note]: Definition.");
		expect(markdown.slice(spans[0]?.start, spans[0]?.end)).toBe("[^note]: Definition.");
	});

	it("captures indented continuation lines and interior blank lines", () => {
		const markdown = "[^long]: First line.\n    Continued.\n\n\tTabbed.\n\nNormal text.";
		const spans = findFootnoteDefinitionSpans(markdown);
		expect(spans).toHaveLength(1);
		expect(spans[0]?.raw).toBe("[^long]: First line.\n    Continued.\n\n\tTabbed.");
	});

	it("captures adjacent definitions separately", () => {
		const spans = findFootnoteDefinitionSpans("[^a]: One.\n[^b]: Two.\n\n[^c]: Three.");
		expect(spans.map((span) => span.raw)).toEqual(["[^a]: One.", "[^b]: Two.", "[^c]: Three."]);
	});

	it("stops at the next non-continuation line", () => {
		const spans = findFootnoteDefinitionSpans("[^a]: One.\nPlain paragraph text.");
		expect(spans.map((span) => span.raw)).toEqual(["[^a]: One."]);
	});

	it("ignores definitions inside fenced code and escaped brackets", () => {
		const markdown = "```md\n[^fenced]: literal\n```\n\n" + String.raw`\[^escaped\]: literal`;
		expect(findFootnoteDefinitionSpans(markdown)).toEqual([]);
	});
});
