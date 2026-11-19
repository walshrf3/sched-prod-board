---
id: SCHED-4515
title: List holds still; "N new" bar brings new incidents in
status: ready
plan: R1 (changed), R2
decided-by: product, 2026-11-19, after the step-1 recording (00:08: a new incident landed under the pointer and took the ack meant for INC-6645)
---

Product: "The list holds still while it is on screen; a "N new" bar brings new incidents in on click. Ack stays on the row."

- Once the list is on screen, refreshes never add, move or remove a row. New incidents are held.
- A bar (`data-testid="new-bar"`) above the list says how many are held; clicking it puts them in, newest first.
  The bar's slot is always reserved, so the bar appearing never moves a row.
- Ack stays one click on the row (`ack` / `acked`). No confirm, no panel.

Acceptance: leave the board open while incidents arrive; the top row never changes until the bar is clicked; an
ack aimed at a row while incidents arrive acks that row.
