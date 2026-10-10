'use client';

/**
 * Responsive image with loading/fallback states and aspect-ratio support.
 *
 * Vendored shadcn-style UI primitive (Radix UI + Tailwind CSS).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
type ImageFormat = 'jpg' | 'png' | 'webp' | 'bmp' | 'gif' | 'tiff';

type NativeImgProps = React.ComponentPropsWithoutRef<'img'>;

export interface ImageProps extends NativeImgProps {
  quality?: number;
  format?: ImageFormat;
  breakpoints?: Array<number>;
}

/** DEFAULT_QUALITY component. */
const DEFAULT_QUALITY = 80;
const DEFAULT_RESOLUTIONS: number[] = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048,
  3840,
];

/** SRC_ALLOWLIST component. */
const SRC_ALLOWLIST = [
  '/runtime/api/v1/storage/object/',
  '/aily/api/v1/feisuda/attachments/',
  '/aily/api/v1/files/static/',
];

/** getClosestResolution component. */
function getClosestResolution(target: number): number {
  return DEFAULT_RESOLUTIONS.reduce((prev, curr) => {
    return Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev;
  });
}

/** applyParamsToUrl component. */
function applyParamsToUrl(
  src: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      return `${k},${v}`;
    })
    .join('/');
  if (!search) return src;

  const [pathAndQuery = '', hash] = src.split('#');
  const [base, query] = pathAndQuery.split('?');
  const urlParams = new URLSearchParams(query);
  urlParams.set('x-tos-process', `image/${search}`);

  return `${base}?${urlParams.toString()}${hash ? '#' + hash : ''}`;
}

/** isTargetSrc component. */
function isTargetSrc(originSrc: string) {
  return SRC_ALLOWLIST.some((item) => originSrc.includes(item));
}

/** supportWebp component. */
function supportWebp() {
  try {
    return (
      document
        .createElement('canvas')
        .toDataURL('image/webp')
        .indexOf('data:image/webp') === 0
    );
  } catch (err) {
    return false;
  }
}

/** buildSrcSet component. */
function buildSrcSet(
  src: string,
  widths: number[],
  format: ImageFormat | undefined,
  quality: number,
  width?: number,
  sizes?: string,
): string | undefined {
  if (!widths || widths.length === 0 || (!width && !sizes)) return undefined;
  const fmt = format;
  if (width) {
    return [1, 2]
      .map((dpr) => {
        const targetWidth = getClosestResolution(width * dpr);
        return `${applyParamsToUrl(src, { resize: `w_${targetWidth}`, quality: `Q_${quality}`, format: fmt })} ${dpr}x`;
      })
      .join(', ');
  }
  return widths
    .map(
      (w) =>
        `${applyParamsToUrl(src, { resize: `w_${w}`, quality: `Q_${quality}`, format: fmt })} ${w}w`,
    )
    .join(', ');
}

/** Responsive image. */
export const Image = React.forwardRef<HTMLImageElement, ImageProps>(
  (
    {
      src,
      width,
      height,
      quality = DEFAULT_QUALITY,
      format,
      sizes,
      srcSet: userSrcSet,
      breakpoints = DEFAULT_RESOLUTIONS,
      className,
      loading = 'lazy',
      decoding = 'async',
      ...rest
    },
    ref,
  ) => {
    const defaultFormat = React.useMemo(
      () => (supportWebp() ? 'webp' : undefined),
      [],
    );

    // When src is not on the allow-list, render a plain native <img>, preserving all native props
    if (typeof src !== 'string' || !isTargetSrc(src)) {
      return (
        <img
          {...rest}
          ref={ref}
          src={src}
          width={width}
          height={height}
          sizes={sizes}
          srcSet={userSrcSet}
          className={cn(
            'bg-linear-to-b from-gray-50/20 to-gray-200/20',
            className,
          )}
          loading={loading}
          decoding={decoding}
        />
      );
    }

    // Only optimize srcSet when width is a numeric value
    const numericWidth = typeof width === 'number' ? width : undefined;

    // Prefer the caller-supplied srcSet; otherwise build an optimized one
    const srcSet =
      userSrcSet ??
      buildSrcSet(
        src,
        breakpoints,
        format ?? (defaultFormat as ImageFormat),
        quality,
        numericWidth,
        sizes,
      );

    const baseSrc = applyParamsToUrl(src, {
      resize: numericWidth ? `w_${numericWidth}` : undefined,
      quality: `Q_${quality}`,
      format: format ?? defaultFormat,
    });

    return (
      <img
        {...rest}
        ref={ref}
        src={baseSrc}
        width={width}
        height={height}
        sizes={sizes}
        srcSet={srcSet}
        className={cn(
          'bg-linear-to-b from-gray-50/20 to-gray-200/20',
          className,
        )}
        loading={loading}
        decoding={decoding}
      />
    );
  },
);

Image.displayName = 'Image';

export default Image;
