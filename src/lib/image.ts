/** Image helpers: shrink screenshots before upload, and grab a frame from a shared screen. */

const MAX_W = 1600;

export async function blobToJpegBase64(blob: Blob): Promise<{ data: string; mimeType: string; thumb: string }> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_W / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const url = canvas.toDataURL("image/jpeg", 0.86);
  const tw = 160;
  const tcanvas = document.createElement("canvas");
  tcanvas.width = tw;
  tcanvas.height = Math.round((h / w) * tw);
  tcanvas.getContext("2d")!.drawImage(canvas, 0, 0, tcanvas.width, tcanvas.height);
  return { data: url.split(",")[1], mimeType: "image/jpeg", thumb: tcanvas.toDataURL("image/jpeg", 0.7) };
}

let stream: MediaStream | null = null;

/** Captures one frame of a window/screen the user picks. Keeps the share open for quick repeat captures. */
export async function captureFrame(): Promise<Blob> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen capture isn't supported in this browser.");
  if (!stream || stream.getVideoTracks().every((t) => t.readyState === "ended")) {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    stream.getVideoTracks()[0].addEventListener("ended", () => (stream = null));
  }
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  await new Promise((r) => setTimeout(r, 150));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  video.pause();
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Capture failed"))), "image/png"));
}

export function stopCapture() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
export const isCapturing = () => !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");
