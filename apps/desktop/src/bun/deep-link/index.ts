import {
  resolveDeepLinkScheme,
  type DeepLinkScheme,
} from "../../shared/deep-link-scheme";

const STUDIO_OPEN_DEEP_LINK_RE = /^studio\/open(?:\?|$)/;

/** Studio URLs open a Project window without involving Thread import code. */
export function isStudioOpenDeepLink(
  url: string,
  scheme: DeepLinkScheme = resolveDeepLinkScheme(
    process.env.LLM_SPACE_DEEP_LINK_SCHEME
  )
): boolean {
  const prefix = `${scheme}://`;
  return (
    url.startsWith(prefix) &&
    STUDIO_OPEN_DEEP_LINK_RE.test(url.slice(prefix.length))
  );
}
