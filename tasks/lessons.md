# Lessons

## Verify what the user will actually see
- **Mistake:** I published the hosted demo after tests that only clicked buttons. A packing bug (a regex `<link rel="icon"[^>]*>` cut the tag off at a `>` inside an inline SVG) broke the markup, so the browser swallowed the whole stylesheet. The page worked but was unstyled.
- **Rule:** Before handing over anything visual, take a screenshot of the exact artifact being shipped, rendered the way the host renders it, and look at it.
- **Rule:** Never parse or extract HTML tags with `[^>]*` when attribute values can contain `>` (data URIs, inline SVG). Use a real parser, or avoid copying the tag at all.
- **Rule:** Add a cheap guard to build scripts that asserts the output structure (e.g. the `<style>` opens where expected).
