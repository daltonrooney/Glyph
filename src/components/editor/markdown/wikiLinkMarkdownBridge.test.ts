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

function serializeTypedText(typed: string): string {
	const manager = createMarkdownManager();
	const doc = {
		type: "doc",
		content: typed
			.split("\n\n")
			.map((block) => ({ type: "paragraph", content: [{ type: "text", text: block }] })),
	};
	return postprocessMarkdownFromEditor(manager.serialize(doc));
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
		["definitions on consecutive lines", "[^a]: One.\n[^b]: Two."],
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
	it("round-trips escaped literals and definitions", () => {
		const escaped = String.raw`\[^literal\]`;
		expect(decodeFootnoteBridge(encodeFootnoteBridge("esc", escaped))).toEqual({
			kind: "esc",
			raw: escaped,
		});
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", "[^note]: Definition."))).toEqual({
			kind: "def",
			raw: "[^note]: Definition.",
		});
	});

	it("round-trips non-ascii identifiers", () => {
		const raw = String.raw`\[^café-über-日本\]`;
		const token = encodeFootnoteBridge("esc", raw);
		expect(token).toMatch(/^\{\{glyph-footnote-esc:[0-9a-f]+\}\}$/);
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
		expect(decodeFootnoteBridge("{{glyph-footnote-esc:zzzz}}")).toBeNull();
		expect(decodeFootnoteBridge("{{glyph-footnote-esc:abc}}")).toBeNull();
		expect(decodeFootnoteBridge("{{glyph-footnote-esc:}}")).toBeNull();
		expect(decodeFootnoteBridge("{{glyph-footnote-ref:5b5e615d}}")).toBeNull();
		expect(decodeFootnoteBridge("not a token")).toBeNull();
		expect(
			decodeFootnoteBridge(` ${encodeFootnoteBridge("esc", String.raw`\[^literal\]`)}`),
		).toBeNull();
	});

	it("accepts definitions that sit on consecutive lines", () => {
		const raw = "[^a]: One.\n[^b]: Two.";
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", raw))?.raw).toBe(raw);
	});

	it("rejects payloads that do not match their claimed kind", () => {
		expect(decodeFootnoteBridge(encodeFootnoteBridge("esc", "[^note]: Definition."))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", "[^note]"))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("esc", "[^note]"))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("esc", "text [^note] text"))).toBeNull();
		expect(decodeFootnoteBridge(encodeFootnoteBridge("def", "  [^note]: Indented."))).toBeNull();
		expect(
			decodeFootnoteBridge(encodeFootnoteBridge("def", "[^a]: One.\n\nParagraph.\n\n[^b]: Two.")),
		).toBeNull();
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

describe("footnote markdown bridge", () => {
	it("leaves plain references as editable text", () => {
		expect(preprocessMarkdownForEditor("Text[^note].")).toBe("Text[^note].");
	});

	it("protects deliberately escaped literals so the repair pass cannot revive them", () => {
		const escaped = String.raw`\[^literal\]`;
		expect(preprocessMarkdownForEditor(escaped)).toBe(encodeFootnoteBridge("esc", escaped));
	});

	it("protects a complete definition block including continuation lines", () => {
		const definition = "[^long]: First line.\n    Continued with **Markdown**.";
		expect(preprocessMarkdownForEditor(`Intro.\n\n${definition}`)).toBe(
			`Intro.\n\n${encodeFootnoteBridge("def", definition)}`,
		);
	});

	it("leaves code untouched", () => {
		const md = "`[^not-a-footnote]`\n\n```md\n[^not-a-footnote]: literal\n```";
		expect(preprocessMarkdownForEditor(md)).toBe(md);
	});

	it("restores protected footnotes and keeps lookalike tokens literal", () => {
		const md = "Text[^note].\n\n[^note]: Definition.";
		expect(postprocessMarkdownFromEditor(preprocessMarkdownForEditor(md))).toBe(md);
		expect(postprocessMarkdownFromEditor("{{glyph-footnote-esc:zz}} stays")).toBe(
			"{{glyph-footnote-esc:zz}} stays",
		);
	});
});

describe("footnote preservation nodes", () => {
	function findNodeByType(
		value: unknown,
		type: string,
	): { type?: string; attrs?: Record<string, unknown>; content?: unknown[] } | null {
		if (!value || typeof value !== "object") return null;
		const node = value as {
			type?: string;
			attrs?: Record<string, unknown>;
			content?: unknown[];
		};
		if (node.type === type) return node;
		for (const child of node.content ?? []) {
			const found = findNodeByType(child, type);
			if (found) return found;
		}
		return null;
	}

	it("keeps plain references as editable text rather than a node", () => {
		const manager = createMarkdownManager();
		const json = manager.parse(preprocessMarkdownForEditor("Text[^my_note.v2-1]."));
		expect(findNodeByType(json, "footnoteEscapedLiteral")).toBeNull();
		expect(JSON.stringify(json)).toContain("[^my_note.v2-1]");
	});

	it("parses deliberately escaped literals into a preservation node", () => {
		const escaped = String.raw`\[^literal\]`;
		const manager = createMarkdownManager();
		const json = manager.parse(preprocessMarkdownForEditor(escaped));
		expect(findNodeByType(json, "footnoteEscapedLiteral")?.attrs).toEqual({
			raw: escaped,
		});
	});

	it("parses definitions into an editable block holding the complete original text", () => {
		const definition = "[^long]: First line.\n    Continued with **Markdown**.";
		const manager = createMarkdownManager();
		const json = manager.parse(preprocessMarkdownForEditor(`Intro.\n\n${definition}`));
		const node = findNodeByType(json, "footnoteDefinitionPreservation");
		expect(node?.content).toEqual([{ type: "text", text: definition }]);
	});
});

describe("footnotes typed directly in the rich editor", () => {
	const typed: Array<[string, string]> = [
		["reference", "Text[^footnote-1] here."],
		["identifier with underscores", "Text[^my_note.v2-1] here."],
		["definition", "[^footnote-1]: This is the text for footnote one."],
		["reference and definition", "Text[^footnote-1].\n\n[^footnote-1]: Footnote text."],
	];

	for (const [name, input] of typed) {
		it(`writes a typed ${name} without escaping`, () => {
			expect(serializeTypedText(input)).toBe(input);
		});
	}

	it("keeps a typed footnote stable when reloaded and saved again", () => {
		const typedOutput = serializeTypedText("Text[^footnote-1].\n\n[^footnote-1]: Footnote text.");
		expect(roundTripThroughEditor(typedOutput)).toBe(typedOutput);
	});
});
