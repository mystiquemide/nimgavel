// Paddle the Ghost: mascot for empty and quiet states. Two-layer idle
// motion (bob + blink) per the SR-71 handoff — jitter's Cubi pattern,
// restrained to two keyframe layers.
export function ghostSvg() {
  return `
<svg class="ghost-mascot" viewBox="0 0 96 96" height="84" width="84" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="ghost-body">
    <path d="M28 22c0-11 9-18 20-18s20 7 20 18v34l-6.5-5-6.5 5-7-5-7 5-6.5-5-6.5 5V22Z"
      fill="#131E33" stroke="#1D2A44" stroke-width="2"/>
    <circle class="ghost-eye" cx="39" cy="26" r="3" fill="#8A94AB"/>
    <circle class="ghost-eye" cx="57" cy="26" r="3" fill="#8A94AB"/>
    <path d="M42 36c2 2.4 6 2.4 8 0" stroke="#8A94AB" stroke-width="2" stroke-linecap="round"/>
  </g>
  <g class="ghost-paddle" transform="rotate(14 70 58)">
    <rect x="66" y="34" width="14" height="26" rx="2" fill="#0D1626" stroke="#FFCE46" stroke-width="2"/>
    <rect x="70" y="60" width="6" height="18" rx="2" fill="#1D2A44"/>
    <text x="73" y="51" text-anchor="middle" font-family="monospace" font-size="11" fill="#FFCE46">42</text>
  </g>
</svg>`;
}
