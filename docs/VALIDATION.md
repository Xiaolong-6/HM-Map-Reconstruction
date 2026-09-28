# Validation

## Scientific oracle

The Web scientific implementation is continuously compared against the pinned HappyMeasure Python reference:

- repository: `Xiaolong-6/HappyMeasure`
- commit: `402b88f1c42cff41bf6054e1724bc62b4deb7af3`
- Python implementation: `src/map_reconstruction/`

CI checks out that exact commit and generates deterministic Python oracle fixtures before running the Web tests.

The oracle covers:

- HappyMeasure CSV sort/import;
- constant, manual-linear and rolling Signal Preparation;
- timing calculations;
- Phase Window reconstruction;
- legacy-to-Phase-Window conversion;
- map processing;
- color limits;
- histograms;
- project compatibility.

## Browser acceptance

CI launches real headless Chrome against `file://index.html` and verifies:

- direct static boot;
- four-stage workflow;
- generic import;
- HappyMeasure import;
- interactive trace controls;
- fine registration input steps;
- geometry-driven registration recommendation;
- automatic reconstruction after parameter changes;
- map wheel zoom/reset;
- fixed-viewport layout;
- Stage 3 trace + both maps fitting a normal desktop viewport;
- Stage 4 controls fitting the initial left-panel viewport;
- project Save → browser download → reopen → SHA verification;
- reconstructed values preserved after project round-trip.

The browser tests also deliberately use a long source filename and assert that the Import summary cannot overflow horizontally.

## Large-data browser gate

A generated 120,000-point HappyMeasure CSV is opened in real Chrome from `file://`.

The gate checks:

- import;
- automatic `Current_A` selection;
- Signal Preparation trace render;
- total import+plot time below 20 s;
- JS heap below 512 MiB.

A reference CI run completed import + plot in approximately 541 ms with approximately 7.5 MiB JS heap measured after render. These values are descriptive of that runner, not performance guarantees for every machine.

## Real historical corpus

Historical measurement files are not committed to this public repository.

A private local acceptance corpus has covered:

- 5 historical v3 `.hmmap` projects;
- three 36×36 and two 50×50 maps;
- source lengths from 46,176 to 113,266 samples;
- preparation modes including `none` and `manual_regions`;
- 7 historical HappyMeasure `single-v2` CSV files.

For all five projects:

- embedded-source SHA-256 verified;
- load → preparation → reconstruction completed;
- Web save → reopen completed;
- reconstructed values had maximum round-trip delta 0;
- sample-count arrays had maximum round-trip delta 0.

The measurement files remain outside the public repository.

## Offline package

CI builds a static offline ZIP and enforces a 2 MiB ceiling.

The package contains only the static application files required by the browser. No Python or Qt runtime is bundled.

## Validation boundary

Passing parity tests proves consistency with the pinned reference for covered cases. It does not prove that the current Phase Window model is physically appropriate for every acquisition.

For a new acquisition family:

1. decide whether its timing can be represented by the current periodic raster model;
2. add representative fixtures;
3. add a strategy-specific scientific oracle or independent validation;
4. add browser acceptance for the new workflow;
5. only then advertise the new family as supported.
