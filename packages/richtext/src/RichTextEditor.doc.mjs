// Copyright (c) Meta Platforms, Inc. and affiliates.

/** @type {import('@astryxdesign/cli/authoring').ComponentDoc} */

export const docs = {
  name: 'RichTextEditor',
  displayName: 'Rich Text Editor',
  category: 'Form Controls',
  keywords: [
    'richtext',
    'rich text',
    'wysiwyg',
    'editor',
    'lexical',
    'formatting',
    'contenteditable',
    'prose',
  ],
  props: [
    {
      name: 'label',
      type: 'string',
      description:
        'Label text for the editor. Always rendered for accessibility.',
      required: true,
    },
    {
      name: 'isLabelHidden',
      type: 'boolean',
      description:
        'Visually hide the label (still accessible to screen readers).',
      default: 'false',
    },
    {
      name: 'description',
      type: 'string',
      description: 'Description text displayed between the label and editor.',
    },
    {
      name: 'defaultValue',
      type: 'string',
      description:
        'Initial serialized editor state (JSON string from editorState.toJSON()). Read once on mount; the editor is uncontrolled.',
    },
    {
      name: 'onChange',
      type: '(editorState: EditorState, editor: LexicalEditor) => void',
      description:
        'Fired when content changes. Serialize with editorState.toJSON() for persistence.',
    },
    {
      name: 'placeholder',
      type: 'string',
      description:
        'Placeholder text shown when the editor is empty. Uses the same responsive body typography and text inset as the editable content.',
    },
    {
      name: 'isReadOnly',
      type: 'boolean',
      description: 'Whether the editor is read-only (non-editable).',
      default: 'false',
    },
    {
      name: 'isDisabled',
      type: 'boolean',
      description: 'Whether the editor is disabled (non-editable, dimmed).',
      default: 'false',
    },
    {
      name: 'status',
      type: '{ type: "warning" | "error" | "success"; message?: string }',
      description:
        'Validation status. Shows a colored border and status icon; an optional message follows the statusVariant placement. Error also sets aria-invalid.',
    },
    {
      name: 'statusVariant',
      type: "'attached' | 'detached' | 'tooltip'",
      description:
        'How the status is presented: attached keeps the icon in the editor and overlaps the message below; detached floats the message below with its own icon; tooltip hides the message box and reveals it from the focusable in-editor status icon.',
      default: "'attached'",
    },
    {
      name: 'size',
      type: "'sm' | 'md' | 'lg'",
      description: 'The size of the editor, affecting internal padding.',
      default: "'md'",
    },
    {
      name: 'nodes',
      type: 'ReadonlyArray<Klass<LexicalNode>>',
      description:
        'Additional Lexical nodes beyond the built-in CommonMark/GFM schema. Extension point for custom nodes (mentions, images) without forking.',
    },
    {
      name: 'toolbar',
      type: 'ReactNode',
      description:
        'Toolbar content rendered edge-to-edge at the top of the field, before the padded editing surface. Pass RichTextEditorToolbar here for correct visual and keyboard order.',
    },
    {
      name: 'plugins',
      type: 'ReactNode',
      description:
        'Additional React UI rendered inside the composer. Use extensions to configure editor behavior.',
    },
    {
      name: 'hasMarkdownShortcuts',
      type: 'boolean',
      description:
        'Enable CommonMark and GFM shortcut typing through @lexical/mdast (e.g. "# " for a heading). Import and export remain enabled when shortcuts are disabled.',
      default: 'true',
    },
    {
      name: 'extensions',
      type: 'ReadonlyArray<AnyLexicalExtensionArgument>',
      description:
        'Additional Lexical extensions for custom nodes, behavior, and mdast import/export rules. Read once on mount; use extension output signals for runtime configuration or a new React key to replace the graph. Pass the same content extensions to RichTextView and the serializer helpers.',
    },
    {
      name: 'hasAutoFocus',
      type: 'boolean',
      description: 'Automatically focus the editor on mount.',
      default: 'false',
    },
    {
      name: 'tabEscapeHint',
      type: 'string',
      description:
        'Screen-reader hint describing how to move focus out of the editor, since Tab is bound to indentation (press Escape, then Tab). Visually hidden, wired via aria-describedby. Override to localize; pass "" to omit.',
      default: "'Press Escape then Tab to move focus out of the editor.'",
    },
    {
      name: 'maxLength',
      type: 'number',
      description:
        'Maximum number of characters. When set, a character counter (current/max) is displayed below the editor. Like TextArea, does not enforce the limit natively; the counter shows error styling when the plain-text length exceeds the limit.',
    },
    {
      name: 'width',
      type: 'number | string',
      description:
        'Width of the field. Numbers are pixels, strings used as-is (e.g. "100%").',
    },
    {
      name: 'minHeight',
      type: 'SizeValue',
      description:
        'Minimum height of the editable content surface. Numbers are pixels; strings are used as CSS lengths. Content continues growing beyond this height.',
      default: "'4.5rem'",
    },
    {
      name: 'xstyle',
      type: 'StyleXStyles',
      description:
        'StyleX styles for layout customization. Must be a stylex.create() value, not an inline style object.',
    },
  ],
  theming: {
    targets: [{className: 'astryx-rich-text-editor', visualProps: []}],
  },
  usage: {
    description:
      'A WYSIWYG rich-text editor built on Lexical, styled with Astryx design tokens. Its field container shares TextArea input visuals for the resting border, hover ring, focus-within ring, disabled state, and status colors. Experimental component in @astryxdesign/richtext (canary). lexical and @lexical/* are optional peer dependencies. The editor is deliberately minimal and extensible: pass toolbar and extensions to layer richer behaviour (formatting, mentions, hover cards) on top without forking. Use RichTextView to render serialized content read-only.',
    bestPractices: [
      {
        guidance: true,
        description:
          'Install all declared Lexical peers at the same 0.51.x version before importing from @astryxdesign/richtext; see the package README for the install command.',
      },
      {
        guidance: true,
        description:
          'Persist content by serializing editorState.toJSON() in onChange; rehydrate via defaultValue / RichTextView value.',
      },
      {
        guidance: true,
        description:
          'Provide custom content extensions to the editor, RichTextView, and serializer helpers so nodes and Markdown rules round-trip. The nodes prop remains available for node-only additions.',
      },
      {
        guidance: true,
        description:
          'Use a ref (RichTextEditorRef) to imperatively focus(), clear(), read the state via getEditorState(), serialize to Markdown via getMarkdown() or HTML via getHTML(), or reach the LexicalEditor via getEditor(). The handle is available after mount. getMarkdown() uses the same mdast extension rules as import and shortcut typing. focus() and clear() are no-ops when the editor is read-only or disabled, and clear() resets to a single empty paragraph.',
      },
      {
        guidance: true,
        description:
          'To produce a defaultValue from Markdown without mounting an editor (e.g. on the server), use markdownToEditorStateJSON(markdown). Convert the other way with editorStateJSONToMarkdown(json). Both build and dispose an extension editor without mounting a DOM root, and accept the same extensions/nodes options as the editor. Content extensions used by the helpers must work without a DOM or React tree.',
      },
      {
        guidance: true,
        description:
          'Add a formatting toolbar with toolbar={<RichTextEditorToolbar />}. The dedicated slot places it edge-to-edge at the top of the field, before the padded editing surface, with correct keyboard order. It uses small Astryx Toolbar controls: undo/redo, a divided block-format Selector for paragraphs/headings/lists/quotes, then divided inline ToggleButtons for bold/italic/underline/strikethrough/code and links. The complete action row scrolls horizontally when space is tight, keeping every control directly available without a More menu. The Selector keeps its default adaptive placement. Compose extra controls via endContent.',
      },
      {
        guidance: true,
        description:
          'Links: the toolbar Link button (on by default; disable with hasLink={false}) and Cmd/Ctrl+K open an Astryx Dialog. The form preserves the Lexical selection while focus moves into the URL input and supports add, update, remove, Escape, and focus return. Pass promptForUrl only when integrating an existing synchronous URL flow. Entered URLs are sanitized (only http/https/mailto/tel are written; javascript:/data: are rejected). Links open in a new tab by default: target=_blank and rel=noopener noreferrer are written into the link node data; set linkOpensInNewTab={false} for same-tab links.',
      },
      {
        guidance: true,
        description:
          'Auto-linking: pass extensions={[RichTextEditorAutoLinkExtension]} to turn typed/pasted URLs and emails into links automatically. Created links open in a new tab by default (target=_blank, rel=noopener noreferrer, stored in the node). For custom matchers or change handlers, use configExtension(AutoLinkExtension, {matchers, changeHandlers}) from @lexical/link and lexical.',
      },
      {
        guidance: true,
        description:
          "The toolbar's glyphs are themeable. Each control resolves its icon from the core icon registry under a stable richtext:* key (see RICHTEXT_ICON_KEYS), falling back to a bundled inline SVG. A theme can restyle any glyph without forking the toolbar: registerIcons({'richtext:bold': <MyBoldIcon />}) from @astryxdesign/core/Icon. registerIcons now accepts arbitrary extension keys, and getExtendedIcon(key, fallback) resolves them; the same pattern any library can use to make its own icons theme-overridable.",
      },
      {
        guidance: false,
        description:
          'Use for single-line input or plain text; use TextInput or TextArea for those.',
      },
    ],
  },
};
