import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

import leonidImage from "@/plugins/leonid/leonid_slack_bot.jpg";

type LeonidIconProps = ComponentPropsWithoutRef<"img"> & {
  color?: string;
  size?: number | string;
  stroke?: number | string;
};

export const LeonidIcon = forwardRef<HTMLImageElement, LeonidIconProps>(function LeonidIcon(
  { alt = "", size = 24, style, ...props },
  ref
) {
  const { color, stroke, ...imgProps } = props;
  void color;
  void stroke;

  return (
    <img
      {...imgProps}
      alt={alt}
      height={size}
      ref={ref}
      src={leonidImage}
      style={{
        borderRadius: "999px",
        display: "block",
        objectFit: "cover",
        ...style,
      }}
      width={size}
    />
  );
});
