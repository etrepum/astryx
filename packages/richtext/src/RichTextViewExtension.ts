// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file RichTextViewExtension.ts
 * @input Uses Lexical extensions and a reactive serialized value.
 * @output Synchronizes persisted content without rebuilding the read-only editor.
 * @position Internal behavior for RichTextView; React only forwards prop changes.
 */

import {effect, namedSignals} from '@lexical/extension';
import {defineExtension, safeCast} from 'lexical';
import {RichTextContentExtension} from './RichTextContentExtension';

export const RichTextViewExtension = defineExtension({
  name: '@astryxdesign/richtext/View',
  dependencies: [RichTextContentExtension],
  config: {value: safeCast<string | null>(null)},
  build: (_editor, config) => namedSignals(config),
  register(editor, config, state) {
    const {value} = state.getOutput();
    // The initial value is already parsed by $initialEditorState.
    let previousValue = config.value;
    return effect(() => {
      const nextValue = value.value;
      if (nextValue !== null && nextValue !== previousValue) {
        previousValue = nextValue;
        editor.setEditorState(editor.parseEditorState(nextValue));
      }
    });
  },
});
