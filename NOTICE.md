# Third-party notices

Respo's own code is licensed under the MIT License (see `LICENSE`). The items
below are third-party materials included in, or re-typed into, this repository
or shipped inside the packaged application.

## Chromium DevTools — emulated device list

The device metrics in `src/shared/deviceCatalog.ts` (viewport sizes, pixel
ratios, touch flags and user-agent shapes for the devices Chromium's DevTools
emulates) are re-typed by hand from
`front_end/models/emulation/EmulatedDevices.ts` of the
[ChromeDevTools/devtools-frontend](https://github.com/ChromeDevTools/devtools-frontend)
repository (fetched 2026-09-05, commit `036dd84bc4fdfb0fd4be2a5ddb3fe37ef24939cd`).
No code from that file is used — only the device facts.

```
Copyright 2014 The Chromium Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The remaining devices in the catalog (2025–2026 phones, tablets, laptops and
monitors) are taken from public vendor specifications. Nothing in the catalog
comes from the responsively-app project or any other AGPL source.

## Network throttling presets

The Fast 4G / Slow 4G / 3G numbers in `src/shared/emulation.ts` are the ones
Chromium DevTools uses for the presets of the same names (same repository and
license as above); they are facts about the presets, not code.

## Inter typeface

The UI is set in [Inter](https://rsms.me/inter/) by Rasmus Andersson, bundled
through the `@fontsource/inter` package. Inter is licensed under the
SIL Open Font License 1.1 (OFL-1.1), reproduced in
`node_modules/@fontsource/inter/LICENSE` and at
<https://openfontlicense.org>. The font files are shipped unmodified inside the
packaged application.

## Bundled software

The packaged application contains Electron (MIT; itself bundling Chromium,
BSD-3-Clause, and Node.js, MIT — see `LICENSES.chromium.html` next to the
executable) and these npm packages at runtime, each under a permissive license:

| Package | License |
|---|---|
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | MIT |
| `@electron-toolkit/preload`, `@electron-toolkit/utils` | MIT |
| `@fontsource/inter` | OFL-1.1 (see above) |
| `@heroicons/react` | MIT |
| `chokidar` | MIT |
| `class-variance-authority` | Apache-2.0 |
| `clsx` | MIT |
| `electron-log` | MIT |
| `electron-store` | MIT |
| `electron-updater` | MIT |
| `radix-ui` | MIT |
| `tailwind-merge` | MIT |
| `zustand` | MIT |

Their license texts travel with them inside `node_modules` in the application
bundle. Respo's dependency policy (`CLAUDE.md`) admits MIT, Apache-2.0, BSD and
ISC licensed packages only; GPL and AGPL are excluded.

## Functional reference

[Responsively App](https://github.com/responsively-org/responsively-app)
(AGPL-3.0) was studied as a functional reference for what a responsive design
browser should do. No code, assets or data from it are used in Respo.
