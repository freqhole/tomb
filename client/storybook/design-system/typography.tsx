import { JSX, ParentComponent, splitProps } from "solid-js";

// heading component with level prop
export interface HeadingProps extends JSX.HTMLAttributes<HTMLHeadingElement> {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  class?: string;
}

export const Heading: ParentComponent<HeadingProps> = (props) => {
  const [local, rest] = splitProps(props, ["level", "class", "children"]);

  const headingClass = () => {
    const baseClass = `heading-${local.level}`;
    return local.class ? `${baseClass} ${local.class}` : baseClass;
  };

  switch (local.level) {
    case 1:
      return <h1 class={headingClass()} {...rest}>{local.children}</h1>;
    case 2:
      return <h2 class={headingClass()} {...rest}>{local.children}</h2>;
    case 3:
      return <h3 class={headingClass()} {...rest}>{local.children}</h3>;
    case 4:
      return <h4 class={headingClass()} {...rest}>{local.children}</h4>;
    case 5:
      return <h5 class={headingClass()} {...rest}>{local.children}</h5>;
    case 6:
      return <h6 class={headingClass()} {...rest}>{local.children}</h6>;
  }
};

// body text component with size prop
export interface BodyTextProps extends JSX.HTMLAttributes<HTMLParagraphElement> {
  size?: "xs" | "small" | "base" | "large";
  class?: string;
}

export const BodyText: ParentComponent<BodyTextProps> = (props) => {
  const [local, rest] = splitProps(props, ["size", "class", "children"]);

  const textClass = () => {
    const sizeClass = local.size ? `body-${local.size}` : "body-base";
    return local.class ? `${sizeClass} ${local.class}` : sizeClass;
  };

  return <p class={textClass()} {...rest}>{local.children}</p>;
};

// label component
export interface LabelProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  class?: string;
}

export const Label: ParentComponent<LabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  const labelClass = () => {
    return local.class ? `label ${local.class}` : "label";
  };

  return <span class={labelClass()} {...rest}>{local.children}</span>;
};

// caption component
export interface CaptionProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  class?: string;
}

export const Caption: ParentComponent<CaptionProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  const captionClass = () => {
    return local.class ? `caption ${local.class}` : "caption";
  };

  return <span class={captionClass()} {...rest}>{local.children}</span>;
};

// monospace component
export interface MonospaceProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  class?: string;
}

export const Monospace: ParentComponent<MonospaceProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  const monoClass = () => {
    return local.class ? `monospace ${local.class}` : "monospace";
  };

  return <span class={monoClass()} {...rest}>{local.children}</span>;
};
