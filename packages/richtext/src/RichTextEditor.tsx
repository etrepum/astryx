// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file RichTextEditor.tsx
 * @input Uses React, useId, Lexical (lexical + @lexical/react, composed through
 *   LexicalExtensionComposer and behavior extensions), @lexical/mdast, Field,
 *   VisuallyHidden, useInputStatusIcon, mergeProps, design tokens
 * @output Exports an accessibly labelled RichTextEditor component with a flush
 *   top toolbar slot and configurable editable-surface minimum height, RichTextEditorProps,
 *   RichTextEditorStatus, RichTextEditorStatusType, RichTextEditorSize
 * @position Experimental (richtext) implementation; consumed by the package index.ts and
 *   re-exported from @astryxdesign/richtext. Tested by RichTextEditor.test.tsx.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/richtext/src/RichTextEditor.doc.mjs (props table, features, implementation notes)
 * - /packages/richtext/src/RichTextEditor.test.tsx (tests for new/changed behavior)
 * - /packages/richtext/src/index.ts (exports if types change)
 * - /apps/storybook/stories/RichTextEditor.stories.tsx (storybook stories)
 *
 * NOTE: This is an EXPERIMENTAL component in @astryxdesign/richtext (published only under
 * the `@canary` dist-tag, never as stable `latest`). It is the initial landing for the
 * OSS Lexical editor RFC; the goal is graduation to @astryxdesign/core after the
 * Component Specification Protocol. `lexical` and `@lexical/*` are OPTIONAL peer
 * dependencies — install them to use this component.
 */

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
  type Ref,
} from 'react';
import * as stylex from '@stylexjs/stylex';
import {
  colorVars,
  spacingVars,
  typographyVars,
  typeScaleVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import {sharedEditorTheme} from './editorTheme';
import {
  Field,
  inputWrapperStyles,
  inputStatusBorderStyles,
  inputStatusHoverShadowStyles,
  inputStatusFocusWithinStyles,
  type FieldStatusVariant,
} from '@astryxdesign/core/Field';
import type {BaseProps} from '@astryxdesign/core';
import {useInputStatusIcon} from '@astryxdesign/core/hooks';
import {VisuallyHidden} from '@astryxdesign/core/VisuallyHidden';
import {mergeProps, themeProps, type SizeValue} from '@astryxdesign/core/utils';
import {useSize} from '@astryxdesign/core/SizeContext';

import {LexicalExtensionComposer} from '@lexical/react/LexicalExtensionComposer';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import {useExtensionDependency} from '@lexical/react/useExtensionComponent';
import {AutoFocusExtension} from '@lexical/extension';
import {
  $convertToMarkdownString,
  MdastShortcutsExtension,
} from '@lexical/mdast';
import {$generateHtmlFromNodes} from '@lexical/html';
import {RichTextEditorExtension} from './RichTextEditorExtension';
import {
  CLEAR_EDITOR_COMMAND,
  configExtension,
  defineExtension,
  type AnyLexicalExtension,
  type AnyLexicalExtensionArgument,
  type EditorState,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type EditorThemeClasses,
} from 'lexical';

const styles = stylex.create({
  wrapper: {
    // Establish a new container boundary so Toolbar's Section does not escape
    // padding inherited from an ancestor Section outside the editor field.
    '--container-padding-inline-start': '0px',
    '--container-padding-inline-end': '0px',
    '--container-padding-block-start': '0px',
    '--container-padding-block-end': '0px',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacingVars['--spacing-0'],
    paddingBlock: spacingVars['--spacing-0'],
    paddingInline: spacingVars['--spacing-0'],
    minHeight: 'auto',
  },
  editorBody: {
    position: 'relative',
    boxSizing: 'border-box',
    width: '100%',
    paddingBlock: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-2'],
  },
  editorBodyWithToolbar: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colorVars['--color-border'],
  },
  editorBodyWithStatus: {
    // Reserve the same trailing space as TextArea: the normal text inset plus
    // room for the 20px status icon and its gap.
    paddingInlineEnd: `calc(${spacingVars['--spacing-2']} + ${spacingVars['--spacing-6']})`,
  },
  contentEditable: {
    display: 'block',
    width: '100%',
    borderWidth: 0,
    borderStyle: 'none',
    padding: 0,
    outline: 'none',
    color: colorVars['--color-text-primary'],
  },
  placeholder: {
    position: 'absolute',
    top: spacingVars['--spacing-0'],
    insetInlineStart: 0,
    pointerEvents: 'none',
    userSelect: 'none',
    color: colorVars['--color-text-secondary'],
  },
  editorRoot: {
    position: 'relative',
    width: '100%',
    // ContentEditable and Lexical's sibling placeholder inherit one shared
    // text style. This keeps their leading and coarse-pointer sizing identical
    // to TextInput/TextArea without duplicating placeholder typography. The
    // 16px floor is iOS-only: iOS Safari zooms the page when a focused
    // control sits under 16px, and only iOS WebKit implements
    // -webkit-touch-callout to key the coarse-pointer floor to it.
    fontFamily: typographyVars['--font-family-body'],
    fontSize: {
      default: typeScaleVars['--text-body-size'],
      '@media (pointer: coarse)': {
        '@supports (-webkit-touch-callout: none)': `max(1rem, ${typeScaleVars['--text-body-size']})`,
      },
    },
    lineHeight: typeScaleVars['--text-body-leading'],
  },
  statusIcon: {
    position: 'absolute',
    top: spacingVars['--spacing-2'],
    insetInlineEnd: spacingVars['--spacing-2'],
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
  },
  disabled: {
    cursor: 'not-allowed',
  },
  counter: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: spacingVars['--spacing-1'],
    fontFamily: typographyVars['--font-family-body'],
    fontSize: typeScaleVars['--text-supporting-size'],
    color: colorVars['--color-text-secondary'],
  },
  counterError: {
    color: colorVars['--color-error'],
  },
});

