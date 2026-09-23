// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file RichTextEditor.test.tsx
 * @input Uses vitest, @testing-library/react, RichTextEditor + RichTextView
 * @output Unit tests for the opt-in Lexical editor components, including
 *   accessible label wiring, shared input visuals/status variants,
 *   placeholder semantics, extension lifecycle, mdast serialization, link-dialog layout, and top-toolbar
 *   ordering and horizontal scrolling
 * @position Testing; validates RichTextEditor.tsx and RichTextView.tsx
 *
 * SYNC: When the editor components change, update these tests to match.
 */

import {describe, it, expect, vi, beforeAll, afterAll} from 'vitest';
import {render, screen, waitFor, fireEvent, act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createRef, useEffect, StrictMode} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import type {EditorState, LexicalEditor} from 'lexical';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
} from '@lexical/list';
import {
  CONTROL_OR_META,
  TextNode,
  type SerializedTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  configExtension,
  defineExtension,
  HISTORY_PUSH_TAG,
  HISTORY_MERGE_TAG,
  UNDO_COMMAND,
  REDO_COMMAND,
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
} from 'lexical';
import {$convertFromMarkdownString, MdastImportExtension} from '@lexical/mdast';
import {RichTextEditor, type RichTextEditorRef} from './RichTextEditor';
import {RichTextView} from './RichTextView';
import {RichTextEditorExtension} from './RichTextEditorExtension';
import {RichTextContentExtension} from './RichTextContentExtension';
import {OPEN_LINK_EDITOR_COMMAND} from './RichTextToolbarExtension';
import {KeyboardShortcutsExtension} from '@lexical/extension';
import {
  markdownToEditorStateJSON,
  editorStateJSONToMarkdown,
} from './markdownSerializers';
import {RichTextEditorToolbar} from './RichTextEditorToolbar';
import {registerIcons, resetIcons} from '@astryxdesign/core/Icon';
import {
  RichTextEditorAutoLinkExtension,
  DEFAULT_LINK_MATCHERS,
  NEW_TAB_LINK_ATTRIBUTES,
} from './RichTextEditorAutoLinkExtension';
import {sanitizeUrl, validateUrl} from './linkUtils';

// A consumer override must reach both mounted editors and DOM-free helpers.
const PlainHeadingExtension = defineExtension({
  name: 'test/PlainHeading',
  dependencies: [
    RichTextContentExtension,
    configExtension(MdastImportExtension, {
      importRules: [
        {
          type: 'heading',
          $import: (node, context) =>
            $createParagraphNode().append(...context.importChildren(node)),
        },
      ],
      exportRules: [
        {
          type: 'heading',
          $export: (node, context) => ({
            type: 'paragraph',
            children: context.exportInline(node),
          }),
        },
      ],
    }),
  ],
});

const PlainHeadingEditorExtension = defineExtension({
  name: 'test/PlainHeadingEditor',
  dependencies: [RichTextEditorExtension, PlainHeadingExtension],
});
const AutoLinkEditorExtension = defineExtension({
  name: 'test/AutoLinkEditor',
  dependencies: [RichTextEditorExtension, RichTextEditorAutoLinkExtension],
});

const RemappedLinkEditorExtension = defineExtension({
  name: 'test/RemappedLinkEditor',
  dependencies: [
    RichTextEditorExtension,
    configExtension(KeyboardShortcutsExtension, {
      shortcuts: {
        'astryx.insertLink': {
          key: 'j',
          modifiers: CONTROL_OR_META,
          command: OPEN_LINK_EDITOR_COMMAND,
        },
      },
    }),
  ],
});
const DisabledLinkShortcutExtension = defineExtension({
  name: 'test/DisabledLinkShortcut',
  dependencies: [
    RichTextEditorExtension,
    configExtension(KeyboardShortcutsExtension, {
      shortcuts: {'astryx.insertLink': null},
    }),
  ],
});

class CustomTextNode extends TextNode {
  static getType() {
    return 'custom-text';
  }
  static clone(node: CustomTextNode) {
    return new CustomTextNode(node.getTextContent(), node.getKey());
  }
  static importJSON(serialized: SerializedTextNode) {
    return new CustomTextNode().updateFromJSON(serialized);
  }
  exportJSON(): SerializedTextNode {
    return {...super.exportJSON(), type: 'custom-text'};
  }
}
const CustomTextExtension = defineExtension({
  name: 'test/CustomText',
  nodes: [CustomTextNode],
  dependencies: [
    RichTextContentExtension,
    configExtension(MdastImportExtension, {
      importRules: [
        {type: 'text', $import: node => new CustomTextNode(node.value)},
      ],
      exportRules: [
        {
          type: 'custom-text',
          $export: node => ({type: 'text', value: node.getTextContent()}),
        },
      ],
    }),
  ],
});
const CustomTextEditorExtension = defineExtension({
  name: 'test/CustomTextEditor',
  dependencies: [RichTextEditorExtension, CustomTextExtension],
});

function typeText(editor: LexicalEditor, text: string) {
  for (const char of text) {
    editor.update(
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(char);
        }
      },
      {discrete: true},
    );
  }
}

// Closed popover-backed tooltips are intentionally hidden from the default
// accessibility tree until their trigger opens them.
const h = {hidden: true} as const;

const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal',
);
const originalDialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close',
);

beforeAll(() => {
  // JSDOM does not implement the native dialog lifecycle used by Dialog.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(
      HTMLDialogElement.prototype,
      'showModal',
      originalShowModal,
    );
  } else {
    delete (HTMLDialogElement.prototype as {showModal?: unknown}).showModal;
  }
  if (originalDialogClose) {
    Object.defineProperty(
      HTMLDialogElement.prototype,
      'close',
      originalDialogClose,
    );
  } else {
    delete (HTMLDialogElement.prototype as {close?: unknown}).close;
  }
});

// Small plugin that captures the editor instance so tests can drive real
// Lexical updates (jsdom does not implement contenteditable editing).
function CaptureEditor({onReady}: {onReady: (editor: LexicalEditor) => void}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);
  return null;
}

// A minimal valid serialized Lexical editor state containing a single
// paragraph with the text "Hello world".
// Builds a serialized Lexical state containing a single paragraph with the
// given text. Used to verify that RichTextView reacts to `value` changes.
function makeParagraphState(text: string): string {
  return JSON.stringify({
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text,
              type: 'text',
              version: 1,
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
        },
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  });
}

// Builds a serialized Lexical state containing a list. `listType` is
// 'bullet' (renders <ul>) or 'number' (renders <ol>). Used to verify that the
// editor theme applies visible list markers rather than bare indentation.
function makeListState(listType: 'bullet' | 'number'): string {
  const tag = listType === 'number' ? 'ol' : 'ul';
  return JSON.stringify({
    root: {
      children: [
        {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  text: 'Item one',
                  type: 'text',
                  version: 1,
                },
              ],
              direction: 'ltr',
              format: '',
              indent: 0,
              type: 'listitem',
              version: 1,
              value: 1,
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'list',
          version: 1,
          listType,
          start: 1,
          tag,
        },
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  });
}

