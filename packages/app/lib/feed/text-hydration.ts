export function shouldHydrateFeedTextSlides(params: {
  isTextPost: boolean;
  id?: string | null;
  textSlideCount?: number;
  initialTextSlidesLength: number;
  caption?: string | null;
}) {
  const {
    isTextPost,
    id,
    textSlideCount,
    initialTextSlidesLength,
    caption,
  } = params;
  const hasKnownTextSlideCount = typeof textSlideCount === "number";
  const hasIncompleteInitialTextSlides =
    (hasKnownTextSlideCount && textSlideCount > initialTextSlidesLength) ||
    (!hasKnownTextSlideCount &&
      initialTextSlidesLength === 0 &&
      typeof caption === "string" &&
      caption.trim().length > 0);

  return Boolean(isTextPost && id && hasIncompleteInitialTextSlides);
}
