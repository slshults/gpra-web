import React from "react";
import { cn } from "@lib/utils";

const Progress = React.forwardRef(({ className, value, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-gray-900/20",
      className
    )}
    {...props}
  >
    <div
      className="h-full bg-blue-500 transition-all duration-200 ease-in-out"
      style={{ width: `${value || 0}%` }}
    />
  </div>
));

Progress.displayName = "Progress";

export { Progress }; 