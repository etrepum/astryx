// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file RichTextEditorAutoLinkExtension.ts
 * @input Uses Lexical's AutoLinkExtension and the shared URL/email matchers.
 * @output Opt-in auto-link extension, default matchers, and link attributes.
 * @position Public behavior extension for RichTextEditor's extensions prop.
 *   For custom matching, configure @lexical/link's AutoLinkExtension directly.
 */

import {
  AutoLinkExtension,
  createLinkMatcherWithRegExp,
  type LinkMatcher,
} from '@lexical/link';
import {configExtension, defineExtension} from 'lexical';
import {URL_MATCHER, EMAIL_MATCHER, sanitizeUrl} from './linkUtils';

/** Attributes stored on links that open in a new tab. */
export const NEW_TAB_LINK_ATTRIBUTES = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;

/**
 * Default matchers: bare URLs (defaulting to `https://` when scheme-less) and
 * email addresses (as `mailto:` links). Both carry {@link NEW_TAB_LINK_ATTRIBUTES}.
 * URLs are passed through {@link sanitizeUrl} so only http/https/mailto/tel
 * schemes are ever written.
 */
export const DEFAULT_LINK_MATCHERS: LinkMatcher[] = [
  text => {
    const match = createLinkMatcherWithRegExp(URL_MATCHER, url =>
      sanitizeUrl(url),
    )(text);
    return match ? {...match, attributes: NEW_TAB_LINK_ATTRIBUTES} : null;
  },
  text => {
    const match = createLinkMatcherWithRegExp(
      EMAIL_MATCHER,
      email => `mailto:${email}`,
    )(text);
    return match ? {...match, attributes: NEW_TAB_LINK_ATTRIBUTES} : null;
  },
];

/** Automatically link URLs and email addresses as they are typed or pasted. */
export const RichTextEditorAutoLinkExtension = defineExtension({
  name: '@astryxdesign/richtext/AutoLink',
  dependencies: [
    configExtension(AutoLinkExtension, {matchers: DEFAULT_LINK_MATCHERS}),
  ],
});
