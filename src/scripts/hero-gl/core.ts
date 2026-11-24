/**
 * Low-level renderer for the hero terrain shader: one OGL Program on one full-screen Triangle.
 * Shared by the live background (../hero-gl.ts) and the poster bake (scripts/render-hero-poster.mjs).
 */
import { Program, Renderer, Triangle } from 'ogl';
import { fragment, vertex } from './shaders';

/** sRGB colour, each channel 0..1. */
export type RGB = [number, number, number];

/** Animation state of one frame. Pointer coordinates are canvas-relative, 0..1 from the top-left corner. */
export interface HeroFrame {
  /** animation clock, seconds */
  time: number;
  pointerX: number;
  pointerY: number;
  /** height of the hill raised under the cursor, 0..1 */
  hover: number;
  /** lime bloom of the contours around the cursor, 0..1 */
  bloom: number;
}

export interface HeroLook {
  accent: RGB;
  glow: RGB;
  /** overall opacity multiplier */
  intensity: number;
}

/** Design tokens: --accent #d0ff4a and --glow #7c5cff. */
export const DEFAULT_LOOK: Readonly<HeroLook> = {
  accent: [208 / 255, 1, 74 / 255],
  glow: [124 / 255, 92 / 255, 1],
  intensity: 1,
};

/**
 * The frame baked into src/assets/hero-poster.webp. The live canvas starts from this exact state,
 * so it can fade in over the poster without a visible jump.
 */
export const POSTER_FRAME: Readonly<HeroFrame> = { time: 40, pointerX: 0.64, pointerY: 0.4, hover: 1, bloom: 0.8 };

/** One transparent, straight-alpha layer; no depth/stencil/MSAA (lines are anti-aliased in the shader). */
export const CONTEXT_ATTRIBUTES = {
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
} as const satisfies WebGLContextAttributes;

export interface HeroCore {
  readonly gl: WebGL2RenderingContext;
  /** Size the drawing buffer to the CSS box times `pixelRatio` (drawing-buffer px per CSS px). */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  draw(frame: HeroFrame): void;
  /** Delete the GL objects; the context itself stays alive. */
  dispose(): void;
}

/** Throws if WebGL2 is unavailable or the shader fails to link. */
export function createHeroCore(canvas: HTMLCanvasElement, look: HeroLook, dpr: number): HeroCore {
  // OGL's Renderer writes px sizes into canvas.style; the page CSS must stay in charge of the element box.
  const { width: styleWidth, height: styleHeight } = canvas.style;
  const renderer = new Renderer({ canvas, dpr, webgl: 2, ...CONTEXT_ATTRIBUTES });
  canvas.style.width = styleWidth;
  canvas.style.height = styleHeight;

  const gl = renderer.gl;
  if (!renderer.isWebgl2) throw new Error('WebGL2 is not available');

  const resolution = [1, 1];
  const pointer = [0.5, 0.5, 0, 0];
  const uniforms = {
    uResolution: { value: resolution },
    uPixel: { value: 1 },
    uTime: { value: 0 },
    uPointer: { value: pointer },
    uAccent: { value: look.accent },
    uGlow: { value: look.glow },
    uIntensity: { value: look.intensity },
  };
  const program = new Program(gl, { vertex, fragment, uniforms, depthTest: false, depthWrite: false, cullFace: false });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    throw new Error(`hero shader failed to link: ${gl.getProgramInfoLog(program.program) ?? 'context lost'}`);
  }
  const geometry = new Triangle(gl);

  return {
    gl: gl as WebGL2RenderingContext,

    resize(cssWidth, cssHeight, pixelRatio) {
      const width = Math.max(1, Math.round(cssWidth * pixelRatio));
      const height = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      renderer.setViewport(width, height);
      resolution[0] = width;
      resolution[1] = height;
      uniforms.uPixel.value = pixelRatio;
    },

    draw(frame) {
      uniforms.uTime.value = frame.time;
      pointer[0] = frame.pointerX;
      pointer[1] = 1 - frame.pointerY; // GL's y axis points up
      pointer[2] = frame.hover;
      pointer[3] = frame.bloom;
      // No blending and every pixel is covered, so no clear is needed.
      program.use();
      geometry.draw({ program });
    },

    dispose() {
      geometry.remove();
      program.remove();
      gl.deleteShader(program.vertexShader);
      gl.deleteShader(program.fragmentShader);
    },
  };
}
