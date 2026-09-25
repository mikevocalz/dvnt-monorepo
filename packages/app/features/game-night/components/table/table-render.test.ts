import assert from "node:assert/strict";
import test from "node:test";
import { layoutSeats, orderReveal, toggleSelection } from "./table-logic";

const members = [
  { user_id: "b", name: "B", avatar: "", seat_no: 2 },
  { user_id: "a", name: "A", avatar: "", seat_no: 0 },
];

test("seat layout is stable by seat number and stays on the ellipse", () => {
  const result = layoutSeats(members, 800, 500);
  assert.deepEqual(result.map((seat) => seat.user_id), ["a", "b"]);
  assert.ok(Math.abs((result[0]?.x ?? 0) - 400) < 0.001);
  assert.ok(Math.abs((result[0]?.y ?? 0) - 440) < 0.001);
  assert.ok(Math.abs((result[1]?.x ?? 0) - 400) < 0.001);
  assert.ok(Math.abs((result[1]?.y ?? 0) - 60) < 0.001);
});

test("reveal ordering promotes winners without disturbing server order", () => {
  const result = orderReveal([
    { submission_id: 1, texts: ["one"] },
    { submission_id: 2, texts: ["two"], is_winner: true },
    { submission_id: 3, texts: ["three"] },
  ]);
  assert.deepEqual(result.map((entry) => entry.submission_id), [2, 1, 3]);
  assert.deepEqual(orderReveal(null), []);
});

test("selection toggles and obeys prompt pick bound", () => {
  assert.deepEqual(toggleSelection([], "a", 2), ["a"]);
  assert.deepEqual(toggleSelection(["a"], "b", 1), ["a"]);
  assert.deepEqual(toggleSelection(["a"], "a", 1), []);
  assert.deepEqual(toggleSelection([], "a", 0), []);
});
