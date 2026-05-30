# Production Workflow Regression Checklist

After any significant refactor, verify this checklist manually at https://avacut.vercel.app

## Operator Workflow

- [ ] 1. Select one hold → MAIN and STEFAN tables populate
- [ ] 2. Select multiple holds → angles from all selected appear
- [ ] 3. Search filters hold list
- [ ] 4. Selecting a hold during search clears the search field
- [ ] 5. Click angle row → drawing opens in viewer
- [ ] 6. Sort MAIN ascending / descending
- [ ] 7. Sort STEFAN ascending / descending
- [ ] 8. Zoom drawing
- [ ] 9. Print drawing (single image)
- [ ] 10. Print ALL / MAIN / STEFAN tables
- [ ] 11. CLEAR selection → confirm dialog → selection cleared
- [ ] 12. CLEAR resets work mode checkboxes

## Work Mode

- [ ] 13. Open work mode (phone icon)
- [ ] 14. Filter ALL / MAIN / STEFAN in work mode
- [ ] 15. Sort arrows work independently per table
- [ ] 16. Check angle → row strikethrough, next-cut indicator moves
- [ ] 17. All checked → no indicator shown
- [ ] 18. Switch dark theme ↔ light theme
- [ ] 19. Theme persists on reload
- [ ] 20. Browser Back exits work mode (with confirm if progress exists)

## Saved Progress

- [ ] 21. Check some angles → auto-saved (close and reopen tab)
- [ ] 22. Resume banner appears on main screen after reload
- [ ] 23. Resume → work mode opens with correct holds and checked angles
- [ ] 24. Keep & exit → banner shows with correct date
- [ ] 25. Clear & exit → banner gone, checkboxes reset
- [ ] 26. Discard progress (✕ on banner) → confirm → cleared

## Admin Workflow

- [ ] 27. Enter admin (ADMIN button) → PIN prompt
- [ ] 28. Wrong PIN → shake animation
- [ ] 29. Correct PIN → admin panel opens
- [ ] 30. Add new hold
- [ ] 31. Rename hold → angles remain (stable IDs)
- [ ] 32. Delete hold → its angles also removed
- [ ] 33. Add angle (MAIN and STEFAN)
- [ ] 34. Edit angle value
- [ ] 35. Upload drawing for angle
- [ ] 36. Upload hold cover image
- [ ] 37. Remove hold cover image
- [ ] 38. SAVE → toast confirmation
- [ ] 39. BACK with unsaved changes → confirm dialog

## Import / Export

- [ ] 40. EXPORT → downloads JSON file
- [ ] 41. IMPORT → confirm dialog → replaces data
- [ ] 42. Import v1 JSON (old format) → data loads correctly
- [ ] 43. Export then import roundtrip → no data loss

## Data Resilience

- [ ] 44. Reload page → data persists
- [ ] 45. Clear localStorage manually → app resets to defaults gracefully
- [ ] 46. Import oversized file → rejected with error

## Security Headers (check with curl -I)

- [ ] 47. Content-Security-Policy present
- [ ] 48. Strict-Transport-Security present
- [ ] 49. X-Frame-Options: DENY

---

## Failures Log

Document any failures here:

| # | Step | Failure | Fixed in |
|---|------|---------|----------|
| | | | |
