# Lessons

## Verify what the user will actually see
- **Mistake:** I published the hosted demo after tests that only clicked buttons. A packing bug (a regex `<link rel="icon"[^>]*>` cut the tag off at a `>` inside an inline SVG) broke the markup, so the browser swallowed the whole stylesheet. The page worked but was unstyled.
- **Rule:** Before handing over anything visual, take a screenshot of the exact artifact being shipped, rendered the way the host renders it, and look at it.
- **Rule:** Never parse or extract HTML tags with `[^>]*` when attribute values can contain `>` (data URIs, inline SVG). Use a real parser, or avoid copying the tag at all.
- **Rule:** Add a cheap guard to build scripts that asserts the output structure (e.g. the `<style>` opens where expected).

## Never let real data leak into code, tests or comments
- **Mistake:** While working with the user's real client files, I used a real colleague's name from that data as an example in a code comment and a unit test, and pushed it to a public repo.
- **Rule:** Examples in code, tests, comments and commit messages are always invented (e.g. "Sam" → "Samantha Reyes"), even when the real data is right in front of me.
- **Rule:** Before every commit made while real data is around, grep the staged diff for names from that data, excluding the app's own name ("compensian" matches "Compensia").
- **Repeat slip (caught before pushing):** while building the name matcher I used real colleague names as examples in code comments and a commit message. The pre-commit name scan and the permission check caught it before anything was pushed.
- **Rule, reinforced:** write fictional examples first, before any real data is in view. When the code is *about* the real data (matching names), the temptation is highest, so always run the staged-diff name scan before composing the commit message, and never put real names in commit messages.
