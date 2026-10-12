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

export default OwnerSelect;
