// shared icon types - isolated to avoid circular dependencies

export interface IconProps {
  size?: number | string;
  color?: string;
  className?: string;
  "aria-label"?: string;
  title?: string;
}

export type IconComponent = (props: IconProps) => any;
