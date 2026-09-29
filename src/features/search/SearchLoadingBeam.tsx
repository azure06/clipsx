// Short overlapping dashes form a fading tail along the actual perimeter.
// Staggered CSS animation phases keep its color and opacity attached to the
// moving beam, including when it rounds a corner.
const SEGMENTS = Array.from({ length: 96 }, (_, index) => {
  const progress = index / 95
  return {
    opacity: 0.12 + progress * 0.88,
    stroke: `color-mix(in srgb, var(--search-beam-tail), var(--search-beam-head) ${progress * 100}%)`,
    animationDelay: `${-index * 0.005}s`,
  }
})

export const SearchLoadingBeam = () => (
  <svg aria-hidden="true" focusable="false" className="search-loading-beam">
    {SEGMENTS.map((style, index) => (
      <rect key={index} x="1" y="1" rx="11" pathLength="100" style={style} />
    ))}
  </svg>
)