const dynamicStyles = stylex.create({
  contentEditableMinHeight: (minHeight: SizeValue) => ({minHeight}),
});

const editorBodySizeStyles = stylex.create({
  sm: {},
  md: {},
  lg: {
    paddingBlock: spacingVars['--spacing-2'],
  },
});

/**
 * Default screen-reader hint advertising the Tab escape. Overridable (or
 * suppressible) via the `tabEscapeHint` prop for localization.
 */
const DEFAULT_TAB_ESCAPE_HINT =
  'Press Escape then Tab to move focus out of the editor.';

/**
 * Fraction of `maxLength` at which the character counter begins announcing
 * remaining/over-limit characters to screen readers. Matches TextArea.
 */
const COUNTER_WARNING_THRESHOLD = 0.8;

export type RichTextEditorStatusType = 'warning' | 'error' | 'success';

export type RichTextEditorSize = 'sm' | 'md' | 'lg';

export interface RichTextEditorStatus {
  /** The type of status to display. */
  type: RichTextEditorStatusType;
  /** Optional message to display below the editor. */
  message?: string;
}

/**
 * Imperative handle exposed via `ref`. Lets callers focus, clear, and read the
 * editor without wiring a custom plugin. Available after mount.
 */
export interface RichTextEditorRef {
  /**
   * Move focus into the editor's editable surface. No-op when the editor is
   * read-only or disabled.
   */
  focus: () => void;
  /**
   * Remove all content, resetting the editor to a single empty paragraph.
   * No-op when the editor is read-only or disabled.
   */
  clear: () => void;
  /** Read the current `EditorState`. Serialize with `.toJSON()` to persist. */
  getEditorState: () => EditorState;
  /**
   * Serialize the current content to a Markdown string, using the same
   * mdast extensions as import and shortcut typing. Equivalent to
   * `$convertToMarkdownString` run in a read context.
   */
  getMarkdown: () => string;
  /**
   * Serialize the current content to an HTML string via
   * `$generateHtmlFromNodes`. Requires a DOM (available in the browser and in
   * jsdom-based tests). Useful for copy/paste, email, or non-Lexical consumers.
   */
  getHTML: () => string;
  /**
   * Access the underlying `LexicalEditor` instance for advanced use cases
   * (custom commands, listeners, node transforms).
   */
  getEditor: () => LexicalEditor;
}

