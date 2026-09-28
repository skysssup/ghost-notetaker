'use strict';

const { screen } = require('electron');

function getDisplayMatchingBounds(bounds) {
  try {
    return screen.getDisplayMatching({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    });
  } catch (_) {
    return screen.getPrimaryDisplay();
  }
}

function getDisplayById(id) {
  if (id == null) return null;
  const displays = screen.getAllDisplays();
  return displays.find((d) => String(d.id) === String(id)) || null;
}

/**
 * Keep a note's bounds fully (or at least mostly) inside a visible work area.
 * If the saved display is gone, fall back to the primary display.
 */
function clampBoundsToDisplays(bounds, preferredDisplayId) {
  const width = Math.max(200, Math.round(bounds.width || 340));
  const height = Math.max(160, Math.round(bounds.height || 280));
  let x = Math.round(bounds.x || 0);
  let y = Math.round(bounds.y || 0);

  let display = getDisplayById(preferredDisplayId);
  if (!display) {
    display = getDisplayMatchingBounds({ x, y, width, height });
  }
  if (!display) {
    display = screen.getPrimaryDisplay();
  }

  const area = display.workArea || display.bounds;
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;

  // If mostly off-screen, snap into the work area
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const onDisplay =
    centerX >= area.x &&
    centerX <= area.x + area.width &&
    centerY >= area.y &&
    centerY <= area.y + area.height;

  if (!onDisplay) {
    x = area.x + Math.round((area.width - width) / 2);
    y = area.y + Math.round((area.height - height) / 2);
  } else {
    x = Math.min(Math.max(x, area.x), Math.max(area.x, maxX));
    y = Math.min(Math.max(y, area.y), Math.max(area.y, maxY));
  }

  return {
    x,
    y,
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
    displayId: display.id
  };
}

function cursorNearbyBounds(size = { width: 340, height: 280 }) {
  let point;
  try {
    point = screen.getCursorScreenPoint();
  } catch (_) {
    point = { x: 100, y: 100 };
  }
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea || display.bounds;
  const width = size.width || 340;
  const height = size.height || 280;
  let x = point.x + 16;
  let y = point.y + 16;
  if (x + width > area.x + area.width) x = point.x - width - 16;
  if (y + height > area.y + area.height) y = point.y - height - 16;
  return clampBoundsToDisplays({ x, y, width, height }, display.id);
}

module.exports = {
  getDisplayMatchingBounds,
  getDisplayById,
  clampBoundsToDisplays,
  cursorNearbyBounds
};
