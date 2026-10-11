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

export interface OwnerSelectProps {
  /** The owners to choose from, the default first. */
  readonly choices: readonly string[];
  readonly labelledBy: string;
  readonly describedBy: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}

/** The trigger's look, shared with the server's stand-in for it. */
export const TRIGGER =
  "tablet:text-ui tablet:h-9 h-11 w-full max-w-sm text-base";

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
      if (chosen !== null) {
        onChange(chosen);
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