// Builds a serialized Lexical state with a two-level nested bullet list:
//   • Item one
//     ◦ Nested item
// Lexical models nesting as a child `list` node inside a `listitem`. Used to
// verify that depth-2 markers differ from depth-1 (disc → circle) rather than
// falling back to bare indentation.
function makeNestedBulletState(): string {
  const textNode = (text: string) => ({
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  });
  const listItem = (children: unknown[], value: number) => ({
    children,
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'listitem',
    version: 1,
    value,
  });
  const bulletList = (children: unknown[]) => ({
    children,
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'list',
    version: 1,
    listType: 'bullet',
    start: 1,
    tag: 'ul',
  });
  return JSON.stringify({
    root: {
      children: [
        bulletList([
          listItem([textNode('Item one')], 1),
          // A nested list lives inside its own list item wrapper.
          listItem([bulletList([listItem([textNode('Nested item')], 1)])], 2),
        ]),
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  });
}

const HELLO_STATE = JSON.stringify({
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'Hello world',
            type: 'text',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
});

describe('RichTextEditor', () => {
  it('keeps TextArea-style input visuals alongside consumer props', () => {
    const {container} = render(
      <RichTextEditor
        label="Notes"
        className="custom-editor"
        style={{width: '42rem'}}
      />,
    );

    const wrapper = container.querySelector('.astryx-rich-text-editor');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper).toHaveClass('custom-editor');
    expect(wrapper).toHaveAttribute('data-size', 'md');
    expect(wrapper).toHaveStyle({width: '42rem'});
    expect(
      [...(wrapper?.classList ?? [])].some(className =>
        className.startsWith('x'),
      ),
    ).toBe(true);
  });

  it('renders a labelled editable textbox', () => {
    render(<RichTextEditor label="Notes" />);
    const textbox = screen.getByRole('textbox', {name: 'Notes'});
    const label = screen.getByText('Notes');

    expect(textbox).toBeInTheDocument();
    expect(textbox).toHaveAttribute('contenteditable', 'true');
    expect(label).toHaveAttribute(
      'id',
      textbox.getAttribute('aria-labelledby'),
    );
    expect(textbox).toHaveAttribute('id', label.getAttribute('for'));
  });

  it('applies minHeight only to the editable content surface', () => {
    const {container, rerender} = render(<RichTextEditor label="Notes" />);
    const wrapper = container.querySelector('.astryx-rich-text-editor');

    expect(
      screen.getByRole('textbox').style.getPropertyValue('--x-minHeight'),
    ).toBe('4.5rem');
    expect(wrapper).not.toHaveStyle({'--x-minHeight': '4.5rem'});

    rerender(<RichTextEditor label="Notes" minHeight={180} />);
    expect(
      screen.getByRole('textbox').style.getPropertyValue('--x-minHeight'),
    ).toBe('180px');

    rerender(<RichTextEditor label="Notes" minHeight="12rem" />);
    expect(
      screen.getByRole('textbox').style.getPropertyValue('--x-minHeight'),
    ).toBe('12rem');
  });

  it('shows the placeholder when empty', () => {
    render(<RichTextEditor label="Notes" placeholder="Write something…" />);
    const textbox = screen.getByRole('textbox');
    const visualPlaceholder = screen.getByText('Write something…');

    expect(textbox).toHaveAttribute('aria-placeholder', 'Write something…');
    expect(visualPlaceholder).toHaveAttribute('aria-hidden', 'true');
    expect(textbox.parentElement).toContainElement(visualPlaceholder);
  });

  it('renders the initial value from defaultValue', async () => {
    render(<RichTextEditor label="Notes" defaultValue={HELLO_STATE} />);
    await waitFor(() =>
      expect(screen.getByText('Hello world')).toBeInTheDocument(),
    );
  });

  it('is not editable when isReadOnly', () => {
    render(<RichTextEditor label="Notes" isReadOnly />);
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });

  it('is not editable when isDisabled', () => {
    render(<RichTextEditor label="Notes" isDisabled />);
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });

  it('marks the textbox invalid on error status', () => {
    render(
      <RichTextEditor
        label="Notes"
        status={{type: 'error', message: 'Required'}}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it.each(['error', 'warning', 'success'] as const)(
    'renders an in-editor %s icon for the default attached status',
    type => {
      const {container} = render(
        <RichTextEditor
          label="Notes"
          status={{type, message: `${type} message`}}
        />,
      );

      const statusIcon = container.querySelector('.astryx-input-status-icon');
      expect(statusIcon).toBeInTheDocument();
      expect(statusIcon).toHaveAttribute('data-status', type);
      expect(statusIcon).toHaveAttribute('data-size', 'md');
      expect(container.querySelector('.astryx-field-status')).toHaveAttribute(
        'data-variant',
        'attached',
      );
    },
  );

  it('uses the detached message icon and suppresses the in-editor icon', () => {
    const {container} = render(
      <RichTextEditor
        label="Notes"
        status={{type: 'warning', message: 'Review this value'}}
        statusVariant="detached"
      />,
    );

    expect(
      container.querySelector('.astryx-input-status-icon'),
    ).not.toBeInTheDocument();
    expect(container.querySelector('.astryx-field-status')).toHaveAttribute(
      'data-variant',
      'detached',
    );
    expect(
      container.querySelector('.astryx-field-status-icon'),
    ).toBeInTheDocument();
  });

  it('surfaces tooltip status through a focusable in-editor icon', () => {
    const {container} = render(
      <RichTextEditor
        label="Notes"
        status={{type: 'error', message: 'Required'}}
        statusVariant="tooltip"
      />,
    );

    expect(
      container.querySelector('.astryx-field-status'),
    ).not.toBeInTheDocument();
    const statusButton = screen.getByRole('button', {
      name: /error details/i,
    });
    const tooltip = screen.getByRole('tooltip', h);
    const textbox = screen.getByRole('textbox');
    expect(statusButton).toHaveAttribute('type', 'button');
    expect(statusButton.getAttribute('aria-describedby')).toContain(tooltip.id);
    expect(textbox.getAttribute('aria-describedby')).toContain(tooltip.id);
    expect(tooltip).toHaveTextContent('Required');
  });

  it('sets aria-required when required', () => {
    render(<RichTextEditor label="Notes" isRequired />);
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  it('fires onChange when content changes', async () => {
    // jsdom does not implement contenteditable editing, so we grab the editor
    // instance via a small capture plugin and drive a real Lexical update,
    // then assert onChange fires.
    let editorRef: LexicalEditor | undefined;
    const onChange = vi.fn();
    render(
      <RichTextEditor
        label="Notes"
        onChange={onChange}
        plugins={<CaptureEditor onReady={e => (editorRef = e)} />}
      />,
    );
    await waitFor(() => expect(editorRef).toBeDefined());
    onChange.mockClear();
    editorRef!.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('hello'));
      root.append(paragraph);
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('hides the visible label but keeps it accessible when isLabelHidden', () => {
    render(<RichTextEditor label="Secret notes" isLabelHidden />);
    expect(
      screen.getByRole('textbox', {name: 'Secret notes'}),
    ).toBeInTheDocument();
  });

  it('renders custom plugins passed via the plugins prop', () => {
    render(
      <RichTextEditor
        label="Notes"
        plugins={<div data-testid="custom-plugin" />}
      />,
    );
    expect(screen.getByTestId('custom-plugin')).toBeInTheDocument();
  });

  it('uses mdast for live heading shortcuts', async () => {
    const ref = createRef<RichTextEditorRef>();
    render(<RichTextEditor ref={ref} label="Notes" />);
    await act(async () => {
      ref.current!.focus();
      typeText(ref.current!.getEditor(), '# ');
    });
    expect(screen.getByRole('textbox').querySelector('h1')).not.toBeNull();
  });

  it('toggles shortcuts without recreating the editor or disabling Markdown import', async () => {
    const ref = createRef<RichTextEditorRef>();
    const {rerender} = render(
      <RichTextEditor ref={ref} label="Notes" hasMarkdownShortcuts={false} />,
    );
    const editor = ref.current!.getEditor();
    await act(async () => {
      ref.current!.focus();
      typeText(editor, '# ');
    });
    expect(screen.getByRole('textbox').querySelector('h1')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveTextContent('#');
    rerender(<RichTextEditor ref={ref} label="Notes" hasMarkdownShortcuts />);
    expect(ref.current!.getEditor()).toBe(editor);
    await act(async () => {
      ref.current!.clear();
      editor.read(() => {});
      typeText(editor, '# ');
    });
    expect(screen.getByRole('textbox').querySelector('h1')).not.toBeNull();
    rerender(
      <RichTextEditor ref={ref} label="Notes" hasMarkdownShortcuts={false} />,
    );
    await act(async () => {
      editor.update(() => $convertFromMarkdownString('# Imported'), {
        discrete: true,
      });
    });
    expect(ref.current!.getMarkdown()).toBe('# Imported');
  });

  it('uses custom extension rules for Markdown import', async () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        extension={PlainHeadingEditorExtension}
      />,
    );
    await act(async () => {
      ref
        .current!.getEditor()
        .update(() => $convertFromMarkdownString('# Title'), {discrete: true});
    });
    expect(screen.getByRole('textbox').querySelector('h1')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveTextContent('Title');
  });

  it('preserves content, history, and editor identity when the root extension stays the same', async () => {
    const ref = createRef<RichTextEditorRef>();
    const {rerender} = render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        extension={RichTextEditorExtension}
      />,
    );
    const editor = ref.current!.getEditor();
    await act(async () => {
      editor.update(() => $convertFromMarkdownString('First'), {
        discrete: true,
        tag: HISTORY_PUSH_TAG,
      });
      editor.update(() => $convertFromMarkdownString('First second'), {
        discrete: true,
        tag: HISTORY_PUSH_TAG,
      });
    });
    rerender(
      <RichTextEditor
        ref={ref}
        label="Renamed"
        extension={RichTextEditorExtension}
      />,
    );
    expect(ref.current!.getEditor()).toBe(editor);
    expect(ref.current!.getMarkdown()).toBe('First second');
    await act(async () => {
      editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
    expect(ref.current!.getMarkdown()).toBe('First');
    await act(async () => {
      editor.dispatchCommand(REDO_COMMAND, undefined);
    });
    expect(ref.current!.getMarkdown()).toBe('First second');
  });

  it('creates a new editor when the root extension changes', async () => {
    const ref = createRef<RichTextEditorRef>();
    const {rerender} = render(
      <RichTextEditor ref={ref} label="Notes" defaultValue={HELLO_STATE} />,
    );
    const original = ref.current!.getEditor();
    rerender(
      <RichTextEditor
        ref={ref}
        label="Notes"
        defaultValue={HELLO_STATE}
        extension={PlainHeadingEditorExtension}
      />,
    );
    const replacement = ref.current!.getEditor();
    expect(replacement).not.toBe(original);
    expect(ref.current!.getMarkdown()).toBe('Hello world');
    await act(async () => {
      replacement.update(() => $convertFromMarkdownString('# Title'), {
        discrete: true,
      });
    });
    expect(ref.current!.getMarkdown()).toBe('Title');
  });

  it('updates editability and imperative actions without remounting', async () => {
    const ref = createRef<RichTextEditorRef>();
    const {rerender} = render(
      <RichTextEditor ref={ref} label="Notes" defaultValue={HELLO_STATE} />,
    );
    const editor = ref.current!.getEditor();
    for (const mode of [{isReadOnly: true}, {isDisabled: true}]) {
      rerender(<RichTextEditor ref={ref} label="Notes" {...mode} />);
      expect(editor.isEditable()).toBe(false);
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'contenteditable',
        'false',
      );
      await act(async () => {
        ref.current!.clear();
      });
      expect(ref.current!.getMarkdown()).toBe('Hello world');
    }
    rerender(<RichTextEditor ref={ref} label="Notes" />);
    expect(ref.current!.getEditor()).toBe(editor);
    expect(editor.isEditable()).toBe(true);
    await act(async () => {
      ref.current!.clear();
    });
    expect(ref.current!.getMarkdown()).toBe('');
  });

  it('uses the current onChange once in StrictMode and ignores selection/history-merge updates', async () => {
    const ref = createRef<RichTextEditorRef>();
    const first = vi.fn();
    const second = vi.fn();
    const {rerender} = render(
      <StrictMode>
        <RichTextEditor ref={ref} label="Notes" onChange={first} />
      </StrictMode>,
    );
    const editor = ref.current!.getEditor();
    expect(first).not.toHaveBeenCalled();
    await act(async () => {
      editor.update(() => $convertFromMarkdownString('First'), {
        discrete: true,
      });
    });
    expect(first).toHaveBeenCalledTimes(1);
    rerender(
      <StrictMode>
        <RichTextEditor ref={ref} label="Notes" onChange={second} />
      </StrictMode>,
    );
    await act(async () => {
      editor.update(() => $convertFromMarkdownString('Second'), {
        discrete: true,
      });
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await act(async () => {
      editor.update(() => $getRoot().selectEnd(), {discrete: true});
      editor.update(() => $convertFromMarkdownString('Merged'), {
        discrete: true,
        tag: HISTORY_MERGE_TAG,
      });
    });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('counts plain text consistently when the counter is enabled after mount', async () => {
    const ref = createRef<RichTextEditorRef>();
    const {rerender} = render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        defaultValue={markdownToEditorStateJSON('one\n\ntwo')}
      />,
    );
    rerender(<RichTextEditor ref={ref} label="Notes" maxLength={20} />);
    expect(await screen.findByText('8/20')).toBeInTheDocument();
    await act(async () => {
      ref.current!.clear();
    });
    expect(await screen.findByText('0/20')).toBeInTheDocument();
  });

  it('exposes an imperative ref handle after mount', () => {
    const ref = createRef<RichTextEditorRef>();
    render(<RichTextEditor ref={ref} label="Notes" />);
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.focus).toBe('function');
    expect(typeof ref.current?.clear).toBe('function');
    expect(typeof ref.current?.getEditorState).toBe('function');
    expect(typeof ref.current?.getMarkdown).toBe('function');
    expect(typeof ref.current?.getHTML).toBe('function');
    expect(typeof ref.current?.getEditor).toBe('function');
  });

  it('ref.focus() runs without throwing and targets the editable surface', () => {
    const ref = createRef<RichTextEditorRef>();
    render(<RichTextEditor ref={ref} label="Notes" />);
    // Lexical dispatches focus via its editor command; jsdom does not always
    // reflect programmatic contenteditable focus onto document.activeElement,
    // so assert the call is wired and the root element is reachable rather
    // than asserting jsdom focus state.
    expect(() => ref.current?.focus()).not.toThrow();
    const root = ref.current?.getEditor().getRootElement();
    expect(root).toBe(screen.getByRole('textbox'));
  });

  it('ref.getEditorState() returns the current EditorState', () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor ref={ref} label="Notes" defaultValue={HELLO_STATE} />,
    );
    const state = ref.current?.getEditorState();
    expect(state).toBeDefined();
    const text = state?.read(() => $getRoot().getTextContent());
    expect(text).toBe('Hello world');
  });

  it('ref.getEditor() returns the underlying LexicalEditor', () => {
    const ref = createRef<RichTextEditorRef>();
    render(<RichTextEditor ref={ref} label="Notes" />);
    const editor = ref.current?.getEditor();
    expect(editor).toBeDefined();
    expect(typeof editor?.update).toBe('function');
  });

  it('ref.getMarkdown() serializes plain text content', () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor ref={ref} label="Notes" defaultValue={HELLO_STATE} />,
    );
    expect(ref.current?.getMarkdown()).toBe('Hello world');
  });

  it('ref.getMarkdown() serializes a heading with mdast', async () => {
    const ref = createRef<RichTextEditorRef>();
    let editorRef: LexicalEditor | undefined;
    render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        plugins={<CaptureEditor onReady={e => (editorRef = e)} />}
      />,
    );
    await waitFor(() => expect(editorRef).toBeDefined());
    editorRef!.update(() => {
      $convertFromMarkdownString('# Title');
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toBe('# Title'));
  });

  it('ref.getMarkdown() honors custom extension export rules', () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        defaultValue={markdownToEditorStateJSON('# Title')}
        extension={PlainHeadingEditorExtension}
      />,
    );
    expect(ref.current!.getMarkdown()).toBe('Title');
  });

  it('ref.getHTML() serializes content to an HTML string', () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor ref={ref} label="Notes" defaultValue={HELLO_STATE} />,
    );
    const html = ref.current?.getHTML();
    expect(typeof html).toBe('string');
    // A paragraph with the seeded text renders as a <p> containing "Hello world".
    expect(html).toContain('<p');
    expect(html).toContain('Hello world');
  });

  it('ref.clear() resets the editor to a single empty paragraph', async () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor ref={ref} label="Notes" defaultValue={HELLO_STATE} />,
    );
    ref.current?.clear();
    await waitFor(() => {
      const state: EditorState | undefined = ref.current?.getEditorState();
      const text = state?.read(() => $getRoot().getTextContent());
      expect(text).toBe('');
    });
    // The root should hold exactly one (empty) paragraph, not zero children —
    // a bare root breaks selection/typing.
    const state = ref.current?.getEditorState();
    const childCount = state?.read(() => $getRoot().getChildrenSize());
    expect(childCount).toBe(1);
  });

  it('ref.clear() fires onChange', async () => {
    const ref = createRef<RichTextEditorRef>();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        defaultValue={HELLO_STATE}
        onChange={onChange}
      />,
    );
    // Wait for the editor to mount and the initial state to settle so any
    // seed-time onChange has already fired before we assert on clear().
    await waitFor(() => expect(ref.current).not.toBeNull());
    onChange.mockClear();
    ref.current?.clear();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('ref.clear() and ref.focus() are no-ops when isReadOnly', async () => {
    const ref = createRef<RichTextEditorRef>();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        defaultValue={HELLO_STATE}
        onChange={onChange}
        isReadOnly
      />,
    );
    onChange.mockClear();
    ref.current?.focus();
    ref.current?.clear();
    // Give any (unexpected) async update a chance to flush before asserting.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
    const state = ref.current?.getEditorState();
    const text = state?.read(() => $getRoot().getTextContent());
    expect(text).toBe('Hello world');
  });

  it('ref.clear() is a no-op when isDisabled', async () => {
    const ref = createRef<RichTextEditorRef>();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        ref={ref}
        label="Notes"
        defaultValue={HELLO_STATE}
        onChange={onChange}
        isDisabled
      />,
    );
    onChange.mockClear();
    ref.current?.clear();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
    const state = ref.current?.getEditorState();
    const text = state?.read(() => $getRoot().getTextContent());
    expect(text).toBe('Hello world');
  });

  it('does not render a character counter when maxLength is not set', () => {
    render(<RichTextEditor label="Notes" defaultValue={HELLO_STATE} />);
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
  });

  it('renders a character counter reflecting the seeded content length', async () => {
    // HELLO_STATE is "Hello world" (11 chars).
    render(
      <RichTextEditor
        label="Notes"
        defaultValue={HELLO_STATE}
        maxLength={100}
      />,
    );
    await waitFor(() => expect(screen.getByText('11/100')).toBeInTheDocument());
  });

  it('shows an over-limit counter when content exceeds maxLength', async () => {
    // 11 chars with a limit of 5 -> over limit.
    render(
      <RichTextEditor label="Notes" defaultValue={HELLO_STATE} maxLength={5} />,
    );
    await waitFor(() => expect(screen.getByText('11/5')).toBeInTheDocument());
    // aria-live region announces the overflow for screen readers.
    expect(screen.getByText('6 characters over limit')).toBeInTheDocument();
  });

  it('associates the counter with the editor via aria-describedby', async () => {
    render(
      <RichTextEditor
        label="Notes"
        defaultValue={HELLO_STATE}
        maxLength={100}
      />,
    );
    const counter = await screen.findByText('11/100');
    const describedBy = screen
      .getByRole('textbox')
      .getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy!.split(' ')).toContain(counter.id);
  });
});

