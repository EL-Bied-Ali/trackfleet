"use client";

import { useEffect, useState } from "react";

export function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export async function cropLogoDataUrl(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("logo_decode_failed"));
    image.src = dataUrl;
  });
  const source = document.createElement("canvas");
  source.width = image.naturalWidth || image.width;
  source.height = image.naturalHeight || image.height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || source.width < 1 || source.height < 1) return dataUrl;
  sourceContext.drawImage(image, 0, 0, source.width, source.height);

  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const alpha = pixels[offset + 3];
      const isNearWhite = pixels[offset] > 245 && pixels[offset + 1] > 245 && pixels[offset + 2] > 245;
      if (alpha < 16 || isNearWhite) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return dataUrl;

  const padding = Math.max(2, Math.round(Math.max(right - left + 1, bottom - top + 1) * 0.04));
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(source.width - 1, right + padding);
  bottom = Math.min(source.height - 1, bottom + padding);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const maxDimension = 320;
  const scale = Math.min(1, maxDimension / Math.max(cropWidth, cropHeight));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(cropWidth * scale));
  output.height = Math.max(1, Math.round(cropHeight * scale));
  const outputContext = output.getContext("2d");
  if (!outputContext) return dataUrl;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, output.width, output.height);
  return output.toDataURL("image/png");
}

export function CompanyLogo({ logoDataUrl, className }: { logoDataUrl: string | null; className: string }) {
  const [displayLogo, setDisplayLogo] = useState(logoDataUrl);
  // Resets synchronously during render when the prop changes (React's
  // documented pattern for adjusting state on a prop change without an
  // effect -- see "Adjusting some state when a prop changes"), so the raw
  // logo shows immediately; the effect below only handles the async crop
  // upgrade once it's ready, not the reset itself.
  const [lastSource, setLastSource] = useState(logoDataUrl);
  if (logoDataUrl !== lastSource) {
    setLastSource(logoDataUrl);
    setDisplayLogo(logoDataUrl);
  }
  useEffect(() => {
    let active = true;
    if (!logoDataUrl) return () => { active = false; };
    void cropLogoDataUrl(logoDataUrl).then((croppedLogo) => {
      if (active) setDisplayLogo(croppedLogo);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [logoDataUrl]);
  return <span className={className}>{displayLogo ? <img src={displayLogo} alt="" /> /* eslint-disable-line @next/next/no-img-element -- a client-generated data: URI, not a static/remote asset Next's image pipeline could optimize */ : <span>↗</span>}</span>;
}
