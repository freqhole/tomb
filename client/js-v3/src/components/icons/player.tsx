import type { IconProps } from "./types";

// Base icon wrapper for consistent behavior
const BaseIcon = (
  props: IconProps & { children: any; defaultSize?: number },
) => {
  const size = () => props.size ?? props.defaultSize ?? 16;
  const color = () => props.color ?? "currentColor";

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill={color()}
      class={props.className}
      aria-label={props["aria-label"]}
      role="img"
      style={{
        "flex-shrink": 0,
        transition: "color 0.2s ease",
      }}
    >
      {props.children}
    </svg>
  );
};

// Player Control Icons
export const PlayIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Play"}>
    <path d="M8 5v14l11-7z" />
  </BaseIcon>
);

export const PauseIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Pause"}>
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </BaseIcon>
);

export const PrevIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Previous track"}>
    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
  </BaseIcon>
);

export const NextIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Next track"}>
    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
  </BaseIcon>
);

export const StopIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Stop"}>
    <path d="M6 6h12v12H6z" />
  </BaseIcon>
);

// Queue and Playlist Icons
export const QueueIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Queue"}>
    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
  </BaseIcon>
);

export const ShuffleIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Shuffle"}>
    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
  </BaseIcon>
);

export const RepeatIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Repeat"}>
    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
  </BaseIcon>
);

export const RepeatOneIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Repeat one"}>
    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
  </BaseIcon>
);

// Volume Icons
export const VolumeIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Volume"}>
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </BaseIcon>
);

export const VolumeOffIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Volume muted"}>
    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
  </BaseIcon>
);

export const VolumeLowIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Volume low"}>
    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
  </BaseIcon>
);

export const VolumeHighIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Volume high"}>
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </BaseIcon>
);