describe('RichTextEditor Tab keyboard trap escape (WCAG 2.1.2)', () => {
  const DEFAULT_HINT = 'Press Escape then Tab to move focus out of the editor.';

  beforeAll(() => {
    // jsdom's Range does not implement getBoundingClientRect, which Lexical
    // calls (via scroll-into-view) whenever it reconciles a collapsed
    // selection while the editor is focused. Stub it so the focused-editor
    // keyboard tests below can run without uncaught exceptions.
    if (typeof Range.prototype.getBoundingClientRect !== 'function') {
      Range.prototype.getBoundingClientRect = () => new DOMRect();
    }
  });

  /**
   * Renders the editor followed by a button, focuses the contenteditable and
   * seeds a single-item bullet list with the caret at the start of the item —
   * the position where TabIndentationExtension turns Tab into an indent (and
   * calls preventDefault, which is the keyboard trap under test).
   */
  async function setUpListEditor() {
    let editorRef: LexicalEditor | undefined;
    function CaptureEditor() {
      const [editor] = useLexicalComposerContext();
      useEffect(() => {
        editorRef = editor;
      }, [editor]);
      return null;
    }
    render(
      <>
        <RichTextEditor label="Notes" plugins={<CaptureEditor />} />
        <button type="button">after</button>
      </>,
    );
    await waitFor(() => expect(editorRef).toBeDefined());
    const textbox = screen.getByRole('textbox');
    textbox.focus();
    editorRef!.update(() => {
      const root = $getRoot();
      root.clear();
      const list = $createListNode('bullet');
      const item = $createListItemNode();
      const text = $createTextNode('Item one');
      item.append(text);
      list.append(item);
      root.append(list);
      text.select(0, 0);
    });
    return {editor: editorRef!, textbox};
  }

  /** Indent of the list item containing the seeded text node. */
  function getItemIndent(editor: LexicalEditor): number {
    return editor.getEditorState().read(() => {
      const text = $getRoot().getAllTextNodes()[0];
      const item = text.getParent();
      return $isListItemNode(item) ? item.getIndent() : -1;
    });
  }

  it('indents the list item on Tab and keeps focus in the editor', async () => {
    const user = userEvent.setup();
    const {editor, textbox} = await setUpListEditor();
    expect(getItemIndent(editor)).toBe(0);
    await user.tab();
    expect(getItemIndent(editor)).toBe(1);
    // The keydown was consumed by indentation, so focus did not move.
    expect(document.activeElement).toBe(textbox);
  });

  it('moves focus out (without indenting) on Tab after Escape', async () => {
    const user = userEvent.setup();
    const {editor, textbox} = await setUpListEditor();
    await user.keyboard('{Escape}');
    await user.tab();
    expect(document.activeElement).not.toBe(textbox);
    expect(document.activeElement).toBe(
      screen.getByRole('button', {name: 'after'}),
    );
    expect(getItemIndent(editor)).toBe(0);
  });

  it('re-arms indentation when another key is pressed after Escape', async () => {
    const user = userEvent.setup();
    const {editor, textbox} = await setUpListEditor();
    await user.keyboard('{Escape}');
    // Any non-modifier key press (typing, arrows, …) cancels the escape.
    fireEvent.keyDown(textbox, {key: 'a'});
    await user.tab();
    expect(document.activeElement).toBe(textbox);
    expect(getItemIndent(editor)).toBe(1);
  });

  it('does not re-arm on a bare modifier, so Escape then Shift+Tab escapes', async () => {
    const user = userEvent.setup();
    const {textbox} = await setUpListEditor();
    await user.keyboard('{Escape}');
    // Pressing Shift on its own (the first half of Shift+Tab) must not
    // cancel the escape. fireEvent returns false when preventDefault was
    // called — an unprevented Tab keydown means native focus movement.
    fireEvent.keyDown(textbox, {key: 'Shift'});
    expect(fireEvent.keyDown(textbox, {key: 'Tab', shiftKey: true})).toBe(true);
  });

  it('advertises the escape via a visually hidden aria-describedby hint', () => {
    render(<RichTextEditor label="Notes" />);
    const textbox = screen.getByRole('textbox');
    const hint = screen.getByText(DEFAULT_HINT);
    expect(hint.id).not.toBe('');
    expect(
      (textbox.getAttribute('aria-describedby') ?? '').split(/\s+/),
    ).toContain(hint.id);
  });

  it('supports overriding and suppressing the hint text', () => {
    const {unmount} = render(
      <RichTextEditor label="Notes" tabEscapeHint="Custom escape hint" />,
    );
    expect(screen.getByText('Custom escape hint')).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_HINT)).not.toBeInTheDocument();
    unmount();
    render(<RichTextEditor label="Notes" tabEscapeHint="" />);
    expect(screen.queryByText(DEFAULT_HINT)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('omits the hint when the editor is not editable', () => {
    render(<RichTextEditor label="Notes" isReadOnly />);
    expect(screen.queryByText(DEFAULT_HINT)).not.toBeInTheDocument();
  });
});

describe('RichTextView', () => {
  it('renders mdast tables, task lists, and thematic breaks with the shared schema', async () => {
    const value = markdownToEditorStateJSON(
      '| Name | Value |\n| --- | --- |\n| a | b |\n\n- [x] done\n\n---',
    );
    const {container} = render(<RichTextView value={value} />);
    await waitFor(() =>
      expect(container.querySelector('table')).not.toBeNull(),
    );
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.querySelector('[aria-checked="true"]')).not.toBeNull();
    expect(container).toHaveTextContent('done');
  });

  it('renders serialized content read-only', async () => {
    render(<RichTextView value={HELLO_STATE} />);
    await waitFor(() =>
      expect(screen.getByText('Hello world')).toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });

  it('renders custom read-only plugins passed via the plugins prop', () => {
    render(
      <RichTextView
        value={HELLO_STATE}
        plugins={<div data-testid="view-plugin" />}
      />,
    );
    expect(screen.getByTestId('view-plugin')).toBeInTheDocument();
  });

  it('accepts a custom namespace without throwing', async () => {
    render(<RichTextView value={HELLO_STATE} namespace="custom-view-ns" />);
    await waitFor(() =>
      expect(screen.getByText('Hello world')).toBeInTheDocument(),
    );
  });

  it('registers custom nodes through shared extensions in the editor, view, and serializers', async () => {
    const options = {extension: CustomTextExtension};
    const value = markdownToEditorStateJSON('Custom content', options);
    expect(JSON.parse(value).root.children[0].children[0].type).toBe(
      'custom-text',
    );
    const ref = createRef<RichTextEditorRef>();
    render(
      <>
        <RichTextEditor
          ref={ref}
          label="Notes"
          defaultValue={value}
          extension={CustomTextEditorExtension}
        />
        <RichTextView value={value} extension={CustomTextExtension} />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByText('Custom content')).toHaveLength(2),
    );
    expect(ref.current!.getMarkdown()).toBe('Custom content');
    expect(editorStateJSONToMarkdown(value, options)).toBe('Custom content');
  });

  it('recovers when a replacement content extension registers the missing node', async () => {
    const value = markdownToEditorStateJSON('Custom content', {
      extension: CustomTextExtension,
    });
    const onParseError = vi.fn();
    const {rerender} = render(
      <RichTextView
        value={value}
        onParseError={onParseError}
        errorFallback="Unavailable"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Unavailable')).toBeInTheDocument(),
    );
    expect(onParseError).toHaveBeenCalled();
    rerender(
      <RichTextView
        value={value}
        extension={CustomTextExtension}
        onParseError={onParseError}
        errorFallback="Unavailable"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Custom content')).toBeInTheDocument(),
    );
  });

  it('does not throw on malformed JSON — renders fallback and calls onError', () => {
    const onError = vi.fn();
    expect(() =>
      render(
        <RichTextView
          value={'{ not valid json'}
          onParseError={onError}
          errorFallback={<div data-testid="view-fallback">Unavailable</div>}
        />,
      ),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(screen.getByTestId('view-fallback')).toBeInTheDocument();
    // No editor surface is rendered in the error state.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders bullet lists with a disc marker (not bare indentation)', async () => {
    const {container} = render(
      <RichTextView value={makeListState('bullet')} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Item one')).toBeInTheDocument(),
    );
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    // The theme must give the <ul> a marker class so the browser draws a
    // bullet. A bare list with only padding would show indentation only —
    // the exact bug this guards against.
    expect(ul?.className.trim()).not.toBe('');
    expect(getComputedStyle(ul as Element).listStyleType).toBe('disc');
  });

  it('renders numbered lists with a decimal marker (not bare indentation)', async () => {
    const {container} = render(
      <RichTextView value={makeListState('number')} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Item one')).toBeInTheDocument(),
    );
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.className.trim()).not.toBe('');
    expect(getComputedStyle(ol as Element).listStyleType).toBe('decimal');
  });

  it('renders nested bullet lists with a distinct depth-2 marker (circle)', async () => {
    const {container} = render(
      <RichTextView value={makeNestedBulletState()} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Nested item')).toBeInTheDocument(),
    );
    const lists = container.querySelectorAll('ul');
    // Outer <ul> plus the nested <ul>.
    expect(lists.length).toBe(2);
    const [outer, nested] = lists;
    expect(getComputedStyle(outer).listStyleType).toBe('disc');
    // Depth-2 must cycle to a different marker so nesting is visually legible,
    // matching the native browser disc → circle progression.
    expect(getComputedStyle(nested).listStyleType).toBe('circle');
  });

  it('renders nothing (no crash) on malformed JSON with no fallback', () => {
    expect(() => render(<RichTextView value={'garbage'} />)).not.toThrow();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('updates the rendered content when the value prop changes', async () => {
    // LexicalComposer's initialConfig.editorState is only read on mount, so
    // without the internal sync plugin the view would freeze at the first
    // value. This guards that a changed `value` re-renders the content — the
    // exact bug in the "Markdown Serializers" story (RichTextView stayed stale
    // while the Markdown input changed).
    const {rerender} = render(
      <RichTextView value={makeParagraphState('first version')} />,
    );
    await waitFor(() =>
      expect(screen.getByText('first version')).toBeInTheDocument(),
    );

    rerender(<RichTextView value={makeParagraphState('second version')} />);
    await waitFor(() =>
      expect(screen.getByText('second version')).toBeInTheDocument(),
    );
    expect(screen.queryByText('first version')).not.toBeInTheDocument();
  });

  it('recovers from a malformed value once a valid value is supplied again', async () => {
    // A bad value renders the fallback; a subsequent valid value must re-mount
    // the composer and render the new content (hasError resets on change).
    const {rerender} = render(
      <RichTextView
        value={'{ not valid json'}
        errorFallback={<div data-testid="view-fallback">Unavailable</div>}
      />,
    );
    expect(screen.getByTestId('view-fallback')).toBeInTheDocument();

    rerender(<RichTextView value={makeParagraphState('recovered')} />);
    await waitFor(() =>
      expect(screen.getByText('recovered')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('view-fallback')).not.toBeInTheDocument();
  });
});

describe('markdown serializers', () => {
  it('markdownToEditorStateJSON produces a heading node from "# "', () => {
    const json = markdownToEditorStateJSON('# Title');
    const parsed = JSON.parse(json);
    const first = parsed.root.children[0];
    expect(first.type).toBe('heading');
    expect(first.tag).toBe('h1');
    expect(first.children[0].text).toBe('Title');
  });

  it('editorStateJSONToMarkdown round-trips a heading back to "# "', () => {
    const json = markdownToEditorStateJSON('# Title');
    expect(editorStateJSONToMarkdown(json)).toBe('# Title');
  });

  it('markdown round-trips through both helpers', () => {
    const md = '# Heading\n\nSome **bold** text';
    const json = markdownToEditorStateJSON(md);
    expect(editorStateJSONToMarkdown(json)).toBe(md);
  });

  it('uses the same extension rules for standalone import and export', () => {
    const options = {extension: PlainHeadingExtension};
    const json = markdownToEditorStateJSON('# Title', options);
    expect(JSON.parse(json).root.children[0].type).toBe('paragraph');
    expect(
      editorStateJSONToMarkdown(markdownToEditorStateJSON('# Title'), options),
    ).toBe('Title');
  });

  it.each([
    'Title\n=====',
    '[reference][id]\n\n[id]: https://example.com "Title"',
    '- [x] done\n- [ ] todo',
    '| Name | Value |\n| --- | --- |\n| x | **y** |',
    '---',
    '~~~js\nconst n = 1;\n~~~',
    'one\ntwo\n\nthree',
  ])('round-trips CommonMark/GFM content through JSON: %s', markdown => {
    const json = markdownToEditorStateJSON(markdown);
    const exported = editorStateJSONToMarkdown(json);
    expect(editorStateJSONToMarkdown(markdownToEditorStateJSON(exported))).toBe(
      exported,
    );
    expect(exported).not.toBe('');
  });

  it('produces JSON consumable as RichTextEditor defaultValue', async () => {
    const value = markdownToEditorStateJSON('Hello world');
    render(<RichTextEditor label="Notes" defaultValue={value} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox').textContent).toContain('Hello world'),
    );
  });
});

describe('RichTextEditorToolbar', () => {
  it('treats a false conditional toolbar as absent', () => {
    const {container, rerender} = render(
      <RichTextEditor label="Notes" toolbar={false} tabEscapeHint="" />,
    );
    const conditionalBodyClass = container.querySelector(
      '.astryx-rich-text-editor',
    )?.firstElementChild?.className;

    rerender(<RichTextEditor label="Notes" tabEscapeHint="" />);

    expect(
      container.querySelector('.astryx-rich-text-editor')?.firstElementChild
        ?.className,
    ).toBe(conditionalBodyClass);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('renders flush at the top before the editing surface', () => {
    const {container} = render(
      <RichTextEditor label="Notes" toolbar={<RichTextEditorToolbar />} />,
    );
    const toolbar = screen.getByRole('toolbar', {name: 'Text formatting'});
    const textbox = screen.getByRole('textbox');
    const editor = container.querySelector('.astryx-rich-text-editor');
    const toolbarRegion = toolbar.parentElement?.parentElement;
    const editorBody = toolbarRegion?.nextElementSibling;

    expect(toolbar).toHaveClass('astryx-toolbar');
    expect(toolbar).toHaveAttribute('data-size', 'sm');
    expect(screen.getByRole('button', {name: 'Bold'})).toHaveAttribute(
      'data-size',
      'sm',
    );
    expect(
      toolbar.compareDocumentPosition(textbox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(toolbarRegion?.parentElement).toBe(editor);
    expect(editorBody).toBeInstanceOf(HTMLElement);
    // Vitest's JSDOM setup does not load compiled StyleX CSS. The WithToolbar
    // story provides visual coverage for flush edges and preserved body inset;
    // here we verify that the dedicated body receives its StyleX layout.
    expect(
      [...(editorBody?.classList ?? [])].some(className =>
        className.startsWith('x'),
      ),
    ).toBe(true);

    // Block formatting is consolidated into a selector, while history and
    // inline formatting remain direct buttons.
    expect(
      screen.getByRole('combobox', {name: 'Block format'}).parentElement,
    ).toHaveAttribute('data-size', 'sm');
    const historyDivider = screen.getByRole('separator', {
      name: 'History and block formats',
    });
    const inlineDivider = screen.getByRole('separator', {
      name: 'Block and inline formats',
    });
    expect(historyDivider).toHaveAttribute('aria-orientation', 'vertical');
    expect(inlineDivider).toHaveAttribute('aria-orientation', 'vertical');

    const blockSelector = screen.getByRole('combobox', {
      name: 'Block format',
    });
    expect(
      historyDivider.compareDocumentPosition(blockSelector) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      blockSelector.compareDocumentPosition(inlineDivider) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Undo',
      'Redo',
    ]) {
      expect(screen.getByRole('button', {name})).toBeInTheDocument();
    }
  });

  it('renders configured headings and block formats in the selector', async () => {
    const user = userEvent.setup();
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar headingLevels={['h1', 'h2']} />}
      />,
    );
    await user.click(screen.getByRole('combobox', {name: 'Block format'}));

    for (const name of [
      'Paragraph',
      'Heading 1',
      'Heading 2',
      'Bulleted list',
      'Numbered list',
      'Block quote',
    ]) {
      expect(screen.getByRole('option', {name, ...h})).toBeInTheDocument();
    }
    expect(
      screen.queryByRole('option', {name: 'Heading 3', ...h}),
    ).not.toBeInTheDocument();
  });

  it('accepts a custom accessible label', () => {
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar label="Editor controls" />}
      />,
    );
    expect(
      screen.getByRole('toolbar', {name: 'Editor controls'}),
    ).toBeInTheDocument();
  });

  it('renders composed endContent', () => {
    render(
      <RichTextEditor
        label="Notes"
        toolbar={
          <RichTextEditorToolbar
            endContent={<button type="button">Custom</button>}
          />
        }
      />,
    );
    expect(screen.getByRole('button', {name: 'Custom'})).toBeInTheDocument();
  });

  it('keeps every formatting action directly available in the scroll row', () => {
    render(
      <RichTextEditor label="Notes" toolbar={<RichTextEditorToolbar />} />,
    );

    const actionRow = screen.getByRole('group', {
      name: 'Formatting actions',
    });
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Link',
    ]) {
      expect(actionRow).toContainElement(screen.getByRole('button', {name}));
    }
    expect(
      screen.queryByRole('button', {name: 'More text formatting options'}),
    ).not.toBeInTheDocument();
  });

  it('disables formatting controls when the editor is read-only', () => {
    render(
      <RichTextEditor
        label="Notes"
        isReadOnly
        toolbar={<RichTextEditorToolbar />}
      />,
    );
    expect(screen.getByRole('button', {name: 'Bold'})).toBeDisabled();
  });

  it('renders a theme-registered icon override for a richtext:* key', () => {
    registerIcons({
      'richtext:bold': <span data-testid="themed-bold">B!</span>,
    });
    try {
      render(
        <RichTextEditor label="Notes" toolbar={<RichTextEditorToolbar />} />,
      );
      // The Bold control uses the theme's registered glyph instead of the
      // bundled inline default.
      const bold = screen.getByRole('button', {name: 'Bold'});
      expect(
        bold.querySelector('[data-testid="themed-bold"]'),
      ).toBeInTheDocument();
    } finally {
      resetIcons();
    }
  });
});