export interface RichTextEditorProps extends Omit<
  BaseProps,
  'onChange' | 'defaultValue'
> {
  /** Label text for the editor (always rendered for accessibility). */
  label: string;
  /**
   * Whether to visually hide the label (still accessible to screen readers).
   * @default false
   */
  isLabelHidden?: boolean;
  /** Description text displayed between the label and editor. */
  description?: string;
  /**
   * Whether the field is optional. Mutually exclusive with isRequired.
   * @default false
   */
  isOptional?: boolean;
  /**
   * Whether the field is required. Mutually exclusive with isOptional.
   * @default false
   */
  isRequired?: boolean;
  /**
   * Initial serialized editor state (a JSON string produced by
   * `JSON.stringify(editorState.toJSON())`), used to seed the editor on mount.
   * The editor is uncontrolled: this is read once.
   */
  defaultValue?: string;
  /**
   * Callback fired when the editor content changes. Receives the current
   * `EditorState` and the `LexicalEditor` instance. Serialize with
   * `editorState.toJSON()` for persistence.
   */
  onChange?: (editorState: EditorState, editor: LexicalEditor) => void;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  /**
   * Whether the editor is read-only (non-editable).
   * @default false
   */
  isReadOnly?: boolean;
  /**
   * Whether the editor is disabled (non-editable, dimmed).
   * @default false
   */
  isDisabled?: boolean;
  /**
   * Status indicator. When set, displays a colored border. If message is
   * provided, displays a message box below the editor.
   */
  status?: RichTextEditorStatus;
  /**
   * How the status message is placed relative to the editor.
   * - 'attached': message overlaps directly below the editor and the status
   *   icon remains inside the editing surface
   * - 'detached': message floats below with its own leading status icon
   * - 'tooltip': no message box; the in-editor status icon becomes a focusable
   *   info-tip button that reveals the message
   * @default 'attached'
   */
  statusVariant?: FieldStatusVariant;
  /**
   * Width of the field. Numbers are treated as pixels, strings are used as-is
   * (e.g. `'100%'`).
   */
  width?: SizeValue;
  /**
   * Minimum height of the editable content surface. Numbers are treated as
   * pixels, strings are used as CSS lengths.
   * @default '4.5rem'
   */
  minHeight?: SizeValue;
  /** Tooltip text to display in an info icon at the end of the label. */
  labelTooltip?: string;
  /**
   * The size of the editor, affecting internal padding.
   * @default 'md'
   */
  size?: RichTextEditorSize;
  /**
   * Additional Lexical nodes beyond the built-in CommonMark/GFM schema.
   * Use this extension point to plug in
   * custom nodes (e.g. mentions, images) without forking the editor.
   */
  nodes?: ReadonlyArray<Klass<LexicalNode>>;
  /**
   * Toolbar content rendered edge-to-edge at the top of the field, before the
   * padded editing surface. Pass `<RichTextEditorToolbar />` here so the
   * toolbar stays inside the Lexical composer while retaining correct visual
   * and keyboard order.
   */
  toolbar?: ReactNode;
  /**
   * Additional React UI inside the composer. Components can access the editor
   * via `useLexicalComposerContext()`. Configure editor behavior with extensions.
   */
  plugins?: ReactNode;
  /**
   * Additional Lexical extensions, including custom nodes, behavior, and mdast
   * import/export rules. Read once on mount; use extension output signals for
   * runtime configuration, or remount with a new key to change the graph.
   * Pass the same content extensions to the serializers and RichTextView.
   */
  extensions?: ReadonlyArray<AnyLexicalExtensionArgument>;
  /**
   * Whether to enable mdast shortcut typing (e.g. `# ` for a heading,
   * `- ` for a list). Import and export remain available when disabled.
   * @default true
   */
  hasMarkdownShortcuts?: boolean;
  /** Whether to automatically focus the editor on mount. @default false */
  hasAutoFocus?: boolean;
  /**
   * Screen-reader hint describing how to move focus out of the editor, since
   * Tab is bound to indentation (press Escape, then Tab). Rendered visually
   * hidden and referenced from the editor's `aria-describedby`. Override it
   * to localize the text, or pass an empty string to omit the hint entirely
   * (e.g. when the host app provides its own instructions).
   * @default 'Press Escape then Tab to move focus out of the editor.'
   */
  tabEscapeHint?: string;
  /**
   * Maximum number of characters. When set, a character counter
   * (current/max) is displayed below the editor. Like TextArea, this does
   * NOT enforce the limit natively — the counter shows error styling when the
   * plain-text length exceeds the limit. Count is the editor's plain-text
   * content length.
   */
  maxLength?: number;
  /**
   * The Lexical composer namespace, used for editor identity.
   * @default 'astryx-editor'
   */
  namespace?: string;
}

