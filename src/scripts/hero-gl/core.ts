/**
 * Low-level renderer for the hero terrain shader: one program drawing one full-screen triangle, in plain WebGL2
 * (no engine, a few kB). Shared by the live background (../hero-gl.ts) and the poster bake
 * (src/pages/dev-poster.astro, driven by .private/tools/bake-poster.mjs).
 *
 * The program links with KHR_parallel_shader_compile when the browser has it: the GPU process compiles on its
 * own thread while this module polls COMPLETION_STATUS_KHR once per frame, so the page's main thread never waits
 * for the shader compiler (on Windows/ANGLE a full-screen fragment shader can take a few hundred ms).
 */
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

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Compile and link without blocking: the first status query waits until the parallel compile has finished. */
async function linkProgram(gl: WebGL2RenderingContext): Promise<{ program: WebGLProgram; shaders: WebGLShader[] }> {
  const shaders = ([
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const).map(([type, source]) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('hero shader: no shader object (context lost?)');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  });
  const program = gl.createProgram();
  if (!program) throw new Error('hero shader: no program object (context lost?)');
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  if (parallel) {
    while (!gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
      if (gl.isContextLost()) throw new Error('hero shader: context lost while compiling');
      await nextFrame();
    }
  }
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = [gl.getProgramInfoLog(program), ...shaders.map((shader) => gl.getShaderInfoLog(shader))].filter(Boolean).join(' | ');
    throw new Error(`hero shader failed to link: ${log || 'context lost'}`);
  }
  return { program, shaders };
}

/** Rejects if WebGL2 is unavailable or the shader fails to link. */
export async function createHeroCore(canvas: HTMLCanvasElement, look: HeroLook): Promise<HeroCore> {
  const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null;
  if (!gl || gl.isContextLost()) throw new Error('WebGL2 is not available');
  const { program, shaders } = await linkProgram(gl);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const uniform = {
    resolution: at('uResolution'),
    pixel: at('uPixel'),
    time: at('uTime'),
    pointer: at('uPointer'),
  };
  // full-screen triangle: (-1,-1) (3,-1) (-1,3) covers the viewport, the fragment shader works in gl_FragCoord space
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  // no blending and every pixel is covered, so no clear is needed
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(program);
  gl.uniform3fv(at('uAccent'), look.accent);
  gl.uniform3fv(at('uGlow'), look.glow);
  gl.uniform1f(at('uIntensity'), look.intensity);

  let width = Math.max(1, canvas.width);
  let height = Math.max(1, canvas.height);

  return {
    gl,

    resize(cssWidth, cssHeight, pixelRatio) {
      width = Math.max(1, Math.round(cssWidth * pixelRatio));
      height = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.useProgram(program);
      gl.uniform2f(uniform.resolution, width, height);
      gl.uniform1f(uniform.pixel, pixelRatio);
    },

    draw(frame) {
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.uniform1f(uniform.time, frame.time);
      gl.uniform4f(uniform.pointer, frame.pointerX, 1 - frame.pointerY, frame.hover, frame.bloom); // GL's y axis points up
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },

    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
    },
  };
}
