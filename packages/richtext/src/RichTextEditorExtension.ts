// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file RichTextEditorExtension.ts
 * @input Uses Lexical behavior extensions and reactive callback configuration.
 * @output The editor's editing, history, Markdown shortcuts, change reporting,
 *   character counting, and Escape-then-Tab focus behavior.
 * @position Internal behavior composed by RichTextEditor; React only supplies
 *   the editable surface, UI, imperative ref, and current prop values.
 */

import {
  AutoFocusExtension,
  ClearEditorExtension,
  effect,
  namedSignals,
  TabIndentationExtension,
} from '@lexical/extension';
import {HistoryExtension} from '@lexical/history';
import {ClipboardDOMImportExtension} from '@lexical/clipboard';
import {CheckListExtension, ListExtension} from '@lexical/list';
import {LinkExtension} from '@lexical/link';
import {MdastShortcutsExtension} from '@lexical/mdast';
import {TableExtension} from '@lexical/table';
import {
  $getRoot,
  BLUR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  configExtension,
  defineExtension,
  HISTORY_MERGE_TAG,
  KEY_DOWN_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  mergeRegister,
  safeCast,
  type EditorState,
  type LexicalEditor,
} from 'lexical';
import {RichTextContentExtension} from './RichTextContentExtension';
import {RichTextToolbarExtension} from './RichTextToolbarExtension';

interface EditorCallbacks {
  onChange: ((state: EditorState, editor: LexicalEditor) => void) | undefined;
  onCountChange: ((count: number) => void) | undefined;
}

const ESCAPE_REARM_EXEMPT_KEYS = new Set([
  'Escape',
  'Tab',
  'Shift',
  'Control',
  'Alt',
  'Meta',
]);

export const RichTextEditorExtension = defineExtension({
  name: '@astryxdesign/richtext/Editor',
  dependencies: [
    RichTextContentExtension,
    RichTextToolbarExtension,
    HistoryExtension,
    ClearEditorExtension,
    ListExtension,
    CheckListExtension,
    LinkExtension,
    TableExtension,
    ClipboardDOMImportExtension,
    TabIndentationExtension,
    MdastShortcutsExtension,
    configExtension(AutoFocusExtension, {disabled: true}),
  ],
  config: safeCast<EditorCallbacks>({
    onChange: undefined,
    onCountChange: undefined,
  }),
  build: (_editor, config) => namedSignals(config),
  register(editor, _config, state) {
    const {onChange, onCountChange} = state.getOutput();
    let escapeArmed = false;
    return mergeRegister(
      editor.registerUpdateListener(
        ({editorState, dirtyElements, dirtyLeaves, prevEditorState, tags}) => {
          if (
            (dirtyElements.size === 0 && dirtyLeaves.size === 0) ||
            tags.has(HISTORY_MERGE_TAG) ||
            prevEditorState.isEmpty()
          ) {
            return;
          }
          onChange.peek()?.(editorState, editor);
        },
      ),
      effect(() => {
        const callback = onCountChange.value;
        if (!callback) {
          return;
        }
        callback(editor.read(() => $getRoot().getTextContentSize()));
        return editor.registerTextContentListener(text =>
          callback(text.length),
        );
      }),
      // Let higher-priority UI (e.g. an open popover) consume Escape first.
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          escapeArmed = true;
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      // Run before both table navigation and ordinary Tab indentation. Do not
      // preventDefault: the browser must move focus after Escape, in either direction.
      editor.registerCommand(
        KEY_TAB_COMMAND,
        () => {
          if (!escapeArmed) {
            return false;
          }
          escapeArmed = false;
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        event => {
          if (!ESCAPE_REARM_EXEMPT_KEYS.has(event.key)) {
            escapeArmed = false;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          escapeArmed = false;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  },
});