/**
 * A WYSIWYG rich-text editor built on Lexical, styled with Astryx design
 * tokens. Experimental — ships from `@astryxdesign/richtext` (canary). `lexical` and
 * `@lexical/*` are optional peer dependencies — install them to use this
 * component.
 *
 * Pass `toolbar` and `extensions` to add formatting controls, mentions, and
 * other behavior without forking.
 *
 * The forwarded `RichTextEditorRef` exposes imperative `focus()` and `clear()`
 * methods for callers that manage the editor from outside.
 *
 * @example
 * ```
 * import {RichTextEditor, type RichTextEditorRef} from '@astryxdesign/richtext';
 * const ref = useRef<RichTextEditorRef>(null);
 * <RichTextEditor
 *   ref={ref}
 *   label="Notes"
 *   placeholder="Write something..."
 *   onChange={state => save(JSON.stringify(state.toJSON()))}
 * />
 * ```
 */
export const RichTextEditor = forwardRef<
  RichTextEditorRef,
  RichTextEditorProps
>(function RichTextEditor(
  {
    label,
    isLabelHidden = false,
    description,
    isOptional = false,
    isRequired = false,
    defaultValue,
    onChange,
    placeholder,
    isReadOnly = false,
    isDisabled = false,
    status,
    statusVariant = 'attached',
    width,
    minHeight = '4.5rem',
    labelTooltip,
    size: sizeProp,
    nodes,
    toolbar,
    plugins,
    hasMarkdownShortcuts = true,
    extensions,
    hasAutoFocus = false,
    tabEscapeHint = DEFAULT_TAB_ESCAPE_HINT,
    maxLength,
    namespace = 'astryx-editor',
    xstyle,
    className,
    style,
    ...rest
  }: RichTextEditorProps,
  ref: Ref<RichTextEditorRef>,
) {
  const size = useSize(sizeProp, 'md');
  const inputID = useId();
  const labelID = useId();
  const descriptionID = useId();
  const statusMessageID = useId();
  const placeholderID = useId();
  const counterID = useId();
  const tabEscapeHintID = useId();

  // Plain-text character count supplied by the editor extension when requested.
  const [charCount, setCharCount] = useState(0);

  // Theme is stable per render; build once.
  const themeRef = useRef<EditorThemeClasses | null>(null);
  if (themeRef.current === null) {
    themeRef.current = sharedEditorTheme();
  }

  const editable = !isReadOnly && !isDisabled;

  // The extension replaces LexicalComposer's `initialConfig`: it carries the
  // same editor configuration (namespace, theme, nodes, editability, initial
  // state) in the shape LexicalBuilder consumes.
  //
  // LexicalExtensionComposer re-creates the editor whenever the extension's
  // identity changes, whereas LexicalComposer read `initialConfig` exactly once
  // on mount. Build it on first render and keep it, so the editor's lifetime —
  // and the content it holds — is unaffected by later renders (a consumer
  // passing an inline `nodes={[...]}` array would otherwise blow away the
  // editor's content on every render).
  const extensionRef = useRef<AnyLexicalExtension | null>(null);
  if (extensionRef.current === null) {
    extensionRef.current = defineExtension({
      name: '@astryxdesign/richtext/RichTextEditor',
      namespace,
      theme: themeRef.current,
      editable,
      dependencies: [
        RichTextEditorExtension,
        configExtension(MdastShortcutsExtension, {
          disabled: !hasMarkdownShortcuts,
        }),
        ...(extensions ?? []),
      ],
      nodes: nodes ? [...nodes] : [],
      // `undefined` (not `null`) leaves Lexical's default initializer in place,
      // which seeds the empty document with one paragraph — what
      // LexicalComposer did when no `editorState` was given. `null` would mean
      // "start from a genuinely empty root".
      $initialEditorState: defaultValue ?? undefined,
      onError(error: Error) {
        // Surface errors to the host app rather than swallowing them.
        throw error;
      },
    });
  }

  const hasTabEscapeHint = editable && tabEscapeHint !== '';
  const hasToolbar = toolbar != null && typeof toolbar !== 'boolean';

  const {statusIcon, describedBy: statusTooltipDescribedBy} =
    useInputStatusIcon({
      status,
      statusVariant,
    });

  const ariaDescribedBy =
    [
      description ? descriptionID : null,
      statusVariant !== 'tooltip' && status?.message ? statusMessageID : null,
      // Tooltip status renders no FieldStatus message box. Reference the
      // tooltip layer so assistive technology still receives the message.
      statusTooltipDescribedBy,
      placeholder ? placeholderID : null,
      maxLength != null ? counterID : null,
      hasTabEscapeHint ? tabEscapeHintID : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <Field
      label={label}
      isLabelHidden={isLabelHidden}
      description={description}
      inputID={inputID}
      labelID={labelID}
      descriptionID={description ? descriptionID : undefined}
      isOptional={isOptional}
      isRequired={isRequired}
      isDisabled={isDisabled}
      status={
        status
          ? {
              type: status.type,
              message: status.message,
              messageID: status.message ? statusMessageID : undefined,
            }
          : undefined
      }
      statusVariant={statusVariant}
      labelTooltip={labelTooltip}
      width={width}>
      <div
        {...mergeProps(
          themeProps('rich-text-editor', {
            size,
            status: status?.type ?? null,
          }),
          stylex.props(
            inputWrapperStyles.base,
            styles.wrapper,
            (isDisabled || isReadOnly) && inputWrapperStyles.disabled,
            isDisabled && styles.disabled,
            status && inputStatusBorderStyles[status.type],
            status &&
              !isDisabled &&
              !isReadOnly &&
              inputStatusHoverShadowStyles[status.type],
            status && inputStatusFocusWithinStyles[status.type],
            xstyle,
          ),
          className,
          style,
        )}>
        <LexicalExtensionComposer
          extension={extensionRef.current}
          contentEditable={null}>
          {hasToolbar ? toolbar : null}
          <div
            {...stylex.props(
              styles.editorBody,
              hasToolbar && styles.editorBodyWithToolbar,
              !!statusIcon && styles.editorBodyWithStatus,
              editorBodySizeStyles[size],
            )}>
            <div {...stylex.props(styles.editorRoot)}>
              <EditorContentEditable
                id={inputID}
                ariaLabel={isLabelHidden ? label : undefined}
                ariaLabelledBy={isLabelHidden ? undefined : labelID}
                ariaDescribedBy={ariaDescribedBy}
                ariaRequired={isRequired && !isOptional}
                ariaInvalid={status?.type === 'error'}
                placeholderText={placeholder}
                placeholderID={placeholderID}
                minHeight={minHeight}
                rest={rest}
              />
              {plugins}
              <EditorRefBridge
                editorRef={ref}
                editable={editable}
                hasAutoFocus={hasAutoFocus}
                hasMarkdownShortcuts={hasMarkdownShortcuts}
                onChange={onChange}
                onCountChange={maxLength != null ? setCharCount : undefined}
              />
            </div>
            {statusIcon && (
              <div {...stylex.props(styles.statusIcon)}>{statusIcon}</div>
            )}
          </div>
        </LexicalExtensionComposer>
        {hasTabEscapeHint && (
          <VisuallyHidden id={tabEscapeHintID}>{tabEscapeHint}</VisuallyHidden>
        )}
      </div>
      {maxLength != null && (
        <div
          id={counterID}
          {...stylex.props(
            styles.counter,
            charCount > maxLength && styles.counterError,
          )}>
          {charCount}/{maxLength}
          <VisuallyHidden aria-live="polite">
            {charCount >= maxLength * COUNTER_WARNING_THRESHOLD
              ? charCount > maxLength
                ? `${charCount - maxLength} characters over limit`
                : `${maxLength - charCount} characters remaining`
              : ''}
          </VisuallyHidden>
        </div>
      )}
    </Field>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

/** Connect current React props and the public ref to the extension-built editor. */
function EditorRefBridge({
  editorRef,
  editable,
  hasAutoFocus,
  hasMarkdownShortcuts,
  onChange,
  onCountChange,
}: {
  editorRef: Ref<RichTextEditorRef>;
  editable: boolean;
  hasAutoFocus: boolean;
  hasMarkdownShortcuts: boolean;
  onChange: RichTextEditorProps['onChange'];
  onCountChange: ((count: number) => void) | undefined;
}): null {
  const [editor] = useLexicalComposerContext();
  const {output: callbacks} = useExtensionDependency(RichTextEditorExtension);
  const {output: shortcuts} = useExtensionDependency(MdastShortcutsExtension);
  const {output: autoFocus} = useExtensionDependency(AutoFocusExtension);

  useEffect(() => {
    editor.setEditable(editable);
    shortcuts.disabled.value = !hasMarkdownShortcuts;
    autoFocus.disabled.value = !hasAutoFocus || !editable;
  }, [
    editor,
    editable,
    hasAutoFocus,
    hasMarkdownShortcuts,
    shortcuts,
    autoFocus,
  ]);

  useEffect(() => {
    callbacks.onChange.value = onChange;
    callbacks.onCountChange.value = onCountChange;
    return () => {
      callbacks.onChange.value = undefined;
      callbacks.onCountChange.value = undefined;
    };
  }, [callbacks, onChange, onCountChange]);

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        if (editor.isEditable()) {
          editor.focus();
        }
      },
      clear: () => {
        if (editor.isEditable()) {
          editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
        }
      },
      getEditorState: () => editor.getEditorState(),
      getMarkdown: () => editor.read(() => $convertToMarkdownString()),
      getHTML: () => editor.read(() => $generateHtmlFromNodes(editor, null)),
      getEditor: () => editor,
    }),
    [editor],
  );
  return null;
}

