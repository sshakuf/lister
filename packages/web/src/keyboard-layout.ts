export function keyboardLayout(height: number, viewport?: { height: number; offsetTop: number }) {
  return {
    top: viewport ? viewport.height + viewport.offsetTop : height,
    keyboard: viewport ? height - viewport.height > 100 : false,
  };
}
