/* Freqhole Style Utilities */

/**
 * Conditional class name builder
 * Similar to clsx but lightweight and tailored for Freqhole
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Build class names with conditions
 */
export function buildClassName(
  base: string,
  conditions: Record<string, boolean>,
  variants?: Record<string, string>
): string {
  let className = base;

  // Add conditional classes
  Object.entries(conditions).forEach(([key, condition]) => {
    if (condition) {
      className += ` ${key}`;
    }
  });

  // Add variant classes
  if (variants) {
    Object.entries(variants).forEach(([key, value]) => {
      if (value) {
        className += ` ${key}-${value}`;
      }
    });
  }

  return className;
}

/**
 * Generate responsive classes
 */
export function responsive(
  base: string,
  breakpoints: Partial<{
    sm: string;
    md: string;
    lg: string;
    xl: string;
    '2xl': string;
  }>
): string {
  let className = base;

  Object.entries(breakpoints).forEach(([breakpoint, value]) => {
    if (value) {
      className += ` ${breakpoint}:${value}`;
    }
  });

  return className;
}

/**
 * Generate size variant classes
 */
export function sizeVariant(
  base: string,
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
): string {
  const sizeMap = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
    xl: 'px-8 py-4 text-xl',
    '2xl': 'px-10 py-5 text-2xl',
  };

  return `${base} ${sizeMap[size]}`;
}

/**
 * Generate color variant classes
 */
export function colorVariant(
  base: string,
  color: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'
): string {
  const colorMap = {
    primary: 'bg-primary-500 text-white hover:bg-primary-600',
    secondary: 'bg-dark-200 text-white hover:bg-dark-300',
    success: 'bg-green-500 text-white hover:bg-green-600',
    warning: 'bg-yellow-500 text-white hover:bg-yellow-600',
    error: 'bg-red-500 text-white hover:bg-red-600',
    info: 'bg-blue-500 text-white hover:bg-blue-600',
  };

  return `${base} ${colorMap[color]}`;
}

/**
 * Generate animation classes
 */
export function withAnimation(
  base: string,
  animation: 'fade-in' | 'slide-up' | 'slide-right' | 'scale' | 'pulse'
): string {
  const animationMap = {
    'fade-in': 'metro-fade-in',
    'slide-up': 'metro-slide-up',
    'slide-right': 'metro-slide-right',
    'scale': 'metro-scale-hover',
    'pulse': 'animate-pulse',
  };

  return `${base} ${animationMap[animation]}`;
}

/**
 * Generate hover effect classes
 */
export function withHover(
  base: string,
  effect: 'button' | 'item' | 'scale' | 'glow' | 'lift'
): string {
  const hoverMap = {
    button: 'metro-button-hover',
    item: 'metro-item-hover',
    scale: 'hover:scale-105 transition-transform',
    glow: 'hover:shadow-lg hover:shadow-primary-500/25 transition-shadow',
    lift: 'hover:-translate-y-1 transition-transform',
  };

  return `${base} ${hoverMap[effect]}`;
}

/**
 * Generate focus classes
 */
export function withFocus(base: string): string {
  return `${base} freqhole-focus-visible focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-black`;
}

/**
 * Generate loading state classes
 */
export function loadingState(
  base: string,
  isLoading: boolean,
  loadingClass = 'loading-shimmer'
): string {
  return isLoading ? `${base} ${loadingClass}` : base;
}

/**
 * Generate disabled state classes
 */
export function disabledState(
  base: string,
  isDisabled: boolean,
  disabledClass = 'opacity-50 cursor-not-allowed'
): string {
  return isDisabled ? `${base} ${disabledClass}` : base;
}

/**
 * Generate selected state classes
 */
export function selectedState(
  base: string,
  isSelected: boolean,
  selectedClass = 'bg-primary-500/20 border-primary-500/50'
): string {
  return isSelected ? `${base} ${selectedClass}` : base;
}

/**
 * Generate active state classes
 */
export function activeState(
  base: string,
  isActive: boolean,
  activeClass = 'bg-primary-500 text-white'
): string {
  return isActive ? `${base} ${activeClass}` : base;
}

/**
 * Generate error state classes
 */
export function errorState(
  base: string,
  hasError: boolean,
  errorClass = 'border-red-500 bg-red-500/10'
): string {
  return hasError ? `${base} ${errorClass}` : base;
}

/**
 * Generate spacing classes
 */
