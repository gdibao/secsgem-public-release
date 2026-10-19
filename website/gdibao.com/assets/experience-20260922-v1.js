(() => {
  'use strict';
  const widget = document.querySelector('.home-experience .experience-widget');
  if (!widget) return;
  const handle = widget.querySelector('.experience-grip');
  let active = null;
  let blockPointerClick = false;
  let position = null;

  function bounds() {
    const viewport = window.visualViewport;
    const style = getComputedStyle(widget);
    const safe = edge => parseFloat(style.getPropertyValue('--safe-' + edge)) || 0;
    const left = (viewport?.offsetLeft || 0) + safe('left') + 12;
    const top = (viewport?.offsetTop || 0) + safe('top') + 12;
    return {
      left, top,
      right: Math.max(left, (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth) - widget.offsetWidth - safe('right') - 12),
      bottom: Math.max(top, (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - widget.offsetHeight - safe('bottom') - 12)
    };
  }
  function place(x, y) {
    const limit = bounds();
    position = { x: Math.min(limit.right, Math.max(limit.left, x)), y: Math.min(limit.bottom, Math.max(limit.top, y)) };
    widget.style.left = position.x + 'px';
    widget.style.top = position.y + 'px';
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }
  function keepVisible() {
    const rect = widget.getBoundingClientRect();
    place(position?.x ?? rect.left, position?.y ?? rect.top);
  }
  widget.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || active) return;
    const rect = widget.getBoundingClientRect();
    blockPointerClick = false;
    const target = event.target.closest('a, button') || widget;
    active = { id: event.pointerId, target, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, dragged: false };
    target.setPointerCapture(event.pointerId);
  });
  widget.addEventListener('pointermove', event => {
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.dragged && Math.hypot(dx, dy) < 7) return;
    active.dragged = true;
    blockPointerClick = true;
    widget.classList.add('is-dragging');
    place(active.x + dx, active.y + dy);
  });
  function finish(event) {
    if (!active || active.id !== event.pointerId) return;
    const previous = active;
    active = null;
    widget.classList.remove('is-dragging');
    if (previous.target.hasPointerCapture(event.pointerId)) previous.target.releasePointerCapture(event.pointerId);
  }
  widget.addEventListener('pointerup', finish);
  widget.addEventListener('pointercancel', finish);
  widget.addEventListener('lostpointercapture', finish);
  // The click following a drag is suppressed; a fresh press or keyboard activation remains a link.
  widget.addEventListener('click', event => {
    if (blockPointerClick && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    blockPointerClick = false;
  }, true);
  widget.addEventListener('dragstart', event => event.preventDefault());
  handle.addEventListener('keydown', event => {
    const delta = event.shiftKey ? 32 : 10;
    const moves = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!moves[event.key]) return;
    event.preventDefault();
    const rect = widget.getBoundingClientRect();
    place(rect.left + moves[event.key][0], rect.top + moves[event.key][1]);
  });
  addEventListener('resize', keepVisible);
  window.visualViewport?.addEventListener('resize', keepVisible);
  window.visualViewport?.addEventListener('scroll', keepVisible);
  keepVisible();
})();