describe('linkUtils', () => {
  describe('sanitizeUrl', () => {
    it('passes through http/https URLs', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
      expect(sanitizeUrl('http://example.com/x')).toBe('http://example.com/x');
    });

    it('defaults a scheme-less host to https', () => {
      expect(sanitizeUrl('example.com')).toBe('https://example.com/');
    });

    it('preserves mailto and tel schemes', () => {
      expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
      expect(sanitizeUrl('tel:+15551234')).toBe('tel:+15551234');
    });

    it('rejects javascript: and other unsafe schemes as about:blank', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('about:blank');
      expect(sanitizeUrl('data:text/html,<script>')).toBe('about:blank');
      expect(sanitizeUrl('vbscript:msgbox')).toBe('about:blank');
    });

    it('rejects empty/whitespace input as about:blank', () => {
      expect(sanitizeUrl('')).toBe('about:blank');
      expect(sanitizeUrl('   ')).toBe('about:blank');
    });
  });

  describe('validateUrl', () => {
    it('accepts safe URLs (with or without scheme)', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('example.com')).toBe(true);
      expect(validateUrl('mailto:a@b.com')).toBe(true);
    });

    it('rejects unsafe schemes and empty input', () => {
      expect(validateUrl('javascript:alert(1)')).toBe(false);
      expect(validateUrl('')).toBe(false);
    });
  });
});

