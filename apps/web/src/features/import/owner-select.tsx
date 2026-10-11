/**
 * The owner an import is made under, chosen with the kit's select: the
 * URL's source namespace first when its host is one the platform knows,
 * then the person's handle. Drawn in the browser only (`client-owner.tsx`):
 * Base UI's select and its positioning are the browser's to run, and the
 * Worker bundles none of them.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import { TRIGGER } from "./client-owner.tsx";
import type { OwnerSelectProps } from "./client-owner.tsx";

export const OwnerSelect = ({
  choices,
  describedBy,
  labelledBy,
  onChange,
  value,
}: OwnerSelectProps) => (
  <Select
    items={choices.map((choice) => ({ label: choice, value: choice }))}
    name="owner"
    onValueChange={(chosen) => {
      // The select hands back one of its items' values: find it, an owner.
      const owner = choices.find((choice) => choice === chosen);

      if (owner !== undefined) {
        onChange(owner);
      }
    }}
    value={value}
  >
    <SelectTrigger
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
      className={TRIGGER}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {choices.map((choice) => (
        <SelectItem key={choice} value={choice}>
          {choice}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

// `React.lazy` takes a module's default export.
export default OwnerSelect;
