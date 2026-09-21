import { type MarkdownToken, Node } from "@tiptap/core";
import { decodeFootnoteBridge, encodeFootnoteBridge } from "../markdown/footnote";

const FOOTNOTE_ESCAPED_LITERAL_TOKEN_RE = /^\{\{glyph-footnote-esc:[0-9a-f]*\}\}/;
const FOOTNOTE_DEFINITION_TOKEN_RE = /^\{\{glyph-footnote-def:[0-9a-f]*\}\}[\t ]*(?:\n|$)/;

function rawAttr(attrs: Record<string, unknown> | null | undefined): string {
	const raw = attrs?.raw;
	return typeof raw === "string" ? raw : "";
}

function textContentOfNode(node: { content?: Array<{ text?: string }> }): string {
	return (node.content ?? []).map((child) => child.text ?? "").join("");
}

function decodeTokenRaw(token: MarkdownToken, kind: "esc" | "def"): string | null {
	const decoded = decodeFootnoteBridge((token.raw ?? token.text ?? "").toString().trim());
	if (!decoded || decoded.kind !== kind) return null;
	return decoded.raw;
}

export const FootnoteEscapedLiteral = Node.create({
	name: "footnoteEscapedLiteral",
	inline: true,
	group: "inline",
	atom: true,
	selectable: true,
	draggable: false,
	markdownTokenName: "footnoteEscapedLiteral",
	addAttributes() {
		return {
			raw: { default: "" },
		};
	},
	renderHTML({ node }) {
		const raw = rawAttr(node.attrs);
		return ["span", { "data-footnote-literal": "" }, raw];
	},
	renderText({ node }) {
		return rawAttr(node.attrs);
	},
	parseMarkdown(token: MarkdownToken, helpers) {
		const raw = decodeTokenRaw(token, "esc");
		if (raw === null) return helpers.createTextNode((token.raw ?? token.text ?? "").toString());
		return helpers.createNode("footnoteEscapedLiteral", { raw });
	},
	renderMarkdown(node) {
		return encodeFootnoteBridge("esc", rawAttr(node.attrs));
	},
	markdownTokenizer: {
		name: "footnoteEscapedLiteral",
		level: "inline",
		start(src: string) {
			return src.indexOf("{{glyph-footnote-esc:");
		},
		tokenize(src: string) {
			const match = src.match(FOOTNOTE_ESCAPED_LITERAL_TOKEN_RE);
			if (!match) return undefined;
			const decoded = decodeFootnoteBridge(match[0]);
			if (!decoded || decoded.kind !== "esc") return undefined;
			return {
				type: "footnoteEscapedLiteral",
				raw: match[0],
				text: match[0],
			};
		},
	},
});

export const FootnoteDefinitionPreservation = Node.create({
	name: "footnoteDefinitionPreservation",
	group: "block",
	content: "text*",
	marks: "",
	code: true,
	defining: true,
	whitespace: "pre",
	markdownTokenName: "footnoteDefinitionPreservation",
	parseHTML() {
		return [{ tag: "pre[data-footnote-definition]", preserveWhitespace: "full" }];
	},
	renderHTML() {
		return ["pre", { class: "footnoteDef", "data-footnote-definition": "" }, 0];
	},
	renderText({ node }) {
		return node.textContent;
	},
	parseMarkdown(token: MarkdownToken, helpers) {
		const raw = decodeTokenRaw(token, "def");
		if (raw === null) return helpers.createTextNode((token.raw ?? token.text ?? "").toString());
		return helpers.createNode("footnoteDefinitionPreservation", {}, [helpers.createTextNode(raw)]);
	},
	renderMarkdown(node) {
		return textContentOfNode(node);
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
