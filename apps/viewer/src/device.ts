import * as pc from "playcanvas";

export const MAX_DEVICE_PIXEL_RATIO = 1.5;

// createGraphicsDevice tries deviceTypes in order; WebGL2 is implicitly appended
// as a fallback whenever it isn't already in the list, so requesting WebGPU alone
// is sufficient to get "prefer WebGPU, fall back to WebGL2".
export async function createDevice(canvas: HTMLCanvasElement): Promise<pc.GraphicsDevice> {
  const device: pc.GraphicsDevice = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGPU],
  });

  device.maxPixelRatio = Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO);

  console.log(`[portal-viewer] renderer active: ${device.deviceType}`);

  return device;
}
