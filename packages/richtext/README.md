# @astryxdesign/richtext

Astryx rich text — a Lexical-based rich text editor and read-only viewer, styled
with Astryx design tokens.

```tsx
import {RichTextEditor, RichTextView} from '@astryxdesign/richtext';

<RichTextEditor label="Notes" onChange={setState} />;
<RichTextView label="Notes" value={serializedState} />;
```

The editor is built from Lexical extensions for rich text, lists, links, history,
Tab indentation, and CommonMark/GFM Markdown through `@lexical/mdast`.
`RichTextEditorToolbar` goes in the `toolbar` slot; additional React UI can use
`plugins`. Configure custom nodes, behavior, and Markdown rules with `extensions`.
Pass the same content extensions to `RichTextView`, `markdownToEditorStateJSON`,
and `editorStateJSONToMarkdown` so persisted content round-trips. The serializers
build and dispose an editor without mounting a DOM root; their extensions must
work without a DOM or React tree.

`lexical` and the `@lexical/*` packages are **optional** peer dependencies —
install the matching 0.50.x packages below to use richtext. It consumes
`@astryxdesign/core` theme tokens directly.

It ships to npm **only under the `@canary` dist-tag** — there is never a stable
(`latest`) release yet.

> Note: this package is the successor to the experimental `RichTextEditor` that
> used to live in `@astryxdesign/lab`; that code has moved here so it can be
> canaried independently (e.g. into EPS/Nest) without a fresh package rollout.

## Status

Under active development. The editor, view, composable toolbar, and Markdown
serializers are in place; API and visuals are still being refined. The goal is
graduation to `@astryxdesign/core` after the design/API stabilizes.

## Usage

Inside the monorepo (storybook/sandbox), imports resolve via pnpm workspaces:

```tsx
import {RichTextEditor, RichTextView} from '@astryxdesign/richtext';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/richtext/richtext.css';
```

Interactive examples live in the storybook app under **Lab/RichTextEditor**
(`apps/storybook/stories/RichTextEditor.stories.tsx`).

### Trying richtext in your own project (canary)

`@astryxdesign/richtext` is published **only** under the `@canary` dist-tag, so
you must request that tag explicitly. There is no `latest` version to install.

```bash
npm install @astryxdesign/richtext@canary @astryxdesign/core@canary
# plus the optional lexical peers you use:
npm install lexical@0.50.0 @lexical/react@0.50.0 @lexical/extension@0.50.0 \
  @lexical/mdast@0.50.0 @lexical/rich-text@0.50.0 @lexical/list@0.50.0 \
  @lexical/link@0.50.0 @lexical/code-core@0.50.0 @lexical/html@0.50.0 \
  @lexical/selection@0.50.0 @lexical/utils@0.50.0 @lexical/history@0.50.0 \
  @lexical/clipboard@0.50.0 @lexical/table@0.50.0
```

> Canary builds track the latest commit on `main` (`0.x.y-canary.<sha>`). They
> can break between any two versions — pin an exact version if you need
> stability.

### Migrating to extensions and mdast

This canary changes the Markdown customization API:

- Replace `transformers` / `Transformer` with mdast extensions in `extensions`.
  `MdastImportExtension` accepts import/export rules and parser/serializer
  extensions; import, export, and typing shortcuts share that configuration.
- Replace `plugins={<RichTextEditorAutoLinkPlugin />}` with
  `extensions={[RichTextEditorAutoLinkExtension]}`. For custom matching or link
  notifications, use `configExtension(AutoLinkExtension, {matchers, changeHandlers})`
  from `@lexical/link` and `lexical`.
- The extension graph and `nodes` are read once on mount. Runtime props such as
  editability, `onChange`, and `hasMarkdownShortcuts` update the existing editor.
  Use extension output signals for runtime configuration or change the React
  `key` to replace the graph.

`defaultValue` still accepts serialized Lexical JSON. Markdown now follows
CommonMark and GFM, including reference links, task lists, tables, thematic
breaks, and soft line breaks. Serializer output can differ from the old
transformer output; imported syntax such as bullet/fence styles is preserved
where supported by mdast.

```tsx
import {
  RichTextEditor,
  RichTextEditorAutoLinkExtension,
  RichTextEditorToolbar,
} from '@astryxdesign/richtext';

<RichTextEditor
  label="Notes"
  extensions={[RichTextEditorAutoLinkExtension]}
  toolbar={<RichTextEditorToolbar />}
/>;
```

## Why no stable release?

`package.json` keeps `"private": true` plus an `"astryx": { "canaryOnly": true }`
marker. The release workflow's stable (`latest`) job skips both private and
`canaryOnly` packages, while the canary job strips `private` in its ephemeral CI
checkout only (never in git) to publish the `@canary` tag. The committed
`private: true` is npm's hard guarantee that no stable publish can ever happen —
**do not remove it.**

## Publishing publicly (when the editor/view are ready)

When maintainers are ready to promote richtext to a stable public release:

1. Remove `"private": true` **and** the `"astryx": { "canaryOnly": true }`
   marker from `package.json`.
2. Add a changeset (`pnpm changeset`) selecting `@astryxdesign/richtext` so the
   release workflow versions and publishes it to the `latest` dist-tag.
3. The stable (`latest`) release job (`.github/workflows/release.yml`) will then
   include richtext on the next release.