describe('RichTextEditorToolbar — links', () => {
  it('renders a Link button by default', () => {
    render(
      <RichTextEditor label="Notes" toolbar={<RichTextEditorToolbar />} />,
    );
    expect(screen.getByRole('button', {name: 'Link'})).toBeInTheDocument();
  });

  it('opens an Astryx Dialog instead of the browser prompt by default', async () => {
    const browserPrompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    try {
      render(
        <RichTextEditor label="Notes" toolbar={<RichTextEditorToolbar />} />,
      );

      fireEvent.click(screen.getByRole('button', {name: 'Link'}));

      expect(browserPrompt).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          screen.getByRole('dialog', {name: 'Insert link', ...h}),
        ).toBeInTheDocument(),
      );
      const dialog = screen.getByRole('dialog', {
        name: 'Insert link',
        ...h,
      });
      expect(dialog.querySelector('.astryx-layout-header')).toBeInTheDocument();
      expect(
        dialog.querySelector('.astryx-layout-content'),
      ).toBeInTheDocument();
      expect(dialog.querySelector('.astryx-layout-footer')).toBeInTheDocument();
      expect(
        screen.getByRole('textbox', {name: 'URL', ...h}),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {name: 'Add link', ...h}),
      ).toBeInTheDocument();
    } finally {
      browserPrompt.mockRestore();
    }
  });

  it('omits the Link button when hasLink is false', () => {
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar hasLink={false} />}
      />,
    );
    expect(
      screen.queryByRole('button', {name: 'Link'}),
    ).not.toBeInTheDocument();
  });

  it('opens link insertion on Cmd/Ctrl+K but ignores Cmd/Ctrl+Shift+K', async () => {
    const promptForUrl = vi.fn(() => null);
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar promptForUrl={promptForUrl} />}
      />,
    );
    const textbox = screen.getByRole('textbox');

    // Cmd+K (mac) / Ctrl+K (others) — matches isExactShortcutMatch, so the
    // link flow runs and asks for a URL. Fire both modifier variants so the
    // test is platform-agnostic.
    fireEvent.keyDown(textbox, {key: 'k', metaKey: true});
    fireEvent.keyDown(textbox, {key: 'k', ctrlKey: true});
    expect(promptForUrl).toHaveBeenCalled();

    // Adding Shift must NOT trigger it (exact-match semantics, matching the
    // Lexical playground).
    promptForUrl.mockClear();
    fireEvent.keyDown(textbox, {key: 'k', metaKey: true, shiftKey: true});
    fireEvent.keyDown(textbox, {key: 'k', ctrlKey: true, shiftKey: true});
    expect(promptForUrl).not.toHaveBeenCalled();
  });

  it('allows the root extension to remap or disable the link shortcut', () => {
    const promptForUrl = vi.fn(() => null);
    const {rerender} = render(
      <RichTextEditor
        label="Notes"
        extension={RemappedLinkEditorExtension}
        toolbar={<RichTextEditorToolbar promptForUrl={promptForUrl} />}
      />,
    );
    const press = (key: string) => {
      const textbox = screen.getByRole('textbox');
      fireEvent.keyDown(textbox, {key, metaKey: true});
      fireEvent.keyDown(textbox, {key, ctrlKey: true});
    };
    press('k');
    expect(promptForUrl).not.toHaveBeenCalled();
    press('j');
    expect(promptForUrl).toHaveBeenCalledTimes(1);
    rerender(
      <RichTextEditor
        label="Notes"
        extension={DisabledLinkShortcutExtension}
        toolbar={<RichTextEditorToolbar promptForUrl={promptForUrl} />}
      />,
    );
    press('k');
    press('j');
    expect(promptForUrl).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name: 'Link'}));
    expect(promptForUrl).toHaveBeenCalledTimes(2);
  });

  it('cleans up the link shortcut when the toolbar changes or unmounts', () => {
    const first = vi.fn(() => null);
    const next = vi.fn(() => null);
    const {rerender} = render(
      <StrictMode>
        <RichTextEditor
          label="Notes"
          toolbar={<RichTextEditorToolbar promptForUrl={first} />}
        />
      </StrictMode>,
    );
    const shortcut = () => {
      const textbox = screen.getByRole('textbox');
      fireEvent.keyDown(textbox, {key: 'k', metaKey: true});
      fireEvent.keyDown(textbox, {key: 'k', ctrlKey: true});
    };
    shortcut();
    expect(first).toHaveBeenCalledTimes(1);
    rerender(
      <StrictMode>
        <RichTextEditor
          label="Notes"
          toolbar={<RichTextEditorToolbar promptForUrl={next} />}
        />
      </StrictMode>,
    );
    shortcut();
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    rerender(
      <StrictMode>
        <RichTextEditor
          label="Notes"
          toolbar={
            <RichTextEditorToolbar hasLink={false} promptForUrl={next} />
          }
        />
      </StrictMode>,
    );
    shortcut();
    expect(next).toHaveBeenCalledTimes(1);
    rerender(
      <StrictMode>
        <RichTextEditor label="Notes" />
      </StrictMode>,
    );
    shortcut();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps toolbar history and selection state while the controls are unmounted', async () => {
    const ref = createRef<RichTextEditorRef>();
    const {rerender} = render(<RichTextEditor ref={ref} label="Notes" />);
    const editor = ref.current!.getEditor();
    await act(async () => {
      editor.update(() => $convertFromMarkdownString('First'), {
        discrete: true,
        tag: HISTORY_PUSH_TAG,
      });
      editor.update(
        () => {
          $convertFromMarkdownString('**Second**');
          // jsdom does not reconcile the DOM caret's pending format.
          $getRoot().getFirstDescendant()!.selectEnd().toggleFormat('bold');
        },
        {discrete: true, tag: HISTORY_PUSH_TAG},
      );
    });
    rerender(
      <RichTextEditor
        ref={ref}
        label="Notes"
        toolbar={<RichTextEditorToolbar />}
      />,
    );
    expect(ref.current!.getEditor()).toBe(editor);
    expect(screen.getByRole('button', {name: 'Bold'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Undo'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
    await waitFor(() => expect(ref.current!.getMarkdown()).toBe('First'));
    expect(screen.getByRole('button', {name: 'Redo'})).toBeEnabled();
    rerender(
      <RichTextEditor
        ref={ref}
        label="Notes"
        isReadOnly
        toolbar={<RichTextEditorToolbar />}
      />,
    );
    expect(screen.getByRole('button', {name: 'Bold'})).toBeDisabled();
    rerender(
      <RichTextEditor
        ref={ref}
        label="Notes"
        toolbar={<RichTextEditorToolbar />}
      />,
    );
    expect(screen.getByRole('button', {name: 'Bold'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: 'Redo'}));
    await waitFor(() => expect(ref.current!.getMarkdown()).toBe('**Second**'));
  });

  it('creates a sanitized link over the selected text via promptForUrl', async () => {
    let editor!: LexicalEditor;
    const promptForUrl = vi.fn(() => 'example.com');
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar promptForUrl={promptForUrl} />}
        plugins={<CaptureEditor onReady={e => (editor = e)} />}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());

    // Seed "hello" and select all of it so the toggle wraps a real range.
    // Seed + select in a single update so the RangeSelection is live when the
    // toolbar reads it.
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('hello');
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.select(0, 5);
    });

    fireEvent.click(screen.getByRole('button', {name: 'Link'}));

    expect(promptForUrl).toHaveBeenCalled();
    // The selection text is passed to the prompt (empty string is acceptable
    // if jsdom drops the range; the important contract is the sanitized href).
    // The link node exists with the sanitized (https, scheme-added) href.
    await waitFor(() => {
      let href: string | null = null;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const paragraph = root.getFirstChild();
        // Find the first LinkNode-like descendant (has getURL()).
        const descendants = $isElementNode(paragraph)
          ? paragraph.getChildren()
          : [];
        for (const child of descendants) {
          if ('getURL' in child) {
            href = (child as {getURL(): string}).getURL();
            break;
          }
        }
      });
      expect(href).toBe('https://example.com/');
    });
  });

  it('does not create a link when promptForUrl returns an unsafe scheme', async () => {
    let editor!: LexicalEditor;
    const promptForUrl = vi.fn(() => 'javascript:alert(1)');
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar promptForUrl={promptForUrl} />}
        plugins={<CaptureEditor onReady={e => (editor = e)} />}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('hello');
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.select(0, 5);
    });

    fireEvent.click(screen.getByRole('button', {name: 'Link'}));
    expect(promptForUrl).toHaveBeenCalled();

    // No link node was created — no descendant exposes getURL().
    let hasLinkNode = false;
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      const descendants = $isElementNode(paragraph)
        ? paragraph.getChildren()
        : [];
      for (const child of descendants) {
        if ('getURL' in child) {
          hasLinkNode = true;
        }
      }
    });
    expect(hasLinkNode).toBe(false);
  });
});

