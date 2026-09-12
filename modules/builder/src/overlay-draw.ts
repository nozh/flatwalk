import type { OverlayMark } from './overlay-marks.ts';

export function drawBanner(ctx: CanvasRenderingContext2D, width: number, height: number, text: string, edge: 'top' | 'bottom') {
  const bar = Math.min(24, Math.max(8, Math.round(height * 0.08)));
  const y = edge === 'top' ? 0 : height - bar;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(0, y, width, bar);
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, width - 4, height - 4);
  ctx.fillStyle = '#fef2f2';
  ctx.font = `bold ${Math.max(8, Math.min(12, bar - 4))}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, y + bar / 2, width - 16);
  ctx.restore();
}

export function drawMarks(ctx: CanvasRenderingContext2D, marks: OverlayMark[], fontSize: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  for (const mark of marks) {
    if (mark.kind !== 'wall') continue;
    ctx.strokeStyle = mark.exterior ? '#1d4ed8' : '#7c3aed';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(2, mark.thickness);
    ctx.beginPath();
    ctx.moveTo(mark.x1, mark.y1);
    ctx.lineTo(mark.x2, mark.y2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.font = `bold ${fontSize}px sans-serif`;
  for (const mark of marks) {
    if (mark.kind !== 'wall') continue;
    ctx.fillStyle = '#3b0764';
    ctx.fillText(mark.id, (mark.x1 + mark.x2) / 2, (mark.y1 + mark.y2) / 2);
  }

  for (const mark of marks) {
    if (mark.kind !== 'opening') continue;
    const color = mark.entrance ? '#dc2626' : mark.passable === false ? '#ea580c' : mark.openingKind === 'door' ? '#16a34a' : '#0ea5e9';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, fontSize * 0.55);
    ctx.beginPath();
    ctx.moveTo(mark.x1, mark.y1);
    ctx.lineTo(mark.x2, mark.y2);
    ctx.stroke();
    const mx = (mark.x1 + mark.x2) / 2;
    const my = (mark.y1 + mark.y2) / 2;
    const dx = mark.x2 - mark.x1;
    const dy = mark.y2 - mark.y1;
    const len = Math.hypot(dx, dy) || 1;
    ctx.fillStyle = color;
    ctx.fillText(mark.id, mx + (dy / len) * (fontSize + 4), my - (dx / len) * (fontSize + 4));
  }

  for (const mark of marks) {
    if (mark.kind !== 'room') continue;
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, Math.max(5, fontSize * 0.55), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#78350f';
    ctx.fillText(mark.id, mark.x, mark.y - fontSize - 2);
  }

  ctx.restore();
}

export function fontSizeFor(width: number, height: number) {
  return Math.max(9, Math.min(14, Math.round(Math.hypot(width, height) / 90)));
}
