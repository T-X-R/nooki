# Public Library Host acceptance fixture

Synthetic verification package using only the exported Nooki 0.5.0 contract and kit 0.4.0.
The deliberately forged recipient, foreign grant and stale Host buttons test refusal paths;
do not copy those patterns into normal packages. No agent or external service is called.

1. Export with `npm run capability:kit -- /tmp/library-kit.zip`, then extract outside the checkout.
2. Run the exported `scripts/create-capability.mjs <new-directory> org.example.selection-reader`.
3. Copy `index.tsx`, `style.css` and `manifest.json` into that directory; run `npm install`,
   `npm run check` and `npm run pack` with its own dependencies.
4. Repeat in independent directories for `peer-manifest.json` and `denied-manifest.json`, using
   each as `manifest.json`. The peer has read-selected permission; the denied package does not.
5. Launch an empty isolated desktop profile and import the actual archives through the UI.
   Check their declared permissions before consenting to installation.
6. In the reader, publish the two synthetic documents. Open and dismiss selection: no grant is
   created. Select only Alpha and authorize: metadata contains Alpha only; reading returns Alpha's
   captured content. Reopen selection to check no stale checkbox state. Test explicit dismissal.
7. Copy the returned grant metadata into the peer's test field. Reading it must fail, although the
   peer can select its own grant for the same document. The denied package cannot open a picker.
8. Verify unsupported artifact and forged-recipient errors, selection from a job, and an old Host
   call after leaving the page. A disposed caller cannot reopen selection or receive a late result.
9. Quit/restart and verify the reader's saved grant still reads. In Library → Document access,
   revoke it. The package's next read fails; Open retained citation still displays the snapshot.
10. Exercise the picker and access manager in Chinese/English, light/dark and wide/narrow views.
    Use keyboard dismissal, search/no-results, loading and selection-limit states. Inspect native
    lifecycle tests for same-version replacement while selection is pending and abandoned sessions.

The receipt records which checks ran, source/build identifiers and any limits. Actual native checks
are required; the portable preview deliberately refuses selection with `UNSUPPORTED_SERVICE`.
