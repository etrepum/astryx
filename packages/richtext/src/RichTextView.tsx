// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file RichTextView.tsx
 * @input Uses React, Lexical (lexical + @lexical/react, composed through
 *   LexicalExtensionComposer), reactive value and shared content extensions, design tokens
 * @output Exports RichTextView component and RichTextViewProps
 * @position Read-only renderer for serialized Lexical editor state; experimental
 *   (richtext), exported from @astryxdesign/richtext
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/richtext/src/RichTextView.test.tsx
 * - /packages/richtext/src/index.ts
 * - /apps/storybook/stories/RichTextEditor.stories.tsx
 */

import {useEffect, useRef, useState, type ReactNode} from 'react';
import * as stylex from '@stylexjs/stylex';
import {sharedEditorTheme} from './editorTheme';
import type {BaseProps} from '@astryxdesign/core';

import {LexicalExtensionComposer} from '@lexical/react/LexicalExtensionComposer';
import {useExtensionDependency} from '@lexical/react/useExtensionComponent';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import type {
  AnyLexicalExtension,
  AnyLexicalExtensionArgument,
  Klass,
  LexicalNode,
  EditorThemeClasses,
} from 'lexical';
import {configExtension, defineExtension} from 'lexical';
import {RichTextViewExtension} from './RichTextViewExtension';

const styles = stylex.create({
  root: {
    width: '100%',
  },
});

export interface RichTextViewProps extends BaseProps {
  /**
   * Serialized editor state to render (a JSON string produced by
   * `JSON.stringify(editorState.toJSON())`).
   */
  value: string;
  /**
   * Additional Lexical nodes to register beyond the default OSS set. Must match
   * the nodes used to author `value` so custom node types deserialize.
   */
  nodes?: ReadonlyArray<Klass<LexicalNode>>;
  /** Content extensions matching those used by the editor and serializers. Read once on mount. */
  extensions?: ReadonlyArray<AnyLexicalExtensionArgument>;
  /**
   * Additional read-only plugins to render inside the composer (e.g. hover
   * cards, decorators).
   */
  plugins?: ReactNode;
  /** The Lexical composer namespace. @default 'astryx-view' */
  namespace?: string;
  /**
   * Called when `value` cannot be parsed/rendered (e.g. malformed JSON, or
   * state authored with node types not registered via `nodes`). A read-only
   * view renders *persisted* content — exactly where stale or foreign-schema
   * state shows up — so by default a parse failure renders `errorFallback`
   * instead of throwing and taking down the host. Provide `onParseError` to log or
   * report it.
   */
  onParseError?: (error: Error) => void;
  /**
   * What to render when `value` fails to parse/render. Defaults to `null`
   * (renders nothing). Pass a node to show a placeholder/empty state.
   * @default null
   */
  errorFallback?: ReactNode;
}

/** Forward current React props to the view extension's value signal. */
function ViewPropsBridge({value}: {value: string}): null {
  const {output} = useExtensionDependency(RichTextViewExtension);
  useEffect(() => {
    output.value.value = value;
  }, [output, value]);
  return null;
}

/**
 * A read-only renderer for serialized Lexical content. Renders the same styled
 * output as {@link RichTextEditor} without any editing affordances.
 *
 * @example
 * ```
 * import {RichTextView} from '@astryxdesign/richtext';
 * <RichTextView value={storedEditorStateJSON} />
 * ```
 */
export function RichTextView({
  value,
  nodes,
  extensions,
  plugins,
  namespace = 'astryx-view',
  onParseError,
  errorFallback = null,
  xstyle,
  className,
  style,
  ...rest
}: RichTextViewProps) {
  const themeRef = useRef<EditorThemeClasses | null>(null);
  if (themeRef.current === null) {
    themeRef.current = sharedEditorTheme();
  }

  // Built on first render (and again after an error, below) rather than per
  // render: LexicalExtensionComposer re-creates the editor whenever the
  // extension's identity changes, and `value` updates are applied in place by
  // RichTextViewExtension instead.
  const extensionRef = useRef<AnyLexicalExtension | null>(null);

  const [hasError, setHasError] = useState(false);

  // Reset the error state when the value changes so a corrected value recovers.
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value && hasError) {
    lastValueRef.current = value;
    setHasError(false);
  } else {
    lastValueRef.current = value;
  }

  const handleError = (error: Error) => {
    onParseError?.(error);
    setHasError(true);
  };

  // Validate `value` parses as JSON before handing it to Lexical. Malformed
  // JSON would otherwise throw synchronously while the composer builds the
  // editor and escape any error boundary, taking down the host on the render
  // path.
  if (!hasError) {
    try {
      JSON.parse(value);
    } catch (err) {
      handleError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  if (hasError) {
    // The composer subtree is unmounted while the fallback renders. Drop the
    // extension so that recovering from the error builds a fresh one, seeded
    // with the corrected `value`.
    extensionRef.current = null;
    return (
      <div
        {...stylex.props(styles.root, xstyle)}
        className={className}
        style={style}
        {...rest}>
        {errorFallback}
      </div>
    );
  }

  if (extensionRef.current === null) {
    extensionRef.current = defineExtension({
      name: '@astryxdesign/richtext/RichTextView',
      namespace,
      theme: themeRef.current,
      editable: false,
      dependencies: [
        configExtension(RichTextViewExtension, {value}),
        ...(extensions ?? []),
      ],
      nodes: nodes ? [...nodes] : [],
      $initialEditorState: value,
      // A read-only view renders persisted content; a bad node/schema should not
      // crash the host. Surface it via onParseError + fallback instead of re-throwing.
      onError: handleError,
    });
  }

  return (
    <div
      {...stylex.props(styles.root, xstyle)}
      className={className}
      style={style}
      {...rest}>
      <LexicalExtensionComposer
        extension={extensionRef.current}
        contentEditable={null}>
        <ViewPropsBridge value={value} />
        <ContentEditable />
        {plugins}
      </LexicalExtensionComposer>
    </div>
  );
}

RichTextView.displayName = 'RichTextView';