export function spacing(
  type: 'margin' | 'padding',
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl',
  direction?: 'x' | 'y' | 't' | 'r' | 'b' | 'l'
): string {
  const sizeMap = {
    xs: '1',
    sm: '2',
    md: '4',
    lg: '6',
    xl: '8',
    '2xl': '12',
  };

  const prefix = type === 'margin' ? 'm' : 'p';
  const suffix = direction ? direction : '';

  return `${prefix}${suffix}-${sizeMap[size]}`;
}

/**
 * Generate grid classes
 */
export function grid(
  cols: number,
  gap: 'xs' | 'sm' | 'md' | 'lg' | 'xl' = 'md',
  responsive?: Partial<{
    sm: number;
    md: number;
    lg: number;
    xl: number;
  }>
): string {
  const gapMap = {
    xs: 'gap-1',
    sm: 'gap-2',
    md: 'gap-4',
    lg: 'gap-6',
    xl: 'gap-8',
  };

  let className = `grid grid-cols-${cols} ${gapMap[gap]}`;

  if (responsive) {
    Object.entries(responsive).forEach(([breakpoint, value]) => {
      className += ` ${breakpoint}:grid-cols-${value}`;
    });
  }

  return className;
}

/**
 * Generate flex classes
 */
export function flex(
  direction: 'row' | 'col' = 'row',
  align: 'start' | 'center' | 'end' | 'stretch' = 'center',
  justify: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly' = 'start',
  wrap: boolean = false
): string {
  const alignMap = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  };

  const justifyMap = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
    evenly: 'justify-evenly',
  };

  return cn(
    'flex',
    direction === 'col' ? 'flex-col' : 'flex-row',
    alignMap[align],
    justifyMap[justify],
    wrap && 'flex-wrap'
  );
}

/**
 * Generate truncate classes
 */
export function truncate(lines?: number): string {
  if (!lines || lines === 1) {
    return 'truncate';
  }

  if (lines === 2) {
    return 'freqhole-truncate-2';
  }

  if (lines === 3) {
    return 'freqhole-truncate-3';
  }

  return `line-clamp-${lines}`;
}

/**
 * Theme-aware classes
 */
export function themeAware(
  lightClass: string,
  darkClass: string,
  theme: 'light' | 'dark' | 'auto' = 'auto'
): string {
  if (theme === 'light') return lightClass;
  if (theme === 'dark') return darkClass;

  // Auto theme uses dark as default for Freqhole
  return darkClass;
}

/**
 * Screen reader only classes
 */
export function srOnly(text: string): string {
  return 'sr-only';
}

/**
 * Generate transition classes
 */
export function transition(
  property: 'all' | 'colors' | 'opacity' | 'shadow' | 'transform' = 'all',
  duration: 'fast' | 'normal' | 'slow' = 'normal',
  timing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' = 'ease-out'
): string {
  const durationMap = {
    fast: 'duration-200',
    normal: 'duration-300',
    slow: 'duration-500',
  };

  const timingMap = {
    linear: 'ease-linear',
    ease: 'ease',
    'ease-in': 'ease-in',
    'ease-out': 'ease-out',
    'ease-in-out': 'ease-in-out',
  };

  return `transition-${property} ${durationMap[duration]} ${timingMap[timing]}`;
}

/**
 * Generate shadow classes
 */
export function shadow(
  size: 'sm' | 'md' | 'lg' | 'xl' | '2xl' = 'md',
  color?: 'primary' | 'black'
): string {
  const sizeMap = {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
    xl: 'shadow-xl',
    '2xl': 'shadow-2xl',
  };

  const colorMap = {
    primary: 'shadow-primary-500/25',
    black: 'shadow-black/25',
  };

  return color ? `${sizeMap[size]} ${colorMap[color]}` : sizeMap[size];
}

/**
 * Generate border classes
 */
export function border(
  width: 0 | 1 | 2 | 4 | 8 = 1,
  color: 'gray' | 'primary' | 'transparent' = 'gray',
  style: 'solid' | 'dashed' | 'dotted' = 'solid'
): string {
  const widthMap = {
    0: 'border-0',
    1: 'border',
    2: 'border-2',
    4: 'border-4',
    8: 'border-8',
  };

  const colorMap = {
    gray: 'border-gray-700',
    primary: 'border-primary-500',
    transparent: 'border-transparent',
  };

  const styleMap = {
    solid: '',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
  };

  return cn(widthMap[width], colorMap[color], styleMap[style]);
}
