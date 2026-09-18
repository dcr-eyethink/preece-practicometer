// Starter scores, seeded once into a brand-new account with zero scores,
// alongside DEFAULT_PRACTICE_SETS (js/default-sets.js) whose score-kind rows
// reference these by `key`.
//
// The actual files live under default-scores/ and are fetched lazily by
// seedDefaultsIfEmpty() only for a brand-new account — kept as plain static
// assets rather than inlined base64 here so they don't bloat every page
// load (one of the three is a multi-megabyte PDF).
window.DEFAULT_SCORES = [
  { key: 'hanon', name: 'Hanon', mimeType: 'image/png', path: 'default-scores/hanon.png' },
  { key: 'alice', name: 'Alice in Wonderland', mimeType: 'image/png', path: 'default-scores/alice.png' },
  { key: 'nosurprises', name: 'No Surprises / Country House', mimeType: 'application/pdf', path: 'default-scores/no-surprises-country-house.pdf' }
];
