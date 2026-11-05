# Frontend performance

## Budgets and implementation

- The patient entry chunk is checked after every production build and must stay at or below 120 KiB gzip. Run `npm run build`.
- React, React DOM, and TanStack Query are emitted as separate shared chunks; the staff console is loaded with `React.lazy` only at `/staff`.
- Vite targets ES2020 and removes console/debugger calls in production.
- Query defaults use a 60-second stale window and bounded exponential retries. Report/order keys can be prefetched from the order card.
- The service worker caches the app shell and static assets/fonts only. It deliberately ignores API/report/PDF URLs.
- No charting or UI component package is used; report range bars and trend lines are inline SVG.

## Current measurements

Production build measurement (local Windows build, 5 November 2026):

| Chunk | Raw | Gzip |
|---|---:|---:|
| Patient entry | 13,550 B | 4,770 B |
| React vendor | 145,130 B | 46,780 B |
| Query vendor | 36,920 B | 10,780 B |
| **Initial patient JavaScript total** | **195,600 B** | **62,238 B (60.8 KiB)** |
| Report page, lazy loaded | 10,230 B | 3,810 B |
| Staff console, lazy loaded | 6,680 B | 2,360 B |
| Language previews, lazy loaded (each) | 140–280 B | 130–210 B |

The bundle check gzips the three initial module scripts referenced by the built HTML and fails above 120 KiB. Report and staff chunks are lazy loaded and not counted as initial transfer.

Lighthouse CI results (local mobile emulation, three runs per route, 5 November 2026):

| Route | Median performance score | Median LCP | CLS (all runs) |
|---|---:|---:|---:|
| `/` | 99 | 1.57 s | 0.000 |
| `/report` | 97 | 2.09 s | 0.000 |

The audit used 4x CPU slowdown, 1.6 Mbps throughput and 150 ms RTT. The maximum measured LCP was 2.13 seconds and all CLS values were 0.000. These are local simulated results, not measurements from a physical low-end Android device. LHCI report files are written locally to `.lighthouseci`.

The target for field validation remains LCP below 2.5 seconds on Slow 4G with 4x CPU throttling and CLS below 0.05. Capture those values with Lighthouse CI on the deployed preview and update this section with the report URL and measured values before using them in external materials.