describe('RichTextEditorAutoLinkExtension', () => {
  it('renders without crashing inside the editor', () => {
    render(
      <RichTextEditor label="Notes" extension={AutoLinkEditorExtension} />,
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('exposes URL + email default matchers that open in a new tab', () => {
    expect(DEFAULT_LINK_MATCHERS).toHaveLength(2);
    const urlMatch = DEFAULT_LINK_MATCHERS[0]('see https://example.com now');
    expect(urlMatch).not.toBeNull();
    expect(urlMatch?.url).toBe('https://example.com/');
    expect(urlMatch?.attributes).toEqual(NEW_TAB_LINK_ATTRIBUTES);

    const emailMatch = DEFAULT_LINK_MATCHERS[1]('ping a@b.com please');
    expect(emailMatch).not.toBeNull();
    expect(emailMatch?.url).toBe('mailto:a@b.com');
    expect(emailMatch?.attributes).toEqual(NEW_TAB_LINK_ATTRIBUTES);
  });

  it('auto-links a typed URL as an AutoLinkNode', async () => {
    let editor!: LexicalEditor;
    render(
      <RichTextEditor
        label="Notes"
        extension={AutoLinkEditorExtension}
        plugins={<CaptureEditor onReady={e => (editor = e)} />}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());

    // A URL followed by a separator triggers the AutoLink transform.
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('visit https://example.com '));
      root.append(paragraph);
    });

    await waitFor(() => {
      let hasAutoLink = false;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const paragraph = root.getFirstChild();
        const children = $isElementNode(paragraph)
          ? paragraph.getChildren()
          : [];
        children.forEach(child => {
          if (child.getType() === 'autolink') {
            hasAutoLink = true;
          }
        });
      });
      expect(hasAutoLink).toBe(true);
    });
  });
});

