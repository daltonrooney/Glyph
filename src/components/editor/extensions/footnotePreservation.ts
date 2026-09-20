import { type MarkdownToken, Node } from "@tiptap/core";
import { decodeFootnoteBridge, encodeFootnoteBridge } from "../markdown/footnote";

const FOOTNOTE_REFERENCE_TOKEN_RE = /^\{\{glyph-footnote-ref:[0-9a-f]*\}\}/;
const FOOTNOTE_DEFINITION_TOKEN_RE = /^\{\{glyph-footnote-def:[0-9a-f]*\}\}[\t ]*(?:\n|$)/;

function rawAttr(attrs: Record<string, unknown> | null | undefined): string {
	const raw = attrs?.raw;
	return typeof raw === "string" ? raw : "";
}

function footnoteIdFromRaw(raw: string): string {
	return raw.match(/^\[\^([^\]\s]+)\]/)?.[1] ?? "";
}

function decodeTokenRaw(token: MarkdownToken, kind: "ref" | "def"): string | null {
	const decoded = decodeFootnoteBridge((token.raw ?? token.text ?? "").toString().trim());
	if (!decoded || decoded.kind !== kind) return null;
	return decoded.raw;
}

export const FootnoteReferencePreservation = Node.create({
	name: "footnoteReferencePreservation",
	inline: true,
	group: "inline",
	atom: true,
	selectable: true,
	draggable: false,
	markdownTokenName: "footnoteReferencePreservation",
	addAttributes() {
		return {
			raw: { default: "" },
		};
	},
	renderHTML({ node }) {
		const raw = rawAttr(node.attrs);
		return [
			"span",
			{
				class: "footnoteRef",
				"data-footnote-id": footnoteIdFromRaw(raw),
			},
			raw,
		];
	},
	renderText({ node }) {
		return rawAttr(node.attrs);
	},
	parseMarkdown(token: MarkdownToken, helpers) {
		const raw = decodeTokenRaw(token, "ref");
		if (raw === null) return helpers.createTextNode((token.raw ?? token.text ?? "").toString());
		return helpers.createNode("footnoteReferencePreservation", { raw });
	},
	renderMarkdown(node) {
		return encodeFootnoteBridge("ref", rawAttr(node.attrs));
	},
	markdownTokenizer: {
		name: "footnoteReferencePreservation",
		level: "inline",
		start(src: string) {
			return src.indexOf("{{glyph-footnote-ref:");
		},
		tokenize(src: string) {
			const match = src.match(FOOTNOTE_REFERENCE_TOKEN_RE);
			if (!match) return undefined;
			const decoded = decodeFootnoteBridge(match[0]);
			if (!decoded || decoded.kind !== "ref") return undefined;
			return {
				type: "footnoteReferencePreservation",
				raw: match[0],
				text: match[0],
			};
		},
	},
});

export const FootnoteDefinitionPreservation = Node.create({
	name: "footnoteDefinitionPreservation",
	group: "block",
	atom: true,
	selectable: true,
	draggable: false,
	markdownTokenName: "footnoteDefinitionPreservation",
	addAttributes() {
		return {
			raw: { default: "" },
		};
	},
	renderHTML({ node }) {
		const raw = rawAttr(node.attrs);
		return [
			"pre",
			{
				class: "footnoteDef",
				"data-footnote-id": footnoteIdFromRaw(raw),
			},
			raw,
		];
	},
	renderText({ node }) {
		return rawAttr(node.attrs);
	},
	parseMarkdown(token: MarkdownToken, helpers) {
		const raw = decodeTokenRaw(token, "def");
		if (raw === null) return helpers.createTextNode((token.raw ?? token.text ?? "").toString());
		return helpers.createNode("footnoteDefinitionPreservation", { raw });
	},
	renderMarkdown(node) {
		return encodeFootnoteBridge("def", rawAttr(node.attrs));
	},
	markdownTokenizer: {
		name: "footnoteDefinitionPreservation",
		level: "block",
		start(src: string) {
			return src.search(/^\{\{glyph-footnote-def:[0-9a-f]*\}\}[\t ]*$/m);
		},
		tokenize(src: string) {
			const match = src.match(FOOTNOTE_DEFINITION_TOKEN_RE);
			if (!match) return undefined;
			const token = match[0].trim();
			const decoded = decodeFootnoteBridge(token);
			if (!decoded || decoded.kind !== "def") return undefined;
			return {
				type: "footnoteDefinitionPreservation",
				raw: match[0],
				text: token,
			};
		},
	},
});
