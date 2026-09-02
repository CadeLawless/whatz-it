export type WindowInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function getClockwiseLandscapeInsets(insets: WindowInsets): WindowInsets {
  return {
    top: insets.right,
    right: insets.bottom,
    bottom: insets.left,
    left: insets.top,
  };
}
