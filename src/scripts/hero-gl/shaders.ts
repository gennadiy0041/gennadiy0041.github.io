/**
 * GLSL for the hero "terrain map": topographic isolines of a slowly morphing fbm height field.
 * GLSL ES 3.00 (WebGL2 only); without WebGL2 the page keeps its static poster.
 */

/** Full-screen triangle; the fragment shader works purely in gl_FragCoord space. */
export const vertex = /* glsl */ `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const fragment = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uResolution; // drawing-buffer size, px
uniform float uPixel;     // drawing-buffer px per CSS px
uniform float uTime;      // animation clock, s
uniform vec4 uPointer;    // xy: smoothed pointer in buffer uv (y up), z: hill height 0..1, w: accent bloom 0..1
uniform vec3 uAccent;
uniform vec3 uGlow;
uniform float uIntensity;

out vec4 fragColor;

const float FEATURE = 1.6;                     // noise cells per frame height
const float LEVELS = 20.0;                     // isolines per unit of height
const float HILL_SIGMA = 0.11;                 // cursor hill radius, in frame heights
const float HILL_HEIGHT = 0.28;                // ~5-6 rings around the cursor
const float BLOOM_SIGMA = 0.16;                // accent tint radius
const vec3 GRAPHITE = vec3(0.60, 0.64, 0.70);
const vec2 LIGHT = vec2(-0.6, 0.8);            // relief light from the upper left (y up)
const mat2 OCTAVE = mat2(1.6, 1.2, -1.2, 1.6); // next octave: rotate ~37 deg, scale x2

// Sine-free hash (Dave Hoskins): identical on every GPU, no texture fetches.
vec2 hash22(vec2 p) {
  vec3 p3 = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

// Gradient noise with a quintic fade: continuous slopes keep the isolines smooth.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Height at frame position p: 4 octaves, the first one partly ridged (sharp crests, V-shaped contours).
// Every octave drifts on its own heading, so the relief slowly morphs instead of panning.
float terrain(vec2 p, float t) {
  vec2 q = p * FEATURE + vec2(4.3, -2.1);
  vec2 drift = vec2(0.010, 0.004) * t;
  float n = noise(q + drift);
  float h = 0.5 * mix(n, 0.45 - 1.6 * abs(n), 0.55);
  float amp = 0.21;
  for (int i = 1; i < 4; i++) {
    q = OCTAVE * q + vec2(7.31, -3.17);
    drift = vec2(-drift.y, drift.x) * 1.5;
    h += amp * noise(q + drift);
    amp *= 0.42;
  }
  // Calm plains on the left (behind the text column), rugged ground towards the glowing top-right corner.
  return h * mix(0.5, 1.25, smoothstep(-0.9, 0.7, p.x + 0.4 * p.y));
}

// Coverage of an anti-aliased line w px wide, d px from its centre.
float stroke(float d, float w) {
  return clamp(0.5 * w + 0.5 - d, 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uResolution;
  float aspect = uResolution.x / uResolution.y;
  // Frame units behave like a 16:9 image under object-fit: cover, so the poster lines up with the live canvas.
  float unit = max(uResolution.x * 0.5625, uResolution.y);
  vec2 p = (frag - 0.5 * uResolution) / unit;
  vec2 toPointer = p - (uPointer.xy - 0.5) * uResolution / unit;
  float r2 = dot(toPointer, toPointer);

  // Height field plus the gaussian hill raised by the cursor.
  float h = terrain(p, uTime) + uPointer.z * HILL_HEIGHT * exp(-r2 / (2.0 * HILL_SIGMA * HILL_SIGMA));

  // Isolines: px distance to the nearest contour from the screen-space rate of change (fwidth).
  float f = h * LEVELS;
  float spacing = 1.0 / max(fwidth(f), 1e-4);                     // px between neighbouring contours
  float dMinor = abs(fract(f + 0.5) - 0.5) * spacing;
  float dIndex = abs(fract(f * 0.2 + 0.5) - 0.5) * 5.0 * spacing; // every 5th line is an index contour
  float w = max(1.0, uPixel);
  // Cartographic generalisation: drop lines where they would crowd into a grey smear.
  float crowd = smoothstep(3.0, 7.0, spacing);
  float minor = stroke(dMinor, w) * crowd;
  float index = stroke(dIndex, w * 1.6) * smoothstep(3.0, 7.0, spacing * 5.0);

  // Illuminated contours (Tanaka): slopes facing the light read brighter, giving a quiet relief.
  vec2 grad = vec2(dFdx(h), dFdy(h));
  float lit = dot(-grad, LIGHT) / max(length(grad), 1e-6);
  float shade = 0.775 + 0.225 * lit;

  // Accent bloom around the cursor; violet glow from the top-right corner.
  float bloom = uPointer.w * exp(-r2 / (2.0 * BLOOM_SIGMA * BLOOM_SIGMA));
  vec2 g = (uv - vec2(0.94, 1.0)) * vec2(aspect, 1.0);
  float glow = exp(-dot(g, g) * 2.4);

  vec3 lineColor = mix(GRAPHITE, mix(GRAPHITE, uGlow, 0.5), glow);
  lineColor = mix(lineColor, uAccent, smoothstep(0.04, 0.7, bloom));
  float lineAlpha = max(minor * 0.17, index * 0.36) * shade;
  lineAlpha = mix(lineAlpha, max(minor, index) * 0.62, smoothstep(0.0, 0.85, bloom));
  float halo = bloom * 0.16 * exp(-dMinor * dMinor * 0.08) * crowd;

  // Composite in premultiplied alpha: glow, lines over it, then the additive halo.
  vec4 color = vec4(uGlow, 1.0) * (0.15 * glow);
  color = vec4(lineColor, 1.0) * lineAlpha + color * (1.0 - lineAlpha);
  color += vec4(uAccent * halo, halo * (1.0 - color.a));

  // Vignette: fade out towards the bottom (blends into the next section), the sides and a little under the nav.
  float fade = smoothstep(0.0, 0.5, uv.y) * (1.0 - 0.5 * smoothstep(0.88, 1.0, uv.y));
  fade *= smoothstep(0.0, 0.14, uv.x) * smoothstep(0.0, 0.14, 1.0 - uv.x);
  fade *= 1.0 - 0.4 * smoothstep(0.35, 0.75, length((uv - vec2(0.55, 0.6)) * vec2(aspect * 0.75, 1.0)));
  color *= fade * uIntensity;

  // Interleaved-gradient-noise dither hides 8-bit banding in the faint glow.
  float dither = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
  color = clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0);
  // Premultiplied output (the context keeps the default premultipliedAlpha: true), with colour capped at alpha so
  // every pixel is valid premultiplied: a transparent pixel is (0,0,0,0) on any compositor path. The earlier
  // straight-alpha output (rgb / a) gave near-transparent pixels full-strength colour (the glow's violet, the
  // dither as white noise); Edge, when it hands canvases to Windows' DirectComposition, showed that as a violet,
  // hatched hero. min(rgb, a) is exactly what rgb / a clamped to 1 composited to before.
  fragColor = vec4(min(color.rgb, vec3(color.a)), color.a);
}
`;
