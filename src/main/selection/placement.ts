interface Point {
  x: number;
  y: number;
}
interface Rectangle extends Point {
  width: number;
  height: number;
}

export const selectionBounds = (
  cursor: Point,
  workArea: Rectangle,
): Rectangle => {
  const inset = Math.min(
    12,
    Math.floor(Math.min(workArea.width, workArea.height) / 4),
  );
  const width = Math.min(520, workArea.width - inset * 2);
  const height = Math.min(560, workArea.height - inset * 2);
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));
  const below = cursor.y + 16;
  const y =
    below + height <= workArea.y + workArea.height - inset
      ? below
      : cursor.y - height - 16;
  return {
    width,
    height,
    x: clamp(
      cursor.x + 16,
      workArea.x + inset,
      workArea.x + workArea.width - width - inset,
    ),
    y: clamp(
      y,
      workArea.y + inset,
      workArea.y + workArea.height - height - inset,
    ),
  };
};
