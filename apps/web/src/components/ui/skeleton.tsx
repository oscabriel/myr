import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("border-skeleton rounded-none border", className)}
      {...props}
    />
  );
}

export { Skeleton };