/**
 * Renders the Lexical ContentEditable. Split out so the placeholder
 * discriminated union (`placeholder` + `aria-placeholder` present together, or
 * neither) is satisfied by two concrete branches rather than a spread.
 */
function EditorContentEditable({
  id,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaRequired,
  ariaInvalid,
  placeholderText,
  placeholderID,
  minHeight,
  rest,
}: {
  id: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaRequired: boolean;
  ariaInvalid: boolean;
  placeholderText?: string;
  placeholderID: string;
  minHeight: SizeValue;
  rest: Record<string, unknown>;
}) {
  const shared = {
    id,
    role: 'textbox' as const,
    'aria-multiline': 'true' as const,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-required': ariaRequired ? ('true' as const) : undefined,
    'aria-invalid': ariaInvalid ? ('true' as const) : undefined,
    ...stylex.props(
      styles.contentEditable,
      dynamicStyles.contentEditableMinHeight(minHeight),
    ),
    ...rest,
  };
  if (placeholderText) {
    return (
      <ContentEditable
        {...shared}
        aria-placeholder={placeholderText}
        placeholder={() => (
          <div
            id={placeholderID}
            aria-hidden="true"
            {...stylex.props(styles.placeholder)}>
            {placeholderText}
          </div>
        )}
      />
    );
  }
  return <ContentEditable {...shared} />;
}
