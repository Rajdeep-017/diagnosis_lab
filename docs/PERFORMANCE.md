# Frontend performance

## Latest local measurement

Measured after a production Vite build with Lighthouse CI 0.14.0, three runs
per route, mobile emulation at 360 × 640, simulated 150 ms RTT / 1,600 Kbps,
and 4× CPU slowdown. The routes were the patient entry (`/`) and privacy
notice (`/privacy`); no authenticated report data was loaded.

| Route | Performance score (mean) | LCP (mean / worst) | CLS (all runs) |
|---|---:|---:|---:|
| `/` | 0.99 | 1.88 s / 1.91 s | 0.00 |
| `/privacy` | 0.99 | 1.84 s / 1.88 s | 0.00 |

Both measured routes met the configured LCP < 2.5 s and CLS < 0.05 checks.
These are lab measurements on the local Chrome/Windows environment; device,
browser, and network conditions affect results. CI repeats the same configured
Lighthouse assertions on pull requests.

## Bundle budget

The production build's initial patient JavaScript consists of four chunks:

- Raw: **195,953 bytes**
- Gzip: **62,457 bytes** (about **61.0 KiB**)
- Budget: **120 KiB gzip**; the build check passes

The staff console is a lazy-loaded chunk and is not included in the initial
patient JavaScript. The production build also emits Brotli and gzip sidecars
for hashed application and font assets.

Reproduce the measurements from `frontend`:

```powershell
npm run build
npm run test:lighthouse
```
