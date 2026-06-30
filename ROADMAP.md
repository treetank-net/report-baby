# Roadmap — report-baby

## Faza 1 — render działa e2e + dystrybucja Chromium
- [ ] Zaimplementować `render.ts`: `launchBrowser`, `renderHtmlToPdf`, `renderHtmlToImage`,
      `renderUrlToPdf`, `renderUrlToImage` (Playwright `chromium.launch()` → `setContent`/`goto` → `pdf`/`screenshot`).
- [ ] Podpiąć implementacje pod stuby w `tools/render.ts` (html XOR html_path, zapis do outputDir, zwrot ścieżki).
- [ ] Mapowanie `options` (format, landscape, margin, print_background / width, height, device_scale_factor, full_page, type).
- [ ] Rozstrzygnąć dystrybucję Chromium: `npx playwright install chromium` vs `channel: 'chrome'` (osobny wątek).
- [ ] `start-mcp.js`: dopracować detekcję Chromium per OS i komunikaty stderr.

## Faza 2 — render_report z realnym szablonem
- [ ] Dopracować `default-report` (typografia, sekcje, tabela metryk, miejsce na branding/logo).
- [ ] `render_report`: template + dane → HTML → plik (pdf/png), zwrot ścieżki.
- [ ] Walidacja danych szablonu (zod) zamiast luźnego `record`.

## Faza 3 — więcej szablonów + return_image
- [ ] Dodać kolejne szablony (np. dashboard, one-pager, comparison).
- [ ] Ścieżka `return_image: true` — MCP image content dla oceny layoutu przez LLM.
- [ ] Branding: logo (data URI), kolory akcentu, stopka per klient.

## Faza 4 — wykresy
- [ ] Integracja z chart-MCP (QuickChart / AntV `mcp-server-chart`) — generator HTML wstrzykuje wykresy.
- [ ] Wsparcie inline Chart.js w szablonach (self-contained, bez sieci w runtime renderu).
