# UI Sheets — Deviant

> **Owner**: This document is the source of truth for bottom sheet conventions.
> Update it when changing any sheet-related code.

## Comment Sheets

Comment sheets use `CommentSheet` from `src/components/sheets/AppSheet.tsx`.

### Rules

1. **Detents**: `[0.7]` (70% screen height). Comments NEVER cover the full screen.
   - All numeric detents are clamped to `<= 0.7` by the wrapper.
   - Do NOT pass `allowLargerDetents: true` in comment sheets.

2. **Header**: Must be set via the TrueSheet `header` prop, NOT rendered inline inside scrollable content.
   - Use `navigation.setOptions({ header: <SheetHeader ... /> })` per-screen.
   - TrueSheet automatically accounts for header height in layout calculations.
   - Guide: https://sheet.lodev09.com/guides/header
   - Config: https://sheet.lodev09.com/reference/configuration

3. **Grabber**: White, using `grabberOptions`:
   ```tsx
   grabber
   grabberOptions={{
     width: 48,
     height: 6,
     topMargin: 10,
     color: '#FFFFFF',
   }}
   ```

4. **Scrollable**: `scrollable: true` is set by the wrapper. Any `ScrollView` or `FlatList` inside must set `nestedScrollEnabled`.

5. **Corner radius**: 16 (default).

### Call Sites

| Screen | Layout | Wrapper |
|--------|--------|---------|
| `comments/[postId].tsx` | `comments/_layout.tsx` | `CommentSheet` |
| `comments/replies/[commentId].tsx` | `comments/_layout.tsx` | `CommentSheet` |

## General Sheets (Chat, etc.)

Use `AppSheet` (default export) from `src/components/sheets/AppSheet.tsx`.

- Default detents: `[0.75]`
- Same white grabber and corner radius as comment sheets.
- `scrollable: true` by default.

## Visual Regression Checklist

- [ ] Comment sheet opens at 70% height max
- [ ] Header stays fixed while content scrolls
- [ ] Grabber is white
- [ ] Keyboard does not push sheet to full height
- [ ] Replies sheet also respects 70% max
- [ ] Chat sheet opens at 75% height max
