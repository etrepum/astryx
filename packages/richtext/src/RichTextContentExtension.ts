// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file RichTextContentExtension.ts
 * @input Uses Lexical's CommonMark, GFM, code, and rich-text extensions.
 * @output Shared content schema and Markdown import/export configuration.
 * @position Used by the editor, read-only view, and DOM-free serializers.
 */

import {CodeExtension} from '@lexical/code-core';
import {AutoLinkNode} from '@lexical/link';
import {
  MdastCommonMarkExtension,
  MdastExportExtension,
  MdastGfmExtension,
} from '@lexical/mdast';
import {RichTextExtension} from '@lexical/rich-text';
import {defineExtension} from 'lexical';

export const RichTextContentExtension = defineExtension({
  name: '@astryxdesign/richtext/Content',
  dependencies: [
    RichTextExtension,
    CodeExtension,
    MdastCommonMarkExtension,
    MdastGfmExtension,
    MdastExportExtension,
  ],
  // Persisted auto-links must render even when live auto-linking is disabled.
  nodes: [AutoLinkNode],
});