describe('RichTextEditorToolbar — new-tab links', () => {
  it('bakes target=_blank + rel into the created link node by default', async () => {
    let editor!: LexicalEditor;
    const promptForUrl = vi.fn(() => 'example.com');
    render(
      <RichTextEditor
        label="Notes"
        toolbar={<RichTextEditorToolbar promptForUrl={promptForUrl} />}
        plugins={<CaptureEditor onReady={e => (editor = e)} />}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('hello');
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.select(0, 5);
    });

    fireEvent.click(screen.getByRole('button', {name: 'Link'}));

    // The attributes live on the NODE (not patched onto the DOM), so they are
    // readable from editor state and will serialize.
    await waitFor(() => {
      let target: string | null = null;
      let rel: string | null = null;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const paragraph = root.getFirstChild();
        const children = $isElementNode(paragraph)
          ? paragraph.getChildren()
          : [];
        for (const child of children) {
          if ('getTarget' in child) {
            const linkNode = child as unknown as {
              getTarget(): string | null;
              getRel(): string | null;
            };
            target = linkNode.getTarget();
            rel = linkNode.getRel();
          }
        }
      });
      expect(target).toBe('_blank');
      expect(rel).toBe('noopener noreferrer');
    });
  });

  it('omits new-tab attributes when linkOpensInNewTab is false', async () => {
    let editor!: LexicalEditor;
    const promptForUrl = vi.fn(() => 'example.com');
    render(
      <RichTextEditor
        label="Notes"
        toolbar={
          <RichTextEditorToolbar
            promptForUrl={promptForUrl}
            linkOpensInNewTab={false}
          />
        }
        plugins={<CaptureEditor onReady={e => (editor = e)} />}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('hello');
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.select(0, 5);
    });

    fireEvent.click(screen.getByRole('button', {name: 'Link'}));

    await waitFor(() => {
      let target: string | null | undefined = undefined;
      let sawLink = false;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const paragraph = root.getFirstChild();
        const children = $isElementNode(paragraph)
          ? paragraph.getChildren()
          : [];
        for (const child of children) {
          if ('getTarget' in child) {
            sawLink = true;
            target = (
              child as unknown as {getTarget(): string | null}
            ).getTarget();
          }
        }
      });
      expect(sawLink).toBe(true);
      expect(target).toBeNull();
    });
  });
});
