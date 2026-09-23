// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file RichTextToolbarExtension.ts
 * @input Uses KeyboardShortcutsExtension, selection/history commands, and editable-state signals.
 * @output Reactive toolbar state and the optional insert-link shortcut.
 * @position Internal behavior for RichTextEditorToolbar; React renders the UI.
 */

import {
  KeyboardShortcutsExtension,
  namedSignals,
  WatchEditableExtension,
} from '@lexical/extension';
import {HistoryExtension} from '@lexical/history';
import {$isLinkNode} from '@lexical/link';
import {$isListNode, ListNode} from '@lexical/list';
import {$isHeadingNode, $isQuoteNode} from '@lexical/rich-text';
import {$getNearestNodeOfType} from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  defineExtension,
  CONTROL_OR_META,
  configExtension,
  createCommand,
  mergeRegister,
  safeCast,
  SELECTION_CHANGE_COMMAND,
  type RangeSelection,
} from 'lexical';

export type BlockType =
  'paragraph' | 'h1' | 'h2' | 'h3' | 'quote' | 'bullet' | 'number';

export interface LinkContext {
  selectedText: string;
  url: string;
  isLink: boolean;
}

/** Opens the mounted toolbar's link UI; unhandled when unavailable or read-only. */
export const OPEN_LINK_EDITOR_COMMAND = createCommand<KeyboardEvent>(
  'OPEN_LINK_EDITOR_COMMAND',
);

export const RichTextToolbarExtension = defineExtension({
  name: '@astryxdesign/richtext/Toolbar',
  dependencies: [
    HistoryExtension,
    WatchEditableExtension,
    configExtension(KeyboardShortcutsExtension, {
      shortcuts: {
        'astryx.insertLink': {
          key: 'k',
          modifiers: CONTROL_OR_META,
          command: OPEN_LINK_EDITOR_COMMAND,
        },
      },
    }),
  ],
  build(_editor, _config, state) {
    return {
      ...namedSignals({
        activeFormats: new Set<string>(),
        blockType: safeCast<BlockType>('paragraph'),
        isLink: false,
        canUndo: false,
        canRedo: false,
        selection: safeCast<RangeSelection | null>(null),
        linkContext: safeCast<LinkContext>({
          selectedText: '',
          url: '',
          isLink: false,
        }),
        onInsertLink: safeCast<(() => void) | undefined>(undefined),
      }),
      isEditable: state.getDependency(WatchEditableExtension).output,
    };
  },
  register(editor, _config, state) {
    const output = state.getOutput();
    const $syncToolbar = () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return;
      }
      const formats = new Set<string>();
      for (const fmt of [
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'code',
      ] as const) {
        if (selection.hasFormat(fmt)) {
          formats.add(fmt);
        }
      }
      output.activeFormats.value = formats;

      // Link active state — a link is "active" when the caret/selection anchor
      // sits inside a LinkNode (or its immediate parent is one).
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      const linkNode = $isLinkNode(node)
        ? node
        : $isLinkNode(parent)
          ? parent
          : null;
      const selectionIsLink = linkNode != null;
      output.isLink.value = selectionIsLink;
      output.selection.value = selection.clone();
      output.linkContext.value = {
        selectedText: selection.getTextContent(),
        url: linkNode?.getURL() ?? '',
        isLink: selectionIsLink,
      };
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType<ListNode>(
          anchorNode,
          ListNode,
        );
        const type = parentList
          ? parentList.getListType()
          : element.getListType();
        output.blockType.value = type === 'number' ? 'number' : 'bullet';
      } else if ($isHeadingNode(element)) {
        output.blockType.value = element.getTag() as BlockType;
      } else if ($isQuoteNode(element)) {
        output.blockType.value = 'quote';
      } else {
        output.blockType.value = 'paragraph';
      }
    };

    editor.read($syncToolbar);
    const history = state
      .getDependency(HistoryExtension)
      .output.historyState.peek();
    output.canUndo.value = history.undoStack.length > 0;
    output.canRedo.value = history.redoStack.length > 0;
    return mergeRegister(
      editor.registerUpdateListener(({editorState}) => {
        editorState.read($syncToolbar, {editor});
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $syncToolbar();
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        value => {
          output.canUndo.value = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        value => {
          output.canRedo.value = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        OPEN_LINK_EDITOR_COMMAND,
        event => {
          const onInsertLink = output.onInsertLink.peek();
          if (onInsertLink && editor.isEditable()) {
            event.preventDefault();
            onInsertLink();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    );
  },
});
