const CURSOR_KEY = 'cursor';
const PREVIOUS_CURSOR_KEY = 'previousCursor';

const cloneSearchParams = (params: URLSearchParams) => new URLSearchParams(params);

export const advanceCursor = (params: URLSearchParams, nextCursor: string) => {
  const next = cloneSearchParams(params);

  next.append(PREVIOUS_CURSOR_KEY, next.get(CURSOR_KEY) ?? '');
  next.set(CURSOR_KEY, nextCursor);

  return next;
};

export const retreatCursor = (params: URLSearchParams) => {
  const next = cloneSearchParams(params);
  const previousCursors = next.getAll(PREVIOUS_CURSOR_KEY);

  if (previousCursors.length === 0) {
    next.delete(CURSOR_KEY);
    return next;
  }

  const previousCursor = previousCursors.pop();
  next.delete(PREVIOUS_CURSOR_KEY);
  previousCursors.forEach((cursor) => next.append(PREVIOUS_CURSOR_KEY, cursor));

  if (previousCursor) next.set(CURSOR_KEY, previousCursor);
  else next.delete(CURSOR_KEY);

  return next;
};

export const setFilter = (
  params: URLSearchParams,
  name: string,
  value: null | string | undefined,
) => {
  const next = cloneSearchParams(params);

  next.delete(CURSOR_KEY);
  next.delete(PREVIOUS_CURSOR_KEY);

  if (value) next.set(name, value);
  else next.delete(name);

  return next;
};
