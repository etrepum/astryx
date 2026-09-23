// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file markdownSerializers.ts
 * @input Uses @lexical/extension (buildEditorFromExtensions), @lexical/mdast
 *   ($convertFromMarkdownString / $convertToMarkdownString), and the shared
 *   RichTextContentExtension; custom nodes are configured only through extensions.
 * @output Standalone Markdown <-> serialized EditorState helpers:
 *   markdownToEditorStateJSON, editorStateJSONToMarkdown.
 * @position Re-exported from RichTextEditor/index.ts and the @astryxdesign/richtext
 *   barrel. Complements the ref's getMarkdown() by working WITHOUT a mounted
 *   editor (e.g. to produce a `defaultValue` from Markdown on the server).
 *
 * SYNC: When modified, update:
 * - /packages/richtext/src/index.ts (exports)
 * - /packages/richtext/src/RichTextEditor.doc.mjs (usage notes)
 * - /packages/richtext/src/RichTextEditor.test.tsx (tests)
 *
 * NOTE: `@lexical/extension`, `@lexical/mdast`, and `lexical` are OPTIONAL
 * peer dependencies (this is a canary lab module). Install them to use these
 * helpers. The extension builder works without a mounted DOM root, including
 * in Node / SSR contexts.
 */

import {buildEditorFromExtensions} from '@lexical/extension';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/mdast';
import {RichTextContentExtension} from './RichTextContentExtension';
import {defineExtension, type AnyLexicalExtension} from 'lexical';

/** Options shared by the Markdown serializer helpers. */
export interface MarkdownSerializerOptions {
  /**
   * Root content extension depending on RichTextContentExtension. Share it with
   * the view and include it in the editor extension’s dependencies so custom
   * nodes and Markdown rules round-trip. Must work without a DOM or React tree.
   * @default RichTextContentExtension
   */
  extension?: AnyLexicalExtension;
}

function createSerializerEditor({
  extension = RichTextContentExtension,
}: MarkdownSerializerOptions) {
  return buildEditorFromExtensions(
    defineExtension({
      name: '@astryxdesign/richtext/Serializer',
      namespace: 'astryx-editor-serializer',
      dependencies: [extension],
      onError(error: Error) {
        throw error;
      },
    }),
  );
}

/**
 * Convert a Markdown string to a serialized Lexical `EditorState` JSON string
 * — the same shape `RichTextEditor`'s `defaultValue` expects. Runs headless
 * (no DOM), so it is safe in Node / SSR.
 *
 * @example
 * ```
 * const value = markdownToEditorStateJSON('# Title\n\nHello');
 * <RichTextEditor label="Notes" defaultValue={value} />
 * ```
 */
export function markdownToEditorStateJSON(
  markdown: string,
  options: MarkdownSerializerOptions = {},
): string {
  const editor = createSerializerEditor(options);
  try {
    editor.update(
      () => {
        $convertFromMarkdownString(markdown);
      },
      {discrete: true},
    );
    return JSON.stringify(editor.getEditorState().toJSON());
  } finally {
    editor.dispose();
  }
}

/**
 * Convert a serialized Lexical `EditorState` JSON string (e.g. the value
 * produced by `RichTextEditor`'s `onChange` or `defaultValue`) to a Markdown
 * string. Runs headless (no DOM), so it is safe in Node / SSR.
 *
 * @example
 * ```
 * const md = editorStateJSONToMarkdown(savedJson);
 * ```
 */
export function editorStateJSONToMarkdown(
  editorStateJSON: string,
  options: MarkdownSerializerOptions = {},
): string {
  const editor = createSerializerEditor(options);
  try {
    editor.setEditorState(editor.parseEditorState(editorStateJSON));
    return editor.read(() => $convertToMarkdownString());
  } finally {
    editor.dispose();
  }
}
